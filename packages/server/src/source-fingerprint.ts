import type { RcmDatabase } from "./db.js";

/** Host-owned ordinal fallback syntax does not identify a persistent message. */
export function isOrdinalFallbackMessageId(chatId: string, messageId: string): boolean {
  return messageId.startsWith(`${chatId}:`) && /^\d+$/.test(messageId.slice(chatId.length + 1));
}

export interface SourceFingerprintItem {
  messageId: string;
  ordinal: number;
  contentHash: string;
  sourceKind: string;
}

export function isSourceFingerprint(value: unknown): value is SourceFingerprintItem[] {
  return Array.isArray(value) && value.every((item) => Boolean(item) && typeof item === "object"
    && typeof (item as SourceFingerprintItem).messageId === "string"
    && Number.isInteger((item as SourceFingerprintItem).ordinal)
    && typeof (item as SourceFingerprintItem).contentHash === "string"
    && typeof (item as SourceFingerprintItem).sourceKind === "string");
}

export function parseSourceFingerprintJson(value: string): SourceFingerprintItem[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isSourceFingerprint(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function sourceFingerprint(db: RcmDatabase, chatId: string, sourceIds: string[]): SourceFingerprintItem[] {
  if (!sourceIds.length) return [];
  const rows = db.prepare(`SELECT message_id,ordinal,CASE WHEN canonical_hash<>'' THEN canonical_hash ELSE content_hash END AS content_hash,source_kind FROM messages WHERE chat_id=? AND message_id IN (${sourceIds.map(() => "?").join(",")})`)
    .all(chatId, ...sourceIds) as Array<{ message_id: string; ordinal: number; content_hash: string; source_kind: string }>;
  const byId = new Map(rows.map((row) => [row.message_id, row]));
  return sourceIds.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row)).map((row) => ({
    messageId: row.message_id,
    ordinal: row.ordinal,
    contentHash: row.content_hash,
    sourceKind: row.source_kind,
  }));
}

export function fingerprintMatches(db: RcmDatabase, chatId: string, expected: SourceFingerprintItem[]): boolean {
  if (!isSourceFingerprint(expected)) return false;
  if (!expected.length) return true;
  const usable = (db.prepare(`SELECT count(*) AS count FROM messages
    WHERE chat_id=? AND message_id IN (${expected.map(() => "?").join(",")}) AND memory_excluded=0 AND host_visibility IN ('active','all_before') AND content IS NOT NULL`)
    .get(chatId, ...expected.map((item) => item.messageId)) as { count: number }).count;
  if (usable !== expected.length) return false;
  const current = sourceFingerprint(db, chatId, expected.map((item) => item.messageId));
  return JSON.stringify(current) === JSON.stringify(expected);
}

/** Exact UTF-16 source coverage, independent of range order, overlap or partition. */
export function extractionContinuationProgress(db: RcmDatabase, chatId: string, sourceIds: string[], previous: Array<{messageId:string;quote:string;startOffset?:number}> | undefined, next: Array<{messageId:string;quote:string;startOffset?:number}>): {signature:string;progress:boolean} {
  const texts = new Map((db.prepare(`SELECT message_id,CASE WHEN canonical_hash<>'' THEN canonical_content ELSE content END content FROM messages
    WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))`).all(chatId,JSON.stringify(sourceIds)) as Array<{message_id:string;content:string}>).map(row=>[row.message_id,row.content]));
  type Span={id:string;start:number;end:number};
  const merge=(ranges:Span[]):Span[]=>{
    const result:Span[]=[];
    for(const span of ranges.sort((a,b)=>a.id.localeCompare(b.id)||a.start-b.start||a.end-b.end)) {
      const last=result.at(-1);
      if(last && last.id===span.id && span.start<=last.end) last.end=Math.max(last.end,span.end);
      else result.push({...span});
    }
    return result;
  };
  const spans=(ranges:NonNullable<typeof previous>):Span[]=>merge(ranges.map(range=>{
    const text=texts.get(range.messageId);
    const start=range.startOffset ?? text?.indexOf(range.quote) ?? -1;
    if(text==null || !range.quote || start<0 || text.slice(start,start+range.quote.length)!==range.quote
      || range.startOffset==null && text.indexOf(range.quote,start+1)>=0) throw new Error('Invalid exact continuation source range');
    return {id:range.messageId,start,end:start+range.quote.length};
  }));
  const before=previous?.length ? spans(previous) : merge([...texts].map(([id,text])=>({id,start:0,end:text.length})));
  const after=spans(next), size=(items:Span[])=>items.reduce((sum,item)=>sum+item.end-item.start,0);
  return {signature:JSON.stringify(after),progress:size(after)<size(before) && after.every(span=>before.some(old=>old.id===span.id && old.start<=span.start && old.end>=span.end))};
}
