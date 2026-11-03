import type { RcmDatabase } from "./db.js";

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
