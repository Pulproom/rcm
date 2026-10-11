import type { ExtractionResult } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { listEntities, normalizeEntityName } from "./entities.js";
import { normalizeLedgerPredicate, normalizeLedgerText } from "./normalization.js";
import { invalidateStorySupports } from "./story-spine.js";

type Evidence = Array<{ messageId?: string }>;
export type Deletion = { kind: "entity" | "assertion" | "belief" | "promise"; identities: string[]; messageIds: string[]; sourceBatchId?: string; entityId?: string };
export const userDeletionsKey = (chatId: string): string => `user_deletions:${chatId}`;
export const ledgerEditOriginsKey = (chatId: string): string => `ledger_edit_origins:${chatId}`;
export const removedAliasesKey = (chatId: string): string => `removed_aliases:${chatId}`;
export type RemovedAliases = Record<string, string[]>;

export function readRemovedAliases(db: RcmDatabase, chatId: string): RemovedAliases {
  const row = db.prepare("SELECT value FROM server_meta WHERE key=?").get(removedAliasesKey(chatId)) as { value: string } | undefined;
  return row ? JSON.parse(row.value) as RemovedAliases : {};
}

function writeRemovedAliases(db: RcmDatabase, chatId: string, entries: RemovedAliases): void {
  for (const id of Object.keys(entries)) if (!entries[id]?.length) delete entries[id];
  if (!Object.keys(entries).length) db.prepare("DELETE FROM server_meta WHERE key=?").run(removedAliasesKey(chatId));
  else db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(removedAliasesKey(chatId), JSON.stringify(entries));
}

/** Explicit aliases and the user's current display name lift alias removals. */
export function rememberAliasReplacement(db: RcmDatabase, chatId: string, entityId: string, aliases: string[]): void {
  const entries = readRemovedAliases(db, chatId);
  const next = new Set(aliases.map(normalizeEntityName));
  const entity = db.prepare("SELECT display_name,name FROM entities WHERE id=? AND chat_id=?").get(entityId, chatId) as { display_name: string; name: string };
  next.add(normalizeEntityName(entity.display_name || entity.name));
  const previous = (db.prepare("SELECT alias FROM aliases WHERE entity_id=?").all(entityId) as Array<{ alias: string }>).map(row => normalizeEntityName(row.alias));
  entries[entityId] = [...new Set([...(entries[entityId] ?? []), ...previous])].filter(alias => !next.has(alias));
  writeRemovedAliases(db, chatId, entries);
}

export function aliasRemovalGuard(db: RcmDatabase, chatId: string): (entityId: string, alias: string) => boolean {
  const removed = new Map(Object.entries(readRemovedAliases(db, chatId)).map(([id, terms]) => [id, new Set(terms)]));
  return (id, alias) => removed.get(id)?.has(normalizeEntityName(alias)) ?? false;
}

/** A user identity merge transfers removals; it is not an explicit alias re-add. */
export function mergeAliasRemovals(db: RcmDatabase, chatId: string, sourceId: string, targetId: string): void {
  const entries = readRemovedAliases(db, chatId);
  entries[targetId] = [...new Set([...(entries[targetId] ?? []), ...(entries[sourceId] ?? [])])];
  delete entries[sourceId];
  writeRemovedAliases(db, chatId, entries);
}

function ledgerLineage(db: RcmDatabase, chatId: string, row: Record<string, any>): { messageIds: string[]; sourceBatchId?: string } {
  const evidence: Evidence = row.evidence_json ? JSON.parse(row.evidence_json)
    : (db.prepare("SELECT evidence_json FROM item_access WHERE chat_id=? AND item_kind='promise' AND item_id=?").all(chatId, row.promise_id ?? row.id) as Array<{ evidence_json: string }>).flatMap(item => JSON.parse(item.evidence_json) as Evidence);
  const memory = row.source_memory_id ? db.prepare("SELECT evidence_json FROM memories WHERE id=? AND chat_id=?").get(row.source_memory_id, chatId) as { evidence_json: string } | undefined : undefined;
  const batch = row.source_batch_id ? db.prepare("SELECT source_message_ids_json FROM extraction_batches WHERE id=? AND chat_id=?").get(row.source_batch_id, chatId) as { source_message_ids_json: string } | undefined : undefined;
  const messageIds = [...new Set((evidence.length ? evidence : memory ? JSON.parse(memory.evidence_json) as Evidence : [])
    .flatMap(item => item.messageId ? [item.messageId] : []))];
  return { messageIds: messageIds.length ? messageIds : batch ? JSON.parse(batch.source_message_ids_json) : [], ...(row.source_batch_id ? { sourceBatchId: row.source_batch_id } : {}) };
}

