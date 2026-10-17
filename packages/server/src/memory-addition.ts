import { createHash, randomUUID } from 'node:crypto';
import { MEMORY_ADDITION_GUIDANCE, memoryAdditionRequestGuidance, validateMemoryAdditionRequestOutcome, memoryAdditionUserNote, memoryAdditionStopsAfterEvents } from '@rcm/shared';
import type { RecallCandidateSnapshot } from './recall-candidates.js';
import { contiguousSourceRangeSelection, estimateTokens, ExtractionAggregateSchema, ExtractionResultSchema, Api38ExtractionDraftResultSchema, measureAuxiliaryPrompt, withAuxiliaryStoryFraming,
  type ExtractionDraftResult, type ExtractionAuditSubmission, type ReconciliationSubmission, type RpProfile, type MemoryLanguage, type LeasedJob } from '@rcm/shared';
import type { RcmDatabase } from './db.js';
import { buildPrompt, editProtectedMessageIds } from './jobs.js';
import { rangeMessages, listSourceRanges, memoryTargetFingerprint, sourceAccessFingerprint, type RangeMessage } from './source-ranges.js';
import { sourceFingerprint, fingerprintMatches, extractionContinuationProgress, type SourceFingerprintItem } from './source-fingerprint.js';
import { inspectDraftEvidence } from './evidence-review.js';
import { applyExtractionAuditPatch, recordExtractionAudit } from './extraction-audit.js';
import { finishStateExtraction } from './state-extraction.js';
import { additiveReconciliationResult } from './reconciliation.js';
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
interface AdditionPayload extends Partial<RecallCandidateSnapshot> {
  sourceMessageIds: string[]; sourceFingerprint: SourceFingerprintItem[]; rangeIds: string[];
  userRequest: string; existingMemories: any[]; memoryIds: string[]; targetFingerprint: string; accessFingerprint: string;
  memoryLanguage: MemoryLanguage; postExtractionReview: boolean; candidateStatus?: string; candidate?: any; ledgerFingerprint: string;
  continuationDraft?: ExtractionDraftResult; auxiliaryBudget?: { maxInputTokens: number };
  requestOutcome?: ExtractionDraftResult['requestOutcome'];
}

function additionLedgerFingerprint(db: RcmDatabase, chatId: string): string {
  const tables = ['assertions', 'beliefs', 'promises', 'relationship_baselines', 'relationship_events', 'physical_intimacy_milestones', 'social_knowledge_events'];
  return createHash('sha256').update(JSON.stringify(tables.map(table => db.prepare(`SELECT * FROM ${table} WHERE chat_id=? ORDER BY id`).all(chatId)))).digest('hex');
}

/** Basic extraction owns processed markers. Additions never participate in it. */
export function additionMessageReason(db: RcmDatabase, chatId: string, message: RangeMessage): string | null {
  if (message.memoryExcluded) return '기억에서 제외된 메시지예요';
  if (!['committed', 'client_pruned'].includes(message.lifecycle) || !['active', 'all_before'].includes(message.visibility)
    || message.content === null || !message.canonicalHash) return '원문을 사용할 수 없어요';
  if (!['done', 'encapsulated'].includes(message.extractionState)) return '기본 기억 처리 후 사용할 수 있어요';
  const chat = db.prepare('SELECT edit_protection_turns FROM chats WHERE id=?').get(chatId) as { edit_protection_turns: number };
  if (editProtectedMessageIds(db, chatId, chat.edit_protection_turns).has(message.id)) return '아직 수정 보호 중인 메시지예요';
  if (db.prepare(`SELECT 1 FROM extraction_batches b,json_each(b.source_message_ids_json) s
    WHERE b.chat_id=? AND b.generation_id='active' AND b.status NOT IN ('applied','superseded') AND s.value=? LIMIT 1`).get(chatId, message.id)) return '기본 기억 검수가 끝나지 않았어요';
  return null;
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
    return [{ id: row.id, key: row.memory_key, title: row.title, content: row.content, evidence: JSON.parse(row.evidence_json),
      knownBy: JSON.parse(row.known_by_json), details: details.map(d => ({ id: d.id, key: d.detail_key, text: d.text, evidence: JSON.parse(d.evidence_json) })),
      keyDialogues: dialogues.map(d => ({ text: d.text, speaker: d.speaker, evidence: JSON.parse(d.evidence_json) })) }];
  });
}

