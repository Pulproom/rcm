import type { RcmDatabase } from "./db.js";

/** Prevent downstream projections from observing a partially reconciled backfill run. */
export function hasActiveBackfillBarrier(db: RcmDatabase, chatId: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM jobs WHERE chat_id=?
    AND type IN ('extract','episode','ledger_consistency')
    AND status IN ('queued','leased')
    AND json_extract(payload_json,'$.backfillRunId') IS NOT NULL LIMIT 1`).get(chatId));
}
