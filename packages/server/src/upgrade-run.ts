import { recordUpgradeIncident } from './incidents.js';
import { enqueueFinalLedgerConsistency } from './ledger-consistency.js';
import { randomUUID } from 'node:crypto';
import { estimateTokens, PickerSetupProjectionSchema, CHAT_WORK_HELD_MESSAGE, type ResolvedSetupProjection } from '@rcm/shared';
import { now, type RcmDatabase } from './db.js';
import { DEFAULT_EXTRACTION_CONTRACTS, editProtectedMessageIds, manualRetryPayload } from './jobs.js';
import { legacyMemorySummary, isChatCurrent, markChatRebuilt } from './legacy-memory.js';
import { assertChatUnlocked } from './upgrade-lock.js';
import { abortChatWork, isChatWorkHeld } from './chat-work.js';
import { maybeEnqueueStorySpine } from './story-spine.js';
import { flushRelationshipProjectionQueue } from './relationship-projections.js';
import { estimateWholeChatCalls } from './cost-estimates.js';
import { enqueueRegenerationShadow, enqueueRegenerationSources, pinRegenerationJobs, discardRegeneration, applyCanonicalRegeneration } from './regeneration.js';
import { rangeMessages, type RangeMessage } from './source-ranges.js';
import { fingerprintMatches, sourceFingerprint, type SourceFingerprintItem } from './source-fingerprint.js';
import { sourceInventory, assertSourceSnapshotAccepted, isSourceSnapshotHeld } from './source-snapshot.js';
import { createChatBackup } from './backup.js';
import { responseTurns } from './turn-clock.js';

export type UpgradeRun = {
  id: string; chatId: string; shadowChatId: string; phase: 1 | 2;
  status: string; done: number; total: number; error?: string;
};
type FixedRange = {startOrdinal:number;endOrdinal:number;sourceMessageIds:string[];fingerprint:SourceFingerprintItem[]};
const failure = (code:string) => Object.assign(new Error(code),{code});
function assertUpgradeWorkEnabled(db:RcmDatabase,chatId:string): void {
  assertSourceSnapshotAccepted(db,chatId);
  if (isChatWorkHeld(db,chatId)) throw Object.assign(new Error(CHAT_WORK_HELD_MESSAGE),{code:'CHAT_WORK_OFF'});
}
const current = (row:RangeMessage) => ['active','all_before'].includes(row.visibility) && !row.memoryExcluded;

function upgradeMessages(raw:RangeMessage[],protectedIds:Set<string>): RangeMessage[] {
  // Establish canonical response boundaries before removing excluded inputs.
  const turns=responseTurns(raw.filter(row=>row.ordinal>=0 && ['active','all_before'].includes(row.visibility)
    && ['committed','client_pruned'].includes(row.lifecycle)));
  return turns.filter(turn=>!turn.at(-1)!.memoryExcluded && !turn.some(row=>protectedIds.has(row.id)))
    .flatMap(turn=>turn.filter(current));
}

function upgradeRange(db:RcmDatabase,chatId:string): {messages:RangeMessage[];range:FixedRange;turns:number;groupTurns:number} {
  const chat = db.prepare('SELECT edit_protection_turns,extraction_group_turns FROM chats WHERE id=?').get(chatId) as
    {edit_protection_turns:number;extraction_group_turns:number}|undefined;
  if (!chat) throw failure('SOURCE_MISSING');
  const raw = rangeMessages(db,chatId), protectedIds = editProtectedMessageIds(db,chatId,chat.edit_protection_turns);
  const messages = upgradeMessages(raw,protectedIds);
  const endOrdinal = messages.at(-1)?.ordinal;
  if (endOrdinal === undefined) throw failure('SOURCE_MISSING');
  if (messages.some(row => row.content === null)) throw failure('SOURCE_MISSING');
  // Missing archived source cannot be inferred from ordinal gaps: host ordinals
  // may legitimately be sparse. Applied batch membership is proof.
  const knownIds = new Set(raw.map(row => row.id));
  const batches = db.prepare(`SELECT b.source_message_ids_json FROM extraction_batches b WHERE b.chat_id=?
    AND b.generation_id='active' AND b.status='applied' AND b.start_ordinal<=?`)
    .all(chatId,endOrdinal) as Array<{source_message_ids_json:string}>;
  for (const batch of batches) for (const id of JSON.parse(batch.source_message_ids_json) as string[]) {
    if (!knownIds.has(id)) throw failure('SOURCE_MISSING');
  }
  const sourceMessageIds = messages.map(row => row.id);
  return {messages,turns:messages.filter(row => row.role === 'assistant').length,groupTurns:chat.extraction_group_turns,
    range:{startOrdinal:0,endOrdinal,sourceMessageIds,fingerprint:sourceFingerprint(db,chatId,sourceMessageIds)}};
}

