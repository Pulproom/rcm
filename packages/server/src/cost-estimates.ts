import type { RcmDatabase } from './db.js';

export function estimateRelationshipCalls(db:RcmDatabase,chatId:string):number {
  const row=db.prepare(`SELECT count(*) count FROM (SELECT from_entity,to_entity FROM relationship_events WHERE chat_id=? AND active=1
    UNION SELECT from_entity,to_entity FROM relationship_projections WHERE chat_id=?)`).get(chatId,chatId) as {count:number};
  return Math.ceil(row.count/4);
}
export function estimateFailedJobCalls(db:RcmDatabase,chatId:string) {
  const rows=db.prepare("SELECT type,payload_json FROM jobs WHERE chat_id=? AND status='failed'").all(chatId) as Array<{type:string;payload_json:string}>;
  const byType:Record<string,number>={};
  for(const row of rows) {
    const p=JSON.parse(row.payload_json), checkpoint=p.validatedPreReconciliationCheckpoint || p.risuStageCheckpoints?.audit;
    const calls=row.type==='extract' || row.type==='memory_addition'
      ? (p.validatedExtractionCheckpoint || p.risuStageCheckpoints?.extraction ? 0 : 1)+(p.postExtractionReview && !checkpoint ? 1 : 0)+(row.type==='extract' && !p.sourceRecovery && !p.memoryOnly ? 1 : 0)
      : Math.max(1,Number(p.plannedParts ?? 1)-Number(p.completedParts ?? 0));
    byType[row.type]=(byType[row.type] ?? 0)+calls;
  }
  return {jobs:rows.length,byType,total:Object.values(byType).reduce((a,b)=>a+b,0)};
}
