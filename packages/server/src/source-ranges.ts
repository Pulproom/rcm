import { createHash } from "node:crypto";
import { publicKnowledgeScope } from "./item-access.js";
import { estimateTokens } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { editProtectedMessageIds } from "./jobs.js";
import { fingerprintMatches, parseSourceFingerprintJson } from "./source-fingerprint.js";
import { stripThoughtBlocks } from "./source-text.js";

interface Batch {
  id: string; job_id: string | null; status: string; start_ordinal: number; end_ordinal: number;
  source_message_ids_json: string; source_fingerprint_json: string;
}
export interface RangeMessage {
  id: string; ordinal: number; role: string; content: string | null; canonicalHash: string;
  lifecycle: string; visibility: string; extractionState: string;
}
export interface SourceRange {
  id: string; startOrdinal: number; endOrdinal: number; sourceMessageIds: string[];
  status: string; eligible: boolean; reason: string | null; excerpt: string;
  rawTokens: number; memoryIds: string[]; groupIds: string[];
}
const failure = (message: string, code = "RANGE_NOT_ELIGIBLE") => Object.assign(new Error(message), { code });

export function rangeMessages(db: RcmDatabase, chatId: string): RangeMessage[] {
  return db.prepare(`SELECT message_id AS id,ordinal,role,
    CASE WHEN canonical_hash<>'' THEN canonical_content ELSE content END AS content,
    CASE WHEN canonical_hash<>'' THEN canonical_hash ELSE content_hash END AS canonicalHash,
    lifecycle,host_visibility AS visibility,extraction_state AS extractionState
    FROM messages WHERE chat_id=? ORDER BY ordinal,message_id`).all(chatId) as RangeMessage[];
}

/** Selection uses existing batch IDs. Display ordinals never define membership. */
export function listSourceRanges(db: RcmDatabase, chatId: string): SourceRange[] {
  const chat = db.prepare("SELECT edit_protection_turns FROM chats WHERE id=?").get(chatId) as { edit_protection_turns: number } | undefined;
  if (!chat) throw failure("Chat not found", "CHAT_NOT_FOUND");
  const protectedIds = editProtectedMessageIds(db, chatId, chat.edit_protection_turns);
  const messages = new Map(rangeMessages(db, chatId).map((row) => [row.id, row]));
  const batches = db.prepare(`SELECT id,job_id,status,start_ordinal,end_ordinal,source_message_ids_json,source_fingerprint_json
    FROM extraction_batches WHERE chat_id=? AND generation_id='active' AND status<>'superseded'
    ORDER BY start_ordinal,end_ordinal,id`).all(chatId) as Batch[];
  const memories = db.prepare("SELECT id,source_batch_id,evidence_json FROM memories WHERE chat_id=? AND active=1").all(chatId) as Array<{ id: string; source_batch_id: string; evidence_json: string }>;
  const relatedEvidence = new Map<string, Set<string>>();
  for (const memory of memories) relatedEvidence.set(memory.id, new Set((JSON.parse(memory.evidence_json) as Array<{ messageId: string }>).map((item) => item.messageId)));
  for (const row of db.prepare("SELECT memory_id,evidence_json FROM memory_details WHERE chat_id=? AND active=1").all(chatId) as Array<{ memory_id: string; evidence_json: string }>) {
    for (const item of JSON.parse(row.evidence_json) as Array<{ messageId: string }>) relatedEvidence.get(row.memory_id)?.add(item.messageId);
  }
  for (const row of db.prepare("SELECT memory_id,evidence_json FROM memory_dialogues WHERE chat_id=?").all(chatId) as Array<{ memory_id: string; evidence_json: string }>) {
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
    else if (batches.some((other) => other.id !== row.id && other.start_ordinal <= row.end_ordinal && other.end_ordinal >= row.start_ordinal)) reason = "겹치는 처리 구간을 먼저 확인해야 해요";
    else if (groupIds.length) reason = "이미 묶인 구간이에요. 먼저 묶기를 해제해 주세요";
    return { id: row.id, startOrdinal: row.start_ordinal, endOrdinal: row.end_ordinal,
      sourceMessageIds: ids, status: row.status, eligible: !reason, reason,
      excerpt: source.filter(Boolean).map((item) => stripThoughtBlocks(item!.content ?? "")).join(" ").replace(/\s+/g, " ").slice(0, 160),
      rawTokens: source.reduce((sum, item) => sum + estimateTokens(stripThoughtBlocks(item?.content ?? "")), 0),
      memoryIds: memories.filter((memory) => memory.source_batch_id === row.id || [...relatedEvidence.get(memory.id)!].some((id) => ids.includes(id))).map((memory) => memory.id), groupIds };
  });
  const covered = new Set(ranges.flatMap((row) => row.sourceMessageIds));
  for (const message of messages.values()) {
    if (covered.has(message.id) || !['active', 'all_before'].includes(message.visibility) || message.extractionState === 'skipped_policy') continue;
    ranges.push({ id: `unprocessed:${message.id}`, startOrdinal: message.ordinal, endOrdinal: message.ordinal,
      sourceMessageIds: [message.id], status: message.extractionState, eligible: false,
      reason: message.lifecycle === 'pending' ? '새 응답이 아직 확정되지 않았어요'
        : protectedIds.has(message.id) ? '아직 수정 보호 중인 구간이에요' : '기억 처리가 끝나지 않았어요',
      excerpt: stripThoughtBlocks(message.content ?? '').replace(/\s+/g, ' ').slice(0,160), rawTokens: estimateTokens(stripThoughtBlocks(message.content ?? '')), memoryIds: [], groupIds: [] });
  }
  return ranges.sort((left, right) => left.startOrdinal - right.startOrdinal || left.id.localeCompare(right.id));
}

