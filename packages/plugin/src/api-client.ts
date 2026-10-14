import type { QuizAnswerRequest, SourceReferenceIssue } from "@rcm/shared";
import { RCM_API_REVISION, RCM_PLUGIN_VERSION, TurnPrepareResponseSchema, structuredValidationDiagnostic, type ExtractionAuditSubmission, type LeasedJob, type OperationLlmCallStats, type QuizAnswerResponse, type QuizNextResponse, type QuizStats, type QuizStatus, type QuizRegenerateResponse, type ReconciliationSubmission, type ServerWorkerStatus, type TurnPrepareRequest, type TurnPrepareResponse } from "@rcm/shared";
import type { PluginSettings } from "./types.js";

export const DEFAULT_SERVER_REQUEST_TIMEOUT_MS = 15_000;
export const SERVER_STATUS_TIMEOUT_MS = 12_000;
// Preparation waits for the complete packet; latency is measured, not a send deadline.
export const TURN_PREPARE_TIMEOUT_MS: null = null;

function serverErrorDetail(error: unknown): string {
  if (typeof error !== "string") return "";
  const detail = error.trim();
  try {
    const issues: unknown = JSON.parse(detail);
    if (!Array.isArray(issues)) return "";
    const diagnostics = issues.filter(issue => issue && typeof issue === "object" && typeof issue.message === "string").map(issue => ({
      path: Array.isArray(issue.path) ? issue.path.filter((part: unknown) => typeof part === "string" || typeof part === "number") : [],
      code: typeof issue.code === "string" ? issue.code : undefined,
      message: issue.message,
    }));
    return diagnostics.length ? structuredValidationDiagnostic({ issues: diagnostics }).slice(0, 500) : "";
  } catch { return detail.slice(0, 500); }
}

export interface PrepareClientTimings {
  setupMs?: number;
  serializeMs?: number;
  requestMs?: number;
  bodyMs?: number;
  parseMs?: number;
  schemaMs?: number;
  responseStage?: "received" | "not_received";
  bodyStage?: "read" | "not_read" | "failed";
  jsonStage?: "parsed" | "failed" | "not_parsed";
  schemaStage?: "parsed" | "failed" | "not_parsed";
}

export type ChatViewPreferences = {
  personaEntity: string | null;
  hiddenAnniversaries: string[];
};

export type ChatViewPreferencesPatch = Partial<ChatViewPreferences>;

export type SocialKnowledgeApiItem = {
  derived?: "mutual_interaction";
  derivedFrom?: string;
  id: string;
  holder: string;
  subject: string;
  level: "aware_of" | "interacted";
  knownAs: string[];
  addressTerms: string[];
  cognition: Array<{ id: string; text: string }>;
  evidence: Array<{ messageId: string; quote?: string } | { sourceKind: "setup"; setupFingerprint: string; sourceIndex: number; quote: string }>;
  manual: boolean;
  userEdited?: boolean;
  userEditOrdinal?: number | null;
  locked?: boolean;
  updatedAt: number;
};

declare const __RCM_DISTRIBUTION__: boolean;

export type SocialRelationApiItem = import("@rcm/shared").SocialRelation & { knownBy: string[]; knownByEveryone: boolean };
export type MemoryDetailAccessPatch = { holders: string[]; everyone: boolean; bases: Record<string, import("@rcm/shared").ItemAccessBasis> };

export type MemoryDetailAccessResponse = { ok: boolean; access: import("@rcm/shared").MemoryDetailAccess; knownBy: string[] };
export type MemoryDetailApiItem = import("@rcm/shared").MemoryContextItem["details"][number] & {
  access: import("@rcm/shared").MemoryDetailAccess;
  evidence: Array<{ messageId: string; quote?: string }>;
  sourceOrdinal: number | null;
  original_kind: string | null;
};

export class ServerRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = "ServerRequestError"; }
}

export class ServerConnectionError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = "ServerConnectionError";
  }
}

export function isMissingServerRoute(error: unknown): boolean {
  return error instanceof ServerRequestError && error.status === 404 && error.code !== "CHAT_NOT_FOUND";
}

export function isServerConnectionFailure(error: unknown): boolean {
  return (error instanceof ServerRequestError && [401, 403].includes(error.status))
    || error instanceof ServerConnectionError
    || error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}

