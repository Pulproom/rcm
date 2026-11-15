import type { TurnPrepareRequest } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { buildEntityIdentityResolver, normalizeEntityName } from "./entities.js";

interface Candidate {
  name: string;
  aliases: Set<string>;
}

function parseNames(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch { return []; }
}

function candidateLedger(db: RcmDatabase, chatId: string): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>();
  const nonPeople = new Set((db.prepare("SELECT name FROM entities WHERE chat_id=? AND type<>'character'").all(chatId) as Array<{name:string}>).map(row => normalizeEntityName(row.name)));
  const resolve = buildEntityIdentityResolver(db, chatId);
  const add = (name: unknown): Candidate | undefined => {
    if (typeof name !== "string" || !name.trim()) return undefined;
    const identity = resolve(name);
    if (identity.ambiguous) return undefined;
    const normalized = normalizeEntityName(identity.canonical);
    if (!normalized || ["narrator", "omniscient", "omniscient narrator", "__narrator_archive__", "__everyone__", "__author__", "__automatic_delivery__"].includes(normalized) || nonPeople.has(normalized)) return undefined;
    const current = candidates.get(normalized) ?? { name: identity.canonical.trim(), aliases: new Set<string>() };
    current.aliases.add(normalizeEntityName(name));
    candidates.set(normalized, current);
    return current;
  };
  const entities = db.prepare("SELECT id,entity_key,name FROM entities WHERE chat_id=? AND type='character'").all(chatId) as Array<{ id: string; entity_key: string; name: string }>;
  const aliases = db.prepare("SELECT alias FROM aliases WHERE entity_id=?");
  for (const entity of entities) {
    const candidate = add(entity.name);
    if (!candidate) continue;
    candidate.aliases.add(normalizeEntityName(entity.entity_key));
    candidate.aliases.add(normalizeEntityName(entity.name));
    for (const row of aliases.all(entity.id) as Array<{ alias: string }>) candidate.aliases.add(normalizeEntityName(row.alias));
  }
  for (const row of db.prepare(`SELECT DISTINCT json_extract(a.value,'$.holder') holder FROM source_passages p
    JOIN messages m ON m.chat_id=p.chat_id AND m.message_id=p.message_id AND m.canonical_hash=p.canonical_hash,
    json_each(p.access_json) a WHERE p.chat_id=? AND p.active=1 AND m.lifecycle IN ('committed','client_pruned')
    AND m.memory_excluded=0 AND m.host_visibility IN ('active','all_before')`).all(chatId) as Array<{holder:string}>) add(row.holder);
  const memories = db.prepare("SELECT participants_json,known_by_json,perspective FROM memories WHERE chat_id=? AND active=1").all(chatId) as Array<{ participants_json: string; known_by_json: string; perspective: string | null }>;
  for (const memory of memories) {
    for (const name of parseNames(memory.known_by_json)) add(name);
    for (const name of parseNames(memory.participants_json)) add(name);
    add(memory.perspective);
  }
  for (const row of db.prepare("SELECT holder,subject FROM beliefs WHERE chat_id=? AND active=1").all(chatId) as Array<{ holder: string; subject: string }>) {
    add(row.holder); add(row.subject);
  }
  for (const row of db.prepare("SELECT from_entity,to_entity FROM relationship_projections WHERE chat_id=?").all(chatId) as Array<{ from_entity: string; to_entity: string }>) {
    add(row.from_entity); add(row.to_entity);
  }
  for (const row of db.prepare("SELECT promisor,promisee FROM promises WHERE chat_id=? AND status<>'invalidated'").all(chatId) as Array<{promisor:string;promisee:string}>) {
    add(row.promisor); add(row.promisee);
  }
  return candidates;
}

function canonical(candidates: Map<string, Candidate>, value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = normalizeEntityName(value);
  const direct = candidates.get(normalized);
  if (direct) return direct.name;
  const matches = [...candidates.values()].filter(candidate => candidate.aliases.has(normalized));
  if (matches.length === 1) return matches[0]!.name;
  return undefined;
}

function unique(values: Array<string | undefined>, limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const key = normalizeEntityName(value);
    if (seen.has(key)) continue;
    seen.add(key); result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

/** Scene identity is a ranking hint, never a knowledge-access boundary. */
export function resolveSceneCharacters(db: RcmDatabase, request: TurnPrepareRequest, queryText: string, sceneHitParticipants: string[]): string[] {
  const candidates = candidateLedger(db, request.chatId);
  const text = normalizeEntityName([queryText, ...(request.querySignals ?? []).map(signal => signal.text)].join("\n"));
  const latest = db.prepare(`SELECT participants_json FROM memories m WHERE chat_id=? AND active=1
    AND (capsule_parent_id IS NULL OR capsule_parent_id IN (SELECT memory_id FROM episodes WHERE resolution='group' AND status='capsuled'))
    ORDER BY COALESCE((SELECT MAX(msg.ordinal) FROM json_each(m.evidence_json) ev
      JOIN messages msg ON msg.chat_id=m.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')),m.created_revision) DESC,m.id LIMIT 2`)
    .all(request.chatId) as Array<{ participants_json: string }>;
  return unique([
    canonical(candidates, request.identityHints?.userPersonaName),
    canonical(candidates, request.identityHints?.hostCharacterName),
    ...(request.identityHints?.recentSpeakerNames ?? []).map(name => canonical(candidates, name)),
    ...[...candidates.values()].filter(person => [normalizeEntityName(person.name), ...person.aliases].some(name => name && text.includes(name))).map(person => person.name),
    ...sceneHitParticipants.map(name => canonical(candidates, name)),
    ...latest.flatMap(row => parseNames(row.participants_json)).map(name => canonical(candidates, name)),
  ], 8);
}

/** A stale viewpoint falls back to omniscient; it never contributes scene people. */
export function resolveNarrationViewpoint(db: RcmDatabase, chatId: string, value?: string): string | undefined {
  if (!value) return undefined;
  const resolved = buildEntityIdentityResolver(db, chatId)(value);
  if (resolved.ambiguous) return undefined;
  return (db.prepare("SELECT name FROM entities WHERE chat_id=? AND type='character' AND name=? COLLATE NOCASE")
    .get(chatId, resolved.canonical) as {name:string} | undefined)?.name;
}

export const narrationViewpointKey = (chatId: string): string => `narration_viewpoint:${chatId}`;

/** Re-resolve the last prepare setting so deleted or ambiguous identities fall back. */
export function storedNarrationViewpoint(db: RcmDatabase, chatId: string): string | undefined {
  const row=db.prepare("SELECT value FROM server_meta WHERE key=?").get(narrationViewpointKey(chatId)) as {value:string}|undefined;
  return resolveNarrationViewpoint(db,chatId,row?.value);
}
