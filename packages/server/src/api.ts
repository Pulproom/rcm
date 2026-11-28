import { previewCanonicalTranslation, startCanonicalTranslation, completeCanonicalTranslationJob } from './canonical-translation.js';
import { jobListMetadata } from './job-list-metadata.js';
import { isPersonEntityType } from "@rcm/shared";
import { auxiliaryUsageMetadata } from '@rcm/shared';
import { recordTranslationCall } from './processing-records.js';
import { readProcessingHistory, readProcessingToday, readProcessingUnit, readProcessingCalls, readTranslationCalls } from './processing-history.js';
import { automaticPacketBudget, packetFloorUsage } from "./packet-budget.js";
import { memoryEpoch, renewMemoryEpoch } from './derived-state.js';
import { assertUserChat, userChatSql } from './chat-work.js';
import { incidentsSince } from './incidents.js';
import { assertChatUnlocked, assertUpgradeJobWritable, upgradeLockSql, chatUpgradeLock, withChatWrite, withJobWrite } from './upgrade-lock.js';
import { configureUpgradePhase2, activeUpgradeRun, previewUpgrade, startUpgrade, cancelUpgrade, resumeUpgrade, retryUpgradePhase2 } from './upgrade-run.js';
import { legacyMemorySummary } from './legacy-memory.js';
import { AuxiliaryShapeDiagnosticSchema } from "@rcm/shared";
import { recordJobShapeNormalizations } from "./jobs.js";
import { projectMemoryScene, extractionDraftSchema } from "@rcm/shared";
import { chatPacketPricing, chargedCardTokens, chargedPacketTokens, chargedSectionTokens } from "./charged-cost.js";
import { availableMemoryKey, scopeMemoryKey } from './extraction-memory-keys.js';
import { emitsMemoryPlot, narrationLine } from "@rcm/shared";
import { buildEmissionPlan, factReasonsFor, omitStateLinkedDetails, buildManifest, emittedMemoryItems, emittedMemoryRecords, memoryCardHasContent, prependAlwaysCards, traceEmissionPlan, type EmissionPlan } from "./emission-plan.js";
import { markChatEngaged, recordOpenChat, deleteUnengagedChats, recentChatCleanup } from "./chat-engagement.js";
import { sourceSnapshotStatus, withSourceSnapshot, assertSourceSnapshotAccepted } from './source-snapshot.js';
import { SETTINGS_FAILURE_GUIDANCE, settingsFailureCode, settingsFailureMessage } from "@rcm/shared";
import { initialMemoryGuidanceBlock, memoryGuidanceBlock, sharedPastPacket, withMemoryGuidance, clipLandmarkDisplayText } from "@rcm/shared";
import { editPairProgress, listPairProgress, pairProgressResponse, renderPairProgress } from "./pair-progress.js";
import { prepareOccasions, renderOccasions } from "./occasions.js";
import { countPendingSmallReviews, readSmallReviews, visibleSmallReviews, resolveSmallReviews } from "./small-review.js";
import { patchMemoryLine } from './memory-detail-edits.js';
import { CharacterWorkRequestSchema } from "@rcm/shared";
import { beginChatWork, isChatWorkHeld, setChatWorkEnabled, CHAT_WORK_HELD } from "./chat-work.js";
import { EntityColorSchema, hasSocialTermSeparator } from "@rcm/shared";
import { recordPromiseRecency, snapshotPromiseRecency, promiseFirstMade } from "./promise-recency.js";
import { ExtractionAuditSubmissionSchema } from "@rcm/shared";
import { withAuxiliaryStoryFraming } from "@rcm/shared";
import { isProviderAuthenticationError, projectRisuAuxiliaryCallDiagnostic, RISU_AUXILIARY_FAILURE_CODES } from "@rcm/shared";
import { StateOutcomeCapture } from "./state-outcomes.js";
import { automaticStateSources, automaticStateCandidates, renderAutomaticState, selectAutomaticState, trimAutomaticStateNote, sharedStateBudget } from "./automatic-state.js";
import { planTranslation, splitTranslationBatch, translationParts, translationItemCost, translationReferenceCost, TranslationRequestSchema, TranslationBatchSchema, TRANSLATION_DEFAULT_OUTPUT, untranslatedParts, type TranslationBatch, translationSystemPrompt, validateTranslation, translationTimeoutMs, TranslationError, sanitizeDiagnosticText } from "@rcm/shared";
import { requestStructuredProvider } from "./server-llm.js";
import { connectionFailureReason, type ConnectionFailureCode } from "@rcm/shared";
import { readStorySeed, storySeedCounts, editStorySeed, editStorySeeds, dashboardStorySeeds, recordSeedDelivery } from "./story-seeds.js";
import { z } from "zod";
import { deleteLedgerRecord, rememberLedgerEditOrigin, rememberMemoryDeletion, deletedMemoryKeys, processedSourceWatermark } from "./user-deletions.js";
import { QuizAnswerRequestSchema, UserCorrectionEditSchema, PromiseEditOptionsSchema, type PromiseEditOptions } from "@rcm/shared";
import { committedEditOrdinal, correctionView } from "./user-corrections.js";
import { answerQuiz, completeQuizJob, disableAllQuizzes, nextQuiz, quizStatus, regenerateQuizzes, resetQuizStats, setQuizEnabled } from "./quiz.js";
import { TranslationLegacySettingsSchema } from "@rcm/shared";
import { TranslationConnection } from "./translation-connection.js";
import { McpSelector } from "./mcp-selector.js";
import { INVALID_MEMORY_REF_MESSAGE, mcpRequestTimeoutMs, storedStoryTimeEnd } from "@rcm/shared";
import { resolveAssertionHolders } from "./state-evidence.js";
import { stateEvidenceReader } from "./state-search-index.js";
import { SocialRelationSchema } from "@rcm/shared";
import { activeSocialRelations, findSocialRelationConflict, isReverseMutualSocialRelation, parseSocialRelation, sameSocialRelationIdentity, socialRelationKnowledge, socialRelationPredicateCollisions } from "./social-relations.js";
import { timeout } from "hono/timeout";
import { MemoryReferences } from "./memory-references.js";
import { finalizeMcpAnswer, mcpRecognitionIds, renderAuthorMcpAnswer } from "./mcp-answer.js";
import { AUTHOR_ACTIVATION_KEY, longtermFloorActive, automaticDeliveryHistory, recordAutomaticDelivery, persistAutomaticActivationObservations, deliveredActivationObservation, type AutomaticActivationObservation } from "./recall-activation.js";
import { projectJobListPayload, stageJobModelOutput, manualRetryPayload } from "./jobs.js";
import { inspectDraftEvidence, rescueDraftDialogues, describeEvidenceReview, countBlockingExtractionAudits, describeWithheldRecognitions, evidenceReviewIsBlocking } from "./evidence-review.js";
import { emptyPacketManifest, mergePacketManifests, type PacketManifest } from "./packet-manifest.js";
import { queueSourceRecovery, retrieveSourceEvidence, renderSourceEvidence, sourceEvidenceAtomKey } from "./source-evidence.js";
import { fitAutomaticCard, automaticAtoms, planAutomaticAtoms, selectCueAnchor, selectAutomaticPortfolio, AUTOMATIC_ROLE_SHARES, type AutomaticPortfolioCandidate, type AutomaticAtomPriority } from "./automatic-packet.js";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createAlbumPhotoStore } from "./album-photos.js";
import { createAlbumExportStore, registerAlbumExportReadRoute } from "./album-exports.js";
import { registerAlbumRoutes } from "./album-api.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { methodOverride } from "hono/method-override";
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
  StoredLandmarkKindSchema,
  PickerSetupProjectionSchema,
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
import { deleteChats, listAdminChats, reprocessChat, resetDerivedChat, saveSecret, saveVoyageKey } from "./admin.js";
import { recanonicalizeSourceLedger } from "./lifecycle.js";
import { EmbeddingRequestError, type EmbeddingService } from "./embedding.js";
import { attachAuxiliaryPlan, cancelExtractionJobs, enqueueExtractionJobs, enqueueInitialCalibration, enqueueSocialKnowledgeBackfill, failedExtractionSources, failJob, leaseJob, previewSocialKnowledgeBackfill, renewJobLease, requeueCancelledMessages, resplitFailedExtractionJob, recordJobStateRecovery, setJobPipelineStage, type JobPipelineStage } from "./jobs.js";
import { completeExtractionJob, ExtractionValidationError, type DialogueRecoveryCandidate } from "./extraction-completion.js";
import { completeEpisodeJob } from "./episode-completion.js";
import { hardDeleteMessage, hasDerivedState, purgeExpiredContent, syncSnapshot, syncChatTitle } from "./lifecycle.js";
import { nowAlwaysInjectCount, deliverablePromiseSql, inheritNowDelivery } from './now-delivery.js';
import { alwaysInjectEstimate, prepareAlwaysInject, prependAlwaysInject, automaticHardMemoryLimit, automaticHardTokenCeiling, automaticMemoryLimit, consolidateMemoryPacket, renderAlwaysInjectPlan, processedHistoryCoverage, lexicalCandidates, retrieve, mcpRetrievalAudience, type RetrievalCandidateClass, type RetrievalDiagnostics, type RetrievalSelectionRole } from "./retrieval.js";
import { ServerLlmStore, ProviderRequestError } from "./server-llm.js";
declare const __RCM_DISTRIBUTION__: boolean | undefined;
import { ServerExtractionWorker } from "./server-worker.js";
import { detachRetryStorySupports, chatPacketBudgetKey, compileStorySpine, createStorySpineCompiler, completeStoryConsolidationById, expandArcForMemory, expandArcHits, invalidateStorySpine, invalidateStorySupports, storyMemoryCascadeSupportIds, storyMemorySupportIds, listStorySpine, maybeEnqueueStorySpine, storyBudgetLimit, storyOverviewRenderBudgetLimit, updateStorySpineGroup } from "./story-spine.js";
import { buildEntityIdentityResolver, deleteEntity, listEntities, modelEntityContext, mergeEntities, previewEntityDelete, previewEntityMerge, refreshMemoryParticipantCounts } from "./entities.js";
import { EVERYONE_HOLDER, NARRATOR_ARCHIVE_HOLDER, PENDING_ACCESS_HOLDER, linkedDetailKnowledge, promiseLinkedSupport, snapshotKnowledgeGrants, correctedPromiseDetailIds, publicKnowledgeScope, publicMemoryContext, publicMcpAnswers, memoryDetailAccess, readDetailAccessEdits, writeDetailAccessEdits, pruneDetailAccessEdits, syncDetailKnownBy, projectPromiseRow, promiseContributionState } from "./item-access.js";
import { normalizeUnitScore } from "./scores.js";
import { listReconciliationReviews, prepareReconciliation, resolveReconciliationReview } from "./reconciliation.js";
import { recordProgressSent, prepareStateExtraction, usesStateExtraction } from "./state-extraction.js";
import { memoryAdditionStopsAfterEvents } from "@rcm/shared";
import { applyExtractionAuditPatch } from "./extraction-audit.js";
import { changeEpisodeStart, closeEpisodeHold, episodeOverview, previewEpisodeStart, retryEpisode, releaseManualEpisode, startEpisodeHold, syncEpisodeMembership } from "./episodes.js";
import { resolveSceneCharacters, resolveNarrationViewpoint, narrationViewpointKey, storedNarrationViewpoint } from "./perspectives.js";
import { hasBufferedSource, ingestionSummary } from "./ingestion-state.js";
import { listDashboardConflicts, resolveConflict, type ConflictResolution } from "./conflicts.js";
import { readMemoryBookmarks, rememberMemoryPreferenceFields, setMemoryBookmark } from "./memory-bookmarks.js";
import { InvalidViewPreferencesPatchError, readViewPreferences, ViewPreferencesStorageError, writePersonaHint, writeViewPreferences } from "./view-preferences.js";
import { acknowledgeChatLineage, applyManualLineage, applyProbedLineage, chooseChatLineage, declineChatLineage, ensureChatLineage, hasPendingLineageDiscovery, getChatLineage, previewManualLineage, probeChatLineage, revertChatLineage } from "./lineage.js";
import { appendSceneNames, mentionedCharacters, renderSceneNames, listSocialKnowledge, retractSocialKnowledge, setManualSocialKnowledge } from "./social-knowledge.js";
import { fingerprintMatches, parseSourceFingerprintJson } from "./source-fingerprint.js";
import { completeRelationshipProjectionJob, flushRelationshipProjectionQueue, listRelationshipProjections, setRelationshipProjectionOverride } from "./relationship-projections.js";
import { intimacyMilestoneKeys } from "./intimacy-milestones.js";
import { replaceItemAccess } from "./ingest.js";
import { buildRetrievalQuerySignals, sourceQuerySignals } from "./retrieval-planner.js";
import { cachedAuxiliaryPage, cachedAuxiliaryStateRecovery, storeValidatedAuxiliaryPage, resetRejectedJobCache } from "./auxiliary-page-cache.js";
import { assertSetupLineageResolved, beginInitialCalibration, prepareInitialCalibrationRetry, completeInitialCalibrationJob, deleteInitialEntity, initialCalibrationLedger, initialCalibrationRetryInput, initialCalibrationView, resolveInitialCalibrationConfirmation, updateInitialRelationship, upsertInitialEntity } from "./initial-calibration.js";
import { previewRegeneration, applyCanonicalRegeneration, applyEpisodeRegeneration, discardRegeneration, listExtractionBatches, listRegenerations, regenerationRun, startCanonicalRegeneration, startEpisodeRegeneration } from "./regeneration.js";
import { listSourceRanges, rangeMessages, setMemoryExclusion } from "./source-ranges.js";
import { additionSources, additionMessageReason, previewMemoryAddition, startMemoryAddition, listMemoryAdditions, applyMemoryAddition, discardMemoryAddition, startGapRecovery, listGapRecovery } from './memory-addition.js';
import { estimateFailedJobCalls } from './cost-estimates.js';
import { estimateStoryRebuild } from './story-spine.js';
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
    ? "같은 이름의 역방향 관계가 이미 있어요." : "같은 활성 장부 항목이 이미 있어요.", ...conflict };
}

function lastMatchingIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index]!)) return index;
  return -1;
}

function injectionManifest(packet: string, manifest: PacketManifest, perspectives: string[], storySpineNodeIds: string[] = []) {
  return { source: packet ? "fresh" as const : "empty" as const, ...mergePacketManifests([manifest]), perspectives, storySpineNodeIds };
}

