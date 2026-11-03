import { memoryHasLineCorrectionSql } from './memory-detail-edits.js';
import { readProgressCells, resetAutomaticProgressCell } from './pair-progress.js';
import { syncManualCognition } from "./social-knowledge.js";
import { readRemovedAliases, readUserDeletions, removedAliasesKey } from "./user-deletions.js";
import { parseSocialRelation } from "./social-relations.js";
import { createHash, randomUUID } from "node:crypto";
import { bindInheritedMemoryGroups, invalidateChangedMemoryGroups } from './memory-grouping.js';
import {
  augmentSearchText,
  type ChatLineageStatus,
  type LineageProbeResponse,
  type ManualLineagePreview,
  type ManualLineagePreviewRequest,
  type TurnPrepareRequest,
  normalizeStoryTime,
} from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import type { Statement } from "better-sqlite3";
import { deleteDerivedRows } from "./derived-state.js";
import { materializeInitialRelationshipProjections } from "./initial-calibration.js";
import { rebuildCharacterRecallTraces } from "./ingest.js";
import { refreshMemoryFts } from "./memory-search-document.js";
import { EVERYONE_HOLDER, readDetailAccessEdits, writeDetailAccessEdits, syncDetailKnownBy, memoryDetailAccess } from "./item-access.js";
import { isOrdinalFallbackMessageId, sourceFingerprint } from './source-fingerprint.js';
import { lineageSources, matchLineageSources } from './lineage-matching.js';
import { remapInheritedSources } from './lineage-sources.js';
import { pruneTranslationCache, translationCacheKey } from './translation-cache.js';
import { inheritQuizzes } from './quiz.js';
import { memoryTransferQueuedJobs, cancelQueuedMemoryTransferJobs } from './jobs.js';
import { personaHintKey, readPersonaName, readViewPreferences, writeViewPreferences } from './view-preferences.js';

type Candidate = { chatId: string; title: string; forkMessageId: string; forkOrdinal: number; firstSharedOrdinal: number; sharedMessages: number };
type Counts = Record<string, number>;
type CloneOptions = { preserveChildConfiguration?: boolean; preserveUserCorrections?: boolean; skipQuizzes?: boolean };
type CandidateResolution = { candidates: Candidate[]; detection: "marker" | "message_identity" | "source_sequence" };

const json = <T>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};

function remapJson(value: string, ids: Map<string, string>): string {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return value; }
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") return ids.get(item) ?? item;
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
    return item;
  };
  return JSON.stringify(visit(parsed));
}

function lineageRow(db: RcmDatabase, chatId: string): any | undefined {
  return db.prepare("SELECT * FROM chat_lineage WHERE child_chat_id=?").get(chatId);
}

function applyOrdinalOffset(request: TurnPrepareRequest, offset: number): void {
  if (!offset) return;
  for (const message of request.messages) message.ordinal += offset;
  for (const item of request.messageVisibility ?? []) item.ordinal += offset;
}

function refreshOrdinalOffset(db: RcmDatabase, request: TurnPrepareRequest, storedOffset: number): number {
  if (!request.messageVisibility?.length) return storedOffset;
  const stored = new Map((db.prepare("SELECT message_id,ordinal FROM messages WHERE chat_id=?").all(request.chatId) as Array<{ message_id: string; ordinal: number }>)
    .map((message) => [message.message_id, message.ordinal]));
  const offsets = new Set<number>();
  for (const item of request.messageVisibility) {
    const ordinal = stored.get(item.id);
    if (ordinal !== undefined) offsets.add(ordinal - item.ordinal);
  }
  // Re-numbering caused by /del or /cut moves every retained message by the
  // same amount. Mixed offsets indicate edits or an incomplete projection;
  // keep the last proven value instead of guessing.
  if (offsets.size !== 1) return storedOffset;
  return offsets.values().next().value ?? storedOffset;
}

export function getChatLineage(db: RcmDatabase, chatId: string): ChatLineageStatus {
  const row = lineageRow(db, chatId);
  if (!row) return { status: "none" };
  const inheritedCounts = json<Counts>(row.counts_json, {});
  if (row.status === "inherited" && inheritedCounts.relationships === undefined) {
    inheritedCounts.relationships = (db.prepare("SELECT COUNT(*) count FROM relationship_projections WHERE chat_id=?").get(chatId) as {count:number}).count;
  }
  const unfinishedInherited = Number((db.prepare(`
    SELECT COUNT(*) AS count FROM messages m
    WHERE m.chat_id=? AND m.extraction_state IN ('pending','queued')
      AND EXISTS(SELECT 1 FROM chat_lineage_items i WHERE i.child_chat_id=m.chat_id AND i.item_kind='message' AND i.child_item_id=m.message_id)
  `).get(chatId) as { count: number }).count);
  if (unfinishedInherited > 0) inheritedCounts.pendingReextraction = unfinishedInherited;
  else delete inheritedCounts.pendingReextraction;
  return {
    status: row.status,
    kind: row.kind,
    parentChatId: row.parent_chat_id ?? undefined,
    parentTitle: (db.prepare("SELECT chat_title FROM chats WHERE id=?").get(row.parent_chat_id ?? '') as {chat_title:string} | undefined)?.chat_title ?? row.parent_title ?? undefined,
    forkMessageId: row.fork_message_id ?? undefined,
    forkOrdinal: row.fork_ordinal ?? undefined,
    detection: row.detection,
    acknowledgedAt: row.acknowledged_at ?? undefined,
    appliedAt: row.applied_at ?? undefined,
    inheritedCounts,
    ancestry: lineageAncestry(db, chatId),
    ambiguousCandidates: json<NonNullable<ChatLineageStatus['ambiguousCandidates']>>(row.candidates_json, [])
      .filter(item => eligibleLineageParent(db,item.chatId)).map(item => ({...item,
        title: (db.prepare("SELECT chat_title FROM chats WHERE id=?").get(item.chatId) as {chat_title:string} | undefined)?.chat_title ?? item.title,
        memories: candidateMemoryCount(db,item.chatId),
      })),
  };
}

function lineageAncestry(db: RcmDatabase, chatId: string): NonNullable<ChatLineageStatus["ancestry"]> {
  const path: NonNullable<ChatLineageStatus["ancestry"]> = [];
  const seen = new Set<string>();
  let currentId: string | undefined = chatId;
  let missingTitle: string | undefined;
  while (currentId && path.length < 64 && !seen.has(currentId)) {
    seen.add(currentId);
    const chat = db.prepare("SELECT id,COALESCE(chat_title,id) AS title FROM chats WHERE id=?").get(currentId) as { id: string; title: string } | undefined;
    const currentLineage = lineageRow(db, currentId);
    const independent = currentLineage?.status === "independent" || currentLineage?.status === "reverted";
    path.push({
      chatId: currentId,
      title: chat?.title ?? missingTitle,
      exists: Boolean(chat),
      independent,
      kind: currentLineage?.kind ?? undefined,
      forkMessageId: currentLineage?.fork_message_id ?? undefined,
      forkOrdinal: currentLineage?.fork_ordinal ?? undefined,
      detection: currentLineage?.detection ?? undefined,
    });
    if (independent || !currentLineage?.parent_chat_id) break;
    missingTitle = currentLineage.parent_title ?? undefined;
    currentId = currentLineage.parent_chat_id;
  }
  return path.reverse();
}

function wouldCreateCycle(db: RcmDatabase, childChatId: string, parentChatId: string): boolean {
  if (childChatId === parentChatId) return true;
  const seen = new Set<string>();
  let current: string | undefined = parentChatId;
  while (current && !seen.has(current)) {
    if (current === childChatId) return true;
    seen.add(current);
    const lineage = lineageRow(db, current);
    current = lineage?.status === "inherited" ? lineage.parent_chat_id ?? undefined : undefined;
  }
  return false;
}

function candidateMemoryCount(db: RcmDatabase, chatId: string): number {
  return (db.prepare("SELECT COUNT(*) count FROM memories WHERE chat_id=? AND active=1").get(chatId) as {count:number}).count;
}

function eligibleLineageParent(db: RcmDatabase, chatId: string): boolean {
  if (!db.prepare("SELECT 1 FROM chats WHERE id=?").get(chatId)) return false;
  const status = lineageRow(db,chatId)?.status;
  return !['independent','reverted'].includes(status) || candidateMemoryCount(db,chatId) > 0;
}

function exactCandidates(db: RcmDatabase, request: TurnPrepareRequest, onlyChats?: Set<string>): Candidate[] {
  const items = (request.messageVisibility ?? []).filter((item) => item.contentHash && item.visibility !== "comment");
  if (!items.length) return [];
  const chats = db.prepare("SELECT id,COALESCE(chat_title,id) title FROM chats WHERE character_id=? AND id<>? AND is_internal=0").all(request.characterId, request.chatId) as Array<{ id: string; title: string }>;
  const candidates: Candidate[] = [];
  for (const chat of chats) {
    if (!eligibleLineageParent(db,chat.id)) continue;
    if (onlyChats && !onlyChats.has(chat.id)) continue;
    const pairs = matchLineageSources(lineageSources(db, chat.id), request);
    const shared = pairs.filter(pair => pair.child.visibility !== 'comment');
    if (!shared.length) continue;
    if (shared.length < 2 && shared.some(pair => pair.parent.message_id !== pair.child.id)) continue;
    // Identity matching is exact and ordered. A single matching tail message is
    // too weak; branch markers are the exception and are handled separately.
    if (shared.length < Math.min(2, items.length)) continue;
    const parentOrdinals = shared.map((item) => item.parent.ordinal);
    if (parentOrdinals.some((ordinal, index) => index > 0 && ordinal <= parentOrdinals[index - 1]!)) continue;
    const fork = pairs.at(-1)!.parent;
    candidates.push({ chatId: chat.id, title: chat.title, forkMessageId: fork.message_id, forkOrdinal: fork.ordinal, firstSharedOrdinal: pairs[0]!.parent.ordinal, sharedMessages: shared.length });
  }
  return candidates.sort((a, b) => b.sharedMessages - a.sharedMessages);
}

function resolveCandidates(db: RcmDatabase, request: TurnPrepareRequest): CandidateResolution {
  const hint = request.lineageHint;
  if (hint) {
    // Look up marker owners using compact IDs/hashes before reading transcripts.
    // A copied marker retains its exact content even if its own ID was reissued.
    const marker = request.messageVisibility?.find(item => item.id === hint.markerMessageId);
    const owners = db.prepare(`SELECT DISTINCT c.id FROM chats c JOIN messages m ON m.chat_id=c.id
      WHERE c.character_id=? AND c.id<>? AND c.is_internal=0 AND m.host_visibility='comment'
        AND m.lifecycle IN ('committed','pending','client_pruned') AND (m.message_id=? OR m.content_hash=?)`)
      .all(request.characterId,request.chatId,hint.markerMessageId ?? '',marker?.contentHash ?? '') as Array<{id:string}>;
    if (owners.length) {
      const candidates = exactCandidates(db,request,new Set(owners.map(owner=>owner.id)))
        .filter(candidate=>!wouldCreateCycle(db,request.chatId,candidate.chatId));
      const ownerPairs = candidates.map(candidate=>matchLineageSources(lineageSources(db,candidate.chatId),request));
      const definiteCopy = ownerPairs.some(pairs=>pairs.some(pair=>pair.child.id === hint.markerMessageId && pair.parent.message_id === pair.child.id)
        || pairs.some(pair=>pair.child.visibility !== 'comment' && pair.child.ordinal > (hint.markerOrdinal ?? Infinity)));
      if (!definiteCopy && hint.markerMessageId) {
        // Reissued copies made immediately after a fork are indistinguishable
        // from another fresh fork at that exact point. Offer both proven origins.
        const explicit = resolveCandidates(db,{...request,lineageHint:{...hint,markerMessageId:undefined}});
        for (const candidate of explicit.candidates) if (!candidates.some(item=>item.chatId === candidate.chatId)) candidates.push(candidate);
        return {candidates,detection:'source_sequence'};
      }
      return {candidates,detection: candidates.some(candidate => matchLineageSources(lineageSources(db,candidate.chatId),request)
        .some(pair=>pair.parent.message_id !== pair.child.id)) ? 'source_sequence' : 'message_identity'};
    }
    const parent = db.prepare('SELECT id,COALESCE(chat_title,id) title FROM chats WHERE id=? AND character_id=? AND is_internal=0')
      .get(hint.parentChatId,request.characterId) as {id:string;title:string}|undefined;
    if (parent && eligibleLineageParent(db,parent.id) && !wouldCreateCycle(db,request.chatId,parent.id)) {
      const rows = lineageSources(db,parent.id);
      const fork = rows.find(row=>row.message_id === hint.forkMessageId);
      const prefix = {...request,messageVisibility:request.messageVisibility?.filter(item=>hint.markerOrdinal === undefined || item.ordinal < hint.markerOrdinal)};
      const pairs = fork ? matchLineageSources(rows.filter(row=>row.ordinal <= fork.ordinal),prefix) : [];
      const matched = new Set(pairs.map(pair=>pair.child.id));
      const required = (prefix.messageVisibility ?? []).filter(item=>item.visibility !== 'comment');
      if (fork && pairs.length && required.length && pairs.at(-1)!.parent.message_id === fork.message_id
        && required.every(item=>matched.has(item.id))) return {detection:'marker',candidates:[{
          chatId:parent.id,title:parent.title,forkMessageId:fork.message_id,forkOrdinal:fork.ordinal,
          firstSharedOrdinal:pairs[0]!.parent.ordinal,sharedMessages:required.length,
        }]};
    }
  }
  const candidates = exactCandidates(db,request).filter(candidate=>!wouldCreateCycle(db,request.chatId,candidate.chatId));
  return {candidates,detection: candidates.some(candidate => matchLineageSources(lineageSources(db,candidate.chatId),request)
    .some(pair=>pair.parent.message_id !== pair.child.id)) ? 'source_sequence' : 'message_identity'};
}
function candidateKind(db: RcmDatabase, candidate: Candidate, detection: CandidateResolution["detection"]): "copy" | "branch" | "pruned_copy" {
  if (detection === "marker") return "branch";
  if (candidate.firstSharedOrdinal > 0) return "pruned_copy";
  const parentMax = Number((db.prepare("SELECT COALESCE(MAX(ordinal),-1) max FROM messages WHERE chat_id=? AND lifecycle IN ('committed','client_pruned','pending')").get(candidate.chatId) as { max: number }).max);
  return candidate.forkOrdinal < parentMax ? "branch" : "copy";
}

