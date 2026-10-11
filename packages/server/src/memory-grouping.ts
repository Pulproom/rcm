import { randomUUID } from "node:crypto";
import { buildSourceUnits, estimateTokens, groupingSystemPrompt, planGroupingInputs, validateGroupingResult,
  type GroupInputStage, type GroupInputUnit, type LeasedJob, type MemoryGroupingResult, type MemoryLanguage, type RpProfile } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { refreshMemoryFts } from "./memory-search-document.js";
import { sourceAccessFingerprint, memoryTargetFingerprint, rangeMessages, rangeTargetFingerprint, selectSourceRanges } from "./source-ranges.js";
import { fingerprintMatches, sourceFingerprint, type SourceFingerprintItem } from "./source-fingerprint.js";
import { loadItemAccess, resolveItemAccess, pruneDetailAccessEdits } from "./item-access.js";
import { invalidateStorySupports, storyMemorySupportIds } from "./story-spine.js";

interface GroupPayload {
  episodeId: string; sourceBatchIds: string[]; sourceMessageIds: string[]; sourceFingerprint: SourceFingerprintItem[];
  targetFingerprint: string; sourceAccessFingerprint: string; memberIds: string[]; partialIds: string[]; memoryLanguage: MemoryLanguage;
  stages: GroupInputStage[]; results: MemoryGroupingResult[]; cursor: number; level: number;
  priorLevels: Array<{ stages: GroupInputStage[]; results: MemoryGroupingResult[] }>;
  access: Record<string, string[]>; postExtractionReview: boolean; reviewing: boolean;
  auxiliaryBudget?: { maxInputTokens: number; maxOutputTokens: number; llmTimeoutMs: number };
  originalUnits: GroupInputUnit[]; inputLimit?: number; candidate?: MemoryGroupingResult; appliedFingerprint?: string;
}
const error = (message: string, code = 'GROUP_NOT_READY') => Object.assign(new Error(message), { code });
const intersection = (scopes: string[][]): string[] => !scopes.length ? [] : scopes[0]!.filter((holder) => scopes.every((scope) => scope.includes(holder)));

