import { randomUUID } from "node:crypto";
import type { RcmDatabase } from "./db.js";
import { providerFailureMetadata, settingsFailureCode, projectRisuAuxiliaryCallDiagnostic, processingRunId } from "@rcm/shared";

export const PROCESSING_RETENTION_DAYS = 30;
export const PROCESSING_CALLS_PER_CHAT = 10_000;
export const processingSchema = `
CREATE TABLE IF NOT EXISTS processing_jobs (
  id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL,
  payload_json TEXT NOT NULL,attempts INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS processing_job_chat ON processing_jobs(chat_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS processing_attempts (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, chat_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
  lease_attempt INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
  outcome TEXT NOT NULL DEFAULT 'running', failure_code TEXT, reason TEXT,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS processing_attempt_job ON processing_attempts(job_id,started_at);
CREATE TABLE IF NOT EXISTS processing_calls (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, job_id TEXT, attempt_id TEXT,
  purpose TEXT NOT NULL, site TEXT, provider TEXT, slot TEXT, model TEXT,
  batch_id TEXT, run_id TEXT, start_ordinal INTEGER, end_ordinal INTEGER,
  repair_of TEXT, started_at INTEGER NOT NULL, ended_at INTEGER, duration_ms INTEGER,
  input_tokens INTEGER, output_tokens INTEGER, item_count INTEGER, completed_items INTEGER, repair_reason TEXT,
  outcome TEXT NOT NULL, failure_code TEXT, reason TEXT,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY(attempt_id) REFERENCES processing_attempts(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS processing_call_chat ON processing_calls(chat_id,started_at DESC);
CREATE INDEX IF NOT EXISTS processing_call_job ON processing_calls(job_id,started_at);
CREATE INDEX IF NOT EXISTS processing_call_run ON processing_calls(run_id,started_at);
CREATE TRIGGER IF NOT EXISTS processing_job_finished AFTER UPDATE OF status ON jobs
WHEN NEW.status IN ('done','completed','cancelled','superseded') AND OLD.status<>NEW.status
BEGIN
  UPDATE processing_attempts SET ended_at=NEW.updated_at,
    outcome=CASE WHEN NEW.status IN ('done','completed') THEN 'succeeded' ELSE 'interrupted' END
    WHERE job_id=NEW.id AND outcome='running';
END;
CREATE TRIGGER IF NOT EXISTS processing_job_status AFTER UPDATE ON jobs
BEGIN
  UPDATE processing_jobs SET status=NEW.status,attempts=NEW.attempts,updated_at=NEW.updated_at,
    payload_json=json_set(payload_json,'$.llmCallStats',json_extract(NEW.payload_json,'$.llmCallStats')) WHERE id=NEW.id;
  UPDATE processing_attempts SET ended_at=NEW.updated_at,outcome='failed',
    failure_code=CASE WHEN NEW.last_error='Lease expired after maximum attempts' THEN 'LEASE_EXPIRED' ELSE 'JOB_FAILED' END,
    reason=CASE WHEN NEW.last_error='Lease expired after maximum attempts' THEN '작업 제어권 만료' ELSE '작업 실패' END
    WHERE job_id=NEW.id AND outcome='running' AND NEW.status='failed';
  UPDATE processing_calls SET ended_at=NEW.updated_at,duration_ms=MAX(0,NEW.updated_at-started_at),outcome='interrupted',failure_code='JOB_FAILED',reason='작업 중단'
    WHERE job_id=NEW.id AND outcome='running' AND NEW.status IN ('failed','cancelled','superseded');
END;
CREATE TRIGGER IF NOT EXISTS processing_job_continued AFTER UPDATE OF status ON jobs
WHEN OLD.status='leased' AND NEW.status='queued' AND NEW.last_error IS NULL
BEGIN
  UPDATE processing_attempts SET ended_at=NEW.updated_at,outcome='succeeded'
    WHERE job_id=NEW.id AND outcome='running' AND NOT EXISTS(SELECT 1 FROM processing_calls pc WHERE pc.attempt_id=processing_attempts.id AND pc.outcome='running');
END;
CREATE TRIGGER IF NOT EXISTS processing_job_deleted BEFORE DELETE ON jobs
BEGIN
  UPDATE processing_jobs SET status=CASE WHEN OLD.status IN ('queued','leased') THEN 'cancelled' ELSE OLD.status END WHERE id=OLD.id;
END;
`;

