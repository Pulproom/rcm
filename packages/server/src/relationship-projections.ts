import { auxiliaryInputFingerprint, auxiliaryInputOutcome, recordAuxiliaryInput } from './auxiliary-input-cache.js';
import { randomUUID } from "node:crypto";
import {
  estimateTokens,
  measureAuxiliaryPrompt,
  INITIAL_AFFECTION_LEVELS,
  INITIAL_INTENSITY_LEVELS,
  INITIAL_INTIMACY_LEVELS,
  INITIAL_TRUST_LEVELS,
  RELATIONSHIP_TREND_VALUES,
  type RelationshipProjectionResult,
} from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { hasActiveBackfillBarrier } from "./backfill-barrier.js";
import { canAutomaticallyChange, committedEditOrdinal, correctionView, isAutoLocked } from "./user-corrections.js";

export const RELATIONSHIP_PROJECTION_AXES = ["affection", "trust", "intimacy", "fear", "jealousy", "hostility"] as const;
export type RelationshipProjectionAxis = typeof RELATIONSHIP_PROJECTION_AXES[number];
export type RelationshipProjectionMode = "incremental" | "replay";

export const RELATIONSHIP_LEVELS: Record<RelationshipProjectionAxis, readonly string[]> = {
  affection: INITIAL_AFFECTION_LEVELS,
  trust: INITIAL_TRUST_LEVELS,
  intimacy: INITIAL_INTIMACY_LEVELS,
  fear: INITIAL_INTENSITY_LEVELS,
  jealousy: INITIAL_INTENSITY_LEVELS,
  hostility: INITIAL_INTENSITY_LEVELS,
};

export interface RelationshipProjectionView {
  from: string;
  to: string;
  axes: Record<RelationshipProjectionAxis, { level: string; trend: string }>;
  summary: string;
  activeTensions: string[];
  basisEventIds: string[];
  overrides: Record<string, unknown>;
  userEdited: boolean;
  userEditOrdinal: number | null;
  locked: boolean;
  stale: boolean;
  updatedRevision: number;
  updatedAt: number;
}

const unknownAxes = (): RelationshipProjectionView["axes"] => Object.fromEntries(
  RELATIONSHIP_PROJECTION_AXES.map((axis) => [axis, { level: "unknown", trend: "unclear" }]),
) as RelationshipProjectionView["axes"];

