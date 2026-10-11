/** Grouping is presentation-only. Its original memories remain search candidates. */
export function searchableMemoryParentSql(alias: 'memories' | 'm' | 'memory' = 'memories'): string {
  return `(${alias}.capsule_parent_id IS NULL OR ${alias}.capsule_parent_id IN
    (SELECT memory_id FROM episodes WHERE resolution='group' AND status='capsuled'))`;
}
