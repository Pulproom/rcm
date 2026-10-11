import { randomUUID } from "node:crypto";
import { estimateTokens, type EpisodeRangeAction, type RpProfile } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { deactivateDerivedMemories } from "./host-visibility.js";
import { stripThoughtBlocks } from "./source-text.js";
import { sourceFingerprint } from "./source-fingerprint.js";

interface EpisodeMessage {
  message_id: string;
  role: string;
  ordinal: number;
  content: string;
}

export interface EpisodeTurn {
  index: number;
  startMessageId: string;
  endMessageId: string;
  startOrdinal: number;
  endOrdinal: number;
  messageIds: string[];
  tokens: number;
  excerpt: string;
}

export function completedEpisodeTurns(messages: EpisodeMessage[]): EpisodeTurn[] {
  const groups: EpisodeMessage[][] = [];
  let users: EpisodeMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      users.push(message);
      continue;
    }
    if (message.role !== "assistant") continue;
    groups.push(users.length ? [...users, message] : [message]);
    users = [];
  }
  return groups.map((group, index) => ({
    index,
    startMessageId: group[0]!.message_id,
    endMessageId: group.at(-1)!.message_id,
    startOrdinal: group[0]!.ordinal,
    endOrdinal: group.at(-1)!.ordinal,
    messageIds: group.map((message) => message.message_id),
    tokens: group.reduce((sum, message) => sum + estimateTokens(stripThoughtBlocks(message.content)), 0),
    excerpt: stripThoughtBlocks(group.map((message) => `${message.role}: ${message.content}`).join("\n")).replace(/\s+/g, " ").slice(0, 180),
  }));
}

function activeMessages(db: RcmDatabase, chatId: string): EpisodeMessage[] {
  return db.prepare(`
    SELECT message_id,role,ordinal,content FROM messages
    WHERE chat_id=? AND lifecycle='committed' AND host_visibility IN ('active','all_before') AND content IS NOT NULL
    ORDER BY ordinal
  `).all(chatId) as EpisodeMessage[];
}

function activeEpisode(db: RcmDatabase, chatId: string): any | undefined {
  return db.prepare(`
    SELECT * FROM episodes WHERE chat_id=? AND resolution IS NOT 'group' AND status IN ('holding','queued','processing','failed')
    ORDER BY created_at DESC LIMIT 1
  `).get(chatId);
}

function cancelOverlappingQueuedJobs(db: RcmDatabase, chatId: string, sourceIds: Set<string>): void {
  const jobs = db.prepare("SELECT id,payload_json FROM jobs WHERE chat_id=? AND type='extract' AND status IN ('queued','failed')").all(chatId) as Array<{ id: string; payload_json: string }>;
  for (const job of jobs) {
    let ids: string[] = [];
    try { ids = (JSON.parse(job.payload_json) as { sourceMessageIds?: string[] }).sourceMessageIds ?? []; }
    catch { continue; }
    if (!ids.some((id) => sourceIds.has(id))) continue;
    db.prepare("DELETE FROM jobs WHERE id=?").run(job.id);
    for (const id of ids) {
      db.prepare(`UPDATE messages SET extraction_state=CASE WHEN ? THEN 'held' ELSE 'pending' END,updated_at=? WHERE chat_id=? AND message_id=? AND host_visibility IN ('active','all_before') AND lifecycle='committed'`)
        .run(sourceIds.has(id) ? 1 : 0, now(), chatId, id);
    }
  }
}

