import { syncManualCognition } from "./social-knowledge.js";
import { memoryReferenceHighWater } from "./memory-references.js";
import { DATABASE_SCHEMA_VERSION, type RcmDatabase } from "./db.js";
import { ChatBackupSettingsSchema, type ChatBackupSettings } from "@rcm/shared";
import { bindInheritedMemoryGroups, invalidateChangedMemoryGroups } from './memory-grouping.js';
import { sourceFingerprint } from './source-fingerprint.js';
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { refreshMemoryFts } from "./memory-search-document.js";
import { createHash, randomUUID } from "node:crypto";
import { deleteDerivedRows } from "./derived-state.js";
import { migrateTranslationKeys, pruneTranslationCache, translationCacheKey } from "./translation-cache.js";
import { ledgerEditOriginsKey, readRemovedAliases, readUserDeletions, removedAliasesKey, userDeletionsKey, type Deletion, type RemovedAliases } from "./user-deletions.js";
import { dialogueAccessIdentityKey, detailAccessEditsKey } from "./item-access.js";

export const BACKUP_VERSION = 33 as const;

export class BackupValidationError extends Error {
  readonly code = "BACKUP_VALIDATION_FAILED";
}

const insertionOrder = [
  "chats", "messages", "message_revisions", "entities", "aliases", "episodes", "episode_messages", "episode_sections",
  "source_passages", "memories", "memory_details", "memory_dialogues", "evidence_spans", "memory_traces", "memory_recall_events", "memory_activation_state", "memory_edges", "item_access", "assertions", "beliefs",
  "story_spine_nodes", "story_spine_support", "story_spine_sources",
  "relationship_baselines", "relationship_events", "relationship_projections", "relationship_projection_queue", "physical_intimacy_milestones", "social_knowledge_events", "entity_scene_presence", "entity_prominence", "promises", "promise_events", "conflicts", "jobs", "extraction_audits", "reconciliation_items", "recall_logs", "embedding_blocks", "initial_calibrations", "chat_lineage", "chat_lineage_items", "extraction_batches", "atom_relations",
  "embedding_items", "embedding_failures", "translation_cache",
] as const;

type Row = Record<string, string | number | null>;

function insertRows(db: RcmDatabase, table: string, rows: Row[]): void {
  const available = new Set((db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name));
  for (const row of rows) {
    const columns = Object.keys(row).filter((column) => available.has(column));
    if (columns.length === 0) continue;
    const sql = `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`;
    db.prepare(sql).run(...columns.map((column) => row[column]));
  }
}


type CompleteManifest = {
  format: "risu-cognitive-memory-complete";
  scope: "complete" | "chat";
  version: 31 | 32 | typeof BACKUP_VERSION;
  schemaVersion: 46 | 47 | 48 | 49 | 50 | 51 | typeof DATABASE_SCHEMA_VERSION;
  exportedAt: number;
  instanceId: string;
  chats: Array<{ id: string; title: string; characterId: string }>;
  tables: Record<string, string[]>;
  files: Record<string, string>;
};
export interface CompleteBackupPrivateData {
  chatSettings?: ChatBackupSettings;
  serverSettings?: Record<string, string>;
  pluginSettings?: unknown;
  serverUrl?: string;
  serverToken?: string;
  secrets?: string;
  voyageApiKey?: string;
  llmApiKeys?: Partial<Record<"gemini_api" | "vertex" | "llm_gateway" | "openai_compatible" | "vercel" | "ollama_cloud" | "copilot", string>>;
}
export interface CompleteBackupInspection {
  manifest: CompleteManifest;
  privateData: CompleteBackupPrivateData;
}
export interface MemoryTransplantPreview {
  fingerprint: string;
  parent: { chatId: string; chatTitle: string; characterId: string; characterName: string };
  target: { chatId: string; chatTitle: string; characterId: string; characterName: string };
  kind: "copy";
  commonMessages: number;
  lastCommonMessageId: string;
  forkOrdinal: number;
  clientPrunedMessages: number;
  inheritedCounts: Record<string, number>;
  targetDerivedCounts: Record<string, number>;
  requiresReplacement: boolean;
}

const excludedBackupTable = (name: string): boolean => name.startsWith("sqlite_") || name === "schema_migrations"
  || name.startsWith("source_fts") || name.startsWith("memory_fts") || name.startsWith("memory_detail_fts") || name.startsWith("embedding_vectors_v4_chat");
const checksum = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

function persistentTables(db: RcmDatabase): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY rowid").all() as Array<{ name: string }>)
    .map((row) => row.name).filter((name) => !excludedBackupTable(name));
}

