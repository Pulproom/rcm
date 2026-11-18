import { consumeIncidentFeed } from './toasts.js';
import { supportFailure } from "./support-diagnostics.js";
import { loadPrepareFailures, recordPrepareFailure } from "./prepare-diagnostics.js";
import { captureSetupRequest, discardSetupCapture, observeSetupAttention, completeSetupAttentionTurn } from "./setup-sources.js";
declare const __RCM_DISTRIBUTION__: boolean;
import { sharedPastPacket, withMemoryGuidance } from "@rcm/shared";
import { estimateTokens, type TurnPrepareResponse } from "@rcm/shared";
import { cachedSourceReceipt, ServerClient, UpgradeBlockedError, type UpgradeLock, type PrepareClientTimings } from "./api-client.js";
import { assertHostSelection, confirmCurrentChatScope, injectMemory, inspectMemoryPrompt, makePrepareRequest, protectedPromptSourceMessageIds, readContextMetadata, readCurrentChatScope, readCurrentContext, readHostSelection, readMessageSourceInputs, resolvedSetupProjection, sameMessageSourceInputs, sha256, stripRcmPromptContent, observeCurrentHostGeneration, messageRole } from "./context.js";
import { CACHE_KEY, addLog, isChatMemoryEnabled, loadSettings, loadStoredJson, saveSettings, saveStoredJson } from "./settings.js";
import type { AutomaticInjectionTimings, ChatScopeTiming, CachedChatState, RuntimeState } from "./types.js";
import { beginMainGeneration, clearMainGeneration, endMainGeneration, isInternalModelRequest, scheduleWorker } from "./worker.js";
import { stageLineageSettings } from "./lineage-settings.js";
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
    addLog(state.logs, "warn", `Injection inspector cache was not persisted: [오류 원문 제외]`, "INJECTION_CACHE_SAVE_FAILED");
  }
}

export const MISSING_RCM_MARKER_MESSAGE = "RCM이 이 채팅에서 켜져 있지만 최종 프롬프트에서 [[RCM]] 위치 표식을 찾지 못했어요. 프리셋·카드·로어북에 [[RCM]]을 추가하거나 이 채팅의 RCM을 끈 뒤 다시 보내 주세요.";
export const MEMORY_INJECTION_BLOCKED_MESSAGE = "RCM 기억을 준비하거나 최종 프롬프트에 넣지 못해 모델 요청을 차단했어요. 메인 모델 요청은 전송하지 않았어요. 서버 연결과 RCM 상태를 확인한 뒤 다시 보내 주세요.";
export const RCM_INITIALIZING_MESSAGE = "RCM이 아직 초기화 중이어서 모델 요청을 차단했어요. 잠시 후 다시 보내 주세요.";

export class MissingRcmMarkerError extends Error {
  constructor() {
    super(MISSING_RCM_MARKER_MESSAGE);
    this.name = "MissingRcmMarkerError";
  }
}

