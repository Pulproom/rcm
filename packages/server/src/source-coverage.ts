import { chatUpgradeLock } from './upgrade-lock.js';
import { deletedMemoryKeys } from './user-deletions.js';
import { rebuildCharacterRecallTraces } from './ingest.js';
import { sourceTurnMembership } from './turn-clock.js';
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
  upgradeRunId?:string;
  promptContract?:string|null;
  stateContract?:string|null;
  coverageRetry?: number;
  coverageParentJobId?: string;
  coverageParentBatchId?: string;
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
  const reserved=deletedMemoryKeys(db,chatId);
  for (const skip of stored.skippedSource ?? []) {
    const signature=JSON.stringify(skip);
    if (declarations.has(signature)) continue;
    declarations.add(signature);
    if (!ids.includes(skip.messageId)) { diagnostics.push({messageId:skip.messageId,reason:'outside_batch'}); continue; }
    if (skip.reason==='merged' && (!skip.memoryKey || !savedKeys.has(scopeMemoryKey(skip.memoryKey,stored.memoryScope,reserved)))) {
      diagnostics.push({messageId:skip.messageId,reason:'unknown_memory_key'}); continue;
    }
    if (!covered.has(skip.messageId) && !policy.has(skip.messageId) && !skipped.has(skip.messageId)) skipped.set(skip.messageId,skip.reason);
  }
  const turns=sourceTurnMembership(db,chatId).filter(turn=>ids.includes(turn.at(-1)!.message_id))
    .map(turn=>turn.filter(row=>ids.includes(row.message_id)));
  for (const turn of turns) {
    const response=turn.at(-1)!.message_id;
    for (const row of turn.slice(0,-1)) {
      covered.delete(row.message_id); skipped.delete(row.message_id);
      if (covered.has(response)) covered.add(row.message_id);
      else if (skipped.has(response)) skipped.set(row.message_id,skipped.get(response)!);
      else if (policy.has(response)) {
        policy.add(row.message_id);
        db.prepare("UPDATE messages SET extraction_state='skipped_policy' WHERE chat_id=? AND message_id=?").run(chatId,row.message_id);
      }
    }
  }
  // User evidence/skip declarations cannot resolve the response. Its verdict
  // applies to every selected member of the turn.
  const unresolvedTurns=turns.filter(turn=>{
    const response=turn.at(-1)!.message_id;
    return !covered.has(response) && !skipped.has(response) && !policy.has(response);
  });
  const unresolved=unresolvedTurns.flatMap(turn=>turn.map(row=>row.message_id));
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
  const retryTurns=payload.coverageRetry === 1 ? [] : unresolvedTurns.filter(turn=>{
    const response=fingerprint.find(item=>item.messageId===turn.at(-1)!.message_id)!;
    return !attempted.some(old=>old.messageId===response.messageId && old.contentHash===response.contentHash);
  });
  const retry=retryTurns.flatMap(turn=>turn.map(row=>fingerprint.find(item=>item.messageId===row.message_id)!));
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
      .run(id,chatId,JSON.stringify({sourceMessageIds:retryIds,sourceFingerprint:retry,coverageRetry:1,coverageParentJobId:jobId,coverageParentBatchId:payload.batchId,coverageRetryFingerprint:retry,
        batchId,turnCount,includeUserMessages:payload.includeUserMessages,memoryLanguage:payload.memoryLanguage,postExtractionReview:payload.postExtractionReview,
        trigger:payload.trigger ?? 'extraction',backfillRunId:payload.backfillRunId,canonicalRegenerationRunId:payload.canonicalRegenerationRunId,
        ...(payload.upgradeRunId ? {upgradeRunId:payload.upgradeRunId,promptContract:payload.promptContract,stateContract:payload.stateContract} : {})}),timestamp,timestamp);
    db.prepare(`INSERT INTO extraction_batches(id,chat_id,job_id,generation_id,kind,source_message_ids_json,source_fingerprint_json,start_ordinal,end_ordinal,status,created_at,updated_at)
      VALUES(?,?,?,?,'extract',?,?,?,?,'queued',?,?)`).run(batchId,chatId,id,generation,JSON.stringify(retryIds),JSON.stringify(retry),Math.min(...retry.map(x=>x.ordinal)),Math.max(...retry.map(x=>x.ordinal)),timestamp,timestamp);
    if (payload.batchId) recordCoverageRetryFamily(db,chatId,batchId,payload.batchId);
    for (const messageId of retryIds) db.prepare("UPDATE messages SET extraction_state='queued',updated_at=? WHERE chat_id=? AND message_id=?").run(timestamp,chatId,messageId);
  }
  for (const messageId of needsReview) {
    db.prepare('INSERT OR IGNORE INTO gap_recovery_messages(chat_id,message_id) VALUES(?,?)').run(chatId,messageId);
    db.prepare("UPDATE messages SET extraction_state='pending',updated_at=? WHERE chat_id=? AND message_id=?").run(timestamp,chatId,messageId);
  }
  if (needsReview.length && (payload.canonicalRegenerationRunId || payload.upgradeRunId)) db.prepare("UPDATE extraction_batches SET status='pending_review' WHERE id=?").run(payload.batchId);
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

/** Chat-owned durable family survives job cleanup; backups already store server_meta. */
export function recordCoverageRetryFamily(db:RcmDatabase,chatId:string,retryId:string,parentId:string):void {
  const key=`source_coverage_family:${chatId}`;
  const row=db.prepare('SELECT value FROM server_meta WHERE key=?').get(key) as {value:string}|undefined;
  const families:Record<string,string>=JSON.parse(row?.value ?? '{}');
  if (families[retryId]===parentId) return;
  families[retryId]=parentId;
  db.prepare('INSERT OR REPLACE INTO server_meta(key,value) VALUES(?,?)').run(key,JSON.stringify(families));
}