export function previewUpgrade(db:RcmDatabase,chatId:string): {
  turns:number;memories:number;legacyMemories:number;estimatedCalls:number;blockedReason?:'SOURCE_MISSING'|'BUSY'|'ALREADY_CURRENT';
} {
  const summary = legacyMemorySummary(db,chatId);
  const result = {turns:0,memories:summary.totalMemories,legacyMemories:summary.legacyMemories,estimatedCalls:0};
  if (db.prepare("SELECT 1 FROM regeneration_runs WHERE chat_id=? AND status NOT IN ('applied','discarded','stale') LIMIT 1").get(chatId)) return {...result,blockedReason:'BUSY'};
  try {
    const range = upgradeRange(db,chatId);
    return {...result,turns:range.turns,estimatedCalls:estimateWholeChatCalls(db,chatId,range.turns,
      range.messages.reduce((sum,row) => sum + estimateTokens(row.content!),0),range.groupTurns),
      ...(isChatCurrent(db,chatId) ? {blockedReason:'ALREADY_CURRENT' as const} : {})};
  } catch (error) {
    if ((error as {code?:string}).code !== 'SOURCE_MISSING') throw error;
    return {...result,blockedReason:'SOURCE_MISSING'};
  }
}

export function startUpgrade(db:RcmDatabase,chatId:string,opts:{backup:boolean;resolvedSetup?:ResolvedSetupProjection;identityHints?:Record<string,unknown>}): {runId:string;shadowChatId:string;queuedJobs:number} {
  assertUpgradeWorkEnabled(db,chatId);
  // Finished live calibrations intentionally retain no rendered setup. Require
  // the same authorized picker projection as fresh prepare, never user rows.
  const setup = PickerSetupProjectionSchema.safeParse(opts.resolvedSetup);
  if (!setup.success) throw failure('SETUP_UNAVAILABLE');
  const preview = previewUpgrade(db,chatId);
  if (preview.blockedReason) throw failure(preview.blockedReason);
  let backupPath: string | null = null;
  if (opts.backup) {
    try { backupPath = createChatBackup(db,chatId,{keepLatestOnly:true}); }
    catch { throw failure('BACKUP_FAILED'); }
  }
  return db.transaction(() => {
    const preview = previewUpgrade(db,chatId);
    if (preview.blockedReason) throw failure(preview.blockedReason);
    const {range} = upgradeRange(db,chatId), runId = randomUUID(), shadowChatId = `__rcm_regen__${runId}`;
    const contracts = {...DEFAULT_EXTRACTION_CONTRACTS};
    db.prepare(`INSERT INTO regeneration_runs(id,chat_id,mode,shadow_chat_id,source_fingerprint_json,post_extraction_review,
      status,phase,range_json,contract,created_at,updated_at) VALUES(?,?,'upgrade',?,?,0,'processing',1,?,?,?,?)`)
      .run(runId,chatId,shadowChatId,JSON.stringify(range.fingerprint),JSON.stringify(range),`${contracts.event}/${contracts.state}`,now(),now());
    db.prepare('UPDATE regeneration_runs SET backup_path=? WHERE id=?').run(backupPath,runId);
    const queuedJobs = enqueueRegenerationShadow(db,chatId,shadowChatId,0,false,range.sourceMessageIds,runId,{...contracts,resolvedSetup:setup.data,identityHints:opts.identityHints ?? {}});
    if (!queuedJobs) throw failure('NO_REGENERATION_WORK');
    const retiredJobIds = (db.prepare('SELECT id FROM jobs WHERE chat_id=?').all(chatId) as {id:string}[]).map(row=>row.id);
    // Freeze participation before any live replacement. Unconfigured embeddings
    // behave like retrieval's FTS-only mode; later configuration changes cannot
    // silently add or remove this run's completion requirement.
    const embeddingsParticipating = phase2EmbeddingAvailability.get(db)?.() ?? false;
    db.prepare('UPDATE regeneration_runs SET preview_json=? WHERE id=?').run(JSON.stringify({retiredJobIds,embeddingsParticipating}),runId);
    db.prepare(`UPDATE jobs SET status='queued',attempts=MAX(0,attempts-1),lease_owner=NULL,leased_until=NULL,updated_at=?
      WHERE chat_id=? AND status='leased'`).run(now(),chatId);
    abortChatWork(db,chatId,new Error('CHAT_UPGRADING'));
    return {runId,shadowChatId,queuedJobs};
  })();
}

