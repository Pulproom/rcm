import { assertChatUnlocked } from './upgrade-lock.js';
import { StorySeedSchema, type SeedResolution, type SeedMarker } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { memoryDetailAtomKey } from "./memory-atoms.js";

export function readStorySeed(value: unknown) {
  if (!value) return undefined;
  // Reading old rows/backups must never take down retrieval or the dashboard.
  try {
    const parsed = StorySeedSchema.safeParse(typeof value === "string" ? JSON.parse(value) : value);
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

export function accessibleStorySeed(value: unknown, knownBy: string[]): SeedMarker | undefined {
  const seed=readStorySeed(value);
  if (!seed) return undefined;
  const normalize=(name:string)=>name.normalize("NFKC").trim().toLocaleLowerCase();
  const holders=new Set(knownBy.map(normalize));
  return {type:seed.type,status:seed.status,noticedBy:seed.noticedBy.filter(name=>holders.has(normalize(name)) || holders.has("__everyone__"))};
}

export function openStorySeeds(db: RcmDatabase, chatId: string) {
  return db.prepare(`SELECT d.id,d.text,d.seed_json,d.evidence_json,d.source_end_ordinal FROM visible_memory_details d
    JOIN memories m ON m.id=d.memory_id AND m.chat_id=d.chat_id
    WHERE d.chat_id=? AND d.active=1 AND m.active=1 AND json_extract(d.seed_json,'$.status')='open'
    ORDER BY d.source_start_ordinal,d.id`).all(chatId) as Array<{id:string;text:string;seed_json:string;evidence_json:string;source_end_ordinal:number}>;
}

export type SeedResolutionDrop = { detailId: string; reason: string };

/** Keep independently valid decisions; exact, currently live, later evidence is still required. */
export function validateSeedResolutions(db: RcmDatabase, chatId: string, resolutions: SeedResolution[], sourceIds?: string[], suppliedSeeds?: ReadonlySet<string>) {
  const accepted: SeedResolution[] = [], dropped: SeedResolutionDrop[] = [];
  const seen = new Set<string>();
  for (const patch of resolutions) {
    const reject = (reason: string) => dropped.push({detailId:patch.detailId,reason});
    if (patch.status !== "fulfilled") { reject("Models may only fulfil seeds; abandonment ignored"); continue; }
    if (suppliedSeeds && !suppliedSeeds.has(patch.detailId)) { reject("Seed target was not supplied to the model"); continue; }
    if (seen.has(patch.detailId)) { reject("Duplicate seed resolution target"); continue; }
    const row = db.prepare(`SELECT d.seed_json,d.source_end_ordinal FROM visible_memory_details d JOIN memories m ON m.id=d.memory_id
      WHERE d.id=? AND d.chat_id=? AND d.active=1 AND m.active=1`).get(patch.detailId, chatId) as {seed_json:string;source_end_ordinal:number}|undefined;
    const seed=row && readStorySeed(row.seed_json);
    if (!seed || seed.status !== "open" && (seed.status !== patch.status || JSON.stringify(seed.closureEvidence) !== JSON.stringify(patch.evidence))) { reject("Seed resolution target is not open"); continue; }
    const valid = patch.evidence.length > 0 && patch.evidence.every(evidence => {
      const source = db.prepare(`SELECT ordinal,canonical_content,canonical_hash FROM messages WHERE chat_id=? AND message_id=?
        AND lifecycle IN ('committed','client_pruned') AND memory_excluded=0 AND host_visibility IN ('active','all_before')`).get(chatId,evidence.messageId) as {ordinal:number;canonical_content:string;canonical_hash:string}|undefined;
      return !(sourceIds && !sourceIds.includes(evidence.messageId) || !source || source.ordinal <= row!.source_end_ordinal || !evidence.quote
        || source.canonical_hash !== evidence.canonicalHash || evidence.startOffset === undefined || evidence.endOffset === undefined
        || source.canonical_content.slice(evidence.startOffset,evidence.endOffset) !== evidence.quote);
    });
    if (!valid) { reject("Seed resolution needs exact later canonical source evidence"); continue; }
    seen.add(patch.detailId);
    accepted.push(patch);
  }
  return {accepted,dropped};
}

/** Informational job diagnostics only: no warning, pending review, or failed call. */
export function recordSeedResolutionDrops(db: RcmDatabase, jobId: string, dropped: SeedResolutionDrop[]) {
  if (dropped.length) db.prepare("UPDATE jobs SET payload_json=json_set(payload_json,'$.seedResolutionDrops',json(?)) WHERE id=?")
    .run(JSON.stringify(dropped),jobId);
}

export function applySeedResolutions(db: RcmDatabase, chatId: string, resolutions: SeedResolution[] = []) {
  const validated=validateSeedResolutions(db, chatId, resolutions);
  for (const patch of validated.accepted) {
    const row = db.prepare("SELECT seed_json FROM visible_memory_details WHERE id=? AND chat_id=?").get(patch.detailId,chatId) as {seed_json:string};
    db.prepare("UPDATE memory_details SET seed_json=?,updated_at=? WHERE id=? AND chat_id=?")
      .run(JSON.stringify({...readStorySeed(row.seed_json),status:patch.status,closureEvidence:patch.evidence}),Date.now(),patch.detailId,chatId);
  }
  return validated.dropped;
}

export function reopenSeedsBySource(db: RcmDatabase, chatId: string, messageId: string) {
  db.prepare(`UPDATE memory_details SET seed_json=json_remove(json_set(seed_json,'$.status','open'),'$.closureEvidence'),updated_at=?
    WHERE chat_id=? AND json_extract(seed_json,'$.status')='fulfilled' AND EXISTS(SELECT 1 FROM json_each(seed_json,'$.closureEvidence') WHERE value ->> '$.messageId'=?)`)
    .run(Date.now(),chatId,messageId);
}

export function storySeedCounts(db: RcmDatabase, chatId: string) {
  const counts = {open:0,fulfilled:0,abandoned:0,closed:0};
  for (const row of db.prepare(`SELECT json_extract(d.seed_json,'$.status') status,count(*) count FROM visible_memory_details d JOIN memories m ON m.id=d.memory_id
    WHERE d.chat_id=? AND d.active=1 AND m.active=1 AND d.seed_json IS NOT NULL GROUP BY status`).all(chatId) as Array<{status:keyof typeof counts;count:number}>) counts[row.status]=row.count;
  return counts;
}

type SeedEdit = {detailId:string;seed:ReturnType<typeof readStorySeed>};

/** Read only owning batches and possible later resolution batches, once per operation. */
function persistSeedsInReplay(db: RcmDatabase, chatId: string, edits: SeedEdit[], deliveryOnly = false) {
  if (!edits.length) return;
  const ids=JSON.stringify(edits.map(edit=>edit.detailId));
  const details=db.prepare(`SELECT d.id,d.detail_key,m.memory_key,m.source_batch_id FROM memory_details d JOIN memories m ON m.id=d.memory_id
    WHERE d.chat_id=? AND d.id IN (SELECT value FROM json_each(?))`).all(chatId,ids) as Array<{id:string;detail_key:string;memory_key:string;source_batch_id:string|null}>;
  const byId=new Map(details.map(detail=>[detail.id,detail]));
  const batches=db.prepare(`SELECT id,final_json FROM extraction_batches WHERE chat_id=? AND final_json IS NOT NULL AND (
    id IN (SELECT value FROM json_each(?)) OR (?=0 AND EXISTS(SELECT 1 FROM json_each(?) target WHERE instr(final_json,target.value)>0)))`)
    .all(chatId,JSON.stringify([...new Set(details.map(detail=>detail.source_batch_id).filter(Boolean))]),Number(deliveryOnly),ids) as Array<{id:string;final_json:string}>;
  for (const row of batches) {
    const value=JSON.parse(row.final_json);
    let changed=false;
    for (const edit of edits) {
      const detail=byId.get(edit.detailId);
      if (!detail) continue;
      if (row.id === detail.source_batch_id) for (const memory of value.memories ?? []) if (memory.key === detail.memory_key) for (const item of memory.details ?? []) if (item.key === detail.detail_key) {
        if (deliveryOnly) {
          // Receipt updates cannot rewrite an open replay atom into a model closure.
          if (item.seed && edit.seed?.delivery) item.seed.delivery=edit.seed.delivery;
        } else if (edit.seed) item.seed={...edit.seed,noticedBy:item.seed?.noticedBy ?? edit.seed.noticedBy};
        else delete item.seed;
        changed=true;
      }
      if (!deliveryOnly && value.seedResolutions?.some((patch:SeedResolution)=>patch.detailId === edit.detailId)) {
        value.seedResolutions=value.seedResolutions.filter((patch:SeedResolution)=>patch.detailId !== edit.detailId); changed=true;
      }
    }
    if (changed) db.prepare('UPDATE extraction_batches SET final_json=? WHERE id=?').run(JSON.stringify(value),row.id);
  }
}

export function editStorySeeds(db: RcmDatabase, chatId: string, detailIds: string[], action:'close'|'reopen'|'delete') {
  return db.transaction(()=>{
    const edits:SeedEdit[]=[];
    const results=[...new Set(detailIds)].map(detailId=>{
      const row=db.prepare(`SELECT d.seed_json FROM visible_memory_details d JOIN memories m ON m.id=d.memory_id
        WHERE d.chat_id=? AND d.id=? AND d.active=1 AND m.active=1`).get(chatId,detailId) as {seed_json:string}|undefined;
      const seed=readStorySeed(row?.seed_json);
      if (!seed) return {id:detailId,ok:false,error:'Seed not found'};
      const next=action === 'delete' ? undefined : {...seed,status:action === 'close' ? 'closed' as const : 'open' as const,closureEvidence:undefined};
      db.prepare('UPDATE memory_details SET seed_json=?,updated_at=? WHERE chat_id=? AND id=?').run(next ? JSON.stringify(next) : null,Date.now(),chatId,detailId);
      edits.push({detailId,seed:next});
      return {id:detailId,ok:true};
    });
    persistSeedsInReplay(db,chatId,edits);
    if (edits.length) db.prepare('UPDATE chats SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(),chatId);
    return results;
  })();
}

export function editStorySeed(db: RcmDatabase, chatId: string, detailId: string, action:'close'|'reopen'|'delete'): boolean {
  return editStorySeeds(db,chatId,[detailId],action)[0]!.ok;
}

/** Any actual automatic delivery of the detail counts, regardless of its selection lane.
 * The old receipt held only memory IDs: never infer detail delivery from a prepared card.
 * Store the small receipt summary on the marker so normal backup/keep/fork copying preserves it.
 */
export function recordSeedDelivery(db: RcmDatabase, chatId: string, atomKeys: string[], receipt: string) {
  assertChatUnlocked(db,chatId);
  const turn = (db.prepare("SELECT completed_turn_count FROM chats WHERE id=?").get(chatId) as {completed_turn_count:number}|undefined)?.completed_turn_count;
  if (turn === undefined) return;
  const delivered = new Set(atomKeys);
  db.transaction(() => {
    const edits:SeedEdit[]=[];
    for (const row of db.prepare(`SELECT d.id,d.text,d.seed_json FROM visible_memory_details d JOIN memories m ON m.id=d.memory_id
      WHERE d.chat_id=? AND d.active=1 AND m.active=1 AND d.seed_json IS NOT NULL`).all(chatId) as Array<{id:string;text:string;seed_json:string}>) {
      const seed = readStorySeed(row.seed_json);
      if (!seed || !delivered.has(memoryDetailAtomKey(row)) || seed.delivery?.receipt === receipt) continue;
      seed.delivery = {count:(seed.delivery?.count ?? 0)+1,lastTurn:turn,receipt};
      db.prepare("UPDATE memory_details SET seed_json=? WHERE id=? AND chat_id=?").run(JSON.stringify(seed),row.id,chatId);
      edits.push({detailId:row.id,seed});
    }
    persistSeedsInReplay(db,chatId,edits,true);
  })();
}

export function dashboardStorySeeds(db: RcmDatabase, chatId: string) {
  const turn = (db.prepare("SELECT completed_turn_count FROM chats WHERE id=?").get(chatId) as {completed_turn_count:number}|undefined)?.completed_turn_count ?? 0;
  return (db.prepare(`SELECT d.id,d.memory_id,d.text,d.user_edited,d.seed_json,d.source_start_ordinal,m.story_time_normalized
    FROM visible_memory_details d JOIN memories m ON m.id=d.memory_id WHERE d.chat_id=? AND d.active=1 AND m.active=1 AND d.seed_json IS NOT NULL`).all(chatId) as Array<any>).flatMap(row => {
    const seed = readStorySeed(row.seed_json);
    if (!seed) return [];
    const closureOrdinal = seed.status === 'fulfilled' ? seed.closureEvidence?.reduce((max, evidence) => {
      const ordinal = (db.prepare("SELECT ordinal FROM messages WHERE chat_id=? AND message_id=?").get(chatId,evidence.messageId) as {ordinal:number}|undefined)?.ordinal;
      return Math.max(max,ordinal ?? -1);
    },-1) : undefined;
    return [{id:row.id,memoryId:row.memory_id,text:row.text,userEdited:!!row.user_edited,noticedBy:seed.noticedBy,status:seed.status,
      lastMention:{ordinal:row.source_start_ordinal,storyTime:row.story_time_normalized},closureOrdinal,
      deliveryCount:seed.delivery?.count ?? 0,turnsSinceLastDelivery:seed.delivery ? Math.max(0,turn-seed.delivery.lastTurn) : null}];
  });
}
