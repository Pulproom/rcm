import { ROLEPLAY_ARCHIVE_FRAMING } from "@rcm/shared";
import { randomUUID } from "node:crypto";
import { estimateTokens, measureAuxiliaryPrompt, LedgerConsistencyResultSchema, type LedgerConsistencyResult, type LeasedJob, type MemoryLanguage, type RpProfile } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { auxiliaryInputFingerprint, auxiliaryInputOutcome, recordAuxiliaryInput } from "./auxiliary-input-cache.js";
import { buildEntityIdentityResolver } from "./entities.js";
import { flushRelationshipProjectionQueue } from "./relationship-projections.js";
import { maybeEnqueueStorySpine } from "./story-spine.js";
import { transitionEvidenceJson, canAutomaticallyChange, isAutoLocked } from "./user-corrections.js";

const ledgerInputBudget = (db: RcmDatabase): number => {
  try {
    const row = db.prepare("SELECT value FROM server_meta WHERE key='server_llm_config'").get() as { value: string } | undefined;
    const value = Number(JSON.parse(row?.value ?? "{}").maxInputTokens);
    return Number.isSafeInteger(value) && value >= 1_024 ? value : 80_000;
  } catch { return 80_000; }
};

interface LedgerState {
  id: string;
  predicate: string;
  value: string;
  confidence: number;
  immutable: boolean;
  createdRevision: number;
  sourceOrdinal: number | null;
  evidenceMessageIds: string[];
}

interface LedgerGroup {
  itemRef: string;
  kind: "world_fact" | "character_belief";
  subject: string;
  holder?: string;
  states: LedgerState[];
}

const parseEvidenceIds = (value: unknown): string[] => {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? [...new Set(parsed.map((item) => String(item?.messageId ?? "")).filter(Boolean))] : [];
  } catch { return []; }
};

const groupRows = <T>(rows: T[], keyOf: (row: T) => string): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  return grouped;
};

function candidateGroups(db: RcmDatabase, chatId: string): LedgerGroup[] {
  const resolve = buildEntityIdentityResolver(db, chatId);
  const assertionRows = db.prepare(`SELECT id,subject,predicate,value,confidence,valid_from_revision,valid_from_ordinal,
      source_batch_id,source_memory_id,evidence_json,user_edit_ordinal,auto_locked FROM assertions
    WHERE chat_id=? AND valid_to_revision IS NULL ORDER BY subject,valid_from_revision,created_at`).all(chatId) as Array<Record<string, any>>;
  const beliefRows = db.prepare(`SELECT id,holder,subject,predicate,value,confidence,created_revision,valid_from_ordinal,
      status,evidence_json,user_edit_ordinal,auto_locked FROM beliefs WHERE chat_id=? AND active=1 AND status='active' ORDER BY holder,subject,created_revision,created_at`).all(chatId) as Array<Record<string, any>>;
  const groups: LedgerGroup[] = [];
  const assertions = groupRows(assertionRows, (row) => resolve(String(row.subject)).canonical.normalize("NFKC").toLocaleLowerCase());
  for (const [key, rows] of assertions) {
    if (rows.length < 2) continue;
    groups.push({
      itemRef: `ledger:world:${key}`,
      kind: "world_fact",
      subject: resolve(String(rows[0]!.subject)).canonical,
      states: rows.map((row) => ({
        id: String(row.id), predicate: String(row.predicate), value: String(row.value), confidence: Number(row.confidence),
        immutable: isAutoLocked(row),
        createdRevision: Number(row.valid_from_revision), sourceOrdinal: row.valid_from_ordinal == null ? null : Number(row.valid_from_ordinal),
        evidenceMessageIds: parseEvidenceIds(row.evidence_json),
      })),
    });
  }
  const beliefs = groupRows(beliefRows, (row) => `${resolve(String(row.holder)).canonical.normalize("NFKC").toLocaleLowerCase()}\0${resolve(String(row.subject)).canonical.normalize("NFKC").toLocaleLowerCase()}`);
  for (const [key, rows] of beliefs) {
    if (rows.length < 2) continue;
    groups.push({
      itemRef: `ledger:belief:${key}`,
      kind: "character_belief",
      holder: resolve(String(rows[0]!.holder)).canonical,
      subject: resolve(String(rows[0]!.subject)).canonical,
      states: rows.map((row) => ({
        id: String(row.id), predicate: String(row.predicate), value: String(row.value), confidence: Number(row.confidence),
        immutable: isAutoLocked(row), createdRevision: Number(row.created_revision),
        sourceOrdinal: row.valid_from_ordinal == null ? null : Number(row.valid_from_ordinal), evidenceMessageIds: parseEvidenceIds(row.evidence_json),
      })),
    });
  }
  return groups;
}

