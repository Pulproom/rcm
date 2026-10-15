import { createHash } from "node:crypto";
import { estimateTokens, memoryEvidenceKind, normalizeSearchTokens, validSourcePassageAccess, type SourcePassage } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import type { SemanticSourceHit } from "./embedding.js";
import { sourceFingerprint } from "./source-fingerprint.js";
import { memoryAtomKey } from "./memory-atoms.js";
import { deletionGuard } from "./user-deletions.js";
import { buildEntityIdentityResolver, normalizeEntityName } from "./entities.js";

const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const SOURCE_RECOVERY_SEMANTIC_THRESHOLD = 0.72;

export function presentationOnlySourcePassage(value: string): boolean {
  const lines = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return true;
  return lines.every((line) => /^(?:#{1,6}\s+|[-=_]{3,}$|<img\b|!\[[^\]]*\]\([^)]*\)$|\[🌐\|.*\]$|\[(?:approved|approval|status|chapter)(?:\s|:|\]).*|<(?:details|summary|style|script)\b)/iu.test(line));
}

function exactRecoveryPhrases(query: string): string[] {
  const compact = normalized(query).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
  const words = compact.split(" ").filter(Boolean);
  const phrases = new Set<string>();
  for (let size = 6; size >= 4; size -= 1) {
    for (let index = 0; index + size <= words.length && phrases.size < 64; index += 1) {
      const phrase = words.slice(index, index + size).join(" ");
      if (phrase.length >= 16) phrases.add(phrase);
    }
  }
  for (const part of normalized(query).split(/[^\p{L}\p{N}]+/gu)) {
    if (part.length >= 8 && /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(part)) phrases.add(part);
  }
  return [...phrases];
}

/** Revoke only grants depending on changed source, including cross-message support. */
export function invalidateSourcePassageAccess(db: RcmDatabase, chatId: string, messageId: string): void {
  const rows = db.prepare(`SELECT id,message_id,access_json FROM source_passages WHERE chat_id=? AND active=1
    AND EXISTS(SELECT 1 FROM json_each(access_json) g, json_each(json_extract(g.value,'$.evidence')) e
      WHERE json_extract(e.value,'$.messageId')=?)`).all(chatId, messageId) as Array<{ id: string; message_id: string; access_json: string }>;
  for (const row of rows) {
    const grants = (JSON.parse(row.access_json) as SourcePassage["access"]).filter((grant) => !grant.evidence.some((item) => item.messageId === messageId));
    db.prepare("UPDATE source_passages SET access_json=? WHERE id=?").run(JSON.stringify(grants), row.id);
    // Context groups are rebuilt from the remaining grants on the next indexing pass.
    db.prepare(`UPDATE embedding_items SET content_hash='' WHERE chat_id=? AND kind='memory_detail' AND source_id IN
      (SELECT id FROM memory_details WHERE chat_id=? AND EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId')=?))`)
      .run(chatId, chatId, row.message_id);
  }
}

export function storeSourcePassages(db: RcmDatabase, chatId: string, passages: SourcePassage[] = [], batchId?: string, sourceMessageIds?: string[]): number {
  const deleted = deletionGuard(db, chatId);
  const resolve = buildEntityIdentityResolver(db, chatId);
  const source = db.prepare(`SELECT canonical_content,canonical_hash,role FROM messages WHERE chat_id=? AND message_id=?
    AND lifecycle IN ('committed','client_pruned') AND memory_excluded=0 AND host_visibility IN ('active','all_before')`);
  const includeUser = (db.prepare("SELECT include_user_messages value FROM chats WHERE id=?").get(chatId) as { value: number }).value !== 0;
  const batch = batchId ? db.prepare("SELECT source_message_ids_json FROM extraction_batches WHERE id=? AND chat_id=?").get(batchId, chatId) as { source_message_ids_json: string } | undefined : undefined;
  const allowedIds: string[] = sourceMessageIds ?? (batch ? JSON.parse(batch.source_message_ids_json) : passages.map((passage) => passage.messageId));
  const sources = new Map<string, string>();
  for (const id of allowedIds) {
    const row = source.get(chatId, id) as { canonical_content: string | null } | undefined;
    if (row?.canonical_content) sources.set(id, row.canonical_content);
  }
  const insert = db.prepare(`INSERT INTO source_passages(id,chat_id,message_id,canonical_hash,start_offset,end_offset,quote,speaker,epistemic,access_json,source_batch_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET access_json=excluded.access_json,epistemic=excluded.epistemic,speaker=excluded.speaker,active=1`);
  let added = 0;
  for (const passage of passages) {
    const row = source.get(chatId, passage.messageId) as { canonical_content: string | null; canonical_hash: string; role: string } | undefined;
    if (!row?.canonical_content || (!includeUser && row.role === "user") || presentationOnlySourcePassage(passage.quote)) continue;
    const start = passage.startOffset ?? row.canonical_content.indexOf(passage.quote);
    // Ambiguous quotes must be re-submitted with sufficient source context.
    if (start < 0 || row.canonical_content.slice(start, start + passage.quote.length) !== passage.quote
      || (passage.startOffset === undefined && row.canonical_content.indexOf(passage.quote, start + 1) >= 0)) continue;
    const grants = validSourcePassageAccess(passage, sources, passage.access).filter(grant => {
      const holder = resolve(grant.holder);
      return holder.ambiguous || !deleted("entity", holder.variants.map(normalizeEntityName), grant.evidence.length ? grant.evidence : [{ messageId: passage.messageId }]);
    });
    const id = createHash("sha256").update(`${chatId}\0${passage.messageId}\0${row.canonical_hash}\0${start}\0${passage.quote.length}`).digest("hex");
    const prior = db.prepare("SELECT active FROM source_passages WHERE id=?").get(id) as { active: number } | undefined;
    insert.run(id, chatId, passage.messageId, row.canonical_hash, start, start + passage.quote.length, passage.quote,
      passage.speaker ?? null, passage.epistemic, JSON.stringify(grants), batchId ?? null);
    if (!prior?.active) added++;
  }
  return added;
}

export interface SourceEvidenceItem {
  bundleKey?: string; memoryId?: string;
  id: string; messageId: string; canonicalHash?: string; quote: string; speaker: string | null; epistemic: string;
  startOffset?: number; endOffset?: number; ordinal: number; holders: string[]; score: number;
}
export function renderSourceEvidence(items: SourceEvidenceItem[]): string {
  if (!items.length) return "";
  return `<source_evidence>${items.map((item) => `<source_excerpt${item.holders.length ? ` known_by="${xml(item.holders.join(", "))}"` : ' narrator_only="true"'}${item.speaker ? ` speaker="${xml(item.speaker)}"` : ""} basis="${memoryEvidenceKind(item.epistemic)}">${xml(item.quote)}</source_excerpt>`).join("\n")}</source_evidence>`;
}
export const sourceEvidenceAtomKey = (item: { id: string; quote: string }) => memoryAtomKey("source", item.id, item.quote);

export interface SourceRecoveryCandidate {
  messageId: string;
  matchKinds: Array<"semantic" | "exact_phrase" | "invalid_access">;
  matchedPhrases: string[];
}

export interface DeliveredSourceEvidence {
  messageId: string; canonicalHash?: string; quote?: string; startOffset?: number; endOffset?: number;
}

/** Only exact provenance of atoms surviving final packet trimming counts as coverage. */
function recoveryCovered(candidate: SourceRecoveryCandidate, content: string, hash: string, evidence: DeliveredSourceEvidence[]): boolean {
  const excerpts = evidence.filter(item => item.messageId === candidate.messageId && (!item.canonicalHash || item.canonicalHash === hash))
    .flatMap(item => {
      const start = item.startOffset ?? (item.quote ? content.indexOf(item.quote) : -1);
      const end = item.endOffset ?? start + (item.quote?.length ?? 0);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > content.length) return [];
      if (item.quote !== undefined && content.slice(start, end) !== item.quote) return [];
      if (item.startOffset === undefined && item.quote && content.indexOf(item.quote, start + 1) >= 0) return [];
      return [normalized(content.slice(start, end)).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim()];
    });
  return excerpts.length > 0 && candidate.matchedPhrases.every(phrase => excerpts.some(excerpt => excerpt.includes(phrase)));
}

/** One bounded recovery attempt per unchanged processed source, using the existing audit queue. */
export function queueSourceRecovery(db: RcmDatabase, chatId: string, candidates: Array<string | SourceRecoveryCandidate>, query = "", deliveredEvidence: DeliveredSourceEvidence[] = []): number {
  for (const candidate of candidates) {
    const messageId = typeof candidate === "string" ? candidate : candidate.messageId;
    const row = db.prepare(`SELECT m.ordinal,m.canonical_hash,m.canonical_content,m.role,c.include_user_messages,c.memory_language FROM messages m JOIN chats c ON c.id=m.chat_id
      WHERE m.chat_id=? AND m.message_id=? AND m.lifecycle IN ('committed','client_pruned') AND m.memory_excluded=0 AND m.host_visibility IN ('active','all_before')
      AND m.extraction_state IN ('done','encapsulated')`).get(chatId, messageId) as { ordinal: number; canonical_hash: string; canonical_content: string; role: string; include_user_messages: number; memory_language: string } | undefined;
    if (!row || (row.role === "user" && row.include_user_messages === 0)) continue;
    if (recoveryCovered(typeof candidate === "string" ? { messageId, matchKinds: [], matchedPhrases: [] } : candidate,
      row.canonical_content, row.canonical_hash, deliveredEvidence)) continue;
    const id = `source-recovery:${createHash("sha256").update(`${chatId}\0${messageId}\0${row.canonical_hash}`).digest("hex")}`;
    const sourceRecoveryContext = typeof candidate === "string" ? undefined : {
      ...(query.trim() ? { query: query.trim().slice(0, 2000) } : {}),
      matchKinds: candidate.matchKinds,
      matchedPhrases: candidate.matchedPhrases.slice(0, 8),
    };
    const payload = { sourceMessageIds: [messageId], sourceFingerprint: sourceFingerprint(db, chatId, [messageId]), sourceRecoveryContext,
      sourceRecoveryMetadata: { targets: [{ messageId, ordinal: row.ordinal }], matchKinds: typeof candidate === "string" ? [] : candidate.matchKinds },
      sourceRecovery: true, trigger: 'source_recovery', postExtractionReview: true, auditDraft: { language: row.memory_language, entities: [], memories: [], stateObservations: [] } };
    const added = db.prepare(`INSERT OR IGNORE INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at)
      VALUES(?,?,'audit_retry','queued',?,0,?,?)`).run(id, chatId, JSON.stringify(payload), Date.now(), Date.now()).changes;
    if (added) return 1;
  }
  return 0;
}

export function retrieveSourceEvidence(db: RcmDatabase, chatId: string, query: string, perspectives: string[], tokenBudget: number,
  promptIds: string[] = [], semantic: SemanticSourceHit[] = [], coveredQuotes: string[] = [], excludedAtoms: string[] = [], accept: (quote: string) => boolean = () => true, ranking?: {rank:(quote:string)=>number; maxItems:number; budgetRatio:number}): { items: SourceEvidenceItem[]; xml: string; tokens: number; unresolvedMessageIds: string[]; recoveryCandidates: SourceRecoveryCandidate[] } {
  const tokens = normalizeSearchTokens(query).slice(0, 48);
  const recoveryPhrases = exactRecoveryPhrases(query);
  const queryFts = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
  const candidates = new Map<string, number>();
  if (queryFts) {
    for (const row of db.prepare(`SELECT message_id,bm25(source_fts) rank FROM source_fts WHERE chat_id=? AND source_fts MATCH ? ORDER BY rank LIMIT 32`)
      .all(chatId, queryFts) as Array<{ message_id: string; rank: number }>) candidates.set(row.message_id, 1 / (1 + candidates.size));
  }
  for (const phrase of recoveryPhrases.slice(0, 8)) {
    const phraseQuery = `"${phrase.replaceAll('"', '""')}"`;
    for (const row of db.prepare(`SELECT message_id FROM source_fts WHERE chat_id=? AND source_fts MATCH ? LIMIT 8`)
      .all(chatId, phraseQuery) as Array<{ message_id: string }>) candidates.set(row.message_id, Math.max(candidates.get(row.message_id) ?? 0, 1));
  }
  for (const hit of semantic) for (const id of hit.messageIds) candidates.set(id, Math.max(candidates.get(id) ?? 0, hit.score));
  const semanticScores = new Map<string, number>();
  for (const hit of semantic) for (const id of hit.messageIds) semanticScores.set(id, Math.max(semanticScores.get(id) ?? 0, hit.score));
  const active = new Set(perspectives.map(normalized));
  const source = db.prepare(`SELECT p.*,m.ordinal,m.canonical_content FROM source_passages p JOIN messages m
    ON m.chat_id=p.chat_id AND m.message_id=p.message_id AND m.canonical_hash=p.canonical_hash
    WHERE p.chat_id=? AND p.message_id=? AND p.active=1 AND m.lifecycle IN ('committed','client_pruned')
      AND m.memory_excluded=0 AND m.host_visibility IN ('active','all_before') ORDER BY p.start_offset`);
  const ranked: SourceEvidenceItem[] = [];
  const recoveryCandidates: SourceRecoveryCandidate[] = [];
  const messageContent = db.prepare(`SELECT canonical_content FROM messages WHERE chat_id=? AND message_id=?
    AND lifecycle IN ('committed','client_pruned') AND memory_excluded=0 AND host_visibility IN ('active','all_before')`);
  for (const [messageId, sourceScore] of candidates) {
    if (promptIds.includes(messageId)) continue;
    const rows = source.all(chatId, messageId) as Array<{ id: string; canonical_hash:string; quote: string; speaker: string | null; epistemic: string; access_json: string; ordinal: number; canonical_content: string; start_offset: number; end_offset: number }>;
    const content = (messageContent.get(chatId, messageId) as { canonical_content: string } | undefined)?.canonical_content ?? "";
    if (!content) continue;
    const normalizedContent = normalized(content).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
    const matchedPhrases = recoveryPhrases.filter((phrase) => normalizedContent.includes(phrase));
    const strongSemantic = (semanticScores.get(messageId) ?? 0) >= SOURCE_RECOVERY_SEMANTIC_THRESHOLD;
    let hasValidAccess = false;
    let hasRelevantPassage = false;
    let invalidRelevantAccess = false;
    for (const row of rows) {
      if (excludedAtoms.includes(sourceEvidenceAtomKey(row)) || row.epistemic === "stated" && !row.speaker) continue;
      const storedGrants = JSON.parse(row.access_json) as SourcePassage["access"];
      const sources = new Map<string, string>([[messageId, row.canonical_content]]);
      for (const id of new Set(storedGrants.flatMap((grant) => grant.evidence.map((item) => item.messageId)))) {
        const support = db.prepare(`SELECT canonical_content FROM messages WHERE chat_id=? AND message_id=?
          AND lifecycle IN ('committed','client_pruned') AND memory_excluded=0 AND host_visibility IN ('active','all_before')`).get(chatId, id) as { canonical_content: string } | undefined;
        if (support?.canonical_content) sources.set(id, support.canonical_content);
      }
      const grants = validSourcePassageAccess({ messageId }, sources, storedGrants);
      if (grants.length) hasValidAccess = true;
      else if (strongSemantic || matchedPhrases.some((phrase) => normalized(row.quote).replace(/[^\p{L}\p{N}]+/gu, " ").includes(phrase))) invalidRelevantAccess = true;
      const holders = grants.map((grant) => grant.holder).filter((holder) => active.has(normalized(holder)));
      if (!holders.length || row.canonical_content.slice(row.start_offset, row.end_offset) !== row.quote || coveredQuotes.some((quote) => quote.includes(row.quote))) continue;
      const overlap = tokens.filter((token) => normalizeSearchTokens(row.quote).includes(token)).length;
      const contextual = semantic.some((hit) => hit.messageIds.includes(messageId) && Boolean((db.prepare("SELECT content FROM embedding_items WHERE item_id=? AND chat_id=?")
        .get(hit.chunkId, chatId) as { content: string } | undefined)?.content.includes(row.quote)));
      if ((!overlap && !contextual) || !accept(row.quote)) continue;
      hasRelevantPassage = true;
      ranked.push({ id: row.id, messageId, canonicalHash:row.canonical_hash,quote: row.quote, speaker: row.speaker, epistemic: row.epistemic,
        startOffset:row.start_offset,endOffset:row.end_offset,ordinal: row.ordinal, holders, score: ranking ? ranking.rank(row.quote) + sourceScore * .05 : overlap + sourceScore });
    }
    const uncoveredPhrases = matchedPhrases.filter((phrase) => !rows.some((row) => normalized(row.quote).replace(/[^\p{L}\p{N}]+/gu, " ").includes(phrase)));
    if ((strongSemantic && !rows.length) || uncoveredPhrases.length || invalidRelevantAccess || (strongSemantic && !hasValidAccess && !hasRelevantPassage)) {
      const matchKinds: SourceRecoveryCandidate["matchKinds"] = [];
      if (strongSemantic) matchKinds.push("semantic");
      if (uncoveredPhrases.length) matchKinds.push("exact_phrase");
      if (invalidRelevantAccess) matchKinds.push("invalid_access");
      recoveryCandidates.push({ messageId, matchKinds, matchedPhrases: uncoveredPhrases });
    }
  }
  const items: SourceEvidenceItem[] = [];
  const ceiling = Math.min(1200, Math.floor(tokenBudget * (ranking?.budgetRatio ?? 0.2)));
  for (const item of ranked.sort((a, b) => b.score - a.score || a.ordinal - b.ordinal)) {
    if (items.length >= (ranking?.maxItems ?? 2)) break;
    if (items.some((old) => old.messageId === item.messageId && (old.quote.includes(item.quote) || item.quote.includes(old.quote)))) continue;
    if (estimateTokens(renderSourceEvidence([...items, item])) > ceiling) continue;
    items.push(item);
  }
  const result = renderSourceEvidence(items);
  return { items, xml: result, tokens: estimateTokens(result), unresolvedMessageIds: recoveryCandidates.map((item) => item.messageId), recoveryCandidates };
}
