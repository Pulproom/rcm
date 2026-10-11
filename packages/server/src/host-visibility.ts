import { randomUUID } from "node:crypto";
import { type MessageHostVisibility, type MessageVisibilitySnapshot } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { queueRelationshipProjection } from "./relationship-projections.js";
import { deactivateItemAccess } from "./item-access.js";
import { UNCORRECTED_SQL } from "./user-corrections.js";
import { invalidateStorySupports, storyMemorySupportIds } from "./story-spine.js";

export function deactivateDerivedMemories(db: RcmDatabase, chatId: string, memoryIds: string[], revision: number): void {
  if (memoryIds.length === 0) return;
  const supports=storyMemorySupportIds(db,chatId,memoryIds);
  const placeholders = memoryIds.map(() => "?").join(",");
  const detailIds = (db.prepare(`SELECT id FROM memory_details WHERE memory_id IN (${placeholders})`).all(...memoryIds) as Array<{ id: string }>).map((row) => row.id);
  const dialogueIds = (db.prepare(`SELECT id FROM memory_dialogues WHERE memory_id IN (${placeholders})`).all(...memoryIds) as Array<{ id: string }>).map((row) => row.id);
  const promiseIds = (db.prepare(`SELECT id FROM promises WHERE ${UNCORRECTED_SQL} AND source_memory_id IN (${placeholders})`).all(...memoryIds) as Array<{ id: string }>).map((row) => row.id);
  const milestoneIds = (db.prepare(`SELECT id FROM physical_intimacy_milestones WHERE manual_override=0 AND source_memory_id IN (${placeholders})`).all(...memoryIds) as Array<{ id: string }>).map((row) => row.id);
  deactivateItemAccess(db, chatId, "detail", detailIds);
  deactivateItemAccess(db, chatId, "dialogue", dialogueIds);
  deactivateItemAccess(db, chatId, "promise", promiseIds);
  deactivateItemAccess(db, chatId, "physical_milestone", milestoneIds);
  db.prepare(`UPDATE memories SET active=0,updated_at=? WHERE id IN (${placeholders})`).run(now(), ...memoryIds);
  db.prepare(`DELETE FROM memory_fts WHERE memory_id IN (${placeholders})`).run(...memoryIds);
  db.prepare(`DELETE FROM memory_detail_fts WHERE memory_id IN (${placeholders})`).run(...memoryIds);
  db.prepare(`UPDATE memory_details SET active=0 WHERE memory_id IN (${placeholders})`).run(...memoryIds);
  db.prepare(`UPDATE assertions SET valid_to_revision=COALESCE(valid_to_revision,?) WHERE ${UNCORRECTED_SQL} AND source_memory_id IN (${placeholders})`).run(revision, ...memoryIds);
  db.prepare(`UPDATE physical_intimacy_milestones SET active=0 WHERE manual_override=0 AND source_memory_id IN (${placeholders})`).run(...memoryIds);
  const promiseRows = db.prepare(`SELECT * FROM promises WHERE ${UNCORRECTED_SQL} AND source_memory_id IN (${placeholders})`).all(...memoryIds) as any[];
  db.prepare(`UPDATE promises SET status='invalidated',updated_revision=? WHERE ${UNCORRECTED_SQL} AND source_memory_id IN (${placeholders})`).run(revision, ...memoryIds);
  for (const promise of promiseRows) {
    const ordinal = (db.prepare("SELECT MAX(m.ordinal) AS ordinal FROM evidence_spans e JOIN messages m ON m.chat_id=e.chat_id AND m.message_id=e.message_id WHERE e.memory_id=?").get(promise.source_memory_id) as { ordinal: number | null }).ordinal;
    db.prepare("INSERT INTO promise_events(id,chat_id,promise_id,promise_key,promisor,promisee,content,status,source_memory_id,source_ordinal,created_revision,created_at) VALUES(?,?,?,?,?,?,?,'invalidated',?,?,?,?)").run(randomUUID(), chatId, promise.id, promise.promise_key, promise.promisor, promise.promisee, promise.content, promise.source_memory_id, ordinal, revision, now());
  }
  const pairs = db.prepare(`SELECT DISTINCT from_entity,to_entity FROM relationship_events WHERE source_memory_id IN (${placeholders})`).all(...memoryIds) as Array<{ from_entity: string; to_entity: string }>;
  db.prepare(`UPDATE relationship_events SET active=0 WHERE source_memory_id IN (${placeholders})`).run(...memoryIds);
  pairs.forEach((pair) => queueRelationshipProjection(db, chatId, pair.from_entity, pair.to_entity, "replay"));
  for (const id of memoryIds) db.prepare("DELETE FROM embedding_items WHERE (kind='memory' AND source_id=?) OR (kind='memory_detail' AND source_json LIKE ?)").run(id, `%${id}%`);
  invalidateStorySupports(db,chatId,supports);
}

