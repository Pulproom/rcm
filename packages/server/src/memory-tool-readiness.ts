import { EVERYONE_HOLDER } from "./item-access.js";
import { searchableMemoryParentSql } from "./memory-group-search.js";
import type { RcmDatabase } from "./db.js";

export interface MemoryToolReadiness {
  available: boolean;
  processedAtoms: number;
  processedStates: number;
}

export function accessibleArchiveExists(db: RcmDatabase, chatId: string, holders: string[]): boolean {
  if (!holders.length) return false;
  const names = JSON.stringify([...holders, EVERYONE_HOLDER]);
  return Boolean(db.prepare(`SELECT 1 FROM memories m WHERE m.chat_id=? AND m.active=1 AND (
    (m.atom_access_version=0 AND EXISTS(SELECT 1 FROM json_each(m.known_by_json) k JOIN json_each(?) h ON k.value=h.value COLLATE NOCASE))
    OR EXISTS(SELECT 1 FROM item_access a JOIN json_each(?) h ON a.holder=h.value COLLATE NOCASE WHERE a.chat_id=m.chat_id AND a.active=1
      AND ((a.item_kind='detail' AND a.item_id IN (SELECT id FROM memory_details WHERE memory_id=m.id AND active=1))
        OR (a.item_kind='dialogue' AND a.item_id IN (SELECT id FROM memory_dialogues WHERE memory_id=m.id))))) LIMIT 1`).get(chatId, names, names))
    || Boolean(db.prepare(`SELECT 1 FROM source_passages p JOIN messages m ON m.chat_id=p.chat_id AND m.message_id=p.message_id AND m.canonical_hash=p.canonical_hash
      WHERE p.chat_id=? AND p.active=1 AND m.lifecycle IN ('committed','client_pruned') AND m.memory_excluded=0 AND m.host_visibility IN ('active','all_before')
      AND EXISTS(SELECT 1 FROM json_each(p.access_json) a JOIN json_each(?) h ON json_extract(a.value,'$.holder')=h.value COLLATE NOCASE) LIMIT 1`).get(chatId, names))
    || Boolean(db.prepare(`SELECT 1 FROM beliefs b JOIN json_each(?) h ON b.holder=h.value COLLATE NOCASE WHERE b.chat_id=? AND b.active=1 LIMIT 1`).get(names, chatId))
    || Boolean(db.prepare(`SELECT 1 FROM item_access a JOIN json_each(?) h ON a.holder=h.value COLLATE NOCASE
      WHERE a.chat_id=? AND a.active=1 AND a.item_kind='promise' AND a.item_id IN (SELECT id FROM promises WHERE chat_id=?) LIMIT 1`).get(names, chatId, chatId));
}

export function memoryToolReadiness(db: RcmDatabase, chatId: string): MemoryToolReadiness {
  const atoms = db.prepare(`SELECT
      (SELECT count(*) FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()})
    + (SELECT count(*) FROM memory_details detail JOIN memories memory ON memory.id=detail.memory_id
        WHERE detail.chat_id=? AND detail.active=1 AND memory.active=1 AND ${searchableMemoryParentSql("memory")})
    + (SELECT count(*) FROM memory_dialogues dialogue JOIN memories memory ON memory.id=dialogue.memory_id
        WHERE dialogue.chat_id=? AND memory.active=1 AND ${searchableMemoryParentSql("memory")})
    + (SELECT count(*) FROM story_spine_nodes WHERE chat_id=? AND generation_id='active' AND status='active' AND hidden=0)
    + (SELECT count(*) FROM source_passages p JOIN messages m ON m.chat_id=p.chat_id AND m.message_id=p.message_id AND m.canonical_hash=p.canonical_hash WHERE p.chat_id=? AND p.active=1 AND json_array_length(p.access_json)>0 AND m.lifecycle IN ('committed','client_pruned') AND m.memory_excluded=0 AND m.host_visibility IN ('active','all_before'))
    AS count`).get(chatId, chatId, chatId, chatId, chatId) as { count: number };
  const states = db.prepare(`SELECT
      (SELECT count(*) FROM relationship_projections WHERE chat_id=? AND stale=0)
    + (SELECT count(*) FROM promises WHERE chat_id=?)
    + (SELECT count(*) FROM assertions WHERE chat_id=? AND valid_to_revision IS NULL)
    + (SELECT count(*) FROM beliefs WHERE chat_id=? AND active=1)
    + (SELECT count(*) FROM social_knowledge_events WHERE chat_id=? AND active=1)
    + (SELECT count(*) FROM physical_intimacy_milestones WHERE chat_id=? AND active=1)
    AS count`).get(chatId, chatId, chatId, chatId, chatId, chatId) as { count: number };
  const processedAtoms = Number(atoms.count ?? 0);
  const processedStates = Number(states.count ?? 0);
  return { available: processedAtoms + processedStates > 0, processedAtoms, processedStates };
}
