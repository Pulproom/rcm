import { birthdayPeople, calculateOccasions, estimateTokens, latestStoryTime, type Occasion, type RpProfile } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { buildEntityIdentityResolver, listEntities, normalizeEntityName } from "./entities.js";
import { listRecordedSocialKnowledge } from "./social-knowledge.js";
import { parseLandmarkKinds } from "./memory-search-document.js";
import { searchableMemoryParentSql } from "./memory-group-search.js";
import { allowedByPerspective } from "./retrieval.js";
import { readViewPreferences } from "./view-preferences.js";

const escapeXml = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;")
  .replaceAll("\r", "&#13;").replaceAll("\n", "&#10;");
export type ScopedOccasion = Occasion & { scope: string };

/** Calendar metadata only. Access is decided from stored identities, recognition and parent grants. */
export function prepareOccasions(db: RcmDatabase, chatId: string, profile: RpProfile, perspectives: string[], personaHint?: string) {
  const rows = db.prepare(`SELECT id,type,known_by_json,story_time_normalized,story_time,landmark_kinds_json,created_revision AS source_ordinal
    FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()}`).all(chatId) as Array<{
    id: string; type: string; known_by_json: string; story_time_normalized: string | null;
    story_time: string | null; landmark_kinds_json: string; source_ordinal: number;
  }>;
  const memories = rows.map(row => ({ ...row, landmarkKinds: parseLandmarkKinds(row.landmark_kinds_json) }));
  const asOf = latestStoryTime({ memories: db.prepare("SELECT id,story_time_normalized,story_time FROM memories WHERE chat_id=? AND active=1").all(chatId) as typeof memories });
  const preferences = readViewPreferences(db, chatId);
  const entities = listEntities(db, chatId);
  // No inferred reverse interaction: option B requires the holder's own stored record.
  const recognition = listRecordedSocialKnowledge(db, chatId);
  const resolve = buildEntityIdentityResolver(db, chatId);
  const identity = (value: string) => {
    const resolved = resolve(value);
    return resolved.ambiguous ? null : normalizeEntityName(resolved.canonical);
  };
  const samePerson = (left: string, right: string) => identity(left) !== null && identity(left) === identity(right);
  const eligible = new Set(birthdayPeople({ entities, personaEntity: preferences.personaEntity ?? personaHint }).map(person => person.key));
  const narrator = perspectives.includes("narrator");
  const birthdayScopes = new Map<string, string>();
  const birthdays = entities.flatMap(entity => {
    if (!entity.birthday || !eligible.has(entity.id)) return [];
    const self = perspectives.filter(holder => samePerson(holder, entity.name));
    const interacted = perspectives.filter(holder => !self.includes(holder) && recognition.some(record =>
      record.level === "interacted" && samePerson(record.holder, holder) && samePerson(record.subject, entity.name)));
    if (!narrator && !self.length && !interacted.length) return [];
    const scope = [
      narrator ? "narrator only" : "",
      self.length ? `known by ${self.join(", ")}` : "",
      interacted.length ? `may know: ${interacted.join(", ")}; not certain` : "",
    ].filter(Boolean).join("; ");
    birthdayScopes.set(`birthday:${entity.id}`, scope);
    return [{ key: entity.id, name: entity.displayName, birthday: entity.birthday }];
  });
  // Authority/termination are chosen before access filtering, so an inaccessible
  // or hidden user basis cannot revive a superseded automatic basis.
  const candidates = calculateOccasions({ asOf, memories, birthdays, hidden: preferences.hiddenAnniversaries });
  const byId = new Map(rows.map(row => [row.id, row]));
  const items: ScopedOccasion[] = candidates.flatMap(item => {
    if (item.kind === "birthday") return [{ ...item, scope: birthdayScopes.get(item.key)! }];
    const row = byId.get(item.memoryId!);
    const holders = row ? perspectives.filter(holder => allowedByPerspective(row as Parameters<typeof allowedByPerspective>[0], profile, holder)) : [];
    return holders.length ? [{ ...item, scope: `known by ${holders.join(", ")}` }] : [];
  });
  return { asOf, items };
}

/** A single renderer-owned XML line, with whole nearest items and no memory IDs/counts. */
export function renderOccasions(asOf: string | null, items: ScopedOccasion[], budget = 160): string {
  if (!asOf || !items.length) return "";
  const wrap = (lines: string[]) => `<occasions as_of="${escapeXml(asOf)}">Use live-chat date; do not force celebration. May know is unconfirmed: ask or hedge, never invent prior disclosure or certain recall. ${lines.join(" ")}</occasions>`;
  const kept: string[] = [];
  for (const item of items) {
    const label = item.pair ? `${item.pair.join("/")} ${item.label}` : item.label;
    const elapsed = item.days ? `; ${item.days} days` : item.years ? `; ${item.years} years` : "";
    const line = `<occasion date="${item.date}" offset="${item.remaining}" scope="${escapeXml(item.scope + elapsed)}">${escapeXml(label)}</occasion>`;
    if (estimateTokens(wrap([...kept, line])) <= budget) kept.push(line);
  }
  return kept.length ? wrap(kept) : "";
}
