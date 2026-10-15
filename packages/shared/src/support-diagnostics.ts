import { parseStructuredModelJson } from "./structured-json.js";

export interface ModelResponseDiagnostic {
  length: number;
  startsWithObject: boolean;
  balancedBraces: boolean;
  parseErrorPosition?: number;
  rawResponse?: string;
}

/** Only model output belongs here: never pass prompts or provider error bodies. */
export function describeModelResponse(output: string, secrets: readonly string[] = []): ModelResponseDiagnostic {
  const stack: string[] = [];
  let inString = false, escaped = false, balanced = true;
  for (const char of output) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      if (stack.pop() !== (char === "}" ? "{" : "[")) balanced = false;
    }
  }
  let parseErrorPosition: number | undefined;
  try { parseStructuredModelJson(output); }
  catch (error) {
    const position = /position\s+(\d+)/i.exec(error instanceof Error ? error.message : "")?.[1];
    if (position !== undefined) parseErrorPosition = Number(position);
  }
  return { length: output.length, startsWithObject: output.trimStart().startsWith("{"),
    balancedBraces: balanced && !inString && stack.length === 0, parseErrorPosition,
    ...(output.length <= 600 ? { rawResponse: sanitizeDiagnosticText(output, secrets, 600, true) } : {}) };
}