/** In-place user edits must retain the extraction identity, including its old value. */
export function rememberLedgerEditOrigin(db: RcmDatabase, chatId: string, kind: "belief" | "promise", itemId: string): void {
  const table = kind === "belief" ? "beliefs" : "promises";
  const row = db.prepare(`SELECT * FROM ${table} WHERE chat_id=? AND id=?`).get(chatId, itemId) as Record<string, any> | undefined;
  if (!row) return;
  const lineage = ledgerLineage(db, chatId, row);
  if (!lineage.messageIds.length && !lineage.sourceBatchId) return;
  const key = ledgerEditOriginsKey(chatId);
  const stored = db.prepare("SELECT value FROM server_meta WHERE key=?").get(key) as { value: string } | undefined;
  const origins: Record<string, Deletion> = stored ? JSON.parse(stored.value) : {};
  if (origins[itemId]) return;
  origins[itemId] = { kind, identities: ledgerDeletionIdentities(kind, row), ...lineage };
  db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(origins));
}

export function readUserDeletions(db: RcmDatabase, chatId: string): Deletion[] {
  const row = db.prepare("SELECT value FROM server_meta WHERE key=?").get(userDeletionsKey(chatId)) as { value: string } | undefined;
  return row ? JSON.parse(row.value) as Deletion[] : [];
}

// These are typed ledger identities, never a classifier over RP prose.
export function ledgerDeletionIdentities(kind: "assertion" | "belief" | "promise", row: Record<string, any>): string[] {
  const identity = normalizeEntityName;
  if (kind === "assertion") {
    const relation = row.socialRelation ?? (row.social_relation_json ? JSON.parse(row.social_relation_json) : undefined);
    const scope = relation ? [identity(relation.target), relation.kind, relation.direction] : null;
    return [JSON.stringify([identity(row.subject), normalizeLedgerPredicate(row.predicate), relation ? "condition" : row.state_kind ?? row.stateKind ?? "condition", normalizeLedgerText(row.value), scope])];
  }
  if (kind === "belief") return [JSON.stringify([identity(row.holder), identity(row.subject), normalizeLedgerPredicate(row.predicate), normalizeLedgerText(row.value), row.polarity])];
  return row.promise_key ?? row.key ? [`key:${row.promise_key ?? row.key}`] : [JSON.stringify([identity(row.promisor), identity(row.promisee), normalizeLedgerText(row.content)])];
}

export function rememberUserDeletion(db: RcmDatabase, chatId: string, kind: Deletion["kind"], identities: string[], lineage?: { messageIds: string[]; sourceBatchId?: string }, entityId?: string): void {
  const entries = readUserDeletions(db, chatId);
  const messageIds = lineage?.messageIds ?? (db.prepare("SELECT message_id FROM messages WHERE chat_id=?").all(chatId) as Array<{ message_id: string }>).map(row => row.message_id);
  entries.push({ kind, identities, messageIds, ...(lineage?.sourceBatchId ? { sourceBatchId: lineage.sourceBatchId } : {}), ...(entityId ? { entityId } : {}) });
  db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(userDeletionsKey(chatId), JSON.stringify(entries));
}

export function deletionGuard(db: RcmDatabase, chatId: string) {
  const entries = readUserDeletions(db, chatId).map(entry => ({ ...entry, oldMessages: new Set(entry.messageIds) }));
  if (!entries.length) return () => false;
  const liveMessages = new Set((db.prepare("SELECT message_id FROM messages WHERE chat_id=? AND lifecycle IN ('committed','client_pruned')").all(chatId) as Array<{ message_id: string }>).map(row => row.message_id));
  return (kind: Deletion["kind"], identities: string[], evidence: Evidence = [], sourceBatchId?: string): boolean => entries.some(entry =>
    entry.kind === kind && identities.some(identity => entry.identities.includes(identity))
    // A new, stored source message is required to lift a deletion. Empty,
    // setup-only and unknown evidence cannot resurrect old derived data.
    && (kind === "entity"
      ? !evidence.some(item => item.messageId && liveMessages.has(item.messageId) && !entry.oldMessages.has(item.messageId))
      : evidence.some(item => item.messageId && entry.oldMessages.has(item.messageId))
        || Boolean((!evidence.length || !entry.messageIds.length) && sourceBatchId && entry.sourceBatchId === sourceBatchId)));
}

