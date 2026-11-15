import { emitsMemoryPlot, isAuthorCard, isException, scopeOf, scopeRelation, sameMemoryLabels, projectMemoryScene, renderMemoryScene, type MemoryContextItem } from "@rcm/shared";
import { memoryDetailAtomKey, memoryDialogueAtomKey, memorySummaryAtomKey } from "./memory-atoms.js";
import { emptyPacketManifest, type PacketManifest } from "./packet-manifest.js";

export type PlotOmitReason = "covered" | "delta";
export type FactReason = "direct" | "open_seed" | "atom_path" | "mcp_atom_ref";
/** Request-local selection provenance survives object spreads, never JSON/DTO serialization. */
export const memoryFactReasons = Symbol("memoryFactReasons");
export type FactSelectedMemory = MemoryContextItem & { [memoryFactReasons]?: Map<string, FactReason[]> };
export const factReasonsFor = (item: MemoryContextItem): Map<string, FactReason[]> => (item as FactSelectedMemory)[memoryFactReasons] ?? new Map();
export type EmissionPlan = {
  cards: Array<{
    memoryId: string;
    shape: 0 | 1;
    factReasons: Map<string, FactReason[]>;
    minimumUnitIds: string[];
    plot: "emit" | "omit";
    plotOmitReason?: PlotOmitReason;
    detailIds: string[];
    dialogueIds: string[];
    /** Mandatory lane; optional hits compete separately before merging author cards. */
    alwaysInject?: boolean;
    /** Final source snapshot supplies content fingerprints and rendering. */
    item: MemoryContextItem;
  }>;
  laneRows: Array<{ lane: string; id: string }>;
  relationshipPairs: PacketManifest["relationshipPairs"];
};
export type EmissionPlanItem = EmissionPlan["cards"][number];

export interface CardEmissionTrace {
  memoryId: string;
  shape: 0 | 1;
  plot: "emit" | "omit";
  plotReason: "emitted" | PlotOmitReason | "legacy" | "empty";
  requiredExceptionIds: string[];
  hitFacts: Array<{ id: string; reasons: FactReason[] }>;
}

/** IDs and typed selection provenance only; never copy card prose or prompts. */
export function traceEmissionPlan(plan: EmissionPlan): CardEmissionTrace[] {
  return plan.cards.map(card => ({
    memoryId: card.memoryId, shape: card.shape, plot: card.plot,
    plotReason: card.plot === "emit" ? "emitted" : card.plotOmitReason
      ?? (card.item.content.trim() ? "legacy" : "empty"),
    requiredExceptionIds: card.minimumUnitIds.filter(id => card.item.details.some(detail => detail.id === id)),
    hitFacts: [...card.factReasons].filter(([id]) => card.detailIds.includes(id)).map(([id, reasons]) => ({ id, reasons })),
  }));
}

/** Structural card plan for an already authorized/materialized item.
 * Prompt coverage and delivery delta are applied by buildEmissionPlan. */
export function planMemoryCard(item: MemoryContextItem): EmissionPlan["cards"][number] {
  const shape = isAuthorCard(item) ? 1 : 0;
  const exceptions = shape === 1 ? item.details.filter(detail=>isException(detail,item.knownBy)).map(detail=>detail.id) : [];
  const factReasons = new Map([...factReasonsFor(item)].filter(([id,reasons])=>reasons.length
    && !exceptions.includes(id) && item.details.some(detail=>detail.id === id)));
  const plot = emitsMemoryPlot(item) ? "emit" : "omit";
  const summary = memorySummaryAtomKey(item);
  return {memoryId:item.id,item,shape,factReasons,plot,
    minimumUnitIds:shape === 1 ? [...(plot === "emit" && summary ? [summary] : []),...exceptions] : [],
    detailIds:item.details.filter(detail=>shape === 0 || exceptions.includes(detail.id) || factReasons.get(detail.id)?.length).map(detail=>detail.id),
    dialogueIds:item.keyDialogues.map(dialogue=>dialogue.id ?? memoryDialogueAtomKey(item.id,dialogue))};
}

export function memoryCardHasContent(item: MemoryContextItem): boolean {
  const card = planMemoryCard(item);
  return card.plot === "emit" || card.detailIds.length > 0 || card.dialogueIds.length > 0;
}

/** Rebuild after selection, coverage, delta or final budget trimming changes. */
export function buildEmissionPlan(items: MemoryContextItem[], options: {
  promptSourceMessageIds?: string[];
  excludedAtomKeys?: ReadonlySet<string>;
  lanes?: PacketManifest;
  excludeLineAtoms?: boolean;
} = {}): EmissionPlan {
  const covered = new Set(options.promptSourceMessageIds);
  return {
    cards: items.flatMap(item => {
      const evidence = item.summaryEvidence ?? item.evidence;
      const summaryKey = memorySummaryAtomKey(item);
      const plotOmitReason: PlotOmitReason | undefined = evidence.length > 0 && evidence.every(span => covered.has(span.messageId)) ? "covered"
        : summaryKey && options.excludedAtomKeys?.has(summaryKey) ? "delta" : undefined;
      const base = planMemoryCard(item);
      if (base.shape === 1 && plotOmitReason === "covered") return [];
      const card: EmissionPlan["cards"][number] = { ...base, ...(plotOmitReason ? {plot:"omit" as const} : {}),
        ...(plotOmitReason ? { plotOmitReason } : {}),
        detailIds: item.details.filter(detail => base.detailIds.includes(detail.id) && (base.shape === 1 && base.minimumUnitIds.includes(detail.id)
          || options.excludeLineAtoms === false || !options.excludedAtomKeys?.has(memoryDetailAtomKey(detail)))).map(detail => detail.id),
        // Legacy dialogues may not have an ID; their atom identity is stable.
        dialogueIds: item.keyDialogues.filter(dialogue => options.excludeLineAtoms === false || !options.excludedAtomKeys?.has(memoryDialogueAtomKey(item.id, dialogue)))
          .map(dialogue => dialogue.id ?? memoryDialogueAtomKey(item.id, dialogue)) };
      return [card];
    }),
    laneRows: Object.entries(options.lanes ?? emptyPacketManifest()).flatMap(([lane, ids]) => lane === "relationshipPairs" ? []
      : (ids as string[]).map(id => ({ lane, id }))),
    relationshipPairs: options.lanes?.relationshipPairs ?? [],
  };
}

