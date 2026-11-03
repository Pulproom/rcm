import type { RcmDatabase } from './db.js';
import { augmentSearchText } from '@rcm/shared';
import { invalidateStorySupports } from './story-spine.js';

/** Parents must survive automatic replacement while any of their lines is user-owned. */
export function memoryHasLineCorrectionSql(alias='memories'):string {
  return `EXISTS(SELECT 1 FROM memory_details corrected WHERE corrected.chat_id=${alias}.chat_id AND corrected.memory_id=${alias}.id AND (corrected.user_edited=1 OR corrected.user_hidden=1))
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
    const row = db.prepare(`SELECT * FROM ${table} WHERE chat_id=? AND ${parent} AND id=? AND active=1`).get(chatId,memoryId,...(kind === "event" ? [memoryId] : []),id) as Record<string,any>|undefined;
    if (!row) return undefined;
    if (patch.text !== undefined) db.prepare(`UPDATE ${table} SET original_text=COALESCE(original_text,${field}),${field}=?,user_edited=1 WHERE id=?`).run(patch.text,id);
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
