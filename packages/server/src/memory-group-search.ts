import { INITIAL_CALIBRATION_MEMORY_KEY_PREFIX } from "@rcm/shared";

/** Product-owned keys and typed social links identify cognition, never prose. */
export function recognitionDetailSql(alias = 'd'): string {
  return `(${alias}.kind='recognition' OR ${alias}.detail_key='recognition' OR instr(${alias}.detail_key,'recognition:')=1
    OR EXISTS (SELECT 1 FROM social_knowledge_events cognition_event,json_each(cognition_event.cognition_detail_ids_json) cognition_ref
      WHERE cognition_event.chat_id=${alias}.chat_id AND cognition_ref.value=${alias}.id))`;
}

/** Mixed event parents remain scenes; only standalone cognition is state-only. */
export function recognitionOnlyMemorySql(alias = 'm'): string {
  return `(instr(COALESCE(${alias}.memory_key,''),'${INITIAL_CALIBRATION_MEMORY_KEY_PREFIX}')=1 OR (
    EXISTS (SELECT 1 FROM memory_details cognition_detail WHERE cognition_detail.memory_id=${alias}.id AND ${recognitionDetailSql('cognition_detail')})
    AND NOT EXISTS (SELECT 1 FROM memory_details scene_detail WHERE scene_detail.memory_id=${alias}.id AND NOT ${recognitionDetailSql('scene_detail')})
    AND NOT EXISTS (SELECT 1 FROM memory_dialogues scene_dialogue WHERE scene_dialogue.memory_id=${alias}.id)))`;
}

/** Cognition belongs to the state ledger, not recalled scenes.
 * Grouping is presentation-only; its original memories remain candidates. */
export function searchableMemoryParentSql(alias: 'memories' | 'm' | 'memory' = 'memories'): string {
  return `(NOT ${recognitionOnlyMemorySql(alias)} AND (${alias}.capsule_parent_id IS NULL OR ${alias}.capsule_parent_id IN
    (SELECT memory_id FROM episodes WHERE resolution='group' AND status='capsuled')))`;
}
