import {jobListMetadata} from './job-list-metadata.js';
import type { ProcessingCall, ProcessingHistory, ProcessingJob, ProcessingModel, ProcessingStage, ProcessingTotals, ProcessingUnit } from '@rcm/shared';
import { operationLabel, settingsFailureMessage, processingStageOrder, sumProcessingTotals, PROCESSING_BATCH_TYPES } from '@rcm/shared';
import type { RcmDatabase } from './db.js';
import { projectJobListPayload } from './jobs.js';
import { processingTokens, processingFailure, pruneProcessingHistoryPeriodically } from './processing-records.js';

export const PROCESSING_PAGE_SIZE = 12;
export const PROCESSING_JOB_PAGE_SIZE = 8;
export const PROCESSING_CALL_PAGE_SIZE = 40;
export const PROCESSING_COMPLETION_WINDOW_MS = 30_000;
type Row = Record<string, any>;
const batchKinds=new Set<string>(PROCESSING_BATCH_TYPES);
const batchTypes=PROCESSING_BATCH_TYPES.map(type=>`'${type}'`).join(',');
// Resolve queued shadow jobs before they acquire a lease/snapshot. The scalar
// uses the same explicit regeneration-id priority as recording and migration.
function unitCte(scoped: boolean): string {
 return `WITH ${scoped ? `owner_chats AS (
  SELECT @chatId id UNION SELECT shadow_chat_id FROM regeneration_runs WHERE chat_id=@chatId AND shadow_chat_id IS NOT NULL
), owned_job_ids AS (
  SELECT id FROM jobs WHERE chat_id IN (SELECT id FROM owner_chats)
  UNION SELECT id FROM processing_jobs WHERE chat_id=@chatId
),` : ''} source_jobs AS MATERIALIZED (
  SELECT j.id,j.chat_id,j.type,j.status,j.payload_json,j.attempts,j.created_at,j.updated_at,j.last_error,p.chat_id snapshot_chat,p.status snapshot_status,p.id snapshot_id,p.payload_json snapshot_payload FROM jobs j LEFT JOIN processing_jobs p ON p.id=j.id
  ${scoped ? 'WHERE j.id IN (SELECT id FROM owned_job_ids)' : ''}
  UNION ALL SELECT p.id,p.chat_id,p.type,p.status,p.payload_json,p.attempts,p.created_at,p.updated_at,NULL,p.chat_id,p.status,p.id,p.payload_json
  FROM processing_jobs p WHERE ${scoped ? 'p.chat_id IN (SELECT id FROM owner_chats) AND ' : ''}NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=p.id)
), base AS MATERIALIZED (
  SELECT j.id,COALESCE(r.chat_id,j.snapshot_chat,j.chat_id) chat_id,j.type,j.status,j.created_at,j.updated_at,j.attempts,
    processing_run_id(j.payload_json) run_id,
    COALESCE(json_extract(j.payload_json,'$.canonicalRegenerationRunId'),json_extract(j.payload_json,'$.regenerationRunId'),json_extract(j.payload_json,'$.upgradeRunId'),json_extract(j.payload_json,'$.upgradePhase2RunId')) IS NOT NULL regeneration,
    (SELECT MIN(started_at) FROM processing_calls pc WHERE pc.job_id=j.id) started_at,
    COALESCE(b.start_ordinal,json_extract(j.payload_json,'$.startOrdinal'),json_extract(j.snapshot_payload,'$.startOrdinal')) start,
    COALESCE(b.end_ordinal,json_extract(j.payload_json,'$.endOrdinal'),json_extract(j.snapshot_payload,'$.endOrdinal')) end,
    json_extract(j.payload_json,'$.operationStageOrdinal') batch,
    json_extract(j.payload_json,'$.sourceTurnCount') turns,
    json_extract(j.payload_json,'$.sourceRecovery') source_recovery,
    json_extract(j.payload_json,'$.llmCallStats.total') expected,
    json_extract(j.payload_json,'$.llmUsage.inputTokens') usage_input,
    json_extract(j.payload_json,'$.llmUsage.outputTokens') usage_output,j.snapshot_id
  FROM source_jobs j LEFT JOIN regeneration_runs r ON r.id=processing_run_id(j.payload_json) AND (r.chat_id=j.chat_id OR r.shadow_chat_id=j.chat_id)
  JOIN chats c ON c.id=COALESCE(r.chat_id,j.snapshot_chat,j.chat_id)
  LEFT JOIN extraction_batches b ON b.job_id=j.id
  WHERE c.is_internal=0 AND COALESCE(j.snapshot_status,'')<>'archived' AND j.status<>'archived'
    ${scoped ? 'AND c.id=@chatId' : ''}
    AND COALESCE(json_extract(j.payload_json,'$.inheritedReview'),0)=0
), preceding AS (
 SELECT b.*,CASE WHEN b.type='relationship_projection' AND b.run_id IS NULL AND b.started_at IS NOT NULL THEN (
   SELECT p.id FROM base p WHERE p.chat_id=b.chat_id AND p.type IN (${batchTypes}) AND p.status IN ('done','completed')
    AND p.updated_at<=b.started_at ORDER BY p.updated_at DESC,p.id DESC LIMIT 1
 ) END preceding_id FROM base b
), units AS (
 SELECT b.*,CASE WHEN b.run_id IS NOT NULL THEN 'run:'||b.run_id ELSE 'job:'||COALESCE(
   CASE WHEN p.run_id IS NULL AND b.started_at<=p.updated_at+${PROCESSING_COMPLETION_WINDOW_MS} THEN p.id END,b.id) END unit_id
 FROM preceding b LEFT JOIN base p ON p.id=b.preceding_id
)`;
}
const aggregate=`COUNT(*) calls,SUM(input_tokens) input,SUM(output_tokens) output,SUM(duration_ms) duration,
 SUM(input_tokens IS NULL OR output_tokens IS NULL) missing_tokens`;
