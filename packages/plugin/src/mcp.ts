declare const __RCM_DISTRIBUTION__: boolean;
import { INVALID_MEMORY_REF_MESSAGE, MCP_MAX_REQUEST_TIMEOUT_MS, RCM_PLUGIN_VERSION, type McpQuestionAnswer, type McpSourceRange, estimateTokens, initialMemoryGuidanceBlock, memoryGuidanceBlock } from "@rcm/shared";
import type { ServerClient } from "./api-client.js";
import { readCurrentChatScope } from "./context.js";
import { isChatMemoryEnabled } from "./settings.js";
import mcpContract from "./mcp-contract.json" with { type: "json" };
import type { RuntimeState } from "./types.js";
import { finishTiming, startTiming } from "./timing.js";
import { completeTurnSearch, type TurnSearch } from "./turn-delivery.js";

export const memoryToolFunctions = mcpContract.tools;
export const MEMORY_TOOL_CANCELLED_MESSAGE = "The memory tool call was cancelled. Do not retry unless still needed.";
export const MCP_REQUEST_TIMEOUT_MS = MCP_MAX_REQUEST_TIMEOUT_MS;

export type MemoryToolName = "recall_rp_memory" | "expand_rp_memory";

export function currentTurnMemoryToolNames(state: RuntimeState, chatId?: string, registering = false): MemoryToolName[] {
  const opportunity = state.memoryToolOpportunity;
  const active = state.activeModelRequest;
  const currentChatId = chatId ?? (active?.referenceTurnKey !== undefined ? active.chatId : state.current?.chatId);
  if (!state.settings.memoryToolsEnabled || !opportunity || opportunity.chatId !== currentChatId) return [];
  if (opportunity.requestId && (opportunity.referenceTurnKey !== state.mcpTurnKey
    || (!registering && (active?.requestId !== opportunity.requestId || active.chatId !== currentChatId)))) return [];
  const names: MemoryToolName[] = [];
  if (opportunity.value.archiveSearchAvailable || opportunity.value.recallCandidateMemoryIds.length > 0) names.push("recall_rp_memory", "expand_rp_memory");
  return names;
}

function toolDefinitions(_state: RuntimeState, _chatId: string, names: MemoryToolName[]) {
  return memoryToolFunctions.filter((tool) => names.includes(tool.name as MemoryToolName)).map(({ id: _id, ...tool }) => tool);
}

export function traceMemoryToolExposure(
  state: RuntimeState,
  client: ServerClient,
  transport: "native" | "yumi",
  plannedTools: MemoryToolName[],
  offeredTools: MemoryToolName[],
  outcome: "offered" | "empty" | "not_connected" | "timeout" | "error" | "stale_turn",
  elapsedMs?: number,
  previousCleared?: boolean,
  registration?: Record<string, unknown>,
): void {
  if (typeof __RCM_DISTRIBUTION__ !== "undefined" && __RCM_DISTRIBUTION__) return;
  if (!state.retrievalTraceEnabled) return;
  const turnKey = state.memoryToolOpportunity?.turnKey ?? state.mcpTurnKey;
  const key = `${turnKey}:${transport}:${outcome}:${offeredTools.join(",")}:${registration?.requestId ?? ""}`;
  state.memoryToolExposureKeys ??= {};
  if (state.memoryToolExposureKeys[key]) return;
  state.memoryToolExposureKeys[key] = true;
  const preparedOpportunity = state.memoryToolOpportunity;
  const opportunity = preparedOpportunity?.value;
  const active = state.activeModelRequest;
  const boundExposure = active?.referenceTurnKey !== undefined && active.referenceTurnKey === preparedOpportunity?.referenceTurnKey
    && active.requestId === preparedOpportunity.requestId;
  void client.traceRetrieval({
    id: crypto.randomUUID(), kind: "tool_exposure", chatId: preparedOpportunity?.chatId ?? state.current?.chatId ?? "unknown",
    traceContext: { requestId: turnKey, turnKey, latestMessageId: boundExposure ? active.latestMessageId : state.current?.snapshot?.at(-1)?.id },
    transport, plannedTools, offeredTools, outcome, elapsedMs, previousCleared,
    registration,
    opportunity: opportunity ? {
      recallMemoryCount: opportunity.recallCandidateMemoryIds.length,
      recallAtomCount: opportunity.recallCandidateAtomKeys.length,
      followRefCount: opportunity.followCandidates.length,
      excluded: opportunity.excluded,
    } : undefined,
  }).catch(() => undefined);
}

