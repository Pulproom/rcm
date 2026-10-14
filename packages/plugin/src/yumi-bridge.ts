import { supportFailure } from "./support-diagnostics.js";
import type { ServerClient } from "./api-client.js";
import { currentTurnMemoryToolNames, executeMemoryTool, MEMORY_TOOL_CANCELLED_MESSAGE, MCP_REQUEST_TIMEOUT_MS, memoryToolFunctions, traceMemoryToolExposure, type MemoryToolName } from "./mcp.js";
import { addLog } from "./settings.js";
import type { RuntimeState } from "./types.js";

const PROVIDER_MANAGER = "provider-manager";
const REQUEST_CHANNEL = "tool-ipc.v1/request";
const RESPONSE_CHANNEL = "tool-ipc.v1/response";
const EVENT_CHANNEL = "tool-ipc.v1/event";
const PLUGIN_NAME = "risu-cognitive-memory";
const REGISTRATION_TIMEOUT_MS = 1_000;
const DISCOVERY_REGISTRATION_KEY = "__rcm_discovery__";
const DISCOVERY_RETRY_MS = 5_000;
const DISCOVERY_REFRESH_MS = 30_000;

type EnvelopeType = "request" | "response" | "error" | "event";

interface ToolIpcEnvelope {
  protocol: "tool-ipc";
  version: 1;
  id: string;
  type: EnvelopeType;
  method: string;
  sender: { pluginName: string; instanceId: string };
  params?: any;
  result?: any;
  error?: { code: string; message: string; retryable?: boolean };
  meta: { traceId: string; createdAt: number; timeoutMs?: number };
}

const yumiToolDefinition = {
  id: "risu-cognitive-memory",
  name: "Risu Cognitive Memory",
  description: "Intent-aware, perspective-safe recall from the currently open Risu roleplay chat.",
  functions: memoryToolFunctions.map((tool) => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    uiDescription: tool.name === "recall_rp_memory"
      ? "현재 RP 채팅의 과거 기억을 관점과 목적에 맞춰 검색합니다."
      : "참조한 기억에서 필요한 미전달 세부를 검색합니다.",
    inputSchema: tool.inputSchema,
    timeoutMs: MCP_REQUEST_TIMEOUT_MS,
    confirm: false,
  })),
};

const yumiDefinitionFor = (names: MemoryToolName[]) => ({
  ...yumiToolDefinition,
  functions: yumiToolDefinition.functions.filter((tool) => names.includes(tool.name as MemoryToolName)),
});

const serializableArguments = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function isProviderManagerEnvelope(
  message: Partial<ToolIpcEnvelope>,
  metadata?: { sender?: string },
): boolean {
  return message.protocol === "tool-ipc"
    && message.version === 1
    && message.sender?.pluginName === PROVIDER_MANAGER
    && (!metadata?.sender || metadata.sender === PROVIDER_MANAGER);
}

