import { estimateTokens, renderMemoryScene, projectMemoryScene, type MemoryContextItem } from "@rcm/shared";
import { memoryDetailAtomKey, memoryDialogueAtomKey } from "./memory-atoms.js";
import { signatureSimilarity, type SimilaritySignature, type RetrievalSelectionRole } from "./retrieval.js";

export const AUTOMATIC_ROLE_SHARES = { scene: .50, continuity: .15, association: .20, longterm: .15 } as const;
export const ASSOCIATION_COOLDOWN_TURNS = 3;
export const LONGTERM_COOLDOWN_TURNS = 6;
export const OPEN_SEED_COOLDOWN_TURNS = 8;
export const ASSOCIATION_RELATIVE_THRESHOLD = .85;
export const ASSOCIATION_SEMANTIC_MAX = .72;
export const PERIPHERAL_NOVELTY_WEIGHT = .40;
export const AUTOMATIC_NEAR_DUPLICATE = .78;

export interface AutomaticPortfolioCandidate {
  baseDirect: number;
  core: boolean;
  similarity: SimilaritySignature;
  sourceOrdinal: number;
  period?: string;
  storyTime?: number;
  typedDetailIds: string[];
  resemblance?: { detailId: string; score: number; adjustedScore: number };
}

export type AutomaticRoleReason =
  | { kind: "cue_anchor" | "focus" | "direct" | "state_source" | "story_support" | "recent_bridge" }
  | { kind: "typed_atom_relation"; viaMemoryId?: string }
  | { kind: "resembles_now"; score: number; adjustedScore: number }
  | { kind: "open_seed"; seedType: NonNullable<MemoryContextItem["details"][number]["seed"]>["type"]; detailId: string }
  | { kind: "not_recalled_for"; turns: number | null; participants: string[] };

/** One global token portfolio after access, prompt coverage and Story/state selection.
 * renderTokens measures the actual packet, including shared metadata and suppression. */