export function syncEpisodeMembership(db: RcmDatabase, chatId: string): void {
  const episode = db.prepare("SELECT id,start_ordinal FROM episodes WHERE chat_id=? AND status='holding' ORDER BY created_at DESC LIMIT 1").get(chatId) as
    | { id: string; start_ordinal: number }
    | undefined;
  if (!episode) return;
  const turns = completedEpisodeTurns(activeMessages(db, chatId)).filter((turn) => turn.startOrdinal >= episode.start_ordinal);
  const ids = new Set(turns.flatMap((turn) => turn.messageIds));
  db.transaction(() => {
    db.prepare("DELETE FROM episode_messages WHERE episode_id=?").run(episode.id);
    const insert = db.prepare("INSERT INTO episode_messages(episode_id,chat_id,message_id,ordinal,turn_index) VALUES(?,?,?,?,?)");
    for (const turn of turns) {
      for (const messageId of turn.messageIds) {
        const message = db.prepare("SELECT ordinal FROM messages WHERE chat_id=? AND message_id=?").get(chatId, messageId) as { ordinal: number };
        insert.run(episode.id, chatId, messageId, message.ordinal, turn.index);
      }
    }
    if (ids.size > 0) {
      const placeholders = [...ids].map(() => "?").join(",");
      db.prepare(`UPDATE messages SET extraction_state='held',updated_at=? WHERE chat_id=? AND message_id IN (${placeholders})`).run(now(), chatId, ...ids);
    }
    cancelOverlappingQueuedJobs(db, chatId, ids);
    const sourceTokens = turns.reduce((sum, turn) => sum + turn.tokens, 0);
    const endOrdinal = turns.at(-1)?.endOrdinal ?? null;
    db.prepare("UPDATE episodes SET end_ordinal=?,source_tokens=?,updated_at=? WHERE id=?").run(endOrdinal, sourceTokens, now(), episode.id);
  })();
}

function affectedMemoryCounts(db: RcmDatabase, chatId: string, messageIds: string[]): { contained: number; boundary: number; containedIds: string[] } {
  const selected = new Set(messageIds);
  const rows = db.prepare(`
    SELECT memory_id,message_id FROM evidence_spans WHERE chat_id=? AND memory_id IS NOT NULL
  `).all(chatId) as Array<{ memory_id: string; message_id: string }>;
  const byMemory = new Map<string, string[]>();
  for (const row of rows) byMemory.set(row.memory_id, [...(byMemory.get(row.memory_id) ?? []), row.message_id]);
  const containedIds: string[] = [];
  let boundary = 0;
  for (const [memoryId, evidence] of byMemory) {
    const inside = evidence.some((id) => selected.has(id));
    if (!inside) continue;
    if (evidence.every((id) => selected.has(id))) containedIds.push(memoryId);
    else boundary += 1;
  }
  return { contained: containedIds.length, boundary, containedIds };
}

export function staleTranscriptBlocks(db: RcmDatabase, chatId: string, messageIds: string[]): void {
  const selected = new Set(messageIds);
  const blocks = db.prepare("SELECT id,message_ids_json FROM embedding_blocks WHERE chat_id=? AND status<>'stale'")
    .all(chatId) as Array<{ id: string; message_ids_json: string }>;
  for (const block of blocks) {
    let blockIds: string[] = [];
    try { blockIds = JSON.parse(block.message_ids_json) as string[]; } catch { continue; }
    if (!blockIds.some((id) => selected.has(id))) continue;
    db.prepare("UPDATE embedding_blocks SET status='stale',updated_at=? WHERE id=?").run(now(), block.id);
    db.prepare("DELETE FROM embedding_items WHERE block_id=?").run(block.id);
  }
}

export function episodeOverview(db: RcmDatabase, chatId: string): Record<string, unknown> {
  syncEpisodeMembership(db, chatId);
  const episode = activeEpisode(db, chatId);
  const turns = completedEpisodeTurns(activeMessages(db, chatId));
  const recentTurns = turns.slice(-20).reverse();
  if (!episode) return { active: null, recentTurns };
  const linked = db.prepare("SELECT message_id FROM episode_messages WHERE episode_id=? ORDER BY ordinal").all(episode.id) as Array<{ message_id: string }>;
  const messageIds = linked.map((row) => row.message_id);
  return {
    active: {
      id: episode.id,
      status: episode.status,
      startOrdinal: episode.start_ordinal,
      endOrdinal: episode.end_ordinal,
      sourceTokens: episode.source_tokens,
      resolution: episode.resolution,
      lastError: episode.last_error,
      messageCount: messageIds.length,
      turnCount: new Set((db.prepare("SELECT turn_index FROM episode_messages WHERE episode_id=?").all(episode.id) as Array<{ turn_index: number }>).map((row) => row.turn_index)).size,
      affected: affectedMemoryCounts(db, chatId, messageIds),
    },
    recentTurns,
  };
}

