import { applySeedResolutions } from "./story-seeds.js";
import { activeSocialRelations, isReverseMutualSocialRelation, socialRelationCovers, resolveSocialRelation, sameSocialRelationLabel, sameSocialRelationScope } from "./social-relations.js";
import { storeSourcePassages } from "./source-evidence.js";
import { randomUUID } from "node:crypto";
import { invalidateStorySupports } from "./story-spine.js";
import { augmentSearchText, modelImageRanges, normalizeStoryTime, type ExtractionResult } from "@rcm/shared";
import { canonicalizeExtraction, normalizeEntityName } from "./entities.js";
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { normalizeUnitScore } from "./scores.js";
import { normalizeLedgerPredicate, normalizeLedgerText } from "./normalization.js";
import { RELATIONSHIP_AXES } from "./relationship-scale.js";
import { ingestSocialKnowledge } from "./social-knowledge.js";
import { queueRelationshipProjection } from "./relationship-projections.js";
import { intimacyMilestoneKeys } from "./intimacy-milestones.js";
import { refreshMemoryFts } from "./memory-search-document.js";
import { transitionEvidenceJson, transitionSourceEvidence, canAutomaticallyChange } from "./user-corrections.js";
import { storeAtomRelations, type AtomRelationContext } from "./atom-relations.js";
import { aliasRemovalGuard, deletionGuard, userDeletionsKey } from "./user-deletions.js";
import { readDetailAccessEdits, pruneDetailAccessEdits, syncDetailKnownBy } from "./item-access.js";

const storyHeader = /\[🌐\|([^|\]\r\n]+)\|/g;

export function replaceItemAccess(
  db: RcmDatabase,
  chatId: string,
  itemKind: string,
  itemId: string,
  grants: Array<{ holder: string; basis: string; evidence: Array<{ messageId: string; quote?: string }>; confidence: number }>,
  revision: number,
  timestamp: number,
): void {
  db.prepare("UPDATE item_access SET active=0 WHERE chat_id=? AND item_kind=? AND item_id=?").run(chatId, itemKind, itemId);
  const insert = db.prepare(`INSERT INTO item_access(id,chat_id,item_kind,item_id,holder,basis,evidence_json,confidence,active,source_revision,created_at)
    VALUES(?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(chat_id,item_kind,item_id,holder) DO UPDATE SET basis=excluded.basis,evidence_json=excluded.evidence_json,
    confidence=excluded.confidence,active=1,source_revision=excluded.source_revision`);
  if (grants.length === 0) insert.run(randomUUID(), chatId, itemKind, itemId, "__narrator_archive__", "internal", "[]", 1, revision, timestamp);
  else for (const grant of grants) insert.run(randomUUID(), chatId, itemKind, itemId, grant.holder, grant.basis, JSON.stringify(grant.evidence), grant.confidence, revision, timestamp);
}

function evidenceOrdinal(db: RcmDatabase, chatId: string, evidence: Array<{ messageId: string }>): number | null {
  const ids = [...new Set(evidence.map((item) => item.messageId).filter(Boolean))];
  if (!ids.length) return null;
  const row = db.prepare(`SELECT MIN(ordinal) AS ordinal FROM messages WHERE chat_id=? AND message_id IN (${ids.map(() => "?").join(",")})`)
    .get(chatId, ...ids) as { ordinal: number | null };
  return row.ordinal;
}

function resolvePhysicalSourceMemoryId(
  db: RcmDatabase,
  chatId: string,
  memoryByKey: Map<string, string>,
  memoryKey: string | undefined,
  evidence: Array<{ messageId: string }>,
): string | null {
  if (memoryKey) {
    const mapped = memoryByKey.get(memoryKey)
      ?? (db.prepare("SELECT id FROM memories WHERE chat_id=? AND memory_key=? AND active=1").get(chatId, memoryKey) as { id: string } | undefined)?.id;
    if (mapped) return mapped;
  }
  const messageIds = [...new Set(evidence.map((item) => item.messageId).filter(Boolean))];
  if (!messageIds.length) return null;
  const matches = db.prepare(`SELECT DISTINCT m.id FROM memories m JOIN json_each(m.evidence_json) ev
    WHERE m.chat_id=? AND m.active=1 AND json_extract(ev.value,'$.messageId') IN (${messageIds.map(() => "?").join(",")}) LIMIT 2`)
    .all(chatId, ...messageIds) as Array<{ id: string }>;
  return matches.length === 1 ? matches[0]!.id : null;
}

