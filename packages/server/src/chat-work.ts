import type { RcmDatabase } from "./db.js";
import { releaseJob } from "./jobs.js";

import { CHAT_WORK_HELD_MESSAGE as CHAT_WORK_HELD } from "@rcm/shared";
export { CHAT_WORK_HELD_MESSAGE as CHAT_WORK_HELD } from "@rcm/shared";
const active = new WeakMap<RcmDatabase, Map<string, Set<AbortController>>>();

export function hasActiveChatWork(db: RcmDatabase, chatId: string): boolean {
  return Boolean(active.get(db)?.get(chatId)?.size);
}

export function isChatWorkHeld(db: RcmDatabase, chatId: string): boolean {
  return (db.prepare("SELECT enabled FROM chat_work_state WHERE chat_id=?").get(chatId) as { enabled: number } | undefined)?.enabled === 0;
}

/** One scope owns a request and its post-await writes, even across a quick OFF → ON. */
export function beginChatWork(db: RcmDatabase, chatId: string) {
  const controller = new AbortController();
  let chats = active.get(db);
  if (!chats) active.set(db, chats = new Map());
  let requests = chats.get(chatId);
  if (!requests) chats.set(chatId, requests = new Set());
  requests.add(controller);
  if (isChatWorkHeld(db, chatId)) controller.abort(new Error(CHAT_WORK_HELD));
  return { controller, finish: () => {
    requests!.delete(controller);
    if (!requests!.size) chats!.delete(chatId);
  } };
}

export function setChatWorkEnabled(db: RcmDatabase, chatId: string, enabled: boolean): void {
  db.transaction(() => {
    db.prepare("INSERT INTO chat_work_state(chat_id,enabled) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET enabled=excluded.enabled").run(chatId, Number(enabled));
    if (!enabled) {
      const leased = db.prepare("SELECT id,lease_owner FROM jobs WHERE chat_id=? AND status='leased'").all(chatId) as Array<{ id: string; lease_owner: string }>;
      // Keep queued payloads/checkpoints, including transient setup input, and revoke old writers.
      for (const job of leased) releaseJob(db, job.id, job.lease_owner);
    }
  })();
  if (!enabled) for (const controller of active.get(db)?.get(chatId) ?? []) controller.abort(new Error(CHAT_WORK_HELD));
}
