import type { AtomRelationKind } from "@rcm/shared";

/** Pure search over caller-validated, currently accessible atoms and typed
 * relations. No memory-container jumps, generic edges, SQL or model calls.
 * Evidence validity and relation access belong to the snapshot adapter.
 */
export interface AtomPathNode { id: string; memoryId: string }
export interface AtomPathRoot { atomId: string; score: number }
export interface AtomPathLink {
  id: string; sourceAtomId: string; targetAtomId: string; kind: AtomRelationKind; confidence: number;
}
export interface AtomPath {
  root: AtomPathRoot;
  atomIds: string[];
  // Stored semantic direction is preserved even when traversal runs backward.
  relations: AtomPathLink[];
  // Weakest supplied support, not accumulated activation or factual certainty.
  support: number;
}

const MAX_HOPS = 3;
const MAX_ROOTS = 4;
const BEAM_WIDTH = 64;
export const ATOM_PATH_MAX_NEIGHBORS = 32;
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const pathKey = (path: AtomPath) => JSON.stringify([path.atomIds, path.relations.map(link => link.id)]);
const comparePathOrder = (a: AtomPath, b: AtomPath, key: (path: AtomPath) => string): number => b.support - a.support
  || a.relations.length - b.relations.length || b.root.score - a.root.score || compareId(key(a), key(b));
export const compareAtomPaths = (a: AtomPath, b: AtomPath): number => comparePathOrder(a, b, pathKey);

export interface AtomPathNeighborhood {
  nodes: readonly AtomPathNode[];
  links: readonly AtomPathLink[];
}

function adjacency({ nodes, links }: AtomPathNeighborhood) {
  // Relation IDs are unique in the canonical snapshot (the table primary key).
  const allowed = new Set(nodes.map(node => node.id));
  const bySource = new Map<string, Array<{ link: AtomPathLink; target: string }>>();
  for (const link of links) {
    if (!allowed.has(link.sourceAtomId) || !allowed.has(link.targetAtomId) || link.sourceAtomId === link.targetAtomId
      || !Number.isFinite(link.confidence) || link.confidence <= 0 || link.confidence > 1) continue;
    for (const [from, target] of [[link.sourceAtomId, link.targetAtomId], [link.targetAtomId, link.sourceAtomId]] as const) {
      const neighbors = bySource.get(from) ?? [];
      neighbors.push({ link: { ...link }, target });
      bySource.set(from, neighbors);
    }
  }
  for (const [id, neighbors] of bySource) bySource.set(id, neighbors
    .sort((a, b) => b.link.confidence - a.link.confidence || compareId(a.link.id, b.link.id)).slice(0, ATOM_PATH_MAX_NEIGHBORS));
  return bySource;
}

/** Roots are already authorized by the caller. The synchronous loader reads
 * only the current frontier and supplies independently validated endpoints.
 * Search limits and ordering are shared with the in-memory evaluation path.
 */
export function searchAtomPathsWithLoader(
  roots: readonly AtomPathRoot[],
  loadNeighbors: (atomIds: string[]) => AtomPathNeighborhood,
): AtomPath[] {
  // Search-created paths are immutable here. Serialize each tie-break key once,
  // not on every sort comparison; no cache survives returned paths being edited.
  const pathKeys = new Map<AtomPath, string>();
  const cachedKey = (path: AtomPath): string => {
    let key = pathKeys.get(path);
    if (key === undefined) { key = pathKey(path); pathKeys.set(path, key); }
    return key;
  };
  const compare = (a: AtomPath, b: AtomPath): number => comparePathOrder(a, b, cachedKey);
  const rootById = new Map<string, AtomPathRoot>();
  for (const root of roots) {
    if (!Number.isFinite(root.score) || root.score <= 0 || root.score > 1) continue;
    if (root.score > (rootById.get(root.atomId)?.score ?? 0)) rootById.set(root.atomId, root);
  }
  let frontier: AtomPath[] = [...rootById.values()].sort((a, b) => b.score - a.score || compareId(a.atomId, b.atomId))
    .slice(0, MAX_ROOTS).map(root => ({ root: { ...root }, atomIds: [root.atomId], relations: [], support: root.score }));
  const best = new Map<string, AtomPath>();
  for (let depth = 1; depth <= MAX_HOPS && frontier.length; depth++) {
    const bySource = adjacency(loadNeighbors([...new Set(frontier.map(path => path.atomIds.at(-1)!))]));
    const next: AtomPath[] = [];
    for (const path of frontier) for (const { link, target } of bySource.get(path.atomIds.at(-1)!) ?? []) {
      if (path.atomIds.includes(target)) continue;
      next.push({ root: path.root, atomIds: [...path.atomIds, target],
        relations: [...path.relations, link], support: Math.min(path.support, link.confidence) });
    }
    // Preserve distinct frontier witnesses; a global visited-node set could
    // erase the only route that can continue without cycling through its root.
    // Only sixteen witnesses per root survive. Maintain those sorted prefixes
    // instead of sorting every rejected expansion; equal keys keep input order.
    const byRoot = new Map<string, AtomPath[]>();
    const perRootLimit = BEAM_WIDTH / MAX_ROOTS;
    for (const path of next) {
      const prefix = byRoot.get(path.root.atomId) ?? [];
      if (prefix.length === perRootLimit && compare(path, prefix.at(-1)!) >= 0) continue;
      let low = 0, high = prefix.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (compare(path, prefix[middle]!) < 0) high = middle;
        else low = middle + 1;
      }
      prefix.splice(low, 0, path);
      if (prefix.length > perRootLimit) prefix.pop();
      byRoot.set(path.root.atomId, prefix);
    }
    frontier = [...byRoot.values()].flat().sort(compare).slice(0, BEAM_WIDTH);
    for (const path of frontier) {
      const target = path.atomIds.at(-1)!;
      const previous = best.get(target);
      if (!previous || compare(path, previous) < 0) best.set(target, path);
    }
  }
  return [...best.values()].sort(compare);
}

export function searchAtomPaths(nodes: readonly AtomPathNode[], roots: readonly AtomPathRoot[], links: readonly AtomPathLink[]): AtomPath[] {
  const allowed = new Set(nodes.map(node => node.id));
  return searchAtomPathsWithLoader(roots.filter(root => allowed.has(root.atomId)), () => ({ nodes, links }));
}
