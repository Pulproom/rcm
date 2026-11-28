import type { RcmDatabase } from "./db.js";
import type { ExtractionResult, ItemAccessBasis, MemoryDetailAccess, MemoryContextItem, McpQuestionAnswer } from "@rcm/shared";
import { inspectSourceReferences, NARRATOR_ARCHIVE_HOLDER, plotKnowers } from "@rcm/shared";
import { UNCORRECTED_SQL } from "./user-corrections.js";
import { readStorySeed, accessibleStorySeed } from "./story-seeds.js";

export const EVERYONE_HOLDER = "__everyone__";
export const PENDING_ACCESS_HOLDER = "__pending_access__";
export { NARRATOR_ARCHIVE_HOLDER } from "@rcm/shared";

/** Internal grants are never character names in public payloads. */
export function publicKnowledgeScope(holders: string[], everyone = false): { knownBy: string[]; knownByEveryone: boolean } {
  const knownByEveryone = everyone || holders.includes(EVERYONE_HOLDER);
  return { knownBy: knownByEveryone ? [] : holders.filter(holder => holder !== NARRATOR_ARCHIVE_HOLDER && holder !== PENDING_ACCESS_HOLDER), knownByEveryone };
}

/** Resolve every stored exception, including hidden/non-selected children, before
 * reading plot knowledge. A retrieved subset cannot establish whole-plot access. */
export function loadPlotKnowers(db: RcmDatabase, chatId: string, memories: readonly {
  id: string; card_shape: 0 | 1; known_by_json: string;
}[]): Map<string, string[]> {
  const authors = memories.filter(memory => memory.card_shape === 1);
  if (!authors.length) return new Map();
  const details = db.prepare(`SELECT id,memory_id,hidden_from_json FROM memory_details
    WHERE chat_id=? AND active=1 AND memory_id IN (SELECT value FROM json_each(?))`)
    .all(chatId, JSON.stringify(authors.map(memory => memory.id))) as Array<{id:string;memory_id:string;hidden_from_json:string}>;
  const access = loadItemAccessScopes(db, chatId, details.map(detail => ({kind:"detail",id:detail.id})));
  const byMemory = new Map<string, Array<{knownBy:string[];knownByEveryone:boolean;hiddenFrom:string[]}>>();
  for (const detail of details) {
    const entries = byMemory.get(detail.memory_id) ?? [];
    entries.push({...publicKnowledgeScope(itemAccessKnowledge(storedItemAccessScope(access,"detail",detail.id))),
      hiddenFrom:JSON.parse(detail.hidden_from_json)});
    byMemory.set(detail.memory_id, entries);
  }
  return new Map(authors.map(memory => [memory.id, plotKnowers({cardShape:1,knownBy:JSON.parse(memory.known_by_json),details:byMemory.get(memory.id)})]));
}

export function publicMcpAnswers(answers: McpQuestionAnswer[]): McpQuestionAnswer[] {
  const evidence = (items: McpQuestionAnswer["evidence"]) => items.map(item => item.knownBy
    ? { ...item, ...publicKnowledgeScope(item.knownBy, item.knownByEveryone) } : item);
  return answers.map(answer => ({ ...answer, evidence: evidence(answer.evidence),
    ...(answer.alreadyProvidedEvidence ? { alreadyProvidedEvidence: evidence(answer.alreadyProvidedEvidence) } : {}) }));
}

export function publicMemoryContext(item: MemoryContextItem): MemoryContextItem {
  return { ...item, ...publicKnowledgeScope(item.knownBy, item.knownByEveryone),
    details: item.details.map(({seed: _seed, ...detail}) => ({ ...detail, ...publicKnowledgeScope(detail.knownBy, detail.knownByEveryone) })),
    keyDialogues: item.keyDialogues.map(dialogue => ({ ...dialogue, ...publicKnowledgeScope(dialogue.knownBy, dialogue.knownByEveryone) })),
  };
}

