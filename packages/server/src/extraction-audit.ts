import { applyExtractionAuditPatchToDraft } from "@rcm/shared";
import { randomUUID } from "node:crypto";
import type { ExtractionAuditPatch, ExtractionAuditSubmission, ExtractionDraftResult } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { sourceFingerprint, type SourceFingerprintItem } from "./source-fingerprint.js";

/** Quiet job diagnostics, carried through payload rewrites and list projection. */
export function recordAuditAdditionDrops(db: RcmDatabase, jobId: string, payload: object, audit?: ExtractionAuditSubmission): void {
  if (!audit?.additionDrops?.length) return;
  Object.assign(payload, { auditAdditionDrops: audit.additionDrops });
  db.prepare("UPDATE jobs SET payload_json=json_set(payload_json,'$.auditAdditionDrops',json(?)) WHERE id=?")
    .run(JSON.stringify(audit.additionDrops), jobId);
}

export function applyExtractionAuditPatch(db: RcmDatabase, chatId: string, sourceIds: string[], draft: ExtractionDraftResult, patch: ExtractionAuditPatch): { result: ExtractionDraftResult; pendingRefs: string[] } {
  const rows = sourceIds.length ? db.prepare(`SELECT message_id FROM messages WHERE chat_id=? AND message_id IN (${sourceIds.map(() => "?").join(",")})`).all(chatId, ...sourceIds) as Array<{ message_id: string }> : [];
  return applyExtractionAuditPatchToDraft(sourceIds, draft, patch, rows.map(row => row.message_id));
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