export function beginMemoryReferenceTurn(state: RuntimeState, turnKey: string): void {
  if (state.mcpTurnKey === turnKey) return;
  state.mcpTurnKey = turnKey;
  state.lastTurnSearches = undefined;
  state.mcpTraceCalls = 0;
  state.mcpReturnedMemoryIds = [];
  state.mcpReturnedMemorySignatures = [];
  state.mcpReturnedAtomKeys = [];
  state.mcpReturnedSourceRanges = [];
  state.mcpGuidanceDelivered = false;
}

export function renderMemoryReferences(
  _state: RuntimeState,
  packet: string,
  _selected: Array<{ id: string }> = [],
  _enabled = _state.settings.memoryToolsEnabled,
  _followableIds: ReadonlySet<string> = new Set(),
): string {
  if (!packet) return packet;
  return packet.replace(_enabled ? /\s+id="[^"]*"/g : /\s+(?:id|ref)="[^"]*"/g, "");
}

async function currentMemoryToolsAvailable(state: RuntimeState, client: ServerClient, chatId: string, signal?: AbortSignal): Promise<boolean> {
  const cached = state.memoryToolAvailability?.[chatId];
  if (typeof cached === "boolean") return cached;
  try {
    const readiness = await client.request<{ available: boolean }>(
      `/v1/chats/${encodeURIComponent(chatId)}/memory-tools/readiness`,
      { signal },
      2_000,
    );
    state.memoryToolAvailability ??= {};
    state.memoryToolAvailability[chatId] = readiness.available === true;
    return readiness.available === true;
  } catch {
    return state.memoryToolAvailability?.[chatId] === true;
  }
}

