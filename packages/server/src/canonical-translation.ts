import { randomUUID } from 'node:crypto';
import { canonicalProseEntries, canonicalForeignScriptCount, canonicalTranslationSystemPrompt, validateCanonicalTranslation, canonicalTranslationIssue,
  estimateTokens, splitAuxiliarySource, measureAuxiliaryPrompt, type CanonicalTranslationItem, type MemoryLanguage,
  type AuxiliaryBudgetSnapshot, type LeasedJob, type RpProfile } from '@rcm/shared';
import type { RcmDatabase } from './db.js';
import type { EmbeddingService } from './embedding.js';
import { assertChatUnlocked, assertUpgradeJobWritable } from './upgrade-lock.js';
import { refreshMemoryFts } from './memory-search-document.js';
import { refreshDetailFts } from './memory-detail-edits.js';
import { rebuildPromiseContent, promiseContributionState } from './item-access.js';
import { renewMemoryEpoch } from './derived-state.js';

type Slot = { id: string; table: string; rowId: string; column: string; path?: Array<string | number>; text: string; memoryId?: string; promiseId?: string; source: string };
type Unit = CanonicalTranslationItem & { slot: string };
interface TranslationPayload {
  memoryIds: string[]; memoryLanguage: MemoryLanguage; originals: Slot[]; chunks: Unit[][]; cursor: number;
  translated: Record<string, string>; diagnostics: Array<{ id: string; reason: 'missing' | 'changed' | NonNullable<ReturnType<typeof canonicalTranslationIssue>> }>;
  registeredNames: string[];
  applied: number; auxiliaryBudget: AuxiliaryBudgetSnapshot;
  repairBudgetUsed?: boolean; stateRepairBudgetUsed?: boolean;
}
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

/** Scope is provenance only. Prose slot membership comes from the shared field list.
 * There is no stored batch-owned entity-notes column; names/source_json are not prose. */