export interface FinalLedgerEnqueueResult {
  state: "waiting" | "queued" | "not_needed";
  count: number;
}

export function enqueueFinalLedgerConsistency(db: RcmDatabase, chatId: string, runId: string): FinalLedgerEnqueueResult {
  const remaining = db.prepare(`SELECT 1 FROM jobs WHERE chat_id=? AND type IN ('extract','episode') AND status IN ('queued','leased')
    AND json_extract(payload_json,'$.backfillRunId')=? LIMIT 1`).get(chatId, runId);
  if (remaining) return { state: "waiting", count: 0 };
  const existing = db.prepare(`SELECT 1 FROM jobs WHERE chat_id=? AND type='ledger_consistency'
    AND status IN ('queued','leased') AND json_extract(payload_json,'$.backfillRunId')=? LIMIT 1`).get(chatId, runId);
  if (existing) return { state: "queued", count: 0 };
  const activeInputs = new Set((db.prepare("SELECT payload_json FROM jobs WHERE chat_id=? AND type='ledger_consistency' AND status IN ('queued','leased')").all(chatId) as Array<{payload_json:string}>)
    .flatMap(row => Object.values(JSON.parse(row.payload_json).groupInputFingerprints ?? {})));
  const fingerprints = new Map(candidateGroups(db, chatId).map(group => [group, auxiliaryInputFingerprint(db, group)]));
  const groups = [...fingerprints.keys()].filter(group => !activeInputs.has(fingerprints.get(group)!)
    && !auxiliaryInputOutcome(db, chatId, 'ledger', fingerprints.get(group)!));
  if (!groups.length) return { state: "not_needed", count: 0 };
  const insert = db.prepare(`INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at)
    VALUES(?,?,'ledger_consistency','queued',?,0,?,?)`);
  let count = 0;
  const inputLimit = ledgerInputBudget(db);
  let batch: LedgerGroup[] = [];
  const enqueue = (): void => {
    if (!batch.length) return;
    const timestamp = Date.now();
    insert.run(randomUUID(), chatId, JSON.stringify({ sourceMessageIds: [], backfillRunId: runId, groups: batch,
      groupInputFingerprints: Object.fromEntries(batch.map(group => [group.itemRef, fingerprints.get(group)])) }), timestamp, timestamp);
    count += 1;
    batch = [];
  };
  for (const group of groups) {
    if (estimateTokens(JSON.stringify({ groups: [group] })) > inputLimit) { enqueue(); batch = [group]; enqueue(); continue; }
    const trial = [...batch, group];
    if (estimateTokens(JSON.stringify({ groups: trial })) > inputLimit) enqueue();
    batch.push(group);
  }
  enqueue();
  if (count) {
    const rows = db.prepare(`SELECT id,payload_json FROM jobs WHERE chat_id=? AND type='ledger_consistency'
      AND json_extract(payload_json,'$.backfillRunId')=? ORDER BY created_at,rowid`).all(chatId, runId) as Array<{ id: string; payload_json: string }>;
    const update = db.prepare("UPDATE jobs SET payload_json=? WHERE id=?");
    rows.forEach((row, index) => update.run(JSON.stringify({ ...JSON.parse(row.payload_json), operationStage: "ledger_consistency",
      operationStageOrdinal: index + 1, operationStageTotal: rows.length }), row.id));
  }
  return { state: count ? "queued" : "not_needed", count };
}

export function finalLedgerConsistencyRunReady(db: RcmDatabase, chatId: string, runId: string): boolean {
  const active = db.prepare(`SELECT 1 FROM jobs WHERE chat_id=? AND type IN ('extract','episode','ledger_consistency')
    AND status IN ('queued','leased') AND json_extract(payload_json,'$.backfillRunId')=? LIMIT 1`).get(chatId, runId);
  return !active;
}

