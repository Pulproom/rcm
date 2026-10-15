import { createHash } from 'node:crypto';
import type { TurnPrepareRequest } from '@rcm/shared';
import type { RcmDatabase } from './db.js';
import { isOrdinalFallbackMessageId, sourceFingerprint } from './source-fingerprint.js';

/** Source references only. A quote that happens to equal an ID stays a quote. */
function remapSourceJson(text: string, ids: Map<string,string>, list = false): string {
  const visit = (value: unknown, sourceIds = false): unknown => {
    if (typeof value === 'string') return sourceIds ? ids.get(value) ?? value : value;
    if (Array.isArray(value)) return value.map(item => visit(item,sourceIds));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) =>
      [key,visit(item,['messageId','messageIds','sourceMessageId','sourceMessageIds','evidenceMessageIds'].includes(key))]));
    return value;
  };
  return JSON.stringify(visit(JSON.parse(text),list));
}

/** Called inside the clone transaction, before rebinding groups or exposing it. */
export function remapInheritedSources(db: RcmDatabase, chatId: string, allIds: Map<string,string>, request: TurnPrepareRequest): void {
  const ids = new Map([...allIds].filter(([oldId,newId]) => oldId !== newId));
  if (!ids.size) return;
  if ([...ids.values()].some(id => ids.has(id))) throw new Error('LINEAGE_SOURCE_ID_COLLISION');
  const columns = (db.prepare('PRAGMA table_info(messages)').all() as Array<{name:string}>).map(row => row.name);
  const copy = db.prepare(`INSERT INTO messages(${columns.join(',')}) SELECT ${columns.map(column => column === 'message_id' ? '?'
    : column === 'memory_excluded' ? 'CASE WHEN ? THEN 0 ELSE memory_excluded END' : column).join(',')}
    FROM messages WHERE chat_id=? AND message_id=?`);
  const referenceTables = ['message_revisions','memory_dialogues','evidence_spans','episode_messages','source_passages'];
  for (const [oldId,newId] of ids) {
    // A choice may already have synchronized the target's raw-only shell.
    db.prepare('DELETE FROM messages WHERE chat_id=? AND message_id=?').run(chatId,newId);
    const fallback = isOrdinalFallbackMessageId(chatId,newId) || isOrdinalFallbackMessageId(chatId,oldId);
    copy.run(...columns.flatMap<string | number>(column => column === 'message_id' ? [newId] : column === 'memory_excluded' ? [Number(fallback)] : []),chatId,oldId);
    for (const table of referenceTables) db.prepare(`UPDATE ${table} SET message_id=? WHERE chat_id=? AND message_id=?`).run(newId,chatId,oldId);
    db.prepare("UPDATE chat_lineage_items SET child_item_id=? WHERE child_chat_id=? AND item_kind='message' AND child_item_id=?").run(newId,chatId,oldId);
    db.prepare('DELETE FROM messages WHERE chat_id=? AND message_id=?').run(chatId,oldId);
  }
  const fields: Record<string,string[]> = {
    entities:['source_json'], memories:['evidence_json'], memory_details:['evidence_json','seed_json'], memory_dialogues:['evidence_json'], atom_relations:['evidence_json'],
    assertions:['evidence_json','automatic_closure_evidence_json'], beliefs:['evidence_json','automatic_closure_evidence_json'], relationship_baselines:['evidence_json'],
    promise_events:['evidence_json'],
    relationship_events:['evidence_json'], social_knowledge_events:['evidence_json'],
    physical_intimacy_milestones:['evidence_json'], item_access:['evidence_json'],
    memory_recall_events:['evidence_json'], source_passages:['access_json'],
    episode_sections:['source_message_ids_json','evidence_json','key_dialogues_json'],
    extraction_batches:['source_message_ids_json','source_fingerprint_json','final_json'],
    reconciliation_items:['source_message_ids_json','incoming_json','candidates_json','model_decision_json'],
    conflicts:['existing_json','incoming_json'], jobs:['payload_json'],
    embedding_blocks:['message_ids_json'], embedding_items:['source_json'],
  };
  for (const [table, names] of Object.entries(fields)) {
    const rows = db.prepare(`SELECT rowid AS _rowid,${names.join(',')} FROM ${table} WHERE chat_id=?`).all(chatId) as Array<Record<string,any>>;
    for (const row of rows) for (const name of names) {
      if (!row[name]) continue;
      const remapped = remapSourceJson(row[name],ids,table === 'memory_recall_events' || ['source_message_ids_json','message_ids_json','source_json'].includes(name));
      if (remapped !== row[name]) db.prepare(`UPDATE ${table} SET ${name}=? WHERE rowid=? AND chat_id=?`).run(remapped,row._rowid,chatId);
    }
  }
  for (const row of db.prepare('SELECT id,source_message_ids_json FROM extraction_batches WHERE chat_id=?').all(chatId) as Array<{id:string;source_message_ids_json:string}>) {
    db.prepare('UPDATE extraction_batches SET source_fingerprint_json=? WHERE id=?').run(JSON.stringify(sourceFingerprint(db,chatId,JSON.parse(row.source_message_ids_json))),row.id);
  }
  for (const row of db.prepare('SELECT id,message_ids_json FROM embedding_blocks WHERE chat_id=?').all(chatId) as Array<{id:string;message_ids_json:string}>) {
    const fingerprint = sourceFingerprint(db,chatId,JSON.parse(row.message_ids_json));
    const hash = createHash('sha256').update(fingerprint.map(item => `${item.messageId}\0${item.contentHash}`).join('\0')).digest('hex');
    db.prepare('UPDATE embedding_blocks SET content_hash=? WHERE id=?').run(hash,row.id);
  }
}