function vectorFiles(db: RcmDatabase, chatId?: string): { index: Uint8Array; data: Uint8Array } {
  let rows: Array<{ rowid: number; item_id: string; vector_json: string }> = [];
  try {
    rows = db.prepare(`SELECT i.rowid,i.item_id,vec_to_json(v.embedding) AS vector_json FROM embedding_items i
      JOIN embedding_vectors_v4_chat v ON v.rowid=i.rowid ${chatId ? "WHERE i.chat_id=?" : ""} ORDER BY i.rowid`).all(...(chatId ? [chatId] : [])) as typeof rows;
  } catch { return { index: strToU8(""), data: new Uint8Array() }; }
  const vectors: number[] = [];
  const index: string[] = [];
  for (const row of rows) {
    const parsed = JSON.parse(row.vector_json) as number[];
    index.push(JSON.stringify({ itemId: row.item_id, offset: vectors.length, length: parsed.length }));
    vectors.push(...parsed);
  }
  return { index: strToU8(index.join("\n")), data: new Uint8Array(new Float32Array(vectors).buffer) };
}

const indirectChatOwners: Record<string,[string,string]> = {
  aliases:["entity_id","entities"], memory_traces:["memory_id","memories"], memory_vector_map:["memory_id","memories"],
  story_spine_support:["node_id","story_spine_nodes"], story_spine_sources:["node_id","story_spine_nodes"],
};
/** SQL ownership is structural; chat export never includes global server rows. */
function chatTableWhere(db: RcmDatabase, table: string): string {
  const columns = (db.pragma(`table_info(${table})`) as Array<{name:string}>).map(column=>column.name);
  if (table === "chats") return "id=?";
  if (columns.includes("chat_id")) return "chat_id=?";
  if (columns.includes("child_chat_id")) return "child_chat_id=?";
  const owner=indirectChatOwners[table];
  if (owner) return `${owner[0]} IN (SELECT id FROM ${owner[1]} WHERE chat_id=?)`;
  // Chat-owned keys, including access edits and pending dialogue identities. Keep restore
  // validation aligned; admin deletion retains reference counters and tombstones.
  if (table === "server_meta") return "key IN ('retrieval_trace_chat:' || ?, 'memory_bookmarks:' || ?, 'view_preferences:' || ?, 'user_deletions:' || ?, 'persona_hint:' || ?, 'ledger_edit_origins:' || ?, 'removed_aliases:' || ?, 'detail_access_edits:' || ?, 'dialogue_access_identity:' || ?, 'quiz_history_boundary:' || ?, 'memory_ref_sequence:' || ?)";
  throw new Error(`Chat backup ownership is not defined: ${table}`);
}

const chatTableBindings = (table: string, chatId: string): string[] => table === "server_meta" ? Array(11).fill(chatId) : [chatId];

export function exportCompleteArchive(db: RcmDatabase, privateData: CompleteBackupPrivateData = {}): Uint8Array {
  return exportArchive(db, privateData);
}

export function exportChatArchive(db: RcmDatabase, chatId: string, chatSettings: ChatBackupSettings = {}): Uint8Array {
  if (!db.prepare("SELECT id FROM chats WHERE id=?").get(chatId)) throw new Error("Chat not found");
  return exportArchive(db, {chatSettings:ChatBackupSettingsSchema.parse(chatSettings)}, chatId);
}

function exportArchive(db: RcmDatabase, privateData: CompleteBackupPrivateData, chatId?: string): Uint8Array {
  for (const row of db.prepare(`SELECT id FROM chats${chatId ? " WHERE id=?" : ""}`).all(...(chatId ? [chatId] : [])) as Array<{ id: string }>) invalidateChangedMemoryGroups(db, row.id);
  const files: Record<string, Uint8Array> = {};
  const tables = persistentTables(db);
  for (const table of tables) {
    const rows = (db.prepare(`SELECT * FROM ${table}${chatId ? ` WHERE ${chatTableWhere(db,table)}` : ""}`).all(...(chatId ? chatTableBindings(table, chatId) : [])) as Row[]).map((row) => {
      if (table === "jobs" && ["leased", "processing"].includes(String(row.status))) return { ...row, status: "queued", lease_owner: null, leased_until: null };
      if ((table === "extraction_batches" || table === "embedding_blocks") && row.status === "processing") return { ...row, status: "queued" };
      return row;
    });
    // Packet budgets are runtime hints, not portable canonical state.
    files[`tables/${table}.jsonl`] = strToU8(rows.filter(row => table !== "server_meta" || !String(row.key).startsWith("chat_packet_budget:")).map((row) => JSON.stringify(row)).join("\n"));
  }
  const vectors = vectorFiles(db, chatId);
  files["vectors/index.jsonl"] = vectors.index;
  files["vectors/data.f32"] = vectors.data;
  files["private.json"] = strToU8(JSON.stringify(privateData));
  const instanceId = String((db.prepare("SELECT value FROM server_meta WHERE key='instance_id'").get() as { value?: string } | undefined)?.value ?? "");
  const chats = (db.prepare(`SELECT id,COALESCE(chat_title,'') AS title,character_id AS characterId FROM chats${chatId ? " WHERE id=?" : ""} ORDER BY updated_at DESC`).all(...(chatId ? [chatId] : [])) as CompleteManifest["chats"]);
  const manifest: CompleteManifest = {
    format: "risu-cognitive-memory-complete", scope:chatId ? "chat" : "complete", version: BACKUP_VERSION, schemaVersion: DATABASE_SCHEMA_VERSION, exportedAt: Date.now(), instanceId, chats,
    tables: Object.fromEntries(tables.map((table) => [table, (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name)])),
    files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, checksum(bytes)])),
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(files, { level: 6 });
}

