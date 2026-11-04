import type { RcmDatabase } from "./db.js";
import { structuredStoryTimeEnd, parseStoryTime, formatPromiseTime, storedTimeOccasion, type PromiseFirstMade, type StoredLandmarkKind } from '@rcm/shared';
import { buildEntityIdentityResolver, normalizeEntityName } from './entities.js';
import { parseLandmarkKinds } from './memory-search-document.js';

export type { PromiseFirstMade } from '@rcm/shared';

/** Source order chooses the origin, never ingestion time or the latest repeat.
 * Unknown time on the first valid evidence stays unknown. Only explicit numeric
 * story dates permit elapsed days; relative prose is never interpreted here. */
export function promiseFirstMade(db: RcmDatabase, chatId: string): Map<string, PromiseFirstMade> {
  const rows=db.prepare("SELECT promise_id,promisor,promisee,source_memory_id,evidence_json FROM promise_events WHERE chat_id=? AND active=1 AND status='open'").all(chatId) as Array<{promise_id:string;promisor:string;promisee:string;source_memory_id:string|null;evidence_json:string}>;
  if(!rows.length)return new Map();
  const sources=new Map((db.prepare("SELECT message_id,ordinal,canonical_hash,canonical_content FROM messages WHERE chat_id=? AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before') AND memory_excluded=0").all(chatId) as any[]).map(row=>[row.message_id,row]));
  const memories=new Map((db.prepare('SELECT id,title,landmark,landmark_kinds_json,known_by_json,participants_json,story_time,story_time_normalized,evidence_json FROM memories WHERE chat_id=? AND active=1').all(chatId) as any[]).map(row=>[row.id,row]));
  const evidence=(value:string):any[]=>{try{return JSON.parse(value);}catch{return [];}};
  const valid=(item:any)=>{const source=sources.get(item.messageId);return source && (!item.canonicalHash || item.canonicalHash===source.canonical_hash) && (!item.quote || source.canonical_content.includes(item.quote));};
  const dated=[...memories.values()].map(memory=>({memory,refs:evidence(memory.evidence_json)}))
    .filter(({refs})=>refs.length && refs.every(valid))
    .sort((a,b)=>Math.max(...b.refs.map(e=>sources.get(e.messageId).ordinal))-Math.max(...a.refs.map(e=>sources.get(e.messageId).ordinal)));
  const current=dated[0]?.memory;
  const currentTime=structuredStoryTimeEnd(current?.story_time_normalized || current?.story_time);
  const resolve=buildEntityIdentityResolver(db,chatId);
  const identity=(name:string)=>{const result=resolve(name);return result.ambiguous?undefined:normalizeEntityName(result.canonical);};
  const pair=(names:string[])=>{const values=names.map(identity);return values.length===2 && values.every(Boolean) ? values.sort().join('\0') : undefined;};
  const sameDay=(left:unknown,right:unknown)=>{
    const a=parseStoryTime(left),b=parseStoryTime(right);
    const oneDay=(raw:unknown,parsed:ReturnType<typeof parseStoryTime>)=>{
      const end=structuredStoryTimeEnd(typeof raw==='string'?raw:undefined);
      if(end!==undefined && parsed.normalized) return new Date(end).toISOString().slice(0,10)===parsed.normalized.slice(0,10);
      // An unparsed range is not proof of one story day.
      return typeof raw==='string' && !/[~–—]|\s+to\s+/iu.test(raw);
    };
    return a.calendarKey!==undefined && a.calendarKey===b.calendarKey && a.year!==undefined && a.month!==undefined && a.day!==undefined
      && a.year===b.year && a.month===b.month && a.day===b.day && oneDay(left,a) && oneDay(right,b);
  };
  const events=rows
    .map(row=>{
      const direct=evidence(row.evidence_json), memory=memories.get(row.source_memory_id);
      return {...row,refs:direct.length ? direct : evidence(memory?.evidence_json ?? '[]')};
    })
    .filter(row=>row.refs.length && row.refs.every(valid))
    .sort((a,b)=>Math.min(...a.refs.map((e:any)=>sources.get(e.messageId).ordinal))-Math.min(...b.refs.map((e:any)=>sources.get(e.messageId).ordinal)));
  const seen=new Set<string>(), result=new Map<string,PromiseFirstMade>();
  for(const event of events) {
    if(seen.has(event.promise_id))continue;
    seen.add(event.promise_id);
    const memory=memories.get(event.source_memory_id);
    const storyTime=memory?.story_time || memory?.story_time_normalized;
    const eventPair=pair([event.promisor,event.promisee]);
    const landmark=dated.slice().sort((a,b)=>Number(b.memory.id===memory?.id)-Number(a.memory.id===memory?.id)
      || Math.min(...a.refs.map(e=>sources.get(e.messageId).ordinal))-Math.min(...b.refs.map(e=>sources.get(e.messageId).ordinal)))
      .flatMap(({memory:landmarkMemory})=>{
        const known=(JSON.parse(landmarkMemory.known_by_json) as string[]).map(identity);
        if(![event.promisor,event.promisee].every(name=>known.includes(identity(name)))) return [];
        return (parseLandmarkKinds(landmarkMemory.landmark_kinds_json) as StoredLandmarkKind[]).filter(mark=>eventPair && mark.pair && pair(mark.pair)===eventPair
          && (!mark.evidence?.length || mark.evidence.every(valid))
          && (landmarkMemory.id===memory?.id || sameDay(mark.storyTime || landmarkMemory.story_time_normalized || landmarkMemory.story_time,storyTime)));
      })[0];
    if(!storyTime && !landmark)continue;
    const firstTime=structuredStoryTimeEnd(memory?.story_time_normalized || storyTime);
    const daysAgo=firstTime!==undefined && currentTime!==undefined && currentTime>=firstTime ? Math.floor((currentTime-firstTime)/86400000) : undefined;
    const occasion=storyTime?storedTimeOccasion(storyTime,current?.story_time_normalized || current?.story_time):undefined;
    result.set(event.promise_id,{...(storyTime?{storyTime}:{}),...(daysAgo!==undefined?{daysAgo}:{}),
      ...(landmark?{landmark:{kind:landmark.kind,...(landmark.label?{label:landmark.label}:{}),...(landmark.userDefined?{userDefined:true}:{})}}:{}),...(occasion?{occasion}:{})});
  }
  return result;
}

