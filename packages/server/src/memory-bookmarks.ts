import type { RcmDatabase } from "./db.js";
import { assertChatUnlocked } from './upgrade-lock.js';

export const memoryBookmarksKey = (chatId: string): string => `memory_bookmarks:${chatId}`;
export const memoryPreferencesKey = (chatId:string):string => `memory_preferences:${chatId}`;
// Column ownership preserves display choices on the same row without owning its prose.
export const MEMORY_PREFERENCE_COLUMNS = ['title','story_time','story_time_normalized','locations_json','participants_json',
  'salience','strength','landmark','landmark_kinds_json'] as const;
type PreferenceColumn = typeof MEMORY_PREFERENCE_COLUMNS[number];

export function readMemoryPreferenceFields(db:RcmDatabase,chatId:string): Map<string,PreferenceColumn[]> {
  const row=db.prepare('SELECT value FROM server_meta WHERE key=?').get(memoryPreferencesKey(chatId)) as {value:string}|undefined;
  return new Map(Object.entries(row ? JSON.parse(row.value) : {}).map(([id,fields])=>[id,
    MEMORY_PREFERENCE_COLUMNS.filter(column=>Array.isArray(fields) && fields.includes(column))]));
}

export function writeMemoryPreferenceFields(db:RcmDatabase,chatId:string,fields:ReadonlyMap<string,readonly PreferenceColumn[]>):void {
  if (!fields.size) db.prepare('DELETE FROM server_meta WHERE key=?').run(memoryPreferencesKey(chatId));
  else db.prepare('INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(memoryPreferencesKey(chatId),JSON.stringify(Object.fromEntries(fields)));
}

export function rememberMemoryPreferenceFields(db:RcmDatabase,chatId:string,memoryId:string,columns:string[]):void {
  const fields=readMemoryPreferenceFields(db,chatId);
  const changed=MEMORY_PREFERENCE_COLUMNS.filter(column=>columns.includes(column));
  if (!changed.length) return;
  fields.set(memoryId,[...new Set([...(fields.get(memoryId) ?? []),...changed])]);
  writeMemoryPreferenceFields(db,chatId,fields);
}

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
  assertChatUnlocked(db,chatId);
  const bookmarks = readMemoryBookmarks(db, chatId);
  if (bookmarked) bookmarks.add(memoryId);
  else bookmarks.delete(memoryId);
  const key = memoryBookmarksKey(chatId);
  if (bookmarks.size === 0) db.prepare("DELETE FROM server_meta WHERE key=?").run(key);
  else db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, JSON.stringify([...bookmarks].sort()));
}