export function recordLedgerInputs(db: RcmDatabase, chatId: string, payload: Record<string, any>, outcome: 'succeeded'|'failed'): void {
  for (const fingerprint of Object.values(payload.groupInputFingerprints ?? {})) {
    if (typeof fingerprint === 'string') recordAuxiliaryInput(db, chatId, 'ledger', fingerprint, outcome);
  }
}

/**
 * Release the downstream ledgers exactly once the complete backfill run has
 * crossed its extraction/episode/final-ledger barrier. Both worker transports
 * call this function so a Risu worker and the built-in server worker cannot
 * diverge in their completion ordering.
 */
export function finalizeLedgerConsistencyRun(db: RcmDatabase, chatId: string, runId: string): boolean {
  if (!finalLedgerConsistencyRunReady(db, chatId, runId)) return false;
  flushRelationshipProjectionQueue(db, chatId, runId);
  maybeEnqueueStorySpine(db, chatId, runId);
  return true;
}

export function buildLedgerConsistencyJob(input: {
  id: string; chatId: string; profile: RpProfile; memoryLanguage: MemoryLanguage; attempt: number;
  payload: { backfillRunId: string; groups: LedgerGroup[]; auxiliaryBudget?: { maxInputTokens?: number } };
}): LeasedJob {
  const systemPrompt = `${ROLEPLAY_ARCHIVE_FRAMING}

You perform a final bounded consistency check on an already extracted roleplay ledger. Return strict JSON only as {"groups":[{"itemRef":"...","closures":[{"targetId":"older id","replacementId":"newer id","reason":"short reason"}]}]}. Return every supplied itemRef exactly once. Close an older state only when a supplied later state explicitly updates or contradicts the same property. Different properties, compatible beliefs, uncertainty, aliases, and merely similar wording must remain separate. Never close immutable=true. replacementId must have direct evidenceMessageIds and be later by sourceOrdinal or createdRevision. Use only supplied IDs. Empty closures is correct when uncertain.`;
  const userPrompt = JSON.stringify({ groups: input.payload.groups });
  const maxInputTokens = input.payload.auxiliaryBudget?.maxInputTokens ?? 80_000;
  const fits = (groups: LedgerGroup[]) => measureAuxiliaryPrompt([{ role: "system", content: systemPrompt }, { role: "user", content: JSON.stringify({ groups }) }], estimateTokens,
    { maxInputTokens, maxOutputTokens: 0 }).fits;
  const pages: LedgerGroup[][] = [];
  let current: LedgerGroup[] = [];
  for (const group of input.payload.groups) {
    if (fits([group])) {
      if (current.length && !fits([...current, group])) { pages.push(current); current = []; }
      current.push(group);
      continue;
    }
    if (current.length) { pages.push(current); current = []; }
    let states: LedgerState[] = [];
    for (const state of group.states) {
      const trial = [...states, state];
      if (trial.length >= 2 && !fits([{ ...group, states: trial }])) {
        if (states.length < 2) throw new Error(`Ledger state ${state.id} and required prior context cannot fit the configured input budget`);
        pages.push([{ ...group, states }]);
        states = [states.at(-1)!, state];
        if (!fits([{ ...group, states }])) throw new Error(`Ledger state ${state.id} and required prior context cannot fit the configured input budget`);
      } else states = trial;
    }
    if (states.length >= 2) pages.push([{ ...group, states }]);
  }
  if (current.length) pages.push(current);
  const promptParts = pages.map((groups) => { const pageUserPrompt = JSON.stringify({ groups }); return { systemPrompt, userPrompt: pageUserPrompt,
    itemRefs: groups.map((group) => group.itemRef), estimatedInputTokens: measureAuxiliaryPrompt([{ role: "system", content: systemPrompt }, { role: "user", content: pageUserPrompt }], estimateTokens,
      { maxInputTokens, maxOutputTokens: 0 }).estimatedInputTokens }; });
  return {
    id: input.id, chatId: input.chatId, kind: "ledger_consistency", profile: input.profile, memoryLanguage: input.memoryLanguage,
    prompt: `${systemPrompt}\n\n${userPrompt}`, systemPrompt, userPrompt, sourceMessageIds: [], attempt: input.attempt,
    ledgerConsistency: {
      runId: input.payload.backfillRunId,
      promptParts,
      groups: input.payload.groups.map((group) => ({
        itemRef: group.itemRef, kind: group.kind,
        states: group.states.map(({ id, immutable, createdRevision, sourceOrdinal, evidenceMessageIds }) => ({ id, immutable, createdRevision, sourceOrdinal, evidenceMessageIds })),
      })),
    }, plannedParts: promptParts.length, estimatedInputTokens: promptParts.reduce((sum, part) => sum + part.estimatedInputTokens, 0),
  };
}

