import type { RcmDatabase } from "./db.js";
import type { EmbeddingService } from "./embedding.js";
import { deleteChats } from "./admin.js";
import { hasActiveChatWork } from "./chat-work.js";

const DAY = 86_400_000;
const CLEANUP_KEY = "unengaged_chat_cleanup";

export function markChatEngaged(db: RcmDatabase, chatId: string): void {
  const at = Date.now();
  if (!db.prepare("UPDATE chats SET engaged_at=COALESCE(engaged_at,?) WHERE id=?").run(at, chatId).changes) {
    // Dashboard settings can arrive before the first source sync creates the row.
    db.prepare("INSERT OR IGNORE INTO server_meta(key,value) VALUES(?,?)").run(`chat_engaged_pending:${chatId}`, String(at));
  }
}

/** Keep each plugin's last explicitly reported open chat until its next report. */
export function recordOpenChat(db: RcmDatabase, workerId: string, chatId?: string): void {
  const key = `chat_open:${workerId}`;
  if (chatId) {
    db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, chatId);
    db.prepare("UPDATE chats SET last_seen_at=? WHERE id=?").run(Date.now(), chatId);
  } else db.prepare("DELETE FROM server_meta WHERE key=?").run(key);
}

export function recentChatCleanup(db: RcmDatabase): { at: number; count: number } {
  const row = db.prepare("SELECT value FROM server_meta WHERE key=?").get(CLEANUP_KEY) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : { at: 0, count: 0 };
}

/** Candidate IDs grant no deletion authority; every guard is read under the write transaction. */
export function deleteUnengagedChats(db: RcmDatabase, embeddings: EmbeddingService, candidates: string[], before?: number): number {
  return db.transaction(() => {
    const eligible = db.prepare(`SELECT c.id FROM chats c WHERE c.id=? AND c.is_internal=0 AND c.engaged_at IS NULL
      AND (? IS NULL OR c.last_seen_at<?)
      AND NOT EXISTS(SELECT 1 FROM memories WHERE chat_id=c.id)
      AND NOT EXISTS(SELECT 1 FROM jobs WHERE chat_id=c.id)
      AND NOT EXISTS(SELECT 1 FROM messages WHERE chat_id=c.id AND source_kind='archive')
      AND NOT EXISTS(SELECT 1 FROM server_meta WHERE key GLOB 'chat_open:*' AND value=c.id)
      AND NOT EXISTS(SELECT 1 FROM chat_lineage WHERE child_chat_id=c.id OR parent_chat_id=c.id)`);
    let count = 0;
    for (const id of new Set(candidates)) {
      // Protect all lineage endpoints, including unresolved and multi-generation families.
      if (!eligible.get(id, before ?? null, before ?? null) || hasActiveChatWork(db, id)) continue;
      count += deleteChats(db, embeddings, [id]);
    }
    return count;
  }).immediate();
}

export function cleanupUnengagedChats(db: RcmDatabase, embeddings: EmbeddingService, timestamp = Date.now()): number {
  return db.transaction(() => {
    if (timestamp - recentChatCleanup(db).at < DAY) return 0;
    const before = timestamp - 30 * DAY;
    const ids = (db.prepare("SELECT id FROM chats WHERE engaged_at IS NULL AND last_seen_at<? AND is_internal=0").all(before) as { id: string }[]).map(row => row.id);
    const count = deleteUnengagedChats(db, embeddings, ids, before);
    db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(CLEANUP_KEY, JSON.stringify({ at: timestamp, count }));
    console.info(`[RCM] Unengaged chat cleanup deleted=${count}`);
    return count;
  }).immediate();
}
