import { publishActivity, publishStatusSummary, stopDeletedHostChatWork } from "./activity-state.js";
export { publishActivity, publishStatusSummary, subscribeActivity, stopDeletedHostChatWork } from "./activity-state.js";
import { prefetchCurrentChatTranslations } from "./dashboard.js";
import { observeSetupAttention } from "./setup-sources.js";
import { backgroundTranslationEnabled, googleTranslationCooldownMs, prefetchTranslationRecords, type TranslationSource } from "./translation.js";
import { observeCurrentHostGeneration, readCurrentChatPresence, readOptionalDashboardContext } from "./context.js";
import { SERVER_STATUS_TIMEOUT_MS, ServerRequestError, type ServerClient } from "./api-client.js";
import type { RuntimeState } from "./types.js";
import { reconcileAutomaticServerPause } from "./worker.js";
import { ServerCompatibilityError, isServerApiIncompatible, describeServerConnectionIssue, isServerConfigured, noteServerConnectionFailure, noteServerConnectionSuccess } from "./connection.js";
import { syncQuizEnabled } from "./quiz-sync.js";
import { isChatMemoryEnabled, saveSettings } from "./settings.js";
import { refreshUpdateStatus } from "./updates.js";
import { currentLineageOperation, needsOpenedChatResolution, resolveOpenedChat, reconcileLineageOperation } from "./lineage-settings.js";

interface StatusResponse {
  auxiliaryAuthFailed?: boolean;
  modelResponseDiagnostic?: import("@rcm/shared").ModelResponseDiagnostic;
    lastJobSourceRecovery?: import("@rcm/shared").SourceRecoveryMetadata;
  serverInstanceId: string;
  memoryLanguage: TranslationSource["sourceLanguage"];
  translationRevision: string;
  queuedJobs: number;
  failedJobs: number;
  blockingFailedJobs?: number;
  advisoryFailedJobs?: number;
  pendingReviews: number;
  pendingReconciliations?: number;
  waitingForAssistant?: number;
  bufferedMessages?: number;
  bufferedTurns?: number;
  bufferedSourceTokens?: number;
  extractionGroupTurns?: number;
  recoverableMessages?: number;
  historicalBackfillMessages?: number;
  ingestionState?: "historical_pending" | "managed" | "cleared";
  pendingEmbeddings: number;
  failedEmbeddings: number;
  embeddingError?: string;
  progress?: NonNullable<RuntimeState["statusSummary"]>["progress"];
  initialCalibration?: NonNullable<RuntimeState["statusSummary"]>["initialCalibration"];
  lineage?: NonNullable<RuntimeState["statusSummary"]>["lineage"];
  worker: RuntimeState["serverWorker"];
  episode?: RuntimeState["episodeActivity"];
}

const signature = (state: RuntimeState): string => JSON.stringify({
  summary: state.statusSummary,
  worker: state.serverWorker,
  job: state.currentJob?.id,
  busy: state.workerBusy,
  ready: state.activityReady,
  error: state.activityStatusError,
  connection: state.serverConnectionIssue,
  update: state.updateStatus,
  updateApplying: state.updateApplying,
  memoryToolRegistration: [state.memoryToolRegistration?.status, state.memoryToolRegistration?.failures],
});

function isActive(state: RuntimeState): boolean {
  const summary = state.statusSummary;
  return state.workerBusy
    || !!state.currentJob
    || (state.serverWorker?.activeCalls ?? 0) > 0
    || (state.serverWorker?.queuedJobs ?? 0) > 0
    || (summary?.queuedJobs ?? 0) > 0
    || summary?.initialCalibration?.status === "queued"
    || (summary?.pendingEmbeddings ?? 0) > 0;
}

