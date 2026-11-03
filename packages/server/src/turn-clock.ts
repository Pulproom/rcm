import type { RcmDatabase } from "./db.js";

export function editProtectedMessageIds(db: RcmDatabase, chatId: string, editProtectionTurns: number): Set<string> {
  const rows = db.prepare(`SELECT message_id,completed_turn_seq FROM messages
    WHERE chat_id=? AND completed_turn_seq IS NOT NULL AND lifecycle='committed' AND host_visibility IN ('active','all_before')
    ORDER BY ordinal DESC,message_id DESC`).all(chatId) as Array<{ message_id: string; completed_turn_seq: number }>;
  const turnLimit = Math.min(5, Math.max(1, editProtectionTurns));
  const protectedIds = new Set<string>();
  let turnOccurrences = 0;
  let previousSequence: number | undefined;
  for (const row of rows) {
    // A repaired or restored ledger can contain a later occurrence of an old
    // sequence number. Ordinal-adjacent runs, rather than the number itself,
    // identify the current transcript's turn occurrence.
    if (row.completed_turn_seq !== previousSequence) {
      if (turnOccurrences === turnLimit) break;
      turnOccurrences += 1;
      previousSequence = row.completed_turn_seq;
    }
    protectedIds.add(row.message_id);
  }
  return protectedIds;
}