/** Called by completion and progress readers; no background poller is needed. */
export function refreshUpgradeRun(db:RcmDatabase,runId:string): void {
  const phase2 = db.prepare("SELECT chat_id FROM regeneration_runs WHERE id=? AND mode='upgrade' AND phase=2 AND status='finishing'").get(runId) as {chat_id:string}|undefined;
  if (phase2) { void runUpgradePhase2(db,phase2.chat_id,runId); return; }
  const run = db.prepare("SELECT chat_id,shadow_chat_id,status,range_json,contract FROM regeneration_runs WHERE id=? AND mode='upgrade' AND phase=1").get(runId) as
    {chat_id:string;shadow_chat_id:string;status:string;range_json:string;contract:string}|undefined;
  if (!run || !['processing','ready'].includes(run.status)) return;
  if (checkUpgradeSource(db,run.chat_id,runId) !== 'ok') return;
  const failed = db.prepare("SELECT last_error FROM jobs WHERE chat_id=? AND status='failed' LIMIT 1").get(run.shadow_chat_id) as {last_error:string|null}|undefined;
  // Pending reconciliation items are ordinary shadow output. Task 3 must
  // transfer them at swap for the user to review on the live chat after unlock.
  const review = db.prepare("SELECT 1 FROM extraction_batches WHERE chat_id=? AND status='pending_review' LIMIT 1").get(run.shadow_chat_id);
  if (failed || review) {
    failUpgrade(db,runId,review ? 'SHADOW_REVIEW_REQUIRED' : failed?.last_error ?? 'Shadow job failed');
    return;
  }
  const [event,state] = run.contract.split('/');
  const contracts = {event:event!,state:state === 'null' ? null : state!};
  const calibration = db.prepare("SELECT status FROM initial_calibrations WHERE chat_id=?").get(run.shadow_chat_id) as {status:string}|undefined;
  if (calibration?.status !== 'ready') return;
  if (!db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND type IN ('extract','episode') LIMIT 1").get(run.shadow_chat_id)) {
    const range = JSON.parse(run.range_json) as FixedRange;
    if (!enqueueRegenerationSources(db,run.shadow_chat_id,0,false,range.sourceMessageIds,runId,contracts)) {
      failUpgrade(db,runId,'NO_REGENERATION_WORK');
      return;
    }
  }
  const unfinished = db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND status NOT IN ('done','superseded') LIMIT 1").get(run.shadow_chat_id);
  const unapplied = db.prepare("SELECT 1 FROM extraction_batches WHERE chat_id=? AND status NOT IN ('applied','superseded') LIMIT 1").get(run.shadow_chat_id);
  if (unfinished || unapplied) return;
  if (!db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND type='ledger_consistency' AND json_extract(payload_json,'$.backfillRunId')=? LIMIT 1").get(run.shadow_chat_id,runId)) {
    const finalLedger = enqueueFinalLedgerConsistency(db,run.shadow_chat_id,runId);
    pinRegenerationJobs(db,run.shadow_chat_id,runId,contracts);
    if (finalLedger.state !== 'not_needed') return;
  }
  // Fresh calibration's local setup projections inform extraction's prior
  // context. Once extraction/ledger are done, phase 2 owns rebuilding projections.
  db.prepare("DELETE FROM relationship_projections WHERE chat_id=? AND projection_origin='setup'").run(run.shadow_chat_id);
  db.prepare("UPDATE regeneration_runs SET status='ready',error=NULL,updated_at=? WHERE id=?").run(now(),runId);
  if (phase2Dependencies.has(db)) {
    // Completion may still be inside its ingest transaction and have shadow
    // housekeeping left. Promote only once that synchronous stack has returned.
    void Promise.resolve().then(() => {
      if (!db.open) return;
      if (requireRun(db,run.chat_id,runId).status !== 'ready') return;
      try { swapUpgrade(db,run.chat_id,runId); }
      catch (error) {
        if ((error as {code?:string}).code !== 'SOURCE_CHANGED') failUpgrade(db,runId,String(error));
        return;
      }
      void runUpgradePhase2(db,run.chat_id,runId);
    });
  }
}

