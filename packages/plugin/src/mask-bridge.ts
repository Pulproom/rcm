import { MCP_MAX_REQUEST_TIMEOUT_MS } from "@rcm/shared";
import type { ServerClient } from "./api-client.js";
import { executeMemoryTool, memoryToolFunctions } from "./mcp.js";
import type { RuntimeState } from "./types.js";

const MASK_RUNTIME = "hush27_mask_local_tools";
const RCM_PLUGIN = "risu-cognitive-memory";
const PROTOCOL_VERSION = 2;
const REQUEST_CHANNEL = "rcm-mask-tools.v2/request";
const RESPONSE_CHANNEL_PREFIX = "rcm-mask-tools.v2/response/";

interface MaskToolRequest {
  version: 2;
  sender: typeof MASK_RUNTIME;
  id: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validRequest = (value: unknown, metadata?: { sender?: string }): value is MaskToolRequest => {
  if (!isRecord(value)) return false;
  return value.version === PROTOCOL_VERSION
    && value.sender === MASK_RUNTIME
    && (metadata?.sender === undefined || metadata.sender === MASK_RUNTIME)
    && typeof value.id === "string"
    && value.id.length > 0
    && typeof value.toolName === "string"
    && (value.arguments === undefined || isRecord(value.arguments));
};

export async function registerMaskToolBridge(state: RuntimeState, client: ServerClient): Promise<void> {
  if (typeof risuai.addPluginChannelListener !== "function" || typeof risuai.postPluginChannelMessage !== "function") return;

  await risuai.addPluginChannelListener(REQUEST_CHANNEL, (raw, metadata) => {
    void (async () => {
      if (!validRequest(raw, metadata)) return;
      const responseChannel = `${RESPONSE_CHANNEL_PREFIX}${raw.toolName}`;
      if (!memoryToolFunctions.some((tool) => tool.name === raw.toolName)) {
        await risuai.postPluginChannelMessage(MASK_RUNTIME, responseChannel, {
          version: PROTOCOL_VERSION,
          sender: RCM_PLUGIN,
          id: raw.id,
          ok: false,
          error: "The requested RCM tool is not registered.",
        });
        return;
      }
      try {
        await risuai.postPluginChannelMessage(MASK_RUNTIME,responseChannel,{
          version:PROTOCOL_VERSION,sender:RCM_PLUGIN,id:raw.id,accepted:true,timeoutMs:MCP_MAX_REQUEST_TIMEOUT_MS+10000,
        });
        const text = await executeMemoryTool(state, client, raw.toolName, raw.arguments);
        await risuai.postPluginChannelMessage(MASK_RUNTIME, responseChannel, {
          version: PROTOCOL_VERSION,
          sender: RCM_PLUGIN,
          id: raw.id,
          ok: true,
          text,
        });
      } catch {
        await risuai.postPluginChannelMessage(MASK_RUNTIME, responseChannel, {
          version: PROTOCOL_VERSION,
          sender: RCM_PLUGIN,
          id: raw.id,
          ok: false,
          error: "RCM could not complete the memory lookup. Keep the history uncertain and continue without retrying immediately.",
        });
      }
    })();
  });
}

export const maskToolProtocol = {
  version: PROTOCOL_VERSION,
  runtime: MASK_RUNTIME,
  requestChannel: REQUEST_CHANNEL,
  responseChannelPrefix: RESPONSE_CHANNEL_PREFIX,
} as const;