// Product error codes only. Never retain provider output or a job's source text.
export function processingFailure(error: unknown): { code: string; reason: string } {
  const metadata = providerFailureMetadata(error);
  const candidate = metadata.code ?? settingsFailureCode(error);
  const code = typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(candidate) ? candidate
    : metadata.status ? `HTTP_${metadata.status}` : error instanceof SyntaxError || (error as any)?.name === 'ZodError' ? 'VALIDATION_FAILED' : 'CALL_FAILED';
  const reason = /TIMEOUT/.test(code) ? '시간 초과' : code === 'LEASE_EXPIRED' ? '작업 제어권 만료' : code==='WORKER_RELEASED' ? '작업 중단 · lease 반환'
    : /VALID|JSON|REPAIR|TRUNCATED/.test(code) ? '응답 검증 실패'
    : /AUTH|HTTP_40[13]/.test(code) ? '인증 실패' : /429|RATE_LIMIT/.test(code) ? '요청 한도 초과'
    : /^HTTP_/.test(code) ? `공급자 오류 ${metadata.status ?? code.slice(5)}` : '호출 실패';
  return { code, reason };
}

export function processingTokens(usage: any): { input: number | null; output: number | null } {
  const token = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return { input: token(usage?.promptTokens ?? usage?.inputTokens ?? usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokenCount),
    output: token(usage?.completionTokens ?? usage?.outputTokens ?? usage?.completion_tokens ?? usage?.output_tokens ?? usage?.candidatesTokenCount) };
}

export function pruneProcessingRecords(db: RcmDatabase, chatId: string, at = Date.now(), reserve=0): void {
  db.prepare('DELETE FROM processing_calls WHERE chat_id=? AND (started_at<? OR id IN (SELECT id FROM processing_calls WHERE chat_id=? ORDER BY started_at DESC,rowid DESC LIMIT -1 OFFSET ?))')
    .run(chatId, at - PROCESSING_RETENTION_DAYS * 86_400_000, chatId, PROCESSING_CALLS_PER_CHAT-reserve);
  db.prepare('DELETE FROM processing_attempts WHERE chat_id=? AND started_at<? AND id NOT IN (SELECT attempt_id FROM processing_calls WHERE attempt_id IS NOT NULL)').run(chatId, at - PROCESSING_RETENTION_DAYS * 86_400_000);
  db.prepare(`DELETE FROM processing_jobs WHERE chat_id=? AND (updated_at<? OR id IN (SELECT id FROM processing_jobs WHERE chat_id=? ORDER BY updated_at DESC,rowid DESC LIMIT -1 OFFSET 2000))
    AND id NOT IN (SELECT job_id FROM processing_calls WHERE job_id IS NOT NULL)`).run(chatId,at-PROCESSING_RETENTION_DAYS*86_400_000,chatId);
}

const retention = new WeakMap<RcmDatabase,Map<string,{writes:number;next:number}>>();
export function maybePruneProcessingRecords(db:RcmDatabase,chatId:string,at=Date.now()):void {
  let chats=retention.get(db);if(!chats)retention.set(db,chats=new Map());
  let state=chats.get(chatId);
  if(!state){state={writes:0,next:at+900_000};chats.set(chatId,state);
    const count=Number(db.prepare('SELECT COUNT(*) FROM processing_calls WHERE chat_id=?').pluck().get(chatId));
    if(count>PROCESSING_CALLS_PER_CHAT-128)state.next=0;
  }
  if(++state.writes>=128 || at>=state.next){pruneProcessingRecords(db,chatId,at,128);state.writes=0;state.next=at+900_000;}
}
const historyPrune=new WeakMap<RcmDatabase,number>();
export function resetProcessingRetention(db:RcmDatabase):void {retention.delete(db);historyPrune.delete(db);}
export function pruneProcessingHistoryPeriodically(db:RcmDatabase,at=Date.now()):void {
  if((historyPrune.get(db)??0)>at)return;
  historyPrune.set(db,at+900_000);
  db.prepare('DELETE FROM processing_calls WHERE started_at<?').run(at-PROCESSING_RETENTION_DAYS*86_400_000);
  db.prepare('DELETE FROM processing_attempts WHERE started_at<? AND id NOT IN (SELECT attempt_id FROM processing_calls WHERE attempt_id IS NOT NULL)').run(at-PROCESSING_RETENTION_DAYS*86_400_000);
  db.prepare('DELETE FROM processing_jobs WHERE updated_at<? AND id NOT IN (SELECT job_id FROM processing_calls WHERE job_id IS NOT NULL)').run(at-PROCESSING_RETENTION_DAYS*86_400_000);
}

