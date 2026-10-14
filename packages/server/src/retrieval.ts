import { StateOutcomeCapture } from "./state-outcomes.js";
import { accessibleStorySeed } from "./story-seeds.js";
import { EVERYONE_HOLDER, itemAccessKnowledge } from "./item-access.js";
import { knownByLabels } from "./item-access.js";
import { collectStateEvidence, selectStateEvidence, stateMcpEvidence } from "./state-evidence.js";
import { renderStateLine, sharedStateBudget } from "./automatic-state.js";
import { parseSocialRelation, socialRelationKnowledge } from "./social-relations.js";
import { projectMemoryScene, renderMemoryScene } from "@rcm/shared";
import { loadResidualActivations, type AutomaticActivationObservation } from "./recall-activation.js";
import { orderEventContext, type EventConnection } from "./event-context.js";
import { proposeAtomPathRoots } from "./atom-path-roots.js";
import { compareAtomPaths, type AtomPath } from "./atom-path-search.js";
import { searchStoredAtomPaths, type StoredAtomPathSearchStats } from "./atom-path-snapshot.js";
import { AUTOMATIC_ROLE_SHARES, ASSOCIATION_RELATIVE_THRESHOLD, ASSOCIATION_SEMANTIC_MAX, type AutomaticAtomPriority, type AutomaticPortfolioCandidate, type AutomaticRoleReason } from "./automatic-packet.js";
import { extendRecallPath, startRecallPath, observeRootEvidence, type RecallPath, type RecallPathCapture, type RecallPathObservation } from "./recall-path.js";
import { searchableMemoryParentSql } from "./memory-group-search.js";
import { invalidateChangedMemoryGroups } from "./memory-grouping.js";
import { emptyPacketManifest, mergePacketManifests, type PacketManifest } from "./packet-manifest.js";
import { randomUUID } from "node:crypto";
import {
  estimateTokens,
  memoryGuidanceBlock,
  memoryEvidenceKind,
  joinDialogueSpans,
  landmarkAlwaysInjected,
  normalizeSearchTokens,
  queryViewAuthority,
  type MemoryContextItem,
  type MemoryDetail,
  type MemoryLanguage,
  type RecallIntent,
  type RecallCoverageItem,
  type RpProfile,
  type SearchQuerySignal,
} from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { listEntities, normalizeEntityName, type EntityItem } from "./entities.js";
import { listSocialKnowledge } from "./social-knowledge.js";
import { listRelationshipProjections } from "./relationship-projections.js";
import type { SemanticMemoryHit } from "./embedding.js";
import { discriminativeSearchTokenWeights, documentSearchTokens } from "./retrieval-planner.js";
import { loadItemAccess, resolveItemAccess, visibleTo, type ItemAccessScope } from "./item-access.js";
import { intimacyMilestonePacketType } from "./intimacy-milestones.js";
import { memoryAtomKey, filterMemoryAtoms, hasRenderableMemoryAtom, memoryAtomKeys, memoryDetailAtomKey, memoryDialogueAtomKey, physicalDetailAtomKey, physicalOccurrenceAtomKey, relationshipLandmarkAtomKey } from "./memory-atoms.js";
import { memoryContextSignature, parseLandmarkKinds as parseStoredLandmarkKinds, RELATIONSHIP_LANDMARK_KINDS } from "./memory-search-document.js";

interface MemoryRow {
  id: string;
  memory_key: string;
  type: string;
  title: string;
  content: string;
  participants_json: string;
  known_by_json: string;
  perspective: string | null;
  story_time: string | null;
  story_time_normalized: string | null;
  locations_json: string;
  landmark: number;
  landmark_kinds_json: string;
  evidence_json: string;
  salience: number;
  strength: number;
  recall_count: number;
  last_recalled_revision: number | null;
  pinned: number;
  atom_access_version: number;
  created_revision: number;
  created_at: number;
  source_ordinal?: number | null;
  source_turn_seq?: number | null;
}

interface Ranked extends MemoryContextItem {
  raw: MemoryRow;
  directSignal: number;
  directDetailSignal: number;
  arcSignal: number;
  associationSignal: number;
  atomPath?: AtomPath;
  retrievalSignal: number;
  detailSignal: number;
  directDetailIds: string[];
  candidateClass: RetrievalCandidateClass;
  expansionReasons: Array<"story_arc" | "event_edge" | "graph_association">;
  accessibility: number;
  propagatedEnergy: number;
  residualActivation: number;
  viaMemoryId?: string;
  baseDirect: number;
  cognitiveBonus: number;
  viewAuthority: number;
}

export type RetrievalCandidateClass = "core" | "associative" | "continuity" | "unclassified";
export type RetrievalSelectionRole = "focus" | "core" | "continuity" | "association" | "serendipity" | "longterm" | "filler";

export interface RetrievalCandidateTrace {
  id: string;
  type: string;
  title: string;
  sourceOrdinal?: number;
  score: number;
  directSignal: number;
  directDetailSignal: number;
  baseDirect: number;
  cognitiveBonus: number;
  viewAuthority: number;
  retrievalSignal: number;
  detailSignal: number;
  lexicalScore: number;
  matchedLexicalTokens?: Array<{ viewIndex: number; memory: string[]; detail: string[] }>;
  semanticScore: number;
  arcScore?: number;
  associationScore?: number;
  propagatedEnergy: number;
  residualActivation: number;
  viaMemoryId?: string;
  candidateClass: Ranked["candidateClass"];
  selectionRole?: RetrievalSelectionRole;
  roleReason?: AutomaticRoleReason;
  expansionReasons: Ranked["expansionReasons"];
  eventConnection?: Omit<EventConnection<Ranked>, "item">;
  recallPath?: RecallPathObservation;
  atomPath?: AtomPath;
  semanticHit?: { kind: string; sourceId: string; score: number };
  lanes: string[];
  focusRank?: number;
  focusSources?: Array<"lexical" | "semantic">;
  outcome: "selected" | "ineligible" | "not_reserved" | "association_cap" | "memory_cap" | "duplicate" | "atom_suppressed" | "token_budget" | "final_packet_trim";
}

export interface RetrievalDiagnostics {
  currentState?: import("./state-outcomes.js").StateOutcomeReport;
  mcpQuestions?: Array<{question:string; candidates:Array<{memoryId:string; rankScore:number; detailIds:string[]; dialogueKeys:string[]; rawAtomHits:SemanticMemoryHit[]}>}>;
  atomPathSearch?: StoredAtomPathSearchStats;
  elapsedMs: number;
  perspective: string;
  intent: RecallIntent;
  mcpAnswerMode: boolean;
  tokenBudget: number;
  hardTokenCeiling: number;
  candidateCount: number;
  eligibleCount: number;
  orderedCount: number;
  usedTokens: number;
  selectedIds: string[];
  focusLeaderIds: string[];
  continuityBridgeIds: string[];
  overflowTokens: number;
  overflowSlotUsed: boolean;
  recentMemoryIds: string[];
  bridgeMemoryIds: string[];
  continuitySupplementIds: string[];
  selectedClassCounts: { core: number; associative: number; continuity: number };
  selectedRoleCounts: Record<RetrievalSelectionRole, number>;
  associativeTokenBudget: number;
  promptCoveredMemoryIds: string[];
  promptCoveredDetailIds: string[];
  promptCoveredDialogueIds: string[];
  excludedMemoryIds: string[];
  candidates: RetrievalCandidateTrace[];
  arcExpansion?: Array<{ arcNodeId: string; semanticScore: number; leafId: string; outcome: string }>;
}

interface LexicalSearchResult {
  scores: Map<string, number>;
  detailHits: Map<string, SemanticMemoryHit>;
  atomHits: SemanticMemoryHit[];
  views: Array<{
    signal: SearchQuerySignal;
    tokens: Set<string>;
    tokenWeights: Map<string, number>;
    scores: Map<string, number>;
    matches: Map<string, { memory: string[]; detail: string[] }>;
  }>;
}

type KeyDialogue = MemoryContextItem["keyDialogues"][number];
type MemoryEvidence = MemoryContextItem["evidence"][number];

interface PromptCoverage {
  covered: Set<string>;
  active: Set<string>;
}

function expandAnchoredAssociations(db: RcmDatabase, chatId: string, ranked: Ranked[], seedMemoryId?: string, paths?: RecallPathCapture): void {
  const byId = new Map(ranked.map((item) => [item.id, item]));
  const anchors = ranked.filter((item) => item.directSignal > 0 || item.directDetailSignal > 0 || item.id === seedMemoryId)
    .sort((left, right) => Math.max(right.directSignal, right.directDetailSignal) - Math.max(left.directSignal, left.directDetailSignal))
    .slice(0, 4);
  if (anchors.length === 0) return;
  let frontier = new Map(anchors.map((item) => [item.id, item.id === seedMemoryId ? 1 : Math.min(1, Math.max(item.directSignal, item.directDetailSignal))]));
  let frontierPaths = paths ? new Map(anchors.map((item): [string, RecallPath] => [item.id,
    item.id === seedMemoryId ? startRecallPath({ memoryId: item.id, kind: "explicit_seed", score: 1 }) : paths.direct.get(item.id)!,
  ])) : undefined;
  const best = new Map(frontier);
  for (let depth = 1; depth <= 4 && frontier.size > 0; depth += 1) {
    const ids = [...frontier.keys()];
    const placeholders = ids.map(() => "?").join(",");
    const edges = db.prepare(`SELECT source_id,target_id,weight FROM memory_edges
      WHERE chat_id=? AND (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
      ORDER BY weight DESC LIMIT 240`).all(chatId, ...ids, ...ids) as Array<{ source_id: string; target_id: string; weight: number }>;
    const next = new Map<string, number>();
    const nextPaths = paths ? new Map<string, RecallPath>() : undefined;
    for (const edge of edges) {
      const parentId = frontier.has(edge.source_id) ? edge.source_id : frontier.has(edge.target_id) ? edge.target_id : undefined;
      if (!parentId) continue;
      const targetId = parentId === edge.source_id ? edge.target_id : edge.source_id;
      const target = byId.get(targetId);
      if (!target) continue;
      const pathBoost = target.viaMemoryId === parentId ? 1.08 : 1;
      const amount = (frontier.get(parentId) ?? 0) * edge.weight * 0.6 * pathBoost;
      if (amount < 0.05 || amount <= (best.get(targetId) ?? 0)) continue;
      best.set(targetId, amount);
      next.set(targetId, Math.max(next.get(targetId) ?? 0, amount));
      const parentPath = frontierPaths?.get(parentId);
      if (paths && parentPath) {
        const path = extendRecallPath(parentPath, { fromMemoryId: parentId, toMemoryId: targetId,
          stage: "graph", relation: "memory_edge", weight: edge.weight, energy: amount });
        nextPaths!.set(targetId, path);
        paths.graph.set(targetId, path);
      }
      target.propagatedEnergy = Math.max(target.propagatedEnergy, amount);
      target.viaMemoryId = parentId;
      target.score += amount;
      target.retrievalSignal += amount;
      target.associationSignal = Math.max(target.associationSignal, amount);
      if (!target.expansionReasons.includes("graph_association")) target.expansionReasons.push("graph_association");
    }
    frontier = next;
    frontierPaths = nextPaths;
  }
}

function isFullyPromptCovered(evidenceJson: string | null | undefined, coverage?: PromptCoverage): boolean {
  if (!coverage || coverage.covered.size === 0 || !evidenceJson) return false;
  const activeEvidence = parseEvidence(evidenceJson).map((item) => item.messageId).filter((id) => coverage.active.has(id));
  return activeEvidence.length > 0 && activeEvidence.every((id) => coverage.covered.has(id));
}

const escapeXml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");


function safeExcerpt(value: string, maxLength: number): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength + 1);
  const sentence = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
  if (sentence >= Math.floor(maxLength * 0.55)) return clipped.slice(0, sentence + 1).trim();
  const word = clipped.lastIndexOf(" ", maxLength);
  return `${clipped.slice(0, word >= Math.floor(maxLength * 0.55) ? word : maxLength).trimEnd()}…`;
}

const parseList = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
};

const parseEvidence = (value: string): MemoryEvidence[] => {
  try {
    const parsed = JSON.parse(value) as Array<{ messageId?: unknown; quote?: unknown }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => typeof entry?.messageId === "string"
      ? [{ messageId: entry.messageId, ...(typeof entry.quote === "string" && entry.quote.trim() ? { quote: entry.quote } : {}) }]
      : []);
  } catch {
    return [];
  }
};

const parseLandmarkKinds = (value: string): MemoryContextItem["landmarkKinds"] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.kind === "string") : [];
  } catch { return []; }
};

const overlapScore = (query: Set<string>, text: string): number => {
  if (query.size === 0) return 0;
  const tokens = new Set<string>();
  const words = text.match(/\S+/gu) ?? [];
  for (let offset = 0; offset < words.length; offset += 32) {
    normalizeSearchTokens(words.slice(offset, offset + 32).join(" ")).forEach((token) => tokens.add(token));
  }
  let intersection = 0;
  for (const token of query) if (tokens.has(token)) intersection += 1;
  return intersection / query.size;
};

function weightedOverlap(signals: SearchQuerySignal[], text: string): number {
  return signals.reduce((score, signal) => score + overlapScore(new Set(normalizeSearchTokens(signal.text)), text) * signal.weight, 0);
}

function discriminativeWeightedOverlap(
  signals: Array<{ tokens: Map<string, number>; weight: number }>,
  text: string,
): number {
  return signals.reduce((score, signal) => score
    + (idfWeightedCoverage(signal.tokens, text) + orderedProximityBonus(signal.tokens, text)) * signal.weight, 0);
}

function idfWeightedCoverage(weights: Map<string, number>, text: string): number {
  if (weights.size === 0) return 0;
  const present = new Set(normalizeSearchTokens(text));
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return 0;
  return [...weights].reduce((sum, [token, weight]) => sum + (present.has(token) ? weight : 0), 0) / total;
}

function orderedProximityBonus(weights: Map<string, number>, text: string): number {
  const distinctive = [...weights].sort((left, right) => right[1] - left[1]).slice(0, 4).map(([token]) => token);
  if (distinctive.length < 2) return 0;
  const sequence = normalizeSearchTokens(text);
  let previous = -1;
  let matched = 0;
  let gap = 0;
  for (const token of distinctive) {
    const index = sequence.indexOf(token, previous + 1);
    if (index < 0) continue;
    if (previous >= 0) gap += Math.max(0, index - previous - 1);
    previous = index;
    matched += 1;
  }
  if (matched < 2) return 0;
  const coverage = matched / distinctive.length;
  const compactness = 1 / (1 + gap / Math.max(1, matched - 1));
  return Math.min(0.12, 0.12 * coverage * compactness);
}

function entityAnchorsInAspect(aspect: string, entities: EntityItem[]): EntityItem[] {
  const aspectTokens = new Set(normalizeSearchTokens(aspect));
  return entities.filter((entity) => [entity.name, entity.key, ...entity.aliases].some((candidate) => {
    const tokens = normalizeSearchTokens(candidate);
    return tokens.length > 0 && tokens.every((token) => aspectTokens.has(token));
  }));
}

function hasEntityAnchorGrounding(aspect: string, answerText: string, entities: EntityItem[]): boolean {
  const anchors = entityAnchorsInAspect(aspect, entities);
  if (anchors.length === 0) return true;
  const answerTokens = new Set(normalizeSearchTokens(answerText));
  return anchors.every((entity) => [entity.name, entity.key, ...entity.aliases].some((candidate) => {
    const tokens = normalizeSearchTokens(candidate);
    return tokens.length > 0 && tokens.every((token) => answerTokens.has(token));
  }));
}

function contentTokensForAspect(aspect: string, tokens: Set<string>, entities: EntityItem[]): Set<string> {
  const entityTokens = new Set(entityAnchorsInAspect(aspect, entities)
    .flatMap((entity) => [entity.name, entity.key, ...entity.aliases])
    .flatMap((candidate) => normalizeSearchTokens(candidate)));
  const contentTokens = new Set([...tokens].filter((token) => !entityTokens.has(token)));
  return contentTokens;
}

function aspectEvidence(
  aspect: string,
  aspectTokens: Set<string>,
  sceneTokens: Set<string>,
  item: MemoryContextItem,
  entities: EntityItem[],
  hit?: SemanticMemoryHit,
  searchEnvelope = "",
  lexicalHit?: SemanticMemoryHit,
  semanticRankEvidence?: number,
  atomHits: SemanticMemoryHit[] = hit ? [hit] : [],
): { score: number; direct: boolean; atomicHit: boolean; strongItemMatch: boolean; detailIds: string[]; boundDetailIds: string[]; dialogueKeys: string[] } {
  const body = `${searchEnvelope} ${item.title} ${item.content} ${item.storyTime ?? ""} ${item.locations.join(" ")} ${item.keyDialogues.length ? "dialogue quoted words" : ""} ${item.keyDialogues.map((dialogue) => `${dialogue.speaker} ${dialogue.text}`).join(" ")} ${item.details.map((detail) => detail.text).join(" ")}`;
  if (!hasEntityAnchorGrounding(aspect, body, entities)) return { score: 0, direct: false, atomicHit: false, strongItemMatch: false, detailIds: [], boundDetailIds: [], dialogueKeys: [] };
  const contentTokens = contentTokensForAspect(aspect, aspectTokens, entities);
  const lexical = overlapScore(contentTokens, body);
  const scene = overlapScore(sceneTokens, body);
  const directLexical = (text: string): boolean => {
    const tokens = new Set(normalizeSearchTokens(text));
    return contentTokens.size > 0 && hasEntityAnchorGrounding(aspect, text, entities)
      && overlapScore(contentTokens, text) >= 0.72
      && [...contentTokens].filter(token => tokens.has(token)).length >= Math.min(2, contentTokens.size);
  };
  // Relative rank discovers candidates. Only raw, atom-bound similarity or
  // direct lexical evidence authorizes an answer, independently of rank.
  const directDetailIds = item.details.filter(detail => directLexical(`${detail.text} ${detail.participants.join(" ")} ${detail.locations.join(" ")}`)

    || atomHits.some(candidate => candidate.kind === "memory_detail" && candidate.sourceId === detail.id && candidate.score >= 0.72))
    .map(detail => detail.id);
  const dialogueKeys = item.keyDialogues.filter(dialogue => directLexical(`${dialogue.speaker} ${dialogue.kind} ${dialogue.text}`))
    .map(dialogue => memoryDialogueAtomKey(item.id, dialogue));
  const direct = directDetailIds.length > 0 || dialogueKeys.length > 0;
  return {
    score: Math.max(lexical, semanticRankEvidence ?? hit?.score ?? 0) + Math.min(0.12, scene * 0.25),
    direct, atomicHit: direct, strongItemMatch: direct,
    detailIds: directDetailIds, boundDetailIds: directDetailIds, dialogueKeys,
  };
}

export interface SimilaritySignature {
  all: Set<string>;
  body: Set<string>;
}

function similaritySignature(item: Ranked): SimilaritySignature {
  return {
    // Materialized atom views deliberately hide their parent synopsis from the
    // model, but that synopsis remains the episode's search envelope. MMR must
    // compare those envelopes rather than treating every atomized scene as
    // the same bag of participant and location names.
    all: new Set(normalizeSearchTokens(`${item.raw.title} ${item.raw.content} ${item.raw.participants_json} ${item.raw.locations_json}`)),
    body: new Set(normalizeSearchTokens(item.raw.content)),
  };
}

function interleaveRankedLanes(lanes: Ranked[][], limit = 64): Ranked[] {
  const offsets = lanes.map(() => 0);
  const selected: Ranked[] = [];
  const seen = new Set<string>();
  while (selected.length < limit) {
    let advanced = false;
    for (let laneIndex = 0; laneIndex < lanes.length && selected.length < limit; laneIndex += 1) {
      const lane = lanes[laneIndex]!;
      while (offsets[laneIndex]! < lane.length) {
        const item = lane[offsets[laneIndex]!]!;
        offsets[laneIndex] = offsets[laneIndex]! + 1;
        advanced = true;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        selected.push(item);
        break;
      }
    }
    if (!advanced) break;
  }
  return selected;
}

function lastIndexWhere<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index]!)) return index;
  return -1;
}

function queryDateRange(value: string): { from: number; to: number } | undefined {
  const dates = [...new Set(value.match(/\b\d{4}-\d{2}-\d{2}\b/gu) ?? [])]
    .map((date) => Date.parse(`${date}T00:00:00Z`)).filter(Number.isFinite).sort((left, right) => left - right);
  if (dates.length < 2) return undefined;
  return { from: dates[0]!, to: dates.at(-1)! };
}

function temporalRangeSignal(range: { from: number; to: number } | undefined, storyTime?: string): number {
  if (!range || !storyTime) return 0;
  const date = storyTime.match(/^\d{4}-\d{2}-\d{2}/u)?.[0];
  if (!date) return 0;
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value)) return 0;
  if (value >= range.from && value <= range.to) return 0.24;
  const distanceDays = Math.min(Math.abs(value - range.from), Math.abs(value - range.to)) / 86_400_000;
  return -Math.min(0.24, 0.06 + distanceDays * 0.012);
}

function temporalRangeTier(range: { from: number; to: number } | undefined, storyTime?: string): number {
  if (!range || !storyTime) return 0;
  const date = storyTime.match(/^\d{4}-\d{2}-\d{2}/u)?.[0];
  if (!date) return 0;
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value)) return 0;
  if (value >= range.from && value <= range.to) return 2;
  const distanceDays = Math.min(Math.abs(value - range.from), Math.abs(value - range.to)) / 86_400_000;
  return distanceDays <= 3 ? 1 : 0;
}