/** Redact before truncating, including secrets crossing the length boundary. */
export function sanitizeDiagnosticText(value: string, secrets: readonly string[] = [], limit = 200, preserveWhitespace = false): string {
  let text = value;
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join("[가림]");
    const escaped = JSON.stringify(secret).slice(1, -1);
    if (escaped !== secret) text = text.split(escaped).join("[가림]");
  }
  text = text
    .replace(/https?:\/\/[^\s<>"']+/gi, "[주소]")
    .replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [가림]")
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, "[가림]")
    .replace(/\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[가림]")
    .replace(/[a-zA-Z0-9_+\/=-]{32,}/g, token => /^(?:(?:requestId|eventId)=)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token) ? token : "[가림]")
    .replace(/[A-Za-z]:\\[^\s<>"']+/g, "[경로]");
  return (preserveWhitespace ? text : text.replace(/\s+/g, " ").trim()).slice(0, limit);
}
export const CONNECTION_FAILURE_LABELS = {
  ENDPOINT_MISSING: "LLM 주소가 비어 있음", AUTH_FAILED: "인증 실패", MODEL_NOT_FOUND: "모델이나 주소를 찾을 수 없음",
  RATE_LIMITED: "요청 한도 초과", PROVIDER_HTTP_ERROR: "모델 서버 오류", TIMEOUT: "시간 초과",
  NETWORK_ERROR: "네트워크 연결 실패", INVALID_RESPONSE: "응답 형식 오류", INVALID_CONFIG: "연결 설정 확인 필요",
} as const;
export type ConnectionFailureCode = keyof typeof CONNECTION_FAILURE_LABELS;

export const RISU_AUXILIARY_AUTH_FAILURE_MESSAGE = "보조 모델 인증 실패: Risu 보조 모델 설정의 API 키를 확인해 주세요";
export const RISU_AUXILIARY_FAILURE_CODES = ["AUXILIARY_AUTH_FAILED", "AUXILIARY_PROVIDER_REJECTED", "MODEL_CONNECTION_FAILED", "AUXILIARY_MODEL_TIMEOUT", "AUXILIARY_STREAM_UNREADABLE"] as const;

/** Provider protocol errors only, never a classifier for RP prose or model output. */
export function isProviderAuthenticationError(error: unknown): boolean {
  const value = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (value?.status === 401 || value?.code === "AUXILIARY_AUTH_FAILED" || value?.code === "invalid_api_key" || value?.code === "authentication_error") return true;
  const message = typeof error === "string" ? error : typeof value?.message === "string" ? value.message : "";
  return /\b(?:AUXILIARY_AUTH_FAILED|invalid_api_key|401\s+Unauthorized)\b|You didn't provide an API key|Incorrect API key provided|\b(?:invalid|missing)\s+x-api-key\b|\bx-api-key\s+(?:is\s+)?(?:invalid|missing|required)\b/i.test(message);
}

export function isProviderContextLimitError(error: unknown): boolean {
  const message = typeof error === "string" ? error : (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && /context_length_exceeded|context (?:length|window)|too many (?:input )?tokens|input token.{0,80}(?:exceed|limit)/i.test(message);
}

export function isPermanentProviderError(error: unknown): boolean {
  const value = error as { status?: unknown; message?: unknown; code?: unknown; finishReason?:unknown; refusal?:unknown } | null;
  const message = typeof error === "string" ? error : typeof value?.message === "string" ? value.message : "";
  // Provider/protocol markers, never natural-language story inference.
  return isProviderAuthenticationError(error) || isProviderContextLimitError(error) || [400, 403, 404, 413, 422].includes(Number(value?.status)) || value?.code === "AUXILIARY_PROVIDER_REJECTED"
    || value?.refusal === true || providerBlockedFinishReason(value?.finishReason)
    || /AUXILIARY_PROVIDER_REJECTED|returned\s+(?:400|401|403|404|413|422)\b|HTTP\s+(?:400|401|403|404|413|422)\b|context (?:length|window)|context_length_exceeded|(?:maximum|max|exceed(?:s|ed)?).{0,24}context|too many (?:input )?tokens|input.{0,20}too (?:large|long)|payload too large/i.test(message);
}

export interface ProviderFailureMetadata { status?: number; code?: string; finishReason?: string; refusal?: boolean; retryAfterMs?: number }
export function providerFailureMetadata(error: unknown): ProviderFailureMetadata {
  const value = error as ProviderFailureMetadata | null;
  return {
    ...(Number.isInteger(value?.status) && Number(value?.status)>=100 && Number(value?.status)<=599 ? {status:value!.status} : {}),
    ...(typeof value?.code==='string' ? {code:value.code.slice(0,80)} : {}),
    ...(typeof value?.finishReason==='string' ? {finishReason:value.finishReason.slice(0,80)} : {}),
    ...(value?.refusal===true ? {refusal:true} : {}),
    ...(typeof value?.retryAfterMs==='number' && Number.isFinite(value.retryAfterMs) && value.retryAfterMs>=0 ? {retryAfterMs:value.retryAfterMs} : {}),
  };
}
function providerBlockedFinishReason(reason:unknown):boolean {
  return ['SAFETY','CONTENT_FILTER','REFUSAL','BLOCKLIST','PROHIBITED_CONTENT','RECITATION','SPII','IMAGE_SAFETY'].includes(String(reason ?? '').toUpperCase());
}
/** Read only provider-owned protocol fields, never infer refusal from prose. */
export function assertProviderOutputAllowed(finishReason:unknown, refusal:unknown):void {
  if(!providerBlockedFinishReason(finishReason) && !refusal) return;
  throw Object.assign(new Error(`AUXILIARY_PROVIDER_REJECTED: ${refusal ? 'structured refusal' : String(finishReason)}; change the model or settings before retrying`),
    {code:'AUXILIARY_PROVIDER_REJECTED',finishReason: typeof finishReason==='string' ? finishReason : undefined,refusal:Boolean(refusal)});
}

export interface RisuAuxiliaryCallDiagnostic {
  jobId?: string;
  jobChatId?: string;
  activeChatId?: string;
  activeChatIdAvailable: boolean;
  mode: "model" | "memory" | "otherAx" | "translate" | "emotion" | "submodel";
  staticModel?: string;
  hostResolutionAvailable: boolean;
  model?: string;
  provider?: string;
  authPresent?: boolean;
}

/** Allowlist host metadata; never inspect credentials, headers or request/response bodies. */
export function projectRisuAuxiliaryCallDiagnostic(value: unknown): RisuAuxiliaryCallDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (!["model", "memory", "otherAx", "translate", "emotion", "submodel"].includes(String(raw.mode))) return undefined;
  const text = (key: string) => typeof raw[key] === "string" && raw[key] ? sanitizeDiagnosticText(raw[key] as string, [], 160) : undefined;
  const activeChatId = raw.activeChatIdAvailable === true ? text("activeChatId") : undefined;
  const model = raw.hostResolutionAvailable === true ? text("model") : undefined;
  const provider = raw.hostResolutionAvailable === true ? text("provider") : undefined;
  const authPresent = raw.hostResolutionAvailable === true && typeof raw.authPresent === "boolean" ? raw.authPresent : undefined;
  return { jobId: text("jobId"), jobChatId: text("jobChatId"), activeChatId, activeChatIdAvailable: Boolean(activeChatId),
    mode: raw.mode as RisuAuxiliaryCallDiagnostic["mode"], staticModel: text("staticModel"),
    hostResolutionAvailable: Boolean(model || provider || authPresent !== undefined), model, provider, authPresent };
}
export function connectionFailureReason(code: string, status?: number): string {
  const label = CONNECTION_FAILURE_LABELS[code as ConnectionFailureCode] ?? "연결 확인 실패";
  return label + (status ? ` · HTTP ${status}` : "");
}
