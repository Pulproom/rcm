import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { clearAuxiliaryInputs } from './auxiliary-input-cache.js';
import type { RcmDatabase } from "./db.js";
import type { EmbeddingService } from "./embedding.js";
import { deleteDerivedRows } from "./derived-state.js";
import { rewindAutomaticSuccessorsToCorrections } from "./user-corrections.js";
import { materializeInitialRelationshipProjections } from "./initial-calibration.js";
import { memoryBookmarksKey } from "./memory-bookmarks.js";
import { viewPreferencesKey } from "./view-preferences.js";
import { removedAliasesKey } from "./user-deletions.js";
import { dialogueAccessIdentityKey, detailAccessEditsKey } from "./item-access.js";
import { chatPacketBudgetKey } from "./story-spine.js";

export interface ChatAdminSummary {
  id: string;
  chatTitle: string;
  characterId: string;
  characterName: string;
  profile: string;
  memoryLanguage: "en" | "ko" | "ja" | "zh";
  pendingMemoryLanguage?: "en" | "ko" | "ja" | "zh";
  updatedAt: number;
  messages: number;
  committedMessages: number;
  activeMessages: number;
  hasImportedMemory: boolean;
  clientPrunedMessages: number;
  disabledMessages: number;
  memories: number;
  relationships: number;
  assertions: number;
  beliefs: number;
  promises: number;
  pendingReviews: number;
  pendingConflicts: number;
  embeddings: number;
  jobs: number;
  reprocessableMessages: number;
  ingestionState: "historical_pending" | "managed" | "cleared";
  bufferedMessages: number;
  waitingForAssistant: number;
  recoverableMessages: number;
  historicalBackfillMessages: number;
  approximateBytes: number;
  retrievalDiagnosticsEnabled?: boolean;
  lineage?: { status: string; kind?: string; parentChatId?: string; parentTitle?: string; forkOrdinal?: number };
}

function activeLeaseCount(db: RcmDatabase, chatIds: string[]): number {
  if (chatIds.length === 0) return 0;
  const placeholders = chatIds.map(() => "?").join(",");
  return (db.prepare(`
    SELECT count(*) AS count FROM jobs
    WHERE chat_id IN (${placeholders}) AND status='leased' AND leased_until>=?
  `).get(...chatIds, Date.now()) as { count: number }).count;
}

function requireNoActiveLease(db: RcmDatabase, chatIds: string[]): void {
  if (activeLeaseCount(db, chatIds) > 0) throw new Error("Active extraction call must finish before deleting memory data");
}

