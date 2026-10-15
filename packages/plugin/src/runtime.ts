import { supportFailure } from "./support-diagnostics.js";
declare const __RCM_DISTRIBUTION__: boolean;
import { withMemoryGuidance } from "@rcm/shared";
import { estimateTokens, type TurnPrepareResponse } from "@rcm/shared";
import { ServerClient, type PrepareClientTimings } from "./api-client.js";
import { injectMemory, inspectMemoryPrompt, makePrepareRequest, protectedPromptSourceMessageIds, readCurrentChatId, readCurrentContext, resolvedSetupProjection, sha256, stripRcmPromptContent, observeCurrentHostGeneration, messageRole } from "./context.js";
import { CACHE_KEY, addLog, isChatMemoryEnabled, loadSettings, loadStoredJson, saveSettings, saveStoredJson } from "./settings.js";
import type { CachedChatState, RuntimeState } from "./types.js";
import { beginMainGeneration, clearMainGeneration, endMainGeneration, isInternalModelRequest, scheduleWorker } from "./worker.js";
import { inheritLineageSettings } from "./lineage-settings.js";
import { beginMemoryReferenceTurn, currentTurnMemoryToolNames, renderMemoryReferences } from "./mcp.js";
import { isServerConfigured } from "./connection.js";
import { observeProviderRequest } from "./provider-observation.js";
import { finishTiming, startTiming } from "./timing.js";
import { syncQuizEnabled } from "./quiz-sync.js";
import { summarizeInjectedScenes } from "./turn-delivery.js";

const emptyInjectionManifest = (source: "fresh" | "reused" | "fallback" | "empty") => ({
  source, perspectives: [], memoryIds: [], detailIds: [], atomKeys: [], storySpineNodeIds: [], relationshipPairs: [], beliefIds: [], assertionIds: [], promiseIds: [], intimacyMilestoneIds: [],
});

function hasMemoryEvidence(packet: string): boolean {
  return packet
    .replace(/<\/?rp_memory_context\b[^>]*>/gi, "")
    .replace(/<guidance>[\s\S]*?<\/guidance>/gi, "")
    .trim().length > 0;
}

function completeTopLevelXmlSections(text: string): string[] {
  const sections: string[] = [];
  const tags = text.matchAll(/<\/?([A-Za-z_][\w:.-]*)\b[^>]*>/g);
  let depth = 0;
  let start = -1;
  for (const match of tags) {
    const tag = match[0];
    const closing = tag.startsWith("</");
    const selfClosing = /\/\s*>$/.test(tag);
    if (!closing && depth === 0) start = match.index ?? -1;
    if (!closing && !selfClosing) depth += 1;
    else if (closing) depth = Math.max(0, depth - 1);
    if (start >= 0 && depth === 0) {
      const end = (match.index ?? 0) + tag.length;
      sections.push(text.slice(start, end).trim());
      start = -1;
    }
  }
  return sections;
}

export function clampPacket(text: string, budget: number): string {
  if (estimateTokens(text) <= budget) return text;
  const sections = completeTopLevelXmlSections(text);
  if (sections.length === 0) return "";
  const accepted: string[] = [];
  for (const section of sections) {
    const candidate = accepted.concat(section).join("\n");
    if (estimateTokens(candidate) > budget) continue;
    accepted.push(section);
  }
  return accepted.join("\n");
}

async function persistCache(state: RuntimeState): Promise<void> {
  try {
    await saveStoredJson(CACHE_KEY, state.cache);
  } catch (error) {
    addLog(state.logs, "warn", `Injection inspector cache was not persisted: [오류 원문 제외]`);
  }
}

export const MISSING_RCM_MARKER_MESSAGE = "RCM이 이 채팅에서 켜져 있지만 최종 프롬프트에서 [[RCM]] 위치 표식을 찾지 못했습니다. 프리셋·카드·로어북에 [[RCM]]을 추가하거나 이 채팅의 RCM을 끈 뒤 다시 보내세요.";
export const MEMORY_INJECTION_BLOCKED_MESSAGE = "RCM 기억을 준비하거나 최종 프롬프트에 넣지 못해 모델 요청을 차단했습니다. 메인 모델 요청은 전송하지 않았습니다. 서버 연결과 RCM 상태를 확인한 뒤 다시 보내세요.";
export const RCM_INITIALIZING_MESSAGE = "RCM이 아직 초기화 중이어서 모델 요청을 차단했습니다. 잠시 후 다시 보내세요.";

export class MissingRcmMarkerError extends Error {
  constructor() {
    super(MISSING_RCM_MARKER_MESSAGE);
    this.name = "MissingRcmMarkerError";
  }
}

