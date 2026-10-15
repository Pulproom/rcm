import type { JobTrigger } from "@rcm/shared";
import { maybeEnqueueQuiz } from "./quiz.js";
import { randomUUID } from "node:crypto";
import { extractionAuditDraftForJob, KeyDialogueSchema, type EpisodeCapsuleResult, type ExtractionAuditSubmission, type ExtractionDraftResult, type ExtractionResult, type ReconciliationSubmission } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { validateDialogueEvidence, normalizeStandaloneKeyDialogues, validateExtractionSources, ingestExtraction } from "./ingest.js";
import { markJobComplete } from "./jobs.js";
import { ExtractionValidationError } from "./extraction-completion.js";
import { staleTranscriptBlocks } from "./episodes.js";
import { flushRelationshipProjectionQueue, queueLaggingRelationshipProjections } from "./relationship-projections.js";
import { applyExtractionAuditPatch, recordExtractionAudit } from "./extraction-audit.js";
import { fingerprintMatches, type SourceFingerprintItem } from "./source-fingerprint.js";
import { lockInitialCalibration } from "./initial-calibration.js";
import { applyReconciliation } from "./reconciliation.js";
import { enqueueFinalLedgerConsistency } from "./ledger-consistency.js";
import { maybeEnqueueStorySpine } from "./story-spine.js";

function containedMemoryIds(db: RcmDatabase, chatId: string, sourceIds: Set<string>): string[] {
  const rows = db.prepare("SELECT memory_id,message_id FROM evidence_spans WHERE chat_id=? AND memory_id IS NOT NULL").all(chatId) as Array<{ memory_id: string; message_id: string }>;
  const byMemory = new Map<string, string[]>();
  for (const row of rows) byMemory.set(row.memory_id, [...(byMemory.get(row.memory_id) ?? []), row.message_id]);
  return [...byMemory].filter(([, ids]) => ids.length > 0 && ids.every((id) => sourceIds.has(id))).map(([id]) => id);
}

function filterSections(sourceIds: Set<string>, result: EpisodeCapsuleResult): EpisodeCapsuleResult["sections"] {
  return result.sections.map((section) => ({
    ...section,
    sourceMessageIds: section.sourceMessageIds.filter((id) => sourceIds.has(id)),
    evidence: section.evidence.filter((item) => sourceIds.has(item.messageId)),
    keyDialogues: section.keyDialogues.filter((item) => sourceIds.has(item.messageId)),
  })).filter((section) => section.sourceMessageIds.length > 0 && section.evidence.length > 0);
}

function canonicalEpisodeDialogues(db:RcmDatabase,chatId:string,sourceIds:string[],dialogues:any[]): any[] {
  const allowed=new Set(sourceIds);
  return dialogues.map(dialogue=>{
    const source=db.prepare("SELECT canonical_content,canonical_hash FROM messages WHERE chat_id=? AND message_id=?").get(chatId,dialogue.messageId) as {canonical_content:string;canonical_hash:string}|undefined;
    const unresolved=(item:any={})=>({messageId:String(item.messageId??dialogue.messageId),canonicalHash:"unresolved",startOffset:0,endOffset:1,quote:"[unresolved source]"});
    const supplied=Array.isArray(dialogue.evidence)&&dialogue.evidence.length?dialogue.evidence:[unresolved()];
    const evidence=supplied.map((item:any)=>{
      if(!item||typeof item!=="object"||typeof item.quote!=="string")return unresolved(item);
      // Canonical evidence is immutable input. Invalid identity, hash, or offsets
      // must survive unchanged so structural review can reject it precisely.
      if("canonicalHash" in item||"startOffset" in item||"endOffset" in item)return {...item};
      if(item.messageId!==dialogue.messageId||!allowed.has(dialogue.messageId)||!source)return unresolved(item);
      const start=source.canonical_content.indexOf(item.quote);
      if(start<0||source.canonical_content.indexOf(item.quote,start+1)>=0)return unresolved(item);
      return {messageId:dialogue.messageId,canonicalHash:source.canonical_hash,startOffset:start,endOffset:start+item.quote.length,quote:item.quote};});
    return {...dialogue,evidence};
  });
}

