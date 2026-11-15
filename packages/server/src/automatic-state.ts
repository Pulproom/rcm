import { escapeMemoryText } from "@rcm/shared";
import { automaticPacketBudget } from "./packet-budget.js";
import { standaloneViewpoint } from "./standalone-lanes.js";
import { type PacketPricing, chargedSectionTokens } from "./charged-cost.js";
import { promiseMadeLabel } from "./promise-recency.js";
import { estimateTokens, standaloneScopeText, structuredStoryTimeEnd } from "@rcm/shared";
import { emptyPacketManifest } from "./packet-manifest.js";
import { rankStateEvidence, lastRecordedStateText, stateMcpEvidence, stateEvidenceScope, type StateEvidence } from "./state-evidence.js";
import type { StateOutcomeCapture } from "./state-outcomes.js";
import { hasRecognitionContent, joinSentences, recognitionNaming, recentAddressTerms, socialKnowledgeLevelLabel } from "./social-knowledge.js";

/** The small-packet taper prevents the state floor from taking over the packet. */
export const sharedStateBudget = (tokens: number): number => automaticPacketBudget(tokens).state;

export interface AutomaticStateRow {
  item: StateEvidence;
  sceneRecognitionPriority?: number;
  line: string;
  baseLine?: string;
  changeNote?: string;
  perspectives: string[];
  active: boolean;
  pinned: boolean;
  /** Both canonical endpoints belong to prepare's resolved sceneCharacters. */
  sceneRelationshipPriority?: number;
  relationshipReservation?: "reserved" | "overflow";
  promiseSlot?: "pinned" | "recent";
  /** Admitted without relationship reservation; that reservation cannot evict it. */
  protectedPromise?: boolean;
  continuitySlot?: "state" | "promise";
  relevance: number;
  rank: number;
}

