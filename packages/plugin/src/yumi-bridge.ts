import type { ServerClient } from "./api-client.js";
import { currentTurnMemoryToolNames, executeMemoryTool, MCP_REQUEST_TIMEOUT_MS, memoryToolFunctions, traceMemoryToolExposure, type MemoryToolName } from "./mcp.js";
import { addLog } from "./settings.js";
import type { RuntimeState } from "./types.js";

const PROVIDER_MANAGER = "provider-manager";
const REQUEST_CHANNEL = "tool-ipc.v1/request";
const RESPONSE_CHANNEL = "tool-ipc.v1/response";
const EVENT_CHANNEL = "tool-ipc.v1/event";
const PLUGIN_NAME = "risu-cognitive-memory";
const REGISTRATION_TIMEOUT_MS = 1_000;
const DISCOVERY_REGISTRATION_KEY = "__rcm_discovery__";

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

  const registerFunctions = async (names: MemoryToolName[], registrationKey: string, diagnostics: Record<string, unknown> = {}): Promise<void> => {
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
        reject(new Error("tools/register acknowledgement timed out"));
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
      diagnostics.status = "acknowledged";
      diagnostics.ackWaitMs = performance.now() - startedAt;
      registeredFunctions = new Set(names);
      registeredTurnKey = registrationKey;
    } catch (error) {
      diagnostics.status ??= "error";
      diagnostics.ackWaitMs ??= performance.now() - startedAt;
      throw error;
    }
  };

  state.restoreMemoryToolDiscoveryRegistration = async () => {
    if (!state.settings.memoryToolsEnabled) return;
    const allNames = memoryToolFunctions.map((tool) => tool.name as MemoryToolName);
    const allKey = [...allNames].sort().join(",");
    const registeredKey = [...registeredFunctions].sort().join(",");
    if (registeredTurnKey === DISCOVERY_REGISTRATION_KEY && allKey === registeredKey) return;
    await registerFunctions(allNames, DISCOVERY_REGISTRATION_KEY);
  };

  state.syncMemoryToolRegistration = async (enabled) => {
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
      const changed = registeredFunctions.size > 0;
      if (changed) {
        await post(EVENT_CHANNEL, envelope("event", "tools/unregister", { all: true })).catch(() => undefined);
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
      await registerFunctions(planned, state.memoryToolOpportunity?.turnKey ?? "", registration);
      traceMemoryToolExposure(state, client, "yumi", planned, planned, "offered", Date.now() - startedAt, false, registration);
    } catch (error) {
      const timeout = String(error).includes("timed out");
      traceMemoryToolExposure(state, client, "yumi", planned, [], timeout ? "timeout" : "error", Date.now() - startedAt, false, registration);
      addLog(state.logs, "warn", `Yumi memory tool registration unconfirmed: ${String(error)}`);
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
    if (message.type === "error") waiting.reject(new Error(message.error?.message ?? "Provider Manager rejected the request"));
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
          message: cancelled ? "The memory tool call was cancelled. Do not retry unless still needed." : String(error),
          retryable: !cancelled,
        });
      } finally {
        activeCalls.delete(callId);
      }
    })();
  });

  if (typeof risuai.onUnload === "function") {
    await risuai.onUnload(async () => {
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
      await post(EVENT_CHANNEL, unregister);
    });
  }

}

export { yumiToolDefinition };