export async function executeMemoryTool(
  state: RuntimeState,
  client: ServerClient,
  toolName: string,
  args: Record<string, unknown> | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const toolStarted = performance.now();
  const toolStartedAt = Date.now();
  const generation = state.mcpTurnKey;
  const active = state.activeModelRequest;
  const bound = active?.referenceTurnKey !== undefined ? active : undefined;
  const mainRequest = state.mainRequest;
  const requestSignal = mainRequest && (!bound || mainRequest.id === bound.requestId) ? mainRequest.signal : undefined;
  const callSignal = signal && requestSignal ? AbortSignal.any([signal, requestSignal]) : signal ?? requestSignal;
  const opportunity = state.memoryToolOpportunity;
  const expanding = toolName === "expand_rp_memory";
  const ref = typeof args?.ref === "string" ? args.ref.trim() : "";
  const query = String(expanding ? args?.focus ?? "" : args?.query ?? "").trim();
  const aspects = undefined;
  const intent = "recall" as const;
  let chatId = bound?.chatId ?? state.current?.chatId ?? opportunity?.chatId ?? "unknown";
  const call: TurnSearch = { kind: expanding ? "expand" : "recall", query, ...(expanding ? { ref } : {}), at: toolStartedAt,
    memoryIds: [], alreadyProvidedIds: [], response: "", responseTokens: 0, responseTruncated: false };
  if (!state.lastTurnSearches || state.lastTurnSearches.turnKey !== generation || (chatId !== "unknown" && state.lastTurnSearches.chatId !== chatId)) {
    state.lastTurnSearches = { chatId, turnKey: generation, calls: [] };
  }
  // Reserve the slot before any await so parallel calls stay in invocation order.
  const turnCalls = state.lastTurnSearches;
  turnCalls.calls.push(call);
  state.mcpTraceCalls = (state.mcpTraceCalls ?? 0) + 1;
  const traceContext = {
    requestId: crypto.randomUUID(),
    turnKey: bound?.turnKey ?? opportunity?.turnKey ?? generation,
    latestMessageId: bound?.latestMessageId,
    callIndex: state.mcpTraceCalls,
  };
  let timing: ReturnType<typeof startTiming> | undefined;
  let timingOutcome: "succeeded" | "failed" | "reused" = "failed";
  let requestMs: number | undefined;
  let hostReadMs = 0;
  let serverTimings: Record<string, number> | undefined;
  const traceDelivery = (response: string, cacheHit: boolean, selectedIds: string[] = [], searchRequestId: string | undefined = traceContext.requestId, deliverySource?: string, newAtomCount?: number, opportunityError?: string, reason?: string): void => {
    completeTurnSearch(call, response, reason ?? (["transport_error", "invalid_packet", "budget_rejected"].includes(deliverySource ?? "") ? deliverySource : undefined));
    if (typeof __RCM_DISTRIBUTION__ !== "undefined" && __RCM_DISTRIBUTION__) return;
    if (!state.retrievalTraceEnabled) return;
    void client.traceRetrieval({
      id: crypto.randomUUID(), kind: "mcp_delivery", chatId, traceContext,
      searchRequestId: reason ? undefined : searchRequestId,
      toolName, query, ref: expanding ? ref : undefined, aspects, intent, cacheHit,
      deliverySource, newAtomCount, opportunityError, selectedIds, response,
      elapsedMs: performance.now() - toolStarted, hostReadMs, requestMs, serverTimings,
      postDeliveryWait: "not_observed", origin: "client", reason,
      outcome: reason ? "rejected" : ["transport_error", "invalid_packet", "budget_rejected"].includes(deliverySource ?? "") ? "error" : "delivered",
    }).catch(() => undefined);
  };
  const reject = (reason: string, message: string): string => {
    const response = `<rp_memory_result>${message}</rp_memory_result>`;
    traceDelivery(response, false, [], undefined, undefined, 0, undefined, reason);
    return response;
  };
  if (!memoryToolFunctions.some((tool) => tool.name === toolName)) throw new Error(`Unknown memory tool: ${toolName}`);
  const earlierGeneration = () => state.mcpTurnKey !== generation
    || (bound && (bound.referenceTurnKey !== generation || state.activeModelRequest !== bound));
  const stale = () => reject("earlier_generation", "This tool is unavailable for the current reply.");
  const cancelled = () => reject("request_cancelled", MEMORY_TOOL_CANCELLED_MESSAGE);
  try {
    // Native/bridge tools carry no originating model request identity. A
    // concurrent RCM call is not evidence that this main-model tool is internal.
    if (!state.settings.memoryToolsEnabled) return reject("tools_disabled", "RCM memory tools are disabled in the dashboard.");
    signal?.throwIfAborted();
    if (earlierGeneration() || state.mainRequest?.preparing || (!bound && opportunity?.requestId)) return stale();
    if (requestSignal?.aborted) return cancelled();
    let scope: { chatId: string; characterId?: string } = bound ?? { chatId };
    if (!bound) {
      const started = performance.now();
      try {
        const current = await readCurrentChatScope();
        scope = current;
        const latest = current.hostSnapshot.chat.message?.at(-1);
        const latestId = latest?.chatId ?? latest?.id;
        if (latestId != null) traceContext.latestMessageId = String(latestId);
      } finally {
        hostReadMs = performance.now() - started;
      }
    }
    chatId = scope.chatId;
    turnCalls.chatId = chatId;
    if (earlierGeneration() || state.mainRequest?.preparing || (bound
      && (!currentTurnMemoryToolNames(state, chatId).includes(toolName as MemoryToolName)
        || (bound.plannedTools && !bound.plannedTools.includes(toolName))))) return stale();
    if (!isChatMemoryEnabled(state.settings, chatId, scope.characterId)) return reject("chat_disabled", "RCM is disabled for the current chat. Continue without RCM memory tools.");
    if (expanding ? !ref : !query) return reject(expanding ? "empty_ref" : "empty_query", "Provide a non-empty query for recall or a previously supplied ref for expansion.");
    signal?.throwIfAborted();
    if (requestSignal?.aborted) return cancelled();
    const available = await currentMemoryToolsAvailable(state, client, chatId, callSignal);
    signal?.throwIfAborted();
    if (earlierGeneration() || state.mainRequest?.preparing) return stale();
    if (requestSignal?.aborted) return cancelled();
    if (!available) return reject("no_memory", "No processed long-term memory is available for this chat yet. Continue without calling RCM memory tools.");
    timing = startTiming(state, {
      chatId,
      kind: "mcp",
      label: expanding ? "기억 상세 조회" : "기억 회상",
      startedAt: toolStartedAt,
    });
    const desired = state.settings.mcpCap;
    const callBudget = Math.min(desired, state.settings.mcpCap);
    const path = `/v1/chats/${encodeURIComponent(chatId)}/${expanding ? "expand" : "recall"}`;
    // Whole-memory exclusions would hide the remainder after a partial result.
    const injection = state.lastInjection && (state.lastInjection.chatId ?? chatId) === chatId
      && (!bound || state.lastInjection.turnKey === bound.turnKey) ? state.lastInjection : undefined;
    const delivered = injection?.manifest;
    const automaticGuidance = injection?.packet ?? "";
    const fullGuidanceDelivered = automaticGuidance.includes(memoryGuidanceBlock)
      || (injection?.guidanceInjected === true && !automaticGuidance.includes(initialMemoryGuidanceBlock));
    const common = fullGuidanceDelivered || state.mcpGuidanceDelivered
      ? "" : memoryGuidanceBlock;
    const responseReserve = 24;
    if (responseReserve >= callBudget) {
      return reject("budget_rejected", "Ask a shorter question so the result fits its budget.");
    }
    const shared = { intent, tokenBudget: callBudget - responseReserve, excludeMemoryIds: [], excludeMemorySignatures: [],
      memoryOnlyInjection: state.settings.memoryOnlyInjection[chatId] ?? false,
      alreadyPresentMemoryIds: delivered?.memoryIds ?? [],
      alreadyPresentAtomKeys: [...new Set([...(delivered?.atomKeys ?? []), ...(state.mcpReturnedAtomKeys ?? [])])].slice(-512),
      excludeAtomKeys: [...new Set(state.mcpReturnedAtomKeys ?? [])].slice(-512),
      excludeSourceRanges: (state.mcpReturnedSourceRanges ?? []).slice(-256),
      promptSourceMessageIds: bound?.promptSourceMessageIds ?? (injection ? state.lastPromptSourceMessageIds ?? [] : []),
      opportunityMemoryIds: opportunity?.chatId === chatId ? opportunity.value.recallCandidateMemoryIds : [],
      opportunityAtomKeys: opportunity?.chatId === chatId ? opportunity.value.recallCandidateAtomKeys : [],
      traceContext };
    const body = { ...shared, memoryGeneration: generation, ...(expanding ? { ref, ...(query ? { focus: query } : {}) } : { query }) };
    const requestStarted = performance.now();
    const result = await client.request<{ answers: McpQuestionAnswer[]; error?: string; code?: string; timings?: Record<string, number>; packet?: string; selected?: Array<{ id: string; signature?: string }>; coverage?: Array<{ aspect: string; status: string; memoryIds?: string[]; detailIds?: string[]; targetStatus?: string; targetMemoryIds?: string[]; targetDetailIds?: string[] }>; alreadyProvidedIds?: string[]; deliveredAtomKeys?: string[]; deliveredSourceRanges?: McpSourceRange[]; deliverySource?: string; newAtomCount?: number; opportunityError?: string }>(
      path,
      { method: "POST", body: JSON.stringify(body), signal: callSignal },
      expanding ? 15000 : (bound ? bound.mcpRequestTimeoutMs : state.lastPrepare?.mcpRequestTimeoutMs) ?? MCP_REQUEST_TIMEOUT_MS,
    ).catch(() => null);
    requestMs = performance.now() - requestStarted;
    serverTimings = result?.timings;
    signal?.throwIfAborted();
    if (earlierGeneration() || state.mainRequest?.preparing) return stale();
    if (requestSignal?.aborted) return cancelled();
    if (result?.code === "INVALID_MEMORY_REF") return reject("invalid_ref", INVALID_MEMORY_REF_MESSAGE);
    if (result?.code === "MEMORY_SNAPSHOT_CHANGED") return reject("snapshot_changed", "The memory changed during this request. Retry against the current chat.");
    if (!result) {
      const response = "<rp_memory_result>The memory server could not be reached. Continue from the chat and the memories you already have; this failure does not tell you whether the event happened.</rp_memory_result>";
      traceDelivery(response, false, [], traceContext.requestId, "transport_error", 0);
      return response;
    }
    if (result.opportunityError === "stale_turn" && !result.newAtomCount) {
      const response = '<rp_memory_result>These memories were prepared for an earlier reply. Continue from the current chat.</rp_memory_result>';
      traceDelivery(response, false, [], traceContext.requestId, result.deliverySource, 0, result.opportunityError, "earlier_generation");
      return response;
    }
    const serverPacket = result.packet?.trim();
    if (!serverPacket?.startsWith("<rp_memory_result>") || !serverPacket.endsWith("</rp_memory_result>")) {
      const response = "<rp_memory_result>The memory server sent an unreadable answer. Continue from the chat and the memories you already have; this failure does not tell you whether the event happened.</rp_memory_result>";
      traceDelivery(response, false, [], traceContext.requestId, "invalid_packet", 0);
      return response;
    }
    const hasContent = result.answers.some(answer => Boolean(answer.synthesizedText?.trim()
      || answer.evidence.length || answer.alreadyProvidedEvidence?.length));
    // The server owns selection, rendering, refs and response-budget assembly.
    // Re-rendering `answers` here can turn a compact synthesized answer back into
    // its much larger evidence corpus and make client/server budget checks disagree.
    // The server prices its complete guidance. Keep one copy in this turn,
    // whether it first arrived with automatic memory or a tool response.
    const packetBody = serverPacket.replace(memoryGuidanceBlock, "");
    const response = common && hasContent
      ? packetBody.replace("<rp_memory_result>", `<rp_memory_result>${common}`)
      : packetBody;
    if (estimateTokens(response) > callBudget) {
      const rejected = '<rp_memory_result>The answer was too long to send. Ask a narrower question.</rp_memory_result>';
      traceDelivery(rejected, false, [], traceContext.requestId, "budget_rejected", 0);
      return rejected;
    }
    if (common && hasContent) state.mcpGuidanceDelivered = true;
    state.mcpReturnedMemoryIds = [...new Set([...(state.mcpReturnedMemoryIds ?? []), ...(result.selected ?? []).map((item) => item.id)])].slice(-128);
    state.mcpReturnedMemorySignatures = [...new Set([...(state.mcpReturnedMemorySignatures ?? []), ...(result.selected ?? []).flatMap((item) => item.signature ? [item.signature] : [])])].slice(-128);
    state.mcpReturnedAtomKeys = [...new Set([...(state.mcpReturnedAtomKeys ?? []), ...(result.deliveredAtomKeys ?? [])])].slice(-512);
    const sourceRanges = new Map<string, McpSourceRange>();
    for (const range of [...(state.mcpReturnedSourceRanges ?? []), ...(result.deliveredSourceRanges ?? [])]) {
      sourceRanges.set(`${range.messageId}:${range.start}:${range.end}`, range);
    }
    state.mcpReturnedSourceRanges = [...sourceRanges.values()].slice(-256);
    traceDelivery(response, false, (result.selected ?? []).map((item) => item.id), traceContext.requestId, result.deliverySource, result.newAtomCount, result.opportunityError);
    call.memoryIds = [...new Set([...(result.selected ?? []).map(item => item.id), ...(result.alreadyProvidedIds ?? []), ...result.answers.flatMap(answer => (answer.alreadyProvidedEvidence ?? []).flatMap(item => item.memoryId ? [item.memoryId] : []))])];
    call.alreadyProvidedIds = [...new Set([...(result.alreadyProvidedIds ?? []), ...result.answers.flatMap(answer => (answer.alreadyProvidedEvidence ?? []).flatMap(item => item.memoryId ? [item.memoryId] : []))])];
    if (expanding) {
      call.expandedMemoryId = result.answers.flatMap(answer => [...answer.evidence, ...(answer.alreadyProvidedEvidence ?? [])])
        .find(item => item.ref === ref && item.memoryId)?.memoryId
        ?? (call.memoryIds.length === 1 ? call.memoryIds[0] : undefined);
    }
    timingOutcome = "succeeded";
    return response;
  } catch (error) {
    if (signal?.aborted) {
      traceDelivery(MEMORY_TOOL_CANCELLED_MESSAGE, false, [], undefined, undefined, 0, undefined, "request_cancelled");
      throw error;
    }
    return reject("transport_error", "The memory server could not be reached. Continue from the chat and the memories you already have; this failure does not tell you whether the event happened.");
  } finally {
    if (timing) finishTiming(state, timing, timingOutcome);
  }
}