function prepareGroup(db: RcmDatabase, chatId: string, batchIds: string[], review: boolean): GroupPayload {
  const selected = selectSourceRanges(db, chatId, batchIds, 2);
  const messageIds = selected.flatMap((row) => row.sourceMessageIds);
  const selectedMessages = new Set(messageIds);
  const rows = rangeMessages(db, chatId).filter((row) => selectedMessages.has(row.id));
  const sources = buildSourceUnits(rows.map((row) => ({ id: row.id, content: row.content!, canonicalHash: row.canonicalHash })), { granularity: "sentence" });
  const selectedBatches = selected.map((row) => row.id);
  const memories = (db.prepare("SELECT * FROM memories WHERE chat_id=? AND active=1 ORDER BY created_at,id").all(chatId) as any[])
    .filter((row) => selected.some((range) => range.memoryIds.includes(row.id)));
  const units: GroupInputUnit[] = [];
  const access: Record<string, string[]> = {};
  const memberIds: string[] = [], partialIds: string[] = [];
  const sourceBatch = new Map(selected.flatMap((row) => row.sourceMessageIds.map((id) => [id, row.id] as const)));
  const passages = db.prepare("SELECT * FROM source_passages WHERE chat_id=? AND active=1 ORDER BY message_id,start_offset,id").all(chatId) as any[];
  for (const unit of sources) {
    const ref = `source:${unit.ref}`;
    access[ref] = [...new Set(passages.filter((passage) => passage.message_id === unit.messageId && passage.canonical_hash === unit.canonicalHash
      && passage.start_offset <= unit.start && passage.end_offset >= unit.end).flatMap((passage) =>
        (JSON.parse(passage.access_json) as Array<{ holder: string }>).map((grant) => grant.holder)))];
    units.push({ id: ref, batchId: sourceBatch.get(unit.messageId)!, text: JSON.stringify({ ...unit, role: rows.find((row) => row.id === unit.messageId)!.role, accessibleTo: access[ref] }), supportIds: [ref], sourceRefs: [unit.ref] });
  }
  for (const memory of memories) {
    const details = db.prepare("SELECT * FROM memory_details WHERE memory_id=? AND active=1 ORDER BY source_start_ordinal,id").all(memory.id) as any[];
    const dialogues = db.prepare("SELECT * FROM memory_dialogues WHERE memory_id=? ORDER BY ordinal,id").all(memory.id) as any[];
    const evidenceIds = [...JSON.parse(memory.evidence_json), ...details.flatMap((row) => JSON.parse(row.evidence_json))].map((item: any) => item.messageId);
    evidenceIds.push(...dialogues.map((row) => row.message_id));
    if (!evidenceIds.length || evidenceIds.some((id: string) => !selectedMessages.has(id)) || memory.capsule_parent_id) { partialIds.push(memory.id); continue; }
    memberIds.push(memory.id);
    const atomAccess = loadItemAccess(db, chatId, [...details.map((row) => ({ kind: 'detail' as const, id: row.id })), ...dialogues.map((row) => ({ kind: 'dialogue' as const, id: row.id }))]);
    const entries = [
      { id: memory.id, text: JSON.stringify({ title: memory.title, content: memory.content, evidence: JSON.parse(memory.evidence_json) }), holders: JSON.parse(memory.known_by_json) as string[] },
      ...details.map((row) => ({ id: row.id, text: JSON.stringify(row), holders: resolveItemAccess(atomAccess, 'detail', row.id, JSON.parse(row.known_by_json)).holders })),
      ...dialogues.map((row) => ({ id: row.id, text: JSON.stringify(row), holders: resolveItemAccess(atomAccess, 'dialogue', row.id, []).holders })),
    ];
    for (const entry of entries) {
      access[entry.id] = entry.holders;
      // A very large existing synopsis is split structurally, retaining the same support ID.
      const parts = buildSourceUnits([{ id: entry.id, canonicalHash: '', content: entry.text }], { granularity: "sentence" });
      for (const [index, part] of parts.entries()) units.push({ id: `${entry.id}:${index}`, batchId: memory.source_batch_id,
        text: JSON.stringify({ id: entry.id, text: part.text, accessibleTo: entry.holders }), supportIds: [entry.id], sourceRefs: [] });
    }
  }
  if (!memberIds.length) throw error('선택 범위 안에 온전히 포함된 기억이 없어', 'NO_GROUP_MEMBERS');
  units.sort((a, b) => selectedBatches.indexOf(a.batchId) - selectedBatches.indexOf(b.batchId));
  const language = (db.prepare("SELECT memory_language FROM chats WHERE id=?").get(chatId) as { memory_language: MemoryLanguage }).memory_language;
  const stored = db.prepare("SELECT value FROM server_meta WHERE key='server_llm_config'").get() as { value: string } | undefined;
  const config = JSON.parse(stored?.value ?? "{}");
  const auxiliaryBudget = { maxInputTokens: Number(config.maxInputTokens ?? 80_000), maxOutputTokens: Number(config.maxOutputTokens ?? 24_000), llmTimeoutMs: Number(config.llmTimeoutMs ?? 300_000) };
  return { auxiliaryBudget, inputLimit: auxiliaryBudget.maxInputTokens, episodeId: randomUUID(), sourceBatchIds: selectedBatches, sourceMessageIds: messageIds,
    sourceAccessFingerprint: sourceAccessFingerprint(db, chatId, messageIds), sourceFingerprint: sourceFingerprint(db, chatId, messageIds), targetFingerprint: rangeTargetFingerprint(db, chatId, selectedBatches),
    memberIds, partialIds, memoryLanguage: language, stages: planGroupingInputs(units, groupingSystemPrompt(language), estimateTokens, { inputTokens: auxiliaryBudget.maxInputTokens }),
    results: [], cursor: 0, level: 0, priorLevels: [], access, postExtractionReview: review, reviewing: false, originalUnits: units };
}

