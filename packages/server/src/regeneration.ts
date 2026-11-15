import { markSourceDeleted } from "./albums.js";
import { assertChatUnlocked } from './upgrade-lock.js';
import { batchHasStoredMaterial } from './source-coverage.js';
import { CHAT_DERIVED_TABLES, deleteDerivedRows } from './derived-state.js';
import { detailAccessEditsKey, dialogueAccessIdentityKey } from './item-access.js';
import { userDeletionsKey, ledgerEditOriginsKey } from './user-deletions.js';
import { beginInitialCalibration } from './initial-calibration.js';
import { clearAuxiliaryInputs } from './auxiliary-input-cache.js';
import { retiredBatchSourceSql } from './source-processing.js';
import { episodeMemoryKeys, protectedLegacyEpisodeKeys } from "./regeneration-items.js";
import { remapExtractionMemoryKeys } from './extraction-memory-keys.js';
import { discardRegeneratedTextEdits, refreshDetailFts, memoryHasLineCorrectionSql } from './memory-detail-edits.js';
import { memoryPreferencesKey } from './memory-bookmarks.js';
import { diffRegenerationItems, regenerationItemsFingerprint, snapshotRegenerationItems } from './regeneration-items.js';
import { prepareRegenerationKeep, restoreRegenerationKeep } from './regeneration-keep.js';
import { applySeedResolutions } from './story-seeds.js';
import { refreshMemoryFts } from './memory-search-document.js';
import { syncManualCognition } from "./social-knowledge.js";
import { removedAliasesKey } from "./user-deletions.js";
import { lineageRevisionKey } from './lineage-revisions.js';
import { preserveRegenerationQuizzes, snapshotRegenerationQuizzes } from "./quiz.js";
import { createHash, randomUUID } from "node:crypto";
import { estimateTokens, ExtractionResultSchema, type ResolvedSetupProjection, type ExtractionResult } from "@rcm/shared";
import { estimateStoryRebuild } from './story-spine.js';
import { estimateRelationshipCalls } from './cost-estimates.js';
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { rewindAutomaticSuccessorsToCorrections } from "./user-corrections.js";
import { ingestExtraction, normalizeGeneratedCardShapes, snapshotOwnerOnlyState } from "./ingest.js";
import { fingerprintMatches, parseSourceFingerprintJson, sourceFingerprint } from "./source-fingerprint.js";
import { buildPrompt, enqueueExtractionJobs, enqueueInitialCalibration } from "./jobs.js";
import { createRegenerationShadow } from "./lineage.js";
import { flushRelationshipProjectionQueue, queueRelationshipProjection } from "./relationship-projections.js";
import { chatPacketBudgetKey, invalidateStorySpine, markStoryRangesInvalid, maybeEnqueueStorySpine } from "./story-spine.js";
import { currentMemoryPreview, rangeMessages, listSourceRanges, rangeTargetFingerprint, selectSourceRanges } from "./source-ranges.js";
import { atomFingerprint, type AtomRelationContext, type RecallAtomReference } from "./atom-relations.js";
import { loadItemAccess, NARRATOR_ARCHIVE_HOLDER, resolveItemAccess, visibleTo, pruneDetailAccessEdits } from "./item-access.js";

interface BatchRow {
  id: string;
  chat_id: string;
  source_message_ids_json: string;
  source_fingerprint_json: string;
  start_ordinal: number;
  end_ordinal: number;
  final_json: string | null;
}

interface RecallAtomIdentity extends RecallAtomReference { memoryKey: string; detailKey: string }

interface CanonicalRelationEndpoint {
  memoryKey: string;
  detailKey: string;
  fingerprint: string;
}

interface CanonicalRelationAccess {
  holder: string;
  basis: string;
  evidenceJson: string;
  confidence: number;
  sourceRevision: number;
  createdAt: number;
}

interface CanonicalRelationSnapshot {
  source: CanonicalRelationEndpoint;
  target: CanonicalRelationEndpoint;
  kind: string;
  confidence: number;
  evidenceJson: string;
  sourceBatchId: string | null;
  sourceStartOrdinal: number | null;
  sourceEndOrdinal: number | null;
  createdRevision: number;
  createdAt: number;
  access: CanonicalRelationAccess[];
}

function snapshotCanonicalRelations(
  db: RcmDatabase,
  chatId: string,
  sourceBatchIds: string[],
  includeUnbatched = false,
): CanonicalRelationSnapshot[] {
  const selected = new Set(sourceBatchIds);
  const rows = db.prepare(`SELECT r.id,r.kind,r.confidence,r.evidence_json,r.source_batch_id,r.source_start_ordinal,
      r.source_end_ordinal,r.created_revision,r.created_at,
      sm.memory_key source_memory_key,sd.detail_key source_detail_key,sd.kind source_kind,sd.text source_text,
      sd.epistemic source_epistemic,sd.evidence_json source_evidence_json,
      tm.memory_key target_memory_key,td.detail_key target_detail_key,td.kind target_kind,td.text target_text,
      td.epistemic target_epistemic,td.evidence_json target_evidence_json
    FROM atom_relations r
    JOIN memory_details sd ON sd.id=r.source_detail_id AND sd.chat_id=r.chat_id AND sd.active=1
    JOIN memories sm ON sm.id=sd.memory_id AND sm.chat_id=r.chat_id AND sm.active=1
    JOIN memory_details td ON td.id=r.target_detail_id AND td.chat_id=r.chat_id AND td.active=1
    JOIN memories tm ON tm.id=td.memory_id AND tm.chat_id=r.chat_id AND tm.active=1
    WHERE r.chat_id=? AND r.active=1`).all(chatId) as Array<Record<string, any>>;
  const access = db.prepare(`SELECT holder,basis,evidence_json,confidence,source_revision,created_at
    FROM item_access WHERE chat_id=? AND item_kind='atom_relation' AND item_id=? AND active=1 ORDER BY id`);
  return rows.filter((row) => row.source_batch_id === null ? includeUnbatched : selected.has(row.source_batch_id)).map((row) => ({
    source: {
      memoryKey: row.source_memory_key,
      detailKey: row.source_detail_key,
      fingerprint: atomFingerprint({ kind: row.source_kind, text: row.source_text, epistemic: row.source_epistemic, evidence_json: row.source_evidence_json }),
    },
    target: {
      memoryKey: row.target_memory_key,
      detailKey: row.target_detail_key,
      fingerprint: atomFingerprint({ kind: row.target_kind, text: row.target_text, epistemic: row.target_epistemic, evidence_json: row.target_evidence_json }),
    },
    kind: row.kind,
    confidence: row.confidence,
    evidenceJson: row.evidence_json,
    sourceBatchId: row.source_batch_id,
    sourceStartOrdinal: row.source_start_ordinal,
    sourceEndOrdinal: row.source_end_ordinal,
    createdRevision: row.created_revision,
    createdAt: row.created_at,
    access: (access.all(chatId, row.id) as Array<Record<string, any>>).map((grant) => ({
      holder: grant.holder,
      basis: grant.basis,
      evidenceJson: grant.evidence_json,
      confidence: grant.confidence,
      sourceRevision: grant.source_revision,
      createdAt: grant.created_at,
    })),
  }));
}

function evidenceMessagesExist(db: RcmDatabase, chatId: string, evidenceJson: string): boolean {
  let evidence: Array<{ messageId?: unknown }>;
  try { evidence = JSON.parse(evidenceJson) as Array<{ messageId?: unknown }>; } catch { return false; }
  if (!Array.isArray(evidence) || !evidence.length || evidence.some((item) => typeof item.messageId !== "string")) return false;
  const ids = [...new Set(evidence.map((item) => item.messageId as string))];
  const count = (db.prepare(`SELECT count(*) count FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))
    AND lifecycle IN ('committed','client_pruned') AND memory_excluded=0 AND host_visibility IN ('active','all_before') AND canonical_content IS NOT NULL`)
    .get(chatId, JSON.stringify(ids)) as { count: number }).count;
  return count === ids.length;
}

