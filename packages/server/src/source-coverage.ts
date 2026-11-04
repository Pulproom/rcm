import { randomUUID } from 'node:crypto';
import type { ExtractionDraftResult } from '@rcm/shared';
import type { RcmDatabase } from './db.js';
import { sourceFingerprint, type SourceFingerprintItem } from './source-fingerprint.js';
import { scopeMemoryKey } from './extraction-memory-keys.js';

export interface StoredSourceCoverage {
  memoryKeys: string[];
  memoryScope: string;
  skippedSource: ExtractionDraftResult['skippedSource'];
}

interface CoveragePayload {
  sourceMessageIds: string[];
  batchId?: string;
  includeUserMessages?: boolean;
  memoryLanguage?: string;
  postExtractionReview?: boolean;
  trigger?: string;
  backfillRunId?: string;
  canonicalRegenerationRunId?: string;
  coverageRetry?: number;
}

/** Called inside completion's storage transaction. Read canonical content evidence,
 * never access grants, ordinal envelopes or the pre-repair model response. */
export function completeSourceCoverage(db: RcmDatabase, chatId: string, jobId: string, payload: CoveragePayload, stored: StoredSourceCoverage): string[] {
  const ids: string[] = payload.sourceMessageIds ?? [];
  const keys = JSON.stringify(stored.memoryKeys);
  const memories = db.prepare(`SELECT memory_key FROM memories WHERE chat_id=? AND active=1
    AND memory_key IN (SELECT value FROM json_each(?))`).all(chatId, keys) as Array<{memory_key:string}>;
  const savedKeys = new Set(memories.map(row=>row.memory_key));
  const evidence = db.prepare(`SELECT json_extract(e.value,'$.messageId') messageId FROM memories m,json_each(m.evidence_json) e
    WHERE m.chat_id=? AND m.active=1 AND m.memory_key IN (SELECT value FROM json_each(?))
    UNION SELECT json_extract(e.value,'$.messageId') FROM memory_details d JOIN memories m ON m.id=d.memory_id,json_each(d.evidence_json) e
    WHERE m.chat_id=? AND m.active=1 AND d.active=1 AND m.memory_key IN (SELECT value FROM json_each(?))`)
    .all(chatId,keys,chatId,keys) as Array<{messageId:string}>;
  const covered = new Set(evidence.map(row=>row.messageId).filter(id=>ids.includes(id)));
  const policy = new Set((db.prepare(`SELECT message_id FROM messages WHERE chat_id=? AND extraction_state='skipped_policy'
    AND message_id IN (SELECT value FROM json_each(?))`).all(chatId,JSON.stringify(ids)) as Array<{message_id:string}>).map(row=>row.message_id));
  const skipped = new Map<string, NonNullable<ExtractionDraftResult['skippedSource']>[number]['reason']>();
  const diagnostics: Array<{messageId:string;reason:string}> = [];
  const declarations=new Set<string>();
  for (const skip of stored.skippedSource ?? []) {
    const signature=JSON.stringify(skip);
    if (declarations.has(signature)) continue;
    declarations.add(signature);
    if (!ids.includes(skip.messageId)) { diagnostics.push({messageId:skip.messageId,reason:'outside_batch'}); continue; }
    if (skip.reason==='merged' && (!skip.memoryKey || !savedKeys.has(scopeMemoryKey(skip.memoryKey,stored.memoryScope)))) {
      diagnostics.push({messageId:skip.messageId,reason:'unknown_memory_key'}); continue;
    }
    if (!covered.has(skip.messageId) && !policy.has(skip.messageId) && !skipped.has(skip.messageId)) skipped.set(skip.messageId,skip.reason);
  }
  const unresolved=ids.filter(id=>!covered.has(id) && !skipped.has(id) && !policy.has(id));
  const fingerprint=sourceFingerprint(db,chatId,unresolved);
  // A durable attempt is keyed by source ID + content hash. Queue resets, resplits,
  // settings, ordinal changes and manual retries do not replenish the allowance.
  const guardChatId=payload.canonicalRegenerationRunId
    ? (db.prepare('SELECT chat_id FROM regeneration_runs WHERE id=? AND shadow_chat_id=?')
      .get(payload.canonicalRegenerationRunId,chatId) as {chat_id:string}|undefined)?.chat_id ?? chatId
    : chatId;
  const guardKey=`source_coverage_retry:${guardChatId}`;
  const guard=db.prepare('SELECT value FROM server_meta WHERE key=?').get(guardKey) as {value:string}|undefined;
  const attempted: SourceFingerprintItem[]=guard ? JSON.parse(guard.value) : [];
  const retry=payload.coverageRetry === 1 ? [] : fingerprint.filter(item=>!attempted.some(old=>old.messageId===item.messageId && old.contentHash===item.contentHash));
  const retryIds=retry.map(item=>item.messageId);
  const needsReview=unresolved.filter(id=>!retryIds.includes(id));
  const timestamp=Date.now();
  if (retryIds.length) {
    // server_meta survives job cancellation and derived-memory regeneration.
    // Keep one current fingerprint per source, rather than accumulating text history.
    db.prepare('INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(guardKey,JSON.stringify([...attempted.filter(item=>!retryIds.includes(item.messageId)),...retry]));
    const id=randomUUID(), batchId=randomUUID();
    const generation=(db.prepare('SELECT generation_id FROM extraction_batches WHERE id=?').get(payload.batchId ?? '') as {generation_id:string}|undefined)?.generation_id ?? 'active';
    const turnCount=(db.prepare(`SELECT count(DISTINCT COALESCE(completed_turn_seq,ordinal)) n FROM messages
      WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))`).get(chatId,JSON.stringify(retryIds)) as {n:number}).n;
    db.prepare(`INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'extract','queued',?,0,?,?)`)
      .run(id,chatId,JSON.stringify({sourceMessageIds:retryIds,sourceFingerprint:retry,coverageRetry:1,coverageParentJobId:jobId,coverageRetryFingerprint:retry,
        batchId,turnCount,includeUserMessages:payload.includeUserMessages,memoryLanguage:payload.memoryLanguage,postExtractionReview:payload.postExtractionReview,
        trigger:payload.trigger ?? 'extraction',backfillRunId:payload.backfillRunId,canonicalRegenerationRunId:payload.canonicalRegenerationRunId}),timestamp,timestamp);
    db.prepare(`INSERT INTO extraction_batches(id,chat_id,job_id,generation_id,kind,source_message_ids_json,source_fingerprint_json,start_ordinal,end_ordinal,status,created_at,updated_at)
      VALUES(?,?,?,?,'extract',?,?,?,?,'queued',?,?)`).run(batchId,chatId,id,generation,JSON.stringify(retryIds),JSON.stringify(retry),Math.min(...retry.map(x=>x.ordinal)),Math.max(...retry.map(x=>x.ordinal)),timestamp,timestamp);
    for (const messageId of retryIds) db.prepare("UPDATE messages SET extraction_state='queued',updated_at=? WHERE chat_id=? AND message_id=?").run(timestamp,chatId,messageId);
  }
  for (const messageId of needsReview) {
    db.prepare('INSERT OR IGNORE INTO gap_recovery_messages(chat_id,message_id) VALUES(?,?)').run(chatId,messageId);
    db.prepare("UPDATE messages SET extraction_state='pending',updated_at=? WHERE chat_id=? AND message_id=?").run(timestamp,chatId,messageId);
  }
  if (needsReview.length && payload.canonicalRegenerationRunId) db.prepare("UPDATE extraction_batches SET status='pending_review' WHERE id=?").run(payload.batchId);
  const byReason={trivial:0,ooc:0,no_new_information:0,merged:0};
  skipped.forEach(reason=>byReason[reason]++);
  const sourceCoverage={total:ids.length,covered:covered.size,skipped:byReason,policySkipped:policy.size,unresolved:unresolved.length,retried:retryIds.length,needsReview:needsReview.length,diagnostics};
  db.prepare("UPDATE jobs SET payload_json=json_set(payload_json,'$.sourceCoverage',json(?)) WHERE id=?").run(JSON.stringify(sourceCoverage),jobId);
  return ids.filter(id=>!unresolved.includes(id) && !policy.has(id));
}

/** A copied source keeps its spent automatic retry, including host-reissued IDs. */
export function inheritSourceCoverageRetry(db:RcmDatabase,parent:string,child:string,ids:Map<string,string>,fork:number):void {
  const read=(chatId:string):SourceFingerprintItem[]=>{
    const row=db.prepare('SELECT value FROM server_meta WHERE key=?').get(`source_coverage_retry:${chatId}`) as {value:string}|undefined;
    return row ? JSON.parse(row.value) : [];
  };
  const previous=read(child);
  const inherited=read(parent).flatMap(item=>{
    const messageId=ids.get(item.messageId) ?? item.messageId;
    const source=sourceFingerprint(db,child,[messageId])[0];
    return source && source.ordinal<=fork && source.contentHash===item.contentHash && source.sourceKind===item.sourceKind ? [source] : [];
  });
  if(!inherited.length) return;
  const merged=new Map([...previous,...inherited].map(item=>[item.messageId,item]));
  db.prepare('INSERT OR REPLACE INTO server_meta(key,value) VALUES(?,?)').run(`source_coverage_retry:${child}`,JSON.stringify([...merged.values()]));
}
