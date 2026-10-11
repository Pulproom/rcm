import { parseStoryTime, type MemoryContextItem } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { extendRecallPath, startRecallPath, type RecallPath, type RecallPathCapture } from "./recall-path.js";

type EventContextNode = Pick<MemoryContextItem, "id" | "score" | "storyTime" | "evidenceMessageIds" | "locations" | "sourceOrdinal">;
export interface EventConnection<T extends EventContextNode> {
  item: T;
  parentId: string;
  depth: number;
  activation: number;
  weight: number;
  reason: "shared_evidence" | "same_date_location" | "strong_edge" | "legacy_scene_affinity";
}
interface EventClusterResult<T extends EventContextNode> {
  ordered: T[];
  connections: Map<string, EventConnection<T>>;
}

// Event-context ordering is separate from cognitive association selection.
// Callers supply nodes already filtered by the relevant perspective/access policy.
function storyDate(value: string | undefined): string | undefined {
  const parsed = parseStoryTime(value);
  if (!parsed.calendarKey || parsed.year === undefined || parsed.month === undefined || parsed.day === undefined) return undefined;
  return `${parsed.calendarKey}:${String(parsed.year).padStart(4, "0")}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
}

export function orderEventContext<T extends EventContextNode>(
  db: RcmDatabase,
  chatId: string,
  seeds: T[],
  eligible: T[],
  strictAutomatic = false,
  limit = 8,
  paths?: RecallPathCapture,
): EventClusterResult<T> {
  const byId = new Map(eligible.map((item) => [item.id, item]));
  const accepted = new Map<string, { item: T; priority: number }>();
  const connections = new Map<string, EventConnection<T>>();
  let frontier = seeds.filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 4).map((item) => ({ item, depth: 0, activation: 1 }));
  for (const seed of frontier) accepted.set(seed.item.id, { item: seed.item, priority: 10 + seed.item.score });
  let frontierPaths = paths ? new Map(frontier.map(({ item }): [string, RecallPath] => [item.id,
    startRecallPath({ memoryId: item.id, kind: "event_seed", score: 1 }),
  ])) : undefined;
  for (let depth = 1; depth <= 4 && frontier.length > 0; depth += 1) {
    const ids = frontier.map((entry) => entry.item.id);
    const placeholders = ids.map(() => "?").join(",");
    const edges = db.prepare(`
      SELECT source_id,target_id,weight FROM memory_edges
      WHERE chat_id=? AND (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
      ORDER BY weight DESC LIMIT 160
    `).all(chatId, ...ids, ...ids) as Array<{ source_id: string; target_id: string; weight: number }>;
    const source = new Map(frontier.map((entry) => [entry.item.id, entry]));
    const next = new Map<string, { item: T; depth: number; activation: number }>();
    const nextPaths = paths ? new Map<string, RecallPath>() : undefined;
    for (const edge of edges) {
      const parent = source.get(edge.source_id) ?? source.get(edge.target_id);
      if (!parent) continue;
      const targetId = parent.item.id === edge.source_id ? edge.target_id : edge.source_id;
      const target = byId.get(targetId);
      if (!target || accepted.has(targetId)) continue;
      const sameDate = Boolean(storyDate(parent.item.storyTime) && storyDate(parent.item.storyTime) === storyDate(target.storyTime));
      const sharedEvidence = parent.item.evidenceMessageIds.some((id) => target.evidenceMessageIds.includes(id));
      const sharedLocation = parent.item.locations.some((location) => target.locations.includes(location));
      // Strong authored edges can bridge setup and payoff across dates. In an
      // automatic packet, weaker associations only join a scene when they
      // share evidence or both story date and location. MCP follow/recall keeps
      // the broader authored-neighborhood behavior. Relevance alone must not
      // turn a loose graph edge into an automatic event boundary.
      const sameDateAndLocation = sameDate && sharedLocation;
      if (strictAutomatic
        ? !sharedEvidence && !sameDateAndLocation && edge.weight < 0.78
        : !sameDate && !sharedEvidence && !sharedLocation && edge.weight < 0.78) continue;
      const activation = parent.activation * edge.weight * 0.6;
      if (activation < 0.05) continue;
      const priority = 8 - depth + activation + target.score * 0.1;
      const existing = next.get(targetId);
      if (!existing || activation > existing.activation) next.set(targetId, { item: target, depth, activation });
      accepted.set(targetId, { item: target, priority });
      const connection: EventConnection<T> = {
        item: target,
        parentId: parent.item.id,
        depth,
        activation,
        weight: edge.weight,
        reason: sharedEvidence ? "shared_evidence"
          : sameDateAndLocation ? "same_date_location"
            : edge.weight >= 0.78 ? "strong_edge" : "legacy_scene_affinity",
      };
      const previous = connections.get(targetId);
      if (!previous || connection.depth < previous.depth
        || connection.depth === previous.depth && connection.activation > previous.activation) {
        connections.set(targetId, connection);
        const parentPath = frontierPaths?.get(parent.item.id);
        if (paths && parentPath) {
          const path = extendRecallPath(parentPath, { fromMemoryId: parent.item.id, toMemoryId: targetId,
            stage: "event", relation: "memory_edge", weight: edge.weight, energy: activation, reason: connection.reason });
          nextPaths!.set(targetId, path);
          paths.event.set(targetId, path);
        }
      }
    }
    frontier = [...next.values()];
    frontierPaths = nextPaths;
  }
  const ordered = [...accepted.values()].sort((left, right) => right.priority - left.priority
    || (left.item.sourceOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.item.sourceOrdinal ?? Number.MAX_SAFE_INTEGER))
    .slice(0, limit).map((entry) => entry.item);
  return { ordered, connections };
}
