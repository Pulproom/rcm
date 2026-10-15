import { CONNECTION_FAILURE_LABELS, connectionFailureReason, RISU_AUXILIARY_AUTH_FAILURE_MESSAGE, RISU_AUXILIARY_FAILURE_CODES, projectRisuAuxiliaryCallDiagnostic, type RisuAuxiliaryCallDiagnostic } from "@rcm/shared";
// Typed metadata is allowlisted; log text is sanitized at insertion.
const stages = ["settings_save", "voyage_save", "connection_test", "native_registration", "provider_manager_registration", "worker_queue", "worker_job", "auxiliary_call", "worker_heartbeat", "before_request", "dashboard_action"] as const;
const codes = [...Object.keys(CONNECTION_FAILURE_LABELS), ...RISU_AUXILIARY_FAILURE_CODES, "REQUEST_FAILED", "REPAIR_BUDGET_EXHAUSTED", "UNCHANGED_INVALID_REPAIR", "INVALID_REPAIR_SYNTAX", "CHAT_NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN", "API_REVISION_MISMATCH", "SERVER_SETUP_REQUIRED", "MODEL_CALL_BUDGET_EXHAUSTED", "MCP_REGISTRATION_TIMEOUT", "MCP_REGISTRATION_REJECTED", "MODEL_OUTPUT_TRUNCATED"] as const;
const kinds = ["extract", "extract_episode", "episode", "relationship_projection", "project_relationship", "story_consolidation", "initial_calibration", "embed", "social_knowledge", "social_backfill", "quiz", "audit_retry", "ledger_consistency", "memory_group", "memory_addition"];
const purposes = ["extraction", "initial_calibration", "audit", "reconciliation", "state_response", "ledger_consistency", "relationship_projection", "story_consolidation", "episode_draft", "episode_finalize", "quiz", "memory_group"];
export type SupportStage = typeof stages[number];
export interface SupportDiagnostic { stage: SupportStage; code: string; httpStatus?: number; attempt?: number; kind?: string; target?: string; purpose?: string; risuCall?: RisuAuxiliaryCallDiagnostic; }
const integer = (value: unknown, min: number, max: number): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
const pick = (value: unknown, values: readonly string[]) => typeof value === "string" && values.includes(value) ? value : undefined;
export function supportFailure(stage: SupportStage, error: unknown, extra: { attempt?: number; kind?: string; target?: string; purpose?: string } = {}): SupportDiagnostic {
  const e = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown; risuCall?: unknown } | null;
  const message = typeof error === "string" ? error : typeof e?.message === "string" ? e.message : "";
  const code = pick(e?.code, codes) ?? codes.find(code => message.startsWith(`${code}:`) || message.startsWith(`Error: ${code}:`))
    ?? (e?.name === "AbortError" ? "ABORTED_OR_TIMEOUT" : e?.name === "ZodError" ? "VALIDATION_FAILED" : "UNKNOWN_ERROR");
  return { stage, code, risuCall: projectRisuAuxiliaryCallDiagnostic(e?.risuCall), httpStatus: integer(e?.status, 100, 599), attempt: integer(extra.attempt, 0, 1000), kind: pick(extra.kind, kinds), target: pick(extra.target, ["server", "risu", "mcp", "voyage"]), purpose: pick(extra.purpose, [...purposes, ...purposes.map(p => `${p}_repair`)]) };
}
export function shareDiagnostic(value: unknown): SupportDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const d = value as SupportDiagnostic;
  const stage = pick(d.stage, stages) as SupportStage | undefined;
  if (!stage) return undefined;
  return { stage, risuCall: projectRisuAuxiliaryCallDiagnostic(d.risuCall), code: pick(d.code, [...codes, "ABORTED_OR_TIMEOUT", "VALIDATION_FAILED"]) ?? "UNKNOWN_ERROR",
    httpStatus: integer(d.httpStatus, 100, 599), attempt: integer(d.attempt, 0, 1000), kind: pick(d.kind, kinds), target: pick(d.target, ["server", "risu", "mcp", "voyage"]), purpose: pick(d.purpose, [...purposes, ...purposes.map(p => `${p}_repair`)]) };
}
export function diagnosticReason(diagnostic?: SupportDiagnostic): string {
  if (!diagnostic) return "";
  const targets: Record<string, string> = { server: "서버", risu: "Risu", mcp: "MCP", voyage: "Voyage" };
  const labels: Record<string, string> = { REQUEST_FAILED: "요청 실패", AUXILIARY_AUTH_FAILED: RISU_AUXILIARY_AUTH_FAILURE_MESSAGE, AUXILIARY_PROVIDER_REJECTED: "보조 모델 요청 거절", AUXILIARY_MODEL_TIMEOUT: "보조 모델 시간 초과", AUXILIARY_STREAM_UNREADABLE: "보조 모델 스트림 읽기 실패", REPAIR_BUDGET_EXHAUSTED: "보완 횟수 소진", UNCHANGED_INVALID_REPAIR: "보완 후에도 응답이 유효하지 않음", INVALID_REPAIR_SYNTAX: "보완 응답 형식 오류", CHAT_NOT_FOUND: "채팅을 찾을 수 없음", UNAUTHORIZED: "인증 실패", FORBIDDEN: "접근 권한 없음", API_REVISION_MISMATCH: "서버·플러그인 API 버전 불일치", SERVER_SETUP_REQUIRED: "서버 연결 설정 필요", MODEL_CALL_BUDGET_EXHAUSTED: "모델 호출 예산 소진", MODEL_CONNECTION_FAILED: "모델 연결 실패", MCP_REGISTRATION_TIMEOUT: "도구 등록 시간 초과", MCP_REGISTRATION_REJECTED: "도구 등록 거절", MODEL_OUTPUT_TRUNCATED: "모델 응답 잘림", ABORTED_OR_TIMEOUT: "중단 또는 시간 초과", VALIDATION_FAILED: "형식 검증 실패", UNKNOWN_ERROR: "분류되지 않은 오류" };
  const reason = diagnostic.code in CONNECTION_FAILURE_LABELS ? connectionFailureReason(diagnostic.code, diagnostic.httpStatus)
    : (labels[diagnostic.code] ?? labels.UNKNOWN_ERROR) + (diagnostic.httpStatus ? ` · HTTP ${diagnostic.httpStatus}` : "");
  return [diagnostic.target ? targets[diagnostic.target] : "", reason, diagnostic.risuCall ? JSON.stringify(projectRisuAuxiliaryCallDiagnostic(diagnostic.risuCall)) : ""].filter(Boolean).join(" · ");
}
export const supportTime = (value: unknown) => integer(value, 0, 8_640_000_000_000_000);
export function supportJobs(jobs: any[] = []) {
  return jobs.filter(job => job.status === "failed" || job.last_error).slice(0, 20).map(job => {
    let payload: any = {};
    try { payload = JSON.parse(job.payload_json ?? "{}"); } catch { /* no raw payload in reports */ }
    const calls = Array.isArray(payload?.llmCallDiagnostics) ? payload.llmCallDiagnostics : [];
    return { ...supportFailure("worker_job", job.last_error, { kind: job.type, attempt: job.attempts }), at: supportTime(job.updated_at),
      calls: calls.filter((call: any) => call?.outcome === "failed").slice(-10).map((call: any) => ({
        at: supportTime(call.at), ...supportFailure("worker_job", { message: call.error, code: call.code, status: call.httpStatus, risuCall: call.risuCall }, { attempt: call.attempt, purpose: call.purpose }),
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