export class ServerClient {
  constructor(private readonly settings: () => PluginSettings) {}

  async request<T>(path: string, init: RequestInit = {}, timeoutMs: number | null = DEFAULT_SERVER_REQUEST_TIMEOUT_MS, timings?: PrepareClientTimings): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    let active = true;
    let bodyReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let phase: "requestMs" | "bodyMs" | "parseMs" = "requestMs";
    let phaseStartedAt = performance.now();
    const finishPhase = () => { if (active && timings) timings[phase] = performance.now() - phaseStartedAt; };
    let rejectDeadline!: (error: Error) => void;
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const timer = timeoutMs === null ? undefined : setTimeout(() => {
      const error = new Error(`Request timed out after ${timeoutMs}ms: ${(init.method ?? "GET").toUpperCase()} ${path}`);
      error.name = "AbortError";
      rejectDeadline(error);
      controller.abort(error);
      void bodyReader?.cancel(error).catch(() => undefined);
    }, timeoutMs);
    const read = async (): Promise<T> => {
      const response = await this.raw(path, { ...init, signal: controller.signal }, timeoutMs, timings);
      if (!active) throw new Error("Request already ended");
      finishPhase(); phase = "bodyMs"; phaseStartedAt = performance.now();
      let body = "";
      bodyReader = response.body?.getReader();
      if (bodyReader) {
        const decoder = new TextDecoder();
        try {
          while (true) {
            const chunk = await bodyReader.read();
            if (!active || controller.signal.aborted) throw new Error("Request already ended");
            if (chunk.done) break;
            body += decoder.decode(chunk.value, { stream: true });
          }
          body += decoder.decode();
          if (timings) timings.bodyStage = "read";
        } catch (error) {
          if (active && timings) timings.bodyStage = "failed";
          throw error;
        } finally { bodyReader.releaseLock(); }
      }
      if (!active || controller.signal.aborted) throw new Error("Request already ended");
      if (timings) timings.bodyStage = "read";
      finishPhase(); phase = "parseMs"; phaseStartedAt = performance.now();
      if (!body) return undefined as T;
      try { const parsed = JSON.parse(body) as T; if (timings) timings.jsonStage = "parsed"; return parsed; }
      catch { if (timings) timings.jsonStage = "failed"; throw new Error(`Invalid JSON response from ${path}: ${body.slice(0, 240)}`); }
    };
    try { return await Promise.race([read(), deadline]); }
    catch (error) {
      if (timings && (phase as string) === "bodyMs" && timings.bodyStage !== "read") timings.bodyStage = "failed";
      throw error;
    }
    finally {
      finishPhase(); active = false;
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
  }

  getViewPreferences(chatId: string): Promise<ChatViewPreferences> {
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/view-preferences`);
  }

  putViewPreferences(chatId: string, patch: ChatViewPreferencesPatch): Promise<ChatViewPreferences> {
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/view-preferences`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  }

