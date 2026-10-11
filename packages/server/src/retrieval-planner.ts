import { normalizeSearchTokens, stripYumiTransportComments, type MemoryLanguage, type SearchQuerySignal } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";

interface RankedToken {
  token: string;
  score: number;
  documentFrequency: number;
}

const RECENT_LANGUAGE_MESSAGE_LIMIT = 400;
const RECENT_LANGUAGE_CHAT_LIMIT = 32;
interface RecentLanguage {
  revision: number;
  language: MemoryLanguage;
  fractions: Map<string, number>;
}
const recentLanguageCache = new WeakMap<RcmDatabase, Map<string, RecentLanguage>>();

/** Apply the query normalizer throughout a document, beyond its per-call token cap. */
export function documentSearchTokens(text: string, language: MemoryLanguage): Set<string> {
  const words = text.match(/\S+/gu) ?? [];
  const tokens = new Set<string>();
  for (let offset = 0; offset < words.length; offset += 16) {
    for (const token of normalizeSearchTokens(words.slice(offset, offset + 16).join(" "), language)) tokens.add(token);
  }
  return tokens;
}

function recentLanguageFractions(db: RcmDatabase, chatId: string, language: MemoryLanguage): Map<string, number> {
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number }).revision;
  let cache = recentLanguageCache.get(db);
  if (!cache) { cache = new Map(); recentLanguageCache.set(db, cache); }
  const cached = cache.get(chatId);
  if (cached?.revision === revision && cached.language === language) return cached.fractions;
  const messages = db.prepare(`SELECT content FROM messages
    WHERE chat_id=? AND lifecycle='committed' AND host_visibility IN ('active','all_before')
    ORDER BY ordinal DESC, message_id DESC LIMIT ?`).all(chatId, RECENT_LANGUAGE_MESSAGE_LIMIT) as Array<{ content: string | null }>;
  const fractions = new Map<string, number>();
  for (const message of messages) {
    for (const token of documentSearchTokens(message.content ?? "", language)) {
      fractions.set(token, (fractions.get(token) ?? 0) + 1);
    }
  }
  // One absent-message pseudocount avoids erasing every query token when a
  // new chat has just one committed message. Its effect vanishes with history.
  for (const [token, count] of fractions) fractions.set(token, count / (messages.length + 1));
  cache.delete(chatId);
  cache.set(chatId, { revision, language, fractions });
  if (cache.size > RECENT_LANGUAGE_CHAT_LIMIT) cache.delete(cache.keys().next().value!);
  return fractions;
}

const standaloneOocMarker = /(?<![\p{L}\p{N}_])ooc(?![\p{L}\p{N}_])[ \t]*:?[ \t]*/giu;

/**
 * OOC is an authoring-channel label, not recall subject matter. Keep the text
 * around it intact while preventing the label itself from clustering query
 * embeddings with unrelated historical OOC turns.
 */
export function stripRetrievalControlMarkers(text: string): string {
  return text
    .replace(/\(\(\s*ooc\s*\)\)[ \t]*:?[ \t]*/giu, " ")
    .replace(/\(\s*ooc\s*\)[ \t]*:?[ \t]*/giu, " ")
    .replace(/\[\s*ooc\s*\][ \t]*:?[ \t]*/giu, " ")
    .replace(/\{\s*ooc\s*\}[ \t]*:?[ \t]*/giu, " ")
    .replace(standaloneOocMarker, " ")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n[ \t]+/gu, "\n")
    .trim();
}

// Full-width sentence punctuation does not require a following space. Keep
// ASCII boundaries whitespace-based so decimals and abbreviations stay whole.
const sentenceBoundary = /(?<=[.!?])\s+|(?<=[。！？])\s*/u;

const splitSegments = (text: string): string[] => {
  const paragraphs = text.split(/\n\s*\n+/u).map((item) => item.trim()).filter(Boolean);
  const source = paragraphs.length > 1 ? paragraphs : text.split(sentenceBoundary).map((item) => item.trim()).filter(Boolean);
  return source.flatMap((item) => item.length <= 2_400
    ? [item]
    : item.split(sentenceBoundary).reduce<string[]>((chunks, sentence) => {
      const last = chunks.at(-1);
      if (last && last.length + sentence.length < 1_800) chunks[chunks.length - 1] = `${last} ${sentence}`;
      else chunks.push(sentence);
      return chunks;
    }, []));
};