function traceAutomaticInjection(state: RuntimeState, client: ServerClient, latestMessageId: string | undefined): void {
  if (!state.lastInjection) return;
  const injection = state.lastInjection;
  // Receipt metadata drives cooldown even when private diagnostic prose is disabled.
  if (!state.retrievalTraceEnabled || typeof __RCM_DISTRIBUTION__ !== "undefined" && __RCM_DISTRIBUTION__) {
    if (!injection.blocked && !injection.omitted && ["fresh", "reused"].includes(injection.prepareOutcome ?? "")) {
      void client.traceRetrieval({ id: injection.prepareRequestId ?? injection.turnKey, kind: "automatic_injection",
        chatId: injection.chatId, receiptOnly: true, prepareOutcome: injection.prepareOutcome, blocked: false, omitted: false,
        manifest: { memoryIds: injection.manifest.memoryIds } }).catch(error => addLog(state.logs, "warn", `Memory delivery receipt failed: [오류 원문 제외]`));
    }
    if (typeof __RCM_DISTRIBUTION__ !== "undefined" && __RCM_DISTRIBUTION__) return;
  }
  const failedPrepare = injection.prepareOutcome === "timeout" || injection.prepareOutcome === "error";
  injection.clientStages ??= { response: "not_requested", body: "not_read", json: "not_parsed", schema: "not_parsed", packet: injection.omitted ? "omitted" : "injected", registration: "not_run", diagnostic: "not_queued" };
  if (!state.retrievalTraceEnabled && !failedPrepare && !injection.blocked) return;
  const eventId = crypto.randomUUID();
  const requestId = injection.prepareRequestId ?? injection.turnKey;
  const startedAt = Date.now();
  const deliveryStartedAt = performance.now();
  injection.clientStages.diagnostic = "queued";
  injection.traceDelivery = { eventId, requestId, status: "queued", startedAt };
  void client.traceRetrieval({
    id: eventId,
    kind: "automatic_injection",
    chatId: injection.chatId,
    traceContext: {
      requestId,
      turnKey: injection.turnKey,
      latestMessageId,
    },
    searchRequestId: injection.prepareRequestId,
    requestedBudget: injection.requestedBudget,
    targetBudget: injection.requestedBudget,
    hardTokenCeiling: Math.floor(injection.requestedBudget * 115 / 100),
    preparedTokens: injection.preparedTokens,
    injectedTokens: injection.injectedTokens,
    removedTokens: injection.removedTokens,
    reused: injection.reused,
    prepareElapsedMs: injection.prepareElapsedMs,
    prepareTimeoutMs: injection.prepareTimeoutMs,
    prepareClientTimings: injection.prepareClientTimings,
    prepareOutcome: injection.prepareOutcome,
    prepareError: injection.prepareError,
    clientStages: injection.clientStages,
    packetApplyMs: injection.packetApplyMs,
    memoryToolRegistrationMs: injection.memoryToolRegistrationMs,
    traceDelivery: injection.traceDelivery,
    fallbackTokens: failedPrepare ? injection.preparedTokens : 0,
    omitted: injection.omitted,
    omissionReason: injection.omissionReason,
    blocked: injection.blocked,
    blockReason: injection.blockReason,
    manifest: injection.manifest,
    packet: injection.packet,
  }).then(() => {
    const elapsedMs = performance.now() - deliveryStartedAt;
    injection.traceDelivery = { eventId, requestId, status: "succeeded", startedAt, elapsedMs };
    addLog(state.logs, "info", `Retrieval trace delivered requestId=${requestId} eventId=${eventId} in ${elapsedMs}ms`);
  }, (error) => {
    const message = String(error).replace(/\s+/g, " ").slice(0, 240);
    injection.traceDelivery = { eventId, requestId, status: "failed", startedAt, elapsedMs: performance.now() - deliveryStartedAt, error: message };
    addLog(state.logs, "warn", `Retrieval trace delivery failed requestId=${requestId} eventId=${eventId}: ${message}`);
  });
}

async function traceObservedProviderRequest(state: RuntimeState, client: ServerClient, request: NonNullable<RuntimeState["activeModelRequest"]>, endedAt: number): Promise<void> {
  if (typeof __RCM_DISTRIBUTION__ !== "undefined" && __RCM_DISTRIBUTION__) return;
  if (!state.retrievalTraceEnabled || !request.packet || !request.startedAt || typeof risuai.getFetchLogs !== "function") return;
  let observation;
  try { observation = observeProviderRequest(await risuai.getFetchLogs(), request.packet, request.startedAt, endedAt); }
  catch { observation = { status: "read_error" as const }; }
  await client.traceRetrieval({
    id: crypto.randomUUID(), kind: "tool_exposure", chatId: request.chatId,
    traceContext: { requestId: request.turnKey ?? "provider-observation", turnKey: request.turnKey ?? "provider-observation", latestMessageId: request.latestMessageId },
    transport: "provider_request", plannedTools: request.plannedTools ?? [],
    observationStatus: observation.status,
    ...(observation.status === "observed" ? { actualTools: observation.actualTools ?? [], toolDescriptionMatches: observation.toolDescriptionMatches, providerTimestamp: observation.timestamp, providerLogIndex: observation.logIndex } : {}),
    outcome: observation.status === "observed" ? "provider_observed" : "provider_unconfirmed",
  }).catch(() => undefined);
}

export class MemoryInjectionBlockedError extends Error {
  constructor(detail?: string) {
    super(detail ? `${MEMORY_INJECTION_BLOCKED_MESSAGE} (${detail})` : MEMORY_INJECTION_BLOCKED_MESSAGE);
    this.name = "MemoryInjectionBlockedError";
  }
}

export const PREPARE_CHOICE_VISIBLE_MS = 30_000;
export const PREPARE_CHOICE_BLOCK_MS = 180_000;

class PrepareChoiceError extends Error {
  constructor(readonly choice: "omit" | "block") {
    super(choice === "omit" ? "User chose to send without memory" : "Memory preparation send cancelled");
    this.name = "AbortError";
  }
}

/** One user decision/deadline across both initial and inherited prepare requests. */
function prepareChoice(state: RuntimeState, requestId: string, chatId: string, epoch: number, requestSignal: AbortSignal) {
  if (state.modelRequestEpoch !== epoch || requestSignal.aborted) throw new MemoryInjectionBlockedError("request replaced before prepare");
  const controller = new AbortController();
  let rejectChoice!: (error: PrepareChoiceError) => void;
  const decision = new Promise<never>((_, reject) => { rejectChoice = reject; });
  let disposed = false;
  const pending: NonNullable<RuntimeState["pendingPrepare"]> = {
    requestId, chatId, startedAt: Date.now(), visible: false,
    choose(choice) {
      if (controller.signal.aborted || disposed) return;
      const error = new PrepareChoiceError(choice);
      rejectChoice(error);
      controller.abort(error);
    },
  };
  state.pendingPrepare = pending;
  const show = setTimeout(() => {
    if (state.pendingPrepare !== pending || controller.signal.aborted) return;
    pending.visible = true;
    state.refreshStatusWidget?.();
  }, PREPARE_CHOICE_VISIBLE_MS);
  const block = setTimeout(() => pending.choose("block"), PREPARE_CHOICE_BLOCK_MS);
  const dispose = () => {
    disposed = true;
    clearTimeout(show); clearTimeout(block);
    requestSignal.removeEventListener("abort", cancel);
    if (state.pendingPrepare === pending) state.pendingPrepare = undefined;
    state.refreshStatusWidget?.();
  };
  const cancel = () => { pending.choose("block"); dispose(); };
  requestSignal.addEventListener("abort", cancel, { once: true });
  return {
    run: (body: Parameters<ServerClient["prepare"]>[0], timings: PrepareClientTimings | undefined, client: ServerClient) =>
      Promise.race([client.prepare(body, null, timings, controller.signal), decision]),
    check() { if (controller.signal.aborted) throw controller.signal.reason; },
    dispose,
  };
}

/**
 * Install this before reading plugin storage. It closes the otherwise avoidable
 * reload window in which a model request can start while the real hook is still
 * waiting for settings/cache hydration.
 */
export function installInitializationRequestGate(isReady: () => boolean): Promise<void> {
  return risuai.addRisuReplacer("beforeRequest", async (messages, type) => {
    if (type === "model" && !isReady()) throw new MemoryInjectionBlockedError(RCM_INITIALIZING_MESSAGE);
    return messages;
  });
}

