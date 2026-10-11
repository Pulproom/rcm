import { inspectSourceReferences, type ExtractionDraftResult, type SourceReferenceIssue } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
export type EvidenceIssue = SourceReferenceIssue;

export function inspectDraftEvidence(db: RcmDatabase, chatId: string, sourceIds: string[], draft: ExtractionDraftResult): EvidenceIssue[] {
  const messages = db.prepare(`SELECT message_id AS id,canonical_content AS content,canonical_hash AS canonicalHash FROM messages WHERE chat_id=?
    AND message_id IN (SELECT value FROM json_each(?)) AND lifecycle IN ('committed','client_pruned')
    AND host_visibility IN ('active','all_before')`).all(chatId, JSON.stringify(sourceIds)) as Array<{ id: string; content: string; canonicalHash: string }>;
  return inspectSourceReferences(draft, messages);
}

export function describeEvidenceReview(db: RcmDatabase, chatId: string, jobId: string, draft: ExtractionDraftResult, sourceIds: string[]) {
  const job = db.prepare("SELECT status,payload_json FROM jobs WHERE id=? AND chat_id=?").get(jobId, chatId) as { status: string; payload_json: string } | undefined;
  const payload = JSON.parse(job?.payload_json ?? "{}");
  const issues = inspectDraftEvidence(db, chatId, sourceIds, draft);
  const sourceMessages = db.prepare(`SELECT message_id AS id,role,ordinal,canonical_content AS content FROM messages WHERE chat_id=?
    AND message_id IN (SELECT value FROM json_each(?)) AND lifecycle IN ('committed','client_pruned')
    AND host_visibility IN ('active','all_before') ORDER BY ordinal`).all(chatId, JSON.stringify(sourceIds));
  const appliedMemories = payload.batchId ? (db.prepare("SELECT count(*) AS n FROM memories WHERE chat_id=? AND source_batch_id=? AND active=1").get(chatId, payload.batchId) as { n: number }).n : 0;
  return { blocking: job?.status !== "done" && !payload.sourceRecovery, issues, sourceMessages, appliedMemories };
}