// User-selected item scope survives source invalidation; valid re-extraction renews its evidence.
// Basis stays on item_access, including inactive rows, rather than duplicating provenance in metadata.
// This never freezes detail content.
export const detailAccessEditsKey = (chatId: string): string => `detail_access_edits:${chatId}`;
export function readDetailAccessEdits(db: RcmDatabase, chatId: string): Map<string, string[]> {
  const row = db.prepare("SELECT value FROM server_meta WHERE key=?").get(detailAccessEditsKey(chatId)) as { value: string } | undefined;
  return new Map(Object.entries(row ? JSON.parse(row.value) : {}));
}
export function writeDetailAccessEdits(db: RcmDatabase, chatId: string, ids: ReadonlyMap<string, string[]>): void {
  if (!ids.size) db.prepare("DELETE FROM server_meta WHERE key=?").run(detailAccessEditsKey(chatId));
  else db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(detailAccessEditsKey(chatId), JSON.stringify(Object.fromEntries(ids)));
}
// A revised source removes dialogue rows immediately. Keep only edited atom identities
// until re-extraction can match the exact utterance; these never grant retrieval access.
export const dialogueAccessIdentityKey = (chatId: string): string => `dialogue_access_identity:${chatId}`;
export type DialogueAccessIdentity = { memoryId: string; speaker: string; text: string; messageId: string };
export function readDialogueAccessIdentities(db: RcmDatabase, chatId: string): Map<string, DialogueAccessIdentity> {
  const row = db.prepare("SELECT value FROM server_meta WHERE key=?").get(dialogueAccessIdentityKey(chatId)) as { value: string } | undefined;
  return new Map(Object.entries(row ? JSON.parse(row.value) : {}));
}
export function writeDialogueAccessIdentities(db: RcmDatabase, chatId: string, identities: ReadonlyMap<string, DialogueAccessIdentity>): void {
  if (!identities.size) db.prepare("DELETE FROM server_meta WHERE key=?").run(dialogueAccessIdentityKey(chatId));
  else db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(dialogueAccessIdentityKey(chatId), JSON.stringify(Object.fromEntries(identities)));
}
export function pruneDetailAccessEdits(db: RcmDatabase, chatId: string): void {
  const ids = readDetailAccessEdits(db, chatId);
  const identities = readDialogueAccessIdentities(db, chatId);
  for (const [id, item] of identities) if (!ids.has(id) || !db.prepare("SELECT 1 FROM memories WHERE chat_id=? AND id=?").get(chatId, item.memoryId)) identities.delete(id);
  writeDialogueAccessIdentities(db, chatId, identities);
  const exists = db.prepare("SELECT 1 FROM (SELECT chat_id,id FROM memory_details UNION ALL SELECT chat_id,id FROM memory_dialogues UNION ALL SELECT chat_id,id FROM memories UNION ALL SELECT chat_id,id FROM promises UNION ALL SELECT chat_id,id FROM physical_intimacy_milestones) WHERE chat_id=? AND id=?");
  for (const id of ids.keys()) if (!exists.get(chatId, id) && !identities.has(id)) ids.delete(id);
  writeDetailAccessEdits(db, chatId, ids);
  for (const [kind, table] of [["memory", "memories"], ["promise", "promises"], ["promise_event", "promise_events"], ["physical_milestone", "physical_intimacy_milestones"]])
    db.prepare(`DELETE FROM item_access WHERE chat_id=? AND item_kind=?
      AND NOT EXISTS(SELECT 1 FROM ${table} item WHERE item.chat_id=item_access.chat_id AND item.id=item_access.item_id)`).run(chatId,kind);
  db.prepare(`DELETE FROM item_access WHERE chat_id=? AND item_kind='detail'
    AND NOT EXISTS(SELECT 1 FROM memory_details d WHERE d.chat_id=item_access.chat_id AND d.id=item_access.item_id)`).run(chatId);
  db.prepare(`DELETE FROM item_access WHERE chat_id=? AND item_kind='dialogue' AND item_id NOT IN (SELECT value FROM json_each(?))
    AND NOT EXISTS(SELECT 1 FROM memory_dialogues d WHERE d.chat_id=item_access.chat_id AND d.id=item_access.item_id)`).run(chatId, JSON.stringify([...identities.keys()]));
}

/** Active grants own atom/lane access; memory headers use their stored canonical known_by_json before the first edit. */
export function memoryDetailAccess(db: RcmDatabase, chatId: string, id: string, kind: ItemAccessKind = "detail", reads?:ItemAccessReadContext): MemoryDetailAccess {
  const linked=kind === 'promise' ? promiseLinkedSupport(db,chatId,id,undefined,reads) : undefined;
  if (linked) {
    const scope=publicKnowledgeScope(linked.holders);
    const grants=db.prepare("SELECT holder,basis FROM item_access WHERE chat_id=? AND item_kind='detail' AND active=1 AND item_id IN (SELECT value FROM json_each(?))")
      .all(chatId,JSON.stringify(linked.ids)) as Array<{holder:string;basis:ItemAccessBasis}>;
    return {everyone:scope.knownByEveryone,narratorOnly:linked.holders.includes(NARRATOR_ARCHIVE_HOLDER),holders:scope.knownBy.map(name=>{
      const bases=[...new Set(grants.filter(grant=>normalized(grant.holder)===normalized(name)).map(grant=>grant.basis))];
      // A conjunction has no single basis when its supports differ. Do not invent one.
      return {name,...(bases.length===1 ? {basis:bases[0]} : {})};
    })};
  }
  const rows = db.prepare("SELECT holder,basis FROM item_access WHERE chat_id=? AND item_kind=? AND item_id=? AND active=1")
    .all(chatId, kind, id) as Array<{ holder: string; basis: ItemAccessBasis }>;
  const memory = kind === "memory" ? db.prepare("SELECT known_by_json FROM memories WHERE chat_id=? AND id=?").get(chatId,id) as {known_by_json:string}|undefined : undefined;
  const fallback: string[] = memory ? JSON.parse(memory.known_by_json) : [];
  // Memory headers already own a valid stored scope, including explicit narrator-only [].
  const scope = resolveItemAccess(new Map(rows.length ? [[key(kind, id), rows.map(row => row.holder)]] : []), kind, id, memory && !fallback.length ? [NARRATOR_ARCHIVE_HOLDER] : fallback);
  return { holders: scope.holders.map(name => ({ name, basis: rows.find(row => row.holder === name)?.basis ?? "witnessed" })), narratorOnly: scope.narratorOnly && !scope.pending, everyone: scope.everyone === true };
}

