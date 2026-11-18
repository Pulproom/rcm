import { escapeMemoryText as escape, escapeMemoryAttribute } from "./memory-escaping.js";
import { memoryGuidanceBlock, memoryAccessLabel, memoryEvidenceLabel, sameMemoryLabels } from "./memory-presentation.js";
import { projectMemoryScene, renderMemoryScene } from "./memory-scene.js";
import { narrationLine } from "./knowledge-scope.js";
import { segmentSentences } from "./sentence-segmentation.js";
import type { MemoryContextItem } from "./index.js";

/** Internal final emission plan projection; never part of the tool wire schema. */
export interface McpCard {
  memoryId: string;
  item: MemoryContextItem;
  plot: "emit" | "omit";
  detailIds: string[];
  dialogueIds: string[];
  moreDetails?: boolean;
}

/** Internal source coordinates. They support diagnostics and same-turn overlap
 * suppression but are never rendered for the main model. */
export interface McpSourceRange {
  messageId: string;
  start: number;
  end: number;
}

/** Metadata derived from a citation whose exact source range is known. It is
 * kept internal until the final excerpt range has been selected. */
export interface McpSourceMetadata {
  sourceRange: McpSourceRange;
  location?: string;
}

/** Server-only display projection. Symbols never enter the public JSON contract. */
export const mcpSourcePresentation = Symbol("mcpSourcePresentation");

/** Internal evidence contract. IDs and delivery state never appear in model prose. */
export interface McpEvidence {
  [mcpSourcePresentation]?: { ordinal: number; range?: McpSourceRange; hasVisibleTextBetween?: (start: number, end: number) => boolean };
  atomKey: string;
  bundleKey?: string;
  memoryId?: string;
  /** Dialogue is a model-authored excerpt; quote is an exact source passage. */
  kind: "fact" | "dialogue" | "quote";
  text: string;
  speaker?: string;
  time?: string;
  location?: string;
  knownBy?: string[];
  knownByEveryone?: boolean;
  knownByLabels?: string[];
  hiddenFrom?: string[];
  /** Current directional recognition identity, for Names overlap suppression. */
  recognitionId?: string;
  basis?: string;
  /** Authorial record heading, not evidence of any character's knowledge. */
  context?: string;
  ref?: string;
  sourceRange?: McpSourceRange;
  /** All exact supporting intervals for an authored dialogue, never a raw-source access grant. */
  dialogueSourceRanges?: McpSourceRange[];
  sourceMetadata?: McpSourceMetadata[];
}

export interface McpQuestionAnswer {
  question: string;
  evidence: McpEvidence[];
  /** Optional evidence-grounded prose produced by the configured MCP helper.
   * It is rendered as data and never treated as trusted markup. */
  synthesizedText?: string;
  /** Internal bundle citation -> stored record identities, resolved at rendering. */
  synthesizedReferences?: Record<string, string[]>;
  /** A compact reminder of directly answering evidence that was already
   * present in the automatic packet or an earlier same-turn tool response. */
  alreadyProvidedEvidence?: McpEvidence[];
  alreadyPresent: boolean;
  searchUnavailable?: boolean;
  relatedRecords?: boolean;
}


const scope = (entry: McpEvidence): string[] => entry.knownByEveryone ? ["everyone"] : entry.knownByLabels ?? entry.knownBy ?? [];
// Source message labels are our own legacy envelope, not scene locations.
const place = (entry: McpEvidence): string | undefined => entry.location && !/^Source message\s+\d+$/i.test(entry.location) ? entry.location : undefined;

/** Exact source coverage only; authored facts/dialogue are never deduplicated.
 * Cuts use stored interval endpoints and typographic sentence boundaries. */
export function unrepeatedMcpEvidence(entries: McpEvidence[], covered: McpSourceRange[] = []): McpEvidence[] {
  return entries.flatMap(entry => {
    const range=entry.sourceRange;
    if(entry.kind!=="quote" || !range)return [entry];
    let gaps=[{...range}];
    for(const prior of covered.filter(prior=>prior.messageId===range.messageId))gaps=gaps.flatMap(gap=>
      prior.end<=gap.start || prior.start>=gap.end ? [gap] : [
        ...(gap.start<prior.start ? [{...gap,end:prior.start}] : []),
        ...(prior.end<gap.end ? [{...gap,start:prior.end}] : []),
      ]);
    if(gaps.length===1 && gaps[0]!.start===range.start && gaps[0]!.end===range.end){covered.push(range);return [entry];}
    if(!gaps.length || range.end-range.start!==entry.text.length)return [];
    const boundaries=new Set([0,entry.text.length,...segmentSentences(entry.text).flatMap(part=>[
      part.index,part.index+part.segment.length,part.index+part.segment.trimEnd().length,
    ])]);
    // A boundary inside a sentence makes this overlapping passage unsafe to cut.
    if(gaps.some(gap=>!boundaries.has(gap.start-range.start)||!boundaries.has(gap.end-range.start)))return [];
    covered.push(...gaps);
    return gaps.map(gap=>({...entry,atomKey:`${entry.atomKey}:source:${gap.start}:${gap.end}`,
      sourceRange:gap,text:entry.text.slice(gap.start-range.start,gap.end-range.start)}));
  });
}

