import type { RuntimeState } from "./types.js";
import type { ServerClient } from "./api-client.js";
import { saveSettings } from "./settings.js";

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
  state.settings.chatEnabled[chatId] = false;
  await saveSettings(state.settings);
  await client.request(`/v1/chats/${encodeURIComponent(chatId)}/work`, { method: "PUT", body: JSON.stringify({ enabled: false }) });
  await client.request(`/v1/chats/${encodeURIComponent(chatId)}/jobs`, { method: "DELETE" });
}

