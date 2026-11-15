import { assertChatUnlocked } from './upgrade-lock.js';
import { assertUpgradeJobWritable } from './upgrade-lock.js';
import { deletedMemoryKeys } from './user-deletions.js';
import { responseTurns, sourceTurnMembership } from './turn-clock.js';
import { batchHasStoredMaterial, finishReviewedBatches, coverageRetryFamilies, foldCoverageRetry } from './source-coverage.js';
import { normalizeGeneratedCardShapes } from "./ingest.js";
import { EVENT_ADDITION_GUIDANCE, EVENT_GAP_GUIDANCE } from "./event-prompt.js";
import { appendExtractionContinuation } from "./jobs.js";
import { extractionDraftSchema } from "@rcm/shared";
import { appendJobStateDrops } from "./jobs.js";
import { ModelContentValidationError } from "@rcm/shared";
import { recordSmallReviews } from "./small-review.js";
import { optionalSourceSelectorsOnly } from "@rcm/shared";
import { recordAuditAdditionDrops } from "./extraction-audit.js";
import { createHash, randomUUID } from 'node:crypto';
import { MEMORY_ADDITION_GUIDANCE, memoryAdditionRequestGuidance, validateMemoryAdditionRequestOutcome, memoryAdditionUserNote, memoryAdditionStopsAfterEvents } from '@rcm/shared';
import type { RecallCandidateSnapshot } from './recall-candidates.js';
import { contiguousSourceRangeSelection, estimateTokens, ExtractionAggregateSchema, ExtractionResultSchema, measureAuxiliaryPrompt, withAuxiliaryStoryFraming,
  type ExtractionDraftResult, type ExtractionAuditSubmission, type ReconciliationSubmission, type RpProfile, type MemoryLanguage, type LeasedJob } from '@rcm/shared';
import type { RcmDatabase } from './db.js';
import { adaptiveExtractionGroups, extractionUnits, buildPrompt } from './jobs.js';
import { gapRecoveryHoles } from './gap-recovery.js';
import { storeSourcePassages } from './source-evidence.js';
import { rangeMessages, listSourceRanges, memoryTargetFingerprint, sourceAccessFingerprint, additionMessageReason } from './source-ranges.js';
export { additionMessageReason } from './source-ranges.js';
import { sourceFingerprint, fingerprintMatches, extractionContinuationProgress, type SourceFingerprintItem } from './source-fingerprint.js';
import { inspectDraftEvidence } from './evidence-review.js';
import { applyExtractionAuditPatch } from './extraction-audit.js';
import { finishStateExtraction, recordStateObservationDrops } from './state-extraction.js';
import { recordSeedResolutionDrops } from './story-seeds.js';
import { additiveReconciliationResult, recordReconciliationReview, UNSUPPLIED_STATE_REVIEW_REASON } from './reconciliation.js';
import { scopeExtractionMemoryKeys } from './extraction-memory-keys.js';
import { ingestExtraction, hasRelationshipEvent, validateDialogueEvidence, validateExtractionSources } from './ingest.js';
import { sameSocialRelationScope } from './social-relations.js';
import { markStoryRangesInvalid, maybeEnqueueStorySpine } from './story-spine.js';
import { flushRelationshipProjectionQueue } from './relationship-projections.js';
import { normalizeLedgerPredicate, normalizeLedgerText } from './normalization.js';
import { stripThoughtBlocks } from './source-text.js';
import { canonicalizeExtraction } from './entities.js';
import { intimacyMilestoneKeys } from './intimacy-milestones.js';

const fail = (message: string, code = 'MEMORY_ADDITION_INVALID') => Object.assign(new Error(message), { code });
const contentFailure = (message: string) => Object.assign(new ModelContentValidationError(message), { code: 'MEMORY_ADDITION_INVALID' });
interface AdditionPayload extends Partial<RecallCandidateSnapshot> {
  extractionLookup?: { key: string; value: ReturnType<typeof buildPrompt>["lookup"] };
  promptContract?: "e1d" | "e1e" | "e1f";
  stateContract?: "r10" | "r11" | null;
  mode?: 'gap_recovery'; memoryOnly?: boolean;
  contextMessageIds?: string[];
  sourceMessageIds: string[]; sourceFingerprint: SourceFingerprintItem[]; rangeIds: string[];
  userRequest: string; existingMemories: any[]; memoryIds: string[]; targetFingerprint: string; accessFingerprint: string;
  memoryLanguage: MemoryLanguage; postExtractionReview: boolean; candidateStatus?: string; candidate?: any; ledgerFingerprint: string;
  continuationDraft?: ExtractionDraftResult; auxiliaryBudget?: { maxInputTokens: number };
  smallReviewDraft?: ExtractionDraftResult;
  requestOutcome?: ExtractionDraftResult['requestOutcome'];
  stateReviews?: ReturnType<typeof finishStateExtraction>['stateReviews'];
}

export function additionLedgerFingerprint(db: RcmDatabase, chatId: string): string {
  const tables = ['assertions', 'beliefs', 'promises', 'relationship_baselines', 'relationship_events', 'physical_intimacy_milestones', 'social_knowledge_events'];
  return createHash('sha256').update(JSON.stringify(tables.map(table => db.prepare(`SELECT * FROM ${table} WHERE chat_id=? ORDER BY id`).all(chatId)))).digest('hex');
}

export function additionSources(db: RcmDatabase, chatId: string, rangeIds: string[]) {
  if (!rangeIds.length || new Set(rangeIds).size !== rangeIds.length) throw fail('원문 구간을 선택해 주세요');
  const all = listSourceRanges(db, chatId);
  const selected = all.filter(row => rangeIds.includes(row.id));
  if (selected.length !== rangeIds.length) throw fail('선택한 원문 구간이 바뀌었어요', 'SOURCE_CHANGED');
  if (!contiguousSourceRangeSelection(all, rangeIds)) throw fail('연속된 원문 구간을 선택해 주세요');
  const ids = new Set(selected.flatMap(row => row.sourceMessageIds));
  const messages = rangeMessages(db, chatId).filter(row => ids.has(row.id) && row.content !== null
    && ['pending','committed','client_pruned'].includes(row.lifecycle) && ['active','all_before'].includes(row.visibility))
    .map(row => ({ ...row, additionReason: additionMessageReason(db, chatId, row) }));
  return { messages, rangeIds: selected.map(row => row.id), startOrdinal: selected[0]!.startOrdinal, endOrdinal: selected.at(-1)!.endOrdinal };
}

