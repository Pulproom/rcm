import { classifyEntityType, normalizeEntityName, ReconciliationDecisionSchema } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { EVERYONE_HOLDER, NARRATOR_ARCHIVE_HOLDER, PENDING_ACCESS_HOLDER } from "./item-access.js";

const accessMarkers = new Set([EVERYONE_HOLDER, NARRATOR_ARCHIVE_HOLDER, PENDING_ACCESS_HOLDER]);

/** Person slots in canonical records, including history that can be restored. */
export function structuredEntityPersonReferences(db: RcmDatabase, chatId: string): Set<string> {
  const scalar: Array<[string, string[], string?]> = [
    ["memories", ["perspective"]], ["memory_dialogues", ["speaker"]],
    ["beliefs", ["holder"]], ["item_access", ["holder"]],
    ["promises", ["promisor", "promisee"]], ["promise_events", ["promisor", "promisee"]],
    ["relationship_baselines", ["from_entity", "to_entity"]], ["relationship_events", ["from_entity", "to_entity"]],
    // A user edit or lock can own a relationship pair without an event or baseline.
    ["relationship_projections", ["from_entity", "to_entity"], "AND (user_edit_ordinal IS NOT NULL OR auto_locked=1)"],
    ["social_knowledge_events", ["holder", "subject"]], ["pair_progress", ["persona", "character"]],
    ["physical_intimacy_milestones", ["participant_a", "participant_b", "initiator"]],
    ["source_passages", ["speaker"]], ["memory_recall_events", ["holder"]],
    // Pins and durable links carry evidence independently of scene counts.
    ["entity_prominence", ["entity_name"], "AND (pinned=1 OR durable_links>0)"],
  ];
  const arrays: Array<[string, string]> = [
    ["memories", "participants_json"], ["memories", "known_by_json"],
    ["memory_details", "participants_json"], ["memory_details", "known_by_json"], ["memory_details", "hidden_from_json"],
    ["memory_details", "json_extract(seed_json,'$.noticedBy')"],
    ["assertions", "json_extract(social_relation_json,'$.knownBy')"],
  ];
  const queries = [
    ...scalar.flatMap(([table, columns, extra]) => columns.map(column => `SELECT ${column} AS name FROM ${table} WHERE chat_id=@chat ${extra ?? ""}`)),
    ...arrays.map(([table, column]) => `SELECT j.value AS name FROM ${table},json_each(${column}) j WHERE chat_id=@chat AND j.type='text'`),
    "SELECT json_extract(social_relation_json,'$.target') name FROM assertions WHERE chat_id=@chat AND json_extract(social_relation_json,'$.kind')='interpersonal'",
    "SELECT json_extract(j.value,'$.speaker') name FROM episode_sections,json_each(key_dialogues_json) j WHERE chat_id=@chat",
    // Legacy witnesses survive only as recall traces; they are canonical people.
    "SELECT character_name name FROM memory_traces JOIN memories ON memories.id=memory_traces.memory_id WHERE memories.chat_id=@chat",
    "SELECT j.value name FROM memories,json_each(landmark_kinds_json) l,json_each(l.value,'$.pair') j WHERE chat_id=@chat AND j.type='text'",
    "SELECT json_extract(j.value,'$.holder') name FROM source_passages,json_each(access_json) j WHERE chat_id=@chat",
    "SELECT json_extract(document_json,'$.people.me.name') name FROM albums WHERE source_chat_id=@chat",
    "SELECT json_extract(document_json,'$.people.partner.name') name FROM albums WHERE source_chat_id=@chat",
    "SELECT json_extract(document_json,'$.source.personaName') name FROM albums WHERE source_chat_id=@chat",
    // Versioned album snapshots remain independent recoverable documents.
    "SELECT json_extract(v.document_json,'$.people.me.name') name FROM album_versions v JOIN albums a ON a.id=v.album_id WHERE a.source_chat_id=@chat",
    "SELECT json_extract(v.document_json,'$.people.partner.name') name FROM album_versions v JOIN albums a ON a.id=v.album_id WHERE a.source_chat_id=@chat",
    "SELECT value name FROM server_meta WHERE key='narration_viewpoint:'||@chat",
    `SELECT json_extract(CASE WHEN json_valid(value) THEN value END,'$.personaEntity') name
      FROM server_meta WHERE key='view_preferences:'||@chat`,
    `SELECT json_extract(CASE WHEN json_valid(value) THEN value END,'$') name
      FROM server_meta WHERE key='persona_hint:'||@chat`,
    `SELECT j.atom name FROM server_meta,json_tree(CASE WHEN json_valid(server_meta.value) THEN server_meta.value ELSE 'null' END) j
      WHERE server_meta.key='detail_access_edits:'||@chat AND j.type='text'`,
    `SELECT j.key name FROM server_meta,json_each(CASE WHEN json_valid(server_meta.value) THEN server_meta.value END) j
      WHERE server_meta.key='removed_aliases:'||@chat AND j.type='array'`,
    `SELECT json_extract(j.value,'$.speaker') name FROM server_meta,json_each(server_meta.value) j
      WHERE server_meta.key='dialogue_access_identity:'||@chat`,
  ];
  const rows = db.prepare(queries.join(" UNION ALL ")).all({ chat: chatId }) as Array<{ name: unknown }>;
  const names = rows.flatMap(row => typeof row.name === "string" ? [normalizeEntityName(row.name)] : []);
  return new Set(names.filter(name => name && !accessMarkers.has(name)));
}