function restoreCanonicalRelations(
  db: RcmDatabase,
  chatId: string,
  snapshots: CanonicalRelationSnapshot[],
  batchMap: Map<string, string>,
): string[] {
  const warnings: string[] = [];
  const readDetail = db.prepare(`SELECT d.id,d.kind,d.text,d.epistemic,d.evidence_json
    FROM memory_details d JOIN memories m ON m.id=d.memory_id AND m.chat_id=d.chat_id
    WHERE d.chat_id=? AND m.memory_key=? AND d.detail_key=? AND d.active=1 AND m.active=1`);
  const insertRelation = db.prepare(`INSERT INTO atom_relations(id,chat_id,source_detail_id,target_detail_id,kind,confidence,evidence_json,
    source_batch_id,source_start_ordinal,source_end_ordinal,created_revision,active,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)`);
  const insertAccess = db.prepare(`INSERT INTO item_access(id,chat_id,item_kind,item_id,holder,basis,evidence_json,confidence,active,source_revision,created_at)
    VALUES(?,?,'atom_relation',?,?,?,?,?,1,?,?)`);
  for (const [index, snapshot] of snapshots.entries()) {
    const source = readDetail.get(chatId, snapshot.source.memoryKey, snapshot.source.detailKey) as Record<string, any> | undefined;
    const target = readDetail.get(chatId, snapshot.target.memoryKey, snapshot.target.detailKey) as Record<string, any> | undefined;
    const sourceBatchId = snapshot.sourceBatchId === null ? null : batchMap.get(snapshot.sourceBatchId);
    if (!source || !target || source.id === target.id
      || atomFingerprint(source as any) !== snapshot.source.fingerprint
      || atomFingerprint(target as any) !== snapshot.target.fingerprint
      || (snapshot.sourceBatchId !== null && !sourceBatchId)
      || !evidenceMessagesExist(db, chatId, snapshot.evidenceJson)) {
      warnings.push(`canonical atom relation ${index}: endpoint, batch or evidence changed; relation omitted`);
      continue;
    }
    const endpointAccess = loadItemAccess(db, chatId, [{ kind: "detail", id: source.id }, { kind: "detail", id: target.id }]);
    const grants = snapshot.access.filter((grant) => grant.holder === NARRATOR_ARCHIVE_HOLDER || (
      evidenceMessagesExist(db, chatId, grant.evidenceJson)
      && visibleTo(resolveItemAccess(endpointAccess, "detail", source.id), grant.holder)
      && visibleTo(resolveItemAccess(endpointAccess, "detail", target.id), grant.holder)
    ));
    if (grants.length !== snapshot.access.length) warnings.push(`canonical atom relation ${index}: invalid access grants omitted`);
    const relationId = randomUUID();
    try {
      insertRelation.run(relationId, chatId, source.id, target.id, snapshot.kind, snapshot.confidence, snapshot.evidenceJson,
        sourceBatchId, snapshot.sourceStartOrdinal, snapshot.sourceEndOrdinal, snapshot.createdRevision, snapshot.createdAt);
    } catch {
      warnings.push(`canonical atom relation ${index}: duplicate or invalid relation omitted`);
      continue;
    }
    const effectiveGrants = grants.length ? grants : [{
      holder: NARRATOR_ARCHIVE_HOLDER,
      basis: "inferred",
      evidenceJson: snapshot.evidenceJson,
      confidence: snapshot.confidence,
      sourceRevision: snapshot.createdRevision,
      createdAt: snapshot.createdAt,
    }];
    for (const grant of effectiveGrants) insertAccess.run(randomUUID(), chatId, relationId, grant.holder, grant.basis,
      grant.evidenceJson, grant.confidence, grant.sourceRevision, grant.createdAt);
  }
  return warnings;
}

function snapshotRelationContext(db: RcmDatabase, chatId: string, jobId: string | null | undefined, sourceMessageIds: string[]): { sourceMessageIds: string[]; atoms: RecallAtomIdentity[] } {
  if (!jobId) return { sourceMessageIds, atoms: [] };
  const row = db.prepare("SELECT payload_json FROM jobs WHERE id=? AND chat_id=?").get(jobId, chatId) as { payload_json: string } | undefined;
  if (!row) return { sourceMessageIds, atoms: [] };
  let refs: RecallAtomReference[] = [];
  try { refs = (JSON.parse(row.payload_json) as { recallAtomRefs?: RecallAtomReference[] }).recallAtomRefs ?? []; } catch { return { sourceMessageIds, atoms: [] }; }
  const read = db.prepare(`SELECT d.id,d.kind,d.text,d.epistemic,d.evidence_json,d.detail_key,m.memory_key
    FROM memory_details d JOIN memories m ON m.id=d.memory_id AND m.chat_id=d.chat_id
    WHERE d.chat_id=? AND d.id=? AND d.active=1 AND m.active=1`);
  const atoms = refs.flatMap((ref): RecallAtomIdentity[] => {
    const detail = read.get(chatId, ref.detailId) as { id: string; kind: string; text: string; epistemic: string; evidence_json: string; detail_key: string; memory_key: string } | undefined;
    if (!detail || atomFingerprint(detail) !== ref.fingerprint) return [];
    return [{ ...ref, memoryKey: detail.memory_key, detailKey: detail.detail_key }];
  });
  return { sourceMessageIds, atoms };
}

function resolveRelationContext(db: RcmDatabase, chatId: string, snapshot: { sourceMessageIds: string[]; atoms: RecallAtomIdentity[] }): AtomRelationContext {
  const read = db.prepare(`SELECT d.id,d.kind,d.text,d.epistemic,d.evidence_json
    FROM memory_details d JOIN memories m ON m.id=d.memory_id AND m.chat_id=d.chat_id
    WHERE d.chat_id=? AND m.memory_key=? AND d.detail_key=? AND d.active=1 AND m.active=1`);
  const atomRefs = snapshot.atoms.flatMap((identity): RecallAtomReference[] => {
    const detail = read.get(chatId, identity.memoryKey, identity.detailKey) as { id: string; kind: string; text: string; epistemic: string; evidence_json: string } | undefined;
    if (!detail || atomFingerprint(detail) !== identity.fingerprint) return [];
    return [{ atomRef: identity.atomRef, detailId: detail.id, fingerprint: identity.fingerprint }];
  });
  return { sourceMessageIds: snapshot.sourceMessageIds, atomRefs };
}

function appendRelationWarnings(previewJson: string | null, warnings: string[]): string | null {
  if (!warnings.length) return previewJson;
  let preview: Record<string, unknown> = {};
  try { preview = previewJson ? JSON.parse(previewJson) as Record<string, unknown> : {}; } catch { /* retain warnings even if an old preview is malformed */ }
  return JSON.stringify({ ...preview, relationWarnings: [...new Set([...(Array.isArray(preview.relationWarnings) ? preview.relationWarnings.filter((item): item is string => typeof item === "string") : []), ...warnings])] });
}

function batch(db: RcmDatabase, chatId: string, batchId: string): BatchRow {
  const row = db.prepare(`SELECT id,chat_id,source_message_ids_json,source_fingerprint_json,start_ordinal,end_ordinal,final_json
    FROM extraction_batches WHERE id=? AND chat_id=? AND generation_id='active'`).get(batchId, chatId) as BatchRow | undefined;
  if (!row) throw Object.assign(new Error("Extraction batch not found"), { code: "BATCH_NOT_FOUND" });
  return row;
}

export function listExtractionBatches(db: RcmDatabase, chatId: string): Array<Record<string, unknown>> {
  return (db.prepare(`SELECT id,kind,start_ordinal AS startOrdinal,end_ordinal AS endOrdinal,status,
      source_message_ids_json AS sourceMessageIds,created_at AS createdAt,updated_at AS updatedAt
    FROM extraction_batches WHERE chat_id=? AND generation_id='active' ORDER BY start_ordinal DESC,created_at DESC`).all(chatId) as Array<Record<string, any>>)
    .map((row) => ({ ...row, sourceMessageIds: JSON.parse(row.sourceMessageIds || "[]") }));
}

export function startEpisodeRegeneration(db: RcmDatabase, chatId: string, batchId: string, review: boolean): { runId: string; jobId: string } {
  assertChatUnlocked(db,chatId);
  selectSourceRanges(db, chatId, [batchId]);
  const source = batch(db, chatId, batchId);
  const fingerprint = parseSourceFingerprintJson(source.source_fingerprint_json);
  if (!fingerprint || !fingerprintMatches(db, chatId, fingerprint)) throw Object.assign(new Error("Source messages changed; rebuild the batch selection"), { code: "SOURCE_CHANGED" });
  const ids = JSON.parse(source.source_message_ids_json) as string[];
  const chat = db.prepare("SELECT memory_language,include_user_messages,extraction_group_turns FROM chats WHERE id=?").get(chatId) as { memory_language: string; include_user_messages: number; extraction_group_turns: number };
  const runId = randomUUID();
  const jobId = randomUUID();
  const timestamp = now();
  db.transaction(() => {
    db.prepare(`INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at)
      VALUES(?,?,'extract','queued',?,0,?,?)`).run(jobId, chatId, JSON.stringify({
        sourceMessageIds: ids,
        sourceFingerprint: fingerprint,
        includeUserMessages: chat.include_user_messages !== 0,
        extractionGroupTurns: chat.extraction_group_turns,
        memoryLanguage: chat.memory_language,
        postExtractionReview: review,
        batchId,
        regenerationRunId: runId, trigger: 'regeneration',
      }), timestamp, timestamp);
    db.prepare(`INSERT INTO regeneration_runs(id,chat_id,mode,batch_id,job_id,source_fingerprint_json,post_extraction_review,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'queued',?,?)`).run(runId, chatId, "episode", batchId, jobId, source.source_fingerprint_json, review ? 1 : 0, timestamp, timestamp);
    db.prepare("UPDATE regeneration_runs SET preview_json=? WHERE id=?").run(JSON.stringify({
      beforeCurrentMemories: currentMemoryPreview(db, chatId, [batchId]), targetBatchIds: [batchId], targetFingerprint: rangeTargetFingerprint(db, chatId, [batchId]),
    }), runId);
  })();
  return { runId, jobId };
}

export function regenerationRun(db: RcmDatabase, chatId: string, runId: string): Record<string, unknown> {
  refreshCanonicalRegeneration(db, chatId, runId);
  const row = db.prepare(`SELECT id,mode,batch_id AS batchId,shadow_chat_id AS shadowChatId,job_id AS jobId,status,
    post_extraction_review AS postExtractionReview,preview_json AS preview,error,created_at AS createdAt,updated_at AS updatedAt
    FROM regeneration_runs WHERE id=? AND chat_id=?`).get(runId, chatId) as Record<string, any> | undefined;
  if (!row) throw Object.assign(new Error("Regeneration run not found"), { code: "RUN_NOT_FOUND" });
  return { ...row, postExtractionReview: Boolean(row.postExtractionReview), preview: row.preview ? JSON.parse(row.preview) : null };
}

