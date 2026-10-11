import { ExtractionAggregateSchema, applySourceAccessPatch } from "@rcm/shared";
import { randomUUID } from "node:crypto";
import { ExtractionDraftResultSchema, type ExtractionAuditPatch, type ExtractionAuditSubmission, type ExtractionDraftResult } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { sourceFingerprint, type SourceFingerprintItem } from "./source-fingerprint.js";

type Evidence = { messageId: string; quote?: string };

function refSetAccess(result: ExtractionDraftResult, itemRef: string, grants: any[]): boolean {
  const relationIndex = /^relation:(\d+)$/.exec(itemRef)?.[1];
  if (relationIndex !== undefined && result.atomRelations?.[Number(relationIndex)]) {
    result.atomRelations[Number(relationIndex)]!.access = grants;
    return true;
  }
  for (const memory of result.memories) {
    if (itemRef === `memory:${memory.key}`) {
      memory.knownBy = [...new Set(grants.map((grant) => grant.holder))];
      return true;
    }
    for (const detail of memory.details ?? []) if (itemRef === `detail:${memory.key}:${detail.key}`) {
      detail.access = grants;
      detail.knownBy = [...new Set(grants.map((grant) => grant.holder))];
      return true;
    }
    for (const [index, dialogue] of (memory.keyDialogues ?? []).entries()) if (itemRef === `dialogue:${memory.key}:${dialogue.messageId}:${index}`) {
      dialogue.access = grants;
      return true;
    }
  }
  const observation = result.stateObservations.find((item) => itemRef === `observation:${item.key}`);
  if (observation?.kind === "promise_event") { observation.access = grants; return true; }
  const physicalIndex = /^physical:(\d+)$/.exec(itemRef)?.[1];
  if (physicalIndex !== undefined && result.physicalIntimacy?.[Number(physicalIndex)]) {
    result.physicalIntimacy[Number(physicalIndex)]!.access = grants;
    return true;
  }
  return false;
}

function removeDraftRefs(result: ExtractionDraftResult, refs: string[]): void {
  const remaining = new Set(refs);
  const keep = (ref: string) => !remaining.delete(ref);
  // Filter once against the frozen indices, before removing any parent memory.
  // Sequential splices would retarget later refs after earlier removals.
  for (const memory of result.memories) {
    if (memory.details) memory.details = memory.details.filter(item => keep(`detail:${memory.key}:${item.key}`));
    if (memory.keyDialogues) memory.keyDialogues = memory.keyDialogues.filter((item, index) => keep(`dialogue:${memory.key}:${item.messageId}:${index}`));
  }
  result.memories = result.memories.filter(item => keep(`memory:${item.key}`));
  result.stateObservations = result.stateObservations.filter(item => keep(`observation:${item.key}`));
  if (result.physicalIntimacy) result.physicalIntimacy = result.physicalIntimacy.filter((_item, index) => keep(`physical:${index}`));
  if (remaining.size) throw new Error(`Unknown audit itemRef: ${remaining.values().next().value}`);
}

function allEvidence(result: ExtractionDraftResult): Evidence[] {
  return [
    ...result.memories.flatMap((memory) => [
      ...memory.evidence,
      ...(memory.landmarkKinds ?? []).flatMap((landmark) => landmark.evidence ?? []),
      ...(memory.details ?? []).flatMap((detail) => detail.evidence),
      ...(memory.keyDialogues ?? []).flatMap((dialogue) => dialogue.evidence),
    ]),
    ...result.stateObservations.flatMap((item) => item.evidence),
    ...(result.relationshipEvents ?? []).flatMap((item) => item.evidence),
    ...(result.socialKnowledge ?? []).flatMap((item) => item.evidence),
    ...(result.physicalIntimacy ?? []).flatMap((item) => item.evidence),
  ];
}

function validateAuditEvidence(db: RcmDatabase, chatId: string, sourceIds: string[], evidenceItems: Evidence[]): void {
  const allowed = new Set(sourceIds);
  const rows = sourceIds.length ? db.prepare(`SELECT message_id,content FROM messages WHERE chat_id=? AND message_id IN (${sourceIds.map(() => "?").join(",")})`)
    .all(chatId, ...sourceIds) as Array<{ message_id: string; content: string | null }> : [];
  const content = new Map(rows.map((row) => [row.message_id, row.content ?? ""]));
  for (const evidence of evidenceItems) {
    if (!allowed.has(evidence.messageId) || !content.has(evidence.messageId)) throw new Error(`Audit addition cites unavailable evidence: ${evidence.messageId}`);
  }
}

