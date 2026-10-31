import { ExtractionResultSchema, type ExtractionResult } from '@rcm/shared';
import type { RcmDatabase } from './db.js';
import { refreshMemoryFts } from './memory-search-document.js';
import { refreshDetailFts } from './memory-detail-edits.js';
import { parseSourceFingerprintJson } from './source-fingerprint.js';
import { readDetailAccessEdits, writeDetailAccessEdits } from './item-access.js';
import { snapshotRegenerationItems, structuralJson, type RegenerationItemChange, type RegenerationItemSnapshot } from './regeneration-items.js';
import { parseSocialRelation } from './social-relations.js';

type Row = Record<string, any>;
type SavedRow = { table: string; row: Row };
export interface RegenerationKeepPlan { ids: string[]; rows: SavedRow[]; items: RegenerationItemSnapshot[]; accessEdits: Map<string,string[]> }
export interface KeepRejection { id: string; reason: string }
const parse = (value: string | null | undefined): any => value ? JSON.parse(value) : [];
const failure = (rejectedItems: KeepRejection[]) => Object.assign(new Error('선택한 항목을 보존할 수 없어 적용하지 않았어요. 근거와 거절 이유를 확인해 주세요.'), { code: 'KEEP_ITEMS_REJECTED', rejectedItems });

/** Validate each citation against its original hash/batch, not a hash of today's edited source. */
function evidenceFailure(db: RcmDatabase, chatId: string, evidence: Row[], sourceBatchId?: string): string | undefined {
  if (!evidence.length) return 'missing_evidence';
  const batch = sourceBatchId ? db.prepare('SELECT source_fingerprint_json FROM extraction_batches WHERE id=? AND chat_id=?').get(sourceBatchId, chatId) as Row | undefined : undefined;
  const fingerprint = batch ? parseSourceFingerprintJson(batch.source_fingerprint_json) : undefined;
  for (const citation of evidence) {
    const source = db.prepare('SELECT * FROM messages WHERE chat_id=? AND message_id=?').get(chatId, citation.messageId) as Row | undefined;
    if (!source || !['committed', 'client_pruned'].includes(source.lifecycle) || source.memory_excluded
      || !['active', 'all_before'].includes(source.host_visibility) || source.canonical_content === null) return 'source_unavailable';
    const original = fingerprint?.find(item => item.messageId === citation.messageId);
    const expectedHash = citation.canonicalHash ?? citation.transitionCanonicalHash ?? original?.contentHash;
    if (!expectedHash) return 'missing_source_fingerprint';
    if (source.canonical_hash !== expectedHash || citation.transitionCanonicalHash && citation.transitionCanonicalHash !== source.canonical_hash
      || original && (source.ordinal !== original.ordinal || source.source_kind !== original.sourceKind)) return 'source_changed';
    if (citation.startOffset !== undefined || citation.endOffset !== undefined) {
      if (!Number.isInteger(citation.startOffset) || !Number.isInteger(citation.endOffset) || citation.startOffset < 0
        || citation.endOffset <= citation.startOffset || citation.endOffset > source.canonical_content.length
        || citation.quote !== undefined && source.canonical_content.slice(citation.startOffset, citation.endOffset) !== citation.quote) return 'evidence_span_changed';
    } else if (citation.quote !== undefined && !source.canonical_content.includes(citation.quote)) return 'evidence_quote_changed';
  }
}

