import { estimateTokens, structuredStoryTimeEnd, type MemoryContextItem } from "@rcm/shared";
import { emptyPacketManifest } from "./packet-manifest.js";
import { rankStateEvidence, stateKindLabel, stateMcpEvidence, type StateEvidence } from "./state-evidence.js";
import type { StateOutcomeCapture } from "./state-outcomes.js";
import { EVERYONE_HOLDER } from "./item-access.js";
import { socialKnowledgeLevelLabel } from "./social-knowledge.js";

/** The 400-token floor tapers below 1,334 tokens; it never takes over a small packet. */
export const sharedStateBudget = (tokens: number): number => Math.floor(Math.min(tokens * .30, Math.max(400, tokens * .15)));

export interface AutomaticStateRow {
  item: StateEvidence;
  line: string;
  perspectives: string[];
  active: boolean;
  pinned: boolean;
  relevance: number;
  rank: number;
  legend: string;
}

/** Access and relevance are still evaluated independently for every perspective.
 * Only renderer-identical, already-authorized rows share a budget charge. */
export function automaticStateCandidates(corpus: StateEvidence[], options: {
  perspectives: string[]; activeNames: string[]; query: string; covered: ReadonlySet<string>;
  semantic?: Map<string, number>; latestStoryTime?: number; trace?: StateOutcomeCapture; memoryOnly?: boolean;
  namesRecognitionIds?: ReadonlySet<string>;
}): AutomaticStateRow[] {
  const rows = new Map<string, AutomaticStateRow>();
  const normalize = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase();
  const active = new Set(options.activeNames.map(normalize));
  for (const perspective of options.perspectives) {
    const candidates = rankStateEvidence(corpus, options.query, { perspective, activeNames: options.activeNames,
      continuity: true, semantic: options.semantic, trace: options.trace });
    for (const [index, { item, score }] of candidates.entries()) {
      const pinned = item.kind === "basic_relation" && item.subjects.length >= 2 && item.subjects.every(name => active.has(normalize(name)));
      if (options.memoryOnly || !pinned && item.sourceIds.length && item.sourceIds.every(id => options.covered.has(id))) {
        options.trace?.record(perspective, item, options.memoryOnly ? "memory_only" : "prompt_covered", { rank: index + 1 });
        continue;
      }
      if (item.kind === "recognition") {
        const rendered = options.namesRecognitionIds?.has(item.id) ? "folded_into_names"
          : !item.automatic?.body.trim() ? "omitted_empty" : undefined;
        if (rendered) {
          options.trace?.record(perspective, item, rendered === "folded_into_names" ? "deduped" : "not_rendered", { rank: index + 1, rendered });
          continue;
        }
      }
      const line = renderAutomaticStateLine(item, options.perspectives, options.latestStoryTime);
      // Keep the existing canonical deduplication policy: shortening labels or
      // eliding scope tags must not merge previously distinct records.
      const key = renderStateLine(item);
      const previous = rows.get(key);
      if (previous) {
        previous.perspectives.push(perspective);
        previous.relevance = Math.max(previous.relevance, score);
      } else rows.set(key, { item, line, perspectives: [perspective], rank: index + 1, legend: stateLegend(options.perspectives),
        relevance: score,
        pinned,
        active: [...item.holders, ...item.subjects].some(name => active.has(normalize(name))) });
    }
  }
  const promisePriority = ({ item, active }: AutomaticStateRow): number => {
    if (item.kind !== "promise" || !["open", "offscreen"].includes(item.promiseStatus ?? "")) return 0;
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

export function renderStateLine(item: StateEvidence): string {
  const escapeXml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const scope = item.holders.length ? `Known by ${(item.knownByLabels ?? item.holders).join(", ")}` : "Authorial record; character access not specified";
  return `- ${stateKindLabel(item.kind, item.stateKind)}: ${escapeXml(item.text.replace(/\r?\n/g, " "))} [${escapeXml(scope)}]`;
}

export function selectAutomaticState(rows: AutomaticStateRow[], budget: number): AutomaticStateRow[] {
  const selected = rows.filter(row => row.pinned);
  for (const row of rows) if (!row.pinned && renderAutomaticState([...selected, row]).tokens <= budget) selected.push(row);
  return selected;
}

/** Admit whole scene-linked rows after the floor. Speculative swaps are rolled
 * back when even all eligible peripheral memories cannot fund a row. */
export function fundAutomaticState(options: {
  candidates: AutomaticStateRow[]; selected: AutomaticStateRow[]; memories: MemoryContextItem[];
  tokenBudget: number; longtermMemoryIds: string[];
  canYield: (item: MemoryContextItem) => boolean; renderTokens: () => number; hardTokenCeiling: number;
}): string[] {
  // IDs arrive in portfolio order, open seeds first. Already protected longterm
  // cards count toward the floor; reserve only the missing places, unchanged.
  const longterm = options.longtermMemoryIds.flatMap(id => options.memories.filter(item => item.id === id));
  const floor = options.tokenBudget >= 4000 ? 2 : options.tokenBudget >= 2000 ? 1 : 0;
  const protectedCount = longterm.filter(item => !options.canYield(item)).length;
  const reserved = new Set(longterm.filter(options.canYield).slice(0, Math.max(0, floor - protectedCount)));
  const removed: string[] = [];
  for (const row of options.candidates) {
    if (!row.active || options.selected.includes(row)) continue;
    const previous = [...options.memories];
    options.selected.push(row);
    let tokens = options.renderTokens();
    for (let index = options.memories.length - 1; tokens > options.hardTokenCeiling && index >= 0; index--) {
      if (reserved.has(options.memories[index]!) || !options.canYield(options.memories[index]!)) continue;
      options.memories.splice(index, 1); tokens = options.renderTokens();
    }
    if (tokens <= options.hardTokenCeiling) removed.push(...previous.filter(item => !options.memories.includes(item)).map(item => item.id));
    else { options.selected.pop(); options.memories.splice(0, options.memories.length, ...previous); }
  }
  return removed;
}

const escapeState = (value: string): string => value.replace(/\r?\n/g, " ").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const normalizeHolder = (value: string): string => value.normalize("NFKC").trim().toLocaleLowerCase();
const characterPerspectives = (perspectives: string[]): string[] => [...new Set(perspectives.filter(name => !["narrator", "__shared__"].includes(name)))];

function stateLegend(perspectives: string[]): string {
  const characters = characterPerspectives(perspectives);
  return escapeState(`Untagged = ${characters.length ? `known to all of: ${characters.join(", ")}` : "known to everyone"}. [narration] = story fact with no recorded holder. [Name] = knowledge limited to listed holders.`);
}

function renderAutomaticStateLine(item: StateEvidence, perspectives: string[], latestStoryTime?: number): string {
  const characters = characterPerspectives(perspectives);
  const holders = new Set(item.holders.map(normalizeHolder));
  const shared = holders.has(EVERYONE_HOLDER) || characters.length > 0 && characters.every(name => holders.has(normalizeHolder(name)));
  const tag = shared ? "" : ` [${item.holders.length ? item.holders.join(", ") : "narration"}]`;
  const display = item.automatic;
  let body = display?.body ?? item.text;
  if (display?.recognitionLevel) body += ` (${socialKnowledgeLevelLabel[display.recognitionLevel]})`;
  if (item.kind === "promise") {
    const status = overduePromise(item, latestStoryTime) ? "overdue" : item.promiseStatus ?? "open";
    body += ` (${status}${item.due ? ` · due ${item.due}` : ""})`;
  }
  if (item.kind === "relationship") {
    if (item.relationship?.stale) body += " [Last recorded relationship; update pending.]";
    // Strip only terminal separator punctuation from typed list entries; never
    // interpret the text as a relationship change or a resolved tension.
    const tensions = display?.tensions?.map(text => text.trim().replace(/[.;]+$/u, "")).filter(Boolean);
    if (tensions?.length) body += `${/[.!?。！？]$/u.test(body) ? "" : "."} Tension: ${tensions.join("; ")}`;
  }
  // A basic relation is mutual; an arrow would read as one-sided.
  const subject = display ? display.subject : item.subjects.join(" → ");
  return `- ${escapeState(item.kind === "basic_relation" ? subject.replaceAll(" → ", " & ") : subject)}${escapeState(tag)}: ${escapeState(body)}`;
}

function overduePromise(item: StateEvidence, latestStoryTime?: number): boolean {
  const due = item.due ? structuredStoryTimeEnd(item.due) : undefined;
  return item.promiseStatus === "offscreen" || item.promiseStatus === "open" && due !== undefined && latestStoryTime !== undefined && due < latestStoryTime;
}

function stateGroup(item: StateEvidence): number {
  if (["basic_relation", "relationship"].includes(item.kind)) return 0;
  // Location/status facts use the canonical condition kind; prose is not classified.
  if (item.kind === "world_fact" && item.stateKind === "condition") return 1;
  if (item.kind === "belief" || item.stateKind === "goal") return 2;
  if (item.kind === "promise") return 3;
  return 4;
}

export function renderAutomaticState(rows: AutomaticStateRow[]) {
  const manifest = emptyPacketManifest();
  for (const { item } of rows) {
    manifest.stateEvidenceIds.push(item.id); manifest.atomKeys.push(stateMcpEvidence(item).atomKey);
    const id = item.id.slice(item.kind.length + 1);
    if (["world_fact", "basic_relation"].includes(item.kind)) manifest.assertionIds.push(id);
    if (item.kind === "belief") manifest.beliefIds.push(id);
    if (item.kind === "promise") manifest.promiseIds.push(id);
    if (item.relationship) manifest.relationshipPairs.push(item.relationship);
  }
  const headings = ["Relationships", "Now", "Goals and beliefs", "Promises", "Other"];
  const openPromise = (row: AutomaticStateRow) => Number(["open", "offscreen"].includes(row.item.promiseStatus ?? ""));
  const ordered = [...rows].sort((a, b) => stateGroup(a.item) - stateGroup(b.item)
    || (a.item.kind === "promise" && b.item.kind === "promise" ? openPromise(b) - openPromise(a) : 0) || a.rank - b.rank);
  const groups = headings.flatMap((heading, index) => {
    const group = ordered.filter(row => stateGroup(row.item) === index);
    return group.length ? [escapeState(heading), ...group.map(row => row.line)] : [];
  });
  // The final packet consolidator also shares identical lines. Measure that
  // exact form when distinct canonical rows have the same compact presentation.
  const lines = rows.length ? [...new Set([rows[0]!.legend, ...groups])].join("\n") : "";
  return { xml: lines ? `<recorded_state as_of="last_processed_history">\n${lines}\n</recorded_state>` : "", manifest, tokens: lines ? estimateTokens(lines) : 0, lineCount: lines ? lines.split("\n").length : 0 };
}
