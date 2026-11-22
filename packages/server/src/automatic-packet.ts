import { packetFloorUsage, type automaticPacketBudget } from "./packet-budget.js";
import { foldMemoryCard, isFoldedMemory, emittedMemoryItems, buildEmissionPlan, factReasonsFor, memoryFactReasons, memoryCardHasContent, planMemoryCard, type FactSelectedMemory } from "./emission-plan.js";
import { emitsMemoryPlot, estimateTokens, isAuthorCard, isException, projectMemoryScene, type MemoryContextItem } from "@rcm/shared";
import { chargedCardTokens } from "./charged-cost.js";
import { publicKnowledgeScope } from "./item-access.js";
import { memoryDetailAtomKey, memoryDialogueAtomKey } from "./memory-atoms.js";
import { signatureSimilarity, type SimilaritySignature } from "./similarity.js";
import { selectFactReasons, type RetrievalSelectionRole } from "./retrieval.js";

export const AUTOMATIC_ROLE_SHARES = { scene: .62, continuity: .15, association: .13, longterm: .10 } as const;

/** Retain the released <=12k independent retrieval count caps. Above it, grow capacity without
 * changing eligibility, access, role shares or the final 115% ceiling.
 * Deferred portfolios already admit all eligible atoms and use token shares;
 * these caps also serve the independently budgeted retrieval path. */
export function automaticMemoryLimit(budget: number): number {
  const current = budget >= 10_000 ? 18 : budget >= 7_000 ? 12 : budget >= 5_000 ? 9 : 6;
  return budget <= 12_000 ? current : Math.max(current, Math.floor(budget / 650));
}

export function automaticDetailLimit(budget: number): number {
  const current = budget >= 10_000 ? 36 : budget >= 7_000 ? 24 : budget >= 5_000 ? 18 : 12;
  return budget <= 12_000 ? current : Math.max(current, Math.floor(budget * 3 / 1000));
}

export function automaticHistoryLimit(budget: number, current: number): number {
  return budget <= 12_000 ? current : Math.max(current, Math.floor(budget * .03));
}
export const ASSOCIATION_COOLDOWN_TURNS = 3;
export const LONGTERM_COOLDOWN_TURNS = 6;
export const OPEN_SEED_COOLDOWN_TURNS = 8;
export const ASSOCIATION_RELATIVE_THRESHOLD = .85;
export const ASSOCIATION_SEMANTIC_MAX = .72;
export const PERIPHERAL_NOVELTY_WEIGHT = .40;
export const AUTOMATIC_NEAR_DUPLICATE = .78;

/** The caller supplies the post-coverage/validity item: omitted plots have no content. */
export function plotBundleDetailIds(item: Pick<MemoryContextItem, "cardShape" | "content" | "atomAccessVersion" | "summaryEvidence" | "knownBy" | "knownByEveryone" | "details">): Set<string> {
  return new Set(isAuthorCard(item) && emitsMemoryPlot(item) ? item.details
    .filter(detail=>isException({...detail,...publicKnowledgeScope(detail.knownBy,detail.knownByEveryone)},item.knownBy)).map(detail=>detail.id) : []);
}

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
  | { kind: "open_seed"; seedType?: NonNullable<MemoryContextItem["details"][number]["seed"]>["type"]; detailId: string }
  | { kind: "not_recalled_for"; turns: number | null; participants: string[] };

/** One global token portfolio after access, prompt coverage and Story/state selection.
 * renderTokens supplies viewpoint-independent charged cost, including shared metadata and suppression. */
