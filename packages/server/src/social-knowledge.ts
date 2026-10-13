import { refreshMemoryFts } from "./memory-search-document.js";
import { EVERYONE_HOLDER } from "./item-access.js";
import { randomUUID } from "node:crypto";
import { estimateTokens, type ExtractionResult, type SocialKnowledge } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { buildEntityIdentityResolver, listEntities, normalizeEntityName } from "./entities.js";
import { canAutomaticallyChange, committedEditOrdinal, correctionView, UNCORRECTED_SQL } from "./user-corrections.js";
import { invalidateStorySupports, storyMemorySupportIds } from "./story-spine.js";

export type SocialKnowledgeLevel = "aware_of" | "interacted";
type SocialEvidence = { messageId: string; quote?: string } | { sourceKind: "setup"; setupFingerprint: string; sourceIndex: number; quote: string };
type IngestedSocialKnowledge = Omit<SocialKnowledge, "addressTerms"> & { addressTerms?: string[] };

interface EventRow {
  id: string;
  holder: string;
  subject: string;
  action: "establish" | "retract";
  level: SocialKnowledgeLevel | null;
  known_as_json: string;
  address_terms_json: string;
  cognition_detail_ids_json: string;
  evidence_json: string;
  manual: number;
  user_edit_ordinal: number | null;
  auto_locked: number;
  created_revision: number;
  created_at: number;
}

export interface SocialKnowledgeItem {
  id: string;
  holder: string;
  subject: string;
  level: SocialKnowledgeLevel;
  knownAs: string[];
  addressTerms: string[];
  cognition: Array<{ id: string; text: string }>;
  evidence: SocialEvidence[];
  manual: boolean;
  userEdited: boolean;
  userEditOrdinal: number | null;
  locked: boolean;
  updatedAt: number;
  derived?: "mutual_interaction";
  derivedFrom?: string;
}

const levelRank = (value: SocialKnowledgeLevel): number => value === "interacted" ? 2 : 1;
const nextEventTime = (db: RcmDatabase, chatId: string): number => Math.max(
  now(),
  Number((db.prepare("SELECT MAX(created_at) value FROM social_knowledge_events WHERE chat_id=?").get(chatId) as { value: number | null }).value ?? 0) + 1,
);
const parseArray = <T>(value: string): T[] => {
  try { return JSON.parse(value) as T[]; }
  catch { return []; }
};

// Resolve event references before checking atom activity: activity is derived from
// this view, so using the filtered public list here would prevent reactivation.
const currentEventsSql = `FROM social_knowledge_events WHERE chat_id=? AND active=1
  ORDER BY COALESCE(user_edit_ordinal,source_end_ordinal,source_start_ordinal,-1),created_revision,created_at,id`;
function cognitionReferences(row: Pick<EventRow,'cognition_detail_ids_json'|'manual'>, previous: string[] = []): string[] {
  const ids = parseArray<string>(row.cognition_detail_ids_json);
  return ids.length || row.manual ? ids : previous;
}

function socialKnowledgeView(db: RcmDatabase, chatId: string): Array<SocialKnowledgeItem & { detailIds: string[] }> {
  const current = new Map<string, Omit<SocialKnowledgeItem,'knownAs'|'addressTerms'|'evidence'> & {
    detailIds: string[]; knownAs: Set<string>; addressTerms: Set<string>; evidence: Map<string,SocialEvidence>;
  }>();
  const rows=db.prepare(`SELECT * ${currentEventsSql}`).all(chatId) as EventRow[];
  for (const row of rows) {
    const key = `${normalizeEntityName(row.holder)}\0${normalizeEntityName(row.subject)}`;
    if (row.action === "retract") { current.delete(key); continue; }
    if (!row.level) continue;
    const previous = current.get(key);
    const knownAs = previous?.knownAs ?? new Set<string>();
    const addressTerms = previous?.addressTerms ?? new Set<string>();
    const evidence = previous?.evidence ?? new Map<string,SocialEvidence>();
    for (const value of parseArray<string>(row.known_as_json)) knownAs.add(value);
    for (const value of parseArray<string>(row.address_terms_json)) addressTerms.add(value);
    for (const item of parseArray<SocialEvidence>(row.evidence_json)) {
      const identity=JSON.stringify(item);
      if (!evidence.has(identity)) evidence.set(identity,item);
    }
    current.set(key, {
      id: row.id,
      holder: row.holder,
      subject: row.subject,
      level: previous && levelRank(previous.level) > levelRank(row.level) ? previous.level : row.level,
      knownAs,
      addressTerms,
      cognition: [],
      detailIds: cognitionReferences(row,previous?.detailIds),
      evidence,
      manual: Boolean(row.manual || previous?.manual),
      ...(row.user_edit_ordinal != null ? correctionView(row) : {userEdited:previous?.userEdited ?? false,userEditOrdinal:previous?.userEditOrdinal ?? null,locked:previous?.locked ?? false}),
      updatedAt: row.created_at,
    });
  }
  return [...current.values()].map(item=>({...item,knownAs:[...item.knownAs],addressTerms:[...item.addressTerms],evidence:[...item.evidence.values()]}))
    .sort((left, right) => left.holder.localeCompare(right.holder) || left.subject.localeCompare(right.subject));
}