/** No ordinal overlap inference: an explicit job link or recorded family is required. */
export function coverageRetryFamilies(db:RcmDatabase,chatId:string):Map<string,string> {
  const batches=db.prepare(`SELECT b.id,b.job_id,b.generation_id,b.source_message_ids_json,json_extract(j.payload_json,'$.coverageParentJobId') parent_job_id
    FROM extraction_batches b LEFT JOIN jobs j ON j.id=b.job_id AND j.chat_id=b.chat_id WHERE b.chat_id=?`).all(chatId) as
    Array<{id:string;job_id:string|null;generation_id:string;source_message_ids_json:string;parent_job_id:string|null}>;
  if (!batches.length) return new Map();
  const row=db.prepare('SELECT value FROM server_meta WHERE key=?').get(`source_coverage_family:${chatId}`) as {value:string}|undefined;
  const recorded:Record<string,string>=JSON.parse(row?.value ?? '{}');
  const families=new Map<string,string>();
  const byId=new Map(batches.map(batch=>[batch.id,batch]));
  const byJob=new Map(batches.filter(batch=>batch.job_id).map(batch=>[batch.job_id,batch.id]));
  const members=new Map<string,Set<string>>();
  for (const batch of batches) {
    const parentId=recorded[batch.id] ?? byJob.get(batch.parent_job_id);
    const parent=parentId ? byId.get(parentId) : undefined;
    if (!parent || parent.id===batch.id || parent.generation_id!==batch.generation_id) continue;
    const ids=JSON.parse(batch.source_message_ids_json) as string[];
    if (!members.has(parent.id)) members.set(parent.id,new Set(JSON.parse(parent.source_message_ids_json) as string[]));
    const parentIds=members.get(parent.id)!;
    if (ids.length && ids.every(id=>parentIds.has(id))) families.set(batch.id,parent.id);
  }
  return families;
}

/** Fold ownership and retain retry results in the parent replay snapshot. */
export function foldCoverageRetry(db:RcmDatabase,chatId:string,retryId:string,parentId:string):boolean {
  if (coverageRetryFamilies(db,chatId).get(retryId)!==parentId) return false;
  return foldAcceptedCoverageRetry(db,chatId,retryId,parentId);
}

/** Review ownership only: inherited work must never enter the executable queue. */
export function createInheritedReviewJob(db:RcmDatabase,chatId:string,sourceMessageIds:string[]):string {
  const id=randomUUID(), now=Date.now();
  db.prepare("INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'extract','superseded',?,0,?,?)")
    .run(id,chatId,JSON.stringify({sourceMessageIds,inheritedReview:true}),now,now);
  return id;
}

/** Slice only response-closed, resolved turns. Membership never supplies a verdict. */
export function inheritedSliceRuns(db:RcmDatabase,chatId:string,sourceIds:string[]):string[][] {
  const selected=new Set(sourceIds);
  const runs:string[][]=[];
  let run:string[]=[];
  for (const turn of sourceTurnMembership(db,chatId)) {
    const members=turn.filter(source=>selected.has(source.message_id));
    if (selected.has(turn.at(-1)!.message_id) && ['done','encapsulated'].includes(turn.at(-1)!.extraction_state)
      && members.every(source=>['done','encapsulated','skipped_policy'].includes(source.extraction_state))) run.push(...members.map(source=>source.message_id));
    else if (run.length) { runs.push(run); run=[]; }
  }
  if (run.length) runs.push(run);
  return runs;
}

export function createInheritedSliceBatch(db:RcmDatabase,chatId:string,ids:string[],parent:{kind:string;producer_event_contract:string|null;producer_state_contract:string|null},createdAt:number):string {
  const id=randomUUID(), fingerprint=sourceFingerprint(db,chatId,ids);
  db.prepare(`INSERT INTO extraction_batches(id,chat_id,generation_id,kind,source_message_ids_json,source_fingerprint_json,
    start_ordinal,end_ordinal,status,final_json,producer_event_contract,producer_state_contract,created_at,updated_at)
    VALUES(?,?,'active',?,?,?,?,?,'applied',NULL,?,?,?,?)`).run(id,chatId,parent.kind,JSON.stringify(ids),JSON.stringify(fingerprint),
      fingerprint[0]!.ordinal,fingerprint.at(-1)!.ordinal,parent.producer_event_contract,parent.producer_state_contract,createdAt,createdAt);
  return id;
}

export const batchMaterialTables = ['memories','assertions','beliefs','social_knowledge_events','promises','promise_events','atom_relations',
  'relationship_events','physical_intimacy_milestones','source_passages','memory_recall_events'] as const;
type BatchMaterialTable = typeof batchMaterialTables[number];
const storedBatchMaterialSql = batchMaterialTables.map(table=>
  `EXISTS (SELECT 1 FROM ${table} material WHERE material.chat_id=b.chat_id AND material.source_batch_id=b.id)`).join(' OR ');

const evidenceInSliceSql = (row:string, sources:string):string => `EXISTS (SELECT 1 FROM json_each(${row}.evidence_json) slice_evidence
  WHERE CASE WHEN slice_evidence.type='text' THEN slice_evidence.value ELSE json_extract(slice_evidence.value,'$.messageId') END
    IN (SELECT value FROM json_each(${sources})))`;

