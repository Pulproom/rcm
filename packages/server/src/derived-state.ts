import { randomUUID } from 'node:crypto';
import { resetProgress } from "./pair-progress.js";
import { assertChatUnlocked, chatUpgradeLock } from './upgrade-lock.js';
import { refreshDetailFts, memoryHasLineCorrectionSql } from './memory-detail-edits.js';
import { syncManualCognition } from "./social-knowledge.js";
import type { RcmDatabase } from "./db.js";
import { refreshMemoryFts } from "./memory-search-document.js";
import { pruneDetailAccessEdits } from "./item-access.js";

/**
 * Delete every chat-scoped derived record while preserving the source message
 * ledger, chat configuration and lineage row. Reset, reprocess and explicit
 * replacement use this registry; inheritance cancellation uses its ownership receipt.
 */
export function deleteDerivedRows(db: RcmDatabase, chatId: string, options: { preserveInitialCalibration?: boolean; preserveUserCorrections?: boolean; preserveRegenerationRunId?: string } = {}): void {
  if (!options.preserveRegenerationRunId || chatUpgradeLock(db,chatId)?.runId !== options.preserveRegenerationRunId) assertChatUnlocked(db,chatId);
  renewMemoryEpoch(db,chatId);
  if (options.preserveInitialCalibration || options.preserveUserCorrections) resetProgress(db,chatId,"scene");
  else db.prepare("DELETE FROM pair_progress WHERE chat_id=?").run(chatId);
  const setupMemory = "SELECT id FROM memories WHERE chat_id=? AND is_initial_calibration_memory(memory_key)";
  const setup = options.preserveInitialCalibration
    ? db.prepare(setupMemory).all(chatId) as Array<{id:string}> : [];
  const retained = [...setup, ...(options.preserveUserCorrections === false ? [] : db.prepare(`SELECT id FROM memories WHERE chat_id=? AND (${memoryHasLineCorrectionSql()})`).all(chatId) as Array<{id:string}>)];
  if(options.preserveUserCorrections) retained.push(...db.prepare(`SELECT id FROM memories WHERE chat_id=?
    AND user_managed=1`).all(chatId) as Array<{id:string}>);
  const retainedIds = JSON.stringify(retained.map(row => row.id));
  const memoryIds = "SELECT value FROM json_each(?)";
  const exclusions: Record<string,string> = {
    relationship_events: `source_memory_id IN (SELECT value FROM json_each(?)) OR user_edited=1 OR user_hidden=1`,
    memories: `id IN (${memoryIds})`,
    memory_details: `memory_id IN (SELECT value FROM json_each(?))`,
    social_knowledge_events: `source_memory_id IN (SELECT value FROM json_each(?))`,
    item_access: `item_kind='detail' AND item_id IN (SELECT id FROM memory_details WHERE memory_id IN (SELECT value FROM json_each(?)))`,
  };
  const intimacyCorrection='manual_override=1 OR deleted_by_user=1 OR deleted_through_ordinal IS NOT NULL';
  const corrected:Record<string,string>={
    assertions:"user_edit_ordinal IS NOT NULL OR auto_locked=1",
    beliefs:"user_edit_ordinal IS NOT NULL OR auto_locked=1 OR deleted_through_ordinal IS NOT NULL OR source LIKE 'user_deleted:%'",
    physical_intimacy_milestones:intimacyCorrection,
    promises:"user_edit_ordinal IS NOT NULL OR auto_locked=1",social_knowledge_events:"user_edit_ordinal IS NOT NULL OR auto_locked=1",
    relationship_projections:"user_edit_ordinal IS NOT NULL OR auto_locked=1",
    promise_events:"promise_id IN (SELECT id FROM promises WHERE user_edit_ordinal IS NOT NULL OR auto_locked=1)",
    item_access:`(item_kind='belief' AND item_id IN (SELECT id FROM beliefs WHERE user_edit_ordinal IS NOT NULL OR auto_locked=1)) OR (item_kind='assertion' AND item_id IN (SELECT id FROM assertions WHERE user_edit_ordinal IS NOT NULL OR auto_locked=1)) OR (item_kind='promise' AND item_id IN (SELECT id FROM promises WHERE user_edit_ordinal IS NOT NULL OR auto_locked=1)) OR (item_kind='promise_event' AND item_id IN (SELECT id FROM promise_events WHERE promise_id IN (SELECT id FROM promises WHERE user_edit_ordinal IS NOT NULL OR auto_locked=1))) OR (item_kind='physical_milestone' AND item_id IN (SELECT id FROM physical_intimacy_milestones WHERE ${intimacyCorrection}))`,
  };
  if (options.preserveUserCorrections === false && db.prepare("SELECT 1 FROM sqlite_master WHERE name='embedding_vectors_v4_chat'").get()) {
    db.prepare("DELETE FROM embedding_vectors_v4_chat WHERE rowid IN (SELECT rowid FROM embedding_items WHERE chat_id=?)").run(chatId);
  }
  db.prepare("DELETE FROM memory_fts WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM memory_detail_fts WHERE chat_id=?").run(chatId);
  for (const table of CHAT_DERIVED_TABLES) {
    if (table === 'regeneration_runs' && options.preserveRegenerationRunId) {
      db.prepare('DELETE FROM regeneration_runs WHERE chat_id=? AND id<>?').run(chatId,options.preserveRegenerationRunId);
      continue;
    }
    const memoryExclusion=retained.length ? exclusions[table] : undefined;
    const exclusion=[memoryExclusion,options.preserveUserCorrections?corrected[table]:undefined].filter(Boolean).map(value=>`(${value})`).join(' OR ');
    if (exclusion) db.prepare(`DELETE FROM ${table} WHERE chat_id=? AND NOT COALESCE((${exclusion}),0)`).run(chatId,...(memoryExclusion?[retainedIds]:[]));
    else db.prepare(`DELETE FROM ${table} WHERE chat_id=?`).run(chatId);
  }
  // Issued references and their counters outlive replacement as tombstones.
  // Resolution joins live memories; pre-replacement addresses stop resolving.
  if (options.preserveUserCorrections === false) {
    for (const table of ['quiz_items','quiz_state']) db.prepare(`DELETE FROM ${table} WHERE chat_id=?`).run(chatId);
  }
  syncManualCognition(db,chatId);
  pruneDetailAccessEdits(db,chatId);
  retained.forEach(row => { refreshMemoryFts(db, row.id);
    for (const detail of db.prepare('SELECT id FROM memory_details WHERE memory_id=?').all(row.id) as Array<{id:string}>) refreshDetailFts(db,detail.id);
  });
  if (options.preserveInitialCalibration) {
    db.prepare("DELETE FROM relationship_baselines WHERE chat_id=? AND source<>'setup'").run(chatId);
    db.prepare("DELETE FROM entities WHERE chat_id=? AND origin NOT IN ('setup','manual') AND user_managed=0").run(chatId);
  } else {
    db.prepare("DELETE FROM relationship_baselines WHERE chat_id=?").run(chatId);
    db.prepare("DELETE FROM entities WHERE chat_id=?").run(chatId);
    db.prepare("DELETE FROM initial_calibrations WHERE chat_id=?").run(chatId);
  }
}

/** Shared ownership registry for reset and whole-chat shadow promotion. */
export const CHAT_DERIVED_TABLES = [
    "gap_recovery_messages", "source_passages", "extraction_audits", "item_access", "atom_relations", "recall_logs", "conflicts", "jobs", "reconciliation_items", "memory_recall_events",
    "relationship_projection_queue", "relationship_projections", "relationship_events",
    "physical_intimacy_milestones", "promise_events", "promises", "social_knowledge_events",
    "entity_scene_presence", "entity_prominence", "beliefs", "assertions", "memory_edges",
    "episode_sections", "episode_messages", "episodes", "evidence_spans", "memory_dialogues", "memory_details", "memories",
    "extraction_batches", "regeneration_runs", "story_spine_nodes",
    "embedding_failures", "embedding_items", "embedding_blocks",
] as const;

export function memoryEpoch(db:RcmDatabase,chatId:string): string {
  return (db.prepare('SELECT value FROM server_meta WHERE key=?').get(`memory_epoch:${chatId}`) as {value:string}|undefined)?.value ?? '';
}
export function renewMemoryEpoch(db:RcmDatabase,chatId:string): void {
  db.prepare('INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(`memory_epoch:${chatId}`,randomUUID());
}