function listRecordedSocialKnowledge(db: RcmDatabase, chatId: string): SocialKnowledgeItem[] {
  return socialKnowledgeView(db, chatId).map(({detailIds,...item}) => ({...item, cognition: detailIds.flatMap(id => {
    const detail = db.prepare(`SELECT d.id,d.text FROM memory_details d JOIN memories m ON m.id=d.memory_id
      WHERE d.id=? AND d.chat_id=? AND d.active=1 AND m.active=1 AND EXISTS
      (SELECT 1 FROM item_access a WHERE a.chat_id=d.chat_id AND a.item_kind='detail'
       AND a.item_id=d.id AND a.active=1 AND (a.holder=? COLLATE NOCASE OR a.holder=?))`)
      .get(id, chatId, item.holder, EVERYONE_HOLDER) as { id: string; text: string } | undefined;
    return detail ? [detail] : [];
  })}));
}

/** Direct interaction is mutual; names, cognition and edit protection remain directional.
 * Derive only from recorded items so a reverse view can never sustain its source. */
export function listSocialKnowledge(db: RcmDatabase, chatId: string): SocialKnowledgeItem[] {
  const recorded = listRecordedSocialKnowledge(db, chatId);
  const key = (holder: string, subject: string) => JSON.stringify([normalizeEntityName(holder), normalizeEntityName(subject)]);
  const effective = new Map(recorded.map(item => [key(item.holder, item.subject), item]));
  for (const source of recorded) {
    if (source.level !== "interacted") continue;
    const reverseKey = key(source.subject, source.holder);
    const reverse = effective.get(reverseKey);
    if (reverse?.level === "interacted") continue;
    effective.set(reverseKey, {
      ...(reverse ?? {
        id: `mutual:${source.id}`, holder: source.subject, subject: source.holder,
        knownAs: [], addressTerms: [], cognition: [], evidence: [],
        manual: false, userEdited: false, userEditOrdinal: null, locked: false, updatedAt: source.updatedAt,
      }),
      level: "interacted", derived: "mutual_interaction", derivedFrom: source.id,
    });
  }
  return [...effective.values()];
}

/** User-owned recognition atoms are deliverable only while the current pair
 * view references them. Grants retain their independent permission lifecycle. */