function probeFingerprint(db: RcmDatabase, request: TurnPrepareRequest, resolution: CandidateResolution): string {
  const parents = resolution.candidates.map((candidate) => {
    const row = db.prepare("SELECT updated_at,revision FROM chats WHERE id=?").get(candidate.chatId) as { updated_at: number; revision: number } | undefined;
    return [candidate.chatId, row?.updated_at ?? 0, row?.revision ?? 0, candidate.forkMessageId, candidate.forkOrdinal, candidate.sharedMessages];
  });
  return createHash("sha256").update(JSON.stringify({
    chatId: request.chatId,
    characterId: request.characterId,
    detection: resolution.detection,
    parents,
    projection: (request.messageVisibility ?? []).map((item) => [item.id, item.ordinal, item.role, item.visibility,
      item.contentHash, item.comparisonHash, item.sourceRecordId, item.displayContentHash, item.displayComparisonHash]),
  })).digest("hex");
}

export function probeChatLineage(db: RcmDatabase, request: TurnPrepareRequest): LineageProbeResponse {
  const resolution = resolveCandidates(db, request);
  const candidates = resolution.candidates.map((candidate) => ({
    ...candidate,
    kind: candidateKind(db, candidate, resolution.detection),
    inheritedCounts: inheritanceCounts(db, candidate.chatId, candidate.forkOrdinal),
  }));
  if (!candidates.length) return { status: "none", candidates: [] };
  const ambiguous = candidates.length > 1 && candidates[0]!.sharedMessages === candidates[1]!.sharedMessages;
  return {
    status: ambiguous ? "ambiguous" : "unique",
    detection: resolution.detection,
    fingerprint: probeFingerprint(db, request, resolution),
    candidates: ambiguous ? candidates : [candidates[0]!],
  };
}

function insertShell(db: RcmDatabase, request: TurnPrepareRequest): void {
  const at = Date.now();
  db.prepare(`INSERT OR IGNORE INTO chats(id,chat_title,character_id,profile,include_user_messages,extraction_group_turns,memory_language,ingestion_state,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?, 'managed',0,?,?)`)
    .run(request.chatId, request.chatTitle ?? null, request.characterId, request.profile, request.includeUserMessages === false ? 0 : 1, request.extractionGroupTurns ?? 6, request.memoryLanguage ?? "en", at, at);
}

