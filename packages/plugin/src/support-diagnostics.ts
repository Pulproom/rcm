import { SETTINGS_FAILURE_GUIDANCE, settingsFailureCode, settingsFailureMessage } from "@rcm/shared";
import { MODEL_OUTPUT_TRUNCATED_MESSAGE } from "@rcm/shared";
declare const __RCM_DISTRIBUTION__: boolean;
import { CONNECTION_FAILURE_LABELS, connectionFailureReason, RISU_AUXILIARY_AUTH_FAILURE_MESSAGE, RISU_AUXILIARY_FAILURE_CODES, projectRisuAuxiliaryCallDiagnostic, type RisuAuxiliaryCallDiagnostic } from "@rcm/shared";
// Typed metadata is allowlisted; log text is sanitized at insertion.
const stages = ["settings_save", "voyage_save", "connection_test", "native_registration", "provider_manager_registration", "worker_queue", "worker_job", "auxiliary_call", "worker_heartbeat", "before_request", "dashboard_action"] as const;
const codes = [...Object.keys(SETTINGS_FAILURE_GUIDANCE), ...Object.keys(CONNECTION_FAILURE_LABELS), ...RISU_AUXILIARY_FAILURE_CODES, "REQUEST_FAILED", "REPAIR_BUDGET_EXHAUSTED", "UNCHANGED_INVALID_REPAIR", "INVALID_REPAIR_SYNTAX", "CHAT_NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN", "API_REVISION_MISMATCH", "SERVER_SETUP_REQUIRED", "MODEL_CALL_BUDGET_EXHAUSTED", "MCP_REGISTRATION_TIMEOUT", "MCP_REGISTRATION_REJECTED", "MODEL_OUTPUT_TRUNCATED", "REPLAY_BLOCKED"] as const;
const replayCheckLabels = {
  other_chat: "다른 채팅",
  epoch_changed: "기억 세대 변경",
  no_source_head: "원문 상태 확인 없음",
  source_repair: "전체 원문 보완 필요",
  turn_changed: "요청 턴 변경",
  source_changed: "원문 변경",
  settings_changed: "전달 설정 변경",
  packet_changed: "기억 패킷 불일치",
  no_prepared: "직전 준비 결과 없음",
  empty_unverified: "빈 기억 패킷 확인 실패",
} as const;
export type ReplayCheck = keyof typeof replayCheckLabels;
const kinds = ["extract", "extract_episode", "episode", "relationship_projection", "project_relationship", "story_consolidation", "initial_calibration", "embed", "social_knowledge", "social_backfill", "quiz", "audit_retry", "ledger_consistency", "memory_group", "memory_addition", ...Object.keys(replayCheckLabels)];
const purposes = ["extraction", "initial_calibration", "audit", "reconciliation", "state_response", "ledger_consistency", "relationship_projection", "story_consolidation", "episode_draft", "episode_finalize", "quiz", "memory_group"];
export type SupportStage = typeof stages[number];
export interface SupportDiagnostic { stage: SupportStage; code: string; httpStatus?: number; attempt?: number; kind?: string; target?: string; purpose?: string; risuCall?: RisuAuxiliaryCallDiagnostic; }
const integer = (value: unknown, min: number, max: number): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
const pick = (value: unknown, values: readonly string[]) => typeof value === "string" && values.includes(value) ? value : undefined;
export function supportFailure(stage: SupportStage, error: unknown, extra: { attempt?: number; kind?: string; target?: string; purpose?: string } = {}): SupportDiagnostic {
  const e = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown; risuCall?: unknown } | null;
  const message = typeof error === "string" ? error : typeof e?.message === "string" ? e.message : "";
  const code = pick(e?.code, codes) ?? codes.find(code => message.startsWith(`${code}:`) || message.startsWith(`Error: ${code}:`))
    ?? settingsFailureCode(error) ?? (e?.name === "AbortError" ? "ABORTED_OR_TIMEOUT" : e?.name === "ZodError" ? "VALIDATION_FAILED" : "UNKNOWN_ERROR");
  return { stage, code, risuCall: projectRisuAuxiliaryCallDiagnostic(e?.risuCall), httpStatus: integer(e?.status, 100, 599), attempt: integer(extra.attempt, 0, 1000), kind: pick(extra.kind, kinds), target: pick(extra.target, ["server", "risu", "mcp", "voyage"]), purpose: pick(extra.purpose, [...purposes, ...purposes.map(p => `${p}_repair`)]) };
}
export function shareDiagnostic(value: unknown): SupportDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const d = value as SupportDiagnostic;
  const stage = pick(d.stage, stages) as SupportStage | undefined;
  if (!stage) return undefined;
  const call = projectRisuAuxiliaryCallDiagnostic(d.risuCall);
  return { stage, risuCall: call ? { mode: call.mode, activeChatIdAvailable: call.activeChatIdAvailable,
    hostResolutionAvailable: call.hostResolutionAvailable, authPresent: call.authPresent } : undefined,
    code: pick(d.code, [...codes, "ABORTED_OR_TIMEOUT", "VALIDATION_FAILED"]) ?? "UNKNOWN_ERROR",
    httpStatus: integer(d.httpStatus, 100, 599), attempt: integer(d.attempt, 0, 1000), kind: pick(d.kind, kinds), target: pick(d.target, ["server", "risu", "mcp", "voyage"]), purpose: pick(d.purpose, [...purposes, ...purposes.map(p => `${p}_repair`)]) };
}
export function diagnosticReason(diagnostic?: SupportDiagnostic): string {
  if (!diagnostic) return "";
  const targets: Record<string, string> = { server: "서버", risu: "Risu", mcp: "MCP", voyage: "Voyage" };
  const labels: Record<string, string> = { REPLAY_BLOCKED: "다시 보낸 요청의 기억 확인 실패", REQUEST_FAILED: "요청 실패", AUXILIARY_AUTH_FAILED: RISU_AUXILIARY_AUTH_FAILURE_MESSAGE, AUXILIARY_PROVIDER_REJECTED: "보조 모델 요청 거절", AUXILIARY_MODEL_TIMEOUT: "보조 모델 시간 초과", AUXILIARY_STREAM_UNREADABLE: "보조 모델 스트림 읽기 실패", REPAIR_BUDGET_EXHAUSTED: "보완 횟수 소진", UNCHANGED_INVALID_REPAIR: "보완 후에도 응답이 유효하지 않음", INVALID_REPAIR_SYNTAX: "보완 응답 형식 오류", CHAT_NOT_FOUND: "채팅을 찾을 수 없음", UNAUTHORIZED: "인증 실패", FORBIDDEN: "접근 권한 없음", API_REVISION_MISMATCH: "서버·플러그인 API 버전 불일치", SERVER_SETUP_REQUIRED: "서버 연결 설정 필요", MODEL_CALL_BUDGET_EXHAUSTED: "모델 호출 예산 소진", MODEL_CONNECTION_FAILED: "모델 연결 실패", MCP_REGISTRATION_TIMEOUT: "도구 등록 시간 초과", MCP_REGISTRATION_REJECTED: "도구 등록 거절", MODEL_OUTPUT_TRUNCATED: MODEL_OUTPUT_TRUNCATED_MESSAGE, ABORTED_OR_TIMEOUT: "중단 또는 시간 초과", VALIDATION_FAILED: "형식 검증 실패", UNKNOWN_ERROR: "분류되지 않은 오류" };
  const reason = diagnostic.code in CONNECTION_FAILURE_LABELS ? connectionFailureReason(diagnostic.code, diagnostic.httpStatus)
    : (settingsFailureCode({code: diagnostic.code}) ? settingsFailureMessage({code: diagnostic.code}) : labels[diagnostic.code] ?? labels.UNKNOWN_ERROR) + (diagnostic.httpStatus ? ` · HTTP ${diagnostic.httpStatus}` : "");
  return [diagnostic.target ? targets[diagnostic.target] : "", reason,
    diagnostic.code === "REPLAY_BLOCKED" && diagnostic.kind ? replayCheckLabels[diagnostic.kind as ReplayCheck] : "",
    diagnostic.risuCall ? JSON.stringify(projectRisuAuxiliaryCallDiagnostic(diagnostic.risuCall)) : ""].filter(Boolean).join(" · ");
}
export const supportTime = (value: unknown) => integer(value, 0, 8_640_000_000_000_000);

