import type { RcmDatabase } from './db.js';

export type ChatUpgradeLock = { runId: string; phase: 1 | 2; done: number; total: number };

/** Status → lock (upgrade runs only):
 * phase 1 queued/processing/ready: locked; failed: unlocked (old canon survives).
 * phase 2 finishing/failed: locked, including exhausted retries.
 * applied/discarded/stale: unlocked in either phase. Shadows have no live lock.
 * This reader deliberately never refreshes or mutates a run.
 */
const lockingRunSql = (alias:string) => `${alias}.mode='upgrade' AND
  ((${alias}.phase=1 AND ${alias}.status IN ('queued','processing','ready')) OR (${alias}.phase=2 AND ${alias}.status IN ('finishing','failed')))`;
export const upgradeLockSql = (chat: string) => `EXISTS (SELECT 1 FROM regeneration_runs u
  WHERE u.chat_id=${chat} AND ${lockingRunSql('u')})`;

export function chatUpgradeLock(db: RcmDatabase, chatId: string): ChatUpgradeLock | null {
  const run = db.prepare(`SELECT id,phase,shadow_chat_id FROM regeneration_runs u WHERE chat_id=? AND ${lockingRunSql('u')}
    ORDER BY created_at DESC LIMIT 1`).get(chatId) as {id:string;phase:1|2;shadow_chat_id:string}|undefined;
  if (!run) return null;
  const counts = db.prepare(`SELECT count(*) total,COALESCE(sum(status='done'),0) done FROM jobs
    WHERE chat_id=? AND status<>'superseded'`).get(run.phase === 1 ? run.shadow_chat_id : chatId) as {done:number;total:number};
  return {runId:run.id,phase:run.phase,...counts};
}

export function assertChatUnlocked(db: RcmDatabase, chatId: string): void {
  const lock = chatUpgradeLock(db,chatId);
  if (lock) throw Object.assign(new Error('CHAT_UPGRADING'),{code:'CHAT_UPGRADING',lock});
}

/** Call after request body/provider awaits. Only the gate owns a transaction:
 * services must retain rejection bookkeeping they commit before throwing.
 * The callback must stay synchronous, so no lock can start between gate and write;
 * each service keeps its original mutation/rollback boundary.
 */
export function withChatWrite<T>(db: RcmDatabase, chatId: string, write: () => T): T {
  db.transaction(() => assertChatUnlocked(db,chatId))();
  return write();
}

/** Check by identity BEFORE lease validation: start has already revoked the lease.
 * Retired live job IDs remain on the run so late callbacks after swap also get 423.
 * Only the phase-2 driver's explicitly tagged projection/Story jobs may write.
 */
export function assertUpgradeJobWritable(db: RcmDatabase, jobId: string): void {
  const job = db.prepare('SELECT chat_id,type,payload_json FROM jobs WHERE id=?').get(jobId) as
    {chat_id:string;type:string;payload_json:string}|undefined;
  if (job) {
    const lock = chatUpgradeLock(db,job.chat_id);
    if (!lock) return;
    const payload = JSON.parse(job.payload_json);
    if (lock.phase === 2 && payload.upgradePhase2RunId === lock.runId
      && ['story_consolidation','relationship_projection'].includes(job.type)) return;
    assertChatUnlocked(db,job.chat_id);
  } else {
    const run = db.prepare(`SELECT chat_id FROM regeneration_runs WHERE mode='upgrade'
      AND EXISTS (SELECT 1 FROM json_each(preview_json,'$.retiredJobIds') WHERE value=?)`).get(jobId) as {chat_id:string}|undefined;
    if (run) assertChatUnlocked(db,run.chat_id);
  }
}

/** Same short gate as chat writes; preserve job rejection/cancellation records
 * and the phase-2 driver's tagged-job exception.
 */
export function withJobWrite<T>(db: RcmDatabase, jobId: string, write: () => T): T {
  db.transaction(() => assertUpgradeJobWritable(db,jobId))();
  return write();
}