interface CueSegment {
  text: string;
  afterSceneBreak: boolean;
}

const cueSegments = (text: string): CueSegment[] => {
  const groups = text.split(/^\s*(?:\*{3,}|-{3,}|_{3,})\s*$/gmu);
  let latestGroup = -1;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (groups[index]!.trim().length > 0) { latestGroup = index; break; }
  }
  return groups.flatMap((group, groupIndex) => splitSegments(group).map((segment) => ({
    text: segment,
    // A standalone separator is only a weak recency hint. Material before it
    // remains eligible because users express flashbacks and scene changes in
    // many different ways, including without punctuation conventions.
    afterSceneBreak: groups.length > 1 && groupIndex === latestGroup,
  })));
};

function compactCueSegments(items: CueSegment[], limit: number): CueSegment[] {
  if (items.length <= limit) return items;
  // Preserve the whole narrative span without issuing one embedding request
  // per sentence. Adjacent units share a bucket, so an early flashback is not
  // silently discarded merely because the user continued writing afterward.
  return Array.from({ length: limit }, (_, index) => {
    const from = Math.floor(index * items.length / limit);
    const to = Math.floor((index + 1) * items.length / limit);
    const bucket = items.slice(from, Math.max(from + 1, to));
    return {
      text: bucket.map((item) => item.text).join("\n\n"),
      afterSceneBreak: bucket.some((item) => item.afterSceneBreak),
    };
  });
}

const allTokens = (text: string, language: MemoryLanguage): string[] => {
  const queues = splitSegments(text).map((segment) => normalizeSearchTokens(segment, language));
  const result: string[] = [];
  const seen = new Set<string>();
  for (let offset = 0; result.length < 256 && queues.some((queue) => offset < queue.length); offset += 1) {
    for (const queue of queues) {
      const token = queue[offset];
      if (!token) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      result.push(token);
      if (result.length >= 256) break;
    }
  }
  return result.slice(0, 256);
};

function entityTokens(db: RcmDatabase, chatId: string, language: MemoryLanguage): Set<string> {
  const values = (db.prepare(`
    SELECT name AS value FROM entities WHERE chat_id=?
    UNION ALL SELECT entity_key AS value FROM entities WHERE chat_id=?
    UNION ALL SELECT a.alias AS value FROM aliases a JOIN entities e ON e.id=a.entity_id WHERE e.chat_id=?
  `).all(chatId, chatId, chatId) as Array<{ value: string }>).flatMap((row) => allTokens(row.value, language));
  return new Set(values);
}

function rankTokens(db: RcmDatabase, chatId: string, text: string, language: MemoryLanguage): RankedToken[] {
  const tokens = allTokens(text, language);
  if (tokens.length === 0) return [];
  const totalDocuments = Math.max(1,
    Number((db.prepare("SELECT count(*) AS count FROM memory_fts WHERE chat_id=?").get(chatId) as { count: number }).count)
    + Number((db.prepare("SELECT count(*) AS count FROM memory_detail_fts WHERE chat_id=?").get(chatId) as { count: number }).count));
  const memoryFrequency = db.prepare("SELECT count(*) AS count FROM memory_fts WHERE chat_id=? AND memory_fts MATCH ?");
  const detailFrequency = db.prepare("SELECT count(*) AS count FROM memory_detail_fts WHERE chat_id=? AND memory_detail_fts MATCH ?");
  const names = entityTokens(db, chatId, language);
  const commonness = recentLanguageFractions(db, chatId, language);
  const ranked: RankedToken[] = [];
  for (const token of tokens.slice(0, 96)) {
    const query = `"${token.replaceAll('"', '""')}"`;
    let documentFrequency = 0;
    try {
      documentFrequency = Number((memoryFrequency.get(chatId, query) as { count: number }).count)
        + Number((detailFrequency.get(chatId, query) as { count: number }).count);
    } catch { continue; }
    if (documentFrequency === 0) continue;
    const idf = Math.log((totalDocuments + 1) / (documentFrequency + 1)) + 1;
    // Message frequency counters the summary/chat register mismatch without
    // language-specific filler lists. Squaring smoothly suppresses repetition.
    const rarity = (1 - (commonness.get(token) ?? 0)) ** 2;
    const specificity = Math.min(1.35, 0.9 + [...token].length / 30);
    const entityPenalty = names.has(token) ? 0.22 : 1;
    const score = idf * rarity * specificity * entityPenalty;
    if (score > 0) ranked.push({ token, documentFrequency, score });
  }
  return ranked.sort((left, right) => right.score - left.score || left.documentFrequency - right.documentFrequency || right.token.length - left.token.length);
}

