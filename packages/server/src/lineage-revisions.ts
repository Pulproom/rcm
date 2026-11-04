import type { RcmDatabase } from './db.js';
import { queueRelationshipProjection, flushRelationshipProjectionQueue } from './relationship-projections.js';

export const lineageRevisionKey=(chatId:string)=>`lineage_revision_clock:${chatId}`;
const itemKinds:Record<string,string[]>= {
  memories:['memory'], memory_details:['memory_detail'], memory_recall_events:['memory_recall_event'],
  assertions:['assertion'], beliefs:['belief','belief_tombstone'], social_knowledge_events:['social_knowledge'],
  promises:['promise'], promise_events:['promise_event'], conflicts:['conflict'], reconciliation_items:['reconciliation_review'],
  atom_relations:['atom_relation'], relationship_baselines:['relationship_baseline'], relationship_events:['relationship_event'],
  physical_intimacy_milestones:['physical_intimacy_milestone'], episodes:['episode'],
};
type Row=Record<string,any>;
type Clock={offset:number;repairedAt:number};
const readClock=(db:RcmDatabase,chatId:string):Clock|undefined=>{
  const row=db.prepare('SELECT value FROM server_meta WHERE key=?').get(lineageRevisionKey(chatId)) as {value:string}|undefined;
  return row ? JSON.parse(row.value) : undefined;
};
const writeClock=(db:RcmDatabase,chatId:string,offset:number)=>db.prepare('INSERT OR REPLACE INTO server_meta(key,value) VALUES(?,?)')
  .run(lineageRevisionKey(chatId),JSON.stringify({offset,repairedAt:Date.now()}));

function mappedParent(db:RcmDatabase,chatId:string,table:string,id:string):string|undefined {
  const kinds=itemKinds[table];
  if(!kinds) return undefined;
  return (db.prepare(`SELECT parent_item_id FROM chat_lineage_items WHERE child_chat_id=? AND child_item_id=? AND item_kind IN (${kinds.map(()=>'?').join(',')})`)
    .get(chatId,id,...kinds) as {parent_item_id:string}|undefined)?.parent_item_id;
}

function inheritedRow(db:RcmDatabase,chatId:string,table:string,row:Row,appliedAt:number):boolean {
  if(mappedParent(db,chatId,table,row.id)) return true;
  if(table==='relationship_events') return String(row.source_job_id ?? '').startsWith('lineage:');
  if(table==='extraction_audits') {
    const job=db.prepare('SELECT payload_json FROM jobs WHERE id=? AND chat_id=?').get(row.job_id,chatId) as {payload_json:string}|undefined;
    return Boolean(job && JSON.parse(job.payload_json).inheritedReview);
  }
  // Access copies are allocated at the clone transaction's timestamp; later
  // grants have their own timestamp even when their target is inherited.
  if(table==='item_access') return row.created_at===appliedAt;
  if(table==='relationship_projections') return row.updated_at<=appliedAt;
  if(table==='memory_traces') return Boolean(mappedParent(db,chatId,'memories',row.memory_id));
  if(itemKinds[table]) return false;
  throw new Error(`Lineage revision provenance is not defined for ${table}`);
}

/** Revision columns are product-owned clocks, not source ordinals or timestamps. */
function revisionTables(db:RcmDatabase): Array<{table:string;columns:string[];scope:string}> {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'").all() as Array<{name:string}>)
    .flatMap(({name:table})=>{
      const columns=(db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{name:string}>).map(row=>row.name);
      const revisions=columns.filter(name=>name.endsWith('_revision'));
      const scope=columns.includes('chat_id') ? 'chat_id=?' : table==='memory_traces' ? 'memory_id IN (SELECT id FROM memories WHERE chat_id=?)' : '';
      return revisions.length && scope ? [{table,columns:revisions,scope}] : [];
    });
}

export function lineageRevisionFloor(db:RcmDatabase,chatId:string,minimum=0):number {
  let floor=Math.max(minimum,(db.prepare('SELECT revision FROM chats WHERE id=?').get(chatId) as {revision:number}|undefined)?.revision ?? 0);
  for(const {table,columns,scope} of revisionTables(db)) {
    const row=db.prepare(`SELECT ${columns.map(column=>`MAX("${column}") AS "${column}"`).join(',')} FROM "${table}" WHERE ${scope}`).get(chatId) as Record<string,number|null>;
    for(const value of Object.values(row)) if(value!=null) floor=Math.max(floor,value);
  }
  const cursor=db.prepare("SELECT MAX(CASE WHEN json_valid(event_cursor_json) THEN json_extract(event_cursor_json,'$.revision') END) revision FROM relationship_projections WHERE chat_id=?").get(chatId) as {revision:number|null};
  return Math.max(floor,cursor.revision ?? 0);
}

