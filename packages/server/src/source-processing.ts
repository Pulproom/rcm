import type { RcmDatabase } from "./db.js";

/** Current coverage is the surviving source membership, never a batch's old envelope.
 * Deleted/rolled-back rows remain in the ledger for provenance, not scheduling. */
export const appliedSourceBoundsSql = `SELECT b.id AS batch_id,MIN(m.ordinal) AS start_ordinal,MAX(m.ordinal) AS end_ordinal
  FROM extraction_batches b,json_each(b.source_message_ids_json) s
  JOIN messages m ON m.chat_id=b.chat_id AND m.message_id=s.value
  WHERE b.chat_id=? AND b.generation_id='active' AND b.status='applied' AND m.memory_excluded=0
    AND m.lifecycle IN ('committed','client_pruned') AND m.host_visibility IN ('active','all_before')
  GROUP BY b.id`;

export function appliedSourceEnd(db: RcmDatabase, chatId: string): number {
  return (db.prepare(`SELECT MAX(end_ordinal) ordinal FROM (${appliedSourceBoundsSql})`).get(chatId) as {ordinal:number|null}).ordinal ?? -1;
}

/** Accepted replay preserves middle-source cleanup, but never a retired branch.
 * Callers use extraction_batches alias b. Mixed batches require source recovery. */
export const retiredBatchSourceSql = `EXISTS(SELECT 1 FROM json_each(b.source_message_ids_json) s
  LEFT JOIN messages m ON m.chat_id=b.chat_id AND m.message_id=s.value
  WHERE m.message_id IS NULL OR m.lifecycle IN ('branch_truncated','superseded','hard_deleted'))`;

/** Applied membership or any durable evidence means the source has been processed. */
export function sourceHasProcessingHistory(db: RcmDatabase, chatId: string, messageId: string, appliedOnly = true): boolean {
  const evidenceTables = ['memories','memory_details','memory_dialogues','assertions','beliefs','promise_events',
    'relationship_events','relationship_baselines','physical_intimacy_milestones','social_knowledge_events','atom_relations','item_access','episode_sections'];
  return Boolean(db.prepare(`SELECT 1 FROM extraction_batches b,json_each(b.source_message_ids_json) s WHERE b.chat_id=? AND s.value=? ${appliedOnly ? "AND b.status='applied'" : ''}
    ${appliedOnly ? '' : "UNION ALL SELECT 1 FROM jobs j,json_each(j.payload_json,'$.sourceMessageIds') s WHERE j.chat_id=? AND s.value=?"}
    UNION ALL SELECT 1 FROM episode_messages WHERE chat_id=? AND message_id=?
    UNION ALL SELECT 1 FROM evidence_spans WHERE chat_id=? AND message_id=?
    UNION ALL SELECT 1 FROM source_passages WHERE chat_id=? AND message_id=?
    UNION ALL SELECT 1 FROM source_passages p,json_each(p.access_json) g,json_each(g.value,'$.evidence') e
      WHERE p.chat_id=? AND json_extract(e.value,'$.messageId')=?
    UNION ALL SELECT 1 FROM memory_recall_events r,json_each(r.evidence_json) e WHERE r.chat_id=? AND e.value=?
    ${evidenceTables.map(table => `UNION ALL SELECT 1 FROM ${table} t,json_each(t.evidence_json) e WHERE t.chat_id=? AND json_extract(e.value,'$.messageId')=?`).join('\n')}
    LIMIT 1`).get(...Array.from({length:(appliedOnly ? 6 : 7)+evidenceTables.length},()=>[chatId,messageId]).flat()));
}
