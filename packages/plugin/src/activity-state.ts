import type { RuntimeState } from "./types.js";
import type { ServerClient } from "./api-client.js";
import { addLog, saveSettings } from "./settings.js";
import { ServerRequestError, safeErrorText } from "./server-errors.js";

export function isChatUpgrading(error: unknown): boolean {
  return error instanceof ServerRequestError && error.status === 423 && error.code === "CHAT_UPGRADING";
}

type BackgroundWrite = { serverUrl: string; chatId: string | undefined; write: () => Promise<unknown>; deferred: boolean; running?: Promise<boolean> };
const backgroundWrites = new WeakMap<RuntimeState, Map<string, BackgroundWrite>>();

function executeBackgroundWrite(state: RuntimeState, key: string, entry: BackgroundWrite): Promise<boolean> {
  const writes = backgroundWrites.get(state)!;
  const write = entry.write;
  const pending = (async () => {
    try {
      await write();
      if (entry.write === write) writes.delete(key);
      return true;
    } catch (error) {
      if (isChatUpgrading(error) || error instanceof ServerRequestError && ["UPGRADE_ACTIVE", "PHASE_LOCKED"].includes(error.code ?? "")) {
        entry.deferred = true;
        return false;
      }
      if (entry.write === write) writes.delete(key);
      throw error;
    } finally { entry.running = undefined; }
  })();
  entry.running = pending;
  return pending;
}

/** Background metadata only. User actions and leased job callbacks retain their own lock contracts. */
export async function runBackgroundChatWrite(state: RuntimeState, chatId: string | undefined, operation: string, write: () => Promise<unknown>): Promise<boolean> {
  let writes = backgroundWrites.get(state);
  if (!writes) backgroundWrites.set(state, writes = new Map());
  const serverUrl = state.settings.serverUrl;
  const key = `${serverUrl}\0${chatId}\0${operation}`;
  let entry = writes.get(key);
  if (!entry) {
    const locked = (!chatId || state.statusScope?.chatId === chatId && state.statusScope.serverUrl === serverUrl) && Boolean(state.statusSummary?.upgrade?.lock);
    const deferred = locked || [...writes.values()].some(value => value.serverUrl === serverUrl && value.chatId === chatId && value.deferred);
    writes.set(key, entry = { serverUrl, chatId, write, deferred });
  } else entry.write = write; // The latest local value replaces a deferred value.
  if (entry.running) return entry.running;
  if (entry.deferred) return false;
  return executeBackgroundWrite(state, key, entry);
}

/** The existing activity poll retries once per unlocked chat, including chats no longer selected. */
export async function flushBackgroundChatWrites(state: RuntimeState, client: Pick<ServerClient, "request">): Promise<void> {
  const writes = backgroundWrites.get(state);
  if (!writes?.size) return;
  for (const [key, entry] of writes) if (entry.serverUrl !== state.settings.serverUrl) writes.delete(key);
  const serverUrl = state.settings.serverUrl;
  for (const chatId of new Set([...writes.values()].filter(entry => !entry.running).map(entry => entry.chatId))) {
    // Global quiz OFF checks every chat atomically on the server; retry it once per poll.
    const status = chatId ? await client.request<{ lock?: unknown }>(`/v1/chats/${encodeURIComponent(chatId)}/upgrade`) : { lock: null };
    if (state.unloaded || state.settings.serverUrl !== serverUrl) return;
    if (status.lock) continue;
    for (const [key, entry] of [...writes]) {
      if (entry.chatId !== chatId || entry.running) continue;
      entry.deferred = false;
      try { if (!await executeBackgroundWrite(state, key, entry)) break; }
      catch (error) {
        if (!(error instanceof ServerRequestError && error.status === 404)) addLog(state.logs, "warn", `Background chat synchronization failed: ${safeErrorText(String(error), [state.settings.serverToken])}`);
      }
    }
  }
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

/** Preserve the archive, revoke work leases, then remove queued/failed jobs. */
export async function stopDeletedHostChatWork(state: RuntimeState, client: Pick<ServerClient, "request">, chatId: string): Promise<void> {
  await client.request(`/v1/chats/${encodeURIComponent(chatId)}/work`, { method: "PUT", body: JSON.stringify({ enabled: false }) });
  state.settings.chatEnabled[chatId] = false;
  await saveSettings(state.settings);
  await client.request(`/v1/chats/${encodeURIComponent(chatId)}/jobs`, { method: "DELETE" });
}

