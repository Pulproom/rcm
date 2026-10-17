import { syncManualCognition } from "./social-knowledge.js";
import type { ExtractionResult } from "@rcm/shared";
import { createHash } from "node:crypto";
import type { RcmDatabase } from "./db.js";
import { refreshMemoryFts } from "./memory-search-document.js";
import { aliasRemovalGuard, deleteLedgerRecord, mergeAliasRemovals, readRemovedAliases, rememberUserDeletion, suppressDeletedExtraction } from "./user-deletions.js";
import { personaHintKey, readViewPreferences } from "./view-preferences.js";
import { updateSetupRecognition } from "./setup-recognition.js";
import { invalidateStorySupports, storySupportScopes } from "./story-spine.js";
import { readDialogueAccessIdentities, writeDialogueAccessIdentities, readDetailAccessEdits, writeDetailAccessEdits, pruneDetailAccessEdits } from "./item-access.js";

export const normalizeEntityName = (value: string): string => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export interface EntityItem {
  color: string | null;
  id: string;
  key: string;
  name: string;
  displayName: string;
  type: string;
  aliases: string[];
  origin: string;
  setupProminence: string;
  source: Array<{ sourceIndex: number; quote: string }>;
  userManaged: boolean;
}

export interface EntityMergePreview {
  revision: number;
  source: EntityItem;
  target: EntityItem;
  preservedAliases: string[];
  affected: { memories: number; relationships: number; beliefs: number; promises: number };
  busy: boolean;
}

/** Alias removals never suppress an entity's primary identifiers. */
function entityIdentityTerms(entity: EntityItem, removed: (entityId: string, alias: string) => boolean): string[] {
  return [...new Set([entity.id, entity.key, entity.name, entity.displayName, ...entity.aliases.filter(alias => !removed(entity.id, alias))])];
}

export function listEntities(db: RcmDatabase, chatId: string): EntityItem[] {
  const rows = db.prepare(`SELECT id,entity_key AS key,name,CASE WHEN display_name='' THEN name ELSE display_name END AS displayName,
    type,color,origin,setup_prominence AS setupProminence,source_json AS source,user_managed AS userManaged
    FROM entities WHERE chat_id=? ORDER BY displayName COLLATE NOCASE`).all(chatId) as Array<Omit<EntityItem, "aliases" | "source" | "userManaged"> & { source: string; userManaged: number }>;
  const aliases = db.prepare("SELECT alias FROM aliases WHERE entity_id=? ORDER BY alias COLLATE NOCASE");
  return rows.map((row) => ({ ...row, source: parseJson(row.source, []), userManaged: row.userManaged === 1,
    aliases: (aliases.all(row.id) as Array<{ alias: string }>).map((item) => item.alias) }));
}

export function entityDisplayName(db: RcmDatabase, chatId: string, value: string): string {
  const normalized = normalizeEntityName(value);
  const removed = aliasRemovalGuard(db, chatId);
  const entity = listEntities(db, chatId).find((item) => entityIdentityTerms(item, removed).some((candidate) => normalizeEntityName(candidate) === normalized));
  return entity?.displayName ?? value;
}

/** Refresh the existing extraction-scene cache from its edited scene members. */
export function refreshMemoryParticipantCounts(db: RcmDatabase, chatId: string, memoryId: string): void {
  const memory = db.prepare(`SELECT m.source_batch_id,b.job_id FROM memories m
    LEFT JOIN extraction_batches b ON b.id=m.source_batch_id WHERE m.id=? AND m.chat_id=?`).get(memoryId, chatId) as
    { source_batch_id: string | null; job_id: string | null } | undefined;
  if (!memory) return;
  const sceneKey = memory.job_id ?? `memory:${memoryId}`;
  const rows = db.prepare(`SELECT participants_json FROM memories WHERE chat_id=? AND active=1
    AND ((? IS NOT NULL AND source_batch_id=?) OR (? IS NULL AND id=?))`)
    .all(chatId, memory.source_batch_id, memory.source_batch_id, memory.source_batch_id, memoryId) as Array<{ participants_json: string }>;
  const old = db.prepare("SELECT entity_name FROM entity_scene_presence WHERE chat_id=? AND scene_key=?").all(chatId, sceneKey) as Array<{ entity_name: string }>;
  const names = new Set(rows.flatMap(row => parseJson<string[]>(row.participants_json, [])));
  db.prepare("DELETE FROM entity_scene_presence WHERE chat_id=? AND scene_key=?").run(chatId, sceneKey);
  for (const name of names) db.prepare("INSERT OR IGNORE INTO entity_scene_presence(chat_id,entity_name,scene_key,created_at) VALUES(?,?,?,?)").run(chatId, name, sceneKey, Date.now());
  for (const name of new Set([...names, ...old.map(row => row.entity_name)])) {
    const count = (db.prepare("SELECT COUNT(*) count FROM entity_scene_presence WHERE chat_id=? AND entity_name=? COLLATE NOCASE").get(chatId, name) as { count: number }).count;
    db.prepare(`INSERT INTO entity_prominence(chat_id,entity_name,tier,scene_count,durable_links,pinned,updated_at) VALUES(?,?,'incidental',?,0,0,?)
      ON CONFLICT(chat_id,entity_name) DO UPDATE SET scene_count=excluded.scene_count,
      tier=CASE WHEN pinned=1 OR (excluded.scene_count>=4 AND durable_links>0) THEN 'core' WHEN excluded.scene_count>=2 OR durable_links>0 THEN 'recurring' ELSE 'incidental' END,updated_at=excluded.updated_at`)
      .run(chatId, name, count, Date.now());
  }
}

function soleOwnerEntityNames(entities: EntityItem[], entityId: string): Set<string> {
  const entity=entities.find(item=>item.id===entityId)!;
  const otherNames=new Set(entities.filter(item=>item.id!==entityId).flatMap(item=>[item.id,item.key,item.name,item.displayName,...item.aliases].map(normalizeEntityName)));
  return new Set([entity.id,entity.key,entity.name,entity.displayName,...entity.aliases].map(normalizeEntityName)
    .filter(name=>name===normalizeEntityName(entity.id) || !otherNames.has(name)));
}