export function listAdminChats(db: RcmDatabase, includeRetrievalDiagnostics = false): ChatAdminSummary[] {
  const rows = db.prepare(`
    SELECT c.id,c.chat_title,c.character_id,c.profile,c.memory_language,c.pending_memory_language,c.static_json,c.ingestion_state,c.updated_at,
      l.status AS lineage_status,l.kind AS lineage_kind,l.parent_chat_id,l.parent_title,l.fork_ordinal,
      (SELECT count(*) FROM messages m WHERE m.chat_id=c.id) AS messages,
      (SELECT count(*) FROM messages m WHERE m.chat_id=c.id AND m.source_kind<>'archive' AND m.host_visibility='active' AND m.lifecycle IN ('committed','pending')) AS active_messages,
      EXISTS(SELECT 1 FROM messages m WHERE m.chat_id=c.id AND m.source_kind='archive') AS has_imported_memory,
      (SELECT count(*) FROM messages m WHERE m.chat_id=c.id AND m.lifecycle='committed') AS committed_messages,
      (SELECT count(*) FROM messages m WHERE m.chat_id=c.id AND m.lifecycle='client_pruned') AS client_pruned_messages,
      (SELECT count(*) FROM messages m WHERE m.chat_id=c.id AND m.host_visibility IN ('disabled','comment')) AS disabled_messages,
      (SELECT count(*) FROM memories m WHERE m.chat_id=c.id) AS memories,
      (SELECT count(*) FROM relationship_projections r WHERE r.chat_id=c.id) AS relationships,
      (SELECT count(*) FROM assertions a WHERE a.chat_id=c.id) AS assertions,
      (SELECT count(*) FROM beliefs b WHERE b.chat_id=c.id) AS beliefs,
      (SELECT count(*) FROM promises p WHERE p.chat_id=c.id) AS promises,
      (SELECT count(*) FROM reconciliation_items r WHERE r.chat_id=c.id AND r.status='pending') AS pending_reviews,
      (SELECT count(*) FROM conflicts x WHERE x.chat_id=c.id AND x.status='pending' AND x.kind<>'static_projection_changed') AS pending_conflicts,
      (SELECT count(*) FROM embedding_items e WHERE e.chat_id=c.id) AS embeddings,
      (SELECT count(*) FROM jobs j WHERE j.chat_id=c.id) AS jobs,
      (SELECT count(*) FROM server_meta s WHERE s.key='retrieval_trace_chat:' || c.id AND s.value='1') AS retrieval_diagnostics_enabled,
      (SELECT count(*) FROM messages m WHERE m.chat_id=c.id AND m.lifecycle IN ('committed','client_pruned') AND m.host_visibility IN ('active','all_before') AND m.memory_excluded=0 AND m.content IS NOT NULL AND m.extraction_state IN ('pending','cancelled')) AS reprocessable_messages,
      (SELECT count(*) FROM messages m WHERE m.chat_id=c.id AND m.lifecycle='committed' AND m.host_visibility IN ('active','all_before') AND m.memory_excluded=0 AND m.content IS NOT NULL AND m.extraction_state='pending') AS buffered_messages,
      (SELECT count(*) FROM messages m WHERE m.chat_id=c.id AND m.role='user' AND m.lifecycle='committed' AND m.host_visibility IN ('active','all_before') AND m.memory_excluded=0 AND m.extraction_state='pending' AND NOT EXISTS (SELECT 1 FROM messages a WHERE a.chat_id=m.chat_id AND a.role='assistant' AND a.lifecycle='committed' AND a.host_visibility IN ('active','all_before') AND a.ordinal>m.ordinal)) AS waiting_for_assistant,
      (SELECT count(*) FROM messages m WHERE m.chat_id=c.id AND m.lifecycle IN ('committed','client_pruned') AND m.host_visibility IN ('active','all_before') AND m.memory_excluded=0 AND m.content IS NOT NULL AND m.extraction_state='cancelled') AS recoverable_messages,
      COALESCE((SELECT sum(length(CAST(content AS BLOB))) FROM messages m WHERE m.chat_id=c.id),0)
        + COALESCE((SELECT sum(length(CAST(title AS BLOB))+length(CAST(content AS BLOB))) FROM memories m WHERE m.chat_id=c.id),0) AS approximate_bytes
    FROM chats c LEFT JOIN chat_lineage l ON l.child_chat_id=c.id ORDER BY c.updated_at DESC
  `).all() as Array<{
    id: string; chat_title: string | null; character_id: string; profile: string; memory_language: "en" | "ko" | "ja" | "zh"; pending_memory_language: "en" | "ko" | "ja" | "zh" | null; static_json: string | null; ingestion_state: "historical_pending" | "managed" | "cleared"; updated_at: number;
    messages: number; active_messages: number; has_imported_memory: number; committed_messages: number; client_pruned_messages: number; disabled_messages: number; memories: number; relationships: number; assertions: number; beliefs: number; promises: number; pending_reviews: number; pending_conflicts: number; embeddings: number; jobs: number; retrieval_diagnostics_enabled: number; reprocessable_messages: number; buffered_messages: number; waiting_for_assistant: number; recoverable_messages: number; approximate_bytes: number;
    lineage_status: string | null; lineage_kind: string | null; parent_chat_id: string | null; parent_title: string | null; fork_ordinal: number | null;
  }>;
  return rows.map((row) => {
    let characterName = row.character_id;
    try {
      const projection = JSON.parse(row.static_json ?? "{}") as { characterName?: string };
      if (projection.characterName?.trim()) characterName = projection.characterName.trim();
    } catch { /* character ID remains a stable fallback */ }
    return {
      id: row.id,
      chatTitle: row.chat_title?.trim() || "",
      characterId: row.character_id,
      characterName,
      profile: row.profile,
      memoryLanguage: row.memory_language,
      pendingMemoryLanguage: row.pending_memory_language ?? undefined,
      ...(includeRetrievalDiagnostics ? { retrievalDiagnosticsEnabled: row.retrieval_diagnostics_enabled > 0 } : {}),
      updatedAt: row.updated_at,
      messages: row.messages,
      activeMessages: row.active_messages,
      hasImportedMemory: Boolean(row.has_imported_memory),
      committedMessages: row.committed_messages,
      clientPrunedMessages: row.client_pruned_messages,
      disabledMessages: row.disabled_messages,
      memories: row.memories,
      relationships: row.relationships,
      assertions: row.assertions,
      beliefs: row.beliefs,
      promises: row.promises,
      pendingReviews: row.pending_reviews,
      pendingConflicts: row.pending_conflicts,
      embeddings: row.embeddings,
      jobs: row.jobs,
      reprocessableMessages: row.reprocessable_messages,
      ingestionState: row.ingestion_state,
      bufferedMessages: row.ingestion_state === "managed" ? row.buffered_messages : 0,
      waitingForAssistant: row.waiting_for_assistant,
      recoverableMessages: row.recoverable_messages,
      historicalBackfillMessages: row.ingestion_state === "historical_pending" ? row.buffered_messages : 0,
      approximateBytes: row.approximate_bytes,
      lineage: row.lineage_status ? { status: row.lineage_status, kind: row.lineage_kind ?? undefined, parentChatId: row.parent_chat_id ?? undefined, parentTitle: row.parent_title ?? undefined, forkOrdinal: row.fork_ordinal ?? undefined } : undefined,
    };
  });
}