function readCompleteArchive(archive: Uint8Array): { files: Record<string, Uint8Array>; manifest: CompleteManifest; privateData: CompleteBackupPrivateData } {
  const files = unzipSync(archive);
  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) throw new BackupValidationError("Backup manifest is missing");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as CompleteManifest;
  if (manifest.format !== "risu-cognitive-memory-complete" || !(manifest.version === 33 && [49, 50, 51, DATABASE_SCHEMA_VERSION].includes(manifest.schemaVersion) || manifest.version === 32 && manifest.schemaVersion === 48
    || manifest.version === 31 && [46, 47].includes(manifest.schemaVersion))) {
    throw new BackupValidationError(`Unsupported backup format (accepts backup 31 / schema 46 or 47, backup 32 / schema 48, or backup 33 / schema 49, 50, 51 or ${DATABASE_SCHEMA_VERSION})`);
  }
  if (!["complete","chat"].includes(manifest.scope) || (manifest.scope === "chat" && manifest.chats?.length !== 1)) throw new BackupValidationError("Invalid backup scope");
  if (!manifest.tables || typeof manifest.tables !== "object") throw new BackupValidationError("Backup table contract is missing");
  for (const table of Object.keys(manifest.tables)) if (!manifest.files[`tables/${table}.jsonl`]) throw new BackupValidationError(`Backup table is missing: ${table}`);
  for (const [path, expected] of Object.entries(manifest.files)) {
    const bytes = files[path];
    if (!bytes || checksum(bytes) !== expected) throw new BackupValidationError(`Backup checksum mismatch: ${path}`);
  }
  const privateData = files["private.json"] ? JSON.parse(strFromU8(files["private.json"]!)) as CompleteBackupPrivateData : {};
  if (manifest.scope === "chat") {
    if (Object.keys(privateData).some(key=>key !== "chatSettings")) throw new Error("Chat backup must not contain global settings or keys");
    privateData.chatSettings=ChatBackupSettingsSchema.parse(privateData.chatSettings ?? {});
  }
  return { files, manifest, privateData };
}

export function inspectCompleteArchive(archive: Uint8Array): CompleteBackupInspection {
  const { manifest, privateData } = readCompleteArchive(archive);
  return { manifest, privateData: { serverUrl: privateData.serverUrl, serverToken: privateData.serverToken } };
}

function archiveTables(files: Record<string, Uint8Array>): Record<string, Row[]> {
  const tables: Record<string, Row[]> = {};
  for (const [path, bytes] of Object.entries(files)) {
    const match = path.match(/^tables\/([a-z_]+)\.jsonl$/u);
    if (!match?.[1]) continue;
    const text = strFromU8(bytes).trim();
    tables[match[1]] = text ? text.split(/\r?\n/u).map((line) => JSON.parse(line) as Row) : [];
  }
  return tables;
}

function validateCurrentSchema(db: RcmDatabase, manifest: CompleteManifest): void {
  const current = persistentTables(db).filter(table => manifest.version !== 31 || table !== "memory_references");
  if (current.length !== Object.keys(manifest.tables).length || current.some((table) => !manifest.tables[table])) throw new BackupValidationError(`Backup database contract does not match schema ${manifest.schemaVersion}`);
  for (const table of current) {
    const columns = (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name)
      .filter(column => !(manifest.schemaVersion === 46 && table === "translation_cache" && column === "model")
        && !(manifest.schemaVersion < 49 && table === "messages" && column === "memory_excluded")
        && !(manifest.schemaVersion < 51 && ["promises", "promise_events"].includes(table) && ["ended_at_turn", "recency_until_turn"].includes(column))
        && !(manifest.schemaVersion < 51 && table === "promises" && column === "pinned")
        && !(manifest.schemaVersion < 52 && table === "entities" && column === "color"));
    // Rows are inserted by column name. Physical column order is not a backup contract.
    const archived = manifest.tables[table];
    if (!Array.isArray(archived) || archived.length !== columns.length || new Set(archived).size !== columns.length
      || columns.some(column => !archived.includes(column))) throw new BackupValidationError(`Backup table contract does not match: ${table}`);
  }
}

function chatDescriptor(db: RcmDatabase, chatId: string): MemoryTransplantPreview["parent"] {
  const row = db.prepare("SELECT id,COALESCE(chat_title,'') AS chatTitle,character_id AS characterId,COALESCE(static_json,'{}') AS staticJson FROM chats WHERE id=?").get(chatId) as any;
  if (!row) throw new Error("Chat not found");
  let characterName = row.characterId;
  try { characterName = JSON.parse(row.staticJson).characterName?.trim() || characterName; } catch { /* use character id */ }
  return { chatId: row.id, chatTitle: row.chatTitle, characterId: row.characterId, characterName };
}

