import { randomUUID } from "node:crypto";
import { canAutomaticallyChange } from "./user-corrections.js";
import {
  INITIAL_AFFECTION_LEVELS, INITIAL_INTENSITY_LEVELS, INITIAL_INTIMACY_LEVELS, INITIAL_TRUST_LEVELS,
  type InitialCalibrationOrigin, type InitialCalibrationResult, type InitialCalibrationStatus, type ResolvedSetupProjection,
} from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { normalizeEntityName } from "./entities.js";
import { RELATIONSHIP_AXES } from "./relationship-scale.js";
import { storeSetupRecognition, updateSetupRecognition } from "./setup-recognition.js";
import { aliasRemovalGuard, deletionGuard, rememberAliasReplacement } from "./user-deletions.js";

export interface InitialCalibrationView {
  status: InitialCalibrationStatus;
  origin?: InitialCalibrationOrigin;
  fingerprint?: string;
  confirmationRequired: boolean;
  locked: boolean;
  lastError?: string;
  confirmedAt?: number;
  updatedAt?: number;
}

export function initialCalibrationView(db: RcmDatabase, chatId: string): InitialCalibrationView {
  const row = db.prepare(`SELECT status,origin,setup_fingerprint AS fingerprint,confirmation_required AS confirmationRequired,
    locked_at AS lockedAt,last_error AS lastError,confirmed_at AS confirmedAt,updated_at AS updatedAt
    FROM initial_calibrations WHERE chat_id=?`).get(chatId) as Record<string, any> | undefined;
  if (!row) return { status: "unseeded", confirmationRequired: false, locked: false };
  return {
    status: row.status,
    origin: row.origin,
    fingerprint: row.fingerprint ?? undefined,
    confirmationRequired: row.confirmationRequired === 1,
    locked: row.lockedAt != null,
    lastError: row.lastError ?? undefined,
    confirmedAt: row.confirmedAt ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
  };
}

export function initialCalibrationLedger(db: RcmDatabase, chatId: string): InitialCalibrationView & { entities: Array<Record<string, unknown>>; relationships: Array<Record<string, unknown>>; socialKnowledge: Array<Record<string, unknown>> } {
  const entities = (db.prepare(`SELECT id,entity_key AS key,name AS internalName,display_name AS displayName,type,origin,
    setup_prominence AS prominence,source_json AS evidence,user_managed AS userManaged
    FROM entities WHERE chat_id=? AND (origin IN ('setup','manual') OR user_managed=1)
    ORDER BY CASE setup_prominence WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END,display_name`).all(chatId) as Array<Record<string, any>>)
    .map((row) => ({ ...row, aliases: (db.prepare("SELECT alias FROM aliases WHERE entity_id=? ORDER BY alias").all(row.id) as Array<{ alias: string }>).map((item) => item.alias), evidence: JSON.parse(row.evidence || "[]"), userManaged: row.userManaged === 1 }));
  const displayNames = new Map(entities.map((entity) => [String((entity as Record<string, unknown>).internalName), String((entity as Record<string, unknown>).displayName)]));
  const relationships = (db.prepare(`SELECT id,from_entity AS "from",to_entity AS "to",projection_axes_json AS axes,
    initial_summary AS summary,source_quote AS sourceQuote,evidence_json AS evidence,active,user_managed AS userManaged
    FROM relationship_baselines WHERE chat_id=? AND source='setup' ORDER BY from_entity,to_entity`).all(chatId) as Array<Record<string, any>>)
    .map((row) => ({ ...row, from: displayNames.get(row.from) ?? row.from, to: displayNames.get(row.to) ?? row.to,
      axes: JSON.parse(row.axes || "{}"), evidence: JSON.parse(row.evidence || "[]"), active: row.active === 1, userManaged: row.userManaged === 1 }));
  const socialKnowledge = db.prepare(`SELECT s.holder,s.subject,s.level,m.content AS description
    FROM social_knowledge_events s JOIN memories m ON m.id=s.source_memory_id
    WHERE s.chat_id=? AND is_initial_calibration_memory(m.memory_key) ORDER BY s.holder,s.subject`).all(chatId) as Array<Record<string,unknown>>;
  return { ...initialCalibrationView(db, chatId), entities, relationships, socialKnowledge };
}