function traceAutomaticInjection(state: RuntimeState, client: ServerClient, latestMessageId: string | undefined, timingsReady?: Promise<void>): void {
  if (!state.lastInjection) return;
  const injection = state.lastInjection;
  // Receipt metadata drives cooldown even when private diagnostic prose is disabled.
  if (!state.retrievalTraceEnabled || typeof __RCM_DISTRIBUTION__ !== "undefined" && __RCM_DISTRIBUTION__) {
    if (!injection.blocked && !injection.omitted && ["fresh", "reused"].includes(injection.prepareOutcome ?? "")) {
      void client.traceRetrieval({ id: crypto.randomUUID(), kind: "automatic_injection",
        chatId: injection.chatId, receiptOnly: true, prepareOutcome: injection.prepareOutcome, blocked: false, omitted: false,
        manifest: { memoryIds: injection.manifest.memoryIds, atomKeys: injection.manifest.atomKeys, longtermMemoryIds: injection.manifest.longtermMemoryIds } }).catch(error => addLog(state.logs, "warn", `Memory delivery receipt failed: [오류 원문 제외]`, "DELIVERY_RECEIPT_FAILED"));
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
  const event = {
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
    injectionTimings: injection.injectionTimings,
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
  };
  void (timingsReady ? client.traceRetrieval(event, timingsReady) : client.traceRetrieval(event)).then(() => {
    const elapsedMs = performance.now() - deliveryStartedAt;
    injection.traceDelivery = { eventId, requestId, status: "succeeded", startedAt, elapsedMs };
    addLog(state.logs, "info", `Retrieval trace delivered requestId=${requestId} eventId=${eventId} in ${elapsedMs}ms`, "RETRIEVAL_TRACE_DELIVERED");
  }, (error) => {
    const message = String(error).replace(/\s+/g, " ").slice(0, 240);
    injection.traceDelivery = { eventId, requestId, status: "failed", startedAt, elapsedMs: performance.now() - deliveryStartedAt, error: message };
    addLog(state.logs, "warn", `Retrieval trace delivery failed requestId=${requestId} eventId=${eventId}: ${message}`, "RETRIEVAL_TRACE_FAILED");
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
    || (prepared.upcomingOccasions ?? true) !== (state.settings.upcomingOccasions[chatId] ?? true)
    || (prepared.pairProgress ?? false) !== (state.settings.pairProgress[chatId] ?? false)
    || (prepared.memoryOnlyInjection ?? false) !== (state.settings.memoryOnlyInjection[chatId] ?? false)
    || prepared.narrationViewpoint !== (state.settings.narrationViewpoint[chatId] || undefined)
    || injection.turnKey !== prepared.turnKey || injection.omitted || contexts.length !== 1) return false;
  return contexts[0]!.trim() === injection.packet.trim();
}

function reuseExistingContext(state: RuntimeState, client: ServerClient, messages: OpenAIChat[], chatId: string, characterId: string): OpenAIChat[] {
  const injected = injectMemory(messages, "", 0, 0);
  const automatic = state.automaticTurnPacket;
  const previous = state.lastInjection;
  state.lastPromptValidation = { chatId, status: "existing_context", at: Date.now() };
  state.activeModelRequest = {
    chatId, characterId, requestId: state.mainGeneration?.id, turnKey: automatic?.turnKey ?? previous?.turnKey,
    referenceTurnKey: automatic?.referenceTurnKey, promptSourceMessageIds: automatic?.promptSourceMessageIds,
    mcpRequestTimeoutMs: automatic?.response.mcpRequestTimeoutMs,
    latestMessageId: automatic?.latestMessageId ?? state.current?.snapshot?.at(-1)?.id,
    startedAt: Date.now(), packet: injected.packet,
  };
  state.activeModelRequest.plannedTools = currentTurnMemoryToolNames(state, chatId);
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
  addLog(state.logs, "info", `Reused ~${injected.injectedTokens} memory tokens from the prepared request`, "PREPARED_MEMORY_REUSED");
  return injected.messages;
}

async function syncCommittedOutput(state: RuntimeState, client: ServerClient, chatId: string, requestId: string | undefined): Promise<void> {
  if (state.unloaded) return;
  let completed = false;
  try {
    const context = await readCurrentContext(state);
    if (state.unloaded) return;
    if (context.chatId !== chatId || !isChatMemoryEnabled(state.settings, context.chatId, context.characterId)) {
      addLog(state.logs, "info", `Post-response memory sync skipped for inactive chat ${chatId}`, "OUTPUT_SYNC_SKIPPED");
      return;
    }
    state.current = context;
    completed = true;
    void syncQuizEnabled(state, client).catch(() => undefined);
    const statusRevision = state.statusSummaryRevision ?? 0;
    const response = await client.prepare(makePrepareRequest(context, 0, { deferExtraction: false }), 5_000);
    if ((state.statusSummaryRevision ?? 0) === statusRevision) observeSetupAttention(state, chatId, response.initialCalibration?.status, response.lineage);
  } catch (error) {
    addLog(state.logs, "warn", `Post-response memory sync deferred: [오류 원문 제외]`, "OUTPUT_SYNC_DEFERRED");
  } finally {
    if (completed) completeSetupAttentionTurn(state, chatId, requestId);
    state.requestActivityRefresh?.();
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
  const client=new ServerClient(() => state.settings);
  await loadPrepareFailures(state);
  client.onIncidentFeed=(feed,serverUrl,cursor)=>consumeIncidentFeed(state,feed,serverUrl,cursor);
  return { state, client };
}

export function installRequestHooks(state: RuntimeState, client: ServerClient): Promise<void[]> {
  const hasCommittedOutputListener = typeof risuai.addRisuChatListener === "function";
  // A tail prepare cannot repair an off-tail edit without its message body.
  const fullSourceNextPrepare = new Set<string>();
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
      const preflightStartedAt = performance.now();
      const injectionTimings: AutomaticInjectionTimings = {
        totalMs: 0, preflightMs: 0, sourceHeadMs: 0,
        contextRead: { count: 0, totalMs: 0, hostChatReadMs: 0, descriptorComparisonMs: 0, loreDatabaseReadMs: 0, messageSourceResolutionMs: 0, visibilityMs: 0, messageCount: 0, sourceChars: 0, estimatedSourceTokens: 0 },
        chatScopeChecks: { count: 0, totalMs: 0, hashingMs: 0, fullHostChatReads: 0, calls: [] },
        assertCurrentRequest: { count: 0, totalMs: 0, hashingMs: 0 },
        setupProjectionMs: 0, setupCaptureMs: 0, turnKeyHashMs: 0,
        prepareRequestBuildMs: 0, prepareRequestMs: 0, postResponseChecksMs: 0, toolRegistrationMs: 0, packetApplyMs: 0,
      };
      const scopeTiming = (stage: ChatScopeTiming["stage"]): ChatScopeTiming => {
        const timing = { stage, totalMs: 0, hostChatReadMs: 0, hashingMs: 0, fullHostChatReads: 0 };
        injectionTimings.chatScopeChecks.calls.push(timing);
        return timing;
      };
      const removeMemoryTools = async () => {
        if (!state.syncMemoryToolRegistration) return;
        const startedAt = performance.now();
        try { await state.syncMemoryToolRegistration(false).catch(() => undefined); }
        finally { injectionTimings.toolRegistrationMs += performance.now() - startedAt; }
      };
      const assertRequestOwner = () => {
        if (controller.signal.aborted || state.modelRequestEpoch !== requestEpoch) throw new MemoryInjectionBlockedError("request cancelled or replaced");
      };
      const needsSourceHead = (chatId: string) => fullSourceNextPrepare.has(chatId) || state.automaticTurnPacket?.chatId === chatId
        || state.cache[chatId] || state.statusSummary?.upgrade?.lock || state.upgradeBlocked?.chatId === chatId;
      const readSourceHead = async (chatId: string) => {
        const startedAt = performance.now();
        const head = await new ServerClient(() => state.settings).request<{upgradeLock?:UpgradeLock; memoryEpoch?:string}>(`/v1/chats/${encodeURIComponent(chatId)}/source-head`, {signal:controller.signal});
        injectionTimings.sourceHeadMs += performance.now() - startedAt;
        assertRequestOwner();
        return head;
      };
      try {
        const existing = inspectMemoryPrompt(messages);
        // Release idle discovery before reading the loaded slot. Yumi can finish
        // writing its source record while the host is handling unregistration.
        const freshPrompt = existing.hasMarker && existing.contexts.length === 0;
        const known = state.hostChatIdentity;
        const preflightSelection = freshPrompt && (state.syncMemoryToolRegistration || known) ? await readHostSelection() : undefined;
        assertRequestOwner();
        if (freshPrompt) {
          state.memoryToolOpportunity = undefined;
          await removeMemoryTools();
          assertRequestOwner();
        }
        const knownChatId = known && known.characterIndex === preflightSelection?.[0] && known.chatIndex === preflightSelection[1]
          ? known.chatId : undefined;
        const current = state.current;
        const serverUrl = state.settings.serverUrl;
        const configured = isServerConfigured(state.settings);
        const currentCharacterId = current?.chatId === knownChatId ? current?.characterId : undefined;
        const enabled = !knownChatId || !currentCharacterId || isChatMemoryEnabled(state.settings, knownChatId, currentCharacterId);
        const preflightHead = knownChatId && currentCharacterId && configured && enabled && needsSourceHead(knownChatId)
          ? await readSourceHead(knownChatId) : undefined;
        let metadata: Awaited<ReturnType<typeof readContextMetadata>> | undefined;
        if (freshPrompt && configured && enabled) {
          const startedAt = performance.now();
          metadata = await readContextMetadata();
          injectionTimings.contextRead.loreDatabaseReadMs += performance.now() - startedAt;
          assertRequestOwner();
        }
        // Pin the ledger receipt before copying its source. A concurrent sync
        // can change the cached receipt while the host RPC is in flight.
        const receiptChatId = knownChatId ?? current?.chatId;
        const receipts = new Map([...(receiptChatId ? [receiptChatId] : []), ...fullSourceNextPrepare]
          .map(chatId => [chatId, cachedSourceReceipt(state.settings, chatId)] as const));
        const { chatId: currentChatId, characterId, hostSnapshot } = await readCurrentChatScope(undefined, scopeTiming("initial"));
        assertRequestOwner();
        if (serverUrl !== state.settings.serverUrl || (preflightHead && knownChatId !== currentChatId)) {
          throw new MemoryInjectionBlockedError("source scope changed during preflight");
        }
        if (preflightSelection && (hostSnapshot.characterIndex !== preflightSelection[0] || hostSnapshot.chatIndex !== preflightSelection[1])) {
          throw new MemoryInjectionBlockedError("host selection changed during preflight");
        }
        const generation = state.mainGeneration;
        generation?.observe(currentChatId, hostSnapshot.chat);
        let sourceInputs: ReturnType<typeof readMessageSourceInputs>;
        let sourceHashes: NonNullable<RuntimeState["automaticTurnPacket"]>["sourceHashes"];
        let tailStart = 0;
        let expectedReferenceTurnKey: string;
        let selectionChanged = false;
        const assertDeliveryOwner = () => {
          assertRequestOwner();
          if (state.mcpTurnKey !== expectedReferenceTurnKey) throw new MemoryInjectionBlockedError("memory generation changed before apply");
        };
        const assertCurrentRequest = async (stage: Exclude<ChatScopeTiming["stage"], "initial">) => {
          const startedAt = performance.now();
          injectionTimings.assertCurrentRequest.count += 1;
          const timing = scopeTiming(stage);
          try {
            assertRequestOwner();
            if (stage === "before_apply") {
              try {
                const live = await confirmCurrentChatScope(hostSnapshot, timing);
                assertDeliveryOwner();
                if (selectionChanged || live.characterIndex !== hostSnapshot.characterIndex || live.chatIndex !== hostSnapshot.chatIndex
                  || live.chatId !== currentChatId) throw new Error("HOST_SOURCE_CHANGED");
                if (!sameMessageSourceInputs(sourceInputs, live.chat)) {
                  if (tailStart && !sameMessageSourceInputs(sourceInputs, live.chat, tailStart)) fullSourceNextPrepare.add(currentChatId);
                  throw new Error("HOST_SOURCE_CHANGED");
                }
                generation?.observe(currentChatId, live.chat, sourceHashes);
              } catch (error) {
                throw new MemoryInjectionBlockedError(`final chat confirmation failed: ${String(error)}`);
              }
            } else {
              try { await assertHostSelection(hostSnapshot.characterIndex, hostSnapshot.chatIndex); }
              catch (error) {
                if ((stage !== "prepare_response" && stage !== "prepared_response")
                  || !(error instanceof Error) || error.message !== "HOST_SELECTION_CHANGED") throw error;
                // Route observed switches to the common delivery guard before
                // consuming the response or registering its tools.
                selectionChanged = true;
              }
            }
            assertRequestOwner();
          } finally {
            const elapsedMs = performance.now() - startedAt;
            timing.totalMs += elapsedMs;
            injectionTimings.assertCurrentRequest.totalMs += elapsedMs;
            injectionTimings.assertCurrentRequest.hashingMs += timing.hashingMs;
            if (stage === "prepare_error" || stage === "before_apply") injectionTimings.postResponseChecksMs += elapsedMs;
          }
        };
        if (!isChatMemoryEnabled(state.settings, currentChatId, characterId)) {
          state.lastPromptValidation = { chatId: currentChatId, status: "disabled", at: Date.now() };
          state.activeModelRequest = undefined;
          state.automaticTurnPacket = undefined;
          state.memoryToolOpportunity = undefined;
          await discardSetupCapture(state, currentChatId);
          beginMemoryReferenceTurn(state, crypto.randomUUID());
          if (!freshPrompt) await removeMemoryTools();
          return stripRcmPromptContent(messages);
        }
        if (!isServerConfigured(state.settings)) {
          state.activeModelRequest = undefined;
          if (!freshPrompt) await removeMemoryTools();
          throw new MemoryInjectionBlockedError("server URL or token is not configured");
        }
        // Cached provider retries also honour the live lock before reusing a packet.
        const repairSources = fullSourceNextPrepare.has(currentChatId);
        // Without a known slot, a fresh request uses prepare itself to check
        // the live lock. Retry-only prompts cannot send a source snapshot.
        const head = preflightHead ?? (!freshPrompt && needsSourceHead(currentChatId) ? await readSourceHead(currentChatId) : undefined);
        if (head) {
          if (head.upgradeLock) {
            state.upgradeBlocked = {chatId:currentChatId,lock:head.upgradeLock};
            state.refreshStatusWidget?.();
            throw new UpgradeBlockedError(head.upgradeLock);
          }
          const epoch=head.memoryEpoch ?? '';
          const prepared=state.automaticTurnPacket?.chatId===currentChatId ? state.automaticTurnPacket : undefined;
          if (prepared && (prepared.response.memoryEpoch ?? '')!==epoch
            || state.cache[currentChatId] && (state.cache[currentChatId]!.memoryEpoch ?? '')!==epoch) {
            state.automaticTurnPacket=undefined;
            state.lastInjection=undefined;
            delete state.cache[currentChatId];
            void persistCache(state);
          }
        }
        if (state.upgradeBlocked?.chatId === currentChatId) state.upgradeBlocked = undefined;
        const prepared = state.automaticTurnPacket;
        const knownRetryChatId = prepared?.chatId;
        const verifiedRetry = head && !repairSources && prepared?.chatId === currentChatId && prepared.referenceTurnKey === state.mcpTurnKey && prepared.sourceInputs
          && sameMessageSourceInputs(prepared.sourceInputs, hostSnapshot.chat) ? prepared : undefined;
        if (knownRetryChatId === currentChatId) {
          const projectionStartedAt = performance.now();
          const retrySetup = await resolvedSetupProjection(messages);
          injectionTimings.setupProjectionMs += performance.now() - projectionStartedAt;
          await assertCurrentRequest("retry_setup_projection");
          const captureStartedAt = performance.now();
          captureSetupRequest(state, knownRetryChatId, retrySetup);
          injectionTimings.setupCaptureMs += performance.now() - captureStartedAt;
        }
        if (existing.contexts.length > 0 && knownRetryChatId) {
          if (verifiedRetry && isChatMemoryEnabled(state.settings, knownRetryChatId, characterId)
            && isPreparedContextRetry(state, knownRetryChatId, existing.contexts)) {
            sourceInputs = verifiedRetry.sourceInputs;
            sourceHashes = verifiedRetry.sourceHashes;
            expectedReferenceTurnKey = verifiedRetry.referenceTurnKey;
            await assertCurrentRequest("before_apply");
            assertDeliveryOwner();
            if (state.memoryToolOpportunity?.referenceTurnKey === verifiedRetry.referenceTurnKey) state.memoryToolOpportunity.requestId = generationId;
            return reuseExistingContext(state, client, messages, knownRetryChatId, characterId);
          }
          if (currentChatId === knownRetryChatId && isChatMemoryEnabled(state.settings, knownRetryChatId, characterId)) {
            throw new MemoryInjectionBlockedError("stale or unverified existing memory context");
          }
          throw new MemoryInjectionBlockedError("existing memory context belongs to another chat");
        }
        const preparedEmptyRetry = knownRetryChatId
          && !existing.hasMarker
          && state.lastInjection?.turnKey === state.automaticTurnPacket?.turnKey
          && state.lastInjection?.omitted === true
          && (state.automaticTurnPacket?.upcomingOccasions ?? true) === (state.settings.upcomingOccasions[knownRetryChatId] ?? true)
          && (state.automaticTurnPacket?.pairProgress ?? false) === (state.settings.pairProgress[knownRetryChatId] ?? false)
          && (state.automaticTurnPacket?.memoryOnlyInjection ?? false) === (state.settings.memoryOnlyInjection[knownRetryChatId] ?? false)
          && state.automaticTurnPacket?.narrationViewpoint === (state.settings.narrationViewpoint[knownRetryChatId] || undefined)
          && isIntentionalEmptyPrepare(state.automaticTurnPacket?.response);
        if (preparedEmptyRetry) {
          if (currentChatId !== knownRetryChatId) {
            throw new MemoryInjectionBlockedError("empty retry belongs to another chat");
          }
          if (!verifiedRetry) throw new MemoryInjectionBlockedError("stale or unverified empty packet");
          sourceInputs = verifiedRetry.sourceInputs;
          sourceHashes = verifiedRetry.sourceHashes;
          expectedReferenceTurnKey = verifiedRetry.referenceTurnKey;
          await assertCurrentRequest("before_apply");
          assertDeliveryOwner();
          if (state.memoryToolOpportunity?.referenceTurnKey === verifiedRetry.referenceTurnKey) state.memoryToolOpportunity.requestId = generationId;
          state.lastPromptValidation = { chatId: knownRetryChatId, status: "existing_context", at: Date.now() };
          state.activeModelRequest = {
            chatId: knownRetryChatId, characterId, requestId: generationId, turnKey: verifiedRetry.turnKey,
            referenceTurnKey: verifiedRetry.referenceTurnKey, latestMessageId: verifiedRetry.latestMessageId,
            promptSourceMessageIds: verifiedRetry.promptSourceMessageIds, mcpRequestTimeoutMs: verifiedRetry.response.mcpRequestTimeoutMs,
          };
          state.activeModelRequest.plannedTools = currentTurnMemoryToolNames(state, knownRetryChatId);
          addLog(state.logs, "info", "Reused an empty prepared memory packet for the provider retry", "EMPTY_PACKET_REUSED");
          return messages;
        }
        // The idle discovery bundle exists only so Provider Manager can render
        // and toggle RCM. Remove it before a fresh model request; prepare below
        // registers only the functions that have safe, unseen atoms this turn.
        if (!freshPrompt) await removeMemoryTools();
        if (existing.contexts.length > 0) {
          throw new MemoryInjectionBlockedError("stale or unverified existing memory context");
        }
        if (!existing.hasMarker) {
          state.lastPromptValidation = { chatId: currentChatId, status: "marker_missing", at: Date.now() };
          state.activeModelRequest = undefined;
          addLog(state.logs, "warn", "Blocked model request because the enabled chat has no [[RCM]] marker", "MEMORY_MARKER_MISSING");
          throw new MissingRcmMarkerError();
        }
        const memoryPreparationStartedAt = Date.now();
        const memoryPreparationStartedAtPerformance = performance.now();
        injectionTimings.preflightMs = memoryPreparationStartedAtPerformance - preflightStartedAt;
        const catchUpPending = state.settings.chatCatchUpPending[currentChatId] === true;
        sourceInputs = verifiedRetry?.sourceInputs ?? readMessageSourceInputs(hostSnapshot.chat);
        let context = await readCurrentContext(state, {
          timings: injectionTimings.contextRead, hostSnapshot, sourceInputs,
          sourceReceipt: receipts.get(currentChatId), metadata,
          snapshotMode: catchUpPending || repairSources ? "full" : "auto",
        });
        assertRequestOwner();
        sourceHashes = context.messageVisibility;
        tailStart = context.snapshotScope === "tail" ? context.snapshot[0]?.ordinal ?? 0 : 0;
        void syncQuizEnabled(state, client).catch(() => undefined);
        state.lastPromptValidation = { chatId: context.chatId, status: "marker_present", at: Date.now() };
        const selectedMemoryBudget = state.settings.memoryBudgets[context.chatId] ?? state.settings.defaultMemoryBudget;
        const totalMemoryBudget = selectedMemoryBudget;
        const turnKeyStartedAt = performance.now();
        const turnKey = await sha256(`${context.chatId}\0${context.snapshot.at(-1)?.id ?? ""}\0${context.querySourceHash ?? context.query}\0${state.settings.memoryToolsEnabled}\0${context.memoryOnlyInjection ?? false}\0${context.upcomingOccasions ?? true}\0${context.pairProgress ?? false}`);
        injectionTimings.turnKeyHashMs = performance.now() - turnKeyStartedAt;
        const referenceTurnKey = crypto.randomUUID();
        expectedReferenceTurnKey = referenceTurnKey;
        assertRequestOwner();
        beginMemoryReferenceTurn(state, referenceTurnKey);
        state.memoryToolExposureKeys = {};
        const autoBudget = totalMemoryBudget;
        let effectiveAutoBudget: number = autoBudget;
        const sourceProtectionTurns = context.sourceProtectionTurns ?? state.settings.sourceProtectionTurns;
        const needsSetupCapture = state.lastResolvedSetup?.chatId !== context.chatId
          || state.lastPrepare?.initialCalibration?.status === "awaiting_setup";
        const injectionTiming = autoBudget > 0 || catchUpPending || needsSetupCapture || repairSources
          ? startTiming(state, { chatId: context.chatId, kind: "automatic_injection", label: "전체 기억 준비", startedAt: memoryPreparationStartedAt })
          : undefined;
        ownedTiming = injectionTiming;
        let injectionTimingOutcome: "succeeded" | "failed" | "reused" = "failed";
        let choice: ReturnType<typeof prepareChoice> | undefined;
        let sentWithoutMemory = false;
        let completeInjectionTiming!: () => void;
        const injectionTimingReady = new Promise<void>(resolve => { completeInjectionTiming = resolve; });
        try {
        // Also refresh in-memory sources on zero-budget and cached-packet turns.
        if (knownRetryChatId !== currentChatId) {
          const projectionStartedAt = performance.now();
          const resolvedSetup = await resolvedSetupProjection(messages);
          injectionTimings.setupProjectionMs += performance.now() - projectionStartedAt;
          await assertCurrentRequest("before_prepare");
          const captureStartedAt = performance.now();
          captureSetupRequest(state, context.chatId, resolvedSetup);
          injectionTimings.setupCaptureMs += performance.now() - captureStartedAt;
        } else await assertCurrentRequest("before_prepare");
        let response: TurnPrepareResponse | undefined;
        let lineageSettings: ReturnType<typeof stageLineageSettings> | undefined;
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
          injectionTimings.toolRegistrationMs += memoryToolRegistrationMs;
        };
        let prepareOutcome: NonNullable<RuntimeState["lastInjection"]>["prepareOutcome"] = "skipped";
        let prepareError: string | undefined;
        const promptSourceMessageIds = protectedPromptSourceMessageIds(messages, sourceProtectionTurns);
        if (autoBudget > 0 || catchUpPending || needsSetupCapture || repairSources) {
          const reusable = !state.settings.memoryToolsEnabled && !catchUpPending && !needsSetupCapture && !repairSources && verifiedRetry?.turnKey === turnKey
            && verifiedRetry.narrationViewpoint === context.narrationViewpoint
            && verifiedRetry.requestedBudget === autoBudget
            && verifiedRetry.promptSourceMessageIds.length === promptSourceMessageIds.length
            && verifiedRetry.promptSourceMessageIds.every((id, index) => id === promptSourceMessageIds[index]);
          if (reusable) {
            reused = true;
            prepareOutcome = "reused";
            prepareElapsedMs = 0;
            response = verifiedRetry.response;
            prepareRequestId = response.retrievalTrace?.requestId;
            packet = response.packet;
          } else {
            const prepareStartedAt = Date.now();
            const setupStartedAt = performance.now();
            prepareClientTimings = {};
            prepareRequestId = crypto.randomUUID();
            prepareTimeoutMs = PREPARE_CHOICE_BLOCK_MS;
            try {
              const buildStartedAt = performance.now();
              const prepareRequest = makePrepareRequest(context, autoBudget, {
                deferExtraction: false,
                promptSourceMessageIds,
                // The picker alone submits setup. Capturing a main request never starts calibration.
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
              injectionTimings.prepareRequestBuildMs += performance.now() - buildStartedAt;
              prepareClientTimings.setupMs = performance.now() - setupStartedAt;
              choice = prepareChoice(state, generationId, context.chatId, requestEpoch, controller.signal);
              const requestStartedAt = performance.now();
              try { response = await choice.run(prepareRequest, prepareClientTimings, client); }
              finally { injectionTimings.prepareRequestMs += performance.now() - requestStartedAt; }
              const responseChecksStartedAt = performance.now();
              await assertCurrentRequest("prepare_response");
              if (selectionChanged) await assertCurrentRequest("before_apply");
              choice.check();
              if (state.mcpTurnKey !== referenceTurnKey) throw new MemoryInjectionBlockedError("memory generation changed during prepare");
              injectionTimings.postResponseChecksMs += performance.now() - responseChecksStartedAt;
              prepareElapsedMs = Date.now() - prepareStartedAt;
              prepareOutcome = "fresh";
              state.retrievalTraceEnabled = response.retrievalTrace?.enabled === true;
              if (!response) throw new Error("Memory preparation returned no response");
              const parentId = response.lineage?.status === "inherited" ? response.lineage.parentChatId : undefined;
              if (parentId) {
                lineageSettings = stageLineageSettings(state, context.chatId, parentId, response.memoryLanguage);
                const { settings } = lineageSettings;
                const inheritedBudget = settings.memoryBudgets[context.chatId] ?? settings.defaultMemoryBudget;
                context = {
                  ...context,
                  profile: settings.profiles[context.chatId] ?? settings.defaultProfile,
                  includeUserMessages: settings.includeUserMessages[context.chatId] ?? true,
                  upcomingOccasions: settings.upcomingOccasions[context.chatId] ?? true,
                  pairProgress: settings.pairProgress[context.chatId] ?? false,
                  memoryOnlyInjection: settings.memoryOnlyInjection[context.chatId] ?? false,
                  extractionGroupTurns: Math.min(50, Math.max(1, Math.round(settings.extractionGroupTurns[context.chatId] ?? 6))),
                  memoryLanguage: settings.memoryLanguages[context.chatId] ?? response.memoryLanguage,
                  narrationViewpoint: settings.narrationViewpoint[context.chatId] || undefined,
                };
                const inheritedEnabled = isChatMemoryEnabled(settings, context.chatId, context.characterId);
                const requestChanged = prepareRequest.profile !== context.profile
                  || prepareRequest.includeUserMessages !== context.includeUserMessages
                  || prepareRequest.upcomingOccasions !== context.upcomingOccasions
                  || prepareRequest.pairProgress !== context.pairProgress
                  || prepareRequest.memoryOnlyInjection !== context.memoryOnlyInjection
                  || prepareRequest.extractionGroupTurns !== context.extractionGroupTurns
                  || prepareRequest.memoryLanguage !== context.memoryLanguage
                  || prepareRequest.memoryBudgetPreset !== inheritedBudget
                  || prepareRequest.narrationViewpoint !== context.narrationViewpoint;
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
                  const retryBuildStartedAt = performance.now();
                  const retryRequest = makePrepareRequest(context, inheritedBudget, {
                    deferExtraction: false,
                    promptSourceMessageIds,
                    memoryReferenceMode: state.settings.memoryToolsEnabled ? "short" : "none",
                    memoryGeneration: referenceTurnKey,
                    traceContext: {
                      requestId: prepareRequestId,
                      turnKey,
                      latestMessageId: context.snapshot.at(-1)?.id,
                      attempt: 2,
                    },
                    memoryBudgetPreset: inheritedBudget,
                  });
                  injectionTimings.prepareRequestBuildMs += performance.now() - retryBuildStartedAt;
                  await assertCurrentRequest("before_prepare");
                  const retryRequestStartedAt = performance.now();
                  try { response = await choice.run(retryRequest, prepareClientTimings, client) as TurnPrepareResponse; }
                  finally { injectionTimings.prepareRequestMs += performance.now() - retryRequestStartedAt; }
                  prepareElapsedMs = (prepareElapsedMs ?? 0) + Date.now() - retryStartedAt;
                }
              }
              // Keep the inherited response checkpoint, including after a
              // second prepare with the staged parent settings.
              if (parentId) {
                const inheritedChecksStartedAt = performance.now();
                await assertCurrentRequest("prepared_response");
                if (selectionChanged) await assertCurrentRequest("before_apply");
                choice.check();
                injectionTimings.postResponseChecksMs += performance.now() - inheritedChecksStartedAt;
              }
              choice.dispose();
              packet = renderMemoryReferences(state, response.packet, response.selected, state.settings.memoryToolsEnabled, new Set(response.memoryToolOpportunity?.followCandidates.map((item) => item.memoryId) ?? []));
            } catch (error) {
              if (error instanceof MemoryInjectionBlockedError) throw error;
              await assertCurrentRequest("prepare_error");
              if (error instanceof UpgradeBlockedError) {
                state.upgradeBlocked = {chatId:context.chatId,lock:error.lock};
                throw error;
              }
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
                expectedReferenceTurnKey = state.mcpTurnKey;
                await removeMemoryTools();
              } else {
                const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
                prepareOutcome = name === "AbortError" ? "timeout" : "error";
                prepareError = String(error).replace(/\s+/g, " ").slice(0, 500);
                recordPrepareFailure(state, error, prepareClientTimings, prepareElapsedMs);
                const cached = state.cache[context.chatId];
                const knownInstanceId = state.settings.serverInstances[state.settings.serverUrl.replace(/\/$/, "")];
                packet = clampPacket(!context.memoryOnlyInjection && cached?.serverInstanceId && cached.serverInstanceId === knownInstanceId ? cached.stableAnchors : "", Math.min(1_500, effectiveAutoBudget));
                fallback = true;
                addLog(state.logs, "warn", `turn/prepare ${prepareOutcome} after ${prepareElapsedMs}ms; fallback ~${estimateTokens(packet)} tokens: [오류 원문 제외]`, "PREPARE_FALLBACK");
              }
            }
          }
        }
        if (response && !fallback) {
          state.memoryToolOpportunity = response.memoryToolOpportunity
            ? { chatId: context.chatId, turnKey, referenceTurnKey, requestId: generationId, value: response.memoryToolOpportunity }
            : undefined;
          await syncMemoryTools();
        }
        await assertCurrentRequest("before_apply");
        // Recheck synchronous ownership in this continuation before publishing
        // anything. A newer request can cancel while the host RPC settles.
        assertDeliveryOwner();
        const preparedPacket = packet;
        const evidenceAvailable = hasMemoryEvidence(packet);
        // Shared-history guidance is standing context, including the first story turn.
        if (evidenceAvailable || packet.includes("<not_yet>")) packet = withMemoryGuidance(packet);
        else packet = fallback ? "" : sharedPastPacket;
        const packetStartedAt = performance.now();
        const injected = injectMemory(messages, packet, effectiveAutoBudget, Math.floor(effectiveAutoBudget * 115 / 100));
        packetApplyMs = performance.now() - packetStartedAt;
        injectionTimings.packetApplyMs = packetApplyMs;
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
        if (response && !blocked) {
          if (lineageSettings) {
            state.current = context;
            void lineageSettings.commit();
            void syncQuizEnabled(state, client).catch(() => undefined);
          }
          if (repairSources && !response.sourceChangeHeld) fullSourceNextPrepare.delete(context.chatId);
          const serverUrl = state.settings.serverUrl.replace(/\/$/, "");
          if (catchUpPending || state.settings.serverInstances[serverUrl] !== response.serverInstanceId) {
            delete state.settings.chatCatchUpPending[context.chatId];
            state.settings.serverInstances[serverUrl] = response.serverInstanceId;
            void saveSettings(state.settings).catch(() =>
              addLog(state.logs, "warn", "Prepare settings persistence failed: [오류 원문 제외]",
                catchUpPending ? "CATCH_UP_STATE_SAVE_FAILED" : "SERVER_IDENTITY_SAVE_FAILED"));
          }
          state.lastPrepare = response;
          state.lastPromptSourceMessageIds = promptSourceMessageIds;
          state.memoryToolAvailability ??= {};
          state.memoryToolAvailability[context.chatId] = response.memoryToolsAvailable === true;
          state.activeMemoryLanguages ??= {};
          state.activeMemoryLanguages[context.chatId] = response.memoryLanguage;
          state.automaticTurnPacket = {
            turnKey, chatId: context.chatId, referenceTurnKey, sourceInputs, sourceHashes,
            narrationViewpoint: context.narrationViewpoint,
            memoryOnlyInjection: context.memoryOnlyInjection ?? false,
            upcomingOccasions: context.upcomingOccasions ?? true,
            pairProgress: context.pairProgress ?? false,
            requestedBudget: effectiveAutoBudget, promptSourceMessageIds,
            latestMessageId: context.snapshot.at(-1)?.id,
            response: { ...response, packet: preparedPacket },
          };
        }
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
          injectionTimings: prepareOutcome === "fresh" ? injectionTimings : undefined,
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
            ...(response ? { serverInstanceId: response.serverInstanceId, memoryEpoch: response.memoryEpoch,
              stableAnchors: response.stableAnchors, lastRevision: response.chatRevision, lastPreparedAt: Date.now() } : {}),
            lastPacket: injected.packet,
            lastInjectionManifest: manifest,
            lastInjectionScenes: summarizeInjectedScenes(response?.selected),
            lastInjectionStateSnapshots: state.lastInjection.stateSnapshots,
            lastInjectedTokens: injected.injectedTokens,
            lastInjectionAt: state.lastInjection!.at,
          };
          void persistCache(state);
        }
        traceAutomaticInjection(state, client, context.snapshot.at(-1)?.id, state.lastInjection.injectionTimings ? injectionTimingReady : undefined);
        if (blockedPrepare) {
          // Stable anchors remain in the trace/cache, but cannot prove that
          // this turn's relevant memory was prepared. Never spend the paid
          // call with that knowingly incomplete fallback.
          state.activeModelRequest = undefined;
          if (state.automaticTurnPacket?.chatId === context.chatId) state.automaticTurnPacket = undefined;
          throw new MemoryInjectionBlockedError(`turn/prepare ${prepareOutcome}`);
        }
        if (blockedInjection) {
          recordPrepareFailure(state, new Error("Memory injection failed"), prepareClientTimings, prepareElapsedMs, true);
          state.activeModelRequest = undefined;
          if (state.automaticTurnPacket?.chatId === context.chatId) state.automaticTurnPacket = undefined;
          throw new MemoryInjectionBlockedError(injected.omissionReason ?? response?.omissionReason ?? "memory omitted");
        }
        state.activeModelRequest = {
          chatId: context.chatId, characterId: context.characterId, requestId: generationId, turnKey, referenceTurnKey,
          latestMessageId: context.snapshot.at(-1)?.id, promptSourceMessageIds, mcpRequestTimeoutMs: response?.mcpRequestTimeoutMs,
          startedAt: Date.now(), packet: injected.packet,
        };
        state.activeModelRequest.plannedTools = sentWithoutMemory ? [] : currentTurnMemoryToolNames(state, context.chatId);
        observeSetupAttention(state, context.chatId, response?.initialCalibration?.status, response?.lineage);
        addLog(
          state.logs,
          "info",
          injected.omitted
            ? `Memory omitted: ${injected.omissionReason ?? response?.omissionReason ?? "injection_budget"}`
            : `${reused ? "Reused" : "Injected"} ~${injected.injectedTokens} memory tokens; removed ~${injected.removedTokens} old chat tokens${prepareElapsedMs === undefined ? "" : `; prepare ${prepareOutcome} ${prepareElapsedMs}ms`}`, injected.omitted ? "MEMORY_OMITTED" : "MEMORY_INJECTED",
        );
        scheduleWorker(state, client);
        return injected.messages;
        } finally {
          choice?.dispose();
          injectionTimings.totalMs = performance.now() - memoryPreparationStartedAtPerformance;
          if (injectionTiming?.outcome === "running") finishTiming(state, injectionTiming, injectionTimingOutcome);
          injectionTimings.floatingElapsedMs = injectionTiming?.elapsedMs;
          const scopes = injectionTimings.chatScopeChecks;
          scopes.count = scopes.calls.length;
          for (const call of scopes.calls) {
            scopes.totalMs += call.totalMs;
            scopes.hashingMs += call.hashingMs;
            scopes.fullHostChatReads += call.fullHostChatReads;
          }
          // Finalize numbers before diagnostic JSON serialization. The receipt,
          // preparation/check/application order and widget boundary stay intact.
          completeInjectionTiming();
        }
      } catch (error) {
        endMainGeneration(state, generationId);
        if (state.mainRequest === request && !state.unloaded) {
          state.activeModelRequest = undefined;
          state.automaticTurnPacket = undefined;
          state.memoryToolOpportunity = undefined;
          await removeMemoryTools();
        }
        if (error instanceof UpgradeBlockedError) {
          state.refreshStatusWidget?.();
          throw new MemoryInjectionBlockedError('CHAT_UPGRADING');
        }
        if (error instanceof MissingRcmMarkerError || error instanceof MemoryInjectionBlockedError) throw error;
        if (state.modelRequestEpoch === requestEpoch) state.activeModelRequest = undefined;
        addLog(state.logs, "error", `beforeRequest blocked: [오류 원문 제외]`, supportFailure("before_request", error));
        recordPrepareFailure(state, error);
        throw new MemoryInjectionBlockedError(String(error).replace(/\s+/g, " ").slice(0, 240));
      }
      };
      try { return await Promise.race([execute(), cancelled]); }
      catch (error) { endMainGeneration(state, generationId); throw error; }
      finally { request.preparing = false; }
    }),
    risuai.addRisuReplacer("afterRequest", async (content, type) => {
      if (state.unloaded) return content;
      if (type === "model" && !state.mainRequest?.preparing) {
        // Provider Manager marks a standard unregister as missing. Restore the
        // full discovery definition only after the request has finished; the
        // next beforeRequest will narrow it again before model tool selection.
        void state.restoreMemoryToolDiscoveryRegistration?.().catch(() => undefined);
      }
      // This hook has no originating request ID. Never close whichever window
      // happens to be current; reconcile a captured, keyed host observation.
      if (type === "model" && state.mainGeneration && !state.mainRequest?.preparing) void observeCurrentHostGeneration(state);
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
            void syncCommittedOutput(state, client, activeRequest.chatId, requestId);
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
          void syncCommittedOutput(state, client, chatId, requestId);
        })().catch(() => addLog(state.logs, "warn", "Committed-output observation could not be confirmed", "OUTPUT_OBSERVATION_FAILED"));
      }),
    ] : []),
  ]);
}