function transplantCounts(db: RcmDatabase, chatId: string): Record<string, number> {
  const count = (table: string, where = ""): number => Number((db.prepare(`SELECT count(*) AS count FROM ${table} WHERE chat_id=?${where}`).get(chatId) as { count: number }).count);
  return {
    memories: count("memories", " AND active=1"), relationships: count("relationship_projections"), assertions: count("assertions", " AND valid_to_revision IS NULL"),
    beliefs: count("beliefs", " AND active=1"), promises: count("promises", " AND status='open'"), storySpineNodes: count("story_spine_nodes", " AND status='active'"),
  };
}

export function previewMemoryTransplant(db: RcmDatabase, sourceChatId: string, targetChatId: string): MemoryTransplantPreview {
  const parent = chatDescriptor(db, sourceChatId);
  const target = chatDescriptor(db, targetChatId);
  const inheritedCounts = transplantCounts(db, sourceChatId);
  const targetDerivedCounts = transplantCounts(db, targetChatId);
  const forkOrdinal = Number((db.prepare("SELECT COALESCE(MAX(ordinal),-1) AS ordinal FROM messages WHERE chat_id=?").get(sourceChatId) as { ordinal: number }).ordinal);
  const fingerprint = createHash("sha256").update(JSON.stringify({ sourceChatId, targetChatId, inheritedCounts, targetDerivedCounts, forkOrdinal })).digest("hex");
  return { fingerprint, parent, target, kind: "copy", commonMessages: 0, lastCommonMessageId: "", forkOrdinal, clientPrunedMessages: 0,
    inheritedCounts, targetDerivedCounts, requiresReplacement: Object.values(targetDerivedCounts).some((value) => value > 0) };
}

function restoreVectors(db: RcmDatabase, files: Record<string, Uint8Array>, itemIdMap?: Map<string, string>): number {
  const indexText = files["vectors/index.jsonl"] ? strFromU8(files["vectors/index.jsonl"]!).trim() : "";
  const data = files["vectors/data.f32"];
  if (!indexText || !data) return 0;
  const values = new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const insert = db.prepare("INSERT INTO embedding_vectors_v4_chat(rowid,embedding,chat_id) SELECT rowid,?,chat_id FROM embedding_items WHERE item_id=?");
  let restored = 0;
  for (const line of indexText.split(/\r?\n/u)) {
    const entry = JSON.parse(line) as { itemId: string; offset: number; length: number };
    if (itemIdMap && !itemIdMap.has(entry.itemId)) continue;
    const itemId = itemIdMap?.get(entry.itemId) ?? entry.itemId;
    const item = db.prepare("SELECT dimension FROM embedding_items WHERE item_id=?").get(itemId) as { dimension: number } | undefined;
    if (!item || item.dimension !== entry.length) continue;
    try { insert.run(new Float32Array(values.slice(entry.offset, entry.offset + entry.length)), itemId); restored += 1; } catch { /* incompatible vector extension is re-queued */ }
  }
  return restored;
}

function rebuildSearch(db: RcmDatabase): void {
  for (const chat of db.prepare("SELECT id FROM chats").all() as Array<{id:string}>) syncManualCognition(db,chat.id);
  db.prepare("DELETE FROM memory_fts").run();
  db.prepare("DELETE FROM memory_detail_fts").run();
  for (const row of db.prepare("SELECT id FROM memories WHERE active=1").all() as Array<{ id: string }>) refreshMemoryFts(db, row.id);
  const insert = db.prepare("INSERT INTO memory_detail_fts(detail_id,chat_id,memory_id,text,participants,locations) VALUES(?,?,?,?,?,?)");
  for (const row of db.prepare("SELECT id,chat_id,memory_id,text,participants_json,locations_json FROM memory_details WHERE active=1").all() as Array<Record<string, any>>) {
    insert.run(row.id, row.chat_id, row.memory_id, row.text, JSON.parse(row.participants_json ?? "[]").join(" "), JSON.parse(row.locations_json ?? "[]").join(" "));
  }
}

/** Merge address tombstones, rejecting forks that assigned an existing address or
 * memory differently. Unknown pre-upgrade numbers below the high-water stay reserved. */