const total=(row:Row|undefined):ProcessingTotals=>({calls:row?.calls??0,input:row?.input??null,output:row?.output??null,duration:row?.duration??null,missingTokens:row?.missing_tokens??0});
const model=(row:Row):ProcessingModel=>({site:row.site??null,provider:row.provider??null,slot:row.slot??null,model:row.model??null});
const title=(type:string,payload:Row):string=>payload.sourceRecovery?'원문 발췌 보완':type==='extract'?'새 대화 정리':type==='audit_retry'?'재검수':operationLabel(type);
const modelRows=(db:RcmDatabase,where:string,args:unknown[]):ProcessingModel[]=>(db.prepare(`SELECT DISTINCT site,provider,slot,model FROM processing_calls WHERE ${where} LIMIT 16`).all(...args) as Row[]).map(model);
function projectCall(row:Row):ProcessingCall {
 const stopped=row.outcome==='running'&&(row.attempt_outcome&&row.attempt_outcome!=='running'||row.job_status&&row.job_status!=='leased');
 return {...model(row),id:row.id,jobId:row.job_id,purpose:row.purpose,at:row.started_at,input:row.input_tokens,output:row.output_tokens,duration:row.duration_ms,
  outcome:stopped?'interrupted':row.outcome,code:row.failure_code,reason:row.reason,repairOf:row.repair_of,repairReason:row.repair_reason??null,
  attempt:row.ordinal??null,attemptCount:row.attempt_count??0,attemptOutcome:row.attempt_outcome??null,attemptReason:row.attempt_reason??null};
}