export function suppressDeletedExtraction(db: RcmDatabase, chatId: string, result: ExtractionResult, sourceMessageIds: string[] = [], sourceBatchId?: string): ExtractionResult {
  const blocked = deletionGuard(db, chatId);
  const fallbackEvidence = sourceMessageIds.map(messageId => ({ messageId }));
  const promiseEvidence = (item: ExtractionResult["promises"][number]): Evidence => item.evidence?.length ? item.evidence
    : result.memories.find(memory => memory.key === item.memoryKey)?.evidence ?? fallbackEvidence;
  const aliases = new Map<string, string[]>();
  const owners = new Map<string, Set<string>>();
  for (const entity of [...listEntities(db, chatId), ...result.entities]) {
    for (const name of [entity.key, entity.name, ...entity.aliases, ...("displayName" in entity && typeof entity.displayName === "string" ? [entity.displayName] : [])].map(normalizeEntityName)) {
      const values = owners.get(name) ?? new Set<string>();
      values.add(normalizeEntityName(entity.key)); owners.set(name, values);
    }
  }
  for (const entity of result.entities) {
    const names = [entity.key, entity.name, ...entity.aliases].map(normalizeEntityName).filter(name => owners.get(name)?.size === 1);
    for (const name of names) aliases.set(name, names);
  }
  const entityBlocked = (name: string, evidence?: Evidence) => blocked("entity", aliases.get(normalizeEntityName(name)) ?? [normalizeEntityName(name)], evidence);
  const references = [
    ...result.memories.map(item => ({ names: [...item.participants, ...item.knownBy, ...(item.witnesses ?? []).map(witness => witness.name), item.perspective ?? ""], evidence: item.evidence })),
    ...result.assertions.map(item => ({ names: [item.subject, item.socialRelation?.target ?? ""], evidence: item.evidence })),
    ...result.beliefs.map(item => ({ names: [item.holder, item.subject], evidence: item.evidence })),
    ...result.promises.map(item => ({ names: [item.promisor, item.promisee], evidence: promiseEvidence(item) })),
    ...(result.relationshipEvents ?? []).map(item => ({ names: [item.from, item.to], evidence: item.evidence })),
    ...(result.socialKnowledge ?? []).map(item => ({ names: [item.holder, item.subject], evidence: item.evidence })),
    ...(result.physicalIntimacy ?? []).map(item => ({ names: item.participants, evidence: item.evidence })),
  ];
  result.entities = result.entities.filter(item => {
    const names = [item.key, item.name, ...item.aliases].map(normalizeEntityName).filter(name => owners.get(name)?.size === 1);
    const evidence = references.filter(ref => ref.names.some(name => names.includes(normalizeEntityName(name)))).flatMap(ref => ref.evidence);
    return !blocked("entity", names, evidence.length ? evidence : fallbackEvidence);
  });
  for (const memory of result.memories) {
    const keep = (name: string) => !entityBlocked(name, memory.evidence);
    memory.participants = memory.participants.filter(keep);
    memory.knownBy = memory.knownBy.filter(keep);
    if (memory.perspective && !keep(memory.perspective)) memory.perspective = undefined;
    memory.witnesses = memory.witnesses?.filter(item => keep(item.name));
    memory.landmarkKinds = memory.landmarkKinds?.filter(item => !item.pair?.some(name => !keep(name)));
    for (const detail of memory.details ?? []) {
      detail.participants = detail.participants.filter(keep);
      detail.knownBy = detail.knownBy.filter(keep);
      detail.access = detail.access?.filter(item => keep(item.holder));
    }
    for (const dialogue of memory.keyDialogues ?? []) dialogue.access = dialogue.access?.filter(item => keep(item.holder));
  }
  result.assertions = result.assertions.filter(item => !entityBlocked(item.subject, item.evidence)
    && !(item.socialRelation && entityBlocked(item.socialRelation.target, item.evidence))
    && !blocked("assertion", ledgerDeletionIdentities("assertion", item), item.evidence.length ? item.evidence : fallbackEvidence, sourceBatchId));
  result.beliefs = result.beliefs.filter(item => !entityBlocked(item.holder, item.evidence) && !entityBlocked(item.subject, item.evidence)
    && !blocked("belief", ledgerDeletionIdentities("belief", item), item.evidence.length ? item.evidence : fallbackEvidence, sourceBatchId));
  result.promises = result.promises.filter(item => !entityBlocked(item.promisor, promiseEvidence(item)) && !entityBlocked(item.promisee, promiseEvidence(item))
    && !blocked("promise", ledgerDeletionIdentities("promise", item), promiseEvidence(item), sourceBatchId));
  for (const item of result.promises) item.access = item.access?.filter(grant => !entityBlocked(grant.holder, promiseEvidence(item)));
  result.relationshipEvents = result.relationshipEvents?.filter(item => ![item.from, item.to].some(name => entityBlocked(name, item.evidence)));
  result.relationshipBaselines = result.relationshipBaselines?.filter(item => ![item.from, item.to].some(name => entityBlocked(name, item.evidence)));
  result.socialKnowledge = result.socialKnowledge?.filter(item => ![item.holder, item.subject].some(name => entityBlocked(name, item.evidence)));
  result.physicalIntimacy = result.physicalIntimacy?.filter(item => ![...item.participants, item.initiator ?? ""].some(name => entityBlocked(name, item.evidence)));
  for (const item of result.physicalIntimacy ?? []) item.access = item.access?.filter(grant => !entityBlocked(grant.holder, item.evidence));
  for (const item of result.atomRelations ?? []) item.access = item.access.filter(grant => !entityBlocked(grant.holder, item.evidence));
  for (const item of result.sourcePassages ?? []) item.access = item.access.filter(grant => !entityBlocked(grant.holder, grant.evidence.length ? grant.evidence : [{ messageId: item.messageId }]));
  return result;
}