function mergeMemoryReferences(db: RcmDatabase, tables: Record<string, Row[]>, manifest: CompleteManifest, chatId?: string): Map<string, bigint> {
  const highWater = memoryReferenceHighWater(db);
  const local = db.prepare(`SELECT * FROM memory_references${chatId ? " WHERE chat_id=?" : ""}`).all(...(chatId ? [chatId] : [])) as Row[];
  const imported = tables.memory_references ?? [];
  const byRef = new Map(local.map(row => [JSON.stringify([row.chat_id, row.ref]), row]));
  const byMemory = new Map(local.map(row => [JSON.stringify([row.chat_id, row.memory_id]), row]));
  for (const row of imported) {
    if (typeof row.chat_id !== "string" || typeof row.memory_id !== "string" || typeof row.ref !== "string" || !/^m[1-9][0-9]*$/.test(row.ref)) {
      throw new BackupValidationError("Invalid memory reference in backup");
    }
    const prior = byRef.get(JSON.stringify([row.chat_id, row.ref]));
    const memory = byMemory.get(JSON.stringify([row.chat_id, row.memory_id]));
    if ((prior && prior.memory_id !== row.memory_id) || (memory && memory.ref !== row.ref)
      || (!prior && BigInt(row.ref.slice(1)) <= (highWater.get(`memory_ref_sequence:${row.chat_id}`) ?? 0n))) {
      throw new BackupValidationError("Memory reference conflict: restore would reassign a previously issued address");
    }
    byRef.set(JSON.stringify([row.chat_id, row.ref]), row);
    byMemory.set(JSON.stringify([row.chat_id, row.memory_id]), row);
  }
  tables.memory_references = [...byRef.values()];
  for (const row of tables.memory_references) {
    const key = `memory_ref_sequence:${row.chat_id}`;
    const value = BigInt(String(row.ref).slice(1));
    if (value > (highWater.get(key) ?? 0n)) highWater.set(key, value);
  }
  if (manifest.version === 31) {
    const metadata = tables.server_meta ?? [];
    const global = BigInt(String(metadata.find(row => row.key === "memory_ref_sequence")?.value ?? "0"));
    for (const chat of manifest.chats) {
      const key = `memory_ref_sequence:${chat.id}`;
      const counter = metadata.find(row => row.key === key);
      // Before counters, refs used 8 random bytes rendered as 16 hex characters.
      // Reserve every all-decimal address that allocator could emit. Counter-based
      // releases persisted every issuance; preserve their exact high-water too.
      const imported = counter ? BigInt(String(counter.value)) : 10_000_000_000_000_000n;
      highWater.set(key, [highWater.get(key) ?? 0n, imported, global].reduce((a, b) => a > b ? a : b));
    }
    tables.server_meta = metadata.filter(row => row.key !== "memory_ref_sequence");
    tables.memory_references = [];
  }
  return highWater;
}

function preserveReferenceHighWater(db: RcmDatabase, highWater: Map<string, bigint>): void {
  const restored = memoryReferenceHighWater(db);
  for (const [key, value] of highWater) {
    const previous = restored.get(key) ?? 0n;
    db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(key, String(value > previous ? value : previous));
  }
}

export function restoreCompleteArchive(db: RcmDatabase, archive: Uint8Array): { inspection: CompleteBackupInspection; vectorsRestored: number; privateData: CompleteBackupPrivateData } {
  const parsed = readCompleteArchive(archive);
  if (parsed.manifest.scope !== "complete") throw new Error("Use chat restore for a chat backup");
  validateCurrentSchema(db, parsed.manifest);
  const tables = archiveTables(parsed.files);
  const currentTables = persistentTables(db);
  const refHighWater = mergeMemoryReferences(db, tables, parsed.manifest);
  let vectorsRestored = 0;
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      try { db.prepare("DELETE FROM embedding_vectors_v4_chat").run(); } catch { /* vector extension optional */ }
      for (const table of [...currentTables].reverse()) db.prepare(`DELETE FROM ${table}`).run();
      for (const table of currentTables) insertRows(db, table, tables[table] ?? []);
      preserveReferenceHighWater(db, refHighWater);
      vectorsRestored = restoreVectors(db, parsed.files);
      migrateTranslationKeys(db);
      db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?,?)").run(DATABASE_SCHEMA_VERSION, Date.now());
      rebuildSearch(db);
    })();
  } finally { db.pragma("foreign_keys = ON"); }
  return { inspection: { manifest: parsed.manifest, privateData: { serverUrl: parsed.privateData.serverUrl, serverToken: parsed.privateData.serverToken } }, vectorsRestored, privateData: parsed.privateData };
}