function linkedMemories(db: RcmDatabase, chatId: string, ids: string[]) {
  const selected = new Set(ids);
  const overlaps = (evidence: string) => (JSON.parse(evidence) as Array<{ messageId: string }>).some(item => selected.has(item.messageId));
  return (db.prepare('SELECT * FROM memories WHERE chat_id=? AND active=1 ORDER BY created_at,id').all(chatId) as any[]).flatMap(row => {
    const details = db.prepare('SELECT * FROM memory_details WHERE memory_id=? AND active=1 ORDER BY id').all(row.id) as any[];
    const dialogues = db.prepare('SELECT * FROM memory_dialogues WHERE memory_id=? ORDER BY ordinal,id').all(row.id) as any[];
    if (![row, ...details, ...dialogues].some(item => overlaps(item.evidence_json))) return [];
    return [{ id: row.id, cardShape: row.card_shape, key: row.memory_key, title: row.title, content: row.content, evidence: JSON.parse(row.evidence_json),
      knownBy: JSON.parse(row.known_by_json), details: details.map(d => ({ id: d.id, key: d.detail_key, text: d.text, evidence: JSON.parse(d.evidence_json) })),
      keyDialogues: dialogues.map(d => ({ text: d.text, speaker: d.speaker, evidence: JSON.parse(d.evidence_json) })) }];
  });
}

function prepareAddition(db: RcmDatabase, chatId: string, rangeIds: string[], messageIds: string[], userRequest: string, review: boolean): AdditionPayload {
  const source = additionSources(db, chatId, rangeIds);
  const selected=source.messages.filter(row=>messageIds.includes(row.id));
  if (selected.length!==messageIds.length || new Set(messageIds).size!==messageIds.length) throw fail('사용할 메시지를 선택해 주세요');
  for (const row of selected) if (row.additionReason) throw fail(`메시지 ${row.ordinal + 1}: ${row.additionReason}`);
  const turns=sourceTurnMembership(db,chatId).filter(turn=>turn.some(row=>messageIds.includes(row.message_id)));
  const chat = db.prepare('SELECT memory_language,include_user_messages FROM chats WHERE id=?').get(chatId) as { memory_language: MemoryLanguage;include_user_messages:number };
  const ids=new Set(turns.flatMap(turn=>turn.filter(row=>row.role==='assistant' || chat.include_user_messages!==0 && !['skipped_policy','excluded_episode'].includes(row.extraction_state)).map(row=>row.message_id)));
  const rows=rangeMessages(db,chatId).filter(row=>ids.has(row.id)).map(row=>({...row,additionReason:additionMessageReason(db,chatId,row)}));
  if (!rows.length || selected.some(row=>!turns.some(turn=>turn.some(source=>source.message_id===row.id)))) throw fail('사용할 메시지를 선택해 주세요');
  for (const row of rows) if (row.additionReason) throw fail(`메시지 ${row.ordinal + 1}: ${row.additionReason}`);
  const existingMemories = linkedMemories(db, chatId, rows.map(row => row.id));
  const memoryIds = existingMemories.map(row => row.id);
  return { rangeIds: source.rangeIds, sourceMessageIds: rows.map(row => row.id), sourceFingerprint: sourceFingerprint(db, chatId, rows.map(row => row.id)),
    userRequest: userRequest.trim(), existingMemories, memoryIds, targetFingerprint: memoryTargetFingerprint(db, chatId, memoryIds),
    accessFingerprint: sourceAccessFingerprint(db, chatId, rows.map(row => row.id)), ledgerFingerprint: additionLedgerFingerprint(db, chatId), memoryLanguage: chat.memory_language, postExtractionReview: review };
}

export function buildAdditionJob(db: RcmDatabase, id: string, chatId: string, profile: RpProfile, attempt: number, payload: AdditionPayload, eventWriting: boolean | "e1d" | "e1e" | "e1f" = false): LeasedJob & RecallCandidateSnapshot & { extractionLookup: NonNullable<AdditionPayload["extractionLookup"]> } {
  const allRows = rangeMessages(db, chatId);
  const rows = allRows.filter(row => payload.sourceMessageIds.includes(row.id));
  const lookupKey = JSON.stringify([payload.sourceFingerprint, payload.continuationDraft?.unfinishedSource, profile, payload.memoryLanguage]);
  const { lookup, ...built } = buildPrompt(db, chatId, profile, payload.memoryLanguage, rows.map(row => ({ message_id: row.id, role: row.role,
    content: row.content!, content_hash: row.canonicalHash, ordinal: row.ordinal })), payload.continuationDraft?.unfinishedSource,
    payload.extractionLookup?.key === lookupKey ? payload.extractionLookup.value : payload.recallCandidates && payload.recallAtomRefs ? { recallCandidates: payload.recallCandidates, recallAtomRefs: payload.recallAtomRefs } : undefined, eventWriting);
  const gaps = rows.slice(1).flatMap((row, index) => allRows.some(between => !between.memoryExcluded
    && ['pending','committed','client_pruned'].includes(between.lifecycle) && ['active','all_before'].includes(between.visibility)
    && between.ordinal > rows[index]!.ordinal && between.ordinal < row.ordinal)
    ? [{ afterMessage: rows[index]!.ordinal + 1, beforeMessage: row.ordinal + 1, omitted: true }] : []);
  const memoryAddition = { userRequest: payload.userRequest, existingMemories: payload.existingMemories };
  const recovery = payload.mode === 'gap_recovery';
  const systemPrompt = `${built.systemPrompt}\n\n${eventWriting ? EVENT_ADDITION_GUIDANCE : MEMORY_ADDITION_GUIDANCE}\n${memoryAdditionRequestGuidance(payload.userRequest)}${recovery ? eventWriting ? `\n${EVENT_GAP_GUIDANCE}` : '\nGAP RECOVERY: Archive only the selected historical hole. Keep memories with details, keyDialogues and sourcePassages only. Return no entities, stateObservations, assertions, beliefs, promises, relationshipEvents, relationshipBaselines, physicalIntimacy, socialKnowledge, seedResolutions, atomRelations, or recall observations. Accumulated state is already correct. READ_ONLY_CONTEXT_JSON is context, never evidence. Evidence and unfinishedSource must refer only to selected hole messages. An empty memories array is a valid completed outcome when there is nothing worth adding.' : ''}`;
  const userPrompt = appendExtractionContinuation(`${built.userPrompt}\nADDITIVE_CONTEXT_JSON\n${JSON.stringify({ existingMemories: payload.existingMemories,
    selectedMessageNumbers: rows.map(row => ({ id: row.id, number: row.ordinal + 1 })), gaps,
    userNote: memoryAdditionUserNote(payload.userRequest) })}\nEND_ADDITIVE_CONTEXT_JSON${recovery ? `\nREAD_ONLY_CONTEXT_JSON\n${JSON.stringify(allRows.filter(row=>payload.contextMessageIds?.includes(row.id)).map(row=>({id:row.id,role:row.role,content:row.content})))}\nEND_READ_ONLY_CONTEXT_JSON` : ''}`, payload.continuationDraft, built.promptContract);
  return { ...built, extractionLookup: { key: lookupKey, value: lookup }, id, chatId, profile, kind: 'extract', memoryAddition, attempt, systemPrompt, userPrompt, prompt: `${systemPrompt}\n\n${userPrompt}`,
    memoryLanguage: payload.memoryLanguage, sourceMessageIds: payload.sourceMessageIds, postExtractionReview: payload.postExtractionReview, memoryOnly: payload.memoryOnly,
    continuationDraft: payload.continuationDraft, auditSourceMessages: rows.map(row => ({ id: row.id, role: row.role, content: row.content!, canonicalHash: row.canonicalHash })) };
}

