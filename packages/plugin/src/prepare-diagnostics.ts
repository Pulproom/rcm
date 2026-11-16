import { RCM_API_REVISION, RCM_PLUGIN_VERSION } from "@rcm/shared";
import type { PrepareClientTimings } from "./api-client.js";
import type { RuntimeState } from "./types.js";
import { shareDiagnostic, supportFailure } from "./support-diagnostics.js";

const STORAGE_KEY = "rcm-support-failures-v1";
const LIMIT = 20;
const stages = ["request", "body", "json", "schema", "integration", "injection"] as const;
const errorTypes = ["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "ServerRequestError", "ServerConnectionError"] as const;
const types = ["string", "number", "boolean", "object", "array", "null", "undefined"] as const;
const fields = new Set("apiRevision serverInstanceId memoryEpoch chatRevision sourceRevision sourceInventory profile memoryLanguage pendingMemoryLanguage requiresLanguageReprocess packet stableAnchors estimatedTokens assembly selected stateSnapshots injectionManifest memoryToolsAvailable memoryToolOpportunity mcpRequestTimeoutMs perspectiveResolution sceneCharacters narrationDiagnostics initialCalibration lineage sync retrievalTrace id title content details keyDialogues evidence knownBy participants clarity score type kind status".split(" "));
const boundedNumber = (value: unknown, max = Number.MAX_SAFE_INTEGER): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value) : undefined;
const version = (value: unknown): string | undefined => typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value) ? value : undefined;
const member = <T extends string>(value: unknown, values: readonly T[]): T | undefined => values.includes(value as T) ? value as T : undefined;

export interface PrepareFailure {
  at: number;
  pluginVersion?: string;
  apiRevision?: number;
  serverVersion?: string;
  serverApiRevision?: number;
  stage?: typeof stages[number];
  errorType?: typeof errorTypes[number];
  connectionFailure?: "connection" | "host_json_syntax";
  code: string;
  httpStatus?: number;
  elapsedMs?: number;
  schemaIssues?: Array<{ path: Array<string | number>; expected?: string; received?: string }>;
}

/** Re-project both live and stored data. Never copy error messages or input values. */
export function safePrepareFailure(value: unknown): PrepareFailure | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as PrepareFailure;
  const at = boundedNumber(row.at, 8_640_000_000_000_000);
  if (at === undefined) return undefined;
  return {
    at, pluginVersion: version(row.pluginVersion), apiRevision: boundedNumber(row.apiRevision),
    serverVersion: version(row.serverVersion), serverApiRevision: boundedNumber(row.serverApiRevision),
    stage: member(row.stage, stages), errorType: member(row.errorType, errorTypes),
    connectionFailure: member(row.connectionFailure, ["connection", "host_json_syntax"]),
    code: shareDiagnostic({ stage: "before_request", code: row.code })!.code,
    httpStatus: boundedNumber(row.httpStatus, 599), elapsedMs: boundedNumber(row.elapsedMs),
    schemaIssues: Array.isArray(row.schemaIssues) ? row.schemaIssues.slice(0, 5).map(issue => ({
      path: Array.isArray(issue?.path) ? issue.path.slice(0, 12).map(part =>
        typeof part === "number" || part === "#" ? "#" : fields.has(part) ? part : "[field]") : [],
      expected: member(issue?.expected, types), received: member(issue?.received, types),
    })) : undefined,
  };
}

const writes = new WeakMap<RuntimeState, Promise<void>>();
function saveFailures(state: RuntimeState): Promise<void> {
  const snapshot = (state.prepareFailures ?? []).flatMap(row => safePrepareFailure(row) ?? []).slice(0, LIMIT);
  const pending = (writes.get(state) ?? Promise.resolve()).then(async () => {
    const storage = await risuai.getLocalPluginStorage();
    await storage.setItem(STORAGE_KEY, snapshot);
    state.prepareFailuresStorageError = false;
  }).catch(() => { state.prepareFailuresStorageError = true; });
  writes.set(state, pending);
  return pending;
}

export async function loadPrepareFailures(state: RuntimeState): Promise<void> {
  try {
    const storage = await risuai.getLocalPluginStorage();
    const saved: unknown = await storage.getItem(STORAGE_KEY);
    state.prepareFailures = Array.isArray(saved) ? saved.flatMap(row => safePrepareFailure(row) ?? []).slice(0, LIMIT) : [];
  } catch { state.prepareFailuresStorageError = true; }
}

export function clearPrepareFailures(state: RuntimeState): Promise<void> {
  state.prepareFailures = [];
  return saveFailures(state);
}

export function recordPrepareFailure(state: RuntimeState, error: unknown, timings?: PrepareClientTimings, elapsedMs?: number, injection = false): void {
  const e = error as { name?: string; classification?: string; context?: { serverVersion?: string; serverApiRevision?: number }; schemaIssues?: PrepareFailure["schemaIssues"] };
  const diagnostic = supportFailure("before_request", error);
  const stage = injection ? "injection" : timings?.schemaStage === "failed" ? "schema"
    : timings?.jsonStage === "failed" ? "json" : timings?.bodyStage === "failed" ? "body"
    : timings?.schemaStage === "parsed" ? "integration" : "request";
  const failure = safePrepareFailure({
    at: Date.now(), pluginVersion: RCM_PLUGIN_VERSION, apiRevision: RCM_API_REVISION,
    serverVersion: e?.context?.serverVersion ?? timings?.serverVersion,
    serverApiRevision: e?.context?.serverApiRevision ?? timings?.serverApiRevision,
    connectionFailure: e?.classification,
    stage, errorType: e?.name, code: stage === "schema" && diagnostic.code === "UNKNOWN_ERROR" ? "VALIDATION_FAILED"
      : stage === "json" ? "INVALID_RESPONSE" : diagnostic.code,
    httpStatus: diagnostic.httpStatus ?? timings?.httpStatus, elapsedMs, schemaIssues: e?.schemaIssues,
  })!;
  state.prepareFailures = [failure, ...(state.prepareFailures ?? [])].slice(0, LIMIT);
  void saveFailures(state);
}

export function prepareFailureLabel(failure: PrepareFailure): string {
  const labels: Record<typeof stages[number], string> = {
    request: "서버 요청", body: "응답 읽기", json: "JSON 해석", schema: "응답 형식 검사",
    integration: "기억 준비 후 연결", injection: "최종 기억 주입",
  };
  return [failure.stage ? labels[failure.stage] : "기억 준비", failure.code, failure.errorType ?? "",
    failure.httpStatus ? `HTTP ${failure.httpStatus}` : "",
    failure.elapsedMs === undefined ? "" : `${(failure.elapsedMs / 1000).toFixed(1)}초`].filter(Boolean).join(" · ");
}