export function syncManualCognition(db: RcmDatabase, chatId: string, invalidatedSupports?: Set<string>): void {
  const supports=invalidatedSupports ?? new Set<string>();
  const memories = db.prepare(`SELECT m.id,m.active FROM memories m WHERE m.chat_id=? AND m.user_managed=1
    AND m.memory_key LIKE 'manual:%' AND EXISTS (SELECT 1 FROM memory_details d
      WHERE d.memory_id=m.id AND (d.detail_key='recognition' OR d.detail_key LIKE 'recognition:%'))`)
    .all(chatId) as Array<{id:string;active:number}>;
  if (!memories.length) return;
  // Activation needs only the final pair references, never merged prose/evidence.
  const current = new Map<string,string[]>();
  const rows=db.prepare(`SELECT holder,subject,action,level,manual,cognition_detail_ids_json ${currentEventsSql}`)
    .all(chatId) as Array<Pick<EventRow,'holder'|'subject'|'action'|'level'|'manual'|'cognition_detail_ids_json'>>;
  for (const row of rows) {
    const key = `${normalizeEntityName(row.holder)}\0${normalizeEntityName(row.subject)}`;
    if (row.action === 'retract') current.delete(key);
    else if (row.level) current.set(key,cognitionReferences(row,current.get(key)));
  }
  const referenced = new Set([...current.values()].flat());
  for (const memory of memories) {
    const details = db.prepare("SELECT id,active FROM memory_details WHERE chat_id=? AND memory_id=?").all(chatId,memory.id) as Array<{id:string;active:number}>;
    const active = Number(details.some(detail => referenced.has(detail.id)));
    for (const detail of details) {
      const detailActive = Number(referenced.has(detail.id));
      if (detail.active && !detailActive) supports.add(`detail:${detail.id}`);
      if (detail.active !== detailActive) db.prepare("UPDATE memory_details SET active=? WHERE id=?").run(detailActive,detail.id);
    }
    if (memory.active && !active) storyMemorySupportIds(db,chatId,[memory.id]).forEach(id=>supports.add(id));
    if (memory.active !== active) db.prepare("UPDATE memories SET active=? WHERE id=?").run(active,memory.id);
  }
  // Source sync and compound mutations collect into their existing set and
  // invalidate once after all changes; direct edits finish at this boundary.
  if (!invalidatedSupports) invalidateStorySupports(db,chatId,supports);
}