export function previewMemoryAddition(db: RcmDatabase, chatId: string, rangeIds: string[], messageIds: string[], request: string, review: boolean) {
  const payload = prepareAddition(db, chatId, rangeIds, messageIds, request, review);
  const profile = (db.prepare('SELECT profile FROM chats WHERE id=?').get(chatId) as { profile: RpProfile }).profile;
  const job = buildAdditionJob(db, '', chatId, profile, 1, payload, true);
  const config = JSON.parse((db.prepare("SELECT value FROM server_meta WHERE key='server_llm_config'").get() as { value: string } | undefined)?.value ?? '{}');
  const measure = measureAuxiliaryPrompt(withAuxiliaryStoryFraming([{ role: 'system', content: job.systemPrompt! }, { role: 'user', content: job.userPrompt! }], config.relaxAuxiliaryCensorship === true), estimateTokens,
    { maxInputTokens: config.maxInputTokens ?? 80_000, maxOutputTokens: config.maxOutputTokens ?? 24_000 });
  if (!measure.fits) throw fail('선택한 원문과 기존 기억이 모델 입력 한도를 넘어요. 메시지를 줄여 주세요');
  return { rawTokens: rangeMessages(db, chatId).filter(row => messageIds.includes(row.id)).reduce((n, row) => n + estimateTokens(stripThoughtBlocks(row.content!)), 0),
    messageCount: messageIds.length, initialCalls: review ? 3 : 2, estimatedInputTokens: measure.estimatedInputTokens,
    note: '사건·상태 추출 기준이며, 보완·재시도·후속 투영 호출은 추가될 수 있어요.' };
}

export function startMemoryAddition(db: RcmDatabase, chatId: string, rangeIds: string[], messageIds: string[], request: string, review: boolean, idempotencyKey?:string) {
  assertChatUnlocked(db,chatId);
  const id=idempotencyKey ? `addition_${createHash('sha256').update(JSON.stringify([chatId,idempotencyKey])).digest('hex')}` : randomUUID();
  const creationRequestFingerprint=createHash('sha256').update(JSON.stringify([[...rangeIds].sort(),[...messageIds].sort(),request.trim(),review])).digest('hex');
  const existing=db.prepare("SELECT payload_json FROM jobs WHERE id=? AND chat_id=? AND type='memory_addition'").get(id,chatId) as {payload_json:string}|undefined;
  if(existing) {
    if(JSON.parse(existing.payload_json).creationRequestFingerprint!==creationRequestFingerprint) throw fail('같은 요청 키에 다른 입력이 전달됐어요. 새로 제출해 주세요','IDEMPOTENCY_CONFLICT');
    return {runId:id,jobId:id};
  }
  previewMemoryAddition(db, chatId, rangeIds, messageIds, request, review);
  const payload = prepareAddition(db, chatId, rangeIds, messageIds, request, review);
  const timestamp = Date.now();
  db.prepare("INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'memory_addition','queued',?,0,?,?)")
    .run(id, chatId, JSON.stringify({ ...payload, creationRequestFingerprint, trigger: 'memory_addition' }), timestamp, timestamp);
  return { runId: id, jobId: id };
}

function current(db: RcmDatabase, chatId: string, payload: AdditionPayload): boolean {
  if (payload.mode === 'gap_recovery') {
    if (!fingerprintMatches(db,chatId,payload.sourceFingerprint)) return false;
    const membership=new Set(gapRecoveryHoles(db,chatId).flatMap(hole=>hole.sourceMessageIds));
    return payload.sourceMessageIds.every(id=>membership.has(id));
  }
  return fingerprintMatches(db, chatId, payload.sourceFingerprint)
    && rangeMessages(db, chatId).filter(row => payload.sourceMessageIds.includes(row.id)).every(row => !additionMessageReason(db, chatId, row))
    && memoryTargetFingerprint(db, chatId, payload.memoryIds) === payload.targetFingerprint
    && additionLedgerFingerprint(db, chatId) === payload.ledgerFingerprint
    && linkedMemories(db, chatId, payload.sourceMessageIds).map(row => row.id).join('\0') === payload.memoryIds.join('\0')
    && sourceAccessFingerprint(db, chatId, payload.sourceMessageIds) === payload.accessFingerprint;
}
export function validatePendingAddition(db: RcmDatabase, chatId: string, id: string, payload: AdditionPayload): boolean {
  if (current(db, chatId, payload)) return true;
  db.prepare("UPDATE jobs SET status='done',lease_owner=NULL,leased_until=NULL,payload_json=json_set(payload_json,'$.candidateStatus','stale'),last_error='원문이나 연결된 기억이 바뀌었어요',updated_at=? WHERE id=?")
    .run(Date.now(), id);
  return false;
}