export function advanceInheritedRevision(db:RcmDatabase,childId:string,parentRevision:number):void {
  db.prepare('UPDATE chats SET revision=? WHERE id=?').run(lineageRevisionFloor(db,childId,parentRevision),childId);
  writeClock(db,childId,0);
}

/** DB59 data repair. Per-chat markers survive backup/restore; no schema bump.
 * Only clocks change. Source coordinates, contents, activity and user locks do not.
 */
export function repairInheritedRevisions(db:RcmDatabase):number {
  const tables=revisionTables(db);
  const lineages=db.prepare("SELECT * FROM chat_lineage WHERE status='inherited'").all() as Row[];
  const byId=new Map(lineages.map(row=>[row.child_chat_id,row]));
  const visiting=new Set<string>(),done=new Set<string>();
  let repaired=0;
  const repair=(chatId:string)=>{
    if(done.has(chatId)) return;
    if(visiting.has(chatId)) throw new Error('LINEAGE_CYCLE');
    const lineage=byId.get(chatId);
    if(!lineage || readClock(db,chatId)) {done.add(chatId);return;}
    visiting.add(chatId);
    if(byId.has(lineage.parent_chat_id)) repair(lineage.parent_chat_id);
    const rows=tables.map(spec=>({...spec,rows:db.prepare(`SELECT rowid AS _rowid,* FROM "${spec.table}" WHERE ${spec.scope}`).all(chatId) as Row[]}));
    const classifyChildField=(table:string,row:Row,column:string):boolean=>{
      if(!row._inherited) return true;
      if(table==='promises' && column==='updated_revision' && db.prepare(`SELECT 1 FROM promise_events e
        WHERE e.chat_id=? AND e.promise_id=? AND e.created_revision=? AND NOT EXISTS (SELECT 1 FROM chat_lineage_items i
          WHERE i.child_chat_id=e.chat_id AND i.item_kind='promise_event' AND i.child_item_id=e.id)`)
        .get(chatId,row.id,row.updated_revision)) return true;
      if(table==='memory_traces') return Boolean(db.prepare(`SELECT 1 FROM memory_recall_events e WHERE e.chat_id=? AND e.memory_id=? AND e.holder=?
        AND e.action<>'mentioned' AND e.completed_turn_seq=? AND NOT EXISTS (SELECT 1 FROM chat_lineage_items i
          WHERE i.child_chat_id=e.chat_id AND i.item_kind='memory_recall_event' AND i.child_item_id=e.id)`)
        .get(chatId,row.memory_id,row.character_name,row.last_recalled_turn_seq));
      if(!['last_recalled_revision','valid_to_revision','updated_revision','end_revision'].includes(column)) return false;
      const birth=row.created_revision ?? row.valid_from_revision ?? row.start_revision;
      // Inherited batches have no running job; their remapped UUID alone is
      // not evidence of a child write. Closures also retain source ordinals.
      const localBatch=row.source_batch_id && db.prepare('SELECT 1 FROM extraction_batches WHERE id=? AND chat_id=? AND job_id IS NOT NULL')
        .get(row.source_batch_id,chatId);
      return Boolean(row.user_edit_ordinal>lineage.fork_ordinal || row.valid_to_ordinal>lineage.fork_ordinal || localBatch ||
        birth!=null && row[column]<birth || column==='last_recalled_revision' && row.updated_at>lineage.applied_at);
    };
    // A pre-fix grandchild copied the parent's pre-repair coordinates. Follow
    // lineage IDs to rebase those inherited rows before placing its own suffix.
    const inheritedValue=(owner:string,table:string,id:string,value:number):number=>{
      const sourceLineage=byId.get(owner),clock=readClock(db,owner);
      if(!sourceLineage || !clock || clock.repairedAt<lineage.applied_at) return value;
      const parentId=mappedParent(db,owner,table,id);
      return parentId ? inheritedValue(sourceLineage.parent_chat_id,table,parentId,value) : value+clock.offset;
    };
    // Freeze provenance before any event clocks move; table order must not
    // change whether an in-place edit belongs to the child.
    for(const spec of rows) for(const row of spec.rows) {
      row._inherited=inheritedRow(db,chatId,spec.table,row,lineage.applied_at);
      row._childColumns=new Set(spec.columns.filter(column=>classifyChildField(spec.table,row,column)));
    }
    const childField=(_table:string,row:Row,column:string):boolean=>row._childColumns.has(column);
    let inheritedFloor=Number((db.prepare('SELECT revision FROM chats WHERE id=?').get(lineage.parent_chat_id) as {revision:number}|undefined)?.revision ?? 0);
    for(const spec of rows) for(const row of spec.rows) {
      const parentId=mappedParent(db,chatId,spec.table,row.id);
      if(row._inherited) for(const column of spec.columns) {
        if(row[column]==null || row[column]<0 || childField(spec.table,row,column)) continue;
        const next=parentId ? inheritedValue(lineage.parent_chat_id,spec.table,parentId,row[column]) : row[column];
        if(next!==row[column]) {db.prepare(`UPDATE "${spec.table}" SET "${column}"=? WHERE rowid=?`).run(next,row._rowid);row[column]=next;}
        inheritedFloor=Math.max(inheritedFloor,row[column]);
      }
    }
    for(const row of db.prepare('SELECT event_cursor_json FROM relationship_projections WHERE chat_id=?').all(chatId) as Row[]) {
      inheritedFloor=Math.max(inheritedFloor,JSON.parse(row.event_cursor_json).revision ?? 0);
    }
    const oldRevision=(db.prepare('SELECT revision FROM chats WHERE id=?').get(chatId) as {revision:number}).revision;
    const overlaps=rows.some(spec=>spec.rows.some(row=>spec.columns.some(column=>childField(spec.table,row,column) && row[column]!=null && row[column]>=0 && row[column]<=inheritedFloor)));
    const offset=overlaps ? inheritedFloor+1 : 0;
    if(offset) for(const spec of rows) for(const row of spec.rows) {
      for(const column of spec.columns) {
        if(row[column]==null || row[column]<0) continue;
        if(childField(spec.table,row,column)) db.prepare(`UPDATE "${spec.table}" SET "${column}"=? WHERE rowid=?`).run(row[column]+offset,row._rowid);
      }
    }
    // A copied promise can contain a parent-side in-place edit. Its event IDs
    // retain provenance even though the promise ID still maps to an ancestor.
    db.prepare(`UPDATE promises SET updated_revision=MAX(updated_revision,COALESCE((SELECT MAX(e.created_revision)
      FROM promise_events e WHERE e.chat_id=promises.chat_id AND e.promise_id=promises.id AND e.active=1),updated_revision))
      WHERE chat_id=?`).run(chatId);
    // A grandchild may have no new recall of its own. Translate the trace's
    // event anchor after ancestor events move, without rebuilding strength/counts.
    db.prepare(`UPDATE memory_traces SET last_recalled_revision=(SELECT e.created_revision FROM memory_recall_events e
      WHERE e.chat_id=? AND e.memory_id=memory_traces.memory_id AND e.holder=memory_traces.character_name
        AND e.completed_turn_seq=memory_traces.last_recalled_turn_seq AND e.action<>'mentioned'
      ORDER BY e.created_at DESC,e.id DESC LIMIT 1)
      WHERE memory_id IN (SELECT id FROM memories WHERE chat_id=?) AND EXISTS(SELECT 1 FROM memory_recall_events e
        WHERE e.chat_id=? AND e.memory_id=memory_traces.memory_id AND e.holder=memory_traces.character_name
          AND e.completed_turn_seq=memory_traces.last_recalled_turn_seq AND e.action<>'mentioned')`).run(chatId,chatId,chatId);
    db.prepare('UPDATE chats SET revision=? WHERE id=?').run(lineageRevisionFloor(db,chatId,Math.max(inheritedFloor,oldRevision+offset)),chatId);
    if(offset || oldRevision<inheritedFloor) {
      // Leased projection input was built against the old coordinates.
      db.prepare("UPDATE jobs SET status='superseded',lease_owner=NULL,leased_until=NULL WHERE chat_id=? AND type='relationship_projection' AND status IN ('queued','leased')").run(chatId);
      const pairs=db.prepare('SELECT DISTINCT from_entity,to_entity FROM relationship_events WHERE chat_id=? AND active=1').all(chatId) as Row[];
      for(const pair of pairs) queueRelationshipProjection(db,chatId,pair.from_entity,pair.to_entity,'replay');
      flushRelationshipProjectionQueue(db,chatId);
      repaired++;
    }
    writeClock(db,chatId,offset);
    visiting.delete(chatId);done.add(chatId);
  };
  db.transaction(()=>{for(const row of lineages) repair(row.child_chat_id);})();
  return repaired;
}