export function upsertInitialEntity(
  db: RcmDatabase,
  chatId: string,
  input: { id?: string; displayName: string; aliases?: string[]; prominence?: "primary" | "supporting" | "reference" },
): string {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("Display name is required");
  return db.transaction(() => {
    const timestamp = now();
    const existing = input.id ? db.prepare("SELECT id,name,display_name FROM entities WHERE id=? AND chat_id=?").get(input.id, chatId) as { id: string; name: string; display_name: string } | undefined : undefined;
    if (input.id && !existing) throw new Error("Entity not found");
    const id = existing?.id ?? randomUUID();
    const internalName = existing?.name ?? displayName;
    if (existing) db.prepare("UPDATE entities SET display_name=?,setup_prominence=?,user_managed=1 WHERE id=? AND chat_id=?")
      .run(displayName, input.prominence ?? "supporting", id, chatId);
    else db.prepare(`INSERT INTO entities(id,chat_id,entity_key,name,display_name,type,origin,setup_prominence,source_json,user_managed,created_at)
      VALUES(?,?,?,?,?,'person','manual',?,'[]',1,?)`).run(id, chatId, `manual_${id}`, internalName, displayName, input.prominence ?? "supporting", timestamp);
    const removed = aliasRemovalGuard(db, chatId);
    const previousDisplay = existing?.display_name && existing.display_name !== displayName && !removed(id, existing.display_name) ? [existing.display_name] : [];
    const aliases = [...new Set([...(input.aliases ?? []), ...previousDisplay].map(value => value.trim()).filter(Boolean))];
    rememberAliasReplacement(db, chatId, id, aliases);
    db.prepare("DELETE FROM aliases WHERE entity_id=?").run(id);
    const insert = db.prepare("INSERT OR IGNORE INTO aliases(entity_id,alias,normalized) VALUES(?,?,?)");
    for (const alias of aliases) insert.run(id, alias, normalizeEntityName(alias));
    return id;
  })();
}

export function deleteInitialEntity(db: RcmDatabase, chatId: string, id: string): boolean {
  const calibration = db.prepare("SELECT locked_at FROM initial_calibrations WHERE chat_id=?").get(chatId) as { locked_at: number | null } | undefined;
  if (calibration?.locked_at != null) throw new Error("Initial setup identities cannot be deleted after the first transcript memory");
  const entity = db.prepare("SELECT id,name FROM entities WHERE id=? AND chat_id=? AND origin IN ('setup','manual')").get(id, chatId) as { id: string; name: string } | undefined;
  if (!entity) return false;
  return db.transaction(() => {
    updateSetupRecognition(db, chatId, "delete", entity.name);
    db.prepare("DELETE FROM relationship_projections WHERE chat_id=? AND projection_origin='setup' AND (from_entity=? OR to_entity=?)")
      .run(chatId, entity.name, entity.name);
    db.prepare("DELETE FROM relationship_baselines WHERE chat_id=? AND source='setup' AND (from_entity=? OR to_entity=?)").run(chatId, entity.name, entity.name);
    return db.prepare("DELETE FROM entities WHERE id=? AND chat_id=?").run(id, chatId).changes === 1;
  })();
}