function relativeViewEvidence(scores: Map<string, number> | undefined, limit = 24): Map<string, number> {
  if (!scores?.size) return new Map();
  const ranked = [...scores].sort((left, right) => right[1] - left[1]).slice(0, limit);
  const top = ranked[0]![1];
  const floor = ranked.at(-1)![1];
  return new Map(ranked.map(([id, score], rank) => {
    const separated = top > floor ? Math.max(0, Math.min(1, (score - floor) / (top - floor))) : 0;
    return [id, separated * 0.72 + 1 / (1 + rank * 0.22) * 0.28];
  }));
}

function contentSimilarity(left: Ranked, right: Ranked, signatures: Map<string, SimilaritySignature>): number {
  const leftTokens = signatures.get(left.id) ?? similaritySignature(left);
  const rightTokens = signatures.get(right.id) ?? similaritySignature(right);
  return signatureSimilarity(leftTokens, rightTokens);
}

export function signatureSimilarity(leftTokens: SimilaritySignature, rightTokens: SimilaritySignature): number {
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    for (const token of a) if (b.has(token)) shared += 1;
    return shared / (a.size + b.size - shared);
  };
  return Math.max(jaccard(leftTokens.all, rightTokens.all), jaccard(leftTokens.body, rightTokens.body));
}

function mmrOrder(items: Ranked[], signatures: Map<string, SimilaritySignature>, limit = 64): Ranked[] {
  const remaining = [...items];
  const ordered: Ranked[] = [];
  const highest = Math.max(0, ...items.map((item) => item.score));
  const lowest = Math.min(highest, ...items.map((item) => item.score));
  const relevance = (item: Ranked): number => highest > lowest ? (item.score - lowest) / (highest - lowest) : 1;
  while (remaining.length > 0 && ordered.length < limit) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index]!;
      const redundancy = ordered.reduce((highest, selected) => Math.max(highest, contentSimilarity(item, selected, signatures)), 0);
      const value = relevance(item) * 0.8 + (1 - redundancy) * 0.2 + (item.raw.pinned ? 1 : 0);
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0]!);
  }
  return ordered;
}

function mmrOrderWithSeed(items: Ranked[], signatures: Map<string, SimilaritySignature>, seed: Ranked[], limit = 64): Ranked[] {
  const remaining = [...items];
  const ordered: Ranked[] = [];
  const highest = Math.max(0, ...items.map((item) => item.score));
  const lowest = Math.min(highest, ...items.map((item) => item.score));
  const relevance = (item: Ranked): number => highest > lowest ? (item.score - lowest) / (highest - lowest) : 1;
  while (remaining.length > 0 && ordered.length < limit) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index]!;
      const redundancy = [...seed, ...ordered].reduce((highest, selected) => Math.max(highest, contentSimilarity(item, selected, signatures)), 0);
      const value = relevance(item) * 0.8 + (1 - redundancy) * 0.2 + (item.raw.pinned ? 1 : 0);
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0]!);
  }
  return ordered;
}

function weaveCoreAndAssociative(core: Ranked[], associative: Ranked[], interval = 3): Ranked[] {
  const ordered: Ranked[] = [];
  let associationIndex = 0;
  for (let index = 0; index < core.length; index += 1) {
    ordered.push(core[index]!);
    if ((index + 1) % interval === 0 && associationIndex < associative.length) {
      ordered.push(associative[associationIndex++]!);
    }
  }
  while (associationIndex < associative.length) ordered.push(associative[associationIndex++]!);
  return ordered;
}

function publicMemoryContext(item: Ranked): MemoryContextItem {
  const {
    raw: _raw,
    directSignal: _directSignal,
    directDetailSignal: _directDetailSignal,
    arcSignal: _arcSignal,
    associationSignal: _associationSignal,
    atomPath: _atomPath,
    retrievalSignal: _retrievalSignal,
    detailSignal: _detailSignal,
    candidateClass: _candidateClass,
    expansionReasons: _expansionReasons,
    accessibility: _accessibility,
    propagatedEnergy: _propagatedEnergy,
    residualActivation: _residualActivation,
    viaMemoryId: _viaMemoryId,
    baseDirect: _baseDirect,
    cognitiveBonus: _cognitiveBonus,
    viewAuthority: _viewAuthority,
    ...publicItem
  } = item;
  return publicItem;
}

function tierAllowsRecall(item: Ranked, seedMemoryId?: string): boolean {
  if (item.raw.pinned || item.id === seedMemoryId) return true;
  const direct = Math.max(item.directSignal, item.directDetailSignal);
  if (item.accessibility >= 0.28) return true;
  const connectedSupport = item.atomPath?.support ?? item.propagatedEnergy;
  if (item.accessibility >= 0.14) return direct >= 0.18 || connectedSupport >= 0.12;
  return direct >= 0.28 || connectedSupport >= 0.2;
}

function allowedByPerspective(row: MemoryRow, profile: RpProfile, perspective: string): boolean {
  const knownBy = parseList(row.known_by_json);
  if (perspective === "narrator") return profile === "simulation" || knownBy.length === 0;
  if (knownBy.length === 0) return row.type !== "secret";
  return knownBy.includes(EVERYONE_HOLDER) || knownBy.some((name) => name.toLocaleLowerCase() === perspective.toLocaleLowerCase());
}

function detailFor(row: MemoryRow, completedTurns: number, trace?: { strength: number; salience: number; recall_count: number; last_recalled_turn_seq: number | null; detail_level: string }): { detail: MemoryDetail; effective: number } {
  const age = Math.max(0, completedTurns - Number(row.source_turn_seq ?? 0));
  const decay = Math.exp(-0.0025 * age);
  const strength = trace?.strength ?? row.strength;
  const salience = trace?.salience ?? row.salience;
  const recallCount = trace?.recall_count ?? row.recall_count;
  const traceAge = trace?.last_recalled_turn_seq == null ? age : Math.max(0, completedTurns - trace.last_recalled_turn_seq);
  const reinforcement = Math.log1p(recallCount) * 0.045 * Math.exp(-0.0015 * traceAge);
  const recalledFloor = trace?.last_recalled_turn_seq == null ? 0
    : (trace.detail_level === "clear" ? 0.78 : 0.5) * Math.exp(-0.0025 * traceAge);
  const effective = Math.min(1, Math.max(recalledFloor, strength * decay + salience * 0.18 + reinforcement + (row.pinned ? 0.4 : 0)));
  if (effective >= 0.78) return { detail: "clear", effective };
  if (effective >= 0.5) return { detail: "gist", effective };
  if (effective >= 0.28) return { detail: "fragment", effective };
  if (effective >= 0.14) return { detail: "deja_vu", effective };
  return { detail: "unrecalled", effective };
}

function joinAccessScopedDialogues(items: KeyDialogue[]): KeyDialogue[] {
  return items.map(item => ({...item,knownBy:[...item.knownBy]}));
}

/** One semantic vocabulary for automatic context and archive results. Access is resolved before rendering. */
function renderMemoryContent(item: MemoryContextItem, _archive: boolean): string {
  return renderMemoryScene(projectMemoryScene(item));
}

export function renderMemoryItem(item: MemoryContextItem, _intent: RecallIntent = "recall"): string {
  return renderMemoryContent(item, false);
}

function renderArchiveMemoryItem(item: MemoryContextItem, _intent: RecallIntent = "recall"): string {
  return renderMemoryContent(item, true);
}

function renderRecentContinuityItem(item: MemoryContextItem): string {
  return renderMemoryItem(item);
}

export function mergeMemoryContextItems(left: MemoryContextItem, right: MemoryContextItem): MemoryContextItem {
  const base = right.score > left.score ? right : left;
  const other = base === left ? right : left;
  const union = (values: string[]): string[] => [...new Set(values)];
  const detailMap = new Map([...base.details, ...other.details].map((detail) => [detail.id, detail]));
  const dialogueMap = new Map<string, KeyDialogue>();
  for (const dialogue of [...base.keyDialogues, ...other.keyDialogues]) {
    const key = `${dialogue.messageId}\0${dialogue.speaker}\0${dialogue.text}`;
    const existing = dialogueMap.get(key);
    dialogueMap.set(key, existing ? { ...existing, knownBy: union([...existing.knownBy, ...dialogue.knownBy]) } : dialogue);
  }
  const evidenceMap = new Map([...base.evidence, ...other.evidence]
    .map((evidence) => [`${evidence.messageId}\0${evidence.quote ?? ""}`, evidence]));
  return {
    ...base,
    atomAccessVersion: Math.max(left.atomAccessVersion, right.atomAccessVersion),
    score: Math.max(left.score, right.score),
    knownBy: union([...left.knownBy, ...right.knownBy]),
    participants: union([...left.participants, ...right.participants]),
    locations: union([...left.locations, ...right.locations]),
    evidenceMessageIds: union([...left.evidenceMessageIds, ...right.evidenceMessageIds]),
    evidence: [...evidenceMap.values()],
    details: [...detailMap.values()],
    keyDialogues: [...dialogueMap.values()],
  };
}

// Source-order subqueries use CROSS JOIN to keep the small evidence list first.
// Otherwise SQLite can scan every message in the chat for each memory instead
// of looking up each evidence message by its (chat_id,message_id) primary key.
function renderLandmarks(db: RcmDatabase, chatId: string, perspective: string, profile: RpProfile, tokenBudget: number, coverage?: PromptCoverage): string {
  if (tokenBudget <= 0) return "";
  const rows = db.prepare(`
    SELECT * FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()} AND landmark=1
    ORDER BY COALESCE((SELECT MAX(msg.ordinal) FROM json_each(memories.evidence_json) ev CROSS JOIN messages msg ON msg.chat_id=memories.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')),created_revision) DESC LIMIT 80
  `).all(chatId) as MemoryRow[];
  const visible = rows.filter((row) => allowedByPerspective(row, profile, perspective) && !isFullyPromptCovered(row.evidence_json, coverage)).slice(0, 2).reverse();
  const accepted: string[] = [];
  for (const row of visible) {
    const storyTime = row.story_time ? ` time="${escapeXml(row.story_time)}"` : "";
    const locations = parseList(row.locations_json);
    const location = locations.length ? ` location="${escapeXml(locations.join(", "))}"` : "";
    const kinds = parseLandmarkKinds(row.landmark_kinds_json);
    const kind = kinds.length ? ` kinds="${escapeXml(kinds.map((entry) => entry.kind === "other" ? entry.label ?? "other" : entry.kind).join(", "))}"` : "";
    const line = `<landmark${kind}${storyTime}${location}>${escapeXml(row.title)}: ${escapeXml(safeExcerpt(row.content, 220))}</landmark>`;
    const section = `<landmarks>\n${accepted.concat(line).join("\n")}\n</landmarks>`;
    if (estimateTokens(section) > tokenBudget) break;
    accepted.push(line);
  }
  return accepted.length ? `<landmarks>\n${accepted.join("\n")}\n</landmarks>` : "";
}

type LedgerRelevance = (text: string, sourceId?: string | null) => number;
interface StructuredRender { xml: string; atomKeys: string[]; ids: string[]; hits?: StateEvidenceHit[] }

