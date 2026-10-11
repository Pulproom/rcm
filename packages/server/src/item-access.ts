import type { RcmDatabase } from "./db.js";
import type { ItemAccessBasis, MemoryDetailAccess, MemoryContextItem, McpQuestionAnswer } from "@rcm/shared";
import { UNCORRECTED_SQL } from "./user-corrections.js";
import { readStorySeed, accessibleStorySeed } from "./story-seeds.js";

export const EVERYONE_HOLDER = "__everyone__";
export const NARRATOR_ARCHIVE_HOLDER = "__narrator_archive__";

/** Internal grants are never character names in public payloads. */
export function publicKnowledgeScope(holders: string[]): { knownBy: string[]; knownByEveryone: boolean } {
  const knownByEveryone = holders.includes(EVERYONE_HOLDER);
  return { knownBy: knownByEveryone ? [] : holders.filter(holder => holder !== NARRATOR_ARCHIVE_HOLDER), knownByEveryone };
}

export function publicMcpAnswers(answers: McpQuestionAnswer[]): McpQuestionAnswer[] {
  const evidence = (items: McpQuestionAnswer["evidence"]) => items.map(item => item.knownBy
    ? { ...item, ...publicKnowledgeScope(item.knownBy) } : item);
  return answers.map(answer => ({ ...answer, evidence: evidence(answer.evidence),
    ...(answer.alreadyProvidedEvidence ? { alreadyProvidedEvidence: evidence(answer.alreadyProvidedEvidence) } : {}) }));
}

export function publicMemoryContext(item: MemoryContextItem): MemoryContextItem {
  return { ...item, ...publicKnowledgeScope(item.knownBy),
    details: item.details.map(({seed: _seed, ...detail}) => ({ ...detail, ...publicKnowledgeScope(detail.knownBy) })),
    keyDialogues: item.keyDialogues.map(dialogue => ({ ...dialogue, ...publicKnowledgeScope(dialogue.knownBy) })),
  };
}

// User-selected scope survives source invalidation; valid re-extraction renews its evidence.
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
export function pruneDetailAccessEdits(db: RcmDatabase, chatId: string): void {
  const ids = readDetailAccessEdits(db, chatId);
  const exists = db.prepare("SELECT 1 FROM memory_details WHERE chat_id=? AND id=?");
  for (const id of ids.keys()) if (!exists.get(chatId, id)) ids.delete(id);
  writeDetailAccessEdits(db, chatId, ids);
  db.prepare(`DELETE FROM item_access WHERE chat_id=? AND item_kind='detail'
    AND NOT EXISTS(SELECT 1 FROM memory_details d WHERE d.chat_id=item_access.chat_id AND d.id=item_access.item_id)`).run(chatId);
}

/** Same active-grant resolver as retrieval; never infer grants from display knownBy. */
export function memoryDetailAccess(db: RcmDatabase, chatId: string, id: string): MemoryDetailAccess {
  const rows = db.prepare("SELECT holder,basis FROM item_access WHERE chat_id=? AND item_kind='detail' AND item_id=? AND active=1")
    .all(chatId, id) as Array<{ holder: string; basis: ItemAccessBasis }>;
  const scope = resolveItemAccess(new Map(rows.length ? [[key("detail", id), rows.map(row => row.holder)]] : []), "detail", id);
  return { holders: scope.holders.map(name => ({ name, basis: rows.find(row => row.holder === name)!.basis })), narratorOnly: !scope.everyone && scope.holders.length === 0, everyone: scope.everyone === true };
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
export function knownByLabels(db: RcmDatabase, chatId: string, kind: ItemAccessKind, id: string, holders: string[]): string[] {
  const rows=db.prepare("SELECT holder,basis FROM item_access WHERE chat_id=? AND item_kind=? AND item_id=? AND active=1").all(chatId,kind,id) as Array<{holder:string;basis:string}>;
  const annotations:Record<string,string>={told:"was told",heard:"heard from others",inferred:"a guess"};
  if (holders.includes(EVERYONE_HOLDER) || rows.some(row => row.holder === EVERYONE_HOLDER)) return ["everyone"];
  return holders.map(holder=>{
    const basis=rows.find(row=>normalized(row.holder)===normalized(holder))?.basis;
    return basis && annotations[basis] ? `${holder} (${annotations[basis]})` : holder;
  });
}

export type ItemAccessKind = "detail" | "dialogue" | "promise" | "physical_milestone" | "atom_relation" | "assertion";

export interface ItemAccessScope {
  explicit: boolean;
  everyone?: boolean;
  narratorOnly: boolean;
  holders: string[];
}

const key = (kind: ItemAccessKind, id: string): string => `${kind}:${id}`;
const normalized = (value: string): string => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

export interface ItemAccessRow { item_kind: ItemAccessKind; item_id: string; holder: string; evidence_json: string }

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
      yield db.prepare(`SELECT item_kind,item_id,holder,evidence_json FROM item_access
        WHERE chat_id=? AND item_kind=? AND item_id IN (${batch.map(() => "?").join(",")}) AND active=1`)
        .all(chatId, kind, ...batch) as ItemAccessRow[];
    }
  }
}

export function loadItemAccess(
  db: RcmDatabase,
  chatId: string,
  items: Array<{ kind: ItemAccessKind; id: string }>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const rows of readItemAccessBatches(db, chatId, items)) {
    for (const row of rows) {
      const itemKey = key(row.item_kind, row.item_id);
      result.set(itemKey, [...(result.get(itemKey) ?? []), row.holder]);
    }
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
        const scope = result.get(itemKey) ?? { explicit: true, narratorOnly: true, holders: [] };
        if (row.active === 1 && row.holder === EVERYONE_HOLDER) scope.everyone = true;
        if (row.active === 1 && row.holder !== EVERYONE_HOLDER && row.holder !== NARRATOR_ARCHIVE_HOLDER && !scope.holders.includes(row.holder)) scope.holders.push(row.holder);
        scope.narratorOnly = !scope.everyone && scope.holders.length === 0;
        result.set(itemKey, scope);
      }
    }
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
  const holders = [...new Set(grants.filter(holder => holder !== NARRATOR_ARCHIVE_HOLDER && holder !== EVERYONE_HOLDER))];
  return { explicit: !!rows, narratorOnly: !!rows && !everyone && holders.length === 0, everyone, holders };
}

/** Internal knowledge sets retain the universal grant; scope APIs expose a flag. */
export function intersectAccessKnowledge(left: string[], right: string[]): string[] {
  if (left.includes(EVERYONE_HOLDER)) return right;
  if (right.includes(EVERYONE_HOLDER)) return left;
  return left.filter(holder => right.some(other => normalized(holder) === normalized(other)));
}

export function itemAccessKnowledge(scope: ItemAccessScope): string[] {
  return scope.everyone ? [EVERYONE_HOLDER] : scope.holders;
}

export function visibleTo(scope: ItemAccessScope, viewer: string, archive = false): boolean {
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