export function prepareRegenerationKeep(db: RcmDatabase, chatId: string, ids: string[], diff: RegenerationItemChange[] | undefined): RegenerationKeepPlan {
  const plan: RegenerationKeepPlan = { ids: [...new Set(ids)], rows: [], items: [], accessEdits: new Map() };
  if (!ids.length) return plan;
  const snapshots = snapshotRegenerationItems(db, chatId);
  const rejections: KeepRejection[] = [];
  for (const id of plan.ids) {
    const item = snapshots.find(item => item.view.id === id);
    if (!item || !diff?.some(change => change.id === id && change.status === 'lost' && change.canKeep)) {
      rejections.push({ id, reason: 'not_a_lost_item' }); continue;
    }
    const selected = new Map<string, SavedRow>();
    const add = (table: string, row: Row) => selected.set(`${table}:${row.id ?? `${row.memory_id}:${row.character_name}`}`, { table, row });
    const read = (table: string, rowId: string) => db.prepare(`SELECT * FROM ${table} WHERE chat_id=? AND id=?`).get(chatId, rowId) as Row | undefined;
    const access = (kind: string, row: Row) => {
      for (const grant of db.prepare('SELECT * FROM item_access WHERE chat_id=? AND item_kind=? AND item_id=? AND active=1').all(chatId, kind, row.id) as Row[]) add('item_access', { ...grant, originalBatchId: row.source_batch_id ?? read('memories', row.memory_id)?.source_batch_id });
    };
    const parent = (memoryId: string | null | undefined) => {
      if (!memoryId) return;
      const memory = read('memories', memoryId);
      if (!memory || !memory.active) throw new Error('dependency_unavailable');
      add('memories', memory);
      for (const table of ['evidence_spans', 'memory_traces']) for (const row of db.prepare(`SELECT * FROM ${table} WHERE memory_id=?`).all(memoryId) as Row[]) add(table, row);
    };
    const atom = (table: 'memory_details' | 'memory_dialogues', row: Row) => {
      parent(row.memory_id); add(table, row); access(table === 'memory_details' ? 'detail' : 'dialogue', row);
    };
    try {
      if (item.kind === 'landmark') {
        parent(item.view.source.memoryId);
      } else {
        add(item.table, item.row); access(item.kind, item.row);
        parent(item.row.memory_id ?? item.row.source_memory_id);
      }
      if (item.kind === 'memory') {
        parent(item.row.id);
        for (const row of db.prepare('SELECT * FROM memory_details WHERE memory_id=? AND active=1').all(item.row.id) as Row[]) atom('memory_details', row);
        for (const row of db.prepare('SELECT * FROM memory_dialogues WHERE memory_id=?').all(item.row.id) as Row[]) atom('memory_dialogues', row);
      }
      if (item.kind === 'social_knowledge' || item.kind === 'relationship_event' || item.kind === 'assertion') {
        const detailIds: string[] = item.kind === 'social_knowledge' ? parse(item.row.cognition_detail_ids_json)
          : item.kind === 'assertion' ? parseSocialRelation(item.row.social_relation_json)?.detailIds ?? []
            : item.row.source_detail_id ? [item.row.source_detail_id] : [];
        for (const detailId of detailIds) {
          const detail = read('memory_details', detailId);
          if (!detail || !detail.active) throw new Error('dependency_unavailable');
          atom('memory_details', detail);
        }
      }
      if (item.kind === 'promise') {
        for (const event of db.prepare('SELECT * FROM promise_events WHERE chat_id=? AND promise_id=? AND active=1 ORDER BY source_ordinal,created_at,rowid').all(chatId, item.row.id) as Row[]) {
          add('promise_events', event); parent(event.source_memory_id);
        }
      }
      for (const { table, row } of selected.values()) {
        if (['promises','evidence_spans','memory_traces'].includes(table)) continue; // Parent/event records own their evidence.
        const batchId = row.originalBatchId ?? row.source_batch_id ?? (row.memory_id ? read('memories', row.memory_id)?.source_batch_id : undefined);
        const reason = evidenceFailure(db, chatId, parse(row.evidence_json), batchId);
        if (reason) throw new Error(`${table === 'item_access' ? 'access_' : ''}${reason}`);
        if (row.seed_json && JSON.parse(row.seed_json).closureEvidence?.length) {
          const closureReason = evidenceFailure(db, chatId, JSON.parse(row.seed_json).closureEvidence, batchId);
          if (closureReason) throw new Error(closureReason);
        }
        if (table === 'memories') for (const landmark of parse(row.landmark_kinds_json)) {
          if (landmark.evidence?.length) {
            const landmarkReason = evidenceFailure(db, chatId, landmark.evidence, batchId);
            if (landmarkReason) throw new Error(landmarkReason);
          }
        }
      }
      if (item.kind === 'promise' && ![...selected.values()].some(saved => saved.table === 'promise_events')) throw new Error('missing_evidence');
      plan.items.push(item); plan.rows.push(...selected.values());
    } catch (error) { rejections.push({ id, reason: (error as Error).message }); }
  }
  if (rejections.length) throw failure(rejections);
  plan.rows = [...new Map(plan.rows.map(saved => [`${saved.table}:${saved.row.id ?? `${saved.row.memory_id}:${saved.row.character_name}`}`, saved])).values()];
  const selectedAtoms = new Set(plan.rows.filter(saved => ['memory_details','memory_dialogues'].includes(saved.table)).map(saved => saved.row.id));
  plan.accessEdits = new Map([...readDetailAccessEdits(db,chatId)].filter(([id]) => selectedAtoms.has(id)));
  return plan;
}