export function syncDetailKnownBy(db: RcmDatabase, chatId: string, id: string): void {
  const { holders, everyone } = memoryDetailAccess(db, chatId, id);
  const knownBy=everyone ? [EVERYONE_HOLDER] : holders.map(holder => holder.name);
  const row=db.prepare("SELECT seed_json FROM memory_details WHERE chat_id=? AND id=?").get(chatId,id) as {seed_json:string|null}|undefined;
  const seed=readStorySeed(row?.seed_json);
  db.prepare("UPDATE memory_details SET known_by_json=?,seed_json=? WHERE chat_id=? AND id=?")
    .run(JSON.stringify(knownBy), seed ? JSON.stringify({...seed,noticedBy:accessibleStorySeed(seed,knownBy)!.noticedBy}) : null, chatId, id);
}

/** Presentation only. Raw holder names remain the authority for access checks. */
export function knownByLabels(db: RcmDatabase, chatId: string, kind: ItemAccessKind, id: string, holders: string[], reads?:ItemAccessReadContext): string[] {
  const linked=kind==='promise' ? promiseLinkedSupport(db,chatId,id,undefined,reads) : undefined;
  const rows=linked ? memoryDetailAccess(db,chatId,id,kind,reads).holders.map(item=>({holder:item.name,basis:item.basis}))
    : db.prepare("SELECT holder,basis FROM item_access WHERE chat_id=? AND item_kind=? AND item_id=? AND active=1").all(chatId,kind,id) as Array<{holder:string;basis?:string}>;
  return formatKnownByLabels(holders,rows);
}

/** Batch presentation grants for a retrieval snapshot; linked promises retain
 * their canonical contribution projection in knownByLabels. */
export function loadKnownByLabels(db:RcmDatabase,chatId:string,items:Array<{kind:ItemAccessKind;id:string}>, reads?:ItemAccessReadContext) {
  const byItem=new Map<string,Array<{holder:string;basis?:string}>>();
  for (const rows of readItemAccessBatches(db,chatId,items)) for (const row of rows) {
    const itemKey=key(row.item_kind,row.item_id), entries=byItem.get(itemKey) ?? [];
    entries.push(row); byItem.set(itemKey,entries);
  }
  return (kind:ItemAccessKind,id:string,holders:string[]) => kind==='promise' && promiseLinkedSupport(db,chatId,id,undefined,reads) ? knownByLabels(db,chatId,kind,id,holders,reads)
    : formatKnownByLabels(holders,byItem.get(key(kind,id)) ?? []);
}

function formatKnownByLabels(holders:string[],rows:Array<{holder:string;basis?:string}>):string[] {
  const annotations:Record<string,string>={told:"was told",heard:"indirect report or rumor",inferred:"a guess"};
  if (holders.includes(EVERYONE_HOLDER) || rows.some(row => row.holder === EVERYONE_HOLDER)) return ["everyone"];
  return holders.map(holder=>{
    const basis=rows.find(row=>normalized(row.holder)===normalized(holder))?.basis;
    return basis && annotations[basis] ? `${holder} (${annotations[basis]})` : holder;
  });
}

export type ItemAccessKind = "memory" | "detail" | "dialogue" | "promise" | "promise_event" | "physical_milestone" | "atom_relation" | "assertion" | "belief";

/** User corrections keep a source-independent knowledge baseline, alongside the
 * original detail references. A missing/revoked scope must never become public. */
