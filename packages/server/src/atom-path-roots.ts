import { queryViewAuthority, type SearchQuerySignal } from "@rcm/shared";
import type { SemanticMemoryHit } from "./embedding.js";
import type { AtomPathRoot } from "./atom-path-search.js";

/** Candidate roots retain actual query-view/atom provenance. The DB adapter
 * must authorize them before the search engine chooses its four roots.
 * Parent scores, scene-only hits and a memory-only seed cannot invent atoms.
 */
export function proposeAtomPathRoots(
  signals: readonly SearchQuerySignal[],
  semanticHits: Iterable<SemanticMemoryHit>,
  lexicalHits: Iterable<SemanticMemoryHit>,
): AtomPathRoot[] {
  const maximumWeight = Math.max(0, ...signals.map(signal => signal.weight));
  const byAtom = new Map<string, number>();
  const record = (hit: SemanticMemoryHit, semantic: boolean) => {
    if (hit.kind !== "memory_detail" || !hit.sourceId || !Number.isInteger(hit.viewIndex)
      || !Number.isFinite(hit.score) || hit.score <= 0 || semantic && (hit.score < .72 || hit.score > 1)) return;
    const signal = signals[hit.viewIndex!];
    if (!signal || signal.weight <= 0 || signal.kind !== "focus" && signal.kind !== "cue") return;
    // Lexical hits carry absolute document coverage, not rank or confidence.
    const score = Math.min(1, hit.score)
      * queryViewAuthority(signal.weight, maximumWeight);
    byAtom.set(hit.sourceId, Math.max(byAtom.get(hit.sourceId) ?? 0, score));
  };
  for (const hit of semanticHits) record(hit, true);
  for (const hit of lexicalHits) record(hit, false);
  return [...byAtom].map(([atomId, score]) => ({ atomId, score })).sort((a, b) => b.score - a.score
    || (a.atomId < b.atomId ? -1 : a.atomId > b.atomId ? 1 : 0));
}
