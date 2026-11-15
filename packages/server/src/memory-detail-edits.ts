import type { RcmDatabase } from './db.js';
import { assertChatUnlocked } from './upgrade-lock.js';
import { augmentSearchText } from '@rcm/shared';
import { invalidateStorySupports } from './story-spine.js';
import { readDetailAccessEdits } from './item-access.js';

/** Explicit regeneration replaces prose only in its selected source batches.
 * Hidden/restored rows, access corrections and authored parents remain owned. */
export type RegeneratedRange = {startOrdinal:number;endOrdinal:number;includeEvents?:boolean};
export function regeneratedTextEdits(db:RcmDatabase, chatId:string, range:RegeneratedRange): {details:string[];events:string[];parents:string[]} {
  const access = readDetailAccessEdits(db,chatId);
  const details = (db.prepare(`SELECT d.id,d.memory_id FROM memory_details d JOIN memories m ON m.id=d.memory_id
    LEFT JOIN extraction_batches b ON b.id=m.source_batch_id
    WHERE d.chat_id=? AND COALESCE(d.source_start_ordinal,b.start_ordinal)>=? AND COALESCE(d.source_end_ordinal,b.end_ordinal)<=?
      AND m.user_managed=0 AND NOT is_initial_calibration_memory(m.memory_key)
      AND d.user_edited=1 AND d.user_hidden=0`).all(chatId,range.startOrdinal,range.endOrdinal) as Array<{id:string;memory_id:string}>)
    .filter(row=>!access.has(row.id) && !access.has(row.memory_id));
  const events = range.includeEvents !== false ? (db.prepare(`SELECT e.id,e.source_memory_id FROM relationship_events e
    LEFT JOIN memories m ON m.id=e.source_memory_id
    LEFT JOIN extraction_batches b ON b.id=e.source_batch_id
    WHERE e.chat_id=? AND COALESCE(e.source_start_ordinal,b.start_ordinal)>=? AND COALESCE(e.source_end_ordinal,b.end_ordinal)<=?
      AND e.source_batch_id IS NOT NULL AND e.user_edited=1 AND e.user_hidden=0
      AND COALESCE(m.user_managed,0)=0 AND NOT is_initial_calibration_memory(COALESCE(m.memory_key,''))`)
    .all(chatId,range.startOrdinal,range.endOrdinal) as Array<{id:string;source_memory_id:string|null}>)
    .filter(row=>!row.source_memory_id || !access.has(row.source_memory_id)) : [];
  return {details:details.map(row=>row.id),events:events.map(row=>row.id),
    parents:[...new Set([...details.map(row=>row.memory_id),...events.flatMap(row=>row.source_memory_id?[row.source_memory_id]:[])])]};
}

export function discardRegeneratedTextEdits(db:RcmDatabase,chatId:string,range:RegeneratedRange): string[] {
  const edits=regeneratedTextEdits(db,chatId,range);
  for (const id of edits.details) {
    db.prepare("DELETE FROM memory_detail_fts WHERE detail_id=?").run(id);
    db.prepare("DELETE FROM embedding_items WHERE kind='detail' AND source_id=?").run(id);
    db.prepare("DELETE FROM item_access WHERE chat_id=? AND item_kind='detail' AND item_id=?").run(chatId,id);
    db.prepare('DELETE FROM memory_details WHERE chat_id=? AND id=?').run(chatId,id);
  }
  for (const id of edits.events) db.prepare('DELETE FROM relationship_events WHERE chat_id=? AND id=?').run(chatId,id);
  return edits.parents;
}