/** Same-response state evidence replaces only optional fact lines, never a plot,
 * dialogue or knowledge/concealment exception. Candidates remain available later. */
export function omitStateLinkedDetails(plan: EmissionPlan, detailIds: ReadonlySet<string>): void {
  for (const card of plan.cards) card.detailIds = card.detailIds.filter(id => !detailIds.has(id)
    || card.item.details.some(detail => {
      if (detail.id !== id) return false;
      const scope = scopeOf(detail);
      return isException(detail,card.item.knownBy) || scopeRelation(scope,scopeOf(card.item)) !== "equal"
        || scope.kind === "set" && !!detail.knownByLabels && !sameMemoryLabels(detail.knownByLabels,scope.names);
    }));
}

export function emittedMemoryItems(plan: EmissionPlan): MemoryContextItem[] {
  return plan.cards.map(card => ({ ...card.item, [memoryFactReasons]:card.factReasons, content: card.plot === "emit" ? card.item.content : "",
    details: card.item.details.filter(detail => card.detailIds.includes(detail.id)),
    keyDialogues: card.item.keyDialogues.filter(dialogue => card.dialogueIds.includes(dialogue.id ?? memoryDialogueAtomKey(card.memoryId, dialogue))) }));
}

/** Public selection snapshots combine a memory's required and competing lines;
 * rendering and charged cost still use each actual card in its own lane. */
export function emittedMemoryRecords(plan: EmissionPlan): MemoryContextItem[] {
  const records = new Map<string, MemoryContextItem>();
  for (const item of emittedMemoryItems(plan)) {
    const previous = records.get(item.id);
    records.set(item.id, previous ? {...previous, content:previous.content || item.content, score:Math.max(previous.score,item.score),
      details:[...new Map([...previous.details,...item.details].map(detail=>[detail.id,detail])).values()],
      keyDialogues:[...new Map([...previous.keyDialogues,...item.keyDialogues].map(dialogue=>
        [dialogue.id ?? memoryDialogueAtomKey(item.id,dialogue),dialogue])).values()]} : item);
  }
  return [...records.values()];
}

/** Optional hits of a mandatory author card share its plot/header, so no
 * second, plotless author card is rendered or charged. The required plan is
 * immutable; its ceiling continues to price only the minimum unit. */
export function prependAlwaysCards(plan: EmissionPlan, required: EmissionPlan): void {
  const mandatory = required.cards.map(card=>{
    if (card.shape !== 1) return card;
    const optional = plan.cards.filter(other=>other.memoryId === card.memoryId);
    plan.cards = plan.cards.filter(other=>other.memoryId !== card.memoryId);
    const records = emittedMemoryRecords({...plan,cards:[card,...optional]});
    const reasons = new Map([...card.factReasons,...optional.flatMap(other=>[...other.factReasons])]);
    const item: FactSelectedMemory = {...records[0]!,[memoryFactReasons]:reasons};
    return {...planMemoryCard(item),alwaysInject:true};
  });
  plan.cards.unshift(...mandatory);
}

export function renderEmissionCards(plan: EmissionPlan, memoryIds?: ReadonlySet<string>, latestStoryTime?: number, viewpoint?: string): string {
  const items = emittedMemoryItems(plan);
  return plan.cards.map((card,index)=>({card,item:items[index]!})).filter(({item}) => !memoryIds || memoryIds.has(item.id))
    .sort(({item:left},{item:right})=>(left.sourceOrdinal ?? Number.MAX_SAFE_INTEGER)-(right.sourceOrdinal ?? Number.MAX_SAFE_INTEGER)
      || String(left.storyTime ?? "").localeCompare(String(right.storyTime ?? "")) || right.score-left.score).map(({card,item}) =>
    renderMemoryScene(projectMemoryScene({...item,content:card.item.content}), { plot: card.plot, latestStoryTime, clarity: item.clarity, viewpoint,
      compact:card.alwaysInject && card.shape === 0 })).filter(Boolean).join("\n");
}

export function buildManifest(plan: EmissionPlan): PacketManifest {
  const manifest = emptyPacketManifest();
  manifest.relationshipPairs = plan.relationshipPairs;
  for (const { lane, id } of plan.laneRows) {
    if (lane in manifest && lane !== "relationshipPairs") (manifest[lane as Exclude<keyof PacketManifest, "relationshipPairs">] as string[]).push(id);
  }
  for (const item of emittedMemoryItems(plan)) {
    manifest.memoryIds.push(item.id);
    const summary = memorySummaryAtomKey(item);
    if (summary) manifest.atomKeys.push(summary);
    manifest.atomKeys.push(...item.details.map(memoryDetailAtomKey), ...item.keyDialogues.map(dialogue => memoryDialogueAtomKey(item.id, dialogue)));
    manifest.detailIds.push(...item.details.map(detail => detail.id));
  }
  for (const key of Object.keys(manifest) as Array<keyof PacketManifest>) {
    if (key !== "relationshipPairs") manifest[key] = [...new Set(manifest[key])];
  }
  return manifest;
}