export async function registerMemoryMcp(state: RuntimeState, client: ServerClient): Promise<void> {
  await risuai.registerMCP(
    {
      identifier: "plugin:risu-cognitive-memory",
      name: "Risu Cognitive Memory",
      version: RCM_PLUGIN_VERSION,
      description: "Optional search and expansion of processed RP history. Use supplied evidence first; avoid repeating an unchanged unsuccessful query.",
    },
    async () => {
      if (!state.settings.memoryToolsEnabled || state.mainRequest?.preparing) return [];
      try {
        const active = state.activeModelRequest;
        const { chatId, characterId } = active?.referenceTurnKey !== undefined && active.referenceTurnKey === state.mcpTurnKey
          ? active : await readCurrentChatScope();
        if (!isChatMemoryEnabled(state.settings, chatId, characterId)) return [];
        const names = currentTurnMemoryToolNames(state, chatId);
        traceMemoryToolExposure(state, client, "native", names, names, names.length ? "offered" : "empty");
        return toolDefinitions(state, chatId, names);
      } catch {
        const planned = currentTurnMemoryToolNames(state);
        traceMemoryToolExposure(state, client, "native", planned, [], "error");
        return [];
      }
    },
    async (toolName, args) => [{ type: "text", text: await executeMemoryTool(state, client, toolName, args) }],
  );
}