/** Product-owned event codes only; never infer them from log prose. */
const supportEventLabels = {
  "UNCLASSIFIED_LOG": "이벤트 코드가 없는 기록 · 원문 제외",
  "CHAT_SYNC_FAILED": "채팅 정보 동기화 실패",
  "QUIZ_WIDGET_WARNING": "퀴즈 표시 중 경고",
  "WIDGET_CLOCK_SANITIZED": "호스트가 상태 창 시간 표시를 제거함",
  "WIDGET_CLOCK_FAILED": "상태 창 시간 갱신 실패",
  "EPISODE_ACTION_FAILED": "에피소드 작업 실패",
  "STATUS_WIDGET_UNAVAILABLE": "상태 창을 표시할 수 없음",
  "SETTINGS_MENU_UNAVAILABLE": "설정 메뉴 등록 실패",
  "WORKER_MENU_UNAVAILABLE": "작업 메뉴 갱신 실패",
  "MEMORY_LINKED": "원문에 연결해 기억 가져오기 완료",
  "MEMORY_TRANSPLANTED": "독립 기록으로 기억 이식 완료",
  "MEMORY_TRANSFER_FAILED": "기억 가져오기 실패",
  "MEMORY_REBUILD_REQUESTED": "기억 데이터 초기화 또는 재생성 요청 처리",
  "JOBS_REQUEUED": "실패 작업 재시도 준비 완료",
  "STATUS_WIDGET_RESTORE_FAILED": "대시보드 종료 후 상태 창 복원 실패",
  "LINEAGE_PREVIEW_FAILED": "기억 연결 미리보기 실패",
  "REGENERATION_PREPARATION_FAILED": "기억 재생성 준비 실패",
  "TOOL_REGISTRATION_UPDATE_FAILED": "기억 도구 등록 갱신 실패",
  "BACKUP_RESTORED": "기억 백업 복원 완료",
  "EMBEDDING_KEY_SAVED": "임베딩 키 확인 및 저장 완료",
  "CHAT_MODE_SAVED": "채팅 모드 로컬 저장 완료",
  "CONNECTION_CHECK_SUCCEEDED": "연결 확인 성공",
  "LINEAGE_MATCH_APPLIED": "원문 일치 확인 후 기억 연결 완료",
  "RETRIEVAL_DIAGNOSTICS_CHANGED": "채팅 진단 기록 설정 변경",
  "SETTINGS_SAVED": "설정 저장 확인 완료",
  "EMBEDDING_KEY_REMOVED": "임베딩 키 삭제 완료",
  "MODEL_KEY_REMOVED": "보조 모델 키 삭제 및 작업 일시정지",
  "DUPLICATE_REVIEW_RESOLVED": "중복 검토 처리 완료",
  "AUDIT_REQUEUED": "기억 검수 재시도 준비 완료",
  "LEDGER_ENTRY_REMOVED": "장부 기록 종료 또는 삭제 완료",
  "SOCIAL_BACKFILL_CHECKED": "지인 관계 정리 가능 여부 확인",
  "SOCIAL_BACKFILL_REQUESTED": "지인 관계 정리 요청 처리",
  "QUEUE_PAUSED": "사용자가 작업 일시정지",
  "QUEUE_RESUMED": "사용자가 작업 재개",
  "BACKFILL_ACKNOWLEDGED": "과거 대화 정리 결과 확인",
  "JOBS_CANCELLED": "기억 작업 취소 처리",
  "JOBS_ARCHIVED": "완료 작업 기록 정리",
  "SOURCES_RESTORED": "취소된 원문 처리 재개 준비",
  "STORY_DRAFT_BACKUP_FAILED": "줄거리 저장 후 재생성 초안 백업 실패",
  ...(typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__
    ? { MASK_BRIDGE_UNAVAILABLE: "Mask Local Tools 연결을 사용할 수 없음" } : {}),
  "ALERT_HOST_UNAVAILABLE": "알림 표시 기능 설치 실패",
  "PLUGIN_INITIALIZED": "RCM 초기화 완료",
  "LINEAGE_OPERATION_FAILED": "채팅 기억 연결 작업 실패",
  "LINEAGE_SETTINGS_SAVE_FAILED": "가져온 채팅 설정 저장 실패",
  "QUIZ_SETTINGS_SYNC_FAILED": "퀴즈 설정 동기화 실패",
  "INJECTION_CACHE_SAVE_FAILED": "전달 기억 확인용 캐시 저장 실패",
  "DELIVERY_RECEIPT_FAILED": "기억 전달 결과 기록 실패",
  "RETRIEVAL_TRACE_DELIVERED": "검색 진단 기록 전달 완료",
  "RETRIEVAL_TRACE_FAILED": "검색 진단 기록 전달 실패",
  "PREPARED_MEMORY_REUSED": "준비된 기억 재사용",
  "OUTPUT_SYNC_SKIPPED": "다른 채팅으로 이동해 응답 동기화 생략",
  "OUTPUT_SYNC_DEFERRED": "응답 저장 후 기억 동기화 보류",
  "EMPTY_PACKET_REUSED": "재시도에 준비된 빈 기억 재사용",
  "MEMORY_MARKER_MISSING": "RCM 표식이 없어 모델 요청 차단",
  "CATCH_UP_STATE_SAVE_FAILED": "과거 대화 처리 상태 저장 실패",
  "SERVER_IDENTITY_SAVE_FAILED": "서버 식별 정보 저장 실패",
  "PREPARE_FALLBACK": "기억 준비가 완료되지 않아 대체 경로 처리",
  "MEMORY_INJECTED": "메인 요청에 기억 주입 완료",
  "MEMORY_OMITTED": "메인 요청에서 기억 주입 생략",
  "OUTPUT_OBSERVATION_FAILED": "응답 저장 완료 확인 실패",
  "SETUP_NOTICE_FAILED": "설정 재료 안내 표시 실패",
  "SETUP_NOTICE_SAVE_FAILED": "설정 재료 안내 상태 저장 실패",
  "SETUP_CAPTURE_CLEANUP_FAILED": "이전 설정 캡처 정리 실패",
  "INCIDENT_CURSOR_SAVE_FAILED": "알림 확인 위치 저장 실패",
  "ALERT_RENDER_FAILED": "알림 표시 실패",
  "TRANSLATION_CONTEXT_MISSING": "번역할 채팅 정보 확인 실패",
  "TRANSLATION_WARNING": "참고 번역 중 경고",
  "AUTO_PAUSE_SAVE_FAILED": "자동 일시정지 상태 저장 실패",
  "WORKER_RECOVERY_FAILED": "복구된 서버 작업 상태 확인 실패",
  "MODEL_JSON_REPAIRED": "모델 응답 JSON 문법 자동 보완",
  "MAIN_GENERATION_IDLE_TIMEOUT": "3분간 생성 변화가 없어 보조 작업 대기 해제",
  "MODEL_CALL_RECORD_FAILED": "보조 모델 호출 결과 기록 실패",
  "STATE_RESPONSE_INVALID": "상태 응답 검증 실패",
  "STATE_RESPONSE_RECOVERED": "상태 응답 보완 처리",
  "JOB_LEASE_RENEWAL_FAILED": "작업 처리 권한 갱신 실패",
  "DIALOGUE_SOURCE_REPAIR_FAILED": "대사 원문 보완 미해결",
  "SOURCE_REPAIR_FAILED": "원문 보완 미해결",
  "RECOGNITION_REFERENCE_REVIEW": "일부 인지 참조를 검토 대상으로 보존",
  "SOURCE_ACCESS_REPAIR_FAILED": "원문 접근 근거 보완 미해결",
  "JOB_COMPLETED_WITH_WARNINGS": "보조 작업 완료 후 경고",
  "JOB_COMPLETED": "보조 작업 완료",
  "JOB_RETRY_SCHEDULED": "기억 작업 재시도 예정",
  "RELATIONSHIP_PROJECTION_FAILED": "관계 요약 갱신 실패",
  "STORY_CONSOLIDATION_FAILED": "줄거리 생성 실패",
  "MEMORY_GROUPING_FAILED": "기억 묶기 후보 생성 실패",
  "LEDGER_AUDIT_FAILED": "최종 장부 대조 실패",
  "QUIZ_JOB_DEFERRED": "퀴즈 작업 보류",
  "CHAT_WORK_DEFERRED": "해당 채팅 후속 기억 처리 보류",
  "PROVIDER_MANAGER_IPC_MISSING": "Provider Manager 연결용 통신 API 없음",
  "PROVIDER_MANAGER_RECOVERED": "Provider Manager 기억 도구 등록 복구"
} as const;
export type SupportEvent = keyof typeof supportEventLabels;
export function shareLog(log: { at?: unknown; level?: unknown; event?: unknown; diagnostic?: unknown }) {
  const event = typeof log.event === "string" && Object.hasOwn(supportEventLabels, log.event)
    ? log.event as SupportEvent : "UNCLASSIFIED_LOG";
  const diagnostic = shareDiagnostic(log.diagnostic);
  return {
    at: new Date(supportTime(log.at) ?? 0).toISOString(),
    level: pick(log.level, ["info", "warn", "error"]) ?? "unknown",
    event: diagnostic && event === "UNCLASSIFIED_LOG" ? undefined : event,
    diagnostic,
    reason: diagnostic ? diagnosticReason(diagnostic) : supportEventLabels[event],
  };
}
export function supportJobs(jobs: any[] = []) {
  return jobs.filter(job => job.status === "failed" || job.last_error).slice(0, 20).map(job => {
    let payload: any = {};
    try { payload = JSON.parse(job.payload_json ?? "{}"); } catch { /* no raw payload in reports */ }
    const calls = Array.isArray(payload?.llmCallDiagnostics) ? payload.llmCallDiagnostics : [];
    return { ...shareDiagnostic(supportFailure("worker_job", job.last_error, { kind: job.type, attempt: job.attempts })), at: supportTime(job.updated_at),
      calls: calls.filter((call: any) => call?.outcome === "failed").slice(-10).map((call: any) => ({
        at: supportTime(call.at), ...shareDiagnostic(supportFailure("worker_job", { message: call.error, code: call.code, status: call.httpStatus, risuCall: call.risuCall }, { attempt: call.attempt, purpose: call.purpose })),
      })),
    };
  });
}

/** Shared by dashboard failures and the expanded floating status detail. */
export function modelResponseFailureDetail(diagnostic: import("@rcm/shared").ModelResponseDiagnostic | undefined, escape: (value: string) => string): string {
  if (!diagnostic) return "";
  const structure = `응답 ${diagnostic.length}자 · {로 시작 ${diagnostic.startsWithObject ? "예" : "아니요"} · 괄호 균형 ${diagnostic.balancedBraces ? "맞음" : "불일치"}${diagnostic.parseErrorPosition === undefined ? "" : ` · JSON 오류 위치 ${diagnostic.parseErrorPosition}`}`;
  return `<div style="margin-top:8px;overflow-wrap:anywhere"><p class="sub">${escape(structure)}</p>${diagnostic.rawResponse === undefined ? "" : `<b>모델 응답 원문</b><p style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(diagnostic.rawResponse)}</p><p class="sub">모델이 요청을 거절했을 수 있어요. 보조 모델 또는 프롬프트를 확인해 주세요.</p>`}</div>`;
}
