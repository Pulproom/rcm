import type { RcmDatabase } from "./db.js";
import { extractionBufferStats } from "./jobs.js";

export interface IngestionSummary {
  ingestionState: "historical_pending" | "managed" | "cleared";
  bufferedMessages: number;
  waitingForAssistant: number;
  recoverableMessages: number;
  historicalBackfillMessages: number;
  bufferedTurns: number;
  protectedTurns: number;
  bufferedSourceTokens: number;
  extractionGroupTurns: number;
}

/** Packet freshness needs existence, not dashboard counts or tokenization. */
export function hasBufferedSource(db: RcmDatabase, chatId: string, ingestionState: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM messages m
    WHERE m.chat_id=? AND m.lifecycle='committed' AND m.host_visibility IN ('active','all_before') AND m.extraction_state='pending'
      AND ((?='managed' AND m.content IS NOT NULL) OR (m.role='user' AND NOT EXISTS (
        SELECT 1 FROM messages a WHERE a.chat_id=m.chat_id AND a.role='assistant' AND a.lifecycle='committed'
          AND a.host_visibility IN ('active','all_before') AND a.ordinal>m.ordinal)))
    LIMIT 1`).get(chatId, ingestionState));
}

export function ingestionSummary(db: RcmDatabase, chatId: string): IngestionSummary {
  const chat = db.prepare("SELECT ingestion_state FROM chats WHERE id=?").get(chatId) as { ingestion_state: IngestionSummary["ingestionState"] } | undefined;
  const row = db.prepare(`SELECT
    SUM(CASE WHEN lifecycle='committed' AND host_visibility IN ('active','all_before') AND content IS NOT NULL AND extraction_state='pending' THEN 1 ELSE 0 END) AS pending,
    SUM(CASE WHEN lifecycle='committed' AND host_visibility IN ('active','all_before') AND content IS NOT NULL AND extraction_state='cancelled' THEN 1 ELSE 0 END) AS recoverable
    FROM messages WHERE chat_id=?`).get(chatId) as { pending: number | null; recoverable: number | null };
  const waiting = (db.prepare("SELECT count(*) AS count FROM messages m WHERE m.chat_id=? AND m.role='user' AND m.lifecycle='committed' AND m.host_visibility IN ('active','all_before') AND m.extraction_state='pending' AND NOT EXISTS (SELECT 1 FROM messages a WHERE a.chat_id=m.chat_id AND a.role='assistant' AND a.lifecycle='committed' AND a.host_visibility IN ('active','all_before') AND a.ordinal>m.ordinal)").get(chatId) as { count: number }).count;
  const state = chat?.ingestion_state ?? "managed";
  const pending = Number(row.pending ?? 0);
  const buffer = extractionBufferStats(db, chatId);
  return {
    ingestionState: state,
    bufferedMessages: state === "managed" ? Math.max(0, pending - waiting) : 0,
    waitingForAssistant: waiting,
    recoverableMessages: Number(row.recoverable ?? 0),
    historicalBackfillMessages: state === "historical_pending" ? pending : 0,
    ...buffer,
  };
}
