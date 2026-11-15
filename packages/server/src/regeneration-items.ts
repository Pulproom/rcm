import { createHash } from 'node:crypto';
import { isInitialCalibrationMemory } from '@rcm/shared';
import type { RcmDatabase } from './db.js';
import { linkedDetailKnowledge, promiseLinkedSupport, projectPromiseRow, readDetailAccessEdits } from './item-access.js';
import { parseSocialRelation, socialRelationKnowledge } from './social-relations.js';
import { memoryHasLineCorrectionSql, regeneratedTextEdits, type RegeneratedRange } from './memory-detail-edits.js';
import { isUserOwnedMemoryDetail } from './memory-group-search.js';
import { deletedMemoryKeys } from './user-deletions.js';
import { availableMemoryKey } from './extraction-memory-keys.js';

type Row = Record<string, any>;

export function protectedLegacyEpisodeKeys(db: RcmDatabase, chatId: string, before: Array<{id:string;key:string}>): Set<string> {
  const protectedRow = db.prepare(`SELECT 1 FROM memories WHERE id=? AND chat_id=? AND card_shape=0
    AND (user_managed=1 OR (${memoryHasLineCorrectionSql()}))`);
  return new Set(before.filter(item => protectedRow.get(item.id,chatId)).map(item => item.key));
}

/** E1d replacements get a separate identity when an original legacy parent is user-owned. */
export function episodeMemoryKeys(db: RcmDatabase, chatId: string, batchId: string,
  before: Array<{id:string;key:string}>, memories: Array<{cardShape?:1}>): string[] {
  const deleted=deletedMemoryKeys(db,chatId);
  const reserved = new Set([...deleted,...(db.prepare('SELECT memory_key FROM memories WHERE chat_id=?').all(chatId) as Row[]).map(row => row.memory_key)]);
  const protectedKeys = protectedLegacyEpisodeKeys(db,chatId,before);
  return memories.map((memory,index) => {
    const old = before[index];
    const preserved = old && memory.cardShape === 1 && protectedKeys.has(old.key);
    if (old && !preserved && !deleted.has(old.key)) return old.key;
    const base = `batch:${batchId}:${index+1}`;
    const key=availableMemoryKey(base,reserved);
    reserved.add(key);
    return key;
  });
}
type Evidence = { messageId: string; canonicalHash?: string; quote?: string; startOffset?: number; endOffset?: number };
export type RegenerationItemKind = 'memory' | 'detail' | 'dialogue' | 'assertion' | 'belief' | 'promise'
  | 'relationship_event' | 'social_knowledge' | 'physical_milestone' | 'landmark' | 'pair_progress';
export interface RegenerationItemView {
  id: string;
  text: string;
  source: { memoryId: string | null; messageIds: string[]; startOrdinal: number | null; endOrdinal: number | null };
  manualEdited: boolean;
  protected: boolean;
  holders: string[];
}
export interface RegenerationItemChange {
  id: string;
  kind: RegenerationItemKind;
  status: 'kept' | 'changed' | 'lost' | 'new' | 'review';
  reason?: 'ambiguous_identity' | 'missing_identity' | 'protected_by_apply' | 'new_card_shape';
  changes?: RegenerationItemChange[];
  before?: RegenerationItemView;
  after?: RegenerationItemView;
  candidateIds?: string[];
  candidates?: RegenerationItemView[];
  accessChanged: boolean;
  canKeep: boolean;
}
export interface RegenerationItemSnapshot {
  kind: RegenerationItemKind;
  table: string;
  row: Row;
  view: RegenerationItemView;
  identity: string;
  scope: string;
  evidence: Evidence[];
  grants: Row[];
  value: unknown;
}