export function canAutomaticallyChangeSocialKnowledge(db: RcmDatabase, chatId: string, holder: string, subject: string, evidence: readonly {messageId?: string}[]): boolean {
  const correction = db.prepare(`SELECT * FROM social_knowledge_events WHERE chat_id=? AND holder=? COLLATE NOCASE
    AND subject=? COLLATE NOCASE AND active=1 AND (user_edit_ordinal IS NOT NULL OR auto_locked=1)
    ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(chatId,holder,subject) as EventRow | undefined;
  return !correction || canAutomaticallyChange(db,chatId,correction,evidence);
}

function evidenceOrdinals(db: RcmDatabase, chatId: string, evidence: SocialKnowledge["evidence"]): { start: number | null; end: number | null } {
  if (evidence.length === 0) return { start: null, end: null };
  const ids = [...new Set(evidence.map((item) => item.messageId))];
  const row = db.prepare(`SELECT MIN(ordinal) start,MAX(ordinal) end FROM messages WHERE chat_id=? AND message_id IN (${ids.map(() => "?").join(",")})`)
    .get(chatId, ...ids) as { start: number | null; end: number | null };
  return row ?? { start: null, end: null };
}

export function ingestSocialKnowledge(
  db: RcmDatabase,
  chatId: string,
  items: IngestedSocialKnowledge[],
  memoryByKey: Map<string, string> = new Map(),
  sourceBatchId?: string,
): number {
  const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
  if (!chat) return 0;
  let inserted = 0;
  for (const item of items) {
    if (normalizeEntityName(item.holder) === normalizeEntityName(item.subject)) continue;
    const current = socialKnowledgeView(db, chatId).find((row) =>
      normalizeEntityName(row.holder) === normalizeEntityName(item.holder)
      && normalizeEntityName(row.subject) === normalizeEntityName(item.subject));
    if (!canAutomaticallyChangeSocialKnowledge(db,chatId,item.holder,item.subject,item.evidence)) continue;
    const knownAs = [...new Set(item.knownAs.map((value) => value.trim()).filter(Boolean))];
    const addressTerms = [...new Set((item.addressTerms ?? []).map((value) => value.trim()).filter(Boolean))];
    const cognitionIds = (item.cognitionDetailKeys ?? []).map(key => {
      const memoryId = item.memoryKey && memoryByKey.get(item.memoryKey);
      const detail = db.prepare(`SELECT d.id FROM memory_details d WHERE d.chat_id=? AND d.memory_id=?
        AND d.detail_key=? AND d.active=1 AND EXISTS (SELECT 1 FROM item_access a WHERE a.chat_id=d.chat_id
        AND a.item_kind='detail' AND a.item_id=d.id AND a.active=1 AND a.holder=? COLLATE NOCASE)`)
        .get(chatId, memoryId ?? null, key, item.holder) as { id: string } | undefined;
      if (!detail) throw new Error("Cognition detail requires live evidence and access for its holder");
      return detail.id;
    });
    if (current && !cognitionIds.length && levelRank(current.level) >= levelRank(item.level)
      && knownAs.every((value) => current.knownAs.some((known) => normalizeEntityName(known) === normalizeEntityName(value)))
      && addressTerms.every((value) => current.addressTerms.includes(value))) continue;
    const range = evidenceOrdinals(db, chatId, item.evidence);
    db.prepare(`
      INSERT INTO social_knowledge_events(
        id,chat_id,holder,subject,action,level,known_as_json,address_terms_json,evidence_json,source_memory_id,
        source_batch_id,source_start_ordinal,source_end_ordinal,manual,active,created_revision,created_at,cognition_detail_ids_json
      ) VALUES(?,?,?,?,'establish',?,?,?,?,?,?,?,?,0,1,?,?,?)
    `).run(
      randomUUID(), chatId, item.holder, item.subject, item.level, JSON.stringify(knownAs), JSON.stringify(addressTerms), JSON.stringify(item.evidence),
      item.memoryKey ? memoryByKey.get(item.memoryKey) ?? null : null, sourceBatchId ?? null, range.start, range.end, chat.revision, now(), JSON.stringify(cognitionIds),
    );
    inserted += 1;
  }
  syncManualCognition(db,chatId);
  return inserted;
}

export function setManualSocialKnowledge(
  db: RcmDatabase,
  chatId: string,
  input: { holder: string; subject: string; level: SocialKnowledgeLevel; knownAs: string[]; addressTerms?: string[]; previousHolder?: string; previousSubject?: string; description?: string; locked?: boolean },
): SocialKnowledgeItem[] {
  const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
  if (!chat) throw new Error("Chat not found");
  if (normalizeEntityName(input.holder) === normalizeEntityName(input.subject)) throw new Error("Holder and subject must differ");
  if ((input.description?.length ?? 0) > 20_000) throw new Error("Recognition description is too long");
  const ordinal = committedEditOrdinal(db,chatId);
  const timestamp = nextEventTime(db, chatId);
  const previousHolder = input.previousHolder?.trim() || input.holder.trim();
  const previousSubject = input.previousSubject?.trim() || input.subject.trim();
  const previous = listRecordedSocialKnowledge(db, chatId).find((item) =>
    normalizeEntityName(item.holder) === normalizeEntityName(previousHolder)
    && normalizeEntityName(item.subject) === normalizeEntityName(previousSubject));
  const samePair = normalizeEntityName(input.holder) === normalizeEntityName(previousHolder)
    && normalizeEntityName(input.subject) === normalizeEntityName(previousSubject);
  const addressTerms = input.addressTerms ?? (samePair ? previous?.addressTerms ?? [] : []);
  const evidence = samePair ? previous?.evidence ?? [] : [];
  db.transaction(() => {
    let detailIds: string[] = [];
    const description = input.description?.trim();
    const texts = description ? [description] : input.description === undefined && samePair
      ? previous?.cognition.map(item => item.text) ?? [] : [];
    const previousTexts = previous?.cognition.map(item => item.text) ?? [];
    const unchanged = samePair && new Set(texts).size === new Set(previousTexts).size
      && texts.every(text => previousTexts.includes(text));
    if (texts.length && unchanged && previous!.cognition.every(item => db.prepare(`SELECT 1 FROM memory_details d JOIN memories m ON m.id=d.memory_id
      WHERE d.id=? AND d.chat_id=? AND m.user_managed=1 AND m.memory_key LIKE 'manual:%'`).get(item.id,chatId))) {
      detailIds = previous!.cognition.map(item => item.id);
    } else if (texts.length) {
      const memoryId = randomUUID();
      db.prepare(`INSERT INTO memories(id,chat_id,memory_key,type,title,content,participants_json,known_by_json,retention_class,atom_access_version,user_managed,created_revision,created_at,updated_at)
        VALUES(?,?,?,'belief',?,?,?,?,'durable',1,1,?,?,?)`).run(memoryId, chatId, `manual:${memoryId}`, `${input.holder} → ${input.subject}`, texts.join('\n'),
          JSON.stringify([input.holder,input.subject]), JSON.stringify([input.holder]), chat.revision, timestamp, timestamp);
      for (const [index,text] of texts.entries()) {
        const detailId = randomUUID();
        db.prepare(`INSERT INTO memory_details(id,chat_id,memory_id,detail_key,role,kind,text,known_by_json,epistemic,retention_class,created_revision,created_at,updated_at)
          VALUES(?,?,?,?,'core','character_state',?,?,'stated','durable',?,?,?)`).run(detailId, chatId, memoryId, `recognition:${index}`, text, JSON.stringify([input.holder]), chat.revision, timestamp, timestamp);
        db.prepare(`INSERT INTO item_access(id,chat_id,item_kind,item_id,holder,basis,evidence_json,confidence,active,source_revision,created_at)
          VALUES(?,?,'detail',?,?,'internal','[]',1,1,?,?)`).run(randomUUID(), chatId, detailId, input.holder, chat.revision, timestamp);
        detailIds.push(detailId);
      }
      refreshMemoryFts(db, memoryId);
    }

    if (socialKnowledgeView(db, chatId).some((item) => normalizeEntityName(item.holder) === normalizeEntityName(previousHolder) && normalizeEntityName(item.subject) === normalizeEntityName(previousSubject))) {
      db.prepare(`INSERT INTO social_knowledge_events(id,chat_id,holder,subject,action,level,known_as_json,evidence_json,source_start_ordinal,source_end_ordinal,manual,active,created_revision,created_at)
        VALUES(?,?,?,?,'retract',NULL,'[]','[]',?,?,1,1,?,?)`)
        .run(randomUUID(), chatId, previousHolder, previousSubject, ordinal, ordinal, chat.revision, timestamp);
    }
    db.prepare(`
      INSERT INTO social_knowledge_events(id,chat_id,holder,subject,action,level,known_as_json,address_terms_json,evidence_json,source_start_ordinal,source_end_ordinal,manual,active,created_revision,created_at,cognition_detail_ids_json)
      VALUES(?,?,?,?,'establish',?,?,?,?,?,?,1,1,?,?,?)
    `).run(randomUUID(), chatId, input.holder.trim(), input.subject.trim(), input.level, JSON.stringify([...new Set(input.knownAs.map((value) => value.trim()).filter(Boolean))]),
      JSON.stringify(addressTerms), JSON.stringify(evidence), ordinal, ordinal, chat.revision, timestamp + 1, JSON.stringify(detailIds));
    db.prepare("UPDATE social_knowledge_events SET user_edit_ordinal=?,auto_locked=? WHERE chat_id=? AND created_at IN (?,?) AND manual=1")
      .run(ordinal,Number(input.locked ?? previous?.locked ?? false),chatId,timestamp,timestamp+1);
    syncManualCognition(db,chatId);
  })();
  return listSocialKnowledge(db, chatId);
}

export function retractSocialKnowledge(db: RcmDatabase, chatId: string, holder: string, subject: string): SocialKnowledgeItem[] {
  const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
  if (!chat) throw new Error("Chat not found");
  const ordinal = committedEditOrdinal(db,chatId);
  const timestamp=nextEventTime(db,chatId);
  db.prepare(`
    INSERT INTO social_knowledge_events(id,chat_id,holder,subject,action,level,known_as_json,evidence_json,source_start_ordinal,source_end_ordinal,manual,active,created_revision,created_at)
    VALUES(?,?,?,?,'retract',NULL,'[]','[]',?,?,1,1,?,?)
  `).run(randomUUID(), chatId, holder, subject, ordinal, ordinal, chat.revision, timestamp);
  db.prepare("UPDATE social_knowledge_events SET user_edit_ordinal=? WHERE chat_id=? AND created_at=? AND manual=1").run(ordinal,chatId,timestamp);
  syncManualCognition(db,chatId);
  return listSocialKnowledge(db, chatId);
}

export function socialOnlyResult(result: ExtractionResult): ExtractionResult {
  return {
    language: result.language,
    entities: result.entities,
    memories: result.memories.filter(memory => result.socialKnowledge?.some(social => social.memoryKey === memory.key)), assertions: [], beliefs: [], relationshipEvents: [], promises: [],
    socialKnowledge: result.socialKnowledge,
  };
}

export function invalidateSocialKnowledgeEvidence(db: RcmDatabase, chatId: string, messageIds: Iterable<string>): number {
  const targets = new Set(messageIds);
  if (targets.size === 0) return 0;
  const rows = db.prepare(`SELECT id,evidence_json FROM social_knowledge_events WHERE chat_id=? AND active=1 AND ${UNCORRECTED_SQL}`).all(chatId) as Array<{ id: string; evidence_json: string }>;
  let changed = 0;
  for (const row of rows) {
    const evidence = parseArray<{ messageId: string }>(row.evidence_json);
    if (!evidence.some((item) => targets.has(item.messageId))) continue;
    changed += db.prepare("UPDATE social_knowledge_events SET active=0 WHERE id=? AND active=1").run(row.id).changes;
  }
  return changed;
}

/** Exact registered identifier lookup, not interpretation of RP prose. */
export function mentionedCharacters(db: RcmDatabase, chatId: string, text: string): string[] {
  const resolve = buildEntityIdentityResolver(db, chatId);
  const normalized = normalizeEntityName(text);
  return listEntities(db, chatId).filter(entity => ["person", "character"].includes(entity.type)
    && [entity.name, entity.key, ...entity.aliases].some(term => {
      const identity = resolve(term);
      if (identity.ambiguous || normalizeEntityName(identity.canonical) !== normalizeEntityName(entity.name)) return false;
      const name = normalizeEntityName(term);
      if (!name) return false;
      let offset = normalized.indexOf(name);
      while (offset >= 0) {
        const before = Array.from(normalized.slice(0, offset)).at(-1) ?? "";
        const after = Array.from(normalized.slice(offset + name.length))[0] ?? "";
        if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true;
        offset = normalized.indexOf(name, offset + 1);
      }
      return false;
    })).map(entity => entity.name);
}

export interface SceneNames { text: string; pairCount: number; omittedCount: number }

/** One stable, holder-scoped renderer shared by automatic packets and MCP. */
export function renderSceneNames(db: RcmDatabase, chatId: string, holders: string[], present: string[], mentioned: string[], tokenBudget = 200): SceneNames {
  const resolve = buildEntityIdentityResolver(db, chatId);
  const characters = new Set(listEntities(db, chatId).filter(entity => ["person", "character"].includes(entity.type)).map(entity => normalizeEntityName(entity.name)));
  const canonical = (value: string): string => {
    const identity = resolve(value);
    return identity.ambiguous ? "" : normalizeEntityName(identity.canonical);
  };
  const holderSet = new Set(holders.map(canonical).filter(name => characters.has(name)));
  const presentSet = new Set(present.map(canonical));
  const subjectSet = new Set([...present, ...mentioned].map(canonical));
  const visible = new Map(listSocialKnowledge(db, chatId).map(item => [item.id, item]));
  const pairs = socialKnowledgeView(db, chatId).filter(item => holderSet.has(canonical(item.holder))
    && subjectSet.has(canonical(item.subject)) && characters.has(canonical(item.subject))
    && canonical(item.holder) !== canonical(item.subject) && (item.knownAs.length || item.addressTerms.length)
    // A referenced recognition atom must still be accessible to its holder.
    && (!item.detailIds.length || visible.get(item.id)!.cognition.length > 0))
    .sort((a, b) => Number(presentSet.has(canonical(b.subject))) - Number(presentSet.has(canonical(a.subject)))
      || a.holder.localeCompare(b.holder) || a.subject.localeCompare(b.subject));
  const quote = (value: string) => JSON.stringify(value);
  const lines: string[] = [];
  const render = () => lines.length ? ("Names in this scene:\n" + lines.join("\n")).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") : "";
  for (const item of pairs.slice(0, 8)) {
    // Never use an alias or canonical identity the holder has not learned.
    const label = item.knownAs.find(name => normalizeEntityName(name) === normalizeEntityName(item.subject)) ?? item.knownAs[0] ?? "unnamed person";
    const fields = [item.knownAs.length ? "knows as " + item.knownAs.map(quote).join(", ") : "",
      item.addressTerms.length ? "calls " + item.addressTerms.map(quote).join(", ") : ""].filter(Boolean);
    lines.push("- " + item.holder + " → " + label + ": " + fields.join("; "));
    if (estimateTokens(render()) > Math.min(200, tokenBudget)) { lines.pop(); break; }
  }
  return { text: render(), pairCount: lines.length, omittedCount: pairs.length - lines.length };
}

/** Insert inside the product-owned MCP envelope consumed by all adapters. */
export function appendSceneNames(packet: string, names: SceneNames): string {
  return names.text ? packet.replace("</rp_memory_result>", "\n" + names.text + "\n</rp_memory_result>") : packet;
}