export async function registerYumiToolBridge(state: RuntimeState, client: ServerClient): Promise<void> {
  if (typeof risuai.addPluginChannelListener !== "function" || typeof risuai.postPluginChannelMessage !== "function") {
    state.memoryToolRegistration = { status: "unavailable", at: Date.now(), failures: 0 };
    addLog(state.logs, "warn", "Provider Manager 기억 도구 연결에 필요한 플러그인 통신 API가 없습니다.");
    state.syncMemoryToolRegistration = async (enabled) => {
      const planned = enabled ? currentTurnMemoryToolNames(state) : [];
      traceMemoryToolExposure(state, client, "yumi", planned, [], "not_connected");
    };
    state.restoreMemoryToolDiscoveryRegistration = async () => undefined;
    return;
  }

  const instanceId = crypto.randomUUID();
  const pending = new Map<string, {
    resolve: (message: ToolIpcEnvelope) => void;
    reject: (error: Error) => void;
    timeout: number;
  }>();
  const lateRegistrations = new Map<string, (message: ToolIpcEnvelope) => void>();
  const activeCalls = new Map<string, AbortController>();
  const cancelledCalls = new Set<string>();
  let registeredFunctions = new Set<MemoryToolName>();
  let registeredTurnKey = "";
  let disposed = false;
  let discoveryWanted = false;
  let discoveryTimer: number | undefined;
  let discoveryPending: Promise<void> | undefined;
  let registrationEpoch = 0;
  let discoveryFailures = 0;
  const setStatus = (status: NonNullable<RuntimeState["memoryToolRegistration"]>["status"]) => {
    state.memoryToolRegistration = { status, at: Date.now(), failures: discoveryFailures };
    state.publishActivity?.();
  };
  const stopDiscovery = () => {
    discoveryWanted = false;
    registrationEpoch++;
    window.clearTimeout(discoveryTimer);
    discoveryTimer = undefined;
  };

  const envelope = (type: EnvelopeType, method: string, params?: unknown): ToolIpcEnvelope => ({
    protocol: "tool-ipc",
    version: 1,
    id: `rcm-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    type,
    method,
    sender: { pluginName: PLUGIN_NAME, instanceId },
    ...(params === undefined ? {} : { params }),
    meta: { traceId: crypto.randomUUID(), createdAt: Date.now() },
  });

  const post = (channel: string, message: ToolIpcEnvelope): Promise<void> =>
    risuai.postPluginChannelMessage(PROVIDER_MANAGER, channel, message);

  const respond = async (request: ToolIpcEnvelope, result?: unknown, error?: ToolIpcEnvelope["error"]): Promise<void> => {
    const response = envelope(error ? "error" : "response", request.method);
    response.id = request.id;
    response.meta.traceId = request.meta?.traceId ?? response.meta.traceId;
    if (error) response.error = error;
    else response.result = result;
    await post(RESPONSE_CHANNEL, response);
  };

  const registerFunctions = async (names: MemoryToolName[], registrationKey: string, diagnostics: Record<string, unknown> = {}): Promise<boolean> => {
    const epoch = registrationEpoch;
    const message = envelope("request", "tools/register", yumiDefinitionFor(names));
    message.meta.timeoutMs = REGISTRATION_TIMEOUT_MS;
    const startedAt = performance.now();
    diagnostics.requestId = message.id;
    diagnostics.timeoutMs = REGISTRATION_TIMEOUT_MS;
    const chatId = state.memoryToolOpportunity?.chatId ?? state.current?.chatId;
    const latestMessageId = state.current?.snapshot?.at(-1)?.id;
    const tracing = state.retrievalTraceEnabled && registrationKey !== DISCOVERY_REGISTRATION_KEY;
    const response = new Promise<ToolIpcEnvelope>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pending.delete(message.id);
        diagnostics.status = "unconfirmed";
        diagnostics.exposure = "unknown";
        diagnostics.ackWaitMs = performance.now() - startedAt;
        lateRegistrations.set(message.id, (reply) => {
          if (!tracing || !chatId) return;
          void client.traceRetrieval({
            id: crypto.randomUUID(), kind: "tool_exposure", chatId,
            traceContext: { requestId: registrationKey, turnKey: registrationKey, latestMessageId },
            transport: "yumi", plannedTools: names, offeredTools: [],
            outcome: reply.type === "error" ? "registration_rejected_late" : "registration_acknowledged_late",
            registration: { ...diagnostics, status: reply.type === "error" ? "rejected_late" : "acknowledged_late", exposure: "unknown", ackWaitMs: performance.now() - startedAt },
          }).catch(() => undefined);
        });
        // Bounded diagnostic history only; late replies never alter turn state.
        if (lateRegistrations.size > 32) lateRegistrations.delete(lateRegistrations.keys().next().value!);
        reject(Object.assign(new Error("tools/register acknowledgement timed out"), { code: "MCP_REGISTRATION_TIMEOUT" }));
      }, REGISTRATION_TIMEOUT_MS);
      pending.set(message.id, { resolve, reject, timeout });
    });
    void post(REQUEST_CHANNEL, message).then(() => {
      diagnostics.postMs = performance.now() - startedAt;
    }, (error) => {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      window.clearTimeout(waiting.timeout);
      pending.delete(message.id);
      waiting.reject(error);
    });
    try {
      await response;
      // An idle registration acknowledged after a turn starts (or unloading)
      // must not overwrite the turn-specific registration state.
      if (disposed || epoch !== registrationEpoch) return false;
      diagnostics.status = "acknowledged";
      diagnostics.ackWaitMs = performance.now() - startedAt;
      registeredFunctions = new Set(names);
      registeredTurnKey = registrationKey;
      return true;
    } catch (error) {
      diagnostics.status ??= "error";
      diagnostics.ackWaitMs ??= performance.now() - startedAt;
      throw error;
    }
  };

  const refreshDiscovery = (): Promise<void> => {
    if (disposed || !discoveryWanted || !state.settings.memoryToolsEnabled) return Promise.resolve();
    if (discoveryPending) return discoveryPending;
    window.clearTimeout(discoveryTimer);
    const epoch = registrationEpoch;
    if (!discoveryFailures && registeredTurnKey !== DISCOVERY_REGISTRATION_KEY) setStatus("pending");
    discoveryPending = (async () => {
      try {
        await registerFunctions(memoryToolFunctions.map((tool) => tool.name as MemoryToolName), DISCOVERY_REGISTRATION_KEY);
        if (disposed || epoch !== registrationEpoch) return;
        if (discoveryFailures) addLog(state.logs, "info", "Provider Manager 기억 도구 등록이 복구되었습니다.");
        discoveryFailures = 0;
        setStatus("registered");
      } catch (error) {
        if (disposed || epoch !== registrationEpoch) return;
        discoveryFailures++;
        // Provider Manager is optional. Log the transition, not every retry.
        if (discoveryFailures === 1) addLog(state.logs, "warn", `Provider Manager 기억 도구 등록 미확인 · 대기 중 자동 재시도: ${String(error)}`, supportFailure("provider_manager_registration", error, { attempt: discoveryFailures }));
        setStatus("retrying");
      } finally {
        discoveryPending = undefined;
        if (!disposed && discoveryWanted && state.settings.memoryToolsEnabled) {
          const delay = discoveryFailures ? Math.min(DISCOVERY_REFRESH_MS, DISCOVERY_RETRY_MS * 2 ** Math.min(discoveryFailures - 1, 3)) : DISCOVERY_REFRESH_MS;
          discoveryTimer = window.setTimeout(() => { void refreshDiscovery(); }, delay);
        }
      }
    })();
    return discoveryPending;
  };

  state.restoreMemoryToolDiscoveryRegistration = async () => {
    if (disposed || !state.settings.memoryToolsEnabled) return;
    discoveryWanted = true;
    if (registeredTurnKey === DISCOVERY_REGISTRATION_KEY && discoveryTimer !== undefined) return;
    await refreshDiscovery();
  };

  state.syncMemoryToolRegistration = async (enabled) => {
    if (disposed) return;
    stopDiscovery();
    setStatus(state.settings.memoryToolsEnabled ? "paused" : "disabled");
    const planned = enabled ? currentTurnMemoryToolNames(state) : [];
    const startedAt = Date.now();
    const plannedKey = [...planned].sort().join(",");
    const registeredKey = [...registeredFunctions].sort().join(",");
    if (planned.length && state.memoryToolOpportunity?.turnKey === registeredTurnKey && plannedKey === registeredKey) {
      traceMemoryToolExposure(state, client, "yumi", planned, planned, "offered", 0, false);
      return;
    }
    if (!planned.length) {
      const clearingDiscoveryOnly = registeredTurnKey === DISCOVERY_REGISTRATION_KEY;
      const changed = registeredFunctions.size > 0 || discoveryPending !== undefined;
      if (changed) {
        void post(EVENT_CHANNEL, envelope("event", "tools/unregister", { all: true })).catch(() => undefined);
        registeredFunctions.clear();
        registeredTurnKey = "";
      }
      if (!clearingDiscoveryOnly) {
        traceMemoryToolExposure(state, client, "yumi", planned, [], "empty", Date.now() - startedAt, changed);
      }
      return;
    }
    const registration: Record<string, unknown> = {};
    try {
      // Provider Manager replaces a tool bundle with the same id. Registering the
      // new turn directly avoids a visible missing/error state between unregister
      // and register, while the longer bound covers normal browser IPC variance.
      if (!await registerFunctions(planned, state.memoryToolOpportunity?.turnKey ?? "", registration)) return;
      setStatus("registered");
      traceMemoryToolExposure(state, client, "yumi", planned, planned, "offered", Date.now() - startedAt, false, registration);
    } catch (error) {
      const timeout = String(error).includes("timed out");
      traceMemoryToolExposure(state, client, "yumi", planned, [], timeout ? "timeout" : "error", Date.now() - startedAt, false, registration);
      addLog(state.logs, "warn", `Yumi memory tool registration unconfirmed: ${String(error)}`, supportFailure("provider_manager_registration", error));
    }
  };

  await risuai.addPluginChannelListener(RESPONSE_CHANNEL, (raw, metadata) => {
    const message = raw as Partial<ToolIpcEnvelope>;
    if (!isProviderManagerEnvelope(message, metadata) || !message.id || !["response", "error"].includes(message.type ?? "")) return;
    const waiting = pending.get(message.id);
    if (!waiting) {
      const late = lateRegistrations.get(message.id);
      lateRegistrations.delete(message.id);
      late?.(message as ToolIpcEnvelope);
      return;
    }
    window.clearTimeout(waiting.timeout);
    pending.delete(message.id);
    if (message.type === "error") waiting.reject(Object.assign(new Error(message.error?.message ?? "Provider Manager rejected the request"), { code: "MCP_REGISTRATION_REJECTED" }));
    else waiting.resolve(message as ToolIpcEnvelope);
  });

  await risuai.addPluginChannelListener(REQUEST_CHANNEL, (raw, metadata) => {
    void (async () => {
      const message = raw as Partial<ToolIpcEnvelope>;
      if (!isProviderManagerEnvelope(message, metadata) || message.type !== "request" || !message.id || !message.method) return;
      const requestMessage = message as ToolIpcEnvelope;
      if (requestMessage.method === "tools/challenge") {
        await respond(requestMessage, { nonce: requestMessage.params?.nonce });
        return;
      }
      if (requestMessage.method === "tools/cancel") {
        const callId = String(requestMessage.params?.callId ?? "");
        const active = activeCalls.get(callId);
        if (active) active.abort(new Error("Memory tool call cancelled by Provider Manager"));
        else if (callId) cancelledCalls.add(callId);
        return;
      }
      if (requestMessage.method !== "tools/call") {
        await respond(requestMessage, undefined, { code: "METHOD_NOT_FOUND", message: `Unsupported method: ${requestMessage.method}`, retryable: false });
        return;
      }
      const callId = String(requestMessage.params?.callId ?? requestMessage.id);
      const toolId = String(requestMessage.params?.toolId ?? "");
      const functionId = String(requestMessage.params?.functionId ?? "");
      if (toolId !== yumiToolDefinition.id || !registeredFunctions.has(functionId as MemoryToolName)) {
        await respond(requestMessage, undefined, { code: "TOOL_NOT_FOUND", message: "The requested RCM tool is not registered.", retryable: false });
        return;
      }
      const controller = new AbortController();
      activeCalls.set(callId, controller);
      if (cancelledCalls.delete(callId)) controller.abort(new Error("Memory tool call cancelled by Provider Manager"));
      try {
        const data = await executeMemoryTool(
          state,
          client,
          functionId,
          serializableArguments(requestMessage.params?.arguments),
          controller.signal,
        );
        await respond(requestMessage, { callId, data });
      } catch (error) {
        const cancelled = controller.signal.aborted;
        await respond(requestMessage, undefined, {
          code: cancelled ? "CANCELLED" : "TOOL_EXECUTION_FAILED",
          message: cancelled ? MEMORY_TOOL_CANCELLED_MESSAGE : String(error),
          retryable: !cancelled,
        });
      } finally {
        activeCalls.delete(callId);
      }
    })();
  });

  if (typeof risuai.onUnload === "function") {
    await risuai.onUnload(async () => {
      disposed = true;
      stopDiscovery();
      activeCalls.forEach((controller) => controller.abort(new Error("RCM plugin unloaded")));
      activeCalls.clear();
      cancelledCalls.clear();
      for (const waiting of pending.values()) {
        window.clearTimeout(waiting.timeout);
        waiting.reject(new Error("RCM plugin unloaded"));
      }
      pending.clear();
      lateRegistrations.clear();
      const unregister = envelope("event", "tools/unregister", { all: true });
      void post(EVENT_CHANNEL, unregister).catch(() => undefined);
    });
  }

}

export { yumiToolDefinition };