const parseObject = (value: string | null | undefined): Record<string, any> => {
  try { const parsed = JSON.parse(value ?? "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
};

const parseList = (value: string | null | undefined): string[] => {
  try { const parsed = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
};

/** Hash source/reference state, excluding the generated projection and its cursor. */
export function relationshipInputFingerprint(db:RcmDatabase,chatId:string,from:string,to:string):string {
  const events=db.prepare('SELECT * FROM relationship_events WHERE chat_id=? AND from_entity=? AND to_entity=? AND active=1 ORDER BY id').all(chatId,from,to);
  const baseline=db.prepare('SELECT * FROM relationship_baselines WHERE chat_id=? AND from_entity=? AND to_entity=? ORDER BY id').all(chatId,from,to);
  const milestones=db.prepare('SELECT * FROM physical_intimacy_milestones WHERE chat_id=? AND active=1 AND ((participant_a=? AND participant_b=?) OR (participant_a=? AND participant_b=?)) ORDER BY id').all(chatId,from,to,to,from);
  const promises=db.prepare('SELECT * FROM promises WHERE chat_id=? AND ((promisor=? AND promisee=?) OR (promisor=? AND promisee=?)) ORDER BY id').all(chatId,from,to,to,from);
  const overrides=db.prepare('SELECT overrides_json,user_edit_ordinal,auto_locked FROM relationship_projections WHERE chat_id=? AND from_entity=? AND to_entity=?').get(chatId,from,to);
  return auxiliaryInputFingerprint(db,[from,to,events,baseline,milestones,promises,overrides ?? {overrides_json:"{}",user_edit_ordinal:null,auto_locked:0}]);
}
export function recordRelationshipInputs(db:RcmDatabase,chatId:string,payload:Record<string,any>,outcome:'succeeded'|'failed'):void {
  for(const [pair,key] of Object.entries(payload.projectionInputFingerprints ?? {})) {
    if(outcome==='succeeded' && (payload.projectionRemainingPairs ?? []).some((item:any)=>`${item.from}\0${item.to}`===pair)) continue;
    recordAuxiliaryInput(db,chatId,'relationship',String(key),outcome);
  }
}

export function queueRelationshipProjection(db: RcmDatabase, chatId: string, from: string, to: string, mode: RelationshipProjectionMode = "incremental"): void {
  const current=db.prepare("SELECT * FROM relationship_projections WHERE chat_id=? AND from_entity=? AND to_entity=?").get(chatId,from,to) as Record<string,any>|undefined;
  if(current && isAutoLocked(current)) return;
  if(mode==='replay' && current?.user_edit_ordinal!=null) {
    const events=db.prepare("SELECT evidence_json FROM relationship_events WHERE chat_id=? AND from_entity=? AND to_entity=? AND active=1").all(chatId,from,to) as Array<{evidence_json:string}>;
    const baseline=parseObject(current.overrides_json);
    if(baseline.axes && typeof baseline.summary==='string' && Array.isArray(baseline.activeTensions)) {
      // An invalidated automatic result must not remain deliverable while replay
      // is pending, even when another later event still needs to be replayed.
      db.prepare("UPDATE relationship_projections SET axes_json=?,summary=?,active_tensions_json=?,basis_event_ids_json='[]',event_cursor_json='{}',stale=0 WHERE chat_id=? AND from_entity=? AND to_entity=?")
        .run(JSON.stringify(baseline.axes),baseline.summary,JSON.stringify(baseline.activeTensions),chatId,from,to);
      if(!events.some(event=>canAutomaticallyChange(db,chatId,current,JSON.parse(event.evidence_json)))) {
        db.prepare("DELETE FROM relationship_projection_queue WHERE chat_id=? AND from_entity=? AND to_entity=?").run(chatId,from,to);
        return;
      }
    }
  }
  db.prepare(`INSERT INTO relationship_projection_queue(chat_id,from_entity,to_entity,queued_at,mode) VALUES(?,?,?,?,?)
    ON CONFLICT(chat_id,from_entity,to_entity) DO UPDATE SET queued_at=excluded.queued_at,
      mode=CASE WHEN relationship_projection_queue.mode='replay' OR excluded.mode='replay' THEN 'replay' ELSE 'incremental' END`).run(chatId, from, to, now(), mode);
  db.prepare("UPDATE relationship_projections SET stale=1 WHERE chat_id=? AND from_entity=? AND to_entity=?").run(chatId, from, to);
}

/** Queue inherited relationship history only after an ordinary extraction has completed. */
export function queueLaggingRelationshipProjections(db: RcmDatabase, chatId: string): number {
  const activePairKeys = new Set<string>();
  const activeJobs = db.prepare(`SELECT payload_json FROM jobs
    WHERE chat_id=? AND type='relationship_projection' AND status IN ('queued','leased')`).all(chatId) as Array<{ payload_json: string }>;
  for (const job of activeJobs) {
    const payload = parseObject(job.payload_json);
    for (const pair of [...(Array.isArray(payload.pairs) ? payload.pairs : []),
      ...(Array.isArray(payload.projectionRemainingPairs) ? payload.projectionRemainingPairs : [])]) {
      if (pair && typeof pair.from === "string" && typeof pair.to === "string") activePairKeys.add(`${pair.from}\0${pair.to}`);
    }
  }
  const pairs = db.prepare(`SELECT DISTINCT from_entity AS "from",to_entity AS "to" FROM relationship_events
    WHERE chat_id=? AND active=1 AND source_job_id LIKE 'lineage:%' ORDER BY from_entity,to_entity`).all(chatId) as Array<{ from: string; to: string }>;
  let queued = 0;
  for (const pair of pairs) {
    const projection = db.prepare("SELECT event_cursor_json FROM relationship_projections WHERE chat_id=? AND from_entity=? AND to_entity=?")
      .get(chatId, pair.from, pair.to) as { event_cursor_json: string } | undefined;
    const cursor = projectionCursor(projection?.event_cursor_json);
    const cursorIds = new Set(cursor.eventIds);
    const pending = (db.prepare(`SELECT id,created_revision FROM relationship_events
      WHERE chat_id=? AND from_entity=? AND to_entity=? AND active=1 AND source_job_id LIKE 'lineage:%'`).all(chatId, pair.from, pair.to) as Array<{ id: string; created_revision: number }>)
      .some((event) => event.created_revision > cursor.revision || (event.created_revision === cursor.revision && !cursorIds.has(event.id)));
    if (auxiliaryInputOutcome(db,chatId,'relationship',relationshipInputFingerprint(db,chatId,pair.from,pair.to))==='failed') continue;
    if (!pending || activePairKeys.has(`${pair.from}\0${pair.to}`)) continue;
    queueRelationshipProjection(db, chatId, pair.from, pair.to, "replay");
    queued += 1;
  }
  return queued;
}

export function flushRelationshipProjectionQueue(db: RcmDatabase, chatId: string, backfillRunId?: string): number {
  if (hasActiveBackfillBarrier(db, chatId)) return 0;
  // Keep new changes coalesced in the pair queue while the previous wave (and
  // any continuation pages) runs, rather than enqueuing duplicate pair jobs.
  const busy = db.prepare(`SELECT 1 FROM jobs WHERE chat_id=? AND type IN ('extract','episode','social_backfill','audit_retry','initial_calibration','relationship_projection') AND status IN ('queued','leased') LIMIT 1`).get(chatId);
  if (busy) return 0;
  // A manual lock may have superseded a dirty request while its old job ran.
  db.prepare(`DELETE FROM relationship_projection_queue WHERE chat_id=? AND EXISTS(
    SELECT 1 FROM relationship_projections p WHERE p.chat_id=relationship_projection_queue.chat_id
      AND p.from_entity=relationship_projection_queue.from_entity AND p.to_entity=relationship_projection_queue.to_entity AND p.auto_locked=1)`).run(chatId);
  const pairs = db.prepare(`SELECT from_entity AS "from",to_entity AS "to",mode FROM relationship_projection_queue WHERE chat_id=? ORDER BY queued_at`).all(chatId) as Array<{ from: string; to: string; mode: RelationshipProjectionMode }>;
  if (!pairs.length) return 0;
  const insert = db.prepare("INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'relationship_projection','queued',?,0,?,?)");
  const remove = db.prepare("DELETE FROM relationship_projection_queue WHERE chat_id=? AND from_entity=? AND to_entity=?");
  let jobs = 0;
  db.transaction(() => {
    const total = Math.ceil(pairs.length / 4);
    for (let index = 0; index < pairs.length; index += 4) {
      const batch = pairs.slice(index, index + 4);
      const timestamp = now();
      insert.run(randomUUID(), chatId, JSON.stringify({ sourceMessageIds: [], pairs: batch,
        ...(backfillRunId ? { backfillRunId, operationStage: "relationship_projection", operationStageOrdinal: Math.floor(index / 4) + 1, operationStageTotal: total } : {}) }), timestamp, timestamp);
      batch.forEach((pair) => remove.run(chatId, pair.from, pair.to));
      jobs += 1;
    }
  })();
  return jobs;
}

interface ProjectionCursor { revision: number; eventIds: string[] }
interface ProjectionPairInput { from: string; to: string; mode?: RelationshipProjectionMode }

const projectionCursor = (value: string | null | undefined): ProjectionCursor => {
  const parsed = parseObject(value);
  return { revision: Number.isInteger(parsed.revision) ? parsed.revision : -1,
    eventIds: Array.isArray(parsed.eventIds) ? parsed.eventIds.filter((id: unknown): id is string => typeof id === "string") : [] };
};

export function projectionInput(db: RcmDatabase, chatId: string, pairs: ProjectionPairInput[]): Record<string, unknown> {
  return {
    pairs: pairs.map((pair) => {
      const previous = db.prepare(`SELECT *
        FROM relationship_projections WHERE chat_id=? AND from_entity=? AND to_entity=?`).get(chatId, pair.from, pair.to) as
        Record<string,any> | undefined;
      const mode: RelationshipProjectionMode = pair.mode === "replay" || !previous ? "replay" : "incremental";
      const cursor = projectionCursor(previous?.event_cursor_json);
      const eventColumns = "id,changes_json AS changes,reason,evidence_json AS evidence,source_start_ordinal AS sourceOrdinal,created_revision AS createdRevision,created_at AS createdAt";
      const allEvents = db.prepare(`SELECT ${eventColumns} FROM relationship_events WHERE chat_id=? AND from_entity=? AND to_entity=? AND active=1
        ORDER BY created_revision,COALESCE(source_start_ordinal,2147483647),created_at,id`).all(chatId, pair.from, pair.to) as Array<Record<string, any>>;
      const eligible = previous?.user_edit_ordinal != null ? allEvents.filter(event => canAutomaticallyChange(db,chatId,previous,JSON.parse(event.evidence || "[]"))) : allEvents;
      const unseen = mode === "incremental" ? eligible.filter((event) => Number(event.createdRevision) > cursor.revision
        || Number(event.createdRevision) === cursor.revision && !cursor.eventIds.includes(String(event.id))) : eligible;
      // Every unseen event advances the projection. Selecting only recent or
      // major rows and then moving the cursor to the end silently lost the
      // omitted relationship history.
      const events: Array<Record<string, any>> = unseen
        .sort((left, right) => Number(left.createdRevision) - Number(right.createdRevision)
          || Number(left.sourceOrdinal ?? Number.MAX_SAFE_INTEGER) - Number(right.sourceOrdinal ?? Number.MAX_SAFE_INTEGER)
          || Number(left.createdAt) - Number(right.createdAt) || String(left.id).localeCompare(String(right.id)))
        .map((row) => ({ ...row, changes: JSON.parse(row.changes || "[]"), evidence: JSON.parse(row.evidence || "[]") }));
      const latestRevision = events.length ? Math.max(...events.map((event) => Number(event.createdRevision))) : cursor.revision;
      const targetCursor: ProjectionCursor = { revision: latestRevision,
        eventIds: events.filter((event) => Number(event.createdRevision) === latestRevision).map((event) => String(event.id)) };
      const baseline = db.prepare(`SELECT qualitative_json AS qualitative,projection_axes_json AS projectionAxes,initial_summary AS initialSummary,
        known_axes_json AS knownAxes,reason,source,source_quote AS sourceQuote
        FROM relationship_baselines WHERE chat_id=? AND from_entity=? AND to_entity=? AND active=1`).get(chatId, pair.from, pair.to) as Record<string, any> | undefined;
      const milestones = db.prepare(`SELECT milestone_key AS milestoneKey,act,initiator,interaction_context AS interactionContext,circumstance,source_start_ordinal AS sourceOrdinal
        FROM physical_intimacy_milestones WHERE chat_id=? AND participant_a IN (?,?) AND participant_b IN (?,?) AND active=1
        ORDER BY COALESCE(source_start_ordinal,2147483647),created_at`).all(chatId, pair.from, pair.to, pair.from, pair.to);
      const promises = db.prepare(`SELECT promisor,promisee,content,status FROM promises WHERE chat_id=? AND status='open'
        AND (promisor IN (?,?) OR promisee IN (?,?)) ORDER BY updated_revision DESC`).all(chatId, pair.from, pair.to, pair.from, pair.to);
      return {
        ...pair,
        mode,
        previous: previous && (mode === "incremental" || previous.user_edit_ordinal != null) ? { axes: mode === "replay" ? parseObject(previous.overrides_json).axes ?? parseObject(previous.axes_json) : parseObject(previous.axes_json), summary: mode === "replay" ? parseObject(previous.overrides_json).summary ?? previous.summary : previous.summary,
          activeTensions: mode === "replay" ? parseObject(previous.overrides_json).activeTensions ?? parseList(previous.active_tensions_json) : parseList(previous.active_tensions_json), basisEventIds: parseList(previous.basis_event_ids_json),
          overrides: parseObject(previous.overrides_json), stale: previous.stale === 1 } : null,
        baseline: mode === "replay" && previous?.user_edit_ordinal == null && baseline ? { axes: parseObject(baseline.projectionAxes), qualitative: parseObject(baseline.qualitative),
          knownAxes: parseList(baseline.knownAxes), summary: baseline.initialSummary ?? baseline.reason, source: baseline.source,
          sourceQuote: baseline.sourceQuote ?? null } : null,
        events,
        milestones,
        openPromises: promises,
        targetCursor,
      };
    }),
  };
}

/** Plan ordered event prefixes; optional context never advances the event cursor. */
export function planProjectionInput(db: RcmDatabase, chatId: string, pairs: ProjectionPairInput[], systemPrompt: string, maxInputTokens: number): {
  pairs: Array<Record<string, any>>; remainingPairs: ProjectionPairInput[]; omittedReferenceItems: number;
} {
  const prepared = projectionInput(db, chatId, pairs) as { pairs: Array<Record<string, any>> };
  const selected: Array<Record<string, any>> = [];
  const remainingPairs: ProjectionPairInput[] = [];
  let omittedReferenceItems = 0;
  const fits = (items: Array<Record<string, any>>) => measureAuxiliaryPrompt([
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify({ pairs: items.map(({ targetCursor, ...item }) => item) }) },
  ], estimateTokens, { maxInputTokens, maxOutputTokens: 0 }).fits;
  for (const [index, source] of prepared.pairs.entries()) {
    const pair: Record<string, any> = { ...source, events: [] as Array<Record<string, any>>, milestones: [...source.milestones], openPromises: [...source.openPromises] };
    // These are references, not the ordered event stream. Prefer source events.
    while (!fits([...selected, { ...pair, events: source.events.slice(0, 1) }]) && (pair.openPromises.length || pair.milestones.length)) {
      if (pair.openPromises.length) pair.openPromises.pop(); else pair.milestones.pop();
      omittedReferenceItems += 1;
    }
    let low = 0, high = source.events.length;
    while (low < high) {
      const count = Math.ceil((low + high) / 2);
      if (fits([...selected, { ...pair, events: source.events.slice(0, count) }])) low = count; else high = count - 1;
    }
    if ((!low && source.events.length) || !fits([...selected, pair])) {
      if (!selected.length) throw new Error("Relationship input cannot fit one source event and required prior state; increase the auxiliary input budget. No event cursor advanced.");
      remainingPairs.push(...pairs.slice(index));
      break;
    }
    pair.events = source.events.slice(0, low);
    const prior = db.prepare("SELECT event_cursor_json FROM relationship_projections WHERE chat_id=? AND from_entity=? AND to_entity=?").get(chatId, pair.from, pair.to) as { event_cursor_json: string } | undefined;
    const oldCursor = source.mode === "incremental" ? projectionCursor(prior?.event_cursor_json) : { revision: -1, eventIds: [] };
    const revision = pair.events.length ? Number(pair.events.at(-1)!.createdRevision) : oldCursor.revision;
    pair.targetCursor = { revision, eventIds: [...new Set([
      ...(oldCursor.revision === revision ? oldCursor.eventIds : []),
      ...pair.events.filter((event: Record<string, any>) => Number(event.createdRevision) === revision).map((event: Record<string, any>) => String(event.id)),
    ])] };
    selected.push(pair);
    if (low < source.events.length) {
      remainingPairs.push({ from: pair.from, to: pair.to, mode: "incremental" }, ...pairs.slice(index + 1));
      break;
    }
  }
  return { pairs: selected, remainingPairs, omittedReferenceItems };
}

export function completeRelationshipProjectionJob(db: RcmDatabase, jobId: string, workerId: string, result: RelationshipProjectionResult): { chatId: string; warnings: string[]; pendingReconciliations: number } {
  const job = db.prepare("SELECT chat_id,payload_json FROM jobs WHERE id=? AND lease_owner=? AND status='leased' AND type='relationship_projection'").get(jobId, workerId) as { chat_id: string; payload_json: string } | undefined;
  if (!job) throw Object.assign(new Error("Lease not found"), { code: "LEASE_NOT_FOUND" });
  const payload = JSON.parse(job.payload_json) as { pairs?: ProjectionPairInput[]; projectionCursors?: Record<string, ProjectionCursor>; allowedBasisIds?: Record<string, string[]>; projectionRemainingPairs?: ProjectionPairInput[]; [key: string]: any };
  const allowed = new Set((payload.pairs ?? []).map((pair) => `${pair.from}\0${pair.to}`));
  const returned = new Set<string>();
  const issues: string[] = [];
  for (const item of result.items) {
    const pairKey = `${item.from}\0${item.to}`;
    if (!allowed.has(pairKey)) issues.push(`Unexpected relationship pair ${item.from}->${item.to}`);
    if (returned.has(pairKey)) issues.push(`Duplicate relationship pair ${item.from}->${item.to}`);
    returned.add(pairKey);
    for (const axis of RELATIONSHIP_PROJECTION_AXES) if (!RELATIONSHIP_LEVELS[axis].includes(item.axes[axis].level)) issues.push(`Unsupported ${axis} level: ${item.axes[axis].level}`);
  }
  for (const pairKey of allowed) if (!returned.has(pairKey)) issues.push(`Missing relationship pair ${pairKey.replace("\0", "->")}`);
  if (issues.length) throw new Error(`Relationship projection validation failed: ${issues.join("; ")}`);
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(job.chat_id) as { revision: number }).revision;
  const timestamp = now();
  db.transaction(() => {
    for (const item of result.items) {
      const current = db.prepare("SELECT * FROM relationship_projections WHERE chat_id=? AND from_entity=? AND to_entity=?").get(job.chat_id, item.from, item.to) as Record<string,any> | undefined;
      const overrides = parseObject(current?.overrides_json);
      const axes = structuredClone(item.axes) as Record<string, any>;
      const summary = item.summary;
      const tensions = item.activeTensions;
      const pairKey = `${item.from}\0${item.to}`;
      const allowedBasis = new Set(payload.allowedBasisIds?.[pairKey] ?? []);
      const validBasis = item.basisEventIds.filter((id) => allowedBasis.has(id)
        && db.prepare("SELECT 1 FROM relationship_events WHERE id=? AND chat_id=? AND active=1").get(id, job.chat_id));
      const evidence=validBasis.flatMap(id => JSON.parse((db.prepare("SELECT evidence_json FROM relationship_events WHERE id=? AND chat_id=?").get(id,job.chat_id) as {evidence_json:string}).evidence_json));
      if(current && !canAutomaticallyChange(db,job.chat_id,current,evidence)) continue;
      const cursor = payload.projectionCursors?.[pairKey] ?? { revision: -1, eventIds: [] };
      const dirty = db.prepare('SELECT 1 FROM relationship_projection_queue WHERE chat_id=? AND from_entity=? AND to_entity=?').get(job.chat_id,item.from,item.to);
      db.prepare(`INSERT INTO relationship_projections(chat_id,from_entity,to_entity,axes_json,summary,active_tensions_json,basis_event_ids_json,
        overrides_json,event_cursor_json,projection_origin,stale,updated_revision,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'llm',?,?,?) ON CONFLICT(chat_id,from_entity,to_entity) DO UPDATE SET
          axes_json=excluded.axes_json,summary=excluded.summary,active_tensions_json=excluded.active_tensions_json,
          basis_event_ids_json=excluded.basis_event_ids_json,event_cursor_json=excluded.event_cursor_json,projection_origin='llm',
          stale=excluded.stale,updated_revision=excluded.updated_revision,updated_at=excluded.updated_at`)
        .run(job.chat_id, item.from, item.to, JSON.stringify(axes), summary, JSON.stringify(tensions), JSON.stringify(validBasis), JSON.stringify(overrides), JSON.stringify(cursor), Number(Boolean(dirty)), revision, timestamp);
    }
    recordRelationshipInputs(db,job.chat_id,payload,'succeeded');
    for(const pair of payload.pairs ?? []) {
      const key=payload.projectionInputFingerprints?.[`${pair.from}\0${pair.to}`];
      if(key && key===relationshipInputFingerprint(db,job.chat_id,pair.from,pair.to)) {
        db.prepare('DELETE FROM relationship_projection_queue WHERE chat_id=? AND from_entity=? AND to_entity=?').run(job.chat_id,pair.from,pair.to);
        db.prepare('UPDATE relationship_projections SET stale=0 WHERE chat_id=? AND from_entity=? AND to_entity=?').run(job.chat_id,pair.from,pair.to);
      }
    }
    if (payload.projectionRemainingPairs?.length) {
      const next: Record<string, any> = { ...payload, pairs: payload.projectionRemainingPairs, projectionRemainingPairs: [], projectionCursors: {}, allowedBasisIds: {}, projectionCompletedParts: Number(payload.projectionCompletedParts ?? 0) + 1, pipelineStage: "queued" };
      delete next.stagedModelOutput;
      db.prepare("UPDATE jobs SET status='queued',payload_json=?,attempts=0,lease_owner=NULL,leased_until=NULL,last_error=NULL,updated_at=? WHERE id=?").run(JSON.stringify(next), timestamp, jobId);
    } else db.prepare("UPDATE jobs SET status='done',lease_owner=NULL,leased_until=NULL,last_error=NULL,updated_at=? WHERE id=?").run(timestamp, jobId);
  })();
  flushRelationshipProjectionQueue(db,job.chat_id,payload.backfillRunId);
  return { chatId: job.chat_id, warnings: [], pendingReconciliations: 0 };
}

export function listRelationshipProjections(db: RcmDatabase, chatId: string): RelationshipProjectionView[] {
  const rows = db.prepare(`SELECT *
    FROM relationship_projections WHERE chat_id=? ORDER BY from_entity,to_entity`).all(chatId) as Array<Record<string, any>>;
  const views = rows.map((row) => ({
    from: row.from_entity,
    to: row.to_entity,
    axes: { ...unknownAxes(), ...parseObject(row.axes_json) },
    summary: row.summary,
    activeTensions: parseList(row.active_tensions_json),
    basisEventIds: parseList(row.basis_event_ids_json),
    overrides: parseObject(row.overrides_json),
    ...correctionView(row),
    stale: row.stale === 1,
    updatedRevision: row.updated_revision,
    updatedAt: row.updated_at,
  }));
  const known = new Set(views.map((row) => `${row.from}\0${row.to}`));
  const baselines = db.prepare(`SELECT from_entity AS "from",to_entity AS "to",source,projection_axes_json AS projectionAxes,
    initial_summary AS initialSummary,created_revision AS createdRevision,created_at AS createdAt
    FROM relationship_baselines WHERE chat_id=? AND active=1 ORDER BY from_entity,to_entity`).all(chatId) as Array<Record<string, any>>;
  for (const pair of baselines) {
    const key = `${pair.from}\0${pair.to}`;
    if (known.has(key)) continue;
    const initial = pair.source === "setup" ? parseObject(pair.projectionAxes) : {};
    const hasInitial = Object.keys(initial).length > 0 && typeof pair.initialSummary === "string" && pair.initialSummary.trim().length > 0;
    views.push({
      from: pair.from, to: pair.to,
      axes: hasInitial ? Object.fromEntries(RELATIONSHIP_PROJECTION_AXES.map((axis) => [axis, { level: initial[axis] ?? "unknown", trend: "unclear" }])) as RelationshipProjectionView["axes"] : unknownAxes(),
      summary: hasInitial ? pair.initialSummary : "Projection pending", activeTensions: [], basisEventIds: [], overrides: {}, userEdited:false,userEditOrdinal:null,locked:false,
      stale: !hasInitial, updatedRevision: Number(pair.createdRevision ?? 0), updatedAt: Number(pair.createdAt ?? 0),
    });
    known.add(key);
  }
  const pendingEvents = db.prepare(`SELECT DISTINCT from_entity AS "from",to_entity AS "to" FROM relationship_events
    WHERE chat_id=? AND active=1 ORDER BY from_entity,to_entity`).all(chatId) as Array<{ from: string; to: string }>;
  for (const pair of pendingEvents) if (!known.has(`${pair.from}\0${pair.to}`)) views.push({ from: pair.from, to: pair.to, axes: unknownAxes(), summary: "Projection pending", activeTensions: [], basisEventIds: [], overrides: {}, userEdited:false,userEditOrdinal:null,locked:false, stale: true, updatedRevision: 0, updatedAt: 0 });
  return views;
}

export function setRelationshipProjectionOverride(db: RcmDatabase, chatId: string, from: string, to: string, patch: Record<string, unknown>): RelationshipProjectionView {
  if (!patch.clear && patch.summary === undefined && patch.activeTensions === undefined && patch.axis === undefined && patch.locked === undefined) throw new Error("A qualitative relationship field is required");
  const existing = listRelationshipProjections(db, chatId).find((item) => item.from === from && item.to === to) ?? {
    from, to, axes: unknownAxes(), summary: "Manually observed relationship", activeTensions: [], basisEventIds: [], overrides: {}, userEdited:false,userEditOrdinal:null,locked:false, stale: false, updatedRevision: 0, updatedAt: 0,
  };
  const overrides = {axes:structuredClone(existing.axes),summary:existing.summary,activeTensions:[...existing.activeTensions]} as Record<string, any>;
  const requiresRegeneration = patch.clear === true || (patch.axis && patch.level === null);
  if (patch.clear === true) Object.keys(overrides).forEach((key) => delete overrides[key]);
  if (patch.summary !== undefined) {
    if (patch.summary === null || patch.summary === "") delete overrides.summary;
    else overrides.summary = String(patch.summary).trim().slice(0, 1_000);
  }
  if (Array.isArray(patch.activeTensions)) overrides.activeTensions = patch.activeTensions.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 8);
  if (patch.axis && typeof patch.axis === "string" && RELATIONSHIP_PROJECTION_AXES.includes(patch.axis as RelationshipProjectionAxis)) {
    const axis = patch.axis as RelationshipProjectionAxis;
    if (patch.level === null) {
      if (overrides.axes) delete overrides.axes[axis];
    } else {
      const level = String(patch.level ?? "");
      const trend = String(patch.trend ?? "unclear");
      if (!RELATIONSHIP_LEVELS[axis].includes(level) || !RELATIONSHIP_TREND_VALUES.includes(trend as typeof RELATIONSHIP_TREND_VALUES[number])) throw new Error("Unsupported relationship override");
      overrides.axes = { ...(overrides.axes ?? {}), [axis]: { level, trend } };
    }
  }
  const axes = structuredClone(existing.axes);
  for (const axis of RELATIONSHIP_PROJECTION_AXES) if (overrides.axes?.[axis]) axes[axis] = overrides.axes[axis];
  const summary = typeof overrides.summary === "string" ? overrides.summary : existing.summary;
  const tensions = Array.isArray(overrides.activeTensions) ? overrides.activeTensions : existing.activeTensions;
  db.prepare(`INSERT INTO relationship_projections(chat_id,from_entity,to_entity,axes_json,summary,active_tensions_json,basis_event_ids_json,overrides_json,stale,updated_revision,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,from_entity,to_entity) DO UPDATE SET axes_json=excluded.axes_json,summary=excluded.summary,
      active_tensions_json=excluded.active_tensions_json,overrides_json=excluded.overrides_json,updated_at=excluded.updated_at`)
    .run(chatId, from, to, JSON.stringify(axes), summary, JSON.stringify(tensions), JSON.stringify(existing.basisEventIds), JSON.stringify(overrides), existing.stale ? 1 : 0, existing.updatedRevision, now());
  db.prepare("UPDATE relationship_projections SET user_edit_ordinal=?,auto_locked=?,stale=0 WHERE chat_id=? AND from_entity=? AND to_entity=?")
    .run(patch.clear ? null : committedEditOrdinal(db,chatId),patch.clear ? 0 : Number(patch.locked ?? existing.locked),chatId,from,to);
  if (requiresRegeneration) queueRelationshipProjection(db, chatId, from, to, "replay");
  return listRelationshipProjections(db, chatId).find((item) => item.from === from && item.to === to)!;
}