/** Character-facing MCP keeps its existing evidence grouping. */
function mostFrequentFactScope(entries: readonly (readonly string[])[]): readonly string[] {
  const scopes: Array<{ labels: readonly string[]; count: number }> = [];
  for (const labels of entries) {
    const scope = scopes.find(scope => sameMemoryLabels(scope.labels, labels));
    if (scope) scope.count++; else scopes.push({ labels, count: 1 });
  }
  return scopes.reduce((best, scope) => scope.count > best.count ? scope : best, { labels: [], count: 0 }).labels;
}

function renderRecord(record: McpEvidence[], index: number, reference: (id: string) => string | undefined, card?: McpCard, viewpoint?: string): string {
  const first = record[0]!;
  const ref = first.ref ?? (first.memoryId ? reference(first.memoryId) : undefined);
  const facts = record.filter(entry => entry.kind !== "quote"), quotes = record.filter(entry => entry.kind === "quote");
  const range = (entry:McpEvidence) => entry.sourceRange ?? entry[mcpSourcePresentation]?.range;
  // Admission stays relevance-first; only exact source display follows story order.
  quotes.sort((a,b) => (a[mcpSourcePresentation]?.ordinal ?? 0) - (b[mcpSourcePresentation]?.ordinal ?? 0)
    || (range(a)?.start ?? 0) - (range(b)?.start ?? 0));
  const source = quotes.length ? `Source (exact text; narration does not show who knew it):\n${quotes.map((entry,index) => {
    const previous=index?range(quotes[index-1]!):undefined, current=range(entry);
    const gap=previous && current && (previous.messageId!==current.messageId
      || (entry[mcpSourcePresentation]?.hasVisibleTextBetween?.(previous.end,current.start) ?? current.start>previous.end));
    return `${index ? gap ? "\n\n[…]\n\n" : "\n\n" : ""}${escape(entry.text)}`;
  }).join("")}` : "";
  if (card) {
    const item = {...card.item,
      details: card.item.details.filter(detail => card.detailIds.includes(detail.id)),
      keyDialogues: card.item.keyDialogues};
    const scene = projectMemoryScene(item);
    // Relevance already chose which details fit. Display them in the stored
    // record order (source position, then extraction order), like automatic
    // cards, so the card reads as one continuous scene.
    let text = renderMemoryScene(scene,{plot:card.plot,viewpoint,clarity:item.clarity});
    // MCP exposes persistent refs, never storage IDs. This is our card envelope.
    text = text.replace(/ id="[^"]*"/, ref ? ` ref="${escapeMemoryAttribute(ref)}"` : "");
    if (card.moreDetails && ref) text = text.replace("\n</memory>", `\nMore details: expand_rp_memory ref=${escape(ref)}\n</memory>`);
    return [text,source].filter(Boolean).join("\n");
  }
  // An unrecorded row cannot inherit a neighbouring fact's knowledge claim.
  const defaultScope = facts.some(entry => !scope(entry).length) ? [] : mostFrequentFactScope(facts.map(scope));
  const time = facts.find(entry => entry.time)?.time;
  const location = facts.map(place).find(Boolean);
  const isState = first.atomKey.startsWith("state:");
  const accessLabel = facts.length ? memoryAccessLabel(defaultScope) : "";
  const header = [time, !isState ? accessLabel : undefined, location ? `Place: ${location}` : undefined].filter(Boolean).map(value => escape(value!)).join(" · ");
  let priorPlace = location;
  const lines = facts.map(entry => {
    const labelText = memoryAccessLabel(scope(entry)).replace(/^No character knows$/, "no character knows");
    const access = sameMemoryLabels(defaultScope, scope(entry)) || !labelText ? "" : `[${escape(labelText)}] `;
    const label = entry.basis && !isState ? memoryEvidenceLabel(entry.basis) : "Observed";
    const qualifier = ["Observed", "archive context", "stored_record"].includes(label) ? "" : `${escape(label)}: `;
    const currentPlace = place(entry);
    const suffix = currentPlace && currentPlace !== priorPlace ? ` (at ${escape(currentPlace)})` : "";
    if (currentPlace) priorPlace = currentPlace;
    const timing = entry.time && entry.time !== time ? ` (${escape(entry.time)})` : "";
    const content = entry.kind === "dialogue" ? `${entry.speaker ? `${escape(entry.speaker)}: ` : ""}“${escape(entry.text)}”` : escape(entry.text);
    return `${entry.kind === "dialogue" ? "" : "- "}${access}${qualifier}${content}${timing}${suffix}`;
  });
  const heading = first.atomKey.startsWith("state:") ? "State" : first.memoryId ? `Record ${index + 1}` : first.kind === "quote" ? "Source excerpt" : first.context ?? `Record ${index + 1}`;
  // Exact passages never inherit scene metadata and their text is left intact.
  return [`${heading}${isState && accessLabel ? ` [${escape(accessLabel.replace(/^Known by/,"known by").replace(/^No character knows/,"no character knows"))}]` : ""}${ref ? ` [ref=${escape(ref)}]` : ""}`, header, lines.join("\n"), source].filter(Boolean).join("\n");
}

