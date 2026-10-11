import type { RcmDatabase } from "./db.js";

export interface SourceFingerprintItem {
  messageId: string;
  ordinal: number;
  contentHash: string;
  sourceKind: string;
}

export function isSourceFingerprint(value: unknown): value is SourceFingerprintItem[] {
  return Array.isArray(value) && value.every((item) => Boolean(item) && typeof item === "object"
    && typeof (item as SourceFingerprintItem).messageId === "string"
    && Number.isInteger((item as SourceFingerprintItem).ordinal)
    && typeof (item as SourceFingerprintItem).contentHash === "string"
    && typeof (item as SourceFingerprintItem).sourceKind === "string");
}

export function parseSourceFingerprintJson(value: string): SourceFingerprintItem[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isSourceFingerprint(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function sourceFingerprint(db: RcmDatabase, chatId: string, sourceIds: string[]): SourceFingerprintItem[] {
  if (!sourceIds.length) return [];
  const rows = db.prepare(`SELECT message_id,ordinal,CASE WHEN canonical_hash<>'' THEN canonical_hash ELSE content_hash END AS content_hash,source_kind FROM messages WHERE chat_id=? AND message_id IN (${sourceIds.map(() => "?").join(",")})`)
    .all(chatId, ...sourceIds) as Array<{ message_id: string; ordinal: number; content_hash: string; source_kind: string }>;
  const byId = new Map(rows.map((row) => [row.message_id, row]));
  return sourceIds.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row)).map((row) => ({
    messageId: row.message_id,
    ordinal: row.ordinal,
    contentHash: row.content_hash,
    sourceKind: row.source_kind,
  }));
}

export function fingerprintMatches(db: RcmDatabase, chatId: string, expected: SourceFingerprintItem[]): boolean {
  if (!isSourceFingerprint(expected)) return false;
  if (!expected.length) return true;
  const usable = (db.prepare(`SELECT count(*) AS count FROM messages
    WHERE chat_id=? AND message_id IN (${expected.map(() => "?").join(",")}) AND host_visibility IN ('active','all_before') AND content IS NOT NULL`)
    .get(chatId, ...expected.map((item) => item.messageId)) as { count: number }).count;
  if (usable !== expected.length) return false;
  const current = sourceFingerprint(db, chatId, expected.map((item) => item.messageId));
  return JSON.stringify(current) === JSON.stringify(expected);
}