/** Read lifecycle flags only, never names or records inside pending work.
 * applyMemoryAddition accepts ready regardless of the outer job status. A
 * terminal job without a candidate flag cannot be applied. */
const applicableAddition = `CASE WHEN NOT json_valid(payload_json) THEN 1
  WHEN json_type(payload_json)<>'object' THEN 1
  ELSE json_extract(payload_json,'$.candidateStatus') IS NOT NULL AND
    json_extract(payload_json,'$.candidateStatus') NOT IN ('applied','discarded','stale','empty','expired','superseded') END`;
// resolveSmallReviews accepts pending; kept/discarded/stale are terminal.
// Malformed/unknown flags postpone cleanup without establishing personhood.
const actionableSmallReview = `CASE WHEN NOT json_valid(draft_json) THEN 1
  WHEN json_type(draft_json)<>'object' THEN 1
  WHEN json_type(draft_json,'$.smallReviews') IS NULL THEN 0
  WHEN json_type(draft_json,'$.smallReviews')='null' THEN 0
  WHEN json_type(draft_json,'$.smallReviews')<>'array' THEN 1
  ELSE EXISTS (SELECT 1 FROM json_each(draft_json,'$.smallReviews') r WHERE
    CASE WHEN r.type<>'object' THEN 1 ELSE
      COALESCE(json_extract(r.value,'$.status'),'unknown') NOT IN ('kept','discarded','stale') END) END`;
// recordAutomatic persists the accepted decision's action as terminal history.
const automaticReconciliationHistory = ReconciliationDecisionSchema.shape.action.options.map(action=>`'${action}'`).join(',');

/** Shared by the indexed existence gate and count-only maintenance diagnostics.
 * Each entry explicitly excludes permanent history; unknown states stay live. */
export const ENTITY_CLEANUP_PENDING_CHECKS: ReadonlyArray<readonly [string,string,string?]> = [
    ["jobs", `(status NOT IN ('done','completed','archived','superseded','cancelled','canceled') OR (type='memory_addition' AND (${applicableAddition})))`],
    ["extraction_audits", `(status NOT IN ('applied','stale','rejected','superseded','archived') OR (status='applied' AND (${actionableSmallReview})))`],
    ["extraction_batches", "status NOT IN ('applied','stale','superseded','rejected','archived')"],
    ["conflicts", "(status NOT IN ('resolved','rejected','applied','superseded','archived','stale') OR (status='resolved' AND resolution='acknowledged' AND kind IN ('assertion','unattributed_claim')))"],
    ["reconciliation_items", `status NOT IN ('applied','resolved','rejected','superseded','archived','stale','merged','updated','kept_separate','discarded','ignored',${automaticReconciliationHistory})`],
    ["regeneration_runs", "status NOT IN ('applied','discarded','stale','rejected','archived','superseded') AND (status<>'failed' OR mode NOT IN ('episode','canonical_suffix'))"],
    ["regeneration_runs", "status NOT IN ('applied','discarded','stale','rejected','archived','superseded') AND (status<>'failed' OR mode NOT IN ('episode','canonical_suffix'))", "shadow_chat_id"],
    ["initial_calibrations", "status NOT IN ('ready','skipped','inherited')"],
    ["episodes", "status NOT IN ('normal','capsuled','excluded','discarded','superseded','archived','stale','rejected')"],
    ["chat_lineage", "status NOT IN ('inherited','independent','reverted','rejected','archived','superseded','stale')", "child_chat_id"],
    ["chat_lineage", "status NOT IN ('inherited','independent','reverted','rejected','archived','superseded','stale')", "parent_chat_id"],
];
export const entityCleanupPendingSql = (chat: string): string => {
  return 'EXISTS (' + ENTITY_CLEANUP_PENDING_CHECKS.map(([table,live,column]) =>
    'SELECT 1 FROM '+table+' WHERE '+(column ?? 'chat_id')+'='+chat+' AND '+live).join(' UNION ALL ') + ')';
};

