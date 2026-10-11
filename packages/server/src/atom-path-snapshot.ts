import type { RcmDatabase } from "./db.js";
import { NARRATOR_ARCHIVE_HOLDER, readItemAccessBatches, resolveItemAccess, visibleTo, type ItemAccessRow } from "./item-access.js";
import { searchableMemoryParentSql } from "./memory-group-search.js";
import { memoryAtomKey } from "./memory-atoms.js";
import { memoryContextSignature } from "./memory-search-document.js";
import {
  ATOM_PATH_MAX_NEIGHBORS,
  searchAtomPathsWithLoader,
  type AtomPath,
  type AtomPathLink,
  type AtomPathNode,
  type AtomPathRoot,
} from "./atom-path-search.js";

interface EvidenceRef { messageId?: unknown; quote?: unknown }
type AccessRow = ItemAccessRow;
interface DetailSnapshotRow {
  id: string;
  memory_id: string;
  text: string;
  evidence_json: string;
  memory_key: string;
  participants_json: string;
  memory_evidence_json: string;
  story_time: string | null;
}
interface RelationSnapshotRow {
  id: string;
  source_detail_id: string;
  target_detail_id: string;
  kind: AtomPathLink["kind"];
  confidence: number;
  evidence_json: string;
}

export interface StoredAtomPathSearchOptions {
  chatId: string;
  perspective: string;
  roots: readonly AtomPathRoot[];
  excludedMemoryIds?: readonly string[];
  excludedAtomIds?: readonly string[];
  excludedAtomKeys?: readonly string[];
  excludedMemorySignatures?: readonly string[];
  promptSourceMessageIds?: readonly string[];
}

export interface StoredAtomPathSearchStats {
  frontierLoads: number;
  sqlQueries: number;
  incidentRowsRead: number;
  accessRowsRead: number;
  evidenceMessagesRead: number;
  nodesReturned: number;
  linksReturned: number;
}

export interface StoredAtomPathSearchResult {
  paths: AtomPath[];
  nodes: AtomPathNode[];
  stats: StoredAtomPathSearchStats;
}

const accessKey = (kind: AccessRow["item_kind"], id: string): string => `${kind}:${id}`;

function parseEvidence(value: string): EvidenceRef[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as EvidenceRef[] : undefined;
  } catch {
    return undefined;
  }
}

function evidenceMessageIds(value: string): string[] {
  return [...new Set((parseEvidence(value) ?? []).flatMap((item) => typeof item.messageId === "string" ? [item.messageId] : []))];
}

function fullyPromptCovered(value: string, covered: Set<string>): boolean {
  if (!covered.size) return false;
  const ids = evidenceMessageIds(value);
  return ids.length > 0 && ids.every((id) => covered.has(id));
}

function exactCurrentEvidence(value: string, sources: Map<string, string>): boolean {
  const evidence = parseEvidence(value);
  if (!evidence?.length) return false;
  return evidence.every((item) => {
    if (typeof item.messageId !== "string" || typeof item.quote !== "string" || !item.quote.length) return false;
    const source = sources.get(item.messageId);
    if (source === undefined) return false;
    const start = source.indexOf(item.quote);
    return start >= 0 && source.indexOf(item.quote, start + 1) < 0;
  });
}