export function listRegenerations(db: RcmDatabase, chatId: string): Array<Record<string, unknown>> {
  return (db.prepare("SELECT id FROM regeneration_runs WHERE chat_id=? AND status NOT IN ('applied','discarded') ORDER BY created_at DESC,id").all(chatId) as Array<{ id: string }>)
    .map((row) => regenerationRun(db, chatId, row.id));
}

function validateRegenerationTarget(db: RcmDatabase, chatId: string, runId: string): void {
  const row = db.prepare("SELECT preview_json FROM regeneration_runs WHERE chat_id=? AND id=?").get(chatId, runId) as { preview_json: string };
  const guard = JSON.parse(row.preview_json) as { targetBatchIds: string[]; targetFingerprint: string; canonicalStateFingerprint?: string; itemTargetFingerprint?: string };
  if (!Array.isArray(guard.targetBatchIds) || guard.targetFingerprint !== rangeTargetFingerprint(db, chatId, guard.targetBatchIds)
    || (guard.canonicalStateFingerprint !== undefined && guard.canonicalStateFingerprint !== canonicalStateFingerprint(db, chatId))
    || (guard.itemTargetFingerprint !== undefined && guard.itemTargetFingerprint !== regenerationItemsFingerprint(db, chatId))) {
    db.prepare("UPDATE regeneration_runs SET status='stale',error='Target memories or access changed',updated_at=? WHERE id=?").run(now(), runId);
    throw Object.assign(new Error("대상 기억이나 접근 권한이 바뀌어 이 후보를 적용할 수 없어"), { code: "TARGET_CHANGED" });
  }
  selectSourceRanges(db, chatId, guard.targetBatchIds);
}

function canonicalStateFingerprint(db: RcmDatabase, chatId: string): string {
  const tables = ['assertions','beliefs','promises','promise_events','relationship_events','relationship_baselines','physical_intimacy_milestones','social_knowledge_events'] as const;
  return createHash('sha256').update(JSON.stringify(tables.map((table) => db.prepare(`SELECT * FROM ${table} WHERE chat_id=? ORDER BY id`).all(chatId)))).digest('hex');
}

/** Shared shadow construction and source enqueue path for suffix and whole-chat replay. */
export function enqueueRegenerationShadow(db: RcmDatabase, chatId: string, shadowChatId: string, cutOrdinal: number,
  review: boolean, ids: string[], runId: string, upgradeContracts?: {event:string;state:string|null;resolvedSetup:ResolvedSetupProjection;identityHints:Record<string,unknown>}): number {
  createRegenerationShadow(db, chatId, shadowChatId, cutOrdinal, {preserveUserCorrections: upgradeContracts ? false : true});
  if (upgradeContracts) {
    // Keep only the frozen source range; protected/pending tail belongs to live processing later.
    db.prepare('DELETE FROM messages WHERE chat_id=? AND message_id NOT IN (SELECT value FROM json_each(?))').run(shadowChatId,JSON.stringify(ids));
    db.prepare('UPDATE chats SET post_extraction_review=0 WHERE id=?').run(shadowChatId);
    beginInitialCalibration(db,shadowChatId,'cold_start',upgradeContracts.resolvedSetup,{confirmationRequired:false,forceBackfill:true,extractionReview:false});
    enqueueInitialCalibration(db,shadowChatId,upgradeContracts.resolvedSetup,upgradeContracts.identityHints,runId);
    pinRegenerationJobs(db,shadowChatId,runId,upgradeContracts);
    return 1;
  }
  return enqueueRegenerationSources(db,shadowChatId,cutOrdinal,review,ids,runId);
}

/** Enqueue after calibration so grouping and prompt budgets see the fresh setup. */
export function enqueueRegenerationSources(db:RcmDatabase,shadowChatId:string,cutOrdinal:number,review:boolean,
  ids:string[],runId:string,upgradeContracts?:{event:string;state:string|null}):number {
  const chat = db.prepare("SELECT profile,include_user_messages,extraction_group_turns FROM chats WHERE id=?").get(shadowChatId) as { profile: "companion" | "simulation"; include_user_messages: number; extraction_group_turns: number };
  const queuedJobs = enqueueExtractionJobs(db, shadowChatId, chat.profile, true, chat.include_user_messages !== 0, chat.extraction_group_turns, "ledger", review, ids, upgradeContracts ? runId : undefined);
  pinRegenerationJobs(db,shadowChatId,runId,upgradeContracts);
  db.prepare("UPDATE extraction_batches SET generation_id=? WHERE chat_id=? AND generation_id='active' AND start_ordinal>=?").run(runId, shadowChatId, cutOrdinal);
  return queuedJobs;
}

export function pinRegenerationJobs(db:RcmDatabase,shadowChatId:string,runId:string,upgradeContracts?:{event:string;state:string|null}):void {
  const queued = db.prepare("SELECT id,payload_json FROM jobs WHERE chat_id=? AND status='queued'").all(shadowChatId) as Array<{ id: string; payload_json: string }>;
  for (const job of queued) {
    const payload = JSON.parse(job.payload_json);
    db.prepare("UPDATE jobs SET payload_json=? WHERE id=?").run(JSON.stringify({ ...payload, ...(upgradeContracts ? {upgradeRunId:runId,backfillRunId:runId,promptContract:upgradeContracts.event,stateContract:upgradeContracts.state,postExtractionReview:false} : {canonicalRegenerationRunId:runId}), trigger: 'regeneration' }), job.id);
  }
}

export function startCanonicalRegeneration(db: RcmDatabase, chatId: string, batchId: string, review: boolean): { runId: string; shadowChatId: string; queuedJobs: number } {
  assertChatUnlocked(db,chatId);
  const selected = canonicalRegenerationRanges(db, chatId, batchId);
  const source = batch(db, chatId, selected[0]!.id);
  preflightReplaySnapshots(db,chatId,source.start_ordinal);
  const selectedIds = selected.map((row) => row.id);
  const selectedMessages = new Set(selected.flatMap(row => row.sourceMessageIds));
  const ids = rangeMessages(db, chatId).filter(row => selectedMessages.has(row.id)).map(row => row.id);
  if (!ids.length) throw Object.assign(new Error("No active source messages remain from this batch"), { code: "SOURCE_CHANGED" });
  const fingerprint = sourceFingerprint(db, chatId, ids);
  const runId = randomUUID();
  const shadowChatId = `__rcm_regen__${runId}`;
  const timestamp = now();
  let queuedJobs = 0;
  db.transaction(() => {
    db.prepare(`INSERT INTO regeneration_runs(id,chat_id,mode,batch_id,shadow_chat_id,source_fingerprint_json,post_extraction_review,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'processing',?,?)`).run(runId, chatId, "canonical_suffix", source.id, shadowChatId, JSON.stringify(fingerprint), review ? 1 : 0, timestamp, timestamp);
    queuedJobs = enqueueRegenerationShadow(db,chatId,shadowChatId,source.start_ordinal,review,ids,runId);
    db.prepare("UPDATE regeneration_runs SET preview_json=? WHERE id=?").run(JSON.stringify({
      beforeCurrentMemories: currentMemoryPreview(db, chatId, selectedIds), beforeStates: currentStatePreview(db, chatId), targetBatchIds: selectedIds, targetFingerprint: rangeTargetFingerprint(db, chatId, selectedIds),
      canonicalStateFingerprint: canonicalStateFingerprint(db, chatId),
      itemTargetFingerprint: regenerationItemsFingerprint(db, chatId),
    }), runId);
  })();
  if (!queuedJobs) {
    db.prepare("UPDATE regeneration_runs SET status='failed',error='No extraction jobs were created',updated_at=? WHERE id=?").run(now(), runId);
    throw Object.assign(new Error("No extraction jobs were created"), { code: "NO_REGENERATION_WORK" });
  }
  return { runId, shadowChatId, queuedJobs };
}

function countResult(result: ExtractionResult): Record<string, number> {
  return {
    memories: result.memories.length,
    details: result.memories.reduce((sum, memory) => sum + (memory.details?.length ?? 0), 0),
    dialogues: result.memories.reduce((sum, memory) => sum + (memory.keyDialogues?.length ?? 0), 0),
    assertions: result.assertions.length,
    beliefs: result.beliefs.length,
    promises: result.promises.length,
    relationshipEvents: result.relationshipEvents?.length ?? 0,
    physicalMilestones: result.physicalIntimacy?.length ?? 0,
    socialKnowledge: result.socialKnowledge?.length ?? 0,
  };
}

function sumCounts(results: ExtractionResult[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const result of results) for (const [key, value] of Object.entries(countResult(result))) total[key] = (total[key] ?? 0) + value;
  return total;
}

function regenerationDiff(before: ExtractionResult[], after: ExtractionResult[]): Record<string, { added: number; removed: number }> {
  const left = sumCounts(before);
  const right = sumCounts(after);
  return Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].map((key) => [key, {
    added: Math.max(0, (right[key] ?? 0) - (left[key] ?? 0)),
    removed: Math.max(0, (left[key] ?? 0) - (right[key] ?? 0)),
  }]));
}

