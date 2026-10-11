import { itemAccessKnowledge } from "./item-access.js";
import { createHash } from "node:crypto";
import { estimateTokens } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { loadItemAccess, resolveItemAccess, visibleTo } from "./item-access.js";
import { renderSourceEvidence, sourceEvidenceAtomKey, type SourceEvidenceItem } from "./source-evidence.js";

type StoredEvidence = { messageId?: unknown; quote?: unknown };

/** Returns only canonical spans explicitly cited by a target detail. It never
 * searches surrounding source text, so an already-supplied scene cannot turn
 * into a broad transcript recovery path. */
export function targetDetailSourceEvidence(db: RcmDatabase, chatId: string, detailIds: string[], perspectives: string[], tokenBudget: number,
  excludedAtoms: string[] = [], promptSourceMessageIds: string[] = [], accept: (quote: string) => boolean = () => true): { items: SourceEvidenceItem[]; xml: string; atomKeys: string[] } {
  const ids = [...new Set(detailIds)].slice(0, 12);
  if (!ids.length || tokenBudget < 80) return { items: [], xml: "", atomKeys: [] };
  const access = loadItemAccess(db, chatId, ids.map((id) => ({ kind: "detail" as const, id })));
  const viewers = perspectives.length ? perspectives : ["narrator"];
  const isArchive = (viewer: string) => ["narrator", "omniscient", "omniscient narrator"].includes(viewer.normalize("NFKC").trim().toLocaleLowerCase());
  const detailRows = db.prepare(`SELECT d.id,d.memory_id,d.evidence_json,d.epistemic FROM memory_details d JOIN memories m ON m.id=d.memory_id AND m.chat_id=d.chat_id
    WHERE d.chat_id=? AND d.id IN (${ids.map(() => "?").join(",")}) AND d.active=1 AND m.active=1`)
    .all(chatId, ...ids) as Array<{ id: string; memory_id: string; evidence_json: string; epistemic: string }>;
  const message = db.prepare(`SELECT ordinal,canonical_content FROM messages WHERE chat_id=? AND message_id=?
    AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`);
  const result: SourceEvidenceItem[] = [];
  const excluded = new Set(excludedAtoms);
  const promptSources = new Set(promptSourceMessageIds);
  const ceiling = Math.min(900, Math.floor(tokenBudget * .3));
  for (const detail of detailRows) {
    const scope = resolveItemAccess(access, "detail", detail.id);
    if (!viewers.some((viewer) => visibleTo(scope, viewer, isArchive(viewer)))) continue;
    let evidence: StoredEvidence[] = [];
    try { evidence = JSON.parse(detail.evidence_json); } catch { continue; }
    if (!Array.isArray(evidence)) continue;
    const bundle: SourceEvidenceItem[] = [];
    let invalidQuotedEvidence = false;
    for (const entry of evidence) {
      if (typeof entry?.messageId !== "string" || typeof entry.quote !== "string" || !entry.quote.trim()) continue;
      if (promptSources.has(entry.messageId)) continue;
      const row = message.get(chatId, entry.messageId) as { ordinal: number; canonical_content: string | null } | undefined;
      const quote = entry.quote.trim();
      const content = row?.canonical_content;
      if (!row || typeof content !== "string") { invalidQuotedEvidence = true; break; }
      const first = content.indexOf(quote);
      if (first < 0 || content.indexOf(quote, first + 1) >= 0) { invalidQuotedEvidence = true; break; }
      const id = createHash("sha256").update(`${chatId}\0${detail.id}\0${entry.messageId}\0${quote}`).digest("hex");
      const item: SourceEvidenceItem = { bundleKey: detail.id, memoryId: detail.memory_id, id, messageId: entry.messageId, quote, speaker: null, epistemic: detail.epistemic, ordinal: row.ordinal,
        holders: scope.narratorOnly ? ["narrator"] : scope.everyone ? ["everyone"] : itemAccessKnowledge(scope), score: 1 };
      if (excluded.has(sourceEvidenceAtomKey(item)) || result.some((old) => old.quote === item.quote)
        || bundle.some((old) => old.quote === item.quote)) continue;
      bundle.push(item);
    }
    // Evidence already in the prompt or excluded atom set is satisfied. Every
    // remaining fresh quote for this detail is emitted together or not at all.
    if (!invalidQuotedEvidence && bundle.some(item => accept(item.quote))
      && estimateTokens(renderSourceEvidence([...result, ...bundle])) <= ceiling) result.push(...bundle);
  }
  return { items: result, xml: renderSourceEvidence(result), atomKeys: result.map(sourceEvidenceAtomKey) };
}
