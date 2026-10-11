import { defaultMemoryScope, memoryAccessLabel, memoryEvidenceLabel, sameMemoryLabels } from "./memory-presentation.js";

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

const escape = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

const scope = (entry: McpEvidence): string[] => entry.knownByEveryone ? ["everyone"] : entry.knownByLabels ?? entry.knownBy ?? [];
// Source message labels are our own legacy envelope, not scene locations.
const place = (entry: McpEvidence): string | undefined => entry.location && !/^Source message\s+\d+$/i.test(entry.location) ? entry.location : undefined;

function renderRecord(record: McpEvidence[], index: number, reference: (id: string) => string | undefined): string {
  const first = record[0]!;
  const ref = first.ref ?? (first.memoryId ? reference(first.memoryId) : undefined);
  const facts = record.filter(entry => entry.kind !== "quote"), quotes = record.filter(entry => entry.kind === "quote");
  const defaultScope = defaultMemoryScope(facts.map(scope));
  const time = facts.find(entry => entry.time)?.time;
  const location = facts.map(place).find(Boolean);
  const header = [time, facts.length ? memoryAccessLabel(defaultScope) : undefined, location ? `Place: ${location}` : undefined].filter(Boolean).map(value => escape(value!)).join(" · ");
  let priorPlace = location;
  const lines = facts.map(entry => {
    const access = sameMemoryLabels(defaultScope, scope(entry)) ? "" : `[${escape(memoryAccessLabel(scope(entry)))}] `;
    const label = entry.basis ? memoryEvidenceLabel(entry.basis) : "Observed";
    const qualifier = ["Observed", "archive context", "stored_record"].includes(label) ? "" : `${escape(label)}: `;
    const currentPlace = place(entry);
    const suffix = currentPlace && currentPlace !== priorPlace ? ` (at ${escape(currentPlace)})` : "";
    if (currentPlace) priorPlace = currentPlace;
    const timing = entry.time && entry.time !== time ? ` (${escape(entry.time)})` : "";
    const content = entry.kind === "dialogue" ? `${entry.speaker ? `${escape(entry.speaker)}: ` : ""}“${escape(entry.text)}”` : escape(entry.text);
    return `${entry.kind === "dialogue" ? "" : "- "}${access}${qualifier}${content}${timing}${suffix}`;
  });
  const heading = first.atomKey.startsWith("state:") ? "Stored state" : first.memoryId ? `Record ${index + 1}` : first.kind === "quote" ? "Source excerpt" : `Record ${index + 1}`;
  // Exact passages never inherit scene metadata and their text is left intact.
  const source = quotes.length ? `Source (verbatim, narrator text; grants no character knowledge):\n${quotes.map(entry => escape(entry.text)).join("\n\n")}` : "";
  return [`${heading}${ref ? ` [ref=${escape(ref)}]` : ""}${first.context ? ` — ${escape(first.context)}` : ""}`, header, lines.join("\n"), source].filter(Boolean).join("\n");
}

/** Groups only by stored record identity, never infers event identity from proximity.
 * Default access is shared with automatic scene cards; exceptions stay inline. */
export function renderMcpAnswer(answers: McpQuestionAnswer[], reference: (id: string) => string | undefined = () => undefined): string {
  if (!answers.some(answer => answer.synthesizedText?.trim() || answer.evidence.length || answer.alreadyProvidedEvidence?.length)) return answers.some(answer => answer.searchUnavailable)
    ? "<rp_memory_result>Memory search could not complete. This is not a search miss.</rp_memory_result>"
    : "<rp_memory_result>No useful memory candidate was retrieved. This does not prove absence.</rp_memory_result>";
  const sections = answers.map(answer => {
    const entries = [...new Map([...(answer.alreadyProvidedEvidence ?? []), ...answer.evidence].map(item => [item.atomKey, item])).values()];
    const records = new Map<string, McpEvidence[]>();
    for (const entry of entries) {
      const key = entry.memoryId ?? entry.bundleKey ?? (entry.atomKey.startsWith("state:") ? "stored-state" : entry.atomKey);
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
    const body = [synthesized ? `Memory answer\n${escape(synthesized)}` : "", ...[...records.values()].map((record, index) => renderRecord(record, index, reference))].filter(Boolean).join("\n\n");
    const status = answer.searchUnavailable ? "Search was incomplete; these records may omit relevant history."
      : !entries.length && !synthesized ? "No useful memory candidate was retrieved. A search miss does not establish absence." : "";
    return `${answers.length > 1 ? `Question: ${escape(answer.question)}\n` : ""}${[body, status].filter(Boolean).join("\n")}`;
  }).join("\n\n");
  return `<rp_memory_result>\n${sections}\n\nThe question itself is not evidence; unrecorded outcomes remain unknown.\n</rp_memory_result>`;
}