export function snapshotKnowledgeGrants(db: RcmDatabase, chatId: string, kind: ItemAccessKind, id: string,
  support?: { holders: string[]; ids: string[] }) {
  const rows = db.prepare(`SELECT holder,basis,evidence_json,confidence FROM item_access
    WHERE chat_id=? AND active=1 AND ${support ? "item_kind='detail' AND item_id IN (SELECT value FROM json_each(?))" : "item_kind=? AND item_id=?"}`)
    .all(chatId, ...(support ? [JSON.stringify(support.ids)] : [kind, id])) as Array<{holder:string;basis:string;evidence_json:string;confidence:number}>;
  if (!support) {
    if (rows.length) return rows.map(({evidence_json,...grant}) => ({...grant,evidence:JSON.parse(evidence_json) as Array<{messageId:string;quote?:string}>}));
    if (!db.prepare('SELECT 1 FROM item_access WHERE chat_id=? AND item_kind=? AND item_id=?').get(chatId,kind,id)) return [];
  }
  return (support?.holders.length ? support.holders : [PENDING_ACCESS_HOLDER]).map(holder => {
    const grants=rows.filter(row=>normalized(row.holder)===normalized(holder));
    const bases=[...new Set(grants.map(grant=>grant.basis))];
    return {holder,basis:bases.length===1 ? bases[0]! : 'internal',evidence:[],confidence:grants.length ? Math.min(...grants.map(grant=>grant.confidence)) : 1};
  });
}

/** Presentation provenance of the latest user-authored promise baseline. */
export function correctedPromiseDetailIds(db: RcmDatabase, chatId: string, promiseId: string): string[] | undefined {
  const row=db.prepare(`SELECT linked_detail_ids_json FROM promise_events WHERE chat_id=? AND promise_id=? AND user_authored=1
    ORDER BY created_revision DESC,created_at DESC,rowid DESC LIMIT 1`).get(chatId,promiseId) as {linked_detail_ids_json:string|null}|undefined;
  return row?.linked_detail_ids_json == null ? undefined : JSON.parse(row.linked_detail_ids_json);
}

export interface ItemAccessScope {
  explicit: boolean;
  everyone?: boolean;
  narratorOnly: boolean;
  pending?: boolean;
  holders: string[];
}

const key = (kind: ItemAccessKind, id: string): string => `${kind}:${id}`;
const normalized = (value: string): string => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

export interface ItemAccessRow { item_kind: ItemAccessKind; item_id: string; holder: string; basis: ItemAccessBasis; evidence_json: string }

/** Keep kind and ID as index constraints; a long OR across pairs scans every
 * access row in the chat. Yield bounded batches so evidence validation can
 * remain the caller's responsibility. */
export function* readItemAccessBatches(db: RcmDatabase, chatId: string,
  items: Array<{ kind: ItemAccessKind; id: string }>): Generator<ItemAccessRow[]> {
  const byKind = new Map<ItemAccessKind, Set<string>>();
  for (const item of items) {
    const ids = byKind.get(item.kind) ?? new Set<string>();
    ids.add(item.id);
    byKind.set(item.kind, ids);
  }
  for (const [kind, ids] of byKind) {
    const unique = [...ids];
    for (let offset = 0; offset < unique.length; offset += 300) {
      const batch = unique.slice(offset, offset + 300);
      yield db.prepare(`SELECT item_kind,item_id,holder,basis,evidence_json FROM item_access
        WHERE chat_id=? AND item_kind=? AND item_id IN (${batch.map(() => "?").join(",")}) AND active=1`)
        .all(chatId, kind, ...batch) as ItemAccessRow[];
    }
  }
}

export function loadItemAccess(
  db: RcmDatabase,
  chatId: string,
  items: Array<{ kind: ItemAccessKind; id: string }>,
  reads?:ItemAccessReadContext,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const rows of readItemAccessBatches(db, chatId, items)) {
    for (const row of rows) {
      const itemKey = key(row.item_kind, row.item_id);
      result.set(itemKey, [...(result.get(itemKey) ?? []), row.holder]);
    }
  }
  for (const item of items) if (item.kind === 'promise') {
    const linked=promiseLinkedSupport(db,chatId,item.id,undefined,reads);
    if (linked) result.set(key(item.kind,item.id),linked.holders.length ? linked.holders : [PENDING_ACCESS_HOLDER]);
  }
  return result;
}

/** Resolve stored grants while preserving the distinction between no grant
 * rows and rows whose grants were all revoked. Callers that have a legacy
 * fallback must not revive it after an explicit grant has existed. */
