import { completeQuizJob } from "./quiz.js";
import { inspectDraftEvidence } from "./evidence-review.js";
import { groupMemoriesWithServerLlm } from "./server-llm.js";
import { completeMemoryGroupJob } from "./memory-grouping.js";
import { repairSourceEvidenceWithServerLlm } from "./server-llm.js";
import { ExtractionAuditPatchSchema } from "@rcm/shared";
import { ExtractionAggregateSchema } from "@rcm/shared";
import { randomUUID } from "node:crypto";
import { ExtractionDraftResultSchema, ReconciliationResultSchema, extractionAuditDraftForJob, type LeasedJob, type ReconciliationSubmission, type ServerAuxiliaryCallTiming, type ServerWorkerStatus } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import type { EmbeddingService } from "./embedding.js";
import { attachAuxiliaryPlan, failJob, leaseJob, releaseJob, setJobPipelineStage } from "./jobs.js";
import { completeExtractionJob } from "./extraction-completion.js";
import { finalizeExtractPage } from "./extraction-pipeline.js";
import { completeEpisodeJob } from "./episode-completion.js";
import { quizWithServerLlm, auditExtractionWithServerLlm, calibrateInitialSetupWithServerLlm, checkLedgerConsistencyWithServerLlm, consolidateStorySpineWithServerLlm, episodeWithServerLlm, extractWithServerLlm, projectRelationshipsWithServerLlm, reconcileWithServerLlm, type ServerLlmStore } from "./server-llm.js";
import { completeRelationshipProjectionJob, flushRelationshipProjectionQueue } from "./relationship-projections.js";
import { completeInitialCalibrationJob } from "./initial-calibration.js";
import { completeStoryConsolidationJob, maybeEnqueueStorySpine } from "./story-spine.js";
import { applyExtractionAuditPatch } from "./extraction-audit.js";
import { prepareReconciliation } from "./reconciliation.js";
import { prepareStateExtraction, usesStateExtraction } from "./state-extraction.js";
import { completeLedgerConsistencyJob, finalizeLedgerConsistencyRun } from "./ledger-consistency.js";

const CONTROL_LEASE_MS = 45_000;
const MANUAL_PAUSE_KEY = "server_worker_manual_pause";
const MAX_ACTIVE_CALLS = 2;

interface ActiveJob {
  job: LeasedJob;
  controller: AbortController;
  startedAt: number;
  phase: "first_extraction" | "relationship_projection" | "story_consolidation" | "social_backfill" | "post_extraction_audit" | "state_reconciliation" | "ledger_consistency" | "storing";
}

