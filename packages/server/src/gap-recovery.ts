import type { RcmDatabase } from './db.js';
import { editProtectedMessageIds } from './turn-clock.js';
import { sourceHasProcessingHistory } from './source-processing.js';

interface SourceRow { message_id: string; ordinal: number; role: string; lifecycle: string; host_visibility: string; extraction_state: string; memory_excluded: number; content: string | null; completed_turn_seq: number | null }

/** No source content is returned. On schema 59 the explicit targets are authoritative:
 * frozen migration gaps plus bounded extraction coverage failures. Fresh pending
 * lineage source must never trigger a second historical detection. */
export function gapRecoveryCandidates(db: RcmDatabase, chatId: string): Array<{ messageId: string; ordinal: number }> {
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE version>=59").get()) {
    return db.prepare(`SELECT g.message_id AS messageId,m.ordinal FROM gap_recovery_messages g
      JOIN messages m ON m.chat_id=g.chat_id AND m.message_id=g.message_id WHERE g.chat_id=? ORDER BY m.ordinal,m.message_id`).all(chatId) as Array<{messageId:string;ordinal:number}>;
  }
  return detectLegacyMemoryGaps(db,chatId);
}

function detectLegacyMemoryGaps(db: RcmDatabase, chatId: string): Array<{messageId:string;ordinal:number}> {
  const chat = db.prepare('SELECT ingestion_state,edit_protection_turns,character_id FROM chats WHERE id=?').get(chatId) as {ingestion_state:string;edit_protection_turns:number;character_id:string}|undefined;
  if (!chat || chat.ingestion_state !== 'managed' || chatId.startsWith('__rcm_regen__') || chat.character_id === '__rcm_regen__') return [];
  const rows = db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY ordinal,message_id').all(chatId) as SourceRow[];
  const oldProtection = editProtectedMessageIds(db,chatId,chat.edit_protection_turns);
  // Simulate the new ordinal turn boundary without altering the old clock.
  const settled = rows.filter(row => row.lifecycle === 'committed' && ['active','all_before'].includes(row.host_visibility));
  const replies = settled.filter(row => row.role === 'assistant');
  const boundary = replies.at(-Math.min(5,Math.max(1,chat.edit_protection_turns)))?.ordinal ?? -Infinity;
  const precedingReply = replies.filter(row=>row.ordinal<boundary).at(-1)?.ordinal ?? -Infinity;
  const newProtection = new Set(settled.filter(row => row.ordinal>precedingReply && row.ordinal<= (replies.at(-1)?.ordinal ?? -Infinity)).map(row=>row.message_id));
  const appliedEnd = (db.prepare(`SELECT MAX(m.ordinal) ordinal FROM extraction_batches b,json_each(b.source_message_ids_json) s
    JOIN messages m ON m.chat_id=b.chat_id AND m.message_id=s.value WHERE b.chat_id=? AND b.generation_id='active' AND b.status='applied'`).get(chatId) as {ordinal:number|null}).ordinal;
  if (appliedEnd === null) return [];
  const memberships = db.prepare(`SELECT s.value messageId,b.status,j.status jobStatus FROM extraction_batches b
    LEFT JOIN jobs j ON j.id=b.job_id,json_each(b.source_message_ids_json) s WHERE b.chat_id=?`).all(chatId) as Array<{messageId:string;status:string;jobStatus:string|null}>;
  return settled.filter(row => row.extraction_state === 'pending' && !row.memory_excluded && row.content !== null && row.ordinal<appliedEnd
    && !newProtection.has(row.message_id)
    && !memberships.some(item => item.messageId===row.message_id && (item.status==='failed' || item.jobStatus==='failed'))
    && (oldProtection.has(row.message_id) || memberships.some(item => item.messageId===row.message_id && ['queued','processing'].includes(item.status)
      && (item.jobStatus===null || !['queued','leased'].includes(item.jobStatus))))
    && !sourceHasProcessingHistory(db,chatId,row.message_id))
    .map(row => ({messageId:row.message_id,ordinal:row.ordinal}));
}

export function gapRecoveryHoles(db: RcmDatabase, chatId: string): Array<{sourceMessageIds:string[];startOrdinal:number;endOrdinal:number}> {
  const targets = new Set(gapRecoveryCandidates(db,chatId).map(row=>row.messageId));
  const rows = db.prepare('SELECT message_id,ordinal FROM messages WHERE chat_id=? ORDER BY ordinal,message_id').all(chatId) as Array<{message_id:string;ordinal:number}>;
  const holes: Array<{sourceMessageIds:string[];startOrdinal:number;endOrdinal:number}> = [];
  let current: typeof holes[number] | undefined;
  for (const row of rows) {
    if (!targets.has(row.message_id)) { current=undefined; continue; }
    if (!current || row.ordinal!==current.endOrdinal+1) { current={sourceMessageIds:[],startOrdinal:row.ordinal,endOrdinal:row.ordinal}; holes.push(current); }
    current.sourceMessageIds.push(row.message_id); current.endOrdinal=row.ordinal;
  }
  return holes;
}