function prepareAddition(db: RcmDatabase, chatId: string, rangeIds: string[], messageIds: string[], userRequest: string, review: boolean): AdditionPayload {
  const source = additionSources(db, chatId, rangeIds);
  const rows = source.messages.filter(row => messageIds.includes(row.id));
  if (!rows.length || rows.length !== messageIds.length || new Set(messageIds).size !== messageIds.length) throw fail('사용할 메시지를 선택해 주세요');
  for (const row of rows) if (row.additionReason) throw fail(`메시지 ${row.ordinal + 1}: ${row.additionReason}`);
  const chat = db.prepare('SELECT memory_language FROM chats WHERE id=?').get(chatId) as { memory_language: MemoryLanguage };
  const existingMemories = linkedMemories(db, chatId, rows.map(row => row.id));
  const memoryIds = existingMemories.map(row => row.id);
  return { rangeIds: source.rangeIds, sourceMessageIds: rows.map(row => row.id), sourceFingerprint: sourceFingerprint(db, chatId, rows.map(row => row.id)),
    userRequest: userRequest.trim(), existingMemories, memoryIds, targetFingerprint: memoryTargetFingerprint(db, chatId, memoryIds),
    accessFingerprint: sourceAccessFingerprint(db, chatId, rows.map(row => row.id)), ledgerFingerprint: additionLedgerFingerprint(db, chatId), memoryLanguage: chat.memory_language, postExtractionReview: review };
}

export function buildAdditionJob(db: RcmDatabase, id: string, chatId: string, profile: RpProfile, attempt: number, payload: AdditionPayload): LeasedJob & RecallCandidateSnapshot {
  const allRows = rangeMessages(db, chatId);
  const rows = allRows.filter(row => payload.sourceMessageIds.includes(row.id));
  const built = buildPrompt(db, chatId, profile, payload.memoryLanguage, rows.map(row => ({ message_id: row.id, role: row.role,
    content: row.content!, content_hash: row.canonicalHash, ordinal: row.ordinal })), payload.continuationDraft?.unfinishedSource,
    payload.recallCandidates && payload.recallAtomRefs ? { recallCandidates: payload.recallCandidates, recallAtomRefs: payload.recallAtomRefs } : undefined);
  const gaps = rows.slice(1).flatMap((row, index) => allRows.some(between => !between.memoryExcluded
    && ['pending','committed','client_pruned'].includes(between.lifecycle) && ['active','all_before'].includes(between.visibility)
    && between.ordinal > rows[index]!.ordinal && between.ordinal < row.ordinal)
    ? [{ afterMessage: rows[index]!.ordinal + 1, beforeMessage: row.ordinal + 1, omitted: true }] : []);
  const memoryAddition = { userRequest: payload.userRequest, existingMemories: payload.existingMemories };
  const systemPrompt = `${built.systemPrompt}\n\n${MEMORY_ADDITION_GUIDANCE}\n${memoryAdditionRequestGuidance(payload.userRequest)}`;
  const userPrompt = `${built.userPrompt}\nADDITIVE_CONTEXT_JSON\n${JSON.stringify({ existingMemories: payload.existingMemories,
    selectedMessageNumbers: rows.map(row => ({ id: row.id, number: row.ordinal + 1 })), gaps,
    userNote: memoryAdditionUserNote(payload.userRequest) })}\nEND_ADDITIVE_CONTEXT_JSON`;
  return { ...built, id, chatId, profile, kind: 'extract', memoryAddition, attempt, systemPrompt, userPrompt, prompt: `${systemPrompt}\n\n${userPrompt}`,
    memoryLanguage: payload.memoryLanguage, sourceMessageIds: payload.sourceMessageIds, postExtractionReview: payload.postExtractionReview,
    continuationDraft: payload.continuationDraft, auditSourceMessages: rows.map(row => ({ id: row.id, role: row.role, content: row.content!, canonicalHash: row.canonicalHash })) };
}

