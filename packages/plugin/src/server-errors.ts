import { sanitizeDiagnosticText } from "@rcm/shared";

export const HOST_FETCH_REJECTION_MESSAGE = "Risu가 RCM 서버로 가는 요청을 전달하지 못했어요. Risu 앱 쪽에서 요청을 거절했을 수 있어요.";

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
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : String(error);
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
    readonly serverSummary?: string) { super(message); this.name = "ServerRequestError"; }
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