export function applyExtractionAuditPatch(db: RcmDatabase, chatId: string, sourceIds: string[], draft: ExtractionDraftResult, patch: ExtractionAuditPatch): { result: ExtractionDraftResult; pendingRefs: string[] } {
  const result = structuredClone(draft);
  applySourceAccessPatch(result, patch);
  for (const item of patch.access.filter((entry) => !entry.itemRef.startsWith("source:"))) if (!refSetAccess(result, item.itemRef, item.grants)) throw new Error(`Unknown audit itemRef: ${item.itemRef}`);
  for (const item of patch.epistemic) {
    let found = false;
    for (const memory of result.memories) for (const detail of memory.details ?? []) if (item.itemRef === `detail:${memory.key}:${detail.key}`) {
      detail.epistemic = item.value; found = true;
    }
    if (!found) throw new Error(`Unknown epistemic itemRef: ${item.itemRef}`);
  }
  for (const item of patch.relationKinds) {
    const index = /^relation:(\d+)$/.exec(item.itemRef)?.[1];
    const relation = index === undefined ? undefined : result.atomRelations?.[Number(index)];
    if (!relation) throw new Error(`Unknown audit itemRef: ${item.itemRef}`);
    relation.kind = item.kind;
  }
  const removedRefs = [...patch.discardItemRefs, ...patch.keepPendingItemRefs];
  const relationIndices = new Set(removedRefs.filter(ref => ref.startsWith("relation:")).map(ref => {
    const index = /^relation:(\d+)$/.exec(ref)?.[1];
    if (index === undefined || !result.atomRelations?.[Number(index)]) throw new Error(`Unknown audit itemRef: ${ref}`);
    return Number(index);
  }));
  if (result.atomRelations) result.atomRelations = result.atomRelations.filter((_relation, index) => !relationIndices.has(index));
  removeDraftRefs(result, removedRefs.filter(ref => !ref.startsWith("source:") && !ref.startsWith("relation:")));
  for (const memoryRef of new Set(patch.landmarkPatches.map(item => item.memoryRef))) {
    const memory = result.memories.find(candidate => memoryRef === `memory:${candidate.key}`);
    if (!memory) throw new Error(`Unknown audit memoryRef: ${memoryRef}`);
    const original = memory.landmarkKinds ?? [];
    const changes = patch.landmarkPatches.filter(item => item.memoryRef === memoryRef);
    const indexed = new Map<number, typeof changes[number]>();
    for (const item of changes) if (item.action !== "add") {
      const index = item.landmarkIndex!;
      if (!original[index]) throw new Error(`Unknown audit landmark index: ${memoryRef}:${index}`);
      if (indexed.has(index)) throw new Error(`Conflicting audit landmark patches: ${memoryRef}:${index}`);
      indexed.set(index, item);
    }
    const landmarks = original.flatMap((landmark, index) => {
      const change = indexed.get(index);
      return change?.action === "remove" ? [] : [change?.landmark ?? landmark];
    });
    landmarks.push(...changes.filter(item => item.action === "add").map(item => item.landmark!));
    memory.landmarkKinds = landmarks;
    memory.landmark = landmarks.length > 0;
  }
  for (const item of patch.observationPatches) {
    const index = result.stateObservations.findIndex((candidate) => item.itemRef === `observation:${candidate.key}`);
    if (index < 0) throw new Error(`Unknown audit observation ref: ${item.itemRef}`);
    if (item.action === "remove") result.stateObservations.splice(index, 1);
    else result.stateObservations[index] = item.observation!;
  }
  const additions = ExtractionDraftResultSchema.parse({ language: result.language, ...patch.additions });
  validateAuditEvidence(db, chatId, sourceIds, [
    ...allEvidence(additions),
    ...(patch.memoryAdditions ?? []).flatMap((memory) => [
      ...memory.evidence,
      ...(memory.details ?? []).flatMap((detail) => detail.evidence),
      ...(memory.keyDialogues ?? []).flatMap((dialogue) => dialogue.evidence),
    ]),
    ...patch.detailAdditions.flatMap((item) => item.detail.evidence),
    ...patch.dialogueAdditions.flatMap((item) => item.dialogue.evidence),
    ...patch.landmarkPatches.flatMap((item) => item.landmark?.evidence ?? []),
    ...patch.observationAdditions.flatMap((item) => item.evidence),
  ]);
  for (const addition of patch.detailAdditions) {
    const memory = result.memories.find((item) => addition.memoryRef === `memory:${item.key}`);
    if (!memory) throw new Error(`Unknown audit memoryRef: ${addition.memoryRef}`);
    if ((memory.details ?? []).some((item) => item.key === addition.detail.key)) throw new Error(`Duplicate audit detail key: ${addition.detail.key}`);
    memory.details = [...(memory.details ?? []), addition.detail];
  }
  for (const addition of patch.dialogueAdditions) {
    const memory = result.memories.find((item) => addition.memoryRef === `memory:${item.key}`);
    if (!memory) throw new Error(`Unknown audit memoryRef: ${addition.memoryRef}`);
    if ((memory.keyDialogues ?? []).some((item) => item.messageId === addition.dialogue.messageId && item.text === addition.dialogue.text)) {
      throw new Error(`Duplicate audit dialogue: ${addition.dialogue.messageId}`);
    }
    memory.keyDialogues = [...(memory.keyDialogues ?? []), addition.dialogue];
  }
  result.entities.push(...additions.entities);
  result.sourcePassages = [...(result.sourcePassages ?? []), ...(additions.sourcePassages ?? [])];

  const knownMemoryKeys = new Set(result.memories.map((memory) => memory.key));
  for (const memory of patch.memoryAdditions ?? []) {
    if (knownMemoryKeys.has(memory.key)) throw new Error(`Duplicate audit memory key: ${memory.key}`);
    knownMemoryKeys.add(memory.key);
    result.memories.push(memory);
  }
  const observationKeys = new Set(result.stateObservations.map((item) => item.key));
  for (const observation of patch.observationAdditions) {
    if (observationKeys.has(observation.key)) throw new Error(`Duplicate audit observation key: ${observation.key}`);
    observationKeys.add(observation.key);
    result.stateObservations.push(observation);
  }
  result.relationshipEvents = [...(result.relationshipEvents ?? []), ...(additions.relationshipEvents ?? [])];
  result.socialKnowledge = [...(result.socialKnowledge ?? []), ...(additions.socialKnowledge ?? [])];
  const socialPatches = new Map<number, typeof patch.socialKnowledgePatches[number]>();
  for (const change of patch.socialKnowledgePatches ?? []) {
    if (!draft.socialKnowledge?.[change.index] || socialPatches.has(change.index)) throw new Error("Invalid or duplicate social knowledge patch index");
    socialPatches.set(change.index, change);
    if (change.record) validateAuditEvidence(db, chatId, sourceIds, change.record.evidence);
  }
  result.socialKnowledge = result.socialKnowledge.flatMap((record, index) => {
    const change = socialPatches.get(index);
    return change?.action === "remove" ? [] : [change?.record ?? record];
  });
  result.relationshipBaselines = [...(result.relationshipBaselines ?? []), ...(additions.relationshipBaselines ?? [])];
  result.physicalIntimacy = [...(result.physicalIntimacy ?? []), ...(additions.physicalIntimacy ?? [])];
  return { result: ExtractionAggregateSchema.parse(result), pendingRefs: patch.keepPendingItemRefs };
}

