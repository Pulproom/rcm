export interface ProcessingModel {
  site: 'server' | 'risu' | null;
  provider: string | null;
  slot: string | null;
  model: string | null;
}
export interface ProcessingTotals {
  calls: number | null;
  input: number | null;
  output: number | null;
  duration: number | null;
  missingTokens?: number;
}
export interface ProcessingCall extends ProcessingModel {
  sourceTransport?: import('./source-pdf.js').SourceTransport | null;
  id: string; jobId: string | null; purpose: string; at: number;
  input: number | null; output: number | null; duration: number | null;
  outcome: string; code: string | null; reason: string | null; repairOf: string | null;
  attempt: number | null; attemptOutcome: string | null; attemptReason: string | null;
  after?: boolean;
  attemptOnly?: boolean;
  attemptCount?: number;
  repairReason?: string | null;
}
export interface ProcessingStage extends ProcessingTotals { purpose: string; average: number | null; }
export interface ProcessingJob {
  id: string; type: string; status: string; at: number; start: number | null; end: number | null;
  turns: number | null; batch: number | null; calls: ProcessingCall[]; totals: ProcessingTotals;
  moreCalls: boolean; attempts: number; notes: string[]; technical: Record<string, unknown>;
}
export interface ProcessingUnit {
  id: string; chatId: string; chatTitle: string; kind: 'job' | 'run'; title: string; at: number;
  start: number | null; end: number | null; batchSize: number | null;
  totalBatches: number; completedBatches: number; status: string;
  models: ProcessingModel[]; totals: ProcessingTotals; stages: ProcessingStage[];
  jobs: ProcessingJob[]; repaired: ProcessingJob[]; rerun: ProcessingJob[];
  jobCount: number; repairJobCount: number; rerunJobCount: number; jobOffset: number;
  incomplete?: boolean;
  detailsLoaded?: boolean;
}
export interface ProcessingTranslationDay {
  day: string; items: number | null; models: ProcessingModel[]; totals: ProcessingTotals;
  average: number | null;
}
export interface ProcessingHistory {
  scope: 'chat' | 'all'; items: ProcessingUnit[]; nextOffset: number | null;
  today: ProcessingTotals & { chats: number | null; since: number };
  translations: ProcessingTranslationDay[]; nextTranslationOffset: number | null;
}

/** Internal backfill ids never override an explicit regeneration identity. */
export function processingRunId(payload: Record<string, any>): string | null {
  return payload.canonicalRegenerationRunId ?? payload.regenerationRunId ?? payload.upgradeRunId ?? payload.upgradePhase2RunId ?? payload.backfillRunId ?? null;
}
export const PROCESSING_BATCH_TYPES = ['extract', 'extract_episode', 'episode'] as const;
const stageOrder = ['extraction','episode_draft','episode_finalize','reconciliation','state_reconciliation','story_consolidation','relationship_projection','ledger_consistency','audit','initial_calibration','quiz','mcp_selector','translation','repair'];
export function processingStageOrder(purpose: string): number { const i=stageOrder.indexOf(purpose);return purpose==='repair'?1000:i<0?999:i; }
export function sumProcessingTotals(rows: ProcessingTotals[]): ProcessingTotals {
  const sum=(key:'calls'|'input'|'output'|'duration')=>{
    const known=rows.flatMap(row=>row[key]===null?[]:[row[key]!]);
    return known.length?known.reduce((a,b)=>a+b,0):null;
  };
  return {calls:sum('calls'),input:sum('input'),output:sum('output'),duration:sum('duration'),missingTokens:rows.reduce((n,r)=>n+(r.missingTokens??0),0)};
}