export function selectAutomaticPortfolio(options: {
  candidates: MemoryContextItem[];
  metadata: ReadonlyMap<string, AutomaticPortfolioCandidate>;
  policy: AutomaticPacketPolicy;
  stateSourceGroups: readonly (readonly string[])[];
  storySupportIds: ReadonlySet<string>;
  storySupportAtomIds: ReadonlySet<string>;
  activeParticipants: string[];
  lastDelivered: ReadonlyMap<string, number>;
  completedTurn: number;
  longtermFloorActive?: boolean;
  hardTokenCeiling: number;
  allocation?: ReturnType<typeof automaticPacketBudget>;
  directAtomKeys?: ReadonlySet<string>;
  cardTokens?: (item: MemoryContextItem) => number;
  renderTokens: (items: MemoryContextItem[]) => number;
}): { items: MemoryContextItem[]; roles: Map<string, RetrievalSelectionRole>; reasons: Map<string, AutomaticRoleReason>;
  floors: { dialogue: ReturnType<typeof packetFloorUsage>; longterm: ReturnType<typeof packetFloorUsage> } } {
  const { candidates, metadata, policy, renderTokens } = options;
  const items: MemoryContextItem[] = [];
  const roles = new Map<string, RetrievalSelectionRole>();
  const reasons = new Map<string, AutomaticRoleReason>();
  const protectedIds = new Set(policy.focusIds);
  const cueIds = new Set(candidates.filter(item => automaticAtoms(item).some(atom => policy.cueAnchorKeys?.has(atom.key))).map(item => item.id));
  cueIds.forEach(id => protectedIds.add(id));
  const emptyTokens = renderTokens([]);
  // All rendering context (POV pricing, linked-state exclusions and prompt
  // suppression) belongs to this invocation's fixed callback. Cache only that
  // pure callback; the renderTokens fallback may have observable side effects.
  // Selection changes replace cards/atom arrays; inputs are immutable here.
  // Include every DTO field, ordered atoms and symbol-keyed fact provenance.
  const selectionKeys = new WeakMap<MemoryContextItem,string>();
  const selectionKey = (item:MemoryContextItem) => {
    let key=selectionKeys.get(item);
    if (key === undefined) {
      key=JSON.stringify([item,[...factReasonsFor(item)]]);
      selectionKeys.set(item,key);
    }
    return key;
  };
  const charges = new Map<string,number>();
  const cardTokens = options.cardTokens ? (item:MemoryContextItem) => {
    const key=selectionKey(item), cached=charges.get(key);
    if (cached !== undefined) return cached;
    const cost=options.cardTokens!(item); charges.set(key,cost); return cost;
  } : (item:MemoryContextItem) => renderTokens([item]) - emptyTokens;
  const emissions = new WeakMap<MemoryContextItem,MemoryContextItem>();
  const emitted = (item:MemoryContextItem) => {
    let planned=emissions.get(item);
    if (!planned) {planned=emittedMemoryItems(buildEmissionPlan([item]))[0] ?? item; emissions.set(item,planned);}
    return planned;
  };
  const minimums = [new WeakMap<MemoryContextItem,MemoryContextItem>(),new WeakMap<MemoryContextItem,MemoryContextItem>()];
  let packetTokens = emptyTokens;
  const depths = new Map<string, MemoryContextItem>();
  const direct = options.directAtomKeys ?? new Set<string>();
  const minimum = (item: MemoryContextItem, protectedCard = false): MemoryContextItem => {
    const cache=minimums[Number(protectedCard)]!;
    const cached=cache.get(item); if (cached) return cached;
    const planned = emitted(item);
    const exceptions = plotBundleDetailIds(planned);
    const keys = new Set(planAutomaticAtoms([planned],direct,policy)
      .filter(atom => protectedCard && (atom.bundle || policy.cueAnchorKeys?.has(atom.atomKey))).map(atom=>atom.atomKey));
    // Folded and legacy cards need a readable evidence unit in place of Plot.
    if (!emitsMemoryPlot(planned) && !keys.size && !exceptions.size) {
      const first=planAutomaticAtoms([planned],direct,policy).sort((a,b)=>a.localRank-b.localRank)[0];
      if (first) keys.add(first.atomKey);
    }
    const result={...planned,details:planned.details.filter(detail=>exceptions.has(detail.id)||keys.has(memoryDetailAtomKey(detail))),
      keyDialogues:planned.keyDialogues.filter(line=>keys.has(memoryDialogueAtomKey(item.id,line)))};
    cache.set(item,result); return result;
  };
  const rankedDialogues = (item: MemoryContextItem, lines = item.keyDialogues, details: MemoryContextItem["details"] = []) => {
    const ranks=new Map(planAutomaticAtoms([item],direct,policy).map(atom=>[atom.atomKey,atom.localRank]));
    // Plot-less cards have no event prose connecting a quote to a fact. Prefer
    // their already delivered detail's source IDs; never infer meaning from text.
    const sources=new Set(!emitsMemoryPlot(item) ? details.flatMap(detail=>policy.priorities.get(memoryDetailAtomKey(detail))?.sourceMessageIds ?? []) : []);
    const connected=(line:MemoryContextItem["keyDialogues"][number])=>Number([line.messageId,...line.evidence.map(span=>span.messageId),
      ...policy.priorities.get(memoryDialogueAtomKey(item.id,line))?.sourceMessageIds ?? []].some(id=>sources.has(id)));
    return [...lines].sort((a,b)=>connected(b)-connected(a)
      || (ranks.get(memoryDialogueAtomKey(item.id,a))??0)-(ranks.get(memoryDialogueAtomKey(item.id,b))??0));
  };
  const selectedIds = new Set<string>();
  let dialogueTotal=0;
  const dialogueDeltas=new Map<string,number>();
  const updateDialogueCost=(item:MemoryContextItem) => {
    const cost=Math.max(0,cardTokens(item)-cardTokens({...item,keyDialogues:[]}));
    dialogueTotal+=cost-(dialogueDeltas.get(item.id) ?? 0);
    dialogueDeltas.set(item.id,cost);
  };
  const replaceItem=(index:number,item:MemoryContextItem) => {updateDialogueCost(item);items[index]=item;};
  const accept = (item: MemoryContextItem, role: RetrievalSelectionRole, reason: AutomaticRoleReason) => {
    updateDialogueCost(item); items.push(item); packetTokens += cardTokens(item); selectedIds.add(item.id); roles.set(item.id, role); reasons.set(item.id, reason);
  };
  let used = 0;
  const scenePriority = (a: MemoryContextItem,b: MemoryContextItem) => Number(protectedIds.has(b.id))-Number(protectedIds.has(a.id))
    || (metadata.get(b.id)?.baseDirect ?? 0)-(metadata.get(a.id)?.baseDirect ?? 0) || a.id.localeCompare(b.id);
  // Secure direct protected minimums before any long-term expansion. Their
  // protected dialogue already consumes the voice floor, not a second reserve.
  for (const item of candidates.filter(item=>protectedIds.has(item.id)).sort(scenePriority)) {
    const selected=fitAutomaticCard(minimum(item,true),candidate=>packetTokens+cardTokens(candidate)<=options.hardTokenCeiling,direct,policy);
    if (!selected) continue;
    const cost=cardTokens(selected);
    accept(selected,policy.focusIds.has(item.id)?"focus":"core",{kind:cueIds.has(item.id)?"cue_anchor":"focus"});
    depths.set(item.id,emitted(item));
    used+=cost;
  }
  packetTokens=renderTokens(items);
  const protectedCost=used;
  const dialogueCost = () => dialogueTotal;
  const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
  const actors = new Set(options.activeParticipants.map(normalize));
  // State has already been charged in emptyTokens. Never charge it a second
  // time to the long-term share. Each floor remains available before cards fill.
  const dialogueReserved = Math.min(options.allocation?.dialogue ?? 0, Math.max(0, options.hardTokenCeiling - emptyTokens));
  const memoryBudget = Math.max(0, Math.min(options.hardTokenCeiling - emptyTokens - Math.max(0,dialogueReserved-dialogueCost()),
    options.allocation ? options.allocation.eventCards + options.allocation.longterm : Infinity));
  const age = (id: string) => options.lastDelivered.has(id) ? Math.max(0, options.completedTurn - options.lastDelivered.get(id)!) : Infinity;
  const openSeed = (item: MemoryContextItem) => age(item.id) > OPEN_SEED_COOLDOWN_TURNS
    ? item.details.filter(detail => detail.seed?.status === "open")
      .sort((a,b) => Number(b.seed!.noticedBy.some(name => actors.has(normalize(name)))) - Number(a.seed!.noticedBy.some(name => actors.has(normalize(name))))
        || (a.sourceOrdinal ?? Infinity) - (b.sourceOrdinal ?? Infinity) || a.id.localeCompare(b.id))[0] : undefined;
  const compact = (item: MemoryContextItem, role: "continuity" | "association" | "longterm", seedDetail?: MemoryContextItem["details"][number]): MemoryContextItem => {
    if (role !== "continuity") item = foldMemoryCard(item);
    const bundleIds = plotBundleDetailIds(item);
    if (seedDetail) {
      const selected: FactSelectedMemory = { ...item, evidence: [], details: item.details.filter(detail => detail === seedDetail || bundleIds.has(detail.id)), keyDialogues: [],
        [memoryFactReasons]:new Map(factReasonsFor(item)).set(seedDetail.id,[...new Set([...factReasonsFor(item).get(seedDetail.id) ?? [],...selectFactReasons({openSeed:true})])]) };
      return selected;
    }
    const meta = metadata.get(item.id)!;
    const detailIds = role === "association" ? meta.typedDetailIds.length ? meta.typedDetailIds : [meta.resemblance!.detailId] : undefined;
    const storyOnly = role === "continuity" && options.storySupportIds.has(item.id) && !policy.continuityIds.has(item.id);
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
    return { ...item, evidence: [],
      details: isFoldedMemory(item) ? selectedDetails : item.details.filter(detail => selectedDetails.includes(detail) || bundleIds.has(detail.id)), keyDialogues: emitsMemoryPlot(item) ? [] : rankedDialogues(item,dialogues,selectedDetails).slice(0, selectedDetails.length ? 1 : 2) };
  };
  const longtermUnit = (item: MemoryContextItem) => {
    const seed=openSeed(item);
    const selected=minimum(isAuthorCard(item) ? compact(item,"longterm",seed) : item);
    if (!seed || selected.details.some(detail=>detail.id===seed.id)) return selected;
    const unit:FactSelectedMemory={...selected,details:[...selected.details,seed],
      [memoryFactReasons]:new Map(factReasonsFor(item)).set(seed.id,selectFactReasons({openSeed:true}))};
    return unit;
  };
  const nominalLongtermFloor=options.allocation?.longterm ?? 0;
  const activeLongtermFloor=options.longtermFloorActive === false ? 0 : nominalLongtermFloor;
  const longtermUnitLimit=options.allocation ? 2*nominalLongtermFloor : Infinity;
  const remainingMemoryBudget=Math.max(0,memoryBudget-protectedCost);
  const remainingPacketBudget=Math.max(0,options.hardTokenCeiling-packetTokens-Math.max(0,dialogueReserved-dialogueCost()));
  const stateSourceIds=new Set(options.stateSourceGroups.flat());
  // Reserve a real affordable unit, not just its price: ordinary lanes must
  // not consume the cheapest unit and strand a reservation too small for any
  // remaining one. Explicit current-state sources keep their scene route.
  const longtermAnchor = options.allocation && activeLongtermFloor>0 ? candidates.filter(item => metadata.has(item.id)
    && !protectedIds.has(item.id) && !stateSourceIds.has(item.id)
    && (age(item.id) > LONGTERM_COOLDOWN_TURNS || openSeed(item)))
    .map(item=>({item,unit:longtermUnit(item)})).filter(entry=>memoryCardHasContent(entry.unit))
    .map(entry=>({id:entry.item.id,cost:cardTokens(entry.unit)}))
    .filter(entry=>entry.cost<=Math.min(longtermUnitLimit,remainingMemoryBudget,remainingPacketBudget))
    .sort((a,b)=>a.cost-b.cost || a.id.localeCompare(b.id))[0] : undefined;
  const longtermMinimum=longtermAnchor?.cost ?? 0;
  const longtermReserved = Math.min(Math.max(activeLongtermFloor,
    longtermMinimum), remainingMemoryBudget,remainingPacketBudget);
  const budgets = { scene: protectedCost+remainingMemoryBudget * AUTOMATIC_ROLE_SHARES.scene,
    continuity: remainingMemoryBudget * AUTOMATIC_ROLE_SHARES.continuity,
    association: remainingMemoryBudget * AUTOMATIC_ROLE_SHARES.association,
    longterm: Math.max(longtermReserved, remainingMemoryBudget * AUTOMATIC_ROLE_SHARES.longterm) };
  // Only unprotected space can fund a bounded whole-unit expansion.
  let floorCost = Math.max(0, budgets.longterm - remainingMemoryBudget * AUTOMATIC_ROLE_SHARES.longterm);
  for (const lane of ["scene","association","continuity"] as const) {
    const take=Math.min(floorCost,Math.max(0,budgets[lane]-(lane === "scene" ? protectedCost : 0)));
    budgets[lane]-=take; floorCost-=take;
  }
  let longtermHeld=longtermReserved, dialogueHeld=true;
  const cardCeiling=()=>options.hardTokenCeiling-longtermHeld-(dialogueHeld ? Math.max(0,dialogueReserved-dialogueCost()) : 0);
  // Signatures already own the request's token sets. Keep each candidate's
  // maximum and cursor so every candidate/selected pair is compared only once,
  // even when sorting or trying the candidate in another portfolio lane.
  const overlaps = new Map<string, { compared: number; maximum: number }>();
  const redundancy = (item: MemoryContextItem) => {
    const signature = metadata.get(item.id)?.similarity;
    if (!signature) return 0;
    const overlap = overlaps.get(item.id) ?? { compared: 0, maximum: 0 };
    for (; overlap.compared < items.length; overlap.compared += 1) {
      const other = metadata.get(items[overlap.compared]!.id)?.similarity;
      if (other) overlap.maximum = Math.max(overlap.maximum, signatureSimilarity(signature, other));
    }
    overlaps.set(item.id, overlap);
    return overlap.maximum;
  };
  const cores=candidates.filter(item=>protectedIds.has(item.id)||metadata.get(item.id)?.core).sort(scenePriority)
    .map(item=>({head:item,sources:undefined as MemoryContextItem[]|undefined}));
  const directCores=cores.filter(entry=>!protectedIds.has(entry.head.id));
  const sources=options.stateSourceGroups.flatMap(group=>{
    const sources=candidates.filter(item=>group.includes(item.id))
      .sort((a,b)=>(metadata.get(b.id)?.sourceOrdinal ?? 0)-(metadata.get(a.id)?.sourceOrdinal ?? 0)||a.id.localeCompare(b.id));
    return sources.length?[{head:sources[0]!,sources}]:[];
  });
  // State relevance and direct relevance are separate signals. After protected
  // leaders, alternate the ranked streams instead of comparing unlike scores.
  const scene=[...cores.filter(entry=>protectedIds.has(entry.head.id)),
    ...Array.from({length:Math.max(directCores.length,sources.length)},(_,index)=>
      [directCores[index],sources[index]].filter((entry):entry is typeof cores[number]=>Boolean(entry)))
      .flat()];
  const admitScene = (entry: typeof scene[number], limit: number) => {
    if (entry.sources?.some(item=>selectedIds.has(item.id))) return;
    for (const item of entry.sources ?? [entry.head]) {
      if (selectedIds.has(item.id) || longtermHeld>0 && item.id===longtermAnchor?.id
        || !protectedIds.has(item.id) && redundancy(item)>=AUTOMATIC_NEAR_DUPLICATE) continue;
      const selected=minimum(item,protectedIds.has(item.id)), cost=cardTokens(selected);
      if (!memoryCardHasContent(selected) || used+cost>limit || packetTokens+cost>cardCeiling()) continue;
      accept(selected,policy.focusIds.has(item.id)?"focus":"core",
        {kind:cueIds.has(item.id)?"cue_anchor":policy.focusIds.has(item.id)?"focus":entry.sources?"state_source":"direct"});
      // Provenance alone grants the minimum, not unrelated optional source facts.
      depths.set(item.id,entry.sources && !metadata.get(item.id)?.core && !protectedIds.has(item.id)
        ? selected : emitted(item));
      used+=cost;
      break;
    }
  };
  for (const entry of scene) admitScene(entry,budgets.scene);
  packetTokens=renderTokens(items);
  const sceneItems = [...items];
  const people = new Set([...options.activeParticipants, ...sceneItems.flatMap(item => item.participants)].map(normalize));
  const sceneLinked = (item: MemoryContextItem) => item.participants.some(name => people.has(normalize(name)));
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
  let carry = Math.max(0, budgets.scene - used);
  for (const role of ["continuity", "association", "longterm"] as const) {
    if (role === "longterm") longtermHeld=0;
    const available = budgets[role] + carry;
    const startTokens = packetTokens;
    const pool = candidates.filter(item => !selectedIds.has(item.id) && metadata.has(item.id)
      && (role === "longterm" || item.id!==longtermAnchor?.id)).filter(item => {
      if (role === "continuity") return policy.continuityIds.has(item.id) || options.storySupportIds.has(item.id);
      if (role === "association") return age(item.id) > ASSOCIATION_COOLDOWN_TURNS && Boolean(metadata.get(item.id)!.typedDetailIds.length || metadata.get(item.id)!.resemblance);
      return !protectedIds.has(item.id) && cardTokens(longtermUnit(item))<=longtermUnitLimit
        && (Boolean(!seedSelected && openSeed(item)) || age(item.id) > LONGTERM_COOLDOWN_TURNS);
    });
    // Period visits and delivery recency break ties after long-term relevance/novelty.
    const periodVisits = new Map<string, number>();
    const period = (item: MemoryContextItem) => metadata.get(item.id)!.period
      ?? (metadata.get(item.id)!.storyTime === undefined ? "undated" : String(Math.floor(metadata.get(item.id)!.storyTime! / (7 * 86_400_000))));
    const recency = (item: MemoryContextItem) => options.lastDelivered.get(item.id) ?? -Infinity;
    while (pool.length) {
      pool.sort((a,b) => {
        const left = metadata.get(a.id)!, right = metadata.get(b.id)!;
        const noveltyScore = (item: MemoryContextItem) => (role === "association" ? metadata.get(item.id)!.resemblance?.score ?? 1 : role === "longterm" ? Math.max(0,Math.min(1,metadata.get(item.id)!.baseDirect)) : 1) * (1 - PERIPHERAL_NOVELTY_WEIGHT)
          + (1 - redundancy(item)) * PERIPHERAL_NOVELTY_WEIGHT;
        if (role === "continuity") return right.sourceOrdinal - left.sourceOrdinal || noveltyScore(b) - noveltyScore(a) || a.id.localeCompare(b.id);
        if (role === "longterm" && !seedSelected) {
          const sa=openSeed(a), sb=openSeed(b);
          if (sa || sb) return Number(Boolean(sb)) - Number(Boolean(sa))
            || Number(Boolean(sb?.seed?.noticedBy.some(name => actors.has(normalize(name)))))-Number(Boolean(sa?.seed?.noticedBy.some(name => actors.has(normalize(name)))))
            || (sa?.sourceOrdinal ?? left.sourceOrdinal) - (sb?.sourceOrdinal ?? right.sourceOrdinal) || a.id.localeCompare(b.id);
        }
        if (role === "longterm") return noveltyScore(b) - noveltyScore(a) || Number(sceneLinked(b)) - Number(sceneLinked(a))
          || (periodVisits.get(period(a)) ?? 0) - (periodVisits.get(period(b)) ?? 0)
          || (recency(a) === recency(b) ? 0 : recency(a) - recency(b)) || left.sourceOrdinal - right.sourceOrdinal || a.id.localeCompare(b.id);
        const typed = Number(right.typedDetailIds.length > 0) - Number(left.typedDetailIds.length > 0);
        return typed || (right.resemblance?.adjustedScore ?? 0) - (left.resemblance?.adjustedScore ?? 0)
          || timeDistance(b) - timeDistance(a) || Number(differentPeriod(b)) - Number(differentPeriod(a))
          || noveltyScore(b) - noveltyScore(a) || a.id.localeCompare(b.id);
      });
      const candidate = pool.shift()!;
      if (redundancy(candidate) >= AUTOMATIC_NEAR_DUPLICATE) continue;
      const seedDetail = role === "longterm" && !seedSelected ? openSeed(candidate) : undefined;
      const compacted=compact(candidate, role, seedDetail);
      const item=fitAutomaticCard(compacted,current=>{
        const cost=cardTokens(current);
        return packetTokens+cost-startTokens<=available && packetTokens+cost<=cardCeiling();
      }, direct, policy);
      if (!item) continue;
      depths.set(item.id,emittedMemoryItems(buildEmissionPlan([compacted]))[0] ?? compacted);
      const meta = metadata.get(item.id)!;
      const reason: AutomaticRoleReason = role === "continuity" ? { kind: options.storySupportIds.has(item.id) ? "story_support" : "recent_bridge" }
        : role === "association" ? meta.typedDetailIds.length ? { kind: "typed_atom_relation", viaMemoryId: policy.associationSources?.get(item.id) }
          : { kind: "resembles_now", score: meta.resemblance!.score, adjustedScore: meta.resemblance!.adjustedScore }
          : seedDetail ? {kind:"open_seed",seedType:seedDetail.seed!.type,detailId:seedDetail.id}
          : { kind: "not_recalled_for", turns: Number.isFinite(age(item.id)) ? age(item.id) : null,
            participants: item.participants.filter(name => people.has(normalize(name))) };
      accept(item, role, reason);
      if (seedDetail) seedSelected = true;
      periodVisits.set(period(item), (periodVisits.get(period(item)) ?? 0) + 1);
    }
    packetTokens=renderTokens(items);
    carry = Math.max(0, available - (packetTokens - startTokens));
  }
  // Reconsider scene minimums while both content floors still have their space.
  for (const entry of scene) admitScene(entry,Infinity);
  packetTokens=renderTokens(items);
  // Give each delivered card a voice before spending on additional lines.
  // Candidates have already passed retrieval prompt-coverage suppression.
  const priority=[...items].sort((a,b)=>Number(protectedIds.has(b.id))-Number(protectedIds.has(a.id))
    || (metadata.get(b.id)?.baseDirect ?? 0)-(metadata.get(a.id)?.baseDirect ?? 0) || a.id.localeCompare(b.id));
  const dialogueQueues = priority.map(item => {
    const full = candidates.find(candidate => candidate.id === item.id)!;
    const source=isFoldedMemory(item) ? depths.get(item.id)! : full;
    return { id:item.id, lines:rankedDialogues(source,source.keyDialogues,item.details) };
  });
  const addDialogue = (id: string, line: MemoryContextItem["keyDialogues"][number]) => {
    const index = items.findIndex(item => item.id === id), previous = items[index]!;
    if (previous.keyDialogues.includes(line)) return;
    const next = {...previous,keyDialogues:[...previous.keyDialogues,line]};
    const delta = cardTokens(next) - cardTokens(previous);
    if (packetTokens + delta <= options.hardTokenCeiling) { replaceItem(index,next); packetTokens += delta; }
  };
  // First pass: the best line of every card. Further lines follow scene relevance.
  for (const queue of dialogueQueues) {
    if (!items.find(item => item.id === queue.id)!.keyDialogues.length && queue.lines[0]) addDialogue(queue.id,queue.lines[0]);
  }
  for (const queue of dialogueQueues) for (const line of queue.lines) {
    if (dialogueCost() >= dialogueReserved) break;
    addDialogue(queue.id,line);
  }
  packetTokens=renderTokens(items);
  // Unused floors return to the common pot, but admitted dialogue is retained.
  dialogueHeld=false;
  for (const entry of scene) admitScene(entry,Infinity);
  packetTokens=renderTokens(items);
  // Cards admitted with returned floor capacity also try their best voice
  // before any other card receives an additional line.
  for (const item of [...items].sort(scenePriority)) if (!item.keyDialogues.length) {
    const full=candidates.find(candidate=>candidate.id===item.id)!;
    const source=isFoldedMemory(item) ? depths.get(item.id)! : full;
    const line=rankedDialogues(source,source.keyDialogues,item.details)[0];
    if (line) addDialogue(item.id,line);
  }
  // Optional depth now shares the remainder
  // in rounds; each attempt prices only a charged card delta, never the packet.
  const queues=[...items].sort(scenePriority).map(item=>{
    const depth=depths.get(item.id)!;
    const full=isFoldedMemory(item) ? depth : {...depth,keyDialogues:candidates.find(candidate=>candidate.id===item.id)!.keyDialogues};
    const ranks=new Map(planAutomaticAtoms([full],direct,policy).map(atom=>[atom.atomKey,atom.localRank]));
    const units=[...full.keyDialogues.filter(line=>!item.keyDialogues.includes(line)).map(line=>({key:memoryDialogueAtomKey(item.id,line),line})),
      ...full.details.filter(detail=>!item.details.includes(detail)).map(detail=>({key:memoryDetailAtomKey(detail),detail}))];
    const dialogueRanks=new Map(rankedDialogues(full,full.keyDialogues,item.details).map((line,index)=>[memoryDialogueAtomKey(item.id,line),index]));
    const unitPriority=(unit:typeof units[number])=>"detail" in unit && isException(unit.detail,full.knownBy) ? 0 : "line" in unit ? 1 : 2;
    units.sort((a,b)=>unitPriority(a)-unitPriority(b)
      || ("line" in a && "line" in b ? dialogueRanks.get(a.key)!-dialogueRanks.get(b.key)! : (ranks.get(a.key)??0)-(ranks.get(b.key)??0)));
    return {id:item.id,units};
  });
  const depthHistory: Array<{id:string;previous:MemoryContextItem}> = [];
  for (let round=0;round<Math.max(0,...queues.map(queue=>queue.units.length));round++) for (const queue of queues) {
    const unit=queue.units[round]; if (!unit) continue;
    const index=items.findIndex(item=>item.id===queue.id), previous=items[index]!;
    const next={...previous,details:"detail" in unit?[...previous.details,unit.detail]:previous.details,
      keyDialogues:"line" in unit?[...previous.keyDialogues,unit.line]:previous.keyDialogues};
    const delta=cardTokens(next)-cardTokens(previous);
    if (packetTokens+delta<=options.hardTokenCeiling) {depthHistory.push({id:previous.id,previous});replaceItem(index,next);packetTokens+=delta;}
  }
  packetTokens=renderTokens(items);
  while (packetTokens>options.hardTokenCeiling && depthHistory.length) {
    const last=depthHistory.pop()!;
    replaceItem(items.findIndex(item=>item.id===last.id),last.previous);
    packetTokens=renderTokens(items);
  }
  return { items, roles, reasons, floors: { dialogue:packetFloorUsage(dialogueReserved,dialogueCost()),
    longterm:packetFloorUsage(longtermReserved,items.filter(item=>roles.get(item.id)==="longterm").reduce((sum,item)=>sum+cardTokens(item),0)) } };
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
    const plotBundle = plotBundleDetailIds(item);
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
      bundle: bundle.has(atom.key) || item.details.some(detail => plotBundle.has(detail.id) && memoryDetailAtomKey(detail) === atom.key), direct: direct.has(atom.key), tokens: estimateTokens(atom.text), outcome: "retained" as const }));
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
      if (automaticAtoms(item).length <= 1 && planMemoryCard(item).plot !== "emit") continue;
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
    && (allowDirect || !policy.sceneDepthTokens || chargedCardTokens(projectMemoryScene(removeAtom(items[itemIndices.get(entry.memoryId)!]!, entry.atomKey)), { plot: "emit", latestStoryTime: policy.latestStoryTime }) >= policy.sceneDepthTokens)
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
  if (!memoryCardHasContent(next)) items.splice(index, 1);
  else items[index] = next;
  removed.outcome = outcome;
  return true;
}