export function completeMemoryAddition(db: RcmDatabase, jobId: string, workerId: string, value: ExtractionDraftResult, reconciliation?: ReconciliationSubmission, audit?: ExtractionAuditSubmission) {
  assertUpgradeJobWritable(db,jobId);
  const job = db.prepare("SELECT chat_id,payload_json FROM jobs WHERE id=? AND type='memory_addition' AND status='leased' AND lease_owner=?").get(jobId, workerId) as { chat_id: string; payload_json: string } | undefined;
  if (!job) throw fail('Lease not found', 'LEASE_NOT_FOUND');
  const payload: AdditionPayload = JSON.parse(job.payload_json);
  recordAuditAdditionDrops(db, jobId, payload, audit);
  if (!validatePendingAddition(db, job.chat_id, jobId, payload)) return { chatId: job.chat_id, warnings: ['원문 변경으로 후보를 중단했어요'], pendingReconciliations: 0 };
  let draft = validateMemoryAdditionRequestOutcome(ExtractionAggregateSchema.parse(payload.mode === 'gap_recovery'
    ? {language:value.language,memories:value.memories,sourcePassages:value.sourcePassages,unfinishedSource:value.unfinishedSource,requestOutcome:value.requestOutcome} : value), payload.userRequest);
  extractionDraftSchema(payload.promptContract).parse({ language: draft.language, memories: draft.memories, sourcePassages: draft.sourcePassages, unfinishedSource: draft.unfinishedSource, requestOutcome: draft.requestOutcome });
  if (draft.unfinishedSource?.length) {
    const {progress} = extractionContinuationProgress(db,job.chat_id,payload.sourceMessageIds,payload.continuationDraft?.unfinishedSource,draft.unfinishedSource);
    const reason = progress ? null : 'CONTINUATION_NO_PROGRESS: 남은 원문 범위가 줄지 않아 중단했어요. 선택을 줄여 다시 요청해 주세요';
    db.prepare("UPDATE jobs SET status=?,attempts=CASE WHEN ? THEN 0 ELSE attempts END,lease_owner=NULL,leased_until=NULL,last_error=?,payload_json=?,updated_at=? WHERE id=?")
      .run(progress ? 'queued' : 'failed',Number(progress),reason,JSON.stringify({ ...payload, continuationDraft: draft,
        pipelineStage:progress?'queued':'failed',validatedExtractionCheckpoint:undefined,validatedPreReconciliationCheckpoint:undefined }),Date.now(),jobId);
    return { chatId: job.chat_id, warnings: [reason ?? '같은 작업에서 남은 원문을 이어서 읽어요'], pendingReconciliations: 0 };
  }
  if (memoryAdditionStopsAfterEvents(draft)) {
    if (payload.mode === 'gap_recovery') {
      const empty=ExtractionResultSchema.parse({language:draft.language,memories:[],sourcePassages:draft.sourcePassages});
      const errors=validateExtractionSources(db,job.chat_id,payload.sourceMessageIds,empty);
      if (errors.length) throw contentFailure(errors.join('; '));
      db.transaction(()=>{
        const owners=recordGapBatch(db,job.chat_id,jobId,payload);
        for (const owner of new Set(payload.sourceMessageIds.map(id=>owners.get(id)!))) {
          const passages=(empty.sourcePassages ?? []).filter(passage=>owners.get(passage.messageId)===owner);
          storeSourcePassages(db,job.chat_id,passages,owner,payload.sourceMessageIds);
          appendGapSnapshot(db,owner,[],passages);
        }
        finishGapRecovery(db,job.chat_id,jobId,payload,[]);
      })();
      return {chatId:job.chat_id,warnings:[],pendingReconciliations:0};
    }
    if (draft.requestOutcome?.relatedMemoryIds?.some(id => !payload.memoryIds.includes(id))) throw contentFailure('요청 결과가 제공되지 않은 기억을 가리켜요');
    const refused = Boolean(payload.userRequest && !draft.requestOutcome);
    const error = refused ? '모델이 요청을 처리하지 않았어요. 추가 검열 완화 (실험적)를 켜고 새로 요청해 봐 주세요.' : null;
    db.prepare("UPDATE jobs SET status=?,lease_owner=NULL,leased_until=NULL,last_error=?,payload_json=?,updated_at=? WHERE id=?")
      .run(refused ? 'failed' : 'done', error, JSON.stringify({ ...payload, candidate: undefined, continuationDraft: undefined,
        validatedExtractionCheckpoint: undefined, validatedPreReconciliationCheckpoint: undefined,
        candidateStatus: refused ? undefined : 'empty', requestOutcome: draft.requestOutcome, pipelineStage: refused ? 'failed' : 'complete' }), Date.now(), jobId);
    return { chatId: job.chat_id, warnings: error ? [error] : [], pendingReconciliations: 0 };
  }
  if (payload.postExtractionReview && (!audit?.patch || audit.error)) throw fail('요청한 추출 검수를 끝내지 못했어요');
  if (audit?.patch) {
    const reviewed = applyExtractionAuditPatch(db, job.chat_id, payload.sourceMessageIds, draft, audit.patch);
    if (reviewed.pendingRefs.length) throw contentFailure('기억 근거 검수가 끝나지 않았어요');
    draft = reviewed.result;
  }
  const completed = payload.mode === 'gap_recovery' ? {draft, reconciliation:undefined, progressDiagnostics:{},recognitionReviewDraft:undefined,seedResolutionDrops:[],stateObservationDrops:[],stateReviews:[]}
    : finishStateExtraction(db, job.chat_id, payload.sourceMessageIds, draft, reconciliation,
      payload.auxiliaryBudget?.maxInputTokens ?? 80_000, { userRequest: payload.userRequest, existingMemories: payload.existingMemories }, jobId);
  draft = completed.draft;
  Object.assign(payload, completed.progressDiagnostics);
  const issues = inspectDraftEvidence(db, job.chat_id, payload.sourceMessageIds, draft);
  if (issues.length && !optionalSourceSelectorsOnly(issues)) throw contentFailure(`기억 근거를 확인할 수 없어요: ${issues.slice(0, 3).map(issue => `${issue.path}: ${issue.reason}`).join('; ')}`);
  const smallReviewDraft = issues.length || completed.recognitionReviewDraft ? structuredClone(completed.recognitionReviewDraft ?? draft) : undefined;
  if (issues.length) draft = {...draft,
    sourcePassages: draft.sourcePassages?.filter((_, index) => !issues.some(issue => issue.path.startsWith(`sourcePassages[${index}]`))),
    memories: draft.memories.map((memory, mi) => ({...memory, keyDialogues: memory.keyDialogues?.filter((_, di) => !issues.some(issue => issue.path.startsWith(`memories[${mi}].keyDialogues[${di}]`)))})),
  };
  const heldState=new Set(completed.stateReviews.map(review=>review.entry.itemRef));
  const additiveDrops: import("@rcm/shared").StateItemDrop[] = [];
  const final = canonicalizeExtraction(db, job.chat_id, additiveReconciliationResult({...draft,stateObservations:draft.stateObservations.filter(o=>!heldState.has(`observation:${o.key}`))}, completed.reconciliation, additiveDrops), payload.sourceMessageIds);
  // Exact property identities only. Existing current state is never rewritten
  // by a late historical omission; its new memory detail remains available.
  final.assertions = final.assertions.filter(item => !(db.prepare("SELECT social_relation_json FROM assertions WHERE chat_id=? AND subject=? COLLATE NOCASE AND valid_to_revision IS NULL AND predicate=?")
    .all(job.chat_id, item.subject, normalizeLedgerPredicate(item.predicate)) as Array<{ social_relation_json: string | null }>)
    .some(row => sameSocialRelationScope(row.social_relation_json, item.socialRelation)));
  final.relationshipEvents = final.relationshipEvents?.filter(item => !hasRelationshipEvent(db, job.chat_id, item));
  final.beliefs = final.beliefs.filter(item => !db.prepare("SELECT 1 FROM beliefs WHERE chat_id=? AND holder=? COLLATE NOCASE AND subject=? COLLATE NOCASE AND predicate=? AND active=1")
    .get(job.chat_id, item.holder, item.subject, normalizeLedgerPredicate(item.predicate)));
  final.promises = final.promises.filter(item => !db.prepare('SELECT 1 FROM promises WHERE chat_id=? AND promise_key=?').get(job.chat_id, item.key));
  final.relationshipBaselines = final.relationshipBaselines?.filter(item => !db.prepare('SELECT 1 FROM relationship_baselines WHERE chat_id=? AND from_entity=? AND to_entity=?').get(job.chat_id, item.from, item.to));
  final.physicalIntimacy = final.physicalIntimacy?.filter(item => {
    const [a,b] = [...item.participants].sort((left,right) => left.localeCompare(right));
    return intimacyMilestoneKeys(item.act).some(key => !db.prepare('SELECT 1 FROM physical_intimacy_milestones WHERE chat_id=? AND participant_a=? AND participant_b=? AND milestone_key=? AND deleted_by_user=0').get(job.chat_id,a,b,key));
  });
  const memoryKeys = new Set(final.memories.map(memory => memory.key));
  const checkNewParent = (item: { memoryKey?: string }) => { if (item.memoryKey && !memoryKeys.has(item.memoryKey)) throw contentFailure('추가 후보는 기존 기억을 수정 대상으로 지정할 수 없어요'); };
  [...final.promises, ...(final.socialKnowledge ?? []), ...(final.relationshipEvents ?? []), ...(final.physicalIntimacy ?? [])].forEach(checkNewParent);
  for (const memory of payload.userRequest ? [] : final.memories) {
    const duplicate = payload.existingMemories.some(existing => normalizeLedgerText(existing.content) === normalizeLedgerText(memory.content)
      && (memory.details ?? []).every(detail => existing.details.some((old: any) => normalizeLedgerText(old.text) === normalizeLedgerText(detail.text)))
      && (memory.keyDialogues ?? []).every(dialogue => existing.keyDialogues.some((old: any) => old.text === dialogue.text && old.speaker === dialogue.speaker)));
    if (duplicate) throw contentFailure('기존 기억과 같은 후보가 반환됐어요. 빠진 내용을 더 구체적으로 요청해 주세요');
  }
  normalizeGeneratedCardShapes(final, payload.promptContract);
  const candidate = validateDialogueEvidence(db, job.chat_id, payload.sourceMessageIds,
    scopeExtractionMemoryKeys(final, `addition:${jobId}`,deletedMemoryKeys(db,job.chat_id)));
  const errors = validateExtractionSources(db, job.chat_id, payload.sourceMessageIds, candidate);
  if (errors.length) throw contentFailure(errors.join('; '));
  db.transaction(()=>{
    db.prepare("UPDATE jobs SET status='done',lease_owner=NULL,leased_until=NULL,last_error=NULL,payload_json=?,updated_at=? WHERE id=?")
      .run(JSON.stringify({ ...payload, stateRecovery:appendJobStateDrops(db,jobId,additiveDrops), stateReviews:completed.stateReviews, stateInput:JSON.parse((db.prepare('SELECT payload_json FROM jobs WHERE id=?').get(jobId) as {payload_json:string}).payload_json).stateInput,
        candidateStatus: 'ready', candidate, smallReviewDraft, pipelineStage: 'complete' }), Date.now(), jobId);
    recordSeedResolutionDrops(db,jobId,completed.seedResolutionDrops);
    recordStateObservationDrops(db,jobId,completed.stateObservationDrops);
    if (payload.mode === 'gap_recovery') applyMemoryAddition(db,job.chat_id,jobId);
  })();
  return { chatId: job.chat_id, warnings: smallReviewDraft ? ['일부 선택 후보를 보류했어요. 기억 적용 뒤 작은 확인에 표시해요.'] : [], pendingReconciliations: 0 };
}