export function previewEpisodeStart(db: RcmDatabase, chatId: string, startMessageId?: string): Record<string, unknown> {
  const messages = activeMessages(db, chatId);
  const turns = completedEpisodeTurns(messages);
  let selected: EpisodeTurn[];
  if (startMessageId) {
    const start = turns.find((turn) => turn.messageIds.includes(startMessageId));
    if (!start) throw Object.assign(new Error("완료된 턴에서 시작점을 찾을 수 없습니다."), { code: "EPISODE_START_NOT_FOUND" });
    selected = turns.filter((turn) => turn.startOrdinal >= start.startOrdinal);
  } else selected = [];
  const messageIds = selected.flatMap((turn) => turn.messageIds);
  const lastCompletedOrdinal = turns.at(-1)?.endOrdinal ?? -1;
  const trailingUser = messages.find((message) => message.ordinal > lastCompletedOrdinal && message.role === "user");
  return {
    startOrdinal: selected[0]?.startOrdinal ?? trailingUser?.ordinal ?? ((messages.at(-1)?.ordinal ?? -1) + 1),
    endOrdinal: selected.at(-1)?.endOrdinal,
    turnCount: selected.length,
    messageCount: messageIds.length,
    sourceTokens: selected.reduce((sum, turn) => sum + turn.tokens, 0),
    affected: affectedMemoryCounts(db, chatId, messageIds),
  };
}

export function startEpisodeHold(db: RcmDatabase, chatId: string, startMessageId?: string): string {
  if (activeEpisode(db, chatId)) throw Object.assign(new Error("이 채팅에는 이미 진행 중인 기억 보류가 있습니다."), { code: "EPISODE_ALREADY_ACTIVE" });
  const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
  if (!chat) throw Object.assign(new Error("Chat not found"), { code: "CHAT_NOT_FOUND" });
  const preview = previewEpisodeStart(db, chatId, startMessageId) as { startOrdinal: number };
  const id = randomUUID();
  const timestamp = now();
  db.prepare(`
    INSERT INTO episodes(id,chat_id,title,summary,start_revision,end_revision,status,start_ordinal,end_ordinal,source_tokens,resolution,memory_id,last_error,created_at,updated_at)
    VALUES(?,?, '', '', ?,NULL,'holding',?,NULL,0,NULL,NULL,NULL,?,?)
  `).run(id, chatId, chat.revision, preview.startOrdinal, timestamp, timestamp);
  syncEpisodeMembership(db, chatId);
  return id;
}

export function changeEpisodeStart(db: RcmDatabase, chatId: string, episodeId: string, startMessageId?: string): void {
  const episode = db.prepare("SELECT status FROM episodes WHERE id=? AND chat_id=?").get(episodeId, chatId) as { status: string } | undefined;
  if (!episode || episode.status !== "holding") throw Object.assign(new Error("진행 중인 기억 보류만 시작점을 바꿀 수 있습니다."), { code: "EPISODE_NOT_HOLDING" });
  const oldIds = (db.prepare("SELECT message_id FROM episode_messages WHERE episode_id=?").all(episodeId) as Array<{ message_id: string }>).map((row) => row.message_id);
  const preview = previewEpisodeStart(db, chatId, startMessageId) as { startOrdinal: number };
  db.transaction(() => {
    db.prepare("UPDATE episodes SET start_ordinal=?,updated_at=? WHERE id=?").run(preview.startOrdinal, now(), episodeId);
    db.prepare("DELETE FROM episode_messages WHERE episode_id=?").run(episodeId);
    for (const id of oldIds) db.prepare("UPDATE messages SET extraction_state='pending',updated_at=? WHERE chat_id=? AND message_id=? AND extraction_state='held'").run(now(), chatId, id);
  })();
  syncEpisodeMembership(db, chatId);
}

function queueEpisodeJob(db: RcmDatabase, chatId: string, episodeId: string): void {
  const sourceMessageIds = (db.prepare("SELECT message_id FROM episode_messages WHERE episode_id=? ORDER BY ordinal").all(episodeId) as Array<{ message_id: string }>).map((row) => row.message_id);
  if (sourceMessageIds.length === 0) throw Object.assign(new Error("정리할 완료 턴이 없습니다."), { code: "EPISODE_EMPTY" });
  db.prepare("INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'episode','queued',?,0,?,?)")
    .run(randomUUID(), chatId, JSON.stringify({ episodeId, sourceMessageIds, sourceFingerprint: sourceFingerprint(db, chatId, sourceMessageIds) }), now(), now());
  db.prepare("UPDATE episodes SET status='queued',resolution='capsule',last_error=NULL,updated_at=? WHERE id=?").run(now(), episodeId);
}

