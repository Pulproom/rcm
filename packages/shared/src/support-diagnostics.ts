/** Redact before truncating, including secrets crossing the length boundary. */
export function sanitizeDiagnosticText(value: string, secrets: readonly string[] = [], limit = 200): string {
  let text = value;
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join("[가림]");
    const escaped = JSON.stringify(secret).slice(1, -1);
    if (escaped !== secret) text = text.split(escaped).join("[가림]");
  }
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, "[주소]")
    .replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [가림]")
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, "[가림]")
    .replace(/\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[가림]")
    .replace(/[a-zA-Z0-9_+\/=-]{32,}/g, token => /^(?:(?:requestId|eventId)=)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token) ? token : "[가림]")
    .replace(/[A-Za-z]:\\[^\s<>"']+/g, "[경로]")
    .replace(/\s+/g, " ").trim().slice(0, limit);
}
export const CONNECTION_FAILURE_LABELS = {
  ENDPOINT_MISSING: "LLM 주소가 비어 있음", AUTH_FAILED: "인증 실패", MODEL_NOT_FOUND: "모델이나 주소를 찾을 수 없음",
  RATE_LIMITED: "요청 한도 초과", PROVIDER_HTTP_ERROR: "모델 서버 오류", TIMEOUT: "시간 초과",
  NETWORK_ERROR: "네트워크 연결 실패", INVALID_RESPONSE: "응답 형식 오류", INVALID_CONFIG: "연결 설정 확인 필요",
} as const;
export type ConnectionFailureCode = keyof typeof CONNECTION_FAILURE_LABELS;
export function connectionFailureReason(code: string, status?: number): string {
  const label = CONNECTION_FAILURE_LABELS[code as ConnectionFailureCode] ?? "연결 확인 실패";
  return label + (status ? ` · HTTP ${status}` : "");
}