export function discriminativeSearchTokens(
  db: RcmDatabase,
  chatId: string,
  text: string,
  language: MemoryLanguage,
  limit = 24,
): string[] {
  return rankTokens(db, chatId, text, language).slice(0, limit).map((item) => item.token);
}

export function discriminativeSearchTokenWeights(
  db: RcmDatabase,
  chatId: string,
  text: string,
  language: MemoryLanguage,
  limit = 24,
): Map<string, number> {
  const ranked = rankTokens(db, chatId, text, language).slice(0, limit);
  const total = ranked.reduce((sum, item) => sum + item.score, 0);
  return new Map(ranked.map((item) => [item.token, total > 0 ? item.score / total : 0]));
}

export function buildRetrievalQuerySignals(
  db: RcmDatabase,
  chatId: string,
  input: SearchQuerySignal[],
  language: MemoryLanguage,
  cueLimit = 8,
): SearchQuerySignal[] {
  // Older clients and timing-race fallbacks can still submit translated display
  // text with Yumi's transport comments attached. Sanitize again at the server
  // retrieval boundary so protocol identifiers never become lexical evidence.
  const cleanInput = input.map((signal) => {
    const text = stripRetrievalControlMarkers(stripYumiTransportComments(signal.text));
    return { ...signal, text, weight: text ? signal.weight : 0 };
  });
  const focus = cleanInput.find((signal) => signal.kind === "focus" && signal.weight > 0);
  if (!focus) return cleanInput;
  const seen = new Set(cleanInput.map((signal) => signal.text.trim()).filter(Boolean));
  // Character count cannot distinguish a useful cue from conversational filler
  // across languages. Give every nonempty narrative unit a search view, bounded
  // by compaction and the existing shared cue budget, then rank its evidence.
  const candidates = compactCueSegments(cueSegments(focus.text), cueLimit).filter((item) => {
      const text = item.text.trim();
      if (!text || seen.has(text)) return false;
      seen.add(text);
      item.text = text;
      return true;
    });
  if (candidates.length === 0) return cleanInput;
  const cueShare = Math.max(0, focus.weight) * 0.3;
  if (cueShare <= 0) return cleanInput;
  const cueMasses = candidates.map((item) => rankTokens(db, chatId, item.text, language)
    .slice(0, 24).reduce((sum, token) => sum + token.score, 0));
  const maximumCueMass = Math.max(0, ...cueMasses);
  const cueFactors = candidates.map((item, index) => {
    const position = candidates.length <= 1 ? 1 : index / (candidates.length - 1);
    const recency = 0.96 + position * 0.08;
    const idfMass = maximumCueMass > 0 ? cueMasses[index]! / maximumCueMass : 0;
    return (0.5 + 0.5 * idfMass) * recency * (item.afterSceneBreak ? 1.04 : 1);
  });
  const totalCueFactor = cueFactors.reduce((sum, factor) => sum + factor, 0);
  return [
    ...cleanInput.map((signal) => signal === focus ? { ...signal, weight: signal.weight - cueShare } : signal),
    ...candidates.map((item, index) => ({
      kind: "cue" as const,
      text: item.text,
      weight: cueShare * cueFactors[index]! / totalCueFactor,
    })),
  ];
}