/** Source IDs and explicit ordinals only; no text or semantic inference. */
function materialInSliceSql(table:BatchMaterialTable,row:string,sources:string):string {
  if (table==='source_passages') return `${row}.message_id IN (SELECT value FROM json_each(${sources}))`;
  if (table==='promises') return `EXISTS (SELECT 1 FROM promise_events slice_event WHERE slice_event.chat_id=${row}.chat_id
    AND slice_event.promise_id=${row}.id AND ${materialInSliceSql('promise_events','slice_event',sources)})`;
  const ordinal = table==='assertions' || table==='beliefs' ? 'valid_from_ordinal'
    : table==='promise_events' ? 'source_ordinal'
    : ['social_knowledge_events','relationship_events','physical_intimacy_milestones','atom_relations'].includes(table) ? 'source_start_ordinal' : undefined;
  return `(${evidenceInSliceSql(row,sources)}${ordinal ? ` OR (json_array_length(${row}.evidence_json)=0 AND EXISTS (
    SELECT 1 FROM messages slice_source WHERE slice_source.chat_id=${row}.chat_id AND slice_source.ordinal=${row}.${ordinal}
      AND slice_source.message_id IN (SELECT value FROM json_each(${sources}))))` : ''})`;
}

export function batchHasStoredMaterial(db:RcmDatabase,chatId:string,batchId:string):boolean {
  // Older copies can have incomplete row evidence as well as orphaned lineage
  // ownership. Conservatively re-extract NULL prefixes while any such rows
  // remain; guessing that an unmapped slice is empty would lose live state.
  const orphaned=batchMaterialTables.map(table=>`EXISTS (SELECT 1 FROM ${table} material WHERE material.chat_id=b.chat_id
    AND material.source_batch_id LIKE 'lineage:%')`).join(' OR ');
  return Boolean(db.prepare(`SELECT 1 FROM extraction_batches b WHERE b.chat_id=? AND b.id=? AND
    ((${storedBatchMaterialSql}) OR b.final_json IS NULL AND (${orphaned}))`).get(chatId,batchId));
}

const inheritedMaterialKinds:Record<Exclude<BatchMaterialTable,'source_passages'>,string[]> = {
  memories:['memory'],assertions:['assertion'],beliefs:['belief','belief_tombstone'],social_knowledge_events:['social_knowledge'],
  promises:['promise'],promise_events:['promise_event'],atom_relations:['atom_relation'],relationship_events:['relationship_event'],
  physical_intimacy_milestones:['physical_intimacy_milestone'],memory_recall_events:['memory_recall_event'],
};

/** Called only after the shared clone-time, revision and source evidence gates. */
function reconnectInheritedSliceMaterial(db:RcmDatabase,chatId:string,batchId:string,parent:string,parentBatch:string,sources:string[]):void {
  for (const table of batchMaterialTables.filter(table=>table!=='memories')) {
    const proof=table==='source_passages' ? `EXISTS (SELECT 1 FROM source_passages p JOIN chat_lineage_items i
      ON i.child_chat_id=c.chat_id AND i.item_kind='message' AND i.child_item_id=c.message_id AND i.parent_item_id=p.message_id
      WHERE p.chat_id=@parent AND p.source_batch_id=@parentBatch AND p.canonical_hash=c.canonical_hash
        AND p.start_offset=c.start_offset AND p.end_offset=c.end_offset AND p.quote=c.quote)`
      : `EXISTS (SELECT 1 FROM chat_lineage_items i JOIN ${table} p ON p.chat_id=@parent AND p.id=i.parent_item_id
        WHERE i.child_chat_id=c.chat_id AND i.child_item_id=c.id AND i.item_kind IN (${inheritedMaterialKinds[table].map(kind=>`'${kind}'`).join(',')})
          AND p.source_batch_id=@parentBatch)`;
    db.prepare(`UPDATE ${table} AS c SET source_batch_id=@batchId WHERE c.chat_id=@chatId
      AND (c.source_batch_id IS NULL OR c.source_batch_id LIKE 'lineage:%') AND ${proof}
      AND ${materialInSliceSql(table,'c','@sources')}`).run({chatId,batchId,parent,parentBatch,sources:JSON.stringify(sources)});
  }
}

/** NULL is unaccepted only when no stored material could have lost its snapshot.
 * Drafts/audits remain diagnostics and never own a replacement's accepted result. */
export function unacceptedPendingBatches(db:RcmDatabase,chatId:string):Set<string> {
  return new Set((db.prepare(`SELECT b.id FROM extraction_batches b WHERE b.chat_id=?
    AND b.status='pending_review' AND b.final_json IS NULL
    AND NOT (${storedBatchMaterialSql})`)
    .all(chatId) as Array<{id:string}>).map(row=>row.id));
}

/** An accepted replacement must cover every non-policy source in the same generation.
 * Retire diagnostic work, never invent an empty/complete replay snapshot. */