/** Restore only selected records and required parent/recognition evidence, inside the apply transaction. */
export function restoreRegenerationKeep(db: RcmDatabase, chatId: string, plan: RegenerationKeepPlan): void {
  if (!plan.ids.length) return;
  const memoryMap = new Map<string, string>();
  const reusedParents = new Set<string>();
  const detailMap = new Map<string, string>();
  const appliedBatches = db.prepare("SELECT id,source_message_ids_json FROM extraction_batches WHERE chat_id=? AND generation_id='active' AND status='applied' ORDER BY start_ordinal").all(chatId) as Row[];
  const sourceBatch = (row: Row) => {
    if (!row.source_batch_id) return row.source_batch_id;
    if (appliedBatches.some(batch => batch.id === row.source_batch_id)) return row.source_batch_id;
    const original = db.prepare('SELECT source_message_ids_json FROM extraction_batches WHERE chat_id=? AND id=?').get(chatId, row.source_batch_id) as Row | undefined;
    const sourceIds: string[] = parse(row.evidence_json).map((e: Row) => e.messageId);
    const ids: string[] = sourceIds.length ? sourceIds : original ? parse(original.source_message_ids_json) : [];
    const target = appliedBatches.find(batch => ids.some(id => parse(batch.source_message_ids_json).includes(id)));
    if (!target) throw failure(plan.ids.map(id => ({ id, reason: 'replacement_batch_unavailable' })));
    return target.id;
  };
  const insert = (table: string, row: Row) => {
    const columns = Object.keys(row), conflict = table === 'memory_traces' ? 'memory_id,character_name' : 'id';
    db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})
      ON CONFLICT(${conflict}) DO UPDATE SET ${columns.filter(key => !conflict.split(',').includes(key)).map(key => `${key}=excluded.${key}`).join(',')}`).run(...columns.map(key => row[key]));
  };
  const ordered = [...plan.rows].sort((a, b) => {
    const order = ['memories', 'evidence_spans', 'memory_traces', 'memory_details', 'memory_dialogues', 'assertions', 'beliefs', 'promises', 'promise_events', 'relationship_events', 'social_knowledge_events', 'physical_intimacy_milestones', 'item_access'];
    return order.indexOf(a.table) - order.indexOf(b.table);
  });
  for (const { table, row: original } of ordered) {
    const { originalBatchId: _batch, ...row } = original;
    if (table === 'memories') {
      const existing = db.prepare('SELECT id FROM memories WHERE chat_id=? AND memory_key=? AND active=1').get(chatId, row.memory_key) as Row | undefined;
      // A parent dependency can already have its regenerated counterpart. Do not overwrite it.
      if (existing) { memoryMap.set(row.id, existing.id); reusedParents.add(row.id); continue; }
      memoryMap.set(row.id, row.id);
    }
    if (['evidence_spans','memory_traces'].includes(table) && reusedParents.has(row.memory_id)) continue;
    if ('source_batch_id' in row) row.source_batch_id = sourceBatch(row);
    if (row.memory_id) row.memory_id = memoryMap.get(row.memory_id) ?? row.memory_id;
    if (row.source_memory_id) row.source_memory_id = memoryMap.get(row.source_memory_id) ?? row.source_memory_id;
    if (table === 'memory_details') {
      const existing = db.prepare('SELECT id FROM memory_details WHERE chat_id=? AND memory_id=? AND detail_key=?').get(chatId, row.memory_id, row.detail_key) as Row | undefined;
      if (existing && existing.id !== row.id) throw failure(plan.ids.map(id => ({ id, reason: 'replacement_identity_conflict' })));
      detailMap.set(row.id, row.id);
    }
    if (row.source_detail_id) row.source_detail_id = detailMap.get(row.source_detail_id) ?? row.source_detail_id;
    if (table === 'social_knowledge_events') row.cognition_detail_ids_json = JSON.stringify(parse(row.cognition_detail_ids_json).map((id: string) => detailMap.get(id) ?? id));
    insert(table, row);
    if (table === 'memories') refreshMemoryFts(db, row.id);
    if (table === 'memory_details') refreshDetailFts(db, row.id);
    if (table === 'relationship_events') db.prepare(`INSERT OR IGNORE INTO relationship_projection_queue(chat_id,from_entity,to_entity,queued_at,mode) VALUES(?,?,?,?,'replay')`)
      .run(chatId, row.from_entity, row.to_entity, Date.now());
  }
  // Landmarks live inside the parent. Merge the selected typed record only.
  for (const item of plan.items.filter(item => item.kind === 'landmark')) {
    const memoryId = memoryMap.get(item.view.source.memoryId!)!;
    const parent = db.prepare('SELECT landmark_kinds_json FROM memories WHERE id=?').get(memoryId) as Row;
    const kinds = parse(parent.landmark_kinds_json), selected = parse(item.row.landmark_kinds_json)[item.row.landmarkIndex];
    if (selected && !kinds.some((kind: unknown) => structuralJson(kind) === structuralJson(selected))) kinds.push(selected);
    db.prepare('UPDATE memories SET landmark=1,landmark_kinds_json=? WHERE id=?').run(JSON.stringify(kinds), memoryId);
  }
  if (plan.accessEdits.size) writeDetailAccessEdits(db,chatId,new Map([...readDetailAccessEdits(db,chatId),...plan.accessEdits]));
  persistKeptReplay(db, chatId, plan, memoryMap);
}

/** Keep the active batch replayable too; a later suffix rebuild must not silently drop a kept prefix. */
function persistKeptReplay(db: RcmDatabase, chatId: string, plan: RegenerationKeepPlan, memoryMap: Map<string, string>): void {
  const batches = new Map<string, ExtractionResult>();
  const keptSeedIds = new Map<string, Set<string>>();
  const read = (table: string, id: string) => db.prepare(`SELECT * FROM ${table} WHERE chat_id=? AND id=?`).get(chatId, id) as Row;
  const access = (kind: string, id: string) => (db.prepare('SELECT holder,basis,evidence_json,confidence FROM item_access WHERE chat_id=? AND item_kind=? AND item_id=? AND active=1').all(chatId, kind, id) as Row[])
    .map(row => ({ holder: row.holder, basis: row.basis, evidence: parse(row.evidence_json), confidence: row.confidence }));
  const memoryKey = (id: string | null | undefined) => id ? read('memories', memoryMap.get(id) ?? id)?.memory_key : undefined;
  const payload = (batchId: string): ExtractionResult => {
    if (!batches.has(batchId)) batches.set(batchId, ExtractionResultSchema.parse(JSON.parse((read('extraction_batches', batchId)).final_json)));
    return batches.get(batchId)!;
  };
  const ensureMemory = (id: string): any => {
    const row = read('memories', memoryMap.get(id) ?? id);
    const target = payload(row.source_batch_id);
    let memory = target.memories.find(memory => memory.key === row.memory_key);
    if (!memory) {
      memory = { key: row.memory_key, type: row.type, title: row.title, content: row.content, participants: parse(row.participants_json), knownBy: parse(row.known_by_json),
        perspective: row.perspective ?? undefined, storyTime: row.story_time ?? undefined, locations: parse(row.locations_json), landmark: !!row.landmark,
        landmarkKinds: parse(row.landmark_kinds_json), evidence: parse(row.evidence_json), salience: row.salience, retention: row.retention_class, associations: [], details: [], keyDialogues: [] };
      target.memories.push(memory!);
    }
    return memory;
  };
  for (const {table, row: original} of plan.rows) {
    if (table === 'memories') { ensureMemory(original.id); continue; }
    if (['item_access','promises','evidence_spans','memory_traces'].includes(table)) continue;
    const row = read(table, original.id);
    if (table === 'memory_details' || table === 'memory_dialogues') {
      const memory = ensureMemory(row.memory_id);
      if (table === 'memory_details') {
        const seed = row.seed_json ? JSON.parse(row.seed_json) : undefined;
        if (seed?.closureEvidence?.length) {
          const batchId = read('memories', row.memory_id).source_batch_id;
          (payload(batchId).seedResolutions ??= []).push({detailId:row.id,status:seed.status,evidence:seed.closureEvidence});
          if (!keptSeedIds.has(batchId)) keptSeedIds.set(batchId,new Set());
          keptSeedIds.get(batchId)!.add(row.id);
        }
        memory.details ??= [];
        if (!memory.details.some((detail: Row) => detail.key === row.detail_key)) memory.details.push({ key: row.detail_key, role: row.role, kind: row.kind, text: row.text,
          epistemic: row.epistemic, participants: parse(row.participants_json), knownBy: parse(row.known_by_json), locations: parse(row.locations_json),
          evidence: parse(row.evidence_json), access: access('detail', row.id), salience: row.salience, retention: row.retention_class,
          originalKind: row.original_kind ?? undefined,
          ...(seed ? { seed: { ...seed, status: 'open', closureEvidence: undefined } } : {}) });
      } else {
        memory.keyDialogues ??= [];
        memory.keyDialogues.push({ speaker: row.speaker, text: row.text, messageId: row.message_id, kind: row.kind, evidence: parse(row.evidence_json), access: access('dialogue', row.id) });
      }
      continue;
    }
    const target = payload(row.source_batch_id), evidence = parse(row.evidence_json);
    if (table === 'assertions') {
      const relation = parseSocialRelation(row.social_relation_json);
      const supports = relation?.detailIds.map(id => read('memory_details', id));
      target.assertions.push({ subject: row.subject, predicate: row.predicate, value: row.value, stateKind: row.state_kind,
        confidence: row.confidence, changeType: 'initial', evidence, retention: row.retention_class, validFromMemoryKey: memoryKey(row.source_memory_id),
        ...(relation ? { socialRelation: { kind: relation.kind, target: relation.target, direction: relation.direction, label: relation.label,
          memoryKey: memoryKey(supports![0]!.memory_id)!, detailKeys: supports!.map(detail => detail.detail_key) } } : {}) });
    }
    if (table === 'beliefs') target.beliefs.push({ holder: row.holder, subject: row.subject, predicate: row.predicate, value: row.value, polarity: row.polarity,
      confidence: row.confidence, source: row.source ?? undefined, evidence, retention: row.retention_class, action: 'coexist' });
    if (table === 'promise_events') {
      const promise = read('promises', row.promise_id);
      target.promises.push({ key: row.promise_key, promisor: row.promisor, promisee: row.promisee, content: row.content, status: row.status,
        scheduledFor: row.scheduled_for ?? undefined, statusReason: row.status_reason ?? undefined, memoryKey: memoryKey(row.source_memory_id),
        evidence, access: access('promise', row.promise_id) as any,
        ...(['scene','future','recurring'].includes(promise.retention_scope) ? {scope:promise.retention_scope} : {}) });
    }
    if (table === 'relationship_events') (target.relationshipEvents ??= []).push({ from: row.from_entity, to: row.to_entity, reason: row.reason,
      changes: parse(row.changes_json), evidence, memoryKey: memoryKey(row.source_memory_id), detailKey: row.source_detail_id ? read('memory_details', row.source_detail_id)?.detail_key : undefined });
    if (table === 'social_knowledge_events') (target.socialKnowledge ??= []).push({ holder: row.holder, subject: row.subject, level: row.level,
      knownAs: parse(row.known_as_json), addressTerms: parse(row.address_terms_json), evidence, memoryKey: memoryKey(row.source_memory_id),
      cognitionDetailKeys: parse(row.cognition_detail_ids_json).map((id: string) => read('memory_details', id).detail_key) });
    if (table === 'physical_intimacy_milestones') (target.physicalIntimacy ??= []).push({ participants: [row.participant_a, row.participant_b], act: row.act,
      customLabel: row.custom_label ?? undefined, initiator: row.initiator ?? undefined, interactionContext: row.interaction_context, circumstance: row.circumstance ?? undefined,
      status: 'occurred', evidence, memoryKey: memoryKey(row.source_memory_id), access: access('physical_milestone', row.id) } as any);
  }
  for (const item of plan.items.filter(item => item.kind === 'landmark')) {
    const memory = ensureMemory(item.view.source.memoryId!);
    memory.landmarkKinds = parse(read('memories', memoryMap.get(item.view.source.memoryId!)!).landmark_kinds_json); memory.landmark = true;
  }
  for (const [id, value] of batches) {
    const original = JSON.parse(read('extraction_batches',id).final_json);
    const seedIds = [...new Set<string>([...(original.regenerationKeptSeedIds ?? []),...(keptSeedIds.get(id) ?? [])])];
    db.prepare('UPDATE extraction_batches SET final_json=? WHERE id=? AND chat_id=?')
      .run(JSON.stringify({...original,...ExtractionResultSchema.parse(value),...(seedIds.length ? {regenerationKeptSeedIds:seedIds} : {})}), id, chatId);
  }
}