/** Exact structural equality, never prose similarity or a semantic classifier. */
export function structuralJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(structuralJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${structuralJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const sorted = (items: unknown[]) => items.map(structuralJson).sort();
const json = (value: string | null | undefined): any[] => value ? JSON.parse(value) : [];
const fields = (row: Row, names: string[]) => Object.fromEntries(names.map(name => {
  const value = name.endsWith('_json') ? json(row[name]) : row[name] ?? null;
  // Passive delivery receipts do not change the record the user is comparing.
  if (name === 'seed_json' && value && !Array.isArray(value)) delete value.delivery;
  return [name,value];
}));

export function snapshotRegenerationItems(db: RcmDatabase, chatId: string, regeneratedRange?:RegeneratedRange): RegenerationItemSnapshot[] {
  const rows = (table: string, where = '1') => db.prepare(`SELECT * FROM ${table} WHERE chat_id=? AND ${where} ORDER BY id`).all(chatId) as Row[];
  const messages = new Map((db.prepare('SELECT message_id,ordinal FROM messages WHERE chat_id=?').all(chatId) as Row[]).map(row => [row.message_id, row.ordinal as number]));
  const access = rows('item_access', 'active=1');
  const accessEdits = readDetailAccessEdits(db, chatId);
  const result: RegenerationItemSnapshot[] = [];
  const memories = rows('memories', 'active=1');
  const parents = new Map(memories.map(row => [row.id, row]));
  const details = rows('memory_details', 'active=1').filter(row => parents.has(row.memory_id));
  const detailById = new Map(details.map(row => [row.id, row]));
  const add = (kind: RegenerationItemKind, table: string, row: Row, identity: unknown[], scope: unknown[], text: string,
    value: unknown, evidence: Evidence[] = json(row.evidence_json), manual = false, protectedItem = manual,
    inherentHolders: string[] = []) => {
    const grants = access.filter(grant => grant.item_kind === kind && grant.item_id === row.id);
    const linkedHolders=kind==='promise' ? promiseLinkedSupport(db,chatId,row.id)?.holders : row.linked_detail_ids_json != null && row.user_edit_ordinal == null ? linkedDetailKnowledge(db,chatId,json(row.linked_detail_ids_json)) ?? [] : undefined;
    const messageIds = [...new Set(evidence.map(item => item.messageId).filter(Boolean))].sort();
    const ordinals = messageIds.flatMap(id => messages.has(id) ? [messages.get(id)!] : []);
    const memoryId = kind === 'memory' || kind === 'landmark' ? row.id : row.memory_id ?? row.source_memory_id ?? null;
    result.push({ kind, table, row, identity: structuralJson(identity), scope: structuralJson(scope), evidence, grants,
      view: { id: `${kind}:${row.id}`, text: text.slice(0, 240), manualEdited: manual, protected: protectedItem,
        source: { memoryId, messageIds, startOrdinal: ordinals.length ? Math.min(...ordinals) : null, endOrdinal: ordinals.length ? Math.max(...ordinals) : null },
        holders: [...new Set(linkedHolders ?? (grants.length ? grants.map(grant => grant.holder) : inherentHolders))].sort() },
      value: { value, evidence: sorted(evidence), access: sorted(grants.map(grant => fields(grant, ['holder', 'basis', 'evidence_json', 'confidence']))) } });
  };
  for (const row of memories) {
    const protectedItem = !!row.user_managed || isInitialCalibrationMemory(row);
    add('memory', 'memories', row, [row.memory_key], [row.type], row.title,
      fields(row, ['card_shape', 'type', 'title', 'content', 'participants_json', 'known_by_json', 'perspective', 'story_time', 'locations_json', 'landmark', 'landmark_kinds_json', 'retention_class']),
      json(row.evidence_json), !!row.user_managed, protectedItem, json(row.known_by_json));
    const storedLandmarks = json(row.landmark_kinds_json);
    const landmarks = storedLandmarks.length ? storedLandmarks : row.landmark ? [{kind:'legacy_landmark'}] : [];
    for (const [index, landmark] of landmarks.entries()) {
      add('landmark', 'memories', { ...row, id: `${row.id}:landmark:${index}`, source_memory_id: row.id, landmarkIndex: index },
        [row.memory_key, landmark.kind, landmark.pair ?? []], [landmark.kind, landmark.pair ?? []], landmark.label ?? row.title,
        landmark, landmark.evidence?.length ? landmark.evidence : json(row.evidence_json), !!landmark.userDefined || !!row.user_managed,
        protectedItem, json(row.known_by_json));
      result.at(-1)!.view.source.memoryId = row.id;
      if (!storedLandmarks.length) result.at(-1)!.row.landmarkIndex = -1;
    }
  }
  for (const row of details) {
    const parent = parents.get(row.memory_id)!;
    add('detail', 'memory_details', row, [parent.memory_key, row.detail_key], [row.kind, row.role], row.text,
      fields(row, ['kind', 'original_kind', 'role', 'text', 'epistemic', 'seed_json', 'participants_json', 'known_by_json', 'hidden_from_json', 'locations_json', 'retention_class', 'user_hidden']),
      json(row.evidence_json), !!row.user_edited || !!row.user_hidden || !!parent.user_managed || accessEdits.has(row.id),
      isUserOwnedMemoryDetail(row) || !!parent.user_managed || accessEdits.has(row.id), json(row.known_by_json));
  }
  for (const row of rows('memory_dialogues').filter(row => parents.has(row.memory_id))) add('dialogue', 'memory_dialogues', row,
    [parents.get(row.memory_id)!.memory_key, row.message_id, row.speaker, row.ordinal], [row.speaker, row.kind], row.text,
    fields(row, ['speaker', 'text', 'kind']), json(row.evidence_json), !!parents.get(row.memory_id)!.user_managed);
  const supportKeys=(ids:string[])=>ids.map(id=>{
    const detail=detailById.get(id);
    return detail ? [parents.get(detail.memory_id)?.memory_key,detail.detail_key] : {missing:true};
  });
  const stateLinks=(row:Row)=>row.linked_detail_ids_json == null ? undefined : {
    supports:sorted(supportKeys(json(row.linked_detail_ids_json))),holders:linkedDetailKnowledge(db,chatId,json(row.linked_detail_ids_json)) ?? []
  };
  for (const row of rows('assertions', 'valid_to_revision IS NULL')) {
    const relation = parseSocialRelation(row.social_relation_json);
    const scope = relation ? [relation.kind, relation.target, relation.direction] : null;
    const holders = stateLinks(row)?.holders ?? (relation ? socialRelationKnowledge(db, chatId, relation) ?? [] : []);
    // Shadow generations have different DB IDs. Compare typed endpoints and stable atom keys instead.
    const supports = relation?.detailIds.map(id => {
      const detail = detailById.get(id);
      return detail ? [parents.get(detail.memory_id)?.memory_key, detail.detail_key] : { missing: true };
    });
    add('assertion', 'assertions', row,
      [row.subject, row.predicate, row.state_kind, scope], [row.subject, row.predicate, row.state_kind, scope], `${row.subject} · ${row.predicate}: ${row.value}`,
      { ...fields(row, ['subject', 'predicate', 'value', 'state_kind', 'retention_class']),links:stateLinks(row),
        relation: relation ? { scope, label: relation.label, supports: sorted(supports!), holders } : null }, json(row.evidence_json),
      row.user_edit_ordinal !== null || !!row.auto_locked, row.user_edit_ordinal !== null || !!row.auto_locked, holders);
  }
  for (const row of rows('beliefs', "active=1 AND status='active'")) add('belief', 'beliefs', row,
    [row.holder, row.subject, row.predicate], [row.holder, row.subject, row.predicate], `${row.holder}: ${row.subject} · ${row.predicate}: ${row.value}`,
    {...fields(row, ['holder', 'subject', 'predicate', 'value', 'polarity', 'source', 'retention_class']),links:stateLinks(row)}, json(row.evidence_json),
    row.user_edit_ordinal !== null || !!row.auto_locked, row.user_edit_ordinal !== null || !!row.auto_locked, stateLinks(row)?.holders ?? [row.holder]);
  const events = rows('promise_events', 'active=1');
  for (const row of rows('promises').map(row=>projectPromiseRow(db,chatId,row))) add('promise', 'promises', row, [row.promise_key], [row.promisor, row.promisee], row.content,
    {...fields(row, ['promise_key', 'promisor', 'promisee', 'content', 'status', 'scheduled_for', 'status_reason', 'retention_scope']),links:promiseLinkedSupport(db,chatId,row.id) ? supportKeys(promiseLinkedSupport(db,chatId,row.id)!.ids) : undefined},
    events.filter(event => event.promise_id === row.id).flatMap(event => json(event.evidence_json)), row.user_edit_ordinal !== null || !!row.auto_locked);
  for (const row of rows('relationship_events', 'active=1')) add('relationship_event', 'relationship_events', row,
    [row.id], [row.from_entity, row.to_entity], row.reason, fields(row, ['from_entity', 'to_entity', 'changes_json', 'reason', 'user_hidden']),
    json(row.evidence_json), !!row.user_edited || !!row.user_hidden, !!row.user_edited || !!row.user_hidden || !row.source_batch_id);
  for (const row of rows('social_knowledge_events', 'active=1')) {
    const cognition = json(row.cognition_detail_ids_json).map(id => detailById.get(id)).map(detail => detail
      ? { key: detail.detail_key, kind: detail.kind, text: detail.text, evidence: sorted(json(detail.evidence_json)) } : { missing: true });
    add('social_knowledge', 'social_knowledge_events', row, [row.id], [row.holder, row.subject, row.action],
      `${row.holder} → ${row.subject}: ${json(row.known_as_json).join(', ')}`,
      { ...fields(row, ['holder', 'subject', 'action', 'level', 'known_as_json', 'address_terms_json']), cognition: sorted(cognition) },
      json(row.evidence_json), !!row.manual || row.user_edit_ordinal !== null, !!row.manual, [row.holder]);
  }
  for (const row of rows('physical_intimacy_milestones', 'active=1')) add('physical_milestone', 'physical_intimacy_milestones', row,
    [row.participant_a, row.participant_b, row.milestone_key], [row.participant_a, row.participant_b, row.act], row.custom_label ?? row.act,
    fields(row, ['participant_a', 'participant_b', 'act', 'custom_label', 'initiator', 'interaction_context', 'circumstance', 'auto_inject', 'deleted_by_user']),
    json(row.evidence_json), !!row.manual_override, !!row.manual_override || !row.source_batch_id);
  for (const row of rows('pair_progress')) for (const cell of json(row.cells_json).filter(cell => cell.state === 'done')) {
    add('pair_progress', 'pair_progress', { ...row, id: `${row.id}:cell:${cell.side}`, progressRowId: row.id, cell },
      [row.persona, row.character, row.item_id, cell.side], [row.persona, row.character, row.item_id, cell.side], `${row.label}: ${cell.side}`,
      { label: row.label, mode: row.mode, hidden: row.hidden, cell: { ...cell, memoryId: undefined, createdAt: undefined, updatedAt: undefined } },
      (cell.messageIds ?? []).map((messageId: string) => ({ messageId })), cell.source === 'user', true);
    result.at(-1)!.view.source.memoryId = cell.memoryId ?? null;
  }
  if (regeneratedRange) {
    const replaced=regeneratedTextEdits(db,chatId,regeneratedRange);
    for (const item of result) if (item.kind==='detail' && replaced.details.includes(item.row.id)
      || item.kind==='relationship_event' && replaced.events.includes(item.row.id)) item.view.protected=false;
  }
  return result;
}

export function regenerationItemsFingerprint(db: RcmDatabase, chatId: string): string {
  return createHash('sha256').update(structuralJson(snapshotRegenerationItems(db, chatId)
    .map(item => ({ kind: item.kind, identity: item.identity, view: item.view, value: item.value })))).digest('hex');
}

export function diffRegenerationItems(before: RegenerationItemSnapshot[], after: RegenerationItemSnapshot[]): RegenerationItemChange[] {
  const result: RegenerationItemChange[] = [];
  const used = new Set<RegenerationItemSnapshot>();
  const evidenceKey = (item: RegenerationItemSnapshot) => structuralJson(sorted(item.evidence.map(e => [e.messageId, e.startOffset ?? null, e.endOffset ?? null, e.quote ?? null])));
  // Keys and typed source scopes establish identity. Display text never participates.
  const matches = new Map(before.map(old => {
    const sameKind = after.filter(next => next.kind === old.kind);
    const stable = sameKind.filter(next => next.identity === old.identity);
    return [old, stable.length ? stable : sameKind.filter(next => old.evidence.length && next.scope === old.scope && evidenceKey(next) === evidenceKey(old))];
  }));
  for (const old of before) {
    const candidates = matches.get(old)!;
    const ambiguous = candidates.length > 1 || candidates.some(next => before.some(other => other !== old && matches.get(other)!.includes(next)));
    if (ambiguous) {
      candidates.forEach(next => used.add(next));
      result.push({ id: old.view.id, kind: old.kind, status: 'review', reason: 'ambiguous_identity', before: old.view,
        candidateIds: candidates.map(next => next.view.id), candidates: candidates.map(next => next.view),
        accessChanged: candidates.some(next => structuralJson(next.view.holders) !== structuralJson(old.view.holders)), canKeep: false });
      continue;
    }
    const next = candidates[0];
    if (next) used.add(next);
    const protectedItem = old.view.protected;
    const status = protectedItem ? 'kept' : next ? structuralJson(old.value) === structuralJson(next.value) ? 'kept' : 'changed'
      : old.evidence.length ? 'lost' : 'review';
    result.push({ id: old.view.id, kind: old.kind, status, before: old.view, ...(next ? { after: protectedItem ? old.view : next.view } : {}),
      ...(protectedItem ? { reason: 'protected_by_apply' as const } : status === 'review' ? { reason: 'missing_identity' as const } : {}),
      accessChanged: !protectedItem && structuralJson(old.view.holders) !== structuralJson(next?.view.holders ?? []), canKeep: status === 'lost' });
  }
  for (const next of after) if (!used.has(next)) result.push({ id: next.view.id, kind: next.kind, status: 'new', after: next.view, accessChanged: false, canKeep: false });
  const grouped = new Set<RegenerationItemChange>();
  for (const change of result.filter(item => item.kind === 'memory' && ['changed','new'].includes(item.status))) {
    const next = after.find(item => item.view.id === change.after?.id);
    if (next?.row.card_shape !== 1) continue;
    // A rewrite may split events or use different keys/quotes. Group by the
    // declared source IDs, without claiming semantic identity between cards.
    const legacy = before.filter(item => item.kind === 'memory' && item.row.card_shape === 0
      && item.view.source.messageIds.some(id => next.view.source.messageIds.includes(id)));
    if (!legacy.length) continue;
    const legacyIds = new Set(legacy.map(item => item.row.id));
    change.reason = 'new_card_shape';
    change.status = 'changed';
    change.changes = result.filter(item => item !== change && !grouped.has(item) && !item.before?.protected
      && (['detail','dialogue','landmark'].includes(item.kind) && (legacyIds.has(item.before?.source.memoryId) || item.after?.source.memoryId === next.row.id)
        || item.kind === 'memory' && item.status === 'lost' && legacyIds.has(item.before?.source.memoryId)));
    change.changes.forEach(item => grouped.add(item));
  }
  return result.filter(item => !grouped.has(item));
}