export function resetDerivedChat(db: RcmDatabase, embeddings: EmbeddingService, chatId: string): boolean {
  const exists = db.prepare("SELECT 1 FROM chats WHERE id=?").get(chatId);
  if (!exists) return false;
  requireNoActiveLease(db, [chatId]);
  embeddings.removeChat(chatId);
  db.transaction(() => {
    deleteDerivedRows(db, chatId, { preserveInitialCalibration: true });
    materializeInitialRelationshipProjections(db, chatId);
    db.prepare(`
      UPDATE messages SET extraction_state='cancelled',updated_at=?
      WHERE chat_id=? AND content IS NOT NULL AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')
    `).run(Date.now(), chatId);
    db.prepare("DELETE FROM chat_lineage_items WHERE child_chat_id=? AND item_kind<>'message'").run(chatId);
    db.prepare("UPDATE chats SET ingestion_state='cleared',updated_at=? WHERE id=?").run(Date.now(), chatId);
  })();
  return true;
}

export function reprocessChat(
  db: RcmDatabase,
  embeddings: EmbeddingService,
  chatId: string,
  activatePendingMemoryLanguage = false,
): number {
  const chat = db.prepare("SELECT pending_memory_language FROM chats WHERE id=?").get(chatId) as { pending_memory_language: string | null } | undefined;
  if (!chat) throw new Error("Chat not found");
  requireNoActiveLease(db, [chatId]);
  embeddings.removeChat(chatId);
  const timestamp = Date.now();
  return db.transaction(() => {
    rewindAutomaticSuccessorsToCorrections(db,chatId);
    deleteDerivedRows(db, chatId, { preserveInitialCalibration: true, preserveUserCorrections: true });
    materializeInitialRelationshipProjections(db, chatId);
    db.prepare("DELETE FROM chat_lineage_items WHERE child_chat_id=? AND item_kind<>'message'").run(chatId);
    const changed = db.prepare(`
      UPDATE messages SET extraction_state='pending',updated_at=?
      WHERE chat_id=? AND content IS NOT NULL AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')
    `).run(timestamp, chatId).changes;
    if (activatePendingMemoryLanguage && chat.pending_memory_language) {
      db.prepare(`UPDATE chats SET memory_language=pending_memory_language,pending_memory_language=NULL,ingestion_state='managed',updated_at=? WHERE id=?`).run(timestamp, chatId);
    } else {
      db.prepare(`UPDATE chats SET ingestion_state='managed',updated_at=? WHERE id=?`).run(timestamp, chatId);
    }
    return changed;
  })();
}

