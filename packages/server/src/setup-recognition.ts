import { syncManualCognition } from "./social-knowledge.js";
import { randomUUID } from "node:crypto";
import { INITIAL_CALIBRATION_MEMORY_KEY_PREFIX, type InitialCalibrationResult } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { refreshMemoryFts } from "./memory-search-document.js";
import { canAutomaticallyChangeSocialKnowledge } from "./social-knowledge.js";
import { invalidateStorySupports, storyMemorySupportIds } from "./story-spine.js";
import { pruneDetailAccessEdits, readDetailAccessEdits } from "./item-access.js";


// Setup citations are not transcript message IDs. Keep their fingerprint and exact
// excerpts on the recognition event; no fabricated dialogue/source quote is indexed.
export function storeSetupRecognition(db: RcmDatabase, chatId: string, fingerprint: string,
  items: InitialCalibrationResult["socialKnowledge"], names: Map<string, {name:string}>, active: boolean): void {
  const timestamp = Date.now();
  for (const item of items) {
    const holder = names.get(item.holderKey)?.name, subject = names.get(item.subjectKey)?.name;
    if (!holder || !subject || holder === subject) throw new Error("Invalid setup recognition pair");
    if (!canAutomaticallyChangeSocialKnowledge(db,chatId,holder,subject,[])) continue;
    const memoryId = randomUUID(), detailId = randomUUID();
    const key = `${INITIAL_CALIBRATION_MEMORY_KEY_PREFIX}${fingerprint}:${item.holderKey}:${item.subjectKey}`;
    const evidence = JSON.stringify(item.evidence.map(e => ({...e, sourceKind:"setup", setupFingerprint:fingerprint})));
    db.prepare(`INSERT INTO memories(id,chat_id,memory_key,type,title,content,participants_json,known_by_json,
      retention_class,atom_access_version,user_managed,active,created_revision,created_at,updated_at)
      VALUES(?,?,?,'belief',?,?,?,?,'durable',1,0,?,0,?,?)`).run(memoryId, chatId, key,
      `${holder} → ${subject}`, item.description, JSON.stringify([holder,subject]), JSON.stringify([holder]), Number(active), timestamp, timestamp);
    db.prepare(`INSERT INTO memory_details(id,chat_id,memory_id,detail_key,role,kind,text,known_by_json,epistemic,
      retention_class,active,created_revision,created_at,updated_at)
      VALUES(?,?,?,'recognition','core','character_state',?,?,'stated','durable',?,0,?,?)`)
      .run(detailId,chatId,memoryId,item.description,JSON.stringify([holder]),Number(active),timestamp,timestamp);
    db.prepare(`INSERT INTO item_access(id,chat_id,item_kind,item_id,holder,basis,evidence_json,confidence,active,source_revision,created_at)
      VALUES(?,?,'detail',?,?,'internal','[]',1,?,0,?)`).run(randomUUID(),chatId,detailId,holder,Number(active),timestamp);
    db.prepare(`INSERT INTO social_knowledge_events(id,chat_id,holder,subject,action,level,known_as_json,cognition_detail_ids_json,
      evidence_json,source_memory_id,source_start_ordinal,source_end_ordinal,manual,active,created_revision,created_at)
      VALUES(?,?,?,?,'establish',?,?,?,?,?,-1,-1,0,?,0,?)`).run(randomUUID(),chatId,holder,subject,item.level,
      JSON.stringify(item.knownAs),JSON.stringify([detailId]),evidence,memoryId,Number(active),timestamp);
    refreshMemoryFts(db,memoryId);
  }
  syncManualCognition(db,chatId);
}

export function updateSetupRecognition(db: RcmDatabase, chatId: string, action: "activate"|"delete", entity?: string): void {
  const rows = db.prepare(`SELECT id FROM memories WHERE chat_id=? AND is_initial_calibration_memory(memory_key)
    AND (? IS NULL OR EXISTS (SELECT 1 FROM social_knowledge_events s WHERE s.source_memory_id=memories.id AND (s.holder=? OR s.subject=?)))`)
    .all(chatId,entity ?? null,entity ?? null,entity ?? null) as Array<{id:string}>;
  const supports=action==='delete' ? storyMemorySupportIds(db,chatId,rows.map(row=>row.id)) : new Set<string>();
  for (const {id} of rows) {
    if (action === "delete") {

      db.prepare("DELETE FROM memory_fts WHERE memory_id=?").run(id);
      db.prepare("DELETE FROM memory_detail_fts WHERE memory_id=?").run(id);
      db.prepare("DELETE FROM item_access WHERE chat_id=? AND item_kind='detail' AND item_id IN (SELECT id FROM memory_details WHERE memory_id=?)").run(chatId,id);
      db.prepare("DELETE FROM social_knowledge_events WHERE chat_id=? AND source_memory_id=?").run(chatId,id);
      db.prepare("DELETE FROM memories WHERE chat_id=? AND id=?").run(chatId,id);
      pruneDetailAccessEdits(db, chatId);
    } else {
      const pairs=db.prepare("SELECT holder,subject FROM social_knowledge_events WHERE chat_id=? AND source_memory_id=?").all(chatId,id) as Array<{holder:string;subject:string}>;
      if (pairs.some(pair=>!canAutomaticallyChangeSocialKnowledge(db,chatId,pair.holder,pair.subject,[]))) continue;
      db.prepare("UPDATE memories SET active=1 WHERE id=?").run(id);
      db.prepare("UPDATE memory_details SET active=1 WHERE memory_id=?").run(id);
      db.prepare(`UPDATE item_access SET active=1 WHERE chat_id=? AND item_kind='detail'
        AND item_id IN (SELECT id FROM memory_details WHERE memory_id=?) AND item_id NOT IN (SELECT value FROM json_each(?))`)
        .run(chatId,id,JSON.stringify([...readDetailAccessEdits(db,chatId).keys()]));
      db.prepare("UPDATE social_knowledge_events SET active=1 WHERE chat_id=? AND source_memory_id=?").run(chatId,id);
      refreshMemoryFts(db,id);
    }
  }
  syncManualCognition(db,chatId,supports);
  invalidateStorySupports(db,chatId,supports);
}