function renderPhysicalIntimacy(db: RcmDatabase, chatId: string, perspective: string, peers: string[], tokenBudget: number, detailed = false, archiveView = false, excluded = new Set<string>(), signals: SearchQuerySignal[] = [], relevance: LedgerRelevance = (text) => weightedOverlap(signals, text)): StructuredRender {
  if (tokenBudget <= 0) return { xml: "", atomKeys: [], ids: [] };
  type PhysicalRow = { id: string; participant_a: string; participant_b: string; milestone_key: string; act: string; custom_label: string | null; initiator: string | null; interaction_context: string; circumstance: string | null; source_memory_id: string | null; source_start_ordinal: number | null; auto_inject: number; created_at: number; access: ItemAccessScope };
  const siblingRows = db.prepare(`SELECT id,participant_a,participant_b,milestone_key,act FROM physical_intimacy_milestones
    WHERE chat_id=? ORDER BY COALESCE(source_start_ordinal,2147483647),created_at ${detailed ? "" : "LIMIT 128"}`).all(chatId) as Array<Pick<PhysicalRow, "id" | "participant_a" | "participant_b" | "milestone_key" | "act">>;
  const candidates = db.prepare(`SELECT id,participant_a,participant_b,milestone_key,act,custom_label,initiator,interaction_context,circumstance,source_memory_id,source_start_ordinal,auto_inject,created_at
    FROM physical_intimacy_milestones WHERE chat_id=? AND active=1 AND deleted_by_user=0 ORDER BY COALESCE(source_start_ordinal,2147483647),created_at ${detailed ? "" : "LIMIT 64"}`).all(chatId) as Array<Omit<PhysicalRow, "access">>;
  const access = loadItemAccess(db, chatId, candidates.map((row) => ({ kind: "physical_milestone", id: row.id })));
  const hits: StateEvidenceHit[] = [];
  const rows: PhysicalRow[] = candidates.flatMap((row) => {
    const scope = resolveItemAccess(access, "physical_milestone", row.id, [row.participant_a, row.participant_b]);
    if (!visibleTo(scope, perspective, archiveView || perspective === "narrator")) return [];
    if (!detailed && row.auto_inject !== 1) return [];
    if (detailed && signals.length && relevance(`${row.participant_a} ${row.participant_b} ${row.milestone_key.replaceAll("_", " ")} ${row.act} ${row.circumstance ?? ""}`, row.source_memory_id) < 0.2) return [];
    if (row.milestone_key === "first_physical_intimacy" && siblingRows.some((candidate) => candidate.id !== row.id && candidate.participant_a === row.participant_a && candidate.participant_b === row.participant_b && candidate.act === row.act && candidate.milestone_key !== "first_physical_intimacy")) return [];
    const atomKey = detailed ? physicalDetailAtomKey(row) : physicalOccurrenceAtomKey(row);
    hits.push({knownBy: scope.narratorOnly ? [] : itemAccessKnowledge(scope), presentation: `${row.participant_a}, ${row.participant_b}: ${row.act}; ${row.circumstance ?? "Occurred."}`, text:`${row.milestone_key.replaceAll("_", " ")} ${row.act} ${row.circumstance ?? ""}`,atomKey,delivered:false,alreadyPresent:excluded.has(atomKey),section:"physical_intimacy",
      ...(row.source_memory_id ? { sourceId: row.source_memory_id } : {})});
    return excluded.has(atomKey) ? [] : [{ ...row, access: scope }];
  });
  if (rows.length === 0) return { xml: "", atomKeys: [], ids: [], hits };
  const peerNames = new Set(peers.map(normalizeEntityName));
  const preferredRows = peerNames.size >= 2
    ? rows.filter((row) => peerNames.has(normalizeEntityName(row.participant_a)) && peerNames.has(normalizeEntityName(row.participant_b)))
    : [];
  const visibleRows = preferredRows.length > 0 ? preferredRows : rows;
  const groups = new Map<string, typeof visibleRows>();
  for (const row of visibleRows) {
    const key = [normalizeEntityName(row.participant_a), normalizeEntityName(row.participant_b)].sort().join("\0");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const rendered: Array<{ xml: string; rows: PhysicalRow[] }> = [...groups.values()].slice(0, 2).map((group) => {
    const first = group[0]!;
    if (!detailed) {
      const firsts = [...new Set(group.map((row) => intimacyMilestonePacketType(row.milestone_key)))];
      const acts = [...new Set(group.map(row => row.act))];
      const actAttribute = acts.join(", ") === firsts.join(", ") ? "" : ` acts="${escapeXml(acts.join(", "))}"`;
      return { rows: group, xml: `- ${escapeXml(first.participant_a)} and ${escapeXml(first.participant_b)} have shared: ${escapeXml(acts.map(act => act === "other" ? "physical intimacy" : act.replaceAll("_", " ")).join(", "))}. Past occurrence does not establish current consent.` };
    }
    const milestoneGroups = new Map<string, typeof group>();
    for (const row of group) {
      const key = JSON.stringify([row.source_memory_id ?? row.id, row.source_start_ordinal, row.act, row.circumstance, row.interaction_context, row.initiator, row.access]);
      const same = milestoneGroups.get(key) ?? []; same.push(row); milestoneGroups.set(key, same);
    }
    const milestones = [...milestoneGroups.values()].map((same) => {
      const row = same[0]!;
      const accessAttrs = row.access.narratorOnly ? ` narrator_only="true"` : ` known_by="${escapeXml(knownByLabels(db,chatId,"physical_milestone",row.id,itemAccessKnowledge(row.access)).join(", "))}"`;
      const type = same.map(item => intimacyMilestonePacketType(item.milestone_key)).join(", ");
      const act = row.act === "other" ? row.custom_label ?? "other" : row.act;
      const source = "";
      return `<first type="${escapeXml(type)}" act="${escapeXml(act)}" context="${escapeXml(row.interaction_context)}"${row.initiator ? ` initiator="${escapeXml(row.initiator)}"` : ""}${accessAttrs}>${escapeXml(safeExcerpt(row.circumstance ?? "Occurred.", 320))}${source}</first>`;
    });
    return { rows: group, xml: `<pair participants="${escapeXml(first.participant_a)} | ${escapeXml(first.participant_b)}">\n${milestones.join("\n")}\n</pair>` };
  });
  while (rendered.length && estimateTokens(`<physical_intimacy occurrence_only="true">\n${rendered.map((item) => item.xml).join("\n")}\n</physical_intimacy>`) > tokenBudget) rendered.pop();
  const kept = rendered.flatMap((item) => item.rows);
  const delivered = new Set(kept.map((row) => detailed ? physicalDetailAtomKey(row) : physicalOccurrenceAtomKey(row)));
  for (const hit of hits) hit.delivered = delivered.has(hit.atomKey);
  return kept.length ? {
    hits,
    xml: `<physical_intimacy occurrence_only="true">\n${rendered.map((item) => item.xml).join("\n")}\n</physical_intimacy>`,
    atomKeys: kept.map((row) => detailed ? physicalDetailAtomKey(row) : physicalOccurrenceAtomKey(row)),
    ids: kept.map((row) => row.id),
  } : { xml: "", atomKeys: [], ids: [], hits };
}

function renderRelationshipLandmarks(
  db: RcmDatabase,
  chatId: string,
  perspective: string,
  peers: string[],
  profile: RpProfile,
  tokenBudget: number,
  coverage: PromptCoverage | undefined,
  detailed = false,
  excluded = new Set<string>(),
  signals: SearchQuerySignal[] = [],
  relevance: LedgerRelevance = (text) => weightedOverlap(signals, text),
): StructuredRender {
  if (tokenBudget <= 0) return { xml: "", atomKeys: [], ids: [] };
  const rows = db.prepare(`SELECT * FROM memories WHERE chat_id=? AND active=1 AND landmark_kinds_json<>'[]' AND ${searchableMemoryParentSql()} ORDER BY created_revision DESC LIMIT 80`).all(chatId) as MemoryRow[];
  const peerNames = new Set(peers.map(normalizeEntityName));
  const hits: StateEvidenceHit[] = [];
  const events = rows.flatMap((row) => {
    if (!allowedByPerspective(row, profile, perspective)) return [];
    return parseStoredLandmarkKinds(row.landmark_kinds_json).flatMap((landmark, index) => {
      if (!landmark.pair) return [];
      if (detailed ? !RELATIONSHIP_LANDMARK_KINDS.has(landmark.kind) && landmark.kind !== "confession" : !landmarkAlwaysInjected(landmark)) return [];
      if (detailed && signals.length && relevance(`${row.title} ${row.content} ${landmark.kind.replaceAll("_", " ")} ${landmark.pair.join(" ")}`, row.id) < 0.2) return [];
      const evidence = landmark.evidence?.length ? landmark.evidence : parseEvidence(row.evidence_json);
      if (!detailed && isFullyPromptCovered(JSON.stringify(evidence), coverage)) return [];
      const atomKey = relationshipLandmarkAtomKey(row.id, index, landmark);
      hits.push({ knownBy: parseList(row.known_by_json), presentation: `${landmark.pair.join(", ")}: ${landmark.kind.replaceAll("_", " ")}; ${row.story_time ?? ""}`, text: `${row.title} ${row.content} ${landmark.kind.replaceAll("_", " ")} ${landmark.pair.join(" ")}`,
        atomKey, delivered: false, alreadyPresent: excluded.has(atomKey), section: "relationship_landmarks", sourceId: row.id });
      if (excluded.has(atomKey)) return [];
      const exactPair = peerNames.size >= 2 && landmark.pair.every((name) => peerNames.has(normalizeEntityName(name)));
      return [{ row, landmark, index, atomKey, exactPair }];
    });
  }).sort((left, right) => Number(right.exactPair) - Number(left.exactPair) || right.row.created_revision - left.row.created_revision);
  const groups = new Map<string, typeof events>();
  for (const event of events) {
    const key = event.landmark.pair!.map(normalizeEntityName).sort().join("\0");
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const pairXml: Array<{ xml: string; events: typeof events }> = [...groups.values()].slice(0, 2).map((group) => {
    const pair = group[0]!.landmark.pair!;
    const lines = group.map(({ row, landmark }) => {
      const date = landmark.storyTime ?? row.story_time;
      const source = "";
      const label = landmark.kind === "other" && landmark.label ? ` label="${escapeXml(landmark.label)}"` : "";
      const known = detailed ? ` known_by="${escapeXml(parseList(row.known_by_json).join(", "))}"` : "";
      return `- ${escapeXml(landmark.label || landmark.kind.replaceAll("_", " "))}${date ? `: ${escapeXml(date)}` : " (date not recorded)"}${detailed ? ` [Known by ${escapeXml(parseList(row.known_by_json).join(", "))}]` : ""}`;
    });
    return { events: group, xml: `<pair participants="${escapeXml(pair[0])} | ${escapeXml(pair[1])}">\n${lines.join("\n")}\n</pair>` };
  });
  while (pairXml.length && estimateTokens(`<relationship_landmarks>\n${pairXml.map((item) => item.xml).join("\n")}\n</relationship_landmarks>`) > tokenBudget) pairXml.pop();
  const kept = pairXml.flatMap((item) => item.events);
  const delivered = new Set(kept.map((item) => item.atomKey));
  for (const hit of hits) hit.delivered = delivered.has(hit.atomKey);
  return kept.length ? {
    hits,
    xml: `<relationship_landmarks>\n${pairXml.map((item) => item.xml).join("\n")}\n</relationship_landmarks>`,
    atomKeys: kept.map((item) => item.atomKey),
    ids: kept.map((item) => item.row.id),
  } : { xml: "", atomKeys: [], ids: [], hits };
}

function renderLatestContinuity(db: RcmDatabase, chatId: string, perspective: string, profile: RpProfile, tokenBudget: number, coverage?: PromptCoverage): string {
  if (tokenBudget <= 0) return "";
  const rows = db.prepare(`SELECT memories.*,
    COALESCE((SELECT MAX(msg.ordinal) FROM json_each(memories.evidence_json) ev CROSS JOIN messages msg ON msg.chat_id=memories.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')),memories.created_revision) AS source_ordinal
    FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()} AND type='episode'
    ORDER BY source_ordinal DESC LIMIT 40`).all(chatId) as MemoryRow[];
  const latest = rows.find((row) => allowedByPerspective(row, profile, perspective) && !isFullyPromptCovered(row.evidence_json, coverage));
  if (!latest) return "";
  const story = latest.story_time ? ` time="${escapeXml(latest.story_time)}"` : "";
  const locations = parseList(latest.locations_json);
  const location = locations.length ? ` location="${escapeXml(locations.join(", "))}"` : "";
  const line = `<latest_past_episode${story}${location}>${escapeXml(latest.title)}: ${escapeXml(safeExcerpt(latest.content, 320))}</latest_past_episode>`;
  return estimateTokens(line) <= tokenBudget ? line : "";
}

function renderOpenThreads(db: RcmDatabase, chatId: string, perspective: string, tokenBudget: number, manifest = emptyPacketManifest()): string {
  if (tokenBudget <= 0) return "";
  const candidates = db.prepare("SELECT id,promisor,promisee,content,scheduled_for AS scheduledFor FROM promises WHERE chat_id=? AND status='open' ORDER BY updated_revision DESC LIMIT 16")
    .all(chatId) as Array<{ id: string; promisor: string; promisee: string; content: string; scheduledFor: string | null }>;
  const access = loadItemAccess(db, chatId, candidates.map((row) => ({ kind: "promise", id: row.id })));
  const promises = candidates.filter((row) => visibleTo(resolveItemAccess(access, "promise", row.id, [row.promisor, row.promisee]), perspective, perspective === "narrator")).slice(0, 3);
  const lines = promises.map((item) => `<open_commitment promisor="${escapeXml(item.promisor)}" promisee="${escapeXml(item.promisee)}"${item.scheduledFor ? ` scheduled_for="${escapeXml(item.scheduledFor)}"` : ""}>${escapeXml(safeExcerpt(item.content, 220))}</open_commitment>`);
  while (lines.length && estimateTokens(`<open_threads>\n${lines.join("\n")}\n</open_threads>`) > tokenBudget) lines.pop();
  manifest.promiseIds.push(...promises.slice(0, lines.length).map((item) => item.id));
  return lines.length ? `<open_threads>\n${lines.join("\n")}\n</open_threads>` : "";
}

function intentCandidateIds(db: RcmDatabase, chatId: string, intent: RecallIntent): string[] {
  const directTypes: Partial<Record<RecallIntent, string[]>> = {
    relationship: ["relationship"],
    promise: ["promise", "foreshadowing"],
    world_state: ["world_state", "belief"],
  };
  const ids = new Set<string>();
  const types = directTypes[intent] ?? [];
  if (types.length > 0) {
    const placeholders = types.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT id FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()} AND type IN (${placeholders})
      ORDER BY pinned DESC,salience DESC,created_revision DESC LIMIT 160
    `).all(chatId, ...types) as Array<{ id: string }>;
    rows.forEach((row) => ids.add(row.id));
  }
  if (intent === "relationship") {
    const rows = db.prepare(`
      SELECT source_memory_id AS id FROM relationship_events
      WHERE chat_id=? AND active=1 AND source_memory_id IS NOT NULL
      ORDER BY created_revision DESC LIMIT 120
    `).all(chatId) as Array<{ id: string }>;
    rows.forEach((row) => ids.add(row.id));
  }
  if (intent === "promise") {
    const rows = db.prepare(`
      SELECT source_memory_id AS id FROM promises
      WHERE chat_id=? AND source_memory_id IS NOT NULL
      ORDER BY updated_revision DESC LIMIT 120
    `).all(chatId) as Array<{ id: string }>;
    rows.forEach((row) => ids.add(row.id));
  }
  if (intent === "world_state") {
    const rows = db.prepare(`
      SELECT source_memory_id AS id FROM assertions
      WHERE chat_id=? AND valid_to_revision IS NULL AND source_memory_id IS NOT NULL
      ORDER BY valid_from_revision DESC LIMIT 120
    `).all(chatId) as Array<{ id: string }>;
    rows.forEach((row) => ids.add(row.id));
  }
  if (intent === "evidence") {
    const rows = db.prepare(`
      SELECT id FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()} AND evidence_json<>'[]'
      ORDER BY pinned DESC,salience DESC,created_revision DESC LIMIT 160
    `).all(chatId) as Array<{ id: string }>;
    rows.forEach((row) => ids.add(row.id));
  }
  return [...ids];
}

function intentSignal(intent: RecallIntent, row: MemoryRow, evidence: MemoryEvidence[], evidenceRelevance: number): number {
  if (intent === "relationship") return row.type === "relationship" ? 0.75 : row.type === "promise" ? 0.12 : 0;
  if (intent === "promise") return row.type === "promise" ? 0.8 : row.type === "foreshadowing" ? 0.2 : 0;
  if (intent === "world_state") return row.type === "world_state" ? 0.8 : row.type === "belief" ? 0.7 : 0;
  if (intent === "evidence") return evidence.length > 0 ? Math.min(0.5, 0.1 + evidenceRelevance * 0.55) : 0;
  return 0;
}

interface StateEvidenceHit { presentation?: string; knownBy?: string[]; text: string; atomKey: string; delivered: boolean; alreadyPresent: boolean; section?: string; sourceId?: string }

function stableAnchors(
  db: RcmDatabase, chatId: string, perspective: string, profile: RpProfile,
  tokenBudget: number, intent: RecallIntent, signals: SearchQuerySignal[],
  coverage?: PromptCoverage, answerOnly = false, activePerspectives: string[] = [],
  archiveView = false, manifest = emptyPacketManifest(), excluded: ReadonlySet<string> = new Set(),
  stateHits: StateEvidenceHit[] = [], relevance?: LedgerRelevance, semantic?: Map<string, number>, trace?: StateOutcomeCapture,
): string {
  const candidates = selectStateEvidence(collectStateEvidence(db, chatId, trace, perspective), signals.map(signal => signal.text).join("\n"), {
    trace, perspective, archive: archiveView, continuity: !answerOnly, history: answerOnly || intent === "promise" || intent === "relationship", activeNames: activePerspectives, semantic,
  });
  const lines: string[] = [];
  for (const [index, item] of candidates.entries()) {
    const rank = index + 1;
    if (!answerOnly && intent === "world_state" && item.kind === "belief") { trace?.record(perspective, item, "not_current", { reason: "world_state_excludes_belief", rank }); continue; }
    const evidence = stateMcpEvidence(item);
    const hit: StateEvidenceHit = { text: item.text, presentation: evidence.text, knownBy: item.holders,
      atomKey: evidence.atomKey, delivered: false, alreadyPresent: excluded.has(evidence.atomKey), section: "recorded_state" };
    stateHits.push(hit);
    if (hit.alreadyPresent || item.sourceIds.length && item.sourceIds.every(id => coverage?.covered.has(id))) {
      trace?.record(perspective, item, "prompt_covered", { rank, ...(hit.alreadyPresent ? { reason: "excluded_atom" } : {}) }); continue;
    }
    const line = renderStateLine(item);
    if (estimateTokens(lines.concat(line).join("\n")) > tokenBudget) { trace?.record(perspective, item, "budget", { rank }); continue; }
    trace?.record(perspective, item, "delivered", { rank });
    trace?.emitted(perspective, item.id, line);
    lines.push(line); hit.delivered = true; manifest.atomKeys.push(hit.atomKey); manifest.stateEvidenceIds.push(item.id);
    const id = item.id.slice(item.kind.length + 1);
    if (["world_fact", "basic_relation"].includes(item.kind)) manifest.assertionIds.push(id);
    if (item.kind === "belief") manifest.beliefIds.push(id);
    if (item.kind === "promise") manifest.promiseIds.push(id);
    if (item.relationship) manifest.relationshipPairs.push(item.relationship);
  }
  trace?.budget(perspective, tokenBudget, estimateTokens(lines.join("\n")));
  return lines.length ? `<recorded_state as_of="last_processed_history">\n${lines.join("\n")}\n</recorded_state>` : "";
}

function lexicalCandidates(db: RcmDatabase, chatId: string, signals: SearchQuerySignal[], language: MemoryLanguage): LexicalSearchResult {
  const peak = new Map<string, number>();
  const consensus = new Map<string, number>();
  const detailHits = new Map<string, SemanticMemoryHit>();
  const atomHits: SemanticMemoryHit[] = [];
  const views: LexicalSearchResult["views"] = [];
  const searchableSignals = signals.filter((signal) => signal.kind !== "continuation" && signal.weight > 0);
  const totalWeight = Math.max(0.0001, searchableSignals.reduce((sum, signal) => sum + Math.max(0, signal.weight), 0));
  const maximumWeight = Math.max(0, ...searchableSignals.map((signal) => signal.weight));
  for (const signal of searchableSignals) {
    const tokenWeights = discriminativeSearchTokenWeights(db, chatId, signal.text, language);
    const tokens = [...tokenWeights.keys()];
    if (tokens.length === 0) continue;
    const ftsQuery = tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
    try {
      const rows = db.prepare(`
        SELECT memory_id, title, content, participants, bm25(memory_fts) AS rank FROM memory_fts
        WHERE memory_fts MATCH ? AND chat_id=? ORDER BY rank LIMIT 80
      `).all(ftsQuery, chatId) as Array<{ memory_id: string; title: string; content: string; participants: string }>;
      const local = new Map<string, number>();
      const matches: LexicalSearchResult["views"][number]["matches"] = new Map();
      const bestDetail = new Map<string, number>();
      const totalTokenWeight = [...tokenWeights.values()].reduce((sum, weight) => sum + weight, 0);
      const coverage = (text: string): { score: number; matched: string[] } => {
        const present = documentSearchTokens(text, language);
        const matched = tokens.filter(token => present.has(token));
        const mass = matched.reduce((sum, token) => sum + tokenWeights.get(token)!, 0);
        return { score: totalTokenWeight > 0 ? Math.min(1, mass / totalTokenWeight) : 0, matched };
      };
      const record = (memoryId: string, score: number, kind: "memory" | "memory_detail", sourceId: string): void => {
        local.set(memoryId, Math.max(local.get(memoryId) ?? 0, score));
        if (kind === "memory_detail" && score > (detailHits.get(memoryId)?.score ?? -1)) {
          detailHits.set(memoryId, { memoryId, score, kind, sourceId });
        }
      };
      rows.forEach((row) => {
        const { score, matched } = coverage(`${row.title} ${row.content} ${row.participants}`);
        record(row.memory_id, score, "memory", row.memory_id);
        matches.set(row.memory_id, { memory: matched, detail: [] });
      });
      const details = db.prepare(`SELECT detail_id AS id,memory_id,text,participants,locations,bm25(memory_detail_fts) AS rank FROM memory_detail_fts
        WHERE memory_detail_fts MATCH ? AND chat_id=? ORDER BY rank LIMIT 120`).all(ftsQuery, chatId) as Array<{ id: string; memory_id: string; text: string; participants: string; locations: string }>;
      details.forEach((row) => {
        const { score, matched } = coverage(`${row.text} ${row.participants} ${row.locations}`);
        record(row.memory_id, score, "memory_detail", row.id);
        if (score > (bestDetail.get(row.memory_id) ?? -1)) {
          bestDetail.set(row.memory_id, score);
          matches.set(row.memory_id, { memory: matches.get(row.memory_id)?.memory ?? [], detail: matched });
        }
        if (signal.kind === "focus" || signal.kind === "cue") atomHits.push({ memoryId: row.memory_id,
          sourceId: row.id, kind: "memory_detail", score, viewIndex: signals.indexOf(signal) });
      });
      views.push({
        signal,
        matches,
        // The tail is useful for recall but too noisy to judge whether the
        // winning row actually explains this query view. Use the strongest
        // IDF-ranked core for provenance-fit without maintaining stop-word or
        // genre vocabulary lists.
        tokens: new Set(tokens.slice(0, Math.min(tokens.length, Math.max(4, Math.ceil(tokens.length * 0.6))))),
        tokenWeights: new Map([...tokenWeights].slice(0, Math.min(tokens.length, Math.max(4, Math.ceil(tokens.length * 0.6))))),
        scores: local,
      });
      const viewReliability = (signal.kind === "scene" ? 0.82 : signal.kind === "cue" ? 1 : 0.94)
        * queryViewAuthority(signal.weight, maximumWeight);
      for (const [memoryId, evidence] of local) {
        peak.set(memoryId, Math.max(peak.get(memoryId) ?? 0, evidence * viewReliability));
        consensus.set(memoryId, (consensus.get(memoryId) ?? 0) + evidence * Math.max(0, signal.weight));
      }
    } catch {
      // Unicode and provider-specific text can produce an invalid FTS query; lexical reranking below remains available.
    }
  }
  const scores = new Map<string, number>();
  for (const memoryId of new Set([...peak.keys(), ...consensus.keys()])) {
    scores.set(memoryId, (peak.get(memoryId) ?? 0) * 0.76 + ((consensus.get(memoryId) ?? 0) / totalWeight) * 0.24);
  }
  return { scores, detailHits: new Map([...detailHits].filter(([memoryId]) => scores.has(memoryId))), atomHits, views };
}

function matchedLexicalTokens(search: LexicalSearchResult, signals: SearchQuerySignal[], memoryId: string): NonNullable<RetrievalCandidateTrace["matchedLexicalTokens"]> {
  return search.views.flatMap(view => {
    const matched = view.matches.get(memoryId);
    return matched ? [{ viewIndex: signals.indexOf(view.signal), ...matched }] : [];
  });
}

function candidateIds(
  db: RcmDatabase,
  chatId: string,
  fts: Map<string, number>,
  semantic: Map<string, number> | undefined,
  seedMemoryId: string | undefined,
  intent: RecallIntent,
  expandGraph: boolean,
): string[] {
  const intentIds = intentCandidateIds(db, chatId, intent);
  const orderedIds = intent === "evidence"
    ? [...fts.keys(), ...(semantic?.keys() ?? []), ...intentIds]
    : [...intentIds, ...fts.keys(), ...(semantic?.keys() ?? [])];
  const ids = new Set<string>(orderedIds);
  if (seedMemoryId) ids.add(seedMemoryId);
  const anchors = db.prepare(`
    SELECT id FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()} AND pinned=1
    UNION
    SELECT id FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()} AND landmark=1
    UNION
    SELECT id FROM (SELECT id FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()} ORDER BY created_revision DESC LIMIT 80)
  `).all(chatId, chatId, chatId) as Array<{ id: string }>;
  anchors.forEach((row) => ids.add(row.id));
  let frontier = [...ids];
  for (let depth = 0; expandGraph && depth < 4 && frontier.length > 0; depth += 1) {
    const limited = frontier.slice(0, 240);
    const placeholders = limited.map(() => "?").join(",");
    const edges = db.prepare(`
      SELECT source_id,target_id FROM memory_edges
      WHERE chat_id=? AND (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
      ORDER BY weight DESC LIMIT 240
    `).all(chatId, ...limited, ...limited) as Array<{ source_id: string; target_id: string }>;
    const next: string[] = [];
    for (const edge of edges) {
      for (const id of [edge.source_id, edge.target_id]) {
        if (!ids.has(id)) {
          ids.add(id);
          next.push(id);
        }
      }
    }
    frontier = next;
  }
  return [...ids].slice(0, 400);
}

export interface RetrieveOptions {
  /** Stored provenance needed by the global automatic portfolio, never a direct-search seed. */
  automaticSupportMemoryIds?: string[];
  memoryOnlyInjection?: boolean;
  /** Load accessible MCP candidates without running packet selection. */
  mcpCandidatesOnly?: boolean;
  chatId: string;
  query: string;
  querySignals?: SearchQuerySignal[];
  perspective: string;
  tokenBudget: number;
  hardTokenCeiling?: number;
  intent?: RecallIntent;
  seedMemoryId?: string;
  semanticScores?: Map<string, number>;
  stateScores?: Map<string, number>;
  semanticHits?: Map<string, SemanticMemoryHit>;
  arcMemoryScores?: Map<string, number>;
  arcDetailScores?: Map<string, number>;
  arcDialogueIds?: Set<string>;
  arcExpansionDiagnostics?: Array<{ arcNodeId: string; semanticScore: number; leafId: string; outcome: string }>;
  semanticViewScores?: Array<Map<string, number>>;
  aspectSemanticScores?: Map<string, Map<string, number>>;
  aspectSemanticHits?: Map<string, Map<string, SemanticMemoryHit>>;
  aspectSemanticAtomHits?: Map<string, Map<string, SemanticMemoryHit[]>>;
  reinforce?: boolean;
  deferReinforcement?: boolean;
  followAllDetails?: boolean;
  promptSourceMessageIds?: string[];
  aspects?: string[];
  excludeMemoryIds?: string[];
  excludeMemorySignatures?: string[];
  alreadyPresentMemoryIds?: string[];
  alreadyPresentAtomKeys?: string[];
  excludeAtomKeys?: string[];
  activePerspectives?: string[];
  collectDiagnostics?: boolean;
  stateOutcomeCapture?: StateOutcomeCapture;
  deferAutomaticBudget?: boolean;
  structuredBudgetScale?: number;
  semanticAtomHits?: Map<string, SemanticMemoryHit[]>;
}

export function automaticMemoryLimit(tokenBudget: number): number {
  return tokenBudget >= 10_000 ? 18 : tokenBudget >= 7_000 ? 12 : tokenBudget >= 5_000 ? 9 : 6;
}

export function automaticHardMemoryLimit(tokenBudget: number): number {
  return automaticMemoryLimit(tokenBudget) + 1;
}

export function automaticHardTokenCeiling(tokenBudget: number): number {
  return Math.floor(tokenBudget * 115 / 100);
}

export interface PerspectivePacketPart {
  name: string;
  data: string;
}

function projectAtomMemory(
  item: MemoryContextItem,
  details: MemoryContextItem["details"],
  keyDialogues: MemoryContextItem["keyDialogues"],
): MemoryContextItem {
  return {
    ...item,
    title: "",
    content: "",
    participants: [...new Set(details.flatMap((detail) => detail.participants))],
    knownBy: [...new Set([...details.flatMap((detail) => detail.knownBy), ...keyDialogues.flatMap((dialogue) => dialogue.knownBy)])],
    evidenceMessageIds: [],
    evidence: [],
    details,
    keyDialogues,
  };
}

function partitionTurnMemories(memories: MemoryContextItem[], activePerspectives: string[]): {
  shared: MemoryContextItem[];
  scoped: Map<string, MemoryContextItem[]>;
} {
  const active = [...new Map(activePerspectives
    .filter((name) => name && !["shared", "__shared__", "narrator", "omniscient narrator"].includes(name.toLocaleLowerCase()))
    .map((name) => [normalizeEntityName(name), name])).values()];
  const shared: MemoryContextItem[] = [];
  const scoped = new Map(active.map((name) => [name, [] as MemoryContextItem[]]));
  const viewersFor = (knownBy: string[]): string[] => active.filter((name) => knownBy.includes(EVERYONE_HOLDER) || knownBy.some((holder) => normalizeEntityName(holder) === normalizeEntityName(name)));

  for (const item of memories) {
    if (item.atomAccessVersion === 0) {
      if (active.length === 0 || item.knownBy.length === 0) {
        shared.push(item);
        continue;
      }
      const viewers = viewersFor(item.knownBy);
      if (viewers.length === active.length) shared.push(item);
      else for (const viewer of viewers) scoped.get(viewer)!.push(item);
      continue;
    }

    if (active.length === 0) continue;
    const sharedDetails: MemoryContextItem["details"] = [];
    const sharedDialogues: MemoryContextItem["keyDialogues"] = [];
    const scopedAtoms = new Map(active.map((name) => [name, {
      details: [] as MemoryContextItem["details"],
      dialogues: [] as MemoryContextItem["keyDialogues"],
    }]));
    for (const detail of item.details) {
      const viewers = viewersFor(detail.knownBy);
      if (viewers.length === active.length) sharedDetails.push(detail);
      else for (const viewer of viewers) scopedAtoms.get(viewer)!.details.push(detail);
    }
    for (const dialogue of item.keyDialogues) {
      const viewers = viewersFor(dialogue.knownBy);
      if (viewers.length === active.length) sharedDialogues.push(dialogue);
      else for (const viewer of viewers) scopedAtoms.get(viewer)!.dialogues.push(dialogue);
    }
    if (sharedDetails.length || sharedDialogues.length) shared.push(projectAtomMemory(item, sharedDetails, sharedDialogues));
    for (const [viewer, atoms] of scopedAtoms) {
      if (atoms.details.length || atoms.dialogues.length) scoped.get(viewer)!.push(projectAtomMemory(item, atoms.details, atoms.dialogues));
    }
  }
  return { shared, scoped };
}

function renderRelevantNameHints(db: RcmDatabase, chatId: string, memories: MemoryContextItem[]): string {
  const involved = new Set(memories.flatMap((item) => [
    ...item.participants, ...item.knownBy, item.perspective ?? "",
    ...item.keyDialogues.map((dialogue) => dialogue.speaker),
    ...item.details.flatMap((detail) => [...detail.participants, ...detail.knownBy]),
  ]).filter(Boolean).map(normalizeEntityName));
  const rows = listEntities(db, chatId).filter((entity) => entity.displayName !== entity.name
    && [entity.key, entity.name, entity.displayName, ...entity.aliases].some((name) => involved.has(normalizeEntityName(name))));
  if (!rows.length) return "";
  return `<name_hints>\n${rows.slice(0, 12).map((entity) => `<name archive_name="${escapeXml(entity.name)}" preferred_name="${escapeXml(entity.displayName)}" />`).join("\n")}\n</name_hints>`;
}

function cleanEmptyContinuityBlocks(data: string): string {
  return data
    .replace(/<open_threads>\s*<\/open_threads>/g, "")
    .replace(/<continuity_spine>\s*<\/continuity_spine>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function withKnownBy(commitment: string, viewers: string[]): string {
  const withoutKnownBy = commitment.replace(/\s+known_by="[^"]*"/, "");
  return withoutKnownBy.replace("<open_commitment", `<open_commitment known_by="${escapeXml(viewers.join(", "))}"`);
}

function hoistSharedOpenCommitments(combinedPerspectives: Map<string, string>, activeNames: string[]): string {
  if (activeNames.length < 2) return "";
  const perspectiveEntries = new Map<string, [string, string]>();
  for (const activeName of activeNames) {
    const entry = [...combinedPerspectives].find(([name]) => normalizeEntityName(name) === normalizeEntityName(activeName));
    if (entry) perspectiveEntries.set(activeName, entry);
  }
  const commitments = new Map<string, string[]>();
  for (const [activeName, entry] of perspectiveEntries) {
    const matches = [...new Set(entry[1].match(/<open_commitment\b[^>]*>[\s\S]*?<\/open_commitment>/g) ?? [])];
    for (const commitment of matches) commitments.set(commitment, [...(commitments.get(commitment) ?? []), activeName]);
  }
  const shared: string[] = [];
  for (const [commitment, viewers] of commitments) {
    if (viewers.length < 2) continue;
    shared.push(withKnownBy(commitment, viewers));
    for (const viewer of viewers) {
      const entry = perspectiveEntries.get(viewer);
      if (!entry) continue;
      combinedPerspectives.set(entry[0], cleanEmptyContinuityBlocks((combinedPerspectives.get(entry[0]) ?? "").split(commitment).join("")));
    }
  }
  return shared.length ? `<continuity_spine>\n<open_threads>\n${shared.join("\n")}\n</open_threads>\n</continuity_spine>` : "";
}

/** Processing positions are diagnostics, not story dates or character knowledge. */
export function processedHistoryCoverage(db: RcmDatabase, chatId: string): { processedThrough: number | null; latestProcessed: number | null } {
  const processing = db.prepare("SELECT ordinal,extraction_state FROM messages WHERE chat_id=? AND lifecycle='committed' ORDER BY ordinal").all(chatId) as Array<{ ordinal: number; extraction_state: string }>;
  const complete = new Set(["done", "encapsulated", "skipped_policy"]);
  let processedThrough: number | null = null;
  for (const row of processing) { if (!complete.has(row.extraction_state)) break; processedThrough = row.ordinal; }
  return { processedThrough, latestProcessed: processing.filter(row => complete.has(row.extraction_state)).at(-1)?.ordinal ?? null };
}

export function consolidateMemoryPacket(
  db: RcmDatabase,
  chatId: string,
  buffered: boolean,
  perspectives: PerspectivePacketPart[],
  memories: MemoryContextItem[],
  intent: RecallIntent = "recall",
  mode: "context" | "deep_recall" = "context",
  recentMemoryIds: string[] = [],
  activePerspectives: string[] = [],
  storySpine = "",
  manifest?: PacketManifest,
  latestStoryTime?: number,
  sceneNames = "",
  stateTrace?: StateOutcomeCapture,
): string {
  const language = (db.prepare("SELECT memory_language FROM chats WHERE id=?").get(chatId) as { memory_language?: string } | undefined)?.memory_language ?? "en";
  const recalledMap = new Map<string, MemoryContextItem>();
  for (const item of memories) {
    const key = item.signature ?? item.id;
    const existing = recalledMap.get(key);
    recalledMap.set(key, existing ? mergeMemoryContextItems(existing, item) : item);
  }
  const allRecalled = [...recalledMap.values()]
    .sort((left, right) => (left.sourceOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.sourceOrdinal ?? Number.MAX_SAFE_INTEGER)
      || String(left.storyTime ?? "").localeCompare(String(right.storyTime ?? "")) || right.score - left.score);
  if (mode === "deep_recall") {
    const nameHints = renderRelevantNameHints(db, chatId, allRecalled);
    const recalled = allRecalled.map((item) => renderArchiveMemoryItem(item, intent)).filter(Boolean).join("\n");
    const directState = perspectives.map((item) => item.data.trim()).filter(Boolean).join("\n");
    const body = [
      `<archive lang="${escapeXml(language)}">`,
      nameHints,
      directState ? `<directly_requested_state>\n${directState}\n</directly_requested_state>` : "",
      recalled ? `<memories>\n${recalled}\n</memories>` : "",
      `</archive>`,
    ].filter(Boolean).join("\n");
    return recalled || directState ? body : "";
  }
  const inferredPerspectives = activePerspectives.length ? activePerspectives : perspectives.map((item) => item.name);
  const partitioned = partitionTurnMemories(allRecalled, inferredPerspectives);
  if (manifest) for (const item of [...partitioned.shared, ...[...partitioned.scoped.values()].flat()]) {
    if (!renderMemoryItem(item, intent)) continue;
    manifest.memoryIds.push(item.id);
    if (item.atomAccessVersion > 0 || item.details.length > 0 || item.keyDialogues.length > 0 || !["deja_vu", "fragment"].includes(item.detail)) {
      manifest.atomKeys.push(...memoryAtomKeys(item));
      manifest.detailIds.push(...item.details.map((detail) => detail.id));
    }
  }
  const nameHints = renderRelevantNameHints(db, chatId, [...partitioned.shared, ...[...partitioned.scoped.values()].flat()]);
  const perspectiveData = new Map<string, string[]>();
  const appendPerspective = (name: string, data: string): void => {
    if (!data.trim()) return;
    perspectiveData.set(name, [...(perspectiveData.get(name) ?? []), data.trim()]);
  };
  for (const perspective of perspectives) appendPerspective(perspective.name, perspective.data);
  const combinedPerspectives = new Map([...perspectiveData].map(([name, data]) => [name, data.join("\n")]));
  const activeNames = [...new Map(inferredPerspectives
    .filter((name) => name && !["shared", "__shared__", "narrator", "omniscient narrator"].includes(name.toLocaleLowerCase()))
    .map((name) => [normalizeEntityName(name), name])).values()];
  const hoistCommonBlock = (pattern: RegExp): string => {
    if (activeNames.length === 0) return "";
    const entries = activeNames.map((activeName) => [...combinedPerspectives]
      .find(([name]) => normalizeEntityName(name) === normalizeEntityName(activeName)));
    if (entries.some((entry) => !entry)) return "";
    const matches = entries.map((entry) => entry![1].match(pattern)?.[0]?.trim() ?? "");
    if (!matches[0] || matches.some((match) => match !== matches[0])) return "";
    for (const [name, data] of entries as Array<[string, string]>) combinedPerspectives.set(name, data.replace(matches[0]!, "").trim());
    return matches[0]!;
  };
  const sharedSpine = hoistSharedOpenCommitments(combinedPerspectives, activeNames);
  const sharedPhysical = hoistCommonBlock(/<physical_intimacy\b[\s\S]*?<\/physical_intimacy>/);
  const sharedLandmarks = hoistCommonBlock(/<relationship_landmarks\b[\s\S]*?<\/relationship_landmarks>/);
  // Parse only renderer-owned envelopes. Each anchor line already carries its
  // own knowledge scope. Deduplication never inherits the viewing perspective.
  const anchors = new Set<string>();
  for (const [name, data] of combinedPerspectives) {
    combinedPerspectives.set(name, data.replace(/<recorded_state as_of="last_processed_history">\n([\s\S]*?)\n<\/recorded_state>/g, (_block, lines: string) => {
      for (const line of lines.split("\n")) if (line.trim()) {
        stateTrace?.assembled(name, line, anchors.has(line));
        anchors.add(line);
      }
      return "";
    }).trim());
  }
  const sections = [...combinedPerspectives].filter(([, data]) => data).map(([name, data]) =>
    `<recorded_state perspective="${escapeXml(name)}">\n${data}\n</recorded_state>`);
  const sharedAnchors = anchors.size ? `<recorded_state>\n${[...anchors].join("\n")}\n</recorded_state>` : "";
  const state = [sharedAnchors, sharedSpine, sharedPhysical, sharedLandmarks, ...sections].filter(Boolean).join("\n");
  const history = [storySpine, allRecalled.map(item => renderMemoryScene(projectMemoryScene(item), latestStoryTime)).filter(Boolean).join("\n")].filter(Boolean).join("\n");
  const payload = [sceneNames, nameHints,
    history ? `<past_records>\n${history}\n</past_records>` : "",
    state ? `<current_state>\nFrom processed history; newer explicit events take precedence.\n${state}\n</current_state>` : "",
  ].filter(Boolean);
  if (payload.length === 0) return "";
  const body = [
    memoryGuidanceBlock,
    ...payload,
  ].filter(Boolean).join("\n");
  return body ? `<rp_memory_context>\n${body}\n</rp_memory_context>` : "";
}

export function resolvePerspective(db: RcmDatabase, chatId: string, value: string): string {
  const raw = value.trim();
  const normalized = raw.toLocaleLowerCase().replace(/[\s_-]+/g, " ");
  if (!raw || normalized === "narrator" || normalized === "omniscient" || normalized === "omniscient narrator") return "narrator";
  const rows = db.prepare(`
    SELECT e.entity_key,e.name,e.display_name,a.alias
    FROM entities e LEFT JOIN aliases a ON a.entity_id=e.id
    WHERE e.chat_id=?
  `).all(chatId) as Array<{ entity_key: string; name: string; display_name: string; alias: string | null }>;
  for (const row of rows) {
    const candidates = [row.entity_key, row.name, row.display_name, row.alias ?? ""]
      .map((candidate) => candidate.toLocaleLowerCase().replace(/[\s_-]+/g, " "));
    // Identity-bearing ledger rows store canonical display names. Returning the
    // internal key here makes multi-word names (for example `Alex Morgan` and
    // `alex_morgan`) fail the perspective boundary and anchor SQL checks.
    if (candidates.includes(normalized)) return row.name;
  }
  return raw;
}

export function retrieve(db: RcmDatabase, options: RetrieveOptions): {
  packet: string;
  stableAnchors: string;
  perspectiveData: string;
  estimatedTokens: number;
  selected: MemoryContextItem[];
  eligibleCandidates: MemoryContextItem[];
  mcpSearchEnvelopes?: Map<string, string>;
  mcpFollowableMemoryIds?: string[];
  automaticAtomPriorities?: Record<string, AutomaticAtomPriority>;
  automaticPortfolioCandidates?: Map<string, AutomaticPortfolioCandidate>;
  automaticAssociationSources?: Record<string, string>;
  directAtomKeys: string[];
  structuredManifest: PacketManifest;
  coverage: RecallCoverageItem[];
  answers?: import("@rcm/shared").McpQuestionAnswer[];
  alreadyProvidedIds: string[];
  recentMemoryIds: string[];
  focusLeaderIds: string[];
  continuityBridgeIds: string[];
  selectedCandidateClasses: Record<string, RetrievalCandidateClass>;
  selectedRoles: Record<string, RetrievalSelectionRole>;
  activationObservations: AutomaticActivationObservation[];
  deliveredAtomKeys: string[];
  deliveredSourceRanges?: import("@rcm/shared").McpSourceRange[];
  diagnostics?: RetrievalDiagnostics;
} {
  const started = performance.now();
  invalidateChangedMemoryGroups(db, options.chatId);
  const chat = db.prepare("SELECT profile,revision,memory_language,completed_turn_count FROM chats WHERE id=?").get(options.chatId) as
    | { profile: RpProfile; revision: number; memory_language: MemoryLanguage; completed_turn_count: number }
    | undefined;
  const aspects = options.aspects?.length ? options.aspects : [options.query];
  if (!chat || options.tokenBudget <= 0) return { packet: "", stableAnchors: "", perspectiveData: "", estimatedTokens: 0, selected: [], eligibleCandidates: [], directAtomKeys: [], structuredManifest: emptyPacketManifest(), coverage: aspects.map((aspect) => ({ aspect, status: "no_grounded_hit" })), alreadyProvidedIds: [], recentMemoryIds: [], focusLeaderIds: [], continuityBridgeIds: [], selectedCandidateClasses: {}, selectedRoles: {}, activationObservations: [], deliveredAtomKeys: [] };
  const requestedPerspective = options.perspective.trim().toLocaleLowerCase().replace(/[\s_-]+/g, " ");
  const omniscient = requestedPerspective === "omniscient" || requestedPerspective === "omniscient narrator";
  const perspective = resolvePerspective(db, options.chatId, options.perspective);
  const entities = listEntities(db, options.chatId);
  const coveredIds = new Set(options.promptSourceMessageIds ?? []);
  const activeIds = coveredIds.size === 0 ? new Set<string>() : new Set((db.prepare(`
    SELECT message_id FROM messages WHERE chat_id=? AND lifecycle='committed' AND host_visibility IN ('active','all_before') AND content IS NOT NULL
  `).all(options.chatId) as Array<{ message_id: string }>).map((row) => row.message_id));
  const coverage = coveredIds.size ? { covered: coveredIds, active: activeIds } : undefined;
  const signals = options.querySignals?.length
    ? options.querySignals
    : [{ kind: "focus" as const, text: options.query, weight: 1 }];
  const searchableSignals = signals.filter((signal) => signal.kind !== "continuation" && signal.weight > 0);
  const maximumSignalWeight = Math.max(0, ...searchableSignals.map((signal) => signal.weight));
  const discriminativeSignals = searchableSignals.map((signal) => ({
    tokens: discriminativeSearchTokenWeights(db, options.chatId, signal.text, chat.memory_language),
    weight: signal.weight,
  }));
  // Coverage must retain unseen query concepts. IDF-ranked retrieval tokens
  // intentionally discard terms absent from the archive, but doing that here
  // can reduce an unanswered question to a character name and falsely report
  // an adjacent memory as grounded.
  const searchTokens = (text: string): Set<string> => new Set(normalizeSearchTokens(text, chat.memory_language));
  const sceneTokens = searchTokens(options.query);
  const aspectTokens = new Map(aspects.map((aspect) => [aspect, searchTokens(aspect)]));
  const intent = options.intent ?? "recall";
  const mcpAnswerMode = options.reinforce === true;
  const excludedAtomKeys = new Set([...(options.alreadyPresentAtomKeys ?? []), ...(options.excludeAtomKeys ?? [])]);
  const archiveView = mcpAnswerMode && omniscient;
  const physicalMcpAnswer = mcpAnswerMode;
  const structuredMcpAnswer = mcpAnswerMode;
  const lexicalSearch = options.mcpCandidatesOnly && options.seedMemoryId
    ? { scores: new Map<string, number>(), detailHits: new Map<string, SemanticMemoryHit>(), atomHits: [], views: [] }
    : lexicalCandidates(db, options.chatId, signals, chat.memory_language);
  const fts = lexicalSearch.scores;
  const aspectLexicalHits = new Map<string, Map<string, SemanticMemoryHit>>();
  const aspectSemanticEvidence = new Map(aspects.map((aspect) => [aspect, relativeViewEvidence(options.aspectSemanticScores?.get(aspect))]));
  if (mcpAnswerMode && !options.seedMemoryId) {
    // Each MCP aspect is an independent lexical view as well as an embedding
    // view. The full request is already searched above; repeating it before a
    // short facet would erase the distinction between the requested facets.
    for (const aspect of aspects) {
      const aspectSearch = lexicalCandidates(db, options.chatId, [{
        kind: "cue",
        text: aspect,
        weight: 1,
      }], chat.memory_language);
      aspectLexicalHits.set(aspect, aspectSearch.detailHits);
      for (const [id, score] of aspectSearch.scores) fts.set(id, Math.max(fts.get(id) ?? 0, score));
    }
  }
  const semanticCandidateScores = new Map(options.semanticScores ?? []);
  for (const [id, score] of options.arcMemoryScores ?? []) {
    semanticCandidateScores.set(id, Math.max(semanticCandidateScores.get(id) ?? 0, score));
  }
  for (const scores of options.aspectSemanticScores?.values() ?? []) for (const [id, score] of scores) {
    semanticCandidateScores.set(id, Math.max(semanticCandidateScores.get(id) ?? 0, score));
  }
  const candidates = options.mcpCandidatesOnly && options.seedMemoryId ? [options.seedMemoryId] : candidateIds(db, options.chatId, fts, semanticCandidateScores, options.seedMemoryId, intent, mcpAnswerMode);
  const directCandidateIds = new Set(candidates);
  const pathSnapshot = !mcpAnswerMode ? searchStoredAtomPaths(db, {
    chatId: options.chatId, perspective,
    roots: proposeAtomPathRoots(signals, [...(options.semanticAtomHits?.values() ?? [])].flat(), lexicalSearch.atomHits),
    excludedMemoryIds: options.excludeMemoryIds,
    excludedMemorySignatures: options.excludeMemorySignatures,
    excludedAtomKeys: [...excludedAtomKeys],
    promptSourceMessageIds: options.promptSourceMessageIds,
  }) : undefined;
  const pathNodes = new Map(pathSnapshot?.nodes.map(node => [node.id, node]) ?? []);
  const pathsByMemory = new Map<string, AtomPath[]>();
  for (const path of pathSnapshot?.paths ?? []) {
    const target = pathNodes.get(path.atomIds.at(-1)!);
    if (!target) continue;
    const paths = pathsByMemory.get(target.memoryId) ?? [];
    paths.push(path); pathsByMemory.set(target.memoryId, paths);
    if (!candidates.includes(target.memoryId)) candidates.push(target.memoryId);
  }
  const promptBoundary = coverage ? (db.prepare(`SELECT MIN(ordinal) AS ordinal FROM messages WHERE chat_id=? AND message_id IN (${[...coveredIds].map(() => "?").join(",")})`)
    .get(options.chatId, ...coveredIds) as { ordinal: number | null } | undefined)?.ordinal ?? null : null;
  const bridgeCandidateIds = !mcpAnswerMode && intent === "recall" && promptBoundary !== null
    ? (db.prepare(`SELECT memories.id,
        COALESCE((SELECT MAX(msg.ordinal) FROM json_each(memories.evidence_json) ev CROSS JOIN messages msg ON msg.chat_id=memories.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')),memories.created_revision) AS source_ordinal
        FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()} AND type='episode'
        AND COALESCE((SELECT MAX(msg.ordinal) FROM json_each(memories.evidence_json) ev CROSS JOIN messages msg ON msg.chat_id=memories.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')),memories.created_revision) < ?
        ORDER BY source_ordinal DESC LIMIT 12`).all(options.chatId, promptBoundary) as Array<{ id: string; source_ordinal: number }>).map((row) => row.id)
    : [];
  for (const id of bridgeCandidateIds) {
    directCandidateIds.add(id);
    if (!candidates.includes(id)) candidates.push(id);
  }
  if (intent === "recall") {
    const latestEpisodeIds = db.prepare(`SELECT id FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()} AND type='episode'
      ORDER BY COALESCE((SELECT MAX(msg.ordinal) FROM json_each(memories.evidence_json) ev CROSS JOIN messages msg ON msg.chat_id=memories.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')),created_revision) DESC LIMIT 16`)
      .all(options.chatId) as Array<{ id: string }>;
    for (const row of latestEpisodeIds) {
      directCandidateIds.add(row.id);
      if (!candidates.includes(row.id)) candidates.push(row.id);
    }
  }
  const excludedIds = new Set(options.excludeMemoryIds ?? []);
  if (options.deferAutomaticBudget && !mcpAnswerMode) {
    // People are structured participants, not words inferred from RP prose.
    // Bound expensive atom materialization; provenance sources bypass this archive page.
    const people = [...new Set([perspective, ...(options.activePerspectives ?? []),
      ...(candidates.length ? (db.prepare(`SELECT DISTINCT p.value AS name FROM memories m,json_each(m.participants_json) p
        WHERE m.chat_id=? AND m.id IN (SELECT value FROM json_each(?))`).all(options.chatId, JSON.stringify(candidates)) as Array<{name:string}>).map(row => row.name) : [])])];
    const historyCandidates = db.prepare(`SELECT m.id FROM memories m
      LEFT JOIN memory_activation_state h ON h.chat_id=m.chat_id AND h.memory_id=m.id AND h.perspective='__automatic_delivery__'
      WHERE m.chat_id=? AND m.active=1 AND ${searchableMemoryParentSql("m")}
        AND EXISTS (SELECT 1 FROM json_each(m.participants_json) p JOIN json_each(?) person ON p.value=person.value COLLATE NOCASE)
      ORDER BY h.last_turn_seq IS NOT NULL,h.last_turn_seq,m.created_revision,m.id LIMIT 256`).all(options.chatId, JSON.stringify(people)) as Array<{id:string}>;
    const seedCandidates=db.prepare(`SELECT DISTINCT d.memory_id id FROM memory_details d JOIN memories m ON m.id=d.memory_id
      WHERE d.chat_id=? AND d.active=1 AND m.active=1 AND json_extract(d.seed_json,'$.status')='open'
      AND EXISTS(SELECT 1 FROM json_each(d.seed_json,'$.noticedBy') observer JOIN json_each(?) actor ON observer.value=actor.value COLLATE NOCASE)
      ORDER BY d.source_start_ordinal,d.id`).all(options.chatId,JSON.stringify(options.activePerspectives ?? [perspective])) as Array<{id:string}>;
    for (const id of [...(options.automaticSupportMemoryIds ?? []), ...seedCandidates.map(row=>row.id), ...historyCandidates.map(row => row.id),
      ...[...(options.semanticAtomHits?.keys() ?? [])]]) if (!candidates.includes(id)) candidates.push(id);
  }
  const excludedSignatures = new Set(options.excludeMemorySignatures ?? []);
  const alreadyProvidedIds = candidates.filter((id) => excludedIds.has(id) && ((fts.get(id) ?? 0) > 0 || (options.semanticScores?.get(id) ?? 0) > 0 || id === options.seedMemoryId));
  const alreadyProvidedRows = alreadyProvidedIds.length ? db.prepare(`SELECT id,title,content FROM memories WHERE chat_id=? AND id IN (${alreadyProvidedIds.map(() => "?").join(",")})`)
    .all(options.chatId, ...alreadyProvidedIds) as Array<{ id: string; title: string; content: string }> : [];
  const placeholders = candidates.map(() => "?").join(",");
  const rows = candidates.length > 0 ? db.prepare(`
    SELECT memories.*,
      COALESCE((SELECT MAX(msg.ordinal) FROM json_each(memories.evidence_json) ev CROSS JOIN messages msg ON msg.chat_id=memories.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')),memories.created_revision) AS source_ordinal,
      COALESCE((SELECT MAX(msg.completed_turn_seq) FROM json_each(memories.evidence_json) ev
        CROSS JOIN messages msg ON msg.chat_id=memories.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')),0) AS source_turn_seq
    FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()} AND id IN (${placeholders})
  `).all(options.chatId, ...candidates) as MemoryRow[] : [];
  const groupParents = new Set((db.prepare("SELECT memory_id FROM episodes WHERE chat_id=? AND resolution='group' AND status='capsuled'").all(options.chatId) as Array<{ memory_id: string }>).map((row) => row.memory_id));
  const representedParents = new Set(rows.filter((row) => groupParents.has((row as MemoryRow & { capsule_parent_id?: string }).capsule_parent_id ?? '')
    && (omniscient || allowedByPerspective(row, chat.profile, perspective))).map((row) => (row as MemoryRow & { capsule_parent_id: string }).capsule_parent_id));
  for (let index = rows.length - 1; index >= 0; index--) if (representedParents.has(rows[index]!.id)) rows.splice(index, 1);
  for (const row of rows) {
    const signature = memoryContextSignature(row);
    if (excludedSignatures.has(signature) && !alreadyProvidedRows.some((item) => item.id === row.id)) {
      alreadyProvidedRows.push({ id: row.id, title: row.title, content: row.content });
      alreadyProvidedIds.push(row.id);
    }
  }
  const dialogueRows = candidates.length > 0 ? db.prepare(`
    SELECT id,memory_id,speaker,text,message_id,evidence_json,kind,ordinal FROM memory_dialogues
    WHERE chat_id=? AND memory_id IN (${placeholders}) ORDER BY memory_id,ordinal
  `).all(options.chatId, ...candidates) as Array<{ id: string; memory_id: string; speaker: string; text: string; message_id: string; evidence_json: string; kind: KeyDialogue["kind"]; ordinal: number }> : [];
  const detailRows = candidates.length > 0 ? db.prepare(`SELECT id,memory_id,detail_key,kind,role,seed_json,text,participants_json,known_by_json,locations_json,epistemic,salience,retention_class,evidence_json,source_start_ordinal
    FROM memory_details WHERE chat_id=? AND active=1 AND memory_id IN (${placeholders}) ORDER BY COALESCE(source_start_ordinal,2147483647),created_at`).all(options.chatId, ...candidates) as Array<Record<string, any>> : [];
  const accessByItem = loadItemAccess(db, options.chatId, [
    ...dialogueRows.map((row) => ({ kind: "dialogue" as const, id: row.id })),
    ...detailRows.map((row) => ({ kind: "detail" as const, id: String(row.id) })),
  ]);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const atomVisible = (scope: ItemAccessScope, atomAccessVersion: number): boolean => {
    if (atomAccessVersion > 0 && !scope.explicit) return false;
    if (archiveView || perspective === "narrator") return true;
    return visibleTo(scope, perspective);
  };
  const promptCoveredDialogueIds = new Set<string>();
  const promptCoveredDetailIds = new Set<string>();
  const dialoguesByMemory = new Map<string, Array<KeyDialogue & { __arcSelected?: boolean }>>();
  for (const dialogue of dialogueRows) {
    const parent = rowsById.get(dialogue.memory_id);
    const atomAccessVersion = parent?.atom_access_version ?? 0;
    const access = resolveItemAccess(accessByItem, "dialogue", dialogue.id, []);
    if (!atomVisible(access, atomAccessVersion)) continue;
    const dialogueEvidence = JSON.parse(dialogue.evidence_json) as KeyDialogue["evidence"];
    if (!mcpAnswerMode && dialogueEvidence.length > 0 && dialogueEvidence.every((evidence) => coverage?.covered.has(evidence.messageId) && coverage.active.has(evidence.messageId))) {
      if (options.collectDiagnostics) promptCoveredDialogueIds.add(dialogue.id);
      continue;
    }
    if (options.mcpCandidatesOnly) {
      const valid = dialogueEvidence.length > 0 && dialogueEvidence.every((evidence) => {
        const source = db.prepare(`SELECT canonical_content,canonical_hash FROM messages WHERE chat_id=? AND message_id=?
          AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`).get(options.chatId,evidence.messageId) as {canonical_content:string;canonical_hash:string}|undefined;
        return typeof source?.canonical_content === "string" && source.canonical_hash === evidence.canonicalHash && source.canonical_content.slice(evidence.startOffset,evidence.endOffset) === evidence.quote;
      });
      if (!valid) continue;
    }
    const list = dialoguesByMemory.get(dialogue.memory_id) ?? [];
    list.push({ id: dialogue.id, ordinal: dialogue.ordinal, speaker: dialogue.speaker, text: dialogue.text, messageId: dialogue.message_id, evidence: dialogueEvidence, kind: dialogue.kind, knownBy: itemAccessKnowledge(access), knownByLabels:knownByLabels(db,options.chatId,"dialogue",dialogue.id,itemAccessKnowledge(access)),
      __arcSelected: options.arcDialogueIds?.has(dialogue.id) });
    dialoguesByMemory.set(dialogue.memory_id, list);
  }
  const detailsByMemory = new Map<string, MemoryContextItem["details"]>();
  for (const detail of detailRows) {
    const parent = rowsById.get(String(detail.memory_id));
    const atomAccessVersion = parent?.atom_access_version ?? 0;
    const access = resolveItemAccess(accessByItem, "detail", String(detail.id), []);
    const knownBy = itemAccessKnowledge(access);
    if (!atomVisible(access, atomAccessVersion)) continue;
    if (!mcpAnswerMode && isFullyPromptCovered(String(detail.evidence_json ?? ""), coverage)) {
      if (options.collectDiagnostics) promptCoveredDetailIds.add(String(detail.id));
      continue;
    }
    const list = detailsByMemory.get(detail.memory_id) ?? [];
    list.push({ id: detail.id, seed: accessibleStorySeed(detail.seed_json, knownBy), sourceOrdinal: detail.source_start_ordinal ?? undefined, key: detail.detail_key, kind: detail.kind, role: detail.role, text: detail.text, epistemic: detail.epistemic,
      participants: parseList(detail.participants_json), knownBy, knownByLabels:knownByLabels(db,options.chatId,"detail",detail.id,knownBy), locations: parseList(detail.locations_json), salience: detail.salience, retention: detail.retention_class });
    detailsByMemory.set(detail.memory_id, list);
  }
  const associationScores = new Map<string, number>();
  if (mcpAnswerMode && options.seedMemoryId) {
    const edges = db.prepare(`
      SELECT source_id,target_id,weight FROM memory_edges
      WHERE chat_id=? AND (source_id=? OR target_id=?) ORDER BY weight DESC LIMIT 64
    `).all(options.chatId, options.seedMemoryId, options.seedMemoryId) as Array<{ source_id: string; target_id: string; weight: number }>;
    for (const edge of edges) {
      const associatedId = edge.source_id === options.seedMemoryId ? edge.target_id : edge.source_id;
      associationScores.set(associatedId, Math.max(associationScores.get(associatedId) ?? 0, edge.weight));
    }
  }

  const ranked: Ranked[] = [];
  const recallPaths: RecallPathCapture | undefined = options.collectDiagnostics
    ? { direct: new Map(), graph: new Map(), event: new Map() } : undefined;
  const allAtoms = new Map<string, Pick<MemoryContextItem, "details" | "keyDialogues">>();
  type TraceRow = { memory_id: string; strength: number; salience: number; recall_count: number; last_recalled_turn_seq: number | null; detail_level: string };
  const traceRows = perspective === "narrator" || candidates.length === 0 ? []
    : db.prepare(`SELECT memory_id,strength,salience,recall_count,last_recalled_turn_seq,detail_level FROM memory_traces
      WHERE character_name=? AND memory_id IN (${placeholders})`).all(perspective, ...candidates) as TraceRow[];
  const traces = new Map(traceRows.map((trace) => [trace.memory_id, trace]));
  const residualActivations = loadResidualActivations(db, options.chatId, perspective, candidates,
    chat.completed_turn_count, !mcpAnswerMode);
  const isoStoryDates = rows.flatMap((row) => row.story_time_normalized
    ? [Date.parse(row.story_time_normalized.replace(" ", "T"))] : []).filter(Number.isFinite);
  const latestStoryDate = isoStoryDates.length ? Math.max(...isoStoryDates) : undefined;
  const requestedDateRange = mcpAnswerMode ? queryDateRange(options.query) : undefined;
  const promptCoveredCandidateIds = new Set(!mcpAnswerMode
    ? rows.filter((row) => isFullyPromptCovered(row.evidence_json, coverage) && !(detailsByMemory.get(row.id)?.length || dialoguesByMemory.get(row.id)?.length)).map((row) => row.id)
    : []);
  for (const row of rows) {
    if (excludedIds.has(row.id) && row.id !== options.seedMemoryId) continue;
    const semanticSignature = memoryContextSignature(row);
    if (excludedSignatures.has(semanticSignature) && row.id !== options.seedMemoryId) continue;
    const parentVisible = omniscient || allowedByPerspective(row, chat.profile, perspective);
    const allDetails = detailsByMemory.get(row.id) ?? [];
    const visibleDialogues = dialoguesByMemory.get(row.id) ?? [];
    const atomView = row.atom_access_version > 0;
    if ((!parentVisible && allDetails.length === 0 && visibleDialogues.length === 0)
      || (!mcpAnswerMode && row.atom_access_version === 0 && !allDetails.length && !visibleDialogues.length && isFullyPromptCovered(row.evidence_json, coverage))) continue;
    if (atomView && allDetails.length === 0 && visibleDialogues.length === 0) continue;
    const agedDetail = detailFor(row, chat.completed_turn_count, traces.get(row.id));
    const detail = mcpAnswerMode
      ? { detail: "clear" as const, effective: Math.max(0.78, agedDetail.effective) }
      : agedDetail;
    const participants = parentVisible && !atomView ? parseList(row.participants_json) : [...new Set(allDetails.flatMap((entry) => entry.participants))];
    const locations = atomView || parentVisible ? parseList(row.locations_json) : [...new Set(allDetails.flatMap((entry) => entry.locations))];
    const knownBy = parentVisible && (!atomView || archiveView)
      ? parseList(row.known_by_json)
      : [...new Set([...allDetails.flatMap((entry) => entry.knownBy), ...visibleDialogues.flatMap((entry) => entry.knownBy)])];
    const allDialogues = parentVisible || atomView ? visibleDialogues : [];
    allAtoms.set(row.id, { details: allDetails, keyDialogues: allDialogues });
    const episodeSections = parentVisible && !atomView && row.type === "episode" ? db.prepare(`
      SELECT title,summary FROM episode_sections WHERE episode_id=(SELECT id FROM episodes WHERE memory_id=? LIMIT 1) ORDER BY ordinal
    `).all(row.id) as Array<{ title: string; summary: string }> : [];
    const relevantSection = episodeSections
      .map((section) => ({ ...section, relevance: weightedOverlap(signals, `${section.title} ${section.summary}`) }))
      .sort((left, right) => right.relevance - left.relevance)[0];
    const explicitEpisodeEvidence = row.id === options.seedMemoryId && intent === "evidence";
    const sectionText = explicitEpisodeEvidence
      ? episodeSections.map((section) => `\nEpisode section: ${section.title}\n${section.summary}`).join("")
      : relevantSection && (relevantSection.relevance > 0 || row.id === options.seedMemoryId)
        ? `\nRelevant episode section: ${relevantSection.title}\n${relevantSection.summary}`
        : "";
    const dialogueText = allDialogues.flatMap((dialogue) => [dialogue.speaker, dialogue.text]).join(" ");
    const semanticDetailHit = options.semanticHits?.get(row.id);
    const lexicalDetailHit = lexicalSearch.detailHits.get(row.id);
    const rankedDetails = allDetails.map((entry) => {
      const overlap = weightedOverlap(signals, `${entry.text} ${entry.participants.join(" ")} ${entry.locations.join(" ")}`);
      const discriminativeOverlap = discriminativeWeightedOverlap(discriminativeSignals,
        `${entry.text} ${entry.participants.join(" ")} ${entry.locations.join(" ")}`);
      const detailHits = (options.semanticAtomHits?.get(row.id) ?? (semanticDetailHit ? [semanticDetailHit] : [])).filter((hit) => hit.kind === "memory_detail" && hit.sourceId === entry.id && hit.score >= 0.72);
      const semanticDetail = detailHits.length ? 0.6 : 0;
      const directSemanticDetail = detailHits.some((hit) => hit.viewIndex === undefined || signals[hit.viewIndex]?.kind !== "scene") ? 0.6 : 0;
      const lexicalDetail = !mcpAnswerMode && lexicalDetailHit?.kind === "memory_detail" && lexicalDetailHit.sourceId === entry.id
        ? Math.min(0.6, lexicalDetailHit.score * 0.6) : 0;
      const directRelevance = discriminativeOverlap + Math.max(directSemanticDetail, lexicalDetail);
      return { entry, directRelevance, relevance: overlap + Math.max(semanticDetail, lexicalDetail)
        + (options.arcDetailScores?.get(entry.id) ?? 0)
        + (entry.retention === "durable" ? 0.08 : entry.retention === "arc" ? 0.03 : 0) };
    })
      .sort((left, right) => right.relevance - left.relevance || right.entry.salience - left.entry.salience);
    const detailSignal = rankedDetails[0]?.relevance ?? 0;
    const directDetailSignal = directCandidateIds.has(row.id)
      ? rankedDetails.reduce((best, entry) => Math.max(best, entry.directRelevance), 0) : 0;
    const perMemoryDetailLimit = mcpAnswerMode ? 12 : options.tokenBudget >= 10_000 ? 12 : options.tokenBudget >= 7_000 ? 10 : options.tokenBudget >= 5_000 ? 8 : 6;
    const selectedDetails = (mcpAnswerMode
      ? rankedDetails
      : rankedDetails.filter((entry) => entry.entry.role === "core" || entry.relevance > 0 || entry.entry.retention === "durable" || entry.entry.kind === "open_thread"))
      .filter((entry, index) => entry.entry.role === "core" || mcpAnswerMode || options.deferAutomaticBudget || entry.directRelevance > 0 || index < perMemoryDetailLimit).map((entry) => entry.entry)
      .sort((left, right) => Number(right.role === "core") - Number(left.role === "core"));
    const safeDetailText = allDetails.map((entry) => entry.text).join(" ");
    // The archive view may expose the episode's short navigation label with
    // its parent access scope. The longer synopsis remains search-only: it can
    // mix several atoms whose holders differ. Character-facing turn packets
    // continue to receive only materialized details and dialogue.
    const publicTitle = atomView ? archiveView ? row.title : "" : parentVisible ? row.title : allDetails[0]?.text ?? "";
    const publicContent = atomView ? "" : parentVisible ? `${row.content}${sectionText}` : [safeDetailText, dialogueText].filter(Boolean).join(" ");
    const memoryEvidence = parentVisible && !atomView ? parseEvidence(row.evidence_json) : [];
    const evidenceRelevance = weightedOverlap(signals, memoryEvidence.flatMap((entry) => [entry.messageId, entry.quote ?? ""]).join(" "));
    // The parent synopsis is a search envelope even when atom materialization
    // correctly prevents it from reaching a character-facing packet.
    const lexical = discriminativeWeightedOverlap(discriminativeSignals,
      `${row.title} ${row.content} ${safeDetailText} ${participants.join(" ")} ${locations.join(" ")} ${dialogueText}`);
    const directlyRelevant = allDialogues
      .map((dialogue) => ({ dialogue, relevance: weightedOverlap(signals, `${dialogue.speaker} ${dialogue.text}`) }))
      .filter((item) => item.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .map((item) => item.dialogue);
    const structural = allDialogues.filter((dialogue) => ["promise", "boundary", "revelation"].includes(dialogue.kind));
    const arcDialogues = allDialogues.filter((dialogue) => dialogue.__arcSelected);
    const keyDialogues = mcpAnswerMode || detail.detail === "clear" || detail.detail === "gist"
      ? [...new Map([...arcDialogues, ...(mcpAnswerMode ? allDialogues : directlyRelevant), ...structural].map((dialogue) => [`${dialogue.messageId}\0${dialogue.text}`, dialogue])).values()]
        .slice(0, mcpAnswerMode ? undefined : row.type === "episode" ? 5 : 2)
        .map(({ __arcSelected: _arcSelected, ...dialogue }) => dialogue)
      : directlyRelevant.map(({ __arcSelected: _arcSelected, ...dialogue }) => dialogue);
    const profileBoost = chat.profile === "companion"
      ? (["relationship", "promise", "episode", "foreshadowing"].includes(row.type) ? 0.25 : 0)
      : (["world_state", "belief", "secret", "promise"].includes(row.type) ? 0.25 : 0);
    const arcSignal = options.arcMemoryScores?.get(row.id) ?? 0;
    const directSignal = directCandidateIds.has(row.id)
      ? (fts.get(row.id) ?? 0) * 0.9 + (options.semanticScores?.get(row.id) ?? 0) * 1.1 + lexical * 1.4 : 0;
    const associationSignal = (associationScores.get(row.id) ?? 0) * 0.8;
    const retrievalSignal = directSignal + arcSignal * 0.72 + associationSignal + (row.id === options.seedMemoryId ? 1 : 0) +
      intentSignal(intent, row, memoryEvidence, evidenceRelevance);
    const realTimePrior = 0.025 * Math.exp(-Math.max(0, Date.now() - row.created_at) / (365 * 86_400_000));
    const rowStoryDate = row.story_time_normalized ? Date.parse(row.story_time_normalized.replace(" ", "T")) : NaN;
    const narrativeTimePrior = latestStoryDate !== undefined && Number.isFinite(rowStoryDate)
      ? 0.02 * Math.exp(-Math.max(0, latestStoryDate - rowStoryDate) / (365 * 86_400_000)) : 0;
    const residualActivation = residualActivations.get(row.id)?.decayed ?? 0;
    const baseDirect = Math.max(directSignal, directDetailSignal);
    const viewAuthority = Math.max(0,
      ...lexicalSearch.views.filter((view) => view.scores.has(row.id))
        .map((view) => queryViewAuthority(view.signal.weight, maximumSignalWeight)),
      ...(options.semanticViewScores ?? []).flatMap((scores, index) => scores.has(row.id) && signals[index]
        ? [queryViewAuthority(signals[index]!.weight, maximumSignalWeight)] : []),
    );
    const score = retrievalSignal + row.salience * 0.35 + detail.effective * 0.35 + (row.pinned ? 2 : 0) + profileBoost
      + temporalRangeSignal(requestedDateRange, row.story_time_normalized ?? undefined) + realTimePrior + narrativeTimePrior;
    const evidenceMessageIds = memoryEvidence.map((item) => item.messageId);
    if (recallPaths && (baseDirect > 0 || row.id === options.seedMemoryId)) {
      // These are aggregate retrieval signals, not an assertion that a single
      // embedding hit or original source has been verified for this character.
      const detailAnchor = directDetailSignal > directSignal
        ? rankedDetails.find((entry) => entry.directRelevance === directDetailSignal)?.entry : undefined;
      const rootHits = !mcpAnswerMode ? options.semanticAtomHits?.get(row.id) : undefined;
      recallPaths.direct.set(row.id, startRecallPath({ memoryId: row.id,
        kind: baseDirect <= 0 ? "explicit_seed" : detailAnchor ? "detail_signal" : "direct_signal", score: baseDirect > 0 ? baseDirect : 1,
        ...(detailAnchor ? { detailId: detailAnchor.id } : {}),
        ...(baseDirect > 0 && rootHits?.length ? { rootEvidence: observeRootEvidence(row.id,
          new Set(allDetails.map((detail) => detail.id)), rootHits, signals) } : {}),
      }));
    }
    ranked.push({
      id: row.id,
      signature: semanticSignature,
      atomAccessVersion: row.atom_access_version,
      type: row.type,
      title: publicTitle,
      content: publicContent,
      detail: detail.detail,
      perspective: row.perspective ?? undefined,
      storyTime: row.story_time ?? undefined,
      sourceOrdinal: row.source_ordinal ?? undefined,
      locations,
      landmark: row.landmark === 1,
      landmarkKinds: parseLandmarkKinds(row.landmark_kinds_json),
      knownBy,
      participants,
      score,
      evidenceMessageIds,
      evidence: memoryEvidence,
      keyDialogues,
      details: selectedDetails,
      raw: row,
      directSignal,
      directDetailSignal,
      arcSignal,
      associationSignal,
      atomPath: pathsByMemory.get(row.id)?.[0],
      retrievalSignal,
      detailSignal,
      directDetailIds: rankedDetails.filter((entry) => entry.directRelevance > 0).map((entry) => entry.entry.id),
      candidateClass: "unclassified",
      expansionReasons: [
        ...(arcSignal > 0 ? ["story_arc" as const] : []),
        ...(associationSignal > 0 ? ["graph_association" as const] : []),
      ],
      accessibility: detail.effective,
      propagatedEnergy: 0,
      residualActivation,
      baseDirect,
      cognitiveBonus: arcSignal * 0.72 + associationSignal,
      viewAuthority,
      viaMemoryId: mcpAnswerMode && residualActivations.get(row.id)?.path_expires_turn !== null
        && Number(residualActivations.get(row.id)?.path_expires_turn ?? -1) >= chat.completed_turn_count
        ? residualActivations.get(row.id)?.via_memory_id ?? undefined : undefined,
    });
  }
  if (options.mcpCandidatesOnly) {
    // Reuse canonical/access materialization, then leave automatic lanes and the
    // legacy question selector entirely out of the MCP answer path.
    const eligibleCandidates = ranked.map(item => publicMemoryContext({ ...item, ...allAtoms.get(item.id) }));
    const mcpSearchEnvelopes = new Map(ranked.map(item => [item.id, `${item.raw.title} ${item.raw.content}`]));
    // State tables have their own top-k boundary. Discover them independently
    // for each atomic facet so a broad multi-part request cannot crowd a valid
    // promise, belief, relationship or physical-state answer out of that
    // facet's candidate set. Keep the candidates question-bound instead of
    // multiplying every state row across every reranker call.
    const stateAnswers = options.memoryOnlyInjection ? [] : aspects.map(question => {
      const facetSignals: SearchQuerySignal[] = [{ kind: "focus", text: question, weight: 1 }];
      const facetDiscriminativeSignals = [{
        tokens: discriminativeSearchTokenWeights(db, options.chatId, question, chat.memory_language),
        weight: 1,
      }];
      const relevance: LedgerRelevance = text => discriminativeWeightedOverlap(facetDiscriminativeSignals, text);
      const stateHits: StateEvidenceHit[] = [];
      stableAnchors(db, options.chatId, perspective, chat.profile, options.tokenBudget, intent, facetSignals, undefined,
        true, options.activePerspectives ?? [], archiveView, emptyPacketManifest(), new Set(), stateHits, relevance, options.stateScores);
      const physical = renderPhysicalIntimacy(db, options.chatId, perspective, options.activePerspectives ?? [], options.tokenBudget,
        true, archiveView, new Set(), facetSignals, relevance);
      const landmarks = renderRelationshipLandmarks(db, options.chatId, perspective, options.activePerspectives ?? [], chat.profile,
        options.tokenBudget, undefined, true, new Set(), facetSignals, relevance);
      stateHits.push(...(physical.hits ?? []), ...(landmarks.hits ?? []));
      const unique = [...new Map(stateHits.map(hit => [hit.atomKey, hit] as const)).values()];
      return { question, alreadyPresent: false, evidence: unique.map(hit => ({
        atomKey: hit.atomKey, kind: "fact" as const, text: hit.presentation ?? hit.text, knownBy: hit.knownBy,
      })) };
    });
    const diagnostics: RetrievalDiagnostics | undefined = options.collectDiagnostics ? {
      elapsedMs: performance.now()-started, perspective, intent, mcpAnswerMode: true,
      tokenBudget: options.tokenBudget, hardTokenCeiling: options.tokenBudget,
      candidateCount: candidates.length, eligibleCount: eligibleCandidates.length, orderedCount: 0, usedTokens: 0,
      selectedIds: [], focusLeaderIds: [], continuityBridgeIds: [], overflowTokens: 0, overflowSlotUsed: false,
      recentMemoryIds: [], bridgeMemoryIds: [], continuitySupplementIds: [],
      selectedClassCounts: {core:0,associative:0,continuity:0},
      selectedRoleCounts: {focus:0,core:0,continuity:0,association:0,serendipity:0,longterm:0,filler:0},
      associativeTokenBudget:0,promptCoveredMemoryIds:[],promptCoveredDetailIds:[],promptCoveredDialogueIds:[],excludedMemoryIds:[],candidates:ranked.map(item=>({
        id:item.id,type:item.type,title:item.title,score:0,directSignal:item.directSignal,directDetailSignal:item.directDetailSignal,
        baseDirect:item.baseDirect,cognitiveBonus:0,viewAuthority:0,retrievalSignal:0,detailSignal:item.detailSignal,
        lexicalScore:fts.get(item.id) ?? 0,semanticScore:options.semanticScores?.get(item.id) ?? 0,
        matchedLexicalTokens: matchedLexicalTokens(lexicalSearch, signals, item.id),
        semanticHit:options.semanticHits?.get(item.id),propagatedEnergy:0,residualActivation:0,candidateClass:"unclassified",
        expansionReasons:[],lanes:["mcp_candidate"],outcome:"not_reserved",
      })),
    } : undefined;
    return { packet:"",stableAnchors:"",perspectiveData:"",estimatedTokens:0,selected:[],eligibleCandidates,mcpSearchEnvelopes,
      directAtomKeys:[],structuredManifest:emptyPacketManifest(),coverage:[],alreadyProvidedIds:[],recentMemoryIds:[],
      focusLeaderIds:[],continuityBridgeIds:[],selectedCandidateClasses:{},selectedRoles:{},activationObservations:[],deliveredAtomKeys:[],diagnostics,
      answers:stateAnswers,
    };
  }
  // Expand only from evidence-ranked anchors. The previous broad top-eight
  // expansion let salience/profile bonuses choose an unrelated arc and then
  // amplify it before the requested event had been selected.
  if (mcpAnswerMode && recallPaths && options.seedMemoryId && ranked.some((item) => item.id === options.seedMemoryId)) {
    const seedPath = startRecallPath({ memoryId: options.seedMemoryId, kind: "explicit_seed", score: 1 });
    for (const item of ranked) {
      const weight = associationScores.get(item.id);
      if (weight !== undefined) recallPaths.graph.set(item.id, extendRecallPath(seedPath, {
        fromMemoryId: options.seedMemoryId, toMemoryId: item.id, stage: "seed_association",
        relation: "memory_edge", weight, energy: weight * 0.8,
      }));
    }
  }
  if (mcpAnswerMode) expandAnchoredAssociations(db, options.chatId, ranked, options.seedMemoryId, recallPaths);
  for (const item of ranked) {
    if ((item.directSignal > 0 || item.directDetailSignal > 0 || item.propagatedEnergy > 0) && item.residualActivation > 0) {
      item.score += item.residualActivation * 0.18;
      item.retrievalSignal += item.residualActivation * 0.12;
      item.cognitiveBonus += item.residualActivation * 0.12;
    }
    item.cognitiveBonus = Math.max(item.cognitiveBonus, item.arcSignal * 0.72 + item.associationSignal + item.propagatedEnergy);
    if (item.detail === "unrecalled" && tierAllowsRecall(item, options.seedMemoryId)) item.detail = "deja_vu";
  }
  const tierAccessibleIds = new Set(ranked.map((item) => item.id));
  type AspectMatch = { item: Ranked; score: number; direct: boolean; atomicHit: boolean; temporalTier: number; detailIds: string[]; boundDetailIds: string[]; dialogueKeys: string[] };
  const aspectMatches = new Map<string, AspectMatch[]>();
  if (mcpAnswerMode) {
    for (const aspect of aspects) {
      const evaluatedForAspect = ranked.map((item) => ({ item, temporalTier: temporalRangeTier(requestedDateRange, item.storyTime), ...aspectEvidence(aspect, aspectTokens.get(aspect)!, sceneTokens, item, entities,
        (aspect !== options.query ? options.aspectSemanticHits?.get(aspect)?.get(item.id) : options.aspectSemanticHits?.get(aspect)?.get(item.id) ?? options.semanticHits?.get(item.id)), `${item.raw.title} ${item.raw.content}`,
        aspectLexicalHits.get(aspect)?.get(item.id), aspectSemanticEvidence.get(aspect)?.get(item.id),
        options.aspectSemanticAtomHits?.get(aspect)?.get(item.id) ?? (aspect !== options.query ? undefined : options.semanticAtomHits?.get(item.id))) }));
      if (options.followAllDetails && options.seedMemoryId) {
        const seed = evaluatedForAspect.find(match => match.item.id === options.seedMemoryId);
        if (seed) Object.assign(seed, { direct: true, atomicHit: true, score: 1,
          detailIds: seed.item.details.map(detail => detail.id), boundDetailIds: seed.item.details.map(detail => detail.id),
          dialogueKeys: seed.item.keyDialogues.map(dialogue => memoryDialogueAtomKey(seed.item.id, dialogue)) });
      }
      // Date scope is part of the request, not a bonus applied after semantic
      // thresholding. Otherwise a stronger lookalike outside the stated range
      // can be the only row left before temporal filtering gets a chance.
      const temporalPool = requestedDateRange && evaluatedForAspect.some((match) => match.temporalTier > 0)
        ? evaluatedForAspect.filter((match) => match.temporalTier > 0)
        : evaluatedForAspect;
      const temporallyEligible = temporalPool.filter((match) => match.direct || match.score >= (requestedDateRange ? 0.28 : 0.4));
      const matches = temporallyEligible
        .sort((left, right) => right.temporalTier - left.temporalTier
          || Number(right.direct) - Number(left.direct)
          // A coarse lexical boolean must not outrank the fused facet score.
          // Generic words such as "title", "message", or "after" can clear
          // the boolean threshold in an unrelated scene even when the facet's
          // own semantic view ranks the correct atom first.
          || right.score - left.score
          || Number(right.atomicHit) - Number(left.atomicHit)
          || Number(right.strongItemMatch) - Number(left.strongItemMatch)
          || right.item.score - left.item.score)
        .slice(0, 4);
      aspectMatches.set(aspect, matches);
    }
  }
  const bridgeCandidateIdSet = new Set(bridgeCandidateIds);
  const preliminaryById = new Map(ranked.map((item) => [item.id, item]));
  const focusViewKinds = new Set<SearchQuerySignal["kind"]>(["focus", "cue"]);
  const directAbsolute = (item: Ranked): boolean => item.directSignal >= 0.12 || item.directDetailSignal >= 0.08;
  const qualifiedViewLeaderIds = new Set<string>();
  for (const view of lexicalSearch.views.filter((entry) => focusViewKinds.has(entry.signal.kind))) {
    const leader = [...view.scores].sort((left, right) => right[1] - left[1])
      .map(([id]) => preliminaryById.get(id)).find((item): item is Ranked => Boolean(item) && directAbsolute(item!));
    if (leader) qualifiedViewLeaderIds.add(leader.id);
  }
  for (const [index, scores] of (options.semanticViewScores ?? []).entries()) {
    if (!signals[index] || !focusViewKinds.has(signals[index]!.kind)) continue;
    const leader = [...scores].sort((left, right) => right[1] - left[1])
      .map(([id]) => preliminaryById.get(id)).find((item): item is Ranked => Boolean(item) && directAbsolute(item!));
    if (leader) qualifiedViewLeaderIds.add(leader.id);
  }
  const strongestDirect = Math.max(0, ...ranked.map((item) => item.baseDirect));
  for (const item of ranked) {
    const typedIntentSignal = item.retrievalSignal - item.directSignal - item.arcSignal * 0.72 - item.associationSignal;
    const relativeDirect = strongestDirect <= 0 || item.baseDirect >= strongestDirect * 0.25;
    if (directAbsolute(item) && (relativeDirect || qualifiedViewLeaderIds.has(item.id)) || item.raw.pinned || item.id === options.seedMemoryId
      || intent !== "recall" && typedIntentSignal >= 0.12) item.candidateClass = "core";
    else if (bridgeCandidateIdSet.has(item.id)) item.candidateClass = "continuity";
    else if (mcpAnswerMode ? item.retrievalSignal >= 0.12 && (item.arcSignal > 0 || item.associationSignal > 0)
      : Boolean(item.atomPath)) item.candidateClass = "associative";
  }
  // A path grants access to its actual endpoint atoms, never to their sibling
  // details, parent synopsis or dialogue. Direct core/continuity retain their
  // existing materialization, including focus's deliberate full-atom restore.
  const projectPathItem = (item: Ranked): Ranked => {
    if (mcpAnswerMode || item.candidateClass !== "associative") return item;
    const paths = pathsByMemory.get(item.id) ?? [];
    const ids = new Set(paths.map(path => path.atomIds.at(-1)!));
    const details = (allAtoms.get(item.id)?.details ?? []).filter(detail => ids.has(detail.id));
    return { ...item, ...projectAtomMemory(item, details, []), atomAccessVersion: 1,
      locations: [...new Set(details.flatMap(detail => detail.locations))], directDetailIds: [],
      viaMemoryId: item.atomPath ? pathNodes.get(item.atomPath.root.atomId)?.memoryId : undefined };
  };
  for (const item of ranked) if (!mcpAnswerMode && item.candidateClass === "associative") Object.assign(item, projectPathItem(item));
  const eligible = ranked.filter((item) => tierAccessibleIds.has(item.id) && (mcpAnswerMode
    ? item.retrievalSignal >= 0.12 || item.raw.pinned || item.id === options.seedMemoryId
      || bridgeCandidateIdSet.has(item.id)
      || [...aspectMatches.values()].some((matches) => matches.some((match) => match.item.id === item.id))
    : item.candidateClass !== "unclassified"));
  eligible.sort((a, b) => b.score - a.score || (b.raw.source_ordinal ?? b.raw.created_revision) - (a.raw.source_ordinal ?? a.raw.created_revision));
  const similaritySignatures = new Map(ranked.map((item) => [item.id, similaritySignature(item)]));
  const recentContinuity = !mcpAnswerMode
    ? bridgeCandidateIds.map((id) => eligible.find((item) => item.id === id)).find((item): item is Ranked => Boolean(item))
    : undefined;
  const historicalDetail = [...eligible].filter((item) => (mcpAnswerMode ? item.detailSignal : item.directDetailSignal) >= 0.08)
    .sort((left, right) => (mcpAnswerMode ? right.detailSignal - left.detailSignal : right.directDetailSignal - left.directDetailSignal)
      || (left.raw.source_ordinal ?? left.raw.created_revision) - (right.raw.source_ordinal ?? right.raw.created_revision)).slice(0, 2);
  const intentMemoryTypes = !mcpAnswerMode && intent === "relationship" ? new Set(["relationship"])
    : !mcpAnswerMode && intent === "world_state" ? new Set(["world_state", "belief", "secret"])
        : undefined;
  const directHits = [...eligible]
    .filter((item) => mcpAnswerMode
      ? item.retrievalSignal >= 0.12 || item.raw.pinned || item.id === options.seedMemoryId
      : item.candidateClass === "core")
    .sort((left, right) => (mcpAnswerMode ? right.retrievalSignal - left.retrievalSignal : right.directSignal - left.directSignal)
      || right.directDetailSignal - left.directDetailSignal || right.score - left.score);
  const rankedById = new Map(ranked.map((item) => [item.id, item]));
  const lexicalViewLeaderEntries = (mcpAnswerMode ? [] : lexicalSearch.views.filter((view) => focusViewKinds.has(view.signal.kind))).flatMap((view) => {
    const ordered = [...view.scores].slice(0, 12);
    // When a cue's best archive hit is already present verbatim in the recent
    // prompt, the cue is already satisfied. Do not fall through to the next,
    // weaker historical lookalike merely because prompt coverage hid the top
    // result from materialization.
    if (ordered[0] && promptCoveredCandidateIds.has(ordered[0][0])) return [];
    return ordered
    .map(([id, localRank]) => {
      const item = rankedById.get(id);
      if (!item || !eligible.includes(item) || item.candidateClass !== "core") return undefined;
      const body = `${item.raw.title} ${item.raw.content} ${item.details.map((detail) => detail.text).join(" ")} ${item.keyDialogues.map((dialogue) => dialogue.text).join(" ")}`;
      const fit = idfWeightedCoverage(view.tokenWeights, body) + orderedProximityBonus(view.tokenWeights, body);
      return { item, fit, matched: fit * view.tokens.size, localRank, kind: view.signal.kind,
        authority: queryViewAuthority(view.signal.weight, maximumSignalWeight) };
    })
    .filter((entry): entry is { item: Ranked; fit: number; matched: number; localRank: number; kind: SearchQuerySignal["kind"]; authority: number } => entry !== undefined && entry.fit >= 0.16)
    .sort((left, right) => right.authority - left.authority || right.matched - left.matched || right.fit - left.fit || right.localRank - left.localRank || right.item.retrievalSignal - left.item.retrievalSignal)
    .slice(0, 1);
  })
    .sort((left, right) => Number(right.kind === "focus") - Number(left.kind === "focus")
      || right.authority - left.authority || right.matched - left.matched || right.fit - left.fit || right.localRank - left.localRank)
    .filter((entry, index, items) => items.findIndex((candidate) => candidate.item.id === entry.item.id) === index)
    .slice(0, 4);
  const lexicalViewLeaders = lexicalViewLeaderEntries.map((entry) => entry.item);
  const semanticViewLeaderEntries = mcpAnswerMode ? [] : (options.semanticViewScores ?? []).flatMap((scores, index) => {
    if (!signals[index] || !focusViewKinds.has(signals[index]!.kind)) return [];
    const ordered = [...scores].sort((left, right) => right[1] - left[1]).slice(0, 12);
    if (ordered.length === 0) return [];
    if (promptCoveredCandidateIds.has(ordered[0]![0])) return [];
    const top = ordered[0]![1];
    const floor = ordered.at(-1)![1];
    const item = rankedById.get(ordered[0]![0]);
    if (!item || !eligible.includes(item) || item.candidateClass !== "core" || top < 0.35 || top <= floor) return [];
    return [{ item, confidence: Math.max(0, top - floor) * queryViewAuthority(signals[index]!.weight, maximumSignalWeight), kind: signals[index]!.kind }];
  }).sort((left, right) => Number(right.kind === "focus") - Number(left.kind === "focus") || right.confidence - left.confidence)
    .filter((entry, index, items) => items.findIndex((candidate) => candidate.item.id === entry.item.id) === index)
    .slice(0, 4);
  const semanticViewLeaders = semanticViewLeaderEntries.map((entry) => entry.item);
  const fusedSemanticLeaders = mcpAnswerMode ? [] : [...(options.semanticScores ?? [])]
    .sort((left, right) => right[1] - left[1]).slice(0, 16)
    .map(([id]) => rankedById.get(id))
    .filter((item): item is Ranked => item !== undefined && eligible.includes(item) && item.candidateClass === "core" && !promptCoveredCandidateIds.has(item.id))
    .slice(0, 3);
  const focusLeaderSources = new Map<string, Set<"lexical" | "semantic">>();
  for (const item of lexicalViewLeaders) focusLeaderSources.set(item.id, new Set([...(focusLeaderSources.get(item.id) ?? []), "lexical"]));
  for (const item of semanticViewLeaders) focusLeaderSources.set(item.id, new Set([...(focusLeaderSources.get(item.id) ?? []), "semantic"]));
  const focusLeaders: Ranked[] = [];
  const fullFocusLeaders = [
    ...lexicalViewLeaderEntries.filter((entry) => entry.kind === "focus").map((entry) => entry.item),
    ...semanticViewLeaderEntries.filter((entry) => entry.kind === "focus").map((entry) => entry.item),
  ].sort((left, right) => right.baseDirect - left.baseDirect || right.score - left.score);
  const firstFocus = fullFocusLeaders[0];
  if (firstFocus) focusLeaders.push(firstFocus);
  for (const item of interleaveRankedLanes([lexicalViewLeaders, semanticViewLeaders], 8)) {
    if (focusLeaders.some((selected) => selected.id === item.id)) continue;
    if (focusLeaders.some((selected) => contentSimilarity(item, selected, similaritySignatures) >= 0.78)) continue;
    focusLeaders.push(item);
    if (focusLeaders.length >= (options.deferAutomaticBudget ? 8 : 2)) break;
  }
  const directSeeds = (mcpAnswerMode ? [...aspectMatches.values()].flatMap(matches => matches.filter(match => match.direct).map(match => match.item)) : [...focusLeaders, ...directHits]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)).slice(0, 4);
  const eventClusterResult = orderEventContext(
    db,
    options.chatId,
    directSeeds.slice(0, mcpAnswerMode ? 4 : 1),
    mcpAnswerMode ? eligible : ranked.filter((item) => tierAccessibleIds.has(item.id)),
    !mcpAnswerMode,
    8,
    recallPaths,
  );
  const eventExpansion = eventClusterResult.ordered.filter((item) => !directSeeds.some((seed) => seed.id === item.id));
  if (!mcpAnswerMode) {
    for (const item of eventExpansion) {
      if (item.candidateClass === "associative" && !item.expansionReasons.includes("event_edge")) item.expansionReasons.push("event_edge");
    }
  }
  const associativeTokenBudget = mcpAnswerMode ? 0 : Math.floor(options.tokenBudget * AUTOMATIC_ROLE_SHARES.association);
  const associativeCandidates = mcpAnswerMode ? [] : eligible
    .filter(item => item.candidateClass === "associative" && item.atomPath && item.details.length > 0)
    .sort((left, right) => compareAtomPaths(left.atomPath!, right.atomPath!));
  const focusLeaderIdSet = new Set(focusLeaders.map((item) => item.id));
  const remainingCore = eligible
    .filter((item) => item.candidateClass === "core" && !focusLeaderIdSet.has(item.id));
  const automaticCoreCandidates = [...focusLeaders, ...mmrOrderWithSeed(remainingCore, similaritySignatures, focusLeaders)]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
  // Serendipity is a property of the final automatic packet, not of one
  // perspective section. A memory shown unexpectedly for either protagonist
  // must cool down globally before another perspective can surface it again.
  const recentSerendipityIds = new Set((!mcpAnswerMode
    ? db.prepare(`SELECT DISTINCT memory_id FROM memory_activation_state
        WHERE chat_id=? AND via_memory_id IS NOT NULL AND path_expires_turn>=?`)
      .all(options.chatId, chat.completed_turn_count) as Array<{ memory_id: string }>
    : []).map((row) => row.memory_id));
  const serendipityCandidate = !mcpAnswerMode && automaticCoreCandidates.length > 0
    ? associativeCandidates.find((item) => (item.atomPath?.support ?? 0) >= 0.05
      && Boolean(item.viaMemoryId)
      && !recentSerendipityIds.has(item.id)
      && !promptCoveredCandidateIds.has(item.id)
      && (item.details.length > 0 || item.keyDialogues.length > 0 || item.locations.length > 0))
    : undefined;
  const ordinaryAssociations = associativeCandidates.filter((item) => item.id !== serendipityCandidate?.id);
  const automaticAssociations = serendipityCandidate ? [serendipityCandidate, ...ordinaryAssociations] : ordinaryAssociations;
  const laneCandidates = mcpAnswerMode
    ? [...aspectMatches.values()].flatMap(matches => matches.filter(match => match.direct).map(match => match.item))
        .sort((left, right) => Number(right.id === options.seedMemoryId) - Number(left.id === options.seedMemoryId))
    : [...weaveCoreAndAssociative(automaticCoreCandidates, automaticAssociations), ...(recentContinuity ? [recentContinuity] : [])];
  const orderedCandidates = laneCandidates.filter((item, index, items) => items.findIndex(candidate => candidate.id === item.id) === index);
  if (recentContinuity && !mcpAnswerMode) recentContinuity.candidateClass = "continuity";
  const selectionRoleFor = (item: Ranked): RetrievalSelectionRole => focusLeaderIdSet.has(item.id) ? "focus"
    : item.id === serendipityCandidate?.id ? "serendipity"
      : item.id === recentContinuity?.id ? "continuity"
        : item.candidateClass === "core" ? "core"
          : item.candidateClass === "associative" ? "association" : "filler";
  const hardTokenCeiling = mcpAnswerMode
    ? options.tokenBudget
    : Math.max(options.tokenBudget, options.hardTokenCeiling ?? automaticHardTokenCeiling(options.tokenBudget));
  const memoryLimit = mcpAnswerMode ? 8 : automaticMemoryLimit(options.tokenBudget);
  const hardMemoryLimit = mcpAnswerMode ? memoryLimit : automaticHardMemoryLimit(options.tokenBudget);
  const detailLimit = mcpAnswerMode ? 12 : options.tokenBudget >= 10_000 ? 36 : options.tokenBudget >= 7_000 ? 24 : options.tokenBudget >= 5_000 ? 18 : 12;
  const packetOverhead = 100;
  const structuredScale = options.structuredBudgetScale ?? 1;
  const anchorSceneBudget = mcpAnswerMode ? (structuredMcpAnswer ? Math.min(1_100, Math.floor(options.tokenBudget * 0.55)) : 0) : sharedStateBudget(options.tokenBudget);
  const spineBudget = mcpAnswerMode ? 0 : Math.floor(Math.min(800, options.tokenBudget * 0.15) * structuredScale);
  const anchorManifest = emptyPacketManifest();
  const stateTrace = !mcpAnswerMode && options.collectDiagnostics ? options.stateOutcomeCapture ?? new StateOutcomeCapture() : undefined;
  if (options.memoryOnlyInjection && stateTrace && !options.deferAutomaticBudget) {
    for (const item of collectStateEvidence(db, options.chatId, stateTrace, perspective)) stateTrace.record(perspective, item, "memory_only");
    stateTrace.budget(perspective, anchorSceneBudget, 0);
  }
  // Entity names locate participants; they cannot alone justify every ledger row.
  const ledgerOverlap = (text: string, requested = signals): number => requested.reduce((score, signal) =>
    score + overlapScore(contentTokensForAspect(signal.text, searchTokens(signal.text), entities), text) * signal.weight, 0);
  const ledgerRelevance: LedgerRelevance = (text) => Math.max(0, ...aspects.map(aspect => {
    const tokens = contentTokensForAspect(aspect, searchTokens(aspect), entities);
    return hasEntityAnchorGrounding(aspect, text, entities) && tokens.size > 0 && overlapScore(tokens, text) >= 0.72 ? 1 : 0;
  }));
  const stateHits: StateEvidenceHit[] = [];
  const openManifest = emptyPacketManifest();
  const anchors = options.memoryOnlyInjection || options.deferAutomaticBudget ? "" : stableAnchors(
    db,
    options.chatId,
    perspective,
    chat.profile,
    anchorSceneBudget,
    intent,
    signals,
    coverage,
    mcpAnswerMode,
    options.activePerspectives ?? [],
    archiveView, anchorManifest, excludedAtomKeys, stateHits, mcpAnswerMode ? ledgerRelevance : undefined, options.stateScores, stateTrace,
  );
  const openThreads = ""; // Open promises share the canonical state selector and budget.
  // Historical milestones retain a small separate allowance; current rows are
  // charged once by the shared compiler when automatic budgeting is deferred.
  const historyBudget = options.deferAutomaticBudget ? Math.floor(options.tokenBudget * .05 * structuredScale)
    : Math.max(0, Math.floor(options.tokenBudget * .15 * structuredScale) - estimateTokens(anchors));
  const physical: StructuredRender = options.memoryOnlyInjection ? { xml: "", atomKeys: [], ids: [] } : renderPhysicalIntimacy(db, options.chatId, perspective, options.activePerspectives ?? [],
    Math.min(mcpAnswerMode ? 700 : 520, mcpAnswerMode ? Math.floor(options.tokenBudget * .45) : historyBudget), physicalMcpAnswer, archiveView, mcpAnswerMode ? excludedAtomKeys : undefined, signals, mcpAnswerMode ? ledgerRelevance : undefined);
  const relationshipLandmarks: StructuredRender = options.memoryOnlyInjection ? { xml: "", atomKeys: [], ids: [] } : renderRelationshipLandmarks(db, options.chatId, perspective, options.activePerspectives ?? [], chat.profile,
    Math.min(mcpAnswerMode ? 520 : 360, mcpAnswerMode ? Math.floor(options.tokenBudget * .3) : Math.max(0, historyBudget - estimateTokens(physical.xml))), coverage, mcpAnswerMode, mcpAnswerMode ? excludedAtomKeys : undefined, signals, mcpAnswerMode ? ledgerRelevance : undefined);
  const spineParts = [openThreads].filter(Boolean);
  const spine = spineParts.length ? `<continuity_spine>\n${spineParts.join("\n")}\n</continuity_spine>` : "";
  const stable = [anchors, relationshipLandmarks.xml, physical.xml].filter(Boolean).join("\n");
  const selected: MemoryContextItem[] = [];
  let used = estimateTokens(stable) + estimateTokens(spine) + packetOverhead;
  let dialogueUsed = 0;
  let detailUsed = 0;
  const dialogueBudget = Math.floor(options.tokenBudget * (mcpAnswerMode ? 0.38 : 0.2));
  let selectedAssociativeTokens = 0;
  const selectionOutcomes = new Map<string, RetrievalCandidateTrace["outcome"]>();
  const selectedRoles = new Map<string, RetrievalSelectionRole>();
  for (const item of orderedCandidates) {
    let atomFilteredItem = mcpAnswerMode ? filterMemoryAtoms(item, excludedAtomKeys) as Ranked : item;
    if (mcpAnswerMode) {
      const matches = aspects.flatMap(aspect => (aspectMatches.get(aspect) ?? []).filter(match => match.item.id === item.id));
      const details = new Set(matches.flatMap(match => match.detailIds));
      const dialogues = new Set(matches.flatMap(match => match.dialogueKeys));
      atomFilteredItem = { ...atomFilteredItem, title: "", content: "", atomAccessVersion: 1, evidence: [],
        details: atomFilteredItem.details.filter(detail => details.has(detail.id)),
        keyDialogues: atomFilteredItem.keyDialogues.filter(dialogue => dialogues.has(memoryDialogueAtomKey(item.id, dialogue))) };
    }
    if (mcpAnswerMode && !hasRenderableMemoryAtom(atomFilteredItem)) {
      selectionOutcomes.set(item.id, "atom_suppressed");
      continue;
    }
    const reservedFocus = !mcpAnswerMode && focusLeaderIdSet.has(item.id);
    const reservedContinuity = !mcpAnswerMode && recentContinuity?.id === item.id;
    const reserved = reservedFocus || reservedContinuity;
    if (!mcpAnswerMode && !options.deferAutomaticBudget && item.candidateClass === "associative" && selectedAssociativeTokens + estimateTokens(renderMemoryItem(item, intent)) > associativeTokenBudget) {
      selectionOutcomes.set(item.id, "association_cap");
      continue;
    }
    if (!options.deferAutomaticBudget && selected.length >= (reserved ? hardMemoryLimit : memoryLimit)) {
      selectionOutcomes.set(item.id, "memory_cap");
      continue;
    }
    if (!mcpAnswerMode && !options.deferAutomaticBudget && !item.raw.pinned && selected.some((chosen) => {
      const rankedChosen = ranked.find((candidate) => candidate.id === chosen.id);
      return rankedChosen ? contentSimilarity(item, rankedChosen, similaritySignatures) >= 0.78 : false;
    })) {
      selectionOutcomes.set(item.id, "duplicate");
      continue;
    }
    if (options.deferAutomaticBudget && !mcpAnswerMode) {
      selected.push(publicMemoryContext(reservedFocus ? { ...atomFilteredItem, ...allAtoms.get(item.id) } : atomFilteredItem));

      selectedRoles.set(item.id, selectionRoleFor(item));
      selectionOutcomes.set(item.id, "selected");
      continue;
    }
    let acceptedItem: Ranked = { ...atomFilteredItem, details: atomFilteredItem.details.slice(0, Math.max(0, detailLimit - detailUsed)) };
    const withoutDialogues = renderMemoryItem({ ...atomFilteredItem, keyDialogues: [] }, intent);
    let rendered = renderMemoryItem(acceptedItem, intent);
    let dialogueCost = Math.max(0, estimateTokens(rendered) - estimateTokens(withoutDialogues));
    if (dialogueUsed + dialogueCost > dialogueBudget && item.keyDialogues.length > 0) {
      acceptedItem = { ...acceptedItem, keyDialogues: acceptedItem.keyDialogues.slice(0, mcpAnswerMode ? 3 : 1) };
      rendered = renderMemoryItem(acceptedItem, intent);
      dialogueCost = Math.max(0, estimateTokens(rendered) - estimateTokens(withoutDialogues));
    }
    if (dialogueUsed + dialogueCost > dialogueBudget) {
      acceptedItem = { ...acceptedItem, keyDialogues: [] };
      rendered = withoutDialogues;
      dialogueCost = 0;
    }
    let cost = estimateTokens(rendered);
    if (reservedFocus && used + cost > options.tokenBudget) {
      const directDetailIds = new Set(item.directDetailIds);
      const coreContext = acceptedItem.details.find((detail) => detail.role === "core");
      const directDetails = acceptedItem.details.filter((detail) => directDetailIds.has(detail.id) || detail === coreContext);
      acceptedItem = {
        ...acceptedItem,
        details: directDetails.length > 0 ? directDetails : acceptedItem.details.slice(0, 1),
        keyDialogues: acceptedItem.keyDialogues.slice(0, 1),
      };
      rendered = renderMemoryItem(acceptedItem, intent);
      dialogueCost = Math.max(0, estimateTokens(rendered) - estimateTokens(renderMemoryItem({ ...acceptedItem, keyDialogues: [] }, intent)));
      cost = estimateTokens(rendered);
    }
    if (used + cost > (reserved ? hardTokenCeiling : options.tokenBudget)) {
      selectionOutcomes.set(item.id, "token_budget");
      continue;
    }
    if (!mcpAnswerMode && item.candidateClass === "associative" && acceptedItem.details.length === 0) {
      selectionOutcomes.set(item.id, "atom_suppressed");
      continue;
    }
    selected.push(publicMemoryContext(acceptedItem));
    used += cost;
    dialogueUsed += dialogueCost;
    detailUsed += acceptedItem.details.length;
    if (!mcpAnswerMode && item.candidateClass === "associative") selectedAssociativeTokens += cost;
    selectedRoles.set(item.id, selectionRoleFor(item));
    selectionOutcomes.set(item.id, "selected");
  }

  const continuityMemoryIds = new Set<string>(recentContinuity ? [recentContinuity.id] : []);
  const continuitySupplementIds = new Set<string>();

  let perspectiveData = [spine, stable].filter(Boolean).join("\n");
  const packetMode = mcpAnswerMode ? "deep_recall" : "context";
  const recentMemoryIds = [...continuityMemoryIds].filter((id) => selected.some((item) => item.id === id));
  const packetPerspectives = options.activePerspectives?.length ? options.activePerspectives
    : ["narrator", "__shared__"].includes(perspective) ? [] : [perspective];
  let packet = selected.length > 0 || perspectiveData
    ? consolidateMemoryPacket(db, options.chatId, false, perspectiveData ? [{ name: perspective, data: perspectiveData }] : [], selected, intent, packetMode, recentMemoryIds, packetPerspectives)
    : "";
  const reservedFinalIds = new Set([...focusLeaderIdSet, ...(recentContinuity ? [recentContinuity.id] : [])]);
  while (!options.deferAutomaticBudget && selected.length > 0 && estimateTokens(packet) > options.tokenBudget) {
    const removableIndex = lastIndexWhere(selected, (item) => !reservedFinalIds.has(item.id));
    if (removableIndex < 0) break;
    const [removed] = selected.splice(removableIndex, 1);
    if (removed) selectionOutcomes.set(removed.id, "final_packet_trim");
    packet = consolidateMemoryPacket(db, options.chatId, false, perspectiveData ? [{ name: perspective, data: perspectiveData }] : [], selected, intent, packetMode, recentMemoryIds.filter((id) => selected.some((item) => item.id === id)), packetPerspectives);
  }
  while (!options.deferAutomaticBudget && selected.length > 0 && estimateTokens(packet) > hardTokenCeiling) {
    const removableIndex = lastIndexWhere(selected, (item) => !focusLeaderIdSet.has(item.id));
    const index = removableIndex >= 0 ? removableIndex : selected.length - 1;
    const [removed] = selected.splice(index, 1);
    if (removed) selectionOutcomes.set(removed.id, "final_packet_trim");
    packet = consolidateMemoryPacket(db, options.chatId, false, perspectiveData ? [{ name: perspective, data: perspectiveData }] : [], selected, intent, packetMode, recentMemoryIds.filter((id) => selected.some((item) => item.id === id)), packetPerspectives);
  }
  if (!options.deferAutomaticBudget && estimateTokens(packet) > hardTokenCeiling && anchors) {
    Object.assign(anchorManifest, emptyPacketManifest());
    perspectiveData = [spine, relationshipLandmarks.xml, physical.xml].filter(Boolean).join("\n");
    packet = consolidateMemoryPacket(db, options.chatId, false, perspectiveData ? [{ name: perspective, data: perspectiveData }] : [], selected, intent, packetMode, recentMemoryIds.filter((id) => selected.some((item) => item.id === id)), packetPerspectives);
  }
  if (!options.deferAutomaticBudget && estimateTokens(packet) > hardTokenCeiling) {
    perspectiveData = "";
    packet = selected.length ? consolidateMemoryPacket(db, options.chatId, false, [], selected, intent, packetMode, recentMemoryIds.filter((id) => selected.some((item) => item.id === id)), packetPerspectives) : "";
  }

  stateHits.push(...(physical.hits ?? []), ...(relationshipLandmarks.hits ?? []));
  const coverageItems: RecallCoverageItem[] = aspects.map((aspect) => {
    if (mcpAnswerMode) {
      const matchingState = stateHits.filter((hit) => ledgerOverlap(hit.text, [{kind:"focus",text:aspect,weight:1}]) >= 0.72);
      if (matchingState.some((hit) => hit.delivered && packet.includes(`<${hit.section ?? "recorded_state"}`))) return { aspect, status: "grounded" as const };
      if (matchingState.length && matchingState.every((hit) => hit.alreadyPresent)) return { aspect, status: "already_present" as const };
      const matching = aspectMatches.get(aspect) ?? [];
      const retained = matching.flatMap(match => {
        const item = selected.find(item => item.id === match.item.id);
        if (!item) return [];
        const details = item.details.filter(detail => match.detailIds.includes(detail.id));
        const dialogues = item.keyDialogues.filter(dialogue => match.dialogueKeys.includes(memoryDialogueAtomKey(item.id, dialogue)));
        return details.length || dialogues.length ? [{ item, details }] : [];
      });
      if (retained.length) return { aspect, status: "grounded" as const, memoryIds: retained.map(({item}) => item.id), detailIds: retained.flatMap(({details}) => details.map(detail => detail.id)) };
      const present = matching.filter(match => match.direct && [
        ...match.item.details.filter(detail => match.detailIds.includes(detail.id)).map(memoryDetailAtomKey), ...match.dialogueKeys,
      ].some(key => excludedAtomKeys.has(key)));
      if (present.length) return { aspect, status: "already_present" as const, memoryIds: present.map(match => match.item.id), detailIds: present.flatMap(match => match.detailIds) };
      return { aspect, status: "no_grounded_hit" as const };
    }
    if (selected.length > 0 || perspectiveData) return { aspect, status: "related" as const };
    if (alreadyProvidedRows.length > 0) return { aspect, status: "already_present" as const };
    return { aspect, status: "no_grounded_hit" as const };
  });

  if (selected.length > 0 && options.reinforce === true && !options.deferReinforcement) {
    const reinforce = db.prepare(`
      UPDATE memories SET recall_count=recall_count+1,last_recalled_revision=?,strength=ROUND(MIN(1.0,strength+0.025),3),updated_at=? WHERE id=?
    `);
    const reinforcedIds = options.seedMemoryId && selected.some((item) => item.id === options.seedMemoryId)
      ? [options.seedMemoryId]
      : [...selected].sort((left, right) => {
        const leftRanked = rankedById.get(left.id);
        const rightRanked = rankedById.get(right.id);
        return Math.max(rightRanked?.directSignal ?? 0, rightRanked?.directDetailSignal ?? 0)
          - Math.max(leftRanked?.directSignal ?? 0, leftRanked?.directDetailSignal ?? 0);
      }).slice(0, 1).map((item) => item.id);
    db.transaction(() => {
      for (const id of reinforcedIds) reinforce.run(chat.revision, now(), id);
    })();
  }
  if (selected.length > 0 && !options.deferReinforcement) db.prepare("INSERT INTO recall_logs(id,chat_id,query,perspective,selected_json,elapsed_ms,created_at) VALUES(?,?,?,?,?,?,?)").run(
    randomUUID(), options.chatId, options.query, perspective, JSON.stringify(selected.map((item) => item.id)),
    Math.round(performance.now() - started), now(),
  );
  const selectedIdSet = new Set(selected.map((item) => item.id));
  const selectedCandidateClasses = Object.fromEntries([...selectedIdSet].flatMap((id) => {
    const candidateClass = rankedById.get(id)?.candidateClass;
    return candidateClass ? [[id, candidateClass]] : [];
  })) as Record<string, RetrievalCandidateClass>;
  const selectedRoleMap = Object.fromEntries([...selectedIdSet].map((id) => [id, selectedRoles.get(id) ?? "filler"])) as Record<string, RetrievalSelectionRole>;
  const activationObservations = mcpAnswerMode || ["narrator", "__shared__", "shared"].includes(perspective.toLocaleLowerCase())
    ? [] : [...selectedIdSet].flatMap((id): AutomaticActivationObservation[] => {
    const item = rankedById.get(id);
    const role = selectedRoles.get(id);
    if (!item || !role || !(role === "focus" || role === "serendipity" || (role === "continuity" || options.deferAutomaticBudget) && directAbsolute(item))) return [];
    const deliveredDetails = new Map(selected.find(selectedItem => selectedItem.id === id)!.details.map(detail => [detail.id, detail]));
    const atomEvidence = role === "serendipity" ? (pathsByMemory.get(id) ?? []).flatMap(path => {
      const detail = deliveredDetails.get(path.atomIds.at(-1)!);
      const root = pathNodes.get(path.root.atomId);
      return detail && root ? [{ atomKey: memoryDetailAtomKey(detail), observed: path.support, viaMemoryId: root.memoryId }] : [];
    }) : undefined;
    const observed = role === "serendipity" ? atomEvidence?.[0]?.observed ?? 0 : Math.max(item.directSignal, item.directDetailSignal);
    return observed > 0 ? [{ memoryId: id, role: role === "core" ? "continuity" : role, observed, viaMemoryId: atomEvidence?.[0]?.viaMemoryId,
      ...(atomEvidence ? { atomEvidence } : {}) }] : [];
    });
  const deliveredAtomKeys = [...new Set([
    ...selected.flatMap(memoryAtomKeys),
    ...(packet.includes("<recorded_state") ? anchorManifest.atomKeys : []),
    ...(packet.includes("<physical_intimacy") ? physical.atomKeys : []),
    ...(packet.includes("<relationship_landmarks") ? relationshipLandmarks.atomKeys : []),
  ])];
  const automaticAtomPriorities: Record<string, AutomaticAtomPriority> = {};
  const detailSources = new Map(detailRows.map((row) => [String(row.id), parseEvidence(String(row.evidence_json ?? "[]")).map((entry) => entry.messageId)]));
  const portfolioEligible = options.deferAutomaticBudget && !mcpAnswerMode
    ? ranked.filter(item => !promptCoveredCandidateIds.has(item.id) && (eligible.includes(item) || tierAllowsRecall(item) || allAtoms.get(item.id)?.details.some(detail=>detail.seed?.status==="open"))) : eligible;
  const automaticPriorityItems = new Map([...portfolioEligible, ...selected].map((item) => [item.id,
    projectPathItem({ ...rankedById.get(item.id)!, ...item, ...allAtoms.get(item.id) })]));
  const connectionWeights = new Map<string, Map<string, number>>();
  if (options.deferAutomaticBudget && !mcpAnswerMode) for (const item of automaticPriorityItems.values()) {
    const hits = options.semanticAtomHits?.get(item.id) ?? (options.semanticHits?.get(item.id) ? [options.semanticHits.get(item.id)!] : []);
    const via = rankedById.get(item.id)?.viaMemoryId ?? eventClusterResult.connections.get(item.id)?.parentId;
    const parent = via ? allAtoms.get(via) : undefined;
    const parentSources = new Set(parent ? [...parent.details.flatMap((detail) => detailSources.get(detail.id) ?? []), ...parent.keyDialogues.map((dialogue) => dialogue.messageId)] : []);
    if (via && parent && !connectionWeights.has(via)) connectionWeights.set(via, discriminativeSearchTokenWeights(db, options.chatId,
      [...parent.details.map((detail) => detail.text), ...parent.keyDialogues.map((dialogue) => dialogue.text)].join(" "), chat.memory_language));
    const publicMemoryText = `${item.title} ${item.content} ${item.details.map((detail) => detail.text).join(" ")} ${item.keyDialogues.map((dialogue) => dialogue.text).join(" ")}`;
    const memoryCueViews = Object.fromEntries(signals.flatMap((signal, signalIndex) => {
      if (signal.kind !== "cue") return [];
      const searchableIndex = searchableSignals.indexOf(signal);
      if (searchableIndex < 0) return [];
      const tokenWeights = discriminativeSignals[searchableIndex]!.tokens;
      const lexicalFit = idfWeightedCoverage(tokenWeights, publicMemoryText) + orderedProximityBonus(tokenWeights, publicMemoryText);
      const semanticFit = options.semanticViewScores?.[signalIndex]?.get(item.id) ?? 0;
      // Candidate qualification has already happened at memory level. These
      // weaker scores only map an eligible direct memory to a cue and choose
      // one of its public atoms; they never grant core or direct status. Use
      // late fusion rather than adding the two scales so same-language exact
      // wording does not automatically double a multilingual semantic route.
      if (lexicalFit < 0.16 && semanticFit < 0.35) return [];
      return [[String(signalIndex), Math.max(lexicalFit, semanticFit) * queryViewAuthority(signal.weight, maximumSignalWeight)]];
    }));
    const rankAtom = (key: string, text: string, sourceId: string | undefined, sourceMessageIds: string[]) => {
      const atomPath = item.candidateClass === "associative"
        ? pathsByMemory.get(item.id)?.find(path => path.atomIds.at(-1) === sourceId) : undefined;
      const lexical = (kind: string) => discriminativeWeightedOverlap(discriminativeSignals.filter((_, index) => searchableSignals[index]?.kind === kind), text);
      const atomHits = hits.filter((hit) => hit.sourceId === sourceId && hit.kind === "memory_detail");
      // Below-threshold scores sort content inside an already selected scene;
      // they never change candidate membership or the direct protection set.
      const semanticFor = (kind: string) => Math.max(0, ...atomHits.filter((hit) => hit.viewIndex === undefined ? kind === "focus" : signals[hit.viewIndex]?.kind === kind).map((hit) => hit.score * queryViewAuthority(signals[hit.viewIndex ?? 0]?.weight ?? maximumSignalWeight, maximumSignalWeight)));
      const atomCueViews = Object.fromEntries(signals.flatMap((signal, signalIndex) => {
        if (signal.kind !== "cue") return [];
        const searchableIndex = searchableSignals.indexOf(signal);
        if (searchableIndex < 0) return [];
        const tokenWeights = discriminativeSignals[searchableIndex]!.tokens;
        const lexicalFit = idfWeightedCoverage(tokenWeights, text) + orderedProximityBonus(tokenWeights, text);
        const semanticHit = Math.max(0, ...atomHits.filter((hit) => hit.viewIndex === signalIndex).map((hit) => hit.score));
        // Strong atom-local evidence remains preferable when it exists.
        if (lexicalFit < 0.16 && semanticHit < 0.72) return [];
        const authority = queryViewAuthority(signal.weight, maximumSignalWeight);
        return [[String(signalIndex), (lexicalFit + (semanticHit >= 0.72 ? semanticHit : 0)) * authority]];
      }));
      const cueViews = Object.fromEntries([...new Set([...Object.keys(memoryCueViews), ...Object.keys(atomCueViews)])]
        .map((view) => [view, Math.max(Number(memoryCueViews[view] ?? 0), Number(atomCueViews[view] ?? 0))]));
      automaticAtomPriorities[key] = { focus: lexical("focus") + semanticFor("focus"), cue: lexical("cue") + semanticFor("cue"), scene: lexical("scene") + semanticFor("scene"),
        semantic: Math.max(semanticFor("focus"), semanticFor("cue")), sourceMessageIds,
        connectionViaMemoryId: atomPath ? pathNodes.get(atomPath.root.atomId)?.memoryId : via,
        ...(item.candidateClass === "associative" ? { connectionEvidence: "typed_atom_relation" as const } : {}),
        ...(Object.keys(cueViews).length ? { cueViews } : {}),
        connection: item.candidateClass === "associative"
          ? atomPath?.support ?? 0
          : sourceMessageIds.some((id) => parentSources.has(id)) ? 2 : via ? idfWeightedCoverage(connectionWeights.get(via) ?? new Map(), text) : 0 };
    };
    for (const detail of item.details) rankAtom(memoryDetailAtomKey(detail), detail.text, detail.id, detailSources.get(detail.id) ?? []);
    for (const dialogue of item.keyDialogues) rankAtom(memoryDialogueAtomKey(item.id, dialogue), dialogue.text, dialogue.id, [dialogue.messageId]);
  }
  const answers = mcpAnswerMode ? aspects.map(aspect => ({ question: aspect,
    alreadyPresent: (aspectMatches.get(aspect) ?? []).some(match => match.item.details.some(detail => match.detailIds.includes(detail.id) && excludedAtomKeys.has(memoryDetailAtomKey(detail)))
      || match.dialogueKeys.some(key => excludedAtomKeys.has(key)))
      || stateHits.some(hit => hit.alreadyPresent && ledgerOverlap(hit.text, [{kind:"focus",text:aspect,weight:1}]) >= .72),
    evidence: [
      ...(aspectMatches.get(aspect) ?? []).flatMap(match => {
        const item = selected.find(item => item.id === match.item.id);
        if (!item) return [];
        const meta = { memoryId: item.id, time: item.storyTime };
        return [
          ...item.details.filter(detail => match.detailIds.includes(detail.id)).map(detail => ({ ...meta,
            atomKey: memoryDetailAtomKey(detail), kind: "fact" as const, text: detail.text, knownBy: detail.knownBy,knownByLabels:detail.knownByLabels,
            location: detail.locations.join(", "), basis: detail.epistemic })),
          ...item.keyDialogues.filter(dialogue => match.dialogueKeys.includes(memoryDialogueAtomKey(item.id, dialogue))).map(dialogue => ({ ...meta,
            atomKey: memoryDialogueAtomKey(item.id, dialogue), kind: "quote" as const, text: dialogue.text, speaker: dialogue.speaker, knownBy: dialogue.knownBy,knownByLabels:dialogue.knownByLabels })),
        ];
      }),
      ...stateHits.filter(hit => hit.delivered && deliveredAtomKeys.includes(hit.atomKey)
        && ledgerOverlap(hit.text, [{kind:"focus",text:aspect,weight:1}]) >= 0.72).map(hit => ({
          atomKey: hit.atomKey, kind: "fact" as const, text: hit.presentation ?? hit.text, knownBy: hit.knownBy,
        })),
    ],
  })) : undefined;
  const portfolioArcs = options.deferAutomaticBudget && !mcpAnswerMode ? db.prepare(`SELECT id,start_ordinal,end_ordinal FROM story_spine_nodes
    WHERE chat_id=? AND generation_id='active' AND status='active' AND hidden=0 AND level='arc'
    ORDER BY end_ordinal-start_ordinal,start_ordinal,id`).all(options.chatId) as Array<{id:string;start_ordinal:number;end_ordinal:number}> : [];
  const associationHits = new Map([...options.semanticAtomHits ?? []].map(([id, hits]) => [id, hits
    .filter(hit => hit.kind === "memory_detail" && Number.isInteger(hit.viewIndex)
      && ["focus", "cue", "scene"].includes(signals[hit.viewIndex!]?.kind ?? "") && (signals[hit.viewIndex!]?.weight ?? 0) > 0)
    .map(hit => ({ ...hit, adjustedScore: hit.score * queryViewAuthority(signals[hit.viewIndex!]!.weight, maximumSignalWeight) }))]));
  // The reference peak belongs to the whole search, including direct/already selected hits.
  const bestAdjustedDetailScore = Math.max(0, ...[...associationHits.values()].flat().map(hit => hit.adjustedScore));
  const candidateEvidence = {
    answers,
    automaticPortfolioCandidates: options.deferAutomaticBudget && !mcpAnswerMode ? new Map(portfolioEligible.map(item => {
      const hits = (associationHits.get(item.id) ?? []).filter(hit => hit.adjustedScore >= ASSOCIATION_RELATIVE_THRESHOLD * bestAdjustedDetailScore
        && hit.score < ASSOCIATION_SEMANTIC_MAX
        && allAtoms.get(item.id)?.details.some(detail => detail.id === hit.sourceId))
        .sort((a,b) => b.adjustedScore - a.adjustedScore || a.sourceId.localeCompare(b.sourceId));
      const time = item.raw.story_time_normalized ? Date.parse(item.raw.story_time_normalized.replace(" ", "T")) : NaN;
      return [item.id, { baseDirect: item.baseDirect, core: item.candidateClass === "core", similarity: similaritySignatures.get(item.id)!,
        sourceOrdinal: item.raw.source_ordinal ?? item.raw.created_revision, storyTime: Number.isFinite(time) ? time : undefined,
        period: item.raw.source_ordinal === undefined || item.raw.source_ordinal === null ? undefined
          : portfolioArcs.find(arc => item.raw.source_ordinal! >= arc.start_ordinal && item.raw.source_ordinal! <= arc.end_ordinal)?.id,
        typedDetailIds: (pathsByMemory.get(item.id) ?? []).map(path => path.atomIds.at(-1)!),
        resemblance: hits[0] ? { detailId: hits[0].sourceId, score: hits[0].score, adjustedScore: hits[0].adjustedScore } : undefined }];
    })) : undefined,
    automaticAtomPriorities,
    automaticAssociationSources: Object.fromEntries(selected.flatMap((item) => {
      const via = rankedById.get(item.id)?.viaMemoryId ?? eventClusterResult.connections.get(item.id)?.parentId;
      return via ? [[item.id, via]] : [];
    })),
    structuredManifest: perspectiveData ? mergePacketManifests([anchorManifest, openManifest, {
      ...emptyPacketManifest(), atomKeys: [...physical.atomKeys, ...relationshipLandmarks.atomKeys], intimacyMilestoneIds: physical.ids,
    }]) : emptyPacketManifest(),
    eligibleCandidates: portfolioEligible.map(item => {
      const projected=projectPathItem({...item,...allAtoms.get(item.id)});
      const visible=publicMemoryContext(projected);
      return {...visible,details:visible.details.map(detail=>({...detail,seed:projected.details.find(atom=>atom.id===detail.id)?.seed}))};
    }),
    directAtomKeys: ranked.flatMap((item) => [
      ...item.details.filter((detail) => item.directDetailIds.includes(detail.id)).map(memoryDetailAtomKey),
      ...item.keyDialogues.filter((dialogue) => options.deferAutomaticBudget && !mcpAnswerMode
        ? discriminativeWeightedOverlap(discriminativeSignals.filter((_, index) => searchableSignals[index]?.kind !== "scene"), dialogue.text) > 0
        : weightedOverlap(signals, dialogue.text) > 0).map((dialogue) => memoryDialogueAtomKey(item.id, dialogue)),
    ]),
  };
  if (!options.collectDiagnostics) return { ...candidateEvidence,
    packet, stableAnchors: stable, perspectiveData, estimatedTokens: packet ? estimateTokens(packet) : 0,
    selected, coverage: coverageItems, alreadyProvidedIds,
    recentMemoryIds: recentMemoryIds.filter((id) => selectedIdSet.has(id)),
    focusLeaderIds: focusLeaders.map((item) => item.id).filter((id) => selectedIdSet.has(id)),
    continuityBridgeIds: recentContinuity && selectedIdSet.has(recentContinuity.id) ? [recentContinuity.id] : [],
    selectedCandidateClasses,
    selectedRoles: selectedRoleMap,
    activationObservations,
    deliveredAtomKeys,
  };
  const eligibleIdSet = new Set(eligible.map((item) => item.id));
  const orderedIdSet = new Set(orderedCandidates.map((item) => item.id));
  const laneMap = new Map<string, Set<string>>();
  const markLane = (name: string, items: Ranked[]): void => {
    for (const item of items) {
      const lanes = laneMap.get(item.id) ?? new Set<string>();
      lanes.add(name);
      laneMap.set(item.id, lanes);
    }
  };
  markLane("direct", directHits);
  markLane("historical_detail", historicalDetail);
  markLane("event_cluster", eventExpansion);
  markLane("recent_bridge", recentContinuity ? [recentContinuity] : []);
  markLane("lexical_view", lexicalViewLeaders);
  markLane("semantic_view", [...semanticViewLeaders, ...fusedSemanticLeaders]);
  markLane("focus_lexical", focusLeaders.filter((item) => focusLeaderSources.get(item.id)?.has("lexical")));
  markLane("focus_semantic", focusLeaders.filter((item) => focusLeaderSources.get(item.id)?.has("semantic")));
  markLane("facet", [...aspectMatches.values()].flatMap(matches => matches.filter(match => match.direct).map(match => match.item)));
  markLane("story_arc", ranked.filter((item) => (options.arcMemoryScores?.get(item.id) ?? 0) > 0));
  markLane("associative", associativeCandidates);
  markLane("serendipity", serendipityCandidate ? [serendipityCandidate] : []);
  const selectedClassCounts = { core: 0, associative: 0, continuity: 0 };
  for (const id of selectedIdSet) {
    const candidateClass = rankedById.get(id)?.candidateClass;
    if (candidateClass === "core" || candidateClass === "associative" || candidateClass === "continuity") selectedClassCounts[candidateClass] += 1;
  }
  const selectedRoleCounts: Record<RetrievalSelectionRole, number> = { focus: 0, core: 0, continuity: 0, association: 0, serendipity: 0, longterm: 0, filler: 0 };
  for (const role of Object.values(selectedRoleMap)) selectedRoleCounts[role] += 1;
  const diagnostics: RetrievalDiagnostics = {
    ...(!options.stateOutcomeCapture && stateTrace ? { currentState: stateTrace.snapshot() } : {}),
    ...(pathSnapshot ? { atomPathSearch: pathSnapshot.stats } : {}),
    elapsedMs: Math.round(performance.now() - started),
    perspective,
    intent,
    mcpAnswerMode,
    tokenBudget: options.tokenBudget,
    hardTokenCeiling,
    candidateCount: candidates.length,
    eligibleCount: eligible.length,
    orderedCount: orderedCandidates.length,
    usedTokens: packet ? estimateTokens(packet) : 0,
    selectedIds: [...selectedIdSet],
    ...(mcpAnswerMode ? {mcpQuestions: aspects.map(question => ({question,candidates:(aspectMatches.get(question) ?? []).map(match => ({
      memoryId:match.item.id,rankScore:match.score,detailIds:match.detailIds,dialogueKeys:match.dialogueKeys,
      rawAtomHits: options.aspectSemanticAtomHits?.get(question)?.get(match.item.id)
        ?? (options.aspectSemanticHits?.get(question)?.get(match.item.id) ? [options.aspectSemanticHits.get(question)!.get(match.item.id)!]
          : question === options.query ? options.semanticAtomHits?.get(match.item.id) ?? (options.semanticHits?.get(match.item.id) ? [options.semanticHits.get(match.item.id)!] : []) : []),
    }))}))} : {}),
    focusLeaderIds: focusLeaders.map((item) => item.id).filter((id) => selectedIdSet.has(id)),
    continuityBridgeIds: recentContinuity && selectedIdSet.has(recentContinuity.id) ? [recentContinuity.id] : [],
    overflowTokens: Math.max(0, (packet ? estimateTokens(packet) : 0) - options.tokenBudget),
    overflowSlotUsed: selected.length > memoryLimit,
    recentMemoryIds: recentMemoryIds.filter((id) => selectedIdSet.has(id)),
    bridgeMemoryIds: recentContinuity && selectedIdSet.has(recentContinuity.id) ? [recentContinuity.id] : [],
    continuitySupplementIds: [...continuitySupplementIds].filter((id) => selectedIdSet.has(id)),
    selectedClassCounts,
    selectedRoleCounts,
    associativeTokenBudget,
    promptCoveredMemoryIds: [...promptCoveredCandidateIds],
    promptCoveredDetailIds: [...promptCoveredDetailIds],
    promptCoveredDialogueIds: [...promptCoveredDialogueIds],
    excludedMemoryIds: [...excludedIds],
    candidates: [...ranked].sort((left, right) => right.score - left.score).slice(0, 40).map((item) => {
      const eventConnection = eventClusterResult.connections.get(item.id);
      return {
        id: item.id,
        type: item.type,
        title: item.raw.title,
        sourceOrdinal: item.sourceOrdinal,
        score: Number(item.score.toFixed(4)),
        directSignal: Number(item.directSignal.toFixed(4)),
        directDetailSignal: Number(item.directDetailSignal.toFixed(4)),
        baseDirect: Number(item.baseDirect.toFixed(4)),
        cognitiveBonus: Number(item.cognitiveBonus.toFixed(4)),
        viewAuthority: Number(item.viewAuthority.toFixed(4)),
        retrievalSignal: Number(item.retrievalSignal.toFixed(4)),
        detailSignal: Number(item.detailSignal.toFixed(4)),
        lexicalScore: Number((fts.get(item.id) ?? 0).toFixed(4)),
        matchedLexicalTokens: matchedLexicalTokens(lexicalSearch, signals, item.id),
        semanticScore: Number((options.semanticScores?.get(item.id) ?? 0).toFixed(4)),
        arcScore: Number(item.arcSignal.toFixed(4)),
        associationScore: Number(item.associationSignal.toFixed(4)),
        propagatedEnergy: Number(item.propagatedEnergy.toFixed(4)),
        ...(item.atomPath ? { atomPath: item.atomPath } : {}),
        residualActivation: Number(item.residualActivation.toFixed(4)),
        viaMemoryId: item.viaMemoryId,
        candidateClass: item.candidateClass,
        selectionRole: selectedRoles.get(item.id),
        expansionReasons: item.expansionReasons,
        eventConnection: eventConnection ? {
          parentId: eventConnection.parentId,
          depth: eventConnection.depth,
          activation: Number(eventConnection.activation.toFixed(4)),
          weight: Number(eventConnection.weight.toFixed(4)),
          reason: eventConnection.reason,
        } : undefined,
        recallPath: {
          version: 1,
          direct: recallPaths?.direct.get(item.id),
          graph: recallPaths?.graph.get(item.id),
          event: recallPaths?.event.get(item.id),
          unobserved: [
            ...(item.arcSignal > 0 ? ["story_arc" as const] : []),
            ...((associationScores.get(item.id) ?? 0) > 0 && !recallPaths?.graph.has(item.id) ? ["initial_association" as const] : []),
            ...(item.residualActivation > 0 ? ["residual" as const] : []),
            ...(!item.atomPath && !recallPaths?.direct.has(item.id) && !recallPaths?.graph.has(item.id) && !recallPaths?.event.has(item.id)
              ? ["no_recorded_path" as const] : []),
          ],
        },
        semanticHit: options.semanticHits?.get(item.id) ? {
          kind: options.semanticHits.get(item.id)!.kind,
          sourceId: options.semanticHits.get(item.id)!.sourceId,
          score: Number(options.semanticHits.get(item.id)!.score.toFixed(4)),
        } : undefined,
        focusRank: focusLeaders.findIndex((leader) => leader.id === item.id) >= 0
          ? focusLeaders.findIndex((leader) => leader.id === item.id) + 1
          : undefined,
        focusSources: focusLeaderSources.get(item.id) ? [...focusLeaderSources.get(item.id)!] : undefined,
        lanes: [...(laneMap.get(item.id) ?? [])],
        outcome: selectedIdSet.has(item.id) ? "selected" as const
          : !eligibleIdSet.has(item.id) ? "ineligible" as const
            : !orderedIdSet.has(item.id) ? "not_reserved" as const
              : selectionOutcomes.get(item.id) ?? "memory_cap" as const,
      };
    }),
    arcExpansion: options.arcExpansionDiagnostics ?? [],
  };
  return { packet,
    ...candidateEvidence,
    stableAnchors: stable, perspectiveData, estimatedTokens: packet ? estimateTokens(packet) : 0, selected, coverage: coverageItems, alreadyProvidedIds, recentMemoryIds: diagnostics.recentMemoryIds, focusLeaderIds: diagnostics.focusLeaderIds, continuityBridgeIds: diagnostics.continuityBridgeIds, selectedCandidateClasses, selectedRoles: selectedRoleMap, activationObservations, deliveredAtomKeys, diagnostics };
}