export function selectAutomaticPortfolio(options: {
  candidates: MemoryContextItem[];
  metadata: ReadonlyMap<string, AutomaticPortfolioCandidate>;
  policy: AutomaticPacketPolicy;
  stateSourceIds: ReadonlySet<string>;
  storySupportIds: ReadonlySet<string>;
  storySupportAtomIds: ReadonlySet<string>;
  activeParticipants: string[];
  lastDelivered: ReadonlyMap<string, number>;
  completedTurn: number;
  hardTokenCeiling: number;
  stateTokens?: number;
  renderTokens: (items: MemoryContextItem[]) => number;
}): { items: MemoryContextItem[]; roles: Map<string, RetrievalSelectionRole>; reasons: Map<string, AutomaticRoleReason> } {
  const { candidates, metadata, policy, renderTokens } = options;
  const items: MemoryContextItem[] = [];
  const roles = new Map<string, RetrievalSelectionRole>();
  const reasons = new Map<string, AutomaticRoleReason>();
  const protectedIds = new Set(policy.focusIds);
  const cueIds = new Set(candidates.filter(item => automaticAtoms(item).some(atom => policy.cueAnchorKeys?.has(atom.key))).map(item => item.id));
  cueIds.forEach(id => protectedIds.add(id));
  const emptyTokens = renderTokens([]);
  const stateTokens = options.stateTokens ?? 0;
  const memoryBudget = Math.max(0, options.hardTokenCeiling - emptyTokens + stateTokens);
  const budgets = { scene: memoryBudget * AUTOMATIC_ROLE_SHARES.scene, continuity: memoryBudget * AUTOMATIC_ROLE_SHARES.continuity,
    association: memoryBudget * AUTOMATIC_ROLE_SHARES.association, longterm: memoryBudget * AUTOMATIC_ROLE_SHARES.longterm };
  // Charge actual shared state use to peripheral lanes first. An empty ledger
  // reserves nothing; scene and continuity keep their original token shares.
  let stateCost = stateTokens;
  for (const lane of ["longterm", "association", "continuity", "scene"] as const) {
    const take = Math.min(stateCost, budgets[lane]); budgets[lane] -= take; stateCost -= take;
  }
  const selectedIds = new Set<string>();
  const redundancy = (item: MemoryContextItem) => {
    const signature = metadata.get(item.id)?.similarity;
    return signature ? Math.max(0, ...items.flatMap(selected => {
      const other = metadata.get(selected.id)?.similarity;
      return other ? [signatureSimilarity(signature, other)] : [];
    })) : 0;
  };
  const accept = (item: MemoryContextItem, role: RetrievalSelectionRole, reason: AutomaticRoleReason) => {
    items.push(item); selectedIds.add(item.id); roles.set(item.id, role); reasons.set(item.id, reason);
  };
  for (const item of candidates.filter(item => protectedIds.has(item.id))) {
    accept(item, policy.focusIds.has(item.id) ? "focus" : "core", { kind: cueIds.has(item.id) ? "cue_anchor" : "focus" });
  }
  let used = Math.max(0, renderTokens(items) - emptyTokens);
  let borrowed = Math.max(0, used - budgets.scene);
  for (const lane of ["longterm", "association"] as const) {
    const take = Math.min(borrowed, budgets[lane]); budgets[lane] -= take; budgets.scene += take; borrowed -= take;
  }
  const scene = candidates.filter(item => !selectedIds.has(item.id) && metadata.get(item.id)?.core)
    .sort((a,b) => metadata.get(b.id)!.baseDirect - metadata.get(a.id)!.baseDirect || a.id.localeCompare(b.id));
  for (const item of scene) {
    if (redundancy(item) >= AUTOMATIC_NEAR_DUPLICATE) continue;
    const next = renderTokens([...items, item]) - emptyTokens;
    if (next <= budgets.scene) { accept(item, "core", { kind: "direct" }); used = next; }
  }
  const sceneItems = [...items];
  const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
  const people = new Set([...options.activeParticipants, ...sceneItems.flatMap(item => item.participants)].map(normalize));
  const age = (id: string) => options.lastDelivered.has(id) ? Math.max(0, options.completedTurn - options.lastDelivered.get(id)!) : Infinity;
  const actors = new Set(options.activeParticipants.map(normalize));
  const openSeed = (item: MemoryContextItem) => age(item.id) > OPEN_SEED_COOLDOWN_TURNS
    ? item.details.filter(detail => detail.seed?.status === "open" && detail.seed.noticedBy.some(name => actors.has(normalize(name))))
      .sort((a,b) => (a.sourceOrdinal ?? Infinity) - (b.sourceOrdinal ?? Infinity) || a.id.localeCompare(b.id))[0] : undefined;
  let seedSelected = false;
  const differentPeriod = (item: MemoryContextItem): boolean => {
    const candidate = metadata.get(item.id);
    return Boolean(candidate && sceneItems.length && sceneItems.every(scene => {
      const current = metadata.get(scene.id);
      return current && (candidate.period && current.period && candidate.period !== current.period
        || candidate.storyTime !== undefined && current.storyTime !== undefined && Math.abs(candidate.storyTime - current.storyTime) >= 7 * 86_400_000);
    }));
  };
  const timeDistance = (item: MemoryContextItem): number => {
    const time = metadata.get(item.id)?.storyTime;
    const distances = time === undefined ? [] : sceneItems.flatMap(scene => {
      const current = metadata.get(scene.id)?.storyTime;
      return current === undefined ? [] : [Math.abs(time - current)];
    });
    return distances.length ? Math.min(...distances) : 0;
  };
  const compact = (item: MemoryContextItem, role: "continuity" | "association" | "longterm", seedDetail?: MemoryContextItem["details"][number]): MemoryContextItem => {
    if (seedDetail) return { ...item, title: "", content: "", atomAccessVersion: 1, evidence: [], details: [seedDetail], keyDialogues: [] };
    const meta = metadata.get(item.id)!;
    const detailIds = role === "association" ? meta.typedDetailIds.length ? meta.typedDetailIds : [meta.resemblance!.detailId] : undefined;
    const storyOnly = role === "continuity" && options.storySupportIds.has(item.id) && !options.stateSourceIds.has(item.id) && !policy.continuityIds.has(item.id);
    const details = (detailIds ? item.details.filter(detail => detailIds.includes(detail.id)) : item.details)
      .filter(detail => (!storyOnly || !options.storySupportAtomIds.has(`detail:${detail.id}`))
        && (role !== "longterm" || !detail.seed));
    if (detailIds) details.sort((a,b) => detailIds.indexOf(a.id) - detailIds.indexOf(b.id));
    if (role === "longterm") details.sort((a,b) => Number(b.kind === "concrete_detail") - Number(a.kind === "concrete_detail"));
    const detail = details[0];
    const sources = new Set(detail ? policy.priorities.get(memoryDetailAtomKey(detail))?.sourceMessageIds ?? [] : []);
    // Typed paths authorize endpoints only. Semantic resemblance may carry its own source dialogue.
    const dialogues = (role === "association" ? meta.typedDetailIds.length ? [] : item.keyDialogues.filter(dialogue =>
      [dialogue.messageId, ...dialogue.evidence.map(evidence => evidence.messageId)].some(id => sources.has(id))) : item.keyDialogues)
      .filter(dialogue => !storyOnly || !options.storySupportAtomIds.has(`dialogue:${dialogue.id}`));
    const selectedDetails = details.slice(0, role === "continuity" ? dialogues.length ? 2 : 3 : dialogues.length ? 1 : 2);
    return { ...item, title: "", content: "", atomAccessVersion: 1, evidence: [],
      details: selectedDetails, keyDialogues: dialogues.slice(0, selectedDetails.length ? 1 : 2) };
  };
  let carry = Math.max(0, budgets.scene - used);
  for (const role of ["continuity", "association", "longterm"] as const) {
    const available = budgets[role] + carry;
    const startTokens = renderTokens(items);
    const pool = candidates.filter(item => !selectedIds.has(item.id) && metadata.has(item.id)).filter(item => {
      if (role === "continuity") return policy.continuityIds.has(item.id) || options.stateSourceIds.has(item.id) || options.storySupportIds.has(item.id);
      if (role === "association") return age(item.id) > ASSOCIATION_COOLDOWN_TURNS && Boolean(metadata.get(item.id)!.typedDetailIds.length || metadata.get(item.id)!.resemblance);
      return Boolean(!seedSelected && openSeed(item)) || age(item.id) > LONGTERM_COOLDOWN_TURNS && item.participants.some(name => people.has(normalize(name)));
    });
    // Round-robin periods, with least recently delivered memories first within each period.
    const periodVisits = new Map<string, number>();
    const period = (item: MemoryContextItem) => metadata.get(item.id)!.period
      ?? (metadata.get(item.id)!.storyTime === undefined ? "undated" : String(Math.floor(metadata.get(item.id)!.storyTime! / (7 * 86_400_000))));
    const recency = (item: MemoryContextItem) => options.lastDelivered.get(item.id) ?? -Infinity;
    while (pool.length) {
      pool.sort((a,b) => {
        const left = metadata.get(a.id)!, right = metadata.get(b.id)!;
        const noveltyScore = (item: MemoryContextItem) => (role === "association" ? metadata.get(item.id)!.resemblance?.score ?? 1 : 1) * (1 - PERIPHERAL_NOVELTY_WEIGHT)
          + (1 - redundancy(item)) * PERIPHERAL_NOVELTY_WEIGHT;
        if (role === "continuity") return right.sourceOrdinal - left.sourceOrdinal || noveltyScore(b) - noveltyScore(a) || a.id.localeCompare(b.id);
        if (role === "longterm" && !seedSelected) {
          const sa=openSeed(a), sb=openSeed(b);
          if (sa || sb) return Number(Boolean(sb)) - Number(Boolean(sa))
            || (sa?.sourceOrdinal ?? left.sourceOrdinal) - (sb?.sourceOrdinal ?? right.sourceOrdinal) || a.id.localeCompare(b.id);
        }
        if (role === "longterm") return (periodVisits.get(period(a)) ?? 0) - (periodVisits.get(period(b)) ?? 0)
          || (recency(a) === recency(b) ? 0 : recency(a) - recency(b)) || noveltyScore(b) - noveltyScore(a) || left.sourceOrdinal - right.sourceOrdinal || a.id.localeCompare(b.id);
        const typed = Number(right.typedDetailIds.length > 0) - Number(left.typedDetailIds.length > 0);
        return typed || (right.resemblance?.adjustedScore ?? 0) - (left.resemblance?.adjustedScore ?? 0)
          || timeDistance(b) - timeDistance(a) || Number(differentPeriod(b)) - Number(differentPeriod(a))
          || noveltyScore(b) - noveltyScore(a) || a.id.localeCompare(b.id);
      });
      const candidate = pool.shift()!;
      if (redundancy(candidate) >= AUTOMATIC_NEAR_DUPLICATE) continue;
      const seedDetail = role === "longterm" && !seedSelected ? openSeed(candidate) : undefined;
      const item = compact(candidate, role, seedDetail);
      if (!automaticAtoms(item).length) continue;
      const nextTokens = renderTokens([...items, item]);
      if (nextTokens - startTokens > available || nextTokens > options.hardTokenCeiling) continue;
      const meta = metadata.get(item.id)!;
      const reason: AutomaticRoleReason = role === "continuity" ? { kind: options.stateSourceIds.has(item.id) ? "state_source"
        : options.storySupportIds.has(item.id) ? "story_support" : "recent_bridge" }
        : role === "association" ? meta.typedDetailIds.length ? { kind: "typed_atom_relation", viaMemoryId: policy.associationSources?.get(item.id) }
          : { kind: "resembles_now", score: meta.resemblance!.score, adjustedScore: meta.resemblance!.adjustedScore }
          : seedDetail ? {kind:"open_seed",seedType:seedDetail.seed!.type,detailId:seedDetail.id}
          : { kind: "not_recalled_for", turns: Number.isFinite(age(item.id)) ? age(item.id) : null,
            participants: item.participants.filter(name => people.has(normalize(name))) };
      accept(item, role, reason);
      if (seedDetail) seedSelected = true;
      periodVisits.set(period(item), (periodVisits.get(period(item)) ?? 0) + 1);
    }
    carry = Math.max(0, available - (renderTokens(items) - startTokens));
  }
  return { items, roles, reasons };
}