export function installActivityCoordinator(state: RuntimeState, client: ServerClient): void {
  if (state.activityTimer) clearTimeout(state.activityTimer);
  state.activitySubscribers ??= new Set();
  state.publishActivity = () => publishActivity(state);
  state.publishStatusSummary = () => publishStatusSummary(state);
  let previous = signature(state);
  let hostSelection: string | undefined;
  const hostInventories = new Map<string, Set<string>>();
  const syncedTitles = new Map<string,string>();
  let unloaded = false;
  let prefetchBusy = false;
  let prefetchRevision: string | undefined;
  let prefetchPending: TranslationSource[] = [];
  let prefetchNextAt = 0;
  const poll = async () => {
    if (unloaded) return;
    try {
      if (state.mainGeneration) await observeCurrentHostGeneration(state);
      // Chat switches need to update visibility even without a new RP request.
      const selection = await (async () => {
        const character = await risuai.getCurrentCharacterIndex();
        if (!Number.isInteger(character) || character < 0) return "none";
        const chat = await risuai.getCurrentChatIndex();
        return Number.isInteger(chat) && chat >= 0 ? `${character}:${chat}` : "none";
      })().catch(() => "none");
      // Branching/copying can replace the chat at the same host indices.
      const presence = selection === "none" ? undefined : await readCurrentChatPresence().catch(() => undefined);
      const activeChatId = presence?.chatId;
      if (presence?.chatTitle && isServerConfigured(state.settings) && currentLineageOperation(state)?.status !== 'running') {
        const key = `${state.settings.serverUrl}\0${presence.chatId}`;
        if (syncedTitles.get(key) !== presence.chatTitle) {
          const result = await client.request<{ok:boolean}>(`/v1/chats/${encodeURIComponent(presence.chatId)}/title`, {
            method:'PUT',body:JSON.stringify({chatTitle:presence.chatTitle}),
          }).catch(error => { if (error instanceof ServerRequestError && error.status === 404) return {ok:false}; throw error; });
          if (result.ok) syncedTitles.set(key,presence.chatTitle);
          if (state.current?.chatId === presence.chatId) state.current.chatTitle = presence.chatTitle;
        }
      }
      if (presence?.inventory && isServerConfigured(state.settings)) {
        const { characterId, chatIds } = presence.inventory;
        const ids = new Set(chatIds);
        const removed = [...(hostInventories.get(characterId) ?? [])].filter(id => !ids.has(id));
        if (removed.length) {
          // Only disappearance from two complete inventories is authoritative.
          // Keep the archive; stop work and revoke leases before removing jobs.
          for (const id of removed) await stopDeletedHostChatWork(state, client, id);
        }
        hostInventories.set(characterId, ids);
      }
      if (selection !== hostSelection || activeChatId !== state.current?.chatId) {
        hostSelection = selection;
        if (activeChatId !== state.current?.chatId) {
          state.current = undefined;
          state.statusSummary = undefined;
          state.lastPrepare = undefined;
          state.chatOpen = undefined;
          state.lineageOperation = undefined;
          state.activityReady = false;
          state.episodeActivity = null;
          state.refreshStatusWidget?.();
          if (activeChatId) await readOptionalDashboardContext(state);
          publishActivity(state);
        }
      }
      if (!isServerConfigured(state.settings)) {
        state.activityReady = true;
        state.activityStatusError = undefined;
        state.serverConnectionIssue = describeServerConnectionIssue(state.settings);
        state.serverConnectionFailureCount = 0;
        state.serverConnectionLastFailureAt = undefined;
      } else {
        if (!state.current) state.quizSynced = undefined;
        const now = Date.now();
        // Release discovery is advisory and must never make the memory server look offline.
        if (!isServerApiIncompatible(state) || state.serverConnectionIssue?.requiredUpdate !== "plugin") void refreshUpdateStatus(state, client);
        if (isServerApiIncompatible(state)) {
          const health = await client.request<{ apiRevision: number }>("/v1/health", {}, SERVER_STATUS_TIMEOUT_MS);
          const mismatch = new ServerCompatibilityError(health.apiRevision);
          if (mismatch.receivedRevision !== mismatch.expectedRevision) throw mismatch;
          state.activityReady = true;
          noteServerConnectionSuccess(state);
        } else if (state.current?.chatId && isChatMemoryEnabled(state.settings, state.current.chatId, state.current.characterId)) {
        const chatId = state.current.chatId;
        if (currentLineageOperation(state)?.status === "running") {
          state.activityTimer = window.setTimeout(() => void poll(), 1_000);
          return;
        }
        const startedRevision = state.statusSummaryRevision ?? 0;
        let result = await client.request<StatusResponse>(`/v1/chats/${encodeURIComponent(chatId)}/status`, {}, SERVER_STATUS_TIMEOUT_MS);
        if (needsOpenedChatResolution(state, result.initialCalibration, result.lineage)) {
          void resolveOpenedChat(state, client).catch(() => undefined); // operation owns visible errors
          state.activityTimer = window.setTimeout(() => void poll(), 1_000);
          return;
        }
        if (state.current?.chatId !== chatId || (state.statusSummaryRevision ?? 0) !== startedRevision) {
          if (!unloaded) state.activityTimer = window.setTimeout(() => void poll(), isActive(state) ? 1_000 : 4_000);
          return;
        }
        observeSetupAttention(state, chatId, result.initialCalibration?.status, result.lineage);
        reconcileLineageOperation(state,chatId,result.lineage);
        state.statusSummary = {
          queuedJobs: Number(result.queuedJobs ?? 0), failedJobs: Number(result.failedJobs ?? 0), blockingFailedJobs: Number(result.blockingFailedJobs ?? result.failedJobs ?? 0), advisoryFailedJobs: Number(result.advisoryFailedJobs ?? 0),
          pendingReviews: Number(result.pendingReviews ?? 0), pendingReconciliations: Number(result.pendingReconciliations ?? 0), waitingForAssistant: Number(result.waitingForAssistant ?? 0), bufferedMessages: Number(result.bufferedMessages ?? 0), bufferedTurns: Number(result.bufferedTurns ?? 0), bufferedSourceTokens: Number(result.bufferedSourceTokens ?? 0), extractionGroupTurns: Number(result.extractionGroupTurns ?? 6), recoverableMessages: Number(result.recoverableMessages ?? 0), historicalBackfillMessages: Number(result.historicalBackfillMessages ?? 0), ingestionState: result.ingestionState, pendingEmbeddings: Number(result.pendingEmbeddings ?? 0),
          failedEmbeddings: Number(result.failedEmbeddings ?? 0),
          embeddingError: result.embeddingError,
          auxiliaryAuthFailed: result.auxiliaryAuthFailed === true,
          modelResponseDiagnostic: result.modelResponseDiagnostic,
          lastJobSourceRecovery: result.lastJobSourceRecovery,
          progress: result.progress ? {
            manualRetry: result.progress.manualRetry === true,
            excludedMessages: Number(result.progress.excludedMessages ?? 0), processedMessages: Number(result.progress.processedMessages ?? 0), totalMessages: Number(result.progress.totalMessages ?? 0),
            processedGroups: Number(result.progress.processedGroups ?? 0), totalGroups: Number(result.progress.totalGroups ?? 0),
            failedGroups: Number(result.progress.failedGroups ?? 0), memories: Number(result.progress.memories ?? 0),
            details: Number(result.progress.details ?? 0), pendingRelationshipPairs: Number(result.progress.pendingRelationshipPairs ?? 0),
            pendingRelationshipProjectionJobs: Number(result.progress.pendingRelationshipProjectionJobs ?? 0),
            processedTasks: Number(result.progress.processedTasks ?? 0), totalTasks: Number(result.progress.totalTasks ?? 0),
            failedTasks: Number(result.progress.failedTasks ?? 0), activeStage: result.progress.activeStage,
            activeGroupOrdinal: Number(result.progress.activeGroupOrdinal ?? 0) || undefined, activeGroupTotal: Number(result.progress.activeGroupTotal ?? 0) || undefined,
            retryAttempt: Number(result.progress.retryAttempt ?? 0) || undefined, retryMax: Number(result.progress.retryMax ?? 0) || undefined,
            ledgerProcessed: Number(result.progress.ledgerProcessed ?? 0), ledgerTotal: Number(result.progress.ledgerTotal ?? 0), ledgerFailed: Number(result.progress.ledgerFailed ?? 0), downstreamWaiting: result.progress.downstreamWaiting === true,
            relationshipProcessed: Number(result.progress.relationshipProcessed ?? 0), relationshipTotal: Number(result.progress.relationshipTotal ?? 0), relationshipFailed: Number(result.progress.relationshipFailed ?? 0),
            storyProcessed: Number(result.progress.storyProcessed ?? 0), storyTotal: Number(result.progress.storyTotal ?? 0), storyPending: Number(result.progress.storyPending ?? 0), storyFailed: Number(result.progress.storyFailed ?? 0),
            llmCalls: Number(result.progress.llmCalls ?? 0), repairCalls: Number(result.progress.repairCalls ?? 0), runComplete: result.progress.runComplete === true,
            acknowledged: result.progress.acknowledged === true, backfillRunId: typeof result.progress.backfillRunId === "string" ? result.progress.backfillRunId : undefined,
          } : undefined,
          initialCalibration: result.initialCalibration,
          lineage: result.lineage,
          episode: result.episode ?? null,
        };
        state.episodeActivity = result.episode ?? null;
        const serverUrl = state.settings.serverUrl;
        const revision = JSON.stringify([serverUrl, result.serverInstanceId, chatId, result.translationRevision, state.settings.translationProvider]);
        if (backgroundTranslationEnabled(state) && !prefetchBusy && now >= prefetchNextAt && state.settings.autoTranslate && state.settings.translationDisplay === "ko"
          && result.memoryLanguage !== "ko" && Number(result.progress?.memories ?? 0) > 0 && result.serverInstanceId
          && (revision !== prefetchRevision || prefetchPending.length > 0)
          && !(state.settings.translationProvider === "google" && googleTranslationCooldownMs())) {
          prefetchBusy = true; prefetchNextAt = now + 30_000;
          const current = () => !unloaded && state.current?.chatId === chatId && state.settings.serverUrl === serverUrl
            && isChatMemoryEnabled(state.settings, chatId, state.current?.chatId === chatId ? state.current.characterId : undefined) && state.settings.autoTranslate && state.settings.translationDisplay === "ko";
          const work = revision !== prefetchRevision
            ? prefetchCurrentChatTranslations(state, client, chatId, { serverInstanceId: result.serverInstanceId, memoryLanguage: result.memoryLanguage }, current)
            : prefetchTranslationRecords(state, prefetchPending, current);
          void work.then(pending => { if (current()) { prefetchRevision = revision; prefetchPending = pending; } })
            .catch(() => undefined).finally(() => { prefetchBusy = false; });
        }
        state.serverWorker = result.worker;
        await reconcileAutomaticServerPause(state, client, {
          failedJobs: Number(result.blockingFailedJobs ?? result.failedJobs ?? 0),
          worker: result.worker,
          available: true,
        });
        state.activityReady = true;
        noteServerConnectionSuccess(state);
        } else {
        const health = await client.request<{ apiRevision?: number }>("/v1/health", {}, SERVER_STATUS_TIMEOUT_MS);
        if (health.apiRevision !== undefined) {
          const mismatch = new ServerCompatibilityError(health.apiRevision);
          if (mismatch.receivedRevision !== mismatch.expectedRevision) throw mismatch;
        }
        state.activityReady = true;
        noteServerConnectionSuccess(state);
        }
        if (!isServerApiIncompatible(state) && state.settings.quizEnabled) await syncQuizEnabled(state, client);
        if (state.updateStatus?.restartRequired && !state.updateApplying && now >= (state.updateLocalRecheckAt ?? 0)) {
          state.updateLocalRecheckAt = now + 4_000;
          void refreshUpdateStatus(state, client, { remote: false, force: true });
        }
      }
    } catch (error) {
      state.activityReady = true;
      if (!(error instanceof ServerCompatibilityError) && (error as { code?: string })?.code === "API_REVISION_MISMATCH") {
        try {
          const health = await client.request<{ apiRevision: number }>("/v1/health", {}, SERVER_STATUS_TIMEOUT_MS);
          error = new ServerCompatibilityError(health.apiRevision);
        } catch { /* Keep the authenticated protocol rejection if health is unavailable. */ }
      }
      noteServerConnectionFailure(state, state.settings, error);
    }
    const next = signature(state);
    if (next !== previous) {
      previous = next;
      publishActivity(state);
    } else state.refreshStatusWidget?.();
    if (!unloaded) state.activityTimer = window.setTimeout(() => void poll(), isServerApiIncompatible(state) ? 4_000 : isActive(state) ? 1_000 : 4_000);
  };
  void poll();
  void risuai.onUnload(() => { unloaded = true; if (state.activityTimer) clearTimeout(state.activityTimer); });
}