export function loadItemAccessScopes(
  db: RcmDatabase,
  chatId: string,
  items: Array<{ kind: ItemAccessKind; id: string }>,
  reads?:ItemAccessReadContext,
): Map<string, ItemAccessScope> {
  const result = new Map<string, ItemAccessScope>();
  const byKind = new Map<ItemAccessKind, Set<string>>();
  for (const item of items) {
    const ids = byKind.get(item.kind) ?? new Set<string>();
    ids.add(item.id);
    byKind.set(item.kind, ids);
  }
  for (const [kind, ids] of byKind) {
    const unique = [...ids];
    for (let offset = 0; offset < unique.length; offset += 300) {
      const batch = unique.slice(offset, offset + 300);
      const rows = db.prepare(`SELECT item_id,holder,active FROM item_access
        WHERE chat_id=? AND item_kind=? AND item_id IN (${batch.map(() => "?").join(",")})`)
        .all(chatId, kind, ...batch) as Array<{ item_id: string; holder: string; active: number }>;
      for (const row of rows) {
        const itemKey = key(kind, row.item_id);
        const scope = result.get(itemKey) ?? { explicit: true, narratorOnly: false, pending: false, holders: [] };
        if (row.active === 1 && row.holder === PENDING_ACCESS_HOLDER) scope.pending = true;
        if (row.active === 1 && row.holder === NARRATOR_ARCHIVE_HOLDER) scope.narratorOnly = true;
        if (row.active === 1 && row.holder === EVERYONE_HOLDER) scope.everyone = true;
        if (row.active === 1 && row.holder !== EVERYONE_HOLDER && row.holder !== NARRATOR_ARCHIVE_HOLDER && row.holder !== PENDING_ACCESS_HOLDER && !scope.holders.includes(row.holder)) scope.holders.push(row.holder);
        result.set(itemKey, scope);
      }
    }
  }
  for (const item of items) if (item.kind === 'promise') {
    const linked=promiseLinkedSupport(db,chatId,item.id,undefined,reads);
    if (linked) result.set(key(item.kind,item.id),{...resolveItemAccess(new Map([[key(item.kind,item.id),linked.holders.length ? linked.holders : [PENDING_ACCESS_HOLDER]]]),item.kind,item.id),explicit:true});
  }
  return result;
}

export function storedItemAccessScope(
  scopes: Map<string, ItemAccessScope>,
  kind: ItemAccessKind,
  id: string,
  fallback: string[] = [],
): ItemAccessScope {
  return scopes.get(key(kind, id)) ?? resolveItemAccess(new Map(), kind, id, fallback);
}

export function resolveItemAccess(
  access: Map<string, string[]>,
  kind: ItemAccessKind,
  id: string,
  fallback: string[] = [],
): ItemAccessScope {
  const rows = access.get(key(kind, id));
  const grants = rows ?? fallback;
  const everyone = grants.includes(EVERYONE_HOLDER);
  const holders = [...new Set(grants.filter(holder => holder !== NARRATOR_ARCHIVE_HOLDER && holder !== PENDING_ACCESS_HOLDER && holder !== EVERYONE_HOLDER))];
  return { explicit: !!rows, narratorOnly: grants.includes(NARRATOR_ARCHIVE_HOLDER), pending: grants.includes(PENDING_ACCESS_HOLDER), everyone, holders };
}

/** Internal knowledge sets retain the universal grant; scope APIs expose a flag. */
export function intersectAccessKnowledge(left: string[], right: string[]): string[] {
  if (left.includes(EVERYONE_HOLDER)) return right;
  if (right.includes(EVERYONE_HOLDER)) return left;
  return left.filter(holder => right.some(other => normalized(holder) === normalized(other)));
}

export function validItemAccessScope(scope: ItemAccessScope): boolean {
  return !scope.pending && Boolean(scope.everyone || scope.narratorOnly || scope.holders.length);
}

export function itemAccessKnowledge(scope: ItemAccessScope): string[] {
  if (scope.pending) return [];
  return scope.everyone ? [EVERYONE_HOLDER] : scope.holders;
}

export function visibleTo(scope: ItemAccessScope, viewer: string, archive = false): boolean {
  if (scope.pending) return false;
  if (archive || scope.everyone) return true;
  if (scope.narratorOnly) return false;
  return scope.holders.some((holder) => normalized(holder) === normalized(viewer));
}

export function deactivateItemAccess(db: RcmDatabase, chatId: string, kind: ItemAccessKind, ids: string[]): void {
  if (!ids.length) return;
  for (let offset = 0; offset < ids.length; offset += 400) {
    const batch = ids.slice(offset, offset + 400);
    db.prepare(`UPDATE item_access SET active=0 WHERE chat_id=? AND item_kind=? AND item_id IN (${batch.map(() => "?").join(",")})`)
      .run(chatId, kind, ...batch);
  }
}

