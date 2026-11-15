import { escapeMemoryText as escape, escapeMemoryAttribute } from "./memory-escaping.js";
import { memoryGuidanceBlock, memoryAccessLabel, memoryEvidenceLabel, sameMemoryLabels } from "./memory-presentation.js";
import { projectMemoryScene, renderMemoryScene } from "./memory-scene.js";
import { narrationLine } from "./knowledge-scope.js";
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

/** Internal evidence contract. IDs and delivery state never appear in model prose. */
export interface McpEvidence {
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
  if (card) {
    const item = {...card.item,
      details: card.detailIds.flatMap(id => card.item.details.filter(detail => detail.id === id)),
      keyDialogues: card.item.keyDialogues};
    const scene = projectMemoryScene(item);
    // MCP depth follows relevance, unlike automatic cards' source order.
    scene.details = scene.details.map(detail => ({...detail, sourceOrdinal:undefined}));
    let text = renderMemoryScene(scene,{plot:card.plot,viewpoint,clarity:item.clarity});
    // MCP exposes persistent refs, never storage IDs. This is our card envelope.
    text = text.replace(/ id="[^"]*"/, ref ? ` ref="${escapeMemoryAttribute(ref)}"` : "");
    if (card.moreDetails && ref) text = text.replace("\n</memory>", `\nMore details: expand_rp_memory ref=${escape(ref)}\n</memory>`);
    const source = quotes.length ? `Source (exact text; narration does not show who knew it):\n${quotes.map(entry => escape(entry.text)).join("\n\n")}` : "";
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
  const heading = first.atomKey.startsWith("state:") ? "Current state" : first.memoryId ? `Record ${index + 1}` : first.kind === "quote" ? "Source excerpt" : first.context ?? `Record ${index + 1}`;
  // Exact passages never inherit scene metadata and their text is left intact.
  const source = quotes.length ? `Source (exact text; narration does not show who knew it):\n${quotes.map(entry => escape(entry.text)).join("\n\n")}` : "";
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
  const sections = answers.map(answer => {
    const entries = [...new Map([...(answer.alreadyProvidedEvidence ?? []), ...answer.evidence].map(item => [item.atomKey, item])).values()];
    const records = new Map<string, McpEvidence[]>();
    for (const entry of entries) {
      const key = entry.memoryId ?? entry.bundleKey ?? entry.atomKey;
      records.set(key, [...(records.get(key) ?? []), entry]);
    }
    // Parse only the selector-owned citation envelope, never RP semantics.
    const synthesized = answer.synthesizedText?.trim().replace(/\s*\[((?:\s*b\d+\s*(?:,\s*b\d+\s*)*))\]/gi, (_match, ids: string) => {
      const refs = (ids.match(/b\d+/gi) ?? []).flatMap(id => (answer.synthesizedReferences?.[id.toLowerCase()] ?? []).flatMap(memoryId => {
        const ref = entries.find(entry => entry.memoryId === memoryId && entry.ref)?.ref ?? reference(memoryId);
        return ref ? [`[ref=${ref}]`] : [];
      }));
      // A citation with no expandable record disappears with its leading space.
      return refs.length ? ` ${[...new Set(refs)].join(" ")}` : "";
    }).trim();
    const body = [synthesized ? `Memory answer\n${escape(synthesized)}` : "", ...[...records.values()].map((record, index) => renderRecord(record, index, reference,
      options?.cards.find(card => card.memoryId === record[0]?.memoryId),options?.viewpoint))].filter(Boolean).join("\n\n");
    const status = answer.searchUnavailable ? "The lookup was incomplete. These records may leave out relevant past events."
      : !entries.length && !synthesized ? answer.alreadyPresent
        ? "The relevant memory is already present in this turn. No new details were retrieved."
        : "No matching memory was found. This does not mean it never happened." : "";
    return `${answers.length > 1 ? `Question: ${escape(answer.question)}\n` : ""}${[body, status].filter(Boolean).join("\n")}`;
  }).join("\n\n");
  return `<rp_memory_result>\n${memoryGuidanceBlock}\n${options?.viewpoint && options.cards.length ? `${narrationLine(options.viewpoint)}\n` : ""}${sections}\n</rp_memory_result>`;
}