function translationScope(db: RcmDatabase, chatId: string, memoryIds: string[]) {
  const language = (db.prepare('SELECT memory_language FROM chats WHERE id=?').get(chatId) as { memory_language: MemoryLanguage } | undefined)?.memory_language;
  if (!language) throw failure('CHAT_NOT_FOUND', '채팅을 찾을 수 없어요.');
  const selected = db.prepare(`SELECT id,source_batch_id FROM memories WHERE chat_id=? AND active=1 AND id IN (SELECT value FROM json_each(?))`).all(chatId, JSON.stringify(memoryIds)) as any[];
  if (!memoryIds.length || new Set(memoryIds).size !== selected.length) throw failure('MEMORY_NOT_ACTIVE', '선택한 기억이 없거나 더 이상 활성 기억이 아니에요.');
  const batches = [...new Set(selected.flatMap(row => row.source_batch_id ? [row.source_batch_id] : []))];
  const memories = db.prepare(`SELECT * FROM memories WHERE chat_id=? AND active=1 AND
    (id IN (SELECT value FROM json_each(?)) OR source_batch_id IN (SELECT value FROM json_each(?))) ORDER BY created_at,id`)
    .all(chatId, JSON.stringify(memoryIds), JSON.stringify(batches)) as any[];
  const ids = memories.map(row => row.id);
  const jobs = (db.prepare('SELECT job_id FROM extraction_batches WHERE chat_id=? AND id IN (SELECT value FROM json_each(?))').all(chatId, JSON.stringify(batches)) as any[]).map(row => row.job_id).filter(Boolean);
  const slots: Slot[] = [];
  const counts = { memories: memories.length, details: 0, states: 0 };
  const add = (row: any, table: string, column: string, projection: unknown, prosePath: string, memoryId?: string, path?: Slot['path']) => {
    // Deleted boundaries retain the text used to suppress re-extraction.
    if (row.deleted_through_ordinal != null || row.deleted_by_user || row.source?.startsWith('user_deleted:')) return;
    // The projection is the model-writing shape; no identity/enum/quote fields enter it.
    const text = canonicalProseEntries(projection, 'state').find(entry => entry.path === prosePath)?.text;
    if (text?.trim()) slots.push({ id: JSON.stringify([table, row.id, column, path ?? []]), table, rowId: row.id, column, path, text, memoryId,
      promiseId: table==='promise_events' ? row.promise_id : table==='promises' ? row.id : undefined,
      source: JSON.stringify([row.source_batch_id,row.source_memory_id,row.evidence_json,row.linked_detail_ids_json,row.active]) });
  };
  for (const memory of memories) {
    for (const column of ['title', 'content']) add(memory, 'memories', column, { memories: [{ [column]: memory[column] }] }, `memories[0].${column}`, memory.id);
    const landmarks = JSON.parse(memory.landmark_kinds_json);
    for (const [index, landmark] of landmarks.entries()) add(memory, 'memories', 'landmark_kinds_json', { memories: [{ landmarkKinds: [landmark] }] }, 'memories[0].landmarkKinds[0].label', memory.id, [index, 'label']);
    const details = db.prepare('SELECT * FROM memory_details WHERE chat_id=? AND memory_id=? AND active=1 ORDER BY id').all(chatId, memory.id) as any[];
    counts.details += details.length;
    for (const detail of details) add(detail, 'memory_details', 'text', { memories: [{ details: [detail] }] }, 'memories[0].details[0].text', memory.id);
  }
  const rows = (table: string, extra = '') => db.prepare(`SELECT * FROM ${table} WHERE chat_id=? AND
    (source_batch_id IN (SELECT value FROM json_each(?)) ${table === 'beliefs' ? '' : 'OR source_memory_id IN (SELECT value FROM json_each(?))'} ${extra}) ORDER BY id`)
    .all(chatId, JSON.stringify(batches), ...(table === 'beliefs' ? [] : [JSON.stringify(ids)]), ...(extra ? [JSON.stringify(jobs), JSON.stringify(ids)] : [])) as any[];
  // Beliefs are linked to memories through typed detail support, not the free-form source string.
  const beliefs = db.prepare(`SELECT * FROM beliefs b WHERE chat_id=? AND (source_batch_id IN (SELECT value FROM json_each(?))
    OR EXISTS (SELECT 1 FROM json_each(b.linked_detail_ids_json) link JOIN memory_details d ON d.id=link.value
      WHERE d.chat_id=b.chat_id AND d.memory_id IN (SELECT value FROM json_each(?)))) ORDER BY id`).all(chatId, JSON.stringify(batches), JSON.stringify(ids)) as any[];
  for (const table of ['assertions', 'beliefs', 'promises', 'promise_events', 'relationship_events', 'physical_intimacy_milestones']) {
    const scoped = table === 'beliefs' ? beliefs : table === 'relationship_events'
      ? rows(table, `OR source_job_id IN (SELECT value FROM json_each(?)) OR source_detail_id IN (SELECT id FROM memory_details WHERE memory_id IN (SELECT value FROM json_each(?)))`)
      : rows(table);
    counts.states += scoped.length;
    for (const row of scoped) {
      const memoryId = row.source_memory_id ?? undefined;
      if (table === 'assertions' || table === 'beliefs') {
        add(row, table, 'value', { stateObservations: [{ value: row.value }] }, 'stateObservations[0].value', memoryId);
        if (table === 'assertions' && row.social_relation_json) {
          add(row, table, 'social_relation_json', { stateObservations: [{ socialRelation: JSON.parse(row.social_relation_json) }] }, 'stateObservations[0].socialRelation.label', memoryId, ['label']);
        }
      } else if (table === 'promises' || table === 'promise_events') {
        // Translate contributors, not cumulative caches that reconstruction will
        // replace between chunks. Legacy/manual parent text remains writable.
        const derived = table==='promises' ? row.user_edit_ordinal==null && !!promiseContributionState(db,chatId,row.id).rebuilt
          : row.event_kind!==null && row.event_kind!=='established' && row.amendment_text!==null;
        if (!derived) add(row, table, 'content', { stateObservations: [{ content: row.content }] }, 'stateObservations[0].content', memoryId);
        add(row, table, 'status_reason', { stateObservations: [{ statusReason: row.status_reason }] }, 'stateObservations[0].statusReason', memoryId);
        if (table==='promise_events') add(row,table,'amendment_text',{stateObservations:[{amendment:row.amendment_text}]},'stateObservations[0].amendment',memoryId);
      } else if (table === 'relationship_events') {
        // Unedited event reasons participate in the persisted replay identity.
        if (row.user_edited || row.user_hidden) add(row, table, 'reason', { relationshipEvents: [{ reason: row.reason }] }, 'relationshipEvents[0].reason', memoryId);
      } else {
        add(row, table, 'custom_label', { physicalIntimacy: [{ customLabel: row.custom_label }] }, 'physicalIntimacy[0].customLabel', memoryId);
        add(row, table, 'circumstance', { physicalIntimacy: [{ circumstance: row.circumstance }] }, 'physicalIntimacy[0].circumstance', memoryId);
      }
    }
  }
  return { language, slots, counts, memoryIds: ids };
}