/** Internal evidence ranks only: these never grant access or core eligibility. */
export interface AutomaticAtomPriority {
  focus: number;
  cue: number;
  scene: number;
  semantic: number;
  /** Qualified direct evidence for one specific user cue, keyed by query-signal index. */
  cueViews?: Record<string, number>;
  connection?: number;
  connectionViaMemoryId?: string;
  connectionEvidence?: "typed_atom_relation";
  sourceMessageIds: string[];
}
export interface AutomaticPacketPolicy {
  latestStoryTime?: number;
  sceneDepthTokens?: number;
  priorities: ReadonlyMap<string, AutomaticAtomPriority>;
  focusIds: ReadonlySet<string>;
  continuityIds: ReadonlySet<string>;
  roles: ReadonlyMap<string, string>;
  associationSources?: ReadonlyMap<string, string>;
  /** At most one representative atom reserved for an otherwise uncovered user cue. */
  cueAnchorKeys?: ReadonlySet<string>;
}
export interface AutomaticAtomDecision {
  memoryId: string; atomKey: string; role: string; bundle: boolean; direct: boolean;
  cueAnchor?: boolean;
  cueViewIndex?: number;
  localRank: number;
  viaMemoryId?: string;
  connectionEvidence?: "shared_source" | "public_atom_overlap" | "typed_atom_relation";
  tokens: number; outcome: "retained" | "target_budget" | "hard_ceiling" | "memory_removed";
}

