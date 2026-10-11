import { SocialRelationSchema, type SocialRelation } from "@rcm/shared";
import { EVERYONE_HOLDER, intersectAccessKnowledge } from "./item-access.js";
import type { RcmDatabase } from "./db.js";
import { normalizeEntityName } from "./entities.js";

export interface StoredSocialRelation extends SocialRelation { detailIds: string[]; manual?: boolean; knownBy?: string[]; knownByEveryone?: boolean }
export function parseSocialRelation(value: unknown): StoredSocialRelation | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const parsed = JSON.parse(value);
  const relation = SocialRelationSchema.parse(parsed);
  return { ...relation, detailIds: Array.isArray(parsed.detailIds) ? parsed.detailIds : [],
    ...(parsed.manual === true ? { manual: true, knownByEveryone: parsed.knownByEveryone === true, knownBy: Array.isArray(parsed.knownBy) ? parsed.knownBy : [] } : {}) };
}
/** Missing/revoked support hides the derived fact even from authorial retrieval. */
export function socialRelationKnowledge(db: RcmDatabase, chatId: string, relation: StoredSocialRelation): string[] | undefined {
  if (relation.manual) return relation.knownByEveryone ? [EVERYONE_HOLDER] : relation.knownBy ?? [];
  if (!relation.detailIds.length) return undefined;
  let common: string[] | undefined;
  for (const id of relation.detailIds) {
    if (!db.prepare(`SELECT 1 FROM memory_details d JOIN memories m ON m.id=d.memory_id
      WHERE d.id=? AND d.chat_id=? AND d.active=1 AND m.active=1`).get(id, chatId)) return undefined;
    const holders = (db.prepare("SELECT holder FROM item_access WHERE chat_id=? AND item_kind='detail' AND item_id=? AND active=1").all(chatId, id) as { holder: string }[]).map(row => row.holder);
    common = common === undefined ? holders : intersectAccessKnowledge(common, holders);
  }
  return common ?? [];
}
export function resolveSocialRelation(db: RcmDatabase, chatId: string, relation: SocialRelation & { memoryKey: string; detailKeys: string[] }, memoryByKey: Map<string, string>): StoredSocialRelation {
  const memoryId = memoryByKey.get(relation.memoryKey) ?? (db.prepare("SELECT id FROM memories WHERE chat_id=? AND memory_key=? AND active=1").get(chatId, relation.memoryKey) as { id: string } | undefined)?.id;
  const detailIds = relation.detailKeys.map(key => {
    const row = db.prepare("SELECT id FROM memory_details WHERE chat_id=? AND memory_id=? AND detail_key=? AND active=1").get(chatId, memoryId ?? null, key) as { id: string } | undefined;
    if (!row) throw new Error("Social relation requires active supporting details in its memory");
    return row.id;
  });
  return { ...SocialRelationSchema.parse(relation), detailIds: [...new Set(detailIds)] };
}

/** Typed endpoints partition ledger properties; labels remain free text, never parsed. */
export function sameSocialRelationScope(stored: unknown, incoming: SocialRelation | undefined): boolean {
  const relation = parseSocialRelation(stored);
  return !relation && !incoming || !!relation && !!incoming
    && relation.target.trim().toLocaleLowerCase() === incoming.target.trim().toLocaleLowerCase()
    && relation.kind === incoming.kind && relation.direction === incoming.direction;
}

interface ActiveSocialRelation { id: string; subject: string; relation: StoredSocialRelation }

export function activeSocialRelations(db: RcmDatabase, chatId: string): ActiveSocialRelation[] {
  const rows = db.prepare(`SELECT id,subject,social_relation_json FROM assertions
    WHERE chat_id=? AND valid_to_revision IS NULL AND social_relation_json IS NOT NULL
    ORDER BY valid_from_revision DESC,created_at DESC`).all(chatId) as Array<{ id: string; subject: string; social_relation_json: string }>;
  return rows.map(row => ({ id: row.id, subject: row.subject, relation: parseSocialRelation(row.social_relation_json)! }));
}

/** Compare typed endpoints, without interpreting predicates or label wording. */
function relationOrientation(stored: ActiveSocialRelation, subject: string, incoming: SocialRelation): "same" | "reverse" | undefined {
  if (stored.relation.kind !== incoming.kind) return undefined;
  const from = normalizeEntityName(subject), to = normalizeEntityName(incoming.target);
  const storedFrom = normalizeEntityName(stored.subject), storedTo = normalizeEntityName(stored.relation.target);
  if (from === storedFrom && to === storedTo) return "same";
  if (incoming.kind === "interpersonal" && from === storedTo && to === storedFrom) return "reverse";
  return undefined;
}

export function socialRelationCovers(stored: ActiveSocialRelation, subject: string, incoming: SocialRelation): boolean {
  const orientation = relationOrientation(stored, subject, incoming);
  return orientation === "same" || orientation === "reverse" && stored.relation.direction === "mutual";
}

const normalizeRelationLabel = (label: string): string => label.normalize("NFKC").trim().toLocaleLowerCase();
export const sameSocialRelationLabel = (left: SocialRelation, right: SocialRelation): boolean =>
  normalizeRelationLabel(left.label) === normalizeRelationLabel(right.label);

export function sameSocialRelationIdentity(subject: string, relation: SocialRelation, nextSubject: string, next: SocialRelation): boolean {
  return normalizeEntityName(subject) === normalizeEntityName(nextSubject)
    && normalizeEntityName(relation.target) === normalizeEntityName(next.target)
    && relation.kind === next.kind && relation.direction === next.direction && sameSocialRelationLabel(relation, next);
}

/** Predicate collisions for typed relations partition by target/kind, not direction. */
export function socialRelationPredicateCollisions(db: RcmDatabase, chatId: string, subject: string, predicate: string, incoming: SocialRelation):
  Array<{ id: string; relation: StoredSocialRelation | undefined }> {
  const rows = db.prepare(`SELECT id,social_relation_json FROM assertions WHERE chat_id=? AND subject=? COLLATE NOCASE
    AND predicate=? COLLATE NOCASE AND valid_to_revision IS NULL`).all(chatId, subject, predicate) as Array<{ id: string; social_relation_json: string | null }>;
  return rows.map(row => ({ id: row.id, relation: parseSocialRelation(row.social_relation_json) }))
    .filter(row => !row.relation || row.relation.kind === incoming.kind && normalizeEntityName(row.relation.target) === normalizeEntityName(incoming.target));
}

export function isReverseMutualSocialRelation(stored: ActiveSocialRelation, subject: string, incoming: SocialRelation): boolean {
  return relationOrientation(stored, subject, incoming) === "reverse" && sameSocialRelationLabel(stored.relation, incoming)
    && (stored.relation.direction === "mutual" || incoming.direction === "mutual");
}

export function findSocialRelationConflict(db: RcmDatabase, chatId: string, subject: string, incoming: SocialRelation, excludeIds: readonly string[] = []):
  { code: "DUPLICATE_LEDGER_ITEM" | "REVERSE_RELATION_EXISTS"; existingId: string } | undefined {
  for (const stored of activeSocialRelations(db, chatId)) {
    if (excludeIds.includes(stored.id) || !sameSocialRelationLabel(stored.relation, incoming)) continue;
    const orientation = relationOrientation(stored, subject, incoming);
    if (orientation === "same" || isReverseMutualSocialRelation(stored, subject, incoming)) return { code: "DUPLICATE_LEDGER_ITEM", existingId: stored.id };
    if (orientation === "reverse") return { code: "REVERSE_RELATION_EXISTS", existingId: stored.id };
  }
  return undefined;
}