function chunkTranslationUnits(units: Unit[], language: MemoryLanguage, budget: AuxiliaryBudgetSnapshot): Unit[][] {
  const systemPrompt = canonicalTranslationSystemPrompt(language);
  const fits = (items: CanonicalTranslationItem[]) => measureAuxiliaryPrompt([
    { role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify({ items: items.map(({ id, text }) => ({ id, text })) }) },
  ], estimateTokens, budget).fits && estimateTokens(JSON.stringify({ items: items.map(({ id, text }) => ({ id, text })) })) * 2 + 64 <= budget.maxOutputTokens;
  const chunks: Unit[][] = [];
  let chunk: Unit[] = [];
  for (const unit of units) {
    let parts = [unit];
    if (!fits(parts)) {
      let tokens = Math.max(1, Math.min(budget.maxInputTokens, budget.maxOutputTokens) / 4 | 0);
      while (true) {
        parts = splitAuxiliarySource(unit.text, estimateTokens, tokens).map((part, partIndex) => ({ ...unit, id: `${unit.id}.${partIndex}`, text: part.text }));
        if (parts.every(part => fits([part]))) break;
        if (tokens === 1) throw failure('CANONICAL_TRANSLATION_BUDGET', '호출 한도가 너무 작아 정본 번역을 시작할 수 없어요.');
        tokens = Math.max(1, tokens >> 1);
      }
    }
    for (const part of parts) {
      if (chunk.length && !fits([...chunk, part])) { chunks.push(chunk); chunk = []; }
      chunk.push(part);
    }
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

function plan(db: RcmDatabase, chatId: string, memoryIds: string[], budget: AuxiliaryBudgetSnapshot) {
  const scope = translationScope(db, chatId, memoryIds);
  const originals = scope.slots.filter(slot => scope.language !== 'en' || canonicalForeignScriptCount(slot.text));
  const chunks = chunkTranslationUnits(originals.map((slot, index) => ({ id: `p${index}`, slot: slot.id, text: slot.text })), scope.language, budget);
  return { scope, payload: { memoryIds: scope.memoryIds, memoryLanguage: scope.language, originals, chunks, cursor: 0,
    translated: {}, diagnostics: [], applied: 0, auxiliaryBudget: budget, registeredNames: registeredNames(db,chatId) } satisfies TranslationPayload };
}

function registeredNames(db:RcmDatabase,chatId:string):string[] {
  return (db.prepare(`SELECT name FROM entities WHERE chat_id=? UNION SELECT display_name FROM entities WHERE chat_id=?
    UNION SELECT alias FROM aliases JOIN entities ON entities.id=aliases.entity_id WHERE entities.chat_id=?`).all(chatId,chatId,chatId) as {name:string}[]).map(row=>row.name).filter(Boolean);
}

/** Replan only uncompleted chunks when configured limits change; completed parts and originals survive. */
export function replanCanonicalTranslationJob(db: RcmDatabase, job: LeasedJob, budget: AuxiliaryBudgetSnapshot): LeasedJob {
  const row = db.prepare('SELECT payload_json FROM jobs WHERE id=?').get(job.id) as { payload_json: string };
  const payload: TranslationPayload = JSON.parse(row.payload_json);
  if (budget.maxInputTokens !== payload.auxiliaryBudget.maxInputTokens || budget.maxOutputTokens !== payload.auxiliaryBudget.maxOutputTokens) {
    payload.chunks = [...payload.chunks.slice(0, payload.cursor), ...chunkTranslationUnits(payload.chunks.slice(payload.cursor).flat(), payload.memoryLanguage, budget)];
  }
  payload.auxiliaryBudget = budget;
  Object.assign(payload, { operationStage: 'canonical_translation', operationStageOrdinal: payload.cursor + 1, operationStageTotal: payload.chunks.length });
  db.prepare('UPDATE jobs SET payload_json=? WHERE id=?').run(JSON.stringify(payload), job.id);
  return { ...job, ...buildCanonicalTranslationJob(job.id, job.chatId, job.profile, job.attempt, payload) };
}

export function previewCanonicalTranslation(db: RcmDatabase, chatId: string, memoryIds: string[], budget: AuxiliaryBudgetSnapshot) {
  const { scope, payload } = plan(db, chatId, memoryIds, budget);
  return { language: scope.language, ...scope.counts, items: payload.originals.length, calls: payload.chunks.length };
}

export function startCanonicalTranslation(db: RcmDatabase, chatId: string, memoryIds: string[], budget: AuxiliaryBudgetSnapshot) {
  return db.transaction(() => {
    assertChatUnlocked(db, chatId);
    const { payload } = plan(db, chatId, memoryIds, budget);
    const jobId = randomUUID(), at = Date.now();
    db.prepare(`INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'canonical_translation',?,?,0,?,?)`)
      .run(jobId, chatId, payload.chunks.length ? 'queued' : 'done', JSON.stringify(payload), at, at);
    return { jobId, calls: payload.chunks.length };
  })();
}

export function buildCanonicalTranslationJob(id: string, chatId: string, profile: RpProfile, attempt: number, payload: TranslationPayload): LeasedJob {
  const items = payload.chunks[payload.cursor]!.map(({ id, text }) => ({ id, text }));
  const systemPrompt = canonicalTranslationSystemPrompt(payload.memoryLanguage), userPrompt = JSON.stringify({ items });
  return { id, chatId, profile, attempt, kind: 'canonical_translation', memoryLanguage: payload.memoryLanguage, sourceMessageIds: [],
    canonicalTranslation: { items }, systemPrompt, userPrompt, prompt: `${systemPrompt}\n\n${userPrompt}`,
    operationStage: 'canonical_translation', operationStageOrdinal: payload.cursor + 1, operationStageTotal: payload.chunks.length,
    repairBudgetUsed: payload.repairBudgetUsed ?? false, stateRepairBudgetUsed: false,
    plannedParts: payload.chunks.length, auxiliaryBudget: payload.auxiliaryBudget };
}

export function completeCanonicalTranslationJob(db: RcmDatabase, jobId: string, workerId: string, value: unknown, embeddings: Pick<EmbeddingService, 'removeMemory'>) {
  return db.transaction(() => {
    assertUpgradeJobWritable(db, jobId);
    const row = db.prepare(`SELECT chat_id,payload_json FROM jobs WHERE id=? AND type='canonical_translation' AND status='leased' AND lease_owner=?`).get(jobId, workerId) as any;
    if (!row) throw failure('LEASE_NOT_FOUND', 'Lease not found');
    const payload: TranslationPayload = JSON.parse(row.payload_json);
    const chunk = payload.chunks[payload.cursor]!;
    const result = validateCanonicalTranslation(value, chunk);
    const returned = new Map(result.items.map(item => [item.id, item.text]));
    for (const item of chunk) {
      if (returned.has(item.id) && returned.get(item.id)!.trim()) payload.translated[item.id] = returned.get(item.id)!;
      else if (returned.has(item.id)) payload.diagnostics.push({id:item.id,reason:'blank'});
      else payload.diagnostics.push({ id: item.id, reason: 'missing' });
    }
    // Re-resolve provenance and compare the original before writing; no text-based scope inference.
    let current = new Map<string, Slot>();
    try {
      const liveIds=(db.prepare('SELECT id FROM memories WHERE chat_id=? AND active=1 AND id IN (SELECT value FROM json_each(?))').all(row.chat_id,JSON.stringify(payload.memoryIds)) as {id:string}[]).map(row=>row.id);
      if (liveIds.length) {
        const scope = translationScope(db, row.chat_id, liveIds);
        if (scope.language === payload.memoryLanguage) current = new Map(scope.slots.map(slot => [slot.id, slot]));
      }
    } catch (error) {
      if ((error as any).code !== 'MEMORY_NOT_ACTIVE') throw error;
    }
    const all = payload.chunks.flat();
    const remainingSlots = new Set(payload.chunks.slice(payload.cursor + 1).flat().map(item => item.slot));
    const changedMemories = new Set<string>();
    const changedPromises = new Set<string>();
    const names=[...(payload.registeredNames ?? []),...registeredNames(db,row.chat_id)];
    const appliedBefore = payload.applied;
    for (const id of new Set(chunk.map(item => item.slot))) {
      if (remainingSlots.has(id)) continue;
      const original = payload.originals.find(item => item.id === id);
      const slot = current.get(id);
      const parts = all.filter(item => item.slot === id);
      if (parts.some(item => payload.translated[item.id] === undefined)) continue;
      if (!original || !slot || slot.text !== original.text || slot.source !== original.source) { payload.diagnostics.push({ id, reason: 'changed' }); continue; }
      const text = parts.map(item => payload.translated[item.id]).join('');
      const issue=canonicalTranslationIssue(original.text,text,names);
      if (issue) {payload.diagnostics.push({id,reason:issue});continue;}
      if (text === slot.text) continue;
      let updated = text;
      if (slot.path) {
        const stored = db.prepare(`SELECT ${slot.column} value FROM ${slot.table} WHERE chat_id=? AND id=?`).get(row.chat_id, slot.rowId) as any;
        const json = JSON.parse(stored.value);
        let target = json;
        for (const key of slot.path.slice(0, -1)) target = target[key];
        target[slot.path.at(-1)!] = text;
        updated = JSON.stringify(json);
      }
      // Table/column/path originate exclusively in the server's owned projection above.
      db.prepare(`UPDATE ${slot.table} SET ${slot.column}=? WHERE chat_id=? AND id=?`).run(updated, row.chat_id, slot.rowId);
      payload.applied++;
      if (slot.memoryId) changedMemories.add(slot.memoryId);
      if (slot.promiseId) changedPromises.add(slot.promiseId);
      if (slot.table === 'memory_details') {
        db.prepare('UPDATE memory_details SET updated_at=? WHERE id=?').run(Date.now(), slot.rowId);
        refreshDetailFts(db, slot.rowId);
      }
    }
    for (const id of changedPromises) rebuildPromiseContent(db,row.chat_id,id);
    for (const id of changedMemories) {
      db.prepare('UPDATE memories SET updated_at=? WHERE id=?').run(Date.now(), id);
      refreshMemoryFts(db, id);
      embeddings.removeMemory(id);
    }
    if (payload.applied > appliedBefore) {
      db.prepare('UPDATE chats SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(), row.chat_id);
      renewMemoryEpoch(db,row.chat_id);
    }
    payload.cursor++;
    payload.repairBudgetUsed = false;
    payload.stateRepairBudgetUsed = false;
    db.prepare(`UPDATE jobs SET payload_json=?,status=?,attempts=0,lease_owner=NULL,leased_until=NULL,last_error=NULL,updated_at=? WHERE id=?`)
      .run(JSON.stringify(payload), payload.cursor === payload.chunks.length ? 'done' : 'queued', Date.now(), jobId);
    return { chatId: row.chat_id, warnings: payload.diagnostics.length ? [`정본 번역 ${payload.diagnostics.length}개 항목은 누락되거나 바뀌어 그대로 두었어요.`] : [], pendingReconciliations: 0 };
  })();
}
