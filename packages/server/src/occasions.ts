import { isPersonEntityType, escapeMemoryText, escapeMemoryAttribute as escapeXml } from "@rcm/shared";
import { chatPacketPricing, type PacketPricing, chargedSectionTokens } from "./charged-cost.js";
import type { RetrievalAudience } from "./retrieval.js";
import { birthdayPeople, calculateOccasions, occasionPacketLabel, scopeOf, standaloneScopeText, latestStoryTime, type KnowledgeScope, type Occasion, type RpProfile } from "@rcm/shared";
import { loadPlotKnowers, publicKnowledgeScope } from "./item-access.js";
import type { RcmDatabase } from "./db.js";
import { buildEntityIdentityResolver, modelEntityContext, normalizeEntityName } from "./entities.js";
import { listRecordedSocialKnowledge } from "./social-knowledge.js";
import { parseLandmarkKinds } from "./memory-search-document.js";
import { searchableMemoryParentSql } from "./memory-group-search.js";
import { allowedByPerspective } from "./retrieval.js";
import { readViewPreferences } from "./view-preferences.js";

export type ScopedOccasion = Occasion & { scope: KnowledgeScope; mayKnow?: string[] };

/** Calendar metadata only. Access is decided from stored identities, recognition and parent grants. */
export function prepareOccasions(db: RcmDatabase, chatId: string, profile: RpProfile, perspectives: string[], personaHint?: string, audience?: RetrievalAudience) {
  const rows = db.prepare(`SELECT id,type,card_shape,known_by_json,story_time_normalized,story_time,landmark_kinds_json,created_revision AS source_ordinal
    FROM memories WHERE chat_id=? AND active=1 AND ${searchableMemoryParentSql()}`).all(chatId) as Array<{
    id: string; type: string; card_shape: 0 | 1; known_by_json: string; story_time_normalized: string | null;
    story_time: string | null; landmark_kinds_json: string; source_ordinal: number;
  }>;
  const plotHolders = loadPlotKnowers(db, chatId, rows);
  const memories = rows.map(row => ({ ...row, landmarkKinds: parseLandmarkKinds(row.landmark_kinds_json) }));
  const asOf = latestStoryTime({ memories: db.prepare("SELECT id,story_time_normalized,story_time FROM memories WHERE chat_id=? AND active=1").all(chatId) as typeof memories });
  const preferences = readViewPreferences(db, chatId);
  const entities = modelEntityContext(db, chatId).entities;
  // No inferred reverse interaction: option B requires the holder's own stored record.
  const recognition = listRecordedSocialKnowledge(db, chatId);
  const resolve = buildEntityIdentityResolver(db, chatId);
  const identity = (value: string) => {
    const resolved = resolve(value);
    return resolved.ambiguous ? null : normalizeEntityName(resolved.canonical);
  };
  const samePerson = (left: string, right: string) => identity(left) !== null && identity(left) === identity(right);
  const eligible = new Set(birthdayPeople({ entities, personaEntity: preferences.personaEntity ?? personaHint }).map(person => person.key));
  const author = audience?.kind === "author";
  const viewers = author ? entities.filter(entity => isPersonEntityType(entity.type)).map(entity=>entity.name) : perspectives;
  const narrator = perspectives.includes("narrator");
  const birthdayScopes = new Map<string, { scope: KnowledgeScope; mayKnow: string[] }>();
  const birthdays = entities.flatMap(entity => {
    if (!entity.birthday || !eligible.has(entity.id)) return [];
    const self = viewers.filter(holder => samePerson(holder, entity.name));
    const interacted = viewers.filter(holder => !self.includes(holder) && recognition.some(record =>
      record.level === "interacted" && samePerson(record.holder, holder) && samePerson(record.subject, entity.name)));
    if (!author && !narrator && !self.length && !interacted.length) return [];
    birthdayScopes.set(`birthday:${entity.id}`, { scope: scopeOf({ knownBy: self }), mayKnow: interacted });
    return [{ key: entity.id, name: entity.displayName, birthday: entity.birthday }];
  });
  // Authority/termination are chosen before access filtering, so an inaccessible
  // or hidden user basis cannot revive a superseded automatic basis.
  const candidates = calculateOccasions({ asOf, memories, birthdays, hidden: preferences.hiddenAnniversaries });
  const byId = new Map(rows.map(row => [row.id, row]));
  const items: ScopedOccasion[] = candidates.flatMap(item => {
    if (item.kind === "birthday") return [{ ...item, ...birthdayScopes.get(item.key)! }];
    const row = byId.get(item.memoryId!);
    const holders = row ? perspectives.filter(holder => allowedByPerspective(row, profile, holder, plotHolders.get(row.id))) : [];
    if (author && row) {
      const knownBy = plotHolders.get(row.id) ?? JSON.parse(row.known_by_json) as string[];
      return [{ ...item, scope: scopeOf(publicKnowledgeScope(knownBy)) }];
    }
    return holders.length && row ? [{ ...item, scope: scopeOf(publicKnowledgeScope(plotHolders.get(row.id) ?? JSON.parse(row.known_by_json))) }] : [];
  });
  return { asOf, items };
}

/** A single renderer-owned XML line, with whole nearest items and no memory IDs/counts. */
export function renderOccasions(asOf: string | null, items: ScopedOccasion[], budget = 160, viewpoint?: string, pricing?: PacketPricing): string {
  if (!asOf || !items.length) return "";
  const wrap = (lines: string[]) => `<occasions as_of="${escapeXml(asOf)}">Upcoming story dates; offset = days after as_of (trust the chat if it differs). Mention only if it fits; never force a celebration. ${lines.join(" ")}</occasions>`;
  const kept: ScopedOccasion[] = [];
  const render = (item: ScopedOccasion, pov?: string) => {
    const uncertain = item.mayKnow?.length ? `; ${item.mayKnow.join(", ")} might know (unconfirmed: hedge or ask, never recall it for certain)` : "";
    return `<occasion date="${item.date}" offset="${item.remaining}">[${escapeMemoryText(standaloneScopeText(item.scope, pov))}] ${escapeMemoryText(occasionPacketLabel(item) + uncertain)}</occasion>`;
  };
  for (const item of items) {
    if (chargedSectionTokens(wrap([...kept, item].map(value => render(value))), pricing) <= budget) kept.push(item);
  }
  return kept.length ? wrap(kept.map(item => render(item, viewpoint))) : "";
}
