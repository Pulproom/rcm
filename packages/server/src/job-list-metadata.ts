import type {RcmDatabase} from './db.js';
import {failedExtractionSources} from './jobs.js';
import {describeWithheldRecognitions} from './evidence-review.js';
import {buildEntityIdentityResolver} from './entities.js';
import {visibleSmallReviews,readSmallReviews} from './small-review.js';
import {listSourceRanges} from './source-ranges.js';

export function jobListMetadata(db:RcmDatabase,chatId:string,job:any):Record<string,unknown> {
  let payload: Record<string, any> = {};
  try { payload = JSON.parse(job.payload_json || "{}"); } catch { return {}; }
  const { messages: failureRows, turns } = job.status === 'failed' && job.type === 'extract'
    ? failedExtractionSources(db, chatId, payload) : { messages: [], turns: 0 };
  const failureMetadata=failureRows.length ? {failedRange:{startOrdinal:failureRows[0]!.ordinal,endOrdinal:failureRows.at(-1)!.ordinal,startTurn:failureRows.find(row=>row.completed_turn_seq!==null)?.completed_turn_seq,endTurn:failureRows.filter(row=>row.completed_turn_seq!==null).at(-1)?.completed_turn_seq,turnCount:turns,
    reason:String(job.last_error ?? '').slice(0,400),canResplit:turns>1}} : {};
  const audits = db.prepare(`SELECT draft_json AS draft,source_message_ids_json AS source_ids
    FROM extraction_audits WHERE chat_id=? AND job_id=? AND status IN ('pending_review','failed') ORDER BY updated_at DESC`).all(chatId, job.id) as Array<{ draft: string; source_ids: string }>;
  let withheld: ReturnType<typeof describeWithheldRecognitions> = [];
  let sourceMessageIds: string[] = [];
  let withheldReviewable = false;
  for (const audit of audits) {
    try {
      const draft = JSON.parse(audit.draft) as any;
      const found = describeWithheldRecognitions(draft,buildEntityIdentityResolver(db,chatId));
      if (found.length) {
        withheld = found; sourceMessageIds = JSON.parse(audit.source_ids || "[]");
        withheldReviewable = visibleSmallReviews(db, chatId, sourceMessageIds, readSmallReviews(draft))
          .some(item => item.kind === "recognition" && item.status === "pending");
        break;
      }
    } catch { /* A malformed audit remains visible through the normal audit endpoint. */ }
  }
  if (!withheld.length) return failureMetadata;
  const batchId = typeof payload.batchId === "string" ? payload.batchId : undefined;
  const batch = batchId ? db.prepare("SELECT id,start_ordinal AS startOrdinal,end_ordinal AS endOrdinal FROM extraction_batches WHERE id=? AND chat_id=?").get(batchId, chatId) as { id: string; startOrdinal: number; endOrdinal: number } | undefined : undefined;
  const sourceRange = batch ?? (sourceMessageIds.length ? listSourceRanges(db, chatId, sourceMessageIds).find((range) => sourceMessageIds.every((id) => range.sourceMessageIds.includes(id))) : undefined);
  const memoriesSaved = batchId ? Number((db.prepare("SELECT count(*) AS count FROM memories WHERE chat_id=? AND source_batch_id=? AND active=1").get(chatId, batchId) as { count: number }).count) : 0;
  return {
    ...failureMetadata,
    memoriesSaved,
    withheldRecognitions: withheld,
    withheldReviewable,
    ...(sourceRange ? { sourceRange: { id: sourceRange.id, startOrdinal: sourceRange.startOrdinal, endOrdinal: sourceRange.endOrdinal } } : {}),
  };
}