export function previewMemoryGroup(db: RcmDatabase, chatId: string, batchIds: string[], review: boolean) {
  const payload = prepareGroup(db, chatId, batchIds, review);
  return { sourceBatchIds: payload.sourceBatchIds, messageCount: payload.sourceMessageIds.length,
    rawTokens: selectSourceRanges(db, chatId, batchIds, 2).reduce((sum, row) => sum + row.rawTokens, 0),
    estimatedInputTokens: payload.stages.reduce((sum, stage) => sum + stage.estimatedInputTokens, 0),
    auxiliaryBudget: payload.auxiliaryBudget,
    initialCalls: payload.stages.length, mergeRequired: payload.stages.length > 1, reviewEnabled: review,
    memberIds: payload.memberIds, partialIds: payload.partialIds };
}

export function startMemoryGroup(db: RcmDatabase, chatId: string, batchIds: string[], review: boolean): { runId: string; jobId: string } {
  const payload = prepareGroup(db, chatId, batchIds, review);
  const id = randomUUID(), timestamp = now();
  const fingerprint = payload.sourceFingerprint;
  db.transaction(() => {
    db.prepare(`INSERT INTO episodes(id,chat_id,title,summary,start_revision,status,start_ordinal,end_ordinal,source_tokens,resolution,created_at,updated_at)
      VALUES(?,?,'','',0,'pending',?,?,?,'group',?,?)`).run(payload.episodeId, chatId, fingerprint[0]!.ordinal, fingerprint.at(-1)!.ordinal,
      selectSourceRanges(db, chatId, batchIds, 2).reduce((sum, row) => sum + row.rawTokens, 0), timestamp, timestamp);
    for (const item of fingerprint) db.prepare("INSERT INTO episode_messages(episode_id,chat_id,message_id,ordinal,turn_index) VALUES(?,?,?,?,0)").run(payload.episodeId, chatId, item.messageId, item.ordinal);
    db.prepare("INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'memory_group','queued',?,0,?,?)").run(id, chatId, JSON.stringify(payload), timestamp, timestamp);
  })();
  return { runId: payload.episodeId, jobId: id };
}

function groupJob(db: RcmDatabase, chatId: string, episodeId: string): { id: string; payload: GroupPayload; status: string; lastError: string | null } {
  const row = db.prepare("SELECT id,payload_json,status,last_error FROM jobs WHERE chat_id=? AND type='memory_group' AND json_extract(payload_json,'$.episodeId')=?").get(chatId, episodeId) as { id: string; payload_json: string; status: string; last_error: string | null } | undefined;
  if (!row) throw error('묶기 작업을 찾을 수 없어', 'GROUP_NOT_FOUND');
  return { id: row.id, payload: JSON.parse(row.payload_json), status: row.status, lastError: row.last_error };
}

export function buildMemoryGroupJob(id: string, chatId: string, profile: RpProfile, attempt: number, payload: GroupPayload): LeasedJob {
  const stage = payload.stages[payload.cursor];
  if (!stage) throw error('묶기 단계가 없어');
  return { id, chatId, profile, kind: 'memory_group', attempt, memoryLanguage: payload.memoryLanguage,
    estimatedInputTokens: stage.estimatedInputTokens, plannedParts: payload.stages.length,
    sourceMessageIds: payload.sourceMessageIds, memoryGrouping: stage, systemPrompt: stage.systemPrompt,
    userPrompt: stage.userPrompt, prompt: `${stage.systemPrompt}\n\n${stage.userPrompt}`,
    operationStage: payload.reviewing ? 'group_review' : payload.level ? 'group_merge' : 'group_source',
    operationStageOrdinal: payload.cursor + 1, operationStageTotal: payload.stages.length };
}