/** Restores the original chat identity without touching other chats or secrets. */
export function restoreChatArchive(db: RcmDatabase, archive: Uint8Array): {chatId:string;chatSettings:ChatBackupSettings;vectorsRestored:number} {
  const parsed=readCompleteArchive(archive);
  if (parsed.manifest.scope !== "chat") throw new Error("Use complete restore for a complete backup");
  validateCurrentSchema(db,parsed.manifest);
  const chatId=parsed.manifest.chats[0]!.id;
  const tables=archiveTables(parsed.files);
  if (tables.chats?.length !== 1 || tables.chats[0]?.id !== chatId) throw new Error("Chat backup identity mismatch");
  const ownedIds=(table:string,column:string)=>new Set((tables[table]??[]).map(row=>row[column]));
  const owners:Record<string,[string,Set<Row[string]|undefined>]> = Object.fromEntries(
    Object.entries(indirectChatOwners).map(([table,[column,parent]])=>[table,[column,ownedIds(parent,"id")]]));
  for (const [table,rows] of Object.entries(tables)) for (const row of rows) {
    const valid=table==="chats" ? row.id===chatId : table==="server_meta" ? [
      `retrieval_trace_chat:${chatId}`, `memory_bookmarks:${chatId}`, `view_preferences:${chatId}`, `user_deletions:${chatId}`, `persona_hint:${chatId}`, ledgerEditOriginsKey(chatId), removedAliasesKey(chatId), detailAccessEditsKey(chatId), dialogueAccessIdentityKey(chatId), `quiz_history_boundary:${chatId}`, `memory_ref_sequence:${chatId}`,
    ].includes(String(row.key))
      : Object.hasOwn(row,"chat_id") ? row.chat_id===chatId : Object.hasOwn(row,"child_chat_id") ? row.child_chat_id===chatId
      : owners[table]?.[1].has(row[owners[table]![0]]);
    if (!valid) throw new Error(`Chat backup contains out-of-scope rows: ${table}`);
  }
  const refHighWater = mergeMemoryReferences(db, tables, parsed.manifest, chatId);
  let vectorsRestored=0;
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(()=>{
      try { db.prepare("DELETE FROM embedding_vectors_v4_chat WHERE rowid IN (SELECT rowid FROM embedding_items WHERE chat_id=?)").run(chatId); } catch { /* vectors optional */ }
      const ordered=persistentTables(db);
      for(const table of [...ordered].reverse()) db.prepare(`DELETE FROM ${table} WHERE ${chatTableWhere(db,table)}`).run(...chatTableBindings(table, chatId));
      for(const table of ordered) {
        const rows=(tables[table]??[]).map(row=>{
          if (table!=="embedding_items" && table!=="memory_vector_map") return row;
          const {rowid,...remaining}=row; return remaining;
        });
        insertRows(db,table,rows);
      }
      preserveReferenceHighWater(db, refHighWater);
      if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Chat backup failed foreign key validation");
      vectorsRestored=restoreVectors(db,parsed.files);
      migrateTranslationKeys(db);
      db.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(?,?)").run(DATABASE_SCHEMA_VERSION, Date.now());
      rebuildSearch(db);
    })();
  } finally { db.pragma("foreign_keys = ON"); }
  return {chatId,chatSettings:parsed.privateData.chatSettings??{},vectorsRestored};
}

function rewriteIdentifier(value: string, ids: Map<string, string>): string {
  const exact = ids.get(value);
  if (exact) return exact;
  if (!value.includes(":")) return value;
  let changed = false;
  const parts = value.split(":").map((part) => {
    const mapped = ids.get(part);
    if (mapped) changed = true;
    return mapped ?? part;
  });
  return changed ? parts.join(":") : value;
}

function rewriteJson(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") return rewriteIdentifier(value, ids);
  if (Array.isArray(value)) return value.map((item) => rewriteJson(item, ids));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    archiveCoordinateFields.has(key) && typeof item === "number" ? archiveCoordinate(item) : rewriteJson(item, ids)]));
  return value;
}

// These product-owned fields are source coordinates. Local beat/dialogue order,
// quote offsets and revisions belong to separate clocks and are left alone.
const archiveCoordinateFields = new Set([
  "start_ordinal", "end_ordinal", "source_start_ordinal", "source_end_ordinal", "source_ordinal",
  "valid_from_ordinal", "valid_to_ordinal", "user_edit_ordinal", "completed_turn_seq", "last_recalled_turn_seq", "ended_at_turn", "recency_until_turn",
  "sourceOrdinal", "sourceEndOrdinal", "startOrdinal", "endOrdinal",
]);
function archiveCoordinate(value: Row[string]): Row[string] {
  return typeof value === "number" ? value - 1_000_000_000 : value;
}

