import { reopenSeedsBySource } from "./story-seeds.js";
import { syncManualCognition } from "./social-knowledge.js";
import { UNCORRECTED_SQL, invalidateAutomaticTransitions, rebaseCorrectionsAfterTailRollback } from "./user-corrections.js";
import { createHash, randomUUID } from "node:crypto";
import { canonicalizeSourceText, defaultCanonicalizationPolicy, isImageOnlySourceChange, type ChatMessageSnapshot, type MessageLifecycle, type TurnPrepareRequest } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { applyHostVisibilityProjection } from "./host-visibility.js";
import { invalidateSocialKnowledgeEvidence } from "./social-knowledge.js";
import { queueRelationshipProjection } from "./relationship-projections.js";
import { readDetailAccessEdits, readDialogueAccessIdentities, writeDialogueAccessIdentities, deactivateItemAccess, deactivateItemAccessByEvidence } from "./item-access.js";
import { invalidateStorySupports, markStorySupportsInvalid, maybeEnqueueStorySpine, storyMemorySupportIds } from "./story-spine.js";
import { rebuildCharacterRecallTraces } from "./ingest.js";
import { invalidateSourcePassageAccess } from "./source-evidence.js";
import { personaHintKey } from "./view-preferences.js";

const DAY = 86_400_000;
const archiveEligibleVisibility = (visibility: string): boolean => visibility === "active" || visibility === "all_before";

interface StoredMessage {
  message_id: string;
  ordinal: number;
  role: "user" | "assistant" | "system";
  content: string | null;
  content_hash: string;
  canonical_content: string | null;
  canonical_hash: string;
  lifecycle: MessageLifecycle;
  visible: number;
  extraction_state: string;
  source_kind: string;
  source_record_id: string | null;
  display_content_hash: string | null;
  display_comparison_hash: string | null;
  host_visibility: string;
}