export function deactivateItemAccessByEvidence(db: RcmDatabase, chatId: string, messageIds: string[]): void {
  const unique = [...new Set(messageIds)];
  for (let offset = 0; offset < unique.length; offset += 300) {
    const batch = unique.slice(offset, offset + 300);
    if (!batch.length) continue;
    db.prepare(`UPDATE item_access SET active=0 WHERE chat_id=? AND active=1

      AND NOT (item_kind='promise' AND EXISTS(SELECT 1 FROM promises WHERE id=item_access.item_id AND chat_id=item_access.chat_id AND NOT (${UNCORRECTED_SQL})))
      AND NOT (item_kind='assertion' AND EXISTS(SELECT 1 FROM assertions WHERE id=item_access.item_id AND chat_id=item_access.chat_id AND NOT (${UNCORRECTED_SQL})))
      AND EXISTS(
      SELECT 1 FROM json_each(item_access.evidence_json)
      WHERE json_extract(value,'$.messageId') IN (${batch.map(() => "?").join(",")})
    )`).run(chatId, ...batch);
  }
}

/** Read snapshot owned by one state collection, never retained across requests. */
export interface ItemAccessReadContext {
  promises: Array<Record<string,any>>;
  promiseById: Map<string,Record<string,any>>;
  events: PromiseEventRow[];
  history: Map<string,PromiseEventRow[]>;
  linkedHistory: Set<string>;
  accessEdits: Map<string,string[]>;
  detailKnowledge: Map<string,string[] | undefined>;
  promiseSupport: Map<string,{holders:string[];ids:string[]} | undefined>;
  contributions: Map<string,{events:PromiseEventRow[];rebuilt?:Record<string,any>}>;
}

export function createItemAccessReadContext(db:RcmDatabase,chatId:string):ItemAccessReadContext {
  const promises=db.prepare("SELECT * FROM promises WHERE chat_id=? ORDER BY updated_revision DESC,id").all(chatId) as Array<Record<string,any>>;
  const events=db.prepare("SELECT * FROM promise_events WHERE chat_id=? ORDER BY source_ordinal,created_revision,created_at,rowid").all(chatId) as PromiseEventRow[];
  const history=new Map<string,PromiseEventRow[]>(),linkedHistory=new Set<string>();
  for (const event of events) {
    if (event.linked_detail_ids_json!=null) linkedHistory.add(event.promise_id);
    if (event.status==='invalidated') continue;
    const entries=history.get(event.promise_id) ?? []; entries.push(event);history.set(event.promise_id,entries);
  }
  return {promises,promiseById:new Map(promises.map(row=>[row.id,row])),events,history,linkedHistory,
    accessEdits:readDetailAccessEdits(db,chatId),detailKnowledge:new Map(),promiseSupport:new Map(),contributions:new Map()};
}

function readCached<T>(cache:Map<string,T>|undefined,key:string,read:()=>T):T {
  if (!cache) return read();
  if (!cache.has(key)) cache.set(key,read());
  return cache.get(key)!;
}

/** Canonical detail access, never the holder strings supplied to the model.
 * Missing/hidden/revised support is invalid; an empty intersection is narrator-only. */
export function linkedDetailKnowledge(db: RcmDatabase, chatId: string, detailIds: readonly string[], reads?:ItemAccessReadContext): string[] | undefined {
  return readCached(reads?.detailKnowledge,JSON.stringify(detailIds),()=>{
  if (!detailIds.length) return undefined;
  const scopes = loadItemAccessScopes(db, chatId, detailIds.map(id => ({kind:'detail', id})));
  let common: string[] | undefined;
  for (const id of detailIds) {
    const detail = db.prepare(`SELECT d.evidence_json FROM visible_memory_details d JOIN memories m ON m.id=d.memory_id
      WHERE d.id=? AND d.chat_id=? AND d.active=1 AND m.active=1`).get(id, chatId) as {evidence_json:string}|undefined;
    if (!detail) return undefined;
    const evidence = JSON.parse(detail.evidence_json);
    const access = (db.prepare("SELECT evidence_json FROM item_access WHERE chat_id=? AND item_kind='detail' AND item_id=? AND active=1").all(chatId,id) as {evidence_json:string}[])
      .map(grant => ({evidence:JSON.parse(grant.evidence_json)}));
    const sourceIds = [...new Set([...evidence,...access.flatMap(grant => grant.evidence)].map(citation => citation.messageId))];
    const sources = db.prepare(`SELECT message_id AS id,canonical_content AS content,canonical_hash AS canonicalHash FROM json_each(?) requested
      CROSS JOIN messages ON messages.chat_id=? AND messages.message_id=requested.value
      WHERE memory_excluded=0 AND canonical_content IS NOT NULL AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`).all(JSON.stringify(sourceIds),chatId) as Array<{id:string;content:string;canonicalHash:string}>;
    const hashes = new Map(sources.map(source => [source.id,source.canonicalHash]));
    if ([...evidence,...access.flatMap(grant => grant.evidence)].some(citation => citation.canonicalHash && hashes.get(citation.messageId) !== citation.canonicalHash
      || citation.transitionCanonicalHash && hashes.get(citation.messageId) !== citation.transitionCanonicalHash)) return undefined;
    if (inspectSourceReferences({evidence,access},sources).some(issue => issue.blocking)) return undefined;
    const scope = storedItemAccessScope(scopes, 'detail', id);
    if (!scope.explicit || !validItemAccessScope(scope)) return undefined;
    const holders = itemAccessKnowledge(scope);
    common = common === undefined ? holders : intersectAccessKnowledge(common, holders);
  }
  return common?.length ? common : [NARRATOR_ARCHIVE_HOLDER];
  });
}


