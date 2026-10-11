import type { RcmDatabase } from "./db.js";

export const memoryBookmarksKey = (chatId: string): string => `memory_bookmarks:${chatId}`;

export function readMemoryBookmarks(db: RcmDatabase, chatId: string): Set<string> {
  const row = db.prepare("SELECT value FROM server_meta WHERE key=?").get(memoryBookmarksKey(chatId)) as { value?: string } | undefined;
  if (!row?.value) return new Set();
  try {
    const values = JSON.parse(row.value);
    return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string" && value.length > 0) : []);
  } catch {
    return new Set();
  }
}

export function setMemoryBookmark(db: RcmDatabase, chatId: string, memoryId: string, bookmarked: boolean): void {
  const bookmarks = readMemoryBookmarks(db, chatId);
  if (bookmarked) bookmarks.add(memoryId);
  else bookmarks.delete(memoryId);
  const key = memoryBookmarksKey(chatId);
  if (bookmarks.size === 0) db.prepare("DELETE FROM server_meta WHERE key=?").run(key);
  else db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, JSON.stringify([...bookmarks].sort()));
}