export function promiseMadeLabel(origin: PromiseFirstMade): string {
  return `made ${formatPromiseTime(origin,'en')}`;
}

export const isEndedPromiseStatus = (status: unknown): boolean => ["kept", "broken", "released", "offscreen"].includes(String(status));

/** Completion is recorded against the chat clock, never the delayed evidence clock.
 * Replaying the same status must not renew a completed promise's window. */
export function recordPromiseRecency(db: RcmDatabase, chatId: string, id: string, previousStatus: unknown,
  status: string, timing: "automatic" | "already_past" | "recent"): void {
  if (status === previousStatus) return;
  const recent = isEndedPromiseStatus(status) && timing !== "already_past" && (timing === "recent" || previousStatus === "open");
  const clock = db.prepare("SELECT completed_turn_count,extraction_group_turns FROM chats WHERE id=?").get(chatId) as {
    completed_turn_count: number; extraction_group_turns: number;
  };
  const anchor = recent ? clock.completed_turn_count : null;
  const until = anchor === null ? null : anchor + clock.extraction_group_turns * (status === "broken" ? 2 : 1);
  db.prepare("UPDATE promises SET ended_at_turn=?,recency_until_turn=? WHERE chat_id=? AND id=?").run(anchor, until, chatId, id);
}

/** Every effective transition carries its window so source rollback restores it too. */
export function snapshotPromiseRecency(db: RcmDatabase, eventId: string, promiseId: string): void {
  db.prepare(`UPDATE promise_events SET
    ended_at_turn=(SELECT ended_at_turn FROM promises WHERE id=?),
    recency_until_turn=(SELECT recency_until_turn FROM promises WHERE id=?) WHERE id=?`).run(promiseId, promiseId, eventId);
}
