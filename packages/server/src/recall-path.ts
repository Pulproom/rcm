import type { SearchQuerySignal } from "@rcm/shared";
import type { SemanticMemoryHit } from "./embedding.js";

export interface RootSignal {
  scope: "query"; viewIndex: number; signalKind: "focus" | "cue";
  channel: "detail_semantic"; sourceMemoryId: string; detailId: string; observedScore: number;
}
// An observed atom signal supports the root, but does not explain its entire
// aggregate score or certify original-source truth.
export type RootEvidence = { status: "observed_atom"; signals: RootSignal[] }
  | { status: "aggregate_only" | "explicit_seed" | "event_seed" };

/** Observations of the existing search, never inputs to ranking or access.
 * The enclosing retrieval diagnostic supplies the perspective. These routes
 * do not certify original-source validity or the cause of a semantic hit.
 */
export interface RecallPath {
  targetMemoryId: string;
  anchor: {
    memoryId: string;
    kind: "direct_signal" | "detail_signal" | "explicit_seed" | "event_seed";
    // Aggregate direct signal, or 1 for an explicit/event stage seed. This is
    // not a final score; graph propagation still applies its existing clamp.
    score: number;
    detailId?: string;
    rootEvidence: RootEvidence;
  };
  hops: Array<{
    fromMemoryId: string;
    toMemoryId: string;
    stage: "seed_association" | "graph" | "event";
    relation: "memory_edge";
    weight: number;
    // Actual contribution/activation at this stage, including existing boosts.
    energy: number;
    reason?: "shared_evidence" | "same_date_location" | "strong_edge" | "legacy_scene_affinity";
  }>;
}

export interface RecallPathObservation {
  version: 1;
  direct?: RecallPath;
  // Latest accepted propagation path, or the seed one-hop if not replaced.
  // This is bounded provenance, not a history of every visited edge.
  graph?: RecallPath;
  event?: RecallPath;
  unobserved: Array<"story_arc" | "initial_association" | "residual" | "no_recorded_path">;
}

export interface RecallPathCapture {
  direct: Map<string, RecallPath>;
  graph: Map<string, RecallPath>;
  event: Map<string, RecallPath>;
}

export function startRecallPath(anchor: Omit<RecallPath["anchor"], "rootEvidence"> & { rootEvidence?: RootEvidence }): RecallPath {
  return { targetMemoryId: anchor.memoryId, anchor: { ...anchor, rootEvidence: anchor.rootEvidence ?? {
    status: anchor.kind === "explicit_seed" ? "explicit_seed" : anchor.kind === "event_seed" ? "event_seed" : "aggregate_only",
  } }, hops: [] };
}

/** Called only for diagnostics, after detail activity/access/coverage filtering.
 * Query indices belong to automatic querySignals, never to MCP aspects.
 */
export function observeRootEvidence(memoryId: string, visibleDetailIds: ReadonlySet<string>,
  hits: readonly SemanticMemoryHit[] | undefined, signals: readonly SearchQuerySignal[]): RootEvidence {
  const observed = new Map<string, RootSignal>();
  for (const hit of hits ?? []) {
    if (hit.kind !== "memory_detail" || hit.memoryId !== memoryId || !visibleDetailIds.has(hit.sourceId)
      || !Number.isFinite(hit.score) || hit.score < 0.72 || !Number.isInteger(hit.viewIndex)) continue;
    const signal = signals[hit.viewIndex!];
    if (!signal || signal.weight <= 0 || signal.kind !== "focus" && signal.kind !== "cue") continue;
    const key = `${hit.viewIndex}\0${hit.sourceId}`;
    if ((observed.get(key)?.observedScore ?? -Infinity) >= hit.score) continue;
    observed.set(key, { scope: "query", viewIndex: hit.viewIndex!, signalKind: signal.kind,
      channel: "detail_semantic", sourceMemoryId: memoryId, detailId: hit.sourceId, observedScore: hit.score });
  }
  const selected = [...observed.values()].sort((a, b) => b.observedScore - a.observedScore
    || a.viewIndex - b.viewIndex || a.detailId.localeCompare(b.detailId)).slice(0, 4);
  return selected.length ? { status: "observed_atom", signals: selected } : { status: "aggregate_only" };
}

// Copy the path from the current frontier, not the latest mutable parent map.
// Otherwise an improvement to a parent within the same hop can invent a route
// that the search never traversed.
export function extendRecallPath(path: RecallPath, hop: RecallPath["hops"][number]): RecallPath {
  return { targetMemoryId: hop.toMemoryId, anchor: path.anchor, hops: [...path.hops, hop] };
}
