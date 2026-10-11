import type { TurnPrepareRequest } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { normalizeEntityName } from "./entities.js";

export interface PerspectiveResolution {
  perspectives: string[];
  source: "manual" | "cache" | "host" | "ledger" | "shared_fallback" | "unresolved";
  unresolved: boolean;
}

interface Candidate {
  name: string;
  aliases: Set<string>;
  score: number;
}

function parseNames(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch { return []; }
}

function candidateLedger(db: RcmDatabase, chatId: string): Map<string, Candidate> {
  const candidates = new Map<string, Candidate>();
  const add = (name: unknown, score = 1): Candidate | undefined => {
    if (typeof name !== "string" || !name.trim()) return undefined;
    const normalized = normalizeEntityName(name);
    if (!normalized || normalized === "narrator") return undefined;
    const current = candidates.get(normalized) ?? { name: name.trim(), aliases: new Set<string>(), score: 0 };
    current.score += score;
    candidates.set(normalized, current);
    return current;
  };
  const entities = db.prepare("SELECT id,entity_key,name FROM entities WHERE chat_id=?").all(chatId) as Array<{ id: string; entity_key: string; name: string }>;
  const aliases = db.prepare("SELECT alias FROM aliases WHERE entity_id=?");
  for (const entity of entities) {
    const candidate = add(entity.name, 12)!;
    candidate.aliases.add(normalizeEntityName(entity.entity_key));
    candidate.aliases.add(normalizeEntityName(entity.name));
    for (const row of aliases.all(entity.id) as Array<{ alias: string }>) candidate.aliases.add(normalizeEntityName(row.alias));
  }
  for (const row of db.prepare(`SELECT DISTINCT json_extract(a.value,'$.holder') holder FROM source_passages p
    JOIN messages m ON m.chat_id=p.chat_id AND m.message_id=p.message_id AND m.canonical_hash=p.canonical_hash,
    json_each(p.access_json) a WHERE p.chat_id=? AND p.active=1 AND m.lifecycle IN ('committed','client_pruned')
    AND m.host_visibility IN ('active','all_before')`).all(chatId) as Array<{holder:string}>) add(row.holder, 1);
  const memories = db.prepare("SELECT participants_json,known_by_json,perspective FROM memories WHERE chat_id=? AND active=1").all(chatId) as Array<{ participants_json: string; known_by_json: string; perspective: string | null }>;
  for (const memory of memories) {
    for (const name of parseNames(memory.known_by_json)) add(name, 4);
    for (const name of parseNames(memory.participants_json)) add(name, 1);
    add(memory.perspective, 3);
  }
  for (const row of db.prepare("SELECT holder,subject FROM beliefs WHERE chat_id=? AND active=1").all(chatId) as Array<{ holder: string; subject: string }>) {
    add(row.holder, 4); add(row.subject, 1);
  }
  for (const row of db.prepare("SELECT from_entity,to_entity FROM relationship_projections WHERE chat_id=?").all(chatId) as Array<{ from_entity: string; to_entity: string }>) {
    add(row.from_entity, 2); add(row.to_entity, 2);
  }
  return candidates;
}

function canonical(candidates: Map<string, Candidate>, value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = normalizeEntityName(value);
  const direct = candidates.get(normalized);
  if (direct) return direct.name;
  for (const candidate of candidates.values()) if (candidate.aliases.has(normalized)) return candidate.name;
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

export function resolveTurnPerspectives(db: RcmDatabase, request: TurnPrepareRequest, queryText: string): PerspectiveResolution {
  const candidates = candidateLedger(db, request.chatId);
  const hints = request.identityHints;
  if (request.perspectiveMode === "manual" && request.perspectives.length > 0) {
    const manual = unique(request.perspectives.map((value) => canonical(candidates, value) ?? value.trim()).filter((value) => value && value !== request.characterId), 4);
    if (manual.length) return { perspectives: manual, source: "manual", unresolved: false };
  }

  const user = canonical(candidates, hints?.userPersonaName);
  const automaticAiLimit = request.profile === "companion" ? 1 : 3;
  const loweredQuery = queryText.toLocaleLowerCase();
  const rankAutomaticAi = (values: string[]): string[] => unique(values, 16).sort((left, right) => {
    const leftCandidate = candidates.get(normalizeEntityName(left));
    const rightCandidate = candidates.get(normalizeEntityName(right));
    const leftMentioned = [left, ...(leftCandidate?.aliases ?? [])].some((name) => name && loweredQuery.includes(name.toLocaleLowerCase()));
    const rightMentioned = [right, ...(rightCandidate?.aliases ?? [])].some((name) => name && loweredQuery.includes(name.toLocaleLowerCase()));
    return Number(rightMentioned) - Number(leftMentioned) || (rightCandidate?.score ?? 0) - (leftCandidate?.score ?? 0);
  }).slice(0, automaticAiLimit);
  const assemble = (ais: string[]): string[] => {
    const ranked = rankAutomaticAi(ais.filter((name) => normalizeEntityName(name) !== normalizeEntityName(user ?? "")));
    return unique([user, ...ranked], 1 + automaticAiLimit);
  };
  const includesAiPerspective = (values: string[]): boolean => values.some(
    (name) => normalizeEntityName(name) !== normalizeEntityName(user ?? ""),
  );
  const resolvedFromHints = (values: string[]): boolean => values.length > 0
    && (!user || includesAiPerspective(values));

  const host = unique([
    canonical(candidates, hints?.hostCharacterName),
    ...(hints?.recentSpeakerNames ?? []).map((value) => canonical(candidates, value)),
    ...(request.perspectiveMode === "auto" ? request.perspectives.map((value) => canonical(candidates, value)) : []),
  ], 16);
  if (host.length || user) {
    const values = assemble(host);
    if (resolvedFromHints(values)) return { perspectives: values, source: "host", unresolved: false };
  }

  // The cache is a fail-safe, not a source of extra perspective blocks. A
  // current host/recent speaker match must win so inactive side characters do
  // not remain attached to every later packet.
  const cached = unique((hints?.cachedPerspectives ?? []).map((value) => canonical(candidates, value)), 16);
  if (cached.length) {
    const values = assemble(cached);
    if (resolvedFromHints(values)) return { perspectives: values, source: "cache", unresolved: false };
  }

  const lowered = loweredQuery;
  const ranked = [...candidates.values()].map((candidate) => ({
    name: candidate.name,
    mentioned: [...candidate.aliases, normalizeEntityName(candidate.name)].some((alias) => alias && lowered.includes(alias)),
    score: candidate.score + [...candidate.aliases, normalizeEntityName(candidate.name)].reduce((score, alias) => score + (alias && lowered.includes(alias) ? 20 : 0), 0),
  })).sort((left, right) => right.score - left.score);
  const rankedAi = ranked.filter((item) => normalizeEntityName(item.name) !== normalizeEntityName(user ?? ""));
  const ledgerCandidates = rankedAi.some((item) => item.mentioned)
    ? rankedAi.filter((item) => item.mentioned).slice(0, automaticAiLimit)
    : rankedAi.slice(0, 1);
  const ledger = assemble(ledgerCandidates.map((item) => item.name));
  if (ledger.length) return { perspectives: ledger, source: "ledger", unresolved: false };
  return { perspectives: [], source: candidates.size > 0 ? "shared_fallback" : "unresolved", unresolved: true };
}