export function selectCueAnchor(decisions: AutomaticAtomDecision[], priorities: ReadonlyMap<string, AutomaticAtomPriority>,
  cueWeights: ReadonlyMap<number, number>): { decision: AutomaticAtomDecision; cueViewIndex: number } | undefined {
  const protectedCueScores = new Map<number, number>();
  for (const decision of decisions) {
    if (!(decision.direct && decision.role === "focus" || decision.bundle && ["focus", "continuity"].includes(decision.role))) continue;
    for (const [view, score] of Object.entries(priorities.get(decision.atomKey)?.cueViews ?? {})) {
      const cueViewIndex = Number(view);
      protectedCueScores.set(cueViewIndex, Math.max(protectedCueScores.get(cueViewIndex) ?? 0, score));
    }
  }
  return decisions.flatMap((decision) => {
    if (!decision.direct || decision.role !== "core") return [];
    return Object.entries(priorities.get(decision.atomKey)?.cueViews ?? {}).flatMap(([view, score]) => {
      const cueViewIndex = Number(view);
      const protectedScore = protectedCueScores.get(cueViewIndex) ?? 0;
      const gain = score - protectedScore;
      // Small differences between embedding views are ranking noise, not a
      // reason to consume the single cue reservation. With no protected route
      // the already-qualified core candidate still supplies the safety floor.
      if (protectedScore > 0 && score < protectedScore * 1.1) return [];
      return gain <= 0 ? [] : [{ decision, cueViewIndex, score, gain, weight: cueWeights.get(cueViewIndex) ?? 0 }];
    });
  }).sort((left, right) => right.gain - left.gain || right.score - left.score || right.weight - left.weight
    || left.decision.localRank - right.decision.localRank)[0];
}