function retireReplacedDrafts(db:RcmDatabase,chatId:string):void {
  for (const id of unacceptedPendingBatches(db,chatId)) {
    const retired=db.prepare(`UPDATE extraction_batches AS b SET status='superseded',updated_at=?
      WHERE b.id=? AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id=b.job_id AND j.status='leased')
      AND NOT EXISTS (SELECT 1 FROM json_each(b.source_message_ids_json) s
        LEFT JOIN messages m ON m.chat_id=b.chat_id AND m.message_id=s.value
        WHERE m.extraction_state IS NULL OR m.extraction_state NOT IN ('done','encapsulated','skipped_policy')
          OR EXISTS (SELECT 1 FROM gap_recovery_messages g WHERE g.chat_id=b.chat_id AND g.message_id=s.value)
          OR (m.extraction_state<>'skipped_policy' AND NOT EXISTS (
            SELECT 1 FROM extraction_batches replacement,json_each(replacement.source_message_ids_json) r
            WHERE replacement.chat_id=b.chat_id AND replacement.generation_id=b.generation_id
              AND replacement.id<>b.id AND replacement.status='applied' AND replacement.final_json IS NOT NULL AND r.value=s.value)))
      RETURNING job_id`).get(Date.now(),id) as {job_id:string|null}|undefined;
    if (retired?.job_id) db.prepare("UPDATE jobs SET status='superseded',lease_owner=NULL,leased_until=NULL,updated_at=? WHERE id=? AND status IN ('queued','failed')")
      .run(Date.now(),retired.job_id);
  }
}

/** Review completion cannot substitute for an unresolved response or missing result. */
export function finishReviewedBatches(db:RcmDatabase,chatId:string):void {
  const ready=db.prepare(`SELECT b.id FROM extraction_batches b WHERE b.chat_id=? AND b.status='pending_review'
    AND b.job_id IS NOT NULL AND b.final_json IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM reconciliation_items r WHERE r.chat_id=b.chat_id AND r.job_id=b.job_id AND r.status='pending')
    AND NOT EXISTS (SELECT 1 FROM json_each(b.source_message_ids_json) s
      LEFT JOIN messages m ON m.chat_id=b.chat_id AND m.message_id=s.value
      WHERE m.extraction_state IS NULL OR m.extraction_state NOT IN ('done','encapsulated','skipped_policy')
        OR EXISTS (SELECT 1 FROM gap_recovery_messages g WHERE g.chat_id=b.chat_id AND g.message_id=s.value))`).all(chatId) as Array<{id:string}>;
  const families=ready.length ? coverageRetryFamilies(db,chatId) : new Map<string,string>();
  for (const {id} of ready) {
    db.prepare("UPDATE extraction_batches SET status='applied',updated_at=? WHERE id=?").run(Date.now(),id);
    const parent=families.get(id);
    if (parent) foldCoverageRetry(db,chatId,id,parent);
  }
  retireReplacedDrafts(db,chatId);
}

/** The caller has already established structural family membership. */
function foldAcceptedCoverageRetry(db:RcmDatabase,chatId:string,retryId:string,parentId:string):boolean {
  const key=`source_coverage_folded:${chatId}`;
  const row=db.prepare('SELECT value FROM server_meta WHERE key=?').get(key) as {value:string}|undefined;
  const folded:Record<string,string>=JSON.parse(row?.value ?? '{}');
  const batch=db.prepare('SELECT status,final_json FROM extraction_batches WHERE id=?').get(retryId) as {status:string;final_json:string|null};
  if (folded[retryId]===parentId) {
    // Resolving reviews may retire a family whose accepted material was folded earlier.
    if (batch.status==='applied') db.prepare("UPDATE extraction_batches SET status='superseded',updated_at=? WHERE id=?").run(Date.now(),retryId);
    return false;
  }
  const parent=db.prepare('SELECT status,final_json FROM extraction_batches WHERE id=?').get(parentId) as {status:string;final_json:string|null};
  if (!['applied','pending_review','superseded'].includes(batch.status) || !['applied','pending_review'].includes(parent.status)) return false;
  if (batch.status==='pending_review' && !batch.final_json) return false;
  return db.transaction(()=>{
    recordCoverageRetryFamily(db,chatId,retryId,parentId);
    // Prefix replay and inherited copies consume the parent's frozen result.
    // Union stored arrays structurally; never rewrite memory text or infer meaning.
    // A superseded retry from the previous hotfix has already been folded.
    // Adopt its completion marker without replaying history into an edited parent.
    if (batch.status!=='superseded' && batch.final_json && parent.final_json) {
      const combined=JSON.parse(parent.final_json), retry=JSON.parse(batch.final_json);
      let changed=false;
      for (const [key,items] of Object.entries(retry)) {
        if (!Array.isArray(items)) continue;
        const existing=Array.isArray(combined[key]) ? combined[key] : [];
        const seen=new Set(existing.map((item:unknown)=>JSON.stringify(item)));
        const additions=items.filter(item=>{const signature=JSON.stringify(item); if(seen.has(signature)) return false; seen.add(signature); return true;});
        if (additions.length) { combined[key]=[...existing,...additions]; changed=true; }
      }
      if (changed) db.prepare('UPDATE extraction_batches SET final_json=?,updated_at=? WHERE id=?').run(JSON.stringify(combined),Date.now(),parentId);
    }
    // The recall journal has one occurrence per batch/memory/holder. Preserve
    // both evidence sets and the stronger typed action when a family collides.
    let mergedRecall=false;
    const recalls=db.prepare('SELECT * FROM memory_recall_events WHERE chat_id=? AND source_batch_id=?').all(chatId,retryId) as
      Array<{id:string;memory_id:string;holder:string;action:string;confidence:number;evidence_json:string;created_revision:number;completed_turn_seq:number}>;
    for (const recall of recalls) {
      const previous=db.prepare('SELECT * FROM memory_recall_events WHERE source_batch_id=? AND memory_id=? AND holder=?').get(parentId,recall.memory_id,recall.holder) as typeof recall|undefined;
      if (!previous) continue;
      const actions=['mentioned','recalled','reexperienced'];
      const evidence=[...new Set([...JSON.parse(previous.evidence_json),...JSON.parse(recall.evidence_json)])];
      db.prepare(`UPDATE memory_recall_events SET action=?,confidence=?,evidence_json=?,created_revision=?,completed_turn_seq=? WHERE id=?`)
        .run(actions[Math.max(actions.indexOf(previous.action),actions.indexOf(recall.action))],Math.max(previous.confidence,recall.confidence),JSON.stringify(evidence),
          Math.max(previous.created_revision,recall.created_revision),Math.max(previous.completed_turn_seq,recall.completed_turn_seq),previous.id);
      db.prepare('DELETE FROM memory_recall_events WHERE id=?').run(recall.id); mergedRecall=true;
    }
    for (const table of batchMaterialTables) {
      db.prepare(`UPDATE ${table} SET source_batch_id=? WHERE chat_id=? AND source_batch_id=?`).run(parentId,chatId,retryId);
    }
    if (mergedRecall) rebuildCharacterRecallTraces(db,chatId);
    if (batch.status==='applied') db.prepare("UPDATE extraction_batches SET status='superseded',updated_at=? WHERE id=?").run(Date.now(),retryId);
    folded[retryId]=parentId;
    db.prepare('INSERT OR REPLACE INTO server_meta(key,value) VALUES(?,?)').run(key,JSON.stringify(folded));
    return true;
  })();
}