function refreshCanonicalRegeneration(db: RcmDatabase, chatId: string, runId: string): void {
  const run = db.prepare("SELECT shadow_chat_id,status,batch_id FROM regeneration_runs WHERE id=? AND chat_id=? AND mode='canonical_suffix'").get(runId, chatId) as { shadow_chat_id: string | null; status: string; batch_id: string } | undefined;
  if (!run || !run.shadow_chat_id || run.status !== "processing") return;
  const states = db.prepare("SELECT status,count(*) count FROM jobs WHERE chat_id=? GROUP BY status").all(run.shadow_chat_id) as Array<{ status: string; count: number }>;
  const counts = new Map(states.map((row) => [row.status, row.count]));
  if ((counts.get("failed") ?? 0) > 0) {
    db.prepare("UPDATE regeneration_runs SET status='failed',error='One or more shadow extraction jobs failed',updated_at=? WHERE id=?").run(now(), runId);
    return;
  }
  if ((counts.get("queued") ?? 0) + (counts.get("leased") ?? 0) > 0) return;
  const unfinished = db.prepare("SELECT 1 FROM extraction_batches WHERE chat_id=? AND generation_id=? AND status NOT IN ('applied','superseded') LIMIT 1").get(run.shadow_chat_id, runId);
  const pendingState = db.prepare("SELECT 1 FROM reconciliation_items WHERE chat_id=? AND status='pending' LIMIT 1").get(run.shadow_chat_id);
  if (unfinished || pendingState) {
    db.prepare("UPDATE regeneration_runs SET status='failed',error='필수 근거 또는 상태 검수가 남아 있어 후보를 적용할 수 없어요',updated_at=? WHERE id=?").run(now(), runId);
    return;
  }
  const cut = batch(db, chatId, run.batch_id).start_ordinal;
  const before = (db.prepare(`SELECT b.final_json FROM extraction_batches b WHERE b.chat_id=? AND b.generation_id='active' AND b.start_ordinal>=? AND b.status='applied' AND NOT (${retiredBatchSourceSql}) ORDER BY b.start_ordinal`).all(chatId, cut) as Array<{ final_json: string }>).map((row) => ExtractionResultSchema.parse(JSON.parse(row.final_json ?? '{}')));
  const after = (db.prepare("SELECT final_json FROM extraction_batches WHERE chat_id=? AND generation_id=? AND status='applied' ORDER BY start_ordinal").all(run.shadow_chat_id, runId) as Array<{ final_json: string }>).map((row) => ExtractionResultSchema.parse(JSON.parse(row.final_json ?? '{}')));
  if (!after.length) {
    db.prepare("UPDATE regeneration_runs SET status='failed',error='Shadow extraction produced no applied batches',updated_at=? WHERE id=?").run(now(), runId);
    return;
  }
  const guard = JSON.parse((db.prepare("SELECT preview_json FROM regeneration_runs WHERE id=?").get(runId) as { preview_json: string }).preview_json);
  // Compare the same canonical items the owner started with, including access and progress.
  if (guard.itemTargetFingerprint && guard.itemTargetFingerprint !== regenerationItemsFingerprint(db, chatId)) {
    db.prepare("UPDATE regeneration_runs SET status='stale',error='Target memories or access changed',updated_at=? WHERE id=?").run(now(), runId);
    return;
  }
  db.prepare("UPDATE regeneration_runs SET status='ready',preview_json=?,error=NULL,updated_at=? WHERE id=?").run(JSON.stringify({
    ...guard,
    before,
    after,
    afterStates: currentStatePreview(db, run.shadow_chat_id),
    afterCurrentMemories: [
      ...currentMemoryPreview(db, run.shadow_chat_id, (db.prepare("SELECT id FROM extraction_batches WHERE chat_id=? AND generation_id=? AND status='applied'").all(run.shadow_chat_id, runId) as Array<{ id: string }>).map((row) => row.id))
        .filter((memory) => !(guard.beforeCurrentMemories as any[]).some((old) => old.userManaged && old.key === memory.key)),
      ...(guard.beforeCurrentMemories as any[]).filter((memory) => memory.userManaged),
    ],
    counts: { before: sumCounts(before), after: sumCounts(after) },
    diff: regenerationDiff(before, after),
    itemDiff: diffRegenerationItems(snapshotRegenerationItems(db, chatId, {startOrdinal:cut,endOrdinal:Number.MAX_SAFE_INTEGER}), snapshotRegenerationItems(db, run.shadow_chat_id)),
    batchCount: { before: before.length, after: after.length },
    changedBatchCount: Math.max(before.length, after.length) - before.filter((item, index) => after[index] && JSON.stringify(item) === JSON.stringify(after[index])).length,
    highlights: {
      before: before.flatMap((item) => item.memories.map((memory) => memory.title)).slice(0, 16),
      after: after.flatMap((item) => item.memories.map((memory) => memory.title)).slice(0, 16),
    },
  }), now(), runId);
}

/** Missing or unreadable accepted material must stop before work or deletion. */
function replaySnapshot(db:RcmDatabase,chatId:string,row:{id:string;final_json:string|null}):ExtractionResult {
  const failure=()=>{
    const range=db.prepare('SELECT start_ordinal,end_ordinal FROM extraction_batches WHERE chat_id=? AND id=?').get(chatId,row.id) as {start_ordinal:number;end_ordinal:number};
    const reason=`원문 ${range.start_ordinal+1}~${range.end_ordinal+1} 구간의 재생 기록을 읽을 수 없어요. 이 구간을 먼저 다시 만들어 주세요.`;
    return Object.assign(new Error(`REPLAY_SNAPSHOT_MISSING: ${reason}`),{code:'REPLAY_SNAPSHOT_MISSING',rejectedItems:[{id:row.id,reason}]});
  };
  if (row.final_json===null && batchHasStoredMaterial(db,chatId,row.id)) {
    throw failure();
  }
  // Legacy empty gap recoveries stored NULL; their replay contract is an empty result.
  try { return ExtractionResultSchema.parse(JSON.parse(row.final_json ?? '{}')); }
  catch { throw failure(); }
}

/** Read-only and shared with apply's stop-before-deletion check. */
function preflightReplaySnapshots(db:RcmDatabase,chatId:string,cut:number):void {
  const prefix=db.prepare("SELECT id,final_json FROM extraction_batches WHERE chat_id=? AND generation_id='active' AND end_ordinal<? AND status='applied' ORDER BY start_ordinal,id")
    .all(chatId,cut) as Array<{id:string;final_json:string|null}>;
  for (const row of prefix) replaySnapshot(db,chatId,row);
}

/** Hydrate effective accepted events rather than replaying a guarded proposal. */
function acceptedBatchResult(db:RcmDatabase,chatId:string,row:{id:string;final_json:string|null},reportChatId=chatId) {
  const result=replaySnapshot(db,chatId,row);
  // Older accepted batches omit concealment. Hydrate from their own detail
  // generation before canonical replay deletes and recreates the stored atoms.
  for (const memory of result.memories) for (const detail of memory.details ?? []) {
    if (detail.hiddenFrom !== undefined) continue;
    const stored = db.prepare(`SELECT d.hidden_from_json FROM memory_details d JOIN memories m ON m.id=d.memory_id
      WHERE d.chat_id=? AND m.source_batch_id=? AND m.memory_key=? AND d.detail_key=?`)
      .get(chatId,row.id,memory.key,detail.key) as {hidden_from_json:string}|undefined;
    if (stored) detail.hiddenFrom=JSON.parse(stored.hidden_from_json);
  }
  const snapshots=db.prepare("SELECT id,promise_key,content,status,evidence_json,event_kind,amendment_text,scheduled_for_delta FROM promise_events WHERE chat_id=? AND source_batch_id=? AND active=1 ORDER BY created_at,rowid").all(chatId,row.id) as Array<{id:string;promise_key:string;content:string;status:string;evidence_json:string;event_kind:string|null;amendment_text:string|null;scheduled_for_delta:string|null}>;
  // Applied legacy batches predating event snapshots retain their original
  // replay contract. Partial event coverage must never use that fallback.
  if(!snapshots.length)return result;
  const identity=(key:string,status:string,evidence:Array<{messageId?:string;canonicalHash?:string;startOffset?:number;endOffset?:number;quote?:string}>)=>{
    if(!evidence.length)return undefined;
    const spans=evidence.map(item=>[item.messageId??null,item.canonicalHash??(item.messageId ? (db.prepare("SELECT canonical_hash FROM messages WHERE chat_id=? AND message_id=?").get(chatId,item.messageId) as {canonical_hash:string}|undefined)?.canonical_hash : null)??null,item.startOffset??null,item.endOffset??null,item.quote??null]);
    return JSON.stringify([key,status,spans.map(span=>JSON.stringify(span)).sort()]);
  };
  const signatures=result.promises.map(promise=>promise.scope==="scene" ? undefined : identity(promise.key,promise.status,promise.evidence??[]));
  const eventSignatures=snapshots.map(snapshot=>identity(snapshot.promise_key,snapshot.status,JSON.parse(snapshot.evidence_json)));
  result.promises=result.promises.flatMap((promise,index)=>{
    if(promise.scope==="scene")return [promise];
    const signature=signatures[index];
    const matches=signature===undefined ? [] : snapshots.filter((_snapshot,i)=>eventSignatures[i]===signature);
    if(matches.length===1&&signatures.filter(value=>value===signature).length===1)return [{...promise,content:matches[0]!.content,
      storedAmendment:matches[0]!.amendment_text,...(matches[0]!.amendment_text!=null ? {scheduledFor:matches[0]!.scheduled_for_delta ?? undefined} : {}),
      ...(matches[0]!.event_kind ? {event:matches[0]!.event_kind as typeof promise.event} : {})}];
    db.prepare("INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,created_revision,created_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(),reportChatId,"promise_replay_correspondence",JSON.stringify(snapshots),JSON.stringify({point:"promise_replay_correspondence",batchId:row.id,evidenceIdentity:signature??null,candidate:promise,reason:matches.length ? "ambiguous accepted occurrence" : "no matching accepted occurrence"}),
      (db.prepare("SELECT revision FROM chats WHERE id=?").get(reportChatId) as {revision:number}).revision,now());
    return [];
  });
  return result;
}