// Preserve only what was observed in old diagnostics. Missing starts, tokens,
// identity and retry reasons stay null; old aggregate totals are never divided.
function legacyCalls(payload: Row): ProcessingCall[] {
  const calls: ProcessingCall[] = [];
  for (const d of Array.isArray(payload.llmCallDiagnostics) ? payload.llmCallDiagnostics : []) {
    if (!d || typeof d.purpose !== 'string') continue;
    if (d.outcome === 'started') {
      calls.push({ id: `legacy-${calls.length}`, jobId: null, purpose: d.purpose, at: d.at ?? 0,
        site: null, provider: null, slot: null, model: null, input: null, output: null, duration: null, outcome: 'interrupted',
        code: null, reason: null, repairOf: null, attempt: d.attempt ?? null, attemptOutcome: null, attemptReason: null });
    } else if (['failed','succeeded'].includes(d.outcome)) {
      let call = [...calls].reverse().find(c => c.purpose===d.purpose && c.outcome==='interrupted' && c.attempt===d.attempt);
      if (!call) { call = { id:`legacy-${calls.length}`,jobId:null,purpose:d.purpose,at:d.at ?? 0,site:null,provider:null,slot:null,model:null,input:null,output:null,duration:null,outcome:'unknown',code:null,reason:null,repairOf:null,attempt:d.attempt ?? null,attemptOutcome:null,attemptReason:null }; calls.push(call); }
      else if (typeof d.at === 'number') call.duration = Math.max(0,d.at-call.at);
      const tokens = processingTokens(d.usage);
      Object.assign(call,{outcome:d.outcome,input:tokens.input,output:tokens.output});
      if (d.code) Object.assign(call,processingFailure({code:d.code}));
    }
  }
  return calls;
}

export function readProcessingCalls(db:RcmDatabase,jobId:string,offset=0):{items:ProcessingCall[];nextOffset:number|null} {
 const rows=db.prepare(`SELECT pc.*,pa.ordinal,pa.outcome attempt_outcome,pa.reason attempt_reason,COALESCE(j.status,pj.status) job_status,
  (SELECT COUNT(DISTINCT other.attempt_id) FROM processing_calls other WHERE other.job_id=pc.job_id AND other.purpose=pc.purpose) attempt_count
  FROM processing_calls pc LEFT JOIN processing_attempts pa ON pa.id=pc.attempt_id LEFT JOIN jobs j ON j.id=pc.job_id LEFT JOIN processing_jobs pj ON pj.id=pc.job_id
  WHERE pc.job_id=? ORDER BY pc.started_at,pc.rowid LIMIT ? OFFSET ?`).all(jobId,PROCESSING_CALL_PAGE_SIZE+1,offset) as Row[];
 return {items:rows.slice(0,PROCESSING_CALL_PAGE_SIZE).map(projectCall),nextOffset:rows.length>PROCESSING_CALL_PAGE_SIZE?offset+PROCESSING_CALL_PAGE_SIZE:null};
}