export function automaticAtoms(item: MemoryContextItem) {
  return [
    ...item.details.map((detail) => ({ key: memoryDetailAtomKey(detail), text: detail.text, kind: "detail" as const })),
    ...item.keyDialogues.map((dialogue) => ({ key: memoryDialogueAtomKey(item.id, dialogue), text: dialogue.text, kind: "dialogue" as const })),
  ];
}

/** Plan the protected content once, before trimming alters any scene. */
export function planAutomaticAtoms(items: MemoryContextItem[], direct: ReadonlySet<string>, policy: AutomaticPacketPolicy): AutomaticAtomDecision[] {
  return items.flatMap((item) => {
    const atoms = automaticAtoms(item);
    const role = policy.focusIds.has(item.id) ? "focus" : policy.roles.get(item.id) ?? (policy.continuityIds.has(item.id) ? "continuity" : "core");
    const score = (key: string): number[] => {
      const rank = policy.priorities.get(key);
      return [...(["association", "serendipity"].includes(role) ? [rank?.connection ?? 0] : []), rank?.focus ?? 0, rank?.cue ?? 0, rank?.semantic ?? 0, rank?.scene ?? 0];
    };
    const ordered = atoms.map((atom, index) => ({ ...atom, index })).sort((a, b) => {
      const left = score(a.key), right = score(b.key);
      for (let i = 0; i < left.length; i++) if (right[i] !== left[i]) return right[i]! - left[i]!;
      return a.index - b.index;
    });
    const bundle = new Set<string>();
    const seed = ordered[0];
    if (seed && ["focus", "continuity", "association", "serendipity"].includes(role)) {
      bundle.add(seed.key);
      if (role === "focus") {
        const seedSources = new Set(policy.priorities.get(seed.key)?.sourceMessageIds ?? []);
        const seenText = new Set([seed.text]);
        // Connected public atoms restore context; atom kind grants no priority.
        while (bundle.size < 3) {
          const next = ordered.filter((atom) => !bundle.has(atom.key) && !seenText.has(atom.text))
            .filter((atom) => score(atom.key).some((value) => value > 0)
              || policy.priorities.get(atom.key)?.sourceMessageIds.some((id) => seedSources.has(id)))
            .sort((a, b) => Number(policy.priorities.get(b.key)?.sourceMessageIds.some((id) => seedSources.has(id)))
              - Number(policy.priorities.get(a.key)?.sourceMessageIds.some((id) => seedSources.has(id))))[0];
          if (!next) break;
          bundle.add(next.key); seenText.add(next.text);
        }
      }
    }
    const localRanks = new Map(ordered.map((atom, index) => [atom.key, index]));
    return atoms.map((atom) => ({ memoryId: item.id, atomKey: atom.key, role, localRank: localRanks.get(atom.key)!, viaMemoryId: policy.priorities.get(atom.key)?.connectionViaMemoryId ?? policy.associationSources?.get(item.id),
      connectionEvidence: policy.priorities.get(atom.key)?.connectionEvidence ?? ((policy.priorities.get(atom.key)?.connection ?? 0) >= 2 ? "shared_source" as const
        : (policy.priorities.get(atom.key)?.connection ?? 0) > 0 ? "public_atom_overlap" as const : undefined),
      bundle: bundle.has(atom.key), direct: direct.has(atom.key), tokens: estimateTokens(atom.text), outcome: "retained" as const }));
  });
}