export function completeMemoryGroupJob(db: RcmDatabase, jobId: string, workerId: string, value: unknown) {
  const row = db.prepare("SELECT chat_id,payload_json FROM jobs WHERE id=? AND status='leased' AND lease_owner=? AND type='memory_group'").get(jobId, workerId) as { chat_id: string; payload_json: string } | undefined;
  if (!row) throw error('Lease not found', 'LEASE_NOT_FOUND');
  const payload: GroupPayload = JSON.parse(row.payload_json);
  const result = validateGroupingResult(value, payload.stages[payload.cursor]!);
  if (!fingerprintMatches(db, row.chat_id, payload.sourceFingerprint) || rangeTargetFingerprint(db, row.chat_id, payload.sourceBatchIds) !== payload.targetFingerprint) {
    db.prepare("UPDATE episodes SET status='stale',updated_at=? WHERE id=?").run(now(), payload.episodeId);
    db.prepare("UPDATE jobs SET status='done',lease_owner=NULL,leased_until=NULL,last_error='Source or target changed',updated_at=? WHERE id=?").run(now(), jobId);
    return { chatId: row.chat_id, warnings: ['원문·기억·접근 권한이 바뀌어 이전 후보를 적용하지 않았어'], pendingReconciliations: 0 };
  }
  payload.results.push(result); payload.cursor++;
  let done = false;
  if (payload.cursor === payload.stages.length) {
    if (payload.results.length === 1 && (!payload.postExtractionReview || payload.reviewing)) {
      const final = payload.results[0]!;
      payload.candidate = { ...final, reviewItems: [...new Map([...payload.priorLevels.flatMap((level) => level.results.flatMap((item) => item.reviewItems)), ...final.reviewItems]
        .map((item) => [JSON.stringify(item), item])).values()] }; done = true;
    } else {
      const previous = { stages: payload.stages, results: payload.results };
      const mergeUnits: GroupInputUnit[] = payload.results.flatMap((draft, index) => draft.sections.map((section, sectionIndex) => ({
        id: `level-${payload.level}-${index}-${sectionIndex}`, batchId: `result-${index}`, text: JSON.stringify({ ...section, reviewItems: draft.reviewItems }),
        supportIds: [...new Set([...section.supportIds, ...draft.reviewItems.flatMap((item) => item.supportIds)])], sourceRefs: [...new Set([...section.sourceRefs, ...draft.reviewItems.flatMap((item) => item.sourceRefs)])],
      })));
      const reviewNow = payload.results.length === 1 && payload.postExtractionReview && !payload.reviewing;
      const prompt = groupingSystemPrompt(payload.memoryLanguage) + (reviewNow ? '\nReview the proposed organization against the original evidence. Return corrected organization and unresolved review items.' : '\nIntegrate the draft sections. Keep evidence references and unresolved review items.');
      const next = planGroupingInputs(reviewNow ? [...payload.originalUnits, ...mergeUnits] : mergeUnits, prompt, estimateTokens, { inputTokens: payload.inputLimit });
      if (!reviewNow && next.length >= payload.stages.length) {
        db.prepare("UPDATE jobs SET payload_json=?,status='failed',lease_owner=NULL,leased_until=NULL,last_error='GROUP_NO_PROGRESS: 통합 단계가 줄어들지 않아 검토가 필요해',updated_at=? WHERE id=?")
          .run(JSON.stringify(payload), now(), jobId);
        return { chatId: row.chat_id, warnings: ['통합 단계가 줄어들지 않아 중간 결과를 보존하고 중단했어'], pendingReconciliations: 0 };
      }
      payload.priorLevels.push(previous); payload.level++; payload.stages = next; payload.cursor = 0; payload.results = [];
      if (reviewNow) payload.reviewing = true;
    }
  }
  db.transaction(() => {
    db.prepare("UPDATE jobs SET payload_json=?,status=?,attempts=0,lease_owner=NULL,leased_until=NULL,last_error=NULL,updated_at=? WHERE id=? AND lease_owner=?")
      .run(JSON.stringify(payload), done ? 'done' : 'queued', now(), jobId, workerId);
    db.prepare("UPDATE episodes SET status=?,updated_at=? WHERE id=?").run(done ? 'ready' : 'processing', now(), payload.episodeId);
  })();
  return { chatId: row.chat_id, warnings: [], pendingReconciliations: 0 };
}

