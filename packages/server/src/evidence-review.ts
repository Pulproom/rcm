import { inspectSourceReferences, normalizeRecognitionReferences, type ExtractionDraftResult, type SourceReferenceIssue } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
export type EvidenceIssue = SourceReferenceIssue;

export type WithheldRecognition = {
  holder: string;
  what: string;
  reasonCode: "holder_access_unverified";
};

const shortDisplayText = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);

export function describeWithheldRecognitions(draft: ExtractionDraftResult): WithheldRecognition[] {
  const normalized = normalizeRecognitionReferences(draft);
  return normalized.rejected.flatMap((issue) => {
    const social = draft.socialKnowledge?.[issue.index];
    if (!social) return [];
    const memory = draft.memories.find((item) => item.key === social.memoryKey);
    const what = shortDisplayText((issue.detailKeys.length ? issue.detailKeys : (social.cognitionDetailKeys ?? []))
      .map((key) => memory?.details?.find((detail) => detail.key === key)?.text)
      .filter(Boolean)
      .join(" · ")) || shortDisplayText(memory?.title) || "인식 기록";
    return [{ holder: shortDisplayText(social.holder), what, reasonCode: issue.reasonCode }];
  });
}

export function evidenceReviewIsBlocking(jobStatus: string | undefined, payload: Record<string, unknown>): boolean {
  return jobStatus !== "done" && payload.sourceRecovery !== true;
}

export function countBlockingExtractionAudits(db: RcmDatabase, chatId: string): number {
  const rows = db.prepare(`SELECT a.status,j.status AS job_status,j.payload_json
    FROM extraction_audits a LEFT JOIN jobs j ON j.id=a.job_id AND j.chat_id=a.chat_id
    WHERE a.chat_id=? AND a.status IN ('pending_review','failed')`).all(chatId) as Array<{ status: string; job_status?: string; payload_json?: string }>;
  return rows.filter((row) => {
    try { return evidenceReviewIsBlocking(row.job_status, JSON.parse(row.payload_json || "{}")); }
    catch { return true; }
  }).length;
}

export function inspectDraftEvidence(db: RcmDatabase, chatId: string, sourceIds: string[], draft: ExtractionDraftResult): EvidenceIssue[] {
  const messages = db.prepare(`SELECT message_id AS id,canonical_content AS content,canonical_hash AS canonicalHash FROM messages WHERE chat_id=?
    AND message_id IN (SELECT value FROM json_each(?)) AND lifecycle IN ('committed','client_pruned')
    AND memory_excluded=0 AND host_visibility IN ('active','all_before')`).all(chatId, JSON.stringify(sourceIds)) as Array<{ id: string; content: string; canonicalHash: string }>;
  return inspectSourceReferences(draft, messages);
}

export function describeEvidenceReview(db: RcmDatabase, chatId: string, jobId: string, draft: ExtractionDraftResult, sourceIds: string[]) {
  const job = db.prepare("SELECT status,payload_json FROM jobs WHERE id=? AND chat_id=?").get(jobId, chatId) as { status: string; payload_json: string } | undefined;
  const payload = JSON.parse(job?.payload_json ?? "{}");
  const issues = inspectDraftEvidence(db, chatId, sourceIds, draft);
  const sourceMessages = db.prepare(`SELECT message_id AS id,role,ordinal,canonical_content AS content FROM messages WHERE chat_id=?
    AND message_id IN (SELECT value FROM json_each(?)) AND lifecycle IN ('committed','client_pruned')
    AND memory_excluded=0 AND host_visibility IN ('active','all_before') ORDER BY ordinal`).all(chatId, JSON.stringify(sourceIds));
  const appliedMemories = payload.batchId ? (db.prepare("SELECT count(*) AS n FROM memories WHERE chat_id=? AND source_batch_id=? AND active=1").get(chatId, payload.batchId) as { n: number }).n : 0;
  return { blocking: evidenceReviewIsBlocking(job?.status, payload), issues, sourceMessages, appliedMemories };
}
