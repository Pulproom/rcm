import type { RcmDatabase } from './db.js';
import { DEFAULT_EXTRACTION_CONTRACTS, EPISODE_CAPSULE_CONTRACT } from './jobs.js';
import { recognitionOnlyMemorySql } from './memory-group-search.js';

export function legacyMemorySummary(db: RcmDatabase, chatId: string): {
  totalMemories: number; legacyMemories: number; legacyBatchIds: string[];
  visibleTotalMemories: number; visibleLegacyMemories: number;
  rebuiltContract: string | null; currentContract: string;
} {
  const { event, state } = DEFAULT_EXTRACTION_CONTRACTS;
  const currentContract = `${event}/${state}`;
  const legacyBatchIds = (db.prepare(`SELECT id FROM extraction_batches WHERE chat_id=?
    AND generation_id='active' AND status='applied'
    AND (producer_event_contract IS NULL OR producer_state_contract IS NULL
      OR (producer_event_contract<>? AND (kind<>'episode' OR producer_event_contract<>?))
      OR (producer_state_contract<>? AND (kind<>'episode' OR producer_state_contract<>?))) ORDER BY id`)
    .all(chatId,event,EPISODE_CAPSULE_CONTRACT,state,EPISODE_CAPSULE_CONTRACT) as Array<{id:string}>).map(row => row.id);
  const counts = db.prepare(`WITH counted AS (
    SELECT (m.source_batch_id IN (SELECT value FROM json_each(?))
      OR (m.source_batch_id IS NULL AND ?)) AS legacy,
      (m.capsule_parent_id IS NULL AND NOT ${recognitionOnlyMemorySql('m')}) AS visible
    FROM memories m WHERE m.chat_id=? AND m.active=1
  ) SELECT count(*) totalMemories, COALESCE(sum(legacy),0) legacyMemories,
    COALESCE(sum(visible),0) visibleTotalMemories,
    COALESCE(sum(visible AND legacy),0) visibleLegacyMemories FROM counted`)
    .get(JSON.stringify(legacyBatchIds),Number(legacyBatchIds.length > 0),chatId) as {
      totalMemories:number;legacyMemories:number;visibleTotalMemories:number;visibleLegacyMemories:number;
    };
  const chat = db.prepare('SELECT rebuilt_contract FROM chats WHERE id=?').get(chatId) as {rebuilt_contract:string|null} | undefined;
  return {...counts,legacyBatchIds,rebuiltContract:chat?.rebuilt_contract ?? null,currentContract};
}

export function markChatRebuilt(db: RcmDatabase, chatId: string, contract: string): void {
  db.prepare('UPDATE chats SET rebuilt_contract=? WHERE id=?').run(contract,chatId);
}

export function isChatCurrent(db: RcmDatabase, chatId: string): boolean {
  const summary = legacyMemorySummary(db,chatId);
  return summary.legacyMemories === 0 || summary.rebuiltContract === summary.currentContract;
}