export function applyCanonicalRegeneration(db: RcmDatabase, chatId: string, runId: string, keepLostItemIds: string[] = [], options: {fullReplace?:boolean} = {}): { batches: number; relationWarnings: string[]; keptItemIds: string[] } {
  if (options.fullReplace) return applyWholeChatReplacement(db,chatId,runId);
  assertChatUnlocked(db,chatId);
  refreshCanonicalRegeneration(db, chatId, runId);
  const run = db.prepare("SELECT batch_id,shadow_chat_id,source_fingerprint_json,preview_json,status FROM regeneration_runs WHERE id=? AND chat_id=? AND mode='canonical_suffix'").get(runId, chatId) as { batch_id: string; shadow_chat_id: string; source_fingerprint_json: string; preview_json: string | null; status: string } | undefined;
  if (!run || run.status !== "ready") throw Object.assign(new Error("Canonical regeneration is not ready"), { code: "RUN_NOT_READY" });
  const keep = prepareRegenerationKeep(db, chatId, keepLostItemIds, run.preview_json ? JSON.parse(run.preview_json).itemDiff : undefined);
  validateRegenerationTarget(db, chatId, runId);
  const fingerprint = parseSourceFingerprintJson(run.source_fingerprint_json);
  if (!fingerprint || !fingerprintMatches(db, chatId, fingerprint)) {
    db.prepare("UPDATE regeneration_runs SET status='stale',error='Source fingerprint changed',updated_at=? WHERE id=?").run(now(), runId);
    throw Object.assign(new Error("Source messages changed; staged canonical state was not applied"), { code: "SOURCE_CHANGED" });
  }
  const cut = batch(db, chatId, run.batch_id).start_ordinal;
  const prefix = db.prepare(`SELECT b.id,b.final_json,b.start_ordinal,b.end_ordinal,b.source_message_ids_json,b.source_fingerprint_json,b.kind FROM extraction_batches b WHERE b.chat_id=? AND b.generation_id='active' AND b.end_ordinal<? AND b.status='applied' AND NOT (${retiredBatchSourceSql}) ORDER BY b.start_ordinal`).all(chatId, cut) as any[];
  const suffix = db.prepare("SELECT id,final_json,start_ordinal,end_ordinal,source_message_ids_json,source_fingerprint_json,kind,producer_event_contract,producer_state_contract FROM extraction_batches WHERE chat_id=? AND generation_id=? AND status='applied' ORDER BY start_ordinal").all(run.shadow_chat_id, runId) as any[];
  // Read accepted snapshots before the transaction deletes automatic events.
  const acceptedPrefix=new Map(prefix.map(row=>[row.id,acceptedBatchResult(db,chatId,row)]));
  const acceptedSuffix=new Map(suffix.map(row=>[row.id,acceptedBatchResult(db,run.shadow_chat_id,row,chatId)]));
  const prefixOwnerOnlyState = snapshotOwnerOnlyState(db, chatId);
  const suffixOwnerOnlyState = snapshotOwnerOnlyState(db, run.shadow_chat_id);
  const relationSnapshots = [
    ...snapshotCanonicalRelations(db, chatId, prefix.map((row) => row.id), true),
    ...snapshotCanonicalRelations(db, run.shadow_chat_id, suffix.map((row) => row.id)),
  ];
  const protectedKeys = new Set((db.prepare(`SELECT memory_key FROM memories WHERE chat_id=?
    AND (user_managed=1 OR is_initial_calibration_memory(memory_key))`).all(chatId) as Array<{ memory_key: string }>).map((row) => row.memory_key));
  const targetSuffixBatches: Array<{ id: string; result: ExtractionResult }> = [];
  const replayBatchMap = new Map(prefix.map((row) => [row.id, row.id]));
  // Kept closed seeds replay their open atom plus its original typed closure.
  // Resolve transient detail IDs by exact atom identity before retiring that generation.
  const seedClosures = [...prefix.map(row => ({...row,chatId})), ...suffix.map(row => ({...row,chatId:run.shadow_chat_id}))]
    .flatMap(row => (ExtractionResultSchema.parse(JSON.parse(row.final_json ?? '{}')).seedResolutions ?? [])
      .filter(patch => JSON.parse(row.final_json ?? '{}').regenerationKeptSeedIds?.includes(patch.detailId)).flatMap(patch => {
      const detail = db.prepare(`SELECT d.*,m.memory_key FROM memory_details d JOIN memories m ON m.id=d.memory_id
        WHERE d.chat_id=? AND d.id=? AND d.active=1 AND m.active=1`).get(row.chatId,patch.detailId) as any;
      return detail ? [{batchId:row.id,patch,memoryKey:detail.memory_key,detailKey:detail.detail_key,fingerprint:atomFingerprint(detail)}] : [];
    }));
  const relationWarnings: string[] = [];
  db.transaction(() => {
    // Canonical replay below also deletes and re-ingests prefix atoms. Every
    // old Story support identity can change, so this path needs a full rebuild.
    invalidateStorySpine(db, chatId);
    discardRegeneratedTextEdits(db,chatId,{startOrdinal:cut,endOrdinal:Number.MAX_SAFE_INTEGER});
    db.prepare("UPDATE source_passages SET active=0 WHERE chat_id=?").run(chatId);
    db.prepare("DELETE FROM memory_recall_events WHERE chat_id=?").run(chatId);

    db.prepare(`DELETE FROM memory_traces WHERE memory_id IN (SELECT id FROM memories WHERE chat_id=? AND user_managed=0 AND NOT is_initial_calibration_memory(memory_key))`).run(chatId);
    db.prepare(`UPDATE item_access SET active=0 WHERE chat_id=? AND (
      (item_kind='detail' AND item_id IN (SELECT d.id FROM memory_details d JOIN memories m ON m.id=d.memory_id WHERE m.chat_id=? AND m.user_managed=0 AND NOT is_initial_calibration_memory(m.memory_key))) OR
      (item_kind='dialogue' AND item_id IN (SELECT d.id FROM memory_dialogues d JOIN memories m ON m.id=d.memory_id WHERE m.chat_id=? AND m.user_managed=0 AND NOT is_initial_calibration_memory(m.memory_key))) OR
      (item_kind='atom_relation' AND item_id IN (SELECT r.id FROM atom_relations r WHERE r.chat_id=?)) OR
      (item_kind='promise' AND item_id IN (SELECT id FROM promises WHERE chat_id=? AND user_edit_ordinal IS NULL AND auto_locked=0)) OR
      (item_kind='physical_milestone' AND item_id IN (SELECT id FROM physical_intimacy_milestones WHERE chat_id=? AND source_batch_id IS NOT NULL AND manual_override=0))
    )`).run(chatId, chatId, chatId, chatId, chatId, chatId);
    db.prepare(`DELETE FROM embedding_items WHERE kind='detail' AND source_id IN (SELECT d.id FROM memory_details d JOIN memories m ON m.id=d.memory_id WHERE m.chat_id=? AND m.user_managed=0 AND NOT is_initial_calibration_memory(m.memory_key))`).run(chatId);
    db.prepare(`DELETE FROM embedding_items WHERE kind='memory' AND source_id IN (SELECT id FROM memories WHERE chat_id=? AND user_managed=0 AND NOT is_initial_calibration_memory(memory_key))`).run(chatId);
    db.prepare(`DELETE FROM memory_fts WHERE chat_id=? AND memory_id IN(SELECT id FROM memories WHERE chat_id=? AND user_managed=0 AND NOT is_initial_calibration_memory(memory_key))`).run(chatId, chatId);
    db.prepare(`DELETE FROM memory_detail_fts WHERE chat_id=? AND memory_id IN(SELECT id FROM memories WHERE chat_id=? AND user_managed=0 AND NOT is_initial_calibration_memory(memory_key))`).run(chatId, chatId);
    db.prepare(`UPDATE physical_intimacy_milestones SET source_memory_id=NULL,source_batch_id=NULL
      WHERE chat_id=? AND manual_override=1 AND source_memory_id IN (SELECT id FROM memories WHERE chat_id=? AND user_managed=0 AND NOT is_initial_calibration_memory(memory_key))`).run(chatId, chatId);
    db.prepare("DELETE FROM atom_relations WHERE chat_id=?").run(chatId);
    db.prepare(`DELETE FROM memories WHERE chat_id=? AND user_managed=0 AND NOT is_initial_calibration_memory(memory_key)
      AND NOT (${memoryHasLineCorrectionSql()})`).run(chatId);
    pruneDetailAccessEdits(db, chatId);
    rewindAutomaticSuccessorsToCorrections(db,chatId);
    db.prepare("DELETE FROM assertions WHERE chat_id=? AND user_edit_ordinal IS NULL AND auto_locked=0").run(chatId);
    db.prepare(`DELETE FROM beliefs WHERE chat_id=? AND user_edit_ordinal IS NULL AND auto_locked=0
      AND deleted_through_ordinal IS NULL AND (source IS NULL OR source NOT LIKE 'user_deleted:%')`).run(chatId);
    // Rebuild automatic occurrences, retaining the user's historical deletion boundary.
    db.prepare(`UPDATE beliefs SET active=0,source=CASE WHEN source LIKE 'user_deleted:%' THEN source ELSE 'user_deleted:' || COALESCE(source,'') END
      WHERE chat_id=? AND deleted_through_ordinal IS NOT NULL AND user_edit_ordinal IS NULL AND auto_locked=0`).run(chatId);
    db.prepare("DELETE FROM promises WHERE chat_id=? AND user_edit_ordinal IS NULL AND auto_locked=0").run(chatId);
    db.prepare("DELETE FROM promise_events WHERE chat_id=? AND promise_id NOT IN (SELECT id FROM promises WHERE chat_id=? AND user_edit_ordinal IS NOT NULL)").run(chatId,chatId);
    db.prepare("DELETE FROM item_access WHERE chat_id=? AND item_kind='promise_event' AND item_id NOT IN (SELECT id FROM promise_events WHERE chat_id=?)").run(chatId,chatId);
    db.prepare("DELETE FROM relationship_events WHERE chat_id=? AND source_batch_id IS NOT NULL AND user_edited=0 AND user_hidden=0").run(chatId);
    db.prepare("UPDATE physical_intimacy_milestones SET active=0 WHERE chat_id=? AND source_batch_id IS NOT NULL AND manual_override=0").run(chatId);
    db.prepare("DELETE FROM social_knowledge_events WHERE chat_id=? AND manual=0 AND (source_memory_id IS NULL OR source_memory_id NOT IN (SELECT id FROM memories WHERE is_initial_calibration_memory(memory_key)))").run(chatId);
    db.prepare("DELETE FROM relationship_projection_queue WHERE chat_id=?").run(chatId);
    db.prepare("UPDATE relationship_projections SET stale=1,event_cursor_json=? WHERE chat_id=?").run(JSON.stringify({ revision: -1, eventIds: [] }), chatId);
    db.prepare("DELETE FROM relationship_baselines WHERE chat_id=? AND source<>'setup' AND user_managed=0").run(chatId);
    db.prepare("DELETE FROM entity_scene_presence WHERE chat_id=?").run(chatId);
    db.prepare("DELETE FROM entity_prominence WHERE chat_id=?").run(chatId);
    // Keep the already-valid prefix batch rows in place. Besides preserving their
    // audit history, this avoids deleting the selected batch while the
    // regeneration run still refers to it. Retired branches are not valid prefix.
    db.prepare(`UPDATE extraction_batches AS b SET status='superseded',updated_at=?
      WHERE b.chat_id=? AND b.generation_id='active' AND (b.start_ordinal>=? OR ${retiredBatchSourceSql})`).run(now(), chatId, cut);
    for (const row of prefix) {
      const result = acceptedPrefix.get(row.id)!;
      relationWarnings.push(...ingestExtraction(db, chatId, { ...result, atomRelations: [], memories: result.memories.filter((memory) => !protectedKeys.has(memory.key)) },
        `replay:${runId}:${row.id}`, row.id, undefined, 'replay', {preserveStoredCardShapes:true,storedOwnerOnlyState:prefixOwnerOnlyState}));
    }
    for (const row of suffix) {
      const id = randomUUID();
      const result = acceptedSuffix.get(row.id)!;
      db.prepare(`INSERT INTO extraction_batches(id,chat_id,generation_id,kind,source_message_ids_json,source_fingerprint_json,start_ordinal,end_ordinal,status,final_json,producer_event_contract,producer_state_contract,created_at,updated_at)
        VALUES(?,?,'active',?,?,?,?,?,'applied',?,?,?,?,?)`).run(id, chatId, row.kind, row.source_message_ids_json, row.source_fingerprint_json, row.start_ordinal, row.end_ordinal, JSON.stringify(result), row.producer_event_contract, row.producer_state_contract, now(), now());
      relationWarnings.push(...ingestExtraction(db, chatId, { ...result, atomRelations: [], memories: result.memories.filter((memory) => !protectedKeys.has(memory.key)) },
        `replay:${runId}:${id}`, id, undefined, 'replay', {preserveStoredCardShapes:true,storedOwnerOnlyState:suffixOwnerOnlyState}));
      replayBatchMap.set(row.id, id);
      targetSuffixBatches.push({ id, result });
    }
    for (const memory of db.prepare(`SELECT id FROM memories WHERE chat_id=? AND (${memoryHasLineCorrectionSql()})`).all(chatId) as Array<{id:string}>) {
      refreshMemoryFts(db,memory.id);
      for (const detail of db.prepare('SELECT id FROM memory_details WHERE memory_id=?').all(memory.id) as Array<{id:string}>) refreshDetailFts(db,detail.id);
    }
    relationWarnings.push(...restoreCanonicalRelations(db, chatId, relationSnapshots, replayBatchMap));
    restoreRegenerationKeep(db, chatId, keep);
    for (const closure of seedClosures) {
      const detail = db.prepare(`SELECT d.* FROM memory_details d JOIN memories m ON m.id=d.memory_id
        WHERE d.chat_id=? AND m.memory_key=? AND d.detail_key=? AND d.active=1 AND m.active=1`).get(chatId,closure.memoryKey,closure.detailKey) as any;
      if (!detail || atomFingerprint(detail) !== closure.fingerprint) continue;
      const patch = {...closure.patch,detailId:detail.id};
      applySeedResolutions(db,chatId,[patch]);
      const batchId = replayBatchMap.get(closure.batchId)!;
      const stored = JSON.parse((db.prepare('SELECT final_json FROM extraction_batches WHERE id=?').get(batchId) as {final_json:string}).final_json);
      stored.seedResolutions = (stored.seedResolutions ?? []).map((item:any) => item.detailId === closure.patch.detailId ? patch : item);
      stored.regenerationKeptSeedIds = (stored.regenerationKeptSeedIds ?? []).map((id:string) => id === closure.patch.detailId ? patch.detailId : id);
      db.prepare('UPDATE extraction_batches SET final_json=? WHERE id=?').run(JSON.stringify(stored),batchId);
    }
    syncManualCognition(db,chatId);
    db.prepare("UPDATE regeneration_runs SET status='applied',preview_json=?,updated_at=? WHERE id=?")
      .run(appendRelationWarnings(keep.ids.length ? JSON.stringify({ ...JSON.parse(run.preview_json!), keptItemIds: keep.ids }) : run.preview_json, relationWarnings), now(), runId);
  })();
  flushRelationshipProjectionQueue(db, chatId);
  maybeEnqueueStorySpine(db, chatId, undefined, 'regeneration');
  deleteRegenerationShadow(db, run.shadow_chat_id);
  return { batches: targetSuffixBatches.length, relationWarnings, keptItemIds: keep.ids };
}