export function previewMemoryAddition(db: RcmDatabase, chatId: string, rangeIds: string[], messageIds: string[], request: string, review: boolean) {
  const payload = prepareAddition(db, chatId, rangeIds, messageIds, request, review);
  const profile = (db.prepare('SELECT profile FROM chats WHERE id=?').get(chatId) as { profile: RpProfile }).profile;
  const job = buildAdditionJob(db, '', chatId, profile, 1, payload);
  const config = JSON.parse((db.prepare("SELECT value FROM server_meta WHERE key='server_llm_config'").get() as { value: string } | undefined)?.value ?? '{}');
  const measure = measureAuxiliaryPrompt(withAuxiliaryStoryFraming([{ role: 'system', content: job.systemPrompt! }, { role: 'user', content: job.userPrompt! }], config.relaxAuxiliaryCensorship === true), estimateTokens,
    { maxInputTokens: config.maxInputTokens ?? 80_000, maxOutputTokens: config.maxOutputTokens ?? 24_000 });
  if (!measure.fits) throw fail('선택한 원문과 기존 기억이 모델 입력 한도를 넘어요. 메시지를 줄여 주세요');
  return { rawTokens: rangeMessages(db, chatId).filter(row => messageIds.includes(row.id)).reduce((n, row) => n + estimateTokens(stripThoughtBlocks(row.content!)), 0),
    messageCount: messageIds.length, initialCalls: review ? 3 : 2, estimatedInputTokens: measure.estimatedInputTokens,
    note: '사건·상태 추출 기준이며, 보완·재시도·후속 투영 호출은 추가될 수 있어요.' };
}

