import type { RcmDatabase } from "./db.js";

export const isEndedPromiseStatus = (status: unknown): boolean => ["kept", "broken", "released", "offscreen"].includes(String(status));

/** Completion is recorded against the chat clock, never the delayed evidence clock.
 * Replaying the same status must not renew a completed promise's window. */
export function recordPromiseRecency(db: RcmDatabase, chatId: string, id: string, previousStatus: unknown,
  status: string, timing: "automatic" | "already_past" | "recent"): void {
  if (status === previousStatus) return;
  const recent = isEndedPromiseStatus(status) && timing !== "already_past" && (timing === "recent" || previousStatus === "open");
  const clock = db.prepare("SELECT completed_turn_count,extraction_group_turns FROM chats WHERE id=?").get(chatId) as {
    completed_turn_count: number; extraction_group_turns: number;
  };
  const anchor = recent ? clock.completed_turn_count : null;
  const until = anchor === null ? null : anchor + clock.extraction_group_turns * (status === "broken" ? 2 : 1);
  db.prepare("UPDATE promises SET ended_at_turn=?,recency_until_turn=? WHERE chat_id=? AND id=?").run(anchor, until, chatId, id);
}

/** Every effective transition carries its window so source rollback restores it too. */
export function snapshotPromiseRecency(db: RcmDatabase, eventId: string, promiseId: string): void {
  db.prepare(`UPDATE promise_events SET
    ended_at_turn=(SELECT ended_at_turn FROM promises WHERE id=?),
    recency_until_turn=(SELECT recency_until_turn FROM promises WHERE id=?) WHERE id=?`).run(promiseId, promiseId, eventId);
}