export function hasPendingEntityMaterial(db: RcmDatabase, chatId: string): boolean {
  return Boolean((db.prepare('SELECT '+entityCleanupPendingSql('@chat')+' AS pending').get({chat:chatId}) as {pending:number}).pending);
}

export const isSupportedEntityType = (type: string): boolean => classifyEntityType(type) !== "place_object";

/** Delete idle transcript rows with no person evidence, along with their local
 * aliases, caches and child-side lineage receipts in the same transaction. */
export function cleanupUnsupportedEntities(db: RcmDatabase, chatId?: string): { deleted: number; retained: number } {
  return db.transaction(() => {
    const candidates = (db.prepare(`SELECT id,chat_id,type FROM entities WHERE origin='transcript' AND user_managed=0${chatId === undefined ? "" : " AND chat_id=?"}`)
      .all(...(chatId === undefined ? [] : [chatId])) as Array<{ id: string; chat_id: string; type: string }>)
      .filter(entity => classifyEntityType(entity.type) === "place_object");
    let deleted = 0, retained = 0, postponedChats = 0, postponedPlaces = 0;
    for (const chat of new Set(candidates.map(row => row.chat_id))) {
      if (hasPendingEntityMaterial(db, chat)) {
        postponedChats++;
        postponedPlaces += candidates.filter(row => row.chat_id === chat).length;
        continue;
      }
      const personReferences = structuredEntityPersonReferences(db, chat);
      const entities = db.prepare("SELECT id,entity_key,name,display_name FROM entities WHERE chat_id=?").all(chat) as Array<{id:string;entity_key:string;name:string;display_name:string}>;
      const aliases = db.prepare("SELECT a.entity_id,a.alias FROM aliases a JOIN entities e ON e.id=a.entity_id WHERE e.chat_id=?").all(chat) as Array<{entity_id:string;alias:string}>;
      const terms = (entity: typeof entities[number]) => [entity.id,entity.entity_key,entity.name,entity.display_name,...aliases.filter(alias=>alias.entity_id===entity.id).map(alias=>alias.alias)].filter(Boolean).map(normalizeEntityName);
      const candidateIds = new Set(candidates.filter(row => row.chat_id === chat).map(row => row.id));
      // Shared/ambiguous aliases protect every possible identity. Decide the
      // whole set before pruning caches, including aliases shared by deletions.
      const discarded = entities.filter(row => candidateIds.has(row.id) && !terms(row).some(name => personReferences.has(name)));
      retained += candidateIds.size - discarded.length;
      if (!discarded.length) continue;
      const discardedIds = new Set(discarded.map(row => row.id));
      const discardedNames = new Set(discarded.flatMap(terms));
      const keptNames = new Set(entities.filter(row=>!discardedIds.has(row.id)).flatMap(terms));
      for (const table of ["entity_scene_presence", "entity_prominence"]) {
        const rows = db.prepare(`SELECT DISTINCT entity_name FROM ${table} WHERE chat_id=?`).all(chat) as Array<{entity_name:string}>;
        for (const row of rows) if (discardedNames.has(normalizeEntityName(row.entity_name)) && !keptNames.has(normalizeEntityName(row.entity_name))) {
          db.prepare(`DELETE FROM ${table} WHERE chat_id=? AND entity_name=?`).run(chat,row.entity_name);
        }
      }
      for (const entity of discarded) {
        db.prepare("DELETE FROM aliases WHERE entity_id=?").run(entity.id);
        // The receipt belongs to the child row. Descendant receipts may keep a
        // historical parent ID, just as they do after a parent chat is deleted.
        db.prepare("DELETE FROM chat_lineage_items WHERE child_chat_id=? AND item_kind='entity' AND child_item_id=?").run(chat,entity.id);
        db.prepare("DELETE FROM entities WHERE id=?").run(entity.id);
        deleted++;
      }
    }
    if (deleted || retained || postponedChats) console.info(`[RCM] entity cleanup: deleted=${deleted} retained_person_references=${retained} postponed_chats=${postponedChats} postponed_places=${postponedPlaces}`);
    return { deleted, retained };
  })();
}
