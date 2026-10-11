import type { RcmDatabase } from "./db.js";

export const TRANSLATION_CACHE_MAX_ITEMS = 50_000;
export const TRANSLATION_CACHE_MAX_BYTES = 128 * 1024 * 1024;

export interface TranslationCacheRecord {
  key: string;
  serverInstanceId: string;
  chatId: string;
  kind: string;
  itemId: string;
  sourceHash: string;
  provider: string;
  sourceLanguage: string;
  targetLanguage: string;
  translated: string;
}

export function translationCacheKey(record: Pick<TranslationCacheRecord,
  "serverInstanceId" | "chatId" | "kind" | "itemId" | "sourceHash" | "provider" | "sourceLanguage" | "targetLanguage">): string {
  return [record.serverInstanceId, record.chatId, record.kind, record.itemId, record.sourceHash,
    record.provider, record.sourceLanguage, record.targetLanguage].join("\u001f");
}

export function translationCacheStats(db: RcmDatabase): { items: number; bytes: number; maxItems: number; maxBytes: number } {
  const row = db.prepare("SELECT COUNT(*) AS items,COALESCE(SUM(length(CAST(translated AS BLOB))),0) AS bytes FROM translation_cache").get() as { items: number; bytes: number };
  return { items: row.items, bytes: row.bytes, maxItems: TRANSLATION_CACHE_MAX_ITEMS, maxBytes: TRANSLATION_CACHE_MAX_BYTES };
}

export function pruneTranslationCache(db: RcmDatabase): void {
  const stats = translationCacheStats(db);
  if (stats.items <= TRANSLATION_CACHE_MAX_ITEMS && stats.bytes <= TRANSLATION_CACHE_MAX_BYTES) return;
  const rows = db.prepare("SELECT cache_key,length(CAST(translated AS BLOB)) AS bytes FROM translation_cache ORDER BY used_at ASC,created_at ASC").all() as Array<{ cache_key: string; bytes: number }>;
  let items = stats.items;
  let bytes = stats.bytes;
  const remove = db.prepare("DELETE FROM translation_cache WHERE cache_key=?");
  for (const row of rows) {
    if (items <= TRANSLATION_CACHE_MAX_ITEMS && bytes <= TRANSLATION_CACHE_MAX_BYTES) break;
    remove.run(row.cache_key);
    items -= 1;
    bytes -= row.bytes;
  }
}

export function lookupTranslations(db: RcmDatabase, keys: string[]): Array<{ key: string; translated: string }> {
  const unique = [...new Set(keys)].slice(0, 500);
  if (!unique.length) return [];
  const placeholders = unique.map(() => "?").join(",");
  const rows = db.prepare(`SELECT cache_key AS key,translated FROM translation_cache WHERE cache_key IN (${placeholders})`).all(...unique) as Array<{ key: string; translated: string }>;
  const touch = db.prepare("UPDATE translation_cache SET used_at=? WHERE cache_key=?");
  const at = Date.now();
  db.transaction(() => { for (const row of rows) touch.run(at, row.key); })();
  return rows;
}

export function upsertTranslations(db: RcmDatabase, records: TranslationCacheRecord[]): void {
  const insert = db.prepare(`INSERT INTO translation_cache(cache_key,server_instance_id,chat_id,item_kind,item_id,source_hash,provider,source_language,target_language,translated,used_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET translated=excluded.translated,used_at=excluded.used_at`);
  const at = Date.now();
  db.transaction(() => {
    for (const record of records.slice(0, 500)) insert.run(record.key, record.serverInstanceId, record.chatId, record.kind, record.itemId, record.sourceHash,
      record.provider, record.sourceLanguage, record.targetLanguage, record.translated, at, at);
    pruneTranslationCache(db);
  })();
}

export function invalidateTranslations(db: RcmDatabase, match: { serverInstanceId?: string; chatId?: string; kind?: string; itemId?: string; itemIdPrefix?: string }): number {
  const clauses: string[] = [];
  const values: string[] = [];
  for (const [field, column] of [["serverInstanceId", "server_instance_id"], ["chatId", "chat_id"], ["kind", "item_kind"], ["itemId", "item_id"]] as const) {
    const value = match[field];
    if (value !== undefined) { clauses.push(`${column}=?`); values.push(value); }
  }
  if (match.itemIdPrefix !== undefined) { clauses.push("item_id LIKE ? ESCAPE '\\'"); values.push(`${match.itemIdPrefix.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`); }
  if (!clauses.length) return 0;
  return db.prepare(`DELETE FROM translation_cache WHERE ${clauses.join(" AND ")}`).run(...values).changes;
}