/** One card follows the same degradation path at admission and final trim.
 * A plot is never shortened or separated from its required scope lines. */
export function fitAutomaticCard(item: MemoryContextItem, fits: (item: MemoryContextItem) => boolean,
  direct: ReadonlySet<string>, policy: AutomaticPacketPolicy = {priorities:new Map(),focusIds:new Set(),continuityIds:new Set(),roles:new Map()},
  decisions = planAutomaticAtoms([item],direct,policy),
  outcome: AutomaticAtomDecision["outcome"] = "target_budget"): MemoryContextItem | undefined {
  const card = planMemoryCard(item);
  const items = [{...item,details:item.details.filter(detail=>card.detailIds.includes(detail.id))}];
  while (items[0] && memoryCardHasContent(items[0])) {
    if (fits(items[0])) return items[0];
    if (trimAutomaticAtom(items,direct,true,policy,decisions,outcome)) continue;
    if (isAuthorCard(items[0]) || planMemoryCard(items[0]).plot !== "emit") return undefined;
    items[0] = {...items[0],content:""};
    // Only plot-induced protection expires. Keep ordinary focus/typed-path ranks.
    const replanned = new Map(planAutomaticAtoms(items,direct,policy).map(atom=>[atom.atomKey,atom]));
    for (const decision of decisions) if (decision.memoryId === item.id && decision.outcome === "retained") {
      decision.bundle = replanned.get(decision.atomKey)?.bundle ?? false;
    }
  }
  return undefined;
}