// Stored reinforced events distinguish a full replacement from a legacy delta.
export const PROMISE_REWRITE_EVENT = 'reinforced_rewrite';

export function restorePromiseEventKind(kind: string | null) {
  if (kind === PROMISE_REWRITE_EVENT) return {event: 'reinforced' as const, rewritesContent: true as const};
  return { ...(kind ? {event: kind as ExtractionResult['promises'][number]['event']} : {}), rewritesContent: undefined };
}

type PromiseEventRow = {id:string;active:number;event_kind:string|null;amendment_text:string|null;linked_detail_ids_json:string|null;[key:string]:any};

function rebuiltPromiseSnapshots(events:PromiseEventRow[]): Record<string,any>[] {
  let content=events[0]!.content, scheduled=events[0]!.scheduled_for, memoryId:null|string=null, batchId:null|string=null;
  return events.map((event,index)=>{
    if (event.event_kind===PROMISE_REWRITE_EVENT) content=event.content;
    else if (index>0 && event.amendment_text) content+=`\n${event.amendment_text}`;
    if (event.scheduled_for_delta!=null) scheduled=event.scheduled_for_delta;
    if (event.source_memory_id!=null) memoryId=event.source_memory_id;
    if (event.source_batch_id!=null) batchId=event.source_batch_id;
    return {...event,content,scheduled_for:scheduled,source_memory_id:memoryId,source_batch_id:batchId};
  });
}

/** Text and scope always use the same structural contributors. NULL deltas
 * cannot reconstruct old cumulative snapshots, so retain their inactive support. */
export function promiseContributionState(db:RcmDatabase, chatId:string, promiseId:string, through?:string, reads?:ItemAccessReadContext): {events:PromiseEventRow[]; rebuilt?:Record<string,any>} {
  return readCached(reads?.contributions,JSON.stringify([promiseId,through]),()=>{
  const history=reads ? reads.history.get(promiseId) ?? [] : db.prepare("SELECT * FROM promise_events WHERE chat_id=? AND promise_id=? AND status<>'invalidated' ORDER BY source_ordinal,created_revision,created_at,rowid")
    .all(chatId,promiseId) as PromiseEventRow[];
  const prefix=through ? history.slice(0,history.findIndex(event=>event.id===through)+1) : history;
  let boundary=-1;
  for (let index=prefix.length-1;index>=0;index--) if (prefix[index]!.active===1 && prefix[index]!.event_kind==='established') { boundary=index; break; }
  const candidates=boundary<0 ? prefix : prefix.slice(boundary);
  if (boundary<0 || candidates.some(event=>event.amendment_text==null)) return {events:candidates};
  const events=candidates.filter(event=>event.active===1);
  return {events,rebuilt:rebuiltPromiseSnapshots(events).at(-1)!};
  });
}

export function promiseContributionChain(db:RcmDatabase, chatId:string, promiseId:string, through?:string): PromiseEventRow[] {
  return promiseContributionState(db,chatId,promiseId,through).events;
}

/** Preserve identity/user metadata; only the derived display snapshot changes. */
export function projectPromiseRow<T extends Record<string,any>>(db:RcmDatabase, chatId:string, row:T, through?:string, reads?:ItemAccessReadContext): T {
  const parent=through ? reads ? reads.promiseById.get(row.promise_id) : db.prepare('SELECT user_edit_ordinal FROM promises WHERE chat_id=? AND id=?').get(chatId,row.promise_id) as {user_edit_ordinal:number|null}|undefined : row;
  if (parent?.user_edit_ordinal!=null) return row;
  const rebuilt=promiseContributionState(db,chatId,through ? row.promise_id : row.id,through,reads).rebuilt;
  if (!rebuilt) return row;
  const fields=['content','status','scheduled_for','status_reason','source_memory_id','source_batch_id','ended_at_turn','recency_until_turn'];
  return {...row,...Object.fromEntries(fields.filter(field=>through || field!=='status').map(field=>[field,rebuilt[field]]))};
}