/** Groups only by stored record identity. Author cards consume the final plan;
 * character-facing calls retain their evidence-scoped presentation. */
export function renderMcpAnswer(answers: McpQuestionAnswer[], reference: (id: string) => string | undefined = () => undefined,
  options?: { cards: McpCard[]; viewpoint?: string }): string {
  // Status-only responses have no evidence to interpret. Keep their complete
  // envelope below the smallest supported tool budget, regardless of question count.
  if (!answers.some(answer => answer.synthesizedText?.trim() || answer.evidence.length || answer.alreadyProvidedEvidence?.length)) return answers.some(answer => answer.searchUnavailable)
    ? "<rp_memory_result>Memory lookup failed this time, so nothing can be concluded from it. Continue from the chat and the memories you already have, and do not invent past events.</rp_memory_result>"
    : answers.some(answer => answer.alreadyPresent)
    ? "<rp_memory_result>The relevant memory is already present in this turn. No new details were retrieved.</rp_memory_result>"
    : "<rp_memory_result>No matching memory was found. This does not mean it never happened.</rp_memory_result>";
  const covered: McpSourceRange[]=[];
  const sections = answers.map(answer => {
    const entries = unrepeatedMcpEvidence([...new Map([...(answer.alreadyProvidedEvidence ?? []), ...answer.evidence].map(item => [item.atomKey, item])).values()],covered);
    const records = new Map<string, McpEvidence[]>();
    for (const entry of entries) {
      const key = entry.memoryId ?? entry.bundleKey ?? entry.atomKey;
      records.set(key, [...(records.get(key) ?? []), entry]);
    }
    // Parse only the selector-owned citation envelope, never RP semantics.
    const synthesized = answer.synthesizedText?.trim().replace(/\s*\[((?:\s*[be]\d+\s*(?:,\s*[be]\d+\s*)*))\]/gi, (_match, ids: string) => {
      const refs = (ids.match(/b\d+/gi) ?? []).flatMap(id => (answer.synthesizedReferences?.[id.toLowerCase()] ?? []).flatMap(memoryId => {
        const ref = entries.find(entry => entry.memoryId === memoryId && entry.ref)?.ref ?? reference(memoryId);
        return ref ? [`[ref=${ref}]`] : [];
      }));
      // A citation with no expandable record disappears with its leading space.
      return refs.length ? ` ${[...new Set(refs)].join(" ")}` : "";
    }).trim();
    const body = [synthesized ? `Memory answer\n${escape(synthesized)}` : "", ...[...records.values()].map((record, index) => `<record>\n${renderRecord(record, index, reference,
      options?.cards.find(card => card.memoryId === record[0]?.memoryId),options?.viewpoint)}\n</record>`)].filter(Boolean).join("\n\n");
    const status = answer.searchUnavailable ? "The lookup was incomplete. These records may leave out relevant past events."
      : !entries.length && !synthesized ? answer.alreadyPresent || answer.evidence.length || answer.alreadyProvidedEvidence?.length
        ? "The relevant memory is already present in this turn. No new details were retrieved."
        : "No matching memory was found. This does not mean it never happened." : "";
    return `${answers.length > 1 ? `Question: ${escape(answer.question)}\n` : ""}${[body, status].filter(Boolean).join("\n")}`;
  }).join("\n\n");
  return `<rp_memory_result>\n${memoryGuidanceBlock}\n${options?.viewpoint && options.cards.length ? `${narrationLine(options.viewpoint)}\n` : ""}${sections}\n</rp_memory_result>`;
}
