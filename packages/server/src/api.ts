import { withAuxiliaryStoryFraming } from "@rcm/shared";
import { isProviderAuthenticationError, projectRisuAuxiliaryCallDiagnostic, RISU_AUXILIARY_FAILURE_CODES } from "@rcm/shared";
import { StateOutcomeCapture } from "./state-outcomes.js";
import { automaticStateCandidates, fundAutomaticState, renderAutomaticState, selectAutomaticState, sharedStateBudget } from "./automatic-state.js";
import { planTranslation, translationSystemPrompt, validateTranslation, TRANSLATION_TIMEOUT_MS, TranslationError, sanitizeDiagnosticText } from "@rcm/shared";
import { requestStructuredProvider } from "./server-llm.js";
import { connectionFailureReason, type ConnectionFailureCode } from "@rcm/shared";
import { storySeedCounts } from "./story-seeds.js";
import { z } from "zod";
import { deleteLedgerRecord, rememberLedgerEditOrigin } from "./user-deletions.js";
import { QuizAnswerRequestSchema, UserCorrectionEditSchema } from "@rcm/shared";
import { committedEditOrdinal, correctionView } from "./user-corrections.js";
import { answerQuiz, completeQuizJob, disableAllQuizzes, nextQuiz, quizStatus, regenerateQuizzes, resetQuizStats, setQuizEnabled } from "./quiz.js";
import { TranslationLegacySettingsSchema } from "@rcm/shared";
import { TranslationConnection } from "./translation-connection.js";
import { McpSelector } from "./mcp-selector.js";
import { INVALID_MEMORY_REF_MESSAGE, mcpRequestTimeoutMs, structuredStoryTimeEnd } from "@rcm/shared";
import { collectStateEvidence, resolveAssertionHolders } from "./state-evidence.js";
import { SocialRelationSchema } from "@rcm/shared";
import { activeSocialRelations, findSocialRelationConflict, isReverseMutualSocialRelation, parseSocialRelation, sameSocialRelationIdentity, socialRelationKnowledge, socialRelationPredicateCollisions } from "./social-relations.js";
import { timeout } from "hono/timeout";
import { MemoryReferences } from "./memory-references.js";
import { finalizeMcpAnswer } from "./mcp-answer.js";
import { automaticDeliveryHistory, recordAutomaticDelivery, persistAutomaticActivationObservations, deliveredActivationObservation, type AutomaticActivationObservation } from "./recall-activation.js";
import { projectJobListPayload, stageJobModelOutput, manualRetryPayload } from "./jobs.js";
import { inspectDraftEvidence, describeEvidenceReview } from "./evidence-review.js";
import { emptyPacketManifest, mergePacketManifests, type PacketManifest } from "./packet-manifest.js";
import { queueSourceRecovery, retrieveSourceEvidence, renderSourceEvidence, sourceEvidenceAtomKey } from "./source-evidence.js";
import { trimAutomaticAtom, planAutomaticAtoms, selectCueAnchor, selectAutomaticPortfolio, AUTOMATIC_ROLE_SHARES, type AutomaticPortfolioCandidate, type AutomaticAtomPriority } from "./automatic-packet.js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  CompleteJobRequestSchema,
  ExtractionAggregateSchema,
  EpisodeCapsuleResultSchema,
  EpisodeCloseRequestSchema,
  EpisodeStartRequestSchema,
  estimateTokens,
  normalizeSearchTokens,
  FailJobRequestSchema,
  ExpandRequestSchema,
  LeaseJobRequestSchema,
  RecallRequestSchema,
  ServerLlmConfigSchema,
  TurnPrepareRequestSchema,
  WorkerControlSchema,
  PrepareReconciliationRequestSchema,
  ReconciliationReviewResolutionSchema,
  RelationshipProjectionResultSchema,
  StorySpineConsolidationResultSchema,
  InitialCalibrationResultSchema,
  LedgerConsistencyResultSchema,
  LandmarkKindSchema,
  ResolvedSetupProjectionSchema,
  ManualLineageApplyRequestSchema,
  ManualLineagePreviewRequestSchema,
  LineageProbeApplyRequestSchema,
  LineageProbeRequestSchema,
  type MemoryContextItem,
  type MemoryToolOpportunity,
  MemoryLanguageSchema,
  type MemoryLanguage,
  RpProfileSchema,
  normalizeStoryTime,
  measureAuxiliaryPrompt,
  splitAuxiliarySource,
  RCM_API_REVISION, ItemAccessBasisSchema,
  STATE_KIND_VALUES,
  renderMcpAnswer,
  RCM_SERVER_VERSION,
} from "@rcm/shared";
import {backupServerSettings, type ServerConfig} from "./config.js";
import { openDatabase, type RcmDatabase } from "./db.js";
import { BackupValidationError, exportCompleteArchive, exportChatArchive, restoreChatArchive, inspectCompleteArchive, previewMemoryTransplant, restoreCompleteArchive, transplantCompleteArchive } from "./backup.js";
import { deleteChats, listAdminChats, listSourceLedger, reprocessChat, resetDerivedChat, saveSecret, saveVoyageKey } from "./admin.js";
import { recanonicalizeSourceLedger } from "./lifecycle.js";
import { EmbeddingRequestError, type EmbeddingService } from "./embedding.js";
import { attachAuxiliaryPlan, cancelExtractionJobs, enqueueExtractionJobs, enqueueInitialCalibration, enqueueSocialKnowledgeBackfill, failJob, leaseJob, renewJobLease, requeueCancelledMessages, resplitFailedExtractionJob, setJobPipelineStage, type JobPipelineStage } from "./jobs.js";
import { completeExtractionJob, ExtractionValidationError, type DialogueRecoveryCandidate } from "./extraction-completion.js";
import { completeEpisodeJob } from "./episode-completion.js";
import { hardDeleteMessage, hasDerivedState, purgeExpiredContent, syncSnapshot } from "./lifecycle.js";
import { automaticHardMemoryLimit, automaticHardTokenCeiling, automaticMemoryLimit, consolidateMemoryPacket, mergeMemoryContextItems, processedHistoryCoverage, retrieve, type RetrievalCandidateClass, type RetrievalDiagnostics, type RetrievalSelectionRole } from "./retrieval.js";
import { ServerLlmStore, ProviderRequestError } from "./server-llm.js";
declare const __RCM_DISTRIBUTION__: boolean | undefined;
import { ServerExtractionWorker } from "./server-worker.js";
import { chatPacketBudgetKey, compileStorySpine, createStorySpineCompiler, completeStoryConsolidationById, expandArcForMemory, expandArcHits, invalidateStorySpine, invalidateStorySupports, storyMemorySupportIds, listStorySpine, maybeEnqueueStorySpine, storyBudgetLimit, updateStorySpineGroup } from "./story-spine.js";
import { intimacyMilestonePacketType } from "./intimacy-milestones.js";
import { buildEntityIdentityResolver, deleteEntity, listEntities, mergeEntities, previewEntityDelete, previewEntityMerge, refreshMemoryParticipantCounts } from "./entities.js";
import { EVERYONE_HOLDER, publicKnowledgeScope, publicMemoryContext, publicMcpAnswers, memoryDetailAccess, readDetailAccessEdits, writeDetailAccessEdits, pruneDetailAccessEdits, syncDetailKnownBy } from "./item-access.js";
import { normalizeUnitScore } from "./scores.js";
import { listReconciliationReviews, prepareReconciliation, resolveReconciliationReview } from "./reconciliation.js";
import { prepareStateExtraction, usesStateExtraction } from "./state-extraction.js";
import { applyExtractionAuditPatch } from "./extraction-audit.js";
import { changeEpisodeStart, closeEpisodeHold, episodeOverview, previewEpisodeStart, retryEpisode, releaseManualEpisode, startEpisodeHold, syncEpisodeMembership } from "./episodes.js";
import { resolveTurnPerspectives } from "./perspectives.js";
import { hasBufferedSource, ingestionSummary } from "./ingestion-state.js";
import { resolveConflict, type ConflictResolution } from "./conflicts.js";
import { readMemoryBookmarks, setMemoryBookmark } from "./memory-bookmarks.js";
import { InvalidViewPreferencesPatchError, readViewPreferences, ViewPreferencesStorageError, writeViewPreferences } from "./view-preferences.js";
import { acknowledgeChatLineage, applyManualLineage, applyProbedLineage, chooseChatLineage, declineChatLineage, ensureChatLineage, getChatLineage, previewManualLineage, probeChatLineage, revertChatLineage } from "./lineage.js";
import { appendSceneNames, mentionedCharacters, renderSceneNames, listSocialKnowledge, retractSocialKnowledge, setManualSocialKnowledge } from "./social-knowledge.js";
import { fingerprintMatches, parseSourceFingerprintJson } from "./source-fingerprint.js";
import { completeRelationshipProjectionJob, flushRelationshipProjectionQueue, listRelationshipProjections, setRelationshipProjectionOverride } from "./relationship-projections.js";
import { intimacyMilestoneKeys } from "./intimacy-milestones.js";
import { replaceItemAccess } from "./ingest.js";
import { buildRetrievalQuerySignals, sourceQuerySignals } from "./retrieval-planner.js";
import { cachedAuxiliaryPage, storeValidatedAuxiliaryPage } from "./auxiliary-page-cache.js";
import { beginInitialCalibration, clearInitialCalibrationDraft, completeInitialCalibrationJob, deleteInitialEntity, initialCalibrationLedger, initialCalibrationRetryInput, initialCalibrationView, resolveInitialCalibrationConfirmation, updateInitialRelationship, upsertInitialEntity } from "./initial-calibration.js";
import { previewRegeneration, applyCanonicalRegeneration, applyEpisodeRegeneration, discardRegeneration, listExtractionBatches, listRegenerations, regenerationRun, startCanonicalRegeneration, startEpisodeRegeneration } from "./regeneration.js";
import { listSourceRanges, rangeMessages, setMemoryExclusion } from "./source-ranges.js";
import { additionSources, additionMessageReason, previewMemoryAddition, startMemoryAddition, listMemoryAdditions, applyMemoryAddition, discardMemoryAddition } from './memory-addition.js';
import { applyMemoryGroup, completeMemoryGroupJob, discardMemoryGroup, invalidateChangedMemoryGroups, listMemoryGroups, previewMemoryGroup, startMemoryGroup, ungroupMemories } from "./memory-grouping.js";
import { RetrievalTraceWriter, type RetrievalTraceEvent } from "./retrieval-trace.js";
import { memoryAtomKeys, memoryDetailAtomKey, memoryDialogueAtomKey, memorySummaryAtomKey, physicalOccurrenceAtomKey, relationshipLandmarkAtomKey } from "./memory-atoms.js";
import { accessibleArchiveExists, memoryToolReadiness } from "./memory-tool-readiness.js";
import { parseLandmarkKinds, refreshMemoryFts, RELATIONSHIP_LANDMARK_KINDS } from "./memory-search-document.js";
import { recognitionDetailSql, recognitionOnlyMemorySql } from "./memory-group-search.js";
import { invalidateTranslations, lookupTranslations, translationCacheStats, upsertTranslations } from "./translation-cache.js";
import { buildLedgerConsistencyJob, completeLedgerConsistencyJob, finalizeLedgerConsistencyRun } from "./ledger-consistency.js";
import { VoyageReranker, type EvidenceReranker, RerankerUnavailableError } from "./reranker.js";
import { UpdateService } from "./update-service.js";
import { scheduleManagedRestart } from "./managed-restart.js";

const MemoryParticipantsSchema = z.array(z.string().trim().min(1)).max(16).refine(names => new Set(names).size === names.length);

interface Dependencies {
  db: RcmDatabase;
  config: ServerConfig;
  embeddings: EmbeddingService;
  vectorEnabled: boolean;
  llmStore?: ServerLlmStore;
  serverWorker?: ServerExtractionWorker;
  reranker?: EvidenceReranker;
  updateService?: UpdateService;
  restartScheduler?: (config: ServerConfig, targetVersion: string) => unknown;
}

const equalToken = (actual: string, expected: string): boolean => {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

const xmlText = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

function ledgerConflictResponse(conflict: NonNullable<ReturnType<typeof findSocialRelationConflict>>) {
  return { error: conflict.code === "REVERSE_RELATION_EXISTS"
    ? "같은 이름의 역방향 관계가 이미 있습니다." : "같은 활성 장부 항목이 이미 있습니다.", ...conflict };
}

function lastMatchingIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index]!)) return index;
  return -1;
}

export function mergePerspectiveFocusLeaderIds(groups: string[][], limit = 8): string[] {
  const merged: string[] = [];
  for (let rank = 0; rank < limit && merged.length < limit; rank += 1) {
    for (const leaders of groups) {
      const id = leaders[rank];
      if (id && !merged.includes(id)) merged.push(id);
      if (merged.length >= limit) break;
    }
  }
  return merged;
}

function injectionManifest(packet: string, manifest: PacketManifest, perspectives: string[], storySpineNodeIds: string[] = []) {
  return { source: packet ? "fresh" as const : "empty" as const, ...mergePacketManifests([manifest]), perspectives, storySpineNodeIds };
}

export function buildMemoryToolOpportunity(
  candidates: MemoryContextItem[],
  injected: MemoryContextItem[],
  manifest: ReturnType<typeof injectionManifest>,
  promptCoveredAtoms: number,
  candidateClasses?: ReadonlyMap<string, RetrievalCandidateClass>,
): MemoryToolOpportunity {
  const injectedKeys = new Set(manifest.atomKeys ?? []);
  const unique = new Map(candidates.map((item) => [item.id, item]));
  const allRows = [...unique.values()].slice(0, 64).map((item) => ({
    memoryId: item.id,
    all: memoryAtomKeys(item),
    unseen: memoryAtomKeys(item).filter((key) => !injectedKeys.has(key)),
  }));
  const injectedIds = new Set(injected.map((item) => item.id));
  const candidateRows = allRows.filter((row) => {
    const candidateClass = candidateClasses?.get(row.memoryId);
    return candidateClass === undefined || candidateClass === "core" || candidateClass === "continuity";
  });
  const recall = candidateRows.filter((row) => row.unseen.length > 0);
  const followCandidates = allRows.filter((row) => injectedIds.has(row.memoryId) && row.unseen.length > 0)
    .slice(0, 32).map((row) => ({ memoryId: row.memoryId, atomKeys: row.unseen.slice(0, 128) }));
  return {
    recallCandidateMemoryIds: recall.map((row) => row.memoryId),
    recallCandidateAtomKeys: [...new Set(recall.flatMap((row) => row.unseen))].slice(0, 512),
    followCandidates,
    excluded: {
      alreadyInjectedAtoms: candidateRows.reduce((sum, row) => sum + row.all.filter((key) => injectedKeys.has(key)).length, 0),
      promptCoveredAtoms,
      noUnseenAtoms: allRows.filter((row) => row.unseen.length === 0).length,
      directGrounding: allRows.length - candidateRows.length,
      perspectiveBlocked: 0,
    },
  };
}

function opportunityTurnIsCurrent(db: RcmDatabase, chatId: string, latestMessageId: string | undefined): boolean {
  if (!latestMessageId) return false;
  const row = db.prepare(`SELECT message_id FROM messages WHERE chat_id=? AND lifecycle IN ('pending','committed','client_pruned')
    AND host_visibility='active' ORDER BY ordinal DESC LIMIT 1`).get(chatId) as { message_id: string } | undefined;
  return row?.message_id === latestMessageId;
}