function isIntentionalEmptyPrepare(response: TurnPrepareResponse | undefined): boolean {
  return response?.packet.trim().length === 0
    && (response.omissionReason === "no_memories" || response.omissionReason === "no_relevance");
}

function isPreparedContextRetry(state: RuntimeState, chatId: string, contexts: string[]): boolean {
  const prepared = state.automaticTurnPacket;
  const injection = state.lastInjection;
  if (!prepared || prepared.chatId !== chatId || !injection || injection.chatId !== chatId
    || (prepared.memoryOnlyInjection ?? false) !== (state.settings.memoryOnlyInjection[chatId] ?? false)
    || injection.turnKey !== prepared.turnKey || injection.omitted || contexts.length !== 1) return false;
  return contexts[0]!.trim() === injection.packet.trim();
}

function reuseExistingContext(state: RuntimeState, client: ServerClient, messages: OpenAIChat[], chatId: string): OpenAIChat[] {
  const injected = injectMemory(messages, "", 0, 0);
  const automatic = state.automaticTurnPacket;
  const previous = state.lastInjection;
  state.lastPromptValidation = { chatId, status: "existing_context", at: Date.now() };
  state.activeModelRequest = {
    chatId, requestId: state.mainGeneration?.id, turnKey: automatic?.turnKey ?? previous?.turnKey,
    latestMessageId: automatic?.latestMessageId ?? state.current?.snapshot?.at(-1)?.id,
    startedAt: Date.now(), packet: injected.packet,
    plannedTools: currentTurnMemoryToolNames(state, chatId),
  };
  state.lastInjection = {
    turnKey: automatic?.turnKey ?? previous?.turnKey ?? "existing-context",
    chatId,
    packet: injected.packet,
    requestedBudget: automatic?.requestedBudget ?? previous?.requestedBudget ?? injected.injectedTokens,
    preparedTokens: injected.injectedTokens,
    injectedTokens: injected.injectedTokens,
    removedTokens: 0,
    reused: true,
    prepareElapsedMs: 0,
    prepareRequestId: automatic?.response.retrievalTrace?.requestId ?? previous?.prepareRequestId,
    prepareOutcome: "reused",
    clientStages: { response: "not_requested", body: "not_read", json: "not_parsed", schema: "not_parsed", packet: "injected", registration: "not_run", diagnostic: "not_queued" },
    omitted: false,
    guidanceInjected: injected.packet.includes("<guidance>"),
    evidenceInjected: hasMemoryEvidence(injected.packet),
    manifest: automatic?.response.injectionManifest ? { ...automatic.response.injectionManifest, source: "reused" } : emptyInjectionManifest("reused"),
    stateSnapshots: automatic?.response.stateSnapshots ?? (previous?.packet === injected.packet ? previous.stateSnapshots : []),
    at: Date.now(),
  };
  const serverUrl = state.settings.serverUrl.replace(/\/$/, "");
  state.cache[chatId] = { ...(state.cache[chatId] ?? { serverInstanceId: automatic?.response.serverInstanceId ?? state.settings.serverInstances[serverUrl], stableAnchors: "", lastPacket: injected.packet, lastRevision: 0, lastPreparedAt: Date.now() }), lastPacket: injected.packet, lastInjectionManifest: state.lastInjection.manifest, lastInjectionScenes: summarizeInjectedScenes(automatic?.response.selected), lastInjectionStateSnapshots: state.lastInjection.stateSnapshots, lastInjectedTokens: injected.injectedTokens, lastInjectionAt: state.lastInjection.at };
  void persistCache(state);
  traceAutomaticInjection(state, client, state.automaticTurnPacket?.latestMessageId ?? state.current?.snapshot?.at(-1)?.id);
  addLog(state.logs, "info", `Reused ~${injected.injectedTokens} memory tokens from the prepared request`);
  return injected.messages;
}

async function syncCommittedOutput(state: RuntimeState, client: ServerClient, chatId: string): Promise<void> {
  if (state.unloaded) return;
  try {
    const context = await readCurrentContext(state);
    if (state.unloaded) return;
    if (context.chatId !== chatId || !isChatMemoryEnabled(state.settings, context.chatId)) {
      addLog(state.logs, "info", `Post-response memory sync skipped for inactive chat ${chatId}`);
      return;
    }
    state.current = context;
    void syncQuizEnabled(state, client).catch(() => undefined);
    await client.prepare(makePrepareRequest(context, 0, { deferExtraction: false }), 5_000);
  } catch (error) {
    addLog(state.logs, "warn", `Post-response memory sync deferred: [오류 원문 제외]`);
  } finally {
    scheduleWorker(state, client);
  }
}

export async function createRuntime(): Promise<{ state: RuntimeState; client: ServerClient }> {
  const settings = await loadSettings();
  const cache = await loadStoredJson<Record<string, CachedChatState>>(CACHE_KEY) ?? {};
  const state: RuntimeState = {
    settings,
    cache,
    logs: [],
    retryCounts: {},
    workerId: crypto.randomUUID(),
    workerBusy: false,
    mcpTurnKey: "",
    mcpTraceCalls: 0,
    mcpReturnedMemoryIds: [],
    mcpReturnedMemorySignatures: [],
    mcpReturnedAtomKeys: [],
    mcpReturnedSourceRanges: [],



    memoryToolAvailability: {},
    memoryToolExposureKeys: {},

    activeMemoryLanguages: {},
    lastPromptSourceMessageIds: [],
    internalModelCalls: new Set(),
  };
  return { state, client: new ServerClient(() => state.settings) };
}