/** Preserve elapsed/deleted turns and translate every persisted clock consumer.
 * Existing sequence anchors can have gaps; newly counted responses shift later
 * anchors, rather than recycling those old clock values. */
export function backfillAssistantTurns(db: RcmDatabase, chatId: string): void {
  const rows=db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY ordinal,message_id').all(chatId) as SourceRow[];
  const clock=(db.prepare('SELECT completed_turn_count FROM chats WHERE id=?').get(chatId) as {completed_turn_count:number}).completed_turn_count;
  const anchors=new Map<number,number>();
  const assigned=new Map<string,number>();
  let inserted=0,previous=0;
  let users: SourceRow[]=[];
  for (const row of rows) {
    if (row.role==='user') { if (row.completed_turn_seq===null && ['committed','client_pruned'].includes(row.lifecycle) && ['active','all_before'].includes(row.host_visibility)) users.push(row); continue; }
    if (row.role!=='assistant') continue;
    if (row.completed_turn_seq===null && (!['committed','client_pruned'].includes(row.lifecycle) || !['active','all_before'].includes(row.host_visibility))) continue;
    const seq=row.completed_turn_seq===null ? previous+1 : Math.max(previous+1,row.completed_turn_seq+inserted);
    if (row.completed_turn_seq===null) inserted++;
    else anchors.set(row.completed_turn_seq,seq);
    previous=seq; assigned.set(row.message_id,seq);
    users.forEach(user=>assigned.set(user.message_id,seq)); users=[];
  }
  const translate=(value:number):number => {
    if (value===0) return 0;
    if (value>=clock) return value+inserted;
    const anchor=[...anchors].sort((a,b)=>a[0]-b[0]).find(([old])=>old>=value);
    return value+(anchor ? anchor[1]-anchor[0] : inserted);
  };
  const update=db.prepare('UPDATE messages SET completed_turn_seq=? WHERE chat_id=? AND message_id=?');
  for (const row of rows) {
    const seq=assigned.get(row.message_id) ?? (row.completed_turn_seq===null ? null : (anchors.get(row.completed_turn_seq) ?? translate(row.completed_turn_seq)));
    if (seq!==row.completed_turn_seq) update.run(seq,chatId,row.message_id);
  }
  for (const [table,columns,where] of [
    ['memory_recall_events',['completed_turn_seq'],'chat_id=?'],
    ['memory_traces',['last_recalled_turn_seq'],'memory_id IN (SELECT id FROM memories WHERE chat_id=?)'],
  ] as const) for (const column of columns) {
    const values=db.prepare(`SELECT rowid,${column} value FROM ${table} WHERE ${where} AND ${column} IS NOT NULL`).all(chatId) as Array<{rowid:number;value:number}>;
    const write=db.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`);
    // Recall timestamps refer to a source occurrence, not the time of the
    // latest prepare (which may have shared the stalled old chat counter).
    values.forEach(row=>write.run(anchors.get(row.value) ?? translate(row.value),row.rowid));
  }
  for (const [table,anchor,expiry] of [
    ['memory_activation_state','last_turn_seq','path_expires_turn'],
    ['promises','ended_at_turn','recency_until_turn'],
    ['promise_events','ended_at_turn','recency_until_turn'],
  ] as const) {
    const values=db.prepare(`SELECT rowid,${anchor} anchor,${expiry} expiry FROM ${table} WHERE chat_id=? AND ${anchor} IS NOT NULL`).all(chatId) as Array<{rowid:number;anchor:number;expiry:number|null}>;
    const write=db.prepare(`UPDATE ${table} SET ${anchor}=?,${expiry}=? WHERE rowid=?`);
    for (const row of values) {
      const shifted=translate(row.anchor);
      // An expiry is a duration from its own anchor. Translating it as an
      // independent future clock value would extend older grace windows.
      write.run(shifted,row.expiry===null ? null : shifted+(row.expiry-row.anchor),row.rowid);
    }
  }
  db.prepare('UPDATE chats SET completed_turn_count=? WHERE id=?').run(Math.max(previous,clock+inserted),chatId);
}

export function migrateMemoryGaps(db: RcmDatabase, chatIds?: string[]): void {
  const chats=chatIds ?? (db.prepare('SELECT id FROM chats').all() as Array<{id:string}>).map(row=>row.id);
  // Detection MUST precede both clock backfill and stale-batch cleanup.
  const targets=chats.map(chatId=>({chatId,rows:detectLegacyMemoryGaps(db,chatId)}));
  for (const {chatId,rows} of targets) {
    backfillAssistantTurns(db,chatId);
    const insert=db.prepare('INSERT OR IGNORE INTO gap_recovery_messages(chat_id,message_id) VALUES(?,?)');
    rows.forEach(row=>insert.run(chatId,row.messageId));
  }
  db.exec(`UPDATE extraction_batches SET status='superseded',updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
    WHERE status IN ('queued','processing') AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=extraction_batches.job_id AND j.status IN ('queued','leased'))`);
}