function invalidateDerived(
  db: RcmDatabase,
  chatId: string,
  messageId: string,
  revision: number,
  reason: string,
  recordConflict = true,
  invalidatedMessages?: Set<string>,
  invalidatedSupports: Set<string> = new Set(),
): void {
  const timestamp = now();
  const recordSupports = (kind: string, rows: Array<{ id: string }>): void => {
    rows.forEach(row => invalidatedSupports.add(`${kind}:${row.id}`));
  };
  const deactivateAtomRelations = (relationIds: string[]): void => {
    if (!relationIds.length) return;
    const placeholders = relationIds.map(() => "?").join(",");
    db.prepare(`UPDATE atom_relations SET active=0 WHERE chat_id=? AND active=1 AND id IN (${placeholders})`).run(chatId, ...relationIds);
  };
  reopenSeedsBySource(db, chatId, messageId);
  invalidateSourcePassageAccess(db, chatId, messageId);
  db.prepare("UPDATE source_passages SET active=0 WHERE chat_id=? AND message_id=?").run(chatId, messageId);
  const removedRecalls = db.prepare(`DELETE FROM memory_recall_events WHERE chat_id=? AND EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE value=?)`).run(chatId, messageId).changes;
  if (removedRecalls) rebuildCharacterRecallTraces(db, chatId);
  staleSourceWork(db, chatId, messageId, reason, true);
  db.prepare("UPDATE reconciliation_items SET status='stale',model_error=COALESCE(model_error,?),resolved_at=? WHERE chat_id=? AND status='pending' AND source_message_ids_json LIKE ?").run(
    `Source ${reason}`, timestamp, chatId, `%${JSON.stringify(messageId).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
  );
  // Pending audits may have no materialized memory yet, so provenance must be
  // made stale before any memory-based early return.
  db.prepare(`UPDATE extraction_audits SET status='stale',updated_at=? WHERE chat_id=?
    AND EXISTS(SELECT 1 FROM json_each(source_message_ids_json) WHERE value=?)`).run(timestamp, chatId, messageId);
  deactivateItemAccessByEvidence(db, chatId, [messageId]);
  deactivateAtomRelations((db.prepare(`SELECT id FROM atom_relations WHERE chat_id=? AND active=1 AND EXISTS(
    SELECT 1 FROM json_each(atom_relations.evidence_json) WHERE json_extract(value,'$.messageId')=?)`).all(chatId, messageId) as Array<{ id: string }>).map((row) => row.id));

  const directDetailIds = (db.prepare(`SELECT id FROM memory_details WHERE chat_id=? AND active=1
    AND EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId')=?)`).all(chatId, messageId) as Array<{ id: string }>).map((row) => row.id);
  directDetailIds.forEach(id => invalidatedSupports.add(`detail:${id}`));
  if (directDetailIds.length) {
    const placeholders = directDetailIds.map(() => "?").join(",");
    deactivateAtomRelations((db.prepare(`SELECT id FROM atom_relations WHERE chat_id=? AND active=1
      AND (source_detail_id IN (${placeholders}) OR target_detail_id IN (${placeholders}))`).all(chatId, ...directDetailIds, ...directDetailIds) as Array<{ id: string }>).map((row) => row.id));
  }
  deactivateItemAccess(db, chatId, "detail", directDetailIds);
  for (const id of directDetailIds) db.prepare("DELETE FROM memory_detail_fts WHERE detail_id=?").run(id);
  if (directDetailIds.length) db.prepare(`UPDATE memory_details SET active=0,updated_at=? WHERE id IN (${directDetailIds.map(() => "?").join(",")})`).run(timestamp, ...directDetailIds);

  const directDialogueIds = (db.prepare("SELECT id FROM memory_dialogues WHERE chat_id=? AND EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId')=?)").all(chatId, messageId) as Array<{ id: string }>).map((row) => row.id);
  directDialogueIds.forEach(id => invalidatedSupports.add(`dialogue:${id}`));
  deactivateItemAccess(db, chatId, "dialogue", directDialogueIds);
  const editedDialogues = readDetailAccessEdits(db, chatId);
  const identities = readDialogueAccessIdentities(db, chatId);
  for (const id of directDialogueIds) if (editedDialogues.has(id)) {
    const row = db.prepare("SELECT memory_id AS memoryId,speaker,text,message_id AS messageId FROM memory_dialogues WHERE id=? AND chat_id=?").get(id, chatId) as import("./item-access.js").DialogueAccessIdentity;
    identities.set(id, row);
  }
  writeDialogueAccessIdentities(db, chatId, identities);
  if (directDialogueIds.length) db.prepare(`DELETE FROM memory_dialogues WHERE id IN (${directDialogueIds.map(() => "?").join(",")})`).run(...directDialogueIds);

  const directMilestoneIds = (db.prepare(`SELECT id FROM physical_intimacy_milestones WHERE chat_id=? AND active=1 AND manual_override=0
    AND EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId')=?)`).all(chatId, messageId) as Array<{ id: string }>).map((row) => row.id);
  deactivateItemAccess(db, chatId, "physical_milestone", directMilestoneIds);
  const directPairs = db.prepare(`SELECT DISTINCT from_entity,to_entity FROM relationship_events WHERE chat_id=? AND active=1
    AND EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId')=?)`).all(chatId, messageId) as Array<{ from_entity: string; to_entity: string }>;
  recordSupports('relationship_events', db.prepare(`UPDATE relationship_events SET active=0 WHERE chat_id=? AND active=1 AND EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId')=?) RETURNING id`).all(chatId, messageId) as Array<{id:string}>);
  db.prepare(`UPDATE physical_intimacy_milestones SET active=0 WHERE chat_id=? AND manual_override=0 AND EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId')=?)`).run(chatId, messageId);
  directPairs.forEach((pair) => queueRelationshipProjection(db, chatId, pair.from_entity, pair.to_entity, "replay"));
  invalidateSocialKnowledgeEvidence(db, chatId, [messageId]);
  if(invalidatedMessages) invalidatedMessages.add(messageId);
  else invalidateAutomaticTransitions(db,chatId,[messageId]).forEach(id=>invalidatedSupports.add(`promises:${id}`));
  const sourceOrdinal = (db.prepare("SELECT ordinal FROM messages WHERE chat_id=? AND message_id=?").get(chatId, messageId) as { ordinal: number } | undefined)?.ordinal ?? null;
  // Assertions retain historical validity intervals rather than an active flag.
  // Pin unversioned evidence to the old canonical source before it is replaced;
  // a closed historical fact must remain distinguishable from revoked evidence.
  const sourceHash = (db.prepare("SELECT canonical_hash FROM messages WHERE chat_id=? AND message_id=?").get(chatId,messageId) as {canonical_hash:string}|undefined)?.canonical_hash;
  if (sourceHash) {
    const rows=db.prepare(`SELECT id,evidence_json FROM assertions WHERE chat_id=? AND ${UNCORRECTED_SQL}
      AND EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId')=?)`).all(chatId,messageId) as Array<{id:string;evidence_json:string}>;
    for(const row of rows) {
      const evidence=JSON.parse(row.evidence_json).map((item: {messageId?:string;canonicalHash?:string;transitionCanonicalHash?:string}) =>
        item.messageId===messageId && !item.canonicalHash && !item.transitionCanonicalHash ? {...item,canonicalHash:sourceHash} : item);
      db.prepare("UPDATE assertions SET evidence_json=? WHERE id=?").run(JSON.stringify(evidence),row.id);
    }
  }
  recordSupports('assertions', db.prepare(`UPDATE assertions SET valid_to_revision=COALESCE(valid_to_revision,?),valid_to_ordinal=COALESCE(valid_to_ordinal,?)
    WHERE chat_id=? AND ${UNCORRECTED_SQL} AND EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId')=?) RETURNING id`).all(revision, sourceOrdinal, chatId, messageId) as Array<{id:string}>);
  recordSupports('beliefs', db.prepare(`UPDATE beliefs SET active=0,status='pending_review',valid_to_ordinal=COALESCE(valid_to_ordinal,?)
    WHERE chat_id=? AND ${UNCORRECTED_SQL} AND EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId')=?) RETURNING id`).all(sourceOrdinal, chatId, messageId) as Array<{id:string}>);
  if (sourceOrdinal !== null) {
    const directPromiseIds = (db.prepare(`SELECT DISTINCT p.id FROM promises p JOIN promise_events e ON e.promise_id=p.id AND e.chat_id=p.chat_id
      WHERE p.chat_id=? AND p.source_memory_id IS NULL AND p.user_edit_ordinal IS NULL AND p.auto_locked=0 AND e.source_ordinal=?`).all(chatId, sourceOrdinal) as Array<{ id: string }>).map((row) => row.id);
    if (directPromiseIds.length) {
      db.prepare(`UPDATE promises SET status='invalidated',updated_revision=? WHERE id IN (${directPromiseIds.map(() => "?").join(",")})`).run(revision, ...directPromiseIds);
      deactivateItemAccess(db, chatId, "promise", directPromiseIds);
      directPromiseIds.forEach(id => invalidatedSupports.add(`promises:${id}`));
    }
  }
  const memories = db.prepare(`SELECT DISTINCT memory_id FROM evidence_spans WHERE chat_id=? AND message_id=? AND memory_id IS NOT NULL`)
    .all(chatId, messageId) as Array<{ memory_id: string }>;
  if (memories.length === 0) return;
  const ids = memories.map((row) => row.memory_id);
  const placeholders = ids.map(() => "?").join(",");
  storyMemorySupportIds(db,chatId,ids).forEach(id=>invalidatedSupports.add(id));
  const detailIds = (db.prepare(`SELECT id FROM memory_details WHERE memory_id IN (${placeholders})`).all(...ids) as Array<{ id: string }>).map((row) => row.id);
  const dialogueIds = (db.prepare(`SELECT id FROM memory_dialogues WHERE memory_id IN (${placeholders})`).all(...ids) as Array<{ id: string }>).map((row) => row.id);
  const promiseIds = (db.prepare(`SELECT id FROM promises WHERE ${UNCORRECTED_SQL} AND source_memory_id IN (${placeholders})`).all(...ids) as Array<{ id: string }>).map((row) => row.id);
  const milestoneIds = (db.prepare(`SELECT id FROM physical_intimacy_milestones WHERE manual_override=0 AND source_memory_id IN (${placeholders})`).all(...ids) as Array<{ id: string }>).map((row) => row.id);
  if (detailIds.length) {
    const detailPlaceholders = detailIds.map(() => "?").join(",");
    deactivateAtomRelations((db.prepare(`SELECT id FROM atom_relations WHERE chat_id=? AND active=1
      AND (source_detail_id IN (${detailPlaceholders}) OR target_detail_id IN (${detailPlaceholders}))`).all(chatId, ...detailIds, ...detailIds) as Array<{ id: string }>).map((row) => row.id));
  }
  deactivateItemAccess(db, chatId, "detail", detailIds);
  deactivateItemAccess(db, chatId, "dialogue", dialogueIds);
  deactivateItemAccess(db, chatId, "promise", promiseIds);
  deactivateItemAccess(db, chatId, "physical_milestone", milestoneIds);
  db.prepare(`UPDATE memories SET active=0,updated_at=? WHERE id IN (${placeholders})`).run(timestamp, ...ids);
  db.prepare(`DELETE FROM memory_fts WHERE memory_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM memory_detail_fts WHERE memory_id IN (${placeholders})`).run(...ids);
  db.prepare(`UPDATE memory_details SET active=0 WHERE memory_id IN (${placeholders})`).run(...ids);
  recordSupports('assertions', db.prepare(`UPDATE assertions SET valid_to_revision=COALESCE(valid_to_revision,?) WHERE ${UNCORRECTED_SQL} AND source_memory_id IN (${placeholders}) RETURNING id`).all(revision, ...ids) as Array<{id:string}>);
  const invalidatedPromises = db.prepare(`SELECT * FROM promises WHERE ${UNCORRECTED_SQL} AND source_memory_id IN (${placeholders})`).all(...ids) as any[];
  db.prepare(`UPDATE promises SET status='invalidated',updated_revision=? WHERE ${UNCORRECTED_SQL} AND source_memory_id IN (${placeholders})`).run(revision, ...ids);
  promiseIds.forEach(id => invalidatedSupports.add(`promises:${id}`));
  for (const promise of invalidatedPromises) db.prepare(`INSERT INTO promise_events(id,chat_id,promise_id,promise_key,promisor,promisee,content,status,source_memory_id,source_ordinal,created_revision,created_at) VALUES(?,?,?,?,?,?,?,'invalidated',?,?,?,?)`).run(
    randomUUID(), chatId, promise.id, promise.promise_key, promise.promisor, promise.promisee, promise.content, promise.source_memory_id, sourceOrdinal, revision, now(),
  );
  db.prepare(`UPDATE physical_intimacy_milestones SET active=0 WHERE manual_override=0 AND source_memory_id IN (${placeholders})`).run(...ids);
  const qualitativePairs = db.prepare(`SELECT DISTINCT from_entity,to_entity FROM relationship_events WHERE source_memory_id IN (${placeholders})`).all(...ids) as Array<{ from_entity: string; to_entity: string }>;
  recordSupports('relationship_events', db.prepare(`UPDATE relationship_events SET active=0 WHERE active=1 AND source_memory_id IN (${placeholders}) RETURNING id`).all(...ids) as Array<{id:string}>);
  qualitativePairs.forEach((pair) => queueRelationshipProjection(db, chatId, pair.from_entity, pair.to_entity, "replay"));
  if (!recordConflict) return;
  db.prepare(`
    INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,status,created_revision,created_at)
    VALUES(?,?,?,?,?,'pending',?,?)
  `).run(randomUUID(), chatId, "source_revision", JSON.stringify({ messageId, memoryIds: ids }), JSON.stringify({ reason }), revision, now());
}

function staleSourceWork(db: RcmDatabase, chatId: string, messageId: string, reason: string, cancelQueued = false): void {
  const timestamp = now();
  const blocks = db.prepare(`SELECT id FROM embedding_blocks WHERE chat_id=?
    AND EXISTS(SELECT 1 FROM json_each(message_ids_json) WHERE value=?)`).all(chatId, messageId) as Array<{ id: string }>;
  for (const block of blocks) {
    db.prepare("UPDATE embedding_blocks SET status='stale',updated_at=? WHERE id=?").run(timestamp, block.id);
    db.prepare("DELETE FROM embedding_items WHERE block_id=?").run(block.id);
  }
  db.prepare(`UPDATE extraction_audits SET status='stale',error=COALESCE(error,?),updated_at=? WHERE chat_id=?
    AND EXISTS(SELECT 1 FROM json_each(source_message_ids_json) WHERE value=?)`).run(`Source ${reason}`, timestamp, chatId, messageId);
  db.prepare(`UPDATE reconciliation_items SET status='stale',model_error=COALESCE(model_error,?),resolved_at=? WHERE chat_id=? AND status='pending'
    AND EXISTS(SELECT 1 FROM json_each(source_message_ids_json) WHERE value=?)`).run(`Source ${reason}`, timestamp, chatId, messageId);
  if (!cancelQueued) return;
  const jobs = db.prepare("SELECT id,payload_json FROM jobs WHERE chat_id=? AND status='queued'").all(chatId) as Array<{ id: string; payload_json: string }>;
  for (const job of jobs) {
    try {
      const ids = (JSON.parse(job.payload_json) as { sourceMessageIds?: string[] }).sourceMessageIds ?? [];
      if (!ids.includes(messageId)) continue;
      db.prepare("UPDATE jobs SET status='done',last_error=?,updated_at=? WHERE id=?").run(`Source ${reason}`, timestamp, job.id);
      // A batch can contain several completed turns. Cancelling it for one
      // edited/removed source must release the still-valid peers so the next
      // scheduler pass can form a fresh canonical batch for them.
      const peers = ids.filter((id) => id !== messageId);
      if (peers.length) {
        const placeholders = peers.map(() => "?").join(",");
        db.prepare(`UPDATE messages SET extraction_state='pending' WHERE chat_id=? AND message_id IN (${placeholders})
          AND lifecycle='committed' AND host_visibility IN ('active','all_before') AND extraction_state='queued'`).run(chatId, ...peers);
      }
    } catch { /* malformed operational row is handled by normal job diagnostics */ }
  }
}

export interface SyncStats {
  inserted: number;
  revised: number;
  pruned: number;
  deleted: number;
  truncated: number;
  committedMessageIds: string[];
  revision: number;
}

export function hasDerivedState(db: RcmDatabase, chatId: string): boolean {
  const row = db.prepare(`SELECT
    EXISTS(SELECT 1 FROM memories WHERE chat_id=?) OR
    EXISTS(SELECT 1 FROM entities WHERE chat_id=?) OR
    EXISTS(SELECT 1 FROM assertions WHERE chat_id=?) OR
    EXISTS(SELECT 1 FROM beliefs WHERE chat_id=?) OR
    EXISTS(SELECT 1 FROM promises WHERE chat_id=?) OR
    EXISTS(SELECT 1 FROM relationship_baselines WHERE chat_id=?) OR
    EXISTS(SELECT 1 FROM relationship_events WHERE chat_id=?) OR
    EXISTS(SELECT 1 FROM relationship_projections WHERE chat_id=?) OR
    EXISTS(SELECT 1 FROM physical_intimacy_milestones WHERE chat_id=?) OR
    EXISTS(SELECT 1 FROM social_knowledge_events WHERE chat_id=?) OR
    EXISTS(SELECT 1 FROM reconciliation_items WHERE chat_id=?) OR
    EXISTS(SELECT 1 FROM jobs WHERE chat_id=?) AS present`).get(
    chatId, chatId, chatId, chatId, chatId, chatId, chatId, chatId, chatId, chatId, chatId, chatId,
  ) as { present: number } | undefined;
  return Boolean(row?.present);
}

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

function desiredLifecycle(messages: ChatMessageSnapshot[], index: number): MessageLifecycle {
  const message = messages[index];
  if (!message) return "committed";
  return message.role === "assistant" && index === messages.length - 1 ? "pending" : "committed";
}

function classifyMissing(
  oldOrdinal: number,
  retainedOldOrdinals: number[],
  previousLifecycle: MessageLifecycle,
): { lifecycle: MessageLifecycle; purgeAfter: number | null } {
  if (previousLifecycle === "pending") return { lifecycle: "superseded", purgeAfter: now() + 7 * DAY };
  if (retainedOldOrdinals.length === 0) return { lifecycle: "branch_truncated", purgeAfter: now() + 30 * DAY };
  const min = Math.min(...retainedOldOrdinals);
  const max = Math.max(...retainedOldOrdinals);
  if (oldOrdinal < min) return { lifecycle: "client_pruned", purgeAfter: null };
  if (oldOrdinal > max) return { lifecycle: "branch_truncated", purgeAfter: now() + 30 * DAY };
  return { lifecycle: "deleted", purgeAfter: now() + 30 * DAY };
}

export function syncSnapshot(db: RcmDatabase, request: TurnPrepareRequest): SyncStats {
  return db.transaction(() => {
    const timestamp = now();
    const existingChat = db.prepare("SELECT revision,static_hash,static_json,ingestion_state,memory_language,pending_memory_language,completed_turn_count FROM chats WHERE id = ?").get(request.chatId) as
      | { revision: number; static_hash: string | null; static_json: string | null; ingestion_state: string; memory_language: string; pending_memory_language: string | null; completed_turn_count: number }
      | undefined;
    const requestedMemoryLanguage = request.memoryLanguage ?? existingChat?.memory_language ?? "en";
    const initialIngestionState = request.messages.length > 10 && request.backfillApproved !== true && !request.forceBackfill
      ? "historical_pending"
      : "managed";
    db.prepare(`
      INSERT INTO chats(id, chat_title, character_id, profile, include_user_messages, extraction_group_turns, edit_protection_turns, normalization_policy_json, memory_language, ingestion_state, revision, static_hash, static_json, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        chat_title=COALESCE(NULLIF(excluded.chat_title,''), chats.chat_title),
        character_id=excluded.character_id,
        profile=excluded.profile,
        include_user_messages=excluded.include_user_messages,
        extraction_group_turns=excluded.extraction_group_turns,
        edit_protection_turns=excluded.edit_protection_turns,
        normalization_policy_json=excluded.normalization_policy_json,
        static_hash=COALESCE(excluded.static_hash, chats.static_hash),
        static_json=COALESCE(excluded.static_json, chats.static_json),
        updated_at=excluded.updated_at
    `).run(
      request.chatId,
      request.chatTitle?.trim() ?? null,
      request.characterId,
      request.profile,
      request.includeUserMessages !== false ? 1 : 0,
      request.extractionGroupTurns ?? 6,
      request.editProtectionTurns ?? 2,
      JSON.stringify(request.canonicalizationPolicy ?? defaultCanonicalizationPolicy()),
      requestedMemoryLanguage,
      initialIngestionState,
      request.staticProjection?.hash ?? null,
      request.staticProjection ? JSON.stringify(request.staticProjection) : null,
      timestamp,
      timestamp,
    );
    if (request.identityHints !== undefined) db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(personaHintKey(request.chatId), JSON.stringify(request.identityHints.userPersonaName?.trim() || null));
    if (existingChat) {
      const derivedExists = hasDerivedState(db, request.chatId);
      if (requestedMemoryLanguage === existingChat.memory_language) {
        if (existingChat.pending_memory_language) db.prepare("UPDATE chats SET pending_memory_language=NULL WHERE id=?").run(request.chatId);
      } else if (derivedExists) {
        db.prepare("UPDATE chats SET pending_memory_language=? WHERE id=?").run(requestedMemoryLanguage, request.chatId);
      } else {
        db.prepare("UPDATE chats SET memory_language=?,pending_memory_language=NULL WHERE id=?").run(requestedMemoryLanguage, request.chatId);
      }
    }
    if (existingChat && (request.forceBackfill || request.backfillApproved === true) && existingChat.ingestion_state === "historical_pending") {
      db.prepare("UPDATE chats SET ingestion_state='managed' WHERE id=?").run(request.chatId);
    }

    // Card and lore projection hashes can change as activation keys toggle.
    // They are context metadata, not an actionable contradiction in the RP
    // ledger, so keep the latest projection without creating a Conflict.

    const stored = db
      .prepare("SELECT message_id, ordinal, role, content, content_hash, canonical_content, canonical_hash, lifecycle, visible, extraction_state, source_kind,source_record_id,display_content_hash,display_comparison_hash,host_visibility FROM messages WHERE chat_id = ? ORDER BY ordinal")
      .all(request.chatId) as StoredMessage[];
    const byId = new Map(stored.map((message) => [message.message_id, message]));
    const incoming = request.messages;
    const visibilityProjection: NonNullable<TurnPrepareRequest["messageVisibility"]> = request.messageVisibility ?? request.messages.map((message) => ({
      id: message.id,
      ordinal: message.ordinal,
      visibility: message.disabled ? "disabled" as const : "active" as const,
    }));
    const visibilityById = new Map(visibilityProjection.map((item) => [item.id, item.visibility]));
    const projectionById = new Map(visibilityProjection.map((item) => [item.id, item]));
    const incomingIds = new Set(incoming.map((message) => message.id));
    // messageVisibility is the complete lightweight host projection even when
    // message contents are sent as a tail snapshot. Its IDs therefore prove
    // which old source rows still exist after /del or /cut.
    const presentIds = request.messageVisibility
      ? new Set(request.messageVisibility.map((item) => item.id))
      : incomingIds;
    const retainedOldOrdinals = stored.filter((message) => presentIds.has(message.message_id)).map((message) => message.ordinal);
    const committedMessageIds: string[] = [];
    let inserted = 0;
    let revised = 0;
    let pruned = 0;
    let deleted = 0;
    let truncated = 0;
    let changed = false;

    const canClassifyMissing = request.snapshotScope !== "tail" || request.messageVisibility !== undefined;
    const invalidatedMessages=new Set<string>();
    const invalidatedSupports=new Set<string>();
    for (const previous of canClassifyMissing ? stored : []) {
      if (previous.source_kind === "archive") continue;
      if (presentIds.has(previous.message_id)) continue;
      if (["client_pruned", "branch_truncated", "deleted", "hard_deleted", "superseded"].includes(previous.lifecycle)) continue;
      const classification = classifyMissing(previous.ordinal, retainedOldOrdinals, previous.lifecycle);
      db.prepare("UPDATE messages SET lifecycle=?, visible=0, updated_at=? WHERE chat_id=? AND message_id=?").run(
        classification.lifecycle,
        timestamp,
        request.chatId,
        previous.message_id,
      );
      db.prepare(`
        UPDATE message_revisions SET lifecycle=?, purge_after=COALESCE(purge_after, ?)
        WHERE chat_id=? AND message_id=? AND content_hash=?
      `).run(classification.lifecycle, classification.purgeAfter, request.chatId, previous.message_id, previous.content_hash);
      if (classification.lifecycle === "branch_truncated") {
        invalidateDerived(db, request.chatId, previous.message_id, (existingChat?.revision ?? 0) + 1, classification.lifecycle, true, invalidatedMessages, invalidatedSupports);
      } else if (classification.lifecycle === "deleted" || classification.lifecycle === "superseded") {
        staleSourceWork(db, request.chatId, previous.message_id, classification.lifecycle, true);
      }
      if (classification.lifecycle === "client_pruned") pruned += 1;
      else if (classification.lifecycle === "branch_truncated") truncated += 1;
      else deleted += 1;
      changed = true;
    }

    // Rebase against surviving old committed sources before inserting this
    // snapshot's replacement branch, which already happened after the edit.
    if (truncated > 0) rebaseCorrectionsAfterTailRollback(db, request.chatId);
    incoming.forEach((message, index) => {
      const projection = projectionById.get(message.id);
      const incomingSourceKind = message.sourceKind ?? "host";
      const lifecycle = desiredLifecycle(incoming, index);
      const previous = byId.get(message.id);
      // Yumi may evict its old translation record while leaving the translated
      // display and marker on the Risu message. Once RCM has captured the model
      // source, preserve it while the host display's comparison fingerprint is
      // unchanged. This also treats image-only display replacements as
      // presentation changes. A real prose edit changes the fingerprint and is
      // processed as a normal source revision.
      const preserveCapturedSource = Boolean(previous?.source_kind === "yumi_model"
        && incomingSourceKind === "risu_display"
        && previous.display_comparison_hash
        && projection?.displayComparisonHash === previous.display_comparison_hash);
      const sourceKind = preserveCapturedSource ? previous!.source_kind : incomingSourceKind;
      const content = preserveCapturedSource && previous?.content != null ? previous.content : message.content;
      const hash = sha256(`${message.role}\0${content}`);
      const sourceRecordId = request.messageVisibility
        ? projection?.sourceRecordId ?? null
        : previous?.source_record_id ?? null;
      const displayContentHash = request.messageVisibility
        ? projection?.displayContentHash ?? null
        : previous?.display_content_hash ?? null;
      const displayComparisonHash = request.messageVisibility
        ? projection?.displayComparisonHash ?? null
        : previous?.display_comparison_hash ?? null;
      // Saving a different normalization policy must not silently rebuild the
      // historical ledger during an ordinary tail sync. Recompute canonical
      // text here only when the host's raw message itself changed; the manual
      // rebuild path explicitly recanonicalizes the complete ledger.
      // Keep the materialized evidence view (including its exact offsets) for
      // image-only edits. The current raw text/revision is still saved below.
      // Never carry this exemption across role/source changes or deleted text.
      const policy = request.canonicalizationPolicy ?? defaultCanonicalizationPolicy();
      const imageOnlyChange = previous?.content != null && previous.content_hash !== hash && previous.role === message.role
        && previous.source_kind === sourceKind
        && isImageOnlySourceChange(canonicalizeSourceText(previous.content, policy), canonicalizeSourceText(content, policy));
      const reuseCanonical = Boolean(previous && previous.canonical_content !== null
        && (previous.content_hash === hash || imageOnlyChange));
      const canonicalContent = reuseCanonical
        ? previous!.canonical_content!
        : canonicalizeSourceText(content, policy);
      const canonicalHash = reuseCanonical
        ? previous!.canonical_hash
        : sha256(`${message.role}\0${canonicalContent}`);
      if (!previous) {
        const hostVisibility = visibilityById.get(message.id) ?? (message.disabled ? "disabled" : "active");
        const hostActive = archiveEligibleVisibility(hostVisibility);
        db.prepare(`
          INSERT INTO messages(chat_id,message_id,role,ordinal,content,content_hash,canonical_content,canonical_hash,lifecycle,visible,event_time,generation_id,source_kind,source_record_id,display_content_hash,display_comparison_hash,host_visibility,extraction_state,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          request.chatId,
          message.id,
          message.role,
          message.ordinal,
          content,
          hash,
          canonicalContent,
          canonicalHash,
          lifecycle,
          hostActive ? 1 : 0,
          message.time ?? null,
          message.generationId ?? null,
          sourceKind,
          sourceRecordId,
          displayContentHash,
          displayComparisonHash,
          hostVisibility,
          lifecycle === "committed" && hostActive ? "pending" : "blocked",
          timestamp,
        );
        db.prepare(`
          INSERT INTO message_revisions(id,chat_id,message_id,content,content_hash,canonical_content,canonical_hash,lifecycle,created_at,purge_after)
          VALUES(?,?,?,?,?,?,?,?,?,NULL)
        `).run(randomUUID(), request.chatId, message.id, content, hash, canonicalContent, canonicalHash, lifecycle, timestamp);
        if (lifecycle === "committed" && hostActive) committedMessageIds.push(message.id);
        inserted += 1;
        changed = true;
        return;
      }

      const contentChanged = previous.content_hash !== hash;
      const canonicalChanged = previous.canonical_hash !== canonicalHash;
      const sourceKindChanged = previous.source_kind !== sourceKind;
      const sourceMetadataChanged = previous.source_record_id !== sourceRecordId
        || previous.display_content_hash !== displayContentHash
        || previous.display_comparison_hash !== displayComparisonHash;
      const hostActive = archiveEligibleVisibility(visibilityById.get(message.id) ?? (message.disabled ? "disabled" : "active"));
      const representationChanged = sourceKindChanged && (
        (previous.source_kind === "risu_display" && sourceKind === "yumi_model")
        // Old DB rows without a captured display fingerprint cannot prove
        // whether a missing Yumi record or a prose edit caused this downgrade.
        // Keep the historic fail-safe classification for those rows only.
        || (previous.source_kind === "yumi_model" && sourceKind === "risu_display" && !previous.display_comparison_hash)
      );
      const lifecycleChanged = previous.lifecycle !== lifecycle;
      if (contentChanged) {
        const oldPurge = previous.lifecycle === "pending" ? timestamp + 7 * DAY : timestamp + 30 * DAY;
        db.prepare(`
          UPDATE message_revisions SET lifecycle='superseded', purge_after=COALESCE(purge_after, ?)
          WHERE chat_id=? AND message_id=? AND content_hash=?
        `).run(oldPurge, request.chatId, message.id, previous.content_hash);
        db.prepare(`
          INSERT INTO message_revisions(id,chat_id,message_id,content,content_hash,canonical_content,canonical_hash,lifecycle,created_at,purge_after)
          VALUES(?,?,?,?,?,?,?,?,?,NULL)
        `).run(randomUUID(), request.chatId, message.id, content, hash, canonicalContent, canonicalHash, lifecycle, timestamp);
        if (canonicalChanged) invalidateDerived(
          db, request.chatId, message.id, (existingChat?.revision ?? 0) + 1,
          representationChanged ? "source_representation_changed" : "content_revised",
          !representationChanged,
          invalidatedMessages,
          invalidatedSupports,
        );
        revised += 1;
      } else if (lifecycleChanged) {
        db.prepare(`
          UPDATE message_revisions SET lifecycle=?, purge_after=NULL
          WHERE chat_id=? AND message_id=? AND content_hash=?
        `).run(lifecycle, request.chatId, message.id, hash);
      }

      const sourceStateChanged = contentChanged || lifecycleChanged || sourceKindChanged || previous.ordinal !== message.ordinal;
      if (sourceStateChanged || sourceMetadataChanged) {
        const extractionState = !hostActive ? "blocked"
          : lifecycle === "committed" && (canonicalChanged || lifecycleChanged || previous.extraction_state === "blocked") ? "pending"
            : previous.extraction_state;
        db.prepare(`
          UPDATE messages SET role=?, ordinal=?, content=?, content_hash=?, canonical_content=?, canonical_hash=?, lifecycle=?,
            event_time=?, generation_id=?, source_kind=?, source_record_id=?, display_content_hash=?, display_comparison_hash=?, extraction_state=?, updated_at=?
          WHERE chat_id=? AND message_id=?
        `).run(
          message.role,
          message.ordinal,
          content,
          hash,
          canonicalContent,
          canonicalHash,
          lifecycle,
          message.time ?? null,
          message.generationId ?? null,
          sourceKind,
          sourceRecordId,
          displayContentHash,
          displayComparisonHash,
          extractionState,
          timestamp,
          request.chatId,
          message.id,
        );
        if (sourceStateChanged) {
          if (lifecycle === "committed" && hostActive && extractionState === "pending") committedMessageIds.push(message.id);
          changed = true;
        }
      }
    });

    // Large chats send a complete lightweight projection with only a tail of
    // message bodies. Capture the first trustworthy display baseline for old
    // retained model sources too, without treating metadata materialization as
    // a story revision. Once a baseline exists, a changed off-tail display is
    // left untouched until that message body is synchronized and can undergo
    // the normal edit/invalidation path.
    if (request.messageVisibility) {
      const captureBaseline = db.prepare(`UPDATE messages SET
        source_record_id=COALESCE(source_record_id,?),
        display_content_hash=COALESCE(display_content_hash,?),
        display_comparison_hash=COALESCE(display_comparison_hash,?),updated_at=?
        WHERE chat_id=? AND message_id=? AND source_kind='yumi_model'`);
      for (const item of visibilityProjection) {
        if (incomingIds.has(item.id)) continue;
        const previous = byId.get(item.id);
        if (!previous || previous.source_kind !== "yumi_model") continue;
        if (previous.display_comparison_hash) continue;
        captureBaseline.run(item.sourceRecordId ?? null, item.displayContentHash ?? null,
          item.displayComparisonHash ?? null, timestamp, request.chatId, item.id);
      }
    }

    if (applyHostVisibilityProjection(db, request.chatId, visibilityProjection, (existingChat?.revision ?? 0) + 1) > 0) changed = true;

    // Assign one monotonic sequence to each newly settled U+A unit. Raw edits,
    // rerolls of the same message ID, /del and /cut never advance or rewind
    // this clock. Assistant-only greetings remain outside the RP turn clock.
    const storedTurnClock = db.prepare("SELECT MAX(completed_turn_seq) AS value FROM messages WHERE chat_id=?")
      .get(request.chatId) as { value: number | null };
    let completedTurns = Math.max(existingChat?.completed_turn_count ?? 0, storedTurnClock.value ?? 0);
    const turnRows = db.prepare(`SELECT message_id,role,lifecycle,host_visibility,completed_turn_seq
      FROM messages WHERE chat_id=? AND role IN ('user','assistant') ORDER BY ordinal`).all(request.chatId) as Array<{
      message_id: string;
      role: "user" | "assistant";
      lifecycle: MessageLifecycle;
      host_visibility: string;
      completed_turn_seq: number | null;
    }>;
    let waitingUsers: string[] = [];
    const assignTurn = db.prepare("UPDATE messages SET completed_turn_seq=? WHERE chat_id=? AND message_id=? AND completed_turn_seq IS NULL");
    for (const row of turnRows) {
      if (row.completed_turn_seq !== null) {
        if (row.role === "assistant") waitingUsers = [];
        continue;
      }
      if (!archiveEligibleVisibility(row.host_visibility) || !["committed", "client_pruned"].includes(row.lifecycle)) continue;
      if (row.role === "user") {
        waitingUsers.push(row.message_id);
        continue;
      }
      if (waitingUsers.length === 0) continue;
      completedTurns += 1;
      for (const messageId of [...waitingUsers, row.message_id]) assignTurn.run(completedTurns, request.chatId, messageId);
      waitingUsers = [];
    }

    const revision = existingChat?.revision ?? 0;
    const nextRevision = changed ? revision + 1 : revision;
    if (changed) {
      db.prepare("UPDATE chats SET revision=?,completed_turn_count=?,updated_at=? WHERE id=?").run(nextRevision, completedTurns, timestamp, request.chatId);
    }

    invalidateAutomaticTransitions(db,request.chatId,[...invalidatedMessages]).forEach(id=>invalidatedSupports.add(`promises:${id}`));
    syncManualCognition(db,request.chatId,invalidatedSupports);
    markStorySupportsInvalid(db,request.chatId,invalidatedSupports);
    // Ordinary sync also resumes repairs left pending by an earlier source-only
    // sync, even when there are no new invalidations or extraction candidates.
    if (!request.deferExtraction) maybeEnqueueStorySpine(db,request.chatId);
    return { inserted, revised, pruned, deleted, truncated, committedMessageIds, revision: nextRevision };
  })();
}

export function recanonicalizeSourceLedger(db: RcmDatabase, chatId: string): number {
  const chat = db.prepare("SELECT normalization_policy_json FROM chats WHERE id=?").get(chatId) as
    | { normalization_policy_json: string }
    | undefined;
  if (!chat) throw new Error("Chat not found");
  let policy = defaultCanonicalizationPolicy();
  try {
    const storedPolicy = JSON.parse(chat.normalization_policy_json) as Partial<typeof policy>;
    policy = {
      useLightboard: storedPolicy.useLightboard === true,
      useGigaTrans: true,
      customRules: Array.isArray(storedPolicy.customRules) ? storedPolicy.customRules : [],
    };
  } catch {
    // An older or manually edited invalid policy falls back to safe defaults
    // instead of blocking recovery from the raw ledger.
  }
  const messages = db.prepare("SELECT message_id,role,content FROM messages WHERE chat_id=? AND content IS NOT NULL").all(chatId) as Array<{
    message_id: string;
    role: StoredMessage["role"];
    content: string;
  }>;
  const updateMessage = db.prepare("UPDATE messages SET canonical_content=?,canonical_hash=?,updated_at=? WHERE chat_id=? AND message_id=?");
  const updateRevision = db.prepare("UPDATE message_revisions SET canonical_content=?,canonical_hash=? WHERE chat_id=? AND message_id=? AND content_hash=?");
  const revisionRows = db.prepare("SELECT message_id,content,content_hash FROM message_revisions WHERE chat_id=? AND content IS NOT NULL");
  return db.transaction(() => {
    let changed = 0;
    const roles = new Map(messages.map((message) => [message.message_id, message.role]));
    for (const message of messages) {
      const canonical = canonicalizeSourceText(message.content, policy);
      const canonicalHash = sha256(`${message.role}\0${canonical}`);
      changed += updateMessage.run(canonical, canonicalHash, now(), chatId, message.message_id).changes;
    }
    for (const revision of revisionRows.all(chatId) as Array<{ message_id: string; content: string; content_hash: string }>) {
      const role = roles.get(revision.message_id);
      if (!role) continue;
      const canonical = canonicalizeSourceText(revision.content, policy);
      updateRevision.run(canonical, sha256(`${role}\0${canonical}`), chatId, revision.message_id, revision.content_hash);
    }
    return changed;
  })();
}

export function purgeExpiredContent(db: RcmDatabase): number {
  const timestamp = now();
  return db.transaction(() => {
    const revisions = db.prepare(`
      UPDATE message_revisions SET content=NULL,canonical_content=NULL
      WHERE purge_after IS NOT NULL AND purge_after <= ? AND content IS NOT NULL
    `).run(timestamp).changes;
    const messages = db.prepare(`
      UPDATE messages SET content=NULL,canonical_content=NULL
      WHERE lifecycle IN ('superseded','branch_truncated','deleted','hard_deleted')
        AND updated_at <= ? AND content IS NOT NULL
    `).run(timestamp - 30 * DAY).changes;
    return revisions + messages;
  })();
}

export function hardDeleteMessage(db: RcmDatabase, chatId: string, messageId: string): boolean {
  return db.transaction(() => {
    const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
    const message = db.prepare("SELECT message_id FROM messages WHERE chat_id=? AND message_id=?").get(chatId, messageId);
    if (!chat || !message) return false;
    const invalidatedSupports=new Set<string>();
    invalidateDerived(db, chatId, messageId, chat.revision + 1, "hard_deleted",true,undefined,invalidatedSupports);
    db.prepare(`
      UPDATE message_revisions SET content=NULL,canonical_content=NULL,lifecycle='hard_deleted',purge_after=?
      WHERE chat_id=? AND message_id=?
    `).run(now(), chatId, messageId);
    db.prepare(`
      UPDATE messages SET content=NULL,canonical_content=NULL,lifecycle='hard_deleted',visible=0,extraction_state='blocked',updated_at=?
      WHERE chat_id=? AND message_id=?
    `).run(now(), chatId, messageId);
    db.prepare("UPDATE chats SET revision=revision+1,updated_at=? WHERE id=?").run(now(), chatId);
    syncManualCognition(db,chatId,invalidatedSupports);
    invalidateStorySupports(db,chatId,invalidatedSupports);
    return true;
  })();
}