export function activeUpgradeRun(db:RcmDatabase,chatId:string): UpgradeRun|null {
  const row = db.prepare(`SELECT id,chat_id chatId,shadow_chat_id shadowChatId,phase,status,error FROM regeneration_runs
    WHERE chat_id=? AND mode='upgrade' AND status NOT IN ('applied','discarded','stale') ORDER BY created_at DESC LIMIT 1`).get(chatId) as
    Omit<UpgradeRun,'done'|'total'>|undefined;
  if (!row) return null;
  refreshUpgradeRun(db,row.id);
  const status = db.prepare('SELECT status,error,phase FROM regeneration_runs WHERE id=?').get(row.id) as {status:string;error:string|null;phase:1|2};
  if (['discarded','applied','stale'].includes(status.status)) return null;
  const counts = db.prepare(`SELECT count(*) total,COALESCE(sum(status='done'),0) done FROM jobs
    WHERE chat_id=? AND status<>'superseded' AND (json_extract(payload_json,'$.upgradeRunId')=? OR json_extract(payload_json,'$.upgradePhase2RunId')=?)`).get(status.phase===1 ? row.shadowChatId : chatId,row.id,row.id) as {total:number;done:number};
  return {...row,...counts,phase:status.phase,status:status.status,error:status.error ?? undefined};
}

export function upgradeProgress(db:RcmDatabase,chatId:string): {phase:1|2;done:number;total:number}|null {
  const run = activeUpgradeRun(db,chatId);
  return run ? {phase:run.phase,done:run.done,total:run.total} : null;
}

function requireRun(db:RcmDatabase,chatId:string,runId:string) {
  const row = db.prepare("SELECT phase,status,shadow_chat_id,range_json,error FROM regeneration_runs WHERE id=? AND chat_id=? AND mode='upgrade'")
    .get(runId,chatId) as {phase:number;status:string;shadow_chat_id:string;range_json:string;error:string|null}|undefined;
  if (!row) throw failure('RUN_NOT_FOUND');
  return row;
}

export function cancelUpgrade(db:RcmDatabase,chatId:string,runId:string): void {
  const run = requireRun(db,chatId,runId);
  if (run.phase === 2 || run.status === 'finishing') throw failure('PHASE_LOCKED');
  if (run.status === 'discarded') return;
  db.transaction(() => { discardRegeneration(db,chatId,runId); })();
}

export function resumeUpgrade(db:RcmDatabase,chatId:string,runId:string): void {
  const run = requireRun(db,chatId,runId);
  assertUpgradeWorkEnabled(db,chatId);
  if (run.phase === 2 || run.status === 'finishing') throw failure('PHASE_LOCKED');
  if (run.status !== 'failed' || run.error === 'SHADOW_REVIEW_REQUIRED'
    || db.prepare("SELECT 1 FROM extraction_batches WHERE chat_id=? AND status='pending_review' LIMIT 1").get(run.shadow_chat_id)) throw failure('RUN_NOT_RESUMABLE');
  if (checkUpgradeSource(db,chatId,runId) !== 'ok') throw failure('SOURCE_CHANGED');
  assertChatUnlocked(db,chatId);
  db.transaction(() => {
    db.prepare(`UPDATE regeneration_runs SET preview_json=json_set(COALESCE(preview_json,'{}'),'$.retiredJobIds',json(?)) WHERE id=?`)
      .run(JSON.stringify((db.prepare('SELECT id FROM jobs WHERE chat_id=?').all(chatId) as {id:string}[]).map(row=>row.id)),runId);
    db.prepare(`UPDATE jobs SET status='queued',attempts=MAX(0,attempts-1),lease_owner=NULL,leased_until=NULL,updated_at=?
      WHERE chat_id=? AND status='leased'`).run(now(),chatId);
    abortChatWork(db,chatId,new Error('CHAT_UPGRADING'));
    db.prepare(`UPDATE jobs SET status='queued',attempts=0,lease_owner=NULL,leased_until=NULL,last_error=NULL,
      payload_json=json_remove(payload_json,'$.nextAttemptAt'),updated_at=?
      WHERE chat_id=? AND status='failed' AND json_extract(payload_json,'$.upgradeRunId')=?`).run(now(),run.shadow_chat_id,runId);
    db.prepare(`UPDATE extraction_batches SET status='queued',updated_at=? WHERE chat_id=? AND status='failed'
      AND job_id IN (SELECT id FROM jobs WHERE chat_id=? AND status='queued' AND json_extract(payload_json,'$.upgradeRunId')=?)`)
      .run(now(),run.shadow_chat_id,run.shadow_chat_id,runId);
    db.prepare("UPDATE initial_calibrations SET status='queued',last_error=NULL,updated_at=? WHERE chat_id=? AND status='failed' AND EXISTS(SELECT 1 FROM jobs WHERE chat_id=? AND type='initial_calibration' AND status='queued')").run(now(),run.shadow_chat_id,run.shadow_chat_id);
    db.prepare("UPDATE regeneration_runs SET status='processing',error=NULL,updated_at=? WHERE id=?").run(now(),runId);
  })();
}