/** Refresh canonical caches at writes/invalidation so raw dashboard/ledger and
 * downstream calls agree with the pure projection, including historical prefixes. */
export function rebuildPromiseContent(db:RcmDatabase, chatId:string, promiseId:string): void {
  const parent=db.prepare('SELECT * FROM promises WHERE chat_id=? AND id=?').get(chatId,promiseId) as Record<string,any>|undefined;
  if (!parent || parent.user_edit_ordinal!=null) return;
  const state=promiseContributionState(db,chatId,promiseId);
  if (!state.rebuilt) return;
  const rebuilt=state.rebuilt;
  db.prepare('UPDATE promises SET content=?,status=?,scheduled_for=?,status_reason=?,source_memory_id=?,source_batch_id=?,ended_at_turn=?,recency_until_turn=? WHERE chat_id=? AND id=?')
    .run(rebuilt.content,rebuilt.status,rebuilt.scheduled_for,rebuilt.status_reason,rebuilt.source_memory_id,rebuilt.source_batch_id,rebuilt.ended_at_turn,rebuilt.recency_until_turn,chatId,promiseId);
  const update=db.prepare('UPDATE promise_events SET content=?,scheduled_for=? WHERE chat_id=? AND id=?');
  for (const snapshot of rebuiltPromiseSnapshots(state.events)) update.run(snapshot.content,snapshot.scheduled_for,chatId,snapshot.id);
}

/** A fresh baseline replaces earlier contributions. Legacy cumulative text
 * retains inactive support; reconstructed text uses only its active contributors. */
export function promiseLinkedSupport(db:RcmDatabase, chatId:string, promiseId:string, through?:string, reads?:ItemAccessReadContext): {holders:string[]; ids:string[]} | undefined {
  return readCached(reads?.promiseSupport,JSON.stringify([promiseId,through]),()=>{
  const row=reads ? reads.promiseById.get(promiseId) : db.prepare('SELECT user_edit_ordinal FROM promises WHERE chat_id=? AND id=?').get(chatId,promiseId) as {user_edit_ordinal:number|null}|undefined;
  if (!row || row.user_edit_ordinal != null || (reads?.accessEdits ?? readDetailAccessEdits(db,chatId)).has(promiseId)) return undefined;
  const state=promiseContributionState(db,chatId,promiseId,through,reads), prefix=state.events;
  const linkedHistory=reads ? reads.linkedHistory.has(promiseId) : !!db.prepare('SELECT 1 FROM promise_events WHERE chat_id=? AND promise_id=? AND linked_detail_ids_json IS NOT NULL').get(chatId,promiseId);
  // Pure R9 keeps its full-record explicit-access contract. Unknown inactive
  // legacy deltas still require conservative support rather than widening it.
  if (!linkedHistory && (state.rebuilt || !prefix.some(event=>event.active!==1))) return undefined;
  const scopes=loadItemAccessScopes(db,chatId,prefix.map(event=>({kind:'promise_event',id:event.id})));
  const ids=[...new Set<string>(prefix.flatMap(event=>event.linked_detail_ids_json == null ? [] : JSON.parse(event.linked_detail_ids_json)))];
  if (!prefix.some(event=>event.active===1)) return {holders:[],ids};
  const saved=(db.prepare("SELECT holder FROM item_access WHERE chat_id=? AND item_kind='promise' AND item_id=? AND active=1").all(chatId,promiseId) as {holder:string}[]).map(grant=>grant.holder);
  const savedScope=saved.length ? resolveItemAccess(new Map([[key('promise',promiseId),saved]]),'promise',promiseId) : undefined;
  let holders: string[] | undefined;
  for (const event of prefix) {
    const scope=scopes.get(key('promise_event',event.id)) ?? (event.active===1 ? savedScope : undefined);
    const support=event.linked_detail_ids_json != null ? linkedDetailKnowledge(db,chatId,JSON.parse(event.linked_detail_ids_json),reads)
      : scope && validItemAccessScope(scope) ? scope.narratorOnly ? [NARRATOR_ARCHIVE_HOLDER] : itemAccessKnowledge(scope) : undefined;
    if (!support) return {holders:[],ids};
    holders=holders === undefined ? support : intersectAccessKnowledge(holders,support);
  }
  // Pure R9 records still honor an explicit parent grant/revocation.
  if (!linkedHistory) {
    if (!savedScope || !validItemAccessScope(savedScope)) return {holders:[],ids};
    holders=intersectAccessKnowledge(holders ?? [],savedScope.narratorOnly ? [NARRATOR_ARCHIVE_HOLDER] : itemAccessKnowledge(savedScope));
  }
  return {holders:holders?.length ? holders : [NARRATOR_ARCHIVE_HOLDER],ids};
  });
}
