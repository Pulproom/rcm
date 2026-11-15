import { now, type RcmDatabase } from './db.js';

export type Incident = {
  id: number;
  chatId: string | null;
  chatLabel: string | null;
  kind: 'job_failed' | 'worker_faulted' | 'upgrade_done' | 'upgrade_failed';
  detail?: string;
};

export function recordIncident(db: RcmDatabase, incident: Omit<Incident, 'id' | 'chatLabel'>): void {
  let chatId = incident.chatId;
  if (chatId?.startsWith('__rcm_regen__')) {
    chatId = (db.prepare('SELECT chat_id FROM regeneration_runs WHERE shadow_chat_id=?').get(chatId) as { chat_id: string } | undefined)?.chat_id ?? null;
  }
  db.transaction(() => {
    db.prepare('INSERT INTO incidents(chat_id,kind,detail_json,created_at) VALUES(?,?,?,?)')
      .run(chatId, incident.kind, JSON.stringify({ detail: incident.detail }), now());
    db.exec('DELETE FROM incidents WHERE id <= (SELECT id FROM incidents ORDER BY id DESC LIMIT 1 OFFSET 500)');
  })();
}

/** First-install handshakes replay only the last ten minutes; cursors retain ID paging. */
export function incidentsSince(db: RcmDatabase, cursor?: number, limit = 20): { incidents: Incident[]; incidentCursor: number } {
  const latest = (db.prepare("SELECT seq FROM sqlite_sequence WHERE name='incidents'").get() as {seq:number} | undefined)?.seq ?? 0;
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > latest)) return { incidents: [], incidentCursor: latest };
  const recentSince=cursor === undefined ? now()-10*60_000 : null;
  const rows = db.prepare(`SELECT i.id,i.chat_id chatId,c.chat_title chatLabel,i.kind,i.detail_json
    FROM incidents i LEFT JOIN chats c ON c.id=i.chat_id WHERE i.id>? AND (? IS NULL OR i.created_at>=?) ORDER BY i.id LIMIT ?`)
    .all(cursor ?? 0, recentSince, recentSince, Math.max(1, Math.min(20, Math.floor(limit)))) as Array<Incident & {detail_json:string}>;
  return { incidents: rows.map(({detail_json, ...row}) => {
    const {detail}=JSON.parse(detail_json) as {detail?:string};
    return {...row,...(typeof detail === 'string' ? {detail} : {})};
  }), incidentCursor: rows.at(-1)?.id ?? latest };
}

/** Retry/reattach must not emit the same run result again, even after pruning. */
export function recordUpgradeIncident(db: RcmDatabase, runId: string, kind: 'upgrade_done' | 'upgrade_failed'): void {
  db.transaction(() => {
    const run = db.prepare(`SELECT chat_id,error FROM regeneration_runs WHERE id=? AND mode='upgrade'
      AND COALESCE(json_extract(preview_json, '$.incidents.${kind}'),0)=0`).get(runId) as {chat_id:string;error:string|null} | undefined;
    if (!run) return;
    db.prepare(`UPDATE regeneration_runs SET preview_json=json_set(COALESCE(preview_json,'{}'),'$.incidents.${kind}',1) WHERE id=?`).run(runId);
    recordIncident(db, {chatId:run.chat_id,kind,detail:run.error ?? undefined});
  })();
}