export function checkUpgradeSource(db:RcmDatabase,chatId:string,runId:string): 'ok'|'SOURCE_CHANGED' {
  const run = requireRun(db,chatId,runId);
  if (run.error === 'SOURCE_CHANGED') return 'SOURCE_CHANGED';
  if (run.phase === 2 || ['applied','discarded'].includes(run.status)) return 'ok';
  const range = JSON.parse(run.range_json) as FixedRange;
  const chat=db.prepare('SELECT edit_protection_turns FROM chats WHERE id=?').get(chatId) as {edit_protection_turns:number};
  const rows = upgradeMessages(rangeMessages(db,chatId),editProtectedMessageIds(db,chatId,chat.edit_protection_turns))
    .filter(row=>row.ordinal>=range.startOrdinal && row.ordinal<=range.endOrdinal);
  if (JSON.stringify(rows.map(row => row.id)) === JSON.stringify(range.sourceMessageIds)
    && rows.every(row => row.content !== null && ['committed','client_pruned'].includes(row.lifecycle))
    && fingerprintMatches(db,chatId,range.fingerprint)) return 'ok';
  db.transaction(() => {
    cancelUpgrade(db,chatId,runId);
    db.prepare("UPDATE regeneration_runs SET error='SOURCE_CHANGED',updated_at=? WHERE id=?").run(now(),runId);
    recordUpgradeIncident(db,runId,'upgrade_failed');
  })();
  return 'SOURCE_CHANGED';
}

/** Check before a completion opens its ingest transaction, so discard survives
 * the caller rejecting that stale completion. Also covers oversized capsules. */
export function assertUpgradeJobSource(db:RcmDatabase,shadowChatId:string,payload:{upgradeRunId?:string}): void {
  if (!payload.upgradeRunId) return;
  const run = db.prepare("SELECT chat_id,status FROM regeneration_runs WHERE id=? AND shadow_chat_id=? AND mode='upgrade'")
    .get(payload.upgradeRunId,shadowChatId) as {chat_id:string;status:string}|undefined;
  if (!run || !['processing','failed'].includes(run.status)) throw failure('RUN_NOT_READY');
  if (checkUpgradeSource(db,run.chat_id,payload.upgradeRunId) !== 'ok') throw failure('SOURCE_CHANGED');
}

/** The fingerprint check and promotion share one synchronous SQLite transaction.
 * A crash can leave ready or finishing, never a partially replaced live chat.
 */
export function swapUpgrade(db:RcmDatabase,chatId:string,runId:string): void {
  const run = requireRun(db,chatId,runId);
  if (run.phase === 2 || run.status === 'applied') return;
  if (run.status !== 'ready') throw failure('RUN_NOT_READY');
  // Persist SOURCE_CHANGED/discard outside the throwing transaction too.
  if (checkUpgradeSource(db,chatId,runId) !== 'ok') throw failure('SOURCE_CHANGED');
  db.transaction(() => {
    if (checkUpgradeSource(db,chatId,runId) !== 'ok') throw failure('SOURCE_CHANGED');
    applyCanonicalRegeneration(db,chatId,runId,[],{fullReplace:true});
  })();
}