export function listMemoryAdditions(db: RcmDatabase, chatId: string) {
  return (db.prepare("SELECT id,status,payload_json,last_error FROM jobs WHERE chat_id=? AND type='memory_addition' ORDER BY created_at DESC,id").all(chatId) as any[]).flatMap(row => {
    const payload: AdditionPayload = JSON.parse(row.payload_json);
    if (payload.mode === 'gap_recovery') return [];
    if (['applied', 'discarded'].includes(payload.candidateStatus ?? '')) return [];
    if (!payload.candidateStatus && !validatePendingAddition(db, chatId, row.id, payload)) payload.candidateStatus = 'stale';
    if (payload.candidateStatus === 'ready' && !validatePendingAddition(db, chatId, row.id, payload)) payload.candidateStatus = 'stale';
    return [{ id: row.id, jobId: row.id, status: payload.candidateStatus ?? (row.status === 'failed' ? 'failed' : 'processing'),
      error: row.last_error, request: payload.userRequest, requestOutcome: payload.requestOutcome, candidate: payload.candidate, sourceFingerprint: payload.sourceFingerprint,
      canRetry: row.status === 'failed' && payload.candidateStatus !== 'stale' }];
  });
}

function appendGapSnapshot(db:RcmDatabase,owner:string,memories:import('@rcm/shared').ExtractionResult['memories'],passages:import('@rcm/shared').SourcePassage[]):void {
  const stored=db.prepare('SELECT final_json FROM extraction_batches WHERE id=?').get(owner) as {final_json:string|null};
  // Partial additions cannot supply an absent event-and-state replay contract.
  if (stored.final_json===null) return;
  const snapshot=JSON.parse(stored.final_json);
  const accepted=new Map((snapshot.memories ?? []).map((memory:typeof memories[number])=>[memory.key,memory]));
  for (const memory of memories) accepted.set(memory.key,memory);
  const sources=new Map<string,import('@rcm/shared').SourcePassage>((snapshot.sourcePassages ?? []).map((passage:import('@rcm/shared').SourcePassage)=>[JSON.stringify(passage),passage]));
  for (const passage of passages) sources.set(JSON.stringify(passage),passage);
  db.prepare('UPDATE extraction_batches SET final_json=?,updated_at=? WHERE id=?').run(JSON.stringify({...snapshot,memories:[...accepted.values()],sourcePassages:[...sources.values()]}),Date.now(),owner);
}