export function listMemoryGroups(db: RcmDatabase, chatId: string) {
  const rows = db.prepare("SELECT * FROM episodes WHERE chat_id=? AND resolution='group' AND status<>'discarded' ORDER BY created_at DESC,id").all(chatId) as any[];
  return rows.map((row) => {
    const job = groupJob(db, chatId, row.id);
    return { id: row.id, status: job.status === 'failed' ? 'failed' : row.status, error: job.lastError,
      title: row.title, sourceBatchIds: job.payload.sourceBatchIds, memberIds: job.payload.memberIds, partialIds: job.payload.partialIds,
      sourceMessageIds: job.payload.sourceMessageIds, candidate: job.payload.candidate,
      canRetry: job.status === 'failed' && job.payload.cursor < job.payload.stages.length,
      progress: { stage: job.payload.cursor + 1, total: job.payload.stages.length, level: job.payload.level } };
  });
}

export function applyMemoryGroup(db: RcmDatabase, chatId: string, episodeId: string): void {
  const job = groupJob(db, chatId, episodeId), payload = job.payload;
  const episode = db.prepare("SELECT status FROM episodes WHERE id=? AND chat_id=?").get(episodeId, chatId) as { status: string };
  if (episode.status === 'capsuled') return;
  if (episode.status !== 'ready' || !payload.candidate) throw error('확인할 묶기 후보가 아직 없어');
  if (!fingerprintMatches(db, chatId, payload.sourceFingerprint) || rangeTargetFingerprint(db, chatId, payload.sourceBatchIds) !== payload.targetFingerprint) {
    db.prepare("UPDATE episodes SET status='stale',updated_at=? WHERE id=?").run(now(), episodeId);
    throw error('원문·기억·접근 권한이 바뀌어 이 후보를 적용할 수 없어', 'SOURCE_CHANGED');
  }
  selectSourceRanges(db, chatId, payload.sourceBatchIds, 2);
  const parentId = randomUUID(), timestamp = now();
  db.transaction(() => {
    // The top-level label has seen every source, including unverified access. Its
    // scope is the intersection of ALL inputs, never the union of child scopes.
    const holders = intersection(Object.values(payload.access));
    db.prepare(`INSERT INTO memories(id,chat_id,memory_key,type,title,content,known_by_json,evidence_json,created_revision,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,0,?,?)`).run(parentId, chatId, `group:${episodeId}`, holders.length ? 'episode' : 'secret', payload.candidate!.title,
        payload.candidate!.sections.map((section) => section.summary).join('\n'), JSON.stringify(holders), JSON.stringify(payload.sourceMessageIds.map((messageId) => ({ messageId }))), timestamp, timestamp);
    for (const messageId of payload.sourceMessageIds) db.prepare("INSERT INTO evidence_spans(id,chat_id,memory_id,message_id,created_at) VALUES(?,?,?,?,?)").run(randomUUID(), chatId, parentId, messageId, timestamp);
    for (const [ordinal, section] of payload.candidate!.sections.entries()) {
      const sectionSources = new Set(payload.originalUnits.filter((unit) => unit.sourceRefs.some((ref) => section.sourceRefs.includes(ref)) || unit.supportIds.some((ref) => section.supportIds.includes(ref)))
        .flatMap((unit) => {
          if (!unit.sourceRefs.length) return [];
          const source = JSON.parse(unit.text);
          return source.messageId ? [String(source.messageId)] : [];
        }));
      for (const id of section.supportIds) {
        const memory = db.prepare("SELECT evidence_json FROM memories WHERE chat_id=? AND id=?").get(chatId,id) as any;
        const detail = db.prepare("SELECT evidence_json FROM memory_details WHERE chat_id=? AND id=?").get(chatId,id) as any;
        for (const entry of [memory,detail]) if (entry) for (const evidence of JSON.parse(entry.evidence_json)) if (payload.sourceMessageIds.includes(evidence.messageId)) sectionSources.add(evidence.messageId);
        const dialogue = db.prepare("SELECT message_id FROM memory_dialogues WHERE chat_id=? AND id=?").get(chatId,id) as any;
        if (dialogue && payload.sourceMessageIds.includes(dialogue.message_id)) sectionSources.add(dialogue.message_id);
      }
      const sectionIds = payload.sourceMessageIds.filter((id) => sectionSources.has(id));
      db.prepare(`INSERT INTO episode_sections(id,episode_id,chat_id,ordinal,title,summary,source_message_ids_json,evidence_json,key_dialogues_json,token_count,created_at)
        VALUES(?,?,?,?,?,?,?,?, '[]',?,?)`).run(randomUUID(), episodeId, chatId, ordinal, section.title, section.summary,
          JSON.stringify(sectionIds), JSON.stringify(sectionIds.map((messageId) => ({ messageId }))), estimateTokens(section.summary), timestamp);
    }
    for (const id of payload.memberIds) db.prepare("UPDATE memories SET capsule_parent_id=? WHERE chat_id=? AND id=?").run(parentId, chatId, id);
    db.prepare("UPDATE episodes SET status='capsuled',title=?,summary=?,memory_id=?,updated_at=? WHERE id=?").run(payload.candidate!.title, payload.candidate!.sections.map((section) => section.summary).join('\n'), parentId, timestamp, episodeId);
    refreshMemoryFts(db, parentId);
    payload.appliedFingerprint = memoryTargetFingerprint(db, chatId, [...payload.memberIds, parentId]);
    db.prepare("UPDATE jobs SET payload_json=?,updated_at=? WHERE id=?").run(JSON.stringify(payload), timestamp, job.id);
  })();
}