export class ServerExtractionWorker {
  readonly workerId = `server-${randomUUID()}`;
  #active = new Map<string, ActiveJob>();
  #controlWorkerId = "";
  #controlLeaseUntil = 0;
  #manualPaused = false;
  #faulted = false;
  #lastError = "";
  #draining = false;
  #lastCompletedAt = 0;
  #auxiliaryCalls = new Map<string, ServerAuxiliaryCallTiming[]>();
  #timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: RcmDatabase,
    private readonly store: ServerLlmStore,
    private readonly embeddings: EmbeddingService,
    private readonly leaseSeconds: number,
    private readonly controlLeaseMs = CONTROL_LEASE_MS,
  ) {
    const persistedPause = this.db.prepare("SELECT value FROM server_meta WHERE key=?").get(MANUAL_PAUSE_KEY) as { value: string } | undefined;
    if (persistedPause) {
      this.#manualPaused = true;
      this.#lastError = persistedPause.value || "Paused by user";
    }
    this.store.setTimingObserver((event) => this.#recordAuxiliaryTiming(event));
    this.#timer = setInterval(() => this.#checkControlLease(), 2_000);
    this.#timer.unref?.();
  }

  get status(): ServerWorkerStatus {
    return this.#status();
  }

  statusForChat(chatId: string): ServerWorkerStatus {
    return this.#status(chatId);
  }

  #status(chatId?: string): ServerWorkerStatus {
    const engine = this.store.config.engine;
    const controlled = this.#controlLeaseUntil > Date.now();
    const visible = [...this.#active.values()].filter(item => item.job.kind !== "quiz" && (!chatId || item.job.chatId === chatId));
    const state = engine === "risu" ? "risu"
      : this.#faulted ? "faulted"
        : this.#manualPaused ? "paused"
          : visible.length ? "running"
            : controlled ? "standby" : "standby";
    const active = visible[0];
    const quiz = [...this.#active.values()].find(item => item.job.kind === "quiz" && (!chatId || item.job.chatId === chatId));
    return {
      state,
      ...(engine === "server" ? { modelConfigured: this.store.modelReady } : {}),
      embeddingConfigured: this.embeddings.status?.configured,
      activeCalls: visible.length,
      ...(quiz ? { quizGenerating: { chatId: quiz.job.chatId, startedAt: quiz.startedAt } } : {}),
      ...(controlled ? { controlLeaseUntil: this.#controlLeaseUntil } : {}),
      ...(this.#lastError ? { lastError: this.#lastError } : {}),
      queuedJobs: (this.db.prepare("SELECT count(*) AS count FROM jobs WHERE status IN ('queued','leased') AND type<>'quiz'").get() as { count: number }).count,
      phase: this.#faulted ? "faulted" : this.#manualPaused ? "paused" : active?.phase ?? "idle",
      ...(active ? { activeJob: { chatId: active.job.chatId, sourceMessageCount: active.job.sourceMessageIds.length, sourceTurnCount: active.job.sourceTurnCount, startedAt: active.startedAt, kind: active.job.kind, sourceRecovery: active.job.sourceRecovery } } : {}),
      ...(chatId && this.#auxiliaryCalls.get(chatId)?.length ? { auxiliaryCalls: this.#auxiliaryCalls.get(chatId) } : {}),
      ...(this.#lastCompletedAt ? { lastCompletedAt: this.#lastCompletedAt } : {}),
    };
  }

  #recordAuxiliaryTiming(event: { id: string; jobId: string; purpose: string; startedAt: number; elapsedMs?: number; outcome: "running" | "succeeded" | "failed" }): void {
    const active = this.#active.get(event.jobId);
    if (!active || active.job.kind === "quiz") return;
    const chatId = active.job.chatId;
    const calls = this.#auxiliaryCalls.get(chatId) ?? [];
    const existing = calls.find((call) => call.id === event.id);
    if (existing) Object.assign(existing, event);
    else calls.unshift({
      id: event.id,
      purpose: event.purpose,
      startedAt: event.startedAt,
      groupOrdinal: active.job.operationStageOrdinal,
      groupTotal: active.job.operationStageTotal,
      elapsedMs: event.elapsedMs,
      outcome: event.outcome,
    });
    this.#auxiliaryCalls.set(chatId, calls.slice(0, 8));
  }

  configChanged(): void {
    if (this.store.config.engine !== "server") this.#stopActive("Processing switched to Risu");
    else this.wake();
  }

  heartbeat(workerId: string): ServerWorkerStatus {
    if (this.store.config.engine !== "server") return this.status;
    const now = Date.now();
    if (!this.#controlWorkerId || this.#controlWorkerId === workerId || this.#controlLeaseUntil <= now) {
      this.#controlWorkerId = workerId;
      this.#controlLeaseUntil = now + this.controlLeaseMs;
    }
    this.wake();
    return this.status;
  }

  resume(workerId: string): ServerWorkerStatus {
    this.#manualPaused = false;
    this.#faulted = false;
    this.#lastError = "";
    this.db.prepare("DELETE FROM server_meta WHERE key=?").run(MANUAL_PAUSE_KEY);
    this.#controlWorkerId = workerId;
    this.#controlLeaseUntil = Date.now() + this.controlLeaseMs;
    this.wake();
    return this.status;
  }

  pause(reason = "Paused by user"): ServerWorkerStatus {
    this.#manualPaused = true;
    this.#lastError = reason;
    if (reason === "Paused by user") {
      this.db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(MANUAL_PAUSE_KEY, reason);
    }
    this.#stopActive(reason);
    return this.status;
  }

  wake(): void {
    if (!this.#canRun() || this.#draining) return;
    void this.#drain();
  }

  #canRun(): boolean {
    return this.#canFinishActive() && this.#controlLeaseUntil > Date.now();
  }

  #canFinishActive(): boolean {
    return this.store.config.engine === "server"
      && this.store.modelReady
      && !this.#manualPaused
      && !this.#faulted;
  }

  #checkControlLease(): void {
    if (this.store.config.engine === "server" && this.#controlLeaseUntil > 0 && this.#controlLeaseUntil <= Date.now()) {
      this.#controlLeaseUntil = 0;
      this.#controlWorkerId = "";
    }
  }

  #stopActive(reason: string): void {
    for (const active of this.#active.values()) {
      releaseJob(this.db, active.job.id, this.workerId);
      active.controller.abort(new Error(reason));
    }
  }

  async #drain(): Promise<void> {
    this.#draining = true;
    try {
      while (this.#canRun() && this.#active.size < MAX_ACTIVE_CALLS) {
        // Cumulative extraction/reconciliation for one chat remains serial.
        // The only overlap admitted beside it is a fingerprint-guarded story job.
        const hasNonStory = [...this.#active.values()].some((item) => item.job.kind !== "story_consolidation");
        const job = attachAuxiliaryPlan(this.db, leaseJob(this.db, this.workerId, this.leaseSeconds, { storyOnly: hasNonStory }), {
          maxInputTokens: this.store.config.maxInputTokens, maxOutputTokens: this.store.config.maxOutputTokens, llmTimeoutMs: this.store.config.llmTimeoutMs,
        });
        if (!job) break;
        this.store.snapshotJob(job.id);
        const active: ActiveJob = { job, controller: new AbortController(), startedAt: Date.now(), phase: job.kind === "quiz" ? "storing" : job.kind === "social_backfill" ? "social_backfill" : job.kind === "relationship_projection" ? "relationship_projection" : job.kind === "story_consolidation" ? "story_consolidation" : job.kind === "ledger_consistency" ? "ledger_consistency" : "first_extraction" };
        this.#active.set(job.id, active);
        void this.#process(active);
      }
    } finally {
      this.#draining = false;
    }
  }

  async #process(active: ActiveJob): Promise<void> {
    const { job, controller } = active;
    try {
      setJobPipelineStage(this.db, job.id, active.phase === "storing" ? "storing" : active.phase === "relationship_projection" ? "relationship_projection" : active.phase === "story_consolidation" ? "story_consolidation" : active.phase === "ledger_consistency" ? "ledger_consistency" : "first_extraction", this.workerId);
      let result = job.kind === 'memory_group' ? await groupMemoriesWithServerLlm(this.store, job, controller.signal) : job.kind === "audit_retry" ? job.auditDraft : job.kind === "episode"
        ? await episodeWithServerLlm(this.store, job, controller.signal)
        : job.kind === "initial_calibration"
          ? await calibrateInitialSetupWithServerLlm(this.store, job, controller.signal)
        : job.kind === "relationship_projection"
          ? await projectRelationshipsWithServerLlm(this.store, job, controller.signal)
        : job.kind === "quiz"
          ? await quizWithServerLlm(this.store, job, controller.signal)
        : job.kind === "story_consolidation"
          ? await consolidateStorySpineWithServerLlm(this.store, job, controller.signal)
        : job.kind === "ledger_consistency"
          ? await checkLedgerConsistencyWithServerLlm(this.store, job, controller.signal)
          : await extractWithServerLlm(this.store, job, controller.signal);
      if (controller.signal.aborted || !this.#canFinishActive()) {
        releaseJob(this.db, job.id, this.workerId);
        return;
      }
      if (job.kind === "extract") {
        await finalizeExtractPage({ db: this.db, store: this.store, job, workerId: this.workerId,
          pageDraft: result as any, signal: controller.signal,
          onStage: stage => { active.phase = stage; setJobPipelineStage(this.db, job.id, stage, this.workerId); } });
        this.#lastCompletedAt = Date.now();
        void this.embeddings.indexPending(job.chatId);
        return;
      }
      const recoveringDialogues = job.kind === "audit_retry" && job.sourceRecovery
        && Boolean(job.auditDraft?.memories.some(memory => memory.keyDialogues?.length));
      // Repair frozen source selectors before auditing access. Completion needs
      // the full audit patch to distinguish discarded and pending candidates.
      if (recoveringDialogues && job.sourceUnits) {
        try { result = await repairSourceEvidenceWithServerLlm(this.store, job, result as any, controller.signal); }
        catch (error) {
          if (controller.signal.aborted) throw error;
          console.warn(`[RCM] Dialogue source repair unresolved for job ${job.id}: ${String(error).slice(0, 160)}`);
        }
      }
        const incomplete = Boolean((result as any)?.unfinishedSource?.length);
        const reviewable = job.kind === "audit_retry" || job.kind === "episode" || job.kind === "social_backfill";
      let audit;
      if (!incomplete && job.postExtractionReview && reviewable) {
        active.phase = "post_extraction_audit";
        setJobPipelineStage(this.db, job.id, "post_extraction_audit", this.workerId);
        audit = await auditExtractionWithServerLlm(this.store, job, result, controller.signal);
      }
      let reconciliation: ReconciliationSubmission | undefined;
      if (!incomplete && !recoveringDialogues && job.sourceUnits && result && reviewable && !audit?.patch?.keepPendingItemRefs.length) {
        if (audit?.patch) {
          const applied = applyExtractionAuditPatch(this.db, job.chatId, job.sourceMessageIds, result as any, audit.patch);
          result = applied.result;
          audit = { ...audit, patch: ExtractionAuditPatchSchema.parse({ keepPendingItemRefs: applied.pendingRefs }) };
        }
        try { result = await repairSourceEvidenceWithServerLlm(this.store, job, result as any, controller.signal); }
        catch (error) {
          if (controller.signal.aborted) throw error;
          // Completion retains unresolved candidates and decides the dependency barrier.
          console.warn(`[RCM] Source repair unresolved for job ${job.id}: ${String(error).slice(0, 160)}`);
        }
      }
      if (!incomplete && !job.memoryOnly && !job.sourceRecovery && job.kind !== 'memory_group' && job.kind !== "initial_calibration" && job.kind !== "relationship_projection" && job.kind !== "story_consolidation" && job.kind !== "ledger_consistency" && job.kind !== "quiz") {
        let draft = job.kind === "episode" ? extractionAuditDraftForJob(job, result) : ExtractionAggregateSchema.parse(result);
        if (audit?.patch) draft = applyExtractionAuditPatch(this.db, job.chatId, job.sourceMessageIds, draft, audit.patch).result;
        const grounded = !audit?.patch?.keepPendingItemRefs.length && !inspectDraftEvidence(this.db, job.chatId, job.sourceMessageIds, draft).some((issue) => issue.blocking);
        const stateExtraction = usesStateExtraction(job.kind ?? "extract", job);
        const prepared = grounded ? (stateExtraction
          ? prepareStateExtraction(this.db, job.chatId, job.sourceMessageIds, draft, job.auxiliaryBudget?.maxInputTokens ?? 80_000)
          : prepareReconciliation(this.db, job.chatId, draft, job.auxiliaryBudget?.maxInputTokens ?? 80_000)) : { required: false, candidateSetHash: "", systemPrompt: "", userPrompt: "", parts: [] };
        if (prepared.required) {
          active.phase = "state_reconciliation";
          setJobPipelineStage(this.db, job.id, "state_reconciliation", this.workerId);
          const decisions = [];
          const seedResolutions = [];
          let stateResult;
          this.store.planPages(job.id, "reconciliation", prepared.parts!);
          for (const part of prepared.parts!) {
            const cached = this.store.cachedPage(job.id, "reconciliation", part.systemPrompt, part.userPrompt);
            const page = cached === undefined ? await reconcileWithServerLlm(this.store, job.id, part, controller.signal) : ReconciliationResultSchema.parse(cached);
            const expected = new Set(part.itemRefs);
            if (stateExtraction) {
              if (!page.state) throw new Error("State extraction response is missing state");
              stateResult = page.state;
            } else if (page.decisions.length !== expected.size || page.decisions.some((decision) => !expected.has(decision.itemRef))) throw new Error("Reconciliation page did not return every supplied item exactly once");
            if (cached === undefined) this.store.cachePage(job.id, "reconciliation", part.systemPrompt, part.userPrompt, page);
            decisions.push(...page.decisions);
            seedResolutions.push(...(page.seedResolutions ?? []));
          }
          reconciliation = { candidateSetHash: prepared.candidateSetHash, result: { decisions, seedResolutions, ...(stateResult ? { state: stateResult } : {}) } };
        }
      }
      controller.signal.throwIfAborted();
      active.phase = "storing";
      setJobPipelineStage(this.db, job.id, "storing", this.workerId);
      if (job.kind === 'memory_group') completeMemoryGroupJob(this.db, job.id, this.workerId, result);
      else if (job.kind === "episode") completeEpisodeJob(this.db, job.id, this.workerId, result as any, reconciliation, audit);
      else if (job.kind === "initial_calibration") completeInitialCalibrationJob(this.db, job.id, this.workerId, result as any);
      else if (job.kind === "relationship_projection") completeRelationshipProjectionJob(this.db, job.id, this.workerId, result as any);
      else if (job.kind === "quiz") completeQuizJob(this.db, job.id, this.workerId, result);
      else if (job.kind === "story_consolidation") completeStoryConsolidationJob(this.db, job, this.workerId, result as any);
      else if (job.kind === "ledger_consistency") {
        completeLedgerConsistencyJob(this.db, job, this.workerId, result);
        finalizeLedgerConsistencyRun(this.db, job.chatId, job.ledgerConsistency!.runId);
      }
      else {
        const completed = completeExtractionJob(this.db, job.id, this.workerId, result as any, reconciliation, audit);
        if (completed.warnings.length) console.warn(`[RCM] Extraction ${job.id}: ${completed.warnings.join("; ")}`);
      }
      if (job.kind !== "quiz") {
        this.#lastCompletedAt = Date.now();
        void this.embeddings.indexPending(job.chatId);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        releaseJob(this.db, job.id, this.workerId);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        const failure = failJob(this.db, job.id, this.workerId, message);
        if (job.kind === "ledger_consistency" && failure?.status === "failed") {
          finalizeLedgerConsistencyRun(this.db, job.chatId, job.ledgerConsistency!.runId);
        }
        if (failure?.status === "failed" && job.kind !== "quiz") this.#lastError = message.slice(0, 4_000);
        // leaseJob isolates failed cumulative work to its chat; other chats keep running.
      }
    } finally {
      this.#active.delete(job.id);
      if (this.#canRun()) this.wake();
    }
  }
}