function projectJob(db: RcmDatabase, job: Row): ProcessingJob {
  const payload = {...JSON.parse(job.payload_json),...jobListMetadata(db,job.chat_id,job)}, result = readProcessingCalls(db,job.id);
  const calls = result.items.length ? result.items : legacyCalls(payload);
  let totals = total(db.prepare(`SELECT ${aggregate} FROM processing_calls WHERE job_id=?`).get(job.id) as Row);
  if (!result.items.length) {
    const count = payload.llmCallStats?.total;
    totals = { calls: typeof count==='number' ? count : calls.length || null,
      input: payload.llmUsage?.inputTokens ?? null,output:payload.llmUsage?.outputTokens ?? null,duration:null,missingTokens:typeof count==='number'?count:0 };
  }
  else if(Number(payload.llmCallStats?.total)>Number(totals.calls)) totals={...totals,calls:payload.llmCallStats.total,missingTokens:(totals.missingTokens??0)+payload.llmCallStats.total-Number(totals.calls)};
  if(!result.nextOffset) for(const attempt of db.prepare(`SELECT pa.* FROM processing_attempts pa WHERE job_id=?
    AND NOT EXISTS(SELECT 1 FROM processing_calls pc WHERE pc.attempt_id=pa.id) ORDER BY started_at,rowid LIMIT 40`).all(job.id) as Row[]) {
    calls.push({id:attempt.id,jobId:job.id,purpose:'job_attempt',at:attempt.started_at,site:null,provider:null,slot:null,model:null,
      input:null,output:null,duration:attempt.ended_at===null?null:attempt.ended_at-attempt.started_at,
      outcome:attempt.outcome,code:attempt.failure_code,reason:attempt.reason,repairOf:null,
      attempt:attempt.ordinal,attemptOutcome:attempt.outcome,attemptReason:attempt.reason,attemptOnly:true});
  }
  for(const call of calls)call.attemptCount=Math.max(call.attemptCount??0,new Set(calls.filter(c=>c.purpose===call.purpose).map(c=>c.attempt).filter(a=>a!==null)).size);
  // A projection recorded on this extraction job has explicit provenance.
  if(batchKinds.has(job.type))for(const call of calls)if(call.purpose.startsWith('relationship_projection'))call.after=true;
  calls.sort((a,b)=>a.at-b.at);
  const range = db.prepare(`SELECT MIN(ordinal) lo,MAX(ordinal) hi,SUM(role='assistant') turns FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))`).get(job.chat_id,JSON.stringify(payload.sourceMessageIds ?? [])) as Row;
  const batch = db.prepare('SELECT start_ordinal,end_ordinal FROM extraction_batches WHERE job_id=?').get(job.id) as Row | undefined;
  const notes: string[] = [];
  if (job.type === 'canonical_translation') {
    notes.push(String(payload.cursor ?? 0) + '/' + String(payload.chunks?.length ?? 0) + '묶음 · ' + String(payload.applied ?? 0) + '문장 반영');
    if (payload.diagnostics?.length) notes.push(String(payload.diagnostics.length) + '개는 누락되거나 바뀌어 그대로 두었어요.');
  }
  if (job.status==='failed') notes.push(settingsFailureMessage(job.last_error ?? payload.providerFailure));
  if (payload.sourceCoverage?.needsReview) notes.push(`원문 ${payload.sourceCoverage.needsReview}개 확인 필요`);
  else if (payload.sourceCoverage?.retried) notes.push(`원문 ${payload.sourceCoverage.total}개 중 ${payload.sourceCoverage.retried}개 다시 정리 요청`);
  if (payload.smallReviewCount) notes.push('후보 보류 · 추가 호출 없음');
  if (payload.candidateStatus) notes.push(payload.candidateStatus==='applied' ? '추가 결과 반영 완료' : payload.candidateStatus==='stale' ? '후보 만료' : '기억 후보 준비 · 적용 대기');
  if (payload.withheldRecognitions?.length) notes.push(`기억 ${payload.memoriesSaved ?? 0}개 저장 · 인물 인지 ${payload.withheldRecognitions.length}건 보류`);
  const technical = projectJobListPayload(payload,job.type);
  // Detailed failure/withheld records remain available on demand, not duplicated in the call table.
  if (payload.withheldRecognitions) technical.withheldRecognitions=payload.withheldRecognitions;
  if (payload.withheldReviewable) technical.withheldReviewable=true;
  return { id:job.id,type:job.type,status:job.status,at:job.updated_at,
    start:batch?.start_ordinal ?? range.lo ?? payload.startOrdinal ?? null,end:batch?.end_ordinal ?? range.hi ?? payload.endOrdinal ?? null,
    turns:typeof payload.sourceTurnCount==='number' ? payload.sourceTurnCount : range.turns || null,
    batch:payload.operationStageOrdinal ?? null,calls,totals,moreCalls:result.nextOffset!==null,
    attempts:Math.max(Number((db.prepare('SELECT COUNT(*) n FROM processing_attempts WHERE job_id=?').get(job.id) as Row).n),job.attempts),
    notes,technical };
}


