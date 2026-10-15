export const JOB_KIND_VALUES = ["extract", "audit_retry", "episode", "memory_group", "social_backfill", "initial_calibration", "relationship_projection", "story_consolidation", "ledger_consistency", "quiz"] as const;
export type JobKind = typeof JOB_KIND_VALUES[number];
export const JOB_PIPELINE_STAGE_VALUES = ["queued", "retrying", "first_extraction", "post_extraction_audit", "state_reconciliation", "ledger_consistency", "relationship_projection", "story_consolidation", "storing", "complete", "failed"] as const;
export type JobPipelineStage = typeof JOB_PIPELINE_STAGE_VALUES[number];
export const WORKER_PHASE_VALUES = ["idle", "first_extraction", "initial_calibration", "relationship_projection", "story_consolidation", "social_backfill", "capsule", "post_extraction_audit", "state_reconciliation", "ledger_consistency", "storing", "faulted", "paused"] as const;
export type WorkerPhase = typeof WORKER_PHASE_VALUES[number];
export const AUXILIARY_PURPOSE_VALUES = ["quiz", "memory_group", "memory_group_repair", "extraction", "extraction_repair", "initial_calibration", "initial_calibration_repair", "audit", "audit_repair", "reconciliation", "reconciliation_repair", "state_response_repair", "ledger_consistency", "ledger_consistency_repair", "relationship_projection", "relationship_projection_repair", "story_consolidation", "story_consolidation_repair", "episode_draft", "episode_draft_repair", "episode_finalize", "episode_finalize_repair"] as const;
export type AuxiliaryPurpose = typeof AUXILIARY_PURPOSE_VALUES[number];

/** One vocabulary for job, phase and call surfaces; identifiers stay in diagnostics. */
export const OPERATION_LABELS = {
  extract: "대화 기억 정리", extract_episode: "대화 기억 정리", episode: "에피소드 정리",
  memory_addition: "기억 추가", memory_group: "대화 묶음 나누기", memory_group_repair: "묶음 응답 형식 보완",
  extraction: "대화에서 기억 찾기", extraction_repair: "응답 형식 보완",
  initial_calibration: "초기 인물 설정", initial_calibration_repair: "초기 설정 응답 보완",
  audit_retry: "추출 재검수", audit: "추출 결과 재검수", audit_repair: "재검수 응답 보완",
  source_recovery: "원문 발췌 보완",
  reconciliation: "상태 추출·기억 대조", state_reconciliation: "세계·인식·약속 대조",
  reconciliation_repair: "상태 대조·접근 근거 보완", state_response_repair: "상태 응답 형식 보완",
  ledger_consistency: "최종 장부 대조", ledger_consistency_repair: "장부 응답 형식 보완",
  relationship_projection: "관계 상태 갱신", project_relationship: "관계 상태 갱신",
  relationship_projection_repair: "관계 응답 형식 보완",
  story_consolidation: "줄거리 갱신", story_consolidation_repair: "줄거리 응답 형식 보완",
  episode_draft: "장면 기억 초안", episode_draft_repair: "장면 초안 응답 보완",
  episode_finalize: "장면 기억 마무리", episode_finalize_repair: "장면 응답 형식 보완",
  social_backfill: "지인 관계 다시 찾기", social_knowledge: "지인 관계 정리",
  quiz: "퀴즈 만들기", embed: "검색 색인 갱신",
  queued: "대기", retrying: "자동 재시도", first_extraction: "1차 기억 추출",
  post_extraction_audit: "추출 재검수", storing: "기억 반영", complete: "전체 단계 완료",
  idle: "대기", paused: "일시정지", faulted: "오류", failed: "실패", leased: "처리 중",
  done: "완료", completed: "완료", cancelled: "취소됨", superseded: "교체됨", archived: "보관됨",
  capsule: "에피소드 정리",
} satisfies Record<JobKind | JobPipelineStage | WorkerPhase | AuxiliaryPurpose, string> & Record<string, string>;

export function operationLabel(value: unknown): string {
  return typeof value === "string" && Object.hasOwn(OPERATION_LABELS, value)
    ? OPERATION_LABELS[value as keyof typeof OPERATION_LABELS] : "기억 처리";
}