export function startMemoryAddition(db: RcmDatabase, chatId: string, rangeIds: string[], messageIds: string[], request: string, review: boolean, idempotencyKey?:string) {
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
  const job = db.prepare("SELECT chat_id,payload_json FROM jobs WHERE id=? AND type='memory_addition' AND status='leased' AND lease_owner=?").get(jobId, workerId) as { chat_id: string; payload_json: string } | undefined;
  if (!job) throw fail('Lease not found', 'LEASE_NOT_FOUND');
  const payload: AdditionPayload = JSON.parse(job.payload_json);
  if (!validatePendingAddition(db, job.chat_id, jobId, payload)) return { chatId: job.chat_id, warnings: ['원문 변경으로 후보를 중단했어요'], pendingReconciliations: 0 };
  let draft = validateMemoryAdditionRequestOutcome(ExtractionAggregateSchema.parse(value), payload.userRequest);
  Api38ExtractionDraftResultSchema.parse({ language: draft.language, memories: draft.memories, sourcePassages: draft.sourcePassages, unfinishedSource: draft.unfinishedSource, requestOutcome: draft.requestOutcome });
  if (draft.unfinishedSource?.length) {
    const {progress} = extractionContinuationProgress(db,job.chat_id,payload.sourceMessageIds,payload.continuationDraft?.unfinishedSource,draft.unfinishedSource);
    const reason = progress ? null : 'CONTINUATION_NO_PROGRESS: 남은 원문 범위가 줄지 않아 중단했어요. 선택을 줄여 다시 요청해 주세요';
    db.prepare("UPDATE jobs SET status=?,attempts=CASE WHEN ? THEN 0 ELSE attempts END,lease_owner=NULL,leased_until=NULL,last_error=?,payload_json=?,updated_at=? WHERE id=?")
      .run(progress ? 'queued' : 'failed',Number(progress),reason,JSON.stringify({ ...payload, continuationDraft: draft,
        pipelineStage:progress?'queued':'failed',validatedExtractionCheckpoint:undefined,validatedPreReconciliationCheckpoint:undefined }),Date.now(),jobId);
    return { chatId: job.chat_id, warnings: [reason ?? '같은 작업에서 남은 원문을 이어서 읽어요'], pendingReconciliations: 0 };
  }
  if (memoryAdditionStopsAfterEvents(draft)) {
    if (draft.requestOutcome?.relatedMemoryIds?.some(id => !payload.memoryIds.includes(id))) throw fail('요청 결과가 제공되지 않은 기억을 가리켜요');
    const refused = Boolean(payload.userRequest && !draft.requestOutcome);
    const error = refused ? '모델이 요청을 처리하지 않았어요. 추가 검열 완화 (실험적)를 켜고 새로 요청해 보세요.' : null;
    db.prepare("UPDATE jobs SET status=?,lease_owner=NULL,leased_until=NULL,last_error=?,payload_json=?,updated_at=? WHERE id=?")
      .run(refused ? 'failed' : 'done', error, JSON.stringify({ ...payload, candidate: undefined, continuationDraft: undefined,
        validatedExtractionCheckpoint: undefined, validatedPreReconciliationCheckpoint: undefined,
        candidateStatus: refused ? undefined : 'empty', requestOutcome: draft.requestOutcome, pipelineStage: refused ? 'failed' : 'complete' }), Date.now(), jobId);
    return { chatId: job.chat_id, warnings: error ? [error] : [], pendingReconciliations: 0 };
  }
  if (payload.postExtractionReview && (!audit?.patch || audit.error)) throw fail('요청한 추출 검수를 끝내지 못했어요');
  if (audit?.patch) {
    const reviewed = applyExtractionAuditPatch(db, job.chat_id, payload.sourceMessageIds, draft, audit.patch);
    if (reviewed.pendingRefs.length) throw fail('기억 근거 검수가 끝나지 않았어요');
    draft = reviewed.result;
  }
  const completed = finishStateExtraction(db, job.chat_id, payload.sourceMessageIds, draft, reconciliation,
    payload.auxiliaryBudget?.maxInputTokens ?? 80_000, { userRequest: payload.userRequest, existingMemories: payload.existingMemories });
  draft = completed.draft;
  const issues = inspectDraftEvidence(db, job.chat_id, payload.sourceMessageIds, draft);
  if (issues.length) throw fail(`기억 근거를 확인할 수 없어요: ${issues.slice(0, 3).map(issue => `${issue.path}: ${issue.reason}`).join('; ')}`);
  const final = canonicalizeExtraction(db, job.chat_id, additiveReconciliationResult(draft, completed.reconciliation), payload.sourceMessageIds);
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
    return intimacyMilestoneKeys(item.act).some(key => !db.prepare('SELECT 1 FROM physical_intimacy_milestones WHERE chat_id=? AND participant_a=? AND participant_b=? AND milestone_key=?').get(job.chat_id,a,b,key));
  });
  const memoryKeys = new Set(final.memories.map(memory => memory.key));
  const checkNewParent = (item: { memoryKey?: string }) => { if (item.memoryKey && !memoryKeys.has(item.memoryKey)) throw fail('추가 후보는 기존 기억을 수정 대상으로 지정할 수 없어요'); };
  [...final.promises, ...(final.socialKnowledge ?? []), ...(final.relationshipEvents ?? []), ...(final.physicalIntimacy ?? [])].forEach(checkNewParent);
  for (const memory of payload.userRequest ? [] : final.memories) {
    const duplicate = payload.existingMemories.some(existing => normalizeLedgerText(existing.content) === normalizeLedgerText(memory.content)
      && (memory.details ?? []).every(detail => existing.details.some((old: any) => normalizeLedgerText(old.text) === normalizeLedgerText(detail.text)))
      && (memory.keyDialogues ?? []).every(dialogue => existing.keyDialogues.some((old: any) => old.text === dialogue.text && old.speaker === dialogue.speaker)));
    if (duplicate) throw fail('기존 기억과 같은 후보가 반환됐어요. 빠진 내용을 더 구체적으로 요청해 주세요');
  }
  const candidate = validateDialogueEvidence(db, job.chat_id, payload.sourceMessageIds,
    scopeExtractionMemoryKeys(final, `addition:${jobId}`));
  const errors = validateExtractionSources(db, job.chat_id, payload.sourceMessageIds, candidate);
  if (errors.length) throw fail(errors.join('; '));
  db.prepare("UPDATE jobs SET status='done',lease_owner=NULL,leased_until=NULL,last_error=NULL,payload_json=?,updated_at=? WHERE id=?")
    .run(JSON.stringify({ ...payload, candidateStatus: 'ready', candidate, pipelineStage: 'complete' }), Date.now(), jobId);
  if (completed.recognitionReviewDraft) recordExtractionAudit(db, job.chat_id, jobId, payload.sourceMessageIds, completed.recognitionReviewDraft,
    audit, 'pending_review', completed.recognitionIssues.map(issue => `socialKnowledge[${issue.index}]: ${issue.reason}`).join('; '), payload.sourceFingerprint);
  return { chatId: job.chat_id, warnings: completed.recognitionIssues.length ? ['접근 권한이 없는 인지 연결을 제외하고 원래 후보를 검토 상태로 보존했습니다.'] : [], pendingReconciliations: completed.recognitionIssues.length };
}

