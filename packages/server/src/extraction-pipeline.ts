import {
  applySourceAccessRepair, ExtractionAggregateSchema, ExtractionAuditPatchSchema, ExtractionAuditSubmissionSchema,
  mergeExtractionPages, planSourceAccessRepair,
  type ExtractionAuditSubmission, type ExtractionDraftResult, type LeasedJob, type ReconciliationSubmission,
} from "@rcm/shared";
import { createHash } from "node:crypto";
import type { RcmDatabase } from "./db.js";
import { applyExtractionAuditPatch } from "./extraction-audit.js";
import { completeExtractionJob } from "./extraction-completion.js";
import { inspectDraftEvidence } from "./evidence-review.js";
import { prepareReconciliation } from "./reconciliation.js";
import { prepareStateExtraction } from "./state-extraction.js";
import {
  auditExtractionWithServerLlm, reconcileWithServerLlm, repairPassageAccessWithServerLlm,
  repairSourceEvidenceWithServerLlm, type ServerLlmStore,
} from "./server-llm.js";

export type ExtractionPipelineStage = "post_extraction_audit" | "state_reconciliation" | "storing";
export interface FinalizeExtractPageOptions {
  db: RcmDatabase;
  store: ServerLlmStore;
  job: LeasedJob;
  workerId: string;
  pageDraft: ExtractionDraftResult;
  signal: AbortSignal;
  onStage?: (stage: ExtractionPipelineStage) => void;
  onWarning?: (warning: string) => void;
}

function preReconciliationCheckpointKey(job: LeasedJob, result: ExtractionDraftResult): string {
  return createHash("sha256").update(JSON.stringify({
    result,
    postExtractionReview: job.postExtractionReview,
    sourceMessageIds: job.sourceMessageIds,
    sourceUnits: job.sourceUnits,
    auditSourceMessages: job.auditSourceMessages,
    auditExistingOpenPromises: job.auditExistingOpenPromises,
    recallCandidates: job.recallCandidates,
    sourceRecovery: job.sourceRecovery,
    memoryOnly: job.memoryOnly,
  })).digest("hex");
}

/** The extract worker's existing post-response sequence. Leasing, initial
 * extraction, cancellation ownership and embedding scheduling stay outside. */
export async function finalizeExtractPage(options: FinalizeExtractPageOptions) {
  const { db, store, job, workerId, pageDraft, signal } = options;
  if (job.kind !== "extract") throw new Error("Extraction pipeline requires an extract job");
  const warn = options.onWarning ?? ((message: string) => console.warn(message));
  let result = job.continuationDraft ? mergeExtractionPages(job.continuationDraft, pageDraft) : pageDraft;
  const incomplete = Boolean(result.unfinishedSource?.length);
  let audit: ExtractionAuditSubmission | undefined;
  const checkpointKey = preReconciliationCheckpointKey(job, result);
  const checkpoint = incomplete ? undefined : store.cachedPreReconciliation(job.id, checkpointKey);
  if (checkpoint) {
    result = ExtractionAggregateSchema.parse(checkpoint.result);
    audit = checkpoint.audit === undefined ? undefined : ExtractionAuditSubmissionSchema.parse(checkpoint.audit);
  } else {
    if (!incomplete && job.postExtractionReview) {
      options.onStage?.("post_extraction_audit");
      audit = await auditExtractionWithServerLlm(store, job, result, signal);
      signal.throwIfAborted();
    }
    if (!incomplete && job.sourceUnits && !audit?.patch?.keepPendingItemRefs.length) {
      if (audit?.patch) {
        const applied = applyExtractionAuditPatch(db, job.chatId, job.sourceMessageIds, result, audit.patch);
        result = applied.result;
        audit = { ...audit, patch: ExtractionAuditPatchSchema.parse({ keepPendingItemRefs: applied.pendingRefs }) };
      }
      try {
        result = await repairSourceEvidenceWithServerLlm(store, job, result, signal);
        signal.throwIfAborted();
      }
      catch (error) {
        if (signal.aborted) throw error;
        warn(`[RCM] Source repair unresolved for job ${job.id}: ${String(error).slice(0, 160)}`);
      }
    }
    if (!incomplete) store.cachePreReconciliation(job.id, checkpointKey, { result, audit });
  }
  let reconciliation: ReconciliationSubmission | undefined;
  if (!incomplete && !job.memoryOnly && !job.sourceRecovery) {
    let draft = ExtractionAggregateSchema.parse(result);
    if (audit?.patch) draft = applyExtractionAuditPatch(db, job.chatId, job.sourceMessageIds, draft, audit.patch).result;
    const grounded = !audit?.patch?.keepPendingItemRefs.length
      && !inspectDraftEvidence(db, job.chatId, job.sourceMessageIds, draft).some(issue => issue.blocking);
    const prepared = grounded ? prepareStateExtraction(db, job.chatId, job.sourceMessageIds, draft, job.auxiliaryBudget?.maxInputTokens ?? 80_000, job.memoryAddition)
      : { required: false, candidateSetHash: "", systemPrompt: "", userPrompt: "" };
    const accessPlan = store.canRepair(job.id) && !audit?.patch?.keepPendingItemRefs.length
      ? planSourceAccessRepair(draft, job.sourceUnits ?? [], job.auditSourceMessages ?? []) : undefined;
    if (prepared.required) {
      options.onStage?.("state_reconciliation");
      reconciliation = { candidateSetHash: prepared.candidateSetHash,
        result: await reconcileWithServerLlm(store, job.id,
          { systemPrompt: prepared.systemPrompt!, userPrompt: prepared.userPrompt!, stateExtraction: true, sourceUnits: "sourceUnits" in prepared ? prepared.sourceUnits : undefined }, signal, undefined,
          accessPlan ? { plan: accessPlan, onResponse: response => { result = applySourceAccessRepair(draft, accessPlan, response); } } : undefined) };
      signal.throwIfAborted();
    } else if (accessPlan) {
      try {
        result = await repairPassageAccessWithServerLlm(store, job, draft, accessPlan, signal);
        signal.throwIfAborted();
      }
      catch (error) {
        if (signal.aborted) throw error;
        warn(`[RCM] Source access repair unresolved for job ${job.id}; valid memories retained`);
      }
    }
  }
  signal.throwIfAborted();
  options.onStage?.("storing");
  const completion = completeExtractionJob(db, job.id, workerId, result, reconciliation, audit);
  if (completion.warnings.length) warn(`[RCM] Extraction ${job.id}: ${completion.warnings.join("; ")}`);
  return { draft: result, audit, reconciliation, completion };
}