export type UpgradePhase2Deps = {
  rebuildStory: (chatId:string,runId:string) => void | Promise<void>;
  projectRelationships: (chatId:string,runId:string) => void | Promise<void>;
  enqueueEmbeddings: (chatId:string) => void | Promise<void>;
};
const phase2Dependencies = new WeakMap<RcmDatabase,UpgradePhase2Deps>();
const phase2EmbeddingAvailability = new WeakMap<RcmDatabase,()=>boolean>();
const phase2Running = new WeakMap<RcmDatabase,Map<string,Promise<void>>>();

export function configureUpgradePhase2(db:RcmDatabase,enqueueEmbeddings:UpgradePhase2Deps['enqueueEmbeddings'],wake:()=>void = ()=>{},embeddingsUsable:()=>boolean = ()=>true): void {
  phase2EmbeddingAvailability.set(db,embeddingsUsable);
  phase2Dependencies.set(db,{
    // Full replacement already removed the old hierarchy; never invalidate again
    // on restart. The existing builder advances segment → arc → overview.
    rebuildStory:(chatId,runId) => { if (maybeEnqueueStorySpine(db,chatId,runId,'rebuild')) wake(); },
    projectRelationships:(chatId,runId) => {
      if (flushRelationshipProjectionQueue(db,chatId,runId)) wake();
    },
    enqueueEmbeddings,
  });
}

/** Event-driven continuation: completions/failures and startup invoke this same
 * refresh. Returning while jobs are queued keeps the durable lock. The embedding
 * dependency resolves only after BOTH canonical and state-search queues drain.
 * Three failed attempts total are persisted across restarts; explicit retry resets.
 */