export function prepareChatReprocess(db: RcmDatabase, chatId: string): number {
  requireNoActiveLease(db, [chatId]);
  return db.transaction(() => {
    const changed = db.prepare(`
      UPDATE messages SET extraction_state='pending',updated_at=?
      WHERE chat_id=? AND content IS NOT NULL AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')
    `).run(Date.now(), chatId).changes;
    db.prepare("UPDATE chats SET ingestion_state='managed',updated_at=? WHERE id=?").run(Date.now(), chatId);
    return changed;
  })();
}

export interface SourceLedgerPage {
  items: Array<Record<string, unknown>>;
  total: number;
  offset: number;
  limit: number;
  includesContent: boolean;
}

export function listSourceLedger(db: RcmDatabase, chatId: string, offset: number, limit: number, includeContent: boolean): SourceLedgerPage {
  const boundedOffset = Math.max(0, Math.floor(offset));
  const boundedLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  const total = Number((db.prepare("SELECT count(*) count FROM messages WHERE chat_id=?").get(chatId) as { count: number } | undefined)?.count ?? 0);
  if (!db.prepare("SELECT 1 FROM chats WHERE id=?").get(chatId)) throw new Error("Chat not found");
  const fields = includeContent
    ? "message_id,role,ordinal,lifecycle,host_visibility,extraction_state,memory_excluded,event_time,updated_at,length(CAST(content AS BLOB)) AS content_bytes,content"
    : "message_id,role,ordinal,lifecycle,host_visibility,extraction_state,memory_excluded,event_time,updated_at,length(CAST(content AS BLOB)) AS content_bytes,content IS NOT NULL AS has_content";
  const items = db.prepare(`SELECT ${fields} FROM messages WHERE chat_id=? ORDER BY CASE lifecycle WHEN 'client_pruned' THEN 0 ELSE 1 END,ordinal LIMIT ? OFFSET ?`)
    .all(chatId, boundedLimit, boundedOffset) as Array<Record<string, unknown>>;
  return { items, total, offset: boundedOffset, limit: boundedLimit, includesContent: includeContent };
}

export function deleteChats(db: RcmDatabase, embeddings: EmbeddingService, chatIds: string[]): number {
  const unique = [...new Set(chatIds)];
  if (unique.length === 0) return 0;
  requireNoActiveLease(db, unique);
  unique.forEach((chatId) => embeddings.removeChat(chatId));
  const placeholders = unique.map(() => "?").join(",");
  return db.transaction(() => {
    db.prepare(`DELETE FROM memory_fts WHERE chat_id IN (${placeholders})`).run(...unique);
    for (const chatId of unique) {
      clearAuxiliaryInputs(db,chatId);
      db.prepare("DELETE FROM server_meta WHERE key IN (?,?,?,?,?,?,?,?,?,?)").run(`retrieval_trace_chat:${chatId}`, memoryBookmarksKey(chatId), viewPreferencesKey(chatId), `user_deletions:${chatId}`, `persona_hint:${chatId}`, `ledger_edit_origins:${chatId}`, removedAliasesKey(chatId), detailAccessEditsKey(chatId), dialogueAccessIdentityKey(chatId), `quiz_history_boundary:${chatId}`);
    }
    for (const chatId of unique) db.prepare("DELETE FROM server_meta WHERE key=?").run(chatPacketBudgetKey(chatId));
    return db.prepare(`DELETE FROM chats WHERE id IN (${placeholders})`).run(...unique).changes;
  })();
}

export type SecretName = "VOYAGE_API_KEY" | "RCM_LLM_API_KEY" | `RCM_LLM_API_KEY_${string}` | `RCM_${string}`;

export function saveSecret(path: string, name: SecretName, value: string | null): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const retained = existing.filter((line) => !line.trim().startsWith(`${name}=`));
  if (value) retained.push(`${name}=${value}`);
  const body = `${retained.filter((line, index, values) => line || index < values.length - 1).join("\n").trimEnd()}\n`;
  writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
}

export function saveVoyageKey(path: string, apiKey: string | null): void {
  saveSecret(path, "VOYAGE_API_KEY", apiKey);
}