/** Promote accepted shadow canon with an identity mapping of its globally unique
 * IDs. Candidate/evidence/job/batch references remain exact, including pending
 * reviews and final-ledger decisions that replaying proposals would undo. Only
 * chat ownership and generation change. swapUpgrade owns the source check.
 */
function applyWholeChatReplacement(db:RcmDatabase,chatId:string,runId:string) {
  return db.transaction(() => {
    const run = db.prepare("SELECT shadow_chat_id,status,phase FROM regeneration_runs WHERE id=? AND chat_id=? AND mode='upgrade'").get(runId,chatId) as
      {shadow_chat_id:string;status:string;phase:number}|undefined;
    if (!run || run.status !== 'ready' || run.phase !== 1) throw Object.assign(new Error('RUN_NOT_READY'),{code:'RUN_NOT_READY'});
    deleteDerivedRows(db,chatId,{preserveUserCorrections:false,preserveRegenerationRunId:runId});
    clearAuxiliaryInputs(db,chatId);
    clearAuxiliaryInputs(db,run.shadow_chat_id);
    db.prepare("DELETE FROM chat_lineage_items WHERE child_chat_id=? AND item_kind<>'message'").run(chatId);
    // A full upgrade deliberately replaces user deletion intent as well as edits.
    // Issued public references remain tombstones in their separate registry.
    for (const key of [`memory_bookmarks:${chatId}`,memoryPreferencesKey(chatId),userDeletionsKey(chatId),removedAliasesKey(chatId),
      ledgerEditOriginsKey(chatId),detailAccessEditsKey(chatId),dialogueAccessIdentityKey(chatId)]) {
      db.prepare('DELETE FROM server_meta WHERE key=?').run(key);
    }
    for (const table of [...CHAT_DERIVED_TABLES,'entities','initial_calibrations','relationship_baselines','pair_progress','memory_activation_state'] as const) {
      if (table === 'regeneration_runs') continue;
      db.prepare(`UPDATE ${table} SET chat_id=? WHERE chat_id=?`).run(chatId,run.shadow_chat_id);
    }
    db.prepare("UPDATE extraction_batches SET generation_id='active' WHERE chat_id=?").run(chatId);
    for (const table of ['memory_fts','memory_detail_fts']) db.prepare(`UPDATE ${table} SET chat_id=? WHERE chat_id=?`).run(chatId,run.shadow_chat_id);
    // The accepted generation owns coverage history too. Replace the old
    // family's markers and retry budget atomically; ordinary replay keeps them.
    for (const prefix of ['source_coverage_retry:','source_coverage_family:','source_coverage_folded:']) {
      db.prepare('DELETE FROM server_meta WHERE key=?').run(prefix+chatId);
      db.prepare('UPDATE server_meta SET key=? WHERE key=?').run(prefix+chatId,prefix+run.shadow_chat_id);
    }
    // Setup-only pairs also need their projections rebuilt: the inherited-event
    // lag detector deliberately covers a narrower class of relationship history.
    const pairs = db.prepare(`SELECT from_entity,to_entity FROM relationship_baselines WHERE chat_id=? AND active=1
      UNION SELECT from_entity,to_entity FROM relationship_events WHERE chat_id=? AND active=1`).all(chatId,chatId) as {from_entity:string;to_entity:string}[];
    for (const pair of pairs) queueRelationshipProjection(db,chatId,pair.from_entity,pair.to_entity,'replay');
    // Preserve the live source ledger and protected tail; only the frozen
    // range's processing state advances to the accepted shadow coverage.
    db.prepare(`UPDATE messages SET extraction_state=(SELECT s.extraction_state FROM messages s WHERE s.chat_id=? AND s.message_id=messages.message_id)
      WHERE chat_id=? AND message_id IN (SELECT message_id FROM messages WHERE chat_id=?)`).run(run.shadow_chat_id,chatId,run.shadow_chat_id);
    // Any work outside the frozen range was removed too (including work made
    // while phase 1 was failed/unlocked). Leave that source eligible for normal
    // extraction after unlock rather than stranding a done/queued tail.
    db.prepare(`UPDATE messages SET extraction_state='pending' WHERE chat_id=? AND memory_excluded=0
      AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')
      AND NOT EXISTS (SELECT 1 FROM messages s WHERE s.chat_id=? AND s.message_id=messages.message_id)`)
      .run(chatId,run.shadow_chat_id);
    db.prepare("UPDATE regeneration_runs SET status='finishing',phase=2,error=NULL,updated_at=? WHERE id=?").run(now(),runId);
    db.prepare('DELETE FROM server_meta WHERE key IN (?,?,?,?)').run(chatPacketBudgetKey(run.shadow_chat_id),removedAliasesKey(run.shadow_chat_id),lineageRevisionKey(run.shadow_chat_id),`source_coverage_retry:${run.shadow_chat_id}`);
    db.prepare('DELETE FROM chats WHERE id=? AND is_internal=1').run(run.shadow_chat_id);
    const batches = (db.prepare("SELECT count(*) n FROM extraction_batches WHERE chat_id=? AND status='applied'").get(chatId) as {n:number}).n;
    return {batches,relationWarnings:[],keptItemIds:[]};
  })();
}