export function runUpgradePhase2(db:RcmDatabase,chatId:string,runId:string,deps = phase2Dependencies.get(db)): Promise<void> {
  let running = phase2Running.get(db);
  if (!running) phase2Running.set(db,running = new Map());
  if (running.has(runId)) return running.get(runId)!;
  const task = Promise.resolve().then(async () => {
    if (!deps) return; // Startup configures services before reattachment.
    let sourceRevisits = 0;
    while (true) {
      const run = requireRun(db,chatId,runId);
      if (run.phase !== 2 || run.status !== 'finishing' || run.error) return;
      if (isSourceSnapshotHeld(db,chatId)) return;
      try {
        const inventory = sourceInventory(db,chatId);
        const failed = db.prepare("SELECT last_error FROM jobs WHERE chat_id=? AND status='failed' AND json_extract(payload_json,'$.upgradePhase2RunId')=? LIMIT 1").get(chatId,runId) as {last_error:string}|undefined;
        if (failed) throw new Error(failed.last_error ?? 'Phase 2 job failed');
        await deps.rebuildStory(chatId,runId);
        if (isSourceSnapshotHeld(db,chatId)) return;
        await deps.projectRelationships(chatId,runId);
        if (isSourceSnapshotHeld(db,chatId)) return;
        if (db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND status IN ('queued','leased') AND type IN ('story_consolidation','relationship_projection') LIMIT 1").get(chatId)) return;
        if (db.prepare('SELECT 1 FROM relationship_projection_queue WHERE chat_id=? LIMIT 1').get(chatId)) return;
        const completion = JSON.parse((db.prepare('SELECT preview_json FROM regeneration_runs WHERE id=?').get(runId) as {preview_json:string}).preview_json ?? '{}');
        if (completion.embeddingsParticipating) await deps.enqueueEmbeddings(chatId);
        if (isSourceSnapshotHeld(db,chatId)) return;
        // Sync is allowed after promotion, including while embeddings await a
        // provider. Revisit changed source at most twice (three passes total),
        // so continued editing cannot keep the chat locked indefinitely.
        // Repairs blocked on newly pending extraction stay non-deliverable and
        // resume through normal extraction after unlock; no extraction under lock.
        if (sourceInventory(db,chatId) !== inventory && sourceRevisits < 2) {
          sourceRevisits++;
          continue;
        }
        db.transaction(() => {
          const contract = (db.prepare('SELECT contract FROM regeneration_runs WHERE id=?').get(runId) as {contract:string}).contract;
          markChatRebuilt(db,chatId,contract);
          db.prepare("UPDATE regeneration_runs SET status='applied',error=NULL,updated_at=? WHERE id=?").run(now(),runId);
          recordUpgradeIncident(db,runId,'upgrade_done');
        })();
        return;
      } catch (error) {
        if (isSourceSnapshotHeld(db,chatId)) return;
        const state = JSON.parse((db.prepare('SELECT preview_json FROM regeneration_runs WHERE id=?').get(runId) as {preview_json:string}).preview_json ?? '{}');
        state.phase2Attempts = (state.phase2Attempts ?? 0) + 1;
        const exhausted = state.phase2Attempts >= 3;
        db.prepare('UPDATE regeneration_runs SET preview_json=?,error=?,updated_at=? WHERE id=?').run(JSON.stringify(state),exhausted ? String(error instanceof Error ? error.message : error) : null,now(),runId);
        if (exhausted) { recordUpgradeIncident(db,runId,'upgrade_failed'); return; }
        requeuePhase2Failures(db,chatId,runId);
      }
    }
  }).finally(() => { running!.delete(runId); });
  running.set(runId,task);
  return task;
}

export function retryUpgradePhase2(db:RcmDatabase,chatId:string,runId:string): Promise<void> {
  assertSourceSnapshotAccepted(db,chatId);
  const run = requireRun(db,chatId,runId);
  if (run.phase !== 2 || !['finishing','failed'].includes(run.status)) throw failure('PHASE_LOCKED');
  db.prepare(`UPDATE regeneration_runs SET status='finishing',error=NULL,
    preview_json=json_set(COALESCE(preview_json,'{}'),'$.phase2Attempts',0),updated_at=? WHERE id=?`).run(now(),runId);
  requeuePhase2Failures(db,chatId,runId);
  return runUpgradePhase2(db,chatId,runId);
}

/** Match the existing explicit retry policy for BOTH Story and relationship
 * jobs: reset repair state/host caches and bypass the failed input fingerprint
 * at lease, while preserving accounting and valid server checkpoints.
 */
function requeuePhase2Failures(db:RcmDatabase,chatId:string,runId:string): void {
  if (isSourceSnapshotHeld(db,chatId)) return;
  db.transaction(()=>{
    const rows=db.prepare(`SELECT id,payload_json FROM jobs WHERE chat_id=? AND status='failed'
      AND json_extract(payload_json,'$.upgradePhase2RunId')=?`).all(chatId,runId) as {id:string;payload_json:string}[];
    const update=db.prepare(`UPDATE jobs SET status='queued',attempts=0,lease_owner=NULL,leased_until=NULL,last_error=NULL,payload_json=?,updated_at=? WHERE id=?`);
    for (const row of rows) update.run(JSON.stringify(manualRetryPayload(JSON.parse(row.payload_json))),now(),row.id);
  })();
}

export function reattachUpgradeRuns(db:RcmDatabase): void {
  const runs = db.prepare("SELECT id,chat_id,status,phase FROM regeneration_runs WHERE mode='upgrade' AND status IN ('processing','ready','finishing')").all() as
    {id:string;chat_id:string;status:string;phase:number}[];
  for (const run of runs) {
    if (run.phase === 1 && run.status === 'ready') {
      try { swapUpgrade(db,run.chat_id,run.id); }
      catch (error) {
        if ((error as {code?:string}).code !== 'SOURCE_CHANGED') failUpgrade(db,run.id,String(error));
        continue;
      }
    }
    if (run.phase === 2 || run.status === 'ready') void runUpgradePhase2(db,run.chat_id,run.id);
  }
}

export function refreshChatUpgrade(db:RcmDatabase,chatId:string): void {
  const run = db.prepare("SELECT id FROM regeneration_runs WHERE chat_id=? AND mode='upgrade' AND phase=2 AND status='finishing'").get(chatId) as {id:string}|undefined;
  if (run) refreshUpgradeRun(db,run.id);
}

function failUpgrade(db:RcmDatabase,runId:string,error:string): void {
  db.transaction(() => {
    db.prepare("UPDATE regeneration_runs SET status='failed',error=?,updated_at=? WHERE id=?").run(error,now(),runId);
    recordUpgradeIncident(db,runId,'upgrade_failed');
  })();
}
