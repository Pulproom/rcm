import { syncManualCognition } from "./social-knowledge.js";
import type { RcmDatabase } from "./db.js";
import { refreshMemoryFts } from "./memory-search-document.js";
import { pruneDetailAccessEdits } from "./item-access.js";

/**
 * Delete every chat-scoped derived record while preserving the source message
 * ledger, chat configuration and lineage row. Reset, reprocess and lineage
 * revert share this registry so new derived tables cannot drift between paths.
 */
export function deleteDerivedRows(db: RcmDatabase, chatId: string, options: { preserveInitialCalibration?: boolean; preserveUserCorrections?: boolean } = {}): void {
  const setupMemory = "SELECT id FROM memories WHERE chat_id=? AND is_initial_calibration_memory(memory_key)";
  const setup = options.preserveInitialCalibration
    ? db.prepare(setupMemory).all(chatId) as Array<{id:string}> : [];
  const retained = [...setup];
  if(options.preserveUserCorrections) retained.push(...db.prepare(`SELECT id FROM memories WHERE chat_id=?
    AND user_managed=1`).all(chatId) as Array<{id:string}>);
  const retainedIds = JSON.stringify(retained.map(row => row.id));
  const memoryIds = "SELECT value FROM json_each(?)";
  const exclusions: Record<string,string> = {
    memories: `id IN (${memoryIds})`,
    memory_details: `memory_id IN (SELECT value FROM json_each(?))`,
    social_knowledge_events: `source_memory_id IN (SELECT value FROM json_each(?))`,
    item_access: `item_kind='detail' AND item_id IN (SELECT id FROM memory_details WHERE memory_id IN (SELECT value FROM json_each(?)))`,
  };
  const corrected:Record<string,string>={
    assertions:"user_edit_ordinal IS NOT NULL OR auto_locked=1",beliefs:"user_edit_ordinal IS NOT NULL OR auto_locked=1",
    promises:"user_edit_ordinal IS NOT NULL OR auto_locked=1",social_knowledge_events:"user_edit_ordinal IS NOT NULL OR auto_locked=1",
    relationship_projections:"user_edit_ordinal IS NOT NULL OR auto_locked=1",
    promise_events:"promise_id IN (SELECT id FROM promises WHERE user_edit_ordinal IS NOT NULL OR auto_locked=1)",
    item_access:`(item_kind='assertion' AND item_id IN (SELECT id FROM assertions WHERE user_edit_ordinal IS NOT NULL OR auto_locked=1)) OR (item_kind='promise' AND item_id IN (SELECT id FROM promises WHERE user_edit_ordinal IS NOT NULL OR auto_locked=1))`,
  };
  db.prepare("DELETE FROM memory_fts WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM memory_detail_fts WHERE chat_id=?").run(chatId);
  for (const table of [
    "source_passages", "extraction_audits", "item_access", "atom_relations", "recall_logs", "conflicts", "jobs", "reconciliation_items", "memory_recall_events",
    "relationship_projection_queue", "relationship_projections", "relationship_events",
    "physical_intimacy_milestones", "promise_events", "promises", "social_knowledge_events",
    "entity_scene_presence", "entity_prominence", "beliefs", "assertions", "memory_edges",
    "episode_sections", "episode_messages", "episodes", "evidence_spans", "memory_dialogues", "memory_details", "memories",
    "extraction_batches", "regeneration_runs", "story_spine_nodes",
    "embedding_failures", "embedding_items", "embedding_blocks",
  ]) {
    const memoryExclusion=retained.length ? exclusions[table] : undefined;
    const exclusion=[memoryExclusion,options.preserveUserCorrections?corrected[table]:undefined].filter(Boolean).map(value=>`(${value})`).join(' OR ');
    if (exclusion) db.prepare(`DELETE FROM ${table} WHERE chat_id=? AND NOT COALESCE((${exclusion}),0)`).run(chatId,...(memoryExclusion?[retainedIds]:[]));
    else db.prepare(`DELETE FROM ${table} WHERE chat_id=?`).run(chatId);
  }
  syncManualCognition(db,chatId);
  pruneDetailAccessEdits(db,chatId);
  retained.forEach(row => refreshMemoryFts(db, row.id));
  if (options.preserveInitialCalibration) {
    db.prepare("DELETE FROM relationship_baselines WHERE chat_id=? AND source<>'setup'").run(chatId);
    db.prepare("DELETE FROM entities WHERE chat_id=? AND origin NOT IN ('setup','manual') AND user_managed=0").run(chatId);
  } else {
    db.prepare("DELETE FROM relationship_baselines WHERE chat_id=?").run(chatId);
    db.prepare("DELETE FROM entities WHERE chat_id=?").run(chatId);
    db.prepare("DELETE FROM initial_calibrations WHERE chat_id=?").run(chatId);
  }
}
