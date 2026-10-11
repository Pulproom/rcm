import { maybeEnqueueQuiz } from "./quiz.js";
import { ExtractionAggregateSchema, validSourcePassageAccess, validateSourceRecoveryPatch } from "@rcm/shared";
import { randomUUID } from "node:crypto";
import { storeSourcePassages } from "./source-evidence.js";
import { ExtractionDraftResultSchema, ExtractionResultSchema, type ExtractionAuditSubmission, type ExtractionDraftResult, type ReconciliationSubmission, type StructuredIssue } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { applyMemoryRecallObservations, dedupeKeyDialogues, ingestExtraction, validateDialogueEvidence, normalizePromiseMemoryAssociations, replaceItemAccess, validateExtractionSources } from "./ingest.js";
import { markJobComplete } from "./jobs.js";
import { applyExtractionAuditPatch, recordExtractionAudit } from "./extraction-audit.js";
import { socialOnlyResult } from "./social-knowledge.js";
import { flushRelationshipProjectionQueue, queueLaggingRelationshipProjections } from "./relationship-projections.js";
import { fingerprintMatches, type SourceFingerprintItem } from "./source-fingerprint.js";
import { lockInitialCalibration } from "./initial-calibration.js";
import { maybeEnqueueStorySpine } from "./story-spine.js";
import { applyReconciliation, prepareReconciliation } from "./reconciliation.js";
import { enqueueFinalLedgerConsistency } from "./ledger-consistency.js";
import { inspectDraftEvidence } from "./evidence-review.js";
import { refreshMemoryFts } from "./memory-search-document.js";
import { canonicalizeExtraction } from "./entities.js";
import type { RecallAtomReference } from "./atom-relations.js";
import { scopeExtractionMemoryKeys } from "./extraction-memory-keys.js";
import { finishStateExtraction, usesStateExtraction } from "./state-extraction.js";

export interface DialogueRecoveryCandidate {
  /** A stable key for one frozen candidate, independent of repaired source IDs. */
  ref: string;
  parentMemoryId?: string;
  dialogue: NonNullable<ExtractionDraftResult["memories"][number]["keyDialogues"]>[number];
}

export class ExtractionValidationError extends Error {
  readonly code = "EXTRACTION_SOURCE_INVALID";
  readonly summary = "기억 후보의 필수 출처를 확인할 수 없어 작업을 저장하지 못했습니다.";
  readonly issues: StructuredIssue[];

  constructor(messages: string[]) {
    super(`Extraction source validation failed: ${messages.slice(0, 8).join("; ")}`);
    this.issues = messages.slice(0, 20).map((message) => ({ kind: "source_validation", message }));
  }
}