/** Caller owns the transaction and chat revision. */
export function deleteLedgerRecord(db: RcmDatabase, chatId: string, kind: "assertion" | "belief" | "promise", itemId: string, invalidatedSupports?: Set<string>): boolean {
  const table = kind === "assertion" ? "assertions" : kind === "belief" ? "beliefs" : "promises";
  const row = (db.prepare(`SELECT * FROM ${table} WHERE id=? AND chat_id=?`).get(itemId, chatId)
    ?? (kind === "promise" ? db.prepare("SELECT * FROM promise_events WHERE chat_id=? AND (promise_id=? OR id=?) ORDER BY created_at DESC LIMIT 1").get(chatId, itemId, itemId) : undefined)) as Record<string, any> | undefined;
  if (!row) return false;
  const recordId = kind === "promise" ? row.promise_id ?? row.id : row.id;
  const originsKey = ledgerEditOriginsKey(chatId);
  const storedOrigins = db.prepare("SELECT value FROM server_meta WHERE key=?").get(originsKey) as { value: string } | undefined;
  const origins: Record<string, Deletion> = storedOrigins ? JSON.parse(storedOrigins.value) : {};
  const origin = origins[recordId];
  const lineage = origin ?? ledgerLineage(db, chatId, row);
  if (lineage.messageIds.length || lineage.sourceBatchId) rememberUserDeletion(db, chatId, kind, origin?.identities ?? ledgerDeletionIdentities(kind, row), lineage);
  delete origins[recordId];
  if (Object.keys(origins).length) db.prepare("UPDATE server_meta SET value=? WHERE key=?").run(JSON.stringify(origins), originsKey);
  else db.prepare("DELETE FROM server_meta WHERE key=?").run(originsKey);
  db.prepare("DELETE FROM item_access WHERE chat_id=? AND item_kind=? AND item_id=?").run(chatId, kind, recordId);
  db.prepare(`DELETE FROM conflicts WHERE chat_id=? AND EXISTS
    (SELECT 1 FROM json_tree(conflicts.existing_json) WHERE key='id' AND value=?)`).run(chatId, recordId);
  db.prepare(`DELETE FROM reconciliation_items WHERE chat_id=? AND EXISTS
    (SELECT 1 FROM json_tree(reconciliation_items.candidates_json) WHERE key='id' AND value=?)`).run(chatId, recordId);
  if (kind === "promise") db.prepare("DELETE FROM promise_events WHERE chat_id=? AND (promise_id=? OR promise_key=?)").run(chatId, recordId, row.promise_key);
  db.prepare(`DELETE FROM ${table} WHERE id=? AND chat_id=?`).run(recordId, chatId);
  const supports=invalidatedSupports ?? new Set<string>();
  supports.add(`${table}:${recordId}`);
  if (!invalidatedSupports) invalidateStorySupports(db,chatId,supports);
  return true;
}