export function completeEpisodeJob(
  db: RcmDatabase,
  jobId: string,
  workerId: string,
  result: EpisodeCapsuleResult,
  reconciliation?: ReconciliationSubmission,
  audit?: ExtractionAuditSubmission,
): { chatId: string; warnings: string[]; pendingReconciliations: number } {
  const job = db.prepare("SELECT chat_id,payload_json FROM jobs WHERE id=? AND lease_owner=? AND status='leased'").get(jobId, workerId) as
    | { chat_id: string; payload_json: string }
    | undefined;
  if (!job) throw Object.assign(new Error("Lease not found"), { code: "LEASE_NOT_FOUND" });
  const payload = JSON.parse(job.payload_json) as { sourceMessageIds?: string[]; sourceFingerprint?: SourceFingerprintItem[]; episodeId?: string; postExtractionReview?: boolean; batchId?: string; backfillRunId?: string; trigger?: JobTrigger };
  const sourceMessageIds = payload.sourceMessageIds ?? [];
  const episodeId = payload.episodeId ?? "";
  const sourceSet = new Set(sourceMessageIds);
  if (payload.sourceFingerprint?.length && !fingerprintMatches(db, job.chat_id, payload.sourceFingerprint)) {
    db.transaction(() => {
      db.prepare("UPDATE extraction_audits SET status='stale',error='Source fingerprint changed',updated_at=? WHERE job_id=?").run(now(), jobId);
      db.prepare("UPDATE jobs SET status='done',lease_owner=NULL,leased_until=NULL,last_error='Source fingerprint changed before completion',updated_at=? WHERE id=?").run(now(), jobId);
      db.prepare("UPDATE episodes SET status='failed',last_error='Source changed; reprocess required',updated_at=? WHERE id=?").run(now(), episodeId);
      for (const id of sourceMessageIds) db.prepare("UPDATE messages SET extraction_state=CASE WHEN host_visibility IN ('active','all_before') THEN 'pending' ELSE 'blocked' END,updated_at=? WHERE chat_id=? AND message_id=?").run(now(), job.chat_id, id);
    })();
    return { chatId: job.chat_id, warnings: ["원문이 변경되어 오래된 에피소드 추출·검수 결과를 적용하지 않았습니다."], pendingReconciliations: 0 };
  }
  if (sourceMessageIds.length > 0) {
    const placeholders = sourceMessageIds.map(() => "?").join(",");
    const available = db.prepare(`SELECT count(*) AS count FROM messages WHERE chat_id=? AND message_id IN (${placeholders}) AND host_visibility IN ('active','all_before') AND content IS NOT NULL`)
      .get(job.chat_id, ...sourceMessageIds) as { count: number };
    if (available.count !== sourceMessageIds.length) throw Object.assign(new Error("보류 구간의 원문 가시성이 변경되었습니다."), { code: "EPISODE_SOURCE_CHANGED" });
  }
  const canonicalResult = { ...result,
    capsule:{...result.capsule,keyDialogues:canonicalEpisodeDialogues(db,job.chat_id,sourceMessageIds,result.capsule.keyDialogues)},
    sections:result.sections.map(section=>({...section,keyDialogues:canonicalEpisodeDialogues(db,job.chat_id,sourceMessageIds,section.keyDialogues)})),
  } as unknown as EpisodeCapsuleResult;
  let extraction: ExtractionResult = {
    language: "en",
    entities: canonicalResult.entities,
    sourcePassages: canonicalResult.sourcePassages,
    memories: [{ ...canonicalResult.capsule, key: `episode:${episodeId}`, type: "episode" } as any],
    assertions: result.assertions,
    beliefs: result.beliefs,
    relationshipEvents: result.relationshipEvents,
    promises: result.promises,
    socialKnowledge: result.socialKnowledge,
    relationshipBaselines: result.relationshipBaselines,
    physicalIntimacy: result.physicalIntimacy,
  };
  const draft = extractionAuditDraftForJob({ kind: "episode", episode: { episodeId } as any }, canonicalResult);
  const pendingDialogueKeys=new Set<string>();
  const dialogueKey=(dialogue:any)=>JSON.stringify([dialogue.messageId,dialogue.speaker,dialogue.text,dialogue.kind,dialogue.evidence]);
  const markPending=(dialogue:any)=>{pendingDialogueKeys.add(dialogueKey(dialogue));};
  extraction={...extraction,memories:extraction.memories.map(memory=>({...memory,keyDialogues:(memory.keyDialogues??[]).filter(dialogue=>{
    try {validateDialogueEvidence(db,job.chat_id,sourceMessageIds,{...extraction,memories:[{...memory,keyDialogues:[dialogue]}]});return true;}
    catch {markPending(dialogue);return false;}
  })}))};
  const prepared = validateDialogueEvidence(db, job.chat_id, sourceMessageIds, extraction);
  const validationErrors = validateExtractionSources(db, job.chat_id, sourceMessageIds, prepared);
  if (validationErrors.length) throw new ExtractionValidationError(validationErrors);
  if (payload.postExtractionReview && (!audit?.patch || audit.error)) {
    throw new Error(audit?.error ? `Extraction audit failed: ${audit.error}` : "Worker did not provide the requested extraction audit");
  }
  let auditedDraft: ExtractionDraftResult = draft;
  if (audit?.patch) {
    const audited = applyExtractionAuditPatch(db, job.chat_id, sourceMessageIds, draft, audit.patch);
    if (!audited.result.memories.some((memory) => memory.key === `episode:${episodeId}`)) {
      throw new Error("Extraction audit removed the required episode parent without an explicit pending decision");
    }
    auditedDraft = audited.result;
  }
  const reviewDraft=structuredClone(auditedDraft);
  for(const originalMemory of draft.memories){
    const reviewMemory=reviewDraft.memories.find(memory=>memory.key===originalMemory.key);
    if(!reviewMemory){reviewDraft.memories.push(structuredClone(originalMemory));continue;}
    const seen=new Set((reviewMemory.keyDialogues??[]).map(dialogueKey));
    for(const dialogue of originalMemory.keyDialogues??[])if(!seen.has(dialogueKey(dialogue)))(reviewMemory.keyDialogues??=[]).push(structuredClone(dialogue));
  }
  const episodeReviewMemory=reviewDraft.memories.find(memory=>memory.key===`episode:${episodeId}`);
  if(episodeReviewMemory){const seen=new Set((episodeReviewMemory.keyDialogues??[]).map(dialogueKey));
    for(const dialogue of canonicalResult.sections.flatMap(section=>section.keyDialogues)){const canonicalDialogue=KeyDialogueSchema.parse(dialogue);
      if(!seen.has(dialogueKey(canonicalDialogue))){(episodeReviewMemory.keyDialogues??=[]).push(canonicalDialogue);seen.add(dialogueKey(canonicalDialogue));}}}
  auditedDraft={...auditedDraft,memories:auditedDraft.memories.map(memory=>({...memory,keyDialogues:(memory.keyDialogues??[]).filter(dialogue=>{
    try {validateDialogueEvidence(db,job.chat_id,sourceMessageIds,{language:auditedDraft.language,entities:[],memories:[{...memory,keyDialogues:[dialogue]}],assertions:[],beliefs:[],promises:[]});return true;}
    catch {markPending(dialogue);return false;}
  })}))};
  const sections = filterSections(sourceSet, canonicalResult).map((section) => ({
    ...section,
    keyDialogues: section.keyDialogues.flatMap(dialogue=>{try{return normalizeStandaloneKeyDialogues(db,job.chat_id,sourceMessageIds,[dialogue] as any);}
      catch {markPending(dialogue);return[];}}),
  }));
  let pendingReconciliations = 0;
  db.transaction(() => {
    if (audit?.patch) {
      const pendingRefs = audit.patch.keepPendingItemRefs ?? [];
      recordExtractionAudit(db, job.chat_id, jobId, sourceMessageIds, reviewDraft, audit, pendingRefs.length||pendingDialogueKeys.size ? "pending_review" : "applied",
        pendingDialogueKeys.size ? "Dialogue evidence remains unverified" : undefined, payload.sourceFingerprint);
      pendingReconciliations += pendingRefs.length;
    } else if(pendingDialogueKeys.size) {
      recordExtractionAudit(db,job.chat_id,jobId,sourceMessageIds,reviewDraft,undefined,"pending_review","Dialogue evidence remains unverified",payload.sourceFingerprint);
    }
    pendingReconciliations+=pendingDialogueKeys.size;
    const reconciled = applyReconciliation(db, job.chat_id, jobId, sourceMessageIds, auditedDraft, reconciliation);
    pendingReconciliations += reconciled.pending;
    extraction = validateDialogueEvidence(db, job.chat_id, sourceMessageIds, reconciled.result);
    const previousChildren = containedMemoryIds(db, job.chat_id, sourceSet);
    ingestExtraction(db, job.chat_id, extraction, jobId, payload.batchId);
    if (payload.batchId) db.prepare("UPDATE extraction_batches SET status='applied',draft_json=?,final_json=?,audit_patch_json=?,updated_at=? WHERE id=?").run(JSON.stringify(prepared), JSON.stringify(extraction), audit?.patch ? JSON.stringify(audit.patch) : null, now(), payload.batchId);
    lockInitialCalibration(db, job.chat_id);
    const parent = db.prepare("SELECT id FROM memories WHERE chat_id=? AND memory_key=?").get(job.chat_id, `episode:${episodeId}`) as { id: string };
    const children = previousChildren.filter((id) => id !== parent.id);
    if (children.length > 0) {
      const placeholders = children.map(() => "?").join(",");
      db.prepare(`UPDATE memories SET capsule_parent_id=?,updated_at=? WHERE id IN (${placeholders})`).run(parent.id, now(), ...children);
      db.prepare(`DELETE FROM memory_fts WHERE memory_id IN (${placeholders})`).run(...children);
      for (const id of children) db.prepare("DELETE FROM embedding_items WHERE kind='memory' AND source_id=?").run(id);
    }
    db.prepare("DELETE FROM episode_sections WHERE episode_id=?").run(episodeId);
    const insert = db.prepare(`
      INSERT INTO episode_sections(id,episode_id,chat_id,ordinal,title,summary,source_message_ids_json,evidence_json,key_dialogues_json,token_count,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `);
    sections.forEach((section, index) => insert.run(
      randomUUID(), episodeId, job.chat_id, index, section.title, section.summary,
      JSON.stringify(section.sourceMessageIds), JSON.stringify(section.evidence), JSON.stringify(section.keyDialogues),
      Math.max(1, Math.ceil(section.summary.length / 3.5)), now(),
    ));
    staleTranscriptBlocks(db, job.chat_id, sourceMessageIds);
    db.prepare(`
      UPDATE episodes SET title=?,summary=?,status='capsuled',resolution='capsule',memory_id=?,last_error=NULL,end_revision=(SELECT revision FROM chats WHERE id=?),updated_at=?
      WHERE id=? AND chat_id=?
    `).run(extraction.memories[0]?.title ?? result.capsule.title, extraction.memories[0]?.content ?? result.capsule.content, parent.id, job.chat_id, now(), episodeId, job.chat_id);
    if (!markJobComplete(db, jobId, workerId)) throw new Error("Lease not found while completing episode");
  })();
  const finalLedger = payload.backfillRunId ? enqueueFinalLedgerConsistency(db, job.chat_id, payload.backfillRunId) : undefined;
  if (!finalLedger || finalLedger.state === "not_needed") {
    queueLaggingRelationshipProjections(db, job.chat_id);
    flushRelationshipProjectionQueue(db, job.chat_id, payload.backfillRunId);
  }
  maybeEnqueueStorySpine(db, job.chat_id, payload.backfillRunId, payload.trigger ?? 'extraction');
  maybeEnqueueQuiz(db, job.chat_id);
  return { chatId: job.chat_id, warnings: [], pendingReconciliations };
}