/** Pre-fix copies have no batch lineage IDs. Exact sources prove correspondence;
 * clone-time and memory lineage must also prove inheritance before any repair. */
function repairInheritedCoverage(db:RcmDatabase,chatId:string):void {
  const lineage=db.prepare(`SELECT l.parent_chat_id,l.fork_ordinal,l.applied_at FROM chat_lineage l JOIN chats p ON p.id=l.parent_chat_id
    WHERE l.child_chat_id=? AND l.status='inherited'`).get(chatId) as {parent_chat_id:string;fork_ordinal:number;applied_at:number|null}|undefined;
  if (!lineage || lineage.applied_at===null) return;
  const parent=lineage.parent_chat_id;
  const ids=new Map((db.prepare(`SELECT i.child_item_id,i.parent_item_id FROM chat_lineage_items i
    JOIN messages c ON c.chat_id=i.child_chat_id AND c.message_id=i.child_item_id
    JOIN messages p ON p.chat_id=? AND p.message_id=i.parent_item_id
    WHERE i.child_chat_id=? AND i.item_kind='message'`).all(parent,chatId) as Array<{child_item_id:string;parent_item_id:string}>)
    .map(row=>[row.child_item_id,row.parent_item_id]));
  type Batch={id:string;job_id:string|null;status:string;final_json:string|null;source_message_ids_json:string;created_at:number;
    kind:string;producer_event_contract:string|null;producer_state_contract:string|null};
  const batches=(id:string)=>db.prepare(`SELECT b.id,b.job_id,b.status,b.final_json,b.source_message_ids_json,b.created_at,
    b.kind,b.producer_event_contract,b.producer_state_contract FROM extraction_batches b WHERE b.chat_id=? AND b.generation_id='active'`).all(id) as Batch[];
  const signature=(sources:string[])=>JSON.stringify([...new Set(sources)].sort());
  const parents=new Map<string,Batch[]>(), children=new Map<string,Batch[]>();
  for (const batch of batches(parent)) {
    const sources=JSON.parse(batch.source_message_ids_json) as string[];
    if (!sources.length) continue;
    const key=signature(sources);
    parents.set(key,[...parents.get(key) ?? [],batch]);
  }
  for (const batch of batches(chatId)) {
    const sources=JSON.parse(batch.source_message_ids_json) as string[];
    if (!sources.length || sources.some(id=>!ids.has(id))) continue;
    const mapped=sources.map(id=>ids.get(id)!);
    if (new Set(mapped).size!==new Set(sources).size) continue;
    const key=signature(mapped);
    children.set(key,[...children.get(key) ?? [],batch]);
  }
  const firstRegeneration=(db.prepare('SELECT MIN(created_at) created_at FROM regeneration_runs WHERE chat_id=?').get(chatId) as {created_at:number|null}).created_at;
  const unprovenMemory=db.prepare(`SELECT 1 FROM memories c
    LEFT JOIN chat_lineage_items i ON i.child_chat_id=c.chat_id AND i.item_kind='memory' AND i.child_item_id=c.id
    LEFT JOIN memories p ON p.chat_id=? AND p.id=i.parent_item_id
    WHERE c.chat_id=? AND (c.source_batch_id=? OR EXISTS (
      SELECT 1 FROM json_each(?,'$.memories') memory WHERE json_extract(memory.value,'$.key')=c.memory_key))
    AND (c.created_at<>? OR p.id IS NULL OR p.memory_key<>c.memory_key OR NOT EXISTS (
      SELECT 1 FROM json_each(?,'$.memories') memory WHERE json_extract(memory.value,'$.key')=p.memory_key)) LIMIT 1`);
  const matched=new Map<string,Batch>();
  const inheritedSnapshot=(original:Batch):string=>original.final_json ?? JSON.stringify({memories:
    db.prepare('SELECT memory_key AS key FROM memories WHERE chat_id=? AND source_batch_id=?').all(parent,original.id)});
  const inheritedEvidence=(child:Pick<Batch,'id'|'created_at'|'job_id'|'final_json'>,original:Batch):boolean=>{
    // Shared by family restoration and missing fork slices: a jobless batch
    // alone proves nothing about its origin.
    if (child.created_at!==lineage.applied_at || original.created_at>lineage.applied_at!
      || firstRegeneration!==null && child.created_at>=firstRegeneration) return false;
    const snapshot=inheritedSnapshot(original);
    if (unprovenMemory.get(parent,chatId,child.id,child.final_json,lineage.applied_at,snapshot)) return false;
    return !child.job_id || Boolean(db.prepare("SELECT 1 FROM jobs WHERE id=? AND chat_id=? AND json_extract(payload_json,'$.inheritedReview')=1").get(child.job_id,chatId));
  };
  for (const [key,rows] of children) {
    const originals=parents.get(key);
    if (rows.length!==1 || originals?.length!==1) continue;
    const child=rows[0]!, original=originals[0]!;
    if (!inheritedEvidence(child,original)) continue;
    matched.set(original.id,child);
    if (child.status!=='pending_review' || child.final_json===null || child.job_id) continue;
    // Old copies gave reviews their own placeholder job, but left the batch
    // jobless. Reattach that exact review ownership before allowing completion.
    const reviews=db.prepare(`SELECT c.job_id FROM reconciliation_items p
      LEFT JOIN chat_lineage_items i ON i.child_chat_id=? AND i.item_kind='reconciliation_review' AND i.parent_item_id=p.id
      LEFT JOIN reconciliation_items c ON c.chat_id=i.child_chat_id AND c.id=i.child_item_id
      WHERE p.chat_id=? AND p.job_id=? AND (p.status='pending' OR i.child_item_id IS NOT NULL)`)
      .all(chatId,parent,original.job_id) as Array<{job_id:string|null}>;
    const jobs=new Set(reviews.map(row=>row.job_id));
    if (jobs.size>1 || jobs.has(null)) continue;
    // Parent review history may have been cleaned up after the copy. Without
    // its map, a new owner must not bypass still-pending child reviews.
    if (!reviews.length && db.prepare("SELECT 1 FROM reconciliation_items WHERE chat_id=? AND status='pending'").get(chatId)) continue;
    const job=reviews[0]?.job_id ?? createInheritedReviewJob(db,chatId,JSON.parse(child.source_message_ids_json));
    db.prepare('UPDATE extraction_batches SET job_id=? WHERE id=?').run(job,child.id);
  }
  // Old forks omitted the crossing batch entirely. Claim only unbatched done
  // turns with exact source and clone-time memory lineage, never replacements.
  const claimed=new Set((db.prepare(`SELECT s.value id FROM extraction_batches b,json_each(b.source_message_ids_json) s
    WHERE b.chat_id=?`).all(chatId) as {id:string}[]).map(row=>row.id));
  const mapped=new Map([...ids].map(([childId,parentId])=>[parentId,childId]));
  const parentBatches=batches(parent);
  const parentSources=new Map(sourceFingerprint(db,parent,[...new Set(parentBatches.flatMap(batch=>JSON.parse(batch.source_message_ids_json) as string[]))]).map(source=>[source.messageId,source]));
  const childSources=new Map(sourceFingerprint(db,chatId,[...ids.keys()]).map(source=>[source.messageId,source]));
  const revisionReceipt=(slice:string[])=>slice.every(id=>Boolean(db.prepare(`SELECT 1 FROM message_revisions r JOIN messages m ON m.chat_id=r.chat_id AND m.message_id=r.message_id
    WHERE r.chat_id=? AND r.message_id=? AND r.created_at=?
      AND CASE WHEN r.canonical_hash<>'' THEN r.canonical_hash ELSE r.content_hash END
        =CASE WHEN m.canonical_hash<>'' THEN m.canonical_hash ELSE m.content_hash END`).get(chatId,id,lineage.applied_at)));
  const reconnect=(child:Pick<Batch,'id'>,original:Batch,slice:string[])=>{
    const snapshot=inheritedSnapshot(original);
    db.prepare(`UPDATE memories AS c SET source_batch_id=? WHERE c.chat_id=? AND c.created_at=? AND EXISTS (
        SELECT 1 FROM chat_lineage_items i JOIN memories p ON p.chat_id=? AND p.id=i.parent_item_id
        WHERE i.child_chat_id=c.chat_id AND i.item_kind='memory' AND i.child_item_id=c.id AND p.memory_key=c.memory_key
          AND (p.source_batch_id=? OR EXISTS (SELECT 1 FROM json_each(?,'$.memories') m WHERE json_extract(m.value,'$.key')=p.memory_key)))
        AND EXISTS (SELECT 1 FROM json_each(c.evidence_json) e WHERE json_extract(e.value,'$.messageId') IN (SELECT value FROM json_each(?)))
        AND (c.source_batch_id IS NULL OR c.source_batch_id=?)`).run(child.id,chatId,lineage.applied_at,parent,original.id,snapshot,JSON.stringify(slice),`lineage:${original.id}`);
    reconnectInheritedSliceMaterial(db,chatId,child.id,parent,original.id,slice);
  };
  for (const original of parentBatches) {
    if (original.status!=='applied') continue;
    const originals=(JSON.parse(original.source_message_ids_json) as string[]);
    const prefix=originals.filter(id=>parentSources.get(id)?.ordinal!<=lineage.fork_ordinal);
    if (prefix.some(id=>!mapped.has(id))) continue;
    // Also repair slices synthesized by earlier builds; never relabel a
    // regenerated/jobless batch just because its source set overlaps.
    const matching=new Set(prefix.flatMap(id=>{
      const childId=mapped.get(id),source=parentSources.get(id),copy=childId?childSources.get(childId):undefined;
      return childId && source && copy && source.contentHash===copy.contentHash && source.sourceKind===copy.sourceKind ? [childId] : [];
    }));
    const existing=batches(chatId).filter(row=>row.status==='applied' && row.final_json===null);
    for (const child of existing) {
      const slice=JSON.parse(child.source_message_ids_json) as string[];
      if (slice.length && slice.every(id=>matching.has(id)) && revisionReceipt(slice) && inheritedEvidence(child,original)
        && existing.filter(row=>signature(JSON.parse(row.source_message_ids_json))===signature(slice)).length===1) reconnect(child,original,slice);
    }
    for (const slice of inheritedSliceRuns(db,chatId,[...matching].filter(id=>!claimed.has(id)))) {
      // Missing batches have no clone timestamp of their own. The source revision
      // receipt supplies it; current source IDs/hashes alone cannot prove a copy.
      if (!revisionReceipt(slice)) continue;
      const snapshot=inheritedSnapshot(original);
      if (!inheritedEvidence({id:'',created_at:lineage.applied_at,job_id:null,final_json:snapshot},original)) continue;
      const id=createInheritedSliceBatch(db,chatId,slice,original,lineage.applied_at);
      reconnect({id},original,slice);
      slice.forEach(source=>claimed.add(source));
    }
  }
  const row=db.prepare('SELECT value FROM server_meta WHERE key=?').get(`source_coverage_folded:${chatId}`) as {value:string}|undefined;
  const folded:Record<string,string>=JSON.parse(row?.value ?? '{}');
  const recorded=coverageRetryFamilies(db,chatId);
  let turns:ReturnType<typeof sourceTurnMembership>|undefined;
  const inheritedRetrySources=new Set<string>();
  for (const [retryId,parentId] of coverageRetryFamilies(db,parent)) {
    const retry=matched.get(retryId), owner=matched.get(parentId);
    if (!retry || !owner || !['applied','pending_review'].includes(owner.status)) continue;
    for (const source of JSON.parse(retry.source_message_ids_json) as string[]) inheritedRetrySources.add(ids.get(source)!);
    if (folded[retry.id]===owner.id || recorded.has(retry.id)) continue;
    recordCoverageRetryFamily(db,chatId,retry.id,owner.id);
    if (['applied','superseded'].includes(retry.status)) foldCoverageRetry(db,chatId,retry.id,owner.id);
    else {
      // As in inheritance, unresolved retries defer whole response-anchored
      // turns. Do not undo a response already resolved by later child work.
      const sources=new Set<string>(JSON.parse(retry.source_message_ids_json));
      for (const turn of (turns ??= sourceTurnMembership(db,chatId)).filter(turn=>turn.some(source=>sources.has(source.message_id)))) {
        if (['done','encapsulated','skipped_policy'].includes(turn.at(-1)!.extraction_state)) continue;
        for (const source of turn) {
          if (source.role==='user' && source.extraction_state==='skipped_policy') continue;
          db.prepare("UPDATE messages SET extraction_state='pending' WHERE chat_id=? AND message_id=?").run(chatId,source.message_id);
          db.prepare('INSERT OR IGNORE INTO gap_recovery_messages(chat_id,message_id) VALUES(?,?)').run(chatId,source.message_id);
        }
      }
    }
  }
  // Copies predating watermark inheritance lost this ledger too. Restore only
  // a wholly missing guard, with complete IDs and the existing hash/fork checks.
  if (inheritedRetrySources.size && !db.prepare('SELECT 1 FROM server_meta WHERE key=?').get(`source_coverage_retry:${chatId}`)) {
    const guard=db.prepare('SELECT value FROM server_meta WHERE key=?').get(`source_coverage_retry:${parent}`) as {value:string}|undefined;
    const attempts:SourceFingerprintItem[]=JSON.parse(guard?.value ?? '[]');
    const mapped=new Map([...ids].map(([childId,parentId])=>[parentId,childId]));
    if (attempts.length && attempts.every(item=>mapped.has(item.messageId) && inheritedRetrySources.has(item.messageId))) inheritSourceCoverageRetry(db,parent,chatId,mapped,lineage.fork_ordinal);
  }
}