export function transplantCompleteArchive(db: RcmDatabase, archive: Uint8Array, sourceChatId: string, targetChatId: string): { memories: number; vectorsRestored: number } {
  const parsed = readCompleteArchive(archive);
  validateCurrentSchema(db, parsed.manifest);
  const tables = archiveTables(parsed.files);
  const target = db.prepare("SELECT id FROM chats WHERE id=?").get(targetChatId);
  if (!target) throw new Error("Target chat not found");
  if (!(tables.chats ?? []).some((row) => row.id === sourceChatId)) throw new Error("Source chat not found in backup");
  const transplantTables = new Set([
    "extraction_batches",
    "messages", "message_revisions", "entities", "aliases", "episodes", "episode_messages", "episode_sections",
    "source_passages", "memories", "memory_details", "memory_dialogues", "evidence_spans", "memory_traces", "memory_recall_events", "memory_edges", "atom_relations", "item_access",
    "assertions", "beliefs", "story_spine_nodes", "story_spine_support", "story_spine_sources",
    "relationship_baselines", "relationship_events", "relationship_projections", "physical_intimacy_milestones",
    "social_knowledge_events", "entity_scene_presence", "entity_prominence", "promises", "promise_events",
    "embedding_blocks", "embedding_items", "translation_cache",
  ]);
  const selected: Record<string, Row[]> = {};
  for (const [table, rows] of Object.entries(tables)) if (transplantTables.has(table)) {
    selected[table] = rows.filter((row) => row.chat_id === sourceChatId);
  }
  selected.extraction_batches = (selected.extraction_batches ?? []).filter((row) => row.generation_id === 'active' && row.status === 'applied');
  const extractionBatchIds = new Set(selected.extraction_batches.map((row) => String(row.id)));
  const detailIds = new Set((selected.memory_details ?? []).map((row) => String(row.id)));
  selected.atom_relations = (selected.atom_relations ?? []).filter((row) => row.active === 1
    && detailIds.has(String(row.source_detail_id)) && detailIds.has(String(row.target_detail_id))
    && (row.source_batch_id == null || extractionBatchIds.has(String(row.source_batch_id))));
  const relationIds = new Set(selected.atom_relations.map((row) => String(row.id)));
  selected.item_access = (selected.item_access ?? []).filter((row) => row.item_kind !== "atom_relation" || relationIds.has(String(row.item_id)));
  // Draft jobs are not transplanted; only explicitly applied group links travel.
  selected.episodes = (selected.episodes ?? []).filter((row) => row.resolution !== 'group' || row.status === 'capsuled');
  const episodeIds = new Set(selected.episodes.map((row) => row.id));
  for (const table of ['episode_messages', 'episode_sections']) selected[table] = (selected[table] ?? []).filter((row) => episodeIds.has(row.episode_id));
  selected.entities ??= [];
  const entityIds = new Set(selected.entities.map((row) => String(row.id)));
  selected.aliases = (tables.aliases ?? []).filter((row) => entityIds.has(String(row.entity_id)));
  const memoryIds = new Set((selected.memories ?? []).map((row) => String(row.id)));
  selected.memory_traces = (tables.memory_traces ?? []).filter((row) => memoryIds.has(String(row.memory_id)));
  const nodeIds = new Set((selected.story_spine_nodes ?? []).map((row) => String(row.id)));
  selected.story_spine_support = (tables.story_spine_support ?? []).filter((row) => nodeIds.has(String(row.node_id)));
  selected.story_spine_sources = (tables.story_spine_sources ?? []).filter((row) => nodeIds.has(String(row.node_id)));
  const ids = new Map<string, string>();
  for (const rows of Object.values(selected)) for (const row of rows) if (typeof row.id === "string") ids.set(row.id, randomUUID());
  for (const row of selected.messages ?? []) ids.set(String(row.message_id), `archive:${randomUUID()}`);
  // Vector items use the same typed identifier as Story support. Only SQLite
  // rowids are newly allocated; never replace a semantic ID with a vector UUID.
  const vectorIds = new Map((selected.embedding_items ?? []).map(row => [String(row.item_id), rewriteIdentifier(String(row.item_id), ids)]));
  const metadata = (key: string): string | undefined => (tables.server_meta ?? []).find(row => row.key === key)?.value as string | undefined;
  const deletions: Deletion[] = JSON.parse(metadata(userDeletionsKey(sourceChatId)) ?? "[]");
  const origins: Record<string, Deletion> = JSON.parse(metadata(ledgerEditOriginsKey(sourceChatId)) ?? "{}");
  const aliasRemovals: RemovedAliases = JSON.parse(metadata(removedAliasesKey(sourceChatId)) ?? "{}");
  const detailAccessEdits: Record<string, string[]> = JSON.parse(metadata(detailAccessEditsKey(sourceChatId)) ?? "{}");
  for (const id of Object.keys(aliasRemovals)) if (!ids.has(id)) ids.set(id, randomUUID());
  // A deleted entity has no row in selected.entities, but its UUID still owns
  // the tombstone and must belong to the destination's identifier namespace.
  for (const entry of deletions) if (entry.entityId && !ids.has(entry.entityId)) ids.set(entry.entityId, randomUUID());
  const rewriteDeletion = (entry: Deletion): Deletion => ({ ...entry,
    messageIds: entry.messageIds.map(id => rewriteIdentifier(id, ids)),
    ...(entry.entityId ? { entityId: rewriteIdentifier(entry.entityId, ids) } : {}),
    ...(entry.sourceBatchId ? { sourceBatchId: rewriteIdentifier(entry.sourceBatchId, ids) } : {}),
    identities: entry.identities.map(identity => {
      if (entry.kind === "entity") return rewriteIdentifier(identity, ids);
      try { return JSON.stringify(rewriteJson(JSON.parse(identity), ids)); } catch { return rewriteIdentifier(identity, ids); }
    }),
  });
  const instanceId = String((db.prepare("SELECT value FROM server_meta WHERE key='instance_id'").get() as { value?: string } | undefined)?.value ?? "");
  const remapped: Record<string, Row[]> = {};
  // Source revisions belong to another chat clock. Archive history is ordered
  // strictly before destination events while preserving its internal sequence.
  const promiseHistory = [...(selected.promise_events ?? [])].sort((a,b)=>Number(a.created_revision)-Number(b.created_revision) || Number(a.created_at)-Number(b.created_at));
  const promiseRevisions = new Map(promiseHistory.map((row,index)=>[row.id,index-promiseHistory.length]));
  for (const [table, rows] of Object.entries(selected)) remapped[table] = rows.map((row) => {
    const next: Row = {};
    for (const [column, value] of Object.entries(row)) {
      if (table === "embedding_items" && column === "rowid") continue;
      if (column === "chat_id" || column === "child_chat_id") next[column] = targetChatId;
      else if (column.endsWith("_json") && typeof value === "string") {
        try { next[column] = JSON.stringify(rewriteJson(JSON.parse(value), ids)); } catch { next[column] = value; }
      } else if (archiveCoordinateFields.has(column) || (column === "ordinal" && ["messages", "episode_messages"].includes(table))) {
        next[column] = archiveCoordinate(value);
      } else next[column] = typeof value === "string" ? rewriteIdentifier(value, ids) : value;
    }
    if (table === "messages") {
      next.source_kind = "archive";
      next.lifecycle = "committed";
      next.host_visibility = "active";
      next.visible = 1;
      next.extraction_state = "done";
    }
    if (table === 'extraction_batches') {
      next.job_id = null;
    }
    if (table === "message_revisions") next.lifecycle = "committed";
    if (table === "promise_events") next.created_revision = promiseRevisions.get(row.id)!;
    if (table === "translation_cache") {
      next.server_instance_id = instanceId;
      next.chat_id = targetChatId;
      next.cache_key = translationCacheKey({ serverInstanceId: instanceId, chatId: targetChatId, kind: String(next.item_kind), itemId: String(next.item_id),
        sourceHash: String(next.source_hash), provider: String(next.provider), sourceLanguage: String(next.source_language), targetLanguage: String(next.target_language) });
    }
    return next;
  });
  let vectorsRestored = 0;
  db.pragma("defer_foreign_keys = ON");
  db.transaction(() => {
    const vectorRows = db.prepare("SELECT rowid FROM embedding_items WHERE chat_id=?").all(targetChatId) as Array<{ rowid: number }>;
    if (vectorRows.length) {
      try { db.prepare(`DELETE FROM embedding_vectors_v4_chat WHERE rowid IN (${vectorRows.map(() => "?").join(",")})`).run(...vectorRows.map((row) => BigInt(row.rowid))); } catch { /* sqlite-vec is optional */ }
    }
    deleteDerivedRows(db, targetChatId);
    for (const [key, value] of [
      [userDeletionsKey(targetChatId), JSON.stringify([...readUserDeletions(db, targetChatId), ...deletions.map(rewriteDeletion)])],
      [ledgerEditOriginsKey(targetChatId), JSON.stringify(Object.fromEntries(Object.entries(origins).map(([id, entry]) => [rewriteIdentifier(id, ids), rewriteDeletion(entry)])))],
      [removedAliasesKey(targetChatId), JSON.stringify({ ...readRemovedAliases(db, targetChatId), ...Object.fromEntries(Object.entries(aliasRemovals).map(([id, terms]) => [rewriteIdentifier(id, ids), terms])) })],
      [detailAccessEditsKey(targetChatId), JSON.stringify(Object.fromEntries(Object.entries(detailAccessEdits)
        .filter(([id]) => [...(selected.memory_details ?? []), ...(selected.memory_dialogues ?? [])].some(row => row.id === id)).map(([id, holders]) => [rewriteIdentifier(id, ids), holders])))],
    ]) db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
    db.prepare("DELETE FROM messages WHERE chat_id=? AND source_kind='archive'").run(targetChatId);
    for (const table of insertionOrder) if (transplantTables.has(table)) insertRows(db, table, remapped[table] ?? []);
    for (const row of remapped.extraction_batches ?? []) {
      const ids = JSON.parse(String(row.source_message_ids_json)) as string[];
      db.prepare("UPDATE extraction_batches SET source_fingerprint_json=? WHERE id=?").run(JSON.stringify(sourceFingerprint(db, targetChatId, ids)), row.id);
    }
    bindInheritedMemoryGroups(db, targetChatId);
    db.prepare("UPDATE messages SET extraction_state='pending' WHERE chat_id=? AND source_kind<>'archive' AND lifecycle='committed'").run(targetChatId);
    vectorsRestored = restoreVectors(db, parsed.files, vectorIds);
    rebuildSearch(db);
    pruneTranslationCache(db);
  })();
  return { memories: remapped.memories?.length ?? 0, vectorsRestored };
}
