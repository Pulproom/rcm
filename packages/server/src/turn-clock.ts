import type { RcmDatabase } from "./db.js";

export function editProtectedMessageIds(db: RcmDatabase, chatId: string, editProtectionTurns: number): Set<string> {
  const rows = db.prepare(`SELECT message_id,completed_turn_seq FROM messages
    WHERE chat_id=? AND completed_turn_seq IS NOT NULL AND lifecycle='committed' AND host_visibility IN ('active','all_before')
    ORDER BY ordinal DESC,message_id DESC`).all(chatId) as Array<{ message_id: string; completed_turn_seq: number }>;
  const turnLimit = Math.min(5, Math.max(1, editProtectionTurns));
  const protectedIds = new Set<string>();
  let turnOccurrences = 0;
  let previousSequence: number | undefined;
  for (const row of rows) {
    // A repaired or restored ledger can contain a later occurrence of an old
    // sequence number. Ordinal-adjacent runs, rather than the number itself,
    // identify the current transcript's turn occurrence.
    if (row.completed_turn_seq !== previousSequence) {
      if (turnOccurrences === turnLimit) break;
      turnOccurrences += 1;
      previousSequence = row.completed_turn_seq;
    }
    protectedIds.add(row.message_id);
  }
  return protectedIds;
}


/** Owned transcript structure only: excluded/processed replies still delimit turns. */
export const originalTurnKeySql = `CASE WHEN m.role='assistant' THEN m.message_id ELSE (
  SELECT a.message_id FROM messages a WHERE a.chat_id=m.chat_id AND a.ordinal>=m.ordinal
    AND a.role='assistant' AND a.lifecycle IN ('committed','client_pruned') AND a.host_visibility IN ('active','all_before')
  ORDER BY a.ordinal,a.message_id LIMIT 1) END`;

export function responseTurns<T extends {role:string;turn_key?:string|null}>(messages:T[]):T[][] {
  const turns:T[][]=[];
  let current:T[]=[];
  for (const message of messages) {
    if (message.turn_key !== undefined && current.length && current[0]!.turn_key !== message.turn_key) current=[];
    if (message.role==='user') current.push(message);
    if (message.role==='assistant') { turns.push([...current,message]); current=[]; }
  }
  return turns;
}

/** Read boundaries before filtering excluded rows; no source bodies or per-user lookups. */
export function sourceTurnMembership(db:RcmDatabase,chatId:string) {
  const rows=db.prepare(`SELECT m.message_id,m.role,m.ordinal,m.lifecycle,m.extraction_state,m.completed_turn_seq,
    m.memory_excluded,m.content IS NOT NULL AS available FROM messages m WHERE m.chat_id=?
    AND m.lifecycle IN ('committed','client_pruned') AND m.host_visibility IN ('active','all_before')
    AND m.role IN ('user','assistant') ORDER BY m.ordinal,m.message_id`)
    .all(chatId) as Array<{message_id:string;role:string;ordinal:number;lifecycle:string;extraction_state:string;completed_turn_seq:number|null;memory_excluded:number;available:number}>;
  return responseTurns(rows).flatMap(turn=>{
    const response=turn.at(-1)!;
    if (response.memory_excluded || !response.available) return [];
    return [turn.filter(row=>!row.memory_excluded && row.available).map(row=>({...row,turn_key:response.message_id}))];
  });
}

/** Hydrate only selected complete turns; idle prepare never copies settled bodies. */
export function sourceTurns(db:RcmDatabase,chatId:string,select:(turn:ReturnType<typeof sourceTurnMembership>[number])=>boolean=()=>true) {
  const turns=sourceTurnMembership(db,chatId).filter(select);
  if (!turns.length) return [];
  const bodies=new Map((db.prepare(`SELECT message_id,
    CASE WHEN canonical_hash<>'' THEN canonical_content ELSE content END AS content,
    CASE WHEN canonical_hash<>'' THEN canonical_hash ELSE content_hash END AS content_hash
    FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))`)
    .all(chatId,JSON.stringify(turns.flatMap(turn=>turn.map(row=>row.message_id)))) as Array<{message_id:string;content:string;content_hash:string}>).map(row=>[row.message_id,row]));
  return turns.map(turn=>turn.map(row=>({...row,...bodies.get(row.message_id)!})));
}