export function applyMemoryAddition(db: RcmDatabase, chatId: string, id: string) {
  assertChatUnlocked(db,chatId);
  const row = db.prepare("SELECT payload_json FROM jobs WHERE id=? AND chat_id=? AND type='memory_addition'").get(id, chatId) as { payload_json: string } | undefined;
  if (!row) throw fail('기억 추가 작업을 찾을 수 없어요');
  const payload: AdditionPayload = JSON.parse(row.payload_json);
  if (payload.candidateStatus === 'applied') return;
  if (payload.candidateStatus !== 'ready' || !payload.candidate) throw fail('적용할 기억 후보가 아직 없어요');
  if (!validatePendingAddition(db, chatId, id, payload)) throw fail('원문이나 연결된 기억이 바뀌어 후보를 적용할 수 없어요', 'SOURCE_CHANGED');
  db.transaction(() => {
    const candidate = ExtractionResultSchema.parse(payload.candidate);
    const owners=payload.mode === 'gap_recovery' ? recordGapBatch(db,chatId,id,payload) : undefined;
    // Only persisted new Story atoms count; selected context and skipped ledger
    // candidates must not invalidate unrelated segments.
    const tables = ['memories','memory_details','memory_dialogues','assertions','beliefs','promise_events','relationship_events'] as const;
    const before = tables.map(table => (db.prepare(`SELECT COALESCE(MAX(rowid),0) last FROM ${table}`).get() as {last:number}).last);
    if (owners) {
      const byOwner=new Map<string,typeof candidate.memories>();
      const ordinals=new Map(payload.sourceFingerprint.map(source=>[source.messageId,source.ordinal]));
      for (const memory of candidate.memories) {
        // A cross-owner memory belongs to its last cited source, so an earlier
        // prefix cannot replay an event that depends on a replaced suffix.
        const evidence=[...memory.evidence,...(memory.details ?? []).flatMap(detail=>detail.evidence),...(memory.keyDialogues ?? []).flatMap(dialogue=>dialogue.evidence ?? [])];
        const last=evidence.filter(item=>owners.has(item.messageId)).sort((a,b)=>(ordinals.get(a.messageId) ?? -1)-(ordinals.get(b.messageId) ?? -1)).at(-1)?.messageId ?? payload.sourceMessageIds.at(-1)!;
        const owner=owners.get(last);
        if (!owner) throw fail('복구 기억의 원문 소유 배치를 확인할 수 없어요','SOURCE_CHANGED');
        byOwner.set(owner,[...(byOwner.get(owner) ?? []),memory]);
      }
      for (const passage of candidate.sourcePassages ?? []) {
        const owner=owners.get(passage.messageId);
        if (owner && !byOwner.has(owner)) byOwner.set(owner,[]);
      }
      for (const [owner,memories] of byOwner) {
        // Recovery has already assigned an owner. The general additions mode
        // infers ownership from the first evidence batch and would undo it here.
        ingestExtraction(db,chatId,{...candidate,memories,sourcePassages:[]},id,owner,{sourceMessageIds:payload.sourceMessageIds,atomRefs:payload.recallAtomRefs ?? []},false,{preserveStoredCardShapes:true});
        const passages=(candidate.sourcePassages ?? []).filter(passage=>owners.get(passage.messageId)===owner);
        storeSourcePassages(db,chatId,passages,owner,payload.sourceMessageIds);
        appendGapSnapshot(db,owner,memories,passages);
      }
    } else ingestExtraction(db, chatId, candidate, id, undefined, { sourceMessageIds: payload.sourceMessageIds, atomRefs: payload.recallAtomRefs ?? [] }, 'additions', {preserveStoredCardShapes:true});
    for(const review of payload.stateReviews ?? []) recordReconciliationReview(db,chatId,id,payload.sourceMessageIds,review.entry,review.decision,UNSUPPLIED_STATE_REVIEW_REASON);
    if (payload.mode === 'gap_recovery') {
      const memories = db.prepare('SELECT id,title FROM memories WHERE chat_id=? AND rowid>? ORDER BY rowid').all(chatId,before[0]) as Array<{id:string;title:string}>;
      finishGapRecovery(db,chatId,id,payload,memories);
      return;
    }
    if (payload.smallReviewDraft) recordSmallReviews(db, chatId, id, payload.sourceMessageIds, payload.smallReviewDraft, `addition:${id}`);
    const evidenceIds = tables.flatMap((table,index) => (db.prepare(`SELECT evidence_json FROM ${table} WHERE chat_id=? AND rowid>?`)
      .all(chatId,before[index]) as Array<{evidence_json:string}>).flatMap(row =>
        (JSON.parse(row.evidence_json) as Array<{messageId:string}>).map(item => item.messageId)));
    db.prepare("UPDATE jobs SET payload_json=json_set(payload_json,'$.candidateStatus','applied'),updated_at=? WHERE id=?").run(Date.now(), id);
    markStoryRangesInvalid(db, chatId, [...new Set(evidenceIds)]);
  })();
  if (payload.mode !== 'gap_recovery') {
    flushRelationshipProjectionQueue(db, chatId);
    maybeEnqueueStorySpine(db, chatId, undefined, 'memory_addition');
  }
}