/** One author selection; scene identities affect rank and pins, never access. */
export function automaticStateCandidates(corpus: StateEvidence[], options: {
  perspectives: string[]; activeNames: string[]; query: string; covered: ReadonlySet<string>;
  semantic?: Map<string, number>; latestStoryTime?: number; trace?: StateOutcomeCapture; memoryOnly?: boolean;
  namesRecognitionIds?: ReadonlySet<string>;
  sceneRecognitionIds?: ReadonlySet<string>;
  sceneCharacters?: readonly string[];
  preferredRelationshipNames?: readonly string[];
}): AutomaticStateRow[] {
  const rows = new Map<string, AutomaticStateRow>();
  const normalize = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase();
  const active = new Set(options.activeNames.map(normalize));
  const scene = new Set(options.sceneCharacters?.map(normalize));
  const preferred = new Set(options.preferredRelationshipNames?.map(normalize));
  const sceneRecognitionIds = options.sceneRecognitionIds ?? new Set<string>();
  const perspective = "narrator";
  const candidates = rankStateEvidence(corpus, options.query, { perspective, archive: true, activeNames: options.activeNames,
    continuity: true, automaticPromises: true, semantic: options.semantic, trace: options.trace, sceneRecognitionIds });
  for (const [index, { item, score }] of candidates.entries()) {
    const pinned = item.kind === "basic_relation" && item.subjects.length >= 2 && item.subjects.every(name => active.has(normalize(name)));
    const sceneRelationship = item.kind === "relationship" && item.current && item.relationship && item.automatic?.summaryReady !== false
      && [item.relationship.from, item.relationship.to].every(name => scene.has(normalize(name)));
    if (options.memoryOnly || !pinned && !sceneRelationship && !item.promisePinned && !item.promiseRecent && item.sourceIds.length && item.sourceIds.every(id => options.covered.has(id))) {
      options.trace?.record(perspective, item, options.memoryOnly ? "memory_only" : "prompt_covered", { rank: index + 1 });
      continue;
    }
    if (item.kind === "recognition" && item.automatic && !hasRecognitionContent(item.automatic)) {
      options.trace?.record(perspective, item, "not_rendered", {rank: index + 1, rendered: "omitted_empty"});
      continue;
    }
    if (item.kind === "relationship" && (item.automatic?.summaryReady === false || !item.automatic?.body.trim())) {
      options.trace?.record(perspective, item, "not_rendered", { rank: index + 1, rendered: "omitted_empty" });
      continue;
    }
    const namingInNames = item.kind === "recognition" && options.namesRecognitionIds?.has(item.id);
    if (namingInNames && !item.automatic?.body.trim()) {
      options.trace?.record(perspective, item, "not_rendered", {rank:index + 1,rendered:"omitted_empty"});
      continue;
    }
    const line = renderAutomaticStateLine(item, options.latestStoryTime, namingInNames);
    const change = item.previous;
    const changeNote = change
      ? `\n- ${stateScopePrefix(change.item)}${escapeState(`Previously: ${change.item.dedupeBody && change.item.dedupeBody !== change.item.automatic!.body ? `${change.item.automatic!.subject}: ` : ""}${change.item.automatic!.body}${change.changedAt ? ` until ${change.changedAt}` : ""}`)}` : undefined;
    const dedupeChangeNote = change?.item.dedupeBody
      ? `\n- ${stateScopePrefix(change.item)}${escapeState(`Previously: ${change.item.dedupeBody}${change.changedAt ? ` until ${change.changedAt}` : ""}`)}` : changeNote;
    // Canonical scope remains part of the deduplication key.
    // A user pin is a separate delivery slot even when its prose matches an ordinary row.
    const key = `${renderStateLine(item.dedupeText ? { ...item, displayText: item.dedupeText } : item)}\0${dedupeChangeNote ?? ""}\0${item.promisePinned ? "pinned" : item.promiseRecent ? "recent" : ""}`;
    const previous = rows.get(key);
    if (previous) {
      previous.perspectives.push(perspective);
      previous.relevance = Math.max(previous.relevance, score);
    } else rows.set(key, { item, line, baseLine: line, changeNote, perspectives: [perspective], rank: index + 1,
      relevance: score,
      pinned,
      ...(item.kind === "recognition" && item.subjects.length === 2 && item.subjects.every(name => scene.has(normalize(name)))
        ? { sceneRecognitionPriority: item.subjects.filter(name => preferred.has(normalize(name))).length } : {}),
      ...(sceneRelationship ? { sceneRelationshipPriority: item.subjects.filter(name => preferred.has(normalize(name))).length } : {}),
      continuitySlot: item.current && item.subjects.some(name => active.has(normalize(name)))
        ? item.kind === "promise" && item.promiseStatus === "open" ? "promise"
          : ["world_fact", "basic_relation", "relationship", "belief"].includes(item.kind) ? "state" : undefined
        : undefined,
      promiseSlot: item.promisePinned ? "pinned" : item.promiseRecent ? "recent" : undefined,
      active: item.kind === "recognition" ? sceneRecognitionIds.has(item.id)
        : [...item.holders, ...item.subjects].some(name => active.has(normalize(name))) });
  }
  const promisePriority = ({ item, active }: AutomaticStateRow): number => {
    if (item.kind !== "promise" || item.promiseStatus !== "open") return 0;
    return overduePromise(item, options.latestStoryTime) ? 2 : Number(active);
  };
  // The existing lexical/semantic/participant RRF leads; an additional typed
  // holder/subject link is one channel, never a kind-first ordering.
  return [...rows.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || (b.relevance + Number(b.active) / 61) - (a.relevance + Number(a.active) / 61)
    || promisePriority(b) - promisePriority(a)
    || (b.item.updatedOrdinal ?? -1) - (a.item.updatedOrdinal ?? -1)
    || (b.item.updatedRevision ?? -1) - (a.item.updatedRevision ?? -1)
    || a.rank - b.rank || a.item.id.localeCompare(b.item.id))
    .map((row, index) => ({ ...row, perspectives: [...new Set(row.perspectives)], rank: index + 1 }));
}

