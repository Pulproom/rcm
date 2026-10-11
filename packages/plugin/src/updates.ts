import type { ServerClient } from "./api-client.js";
import { isServerConfigured } from "./connection.js";
import type { RuntimeState } from "./types.js";
import { compareNumericVersions, RCM_PLUGIN_VERSION } from "@rcm/shared";

const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export function pluginUpdateNeeded(status: RuntimeState["updateStatus"], currentVersion = RCM_PLUGIN_VERSION): boolean {
  return Boolean(status?.latestPluginVersion && compareNumericVersions(status.latestPluginVersion, currentVersion) > 0);
}

export async function refreshUpdateStatus(
  state: RuntimeState,
  client: Pick<ServerClient, "request">,
  options: { remote?: boolean; force?: boolean; now?: number } = {},
): Promise<RuntimeState["updateStatus"] | undefined> {
  if (!isServerConfigured(state.settings)) return undefined;
  if (state.updateCheckPromise) return state.updateCheckPromise;
  const now = options.now ?? Date.now();
  if (!options.force && (state.updateNextCheckAt ?? 0) > now) return state.updateStatus;
  const path = options.remote === false ? "/v1/update/status" : "/v1/update/status?refresh=1";
  state.updateNextCheckAt = now + UPDATE_INTERVAL_MS;
  const pending = client.request<NonNullable<RuntimeState["updateStatus"]>>(path, {}, 20_000)
    .then((update) => {
      state.updateStatus = update;
      state.publishActivity?.();
      return update;
    })
    .catch(() => state.updateStatus)
    .finally(() => { state.updateCheckPromise = undefined; });
  state.updateCheckPromise = pending;
  return pending;
}

export interface ServerUpdateInstallResult {
  status: "completed" | "manual" | "failed";
  targetVersion?: string;
  message?: string;
}

export async function installServerUpdate(
  state: RuntimeState,
  client: Pick<ServerClient, "request">,
  options: { wait?: (milliseconds: number) => Promise<void>; attempts?: number } = {},
): Promise<ServerUpdateInstallResult> {
  const wait = options.wait ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const staged = state.updateStatus?.restartRequired && state.updateStatus.stagedVersion
    ? state.updateStatus
    : await client.request<NonNullable<RuntimeState["updateStatus"]>>("/v1/update/stage", { method: "POST" }, 130_000);
  state.updateStatus = staged;
  const targetVersion = staged.stagedVersion ?? staged.latestServerVersion;
  if (!staged.restartRequired || !targetVersion) return { status: "failed", message: "설치할 서버 업데이트를 준비하지 못했습니다." };
  if (!staged.canApplyAutomatically) {
    state.publishActivity?.();
    return { status: "manual", targetVersion };
  }
  state.updateApplying = { targetVersion, startedAt: Date.now() };
  state.publishActivity?.();
  try {
    await client.request<{ accepted: true; targetVersion: string }>("/v1/update/apply", { method: "POST" }, 15_000);
  } catch (error) {
    state.updateApplying = { targetVersion, startedAt: state.updateApplying.startedAt, error: error instanceof Error ? error.message : String(error) };
    state.publishActivity?.();
    return { status: "failed", targetVersion, message: state.updateApplying.error };
  }
  for (let attempt = 0; attempt < (options.attempts ?? 90); attempt += 1) {
    await wait(1_000);
    try {
      const health = await client.request<{ version?: string; ok?: boolean }>("/v1/health", {}, 3_000);
      if (health.ok && health.version === targetVersion) {
        state.updateApplying = undefined;
        state.updateNextCheckAt = 0;
        // Refresh the release manifest as well as local state so a plugin-only
        // follow-up remains visible after the server has restarted.
        await refreshUpdateStatus(state, client, { remote: true, force: true });
        state.publishActivity?.();
        return { status: "completed", targetVersion };
      }
    } catch { /* The server is expected to be briefly unavailable. */ }
  }
  state.updateApplying = { targetVersion, startedAt: state.updateApplying?.startedAt ?? Date.now(), error: "새 서버가 제한 시간 안에 준비되지 않았습니다." };
  state.updateNextCheckAt = 0;
  await refreshUpdateStatus(state, client, { remote: false, force: true });
  state.publishActivity?.();
  return { status: "failed", targetVersion, message: state.updateApplying?.error };
}