export function processingJobScope(db:RcmDatabase,job:{chat_id:string;payload_json:string}):{chatId:string;runId:string|null} {
  const runId=processingRunId(JSON.parse(job.payload_json));
  const run=runId?db.prepare('SELECT chat_id FROM regeneration_runs WHERE id=? AND (chat_id=? OR shadow_chat_id=?)').get(runId,job.chat_id,job.chat_id) as any:undefined;
  return {chatId:run?.chat_id??job.chat_id,runId};
}

function snapshotProcessingJob(db:RcmDatabase,jobId:string):string|null {
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId) as any;
  if(!job)return null;
  const p=JSON.parse(job.payload_json),{chatId}=processingJobScope(db,job);
  const range=db.prepare('SELECT MIN(ordinal) lo,MAX(ordinal) hi,SUM(role=\'assistant\') turns FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))').get(job.chat_id,JSON.stringify(p.sourceMessageIds ?? [])) as any;
  const batch=db.prepare('SELECT id,start_ordinal,end_ordinal FROM extraction_batches WHERE job_id=?').get(jobId) as any;
  const payload=Object.fromEntries(['batchId','backfillRunId','canonicalRegenerationRunId','regenerationRunId','upgradeRunId','upgradePhase2RunId','operationStage','operationStageOrdinal','operationStageTotal','sourceRecovery','candidateStatus','llmCallStats'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]));
  Object.assign(payload,{batchId:batch?.id??p.batchId??null,startOrdinal:batch?.start_ordinal??range.lo ?? p.startOrdinal ?? null,endOrdinal:batch?.end_ordinal??range.hi ?? p.endOrdinal ?? null,sourceTurnCount:range.turns ?? p.sourceTurnCount ?? null});
  db.prepare(`INSERT INTO processing_jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id,payload_json=excluded.payload_json,status=excluded.status,attempts=excluded.attempts,updated_at=excluded.updated_at`)
    .run(job.id,chatId,job.type,job.status,JSON.stringify(payload),job.attempts,job.created_at,Math.max(job.updated_at,Date.now()));
  return chatId;
}