/** Only relevance-selected current rows can nominate event provenance.
 * Fixed relation/promise slots do not turn into additional scene reservations. */
export function automaticStateSources(rows: readonly AutomaticStateRow[], sources: (item: StateEvidence) => string[]): string[][] {
  return rows.filter(row => row.item.current && row.relevance > 0 && !row.pinned && !row.promiseSlot
    && (row.item.kind === "belief" || row.item.kind === "promise"
      || row.item.kind === "world_fact" && ["secret","goal","condition"].includes(row.item.stateKind ?? "")))
    .sort((a,b)=>a.rank-b.rank)
    .map(row => [...new Set(sources(row.item))]).filter(group=>group.length);
}

export function renderStateLine(item: StateEvidence): string {
  return `- ${stateScopePrefix(item)}${escapeMemoryText(stateMcpEvidence(item).text.replace(/\r?\n/g, " "))}`;
}

export function selectAutomaticState(rows: AutomaticStateRow[], budget: number, pricing?: PacketPricing, sceneRelationshipAllowance = Math.min(480, Math.floor(budget * .6))): AutomaticStateRow[] {
  for (const row of rows) row.relationshipReservation = undefined;
  const selected = rows.filter(row => row.pinned);
  const fill = (candidates: readonly AutomaticStateRow[]) => {
    for (const row of candidates) if (!selected.includes(row) && !row.promiseSlot
      && row.relationshipReservation !== "overflow"
      && renderAutomaticState([...selected, row], undefined, pricing).chargedTokens <= budget) selected.push(row);
  };
  // At most one compact current state and one open promise, inside the existing
  // lane. Pins already count; unused capacity goes straight back to normal ranking.
  const slotBudget = Math.min(80, Math.floor(budget * .20));
  for (const slot of ["state", "promise"] as const) {
    if (selected.some(row => row.continuitySlot === slot)) continue;
    // Compactness measures prose; the complete section still funds fixed POV slots.
    const row = rows.find(row => row.continuitySlot === slot && !row.promiseSlot
      && estimateTokens(row.line) <= slotBudget && renderAutomaticState([...selected, row], undefined, pricing).chargedTokens <= budget);
    if (row) selected.push(row);
  }
  fill(rows);
  // Separate, bounded slots leave the ordinary/open-promise allowance intact.
  for (const slot of ["pinned", "recent"] as const) {
    const extra: AutomaticStateRow[] = [];
    const slotBudget = Math.min(180, Math.floor(budget * .4));
    for (const row of rows) if (row.promiseSlot === slot && renderAutomaticState([...extra, row], undefined, pricing).chargedTokens <= slotBudget) extra.push(row);
    selected.push(...extra);
  }
  // First secure the exact promises admitted by the existing policy, including
  // supplemental pins/recent endings and ordinary ranked open promises.
  const beforeReservation = [...selected];
  for (const row of rows) if (row.item.kind === "promise") row.protectedPromise = selected.includes(row);
  selected.splice(0, selected.length, ...selected.filter(row => row.pinned || row.protectedPromise));
  const reserved: AutomaticStateRow[] = [];
  const relationships = rows.filter(row => row.sceneRelationshipPriority !== undefined).sort((a, b) =>
    b.sceneRelationshipPriority! - a.sceneRelationshipPriority!
    || (b.item.updatedOrdinal ?? -1) - (a.item.updatedOrdinal ?? -1)
    || (b.item.updatedRevision ?? -1) - (a.item.updatedRevision ?? -1)
    || a.rank - b.rank);
  const pair = (row: AutomaticStateRow) => JSON.stringify([...row.item.subjects].sort());
  const topPair = relationships[0] ? pair(relationships[0]) : undefined;
  for (const row of relationships) {
    // Until stored summaries shorten naturally, the leading pair may use the
    // former 480 allowance. Other scene pairs share the new bounded allowance.
    const relationshipBudget = Math.min(budget * .6, pair(row) === topPair ? Math.max(480, sceneRelationshipAllowance) : sceneRelationshipAllowance);
    row.relationshipReservation = "overflow";
    if (renderAutomaticState([...reserved, row], undefined, pricing).chargedTokens > relationshipBudget
      || renderAutomaticState([...selected, row], undefined, pricing).chargedTokens > budget) continue;
    reserved.push(row); selected.push(row); row.relationshipReservation = "reserved";
  }
  const recognitions = rows.filter(row => row.sceneRecognitionPriority !== undefined).sort((a,b) =>
    b.sceneRecognitionPriority! - a.sceneRecognitionPriority! || a.rank - b.rank);
  fill(recognitions);
  fill([...beforeReservation, ...rows]);
  // Fill current rows first; history uses only what is left in this lane.
  for (const row of selected) if (row.changeNote && estimateTokens(row.changeNote) <= 80) {
    row.line = row.baseLine! + row.changeNote;
    if (renderAutomaticState(selected, undefined, pricing).chargedTokens > budget) row.line = row.baseLine!;
  }
  return selected;
}

