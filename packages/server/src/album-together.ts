import { orderStoryMemories, summarizeTogether, type AlbumTogetherRecords, type MessageLifecycle, type TogetherMessage } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { completedTurnEligibleMessage } from "./lifecycle.js";
import { recognitionOnlyMemorySql } from "./memory-group-search.js";

interface StoryDate { id: string; story_time: string | null; story_time_normalized: string | null; created_revision: number }
/** The chat picker, materials and record-only refresh share the same story-period endpoints. */
export function albumStoryPeriod(rows: StoryDate[]): { from?: string; to?: string } {
  const dated = orderStoryMemories(rows).filter(row => row.story_time_normalized || row.story_time);
  return dated.length ? { from: dated[0]!.story_time_normalized ?? dated[0]!.story_time!, to: dated.at(-1)!.story_time_normalized ?? dated.at(-1)!.story_time! } : {};
}

export function collectAlbumTogether(db: RcmDatabase, chatId: string, options: {
  timeZone: string; now?: number; storyPeriod?: { from?: string; to?: string };
}): AlbumTogetherRecords {
  return db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM chats WHERE id=?").get(chatId)) throw Object.assign(new Error("Album source chat not found"), { code: "ALBUM_SOURCE_NOT_FOUND" });
    const rows = db.prepare(`SELECT ordinal,role,event_time,completed_turn_seq,
      length(COALESCE(NULLIF(canonical_content,''),content)) AS chars,lifecycle,host_visibility
      FROM messages WHERE chat_id=? AND role IN ('user','assistant') ORDER BY ordinal`).all(chatId) as Array<{
        ordinal: number; role: TogetherMessage["role"]; event_time: number | null; completed_turn_seq: number | null;
        chars: number | null; lifecycle: MessageLifecycle; host_visibility: string;
      }>;
    const messages: TogetherMessage[] = rows.filter(completedTurnEligibleMessage).map(row => ({ ordinal: row.ordinal, role: row.role,
      time: row.event_time ?? undefined, turn: row.completed_turn_seq ?? undefined, chars: row.chars ?? 0 }));
    const quiz = db.prepare("SELECT answered,correct,best_streak AS bestStreak FROM quiz_state WHERE chat_id=?").get(chatId) as AlbumTogetherRecords["quiz"];
    // A record-only request needs dates, never scene bodies, dialogues or the full material payload.
    const storyPeriod = options.storyPeriod ?? albumStoryPeriod(db.prepare(`SELECT m.id,m.story_time,m.story_time_normalized,m.created_revision
      FROM memories m WHERE m.chat_id=? AND m.active=1 AND m.type='episode' AND m.capsule_parent_id IS NULL
      AND NOT ${recognitionOnlyMemorySql("m")}`).all(chatId) as StoryDate[]);
    return summarizeTogether({ messages, quiz, storyPeriod, timeZone: options.timeZone, now: options.now ?? Date.now() });
  })();
}