interface Group {chat_id:string;unit_id:string;at:number;members:string;}
const memberJson=`json_group_array(json_object('id',id,'type',type,'status',status,'created_at',created_at,'updated_at',updated_at,'attempts',attempts,
 'run_id',run_id,'regeneration',regeneration,'start',start,'end',end,'batch',batch,'turns',turns,'source_recovery',source_recovery,'expected',expected,
 'usage_input',usage_input,'usage_output',usage_output,'snapshot_id',snapshot_id)) members`;
function loadUnits(db:RcmDatabase,groups:Group[],details:boolean,offset=-1):ProcessingUnit[] {
 if(!groups.length)return [];
 const members=groups.map(g=>JSON.parse(g.members) as Row[]),ids=members.flat().map(j=>j.id),idsJson=JSON.stringify(ids);
 // One bounded page of units chooses its ids once; every call aggregate below
 // uses those ids, never repeats the whole history CTE for each card.
 const stats=db.prepare(`SELECT job_id,purpose,site,provider,slot,model,${aggregate},COUNT(duration_ms) timed
  FROM processing_calls WHERE job_id IN (SELECT value FROM json_each(?)) GROUP BY job_id,purpose,site,provider,slot,model`).all(idsJson) as Row[];
 const byJob=new Map<string,Row[]>();for(const row of stats)byJob.set(row.job_id,[...(byJob.get(row.job_id)??[]),row]);
 const attemptCounts=new Map((db.prepare(`SELECT job_id,COUNT(*) n FROM processing_attempts WHERE job_id IN (SELECT value FROM json_each(?)) GROUP BY job_id`).all(idsJson) as Row[]).map(r=>[r.job_id,r.n]));
 const owners=new Map((db.prepare('SELECT id,chat_title FROM chats WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(groups.map(g=>g.chat_id))) as Row[]).map(r=>[r.id,r.chat_title]));
 const readJobs=(selected:Row[],chatId:string)=>selected.map(meta=>{
   const row=db.prepare('SELECT id,chat_id,type,status,payload_json,attempts,created_at,updated_at,last_error FROM jobs WHERE id=? UNION ALL SELECT id,chat_id,type,status,payload_json,attempts,created_at,updated_at,NULL FROM processing_jobs p WHERE id=? AND NOT EXISTS(SELECT 1 FROM jobs WHERE id=p.id)').get(meta.id,meta.id) as Row;
   return projectJob(db,{...row,chat_id:chatId});
 });
 return groups.map((group,index)=>{
  const all=members[index]!,isRun=group.unit_id.startsWith('run:'),runId=isRun?group.unit_id.slice(4):null;
  const batches=all.filter(j=>batchKinds.has(j.type)&&j.status!=='superseded').sort((a,b)=>(a.start??Infinity)-(b.start??Infinity)||(a.batch??Infinity)-(b.batch??Infinity)||a.created_at-b.created_at);
  const root=all.find(j=>`job:${j.id}`===group.unit_id)??batches[0]??all[0]!;
  const rows=all.flatMap(j=>byJob.get(j.id)??[]),knownTotals=all.map(j=>{
    const observed=sumProcessingTotals((byJob.get(j.id)??[]).map(total));
    const count=Math.max(j.expected??0,observed.calls??0);
    return {calls:count||(['queued','leased'].includes(j.status)||j.snapshot_id?0:j.expected??null),
      input:observed.input??j.usage_input??null,output:observed.output??j.usage_output??null,duration:observed.duration,
      missingTokens:(observed.missingTokens??0)+Math.max(0,count-(observed.calls??0))};
  });
  const totals=sumProcessingTotals(knownTotals),stagesByPurpose=new Map<string,Row[]>();
  for(const row of rows){const purpose=row.purpose.endsWith('_repair')?'repair':row.purpose;stagesByPurpose.set(purpose,[...(stagesByPurpose.get(purpose)??[]),row]);}
  const stages=[...stagesByPurpose].map(([purpose,rs])=>{const totals=sumProcessingTotals(rs.map(total)),timed=rs.reduce((n,r)=>n+r.timed,0);return {...totals,purpose,average:timed?(totals.duration??0)/timed:null};}).sort((a,b)=>processingStageOrder(a.purpose)-processingStageOrder(b.purpose)).slice(0,60) as ProcessingStage[];
  const modelMap=new Map(rows.map(row=>{const m=model(row);return [JSON.stringify(m),m];}));
  const models=[...modelMap.values()].slice(0,16);if(!models.length)models.push({site:null,provider:null,slot:null,model:null});
  const repaired=batches.filter(j=>(byJob.get(j.id)??[]).some(r=>r.purpose.endsWith('_repair'))),rerun=batches.filter(j=>Math.max(j.attempts,attemptCounts.get(j.id)??0)>1);
  const selected=isRun?(offset<0?[]:batches.slice(offset,offset+PROCESSING_JOB_PAGE_SIZE)):all;
  const jobs=details?readJobs(selected,group.chat_id):[];
  if(!isRun)for(const job of jobs)if(job.id!==root.id)for(const call of job.calls)call.after=true;
  const regeneration=runId?db.prepare('SELECT status FROM regeneration_runs WHERE id=?').get(runId) as Row|undefined:undefined;
  const completed=batches.filter(j=>['done','completed'].includes(j.status)).length;
  const status=regeneration?(['discarded','stale'].includes(regeneration.status)?'interrupted':regeneration.status==='ready'?'ready':regeneration.status==='applied'?'completed':regeneration.status==='failed'?'failed':'running'):
    all.some(j=>j.status==='failed')?'failed':all.some(j=>['queued','leased'].includes(j.status))?'running':all.some(j=>j.status==='cancelled')||completed<batches.length?'interrupted':'completed';
  const ranged=isRun?batches:[root],starts=ranged.flatMap(j=>j.start===null?[]:[j.start]),ends=ranged.flatMap(j=>j.end===null?[]:[j.end]),sizes=batches.flatMap(j=>j.start!==null&&j.end!==null?[j.end-j.start+1]:[]);
  return {id:runId??root.id,chatId:group.chat_id,chatTitle:owners.get(group.chat_id)||'이름 없는 채팅',kind:isRun?'run':'job',
    title:isRun?(all.some(j=>j.regeneration)?'기억 다시 만들기':'과거 대화 정리'):title(root.type,{sourceRecovery:root.source_recovery}),at:group.at,
    start:starts.length?Math.min(...starts):null,end:ends.length?Math.max(...ends):null,batchSize:sizes.length?Math.max(...sizes):null,
    totalBatches:batches.length,completedBatches:completed,status,models:details||isRun?models:[],totals,stages:details||isRun?stages:[],jobs,
    repaired:details&&isRun?readJobs(repaired.slice(0,4),group.chat_id):[],rerun:details&&isRun?readJobs(rerun.slice(0,4),group.chat_id):[],
    jobCount:isRun?batches.length:all.length,repairJobCount:repaired.length,rerunJobCount:rerun.length,jobOffset:offset,
    incomplete:knownTotals.some((t,i)=>(t.calls??0)>Number(sumProcessingTotals((byJob.get(all[i]!.id)??[]).map(total)).calls??0)),detailsLoaded:details};
 });
}
export function readProcessingUnit(db:RcmDatabase,chatId:string,key:string,offset=-1):ProcessingUnit|null {
 const group=db.prepare(`${unitCte(true)} SELECT chat_id,unit_id,MAX(updated_at) at,${memberJson} FROM units WHERE unit_id=? GROUP BY chat_id,unit_id`).get({chatId},key) as Group|undefined;
 return group?loadUnits(db,[group],true,offset)[0]!:null;
}
export function processingDayBounds(timezoneMinutes:number,at=Date.now()):{since:number;day:string}{
 const day=new Date(at+timezoneMinutes*60_000).toISOString().slice(0,10);return {day,since:Date.parse(`${day}T00:00:00Z`)-timezoneMinutes*60_000};
}
export function readProcessingToday(db:RcmDatabase,chatId:string|undefined,timezoneMinutes:number):ProcessingHistory['today'] {
 const {since}=processingDayBounds(timezoneMinutes);
 const row=db.prepare(`SELECT ${aggregate},COUNT(DISTINCT chat_id) chats FROM processing_calls WHERE started_at>=? AND started_at<? AND chat_id IN (SELECT id FROM chats WHERE is_internal=0${chatId?' AND id=?':''})`).get(since,since+86_400_000,...(chatId?[chatId]:[])) as Row;
 return {...total(row),...(row.calls===0?{input:0,output:0,duration:0}:{}),chats:row.chats,since};
}
export function readTranslationCalls(db:RcmDatabase,chatId:string|undefined,day:string,timezoneMinutes:number,offset=0):{items:ProcessingCall[];nextOffset:number|null}{
 const since=Date.parse(`${day}T00:00:00Z`)-timezoneMinutes*60_000;
 const rows=db.prepare(`SELECT * FROM processing_calls WHERE purpose='translation' AND started_at>=? AND started_at<? AND chat_id IN (SELECT id FROM chats WHERE is_internal=0${chatId?' AND id=?':''}) ORDER BY started_at DESC,rowid DESC LIMIT ? OFFSET ?`)
 .all(since,since+86_400_000,...(chatId?[chatId]:[]),PROCESSING_CALL_PAGE_SIZE+1,offset) as Row[];
 return {items:rows.slice(0,PROCESSING_CALL_PAGE_SIZE).map(projectCall),nextOffset:rows.length>PROCESSING_CALL_PAGE_SIZE?offset+PROCESSING_CALL_PAGE_SIZE:null};
}
export function readProcessingHistory(db:RcmDatabase,options:{chatId?:string;offset?:number;translationOffset?:number;timezoneMinutes?:number}={}):ProcessingHistory{
 const {chatId,offset=0,translationOffset=0,timezoneMinutes=0}=options;
 pruneProcessingHistoryPeriodically(db);
 const groups=db.prepare(`${unitCte(Boolean(chatId))} SELECT chat_id,unit_id,MAX(updated_at) at,${memberJson} FROM units GROUP BY chat_id,unit_id ORDER BY at DESC,chat_id,unit_id LIMIT ? OFFSET ?`).all(...(chatId?[{chatId}]:[]),PROCESSING_PAGE_SIZE+1,offset) as Group[];
 const items=loadUnits(db,groups.slice(0,PROCESSING_PAGE_SIZE),Boolean(chatId));
 const dayExpr=`strftime('%Y-%m-%d',started_at/1000+${timezoneMinutes*60},'unixepoch')`;
 const days=db.prepare(`SELECT ${dayExpr} day,SUM(completed_items) items,${aggregate},AVG(duration_ms) average FROM processing_calls WHERE purpose='translation' AND chat_id IN (SELECT id FROM chats WHERE is_internal=0${chatId?' AND id=?':''}) GROUP BY day ORDER BY day DESC LIMIT 8 OFFSET ?`).all(...(chatId?[chatId]:[]),translationOffset) as Row[];
 return {scope:chatId?'chat':'all',items,nextOffset:groups.length>PROCESSING_PAGE_SIZE?offset+PROCESSING_PAGE_SIZE:null,today:readProcessingToday(db,chatId,timezoneMinutes),
 translations:days.slice(0,7).map(row=>{const since=Date.parse(`${row.day}T00:00:00Z`)-timezoneMinutes*60_000;return {day:row.day,items:row.items??null,totals:total(row),average:row.average??null,models:modelRows(db,`purpose='translation' AND started_at>=? AND started_at<? AND chat_id IN (SELECT id FROM chats WHERE is_internal=0${chatId?' AND id=?':''})`,[since,since+86_400_000,...(chatId?[chatId]:[])])};}),nextTranslationOffset:days.length>7?translationOffset+7:null};
}
