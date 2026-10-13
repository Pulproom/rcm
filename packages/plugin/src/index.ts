import { openDashboard } from "./dashboard.js";
import { registerMaskToolBridge } from "./mask-bridge.js";
import { createRuntime, installInitializationRequestGate, installRequestHooks } from "./runtime.js";
import { addLog } from "./settings.js";
import { drainWorker, heartbeatServerWorker } from "./worker.js";
import { registerMemoryToolAdapters } from "./tool-adapters.js";
import { installStatusWidget, updateWorkerMenuButton, registerDashboardSetting } from "./attention.js";
import { installActivityCoordinator } from "./activity.js";
import { readOptionalDashboardContext } from "./context.js";
import { isServerConfigured } from "./connection.js";
declare const __RCM_DISTRIBUTION__: boolean;

void (async () => {
  let requestHooksReady = false;
  // Register the fail-closed gate before storage/settings hydration, which can
  // be noticeably delayed immediately after a PocketRisu reload.
  await installInitializationRequestGate(() => requestHooksReady);
  const { state, client } = await createRuntime();
  // Request hooks are the core automatic-memory path. Register them before
  // optional provider tool adapters so a slow or unavailable bridge cannot
  // prevent automatic injection.
  await installRequestHooks(state, client);
  requestHooksReady = true;
  await registerMemoryToolAdapters(state, client);
  if (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) try {
    await registerMaskToolBridge(state, client);
  } catch (error) {
    addLog(state.logs, "warn", `Mask Local Tools bridge unavailable: ${String(error)}`);
  }
  const open = () => void openDashboard(state, client);
  state.openDashboard = open;
  await registerDashboardSetting(state);
  await installStatusWidget(state, client);
  // Hydrate the active chat before the first activity poll. Without this,
  // the floating widget can claim the queue is healthy until another host
  // interaction happens to populate state.current.
  await readOptionalDashboardContext(state);
  installActivityCoordinator(state, client);
  await updateWorkerMenuButton(state);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void drainWorker(state, client);
  });
  window.addEventListener("online", () => void drainWorker(state, client));
  state.serverHeartbeatTimer = window.setInterval(() => void heartbeatServerWorker(state, client), 15_000);
  addLog(state.logs, "info", "Risu Cognitive Memory initialized");
  if (isServerConfigured(state.settings)) {
    if (state.settings.extractionEngine === "server" && state.settings.workerPaused && !state.settings.workerAttention) void client.pauseServerWorker();
    else void drainWorker(state, client);
  }
})().catch((error) => console.error("[Risu Cognitive Memory] initialization failed", error));
