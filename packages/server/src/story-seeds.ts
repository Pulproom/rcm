import { StorySeedSchema, type SeedResolution, type SeedMarker } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";

export function readStorySeed(value: unknown) {
  if (!value) return undefined;
  const parsed = StorySeedSchema.safeParse(typeof value === "string" ? JSON.parse(value) : value);
  if (!parsed.success) throw new Error("Invalid current story seed metadata");
  return parsed.data;
}

export function accessibleStorySeed(value: unknown, knownBy: string[]): SeedMarker | undefined {
  const seed=readStorySeed(value);
  if (!seed) return undefined;
  const normalize=(name:string)=>name.normalize("NFKC").trim().toLocaleLowerCase();
  const holders=new Set(knownBy.map(normalize));
  return {type:seed.type,status:seed.status,noticedBy:seed.noticedBy.filter(name=>holders.has(normalize(name)) || holders.has("__everyone__"))};
}

export function openStorySeeds(db: RcmDatabase, chatId: string) {
  return db.prepare(`SELECT d.id,d.text,d.seed_json,d.evidence_json,d.source_end_ordinal FROM memory_details d
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
    if (suppliedSeeds && !suppliedSeeds.has(patch.detailId)) { reject("Seed target was not supplied to the model"); continue; }
    if (seen.has(patch.detailId)) { reject("Duplicate seed resolution target"); continue; }
    const row = db.prepare(`SELECT d.seed_json,d.source_end_ordinal FROM memory_details d JOIN memories m ON m.id=d.memory_id
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
    const row = db.prepare("SELECT seed_json FROM memory_details WHERE id=? AND chat_id=?").get(patch.detailId,chatId) as {seed_json:string};
    db.prepare("UPDATE memory_details SET seed_json=?,updated_at=? WHERE id=? AND chat_id=?")
      .run(JSON.stringify({...readStorySeed(row.seed_json),status:patch.status,closureEvidence:patch.evidence}),Date.now(),patch.detailId,chatId);
  }
  return validated.dropped;
}

export function reopenSeedsBySource(db: RcmDatabase, chatId: string, messageId: string) {
  db.prepare(`UPDATE memory_details SET seed_json=json_remove(json_set(seed_json,'$.status','open'),'$.closureEvidence'),updated_at=?
    WHERE chat_id=? AND seed_json IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(seed_json,'$.closureEvidence') WHERE value ->> '$.messageId'=?)`)
    .run(Date.now(),chatId,messageId);
}

export function storySeedCounts(db: RcmDatabase, chatId: string) {
  const counts = {open:0,fulfilled:0,abandoned:0};
  for (const row of db.prepare(`SELECT json_extract(d.seed_json,'$.status') status,count(*) count FROM memory_details d JOIN memories m ON m.id=d.memory_id
    WHERE d.chat_id=? AND d.active=1 AND m.active=1 AND d.seed_json IS NOT NULL GROUP BY status`).all(chatId) as Array<{status:keyof typeof counts;count:number}>) counts[row.status]=row.count;
  return counts;
}