export function searchStoredAtomPaths(db: RcmDatabase, options: StoredAtomPathSearchOptions): StoredAtomPathSearchResult {
  const excludedMemories = new Set(options.excludedMemoryIds ?? []);
  const excludedAtoms = new Set(options.excludedAtomIds ?? []);
  const excludedAtomKeys = new Set(options.excludedAtomKeys ?? []);
  const excludedSignatures = new Set(options.excludedMemorySignatures ?? []);
  const promptSources = new Set(options.promptSourceMessageIds ?? []);
  const stats: StoredAtomPathSearchStats = {
    frontierLoads: 0,
    sqlQueries: 0,
    incidentRowsRead: 0,
    accessRowsRead: 0,
    evidenceMessagesRead: 0,
    nodesReturned: 0,
    linksReturned: 0,
  };
  const nodes = new Map<string, AtomPathNode>();
  const atomExcluded = (id: string, text: string): boolean => excludedAtoms.has(id)
    || (excludedAtomKeys.size > 0 && excludedAtomKeys.has(memoryAtomKey("detail", id, text)));
  const signatureExcluded = (row: { memory_key: string; participants_json: string; memory_evidence_json: string; story_time: string | null }): boolean =>
    excludedSignatures.size > 0 && excludedSignatures.has(memoryContextSignature({ ...row, evidence_json: row.memory_evidence_json }));

  // This synchronous, read-only search owns its caches. No cached permission
  // or missing source survives into another request after a lifecycle change.
  const sourceRows = new Map<string, string>();
  const sourcesRead = new Set<string>();
  const loadSourceRows = (sourceIds: string[]): Map<string, string> => {
    const unique = [...new Set(sourceIds)].filter(id => !sourcesRead.has(id));
    for (let offset = 0; offset < unique.length; offset += 300) {
      const batch = unique.slice(offset, offset + 300);
      const rows = db.prepare(`SELECT message_id,canonical_content FROM messages
        WHERE chat_id=? AND message_id IN (${batch.map(() => "?").join(",")})
        AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')
        AND canonical_content IS NOT NULL`).all(options.chatId, ...batch) as Array<{ message_id: string; canonical_content: string }>;
      stats.sqlQueries += 1;
      stats.evidenceMessagesRead += rows.length;
      for (const id of batch) sourcesRead.add(id);
      for (const row of rows) sourceRows.set(row.message_id, row.canonical_content);
    }
    return sourceRows;
  };

  const accessRows = new Map<string, string[]>();
  const accessRead = new Set<string>();
  const loadAccess = (items: Array<{ kind: AccessRow["item_kind"]; id: string }>): Map<string, string[]> => {
    const pending = items.filter(item => !accessRead.has(accessKey(item.kind, item.id)));
    for (const rows of readItemAccessBatches(db, options.chatId, pending)) {
      stats.sqlQueries += 1;
      stats.accessRowsRead += rows.length;
      const sourceIds = [...new Set(rows.flatMap((row) => row.holder === NARRATOR_ARCHIVE_HOLDER
        ? [] : evidenceMessageIds(row.evidence_json)))];
      const sources = loadSourceRows(sourceIds);
      for (const row of rows) {
        if (row.holder !== NARRATOR_ARCHIVE_HOLDER && !exactCurrentEvidence(row.evidence_json, sources)) continue;
        const key = accessKey(row.item_kind, row.item_id);
        accessRows.set(key, [...(accessRows.get(key) ?? []), row.holder]);
      }
    }
    for (const item of pending) accessRead.add(accessKey(item.kind, item.id));
    return accessRows;
  };

  const visible = (access: Map<string, string[]>, kind: AccessRow["item_kind"], id: string): boolean => {
    const scope = resolveItemAccess(access, kind, id);
    if (!scope.explicit) return false;
    return options.perspective === "narrator" || visibleTo(scope, options.perspective);
  };

  const loadEvidenceSources = (values: string[]): Map<string, string> => {
    const ids = [...new Set(values.flatMap(evidenceMessageIds))];
    return loadSourceRows(ids);
  };

  const details = new Map<string, DetailSnapshotRow>();
  const detailsRead = new Set<string>();
  let detailQuery: ReturnType<RcmDatabase["prepare"]> | undefined;
  const loadDetails = (ids: string[]): void => {
    const pending = [...new Set(ids)].filter(id => !detailsRead.has(id));
    for (let offset = 0; offset < pending.length; offset += 300) {
      const batch = pending.slice(offset, offset + 300);
      // Drive the lookup from the bounded ID list. With d.id IN (...), SQLite
      // can prefer the chat/active index and scan every detail in the chat.
      detailQuery ??= db.prepare(`SELECT d.id,d.memory_id,d.text,d.evidence_json,m.memory_key,m.participants_json,
        m.evidence_json AS memory_evidence_json,m.story_time FROM json_each(?) requested
        CROSS JOIN memory_details d ON d.id=requested.value
        JOIN memories m ON m.id=d.memory_id AND m.chat_id=d.chat_id
        WHERE d.chat_id=? AND d.active=1 AND m.active=1 AND ${searchableMemoryParentSql("m")}`);
      const rows = detailQuery.all([JSON.stringify(batch), options.chatId]) as DetailSnapshotRow[];
      stats.sqlQueries += 1;
      for (const id of batch) detailsRead.add(id);
      for (const row of rows) details.set(row.id, row);
    }
  };
  const detailAllowed = new Map<string, boolean>();
  const allowedDetail = (id: string, access: Map<string, string[]>, sources: Map<string, string>): boolean => {
    const cached = detailAllowed.get(id);
    if (cached !== undefined) return cached;
    const row = details.get(id);
    const allowed = Boolean(row && !atomExcluded(row.id, row.text) && !excludedMemories.has(row.memory_id)
      && !signatureExcluded(row) && !fullyPromptCovered(row.evidence_json, promptSources)
      && exactCurrentEvidence(row.evidence_json, sources) && visible(access, "detail", row.id));
    detailAllowed.set(id, allowed);
    return allowed;
  };

  const rootById = new Map<string, AtomPathRoot>();
  for (const root of options.roots) {
    if (excludedAtoms.has(root.atomId) || !Number.isFinite(root.score) || root.score <= 0 || root.score > 1) continue;
    if (root.score > (rootById.get(root.atomId)?.score ?? 0)) rootById.set(root.atomId, root);
  }
  // Authorization precedes the engine's four-root cap. Otherwise four stale
  // or private high-scoring suggestions could crowd out every valid root.
  const requestedRoots = [...rootById.values()].sort((a, b) => b.score - a.score || a.atomId.localeCompare(b.atomId));
  const rootIds = requestedRoots.map((root) => root.atomId);
  loadDetails(rootIds);
  const rootRows = [...details.values()];
  const rootAccess = loadAccess(rootRows.map((row) => ({ kind: "detail", id: row.id })));
  const rootSources = loadEvidenceSources(rootRows.map((row) => row.evidence_json));
  const rootRowById = new Map(rootRows.map((row) => [row.id, row]));
  const authorizedRoots = requestedRoots.filter((root) => {
    const row = rootRowById.get(root.atomId);
    if (!row || !allowedDetail(row.id, rootAccess, rootSources)) return false;
    nodes.set(row.id, { id: row.id, memoryId: row.memory_id });
    return true;
  });

  const incidentByAtom = new Map<string, RelationSnapshotRow[]>();
  const relationAllowed = new Map<string, boolean>();
  let incidentQueries: { source: ReturnType<RcmDatabase["prepare"]>; target: ReturnType<RcmDatabase["prepare"]> } | undefined;
  const paths = searchAtomPathsWithLoader(authorizedRoots, (frontier) => {
    stats.frontierLoads += 1;
    const ids = [...new Set(frontier)].filter((id) => nodes.has(id) && !excludedAtoms.has(id));
    if (!ids.length) return { nodes: [], links: [] };
    // Keep endpoint lifecycle filtering before LIMIT. Fetch their larger
    // evidence/content fields once per detail, rather than once per incident.
    const relationSql = (column: "source_detail_id" | "target_detail_id") => `SELECT r.id,r.source_detail_id,r.target_detail_id,r.kind,r.confidence,r.evidence_json
      FROM atom_relations r
      JOIN memory_details sd ON sd.id=r.source_detail_id AND sd.chat_id=r.chat_id AND sd.active=1
      JOIN memories sm ON sm.id=sd.memory_id AND sm.chat_id=r.chat_id AND sm.active=1 AND
        (sm.capsule_parent_id IS NULL OR sm.capsule_parent_id IN (SELECT memory_id FROM episodes WHERE resolution='group' AND status='capsuled'))
      JOIN memory_details td ON td.id=r.target_detail_id AND td.chat_id=r.chat_id AND td.active=1
      JOIN memories tm ON tm.id=td.memory_id AND tm.chat_id=r.chat_id AND tm.active=1 AND
        (tm.capsule_parent_id IS NULL OR tm.capsule_parent_id IN (SELECT memory_id FROM episodes WHERE resolution='group' AND status='capsuled'))
      WHERE r.chat_id=? AND r.active=1 AND r.${column}=?
      ORDER BY r.confidence DESC,r.id LIMIT ?`;
    incidentQueries ??= { source: db.prepare(relationSql("source_detail_id")), target: db.prepare(relationSql("target_detail_id")) };
    const rows: RelationSnapshotRow[] = [];
    for (const id of ids) {
      let incident = incidentByAtom.get(id);
      if (!incident) {
        incident = [
          ...incidentQueries.source.all([options.chatId, id, ATOM_PATH_MAX_NEIGHBORS]) as RelationSnapshotRow[],
          ...incidentQueries.target.all([options.chatId, id, ATOM_PATH_MAX_NEIGHBORS]) as RelationSnapshotRow[],
        ];
        incidentByAtom.set(id, incident);
        stats.sqlQueries += 2;
        stats.incidentRowsRead += incident.length;
      }
      rows.push(...incident);
    }
    const uniqueRows = [...new Map(rows.map((row) => [row.id, row])).values()];
    const pendingRows = uniqueRows.filter(row => !relationAllowed.has(row.id));
    const endpointIds = [...new Set(pendingRows.flatMap(row => [row.source_detail_id, row.target_detail_id]))];
    loadDetails(endpointIds);
    const access = loadAccess(pendingRows.flatMap((row) => [
      { kind: "atom_relation" as const, id: row.id },
      { kind: "detail" as const, id: row.source_detail_id },
      { kind: "detail" as const, id: row.target_detail_id },
    ]));
    const sources = loadEvidenceSources([
      ...pendingRows.map(row => row.evidence_json),
      ...endpointIds.flatMap(id => details.has(id) ? [details.get(id)!.evidence_json] : []),
    ]);
    const links: AtomPathLink[] = [];
    const localNodes = new Map<string, AtomPathNode>();
    for (const row of uniqueRows) {
      let allowed = relationAllowed.get(row.id);
      if (allowed === undefined) {
        allowed = !fullyPromptCovered(row.evidence_json, promptSources)
          && exactCurrentEvidence(row.evidence_json, sources) && visible(access, "atom_relation", row.id)
          && allowedDetail(row.source_detail_id, access, sources) && allowedDetail(row.target_detail_id, access, sources);
        relationAllowed.set(row.id, allowed);
      }
      if (!allowed) continue;
      const sourceNode = { id: row.source_detail_id, memoryId: details.get(row.source_detail_id)!.memory_id };
      const targetNode = { id: row.target_detail_id, memoryId: details.get(row.target_detail_id)!.memory_id };
      localNodes.set(sourceNode.id, sourceNode);
      localNodes.set(targetNode.id, targetNode);
      nodes.set(sourceNode.id, sourceNode);
      nodes.set(targetNode.id, targetNode);
      links.push({ id: row.id, sourceAtomId: row.source_detail_id, targetAtomId: row.target_detail_id,
        kind: row.kind, confidence: row.confidence });
    }
    return { nodes: [...localNodes.values()], links };
  });

  stats.nodesReturned = nodes.size;
  stats.linksReturned = new Set(paths.flatMap((path) => path.relations.map((relation) => relation.id))).size;
  return { paths, nodes: [...nodes.values()], stats };
}