export function completeLedgerConsistencyJob(db: RcmDatabase, job: LeasedJob, workerId: string, input: unknown): { chatId: string; warnings: string[]; pendingReconciliations: number } {
  if (!job.ledgerConsistency) throw new Error("Ledger consistency metadata is missing");
  const result = LedgerConsistencyResultSchema.parse(input);
  const supplied = new Map(job.ledgerConsistency.groups.map((group) => [group.itemRef, group]));
  if (result.groups.length !== supplied.size || result.groups.some((group) => !supplied.has(group.itemRef))) throw new Error("Final ledger check must return every supplied group exactly once");
  const warnings: string[] = [];
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(job.chatId) as { revision: number }).revision;
  db.transaction(() => {
    for (const decision of result.groups) {
      const group = supplied.get(decision.itemRef)!;
      const states = new Map(group.states.map((state) => [state.id, state]));
      const seen = new Set<string>();
      for (const closure of decision.closures) {
        const target = states.get(closure.targetId);
        const replacement = states.get(closure.replacementId);
        const later = target && replacement && (replacement.sourceOrdinal != null && target.sourceOrdinal != null
          ? replacement.sourceOrdinal > target.sourceOrdinal : replacement.createdRevision > target.createdRevision);
        if (!target || !replacement || target.id === replacement.id || target.immutable || !replacement.evidenceMessageIds.length || !later || seen.has(target.id)) {
          warnings.push(`Skipped unsafe final ledger closure in ${decision.itemRef}`);
          continue;
        }
        const current=db.prepare(`SELECT * FROM ${group.kind === "world_fact" ? "assertions" : "beliefs"} WHERE id=? AND chat_id=?`).get(target.id,job.chatId) as any;
        if(!current || !canAutomaticallyChange(db,job.chatId,current,replacement.evidenceMessageIds.map(messageId=>({messageId})))) {
          warnings.push(`Skipped protected final ledger closure in ${decision.itemRef}`); continue;
        }
        seen.add(target.id);
        const closureEvidence=transitionEvidenceJson(db,job.chatId,replacement.evidenceMessageIds.map(messageId=>({messageId})),{successorId:replacement.id});
        if (group.kind === "world_fact") db.prepare(`UPDATE assertions SET valid_to_revision=?,valid_to_ordinal=?,automatic_closure_evidence_json=?
          WHERE id=? AND chat_id=? AND valid_to_revision IS NULL`).run(revision, replacement.sourceOrdinal == null ? null : Math.max(0, replacement.sourceOrdinal - 1), closureEvidence, target.id, job.chatId);
        else db.prepare(`UPDATE beliefs SET active=0,status='superseded',superseded_by=?,valid_to_ordinal=?,automatic_closure_evidence_json=?
          WHERE id=? AND chat_id=? AND active=1 AND status='active'`).run(replacement.id, replacement.sourceOrdinal == null ? null : Math.max(0, replacement.sourceOrdinal - 1), closureEvidence, target.id, job.chatId);
      }
    }
    const row = db.prepare("SELECT payload_json FROM jobs WHERE id=? AND lease_owner=? AND status='leased'").get(job.id, workerId) as { payload_json: string } | undefined;
    if (!row) throw new Error("Lease not found while completing final ledger check");
    const payload = JSON.parse(row.payload_json || "{}");
    recordLedgerInputs(db, job.chatId, payload, 'succeeded');
    payload.pipelineStage = "complete";
    payload.pipelineStageUpdatedAt = Date.now();
    db.prepare("UPDATE jobs SET status='done',payload_json=?,lease_owner=NULL,leased_until=NULL,last_error=NULL,updated_at=? WHERE id=?")
      .run(JSON.stringify(payload), Date.now(), job.id);
  })();
  return { chatId: job.chatId, warnings, pendingReconciliations: 0 };
}