function finishGapRecovery(db: RcmDatabase, chatId: string, id: string, payload: AdditionPayload, memories:Array<{id:string;title:string}>): void {
  db.transaction(()=>{
    for (const messageId of payload.sourceMessageIds) {
      db.prepare("UPDATE messages SET extraction_state='done',updated_at=? WHERE chat_id=? AND message_id=?").run(Date.now(),chatId,messageId);
      db.prepare('DELETE FROM gap_recovery_messages WHERE chat_id=? AND message_id=?').run(chatId,messageId);
    }
    // Preserve accepted material before retiring an inherited family. Review
    // placeholders are not executable jobs; their outstanding reviews stay pending.
    for (const [retry,parent] of coverageRetryFamilies(db,chatId)) {
      const ready=db.prepare(`SELECT b.job_id FROM extraction_batches b LEFT JOIN jobs j ON j.id=b.job_id
        WHERE b.id=? AND (b.job_id IS NULL OR json_extract(j.payload_json,'$.inheritedReview')=1) AND b.status='pending_review' AND b.final_json IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM json_each(b.source_message_ids_json) s LEFT JOIN messages m ON m.chat_id=b.chat_id AND m.message_id=s.value
          WHERE m.extraction_state IS NULL OR m.extraction_state NOT IN ('done','encapsulated','skipped_policy'))`).get(retry) as {job_id:string|null}|undefined;
      if (ready) {
        if (!db.prepare("SELECT 1 FROM reconciliation_items WHERE chat_id=? AND job_id=? AND status='pending'").get(chatId,ready.job_id)) {
          db.prepare("UPDATE extraction_batches SET status='applied',updated_at=? WHERE id=?").run(Date.now(),retry);
        }
        foldCoverageRetry(db,chatId,retry,parent);
      }
    }
    finishReviewedBatches(db,chatId);
    db.prepare("UPDATE jobs SET status='done',lease_owner=NULL,leased_until=NULL,last_error=NULL,payload_json=?,updated_at=? WHERE id=?")
      .run(JSON.stringify({...payload,candidateStatus:'applied',pipelineStage:'complete',result:{memories,outcome:memories.length ? 'created' : 'nothing_to_add'}}),Date.now(),id);
  })();
}

function recordGapBatch(db:RcmDatabase,chatId:string,id:string,payload:AdditionPayload):Map<string,string> {
  const families=coverageRetryFamilies(db,chatId);
  const batches=db.prepare(`SELECT id,status,source_message_ids_json,final_json IS NOT NULL has_snapshot FROM extraction_batches
    WHERE chat_id=? AND generation_id='active' AND status<>'superseded' ORDER BY start_ordinal,id`).all(chatId) as
    Array<{id:string;status:string;source_message_ids_json:string;has_snapshot:number}>;
  // Applied NULL slices still own their sources. Keep NULL when appending a
  // partial recovery, rather than creating overlapping ownership or fake state.
  const replayable=new Set(batches.filter(batch=>batch.has_snapshot || batch.status==='applied').map(batch=>batch.id));
  const owners=new Map<string,string>();
  for (const batch of batches) {
    const owner=families.get(batch.id) ?? batch.id;
    if (!replayable.has(owner)) continue;
    for (const messageId of JSON.parse(batch.source_message_ids_json) as string[]) owners.set(messageId,owner);
  }
  for (const turn of responseTurns(rangeMessages(db,chatId,payload.sourceMessageIds))) {
    const owner=owners.get(turn.at(-1)!.id);
    if (owner) for (const source of turn) if (!owners.has(source.id)) owners.set(source.id,owner);
  }
  const ids=payload.sourceMessageIds.filter(messageId=>!owners.has(messageId));
  if (!ids.length) return owners;
  const rows=rangeMessages(db,chatId,ids);
  db.prepare(`INSERT OR IGNORE INTO extraction_batches(id,chat_id,job_id,generation_id,kind,source_message_ids_json,source_fingerprint_json,start_ordinal,end_ordinal,status,final_json,producer_event_contract,producer_state_contract,created_at,updated_at)
    VALUES(?,?,?,'active','gap_recovery',?,?,?,?,'applied',?,?,?,?,?)`).run(id,chatId,id,JSON.stringify(ids),JSON.stringify(sourceFingerprint(db,chatId,ids)),rows[0]!.ordinal,rows.at(-1)!.ordinal,JSON.stringify(ExtractionResultSchema.parse({})),payload.promptContract ?? null,payload.stateContract ?? null,Date.now(),Date.now());
  for (const messageId of ids) owners.set(messageId,id);
  return owners;
}