  patchMemory(chatId: string, memoryId: string, patch: Record<string, unknown>): Promise<{ ok: boolean }> {
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/memories/${encodeURIComponent(memoryId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async raw(path: string, init: RequestInit = {}, timeoutMs: number | null = DEFAULT_SERVER_REQUEST_TIMEOUT_MS, timings?: PrepareClientTimings): Promise<Response> {
    const settings = this.settings();
    const controller = new AbortController();
    const externalSignal = init.signal;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    let timedOut = false;
    let rejectDeadline!: (error: Error) => void;
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    const timeout = timeoutMs === null ? undefined : setTimeout(() => {
      timedOut = true;
      rejectDeadline(new Error("Request deadline exceeded"));
      controller.abort();
    }, timeoutMs);
    try {
      const method = (init.method ?? "GET").toUpperCase();
      const body = init.body ?? (["POST", "PUT"].includes(method) ? "{}" : undefined);
      const response = await Promise.race([risuai.nativeFetch(`${settings.serverUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        method,
        ...(body === undefined ? {} : { body }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.serverToken}`,
          "X-RCM-Plugin-Version": RCM_PLUGIN_VERSION,
          "X-RCM-API-Revision": String(RCM_API_REVISION),
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      }), deadline]);
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error("Request already ended");
      if (timings) timings.responseStage = "received";
      if (!response.ok) {
        const detail = (await response.text()).trim();
        let readable = detail.slice(0, 240);
        let code: string | undefined;
        try {
          const parsed = JSON.parse(detail) as { summary?: string; code?: string; error?: unknown; existingId?: string };
          code = parsed.code;
          const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 240) : "";
          const reason = serverErrorDetail(parsed.error);
          readable = [summary, reason && !summary.includes(reason) ? reason : "", parsed.code ? `(${parsed.code})` : "", parsed.existingId ? `existingId=${parsed.existingId}` : ""].filter(Boolean).join(" ");
        } catch { /* retain a bounded non-JSON error response */ }
        throw new ServerRequestError(`Server request failed: ${method} ${path} returned ${response.status}${readable ? `: ${readable}` : ""}`, response.status, code);
      }
      return response;
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error(`Request timed out after ${timeoutMs}ms: ${(init.method ?? "GET").toUpperCase()} ${path}`);
        timeoutError.name = "AbortError";
        throw timeoutError;
      }
      throw error instanceof ServerRequestError ? error : new ServerConnectionError(error);
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }

  async prepare(body: TurnPrepareRequest, timeoutMs: number | null = TURN_PREPARE_TIMEOUT_MS, timings?: PrepareClientTimings): Promise<TurnPrepareResponse> {
    const startedAt = performance.now();
    if (timings) {
      timings.responseStage = "not_received";
      timings.bodyStage = "not_read";
      timings.jsonStage = "not_parsed";
      timings.schemaStage = "not_parsed";
    }
    const serialized = JSON.stringify(body);
    if (timings) timings.serializeMs = performance.now() - startedAt;
    const response = await this.request<unknown>("/v1/turn/prepare", { method: "POST", body: serialized }, timeoutMs, timings);
    const schemaStartedAt = performance.now();
    const parsed = TurnPrepareResponseSchema.safeParse(response);
    if (timings) timings.schemaMs = performance.now() - schemaStartedAt;
    if (!parsed.success) {
      if (timings) timings.schemaStage = "failed";
      throw new Error(`Invalid turn/prepare response schema: ${parsed.error.issues[0]?.message ?? "invalid response"}`);
    }
    if (parsed.data.apiRevision !== RCM_API_REVISION) {
      if (timings) timings.schemaStage = "failed";
      throw new Error(`RCM API 버전이 맞지 않습니다: 플러그인 ${RCM_API_REVISION}, 서버 ${parsed.data.apiRevision}. 서버와 플러그인을 함께 업데이트해 주세요.`);
    }
    if (timings) timings.schemaStage = "parsed";
    return parsed.data;
  }

  async traceRetrieval(event: Record<string, unknown>): Promise<void> {
    if (event.kind === "automatic_injection" && event.blocked === false && event.omitted === false
      && ["fresh", "reused"].includes(String(event.prepareOutcome))) {
      await this.request("/v1/turn/delivery", { method: "POST", body: JSON.stringify({
        chatId: event.chatId, memoryIds: (event.manifest as { memoryIds?: unknown } | undefined)?.memoryIds,
      }) }, 2_000);
    }
    if (event.receiptOnly === true) return;
    if (typeof __RCM_DISTRIBUTION__ !== "undefined" && __RCM_DISTRIBUTION__) return Promise.resolve();
    return this.request("/v1/diagnostics/retrieval-events", { method: "POST", body: JSON.stringify(event) }, 2_000);
  }

  async lease(workerId: string): Promise<LeasedJob | null> {
    const result = await this.request<{ job: LeasedJob | null }>("/v1/jobs/lease", {
      method: "POST", body: JSON.stringify({ workerId }),
    });
    return result.job;
  }

  validatedAuxiliaryPart(jobId: string, workerId: string, purpose: "initial_calibration" | "ledger_consistency" | "reconciliation", part: { systemPrompt: string; userPrompt: string }, result: unknown): Promise<{ ok: boolean }> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}/validated-auxiliary-part`, { method: "POST", body: JSON.stringify({ workerId, purpose, systemPrompt: part.systemPrompt, userPrompt: part.userPrompt, result }) });
  }

  stageDraft(jobId: string, workerId: string, output: string, storyValidationReason?: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}/draft`, { method: "POST", body: JSON.stringify({ workerId, output, storyValidationReason }) });
  }

  renewLease(jobId: string, workerId: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}/renew`, { method: "POST", body: JSON.stringify({ workerId }) });
  }

  prepareReconciliation(jobId: string, workerId: string, result: unknown, audit?: ExtractionAuditSubmission): Promise<{ required: boolean; candidateSetHash?: string; systemPrompt?: string; userPrompt?: string; parts?: Array<{ systemPrompt: string; userPrompt: string; stateExtraction?: boolean; sourceUnits?: import("@rcm/shared").SourceUnit[]; cachedResult?: unknown }>; groundingDraft?: any; evidenceIssues?: SourceReferenceIssue[] }> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}/reconciliation/prepare`, {
      method: "POST", body: JSON.stringify({ workerId, result, audit }),
    });
  }

  progress(jobId: string, workerId: string, stage: "first_extraction" | "post_extraction_audit" | "state_reconciliation" | "ledger_consistency" | "relationship_projection" | "story_consolidation" | "storing", repairDelta = 0, llmCallStats?: OperationLlmCallStats, llmCallDiagnostic?: Record<string, unknown>): Promise<{ ok: boolean }> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}/progress`, {
      method: "POST", body: JSON.stringify({ workerId, stage, repairDelta, llmCallStats, llmCallDiagnostic }),
    });
  }

  complete(jobId: string, workerId: string, result: unknown, reconciliation?: ReconciliationSubmission, audit?: ExtractionAuditSubmission): Promise<{ ok: boolean; warnings?: string[]; pendingReconciliations?: number }> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}/complete`, {
      method: "POST", body: JSON.stringify({ workerId, result, reconciliation, audit }),
    });
  }

  fail(jobId: string, workerId: string, error: string): Promise<{ ok: boolean; status: "queued" | "failed"; attempt: number; maxAttempts: number; retryable: boolean }> {
    return this.request(`/v1/jobs/${encodeURIComponent(jobId)}/fail`, {
      method: "POST", body: JSON.stringify({ workerId, error }),
    });
  }

  async heartbeat(workerId: string, chatId?: string): Promise<ServerWorkerStatus> {
    const result = await this.request<{ worker: ServerWorkerStatus }>("/v1/worker/heartbeat", {
      method: "POST", body: JSON.stringify({ workerId, ...(chatId ? { chatId } : {}) }),
    });
    return result.worker;
  }

  async pauseServerWorker(): Promise<ServerWorkerStatus> {
    const result = await this.request<{ worker: ServerWorkerStatus }>("/v1/worker/pause", { method: "POST" });
    return result.worker;
  }

  async resumeServerWorker(workerId: string): Promise<ServerWorkerStatus> {
    const result = await this.request<{ worker: ServerWorkerStatus }>("/v1/worker/resume", {
      method: "POST", body: JSON.stringify({ workerId }),
    });
    return result.worker;
  }

  episodeOverview(chatId: string): Promise<any> {
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/episodes/active`);
  }

  retryEpisode(chatId: string, episodeId: string): Promise<any> {
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/episodes/${encodeURIComponent(episodeId)}/retry`, { method: "POST" });
  }

  quizNext(chatId: string): Promise<QuizNextResponse> {
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/quiz/next`);
  }

  quizAnswer(chatId: string, itemId: string, chosenIndex: number, attemptToken: string): Promise<QuizAnswerResponse> {
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/quiz/${encodeURIComponent(itemId)}/answer`, { method: "POST", body: JSON.stringify({ chosenIndex, attemptToken } satisfies QuizAnswerRequest) });
  }

  quizSetEnabled(chatId: string, enabled: boolean): Promise<QuizNextResponse> {
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/quiz/enabled`, { method: "PUT", body: JSON.stringify({ enabled }) });
  }

  quizDisableAll(): Promise<{ ok: boolean }> {
    return this.request("/v1/quiz/enabled", { method: "PUT", body: JSON.stringify({ enabled: false }) });
  }

  quizStatus(chatId: string): Promise<QuizStatus> {
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/quiz/status`);
  }

  quizRegenerate(chatId: string): Promise<QuizRegenerateResponse> {
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/quiz/regenerate`, { method: "POST" });
  }

  quizResetStats(chatId: string): Promise<QuizStats> {
    return this.request(`/v1/chats/${encodeURIComponent(chatId)}/quiz/stats`, { method: "DELETE" });
  }
}
