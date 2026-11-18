import type { RcmDatabase } from "./db.js";

/** Materializer dependencies, including lazy access migration and its review
 * guards. TEMP triggers cover this connection's writers (restore and rollback).
 * Other connections are detected conservatively by PRAGMA main.data_version.
 * Messages deliberately omit extraction/queue bookkeeping; chats omit heartbeat,
 * revision and settings writes that do not enter the state corpus.
 */
export function installStateCorpusTracking(db: RcmDatabase): void {
  // Connection-local runtime metadata. Keep counters
  // after chat deletion so deleting/recreating an ID cannot reuse an old token.
  // access_version is not a story *_revision clock for lineage repair to rebase.
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS state_corpus_revisions (
    chat_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, access_version INTEGER NOT NULL
  ) WITHOUT ROWID`);
  const pendingLineage = (chat: string) => `EXISTS(SELECT 1 FROM chat_lineage l WHERE l.child_chat_id=${chat}
    AND COALESCE(json_extract(l.counts_json,'$.pendingAccessReextraction'),0)>0)`;
  const bump = (chat: string, access = false) => `INSERT INTO state_corpus_revisions(chat_id,revision,access_version)
    SELECT ${chat},1,${access ? 1 : 0} WHERE ${chat} IS NOT NULL
    ON CONFLICT(chat_id) DO UPDATE SET revision=revision+1,access_version=access_version+excluded.access_version;`;
  const tables = ["assertions", "beliefs", "promises", "promise_events", "social_knowledge_events",
    "relationship_events", "relationship_projections", "relationship_baselines", "physical_intimacy_milestones",
    "memories", "memory_details", "item_access", "entities", "conflicts", "reconciliation_items",
    "extraction_batches", "chat_lineage", "chat_lineage_items", "messages", "chats", "aliases", "server_meta"];
  for (const table of tables) {
    // Reconcile definitions at startup when a dependency/column policy changes.
    db.exec(["insert", "delete", "update", "replace"].map(event => `DROP TRIGGER IF EXISTS temp.state_corpus_${table}_${event};`).join("\n"));
    const scope = (row: string): string => table === "aliases" ? `(SELECT chat_id FROM entities WHERE id=${row}.entity_id)`
      : table === "server_meta" ? `CASE
        WHEN substr(${row}.key,1,20)='detail_access_edits:' THEN substr(${row}.key,21)
        WHEN substr(${row}.key,1,16)='removed_aliases:' THEN substr(${row}.key,17) END`
      : `${row}.${table === "chats" ? "id" : table.startsWith("chat_lineage") ? "child_chat_id" : "chat_id"}`;
    const changed = (columns: string[]) => columns.map(column => `NEW.${column} IS NOT OLD.${column}`).join(" OR ");
    const condition = table === "messages" ? changed(["chat_id", "message_id", "canonical_hash", "content_hash", "canonical_content", "ordinal", "lifecycle", "host_visibility", "memory_excluded"])
      : table === "chats" ? `${changed(["id", "completed_turn_count"])} OR (NEW.updated_at IS NOT OLD.updated_at AND ${pendingLineage("NEW.id")})`
      : table === "extraction_batches" ? `${changed(["chat_id", "id"])} OR
        (NEW.status IS NOT OLD.status AND (NEW.status='pending_review' OR OLD.status='pending_review')) OR
        (NEW.updated_at IS NOT OLD.updated_at AND ${pendingLineage("NEW.chat_id")})`
      : "1";
    const access = table === "item_access";
    // REPLACE's implicit DELETE does not fire DELETE triggers when a writer
    // has recursive_triggers off. A global primary key moved to another chat
    // must invalidate the previous owner before that row disappears as well.
    const scopeColumn = table.startsWith("chat_lineage") ? "child_chat_id" : "chat_id";
    const primary = (db.pragma(`table_info(${table})`) as Array<{name:string;pk:number}>).filter(column => column.pk).map(column => column.name);
    if (!["chats", "aliases", "server_meta"].includes(table) && !primary.includes(scopeColumn)) {
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS state_corpus_${table}_replace BEFORE INSERT ON main.${table} BEGIN
        INSERT INTO state_corpus_revisions(chat_id,revision,access_version)
          SELECT ${scope("prior")},1,${access ? 1 : 0} FROM ${table} prior
          WHERE ${primary.map(column => `prior.${column}=NEW.${column}`).join(" AND ")} AND ${scope("prior")} IS NOT ${scope("NEW")}
          ON CONFLICT(chat_id) DO UPDATE SET revision=revision+1,access_version=access_version+excluded.access_version;
      END;`);
    }
    db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS state_corpus_${table}_insert AFTER INSERT ON main.${table} BEGIN ${bump(scope("NEW"), access)} END;
      CREATE TEMP TRIGGER IF NOT EXISTS state_corpus_${table}_delete AFTER DELETE ON main.${table} BEGIN ${bump(scope("OLD"), access)} END;
      CREATE TEMP TRIGGER IF NOT EXISTS state_corpus_${table}_update AFTER UPDATE ON main.${table} WHEN ${condition} BEGIN
        ${bump(scope("NEW"), access)}
        INSERT INTO state_corpus_revisions(chat_id,revision,access_version)
          SELECT ${scope("OLD")},1,${access ? 1 : 0} WHERE ${scope("OLD")} IS NOT NULL AND ${scope("OLD")} IS NOT ${scope("NEW")}
          ON CONFLICT(chat_id) DO UPDATE SET revision=revision+1,access_version=access_version+excluded.access_version;
      END;`);
  }
}

/** Parent access is read only by pending lineage access migration. Ordinary
 * parent state changes are independent; access changes conservatively refresh
 * the child until that migration dependency has been removed.
 */
export function stateCorpusVersionQuery(db: RcmDatabase) {
  return db.prepare(`SELECT COALESCE(r.revision,0) revision,(SELECT data_version FROM pragma_data_version) external,
    (SELECT json_group_array(json_array(l.parent_chat_id,COALESCE(p.access_version,0)))
      FROM main.chat_lineage l LEFT JOIN temp.state_corpus_revisions p ON p.chat_id=l.parent_chat_id
      WHERE l.child_chat_id=requested.chat_id AND COALESCE(json_extract(l.counts_json,'$.pendingAccessReextraction'),0)>0) parents
    FROM (SELECT ? chat_id) requested LEFT JOIN temp.state_corpus_revisions r ON r.chat_id=requested.chat_id`);
}

/** Remove the unreleased persistent tracker before migrations or backup checks.
 * No canonical rows are touched. Qualify main so this never drops TEMP objects.
 */
export function removePersistentStateCorpusTracking(db: RcmDatabase): void {
  db.transaction(() => {
    const triggers = db.prepare("SELECT name FROM main.sqlite_master WHERE type='trigger' AND substr(name,1,13)='state_corpus_'").all() as Array<{name:string}>;
    for (const {name} of triggers) db.exec(`DROP TRIGGER IF EXISTS main."${name.replaceAll('"','""')}"`);
    db.exec("DROP TABLE IF EXISTS main.state_corpus_revisions");
  })();
}