export function recordExtractionAudit(db: RcmDatabase, chatId: string, jobId: string, sourceIds: string[], draft: ExtractionDraftResult, submission: ExtractionAuditSubmission | undefined, status: "pending_review" | "applied" | "failed", error?: string, expectedFingerprint?: SourceFingerprintItem[]): string {
  const id = randomUUID();
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number }).revision;
  const timestamp = Date.now();
  const fingerprint = expectedFingerprint?.length ? expectedFingerprint : sourceFingerprint(db, chatId, sourceIds);
  db.prepare(`INSERT INTO extraction_audits(id,chat_id,job_id,status,source_message_ids_json,source_fingerprint_json,source_revision,draft_json,patch_json,error,usage_json,attempts,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(job_id) DO UPDATE SET status=excluded.status,draft_json=excluded.draft_json,source_fingerprint_json=excluded.source_fingerprint_json,patch_json=excluded.patch_json,error=excluded.error,
    usage_json=excluded.usage_json,attempts=extraction_audits.attempts+1,updated_at=excluded.updated_at`).run(
      id, chatId, jobId, status, JSON.stringify(sourceIds), JSON.stringify(fingerprint), revision, JSON.stringify(draft), submission?.patch ? JSON.stringify(submission.patch) : null,
      error ?? submission?.error ?? null, JSON.stringify(submission?.usage ?? {}), timestamp, timestamp,
    );
  return id;
}