export function startGapRecovery(db: RcmDatabase, chatId: string) {
  assertChatUnlocked(db,chatId);
  return db.transaction(()=>{
    const chat=db.prepare('SELECT profile,memory_language FROM chats WHERE id=?').get(chatId) as {profile:RpProfile;memory_language:MemoryLanguage}|undefined;
    if (!chat) throw fail('Chat not found','CHAT_NOT_FOUND');
    const holes=gapRecoveryHoles(db,chatId);
    if (!holes.length) return {holeCount:0,messageCount:0,queuedMessages:0,jobs:[]};
    const config=JSON.parse((db.prepare("SELECT value FROM server_meta WHERE key='server_llm_config'").get() as {value:string}|undefined)?.value ?? '{}');
    const budget=Number(config.maxInputTokens ?? 80_000);
    const all=rangeMessages(db,chatId);
    const rows=all.map(row=>({message_id:row.id,role:row.role,ordinal:row.ordinal,content:row.content!,content_hash:row.canonicalHash}));
    const queued:Array<{jobId:string;hole:number;startOrdinal:number;endOrdinal:number;messageCount:number}>=[];
    for (const [holeIndex,hole] of holes.entries()) {
      const existing=db.prepare(`SELECT 1 FROM jobs j,json_each(j.payload_json,'$.sourceMessageIds') s WHERE j.chat_id=? AND j.type='memory_addition'
        AND json_extract(j.payload_json,'$.mode')='gap_recovery' AND j.status IN ('queued','leased','failed') AND s.value IN (SELECT value FROM json_each(?)) LIMIT 1`).get(chatId,JSON.stringify(hole.sourceMessageIds));
      if (existing) continue;
      const groups=adaptiveExtractionGroups(extractionUnits(rows.filter(row=>hole.sourceMessageIds.includes(row.message_id)),true),50,Math.max(512,Math.floor(budget*.65)));
      while (groups.length) {
        const group=groups.shift()!;
        const ids=group.map(row=>row.message_id);
        const processed=all.filter(row=>!row.memoryExcluded && ['done','encapsulated'].includes(row.extractionState) && ['committed','client_pruned'].includes(row.lifecycle) && ['active','all_before'].includes(row.visibility) && row.content!==null);
        const before=extractionUnits(rows.filter(row=>processed.some(p=>p.id===row.message_id) && row.ordinal<group[0]!.ordinal),true).at(-1) ?? [];
        const after=extractionUnits(rows.filter(row=>processed.some(p=>p.id===row.message_id) && row.ordinal>group.at(-1)!.ordinal),true)[0] ?? [];
        const payload: AdditionPayload={mode:'gap_recovery',memoryOnly:true,contextMessageIds:[...before,...after].map(row=>row.message_id),sourceMessageIds:ids,
          sourceFingerprint:sourceFingerprint(db,chatId,ids),rangeIds:[],userRequest:'',existingMemories:[],memoryIds:[],targetFingerprint:'',accessFingerprint:'',ledgerFingerprint:'',memoryLanguage:chat.memory_language,postExtractionReview:false};
        const id=randomUUID();
        const built=buildAdditionJob(db,id,chatId,chat.profile,1,payload,true);
        const measure=measureAuxiliaryPrompt(withAuxiliaryStoryFraming([{role:'system',content:built.systemPrompt!},{role:'user',content:built.userPrompt!}],config.relaxAuxiliaryCensorship===true),estimateTokens,{maxInputTokens:budget,maxOutputTokens:config.maxOutputTokens ?? 24_000});
        if (!measure.fits) {
          const units=extractionUnits(group,true);
          if (units.length<2) throw fail('한 응답의 복구 입력이 모델 한도를 넘어요','ATOMIC_TURN_TOO_LARGE');
          const middle=Math.ceil(units.length/2); groups.unshift(units.slice(0,middle).flat(),units.slice(middle).flat()); continue;
        }
        db.prepare("INSERT INTO jobs(id,chat_id,type,status,payload_json,created_at,updated_at) VALUES(?,?,'memory_addition','queued',?,?,?)")
          .run(id,chatId,JSON.stringify({...payload,trigger:'memory_addition',hole:holeIndex,auxiliaryBudget:{maxInputTokens:budget}}),Date.now(),Date.now());
        queued.push({jobId:id,hole:holeIndex,startOrdinal:group[0]!.ordinal,endOrdinal:group.at(-1)!.ordinal,messageCount:ids.length});
      }
    }
    return {holeCount:holes.length,messageCount:holes.reduce((n,hole)=>n+hole.sourceMessageIds.length,0),queuedMessages:queued.reduce((n,job)=>n+job.messageCount,0),jobs:queued};
  })();
}

export function listGapRecovery(db:RcmDatabase,chatId:string) {
  const turnRange = (ids: string[]) => {
    const rows = ids.length ? db.prepare(`SELECT DISTINCT completed_turn_seq seq FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?)) AND completed_turn_seq IS NOT NULL ORDER BY seq`).all(chatId, JSON.stringify(ids)) as Array<{seq:number}> : [];
    return {turnCount:rows.length,startTurn:rows[0]?.seq,endTurn:rows.at(-1)?.seq};
  };
  const holes=gapRecoveryHoles(db,chatId).map(hole => ({...hole,...turnRange(hole.sourceMessageIds)}));
  const results=(db.prepare("SELECT id,status,last_error,payload_json FROM jobs WHERE chat_id=? AND type='memory_addition' AND json_extract(payload_json,'$.mode')='gap_recovery' ORDER BY created_at,rowid").all(chatId) as Array<{id:string;status:string;last_error:string|null;payload_json:string}>).map(row=>{
    const payload=JSON.parse(row.payload_json);
    return {...turnRange(payload.sourceMessageIds),jobId:row.id,status:row.status,error:row.last_error,sourceMessageIds:payload.sourceMessageIds,startOrdinal:payload.sourceFingerprint[0]?.ordinal,endOrdinal:payload.sourceFingerprint.at(-1)?.ordinal,
      canRetry:row.status==='failed',result:payload.result ?? null};
  });
  return {holeCount:holes.length,messageCount:holes.reduce((n,hole)=>n+hole.sourceMessageIds.length,0),holes,results};
}

export function discardMemoryAddition(db: RcmDatabase, chatId: string, id: string) {
  // Also revoke a leased worker, so a late result cannot restore the candidate.
  const result = db.prepare(`UPDATE jobs SET status='superseded',lease_owner=NULL,leased_until=NULL,
    payload_json=json_remove(json_set(payload_json,'$.candidateStatus','discarded'),'$.candidate','$.continuationDraft'),updated_at=?
    WHERE id=? AND chat_id=? AND type='memory_addition' AND COALESCE(json_extract(payload_json,'$.candidateStatus'),'')<>'applied'`).run(Date.now(), id, chatId);
  if (!result.changes) throw fail('버릴 기억 후보가 없어요');
}