export function createApp(dependencies: Dependencies): Hono {
  const { db, config, embeddings, vectorEnabled } = dependencies;
  const llmStore = dependencies.llmStore ?? new ServerLlmStore(db, config.secretsPath, config.llmApiKeys ?? {}, config.llmTimeoutMs);
  const mcpSelector=new McpSelector(db,config.secretsPath,llmStore);
  const translationConnection=new TranslationConnection(db,config.secretsPath,llmStore);
  embeddings.setTimeoutMs(llmStore.config.embeddingTimeoutMs);
  const serverWorker = dependencies.serverWorker ?? new ServerExtractionWorker(db, llmStore, embeddings, config.leaseSeconds);
  const reranker = dependencies.reranker ?? new VoyageReranker({ apiKey: () => config.voyageApiKey,
    endpoint: config.rerankEndpoint, model: config.rerankModel, timeoutMs: llmStore.config.rerankTimeoutMs });
  const retrievalTrace = new RetrievalTraceWriter(db, {
    mode: config.retrievalTrace,
    path: config.retrievalTracePath,
    maxEvents: config.retrievalTraceMaxEvents,
    maxAgeDays: config.retrievalTraceMaxAgeDays,
  });
  const app = new Hono();
  const memoryReferences = new MemoryReferences(db);
  // Automatic preparation waits for the complete packet. Its timings remain diagnostic.
  app.use("/v1/chats/:id/recall", (context,next)=>timeout(mcpSelector.publicConfig.enabled ? mcpRequestTimeoutMs(mcpSelector.publicConfig)-2_000 : 8_000)(context,next));
  app.use("/v1/chats/:id/expand", timeout(8_000));
  const updateService = dependencies.updateService ?? new UpdateService(config);
  const restartScheduler = dependencies.restartScheduler ?? scheduleManagedRestart;
  let managedRestartScheduled = false;
  const serverInstanceId = (db.prepare("SELECT value FROM server_meta WHERE key='instance_id'").get() as { value: string }).value;
  app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization", "X-RCM-Plugin-Version", "X-RCM-API-Revision"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] }));
  app.get("/v1/health", (context) => {
    const health = {
      ok: true, version: RCM_SERVER_VERSION, apiRevision: RCM_API_REVISION, instanceId: serverInstanceId,
      vectorEnabled, embeddingReady: embeddings.ready, embedding: embeddings.status, reranker: reranker.status, serverTranslationCache: true, completeMemoryBackup: true,
      serverLlm: llmStore.publicConfig, translationConnection:translationConnection.publicConfig, mcpSelector:mcpSelector.publicConfig, serverWorker: serverWorker.status, capabilities: { stateReconciliationV2: true, stateReconciliationV3: true, pipelineProgressV2: true, providerJsonMode: true, pipelineRetryStatus: true, landmarkAuditPatches: true, manualTimelineMemory: true, storyOverviewEditing: true, turnMemoryToolOpportunity: true, relationshipLandmarks: true, physicalIntimacyAutoInject: true, recallPortfolioV2: true, mcpAtomDelta: true, memoryToolReadiness: true, initialCalibration: true, initialRelationshipProjection: true, relationshipProjectionCursor: true, offscreenPromises: true, extractionAudit: true, atomAccess: true, beliefLifecycle: true, reconciliationReview: true, messageVisibility: true, sourceRangeOrganization: true, stagedMemoryGrouping: true, perspectiveResolution: true, ingestionState: true, relationshipScaleV2: true, qualitativeRelationships: true, memoryDetails: true, intimacyMilestones: true, npcProminence: true, adaptiveExtraction: true, multilingualCanonicalMemory: true, extractionGrouping: true, promptCoverageSuppression: true, durableLedger: true, chatLineage: true, manualLineageTransfer: true, sourceLedgerInspection: true, dashboardLineageProbe: true, readOnlyLineageProbe: true, recallCoverage: true, socialKnowledge: true, lineageAcknowledgement: true, packetContractV2: true, physicalIntimacy: true, typedLandmarks: true, resolvedRelationshipBaseline: true, manualLedgerEditing: true, memoryToolControl: true, shortMemoryRefs: true, multiGenerationLineage: true, quoteReviewRemoved: true, injectionManifest: true, ledgerHistory: true, typedSexMilestones: true, deepRecall: true, aspectProvenance: true, creativeUnknownStates: true, retrievalPlannerV2: true, extractionBatches: true, episodeRegeneration: true, canonicalSuffixRegeneration: true, fullColdStartSync: true, storySpine: true, storySpineV2: true, memoryQuiz: true, quizManagement: true, memoryBudgetPresets: true, holderMemoryTraces: true, canonicalSourceNormalization: true, editProtection: true, cognitiveActivation: true, serverServiceTier: true, ...(retrievalTrace.dashboardAvailable ? { retrievalDiagnostics: true } : {}) },
    };
    Object.assign(health.capabilities, {
      chatOperationLifecycleV2: true,
      mcpEvidenceRerank: true,
      turnLineageDiscovery: true,
      ledgerConsistencyBarrier: true,
      canonicalLedgerIdentity: true,
      repairDiagnosticsV2: true,
      operationRunAccounting: true,
      persistentBackfillResult: true,
      mcpCompactEvidence: true,
      mcpSelector:true,
      managedServerRestart: true,
    });
    return context.json(health);
  });
  app.use("/v1/*", async (context, next) => {
    const token = context.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!equalToken(token, config.token)) return context.json({ error: "Unauthorized" }, 401);
    const revision = context.req.header("X-RCM-API-Revision");
    // Health and authenticated read-only update discovery remain usable across API changes.
    const updateDiscovery = context.req.method === "GET" && context.req.path === "/v1/update/status";
    if (!updateDiscovery && (revision !== undefined || context.req.header("X-RCM-Plugin-Version")) && revision !== String(RCM_API_REVISION)) {
      return context.json({ error: "RCM API revision mismatch; update the plugin and server together", code: "API_REVISION_MISMATCH", expectedApiRevision: RCM_API_REVISION }, 409);
    }
    await next();
  });
  app.get("/v1/chats/:id/dashboard-home", (context) => {
    const chatId = context.req.param("id");
    const readers = {
      memories: () => readDashboardMemories(chatId),
      relationships: () => readDashboardRelationships(chatId),
      entities: () => readDashboardEntities(chatId),
      viewPreferences: () => readViewPreferences(db, chatId),
      world: () => readDashboardWorld(chatId, { includeHistory: "true" }),
      conflicts: () => readDashboardConflicts(chatId),
      jobs: () => readDashboardJobs(chatId),
      lineage: () => getChatLineage(db, chatId),
      status: () => readDashboardStatus(chatId),
      initialCalibration: () => initialCalibrationLedger(db, chatId),
      storySpine: () => listStorySpine(db, chatId),
      socialKnowledge: () => readDashboardSocialKnowledge(chatId),
    };
    // Keep partial failures isolated, just like the individual dashboard reads.
    const datasets = Object.fromEntries(Object.entries(readers).map(([key, read]) => {
      try { return [key, { ok: true, value: read() }]; }
      catch (error) {
        console.error(`Dashboard home ${key} failed`, error);
        return [key, { ok: false, error: "Internal Server Error" }];
      }
    }));
    return context.json({ datasets });
  });
  app.post("/v1/translations/cache/lookup", async (context) => {
    const body = await context.req.json() as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys.filter((key): key is string => typeof key === "string" && key.length <= 512).slice(0, 500) : [];
    return context.json({ items: lookupTranslations(db, keys) });
  });
  app.post("/v1/translations/cache/upsert", async (context) => {
    const body = await context.req.json() as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length > 500) return context.json({ error: "items must be an array of up to 500 translations" }, 400);
    const items = body.items.filter((item: any) => item && ["key", "serverInstanceId", "chatId", "kind", "itemId", "sourceHash", "provider", "sourceLanguage", "targetLanguage", "translated"]
      .every((field) => typeof item[field] === "string"));
    if (items.length !== body.items.length) return context.json({ error: "Invalid translation cache item" }, 400);
    upsertTranslations(db, items);
    return context.json({ ok: true, ...translationCacheStats(db) });
  });
  app.post("/v1/translations/cache/invalidate", async (context) => {
    const body = await context.req.json() as Record<string, unknown>;
    const match = Object.fromEntries(["serverInstanceId", "chatId", "kind", "itemId", "itemIdPrefix"]
      .flatMap((key) => typeof body[key] === "string" ? [[key, body[key]]] : []));
    return context.json({ ok: true, removed: invalidateTranslations(db, match) });
  });
  app.get("/v1/translations/cache/stats", (context) => context.json(translationCacheStats(db)));
  app.delete("/v1/translations/cache", (context) => {
    const removed = db.prepare("DELETE FROM translation_cache").run().changes;
    return context.json({ ok: true, removed });
  });
  app.get("/v1/chats/:id/memory-tools/readiness", (context) => context.json(memoryToolReadiness(db, context.req.param("id"))));

  app.post("/v1/turn/prepare", async (context) => {
    const prepareStartedAt = performance.now();
    const syncTimings: Record<string, number> = {};
    let syncPhaseStartedAt = prepareStartedAt;
    const finishSyncPhase = (name: string): void => {
      const finishedAt = performance.now();
      syncTimings[name] = finishedAt - syncPhaseStartedAt;
      syncPhaseStartedAt = finishedAt;
    };
    const requestBody = await context.req.text();
    finishSyncPhase("requestBodyReadMs");
    const parsed = TurnPrepareRequestSchema.parse(JSON.parse(requestBody));
    finishSyncPhase("requestParseMs");
    const lineage = ensureChatLineage(db, parsed, true);
    const lineagePending = ["ambiguous", "choice_required"].includes(lineage.status);
    finishSyncPhase("lineageMs");
    const effectiveBackfillApproved = parsed.backfillApproved === true && parsed.serverInstanceId === serverInstanceId;
    const sync = syncSnapshot(db, { ...parsed, forceBackfill: parsed.forceBackfill && !lineagePending, backfillApproved: effectiveBackfillApproved && !lineagePending });
    db.prepare(`INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value
      WHERE server_meta.value<>excluded.value`).run(chatPacketBudgetKey(parsed.chatId), String(parsed.tokenBudget));
    if (parsed.memoryGeneration) memoryReferences.begin(parsed.chatId, parsed.memoryGeneration);
    finishSyncPhase("snapshotMs");
    const requestedExtractionReview = parsed.postExtractionReview ?? false;
    db.prepare("UPDATE chats SET post_extraction_review=?,updated_at=? WHERE id=?").run(requestedExtractionReview ? 1 : 0, Date.now(), parsed.chatId);
    const effectiveExtractionReview = parsed.extractionReviewOverride ?? requestedExtractionReview;
    const languageState = db.prepare("SELECT memory_language,pending_memory_language,ingestion_state FROM chats WHERE id=?").get(parsed.chatId) as { memory_language: "en" | "ko" | "ja" | "zh"; pending_memory_language: "en" | "ko" | "ja" | "zh" | null; ingestion_state: string };
    let initialCalibration = initialCalibrationView(db, parsed.chatId);
    const visibleOpeningMessages = parsed.messages.filter((message) => !message.disabled && message.role !== "system");
    const isTrueNewRootOpening = initialCalibration.status === "unseeded" && visibleOpeningMessages.length <= 2;
    const continuingColdStart = initialCalibration.status === "awaiting_setup" && initialCalibration.origin === "cold_start";
    const mayStartInitialCalibration = parsed.forceBackfill || continuingColdStart || isTrueNewRootOpening;
    const operationRunId = parsed.forceBackfill || continuingColdStart ? randomUUID() : undefined;
    if (!lineagePending && lineage.status !== "inherited" && mayStartInitialCalibration && (parsed.resolvedSetup || parsed.forceBackfill) && ["unseeded", "awaiting_setup"].includes(initialCalibration.status)) {
      initialCalibration = beginInitialCalibration(db, parsed.chatId, parsed.forceBackfill || continuingColdStart ? "cold_start" : "new_root", parsed.resolvedSetup, {
        confirmationRequired: parsed.forceBackfill || continuingColdStart,
        forceBackfill: parsed.forceBackfill || continuingColdStart,
        extractionReview: continuingColdStart ? undefined : effectiveExtractionReview,
      });
      if (parsed.resolvedSetup && initialCalibration.status === "unseeded"
        && enqueueInitialCalibration(db, parsed.chatId, parsed.resolvedSetup, parsed.identityHints ?? {}, operationRunId)) {
        serverWorker.wake();
        initialCalibration = initialCalibrationView(db, parsed.chatId);
      }
    }
    finishSyncPhase("calibrationMs");
    if (!lineagePending) syncEpisodeMembership(db, parsed.chatId);
    finishSyncPhase("episodeMembershipMs");
    // Keep the pre-enqueue freshness signal without computing dashboard token statistics.
    const bufferedSource = hasBufferedSource(db, parsed.chatId, languageState.ingestion_state);
    finishSyncPhase("ingestionMs");
    const deferExtraction = parsed.deferExtraction || lineagePending || (!parsed.forceBackfill && languageState.ingestion_state !== "managed");
    const extractionSourceMode = lineage.status === "inherited" ? "ledger" : "current";
    const queued = !deferExtraction
      ? enqueueExtractionJobs(db, parsed.chatId, parsed.profile, parsed.forceBackfill, parsed.includeUserMessages !== false, parsed.extractionGroupTurns ?? 6, extractionSourceMode, effectiveExtractionReview)
      : 0;
    finishSyncPhase("extractionEnqueueMs");
    const projectionQueued = lineagePending ? 0 : flushRelationshipProjectionQueue(db, parsed.chatId);
    finishSyncPhase("projectionQueueMs");
    if (queued > 0 || projectionQueued > 0) serverWorker.wake();
    if (queued > 0) setTimeout(() => void embeddings.indexPending(parsed.chatId), 1_500);
    finishSyncPhase("workerWakeMs");
    purgeExpiredContent(db);
    finishSyncPhase("maintenanceMs");
    const traceRequestId = parsed.traceContext?.requestId ?? randomUUID();
    if (parsed.tokenBudget === 0) {
      return context.json({
        apiRevision: RCM_API_REVISION,
        serverInstanceId,
        chatRevision: sync.revision,
        profile: parsed.profile,
        memoryLanguage: languageState.memory_language,
        pendingMemoryLanguage: languageState.pending_memory_language,
        requiresLanguageReprocess: languageState.pending_memory_language !== null,
        packet: "",
        stableAnchors: "",
        estimatedTokens: 0,
        selected: [],
        injectionManifest: { source: "empty", perspectives: [], memoryIds: [], detailIds: [], atomKeys: [], storySpineNodeIds: [], relationshipPairs: [], beliefIds: [], assertionIds: [], promiseIds: [], intimacyMilestoneIds: [] },
        mcpRequestTimeoutMs:mcpRequestTimeoutMs(mcpSelector.publicConfig),
        memoryToolsAvailable: memoryToolReadiness(db, parsed.chatId).available,
        memoryToolOpportunity: { recallCandidateMemoryIds: [], recallCandidateAtomKeys: [], followCandidates: [], excluded: { alreadyInjectedAtoms: 0, promptCoveredAtoms: 0, noUnseenAtoms: 0, directGrounding: 0, perspectiveBlocked: 0 } },
        perspectiveResolution: { perspectives: [], source: "unresolved", unresolved: false },
        omissionReason: "budget_zero",
        retrievalTrace: { enabled: retrievalTrace.isChatEnabled(parsed.chatId), requestId: traceRequestId },
        initialCalibration,
        lineage,
        sync: {
          inserted: sync.inserted,
          revised: sync.revised,
          pruned: sync.pruned,
          deleted: sync.deleted,
          truncated: sync.truncated,
        },
      });
    }
    const syncFinishedAt = performance.now();
    const requestSignals = parsed.querySignals?.length
      ? parsed.querySignals
      : [{ kind: "focus" as const, text: parsed.query, weight: 1 }];
    const querySignals = sourceQuerySignals(db, parsed, requestSignals);
    if (querySignals !== requestSignals) parsed.query = querySignals.find(signal => signal.kind === 'focus')?.text
      ?? querySignals.find(signal => signal.kind === 'scene')?.text ?? 'continue';
    const retrievalSignals = buildRetrievalQuerySignals(db, parsed.chatId, querySignals, languageState.memory_language);
    const semantic = await embeddings.searchManyDetailed(retrievalSignals, parsed.chatId);
    const embeddingFinishedAt = performance.now();
    const perspectiveQuery = querySignals.map((signal) => signal.text).join("\n");
    const perspectiveResolution = resolveTurnPerspectives(db, parsed, perspectiveQuery);
    const requestedPromptIds = [...new Set(parsed.promptSourceMessageIds ?? [])].slice(-512);
    const trustedPromptSourceMessageIds = requestedPromptIds.length === 0 ? [] : (db.prepare(`
      SELECT message_id FROM messages
      WHERE chat_id=? AND message_id IN (${requestedPromptIds.map(() => "?").join(",")})
        AND lifecycle='committed' AND memory_excluded=0 AND host_visibility='active' AND content IS NOT NULL
      ORDER BY ordinal
    `).all(parsed.chatId, ...requestedPromptIds) as Array<{ message_id: string }>).map((row) => row.message_id);
    const activeMemoryCount = (db.prepare("SELECT count(*) AS count FROM memories WHERE chat_id=? AND active=1").get(parsed.chatId) as { count: number }).count;
    const retrievalPerspectives = perspectiveResolution.perspectives.length ? perspectiveResolution.perspectives : activeMemoryCount > 0 ? ["__shared__"] : [];
    // Guidance and the shared XML root are added after perspective retrieval.
    // Reserve their cost up front instead of letting N perspective-local caps
    // silently overflow the actual injection budget.
    const activeTurnPerspectives = perspectiveResolution.perspectives.filter((name) => name !== "__shared__");
    const namesPresent = [...activeTurnPerspectives, ...(parsed.identityHints?.recentSpeakerNames ?? []), parsed.identityHints?.userPersonaName ?? ""];
    const namesPrompt = (db.prepare("SELECT CASE WHEN canonical_hash<>'' THEN canonical_content ELSE content END content FROM messages WHERE chat_id=? AND memory_excluded=0 AND message_id IN (SELECT value FROM json_each(?)) ORDER BY ordinal")
      .all(parsed.chatId, JSON.stringify(trustedPromptSourceMessageIds)) as Array<{ content: string }>).map(row => row.content).join("\n");
    const sceneNames = renderSceneNames(db, parsed.chatId, namesPresent, namesPresent,
      mentionedCharacters(db, parsed.chatId, [parsed.query, perspectiveQuery, namesPrompt].join("\n")), Math.min(200, Math.floor(parsed.tokenBudget * .1)));
    const maximumStoryBudget = storyBudgetLimit(parsed.tokenBudget);
    const storyProbe = compileStorySpine(db, parsed.chatId, activeTurnPerspectives, semantic.storyScores, maximumStoryBudget);
    const stateTrace = retrievalTrace.isChatEnabled(parsed.chatId) ? new StateOutcomeCapture() : undefined;
    const stateCorpus = collectStateEvidence(db, parsed.chatId, stateTrace, "shared");
    const stateMemorySources = db.prepare(`WITH sources AS (SELECT value id FROM json_each(?))
      SELECT m.id memory_id,e.value ->> '$.messageId' source_id FROM memories m,json_each(m.evidence_json) e
        JOIN sources s ON s.id=e.value ->> '$.messageId' WHERE m.chat_id=? AND m.active=1
      UNION SELECT d.memory_id,e.value ->> '$.messageId' source_id FROM memory_details d,json_each(d.evidence_json) e
        JOIN sources s ON s.id=e.value ->> '$.messageId' WHERE d.chat_id=? AND d.active=1`)
      .all(JSON.stringify([...new Set(stateCorpus.filter(state => state.current).flatMap(state => state.sourceIds))]), parsed.chatId, parsed.chatId) as Array<{memory_id:string;source_id:string}>;
    const stateSources = (state: typeof stateCorpus[number]) => state.memoryId ? [state.memoryId]
      : stateMemorySources.filter(row => state.sourceIds.includes(row.source_id)).map(row => row.memory_id);
    const arcExpansion = expandArcHits(db, parsed.chatId, activeTurnPerspectives, semantic.storyScores);
    // Retrieval competes against the full packet budget. Story overlap is
    // known only after leaf memories are selected; reserving the unsuppressed
    // Story probe here would strand that recovered space. The final compiler
    // trims the lowest-priority memories against the actual compact Story.
    const storyBudget = storyProbe.tokens;
    const retrievalBudget = Math.max(0, parsed.tokenBudget - Math.min(320, Math.floor(parsed.tokenBudget * 0.08)));
    const hardTokenCeiling = automaticHardTokenCeiling(parsed.tokenBudget);
    // Each perspective searches against the full candidate budget. The final
    // compiler performs the one global trim, so adding a second protagonist
    // cannot halve recall depth before duplicate memories are merged.
    const perPerspective = Math.max(128, retrievalBudget);
    const perspectiveSections: Array<{ name: string; data: string }> = [];
    const structuredManifests: PacketManifest[] = [];
    const eligibleAtoms = new Map<string, MemoryContextItem>();
    const directAtomKeys = new Set<string>();
    const automaticAtomPriorities = new Map<string, AutomaticAtomPriority>();
    const portfolioMetadata = new Map<string, AutomaticPortfolioCandidate>();
    const automaticAssociationSources = new Map<string, string>();
    const selectedCandidateClasses = new Map<string, RetrievalCandidateClass>();
    const selectedRoles = new Map<string, RetrievalSelectionRole>();
    const candidateClassPriority: Record<RetrievalCandidateClass, number> = { unclassified: 0, associative: 1, continuity: 2, core: 3 };
    const retrievalDiagnostics: RetrievalDiagnostics[] = [];
    const recentMemoryIds = new Set<string>();
    const perspectiveFocusLeaderIds: string[][] = [];
    const continuityBridgeIds: string[] = [];
    const activationByPerspective: Array<{ perspective: string; observations: AutomaticActivationObservation[] }> = [];
    for (const perspective of retrievalPerspectives) {
      const result = retrieve(db, {
        chatId: parsed.chatId,
        query: parsed.query,
        querySignals: retrievalSignals,
        perspective,
        tokenBudget: perPerspective,
        memoryOnlyInjection: parsed.memoryOnlyInjection,
        deferAutomaticBudget: true,
        automaticSupportMemoryIds: [...new Set([...(storyProbe.supportMemoryIds ?? []), ...stateCorpus.flatMap(state => state.current ? stateSources(state) : [])])],
        structuredBudgetScale: 1 / Math.max(1, retrievalPerspectives.length),
        hardTokenCeiling: automaticHardTokenCeiling(perPerspective),
        semanticScores: semantic.scores,
        stateScores: semantic.stateScores,
        semanticHits: semantic.hits,
        semanticAtomHits: semantic.atomHits,
        semanticViewScores: semantic.viewScores,
        arcMemoryScores: arcExpansion.memoryScores,
        arcDetailScores: arcExpansion.detailScores,
        arcDialogueIds: arcExpansion.dialogueIds,
        arcExpansionDiagnostics: arcExpansion.diagnostics,
        promptSourceMessageIds: trustedPromptSourceMessageIds,
        activePerspectives: retrievalPerspectives.filter((name) => name !== "__shared__"),
        collectDiagnostics: retrievalTrace.enabled,
        stateOutcomeCapture: stateTrace,
      });
      if (result.perspectiveData) {
        const name = perspective === "__shared__" ? "shared" : perspective;
        perspectiveSections.push({ name, data: result.perspectiveData });
        structuredManifests.push(result.structuredManifest);
      }
      for (const item of result.eligibleCandidates) {
        const existing = eligibleAtoms.get(item.id);
        eligibleAtoms.set(item.id, existing ? mergeMemoryContextItems(existing, item) : item);
      }
      for (const [id, metadata] of result.automaticPortfolioCandidates ?? []) {
        const old = portfolioMetadata.get(id);
        portfolioMetadata.set(id, old ? { ...metadata, baseDirect: Math.max(old.baseDirect, metadata.baseDirect), core: old.core || metadata.core,
          typedDetailIds: [...new Set([...old.typedDetailIds, ...metadata.typedDetailIds])],
          resemblance: (old.resemblance?.adjustedScore ?? 0) > (metadata.resemblance?.adjustedScore ?? 0) ? old.resemblance : metadata.resemblance } : metadata);
      }
      result.directAtomKeys.forEach((key) => directAtomKeys.add(key));
      for (const [id, via] of Object.entries(result.automaticAssociationSources ?? {})) automaticAssociationSources.set(id, via);
      for (const [key, priority] of Object.entries(result.automaticAtomPriorities ?? {})) {
        const old = automaticAtomPriorities.get(key);
        automaticAtomPriorities.set(key, old ? { focus: Math.max(old.focus, priority.focus), cue: Math.max(old.cue, priority.cue),
          scene: Math.max(old.scene, priority.scene), semantic: Math.max(old.semantic, priority.semantic),
          cueViews: Object.fromEntries([...new Set([...Object.keys(old.cueViews ?? {}), ...Object.keys(priority.cueViews ?? {})])]
            .map((view) => [view, Math.max(old.cueViews?.[view] ?? 0, priority.cueViews?.[view] ?? 0)])),
          connection: Math.max(old.connection ?? 0, priority.connection ?? 0),
          connectionViaMemoryId: (old.connection ?? 0) >= (priority.connection ?? 0) ? old.connectionViaMemoryId : priority.connectionViaMemoryId,
          connectionEvidence: (old.connection ?? 0) >= (priority.connection ?? 0) ? old.connectionEvidence : priority.connectionEvidence,
          sourceMessageIds: [...new Set([...old.sourceMessageIds, ...priority.sourceMessageIds])] } : priority);
      }
      for (const item of result.selected) {
        const candidateClass = result.selectedCandidateClasses[item.id] ?? "unclassified";
        const currentClass = selectedCandidateClasses.get(item.id);
        if (!currentClass || candidateClassPriority[candidateClass] > candidateClassPriority[currentClass]) selectedCandidateClasses.set(item.id, candidateClass);
        const role = result.selectedRoles[item.id];
        if (role === "serendipity" || !selectedRoles.has(item.id)) selectedRoles.set(item.id, role ?? "filler");
      }
      result.recentMemoryIds.forEach((id) => recentMemoryIds.add(id));
      perspectiveFocusLeaderIds.push(result.focusLeaderIds);
      activationByPerspective.push({ perspective, observations: result.activationObservations });
      for (const id of result.continuityBridgeIds) if (!continuityBridgeIds.includes(id)) continuityBridgeIds.push(id);
      if (result.diagnostics) retrievalDiagnostics.push(result.diagnostics);
    }
    const retrievalFinishedAt = performance.now();
    const focusLeaderIds = mergePerspectiveFocusLeaderIds(perspectiveFocusLeaderIds);
    // A shared focus scene does not consume the unexpected-memory slot merely
    // because another perspective reached it by association.
    for (const id of focusLeaderIds) selectedRoles.set(id, "focus");
    for (const [id, candidateClass] of selectedCandidateClasses) if (candidateClass === "core"
      && ["association", "serendipity"].includes(selectedRoles.get(id) ?? "")) selectedRoles.set(id, "core");
    const selectedItems = [...eligibleAtoms.values()].sort((a,b) => Number(focusLeaderIds.includes(b.id)) - Number(focusLeaderIds.includes(a.id))
      || (portfolioMetadata.get(b.id)?.baseDirect ?? 0) - (portfolioMetadata.get(a.id)?.baseDirect ?? 0) || a.id.localeCompare(b.id));
    for (const item of selectedItems) {
      const metadata = portfolioMetadata.get(item.id);
      if (!selectedRoles.has(item.id)) selectedRoles.set(item.id, metadata?.core ? "core" : metadata?.typedDetailIds.length ? "association" : "longterm");
      if (!selectedCandidateClasses.has(item.id)) selectedCandidateClasses.set(item.id, metadata?.core ? "core" : metadata?.typedDetailIds.length ? "associative" : "unclassified");
    }
    let renderStory = createStorySpineCompiler(db, parsed.chatId, activeTurnPerspectives, semantic.storyScores, storyBudget, retrievalTrace.enabled);
    // Trim only removes atoms. Resolve their original support IDs once, then
    // recompute exclusions from the atoms still present on every render.
    const dialogueSupportIds = new Map<MemoryContextItem["keyDialogues"][number], string>();
    const dialogueSupportQuery = db.prepare("SELECT id FROM memory_dialogues WHERE chat_id=? AND memory_id=? AND message_id=? AND text=? LIMIT 1");
    for (const item of selectedItems) for (const dialogue of item.keyDialogues) {
      const row = dialogueSupportQuery.get(parsed.chatId, item.id, dialogue.messageId, dialogue.text) as { id: string } | undefined;
      if (row) dialogueSupportIds.set(dialogue, `dialogue:${row.id}`);
    }
    const compileStoryForSelection = () => {
      const excluded = new Set(selectedItems.flatMap((item) => [...(item.atomAccessVersion === 0 && item.content ? [`memory:${item.id}`] : []), ...item.details.map((detail) => `detail:${detail.id}`)]));
      for (const item of selectedItems) for (const dialogue of item.keyDialogues) {
        const supportId = dialogueSupportIds.get(dialogue);
        if (supportId) excluded.add(supportId);
      }
      return renderStory(excluded);
    };
    let finalStory = compileStoryForSelection();
    const sourceEvidence = retrieveSourceEvidence(db, parsed.chatId, retrievalSignals.filter((signal) => signal.kind !== "scene").map((signal) => signal.text).join("\n"),
      activeTurnPerspectives, parsed.tokenBudget, trustedPromptSourceMessageIds, semantic.sourceHits?.filter((hit) => hit.score >= 0.72 && (hit.viewIndex === undefined || retrievalSignals[hit.viewIndex]?.kind !== "scene")));
    let deliveredSources = sourceEvidence.items;
    let emittedManifest = emptyPacketManifest();
    const requestRefs = new Map<string, string>();
    const referencePacket = (value: string): string => parsed.memoryReferenceMode === "none"
      ? value.replace(/\s+id="[^"]+"/g, "")
      : parsed.memoryGeneration ? value.replace(/\bid="([^"]+)"/g, (_match, id: string) => {
        const ref = requestRefs.get(id) ?? memoryReferences.issue(parsed.chatId, parsed.memoryGeneration!, id, false);
        if (ref) requestRefs.set(id, ref);
        return ref ? `ref="${ref}"` : "";
      }) : value;
    // Active stored memories are processed records; use the entire chat, not
    // only selected hits or the unprocessed newest prompt. Read once per packet.
    const storyTimes = db.prepare("SELECT story_time FROM memories WHERE chat_id=? AND active=1 AND story_time IS NOT NULL").all(parsed.chatId) as Array<{ story_time: string }>;
    const latestStoryTime = storyTimes.reduce<number | undefined>((latest, row) => {
      const end = structuredStoryTimeEnd(row.story_time);
      return end === undefined ? latest : latest === undefined ? end : Math.max(latest, end);
    }, undefined);
    const stateCandidates = automaticStateCandidates(stateCorpus, { perspectives: retrievalPerspectives,
      activeNames: namesPresent, query: retrievalSignals.map(signal => signal.text).join("\n"), semantic: semantic.stateScores,
      covered: new Set(trustedPromptSourceMessageIds), latestStoryTime, trace: stateTrace, memoryOnly: parsed.memoryOnlyInjection,
      namesRecognitionIds: new Set(sceneNames.recognitionIds) });
    const stateBudget = parsed.memoryOnlyInjection ? 0 : sharedStateBudget(parsed.tokenBudget);
    const selectedState = selectAutomaticState(stateCandidates, stateBudget);
    const ceilingDroppedState = new Set<string>();
    const rebuildPacket = () => {
      const state = renderAutomaticState(selectedState);
      emittedManifest = mergePacketManifests([...structuredManifests, state.manifest]);
      const body = consolidateMemoryPacket(db, parsed.chatId, bufferedSource, [...perspectiveSections, { name: "shared", data: state.xml }], selectedItems, "recall", "context", [...recentMemoryIds].filter((id) => selectedItems.some((item) => item.id === id)), activeTurnPerspectives, finalStory.xml, emittedManifest, latestStoryTime, sceneNames.text);
      const deliveredDetails = selectedItems.flatMap(item => item.details
        .filter(detail => emittedManifest.atomKeys.includes(memoryDetailAtomKey(detail))).map(detail => detail.text));
      const deliveredDialogueEvidence = selectedItems.flatMap(item => item.keyDialogues
        .filter(dialogue => emittedManifest.atomKeys.includes(memoryDialogueAtomKey(item.id, dialogue))).flatMap(dialogue => dialogue.evidence));
      deliveredSources = sourceEvidence.items.filter(source => !deliveredDetails.some(text => text.includes(source.quote))
        && !(source.startOffset !== undefined && source.endOffset !== undefined && deliveredDialogueEvidence.some(evidence =>
          evidence.messageId === source.messageId && evidence.canonicalHash === source.canonicalHash
          && evidence.startOffset <= source.startOffset! && evidence.endOffset >= source.endOffset!)));
      const sourceXml = renderSourceEvidence(deliveredSources);
      if (!sourceXml) return referencePacket(body);
      return referencePacket(body.includes("</past_records>") ? body.replace("</past_records>", `${sourceXml}</past_records>`) : (body || "<rp_memory_context></rp_memory_context>").replace("</rp_memory_context>", `${sourceXml}</rp_memory_context>`));
    };
    let packet = rebuildPacket();
    const focusLeaderIdSet = new Set(focusLeaderIds);
    const continuityBridgeIdSet = new Set(continuityBridgeIds);
    const cueAnchorKeys = new Set<string>();
    const atomPolicy = { latestStoryTime, priorities: automaticAtomPriorities, focusIds: focusLeaderIdSet, continuityIds: continuityBridgeIdSet,
      roles: selectedRoles, associationSources: automaticAssociationSources, cueAnchorKeys };
    const atomDecisions = planAutomaticAtoms(selectedItems, directAtomKeys, atomPolicy);
    const cueAnchor = selectCueAnchor(atomDecisions, automaticAtomPriorities,
      new Map(retrievalSignals.flatMap((signal, index) => signal.kind === "cue" ? [[index, signal.weight]] : [])));
    if (cueAnchor) {
      cueAnchorKeys.add(cueAnchor.decision.atomKey);
      cueAnchor.decision.cueAnchor = true;
      cueAnchor.decision.cueViewIndex = cueAnchor.cueViewIndex;
    }
    const completedTurn = Number((db.prepare("SELECT completed_turn_count FROM chats WHERE id=?").get(parsed.chatId) as { completed_turn_count?: number } | undefined)?.completed_turn_count ?? 0);
    const deliveredStateIds = new Set(selectedState.map(row => row.item.id));
    const portfolioStory = renderStory();
    const portfolio = selectAutomaticPortfolio({ candidates: [...selectedItems], metadata: portfolioMetadata, policy: atomPolicy,
      stateSourceIds: new Set(stateCorpus.flatMap(state => state.current && deliveredStateIds.has(state.id) ? stateSources(state) : [])),
      storySupportIds: new Set(portfolioStory.supportMemoryIds ?? []), storySupportAtomIds: new Set(portfolioStory.supportItemIds ?? []), activeParticipants: activeTurnPerspectives,
      lastDelivered: automaticDeliveryHistory(db, parsed.chatId), completedTurn, hardTokenCeiling,
      stateTokens: renderAutomaticState(selectedState).tokens,
      renderTokens: items => { selectedItems.splice(0, selectedItems.length, ...items); finalStory = compileStoryForSelection(); return estimateTokens(rebuildPacket()); } });
    selectedItems.splice(0, selectedItems.length, ...portfolio.items);
    for (const [id, role] of portfolio.roles) selectedRoles.set(id, role);
    for (const decision of atomDecisions) {
      decision.role = selectedRoles.get(decision.memoryId) ?? decision.role;
      if (!selectedItems.some(item => item.id === decision.memoryId && (item.details.some(detail => memoryDetailAtomKey(detail) === decision.atomKey)
        || item.keyDialogues.some(dialogue => memoryDialogueAtomKey(item.id, dialogue) === decision.atomKey)))) decision.outcome = "target_budget";
    }
    finalStory = compileStoryForSelection(); packet = rebuildPacket();
    const removeAt = (index: number): void => {
      const removed = selectedItems.splice(index, 1)[0];
      for (const decision of atomDecisions) if (decision.memoryId === removed?.id && decision.outcome === "retained") decision.outcome = "memory_removed";
      finalStory = compileStoryForSelection();
      packet = rebuildPacket();
    };
    const protectedScene = (item: MemoryContextItem) => focusLeaderIdSet.has(item.id) || portfolioMetadata.get(item.id)?.core
      || item.details.some(detail => cueAnchorKeys.has(memoryDetailAtomKey(detail)))
      || item.keyDialogues.some(dialogue => cueAnchorKeys.has(memoryDialogueAtomKey(item.id, dialogue)));
    const peripheralMemory = (item: MemoryContextItem) => !protectedScene(item)
      && (portfolio.reasons.get(item.id)?.kind === "not_recalled_for"
        || ["association", "serendipity"].includes(selectedRoles.get(item.id) ?? ""));
    const dropState = (index: number) => {
      ceilingDroppedState.add(selectedState.splice(index, 1)[0]!.item.id); packet = rebuildPacket();
    };
    while (estimateTokens(packet) > hardTokenCeiling) {
      // 1. Peripheral memories yield before any current-state row.
      const peripheral = lastMatchingIndex(selectedItems, item => !protectedScene(item)
        && ["longterm", "association", "serendipity"].includes(selectedRoles.get(item.id) ?? ""));
      if (peripheral >= 0) { removeAt(peripheral); continue; }
      // 2. State outside the active scene yields before older continuity.
      const outside = lastMatchingIndex(selectedState, row => !row.active);
      if (outside >= 0) { dropState(outside); continue; }
      // 3. Oldest continuity first, including historical structured records.
      const continuity = selectedItems.filter(item => !protectedScene(item) && selectedRoles.get(item.id) === "continuity")
        .sort((a, b) => (a.sourceOrdinal ?? 0) - (b.sourceOrdinal ?? 0))[0];
      if (continuity) { removeAt(selectedItems.indexOf(continuity)); continue; }
      if (finalStory.xml) {
        const reducedBudget = Math.max(0, finalStory.tokens - (estimateTokens(packet) - hardTokenCeiling) - 1);
        renderStory = createStorySpineCompiler(db, parsed.chatId, activeTurnPerspectives, semantic.storyScores, reducedBudget, retrievalTrace.enabled);
        finalStory = compileStoryForSelection(); packet = rebuildPacket(); continue;
      }
      if (perspectiveSections.length) {
        // These sections contain only physical/relationship history now; the
        // current ledger is independently selected and cannot be popped here.
        perspectiveSections.splice(0); structuredManifests.splice(0); packet = rebuildPacket(); continue;
      }
      const ordinary = lastMatchingIndex(selectedItems, item => !protectedScene(item));
      if (ordinary >= 0) { removeAt(ordinary); continue; }
      // 4. Only protected scene and active-participant state remain.
      if (trimAutomaticAtom(selectedItems, directAtomKeys, true, atomPolicy, atomDecisions, "hard_ceiling")) {
        packet = rebuildPacket(); continue;
      }
      const unpinned = lastMatchingIndex(selectedState, row => !row.pinned);
      if (unpinned >= 0) { dropState(unpinned); continue; }
      if (selectedItems.length) { removeAt(selectedItems.length - 1); continue; }
      if (sourceEvidence.items.length) { sourceEvidence.items.pop(); packet = rebuildPacket(); continue; }
      sceneNames.text = ""; sceneNames.omittedCount += sceneNames.pairCount; sceneNames.pairCount = 0;
      packet = rebuildPacket();
      break;
    }
    const fundedFrom = fundAutomaticState({ candidates: stateCandidates.filter(row => !ceilingDroppedState.has(row.item.id)),
      tokenBudget: parsed.tokenBudget,
      longtermMemoryIds: selectedItems.filter(item => selectedRoles.get(item.id) === "longterm")
        .sort((a, b) => Number(portfolio.reasons.get(b.id)?.kind === "open_seed") - Number(portfolio.reasons.get(a.id)?.kind === "open_seed"))
        .map(item => item.id),
      selected: selectedState, memories: selectedItems, canYield: peripheralMemory, hardTokenCeiling,
      renderTokens: () => { finalStory = compileStoryForSelection(); return estimateTokens(rebuildPacket()); } });
    for (const decision of atomDecisions) if (fundedFrom.includes(decision.memoryId) && decision.outcome === "retained") decision.outcome = "memory_removed";
    finalStory = compileStoryForSelection(); packet = rebuildPacket();
    // Only genuinely unused capacity goes to remaining, non-scene state rows.
    let sharedBudgetUsed = Math.max(stateBudget, renderAutomaticState(selectedState).tokens);
    for (const row of stateCandidates) {
      if (selectedState.includes(row) || ceilingDroppedState.has(row.item.id)) continue;
      selectedState.push(row); const expanded = rebuildPacket();
      if (estimateTokens(expanded) <= hardTokenCeiling) {
        packet = expanded; sharedBudgetUsed = Math.max(sharedBudgetUsed, renderAutomaticState(selectedState).tokens);
      } else { selectedState.pop(); packet = rebuildPacket(); }
    }
    // Refill whole detail/dialogue units in rounds. Already selected connection
    // scenes keep their places; omitted records must fit as readable bundles.
    let refillAdded = 0;
    const refillRejected = { atomBudget: 0, sceneBudget: 0 };
    const candidates = [...eligibleAtoms.values()].filter(item => ["focus", "core"].includes(selectedRoles.get(item.id) ?? "") && selectedItems.some(current => current.id === item.id));
    const additions = candidates.map(candidate => {
      const item = selectedItems.find(current => current.id === candidate.id)!;
      const details = candidate.details.filter(detail => !item.details.some(old => old.id === detail.id));
      const dialogues = candidate.keyDialogues.filter(dialogue => !item.keyDialogues.some(old => memoryDialogueAtomKey(item.id, old) === memoryDialogueAtomKey(item.id, dialogue)));
      const units: Array<{detail?: typeof details[number]; dialogue?: typeof dialogues[number]}> = [];
      for (let i=0;i<Math.max(details.length,dialogues.length);i++) {
        if (dialogues[i]) units.push({dialogue:dialogues[i]});
        if (details[i]) units.push({detail:details[i]});
      }
      return { candidate, units };
    });
    const rounds = Math.max(0,...additions.map(entry => entry.units.length));
    for (let round=0;round<rounds;round++) for (const {candidate,units} of additions) {
      const unit = units[round]; if (!unit) continue;
      const index = selectedItems.findIndex(item => item.id === candidate.id), previous = selectedItems[index]!;
      selectedItems[index] = {...previous,details:unit.detail?[...previous.details,unit.detail]:previous.details,
        keyDialogues:unit.dialogue?[...previous.keyDialogues,unit.dialogue]:previous.keyDialogues};
      finalStory = compileStoryForSelection(); const expanded = rebuildPacket();
      if (estimateTokens(expanded) <= hardTokenCeiling) { packet=expanded; refillAdded++; }
      else { refillRejected.atomBudget++; selectedItems[index]=previous; finalStory=compileStoryForSelection(); packet=rebuildPacket(); }
    }
    if (parsed.memoryReferenceMode === "none") packet = packet.replace(/\s+id="[^"]+"/g, "");
    const keptPeripheralIds = selectedItems.filter(peripheralMemory).map(item => item.id);
    if (!sceneNames.text) for (const entry of stateTrace?.snapshot().entries ?? []) {
      if (entry.rendered === "folded_into_names") for (const perspective of entry.perspectives) {
        stateTrace?.record(perspective, entry, "final_ceiling");
      }
    }
    for (const row of stateCandidates) for (const [index, perspective] of row.perspectives.entries()) {
      stateTrace?.record(perspective, row.item, selectedState.includes(row) ? index ? "deduped" : "delivered"
        : ceilingDroppedState.has(row.item.id) ? "final_ceiling" : "budget", { rank: row.rank,
          ...(!selectedState.includes(row) ? { keptPeripheralMemoryIds: keptPeripheralIds } : {}) });
    }
    stateTrace?.budget("shared", sharedBudgetUsed, renderAutomaticState(selectedState).tokens);
    const assemblyFinishedAt = performance.now();
    const finalSelectedIds = new Set(selectedItems.map((item) => item.id));
    for (const retrieval of retrievalDiagnostics) for (const candidate of retrieval.candidates) if (finalSelectedIds.has(candidate.id)) {
      candidate.selectionRole = selectedRoles.get(candidate.id);
      candidate.roleReason = portfolio.reasons.get(candidate.id);
    }
    const deliveredPerspectives = [...new Set([...perspectiveSections.map(item => item.name), ...selectedState.flatMap(row => row.perspectives)])]
      .map(name => name === "__shared__" ? "shared" : name);
    const finalManifest = { ...injectionManifest(packet, emittedManifest, deliveredPerspectives, finalStory.nodeIds), sourceEvidenceIds: deliveredSources.map((item) => item.id) };
    finalManifest.atomKeys.push(...deliveredSources.map(sourceEvidenceAtomKey));
    if (parsed.memoryGeneration) memoryReferences.deliver(parsed.chatId, parsed.memoryGeneration, [...packet.matchAll(/ref="(m[0-9]+)"/g)].map(match => match[1]!));
    const deliveredActivationAtoms = new Set(finalManifest.atomKeys);
    for (const entry of activationByPerspective) persistAutomaticActivationObservations(
      db,
      parsed.chatId,
      entry.perspective,
      completedTurn,
      entry.observations.flatMap((observation) => {
        if (!finalSelectedIds.has(observation.memoryId) || !["focus", "continuity"].includes(selectedRoles.get(observation.memoryId) ?? "")) return [];
        const delivered = deliveredActivationObservation(observation, deliveredActivationAtoms);
        return delivered ? [delivered] : [];
      }),
    );
    const stableAnchors = [renderAutomaticState(selectedState).xml, ...perspectiveSections.map(section => section.data)].filter(Boolean).join("\n");
    const finalCandidateClassCounts = { core: 0, associative: 0, continuity: 0, unclassified: 0 };
    for (const item of selectedItems) finalCandidateClassCounts[selectedCandidateClasses.get(item.id) ?? "unclassified"] += 1;
    const finalRoleCounts: Record<RetrievalSelectionRole, number> = { focus: 0, core: 0, continuity: 0, association: 0, serendipity: 0, longterm: 0, filler: 0 };
    for (const item of selectedItems) finalRoleCounts[selectedRoles.get(item.id) ?? "filler"] += 1;
    const promptCoveredAtoms = new Set([
      ...retrievalDiagnostics.flatMap((item) => item.promptCoveredMemoryIds),
      ...retrievalDiagnostics.flatMap((item) => item.promptCoveredDetailIds),
      ...retrievalDiagnostics.flatMap((item) => item.promptCoveredDialogueIds),
    ]).size;
    const toolOpportunity = buildMemoryToolOpportunity([...eligibleAtoms.values()], selectedItems, finalManifest, promptCoveredAtoms, selectedCandidateClasses);
    toolOpportunity.archiveSearchAvailable = accessibleArchiveExists(db, parsed.chatId, activeTurnPerspectives)
      || memoryToolReadiness(db, parsed.chatId).processedStates > 0;
    const sectionTokens = Object.fromEntries(["story_continuity", "current_state"].map(tag => [tag, (packet.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`))?.[0] ? estimateTokens(packet.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`))![0]) : 0)]));
    const sceneDelivery = selectedItems.map(item => ({memoryId:item.id,ref:requestRefs.get(item.id),details:item.details.length,dialogues:item.keyDialogues.length}));
    const stateKinds = Object.fromEntries([...new Set(finalManifest.stateEvidenceIds.map(id=>id.split(":")[0]!))].map(kind=>[kind,finalManifest.stateEvidenceIds.filter(id=>id.startsWith(kind+":")).length]));
    const stateInventory = Object.fromEntries([...new Set(stateCorpus.map(item => item.kind))].map(kind => [kind, stateCorpus.filter(item => item.kind === kind).length]));
    const assembly = { names: { pairCount: sceneNames.pairCount, omittedCount: sceneNames.omittedCount }, stateInventory, stateSearch: { ...embeddings.stateIndex.status }, sectionTokens, sceneDelivery, stateKinds, ...processedHistoryCoverage(db, parsed.chatId), refillAdded, refillRejected, unusedTokens: Math.max(0, hardTokenCeiling - estimateTokens(packet)), unusedReason: estimateTokens(packet) < hardTokenCeiling * .8 ? "eligible_scene_or_whole_atom_limit" : undefined };
    const response = context.json({
      apiRevision: RCM_API_REVISION,
      serverInstanceId,
      chatRevision: sync.revision,
      profile: parsed.profile,
      memoryLanguage: languageState.memory_language,
      pendingMemoryLanguage: languageState.pending_memory_language,
      requiresLanguageReprocess: languageState.pending_memory_language !== null,
      packet,
      stableAnchors,
      estimatedTokens: estimateTokens(packet),
      assembly,
      selected: selectedItems.map(publicMemoryContext),
      stateSnapshots: selectedState.filter(row => finalManifest.stateEvidenceIds.includes(row.item.id) && packet.includes(row.line))
        .map(row => ({ id: row.item.id, text: row.line })),
      injectionManifest: finalManifest,
      memoryToolsAvailable: memoryToolReadiness(db, parsed.chatId).available,
      memoryToolOpportunity: toolOpportunity,
      mcpRequestTimeoutMs:mcpRequestTimeoutMs(mcpSelector.publicConfig),
      perspectiveResolution,
      initialCalibration: initialCalibrationView(db, parsed.chatId),
      lineage,
      omissionReason: packet ? undefined : activeMemoryCount === 0 ? "no_memories" : perspectiveResolution.unresolved ? "unresolved_perspective" : "no_relevance",
      sync: {
        inserted: sync.inserted,
        revised: sync.revised,
        pruned: sync.pruned,
        deleted: sync.deleted,
        truncated: sync.truncated,
      },
      retrievalTrace: { enabled: retrievalTrace.isChatEnabled(parsed.chatId), requestId: traceRequestId },
    });
    const deliveredAtomSet = new Set(finalManifest.atomKeys);
    const finalDecisions = new Map(atomDecisions.map(decision => [decision.atomKey, decision]));
    for (const decision of planAutomaticAtoms(selectedItems, directAtomKeys, atomPolicy)) {
      const old = finalDecisions.get(decision.atomKey);
      finalDecisions.set(decision.atomKey, { ...decision, ...old, outcome: "retained" });
    }
    const atomPreservation = [...finalDecisions.values()].map((decision) => ({ ...decision,
      delivered: deliveredAtomSet.has(decision.atomKey),
      priority: automaticAtomPriorities.get(decision.atomKey),
    }));
    const normalizedPacket = packet.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ");
    const recoveryCandidates = sourceEvidence.recoveryCandidates.flatMap((candidate) => {
      const missingPhrases = candidate.matchedPhrases.filter((phrase) => !normalizedPacket.includes(phrase));
      if (candidate.matchedPhrases.length && !missingPhrases.length) return [];
      return [{ ...candidate, matchedPhrases: missingPhrases }];
    });
    const deliveredSourceEvidence = [
      ...selectedItems.flatMap(item => [
        ...(finalManifest.atomKeys.includes(memorySummaryAtomKey(item) ?? "") ? item.evidence : []),
        ...item.keyDialogues.filter(dialogue => finalManifest.atomKeys.includes(memoryDialogueAtomKey(item.id, dialogue))).flatMap(dialogue => dialogue.evidence),
      ]),
      ...(db.prepare(`SELECT evidence_json FROM memory_details WHERE chat_id=? AND id IN (SELECT value FROM json_each(?))`)
        .all(parsed.chatId, JSON.stringify(finalManifest.detailIds)) as Array<{ evidence_json: string }>).flatMap(row => JSON.parse(row.evidence_json)),
      ...selectedState.filter(row => finalManifest.stateEvidenceIds.includes(row.item.id)).flatMap(row => row.item.citations),
      ...deliveredSources,
      ...([['memories', 'memory:'], ['memory_details', 'detail:'], ['memory_dialogues', 'dialogue:']] as const).flatMap(([table, prefix]) => {
        const ids = (finalStory.supportItemIds ?? []).filter(id => id.startsWith(prefix)).map(id => id.slice(prefix.length));
        return (db.prepare(`SELECT evidence_json FROM ${table} WHERE chat_id=? AND id IN (SELECT value FROM json_each(?))`)
          .all(parsed.chatId, JSON.stringify(ids)) as Array<{ evidence_json: string }>).flatMap(row => JSON.parse(row.evidence_json));
      }),
    ];
    if (queueSourceRecovery(db, parsed.chatId, recoveryCandidates, retrievalSignals.filter((signal) => signal.kind !== "scene").map((signal) => signal.text).join("\n"), deliveredSourceEvidence)) serverWorker.wake();
    const roleTokens: Record<string, number> = {};
    for (const atom of atomPreservation) if (atom.delivered) roleTokens[atom.role] = (roleTokens[atom.role] ?? 0) + atom.tokens;
    // Recovery enqueue/worker startup is still synchronous response work.
    // Include it in finalization rather than stopping the clock at serialization.
    const finalizedAt = performance.now();
    const timings = {
      syncMs: syncFinishedAt - prepareStartedAt,
      embeddingMs: embeddingFinishedAt - syncFinishedAt,
      retrievalMs: retrievalFinishedAt - embeddingFinishedAt,
      assemblyMs: assemblyFinishedAt - retrievalFinishedAt,
      finalizeMs: finalizedAt - assemblyFinishedAt,
      totalMs: finalizedAt - prepareStartedAt,
    };
    if (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) void retrievalTrace.record({
      atomPreservation, roleTokens,
      currentState: stateTrace?.snapshot(),
      timings,
      syncTimings,
      requestBytes: Buffer.byteLength(requestBody, "utf8"),
      id: traceRequestId,
      kind: "automatic_search",
      semanticAtomHits: [...(semantic.atomHits ?? new Map())],
      semanticSourceHits: semantic.sourceHits ?? [],
      sourceEvidenceIds: deliveredSources.map((item) => item.id),
      chatId: parsed.chatId,
      traceContext: parsed.traceContext,
      query: parsed.query,
      querySignals: retrievalSignals,
      tokenBudget: parsed.tokenBudget,
      chatRevision: sync.revision,
      perspectives: retrievalPerspectives,
      promptSourceMessageIds: trustedPromptSourceMessageIds,
      selectedIds: selectedItems.map((item) => item.id),
      selection: {
        seedCounts: storySeedCounts(db,parsed.chatId),
        reasons: Object.fromEntries([...portfolio.reasons].filter(([id]) => finalSelectedIds.has(id))),
        memories: selectedItems.map(item => ({ memoryId: item.id, role: selectedRoles.get(item.id), reason: portfolio.reasons.get(item.id) })),
        classCounts: finalCandidateClassCounts,
        roleCounts: finalRoleCounts,
        roleShares: AUTOMATIC_ROLE_SHARES,
        focusLeaderIds: focusLeaderIds.filter((id) => selectedItems.some((item) => item.id === id)),
        continuityBridgeIds: continuityBridgeIds.filter((id) => selectedItems.some((item) => item.id === id)),
      },
      budget: {
        ...assembly,
        requestedPreset: parsed.memoryBudgetPreset,
        actualTokenBudget: parsed.tokenBudget,
        targetBudget: parsed.tokenBudget,
        hardTokenCeiling,
        storyMaximum: maximumStoryBudget,
        storyReserved: storyBudget,
        storyUsed: finalStory.tokens,
        retrievalBudget,
        candidateMemoryCount: eligibleAtoms.size,
        finalPacketTokens: estimateTokens(packet),
        fillRatio: Number((estimateTokens(packet) / Math.max(1, parsed.tokenBudget)).toFixed(4)),
        overflowTokens: Math.max(0, estimateTokens(packet) - parsed.tokenBudget),
        estimatorHeadroomTokens: Math.max(0, estimateTokens(packet) - parsed.tokenBudget),
      },
      story: {
        ...finalStory.diagnostics,
        semanticCandidateCount: semantic.storyScores?.size ?? 0,
        nodes: finalStory.diagnostics.nodes.map((node) => ({
          ...node,
          semanticHitKind: semantic.storyHits?.get(node.id)?.kind,
          semanticHitScore: semantic.storyHits?.get(node.id)?.score,
        })),
      },
      overlap: {
        promptSourceMessageCount: trustedPromptSourceMessageIds.length,
        promptCoveredMemoryIds: [...new Set(retrievalDiagnostics.flatMap((item) => item.promptCoveredMemoryIds))],
        promptCoveredDetailIds: [...new Set(retrievalDiagnostics.flatMap((item) => item.promptCoveredDetailIds))],
        promptCoveredDialogueIds: [...new Set(retrievalDiagnostics.flatMap((item) => item.promptCoveredDialogueIds))],
        storySuppressedBeatCount: finalStory.diagnostics.suppressedBeatCount,
      },
      continuity: {
        bridgeMemoryIds: [...new Set(retrievalDiagnostics.flatMap((item) => item.bridgeMemoryIds))],
        supplementMemoryIds: [...new Set(retrievalDiagnostics.flatMap((item) => item.continuitySupplementIds))],
        recentMemoryIds: [...recentMemoryIds].filter((id) => selectedItems.some((item) => item.id === id)),
      },
      manifest: finalManifest,
      toolOpportunity,
      packet,
      retrievals: retrievalDiagnostics,
    });
    return response;
  });

  app.get("/v1/chats/:id/lineage", (context) => context.json(getChatLineage(db, context.req.param("id"))));
  app.get("/v1/chats/:id/story-spine", (context) => context.json(listStorySpine(db, context.req.param("id"))));
  app.patch("/v1/chats/:id/story-spine/:groupId", async (context) => {
    const body = await context.req.json() as { pinned?: boolean; hidden?: boolean; summary?: string };
    if (!updateStorySpineGroup(db, context.req.param("id"), context.req.param("groupId"), body)) {
      return context.json({ error: "Story spine group not found or read-only" }, 404);
    }
    void embeddings.indexPending(context.req.param("id"));
    return context.json({ ok: true, ...listStorySpine(db, context.req.param("id")) });
  });
  app.post("/v1/chats/:id/story-spine/rebuild", (context) => {
    const chatId = context.req.param("id");
    invalidateStorySpine(db, chatId);
    const queued = maybeEnqueueStorySpine(db, chatId);
    if (queued) serverWorker.wake();
    void embeddings.indexPending(chatId);
    return context.json({ ok: true, queued, ...listStorySpine(db, chatId) });
  });
  app.get("/v1/chats/:id/initial-calibration", (context) => context.json(initialCalibrationLedger(db, context.req.param("id"))));
  app.post("/v1/chats/:id/initial-calibration/confirm", (context) => {
    try {
      const chatId = context.req.param("id");
      const pending = resolveInitialCalibrationConfirmation(db, chatId, "confirm");
      const chat = db.prepare("SELECT profile,include_user_messages,extraction_group_turns FROM chats WHERE id=?").get(chatId) as { profile: "companion" | "simulation"; include_user_messages: number; extraction_group_turns: number };
      const queuedJobs = enqueueExtractionJobs(db, chatId, chat.profile, pending.forceBackfill, chat.include_user_messages === 1, chat.extraction_group_turns, pending.forceBackfill ? "ledger" : "current", pending.extractionReview, undefined, pending.backfillRunId);
      if (queuedJobs) serverWorker.wake();
      return context.json({ ok: true, queuedJobs, calibration: initialCalibrationLedger(db, chatId) });
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
  });
  app.post("/v1/chats/:id/initial-calibration/skip", (context) => {
    try {
      const chatId = context.req.param("id");
      const pending = resolveInitialCalibrationConfirmation(db, chatId, "skip");
      const chat = db.prepare("SELECT profile,include_user_messages,extraction_group_turns FROM chats WHERE id=?").get(chatId) as { profile: "companion" | "simulation"; include_user_messages: number; extraction_group_turns: number };
      const queuedJobs = enqueueExtractionJobs(db, chatId, chat.profile, pending.forceBackfill, chat.include_user_messages === 1, chat.extraction_group_turns, pending.forceBackfill ? "ledger" : "current", pending.extractionReview, undefined, pending.backfillRunId);
      if (queuedJobs) serverWorker.wake();
      return context.json({ ok: true, queuedJobs, calibration: initialCalibrationLedger(db, chatId) });
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
  });
  app.post("/v1/chats/:id/initial-calibration/retry", async (context) => {
    try {
      const chatId = context.req.param("id");
      const body = await context.req.json().catch(() => ({})) as { resolvedSetup?: unknown; identityHints?: unknown };
      const setupResult = body.resolvedSetup === undefined ? undefined : ResolvedSetupProjectionSchema.safeParse(body.resolvedSetup);
      if (setupResult && !setupResult.success) return context.json({ error: "resolvedSetup is invalid", issues: setupResult.error.issues }, 400);
      if (body.identityHints !== undefined && (typeof body.identityHints !== "object" || body.identityHints === null || Array.isArray(body.identityHints))) {
        return context.json({ error: "identityHints must be an object" }, 400);
      }
      const retry = setupResult?.success
        ? { projection: setupResult.data, identityHints: (body.identityHints ?? {}) as Record<string, unknown> }
        : initialCalibrationRetryInput(db, chatId);
      const queued = db.transaction(() => {
        clearInitialCalibrationDraft(db, chatId);
        if (setupResult?.success) db.prepare(`UPDATE initial_calibrations SET setup_json=?,setup_fingerprint=?,updated_at=? WHERE chat_id=?`)
          .run(JSON.stringify(retry.projection), retry.projection.fingerprint, Date.now(), chatId);
        if (!enqueueInitialCalibration(db, chatId, retry.projection, retry.identityHints, retry.backfillRunId)) throw new Error("Initial calibration is already queued");
        return true;
      })();
      if (queued) serverWorker.wake();
      return context.json({ ok: true, queued, calibration: initialCalibrationLedger(db, chatId) });
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
  });
  app.post("/v1/chats/:id/initial-calibration/entities", async (context) => {
    try {
      const body = await context.req.json() as { displayName?: string; aliases?: string[]; prominence?: "primary" | "supporting" | "reference" };
      const id = upsertInitialEntity(db, context.req.param("id"), { displayName: body.displayName ?? "", aliases: body.aliases, prominence: body.prominence });
      return context.json({ ok: true, id, calibration: initialCalibrationLedger(db, context.req.param("id")) });
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.patch("/v1/chats/:id/initial-calibration/entities/:entityId", async (context) => {
    try {
      const body = await context.req.json() as { displayName?: string; aliases?: string[]; prominence?: "primary" | "supporting" | "reference" };
      upsertInitialEntity(db, context.req.param("id"), { id: context.req.param("entityId"), displayName: body.displayName ?? "", aliases: body.aliases, prominence: body.prominence });
      return context.json({ ok: true, calibration: initialCalibrationLedger(db, context.req.param("id")) });
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.delete("/v1/chats/:id/initial-calibration/entities/:entityId", (context) => {
    try {
      const chatId = context.req.param("id");
      const deleted = deleteInitialEntity(db, chatId, context.req.param("entityId"));
      return deleted
        ? context.json({ ok: true, calibration: initialCalibrationLedger(db, chatId) })
        : context.json({ error: "Initial setup entity not found" }, 404);
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
  });
  app.patch("/v1/chats/:id/initial-calibration/relationships/:baselineId", async (context) => {
    try {
      const body = await context.req.json() as { axes?: Record<string, string>; summary?: string };
      updateInitialRelationship(db, context.req.param("id"), context.req.param("baselineId"), { axes: body.axes ?? {}, summary: body.summary ?? "" });
      return context.json({ ok: true, calibration: initialCalibrationLedger(db, context.req.param("id")) });
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
  });
  app.post("/v1/chats/:id/lineage/probe", async (context) => {
    try {
      const body = LineageProbeRequestSchema.parse(await context.req.json());
      const request = {
        ...body,
        chatId: context.req.param("id"),
        messages: [],
        query: "",
        perspectives: [],
        tokenBudget: 0,
        forceBackfill: false,
        deferExtraction: true,
      };
      return context.json(probeChatLineage(db, request));
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.post("/v1/chats/:id/lineage/apply", async (context) => {
    try {
      const body = LineageProbeApplyRequestSchema.parse(await context.req.json());
      const request = {
        chatTitle: body.chatTitle,
        characterId: body.characterId,
        profile: body.profile,
        messageVisibility: body.messageVisibility,
        lineageHint: body.lineageHint,
        includeUserMessages: body.includeUserMessages,
        extractionGroupTurns: body.extractionGroupTurns,
        memoryLanguage: body.memoryLanguage,
        canonicalizationPolicy: body.canonicalizationPolicy,
        chatId: context.req.param("id"),
        messages: [],
        query: "",
        perspectives: [],
        tokenBudget: 0,
        forceBackfill: false,
        deferExtraction: true,
      };
      const lineage = applyProbedLineage(db, request, body.parentChatId, body.fingerprint);
      return context.json({ ok: true, lineage, queuedJobs: 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return context.json({ error: message }, ["LINEAGE_PROBE_STALE", "LINEAGE_ALREADY_APPLIED", "TARGET_HAS_DERIVED_DATA"].includes(message) ? 409 : 400);
    }
  });
  app.post("/v1/chats/:id/lineage/acknowledge", (context) => context.json({ ok: true, lineage: acknowledgeChatLineage(db, context.req.param("id")) }));
  app.post("/v1/chats/:id/lineage/select", async (context) => {
    try {
      const body = LineageProbeApplyRequestSchema.parse(await context.req.json());
      const chatId = context.req.param("id");
      const lineage = chooseChatLineage(db, chatId, body.parentChatId, { ...body, chatId, messages: [], query: '', perspectives: [],
        tokenBudget: 0, forceBackfill: false, deferExtraction: true }, body.fingerprint);
      return context.json({ ...lineage, queuedJobs: 0 });
    }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.post("/v1/chats/:id/lineage/decline", async (context) => {
    try {
      const body = await context.req.json() as { fingerprint?: string };
      if (!body.fingerprint) return context.json({ error: "fingerprint is required" }, 400);
      return context.json({ ok: true, lineage: declineChatLineage(db, context.req.param("id"), body.fingerprint) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return context.json({ error: message }, message === "LINEAGE_PROBE_STALE" ? 409 : 400);
    }
  });
  app.post("/v1/chats/:id/lineage/revert", (context) => {
    const chatId = context.req.param("id");
    revertChatLineage(db, chatId);
    const chat = db.prepare("SELECT profile,include_user_messages,extraction_group_turns FROM chats WHERE id=?").get(chatId) as { profile: "companion" | "simulation"; include_user_messages: number; extraction_group_turns: number };
    const queued = enqueueExtractionJobs(db, chatId, chat.profile, true, Boolean(chat.include_user_messages), chat.extraction_group_turns);
    if (queued) serverWorker.wake();
    return context.json({ ok: true, lineage: getChatLineage(db, context.req.param("id")) });
  });
  app.post("/v1/chats/:id/lineage/preview", async (context) => {
    try {
      const body = ManualLineagePreviewRequestSchema.parse(await context.req.json());
      return context.json(previewManualLineage(db, context.req.param("id"), body.parentChatId, body.targetMessageInventory, body.target));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return context.json({ error: message }, 400);
    }
  });
  app.post("/v1/chats/:id/lineage/inherit", async (context) => {
    try {
      const body = ManualLineageApplyRequestSchema.parse(await context.req.json());
      const chatId = context.req.param("id");
      const lineage = applyManualLineage(db, chatId, body.parentChatId, body.fingerprint, body.targetMessageInventory, body.replaceDerived, body.target);
      return context.json({ ok: true, lineage, queuedJobs: 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return context.json({ error: message }, ["TARGET_HAS_DERIVED_DATA", "TARGET_INVENTORY_REQUIRED", "LINEAGE_PREVIEW_STALE"].includes(message) ? 409 : 400);
    }
  });
  app.post("/v1/chats/:id/memory-transplant/preview", async (context) => {
    const body = await context.req.json() as { sourceChatId?: string };
    if (!body.sourceChatId) return context.json({ error: "sourceChatId is required" }, 400);
    try { return context.json(previewMemoryTransplant(db, body.sourceChatId, context.req.param("id"))); }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.post("/v1/chats/:id/memory-transplant", async (context) => {
    const body = await context.req.json() as { sourceChatId?: string; fingerprint?: string; replaceDerived?: boolean };
    if (!body.sourceChatId || !body.fingerprint) return context.json({ error: "sourceChatId and fingerprint are required" }, 400);
    const targetChatId = context.req.param("id");
    const preview = previewMemoryTransplant(db, body.sourceChatId, targetChatId);
    if (preview.fingerprint !== body.fingerprint) return context.json({ error: "TRANSPLANT_PREVIEW_STALE" }, 409);
    if (preview.requiresReplacement && !body.replaceDerived) return context.json({ error: "TARGET_HAS_DERIVED_DATA" }, 409);
    const wasPaused = serverWorker.status.state === "paused";
    serverWorker.pause("Transplanting memory from a server chat");
    try {
      const result = transplantCompleteArchive(db, exportCompleteArchive(db), body.sourceChatId, targetChatId);
      void embeddings.indexPending(targetChatId);
      return context.json({ ok: true, ...result });
    } finally { if (!wasPaused) serverWorker.resume("server-chat-transplant"); }
  });

  app.post("/v1/jobs/lease", async (context) => {
    const body = LeaseJobRequestSchema.parse(await context.req.json());
    if (llmStore.config.engine === "server") return context.json({ job: null });
    const job = attachAuxiliaryPlan(db, leaseJob(db, body.workerId, config.leaseSeconds), {
      maxInputTokens: llmStore.config.maxInputTokens, maxOutputTokens: llmStore.config.maxOutputTokens, llmTimeoutMs: llmStore.config.llmTimeoutMs,
    });
    return context.json({ job: job ? { ...job, relaxAuxiliaryCensorship: llmStore.config.relaxAuxiliaryCensorship === true } : null });
  });
  app.post("/v1/jobs/:id/draft", async (context) => {
    const body = await context.req.json() as { workerId?: string; output?: string; storyValidationReason?: string };
    if (typeof body.workerId !== "string" || typeof body.output !== "string") return context.json({ error: "Invalid draft" }, 400);
    const ok = stageJobModelOutput(db, context.req.param("id"), body.output, body.workerId,
      typeof body.storyValidationReason === "string" ? body.storyValidationReason : undefined);
    return ok ? context.json({ ok: true }) : context.json({ error: "Lease not found" }, 409);
  });
  app.post("/v1/jobs/:id/renew", async (context) => {
    const body = await context.req.json() as { workerId?: string };
    if (typeof body.workerId !== "string" || !body.workerId) return context.json({ error: "Invalid lease renewal" }, 400);
    return renewJobLease(db, context.req.param("id"), body.workerId, config.leaseSeconds)
      ? context.json({ ok: true })
      : context.json({ error: "Lease not found" }, 409);
  });
  app.post("/v1/jobs/:id/progress", async (context) => {
    const body = await context.req.json() as { workerId?: string; stage?: string; repairDelta?: number; llmCallStats?: { total?: unknown; repairs?: unknown; byPurpose?: unknown }; llmCallDiagnostic?: { purpose?: unknown; attempt?: unknown; outcome?: unknown; at?: unknown; error?: unknown; code?: unknown; httpStatus?: unknown; risuCall?: unknown } };
    const allowed = new Set<JobPipelineStage>(["queued", "first_extraction", "post_extraction_audit", "state_reconciliation", "ledger_consistency", "relationship_projection", "story_consolidation", "storing", "complete", "failed"]);
    if (!body.workerId || !allowed.has(body.stage as JobPipelineStage)) return context.json({ error: "Invalid pipeline progress" }, 400);
    const repairDelta = Math.min(1, Math.max(0, Math.trunc(Number(body.repairDelta ?? 0))));
    const llmCallStats = body.llmCallStats && Number.isInteger(Number(body.llmCallStats.total)) && Number(body.llmCallStats.total) >= 0
      ? { total: Number(body.llmCallStats.total), repairs: Math.max(0, Number(body.llmCallStats.repairs) || 0), byPurpose: (body.llmCallStats.byPurpose as Record<string, number> | undefined) ?? {} }
      : undefined;
    const rawDiagnostic = body.llmCallDiagnostic;
    const llmCallDiagnostic = rawDiagnostic && typeof rawDiagnostic.purpose === "string" && /^[a-z_]{1,80}$/.test(rawDiagnostic.purpose)
      && Number.isInteger(Number(rawDiagnostic.attempt)) && ["started", "succeeded", "failed"].includes(String(rawDiagnostic.outcome))
      ? { purpose: rawDiagnostic.purpose, attempt: Number(rawDiagnostic.attempt), outcome: String(rawDiagnostic.outcome) as "started" | "succeeded" | "failed", at: Math.max(0, Number(rawDiagnostic.at) || Date.now()),
        risuCall: projectRisuAuxiliaryCallDiagnostic(rawDiagnostic.risuCall),
        ...(RISU_AUXILIARY_FAILURE_CODES.includes(rawDiagnostic.code as any) ? { code: String(rawDiagnostic.code) } : {}),
        ...(typeof rawDiagnostic.httpStatus === "number" && Number.isInteger(rawDiagnostic.httpStatus) && rawDiagnostic.httpStatus >= 100 && rawDiagnostic.httpStatus <= 599 ? { httpStatus: rawDiagnostic.httpStatus } : {}),
        ...(typeof rawDiagnostic.error === "string" ? { error: rawDiagnostic.error.slice(0, 300) } : {}) } : undefined;
    const ok = setJobPipelineStage(db, context.req.param("id"), body.stage as JobPipelineStage, body.workerId, repairDelta, llmCallStats, llmCallDiagnostic);
    return ok ? context.json({ ok: true }) : context.json({ error: "Lease not found" }, 409);
  });
  app.post("/v1/jobs/:id/complete", async (context) => {
    const rawBody = await context.req.json();
    const body = CompleteJobRequestSchema.parse(rawBody);
    const job = db.prepare(`SELECT j.type,j.chat_id,j.payload_json,j.attempts,c.profile,c.memory_language FROM jobs j JOIN chats c ON c.id=j.chat_id
      WHERE j.id=? AND j.lease_owner=? AND j.status='leased'`).get(context.req.param("id"), body.workerId) as { type: string; chat_id: string; payload_json: string; attempts: number; profile: any; memory_language: any } | undefined;
    if (!job) return context.json({ error: "Lease not found" }, 409);
    const expectedLanguage = (JSON.parse(job.payload_json || "{}") as { memoryLanguage?: string }).memoryLanguage ?? job.memory_language;
    if (job.type !== 'memory_group' && job.type !== "relationship_projection" && job.type !== "initial_calibration" && job.type !== "story_consolidation" && job.type !== "ledger_consistency" && job.type !== "quiz" && (body.result as { language?: unknown } | null)?.language !== expectedLanguage) {
      return context.json({ error: `Canonical language must be ${expectedLanguage}` }, 400);
    }
    try {
      const completed = job.type === 'memory_group' ? completeMemoryGroupJob(db, context.req.param('id'), body.workerId, body.result) : job.type === "episode"
        ? completeEpisodeJob(db, context.req.param("id"), body.workerId, EpisodeCapsuleResultSchema.parse(body.result), body.reconciliation, body.audit)
        : job.type === "initial_calibration"
          ? completeInitialCalibrationJob(db, context.req.param("id"), body.workerId, InitialCalibrationResultSchema.parse(body.result))
        : job.type === "relationship_projection"
          ? completeRelationshipProjectionJob(db, context.req.param("id"), body.workerId, RelationshipProjectionResultSchema.parse(body.result))
        : job.type === "quiz"
          ? completeQuizJob(db, context.req.param("id"), body.workerId, body.result)
        : job.type === "story_consolidation"
          ? completeStoryConsolidationById(db, context.req.param("id"), body.workerId, StorySpineConsolidationResultSchema.parse(body.result))
        : job.type === "ledger_consistency"
          ? completeLedgerConsistencyJob(db, buildLedgerConsistencyJob({ id: context.req.param("id"), chatId: job.chat_id, profile: job.profile, memoryLanguage: job.memory_language,
            attempt: job.attempts, payload: JSON.parse(job.payload_json) }), body.workerId, LedgerConsistencyResultSchema.parse(body.result))
          : completeExtractionJob(db, context.req.param("id"), body.workerId, ExtractionAggregateSchema.parse(body.result), body.reconciliation, body.audit);
      if (job.type === "ledger_consistency") {
        finalizeLedgerConsistencyRun(db, completed.chatId, String((JSON.parse(job.payload_json) as { backfillRunId?: string }).backfillRunId ?? ""));
      }
      if (job.type !== "quiz") void embeddings.indexPending(completed.chatId);
      return context.json({ ok: true, warnings: completed.warnings, pendingReconciliations: "pendingReconciliations" in completed ? completed.pendingReconciliations : undefined });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "QUIZ_EMPTY: no valid quiz items") {
        return context.json({ error: message }, 422);
      }
      throw error;
    }
  });
  app.post("/v1/jobs/:id/reconciliation/prepare", async (context) => {
    const body = PrepareReconciliationRequestSchema.parse(await context.req.json());
    const job = db.prepare("SELECT chat_id,type,payload_json FROM jobs WHERE id=? AND lease_owner=? AND status='leased'").get(context.req.param("id"), body.workerId) as { chat_id: string; type: string; payload_json: string } | undefined;
    if (!job) return context.json({ error: "Lease not found" }, 409);
    const jobPayload = JSON.parse(job.payload_json) as { sourceMessageIds?: string[]; auxiliaryBudget?: { maxInputTokens?: number }; serverLlmSnapshot?: { maxInputTokens?: number } };
    const sourceMessageIds = jobPayload.sourceMessageIds ?? [];
    const preparedResult = body.audit?.patch ? applyExtractionAuditPatch(db, job.chat_id, sourceMessageIds, body.result, body.audit.patch).result : body.result;
    if (body.audit?.patch?.keepPendingItemRefs.some((ref) => !ref.startsWith("dialogue:"))) return context.json({ required: false, blocked: true });
    const evidenceIssues = inspectDraftEvidence(db, job.chat_id, sourceMessageIds, preparedResult);
    if (evidenceIssues.some((issue) => issue.blocking)) return context.json({ required: false, candidateSetHash: "", blocked: true, groundingDraft: preparedResult, evidenceIssues });
    if ((jobPayload as any).regenerationRunId) return context.json({ required: false, groundingDraft: preparedResult, evidenceIssues });
    const maxInputTokens = jobPayload.auxiliaryBudget?.maxInputTokens ?? jobPayload.serverLlmSnapshot?.maxInputTokens ?? 80_000;
    const prepared = usesStateExtraction(job.type, jobPayload)
      ? prepareStateExtraction(db, job.chat_id, sourceMessageIds, preparedResult, maxInputTokens, job.type === 'memory_addition'
        ? { userRequest: (jobPayload as any).userRequest, existingMemories: (jobPayload as any).existingMemories } : undefined)
      : prepareReconciliation(db, job.chat_id, preparedResult, maxInputTokens);
    (jobPayload as any).auxiliaryPromptParts = prepared.parts?.map((part) => ({ purpose: "reconciliation", systemPrompt: part.systemPrompt, userPrompt: part.userPrompt })) ?? [];
    db.prepare("UPDATE jobs SET payload_json=?,updated_at=? WHERE id=? AND lease_owner=? AND status='leased'").run(JSON.stringify(jobPayload), Date.now(), context.req.param("id"), body.workerId);
    const parts = prepared.parts?.map((part) => ({ ...part, cachedResult: cachedAuxiliaryPage(jobPayload as any, "reconciliation", part.systemPrompt, part.userPrompt) }));
    return context.json({ required: prepared.required, candidateSetHash: prepared.candidateSetHash, systemPrompt: prepared.systemPrompt,
      userPrompt: prepared.userPrompt, parts, ...(evidenceIssues.length ? { groundingDraft: preparedResult, evidenceIssues } : {}) });
  });
  app.get("/v1/update/status", async (context) => {
    const refresh = context.req.query("refresh") === "1";
    return context.json(refresh ? await updateService.check() : updateService.status());
  });
  app.post("/v1/update/stage", async (context) => {
    try { return context.json(await updateService.stageServer()); }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
  });
  app.post("/v1/update/apply", (context) => {
    if (managedRestartScheduled) return context.json({ error: "A server restart is already scheduled" }, 409);
    if (serverWorker.status.activeCalls > 0) return context.json({ error: "보조 모델 처리가 끝난 뒤 업데이트해 주세요." }, 409);
    const status = updateService.status();
    const targetVersion = updateService.restartTargetVersion();
    if (!status.restartRequired || !targetVersion) return context.json({ error: "No staged server update is ready" }, 409);
    if (!status.canApplyAutomatically) return context.json({ error: "Automatic restart is unavailable for this installation" }, 409);
    try {
      restartScheduler(config, targetVersion);
      managedRestartScheduled = true;
      return context.json({ accepted: true, targetVersion });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });
  app.post("/v1/jobs/:id/validated-auxiliary-part", async (context) => {
    const body = await context.req.json() as Record<string, unknown>;
    if (typeof body.workerId !== "string" || typeof body.systemPrompt !== "string" || typeof body.userPrompt !== "string" ||
      !["initial_calibration", "ledger_consistency", "reconciliation"].includes(String(body.purpose))) return context.json({ error: "Invalid validated auxiliary page" }, 400);
    try {
      const key = storeValidatedAuxiliaryPage(db, context.req.param("id"), body.workerId, { purpose: body.purpose as any,
        systemPrompt: body.systemPrompt, userPrompt: body.userPrompt, result: body.result });
      return context.json({ ok: true, key });
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 409); }
  });
  app.post("/v1/jobs/:id/fail", async (context) => {
    const body = FailJobRequestSchema.parse(await context.req.json());
    const failedJob = db.prepare("SELECT chat_id,type,payload_json FROM jobs WHERE id=? AND lease_owner=? AND status='leased'").get(context.req.param("id"), body.workerId) as { chat_id: string; type: string; payload_json: string } | undefined;
    const result = failJob(db, context.req.param("id"), body.workerId, body.error);
    if (result?.status === "failed" && failedJob?.type === "ledger_consistency") {
      finalizeLedgerConsistencyRun(db, failedJob.chat_id, String((JSON.parse(failedJob.payload_json) as { backfillRunId?: string }).backfillRunId ?? ""));
    }
    return result ? context.json({ ok: true, ...result }) : context.json({ error: "Lease not found" }, 409);
  });

  app.post("/v1/chats/:id/recall", async (context) => {
    const recallSignal=AbortSignal.any([context.req.raw.signal,AbortSignal.timeout(mcpRequestTimeoutMs(mcpSelector.publicConfig)-5_000)]);
    const handlerStarted = performance.now();
    const body = RecallRequestSchema.parse(await context.req.json());
    if (!db.prepare("SELECT 1 FROM chats WHERE id=?").get(context.req.param("id"))) {
      const answers = [{ question: body.query, evidence: [], alreadyPresent: false }];
      return context.json({ answers, packet: renderMcpAnswer(answers), selected: [], deliveredAtomKeys: [], deliveredSourceRanges: [],
        archiveEmpty: true, timings: { serverMs: performance.now() - handlerStarted, rerankCalls: 0, rerankTotalTokens: 0 } });
    }
    if (body.memoryGeneration && !memoryReferences.ensure(context.req.param("id"), body.memoryGeneration)) return context.json({ answers: [], opportunityError: "stale_turn", newAtomCount: 0, error: "The request generation is no longer current." });
    const embeddingStarted = performance.now();
    const semanticResults = await embeddings.searchBatchDetailed([body.query], context.req.param("id"));
    const embeddingMs = performance.now() - embeddingStarted;
    const retrievalStarted = performance.now();
    const semantic = semanticResults[0]!;
    const storyScores = new Map(semantic.storyScores ?? []);
    const arcExpansion = expandArcHits(db, context.req.param("id"), body.activePerspectives?.length ? body.activePerspectives : [body.perspective], storyScores);
    let result = retrieve(db, {
      chatId: context.req.param("id"), query: body.query, perspective: body.perspective,
      intent: "recall", tokenBudget: body.tokenBudget, semanticScores: semantic.scores,
      memoryOnlyInjection: body.memoryOnlyInjection,
        stateScores: semantic.stateScores, semanticHits: semantic.hits,
        semanticAtomHits: semantic.atomHits,
      arcMemoryScores: arcExpansion.memoryScores,
      arcDetailScores: arcExpansion.detailScores,
      arcDialogueIds: arcExpansion.dialogueIds,
      arcExpansionDiagnostics: arcExpansion.diagnostics,
      reinforce: true, deferReinforcement: true, mcpCandidatesOnly: true, aspects: undefined, excludeMemoryIds: [],
      excludeMemorySignatures: [],
      alreadyPresentMemoryIds: body.alreadyPresentMemoryIds,
      alreadyPresentAtomKeys: [],
      excludeAtomKeys: [],
      promptSourceMessageIds: body.promptSourceMessageIds,
      activePerspectives: body.activePerspectives,
      collectDiagnostics: retrievalTrace.enabled,
    });
    const deliverySource = "search" as const;
    const opportunityCurrent = opportunityTurnIsCurrent(db, context.req.param("id"), body.traceContext?.latestMessageId);
    const retrievalMs = performance.now() - retrievalStarted;
    const queriedCharacters = mentionedCharacters(db, context.req.param("id"), body.query);
    const namesBudget = Math.min(200, Math.floor(body.tokenBudget * .1));
    const finalizationStarted = performance.now();
    let finalized: Awaited<ReturnType<typeof finalizeMcpAnswer>>;
    try {
      finalized = await finalizeMcpAnswer(db, context.req.param("id"), result, {
        archiveView: ["narrator", "omniscient", "omniscient narrator"].includes(body.perspective.trim().toLowerCase()),
        memoryOnlyInjection: body.memoryOnlyInjection,
        query: body.query, aspects: undefined,
        tokenBudget: body.tokenBudget - namesBudget, perspectives: body.activePerspectives?.length ? body.activePerspectives : [body.perspective],
        promptIds: body.promptSourceMessageIds, excludedAtoms: [...(body.alreadyPresentAtomKeys ?? []), ...(body.excludeAtomKeys ?? [])],
        excludedSourceRanges: body.excludeSourceRanges, currentMessageId: body.traceContext?.latestMessageId,
        semantic: semanticResults, referenceMemoryId: undefined,
        selector:mcpSelector, signal:recallSignal,
        isCurrent:()=>!body.memoryGeneration||memoryReferences.current(context.req.param("id"),body.memoryGeneration),
      });
    } catch (error) {
      const rerankMs = performance.now() - finalizationStarted;
      const timings = { embeddingMs, retrievalMs, rerankMs, finalizationMs: rerankMs, serverMs: performance.now() - handlerStarted };
      const kind = error instanceof RerankerUnavailableError ? error.kind : "unexpected";
      if (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) await retrievalTrace.record({ id: body.traceContext?.requestId ?? randomUUID(), kind:"mcp_search", chatId:context.req.param("id"),
        traceContext:body.traceContext, query:body.query, aspects:undefined, intent:"recall", outcome:"communication_failure",
        failureStage:"rerank", failureKind:kind, timings, elapsedMs:timings.serverMs });
      return context.json({ error:"MCP evidence verification service unavailable", code:"MCP_RERANK_UNAVAILABLE", failureKind:kind, timings }, 503);
    }
    if (body.memoryGeneration && memoryReferences.current(context.req.param("id"), body.memoryGeneration)) {
      for (const answer of result.answers ?? []) for (const evidence of answer.evidence) {
        if (evidence.memoryId) evidence.ref = memoryReferences.issue(context.req.param("id"), body.memoryGeneration, evidence.memoryId);
      }
      result.packet = renderMcpAnswer(result.answers ?? [], id => memoryReferences.issue(context.req.param("id"), body.memoryGeneration!, id));
      result.estimatedTokens = estimateTokens(result.packet);
    }
    const involvedCharacters = queriedCharacters.length ? [...new Set([...queriedCharacters, ...result.selected.flatMap(item => item.participants)])] : [];
    const names = renderSceneNames(db, context.req.param("id"),
      [body.perspective, ...involvedCharacters], involvedCharacters, [], namesBudget);
    result.packet = appendSceneNames(result.packet, names);
    result.estimatedTokens = estimateTokens(result.packet);
    const spanRerankTokens=finalized.sourceSpans.usage?.total_tokens;
    const timings = { embeddingMs, retrievalMs, rerankMs: finalized.rerank.elapsedMs,
      rerankCalls: finalized.rerank.calls, spanRerankMs: finalized.sourceSpans.elapsedMs,
      spanRerankCalls: finalized.sourceSpans.calls, finalizationMs: performance.now() - finalizationStarted,
      serverMs: performance.now() - handlerStarted,
      selectorCalls:Number(finalized.selector?.calls??0),
      selectorMs:Number(finalized.selector?.elapsedMs??0),
      rerankTokens:0,rerankUsageCalls:0,
      ...(spanRerankTokens===undefined?{}:{spanRerankTokens,spanRerankUsageCalls:finalized.sourceSpans.usage!.calls_with_usage}),
      rerankTotalTokens:spanRerankTokens??0 };
    const traceRequestId = body.traceContext?.requestId ?? randomUUID();
    if (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) await retrievalTrace.record({
      id: traceRequestId,
      kind: "mcp_search",
      names: { pairCount: names.pairCount, omittedCount: names.omittedCount },
      selector: finalized.selector,
      timings, elapsedMs: timings.serverMs,
      answers: publicMcpAnswers(result.answers ?? []),
      chatId: context.req.param("id"),
      traceContext: body.traceContext,
      query: body.query,
      aspects: undefined,
      intent: "recall",
      promptSourceMessageIds: body.promptSourceMessageIds,
      excludedMemoryIds: body.excludeMemoryIds,
      alreadyPresentMemoryIds: body.alreadyPresentMemoryIds,
      alreadyPresentAtomKeys: body.alreadyPresentAtomKeys,
      excludedAtomKeys: body.excludeAtomKeys,
      excludedSourceRanges: body.excludeSourceRanges,
      deliveredAtomKeys: result.deliveredAtomKeys,
      alreadyProvidedAtomKeys: result.answers?.flatMap(answer => (answer.alreadyProvidedEvidence ?? []).map(evidence => evidence.atomKey)) ?? [],
      deliveredSourceRanges: result.deliveredSourceRanges,
      deliverySource,
      newAtomCount: result.deliveredAtomKeys.filter(key => ![...(body.alreadyPresentAtomKeys ?? []), ...(body.excludeAtomKeys ?? [])].includes(key)).length,
      opportunityCurrent,
      opportunityCandidateIds: body.opportunityMemoryIds,
      selectedIds: result.selected.map((item) => item.id),
      coverage: result.coverage,
      packet: result.packet,
      retrieval: result.diagnostics,
    });
    const followableMemoryIds = result.mcpFollowableMemoryIds ?? [];
    const { diagnostics: _diagnostics, eligibleCandidates: _eligible, mcpSearchEnvelopes: _envelopes,
      mcpFollowableMemoryIds: _followable, directAtomKeys: _direct, structuredManifest: _structured, ...publicResult } = result;
    const opportunityError = !opportunityCurrent && (result.deliveredAtomKeys?.length ?? 0) === 0 ? "stale_turn" : undefined;
    return context.json({ ...publicResult, selected: result.selected.map(publicMemoryContext), answers: publicMcpAnswers(result.answers ?? []), timings, followableMemoryIds, deliverySource, newAtomCount: result.deliveredAtomKeys.filter(key => ![...(body.alreadyPresentAtomKeys ?? []), ...(body.excludeAtomKeys ?? [])].includes(key)).length, ...(opportunityError ? { opportunityError } : {}) });
  });
  app.post("/v1/chats/:id/expand", async (context) => {
    const started = performance.now();
    const body = ExpandRequestSchema.parse(await context.req.json());
    const chatId = context.req.param("id");
    const reject = async (code: string, reason: string, error: string) => {
      if (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) await retrievalTrace.record({
        id: randomUUID(), kind: "mcp_delivery", chatId, traceContext: body.traceContext,
        toolName: "expand_rp_memory", ref: body.ref, query: body.focus ?? "", intent: "expand",
        outcome: "rejected", reason, origin: "server", selectedIds: [], response: error,
        elapsedMs: performance.now() - started,
      });
      return context.json({ answers: [], code, error });
    };
    const memoryId = memoryReferences.resolve(chatId, body.ref);
    if (!memoryId) return reject("INVALID_MEMORY_REF", "invalid_ref", INVALID_MEMORY_REF_MESSAGE);
    const version = memoryReferences.version(chatId, memoryId);
    const result = retrieve(db, { chatId, query: body.focus ?? "", perspective: body.perspective,
      memoryOnlyInjection: body.memoryOnlyInjection,
      tokenBudget: body.tokenBudget, seedMemoryId: memoryId, followAllDetails: true,
      reinforce: true, deferReinforcement: true, mcpCandidatesOnly: true,
      activePerspectives: body.activePerspectives, collectDiagnostics: retrievalTrace.enabled });
    result.eligibleCandidates = result.eligibleCandidates.filter(item => item.id === memoryId);
    if (!result.eligibleCandidates.length) return reject("INVALID_MEMORY_REF", "invalid_ref", INVALID_MEMORY_REF_MESSAGE);
    result.answers = [];
    const involved = [...new Set(result.eligibleCandidates.flatMap(item => item.participants))];
    const namesBudget = Math.min(200, Math.floor(body.tokenBudget * .1));
    await finalizeMcpAnswer(db, chatId, result, { archiveView: ["narrator", "omniscient", "omniscient narrator"].includes(body.perspective.trim().toLowerCase()), query: body.focus ?? "",
      tokenBudget: body.tokenBudget - namesBudget, perspectives: body.activePerspectives ?? [body.perspective], excludedAtoms: [],
      semantic: [], seedMemoryId: memoryId });
    // A change before the request is allowed; a change during assembly is not.
    if (version !== memoryReferences.version(chatId, memoryId)) return reject("MEMORY_SNAPSHOT_CHANGED", "snapshot_changed", "The memory changed during this request. Retry against the current chat.");
    for (const answer of result.answers ?? []) for (const evidence of answer.evidence) if (evidence.memoryId === memoryId) evidence.ref = body.ref;
    const names = renderSceneNames(db, chatId, [body.perspective, ...involved], involved,
      mentionedCharacters(db, chatId, body.focus ?? ""), namesBudget);
    result.packet = appendSceneNames(renderMcpAnswer(result.answers ?? []), names);
    result.estimatedTokens = estimateTokens(result.packet);
    const timings = { serverMs: performance.now() - started, rerankCalls: 0, rerankTotalTokens: 0 };
    if (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) await retrievalTrace.record({
      id: body.traceContext?.requestId ?? randomUUID(), kind: "mcp_search", chatId,
      traceContext: body.traceContext, query: body.focus ?? "Expand the referenced record", intent: "expand",
      names: { pairCount: names.pairCount, omittedCount: names.omittedCount },
      answers: publicMcpAnswers(result.answers ?? []), selectedIds: result.selected.map(item => item.id), packet: result.packet,
      deliveredAtomKeys: result.deliveredAtomKeys, deliveredSourceRanges: result.deliveredSourceRanges,
      retrieval: result.diagnostics, timings, elapsedMs: timings.serverMs, deliverySource: "reference",
    });
    return context.json({ answers: publicMcpAnswers(result.answers ?? []), packet: result.packet, selected: result.selected.map(publicMemoryContext),
      deliveredAtomKeys: result.deliveredAtomKeys, deliveredSourceRanges: result.deliveredSourceRanges,
      timings });
  });

  app.post("/v1/turn/delivery", async (context) => {
    const body = await context.req.json().catch(() => undefined) as { chatId?: unknown; memoryIds?: unknown } | undefined;
    if (!body || typeof body.chatId !== "string" || !Array.isArray(body.memoryIds)
      || body.memoryIds.length > 512 || !body.memoryIds.every(id => typeof id === "string")) {
      return context.json({ error: "Invalid memory delivery receipt" }, 400);
    }
    recordAutomaticDelivery(db, body.chatId, body.memoryIds);
    // Risu plugin API v3 rebuilds responses as new Response(body, init); a 204 with any body throws there.
    return context.json({ ok: true });
  });

  if (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) app.post("/v1/diagnostics/retrieval-events", async (context) => {
    const body = await context.req.json().catch(() => undefined) as RetrievalTraceEvent | undefined;
    if (!body || typeof body.id !== "string" || typeof body.chatId !== "string"
      || !["automatic_injection", "mcp_delivery", "tool_exposure"].includes(body.kind)) {
      return context.json({ error: "Invalid retrieval trace event" }, 400);
    }
    await retrievalTrace.record(body);
    // Risu plugin API v3 rebuilds responses as new Response(body, init); a 204 with any body throws there.
    return context.json({ ok: true });
  });

  app.get("/v1/admin/chats", (context) => context.json({ items: listAdminChats(db, retrievalTrace.dashboardAvailable) }));
  if (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) app.put("/v1/admin/chats/:id/retrieval-diagnostics", async (context) => {
    if (!retrievalTrace.dashboardAvailable) return context.json({ error: "Not found" }, 404);
    const body = await context.req.json().catch(() => undefined) as { enabled?: unknown } | undefined;
    if (typeof body?.enabled !== "boolean") return context.json({ error: "enabled must be boolean" }, 400);
    try {
      retrievalTrace.setChatEnabled(context.req.param("id"), body.enabled);
      return context.json({ ok: true, enabled: retrievalTrace.isChatEnabled(context.req.param("id")) });
    } catch {
      return context.json({ error: "Chat not found" }, 404);
    }
  });
  app.get("/v1/admin/chats/:id/source-ledger", (context) => {
    try {
      return context.json(listSourceLedger(
        db,
        context.req.param("id"),
        Number(context.req.query("offset") ?? 0),
        Number(context.req.query("limit") ?? 50),
        context.req.query("includeContent") === "true",
      ));
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 404);
    }
  });
  let connectionTestBusy = false;
  app.post("/v1/admin/connection-test", async context => {
    const body = await context.req.json().catch(() => null);
    if (!body || !["voyage", "server", "mcp", "translation"].includes(body.target)) return context.json({ error: "연결 확인 대상을 선택해 주세요." }, 400);
    if (connectionTestBusy) return context.json({ error: "다른 연결 확인이 끝난 뒤 다시 시도해 주세요." }, 409);
    connectionTestBusy = true;
    const started = performance.now();
    try {
      const signal = AbortSignal.any([context.req.raw.signal, AbortSignal.timeout(60_000)]);
      if (body.target !== "voyage" && typeof body.config?.endpoint === "string" && !body.config.endpoint.trim()) {
        throw Object.assign(new Error("Missing endpoint"), { code: "ENDPOINT_MISSING" });
      }
      if (body.target === "voyage") {
        if (body.apiKey !== undefined && typeof body.apiKey !== "string") throw new Error("Invalid key");
        await embeddings.testConnection(body.apiKey?.trim() || undefined);
      } else if (body.target === "server") {
        await llmStore.testConnection(ServerLlmConfigSchema.parse(body.config), signal);
      } else if (body.target === "translation") {
        await translationConnection.testConnection(body.config, signal);
      } else {
        await mcpSelector.testConnection(body.config, signal);
      }
      return context.json({ ok: true, elapsedMs: Math.round(performance.now() - started) });
    } catch (error) {
      const status = error instanceof ProviderRequestError || error instanceof EmbeddingRequestError ? error.status : undefined;
      const localCode = (error as { code?: string })?.code;
      const code: ConnectionFailureCode = localCode === "ENDPOINT_MISSING" ? "ENDPOINT_MISSING"
        : status === 401 || status === 403 || localCode === "AUTH_FAILED" ? "AUTH_FAILED"
        : status === 404 ? "MODEL_NOT_FOUND" : status === 429 ? "RATE_LIMITED"
        : status === 408 || status === 504 || error instanceof ProviderRequestError && error.kind === "timeout"
          || error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "TIMEOUT"
        : error instanceof ProviderRequestError && error.kind === "transport" ? "NETWORK_ERROR"
        : status ? "PROVIDER_HTTP_ERROR"
        : error instanceof ProviderRequestError && error.kind === "json" || localCode === "INVALID_RESPONSE" ? "INVALID_RESPONSE" : "INVALID_CONFIG";
      const detail = error instanceof ProviderRequestError ? error.providerMessage : undefined;
      return context.json({ ok: false, code, message: connectionFailureReason(code), ...(detail ? { detail } : {}), ...(status ? { status } : {}), elapsedMs: Math.round(performance.now() - started) });
    } finally { connectionTestBusy = false; }
  });
  app.post("/v1/admin/translation/initialize",async context=>{
    try{return context.json({config:translationConnection.initialize(await context.req.json())});}
    catch{return context.json({code:"INVALID_CONFIG",error:"Invalid translation settings"},400);}
  });
  app.put("/v1/admin/translation",async context=>{
    try{return context.json({config:translationConnection.update(await context.req.json())});}
    catch(error){return context.json({code:"INVALID_CONFIG",error:error instanceof Error?error.message:"Invalid translation settings"},400);}
  });
  app.delete("/v1/admin/translation-key",context=>{translationConnection.clearDedicatedKey();return context.json({config:translationConnection.publicConfig});});
  app.get("/v1/admin/mcp-selector",context=>context.json({config:mcpSelector.publicConfig}));
  app.put("/v1/admin/mcp-selector",async context=>{
    try{return context.json({config:mcpSelector.update(await context.req.json())});}
    catch(error){return context.json({error:error instanceof Error?error.message:"Invalid MCP model settings"},400);}
  });
  app.delete("/v1/admin/mcp-selector-key",context=>{mcpSelector.clearDedicatedKey();return context.json({config:mcpSelector.publicConfig});});
  app.get("/v1/admin/server-llm", (context) => context.json({ config: llmStore.publicConfig, worker: serverWorker.status }));
  app.post("/v1/admin/auxiliary/translation-plan", async context => {
    const body = await context.req.json();
    const parsed = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })).max(10000), maxOutput: z.number().int().min(256).max(128000).default(8000) }).safeParse(body);
    if (!parsed.success) return context.json({ code: "INVALID_CONFIG", error: "Invalid translation plan" }, 400);
    const batches = planTranslation(parsed.data.items, parsed.data.maxOutput);
    return context.json({ parts: batches.map(items => ({ systemPrompt: withAuxiliaryStoryFraming([{ role: "system", content: translationSystemPrompt }], llmStore.config.relaxAuxiliaryCensorship === true)[0]!.content, userPrompt: JSON.stringify({ items }), items })) });
  });
  app.post("/v1/translations/batch", async context => {
    const parsed = TranslationLegacySettingsSchema.extend({
      items: z.array(z.object({ id: z.string().max(512), text: z.string(), partIndex: z.number().int().nonnegative(), partCount: z.number().int().positive() })).min(1).max(10000),
    }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ code: "INVALID_CONFIG", error: "Invalid translation batch" }, 400);
    const body = parsed.data;
    let apiKey = "";
    try {
      const resolved = translationConnection.resolve(body);
      const config = resolved.config; apiKey = resolved.apiKey;
      if (!apiKey) throw new TranslationError("AUTH_FAILED", "번역 연결의 인증정보가 없습니다.");
      if (estimateTokens(JSON.stringify({ items: body.items })) > Math.floor(config.maxOutputTokens / 1.5)) throw new TranslationError("INVALID_CONFIG", "Translation batch exceeds output budget");
      const result = await requestStructuredProvider(llmStore, config, apiKey,
        [{ role: "system", content: translationSystemPrompt }, { role: "user", content: JSON.stringify({ items: body.items }) }],
        AbortSignal.any([context.req.raw.signal, AbortSignal.timeout(TRANSLATION_TIMEOUT_MS)]), config.maxOutputTokens);
      return context.json({ items: validateTranslation(result.content, body.items, result.finishReason), usage: result.usage, model: config.model });
    } catch (error) {
      const code = error instanceof TranslationError ? error.code : error instanceof ProviderRequestError
        ? error.kind === "timeout" ? "TIMEOUT" : error.kind === "json" ? "INVALID_RESPONSE" : error.kind === "transport" ? "NETWORK_ERROR" : error.status === 401 || error.status === 403 ? "AUTH_FAILED" : error.status === 429 ? "RATE_LIMITED" : "PROVIDER_HTTP_ERROR"
        : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "TIMEOUT" : "INVALID_CONFIG";
      return context.json({ code, error: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error), [apiKey]) }, 502);
    }
  });
  app.put("/v1/admin/server-llm", async (context) => {
    const input = ServerLlmConfigSchema.parse(await context.req.json());
    const publicConfig = llmStore.update(input);
    embeddings.setTimeoutMs(publicConfig.embeddingTimeoutMs);
    if (reranker instanceof VoyageReranker) reranker.setTimeoutMs(publicConfig.rerankTimeoutMs);
    config.embeddingTimeoutMs = publicConfig.embeddingTimeoutMs;
    config.rerankTimeoutMs = publicConfig.rerankTimeoutMs;
    config.llmTimeoutMs = publicConfig.llmTimeoutMs;
    serverWorker.configChanged();
    return context.json({ ok: true, config: publicConfig, worker: serverWorker.status });
  });
  app.delete("/v1/admin/server-llm-key", (context) => {
    llmStore.clearKey();
    if (config.llmApiKeys) delete config.llmApiKeys[llmStore.config.provider];
    serverWorker.pause("Server LLM API key removed");
    return context.json({ ok: true, config: llmStore.publicConfig, worker: serverWorker.status });
  });
  app.post("/v1/worker/heartbeat", async (context) => {
    const body = WorkerControlSchema.parse(await context.req.json());
    serverWorker.heartbeat(body.workerId);
    return context.json({ ok: true, worker: body.chatId ? serverWorker.statusForChat(body.chatId) : serverWorker.status });
  });
  app.post("/v1/worker/resume", async (context) => {
    const body = WorkerControlSchema.parse(await context.req.json());
    return context.json({ ok: true, worker: serverWorker.resume(body.workerId) });
  });
  app.post("/v1/worker/pause", (context) => context.json({ ok: true, worker: serverWorker.pause() }));
  app.put("/v1/admin/voyage-key", async (context) => {
    const body = await context.req.json() as { apiKey?: unknown };
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) return context.json({ error: "apiKey is required" }, 400);
    await embeddings.validateAndSetApiKey(apiKey);
    saveVoyageKey(config.secretsPath, apiKey);
    config.voyageApiKey = apiKey;
    embeddings.warm();
    return context.json({ ok: true, embedding: embeddings.status });
  });
  app.delete("/v1/admin/voyage-key", (context) => {
    saveVoyageKey(config.secretsPath, null);
    config.voyageApiKey = "";
    embeddings.clearApiKey();
    return context.json({ ok: true, embedding: embeddings.status });
  });

  app.delete("/v1/chats/:id/derived", (context) => {
    try {
      const ok = resetDerivedChat(db, embeddings, context.req.param("id"));
      return ok ? context.json({ ok }) : context.json({ error: "Chat not found" }, 404);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });
  app.post("/v1/chats/:id/reprocess", async (context) => {
    try {
      const chatId = context.req.param("id");
      const body = await context.req.json().catch(() => ({})) as {
        activatePendingMemoryLanguage?: unknown;
        extractionReviewOverride?: unknown;
        resolvedSetup?: unknown;
        identityHints?: unknown;
        expectedSourceMessages?: unknown;
      };
      if (body.activatePendingMemoryLanguage !== undefined && typeof body.activatePendingMemoryLanguage !== "boolean") return context.json({ error: "activatePendingMemoryLanguage must be boolean" }, 400);
      if (body.extractionReviewOverride !== undefined && typeof body.extractionReviewOverride !== "boolean") return context.json({ error: "extractionReviewOverride must be boolean" }, 400);
      if (body.expectedSourceMessages !== undefined && (!Number.isInteger(body.expectedSourceMessages) || Number(body.expectedSourceMessages) < 0)) return context.json({ error: "expectedSourceMessages must be a non-negative integer" }, 400);
      const setupResult = body.resolvedSetup === undefined ? undefined : ResolvedSetupProjectionSchema.safeParse(body.resolvedSetup);
      if (setupResult && !setupResult.success) return context.json({ error: "resolvedSetup is invalid", issues: setupResult.error.issues }, 400);
      if (body.identityHints !== undefined && (typeof body.identityHints !== "object" || body.identityHints === null || Array.isArray(body.identityHints))) {
        return context.json({ error: "identityHints must be an object" }, 400);
      }
      const chat = db.prepare("SELECT profile,include_user_messages,extraction_group_turns FROM chats WHERE id=?").get(chatId) as
        | { profile: "companion" | "simulation"; include_user_messages: number; extraction_group_turns: number }
        | undefined;
      if (!chat) return context.json({ error: "Chat not found" }, 404);
      if (body.expectedSourceMessages !== undefined) {
        const stored = db.prepare(`SELECT COUNT(*) count FROM messages WHERE chat_id=? AND content IS NOT NULL AND lifecycle IN ('committed','pending')`).get(chatId) as { count: number };
        if (stored.count !== body.expectedSourceMessages) {
          return context.json({
            error: `Full source synchronization is incomplete: expected ${body.expectedSourceMessages}, stored ${stored.count}.`,
            code: "SOURCE_LEDGER_INCOMPLETE",
            expectedSourceMessages: body.expectedSourceMessages,
            storedSourceMessages: stored.count,
          }, 409);
        }
      }
      const calibrationBefore = initialCalibrationView(db, chatId);
      const needsCalibration = ["unseeded", "awaiting_setup", "failed"].includes(calibrationBefore.status);
      if (["queued", "awaiting_confirmation"].includes(calibrationBefore.status)) {
        return context.json({ error: "Initial calibration is already in progress", code: "INITIAL_CALIBRATION_IN_PROGRESS", calibration: calibrationBefore }, 409);
      }
      if (needsCalibration && !setupResult?.success) {
        return context.json({
          error: "Rendered setup is required before the first cold start. Run one normal chat request, then try rebuilding again.",
          code: "INITIAL_SETUP_REQUIRED",
          calibration: calibrationBefore,
        }, 409);
      }
      recanonicalizeSourceLedger(db, chatId);
      const pendingMessages = reprocessChat(db, embeddings, chatId, body.activatePendingMemoryLanguage === true);
      if (needsCalibration && setupResult?.success) {
        const operationRunId = randomUUID();
        beginInitialCalibration(db, chatId, "cold_start", setupResult.data, {
          confirmationRequired: true,
          forceBackfill: true,
          extractionReview: body.extractionReviewOverride as boolean | undefined,
        });
        const queued = enqueueInitialCalibration(
          db,
          chatId,
          setupResult.data,
          (body.identityHints ?? {}) as Record<string, unknown>,
          operationRunId,
        );
        if (queued) serverWorker.wake();
        const language = db.prepare("SELECT memory_language,pending_memory_language FROM chats WHERE id=?").get(chatId) as { memory_language: string; pending_memory_language: string | null };
        return context.json({
          ok: true,
          pendingMessages,
          queuedJobs: queued ? 1 : 0,
          awaitingCalibration: true,
          calibration: initialCalibrationView(db, chatId),
          memoryLanguage: language.memory_language,
          pendingMemoryLanguage: language.pending_memory_language,
        });
      }
      const queuedJobs = enqueueExtractionJobs(db, chatId, chat.profile, true, chat.include_user_messages !== 0, chat.extraction_group_turns, "ledger", body.extractionReviewOverride as boolean | undefined, undefined, randomUUID());
      if (queuedJobs > 0) serverWorker.wake();
      const language = db.prepare("SELECT memory_language,pending_memory_language FROM chats WHERE id=?").get(chatId) as { memory_language: string; pending_memory_language: string | null };
      return context.json({ ok: true, pendingMessages, queuedJobs, memoryLanguage: language.memory_language, pendingMemoryLanguage: language.pending_memory_language });
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });
  app.delete("/v1/chats/:id", (context) => {
    try {
      const deletedChats = deleteChats(db, embeddings, [context.req.param("id")]);
      return deletedChats ? context.json({ ok: true, deletedChats }) : context.json({ error: "Chat not found" }, 404);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });
  app.delete("/v1/characters/:id", (context) => {
    const chatIds = (db.prepare("SELECT id FROM chats WHERE character_id=?").all(context.req.param("id")) as Array<{ id: string }>).map((row) => row.id);
    try {
      const deletedChats = deleteChats(db, embeddings, chatIds);
      return deletedChats ? context.json({ ok: true, deletedChats }) : context.json({ error: "Character not found" }, 404);
    } catch (error) {
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  function readDashboardSocialKnowledge(chatId: string) {
    const jobs = db.prepare(`SELECT status,COUNT(*) count FROM jobs WHERE chat_id=? AND type='social_backfill' GROUP BY status`).all(chatId) as Array<{ status: string; count: number }>;
    return { items: listSocialKnowledge(db, chatId), jobs: Object.fromEntries(jobs.map((row) => [row.status, row.count])) };
  }
  app.get("/v1/chats/:id/social-knowledge", (context) => context.json(readDashboardSocialKnowledge(context.req.param("id"))));
  app.put("/v1/chats/:id/social-knowledge", async (context) => {
    try {
      const body = await context.req.json() as { holder?: unknown; subject?: unknown; level?: unknown; knownAs?: unknown; addressTerms?: unknown; previousHolder?: unknown; previousSubject?: unknown; description?: unknown; locked?: boolean };
      if(!UserCorrectionEditSchema.safeParse(body).success) return context.json({error:"locked must be boolean"},400);
      const holder = typeof body.holder === "string" ? body.holder.trim() : "";
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      if (!holder || !subject || !["aware_of", "interacted"].includes(String(body.level))) return context.json({ error: "holder, subject, and a valid level are required" }, 400);
      const knownAs = Array.isArray(body.knownAs) ? body.knownAs.filter((value): value is string => typeof value === "string") : [];
      let addressTerms: string[] | undefined;
      if (body.addressTerms !== undefined) {
        if (!Array.isArray(body.addressTerms) || body.addressTerms.some(value => typeof value !== "string" || value.trim().length > 120)) return context.json({ error: "addressTerms must contain strings up to 120 characters" }, 400);
        addressTerms = [...new Set((body.addressTerms as string[]).map(value => value.trim()).filter(Boolean))];
        if (addressTerms.length > 16) return context.json({ error: "addressTerms must contain up to 16 terms" }, 400);
      }
      const previousHolder = typeof body.previousHolder === "string" ? body.previousHolder.trim() : undefined;
      const previousSubject = typeof body.previousSubject === "string" ? body.previousSubject.trim() : undefined;
      if ((previousHolder && !previousSubject) || (!previousHolder && previousSubject)) return context.json({ error: "previousHolder and previousSubject must be provided together" }, 400);
      return context.json({ items: setManualSocialKnowledge(db, context.req.param("id"), { holder, subject, level: body.level as "aware_of" | "interacted", knownAs, addressTerms, previousHolder, previousSubject, description: typeof body.description === "string" ? body.description : undefined, locked:body.locked }) });
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.delete("/v1/chats/:id/social-knowledge", async (context) => {
    try {
      const body = await context.req.json() as { holder?: unknown; subject?: unknown };
      const holder = typeof body.holder === "string" ? body.holder.trim() : "";
      const subject = typeof body.subject === "string" ? body.subject.trim() : "";
      if (!holder || !subject) return context.json({ error: "holder and subject are required" }, 400);
      return context.json({ items: retractSocialKnowledge(db, context.req.param("id"), holder, subject) });
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.post("/v1/chats/:id/social-knowledge/backfill", async (context) => {
    try {
      const body = await context.req.json().catch(() => ({})) as { extractionReviewOverride?: unknown };
      if (body.extractionReviewOverride !== undefined && typeof body.extractionReviewOverride !== "boolean") return context.json({ error: "extractionReviewOverride must be boolean" }, 400);
      const queuedJobs = enqueueSocialKnowledgeBackfill(db, context.req.param("id"), body.extractionReviewOverride as boolean | undefined);
      if (queuedJobs) serverWorker.wake();
      return context.json({ ok: true, queuedJobs });
    } catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });

  app.get("/v1/chats/:id/extraction-audits", (context) => {
    const items = db.prepare(`SELECT id,job_id AS jobId,status,source_message_ids_json AS sourceMessageIds,source_fingerprint_json AS sourceFingerprint,source_revision AS sourceRevision,
      draft_json AS draft,patch_json AS patch,error,usage_json AS usage,attempts,created_at AS createdAt,updated_at AS updatedAt
      FROM extraction_audits WHERE chat_id=? ORDER BY updated_at DESC`).all(context.req.param("id")) as Array<Record<string, any>>;
    return context.json({ items: items.map((item) => {
      const sourceMessageIds = JSON.parse(item.sourceMessageIds || "[]");
      const draft = JSON.parse(item.draft);
      return { ...item, sourceMessageIds, sourceFingerprint: JSON.parse(item.sourceFingerprint || "[]"), draft,
        patch: item.patch ? JSON.parse(item.patch) : undefined, usage: JSON.parse(item.usage || "{}"),
        ...(["pending_review", "failed"].includes(item.status) ? { evidenceReview: describeEvidenceReview(db, context.req.param("id"), item.jobId, draft, sourceMessageIds) } : {}) };
    }) });
  });
  app.get("/v1/chats/:id/extraction-batches", (context) => context.json({ items: listExtractionBatches(db, context.req.param("id")) }));
  app.post("/v1/chats/:id/extraction-batches/:batchId/preview-regeneration", async (context) => {
    const body = await context.req.json() as { canonical?: boolean };
    return context.json(previewRegeneration(db, context.req.param("id"), context.req.param("batchId"), body.canonical === true));
  });
  app.get('/v1/chats/:id/memory-organization', (context) => {
    const chatId = context.req.param('id');
    invalidateChangedMemoryGroups(db, chatId);
    const legacyHolds = db.prepare(`SELECT e.id,e.start_ordinal,e.end_ordinal FROM episodes e WHERE e.chat_id=? AND e.resolution IS NOT 'group'
      AND e.status IN ('holding','queued','processing','failed') AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.chat_id=e.chat_id AND j.type='episode'
        AND json_extract(j.payload_json,'$.episodeId')=e.id AND json_extract(j.payload_json,'$.batchId') IS NOT NULL)`).all(chatId);
    return context.json({ ranges: listSourceRanges(db, chatId), groups: listMemoryGroups(db, chatId), regenerations: listRegenerations(db, chatId), additions: listMemoryAdditions(db, chatId), legacyHolds });
  });
  app.get('/v1/chats/:id/source-ranges/search', (context) => {
    const chatId = context.req.param('id');
    const query = (context.req.query('q') ?? '').trim();
    const ordinal = context.req.query('ordinal');
    if (query.length > 500 || ordinal !== undefined && (!/^\d+$/.test(ordinal) || Number(ordinal) < 1 || !Number.isSafeInteger(Number(ordinal)))) return context.json({ error: '검색어와 메시지 번호를 확인해 주세요' }, 400);
    const matches = db.prepare(`SELECT message_id AS id,ordinal FROM messages WHERE chat_id=?
      AND memory_excluded=0 AND extraction_state<>'skipped_policy'
      AND lifecycle IN ('pending','committed','client_pruned') AND host_visibility IN ('active','all_before')
      AND CASE WHEN canonical_hash<>'' THEN canonical_content ELSE content END IS NOT NULL
      AND (?='' OR instr(lower(CASE WHEN canonical_hash<>'' THEN canonical_content ELSE content END),lower(?))>0)
      AND (? IS NULL OR ordinal=?) ORDER BY ordinal LIMIT 201`).all(chatId, query, query, ordinal === undefined ? null : Number(ordinal)-1, ordinal === undefined ? null : Number(ordinal)-1) as Array<{ id: string; ordinal: number }>;
    if (!matches.length) return context.json({ ranges: [], messageNumbers: [], truncated: false });
    const ranges = listSourceRanges(db, chatId, matches.slice(0, 200).map(row => row.id));
    return context.json({ ranges, messageNumbers: matches.slice(0, 200).map(row => row.ordinal+1), truncated: matches.length > 200 });
  });
  app.post('/v1/chats/:id/memory-additions/sources', async (context) => {
    const body = await context.req.json() as { rangeIds?: unknown };
    if (!Array.isArray(body.rangeIds) || !body.rangeIds.every(id => typeof id === 'string')) return context.json({ error: '원문 구간을 확인해 주세요' }, 400);
    try { return context.json(additionSources(db, context.req.param('id'), body.rangeIds)); }
    catch (error: any) { return context.json({ error: error.message, code: error.code }, 409); }
  });
  for (const operation of ['preview', 'create'] as const) app.post(`/v1/chats/:id/memory-additions/${operation}`, async (context) => {
    const body = await context.req.json() as { rangeIds?: unknown; messageIds?: unknown; request?: unknown; postExtractionReview?: unknown };
    if (!Array.isArray(body.rangeIds) || !body.rangeIds.every(id => typeof id === 'string') || !Array.isArray(body.messageIds) || !body.messageIds.every(id => typeof id === 'string')
      || typeof body.request !== 'string' || typeof body.postExtractionReview !== 'boolean') return context.json({ error: '메시지 선택과 요청을 확인해 주세요' }, 400);
    try {
      const chatId = context.req.param('id');
      if (operation === 'preview') return context.json(previewMemoryAddition(db, chatId, body.rangeIds, body.messageIds, body.request, body.postExtractionReview));
      const created = startMemoryAddition(db, chatId, body.rangeIds, body.messageIds, body.request, body.postExtractionReview);
      serverWorker.wake();
      return context.json(created, 202);
    } catch (error: any) { return context.json({ error: error.message, code: error.code }, 409); }
  });
  for (const operation of ['apply', 'discard', 'retry'] as const) app.post(`/v1/chats/:id/memory-additions/:runId/${operation}`, (context) => {
    const chatId = context.req.param('id'), id = context.req.param('runId');
    try {
      if (operation === 'apply') { applyMemoryAddition(db, chatId, id); void embeddings.indexPending(chatId); }
      else if (operation === 'discard') discardMemoryAddition(db, chatId, id);
      else {
        if (!listMemoryAdditions(db, chatId).find(row => row.id === id)?.canRetry) return context.json({ error: '다시 시도할 작업이 없어요' }, 409);
        const job = db.prepare("SELECT payload_json FROM jobs WHERE id=? AND chat_id=? AND type='memory_addition' AND status='failed'").get(id, chatId) as { payload_json: string };
        db.prepare("UPDATE jobs SET status='queued',attempts=0,payload_json=?,last_error=NULL,updated_at=? WHERE id=? AND chat_id=? AND type='memory_addition' AND status='failed'")
          .run(JSON.stringify(manualRetryPayload(JSON.parse(job.payload_json))), Date.now(), id, chatId);
        serverWorker.wake();
      }
      return context.json({ ok: true });
    } catch (error: any) { return context.json({ error: error.message, code: error.code }, 409); }
  });
  app.get('/v1/chats/:id/source-ranges/:batchId', (context) => {
    const chatId = context.req.param('id');
    const range = listSourceRanges(db, chatId).find((row) => row.id === context.req.param('batchId'));
    if (!range) return context.json({ error: '원문 구간을 찾을 수 없어' }, 404);
    return context.json({ ...range, messages: rangeMessages(db, chatId).filter((row) => range.sourceMessageIds.includes(row.id))
      .map(row => ({ ...row, additionReason: additionMessageReason(db, chatId, row) })) });
  });
  app.put('/v1/chats/:id/messages/:messageId/memory-exclusion', async (context) => {
    const body = await context.req.json() as { excluded?: unknown };
    if (typeof body.excluded !== 'boolean') return context.json({ error: '제외 여부를 확인해 주세요' }, 400);
    try { return context.json(setMemoryExclusion(db,context.req.param('id'),context.req.param('messageId'),body.excluded)); }
    catch (error: any) { return context.json({ error: error.message, reason: error.message, code: error.code }, error.code === 'MESSAGE_NOT_FOUND' ? 404 : 409); }
  });
  for (const operation of ['preview', 'create'] as const) app.post(`/v1/chats/:id/memory-groups/${operation}`, async (context) => {
    try {
      const body = await context.req.json() as { batchIds?: unknown; postExtractionReview?: unknown };
      if (!Array.isArray(body.batchIds) || !body.batchIds.every((id) => typeof id === 'string') || typeof body.postExtractionReview !== 'boolean') return context.json({ error: '묶음 ID와 재검수 선택을 확인해 줘' }, 400);
      const chatId = context.req.param('id');
      if (operation === 'preview') return context.json(previewMemoryGroup(db, chatId, body.batchIds, body.postExtractionReview));
      const result = startMemoryGroup(db, chatId, body.batchIds, body.postExtractionReview);
      serverWorker.wake();
      return context.json(result, 202);
    } catch (error: any) { return context.json({ error: error.message, code: error.code }, 409); }
  });
  for (const operation of ['apply', 'ungroup', 'discard', 'retry'] as const) app.post(`/v1/chats/:id/memory-groups/:groupId/${operation}`, (context) => {
    const chatId = context.req.param('id'), groupId = context.req.param('groupId');
    try {
      if (operation === 'apply') applyMemoryGroup(db, chatId, groupId);
      else if (operation === 'ungroup') ungroupMemories(db, chatId, groupId);
      else if (operation === 'discard') discardMemoryGroup(db, chatId, groupId);
      else {
        if (!listMemoryGroups(db, chatId).find((row) => row.id === groupId)?.canRetry) return context.json({ error: '자동으로 더 진행할 수 없어. 원문과 중간 결과를 확인해 줘' }, 409);
        const changed = db.prepare("UPDATE jobs SET status='queued',attempts=0,last_error=NULL,updated_at=? WHERE chat_id=? AND type='memory_group' AND status='failed' AND json_extract(payload_json,'$.episodeId')=?").run(Date.now(), chatId, groupId);
        if (!changed.changes) return context.json({ error: '다시 시도할 실패 단계가 없어' }, 409);
        serverWorker.wake();
      }
      if (operation === 'apply' || operation === 'ungroup') void embeddings.indexPending(chatId);
      return context.json({ ok: true });
    } catch (error: any) { return context.json({ error: error.message, code: error.code }, 409); }
  });
  app.post("/v1/chats/:id/extraction-batches/:batchId/regenerate-episode", async (context) => {
    try {
      const body = await context.req.json().catch(() => ({})) as { postExtractionReview?: unknown };
      if (body.postExtractionReview !== undefined && typeof body.postExtractionReview !== "boolean") return context.json({ error: "postExtractionReview must be boolean" }, 400);
      const chat = db.prepare("SELECT post_extraction_review FROM chats WHERE id=?").get(context.req.param("id")) as { post_extraction_review: number } | undefined;
      if (!chat) return context.json({ error: "Chat not found" }, 404);
      const result = startEpisodeRegeneration(db, context.req.param("id"), context.req.param("batchId"), body.postExtractionReview === undefined ? chat.post_extraction_review !== 0 : body.postExtractionReview);
      serverWorker.wake();
      return context.json({ ok: true, ...result }, 202);
    } catch (error: any) { return context.json({ error: error?.message ?? String(error), code: error?.code }, error?.code === "BATCH_NOT_FOUND" ? 404 : 409); }
  });
  app.post("/v1/chats/:id/extraction-batches/:batchId/regenerate-canonical", async (context) => {
    try {
      const body = await context.req.json().catch(() => ({})) as { postExtractionReview?: unknown };
      if (body.postExtractionReview !== undefined && typeof body.postExtractionReview !== "boolean") return context.json({ error: "postExtractionReview must be boolean" }, 400);
      const chat = db.prepare("SELECT post_extraction_review FROM chats WHERE id=?").get(context.req.param("id")) as { post_extraction_review: number } | undefined;
      if (!chat) return context.json({ error: "Chat not found" }, 404);
      const result = startCanonicalRegeneration(db, context.req.param("id"), context.req.param("batchId"), body.postExtractionReview === undefined ? chat.post_extraction_review !== 0 : body.postExtractionReview);
      serverWorker.wake();
      return context.json({ ok: true, ...result }, 202);
    } catch (error: any) { return context.json({ error: error?.message ?? String(error), code: error?.code }, error?.code === "BATCH_NOT_FOUND" ? 404 : 409); }
  });
  app.get("/v1/chats/:id/regenerations/:runId", (context) => {
    try { return context.json(regenerationRun(db, context.req.param("id"), context.req.param("runId"))); }
    catch (error: any) { return context.json({ error: error?.message ?? String(error), code: error?.code }, 404); }
  });
  app.post("/v1/chats/:id/regenerations/:runId/apply", (context) => {
    try {
      const mode = (regenerationRun(db, context.req.param("id"), context.req.param("runId")) as any).mode;
      const result = mode === "canonical_suffix"
        ? applyCanonicalRegeneration(db, context.req.param("id"), context.req.param("runId"))
        : applyEpisodeRegeneration(db, context.req.param("id"), context.req.param("runId"));
      void embeddings.indexPending(context.req.param("id"));
      return context.json({ ok: true, ...result });
    } catch (error: any) { return context.json({ error: error?.message ?? String(error), code: error?.code }, 409); }
  });
  app.delete("/v1/chats/:id/regenerations/:runId", (context) => {
    try { discardRegeneration(db, context.req.param("id"), context.req.param("runId")); return context.json({ ok: true }); }
    catch (error: any) { return context.json({ error: error?.message ?? String(error), code: error?.code }, 409); }
  });
  app.post("/v1/chats/:id/extraction-audits/:auditId/retry", (context) => {
    const chatId = context.req.param("id");
    const audit = db.prepare("SELECT id,job_id,status,source_message_ids_json,source_fingerprint_json,draft_json,patch_json FROM extraction_audits WHERE id=? AND chat_id=?").get(context.req.param("auditId"), chatId) as
      | { id: string; job_id: string; status: string; source_message_ids_json: string; source_fingerprint_json: string; draft_json: string; patch_json: string | null }
      | undefined;
    if (!audit) return context.json({ error: "Extraction audit not found" }, 404);
    if (!["pending_review", "failed"].includes(audit.status)) return context.json({ error: "Extraction audit is not retryable" }, 409);
    const sourceMessageIds = JSON.parse(audit.source_message_ids_json || "[]") as string[];
    const expectedFingerprint = parseSourceFingerprintJson(audit.source_fingerprint_json || "[]");
    if (!expectedFingerprint || (sourceMessageIds.length > 0 && expectedFingerprint.length !== sourceMessageIds.length) || !fingerprintMatches(db, chatId, expectedFingerprint)) {
      db.prepare("UPDATE extraction_audits SET status='stale',error='Source fingerprint is no longer current',updated_at=? WHERE id=?").run(Date.now(), audit.id);
      return context.json({ error: "Source fingerprint is no longer current" }, 409);
    }
    const pending = db.prepare("SELECT id FROM jobs WHERE chat_id=? AND status IN ('queued','leased') AND json_extract(payload_json,'$.retryOfAuditId')=?").get(chatId, audit.id) as { id: string } | undefined;
    if (pending) return context.json({ ok: true, jobId: pending.id });
    const originalJob = db.prepare("SELECT status,payload_json FROM jobs WHERE id=?").get(audit.job_id) as { status: string; payload_json: string } | undefined;
    const originalPayload = JSON.parse(originalJob?.payload_json ?? "{}");
    let retryDraft = JSON.parse(audit.draft_json);
    const issues = inspectDraftEvidence(db, chatId, sourceMessageIds, retryDraft);
    const sourceRecovery = originalJob?.status === "done" || originalPayload.sourceRecovery === true;
    const dialogueRecovery: DialogueRecoveryCandidate[] = [];
    // Already-applied state is not replayed to repair optional evidence.
    if (sourceRecovery && issues.some((issue) => issue.blocking)) return context.json({ error: "이미 적용된 상태의 근거는 개별 수정이 필요합니다. 중복 누적을 막기 위해 전체 재시도를 하지 않았습니다." }, 409);
    if (sourceRecovery) {
      const pendingRefs: string[] = JSON.parse(audit.patch_json ?? "{}")?.keepPendingItemRefs ?? [];
      const passages = (retryDraft.sourcePassages ?? []).filter((_item: unknown, index: number) => pendingRefs.includes(`source:${index}`)
        || issues.some((issue) => issue.path.startsWith(`sourcePassages[${index}]`)));
      const previous = new Map<string, DialogueRecoveryCandidate>((originalPayload.dialogueRecovery ?? [])
        .map((item: DialogueRecoveryCandidate) => [item.ref, item]));
      const memories = [];
      for (const [memoryIndex, memory] of (retryDraft.memories ?? []).entries()) for (const [dialogueIndex, dialogue] of (memory.keyDialogues ?? []).entries()) {
        const prior = previous.get(memory.key);
        if (!prior && !pendingRefs.includes(`dialogue:${memory.key}:${dialogue.messageId}:${dialogueIndex}`)
          && !issues.some((issue) => issue.path.startsWith(`memories[${memoryIndex}].keyDialogues[${dialogueIndex}]`))) continue;
        let recovery = prior;
        if (!recovery) {
          const scopeId = originalPayload.batchId ?? originalPayload.retryOfJobId ?? audit.job_id;
          const scopedKey = originalPayload.episodeId && memory.key === `episode:${originalPayload.episodeId}`
            ? memory.key : `batch:${scopeId}:${createHash("sha256").update(memory.key).digest("hex")}`;
          const parent = db.prepare("SELECT id FROM memories WHERE chat_id=? AND memory_key=? AND active=1").get(chatId, scopedKey) as {id: string} | undefined;
          recovery = { ref: `recovery:${memory.key}:${dialogueIndex}`, parentMemoryId: parent?.id, dialogue };
        }
        dialogueRecovery.push(recovery);
        // One frozen candidate per shell keeps identity stable when siblings are removed.
        memories.push({ ...memory, key: recovery.ref, details: [], landmarkKinds: [], associations: [], keyDialogues: [dialogue] });
      }
      if (!passages.length && !dialogueRecovery.length) return context.json({ error: "자동으로 다시 확인할 발췌가 없습니다. 보류된 항목의 진단을 확인해 주세요." }, 409);
      retryDraft = { language: retryDraft.language, entities: [], memories, stateObservations: [], sourcePassages: passages };
    }
    const timestamp = Date.now();
    const jobId = randomUUID();
    db.transaction(() => {
      db.prepare(`INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'audit_retry','queued',?,0,?,?)`)
        .run(jobId, chatId, JSON.stringify({ ...originalPayload, sourceMessageIds, sourceFingerprint: expectedFingerprint, auditDraft: retryDraft, sourceRecovery, sourceRecoveryMetadata: sourceRecovery ? { targets: expectedFingerprint.map(({ messageId, ordinal }) => ({ messageId, ordinal })), matchKinds: originalPayload.sourceRecoveryMetadata?.matchKinds ?? [] } : undefined, dialogueRecovery, retryOfAuditId: audit.id, retryOfJobId: audit.job_id, llmCallStats: { total: 0, repairs: 0, byPurpose: {} }, postExtractionReview: true }), timestamp, timestamp);
    })();
    serverWorker.wake();
    return context.json({ ok: true, jobId });
  });

  app.get("/v1/chats/:id/view-preferences", (context) => context.json(readViewPreferences(db, context.req.param("id"))));
  app.put("/v1/chats/:id/view-preferences", async (context) => {
    try {
      return context.json(writeViewPreferences(db, context.req.param("id"), await context.req.json()));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof InvalidViewPreferencesPatchError) {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  function readDashboardMemories(chatId: string) {
    const bookmarks = readMemoryBookmarks(db, chatId);
    const items = db.prepare(`
      SELECT m.id,m.memory_key AS memoryKey,${recognitionOnlyMemorySql('m')} AS recognitionOnly,m.type,m.title,m.content,m.participants_json,m.known_by_json,m.perspective,m.story_time,m.story_time_normalized,m.locations_json,m.landmark,m.landmark_kinds_json,m.evidence_json,
        m.salience,m.strength,m.recall_count,m.pinned,m.active,m.capsule_parent_id,m.source_batch_id AS sourceBatchId,m.user_managed AS userManaged,m.created_revision,m.created_at,m.updated_at,
        (SELECT MIN(msg.ordinal) FROM evidence_spans e JOIN messages msg ON msg.chat_id=e.chat_id AND msg.message_id=e.message_id WHERE e.memory_id=m.id) AS source_ordinal,
        (SELECT msg.event_time FROM evidence_spans e JOIN messages msg ON msg.chat_id=e.chat_id AND msg.message_id=e.message_id WHERE e.memory_id=m.id ORDER BY msg.ordinal LIMIT 1) AS source_event_time
      FROM memories m WHERE m.chat_id=? ORDER BY CASE WHEN source_ordinal IS NULL THEN 0 ELSE 1 END,CASE WHEN source_ordinal IS NULL THEN m.created_at END DESC,source_ordinal DESC,m.created_revision DESC
    `).all(chatId) as Array<Record<string, unknown> & { id: string }>;
    const dialogueQuery = db.prepare("SELECT id,speaker,text,message_id AS messageId,evidence_json AS evidence,kind FROM memory_dialogues WHERE memory_id=? ORDER BY ordinal");
    const detailQuery = db.prepare(`SELECT id,detail_key AS key,kind,role,original_kind,text,participants_json AS participants,known_by_json AS knownBy,locations_json AS locations,
      epistemic,salience,retention_class AS retention,evidence_json AS evidence,source_start_ordinal AS sourceOrdinal
      FROM memory_details WHERE memory_id=? AND active=1 ORDER BY COALESCE(source_start_ordinal,2147483647),created_at`);
    return { items: items.map((item) => {
      let locations: string[] = [];
      let participants: string[] = [];
      let knownBy: string[] = [];
      let landmarkKinds: unknown[] = [];
      try { locations = JSON.parse(String(item.locations_json ?? "[]")) as string[]; } catch { locations = []; }
      try { participants = JSON.parse(String(item.participants_json ?? "[]")) as string[]; } catch { participants = []; }
      try { knownBy = JSON.parse(String(item.known_by_json ?? "[]")) as string[]; } catch { knownBy = []; }
      try { landmarkKinds = JSON.parse(String(item.landmark_kinds_json ?? "[]")) as unknown[]; } catch { landmarkKinds = []; }
      const { locations_json: _locationsJson, landmark_kinds_json: _landmarkKindsJson, ...rest } = item;
      rest.recognitionOnly = Boolean(item.recognitionOnly);
      const episode = db.prepare("SELECT id,status,resolution,source_tokens FROM episodes WHERE memory_id=? LIMIT 1").get(item.id) as any;
      const sections = episode ? db.prepare("SELECT id,ordinal,title,summary,source_message_ids_json AS sourceMessageIds,key_dialogues_json AS keyDialogues FROM episode_sections WHERE episode_id=? ORDER BY ordinal").all(episode.id).map((section: any) => ({
        ...section,
        sourceMessageIds: JSON.parse(section.sourceMessageIds || "[]"),
        keyDialogues: JSON.parse(section.keyDialogues || "[]"),
      })) : [];
      const details = (detailQuery.all(item.id) as Array<Record<string, any>>).map((detail) => {
        const access = memoryDetailAccess(db, chatId, detail.id);
        return { ...detail, access, participants: JSON.parse(detail.participants || "[]"), knownBy: access.holders.map(holder => holder.name),
          locations: JSON.parse(detail.locations || "[]"), evidence: JSON.parse(detail.evidence || "[]") };
      });
      const keyDialogues = (dialogueQuery.all(item.id) as Array<Record<string,any>>).map(dialogue => ({...dialogue,access:memoryDetailAccess(db,chatId,dialogue.id,"dialogue"),evidence:JSON.parse(dialogue.evidence)}));
      return { ...rest, known_by_json: JSON.stringify(publicKnowledgeScope(knownBy).knownBy), participants, ...publicKnowledgeScope(knownBy), locations, landmarkKinds, landmark: item.landmark === 1, pinned: item.pinned === 1,
        active: item.active === 1, bookmarked: bookmarks.has(item.id), keyDialogues, details, detailCount: details.length, episode, sections };
    }) };
  }
  app.get("/v1/chats/:id/memories", (context) => context.json(readDashboardMemories(context.req.param("id"))));
  app.get("/v1/chats/:id/messages", (context) => context.json({ items: db.prepare(`
    SELECT message_id,role,ordinal,content,lifecycle,host_visibility,visible,event_time,generation_id,extraction_state,updated_at
    FROM messages WHERE chat_id=? ORDER BY ordinal
  `).all(context.req.param("id")) }));
  app.get("/v1/chats/:id/memory-details/search", (context) => {
    const chatId = context.req.param("id");
    const query = String(context.req.query("q") ?? "").trim();
    if (!query) return context.json({ error: "q is required" }, 400);
    const limit = Math.min(50, Math.max(1, Number(context.req.query("limit") ?? 20) || 20));
    const language = (db.prepare("SELECT memory_language FROM chats WHERE id=?").get(chatId) as { memory_language?: "en" | "ko" | "ja" | "zh" } | undefined)?.memory_language;
    const tokens = normalizeSearchTokens(query, language).slice(0, 16);
    if (!tokens.length) return context.json({ items: [] });
    const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(" OR ");
    try {
      const rows = db.prepare(`SELECT d.id,d.memory_id AS memoryId,d.detail_key AS key,d.kind,d.text,d.participants_json AS participants,
        d.known_by_json AS knownBy,d.locations_json AS locations,d.epistemic,d.salience,d.retention_class AS retention,
        d.evidence_json AS evidence,d.source_start_ordinal AS sourceOrdinal,bm25(memory_detail_fts) AS rank
        FROM memory_detail_fts JOIN memory_details d ON d.id=memory_detail_fts.detail_id
        JOIN memories m ON m.id=d.memory_id AND m.active=1
        WHERE memory_detail_fts MATCH ? AND memory_detail_fts.chat_id=? AND d.active=1
          AND NOT ${recognitionOnlyMemorySql('m')} AND NOT ${recognitionDetailSql('d')}
        ORDER BY rank LIMIT ?`).all(match, chatId, limit) as Array<Record<string, any>>;
      return context.json({ items: rows.map((row) => {
        const access = memoryDetailAccess(db, chatId, row.id);
        return { ...row, access, participants: JSON.parse(row.participants || "[]"), knownBy: access.holders.map(holder => holder.name),
          locations: JSON.parse(row.locations || "[]"), evidence: JSON.parse(row.evidence || "[]") };
      }) });
    } catch { return context.json({ items: [] }); }
  });
  app.get("/v1/chats/:id/evidence", (context) => {
    const chatId = context.req.param("id");
    const memoryId = String(context.req.query("memoryId") ?? "").trim();
    const detailId = String(context.req.query("detailId") ?? "").trim();
    const dialogueId = String(context.req.query("dialogueId") ?? "").trim();
    if (!memoryId && !detailId && !dialogueId) return context.json({ error: "memoryId, detailId or dialogueId is required" }, 400);
    let evidence: Array<{ messageId: string; quote?: string }> = [];
    if (dialogueId) {
      const row = db.prepare("SELECT evidence_json FROM memory_dialogues WHERE id=? AND chat_id=?").get(dialogueId, chatId) as {evidence_json:string} | undefined;
      if (!row) return context.json({error:"Memory dialogue not found"},404);
      evidence = JSON.parse(row.evidence_json);
    } else if (detailId) {
      const row = db.prepare("SELECT evidence_json FROM memory_details WHERE id=? AND chat_id=?").get(detailId, chatId) as { evidence_json: string } | undefined;
      if (!row) return context.json({ error: "Memory detail not found" }, 404);
      evidence = JSON.parse(row.evidence_json || "[]");
    } else {
      const exists = db.prepare("SELECT 1 FROM memories WHERE id=? AND chat_id=?").get(memoryId, chatId);
      if (!exists) return context.json({ error: "Memory not found" }, 404);
      evidence = db.prepare("SELECT message_id AS messageId,quote FROM evidence_spans WHERE chat_id=? AND memory_id=? ORDER BY created_at").all(chatId, memoryId) as Array<{ messageId: string; quote?: string }>;
    }
    const items = evidence.map((item) => {
      const source = db.prepare("SELECT role,ordinal,content,lifecycle,host_visibility AS hostVisibility FROM messages WHERE chat_id=? AND message_id=?").get(chatId, item.messageId) as Record<string, any> | undefined;
      return { ...item, source: source ? { ...source, messageId: item.messageId } : null };
    });
    return context.json({ explicitEvidence: true, items });
  });
  app.delete("/v1/chats/:id/messages/:messageId", (context) => context.json({
    ok: hardDeleteMessage(db, context.req.param("id"), context.req.param("messageId")),
  }));
  app.patch("/v1/chats/:id", async (context) => {
    const body = await context.req.json() as { profile?: unknown; includeUserMessages?: unknown; memoryLanguage?: unknown; backfill?: boolean; extractionReviewOverride?: unknown };
    const chatId = context.req.param("id");
    const previous = db.prepare("SELECT profile,include_user_messages,memory_language,pending_memory_language FROM chats WHERE id=?").get(chatId) as { profile: string; include_user_messages: number; memory_language: string; pending_memory_language: string | null } | undefined;
    if (!previous) return context.json({ error: "Chat not found" }, 404);
    if (body.includeUserMessages !== undefined && typeof body.includeUserMessages !== "boolean") return context.json({ error: "includeUserMessages must be boolean" }, 400);
    if (body.extractionReviewOverride !== undefined && typeof body.extractionReviewOverride !== "boolean") return context.json({ error: "extractionReviewOverride must be boolean" }, 400);
    const profile = body.profile === undefined ? RpProfileSchema.parse(previous.profile) : RpProfileSchema.parse(body.profile);
    const includeUserMessages = body.includeUserMessages === undefined ? previous.include_user_messages === 1 : body.includeUserMessages === true;
    const memoryLanguage = body.memoryLanguage === undefined ? undefined : MemoryLanguageSchema.parse(body.memoryLanguage);
    const shouldBackfill = body.backfill === true && body.profile !== undefined && previous.profile === "companion" && profile === "simulation";
    if (body.profile === undefined && body.includeUserMessages === undefined && memoryLanguage === undefined) return context.json({ error: "No supported changes" }, 400);
    db.transaction(() => {
      db.prepare("UPDATE chats SET profile=?,include_user_messages=?,updated_at=? WHERE id=?").run(profile, includeUserMessages ? 1 : 0, Date.now(), chatId);
      if (memoryLanguage !== undefined) {
        if (memoryLanguage === previous.memory_language) db.prepare("UPDATE chats SET pending_memory_language=NULL WHERE id=?").run(chatId);
        else if (hasDerivedState(db, chatId)) db.prepare("UPDATE chats SET pending_memory_language=? WHERE id=?").run(memoryLanguage, chatId);
        else db.prepare("UPDATE chats SET memory_language=?,pending_memory_language=NULL WHERE id=?").run(memoryLanguage, chatId);
      }
      if (shouldBackfill) {
        db.prepare("UPDATE messages SET extraction_state='pending' WHERE chat_id=? AND lifecycle='committed' AND host_visibility IN ('active','all_before') AND content IS NOT NULL").run(chatId);
      }
    })();
    if (shouldBackfill) {
      enqueueExtractionJobs(db, chatId, profile, true, includeUserMessages, 4, "current", body.extractionReviewOverride as boolean | undefined);
      setTimeout(() => void embeddings.indexPending(chatId), 1_500);
    }
    const languageState = db.prepare("SELECT memory_language,pending_memory_language FROM chats WHERE id=?").get(chatId) as { memory_language: string; pending_memory_language: string | null };
    return context.json({ ok: true, profile, includeUserMessages, memoryLanguage: languageState.memory_language, pendingMemoryLanguage: languageState.pending_memory_language, requiresLanguageReprocess: languageState.pending_memory_language !== null });
  });
  app.put("/v1/chats/:id/title", async (context) => {
    const body = await context.req.json() as { chatTitle?: unknown };
    const chatTitle = typeof body.chatTitle === "string" ? body.chatTitle.trim().slice(0, 240) : "";
    if (!chatTitle) return context.json({ error: "chatTitle is required" }, 400);
    const result = db.prepare("UPDATE chats SET chat_title=?,updated_at=? WHERE id=?").run(chatTitle, Date.now(), context.req.param("id"));
    return result.changes ? context.json({ ok: true, chatTitle }) : context.json({ error: "Chat not found" }, 404);
  });
  app.post("/v1/chats/:id/memories", async (context) => {
    const chatId = context.req.param("id");
    const body = await context.req.json() as {
      title?: unknown; content?: unknown; storyTime?: unknown; participants?: unknown; landmarkKinds?: unknown;
    };
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : content.replace(/\s+/g, " ").slice(0, 80);
    const storyTime = typeof body.storyTime === "string" ? body.storyTime.trim() : "";
    const parsedParticipants = MemoryParticipantsSchema.safeParse(body.participants);
    const landmarks = Array.isArray(body.landmarkKinds) ? body.landmarkKinds : [];
    if (!content || content.length > 20_000 || !title || title.length > 500) return context.json({ error: "Manual memory title or content is invalid" }, 400);
    if (storyTime.length > 240) return context.json({ error: "storyTime must be a string up to 240 characters" }, 400);
    if (!parsedParticipants.success) return context.json({ error: "participants must contain up to 16 non-empty unique names" }, 400);
    const participants = parsedParticipants.data;
    const parsedLandmarks = LandmarkKindSchema.array().max(12).safeParse(landmarks);
    if (!parsedLandmarks.success) return context.json({ error: "Invalid landmarkKinds", issues: parsedLandmarks.error.issues }, 400);
    const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
    if (!chat) return context.json({ error: "Chat not found" }, 404);
    const id = randomUUID();
    const timestamp = Date.now();
    const memoryKey = `manual:${id}`;
    db.prepare(`INSERT INTO memories(
      id,chat_id,memory_key,type,title,content,participants_json,known_by_json,perspective,story_time,story_time_normalized,locations_json,
      landmark,landmark_kinds_json,evidence_json,salience,strength,retention_class,atom_access_version,source_batch_id,user_managed,
      created_revision,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,1,?,?,?)`).run(
      id, chatId, memoryKey, parsedLandmarks.data.length ? "relationship" : "episode", title, content,
      JSON.stringify(participants), JSON.stringify(participants), null, storyTime || null, normalizeStoryTime(storyTime) ?? null, "[]",
      parsedLandmarks.data.length ? 1 : 0, JSON.stringify(parsedLandmarks.data), "[]", .7, .7,
      parsedLandmarks.data.length ? "durable" : "arc", 0, chat.revision, timestamp, timestamp,
    );
    refreshMemoryFts(db, id);
    refreshMemoryParticipantCounts(db, chatId, id);
    void embeddings.indexPending(chatId);
    return context.json({ ok: true, id, memoryKey }, 201);
  });
  for (const kind of ["detail", "dialogue"] as const) app.put(`/v1/chats/:id/memories/:memoryId/${kind === "detail" ? "details" : "dialogues"}/:detailId/access`, async (context) => {
    const chatId = context.req.param("id"), memoryId = context.req.param("memoryId"), detailId = context.req.param("detailId");
    const body = z.object({ holders: z.array(z.string().trim().min(1)), everyone: z.boolean().default(false), bases: z.record(z.string().trim(), ItemAccessBasisSchema) }).safeParse(await context.req.json());
    if (!body.success) return context.json({ error: "Provide character names and a valid knowledge basis for each holder", issues: body.error.issues }, 400);
    const detail = db.prepare(`SELECT d.evidence_json FROM ${kind === "detail" ? "memory_details" : "memory_dialogues"} d JOIN memories m ON m.id=d.memory_id AND m.chat_id=d.chat_id
      WHERE d.chat_id=? AND d.memory_id=? AND d.id=? ${kind === "detail" ? "AND d.active=1" : ""}`).get(chatId, memoryId, detailId) as { evidence_json: string } | undefined;
    if (!detail) return context.json({ error: "Memory atom not found in this chat and memory" }, 404);
    const resolve = buildEntityIdentityResolver(db, chatId);
    const names = new Set(listEntities(db, chatId).map(entity => entity.name));
    const holders: string[] = [];
    const bases = new Map<string, import("@rcm/shared").ItemAccessBasis>();
    for (const name of body.data.everyone ? [] : body.data.holders) {
      const identity = resolve(name);
      if (identity.ambiguous || !names.has(identity.canonical)) return context.json({ error: `${identity.ambiguous ? "Ambiguous" : "Unknown"} character name: ${name}` }, 400);
      const basis = body.data.bases[name];
      if (!basis) return context.json({ error: `Missing knowledge basis: ${name}` }, 400);
      if (bases.has(identity.canonical) && bases.get(identity.canonical) !== basis) return context.json({ error: `Conflicting knowledge bases: ${name}` }, 400);
      bases.set(identity.canonical, basis);
      if (!holders.includes(identity.canonical)) holders.push(identity.canonical);
    }
    if (body.data.everyone) { holders.length = 0; holders.push(EVERYONE_HOLDER); }
    const previousAccess = memoryDetailAccess(db, chatId, detailId, kind);
    const previousHolders = previousAccess.everyone ? [EVERYONE_HOLDER] : previousAccess.holders.map(holder => holder.name);
    const accessChanged = previousHolders.length !== holders.length || previousHolders.some(holder => !holders.includes(holder));
    db.transaction(() => {
      const timestamp = Date.now();
      db.prepare("UPDATE chats SET revision=revision+1,updated_at=? WHERE id=?").run(timestamp, chatId);
      const { revision } = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number };
      if (!holders.length) replaceItemAccess(db, chatId, kind, detailId, [], revision, timestamp);
      else {
        db.prepare(`UPDATE item_access SET active=0 WHERE chat_id=? AND item_kind=? AND item_id=?
          AND holder NOT IN (SELECT value FROM json_each(?))`).run(chatId, kind, detailId, JSON.stringify(holders));
        const insert = db.prepare(`INSERT OR IGNORE INTO item_access(id,chat_id,item_kind,item_id,holder,basis,evidence_json,confidence,active,source_revision,created_at)
          VALUES(?,?,?,?,?,?,?,1,1,?,?)`);
        for (const holder of holders) {
          // Correct attribution without replacing existing evidence; new holders cite the atom.
          const basis = bases.get(holder) ?? "witnessed";
          insert.run(randomUUID(), chatId, kind, detailId, holder, basis, detail.evidence_json, revision, timestamp);
          db.prepare("UPDATE item_access SET active=1,basis=? WHERE chat_id=? AND item_kind=? AND item_id=? AND holder=?").run(basis, chatId, kind, detailId, holder);
        }
      }
      const edits = readDetailAccessEdits(db, chatId); edits.set(detailId, holders); writeDetailAccessEdits(db, chatId, edits);
      if (kind === "detail") {
        syncDetailKnownBy(db, chatId, detailId);
        db.prepare("UPDATE memory_details SET updated_at=? WHERE chat_id=? AND id=?").run(timestamp, chatId, detailId);
      }
      // Story atoms carry holder scope, not the acquisition basis.
      if (accessChanged) invalidateStorySupports(db, chatId, new Set([`${kind}:${detailId}`]));
    })();
    // Contextual detail group fingerprints include access: regroup through the existing indexer.
    if (accessChanged) void embeddings.indexPending(chatId);
    const access = memoryDetailAccess(db, chatId, detailId, kind);
    return context.json({ ok: true, access, knownBy: access.holders.map(holder => holder.name) });
  });
  app.patch("/v1/chats/:id/memories/:memoryId", async (context) => {
    const body = await context.req.json() as Record<string, unknown>;
    const allowed = ["title", "content", "salience", "strength", "pinned", "active", "storyTime", "locations", "landmark", "landmarkKinds", "participants"] as const;
    const updates = allowed.filter((key) => body[key] !== undefined);
    const bookmarkUpdate = body.bookmarked !== undefined;
    if (updates.length === 0 && !bookmarkUpdate) return context.json({ error: "No supported changes" }, 400);
    if (bookmarkUpdate && typeof body.bookmarked !== "boolean") return context.json({ error: "bookmarked must be boolean" }, 400);
    if (["salience", "strength"].some((key) => body[key] !== undefined && (!Number.isFinite(Number(body[key])) || Number(body[key]) < 0 || Number(body[key]) > 1))) {
      return context.json({ error: "salience and strength must be finite numbers from 0 to 1" }, 400);
    }
    if (body.storyTime !== undefined && body.storyTime !== null && (typeof body.storyTime !== "string" || body.storyTime.length > 240)) {
      return context.json({ error: "storyTime must be a string up to 240 characters" }, 400);
    }
    if (body.locations !== undefined && (!Array.isArray(body.locations) || body.locations.length > 12 || body.locations.some((value) => typeof value !== "string" || !value.trim() || value.length > 240))) {
      return context.json({ error: "locations must be an array of up to 12 non-empty strings" }, 400);
    }
    const parsedParticipants = body.participants === undefined ? undefined : MemoryParticipantsSchema.safeParse(body.participants);
    if (parsedParticipants && !parsedParticipants.success) {
      return context.json({ error: "participants must contain up to 16 non-empty unique names" }, 400);
    }
    const participants = parsedParticipants?.data;
    const parsedLandmarks = body.landmarkKinds === undefined ? undefined : LandmarkKindSchema.array().max(12).safeParse(body.landmarkKinds);
    if (parsedLandmarks && !parsedLandmarks.success) return context.json({ error: "Invalid landmarkKinds", issues: parsedLandmarks.error.issues }, 400);
    const columns: Record<(typeof allowed)[number], string> = { title: "title", content: "content", salience: "salience", strength: "strength", pinned: "pinned", active: "active", storyTime: "story_time", locations: "locations_json", landmark: "landmark", landmarkKinds: "landmark_kinds_json", participants: "participants_json" };
    const values = updates.map((key) => key === "pinned" || key === "active" || key === "landmark"
      ? (body[key] ? 1 : 0)
      : key === "participants" ? JSON.stringify(participants) : key === "locations" ? JSON.stringify(body[key])
        : key === "landmarkKinds" ? JSON.stringify(parsedLandmarks?.data ?? [])
        : key === "storyTime" ? (body.storyTime || null)
          : key === "salience" || key === "strength" ? normalizeUnitScore(Number(body[key])) : body[key]);
    const chatId = context.req.param("id");
    const memoryId = context.req.param("memoryId");
    const result = db.transaction(() => {
      const previous = db.prepare("SELECT title,content,active FROM memories WHERE id=? AND chat_id=?").get(memoryId, chatId) as { title: string; content: string; active: number } | undefined;
      if (!previous) return 0;
      if (updates.length > 0) {
        const normalizedUpdate = updates.includes("storyTime") ? ",story_time_normalized=?" : "";
        db.prepare(`UPDATE memories SET ${updates.map((key) => `${columns[key]}=?`).join(",")}${normalizedUpdate},user_managed=1,updated_at=? WHERE id=? AND chat_id=?`).run(
          ...values, ...(updates.includes("storyTime") ? [normalizeStoryTime(body.storyTime) ?? null] : []), Date.now(), memoryId, chatId,
        );
        if (participants !== undefined) {
          const memory = db.prepare("SELECT memory_key FROM memories WHERE id=?").get(memoryId) as { memory_key: string };
          if (memory.memory_key.startsWith("manual:")) db.prepare("UPDATE memories SET known_by_json=? WHERE id=?").run(JSON.stringify(participants), memoryId);
          refreshMemoryParticipantCounts(db, chatId, memoryId);
        }
        if (updates.includes("title") || updates.includes("content") || updates.includes("locations") || updates.includes("landmarkKinds") || updates.includes("participants")) refreshMemoryFts(db, memoryId);
        // Parent story atoms use title/content; participant tags and display metadata
        // do not grant character knowledge. Disabling the parent revokes its children.
        if (previous.active && body.active === false) invalidateStorySupports(db,chatId,storyMemorySupportIds(db,chatId,[memoryId]));
        else if (previous.active && (["title", "content"] as const).some(key => body[key] !== undefined && body[key] !== previous[key])) {
          invalidateStorySupports(db,chatId,new Set([`memory:${memoryId}`]));
        }
      }
      if (bookmarkUpdate) setMemoryBookmark(db, chatId, memoryId, body.bookmarked === true);
      return 1;
    })();
    if (result === 1) {
      if (body.active === false) embeddings.removeMemory(memoryId);
      else if (updates.includes("title") || updates.includes("content") || updates.includes("locations") || updates.includes("landmarkKinds") || body.active === true) void embeddings.indexPending(chatId);
    }
    return result === 1
      ? context.json({ ok: true })
      : context.json({ error: "Memory not found" }, 404);
  });
  app.delete("/v1/chats/:id/memories/:memoryId", (context) => {
    const chatId = context.req.param("id");
    const memoryId = context.req.param("memoryId");
    const result = db.transaction(() => {
      const supports=storyMemorySupportIds(db,chatId,[memoryId]);
      db.prepare("DELETE FROM memory_fts WHERE memory_id=? AND chat_id=?").run(memoryId, chatId);
      const deleted = db.prepare("DELETE FROM memories WHERE id=? AND chat_id=?").run(memoryId, chatId).changes;
      if (deleted === 1) {
        pruneDetailAccessEdits(db, chatId);
        setMemoryBookmark(db, chatId, memoryId, false);
        invalidateStorySupports(db,chatId,supports);
      }
      return deleted;
    })();
    if (result === 1) embeddings.removeMemory(memoryId);
    return context.json({ ok: result === 1 });
  });
  function readDashboardRelationships(chatId: string) {
    const events = (db.prepare(`SELECT id,from_entity AS "from",to_entity AS "to",changes_json AS changes,reason,evidence_json AS evidence,
      source_memory_id AS sourceMemoryId,source_detail_id AS sourceDetailId,source_start_ordinal AS sourceOrdinal,created_revision AS createdRevision
      FROM relationship_events WHERE chat_id=? AND active=1 ORDER BY COALESCE(source_start_ordinal,2147483647),created_at`).all(chatId) as Array<Record<string, any>>)
      .map((event) => ({ ...event, changes: JSON.parse(event.changes || "[]"), evidence: JSON.parse(event.evidence || "[]") }));
    return { items: listRelationshipProjections(db, chatId), events };
  }
  app.get("/v1/chats/:id/relationships", (context) => context.json(readDashboardRelationships(context.req.param("id"))));
  app.get("/v1/chats/:id/physical-intimacy", (context) => {
    const items = db.prepare(`SELECT p.id,p.participant_a AS participantA,p.participant_b AS participantB,p.milestone_key AS milestoneKey,p.act,p.custom_label AS customLabel,
      p.initiator,p.interaction_context AS interactionContext,p.circumstance,p.evidence_json AS evidence,p.source_memory_id AS sourceMemoryId,
      m.title AS sourceMemoryTitle,p.auto_inject AS autoInject,p.manual_override AS manualOverride,
      'milestone' AS status,p.source_start_ordinal AS sourceOrdinal,p.created_revision AS createdRevision
      FROM physical_intimacy_milestones p LEFT JOIN memories m ON m.id=p.source_memory_id WHERE p.chat_id=? AND p.active=1
      ORDER BY COALESCE(p.source_start_ordinal,2147483647),p.created_at,p.milestone_key`).all(context.req.param("id")) as Array<Record<string, any>>;
    return context.json({ items: items.map((item) => ({ ...item, autoInject: item.autoInject === 1, manualOverride: item.manualOverride === 1 })) });
  });
  app.post("/v1/chats/:id/physical-intimacy", async (context) => {
    const chatId = context.req.param("id");
    const body = await context.req.json() as { participantA?: string; participantB?: string; act?: string; customLabel?: string; initiator?: string; interactionContext?: string; circumstance?: string; sourceMessageId?: string; autoInject?: boolean };
    const participantA = body.participantA?.trim() ?? "";
    const participantB = body.participantB?.trim() ?? "";
    const act = body.act?.trim() ?? "";
    const customLabel = body.customLabel?.trim() || null;
    const allowedActs = new Set(["hand_holding", "embrace", "cuddling", "forehead_kiss", "cheek_kiss", "hand_kiss", "lip_kiss", "deep_kiss", "sexual_touch", "manual_sex", "oral_sex", "vaginal_sex", "anal_sex", "other"]);
    if (!participantA || !participantB || participantA.localeCompare(participantB, undefined, { sensitivity: "base" }) === 0) return context.json({ error: "서로 다른 참여자 두 명을 선택하세요." }, 400);
    if (!allowedActs.has(act) || (act === "other" && !customLabel)) return context.json({ error: "스킨십 종류를 확인하세요." }, 400);
    const contextValue = ["mutual", "initiated", "coerced", "nonconsensual", "ambiguous"].includes(body.interactionContext ?? "") ? body.interactionContext! : "ambiguous";
    const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
    if (!chat) return context.json({ error: "Chat not found" }, 404);
    const source = body.sourceMessageId
      ? db.prepare("SELECT message_id,ordinal FROM messages WHERE chat_id=? AND message_id=? AND memory_excluded=0 AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')").get(chatId, body.sourceMessageId) as { message_id: string; ordinal: number } | undefined
      : undefined;
    if (body.sourceMessageId && !source) return context.json({ error: "연결할 수 있는 활성 원문을 찾지 못했습니다." }, 400);
    const ordinal = source?.ordinal ?? (db.prepare("SELECT MAX(ordinal) ordinal FROM messages WHERE chat_id=? AND lifecycle IN ('committed','client_pruned')").get(chatId) as { ordinal: number | null }).ordinal;
    const revision = chat.revision + 1;
    const pair = [participantA, participantB].sort((left, right) => left.localeCompare(right));
    const inserted: string[] = [];
    db.transaction(() => {
      for (const milestoneKey of intimacyMilestoneKeys(act)) {
        const existing = db.prepare("SELECT id,active FROM physical_intimacy_milestones WHERE chat_id=? AND participant_a=? AND participant_b=? AND milestone_key=?").get(chatId, pair[0], pair[1], milestoneKey) as { id: string; active: number } | undefined;
        if (existing?.active === 1) continue;
        const id = existing?.id ?? randomUUID();
        db.prepare(`INSERT INTO physical_intimacy_milestones(id,chat_id,participant_a,participant_b,milestone_key,act,custom_label,initiator,interaction_context,circumstance,evidence_json,source_memory_id,source_start_ordinal,auto_inject,manual_override,deleted_by_user,active,created_revision,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,1,?,?) ON CONFLICT(chat_id,participant_a,participant_b,milestone_key) DO UPDATE SET
            act=excluded.act,custom_label=excluded.custom_label,initiator=excluded.initiator,interaction_context=excluded.interaction_context,
            circumstance=excluded.circumstance,evidence_json=excluded.evidence_json,source_start_ordinal=excluded.source_start_ordinal,auto_inject=excluded.auto_inject,
            manual_override=1,deleted_by_user=0,active=1,
            created_revision=excluded.created_revision,created_at=excluded.created_at`).run(id, chatId, pair[0], pair[1], milestoneKey, act, customLabel,
          body.initiator?.trim() || null, contextValue, body.circumstance?.trim() || null, JSON.stringify(source ? [{ messageId: source.message_id }] : []), null, ordinal, body.autoInject === false ? 0 : 1, revision, Date.now());
        inserted.push(id);
      }
      db.prepare("UPDATE chats SET revision=?,updated_at=? WHERE id=?").run(revision, Date.now(), chatId);
    })();
    return inserted.length ? context.json({ ok: true, id: inserted[0], inserted }) : context.json({ error: "해당 최초 마일스톤이 이미 기록되어 있습니다.", code: "DUPLICATE_LEDGER_ITEM" }, 409);
  });
  app.patch("/v1/chats/:id/physical-intimacy/:itemId", async (context) => {
    const chatId = context.req.param("id");
    const itemId = context.req.param("itemId");
    const current = db.prepare("SELECT * FROM physical_intimacy_milestones WHERE id=? AND chat_id=? AND active=1").get(itemId, chatId) as any;
    if (!current) return context.json({ error: "기록을 찾지 못했습니다." }, 404);
    const body = await context.req.json() as { participantA?: string; participantB?: string; act?: string; customLabel?: string; initiator?: string; interactionContext?: string; circumstance?: string; sourceMessageId?: string; autoInject?: boolean };
    const participantA = body.participantA?.trim() || current.participant_a;
    const participantB = body.participantB?.trim() || current.participant_b;
    const act = body.act?.trim() || current.act;
    const customLabel = Object.hasOwn(body, "customLabel") ? body.customLabel?.trim() || null : current.custom_label;
    if (participantA.localeCompare(participantB, undefined, { sensitivity: "base" }) === 0 || (act === "other" && !customLabel)) return context.json({ error: "입력값을 확인하세요." }, 400);
    if (!intimacyMilestoneKeys(act).includes(current.milestone_key)) return context.json({ error: "이 실제 행위는 현재 최초 마일스톤 종류와 맞지 않습니다. 기존 행을 삭제하고 새 최초 행위로 추가하세요." }, 400);
    const sourceWasEdited = Object.hasOwn(body, "sourceMessageId");
    const source = body.sourceMessageId
      ? db.prepare("SELECT message_id,ordinal FROM messages WHERE chat_id=? AND message_id=? AND memory_excluded=0 AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')").get(chatId, body.sourceMessageId) as { message_id: string; ordinal: number } | undefined
      : undefined;
    if (body.sourceMessageId && !source) return context.json({ error: "연결할 수 있는 활성 원문을 찾지 못했습니다." }, 400);
    const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number };
    const revision = chat.revision + 1;
    const ordinal = sourceWasEdited
      ? source?.ordinal ?? (db.prepare("SELECT MAX(ordinal) ordinal FROM messages WHERE chat_id=?").get(chatId) as { ordinal: number | null }).ordinal
      : current.source_start_ordinal;
    const contextValue = ["mutual", "initiated", "coerced", "nonconsensual", "ambiguous"].includes(body.interactionContext ?? "") ? body.interactionContext! : current.interaction_context;
    const pair = [participantA, participantB].sort((left, right) => left.localeCompare(right));
    db.transaction(() => {
      const semanticEdit = ["participantA", "participantB", "act", "customLabel", "initiator", "interactionContext", "circumstance", "sourceMessageId"].some((key) => Object.hasOwn(body, key));
      db.prepare(`UPDATE physical_intimacy_milestones SET participant_a=?,participant_b=?,act=?,custom_label=?,initiator=?,interaction_context=?,circumstance=?,
        evidence_json=?,source_start_ordinal=?,auto_inject=?,manual_override=CASE WHEN ? THEN 1 ELSE manual_override END,deleted_by_user=0,created_revision=? WHERE id=?`).run(pair[0], pair[1], act, customLabel,
        Object.hasOwn(body, "initiator") ? body.initiator?.trim() || null : current.initiator,
        contextValue, Object.hasOwn(body, "circumstance") ? body.circumstance?.trim() || null : current.circumstance,
        sourceWasEdited ? JSON.stringify(source ? [{ messageId: source.message_id }] : []) : current.evidence_json,
        ordinal, body.autoInject === undefined ? current.auto_inject : body.autoInject ? 1 : 0, semanticEdit ? 1 : 0, revision, itemId);
      db.prepare("UPDATE chats SET revision=?,updated_at=? WHERE id=?").run(revision, Date.now(), chatId);
    })();
    if (current.source_memory_id) { refreshMemoryFts(db, current.source_memory_id); void embeddings.indexPending(chatId); }
    return context.json({ ok: true, id: itemId });
  });
  app.delete("/v1/chats/:id/physical-intimacy/:itemId", (context) => {
    const chatId = context.req.param("id");
    const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
    if (!chat) return context.json({ error: "Chat not found" }, 404);
    const current = db.prepare("SELECT source_memory_id FROM physical_intimacy_milestones WHERE id=? AND chat_id=? AND active=1").get(context.req.param("itemId"), chatId) as { source_memory_id: string | null } | undefined;
    const revision = chat.revision + 1;
    const changed = db.transaction(() => {
      const result = db.prepare("UPDATE physical_intimacy_milestones SET active=0,manual_override=1,deleted_by_user=1,created_revision=? WHERE id=? AND chat_id=? AND active=1").run(revision, context.req.param("itemId"), chatId).changes;
      if (result) db.prepare("UPDATE chats SET revision=?,updated_at=? WHERE id=?").run(revision, Date.now(), chatId);
      return result;
    })();
    if (changed && current?.source_memory_id) { refreshMemoryFts(db, current.source_memory_id); void embeddings.indexPending(chatId); }
    return changed ? context.json({ ok: true }) : context.json({ error: "기록을 찾지 못했습니다." }, 404);
  });
  function readDashboardEntities(chatId: string) {
    const prominence = new Map((db.prepare("SELECT entity_name,tier,scene_count,durable_links,pinned FROM entity_prominence WHERE chat_id=?").all(chatId) as Array<Record<string, any>>)
      .map((row) => [String(row.entity_name).toLocaleLowerCase(), { tier: row.tier, sceneCount: row.scene_count, durableLinks: row.durable_links, pinned: row.pinned === 1 }]));
    return { items: listEntities(db, chatId).map((entity) => ({ ...entity, ...(prominence.get(entity.name.toLocaleLowerCase()) ?? { tier: "incidental", sceneCount: 0, durableLinks: 0, pinned: false }) })) };
  }
  app.get("/v1/chats/:id/entities", (context) => context.json(readDashboardEntities(context.req.param("id"))));
  app.patch("/v1/chats/:id/entities/:entityId/prominence", async (context) => {
    const chatId = context.req.param("id");
    const entity = db.prepare("SELECT name FROM entities WHERE id=? AND chat_id=?").get(context.req.param("entityId"), chatId) as { name: string } | undefined;
    if (!entity) return context.json({ error: "Entity not found" }, 404);
    const body = await context.req.json() as { pinned?: unknown };
    if (typeof body.pinned !== "boolean") return context.json({ error: "pinned must be boolean" }, 400);
    db.prepare(`INSERT INTO entity_prominence(chat_id,entity_name,tier,scene_count,durable_links,pinned,updated_at) VALUES(?,?,?,0,0,?,?)
      ON CONFLICT(chat_id,entity_name) DO UPDATE SET pinned=excluded.pinned,tier=CASE WHEN excluded.pinned=1 THEN 'core' ELSE CASE WHEN entity_prominence.scene_count>=4 AND entity_prominence.durable_links>0 THEN 'core' WHEN entity_prominence.scene_count>=2 OR entity_prominence.durable_links>0 THEN 'recurring' ELSE 'incidental' END END,updated_at=excluded.updated_at`)
      .run(chatId, entity.name, body.pinned ? "core" : "incidental", body.pinned ? 1 : 0, Date.now());
    return context.json({ ok: true });
  });
  app.post("/v1/chats/:id/entities/:entityId/delete-preview", (context) => {
    try { return context.json(previewEntityDelete(db, context.req.param("id"), context.req.param("entityId"))); }
    catch (error: any) { return context.json({ error: error instanceof Error ? error.message : String(error), code: error?.code }, error?.code === "ENTITY_NOT_FOUND" ? 404 : 400); }
  });
  app.delete("/v1/chats/:id/entities/:entityId", (context) => {
    const rawRevision = context.req.query("revision");
    const revision = rawRevision === undefined || rawRevision.trim() === "" ? NaN : Number(rawRevision);
    if (!Number.isSafeInteger(revision) || revision < 0) return context.json({ error: "preview revision is required" }, 400);
    try {
      deleteEntity(db, context.req.param("id"), context.req.param("entityId"), revision);
      embeddings.stateIndex.prune(context.req.param("id"));
      void embeddings.indexPending(context.req.param("id"));
      return context.json({ ok: true });
    } catch (error: any) {
      const status = error?.code === "ENTITY_DELETE_STALE" || error?.code === "ENTITY_DELETE_BUSY" ? 409 : error?.code === "ENTITY_NOT_FOUND" ? 404 : 400;
      return context.json({ error: error instanceof Error ? error.message : String(error), code: error?.code }, status);
    }
  });
  app.post("/v1/chats/:id/entities/merge-preview", async (context) => {
    const body = await context.req.json() as { sourceId?: string; targetId?: string };
    if (!body.sourceId || !body.targetId) return context.json({ error: "sourceId and targetId are required" }, 400);
    try { return context.json(previewEntityMerge(db, context.req.param("id"), body.sourceId, body.targetId)); }
    catch (error: any) {
      const status = error?.code === "ENTITY_NOT_FOUND" ? 404 : 400;
      return context.json({ error: error instanceof Error ? error.message : String(error), code: error?.code }, status);
    }
  });
  app.post("/v1/chats/:id/entities/merge", async (context) => {
    const body = await context.req.json() as { sourceId?: string; targetId?: string; revision?: number };
    if (!body.sourceId || !body.targetId || !Number.isInteger(body.revision)) return context.json({ error: "sourceId, targetId, and preview revision are required" }, 400);
    try { return context.json({ ok: true, ...mergeEntities(db, context.req.param("id"), body.sourceId, body.targetId, body.revision) }); }
    catch (error: any) {
      const status = error?.code === "ENTITY_MERGE_BUSY" || error?.code === "ENTITY_MERGE_STALE" ? 409 : error?.code === "ENTITY_NOT_FOUND" ? 404 : 400;
      return context.json({ error: error instanceof Error ? error.message : String(error), code: error?.code }, status);
    }
  });
  app.get("/v1/chats/:id/reconciliation-reviews", (context) => context.json({ items: listReconciliationReviews(db, context.req.param("id")) }));
  app.patch("/v1/chats/:id/reconciliation-reviews/:reviewId", async (context) => {
    const body = ReconciliationReviewResolutionSchema.parse(await context.req.json());
    resolveReconciliationReview(db, context.req.param("id"), context.req.param("reviewId"), body);
    void embeddings.indexPending(context.req.param("id"));
    return context.json({ ok: true });
  });
  app.get("/v1/chats/:id/episodes/active", (context) => context.json(episodeOverview(db, context.req.param("id"))));
  app.post("/v1/chats/:id/episodes/:episodeId/release", (context) => {
    try {
      releaseManualEpisode(db, context.req.param("id"), context.req.param("episodeId"));
      serverWorker.wake();
      return context.json({ ok: true, ...episodeOverview(db, context.req.param("id")) });
    } catch (error: any) { return context.json({ error: error.message }, 409); }
  });
  app.post("/v1/chats/:id/episodes/:episodeId/retry", (context) => {
    const automatic = db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND type='episode' AND json_extract(payload_json,'$.episodeId')=? AND json_extract(payload_json,'$.batchId') IS NOT NULL")
      .get(context.req.param('id'), context.req.param('episodeId'));
    if (!automatic) return context.json({ error: '수동 보류는 해제한 뒤 원문 구간에서 정리해 줘' }, 409);
    retryEpisode(db, context.req.param("id"), context.req.param("episodeId"));
    serverWorker.wake();
    return context.json({ ok: true, ...episodeOverview(db, context.req.param("id")) });
  });
  app.post("/v1/chats/:id/backfill-runs/:runId/acknowledge", (context) => {
    const chatId = context.req.param("id");
    const runId = context.req.param("runId");
    const exists = db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND json_extract(payload_json,'$.backfillRunId')=? LIMIT 1").get(chatId, runId);
    if (!exists) return context.json({ error: "Backfill run not found" }, 404);
    db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(`backfill_ack:${chatId}:${runId}`, String(Date.now()));
    return context.json({ ok: true });
  });
  // Every quiz operation can materialize quiz_state. Unknown chats must stop before ensureState.
  app.use("/v1/chats/:id/quiz/*", async (context, next) => {
    if (context.req.method === "GET" && context.req.path.endsWith("/quiz/next")) return next();
    if (!db.prepare("SELECT 1 FROM chats WHERE id=?").get(context.req.param("id"))) return context.json({ error: "Chat not found", code: "CHAT_NOT_FOUND" }, 404);
    await next();
  });
  app.get("/v1/chats/:id/quiz/next", (context) => {
    const result = nextQuiz(db, context.req.param("id"));
    if (quizStatus(db, context.req.param("id")).generating) serverWorker.wake();
    return context.json(result);
  });
  app.post("/v1/chats/:id/quiz/:itemId/answer", async (context) => {
    const body = QuizAnswerRequestSchema.parse(await context.req.json());
    const result = answerQuiz(db, context.req.param("id"), context.req.param("itemId"), body.chosenIndex, body.attemptToken);
    return result ? context.json(result) : context.json({ error: "퀴즈를 찾을 수 없어." }, 404);
  });
  app.put("/v1/quiz/enabled", async (context) => {
    z.object({ enabled: z.literal(false) }).parse(await context.req.json());
    disableAllQuizzes(db);
    return context.json({ ok: true });
  });
  app.put("/v1/chats/:id/quiz/enabled", async (context) => {
    const body = z.object({ enabled: z.boolean() }).parse(await context.req.json());
    setQuizEnabled(db, context.req.param("id"), body.enabled);
    const result = nextQuiz(db, context.req.param("id"));
    if (quizStatus(db, context.req.param("id")).generating) serverWorker.wake();
    return context.json(result);
  });
  app.get("/v1/chats/:id/quiz/status", (context) => context.json(quizStatus(db, context.req.param("id"))));
  app.post("/v1/chats/:id/quiz/regenerate", (context) => {
    const result = regenerateQuizzes(db, context.req.param("id"));
    if (result.enqueued) serverWorker.wake();
    return context.json(result);
  });
  app.delete("/v1/chats/:id/quiz/stats", (context) => context.json(resetQuizStats(db, context.req.param("id"))));
  function readDashboardStatus(chatId: string) {
    const jobs = db.prepare(`SELECT
      SUM(CASE WHEN status IN ('queued','leased') AND type<>'quiz' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status IN ('done','archived') AND type<>'quiz' THEN 1 ELSE 0 END) AS completed,
      MAX(CASE WHEN status IN ('done','archived') AND type<>'quiz' THEN updated_at END) AS lastCompleted,
      SUM(CASE WHEN status='failed' AND type<>'quiz' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='failed' AND type IN ('extract','audit_retry','episode','social_backfill','initial_calibration') THEN 1 ELSE 0 END) AS blockingFailed,
      SUM(CASE WHEN status='failed' AND type IN ('ledger_consistency','relationship_projection','story_consolidation') THEN 1 ELSE 0 END) AS advisoryFailed
      FROM jobs WHERE chat_id=?`).get(chatId) as { completed: number | null; lastCompleted: number | null; queued: number | null; failed: number | null; blockingFailed: number | null; advisoryFailed: number | null };
    const pendingReconciliations = (db.prepare("SELECT count(*) AS count FROM reconciliation_items WHERE chat_id=? AND status='pending'").get(chatId) as { count: number }).count;
    const pendingExtractionAudits = (db.prepare("SELECT count(*) AS count FROM extraction_audits WHERE chat_id=? AND status IN ('pending_review','failed')").get(chatId) as { count: number }).count;
    const ingestion = ingestionSummary(db, chatId);
    const embeddingJobs = db.prepare(`SELECT
      SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
      FROM embedding_blocks WHERE chat_id=?`).get(chatId) as { pending: number | null; failed: number | null };
    const sourceProgress = db.prepare(`SELECT SUM(CASE WHEN memory_excluded=0 THEN 1 ELSE 0 END) total,
      SUM(CASE WHEN memory_excluded=0 AND extraction_state IN ('done','encapsulated','skipped_policy') THEN 1 ELSE 0 END) processed
      FROM messages WHERE chat_id=? AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before') AND content IS NOT NULL`).get(chatId) as { total: number; processed: number | null };
    const derivedCounts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM memories WHERE chat_id=? AND active=1) memories,
      (SELECT COUNT(*) FROM memory_details WHERE chat_id=? AND active=1) details,
      (SELECT COUNT(*) FROM relationship_projection_queue WHERE chat_id=?) projectionPairs`).get(chatId, chatId, chatId) as { memories: number; details: number; projectionPairs: number };
    const latestBackfill = db.prepare(`SELECT json_extract(payload_json,'$.backfillRunId') runId,created_at createdAt
      FROM jobs WHERE chat_id=? AND type IN ('initial_calibration','extract','episode','ledger_consistency','relationship_projection','story_consolidation')
        AND json_extract(payload_json,'$.backfillRunId') IS NOT NULL
      ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(chatId) as { runId: string; createdAt: number } | undefined;
    const groupProgress = (latestBackfill?.runId
      ? db.prepare(`SELECT COUNT(*) total,
          SUM(CASE WHEN status IN ('done','archived') THEN 1 ELSE 0 END) processed,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
          FROM jobs WHERE chat_id=? AND type IN ('extract','episode','social_backfill') AND json_extract(payload_json,'$.backfillRunId')=?`).get(chatId, latestBackfill.runId)
      : db.prepare(`SELECT COUNT(*) total,
          SUM(CASE WHEN status IN ('done','archived') THEN 1 ELSE 0 END) processed,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
          FROM jobs WHERE chat_id=? AND type IN ('extract','episode','social_backfill')`).get(chatId)) as { total: number | null; processed: number | null; failed: number | null };
    const downstreamJobs = (latestBackfill?.runId ? db.prepare(`SELECT
      COUNT(CASE WHEN type='relationship_projection' THEN 1 END) projectionTotal,
      SUM(CASE WHEN type='relationship_projection' AND status IN ('done','failed','archived') THEN 1 ELSE 0 END) projectionProcessed,
      SUM(CASE WHEN type='relationship_projection' AND status IN ('queued','leased') THEN 1 ELSE 0 END) projectionJobs,
      SUM(CASE WHEN type='relationship_projection' AND status='failed' THEN 1 ELSE 0 END) projectionFailed,
      COUNT(CASE WHEN type='story_consolidation' THEN 1 END) storyTotal,
      SUM(CASE WHEN type='story_consolidation' AND status IN ('done','failed','archived') THEN 1 ELSE 0 END) storyProcessed,
      SUM(CASE WHEN type='story_consolidation' AND status IN ('queued','leased') THEN 1 ELSE 0 END) storyJobs,
      SUM(CASE WHEN type='story_consolidation' AND status='failed' THEN 1 ELSE 0 END) storyFailed
      FROM jobs WHERE chat_id=? AND json_extract(payload_json,'$.backfillRunId')=?`).get(chatId, latestBackfill.runId)
      : { projectionTotal: 0, projectionProcessed: 0, projectionJobs: 0, projectionFailed: 0, storyTotal: 0, storyProcessed: 0, storyJobs: 0, storyFailed: 0 }) as { projectionTotal: number | null; projectionProcessed: number | null; projectionJobs: number | null; projectionFailed: number | null; storyTotal: number | null; storyProcessed: number | null; storyJobs: number | null; storyFailed: number | null };
    const taskProgress = db.prepare(`SELECT
      COUNT(*) total,
      SUM(CASE WHEN status IN ('done','archived') THEN 1 ELSE 0 END) processed,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
      FROM jobs WHERE chat_id=? AND type IN ('extract','episode','social_backfill','audit_retry','ledger_consistency','relationship_projection','story_consolidation')`).get(chatId) as { total: number; processed: number | null; failed: number | null };
    const activePipeline = db.prepare(`SELECT COALESCE(json_extract(payload_json,'$.pipelineStage'),json_extract(payload_json,'$.operationStage')) stage,
      json_extract(payload_json,'$.pipelineManualRetry') manualRetry,
      json_extract(payload_json,'$.pipelineRetryAttempt') retryAttempt,
      json_extract(payload_json,'$.pipelineMaxAttempts') retryMax,
      CASE WHEN type='extract' THEN json_extract(payload_json,'$.operationStageOrdinal') END groupOrdinal,
      CASE WHEN type='extract' THEN json_extract(payload_json,'$.operationStageTotal') END groupTotal
      FROM jobs WHERE chat_id=? AND status IN ('leased','queued')${latestBackfill?.runId ? " AND json_extract(payload_json,'$.backfillRunId')=?" : ""}
      ORDER BY status='leased' DESC,CASE WHEN json_extract(payload_json,'$.pipelineStage')='retrying' THEN 0 ELSE 1 END,created_at,rowid LIMIT 1`).get(...(latestBackfill?.runId ? [chatId, latestBackfill.runId] : [chatId])) as { stage: string | null; manualRetry: number | null; retryAttempt: number | null; retryMax: number | null; groupOrdinal: number | null; groupTotal: number | null } | undefined;
    const ledgerProgress = latestBackfill?.runId
      ? db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status IN ('done','failed','archived') THEN 1 ELSE 0 END) processed,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed
          FROM jobs WHERE chat_id=? AND type='ledger_consistency' AND json_extract(payload_json,'$.backfillRunId')=?`).get(chatId, latestBackfill.runId) as { total: number; processed: number | null; failed: number | null }
      : { total: 0, processed: 0, failed: 0 };
    const ledgerBarrierActive = Boolean(latestBackfill?.runId && db.prepare(`SELECT 1 FROM jobs WHERE chat_id=? AND type IN ('extract','episode','ledger_consistency')
      AND status IN ('queued','leased') AND json_extract(payload_json,'$.backfillRunId')=? LIMIT 1`).get(chatId, latestBackfill.runId));
    const callProgress = latestBackfill?.runId ? db.prepare(`SELECT
      SUM(COALESCE(json_extract(payload_json,'$.llmCallStats.total'),0)) total,
      SUM(COALESCE(json_extract(payload_json,'$.llmCallStats.repairs'),0)) repairs,
      SUM(CASE WHEN status IN ('queued','leased') THEN 1 ELSE 0 END) active
      FROM jobs WHERE chat_id=? AND json_extract(payload_json,'$.backfillRunId')=?`).get(chatId, latestBackfill.runId) as { total: number | null; repairs: number | null; active: number | null }
      : { total: 0, repairs: 0, active: 0 };
    const acknowledged = latestBackfill?.runId ? Boolean(db.prepare("SELECT 1 FROM server_meta WHERE key=?").get(`backfill_ack:${chatId}:${latestBackfill.runId}`)) : true;
    const responseFailure = db.prepare("SELECT json_extract(payload_json,'$.modelResponseDiagnostic') diagnostic FROM jobs WHERE chat_id=? AND status='failed' AND json_type(payload_json,'$.modelResponseDiagnostic')='object' ORDER BY updated_at DESC LIMIT 1").get(chatId) as { diagnostic: string } | undefined;
    const calibration = initialCalibrationView(db, chatId);
    const lastJob = db.prepare("SELECT json_extract(payload_json,'$.sourceRecoveryMetadata') metadata FROM jobs WHERE chat_id=? AND type<>'quiz' AND status IN ('done','failed') ORDER BY updated_at DESC,rowid DESC LIMIT 1").get(chatId) as { metadata: string | null } | undefined;
    const calibrationPending = ["unseeded", "awaiting_setup", "queued", "awaiting_confirmation"].includes(calibration.status);
    const chat = db.prepare("SELECT revision,memory_language FROM chats WHERE id=?").get(chatId) as { revision: number; memory_language: MemoryLanguage } | undefined;
    const memoryUpdatedAt = (db.prepare("SELECT MAX(updated_at) value FROM memories WHERE chat_id=? AND active=1").get(chatId) as { value: number | null }).value;
    return {
      serverInstanceId, memoryLanguage: chat?.memory_language,
      translationRevision: JSON.stringify([chat?.revision, memoryUpdatedAt, derivedCounts.memories, derivedCounts.details, jobs.completed, jobs.lastCompleted]),
      queuedJobs: Number(jobs.queued ?? 0), failedJobs: Number(jobs.failed ?? 0), blockingFailedJobs: Number(jobs.blockingFailed ?? 0), advisoryFailedJobs: Number(jobs.advisoryFailed ?? 0), pendingReviews: pendingReconciliations + pendingExtractionAudits,
      pendingReconciliations,
      ...ingestion,
      pendingEmbeddings: Number(embeddingJobs.pending ?? 0), failedEmbeddings: Number(embeddingJobs.failed ?? 0),
      auxiliaryAuthFailed: (db.prepare("SELECT last_error FROM jobs WHERE chat_id=? AND status='failed'").all(chatId) as Array<{ last_error: string | null }>).some(job => isProviderAuthenticationError(job.last_error)),
      progress: { processedMessages: Number(sourceProgress.processed ?? 0), totalMessages: Number(sourceProgress.total ?? 0), excludedMessages: ingestion.excludedMessages,
        processedGroups: Number(groupProgress.processed ?? 0), totalGroups: Number(groupProgress.total ?? 0), failedGroups: Number(groupProgress.failed ?? 0),
        memories: derivedCounts.memories, details: derivedCounts.details,
        pendingRelationshipPairs: derivedCounts.projectionPairs, pendingRelationshipProjectionJobs: Number(downstreamJobs.projectionJobs ?? 0),
        processedTasks: Number(taskProgress.processed ?? 0), totalTasks: Number(taskProgress.total ?? 0), failedTasks: Number(taskProgress.failed ?? 0), activeStage: activePipeline?.stage ?? undefined,
        manualRetry: activePipeline?.manualRetry === 1,
        retryAttempt: Number(activePipeline?.retryAttempt ?? 0) || undefined, retryMax: Number(activePipeline?.retryMax ?? 0) || undefined,
        activeGroupOrdinal: Number(activePipeline?.groupOrdinal ?? 0) || undefined, activeGroupTotal: Number(activePipeline?.groupTotal ?? 0) || undefined,
        ledgerProcessed: Number(ledgerProgress.processed ?? 0), ledgerTotal: Number(ledgerProgress.total ?? 0), ledgerFailed: Number(ledgerProgress.failed ?? 0), downstreamWaiting: ledgerBarrierActive,
        relationshipProcessed: Number(downstreamJobs.projectionProcessed ?? 0), relationshipTotal: Number(downstreamJobs.projectionTotal ?? 0), relationshipFailed: Number(downstreamJobs.projectionFailed ?? 0),
        storyProcessed: Number(downstreamJobs.storyProcessed ?? 0), storyTotal: Number(downstreamJobs.storyTotal ?? 0), storyPending: Number(downstreamJobs.storyJobs ?? 0), storyFailed: Number(downstreamJobs.storyFailed ?? 0),
        llmCalls: Number(callProgress.total ?? 0), repairCalls: Number(callProgress.repairs ?? 0), runComplete: Boolean(latestBackfill?.runId && Number(callProgress.active ?? 0) === 0 && !calibrationPending), acknowledged,
        backfillRunId: latestBackfill?.runId },
      modelResponseDiagnostic: responseFailure ? JSON.parse(responseFailure.diagnostic) : undefined,
      initialCalibration: calibration,
      worker: serverWorker.statusForChat(chatId),
      episode: (episodeOverview(db, chatId) as any).active,
      lineage: getChatLineage(db, chatId),
    };
  }
  app.get("/v1/chats/:id/status", (context) => context.json(readDashboardStatus(context.req.param("id"))));
  app.patch("/v1/chats/:id/relationships", async (context) => {
    const body = await context.req.json() as Record<string, unknown>;
    if(!UserCorrectionEditSchema.safeParse(body).success) return context.json({error:"locked must be boolean"},400);
    const from = String(body.from ?? "").trim();
    const to = String(body.to ?? "").trim();
    if (!from || !to) return context.json({ error: "from and to are required" }, 400);
    const chatId = context.req.param("id");
    try {
      const item = setRelationshipProjectionOverride(db, chatId, from, to, body);
      if (flushRelationshipProjectionQueue(db, chatId) > 0) serverWorker.wake();
      return context.json({ ok: true, item });
    }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  function readDashboardWorld(chatId: string, query: { atRevision?: string; atOrdinal?: string; includeHistory?: string } = {}) {
    const atRevision = Number(query.atRevision);
    const atOrdinal = Number(query.atOrdinal);
    const hasRevision = Number.isInteger(atRevision) && atRevision >= 0;
    const hasOrdinal = Number.isInteger(atOrdinal) && atOrdinal >= 0;
    const clauses = ["chat_id=?"];
    const values: Array<string | number> = [chatId];
    if (hasRevision) {
      clauses.push("valid_from_revision<=?", "(valid_to_revision IS NULL OR valid_to_revision>=?)");
      values.push(atRevision, atRevision);
    } else clauses.push("valid_to_revision IS NULL");
    if (hasOrdinal) {
      clauses.push("(valid_from_ordinal IS NULL OR valid_from_ordinal<=?)", "(valid_to_ordinal IS NULL OR valid_to_ordinal>=?)");
      values.push(atOrdinal, atOrdinal);
    }
    const includeHistory = query.includeHistory === "true";
    type LastMentionRow = Record<string, unknown> & { last_mention_ordinal: number | null; last_mention_story_time: string | null };
    const withLastMention = (row: LastMentionRow) => {
      const { last_mention_ordinal, last_mention_story_time, ...item } = row;
      return { ...item, ...correctionView(item as any), lastMention: { ordinal: last_mention_ordinal, storyTime: last_mention_story_time } };
    };
    const assertionItem = (row: LastMentionRow) => {
      const item = withLastMention(row);
      const relation = parseSocialRelation(row.social_relation_json);
      return { ...item, stateKind: row.state_kind,
        ...(["goal", "secret"].includes(String(row.state_kind)) ? publicKnowledgeScope(resolveAssertionHolders(db, chatId, row)) : {}),
        ...(relation ? { socialRelation: { ...relation, ...publicKnowledgeScope(socialRelationKnowledge(db, chatId, relation) ?? []) } } : {}) };
    };
    const assertionSelect = `SELECT assertions.*,
      (SELECT MAX(msg.ordinal) FROM json_each(assertions.evidence_json) ev CROSS JOIN messages msg
        ON msg.chat_id=assertions.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')) AS last_mention_ordinal,
      (SELECT story_time_normalized FROM memories WHERE id=assertions.source_memory_id AND chat_id=assertions.chat_id) AS last_mention_story_time
      FROM assertions`;
    const beliefSelect = `SELECT beliefs.*,
      (SELECT MAX(msg.ordinal) FROM json_each(beliefs.evidence_json) ev CROSS JOIN messages msg
        ON msg.chat_id=beliefs.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')) AS last_mention_ordinal,
      NULL AS last_mention_story_time FROM beliefs`;
    const promiseSelect = `SELECT promises.*,
      NULLIF(MAX(
        COALESCE((SELECT MAX(msg.ordinal) FROM memories source JOIN json_each(source.evidence_json) ev CROSS JOIN messages msg
          ON msg.chat_id=source.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')
          WHERE source.id=promises.source_memory_id AND source.chat_id=promises.chat_id),-1),
        COALESCE((SELECT MAX(source_ordinal) FROM promise_events WHERE chat_id=promises.chat_id AND promise_id=promises.id),-1)
      ),-1) AS last_mention_ordinal,
      (SELECT story_time_normalized FROM memories WHERE id=promises.source_memory_id AND chat_id=promises.chat_id) AS last_mention_story_time
      FROM promises`;
    return {
      at: { revision: hasRevision ? atRevision : null, ordinal: hasOrdinal ? atOrdinal : null },
      assertions: (db.prepare(`${assertionSelect} WHERE ${clauses.join(" AND ")}`).all(...values) as LastMentionRow[]).map(assertionItem),
      beliefs: (db.prepare(`${beliefSelect} WHERE chat_id=? AND active=1`).all(chatId) as LastMentionRow[]).map(withLastMention),
      promises: (db.prepare(`${promiseSelect} WHERE chat_id=?`).all(chatId) as LastMentionRow[]).map(withLastMention),
      ...(includeHistory ? {
        endedAssertions: (db.prepare(`${assertionSelect} WHERE chat_id=? AND valid_to_revision IS NOT NULL ORDER BY COALESCE(valid_to_ordinal,2147483647) DESC,created_at DESC`).all(chatId) as LastMentionRow[]).map(assertionItem),
        endedBeliefs: (db.prepare(`${beliefSelect} WHERE chat_id=? AND active=0 AND (source IS NULL OR source NOT LIKE 'user_deleted:%') ORDER BY COALESCE(valid_to_ordinal,2147483647) DESC,created_at DESC`).all(chatId) as LastMentionRow[]).map(withLastMention),
        userDeletedBeliefs: (db.prepare(`${beliefSelect} WHERE chat_id=? AND active=0 AND source LIKE 'user_deleted:%' ORDER BY created_at DESC`).all(chatId) as LastMentionRow[]).map(withLastMention),
        promiseHistory: db.prepare("SELECT * FROM promise_events WHERE chat_id=? ORDER BY COALESCE(source_ordinal,2147483647),created_at").all(chatId),
      } : {}),
    };
  }
  app.get("/v1/chats/:id/world-state", (context) => context.json(readDashboardWorld(context.req.param("id"), context.req.query())));
  app.post("/v1/chats/:id/world-state", async (context) => {
    const chatId = context.req.param("id");
    const body = await context.req.json() as { kind?: string; subject?: string; predicate?: string; holder?: string; promisor?: string; promisee?: string; value?: string; stateKind?: string; confidence?: number; polarity?: string; status?: string; content?: string; scope?: string; scheduledFor?: string; statusReason?: string; sourceMessageId?: string; socialRelation?: unknown; knownBy?: string[]; knownByEveryone?: boolean; locked?: boolean };
    if(!UserCorrectionEditSchema.safeParse(body).success) return context.json({error:"locked must be boolean"},400);
    const parsedSocial = body.socialRelation == null ? undefined : SocialRelationSchema.safeParse(body.socialRelation);
    if (parsedSocial && !parsedSocial.success) return context.json({ error: "Invalid social relation" }, 400);
    if (body.stateKind !== undefined && !STATE_KIND_VALUES.includes(body.stateKind as typeof STATE_KIND_VALUES[number])) return context.json({ error: "unsupported state kind" }, 400);
    if (body.knownBy !== undefined && (!Array.isArray(body.knownBy) || body.knownBy.some(name => typeof name !== "string" || !name.trim()))) return context.json({ error: "knownBy must be character names" }, 400);
    if (body.knownByEveryone !== undefined && typeof body.knownByEveryone !== "boolean") return context.json({ error: "knownByEveryone must be boolean" }, 400);
    const manualSocial = parsedSocial?.success ? JSON.stringify({ ...parsedSocial.data, detailIds: [], manual: true, knownBy: body.knownBy ?? [], knownByEveryone: body.knownByEveryone ?? false }) : null;
    const kind = body.kind;
    const required = kind === "assertion" ? [body.subject, body.predicate, body.value] : kind === "belief" ? [body.holder, body.subject, body.predicate, body.value] : kind === "promise" ? [body.promisor, body.promisee, body.content] : [];
    if (!kind || required.length === 0 || required.some((value) => !value?.trim())) return context.json({ error: "필수 영문 정본 필드를 입력하세요." }, 400);
    const confidence = Math.max(0, Math.min(1, Number(body.confidence ?? (kind === "belief" ? 0.7 : 1))));
    const source = body.sourceMessageId ? db.prepare("SELECT message_id,ordinal FROM messages WHERE chat_id=? AND message_id=? AND memory_excluded=0 AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')").get(chatId, body.sourceMessageId) as { message_id: string; ordinal: number } | undefined : undefined;
    if (body.sourceMessageId && !source) return context.json({ error: "연결할 수 있는 활성 원문을 찾지 못했습니다." }, 400);
    const ordinal = source?.ordinal ?? (db.prepare("SELECT MAX(ordinal) ordinal FROM messages WHERE chat_id=? AND lifecycle IN ('committed','client_pruned')").get(chatId) as { ordinal: number | null }).ordinal;
    const evidence = JSON.stringify(source ? [{ messageId: source.message_id }] : []);
    const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
    if (!chat) return context.json({ error: "Chat not found" }, 404);
    const assertionStateKind = kind === "assertion" ? (manualSocial ? "condition" : body.stateKind ?? "condition") : undefined;
    const relationConflict = kind === "assertion" && parsedSocial?.success
      ? findSocialRelationConflict(db, chatId, body.subject!.trim(), parsedSocial.data) : undefined;
    if (relationConflict) return context.json(ledgerConflictResponse(relationConflict), 409);
    const duplicate = kind === "assertion"
      ? parsedSocial?.success
        ? socialRelationPredicateCollisions(db, chatId, body.subject!.trim(), body.predicate!.trim(), parsedSocial.data)[0]
        : assertionStateKind === "goal" || assertionStateKind === "secret"
        ? db.prepare("SELECT id FROM assertions WHERE chat_id=? AND subject=? COLLATE NOCASE AND predicate=? COLLATE NOCASE AND value=? COLLATE NOCASE AND state_kind=? AND valid_to_revision IS NULL")
          .get(chatId, body.subject!.trim(), body.predicate!.trim(), body.value!.trim(), assertionStateKind) as { id: string } | undefined
        : db.prepare("SELECT id FROM assertions WHERE chat_id=? AND subject=? COLLATE NOCASE AND predicate=? COLLATE NOCASE AND valid_to_revision IS NULL").get(chatId, body.subject!.trim(), body.predicate!.trim()) as { id: string } | undefined
      : kind === "belief"
        ? db.prepare("SELECT id FROM beliefs WHERE chat_id=? AND holder=? COLLATE NOCASE AND subject=? COLLATE NOCASE AND predicate=? COLLATE NOCASE AND active=1").get(chatId, body.holder!.trim(), body.subject!.trim(), body.predicate!.trim()) as { id: string } | undefined
        : db.prepare("SELECT id FROM promises WHERE chat_id=? AND promisor=? COLLATE NOCASE AND promisee=? COLLATE NOCASE AND content=? COLLATE NOCASE").get(chatId, body.promisor!.trim(), body.promisee!.trim(), body.content!.trim()) as { id: string } | undefined;
    if (duplicate) return context.json(ledgerConflictResponse({ code: "DUPLICATE_LEDGER_ITEM", existingId: duplicate.id }), 409);
    const id = randomUUID();
    const revision = chat.revision + 1;
    db.transaction(() => {
      if (kind === "assertion") {
        const stateKind = assertionStateKind!;
        db.prepare(`INSERT INTO assertions(id,chat_id,subject,predicate,value,state_kind,confidence,valid_from_revision,valid_from_ordinal,source_memory_id,evidence_json,retention_class,created_at) VALUES(?,?,?,?,?,?,?,?,?,NULL,?,'durable',?)`).run(id, chatId, body.subject!.trim(), body.predicate!.trim(), body.value!.trim(), stateKind, confidence, revision, ordinal, evidence, Date.now());
        if (stateKind === "goal" || stateKind === "secret") replaceItemAccess(db, chatId, "assertion", id,
          (body.knownBy ?? []).map((holder) => ({ holder: holder.trim(), basis: "internal", evidence: [], confidence: 1 })), revision, Date.now());
      }
      else if (kind === "belief") db.prepare(`INSERT INTO beliefs(id,chat_id,holder,subject,predicate,value,polarity,confidence,source,evidence_json,active,status,retention_class,created_revision,valid_from_ordinal,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,'active','durable',?,?,?)`).run(id, chatId, body.holder!.trim(), body.subject!.trim(), body.predicate!.trim(), body.value!.trim(), body.polarity ?? "believes", confidence, "manual", evidence, revision, ordinal, Date.now());
      else {
        const key = `manual:${randomUUID()}`;
        const status = ["open", "kept", "broken", "released", "offscreen"].includes(body.status ?? "") ? body.status! : "open";
        const scope = ["future", "recurring"].includes(body.scope ?? "") ? body.scope! : "future";
        db.prepare(`INSERT INTO promises(id,chat_id,promise_key,promisor,promisee,content,status,scheduled_for,status_reason,source_memory_id,retention_scope,updated_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,?)`).run(id, chatId, key, body.promisor!.trim(), body.promisee!.trim(), body.content!.trim(), status, body.scheduledFor?.trim() || null, body.statusReason?.trim() || null, scope, revision, Date.now());
        db.prepare(`INSERT INTO promise_events(id,chat_id,promise_id,promise_key,promisor,promisee,content,status,scheduled_for,status_reason,source_memory_id,source_ordinal,created_revision,created_at,user_authored) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,1)`).run(randomUUID(), chatId, id, key, body.promisor!.trim(), body.promisee!.trim(), body.content!.trim(), status, body.scheduledFor?.trim() || null, body.statusReason?.trim() || null, ordinal, revision, Date.now());
      }
      if (kind === "assertion" && manualSocial) db.prepare("UPDATE assertions SET social_relation_json=? WHERE id=?").run(manualSocial, id);
      db.prepare(`UPDATE ${kind === "assertion" ? "assertions" : kind === "belief" ? "beliefs" : "promises"} SET user_edit_ordinal=?,auto_locked=? WHERE id=? AND chat_id=?`)
        .run(committedEditOrdinal(db,chatId),Number(body.locked ?? false),id,chatId);
      db.prepare("UPDATE chats SET revision=?,updated_at=? WHERE id=?").run(revision, Date.now(), chatId);
    })();
    return context.json({ ok: true, id, userEdited:true,userEditOrdinal:committedEditOrdinal(db,chatId),locked:body.locked ?? false }, 201);
  });
  app.patch("/v1/chats/:id/world-state", async (context) => {
    const body = await context.req.json() as {
      kind?: string; id?: string; subject?: string; predicate?: string; holder?: string; promisor?: string; promisee?: string;
      value?: string; stateKind?: string; confidence?: number; polarity?: string; status?: string; content?: string; scheduledFor?: string; statusReason?: string; socialRelation?: unknown; knownBy?: string[]; knownByEveryone?: boolean; locked?: boolean;
    };
    const chatId = context.req.param("id");
    const parsedSocial = body.socialRelation == null ? undefined : SocialRelationSchema.safeParse(body.socialRelation);
    if(!UserCorrectionEditSchema.safeParse(body).success) return context.json({error:"locked must be boolean"},400);
    if (parsedSocial && !parsedSocial.success) return context.json({ error: "Invalid social relation" }, 400);
    if (body.stateKind !== undefined && !STATE_KIND_VALUES.includes(body.stateKind as typeof STATE_KIND_VALUES[number])) return context.json({ error: "unsupported state kind" }, 400);
    if (body.knownBy !== undefined && (!Array.isArray(body.knownBy) || body.knownBy.some(name => typeof name !== "string" || !name.trim()))) return context.json({ error: "knownBy must be character names" }, 400);
    if (body.knownByEveryone !== undefined && typeof body.knownByEveryone !== "boolean") return context.json({ error: "knownByEveryone must be boolean" }, 400);
    const manualSocial = parsedSocial?.success ? JSON.stringify({ ...parsedSocial.data, detailIds: [], manual: true, knownBy: body.knownBy ?? [], knownByEveryone: body.knownByEveryone ?? false }) : null;
    if (!body.kind || !body.id) return context.json({ error: "kind and id are required" }, 400);
    for (const key of ["subject", "predicate", "holder", "promisor", "promisee", "value", "content"] as const) {
      if (body[key] !== undefined && !body[key]?.trim()) return context.json({ error: `${key} must not be empty` }, 400);
    }
    if (body.confidence !== undefined && (!Number.isFinite(body.confidence) || body.confidence < 0 || body.confidence > 1)) {
      return context.json({ error: "confidence must be between 0 and 1" }, 400);
    }
    if (body.polarity !== undefined && !["believes", "suspects", "denies", "knows", "heard"].includes(body.polarity)) return context.json({ error: "unsupported polarity" }, 400);
    if (body.status !== undefined && !["open", "kept", "broken", "released", "offscreen", "invalidated"].includes(body.status)) return context.json({ error: "unsupported promise status" }, 400);
    const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
    if (!chat) return context.json({ error: "Chat not found" }, 404);
    const currentAssertion = body.kind === "assertion"
      ? db.prepare("SELECT * FROM assertions WHERE id=? AND chat_id=?").get(body.id, chatId) as Record<string, unknown> | undefined : undefined;
    const oldRelation = parseSocialRelation(currentAssertion?.social_relation_json);
    const nextRelation = body.socialRelation === null ? undefined : parsedSocial?.success ? parsedSocial.data : oldRelation;
    let mergeIds: string[] = [];
    if (currentAssertion && nextRelation) {
      const subject = body.subject?.trim() ?? String(currentAssertion.subject);
      const unchangedIdentity = !!oldRelation && sameSocialRelationIdentity(String(currentAssertion.subject), oldRelation, subject, nextRelation);
      if (oldRelation?.direction === "directed" && nextRelation.direction === "mutual") {
        mergeIds = activeSocialRelations(db, chatId).filter(row => row.id !== body.id && row.relation.direction === "directed"
          && isReverseMutualSocialRelation(row, subject, nextRelation)).map(row => row.id);
      }
      const relationConflict = unchangedIdentity ? undefined : findSocialRelationConflict(db, chatId, subject, nextRelation, [body.id, ...mergeIds]);
      if (relationConflict) return context.json(ledgerConflictResponse(relationConflict), 409);
      const predicate = body.predicate?.trim() ?? String(currentAssertion.predicate);
      const unchangedPredicate = predicate.toLocaleLowerCase() === String(currentAssertion.predicate).toLocaleLowerCase();
      const duplicate = socialRelationPredicateCollisions(db, chatId, subject, predicate, nextRelation)
        .find(row => row.id !== body.id && !mergeIds.includes(row.id) && (!row.relation || !unchangedIdentity || !unchangedPredicate));
      if (duplicate) return context.json(ledgerConflictResponse({ code: "DUPLICATE_LEDGER_ITEM", existingId: duplicate.id }), 409);
    }
    const revision = chat.revision + 1;
    let changed = 0;
    let updatedItem: Record<string, unknown> | undefined;
    db.transaction(() => {
      if (body.kind === "assertion") {
        const current = currentAssertion;
        if (!current) return;
        const priorHolders = resolveAssertionHolders(db, chatId, current);
        db.prepare("UPDATE assertions SET automatic_closure_evidence_json=NULL,valid_to_revision=? WHERE id=?").run(revision - 1, body.id);
        for (const id of mergeIds) db.prepare("UPDATE assertions SET automatic_closure_evidence_json=NULL,valid_to_revision=? WHERE id=?").run(revision - 1, id);
        const nextId = randomUUID();
        const nextStateKind = nextRelation ? "condition" : body.stateKind ?? current.state_kind ?? "condition";
        db.prepare(`
          INSERT INTO assertions(id,chat_id,subject,predicate,value,state_kind,confidence,valid_from_revision,source_memory_id,evidence_json,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)
        `).run(nextId, chatId, body.subject?.trim() ?? current.subject, body.predicate?.trim() ?? current.predicate, body.value?.trim() ?? current.value,
          nextStateKind,
          Math.max(0, Math.min(1, Number(body.confidence ?? current.confidence))), revision, null, "[]", Date.now());
        if (nextStateKind === "goal" || nextStateKind === "secret") replaceItemAccess(db, chatId, "assertion", nextId,
          (body.knownBy ?? priorHolders).map((holder) => ({ holder: holder.trim(), basis: "internal", evidence: [], confidence: 1 })), revision, Date.now());
        const relationJson = body.socialRelation === null || !nextRelation ? null : JSON.stringify({ ...nextRelation, manual: true,
          knownBy: body.knownBy ?? (oldRelation ? (socialRelationKnowledge(db, chatId, oldRelation) ?? []).filter(name => name !== EVERYONE_HOLDER) : []), knownByEveryone: body.knownByEveryone ?? (oldRelation ? (socialRelationKnowledge(db, chatId, oldRelation) ?? []).includes(EVERYONE_HOLDER) : false), detailIds: [] });
        db.prepare("UPDATE assertions SET social_relation_json=? WHERE id=?").run(relationJson, nextId);
        db.prepare("UPDATE assertions SET user_edit_ordinal=?,auto_locked=?,valid_from_ordinal=? WHERE id=?")
          .run(committedEditOrdinal(db,chatId),Number(body.locked ?? current.auto_locked ?? false),committedEditOrdinal(db,chatId),nextId);
        changed = 1;
        updatedItem = db.prepare("SELECT * FROM assertions WHERE id=?").get(nextId) as Record<string, unknown>;
        updatedItem.stateKind = updatedItem.state_kind;
        if (nextStateKind === "goal" || nextStateKind === "secret") Object.assign(updatedItem, publicKnowledgeScope(resolveAssertionHolders(db, chatId, updatedItem)));
      } else if (body.kind === "belief") {
        rememberLedgerEditOrigin(db, chatId, "belief", body.id!);
        changed = db.prepare(`UPDATE beliefs SET automatic_closure_evidence_json=NULL,holder=COALESCE(?,holder),subject=COALESCE(?,subject),predicate=COALESCE(?,predicate),value=COALESCE(?,value),confidence=COALESCE(?,confidence),polarity=COALESCE(?,polarity),status='active',active=1,superseded_by=NULL,valid_to_ordinal=NULL WHERE id=? AND chat_id=?`).run(
          body.holder?.trim() ?? null, body.subject?.trim() ?? null, body.predicate?.trim() ?? null, body.value?.trim() ?? null,
          body.confidence === undefined ? null : body.confidence, body.polarity ?? null, body.id, chatId,
        ).changes;
        if (changed) updatedItem = db.prepare("SELECT * FROM beliefs WHERE id=? AND chat_id=?").get(body.id, chatId) as Record<string, unknown>;
      } else if (body.kind === "promise") {
        rememberLedgerEditOrigin(db, chatId, "promise", body.id!);
        changed = db.prepare(`UPDATE promises SET promisor=COALESCE(?,promisor),promisee=COALESCE(?,promisee),content=COALESCE(?,content),status=COALESCE(?,status),scheduled_for=COALESCE(?,scheduled_for),status_reason=COALESCE(?,status_reason),updated_revision=? WHERE id=? AND chat_id=?`).run(
          body.promisor?.trim() ?? null, body.promisee?.trim() ?? null, body.content?.trim() ?? null, body.status ?? null, body.scheduledFor?.trim() ?? null, body.statusReason?.trim() ?? null, revision, body.id, chatId,
        ).changes;
        if (changed) {
          updatedItem = db.prepare("SELECT * FROM promises WHERE id=? AND chat_id=?").get(body.id, chatId) as Record<string, unknown>;
          const sourceOrdinal = committedEditOrdinal(db,chatId);
          db.prepare(`INSERT INTO promise_events(id,chat_id,promise_id,promise_key,promisor,promisee,content,status,scheduled_for,status_reason,source_memory_id,source_ordinal,created_revision,created_at,user_authored)
            VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,1)`).run(
            randomUUID(), chatId, body.id, updatedItem.promise_key, updatedItem.promisor, updatedItem.promisee,
            updatedItem.content, updatedItem.status, updatedItem.scheduled_for, updatedItem.status_reason, sourceOrdinal, revision, Date.now(),
          );
        }
      }
      if (changed && updatedItem) {
        const table=body.kind==='assertion'?'assertions':body.kind==='belief'?'beliefs':'promises';
        db.prepare(`UPDATE ${table} SET user_edit_ordinal=?,auto_locked=? WHERE id=? AND chat_id=?`)
          .run(committedEditOrdinal(db,chatId),Number(body.locked ?? updatedItem.auto_locked ?? false),updatedItem.id,chatId);
        Object.assign(updatedItem,{user_edit_ordinal:committedEditOrdinal(db,chatId),auto_locked:Number(body.locked ?? updatedItem.auto_locked ?? false)});
        Object.assign(updatedItem,correctionView(updatedItem));
      }
      if (changed) db.prepare("UPDATE chats SET revision=?,updated_at=? WHERE id=?").run(revision, Date.now(), chatId);
    })();
    return changed ? context.json({ ok: true, item: updatedItem }) : context.json({ error: "State item not found or unsupported kind" }, 404);
  });
  app.delete("/v1/chats/:id/world-state/:kind/:itemId", (context) => {
    const chatId = context.req.param("id");
    const kind = context.req.param("kind");
    const itemId = context.req.param("itemId");
    const mode = context.req.query("mode");
    if (mode !== undefined && mode !== "end" && mode !== "delete") return context.json({ error: "mode must be end or delete" }, 400);
    if (mode === "end" && kind === "promise") return context.json({ error: "Promises end through kept, broken, or released status" }, 400);
    if (!["assertion", "belief", "promise"].includes(kind)) return context.json({ error: "unsupported kind" }, 400);
    const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
    if (!chat) return context.json({ error: "Chat not found" }, 404);
    const revision = chat.revision + 1;
    let changed = 0;
    db.transaction(() => {
      const supports=new Set<string>();
      if (mode === "delete") {
        changed = deleteLedgerRecord(db, chatId, kind as "assertion" | "belief" | "promise", itemId,supports) ? 1 : 0;
      } else if (kind === "assertion") {
        const row = db.prepare("SELECT social_relation_json FROM assertions WHERE id=? AND chat_id=? AND valid_to_revision IS NULL").get(itemId, chatId) as { social_relation_json: string | null } | undefined;
        const relation = parseSocialRelation(row?.social_relation_json);
        const endOrdinal = (db.prepare("SELECT MAX(ordinal) ordinal FROM messages WHERE chat_id=?").get(chatId) as { ordinal: number | null }).ordinal;
        changed = db.prepare("UPDATE assertions SET automatic_closure_evidence_json=NULL,valid_to_revision=?,valid_to_ordinal=?,social_relation_json=COALESCE(?,social_relation_json) WHERE id=? AND chat_id=? AND valid_to_revision IS NULL").run(revision - 1, endOrdinal,
          relation ? JSON.stringify({ ...relation, manual: true, detailIds: [], ...publicKnowledgeScope(socialRelationKnowledge(db, chatId, relation) ?? []) }) : null, itemId, chatId).changes;
      }
      else if (kind === "belief") {
        const sourceOrdinal = committedEditOrdinal(db,chatId);
        changed = mode === "end"
          ? db.prepare("UPDATE beliefs SET automatic_closure_evidence_json=NULL,active=0,valid_to_ordinal=? WHERE id=? AND chat_id=? AND active=1").run(sourceOrdinal, itemId, chatId).changes
          : db.prepare(`UPDATE beliefs SET automatic_closure_evidence_json=NULL,active=0,valid_to_ordinal=COALESCE(valid_to_ordinal,?),
          source=CASE WHEN source LIKE 'user_deleted:%' THEN source ELSE 'user_deleted:' || COALESCE(source,'') END
          WHERE id=? AND chat_id=? AND active=1`).run(sourceOrdinal, itemId, chatId).changes;
      }
      else changed = db.prepare("DELETE FROM promises WHERE id=? AND chat_id=?").run(itemId, chatId).changes;
      if (changed && (mode==='delete' || (mode!=='end' && kind!=='assertion'))) {
        if (mode!=='delete') supports.add(`${kind==='belief'?'beliefs':'promises'}:${itemId}`);
        invalidateStorySupports(db,chatId,supports);
      }
      if (changed) db.prepare("UPDATE chats SET revision=?,updated_at=? WHERE id=?").run(revision, Date.now(), chatId);
    })();
    if (changed && mode === "delete") embeddings.stateIndex.prune(chatId);
    return changed ? context.json({ ok: true }) : context.json({ error: "State item not found" }, 404);
  });
  function readDashboardConflicts(chatId: string) {
    return { items: db.prepare("SELECT * FROM conflicts WHERE chat_id=? AND kind<>'static_projection_changed' ORDER BY created_at DESC").all(chatId) };
  }
  app.get("/v1/chats/:id/conflicts", (context) => context.json(readDashboardConflicts(context.req.param("id"))));
  function readDashboardJobs(chatId: string) {
    const ingestion = ingestionSummary(db, chatId);
    return {
      items: db.prepare(`
        SELECT id,type,status,attempts,leased_until,last_error,payload_json,created_at,updated_at FROM jobs
        WHERE chat_id=? AND status<>'archived' ORDER BY created_at DESC,rowid DESC LIMIT 200
      `).all(chatId).map((job: any) => ({ ...job, payload_json: JSON.stringify(projectJobListPayload(JSON.parse(job.payload_json))) })),
      cancelledMessages: (db.prepare("SELECT count(*) AS count FROM messages WHERE chat_id=? AND memory_excluded=0 AND extraction_state='cancelled'").get(chatId) as { count: number }).count,
      ...ingestion,
    };
  }
  app.get("/v1/chats/:id/jobs", (context) => context.json(readDashboardJobs(context.req.param("id"))));
  app.post("/v1/chats/:id/jobs/retry-failed", (context) => {
    const chatId = context.req.param("id");
    const retriedRunIds = (db.prepare(`SELECT DISTINCT json_extract(payload_json,'$.backfillRunId') runId FROM jobs
      WHERE chat_id=? AND status='failed' AND json_extract(payload_json,'$.backfillRunId') IS NOT NULL`).all(chatId) as Array<{ runId: string }>).map((row) => row.runId);
    const result = db.transaction(() => {
      const failed = db.prepare("SELECT id,payload_json FROM jobs WHERE chat_id=? AND status='failed'").all(chatId) as Array<{ id: string; payload_json: string }>;
      const update = db.prepare(`UPDATE jobs SET status='queued',attempts=0,payload_json=?,lease_owner=NULL,leased_until=NULL,last_error=NULL,updated_at=? WHERE id=? AND status='failed'`);
      let changes = 0;
      for (const job of failed) {
          const payload = manualRetryPayload(JSON.parse(job.payload_json || "{}"));
        changes += update.run(JSON.stringify(payload), Date.now(), job.id).changes;
      }
      return { changes };
    })();
    if (db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND type='initial_calibration' AND status='queued'").get(chatId)) {
      db.prepare("UPDATE initial_calibrations SET status='queued',last_error=NULL,updated_at=? WHERE chat_id=?").run(Date.now(), chatId);
    }
    for (const runId of retriedRunIds) db.prepare("DELETE FROM server_meta WHERE key=?").run(`backfill_ack:${chatId}:${runId}`);
    if (result.changes > 0) serverWorker.wake();
    return context.json({ ok: true, retried: result.changes });
  });
  app.post("/v1/chats/:id/jobs/:jobId/resplit", (context) => {
    try {
      const result = resplitFailedExtractionJob(db, context.req.param("id"), context.req.param("jobId"));
      if (result.queued > 0) serverWorker.wake();
      return context.json({ ok: true, ...result });
    } catch (error) {
      const code = (error as { code?: string }).code;
      return context.json({ error: error instanceof Error ? error.message : String(error), ...(code ? { code } : {}) }, code === "ATOMIC_TURN_TOO_LARGE" ? 409 : 400);
    }
  });
  app.delete("/v1/chats/:id/jobs/completed", (context) => {
    const result = db.prepare(`
      UPDATE jobs SET status='archived',lease_owner=NULL,leased_until=NULL,updated_at=?
      WHERE chat_id=? AND status IN ('done','completed','cancelled','superseded')
    `).run(Date.now(), context.req.param("id"));
    return context.json({ ok: true, archivedJobs: result.changes });
  });
  app.delete("/v1/chats/:id/jobs", (context) => context.json({ ok: true, ...cancelExtractionJobs(db, context.req.param("id")) }));
  app.post("/v1/chats/:id/jobs/requeue-cancelled", (context) => context.json({
    ok: true, restoredMessages: requeueCancelledMessages(db, context.req.param("id")),
  }));
  app.get("/v1/chats/:id/recall-logs", (context) => context.json({ items: db.prepare(`
    SELECT id,query,perspective,selected_json,elapsed_ms,created_at FROM recall_logs
    WHERE chat_id=? ORDER BY created_at DESC LIMIT 200
  `).all(context.req.param("id")) }));
  app.post("/v1/chats/:id/source-sync", async (context) => {
    const body = TurnPrepareRequestSchema.parse(await context.req.json());
    if (body.chatId !== context.req.param("id")) return context.json({ error: "chatId does not match route" }, 400);
    const stats = syncSnapshot(db, { ...body, deferExtraction: true, tokenBudget: 0, forceBackfill: false });
    return context.json({ ok: true, stats });
  });
  app.patch("/v1/chats/:id/conflicts/:conflictId", async (context) => {
    const body = await context.req.json() as { resolution?: ConflictResolution; targetAssertionId?: unknown };
    if (!body.resolution || !["accept_incoming", "keep_existing", "acknowledged"].includes(body.resolution)) {
      return context.json({ error: "unsupported conflict resolution" }, 400);
    }
    if (body.targetAssertionId !== undefined && (typeof body.targetAssertionId !== "string" || !body.targetAssertionId.trim())) {
      return context.json({ error: "targetAssertionId must be a non-empty string", code: "CONFLICT_TARGET_INVALID" }, 400);
    }
    const targetAssertionId = typeof body.targetAssertionId === "string" ? body.targetAssertionId.trim() : undefined;
    return context.json({ ok: true, ...resolveConflict(db, context.req.param("id"), context.req.param("conflictId"), body.resolution, targetAssertionId) });
  });
  app.delete("/v1/chats/:id/conflicts/:conflictId", (context) => {
    const result = db.prepare("DELETE FROM conflicts WHERE id=? AND chat_id=? AND status='resolved'").run(context.req.param("conflictId"), context.req.param("id"));
    return result.changes === 1 ? context.json({ ok: true }) : context.json({ error: "Resolved conflict not found" }, 404);
  });

  app.post("/v1/export", async (context) => {
    const body = await context.req.json() as { pluginSettings?: unknown; serverUrl?: string; serverToken?: string; chatId?:string; chatSettings?:any };
    const wasPaused = serverWorker.status.state === "paused";
    serverWorker.pause("Creating a consistent backup");
    try {
      const archive = body.chatId ? exportChatArchive(db,body.chatId,body.chatSettings) : exportCompleteArchive(db, {
        pluginSettings: body.pluginSettings,
        serverUrl: typeof body.serverUrl === "string" ? body.serverUrl : undefined,
        serverToken: config.token,
        serverSettings:backupServerSettings(config),
        secrets: existsSync(config.secretsPath) ? readFileSync(config.secretsPath, "utf8") : "",
        voyageApiKey: config.voyageApiKey || undefined,
        llmApiKeys: llmStore.backupApiKeys(),
      });
      context.header("Content-Type", "application/zip");
      context.header("Content-Disposition", `attachment; filename="rcm-${body.chatId ? "chat" : "complete"}-backup-${Date.now()}.zip"`);
      return context.body(archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer);
    } finally {
      if (!wasPaused) serverWorker.resume("backup-export");
    }
  });
  app.post("/v1/import/inspect", async (context) => {
    const inspection = inspectCompleteArchive(new Uint8Array(await context.req.arrayBuffer()));
    return context.json(inspection);
  });
  app.post("/v1/import/restore", async (context) => {
    if (serverWorker.status.activeCalls > 0) return context.json({error:"보조 모델 처리가 끝난 뒤 복원해주세요."},409);
    const wasPaused = serverWorker.status.state === "paused";
    serverWorker.pause("Restoring a complete backup");
    const previousArchive = exportCompleteArchive(db);
    const previousSecrets = existsSync(config.secretsPath) ? readFileSync(config.secretsPath, "utf8") : undefined;
    try {
      const archive = new Uint8Array(await context.req.arrayBuffer());
      const staged = openDatabase(":memory:").db;
      try {
        restoreCompleteArchive(staged, archive);
        const integrity = staged.pragma("integrity_check") as Array<{ integrity_check?: string }>;
        const foreignKeyErrors = staged.pragma("foreign_key_check") as unknown[];
        if (integrity.some((row) => row.integrity_check !== "ok") || foreignKeyErrors.length > 0) {
          throw new Error("Backup failed staged SQLite integrity validation");
        }
      } finally {
        staged.close();
      }
      const result = restoreCompleteArchive(db, archive);
      const liveIntegrity = db.pragma("integrity_check") as Array<{ integrity_check?: string }>;
      const liveForeignKeyErrors = db.pragma("foreign_key_check") as unknown[];
      if (liveIntegrity.some((row) => row.integrity_check !== "ok") || liveForeignKeyErrors.length > 0) {
        throw new Error("Restored SQLite database failed integrity validation");
      }
      if (typeof result.privateData.secrets === "string") writeFileSync(config.secretsPath, result.privateData.secrets, "utf8");
      if (typeof result.privateData.serverToken === "string") saveSecret(config.secretsPath,"RCM_TOKEN",config.token);
      for (const [name,value] of Object.entries(result.privateData.serverSettings??{})) {
        if (!Object.hasOwn(backupServerSettings(config),name) || typeof value!=="string" || /[\r\n]/u.test(value)) throw new Error("Invalid backed up server preference");
        saveSecret(config.secretsPath,name as `RCM_${string}`,value);
      }
      if (typeof result.privateData.voyageApiKey === "string") saveVoyageKey(config.secretsPath, result.privateData.voyageApiKey);
      for (const [provider, key] of Object.entries(result.privateData.llmApiKeys ?? {})) {
        if (typeof key === "string") saveSecret(config.secretsPath, `RCM_LLM_API_KEY_${provider.toUpperCase()}`, key);
      }
      return context.json({ ok: true, manifest: result.inspection.manifest, connection: result.inspection.privateData, pluginSettings: result.privateData.pluginSettings,
        vectorsRestored: result.vectorsRestored, restartRequired: true });
    } catch (error) {
      restoreCompleteArchive(db, previousArchive);
      if (previousSecrets !== undefined) writeFileSync(config.secretsPath, previousSecrets, "utf8");
      else if (existsSync(config.secretsPath)) unlinkSync(config.secretsPath);
      if (!wasPaused) serverWorker.resume("backup-restore-rollback");
      throw error;
    }
  });
  app.post("/v1/import/chat",async(context)=>{
    if (serverWorker.status.activeCalls > 0) return context.json({error:"보조 모델 처리가 끝난 뒤 복원해주세요."},409);
    const wasPaused=serverWorker.status.state==="paused";
    serverWorker.pause("Restoring one chat backup");
    try {
      const result=restoreChatArchive(db,new Uint8Array(await context.req.arrayBuffer()));
      return context.json({ok:true,...result,serverInstanceId:serverInstanceId});
    } finally {if(!wasPaused)serverWorker.resume("chat-backup-restore");}
  });
  app.post("/v1/import/transplant", async (context) => {
    if (serverWorker.status.activeCalls > 0) return context.json({error:"보조 모델 처리가 끝난 뒤 복원해주세요."},409);
    const sourceChatId = context.req.query("sourceChatId") ?? "";
    const targetChatId = context.req.query("targetChatId") ?? "";
    if (!sourceChatId || !targetChatId) return context.json({ error: "sourceChatId and targetChatId are required" }, 400);
    const wasPaused = serverWorker.status.state === "paused";
    serverWorker.pause("Transplanting memory into the current chat");
    try {
      const result = transplantCompleteArchive(db, new Uint8Array(await context.req.arrayBuffer()), sourceChatId, targetChatId);
      void embeddings.indexPending(targetChatId);
      return context.json({ ok: true, chatId: targetChatId, ...result });
    } finally {
      if (!wasPaused) serverWorker.resume("backup-transplant");
    }
  });

  app.onError((error, context) => {
    const code = typeof (error as any)?.code === "string" ? (error as any).code : "REQUEST_FAILED";
    const summary = error instanceof ExtractionValidationError
      ? error.summary
      : error instanceof BackupValidationError ? `백업 검증 실패: ${error.message}`
        : code === "LEASE_NOT_FOUND" ? "처리 작업의 임대가 만료되었습니다."
          : "요청을 처리하지 못했습니다.";
    console.error(`[RCM] Request failed code=${code} path=${context.req.path}`);
    const status = code === "LEASE_NOT_FOUND" ? 409 : error instanceof ViewPreferencesStorageError ? 500 : 400;
    return context.json({
      error: error instanceof Error ? error.message : String(error), code, summary,
      ...(error instanceof ExtractionValidationError ? { issues: error.issues } : {}),
    }, status);
  });
  return app;
}