export function selectSourceRanges(db: RcmDatabase, chatId: string, batchIds: string[], minimum = 1): SourceRange[] {
  if (batchIds.length < minimum || new Set(batchIds).size !== batchIds.length) throw failure("서로 다른 원문 묶음을 선택해 주세요", "INVALID_RANGE_SELECTION");
  const all = listSourceRanges(db, chatId);
  const selected = all.filter((row) => batchIds.includes(row.id));
  if (selected.length !== batchIds.length) throw failure("선택한 원문 묶음이 바뀌었어요", "SOURCE_CHANGED");
  for (const row of selected) if (!row.eligible) throw failure(row.reason!);
  const first = all.indexOf(selected[0]!);
  if (all.indexOf(selected.at(-1)!) - first + 1 !== selected.length) throw failure("중간을 건너뛰지 않고 연속된 묶음을 선택해 주세요", "NONCONTIGUOUS_SELECTION");
  const ids = new Set(selected.flatMap((row) => row.sourceMessageIds));
  // A missing/unprocessed message between batches is not an implicit selection.
  const start = selected[0]!.startOrdinal, end = selected.at(-1)!.endOrdinal;
  if (rangeMessages(db, chatId).some((row) => row.ordinal >= start && row.ordinal <= end && !ids.has(row.id)
    && ['active', 'all_before'].includes(row.visibility) && row.extractionState !== 'skipped_policy')) {
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
  const rows = db.prepare("SELECT id,memory_key AS key,title,content,known_by_json,source_batch_id,user_managed AS userManaged FROM memories WHERE chat_id=? AND active=1 ORDER BY created_at,id").all(chatId) as any[];
  return rows.filter((row) => batchIds.includes(row.source_batch_id)).map((row) => ({ ...row,
    known_by_json: JSON.stringify(publicKnowledgeScope(JSON.parse(row.known_by_json)).knownBy), ...publicKnowledgeScope(JSON.parse(row.known_by_json)),
    details: db.prepare("SELECT id,detail_key AS key,kind,text FROM memory_details WHERE memory_id=? AND active=1 ORDER BY created_at,id").all(row.id),
    keyDialogues: (db.prepare("SELECT id,speaker,text,message_id AS messageId,evidence_json FROM memory_dialogues WHERE memory_id=? ORDER BY ordinal,id").all(row.id) as any[])
      .map(dialogue => ({...dialogue,evidence:JSON.parse(dialogue.evidence_json),evidence_json:undefined})) }));
}