export function updateInitialRelationship(
  db: RcmDatabase,
  chatId: string,
  id: string,
  input: { axes: Record<string, string>; summary: string },
): void {
  const calibration = db.prepare("SELECT locked_at FROM initial_calibrations WHERE chat_id=?").get(chatId) as { locked_at: number | null } | undefined;
  if (calibration?.locked_at != null) throw new Error("Initial relationship axes are locked after the first transcript memory");
  const row = db.prepare("SELECT id FROM relationship_baselines WHERE id=? AND chat_id=? AND source='setup'").get(id, chatId);
  if (!row) throw new Error("Initial relationship baseline not found");
  const allowed: Record<string, readonly string[]> = {
    affection: INITIAL_AFFECTION_LEVELS, trust: INITIAL_TRUST_LEVELS, intimacy: INITIAL_INTIMACY_LEVELS,
    fear: INITIAL_INTENSITY_LEVELS, jealousy: INITIAL_INTENSITY_LEVELS, hostility: INITIAL_INTENSITY_LEVELS,
  };
  const axes = Object.fromEntries(RELATIONSHIP_AXES.map((axis) => {
    const value = input.axes[axis] ?? "unknown";
    if (!allowed[axis]!.includes(value)) throw new Error(`Invalid ${axis} value`);
    return [axis, value];
  }));
  const summary = input.summary.trim();
  if (!summary) throw new Error("Initial relationship summary is required");
  db.prepare("UPDATE relationship_baselines SET projection_axes_json=?,initial_summary=?,user_managed=1 WHERE id=? AND chat_id=?")
    .run(JSON.stringify(axes), summary, id, chatId);
  const revision = Number((db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision?: number } | undefined)?.revision ?? 0);
  db.prepare(`UPDATE relationship_projections SET axes_json=?,summary=?,updated_revision=?,updated_at=?
    WHERE chat_id=? AND from_entity=(SELECT from_entity FROM relationship_baselines WHERE id=?)
      AND to_entity=(SELECT to_entity FROM relationship_baselines WHERE id=?) AND projection_origin='setup'`)
    .run(JSON.stringify(projectionAxes(axes)), summary, revision, now(), chatId, id, id);
}

const projectionAxes = (axes: Record<string, string>): Record<string, { level: string; trend: "unclear" }> =>
  Object.fromEntries(RELATIONSHIP_AXES.map((axis) => [axis, { level: axes[axis] ?? "unknown", trend: "unclear" }]));

export function materializeInitialRelationshipProjections(db: RcmDatabase, chatId: string): number {
  const revision = Number((db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision?: number } | undefined)?.revision ?? 0);
  const rows = db.prepare(`SELECT from_entity,to_entity,projection_axes_json,initial_summary FROM relationship_baselines
    WHERE chat_id=? AND source='setup' AND active=1 AND projection_axes_json IS NOT NULL AND initial_summary IS NOT NULL`).all(chatId) as
    Array<{ from_entity: string; to_entity: string; projection_axes_json: string; initial_summary: string }>;
  const insert = db.prepare(`INSERT INTO relationship_projections(chat_id,from_entity,to_entity,axes_json,summary,active_tensions_json,
    basis_event_ids_json,overrides_json,event_cursor_json,projection_origin,stale,updated_revision,updated_at)
    VALUES(?,?,?,?,?,'[]','[]','{}','{"revision":-1,"eventIds":[]}','setup',0,?,?)
    ON CONFLICT(chat_id,from_entity,to_entity) DO UPDATE SET
      axes_json=excluded.axes_json,summary=excluded.summary,active_tensions_json='[]',basis_event_ids_json='[]',
      event_cursor_json='{"revision":-1,"eventIds":[]}',stale=0,updated_revision=excluded.updated_revision,updated_at=excluded.updated_at
    WHERE relationship_projections.projection_origin='setup'`);
  return db.transaction(() => rows.reduce((count, row) => {
    const current=db.prepare("SELECT * FROM relationship_projections WHERE chat_id=? AND from_entity=? AND to_entity=?").get(chatId,row.from_entity,row.to_entity) as Record<string,any>|undefined;
    if(current && !canAutomaticallyChange(db,chatId,current,[])) return count;
    return count + insert.run(
      chatId, row.from_entity, row.to_entity, JSON.stringify(projectionAxes(JSON.parse(row.projection_axes_json))), row.initial_summary, revision, now(),
    ).changes;
  }, 0))();
}