export function ungroupMemories(db: RcmDatabase, chatId: string, episodeId: string, invalidated = false): void {
  const episode = db.prepare("SELECT memory_id,status FROM episodes WHERE id=? AND chat_id=? AND resolution='group'").get(episodeId, chatId) as { memory_id: string | null; status: string } | undefined;
  if (!episode || episode.status !== 'capsuled') throw error('적용된 묶음을 찾을 수 없어');
  db.transaction(() => {
    db.prepare("UPDATE memories SET capsule_parent_id=NULL WHERE chat_id=? AND capsule_parent_id=?").run(chatId, episode.memory_id);
    db.prepare("DELETE FROM memory_fts WHERE memory_id=?").run(episode.memory_id);
    db.prepare("DELETE FROM embedding_items WHERE kind='memory' AND source_id=?").run(episode.memory_id);
    const supports=storyMemorySupportIds(db,chatId,episode.memory_id ? [episode.memory_id] : []);
    db.prepare("DELETE FROM memories WHERE chat_id=? AND id=?").run(chatId, episode.memory_id);
    pruneDetailAccessEdits(db, chatId);
    db.prepare("DELETE FROM episode_sections WHERE episode_id=?").run(episodeId);
    db.prepare("UPDATE episodes SET status=?,memory_id=NULL,updated_at=? WHERE id=?").run(invalidated ? 'stale' : 'discarded', now(), episodeId);
    invalidateStorySupports(db,chatId,supports);
  })();
}

export function discardMemoryGroup(db: RcmDatabase, chatId: string, episodeId: string): void {
  const job = groupJob(db, chatId, episodeId);
  if (!db.prepare("UPDATE episodes SET status='discarded',updated_at=? WHERE id=? AND chat_id=? AND resolution='group' AND status<>'capsuled'").run(now(), episodeId, chatId).changes) throw error('적용된 묶음은 묶기 해제를 사용해 줘');
  db.prepare("UPDATE jobs SET status='superseded',lease_owner=NULL,leased_until=NULL,updated_at=? WHERE id=?").run(now(), job.id);
}

export function invalidateChangedMemoryGroups(db: RcmDatabase, chatId: string): void {
  const rows = db.prepare("SELECT id FROM episodes WHERE chat_id=? AND resolution='group' AND status='capsuled'").all(chatId) as Array<{ id: string }>;
  for (const row of rows) {
    const { payload } = groupJob(db, chatId, row.id);
    const parent = db.prepare("SELECT memory_id FROM episodes WHERE id=?").get(row.id) as { memory_id: string };
    if (!fingerprintMatches(db, chatId, payload.sourceFingerprint) || sourceAccessFingerprint(db, chatId, payload.sourceMessageIds) !== payload.sourceAccessFingerprint || memoryTargetFingerprint(db, chatId, [...payload.memberIds, parent.memory_id]) !== payload.appliedFingerprint) ungroupMemories(db, chatId, row.id, true);
  }
}