function entityDeletionPlan(db: RcmDatabase, chatId: string, entityId: string) {
  const entities = listEntities(db, chatId);
  const entity = entities.find(item => item.id === entityId);
  if (!entity) throw Object.assign(new Error("Entity not found"), { code: "ENTITY_NOT_FOUND" });
  // The request selects a UUID. Prose variants are usable only when that UUID
  // is their sole owner; shared names/display names/aliases stay untouched.
  const names = soleOwnerEntityNames(entities,entityId);
  const matches = (value: unknown): boolean => typeof value === "string" && names.has(normalizeEntityName(value));
  const preference = readViewPreferences(db, chatId).personaEntity;
  const latestHint = db.prepare("SELECT value FROM server_meta WHERE key=?").get(personaHintKey(chatId)) as { value: string } | undefined;
  const hint = db.prepare(`SELECT json_extract(payload_json,'$.identityHints.userPersonaName') name FROM jobs
    WHERE chat_id=? AND json_type(payload_json,'$.identityHints.userPersonaName')='text' ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(chatId) as { name: string } | undefined;
  if (matches(preference ?? (latestHint ? JSON.parse(latestHint.value) : hint?.name))) throw Object.assign(new Error("The chat persona cannot be deleted"), { code: "ENTITY_IS_PERSONA" });
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number }).revision;
  const rows = (table: string) => db.prepare(`SELECT rowid AS _rowid,* FROM ${table} WHERE chat_id=?`).all(chatId) as Array<Record<string, any>>;
  const about = (table: string, columns: string[]) => rows(table).filter(row => columns.some(column => matches(row[column])));
  const referencesPerson = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(referencesPerson);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, item]) => ["subject", "holder", "promisor", "promisee", "from", "to", "from_entity", "to_entity", "target"].includes(key)
      ? matches(item) : referencesPerson(item));
  };
  const assertions = rows("assertions").filter(row => matches(row.subject) || matches(parseJson<any>(row.social_relation_json ?? "null", null)?.target));
  const beliefs = about("beliefs", ["holder", "subject"]);
  const promises = about("promises", ["promisor", "promisee"]);
  const memories = rows("memories").filter(row => [...parseJson<string[]>(row.participants_json, []), ...parseJson<string[]>(row.known_by_json, [])].some(matches));
  const related: Record<string, Array<Record<string, any>>> = {
    relationship_events: about("relationship_events", ["from_entity", "to_entity"]),
    relationship_projections: about("relationship_projections", ["from_entity", "to_entity"]),
    relationship_projection_queue: about("relationship_projection_queue", ["from_entity", "to_entity"]),
    relationship_baselines: about("relationship_baselines", ["from_entity", "to_entity"]),
    social_knowledge_events: about("social_knowledge_events", ["holder", "subject"]),
    physical_intimacy_milestones: about("physical_intimacy_milestones", ["participant_a", "participant_b", "initiator"]),
    promise_events: about("promise_events", ["promisor", "promisee"]),
    entity_scene_presence: about("entity_scene_presence", ["entity_name"]),
    entity_prominence: about("entity_prominence", ["entity_name"]),
    memory_activation_state: about("memory_activation_state", ["perspective"]),
    memory_recall_events: about("memory_recall_events", ["holder"]),
    conflicts: rows("conflicts").filter(row => referencesPerson(parseJson(row.existing_json, null)) || referencesPerson(parseJson(row.incoming_json, null))),
    reconciliation_items: rows("reconciliation_items").filter(row => referencesPerson(parseJson(row.candidates_json, null)) || referencesPerson(parseJson(row.incoming_json, null))),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify({ revision, entity, names: [...names], assertions, beliefs, promises, memories, related,
    // These independently stored grants/participants also belong to the cleanup.
    access: about("item_access", ["holder"]),
    details: rows("memory_details").filter(row => [...parseJson<string[]>(row.participants_json, []), ...parseJson<string[]>(row.known_by_json, [])].some(matches)),
    passages: rows("source_passages").filter(row => parseJson<Array<{ holder: string }>>(row.access_json, []).some(grant => matches(grant.holder))),
    memoryMetadata: rows("memories").filter(row => matches(row.perspective) || parseJson<Array<{ pair?: string[] }>>(row.landmark_kinds_json, []).some(item => item.pair?.some(matches))),
    traces: (db.prepare("SELECT t.* FROM memory_traces t JOIN memories m ON m.id=t.memory_id WHERE m.chat_id=?").all(chatId) as Array<{ character_name: string }>).filter(row => matches(row.character_name)),
    projections: rows("jobs").filter(row => row.type === "relationship_projection" && ["queued", "failed", "leased"].includes(row.status))
      .map(row => ({ id: row.id, payload: parseJson(row.payload_json, {}) })),
  })).digest("hex");
  return { entity, names, matches, revision, assertions, beliefs, promises, memories, related, fingerprint };
}

// The existing numeric revision slot carries a 52-bit deletion-scope token.
// It is a safe integer and needs no client/shared contract change or preview cache.
const entityDeleteRevision = (plan: ReturnType<typeof entityDeletionPlan>) => Number.parseInt(plan.fingerprint.slice(0, 13), 16);

export function previewEntityDelete(db: RcmDatabase, chatId: string, entityId: string): { entity: { id: string; name: string }; impact: Record<string, number>; revision: number } {
  const plan = entityDeletionPlan(db, chatId, entityId);
  const pairs = new Set([...plan.related.relationship_projections!, ...plan.related.relationship_events!, ...plan.related.relationship_baselines!]
    .map(row => JSON.stringify([row.from_entity, row.to_entity])));
  return { entity: { id: plan.entity.id, name: plan.entity.name }, revision: entityDeleteRevision(plan), impact: {
    "관계": pairs.size, "인식": plan.beliefs.length, "상태": plan.assertions.length, "약속": plan.promises.length,
    "지인 관계": new Set(plan.related.social_knowledge_events!.map(row => JSON.stringify([row.holder, row.subject]))).size, "스킨십 기록": plan.related.physical_intimacy_milestones!.length,
    "기억 속 등장": plan.memories.length,
  } };
}

export function deleteEntity(db: RcmDatabase, chatId: string, entityId: string, expectedRevision: number): void {
  db.transaction(() => {
    const plan = entityDeletionPlan(db, chatId, entityId);
    if (entityDeleteRevision(plan) !== expectedRevision) throw Object.assign(new Error("Derived data changed after preview; review the deletion again"), { code: "ENTITY_DELETE_STALE" });
    if (db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND status='leased' AND leased_until>? LIMIT 1").get(chatId, Date.now())) {
      throw Object.assign(new Error("Pause the active extraction before deleting an entity"), { code: "ENTITY_DELETE_BUSY" });
    }
    rememberUserDeletion(db, chatId, "entity", [...plan.names], undefined, entityId);
    const supports=new Set<string>();
    const accessAtoms=db.prepare(`SELECT 'detail' kind,id,known_by_json FROM memory_details WHERE chat_id=?
      UNION ALL SELECT 'dialogue' kind,id,'[]' known_by_json FROM memory_dialogues WHERE chat_id=?`)
      .all(chatId,chatId) as Array<{kind:'detail'|'dialogue';id:string;known_by_json:string}>;
    const accessBefore=storySupportScopes(db,chatId,accessAtoms);
    plan.related.relationship_events!.forEach(row=>supports.add(`relationship_events:${row.id}`));
    for (const name of [plan.entity.name, plan.entity.key, plan.entity.displayName, ...plan.entity.aliases].filter(plan.matches)) updateSetupRecognition(db, chatId, "delete", name);
    for (const [kind, rows] of [["assertion", plan.assertions], ["belief", plan.beliefs], ["promise", plan.promises]] as const) {
      for (const row of rows) deleteLedgerRecord(db, chatId, kind, row.id,supports);
    }
    for (const [table, rows] of Object.entries(plan.related)) {
      for (const row of rows) {
        db.prepare("DELETE FROM item_access WHERE chat_id=? AND item_id=?").run(chatId, row.id ?? "");
        db.prepare(`DELETE FROM ${table} WHERE rowid=? AND chat_id=?`).run(row._rowid, chatId);
      }
    }
    const removeNames = (value: string) => JSON.stringify(parseJson<string[]>(value, []).filter(name => !plan.matches(name)));
    const detailEdits = readDetailAccessEdits(db, chatId);
    for (const [id, holders] of detailEdits) detailEdits.set(id, holders.filter(name => !plan.matches(name)));
    writeDetailAccessEdits(db, chatId, detailEdits);
    pruneDetailAccessEdits(db, chatId);
    const memories = db.prepare("SELECT id,participants_json,known_by_json,perspective,landmark_kinds_json FROM memories WHERE chat_id=?").all(chatId) as Array<Record<string, any>>;
    for (const row of memories) {
      const landmarks = parseJson<Array<{ pair?: string[] }>>(row.landmark_kinds_json, []).filter(item => !item.pair?.some(plan.matches));
      db.prepare("UPDATE memories SET participants_json=?,known_by_json=?,perspective=?,landmark_kinds_json=?,updated_at=? WHERE id=?")
        .run(removeNames(row.participants_json), removeNames(row.known_by_json), plan.matches(row.perspective) ? null : row.perspective, JSON.stringify(landmarks), Date.now(), row.id);
      refreshMemoryFts(db, row.id);
    }
    for (const row of db.prepare("SELECT id,participants_json,known_by_json,seed_json FROM memory_details WHERE chat_id=?").all(chatId) as Array<Record<string, any>>) {
      const participants = removeNames(row.participants_json);
      db.prepare("UPDATE memory_details SET participants_json=?,known_by_json=?,seed_json=?,updated_at=? WHERE id=?").run(participants, removeNames(row.known_by_json), row.seed_json ? JSON.stringify({...JSON.parse(row.seed_json),noticedBy:JSON.parse(removeNames(JSON.stringify(JSON.parse(row.seed_json).noticedBy)))}) : null, Date.now(), row.id);
      db.prepare("UPDATE memory_detail_fts SET participants=? WHERE detail_id=?").run(JSON.parse(participants).join(" "), row.id);
    }
    for (const row of db.prepare("SELECT id,holder FROM item_access WHERE chat_id=?").all(chatId) as Array<{ id: string; holder: string }>) {
      if (plan.matches(row.holder)) db.prepare("DELETE FROM item_access WHERE id=?").run(row.id);
    }
    for (const row of db.prepare("SELECT id,access_json FROM source_passages WHERE chat_id=?").all(chatId) as Array<{ id: string; access_json: string }>) {
      const grants = parseJson<Array<{ holder: string }>>(row.access_json, []).filter(grant => !plan.matches(grant.holder));
      db.prepare("UPDATE source_passages SET access_json=? WHERE id=?").run(JSON.stringify(grants), row.id);
    }
    for (const row of db.prepare("SELECT memory_id,character_name FROM memory_traces WHERE memory_id IN (SELECT id FROM memories WHERE chat_id=?)").all(chatId) as Array<{ memory_id: string; character_name: string }>) {
      if (plan.matches(row.character_name)) db.prepare("DELETE FROM memory_traces WHERE memory_id=? AND character_name=?").run(row.memory_id, row.character_name);
    }
    // Queued projection payloads are another source of old pair identities.
    for (const row of db.prepare("SELECT id,payload_json FROM jobs WHERE chat_id=? AND type='relationship_projection' AND status IN ('queued','failed','leased')").all(chatId) as Array<{ id: string; payload_json: string }>) {
      const payload = parseJson<Record<string, any>>(row.payload_json, {});
      for (const key of ["pairs", "projectionRemainingPairs"]) if (Array.isArray(payload[key])) payload[key] = payload[key].filter((pair: any) => !plan.matches(pair.from) && !plan.matches(pair.to));
      if (!payload.pairs?.length && payload.projectionRemainingPairs?.length) {
        payload.pairs = payload.projectionRemainingPairs;
        payload.projectionRemainingPairs = [];
        payload.projectionCursors = {};
        payload.allowedBasisIds = {};
        payload.pipelineStage = "queued";
        delete payload.stagedModelOutput;
        db.prepare("UPDATE jobs SET payload_json=?,status='queued',attempts=0,lease_owner=NULL,leased_until=NULL,last_error=NULL,updated_at=? WHERE id=?")
          .run(JSON.stringify(payload), Date.now(), row.id);
        continue;
      }
      db.prepare("UPDATE jobs SET payload_json=?,status=CASE WHEN ?=0 THEN 'superseded' ELSE status END,updated_at=? WHERE id=?")
        .run(JSON.stringify(payload), payload.pairs?.length ?? 0, Date.now(), row.id);
    }
    db.prepare("DELETE FROM entities WHERE id=? AND chat_id=?").run(entityId, chatId);
    const accessAfter=storySupportScopes(db,chatId,accessAtoms.map(atom=>({...atom,known_by_json:removeNames(atom.known_by_json)})));
    const accessChanges=new Map<string,{holders:string[];shared:boolean}>();
    for (const [id,before] of accessBefore) {
      const after=accessAfter.get(id)!;
      const holders=before.accessibleTo.filter(holder=>!after.accessibleTo.includes(holder));
      const shared=before.scopeHint==='shared' && after.scopeHint!=='shared';
      if (holders.length || shared) accessChanges.set(id,{holders,shared});
    }
    syncManualCognition(db,chatId,supports);
    invalidateStorySupports(db, chatId,supports,accessChanges);
    db.prepare("UPDATE chats SET revision=revision+1,updated_at=? WHERE id=?").run(Date.now(), chatId);
  })();
}

export interface ResolvedEntityIdentity {
  canonical: string;
  variants: string[];
  ambiguous: boolean;
}

/** Resolve identity-bearing ledger fields without guessing ambiguous aliases. */
export function buildEntityIdentityResolver(db: RcmDatabase, chatId: string): (value: string) => ResolvedEntityIdentity {
  const byValue = new Map<string, EntityItem[]>();
  const removed = aliasRemovalGuard(db, chatId);
  for (const entity of listEntities(db, chatId)) {
    for (const value of entityIdentityTerms(entity, removed)) {
      const key = normalizeEntityName(value);
      const matches = byValue.get(key) ?? [];
      if (!matches.some((item) => item.id === entity.id)) matches.push(entity);
      byValue.set(key, matches);
    }
  }
  return (value: string): ResolvedEntityIdentity => {
    const matches = byValue.get(normalizeEntityName(value)) ?? [];
    if (matches.length !== 1) return { canonical: value, variants: [value], ambiguous: matches.length > 1 };
    const entity = matches[0]!;
    return {
      canonical: entity.name,
      variants: entityIdentityTerms(entity, removed).filter(term => byValue.get(normalizeEntityName(term))?.length === 1),
      ambiguous: false,
    };
  };
}

export function previewEntityMerge(db: RcmDatabase, chatId: string, sourceId: string, targetId: string): EntityMergePreview {
  if (sourceId === targetId) throw Object.assign(new Error("Source and target entities must differ"), { code: "ENTITY_MERGE_SAME" });
  const entities = listEntities(db, chatId);
  const source = entities.find((item) => item.id === sourceId);
  const target = entities.find((item) => item.id === targetId);
  if (!source || !target) throw Object.assign(new Error("Entity not found"), { code: "ENTITY_NOT_FOUND" });
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined)?.revision;
  if (revision === undefined) throw Object.assign(new Error("Chat not found"), { code: "ENTITY_NOT_FOUND" });
  const names = new Set([source.key, source.name, ...source.aliases].map(normalizeEntityName));
  const contains = (value: string): boolean => names.has(normalizeEntityName(value));
  const memories = (db.prepare("SELECT participants_json,known_by_json,perspective FROM memories WHERE chat_id=?").all(chatId) as Array<{ participants_json: string; known_by_json: string; perspective: string | null }>).filter((row) =>
    [...JSON.parse(row.participants_json), ...JSON.parse(row.known_by_json), row.perspective].some((value) => typeof value === "string" && contains(value)),
  ).length;
  const relationshipRows = (db.prepare("SELECT from_entity,to_entity FROM relationship_events WHERE chat_id=? AND active=1").all(chatId) as Array<{ from_entity: string; to_entity: string }>)
    .filter((row) => contains(row.from_entity) || contains(row.to_entity));
  const relationships = new Set(relationshipRows.map((row) => `${normalizeEntityName(row.from_entity)}\0${normalizeEntityName(row.to_entity)}`)).size;
  const beliefs = (db.prepare("SELECT holder,subject FROM beliefs WHERE chat_id=? AND active=1").all(chatId) as Array<{ holder: string; subject: string }>).filter((row) => contains(row.holder) || contains(row.subject)).length;
  const promises = (db.prepare("SELECT promisor,promisee FROM promises WHERE chat_id=?").all(chatId) as Array<{ promisor: string; promisee: string }>).filter((row) => contains(row.promisor) || contains(row.promisee)).length;
  const removals = readRemovedAliases(db, chatId);
  const removed = new Set([...(removals[targetId] ?? []), ...(removals[sourceId] ?? [])]);
  const aliases = [...new Set([target.name, ...target.aliases, source.name, source.key, source.displayName, ...source.aliases])]
    .filter((value) => normalizeEntityName(value) !== normalizeEntityName(target.name) && !removed.has(normalizeEntityName(value)));
  return { revision, source, target, preservedAliases: aliases, affected: { memories, relationships, beliefs, promises }, busy: Boolean(db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND status='leased' AND leased_until>? LIMIT 1").get(chatId, Date.now())) };
}

export function canonicalizeExtraction(db: RcmDatabase, chatId: string, source: ExtractionResult, sourceMessageIds?: string[], sourceBatchId?: string): ExtractionResult {
  const result = suppressDeletedExtraction(db, chatId, structuredClone(source), sourceMessageIds, sourceBatchId);
  const known = listEntities(db, chatId);
  const aliasMap = new Map<string, EntityItem>();
  const removed = aliasRemovalGuard(db, chatId);
  // Entity UUIDs are internal storage identifiers. They are never intended as
  // canonical prose, but defensively resolve them when an older prompt or a
  // provider response leaks one into an identity-bearing field.
  const resolve = buildEntityIdentityResolver(db, chatId);
  for (const entity of known) for (const value of entityIdentityTerms(entity, removed)) {
    if (!resolve(value).ambiguous) aliasMap.set(normalizeEntityName(value), entity);
  }
  const existingFor = (entity: ExtractionResult["entities"][number]) =>
    [entity.key, entity.name, ...entity.aliases].map(value => aliasMap.get(normalizeEntityName(value))).find(Boolean);
  const replacements = new Map<string, string>();
  result.entities = result.entities.map((entity) => {
    const existing = existingFor(entity);
    if (!existing) {
      for (const value of [entity.key, entity.name, ...entity.aliases]) replacements.set(normalizeEntityName(value), entity.name);
      return entity;
    }
    const identifiers = new Set(entityIdentityTerms(existing, removed).map(normalizeEntityName));
    // An alternate incoming name becomes an alias of the stored identity; a
    // removed alias cannot return through that field. Stored names stay usable.
    for (const value of [entity.key, entity.name, ...entity.aliases]) if (identifiers.has(normalizeEntityName(value)) || !removed(existing.id, value)) replacements.set(normalizeEntityName(value), existing.name);
    return { key: existing.key, name: existing.name, type: existing.type, aliases: [...new Set([...existing.aliases, entity.name, ...entity.aliases])].filter(alias => !removed(existing.id, alias)) };
  }).filter((entity, index, items) => items.findIndex((candidate) => candidate.key === entity.key) === index);
  const canonical = (value: string): string => replacements.get(normalizeEntityName(value)) ?? aliasMap.get(normalizeEntityName(value))?.name ?? value;
  for (const memory of result.memories) {
    memory.participants = memory.participants.map(canonical);
    memory.knownBy = memory.knownBy.map(canonical);
    if (memory.perspective) memory.perspective = canonical(memory.perspective);
    for (const landmark of memory.landmarkKinds ?? []) {
      if (landmark.pair) landmark.pair = [canonical(landmark.pair[0]), canonical(landmark.pair[1])];
    }
    if (memory.witnesses) for (const witness of memory.witnesses) witness.name = canonical(witness.name);
    if (memory.keyDialogues) for (const dialogue of memory.keyDialogues) {
      dialogue.speaker = canonical(dialogue.speaker);
      if (dialogue.access) for (const grant of dialogue.access) grant.holder = canonical(grant.holder);
    }
    for (const detail of memory.details ?? []) {
      detail.participants = detail.participants.map(canonical);
      detail.knownBy = detail.knownBy.map(canonical);
      if (detail.seed) detail.seed.noticedBy = detail.seed.noticedBy.map(canonical);
      if (detail.access) for (const grant of detail.access) grant.holder = canonical(grant.holder);
    }
  }
  for (const assertion of result.assertions) { assertion.subject = canonical(assertion.subject); if (assertion.socialRelation) assertion.socialRelation.target = canonical(assertion.socialRelation.target); }
  for (const relation of result.atomRelations ?? []) for (const grant of relation.access) grant.holder = canonical(grant.holder);
  for (const belief of result.beliefs) { belief.holder = canonical(belief.holder); belief.subject = canonical(belief.subject); }
  for (const event of result.relationshipEvents ?? []) { event.from = canonical(event.from); event.to = canonical(event.to); }
  for (const promise of result.promises) {
    promise.promisor = canonical(promise.promisor);
    promise.promisee = canonical(promise.promisee);
    if (promise.access) for (const grant of promise.access) grant.holder = canonical(grant.holder);
  }
  for (const item of result.socialKnowledge ?? []) { item.holder = canonical(item.holder); item.subject = canonical(item.subject); }
  for (const item of result.relationshipBaselines ?? []) { item.from = canonical(item.from); item.to = canonical(item.to); }
  for (const item of result.physicalIntimacy ?? []) {
    item.participants = [canonical(item.participants[0]), canonical(item.participants[1])];
    if (item.initiator) item.initiator = canonical(item.initiator);
    if (item.access) for (const grant of item.access) grant.holder = canonical(grant.holder);
  }
  for (const passage of result.sourcePassages ?? []) for (const grant of passage.access) grant.holder = canonical(grant.holder);
  return suppressDeletedExtraction(db, chatId, result, sourceMessageIds, sourceBatchId);
}

const replaceJsonNames = (value: string, sourceNames: Set<string>, target: string): string => {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return value; }
  if (!Array.isArray(parsed)) return value;
  return JSON.stringify([...new Set(parsed.map((item) => typeof item === "string" && sourceNames.has(normalizeEntityName(item)) ? target : item))]);
};

const replaceLandmarkPairNames = (value: string, sourceNames: Set<string>, target: string): string => {
  let parsed: Array<Record<string, unknown>>;
  try { parsed = JSON.parse(value) as Array<Record<string, unknown>>; } catch { return value; }
  if (!Array.isArray(parsed)) return value;
  let changed = false;
  for (const landmark of parsed) if (Array.isArray(landmark.pair)) {
    landmark.pair = landmark.pair.map((item) => {
      if (typeof item !== "string" || !sourceNames.has(normalizeEntityName(item))) return item;
      changed = true;
      return target;
    });
  }
  return changed ? JSON.stringify(parsed) : value;
};

export function mergeEntities(db: RcmDatabase, chatId: string, sourceId: string, targetId: string, expectedRevision?: number): { source: string; target: string } {
  if (sourceId === targetId) throw Object.assign(new Error("Source and target entities must differ"), { code: "ENTITY_MERGE_SAME" });
  const active = db.prepare("SELECT 1 FROM jobs WHERE chat_id=? AND status='leased' AND leased_until>? LIMIT 1").get(chatId, Date.now());
  if (active) throw Object.assign(new Error("Pause the active extraction before merging entities"), { code: "ENTITY_MERGE_BUSY" });
  const getEntity = db.prepare("SELECT id,entity_key,name,display_name,type FROM entities WHERE id=? AND chat_id=?");
  const source = getEntity.get(sourceId, chatId) as { id: string; entity_key: string; name: string; display_name: string | null; type: string } | undefined;
  const target = getEntity.get(targetId, chatId) as { id: string; entity_key: string; name: string; display_name: string | null; type: string } | undefined;
  if (!source || !target) throw Object.assign(new Error("Entity not found"), { code: "ENTITY_NOT_FOUND" });
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number }).revision;
  if (expectedRevision !== undefined && expectedRevision !== revision) throw Object.assign(new Error("Derived data changed after preview; review the merge again"), { code: "ENTITY_MERGE_STALE" });
  const sourceAliases = (db.prepare("SELECT alias FROM aliases WHERE entity_id=?").all(source.id) as Array<{ alias: string }>).map((row) => row.alias);
  const sourceNames = soleOwnerEntityNames(listEntities(db,chatId),sourceId);
  const matches = (value: string): boolean => sourceNames.has(normalizeEntityName(value));
  const auxiliaryNames=(db.prepare(`SELECT entity_name AS name FROM entity_scene_presence WHERE chat_id=?
    UNION SELECT entity_name FROM entity_prominence WHERE chat_id=? UNION SELECT holder FROM memory_recall_events WHERE chat_id=?
    UNION SELECT character_name FROM memory_traces JOIN memories ON memories.id=memory_traces.memory_id WHERE memories.chat_id=?`)
    .all(chatId,chatId,chatId,chatId) as Array<{name:string}>).map(row=>row.name).filter(matches);

  return db.transaction(() => {
    // A merge is an explicit user identity decision. Keep the chosen target
    // through later derived-memory rebuilds even when it originated in a
    // transcript rather than the setup ledger.
    db.prepare("UPDATE entities SET user_managed=1,display_name=CASE WHEN display_name='' THEN name ELSE display_name END WHERE id=? AND chat_id=?")
      .run(target.id, chatId);
    const aliasInsert = db.prepare("INSERT OR IGNORE INTO aliases(entity_id,alias,normalized) VALUES(?,?,?)");
    mergeAliasRemovals(db, chatId, sourceId, targetId);
    const removed = aliasRemovalGuard(db, chatId);
    for (const row of db.prepare("SELECT alias FROM aliases WHERE entity_id=?").all(target.id) as Array<{ alias: string }>) {
      if (removed(target.id, row.alias)) db.prepare("DELETE FROM aliases WHERE entity_id=? AND alias=?").run(target.id, row.alias);
    }
    for (const alias of [source.name, source.entity_key, source.display_name || source.name, ...sourceAliases]) if (matches(alias) && !removed(target.id, alias)) aliasInsert.run(target.id, alias, normalizeEntityName(alias));

    for (const [table, columns] of [
      ["promises", ["promisor", "promisee"]], ["promise_events", ["promisor", "promisee"]],
      ["beliefs", ["holder", "subject"]], ["assertions", ["subject"]], ["memory_dialogues", ["speaker"]],
      ["social_knowledge_events", ["holder", "subject"]],
      ["relationship_events", ["from_entity", "to_entity"]],
    ] as Array<[string, string[]]>) {
      for (const column of columns) {
        const rows = db.prepare(`SELECT rowid AS id,${column} AS value FROM ${table} WHERE chat_id=?`).all(chatId) as Array<{ id: number; value: string | null }>;
        const update = db.prepare(`UPDATE ${table} SET ${column}=? WHERE rowid=?`);
        for (const row of rows) if (row.value && matches(row.value)) update.run(target.name, row.id);
      }
    }

    const detailEdits = readDetailAccessEdits(db, chatId);
    for (const [id, holders] of detailEdits) detailEdits.set(id, [...new Set(holders.map(name => matches(name) ? target.name : name))]);
    const identities = readDialogueAccessIdentities(db, chatId);
    for (const item of identities.values()) if (matches(item.speaker)) item.speaker = target.name;
    writeDialogueAccessIdentities(db, chatId, identities);
    writeDetailAccessEdits(db, chatId, detailEdits);
    const accessRows = db.prepare("SELECT id,item_kind,item_id,holder,basis,evidence_json,confidence,active FROM item_access WHERE chat_id=?").all(chatId) as Array<{
      id: string; item_kind: string; item_id: string; holder: string; basis: string; evidence_json: string; confidence: number; active: number;
    }>;
    for (const row of accessRows) if (row.holder !== "__narrator_archive__" && matches(row.holder)) {
      const duplicate = db.prepare("SELECT id,evidence_json,confidence,active FROM item_access WHERE chat_id=? AND item_kind=? AND item_id=? AND holder=? AND id<>?")
        .get(chatId, row.item_kind, row.item_id, target.name, row.id) as { id: string; evidence_json: string; confidence: number; active: number } | undefined;
      if (duplicate) {
        const evidence = [...new Map([...parseJson<Array<{ messageId: string; quote?: string }>>(duplicate.evidence_json, []), ...parseJson<Array<{ messageId: string; quote?: string }>>(row.evidence_json, [])]
          .map((entry) => [`${entry.messageId}\0${entry.quote ?? ""}`, entry])).values()];
        db.prepare("UPDATE item_access SET evidence_json=?,active=?,confidence=? WHERE id=?")
          .run(JSON.stringify(evidence), Math.max(row.active, duplicate.active), Math.max(row.confidence, duplicate.confidence), duplicate.id);
        db.prepare("DELETE FROM item_access WHERE id=?").run(row.id);
      } else db.prepare("UPDATE item_access SET holder=? WHERE id=?").run(target.name, row.id);
    }

    const memories = db.prepare("SELECT id,participants_json,known_by_json,perspective,landmark_kinds_json FROM memories WHERE chat_id=?").all(chatId) as Array<{ id: string; participants_json: string; known_by_json: string; perspective: string | null; landmark_kinds_json: string }>;
    const updateMemory = db.prepare("UPDATE memories SET participants_json=?,known_by_json=?,perspective=?,landmark_kinds_json=? WHERE id=?");
    for (const memory of memories) {
      const participants = replaceJsonNames(memory.participants_json, sourceNames, target.name);
      const knownBy = replaceJsonNames(memory.known_by_json, sourceNames, target.name);
      const perspective = memory.perspective && matches(memory.perspective) ? target.name : memory.perspective;
      const landmarkKinds = replaceLandmarkPairNames(memory.landmark_kinds_json, sourceNames, target.name);
      if (participants !== memory.participants_json || knownBy !== memory.known_by_json || perspective !== memory.perspective || landmarkKinds !== memory.landmark_kinds_json) {
        updateMemory.run(participants, knownBy, perspective, landmarkKinds, memory.id);
        refreshMemoryFts(db, memory.id);
      }
    }
    for (const assertion of db.prepare("SELECT id,social_relation_json FROM assertions WHERE chat_id=? AND social_relation_json IS NOT NULL").all(chatId) as Array<{id:string;social_relation_json:string}>) {
      const relation=JSON.parse(assertion.social_relation_json);
      if(typeof relation.target==='string' && matches(relation.target)) relation.target=target.name;
      if(Array.isArray(relation.knownBy)) relation.knownBy=JSON.parse(replaceJsonNames(JSON.stringify(relation.knownBy),sourceNames,target.name));
      db.prepare("UPDATE assertions SET social_relation_json=? WHERE id=?").run(JSON.stringify(relation),assertion.id);
    }
    const details = db.prepare("SELECT id,participants_json,known_by_json,seed_json FROM memory_details WHERE chat_id=?").all(chatId) as Array<{ id: string; participants_json: string; known_by_json: string; seed_json: string | null }>;
    for (const detail of details) db.prepare("UPDATE memory_details SET participants_json=?,known_by_json=?,seed_json=?,updated_at=? WHERE id=?").run(
      replaceJsonNames(detail.participants_json, sourceNames, target.name), replaceJsonNames(detail.known_by_json, sourceNames, target.name), detail.seed_json ? JSON.stringify({...JSON.parse(detail.seed_json),noticedBy:JSON.parse(replaceJsonNames(JSON.stringify(JSON.parse(detail.seed_json).noticedBy),sourceNames,target.name))}) : null, Date.now(), detail.id,
    );

    const baselines = db.prepare("SELECT id,from_entity,to_entity FROM relationship_baselines WHERE chat_id=?").all(chatId) as Array<{ id: string; from_entity: string; to_entity: string }>;
    for (const baseline of baselines) {
      if (!matches(baseline.from_entity) && !matches(baseline.to_entity)) continue;
      const from = matches(baseline.from_entity) ? target.name : baseline.from_entity;
      const to = matches(baseline.to_entity) ? target.name : baseline.to_entity;
      const conflict = db.prepare("SELECT id FROM relationship_baselines WHERE chat_id=? AND from_entity=? AND to_entity=? AND id<>?").get(chatId, from, to, baseline.id) as { id: string } | undefined;
      if (from === to || conflict) db.prepare("DELETE FROM relationship_baselines WHERE id=?").run(baseline.id);
      else db.prepare("UPDATE relationship_baselines SET from_entity=?,to_entity=? WHERE id=?").run(from, to, baseline.id);
    }

    for(const projection of db.prepare("SELECT * FROM relationship_projections WHERE chat_id=?").all(chatId) as Array<Record<string,any>>) {
      if(!matches(projection.from_entity) && !matches(projection.to_entity)) continue;
      const from=matches(projection.from_entity)?target.name:projection.from_entity;
      const to=matches(projection.to_entity)?target.name:projection.to_entity;
      const collision=db.prepare("SELECT 1 FROM relationship_projections WHERE chat_id=? AND from_entity=? AND to_entity=?").get(chatId,from,to);
      // Actual collisions keep the existing replay policy; unrelated projections retain their override/provenance.
      if(collision) db.prepare("DELETE FROM relationship_projections WHERE chat_id=? AND from_entity=? AND to_entity=?").run(chatId,from,to);
      if(from===to || collision) db.prepare("DELETE FROM relationship_projections WHERE chat_id=? AND from_entity=? AND to_entity=?").run(chatId,projection.from_entity,projection.to_entity);
      else db.prepare("UPDATE relationship_projections SET from_entity=?,to_entity=? WHERE chat_id=? AND from_entity=? AND to_entity=?").run(from,to,chatId,projection.from_entity,projection.to_entity);
    }
    for(const queued of db.prepare("SELECT from_entity,to_entity FROM relationship_projection_queue WHERE chat_id=?").all(chatId) as Array<{from_entity:string;to_entity:string}>) {
      if(matches(queued.from_entity) || matches(queued.to_entity)) db.prepare("DELETE FROM relationship_projection_queue WHERE chat_id=? AND from_entity=? AND to_entity=?").run(chatId,queued.from_entity,queued.to_entity);
    }

    const milestones = db.prepare("SELECT * FROM physical_intimacy_milestones WHERE chat_id=? ORDER BY COALESCE(source_start_ordinal,2147483647),created_at").all(chatId) as Array<Record<string, any>>;
    const physicalMemoryIds = new Set<string>(milestones.flatMap((milestone) => milestone.source_memory_id ? [String(milestone.source_memory_id)] : []));
    for (const milestone of milestones) {
      if (![milestone.participant_a,milestone.participant_b,milestone.initiator].some(value => value && matches(value))) continue;
      const pair = [matches(milestone.participant_a) ? target.name : milestone.participant_a, matches(milestone.participant_b) ? target.name : milestone.participant_b].sort((left, right) => left.localeCompare(right));
      if (pair[0] === pair[1]) { db.prepare("DELETE FROM physical_intimacy_milestones WHERE id=?").run(milestone.id); continue; }
      const conflict = db.prepare("SELECT id,source_memory_id,source_start_ordinal,created_at,manual_override FROM physical_intimacy_milestones WHERE chat_id=? AND participant_a=? AND participant_b=? AND milestone_key=? AND id<>? ORDER BY manual_override DESC,COALESCE(source_start_ordinal,2147483647),created_at LIMIT 1")
        .get(chatId, pair[0], pair[1], milestone.milestone_key, milestone.id) as { id: string; source_memory_id: string | null; source_start_ordinal: number | null; created_at: number; manual_override: number } | undefined;
      if (conflict?.source_memory_id) physicalMemoryIds.add(conflict.source_memory_id);
      const conflictWins = conflict && (Number(conflict.manual_override) > Number(milestone.manual_override ?? 0)
        || Number(conflict.manual_override) === Number(milestone.manual_override ?? 0) && Number(conflict.source_start_ordinal ?? Number.MAX_SAFE_INTEGER) <= Number(milestone.source_start_ordinal ?? Number.MAX_SAFE_INTEGER));
      if (conflictWins) db.prepare("DELETE FROM physical_intimacy_milestones WHERE id=?").run(milestone.id);
      else {
        if (conflict) db.prepare("DELETE FROM physical_intimacy_milestones WHERE id=?").run(conflict.id);
        db.prepare("UPDATE physical_intimacy_milestones SET participant_a=?,participant_b=?,initiator=? WHERE id=?").run(pair[0], pair[1], milestone.initiator && matches(milestone.initiator) ? target.name : milestone.initiator, milestone.id);
      }
    }
    for (const memoryId of physicalMemoryIds) refreshMemoryFts(db, memoryId);

    for (const sourceName of auxiliaryNames) {
      if(normalizeEntityName(sourceName)===normalizeEntityName(target.name)) continue;
    const presence = db.prepare("SELECT scene_key,created_at FROM entity_scene_presence WHERE chat_id=? AND entity_name=? COLLATE NOCASE").all(chatId, sourceName) as Array<{ scene_key: string; created_at: number }>;
    for (const row of presence) db.prepare("INSERT OR IGNORE INTO entity_scene_presence(chat_id,entity_name,scene_key,created_at) VALUES(?,?,?,?)").run(chatId, target.name, row.scene_key, row.created_at);
    db.prepare("DELETE FROM entity_scene_presence WHERE chat_id=? AND entity_name=? COLLATE NOCASE").run(chatId, sourceName);
    const sourceProminence = db.prepare("SELECT durable_links,pinned FROM entity_prominence WHERE chat_id=? AND entity_name=? COLLATE NOCASE").get(chatId, sourceName) as { durable_links: number; pinned: number } | undefined;
    const targetProminence = db.prepare("SELECT durable_links,pinned FROM entity_prominence WHERE chat_id=? AND entity_name=? COLLATE NOCASE").get(chatId, target.name) as { durable_links: number; pinned: number } | undefined;
    const sceneCount = (db.prepare("SELECT COUNT(*) count FROM entity_scene_presence WHERE chat_id=? AND entity_name=? COLLATE NOCASE").get(chatId, target.name) as { count: number }).count;
    const durableLinks = Number(sourceProminence?.durable_links ?? 0) + Number(targetProminence?.durable_links ?? 0);
    const pinned = Number(Boolean(sourceProminence?.pinned || targetProminence?.pinned));
    const tier = pinned || (sceneCount >= 4 && durableLinks > 0) ? "core" : sceneCount >= 2 || durableLinks > 0 ? "recurring" : "incidental";
    db.prepare(`INSERT INTO entity_prominence(chat_id,entity_name,tier,scene_count,durable_links,pinned,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(chat_id,entity_name) DO UPDATE SET tier=excluded.tier,scene_count=excluded.scene_count,durable_links=excluded.durable_links,pinned=excluded.pinned,updated_at=excluded.updated_at`)
      .run(chatId, target.name, tier, sceneCount, durableLinks, pinned, Date.now());
    db.prepare("DELETE FROM entity_prominence WHERE chat_id=? AND entity_name=? COLLATE NOCASE").run(chatId, sourceName);
    }
    for (const passage of db.prepare("SELECT id,speaker,access_json FROM source_passages WHERE chat_id=?").all(chatId) as Array<{id:string;speaker:string|null;access_json:string}>) {
      const grants = (JSON.parse(passage.access_json) as Array<{holder:string}>).map((grant) => ({ ...grant, holder: matches(grant.holder) ? target.name : grant.holder }));
      db.prepare("UPDATE source_passages SET speaker=?,access_json=? WHERE id=?").run(passage.speaker && matches(passage.speaker) ? target.name : passage.speaker, JSON.stringify(grants), passage.id);
    }
    for (const sourceName of auxiliaryNames) {
      if(normalizeEntityName(sourceName)===normalizeEntityName(target.name)) continue;
    // Consolidate duplicate source observations before changing the holder key.
    db.prepare(`DELETE FROM memory_recall_events WHERE chat_id=? AND holder=? AND EXISTS (
      SELECT 1 FROM memory_recall_events other WHERE other.chat_id=? AND other.holder=?
      AND other.memory_id=memory_recall_events.memory_id AND other.source_batch_id=memory_recall_events.source_batch_id)`).run(chatId, sourceName, chatId, target.name);
    db.prepare("UPDATE memory_recall_events SET holder=? WHERE chat_id=? AND holder=?").run(target.name, chatId, sourceName);
    const traces = db.prepare("SELECT mt.* FROM memory_traces mt JOIN memories m ON m.id=mt.memory_id WHERE m.chat_id=? AND mt.character_name=?").all(chatId, sourceName) as Array<Record<string, any>>;
    for (const trace of traces) {
      db.prepare(`INSERT INTO memory_traces(memory_id,character_name,strength,salience,recall_count,last_recalled_revision,last_recalled_turn_seq,detail_level,distortion_type)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(memory_id,character_name) DO UPDATE SET strength=MAX(strength,excluded.strength),salience=MAX(salience,excluded.salience),recall_count=MAX(recall_count,excluded.recall_count),last_recalled_revision=MAX(last_recalled_revision,excluded.last_recalled_revision),last_recalled_turn_seq=MAX(COALESCE(last_recalled_turn_seq,excluded.last_recalled_turn_seq),COALESCE(excluded.last_recalled_turn_seq,last_recalled_turn_seq)),detail_level=CASE WHEN detail_level='clear' OR excluded.detail_level='clear' THEN 'clear' ELSE detail_level END`).run(
        trace.memory_id, target.name, trace.strength, trace.salience, trace.recall_count, trace.last_recalled_revision, trace.last_recalled_turn_seq, trace.detail_level, trace.distortion_type,
      );
    }
    db.prepare("DELETE FROM memory_traces WHERE character_name=? AND memory_id IN (SELECT id FROM memories WHERE chat_id=?)").run(sourceName, chatId);

    }
    const revoked=db.prepare("UPDATE relationship_events SET active=0 WHERE chat_id=? AND from_entity=? AND to_entity=? AND active=1 RETURNING id")
      .all(chatId,target.name,target.name) as Array<{id:string}>;
    const projectionPairs = db.prepare("SELECT DISTINCT from_entity AS 'from',to_entity AS 'to' FROM relationship_events WHERE chat_id=? AND active=1 AND (from_entity=? OR to_entity=?)").all(chatId, target.name, target.name) as Array<{ from: string; to: string }>;
    for (const pair of projectionPairs) db.prepare(`INSERT INTO relationship_projection_queue(chat_id,from_entity,to_entity,queued_at,mode) VALUES(?,?,?,?,'replay')
      ON CONFLICT(chat_id,from_entity,to_entity) DO UPDATE SET queued_at=excluded.queued_at,mode='replay'`).run(chatId, pair.from, pair.to, Date.now());

    db.prepare("DELETE FROM entities WHERE id=? AND chat_id=?").run(source.id, chatId);
    const supports=new Set(revoked.map(row=>`relationship_events:${row.id}`));
    syncManualCognition(db,chatId,supports);
    invalidateStorySupports(db,chatId,supports);
    return { source: source.name, target: target.name };
  })();
}
