import { createHash } from "node:crypto";
import { publicKnowledgeScope } from "./item-access.js";
import { estimateTokens } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { editProtectedMessageIds } from "./jobs.js";
import { fingerprintMatches, isOrdinalFallbackMessageId, parseSourceFingerprintJson } from "./source-fingerprint.js";
import { stripThoughtBlocks } from "./source-text.js";

interface Batch {
  id: string; job_id: string | null; status: string; start_ordinal: number; end_ordinal: number;
  source_message_ids_json: string; source_fingerprint_json: string;
}
export interface RangeMessage {
  id: string; ordinal: number; role: string; content: string | null; canonicalHash: string;
  lifecycle: string; visibility: string; extractionState: string;
  memoryExcluded: number;
}
export interface SourceRange {
  id: string; startOrdinal: number; endOrdinal: number; sourceMessageIds: string[];
  status: string; eligible: boolean; reason: string | null; excerpt: string;
  rawTokens: number; memoryIds: string[]; groupIds: string[];
  memoryExcluded: boolean; canExclude: boolean; exclusionReason: string | null;
  selectable?: boolean;
}
const failure = (message: string, code = "RANGE_NOT_ELIGIBLE") => Object.assign(new Error(message), { code });
const isCurrentRangeMessage = (message: RangeMessage): boolean =>
  ['pending', 'committed', 'client_pruned'].includes(message.lifecycle)
  && ['active', 'all_before'].includes(message.visibility) && message.extractionState !== 'skipped_policy';

export function rangeMessages(db: RcmDatabase, chatId: string, messageIds?: string[]): RangeMessage[] {
  return db.prepare(`SELECT message_id AS id,ordinal,role,
    CASE WHEN canonical_hash<>'' THEN canonical_content ELSE content END AS content,
    CASE WHEN canonical_hash<>'' THEN canonical_hash ELSE content_hash END AS canonicalHash,
    lifecycle,host_visibility AS visibility,extraction_state AS extractionState,memory_excluded AS memoryExcluded
    FROM messages WHERE chat_id=? ${messageIds === undefined ? '' : 'AND message_id IN (SELECT value FROM json_each(?))'}
    ORDER BY ordinal,message_id`).all(chatId, ...(messageIds === undefined ? [] : [JSON.stringify(messageIds)])) as RangeMessage[];
}

/** Only stable host IDs on untouched, unprocessed rows can be excluded. */
export function memoryExclusionReason(db: RcmDatabase, chatId: string, message: RangeMessage): string | null {
  if (message.memoryExcluded) return null;
  // The host fallback owns ordinal syntax, not persistent message identity.
  if (isOrdinalFallbackMessageId(chatId,message.id)) return '고정 메시지 ID가 없어 기억에서 제외할 수 없어요';
  if (!['pending', 'committed'].includes(message.lifecycle) || !['active', 'all_before'].includes(message.visibility) || message.content === null) return '원문을 사용할 수 없어요';
  if (!['blocked', 'pending'].includes(message.extractionState)) return '이미 기억 처리가 시작된 메시지예요';
  const evidenceTables = ['memories','memory_details','memory_dialogues','assertions','beliefs','promise_events',
    'relationship_events','physical_intimacy_milestones','social_knowledge_events','atom_relations'];
  if (db.prepare(`SELECT 1 FROM extraction_batches b,json_each(b.source_message_ids_json) s WHERE b.chat_id=? AND s.value=?
    UNION ALL SELECT 1 FROM jobs j,json_each(j.payload_json,'$.sourceMessageIds') s WHERE j.chat_id=? AND s.value=?
    UNION ALL SELECT 1 FROM episode_messages WHERE chat_id=? AND message_id=?
    UNION ALL SELECT 1 FROM evidence_spans WHERE chat_id=? AND message_id=?
    UNION ALL SELECT 1 FROM source_passages WHERE chat_id=? AND message_id=?
    UNION ALL SELECT 1 FROM source_passages p,json_each(p.access_json) g,json_each(g.value,'$.evidence') e
      WHERE p.chat_id=? AND json_extract(e.value,'$.messageId')=?
    UNION ALL SELECT 1 FROM memory_recall_events r,json_each(r.evidence_json) e WHERE r.chat_id=? AND e.value=?
    ${evidenceTables.map(table => `UNION ALL SELECT 1 FROM ${table} t,json_each(t.evidence_json) e WHERE t.chat_id=? AND json_extract(e.value,'$.messageId')=?`).join('\n')}
    LIMIT 1`).get(...Array.from({length:7+evidenceTables.length},()=>[chatId,message.id]).flat())) return '이미 기억 처리가 시작된 메시지예요';
  return null;
}