/** Idempotent structural repair after migration/restore. No model calls or memory deletion. */
export function repairSourceCoverage(db:RcmDatabase,onlyChatId?:string):void {
  db.transaction(()=>{
    const chats=onlyChatId ? [{id:onlyChatId}] : db.prepare(`SELECT c.id FROM chats c WHERE
      EXISTS (SELECT 1 FROM messages m WHERE m.chat_id=c.id AND m.role='user' AND m.extraction_state IN ('pending','queued','blocked','cancelled'))
      OR EXISTS (SELECT 1 FROM gap_recovery_messages g WHERE g.chat_id=c.id)
      OR EXISTS (SELECT 1 FROM extraction_batches b WHERE b.chat_id=c.id AND b.status='pending_review' AND b.final_json IS NULL)
      OR EXISTS (SELECT 1 FROM chat_lineage l JOIN chats p ON p.id=l.parent_chat_id WHERE l.child_chat_id=c.id AND l.status='inherited')
      OR EXISTS (SELECT 1 FROM extraction_batches b LEFT JOIN jobs j ON j.id=b.job_id AND j.chat_id=b.chat_id
        WHERE b.chat_id=c.id AND (json_extract(j.payload_json,'$.coverageParentJobId') IS NOT NULL
          OR EXISTS (SELECT 1 FROM server_meta meta,json_each(meta.value) family WHERE meta.key='source_coverage_family:'||c.id AND family.key=b.id))
        AND NOT EXISTS (SELECT 1 FROM server_meta meta,json_each(meta.value) folded WHERE meta.key='source_coverage_folded:'||c.id AND folded.key=b.id))`).all() as Array<{id:string}>;
    // Backup restore can insert descendants before their parents. Recover the
    // ancestor's durable family first so one startup also repairs nested copies.
    const byId=new Set(chats.map(chat=>chat.id)), seen=new Set<string>(), ordered:string[]=[];
    const parents=new Map((db.prepare("SELECT child_chat_id,parent_chat_id FROM chat_lineage WHERE status='inherited'").all() as Array<{child_chat_id:string;parent_chat_id:string}>)
      .map(row=>[row.child_chat_id,row.parent_chat_id]));
    const visit=(id:string):void=>{
      if (seen.has(id)) return;
      seen.add(id);
      const parent=parents.get(id);
      if (parent && byId.has(parent)) visit(parent);
      ordered.push(id);
    };
    for (const {id} of chats) visit(id);
    for (const chatId of ordered) {
      // Upgrade completion owns its shadow; a generic startup/restore repair
      // must not change the frozen live canon or an in-flight candidate.
      if (chatUpgradeLock(db,chatId) || db.prepare("SELECT 1 FROM regeneration_runs WHERE mode='upgrade' AND shadow_chat_id=?").get(chatId)) continue;
      repairInheritedCoverage(db,chatId);
      let turns:ReturnType<typeof sourceTurnMembership>|undefined;
      const membership=()=>turns ??= sourceTurnMembership(db,chatId);
      const foldedRow=db.prepare('SELECT value FROM server_meta WHERE key=?').get(`source_coverage_folded:${chatId}`) as {value:string}|undefined;
      const folded:Record<string,string>=JSON.parse(foldedRow?.value ?? '{}');
      for (const [retry,parent] of coverageRetryFamilies(db,chatId)) {
        if (folded[retry]===parent) continue;
        recordCoverageRetryFamily(db,chatId,retry,parent);
        const status=(db.prepare('SELECT status FROM extraction_batches WHERE id=?').get(retry) as {status:string}).status;
        if (['applied','superseded'].includes(status)) foldAcceptedCoverageRetry(db,chatId,retry,parent);
        const orphan=db.prepare(`SELECT b.source_message_ids_json FROM extraction_batches b LEFT JOIN jobs j ON j.id=b.job_id
          WHERE b.id=? AND j.id IS NULL AND b.status IN ('queued','processing','failed')`).get(retry) as {source_message_ids_json:string}|undefined;
        if (orphan) {
          db.prepare("UPDATE extraction_batches SET status='superseded',updated_at=? WHERE id=?").run(Date.now(),retry);
          const ids=new Set<string>(JSON.parse(orphan.source_message_ids_json));
          for (const turn of membership().filter(turn=>turn.some(source=>ids.has(source.message_id)))) {
            if (['done','encapsulated','skipped_policy'].includes(turn.at(-1)!.extraction_state)) continue;
            for (const source of turn) db.prepare('INSERT OR IGNORE INTO gap_recovery_messages(chat_id,message_id) VALUES(?,?)').run(chatId,source.message_id);
          }
        }
      }
      if (!db.prepare(`SELECT 1 FROM messages WHERE chat_id=? AND role='user' AND extraction_state IN ('pending','queued','blocked','cancelled')
        UNION ALL SELECT 1 FROM gap_recovery_messages WHERE chat_id=? LIMIT 1`).get(chatId,chatId)) {
        finishReviewedBatches(db,chatId);
        continue;
      }
      const resolvedUsers=new Set<string>();
      for (const turn of membership()) {
        const response=turn.at(-1)!;
        if (!['done','encapsulated','skipped_policy'].includes(response.extraction_state)) continue;
        for (const message of turn) {
          db.prepare('DELETE FROM gap_recovery_messages WHERE chat_id=? AND message_id=?').run(chatId,message.message_id);
          if (message.role!=='user') continue;
          resolvedUsers.add(message.message_id);
          db.prepare(`UPDATE messages SET extraction_state=?,updated_at=? WHERE chat_id=? AND message_id=? AND extraction_state IN ('pending','queued','blocked','cancelled')`)
            .run(response.extraction_state,Date.now(),chatId,message.message_id);
        }
      }
      const queued=db.prepare(`SELECT id,payload_json FROM jobs WHERE chat_id=? AND type IN ('extract','episode','memory_addition','audit_retry','social_backfill') AND status IN ('queued','failed')`).all(chatId) as Array<{id:string;payload_json:string}>;
      for (const job of queued) {
        const payload=JSON.parse(job.payload_json), ids=payload.sourceMessageIds as string[]|undefined;
        if (!ids?.length || !ids.every(id=>resolvedUsers.has(id))) continue;
        db.prepare("UPDATE jobs SET status='superseded',lease_owner=NULL,leased_until=NULL,last_error='Extraction input dropped: response already resolved',updated_at=? WHERE id=?").run(Date.now(),job.id);
        if (payload.batchId) db.prepare("UPDATE extraction_batches SET status='superseded',updated_at=? WHERE id=? AND status IN ('queued','processing','failed')").run(Date.now(),payload.batchId);
      }
      finishReviewedBatches(db,chatId);
    }
  })();
}