export function buildMemoryToolOpportunity(
  candidates: MemoryContextItem[],
  injected: MemoryContextItem[],
  manifest: Omit<ReturnType<typeof injectionManifest>,'alwaysInjectMemoryIds'> & {alwaysInjectMemoryIds?:string[]},
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
  const connectionChanges = db.prepare('SELECT total_changes()').pluck();
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
  app.use("*", cors({ origin: "*", allowHeaders: ["Content-Type", "Authorization", "X-RCM-Plugin-Version", "X-RCM-API-Revision", "X-HTTP-Method-Override", "X-RCM-Photo-Meta", "Range"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], exposeHeaders: ["Retry-After", "Content-Range"] }));
  const overrideMethod = methodOverride({ app, header: "X-HTTP-Method-Override" });
  app.use("*", async (context, next) => {
    const override = context.req.header("X-HTTP-Method-Override");
    if (context.req.method !== "POST" || override === undefined) return next();
    if (!["PATCH", "PUT", "DELETE"].includes(override)) {
      return context.json({ error: "Method override must be PATCH, PUT or DELETE", code: "INVALID_METHOD_OVERRIDE" }, 400);
    }
    // Hono must dispatch again with the effective method before route matching.
    return overrideMethod(context, next);
  });
  // Risu checks the banner without bearer credentials before downloading an update.
  app.get("/plugin/risu-cognitive-memory.js", async (context) => {
    context.header("Cache-Control", "no-store");
    const path = process.env.RCM_DEV_PLUGIN_PATH;
    if (!path) return context.json({ error: "Dev plugin is not available" }, 404);
    let file: Uint8Array<ArrayBuffer>;
    try {
      file = new Uint8Array(await readFile(path));
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        return context.json({ error: "Dev plugin is not available" }, 404);
      }
      throw error;
    }
    context.header("Content-Type", "text/javascript; charset=utf-8");
    context.header("Accept-Ranges", "bytes");
    const range = /^bytes=(\d+)-(\d*)$/.exec(context.req.header("Range") ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : file.length - 1;
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start < file.length && end >= start) {
        const last = Math.min(end, file.length - 1);
        context.header("Content-Range", `bytes ${start}-${last}/${file.length}`);
        return context.body(file.subarray(start, last + 1), 206);
      }
    }
    return context.body(file, 200);
  });
  app.get("/v1/health", (context) => {
    const health = {
      ok: true, version: RCM_SERVER_VERSION, apiRevision: RCM_API_REVISION, instanceId: serverInstanceId,
      vectorEnabled, embeddingReady: embeddings.ready, embedding: embeddings.status, reranker: reranker.status, serverTranslationCache: true, completeMemoryBackup: true,
      serverLlm: llmStore.publicConfig, translationConnection:translationConnection.publicConfig, mcpSelector:mcpSelector.publicConfig, serverWorker: serverWorker.status, capabilities: { stateReconciliationV2: true, stateReconciliationV3: true, pipelineProgressV2: true, providerJsonMode: true, pipelineRetryStatus: true, landmarkAuditPatches: true, manualTimelineMemory: true, storyOverviewEditing: true, turnMemoryToolOpportunity: true, relationshipLandmarks: true, physicalIntimacyAutoInject: true, recallPortfolioV2: true, mcpAtomDelta: true, memoryToolReadiness: true, initialCalibration: true, initialRelationshipProjection: true, relationshipProjectionCursor: true, offscreenPromises: true, extractionAudit: true, atomAccess: true, beliefLifecycle: true, reconciliationReview: true, messageVisibility: true, sourceRangeOrganization: true, stagedMemoryGrouping: true, perspectiveResolution: true, ingestionState: true, relationshipScaleV2: true, qualitativeRelationships: true, memoryDetails: true, memoryLineEditing: true, intimacyMilestones: true, npcProminence: true, adaptiveExtraction: true, multilingualCanonicalMemory: true, canonicalTranslation: true, extractionGrouping: true, promptCoverageSuppression: true, durableLedger: true, chatLineage: true, manualLineageTransfer: true, dashboardLineageProbe: true, readOnlyLineageProbe: true, recallCoverage: true, socialKnowledge: true, lineageAcknowledgement: true, packetContractV2: true, physicalIntimacy: true, typedLandmarks: true, resolvedRelationshipBaseline: true, manualLedgerEditing: true, memoryToolControl: true, shortMemoryRefs: true, multiGenerationLineage: true, quoteReviewRemoved: true, injectionManifest: true, ledgerHistory: true, typedSexMilestones: true, deepRecall: true, aspectProvenance: true, creativeUnknownStates: true, retrievalPlannerV2: true, extractionBatches: true, episodeRegeneration: true, canonicalSuffixRegeneration: true, fullColdStartSync: true, storySpine: true, storySpineV2: true, memoryQuiz: true, quizManagement: true, memoryBudgetPresets: true, holderMemoryTraces: true, canonicalSourceNormalization: true, editProtection: true, cognitiveActivation: true, serverServiceTier: true, ...(retrievalTrace.dashboardAvailable ? { retrievalDiagnostics: true } : {}) },
    };
    Object.assign(health.capabilities, {
      methodOverride: true,
      memoryAlbum: true,
      chatOperationLifecycleV2: true,
      mcpEvidenceRerank: true,
      turnLineageDiscovery: true,
      ledgerConsistencyBarrier: true,
      canonicalLedgerIdentity: true,
      repairDiagnosticsV2: true,
      stateFieldRecovery: true,
      operationRunAccounting: true,
      persistentBackfillResult: true,
      mcpCompactEvidence: true,
      mcpSelector:true,
      managedServerRestart: true,
    });
    return context.json(health);
  });
  const albumExportStore = createAlbumExportStore(dirname(config.dbPath));
  registerAlbumExportReadRoute(app, albumExportStore);
  app.use("/v1/*", async (context, next) => {
    const token = context.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!equalToken(token, config.token)) return context.json({ error: "Unauthorized" }, 401);
    const revision = context.req.header("X-RCM-API-Revision");
    // Recovery uses a frozen, unversioned protocol. Also accept versioned update
    // writes from a newer plugin; an older plugin must still update itself first.
    const updateDiscovery = context.req.method === "GET" && context.req.path === "/v1/update/status";
    const updateRecovery = context.req.method === "POST" && ["/v1/update/stage", "/v1/update/apply"].includes(context.req.path)
      && Number.isInteger(Number(revision)) && Number(revision) > RCM_API_REVISION;
    if (!updateDiscovery && !updateRecovery && (revision !== undefined || context.req.header("X-RCM-Plugin-Version")) && revision !== String(RCM_API_REVISION)) {
      return context.json({ error: "RCM API revision mismatch; update the plugin and server together", code: "API_REVISION_MISMATCH", expectedApiRevision: RCM_API_REVISION }, 409);
    }
    await next();
  });
  const albumPhotoStore = createAlbumPhotoStore(join(dirname(config.dbPath), "albums"));
  registerAlbumRoutes(app, { db, photoStore: albumPhotoStore, exportStore: albumExportStore });
  configureUpgradePhase2(db,chatId => embeddings.finishUpgradeIndex(chatId),()=>serverWorker.wake(),()=>embeddings.ready);
  // Reject early here; synchronous mutation tails also use withChatWrite after
  // reading bodies. Middleware alone cannot protect an awaited request body.
  // Reads are exempt. Future upgrade controls own their phase rules;
  // chat work OFF is handled by Task 5's cancellation confirmation.
  const guardUpgradeWrite: import('hono').MiddlewareHandler = async (context,next) => {
    assertUserChat(db,context.req.param('id')!);
    if (!['GET','HEAD','OPTIONS'].includes(context.req.method)) {
      const body=await context.req.json().catch(()=>({}));
      for (const key of ['sourceChatId','targetChatId','parentChatId']) if (typeof body[key]==='string') assertUserChat(db,body[key]);
    }
    const readOnlyPost = context.req.method === 'POST' && /\/(?:lineage\/(?:probe|preview)|memory-transplant\/preview|memory-additions\/(?:sources|preview)|canonical-translation\/preview|memory-groups\/preview|extraction-batches\/[^/]+\/preview-regeneration|entities\/(?:[^/]+\/delete-preview|merge-preview))$/.test(context.req.path);
    const sourceWrite = context.req.method === 'POST' && (/\/(?:reprocess|gap-recovery|jobs\/(?:retry-failed|requeue-cancelled|[^/]+\/resplit)|episodes\/[^/]+\/(?:retry|release)|extraction-audits\/[^/]+\/retry|social-knowledge\/backfill|story-spine\/rebuild|embeddings\/retry-failed|initial-calibration\/(?:retry|confirm|skip)|memory-(?:additions|groups)\/(?:create|[^/]+\/(?:apply|retry))|extraction-batches\/[^/]+\/regenerate-(?:episode|canonical)|regenerations\/[^/]+\/apply(?:-with-keep)?)$/.test(context.req.path)
      || context.req.path.endsWith('/small-reviews/resolve') && (await context.req.json().catch(()=>null))?.action === 'retry');
    const projectionRetry = context.req.method === 'PATCH' && context.req.path.endsWith('/relationships')
      && (await context.req.json().catch(()=>null))?.clear === true;
    if (sourceWrite || projectionRetry) {
      assertSourceSnapshotAccepted(db,context.req.param('id')!);
    }
    if (!['GET','HEAD','OPTIONS'].includes(context.req.method)
      && !readOnlyPost
      && !/\/(?:upgrade(?:\/.*)?|work|source-sync)$/.test(context.req.path)) {
      assertChatUnlocked(db,context.req.param('id')!);
      // Parent/source protection must happen outside handlers' legacy error
      // catches, so lineage selection consistently returns the lock payload.
      if (/\/(?:lineage\/(?:select|apply|inherit)|memory-transplant)$/.test(context.req.path)) {
        const body = await context.req.json().catch(()=>({}));
        if (typeof body.parentChatId === 'string') assertChatUnlocked(db,body.parentChatId);
        if (typeof body.sourceChatId === 'string') assertChatUnlocked(db,body.sourceChatId);
      }
    }
    await next();
  };
  app.use('/v1/admin/chats/:id/*',async (context,next)=>{ assertUserChat(db,context.req.param('id')!); await next(); });
  app.use('/v1/chats/:id',guardUpgradeWrite);
  app.use('/v1/chats/:id/*',guardUpgradeWrite);
  app.use('/v1/jobs/:id/*',async (context,next) => {
    if (!['GET','HEAD','OPTIONS'].includes(context.req.method)) assertUpgradeJobWritable(db,context.req.param('id')!);
    await next();
  });
  const processingQuery = z.object({ offset:z.coerce.number().int().min(0).max(100_000).default(0),
    translationOffset:z.coerce.number().int().min(0).max(100_000).default(0),
    timezoneMinutes:z.coerce.number().int().min(-840).max(840).default(0) });
  app.get('/v1/chats/:id/processing', context => {
    const query=processingQuery.parse(context.req.query());
    return context.json(readProcessingHistory(db,{chatId:context.req.param('id'),...query}));
  });
  app.get('/v1/processing', context => context.json(readProcessingHistory(db,processingQuery.parse(context.req.query()))));
  app.get('/v1/processing/today', context => {
    const query=processingQuery.parse(context.req.query()),chatId=context.req.query('chatId');
    if(chatId) assertUserChat(db,chatId);
    return context.json(readProcessingToday(db,chatId,query.timezoneMinutes));
  });
  app.get('/v1/chats/:id/processing/runs/:runId',context=>{
    const query=processingQuery.parse(context.req.query());
    const unit=readProcessingUnit(db,context.req.param('id'),`run:${context.req.param('runId')}`,query.offset);
    return unit?context.json(unit):context.json({error:'Run not found'},404);
  });
  app.get('/v1/chats/:id/processing/jobs/:jobId',context=>{
    const unit=readProcessingUnit(db,context.req.param('id'),`job:${context.req.param('jobId')}`);
    return unit?context.json(unit):context.json({error:'Job not found'},404);
  });
  app.get('/v1/chats/:id/processing/jobs/:jobId/calls',context=>{
    const query=processingQuery.parse(context.req.query());
      if(!db.prepare('SELECT 1 FROM processing_jobs WHERE id=? AND chat_id=? UNION ALL SELECT 1 FROM jobs WHERE id=? AND chat_id=?').get(context.req.param('jobId'),context.req.param('id'),context.req.param('jobId'),context.req.param('id'))) return context.json({error:'Job not found'},404);
    return context.json(readProcessingCalls(db,context.req.param('jobId'),query.offset));
  });
  app.get('/v1/processing/translations/:day',context=>{
    const query=processingQuery.parse(context.req.query()),chatId=context.req.query('chatId'),day=context.req.param('day');
    if(chatId) assertUserChat(db,chatId);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) return context.json({error:'Invalid day'},400);
    return context.json(readTranslationCalls(db,chatId,day,query.timezoneMinutes,query.offset));
  });
  app.post('/v1/chats/:id/processing/translations',async context=>{
    if(!db.prepare('SELECT 1 FROM chats WHERE id=?').get(context.req.param('id'))) return context.json({code:'CHAT_NOT_FOUND',error:'Chat not found'},404);
    const record=z.object({id:z.string().uuid(),slot:z.enum(['model','static','memory','otherAx','translate','emotion','submodel']),
      model:z.string().max(200).optional(),provider:z.string().max(200).optional(),
      startedAt:z.number().int().min(Date.now()-86_400_000).max(Date.now()+60_000),durationMs:z.number().int().min(0).max(3_600_000),
      itemCount:z.number().int().min(1).max(500),completedItems:z.number().int().min(0).max(500).optional(),outcome:z.enum(['succeeded','failed']),
      usage:z.record(z.string(),z.number().nonnegative()).optional(),code:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional()}).strict().parse(await context.req.json());
    if((record.completedItems??0)>record.itemCount)return context.json({error:'Invalid completed item count'},400);
    recordTranslationCall(db,{...record,chatId:context.req.param('id'),site:'risu',failure:record.code?{code:record.code}:undefined});
    return context.json({ok:true});
  });
  app.get("/v1/chats/:id/dashboard-home", (context) => {
    const chatId = context.req.param("id");
    // Lazily share successful projections, keeping each dataset's failure boundary.
    let ingestion: ReturnType<typeof ingestionSummary> | undefined;
    let lineage: ReturnType<typeof getChatLineage> | undefined;
    let conflicts: ReturnType<typeof listDashboardConflicts> | undefined;
    let calibration: ReturnType<typeof initialCalibrationView> | undefined;
    const common = {
      ingestion: () => ingestion ??= ingestionSummary(db, chatId),
      lineage: () => lineage ??= getChatLineage(db, chatId),
      conflicts: () => conflicts ??= listDashboardConflicts(db, chatId),
      calibration: () => calibration ??= initialCalibrationView(db, chatId),
    };
    const readers = {
      memories: () => readDashboardMemories(chatId),
      relationships: () => readDashboardRelationships(chatId),
      entities: () => readDashboardEntities(chatId),
      viewPreferences: () => readViewPreferences(db, chatId),
      world: () => readDashboardWorld(chatId, { includeHistory: "true" }),
      conflicts: () => ({ items: common.conflicts() }),
      jobs: () => readDashboardJobs(chatId, common.ingestion()),
      lineage: common.lineage,
      status: () => readDashboardStatus(chatId, common),
      initialCalibration: () => initialCalibrationLedger(db, chatId, common.calibration()),
      storySpine: () => listStorySpine(db, chatId),
      socialKnowledge: () => readDashboardSocialKnowledge(chatId),
      gapRecovery: () => listGapRecovery(db,chatId),
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
    if (items.some((item: any) => isChatWorkHeld(db, item.chatId))) return context.json({ code: "CHAT_WORK_HELD", error: CHAT_WORK_HELD }, 409);
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
    assertUserChat(db,parsed.chatId);
    const upgradeLock = chatUpgradeLock(db,parsed.chatId);
    if (upgradeLock) return context.json({ blocked: true, reason: 'CHAT_UPGRADING', lock: upgradeLock });
    const effectiveBackfillApproved = parsed.backfillApproved === true && parsed.serverInstanceId === serverInstanceId;
    const { lineage, sync, lineageDeferred, ...sourceStatus } = withSourceSnapshot(db, parsed, (policy, allowDiscovery) => {
      const lineage = ensureChatLineage(db, parsed, allowDiscovery, policy.allowDestructive);
      const lineageDeferred = !allowDiscovery && hasPendingLineageDiscovery(db, parsed);
      if (lineageDeferred) policy.held = true;
      const pending = lineageDeferred || ["ambiguous", "choice_required"].includes(lineage.status);
      return { lineage, lineageDeferred, sync: syncSnapshot(db, { ...parsed, forceBackfill: parsed.forceBackfill && !pending, backfillApproved: effectiveBackfillApproved && !pending }, policy) };
    });
    const lineagePending = lineageDeferred || ["ambiguous", "choice_required"].includes(lineage.status);
    if (parsed.forceBackfill) assertSourceSnapshotAccepted(db,parsed.chatId);
    finishSyncPhase("lineageMs");
    db.prepare(`INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value
      WHERE server_meta.value<>excluded.value`).run(chatPacketBudgetKey(parsed.chatId), String(parsed.tokenBudget));
    db.prepare(`INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value
      WHERE server_meta.value<>excluded.value`).run(narrationViewpointKey(parsed.chatId), parsed.narrationViewpoint ?? "");
    if (parsed.memoryGeneration) memoryReferences.begin(parsed.chatId, parsed.memoryGeneration);
    markChatEngaged(db, parsed.chatId);
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
    if (!lineagePending && lineage.status !== "inherited" && mayStartInitialCalibration && ["unseeded", "awaiting_setup"].includes(initialCalibration.status)) {
      initialCalibration = beginInitialCalibration(db, parsed.chatId, parsed.forceBackfill || continuingColdStart ? "cold_start" : "new_root", parsed.resolvedSetup, {
        confirmationRequired: !parsed.resolvedSetup || parsed.forceBackfill || continuingColdStart,
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
        memoryEpoch: memoryEpoch(db,parsed.chatId),
        chatRevision: sync.revision,
        ...sourceStatus,
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
    const signalBuildingMs = performance.now() - syncFinishedAt;
    const stateTrace = retrievalTrace.isChatEnabled(parsed.chatId) ? new StateOutcomeCapture() : undefined;
    const readState = stateEvidenceReader(db, parsed.chatId, stateTrace, "shared");
    const semanticPending = embeddings.searchManyDetailed(retrievalSignals, parsed.chatId, 80, { stateEvidence: readState });
    // Observe before any synchronous preparation can throw. The normal join
    // still awaits the original promise and propagates its rejection.
    void semanticPending.catch(() => {});
    readState();
    // Lexical retrieval also reads non-state material (dialogues/FTS). Keep
    // its existing broad freshness guard independent of the scoped state cache.
    const lexicalChanges = db.prepare("SELECT total_changes() AS changes");
    const lexicalVersion = () => `${(lexicalChanges.get() as {changes:number}).changes}:${db.pragma("data_version", {simple:true})}`;
    const lexicalBeforeWait = lexicalVersion();
    const preparationStartedAt = performance.now();
    let lexicalSearch = lexicalCandidates(db, parsed.chatId, retrievalSignals, languageState.memory_language);
    const allocation = automaticPacketBudget(parsed.tokenBudget);
    const maximumStoryBudget = storyBudgetLimit(parsed.tokenBudget);
    const overviewRenderMaximum = storyOverviewRenderBudgetLimit(parsed.tokenBudget);
    const retrievalPreparationMs = performance.now() - preparationStartedAt;
    const semantic = await semanticPending;
    assertChatUnlocked(db,parsed.chatId);
    // Required API state collection still fails the request on an error.
    readState();
    if (lexicalVersion() !== lexicalBeforeWait) lexicalSearch = lexicalCandidates(db, parsed.chatId, retrievalSignals, languageState.memory_language);
    const embeddingFinishedAt = performance.now();
    const perspectiveQuery = querySignals.map((signal) => signal.text).join("\n");
    const sceneHitScores = new Map(semantic.scores);
    for (const [id, score] of lexicalSearch.scores) sceneHitScores.set(id, Math.max(sceneHitScores.get(id) ?? 0, score));
    const strongSceneIds = [...new Set([...sceneHitScores].filter(([, score]) => score >= .72)
      .sort((a,b) => b[1] - a[1]).slice(0, 4).map(([id]) => id))];
    const sceneHitParticipants = (db.prepare(`SELECT participants_json FROM memories WHERE chat_id=? AND active=1
      AND id IN (SELECT value FROM json_each(?))`).all(parsed.chatId, JSON.stringify(strongSceneIds)) as Array<{participants_json:string}>)
      .flatMap(row => JSON.parse(row.participants_json) as string[]);
    const sceneCharacters = resolveSceneCharacters(db, parsed, perspectiveQuery, sceneHitParticipants);
    const narrationViewpoint = resolveNarrationViewpoint(db, parsed.chatId, parsed.narrationViewpoint);
    const narrationDiagnostics = parsed.narrationViewpoint && !narrationViewpoint ? ["viewpoint_unresolved" as const] : [];
    // Compatibility metadata for older plugins; these names are scene hints only.
    const perspectiveResolution = { perspectives: sceneCharacters, source: "ledger" as const, unresolved: false };
    const requestedPromptIds = [...new Set(parsed.promptSourceMessageIds ?? [])].slice(-512);
    const trustedPromptSourceMessageIds = requestedPromptIds.length === 0 ? [] : (db.prepare(`
      SELECT message_id FROM messages
      WHERE chat_id=? AND message_id IN (${requestedPromptIds.map(() => "?").join(",")})
        AND lifecycle='committed' AND memory_excluded=0 AND host_visibility='active' AND content IS NOT NULL
      ORDER BY ordinal
    `).all(parsed.chatId, ...requestedPromptIds) as Array<{ message_id: string }>).map((row) => row.message_id);
    const { hasActiveMemory, hasTimelineMemory } = db.prepare(`SELECT
      EXISTS(SELECT 1 FROM memories WHERE chat_id=$chatId AND active=1) AS hasActiveMemory,
      EXISTS(SELECT 1 FROM memories m WHERE m.chat_id=$chatId AND m.active=1 AND m.capsule_parent_id IS NULL
        AND NOT ${recognitionOnlyMemorySql("m")}) AS hasTimelineMemory`).get({ chatId: parsed.chatId }) as { hasActiveMemory: number; hasTimelineMemory: number };
    const initialSetupOnly = !hasTimelineMemory && ["ready", "inherited"].includes(initialCalibration.status);
    const withAutomaticGuidance = (body: string): string => {
      const guided = withMemoryGuidance(body);
      return initialSetupOnly ? guided.replace(memoryGuidanceBlock, initialMemoryGuidanceBlock) : guided;
    };
    const fallbackPacket = initialSetupOnly ? "" : sharedPastPacket;
    const pricing = chatPacketPricing(db,parsed.chatId);
    const renderState = (rows: Parameters<typeof renderAutomaticState>[0], viewpoint?: string) => renderAutomaticState(rows,viewpoint,pricing);
    const retrievalPerspectives = ["narrator"];
    const activeTurnPerspectives = sceneCharacters;
    const namesPresent = [...activeTurnPerspectives, ...(parsed.identityHints?.recentSpeakerNames ?? []), parsed.identityHints?.userPersonaName ?? ""];
    const namesPrompt = (db.prepare("SELECT CASE WHEN canonical_hash<>'' THEN canonical_content ELSE content END content FROM messages WHERE chat_id=? AND memory_excluded=0 AND message_id IN (SELECT value FROM json_each(?)) ORDER BY ordinal")
      .all(parsed.chatId, JSON.stringify(trustedPromptSourceMessageIds)) as Array<{ content: string }>).map(row => row.content).join("\n");
    const namesMentioned = mentionedCharacters(db, parsed.chatId, [parsed.query, perspectiveQuery, namesPrompt].join("\n"));
    const sceneNames = renderSceneNames(db, parsed.chatId, namesPresent, namesPresent,
      namesMentioned, Math.min(200, Math.floor(parsed.tokenBudget * .1)), pricing);
    const storyProbe = compileStorySpine(db, parsed.chatId, activeTurnPerspectives, semantic.storyScores, maximumStoryBudget,new Set(),false,pricing,overviewRenderMaximum);
    const stateCorpus = readState();
    const stateMemorySources = db.prepare(`WITH sources AS MATERIALIZED (SELECT value id FROM json_each(?))
      SELECT m.id memory_id,e.value ->> '$.messageId' source_id FROM memories m,json_each(m.evidence_json) e
        WHERE m.chat_id=? AND m.active=1 AND e.value ->> '$.messageId' IN (SELECT id FROM sources)
      UNION SELECT d.memory_id,e.value ->> '$.messageId' source_id FROM memory_details d,json_each(d.evidence_json) e
        WHERE d.chat_id=? AND d.active=1 AND e.value ->> '$.messageId' IN (SELECT id FROM sources)`)
      .all(JSON.stringify([...new Set(stateCorpus.filter(state => state.current).flatMap(state => state.sourceIds))]), parsed.chatId, parsed.chatId) as Array<{memory_id:string;source_id:string}>;
    const stateMemoriesBySource = new Map<string, Array<{memoryId:string;order:number}>>();
    stateMemorySources.forEach((row,order)=>{
      const entries=stateMemoriesBySource.get(row.source_id) ?? [];
      entries.push({memoryId:row.memory_id,order}); stateMemoriesBySource.set(row.source_id,entries);
    });
    const stateSourceCache = new Map<typeof stateCorpus[number],string[]>();
    const stateSources = (state: typeof stateCorpus[number]): string[] => {
      if (state.memoryId) return [state.memoryId];
      let ids=stateSourceCache.get(state);
      if (!ids) {
        // Preserve the UNION's row order even when one state cites many sources.
        const matches=state.sourceIds.flatMap(id=>stateMemoriesBySource.get(id) ?? []).sort((a,b)=>a.order-b.order);
        ids=[...new Set(matches.map(row=>row.memoryId))]; stateSourceCache.set(state,ids);
      }
      return ids;
    };
    const arcExpansion = expandArcHits(db, parsed.chatId, activeTurnPerspectives, semantic.storyScores, 3, { kind: "author", sceneCharacters });
    // Retrieval competes against the full packet budget. Story overlap is
    // known only after leaf memories are selected; reserving the unsuppressed
    // Story probe here would strand that recovered space. The final compiler
    // trims the lowest-priority memories against the actual compact Story.
    const storyBudget = storyProbe.chargedTokens;
    const alwaysInject=prepareAlwaysInject(db,parsed.chatId,parsed.profile,retrievalPerspectives,trustedPromptSourceMessageIds,true,pricing);
    const alwaysIds=new Set(alwaysInject.manifest.memoryIds);
    const remainingBudget=Math.max(0,parsed.tokenBudget-alwaysInject.chargedTokens);
    const retrievalBudget = Math.max(0, remainingBudget - Math.min(320, Math.floor(remainingBudget * 0.08)));
    // Mandatory compact records stay whole even when larger than the preset.
    const hardTokenCeiling = Math.max(automaticHardTokenCeiling(parsed.tokenBudget),chargedPacketTokens(alwaysInject.xml ? withAutomaticGuidance(prependAlwaysInject("",alwaysInject.xml)) : fallbackPacket, alwaysInject.plan, pricing));
    const fullGuidancePacket = withMemoryGuidance("");
    const emptyPacket = hasTimelineMemory && chargedPacketTokens(fullGuidancePacket, alwaysInject.plan, pricing) <= hardTokenCeiling
      ? fullGuidancePacket : fallbackPacket;
    const perspectiveSections: Array<{ name: string; data: string; standaloneScopes?: import("@rcm/shared").KnowledgeScope[] }> = [];
    const structuredManifests: PacketManifest[] = [];
    const eligibleAtoms = new Map<string, MemoryContextItem>();
    const directAtomKeys = new Set<string>();
    const automaticAtomPriorities = new Map<string, AutomaticAtomPriority>();
    const portfolioMetadata = new Map<string, AutomaticPortfolioCandidate>();
    const automaticAssociationSources = new Map<string, string>();
    const selectedCandidateClasses = new Map<string, RetrievalCandidateClass>();
    const selectedRoles = new Map<string, RetrievalSelectionRole>();
    const retrievalDiagnostics: RetrievalDiagnostics[] = [];
    const recentMemoryIds = new Set<string>();
    let focusLeaderIds: string[] = [];
    const continuityBridgeIds: string[] = [];
    const activationByPerspective: Array<{ perspective: string; observations: AutomaticActivationObservation[] }> = [];
    {
      const perspective = "narrator";
      const result = retrieve(db, {
        chatId: parsed.chatId,
        query: parsed.query,
        querySignals: retrievalSignals,
        perspective,
        pricing,
        audience: { kind: "author", sceneCharacters },
        lexicalSearch,
        tokenBudget: Math.max(128, retrievalBudget),
        memoryOnlyInjection: parsed.memoryOnlyInjection,
        deferAutomaticBudget: true,
        excludeAtomKeys:alwaysInject.manifest.atomKeys,
        automaticSupportMemoryIds: [...new Set([...(storyProbe.supportMemoryIds ?? []), ...stateCorpus.flatMap(state => state.current ? stateSources(state) : [])])],
        structuredBudgetScale: 1,
        hardTokenCeiling: automaticHardTokenCeiling(Math.max(128, retrievalBudget)),
        semanticScores: semantic.scores,
        stateScores: semantic.stateScores,
        stateEvidence: readState,
        semanticHits: semantic.hits,
        semanticAtomHits: semantic.atomHits,
        semanticViewScores: semantic.viewScores,
        arcMemoryScores: arcExpansion.memoryScores,
        arcDetailScores: arcExpansion.detailScores,
        arcDialogueIds: arcExpansion.dialogueIds,
        arcExpansionDiagnostics: arcExpansion.diagnostics,
        promptSourceMessageIds: trustedPromptSourceMessageIds,
        activePerspectives: sceneCharacters,
        collectDiagnostics: retrievalTrace.enabled,
        stateOutcomeCapture: stateTrace,
      });
      if (result.perspectiveData) {
        const name = "narrator";
        perspectiveSections.push({ name, data: result.perspectiveData, standaloneScopes: result.standaloneScopes });
        structuredManifests.push(result.structuredManifest);
      }
      for (const item of emittedMemoryItems(buildEmissionPlan(result.eligibleCandidates, { promptSourceMessageIds: trustedPromptSourceMessageIds, excludedAtomKeys: new Set(alwaysInject.manifest.atomKeys) }))) {
        // Open seeds remain candidates until the portfolio chooses their typed
        // ID. They acquire an emission reason only at that selection.
        const seeds = result.eligibleCandidates.find(candidate=>candidate.id === item.id)?.details
          .filter(detail=>detail.seed?.status === "open" && !item.details.some(selected=>selected.id === detail.id)) ?? [];
        item.details.push(...seeds);
        if (!alwaysIds.has(item.id) || memoryCardHasContent(item)) eligibleAtoms.set(item.id, item);
      }
      for (const [id, metadata] of result.automaticPortfolioCandidates ?? []) portfolioMetadata.set(id, metadata);
      result.directAtomKeys.forEach((key) => directAtomKeys.add(key));
      for (const [id, via] of Object.entries(result.automaticAssociationSources ?? {})) automaticAssociationSources.set(id, via);
      for (const [key, priority] of Object.entries(result.automaticAtomPriorities ?? {})) automaticAtomPriorities.set(key, priority);
      for (const item of result.selected) {
        selectedCandidateClasses.set(item.id, result.selectedCandidateClasses[item.id] ?? "unclassified");
        selectedRoles.set(item.id, result.selectedRoles[item.id] ?? "filler");
      }
      result.recentMemoryIds.forEach((id) => recentMemoryIds.add(id));
      focusLeaderIds = result.focusLeaderIds;
      activationByPerspective.push({ perspective: AUTHOR_ACTIVATION_KEY, observations: result.activationObservations });
      for (const id of result.continuityBridgeIds) if (!continuityBridgeIds.includes(id)) continuityBridgeIds.push(id);
      if (result.diagnostics) retrievalDiagnostics.push(result.diagnostics);
    }
    const retrievalFinishedAt = performance.now();
    // Direct focus leaders keep their protection in the global portfolio.
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
    let renderStory = createStorySpineCompiler(db, parsed.chatId, activeTurnPerspectives, semantic.storyScores, Math.min(storyBudget,maximumStoryBudget), retrievalTrace.enabled, pricing, storyBudget);
    // Trim only removes atoms. Resolve their original support IDs once, then
    // recompute exclusions from the atoms still present on every render.
    const dialogueSupportIds = new Map<MemoryContextItem["keyDialogues"][number], string>();
    // The old lookup uses idx_memory_dialogues_memory (memory_id, ordinal).
    // Preserve its ordinal/rowid first match for identical legacy tuples.
    const dialogueRows = db.prepare(`SELECT id,memory_id,message_id,text FROM memory_dialogues WHERE chat_id=?
      AND memory_id IN (SELECT value FROM json_each(?)) ORDER BY memory_id,ordinal,rowid`)
      .all(parsed.chatId,JSON.stringify(selectedItems.map(item=>item.id))) as Array<{id:string;memory_id:string;message_id:string;text:string}>;
    const dialogueByTuple=new Map<string,string>();
    const dialogueTuple=(memoryId:string,messageId:string,text:string)=>JSON.stringify([memoryId,messageId,text]);
    for (const row of dialogueRows) {
      const key=dialogueTuple(row.memory_id,row.message_id,row.text);
      if (!dialogueByTuple.has(key)) dialogueByTuple.set(key,row.id);
    }
    for (const item of selectedItems) for (const dialogue of item.keyDialogues) {
      const id=dialogueByTuple.get(dialogueTuple(item.id,dialogue.messageId,dialogue.text));
      if (id) dialogueSupportIds.set(dialogue, `dialogue:${id}`);
    }
    const compileStoryForSelection = () => {
      const excluded = new Set(selectedItems.flatMap((item) => [...(emitsMemoryPlot(item) ? [`memory:${item.id}`] : []), ...item.details.map((detail) => `detail:${detail.id}`)]));
      for (const item of selectedItems) for (const dialogue of item.keyDialogues) {
        const supportId = dialogueSupportIds.get(dialogue);
        if (supportId) excluded.add(supportId);
      }
      return renderStory(excluded);
    };
    let finalStory = compileStoryForSelection();
    const sourceEvidence = retrieveSourceEvidence(db, parsed.chatId, retrievalSignals.filter((signal) => signal.kind !== "scene").map((signal) => signal.text).join("\n"),
      activeTurnPerspectives, parsed.tokenBudget, trustedPromptSourceMessageIds, semantic.sourceHits?.filter((hit) => hit.score >= 0.72 && (hit.viewIndex === undefined || retrievalSignals[hit.viewIndex]?.kind !== "scene")), [], [], undefined, undefined, { kind: "author", sceneCharacters });
    let deliveredSources = sourceEvidence.items;
    let emittedManifest = emptyPacketManifest();
    let emittedAtomKeys = new Set(emittedManifest.atomKeys);
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
    let latestStoryTimeText: string | undefined;
    const latestStoryTime = storyTimes.reduce<number | undefined>((latest, row) => {
      const end = storedStoryTimeEnd(row.story_time);
      if (end!==undefined && (latest===undefined || end>latest)) latestStoryTimeText=row.story_time;
      return end === undefined ? latest : latest === undefined ? end : Math.max(latest, end);
    }, undefined);
    const resolveRelationshipName = buildEntityIdentityResolver(db, parsed.chatId);
    const {allowsName: modelAllowsName}=modelEntityContext(db,parsed.chatId);
    const preferredRelationshipNames = [parsed.identityHints?.userPersonaName, parsed.identityHints?.hostCharacterName,
      ...(db.prepare("SELECT entity_name FROM entity_prominence WHERE chat_id=? AND (tier='core' OR pinned=1)").all(parsed.chatId) as Array<{entity_name:string}>).map(row => row.entity_name)]
      .flatMap(name => { if (!name || !modelAllowsName(name)) return []; const identity = resolveRelationshipName(name); return identity.ambiguous || !modelAllowsName(identity.canonical) ? [] : [identity.canonical]; });
    const stateCandidates = automaticStateCandidates(stateCorpus, { perspectives: retrievalPerspectives, sceneCharacters, preferredRelationshipNames,
      activeNames: [...new Set([...namesPresent, ...namesMentioned])], query: retrievalSignals.map(signal => signal.text).join("\n"), semantic: semantic.stateScores,
      covered: new Set(trustedPromptSourceMessageIds), latestStoryTime, latestStoryTimeText, trace: stateTrace, memoryOnly: parsed.memoryOnlyInjection,
      namesRecognitionIds: new Set(sceneNames.recognitionIds), sceneRecognitionIds: new Set(sceneNames.sceneRecognitionIds) });
    const stateBudget = parsed.memoryOnlyInjection ? 0 : sharedStateBudget(remainingBudget);
    // A mandatory row that cannot fit alone must not consume the memory lane
    // during portfolio selection, only to be dropped after all cards yielded.
    const impossibleState = new Set(stateCandidates.filter(row => (row.alwaysInject || row.promiseSlot==='pinned' || row.pinned)
      && chargedPacketTokens(withAutomaticGuidance(prependAlwaysInject(`<rp_memory_context>${renderState([{...row,line:row.baseLine ?? row.line,changeNote:undefined}]).xml}</rp_memory_context>`,alwaysInject.xml)),alwaysInject.plan,pricing)>hardTokenCeiling).map(row=>row.item.id));
    const selectedState = selectAutomaticState(stateCandidates.filter(row=>!impossibleState.has(row.item.id)), stateBudget, pricing, allocation.sceneRelationships);
    const ceilingDroppedState = new Set<string>();
    let progress = parsed.pairProgress !== true ? "" : renderPairProgress(listPairProgress(db,parsed.chatId,parsed.identityHints?.userPersonaName).filter(pair=>modelAllowsName(pair.persona)&&modelAllowsName(pair.character)),namesPresent,{ initialSetupOnly });
    const occasions = parsed.upcomingOccasions === false ? { asOf: null, items: [] } : prepareOccasions(db, parsed.chatId, parsed.profile, retrievalPerspectives, parsed.identityHints?.userPersonaName, { kind: "author", sceneCharacters });
    // Present calendar context is fixed output, charged before memories compete.
    let emissionPlan: EmissionPlan;
    const rebuildPacket = (viewpoint?: string) => {
      const state = renderState(selectedState, viewpoint);
      emittedManifest = mergePacketManifests([...structuredManifests, state.manifest,
        { ...emptyPacketManifest(), alwaysInjectMemoryIds: alwaysInject.manifest.alwaysInjectMemoryIds }]);
      emissionPlan = buildEmissionPlan(selectedItems, { promptSourceMessageIds: trustedPromptSourceMessageIds, lanes: emittedManifest });
      prependAlwaysCards(emissionPlan,alwaysInject.plan);
      omitStateLinkedDetails(emissionPlan,new Set(state.linkedDetailIds));
      emittedManifest = buildManifest(emissionPlan);
      emittedAtomKeys = new Set(emittedManifest.atomKeys);
      let body = consolidateMemoryPacket(db, parsed.chatId, bufferedSource, [...perspectiveSections, { name: "shared", data: state.xml }], selectedItems, "recall", "context", [...recentMemoryIds].filter((id) => selectedItems.some((item) => item.id === id)), activeTurnPerspectives, finalStory.xml, emittedManifest, latestStoryTime, sceneNames.text, undefined, emissionPlan, viewpoint);
      body=prependAlwaysInject(body,renderAlwaysInjectPlan(emissionPlan, viewpoint));
      const calendar = renderOccasions(occasions.asOf, occasions.items, 160, viewpoint, pricing);
      if (progress) body = (body || "<rp_memory_context></rp_memory_context>").replace("</rp_memory_context>", `${progress}\n</rp_memory_context>`);
      if (calendar) body = (body || "<rp_memory_context></rp_memory_context>").replace("</rp_memory_context>", `${calendar}\n</rp_memory_context>`);
      const deliveredDetails = selectedItems.flatMap(item => item.details
        .filter(detail => emittedAtomKeys.has(memoryDetailAtomKey(detail))).map(detail => detail.text));
      const deliveredDialogueEvidence = selectedItems.flatMap(item => item.keyDialogues
        .filter(dialogue => emittedAtomKeys.has(memoryDialogueAtomKey(item.id, dialogue))).flatMap(dialogue => dialogue.evidence));
      deliveredSources = sourceEvidence.items.filter(source => !deliveredDetails.some(text => text.includes(source.quote))
        && !(source.startOffset !== undefined && source.endOffset !== undefined && deliveredDialogueEvidence.some(evidence =>
          evidence.messageId === source.messageId && evidence.canonicalHash === source.canonicalHash
          && evidence.startOffset <= source.startOffset! && evidence.endOffset >= source.endOffset!)));
      emissionPlan.laneRows.push(...deliveredSources.map(source => ({ lane: "atomKeys", id: sourceEvidenceAtomKey(source) })));
      emittedManifest = buildManifest(emissionPlan);
      emittedAtomKeys = new Set(emittedManifest.atomKeys);
      const sourceXml = renderSourceEvidence(deliveredSources);
      const finish = (value: string) => referencePacket(viewpoint
        ? value.replace("</guidance>", `</guidance>\n${narrationLine(viewpoint)}`) : value);
      if (sourceXml) body = body.includes("</past_records>")
        ? body.replace("</past_records>", `${sourceXml}</past_records>`)
        : (body || "<rp_memory_context></rp_memory_context>").replace("</rp_memory_context>", `${sourceXml}</rp_memory_context>`);
      return finish(body ? withAutomaticGuidance(body) : emptyPacket);
    };
    const packetCharge = (value: string) => chargedPacketTokens(value, emissionPlan, pricing);
    let packet = rebuildPacket();
    const focusLeaderIdSet = new Set(focusLeaderIds);
    const continuityBridgeIdSet = new Set(continuityBridgeIds);
    const cueAnchorKeys = new Set<string>();
    const atomPolicy = { latestStoryTime, priorities: automaticAtomPriorities, focusIds: focusLeaderIdSet, continuityIds: continuityBridgeIdSet,
      roles: new Map(selectedRoles), associationSources: automaticAssociationSources, cueAnchorKeys };
    let atomDecisions = planAutomaticAtoms(selectedItems, directAtomKeys, atomPolicy);
    const cueAnchor = selectCueAnchor(atomDecisions, automaticAtomPriorities,
      new Map(retrievalSignals.flatMap((signal, index) => signal.kind === "cue" ? [[index, signal.weight]] : [])));
    if (cueAnchor) {
      cueAnchorKeys.add(cueAnchor.decision.atomKey);
      cueAnchor.decision.cueAnchor = true;
      cueAnchor.decision.cueViewIndex = cueAnchor.cueViewIndex;
    }
    const completedTurn = Number((db.prepare("SELECT completed_turn_count FROM chats WHERE id=?").get(parsed.chatId) as { completed_turn_count?: number } | undefined)?.completed_turn_count ?? 0);
    const floorActive = longtermFloorActive(db,parsed.chatId,parsed.tokenBudget,completedTurn);
    const portfolioCandidates = [...selectedItems];
    const candidateRoles = new Map(selectedRoles);
    const portfolioStory = renderStory();
    const selectPortfolio = (stateSourceGroups: readonly (readonly string[])[]) => {
      const stateLinkedDetailIds = new Set(renderState(selectedState).linkedDetailIds);
      const result = selectAutomaticPortfolio({ candidates: portfolioCandidates, metadata: portfolioMetadata, policy: atomPolicy,
        stateSourceGroups,
        storySupportIds: new Set(portfolioStory.supportMemoryIds ?? []), storySupportAtomIds: new Set(portfolioStory.supportItemIds ?? []), activeParticipants: activeTurnPerspectives,
        lastDelivered: automaticDeliveryHistory(db, parsed.chatId), completedTurn, hardTokenCeiling, allocation, longtermFloorActive: floorActive,
        directAtomKeys,
        cardTokens: item => {
          const plan=buildEmissionPlan([item],{promptSourceMessageIds:trustedPromptSourceMessageIds});
          omitStateLinkedDetails(plan,stateLinkedDetailIds);
          return emittedMemoryItems(plan).reduce((sum,card)=>sum+chargedCardTokens(projectMemoryScene(card),{plot:plan.cards[0]!.plot,latestStoryTime},pricing),0);
        },
        renderTokens: items => { selectedItems.splice(0, selectedItems.length, ...items); finalStory = compileStoryForSelection(); return packetCharge(rebuildPacket()); } });
      selectedItems.splice(0, selectedItems.length, ...result.items);
      selectedRoles.clear();
      for (const [id,role] of candidateRoles) selectedRoles.set(id,role);
      for (const [id,role] of result.roles) selectedRoles.set(id,role);
      return result;
    };
    // Delivered state is fixed before its source scenes compete for card space.
    const portfolio = selectPortfolio(automaticStateSources(selectedState,stateSources));
    finalStory = compileStoryForSelection(); packet = rebuildPacket();
    const removeAt = (index: number): void => {
      const removed = selectedItems.splice(index, 1)[0];
      for (const decision of atomDecisions) if (decision.memoryId === removed?.id && decision.outcome === "retained") decision.outcome = "memory_removed";
      finalStory = compileStoryForSelection();
      packet = rebuildPacket();
    };
    const fitAt = (index: number): void => {
      const fitted = fitAutomaticCard(selectedItems[index]!, item => {
        selectedItems[index] = item;
        finalStory = compileStoryForSelection();
        packet = rebuildPacket();
        return packetCharge(packet) <= hardTokenCeiling;
      },directAtomKeys,atomPolicy,atomDecisions,"hard_ceiling");
      if (!fitted) removeAt(index);
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
    const floorCardCost = (item: MemoryContextItem) => chargedCardTokens(projectMemoryScene(item),{plot:"emit",latestStoryTime},pricing);
    const floorProtected = (item: MemoryContextItem) => {
      const dialogueCost = (current: MemoryContextItem) => Math.max(0,floorCardCost(current)-floorCardCost({...current,keyDialogues:[]}));
      return dialogueCost(item)>0 && selectedItems.filter(current=>current!==item).reduce((sum,current)=>sum+dialogueCost(current),0)<portfolio.floors.dialogue.reserved
        || selectedRoles.get(item.id)==="longterm" && selectedItems.filter(current=>current!==item&&selectedRoles.get(current.id)==="longterm")
          .reduce((sum,current)=>sum+floorCardCost(current),0)<portfolio.floors.longterm.reserved;
    };
    const fitPacket = (allowStateRemoval: boolean) => {
      while (packetCharge(packet) > hardTokenCeiling) {
        if (allowStateRemoval && trimAutomaticStateNote(selectedState)) { packet = rebuildPacket(); continue; }
        // A relationship reservation must never buy room by removing a promise
        // or a surrounding memory, including the final portfolio rebuild.
        const reservedRelationship = lastMatchingIndex(selectedState, row => row.relationshipReservation === "reserved");
        if (reservedRelationship >= 0) { dropState(reservedRelationship); continue; }
        if (progress) { progress = ""; packet = rebuildPacket(); continue; }
        // 1. Peripheral memories yield before any current-state row.
        const peripheral = lastMatchingIndex(selectedItems, item => !protectedScene(item) && !floorProtected(item)
          && ["longterm", "association", "serendipity"].includes(selectedRoles.get(item.id) ?? ""));
        if (peripheral >= 0) { fitAt(peripheral); continue; }
        if (occasions.items.length) { occasions.items.pop(); packet = rebuildPacket(); continue; }
        // 2. State outside the active scene yields before older continuity.
        const outside = lastMatchingIndex(selectedState, row => !row.active && !row.alwaysInject && !row.protectedPromise && !row.pinned);
        if (allowStateRemoval && outside >= 0) { dropState(outside); continue; }
        // 3. Oldest continuity first, including historical structured records.
        const continuity = selectedItems.filter(item => !protectedScene(item) && !floorProtected(item) && selectedRoles.get(item.id) === "continuity")
          .sort((a, b) => (a.sourceOrdinal ?? 0) - (b.sourceOrdinal ?? 0))[0];
        if (continuity) { fitAt(selectedItems.indexOf(continuity)); continue; }
        if (finalStory.xml) {
          const reducedBudget = Math.max(0, chargedSectionTokens(finalStory.xml, pricing) - (packetCharge(packet) - hardTokenCeiling) - 1);
          const previousStory=finalStory.xml;
          renderStory = createStorySpineCompiler(db, parsed.chatId, activeTurnPerspectives, semantic.storyScores, Math.min(reducedBudget,maximumStoryBudget), retrievalTrace.enabled, pricing, storyBudget);
          finalStory = compileStoryForSelection(); packet = rebuildPacket();
          if (finalStory.xml!==previousStory) continue;
        }
        if (perspectiveSections.length) {
          // These sections contain only physical/relationship history now; the
          // current ledger is independently selected and cannot be popped here.
          perspectiveSections.splice(0); structuredManifests.splice(0); packet = rebuildPacket(); continue;
        }
        const ordinary = lastMatchingIndex(selectedItems, item => !protectedScene(item) && !floorProtected(item));
        if (ordinary >= 0) { fitAt(ordinary); continue; }
        // 4. Preserve scene state while the protected card still has a smaller
        // emission: optional lines, then plot, then ordinary remaining lines.
        if (selectedItems.length) { fitAt(selectedItems.length - 1); continue; }
        const unpinned = lastMatchingIndex(selectedState, row => !row.alwaysInject && !row.pinned && !row.protectedPromise);
        if (allowStateRemoval && unpinned >= 0) { dropState(unpinned); continue; }
        if (sourceEvidence.items.length) { sourceEvidence.items.pop(); packet = rebuildPacket(); continue; }
        // A mandatory-lane collision may omit the overview whole as a last
        // resort; never shorten an in-allowance stored overview by position.
        if (finalStory.xml) {
          renderStory=createStorySpineCompiler(db,parsed.chatId,activeTurnPerspectives,semantic.storyScores,0,retrievalTrace.enabled,pricing,0);
          finalStory=compileStoryForSelection(); packet=rebuildPacket(); continue;
        }
        // Manual current-state delivery yields after ordinary state, before
        // protected promises. It never raises the memory lane's hard ceiling.
        const alwaysState = lastMatchingIndex(selectedState, row => !!row.alwaysInject);
        if (allowStateRemoval && alwaysState >= 0) { dropState(alwaysState); continue; }
        // Global ceiling escape hatch only after every reservation and card has
        // yielded. Protected promises are not an unbounded packet-budget bypass.
        const promise = lastMatchingIndex(selectedState, row => !!row.protectedPromise);
        if (allowStateRemoval && promise >= 0) { dropState(promise); continue; }
        sceneNames.text = ""; sceneNames.omittedCount += sceneNames.pairCount; sceneNames.pairCount = 0;
        packet = rebuildPacket();
        break;
      }
    };
    fitPacket(true);
    // State membership is bounded before memory allocation. Returned floors
    // buy useful card depth/breadth, never a second unbounded state exchange.
    for (const decision of atomDecisions) {
      decision.role = selectedRoles.get(decision.memoryId) ?? decision.role;
      if (decision.outcome === "retained" && !selectedItems.some(item => item.id === decision.memoryId && (item.details.some(detail => memoryDetailAtomKey(detail) === decision.atomKey)
        || item.keyDialogues.some(dialogue => memoryDialogueAtomKey(item.id, dialogue) === decision.atomKey)))) decision.outcome = "target_budget";
    }
    const chargedTokens = packetCharge(packet);
    packet = rebuildPacket(narrationViewpoint);
    if (parsed.memoryReferenceMode === "none") packet = packet.replace(/\s+id="[^"]+"/g, "");
    const keptPeripheralIds = selectedItems.filter(peripheralMemory).map(item => item.id);
    for (const row of stateCandidates) for (const [index, perspective] of row.perspectives.entries()) {
      stateTrace?.record(perspective, row.item, selectedState.includes(row) ? index ? "deduped" : "delivered"
        : ceilingDroppedState.has(row.item.id) || impossibleState.has(row.item.id) ? "final_ceiling" : "budget", { rank: row.rank,
          ...(impossibleState.has(row.item.id)?{reason:'standalone_exceeds_ceiling'}:{}),
          ...(row.item.kind === "relationship" ? { reason: row.item.automatic?.summaryReady === false ? "relationship_summary_pending" : row.relationshipReservation === "reserved"
            ? selectedState.includes(row) ? "scene_relationship_reserved" : "scene_relationship_final_ceiling"
            : row.relationshipReservation === "overflow" ? "scene_relationship_allowance_exceeded" : "relationship_ranked_state" } : {}),
          ...(!selectedState.includes(row) ? { keptPeripheralMemoryIds: keptPeripheralIds } : {}) });
    }
    stateTrace?.budget("shared", stateBudget, renderState(selectedState).tokens);
    const assemblyFinishedAt = performance.now();
    const finalSelectedIds = new Set([...alwaysIds,...selectedItems.map((item) => item.id)]);
    for (const retrieval of retrievalDiagnostics) for (const candidate of retrieval.candidates) if (finalSelectedIds.has(candidate.id)) {
      candidate.selectionRole = selectedRoles.get(candidate.id);
      candidate.roleReason = portfolio.reasons.get(candidate.id);
    }
    const deliveredPerspectives = [...new Set([...perspectiveSections.map(item => item.name), ...selectedState.flatMap(row => row.perspectives)])]
      .map(name => name === "__shared__" ? "shared" : name);
    const finalManifest = { ...injectionManifest(packet, emittedManifest, deliveredPerspectives, finalStory.nodeIds), sourceEvidenceIds: deliveredSources.map((item) => item.id),
      longtermMemoryIds: [...finalSelectedIds].filter(id=>selectedRoles.get(id)==="longterm"),
      seedAtomKeys: [...new Set(emissionPlan!.cards.flatMap(card => card.item.details
        .filter(detail => factReasonsFor(card.item).get(detail.id)?.includes("open_seed"))
        .map(memoryDetailAtomKey).filter(key => emittedAtomKeys.has(key))))] };
    if(sceneNames.text)finalManifest.atomKeys=[...new Set([...finalManifest.atomKeys,...sceneNames.atomKeys])];
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
    const sectionTokens = Object.fromEntries(["always_inject", "story_continuity", "current_state", "occasions", "not_yet"].map(tag => [tag, (packet.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`))?.[0] ? estimateTokens(packet.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`))![0]) : 0)]));
    const cardEmission = traceEmissionPlan(emissionPlan!);
    const sceneDelivery = emissionPlan!.cards.map((card, index) => ({memoryId:card.memoryId,ref:requestRefs.get(card.memoryId),
      plots:card.plot === "emit" ? 1 : 0, exceptions:cardEmission[index]!.requiredExceptionIds.filter(id=>card.detailIds.includes(id)).length,
      details:card.detailIds.length,dialogues:card.dialogueIds.length}));
    const stateKinds = Object.fromEntries([...new Set(finalManifest.stateEvidenceIds.map(id=>id.split(":")[0]!))].map(kind=>[kind,finalManifest.stateEvidenceIds.filter(id=>id.startsWith(kind+":")).length]));
    const stateInventory = Object.fromEntries([...new Set(stateCorpus.map(item => item.kind))].map(kind => [kind, stateCorpus.filter(item => item.kind === kind).length]));
    const floorItems = emittedMemoryItems(emissionPlan!);
    const floors = {
      dialogue: packetFloorUsage(portfolio.floors.dialogue.reserved, floorItems.reduce((sum,item) =>
        sum + Math.max(0,floorCardCost(item)-floorCardCost({...item,keyDialogues:[]})),0)),
      longterm: packetFloorUsage(portfolio.floors.longterm.reserved, floorItems.filter(item=>selectedRoles.get(item.id)==="longterm")
        .reduce((sum,item)=>sum+floorCardCost(item),0)),
    };
    if (!floorActive) Object.assign(floors.longterm,{inactive:"cadence"});
    const assembly = { allocation, floors, chargedTokens, renderedTokens: estimateTokens(packet), names: { pairCount: sceneNames.pairCount, omittedCount: sceneNames.omittedCount }, stateInventory, stateSearch: { ...embeddings.stateIndex.status }, sectionTokens, sceneDelivery, stateKinds, ...processedHistoryCoverage(db, parsed.chatId), unusedTokens: Math.max(0, hardTokenCeiling - chargedTokens), unusedReason: chargedTokens < hardTokenCeiling * .8 ? "eligible_scene_or_whole_atom_limit" : undefined };
    const response = context.json({
      apiRevision: RCM_API_REVISION,
      serverInstanceId,
      memoryEpoch: memoryEpoch(db,parsed.chatId),
      chatRevision: sync.revision,
      ...sourceStatus,
      profile: parsed.profile,
      memoryLanguage: languageState.memory_language,
      pendingMemoryLanguage: languageState.pending_memory_language,
      requiresLanguageReprocess: languageState.pending_memory_language !== null,
      packet,
      stableAnchors,
      estimatedTokens: estimateTokens(packet),
      assembly,
      selected: emittedMemoryRecords(emissionPlan!).map(publicMemoryContext),
      stateSnapshots: renderAutomaticState(selectedState, narrationViewpoint).snapshots
        .filter(row => finalManifest.stateEvidenceIds.includes(row.id) && packet.includes(row.text)),
      injectionManifest: finalManifest,
      memoryToolsAvailable: memoryToolReadiness(db, parsed.chatId).available,
      memoryToolOpportunity: toolOpportunity,
      mcpRequestTimeoutMs:mcpRequestTimeoutMs(mcpSelector.publicConfig),
      perspectiveResolution,
      sceneCharacters, narrationViewpoint, narrationDiagnostics,
      initialCalibration: initialCalibrationView(db, parsed.chatId),
      lineage,
      omissionReason: packet ? undefined : !hasActiveMemory ? "no_memories" : perspectiveResolution.unresolved ? "unresolved_perspective" : "no_relevance",
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
      finalDecisions.set(decision.atomKey, { ...decision, ...old, bundle:decision.bundle, outcome: "retained" });
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
      signalBuildingMs,
      queryVectorMs: semantic.timings?.queryVectorMs ?? 0,
      queryVectorCacheHit: semantic.timings?.queryVectorCacheHit ?? 0,
      queryVectorRequests: semantic.timings?.queryVectorRequests ?? 0,
      stateSearchMs: semantic.timings?.stateSearchMs ?? 0,
      stateCollections: readState.collections,
      vectorSearchMs: semantic.timings?.vectorSearchMs ?? 0,
      retrievalPreparationMs,
      retrievalMs: retrievalFinishedAt - embeddingFinishedAt,
      assemblyMs: assemblyFinishedAt - retrievalFinishedAt,
      finalizeMs: finalizedAt - assemblyFinishedAt,
      totalMs: finalizedAt - prepareStartedAt,
    };
    if (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) void retrievalTrace.record({
      atomPreservation, roleTokens, cardEmission,
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
      audience: "author", sceneCharacters, narrationViewpoint, narrationDiagnostics,
      promptSourceMessageIds: trustedPromptSourceMessageIds,
      selectedIds: [...finalSelectedIds],
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
        alwaysInject:alwaysInject.diagnostics,
        ...assembly,
        requestedPreset: parsed.memoryBudgetPreset,
        actualTokenBudget: parsed.tokenBudget,
        targetBudget: parsed.tokenBudget,
        hardTokenCeiling,
        storyMaximum: maximumStoryBudget,
        storyOverviewRenderMaximum: overviewRenderMaximum,
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
    return withChatWrite(db, context.req.param('id'), () => {
      if (!updateStorySpineGroup(db, context.req.param("id"), context.req.param("groupId"), body)) {
        return context.json({ error: "Story spine group not found or read-only" }, 404);
      }
      void embeddings.indexPending(context.req.param("id"));
      return context.json({ ok: true, ...listStorySpine(db, context.req.param("id")) });
    });
  });
  app.post("/v1/chats/:id/story-spine/rebuild", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      const chatId = context.req.param("id");
      // This explicit action rebuilds the complete hierarchy, including boundaries.
      invalidateStorySpine(db, chatId);
      const queued = maybeEnqueueStorySpine(db, chatId, undefined, 'rebuild');
      if (queued) serverWorker.wake();
      void embeddings.indexPending(chatId);
      return context.json({ ok: true, queued, ...listStorySpine(db, chatId) });
    });
  });
  app.get('/v1/chats/:id/story-spine/rebuild/estimate',context=>context.json(estimateStoryRebuild(db,context.req.param('id'))));
  app.get("/v1/chats/:id/initial-calibration", (context) => context.json(initialCalibrationLedger(db, context.req.param("id"))));
  app.post("/v1/chats/:id/initial-calibration/confirm", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      try {
        const chatId = context.req.param("id");
        const pending = resolveInitialCalibrationConfirmation(db, chatId, "confirm");
        if (pending.alreadyResolved) return context.json({ ok: true, queuedJobs: 0, calibration: initialCalibrationLedger(db, chatId) });
        const chat = db.prepare("SELECT profile,include_user_messages,extraction_group_turns FROM chats WHERE id=?").get(chatId) as { profile: "companion" | "simulation"; include_user_messages: number; extraction_group_turns: number };
        const queuedJobs = enqueueExtractionJobs(db, chatId, chat.profile, pending.forceBackfill, chat.include_user_messages === 1, chat.extraction_group_turns, pending.forceBackfill ? "ledger" : "current", pending.extractionReview, undefined, pending.backfillRunId);
        if (queuedJobs) serverWorker.wake();
        return context.json({ ok: true, queuedJobs, calibration: initialCalibrationLedger(db, chatId) });
      } catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
      }
    });
  });
  app.post("/v1/chats/:id/initial-calibration/skip", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      try {
        const chatId = context.req.param("id");
        if (initialCalibrationView(db, chatId).status === "unseeded") beginInitialCalibration(db, chatId, "new_root", undefined);
        const pending = resolveInitialCalibrationConfirmation(db, chatId, "skip");
        if (pending.alreadyResolved) return context.json({ ok: true, queuedJobs: 0, calibration: initialCalibrationLedger(db, chatId) });
        const chat = db.prepare("SELECT profile,include_user_messages,extraction_group_turns FROM chats WHERE id=?").get(chatId) as { profile: "companion" | "simulation"; include_user_messages: number; extraction_group_turns: number };
        const queuedJobs = enqueueExtractionJobs(db, chatId, chat.profile, pending.forceBackfill, chat.include_user_messages === 1, chat.extraction_group_turns, pending.forceBackfill ? "ledger" : "current", pending.extractionReview, undefined, pending.backfillRunId);
        if (queuedJobs) serverWorker.wake();
        return context.json({ ok: true, queuedJobs, calibration: initialCalibrationLedger(db, chatId) });
      } catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
      }
    });
  });
  app.post("/v1/chats/:id/initial-calibration/retry", async (context) => {
    try {
      const chatId = context.req.param("id");
      const body = await context.req.json().catch(() => ({})) as { resolvedSetup?: unknown; identityHints?: unknown };
      return withChatWrite(db, context.req.param('id'), () => {
        const setupResult = body.resolvedSetup === undefined ? undefined : PickerSetupProjectionSchema.safeParse(body.resolvedSetup);
        if (setupResult && !setupResult.success) return context.json({ error: "resolvedSetup is invalid", issues: setupResult.error.issues }, 400);
        if (body.identityHints !== undefined && (typeof body.identityHints !== "object" || body.identityHints === null || Array.isArray(body.identityHints))) {
          return context.json({ error: "identityHints must be an object" }, 400);
        }
        const retry = setupResult?.success
          ? { projection: setupResult.data, identityHints: (body.identityHints ?? {}) as Record<string, unknown> }
          : initialCalibrationRetryInput(db, chatId);
        const queued = db.transaction(() => {
          if (initialCalibrationView(db, chatId).status === "unseeded") beginInitialCalibration(db, chatId, "new_root", undefined, { confirmationRequired: true });
          prepareInitialCalibrationRetry(db, chatId);
          if (!enqueueInitialCalibration(db, chatId, retry.projection, retry.identityHints, retry.backfillRunId)) throw new Error("Initial calibration is already queued");
          return true;
        })();
        if (queued) serverWorker.wake();
        return context.json({ ok: true, queued, calibration: initialCalibrationLedger(db, chatId) });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });
  app.post("/v1/chats/:id/initial-calibration/entities", async (context) => {
    try {
      const body = await context.req.json() as { displayName?: string; aliases?: string[]; prominence?: "primary" | "supporting" | "reference"; birthday?: import("@rcm/shared").EntityBirthday | null };
      return withChatWrite(db, context.req.param('id'), () => {
        const id = upsertInitialEntity(db, context.req.param("id"), { displayName: body.displayName ?? "", aliases: body.aliases, prominence: body.prominence, birthday: body.birthday });
        return context.json({ ok: true, id, calibration: initialCalibrationLedger(db, context.req.param("id")) });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.patch("/v1/chats/:id/initial-calibration/entities/:entityId", async (context) => {
    try {
      const body = await context.req.json() as { displayName?: string; aliases?: string[]; prominence?: "primary" | "supporting" | "reference"; birthday?: import("@rcm/shared").EntityBirthday | null };
      return withChatWrite(db, context.req.param('id'), () => {
        upsertInitialEntity(db, context.req.param("id"), { id: context.req.param("entityId"), displayName: body.displayName ?? "", aliases: body.aliases, prominence: body.prominence, birthday: body.birthday });
        return context.json({ ok: true, calibration: initialCalibrationLedger(db, context.req.param("id")) });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.delete("/v1/chats/:id/initial-calibration/entities/:entityId", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      try {
        const chatId = context.req.param("id");
        const deleted = deleteInitialEntity(db, chatId, context.req.param("entityId"));
        return deleted
          ? context.json({ ok: true, calibration: initialCalibrationLedger(db, chatId) })
          : context.json({ error: "Initial setup entity not found" }, 404);
      } catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
      }
    });
  });
  app.patch("/v1/chats/:id/initial-calibration/relationships/:baselineId", async (context) => {
    try {
      const body = await context.req.json() as { axes?: Record<string, string>; summary?: string };
      return withChatWrite(db, context.req.param('id'), () => {
        updateInitialRelationship(db, context.req.param("id"), context.req.param("baselineId"), { axes: body.axes ?? {}, summary: body.summary ?? "" });
        return context.json({ ok: true, calibration: initialCalibrationLedger(db, context.req.param("id")) });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });
  app.post("/v1/chats/:id/open", async (context) => {
    const body = TurnPrepareRequestSchema.extend({ workerId: z.string().min(1).optional() }).parse(await context.req.json());
    return withChatWrite(db, context.req.param('id'), () => {
      if (body.chatId !== context.req.param("id")) return context.json({ error: "chatId does not match route" }, 400);
      // Opening a host chat only resolves identity and stores sources. It must not
      // capture setup, retrieve a packet, enqueue work or wake a provider.
      const request = { ...body, resolvedSetup: undefined, forceBackfill: false, backfillApproved: false, deferExtraction: true, tokenBudget: 0 };
      const { lineage, ...sourceStatus } = withSourceSnapshot(db, body, (policy, allowDiscovery) => {
        syncChatTitle(db,body.chatId,body.chatTitle);
        const current = getChatLineage(db, body.chatId);
        if (!allowDiscovery && hasPendingLineageDiscovery(db, request)) policy.held = true;
        const resolved = current.status === "none" ? ensureChatLineage(db, request, allowDiscovery, policy.allowDestructive) : current;
        // A concurrent prepare may already have advanced this chat. Opening is
        // not an edit/rollback event; only fill a previously empty source ledger.
        if (!db.prepare("SELECT 1 FROM messages WHERE chat_id=? LIMIT 1").get(body.chatId)) syncSnapshot(db, request, policy);
        recordOpenChat(db, body.workerId ?? "legacy", body.chatId);
        writePersonaHint(db, body.chatId, body.identityHints?.userPersonaName);
        return { lineage: resolved };
      });
      return context.json({ ...sourceStatus, lineage, initialCalibration: initialCalibrationView(db, body.chatId), memoryLanguage: (db.prepare("SELECT memory_language FROM chats WHERE id=?").get(body.chatId) as { memory_language: string }).memory_language });
    });
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
      return withChatWrite(db, context.req.param('id'), () => {
        const request = {
          chatTitle: body.chatTitle,
          characterId: body.characterId,
          profile: body.profile,
          messageVisibility: body.messageVisibility,
          lineageHint: body.lineageHint,
          includeUserMessages: body.includeUserMessages,
          extractionGroupTurns: body.extractionGroupTurns,
          memoryLanguage: body.memoryLanguage,
          memoryLanguageSource: body.memoryLanguageSource,
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
        return context.json({ ok: true, lineage, memoryLanguage: (db.prepare("SELECT memory_language FROM chats WHERE id=?").get(request.chatId) as {memory_language:string}).memory_language, initialCalibration: initialCalibrationView(db, request.chatId), queuedJobs: 0 });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      const message = error instanceof Error ? error.message : String(error);
      return context.json({ error: message }, ["LINEAGE_PROBE_STALE", "LINEAGE_ALREADY_APPLIED", "TARGET_HAS_DERIVED_DATA"].includes(message) ? 409 : 400);
    }
  });
  app.post("/v1/chats/:id/lineage/acknowledge", (context) => withChatWrite(db, context.req.param('id'), () => context.json({ ok: true, lineage: acknowledgeChatLineage(db, context.req.param("id")) })));
  app.post("/v1/chats/:id/lineage/select", async (context) => {
    try {
      const body = LineageProbeApplyRequestSchema.parse(await context.req.json());
      return withChatWrite(db, context.req.param('id'), () => {
        const chatId = context.req.param("id");
        const lineage = chooseChatLineage(db, chatId, body.parentChatId, { ...body, chatId, messages: [], query: '', perspectives: [],
          tokenBudget: 0, forceBackfill: false, deferExtraction: true }, body.fingerprint);
        return context.json({ ...lineage, memoryLanguage: (db.prepare("SELECT memory_language FROM chats WHERE id=?").get(chatId) as {memory_language:string}).memory_language, initialCalibration: initialCalibrationView(db, chatId), queuedJobs: 0 });
      });
    }
    catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.post("/v1/chats/:id/lineage/decline", async (context) => {
    try {
      const body = await context.req.json() as { fingerprint?: string };
      return withChatWrite(db, context.req.param('id'), () => {
        if (!body.fingerprint) return context.json({ error: "fingerprint is required" }, 400);
        return context.json({ ok: true, lineage: declineChatLineage(db, context.req.param("id"), body.fingerprint) });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      const message = error instanceof Error ? error.message : String(error);
      return context.json({ error: message }, message === "LINEAGE_PROBE_STALE" ? 409 : 400);
    }
  });
  app.post("/v1/chats/:id/lineage/revert", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      const chatId = context.req.param("id");
      revertChatLineage(db, chatId);
      // Reverting is cancellation, not consent to a full source backfill.
      return context.json({ ok: true, lineage: getChatLineage(db, context.req.param("id")) });
    });
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
      return withChatWrite(db, context.req.param('id'), () => {
        const chatId = context.req.param("id");
        const lineage = applyManualLineage(db, chatId, body.parentChatId, body.fingerprint, body.targetMessageInventory, body.replaceDerived, body.target);
        return context.json({ ok: true, lineage, initialCalibration:initialCalibrationView(db,chatId), queuedJobs: 0 });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
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
    return withChatWrite(db, context.req.param('id'), () => {
      if (!body.sourceChatId || !body.fingerprint) return context.json({ error: "sourceChatId and fingerprint are required" }, 400);
      const targetChatId = context.req.param("id");
      try {
        const result = db.transaction(() => {
          const preview = previewMemoryTransplant(db, body.sourceChatId!, targetChatId);
          if (preview.fingerprint !== body.fingerprint) throw new Error("TRANSPLANT_PREVIEW_STALE");
          if (preview.requiresReplacement && !body.replaceDerived) throw new Error("TARGET_HAS_DERIVED_DATA");
          return transplantCompleteArchive(db, exportCompleteArchive(db, {}, albumPhotoStore), body.sourceChatId!, targetChatId);
        })();
        void embeddings.indexPending(targetChatId);
        return context.json({ ok: true, ...result, lineage:getChatLineage(db,targetChatId),initialCalibration:initialCalibrationView(db,targetChatId) });
      } catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
      }
    });
  });

  const checkWorkOff = (chatIds: string[], cancel: boolean) => {
    const locks = chatIds.map(chatId => ({ chatId, lock: chatUpgradeLock(db,chatId) })).filter(item => item.lock);
    const locked = locks.find(item => item.lock!.phase === 2);
    const conflict = locked ?? locks[0];
    if (conflict && (locked || !cancel)) throw Object.assign(new Error(locked ? '마무리하는 중이라 지금은 끌 수 없어요.' : '다시 만들기를 취소하고 기억을 끌까요?'), {
      code: locked ? 'PHASE_LOCKED' : 'UPGRADE_ACTIVE', lock: conflict.lock, chatId: conflict.chatId,
    });
    for (const {chatId,lock} of locks) cancelUpgrade(db,chatId,lock!.runId);
  };
  const workChats = (characterId?: string) => db.prepare(`SELECT id,character_id FROM chats WHERE ${userChatSql()} AND NOT EXISTS
    (SELECT 1 FROM regeneration_runs u WHERE u.shadow_chat_id=chats.id)${characterId ? " AND character_id=?" : ""}`)
    .all(...(characterId ? [characterId] : [])) as Array<{ id: string; character_id: string }>;
  const syncChatWork = (body: { chatEnabled?: Record<string, boolean>; characterEnabled?: Record<string, boolean>; defaultChatEnabled?: boolean; cancelUpgrade?: boolean; chatId?: string }, characterId?: string) => {
    if (body.chatId) assertUserChat(db,body.chatId);
    Object.keys(body.chatEnabled ?? {}).forEach(id=>assertUserChat(db,id));
    const settings = body.chatEnabled ?? {};
    const effective = new Map(characterId ? [] : Object.entries(settings));
    if (body.characterEnabled || body.defaultChatEnabled !== undefined) {
      for (const chat of workChats(characterId)) effective.set(chat.id, body.characterEnabled?.[chat.character_id] !== false
        && (settings[chat.id] ?? body.defaultChatEnabled ?? true));
    }
    checkWorkOff([...effective].filter(([,enabled]) => !enabled).map(([chatId]) => chatId),body.cancelUpgrade === true);
    for (const [chatId, enabled] of effective) {
      if (isChatWorkHeld(db, chatId) === !enabled) continue;
      setChatWorkEnabled(db, chatId, enabled);
      if (enabled) { serverWorker.wake(); void embeddings.indexPending(chatId); }
    }
    return [...effective.keys()];
  };

  app.post("/v1/jobs/lease", async (context) => {
    const body = LeaseJobRequestSchema.parse(await context.req.json());
    syncChatWork(body);
    if (llmStore.config.engine === "server") return context.json({ job: null });
    if(body.modelSettingsFingerprint) db.prepare("INSERT INTO server_meta(key,value) VALUES('risu_model_settings_fingerprint',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(body.modelSettingsFingerprint);
    let leased;
    try {leased=leaseJob(db,body.workerId,config.leaseSeconds,{canonicalTranslation:body.capabilities?.canonicalTranslation===true,recoverUnstartedLease:true,stateContract:body.capabilities?.stateExtractionV2===true,stateWriting:body.capabilities?.stateWritingFormat===true,eventWriting:body.capabilities?.eventWritingFormat===true,eventWritingE1e:body.capabilities?.eventWritingFormatE1e===true,eventWritingE1f:body.capabilities?.eventWritingFormatE1f===true,stateWritingR10:body.capabilities?.stateWritingFormatR10===true,stateWritingR11:body.capabilities?.stateWritingFormatR11===true});}
    catch(error) {
      if((error as {code?:string}).code==="PLUGIN_UPDATE_REQUIRED")return context.json({code:"PLUGIN_UPDATE_REQUIRED",error:"기억 플러그인을 업데이트해 주세요."},409);
      throw error;
    }
    const job = attachAuxiliaryPlan(db, leased, {
      maxInputTokens: llmStore.config.maxInputTokens, maxOutputTokens: llmStore.config.maxOutputTokens, llmTimeoutMs: llmStore.config.llmTimeoutMs,
    });
    const checkpoints=job ? JSON.parse((db.prepare('SELECT payload_json FROM jobs WHERE id=?').get(job.id) as {payload_json:string}).payload_json).risuStageCheckpoints : undefined;
    return context.json({ job: job ? { ...job, risuStageCheckpoints:checkpoints, relaxAuxiliaryCensorship: llmStore.config.relaxAuxiliaryCensorship === true } : null });
  });
  app.post('/v1/jobs/:id/validated-stage',async context=>{
    const body=await context.req.json() as {workerId:string;stage:string;inputHash:string;result:unknown};
    return withJobWrite(db, context.req.param('id'), () => {
      if(!['extraction','audit'].includes(body.stage) || !/^[a-f0-9]{64}$/.test(body.inputHash)) return context.json({error:'Invalid stage checkpoint'},400);
      const row=db.prepare("SELECT payload_json FROM jobs WHERE id=? AND lease_owner=? AND status='leased'").get(context.req.param('id'),body.workerId) as {payload_json:string}|undefined;
      if(!row) return context.json({error:'Lease not found'},409);
      const payload=JSON.parse(row.payload_json);
      const parsed=body.stage==='extraction' ? extractionDraftSchema(payload.promptContract).safeParse(body.result) : ExtractionAuditSubmissionSchema.safeParse(body.result);
      if(!parsed.success || body.stage==='audit' && !(parsed.data as any).patch) return context.json({error:'Stage validation failed'},400);
      payload.risuStageCheckpoints={...payload.risuStageCheckpoints,[body.stage]:{inputHash:body.inputHash,result:parsed.data}};
      db.prepare('UPDATE jobs SET payload_json=? WHERE id=?').run(JSON.stringify(payload),context.req.param('id'));
      return context.json({ok:true});
    });
  });
  app.post("/v1/jobs/:id/draft", async (context) => {
    const body = await context.req.json() as { workerId?: string; output?: string; storyValidationReason?: string };
    return withJobWrite(db, context.req.param('id'), () => {
      if (typeof body.workerId !== "string" || typeof body.output !== "string") return context.json({ error: "Invalid draft" }, 400);
      const ok = stageJobModelOutput(db, context.req.param("id"), body.output, body.workerId,
        typeof body.storyValidationReason === "string" ? body.storyValidationReason : undefined);
      return ok ? context.json({ ok: true }) : context.json({ error: "Lease not found" }, 409);
    });
  });
  app.post("/v1/jobs/:id/renew", async (context) => {
    const body = await context.req.json() as { workerId?: string };
    return withJobWrite(db, context.req.param('id'), () => {
      if (typeof body.workerId !== "string" || !body.workerId) return context.json({ error: "Invalid lease renewal" }, 400);
      return renewJobLease(db, context.req.param("id"), body.workerId, config.leaseSeconds)
        ? context.json({ ok: true })
        : context.json({ error: "Lease not found" }, 409);
    });
  });
  app.post("/v1/jobs/:id/progress", async (context) => {
    const body = await context.req.json() as { shapeNormalizations?:unknown; workerId?: string; stage?: string; repairDelta?: number; llmCallStats?: { total?: unknown; repairs?: unknown; byPurpose?: unknown }; llmCallDiagnostic?: { purpose?: unknown; attempt?: unknown; outcome?: unknown; at?: unknown; error?: unknown; code?: unknown; httpStatus?: unknown; risuCall?: unknown; usage?: unknown; repairReason?:unknown } };
    return withJobWrite(db, context.req.param('id'), () => {
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
          ...(['format','fields','source','access'].includes(String(rawDiagnostic.repairReason))?{repairReason:String(rawDiagnostic.repairReason)}:{}),
          ...(rawDiagnostic.usage ? { usage: auxiliaryUsageMetadata(rawDiagnostic.usage) } : {}),
          ...(RISU_AUXILIARY_FAILURE_CODES.includes(rawDiagnostic.code as any) ? { code: String(rawDiagnostic.code) } : {}),
          ...(typeof rawDiagnostic.httpStatus === "number" && Number.isInteger(rawDiagnostic.httpStatus) && rawDiagnostic.httpStatus >= 100 && rawDiagnostic.httpStatus <= 599 ? { httpStatus: rawDiagnostic.httpStatus } : {}),
          ...(typeof rawDiagnostic.error === "string" ? { error: rawDiagnostic.error.slice(0, 300) } : {}) } : undefined;
      const ok = setJobPipelineStage(db, context.req.param("id"), body.stage as JobPipelineStage, body.workerId, repairDelta, llmCallStats, llmCallDiagnostic);
      if(ok && body.shapeNormalizations!==undefined) {
        const diagnostics=AuxiliaryShapeDiagnosticSchema.array().parse(body.shapeNormalizations);
        recordJobShapeNormalizations(db,context.req.param("id"),diagnostics,body.workerId);
      }
      return ok ? context.json({ ok: true }) : context.json({ error: "Lease not found" }, 409);
    });
  });
  app.post("/v1/jobs/:id/complete", async (context) => {
    const rawBody = await context.req.json();
    return withJobWrite(db, context.req.param('id'), () => {
      const body = CompleteJobRequestSchema.parse(rawBody);
      const job = db.prepare(`SELECT j.type,j.chat_id,j.payload_json,j.attempts,c.profile,c.memory_language FROM jobs j JOIN chats c ON c.id=j.chat_id
      WHERE j.id=? AND j.lease_owner=? AND j.status='leased'`).get(context.req.param("id"), body.workerId) as { type: string; chat_id: string; payload_json: string; attempts: number; profile: any; memory_language: any } | undefined;
      if (!job) return context.json({ error: "Lease not found" }, 409);
      const expectedLanguage = (JSON.parse(job.payload_json || "{}") as { memoryLanguage?: string }).memoryLanguage ?? job.memory_language;
      if (job.type !== 'canonical_translation' && job.type !== 'memory_group' && job.type !== "relationship_projection" && job.type !== "initial_calibration" && job.type !== "story_consolidation" && job.type !== "ledger_consistency" && job.type !== "quiz" && (body.result as { language?: unknown } | null)?.language !== expectedLanguage) {
        return context.json({ error: `Canonical language must be ${expectedLanguage}` }, 400);
      }
      try {
        if (body.reconciliation?.stateRecovery) recordJobStateRecovery(db, context.req.param("id"), body.reconciliation.stateRecovery, body.workerId);
        const completed = job.type === 'canonical_translation' ? completeCanonicalTranslationJob(db, context.req.param('id'), body.workerId, body.result, embeddings) : job.type === 'memory_group' ? completeMemoryGroupJob(db, context.req.param('id'), body.workerId, body.result) : job.type === "episode"
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
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (message === "QUIZ_EMPTY: no valid quiz items") {
          return context.json({ error: message }, 422);
        }
        throw error;
      }
    });
  });
  app.post("/v1/jobs/:id/reconciliation/prepare", async (context) => {
    const body = PrepareReconciliationRequestSchema.parse(await context.req.json());
    return withJobWrite(db, context.req.param('id'), () => {
      const job = db.prepare("SELECT chat_id,type,payload_json FROM jobs WHERE id=? AND lease_owner=? AND status='leased'").get(context.req.param("id"), body.workerId) as { chat_id: string; type: string; payload_json: string } | undefined;
      if (!job) return context.json({ error: "Lease not found" }, 409);
      const jobPayload = JSON.parse(job.payload_json) as { sourceMessageIds?: string[]; auxiliaryBudget?: { maxInputTokens?: number }; serverLlmSnapshot?: { maxInputTokens?: number } };
      const sourceMessageIds = jobPayload.sourceMessageIds ?? [];
      if ((jobPayload as {memoryOnly?:boolean}).memoryOnly) return context.json({required:false});
      if (job.type === 'memory_addition' && memoryAdditionStopsAfterEvents(body.result)) return context.json({ required: false });
      const preparedResult = rescueDraftDialogues(db, job.chat_id, sourceMessageIds,
        body.audit?.patch ? applyExtractionAuditPatch(db, job.chat_id, sourceMessageIds, body.result, body.audit.patch).result : body.result);
      if (body.audit?.patch?.keepPendingItemRefs.some((ref) => !ref.startsWith("dialogue:"))) return context.json({ required: false, blocked: true });
      const evidenceIssues = inspectDraftEvidence(db, job.chat_id, sourceMessageIds, preparedResult);
      if (evidenceIssues.some((issue) => issue.blocking)) return context.json({ required: false, candidateSetHash: "", blocked: true, groundingDraft: preparedResult, evidenceIssues });
      if ((jobPayload as any).regenerationRunId) return context.json({ required: false, groundingDraft: preparedResult, evidenceIssues });
      const maxInputTokens = jobPayload.auxiliaryBudget?.maxInputTokens ?? jobPayload.serverLlmSnapshot?.maxInputTokens ?? 80_000;
      const prepared = usesStateExtraction(job.type, jobPayload)
        ? prepareStateExtraction(db, job.chat_id, sourceMessageIds, preparedResult, maxInputTokens, job.type === 'memory_addition'
          ? { userRequest: (jobPayload as any).userRequest, existingMemories: (jobPayload as any).existingMemories } : undefined, context.req.param("id"))
        : prepareReconciliation(db, job.chat_id, preparedResult, maxInputTokens);
      if ('stateInput' in prepared) (jobPayload as any).stateInput = prepared.stateInput;
      (jobPayload as any).auxiliaryPromptParts = prepared.parts?.map((part) => ({ purpose: "reconciliation", systemPrompt: part.systemPrompt, userPrompt: part.userPrompt })) ?? [];
      db.prepare("UPDATE jobs SET payload_json=?,updated_at=? WHERE id=? AND lease_owner=? AND status='leased'").run(JSON.stringify(jobPayload), Date.now(), context.req.param("id"), body.workerId);
      if ("progressSent" in prepared) recordProgressSent(db, context.req.param("id"), prepared.progressSent);
      const parts = prepared.parts?.map((part) => {
        const cachedResult=cachedAuxiliaryPage(jobPayload as any,"reconciliation",part.systemPrompt,part.userPrompt);
        return {...part,cachedResult,...(cachedResult!==undefined ? {cachedStateRecovery:cachedAuxiliaryStateRecovery(jobPayload,part.systemPrompt,part.userPrompt)} : {})};
      });
      return context.json({ required: prepared.required, candidateSetHash: prepared.candidateSetHash, systemPrompt: prepared.systemPrompt,
        ...("reviewExemptItemRefs" in prepared ? { reviewExemptItemRefs: prepared.reviewExemptItemRefs } : {}),
        userPrompt: prepared.userPrompt, parts, ...('stateExtraction' in prepared || evidenceIssues.length ? { groundingDraft: preparedResult, evidenceIssues } : {}) });
    });
  });
  app.get("/v1/update/status", async (context) => {
    const refresh = context.req.query("refresh") === "1";
    const cursor = context.req.query('incidentCursor');
    return context.json({...(refresh ? await updateService.check() : updateService.status()),
      ...incidentsSince(db,cursor === undefined ? undefined : Number(cursor))});
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
    return withJobWrite(db, context.req.param('id'), () => {
      if (typeof body.workerId !== "string" || typeof body.systemPrompt !== "string" || typeof body.userPrompt !== "string" ||
        !["initial_calibration", "ledger_consistency", "reconciliation"].includes(String(body.purpose))) return context.json({ error: "Invalid validated auxiliary page" }, 400);
      try {
        const key = storeValidatedAuxiliaryPage(db, context.req.param("id"), body.workerId, { purpose: body.purpose as any,
          systemPrompt: body.systemPrompt, userPrompt: body.userPrompt, result: body.result, stateRecovery: body.stateRecovery });
        return context.json({ ok: true, key });
      } catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
      }
    });
  });
  app.post("/v1/jobs/:id/fail", async (context) => {
    const body = FailJobRequestSchema.parse(await context.req.json());
    return withJobWrite(db, context.req.param('id'), () => {
      const failedJob = db.prepare("SELECT chat_id,type,payload_json FROM jobs WHERE id=? AND lease_owner=? AND status='leased'").get(context.req.param("id"), body.workerId) as { chat_id: string; type: string; payload_json: string } | undefined;
      const result = failJob(db, context.req.param("id"), body.workerId, {message:body.error,...body.providerFailure,modelContentRejected:body.modelContentRejected});
      if (result?.status === "failed" && failedJob?.type === "ledger_consistency") {
        finalizeLedgerConsistencyRun(db, failedJob.chat_id, String((JSON.parse(failedJob.payload_json) as { backfillRunId?: string }).backfillRunId ?? ""));
      }
      return result ? context.json({ ok: true, ...result }) : context.json({ error: "Lease not found" }, 409);
    });
  });

  app.post("/v1/chats/:id/recall", async (context) => {
    const recallSignal=AbortSignal.any([context.req.raw.signal,AbortSignal.timeout(mcpRequestTimeoutMs(mcpSelector.publicConfig)-5_000)]);
    const handlerStarted = performance.now();
    const body = RecallRequestSchema.parse(await context.req.json());
    const requestDecodeMs = performance.now() - handlerStarted;
    const staleResponse = () => context.json({ answers: [], packet: "", selected: [], deliveredAtomKeys: [], deliveredSourceRanges: [],
      opportunityError: "stale_turn", newAtomCount: 0, error: "The request generation is no longer current." });
    const audience = mcpRetrievalAudience(body.activePerspectives);
    if (!db.prepare("SELECT 1 FROM chats WHERE id=?").get(context.req.param("id"))) {
      const answers = [{ question: body.query, evidence: [], alreadyPresent: false }];
      return context.json({ answers, packet: renderMcpAnswer(answers), selected: [], deliveredAtomKeys: [], deliveredSourceRanges: [],
        archiveEmpty: true, timings: { serverMs: performance.now() - handlerStarted, rerankCalls: 0, rerankTotalTokens: 0 } });
    }
    if (body.memoryGeneration && !memoryReferences.ensure(context.req.param("id"), body.memoryGeneration)) return staleResponse();
    const readState = stateEvidenceReader(db, context.req.param("id"), undefined, "shared");
    const embeddingStarted = performance.now();
    const semanticResults = await embeddings.searchBatchDetailed([body.query], context.req.param("id"), 80, { stateEvidence: readState });
    const embeddingMs = performance.now() - embeddingStarted;
    const retrievalStarted = performance.now();
    const semantic = semanticResults[0]!;
    const storyScores = new Map(semantic.storyScores ?? []);
    const arcExpansion = expandArcHits(db, context.req.param("id"), body.activePerspectives?.length ? body.activePerspectives : ["narrator"], storyScores, 3, audience);
    let result = retrieve(db, {
      chatId: context.req.param("id"), query: body.query, perspective: "narrator", audience,
      intent: "recall", tokenBudget: body.tokenBudget, semanticScores: semantic.scores,
      stateEvidence: readState,
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
    const finalizationStarted = performance.now();
    const queriedCharacters = mentionedCharacters(db, context.req.param("id"), body.query);
    const characterLookupMs = performance.now() - finalizationStarted;
    const namesBudget = Math.min(200, Math.floor(body.tokenBudget * .1));
    let finalized: Awaited<ReturnType<typeof finalizeMcpAnswer>>;
    try {
      finalized = await finalizeMcpAnswer(db, context.req.param("id"), result, {
        audience,
        memoryOnlyInjection: body.memoryOnlyInjection,
        stateEvidence: readState,
        query: body.query, aspects: undefined,
        tokenBudget: body.tokenBudget - namesBudget, perspectives: body.activePerspectives?.length ? body.activePerspectives : ["narrator"],
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
    if (body.memoryGeneration && !memoryReferences.current(context.req.param("id"),body.memoryGeneration)) return staleResponse();
    const referenceStarted = performance.now();
    const referenceGeneration = body.memoryGeneration ?? randomUUID();
    const requestReferences = body.memoryGeneration ? memoryReferences : new MemoryReferences(db);
    if (!body.memoryGeneration) requestReferences.begin(context.req.param("id"), referenceGeneration);
    if (requestReferences.current(context.req.param("id"), referenceGeneration)) {
      for (const answer of result.answers ?? []) for (const evidence of answer.evidence) {
        if (evidence.memoryId) evidence.ref = requestReferences.issue(context.req.param("id"), referenceGeneration, evidence.memoryId);
      }
      const reference = (id: string) => requestReferences.issue(context.req.param("id"), referenceGeneration, id);
      result.packet = renderAuthorMcpAnswer(result.answers ?? [],result.emissionPlan,result.eligibleCandidates,
        reference,storedNarrationViewpoint(db,context.req.param("id")),new Set([...(body.alreadyPresentAtomKeys??[]),...(body.excludeAtomKeys??[])]));
      result.estimatedTokens = estimateTokens(result.packet);
    }
    const referenceRenderMs = performance.now() - referenceStarted;
    const namesStarted = performance.now();
    const involvedCharacters = queriedCharacters.length ? [...new Set([...queriedCharacters, ...result.selected.flatMap(item => item.participants)])] : [];
    const names = renderSceneNames(db, context.req.param("id"),
      ["narrator", ...involvedCharacters], involvedCharacters, [], namesBudget, undefined, mcpRecognitionIds(result.answers??[]),
      new Set([...(body.alreadyPresentAtomKeys??[]),...(body.excludeAtomKeys??[])]));
    result.packet = appendSceneNames(result.packet, names);
    result.deliveredAtomKeys=[...new Set([...result.deliveredAtomKeys,...names.atomKeys])];
    result.estimatedTokens = estimateTokens(result.packet);
    const namesMs = performance.now() - namesStarted;
    const spanRerankTokens=finalized.sourceSpans.usage?.total_tokens;
    const timings = { ...finalized.timings, requestDecodeMs, embeddingMs, retrievalMs, characterLookupMs, referenceRenderMs, namesMs,
      rerankMs: finalized.rerank.elapsedMs,
      rerankCalls: finalized.rerank.calls, spanRerankMs: finalized.sourceSpans.elapsedMs,
      spanRerankCalls: finalized.sourceSpans.calls, finalizationMs: performance.now() - finalizationStarted,
      serverMs: performance.now() - handlerStarted,
      selectorCalls:Number(finalized.selector?.calls??0),
      selectorMs:Number(finalized.selector?.elapsedMs??0),
      selectorInputSerializationMs: finalized.selector?.inputSerializationMs ?? 0,
      rerankTokens:0,rerankUsageCalls:0,
      ...(spanRerankTokens===undefined?{}:{spanRerankTokens,spanRerankUsageCalls:finalized.sourceSpans.usage!.calls_with_usage}),
      rerankTotalTokens:spanRerankTokens??0 };
    const serializationStarted = performance.now();
    const followableMemoryIds = result.mcpFollowableMemoryIds ?? [];
    const { emissionPlan: _emissionPlan, standaloneScopes: _standaloneScopes, diagnostics: _diagnostics, eligibleCandidates: _eligible, mcpSearchEnvelopes: _envelopes,
      mcpFollowableMemoryIds: _followable, directAtomKeys: _direct, structuredManifest: _structured, ...publicResult } = result;
    const response = context.json({ ...publicResult, selected: result.selected.map(publicMemoryContext), answers: publicMcpAnswers(result.answers ?? []), timings, followableMemoryIds, deliverySource, newAtomCount: result.deliveredAtomKeys.filter(key => ![...(body.alreadyPresentAtomKeys ?? []), ...(body.excludeAtomKeys ?? [])].includes(key)).length });
    const responseSerializationMs = performance.now() - serializationStarted;
    const traceStarted = performance.now();
    const traceRequestId = body.traceContext?.requestId ?? randomUUID();
    if (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) await retrievalTrace.record({
      id: traceRequestId,
      kind: "mcp_search",
      cardEmission: traceEmissionPlan(result.emissionPlan),
      names: { pairCount: names.pairCount, omittedCount: names.omittedCount },
      selector: finalized.selector,
      timings: { ...timings, responseSerializationMs }, elapsedMs: timings.serverMs,
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
    if (body.memoryGeneration && !memoryReferences.current(context.req.param("id"),body.memoryGeneration)) return staleResponse();
    if (retrievalTrace.enabled) response.headers.set("Server-Timing", `rcm-trace;dur=${(performance.now() - traceStarted).toFixed(2)}`);
    return response;
  });
  app.post("/v1/chats/:id/expand", async (context) => {
    const started = performance.now();
    const body = ExpandRequestSchema.parse(await context.req.json());
    const audience = mcpRetrievalAudience(body.activePerspectives);
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
    const readState = stateEvidenceReader(db, chatId, undefined, "shared");
    const result = retrieve(db, { chatId, query: body.focus ?? "", perspective: "narrator", audience,
      stateEvidence: readState,
      memoryOnlyInjection: body.memoryOnlyInjection,
      tokenBudget: body.tokenBudget, seedMemoryId: memoryId, followAllDetails: true,
      reinforce: true, deferReinforcement: true, mcpCandidatesOnly: true,
      activePerspectives: body.activePerspectives, collectDiagnostics: retrievalTrace.enabled });
    result.eligibleCandidates = result.eligibleCandidates.filter(item => item.id === memoryId);
    if (!result.eligibleCandidates.length) return reject("INVALID_MEMORY_REF", "invalid_ref", INVALID_MEMORY_REF_MESSAGE);
    result.answers = [];
    let semantic: Awaited<ReturnType<EmbeddingService["searchBatchDetailed"]>> = [];
    let semanticStatus = body.focus ? "unavailable" : "not_requested";
    let embeddingMs = 0;
    if (body.focus && embeddings.ready) {
      const embeddingStarted = performance.now();
      const deadline = AbortSignal.timeout(2_000);
      const signal = AbortSignal.any([context.req.raw.signal, deadline]);
      try {
        const results = await embeddings.searchBatchDetailed([body.focus], chatId, 80, { targetMemoryId:memoryId, signal });
        if (!signal.aborted && results[0] && !results[0].searchUnavailable) {
          semantic = results;
          semanticStatus = results[0].hits.size || results[0].sourceHits?.length ? "available" : "no_hits";
        }
      } catch { /* Continue with the lexical candidates already prepared. */ }
      if (deadline.aborted) semanticStatus = "timeout";
      embeddingMs = performance.now() - embeddingStarted;
    }
    const involved = [...new Set(result.eligibleCandidates.flatMap(item => item.participants))];
    const namesBudget = Math.min(200, Math.floor(body.tokenBudget * .1));
    await finalizeMcpAnswer(db, chatId, result, { audience, query: body.focus ?? "",
      stateEvidence: readState,
      tokenBudget: body.tokenBudget - namesBudget, perspectives: body.activePerspectives ?? ["narrator"],
      promptIds:body.promptSourceMessageIds,excludedAtoms:[...(body.alreadyPresentAtomKeys ?? []),...(body.excludeAtomKeys ?? [])],
      semantic, seedMemoryId: memoryId });
    // A change before the request is allowed; a change during assembly is not.
    if (version !== memoryReferences.version(chatId, memoryId)) return reject("MEMORY_SNAPSHOT_CHANGED", "snapshot_changed", "The memory changed during this request. Retry against the current chat.");
    for (const answer of result.answers ?? []) for (const evidence of answer.evidence) if (evidence.memoryId === memoryId) evidence.ref = body.ref;
    const names = renderSceneNames(db, chatId, ["narrator", ...involved], involved,
      mentionedCharacters(db, chatId, body.focus ?? ""), namesBudget, undefined, mcpRecognitionIds(result.answers??[]),
      new Set([...(body.alreadyPresentAtomKeys??[]),...(body.excludeAtomKeys??[])]));
    result.packet = appendSceneNames(renderAuthorMcpAnswer(result.answers ?? [],result.emissionPlan,result.eligibleCandidates,()=>body.ref,storedNarrationViewpoint(db,chatId),
        new Set([...(body.alreadyPresentAtomKeys??[]),...(body.excludeAtomKeys??[])])), names);
    result.deliveredAtomKeys=[...new Set([...result.deliveredAtomKeys,...names.atomKeys])];
    result.estimatedTokens = estimateTokens(result.packet);
    const timings = { serverMs: performance.now() - started, rerankCalls: 0, rerankTotalTokens: 0, embeddingMs };
    if (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) await retrievalTrace.record({
      id: body.traceContext?.requestId ?? randomUUID(), kind: "mcp_search", chatId,
      cardEmission: traceEmissionPlan(result.emissionPlan),
      traceContext: body.traceContext, query: body.focus ?? "Expand the referenced record", intent: "expand",
      names: { pairCount: names.pairCount, omittedCount: names.omittedCount },
      answers: publicMcpAnswers(result.answers ?? []), selectedIds: result.selected.map(item => item.id), packet: result.packet,
      deliveredAtomKeys: result.deliveredAtomKeys, deliveredSourceRanges: result.deliveredSourceRanges,
      retrieval: result.diagnostics, timings, semanticStatus, elapsedMs: timings.serverMs, deliverySource: "reference",
    });
    return context.json({ answers: publicMcpAnswers(result.answers ?? []), packet: result.packet, selected: result.selected.map(publicMemoryContext),
      deliveredAtomKeys: result.deliveredAtomKeys, deliveredSourceRanges: result.deliveredSourceRanges,
      timings, semanticStatus });
  });

  app.post("/v1/turn/delivery", async (context) => {
    const body = await context.req.json().catch(() => undefined) as { chatId?: unknown; memoryIds?: unknown; atomKeys?: unknown; receiptId?: unknown; longtermMemoryIds?: unknown; seedAtomKeys?: unknown } | undefined;
    if (!body || typeof body.chatId !== "string" || !Array.isArray(body.memoryIds)
      || body.memoryIds.length > 512 || !body.memoryIds.every(id => typeof id === "string")) {
      return context.json({ error: "Invalid memory delivery receipt" }, 400);
    }
    if (body.atomKeys !== undefined && (!Array.isArray(body.atomKeys) || body.atomKeys.length > 4096 || !body.atomKeys.every(key => typeof key === 'string') || typeof body.receiptId !== 'string' || !body.receiptId)) return context.json({error:'Invalid detail delivery receipt'},400);
    assertChatUnlocked(db,body.chatId);
    if (body.longtermMemoryIds !== undefined && (!Array.isArray(body.longtermMemoryIds)
      || body.longtermMemoryIds.length > 512 || !body.longtermMemoryIds.every(id=>typeof id === "string" && (body.memoryIds as string[]).includes(id))))
      return context.json({error:"Invalid long-term delivery receipt"},400);
    if (body.seedAtomKeys !== undefined && (!Array.isArray(body.seedAtomKeys)
      || body.seedAtomKeys.length > 4096 || !Array.isArray(body.atomKeys)
      || !body.seedAtomKeys.every(key => typeof key === "string" && (body.atomKeys as string[]).includes(key))))
      return context.json({error:"Invalid seed delivery receipt"},400);
    recordAutomaticDelivery(db, body.chatId, body.memoryIds,body.longtermMemoryIds as string[]|undefined);
    if (Array.isArray(body.seedAtomKeys)) recordSeedDelivery(db,body.chatId,body.seedAtomKeys,body.receiptId as string);
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

  app.get("/v1/admin/chats", (context) => context.json({ items: listAdminChats(db, retrievalTrace.dashboardAvailable), recentCleanup: recentChatCleanup(db) }));
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
      const detail = settingsFailureCode(error) ? settingsFailureMessage(error) : undefined;
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
    const parsed = TranslationRequestSchema.safeExtend({ maxOutput: z.number().int().min(256).max(128000).default(TRANSLATION_DEFAULT_OUTPUT) }).safeParse(body);
    if (!parsed.success) return context.json({ code: "INVALID_CONFIG", error: "Invalid translation plan" }, 400);
    const batches = planTranslation(parsed.data, parsed.data.maxOutput);
    return context.json({ parts: batches.map(batch => ({ systemPrompt: withAuxiliaryStoryFraming([{ role: "system", content: translationSystemPrompt }], llmStore.config.relaxAuxiliaryCensorship === true)[0]!.content, userPrompt: JSON.stringify(batch), items: translationParts(batch) })) });
  });
  app.post("/v1/translations/batch", async context => {
    const parsed = TranslationBatchSchema.safeExtend({
      ...TranslationLegacySettingsSchema.shape, chatId: z.string().min(1),
    }).safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ code: "INVALID_CONFIG", error: "Invalid translation batch" }, 400);
    const body = parsed.data;
    const batch = { scenes: body.scenes, other: body.other };
    const items = translationParts(batch);
    if (!items.length) return context.json({ code: "INVALID_CONFIG", error: "Invalid translation parts" }, 400);
    assertUserChat(db,body.chatId);
    if(!db.prepare('SELECT 1 FROM chats WHERE id=?').get(body.chatId)) return context.json({code:'CHAT_NOT_FOUND',error:'Chat not found'},404);
    if (isChatWorkHeld(db, body.chatId)) return context.json({ code: "CHAT_WORK_HELD", error: CHAT_WORK_HELD }, 409);
    const scope = beginChatWork(db, body.chatId);
    let apiKey = "", model = "";
    const completed: ReturnType<typeof validateTranslation> = [];
    let usage: any;
    try {
      const resolved = translationConnection.resolve(body);
      const config = resolved.config; apiKey = resolved.apiKey;
      if (!apiKey) throw new TranslationError("AUTH_FAILED", "번역 연결의 인증정보가 없어요.");
      if (translationItemCost(batch) > Math.floor(config.maxOutputTokens / 3) || translationReferenceCost(batch) > Math.floor(config.maxOutputTokens / 2)) throw new TranslationError("INVALID_CONFIG", "Translation batch exceeds budget");
      model = config.model;
      const translateAndCollect = async (batch: TranslationBatch) => {
        // Each original/half batch owns a deadline, including its Korean-script retry.
        const signal = AbortSignal.any([scope.controller.signal, context.req.raw.signal, AbortSignal.timeout(translationTimeoutMs(config.maxOutputTokens))]);
        const translate = async (batch: TranslationBatch, finalRetry=false) => {
          let startedAt: number | undefined;
          let callUsage: unknown;
          try {
          const result = await requestStructuredProvider(llmStore, config, apiKey,
            [{ role: "system", content: translationSystemPrompt }, { role: "user", content: JSON.stringify(batch) }], signal, config.maxOutputTokens,()=>{startedAt=Date.now();});
          callUsage = result.usage;
          scope.controller.signal.throwIfAborted();
          if (result.usage) for (const [key, value] of Object.entries(result.usage)) {
            usage ??= {};
            usage[key] = typeof usage[key] === "number" && typeof value === "number" ? usage[key] + value : value;
          }
          const translated = validateTranslation(result.content, translationParts(batch), result.finishReason);
          if(startedAt!==undefined)recordTranslationCall(db, { chatId: body.chatId, site: 'server', provider: config.provider, model: config.model, startedAt,
            durationMs: Date.now()-startedAt, usage: callUsage, itemCount: translationParts(batch).length, completedItems:translated.length-(finalRetry?0:untranslatedParts(translationParts(batch),translated).length), outcome: 'succeeded' });
          return translated;
          } catch (error) {
            if(startedAt!==undefined)recordTranslationCall(db, { chatId: body.chatId, site: 'server', provider: config.provider, model: config.model, startedAt,
              durationMs: Date.now()-startedAt, usage: callUsage ?? (error as any)?.usage, itemCount: translationParts(batch).length, completedItems:0, outcome: 'failed', failure: error });
            throw error;
          }
        };
        let result = await translate(batch);
        const retry = untranslatedParts(translationParts(batch), result);
        if (retry.length) {
          const second = await translate({ scenes: [], other: retry.map(({ speaker: _speaker, ...part }) => part) },true);
          result = result.map(item => second.find(row => row.id === item.id && row.partIndex === item.partIndex) ?? item);
        }
        completed.push(...result);
      };
      try { await translateAndCollect(batch); }
      catch (error) {
        const halves = (error as { code?: string })?.code === "MODEL_OUTPUT_TRUNCATED" ? splitTranslationBatch(batch) : undefined;
        if (!halves) throw error;
        // A failed half escapes directly; only the original batch may split.
        for (const half of halves) await translateAndCollect(half);
      }
      return context.json({ items: completed, usage, model });
    } catch (error) {
      if (scope.controller.signal.aborted) return context.json({ code: "CHAT_WORK_HELD", error: CHAT_WORK_HELD }, 409);
      const code = error instanceof TranslationError ? error.code : error instanceof ProviderRequestError
        ? error.kind === "timeout" ? "TIMEOUT" : error.kind === "json" ? "INVALID_RESPONSE" : error.kind === "transport" ? "NETWORK_ERROR" : error.status === 401 || error.status === 403 ? "AUTH_FAILED" : error.status === 429 ? "RATE_LIMITED" : "PROVIDER_HTTP_ERROR"
        : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "TIMEOUT" : "INVALID_CONFIG";
      if (code === "RATE_LIMITED" && error instanceof ProviderRequestError && error.retryAfterMs !== undefined) {
        context.header("Retry-After", String(Math.ceil(error.retryAfterMs / 1000)));
      }
      // Return verified progress so the plugin can persist complete source rows before reporting failure.
      if (completed.length) return context.json({ items: completed, usage, model, failure: { code,
        ...(error instanceof ProviderRequestError && error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}) } });
      return context.json({ code, error: settingsFailureMessage(error, "translation") }, 502);
    } finally { scope.finish(); }
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
    const raw = await context.req.json();
    const body = WorkerControlSchema.parse(raw);
    syncChatWork(body);
    recordOpenChat(db, body.workerId, body.chatId);
    serverWorker.heartbeat(body.workerId);
    const read = () => {
      const globalWorker = serverWorker.status;
      const worker = { ...(body.chatId ? serverWorker.statusForChat(body.chatId) : globalWorker), globalQueuedJobs: globalWorker.queuedJobs };
      const chatStatus = body.chatId ? readDashboardStatus(body.chatId) : undefined;
      const feed = incidentsSince(db,typeof raw.incidentCursor === 'number' ? raw.incidentCursor : undefined);
      // Include quizzes and all chats/embedding queues, even work hidden by the open-chat view.
      const busy = !!globalWorker.activeCalls || !!globalWorker.quizGenerating || !!db.prepare("SELECT 1 FROM jobs WHERE status IN ('queued','leased') LIMIT 1").get()
        || !!db.prepare("SELECT 1 FROM embedding_blocks WHERE status='queued' LIMIT 1").get()
        || embeddings.retryDue;
      const version = createHash('sha256').update(JSON.stringify({ worker, chatStatus, busy, incidentCursor: feed.incidentCursor },
        (key, value) => key === 'controlLeaseUntil' ? undefined : value)).digest('hex');
      return { ok: true, worker, ...(chatStatus ? { chatStatus } : {}), idleWatch: { version, busy }, ...feed };
    };
    let result = read();
    const waitMs = typeof raw.waitMs === 'number' && Number.isFinite(raw.waitMs) ? Math.max(0, Math.min(45_000, raw.waitMs)) : 0;
    const until = Date.now() + waitMs;
    // SQLite counters cover every persisted status input (including triggers and
    // writes from another connection), without scanning jobs, sources or memories.
    // Unrelated writes may cause a conservative re-read. Sample AFTER read(), whose
    // episode projection can itself write, so it cannot invalidate its own snapshot.
    const changeToken = () => JSON.stringify([connectionChanges.get(), db.pragma('data_version', { simple: true }),
      serverWorker.idleWaitToken(body.chatId), embeddings.idleWaitToken]);
    let observedChanges = waitMs > 0 ? changeToken() : undefined;
    // Long idle intervals still observe remote jobs and incidents within one second.
    // The client keeps scanning the host and can cancel this wait on any local wake.
    while (body.chatId && !result.idleWatch.busy && !result.incidents.length && raw.statusVersion === result.idleWatch.version && Date.now() < until && db.open && !context.req.raw.signal.aborted) {
      await new Promise<void>(resolve => {
        const signal = context.req.raw.signal;
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, Math.min(1_000, until - Date.now()));
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) finish();
      });
      if (!db.open || context.req.raw.signal.aborted || Date.now() >= until) break;
      if (changeToken() !== observedChanges) {
        result = read();
        observedChanges = changeToken();
      }
    }
    if (waitMs > 0 && db.open && !context.req.raw.signal.aborted) {
      serverWorker.heartbeat(body.workerId);
      recordOpenChat(db, body.workerId, body.chatId);
      result = read();
    }
    return context.json(result);
  });
  app.post("/v1/worker/resume", async (context) => {
    const body = WorkerControlSchema.parse(await context.req.json());
    if (body.chatId) assertSourceSnapshotAccepted(db,body.chatId);
    syncChatWork(body);
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
    return withChatWrite(db, context.req.param('id'), () => {
      try {
        const ok = resetDerivedChat(db, embeddings, context.req.param("id"));
        return ok ? context.json({ ok }) : context.json({ error: "Chat not found" }, 404);
      } catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
      }
    });
  });
  app.post("/v1/chats/:id/reprocess", async (context) => {
    try {
      const chatId = context.req.param("id");
      assertSourceSnapshotAccepted(db,chatId);
      assertSetupLineageResolved(db, chatId);
      const body = await context.req.json().catch(() => ({})) as {
        activatePendingMemoryLanguage?: unknown;
        extractionReviewOverride?: unknown;
        resolvedSetup?: unknown;
        identityHints?: unknown;
        expectedSourceMessages?: unknown;
      };
      return withChatWrite(db, context.req.param('id'), () => {
        if (body.activatePendingMemoryLanguage !== undefined && typeof body.activatePendingMemoryLanguage !== "boolean") return context.json({ error: "activatePendingMemoryLanguage must be boolean" }, 400);
        if (body.extractionReviewOverride !== undefined && typeof body.extractionReviewOverride !== "boolean") return context.json({ error: "extractionReviewOverride must be boolean" }, 400);
        if (body.expectedSourceMessages !== undefined && (!Number.isInteger(body.expectedSourceMessages) || Number(body.expectedSourceMessages) < 0)) return context.json({ error: "expectedSourceMessages must be a non-negative integer" }, 400);
        const setupResult = body.resolvedSetup === undefined ? undefined : PickerSetupProjectionSchema.safeParse(body.resolvedSetup);
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
        if (["queued", "awaiting_confirmation"].includes(calibrationBefore.status)) {
          return context.json({ error: "Initial calibration is already in progress", code: "INITIAL_CALIBRATION_IN_PROGRESS", calibration: calibrationBefore }, 409);
        }
        if (!setupResult?.success) {
          return context.json({
            error: "Choose setup materials in the picker before rebuilding initial memory.",
            code: "INITIAL_SETUP_REQUIRED",
            calibration: calibrationBefore,
          }, 409);
        }
        const result = db.transaction(() => {
          recanonicalizeSourceLedger(db, chatId);
          const pendingMessages = reprocessChat(db, embeddings, chatId, body.activatePendingMemoryLanguage === true);
          const operationRunId = randomUUID();
          beginInitialCalibration(db, chatId, "cold_start", setupResult.data, {
            confirmationRequired: true,
            forceBackfill: true,
            extractionReview: body.extractionReviewOverride as boolean | undefined,
          });
          const queued = enqueueInitialCalibration(db, chatId, setupResult.data,
            (body.identityHints ?? {}) as Record<string, unknown>, operationRunId);
          const language = db.prepare("SELECT memory_language,pending_memory_language FROM chats WHERE id=?").get(chatId) as { memory_language: string; pending_memory_language: string | null };
          return {
            ok: true, pendingMessages, queuedJobs: queued ? 1 : 0, awaitingCalibration: true,
            calibration: initialCalibrationView(db, chatId),
            memoryLanguage: language.memory_language, pendingMemoryLanguage: language.pending_memory_language,
          };
        })();
        if (result.queuedJobs) serverWorker.wake();
        return context.json(result);
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });
  app.post("/v1/admin/chats/cleanup-unengaged", async (context) => {
    const body = z.object({ chatIds: z.array(z.string().min(1)).max(10000), currentChatId: z.string().optional(), workerId: z.string().min(1) }).parse(await context.req.json());
    recordOpenChat(db, body.workerId, body.currentChatId);
    const deletedChats = deleteUnengagedChats(db, embeddings, body.chatIds);
    return context.json({ ok: true, deletedChats });
  });
  app.delete("/v1/chats/:id", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      try {
        const deletedChats = deleteChats(db, embeddings, [context.req.param("id")]);
        return deletedChats ? context.json({ ok: true, deletedChats }) : context.json({ error: "Chat not found" }, 404);
      } catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        if ((error as {code?:string}).code === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error instanceof Error ? error.message : String(error) }, 409);
      }
    });
  });
  app.delete("/v1/characters/:id", (context) => {
    const chatIds = (db.prepare(`SELECT id FROM chats WHERE character_id=? AND ${userChatSql()}`).all(context.req.param("id")) as Array<{ id: string }>).map((row) => row.id);
    chatIds.forEach(chatId=>assertChatUnlocked(db,chatId));
    try {
      const deletedChats = deleteChats(db, embeddings, chatIds);
      return deletedChats ? context.json({ ok: true, deletedChats }) : context.json({ error: "Character not found" }, 404);
    } catch (error) {
      if ((error as {code?:string}).code === 'CHAT_UPGRADING') throw error;
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
      return withChatWrite(db, context.req.param('id'), () => {
        if(!UserCorrectionEditSchema.safeParse(body).success) return context.json({error:"locked must be boolean"},400);
        const holder = typeof body.holder === "string" ? body.holder.trim() : "";
        const subject = typeof body.subject === "string" ? body.subject.trim() : "";
        if (!holder || !subject || !["aware_of", "interacted"].includes(String(body.level))) return context.json({ error: "holder, subject, and a valid level are required" }, 400);
        const knownAs = Array.isArray(body.knownAs) ? body.knownAs.filter((value): value is string => typeof value === "string") : [];
        for (const field of ["knownAs", "addressTerms"] as const) {
          const terms = body[field];
          if (Array.isArray(terms) && terms.some(value => typeof value === "string" && hasSocialTermSeparator(value))) {
            return context.json({ error: `${field} items must not contain commas (, ， 、); send each term as a separate array item` }, 400);
          }
        }
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
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.delete("/v1/chats/:id/social-knowledge", async (context) => {
    try {
      const body = await context.req.json() as { holder?: unknown; subject?: unknown };
      return withChatWrite(db, context.req.param('id'), () => {
        const holder = typeof body.holder === "string" ? body.holder.trim() : "";
        const subject = typeof body.subject === "string" ? body.subject.trim() : "";
        if (!holder || !subject) return context.json({ error: "holder and subject are required" }, 400);
        return context.json({ items: retractSocialKnowledge(db, context.req.param("id"), holder, subject) });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.get("/v1/chats/:id/social-knowledge/backfill/preview", (context) => {
    try { return context.json(previewSocialKnowledgeBackfill(db, context.req.param("id"))); }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  });
  app.post("/v1/chats/:id/social-knowledge/backfill", async (context) => {
    try {
      const body = await context.req.json().catch(() => ({})) as { extractionReviewOverride?: unknown };
      return withChatWrite(db, context.req.param('id'), () => {
        if (body.extractionReviewOverride !== undefined && typeof body.extractionReviewOverride !== "boolean") return context.json({ error: "extractionReviewOverride must be boolean" }, 400);
        const queuedJobs = enqueueSocialKnowledgeBackfill(db, context.req.param("id"), body.extractionReviewOverride as boolean | undefined);
        if (queuedJobs) serverWorker.wake();
        return context.json({ ok: true, queuedJobs });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  function readExtractionAudits(chatId: string, list = false, auditId?: string) {
    const items = db.prepare(`SELECT id,job_id AS jobId,status,source_message_ids_json AS sourceMessageIds,${list ? 'NULL' : 'source_fingerprint_json'} AS sourceFingerprint,source_revision AS sourceRevision,
      ${list ? "CASE WHEN status IN ('pending_review','failed') THEN draft_json ELSE json_object('smallReviews',json(json_extract(draft_json,'$.smallReviews'))) END" : "draft_json"} AS draft,
      ${list ? "NULL" : "patch_json"} AS patch,error,${list ? "NULL" : "usage_json"} AS usage,attempts,created_at AS createdAt,updated_at AS updatedAt
      FROM extraction_audits WHERE chat_id=?${auditId ? ' AND id=?' : ''} ORDER BY updated_at DESC`).all(chatId,...(auditId ? [auditId] : [])) as Array<Record<string, any>>;
    return items.map((item) => {
      const sourceMessageIds = JSON.parse(item.sourceMessageIds || "[]");
      const draft = JSON.parse(item.draft);
      const smallReviews = readSmallReviews(draft);
      const visible = visibleSmallReviews(db, chatId, sourceMessageIds, list ? smallReviews.filter(candidate => candidate.status === 'pending') : smallReviews);
      const evidenceReview = ["pending_review", "failed"].includes(item.status) ? describeEvidenceReview(db, chatId, item.jobId, draft, sourceMessageIds) : undefined;
      if (list) return { id:item.id,jobId:item.jobId,status:item.status,updatedAt:item.updatedAt,detailsLoaded:false,
        ...(evidenceReview ? {evidenceReview:{blocking:evidenceReview.blocking,appliedMemories:evidenceReview.appliedMemories,issueCount:evidenceReview.issues.length}} : {}),
        smallReviews:visible.map(candidate => ({id:candidate.id,kind:candidate.kind,status:candidate.status,text:candidate.text,holder:candidate.holder,subject:candidate.subject,
          memoryTitle:candidate.memoryTitle,knownAs:candidate.knownAs,addressTerms:candidate.addressTerms,canKeep:candidate.canKeep,canKeepAsWritten:candidate.canKeepAsWritten,
          sourceChoiceCount:candidate.sourceChoices.length,detailsLoaded:false})) };
      return { ...item, sourceMessageIds, sourceFingerprint: JSON.parse(item.sourceFingerprint || "[]"), draft,
        smallReviews: visible,
        patch: item.patch ? JSON.parse(item.patch) : undefined, usage: JSON.parse(item.usage || "{}"),
        ...(evidenceReview ? { evidenceReview } : {}) };
    }).filter(item => !list || item.smallReviews.length > 0 || item.evidenceReview && item.evidenceReview.blocking !== false);
  }
  app.get("/v1/chats/:id/extraction-audits", (context) => context.json({items:readExtractionAudits(context.req.param('id'),context.req.query('view') === 'list')}));
  app.get("/v1/chats/:id/extraction-audits/:auditId", (context) => {
    const item=readExtractionAudits(context.req.param('id'),false,context.req.param('auditId'))[0];
    return item ? context.json(item) : context.json({error:'Extraction audit not found'},404);
  });
  app.post("/v1/chats/:id/small-reviews/resolve", async context => {
    const body = await context.req.json().catch(() => null);
    return withChatWrite(db, context.req.param('id'), () => {
      if (body?.action === 'retry') assertSourceSnapshotAccepted(db,context.req.param('id'));
      if (!body || !["keep", "keep_as_written", "keep_names", "hold", "discard", "retry"].includes(body.action) || !Array.isArray(body.items)
        || !body.items.length || !body.items.every((item: any) => item && typeof item.auditId === "string" && typeof item.candidateId === "string" && (item.sourceChoiceId === undefined || typeof item.sourceChoiceId === "string"))
        || body.items.length > 1 && !["hold", "discard", "keep_as_written"].includes(body.action)) return context.json({error: "후보와 처리 방법을 확인해 주세요."}, 400);
      try {
        const items = resolveSmallReviews(db, context.req.param("id"), body.items, body.action);
        if (body.action === "retry") serverWorker.wake();
        if (["keep", "keep_as_written", "keep_names"].includes(body.action) && items.some(item => item.status === "kept" && item.reason !== "unsupported_kind")) void embeddings.indexPending(context.req.param("id"));
        return context.json({items, ...(body.action === "keep_as_written" ? {counts: {
          kept:items.filter(item => item.status === "kept" && item.reason !== "unsupported_kind").length,
          pending:items.filter(item => item.status === "pending" && item.reason !== "unsupported_kind").length,
          missingSource:items.filter(item => item.reason === "source_location_missing").length,
          skipped:items.filter(item => item.reason === "unsupported_kind").length,
          stale:items.filter(item => item.status === "stale" && item.reason !== "unsupported_kind").length,
        }} : {})});
      } catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({error: error instanceof Error ? error.message : "후보를 처리하지 못했어요."}, 409);
      }
    });
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
  app.get('/v1/chats/:id/gap-recovery', context=>context.json(listGapRecovery(db,context.req.param('id'))));
  app.post('/v1/chats/:id/gap-recovery', context=>{
    return withChatWrite(db, context.req.param('id'), () => {
      try {
        const result=startGapRecovery(db,context.req.param('id'));
        if (result.jobs.length) serverWorker.wake();
        return context.json(result);
      } catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({error:error instanceof Error ? error.message : String(error),code:(error as {code?:string}).code},409);
      }
    });
  });
  app.post('/v1/chats/:id/memory-additions/sources', async (context) => {
    const body = await context.req.json() as { rangeIds?: unknown };
    if (!Array.isArray(body.rangeIds) || !body.rangeIds.every(id => typeof id === 'string')) return context.json({ error: '원문 구간을 확인해 주세요' }, 400);
    try { return context.json(additionSources(db, context.req.param('id'), body.rangeIds)); }
    catch (error: any) { return context.json({ error: error.message, code: error.code }, 409); }
  });
  for (const operation of ['preview', 'create'] as const) app.post(`/v1/chats/:id/memory-additions/${operation}`, async (context) => {
    const body = await context.req.json() as { rangeIds?: unknown; messageIds?: unknown; request?: unknown; postExtractionReview?: unknown; idempotencyKey?:unknown };
    const write = () => {
      if (!Array.isArray(body.rangeIds) || !body.rangeIds.every(id => typeof id === 'string') || !Array.isArray(body.messageIds) || !body.messageIds.every(id => typeof id === 'string')
        || typeof body.request !== 'string' || typeof body.postExtractionReview !== 'boolean'
        || body.idempotencyKey!==undefined && (typeof body.idempotencyKey!=='string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(body.idempotencyKey))) return context.json({ error: '메시지 선택과 요청을 확인해 주세요' }, 400);
      try {
        const chatId = context.req.param('id');
        if (operation === 'preview') return context.json(previewMemoryAddition(db, chatId, body.rangeIds, body.messageIds, body.request, body.postExtractionReview));
        const created = startMemoryAddition(db, chatId, body.rangeIds, body.messageIds, body.request, body.postExtractionReview,body.idempotencyKey as string|undefined);
        serverWorker.wake();
        return context.json(created, 202);
      } catch (error: any) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error.message, code: error.code }, 409);
      }
    };
    return operation === 'preview' ? write() : withChatWrite(db, context.req.param('id'), write);
  });
  for (const operation of ['apply', 'discard', 'retry'] as const) app.post(`/v1/chats/:id/memory-additions/:runId/${operation}`, (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
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
      } catch (error: any) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error.message, code: error.code }, 409);
      }
    });
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
    return withChatWrite(db, context.req.param('id'), () => {
      if (typeof body.excluded !== 'boolean') return context.json({ error: '제외 여부를 확인해 주세요' }, 400);
      try { return context.json(setMemoryExclusion(db,context.req.param('id'),context.req.param('messageId'),body.excluded)); }
      catch (error: any) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error.message, reason: error.message, code: error.code }, error.code === 'MESSAGE_NOT_FOUND' ? 404 : 409);
      }
    });
  });
  for (const operation of ['preview', 'start'] as const) app.post(`/v1/chats/:id/canonical-translation/${operation}`, async context => {
    const body = await context.req.json() as { memoryIds?: unknown };
    if (!Array.isArray(body.memoryIds) || !body.memoryIds.length || !body.memoryIds.every(id => typeof id === 'string' && id.length)) return context.json({ error: '기억을 선택해 주세요.' }, 400);
    const memoryIds = body.memoryIds as string[], chatId = context.req.param('id');
    const budget = { maxInputTokens: llmStore.config.maxInputTokens, maxOutputTokens: llmStore.config.maxOutputTokens, llmTimeoutMs: llmStore.config.llmTimeoutMs };
    try {
      if (operation === 'preview') return context.json(previewCanonicalTranslation(db, chatId, memoryIds, budget));
      return withChatWrite(db, chatId, () => {
        const result = startCanonicalTranslation(db, chatId, memoryIds, budget);
        serverWorker.wake();
        return context.json(result, 202);
      });
    } catch (error: any) {
      if (error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error.message, code: error.code }, 409);
    }
  });
  for (const operation of ['preview', 'create'] as const) app.post(`/v1/chats/:id/memory-groups/${operation}`, async (context) => {
    try {
      const body = await context.req.json() as { batchIds?: unknown; postExtractionReview?: unknown };
      const write = () => {
        if (!Array.isArray(body.batchIds) || !body.batchIds.every((id) => typeof id === 'string') || typeof body.postExtractionReview !== 'boolean') return context.json({ error: '묶음 ID와 재검수 선택을 확인해 줘' }, 400);
        const chatId = context.req.param('id');
        if (operation === 'preview') return context.json(previewMemoryGroup(db, chatId, body.batchIds, body.postExtractionReview));
        const result = startMemoryGroup(db, chatId, body.batchIds, body.postExtractionReview);
        serverWorker.wake();
        return context.json(result, 202);
      };
      return operation === 'preview' ? write() : withChatWrite(db, context.req.param('id'), write);
    } catch (error: any) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error.message, code: error.code }, 409);
    }
  });
  for (const operation of ['apply', 'ungroup', 'discard', 'retry'] as const) app.post(`/v1/chats/:id/memory-groups/:groupId/${operation}`, (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
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
      } catch (error: any) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error.message, code: error.code }, 409);
      }
    });
  });
  app.post("/v1/chats/:id/extraction-batches/:batchId/regenerate-episode", async (context) => {
    try {
      const body = await context.req.json().catch(() => ({})) as { postExtractionReview?: unknown };
      return withChatWrite(db, context.req.param('id'), () => {
        if (body.postExtractionReview !== undefined && typeof body.postExtractionReview !== "boolean") return context.json({ error: "postExtractionReview must be boolean" }, 400);
        const chat = db.prepare("SELECT post_extraction_review FROM chats WHERE id=?").get(context.req.param("id")) as { post_extraction_review: number } | undefined;
        if (!chat) return context.json({ error: "Chat not found" }, 404);
        const result = startEpisodeRegeneration(db, context.req.param("id"), context.req.param("batchId"), body.postExtractionReview === undefined ? chat.post_extraction_review !== 0 : body.postExtractionReview);
        serverWorker.wake();
        return context.json({ ok: true, ...result }, 202);
      });
    } catch (error: any) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error?.message ?? String(error), code: error?.code, ...(error?.rejectedItems ? {rejectedItems:error.rejectedItems} : {}) }, error?.code === "BATCH_NOT_FOUND" ? 404 : 409);
    }
  });
  app.post("/v1/chats/:id/extraction-batches/:batchId/regenerate-canonical", async (context) => {
    try {
      const body = await context.req.json().catch(() => ({})) as { postExtractionReview?: unknown };
      return withChatWrite(db, context.req.param('id'), () => {
        if (body.postExtractionReview !== undefined && typeof body.postExtractionReview !== "boolean") return context.json({ error: "postExtractionReview must be boolean" }, 400);
        const chat = db.prepare("SELECT post_extraction_review FROM chats WHERE id=?").get(context.req.param("id")) as { post_extraction_review: number } | undefined;
        if (!chat) return context.json({ error: "Chat not found" }, 404);
        const result = startCanonicalRegeneration(db, context.req.param("id"), context.req.param("batchId"), body.postExtractionReview === undefined ? chat.post_extraction_review !== 0 : body.postExtractionReview);
        serverWorker.wake();
        return context.json({ ok: true, ...result }, 202);
      });
    } catch (error: any) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error?.message ?? String(error), code: error?.code, ...(error?.rejectedItems ? {rejectedItems:error.rejectedItems} : {}) }, error?.code === "BATCH_NOT_FOUND" ? 404 : 409);
    }
  });
  app.get("/v1/chats/:id/regenerations/:runId", (context) => {
    try { return context.json(regenerationRun(db, context.req.param("id"), context.req.param("runId"))); }
    catch (error: any) { return context.json({ error: error?.message ?? String(error), code: error?.code }, 404); }
  });
  for (const operation of ['apply', 'apply-with-keep'] as const) app.post(`/v1/chats/:id/regenerations/:runId/${operation}`, async (context) => {
    try {
      const raw = await context.req.text();
      return withChatWrite(db, context.req.param('id'), () => {
        let body: unknown;
        try { body = raw.trim() ? JSON.parse(raw) : {}; }
        catch { return context.json({ error: 'Invalid JSON body' }, 400); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return context.json({ error: 'Expected an object body' }, 400);
        const requestedIds = (body as {keepLostItemIds?:unknown}).keepLostItemIds;
        const keepLostItemIds = requestedIds === undefined ? [] : requestedIds;
        if (!Array.isArray(keepLostItemIds) || keepLostItemIds.some(id => typeof id !== 'string' || !id.length)) return context.json({ error: 'keepLostItemIds must be an array of item IDs' }, 400);
        const mode = (regenerationRun(db, context.req.param("id"), context.req.param("runId")) as any).mode;
        const result = mode === "canonical_suffix"
          ? applyCanonicalRegeneration(db, context.req.param("id"), context.req.param("runId"), keepLostItemIds)
          : applyEpisodeRegeneration(db, context.req.param("id"), context.req.param("runId"), keepLostItemIds);
        void embeddings.indexPending(context.req.param("id"));
        return context.json({ ok: true, ...result });
      });
    } catch (error: any) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error?.message ?? String(error), code: error?.code, ...(error?.rejectedItems ? { rejectedItems: error.rejectedItems } : {}) }, 409);
    }
  });
  app.delete("/v1/chats/:id/regenerations/:runId", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      try { discardRegeneration(db, context.req.param("id"), context.req.param("runId")); return context.json({ ok: true }); }
      catch (error: any) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error?.message ?? String(error), code: error?.code }, 409);
      }
    });
  });
  app.post("/v1/chats/:id/extraction-audits/:auditId/retry", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
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
      if (readSmallReviews(retryDraft).length) return context.json({error: "작은 확인 목록에서 후보별로 다시 확인해 주세요."}, 409);
      const issues = inspectDraftEvidence(db, chatId, sourceMessageIds, retryDraft);
      const sourceRecovery = !evidenceReviewIsBlocking(originalJob?.status, originalPayload);
      const dialogueRecovery: DialogueRecoveryCandidate[] = [];
      // Already-applied state is not replayed to repair optional evidence.
      if (sourceRecovery && issues.some((issue) => issue.blocking)) return context.json({ error: "이미 적용된 상태의 근거는 개별 수정이 필요해요. 중복 누적을 막기 위해 전체 재시도를 하지 않았어요." }, 409);
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
              ? availableMemoryKey(memory.key,deletedMemoryKeys(db,chatId)) : scopeMemoryKey(memory.key,scopeId,deletedMemoryKeys(db,chatId));
            const parent = db.prepare("SELECT id FROM memories WHERE chat_id=? AND memory_key=? AND active=1").get(chatId, scopedKey) as {id: string} | undefined;
            recovery = { ref: `recovery:${memory.key}:${dialogueIndex}`, parentMemoryId: parent?.id, dialogue };
          }
          dialogueRecovery.push(recovery);
          // One frozen candidate per shell keeps identity stable when siblings are removed.
          memories.push({ ...memory, key: recovery.ref, details: [], landmarkKinds: [], associations: [], keyDialogues: [dialogue] });
        }
        if (!passages.length && !dialogueRecovery.length) return context.json({ error: "자동으로 다시 확인할 발췌가 없어요. 보류된 항목의 진단을 확인해 주세요." }, 409);
        retryDraft = { language: retryDraft.language, entities: [], memories, stateObservations: [], sourcePassages: passages };
      }
      const timestamp = Date.now();
      const jobId = randomUUID();
      db.transaction(() => {
        db.prepare(`INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'audit_retry','queued',?,0,?,?)`)
          .run(jobId, chatId, JSON.stringify({ ...originalPayload, promptContract: originalPayload.promptContract ?? null, sourceMessageIds, sourceFingerprint: expectedFingerprint, auditDraft: retryDraft, sourceRecovery, sourceRecoveryMetadata: sourceRecovery ? { targets: expectedFingerprint.map(({ messageId, ordinal }) => ({ messageId, ordinal })), matchKinds: originalPayload.sourceRecoveryMetadata?.matchKinds ?? [] } : undefined, dialogueRecovery, trigger: 'retry', retryOfAuditId: audit.id, retryOfJobId: audit.job_id, llmCallStats: { total: 0, repairs: 0, byPurpose: {} }, postExtractionReview: true }), timestamp, timestamp);
      })();
      serverWorker.wake();
      return context.json({ ok: true, jobId });
    });
  });

  app.get("/v1/chats/:id/pair-progress", (context) => {
    const chatId = context.req.param("id");
    if (!db.prepare("SELECT 1 FROM chats WHERE id=?").get(chatId)) return context.json({ error: "Chat not found" }, 404);
    if (!chatUpgradeLock(db,chatId)) writePersonaHint(db, chatId, context.req.query("userPersonaName"));
    const result = pairProgressResponse(db, chatId);
    const persona=context.req.query("persona"), character=context.req.query("character");
    if (persona && character) result.items = result.items.filter(p=>p.persona===persona&&p.character===character);
    return context.json(result);
  });
  app.post("/v1/chats/:id/pair-progress", async (context) => {
    const schema=z.object({persona:z.string().min(1),character:z.string().min(1),action:z.discriminatedUnion("kind",[
      z.object({kind:z.literal("cell"),itemId:z.string().min(1),side:z.string().min(1),state:z.enum(["done","not_yet"])}),
      z.object({kind:z.literal("remaining_not_yet")}),
      z.object({kind:z.literal("add"),label:z.string().trim().min(1).max(120),mode:z.enum(["each","mutual"])}),
      z.object({kind:z.enum(["remove","hide","restore"]),itemId:z.string().min(1)}),
    ])});
    try {
      const input=schema.parse(await context.req.json());
      return withChatWrite(db, context.req.param('id'), () => {
        const result=db.transaction(()=>editPairProgress(db,context.req.param("id"),input.persona,input.character,input.action))();
        db.prepare("UPDATE chats SET revision=revision+1 WHERE id=?").run(context.req.param("id"));
        return context.json(result);
      });
    } catch(error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({error:error instanceof Error?error.message:"Invalid progress request"},400);
    }
  });

  app.get("/v1/chats/:id/view-preferences", (context) => context.json(readViewPreferences(db, context.req.param("id"))));
  app.put("/v1/chats/:id/view-preferences", async (context) => {
    try {
      const body = await context.req.json();
      return withChatWrite(db, context.req.param('id'), () => {
        const result = writeViewPreferences(db, context.req.param("id"), body);
        markChatEngaged(db, context.req.param("id"));
        return context.json(result);
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      if (error instanceof SyntaxError || error instanceof InvalidViewPreferencesPatchError) {
        return context.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  function userOnlyRetryMemoriesSql(): string {
    // Folded retries retain frozen keys after ownership moves to the parent.
    return `user_only_retry_batches AS MATERIALIZED (
        SELECT b.id,b.chat_id,b.final_json FROM extraction_batches b LEFT JOIN jobs j ON j.id=b.job_id AND j.chat_id=b.chat_id
        WHERE b.chat_id=? AND (
          json_extract(j.payload_json,'$.coverageParentJobId') IS NOT NULL OR EXISTS (
            SELECT 1 FROM server_meta meta,json_each(meta.value) family
            WHERE meta.key='source_coverage_family:'||b.chat_id AND family.key=b.id))
          AND json_array_length(b.source_message_ids_json)>0 AND NOT EXISTS (
            SELECT 1 FROM json_each(b.source_message_ids_json) source LEFT JOIN messages msg ON msg.chat_id=b.chat_id AND msg.message_id=source.value
            WHERE msg.role IS NOT 'user')
      ), user_only_retry_keys AS MATERIALIZED (
        SELECT json_extract(memory.value,'$.key') memory_key FROM user_only_retry_batches b,json_each(b.final_json,'$.memories') memory
      ), user_only_retry_memories AS MATERIALIZED (
      SELECT m.id FROM memories m WHERE m.chat_id IN (SELECT chat_id FROM user_only_retry_batches) AND (
        EXISTS (SELECT 1 FROM user_only_retry_batches b WHERE b.id=m.source_batch_id)
        OR EXISTS (SELECT 1 FROM user_only_retry_keys k WHERE k.memory_key=m.memory_key))
    )`;
  }

  function readDashboardMemories(chatId: string) {
    const bookmarks = readMemoryBookmarks(db, chatId);
    const items = db.prepare(`
      WITH ${userOnlyRetryMemoriesSql()}
      SELECT m.id,m.card_shape AS cardShape,m.memory_key AS memoryKey,${recognitionOnlyMemorySql('m')} AS recognitionOnly,m.type,m.title,m.content,m.participants_json,m.known_by_json,m.perspective,m.story_time,m.story_time_normalized,m.locations_json,m.landmark,m.landmark_kinds_json,m.evidence_json,
        m.salience,m.strength,m.recall_count,m.pinned,m.always_inject,m.active,m.capsule_parent_id,m.source_batch_id AS sourceBatchId,m.user_managed AS userManaged,m.created_revision,m.created_at,m.updated_at,
        EXISTS (SELECT 1 FROM user_only_retry_memories retry WHERE retry.id=m.id) AS userOnlyRetry,
        (SELECT MIN(msg.ordinal) FROM evidence_spans e JOIN messages msg ON msg.chat_id=e.chat_id AND msg.message_id=e.message_id WHERE e.memory_id=m.id) AS source_ordinal,
        (SELECT MAX(msg.ordinal) FROM evidence_spans e JOIN messages msg ON msg.chat_id=e.chat_id AND msg.message_id=e.message_id WHERE e.memory_id=m.id) AS source_end_ordinal,
        (SELECT msg.event_time FROM evidence_spans e JOIN messages msg ON msg.chat_id=e.chat_id AND msg.message_id=e.message_id WHERE e.memory_id=m.id ORDER BY msg.ordinal LIMIT 1) AS source_event_time
      FROM memories m WHERE m.chat_id=? ORDER BY CASE WHEN source_ordinal IS NULL THEN 0 ELSE 1 END,CASE WHEN source_ordinal IS NULL THEN m.created_at END DESC,source_ordinal DESC,m.created_revision DESC
    `).all(chatId,chatId) as Array<Record<string, unknown> & { id: string }>;
    const dialogueQuery = db.prepare("SELECT id,speaker,text,message_id AS messageId,evidence_json AS evidence,kind FROM memory_dialogues WHERE memory_id=? ORDER BY ordinal");
    const detailRows = db.prepare(`SELECT memory_id,id,detail_key AS key,kind,role,original_kind,text,participants_json AS participants,known_by_json AS knownBy,hidden_from_json AS hiddenFrom,seed_json AS seed,locations_json AS locations,
      user_edited AS userEdited,user_hidden AS hidden,epistemic,salience,retention_class AS retention,evidence_json AS evidence,source_start_ordinal AS sourceOrdinal
      FROM memory_details WHERE chat_id=? AND active=1 ORDER BY COALESCE(source_start_ordinal,2147483647),created_at,rowid`).all(chatId) as Array<Record<string, any>>;
    // The old per-memory table scan resolved equal sort keys in rowid order.
    const detailsByMemory = new Map<string, Array<Record<string, any>>>();
    for (const { memory_id, ...detail } of detailRows) {
      const details = detailsByMemory.get(memory_id) ?? [];
      details.push(detail);
      detailsByMemory.set(memory_id, details);
    }
    const alwaysInject=alwaysInjectEstimate(db,chatId);
    const alwaysTokens=new Map(alwaysInject.items.map(item=>[item.memoryId,item]));
    return { alwaysInject, items: items.map((item) => {
      let locations: string[] = [];
      let participants: string[] = [];
      let knownBy: string[] = [];
      let landmarkKinds: unknown[] = [];
      try { locations = JSON.parse(String(item.locations_json ?? "[]")) as string[]; } catch { locations = []; }
      try { participants = JSON.parse(String(item.participants_json ?? "[]")) as string[]; } catch { participants = []; }
      try { knownBy = JSON.parse(String(item.known_by_json ?? "[]")) as string[]; } catch { knownBy = []; }
      try { landmarkKinds = JSON.parse(String(item.landmark_kinds_json ?? "[]")) as unknown[]; } catch { landmarkKinds = []; }
      const evidence = JSON.parse(String(item.evidence_json ?? "[]")) as Array<{ messageId?: string; quote?: string }>;
      const messageIds = [...new Set(evidence.flatMap(source => source.messageId ? [source.messageId] : []))];
      const { locations_json: _locationsJson, landmark_kinds_json: _landmarkKindsJson, evidence_json: _evidenceJson, ...rest } = item;
      rest.recognitionOnly = Boolean(item.recognitionOnly);
      rest.userOnlyRetry = Boolean(item.userOnlyRetry);
      const episode = db.prepare("SELECT id,status,resolution,source_tokens FROM episodes WHERE memory_id=? LIMIT 1").get(item.id) as any;
      const sections = episode ? db.prepare("SELECT id,ordinal,title,summary,source_message_ids_json AS sourceMessageIds,key_dialogues_json AS keyDialogues FROM episode_sections WHERE episode_id=? ORDER BY ordinal").all(episode.id).map((section: any) => ({
        ...section,
        sourceMessageIds: JSON.parse(section.sourceMessageIds || "[]"),
        keyDialogues: JSON.parse(section.keyDialogues || "[]"),
      })) : [];
      const details = (detailsByMemory.get(item.id) ?? []).map((detail) => {
        const access = memoryDetailAccess(db, chatId, detail.id);
        return { ...detail, userEdited:detail.userEdited===1,hidden:detail.hidden===1, access, participants: JSON.parse(detail.participants || "[]"), knownBy: access.holders.map(holder => holder.name),
          hiddenFrom: JSON.parse(detail.hiddenFrom || "[]"), seed: readStorySeed(detail.seed),
          locations: JSON.parse(detail.locations || "[]"), evidence: JSON.parse(detail.evidence || "[]") };
      });
      const keyDialogues = (dialogueQuery.all(item.id) as Array<Record<string,any>>).map(dialogue => ({...dialogue,access:memoryDetailAccess(db,chatId,dialogue.id,"dialogue"),evidence:JSON.parse(dialogue.evidence)}));
      return { ...rest,
        // Message-only provenance also lets older readers fall back to their source-message view.
        evidence_json: JSON.stringify(messageIds.map(messageId => ({ messageId }))),
        evidenceSummary: { messageCount: messageIds.length, quoteCount: evidence.length, hasMissingQuotes: evidence.some(source => !source.quote) },
        access: memoryDetailAccess(db, chatId, String(item.id), "memory"), known_by_json: JSON.stringify(publicKnowledgeScope(knownBy).knownBy), participants, ...publicKnowledgeScope(knownBy), locations, landmarkKinds, landmark: item.landmark === 1, pinned: item.pinned === 1,
        alwaysInject:item.always_inject===1,alwaysInjectEstimatedTokens:alwaysTokens.get(item.id)?.estimatedTokens ?? 0,alwaysInjectChargedTokens:alwaysTokens.get(item.id)?.chargedTokens ?? 0,
        active: item.active === 1, bookmarked: bookmarks.has(item.id), keyDialogues, details, detailCount: details.filter(detail => !detail.hidden).length, episode, sections };
    }) };
  }
  for (const kind of ['detail','event'] as const) app.patch(`/v1/chats/:id/memories/:memoryId/${kind === 'detail' ? 'details' : 'events'}/:lineId`, async context => {
    const body = await context.req.json();
    return withChatWrite(db, context.req.param('id'), () => {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['text','hidden'].includes(key))
        || (body.text === undefined && body.hidden === undefined) || (body.text !== undefined && (typeof body.text !== 'string' || !body.text.trim()))
        || (body.hidden !== undefined && typeof body.hidden !== 'boolean')) return context.json({error:'Expected non-empty text and/or boolean hidden'},400);
      const chatId=context.req.param('id'), memoryId=context.req.param('memoryId'), id=context.req.param('lineId');
      const item=patchMemoryLine(db,chatId,memoryId,id,kind,body);
      if (!item) return context.json({error:'Active memory line not found'},404);
      if (kind==='detail') embeddings.removeDetail(id);
      void embeddings.indexPending(chatId);
      return context.json(item);
    });
  });
  app.get("/v1/chats/:id/memories", (context) => context.json(readDashboardMemories(context.req.param("id"))));
  app.get("/v1/chats/:id/memories/:memoryId/evidence", context => {
    const memory = db.prepare("SELECT evidence_json,updated_at FROM memories WHERE chat_id=? AND id=?")
      .get(context.req.param("id"), context.req.param("memoryId")) as { evidence_json: string; updated_at: number } | undefined;
    if (!memory) return context.json({ error: "Memory not found in this chat" }, 404);
    // Preserve storage order: existing translation keys address these exact indexes.
    return context.json({ items: JSON.parse(memory.evidence_json), updatedAt: memory.updated_at });
  });
  app.get("/v1/chats/:id/messages", (context) => context.json({ items: db.prepare(`
    SELECT message_id,role,ordinal,content,CASE WHEN canonical_hash<>'' THEN canonical_content END AS canonical_content,lifecycle,host_visibility,visible,event_time,generation_id,extraction_state,updated_at
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
        d.known_by_json AS knownBy,d.hidden_from_json AS hiddenFrom,d.seed_json AS seed,d.locations_json AS locations,d.epistemic,d.salience,d.retention_class AS retention,
        d.evidence_json AS evidence,d.source_start_ordinal AS sourceOrdinal,bm25(memory_detail_fts) AS rank
        FROM memory_detail_fts JOIN visible_memory_details d ON d.id=memory_detail_fts.detail_id
        JOIN memories m ON m.id=d.memory_id AND m.active=1
        WHERE memory_detail_fts MATCH ? AND memory_detail_fts.chat_id=? AND d.active=1
          AND NOT ${recognitionOnlyMemorySql('m')} AND NOT ${recognitionDetailSql('d')}
        ORDER BY rank LIMIT ?`).all(match, chatId, limit) as Array<Record<string, any>>;
      return context.json({ items: rows.map((row) => {
        const access = memoryDetailAccess(db, chatId, row.id);
        return { ...row, access, participants: JSON.parse(row.participants || "[]"), knownBy: access.holders.map(holder => holder.name),
          hiddenFrom: JSON.parse(row.hiddenFrom || "[]"), seed: readStorySeed(row.seed),
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
      const source = db.prepare("SELECT role,ordinal,CASE WHEN canonical_hash<>'' THEN canonical_content ELSE content END AS content,lifecycle,host_visibility AS hostVisibility FROM messages WHERE chat_id=? AND message_id=?").get(chatId, item.messageId) as Record<string, any> | undefined;
      return { ...item, source: source ? { ...source, messageId: item.messageId } : null };
    });
    return context.json({ explicitEvidence: true, items });
  });
  app.delete("/v1/chats/:id/messages/:messageId", (context) => withChatWrite(db, context.req.param('id'), () => context.json({
    ok: hardDeleteMessage(db, context.req.param("id"), context.req.param("messageId")),
  })));
  app.put("/v1/admin/chat-work", async context => {
    const schema = CharacterWorkRequestSchema.omit({enabled:true}).required({defaultChatEnabled:true}).extend({
      current: z.object({chatId:z.string().min(1),characterId:z.string().min(1),characterChanged:z.boolean(),chatChanged:z.boolean()}).optional(),
    });
    const parsed = schema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({error:"Invalid chat work settings"},400);
    const {current,chatEnabled,characterEnabled,defaultChatEnabled,cancelUpgrade} = parsed.data;
    const applied = db.transaction(() => {
      const targets = new Map<string,boolean>();
      const include = (id:string, character:string) => targets.set(id, characterEnabled?.[character] !== false && (chatEnabled?.[id] ?? defaultChatEnabled));
      for (const chat of workChats()) {
        if (!Object.hasOwn(chatEnabled ?? {},chat.id) || (current?.characterChanged && chat.character_id === current.characterId)) include(chat.id,chat.character_id);
      }
      if (current) include(current.chatId,current.characterId);
      const settings = Object.fromEntries(targets);
      syncChatWork({chatEnabled:settings,cancelUpgrade});
      if (current?.chatChanged) markChatEngaged(db,current.chatId);
      return settings;
    })();
    return context.json({chatEnabled:applied});
  });
  app.put("/v1/characters/:id/work", async context => {
    const body = CharacterWorkRequestSchema.safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: "Invalid character work settings" }, 400);
    const characterId = context.req.param("id");
    const chatIds = syncChatWork({ ...body.data, characterEnabled: { [characterId]: body.data.enabled } }, characterId);
    for (const chatId of chatIds) markChatEngaged(db, chatId);
    return context.json({ ok: true, chatIds });
  });
  app.put("/v1/chats/:id/work", async context => {
    const body = z.object({ enabled: z.boolean(), cancelUpgrade: z.boolean().optional() }).safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: "enabled must be boolean" }, 400);
    const chatId = context.req.param("id");
    const wasHeld = isChatWorkHeld(db, chatId);
    if (!body.data.enabled) checkWorkOff([chatId],body.data.cancelUpgrade === true);
    setChatWorkEnabled(db, chatId, body.data.enabled);
    markChatEngaged(db, chatId);
    if (body.data.enabled && wasHeld) { serverWorker.wake(); void embeddings.indexPending(chatId); }
    return context.json({ ok: true, worker: serverWorker.statusForChat(chatId) });
  });
  app.patch("/v1/chats/:id", async (context) => {
    const body = await context.req.json() as { profile?: unknown; includeUserMessages?: unknown; memoryLanguage?: unknown; memoryLanguageSource?: unknown; clearPendingMemoryLanguage?: unknown; backfill?: boolean; extractionReviewOverride?: unknown };
    return withChatWrite(db, context.req.param('id'), () => {
      const chatId = context.req.param("id");
      const previous = db.prepare("SELECT profile,include_user_messages,memory_language,pending_memory_language FROM chats WHERE id=?").get(chatId) as { profile: string; include_user_messages: number; memory_language: string; pending_memory_language: string | null } | undefined;
      if (!previous) return context.json({ error: "Chat not found" }, 404);
      if (body.includeUserMessages !== undefined && typeof body.includeUserMessages !== "boolean") return context.json({ error: "includeUserMessages must be boolean" }, 400);
      if (body.extractionReviewOverride !== undefined && typeof body.extractionReviewOverride !== "boolean") return context.json({ error: "extractionReviewOverride must be boolean" }, 400);
      const profile = body.profile === undefined ? RpProfileSchema.parse(previous.profile) : RpProfileSchema.parse(body.profile);
      const includeUserMessages = body.includeUserMessages === undefined ? previous.include_user_messages === 1 : body.includeUserMessages === true;
      const clearPendingMemoryLanguage = z.boolean().optional().parse(body.clearPendingMemoryLanguage);
      const memoryLanguageSource = TurnPrepareRequestSchema.shape.memoryLanguageSource.parse(body.memoryLanguageSource);
      const memoryLanguage = body.memoryLanguage === undefined ? undefined : MemoryLanguageSchema.parse(body.memoryLanguage);
      const shouldBackfill = body.backfill === true && body.profile !== undefined && previous.profile === "companion" && profile === "simulation";
      if (body.profile === undefined && body.includeUserMessages === undefined && memoryLanguage === undefined && !clearPendingMemoryLanguage) return context.json({ error: "No supported changes" }, 400);
      db.transaction(() => {
        markChatEngaged(db, chatId);
        db.prepare("UPDATE chats SET profile=?,include_user_messages=?,updated_at=? WHERE id=?").run(profile, includeUserMessages ? 1 : 0, Date.now(), chatId);
        if (clearPendingMemoryLanguage) db.prepare("UPDATE chats SET pending_memory_language=NULL WHERE id=?").run(chatId);
        else if (memoryLanguage !== undefined && memoryLanguageSource !== "default") {
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
  });
  app.put("/v1/chats/:id/title", async (context) => {
    const body = await context.req.json() as { chatTitle?: unknown };
    return withChatWrite(db, context.req.param('id'), () => {
      const chatTitle = typeof body.chatTitle === "string" ? body.chatTitle.trim().slice(0, 240) : "";
      if (!chatTitle) return context.json({ error: "chatTitle is required" }, 400);
      return syncChatTitle(db,context.req.param('id'),chatTitle) ? context.json({ ok: true, chatTitle }) : context.json({ error: "Chat not found" }, 404);
    });
  });
  app.post("/v1/chats/:id/memories", async (context) => {
    const chatId = context.req.param("id");
    const body = await context.req.json() as {
      title?: unknown; content?: unknown; storyTime?: unknown; participants?: unknown; landmarkKinds?: unknown;
    };
    return withChatWrite(db, context.req.param('id'), () => {
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
      const parsedLandmarks = StoredLandmarkKindSchema.array().max(12).safeParse(landmarks);
      if (!parsedLandmarks.success) return context.json({ error: "Invalid landmarkKinds", issues: parsedLandmarks.error.issues }, 400);
      const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
      if (!chat) return context.json({ error: "Chat not found" }, 404);
      const id = randomUUID();
      const timestamp = Date.now();
      const memoryKey = availableMemoryKey(`manual:${id}`,deletedMemoryKeys(db,chatId));
      db.prepare(`INSERT INTO memories(
      id,chat_id,memory_key,type,title,content,participants_json,known_by_json,perspective,story_time,story_time_normalized,locations_json,
      landmark,landmark_kinds_json,evidence_json,salience,strength,retention_class,atom_access_version,source_batch_id,user_managed,
      created_revision,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,1,?,?,?)`).run(
        id, chatId, memoryKey, parsedLandmarks.data.length ? "relationship" : "episode", title, content,
        JSON.stringify(participants), JSON.stringify(participants), null, storyTime || null, normalizeStoryTime(storyTime) ?? null, "[]",
        parsedLandmarks.data.length ? 1 : 0, JSON.stringify(parsedLandmarks.data.map(clipLandmarkDisplayText)), "[]", .7, .7,
        parsedLandmarks.data.length ? "durable" : "arc", 0, chat.revision, timestamp, timestamp,
      );
      refreshMemoryFts(db, id);
      refreshMemoryParticipantCounts(db, chatId, id);
      void embeddings.indexPending(chatId);
      return context.json({ ok: true, id, memoryKey }, 201);
    });
  });
  for (const [kind, route] of [
    ["detail", "/memories/:memoryId/details/:detailId/access"],
    ["dialogue", "/memories/:memoryId/dialogues/:detailId/access"],
    ["memory", "/memories/:detailId/access"],
    ["promise", "/promises/:detailId/access"],
    ["physical_milestone", "/physical-intimacy/:detailId/access"],
  ] as const) app.put(`/v1/chats/:id${route}`, async (context) => {
    const chatId = context.req.param("id"), memoryId = context.req.param("memoryId"), detailId = context.req.param("detailId");
    const body = z.object({ holders: z.array(z.string().trim().min(1)), everyone: z.boolean().default(false), bases: z.record(z.string().trim(), ItemAccessBasisSchema),
      speaker: kind === "dialogue" ? z.string().trim().min(1).optional() : z.never().optional() }).safeParse(await context.req.json());
    return withChatWrite(db, context.req.param('id'), () => {
      if (!body.success) return context.json({ error: "Provide character names and a valid knowledge basis for each holder", issues: body.error.issues }, 400);
      const detail: { evidence_json: string; speaker?: string } | undefined = (kind === "detail" || kind === "dialogue")
        ? db.prepare(`SELECT d.evidence_json${kind === "dialogue" ? ",d.speaker" : ""} FROM ${kind === "detail" ? "memory_details" : "memory_dialogues"} d JOIN memories m ON m.id=d.memory_id AND m.chat_id=d.chat_id
        WHERE d.chat_id=? AND d.memory_id=? AND d.id=? ${kind === "detail" ? "AND d.active=1" : ""}`).get(chatId, memoryId, detailId) as { evidence_json: string; speaker?: string } | undefined
        : kind === "promise"
          ? db.prepare(`SELECT COALESCE((SELECT evidence_json FROM promise_events WHERE chat_id=p.chat_id AND promise_id=p.id ORDER BY created_revision DESC,created_at DESC LIMIT 1),
          (SELECT evidence_json FROM memories WHERE chat_id=p.chat_id AND id=p.source_memory_id),'[]') AS evidence_json FROM promises p WHERE chat_id=? AND id=?`).get(chatId, detailId) as { evidence_json: string } | undefined
          : db.prepare(`SELECT evidence_json FROM ${kind === "memory" ? "memories" : "physical_intimacy_milestones"} WHERE chat_id=? AND id=? AND active=1`).get(chatId, detailId) as { evidence_json: string } | undefined;
      if (!detail) return context.json({ error: "Memory atom not found in this chat and memory" }, 404);
      const resolve = buildEntityIdentityResolver(db, chatId);
      const names = new Set(listEntities(db, chatId).filter(entity => isPersonEntityType(entity.type)).map(entity => entity.name));
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
      const speaker = kind === "dialogue" ? body.data.speaker : undefined;
      const speakerChanged = speaker !== undefined && speaker !== detail.speaker;
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
        if (kind === "memory") db.prepare("UPDATE memories SET known_by_json=?,updated_at=? WHERE chat_id=? AND id=?")
          .run(JSON.stringify(holders), timestamp, chatId, detailId);
        if (kind === "detail") {
          syncDetailKnownBy(db, chatId, detailId);
          db.prepare("UPDATE memory_details SET updated_at=? WHERE chat_id=? AND id=?").run(timestamp, chatId, detailId);
        }
        if (speakerChanged) {
          db.prepare("UPDATE memory_dialogues SET speaker=? WHERE chat_id=? AND id=?").run(speaker, chatId, detailId);
          db.prepare("UPDATE memories SET updated_at=? WHERE chat_id=? AND id=?").run(timestamp, chatId, memoryId);
          refreshMemoryFts(db, memoryId!);
          renewMemoryEpoch(db, chatId);
        }
        // Story atoms carry holder scope, not the acquisition basis.
        if (accessChanged || speakerChanged) invalidateStorySupports(db, chatId, new Set([`${kind}:${detailId}`]));
      })();
      // Contextual detail group fingerprints include access: regroup through the existing indexer.
      if (accessChanged || speakerChanged) void embeddings.indexPending(chatId);
      const access = memoryDetailAccess(db, chatId, detailId, kind);
      return context.json({ ok: true, access, knownBy: access.holders.map(holder => holder.name),
        ...(kind === "dialogue" ? { speaker: speaker ?? detail.speaker } : {}) });
    });
  });
  app.patch("/v1/chats/:id/memories/:memoryId", async (context) => {
    const body = await context.req.json() as Record<string, unknown>;
    return withChatWrite(db, context.req.param('id'), () => {
      const allowed = ["title", "content", "salience", "strength", "pinned", "alwaysInject", "active", "storyTime", "locations", "landmark", "landmarkKinds", "participants"] as const;
      let updates = allowed.filter((key) => body[key] !== undefined);
      const bookmarkUpdate = body.bookmarked !== undefined;
      if (updates.length === 0 && !bookmarkUpdate) return context.json({ error: "No supported changes" }, 400);
      if (bookmarkUpdate && typeof body.bookmarked !== "boolean") return context.json({ error: "bookmarked must be boolean" }, 400);
      if (body.alwaysInject!==undefined && typeof body.alwaysInject!=='boolean') return context.json({error:'alwaysInject must be boolean'},400);
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
      const parsedLandmarks = body.landmarkKinds === undefined ? undefined : StoredLandmarkKindSchema.array().max(12).safeParse(body.landmarkKinds);
      if (parsedLandmarks && !parsedLandmarks.success) return context.json({ error: "Invalid landmarkKinds", issues: parsedLandmarks.error.issues }, 400);
      const columns: Record<(typeof allowed)[number], string> = { title: "title", content: "content", salience: "salience", strength: "strength", pinned: "pinned", alwaysInject:'always_inject', active: "active", storyTime: "story_time", locations: "locations_json", landmark: "landmark", landmarkKinds: "landmark_kinds_json", participants: "participants_json" };
      let values = updates.map((key) => key === "pinned" || key === 'alwaysInject' || key === "active" || key === "landmark"
        ? (body[key] ? 1 : 0)
        : key === "participants" ? JSON.stringify(participants) : key === "locations" ? JSON.stringify(body[key])
          : key === "landmarkKinds" ? JSON.stringify((parsedLandmarks?.data ?? []).map(clipLandmarkDisplayText))
          : key === "storyTime" ? (body.storyTime || null)
            : key === "salience" || key === "strength" ? normalizeUnitScore(Number(body[key])) : body[key]);
      const chatId = context.req.param("id");
      const memoryId = context.req.param("memoryId");
      const result = db.transaction(() => {
        const previous = db.prepare("SELECT * FROM memories WHERE id=? AND chat_id=?").get(memoryId, chatId) as Record<string, any> | undefined;
        if (!previous) return 0;
        const changed = updates.map((key,index) => ({key,value:values[index]})).filter(({key,value}) => {
          const stored = previous[columns[key]];
          return value !== (columns[key].endsWith('_json') ? JSON.stringify(JSON.parse(stored)) : stored);
        });
        updates = changed.map(item => item.key);
        values = changed.map(item => item.value);
        if (updates.length > 0) {
          const normalizedUpdate = updates.includes("storyTime") ? ",story_time_normalized=?" : "";
          const authored = updates.includes('content') || updates.includes('active') && body.active === false;
          db.prepare(`UPDATE memories SET ${updates.map((key) => `${columns[key]}=?`).join(",")}${normalizedUpdate}${authored?',user_managed=1':''},updated_at=? WHERE id=? AND chat_id=?`).run(
            ...values, ...(updates.includes("storyTime") ? [normalizeStoryTime(body.storyTime) ?? null] : []), Date.now(), memoryId, chatId,
          );
          rememberMemoryPreferenceFields(db,chatId,memoryId,[...updates.map(key=>columns[key]),...(updates.includes('storyTime')?['story_time_normalized']:[])]);
          if (participants !== undefined) {
            const memory = db.prepare("SELECT memory_key FROM memories WHERE id=?").get(memoryId) as { memory_key: string };
            if (memory.memory_key.startsWith("manual:") && !readDetailAccessEdits(db,chatId).has(memoryId)) db.prepare("UPDATE memories SET known_by_json=? WHERE id=?").run(JSON.stringify(participants), memoryId);
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
        if (bookmarkUpdate && readMemoryBookmarks(db,chatId).has(memoryId) !== body.bookmarked) setMemoryBookmark(db, chatId, memoryId, body.bookmarked === true);
        return 1;
      })();
      if (result === 1 && updates.length > 0) {
        if (body.active === false) embeddings.removeMemory(memoryId);
        else if (updates.includes("title") || updates.includes("content") || updates.includes("locations") || updates.includes("landmarkKinds") || body.active === true) void embeddings.indexPending(chatId);
      }
      return result === 1
        ? context.json({ ok: true,alwaysInject:alwaysInjectEstimate(db,chatId) })
        : context.json({ error: "Memory not found" }, 404);
    });
  });
  app.delete("/v1/chats/:id/memories/:memoryId", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      const chatId = context.req.param("id");
      const memoryId = context.req.param("memoryId");
      const result = db.transaction(() => {
        rememberMemoryDeletion(db,chatId,memoryId);
        const userOnlyRetry = !!db.prepare(`WITH ${userOnlyRetryMemoriesSql()}
          SELECT 1 FROM user_only_retry_memories WHERE id=?`).get(chatId,memoryId);
        const supports=(userOnlyRetry ? storyMemoryCascadeSupportIds : storyMemorySupportIds)(db,chatId,[memoryId]);
        db.prepare("DELETE FROM memory_fts WHERE memory_id=? AND chat_id=?").run(memoryId, chatId);
        const deleted = db.prepare("DELETE FROM memories WHERE id=? AND chat_id=?").run(memoryId, chatId).changes;
        if (deleted === 1) {
          pruneDetailAccessEdits(db, chatId);
          setMemoryBookmark(db, chatId, memoryId, false);
          if (userOnlyRetry) detachRetryStorySupports(db,chatId,supports);
          else invalidateStorySupports(db,chatId,supports);
        }
        return deleted;
      })();
      if (result === 1) embeddings.removeMemory(memoryId);
      return context.json({ ok: result === 1 });
    });
  });
  function readDashboardRelationships(chatId: string) {
    const events = (db.prepare(`SELECT id,from_entity AS "from",to_entity AS "to",changes_json AS changes,reason,evidence_json AS evidence,
      user_edited AS userEdited,user_hidden AS hidden,source_memory_id AS sourceMemoryId,source_detail_id AS sourceDetailId,source_start_ordinal AS sourceOrdinal,created_revision AS createdRevision
      FROM relationship_events WHERE chat_id=? AND active=1 ORDER BY COALESCE(source_start_ordinal,2147483647),created_at`).all(chatId) as Array<Record<string, any>>)
      .map((event) => ({ ...event, userEdited:event.userEdited===1,hidden:event.hidden===1, changes: JSON.parse(event.changes || "[]"), evidence: JSON.parse(event.evidence || "[]") }));
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
    return context.json({ items: items.map((item) => ({ ...item, autoInject: item.autoInject === 1, manualOverride: item.manualOverride === 1, access: memoryDetailAccess(db, context.req.param("id"), item.id, "physical_milestone") })) });
  });
  app.post("/v1/chats/:id/physical-intimacy", async (context) => {
    const chatId = context.req.param("id");
    const body = await context.req.json() as { participantA?: string; participantB?: string; act?: string; customLabel?: string; initiator?: string; interactionContext?: string; circumstance?: string; sourceMessageId?: string; autoInject?: boolean };
    return withChatWrite(db, context.req.param('id'), () => {
      const participantA = body.participantA?.trim() ?? "";
      const participantB = body.participantB?.trim() ?? "";
      const act = body.act?.trim() ?? "";
      const customLabel = body.customLabel?.trim() || null;
      const allowedActs = new Set(["hand_holding", "embrace", "cuddling", "forehead_kiss", "cheek_kiss", "hand_kiss", "lip_kiss", "deep_kiss", "sexual_touch", "manual_sex", "oral_sex", "vaginal_sex", "anal_sex", "other"]);
      if (!participantA || !participantB || participantA.localeCompare(participantB, undefined, { sensitivity: "base" }) === 0) return context.json({ error: "서로 다른 참여자 두 명을 선택해 주세요." }, 400);
      if (!allowedActs.has(act) || (act === "other" && !customLabel)) return context.json({ error: "스킨십 종류를 확인해 주세요." }, 400);
      const contextValue = ["mutual", "initiated", "coerced", "nonconsensual", "ambiguous"].includes(body.interactionContext ?? "") ? body.interactionContext! : "ambiguous";
      const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
      if (!chat) return context.json({ error: "Chat not found" }, 404);
      const source = body.sourceMessageId
        ? db.prepare("SELECT message_id,ordinal FROM messages WHERE chat_id=? AND message_id=? AND memory_excluded=0 AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')").get(chatId, body.sourceMessageId) as { message_id: string; ordinal: number } | undefined
        : undefined;
      if (body.sourceMessageId && !source) return context.json({ error: "연결할 수 있는 활성 원문을 찾지 못했어요." }, 400);
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
          replaceItemAccess(db, chatId, "physical_milestone", id, pair.map(holder => ({ holder, basis: "experienced",
            evidence: source ? [{ messageId: source.message_id }] : [], confidence: 1 })), revision, Date.now());
          inserted.push(id);
        }
        db.prepare("UPDATE chats SET revision=?,updated_at=? WHERE id=?").run(revision, Date.now(), chatId);
      })();
      return inserted.length ? context.json({ ok: true, id: inserted[0], inserted }) : context.json({ error: "해당 최초 마일스톤이 이미 기록되어 있어요.", code: "DUPLICATE_LEDGER_ITEM" }, 409);
    });
  });
  app.patch("/v1/chats/:id/physical-intimacy/:itemId", async (context) => {
    const chatId = context.req.param("id");
    const itemId = context.req.param("itemId");
    const current = db.prepare("SELECT * FROM physical_intimacy_milestones WHERE id=? AND chat_id=? AND active=1").get(itemId, chatId) as any;
    if (!current) return context.json({ error: "기록을 찾지 못했어요." }, 404);
    const body = await context.req.json() as { participantA?: string; participantB?: string; act?: string; customLabel?: string; initiator?: string; interactionContext?: string; circumstance?: string; sourceMessageId?: string; autoInject?: boolean };
    return withChatWrite(db, context.req.param('id'), () => {
      const participantA = body.participantA?.trim() || current.participant_a;
      const participantB = body.participantB?.trim() || current.participant_b;
      const act = body.act?.trim() || current.act;
      const customLabel = Object.hasOwn(body, "customLabel") ? body.customLabel?.trim() || null : current.custom_label;
      if (participantA.localeCompare(participantB, undefined, { sensitivity: "base" }) === 0 || (act === "other" && !customLabel)) return context.json({ error: "입력값을 확인해 주세요." }, 400);
      if (!intimacyMilestoneKeys(act).includes(current.milestone_key)) return context.json({ error: "이 실제 행위는 현재 최초 마일스톤 종류와 맞지 않아요. 기존 행을 삭제하고 새 최초 행위로 추가해 주세요." }, 400);
      const sourceWasEdited = Object.hasOwn(body, "sourceMessageId");
      const source = body.sourceMessageId
        ? db.prepare("SELECT message_id,ordinal FROM messages WHERE chat_id=? AND message_id=? AND memory_excluded=0 AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')").get(chatId, body.sourceMessageId) as { message_id: string; ordinal: number } | undefined
        : undefined;
      if (body.sourceMessageId && !source) return context.json({ error: "연결할 수 있는 활성 원문을 찾지 못했어요." }, 400);
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
  });
  app.delete("/v1/chats/:id/physical-intimacy/:itemId", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      const chatId = context.req.param("id");
      const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
      if (!chat) return context.json({ error: "Chat not found" }, 404);
      const current = db.prepare("SELECT source_memory_id FROM physical_intimacy_milestones WHERE id=? AND chat_id=? AND active=1").get(context.req.param("itemId"), chatId) as { source_memory_id: string | null } | undefined;
      const revision = chat.revision + 1;
      const changed = db.transaction(() => {
        const watermark = processedSourceWatermark(db, chatId);
        const result = db.prepare("UPDATE physical_intimacy_milestones SET active=0,manual_override=1,deleted_by_user=1,deleted_through_ordinal=?,created_revision=? WHERE id=? AND chat_id=? AND active=1").run(watermark, revision, context.req.param("itemId"), chatId).changes;
        if (result) db.prepare("UPDATE chats SET revision=?,updated_at=? WHERE id=?").run(revision, Date.now(), chatId);
        return result;
      })();
      if (changed && current?.source_memory_id) { refreshMemoryFts(db, current.source_memory_id); void embeddings.indexPending(chatId); }
      return changed ? context.json({ ok: true }) : context.json({ error: "기록을 찾지 못했어요." }, 404);
    });
  });
  function readDashboardEntities(chatId: string) {
    const prominence = new Map((db.prepare("SELECT entity_name,tier,scene_count,durable_links,pinned FROM entity_prominence WHERE chat_id=?").all(chatId) as Array<Record<string, any>>)
      .map((row) => [String(row.entity_name).toLocaleLowerCase(), { tier: row.tier, sceneCount: row.scene_count, durableLinks: row.durable_links, pinned: row.pinned === 1 }]));
    return { items: listEntities(db, chatId).map((entity) => ({ ...entity, ...(prominence.get(entity.name.toLocaleLowerCase()) ?? { tier: "incidental", sceneCount: 0, durableLinks: 0, pinned: false }) })) };
  }
  app.get("/v1/chats/:id/entities", (context) => context.json(readDashboardEntities(context.req.param("id"))));
  app.patch("/v1/chats/:id/entities/:entityId/color", async (context) => {
    const body = z.object({ color: EntityColorSchema }).safeParse(await context.req.json());
    return withChatWrite(db, context.req.param('id'), () => {
      if (!body.success) return context.json({ error: "색상은 #RRGGBB 형식 또는 null이어야 해요.", code: "INVALID_ENTITY_COLOR", path: "color" }, 400);
      const color = body.data.color?.toLowerCase() ?? null;
      const changed = db.prepare("UPDATE entities SET color=? WHERE id=? AND chat_id=?")
        .run(color, context.req.param("entityId"), context.req.param("id")).changes;
      if (!changed) return context.json({ error: "Entity not found" }, 404);
      // Appearance never changes canonical revisions or schedules memory/model work.
      return context.json({ ok: true, color });
    });
  });
  app.patch("/v1/chats/:id/entities/:entityId/prominence", async (context) => {
    const chatId = context.req.param("id");
    const entity = db.prepare("SELECT name FROM entities WHERE id=? AND chat_id=?").get(context.req.param("entityId"), chatId) as { name: string } | undefined;
    if (!entity) return context.json({ error: "Entity not found" }, 404);
    const body = await context.req.json() as { pinned?: unknown };
    return withChatWrite(db, context.req.param('id'), () => {
      if (typeof body.pinned !== "boolean") return context.json({ error: "pinned must be boolean" }, 400);
      db.prepare(`INSERT INTO entity_prominence(chat_id,entity_name,tier,scene_count,durable_links,pinned,updated_at) VALUES(?,?,?,0,0,?,?)
      ON CONFLICT(chat_id,entity_name) DO UPDATE SET pinned=excluded.pinned,tier=CASE WHEN excluded.pinned=1 THEN 'core' ELSE CASE WHEN entity_prominence.scene_count>=4 AND entity_prominence.durable_links>0 THEN 'core' WHEN entity_prominence.scene_count>=2 OR entity_prominence.durable_links>0 THEN 'recurring' ELSE 'incidental' END END,updated_at=excluded.updated_at`)
        .run(chatId, entity.name, body.pinned ? "core" : "incidental", body.pinned ? 1 : 0, Date.now());
      return context.json({ ok: true });
    });
  });
  app.post("/v1/chats/:id/entities/:entityId/delete-preview", (context) => {
    try { return context.json(previewEntityDelete(db, context.req.param("id"), context.req.param("entityId"))); }
    catch (error: any) { return context.json({ error: error instanceof Error ? error.message : String(error), code: error?.code }, error?.code === "ENTITY_NOT_FOUND" ? 404 : 400); }
  });
  app.delete("/v1/chats/:id/entities/:entityId", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      const rawRevision = context.req.query("revision");
      const revision = rawRevision === undefined || rawRevision.trim() === "" ? NaN : Number(rawRevision);
      if (!Number.isSafeInteger(revision) || revision < 0) return context.json({ error: "preview revision is required" }, 400);
      try {
        deleteEntity(db, context.req.param("id"), context.req.param("entityId"), revision);
        embeddings.stateIndex.prune(context.req.param("id"));
        void embeddings.indexPending(context.req.param("id"));
        return context.json({ ok: true });
      } catch (error: any) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        const status = error?.code === "ENTITY_DELETE_STALE" || error?.code === "ENTITY_DELETE_BUSY" ? 409 : error?.code === "ENTITY_NOT_FOUND" ? 404 : 400;
        return context.json({ error: error instanceof Error ? error.message : String(error), code: error?.code }, status);
      }
    });
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
    return withChatWrite(db, context.req.param('id'), () => {
      if (!body.sourceId || !body.targetId || !Number.isInteger(body.revision)) return context.json({ error: "sourceId, targetId, and preview revision are required" }, 400);
      try { return context.json({ ok: true, ...mergeEntities(db, context.req.param("id"), body.sourceId, body.targetId, body.revision) }); }
      catch (error: any) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        const status = error?.code === "ENTITY_MERGE_BUSY" || error?.code === "ENTITY_MERGE_STALE" ? 409 : error?.code === "ENTITY_NOT_FOUND" ? 404 : 400;
        return context.json({ error: error instanceof Error ? error.message : String(error), code: error?.code }, status);
      }
    });
  });
  app.get("/v1/chats/:id/reconciliation-reviews", (context) => {
    const items=listReconciliationReviews(db,context.req.param('id'),{pendingOnly:context.req.query('status') === 'pending'});
    return context.json({items:context.req.query('view') === 'list' ? items.map(item => ({id:item.id,itemRef:item.itemRef,itemKind:item.itemKind,status:item.status,createdAt:item.createdAt,
      incoming:{content:'content' in item.incoming ? item.incoming.content : undefined,value:'value' in item.incoming ? item.incoming.value : undefined},
      decision:{reason:(item.decision as {reason?:string}|undefined)?.reason},error:item.error,detailsLoaded:false})) : items});
  });
  app.get("/v1/chats/:id/reconciliation-reviews/:reviewId", (context) => {
    const item=listReconciliationReviews(db,context.req.param('id'),{reviewId:context.req.param('reviewId')})[0];
    return item ? context.json(item) : context.json({error:'Reconciliation review not found'},404);
  });
  app.patch("/v1/chats/:id/reconciliation-reviews/:reviewId", async (context) => {
    const body = ReconciliationReviewResolutionSchema.parse(await context.req.json());
    return withChatWrite(db, context.req.param('id'), () => {
      resolveReconciliationReview(db, context.req.param("id"), context.req.param("reviewId"), body);
      void embeddings.indexPending(context.req.param("id"));
      return context.json({ ok: true });
    });
  });
  app.get("/v1/chats/:id/episodes/active", (context) => context.json(episodeOverview(db, context.req.param("id"))));
  app.post("/v1/chats/:id/episodes/:episodeId/release", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      try {
        releaseManualEpisode(db, context.req.param("id"), context.req.param("episodeId"));
        serverWorker.wake();
        return context.json({ ok: true, ...episodeOverview(db, context.req.param("id")) });
      } catch (error: any) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error.message }, 409);
      }
    });
  });
  app.post("/v1/chats/:id/episodes/:episodeId/retry", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      const automatic = db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND type='episode' AND json_extract(payload_json,'$.episodeId')=? AND json_extract(payload_json,'$.batchId') IS NOT NULL")
        .get(context.req.param('id'), context.req.param('episodeId'));
      if (!automatic) return context.json({ error: '수동 보류는 해제한 뒤 원문 구간에서 정리해 줘' }, 409);
      retryEpisode(db, context.req.param("id"), context.req.param("episodeId"));
      serverWorker.wake();
      return context.json({ ok: true, ...episodeOverview(db, context.req.param("id")) });
    });
  });
  app.post("/v1/chats/:id/backfill-runs/:runId/acknowledge", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      const chatId = context.req.param("id");
      const runId = context.req.param("runId");
      const exists = db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND json_extract(payload_json,'$.backfillRunId')=? LIMIT 1").get(chatId, runId);
      if (!exists) return context.json({ error: "Backfill run not found" }, 404);
      db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(`backfill_ack:${chatId}:${runId}`, String(Date.now()));
      return context.json({ ok: true });
    });
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
    return withChatWrite(db, context.req.param('id'), () => {
      const result = answerQuiz(db, context.req.param("id"), context.req.param("itemId"), body.chosenIndex, body.attemptToken);
      return result ? context.json(result) : context.json({ error: "퀴즈를 찾을 수 없어." }, 404);
    });
  });
  app.put("/v1/quiz/enabled", async (context) => {
    z.object({ enabled: z.literal(false) }).parse(await context.req.json());
    disableAllQuizzes(db);
    return context.json({ ok: true });
  });
  app.put("/v1/chats/:id/quiz/enabled", async (context) => {
    const body = z.object({ enabled: z.boolean() }).parse(await context.req.json());
    return withChatWrite(db, context.req.param('id'), () => {
      setQuizEnabled(db, context.req.param("id"), body.enabled);
      const result = nextQuiz(db, context.req.param("id"));
      if (quizStatus(db, context.req.param("id")).generating) serverWorker.wake();
      return context.json(result);
    });
  });
  app.get("/v1/chats/:id/quiz/status", (context) => context.json(quizStatus(db, context.req.param("id"))));
  app.post("/v1/chats/:id/quiz/regenerate", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      const result = regenerateQuizzes(db, context.req.param("id"));
      if (result.enqueued) serverWorker.wake();
      return context.json(result);
    });
  });
  app.delete("/v1/chats/:id/quiz/stats", (context) => withChatWrite(db, context.req.param('id'), () => context.json(resetQuizStats(db, context.req.param("id")))));
  function readDashboardStatus(chatId: string, common?: {
    ingestion: () => ReturnType<typeof ingestionSummary>; conflicts: () => ReturnType<typeof listDashboardConflicts>;
    lineage: () => ReturnType<typeof getChatLineage>; calibration: () => ReturnType<typeof initialCalibrationView>;
  }) {
    const worker = serverWorker.statusForChat(chatId);
    const jobs = db.prepare(`SELECT
      SUM(CASE WHEN status IN ('queued','leased') AND type<>'quiz' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status IN ('done','archived') AND type<>'quiz' THEN 1 ELSE 0 END) AS completed,
      MAX(CASE WHEN status IN ('done','archived') AND type<>'quiz' THEN updated_at END) AS lastCompleted,
      SUM(CASE WHEN status='failed' AND type<>'quiz' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='failed' AND type IN ('extract','audit_retry','episode','social_backfill','initial_calibration') THEN 1 ELSE 0 END) AS blockingFailed,
      SUM(CASE WHEN status='failed' AND type IN ('ledger_consistency','relationship_projection','story_consolidation') THEN 1 ELSE 0 END) AS advisoryFailed
      FROM jobs WHERE chat_id=?`).get(chatId) as { completed: number | null; lastCompleted: number | null; queued: number | null; failed: number | null; blockingFailed: number | null; advisoryFailed: number | null };
    const pendingReconciliations = (db.prepare("SELECT count(*) AS count FROM reconciliation_items WHERE chat_id=? AND status='pending'").get(chatId) as { count: number }).count;
    const pendingExtractionAudits = countBlockingExtractionAudits(db, chatId);
    const pendingSmallReviews = countPendingSmallReviews(db, chatId);
    const pendingConflicts = (common?.conflicts() ?? listDashboardConflicts(db,chatId)).filter(item => item.status === 'pending').length;
    const ingestion = common?.ingestion() ?? ingestionSummary(db, chatId);
    const embeddingJobs = db.prepare("SELECT count(*) AS pending FROM embedding_blocks WHERE chat_id=? AND status='queued'").get(chatId) as { pending: number };
    const embeddingFailures = embeddings.failedWork(chatId);
    const sourceProgress = db.prepare(`SELECT SUM(CASE WHEN memory_excluded=0 THEN 1 ELSE 0 END) total,
      SUM(CASE WHEN memory_excluded=0 AND extraction_state IN ('done','encapsulated','skipped_policy') THEN 1 ELSE 0 END) processed
      FROM messages WHERE chat_id=? AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before') AND content IS NOT NULL`).get(chatId) as { total: number; processed: number | null };
    const derivedCounts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM memories WHERE chat_id=? AND active=1) memories,
      (SELECT COUNT(*) FROM visible_memory_details WHERE chat_id=? AND active=1) details,
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
    const calibration = common?.calibration() ?? initialCalibrationView(db, chatId);
    const lastJob = db.prepare("SELECT json_extract(payload_json,'$.sourceRecoveryMetadata') metadata FROM jobs WHERE chat_id=? AND type<>'quiz' AND status IN ('done','failed') ORDER BY updated_at DESC,rowid DESC LIMIT 1").get(chatId) as { metadata: string | null } | undefined;
    const calibrationPending = ["unseeded", "awaiting_setup", "queued", "awaiting_confirmation"].includes(calibration.status);
    const chat = db.prepare(`SELECT id,character_id AS characterId,profile,revision,memory_language,pending_memory_language AS pendingMemoryLanguage,
      (SELECT COUNT(*) FROM messages WHERE chat_id=c.id) messages,
      (SELECT COUNT(*) FROM messages WHERE chat_id=c.id AND source_kind<>'archive' AND host_visibility='active' AND lifecycle IN ('committed','pending')) activeMessages,
      EXISTS(SELECT 1 FROM messages WHERE chat_id=c.id AND source_kind='archive') hasImportedMemory,
      EXISTS(SELECT 1 FROM memories WHERE chat_id=c.id) OR EXISTS(SELECT 1 FROM relationship_projections WHERE chat_id=c.id)
        OR EXISTS(SELECT 1 FROM assertions WHERE chat_id=c.id) OR EXISTS(SELECT 1 FROM beliefs WHERE chat_id=c.id) OR EXISTS(SELECT 1 FROM promises WHERE chat_id=c.id) hasDerived
      FROM chats c WHERE id=?`).get(chatId) as {id:string;characterId:string;profile:string;revision:number;memory_language:MemoryLanguage;pendingMemoryLanguage:MemoryLanguage|null;messages:number;activeMessages:number;hasImportedMemory:number;hasDerived:number} | undefined;
    const memoryUpdatedAt = (db.prepare("SELECT MAX(updated_at) value FROM memories WHERE chat_id=? AND active=1").get(chatId) as { value: number | null }).value;
    return {
      serverInstanceId, memoryLanguage: chat?.memory_language,
      chat:chat ? {id:chat.id,characterId:chat.characterId,profile:chat.profile,memoryLanguage:chat.memory_language,pendingMemoryLanguage:chat.pendingMemoryLanguage ?? undefined,
        messages:chat.messages,activeMessages:chat.activeMessages,hasImportedMemory:Boolean(chat.hasImportedMemory),hasDerived:Boolean(chat.hasDerived),
        ingestionState:ingestion.ingestionState,historicalBackfillMessages:ingestion.historicalBackfillMessages} : null,
      translationRevision: JSON.stringify([chat?.revision, memoryUpdatedAt, derivedCounts.memories, derivedCounts.details, jobs.completed, jobs.lastCompleted]),
      queuedJobs: worker.queuedJobs ?? Number(jobs.queued ?? 0), failedJobs: Number(jobs.failed ?? 0), blockingFailedJobs: Number(jobs.blockingFailed ?? 0), advisoryFailedJobs: Number(jobs.advisoryFailed ?? 0), pendingReviews: pendingReconciliations + pendingExtractionAudits + pendingConflicts + pendingSmallReviews,
      pendingReconciliations,
      ...ingestion,
      pendingEmbeddings: embeddingJobs.pending, failedEmbeddings: embeddingFailures.count,
      embeddingError: embeddingFailures.lastError,
      embeddingRetryAt: embeddingJobs.pending ? embeddings.status.retryAt : undefined,
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
      upgrade: readUpgradeStatus(chatId),
      worker,
      episode: (episodeOverview(db, chatId) as any).active,
      lineage: common?.lineage() ?? getChatLineage(db, chatId),
      ...sourceSnapshotStatus(db, chatId),
    };
  }
  const upgradeDismissKey = (chatId: string) => `upgrade-dismissed:${chatId}`;
  function readUpgradeStatus(chatId: string, withPreview = false) {
    const run = activeUpgradeRun(db,chatId);
    const summary = legacyMemorySummary(db,chatId);
    const last = run ?? db.prepare("SELECT id,phase,status,error FROM regeneration_runs WHERE chat_id=? AND mode='upgrade' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(chatId) as {id:string;phase:1|2;status:string;error?:string} | undefined;
    return { summary, workEnabled:!isChatWorkHeld(db,chatId), ...(withPreview ? {preview:previewUpgrade(db,chatId)} : {}), lock:chatUpgradeLock(db,chatId),
      lastRun:last ? {runId:last.id,phase:last.phase,status:last.status,error:last.error, ...(last.status === 'applied' ? {memories:summary.totalMemories} : {})} : undefined,
      dismissed:!!db.prepare('SELECT 1 FROM server_meta WHERE key=?').get(upgradeDismissKey(chatId)) };
  }
  app.get('/v1/chats/:id/upgrade', context => context.json(readUpgradeStatus(context.req.param('id'),true)));
  app.post('/v1/chats/:id/upgrade', async context => {
    const body = z.object({backup:z.boolean(),resolvedSetup:z.unknown().optional(),identityHints:z.record(z.string(),z.unknown()).optional()}).parse(await context.req.json());
    const chatId = context.req.param('id');
    const result = startUpgrade(db,chatId,body as Parameters<typeof startUpgrade>[2]);
    db.prepare('DELETE FROM server_meta WHERE key=?').run(upgradeDismissKey(chatId));
    serverWorker.wake();
    return context.json(result);
  });
  app.post('/v1/chats/:id/upgrade/:runId/cancel', context => {
    cancelUpgrade(db,context.req.param('id'),context.req.param('runId'));
    return context.json({ok:true});
  });
  app.post('/v1/chats/:id/upgrade/:runId/resume', context => {
    resumeUpgrade(db,context.req.param('id'),context.req.param('runId')); serverWorker.wake();
    return context.json({ok:true});
  });
  app.post('/v1/chats/:id/upgrade/:runId/finish-retry', context => {
    // Run/phase validation happens synchronously; provider work continues after
    // acceptance. Routine failures remain on the run for status readers.
    void retryUpgradePhase2(db,context.req.param('id'),context.req.param('runId'))
      .catch(()=>console.error('[RCM] Upgrade finishing task failed'));
    return context.json({accepted:true},202);
  });
  app.post('/v1/chats/:id/upgrade/dismiss', context => {
    db.prepare('INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(upgradeDismissKey(context.req.param('id')),'true');
    return context.json({ok:true});
  });
  app.get("/v1/chats/:id/status", (context) => context.json(readDashboardStatus(context.req.param("id"))));
  app.get('/v1/chats/:id/source-head', (context) => context.json({...sourceSnapshotStatus(db, context.req.param('id')),memoryEpoch:memoryEpoch(db,context.req.param('id')),upgradeLock:chatUpgradeLock(db,context.req.param('id'))}));
  app.patch("/v1/chats/:id/relationships", async (context) => {
    const body = await context.req.json() as Record<string, unknown>;
    return withChatWrite(db, context.req.param('id'), () => {
      if (body.clear === true) assertSourceSnapshotAccepted(db,context.req.param('id'));
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
      catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        return context.json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    });
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
      return { ...item, alwaysInject: Number(item.always_inject ?? item.pinned ?? 0) === 1, ...correctionView(item as any), lastMention: { ordinal: last_mention_ordinal, storyTime: last_mention_story_time } };
    };
    const assertionItem = (row: LastMentionRow) => {
      const item = withLastMention(row);
      const relation = parseSocialRelation(row.social_relation_json);
      return { ...item, stateKind: row.state_kind,
        ...(["goal", "secret"].includes(String(row.state_kind)) ? publicKnowledgeScope(resolveAssertionHolders(db, chatId, row) ?? []) : {}),
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
    const promiseOrigins=promiseFirstMade(db,chatId);
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
      alwaysInjectCount: nowAlwaysInjectCount(db,chatId),
      seeds: dashboardStorySeeds(db,chatId),
      at: { revision: hasRevision ? atRevision : null, ordinal: hasOrdinal ? atOrdinal : null },
      assertions: (db.prepare(`${assertionSelect} WHERE ${clauses.join(" AND ")}`).all(...values) as LastMentionRow[]).map(assertionItem),
      beliefs: (db.prepare(`${beliefSelect} WHERE chat_id=? AND active=1`).all(chatId) as LastMentionRow[]).map(withLastMention),
      promises: (db.prepare(`${promiseSelect} WHERE chat_id=?`).all(chatId) as LastMentionRow[]).map(stored=>{
        const row=projectPromiseRow(db,chatId,stored);
        return {...withLastMention(row),firstMade:promiseOrigins.get(String(row.id)),access:memoryDetailAccess(db,chatId,String(row.id),"promise")};
      }),
      ...(includeHistory ? {
        endedAssertions: (db.prepare(`${assertionSelect} WHERE chat_id=? AND valid_to_revision IS NOT NULL ORDER BY COALESCE(valid_to_ordinal,2147483647) DESC,created_at DESC`).all(chatId) as LastMentionRow[]).map(assertionItem),
        endedBeliefs: (db.prepare(`${beliefSelect} WHERE chat_id=? AND active=0 AND (source IS NULL OR source NOT LIKE 'user_deleted:%') ORDER BY COALESCE(valid_to_ordinal,2147483647) DESC,created_at DESC`).all(chatId) as LastMentionRow[]).map(withLastMention),
        userDeletedBeliefs: (db.prepare(`${beliefSelect} WHERE chat_id=? AND active=0 AND source LIKE 'user_deleted:%' ORDER BY created_at DESC`).all(chatId) as LastMentionRow[]).map(withLastMention),
        promiseHistory: (db.prepare("SELECT * FROM promise_events WHERE chat_id=? ORDER BY COALESCE(source_ordinal,2147483647),created_at").all(chatId) as Record<string,any>[])
          .filter(row=>!promiseContributionState(db,chatId,row.promise_id).rebuilt || row.active===1 && row.status!=='invalidated')
          .map(row=>projectPromiseRow(db,chatId,row,row.id)),
      } : {}),
    };
  }
  app.get("/v1/chats/:id/world-state", (context) => context.json(readDashboardWorld(context.req.param("id"), context.req.query())));
  app.patch("/v1/chats/:id/world-state/always-inject", async context => {
    const body = await context.req.json() as {kind?: string; id?: string; alwaysInject?: boolean};
    const chatId = context.req.param('id');
    if (!['assertion','belief','promise'].includes(body.kind ?? '') || !body.id || typeof body.alwaysInject !== 'boolean')
      return context.json({error:'kind, id and boolean alwaysInject are required'},400);
    return withChatWrite(db,chatId,()=>db.transaction(()=>{
      const table = body.kind === 'assertion' ? 'assertions' : body.kind === 'belief' ? 'beliefs' : 'promises';
      const column = body.kind === 'promise' ? 'pinned' : 'always_inject';
      const current = body.kind === 'assertion' ? 'valid_to_revision IS NULL' : body.kind === 'belief' ? "active=1 AND status='active'" : deliverablePromiseSql;
      const row = db.prepare(`SELECT ${column} enabled FROM ${table} WHERE chat_id=? AND id=? AND ${current}`).get(chatId,body.id) as {enabled:number}|undefined;
      if (!row) return context.json({code:'NOW_ITEM_NOT_CURRENT',error:'현재 기록을 찾지 못했어요'},409);
      db.prepare(`UPDATE ${table} SET ${column}=? WHERE chat_id=? AND id=?`).run(Number(body.alwaysInject),chatId,body.id);
      if (row.enabled !== Number(body.alwaysInject)) db.prepare('UPDATE chats SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(),chatId);
      return context.json({ok:true,alwaysInject:body.alwaysInject,alwaysInjectCount:nowAlwaysInjectCount(db,chatId)});
    })());
  });
  app.post("/v1/chats/:id/world-state", async (context) => {
    const chatId = context.req.param("id");
    const body = await context.req.json() as { kind?: string; subject?: string; predicate?: string; holder?: string; promisor?: string; promisee?: string; value?: string; stateKind?: string; confidence?: number; polarity?: string; status?: string; content?: string; scope?: string; scheduledFor?: string; statusReason?: string; sourceMessageId?: string; socialRelation?: unknown; knownBy?: string[]; knownByEveryone?: boolean; locked?: boolean } & PromiseEditOptions;
    return withChatWrite(db, context.req.param('id'), () => {
      if(!UserCorrectionEditSchema.safeParse(body).success) return context.json({error:"locked must be boolean"},400);
      const promiseOptions = PromiseEditOptionsSchema.safeParse(body);
      if (!promiseOptions.success) return context.json({ error: promiseOptions.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") }, 400);
      const parsedSocial = body.socialRelation == null ? undefined : SocialRelationSchema.safeParse(body.socialRelation);
      if (parsedSocial && !parsedSocial.success) return context.json({ error: "Invalid social relation" }, 400);
      if (body.stateKind !== undefined && !STATE_KIND_VALUES.includes(body.stateKind as typeof STATE_KIND_VALUES[number])) return context.json({ error: "unsupported state kind" }, 400);
      if (body.knownBy !== undefined && (!Array.isArray(body.knownBy) || body.knownBy.some(name => typeof name !== "string" || !name.trim()))) return context.json({ error: "knownBy must be character names" }, 400);
      if (body.knownByEveryone !== undefined && typeof body.knownByEveryone !== "boolean") return context.json({ error: "knownByEveryone must be boolean" }, 400);
      const manualSocial = parsedSocial?.success ? JSON.stringify({ ...parsedSocial.data, detailIds: [], manual: true, knownBy: body.knownBy ?? [], knownByEveryone: body.knownByEveryone ?? false }) : null;
      const kind = body.kind;
      const required = kind === "assertion" ? [body.subject, body.predicate, body.value] : kind === "belief" ? [body.holder, body.subject, body.predicate, body.value] : kind === "promise" ? [body.promisor, body.promisee, body.content] : [];
      if (!kind || required.length === 0 || required.some((value) => !value?.trim())) return context.json({ error: "필수 영문 정본 필드를 입력해 주세요." }, 400);
      const confidence = Math.max(0, Math.min(1, Number(body.confidence ?? (kind === "belief" ? 0.7 : 1))));
      const source = body.sourceMessageId ? db.prepare("SELECT message_id,ordinal FROM messages WHERE chat_id=? AND message_id=? AND memory_excluded=0 AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')").get(chatId, body.sourceMessageId) as { message_id: string; ordinal: number } | undefined : undefined;
      if (body.sourceMessageId && !source) return context.json({ error: "연결할 수 있는 활성 원문을 찾지 못했어요." }, 400);
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
        if (kind === "promise") {
          replaceItemAccess(db, chatId, "promise", id, [body.promisor!, body.promisee!].map(holder => ({ holder: holder.trim(), basis: "experienced",
            evidence: JSON.parse(evidence), confidence: 1 })), revision, Date.now());
          db.prepare("UPDATE promises SET pinned=? WHERE id=?").run(Number(body.pinned ?? false), id);
          recordPromiseRecency(db, chatId, id, undefined, body.status ?? "open", body.recency ?? "already_past");
          const event = db.prepare("SELECT id FROM promise_events WHERE promise_id=? ORDER BY created_revision DESC LIMIT 1").get(id) as { id: string };
          snapshotPromiseRecency(db, event.id, id);
        }
        db.prepare(`UPDATE ${kind === "assertion" ? "assertions" : kind === "belief" ? "beliefs" : "promises"} SET user_edit_ordinal=?,auto_locked=? WHERE id=? AND chat_id=?`)
          .run(committedEditOrdinal(db,chatId),Number(body.locked ?? false),id,chatId);
        db.prepare("UPDATE chats SET revision=?,updated_at=? WHERE id=?").run(revision, Date.now(), chatId);
      })();
      return context.json({ ok: true, id, userEdited:true,userEditOrdinal:committedEditOrdinal(db,chatId),locked:body.locked ?? false }, 201);
    });
  });
  app.patch("/v1/chats/:id/world-state", async (context) => {
    const body = await context.req.json() as {
      kind?: string; id?: string; subject?: string; predicate?: string; holder?: string; promisor?: string; promisee?: string;
      value?: string; stateKind?: string; confidence?: number; polarity?: string; status?: string; content?: string; scheduledFor?: string; statusReason?: string; socialRelation?: unknown; knownBy?: string[]; knownByEveryone?: boolean; locked?: boolean;
    } & PromiseEditOptions;
    return withChatWrite(db, context.req.param('id'), () => {
      const chatId = context.req.param("id");
      const promiseOptions = PromiseEditOptionsSchema.safeParse(body);
      if (!promiseOptions.success) return context.json({ error: promiseOptions.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") }, 400);
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
      const explicitKnowledge = body.knownBy !== undefined || body.knownByEveryone !== undefined;
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
      // A pin (including a full unchanged editor payload) is a preference, not
      // a new authored occurrence or a correction boundary for old extraction.
      if (body.kind === 'promise' && body.pinned !== undefined) {
        const current=db.prepare('SELECT * FROM promises WHERE id=? AND chat_id=?').get(body.id,chatId) as Record<string,any>|undefined;
        if (!current) return context.json({error:'State item not found or unsupported kind'},404);
        const columns={promisor:'promisor',promisee:'promisee',content:'content',status:'status',scheduledFor:'scheduled_for',statusReason:'status_reason'} as const;
        const authored=Object.entries(columns).some(([key,column])=>{
          const value=body[key as keyof typeof columns];
          return value !== undefined && (value?.trim() || null) !== (current[column] || null);
        }) || explicitKnowledge || body.locked !== undefined && Number(body.locked)!==current.auto_locked
          || body.recency === 'recent' || body.recency === 'already_past' && current.recency_until_turn != null;
        if (!authored) {
          if (current.pinned !== Number(body.pinned)) db.transaction(()=>{
            db.prepare('UPDATE promises SET pinned=? WHERE id=? AND chat_id=?').run(Number(body.pinned),body.id,chatId);
            db.prepare('UPDATE chats SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(),chatId);
          })();
          return context.json({ok:true,item:{...current,pinned:Number(body.pinned),...correctionView(current)}});
        }
      }
      const revision = chat.revision + 1;
      let changed = 0;
      let updatedItem: Record<string, unknown> | undefined;
      db.transaction(() => {
        const current = body.kind === 'assertion' ? currentAssertion
          : body.kind === 'belief' || body.kind === 'promise'
            ? db.prepare(`SELECT * FROM ${body.kind === 'belief' ? 'beliefs' : 'promises'} WHERE id=? AND chat_id=?`).get(body.id,chatId) as Record<string,any>|undefined : undefined;
        if (!current) return;
        const support = body.kind === 'promise' ? promiseLinkedSupport(db,chatId,body.id!)
          : current.linked_detail_ids_json != null && current.user_edit_ordinal == null
            ? {ids:JSON.parse(String(current.linked_detail_ids_json)) as string[],holders:linkedDetailKnowledge(db,chatId,JSON.parse(String(current.linked_detail_ids_json))) ?? [PENDING_ACCESS_HOLDER]} : undefined;
        let grants = snapshotKnowledgeGrants(db,chatId,body.kind as 'assertion'|'belief'|'promise',body.id!,support);
        const priorHolders = support?.holders ?? (grants.length ? grants.map(grant=>grant.holder)
          : body.kind === 'assertion' ? (oldRelation ? socialRelationKnowledge(db,chatId,oldRelation) : resolveAssertionHolders(db,chatId,current)) ?? [PENDING_ACCESS_HOLDER]
          : body.kind === 'belief' ? [String(current.holder)] : []);
        if (!grants.length && body.kind === 'assertion' && priorHolders.length)
          grants = snapshotKnowledgeGrants(db,chatId,'assertion',body.id!,{ids:[],holders:priorHolders});
        if (explicitKnowledge) {
          const holders = body.knownByEveryone === true ? [EVERYONE_HOLDER] : body.knownBy?.map(holder=>holder.trim()) ?? publicKnowledgeScope(priorHolders).knownBy;
          grants = (holders.length ? holders : [NARRATOR_ARCHIVE_HOLDER]).map(holder=>({holder,basis:'internal',evidence:[],confidence:1}));
        }
        const promiseDetails = body.kind === 'promise' ? support?.ids ?? correctedPromiseDetailIds(db,chatId,body.id!) : undefined;
        const linkedDetails = explicitKnowledge ? null : body.kind === 'promise'
          ? promiseDetails?.length ? JSON.stringify(promiseDetails) : null : current.linked_detail_ids_json ?? null;
        if (body.kind === "assertion") {
          db.prepare("UPDATE assertions SET automatic_closure_evidence_json=NULL,valid_to_revision=? WHERE id=?").run(revision - 1, body.id);
          for (const id of mergeIds) db.prepare("UPDATE assertions SET automatic_closure_evidence_json=NULL,valid_to_revision=? WHERE id=?").run(revision - 1, id);
          const nextId = randomUUID();
          const nextStateKind = nextRelation ? "condition" : body.stateKind ?? current.state_kind ?? "condition";
          db.prepare(`
          INSERT INTO assertions(id,chat_id,subject,predicate,value,state_kind,confidence,valid_from_revision,source_memory_id,evidence_json,created_at,linked_detail_ids_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(nextId, chatId, body.subject?.trim() ?? current.subject, body.predicate?.trim() ?? current.predicate, body.value?.trim() ?? current.value,
            nextStateKind,
            Math.max(0, Math.min(1, Number(body.confidence ?? current.confidence))), revision, null, "[]", Date.now(),linkedDetails);
          inheritNowDelivery(db,'assertions',nextId,[current,...mergeIds.map(id=>db.prepare('SELECT always_inject FROM assertions WHERE id=?').get(id) as {always_inject:number})]);
          if (grants.length) replaceItemAccess(db,chatId,'assertion',nextId,grants,revision,Date.now());
          const relationJson = body.socialRelation === null || !nextRelation ? null : JSON.stringify({ ...nextRelation, manual: true,
            ...publicKnowledgeScope(grants.map(grant=>grant.holder)), detailIds: explicitKnowledge ? [] : oldRelation?.detailIds ?? [] });
          db.prepare("UPDATE assertions SET social_relation_json=? WHERE id=?").run(relationJson, nextId);
          db.prepare("UPDATE assertions SET user_edit_ordinal=?,auto_locked=?,valid_from_ordinal=? WHERE id=?")
            .run(committedEditOrdinal(db,chatId),Number(body.locked ?? current.auto_locked ?? false),committedEditOrdinal(db,chatId),nextId);
          changed = 1;
          updatedItem = db.prepare("SELECT * FROM assertions WHERE id=?").get(nextId) as Record<string, unknown>;
          updatedItem.stateKind = updatedItem.state_kind;
          if (nextStateKind === "goal" || nextStateKind === "secret") Object.assign(updatedItem, publicKnowledgeScope(resolveAssertionHolders(db, chatId, updatedItem) ?? []));
        } else if (body.kind === "belief") {
          rememberLedgerEditOrigin(db, chatId, "belief", body.id!);
          changed = db.prepare(`UPDATE beliefs SET automatic_closure_evidence_json=NULL,holder=COALESCE(?,holder),subject=COALESCE(?,subject),predicate=COALESCE(?,predicate),value=COALESCE(?,value),confidence=COALESCE(?,confidence),polarity=COALESCE(?,polarity),status='active',active=1,superseded_by=NULL,valid_to_ordinal=NULL WHERE id=? AND chat_id=?`).run(
            body.holder?.trim() ?? null, body.subject?.trim() ?? null, body.predicate?.trim() ?? null, body.value?.trim() ?? null,
            body.confidence === undefined ? null : body.confidence, body.polarity ?? null, body.id, chatId,
          ).changes;
          if (changed) updatedItem = db.prepare("SELECT * FROM beliefs WHERE id=? AND chat_id=?").get(body.id, chatId) as Record<string, unknown>;
        } else if (body.kind === "promise") {
          const previous = db.prepare("SELECT status FROM promises WHERE id=? AND chat_id=?").get(body.id, chatId) as { status: string } | undefined;
          rememberLedgerEditOrigin(db, chatId, "promise", body.id!);
          changed = db.prepare(`UPDATE promises SET promisor=COALESCE(?,promisor),promisee=COALESCE(?,promisee),content=COALESCE(?,content),status=COALESCE(?,status),scheduled_for=COALESCE(?,scheduled_for),status_reason=COALESCE(?,status_reason),pinned=COALESCE(?,pinned),updated_revision=? WHERE id=? AND chat_id=?`).run(
            body.promisor?.trim() ?? null, body.promisee?.trim() ?? null, body.content?.trim() ?? null, body.status ?? null, body.scheduledFor?.trim() ?? null, body.statusReason?.trim() ?? null, body.pinned === undefined ? null : Number(body.pinned), revision, body.id, chatId,
          ).changes;
          if (changed) {
            recordPromiseRecency(db, chatId, body.id!, previous?.status, body.status ?? previous!.status, body.recency ?? "already_past");
            updatedItem = db.prepare("SELECT * FROM promises WHERE id=? AND chat_id=?").get(body.id, chatId) as Record<string, unknown>;
            const sourceOrdinal = committedEditOrdinal(db,chatId);
            const eventId = randomUUID();
            db.prepare(`INSERT INTO promise_events(id,chat_id,promise_id,promise_key,promisor,promisee,content,status,scheduled_for,status_reason,source_memory_id,source_ordinal,created_revision,created_at,user_authored,linked_detail_ids_json)
            VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,1,?)`).run(
              eventId, chatId, body.id, updatedItem.promise_key, updatedItem.promisor, updatedItem.promisee,
              updatedItem.content, updatedItem.status, updatedItem.scheduled_for, updatedItem.status_reason, sourceOrdinal, revision, Date.now(),linkedDetails,
            );
            snapshotPromiseRecency(db, eventId, body.id!);
          }
        }
        if (changed && updatedItem) {
          if (body.kind !== 'assertion' && grants.length) replaceItemAccess(db,chatId,body.kind as 'belief'|'promise',String(updatedItem.id),grants,revision,Date.now());
          if (body.kind === 'belief' && explicitKnowledge) {
            db.prepare('UPDATE beliefs SET linked_detail_ids_json=NULL WHERE id=? AND chat_id=?').run(updatedItem.id,chatId);
            updatedItem.linked_detail_ids_json=null;
          }
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
  });
  function mutateLedger(chatId: string, kind: 'assertion'|'belief'|'promise', itemId: string, mode: 'end'|'delete'|undefined): boolean {
    const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as {revision:number}|undefined;
    if (!chat) return false;
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
          : db.prepare(`UPDATE beliefs SET automatic_closure_evidence_json=NULL,active=0,valid_to_ordinal=COALESCE(valid_to_ordinal,?),deleted_through_ordinal=?,
          source=CASE WHEN source LIKE 'user_deleted:%' THEN source ELSE 'user_deleted:' || COALESCE(source,'') END
          WHERE id=? AND chat_id=? AND active=1`).run(sourceOrdinal, processedSourceWatermark(db, chatId), itemId, chatId).changes;
      }
      else changed = db.prepare("DELETE FROM promises WHERE id=? AND chat_id=?").run(itemId, chatId).changes;
      if (changed && (mode==='delete' || (mode!=='end' && kind!=='assertion'))) {
        if (mode!=='delete') supports.add(`${kind==='belief'?'beliefs':'promises'}:${itemId}`);
        invalidateStorySupports(db,chatId,supports);
      }
      if (changed) db.prepare("UPDATE chats SET revision=?,updated_at=? WHERE id=?").run(revision, Date.now(), chatId);
    })();
    if (changed && mode === "delete") embeddings.stateIndex.prune(chatId);
    return changed > 0;
  }
  app.delete("/v1/chats/:id/world-state/:kind/:itemId", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      const chatId=context.req.param('id'),kind=context.req.param('kind'),itemId=context.req.param('itemId'),mode=context.req.query('mode');
      if (mode !== undefined && mode !== 'end' && mode !== 'delete') return context.json({error:'mode must be end or delete'},400);
      if (!['assertion','belief','promise'].includes(kind) || mode === 'end' && kind === 'promise') return context.json({error:'Unsupported ledger action'},400);
      return mutateLedger(chatId,kind as 'assertion'|'belief'|'promise',itemId,mode) ? context.json({ok:true}) : context.json({error:'State item not found'},404);
    });
  });
  app.patch('/v1/chats/:id/seeds/:detailId', async context => {
    const body=await context.req.json().catch(()=>null);
    return withChatWrite(db, context.req.param('id'), () => {
      if (!body || !['close','reopen'].includes(body.action)) return context.json({error:'action must be close or reopen'},400);
      return editStorySeed(db,context.req.param('id'),context.req.param('detailId'),body.action) ? context.json({ok:true}) : context.json({error:'Seed not found'},404);
    });
  });
  app.delete('/v1/chats/:id/seeds/:detailId', context => withChatWrite(db, context.req.param('id'), () => editStorySeed(db,context.req.param('id'),context.req.param('detailId'),'delete')
    ? context.json({ok:true}) : context.json({error:'Seed not found'},404)));
  app.post('/v1/chats/:id/now/cleanup', async context => {
    const body=await context.req.json().catch(()=>null);
    return withChatWrite(db, context.req.param('id'), () => {
      if (!body || !['end','delete','reopen'].includes(body.action) || !Array.isArray(body.items) || !body.items.length || body.items.length>500)
        return context.json({error:'Expected action and 1–500 items'},400);
      const seedIds=body.items.filter((item:any)=>item?.kind === 'seed' && typeof item.id === 'string' && item.id).map((item:any)=>item.id) as string[];
      let seedResults:Map<string,{ok:boolean;error?:string}>;
      try { seedResults=new Map(editStorySeeds(db,context.req.param('id'),seedIds,body.action === 'end' ? 'close' : body.action).map(item=>[item.id,item])); }
      catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        seedResults=new Map(seedIds.map(id=>[id,{ok:false,error:error instanceof Error ? error.message : String(error)}]));
      }
      const results=body.items.map((item: any) => {
        const id=typeof item?.id === 'string' ? item.id : '',kind=item?.kind;
        try {
          if (!id || !['seed','assertion','belief'].includes(kind) || body.action === 'reopen' && kind !== 'seed')
            return {id,kind,ok:false,error:'Unsupported cleanup item or action (promises are excluded)'};
          if (kind === 'seed') return {id,kind,...seedResults.get(id)!};
          const ok=mutateLedger(context.req.param('id'),kind,id,body.action);
          return {id,kind,ok,...(ok ? {} : {error:'Record not found or already ended'})};
        } catch (error) {
          if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
          return {id,kind,ok:false,error:error instanceof Error ? error.message : String(error)};
        }
      });
      return context.json({ok:results.every((item: any)=>item.ok),results});
    });
  });
  function readDashboardConflicts(chatId: string) {
    return { items: listDashboardConflicts(db,chatId) };
  }
  app.get("/v1/chats/:id/conflicts", (context) => context.json(readDashboardConflicts(context.req.param("id"))));
  function readDashboardJobs(chatId: string, ingestion = ingestionSummary(db, chatId)) {
    return {
      items: db.prepare(`
        SELECT id,type,status,attempts,leased_until,last_error,payload_json,created_at,updated_at FROM jobs
        WHERE chat_id=? AND status<>'archived' ORDER BY created_at DESC,rowid DESC LIMIT 200
      `).all(chatId).map((job: any) => ({ ...job, payload_json: JSON.stringify({ ...projectJobListPayload(JSON.parse(job.payload_json),job.type), ...jobListMetadata(db,chatId,job) }) })),
      completedProcessingJobs: Number((db.prepare(`SELECT COUNT(*) n FROM (
        SELECT id FROM jobs WHERE chat_id=? AND status IN ('done','completed','cancelled','superseded')
        UNION SELECT id FROM processing_jobs WHERE chat_id=? AND status IN ('done','completed','cancelled','superseded'))`).get(chatId,chatId) as {n:number}).n),
      cancelledMessages: (db.prepare("SELECT count(*) AS count FROM messages WHERE chat_id=? AND memory_excluded=0 AND extraction_state='cancelled'").get(chatId) as { count: number }).count,
      ...ingestion,
    };
  }
  app.get("/v1/chats/:id/jobs", (context) => context.json(readDashboardJobs(context.req.param("id"))));
  // Snapshot IDs for the confirmation; never include work queued after the user saw it.
  const queuedReviewJobs = () => db.prepare(`SELECT id FROM jobs WHERE status='queued' AND type IN ('extract','episode','social_backfill','memory_group')
    AND json_extract(payload_json,'$.upgradeRunId') IS NULL AND NOT ${upgradeLockSql('jobs.chat_id')}`).all() as Array<{ id: string }>;
  app.get('/v1/jobs/extraction-review', context => context.json({ jobIds: queuedReviewJobs().map(job => job.id) }));
  app.put('/v1/jobs/extraction-review', async context => {
    const { jobIds, enabled } = z.object({ jobIds: z.array(z.string().min(1)), enabled: z.boolean() }).parse(await context.req.json());
    const updated = db.transaction(() => {
      jobIds.forEach(id=>assertUpgradeJobWritable(db,id));
      const eligible = new Set(queuedReviewJobs().map(job => job.id));
      const update = db.prepare("UPDATE jobs SET payload_json=json_set(payload_json,'$.postExtractionReview',json(?)),updated_at=? WHERE id=? AND status='queued'");
      return [...new Set(jobIds)].reduce((count, id) => count + (eligible.has(id) ? update.run(JSON.stringify(enabled), Date.now(), id).changes : 0), 0);
    })();
    return context.json({ updated });
  });
  app.post('/v1/chats/:id/embeddings/retry-failed', async context => {
    const chatId = context.req.param('id');
    try {
      const retried = await embeddings.retryFailed(chatId);
      if (!retried) return context.json({ error: "다시 시도할 임베딩 작업이 없어요. 처리 상태를 확인해 주세요." }, 409);
      void embeddings.indexPending(chatId);
      return context.json({ retried });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
      return context.json({ error: error instanceof Error ? error.message : "임베딩 재시도를 요청하지 못했어요." }, 409);
    }
  });
  app.get('/v1/chats/:id/jobs/retry-failed/estimate',context=>context.json(estimateFailedJobCalls(db,context.req.param('id'))));
  app.post("/v1/chats/:id/jobs/retry-failed", async (context) => {
    const body = await context.req.json().catch(() => ({}));
    return withChatWrite(db, context.req.param('id'), () => {
      assertSourceSnapshotAccepted(db,context.req.param('id'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) return context.json({error:'Expected a retry request object'},400);
      if (body.jobIds !== undefined && (!Array.isArray(body.jobIds) || !body.jobIds.every((id: unknown) => typeof id === 'string'))) return context.json({error:'jobIds must be an array of IDs'},400);
      const selectedIds: Set<string> | undefined = body.jobIds ? new Set(body.jobIds) : undefined;
      const chatId = context.req.param("id");
      if (db.prepare(`SELECT id FROM jobs WHERE chat_id=? AND status='failed' AND type='initial_calibration'
      AND COALESCE(json_array_length(payload_json,'$.resolvedSetup.messages'),0)=0`).all(chatId).some((row:any)=>!selectedIds||selectedIds.has(row.id))) {
        return context.json({ code: "INITIAL_SETUP_REQUIRED", error: "초기 설정 입력은 보관하지 않아요. 인물 → 초기 설정에서 재료를 다시 선택해 주세요." }, 409);
      }
      const retriedRunIds = (db.prepare(`SELECT id,json_extract(payload_json,'$.backfillRunId') runId FROM jobs
      WHERE chat_id=? AND status='failed' AND json_extract(payload_json,'$.backfillRunId') IS NOT NULL`).all(chatId) as Array<{ id:string;runId: string }>).filter(row=>!selectedIds||selectedIds.has(row.id)).map((row) => row.runId);
      const result = db.transaction(() => {
        const failed = db.prepare("SELECT id,payload_json FROM jobs WHERE chat_id=? AND status='failed'").all(chatId) as Array<{ id: string; payload_json: string }>;
        const update = db.prepare(`UPDATE jobs SET status='queued',attempts=0,payload_json=?,lease_owner=NULL,leased_until=NULL,last_error=NULL,updated_at=? WHERE id=? AND status='failed'`);
        let changes = 0;
        for (const job of failed) {
          if (selectedIds && !selectedIds.has(job.id)) continue;
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
  });
  app.post("/v1/chats/:id/jobs/:jobId/resplit", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      try {
        const result = resplitFailedExtractionJob(db, context.req.param("id"), context.req.param("jobId"));
        if (result.queued > 0) serverWorker.wake();
        return context.json({ ok: true, ...result });
      } catch (error) {
        if (error instanceof Error && error.message === 'CHAT_UPGRADING') throw error;
        const code = (error as { code?: string }).code;
        return context.json({ error: error instanceof Error ? error.message : String(error), ...(code ? { code } : {}) }, code === "ATOMIC_TURN_TOO_LARGE" ? 409 : 400);
      }
    });
  });
  app.delete("/v1/chats/:id/jobs/completed", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      const result = db.prepare(`
      UPDATE jobs SET status='archived',lease_owner=NULL,leased_until=NULL,updated_at=?
      WHERE chat_id=? AND status IN ('done','completed','cancelled','superseded')
    `).run(Date.now(), context.req.param("id"));
      const retained=db.prepare("UPDATE processing_jobs SET status='archived' WHERE chat_id=? AND status IN ('done','completed','cancelled','superseded')").run(context.req.param('id'));
      return context.json({ ok: true, archivedJobs: result.changes+retained.changes });
    });
  });
  app.delete("/v1/chats/:id/jobs", (context) => withChatWrite(db, context.req.param('id'), () => context.json({ ok: true, ...cancelExtractionJobs(db, context.req.param("id")) })));
  app.post("/v1/chats/:id/jobs/requeue-cancelled", (context) => withChatWrite(db, context.req.param('id'), () => context.json({
    ok: true, restoredMessages: requeueCancelledMessages(db, context.req.param("id")),
  })));
  app.get("/v1/chats/:id/recall-logs", (context) => context.json({ items: db.prepare(`
    SELECT id,query,perspective,selected_json,elapsed_ms,created_at FROM recall_logs
    WHERE chat_id=? ORDER BY created_at DESC LIMIT 200
  `).all(context.req.param("id")) }));
  app.post("/v1/chats/:id/source-sync", async (context) => {
    const body = TurnPrepareRequestSchema.parse(await context.req.json());
    if (body.chatId !== context.req.param("id")) return context.json({ error: "chatId does not match route" }, 400);
    const { stats, ...sourceStatus } = withSourceSnapshot(db, body, (policy) => {
      ensureChatLineage(db, body, false, policy.allowDestructive);
      return { stats: syncSnapshot(db, { ...body, deferExtraction: true, tokenBudget: 0, forceBackfill: false }, policy) };
    });
    return context.json({ ok: true, serverInstanceId, stats, ...sourceStatus });
  });
  app.patch("/v1/chats/:id/conflicts/:conflictId", async (context) => {
    const body = await context.req.json() as { resolution?: ConflictResolution; targetAssertionId?: unknown };
    return withChatWrite(db, context.req.param('id'), () => {
      if (!body.resolution || !["accept_incoming", "keep_existing", "acknowledged"].includes(body.resolution)) {
        return context.json({ error: "unsupported conflict resolution" }, 400);
      }
      if (body.targetAssertionId !== undefined && (typeof body.targetAssertionId !== "string" || !body.targetAssertionId.trim())) {
        return context.json({ error: "targetAssertionId must be a non-empty string", code: "CONFLICT_TARGET_INVALID" }, 400);
      }
      const targetAssertionId = typeof body.targetAssertionId === "string" ? body.targetAssertionId.trim() : undefined;
      return context.json({ ok: true, ...resolveConflict(db, context.req.param("id"), context.req.param("conflictId"), body.resolution, targetAssertionId) });
    });
  });
  app.delete("/v1/chats/:id/conflicts/:conflictId", (context) => {
    return withChatWrite(db, context.req.param('id'), () => {
      const result = db.prepare("DELETE FROM conflicts WHERE id=? AND chat_id=? AND status='resolved'").run(context.req.param("conflictId"), context.req.param("id"));
      return result.changes === 1 ? context.json({ ok: true }) : context.json({ error: "Resolved conflict not found" }, 404);
    });
  });

  app.post("/v1/export", async (context) => {
    const body = await context.req.json() as { pluginSettings?: unknown; serverUrl?: string; serverToken?: string; chatId?:string; chatSettings?:any };
    if (body.chatId) assertUserChat(db,body.chatId);
    const wasPaused = serverWorker.status.state === "paused";
    serverWorker.pause("Creating a consistent backup");
    try {
      const archive = body.chatId ? exportChatArchive(db,body.chatId,body.chatSettings,albumPhotoStore) : exportCompleteArchive(db, {
        pluginSettings: body.pluginSettings,
        serverUrl: typeof body.serverUrl === "string" ? body.serverUrl : undefined,
        serverToken: config.token,
        serverSettings:backupServerSettings(config),
        secrets: existsSync(config.secretsPath) ? readFileSync(config.secretsPath, "utf8") : "",
        voyageApiKey: config.voyageApiKey || undefined,
        llmApiKeys: llmStore.backupApiKeys(),
      }, albumPhotoStore);
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
    const archive = new Uint8Array(await context.req.arrayBuffer());
    for (const row of db.prepare('SELECT id FROM chats').all() as {id:string}[]) assertChatUnlocked(db,row.id);
    if (serverWorker.status.activeCalls > 0) return context.json({error:"보조 모델 처리가 끝난 뒤 복원해 주세요."},409);
    const wasPaused = serverWorker.status.state === "paused";
    serverWorker.pause("Restoring a complete backup");
    let previousArchive: Uint8Array | undefined;
    const previousSecrets = existsSync(config.secretsPath) ? readFileSync(config.secretsPath, "utf8") : undefined;
    try {
      previousArchive = exportCompleteArchive(db, {}, albumPhotoStore);
      const stagingDirectory = mkdtempSync(join(dirname(config.dbPath), ".album-restore-check-"));
      const staged = openDatabase(":memory:").db;
      try {
        restoreCompleteArchive(staged, archive, createAlbumPhotoStore(join(stagingDirectory, "albums")));
        const integrity = staged.pragma("integrity_check") as Array<{ integrity_check?: string }>;
        const foreignKeyErrors = staged.pragma("foreign_key_check") as unknown[];
        if (integrity.some((row) => row.integrity_check !== "ok") || foreignKeyErrors.length > 0) {
          throw new Error("Backup failed staged SQLite integrity validation");
        }
      } finally {
        staged.close();
        rmSync(stagingDirectory, { recursive: true, force: true });
      }
      const result = restoreCompleteArchive(db, archive, albumPhotoStore);
      const liveIntegrity = db.pragma("integrity_check") as Array<{ integrity_check?: string }>;
      const liveForeignKeyErrors = db.pragma("foreign_key_check") as unknown[];
      if (liveIntegrity.some((row) => row.integrity_check !== "ok") || liveForeignKeyErrors.length > 0) {
        throw new Error("Restored SQLite database failed integrity validation");
      }
      if (typeof result.privateData.secrets === "string") writeFileSync(config.secretsPath, result.privateData.secrets, "utf8");
      if (typeof result.privateData.serverToken === "string") saveSecret(config.secretsPath,"RCM_TOKEN",config.token);
      // Restore only preferences this install owns. A backup from another install (an updating stable
      // package restored into one without an update channel, or an older version's setting) must not
      // fail the whole restore; malformed values are still rejected.
      const ownedSettings = backupServerSettings(config);
      for (const [name,value] of Object.entries(result.privateData.serverSettings??{})) {
        if (typeof value!=="string" || /[\r\n]/u.test(value)) throw new Error("Invalid backed up server preference");
        if (!Object.hasOwn(ownedSettings,name)) continue;
        saveSecret(config.secretsPath,name as `RCM_${string}`,value);
      }
      if (typeof result.privateData.voyageApiKey === "string") saveVoyageKey(config.secretsPath, result.privateData.voyageApiKey);
      for (const [provider, key] of Object.entries(result.privateData.llmApiKeys ?? {})) {
        if (typeof key === "string") saveSecret(config.secretsPath, `RCM_LLM_API_KEY_${provider.toUpperCase()}`, key);
      }
      return context.json({ ok: true, manifest: result.inspection.manifest, connection: result.inspection.privateData, pluginSettings: result.privateData.pluginSettings,
        vectorsRestored: result.vectorsRestored, restartRequired: true });
    } catch (error) {
      if (previousArchive) restoreCompleteArchive(db, previousArchive, albumPhotoStore);
      if (previousSecrets !== undefined) writeFileSync(config.secretsPath, previousSecrets, "utf8");
      else if (existsSync(config.secretsPath)) unlinkSync(config.secretsPath);
      if (!wasPaused) serverWorker.resume("backup-restore-rollback");
      throw error;
    }
  });
  app.post("/v1/import/chat",async(context)=>{
    const archive = new Uint8Array(await context.req.arrayBuffer());
    for (const chat of inspectCompleteArchive(archive).manifest.chats) assertChatUnlocked(db,chat.id);
    if (serverWorker.status.activeCalls > 0) return context.json({error:"보조 모델 처리가 끝난 뒤 복원해 주세요."},409);
    const wasPaused=serverWorker.status.state==="paused";
    serverWorker.pause("Restoring one chat backup");
    try {
      const result=restoreChatArchive(db,archive,albumPhotoStore);
      return context.json({ok:true,...result,serverInstanceId:serverInstanceId});
    } finally {if(!wasPaused)serverWorker.resume("chat-backup-restore");}
  });
  app.post("/v1/import/transplant", async (context) => {
    if (serverWorker.status.activeCalls > 0) return context.json({error:"보조 모델 처리가 끝난 뒤 복원해 주세요."},409);
    const sourceChatId = context.req.query("sourceChatId") ?? "";
    const targetChatId = context.req.query("targetChatId") ?? "";
    if (!sourceChatId || !targetChatId) return context.json({ error: "sourceChatId and targetChatId are required" }, 400);
    assertUserChat(db,sourceChatId); assertUserChat(db,targetChatId);
    assertChatUnlocked(db,sourceChatId); assertChatUnlocked(db,targetChatId);
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

  app.onError(async (error, context) => {
    if ((error as {code?:string}).code === 'INTERNAL_CHAT') return context.json({code:'INTERNAL_CHAT',error:error.message},403);
    const upgradeCode = (error as {code?:string}).code;
    if (upgradeCode && ['SOURCE_SNAPSHOT_HELD','CHAT_WORK_OFF','UPGRADE_ACTIVE','PHASE_LOCKED','SETUP_UNAVAILABLE','BACKUP_FAILED','SOURCE_MISSING','BUSY','ALREADY_CURRENT','RUN_NOT_FOUND','RUN_NOT_RESUMABLE','SOURCE_CHANGED','RUN_NOT_READY'].includes(upgradeCode)) {
      const reasons: Record<string,string> = {SETUP_UNAVAILABLE:'초기 설정 자료를 선택한 뒤 다시 시도해 주세요.',BACKUP_FAILED:'이 채팅의 백업을 만들지 못해서 다시 만들기를 시작하지 않았어요.'};
      return context.json({code:upgradeCode,error:reasons[upgradeCode] ?? error.message,lock:(error as any).lock,chatId:(error as any).chatId},upgradeCode === 'RUN_NOT_FOUND' ? 404 : upgradeCode === 'BACKUP_FAILED' ? 500 : 409);
    }
    if ((error as {code?:string}).code === 'CHAT_UPGRADING') {
      return context.json({code:'CHAT_UPGRADING',lock:(error as any).lock},423);
    }
    // Includes prepare failures from replayed audit checkpoints as well as completion.
    if (context.req.routePath.startsWith("/v1/jobs/:id/")) {
      const body = await context.req.json().catch(() => ({}));
      if (typeof body?.workerId === "string") resetRejectedJobCache(db, context.req.param("id")!, body.workerId, error);
    }
    const code = typeof (error as any)?.code === "string" ? (error as any).code : "REQUEST_FAILED";
    const summary = error instanceof ExtractionValidationError
      ? error.summary
      : error instanceof BackupValidationError ? `백업 검증 실패: ${error.message}`
        : code === 'RECONCILIATION_EVIDENCE_UNAVAILABLE' ? error.message
        : code === "LEASE_NOT_FOUND" ? "처리 작업의 임대가 만료됐어요."
          : "요청을 처리하지 못했어요.";
    console.error(`[RCM] Request failed code=${code} path=${context.req.path}`);
    const status = code === "LEASE_NOT_FOUND" ? 409 : error instanceof ViewPreferencesStorageError ? 500 : 400;
    return context.json({
      error: error instanceof Error ? error.message : String(error), code, summary,
      ...(Array.isArray((error as any).rejectedItems) ? {rejectedItems:(error as any).rejectedItems} : {}),
      ...(error instanceof ExtractionValidationError ? { issues: error.issues } : {}),
    }, status);
  });
  return app;
}