function removable(item: MemoryContextItem, key: string): boolean {
  const card = planMemoryCard(item);
  if (isFoldedMemory(item) && (item.details.some(detail=>card.minimumUnitIds.includes(detail.id) && memoryDetailAtomKey(detail) === key)
    || item.keyDialogues.some(line=>card.minimumUnitIds.includes(line.id ?? memoryDialogueAtomKey(item.id,line)) && memoryDialogueAtomKey(item.id,line) === key))) return false;
  const plotBundle = plotBundleDetailIds(item);
  if (item.details.some(detail => plotBundle.has(detail.id) && memoryDetailAtomKey(detail) === key)) return false;
  if (planMemoryCard(item).plot === "emit") return true;
  if (!isAuthorCard(item) && item.details.filter(detail => detail.role === "core").length === 1
    && item.details.some(detail => detail.role === "core" && memoryDetailAtomKey(detail) === key)
    && automaticAtoms(item).length > 1) return false;
  return !(item.details.length === 1 && item.keyDialogues.length > 0 && memoryDetailAtomKey(item.details[0]!) === key);
}

function removeAtom(item: MemoryContextItem, key: string): MemoryContextItem {
  return { ...item, details: item.details.filter((detail) => memoryDetailAtomKey(detail) !== key),
    keyDialogues: item.keyDialogues.filter((dialogue) => memoryDialogueAtomKey(item.id, dialogue) !== key) };
}
