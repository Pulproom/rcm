import { escapeMemoryText } from "./memory-escaping.js";
import { normalizeEntityName } from "./entity-identity.js";

export type KnowledgeScope = { kind: "universal" } | { kind: "set"; names: string[] } | { kind: "narrator" };
export const NARRATOR_ARCHIVE_HOLDER = "__narrator_archive__";

export function scopeOf(entry: { knownBy: readonly string[]; knownByEveryone?: boolean }): KnowledgeScope {
  if (entry.knownByEveryone) return { kind: "universal" };
  return entry.knownBy.length ? { kind: "set", names: [...entry.knownBy] } : { kind: "narrator" };
}

export function includesPerson(scope: KnowledgeScope, name: string): boolean {
  return scope.kind === "universal" || (scope.kind === "set" && scope.names.some(value => normalizeEntityName(value) === normalizeEntityName(name)));
}

type DetailKnowledge = { knownBy: readonly string[]; knownByEveryone?: boolean; hiddenFrom?: readonly string[] };

/** Access is already resolved; concealment records intent, never revokes a grant. */
export function isException(detail: DetailKnowledge, header: readonly string[]): boolean {
  const access = scopeOf(detail);
  return !!detail.hiddenFrom?.length || header.some(name => !includesPerson(access, name));
}

export function plotKnowers(card: { knownBy: string[]; cardShape: 0 | 1; details?: readonly DetailKnowledge[] }): string[] {
  if (card.cardShape === 0) return card.knownBy;
  const exceptions = (card.details ?? []).filter(detail => isException(detail, card.knownBy));
  return card.knownBy.filter(name => exceptions.every(detail => includesPerson(scopeOf(detail), name)));
}

export function scopeRelation(line: KnowledgeScope, card: KnowledgeScope): "equal" | "inside" | "other" {
  if (line.kind === card.kind) {
    if (line.kind !== "set" || card.kind !== "set") return "equal";
    const left = new Set(line.names.map(normalizeEntityName)), right = new Set(card.names.map(normalizeEntityName));
    if (left.size === right.size && [...left].every(name => right.has(name))) return "equal";
  }
  if (line.kind === "narrator" || (line.kind === "set" && line.names.every(name => includesPerson(card, name)))) return "inside";
  return "other";
}

export function formatTagNames(names: readonly string[]): string {
  return names.map(name => /[,\[\]·]/u.test(name) ? JSON.stringify(name) : name).join(", ");
}

export function headerScopeText(scope: KnowledgeScope): string {
  return scope.kind === "universal" ? "Known by everyone" : scope.kind === "narrator" ? "No character knows" : `Known by ${formatTagNames(scope.names)}`;
}

export function standaloneScopeText(scope: KnowledgeScope | undefined, viewpoint?: string): string {
  if (!scope) return ""; // Unrecorded knowers are not an explicit narrator-only declaration.
  return headerScopeText(scope) + (viewpoint && !includesPerson(scope, viewpoint) ? ` · ${viewpointUnknownTag(viewpoint)}` : "");
}

export function lineScopeTag(line: KnowledgeScope, card: KnowledgeScope): string | undefined {
  const relation = scopeRelation(line, card);
  if (relation === "equal") return undefined;
  if (line.kind === "narrator") return "no character knows";
  if (line.kind === "universal") return "known by everyone";
  return `${relation === "inside" ? "only" : "known by"} ${formatTagNames(line.names)}`;
}

export function secretTargets(hiddenFrom: readonly string[] | undefined, line: KnowledgeScope): string[] {
  return (hiddenFrom ?? []).filter(name => !includesPerson(line, name));
}

export const NARRATION_NAME_MAX_CHARACTERS = 40;

export function boundedNarrationName(viewpoint: string): string {
  // Bound code points before escaping, cutting only between complete graphemes.
  // The ellipsis occupies one character of the fixed display allowance.
  let display = viewpoint;
  if ([...viewpoint].length > NARRATION_NAME_MAX_CHARACTERS) {
    display = "";
    let used = 0;
    for (const {segment} of new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(viewpoint)) {
      const length = [...segment].length;
      if (used + length >= NARRATION_NAME_MAX_CHARACTERS) break;
      display += segment;
      used += length;
    }
    display += "…";
  }
  return display;
}

export function viewpointUnknownTag(viewpoint: string, partial = false): string {
  return `${boundedNarrationName(viewpoint)} doesn't know${partial ? " all of it" : ""}`;
}

export function narrationLine(viewpoint: string): string {
  const name = escapeMemoryText(boundedNarrationName(viewpoint));
  return `<narration>Narrating through ${name}. "${name} doesn't know" marks what ${name} does not know.</narration>`;
}