export function discardRegeneration(db: RcmDatabase, chatId: string, runId: string): void {
  const run = db.prepare("SELECT shadow_chat_id FROM regeneration_runs WHERE id=? AND chat_id=?").get(runId, chatId) as { shadow_chat_id: string | null } | undefined;
  const changed = db.prepare("UPDATE regeneration_runs SET status='discarded',updated_at=? WHERE id=? AND chat_id=? AND status IN ('queued','processing','ready','failed','stale')").run(now(), runId, chatId);
  if (!changed.changes) throw Object.assign(new Error("Regeneration run cannot be discarded"), { code: "RUN_NOT_DISCARDABLE" });
  db.prepare("UPDATE jobs SET status='superseded',lease_owner=NULL,leased_until=NULL,updated_at=? WHERE id=(SELECT job_id FROM regeneration_runs WHERE id=?) AND status IN ('queued','leased','failed')").run(now(), runId);
  if (run?.shadow_chat_id) {
    deleteRegenerationShadow(db, run.shadow_chat_id);
  }
}

function deleteRegenerationShadow(db: RcmDatabase, chatId: string): void {
  db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM chats WHERE id=? AND is_internal=1").get(chatId)) return;
    markSourceDeleted(db, chatId);
    db.prepare("DELETE FROM server_meta WHERE key IN (?,?,?,?,?,?)").run(chatPacketBudgetKey(chatId), removedAliasesKey(chatId), lineageRevisionKey(chatId), `source_coverage_retry:${chatId}`, `source_coverage_family:${chatId}`, `source_coverage_folded:${chatId}`);
    db.prepare("DELETE FROM chats WHERE id=? AND is_internal=1").run(chatId);
  })();
}

function timelineOnly(result: ExtractionResult): ExtractionResult {
  return { ...result, entities: [], assertions: [], beliefs: [], relationshipEvents: [], promises: [], socialKnowledge: [], relationshipBaselines: [], physicalIntimacy: [], memoryRecallObservations: [] };
}

/** Preview the same database-only apply path in a rolled-back savepoint. This
 * includes protected parents and exact-twin suppression without copying policy. */
export function refreshEpisodeRegenerationPreview(db: RcmDatabase, chatId: string, runId: string): void {
  const run = db.prepare('SELECT batch_id,preview_json FROM regeneration_runs WHERE id=? AND chat_id=?').get(runId,chatId) as {batch_id:string;preview_json:string};
  const source = batch(db,chatId,run.batch_id);
  const before = snapshotRegenerationItems(db,chatId,{startOrdinal:source.start_ordinal,endOrdinal:source.end_ordinal,includeEvents:false});
  let afterCurrentMemories: ReturnType<typeof currentMemoryPreview> = [], itemDiff: ReturnType<typeof diffRegenerationItems> = [];
  const rollback = new Error('episode preview savepoint');
  try {
    db.transaction(() => {
      applyEpisodeRegeneration(db,chatId,runId);
      afterCurrentMemories = currentMemoryPreview(db,chatId,[run.batch_id]);
      itemDiff = diffRegenerationItems(before,snapshotRegenerationItems(db,chatId));
      throw rollback;
    })();
  } catch (error) { if (error !== rollback) throw error; }
  db.prepare('UPDATE regeneration_runs SET preview_json=? WHERE id=? AND chat_id=?')
    .run(JSON.stringify({...JSON.parse(run.preview_json),afterCurrentMemories,itemDiff}),runId,chatId);
}

