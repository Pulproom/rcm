import { randomUUID } from "node:crypto";
import type { RcmDatabase } from "./db.js";
import { NARRATOR_ARCHIVE_HOLDER, PENDING_ACCESS_HOLDER } from "./item-access.js";

/** Upgrade untouched lineage sentinels proved by the lineage record and original
 * grants. Without that provenance, the old marker's two meanings are ambiguous. */
export function migrateLineagePendingAccess(db: RcmDatabase, chatId?: string): void {
  db.prepare(`UPDATE item_access AS a SET holder=? WHERE a.holder=? AND a.active=1
    AND a.basis='internal' AND a.evidence_json='[]' AND (? IS NULL OR a.chat_id=?)
    AND EXISTS(SELECT 1 FROM chat_lineage l JOIN chat_lineage_items i ON i.child_chat_id=l.child_chat_id
      WHERE l.child_chat_id=a.chat_id AND i.child_item_id=a.item_id AND i.item_kind=CASE a.item_kind WHEN 'detail' THEN 'memory_detail' WHEN 'physical_milestone' THEN 'physical_intimacy_milestone' ELSE a.item_kind END
      AND COALESCE(json_extract(l.counts_json,'$.pendingAccessReextraction'),0)>0
      AND a.created_at=l.applied_at
      AND EXISTS(SELECT 1 FROM chats c WHERE c.id=a.chat_id AND c.updated_at<=l.applied_at)
      AND NOT EXISTS(SELECT 1 FROM extraction_batches b WHERE b.chat_id=a.chat_id AND b.updated_at>l.applied_at)
      AND EXISTS(SELECT 1 FROM item_access p WHERE p.chat_id=l.parent_chat_id AND p.item_kind=a.item_kind AND p.item_id=i.parent_item_id AND p.source_revision<=a.source_revision AND p.created_at<=l.applied_at)
      AND NOT EXISTS(SELECT 1 FROM item_access p WHERE p.chat_id=l.parent_chat_id AND p.item_kind=a.item_kind AND p.item_id=i.parent_item_id AND p.holder=?))`)
    .run(PENDING_ACCESS_HOLDER, NARRATOR_ARCHIVE_HOLDER, chatId ?? null, chatId ?? null, NARRATOR_ARCHIVE_HOLDER);
}

/** Materialize the historic participant scope, never revive a revoked/reviewed
 * scope. Migration, restore and lazy reads share this rule; manual creation writes
 * participant grants through the normal access writer. */
export function backfillLegacyParticipantAccess(db: RcmDatabase, chatId?: string): void {
  db.transaction(() => {
    migrateLineagePendingAccess(db, chatId);
    const write = db.prepare(`INSERT INTO item_access(id,chat_id,item_kind,item_id,holder,basis,evidence_json,confidence,active,source_revision,created_at)
      VALUES(?,?,?,?,?,'experienced',?,1,1,?,?)`);
    for (const [kind, table, participants, revision, evidence] of [
      ["promise", "promises", "p.promisor a,p.promisee b", "updated_revision",
        "COALESCE((SELECT e.evidence_json FROM promise_events e WHERE e.chat_id=p.chat_id AND e.promise_id=p.id AND e.active=1 AND e.evidence_json<>'[]' ORDER BY e.created_revision,e.id LIMIT 1),(SELECT m.evidence_json FROM memories m WHERE m.id=p.source_memory_id),'[]')"],
      ["physical_milestone", "physical_intimacy_milestones", "p.participant_a a,p.participant_b b", "created_revision", "p.evidence_json"],
    ]) {
      const rows = db.prepare(`SELECT p.id,p.chat_id,${participants},p.${revision} revision,p.created_at,${evidence} evidence FROM ${table} p
        WHERE (? IS NULL OR p.chat_id=?) AND NOT EXISTS(SELECT 1 FROM item_access a WHERE a.chat_id=p.chat_id AND a.item_kind=? AND a.item_id=p.id)
        ${kind === "promise" ? "AND p.status NOT IN ('pending','pending_review','disputed','invalidated')" : ""}
        AND NOT EXISTS(SELECT 1 FROM extraction_batches b WHERE b.id=p.source_batch_id AND b.chat_id=p.chat_id AND b.status='pending_review')
        AND NOT EXISTS(SELECT 1 FROM reconciliation_items r WHERE r.chat_id=p.chat_id AND r.status='pending'
          AND (json_extract(r.incoming_json,'$.id')=p.id ${kind === 'promise' ? "OR json_extract(r.incoming_json,'$.item.promiseKeyHint')=p.promise_key" : ''} OR EXISTS(SELECT 1 FROM json_each(r.candidates_json) c WHERE json_extract(c.value,'$.id')=p.id)))
        AND NOT EXISTS(SELECT 1 FROM conflicts c WHERE c.chat_id=p.chat_id AND c.status='pending'
          AND (json_extract(c.incoming_json,'$.id')=p.id ${kind === "promise" ? "OR json_extract(c.incoming_json,'$.promise_key')=p.promise_key OR json_extract(c.incoming_json,'$.key')=p.promise_key" : ""}))`)
        .all(chatId ?? null, chatId ?? null, kind) as Array<{id:string;chat_id:string;a:string;b:string;revision:number;created_at:number;evidence:string}>;
      for (const row of rows) for (const holder of new Set([row.a, row.b].map(name => name.trim()).filter(Boolean)))
        write.run(randomUUID(), row.chat_id, kind, row.id, holder, row.evidence, row.revision, row.created_at);
    }
  })();
}