export function trimAutomaticStateNote(rows: AutomaticStateRow[]): boolean {
  const row = [...rows].reverse().find(row => row.baseLine && row.line !== row.baseLine);
  if (!row) return false;
  row.line = row.baseLine!;
  return true;
}

const escapeState = (value: string): string => escapeMemoryText(value.replace(/\r?\n/g, " "));
const stateScopePrefix = (item: StateEvidence): string => {
  const tag = standaloneScopeText(stateEvidenceScope(item)).replace(/^Known by/, "known by").replace(/^No character knows/, "no character knows");
  return tag ? `[${escapeState(tag)}] ` : "";
};

const rowScopes = (row: AutomaticStateRow) =>
  row.item.kind === "relationship" ? [] : [row.item, ...(row.line !== row.baseLine && row.item.previous ? [row.item.previous.item] : [])]
    .map(stateEvidenceScope);

function renderAutomaticStateLine(item: StateEvidence, latestStoryTime?: number, namingInNames = false): string {
  // A basic relation is mutual; an arrow would read as one-sided.
  const subject = item.automatic?.subject ?? item.subjects.join(" → ");
  if (item.kind === "relationship") return `- ${escapeState(subject)}: ${escapeState(item.automatic!.body)}`;
  const scope = stateScopePrefix(item);
  return `- ${escapeState(item.kind === "basic_relation" ? subject.replaceAll(" → ", " & ") : subject)}${scope ? ` ${scope.trimEnd()}` : ""}: ${escapeState(automaticStateBody(item, latestStoryTime, namingInNames))}`;
}

function automaticStateBody(item: StateEvidence, latestStoryTime?: number, namingInNames = false): string {
  const display = item.automatic;
  let body = display?.body ?? item.text;
  const addressTerms = recentAddressTerms(display?.addressTerms ?? [], display?.addressTermsUserEdited);
  if (item.kind==="recognition" && display && !namingInNames) body=joinSentences([recognitionNaming(item.subjects[1] ?? "them",display.knownAs ?? []),
    display.body,addressTerms.length?`Calls ${addressTerms.map(term=>JSON.stringify(term)).join(", ")}.`:""]);
  if (display?.recognitionLevel) body = joinSentences([body, socialKnowledgeLevelLabel[display.recognitionLevel]]);
  if (item.kind === "promise") {
    if (item.promisePinned || item.promiseRecent) body = body.length > 220 ? `${body.slice(0, 219)}…` : body;
    const status = overduePromise(item, latestStoryTime) ? "overdue" : item.promiseStatus ?? "open";
    const recentStatus: Record<string, string> = { kept: "recently kept", broken: "recently broken", released: "recently released", offscreen: "recently handled offscreen" };
    body += ` (${item.promiseRecent && !item.promisePinned ? recentStatus[status] ?? status : status}${item.due ? ` · due ${item.due}` : ""}${item.firstMade ? ` · ${promiseMadeLabel(item.firstMade)}` : ""})`;
  }
  return lastRecordedStateText(item,body);
}

