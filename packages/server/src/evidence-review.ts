import { inspectSourceReferences, rescueDialogueEvidence, sourceRangeIsVisible, dialogueMessageMatches, normalizeRecognitionReferences, type ExtractionDraftResult, type SourceReferenceIssue } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
export type EvidenceIssue = SourceReferenceIssue;

export type WithheldRecognition = {
  holder: string;
  what: string;
  reasonCode: "holder_access_unverified";
};

const shortDisplayText = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);

export function describeWithheldRecognitions(draft: ExtractionDraftResult, resolveIdentity?: (value:string)=>import("@rcm/shared").ResolvedEntityIdentity): WithheldRecognition[] {
  const normalized = normalizeRecognitionReferences(draft,resolveIdentity);
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
  // Archiving a terminal job hides its history without reopening evidence review.
  if (jobStatus === "done" || jobStatus === "completed" || jobStatus === "archived") return false;
  return payload.sourceRecovery !== true;
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

function sourceMessages(db: RcmDatabase, chatId: string, sourceIds: string[]) {
  return db.prepare(`SELECT message_id AS id,role,canonical_content AS content,canonical_hash AS canonicalHash FROM messages WHERE chat_id=?
    AND message_id IN (SELECT value FROM json_each(?)) AND lifecycle IN ('committed','client_pruned')
    AND memory_excluded=0 AND host_visibility IN ('active','all_before')`).all(chatId, JSON.stringify(sourceIds)) as Array<{ id: string; role: string; content: string; canonicalHash: string }>;
}

export function rescueDraftDialogues(db: RcmDatabase, chatId: string, sourceIds: string[], draft: ExtractionDraftResult): ExtractionDraftResult {
  const messages = sourceMessages(db, chatId, sourceIds);
  const exact = (quote: string) => {
    if (!quote.trim()) return;
    const matches = messages.flatMap(message => {
      const spans = [];
      for (let startOffset = message.content.indexOf(quote); startOffset >= 0; startOffset = message.content.indexOf(quote, startOffset + 1)) {
        const endOffset = startOffset + quote.length;
        if (sourceRangeIsVisible(message.content, startOffset, endOffset)) spans.push({
          messageId:message.id,canonicalHash:message.canonicalHash,startOffset,endOffset,quote});
      }
      return spans;
    });
    if (matches.length === 1) return matches[0];
  };
  const rescued = structuredClone(draft);
  for (const memory of rescued.memories) for (const dialogue of memory.keyDialogues ?? []) {
    const matches = dialogueMessageMatches(dialogue.text, messages).filter(match => match.complete);
    if (matches.length !== 1) continue;
    const {message,segments} = matches[0]!;
    dialogue.messageId = message.id;
    dialogue.evidence = segments.map(({startOffset,endOffset,quote}) => ({
      messageId:message.id,canonicalHash:message.canonicalHash,startOffset,endOffset,quote}));
  }
  for (const passage of rescued.sourcePassages ?? []) {
    const span = exact(passage.quote);
    if (span) { passage.messageId = span.messageId; passage.startOffset = span.startOffset; }
  }
  return rescueDialogueEvidence(rescued, messages);
}

export function inspectDraftEvidence(db: RcmDatabase, chatId: string, sourceIds: string[], draft: ExtractionDraftResult): EvidenceIssue[] {
  return inspectSourceReferences(draft, sourceMessages(db, chatId, sourceIds));
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
