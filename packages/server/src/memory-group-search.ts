import { INITIAL_CALIBRATION_MEMORY_KEY_PREFIX } from "@rcm/shared";

/** Setup cognition belongs to the state ledger, not recalled scenes.
 * Grouping is presentation-only; its original memories remain candidates. */
export function searchableMemoryParentSql(alias: 'memories' | 'm' | 'memory' = 'memories'): string {
  return `(instr(COALESCE(${alias}.memory_key,''),'${INITIAL_CALIBRATION_MEMORY_KEY_PREFIX}') != 1 AND (${alias}.capsule_parent_id IS NULL OR ${alias}.capsule_parent_id IN
    (SELECT memory_id FROM episodes WHERE resolution='group' AND status='capsuled')))`;
}
