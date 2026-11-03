export interface GapRecoveryHole { turnCount?: number; startTurn?: number; endTurn?: number; sourceMessageIds: string[]; startOrdinal: number; endOrdinal: number }
export interface GapRecoveryQueue {
  holeCount: number; messageCount: number; queuedMessages: number;
  jobs: Array<{jobId:string;hole:number;startOrdinal:number;endOrdinal:number;messageCount:number}>;
}
export interface GapRecoveryStatus {
  holeCount:number; messageCount:number; holes:GapRecoveryHole[];
  results:Array<{turnCount?:number;startTurn?:number;endTurn?:number;jobId:string;status:string;error:string|null;sourceMessageIds:string[];startOrdinal:number;endOrdinal:number;canRetry:boolean;
    result:{outcome:'created'|'nothing_to_add';memories:Array<{id:string;title:string}>}|null}>;
}
export interface AlwaysInjectEstimate { items:Array<{memoryId:string;estimatedTokens:number}>; estimatedTokens:number }