export function completeExtractionJob(
  db: RcmDatabase,
  jobId: string,
  workerId: string,
  result: ExtractionDraftResult,
  reconciliation?: ReconciliationSubmission,
  audit?: ExtractionAuditSubmission,
): { chatId: string; warnings: string[]; pendingReconciliations: number } {
  const job = db.prepare("SELECT chat_id,type,payload_json FROM jobs WHERE id=? AND lease_owner=? AND status='leased'").get(jobId, workerId) as
    | { chat_id: string; type: string; payload_json: string }
    | undefined;
  if (!job) throw Object.assign(new Error("Lease not found"), { code: "LEASE_NOT_FOUND" });
  const payload = JSON.parse(job.payload_json) as { sourceMessageIds?: string[]; sourceFingerprint?: SourceFingerprintItem[]; resolvedSetup?: { messages?: Array<{ content: string }> }; postExtractionReview?: boolean; sourceRecovery?: boolean; dialogueRecovery?: DialogueRecoveryCandidate[]; retryOfAuditId?: string; retryOfJobId?: string; continuationDraft?: ExtractionDraftResult; continuationHistory?: string[]; batchId?: string; regenerationRunId?: string; backfillRunId?: string; recallCandidates?: Array<{ memoryId: string; accessibleTo: string[] }>; recallAtomRefs?: RecallAtomReference[] };
  if (payload.regenerationRunId) {
    const run = db.prepare("SELECT status FROM regeneration_runs WHERE id=? AND chat_id=?").get(payload.regenerationRunId, job.chat_id) as { status: string } | undefined;
    if (!run || !['queued', 'processing'].includes(run.status)) throw new Error("Regeneration candidate is no longer accepting results");
  }
  const sourceMessageIds = payload.sourceMessageIds ?? [];
  if (payload.sourceFingerprint?.length && !fingerprintMatches(db, job.chat_id, payload.sourceFingerprint)) {
    db.transaction(() => {
      db.prepare("UPDATE extraction_audits SET status='stale',error='Source fingerprint changed',updated_at=? WHERE job_id=?").run(Date.now(), jobId);
      db.prepare("UPDATE jobs SET status='done',lease_owner=NULL,leased_until=NULL,last_error='Source fingerprint changed before completion',updated_at=? WHERE id=?").run(Date.now(), jobId);
      if (payload.regenerationRunId) db.prepare("UPDATE regeneration_runs SET status='stale',error='Source fingerprint changed',updated_at=? WHERE id=?").run(Date.now(), payload.regenerationRunId);
      else for (const id of sourceMessageIds) db.prepare("UPDATE messages SET extraction_state=CASE WHEN host_visibility IN ('active','all_before') THEN 'pending' ELSE 'blocked' END,updated_at=? WHERE chat_id=? AND message_id=?").run(Date.now(), job.chat_id, id);
    })();
    return { chatId: job.chat_id, warnings: ["원문이 변경되어 오래된 추출·검수 결과를 적용하지 않았습니다."], pendingReconciliations: 0 };
  }
  if (sourceMessageIds.length > 0) {
    const placeholders = sourceMessageIds.map(() => "?").join(",");
    const current = db.prepare(`SELECT message_id,host_visibility,extraction_state FROM messages WHERE chat_id=? AND message_id IN (${placeholders})`)
      .all(job.chat_id, ...sourceMessageIds) as Array<{ message_id: string; host_visibility: string; extraction_state: string }>;
    const changed = current.length !== sourceMessageIds.length || current.some((message) => !["active", "all_before"].includes(message.host_visibility) || message.extraction_state === "held" || message.extraction_state === "excluded_episode");
    if (changed) {
      db.transaction(() => {
        db.prepare("UPDATE jobs SET status='done',lease_owner=NULL,leased_until=NULL,last_error='Source visibility changed before completion',updated_at=? WHERE id=?").run(Date.now(), jobId);
        if (payload.regenerationRunId) db.prepare("UPDATE regeneration_runs SET status='stale',error='Source visibility changed',updated_at=? WHERE id=?").run(Date.now(), payload.regenerationRunId);
        else for (const message of current) {
          const next = !["active", "all_before"].includes(message.host_visibility) ? "blocked" : message.extraction_state === "held" ? "held" : message.extraction_state === "excluded_episode" ? "excluded_episode" : "pending";
          db.prepare("UPDATE messages SET extraction_state=?,updated_at=? WHERE chat_id=? AND message_id=?").run(next, Date.now(), job.chat_id, message.message_id);
        }
      })();
      return { chatId: job.chat_id, warnings: ["원문 가시성이 바뀌어 오래된 추출 결과를 저장하지 않았습니다."], pendingReconciliations: 0 };
    }
  }
  const original = ExtractionAggregateSchema.parse(payload.regenerationRunId ? {
    ...result, entities: [], stateObservations: [], relationshipEvents: [], socialKnowledge: [],
    relationshipBaselines: [], physicalIntimacy: [], memoryRecallObservations: [],
  } : result);
  if (payload.postExtractionReview && (!audit?.patch || audit.error) && !original.unfinishedSource?.length) {
    throw new Error(audit?.error ? `Extraction audit failed: ${audit.error}` : "Worker did not provide the requested extraction audit");
  }
  if (payload.sourceRecovery && audit?.patch) validateSourceRecoveryPatch(audit.patch, original);
  const reviewed = audit?.patch ? applyExtractionAuditPatch(db, job.chat_id, sourceMessageIds, original, audit.patch) : { result: original, pendingRefs: [] as string[] };
  let submitted = reviewed.result;
  const budgetPayload = payload as typeof payload & { auxiliaryBudget?: { maxInputTokens?: number }; serverLlmSnapshot?: { maxInputTokens?: number } };
  const reconciliationBudget = Number(budgetPayload.auxiliaryBudget?.maxInputTokens ?? budgetPayload.serverLlmSnapshot?.maxInputTokens ?? 80_000);
  if (usesStateExtraction(job.type, payload) && !submitted.unfinishedSource?.length && !reviewed.pendingRefs.length
    && !inspectDraftEvidence(db, job.chat_id, sourceMessageIds, submitted).some(issue => issue.blocking)) {
    const completed = finishStateExtraction(db, job.chat_id, sourceMessageIds, submitted, reconciliation, reconciliationBudget);
    submitted = completed.draft;
    reconciliation = completed.reconciliation;
  }
  const evidenceIssues = inspectDraftEvidence(db, job.chat_id, sourceMessageIds, submitted);
  const statePreparation = prepareReconciliation(db, job.chat_id, submitted, reconciliationBudget);
  const unsafeStateDecision = reconciliation?.result?.decisions.some((decision) => statePreparation.items.some((entry) =>
    entry.itemRef === decision.itemRef && entry.candidates.some((candidate) => candidate.immutable && decision.targetIds.includes(candidate.id))));
  if (evidenceIssues.some((issue) => issue.blocking) || reviewed.pendingRefs.some((ref) => !ref.startsWith("dialogue:") && !ref.startsWith("source:") && !ref.startsWith("relation:")) || statePreparation.deferred.length || unsafeStateDecision) {
    db.transaction(() => {
      recordExtractionAudit(db, job.chat_id, jobId, sourceMessageIds, submitted, audit, "pending_review", "Cumulative state evidence requires review", payload.sourceFingerprint);
      db.prepare("UPDATE jobs SET status='failed',payload_json=?,lease_owner=NULL,leased_until=NULL,last_error='Cumulative state evidence requires review',updated_at=? WHERE id=?")
        .run(JSON.stringify({ ...payload, evidenceBlocked: true, evidenceIssues, stagedDraft: submitted }), Date.now(), jobId);
      if (payload.regenerationRunId) db.prepare("UPDATE regeneration_runs SET status='failed',error='Candidate evidence requires review',updated_at=? WHERE id=?").run(Date.now(), payload.regenerationRunId);
      else if (payload.batchId) db.prepare("UPDATE extraction_batches SET status='pending_review',draft_json=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(submitted), Date.now(), payload.batchId);
    })();
    return { chatId: job.chat_id, warnings: ["상태 근거를 확인할 수 없어 해당 채팅의 후속 기억 처리를 보류했습니다."], pendingReconciliations: 1 };
  }
  const exactRange = (range: { messageId: string; quote: string; startOffset?: number }): boolean => {
    if (!sourceMessageIds.includes(range.messageId)) return false;
    const source = db.prepare("SELECT canonical_content FROM messages WHERE chat_id=? AND message_id=?").get(job.chat_id, range.messageId) as { canonical_content: string } | undefined;
    return Boolean(source?.canonical_content?.includes(range.quote)) && (range.startOffset === undefined || source!.canonical_content.slice(range.startOffset, range.startOffset + range.quote.length) === range.quote);
  };
  // A bad optional excerpt must not discard independently validated memories.
  // Keep the unmodified submission in review; only exact in-job excerpts may reach ingestion.
  const passageSources = new Map(sourceMessageIds.map((id) => [id, (db.prepare("SELECT canonical_content FROM messages WHERE chat_id=? AND message_id=?").get(job.chat_id, id) as { canonical_content: string } | undefined)?.canonical_content ?? ""]));
  const validPassages = (submitted.sourcePassages ?? []).flatMap((passage, index) => {
    if (!exactRange(passage) || evidenceIssues.some((issue) => issue.path === `sourcePassages[${index}]`)) return [];
    const access = validSourcePassageAccess(passage, passageSources, passage.access);
    return access.length ? [{ ...passage, access }] : [];
  });
  const rejectedPassages = (submitted.sourcePassages?.length ?? 0) - validPassages.length;
  const rejectedAccessGrants = evidenceIssues.filter((issue) => /^(?:sourcePassages\[\d+\]\.access\[\d+\]|sourceFieldReviews\[\d+\])$/.test(issue.path)
    && issue.reason === "access_unverified").length;
  const rejectedDialogues = submitted.memories.reduce((sum, memory, index) => sum + (memory.keyDialogues ?? []).filter((_dialogue, dialogueIndex) =>
    evidenceIssues.some((issue) => issue.path.startsWith(`memories[${index}].keyDialogues[${dialogueIndex}]`))).length, 0);
  const rejectedExcerpts = rejectedPassages + rejectedAccessGrants + rejectedDialogues;
  const sourceReviewSummary = [
    rejectedPassages + rejectedDialogues ? `${rejectedPassages + rejectedDialogues} source excerpts` : undefined,
    rejectedAccessGrants ? `${rejectedAccessGrants} access grants` : undefined,
  ].filter(Boolean).join(" and ");
  const input = { ...submitted, sourcePassages: validPassages,
    memories: submitted.memories.map((memory, index) => ({ ...memory, keyDialogues: (memory.keyDialogues ?? []).filter((_dialogue, dialogueIndex) =>
      !evidenceIssues.some((issue) => issue.path.startsWith(`memories[${index}].keyDialogues[${dialogueIndex}]`))) })) };
  const episodicDraft = ExtractionResultSchema.parse({
    language: input.language, entities: input.entities, memories: input.memories,
    relationshipEvents: input.relationshipEvents, socialKnowledge: input.socialKnowledge,
    relationshipBaselines: input.relationshipBaselines, physicalIntimacy: input.physicalIntimacy,
    memoryRecallObservations: input.memoryRecallObservations, sourcePassages: input.sourcePassages,
    atomRelations: input.atomRelations,
  });
  const normalizedEpisodic = normalizePromiseMemoryAssociations(db, job.chat_id,
    validateDialogueEvidence(db, job.chat_id, sourceMessageIds, job.type === "social_backfill" ? socialOnlyResult(episodicDraft) : episodicDraft));
  const observationEvidenceErrors = input.stateObservations.flatMap((observation) => observation.evidence
    .filter((evidence) => !sourceMessageIds.includes(evidence.messageId))
    .map((evidence) => `state observation ${observation.key} cites a message outside this extraction job: ${evidence.messageId}`));
  const rangeErrors = (input.unfinishedSource ?? []).flatMap((range) => exactRange(range) ? [] : ["Invalid exact source range"]);
  const validationErrors = [...rangeErrors, ...validateExtractionSources(db, job.chat_id, sourceMessageIds, normalizedEpisodic.result), ...observationEvidenceErrors];
  if (validationErrors.length) throw new ExtractionValidationError(validationErrors);
  if (input.unfinishedSource?.length) {
    const signature = JSON.stringify([...input.unfinishedSource].sort((a, b) => a.messageId.localeCompare(b.messageId) || a.quote.localeCompare(b.quote)));
    const history = payload.continuationHistory ?? [];
    const previousSize = (payload.continuationDraft?.unfinishedSource ?? []).reduce((sum, range) => sum + range.quote.length, 0);
    const remainingSize = input.unfinishedSource.reduce((sum, range) => sum + range.quote.length, 0);
    const stalled = history.includes(signature) || (previousSize > 0 && remainingSize >= previousSize);
    const next = { ...payload, continuationDraft: submitted, continuationHistory: [...history, signature] };
    db.transaction(() => {
      db.prepare("UPDATE jobs SET payload_json=?,status=?,attempts=0,lease_owner=NULL,leased_until=NULL,last_error=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(next), stalled ? "failed" : "queued", stalled ? "Extraction continuation made no progress; review required" : null, Date.now(), jobId);
      if (payload.regenerationRunId && stalled) db.prepare("UPDATE regeneration_runs SET status='failed',error='Continuation made no progress',updated_at=? WHERE id=?").run(Date.now(), payload.regenerationRunId);
      if (payload.batchId && !payload.regenerationRunId) db.prepare("UPDATE extraction_batches SET draft_json=?,status=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(submitted), stalled ? "pending_review" : "processing", Date.now(), payload.batchId);
      if (stalled) recordExtractionAudit(db, job.chat_id, jobId, sourceMessageIds, submitted, undefined, "pending_review", "Continuation made no progress", payload.sourceFingerprint);
    })();
    return { chatId: job.chat_id, warnings: [stalled ? "미완료 구간이 줄지 않아 검토가 필요합니다." : "남은 원문 범위를 이어서 처리합니다."], pendingReconciliations: stalled ? 1 : 0 };
  }
  let pendingReconciliations = 0;
  db.transaction(() => {
    if (payload.postExtractionReview && (!audit?.patch || audit.error)) {
      throw new Error(audit?.error ? `Extraction audit failed: ${audit.error}` : "Worker did not provide the requested extraction audit");
    }
    let audited: { result: ExtractionDraftResult; pendingRefs: string[] };
    audited = { result: input, pendingRefs: reviewed.pendingRefs };
    if (payload.sourceRecovery) {
      const passages = audited.result.sourcePassages ?? [];
      if (passages.some((item) => !sourceMessageIds.includes(item.messageId))) throw new Error("Recovery passage cites a source outside this job");
      storeSourcePassages(db, job.chat_id, passages, payload.batchId, sourceMessageIds);
      let unresolvedDialogues = 0;
      const pendingDialogues: DialogueRecoveryCandidate[] = [];
      for (const recovery of payload.dialogueRecovery ?? []) {
        const frozen = original.memories.find(memory => memory.key === recovery.ref)?.keyDialogues?.[0];
        const itemRef = frozen && `dialogue:${recovery.ref}:${frozen.messageId}:0`;
        if (itemRef && audit?.patch?.discardItemRefs.includes(itemRef)) continue;
        const memory = audited.result.memories.find(item => item.key === recovery.ref);
        const candidate = memory?.keyDialogues?.[0];
        const parent = recovery.parentMemoryId && db.prepare("SELECT m.id,m.known_by_json,c.revision FROM memories m JOIN chats c ON c.id=m.chat_id WHERE m.chat_id=? AND m.id=? AND m.active=1")
          .get(job.chat_id, recovery.parentMemoryId) as {id: string; known_by_json: string; revision: number} | undefined;
        if (!candidate || !parent || candidate.text !== recovery.dialogue.text || candidate.speaker !== recovery.dialogue.speaker || candidate.kind !== recovery.dialogue.kind) {
          unresolvedDialogues++;
          pendingDialogues.push(recovery);
          continue;
        }
        // Match frozen identity before the same entity canonicalization used at ingestion.
        const canonical = canonicalizeExtraction(db, job.chat_id, ExtractionResultSchema.parse({language: input.language, memories: [memory]}))
          .memories[0]!.keyDialogues![0]!;
        const evidenceJson = JSON.stringify(canonical.evidence);
        const existing = db.prepare("SELECT id FROM memory_dialogues WHERE memory_id=? AND speaker=? AND text=? AND kind=? AND evidence_json=?")
          .get(parent.id, canonical.speaker, canonical.text, canonical.kind, evidenceJson) as {id: string} | undefined;
        const dialogueId = existing?.id ?? randomUUID();
        if (!existing) {
          const ordinal = (db.prepare("SELECT COALESCE(MAX(ordinal),-1)+1 AS value FROM memory_dialogues WHERE memory_id=?").get(parent.id) as {value: number}).value;
          db.prepare("INSERT INTO memory_dialogues(id,chat_id,memory_id,speaker,text,message_id,evidence_json,kind,ordinal,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
            .run(dialogueId, job.chat_id, parent.id, canonical.speaker, canonical.text, canonical.messageId, evidenceJson, canonical.kind, ordinal, Date.now());
        }
        const grants = canonical.access ?? (JSON.parse(parent.known_by_json) as string[])
          .map(holder => ({holder, basis: "witnessed", evidence: canonical.evidence, confidence: 1}));
        replaceItemAccess(db, job.chat_id, "dialogue", dialogueId, grants, parent.revision, Date.now());
        refreshMemoryFts(db, parent.id);
      }
      const explicitlyDiscarded = Boolean(audit?.patch?.discardItemRefs.some(ref => ref.startsWith("source:")));
      const noExcerptSelected = passages.length === 0 && (original.sourcePassages ?? []).length === 0
        && payload.postExtractionReview === true && Boolean(audit?.patch);
      const verified = unresolvedDialogues === 0 && !reviewed.pendingRefs.length && !rejectedExcerpts
        && (passages.length > 0 || explicitlyDiscarded || noExcerptSelected)
        && passages.every(passage => Boolean(db.prepare(`SELECT 1 FROM source_passages p JOIN messages m ON m.chat_id=p.chat_id AND m.message_id=p.message_id AND m.canonical_hash=p.canonical_hash
          WHERE p.chat_id=? AND p.message_id=? AND p.quote=? AND p.active=1 AND json_array_length(p.access_json)>0 LIMIT 1`).get(job.chat_id, passage.messageId, passage.quote)));
      // Keep the pre-audit candidates for another attempt, with each stable parent mapping.
      // A failed dialogue must never be converted to a passage or silently disappear.
      const retained = verified ? audited.result : original;
      if (!verified && payload.dialogueRecovery?.length) {
        const retainedKeys = new Set(pendingDialogues.map(item => item.ref));
        retained.memories = retained.memories.filter(memory => retainedKeys.has(memory.key));
        db.prepare("UPDATE jobs SET payload_json=? WHERE id=?").run(JSON.stringify({...payload, dialogueRecovery: pendingDialogues}), jobId);
      }
      recordExtractionAudit(db, job.chat_id, jobId, sourceMessageIds, retained, audit, verified ? "applied" : "pending_review",
        verified ? undefined : "Source or dialogue evidence remains unverified", payload.sourceFingerprint);
      pendingReconciliations = verified ? 0 : Math.max(1, unresolvedDialogues + rejectedExcerpts + reviewed.pendingRefs.length);
      if (verified) markJobComplete(db, jobId, workerId);
      else db.prepare("UPDATE jobs SET status='failed',lease_owner=NULL,leased_until=NULL,last_error='Source or dialogue evidence remains unverified; review required',updated_at=? WHERE id=?")
        .run(Date.now(), jobId);
      return;
    }
    if (audit?.patch && !rejectedExcerpts) recordExtractionAudit(db, job.chat_id, jobId, sourceMessageIds, audited.pendingRefs.length ? original : input, audit, audited.pendingRefs.length ? "pending_review" : "applied", undefined, payload.sourceFingerprint);
    pendingReconciliations = audited.pendingRefs.length;
    if (rejectedExcerpts) {
      recordExtractionAudit(db, job.chat_id, jobId, sourceMessageIds, submitted, audit, "pending_review",
        `${sourceReviewSummary} could not be verified; valid memories retained`, payload.sourceFingerprint);
      pendingReconciliations += rejectedExcerpts;
    }
    if (payload.regenerationRunId) {
      const timeline = ExtractionResultSchema.parse({ language: audited.result.language, memories: audited.result.memories, sourcePassages: audited.result.sourcePassages, atomRelations: audited.result.atomRelations });
      const previous = payload.batchId ? db.prepare("SELECT final_json FROM extraction_batches WHERE id=? AND chat_id=?").get(payload.batchId, job.chat_id) as { final_json: string | null } | undefined : undefined;
      const before = previous?.final_json ? ExtractionResultSchema.parse(JSON.parse(previous.final_json)) : undefined;
      const summarize = (value?: { memories: typeof timeline.memories }) => ({ memories: value?.memories.length ?? 0, details: value?.memories.reduce((sum, memory) => sum + (memory.details?.length ?? 0), 0) ?? 0, dialogues: value?.memories.reduce((sum, memory) => sum + (memory.keyDialogues?.length ?? 0), 0) ?? 0 });
      const guard = JSON.parse((db.prepare("SELECT preview_json FROM regeneration_runs WHERE id=?").get(payload.regenerationRunId) as { preview_json: string }).preview_json);
      db.prepare("UPDATE regeneration_runs SET status='ready',preview_json=?,error=NULL,updated_at=? WHERE id=?").run(JSON.stringify({ ...guard, afterCurrentMemories: timeline.memories.map((memory, index) => ({ ...memory, key: guard.beforeCurrentMemories[index]?.key ?? `batch:${payload.batchId}:${index + 1}` })), before: before ? ExtractionResultSchema.parse({ language: before.language, memories: before.memories }) : null, after: timeline, counts: { before: summarize(before), after: summarize(timeline) } }), Date.now(), payload.regenerationRunId);
      if (!markJobComplete(db, jobId, workerId)) throw new Error("Lease not found while staging episode regeneration");
      return;
    }
    const reconciled = applyReconciliation(db, job.chat_id, jobId, sourceMessageIds, audited.result, reconciliation);
    pendingReconciliations += reconciled.pending;
    const scoped = scopeExtractionMemoryKeys(dedupeKeyDialogues(job.type === "social_backfill" ? socialOnlyResult(reconciled.result) : reconciled.result),
      payload.batchId ?? payload.retryOfJobId ?? jobId);
    const normalized = normalizePromiseMemoryAssociations(db, job.chat_id, scoped);
    const storedResult = validateDialogueEvidence(db, job.chat_id, sourceMessageIds, normalized.result);
    const finalValidationErrors = validateExtractionSources(db, job.chat_id, sourceMessageIds, storedResult);
    for (const memory of storedResult.memories) {
      const existing = db.prepare("SELECT source_batch_id,user_managed FROM memories WHERE chat_id=? AND memory_key=?")
        .get(job.chat_id, memory.key) as { source_batch_id: string | null; user_managed: number } | undefined;
      if (existing && (existing.user_managed || existing.source_batch_id !== (payload.batchId ?? null))) {
        finalValidationErrors.push("Scoped memory identity belongs to another batch or a user-managed memory");
      }
    }
    if (finalValidationErrors.length) throw new ExtractionValidationError(finalValidationErrors);
    const relationWarnings = ingestExtraction(db, job.chat_id, storedResult, jobId, payload.batchId,
      { sourceMessageIds, atomRefs: payload.recallAtomRefs ?? [] });
    normalizedEpisodic.warnings.push(...relationWarnings);
    if (relationWarnings.length) {
      db.prepare("UPDATE jobs SET payload_json=json_set(payload_json,'$.atomRelationWarnings',json(?)) WHERE id=?")
        .run(JSON.stringify(relationWarnings), jobId);
      recordExtractionAudit(db, job.chat_id, jobId, sourceMessageIds, submitted, audit, pendingReconciliations ? "pending_review" : "applied",
        relationWarnings.join("; "), payload.sourceFingerprint);
    }
    applyMemoryRecallObservations(db, job.chat_id, normalized.result.memoryRecallObservations, payload.recallCandidates ?? [], sourceMessageIds, payload.batchId);
    if (payload.batchId) db.prepare("UPDATE extraction_batches SET status=?,draft_json=?,final_json=?,audit_patch_json=?,updated_at=? WHERE id=?").run(reconciled.pending ? "pending_review" : "applied", JSON.stringify(submitted), JSON.stringify(storedResult), audit?.patch ? JSON.stringify(audit.patch) : null, Date.now(), payload.batchId);
    if (job.type !== "social_backfill") lockInitialCalibration(db, job.chat_id);
    if (!markJobComplete(db, jobId, workerId)) throw new Error("Lease not found while completing extraction");
  })();
  if (payload.regenerationRunId) return { chatId: job.chat_id, warnings: normalizedEpisodic.warnings, pendingReconciliations };
  if (payload.retryOfAuditId && pendingReconciliations === 0) {
    db.prepare("UPDATE extraction_audits SET status='applied',error=NULL,updated_at=? WHERE id=? AND chat_id=?").run(Date.now(), payload.retryOfAuditId, job.chat_id);
    if (payload.retryOfJobId) db.prepare("UPDATE jobs SET status='done',last_error=NULL,updated_at=? WHERE id=? AND chat_id=? AND status='failed'").run(Date.now(), payload.retryOfJobId, job.chat_id);
  }
  const finalLedger = payload.backfillRunId ? enqueueFinalLedgerConsistency(db, job.chat_id, payload.backfillRunId) : undefined;
  if (!finalLedger || finalLedger.state === "not_needed") {
    queueLaggingRelationshipProjections(db, job.chat_id);
    flushRelationshipProjectionQueue(db, job.chat_id, payload.backfillRunId);
  }
  maybeEnqueueStorySpine(db, job.chat_id, payload.backfillRunId);
  maybeEnqueueQuiz(db, job.chat_id);
  return { chatId: job.chat_id, warnings: [...normalizedEpisodic.warnings, ...(rejectedExcerpts ? ["일부 원문 발췌 또는 접근 근거를 검토 상태로 보존하고 검증된 기억만 저장했습니다."] : [])], pendingReconciliations };
}