export function installRequestHooks(state: RuntimeState, client: ServerClient): Promise<void[]> {
  const hasCommittedOutputListener = typeof risuai.addRisuChatListener === "function";
  return Promise.all([
    ...(typeof risuai.onUnload === "function" ? [risuai.onUnload(() => {
      state.unloaded = true;
      state.mainRequest?.cancel();
      state.pendingPrepare?.choose("block");
      state.modelRequestEpoch = (state.modelRequestEpoch ?? 0) + 1;
      clearMainGeneration(state); // Unload wakes waiters without scheduling a resume.
      clearTimeout(state.idleTimer); state.idleTimer = undefined;
      clearTimeout(state.postResponseTimer); state.postResponseTimer = undefined;
      clearTimeout(state.activityTimer); state.activityTimer = undefined;
      clearInterval(state.serverHeartbeatTimer); state.serverHeartbeatTimer = undefined;
      clearInterval(state.statusWidgetTimer); state.statusWidgetTimer = undefined;
      clearInterval(state.leaseHeartbeatTimer); state.leaseHeartbeatTimer = undefined;
      state.pendingPrepare = undefined;
      state.mainRequest = undefined;
      state.activeModelRequest = undefined;
      state.automaticTurnPacket = undefined;
      state.pendingOutputSyncChatId = undefined;
      state.pendingOutputSyncRequestId = undefined;
    })] : []),
    risuai.addRisuReplacer("beforeRequest", async (messages, type) => {
      if (type !== "model") return messages;
      if (state.unloaded) throw new MemoryInjectionBlockedError("plugin unloaded");
      if (isInternalModelRequest(state, messages)) return messages;
      state.mainRequest?.cancel();
      if (state.postResponseTimer) { clearTimeout(state.postResponseTimer); state.postResponseTimer = undefined; }
      state.pendingOutputSyncChatId = undefined;
      state.pendingOutputSyncRequestId = undefined;
      state.activeModelRequest = undefined;
      const generationId = beginMainGeneration(state, client);
      const requestEpoch = state.modelRequestEpoch = (state.modelRequestEpoch ?? 0) + 1;
      const controller = new AbortController();
      let rejectRequest!: (error: MemoryInjectionBlockedError) => void;
      let ownedTiming: ReturnType<typeof startTiming> | undefined;
      const cancelled = new Promise<never>((_, reject) => { rejectRequest = reject; });
      const request: NonNullable<RuntimeState["mainRequest"]> = state.mainRequest = { id: generationId, signal: controller.signal, preparing: true, cancel() {
        if (controller.signal.aborted) return;
        const error = new MemoryInjectionBlockedError("request cancelled or replaced");
        rejectRequest(error); controller.abort(error);
        if (ownedTiming?.outcome === "running") finishTiming(state, ownedTiming, "failed");
      } };
      const execute = async () => {
      try {
        const currentChatId = await readCurrentChatId(state);
        if (state.modelRequestEpoch !== requestEpoch || controller.signal.aborted) throw new MemoryInjectionBlockedError("request replaced during setup");
        if (state.mainGeneration?.id === generationId) state.mainGeneration.chatId = currentChatId;
        const assertCurrentRequest = async () => {
          if (controller.signal.aborted || state.modelRequestEpoch !== requestEpoch) throw new MemoryInjectionBlockedError("request cancelled or replaced");
          const liveChatId = await readCurrentChatId();
          if (controller.signal.aborted || state.modelRequestEpoch !== requestEpoch || liveChatId !== currentChatId) {
            throw new MemoryInjectionBlockedError("request belongs to another chat or generation");
          }
        };
        if (!isChatMemoryEnabled(state.settings, currentChatId)) {
          state.lastPromptValidation = { chatId: currentChatId, status: "disabled", at: Date.now() };
          state.activeModelRequest = undefined;
          state.automaticTurnPacket = undefined;
          state.memoryToolOpportunity = undefined;
          state.memoryReferenceSnapshot = undefined;
          state.lastResolvedSetup = undefined;
          beginMemoryReferenceTurn(state, crypto.randomUUID());
          await state.syncMemoryToolRegistration?.(false).catch(() => undefined);
          return stripRcmPromptContent(messages);
        }
        if (!isServerConfigured(state.settings)) {
          state.activeModelRequest = undefined;
          await state.syncMemoryToolRegistration?.(false).catch(() => undefined);
          throw new MemoryInjectionBlockedError("server URL or token is not configured");
        }
        const existing = inspectMemoryPrompt(messages);
        const knownRetryChatId = state.automaticTurnPacket?.chatId;
        if (knownRetryChatId === currentChatId) {
          const retrySetup = await resolvedSetupProjection(messages);
          if (retrySetup) state.lastResolvedSetup = { chatId: knownRetryChatId, projection: retrySetup };
        }
        if (existing.contexts.length > 0 && knownRetryChatId) {
          if (currentChatId === knownRetryChatId && isChatMemoryEnabled(state.settings, knownRetryChatId)
            && isPreparedContextRetry(state, knownRetryChatId, existing.contexts)) {
            return reuseExistingContext(state, client, messages, knownRetryChatId);
          }
          if (currentChatId === knownRetryChatId && isChatMemoryEnabled(state.settings, knownRetryChatId)) {
            throw new MemoryInjectionBlockedError("stale or unverified existing memory context");
          }
          throw new MemoryInjectionBlockedError("existing memory context belongs to another chat");
        }
        const preparedEmptyRetry = knownRetryChatId
          && !existing.hasMarker
          && state.lastInjection?.turnKey === state.automaticTurnPacket?.turnKey
          && state.lastInjection?.omitted === true
          && (state.automaticTurnPacket?.memoryOnlyInjection ?? false) === (state.settings.memoryOnlyInjection[knownRetryChatId] ?? false)
          && isIntentionalEmptyPrepare(state.automaticTurnPacket?.response);
        if (preparedEmptyRetry) {
          if (currentChatId !== knownRetryChatId) {
            throw new MemoryInjectionBlockedError("empty retry belongs to another chat");
          }
          state.lastPromptValidation = { chatId: knownRetryChatId, status: "existing_context", at: Date.now() };
          state.activeModelRequest = { chatId: knownRetryChatId, requestId: generationId };
          addLog(state.logs, "info", "Reused an empty prepared memory packet for the provider retry");
          return messages;
        }
        // The idle discovery bundle exists only so Provider Manager can render
        // and toggle RCM. Remove it before a fresh model request; prepare below
        // registers only the functions that have safe, unseen atoms this turn.
        await state.syncMemoryToolRegistration?.(false).catch(() => undefined);
        if (existing.contexts.length > 0) {
          throw new MemoryInjectionBlockedError("existing memory context has no matching prepared turn");
        }
        if (!existing.hasMarker) {
          state.lastPromptValidation = { chatId: currentChatId, status: "marker_missing", at: Date.now() };
          state.activeModelRequest = undefined;
          addLog(state.logs, "warn", "Blocked model request because the enabled chat has no [[RCM]] marker");
          throw new MissingRcmMarkerError();
        }
        const memoryPreparationStartedAt = Date.now();
        let context = await readCurrentContext(state);
        await assertCurrentRequest();
        if (context.chatId !== currentChatId) throw new MemoryInjectionBlockedError("chat changed while reading context");
        state.current = context;
        void syncQuizEnabled(state, client).catch(() => undefined);
        state.lastPromptValidation = { chatId: context.chatId, status: "marker_present", at: Date.now() };
        const catchUpPending = state.settings.chatCatchUpPending[context.chatId] === true;
        if (catchUpPending && context.snapshotScope !== "full") {
          context = await readCurrentContext(state, { snapshotMode: "full" });
        }
        const selectedMemoryBudget = state.settings.memoryBudgets[context.chatId] ?? state.settings.defaultMemoryBudget;
        const totalMemoryBudget = selectedMemoryBudget;
        const turnKey = await sha256(`${context.chatId}\0${context.snapshot.at(-1)?.id ?? ""}\0${context.querySourceHash ?? context.query}\0${state.settings.memoryToolsEnabled}\0${context.memoryOnlyInjection ?? false}`);
        const referenceTurnKey = crypto.randomUUID();
        state.memoryReferenceSnapshot = await sha256(JSON.stringify(context.snapshot.map(message => [message.id, message.content, message.generationId])));
        const referenceTurnChanged = state.mcpTurnKey !== referenceTurnKey;
        beginMemoryReferenceTurn(state, referenceTurnKey);
        if (referenceTurnChanged) state.memoryToolExposureKeys = {};
        if (state.memoryToolOpportunity?.referenceTurnKey !== referenceTurnKey) {
          state.memoryToolOpportunity = undefined;
          await state.syncMemoryToolRegistration?.(false).catch(() => undefined);
        }
        const autoBudget = totalMemoryBudget;
        let effectiveAutoBudget: number = autoBudget;
        const sourceProtectionTurns = context.sourceProtectionTurns ?? state.settings.sourceProtectionTurns;
        const needsSetupCapture = state.lastResolvedSetup?.chatId !== context.chatId
          || state.lastPrepare?.initialCalibration?.status === "awaiting_setup";
        const injectionTiming = autoBudget > 0 || catchUpPending || needsSetupCapture
          ? startTiming(state, { chatId: context.chatId, kind: "automatic_injection", label: "전체 기억 준비", startedAt: memoryPreparationStartedAt })
          : undefined;
        ownedTiming = injectionTiming;
        let injectionTimingOutcome: "succeeded" | "failed" | "reused" = "failed";
        let choice: ReturnType<typeof prepareChoice> | undefined;
        let sentWithoutMemory = false;
        try {
        let response: TurnPrepareResponse | undefined;
        let packet = "";
        let reused = false;
        let fallback = false;
        let prepareElapsedMs: number | undefined;
        let prepareRequestId: string | undefined;
        let prepareTimeoutMs: number | undefined;
        let prepareClientTimings: PrepareClientTimings | undefined;
        let packetApplyMs: number | undefined;
        let memoryToolRegistrationMs: number | undefined;
        let memoryToolRegistration: NonNullable<RuntimeState["lastInjection"]>["memoryToolRegistration"] = "not_run";
        const syncMemoryTools = async (): Promise<void> => {
          if (!state.syncMemoryToolRegistration) return;
          const startedAt = performance.now();
          try {
            await state.syncMemoryToolRegistration(state.settings.memoryToolsEnabled);
            memoryToolRegistration = "completed";
          } catch {
            memoryToolRegistration = "failed";
          }
          memoryToolRegistrationMs = performance.now() - startedAt;
        };
        let prepareOutcome: NonNullable<RuntimeState["lastInjection"]>["prepareOutcome"] = "skipped";
        let prepareError: string | undefined;
        if (autoBudget > 0 || catchUpPending || needsSetupCapture) {
          const reusable = !state.settings.memoryToolsEnabled && !catchUpPending && !needsSetupCapture && state.automaticTurnPacket?.turnKey === turnKey
            && state.automaticTurnPacket.chatId === context.chatId
            && state.automaticTurnPacket.requestedBudget === autoBudget
            && JSON.stringify(state.automaticTurnPacket.promptSourceMessageIds) === JSON.stringify(protectedPromptSourceMessageIds(messages, sourceProtectionTurns));
          if (reusable) {
            reused = true;
            prepareOutcome = "reused";
            prepareElapsedMs = 0;
            response = state.automaticTurnPacket!.response;
            prepareRequestId = response.retrievalTrace?.requestId;
            packet = response.packet;
            state.lastPromptSourceMessageIds = state.automaticTurnPacket!.promptSourceMessageIds;
            state.lastPrepare = response;
            state.memoryToolAvailability ??= {};
            state.memoryToolAvailability[context.chatId] = response.memoryToolsAvailable === true;
            state.memoryToolOpportunity = response.memoryToolOpportunity
              ? { chatId: context.chatId, turnKey, referenceTurnKey, value: response.memoryToolOpportunity }
              : undefined;
            await syncMemoryTools();
            state.activeMemoryLanguages ??= {};
            state.activeMemoryLanguages[context.chatId] = response.memoryLanguage;
          } else {
            const prepareStartedAt = Date.now();
            const setupStartedAt = performance.now();
            prepareClientTimings = {};
            prepareRequestId = crypto.randomUUID();
            prepareTimeoutMs = PREPARE_CHOICE_BLOCK_MS;
            try {
              const promptSourceMessageIds = protectedPromptSourceMessageIds(messages, sourceProtectionTurns);
              const resolvedSetup = await resolvedSetupProjection(messages);
              await assertCurrentRequest();
              if (resolvedSetup) state.lastResolvedSetup = { chatId: context.chatId, projection: resolvedSetup };
              state.lastPromptSourceMessageIds = promptSourceMessageIds;
              const prepareRequest = makePrepareRequest(context, autoBudget, {
                deferExtraction: false,
                promptSourceMessageIds,
                resolvedSetup,
                memoryReferenceMode: state.settings.memoryToolsEnabled ? "short" : "none",
                memoryGeneration: referenceTurnKey,
                traceContext: {
                  requestId: prepareRequestId,
                  turnKey,
                  latestMessageId: context.snapshot.at(-1)?.id,
                  attempt: 1,
                },
                memoryBudgetPreset: selectedMemoryBudget,
              });
              prepareClientTimings.setupMs = performance.now() - setupStartedAt;
              choice = prepareChoice(state, generationId, context.chatId, requestEpoch, controller.signal);
              response = await choice.run(prepareRequest, prepareClientTimings, client);
              await assertCurrentRequest();
              choice.check();
              if (state.mcpTurnKey !== referenceTurnKey) throw new MemoryInjectionBlockedError("memory generation changed during prepare");
              prepareElapsedMs = Date.now() - prepareStartedAt;
              prepareOutcome = "fresh";
              state.retrievalTraceEnabled = response.retrievalTrace?.enabled === true;
              if (catchUpPending) {
                delete state.settings.chatCatchUpPending[context.chatId];
                void saveSettings(state.settings).catch((error) =>
                  addLog(state.logs, "warn", `Catch-up state persistence failed: [오류 원문 제외]`),
                );
              }
              const serverUrl = state.settings.serverUrl.replace(/\/$/, "");
              if (state.settings.serverInstances[serverUrl] !== response.serverInstanceId) {
                state.settings.serverInstances[serverUrl] = response.serverInstanceId;
                void saveSettings(state.settings).catch((error) =>
                  addLog(state.logs, "warn", `Server identity persistence failed: [오류 원문 제외]`),
                );
              }
              if (!response) throw new Error("Memory preparation returned no response");
              const parentId = response.lineage?.status === "inherited" ? response.lineage.parentChatId : undefined;
              if (parentId) {
                await inheritLineageSettings(state, context, parentId, response.memoryLanguage);
                const inheritedPerspectives = [...new Set((state.settings.perspectives[context.chatId] ?? []).map((name) => name.trim()).filter(Boolean))].slice(0, 4);
                const inheritedBudget = state.settings.memoryBudgets[context.chatId] ?? state.settings.defaultMemoryBudget;
                context.profile = state.settings.profiles[context.chatId] ?? state.settings.defaultProfile;
                context.includeUserMessages = state.settings.includeUserMessages[context.chatId] ?? true;
                context.memoryOnlyInjection = state.settings.memoryOnlyInjection[context.chatId] ?? false;
                context.extractionGroupTurns = Math.min(50, Math.max(1, Math.round(state.settings.extractionGroupTurns[context.chatId] ?? 6)));
                context.memoryLanguage = state.settings.memoryLanguages[context.chatId] ?? response.memoryLanguage;
                context.activePerspectives = inheritedPerspectives;
                context.perspectiveMode = inheritedPerspectives.length > 0 ? "manual" : "auto";
                state.current = context;
                void syncQuizEnabled(state, client).catch(() => undefined);
                const inheritedEnabled = isChatMemoryEnabled(state.settings, context.chatId);
                const requestChanged = prepareRequest.profile !== context.profile
                  || prepareRequest.includeUserMessages !== context.includeUserMessages
                  || prepareRequest.memoryOnlyInjection !== context.memoryOnlyInjection
                  || prepareRequest.extractionGroupTurns !== context.extractionGroupTurns
                  || prepareRequest.memoryLanguage !== context.memoryLanguage
                  || prepareRequest.memoryBudgetPreset !== inheritedBudget
                  || prepareRequest.perspectiveMode !== context.perspectiveMode
                  || JSON.stringify(prepareRequest.perspectives) !== JSON.stringify(context.activePerspectives);
                if (!inheritedEnabled) {
                  effectiveAutoBudget = 0;
                  response = {
                    ...response,
                    packet: "",
                    stableAnchors: "",
                    selected: [],
                    estimatedTokens: 0,
                    memoryToolsAvailable: false,
                    memoryToolOpportunity: undefined,
                    injectionManifest: undefined,
                    omissionReason: "no_memories",
                  };
                } else if (requestChanged) {
                  effectiveAutoBudget = inheritedBudget;
                  prepareRequestId = crypto.randomUUID();
                  const retryStartedAt = Date.now();
                  response = await choice.run(makePrepareRequest(context, inheritedBudget, {
                    deferExtraction: false,
                    promptSourceMessageIds,
                    resolvedSetup,
                    memoryReferenceMode: state.settings.memoryToolsEnabled ? "short" : "none",
                memoryGeneration: referenceTurnKey,
                    traceContext: {
                      requestId: prepareRequestId,
                      turnKey,
                      latestMessageId: context.snapshot.at(-1)?.id,
                      attempt: 2,
                    },
                    memoryBudgetPreset: inheritedBudget,
                  }), prepareClientTimings, client) as TurnPrepareResponse;
                  prepareElapsedMs = (prepareElapsedMs ?? 0) + Date.now() - retryStartedAt;
                }
              }
              await assertCurrentRequest();
              choice.check();
              choice.dispose();
              const resolution = response.perspectiveResolution;
              state.perspectiveStatus = resolution ? {
                perspectives: resolution.perspectives,
                unresolved: resolution.unresolved,
                omissionReason: response.omissionReason,
              } : undefined;
              if (resolution && !resolution.unresolved && resolution.perspectives.length > 0 && context.perspectiveMode === "auto") {
                const detectedKey = `${response.serverInstanceId}:${context.chatId}`;
                if (JSON.stringify(state.settings.detectedPerspectives[detectedKey] ?? []) !== JSON.stringify(resolution.perspectives)) {
                  state.settings.detectedPerspectives[detectedKey] = resolution.perspectives;
                  void saveSettings(state.settings).catch((error) => addLog(state.logs, "warn", `Perspective cache persistence failed: [오류 원문 제외]`));
                }
              }
              packet = renderMemoryReferences(state, response.packet, response.selected, state.settings.memoryToolsEnabled, new Set(response.memoryToolOpportunity?.followCandidates.map((item) => item.memoryId) ?? []));
              state.lastPrepare = response;
              state.memoryToolAvailability ??= {};
              state.memoryToolAvailability[context.chatId] = response.memoryToolsAvailable === true;
              state.memoryToolOpportunity = response.memoryToolOpportunity
                ? { chatId: context.chatId, turnKey, referenceTurnKey, value: response.memoryToolOpportunity }
                : undefined;
              await syncMemoryTools();
              state.activeMemoryLanguages ??= {};
              state.activeMemoryLanguages[context.chatId] = response.memoryLanguage;
              state.automaticTurnPacket = {
                turnKey,
                chatId: context.chatId,
                memoryOnlyInjection: context.memoryOnlyInjection ?? false,
                requestedBudget: effectiveAutoBudget,
                promptSourceMessageIds,
                latestMessageId: context.snapshot.at(-1)?.id,
                response: { ...response, packet },
              };
              state.cache[context.chatId] = {
                serverInstanceId: response.serverInstanceId,
                stableAnchors: response.stableAnchors,
                lastPacket: packet,
                lastRevision: response.chatRevision,
                lastPreparedAt: Date.now(),
              };
              void persistCache(state);
            } catch (error) {
              await assertCurrentRequest();
              if (error instanceof MemoryInjectionBlockedError) throw error;
              prepareElapsedMs = Date.now() - prepareStartedAt;
              if (error instanceof PrepareChoiceError && error.choice === "omit") {
                sentWithoutMemory = true;
                prepareOutcome = "skipped";
                packet = "";
                response = undefined;
                state.lastPrepare = undefined;
                state.automaticTurnPacket = undefined;
                state.memoryToolOpportunity = undefined;
                state.memoryToolAvailability ??= {};
                state.memoryToolAvailability[context.chatId] = false;
                state.memoryToolExposureKeys = {};
                beginMemoryReferenceTurn(state, crypto.randomUUID());
                await state.syncMemoryToolRegistration?.(false).catch(() => undefined);
              } else {
                const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
                prepareOutcome = name === "AbortError" ? "timeout" : "error";
                prepareError = String(error).replace(/\s+/g, " ").slice(0, 500);
                const cached = state.cache[context.chatId];
                const knownInstanceId = state.settings.serverInstances[state.settings.serverUrl.replace(/\/$/, "")];
                packet = clampPacket(!context.memoryOnlyInjection && cached?.serverInstanceId && cached.serverInstanceId === knownInstanceId ? cached.stableAnchors : "", Math.min(1_500, effectiveAutoBudget));
                fallback = true;
                addLog(state.logs, "warn", `turn/prepare ${prepareOutcome} after ${prepareElapsedMs}ms; fallback ~${estimateTokens(packet)} tokens: [오류 원문 제외]`);
              }
            }
          }
        }
        await assertCurrentRequest();
        const evidenceAvailable = hasMemoryEvidence(packet);
        // Relationship, world-state, belief and continuity sections count as
        // evidence too. Tool availability alone does not justify spending the
        // common guidance; the first tool result supplies it when needed.
        if (evidenceAvailable) packet = withMemoryGuidance(packet);
        else packet = "";
        const packetStartedAt = performance.now();
        const injected = injectMemory(messages, packet, effectiveAutoBudget, Math.floor(effectiveAutoBudget * 115 / 100));
        packetApplyMs = performance.now() - packetStartedAt;
        const manifest = injected.omitted
          ? emptyInjectionManifest("empty")
          : fallback
            ? emptyInjectionManifest("fallback")
            : response?.injectionManifest
              ? { ...response.injectionManifest, source: reused ? "reused" as const : "fresh" as const }
              : emptyInjectionManifest(reused ? "reused" : "fresh");
        const blockedPrepare = prepareOutcome === "timeout" || prepareOutcome === "error";
        const blockedInjection = !sentWithoutMemory && injected.omitted && !isIntentionalEmptyPrepare(response);
        const blocked = blockedPrepare || blockedInjection;
        state.lastInjection = {
          turnKey,
          chatId: context.chatId,
          packet: blocked ? "" : injected.packet,
          requestedBudget: effectiveAutoBudget,
          preparedTokens: packet ? estimateTokens(packet) : 0,
          injectedTokens: blocked ? 0 : injected.injectedTokens,
          removedTokens: injected.removedTokens,
          reused,
          prepareElapsedMs,
          prepareRequestId,
          prepareTimeoutMs,
          prepareClientTimings,
          packetApplyMs,
          memoryToolRegistrationMs,
          memoryToolRegistration,
          prepareOutcome,
          prepareError,
          clientStages: {
            response: prepareClientTimings?.responseStage ?? (prepareClientTimings ? "not_received" : "not_requested"),
            body: prepareClientTimings?.bodyStage ?? "not_read",
            json: prepareClientTimings?.jsonStage ?? "not_parsed",
            schema: prepareClientTimings?.schemaStage ?? "not_parsed",
            packet: blocked || injected.omitted ? "omitted" : "injected",
            registration: memoryToolRegistration,
            diagnostic: "not_queued",
          },
          omitted: blocked || injected.omitted,
          omissionReason: blocked ? (response?.omissionReason ?? injected.omissionReason ?? "empty_packet") : injected.omissionReason,
          blocked,
          blockReason: blockedPrepare ? `turn/prepare ${prepareOutcome}` : blockedInjection ? (injected.omissionReason ?? response?.omissionReason ?? "memory omitted") : undefined,
          guidanceInjected: !blocked && injected.packet.includes("<guidance>"),
          evidenceInjected: !blocked && hasMemoryEvidence(injected.packet),
          manifest: blocked ? emptyInjectionManifest("empty") : manifest,
          stateSnapshots: blocked || injected.omitted ? [] : response?.stateSnapshots,
          at: Date.now(),
        };
        injectionTimingOutcome = blocked ? "failed" : reused ? "reused" : "succeeded";
        if (!blocked && !sentWithoutMemory) {
          state.cache[context.chatId] = {
            ...(state.cache[context.chatId] ?? { stableAnchors: response?.stableAnchors ?? "", lastPacket: packet, lastRevision: response?.chatRevision ?? 0, lastPreparedAt: Date.now() }),
            ...(response?.serverInstanceId ? { serverInstanceId: response.serverInstanceId } : {}),
            lastPacket: injected.packet,
            lastInjectionManifest: manifest,
            lastInjectionScenes: summarizeInjectedScenes(response?.selected),
            lastInjectionStateSnapshots: state.lastInjection.stateSnapshots,
            lastInjectedTokens: injected.injectedTokens,
            lastInjectionAt: state.lastInjection!.at,
          };
          void persistCache(state);
        }
        traceAutomaticInjection(state, client, context.snapshot.at(-1)?.id);
        if (blockedPrepare) {
          // Stable anchors remain in the trace/cache, but cannot prove that
          // this turn's relevant memory was prepared. Never spend the paid
          // call with that knowingly incomplete fallback.
          state.activeModelRequest = undefined;
          if (state.automaticTurnPacket?.chatId === context.chatId) state.automaticTurnPacket = undefined;
          throw new MemoryInjectionBlockedError(`turn/prepare ${prepareOutcome}`);
        }
        if (blockedInjection) {
          state.activeModelRequest = undefined;
          if (state.automaticTurnPacket?.chatId === context.chatId) state.automaticTurnPacket = undefined;
          throw new MemoryInjectionBlockedError(injected.omissionReason ?? response?.omissionReason ?? "memory omitted");
        }
        state.activeModelRequest = {
          chatId: context.chatId, requestId: generationId, turnKey, latestMessageId: context.snapshot.at(-1)?.id,
          startedAt: Date.now(), packet: injected.packet,
          plannedTools: sentWithoutMemory ? [] : currentTurnMemoryToolNames(state, context.chatId),
        };
        addLog(
          state.logs,
          "info",
          injected.omitted
            ? `Memory omitted: ${injected.omissionReason ?? response?.omissionReason ?? "injection_budget"}`
            : `${reused ? "Reused" : "Injected"} ~${injected.injectedTokens} memory tokens; removed ~${injected.removedTokens} old chat tokens${prepareElapsedMs === undefined ? "" : `; prepare ${prepareOutcome} ${prepareElapsedMs}ms`}`,
        );
        scheduleWorker(state, client);
        return injected.messages;
        } finally {
          choice?.dispose();
          if (injectionTiming?.outcome === "running") finishTiming(state, injectionTiming, injectionTimingOutcome);
        }
      } catch (error) {
        endMainGeneration(state, generationId);
        if (error instanceof MissingRcmMarkerError || error instanceof MemoryInjectionBlockedError) throw error;
        if (state.modelRequestEpoch === requestEpoch) state.activeModelRequest = undefined;
        addLog(state.logs, "error", `beforeRequest blocked: [오류 원문 제외]`, supportFailure("before_request", error));
        throw new MemoryInjectionBlockedError(String(error).replace(/\s+/g, " ").slice(0, 240));
      }
      };
      try { const result = await Promise.race([execute(), cancelled]); request.preparing = false; return result; }
      catch (error) { endMainGeneration(state, generationId); throw error; }
    }),
    risuai.addRisuReplacer("afterRequest", async (content, type) => {
      if (state.unloaded) return content;
      if (type === "model") {
        // Provider Manager marks a standard unregister as missing. Restore the
        // full discovery definition only after the request has finished; the
        // next beforeRequest will narrow it again before model tool selection.
        void state.restoreMemoryToolDiscoveryRegistration?.().catch(() => undefined);
      }
      // This hook has no originating request ID. Never close whichever window
      // happens to be current; reconcile a captured, keyed host observation.
      if (type === "model" && state.mainGeneration) void observeCurrentHostGeneration(state);
      if (type === "model" && typeof content === "string" && content.trim().length > 0) {
        const activeRequest = state.activeModelRequest;
        const requestEndedAt = Date.now();
        if (!state.mainGeneration) {
          state.activeModelRequest = undefined;
          if (activeRequest) void traceObservedProviderRequest(state, client, activeRequest, requestEndedAt);
          // A completed generation closes the retry lifecycle. A user reroll of
          // the same source turn is a fresh request and must receive the normal
          // memory budget instead of inheriting attempt 2/3 from the prior answer.
          state.retryCounts = {};
          state.automaticTurnPacket = undefined;
        }
        if (!activeRequest) return content;
        if (state.postResponseTimer) clearTimeout(state.postResponseTimer);
        state.pendingOutputSyncChatId = activeRequest.chatId;
        const requestId = state.pendingOutputSyncRequestId = activeRequest.requestId ?? state.mainGeneration?.id;
        if (!hasCommittedOutputListener) {
          // Older hosts without the committed-output listener still get a
          // bounded best-effort fallback.
          state.postResponseTimer = window.setTimeout(() => {
            if (state.pendingOutputSyncChatId !== activeRequest.chatId || state.pendingOutputSyncRequestId !== requestId
              || (state.mainGeneration && state.mainGeneration.id !== requestId)) return;
            state.pendingOutputSyncChatId = undefined;
            state.pendingOutputSyncRequestId = undefined;
            state.postResponseTimer = undefined;
            void syncCommittedOutput(state, client, activeRequest.chatId);
          }, 1_500);
        }
      }
      return content;
    }),
    ...(hasCommittedOutputListener ? [
      risuai.addRisuChatListener!("output", ({ chat, messageIndex }) => {
        if (state.unloaded) return;
        const chatId = String(chat?.id ?? "");
        if (!chatId || (state.pendingOutputSyncChatId !== chatId && state.mainGeneration?.chatId !== chatId)) return;
        const generation = state.mainGeneration;
        if (generation && state.mainRequest?.id === generation.id && state.mainRequest.preparing) return;
        const requestId = generation?.id ?? state.pendingOutputSyncRequestId;
        const output = chat.message?.[messageIndex];
        if (generation && (!generation.sources || !output)) return;
        const outputId = output?.chatId ?? output?.id;
        const outputGeneration = output?.generationInfo?.generationId;
        const source = generation?.sources?.get(String(outputId));
        // Capture event identity/hash before reading the live host. It must differ
        // from the new request's start snapshot, even if the old message is still last.
        const eventHash = source && source.generationId === outputGeneration
          ? sha256(`${messageRole(output)}\0${String(output?.data ?? output?.content ?? "")}`) : undefined;
        void (async () => {
          if (generation) {
            if (source && source.generationId === outputGeneration && (!source.hash || source.hash === await eventHash)) return;
            if (state.mainGeneration?.id !== requestId) return;
            const host = await observeCurrentHostGeneration(state);
            if ((state.mainGeneration && state.mainGeneration.id !== requestId) || !host || host.chatId !== chatId) return;
            const currentOutput = host.chat.message?.at(-1);
            // A late commit from an older reroll must match the CURRENT host output,
            // not just its chat. Use host message/generation IDs, never prose.
            if (!output || !currentOutput) return;
            const currentId = currentOutput.chatId ?? currentOutput.id;
            const currentGeneration = currentOutput.generationInfo?.generationId;
            if ((!outputId && !outputGeneration) || outputId !== currentId || outputGeneration !== currentGeneration) return;
          }
          // Streaming hosts may emit only committed-output, without afterRequest.
          const activeRequest = state.activeModelRequest;
          if (activeRequest?.chatId === chatId && (!activeRequest.requestId || activeRequest.requestId === requestId)) {
            state.activeModelRequest = undefined;
            void traceObservedProviderRequest(state, client, activeRequest, Date.now());
            state.retryCounts = {};
            state.automaticTurnPacket = undefined;
          }
          endMainGeneration(state, requestId);
          state.pendingOutputSyncChatId = undefined;
          state.pendingOutputSyncRequestId = undefined;
          if (state.postResponseTimer) {
            window.clearTimeout(state.postResponseTimer);
            state.postResponseTimer = undefined;
          }
          // Chat listeners are awaited by Risu in sequence. Keep server work in
          // the background so RCM never delays rendering or later output hooks.
          void syncCommittedOutput(state, client, chatId);
        })().catch(() => addLog(state.logs, "warn", "Committed-output observation could not be confirmed"));
      }),
    ] : []),
  ]);
}
