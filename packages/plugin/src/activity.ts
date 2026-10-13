import { prefetchCurrentChatTranslations } from "./dashboard.js";
import { googleTranslationCooldownMs, prefetchTranslationRecords, type TranslationSource } from "./translation.js";
import { readCurrentChatId, readOptionalDashboardContext } from "./context.js";
import { SERVER_STATUS_TIMEOUT_MS, type ServerClient } from "./api-client.js";
import type { RuntimeState } from "./types.js";
import { reconcileAutomaticServerPause } from "./worker.js";
import { describeServerConnectionIssue, isServerConfigured, noteServerConnectionFailure, noteServerConnectionSuccess } from "./connection.js";
import { syncQuizEnabled } from "./quiz-sync.js";
import { isChatMemoryEnabled } from "./settings.js";
import { refreshUpdateStatus } from "./updates.js";

interface StatusResponse {
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
  progress?: NonNullable<RuntimeState["statusSummary"]>["progress"];
  initialCalibration?: NonNullable<RuntimeState["statusSummary"]>["initialCalibration"];
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

export function publishActivity(state: RuntimeState): void {
  state.activityRevision = (state.activityRevision ?? 0) + 1;
  state.refreshStatusWidget?.();
  for (const subscriber of state.activitySubscribers ?? []) subscriber(state.statusSummary);
}

export function publishStatusSummary(state: RuntimeState): void {
  state.statusSummaryRevision = (state.statusSummaryRevision ?? 0) + 1;
  publishActivity(state);
}

export function subscribeActivity(state: RuntimeState, subscriber: (summary: RuntimeState["statusSummary"]) => void): () => void {
  state.activitySubscribers ??= new Set();
  state.activitySubscribers.add(subscriber);
  return () => state.activitySubscribers?.delete(subscriber);
}

export function installActivityCoordinator(state: RuntimeState, client: ServerClient): void {
  if (state.activityTimer) clearTimeout(state.activityTimer);
  state.activitySubscribers ??= new Set();
  state.publishActivity = () => publishActivity(state);
  state.publishStatusSummary = () => publishStatusSummary(state);
  let previous = signature(state);
  let hostSelection: string | undefined;
  let unloaded = false;
  let prefetchBusy = false;
  let prefetchRevision: string | undefined;
  let prefetchPending: TranslationSource[] = [];
  let prefetchNextAt = 0;
  const poll = async () => {
    if (unloaded) return;
    try {
      // Chat switches need to update visibility even without a new RP request.
      const selection = await (async () => {
        const character = await risuai.getCurrentCharacterIndex();
        if (!Number.isInteger(character) || character < 0) return "none";
        const chat = await risuai.getCurrentChatIndex();
        return Number.isInteger(chat) && chat >= 0 ? `${character}:${chat}` : "none";
      })().catch(() => "none");
      // Only fetch transcript/context when selection changes, not every status poll.
      if (selection !== hostSelection || (selection !== "none" && !state.current)) {
        hostSelection = selection;
        const activeChatId = selection === "none" ? undefined : await readCurrentChatId().catch(() => undefined);
        if (activeChatId !== state.current?.chatId) {
          state.current = undefined;
          state.statusSummary = undefined;
          state.episodeActivity = null;
          state.refreshStatusWidget?.();
          if (activeChatId) await readOptionalDashboardContext(state);
        }
      }
      if (!isServerConfigured(state.settings)) {
        state.activityReady = true;
        state.activityStatusError = undefined;
        state.serverConnectionIssue = describeServerConnectionIssue(state.settings);
        state.serverConnectionFailureCount = 0;
        state.serverConnectionLastFailureAt = undefined;
      } else {
        if (state.settings.quizEnabled) await syncQuizEnabled(state, client);
        if (!state.current) state.quizSynced = undefined;
        const now = Date.now();
        // Release discovery is advisory and must never make the memory server look offline.
        void refreshUpdateStatus(state, client);
        if (state.current?.chatId && isChatMemoryEnabled(state.settings, state.current.chatId)) {
        const chatId = state.current.chatId;
        const startedRevision = state.statusSummaryRevision ?? 0;
        const result = await client.request<StatusResponse>(`/v1/chats/${encodeURIComponent(chatId)}/status`, {}, SERVER_STATUS_TIMEOUT_MS);
        if (state.current?.chatId !== chatId || (state.statusSummaryRevision ?? 0) !== startedRevision) {
          if (!unloaded) state.activityTimer = window.setTimeout(() => void poll(), isActive(state) ? 1_000 : 4_000);
          return;
        }
        state.statusSummary = {
          queuedJobs: Number(result.queuedJobs ?? 0), failedJobs: Number(result.failedJobs ?? 0), blockingFailedJobs: Number(result.blockingFailedJobs ?? result.failedJobs ?? 0), advisoryFailedJobs: Number(result.advisoryFailedJobs ?? 0),
          pendingReviews: Number(result.pendingReviews ?? 0), pendingReconciliations: Number(result.pendingReconciliations ?? 0), waitingForAssistant: Number(result.waitingForAssistant ?? 0), bufferedMessages: Number(result.bufferedMessages ?? 0), bufferedTurns: Number(result.bufferedTurns ?? 0), bufferedSourceTokens: Number(result.bufferedSourceTokens ?? 0), extractionGroupTurns: Number(result.extractionGroupTurns ?? 6), recoverableMessages: Number(result.recoverableMessages ?? 0), historicalBackfillMessages: Number(result.historicalBackfillMessages ?? 0), ingestionState: result.ingestionState, pendingEmbeddings: Number(result.pendingEmbeddings ?? 0),
          failedEmbeddings: Number(result.failedEmbeddings ?? 0),
          progress: result.progress ? {
            processedMessages: Number(result.progress.processedMessages ?? 0), totalMessages: Number(result.progress.totalMessages ?? 0),
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
          episode: result.episode ?? null,
        };
        state.episodeActivity = result.episode ?? null;
        const serverUrl = state.settings.serverUrl;
        const revision = JSON.stringify([serverUrl, result.serverInstanceId, chatId, result.translationRevision, state.settings.translationProvider]);
        if (!prefetchBusy && now >= prefetchNextAt && state.settings.autoTranslate && state.settings.translationDisplay === "ko"
          && result.memoryLanguage !== "ko" && Number(result.progress?.memories ?? 0) > 0 && result.serverInstanceId
          && (revision !== prefetchRevision || prefetchPending.length > 0)
          && !(state.settings.translationProvider === "google" && googleTranslationCooldownMs())) {
          prefetchBusy = true; prefetchNextAt = now + 30_000;
          const current = () => !unloaded && state.current?.chatId === chatId && state.settings.serverUrl === serverUrl
            && isChatMemoryEnabled(state.settings, chatId) && state.settings.autoTranslate && state.settings.translationDisplay === "ko";
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
        await client.request("/v1/health", {}, SERVER_STATUS_TIMEOUT_MS);
        state.activityReady = true;
        noteServerConnectionSuccess(state);
        }
        if (state.updateStatus?.restartRequired && !state.updateApplying && now >= (state.updateLocalRecheckAt ?? 0)) {
          state.updateLocalRecheckAt = now + 4_000;
          void refreshUpdateStatus(state, client, { remote: false, force: true });
        }
      }
    } catch (error) {
      state.activityReady = true;
      noteServerConnectionFailure(state, state.settings, error);
    }
    const next = signature(state);
    if (next !== previous) {
      previous = next;
      publishActivity(state);
    } else state.refreshStatusWidget?.();
    if (!unloaded) state.activityTimer = window.setTimeout(() => void poll(), isActive(state) ? 1_000 : 4_000);
  };
  void poll();
  void risuai.onUnload(() => { unloaded = true; if (state.activityTimer) clearTimeout(state.activityTimer); });
}