export function setMemoryExclusion(db: RcmDatabase, chatId: string, messageId: string, excluded: boolean): { excluded: boolean } {
  return db.transaction(() => {
    const chat = db.prepare('SELECT id FROM chats WHERE id=?').get(chatId);
    const message = rangeMessages(db, chatId).find(row => row.id === messageId);
    if (!chat || !message) throw failure('메시지를 찾을 수 없어요', 'MESSAGE_NOT_FOUND');
    if (excluded) {
      const reason = memoryExclusionReason(db, chatId, message);
      if (reason) throw failure(reason, 'MEMORY_EXCLUSION_NOT_ELIGIBLE');
    }
    if (Boolean(message.memoryExcluded) !== excluded) {
      db.prepare('UPDATE messages SET memory_excluded=?,updated_at=? WHERE chat_id=? AND message_id=?').run(Number(excluded),Date.now(),chatId,messageId);
      db.prepare('UPDATE chats SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(),chatId);
    }
    return { excluded };
  })();
}

/** Selection uses existing batch IDs. Display ordinals never define membership. */
export function listSourceRanges(db: RcmDatabase, chatId: string, matchingMessageIds?: string[]): SourceRange[] {
  if (matchingMessageIds?.length === 0) return [];
  const chat = db.prepare("SELECT edit_protection_turns FROM chats WHERE id=?").get(chatId) as { edit_protection_turns: number } | undefined;
  if (!chat) throw failure("Chat not found", "CHAT_NOT_FOUND");
  const protectedIds = editProtectedMessageIds(db, chatId, chat.edit_protection_turns);
  const allBatches = db.prepare(`SELECT id,job_id,status,start_ordinal,end_ordinal,source_message_ids_json,source_fingerprint_json
    FROM extraction_batches WHERE chat_id=? AND generation_id='active' AND status<>'superseded'
    ORDER BY start_ordinal,end_ordinal,id`).all(chatId) as Batch[];
  const matching = matchingMessageIds === undefined ? undefined : new Set(matchingMessageIds);
  const batches = matching ? allBatches.filter(batch => (JSON.parse(batch.source_message_ids_json) as string[]).some(id => matching.has(id))) : allBatches;
  const sourceIds = matching ? [...new Set([...matching, ...batches.flatMap(batch => JSON.parse(batch.source_message_ids_json) as string[])])] : undefined;
  const messages = new Map(rangeMessages(db, chatId, sourceIds).map((row) => [row.id, row]));
  // Label the user inputs with their pending tail response, using the original
  // conversation boundaries even when a message is excluded from memory.
  const current = matching ? db.prepare(`SELECT message_id id,role,lifecycle FROM messages WHERE chat_id=?
    AND lifecycle IN ('pending','committed') AND host_visibility IN ('active','all_before') ORDER BY ordinal,message_id`).all(chatId) as Array<{id:string;role:string;lifecycle:string}>
    : [...messages.values()].filter(message => ['pending', 'committed'].includes(message.lifecycle) && ['active', 'all_before'].includes(message.visibility));
  const unconfirmedTurnIds = new Set<string>();
  if (current.at(-1)?.role === 'assistant' && current.at(-1)?.lifecycle === 'pending') {
    unconfirmedTurnIds.add(current.at(-1)!.id);
    for (let index = current.length - 2; index >= 0 && current[index]!.role !== 'assistant'; index -= 1) {
      if (current[index]!.role === 'user') unconfirmedTurnIds.add(current[index]!.id);
    }
  }
  const memories = db.prepare(`SELECT m.id,m.source_batch_id,m.evidence_json FROM memories m WHERE m.chat_id=? AND m.active=1
    ${matching ? `AND (m.source_batch_id IN (SELECT value FROM json_each(?)) OR EXISTS (
      SELECT 1 FROM json_each(m.evidence_json) e WHERE json_extract(e.value,'$.messageId') IN (SELECT value FROM json_each(?))) OR EXISTS (
      SELECT 1 FROM memory_details d,json_each(d.evidence_json) e WHERE d.memory_id=m.id AND d.active=1
        AND json_extract(e.value,'$.messageId') IN (SELECT value FROM json_each(?))) OR EXISTS (
      SELECT 1 FROM memory_dialogues d,json_each(d.evidence_json) e WHERE d.memory_id=m.id
        AND json_extract(e.value,'$.messageId') IN (SELECT value FROM json_each(?))))` : ''}`)
    .all(chatId, ...(matching ? [JSON.stringify(batches.map(batch => batch.id)), ...Array(3).fill(JSON.stringify(sourceIds))] : [])) as Array<{ id: string; source_batch_id: string; evidence_json: string }>;
  const relatedEvidence = new Map<string, Set<string>>();
  for (const memory of memories) relatedEvidence.set(memory.id, new Set((JSON.parse(memory.evidence_json) as Array<{ messageId: string }>).map((item) => item.messageId)));
  const memoryFilter = matching ? 'AND memory_id IN (SELECT value FROM json_each(?))' : '';
  const memoryParams = matching ? [JSON.stringify(memories.map(memory => memory.id))] : [];
  for (const row of db.prepare(`SELECT memory_id,evidence_json FROM memory_details WHERE chat_id=? AND active=1 ${memoryFilter}`).all(chatId, ...memoryParams) as Array<{ memory_id: string; evidence_json: string }>) {
    for (const item of JSON.parse(row.evidence_json) as Array<{ messageId: string }>) relatedEvidence.get(row.memory_id)?.add(item.messageId);
  }
  for (const row of db.prepare(`SELECT memory_id,evidence_json FROM memory_dialogues WHERE chat_id=? ${memoryFilter}`).all(chatId, ...memoryParams) as Array<{ memory_id: string; evidence_json: string }>) {
    for (const item of JSON.parse(row.evidence_json) as Array<{messageId:string}>) relatedEvidence.get(row.memory_id)?.add(item.messageId);
  }
  const groups = db.prepare(`SELECT e.id,em.message_id FROM episodes e JOIN episode_messages em ON em.episode_id=e.id
    WHERE e.chat_id=? AND e.resolution='group' AND e.status='capsuled'`).all(chatId) as Array<{ id: string; message_id: string }>;
  const ranges: SourceRange[] = batches.map((row) => {
    const ids = JSON.parse(row.source_message_ids_json) as string[];
    const source = ids.map((id) => messages.get(id));
    const fingerprint = parseSourceFingerprintJson(row.source_fingerprint_json);
    const groupIds = [...new Set(groups.filter((group) => ids.includes(group.message_id)).map((group) => group.id))];
    let reason: string | null = null;
    if (!ids.length || source.some((item) => !item || item.content === null || !['active', 'all_before'].includes(item.visibility))) reason = "원문을 사용할 수 없어요";
    else if (source.some((item) => item!.lifecycle === 'pending')) reason = "새 응답이 아직 확정되지 않았어요";
    else if (source.some((item) => !['committed', 'client_pruned'].includes(item!.lifecycle))) reason = "원문을 사용할 수 없어요";
    else if (ids.some((id) => protectedIds.has(id))) reason = "아직 수정 보호 중인 구간이에요";
    else if (row.status !== "applied") reason = row.status === "pending_review" ? "필수 검수가 끝나지 않았어요" : "기억 처리가 끝나지 않았어요";
    else if (!fingerprint || !fingerprintMatches(db, chatId, fingerprint)) reason = "원문이 바뀌어 다시 확인해야 해요";
    else if (source.some((item) => !['done', 'encapsulated', 'skipped_policy'].includes(item!.extractionState))) reason = "원문 처리가 끝나지 않았어요";
    else if (allBatches.some((other) => other.id !== row.id && other.start_ordinal <= row.end_ordinal && other.end_ordinal >= row.start_ordinal)) reason = "겹치는 처리 구간을 먼저 확인해야 해요";
    else if (groupIds.length) reason = "이미 묶인 구간이에요. 먼저 묶기를 해제해 주세요";
    return { id: row.id, startOrdinal: row.start_ordinal, endOrdinal: row.end_ordinal,
      sourceMessageIds: ids, status: row.status, eligible: !reason, reason,
      memoryExcluded: false, canExclude: false, exclusionReason: '이미 기억 처리가 시작된 메시지예요',
      excerpt: source.filter(item => item && !item.memoryExcluded && isCurrentRangeMessage(item) && item.content !== null)
        .map(item => stripThoughtBlocks(item!.content!)).join(" ").replace(/\s+/g, " ").slice(0, 160),
      rawTokens: source.reduce((sum, item) => sum + estimateTokens(stripThoughtBlocks(item?.content ?? "")), 0),
      memoryIds: memories.filter((memory) => memory.source_batch_id === row.id || [...relatedEvidence.get(memory.id)!].some((id) => ids.includes(id))).map((memory) => memory.id), groupIds };
  });
  const covered = new Set(ranges.flatMap((row) => row.sourceMessageIds));
  for (const message of messages.values()) {
    if (covered.has(message.id) || !isCurrentRangeMessage(message) || matching && !matching.has(message.id)) continue;
    const exclusionReason = memoryExclusionReason(db,chatId,message);
    ranges.push({ id: `unprocessed:${message.id}`, startOrdinal: message.ordinal, endOrdinal: message.ordinal,
      sourceMessageIds: [message.id], status: message.extractionState, eligible: false,
      memoryExcluded: Boolean(message.memoryExcluded), canExclude: !exclusionReason,
      exclusionReason,
      reason: message.memoryExcluded ? '기억 제외됨' : message.lifecycle === 'pending' || unconfirmedTurnIds.has(message.id) ? '새 응답이 아직 확정되지 않았어요'
        : protectedIds.has(message.id) ? '아직 수정 보호 중인 구간이에요' : '기억 처리가 끝나지 않았어요',
      excerpt: stripThoughtBlocks(message.content ?? '').replace(/\s+/g, ' ').slice(0,160), rawTokens: estimateTokens(stripThoughtBlocks(message.content ?? '')), memoryIds: [], groupIds: [] });
  }
  return ranges.sort((left, right) => left.startOrdinal - right.startOrdinal || left.id.localeCompare(right.id)).map(range => ({ ...range,
    selectable: !range.memoryExcluded && range.sourceMessageIds.some(id => {
      const message = messages.get(id);
      return message && isCurrentRangeMessage(message) && message.content !== null;
    }) }));
}

export function selectSourceRanges(db: RcmDatabase, chatId: string, batchIds: string[], minimum = 1): SourceRange[] {
  if (batchIds.length < minimum || new Set(batchIds).size !== batchIds.length) throw failure("서로 다른 원문 묶음을 선택해 주세요", "INVALID_RANGE_SELECTION");
  const all = listSourceRanges(db, chatId).filter(row => !row.memoryExcluded);
  const selected = all.filter((row) => batchIds.includes(row.id));
  if (selected.length !== batchIds.length) throw failure("선택한 원문 묶음이 바뀌었어요", "SOURCE_CHANGED");
  for (const row of selected) if (!row.eligible) throw failure(row.reason!);
  const first = all.indexOf(selected[0]!);
  if (all.indexOf(selected.at(-1)!) - first + 1 !== selected.length) throw failure("중간을 건너뛰지 않고 연속된 묶음을 선택해 주세요", "NONCONTIGUOUS_SELECTION");
  const ids = new Set(selected.flatMap((row) => row.sourceMessageIds));
  // A missing/unprocessed message between batches is not an implicit selection.
  const start = selected[0]!.startOrdinal, end = selected.at(-1)!.endOrdinal;
  if (rangeMessages(db, chatId).some((row) => row.ordinal >= start && row.ordinal <= end && !ids.has(row.id)
    && !row.memoryExcluded && isCurrentRangeMessage(row))) {
    throw failure("선택 사이에 처리되지 않은 원문이 있어요", "NONCONTIGUOUS_SELECTION");
  }
  return selected;
}

/** Snapshot includes access and atom edits, not just raw revision. */
export function rangeTargetFingerprint(db: RcmDatabase, chatId: string, batchIds: string[]): string {
  const batches = batchIds.slice().sort().map((id) => db.prepare("SELECT * FROM extraction_batches WHERE id=? AND chat_id=?").get(id, chatId));
  const ids = [...new Set(listSourceRanges(db, chatId).filter((row) => batchIds.includes(row.id)).flatMap((row) => row.memoryIds))];
  return createHash("sha256").update(JSON.stringify({ batches, memories: memoryTargetFingerprint(db, chatId, ids), passages: sourceAccessFingerprint(db, chatId,
    batches.flatMap((batch: any) => batch ? JSON.parse(batch.source_message_ids_json) : [])) })).digest("hex");
}

export function memoryTargetFingerprint(db: RcmDatabase, chatId: string, memoryIds: string[]): string {
  const memories = (db.prepare(`SELECT id,memory_key,type,title,content,participants_json,known_by_json,perspective,
    story_time,story_time_normalized,locations_json,landmark,landmark_kinds_json,evidence_json,pinned,active,
    capsule_parent_id,retention_class,atom_access_version,source_batch_id,user_managed FROM memories WHERE chat_id=? ORDER BY id`).all(chatId) as Array<Record<string, any>>)
    .filter((row) => memoryIds.includes(row.id));
  const ids = new Set(memories.map((row) => row.id));
  const details = (db.prepare("SELECT * FROM memory_details WHERE chat_id=? ORDER BY id").all(chatId) as Array<Record<string, any>>).filter((row) => ids.has(row.memory_id));
  const dialogues = (db.prepare("SELECT * FROM memory_dialogues WHERE chat_id=? ORDER BY id").all(chatId) as Array<Record<string, any>>).filter((row) => ids.has(row.memory_id));
  const atoms = new Set([...details, ...dialogues].map((row) => row.id));
  const relations = (db.prepare("SELECT * FROM atom_relations WHERE chat_id=? ORDER BY id").all(chatId) as Array<Record<string, any>>)
    .filter((row) => atoms.has(row.source_detail_id) || atoms.has(row.target_detail_id));
  const relationIds = new Set(relations.map((row) => row.id));
  const access = (db.prepare("SELECT * FROM item_access WHERE chat_id=? ORDER BY id").all(chatId) as Array<Record<string, any>>)
    .filter((row) => atoms.has(row.item_id) || relationIds.has(row.item_id));
  const sourceIds = new Set([
    ...memories.flatMap((row) => (JSON.parse(row.evidence_json) as Array<{ messageId: string }>).map((item) => item.messageId)),
    ...dialogues.flatMap((row) => (JSON.parse(String(row.evidence_json)) as Array<{messageId:string}>).map(item=>item.messageId)),
    ...relations.flatMap((row) => (JSON.parse(row.evidence_json) as Array<{ messageId: string }>).map((item) => item.messageId)),
  ]);
  const passages = (db.prepare("SELECT * FROM source_passages WHERE chat_id=? ORDER BY id").all(chatId) as Array<Record<string, any>>).filter((row) => sourceIds.has(row.message_id));
  return createHash("sha256").update(JSON.stringify({ memories, details, dialogues, relations, access, passages })).digest("hex");
}

export function sourceAccessFingerprint(db: RcmDatabase, chatId: string, messageIds: string[]): string {
  const selected = new Set(messageIds);
  const passages = (db.prepare("SELECT * FROM source_passages WHERE chat_id=? ORDER BY id").all(chatId) as Array<{ message_id: string }>)
    .filter((row) => selected.has(row.message_id));
  return createHash("sha256").update(JSON.stringify(passages)).digest("hex");
}

/** Human comparison uses current canonical text, including manual edits. */
export function currentMemoryPreview(db: RcmDatabase, chatId: string, batchIds: string[]) {
  const sourceIds = new Set((db.prepare(`SELECT s.value id FROM extraction_batches b,json_each(b.source_message_ids_json) s
    WHERE b.chat_id=? AND b.id IN (SELECT value FROM json_each(?))`).all(chatId, JSON.stringify(batchIds)) as Array<{id:string}>).map(row => row.id));
  const rows = db.prepare("SELECT id,memory_key AS key,title,content,known_by_json,source_batch_id,evidence_json,user_managed AS userManaged FROM memories WHERE chat_id=? AND active=1 ORDER BY created_at,id").all(chatId) as any[];
  return rows.filter(row => {
    const evidence = [row, ...db.prepare('SELECT evidence_json FROM memory_details WHERE memory_id=? AND active=1').all(row.id),
      ...db.prepare('SELECT evidence_json FROM memory_dialogues WHERE memory_id=?').all(row.id)]
      .flatMap((item: any) => JSON.parse(item.evidence_json) as Array<{messageId:string}>);
    // Replacing only part of a spanning memory would lose its other sources.
    return evidence.length ? evidence.every(item => sourceIds.has(item.messageId)) : batchIds.includes(row.source_batch_id);
  }).map((row) => ({ ...row, evidence_json: undefined,
    known_by_json: JSON.stringify(publicKnowledgeScope(JSON.parse(row.known_by_json)).knownBy), ...publicKnowledgeScope(JSON.parse(row.known_by_json)),
    details: db.prepare("SELECT id,detail_key AS key,kind,text FROM memory_details WHERE memory_id=? AND active=1 ORDER BY created_at,id").all(row.id),
    keyDialogues: (db.prepare("SELECT id,speaker,text,message_id AS messageId,evidence_json FROM memory_dialogues WHERE memory_id=? ORDER BY ordinal,id").all(row.id) as any[])
      .map(dialogue => ({...dialogue,evidence:JSON.parse(dialogue.evidence_json),evidence_json:undefined})) }));
}
