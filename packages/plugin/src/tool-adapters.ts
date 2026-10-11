import type { ServerClient } from "./api-client.js";
import { registerMemoryMcp } from "./mcp.js";
import { addLog } from "./settings.js";
import type { RuntimeState } from "./types.js";
import { registerYumiToolBridge } from "./yumi-bridge.js";

interface MemoryToolAdapterRegistrars {
  native: typeof registerMemoryMcp;
  yumi: typeof registerYumiToolBridge;
}

const defaultRegistrars: MemoryToolAdapterRegistrars = {
  native: registerMemoryMcp,
  yumi: registerYumiToolBridge,
};

export async function registerMemoryToolAdapters(
  state: RuntimeState,
  client: ServerClient,
  registrars: MemoryToolAdapterRegistrars = defaultRegistrars,
): Promise<void> {
  try {
    await registrars.native(state, client);
  } catch (error) {
    addLog(state.logs, "warn", `Native MCP registration unavailable: ${String(error)}`);
  }

  try {
    await registrars.yumi(state, client);
    if (state.settings.memoryToolsEnabled) {
      // Keep the external-tool entry available in Provider Manager while idle.
      // beforeRequest replaces this discovery bundle with the turn-safe subset.
      void state.restoreMemoryToolDiscoveryRegistration?.().catch(() => undefined);
    }
  } catch (error) {
    addLog(state.logs, "warn", `Yumi Provider Manager bridge unavailable: ${String(error)}`);
  }
}