/** Parents must survive automatic replacement while any of their lines is user-owned. */
export function memoryHasLineCorrectionSql(alias='memories'):string {
  return `EXISTS(SELECT 1 FROM memory_details corrected WHERE corrected.chat_id=${alias}.chat_id AND corrected.memory_id=${alias}.id AND (corrected.user_edited=1 OR corrected.user_hidden=1 OR corrected.original_text IS NOT NULL
      OR corrected.id IN (SELECT key FROM json_each(COALESCE((SELECT value FROM server_meta WHERE key='detail_access_edits:' || ${alias}.chat_id),'{}')))))
    OR EXISTS(SELECT 1 FROM relationship_events corrected WHERE (corrected.source_memory_id=${alias}.id
      OR corrected.source_detail_id IN (SELECT id FROM memory_details WHERE chat_id=${alias}.chat_id AND memory_id=${alias}.id)) AND (corrected.user_edited=1 OR corrected.user_hidden=1))`;
}

export function refreshDetailFts(db:RcmDatabase, id:string):void {
  const item=db.prepare('SELECT * FROM memory_details WHERE id=?').get(id) as Record<string,any>|undefined;
  db.prepare('DELETE FROM memory_detail_fts WHERE detail_id=?').run(id);
  if (item?.active && !item.user_hidden) db.prepare('INSERT INTO memory_detail_fts(detail_id,chat_id,memory_id,text,participants,locations) VALUES(?,?,?,?,?,?)')
    .run(id,item.chat_id,item.memory_id,augmentSearchText(item.text),augmentSearchText(JSON.parse(item.participants_json).join(' ')),augmentSearchText(JSON.parse(item.locations_json).join(' ')));
}

/** User omission is independent of source validity and relationship projection. */
export function patchMemoryLine(db: RcmDatabase, chatId: string, memoryId: string, id: string, kind: 'detail'|'event', patch: {text?:string; hidden?:boolean}) {
  const table = kind === 'detail' ? 'memory_details' : 'relationship_events';
  const parent = kind === 'detail' ? 'memory_id=?' : '(source_memory_id=? OR source_detail_id IN (SELECT id FROM memory_details WHERE memory_id=?))';
  const field = kind === 'detail' ? 'text' : 'reason';
  return db.transaction(() => {
    assertChatUnlocked(db,chatId);
    const row = db.prepare(`SELECT * FROM ${table} WHERE chat_id=? AND ${parent} AND id=? AND active=1`).get(chatId,memoryId,...(kind === "event" ? [memoryId] : []),id) as Record<string,any>|undefined;
    if (!row) return undefined;
    if (patch.text !== undefined) db.prepare(`UPDATE ${table} SET original_text=COALESCE(original_text,${field}),${field}=?,user_edited=1 WHERE id=?`).run(patch.text,id);
    // Keep explicit restore ownership separately from the dashboard's text-edit flag.
    if (kind === 'detail' && patch.hidden === false && row.user_hidden === 1) {
      db.prepare('UPDATE memory_details SET original_text=COALESCE(original_text,text) WHERE id=?').run(id);
    }
    if (patch.hidden !== undefined) db.prepare(`UPDATE ${table} SET user_hidden=? WHERE id=?`).run(Number(patch.hidden),id);
    const item = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Record<string,any>;
    if (kind === 'detail') {
      db.prepare('UPDATE memory_details SET updated_at=? WHERE id=?').run(Date.now(),id);
      refreshDetailFts(db,id);
    }
    const translationId = kind === 'detail' ? `${memoryId}:detail:${id}` : `relationship-event:${id}:reason`;
    db.prepare('DELETE FROM translation_cache WHERE chat_id=? AND item_id IN (?,?)').run(chatId,translationId,kind === 'detail' ? `social-cognition:${id}` : translationId);
    // Questions already made stay (owner decision); the scene fingerprint makes new and in-flight batches use the corrected lines.
    db.prepare('UPDATE chats SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(),chatId);
    invalidateStorySupports(db,chatId,new Set([kind === 'detail' ? `detail:${id}` : `relationship_events:${id}`]));
    return {id,text:item[field],userEdited:item.user_edited===1,hidden:item.user_hidden===1};
  })();
}