/** Explicit current-format lineage/transplant step after all canonical IDs were mapped. */
export function bindInheritedMemoryGroups(db: RcmDatabase, chatId: string): void {
  const groups = db.prepare("SELECT id,memory_id FROM episodes WHERE chat_id=? AND resolution='group' AND status='capsuled'").all(chatId) as Array<{ id: string; memory_id: string }>;
  for (const group of groups) {
    const members = db.prepare("SELECT id,source_batch_id FROM memories WHERE chat_id=? AND capsule_parent_id=? ORDER BY id").all(chatId, group.memory_id) as Array<{ id: string; source_batch_id: string | null }>;
    const sourceIds = (db.prepare("SELECT message_id FROM episode_messages WHERE episode_id=? ORDER BY ordinal,message_id").all(group.id) as Array<{ message_id: string }>).map((row) => row.message_id);
    const fingerprint = sourceFingerprint(db, chatId, sourceIds);
    if (!members.length || fingerprint.length !== sourceIds.length) { ungroupMemories(db, chatId, group.id, true); continue; }
    const payload: GroupPayload = { episodeId: group.id, sourceBatchIds: [...new Set(members.flatMap((row) => row.source_batch_id ? [row.source_batch_id] : []))],
      sourceMessageIds: sourceIds, sourceAccessFingerprint: sourceAccessFingerprint(db, chatId, sourceIds), sourceFingerprint: fingerprint, targetFingerprint: '', memberIds: members.map((row) => row.id), partialIds: [], memoryLanguage: 'en',
      stages: [], results: [], cursor: 0, level: 0, priorLevels: [], access: {}, postExtractionReview: false, reviewing: false, originalUnits: [],
      appliedFingerprint: memoryTargetFingerprint(db, chatId, [...members.map((row) => row.id), group.memory_id]) };
    db.prepare("INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'memory_group','done',?,0,?,?)")
      .run(randomUUID(), chatId, JSON.stringify(payload), now(), now());
  }
}

/** Provider context errors change request packing, never the selected source range. */
export function resplitMemoryGroupInput(db: RcmDatabase, jobId: string, payload: GroupPayload): boolean {
  const stage = payload.stages[payload.cursor];
  if (!stage || stage.unitIds.length < 2) return false;
  const units = JSON.parse(stage.userPrompt).input as GroupInputUnit[];
  const cap = Math.floor(stage.estimatedInputTokens * .6);
  let split: GroupInputStage[];
  try { split = planGroupingInputs(units, stage.systemPrompt, estimateTokens, { inputTokens: cap }); }
  catch { return false; }
  if (split.length < 2) return false;
  payload.inputLimit = Math.min(payload.inputLimit ?? Infinity, cap);
  payload.stages.splice(payload.cursor, 1, ...split);
  db.prepare("UPDATE jobs SET payload_json=?,status='queued',attempts=0,lease_owner=NULL,leased_until=NULL,last_error='입력 한도에 맞춰 원문 단위로 분할했어',updated_at=? WHERE id=?")
    .run(JSON.stringify(payload), now(), jobId);
  return true;
}

export function validatePendingMemoryGroup(db: RcmDatabase, chatId: string, jobId: string, payload: GroupPayload): boolean {
  if (fingerprintMatches(db, chatId, payload.sourceFingerprint) && rangeTargetFingerprint(db, chatId, payload.sourceBatchIds) === payload.targetFingerprint) return true;
  db.prepare("UPDATE episodes SET status='stale',updated_at=? WHERE id=?").run(now(), payload.episodeId);
  db.prepare("UPDATE jobs SET status='done',last_error='원문·기억·접근 권한이 바뀌어 생성을 중단했습니다',lease_owner=NULL,leased_until=NULL,updated_at=? WHERE id=?").run(now(), jobId);
  return false;
}