function overduePromise(item: StateEvidence, latestStoryTime?: number): boolean {
  const due = item.due ? structuredStoryTimeEnd(item.due) : undefined;
  return item.promiseStatus === "open" && due !== undefined && latestStoryTime !== undefined && due < latestStoryTime;
}

function stateGroup(item: StateEvidence): number {
  if (["basic_relation", "relationship"].includes(item.kind)) return 0;
  // Location/status facts use the canonical condition kind; prose is not classified.
  if (item.kind === "world_fact" && item.stateKind === "condition") return 1;
  if (item.kind === "belief" || item.stateKind === "goal") return 2;
  if (item.kind === "promise") return item.promisePinned ? 4 : item.promiseRecent ? 5 : 3;
  return item.kind === "recognition" ? 6 : 7;
}

export function renderAutomaticState(rows: AutomaticStateRow[], viewpoint?: string, pricing?: PacketPricing): {
  xml: string; manifest: ReturnType<typeof emptyPacketManifest>; tokens: number; chargedTokens: number; lineCount: number;
  linkedDetailIds: string[];
  snapshots: Array<{id: string; text: string}>;
} {
  const manifest = emptyPacketManifest();
  for (const { item } of rows) {
    manifest.stateEvidenceIds.push(item.id); manifest.atomKeys.push(stateMcpEvidence(item).atomKey);
    const id = item.id.slice(item.kind.length + 1);
    if (["world_fact", "basic_relation"].includes(item.kind)) manifest.assertionIds.push(id);
    if (item.kind === "belief") manifest.beliefIds.push(id);
    if (item.kind === "promise") manifest.promiseIds.push(id);
    if (item.relationship) manifest.relationshipPairs.push(item.relationship);
  }
  const headings = ["Relationships", "Facts of the world", "Goals and beliefs", "Promises (characters may keep, delay or break them)", "Pinned promises", "Recently ended promises", "Who knows whom", "World and secrets"];
  const openPromise = (row: AutomaticStateRow) => Number(row.item.promiseStatus === "open");
  const ordered = [...rows].sort((a, b) => stateGroup(a.item) - stateGroup(b.item)
    || (a.item.kind === "promise" && b.item.kind === "promise" ? openPromise(b) - openPromise(a) : 0) || a.rank - b.rank);
  const groups = headings.flatMap((heading, index) => {
    const group = ordered.filter(row => stateGroup(row.item) === index);
    if (index === 1 && group.every(row => rowScopes(row).every(scope => !scope))) heading += " (who knows them is not recorded)";
    return group.length ? [escapeState(heading), ...group.map(row => row.line)] : [];
  });
  // The final packet consolidator also shares identical lines. Measure that
  // exact form when distinct canonical rows have the same compact presentation.
  const lines = rows.length ? [...new Set(groups)].join("\n") : "";
  const rendered = standaloneViewpoint(lines, rows.flatMap(rowScopes), viewpoint);
  return { xml: rendered ? `<recorded_state>\n${rendered}\n</recorded_state>` : "", manifest,
    tokens: rendered ? estimateTokens(rendered) : 0, chargedTokens: chargedSectionTokens(lines ? `<recorded_state>\n${lines}\n</recorded_state>` : "", pricing),
    lineCount: lines ? lines.split("\n").length : 0,
    linkedDetailIds: rows.flatMap(row => [row.item,...(row.line !== row.baseLine && row.item.previous ? [row.item.previous.item] : [])].flatMap(item=>item.linkedDetailIds ?? [])),
    snapshots: ordered.map(row => ({ id: row.item.id, text: standaloneViewpoint(row.line, rowScopes(row), viewpoint) })) };
}