export function listMemoryAdditions(db: RcmDatabase, chatId: string) {
  return (db.prepare("SELECT id,status,payload_json,last_error FROM jobs WHERE chat_id=? AND type='memory_addition' ORDER BY created_at DESC,id").all(chatId) as any[]).flatMap(row => {
    const payload: AdditionPayload = JSON.parse(row.payload_json);
    if (['applied', 'discarded'].includes(payload.candidateStatus ?? '')) return [];
    if (!payload.candidateStatus && !validatePendingAddition(db, chatId, row.id, payload)) payload.candidateStatus = 'stale';
    if (payload.candidateStatus === 'ready' && !validatePendingAddition(db, chatId, row.id, payload)) payload.candidateStatus = 'stale';
    return [{ id: row.id, jobId: row.id, status: payload.candidateStatus ?? (row.status === 'failed' ? 'failed' : 'processing'),
      error: row.last_error, request: payload.userRequest, requestOutcome: payload.requestOutcome, candidate: payload.candidate, sourceFingerprint: payload.sourceFingerprint,
      canRetry: row.status === 'failed' && payload.candidateStatus !== 'stale' }];
  });
}

export function applyMemoryAddition(db: RcmDatabase, chatId: string, id: string) {
  const row = db.prepare("SELECT payload_json FROM jobs WHERE id=? AND chat_id=? AND type='memory_addition'").get(id, chatId) as { payload_json: string } | undefined;
  if (!row) throw fail('기억 추가 작업을 찾을 수 없어요');
  const payload: AdditionPayload = JSON.parse(row.payload_json);
  if (payload.candidateStatus === 'applied') return;
  if (payload.candidateStatus !== 'ready' || !payload.candidate) throw fail('적용할 기억 후보가 아직 없어요');
  if (!validatePendingAddition(db, chatId, id, payload)) throw fail('원문이나 연결된 기억이 바뀌어 후보를 적용할 수 없어요', 'SOURCE_CHANGED');
  db.transaction(() => {
    const candidate = ExtractionResultSchema.parse(payload.candidate);
    // Only persisted new Story atoms count; selected context and skipped ledger
    // candidates must not invalidate unrelated segments.
    const tables = ['memories','memory_details','memory_dialogues','assertions','beliefs','promise_events','relationship_events'] as const;
    const before = tables.map(table => (db.prepare(`SELECT COALESCE(MAX(rowid),0) last FROM ${table}`).get() as {last:number}).last);
    ingestExtraction(db, chatId, candidate, id, undefined, { sourceMessageIds: payload.sourceMessageIds, atomRefs: payload.recallAtomRefs ?? [] }, 'additions');
    const evidenceIds = tables.flatMap((table,index) => (db.prepare(`SELECT evidence_json FROM ${table} WHERE chat_id=? AND rowid>?`)
      .all(chatId,before[index]) as Array<{evidence_json:string}>).flatMap(row =>
        (JSON.parse(row.evidence_json) as Array<{messageId:string}>).map(item => item.messageId)));
    db.prepare("UPDATE jobs SET payload_json=json_set(payload_json,'$.candidateStatus','applied'),updated_at=? WHERE id=?").run(Date.now(), id);
    markStoryRangesInvalid(db, chatId, [...new Set(evidenceIds)]);
  })();
  flushRelationshipProjectionQueue(db, chatId);
  maybeEnqueueStorySpine(db, chatId, undefined, 'memory_addition');
}

export function discardMemoryAddition(db: RcmDatabase, chatId: string, id: string) {
  // Also revoke a leased worker, so a late result cannot restore the candidate.
  const result = db.prepare(`UPDATE jobs SET status='superseded',lease_owner=NULL,leased_until=NULL,
    payload_json=json_remove(json_set(payload_json,'$.candidateStatus','discarded'),'$.candidate','$.continuationDraft'),updated_at=?
    WHERE id=? AND chat_id=? AND type='memory_addition' AND COALESCE(json_extract(payload_json,'$.candidateStatus'),'')<>'applied'`).run(Date.now(), id, chatId);
  if (!result.changes) throw fail('버릴 기억 후보가 없어요');
}