export function applyMemoryRecallObservations(
  db: RcmDatabase,
  chatId: string,
  observations: ExtractionResult["memoryRecallObservations"],
  candidates: Array<{ memoryId: string; accessibleTo: string[] }>,
  sourceMessageIds: string[],
  sourceBatchId?: string,
): number {
  if (!observations?.length || !candidates.length) return 0;
  const candidateById = new Map(candidates.map((candidate) => [candidate.memoryId, candidate]));
  const sourceIds = new Set(sourceMessageIds);
  const rank = { mentioned: 1, recalled: 2, reexperienced: 3 } as const;
  const strongest = new Map<string, NonNullable<ExtractionResult["memoryRecallObservations"]>[number]>();
  const deleted = deletionGuard(db, chatId);
  for (const observation of observations) {
    if (deleted("entity", [normalizeEntityName(observation.holder)], observation.evidenceMessageIds.map(messageId => ({ messageId })))) continue;
    const candidate = candidateById.get(observation.memoryId);
    if (!candidate || observation.confidence < 0.55) continue;
    const holder = observation.holder.trim();
    if (!holder || !candidate.accessibleTo.some((name) => name.localeCompare(holder, undefined, { sensitivity: "accent" }) === 0)) continue;
    const evidenceMessageIds = [...new Set(observation.evidenceMessageIds)].filter((id) => sourceIds.has(id));
    if (!evidenceMessageIds.length) continue;
    const grounded = db.prepare(`SELECT COUNT(*) n FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))
      AND completed_turn_seq IS NOT NULL AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`)
      .get(chatId, JSON.stringify(evidenceMessageIds)) as {n:number};
    if (grounded.n !== evidenceMessageIds.length) continue;
    const valid = { ...observation, holder, evidenceMessageIds };
    const key = `${observation.memoryId}\u0000${holder.toLocaleLowerCase()}`;
    const previous = strongest.get(key);
    if (!previous || rank[valid.action] > rank[previous.action] || valid.confidence > previous.confidence) strongest.set(key, valid);
  }
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined)?.revision ?? 0;
  const timestamp = now();
  let applied = 0;
  db.transaction(() => {
    for (const observation of strongest.values()) {
      if (!db.prepare("SELECT 1 FROM memories WHERE id=? AND chat_id=? AND active=1").get(observation.memoryId, chatId)) continue;
      const inserted = db.prepare(`INSERT OR IGNORE INTO memory_recall_events(
        id,chat_id,memory_id,holder,action,confidence,evidence_json,source_batch_id,created_revision,created_at,completed_turn_seq
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        randomUUID(), chatId, observation.memoryId, observation.holder, observation.action, observation.confidence,
        JSON.stringify(observation.evidenceMessageIds), sourceBatchId ?? null, revision, timestamp,
        Number((db.prepare(`SELECT MAX(completed_turn_seq) seq FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))`)
          .get(chatId, JSON.stringify(observation.evidenceMessageIds)) as { seq: number | null }).seq ?? 0),
      ).changes;
      if (!inserted) continue;
      applied += 1;
    }
    if (applied) rebuildCharacterRecallTraces(db, chatId);
  })();
  return applied;
}

/** Replay source-backed events, so deleting a callback also removes its reinforcement. */
export function rebuildCharacterRecallTraces(db: RcmDatabase, chatId: string): void {
  db.prepare("DELETE FROM memory_traces WHERE memory_id IN (SELECT id FROM memories WHERE chat_id=?)").run(chatId);
  db.prepare(`INSERT OR IGNORE INTO memory_traces(memory_id,character_name,strength,salience,detail_level)
    SELECT m.id,n.value,m.strength,m.salience,CASE WHEN m.strength>0.75 THEN 'clear' ELSE 'gist' END
    FROM memories m,json_each(CASE WHEN json_array_length(m.known_by_json)>0 THEN m.known_by_json ELSE m.participants_json END) n
    WHERE m.chat_id=? AND m.active=1`).run(chatId);
  const events = db.prepare(`SELECT * FROM memory_recall_events WHERE chat_id=? ORDER BY completed_turn_seq,created_at,id`)
    .all(chatId) as Array<{ memory_id: string; holder: string; action: string; created_revision: number; completed_turn_seq: number }>;
  const insert = db.prepare(`INSERT INTO memory_traces(memory_id,character_name,strength,salience,recall_count,last_recalled_revision,last_recalled_turn_seq,detail_level)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(memory_id,character_name) DO UPDATE SET
    strength=MIN(1,memory_traces.strength+excluded.strength-0.5),salience=MIN(1,memory_traces.salience+excluded.salience-0.5),
    recall_count=memory_traces.recall_count+excluded.recall_count,
    last_recalled_revision=COALESCE(excluded.last_recalled_revision,memory_traces.last_recalled_revision),
    last_recalled_turn_seq=COALESCE(excluded.last_recalled_turn_seq,memory_traces.last_recalled_turn_seq),
    detail_level=CASE WHEN excluded.last_recalled_turn_seq IS NULL THEN memory_traces.detail_level ELSE excluded.detail_level END`);
  for (const event of events) {
    const recalled = event.action !== "mentioned";
    insert.run(event.memory_id, event.holder, 0.5 + (event.action === "reexperienced" ? 0.08 : recalled ? 0.05 : 0.015),
      0.5 + (event.action === "reexperienced" ? 0.04 : recalled ? 0.025 : 0.005), recalled ? 1 : 0,
      recalled ? event.created_revision : null, recalled ? event.completed_turn_seq : null, event.action === "reexperienced" ? "clear" : "gist");
  }
}

export function backfillExplicitStoryTimes(db: RcmDatabase, chatId: string, source: ExtractionResult): ExtractionResult {
  const result = structuredClone(source);
  const ids = [...new Set(result.memories.flatMap((memory) => memory.evidence.map((item) => item.messageId)))];
  if (ids.length === 0) return result;
  const rows = db.prepare(`SELECT message_id,content FROM messages WHERE chat_id=? AND message_id IN (${ids.map(() => "?").join(",")})`)
    .all(chatId, ...ids) as Array<{ message_id: string; content: string | null }>;
  const contents = new Map(rows.map((row) => [row.message_id, row.content ?? ""]));
  for (const memory of result.memories) {
    if (memory.storyTime) continue;
    for (const evidence of [...memory.evidence].reverse()) {
      const matches = [...(contents.get(evidence.messageId) ?? "").matchAll(storyHeader)];
      const candidate = matches.reverse().find((match) => /\b\d{4}\D+\d{1,2}\D+\d{1,2}/.test(match[1] ?? "") && /\d{1,2}:\d{2}/.test(match[1] ?? ""))?.[1]?.trim();
      if (candidate) { memory.storyTime = candidate; break; }
    }
  }
  return result;
}

export function dedupeKeyDialogues(source: ExtractionResult): ExtractionResult {
  const result = structuredClone(source);
  for (const memory of result.memories) {
    memory.keyDialogues = (memory.keyDialogues ?? []).filter((dialogue, index, items) => items.findIndex((item) =>
      item.messageId === dialogue.messageId && item.speaker === dialogue.speaker
      && item.kind === dialogue.kind && item.text === dialogue.text) === index);
  }
  return result;
}

function relationshipDetailOwner(result: ExtractionResult, reference: { memoryKey?: string; detailKey?: string }): string | undefined {
  const matches = result.memories.filter(memory => (!reference.memoryKey || memory.key === reference.memoryKey)
    && memory.details?.some(detail => detail.key === reference.detailKey));
  return matches.length === 1 ? matches[0]!.key : undefined;
}

/** Validates canonical dialogue evidence without interpreting or rewriting authored text. */
export function validateDialogueEvidence(
  db: RcmDatabase,
  chatId: string,
  sourceMessageIds: string[],
  source: ExtractionResult,
): ExtractionResult {
  const result = structuredClone(source);
  const rows = sourceMessageIds.length ? db.prepare(`SELECT message_id,canonical_content,canonical_hash FROM messages
    WHERE chat_id=? AND message_id IN (${sourceMessageIds.map(() => "?").join(",")})`).all(chatId, ...sourceMessageIds)
    : [];
  const messages = new Map((rows as Array<{ message_id: string; canonical_content: string | null; canonical_hash: string }>)
    .map((row) => [row.message_id, row]));
  for (const memory of result.memories) {
    for (const dialogue of memory.keyDialogues ?? []) {
      const message = messages.get(dialogue.messageId);
      const excluded = message ? [
        ...[...(message.canonical_content ?? "").matchAll(/<thoughts\b[^>]*>[\s\S]*?<\/thoughts\s*>/gi)].map(match => ({start:match.index!,end:match.index!+match[0].length})),
        ...modelImageRanges(message.canonical_content ?? ""),
      ] : [];
      if (!message || !dialogue.evidence.length || dialogue.evidence.some((evidence) => evidence.messageId !== dialogue.messageId
        || evidence.canonicalHash !== message.canonical_hash || !Number.isInteger(evidence.startOffset) || !Number.isInteger(evidence.endOffset)
        || evidence.startOffset < 0 || evidence.endOffset <= evidence.startOffset || evidence.endOffset > (message.canonical_content ?? "").length
        || excluded.some(range => range.start < evidence.endOffset && range.end > evidence.startOffset)
        || (message.canonical_content ?? "").slice(evidence.startOffset, evidence.endOffset) !== evidence.quote)) {
        throw new Error(`Key dialogue evidence is not an exact canonical source range: ${dialogue.messageId}`);
      }
    }
  }
  return dedupeKeyDialogues(result);
}

export function normalizeStandaloneKeyDialogues(
  db: RcmDatabase,
  chatId: string,
  sourceMessageIds: string[],
  keyDialogues: NonNullable<ExtractionResult["memories"][number]["keyDialogues"]>,
): NonNullable<ExtractionResult["memories"][number]["keyDialogues"]> {
  const shell = { language: "en", memories: [{ keyDialogues }] } as unknown as ExtractionResult;
  return validateDialogueEvidence(db, chatId, sourceMessageIds, shell).memories[0]?.keyDialogues ?? [];
}

export function normalizePromiseMemoryAssociations(
  db: RcmDatabase,
  chatId: string,
  source: ExtractionResult,
): { result: ExtractionResult; warnings: string[] } {
  const result = structuredClone(source);
  const currentMemoryKeys = new Set(result.memories.map((memory) => memory.key));
  const existingMemoryKeys = new Set((db.prepare("SELECT memory_key FROM memories WHERE chat_id=?").all(chatId) as Array<{ memory_key: string }>)
    .map((row) => row.memory_key));
  const validMemoryKey = (key: string): boolean => currentMemoryKeys.has(key) || existingMemoryKeys.has(key);
  const promiseMemoryKeys = new Map((db.prepare(`
    SELECT p.promise_key,m.memory_key
    FROM promises p
    JOIN memories m ON m.id=p.source_memory_id
    WHERE p.chat_id=? AND m.chat_id=?
  `).all(chatId, chatId) as Array<{ promise_key: string; memory_key: string }>)
    .map((row) => [row.promise_key, row.memory_key]));
  for (const promise of result.promises) {
    if (!promiseMemoryKeys.has(promise.key) && promise.memoryKey && validMemoryKey(promise.memoryKey)) {
      promiseMemoryKeys.set(promise.key, promise.memoryKey);
    }
  }

  const warnings: string[] = [];
  for (const memory of result.memories) {
    memory.associations = [...new Set(memory.associations.flatMap((association) => {
      if (validMemoryKey(association)) return [association];
      const resolved = promiseMemoryKeys.get(association);
      if (!resolved) {
        warnings.push(`memory ${memory.key} dropped an unknown optional association: ${association}`);
        return [];
      }
      warnings.push(`memory ${memory.key} resolved a promise association to its source memory`);
      return resolved === memory.key ? [] : [resolved];
    }))];
  }
  const dropUnknownMemoryKey = (item: { memoryKey?: string }, label: string): void => {
    if (!item.memoryKey || validMemoryKey(item.memoryKey)) return;
    warnings.push(`${label} dropped an unknown optional memory key: ${item.memoryKey}`);
    delete item.memoryKey;
  };
  result.assertions.forEach((item) => {
    if (!item.validFromMemoryKey || validMemoryKey(item.validFromMemoryKey)) return;
    warnings.push(`assertion ${item.subject}.${item.predicate} dropped an unknown optional memory key: ${item.validFromMemoryKey}`);
    delete item.validFromMemoryKey;
  });
  result.promises.forEach((item) => dropUnknownMemoryKey(item, `promise ${item.key}`));
  (result.socialKnowledge ?? []).forEach((item) => dropUnknownMemoryKey(item, `social knowledge ${item.holder}->${item.subject}`));
  (result.physicalIntimacy ?? []).forEach((item) => dropUnknownMemoryKey(item, `physical intimacy ${item.participants.join("/")}`));
  (result.relationshipEvents ?? []).forEach((item) => {
    const detailOwner = item.detailKey ? relationshipDetailOwner(result, item) : undefined;
    dropUnknownMemoryKey(item, `relationship event ${item.from}->${item.to}`);
    if (!item.detailKey || detailOwner !== undefined) return;
    warnings.push(`relationship event ${item.from}->${item.to} dropped an unknown or ambiguous optional detail key: ${item.detailKey}`);
    delete item.detailKey;
  });
  return { result, warnings };
}

export function validateExtractionSources(
  db: RcmDatabase,
  chatId: string,
  sourceMessageIds: string[],
  result: ExtractionResult,
): string[] {
  const allowedIds = new Set(sourceMessageIds);
  const rows = sourceMessageIds.length === 0 ? [] : db.prepare(`
    SELECT message_id FROM messages
    WHERE chat_id=? AND message_id IN (${sourceMessageIds.map(() => "?").join(",")})
  `).all(chatId, ...sourceMessageIds) as Array<{ message_id: string }>;
  const existingIds = new Set(rows.map((row) => row.message_id));
  const errors: string[] = [];
  const checkCitation = (messageId: string, label: string): void => {
    if (!allowedIds.has(messageId) || !existingIds.has(messageId)) {
      errors.push(`${label} cites a message outside this extraction job: ${messageId}`);
    }
  };
  for (const passage of result.sourcePassages ?? []) {
    checkCitation(passage.messageId, "source passage");
    for (const grant of passage.access) for (const evidence of grant.evidence) checkCitation(evidence.messageId, "source access");
  }
  result.memories.forEach((memory) => {
    memory.evidence.forEach((evidence) => checkCitation(evidence.messageId, `memory ${memory.key}`));
    (memory.landmarkKinds ?? []).forEach((landmark) => (landmark.evidence ?? []).forEach((evidence) => checkCitation(evidence.messageId, `memory ${memory.key} landmark ${landmark.kind}`)));
    (memory.keyDialogues ?? []).forEach((dialogue) => checkCitation(dialogue.messageId, `memory ${memory.key} dialogue`));
    (memory.details ?? []).forEach((detail) => detail.evidence.forEach((evidence) => checkCitation(evidence.messageId, `memory ${memory.key} detail ${detail.key}`)));
  });
  result.assertions.forEach((assertion) => assertion.evidence.forEach((evidence) => checkCitation(evidence.messageId, `assertion ${assertion.subject}.${assertion.predicate}`)));
  result.beliefs.forEach((belief) => belief.evidence.forEach((evidence) => checkCitation(evidence.messageId, `belief ${belief.holder}:${belief.subject}.${belief.predicate}`)));
  result.promises.forEach((promise) => (promise.evidence ?? []).forEach((evidence) => checkCitation(evidence.messageId, `promise ${promise.key}`)));
  (result.socialKnowledge ?? []).forEach((item) => item.evidence.forEach((evidence) => checkCitation(evidence.messageId, `social knowledge ${item.holder}->${item.subject}`)));
  (result.relationshipBaselines ?? []).forEach((item) => item.evidence.forEach((evidence) => checkCitation(evidence.messageId, `relationship baseline ${item.from}->${item.to}`)));
  (result.physicalIntimacy ?? []).forEach((item) => item.evidence.forEach((evidence) => checkCitation(evidence.messageId, `physical intimacy ${item.participants.join("/")}`)));
  (result.relationshipEvents ?? []).forEach((item) => item.evidence.forEach((evidence) => checkCitation(evidence.messageId, `relationship event ${item.from}->${item.to}`)));

  const currentKeys = new Set(result.memories.map((memory) => memory.key));
  const existingKeys = new Set((db.prepare("SELECT memory_key FROM memories WHERE chat_id=?").all(chatId) as Array<{ memory_key: string }>).map((row) => row.memory_key));
  const validMemoryKey = (key: string | undefined): boolean => !key || currentKeys.has(key) || existingKeys.has(key);
  result.memories.forEach((memory) => memory.associations.forEach((key) => {
    if (!validMemoryKey(key)) errors.push(`memory ${memory.key} has an unknown association: ${key}`);
  }));
  result.assertions.forEach((assertion) => {
    if (!validMemoryKey(assertion.validFromMemoryKey)) errors.push(`assertion ${assertion.subject}.${assertion.predicate} has an unknown memory key`);
  });
  result.promises.forEach((promise) => {
    if (!validMemoryKey(promise.memoryKey)) errors.push(`promise ${promise.key} has an unknown memory key`);
    if (promise.status === "offscreen") {
      const existing = db.prepare("SELECT status,scheduled_for AS scheduledFor FROM promises WHERE chat_id=? AND promise_key=?").get(chatId, promise.key) as { status: string; scheduledFor: string | null } | undefined;
      if (!existing || existing.status !== "open") errors.push(`promise ${promise.key} cannot become offscreen without an existing open promise`);
      if (!existing?.scheduledFor) errors.push(`promise ${promise.key} cannot become offscreen without an existing scheduled point`);
      if (existing?.scheduledFor && promise.scheduledFor !== existing.scheduledFor) errors.push(`promise ${promise.key} must preserve its scheduled point when marked offscreen`);
      if (!promise.statusReason?.trim()) errors.push(`promise ${promise.key} requires a status reason when marked offscreen`);
      if ((promise.evidence ?? []).length === 0) errors.push(`promise ${promise.key} requires current transcript evidence when marked offscreen`);
    }
  });
  (result.socialKnowledge ?? []).forEach((item) => {
    if (!validMemoryKey(item.memoryKey)) errors.push(`social knowledge ${item.holder}->${item.subject} has an unknown memory key`);
  });
  (result.physicalIntimacy ?? []).forEach((item) => {
    if (!validMemoryKey(item.memoryKey)) errors.push(`physical intimacy ${item.participants.join("/")} has an unknown memory key`);
  });
  (result.relationshipEvents ?? []).forEach((item) => {
    if (!validMemoryKey(item.memoryKey)) errors.push(`relationship event ${item.from}->${item.to} has an unknown memory key`);
    if (item.detailKey && relationshipDetailOwner(result, item) === undefined) errors.push(`relationship event ${item.from}->${item.to} has an unknown or ambiguous detail key`);
  });
  return errors;
}

export function ingestExtraction(db: RcmDatabase, chatId: string, result: ExtractionResult, sourceJobId: string = randomUUID(), sourceBatchId?: string, relationContext?: AtomRelationContext, userInitiated = false): string[] {
  const relationWarnings: string[] = [];
  result = backfillExplicitStoryTimes(db, chatId, result);
  const source = db.prepare("SELECT value FROM server_meta WHERE key=?").get(userDeletionsKey(chatId))
    ? db.prepare(`SELECT json_extract(payload_json,'$.sourceMessageIds') ids FROM jobs WHERE id=? AND chat_id=?
      UNION ALL SELECT source_message_ids_json ids FROM extraction_batches WHERE id=? AND chat_id=? LIMIT 1`)
      .get(sourceJobId, chatId, sourceBatchId ?? null, chatId) as { ids: string | null } | undefined : undefined;
  result = canonicalizeExtraction(db, chatId, result, source?.ids ? JSON.parse(source.ids) : [], sourceBatchId);
  // API 10 models classify transient ledger items explicitly. Missing fields
  // are legacy output and remain fully compatible; only explicit scene rows
  // are folded into the episode instead of polluting long-lived ledgers.
  result = {
    ...result,
    assertions: result.assertions.filter((item) => item.retention !== "scene"),
    beliefs: result.beliefs.filter((item) => item.retention !== "scene"),
    promises: result.promises.filter((item) => item.scope !== "scene"),
  };
  result.relationshipEvents = (result.relationshipEvents ?? []).filter((event) =>
    !event.changes.every((change) => change.effect === "increase" && change.impact === "minor") || Boolean(event.memoryKey || event.detailKey));
  for (const assertion of result.assertions) assertion.predicate = normalizeLedgerPredicate(assertion.predicate);
  for (const belief of result.beliefs) belief.predicate = normalizeLedgerPredicate(belief.predicate);
  db.transaction(() => {
    const revokedStorySupports=new Set<string>();
    const detailAccessEdits = readDetailAccessEdits(db, chatId);
    const timestamp = now();
    const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
    if (!chat) throw new Error(`Unknown chat: ${chatId}`);
    const revision = chat.revision;
    storeSourcePassages(db, chatId, result.sourcePassages, sourceBatchId);
    const replaceAccess = (itemKind: string, itemId: string, grants: Array<{ holder: string; basis: string; evidence: Array<{ messageId: string; quote?: string }>; confidence: number }>): void =>
      replaceItemAccess(db, chatId, itemKind, itemId, grants, revision, timestamp);

    const entityIds = new Map<string, string>();
    const removedAlias = aliasRemovalGuard(db, chatId);
    for (const entity of result.entities) {
      const existing = db.prepare("SELECT id FROM entities WHERE chat_id=? AND entity_key=?").get(chatId, entity.key) as
        | { id: string }
        | undefined;
      const id = existing?.id ?? randomUUID();
      db.prepare(`
        INSERT INTO entities(id,chat_id,entity_key,name,display_name,type,origin,created_at) VALUES(?,?,?,?,?,?,'transcript',?)
        ON CONFLICT(chat_id,entity_key) DO UPDATE SET type=excluded.type
      `).run(id, chatId, entity.key, entity.name, entity.name, entity.type, timestamp);
      entityIds.set(entity.key, id);
      const aliasInsert = db.prepare("INSERT OR IGNORE INTO aliases(entity_id,alias,normalized) VALUES(?,?,?)");
      for (const alias of [entity.name, ...entity.aliases]) if (!removedAlias(id, alias)) aliasInsert.run(id, alias, normalizeEntityName(alias));
    }

    const memoryByKey = new Map<string, string>();
    const detailByKey = new Map<string, string>();
    for (const memory of result.memories) {
      const keyDialogues = memory.keyDialogues ?? [];
      const existing = db.prepare("SELECT id FROM memories WHERE chat_id=? AND memory_key=?").get(chatId, memory.key) as
        | { id: string }
        | undefined;
      const id = existing?.id ?? randomUUID();
      const strength = normalizeUnitScore(Math.max(0.15, 0.35 + memory.salience * 0.55));
      db.prepare(`
        INSERT INTO memories(
          id,chat_id,memory_key,type,title,content,participants_json,known_by_json,perspective,story_time,story_time_normalized,locations_json,landmark,landmark_kinds_json,evidence_json,retention_class,
          salience,strength,atom_access_version,source_batch_id,created_revision,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(chat_id,memory_key) DO UPDATE SET
          type=excluded.type,title=excluded.title,content=excluded.content,
          participants_json=excluded.participants_json,known_by_json=excluded.known_by_json,
          perspective=excluded.perspective,story_time=COALESCE(excluded.story_time,memories.story_time),story_time_normalized=COALESCE(excluded.story_time_normalized,memories.story_time_normalized),
          locations_json=excluded.locations_json,landmark=excluded.landmark,landmark_kinds_json=excluded.landmark_kinds_json,evidence_json=excluded.evidence_json,
          retention_class=excluded.retention_class,
          salience=MAX(memories.salience,excluded.salience),strength=MAX(memories.strength,excluded.strength),
          atom_access_version=excluded.atom_access_version,source_batch_id=COALESCE(excluded.source_batch_id,memories.source_batch_id),
          active=CASE WHEN memories.user_managed=1 AND memories.active=0 THEN 0 ELSE 1 END,updated_at=excluded.updated_at
      `).run(
        id,
        chatId,
        memory.key,
        memory.type,
        memory.title,
        memory.content,
        JSON.stringify(memory.participants),
        JSON.stringify(memory.knownBy),
        memory.perspective ?? null,
        memory.storyTime ?? null,
        normalizeStoryTime(memory.storyTime) ?? null,
        JSON.stringify(memory.locations ?? []),
        memory.landmark ? 1 : 0,
        JSON.stringify(memory.landmarkKinds ?? []),
        JSON.stringify(memory.evidence),
        memory.retention ?? "arc",
        memory.salience,
        strength,
        (memory.details?.length ?? 0) > 0 || keyDialogues.length > 0 ? 1 : 0,
        sourceBatchId ?? null,
        revision,
        timestamp,
        timestamp,
      );
      memoryByKey.set(memory.key, id);
      db.prepare("DELETE FROM evidence_spans WHERE memory_id=?").run(id);
      for (const evidence of memory.evidence) {
        db.prepare("INSERT INTO evidence_spans(id,chat_id,memory_id,message_id,quote,created_at) VALUES(?,?,?,?,?,?)").run(
          randomUUID(), chatId, id, evidence.messageId, evidence.quote ?? null, timestamp,
        );
      }
      const previousDialogueIds = (db.prepare("SELECT id FROM memory_dialogues WHERE memory_id=?").all(id) as Array<{ id: string }>).map((row) => row.id);
      previousDialogueIds.forEach(id=>revokedStorySupports.add(`dialogue:${id}`));
      if (previousDialogueIds.length) db.prepare(`UPDATE item_access SET active=0 WHERE chat_id=? AND item_kind='dialogue' AND item_id IN (${previousDialogueIds.map(() => "?").join(",")})`).run(chatId, ...previousDialogueIds);
      db.prepare("DELETE FROM memory_dialogues WHERE memory_id=?").run(id);
      for (const [ordinal, dialogue] of keyDialogues.entries()) {
        const reviewedDuplicate = db.prepare("SELECT 1 FROM memory_dialogues WHERE memory_id=? AND message_id=? AND text=? LIMIT 1").get(id, dialogue.messageId, dialogue.text);
        if (reviewedDuplicate) continue;
        const dialogueId = randomUUID();
        db.prepare(`
          INSERT INTO memory_dialogues(id,chat_id,memory_id,speaker,text,message_id,evidence_json,kind,ordinal,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)
        `).run(dialogueId, chatId, id, dialogue.speaker, dialogue.text, dialogue.messageId, JSON.stringify(dialogue.evidence), dialogue.kind, ordinal, timestamp);
        replaceAccess("dialogue", dialogueId, dialogue.access !== undefined ? dialogue.access : memory.knownBy.map((holder) => ({ holder, basis: "witnessed", evidence: [{ messageId: dialogue.messageId }], confidence: 1 })));
      }
      const incomingDetailKeys = new Set((memory.details ?? []).map((detail) => detail.key));
      const previousDetails = db.prepare("SELECT id,detail_key FROM memory_details WHERE memory_id=?").all(id) as Array<{ id: string; detail_key: string }>;
      // An upsert keeps detail IDs, but its old semantic relationships were
      // extracted against the previous detail generation. Re-extraction must
      // provide fresh relations; do not let stable IDs preserve stale meaning.
      if (previousDetails.length) {
        const detailIds = JSON.stringify(previousDetails.map(detail => detail.id));
        // The relation lifecycle trigger also revokes its access grants.
        db.prepare(`UPDATE atom_relations SET active=0 WHERE chat_id=? AND active=1 AND
          (source_detail_id IN (SELECT value FROM json_each(?)) OR target_detail_id IN (SELECT value FROM json_each(?)))`)
          .run(chatId, detailIds, detailIds);
      }
      for (const previous of previousDetails) if (!incomingDetailKeys.has(previous.detail_key)) {
        revokedStorySupports.add(`detail:${previous.id}`);
        db.prepare("DELETE FROM item_access WHERE chat_id=? AND item_kind='detail' AND item_id=?").run(chatId, previous.id);
        db.prepare("DELETE FROM memory_detail_fts WHERE detail_id=?").run(previous.id);
        db.prepare("DELETE FROM memory_details WHERE id=?").run(previous.id);
      }
      for (const detail of memory.details ?? []) {
        const existingDetail = db.prepare("SELECT id FROM memory_details WHERE chat_id=? AND memory_id=? AND detail_key=?").get(chatId, id, detail.key) as { id: string } | undefined;
        const detailId = existingDetail?.id ?? randomUUID();
        const ordinals = detail.evidence.map((entry) => evidenceOrdinal(db, chatId, [entry])).filter((value): value is number => value !== null);
        db.prepare(`INSERT INTO memory_details(id,chat_id,memory_id,detail_key,kind,text,participants_json,known_by_json,locations_json,epistemic,salience,retention_class,evidence_json,source_start_ordinal,source_end_ordinal,active,created_revision,created_at,updated_at,role,original_kind,seed_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,memory_id,detail_key) DO UPDATE SET
            role=excluded.role,original_kind=excluded.original_kind,seed_json=excluded.seed_json,kind=excluded.kind,text=excluded.text,participants_json=excluded.participants_json,known_by_json=excluded.known_by_json,
            locations_json=excluded.locations_json,epistemic=excluded.epistemic,salience=excluded.salience,retention_class=excluded.retention_class,
            evidence_json=excluded.evidence_json,source_start_ordinal=excluded.source_start_ordinal,source_end_ordinal=excluded.source_end_ordinal,
            active=1,updated_at=excluded.updated_at`).run(
          detailId, chatId, id, detail.key, detail.kind, detail.text, JSON.stringify(detail.participants), JSON.stringify(detail.knownBy),
          JSON.stringify(detail.locations), detail.epistemic, detail.salience, detail.retention, JSON.stringify(detail.evidence),
          ordinals.length ? Math.min(...ordinals) : null, ordinals.length ? Math.max(...ordinals) : null, 1, revision, timestamp, timestamp, detail.role ?? "supporting", detail.originalKind ?? null, detail.seed ? JSON.stringify(detail.seed) : null,
        );
        detailByKey.set(JSON.stringify([memory.key, detail.key]), detailId);
        const editedHolders = detailAccessEdits.get(detailId);
        if (editedHolders !== undefined) {
          const provenance = db.prepare("SELECT basis,confidence FROM item_access WHERE chat_id=? AND item_kind='detail' AND item_id=? AND holder=?");
          replaceAccess("detail", detailId, editedHolders.map(holder => {
            const previous = provenance.get(chatId, detailId, holder) as { basis: string; confidence: number } | undefined;
            return { holder, basis: previous?.basis ?? "witnessed", confidence: previous?.confidence ?? 1, evidence: detail.evidence };
          }));
        } else replaceAccess("detail", detailId, detail.access !== undefined ? detail.access : detail.knownBy.map((holder) => ({ holder, basis: "witnessed", evidence: detail.evidence, confidence: 1 })));
        syncDetailKnownBy(db, chatId, detailId);
        db.prepare("DELETE FROM memory_detail_fts WHERE detail_id=?").run(detailId);
        db.prepare("INSERT INTO memory_detail_fts(detail_id,chat_id,memory_id,text,participants,locations) VALUES(?,?,?,?,?,?)")
          .run(detailId, chatId, id, augmentSearchText(detail.text, result.language), augmentSearchText(detail.participants.join(" "), result.language), augmentSearchText(detail.locations.join(" "), result.language));
      }
      const traceHolders = memory.knownBy.length > 0
        ? memory.knownBy
        : [...new Set([...memory.participants, ...(memory.witnesses ?? []).map((witness) => witness.name)])];
      for (const holder of traceHolders) {
        db.prepare(`
          INSERT INTO memory_traces(memory_id,character_name,strength,salience,detail_level)
          VALUES(?,?,?,?,?)
          ON CONFLICT(memory_id,character_name) DO UPDATE SET
            salience=MAX(memory_traces.salience,excluded.salience),
            strength=MAX(memory_traces.strength,excluded.strength)
        `).run(id, holder, strength, memory.salience, strength > 0.75 ? "clear" : "gist");
      }
    }

    relationWarnings.push(...storeAtomRelations(db, chatId, result, memoryByKey, relationContext, sourceBatchId, replaceAccess));
    for (const memory of result.memories) {
      const sourceId = memoryByKey.get(memory.key);
      if (!sourceId) continue;
      for (const association of memory.associations) {
        const targetId = memoryByKey.get(association)
          ?? (db.prepare("SELECT id FROM memories WHERE chat_id=? AND memory_key=?").get(chatId, association) as { id: string } | undefined)?.id;
        if (!targetId || targetId === sourceId) continue;
        db.prepare(`
          INSERT INTO memory_edges(chat_id,source_id,target_id,weight,kind,reinforced_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(chat_id,source_id,target_id) DO UPDATE SET
            weight=MIN(1.0,memory_edges.weight+0.05),reinforced_at=excluded.reinforced_at
        `).run(chatId, sourceId, targetId, 0.5, "association", timestamp);
      }
    }

    for (const assertion of result.assertions) {
      const activeRelations = assertion.socialRelation ? activeSocialRelations(db, chatId) : [];
      const manualScope = assertion.socialRelation
        ? activeRelations.filter(row => socialRelationCovers(row, assertion.subject, assertion.socialRelation!) && !userInitiated
          && !canAutomaticallyChange(db,chatId,db.prepare("SELECT * FROM assertions WHERE id=?").get(row.id) as any,assertion.evidence)) : [];
      // Exact labels are already represented; distinct labels need a user decision.
      // Neither route absorbs evidence or changes/ends the manual row.
      if (assertion.socialRelation && manualScope.length) {
        if (!manualScope.some(row => sameSocialRelationLabel(row.relation, assertion.socialRelation!))) {
          const existing = db.prepare("SELECT * FROM assertions WHERE id=?").get(manualScope[0]!.id);
          db.prepare(`INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,created_revision,created_at)
            VALUES(?,?,?,?,?,?,?)`).run(randomUUID(), chatId, "assertion", JSON.stringify(existing), JSON.stringify(assertion), revision, timestamp);
        }
        continue;
      }
      // The reverse mutual relation is already represented. Keep its support/access;
      // directed reverse pairs may express asymmetric facts. Claims remain reviewable.
      if (assertion.changeType !== "claim" && assertion.socialRelation
        && activeRelations.some(row => isReverseMutualSocialRelation(row, assertion.subject, assertion.socialRelation!))) continue;
      const socialRelation = assertion.socialRelation ? JSON.stringify(resolveSocialRelation(db, chatId, assertion.socialRelation, memoryByKey)) : null;
      const stateKind = assertion.socialRelation ? "condition" : assertion.stateKind ?? "condition";
      const firstEvidenceId = assertion.evidence[0]?.messageId;
      const evidenceMessage = firstEvidenceId
        ? db.prepare("SELECT ordinal FROM messages WHERE chat_id=? AND message_id=?").get(chatId, firstEvidenceId) as { ordinal: number } | undefined
        : undefined;
      const validFromOrdinal = evidenceMessage?.ordinal ?? null;
      const activeAssertions = db.prepare(`
        SELECT * FROM assertions
        WHERE chat_id=? AND subject=? AND valid_to_revision IS NULL
        ORDER BY created_at DESC
      `).all(chatId, assertion.subject) as Array<Record<string, any>>;
      const matchingCurrent = activeAssertions.filter((row) => normalizeLedgerPredicate(row.predicate) === assertion.predicate && sameSocialRelationScope(row.social_relation_json, assertion.socialRelation));
      const current = matchingCurrent.find((row) => row.state_kind === stateKind && normalizeLedgerText(row.value) === normalizeLedgerText(assertion.value))
        ?? matchingCurrent[0];
      const requestedTargets = [...new Set(assertion.targetAssertionIds ?? [])]
        .map((id) => activeAssertions.find((row) => row.id === id && sameSocialRelationScope(row.social_relation_json, assertion.socialRelation)))
        .filter((row): row is typeof activeAssertions[number] => Boolean(row));
      const protectedTargets = (requestedTargets.length ? requestedTargets : assertion.changeType === "initial" ? activeAssertions.filter(row=>sameSocialRelationScope(row.social_relation_json,assertion.socialRelation)) : matchingCurrent).filter(row => !canAutomaticallyChange(db,chatId,row,assertion.evidence));
      const compatible = assertion.changeType === "initial" && protectedTargets.every(row=>normalizeLedgerPredicate(row.predicate)!==assertion.predicate && assertion.compatibleWithIds?.includes(row.id));
      if (!userInitiated && protectedTargets.length && !compatible) {
        db.prepare("INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,created_revision,created_at) VALUES(?,?,?,?,?,?,?)")
          .run(randomUUID(),chatId,"assertion_auto_protected",JSON.stringify(protectedTargets),JSON.stringify(assertion),revision,timestamp);
        continue;
      }
      if (current && assertion.changeType === "initial" && current.state_kind === stateKind && normalizeLedgerText(current.value) === normalizeLedgerText(assertion.value)) {
        const evidence = [...JSON.parse(current.evidence_json), ...assertion.evidence].filter((item, index, all) => all.findIndex((candidate) => candidate.messageId === item.messageId && (candidate.quote ?? "") === (item.quote ?? "")) === index);
        db.prepare("UPDATE assertions SET predicate=?,confidence=MAX(confidence,?),evidence_json=?,social_relation_json=COALESCE(?,social_relation_json) WHERE id=?").run(assertion.predicate, assertion.confidence, JSON.stringify(evidence), socialRelation, current.id);
        continue;
      }
      const allowsConcurrentValues = stateKind === "goal" || stateKind === "secret";
      if (current && assertion.changeType === "initial" && !allowsConcurrentValues) {
        db.prepare(`
          INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,created_revision,created_at)
          VALUES(?,?,?,?,?,?,?)
        `).run(randomUUID(), chatId, "assertion", JSON.stringify(current), JSON.stringify(assertion), revision, timestamp);
        continue;
      }
      if (assertion.changeType === "update" && allowsConcurrentValues && matchingCurrent.length > 0 && requestedTargets.length === 0) {
        db.prepare(`
          INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,created_revision,created_at)
          VALUES(?,?,?,?,?,?,?)
        `).run(randomUUID(), chatId, "assertion", JSON.stringify(matchingCurrent), JSON.stringify(assertion), revision, timestamp);
        continue;
      }
      if (assertion.changeType === "claim") {
        db.prepare(`
          INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,created_revision,created_at)
          VALUES(?,?,?,?,?,?,?)
        `).run(randomUUID(), chatId, "unattributed_claim", JSON.stringify(current ?? null), JSON.stringify(assertion), revision, timestamp);
        continue;
      }
      const assertionsToClose = assertion.changeType === "initial" ? [] : requestedTargets.length ? requestedTargets : current ? [current] : [];
      const insertedAssertionId=randomUUID();
      for (const target of assertionsToClose) db.prepare("UPDATE assertions SET valid_to_revision=?,valid_to_ordinal=?,automatic_closure_evidence_json=? WHERE id=?").run(
        revision,
        validFromOrdinal === null ? null : Math.max(0, validFromOrdinal - 1),
        userInitiated ? null : transitionEvidenceJson(db,chatId,assertion.evidence,{successorId:insertedAssertionId}), target.id,
      );
      const sourceMemoryId = assertion.validFromMemoryKey ? memoryByKey.get(assertion.validFromMemoryKey) ?? null : null;
      db.prepare(`
        INSERT INTO assertions(id,chat_id,subject,predicate,value,state_kind,confidence,valid_from_revision,valid_from_ordinal,source_memory_id,evidence_json,retention_class,source_batch_id,created_at,social_relation_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        insertedAssertionId, chatId, assertion.subject, assertion.predicate, assertion.value, stateKind, assertion.confidence,
        revision, validFromOrdinal, sourceMemoryId, JSON.stringify(transitionSourceEvidence(db,chatId,assertion.evidence)), assertion.retention ?? "arc", sourceBatchId ?? null, timestamp, socialRelation,
      );
    }

    for (const belief of result.beliefs) {
      const userDeleted = (db.prepare(`SELECT predicate,value,polarity FROM beliefs
        WHERE chat_id=? AND holder=? COLLATE NOCASE AND subject=? COLLATE NOCASE
          AND active=0 AND source LIKE 'user_deleted:%'`).all(chatId, belief.holder, belief.subject) as Array<{ predicate: string; value: string; polarity: string }>).some((row) =>
        normalizeLedgerPredicate(row.predicate) === belief.predicate
        && normalizeLedgerText(row.value) === normalizeLedgerText(belief.value)
        && row.polarity === belief.polarity);
      if (userDeleted) continue;
      const candidates = db.prepare("SELECT * FROM beliefs WHERE chat_id=? AND holder=? COLLATE NOCASE AND subject=? COLLATE NOCASE AND active=1 AND status='active' ORDER BY created_at DESC")
        .all(chatId, belief.holder, belief.subject) as Array<Record<string, any>>;
      const existing = candidates.find((row) => normalizeLedgerPredicate(row.predicate) === belief.predicate);
      const requestedIds = [...new Set([...(belief.targetBeliefIds ?? []), ...(belief.targetBeliefId ? [belief.targetBeliefId] : [])])];
      const requestedTargets = requestedIds.map((id) => candidates.find((row) => row.id === id)).filter((row): row is typeof candidates[number] => Boolean(row));
      const requestedTarget = requestedTargets[0];
      const target = requestedTarget && normalizeLedgerPredicate(requestedTarget.predicate) === belief.predicate ? requestedTarget : undefined;
      const protectedTargets = candidates.filter(row => (["new","coexist"].includes(belief.action ?? "new") || requestedIds.includes(row.id) || normalizeLedgerPredicate(row.predicate) === belief.predicate)
        && !canAutomaticallyChange(db,chatId,row,belief.evidence));
      const compatible = belief.action === "coexist" && protectedTargets.every(row => belief.compatibleWithIds?.includes(row.id));
      if (!userInitiated && protectedTargets.length && !compatible) {
        db.prepare("INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,created_revision,created_at) VALUES(?,?,?,?,?,?,?)")
          .run(randomUUID(),chatId,"belief_auto_protected",JSON.stringify(protectedTargets),JSON.stringify(belief),revision,timestamp);
        continue;
      }
      if (existing && normalizeLedgerText(existing.value) === normalizeLedgerText(belief.value) && existing.polarity === belief.polarity) {
        const evidence = [...JSON.parse(existing.evidence_json), ...belief.evidence].filter((item, index, all) => all.findIndex((candidate) => candidate.messageId === item.messageId && (candidate.quote ?? "") === (item.quote ?? "")) === index);
        db.prepare("UPDATE beliefs SET predicate=?,confidence=MAX(confidence,?),evidence_json=? WHERE id=?").run(belief.predicate, belief.confidence, JSON.stringify(evidence), existing.id);
        continue;
      }
      const beliefOrdinal = evidenceOrdinal(db, chatId, belief.evidence);
      if ((belief.action === "reinforce" || belief.action === "supersede" || belief.action === "dispute") && !target) {
        db.prepare(`INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,created_revision,created_at) VALUES(?,?,?,?,?,?,?)`)
          .run(randomUUID(), chatId, "belief_action_target", JSON.stringify(candidates), JSON.stringify(belief), revision, timestamp);
        continue;
      }
      if (belief.action === "reinforce" && target) {
        for (const reinforced of requestedTargets.length ? requestedTargets : [target]) {
          const evidence = [...JSON.parse(reinforced.evidence_json), ...belief.evidence].filter((item, index, all) => all.findIndex((candidate) => candidate.messageId === item.messageId && (candidate.quote ?? "") === (item.quote ?? "")) === index);
          db.prepare("UPDATE beliefs SET confidence=MAX(confidence,?),evidence_json=? WHERE id=?").run(belief.confidence, JSON.stringify(evidence), reinforced.id);
        }
        continue;
      }
      const insertedId = randomUUID();
      if (belief.action === "supersede" && target) {
        const supersededTargets = requestedTargets.length ? requestedTargets : [target];
        for (const superseded of supersededTargets) db.prepare("UPDATE beliefs SET active=0,status='superseded',superseded_by=?,valid_to_ordinal=?,automatic_closure_evidence_json=? WHERE id=?").run(
          insertedId, beliefOrdinal === null ? null : Math.max(0, beliefOrdinal - 1), userInitiated ? null : transitionEvidenceJson(db,chatId,belief.evidence), superseded.id,
        );
      } else if (belief.action === "dispute" && target) {
        db.prepare("UPDATE beliefs SET status='disputed',automatic_closure_evidence_json=? WHERE id=?")
          .run(userInitiated ? null : transitionEvidenceJson(db,chatId,belief.evidence,{successorId:insertedId,action:'dispute',previousStatus:target.status}),target.id);
      }
      const status = belief.action === "dispute" ? "disputed" : "active";
      db.prepare(`
        INSERT INTO beliefs(id,chat_id,holder,subject,predicate,value,polarity,confidence,source,evidence_json,active,status,retention_class,source_batch_id,created_revision,valid_from_ordinal,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)
      `).run(
        insertedId, chatId, belief.holder, belief.subject, belief.predicate, belief.value, belief.polarity,
        belief.confidence, belief.source ?? null, JSON.stringify(belief.evidence), status, belief.retention ?? "arc", sourceBatchId ?? null, revision, beliefOrdinal, timestamp,
      );
    }

    const affectedRelationshipPairs: Array<{ from: string; to: string }> = [];
    const setupFingerprint = (db.prepare("SELECT relationship_setup_fingerprint FROM chats WHERE id=?").get(chatId) as { relationship_setup_fingerprint: string | null } | undefined)?.relationship_setup_fingerprint ?? null;
    for (const baseline of result.relationshipBaselines ?? []) {
      const existingBaseline = db.prepare("SELECT id,source,active FROM relationship_baselines WHERE chat_id=? AND from_entity=? AND to_entity=?").get(chatId, baseline.from, baseline.to) as { id: string; source: string; active: number } | undefined;
      if (existingBaseline?.active === 1 && existingBaseline.source !== "transcript_unknown") continue;
      const knownAxes = RELATIONSHIP_AXES.filter((axis) => baseline[axis] !== "unknown");
      if (knownAxes.length === 0) continue;
      const qualitative = Object.fromEntries(RELATIONSHIP_AXES.map((axis) => [axis, baseline[axis]]));
      if (existingBaseline) db.prepare(`UPDATE relationship_baselines SET qualitative_json=?,known_axes_json=?,reason=?,source=?,source_quote=?,evidence_json=?,setup_fingerprint=?,active=1,created_revision=?,created_at=? WHERE id=?`).run(
        JSON.stringify(qualitative), JSON.stringify(knownAxes), baseline.reason, baseline.source, baseline.sourceQuote ?? null, JSON.stringify(baseline.evidence), baseline.source === "setup" ? setupFingerprint : null, revision, timestamp, existingBaseline.id,
      );
      else db.prepare(`INSERT INTO relationship_baselines(
          id,chat_id,from_entity,to_entity,qualitative_json,known_axes_json,reason,source,source_quote,evidence_json,setup_fingerprint,active,created_revision,created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          randomUUID(), chatId, baseline.from, baseline.to, JSON.stringify(qualitative), JSON.stringify(knownAxes), baseline.reason,
          baseline.source, baseline.sourceQuote ?? null, JSON.stringify(baseline.evidence), baseline.source === "setup" ? setupFingerprint : null,
          1, revision, timestamp,
        );
      affectedRelationshipPairs.push({ from: baseline.from, to: baseline.to });
    }
    for (const pair of affectedRelationshipPairs) queueRelationshipProjection(db, chatId, pair.from, pair.to);

    const jobOrdinals = sourceJobId ? db.prepare(`SELECT MIN(m.ordinal) AS start_ordinal,MAX(m.ordinal) AS end_ordinal
      FROM jobs j JOIN json_each(j.payload_json,'$.sourceMessageIds') ids JOIN messages m ON m.chat_id=j.chat_id AND m.message_id=ids.value WHERE j.id=?`)
      .get(sourceJobId) as { start_ordinal: number | null; end_ordinal: number | null } : undefined;
    for (const event of result.relationshipEvents ?? []) {
      const sourceMemoryId = event.memoryKey ? memoryByKey.get(event.memoryKey) ?? null : null;
      const detailOwner = event.detailKey ? relationshipDetailOwner(result, event) : undefined;
      const sourceDetailId = detailOwner !== undefined ? detailByKey.get(JSON.stringify([detailOwner, event.detailKey])) ?? null : null;
      const fingerprint = JSON.stringify({ from: event.from, to: event.to, changes: event.changes, reason: normalizeLedgerText(event.reason), evidence: event.evidence });
      const duplicate = (db.prepare("SELECT id,changes_json,reason,evidence_json FROM relationship_events WHERE chat_id=? AND from_entity=? AND to_entity=? AND active=1 AND source_job_id=?")
        .all(chatId, event.from, event.to, sourceJobId) as Array<{ id: string; changes_json: string; reason: string; evidence_json: string }>).some((row) =>
          JSON.stringify({ from: event.from, to: event.to, changes: JSON.parse(row.changes_json), reason: normalizeLedgerText(row.reason), evidence: JSON.parse(row.evidence_json) }) === fingerprint);
      if (duplicate) continue;
      db.prepare(`INSERT INTO relationship_events(id,chat_id,from_entity,to_entity,changes_json,reason,evidence_json,source_memory_id,source_detail_id,source_job_id,source_batch_id,source_start_ordinal,source_end_ordinal,active,created_revision,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(randomUUID(), chatId, event.from, event.to, JSON.stringify(event.changes), event.reason,
        JSON.stringify(event.evidence), sourceMemoryId, sourceDetailId, sourceJobId, sourceBatchId ?? null, jobOrdinals?.start_ordinal ?? evidenceOrdinal(db, chatId, event.evidence),
        jobOrdinals?.end_ordinal ?? evidenceOrdinal(db, chatId, event.evidence), revision, timestamp);
      queueRelationshipProjection(db, chatId, event.from, event.to);
    }

    for (const event of result.physicalIntimacy ?? []) {
      const [participantA, participantB] = [...event.participants].sort((left, right) => left.localeCompare(right));
      const startOrdinal = evidenceOrdinal(db, chatId, event.evidence);
      const sourceMemoryId = resolvePhysicalSourceMemoryId(db, chatId, memoryByKey, event.memoryKey, event.evidence);
      let insertedMilestone = false;
      for (const milestoneKey of intimacyMilestoneKeys(event.act)) {
        const existing = db.prepare(`SELECT id,source_memory_id,source_start_ordinal,active,manual_override,deleted_by_user FROM physical_intimacy_milestones
          WHERE chat_id=? AND participant_a=? AND participant_b=? AND milestone_key=?`).get(chatId, participantA, participantB, milestoneKey) as {
            id: string; source_memory_id: string | null; source_start_ordinal: number | null; active: number; manual_override: number; deleted_by_user: number;
          } | undefined;
        if (existing?.manual_override === 1 || existing?.deleted_by_user === 1) continue;
        const replaceExisting = Boolean(existing) && (existing!.active === 0
          || startOrdinal !== null && (existing!.source_start_ordinal === null || startOrdinal < existing!.source_start_ordinal)
          || startOrdinal === existing!.source_start_ordinal && !existing!.source_memory_id && Boolean(sourceMemoryId));
        if (existing && !replaceExisting) continue;
        const storedMilestone = existing?.id ?? randomUUID();
        if (existing) {
          db.prepare(`UPDATE physical_intimacy_milestones SET act=?,custom_label=?,initiator=?,interaction_context=?,circumstance=?,evidence_json=?,source_quote=?,
            source_memory_id=?,source_batch_id=?,source_start_ordinal=?,active=1,deleted_by_user=0,created_revision=?,created_at=? WHERE id=?`).run(
            event.act, event.customLabel ?? null, event.initiator ?? null, event.interactionContext ?? "ambiguous", event.circumstance ?? null,
            JSON.stringify(event.evidence), event.sourceQuote ?? null, sourceMemoryId, sourceBatchId ?? null, startOrdinal, revision, timestamp, storedMilestone,
          );
        } else {
          db.prepare(`INSERT INTO physical_intimacy_milestones(
            id,chat_id,participant_a,participant_b,milestone_key,act,custom_label,initiator,interaction_context,circumstance,evidence_json,source_quote,source_memory_id,source_batch_id,source_start_ordinal,auto_inject,manual_override,deleted_by_user,active,created_revision,created_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,0,1,?,?)`).run(storedMilestone, chatId, participantA, participantB, milestoneKey, event.act,
            event.customLabel ?? null, event.initiator ?? null, event.interactionContext ?? "ambiguous", event.circumstance ?? null,
            JSON.stringify(event.evidence), event.sourceQuote ?? null, sourceMemoryId, sourceBatchId ?? null, startOrdinal, revision, timestamp);
        }
        insertedMilestone = true;
        replaceAccess("physical_milestone", storedMilestone,
          event.access !== undefined ? event.access : event.participants.map((holder) => ({ holder, basis: "experienced", evidence: event.evidence, confidence: 1 })));
      }
      if (insertedMilestone && sourceMemoryId) {
        const row = db.prepare("SELECT landmark_kinds_json FROM memories WHERE id=?").get(sourceMemoryId) as { landmark_kinds_json: string } | undefined;
        const kinds = row ? JSON.parse(row.landmark_kinds_json || "[]") as Array<{ kind: string; label?: string }> : [];
        if (!kinds.some((kind) => kind.kind === "intimacy_milestone")) kinds.push({ kind: "intimacy_milestone" });
        db.prepare("UPDATE memories SET landmark=1,landmark_kinds_json=?,updated_at=? WHERE id=?").run(JSON.stringify(kinds), timestamp, sourceMemoryId);
      }
    }

    for (const promise of result.promises) {
      const existingPromise = db.prepare("SELECT * FROM promises WHERE chat_id=? AND promise_key=?").get(chatId, promise.key) as Record<string,any> | undefined;
      const protectedPromises = (existingPromise ? [existingPromise] : db.prepare("SELECT * FROM promises WHERE chat_id=? AND promisor=? COLLATE NOCASE AND promisee=? COLLATE NOCASE").all(chatId,promise.promisor,promise.promisee) as Array<Record<string,any>>).filter(row=>!canAutomaticallyChange(db,chatId,row,promise.evidence ?? []));
      const compatible = !existingPromise && protectedPromises.every(row=>promise.compatibleWithIds?.includes(row.id));
      if (!userInitiated && protectedPromises.length && !compatible) {
        db.prepare("INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,created_revision,created_at) VALUES(?,?,?,?,?,?,?)")
          .run(randomUUID(),chatId,"promise_auto_protected",JSON.stringify(protectedPromises),JSON.stringify(promise),revision,timestamp);
        continue;
      }
      const promiseId = existingPromise?.id ?? randomUUID();
      const sourceMemoryId = promise.memoryKey ? memoryByKey.get(promise.memoryKey) ?? null : null;
      db.prepare(`
        INSERT INTO promises(id,chat_id,promise_key,promisor,promisee,content,status,scheduled_for,status_reason,source_memory_id,retention_scope,source_batch_id,updated_revision,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(chat_id,promise_key) DO UPDATE SET
          promisor=excluded.promisor,promisee=excluded.promisee,content=excluded.content,status=excluded.status,
          scheduled_for=COALESCE(excluded.scheduled_for,promises.scheduled_for),status_reason=excluded.status_reason,
          source_memory_id=COALESCE(excluded.source_memory_id,promises.source_memory_id),
          retention_scope=excluded.retention_scope,
          source_batch_id=COALESCE(excluded.source_batch_id,promises.source_batch_id),
          updated_revision=excluded.updated_revision
      `).run(
        promiseId, chatId, promise.key, promise.promisor, promise.promisee, promise.content, promise.status,
        promise.scheduledFor ?? null, promise.statusReason ?? null, sourceMemoryId, promise.scope ?? "arc", sourceBatchId ?? null, revision, timestamp,
      );
      if (!existingPromise || promise.access !== undefined) replaceAccess("promise", promiseId,
        promise.access !== undefined ? promise.access : [promise.promisor, promise.promisee].map((holder) => ({ holder, basis: "experienced", evidence: promise.evidence ?? [], confidence: 1 })));
      const sourceOrdinal = evidenceOrdinal(db,chatId,promise.evidence ?? []);
      const effective=db.prepare("SELECT * FROM promises WHERE id=?").get(promiseId) as Record<string,any>;
      db.prepare(`INSERT INTO promise_events(id,chat_id,promise_id,promise_key,promisor,promisee,content,status,scheduled_for,status_reason,source_memory_id,source_batch_id,source_ordinal,created_revision,created_at,evidence_json,user_authored) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        randomUUID(), chatId, promiseId, effective.promise_key, effective.promisor, effective.promisee, effective.content, effective.status, effective.scheduled_for, effective.status_reason, effective.source_memory_id, effective.source_batch_id, sourceOrdinal, revision, timestamp, transitionEvidenceJson(db,chatId,promise.evidence ?? []), Number(userInitiated),
      );
    }

    ingestSocialKnowledge(db, chatId, result.socialKnowledge ?? [], memoryByKey, sourceBatchId);

    const sceneNames = new Set([
      ...result.entities.map((entity) => entity.name),
      ...result.memories.flatMap((memory) => memory.participants),
      ...(result.relationshipEvents ?? []).flatMap((event) => [event.from, event.to]),
      ...(result.socialKnowledge ?? []).flatMap((item) => [item.holder, item.subject]),
      ...(result.physicalIntimacy ?? []).flatMap((event) => event.participants),
    ].map((name) => name.trim()).filter(Boolean));
    const durableNames = new Set([
      ...result.memories.filter((memory) => memory.retention !== "scene" || (memory.details ?? []).some((detail) => detail.retention === "durable" || detail.kind === "open_thread")).flatMap((memory) => memory.participants),
      ...(result.relationshipEvents ?? []).flatMap((event) => [event.from, event.to]),
      ...result.promises.flatMap((promise) => [promise.promisor, promise.promisee]),
      ...(result.physicalIntimacy ?? []).flatMap((event) => event.participants),
    ]);
    const sceneKey = sourceJobId || `manual:${revision}`;
    for (const name of sceneNames) db.prepare("INSERT OR IGNORE INTO entity_scene_presence(chat_id,entity_name,scene_key,created_at) VALUES(?,?,?,?)").run(chatId, name, sceneKey, timestamp);
    for (const name of sceneNames) {
      const sceneCount = (db.prepare("SELECT count(*) AS count FROM entity_scene_presence WHERE chat_id=? AND entity_name=? COLLATE NOCASE").get(chatId, name) as { count: number }).count;
      const current = db.prepare("SELECT durable_links,pinned,tier FROM entity_prominence WHERE chat_id=? AND entity_name=? COLLATE NOCASE").get(chatId, name) as { durable_links: number; pinned: number; tier: string } | undefined;
      const durableLinks = Number(current?.durable_links ?? 0) + (durableNames.has(name) ? 1 : 0);
      const tier = current?.pinned ? "core" : sceneCount >= 4 && durableLinks > 0 ? "core" : sceneCount >= 2 || durableLinks > 0 ? "recurring" : "incidental";
      db.prepare(`INSERT INTO entity_prominence(chat_id,entity_name,tier,scene_count,durable_links,pinned,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(chat_id,entity_name) DO UPDATE SET tier=CASE WHEN entity_prominence.tier='core' THEN 'core' ELSE excluded.tier END,
          scene_count=excluded.scene_count,durable_links=excluded.durable_links,pinned=entity_prominence.pinned,updated_at=excluded.updated_at`)
        .run(chatId, name, tier, sceneCount, durableLinks, current?.pinned ?? 0, timestamp);
    }

    for (const memoryId of new Set(memoryByKey.values())) refreshMemoryFts(db, memoryId);
    applySeedResolutions(db, chatId, result.seedResolutions);
    pruneDetailAccessEdits(db, chatId);
    invalidateStorySupports(db,chatId,revokedStorySupports);
  })();
  return relationWarnings;
}