export function beginProcessingAttempt(db: RcmDatabase, jobId: string, leaseAttempt: number, at = Date.now(), newLease=false): void {
  const chatId=snapshotProcessingJob(db,jobId);
  if (!chatId) return;
  const last = db.prepare('SELECT * FROM processing_attempts WHERE job_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(jobId) as any;
  // Reuse is only for an unstarted lease, or another call in the same lease.
  if (last?.outcome === 'running' && last.lease_attempt === leaseAttempt && (!newLease || !db.prepare('SELECT 1 FROM processing_calls WHERE attempt_id=? LIMIT 1').get(last.id))) return;
  if (last?.outcome === 'running') endProcessingAttempt(db, jobId, 'failed', { code: 'LEASE_EXPIRED' }, at);
  db.prepare('INSERT INTO processing_attempts(id,job_id,chat_id,ordinal,lease_attempt,started_at) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), jobId, chatId, (last?.ordinal ?? 0) + 1, leaseAttempt, at);
}

export function endProcessingAttempt(db: RcmDatabase, jobId: string, outcome: string, error?: unknown, at = Date.now()): void {
  const failure = error ? processingFailure(error) : undefined;
  db.prepare("UPDATE processing_attempts SET ended_at=?,outcome=?,failure_code=?,reason=? WHERE job_id=? AND outcome='running'")
    .run(at, outcome, failure?.code ?? null, failure?.reason ?? null, jobId);
  if (outcome !== 'succeeded') db.prepare("UPDATE processing_calls SET ended_at=?,duration_ms=MAX(0,?-started_at),outcome='interrupted',failure_code=?,reason=? WHERE job_id=? AND outcome='running'")
    .run(at, at, failure?.code ?? null, failure?.reason ?? null, jobId);
}

export interface CallIdentity { site: 'server' | 'risu'; provider?: string; slot?: string; model?: string; }
const label = (value: unknown): string | null => typeof value === 'string' && value.length <= 200 && !/[\r\n]/.test(value) ? value : null;

export function recordProcessingCall(db: RcmDatabase, jobId: string, event: { purpose: string; outcome: string; at: number; usage?: unknown; code?: string; error?: unknown; risuCall?: any; repairReason?:string }, identity?: CallIdentity): void {
  const job = db.prepare('SELECT chat_id,payload_json,attempts FROM jobs WHERE id=?').get(jobId) as any;
  if (!job) return;
  const payload = JSON.parse(job.payload_json);
  const at = event.at;
  if (event.outcome === 'started') {
    beginProcessingAttempt(db, jobId, job.attempts, at);
    const owner=db.prepare('SELECT chat_id FROM processing_jobs WHERE id=?').get(jobId) as any;
    const attempt = db.prepare('SELECT id FROM processing_attempts WHERE job_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(jobId) as any;
    const range = db.prepare(`SELECT MIN(ordinal) lo,MAX(ordinal) hi FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))`).get(job.chat_id, JSON.stringify(payload.sourceMessageIds ?? [])) as any;
    const batch=db.prepare('SELECT id,start_ordinal,end_ordinal FROM extraction_batches WHERE job_id=?').get(jobId) as any;
    const repaired = event.purpose.endsWith('_repair') ? db.prepare('SELECT id FROM processing_calls WHERE job_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(jobId) as any : undefined;
    db.prepare(`INSERT INTO processing_calls(id,chat_id,job_id,attempt_id,purpose,site,provider,slot,model,batch_id,run_id,start_ordinal,end_ordinal,repair_of,started_at,outcome)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'running')`).run(randomUUID(), owner.chat_id, jobId, attempt?.id ?? null, event.purpose, identity?.site ?? 'risu', label(identity?.provider), label(identity?.slot ?? (event.risuCall?.staticModel?'static':event.risuCall?.mode)), label(identity?.model ?? event.risuCall?.model ?? event.risuCall?.staticModel),
      batch?.id??payload.batchId ?? null, processingRunId(payload),
      batch?.start_ordinal??range.lo ?? payload.startOrdinal ?? null, batch?.end_ordinal??range.hi ?? payload.endOrdinal ?? null, repaired?.id ?? null, at);
    db.prepare('UPDATE processing_calls SET repair_reason=? WHERE job_id=? AND started_at=? AND outcome=\'running\'').run(event.repairReason ?? null,jobId,at);
    maybePruneProcessingRecords(db, owner.chat_id);
    return;
  }
  const call = db.prepare("SELECT id FROM processing_calls WHERE job_id=? AND purpose=? AND outcome='running' ORDER BY started_at DESC,rowid DESC LIMIT 1").get(jobId, event.purpose) as any;
  if (!call) return; // Old or already settled call: do not invent usage or double count.
  const tokens = processingTokens(event.usage);
  const failure = event.outcome === 'failed' ? processingFailure(event.code ? { code: event.code } : event.error) : undefined;
  db.prepare(`UPDATE processing_calls SET ended_at=?,duration_ms=MAX(0,?-started_at),input_tokens=?,output_tokens=?,outcome=?,failure_code=?,reason=?,
    provider=COALESCE(?,provider),slot=COALESCE(?,slot),model=COALESCE(?,model) WHERE id=?`).run(at, at, tokens.input, tokens.output, event.outcome, failure?.code ?? null, failure?.reason ?? null,
    label(identity?.provider ?? event.risuCall?.provider), label(identity?.slot ?? (event.risuCall?.staticModel?'static':event.risuCall?.mode)), label(identity?.model ?? event.risuCall?.model ?? event.risuCall?.staticModel), call.id);
}

export function recordTranslationCall(db: RcmDatabase, record: CallIdentity & { id?: string; purpose?:string; chatId: string; startedAt: number; durationMs: number; usage?: unknown; itemCount: number; completedItems?:number; outcome: 'succeeded' | 'failed'; failure?: unknown }): void {
  const tokens = processingTokens(record.usage), failure = record.outcome === 'failed' ? processingFailure(record.failure) : undefined;
  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO processing_calls(id,chat_id,purpose,site,provider,slot,model,started_at,ended_at,duration_ms,input_tokens,output_tokens,item_count,completed_items,outcome,failure_code,reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.id ?? randomUUID(), record.chatId, record.purpose??'translation',record.site, label(record.provider), label(record.slot), label(record.model), record.startedAt, record.startedAt + record.durationMs, record.durationMs, tokens.input, tokens.output, record.itemCount,record.completedItems??null, record.outcome, failure?.code ?? null, failure?.reason ?? null);
    maybePruneProcessingRecords(db, record.chatId);
  })();
}

/** Import only observed legacy events. No execution identity or retry cause is inferred. */
export function migrateLegacyProcessingRecords(db:RcmDatabase,chatId?:string):void {
  const sources=chatId?[{chat_id:chatId}]:db.prepare("SELECT DISTINCT chat_id FROM jobs WHERE updated_at>=? AND json_type(payload_json,'$.llmCallDiagnostics')='array'").all(Date.now()-PROCESSING_RETENTION_DAYS*86_400_000) as {chat_id:string}[];
  const touched=new Set<string>();
  for(const source of sources) for(let offset=0;offset<2000;offset+=100){
    const jobs=db.prepare(`SELECT id,chat_id,status,attempts,payload_json,updated_at FROM jobs WHERE chat_id=? AND updated_at>=?
      AND json_type(payload_json,'$.llmCallDiagnostics')='array' ORDER BY updated_at DESC,id LIMIT 100 OFFSET ?`)
      .all(source.chat_id,Date.now()-PROCESSING_RETENTION_DAYS*86_400_000,offset) as any[];
    for(const job of jobs){
    if(db.prepare('SELECT 1 FROM processing_calls WHERE job_id=? LIMIT 1').get(job.id))continue;
    const p=JSON.parse(job.payload_json),owner=snapshotProcessingJob(db,job.id);
    if(!owner)continue;
    const observed:Array<{id:string;purpose:string;attempt:number|null;started:number|null;at:number;ended:number|null;outcome:string;input:number|null;output:number|null;code:string|null;reason:string|null;repair:string|null;identity?:CallIdentity}>=[];
    for(const d of p.llmCallDiagnostics){
      if(!d || typeof d.purpose!=='string' || !/^[a-z_]{1,80}$/.test(d.purpose) || typeof d.at!=='number' || !Number.isFinite(d.at))continue;
      if(!['started','succeeded','failed'].includes(d.outcome))continue;
      let call=d.outcome==='started'?undefined:[...observed].reverse().find(c=>c.purpose===d.purpose&&c.outcome==='running'&&c.attempt===(d.attempt??null));
      if(!call){call={id:`legacy:${job.id}:${observed.length}`,purpose:d.purpose,attempt:d.attempt??null,started:d.outcome==='started'?d.at:null,at:d.at,ended:null,outcome:'running',input:null,output:null,code:null,reason:null,repair:d.purpose.endsWith('_repair')?observed.at(-1)?.id??null:null};observed.push(call);}
      const risu=projectRisuAuxiliaryCallDiagnostic(d.risuCall);
      if(risu)call.identity={site:'risu',provider:risu.provider,slot:risu.staticModel?'static':risu.mode,model:risu.model ?? risu.staticModel};
      if(d.outcome!=='started'){
        const usage=processingTokens(d.usage),failure=d.code?processingFailure({code:d.code}):undefined;
        Object.assign(call,{ended:d.at,outcome:d.outcome,input:usage.input,output:usage.output,code:failure?.code??null,reason:failure?.reason??null});
      }
    }
    const snapshot=JSON.parse((db.prepare('SELECT payload_json FROM processing_jobs WHERE id=?').get(job.id) as any).payload_json);
    for(const attempt of [...new Set(observed.flatMap(c=>Number.isSafeInteger(c.attempt)&&Number(c.attempt)>0?[c.attempt!]:[]))]){
      const calls=observed.filter(c=>c.attempt===attempt),last=attempt===job.attempts;
      const outcome=last&&['done','completed'].includes(job.status)?'succeeded':last&&job.status==='failed'?'failed':'interrupted';
      db.prepare('INSERT OR IGNORE INTO processing_attempts(id,job_id,chat_id,ordinal,lease_attempt,started_at,ended_at,outcome) VALUES(?,?,?,?,?,?,?,?)')
        .run(`legacy-attempt:${job.id}:${attempt}`,job.id,owner,attempt,attempt,Math.min(...calls.map(c=>c.at)),calls.every(c=>c.ended!==null)?Math.max(...calls.map(c=>c.ended!)):null,outcome);
    }
    for(const c of observed)db.prepare(`INSERT OR IGNORE INTO processing_calls(id,chat_id,job_id,attempt_id,purpose,batch_id,run_id,start_ordinal,end_ordinal,repair_of,started_at,ended_at,duration_ms,input_tokens,output_tokens,outcome,failure_code,reason,site,provider,slot,model)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(c.id,owner,job.id,Number.isSafeInteger(c.attempt)&&Number(c.attempt)>0?`legacy-attempt:${job.id}:${c.attempt}`:null,c.purpose,p.batchId??null,processingRunId(p),
        snapshot.startOrdinal,snapshot.endOrdinal,c.repair,c.at,c.ended,c.started!==null&&c.ended!==null?Math.max(0,c.ended-c.started):null,c.input,c.output,c.outcome==='running'?'interrupted':c.outcome,c.code,c.reason,c.identity?.site??null,label(c.identity?.provider),label(c.identity?.slot),label(c.identity?.model));
    db.prepare('UPDATE processing_jobs SET updated_at=? WHERE id=?').run(job.updated_at,job.id);
    touched.add(owner);
    }
    if(jobs.length<100)break;
  }
  for(const owner of touched)pruneProcessingRecords(db,owner);
}

/** Repair pre-release DB68 ownership while the explicit source/run still exists. */
export function repairProcessingOwnership(db:RcmDatabase):void {
  let after='';
  for(;;){
   const page=db.prepare(`SELECT * FROM (
     SELECT j.id,j.chat_id,j.payload_json FROM jobs j JOIN processing_jobs p ON p.id=j.id
     UNION ALL SELECT p.id,p.chat_id,p.payload_json FROM processing_jobs p WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=p.id)
    ) WHERE id>? ORDER BY id LIMIT 100`).all(after) as any[];
   if(!page.length)break;
   for(const job of page){
    const scope=processingJobScope(db,job);
    db.prepare('UPDATE processing_jobs SET chat_id=? WHERE id=? AND chat_id<>?').run(scope.chatId,job.id,scope.chatId);
    db.prepare('UPDATE processing_attempts SET chat_id=? WHERE job_id=? AND chat_id<>?').run(scope.chatId,job.id,scope.chatId);
    db.prepare('UPDATE processing_calls SET chat_id=?,run_id=? WHERE job_id=? AND (chat_id<>? OR run_id IS NOT ?)').run(scope.chatId,scope.runId,job.id,scope.chatId,scope.runId);
   }
   after=page.at(-1).id;
  }
  db.exec(`UPDATE processing_calls SET outcome='interrupted' WHERE outcome='running' AND (
    job_id IN (SELECT id FROM jobs WHERE status<>'leased') OR job_id IN (SELECT id FROM processing_jobs WHERE status<>'leased') OR attempt_id IN (SELECT id FROM processing_attempts WHERE outcome<>'running'))`);
}