function cloneLineage(
  db: RcmDatabase,
  request: TurnPrepareRequest,
  candidate: Candidate,
  kind: "copy" | "branch" | "pruned_copy",
  detection: "marker" | "message_identity" | "source_sequence" | "user" | "manual_cross_bot",
  options: CloneOptions = {},
): Counts {
  // Statements live only for this copy; repeated rows share compiled SQL.
  const statements = new Map<string, Statement<unknown[]>>();
  const prepare = (sql: string) => {
    let statement = statements.get(sql);
    if (!statement) { statement = db.prepare(sql); statements.set(sql, statement); }
    return statement;
  };
  const mapItem = (kind: string, childId: string, parentId: string) => prepare(
    "INSERT OR IGNORE INTO chat_lineage_items(child_chat_id,item_kind,child_item_id,parent_item_id) VALUES(?,?,?,?)"
  ).run(request.chatId, kind, childId, parentId);
  const child = request.chatId;
  const parent = candidate.chatId;
  invalidateChangedMemoryGroups(db, parent);
  if (wouldCreateCycle(db, child, parent)) throw new Error("LINEAGE_CYCLE");
  const fork = candidate.forkOrdinal;
  const sourceOrdinals = new Map((prepare("SELECT message_id,ordinal FROM messages WHERE chat_id=?").all(parent) as Array<{message_id:string;ordinal:number}>).map(row => [row.message_id, row]));
  const dropsAutomaticClosure=(row:any):boolean=>json<Array<{messageId?:string}>>(row.automatic_closure_evidence_json,[])
    .some(evidence=>evidence.messageId && (sourceOrdinals.get(evidence.messageId)?.ordinal ?? -1)>fork);
  const sourcePairs = matchLineageSources(lineageSources(db,parent).filter(row => row.ordinal <= fork), request);
  const messageMap = new Map(sourcePairs.map(pair => [pair.parent.message_id,pair.child.id]));
  const now = Date.now();
  const counts: Counts = {};
  const ordinalOffset = Math.max(0, ...sourcePairs.map(pair => pair.parent.ordinal - pair.child.ordinal));
  const memoryMap = new Map<string, string>();
  const detailMap = new Map<string, string>();
  const dialogueMap = new Map<string, string>();
  const atomRelationMap = new Map<string, string>();
  const assertionMap = new Map<string, string>();
  const beliefMap = new Map<string,string>();
  const atomRelationSourceBatches = new Map<string, string | null>();
  const promiseMap = new Map<string, string>();
  const physicalMilestoneMap = new Map<string, string>();
  const relationshipEventMap = new Map<string, string>();
  const episodeMap = new Map<string, string>();
  const pendingReextractionIds = new Set<string>();

  db.transaction(() => {
    insertShell(db, request);
    const parentChat = prepare("SELECT * FROM chats WHERE id=?").get(parent) as any;
    if (!parentChat) throw new Error("Lineage parent not found");
    const inheritedLanguage = parentChat.memory_language ?? "en";
    const requestedLanguage = request.memoryLanguage ?? inheritedLanguage;
    if (options.preserveChildConfiguration) {
      prepare("UPDATE chats SET memory_language=?,pending_memory_language=?,ingestion_state='managed',updated_at=? WHERE id=?")
        .run(inheritedLanguage, requestedLanguage === inheritedLanguage ? null : requestedLanguage, now, child);
    } else {
      request.profile = parentChat.profile;
      request.includeUserMessages = Boolean(parentChat.include_user_messages);
      request.extractionGroupTurns = Number(parentChat.extraction_group_turns ?? 6);
      request.memoryLanguage = inheritedLanguage;
      prepare(`UPDATE chats SET profile=?,include_user_messages=?,extraction_group_turns=?,memory_language=?,pending_memory_language=NULL,ingestion_state='managed',static_hash=?,static_json=?,updated_at=? WHERE id=?`).run(
        parentChat.profile, parentChat.include_user_messages, parentChat.extraction_group_turns, inheritedLanguage, parentChat.static_hash, parentChat.static_json, now, child,
      );
    }

    if (options.preserveChildConfiguration && ordinalOffset > 0) {
      prepare("UPDATE messages SET ordinal=ordinal+?,updated_at=? WHERE chat_id=?").run(ordinalOffset, now, child);
    }

    const childProjection = new Map(sourcePairs.map(pair => [pair.parent.message_id, pair.child]));
    const parentMessages = prepare("SELECT * FROM messages WHERE chat_id=? AND ordinal<=? AND lifecycle IN ('committed','client_pruned','pending') ORDER BY ordinal").all(parent, fork) as any[];
    const addMessage = prepare(`INSERT OR IGNORE INTO messages(chat_id,message_id,role,ordinal,content,content_hash,canonical_content,canonical_hash,lifecycle,visible,event_time,generation_id,source_kind,source_record_id,display_content_hash,display_comparison_hash,host_visibility,extraction_state,completed_turn_seq,memory_excluded,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const updateMessage = prepare("UPDATE messages SET role=?,ordinal=?,content=?,content_hash=?,canonical_content=?,canonical_hash=?,lifecycle=?,visible=?,event_time=?,generation_id=?,source_kind=?,source_record_id=?,display_content_hash=?,display_comparison_hash=?,host_visibility=?,extraction_state=?,completed_turn_seq=?,memory_excluded=?,updated_at=? WHERE chat_id=? AND message_id=?");
    for (const row of parentMessages) {
      const visible = childProjection.get(row.message_id);
      if (!visible && row.lifecycle === "pending") continue;
      const lifecycle = visible ? row.lifecycle : "client_pruned";
      const hostVisibility = visible?.visibility ?? "active";
      const archiveEligible = hostVisibility === "active" || hostVisibility === "all_before";
      const memoryExcluded = isOrdinalFallbackMessageId(parent,row.message_id)
        || isOrdinalFallbackMessageId(child,visible?.id ?? row.message_id) ? 0 : row.memory_excluded;
      const extractionState = !archiveEligible
        ? "blocked"
        : ["done", "encapsulated", "skipped_policy", "excluded_episode", "cancelled"].includes(row.extraction_state)
          ? row.extraction_state
          : "pending";
      const inserted = addMessage.run(child, row.message_id, row.role, row.ordinal, row.content, row.content_hash, row.canonical_content, row.canonical_hash, lifecycle, archiveEligible ? 1 : 0, row.event_time, row.generation_id, row.source_kind, row.source_record_id, row.display_content_hash, row.display_comparison_hash, hostVisibility, extractionState, row.completed_turn_seq, memoryExcluded, now).changes;
      // A raw-only target shell may already own this source. Fresh inserts
      // already contain the complete inherited row and need no second write.
      if (!inserted) updateMessage.run(
        row.role, row.ordinal, row.content, row.content_hash, row.canonical_content, row.canonical_hash, lifecycle, archiveEligible ? 1 : 0, row.event_time, row.generation_id, row.source_kind, row.source_record_id, row.display_content_hash, row.display_comparison_hash, hostVisibility, extractionState, row.completed_turn_seq, memoryExcluded, now, child, row.message_id,
      );
      if (extractionState === "pending") pendingReextractionIds.add(row.message_id);
      if (extractionState === 'pending' && !memoryExcluded) prepare(`INSERT OR IGNORE INTO gap_recovery_messages(chat_id,message_id)
        SELECT ?,? FROM gap_recovery_messages WHERE chat_id=? AND message_id=?`).run(child,row.message_id,parent,row.message_id);
      prepare("INSERT INTO message_revisions(id,chat_id,message_id,content,content_hash,canonical_content,canonical_hash,lifecycle,created_at,purge_after) VALUES(?,?,?,?,?,?,?,?,?,NULL)").run(randomUUID(), child, row.message_id, row.content, row.content_hash, row.canonical_content, row.canonical_hash, lifecycle, now);
      mapItem("message", row.message_id, row.message_id);
    }
    counts.messages = parentMessages.length;
    prepare(`UPDATE chats SET completed_turn_count=COALESCE((SELECT MAX(completed_turn_seq) FROM messages WHERE chat_id=?),0) WHERE id=?`).run(child, child);

    const entityMap = new Map<string, string>();
    for (const row of prepare("SELECT * FROM entities WHERE chat_id=?").all(parent) as any[]) {
      const id = randomUUID(); entityMap.set(row.id, id);
      prepare(`INSERT INTO entities(id,chat_id,entity_key,name,display_name,type,origin,setup_prominence,source_json,user_managed,color,birthday_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, child, row.entity_key, row.name, row.display_name ?? row.name, row.type, row.origin ?? "transcript", row.setup_prominence ?? "supporting", row.source_json ?? "[]", row.user_managed ?? 0, row.color ?? null, row.birthday_json ?? null, now);
      for (const alias of prepare("SELECT alias,normalized FROM aliases WHERE entity_id=?").all(row.id) as any[]) prepare("INSERT INTO aliases(entity_id,alias,normalized) VALUES(?,?,?)").run(id, alias.alias, alias.normalized);
      mapItem("entity", id, row.id);
    }
    counts.entities = entityMap.size;
    const parentPersona = readViewPreferences(db,parent).personaEntity;
    if (parentPersona && !readViewPreferences(db,child).personaEntity) {
      writeViewPreferences(db,child,{personaEntity:entityMap.get(parentPersona) ?? parentPersona});
    }
    const personaName = readPersonaName(db,parent);
    if (personaName) prepare(`INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value
      WHERE server_meta.value='null'`).run(personaHintKey(child),JSON.stringify(personaName));
    // Branches and regeneration shadows get new UUIDs; preserve the user's
    // alias suppressions under those UUIDs before any extraction can run.
    const removals = Object.fromEntries(Object.entries(readRemovedAliases(db, parent))
      .flatMap(([id, terms]) => entityMap.has(id) ? [[entityMap.get(id)!, terms]] : []));
    if (Object.keys(removals).length) prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(removedAliasesKey(child), JSON.stringify(removals));
    const parentCalibration = prepare("SELECT * FROM initial_calibrations WHERE chat_id=?").get(parent) as any;
    prepare(`INSERT OR REPLACE INTO initial_calibrations(chat_id,status,origin,setup_fingerprint,confirmation_required,locked_at,confirmed_at,last_error,setup_json,pending_force_backfill,pending_extraction_review,created_at,updated_at)
      VALUES(?,'inherited','inherited',?,0,?,?,NULL,NULL,0,NULL,?,?)`).run(child, parentCalibration?.setup_fingerprint ?? null, parentCalibration?.locked_at ?? null, parentCalibration?.confirmed_at ?? null, now, now);
    for (const row of prepare("SELECT * FROM entity_scene_presence WHERE chat_id=?").all(parent) as any[]) {
      const job = prepare("SELECT payload_json FROM jobs WHERE id=? AND chat_id=?").get(row.scene_key, parent) as { payload_json: string } | undefined;
      if (job) {
        const ids = json<{ sourceMessageIds?: string[] }>(job.payload_json, {}).sourceMessageIds ?? [];
        const afterFork = ids.some((id) => Number((prepare("SELECT ordinal FROM messages WHERE chat_id=? AND message_id=?").get(parent, id) as { ordinal?: number } | undefined)?.ordinal ?? Number.MAX_SAFE_INTEGER) > fork);
        if (afterFork) continue;
      }
      prepare("INSERT OR IGNORE INTO entity_scene_presence(chat_id,entity_name,scene_key,created_at) VALUES(?,?,?,?)").run(child, row.entity_name, `lineage:${row.scene_key}`, row.created_at);
    }
    const durableByEntity = new Map((prepare("SELECT entity_name,durable_links,pinned FROM entity_prominence WHERE chat_id=?").all(parent) as Array<{ entity_name: string; durable_links: number; pinned: number }>).map((row) => [row.entity_name.trim().toLocaleLowerCase(), row]));
    for (const entity of prepare("SELECT name FROM entities WHERE chat_id=?").all(child) as Array<{ name: string }>) {
      const sceneCount = (prepare("SELECT COUNT(*) count FROM entity_scene_presence WHERE chat_id=? AND entity_name=? COLLATE NOCASE").get(child, entity.name) as { count: number }).count;
      const parentState = durableByEntity.get(entity.name.trim().toLocaleLowerCase());
      const durableLinks = Math.min(sceneCount, Number(parentState?.durable_links ?? 0));
      const pinned = Number(parentState?.pinned ?? 0);
      const tier = pinned || (sceneCount >= 4 && durableLinks > 0) ? "core" : sceneCount >= 2 || durableLinks > 0 ? "recurring" : "incidental";
      prepare("INSERT INTO entity_prominence(chat_id,entity_name,tier,scene_count,durable_links,pinned,updated_at) VALUES(?,?,?,?,?,?,?)").run(child, entity.name, tier, sceneCount, durableLinks, pinned, now);
    }

    const boundaryMessageIds = new Set<string>();
    const eligibleMemory = (row: any): boolean => {
      if (options.preserveUserCorrections && (row.user_edited || row.user_hidden || prepare(`SELECT 1 FROM memories WHERE id=? AND (${memoryHasLineCorrectionSql()})`).get(row.id))) return true;
      const ids = json<Array<{ messageId?: string }>>(row.evidence_json, []).map((item) => item.messageId).filter((id): id is string => Boolean(id));
      if (!ids.length) return row.created_revision <= parentChat.revision;
      const located = ids.map((id) => ({ id, ordinal: sourceOrdinals.get(id)?.ordinal })).filter((item): item is { id: string; ordinal: number } => item.ordinal !== undefined);
      const ordinals = located.map((item) => item.ordinal);
      if (ordinals.some((ordinal) => ordinal <= fork) && ordinals.some((ordinal) => ordinal > fork)) for (const item of located) if (item.ordinal <= fork) boundaryMessageIds.add(item.id);
      return ordinals.length === ids.length && ordinals.every((ordinal) => ordinal <= fork);
    };
    for (const row of (prepare("SELECT * FROM memories WHERE chat_id=?").all(parent) as any[]).filter(eligibleMemory)) {
      const id = randomUUID(); memoryMap.set(row.id, id);
      prepare(`INSERT INTO memories(id,chat_id,memory_key,type,title,content,participants_json,known_by_json,perspective,story_time,story_time_normalized,locations_json,landmark,landmark_kinds_json,evidence_json,salience,strength,recall_count,last_recalled_revision,pinned,active,capsule_parent_id,retention_class,atom_access_version,created_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, child, row.memory_key, row.type, row.title, row.content, row.participants_json, row.known_by_json, row.perspective, row.story_time, row.story_time_normalized ?? normalizeStoryTime(row.story_time) ?? null, row.locations_json, row.landmark, row.landmark_kinds_json ?? "[]", row.evidence_json, row.salience, row.strength, row.recall_count, row.last_recalled_revision, row.pinned, row.active, null, row.retention_class, row.atom_access_version ?? 0, row.created_revision, now, now,
      );
      prepare("UPDATE memories SET user_managed=? WHERE id=?").run(row.user_managed,id);
      prepare('UPDATE memories SET always_inject=? WHERE id=?').run(row.always_inject ?? 0,id);
      for (const dialogue of prepare("SELECT * FROM memory_dialogues WHERE memory_id=?").all(row.id) as any[]) {
        const sourceOrdinal = sourceOrdinals.get(dialogue.message_id)?.ordinal;
        if (sourceOrdinal === undefined || sourceOrdinal > fork) {
          continue;
        }
        const dialogueId = randomUUID(); dialogueMap.set(dialogue.id, dialogueId);
        const dialogueEvidence = json<Array<{messageId:string;canonicalHash:string;startOffset:number;endOffset:number;quote:string}>>(dialogue.evidence_json, [])
          .map(evidence => ({...evidence,messageId:messageMap.get(evidence.messageId) ?? evidence.messageId}));
        const childMessageId = messageMap.get(dialogue.message_id) ?? dialogue.message_id;
        prepare("INSERT INTO memory_dialogues(id,chat_id,memory_id,speaker,text,message_id,evidence_json,kind,ordinal,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(dialogueId, child, id, dialogue.speaker, dialogue.text, childMessageId, JSON.stringify(dialogueEvidence), dialogue.kind, dialogue.ordinal, now);
        mapItem("dialogue", dialogueId, dialogue.id);
      }
      for (const detail of prepare("SELECT * FROM memory_details WHERE chat_id=? AND memory_id=? AND (active=1 OR ?=1 AND (detail_key='recognition' OR detail_key LIKE 'recognition:%')) ORDER BY rowid").all(parent,row.id,row.user_managed) as any[]) {
        if (!eligibleMemory(detail)) continue;
        const detailId = randomUUID(); detailMap.set(detail.id, detailId);
        const seed = detail.seed_json ? JSON.parse(detail.seed_json) : null;
        if (seed?.closureEvidence?.some((e:{messageId:string}) => {
          const source=sourceOrdinals.get(e.messageId);
          return !source || source.ordinal > fork;
        })) { seed.status="open"; delete seed.closureEvidence; }
        if (seed?.closureEvidence) seed.closureEvidence=seed.closureEvidence.map((e:{messageId:string})=>({...e,messageId:messageMap.get(e.messageId)??e.messageId}));
        prepare(`INSERT INTO memory_details(id,chat_id,memory_id,detail_key,kind,text,participants_json,known_by_json,locations_json,epistemic,salience,retention_class,evidence_json,source_start_ordinal,source_end_ordinal,active,created_revision,created_at,updated_at,role,original_kind,seed_json)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(detailId, child, id, detail.detail_key, detail.kind, detail.text, detail.participants_json, detail.known_by_json, detail.locations_json, detail.epistemic, detail.salience, detail.retention_class, detail.evidence_json, detail.source_start_ordinal, detail.source_end_ordinal, detail.active, detail.created_revision, now, now, detail.role, detail.original_kind, seed ? JSON.stringify(seed) : null);
        prepare("UPDATE memory_details SET user_edited=?,user_hidden=?,original_text=? WHERE id=?").run(detail.user_edited,detail.user_hidden,detail.original_text,detailId);
        if (!detail.user_hidden) prepare("INSERT INTO memory_detail_fts(detail_id,chat_id,memory_id,text,participants,locations) VALUES(?,?,?,?,?,?)").run(detailId, child, id,
          augmentSearchText(detail.text, inheritedLanguage), augmentSearchText(detail.participants_json, inheritedLanguage), augmentSearchText(detail.locations_json, inheritedLanguage));
        mapItem("memory_detail", detailId, detail.id);
      }
      mapItem("memory", id, row.id);
    }
    counts.memories = memoryMap.size;
    if (boundaryMessageIds.size) {
      const ids = [...boundaryMessageIds];
      prepare(`UPDATE messages SET extraction_state='pending' WHERE chat_id=? AND message_id IN (${ids.map(() => "?").join(",")}) AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`).run(child, ...ids);
      for (const id of ids) pendingReextractionIds.add(id);
      counts.boundaryMessages = ids.length;
    }
    for (const [oldId, newId] of memoryMap) {
      const parentCapsule = (prepare("SELECT capsule_parent_id FROM memories WHERE id=?").get(oldId) as { capsule_parent_id: string | null }).capsule_parent_id;
      if (parentCapsule && memoryMap.has(parentCapsule)) prepare("UPDATE memories SET capsule_parent_id=? WHERE id=?").run(memoryMap.get(parentCapsule), newId);
    }
    for (const row of prepare("SELECT * FROM memory_edges WHERE chat_id=?").all(parent) as any[]) {
      const source = memoryMap.get(row.source_id); const target = memoryMap.get(row.target_id);
      if (source && target) prepare("INSERT INTO memory_edges(chat_id,source_id,target_id,weight,kind,reinforced_at) VALUES(?,?,?,?,?,?)").run(child, source, target, row.weight, row.kind, row.reinforced_at);
    }
    for (const row of (prepare("SELECT * FROM atom_relations WHERE chat_id=? AND active=1").all(parent) as any[]).filter(eligibleMemory)) {
      const sourceDetailId = detailMap.get(row.source_detail_id);
      const targetDetailId = detailMap.get(row.target_detail_id);
      if (!sourceDetailId || !targetDetailId) continue;
      const id = randomUUID();
      atomRelationMap.set(row.id, id);
      atomRelationSourceBatches.set(row.id, row.source_batch_id ?? null);
      prepare(`INSERT INTO atom_relations(id,chat_id,source_detail_id,target_detail_id,kind,confidence,evidence_json,
        source_batch_id,source_start_ordinal,source_end_ordinal,created_revision,active,created_at)
        VALUES(?,?,?,?,?,?,?,NULL,?,?,?,1,?)`).run(id, child, sourceDetailId, targetDetailId, row.kind, row.confidence,
        row.evidence_json, row.source_start_ordinal, row.source_end_ordinal, row.created_revision, row.created_at);
      mapItem("atom_relation", id, row.id);
      counts.atomRelations = (counts.atomRelations ?? 0) + 1;
    }
    for (const row of prepare("SELECT * FROM evidence_spans WHERE chat_id=?").all(parent) as any[]) {
      const memoryId = row.memory_id ? memoryMap.get(row.memory_id) : undefined;
      const ordinal = sourceOrdinals.get(row.message_id)?.ordinal;
      if (ordinal === undefined || ordinal > fork || row.memory_id && !memoryId) continue;
      prepare("INSERT INTO evidence_spans(id,chat_id,memory_id,message_id,quote,created_at) VALUES(?,?,?,?,?,?)").run(randomUUID(), child, memoryId ?? null, row.message_id, row.quote, now);
    }
    for (const row of prepare("SELECT * FROM memory_recall_events WHERE chat_id=? ORDER BY created_at").all(parent) as any[]) {
      const memoryId = memoryMap.get(row.memory_id);
      if (!memoryId) continue;
      const evidence = json<string[]>(row.evidence_json, []);
      if (!evidence.length || evidence.some((messageId) => {
        const message = sourceOrdinals.get(messageId);
        return !message || message.ordinal > fork;
      })) continue;
      const id = randomUUID();
      prepare(`INSERT INTO memory_recall_events(id,chat_id,memory_id,holder,action,confidence,evidence_json,source_batch_id,created_revision,created_at,completed_turn_seq)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, child, memoryId, row.holder, row.action, row.confidence, row.evidence_json,
        row.source_batch_id ? `lineage:${row.source_batch_id}` : null, row.created_revision, row.created_at, row.completed_turn_seq);
      mapItem("memory_recall_event", id, row.id);
      counts.memoryRecallEvents = (counts.memoryRecallEvents ?? 0) + 1;
    }

    for (const passage of prepare(`SELECT p.* FROM source_passages p JOIN messages m ON m.chat_id=? AND m.message_id=p.message_id
      AND m.canonical_hash=p.canonical_hash WHERE p.chat_id=? AND p.active=1 AND m.ordinal<=?`).all(child, parent, fork) as any[]) {
      const access = json<Array<{evidence: Array<{messageId:string}>}>>(passage.access_json,[]).filter(grant =>
        grant.evidence?.length && grant.evidence.every(evidence => Boolean(prepare(`SELECT 1 FROM messages
          WHERE chat_id=? AND message_id=? AND ordinal<=? AND lifecycle IN ('committed','client_pruned')
            AND host_visibility IN ('active','all_before')`).get(child,evidence.messageId,fork))));
      prepare(`INSERT INTO source_passages(id,chat_id,message_id,canonical_hash,start_offset,end_offset,quote,speaker,epistemic,access_json,source_batch_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), child, passage.message_id, passage.canonical_hash, passage.start_offset, passage.end_offset,
          passage.quote, passage.speaker, passage.epistemic, JSON.stringify(access), passage.source_batch_id ? `lineage:${passage.source_batch_id}` : null);
    }

    // Reuse persisted vectors. This is a local row copy and never calls Voyage.
    const parentEmbeddings = prepare("SELECT * FROM embedding_items WHERE chat_id=? ORDER BY rowid").all(parent) as any[];
    const embeddingsBySource = new Map(parentEmbeddings.map(item => [`${item.kind}:${item.source_id}`, item]));
    const embeddingsByItem = new Map(parentEmbeddings.map(item => [item.item_id, item]));
    const embeddingsByBlock = new Map<string, any[]>();
    for (const item of parentEmbeddings) if (item.kind === "transcript_chunk") {
      const items = embeddingsByBlock.get(item.block_id) ?? [];
      items.push(item); embeddingsByBlock.set(item.block_id, items);
    }

    let nextVectorRow = Number((prepare("SELECT COALESCE(MAX(rowid),0)+1 AS id FROM embedding_items").get() as { id: number }).id);
    const vectorCopies: Array<{ oldRow: number; newRow: number; itemId: string; sourceId: string; blockId: string | null; sourceJson: string }> = [];
    const copyVector = (sourceRowId: number, _item: any, itemId: string, sourceId: string, blockId: string | null, sourceJson: string): void => {
      vectorCopies.push({ oldRow: sourceRowId, newRow: nextVectorRow++, itemId, sourceId, blockId, sourceJson });
    };
    for (const [oldId, newId] of memoryMap) {
      const item = embeddingsBySource.get(`memory:${oldId}`);
      if (item) copyVector(item.rowid, item, `memory:${newId}`, newId, null, remapJson(item.source_json, memoryMap));
    }
    for (const [oldId, newId] of detailMap) {
      const item = embeddingsBySource.get(`memory_detail:${oldId}`);
      if (item) copyVector(item.rowid, item, `detail:${newId}`, newId, null, remapJson(item.source_json, memoryMap));
    }
    const blockMap = new Map<string, string>();
    for (const block of prepare("SELECT * FROM embedding_blocks WHERE chat_id=? AND end_ordinal<=? AND status='indexed'").all(parent, fork) as any[]) {
      const id = randomUUID(); blockMap.set(block.id, id);
      prepare(`INSERT INTO embedding_blocks(id,chat_id,content_hash,message_ids_json,start_ordinal,end_ordinal,status,model,chunk_count,attempts,last_error,created_at,updated_at) VALUES(?,?,?,?,?,?,'indexed',?,?,?,?,?,?)`).run(id, child, block.content_hash, block.message_ids_json, block.start_ordinal, block.end_ordinal, block.model, block.chunk_count, block.attempts, null, now, now);
      for (const [index, item] of (embeddingsByBlock.get(block.id) ?? []).entries()) copyVector(item.rowid, item, `transcript:${id}:${index}`, id, id, item.source_json);
      mapItem("embedding_block", id, block.id);
    }

    for (const row of prepare(`SELECT * FROM assertions WHERE chat_id=? AND (
      COALESCE(valid_from_ordinal,?)<=? AND (valid_to_ordinal IS NULL OR valid_to_ordinal>=? OR user_edit_ordinal IS NOT NULL OR automatic_closure_evidence_json IS NOT NULL)
      OR ? AND (user_edit_ordinal IS NOT NULL OR auto_locked=1))`).all(parent, fork, fork, fork, Number(options.preserveUserCorrections)) as any[]) {
      const relation = parseSocialRelation(row.social_relation_json);
      if (relation && !relation.manual && relation.detailIds.some(id => !detailMap.has(id))) continue;
      const inheritedRelation = relation ? JSON.stringify({ ...relation, detailIds: relation.detailIds.map(id => detailMap.get(id)!) }) : null;
      const id = randomUUID();
      assertionMap.set(row.id, id);
      prepare(`INSERT INTO assertions(id,chat_id,subject,predicate,value,state_kind,confidence,valid_from_revision,valid_to_revision,valid_from_ordinal,valid_to_ordinal,source_memory_id,evidence_json,retention_class,created_at,social_relation_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, child, row.subject, row.predicate, row.value, relation ? "condition" : row.state_kind, row.confidence, row.valid_from_revision, null, row.valid_from_ordinal, null, memoryMap.get(row.source_memory_id) ?? null, row.evidence_json, row.retention_class, now, inheritedRelation);
      mapItem("assertion", id, row.id); counts.assertions = (counts.assertions ?? 0) + 1;
      prepare("UPDATE assertions SET user_edit_ordinal=?,auto_locked=?,source_batch_id=? WHERE id=?").run(row.user_edit_ordinal,row.auto_locked,row.source_batch_id ? `lineage:${row.source_batch_id}` : null,id);
      const preserveEnd=options.preserveUserCorrections && row.user_edit_ordinal!=null
        ? !dropsAutomaticClosure(row) : row.valid_to_ordinal==null || row.valid_to_ordinal<fork;
      if(row.valid_to_revision!=null && preserveEnd) prepare("UPDATE assertions SET valid_to_revision=?,valid_to_ordinal=?,automatic_closure_evidence_json=? WHERE id=?").run(row.valid_to_revision,row.valid_to_ordinal,row.automatic_closure_evidence_json,id);
    }
    for (const row of prepare(`SELECT * FROM beliefs WHERE chat_id=? AND (
      (active=1 OR valid_to_ordinal IS NOT NULL) AND COALESCE(valid_from_ordinal,?)<=? AND (valid_to_ordinal IS NULL OR valid_to_ordinal>=? OR user_edit_ordinal IS NOT NULL)
      OR ? AND (user_edit_ordinal IS NOT NULL OR auto_locked=1))`).all(parent, fork, fork, fork, Number(options.preserveUserCorrections)) as any[]) {
      const id = randomUUID();
      prepare(`INSERT INTO beliefs(id,chat_id,holder,subject,predicate,value,polarity,confidence,source,evidence_json,active,retention_class,created_revision,valid_from_ordinal,valid_to_ordinal,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?)`).run(id, child, row.holder, row.subject, row.predicate, row.value, row.polarity, row.confidence, memoryMap.get(row.source) ?? row.source, row.evidence_json, 1, row.retention_class, row.created_revision, row.valid_from_ordinal, now);
      beliefMap.set(row.id,id);
      const restoreDispute=row.status==='disputed' && row.user_edit_ordinal!=null && dropsAutomaticClosure(row);
      const previousStatus=json<Array<{previousStatus?:string}>>(row.automatic_closure_evidence_json,[])[0]?.previousStatus;
      const restoreAtFork=restoreDispute || row.status==='superseded' && (options.preserveUserCorrections && row.user_edit_ordinal!=null
        ? dropsAutomaticClosure(row) : row.valid_to_ordinal != null && row.valid_to_ordinal>=fork);
      prepare("UPDATE beliefs SET status=?,active=?,user_edit_ordinal=?,auto_locked=?,source_batch_id=?,superseded_by=?,valid_to_ordinal=? WHERE id=?")
        .run(restoreAtFork?previousStatus ?? 'active':row.status,restoreAtFork?1:row.active,row.user_edit_ordinal,row.auto_locked,row.source_batch_id ? `lineage:${row.source_batch_id}` : null,restoreAtFork?null:row.superseded_by,restoreAtFork?null:row.valid_to_ordinal,id);
      mapItem("belief", id, row.id); counts.beliefs = (counts.beliefs ?? 0) + 1;
      if(!restoreAtFork) prepare("UPDATE beliefs SET automatic_closure_evidence_json=? WHERE id=?").run(row.automatic_closure_evidence_json,id);
    }
    for (const row of prepare("SELECT * FROM beliefs WHERE chat_id=? AND active=0 AND source LIKE 'user_deleted:%' AND COALESCE(valid_to_ordinal,?)<=?").all(parent, fork, fork) as any[]) {
      const id = randomUUID();
      prepare(`INSERT INTO beliefs(id,chat_id,holder,subject,predicate,value,polarity,confidence,source,evidence_json,active,retention_class,created_revision,valid_from_ordinal,valid_to_ordinal,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, child, row.holder, row.subject, row.predicate, row.value, row.polarity, row.confidence,
        row.source, row.evidence_json, 0, row.retention_class, row.created_revision, row.valid_from_ordinal, row.valid_to_ordinal, now,
      );
      mapItem("belief_tombstone", id, row.id);
      beliefMap.set(row.id,id);
      prepare("UPDATE beliefs SET status=?,user_edit_ordinal=?,auto_locked=?,source_batch_id=?,superseded_by=? WHERE id=?")
        .run(row.status,row.user_edit_ordinal,row.auto_locked,row.source_batch_id ? `lineage:${row.source_batch_id}` : null,row.superseded_by,id);
    }
    for (const row of prepare(`SELECT * FROM social_knowledge_events WHERE chat_id=? AND active=1 AND
      (COALESCE(user_edit_ordinal,source_end_ordinal,?)<=? OR ? AND (user_edit_ordinal IS NOT NULL OR auto_locked=1)) ORDER BY created_revision,created_at`).all(parent, fork, fork, Number(options.preserveUserCorrections)) as any[]) {
      const id = randomUUID();
      prepare(`INSERT INTO social_knowledge_events(id,chat_id,holder,subject,action,level,known_as_json,address_terms_json,evidence_json,source_memory_id,source_start_ordinal,source_end_ordinal,manual,active,created_revision,created_at,cognition_detail_ids_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, child, row.holder, row.subject, row.action, row.level, row.known_as_json, row.address_terms_json, row.evidence_json,
        memoryMap.get(row.source_memory_id) ?? null, row.source_start_ordinal, row.source_end_ordinal,
        row.manual, row.active, row.created_revision, row.created_at,
        JSON.stringify((JSON.parse(row.cognition_detail_ids_json) as string[]).flatMap(id => detailMap.has(id) ? [detailMap.get(id)!] : [])),
      );
      mapItem("social_knowledge", id, row.id); counts.socialKnowledge = (counts.socialKnowledge ?? 0) + 1;
      prepare("UPDATE social_knowledge_events SET user_edit_ordinal=?,auto_locked=?,source_batch_id=? WHERE id=?").run(row.user_edit_ordinal,row.auto_locked,row.source_batch_id ? `lineage:${row.source_batch_id}` : null,id);
    }
    for (const row of prepare("SELECT * FROM pair_progress WHERE chat_id=?").all(parent) as any[]) {
      const cells=readProgressCells(db,parent,row).map(original=>{
        // Inherited messages retain parent canonical ordinals even when IDs change;
        // applyOrdinalOffset aligns subsequent child snapshots with that same space.
        const cell = original.userNotYetAfterOrdinal === undefined ? original
          : {...original,userNotYetAfterOrdinal:Math.min(original.userNotYetAfterOrdinal,fork)};
        if(cell.source!=="scene")return cell;
        const memoryId=cell.memoryId ? memoryMap.get(cell.memoryId) : undefined;
        return memoryId && cell.messageIds.every(id=>messageMap.has(id))
          ? {...cell,memoryId,messageIds:cell.messageIds.map(id=>messageMap.get(id)!)}
          : resetAutomaticProgressCell(cell);
      });
      prepare(`INSERT INTO pair_progress(id,chat_id,persona,character,item_id,label,mode,hidden,custom,cells_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),child,row.persona,row.character,row.item_id,row.label,row.mode,row.hidden,row.custom,JSON.stringify(cells),row.created_at,now);
    }
    for (const row of prepare("SELECT * FROM relationship_baselines WHERE chat_id=? AND active=1").all(parent) as any[]) {
      const id = randomUUID();
      prepare(`INSERT INTO relationship_baselines(id,chat_id,from_entity,to_entity,qualitative_json,known_axes_json,reason,source,source_quote,
        evidence_json,setup_fingerprint,projection_axes_json,initial_summary,user_managed,active,created_revision,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, child, row.from_entity, row.to_entity, row.qualitative_json ?? "{}", row.known_axes_json,
        row.reason, row.source, row.source_quote, row.evidence_json, row.setup_fingerprint, row.projection_axes_json ?? null, row.initial_summary ?? null,
        row.user_managed ?? 0, row.active, row.created_revision, row.created_at);
      mapItem("relationship_baseline", id, row.id);
    }
    materializeInitialRelationshipProjections(db, child);
    for (const row of prepare("SELECT * FROM physical_intimacy_milestones WHERE chat_id=? AND active=1 AND COALESCE(source_start_ordinal,?)<=? ORDER BY created_at").all(parent, fork, fork) as any[]) {
      const id = randomUUID();
      physicalMilestoneMap.set(row.id, id);
      prepare(`INSERT INTO physical_intimacy_milestones(id,chat_id,participant_a,participant_b,milestone_key,act,custom_label,initiator,interaction_context,circumstance,evidence_json,source_memory_id,source_start_ordinal,auto_inject,manual_override,deleted_by_user,active,created_revision,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, child, row.participant_a, row.participant_b, row.milestone_key, row.act, row.custom_label, row.initiator, row.interaction_context, row.circumstance, row.evidence_json, memoryMap.get(row.source_memory_id) ?? null, row.source_start_ordinal, row.auto_inject ?? 1, row.manual_override ?? 0, row.deleted_by_user ?? 0, row.active, row.created_revision, row.created_at);
      mapItem("physical_intimacy_milestone", id, row.id);
    }
    for (const row of prepare("SELECT * FROM relationship_events WHERE chat_id=? AND active=1 AND (COALESCE(source_end_ordinal,?)<=? OR ? AND (user_edited=1 OR user_hidden=1)) ORDER BY created_at").all(parent, fork, fork,Number(options.preserveUserCorrections)) as any[]) {
      const id = randomUUID();
      relationshipEventMap.set(row.id, id);
      prepare(`INSERT INTO relationship_events(id,chat_id,from_entity,to_entity,changes_json,reason,evidence_json,source_memory_id,source_detail_id,source_job_id,source_start_ordinal,source_end_ordinal,active,created_revision,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, child, row.from_entity, row.to_entity, row.changes_json, row.reason, row.evidence_json, memoryMap.get(row.source_memory_id) ?? null, detailMap.get(row.source_detail_id) ?? null, `lineage:${row.source_job_id ?? row.id}`, row.source_start_ordinal, row.source_end_ordinal, row.active, row.created_revision, row.created_at);
      prepare("UPDATE relationship_events SET user_edited=?,user_hidden=?,original_text=? WHERE id=?").run(row.user_edited,row.user_hidden,row.original_text,id);
      mapItem("relationship_event", id, row.id); counts.relationshipEvents = (counts.relationshipEvents ?? 0) + 1;
    }
    const reusableRelationshipPairs = new Set<string>();
    for (const projection of prepare("SELECT * FROM relationship_projections WHERE chat_id=? AND (stale=0 OR user_edit_ordinal IS NOT NULL)").all(parent) as any[]) {
      const events = prepare(`SELECT id,created_revision FROM relationship_events WHERE chat_id=? AND from_entity=? AND to_entity=? AND active=1
        AND COALESCE(source_end_ordinal,?)<=? ORDER BY created_revision,created_at,id`).all(parent, projection.from_entity, projection.to_entity, fork, fork) as Array<{ id: string; created_revision: number }>;
      const cursor = json<{ revision: number; eventIds: string[] }>(projection.event_cursor_json, { revision: -1, eventIds: [] });
      const cursorIds = new Set(cursor.eventIds);
      const latestAtCursor = events.filter((event) => event.created_revision === cursor.revision).map((event) => event.id);
      const complete = events.every((event) => event.created_revision < cursor.revision || event.created_revision === cursor.revision && cursorIds.has(event.id))
        && latestAtCursor.length === cursorIds.size && latestAtCursor.every((id) => cursorIds.has(id))
        && cursor.eventIds.every((id) => relationshipEventMap.has(id));
      const basis = json<string[]>(projection.basis_event_ids_json, []);
      const reusable=complete && basis.every(id=>relationshipEventMap.has(id));
      if (!reusable && projection.user_edit_ordinal == null) continue;
      const baseline=json<any>(projection.overrides_json,{});
      const mappedCursor = { ...cursor, eventIds: cursor.eventIds.flatMap((id) => relationshipEventMap.has(id)?[relationshipEventMap.get(id)!]:[]) };
      const mappedBasis = basis.flatMap((id) => relationshipEventMap.has(id)?[relationshipEventMap.get(id)!]:[]);
      prepare(`INSERT INTO relationship_projections(chat_id,from_entity,to_entity,axes_json,summary,active_tensions_json,basis_event_ids_json,
        overrides_json,event_cursor_json,projection_origin,stale,updated_revision,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)
        ON CONFLICT(chat_id,from_entity,to_entity) DO UPDATE SET axes_json=excluded.axes_json,summary=excluded.summary,
          active_tensions_json=excluded.active_tensions_json,basis_event_ids_json=excluded.basis_event_ids_json,
          overrides_json=excluded.overrides_json,event_cursor_json=excluded.event_cursor_json,projection_origin=excluded.projection_origin,
          stale=0,updated_revision=excluded.updated_revision,updated_at=excluded.updated_at`)
        .run(child, projection.from_entity, projection.to_entity, reusable?projection.axes_json:JSON.stringify(baseline.axes ?? json(projection.axes_json,{})), reusable?projection.summary:baseline.summary ?? projection.summary, reusable?projection.active_tensions_json:JSON.stringify(baseline.activeTensions ?? []),
          JSON.stringify(mappedBasis), projection.overrides_json, JSON.stringify(mappedCursor), projection.projection_origin,
          projection.updated_revision, projection.updated_at);
      prepare("UPDATE relationship_projections SET user_edit_ordinal=?,auto_locked=? WHERE chat_id=? AND from_entity=? AND to_entity=?")
        .run(projection.user_edit_ordinal,projection.auto_locked,child,projection.from_entity,projection.to_entity);
      reusableRelationshipPairs.add(`${projection.from_entity}\0${projection.to_entity}`);
    }
    const promiseEvents = prepare(`SELECT * FROM promise_events WHERE chat_id=? AND active=1 AND
      (source_ordinal<=? OR ? AND user_authored=1 AND promise_id IN (SELECT id FROM promises WHERE user_edit_ordinal IS NOT NULL OR auto_locked=1))
      ORDER BY created_revision,created_at,rowid`).all(parent, fork, Number(options.preserveUserCorrections ?? false)) as any[];
    const childTurn = (prepare("SELECT completed_turn_count FROM chats WHERE id=?").get(child) as { completed_turn_count: number }).completed_turn_count;
    const inheritedRecency = (event: any) => event.ended_at_turn != null && event.ended_at_turn <= childTurn
      ? [event.ended_at_turn, event.recency_until_turn] : [null, null];
    const latestPromises = new Map<string, any>();
    for (const event of promiseEvents) latestPromises.set(event.promise_key, event);
    for (const event of latestPromises.values()) {
      const id = randomUUID();
      promiseMap.set(event.promise_id, id);
      prepare("INSERT INTO promises(id,chat_id,promise_key,promisor,promisee,content,status,scheduled_for,status_reason,source_memory_id,source_batch_id,retention_scope,updated_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, child, event.promise_key, event.promisor, event.promisee, event.content, event.status, event.scheduled_for ?? null, event.status_reason ?? null, memoryMap.get(event.source_memory_id) ?? null, event.source_batch_id ? `lineage:${event.source_batch_id}` : null, "future", event.created_revision, now);
      for (const source of promiseEvents.filter((item) => item.promise_key === event.promise_key)) {
        const eventId = randomUUID();
        prepare("INSERT INTO promise_events(id,chat_id,promise_id,promise_key,promisor,promisee,content,status,scheduled_for,status_reason,source_memory_id,source_batch_id,source_ordinal,created_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(eventId, child, id, source.promise_key, source.promisor, source.promisee, source.content, source.status, source.scheduled_for ?? null, source.status_reason ?? null, memoryMap.get(source.source_memory_id) ?? null, source.source_batch_id ? `lineage:${source.source_batch_id}` : null, source.source_ordinal, source.created_revision, source.created_at);
        mapItem("promise_event", eventId, source.id);
        prepare("UPDATE promise_events SET evidence_json=?,user_authored=?,ended_at_turn=?,recency_until_turn=? WHERE id=?").run(source.evidence_json,source.user_authored,...inheritedRecency(source),eventId);
      }
      mapItem("promise", id, event.promise_id); counts.promises = (counts.promises ?? 0) + 1;
      const original=prepare("SELECT user_edit_ordinal,auto_locked,pinned FROM promises WHERE id=? AND chat_id=?").get(event.promise_id,parent) as any;
      if(original) prepare("UPDATE promises SET user_edit_ordinal=?,auto_locked=?,pinned=?,ended_at_turn=?,recency_until_turn=? WHERE id=?").run(original.user_edit_ordinal,original.auto_locked,original.pinned,...inheritedRecency(event),id);
    }

    const accessMaps = new Map<string, Map<string, string>>([
      ["detail", detailMap], ["dialogue", dialogueMap], ["promise", promiseMap], ["physical_milestone", physicalMilestoneMap],
      ["atom_relation", atomRelationMap], ["assertion", assertionMap],
    ]);
    const insertAccess = prepare(`INSERT INTO item_access(id,chat_id,item_kind,item_id,holder,basis,evidence_json,confidence,active,source_revision,created_at)
      VALUES(?,?,?,?,?,?,?,?,1,?,?)`);
    const itemEvidenceIds = (itemKind: string, itemId: string): string[] => {
      if (itemKind === "dialogue") {
        const row = prepare("SELECT evidence_json FROM memory_dialogues WHERE id=?").get(itemId) as { evidence_json: string } | undefined;
        return row ? json<Array<{messageId:string}>>(row.evidence_json, []).map(item => item.messageId) : [];
      }
      const table = itemKind === "detail" ? "memory_details" : itemKind === "physical_milestone" ? "physical_intimacy_milestones"
        : itemKind === "atom_relation" ? "atom_relations" : itemKind === "assertion" ? "assertions" : null;
      if (table) {
        const row = prepare(`SELECT evidence_json FROM ${table} WHERE id=?`).get(itemId) as { evidence_json: string } | undefined;
        return json<Array<{ messageId?: string }>>(row?.evidence_json, []).map((item) => item.messageId).filter(Boolean) as string[];
      }
      const row = prepare("SELECT m.evidence_json FROM promises p LEFT JOIN memories m ON m.id=p.source_memory_id WHERE p.id=?")
        .get(itemId) as { evidence_json: string | null } | undefined;
      return json<Array<{ messageId?: string }>>(row?.evidence_json, []).map((item) => item.messageId).filter(Boolean) as string[];
    };
    for (const [itemKind, idMap] of accessMaps) for (const [parentId, childId] of idMap) {
      const rows = prepare("SELECT * FROM item_access WHERE chat_id=? AND item_kind=? AND item_id=?").all(parent, itemKind, parentId) as any[];
      if (!rows.length) continue;
      let ambiguous = rows.some((access) => access.active !== 1);
      const safe: any[] = [];
      for (const access of rows.filter((entry) => entry.active === 1)) {
        if (access.holder === "__narrator_archive__") { safe.push(access); continue; }
        // Assertion grants with no source evidence are explicit user-authored
        // access, so lineage preserves them with the manual assertion.
        if (itemKind === "assertion") { safe.push(access); continue; }
        if (itemKind === "promise" && options.preserveUserCorrections && prepare("SELECT 1 FROM promises WHERE id=? AND user_edit_ordinal IS NOT NULL").get(parentId)) { safe.push(access); continue; }
        if (itemKind === "detail" && options.preserveUserCorrections && prepare("SELECT 1 FROM memory_details WHERE id=? AND (user_edited=1 OR user_hidden=1)").get(parentId)) {safe.push(access);continue;}
        if (itemKind === "detail" && prepare(`SELECT 1 FROM memory_details d JOIN memories m ON m.id=d.memory_id
          WHERE d.chat_id=? AND d.id=? AND m.user_managed=1`).get(parent,parentId)) { safe.push(access); continue; }
        // Initial recognition is grounded in setup, not a transcript message.
        // Preserve its seeded holder or explicit public scope on this exact atom.
        if (itemKind === "detail" && prepare(`SELECT 1 FROM memories m JOIN memory_details d ON d.memory_id=m.id
          JOIN social_knowledge_events s ON s.source_memory_id=m.id
          WHERE m.chat_id=? AND d.id=? AND is_initial_calibration_memory(m.memory_key) AND s.active=1
          AND (s.holder=? COLLATE NOCASE OR ?=?) AND d.id IN (SELECT value FROM json_each(s.cognition_detail_ids_json))`)
          .get(parent,parentId,access.holder,access.holder,EVERYONE_HOLDER)) { safe.push(access); continue; }
        const evidence = json<Array<{ messageId?: string }>>(access.evidence_json, []).map((item) => item.messageId).filter(Boolean) as string[];
        const located = evidence.map((messageId) => ({ messageId, ordinal: sourceOrdinals.get(messageId)?.ordinal }));
        if (!evidence.length || located.some((item) => item.ordinal === undefined || item.ordinal > fork)) {
          ambiguous = true;
          located.filter((item): item is { messageId: string; ordinal: number } => item.ordinal !== undefined && item.ordinal <= fork)
            .forEach((item) => boundaryMessageIds.add(item.messageId));
          continue;
        }
        safe.push(access);
      }
      if (safe.length === 0) {
        insertAccess.run(randomUUID(), child, itemKind, childId, "__narrator_archive__", "internal", "[]", 1, parentChat.revision, now);
      } else for (const access of safe) insertAccess.run(randomUUID(), child, itemKind, childId, access.holder, access.basis, access.evidence_json, access.confidence, access.source_revision, now);
      if (ambiguous) {
        for (const messageId of itemEvidenceIds(itemKind, parentId)) {
          const ordinal = sourceOrdinals.get(messageId)?.ordinal;
          if (ordinal !== undefined && ordinal <= fork) boundaryMessageIds.add(messageId);
        }
        counts.pendingAccessReextraction = (counts.pendingAccessReextraction ?? 0) + 1;
      }
    }
    // A fork may exclude future grants: preserve only the user-selected scope safe at its boundary.
    writeDetailAccessEdits(db, child, new Map([...readDetailAccessEdits(db, parent).keys()]
      .flatMap(id => {
        const childId = detailMap.get(id) ?? dialogueMap.get(id);
        const access = childId ? memoryDetailAccess(db, child, childId, detailMap.has(id) ? "detail" : "dialogue") : undefined;
        return childId && access ? [[childId, access.everyone ? [EVERYONE_HOLDER] : access.holders.map(holder => holder.name)] as const] : [];
      })));
    for (const id of detailMap.values()) syncDetailKnownBy(db, child, id);
    if (boundaryMessageIds.size) {
      const ids = [...boundaryMessageIds];
      prepare(`UPDATE messages SET extraction_state='pending' WHERE chat_id=? AND message_id IN (${ids.map(() => "?").join(",")}) AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`).run(child, ...ids);
      ids.forEach((id) => pendingReextractionIds.add(id));
      counts.boundaryMessages = ids.length;
    }
    if (fork < (prepare("SELECT COALESCE(MAX(ordinal),0) ordinal FROM messages WHERE chat_id=?").get(parent) as { ordinal: number }).ordinal) {
      const uncertain = prepare(`SELECT p.promise_key,p.promisor,p.promisee,p.content,p.status FROM promises p WHERE p.chat_id=? AND NOT EXISTS(SELECT 1 FROM promise_events e WHERE e.chat_id=p.chat_id AND e.promise_key=p.promise_key AND e.source_ordinal<=?)`).all(parent, fork) as any[];
      for (const promise of uncertain) {
        prepare("INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,status,created_revision,created_at) VALUES(?,?, 'temporal_boundary_review','null',?,'pending',?,?)").run(randomUUID(), child, JSON.stringify(promise), parentChat.revision, now);
        counts.conflicts = (counts.conflicts ?? 0) + 1;
      }
    }

    const batchMap = new Map<string, string>();
    const coveredSources = new Map<string, string>();
    for (const row of prepare("SELECT * FROM extraction_batches WHERE chat_id=? AND generation_id='active' AND status='applied' AND end_ordinal<=? ORDER BY start_ordinal").all(parent, fork) as any[]) {
      const ids = JSON.parse(row.source_message_ids_json) as string[];
      const fingerprint = sourceFingerprint(db, child, ids);
      if (fingerprint.length !== ids.length) continue;
      const id = randomUUID(); batchMap.set(row.id, id);
      for (const sourceId of ids) coveredSources.set(sourceId, row.kind === "episode" ? "encapsulated" : "done");
      prepare(`INSERT INTO extraction_batches(id,chat_id,generation_id,kind,source_message_ids_json,source_fingerprint_json,start_ordinal,end_ordinal,status,final_json,created_at,updated_at)
        VALUES(?,?,'active',?,?,?,?,?,'applied',?,?,?)`).run(id, child, row.kind, JSON.stringify(ids), JSON.stringify(fingerprint), fingerprint[0]!.ordinal, fingerprint.at(-1)!.ordinal,
          row.final_json ? remapJson(row.final_json, new Map([...memoryMap, ...detailMap, ...dialogueMap])) : null, now, now);
    }
    for (const [originalBatch, inheritedBatch] of batchMap) {
      for(const table of ['assertions','beliefs','social_knowledge_events']) prepare(`UPDATE ${table} SET source_batch_id=? WHERE chat_id=? AND source_batch_id=?`).run(inheritedBatch,child,`lineage:${originalBatch}`);
      prepare("UPDATE source_passages SET source_batch_id=? WHERE chat_id=? AND source_batch_id=?").run(inheritedBatch, child, `lineage:${originalBatch}`);
      prepare("UPDATE memory_recall_events SET source_batch_id=? WHERE chat_id=? AND source_batch_id=?").run(inheritedBatch, child, `lineage:${originalBatch}`);
      prepare("UPDATE promises SET source_batch_id=? WHERE chat_id=? AND source_batch_id=?").run(inheritedBatch, child, `lineage:${originalBatch}`);
      prepare("UPDATE promise_events SET source_batch_id=? WHERE chat_id=? AND source_batch_id=?").run(inheritedBatch, child, `lineage:${originalBatch}`);
    }
    const unmappedRelationEvidence = new Set<string>();
    for (const [originalRelationId, childRelationId] of atomRelationMap) {
      const originalBatch = atomRelationSourceBatches.get(originalRelationId);
      if (!originalBatch) continue;
      const inheritedBatch = batchMap.get(originalBatch);
      if (inheritedBatch) {
        prepare("UPDATE atom_relations SET source_batch_id=? WHERE id=? AND chat_id=?").run(inheritedBatch, childRelationId, child);
        continue;
      }
      const relation = prepare("SELECT evidence_json FROM atom_relations WHERE id=? AND chat_id=?").get(childRelationId, child) as { evidence_json: string } | undefined;
      for (const evidence of json<Array<{ messageId?: string }>>(relation?.evidence_json, [])) if (evidence.messageId) unmappedRelationEvidence.add(evidence.messageId);
      prepare("DELETE FROM atom_relations WHERE id=? AND chat_id=?").run(childRelationId, child);
      prepare("DELETE FROM chat_lineage_items WHERE child_chat_id=? AND item_kind='atom_relation' AND child_item_id=?").run(child, childRelationId);
      atomRelationMap.delete(originalRelationId);
      counts.atomRelations = Math.max(0, (counts.atomRelations ?? 1) - 1);
    }
    if (unmappedRelationEvidence.size) {
      const ids = [...unmappedRelationEvidence];
      prepare(`UPDATE messages SET extraction_state='pending' WHERE chat_id=? AND message_id IN (${ids.map(() => "?").join(",")})
        AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`).run(child, ...ids);
      ids.forEach((id) => pendingReextractionIds.add(id));
    }
    for (const [originalId, inheritedId] of memoryMap) {
      const originalBatch = (prepare("SELECT source_batch_id FROM memories WHERE id=?").get(originalId) as { source_batch_id: string | null }).source_batch_id;
      if (originalBatch && batchMap.has(originalBatch)) prepare("UPDATE memories SET source_batch_id=? WHERE id=?").run(batchMap.get(originalBatch), inheritedId);
    }
    for (const row of prepare("SELECT * FROM episodes WHERE chat_id=? AND status='capsuled' AND COALESCE(end_ordinal,start_ordinal,?)<=?").all(parent, fork, fork) as any[]) {
      const id = randomUUID(); episodeMap.set(row.id, id);
      prepare(`INSERT INTO episodes(id,chat_id,title,summary,start_revision,end_revision,status,start_ordinal,end_ordinal,source_tokens,resolution,memory_id,last_error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, child, row.title, row.summary, row.start_revision, row.end_revision, row.status, row.start_ordinal, row.end_ordinal, row.source_tokens, row.resolution, memoryMap.get(row.memory_id) ?? null, null, now, now);
      for (const item of prepare("SELECT * FROM episode_messages WHERE episode_id=? AND ordinal<=?").all(row.id, fork) as any[]) prepare("INSERT INTO episode_messages(episode_id,chat_id,message_id,ordinal,turn_index) VALUES(?,?,?,?,?)").run(id, child, item.message_id, item.ordinal, item.turn_index);
      for (const section of prepare("SELECT * FROM episode_sections WHERE episode_id=?").all(row.id) as any[]) prepare("INSERT INTO episode_sections(id,episode_id,chat_id,ordinal,title,summary,source_message_ids_json,evidence_json,key_dialogues_json,token_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(randomUUID(), id, child, section.ordinal, section.title, section.summary, section.source_message_ids_json, section.evidence_json, section.key_dialogues_json, section.token_count, now);
      mapItem("episode", id, row.id);
    }
    counts.episodes = episodeMap.size;
    const reviewJobs = new Map<string, string>();
    const ledgerIds=new Map([...memoryMap,...detailMap,...dialogueMap,...assertionMap,...beliefMap,...promiseMap]);
    for(const [table,idMap] of [['assertions',assertionMap],['beliefs',beliefMap]] as const) for(const newId of idMap.values()) {
      const row=prepare(`SELECT automatic_closure_evidence_json FROM ${table} WHERE id=?`).get(newId) as {automatic_closure_evidence_json:string|null};
      if(row.automatic_closure_evidence_json) {
        const evidence=json<Array<{successorId?:string}>>(row.automatic_closure_evidence_json,[])
          .map(item=>({...item,...(item.successorId ? {successorId:idMap.get(item.successorId) ?? null} : {})}));
        prepare(`UPDATE ${table} SET automatic_closure_evidence_json=? WHERE id=?`).run(JSON.stringify(evidence),newId);
      }
    }
    for(const [oldId,newId] of beliefMap) {
      const row=prepare("SELECT superseded_by FROM beliefs WHERE id=?").get(newId) as {superseded_by:string|null};
      if(row.superseded_by) prepare("UPDATE beliefs SET superseded_by=? WHERE id=?").run(beliefMap.get(row.superseded_by) ?? null,newId);
    }
    for (const row of prepare("SELECT * FROM reconciliation_items WHERE chat_id=? AND status='pending'").all(parent) as any[]) {
      const sources = json<string[]>(row.source_message_ids_json, []);
      const valid = sources.every((id) => sourceOrdinals.get(id)?.ordinal! <= fork);
      if (!valid) continue;
      let jobId = reviewJobs.get(row.job_id);
      if (!jobId) {
        jobId = randomUUID(); reviewJobs.set(row.job_id, jobId);
        prepare("INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'extract','superseded',?,0,?,?)").run(jobId, child, JSON.stringify({ sourceMessageIds: sources, inheritedReview: true }), now, now);
      }
      const id = randomUUID();
      prepare(`INSERT INTO reconciliation_items(id,chat_id,job_id,item_ref,item_kind,incoming_json,candidates_json,model_decision_json,model_error,source_message_ids_json,status,resolution_json,created_revision,created_at,resolved_at) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',NULL,?,?,NULL)`).run(
        id, child, jobId, row.item_ref, row.item_kind, remapJson(row.incoming_json, ledgerIds), remapJson(row.candidates_json, ledgerIds), remapJson(row.model_decision_json ?? "null", ledgerIds), row.model_error, row.source_message_ids_json, row.created_revision, now,
      );
      mapItem("reconciliation_review", id, row.id); counts.reviews = (counts.reviews ?? 0) + 1;
    }
    // Audit-only candidates follow an inherited prefix without activating atoms.
    for (const row of prepare("SELECT * FROM extraction_audits WHERE chat_id=? AND json_type(draft_json,'$.smallReviews')='array'").all(parent) as any[]) {
      const sources = json<string[]>(row.source_message_ids_json, []);
      if (!sources.length || !sources.every(id => sourceOrdinals.get(id)?.ordinal! <= fork)) continue;
      const draft = JSON.parse(row.draft_json);
      draft.smallReviews = draft.smallReviews.flatMap((candidate: any) => {
        if (candidate.parentMemoryId && !memoryMap.has(candidate.parentMemoryId)) return [];
        const {retryJobId: _retry, ...copy} = candidate;
        return [{...copy, parentMemoryId: candidate.parentMemoryId ? memoryMap.get(candidate.parentMemoryId) : undefined}];
      });
      if (!draft.smallReviews.length) continue;
      const jobId = randomUUID(), id = randomUUID();
      prepare("INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'extract','done',?,0,?,?)")
        .run(jobId, child, JSON.stringify({sourceMessageIds: sources, inheritedReview: true}), now, now);
      const revision = (prepare("SELECT revision FROM chats WHERE id=?").get(child) as {revision: number}).revision;
      prepare("INSERT INTO extraction_audits(id,chat_id,job_id,status,source_message_ids_json,source_fingerprint_json,source_revision,draft_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(id, child, jobId, row.status, row.source_message_ids_json, JSON.stringify(sourceFingerprint(db, child, sources)), revision, JSON.stringify(draft), now, now);
    }
    const futureMessageIds = (prepare("SELECT message_id FROM messages WHERE chat_id=? AND ordinal>?").all(parent, fork) as Array<{ message_id: string }>).map((item) => item.message_id);
    for (const row of prepare("SELECT * FROM conflicts WHERE chat_id=? AND status='pending'").all(parent) as any[]) {
      if (futureMessageIds.some((id) => row.existing_json.includes(id) || row.incoming_json.includes(id))) continue;
      const id = randomUUID(); prepare("INSERT INTO conflicts(id,chat_id,kind,existing_json,incoming_json,status,resolution,created_revision,created_at,resolved_at) VALUES(?,?,?,?,?,'pending',NULL,?,?,NULL)").run(id, child, row.kind, row.existing_json, row.incoming_json, row.created_revision, now);
      mapItem("conflict", id, row.id); counts.conflicts = (counts.conflicts ?? 0) + 1;
    }

    // Story-spine nodes are derived, but a branch should not lose the long-form
    // navigation map for its inherited prefix. Copy only nodes wholly before
    // the fork whose complete support set can be mapped to child atoms. This
    // prevents a private/future parent support from leaking through a summary.
    const mappedItems = new Map((prepare("SELECT item_kind,parent_item_id,child_item_id FROM chat_lineage_items WHERE child_chat_id=?").all(child) as Array<{ item_kind: string; parent_item_id: string; child_item_id: string }>)
      .map((item) => [`${item.item_kind}:${item.parent_item_id}`, item.child_item_id]));
    const storyNodeMap = new Map<string, string>();
    const supportKind: Record<string, string> = {
      memory: "memory", detail: "memory_detail", dialogue: "dialogue", assertions: "assertion",
      beliefs: "belief", promises: "promise", relationship_events: "relationship_event",
    };
    const mapSupport = (supportId: string): string | undefined => {
      const colon = supportId.indexOf(":");
      if (colon < 1) return undefined;
      const prefix = supportId.slice(0, colon);
      const parentId = supportId.slice(colon + 1);
      if (prefix === "spine") return storyNodeMap.get(parentId) ? `spine:${storyNodeMap.get(parentId)}` : undefined;
      const kind = supportKind[prefix];
      const mapped = kind ? mappedItems.get(`${kind}:${parentId}`) : undefined;
      return mapped ? `${prefix}:${mapped}` : undefined;
    };
    const parentStoryNodes = prepare(`SELECT * FROM story_spine_nodes WHERE chat_id=? AND generation_id='active' AND status='active' AND end_ordinal<=?
      ORDER BY CASE level WHEN 'segment' THEN 0 WHEN 'arc' THEN 1 ELSE 2 END,start_ordinal,created_at`).all(parent, fork) as any[];
    for (const row of parentStoryNodes) {
      const parentSupports = prepare("SELECT item_id,ordinal FROM story_spine_support WHERE node_id=? ORDER BY ordinal").all(row.id) as Array<{ item_id: string; ordinal: number }>;
      if (!parentSupports.length) continue;
      const mappedSupports = parentSupports.map((support) => ({ ...support, item_id: mapSupport(support.item_id) }));
      if (mappedSupports.some((support) => !support.item_id)) continue;
      const parentSources = prepare("SELECT source_node_id,ordinal FROM story_spine_sources WHERE node_id=? ORDER BY ordinal").all(row.id) as Array<{ source_node_id: string; ordinal: number }>;
      const mappedSources = parentSources.map((source) => ({ ...source, source_node_id: storyNodeMap.get(source.source_node_id) }));
      if (mappedSources.some((source) => !source.source_node_id)) continue;
      const nodeId = randomUUID();
      storyNodeMap.set(row.id, nodeId);
      prepare(`INSERT INTO story_spine_nodes(id,chat_id,generation_id,level,scope,holder,title,summary,beats_json,active_transitions_json,
        start_ordinal,end_ordinal,source_token_count,source_fingerprint,status,pinned,hidden,created_at,updated_at)
        VALUES(?,?,'active',?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?)`).run(
        nodeId, child, row.level, row.scope, row.holder, row.title, row.summary,
        JSON.stringify((json<Array<{ text: string; supportItemIds: string[] }>>(row.beats_json, [])).map((beat) => ({
          ...beat, supportItemIds: beat.supportItemIds.map((id) => mapSupport(id)).filter(Boolean),
        }))), row.active_transitions_json, row.start_ordinal, row.end_ordinal, row.source_token_count,
        `lineage:${row.source_fingerprint}`, row.pinned, row.hidden, row.created_at, now,
      );
      const insertSupport = prepare("INSERT INTO story_spine_support(node_id,item_id,ordinal) VALUES(?,?,?)");
      mappedSupports.forEach((support) => insertSupport.run(nodeId, support.item_id, support.ordinal));
      const insertSource = prepare("INSERT INTO story_spine_sources(node_id,source_node_id,ordinal) VALUES(?,?,?)");
      mappedSources.forEach((source) => insertSource.run(nodeId, source.source_node_id, source.ordinal));
      mapItem("story_spine", nodeId, row.id);
      const vector = embeddingsByItem.get(`spine:${row.id}`);
      if (vector) copyVector(vector.rowid, vector, `spine:${nodeId}`, nodeId, null, vector.source_json);
    }
    counts.storySpineNodes = storyNodeMap.size;
    // Copy vector blobs in one SQL statement; never serialize 1024 floats per row.
    // The savepoint also keeps metadata and vectors atomic when sqlite-vec is unavailable.
    if (vectorCopies.length) try {
      counts.embeddings = db.transaction(() => {
        const mapping = JSON.stringify(vectorCopies);
        prepare(`WITH copies AS MATERIALIZED (
          SELECT CAST(json_extract(m.value,'$.newRow') AS INTEGER) rowid,v.embedding
          FROM json_each(?) m CROSS JOIN embedding_vectors_v4_chat v WHERE v.rowid=json_extract(m.value,'$.oldRow'))
          INSERT INTO embedding_vectors_v4_chat(rowid,embedding,chat_id) SELECT rowid,embedding,? FROM copies`).run(mapping, child);
        return prepare(`INSERT INTO embedding_items(rowid,item_id,chat_id,kind,source_id,block_id,source_json,content,content_hash,model,dimension,updated_at)
          SELECT json_extract(m.value,'$.newRow'),json_extract(m.value,'$.itemId'),?,i.kind,json_extract(m.value,'$.sourceId'),
            json_extract(m.value,'$.blockId'),json_extract(m.value,'$.sourceJson'),i.content,i.content_hash,i.model,i.dimension,?
          FROM json_each(?) m JOIN embedding_items i ON i.rowid=json_extract(m.value,'$.oldRow')
          JOIN embedding_vectors_v4_chat v ON v.rowid=json_extract(m.value,'$.newRow')`).run(child, now, mapping).changes;
      })();
    } catch { /* sqlite-vec may be unavailable; FTS remains complete. */ }


    const lineageIds = new Map((prepare("SELECT parent_item_id,child_item_id FROM chat_lineage_items WHERE child_chat_id=?").all(child) as Array<{ parent_item_id: string; child_item_id: string }>)
      .map((item) => [item.parent_item_id, item.child_item_id]));
    const translationKinds = new Set([
      "memory-title", "memory-content", "memory-detail", "dialogue", "evidence",
      "relationship", "relationship-tension", "relationship-event", "initial-relationship", "physical-intimacy",
      "assertion", "assertion-history", "belief", "belief-history", "promise", "promise-history",
      "story-title", "story-summary", "story-beat", "story-transition", "story-flow-title", "story-flow-summary", "story-flow-beat",
    ]);
    const remapTranslationItemId = (kindName: string, itemId: string): string | undefined => {
      if (!translationKinds.has(kindName)) return undefined;
      if (kindName === "relationship" || kindName === "relationship-tension") {
        const match = /^relationship:(.+)\|(.+?):(?:summary|tension:\d+)$/.exec(itemId);
        return match && reusableRelationshipPairs.has(`${match[1]}\0${match[2]}`) ? itemId : undefined;
      }
      const remapped = itemId.split(":").map((part) => lineageIds.get(part) ?? part).join(":");
      return remapped === itemId ? undefined : remapped;
    };
    const serverInstanceId = String((prepare("SELECT value FROM server_meta WHERE key='instance_id'").get() as { value?: string } | undefined)?.value ?? "");
    const insertTranslation = prepare(`INSERT OR IGNORE INTO translation_cache(cache_key,server_instance_id,chat_id,item_kind,item_id,source_hash,provider,source_language,target_language,translated,used_at,created_at,model)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of prepare("SELECT * FROM translation_cache WHERE chat_id=? ORDER BY created_at").all(parent) as any[]) {
      const itemId = remapTranslationItemId(row.item_kind, row.item_id);
      if (!itemId) continue;
      const cacheKey = translationCacheKey({ serverInstanceId, chatId: child, kind: row.item_kind, itemId,
        sourceHash: row.source_hash, provider: row.provider, sourceLanguage: row.source_language, targetLanguage: row.target_language });
      const inserted = insertTranslation.run(cacheKey, serverInstanceId, child, row.item_kind, itemId, row.source_hash, row.provider,
        row.source_language, row.target_language, row.translated, row.used_at, row.created_at, row.model ?? "").changes;
      counts.translations = (counts.translations ?? 0) + inserted;
    }
    pruneTranslationCache(db);

    // Reuse completed batches instead of stale parent pending/queued flags.
    // Lost boundary atoms or access grants still need source-backed reconstruction.
    for (const state of ["done", "encapsulated"]) {
      const ids = [...coveredSources].filter(([id, value]) => value === state && !boundaryMessageIds.has(id) && !unmappedRelationEvidence.has(id)).map(([id]) => id);
      if (!ids.length) continue;
      const restored = prepare(`UPDATE messages SET extraction_state=? WHERE chat_id=? AND extraction_state='pending'
        AND message_id IN (SELECT value FROM json_each(?)) RETURNING message_id`).all(state, child, JSON.stringify(ids)) as Array<{message_id:string}>;
      for (const row of restored) pendingReextractionIds.delete(row.message_id);
    }

    remapInheritedSources(db, child, messageMap, request);
    if (!options.skipQuizzes) counts.quizzes = inheritQuizzes(db, parent, child, memoryMap, messageMap, detailMap);
    for (const id of [...pendingReextractionIds]) {
      pendingReextractionIds.delete(id); pendingReextractionIds.add(messageMap.get(id) ?? id);
    }
    rebuildCharacterRecallTraces(db, child);
    bindInheritedMemoryGroups(db, child);

    syncManualCognition(db,child);
    for (const memoryId of memoryMap.values()) refreshMemoryFts(db, memoryId);

    if (pendingReextractionIds.size) counts.pendingReextraction = pendingReextractionIds.size;
    counts.relationships = (prepare("SELECT COUNT(*) count FROM relationship_projections WHERE chat_id=?").get(child) as {count:number}).count;
    prepare(`INSERT OR REPLACE INTO chat_lineage(child_chat_id,parent_chat_id,parent_title,kind,fork_message_id,fork_ordinal,ordinal_offset,detection,status,counts_json,candidates_json,created_at,applied_at) VALUES(?,?,?,?,?,?,?,?,'inherited',?,'[]',?,?)`).run(child, parent, candidate.title, kind, candidate.forkMessageId, fork, ordinalOffset, detection, JSON.stringify(counts), now, now);
  })();
  applyOrdinalOffset(request, ordinalOffset);
  return counts;
}

function characterName(row: { character_id: string; static_json?: string | null }): string {
  try {
    const value = json<{ characterName?: string }>(row.static_json, {}).characterName?.trim();
    return value || row.character_id;
  } catch { return row.character_id; }
}

function manualTargetRequest(db: RcmDatabase, chatId: string): TurnPrepareRequest {
  const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as any;
  if (!chat) throw new Error("Target chat not found");
  const messageVisibility = db.prepare(`
    SELECT message_id AS id,ordinal,host_visibility AS visibility,role,content_hash AS contentHash,
      source_record_id AS sourceRecordId,display_content_hash AS displayContentHash,display_comparison_hash AS displayComparisonHash
    FROM messages WHERE chat_id=? ORDER BY ordinal
  `).all(chatId) as TurnPrepareRequest["messageVisibility"];
  return {
    chatId,
    chatTitle: chat.chat_title ?? undefined,
    characterId: chat.character_id,
    profile: chat.profile,
    includeUserMessages: Boolean(chat.include_user_messages),
    extractionGroupTurns: Number(chat.extraction_group_turns ?? 6),
    memoryLanguage: chat.memory_language ?? "en",
    messages: [],
    messageVisibility,
    query: "",
    perspectives: [],
    tokenBudget: 0,
    forceBackfill: false,
    deferExtraction: false,
  };
}

function derivedCounts(db: RcmDatabase, chatId: string): Counts {
  const tables = {
    memories: "memories", relationships: "relationship_projections", relationshipEvents: "relationship_events", assertions: "assertions", beliefs: "beliefs",
    promises: "promises", reviews: "reconciliation_items",
    conflicts: "conflicts", embeddings: "embedding_items", episodes: "episodes", entities: "entities",
  } as const;
  return Object.fromEntries(Object.entries(tables).map(([key, table]) => [key,
    Number((db.prepare(`SELECT count(*) AS count FROM ${table} WHERE chat_id=?`).get(chatId) as { count: number }).count),
  ]));
}

function inheritanceCounts(db: RcmDatabase, parentChatId: string, forkOrdinal: number): Counts {
  const evidenceBeforeFork = (): number => {
    return Number((db.prepare(`
      SELECT count(*) count FROM memories mm WHERE mm.chat_id=? AND NOT EXISTS(
        SELECT 1 FROM json_each(mm.evidence_json) ev JOIN messages m ON m.chat_id=mm.chat_id AND m.message_id=json_extract(ev.value,'$.messageId')
        WHERE m.ordinal>?
      )
    `).get(parentChatId, forkOrdinal) as { count: number }).count);
  };
  const memoryEmbeddings = Number((db.prepare(`
    SELECT count(*) count FROM embedding_items item
    JOIN memories mm ON mm.id=item.source_id
    WHERE item.chat_id=? AND item.kind='memory' AND NOT EXISTS(
      SELECT 1 FROM json_each(mm.evidence_json) ev
      JOIN messages m ON m.chat_id=mm.chat_id AND m.message_id=json_extract(ev.value,'$.messageId')
      WHERE m.ordinal>?
    )
  `).get(parentChatId, forkOrdinal) as { count: number }).count);
  const transcriptEmbeddings = Number((db.prepare(`
    SELECT count(*) count FROM embedding_items item
    JOIN embedding_blocks block ON block.id=item.block_id
    WHERE item.chat_id=? AND item.kind='transcript_chunk' AND block.status='indexed' AND block.end_ordinal<=?
  `).get(parentChatId, forkOrdinal) as { count: number }).count);
  return {
    messages: Number((db.prepare("SELECT count(*) count FROM messages WHERE chat_id=? AND ordinal<=?").get(parentChatId, forkOrdinal) as { count: number }).count),
    memories: evidenceBeforeFork(),
    relationshipEvents: Number((db.prepare("SELECT count(*) count FROM relationship_events WHERE chat_id=? AND active=1 AND COALESCE(source_end_ordinal,?)<=?").get(parentChatId, forkOrdinal, forkOrdinal) as { count: number }).count),
    assertions: Number((db.prepare("SELECT count(*) count FROM assertions WHERE chat_id=? AND COALESCE(valid_from_ordinal,?)<=?").get(parentChatId, forkOrdinal, forkOrdinal) as { count: number }).count),
    beliefs: Number((db.prepare("SELECT count(*) count FROM beliefs WHERE chat_id=? AND COALESCE(valid_from_ordinal,?)<=?").get(parentChatId, forkOrdinal, forkOrdinal) as { count: number }).count),
    promises: Number((db.prepare("SELECT count(DISTINCT promise_key) count FROM promise_events WHERE chat_id=? AND source_ordinal<=?").get(parentChatId, forkOrdinal) as { count: number }).count),
    reviews: Number((db.prepare("SELECT count(*) count FROM reconciliation_items WHERE chat_id=? AND status='pending'").get(parentChatId) as { count: number }).count),
    conflicts: Number((db.prepare("SELECT count(*) count FROM conflicts WHERE chat_id=? AND status='pending'").get(parentChatId) as { count: number }).count),
    embeddings: memoryEmbeddings + transcriptEmbeddings,
  };
}

function activeJobCount(db: RcmDatabase, chatId: string): number {
  return Number((db.prepare("SELECT count(*) count FROM jobs WHERE chat_id=? AND status IN ('queued','leased')").get(chatId) as { count: number }).count);
}

function buildManualPreview(
  db: RcmDatabase,
  targetChatId: string,
  parentChatId: string,
  targetInventory?: TurnPrepareRequest["messageVisibility"],
  targetDescriptor?: ManualLineagePreviewRequest["target"],
): ManualLineagePreview {
  if (targetChatId === parentChatId) throw new Error("Source and target chats must be different");
  const parent = db.prepare("SELECT * FROM chats WHERE id=?").get(parentChatId) as any;
  const storedTarget = db.prepare("SELECT * FROM chats WHERE id=?").get(targetChatId) as any;
  const target = storedTarget ?? (targetDescriptor ? {
    id: targetChatId,
    chat_title: targetDescriptor.chatTitle ?? "",
    character_id: targetDescriptor.characterId,
    profile: targetDescriptor.profile,
    static_json: JSON.stringify({ characterName: targetDescriptor.characterName }),
    updated_at: 0,
    revision: 0,
  } : undefined);
  if (!parent || !target) throw new Error("Source or target chat not found");
  const targetQueuedJobs = memoryTransferQueuedJobs(db, parentChatId, targetChatId);
  const existing = derivedCounts(db, targetChatId);
  const requiresReplacement = Object.values(existing).some((count) => count > 0);

  const sourceRows = db.prepare("SELECT message_id,ordinal,role,content_hash,lifecycle FROM messages WHERE chat_id=? AND lifecycle IN ('committed','client_pruned','pending') ORDER BY ordinal").all(parentChatId) as any[];
  const targetRows = targetInventory?.length
    ? targetInventory.filter((row) => row.role && row.contentHash && row.visibility === "active").map((row) => ({ message_id: row.id, ordinal: row.ordinal, role: row.role, content_hash: row.contentHash }))
    : db.prepare("SELECT message_id,ordinal,role,content_hash FROM messages WHERE chat_id=? AND lifecycle IN ('committed','client_pruned','pending') ORDER BY ordinal").all(targetChatId) as any[];
  const sourceById = new Map(sourceRows.map((row) => [row.message_id, row]));
  const sameIdConflict = targetRows.some((row) => {
    const source = sourceById.get(row.message_id);
    return source && (source.role !== row.role || source.content_hash !== row.content_hash);
  });
  if (sameIdConflict) throw new Error("A matching message ID has different content");
  const shared = targetRows.map((row) => ({ target: row, source: sourceById.get(row.message_id) }))
    .filter((item): item is { target: any; source: any } => Boolean(item.source) && item.source.role === item.target.role && item.source.content_hash === item.target.content_hash);
  if (shared.length < 2) throw new Error("At least two exact message IDs are required; use an RCM ZIP backup when IDs are unavailable");
  if (shared.some((item, index) => index > 0 && item.source.ordinal <= shared[index - 1]!.source.ordinal)) throw new Error("Matching messages are not in the same order");
  const last = shared.at(-1)!.source;
  const sourceMax = Number(sourceRows.at(-1)?.ordinal ?? 0);
  const firstSourceOrdinal = Number(shared[0]!.source.ordinal);
  const kind: "copy" | "branch" | "pruned_copy" = firstSourceOrdinal > 0 ? "pruned_copy" : last.ordinal < sourceMax ? "branch" : "copy";
  const counts = inheritanceCounts(db, parentChatId, last.ordinal);
  const targetIds = new Set(targetRows.map((row) => row.message_id));
  const clientPrunedMessages = sourceRows.filter((row) => row.ordinal <= last.ordinal && !targetIds.has(row.message_id)).length;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    parentChatId, targetChatId, parentUpdated: parent.updated_at, targetUpdated: target.updated_at,
    forkMessageId: last.message_id, forkOrdinal: last.ordinal, shared: shared.map((item) => [item.source.message_id, item.source.content_hash]),
    counts, existing, targetQueuedJobs, targetInventory: targetRows.map((row) => [row.message_id, row.ordinal, row.role, row.content_hash]),
  })).digest("hex");
  return {
    fingerprint,
    parent: { chatId: parent.id, chatTitle: parent.chat_title?.trim() || "", characterId: parent.character_id, characterName: characterName(parent) },
    target: { chatId: target.id, chatTitle: target.chat_title?.trim() || "", characterId: target.character_id, characterName: characterName(target) },
    kind,
    commonMessages: shared.length,
    lastCommonMessageId: last.message_id,
    forkOrdinal: last.ordinal,
    clientPrunedMessages,
    inheritedCounts: counts,
    targetDerivedCounts: existing,
    requiresReplacement,
    targetQueuedJobs,
  };
}

export function previewManualLineage(db: RcmDatabase, targetChatId: string, parentChatId: string, targetInventory?: TurnPrepareRequest["messageVisibility"], targetDescriptor?: ManualLineagePreviewRequest["target"]): ManualLineagePreview {
  return buildManualPreview(db, targetChatId, parentChatId, targetInventory, targetDescriptor);
}

function clearDerivedForLineageReplacement(
  db: RcmDatabase,
  chatId: string,
  targetInventory: NonNullable<TurnPrepareRequest["messageVisibility"]>,
): void {
  const rowIds = db.prepare("SELECT rowid FROM embedding_items WHERE chat_id=?").all(chatId) as Array<{ rowid: number }>;
  if (rowIds.length) {
    const removeVector = db.prepare("DELETE FROM embedding_vectors_v4_chat WHERE rowid=?");
    for (const row of rowIds) {
      try { removeVector.run(BigInt(row.rowid)); } catch { /* sqlite-vec may be unavailable */ }
    }
  }
  deleteDerivedRows(db, chatId);
  db.prepare("DELETE FROM chat_lineage_items WHERE child_chat_id=?").run(chatId);
  db.prepare("DELETE FROM chat_lineage WHERE child_chat_id=?").run(chatId);
  const visibleIds = new Set(targetInventory.map((item) => item.id));
  const stored = db.prepare("SELECT message_id FROM messages WHERE chat_id=?").all(chatId) as Array<{ message_id: string }>;
  const removeMessage = db.prepare("DELETE FROM messages WHERE chat_id=? AND message_id=?");
  for (const row of stored) {
    if (!visibleIds.has(row.message_id)) removeMessage.run(chatId, row.message_id);
  }
}

export function applyManualLineage(
  db: RcmDatabase,
  targetChatId: string,
  parentChatId: string,
  fingerprint: string,
  targetInventory?: TurnPrepareRequest["messageVisibility"],
  replaceDerived = false,
  targetDescriptor?: ManualLineagePreviewRequest["target"],
): ChatLineageStatus {
  return db.transaction(() => {
    const targetWasMissing = !db.prepare("SELECT 1 FROM chats WHERE id=?").get(targetChatId);
    const preview = buildManualPreview(db, targetChatId, parentChatId, targetInventory, targetDescriptor);
    if (preview.fingerprint !== fingerprint) throw new Error("LINEAGE_PREVIEW_STALE");
    if (preview.requiresReplacement && !replaceDerived) throw new Error("TARGET_HAS_DERIVED_DATA");
    if (preview.requiresReplacement && !targetInventory?.length) throw new Error("TARGET_INVENTORY_REQUIRED");
    const request = !targetWasMissing
      ? { ...manualTargetRequest(db, targetChatId), ...(targetInventory?.length ? { messageVisibility: targetInventory } : {}) }
      : {
        chatId: targetChatId,
        chatTitle: targetDescriptor?.chatTitle,
        characterId: targetDescriptor!.characterId,
        profile: targetDescriptor!.profile,
        messages: [],
        messageVisibility: targetInventory,
        query: "",
        perspectives: [],
        tokenBudget: 0,
        includeUserMessages: targetDescriptor?.includeUserMessages,
        extractionGroupTurns: targetDescriptor?.extractionGroupTurns,
        memoryLanguage: targetDescriptor?.memoryLanguage,
        forceBackfill: false,
        deferExtraction: true,
      } satisfies TurnPrepareRequest;
    cancelQueuedMemoryTransferJobs(db, targetChatId);
    if (preview.requiresReplacement) clearDerivedForLineageReplacement(db, targetChatId, targetInventory!);
    cloneLineage(db, request, {
      chatId: parentChatId,
      title: preview.parent.chatTitle || preview.parent.chatId,
      forkMessageId: preview.lastCommonMessageId,
      forkOrdinal: preview.forkOrdinal,
      firstSharedOrdinal: preview.kind === "pruned_copy" ? 1 : 0,
      sharedMessages: preview.commonMessages,
    }, preview.kind, "manual_cross_bot", { preserveChildConfiguration: true });
    if (targetWasMissing && targetDescriptor) {
      db.prepare("UPDATE chats SET static_json=? WHERE id=?").run(JSON.stringify({ characterName: targetDescriptor.characterName }), targetChatId);
    }
    return getChatLineage(db, targetChatId);
  })();
}

export function applyProbedLineage(db: RcmDatabase, request: TurnPrepareRequest, parentChatId: string, fingerprint: string): ChatLineageStatus {
  return db.transaction(() => {
    const probe = probeChatLineage(db, request);
    if (probe.fingerprint !== fingerprint) throw new Error("LINEAGE_PROBE_STALE");
    const candidate = probe.candidates.find((item) => item.chatId === parentChatId);
    if (!candidate) throw new Error("LINEAGE_PROBE_STALE");
    const existing = getChatLineage(db, request.chatId);
    if (existing.status !== "none") throw new Error("LINEAGE_ALREADY_APPLIED");
    if (activeJobCount(db, request.chatId) || Object.values(derivedCounts(db, request.chatId)).some((count) => count > 0)) {
      throw new Error("TARGET_HAS_DERIVED_DATA");
    }
    cloneLineage(db, request, {
      chatId: candidate.chatId,
      title: candidate.title,
      forkMessageId: candidate.forkMessageId,
      forkOrdinal: candidate.forkOrdinal,
      firstSharedOrdinal: candidate.firstSharedOrdinal,
      sharedMessages: candidate.sharedMessages,
    }, candidate.kind, probe.detection ?? "message_identity");
    return getChatLineage(db, request.chatId);
  })();
}

export function ensureChatLineage(db: RcmDatabase, request: TurnPrepareRequest, allowDiscovery = true): ChatLineageStatus {
  return db.transaction(() => resolveChatLineage(db, request, allowDiscovery))();
}

function resolveChatLineage(db: RcmDatabase, request: TurnPrepareRequest, allowDiscovery: boolean): ChatLineageStatus {
  const existing = getChatLineage(db, request.chatId);
  if (existing.status !== "none") {
    const row = lineageRow(db, request.chatId);
    if (existing.status === "inherited") {
      const storedOffset = Number(row?.ordinal_offset ?? 0);
      const offset = refreshOrdinalOffset(db, request, storedOffset);
      if (offset !== storedOffset) db.prepare("UPDATE chat_lineage SET ordinal_offset=? WHERE child_chat_id=?").run(offset, request.chatId);
      applyOrdinalOffset(request, offset);
    }
    return existing;
  }
  if (!allowDiscovery) return { status: "none" };
  let recoverSetup = false;
  const shellExists = Boolean(db.prepare("SELECT 1 FROM chats WHERE id=?").get(request.chatId));
  if (shellExists) {
    const derived = Number((db.prepare(`
      SELECT (SELECT COUNT(*) FROM memories WHERE chat_id=?)+(SELECT COUNT(*) FROM relationship_events WHERE chat_id=?)+
             (SELECT COUNT(*) FROM assertions WHERE chat_id=?)+(SELECT COUNT(*) FROM beliefs WHERE chat_id=?)+
             (SELECT COUNT(*) FROM promises WHERE chat_id=?)+(SELECT COUNT(*) FROM jobs WHERE chat_id=?) count
    `).get(request.chatId, request.chatId, request.chatId, request.chatId, request.chatId, request.chatId) as { count: number }).count);
    // A previous defer-only sync may have created an empty shell. It is safe
    // to recover lineage once while no derived state or work exists.
    if (derived > 0) {
      // Recover only automatic setup accidentally offered by older clients,
      // even if it was confirmed. Transcript work and user edits take priority.
      const recoverable = db.prepare(`SELECT 1 FROM initial_calibrations WHERE chat_id=? AND locked_at IS NULL
        AND status IN ('queued','awaiting_confirmation','failed','ready','skipped')
        AND NOT EXISTS (SELECT 1 FROM jobs WHERE chat_id=? AND type<>'initial_calibration')
        AND NOT EXISTS (SELECT 1 FROM memories WHERE chat_id=? AND (NOT is_initial_calibration_memory(memory_key) OR user_managed=1 OR ${memoryHasLineCorrectionSql()}))
        AND NOT EXISTS (SELECT 1 FROM entities WHERE chat_id=? AND user_managed=1)
        AND NOT EXISTS (SELECT 1 FROM relationship_baselines WHERE chat_id=? AND (source<>'setup' OR user_managed=1))
        AND NOT EXISTS (SELECT 1 FROM relationship_projections WHERE chat_id=? AND (user_edit_ordinal IS NOT NULL OR auto_locked=1))
        AND NOT EXISTS (SELECT 1 FROM social_knowledge_events WHERE chat_id=? AND (user_edit_ordinal IS NOT NULL OR auto_locked=1))
        AND NOT EXISTS (SELECT 1 FROM pair_progress WHERE chat_id=? AND (custom=1 OR hidden=1
          OR EXISTS (SELECT 1 FROM json_each(cells_json) WHERE json_extract(value,'$.source')='user')))
        AND NOT EXISTS (SELECT 1 FROM assertions WHERE chat_id=?)
        AND NOT EXISTS (SELECT 1 FROM beliefs WHERE chat_id=?)
        AND NOT EXISTS (SELECT 1 FROM promises WHERE chat_id=?)
        AND NOT EXISTS (SELECT 1 FROM relationship_events WHERE chat_id=?)`)
        .get(...Array(12).fill(request.chatId));
      if (!recoverable || readUserDeletions(db, request.chatId).length || Object.keys(readRemovedAliases(db, request.chatId)).length) return existing;
      recoverSetup = true;
    }
  }
  const { candidates, detection } = resolveCandidates(db, request);
  if (!candidates.length) return { status: "none" };
  if (recoverSetup) deleteDerivedRows(db, request.chatId);
  const candidate = candidates[0]!;
  const kind = candidateKind(db, candidate, detection);
  const ambiguous = candidates.length > 1 && candidates[0]!.sharedMessages === candidates[1]!.sharedMessages;
  if (ambiguous || kind !== "branch" || detection === 'source_sequence') {
    insertShell(db, request);
    saveLineageChoices(db,request,{candidates,detection});
    return getChatLineage(db, request.chatId);
  }
  cloneLineage(db, request, candidate, kind, detection);
  return getChatLineage(db, request.chatId);
}

function saveLineageChoices(db: RcmDatabase, request: TurnPrepareRequest, resolution: CandidateResolution): void {
  const {candidates,detection}=resolution;
  if (!candidates.length) return;
  const ambiguous=candidates.length>1 && candidates[0]!.sharedMessages===candidates[1]!.sharedMessages;
  const fingerprint=probeFingerprint(db,request,resolution);
  // Match the admin active-message count; host event time survives copies and syncs.
  const activity = db.prepare(`SELECT COUNT(m.message_id) AS totalActiveMessages,
    COALESCE(MAX(CASE WHEN m.event_time>0 THEN m.event_time END),c.updated_at) AS lastActivityAt
    FROM chats c LEFT JOIN messages m ON m.chat_id=c.id AND m.source_kind<>'archive'
      AND m.host_visibility='active' AND m.lifecycle IN ('committed','pending')
    WHERE c.id=? GROUP BY c.id`);
  const choices=(ambiguous?candidates:[candidates[0]!]).map(item=>({
    ...item,...activity.get(item.chatId) as {totalActiveMessages:number;lastActivityAt:number},
    kind:candidateKind(db,item,detection),fingerprint,memories:candidateMemoryCount(db,item.chatId),
  }));
  db.prepare(`INSERT INTO chat_lineage(child_chat_id,kind,detection,status,counts_json,candidates_json,created_at)
    VALUES(?,'copy',?,'choice_required','{}',?,?) ON CONFLICT(child_chat_id) DO UPDATE SET detection=excluded.detection,candidates_json=excluded.candidates_json`)
    .run(request.chatId,detection,JSON.stringify(choices),Date.now());
}

export function chooseChatLineage(db: RcmDatabase, chatId: string, parentChatId: string, request: TurnPrepareRequest, fingerprint: string): ChatLineageStatus {
  const current = getChatLineage(db, chatId);
  const candidate = current.ambiguousCandidates?.find((item) => item.chatId === parentChatId);
  if (!candidate) throw new Error("Lineage candidate not found");
  const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as any;
  if (activeJobCount(db,chatId) || Object.values(derivedCounts(db,chatId)).some(count => count > 0)) throw new Error('TARGET_HAS_DERIVED_DATA');
  const resolution = resolveCandidates(db, request);
  if (request.chatId !== chatId || request.characterId !== chat.character_id) throw new Error('LINEAGE_PROBE_STALE');
  if (fingerprint !== candidate.fingerprint
      || fingerprint !== probeFingerprint(db, request, resolution)
      || !resolution.candidates.some(item => item.chatId === parentChatId)) {
      saveLineageChoices(db,request,resolution);
      throw new Error('LINEAGE_PROBE_STALE');
  }
  db.transaction(() => {
    db.prepare("DELETE FROM chat_lineage WHERE child_chat_id=?").run(chatId);
    cloneLineage(db, request, { ...candidate, firstSharedOrdinal: candidate.firstSharedOrdinal ?? 0, forkMessageId: candidate.forkMessageId!, forkOrdinal: (db.prepare("SELECT ordinal FROM messages WHERE chat_id=? AND message_id=?").get(parentChatId, candidate.forkMessageId) as { ordinal: number }).ordinal }, candidate.kind ?? "copy", "user");
  })();
  return getChatLineage(db, chatId);
}

export function declineChatLineage(db: RcmDatabase, chatId: string, fingerprint: string): ChatLineageStatus {
  const current = getChatLineage(db, chatId);
  if (current.status !== "choice_required" && current.status !== "ambiguous") throw new Error("LINEAGE_CHOICE_NOT_PENDING");
  const expected = current.ambiguousCandidates?.[0]?.fingerprint;
  if (!expected || expected !== fingerprint) throw new Error("LINEAGE_PROBE_STALE");
  db.prepare("UPDATE chat_lineage SET status='independent',parent_chat_id=NULL,parent_title=NULL,applied_at=? WHERE child_chat_id=?").run(Date.now(), chatId);
  return getChatLineage(db, chatId);
}

/** Build an internal, isolated replay target with confirmed state through the ordinal before the cut. */
export function createRegenerationShadow(db: RcmDatabase, sourceChatId: string, shadowChatId: string, cutOrdinal: number): void {
  const source = db.prepare("SELECT * FROM chats WHERE id=?").get(sourceChatId) as any;
  if (!source) throw new Error("Source chat not found");
  const forkOrdinal = cutOrdinal - 1;
  const prefix = db.prepare(`SELECT message_id AS id,ordinal,host_visibility AS visibility,role,content_hash AS contentHash,
    source_record_id AS sourceRecordId,display_content_hash AS displayContentHash,display_comparison_hash AS displayComparisonHash
    FROM messages WHERE chat_id=? AND ordinal<=? ORDER BY ordinal`).all(sourceChatId, forkOrdinal) as TurnPrepareRequest["messageVisibility"];
  const request: TurnPrepareRequest = {
    chatId: shadowChatId,
    chatTitle: `[internal regeneration] ${source.chat_title ?? sourceChatId}`,
    characterId: source.character_id,
    profile: source.profile,
    messages: [],
    messageVisibility: prefix,
    query: "",
    perspectives: [],
    tokenBudget: 0,
    includeUserMessages: source.include_user_messages !== 0,
    extractionGroupTurns: source.extraction_group_turns,
    memoryLanguage: source.memory_language,
    forceBackfill: false,
    deferExtraction: false,
  };
  cloneLineage(db, request, {
    chatId: sourceChatId,
    title: source.chat_title ?? sourceChatId,
    forkMessageId: prefix?.at(-1)?.id ?? "",
    forkOrdinal,
    firstSharedOrdinal: prefix?.[0]?.ordinal ?? 0,
    sharedMessages: prefix?.length ?? 0,
  }, "branch", "user", {preserveUserCorrections:true, skipQuizzes:true});
  // A replay shadow must preserve the source setup inventory, including absence.
  if (!db.prepare("SELECT 1 FROM initial_calibrations WHERE chat_id=?").get(sourceChatId)) {
    db.prepare("DELETE FROM initial_calibrations WHERE chat_id=?").run(shadowChatId);
  }
  const suffix = db.prepare("SELECT * FROM messages WHERE chat_id=? AND ordinal>=? AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before') ORDER BY ordinal").all(sourceChatId, cutOrdinal) as any[];
  const insert = db.prepare(`INSERT INTO messages(chat_id,message_id,role,ordinal,content,content_hash,canonical_content,canonical_hash,lifecycle,visible,event_time,generation_id,source_kind,source_record_id,display_content_hash,display_comparison_hash,host_visibility,extraction_state,completed_turn_seq,memory_excluded,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const timestamp = Date.now();
  for (const row of suffix) insert.run(shadowChatId, row.message_id, row.role, row.ordinal, row.content, row.content_hash, row.canonical_content, row.canonical_hash, row.lifecycle, row.visible, row.event_time, row.generation_id, row.source_kind, row.source_record_id, row.display_content_hash, row.display_comparison_hash, row.host_visibility, "pending", row.completed_turn_seq, isOrdinalFallbackMessageId(sourceChatId,row.message_id) || isOrdinalFallbackMessageId(shadowChatId,row.message_id) ? 0 : row.memory_excluded, timestamp);
  db.prepare("UPDATE chats SET is_internal=1,post_extraction_review=?,updated_at=? WHERE id=?").run(source.post_extraction_review, timestamp, shadowChatId);
}

export function revertChatLineage(db: RcmDatabase, chatId: string): void {
  const row = lineageRow(db, chatId);
  if (!row || row.status !== "inherited") return;
  db.transaction(() => {
    db.prepare("DELETE FROM quiz_items WHERE chat_id=?").run(chatId);
    db.prepare("DELETE FROM quiz_state WHERE chat_id=?").run(chatId);
    // Source messages survive; every derived table is rebuilt from the current
    // PocketRisu snapshot after this operation.
    const vectorRows = db.prepare("SELECT rowid FROM embedding_items WHERE chat_id=?").all(chatId) as Array<{ rowid: number }>;
    if (vectorRows.length) try { db.prepare(`DELETE FROM embedding_vectors_v4_chat WHERE rowid IN (${vectorRows.map(() => "?").join(",")})`).run(...vectorRows.map((row) => BigInt(row.rowid))); } catch { /* sqlite-vec unavailable */ }
    deleteDerivedRows(db, chatId);
    db.prepare(`
      DELETE FROM messages WHERE chat_id=? AND lifecycle='client_pruned' AND message_id IN(
        SELECT child_item_id FROM chat_lineage_items WHERE child_chat_id=? AND item_kind='message'
      )
    `).run(chatId, chatId);
    db.prepare("UPDATE messages SET extraction_state=CASE WHEN lifecycle='committed' AND host_visibility IN ('active','all_before') THEN 'pending' ELSE 'blocked' END WHERE chat_id=?").run(chatId);
    db.prepare("UPDATE chats SET ingestion_state='managed',revision=revision+1,updated_at=? WHERE id=?").run(Date.now(), chatId);
    db.prepare("UPDATE chat_lineage SET status='reverted',reverted_at=? WHERE child_chat_id=?").run(Date.now(), chatId);
    db.prepare("DELETE FROM chat_lineage_items WHERE child_chat_id=?").run(chatId);
  })();
}

export function acknowledgeChatLineage(db: RcmDatabase, chatId: string): ChatLineageStatus {
  const result = db.prepare("UPDATE chat_lineage SET acknowledged_at=? WHERE child_chat_id=? AND status='inherited'").run(Date.now(), chatId);
  if (result.changes !== 1) throw new Error("Inherited lineage not found");
  return getChatLineage(db, chatId);
}