export function closeEpisodeHold(db: RcmDatabase, chatId: string, episodeId: string, action: EpisodeRangeAction): void {
  syncEpisodeMembership(db, chatId);
  const episode = db.prepare("SELECT status FROM episodes WHERE id=? AND chat_id=?").get(episodeId, chatId) as { status: string } | undefined;
  if (!episode || !["holding", "failed"].includes(episode.status)) throw Object.assign(new Error("종료할 기억 보류가 없습니다."), { code: "EPISODE_NOT_ACTIVE" });
  const sourceIds = (db.prepare("SELECT message_id FROM episode_messages WHERE episode_id=? ORDER BY ordinal").all(episodeId) as Array<{ message_id: string }>).map((row) => row.message_id);
  if (action === "capsule") {
    queueEpisodeJob(db, chatId, episodeId);
    return;
  }
  const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number };
  const affected = affectedMemoryCounts(db, chatId, sourceIds);
  db.transaction(() => {
    const state = action === "normal" ? "pending" : "excluded_episode";
    for (const id of sourceIds) db.prepare("UPDATE messages SET extraction_state=?,updated_at=? WHERE chat_id=? AND message_id=?").run(state, now(), chatId, id);
    if (action === "exclude") {
      deactivateDerivedMemories(db, chatId, affected.containedIds, chat.revision + 1);
      staleTranscriptBlocks(db, chatId, sourceIds);
    }
    db.prepare("UPDATE episodes SET status=?,resolution=?,end_revision=?,updated_at=? WHERE id=?")
      .run(action === "normal" ? "normal" : "excluded", action, chat.revision, now(), episodeId);
  })();
}

export function retryEpisode(db: RcmDatabase, chatId: string, episodeId: string): void {
  const episode = db.prepare("SELECT status FROM episodes WHERE id=? AND chat_id=?").get(episodeId, chatId) as { status: string } | undefined;
  if (!episode || episode.status !== "failed") throw Object.assign(new Error("실패한 캡슐만 다시 시도할 수 있습니다."), { code: "EPISODE_NOT_FAILED" });
  queueEpisodeJob(db, chatId, episodeId);
}

export function episodeProfile(db: RcmDatabase, chatId: string): RpProfile {
  return (db.prepare("SELECT profile FROM chats WHERE id=?").get(chatId) as { profile: RpProfile }).profile;
}

export function releaseManualEpisode(db: RcmDatabase, chatId: string, episodeId: string): void {
  const episode = db.prepare("SELECT id FROM episodes WHERE id=? AND chat_id=? AND resolution IS NOT 'group' AND status IN ('holding','queued','processing','failed')").get(episodeId, chatId);
  if (!episode) throw new Error('해제할 수동 보류가 없어');
  const jobs = db.prepare("SELECT id,payload_json FROM jobs WHERE chat_id=? AND type='episode' AND json_extract(payload_json,'$.episodeId')=?").all(chatId, episodeId) as Array<{ id: string; payload_json: string }>;
  if (jobs.some((job) => JSON.parse(job.payload_json).batchId)) throw new Error('자동 초장문 처리 작업은 수동 보류가 아니야');
  db.transaction(() => {
    for (const job of jobs) db.prepare("UPDATE jobs SET status='superseded',lease_owner=NULL,leased_until=NULL,updated_at=? WHERE id=?").run(now(), job.id);
    db.prepare(`UPDATE messages SET extraction_state=CASE WHEN EXISTS(
      SELECT 1 FROM extraction_batches b,json_each(b.source_message_ids_json) source
      WHERE b.chat_id=messages.chat_id AND b.generation_id='active' AND b.status='applied' AND source.value=messages.message_id)
      THEN 'done' ELSE 'pending' END,updated_at=?
      WHERE chat_id=? AND extraction_state='held' AND message_id IN (SELECT message_id FROM episode_messages WHERE episode_id=?)`).run(now(), chatId, episodeId);
    db.prepare("UPDATE episodes SET status='normal',resolution='normal',updated_at=? WHERE id=?").run(now(), episodeId);
  })();
}
