import { createHash } from 'node:crypto';
import type { RcmDatabase } from './db.js';

// Sources and chat configuration are deliberately outside cancellation's ownership.
const tables = [
  'quiz_items', 'quiz_state', 'gap_recovery_messages', 'source_passages', 'extraction_audits', 'item_access',
  'atom_relations', 'recall_logs', 'conflicts', 'jobs', 'reconciliation_items', 'memory_recall_events',
  'relationship_projection_queue', 'relationship_projections', 'relationship_events', 'physical_intimacy_milestones',
  'promise_events', 'promises', 'social_knowledge_events', 'entity_scene_presence', 'entity_prominence', 'beliefs',
  'assertions', 'memory_edges', 'episode_sections', 'episode_messages', 'episodes', 'evidence_spans', 'memory_dialogues',
  'memory_details', 'memories', 'extraction_batches', 'regeneration_runs', 'story_spine_nodes', 'embedding_failures',
  'embedding_items', 'embedding_blocks', 'relationship_baselines', 'entities', 'pair_progress', 'initial_calibrations',
] as const;
type Row = { table: string; rowid: number; values: Record<string, unknown>; digest: string };
type Receipt = Pick<Row, 'table' | 'rowid' | 'digest'>;
const key = (chatId: string) => `lineage_provenance:${chatId}`;
const rowKey = (row: Pick<Row, 'table' | 'rowid'>) => `${row.table}:${row.rowid}`;
function rows(db: RcmDatabase, chatId: string): Row[] {
  const scopes = new Map<string, string>(tables.map(table => [table, 'chat_id=?']));
  const schema = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND sql LIKE 'CREATE TABLE%'").all() as { name: string }[];
  // Include dependent tables without chat_id (aliases, story support, etc.). Their
  // child-created rows must prevent an ON DELETE CASCADE from deleting them.
  for (let changed = true; changed;) {
    changed = false;
    for (const { name } of schema) {
      if (scopes.has(name)) continue;
      const links = db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as { table: string; from: string; to: string }[];
      const link = links.find(link => scopes.has(link.table));
      if (!link) continue;
      scopes.set(name, `"${link.from}" IN (SELECT "${link.to}" FROM "${link.table}" WHERE ${scopes.get(link.table)})`);
      changed = true;
    }
  }
  return [...scopes].flatMap(([table, scope]) => (db.prepare(`SELECT rowid AS _lineage_rowid_,* FROM "${table}" WHERE ${scope}`).all(chatId) as Record<string, unknown>[]).map(value => {
    const { _lineage_rowid_, ...values } = value;
    return { table, rowid: Number(_lineage_rowid_), values, digest: createHash('sha256').update(JSON.stringify(values)).digest('hex') };
  }));
}

export function hasLineageTargetData(db: RcmDatabase, chatId: string): boolean {
  return tables.filter(table => table !== 'initial_calibrations' && table !== 'quiz_state' && table !== 'recall_logs')
    .some(table => Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE chat_id=? LIMIT 1`).get(chatId)));
}

export function beginLineageReceipt(db: RcmDatabase, chatId: string): () => void {
  const before = new Set(rows(db, chatId).map(rowKey));
  return () => {
    const receipt: Receipt[] = rows(db, chatId).filter(row => !before.has(rowKey(row))).map(({ table, rowid, digest }) => ({ table, rowid, digest }));
    db.prepare('INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key(chatId), JSON.stringify(receipt));
  };
}

/** Keep edited inherited rows and all support reachable from child-owned rows. */
export function removeUnchangedInheritedRows(db: RcmDatabase, chatId: string): void {
  const stored = db.prepare('SELECT value FROM server_meta WHERE key=?').get(key(chatId)) as { value: string } | undefined;
  // Older copies have no immutable baseline. Detach them without guessing ownership.
  if (!stored) return;
  const receipt = new Map((JSON.parse(stored.value) as Receipt[]).map(row => [rowKey(row), row.digest]));
  const current = rows(db, chatId);
  const removable = new Set(current.filter(row => receipt.get(rowKey(row)) === row.digest).map(rowKey));
  const identities = new Map<string, string[]>();
  for (const row of current) if (typeof row.values.id === 'string') identities.set(row.values.id, [...(identities.get(row.values.id) ?? []), rowKey(row)]);
  const references = (value: unknown): string[] => {
    if (typeof value === 'string') {
      if (identities.has(value)) return identities.get(value)!;
      // Typed IDs also appear in JSON arrays and atom keys (memory:<id>, etc.).
      const typed = value.indexOf(':');
      if (typed > 0 && identities.has(value.slice(typed + 1))) return identities.get(value.slice(typed + 1))!;
      if (value.startsWith('[') || value.startsWith('{')) { try { return references(JSON.parse(value)); } catch { return []; } }
    }
    if (Array.isArray(value)) return value.flatMap(references);
    if (value && typeof value === 'object') return Object.values(value).flatMap(references);
    return [];
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of current) if (!removable.has(rowKey(row))) {
      for (const ref of references(row.values)) if (removable.delete(ref)) changed = true;
    }
  }
  for (const row of current) if (removable.has(rowKey(row))) {
    if (row.table === 'memories') db.prepare('DELETE FROM memory_fts WHERE memory_id=?').run(row.values.id);
    if (row.table === 'memory_details') db.prepare('DELETE FROM memory_detail_fts WHERE detail_id=?').run(row.values.id);
    if (row.table === 'embedding_items') try { db.prepare('DELETE FROM embedding_vectors_v4_chat WHERE rowid=?').run(BigInt(row.rowid)); } catch { /* sqlite-vec is optional */ }
    db.prepare(`DELETE FROM "${row.table}" WHERE rowid=?`).run(row.rowid);
  }
  db.prepare('DELETE FROM server_meta WHERE key=?').run(key(chatId));
}