interface StoredVisibility {
  message_id: string;
  lifecycle: string;
  host_visibility: MessageHostVisibility;
  extraction_state: string;
}

function cancelQueuedJobsContaining(db: RcmDatabase, chatId: string, hiddenIds: Set<string>): void {
  const rows = db.prepare("SELECT id,payload_json FROM jobs WHERE chat_id=? AND status IN ('queued','failed')").all(chatId) as Array<{ id: string; payload_json: string }>;
  for (const row of rows) {
    let sourceMessageIds: string[] = [];
    try { sourceMessageIds = (JSON.parse(row.payload_json) as { sourceMessageIds?: string[] }).sourceMessageIds ?? []; }
    catch { continue; }
    if (!sourceMessageIds.some((id) => hiddenIds.has(id))) continue;
    db.prepare("DELETE FROM jobs WHERE id=?").run(row.id);
    for (const id of sourceMessageIds) {
      db.prepare(`
        UPDATE messages SET extraction_state=CASE WHEN host_visibility IN ('active','all_before') AND lifecycle='committed' THEN 'pending' ELSE 'blocked' END,updated_at=?
        WHERE chat_id=? AND message_id=? AND extraction_state IN ('queued','cancelled')
      `).run(now(), chatId, id);
    }
  }
}

export function applyHostVisibilityProjection(
  db: RcmDatabase,
  chatId: string,
  projection: MessageVisibilitySnapshot[],
  revision: number,
): number {
  if (projection.length === 0) return 0;
  const stored = db.prepare(`
    SELECT message_id,lifecycle,host_visibility,extraction_state FROM messages WHERE chat_id=?
  `).all(chatId) as StoredVisibility[];
  const byId = new Map(stored.map((row) => [row.message_id, row]));
  const hidden = new Set<string>();
  let changes = 0;
  const timestamp = now();
  for (const item of projection) {
    const previous = byId.get(item.id);
    if (!previous || previous.host_visibility === item.visibility) continue;
    const archiveEligible = item.visibility === "active" || item.visibility === "all_before";
    const wasArchiveEligible = previous.host_visibility === "active" || previous.host_visibility === "all_before";
    const extractionState = archiveEligible
      ? !wasArchiveEligible && previous.extraction_state === "blocked" && previous.lifecycle === "committed" ? "pending" : previous.extraction_state
      : ["pending", "queued", "cancelled", "held"].includes(previous.extraction_state) ? "blocked" : previous.extraction_state;
    db.prepare(`
      UPDATE messages SET host_visibility=?,visible=?,extraction_state=?,updated_at=?
      WHERE chat_id=? AND message_id=?
    `).run(item.visibility, archiveEligible ? 1 : 0, extractionState, timestamp, chatId, item.id);
    if (!archiveEligible) hidden.add(item.id);
    changes += 1;
  }
  if (changes === 0) return 0;
  // Risu visibility controls prompt exposure, not the durable RCM archive.
  // Only not-yet-materialized work is paused; existing memories and ledgers
  // intentionally survive hide/unhide transitions.
  cancelQueuedJobsContaining(db, chatId, hidden);
  return changes;
}
