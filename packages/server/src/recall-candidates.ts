import type { LeasedJob, MemoryContextItem } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { atomFingerprint, type RecallAtomReference } from "./atom-relations.js";

export interface RecallCandidateSnapshot {
  recallCandidates: NonNullable<LeasedJob["recallCandidates"]>;
  recallAtomRefs: RecallAtomReference[];
}

/** Bounded extraction lookup, sharing the existing retrieval call. The reduced
 * gist budget pays for explicit atom snippets instead of appending another
 * unbounded archive prompt. Internal endpoint IDs never enter model prose.
 */
export function buildRecallCandidateSnapshot(db: RcmDatabase, chatId: string, selected: MemoryContextItem[]): RecallCandidateSnapshot {
  const memories = selected.filter(memory => memory.knownBy.length || memory.details.some(detail => detail.knownBy.length)
    || memory.keyDialogues.some(dialogue => dialogue.knownBy.length)).slice(0, 16);
  const ids = memories.flatMap(memory => memory.details.slice(0, 3).map(detail => detail.id)).slice(0, 32);
  const rows = ids.length ? db.prepare(`SELECT id,memory_id,kind,text,epistemic,evidence_json FROM memory_details
    WHERE chat_id=? AND active=1 AND id IN (SELECT value FROM json_each(?))`).all(chatId, JSON.stringify(ids)) as Array<{
      id: string; memory_id: string; kind: string; text: string; epistemic: string; evidence_json: string;
    }> : [];
  const byId = new Map(rows.map(row => [row.id, row]));
  const recallAtomRefs: RecallAtomReference[] = [];
  const recallCandidates = memories.map(memory => ({
    memoryId: memory.id, title: memory.title.slice(0, 160),
    gist: [memory.content, ...memory.details.map(detail => detail.text), ...memory.keyDialogues.map(dialogue => `${dialogue.speaker}: ${dialogue.text}`)]
      .filter(Boolean).join(" | ").slice(0, 650),
    accessibleTo: [...new Set([...memory.knownBy, ...memory.details.flatMap(detail => detail.knownBy), ...memory.keyDialogues.flatMap(dialogue => dialogue.knownBy)])],
    atoms: memory.details.slice(0, 3).flatMap(detail => {
      const row = byId.get(detail.id);
      if (!row || row.memory_id !== memory.id || recallAtomRefs.length >= 32) return [];
      const atomRef = `a${recallAtomRefs.length + 1}`;
      recallAtomRefs.push({ atomRef, detailId: detail.id, fingerprint: atomFingerprint(row) });
      return [{ atomRef, text: detail.text.slice(0, 320), accessibleTo: detail.knownBy }];
    }),
  }));
  return { recallCandidates, recallAtomRefs };
}