export function resolveInitialCalibrationConfirmation(db: RcmDatabase, chatId: string, action: "confirm" | "skip"): { forceBackfill: boolean; extractionReview?: boolean; backfillRunId?: string } {
  const row = db.prepare(`SELECT status,pending_force_backfill AS forceBackfill,pending_extraction_review AS extractionReview
    FROM initial_calibrations WHERE chat_id=?`).get(chatId) as { status: string; forceBackfill: number; extractionReview: number | null } | undefined;
  if (!row) throw new Error("Initial calibration not found");
  if (action === "confirm" && row.status !== "awaiting_confirmation") throw new Error("Initial calibration is not awaiting confirmation");
  db.transaction(() => {
    if (action === "skip") {
      updateSetupRecognition(db, chatId, "delete");
      db.prepare("DELETE FROM relationship_projections WHERE chat_id=? AND projection_origin='setup'").run(chatId);
      db.prepare("DELETE FROM relationship_baselines WHERE chat_id=? AND source='setup'").run(chatId);
      db.prepare("DELETE FROM entities WHERE chat_id=? AND origin='setup' AND user_managed=0").run(chatId);
    }
    if (action === "confirm") {
      materializeInitialRelationshipProjections(db, chatId);
      updateSetupRecognition(db, chatId, "activate");
    }
    db.prepare("UPDATE initial_calibrations SET status=?,confirmed_at=?,setup_json=NULL,last_error=NULL,updated_at=? WHERE chat_id=?")
      .run(action === "confirm" ? "ready" : "skipped", now(), now(), chatId);
  })();
  const latestJob = db.prepare("SELECT payload_json FROM jobs WHERE chat_id=? AND type='initial_calibration' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(chatId) as { payload_json: string } | undefined;
  let backfillRunId: string | undefined;
  try { backfillRunId = String((JSON.parse(latestJob?.payload_json ?? "{}") as { backfillRunId?: unknown }).backfillRunId ?? "") || undefined; }
  catch { /* a malformed historical row cannot block confirmation */ }
  return { forceBackfill: row.forceBackfill === 1, ...(row.extractionReview === null ? {} : { extractionReview: row.extractionReview === 1 }), ...(backfillRunId ? { backfillRunId } : {}) };
}

export function initialCalibrationRetryInput(db: RcmDatabase, chatId: string): { projection: ResolvedSetupProjection; identityHints: Record<string, unknown>; backfillRunId?: string } {
  const row = db.prepare("SELECT setup_json FROM initial_calibrations WHERE chat_id=?").get(chatId) as { setup_json: string | null } | undefined;
  if (!row?.setup_json) throw new Error("Rendered setup is unavailable; open the chat once before retrying");
  const previous = db.prepare("SELECT payload_json FROM jobs WHERE chat_id=? AND type='initial_calibration' ORDER BY created_at DESC LIMIT 1").get(chatId) as { payload_json: string } | undefined;
  let identityHints: Record<string, unknown> = {};
  let backfillRunId: string | undefined;
  if (previous) {
    try {
      const payload = JSON.parse(previous.payload_json) as { identityHints?: unknown; backfillRunId?: unknown };
      if (payload.identityHints && typeof payload.identityHints === "object" && !Array.isArray(payload.identityHints)) identityHints = payload.identityHints as Record<string, unknown>;
      backfillRunId = String(payload.backfillRunId ?? "") || undefined;
    } catch { /* the persisted setup remains sufficient for a retry */ }
  }
  return { projection: JSON.parse(row.setup_json) as ResolvedSetupProjection, identityHints, ...(backfillRunId ? { backfillRunId } : {}) };
}

export function clearInitialCalibrationDraft(db: RcmDatabase, chatId: string): void {
  const row = db.prepare("SELECT status,locked_at FROM initial_calibrations WHERE chat_id=?").get(chatId) as { status: string; locked_at: number | null } | undefined;
  if (!row || !["awaiting_confirmation", "failed"].includes(row.status)) throw new Error("Initial setup is not replaceable");
  if (row.locked_at != null) throw new Error("Initial setup is locked");
  db.transaction(() => {
    db.prepare("DELETE FROM relationship_baselines WHERE chat_id=? AND source='setup'").run(chatId);
    updateSetupRecognition(db, chatId, "delete");
    db.prepare("DELETE FROM entities WHERE chat_id=? AND origin IN ('setup','manual')").run(chatId);
    db.prepare("DELETE FROM relationship_projections WHERE chat_id=? AND projection_origin='setup'").run(chatId);
  })();
}

export function beginInitialCalibration(
  db: RcmDatabase,
  chatId: string,
  origin: InitialCalibrationOrigin,
  projection: ResolvedSetupProjection | undefined,
  options: { confirmationRequired?: boolean; forceBackfill?: boolean; extractionReview?: boolean } = {},
): InitialCalibrationView {
  const existing = initialCalibrationView(db, chatId);
  if (!["unseeded", "awaiting_setup", "failed"].includes(existing.status)) return existing;
  const timestamp = now();
  const status = projection ? "unseeded" : "awaiting_setup";
  db.prepare(`INSERT INTO initial_calibrations(chat_id,status,origin,setup_fingerprint,confirmation_required,setup_json,pending_force_backfill,pending_extraction_review,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET
      status=excluded.status,origin=excluded.origin,setup_fingerprint=COALESCE(excluded.setup_fingerprint,initial_calibrations.setup_fingerprint),
      confirmation_required=excluded.confirmation_required,setup_json=COALESCE(excluded.setup_json,initial_calibrations.setup_json),
      pending_force_backfill=MAX(initial_calibrations.pending_force_backfill,excluded.pending_force_backfill),
      pending_extraction_review=COALESCE(excluded.pending_extraction_review,initial_calibrations.pending_extraction_review),
      last_error=NULL,updated_at=excluded.updated_at`).run(
    chatId, status, origin, projection?.fingerprint ?? null, options.confirmationRequired ? 1 : 0,
    projection ? JSON.stringify(projection) : null, options.forceBackfill ? 1 : 0,
    options.extractionReview === undefined ? null : options.extractionReview ? 1 : 0, timestamp, timestamp,
  );
  return initialCalibrationView(db, chatId);
}

export function calibrationBlocksExtraction(db: RcmDatabase, chatId: string): boolean {
  const row = db.prepare("SELECT status,confirmation_required FROM initial_calibrations WHERE chat_id=?").get(chatId) as { status: string; confirmation_required: number } | undefined;
  if (!row) return false;
  if (["awaiting_setup", "queued", "awaiting_confirmation"].includes(row.status)) return true;
  return row.status === "failed" && row.confirmation_required === 1;
}

function exactSlice(source: string, candidate: string): string | undefined {
  const sought = candidate.trim();
  if (!sought) return undefined;
  const index = source.toLocaleLowerCase().indexOf(sought.toLocaleLowerCase());
  if (index < 0) return undefined;
  const word = /[\p{L}\p{N}_]/u;
  if (word.test(sought[0] ?? "") && word.test(source[index - 1] ?? "")) return undefined;
  if (word.test(sought.at(-1) ?? "") && word.test(source[index + sought.length] ?? "")) return undefined;
  return source.slice(index, index + sought.length);
}

export function normalizeAndValidateSetupEvidence(
  projection: ResolvedSetupProjection,
  result: Omit<InitialCalibrationResult, "socialKnowledge"> & Partial<Pick<InitialCalibrationResult, "socialKnowledge">>,
  identityHints: { hostCharacterName?: string; userPersonaName?: string } = {},
): InitialCalibrationResult {
  const normalized: InitialCalibrationResult = {
    socialKnowledge: (result.socialKnowledge ?? []).map(item => ({...item, evidence: item.evidence.map(e => ({...e}))})),
    entities: result.entities.map((entity) => ({ ...entity, aliases: [...entity.aliases], evidence: entity.evidence.map((item) => ({ ...item })) })),
    relationships: result.relationships.map((relationship) => ({
      ...relationship, axes: { ...relationship.axes }, evidence: relationship.evidence.map((item) => ({ ...item })),
    })),
  };
  const issues: string[] = [];
  const anchorNames = [identityHints.hostCharacterName, identityHints.userPersonaName].map((value) => normalizeEntityName(value ?? "")).filter(Boolean);
  const keys = new Set<string>();
  const relationshipKeys = new Set<string>();
  const relocateExactQuote = (item: { sourceIndex: number; quote: string }): { sourceIndex: number; quote: string } | undefined => {
    const preferred = projection.messages[item.sourceIndex]?.content;
    if (preferred?.includes(item.quote)) return item;
    const sourceIndex = projection.messages.findIndex((message) => message.content.includes(item.quote));
    return sourceIndex < 0 ? undefined : { sourceIndex, quote: item.quote };
  };
  const entityNameEvidence = (entity: InitialCalibrationResult["entities"][number], preferredIndices: number[]): { sourceIndex: number; quote: string } | undefined => {
    const candidates = [entity.displayName, ...entity.aliases.filter(Boolean).sort((left, right) => right.length - left.length)].filter(Boolean);
    const indices = [...new Set([...preferredIndices, ...projection.messages.map((_, index) => index)])];
    for (const sourceIndex of indices) {
      const source = projection.messages[sourceIndex]?.content;
      if (!source) continue;
      for (const candidate of candidates) {
        const quote = exactSlice(source, candidate);
        if (quote) return { sourceIndex, quote };
      }
    }
    return undefined;
  };
  for (const entity of normalized.entities) {
    if (keys.has(entity.key)) issues.push(`duplicate entity key ${entity.key}`);
    keys.add(entity.key);
    const names = [entity.displayName, ...entity.aliases].map(normalizeEntityName);
    const exact = entity.evidence.map(relocateExactQuote).filter((item): item is { sourceIndex: number; quote: string } => Boolean(item));
    if (exact.length) entity.evidence = exact;
    else {
      const repaired = entityNameEvidence(entity, entity.evidence.map((item) => item.sourceIndex));
      if (repaired) entity.evidence = [repaired];
      else if (!anchorNames.some((anchor) => names.includes(anchor))) issues.push(`entity ${entity.key} has no exact setup identity evidence`);
      else entity.evidence = [];
    }
  }
  for (const relationship of normalized.relationships) {
    const pairKey = `${relationship.fromKey}\0${relationship.toKey}`;
    if (relationshipKeys.has(pairKey)) issues.push(`duplicate relationship ${relationship.fromKey}->${relationship.toKey}`);
    relationshipKeys.add(pairKey);
    if (!keys.has(relationship.fromKey) || !keys.has(relationship.toKey)) issues.push(`relationship ${relationship.fromKey}->${relationship.toKey} cites an unknown entity key`);
    if (relationship.fromKey === relationship.toKey) issues.push(`relationship ${relationship.fromKey}->${relationship.toKey} is self-directed`);
    if (Object.values(relationship.axes).every((value) => value === "unknown")) issues.push(`relationship ${relationship.fromKey}->${relationship.toKey} has no known setup axis`);
    const exact = relationship.evidence.map(relocateExactQuote).filter((item): item is { sourceIndex: number; quote: string } => Boolean(item));
    if (exact.length !== relationship.evidence.length) issues.push(`relationship ${relationship.fromKey}->${relationship.toKey} has non-verbatim setup evidence`);
    relationship.evidence = exact;
  }
  const recognitionKeys = new Set<string>();
  for (const item of normalized.socialKnowledge) {
    const key = `${item.holderKey}\0${item.subjectKey}`;
    if (recognitionKeys.has(key) || item.holderKey === item.subjectKey || !keys.has(item.holderKey) || !keys.has(item.subjectKey)) issues.push("Invalid or duplicate setup recognition pair");
    recognitionKeys.add(key);
    const exact = item.evidence.map(relocateExactQuote).filter((e): e is {sourceIndex:number;quote:string} => Boolean(e));
    if (!exact.length || exact.length !== item.evidence.length) issues.push("Setup recognition has non-verbatim evidence");
    item.evidence = exact;
  }
  if (issues.length) throw new Error(`Initial calibration evidence validation failed: ${issues.slice(0, 8).join("; ")}${issues.length > 8 ? `; +${issues.length - 8} more` : ""}`);
  return normalized;
}

export function completeInitialCalibrationJob(
  db: RcmDatabase,
  jobId: string,
  workerId: string,
  result: Omit<InitialCalibrationResult, "socialKnowledge"> & Partial<Pick<InitialCalibrationResult, "socialKnowledge">>,
): { chatId: string; warnings: string[]; pendingReconciliations: number } {
  const job = db.prepare("SELECT chat_id,payload_json FROM jobs WHERE id=? AND lease_owner=? AND status='leased' AND type='initial_calibration'").get(jobId, workerId) as { chat_id: string; payload_json: string } | undefined;
  if (!job) throw Object.assign(new Error("Lease not found"), { code: "LEASE_NOT_FOUND" });
  const payload = JSON.parse(job.payload_json) as { resolvedSetup?: ResolvedSetupProjection; identityHints?: { hostCharacterName?: string; userPersonaName?: string }; [key: string]: unknown };
  if (!payload.resolvedSetup) throw new Error("Resolved setup unavailable");
  const validatedResult = normalizeAndValidateSetupEvidence(payload.resolvedSetup, result, payload.identityHints);
  const timestamp = now();
  const entities = [...validatedResult.entities];
  const addAnchor = (key: string, displayName: string | undefined, role: "character" | "persona"): void => {
    const name = displayName?.trim();
    if (!name) return;
    const matched = entities.find((entity) => [entity.displayName, ...entity.aliases].some((value) => normalizeEntityName(value) === normalizeEntityName(name)));
    if (matched) {
      matched.role = role;
      matched.prominence = "primary";
      if (!matched.aliases.some((alias) => normalizeEntityName(alias) === normalizeEntityName(name)) && normalizeEntityName(matched.displayName) !== normalizeEntityName(name)) matched.aliases.push(name);
    }
  };
  addAnchor("host_character", payload.identityHints?.hostCharacterName, "character");
  addAnchor("user_persona", payload.identityHints?.userPersonaName, "persona");
  const byKey = new Map<string, { id: string; name: string }>();
  const calibration = db.prepare("SELECT confirmation_required FROM initial_calibrations WHERE chat_id=?").get(job.chat_id) as { confirmation_required: number } | undefined;
  const deleted = deletionGuard(db, job.chat_id);
  const removedAlias = aliasRemovalGuard(db, job.chat_id);
  db.transaction(() => {
    for (const entity of entities) {
      if (deleted("entity", [entity.key, entity.displayName, ...entity.aliases].map(normalizeEntityName))) continue;
      const existing = db.prepare("SELECT id,name FROM entities WHERE chat_id=? AND entity_key=?").get(job.chat_id, entity.key) as { id: string; name: string } | undefined;
      const id = existing?.id ?? randomUUID();
      const canonicalName = existing?.name ?? entity.displayName;
      db.prepare(`INSERT INTO entities(id,chat_id,entity_key,name,display_name,type,origin,setup_prominence,source_json,user_managed,created_at)
        VALUES(?,?,?,?,?,?, 'setup',?,?,0,?) ON CONFLICT(chat_id,entity_key) DO UPDATE SET
        display_name=CASE WHEN entities.user_managed=1 THEN entities.display_name ELSE excluded.display_name END,
        type=excluded.type,origin=CASE WHEN entities.origin='manual' THEN entities.origin ELSE 'setup' END,
        setup_prominence=excluded.setup_prominence,source_json=excluded.source_json`).run(
        id, job.chat_id, entity.key, canonicalName, entity.displayName, entity.role === "npc" ? "person" : "character",
        entity.prominence, JSON.stringify(entity.evidence), timestamp,
      );
      const stored = db.prepare("SELECT id,name FROM entities WHERE chat_id=? AND entity_key=?").get(job.chat_id, entity.key) as { id: string; name: string };
      byKey.set(entity.key, stored);
      const insertAlias = db.prepare("INSERT OR IGNORE INTO aliases(entity_id,alias,normalized) VALUES(?,?,?)");
      for (const alias of [entity.displayName, ...entity.aliases]) if (!removedAlias(stored.id, alias)) insertAlias.run(stored.id, alias, normalizeEntityName(alias));
    }
    for (const relationship of validatedResult.relationships) {
      const from = byKey.get(relationship.fromKey);
      const to = byKey.get(relationship.toKey);
      if (!from || !to || from.id === to.id) continue;
      const knownAxes = RELATIONSHIP_AXES.filter((axis) => relationship.axes[axis] !== "unknown");
      if (!knownAxes.length) continue;
      const quote = relationship.evidence[0]?.quote ?? null;
      db.prepare(`INSERT INTO relationship_baselines(id,chat_id,from_entity,to_entity,qualitative_json,known_axes_json,reason,source,
        source_quote,evidence_json,setup_fingerprint,projection_axes_json,initial_summary,user_managed,active,created_revision,created_at)
        VALUES(?,?,?,?,'{}',?,?,'setup',?,?,?,?,?,0,1,0,?) ON CONFLICT(chat_id,from_entity,to_entity) DO UPDATE SET
        qualitative_json='{}',known_axes_json=excluded.known_axes_json,reason=excluded.reason,source='setup',
        source_quote=excluded.source_quote,evidence_json=excluded.evidence_json,setup_fingerprint=excluded.setup_fingerprint,
        projection_axes_json=CASE WHEN relationship_baselines.user_managed=1 THEN relationship_baselines.projection_axes_json ELSE excluded.projection_axes_json END,
        initial_summary=CASE WHEN relationship_baselines.user_managed=1 THEN relationship_baselines.initial_summary ELSE excluded.initial_summary END,
        active=1`).run(
        randomUUID(), job.chat_id, from.name, to.name, JSON.stringify(knownAxes), relationship.summary,
        quote, JSON.stringify(relationship.evidence), payload.resolvedSetup!.fingerprint, JSON.stringify(relationship.axes), relationship.summary, timestamp,
      );
    }
    const status = calibration?.confirmation_required === 1 ? "awaiting_confirmation" : "ready";
    updateSetupRecognition(db, job.chat_id, "delete");
    storeSetupRecognition(db, job.chat_id, payload.resolvedSetup!.fingerprint, validatedResult.socialKnowledge.filter(item => byKey.has(item.holderKey) && byKey.has(item.subjectKey)), byKey, status === "ready");
    if (status === "ready") materializeInitialRelationshipProjections(db, job.chat_id);
    db.prepare("UPDATE initial_calibrations SET status=?,setup_fingerprint=?,setup_json=CASE WHEN ?='ready' THEN NULL ELSE setup_json END,last_error=NULL,updated_at=? WHERE chat_id=?")
      .run(status, payload.resolvedSetup!.fingerprint, status, timestamp, job.chat_id);
    const completedPayload = { ...payload, sourceMessageIds: [], setupFingerprint: payload.resolvedSetup!.fingerprint,
      identityHints: payload.identityHints ?? {}, resolvedSetup: undefined, pipelineStage: "complete", pipelineStageUpdatedAt: timestamp };
    db.prepare("UPDATE jobs SET status='done',payload_json=?,lease_owner=NULL,leased_until=NULL,last_error=NULL,updated_at=? WHERE id=?")
      .run(JSON.stringify(completedPayload), timestamp, jobId);
    db.prepare(`UPDATE jobs SET status='superseded',payload_json=?,lease_owner=NULL,leased_until=NULL,updated_at=?
      WHERE chat_id=? AND type='initial_calibration' AND id<>? AND status IN ('failed','queued')`)
      .run(JSON.stringify({ sourceMessageIds: [], setupFingerprint: payload.resolvedSetup!.fingerprint, identityHints: payload.identityHints ?? {} }), timestamp, job.chat_id, jobId);
  })();
  return { chatId: job.chat_id, warnings: [], pendingReconciliations: 0 };
}

export function markInitialCalibrationFailed(db: RcmDatabase, chatId: string, error: string): void {
  db.prepare("UPDATE initial_calibrations SET status='failed',last_error=?,updated_at=? WHERE chat_id=?").run(error.slice(0, 4_000), now(), chatId);
}

export function lockInitialCalibration(db: RcmDatabase, chatId: string): void {
  db.prepare("UPDATE initial_calibrations SET locked_at=COALESCE(locked_at,?),updated_at=? WHERE chat_id=? AND status IN ('ready','inherited')")
    .run(now(), now(), chatId);
}