/** Drop the least useful remaining unit, including a peripheral scene's last atom. */
export function trimAutomaticAtom(items: MemoryContextItem[], direct: ReadonlySet<string>, allowDirect = false,
  policy?: AutomaticPacketPolicy, decisions?: AutomaticAtomDecision[],
  outcome: AutomaticAtomDecision["outcome"] = allowDirect ? "hard_ceiling" : "target_budget"): boolean {
  if (!policy || !decisions) {
    // Standalone callers retain the original direct-atom protection contract.
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index]!;
      if (automaticAtoms(item).length <= 1) continue;
      const atoms = automaticAtoms(item);
      const atom = [...atoms.filter((entry) => entry.kind === "detail").reverse(),
        ...atoms.filter((entry) => entry.kind === "dialogue").reverse()].find((entry) => removable(item, entry.key) && (allowDirect || !direct.has(entry.key)));
      if (!atom) continue;
      items[index] = removeAtom(item, atom.key);
      return true;
    }
    return false;
  }
  const itemIndices = new Map(items.map((item, index) => [item.id, index]));
  const decisionIndices = new Map(decisions.map((entry, index) => [entry, index]));
  const focusSources = new Map<string, Set<string>>();
  for (const entry of decisions) if (entry.bundle && entry.role === "focus") {
    const sources = focusSources.get(entry.memoryId) ?? new Set<string>();
    for (const id of policy.priorities.get(entry.atomKey)?.sourceMessageIds ?? []) sources.add(id);
    focusSources.set(entry.memoryId, sources);
  }
  const available = decisions.filter((entry) => entry.outcome === "retained" && itemIndices.has(entry.memoryId) && removable(items[itemIndices.get(entry.memoryId)!]!, entry.atomKey)
    // Protect scene depth instead of spreading single fragments across many
    // records. This is a soft floor, never a required count or fabricated text.
    && (allowDirect || !policy.sceneDepthTokens || estimateTokens(renderMemoryScene(projectMemoryScene(removeAtom(items[itemIndices.get(entry.memoryId)!]!, entry.atomKey)), policy.latestStoryTime)) >= policy.sceneDepthTokens)
    && (allowDirect || !policy.sceneDepthTokens || items[itemIndices.get(entry.memoryId)!]!.keyDialogues.length !== 1
      || memoryDialogueAtomKey(entry.memoryId, items[itemIndices.get(entry.memoryId)!]!.keyDialogues[0]!) !== entry.atomKey)
    && (allowDirect || !(entry.direct && entry.role === "focus" || entry.bundle && ["focus", "continuity"].includes(entry.role)
      || policy.cueAnchorKeys?.has(entry.atomKey))));
  const rank = (entry: AutomaticAtomDecision): number[] => {
    const priority = policy.priorities.get(entry.atomKey);
    const reserved = entry.bundle && entry.role === "focus" ? 6 : policy.cueAnchorKeys?.has(entry.atomKey) ? 5
      : entry.bundle && entry.role === "continuity" ? 4
      // A real typed-path endpoint is the strongest form of optional
      // serendipity: keep its representative atom ahead of ordinary optional
      // direct tails, while remaining below focus/cue/continuity protection.
      : entry.bundle && entry.role === "serendipity" && entry.connectionEvidence === "typed_atom_relation" ? 3.5
      : entry.direct ? 3 : entry.bundle && ["association", "serendipity"].includes(entry.role) ? 2
      : entry.role === "focus" && ((priority?.focus ?? 0) + (priority?.cue ?? 0) + (priority?.semantic ?? 0) > 0
        || priority?.sourceMessageIds.some((id) => focusSources.get(entry.memoryId)?.has(id))) ? 1 : 0;
    // Compare local evidence depth, never raw below-threshold scores across
    // memories. Equal-depth content follows the existing portfolio order.
    const protectedMemory = policy.focusIds.has(entry.memoryId) || decisions.some(atom => atom.memoryId === entry.memoryId && policy.cueAnchorKeys?.has(atom.atomKey));
    const lane = protectedMemory ? 4 : entry.role === "longterm" ? 0 : ["association", "serendipity"].includes(entry.role) ? 1 : entry.role === "continuity" ? 2 : 3;
    return [...(outcome === "hard_ceiling" ? [lane] : []), reserved, -entry.localRank, -itemIndices.get(entry.memoryId)!];
  };
  available.sort((a, b) => {
    const left = rank(a), right = rank(b);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
    return decisionIndices.get(b)! - decisionIndices.get(a)!;
  });
  const removed = available[0];
  if (!removed) return false;
  const index = itemIndices.get(removed.memoryId)!;
  const next = removeAtom(items[index]!, removed.atomKey);
  if (!automaticAtoms(next).length && next.atomAccessVersion > 0) items.splice(index, 1);
  else items[index] = next;
  removed.outcome = outcome;
  return true;
}

function removable(item: MemoryContextItem, key: string): boolean {
  if (item.details.filter(detail => detail.role === "core").length === 1
    && item.details.some(detail => detail.role === "core" && memoryDetailAtomKey(detail) === key)
    && automaticAtoms(item).length > 1) return false;
  return !(item.details.length === 1 && item.keyDialogues.length > 0 && memoryDetailAtomKey(item.details[0]!) === key);
}

function removeAtom(item: MemoryContextItem, key: string): MemoryContextItem {
  return { ...item, details: item.details.filter((detail) => memoryDetailAtomKey(detail) !== key),
    keyDialogues: item.keyDialogues.filter((dialogue) => memoryDialogueAtomKey(item.id, dialogue) !== key) };
}
