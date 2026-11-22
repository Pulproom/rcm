import { sanitizeDiagnosticText, CHAT_WORK_HELD_MESSAGE } from "@rcm/shared";

export const HOST_FETCH_REJECTION_MESSAGE = "Risu가 RCM 서버로 가는 요청을 전달하지 못했어요. Risu 앱 쪽에서 요청을 거절했을 수 있어요.";

/** Product-owned server codes only; never infer a cause from provider prose. */
export function upgradeErrorReason(code: string | undefined): string {
  const reasons: Record<string, string> = {
    SOURCE_SNAPSHOT_HELD: '원문 확인 필요',
    CHAT_WORK_OFF: CHAT_WORK_HELD_MESSAGE,
    SOURCE_MISSING: '다시 만들 원문이 부족해요.',
    SETUP_UNAVAILABLE: '초기 설정을 불러올 수 없어요.',
    BUSY: '이 채팅에서 다른 기억 작업이 진행 중이에요.',
    ALREADY_CURRENT: '이미 새 버전으로 만든 기억이에요.',
    UPGRADE_ACTIVE: '이미 새 버전으로 다시 만드는 중이에요.',
    PHASE_LOCKED: '마무리하는 단계는 멈출 수 없어요.',
    BACKUP_FAILED: '채팅 백업을 만들지 못했어요.',
    RUN_NOT_FOUND: '다시 만들기 기록을 찾을 수 없어요.',
    RUN_NOT_RESUMABLE: '이 작업은 이어서 만들 수 없어요.',
    SHADOW_REVIEW_REQUIRED: '새 기억에 확인이 필요한 항목이 있어요.',
    SOURCE_CHANGED: '다시 만드는 동안 원문이 바뀌었어요.',
    RUN_NOT_READY: '아직 마무리할 준비가 되지 않았어요.',
    NO_REGENERATION_WORK: '다시 만들 기억 작업을 준비하지 못했어요.',
    PROVIDER_ERROR: '보조 모델이 요청을 마치지 못했어요.',
  };
  return reasons[code ?? ''] ?? '기억 작업 중 오류가 생겼어요.';
}

export interface ServerErrorContext {
  time: string;
  method: string;
  methodOverride?: string;
  path: string;
  server: string;
  timeoutMs: number | null;
  elapsedMs: number;
  pluginVersion: string;
  apiRevision: number;
  serverVersion?: string;
  serverApiRevision?: number;
  capabilities?: Record<string, boolean>;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ServerRequestError && error.code === 'NOW_ALWAYS_INJECT_LIMIT') return '항상 전달은 5개까지예요';
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : String(error ?? "");
  if (message.trim()) return message;
  return error instanceof ServerRequestError ? `${upgradeErrorReason(error.code)} (HTTP ${error.status})` : "오류 이유가 전달되지 않았어요. 오류 자세히를 복사해 알려 주세요.";
}

// Only used for exceptions from nativeFetch, never for response JSON parsing.
export function isHostFetchSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError || Boolean(error && typeof error === "object"
    && "name" in error && error.name === "SyntaxError" && "message" in error && typeof error.message === "string");
}

export function safeErrorText(value: string, secrets: readonly string[] = []): string {
  // JS engines can include a quoted response fragment in JSON parser errors.
  return sanitizeDiagnosticText(value.replace(/(["'`]).*?\1/gs, "[인용 생략]")
    .replace(/\?[^\s]*/g, "?[생략]"), secrets, 1000);
}

export class ServerRequestError extends Error {
  readonly time = new Date().toISOString();
  constructor(message: string, readonly status: number, readonly code?: string, readonly expectedApiRevision?: number,
    readonly rejectedItems?: Array<{ id: string; reason: string }>, readonly context?: ServerErrorContext,
    readonly serverSummary?: string, readonly retryAfterMs?: number, readonly revision?: number) { super(message); this.name = "ServerRequestError"; }
}

/** Retry-After owns HTTP delay-seconds or an HTTP date, never provider prose. */
export function retryAfterMs(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const delay = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}

export class ServerConnectionError extends Error {
  readonly time = new Date().toISOString();
  readonly classification: "host_json_syntax" | "connection";
  readonly originalMessage: string;
  constructor(error: unknown, readonly context?: ServerErrorContext, secrets: readonly string[] = [], hostSyntax = false) {
    const originalMessage = safeErrorText(errorMessage(error), secrets);
    super(hostSyntax ? HOST_FETCH_REJECTION_MESSAGE : originalMessage, { cause: error });
    this.name = "ServerConnectionError";
    this.classification = hostSyntax ? "host_json_syntax" : "connection";
    this.originalMessage = originalMessage;
  }
}

/** One allowlisted, plain-text report for every dashboard error surface. No object serialization. */
export function formatServerError(error: unknown): string {
  if (!(error instanceof ServerConnectionError || error instanceof ServerRequestError)) return "";
  const c = error.context;
  const rows: Array<[string, unknown]> = [["time", c?.time ?? error.time], ["type", error.name]];
  if (error instanceof ServerConnectionError) rows.push(["classification", error.classification]);
  if (c) rows.push(["method", c.method], ["methodOverride", c.methodOverride], ["path", c.path], ["server", c.server],
    ["timeoutMs", c.timeoutMs === null ? "none" : c.timeoutMs], ["elapsedMs", c.elapsedMs],
    ["pluginVersion", c.pluginVersion], ["apiRevision", c.apiRevision], ["serverVersion", c.serverVersion ?? "unknown"],
    ["serverApiRevision", c.serverApiRevision], ["capabilities", c.capabilities ? Object.entries(c.capabilities).map(([key, value]) => `${key}=${value}`).join(", ") : "unknown"]);
  if (error instanceof ServerRequestError) rows.push(["status", error.status], ["code", error.code], ["serverSummary", error.serverSummary]);
  rows.push(["originalError", error instanceof ServerConnectionError ? error.originalMessage : safeErrorText(error.cause instanceof ServerConnectionError ? error.cause.originalMessage : error.cause instanceof ServerRequestError ? error.cause.message : error.message)]);
  return rows.filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${String(value).replace(/[\r\n]+/g, " ")}`).join("\n");
}