export function applyEpisodeRegeneration(db: RcmDatabase, chatId: string, runId: string, keepLostItemIds: string[] = []): { memories: number; relationWarnings: string[] } {
  assertChatUnlocked(db,chatId);
  const run = db.prepare("SELECT batch_id,job_id,source_fingerprint_json,preview_json,status FROM regeneration_runs WHERE id=? AND chat_id=? AND mode='episode'").get(runId, chatId) as
    | { batch_id: string; job_id: string | null; source_fingerprint_json: string; preview_json: string | null; status: string }
    | undefined;
  if (!run || run.status !== "ready" || !run.preview_json) throw Object.assign(new Error("Episode regeneration is not ready"), { code: "RUN_NOT_READY" });
  const fingerprint = parseSourceFingerprintJson(run.source_fingerprint_json);
  if (!fingerprint || !fingerprintMatches(db, chatId, fingerprint)) {
    db.prepare("UPDATE regeneration_runs SET status='stale',error='Source fingerprint changed',updated_at=? WHERE id=?").run(now(), runId);
    throw Object.assign(new Error("Source messages changed; staged result was not applied"), { code: "SOURCE_CHANGED" });
  }
  const preview = JSON.parse(run.preview_json) as { after: unknown; beforeCurrentMemories: Array<{ id: string; key: string }> };
  validateRegenerationTarget(db, chatId, runId);
  const keep = prepareRegenerationKeep(db,chatId,keepLostItemIds,JSON.parse(run.preview_json).itemDiff);
  const incoming = timelineOnly(ExtractionResultSchema.parse(preview.after));
  const job = db.prepare('SELECT payload_json FROM jobs WHERE id=? AND chat_id=?').get(run.job_id, chatId) as {payload_json:string}|undefined;
  // Recheck generation provenance before accepting even a previously staged
  // candidate; old previews may predate the model-draft marker boundary.
  const producer = JSON.parse(job?.payload_json ?? '{}') as {promptContract?:"e1d" | "e1e" | "e1f"};
  normalizeGeneratedCardShapes(incoming, producer.promptContract);
  const sourceMessageIds = JSON.parse(batch(db, chatId, run.batch_id).source_message_ids_json) as string[];
  const relationContext = snapshotRelationContext(db, chatId, run.job_id, sourceMessageIds);
  // Apply the exact active identities shown in the preview. A batch can also
  // contain retired memories; including them here would resurrect an unseen
  // identity and retire a different, previewed memory instead.
  const old = preview.beforeCurrentMemories;
  const relationWarnings: string[] = [];
  let memoryCount = 0;
  db.transaction(() => {
    const source = batch(db,chatId,run.batch_id);
    discardRegeneratedTextEdits(db,chatId,{startOrdinal:source.start_ordinal,endOrdinal:source.end_ordinal,includeEvents:false});
    const oldKeys = episodeMemoryKeys(db, chatId, run.batch_id, old, incoming.memories);
    const protectedLegacy = protectedLegacyEpisodeKeys(db,chatId,old);
    const preservedKeys = old.filter(item => protectedLegacy.has(item.key) && !oldKeys.includes(item.key)).map(item => item.key);
    const mappedMemories = incoming.memories.map((memory, index) => ({
      ...memory,
      key: oldKeys[index]!,
    }));
    const mappedKeys = new Map(incoming.memories.map((memory, index) => [memory.key, mappedMemories[index]!.key]));
    const applied = remapExtractionMemoryKeys(incoming,mappedKeys);
    memoryCount = applied.memories.length;
    const prominence = db.prepare("SELECT * FROM entity_prominence WHERE chat_id=?").all(chatId) as any[];
    const quizzes = snapshotRegenerationQuizzes(db, chatId, old.map(item => item.id));
    db.prepare("UPDATE source_passages SET active=0 WHERE chat_id=? AND source_batch_id=?").run(chatId, run.batch_id);
    for (const item of old.slice(mappedMemories.length)) {
      if (protectedLegacy.has(item.key)) continue;
      db.prepare("UPDATE memories SET active=0,updated_at=? WHERE id=?").run(now(), item.id);
      db.prepare("DELETE FROM memory_fts WHERE memory_id=?").run(item.id);
      db.prepare("DELETE FROM embedding_items WHERE kind='memory' AND source_id=?").run(item.id);
    }
    relationWarnings.push(...ingestExtraction(db, chatId, applied, run.job_id ?? undefined, run.batch_id, resolveRelationContext(db, chatId, relationContext), 'regeneration', {preserveStoredCardShapes:true}));
    for (const [index,item] of old.entries()) {
      if (!preservedKeys.includes(item.key) || !mappedMemories[index]) continue;
      // The replacement owns the event; the old parent only carries user rows.
      db.prepare(`UPDATE memories SET always_inject=MAX(always_inject,(SELECT MAX(always_inject) FROM memories
          WHERE chat_id=? AND (id=? OR memory_key=(SELECT replacement_memory_key FROM memories WHERE id=?))))
        WHERE chat_id=? AND memory_key=? AND EXISTS(SELECT 1 FROM memories WHERE id=? AND user_managed=0)`)
        .run(chatId,item.id,item.id,chatId,mappedMemories[index]!.key,item.id);
      db.prepare('UPDATE memories SET always_inject=0,replacement_memory_key=? WHERE id=? AND user_managed=0').run(mappedMemories[index]!.key,item.id);
    }
    preserveRegenerationQuizzes(db, chatId, quizzes);
    db.prepare("DELETE FROM entity_scene_presence WHERE chat_id=? AND scene_key=?").run(chatId, run.job_id);
    db.prepare("DELETE FROM entity_prominence WHERE chat_id=?").run(chatId);
    const restore = db.prepare("INSERT INTO entity_prominence(chat_id,entity_name,tier,scene_count,durable_links,pinned,updated_at) VALUES(?,?,?,?,?,?,?)");
    for (const row of prominence) restore.run(row.chat_id, row.entity_name, row.tier, row.scene_count, row.durable_links, row.pinned, row.updated_at);
    const original = batch(db, chatId, run.batch_id).final_json;
    const full = original ? ExtractionResultSchema.parse(JSON.parse(original)) : applied;
    // Memory-only replacement leaves state untouched; retained old memories also retain event provenance.
    db.prepare("UPDATE extraction_batches SET final_json=?,status='applied',producer_event_contract=CASE WHEN ? THEN producer_event_contract ELSE ? END,updated_at=? WHERE id=?")
      .run(original===null ? null : JSON.stringify({ ...full, memories: [...applied.memories, ...full.memories.filter(memory => preservedKeys.includes(memory.key))], atomRelations: applied.atomRelations }), Number(preservedKeys.length > 0), producer.promptContract ?? null, now(), run.batch_id);
    restoreRegenerationKeep(db,chatId,keep);
    markStoryRangesInvalid(db, chatId, sourceMessageIds);
    db.prepare("UPDATE regeneration_runs SET status='applied',preview_json=?,updated_at=? WHERE id=?")
      .run(appendRelationWarnings(run.preview_json, relationWarnings), now(), runId);
  })();
  maybeEnqueueStorySpine(db, chatId, undefined, 'regeneration');
  return { memories: memoryCount, relationWarnings };
}

function canonicalRegenerationRanges(db: RcmDatabase, chatId: string, batchId: string) {
  const retired = new Set((db.prepare(`SELECT b.id FROM extraction_batches b WHERE b.chat_id=? AND ${retiredBatchSourceSql}`)
    .all(chatId) as Array<{id:string}>).map(row=>row.id));
  const ranges = listSourceRanges(db, chatId).filter(row => !row.memoryExcluded && !row.id.startsWith('unprocessed:')
    && (!retired.has(row.id) || row.selectable));
  let startIndex = ranges.findIndex(row => row.id === batchId);
  if (startIndex < 0) return selectSourceRanges(db, chatId, [batchId]);
  // NULL with retained material is an absent replay contract, including slices
  // with state but no active memories. Re-extract it, never infer a snapshot.
  const missing=new Set((db.prepare("SELECT id FROM extraction_batches WHERE chat_id=? AND generation_id='active' AND status='applied' AND final_json IS NULL")
    .all(chatId) as {id:string}[]).filter(row=>batchHasStoredMaterial(db,chatId,row.id)).map(row=>row.id));
  // A later insertion can interleave an older batch's members. Widen the
  // canonical cut to that batch's first member, never replay half a batch.
  for (let index = startIndex - 1; index >= 0; index--) {
    if (missing.has(ranges[index]!.id) || ranges[index]!.endOrdinal >= ranges[startIndex]!.startOrdinal) startIndex = index;
  }
  const lastEligibleIndex = ranges.reduce((last, row, index) => row.eligible ? index : last, -1);
  const selected = selectSourceRanges(db, chatId, ranges.slice(startIndex, Math.max(startIndex + 1, lastEligibleIndex + 1)).map(row => row.id));
  if (ranges.slice(0,startIndex).some(row=>retired.has(row.id))) {
    throw Object.assign(new Error("이전 묶음의 원문이 일부 취소됐어요. 해당 구간을 원문에서 다시 정리한 뒤 재생성해 주세요"), {code:'RANGE_NOT_ELIGIBLE'});
  }
  if (ranges.slice(lastEligibleIndex + 1).some(row => row.status === 'applied')) {
    throw Object.assign(new Error("이후 기억에 수정 보호 또는 확인이 필요한 구간이 있어. 해당 구간을 확인한 뒤 다시 시도해 줘"), { code: "RANGE_NOT_ELIGIBLE" });
  }
  return selected;
}

export function previewRegeneration(db: RcmDatabase, chatId: string, batchId: string, canonical: boolean) {
  const ranges = canonical ? canonicalRegenerationRanges(db, chatId, batchId) : selectSourceRanges(db, chatId, [batchId]);
  if (canonical) preflightReplaySnapshots(db,chatId,ranges[0]!.startOrdinal);
  const chat = db.prepare("SELECT profile,memory_language FROM chats WHERE id=?").get(chatId) as any;
  const raw = rangeMessages(db, chatId);
  const stages = ranges.map((range) => {
    const messages = raw.filter((row) => range.sourceMessageIds.includes(row.id)).map((row) => ({ message_id: row.id, content: row.content!, role: row.role, ordinal: row.ordinal, content_hash: row.canonicalHash }));
    const prompts = buildPrompt(db, chatId, chat.profile, chat.memory_language, messages);
    return estimateTokens(prompts.systemPrompt) + estimateTokens(prompts.userPrompt);
  });
  return { startOrdinal: ranges[0]!.startOrdinal, batchCount: ranges.length, messageCount: ranges.reduce((n, row) => n + row.sourceMessageIds.length, 0),
    rawTokens: ranges.reduce((n, row) => n + row.rawTokens, 0), estimatedInputTokens: stages.reduce((a,b) => a+b,0), estimatedExtractionCalls: stages.length,
    ...(canonical ? {estimatedStoryCalls:estimateStoryRebuild(db,chatId),estimatedRelationshipCalls:estimateRelationshipCalls(db,chatId)} : {}) };
}

function currentStatePreview(db: RcmDatabase, chatId: string) {
  return {
    relationshipEvents: (db.prepare('SELECT from_entity AS "from",to_entity AS "to",reason,changes_json FROM relationship_events WHERE chat_id=? AND active=1 ORDER BY created_at,id').all(chatId) as any[]).map((row)=>({...row,changes:JSON.parse(row.changes_json)})),
    assertions: db.prepare('SELECT subject,predicate,value FROM assertions WHERE chat_id=? AND valid_to_revision IS NULL ORDER BY id').all(chatId),
    beliefs: db.prepare('SELECT holder,subject,predicate,value,polarity FROM beliefs WHERE chat_id=? AND active=1 ORDER BY id').all(chatId),
    promises: db.prepare('SELECT promisor,promisee,content,status FROM promises WHERE chat_id=? ORDER BY id').all(chatId),
    physicalIntimacy: db.prepare('SELECT participant_a AS participantA,participant_b AS participantB,act,custom_label AS customLabel,circumstance FROM physical_intimacy_milestones WHERE chat_id=? AND active=1 ORDER BY id').all(chatId),
  };
}
