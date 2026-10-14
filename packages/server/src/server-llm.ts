import { sanitizeDiagnosticText } from "@rcm/shared";
import { defaultAuxiliaryModelConfig, SERVER_LLM_DEFAULT_ENDPOINTS } from "@rcm/shared";
import { parseReconciliationResult } from "@rcm/shared";
import { prepareAuxiliaryText, resolveDirectDialogueEvidence, resolveModelSourceReferences, inspectSourceReferences, sourceRepairMessages, applySourceRepairs } from "@rcm/shared";
import { validateGroupingResult, validateSourceRecoveryPatch, type MemoryGroupingResult } from "@rcm/shared";
import { createHash, randomUUID, sign } from "node:crypto";
import { planExtractionFieldRepair, applyExtractionFieldRepair } from "@rcm/shared";
import { applySourceAccessRepair, type SourceAccessRepairPlan } from "@rcm/shared";
import {
  EpisodeCapsuleResultSchema,
  EpisodeDraftResultSchema,
  estimateTokens,
  groupEpisodeDrafts,
  normalizeEpisodeCapsuleInput,
  normalizeEpisodeDraftInput,
  normalizeStructuredModelOptionals,
  parseStructuredModelJson,
  StructuredJsonSyntaxError,
  Api38ExtractionDraftResultSchema,
  buildAuxiliaryRepairMessages,
  isUnchangedStructuredRepair,
  validateStructuredRepairOrRegenerate,
  structuredJsonErrorWindow,
  structuredValidationDiagnostic,
  buildExtractionAuditMessages,
  extractionAuditDraftForJob,
  ExtractionAuditPatchSchema,
  normalizeExtractionDraftInput,
  InitialCalibrationResultSchema,
  mergeInitialCalibrationResults,
  LedgerConsistencyResultSchema,
  ReconciliationResultSchema,
  RelationshipProjectionResultSchema,
  StorySpineConsolidationResultSchema,
  measureAuxiliaryPrompt,
  validateStorySpineConsolidation,
  ServerLlmConfigSchema,
  type EpisodeCapsuleResult,
  type EpisodeDraftResult,
  type ExtractionDraftResult,
  type ExtractionAuditSubmission,
  type InitialCalibrationResult,
  type LeasedJob,
  type LedgerConsistencyResult,
  type ReconciliationResult,
  type RelationshipProjectionResult,
  type ServerLlmConfigInput,
  type ServerLlmProvider,
  type ServerLlmPublicConfig,
  type StorySpineConsolidationResult,
  type ThinkingLevel,
} from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { saveSecret } from "./admin.js";
import { normalizeAndValidateSetupEvidence } from "./initial-calibration.js";
import { recordJobLlmCall, repairBudgetSpent, settleJobLlmCall, stageJobModelOutput } from "./jobs.js";
import { cachedAuxiliaryPage, storeValidatedAuxiliaryPage, type CachedAuxiliaryPurpose } from "./auxiliary-page-cache.js";

const CONFIG_KEY = "server_llm_config";
const providers: ServerLlmProvider[] = ["gemini_api", "vertex", "llm_gateway", "openai_compatible", "vercel", "ollama_cloud", "copilot"];
const secretName = (provider: ServerLlmProvider) => `RCM_LLM_API_KEY_${provider.toUpperCase()}` as const;
type StoredServerLlmConfig = Omit<ServerLlmPublicConfig, "keyConfigured" | "configuredProviders">;

function extractionCheckpointKey(job: LeasedJob): string {
  return createHash("sha256").update(JSON.stringify({
    profile: job.profile,
    memoryLanguage: job.memoryLanguage,
    prompt: job.prompt,
    systemPrompt: job.systemPrompt,
    userPrompt: job.userPrompt,
    sourceMessageIds: job.sourceMessageIds,
    sourceUnits: job.sourceUnits,
  })).digest("hex");
}

const defaults: StoredServerLlmConfig = {
  engine: "risu",
  ...defaultAuxiliaryModelConfig,
  serviceTier: "standard",
  maxInputTokens: 80_000,
  maxOutputTokens: 24_000,
  embeddingTimeoutMs: 15_000,
  rerankTimeoutMs: 45_000,
  llmTimeoutMs: 300_000,
};

/** Gemini 3.7+ Flash replaced token budgets with LOW/MEDIUM/HIGH thinking
 * levels and rejects an explicit disabled/minimal level. Keep this narrow to
 * the documented Flash line instead of guessing capabilities for every model. */
function usesGeminiFlashThinkingLevel(model: string): boolean {
  const match = /^gemini-3\.(\d+)-flash(?:$|[-@])/i.exec(model.trim());
  return Boolean(match && Number(match[1]) >= 7);
}

export function normalizeDirectGeminiThinking(provider: ServerLlmProvider, model: string, thinking: ThinkingLevel): ThinkingLevel {
  return (provider === "vertex" || provider === "gemini_api") && usesGeminiFlashThinkingLevel(model) && thinking === "off"
    ? "low"
    : thinking;
}

export function validateEndpoint(provider: ServerLlmConfigInput["provider"], endpoint: string): string {
  const url = new URL(endpoint.trim());
  if (url.protocol !== "https:") throw new Error("Server LLM endpoint must use HTTPS");
  if (url.username || url.password) throw new Error("Credentials must not be embedded in the endpoint URL");
  if (provider === "gemini_api" && url.hostname !== "generativelanguage.googleapis.com") {
    throw new Error("Gemini API endpoint must use generativelanguage.googleapis.com");
  }
  if (provider === "vertex" && url.hostname !== "aiplatform.googleapis.com" && !url.hostname.endsWith("-aiplatform.googleapis.com")) {
    throw new Error("Vertex endpoint must use an aiplatform.googleapis.com host");
  }
  if (provider === "vercel" && url.hostname !== "ai-gateway.vercel.sh") {
    throw new Error("Vercel endpoint must use ai-gateway.vercel.sh");
  }
  if (provider === "copilot" && (!/^api(?:\.(?:individual|business|enterprise))?\.githubcopilot\.com$/.test(url.hostname)
    || url.port || url.pathname !== "/chat/completions" || url.search || url.hash)) {
    throw new Error("Copilot endpoint must use a GitHub Copilot /chat/completions URL");
  }
  if (provider === "ollama_cloud" && (url.hostname !== "ollama.com" || url.pathname !== "/api/chat")) {
    throw new Error("Ollama Cloud endpoint must be https://ollama.com/api/chat");
  }
  return url.toString().replace(/\/$/, "");
}

function parseStoredConfig(db: RcmDatabase): StoredServerLlmConfig {
  const row = db.prepare("SELECT value FROM server_meta WHERE key=?").get(CONFIG_KEY) as { value: string } | undefined;
  if (!row) return { ...defaults };
  try {
    const parsed = ServerLlmConfigSchema.omit({ apiKey: true }).safeParse({ ...defaults, ...JSON.parse(row.value) });
    return parsed.success
      ? { ...parsed.data, thinking: normalizeDirectGeminiThinking(parsed.data.provider, parsed.data.model, parsed.data.thinking) }
      : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

const stores = new WeakMap<RcmDatabase, ServerLlmStore>();

/** Risu owns its credentials; only the server engine can be checked here. */
export function auxiliaryModelReady(db: RcmDatabase): boolean {
  const store = stores.get(db);
  return (store?.config ?? parseStoredConfig(db)).engine === "risu" || store?.modelReady === true;
}

export class ServerLlmStore {
  #config: StoredServerLlmConfig;
  #apiKeys: Partial<Record<ServerLlmProvider, string>>;
  #vertexToken: { accessToken: string; expiresAt: number; projectId: string; credentialHash:string } | undefined;
  #copilotToken?: { accessToken: string; expiresAt: number; endpoint: string; credentialHash: string };
  #jobConfigs = new Map<string, StoredServerLlmConfig>();
  #jobApiKeys = new Map<string, string>();
  #timingObserver?: (event: { id: string; jobId: string; purpose: ServerLlmPurpose; startedAt: number; elapsedMs?: number; outcome: "running" | "succeeded" | "failed" }) => void;

  constructor(
    private readonly db: RcmDatabase,
    private readonly secretsPath: string,
    apiKeys: Partial<Record<ServerLlmProvider, string>> = {},
    readonly requestTimeoutMs = 300_000,
  ) {
    this.#config = parseStoredConfig(db);
    const storedRow = db.prepare("SELECT value FROM server_meta WHERE key='server_llm_config'").get() as { value: string } | undefined;
    let hasStoredLlmTimeout = false;
    try { hasStoredLlmTimeout = Object.prototype.hasOwnProperty.call(JSON.parse(storedRow?.value ?? "{}"), "llmTimeoutMs"); } catch { /* malformed stored config is replaced by defaults */ }
    if (!hasStoredLlmTimeout && requestTimeoutMs !== 300_000) this.#config.llmTimeoutMs = requestTimeoutMs;
    this.#apiKeys = { ...apiKeys };
    stores.set(db, this);
  }

  get config(): Readonly<StoredServerLlmConfig> { return this.#config; }
  get modelReady(): boolean {
    if (!this.apiKey.trim() || !ServerLlmConfigSchema.omit({ apiKey: true }).safeParse(this.config).success) return false;
    try {
      validateEndpoint(this.config.provider, this.config.endpoint);
      if (this.config.provider === "vertex") parseVertexServiceAccount(this.apiKey);
      return true;
    } catch { return false; }
  }
  snapshotJob(jobId: string): Readonly<StoredServerLlmConfig> {
    let snapshot = this.#jobConfigs.get(jobId);
    if (!snapshot) {
      const row = this.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(jobId) as { payload_json: string } | undefined;
      const payload = row ? JSON.parse(row.payload_json || "{}") as Record<string, unknown> : {};
      const stored = ServerLlmConfigSchema.omit({ apiKey: true }).safeParse(payload.serverLlmSnapshot);
      snapshot = stored.success ? stored.data : ServerLlmConfigSchema.omit({ apiKey: true }).parse(this.config);
      if (!stored.success && row) {
        payload.serverLlmSnapshot = snapshot;
        this.db.prepare("UPDATE jobs SET payload_json=?,updated_at=? WHERE id=?").run(JSON.stringify(payload), Date.now(), jobId);
      }
      this.#jobConfigs.set(jobId, snapshot);
      this.#jobApiKeys.set(jobId, this.apiKeyFor(snapshot.provider));
    }
    return snapshot;
  }
  get apiKey(): string { return this.#apiKeys[this.#config.provider] ?? ""; }
  apiKeyFor(provider: ServerLlmProvider): string { return provider === this.config.provider ? this.apiKey : this.#apiKeys[provider] ?? ""; }
  apiKeyForJob(jobId: string, provider: ServerLlmProvider): string {
    this.snapshotJob(jobId);
    return this.#jobApiKeys.get(jobId) ?? this.apiKeyFor(provider);
  }
  backupApiKeys(): Partial<Record<ServerLlmProvider,string>> { return {...this.#apiKeys}; }
  recordCall(jobId: string, purpose: ServerLlmPurpose): void { recordJobLlmCall(this.db, jobId, purpose); }
  setTimingObserver(observer: (event: { id: string; jobId: string; purpose: ServerLlmPurpose; startedAt: number; elapsedMs?: number; outcome: "running" | "succeeded" | "failed" }) => void): void { this.#timingObserver = observer; }
  recordTiming(event: { id: string; jobId: string; purpose: ServerLlmPurpose; startedAt: number; elapsedMs?: number; outcome: "running" | "succeeded" | "failed" }): void { this.#timingObserver?.(event); }
  canRepair(jobId: string): boolean {
    const row = this.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(jobId) as { payload_json: string } | undefined;
    return !repairBudgetSpent(JSON.parse(row?.payload_json ?? "{}"));
  }
  stageOutput(jobId: string, output: string, storyValidationReason?: string): void { stageJobModelOutput(this.db, jobId, output, undefined, storyValidationReason); }
  settleCall(jobId: string, purpose: ServerLlmPurpose, outcome: "succeeded" | "failed", details?: { error?: unknown; usage?: Record<string, unknown> }): void { settleJobLlmCall(this.db, jobId, purpose, outcome, details); }
  cachedPage(jobId: string, purpose: CachedAuxiliaryPurpose, systemPrompt: string, userPrompt: string): unknown | undefined {
    const row = this.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(jobId) as { payload_json: string } | undefined;
    return cachedAuxiliaryPage(JSON.parse(row?.payload_json ?? "{}"), purpose, systemPrompt, userPrompt);
  }
  cachePage(jobId: string, purpose: CachedAuxiliaryPurpose, systemPrompt: string, userPrompt: string, result: unknown): void {
    const row = this.db.prepare("SELECT 1 FROM jobs WHERE id=? AND status='leased' AND lease_owner IS NOT NULL").get(jobId);
    if (row) storeValidatedAuxiliaryPage(this.db, jobId, undefined, { purpose, systemPrompt, userPrompt, result });
  }
  cachedExtraction(job: LeasedJob): ExtractionDraftResult | undefined {
    const row = this.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(job.id) as { payload_json: string } | undefined;
    if (!row) return undefined;
    const checkpoint = (JSON.parse(row.payload_json || "{}") as Record<string, any>).validatedExtractionCheckpoint;
    if (!checkpoint || checkpoint.inputHash !== extractionCheckpointKey(job)) return undefined;
    const parsed = Api38ExtractionDraftResultSchema.safeParse(checkpoint.result);
    if (!parsed.success || parsed.data.language !== job.memoryLanguage) return undefined;
    return parsed.data;
  }
  cacheExtraction(job: LeasedJob, result: ExtractionDraftResult): ExtractionDraftResult {
    const row = this.db.prepare("SELECT payload_json FROM jobs WHERE id=? AND status='leased' AND lease_owner IS NOT NULL").get(job.id) as { payload_json: string } | undefined;
    if (!row) return result;
    const payload = JSON.parse(row.payload_json || "{}") as Record<string, any>;
    payload.validatedExtractionCheckpoint = { inputHash: extractionCheckpointKey(job), result, validatedAt: Date.now() };
    this.db.prepare("UPDATE jobs SET payload_json=?,updated_at=? WHERE id=? AND status='leased' AND lease_owner IS NOT NULL")
      .run(JSON.stringify(payload), Date.now(), job.id);
    return result;
  }
  cachedPreReconciliation(jobId: string, inputHash: string): { result: unknown; audit?: unknown } | undefined {
    const row = this.db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(jobId) as { payload_json: string } | undefined;
    if (!row) return undefined;
    const checkpoint = (JSON.parse(row.payload_json || "{}") as Record<string, any>).validatedPreReconciliationCheckpoint;
    return checkpoint?.inputHash === inputHash ? { result: checkpoint.result, audit: checkpoint.audit } : undefined;
  }
  cachePreReconciliation(jobId: string, inputHash: string, value: { result: ExtractionDraftResult; audit?: ExtractionAuditSubmission }): void {
    const row = this.db.prepare("SELECT payload_json FROM jobs WHERE id=? AND status='leased' AND lease_owner IS NOT NULL").get(jobId) as { payload_json: string } | undefined;
    if (!row) return;
    const payload = JSON.parse(row.payload_json || "{}") as Record<string, any>;
    payload.validatedPreReconciliationCheckpoint = { inputHash, ...value, validatedAt: Date.now() };
    this.db.prepare("UPDATE jobs SET payload_json=?,updated_at=? WHERE id=? AND status='leased' AND lease_owner IS NOT NULL")
      .run(JSON.stringify(payload), Date.now(), jobId);
  }
  planPages(jobId: string, purpose: CachedAuxiliaryPurpose, parts: Array<{ systemPrompt: string; userPrompt: string }>): void {
    const row = this.db.prepare("SELECT payload_json FROM jobs WHERE id=? AND status='leased' AND lease_owner IS NOT NULL").get(jobId) as { payload_json: string } | undefined;
    if (!row) throw new Error("Lease not found while planning auxiliary pages");
    const payload = JSON.parse(row.payload_json || "{}");
    payload.auxiliaryPromptParts = parts.map((part) => ({ purpose, ...part }));
    this.db.prepare("UPDATE jobs SET payload_json=?,updated_at=? WHERE id=?").run(JSON.stringify(payload), Date.now(), jobId);
  }
  get publicConfig(): ServerLlmPublicConfig {
    return { ...this.#config, keyConfigured: Boolean(this.apiKey), configuredProviders: providers.filter((provider) => Boolean(this.#apiKeys[provider])) };
  }

  async vertexCredential(signal: AbortSignal, apiKey = this.apiKey, timeoutMs = this.requestTimeoutMs): Promise<{ accessToken: string; projectId: string }> {
    const account = parseVertexServiceAccount(apiKey);
    const credentialHash = createHash("sha256").update(apiKey).digest("hex");
    if (this.#vertexToken && this.#vertexToken.expiresAt > Date.now() + 60_000 && this.#vertexToken.credentialHash === credentialHash) {
      return this.#vertexToken;
    }
    const issuedAt = Math.floor(Date.now() / 1_000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: account.token_uri,
      iat: issuedAt,
      exp: issuedAt + 3_600,
    })}`;
    const assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), account.private_key).toString("base64url")}`;
    const token = await fetchJson(account.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    }, signal, timeoutMs);
    if (typeof token.access_token !== "string" || !token.access_token) throw new Error("Vertex OAuth response did not contain an access token");
    this.#vertexToken = {
      accessToken: token.access_token,
      expiresAt: Date.now() + Math.max(60, Number(token.expires_in) || 3_600) * 1_000,
      projectId: account.project_id,
      credentialHash,
    };
    return this.#vertexToken;
  }

  async copilotCredential(signal: AbortSignal, apiKey: string, timeoutMs: number) {
    const credentialHash = createHash("sha256").update(apiKey).digest("hex");
    if (this.#copilotToken?.credentialHash === credentialHash && this.#copilotToken.expiresAt > Date.now() + 60_000) return this.#copilotToken;
    const token = await copilotFetchJson("https://api.github.com/copilot_internal/v2/token", {
      method: "GET", redirect: "error",
      headers: { ...copilotHeaders, Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    }, signal, timeoutMs);
    if (typeof token.token !== "string" || !token.token.trim() || /[\r\n]/.test(token.token)
      || !Number.isFinite(token.expires_at) || token.expires_at * 1000 <= Date.now()) {
      throw new ProviderRequestError("json", undefined, "Copilot 인증 응답에 유효한 호출 토큰이 없어요.");
    }
    const endpoint = validateEndpoint("copilot", token.endpoints?.api === undefined
      ? SERVER_LLM_DEFAULT_ENDPOINTS.copilot : `${String(token.endpoints.api).replace(/\/$/, "")}/chat/completions`);
    this.#copilotToken = { accessToken: token.token, endpoint, credentialHash,
      expiresAt: Math.min(token.expires_at * 1000, Number.isFinite(token.refresh_in) && token.refresh_in > 0 ? Date.now() + token.refresh_in * 1000 : Infinity) };
    return this.#copilotToken;
  }

  private prepareConfig(input: ServerLlmConfigInput) {
    const parsed = ServerLlmConfigSchema.parse({ ...this.#config, ...input, endpoint: input.endpoint ?? (input.provider && input.provider !== this.#config.provider ? SERVER_LLM_DEFAULT_ENDPOINTS[input.provider] : this.#config.endpoint) });
    const next = {
      ...parsed,
      endpoint: validateEndpoint(parsed.provider, parsed.endpoint),
      thinking: normalizeDirectGeminiThinking(parsed.provider, parsed.model, parsed.thinking),
    };
    if ((next.provider === "gemini_api" || next.provider === "ollama_cloud" || next.provider === "copilot") && next.serviceTier !== "standard") {
      throw new Error("The selected provider supports only the standard processing tier");
    }
    if (next.provider === "vertex" && next.serviceTier !== "standard" && new URL(next.endpoint).hostname !== "aiplatform.googleapis.com") {
      throw new Error("Vertex Flex and Priority require the global aiplatform.googleapis.com endpoint");
    }
    if (next.engine === "server" && !next.apiKey && !this.#apiKeys[next.provider]) throw Object.assign(new Error("An API key is required for server processing"), { code: "AUTH_FAILED" });
    if (next.apiKey && next.provider !== "vertex" && /\r|\n/.test(next.apiKey)) throw new Error("API key contains unsupported line breaks");
    return next;
  }

  async testConnection(input: ServerLlmConfigInput, signal: AbortSignal): Promise<void> {
    const config = this.prepareConfig(input);
    await testProviderConnection(this, config, config.apiKey || this.apiKeyFor(config.provider), signal);
  }

  update(input: ServerLlmConfigInput): ServerLlmPublicConfig {
    const next = this.prepareConfig(input);
    const { apiKey, ...publicConfig } = next;
    if (apiKey) {
      const normalized = next.provider === "vertex" ? JSON.stringify(parseVertexServiceAccount(apiKey)) : apiKey;
      saveSecret(this.secretsPath, secretName(next.provider), normalized);
      this.#apiKeys[next.provider] = normalized;
      this.#vertexToken = undefined;
      this.#copilotToken = undefined;
    }
    this.#config = publicConfig;
    this.db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
      CONFIG_KEY,
      JSON.stringify(publicConfig),
    );
    return this.publicConfig;
  }

  clearKey(): void {
    delete this.#apiKeys[this.#config.provider];
    saveSecret(this.secretsPath, secretName(this.#config.provider), null);
    this.#vertexToken = undefined;
    this.#copilotToken = undefined;
  }
}

interface VertexServiceAccount {
  type: "service_account";
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: "https://oauth2.googleapis.com/token";
}

export function parseVertexServiceAccount(value: string): VertexServiceAccount {
  let parsed: any;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("Vertex credential must be a service-account JSON object"); }
  if (parsed?.type !== "service_account" || typeof parsed.project_id !== "string" || !parsed.project_id.trim()
    || typeof parsed.client_email !== "string" || !parsed.client_email.endsWith(".gserviceaccount.com")
    || typeof parsed.private_key !== "string" || !parsed.private_key.includes("BEGIN PRIVATE KEY")
    || parsed.token_uri !== "https://oauth2.googleapis.com/token") {
    throw new Error("Vertex service-account JSON is missing a supported project_id, client_email, private_key, or token_uri");
  }
  return {
    type: "service_account",
    project_id: parsed.project_id.trim(),
    client_email: parsed.client_email.trim(),
    private_key: parsed.private_key,
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

function validationSummary(error: unknown): string {
  return structuredValidationDiagnostic(error);
}

function thinkingBudget(level: ThinkingLevel): number | undefined {
  if (level === "default") return undefined;
  return { off: 0, low: 1_024, medium: 4_096, high: 8_192 }[level];
}

function openAiGenerationTuning(thinking: ThinkingLevel, temperature: number): Record<string, unknown> {
  const reasoningEffort = thinking === "default" ? undefined : thinking === "off" ? "none" : thinking;
  return { temperature, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) };
}

function geminiGenerationTuning(model: string, thinking: ThinkingLevel, temperature: number): Record<string, unknown> {
  if (usesGeminiFlashThinkingLevel(model)) {
    const thinkingLevel = thinking === "default" ? undefined : thinking === "high" ? "HIGH" : thinking === "medium" ? "MEDIUM" : "LOW";
    return thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {};
  }
  const budget = thinkingBudget(thinking);
  return {
    temperature,
    ...(budget === undefined ? {} : { thinkingConfig: { thinkingBudget: budget } }),
  };
}

function vertexUrl(endpoint: string, model: string, projectId: string): string {
  if (endpoint.includes("{model}")) return endpoint.replaceAll("{model}", encodeURIComponent(model));
  if (endpoint.endsWith(":generateContent")) return endpoint;
  const base = endpoint.replace(/\/$/, "");
  if (/\/projects\/[^/]+\/locations\/[^/]+$/i.test(base)) {
    return `${base}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
  }
  const hostname = new URL(endpoint).hostname;
  const location = hostname === "aiplatform.googleapis.com" ? "global" : hostname.replace(/-aiplatform\.googleapis\.com$/, "");
  return `${base}/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

function geminiApiUrl(endpoint: string, model: string): string {
  if (endpoint.includes("{model}")) return endpoint.replaceAll("{model}", encodeURIComponent(model));
  if (endpoint.endsWith(":generateContent")) return endpoint;
  return `${endpoint.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent`;
}

export class ProviderRequestError extends Error {
  providerMessage?: string;
  constructor(public readonly kind:"timeout"|"transport"|"http"|"json", public readonly status?:number, message?:string) { super(message ?? (kind === "http" ? `Provider HTTP ${status}` : `Provider ${kind} failure`)); }
}

const copilotHeaders = {
  "Editor-Version": "vscode/1.105.0", "Editor-Plugin-Version": "copilot-chat/0.32.0",
  "Copilot-Integration-Id": "vscode-chat", "User-Agent": "RCM",
};

// Authentication details stay private; inference details redact both credentials before logging.
async function copilotFetchJson(url: string, init: RequestInit, signal: AbortSignal, timeoutMs: number, inferenceSecrets?: readonly string[]) {
  try { return await fetchJson(url, init, signal, timeoutMs); }
  catch (error) {
    if (error instanceof ProviderRequestError) {
      const detail = inferenceSecrets ? sanitizeDiagnosticText(error.providerMessage ?? "", inferenceSecrets) : "";
      const failure = new ProviderRequestError(error.kind, error.status,
        error.kind === "http" ? `Copilot HTTP ${error.status} · ${detail || "토큰 권한, 구독 및 모델 사용 가능 여부를 확인해 주세요."}` : `Copilot ${error.kind} failure`);
      if (detail) failure.providerMessage = detail;
      throw failure;
    }
    throw error;
  }
}

async function fetchJson(url: string, init: RequestInit, signal: AbortSignal, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new ProviderRequestError("timeout", undefined, `Server LLM request timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
      throw new ProviderRequestError("transport", undefined, providerTransportFailureMessage(error));
    }
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new ProviderRequestError("transport", response.status, `응답 수신 중 연결이 끊겼어요 (HTTP ${response.status}) · ${providerTransportFailureMessage(error)}`);
    }
    if (!response.ok) {
      const error = new ProviderRequestError("http", response.status, providerHttpFailureMessage(response, body));
      try { const parsed = JSON.parse(body); error.providerMessage = typeof parsed?.error?.message === "string" ? parsed.error.message : typeof parsed?.message === "string" ? parsed.message : undefined; } catch { /* Unstructured response bodies are not diagnostic messages. */ }
      throw error;
    }
    try { return JSON.parse(body); }
    catch { throw new ProviderRequestError("json"); }
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

type ServerLlmPurpose = "quiz" | "memory_group" | "memory_group_repair" | "extraction" | "extraction_repair" | "initial_calibration" | "initial_calibration_repair" | "audit" | "audit_repair" | "reconciliation" | "reconciliation_repair" | "state_response_repair" | "ledger_consistency" | "ledger_consistency_repair" | "relationship_projection" | "relationship_projection_repair" | "story_consolidation" | "story_consolidation_repair" | "episode_draft" | "episode_draft_repair" | "episode_finalize" | "episode_finalize_repair";

export async function groupMemoriesWithServerLlm(store: ServerLlmStore, job: LeasedJob, signal: AbortSignal): Promise<MemoryGroupingResult> {
  const stage = job.memoryGrouping!;
  const messages = [{ role: 'system' as const, content: stage.systemPrompt }, { role: 'user' as const, content: stage.userPrompt }];
  const first = await callProvider(store, job.id, messages, signal, 'memory_group');
  try { return validateGroupingResult(parseServerJson(first, 'memory_group'), stage); }
  catch (error) {
    const repaired = await callRepairProvider(() => callProvider(store, job.id, buildAuxiliaryRepairMessages({
      originalMessages: messages, invalidOutput: first, validationError: error, request: { kind: "memory_group" },
    }), signal, 'memory_group_repair'));
    return validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "memory_group",
      regenerate: () => callProvider(store, job.id, messages, signal, "memory_group"),
      validate: (output, phase) => {
        return validateGroupingResult(parseServerJson(output, phase === "repair" ? "memory_group_repair" : "memory_group"), stage);
      },
    });
  }
}

function compactProviderErrorBody(body: string): string {
  if (!body.trim()) return "";
  try {
    const parsed = JSON.parse(body) as any;
    return String(parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? "").replace(/\s+/g, " ").slice(0, 240);
  } catch {
    return body.replace(/\s+/g, " ").slice(0, 240);
  }
}

function providerHttpFailureMessage(response: Response, body: string): string {
  const status = response.status;
  const label = status === 429 ? "요청 제한"
    : [500, 502, 503, 504].includes(status) ? "모델 서버 오류"
      : [401, 403].includes(status) ? "인증 실패"
        : status === 408 ? "요청 시간 초과"
          : status === 400 ? "요청 거부"
            : "모델 요청 실패";
  const retryAfter = response.headers.get("retry-after")?.trim();
  const detail = compactProviderErrorBody(body);
  const retryCopy = retryAfter ? /^\d+$/.test(retryAfter) ? `${retryAfter}초 후 재시도` : `재시도 안내 ${retryAfter}` : "";
  return `${label} (HTTP ${status})${retryCopy ? ` · ${retryCopy}` : ""}${detail ? ` · ${detail}` : ""}`;
}

function providerTransportFailureMessage(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = String((cause as any)?.code ?? (error as any)?.code ?? "").trim().toUpperCase();
  const suffix = code ? ` (${code})` : "";
  if (["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT"].includes(code)) return `연결 시간 초과 · HTTP 상태를 받지 못했어요${suffix}`;
  if (["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code)) return `응답 대기 시간 초과 · HTTP 상태를 받지 못했어요${suffix}`;
  if (["UND_ERR_SOCKET", "ECONNRESET", "EPIPE"].includes(code)) return `연결이 중간에 끊겼어요 · HTTP 상태를 받지 못했어요${suffix}`;
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return `모델 서버 주소를 찾지 못했어요${suffix}`;
  if (code === "ECONNREFUSED") return `모델 서버가 연결을 거부했어요${suffix}`;
  if (/CERT|TLS|SSL/.test(code)) return `보안 연결에 실패했어요${suffix}`;
  return `연결 요청에 실패했어요 · HTTP 상태를 받지 못했어요${suffix}`;
}

function parseServerJson(text: string, purpose: ServerLlmPurpose): unknown {
  const parsed = parseStructuredModelJson(text);
  if (parsed.repaired) console.warn(`[RCM] Server LLM local JSON repair purpose=${purpose} repairs=${parsed.repairs.join(",")}${parsed.keyQuoteInsertions === undefined ? "" : ` keyQuoteInsertions=${parsed.keyQuoteInsertions}`}`);
  return normalizeStructuredModelOptionals(parsed.value);
}

export class ServerLlmOutputError extends Error {
  readonly retryable = true;
  constructor(readonly reason: "empty_output" | "max_tokens", message: string) {
    super(message);
    this.name = "ServerLlmOutputError";
  }
}

async function callRepairProvider(call: () => Promise<string>): Promise<string> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ServerLlmOutputError && error.reason === "empty_output") return "";
    throw error;
  }
}

function ensureCompleteOutput(content: string, finishReason: unknown): string {
  const normalized = String(finishReason ?? "").trim().toUpperCase();
  if (["MAX_TOKENS", "MAX_OUTPUT_TOKENS", "LENGTH"].includes(normalized)) {
    throw new ServerLlmOutputError("max_tokens", `Server LLM output was truncated (${normalized})`);
  }
  if (!content.trim()) throw new ServerLlmOutputError("empty_output", "Server LLM returned an empty response");
  return content;
}

function finiteTokenCount(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

async function callProvider(
  store: ServerLlmStore,
  jobId: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  signal: AbortSignal,
  purpose: ServerLlmPurpose,
  requestedOutputBudget?: number,
): Promise<string> {
  messages = messages.map(message => ({ ...message, content: prepareAuxiliaryText(message.content) }));
  // A job snapshot remains diagnostic history. Operational recovery settings
  // are read at the start of every call so a queued retry can switch provider,
  // model, service tier, limits or timeout without rebuilding the job.
  const config = ServerLlmConfigSchema.omit({ apiKey: true }).parse(store.config);
  const apiKey = store.apiKeyFor(config.provider);
  if (!apiKey) throw new Error("Server LLM API key is not configured");
  const measurement = measureAuxiliaryPrompt(messages, estimateTokens, config);
  if (!measurement.fits) throw new Error(`AUXILIARY_INPUT_BUDGET_EXCEEDED: completed input needs about ${measurement.estimatedInputTokens} tokens; limit is ${measurement.maxInputTokens}. Source and intermediate results were preserved for retry.`);
  const startedAt = Date.now();
  const timingId = randomUUID();
  store.recordTiming({ id: timingId, jobId, purpose, startedAt, outcome: "running" });
  const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  const jsonBudget = Math.min(config.maxOutputTokens, requestedOutputBudget ?? config.maxOutputTokens);
  const limit = jsonBudget;
  console.log(`[RCM] Server LLM request start provider=${config.provider} model=${config.model} purpose=${purpose} promptChars=${promptChars} jsonBudget=${jsonBudget} maxTokens=${limit}`);
  const finish = (content: string, metadata: { finishReason?: unknown; usage?: any } = {}): string => {
    const promptTokens = finiteTokenCount(metadata.usage?.prompt_tokens ?? metadata.usage?.promptTokenCount);
    const completionTokens = finiteTokenCount(metadata.usage?.completion_tokens ?? metadata.usage?.candidatesTokenCount);
    const reasoningTokens = finiteTokenCount(metadata.usage?.reasoning_tokens ?? metadata.usage?.completion_tokens_details?.reasoning_tokens ?? metadata.usage?.thoughtsTokenCount);
    const cachedInputTokens = finiteTokenCount(metadata.usage?.cachedContentTokenCount ?? metadata.usage?.prompt_tokens_details?.cached_tokens ?? metadata.usage?.cached_tokens);
    console.log([
      `[RCM] Server LLM request complete provider=${config.provider} model=${config.model} purpose=${purpose}`,
      `elapsedMs=${Date.now() - startedAt} contentChars=${content.length}`,
      metadata.finishReason ? `finishReason=${String(metadata.finishReason)}` : "",
      promptTokens === undefined ? "" : `promptTokens=${promptTokens}`,
      completionTokens === undefined ? "" : `completionTokens=${completionTokens}`,
      reasoningTokens === undefined ? "" : `reasoningTokens=${reasoningTokens}`,
      cachedInputTokens === undefined ? "" : `cachedInputTokens=${cachedInputTokens}`,
    ].filter(Boolean).join(" "));
    store.stageOutput(jobId, content);
    let completed: string;
    try { completed = ensureCompleteOutput(content, metadata.finishReason); }
    catch (error) {
      store.settleCall(jobId, purpose, "failed", { error, usage: { promptTokens, completionTokens, reasoningTokens, cachedInputTokens } });
      throw error;
    }
    store.settleCall(jobId, purpose, "succeeded", { usage: { promptTokens, completionTokens, reasoningTokens, cachedInputTokens } });
    store.recordTiming({ id: timingId, jobId, purpose, startedAt, elapsedMs: Date.now() - startedAt, outcome: "succeeded" });
    return completed;
  };
  try {
    const result = await requestStructuredProvider(store, config, apiKey, messages, signal, limit, () => store.recordCall(jobId, purpose), purpose === "quiz" ? "text" : "json");
    return finish(result.content, result);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 300);
    store.settleCall(jobId, purpose, "failed", { error: message });
    store.recordTiming({ id: timingId, jobId, purpose, startedAt, elapsedMs: Date.now() - startedAt, outcome: "failed" });
    console.warn(`[RCM] Server LLM request failed provider=${config.provider} model=${config.model} purpose=${purpose} elapsedMs=${Date.now() - startedAt} error=${message}`);
    throw error;
  }
}

/** Fixed, unsaved probe: no job, retry, model output log or configuration update. */
export async function testProviderConnection(
  store: Pick<ServerLlmStore, "vertexCredential" | "copilotCredential">,
  config: Parameters<typeof requestStructuredProvider>[1],
  apiKey: string,
  signal: AbortSignal,
): Promise<void> {
  if (!apiKey) throw Object.assign(new Error("CONNECTION_KEY_REQUIRED"), { code: "AUTH_FAILED" });
  // Legacy Gemini counts an explicit thinking budget inside maxOutputTokens.
  // Preserve the selected tuning without making a healthy connection fail on a contradictory cap.
  const limit = (config.provider === "gemini_api" || config.provider === "vertex") && !usesGeminiFlashThinkingLevel(config.model)
    ? 512 + (thinkingBudget(config.thinking) ?? 0) : 512;
  let result;
  try { result = await requestStructuredProvider(store, { ...config, llmTimeoutMs: Math.min(config.llmTimeoutMs, 60_000) }, apiKey,
    [{ role: "user", content: "Connection check. Reply with OK only." }], signal, limit, undefined, "text");
  } catch (error) {
    if (error instanceof ProviderRequestError) error.providerMessage = sanitizeDiagnosticText(error.providerMessage ?? "", [apiKey]);
    throw error;
  }
  if (!result.content.trim()) throw Object.assign(new Error("CONNECTION_EMPTY_RESPONSE"), { code: "INVALID_RESPONSE" });
}

/** Shared transport only. Selection and extraction keep independent config,
 * accounting, retry and output validation policies. */
export async function requestStructuredProvider(
  store: Pick<ServerLlmStore,"vertexCredential" | "copilotCredential">,
  config: Pick<StoredServerLlmConfig,"provider"|"endpoint"|"model"|"temperature"|"thinking"|"serviceTier"|"llmTimeoutMs">,
  apiKey: string,
  messages: Array<{role:"system"|"user"|"assistant";content:string}>,
  signal: AbortSignal,
  limit: number,
  onRequest: () => void = () => {},
  outputFormat: "json" | "text" = "json",
): Promise<{content:string;finishReason?:unknown;usage?:any}> {
    const deadline = Date.now() + config.llmTimeoutMs;
    if (config.provider === "copilot") {
      const configuredEndpoint = validateEndpoint("copilot", config.endpoint);
      const credential = await store.copilotCredential(signal, apiKey, Math.max(1, deadline - Date.now()));
      onRequest();
      const result = await copilotFetchJson(configuredEndpoint === SERVER_LLM_DEFAULT_ENDPOINTS.copilot ? credential.endpoint : configuredEndpoint, {
        method: "POST", redirect: "error",
        headers: { ...copilotHeaders, "Content-Type": "application/json", Authorization: `Bearer ${credential.accessToken}`, "X-Initiator": "agent" },
        // JSON uses the prompt; unsupported tuning fails without a parameter fallback.
        body: JSON.stringify({ model: config.model, messages, ...openAiGenerationTuning(config.thinking, config.temperature), max_tokens: limit, stream: false }),
      }, signal, Math.max(1, deadline - Date.now()), [apiKey, credential.accessToken]);
      return { content: String(result.choices?.[0]?.message?.content ?? ""), finishReason: result.choices?.[0]?.finish_reason, usage: result.usage };
    }
    if (config.provider === "gemini_api" || config.provider === "vertex") {
      const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
      const contents = messages.filter((message) => message.role !== "system").map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      }));
      const vertex = config.provider === "vertex" ? await store.vertexCredential(signal, apiKey, Math.max(1, deadline - Date.now())) : undefined;
      const timeoutMs = Math.max(1, deadline - Date.now());
      const url = config.provider === "gemini_api" ? geminiApiUrl(config.endpoint, config.model) : vertexUrl(config.endpoint, config.model, vertex!.projectId);
      const headers: Record<string, string> = config.provider === "gemini_api"
        ? { "Content-Type": "application/json", "x-goog-api-key": apiKey }
        : { "Content-Type": "application/json", Authorization: `Bearer ${vertex!.accessToken}` };
      if (config.provider === "vertex" && config.serviceTier !== "standard") {
        headers["X-Vertex-AI-LLM-Request-Type"] = "shared";
        headers["X-Vertex-AI-LLM-Shared-Request-Type"] = config.serviceTier;
        if (config.serviceTier === "flex") headers["X-Server-Timeout"] = "1800";
      }
      const request: RequestInit = {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents,
          generationConfig: {
            maxOutputTokens: limit,
            ...(outputFormat === "json" ? { responseMimeType: "application/json" } : {}),
            ...geminiGenerationTuning(config.model, config.thinking, config.temperature),
          },
        }),
      };
      onRequest();
      const result = await fetchJson(url, request, signal, timeoutMs);
      const content = (result.candidates?.[0]?.content?.parts ?? []).map((part: any) => typeof part?.text === "string" ? part.text : "").join("");
      return { content, finishReason: result.candidates?.[0]?.finishReason, usage: result.usageMetadata };
    }

    if (config.provider === "ollama_cloud") {
      const think = config.thinking === "default" ? undefined : config.thinking === "off" ? false : config.thinking;
      onRequest();
      const result = await fetchJson(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          // Ollama Cloud does not support structured outputs; the prompt asks for JSON and repair covers the rest.
          model: config.model, messages, stream: false,
          options: { temperature: config.temperature, num_predict: limit },
          ...(think === undefined ? {} : { think }),
        }),
      }, signal, config.llmTimeoutMs);
      return { content:String(result.message?.content ?? ""), finishReason:result.done_reason, usage:{prompt_tokens:result.prompt_eval_count,completion_tokens:result.eval_count} };
    }

    // LLM Gateway has no Gemma route that accepts JSON mode and rejects the request outright;
    // the prompt already asks for JSON and structured repair covers malformed output.
    const jsonMode = outputFormat === "json" && !/gemma/i.test(config.model);
    const request = {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages,
        ...openAiGenerationTuning(config.thinking, config.temperature),
        max_tokens: limit,
        stream: false,
        ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(config.serviceTier === "standard" || config.provider === "vercel" ? {} : { service_tier: config.serviceTier }),
      }),
    } satisfies RequestInit;
    onRequest();
    const result = await fetchJson(config.endpoint, request, signal, config.llmTimeoutMs);
    return { content:String(result.choices?.[0]?.message?.content ?? ""), finishReason:result.choices?.[0]?.finish_reason, usage:result.usage };
}

export async function extractWithServerLlm(store: ServerLlmStore, job: LeasedJob, signal: AbortSignal, onRepair?: () => void): Promise<ExtractionDraftResult> {
  const checkpoint = store.cachedExtraction(job);
  if (checkpoint) return checkpoint;
  const sourceMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = job.systemPrompt && job.userPrompt
    ? [{ role: "system", content: job.systemPrompt }, { role: "user", content: job.userPrompt }]
    : [{ role: "user", content: job.prompt }];
  const first = await callProvider(store, job.id, sourceMessages, signal, "extraction");
  store.stageOutput(job.id, first);
  const validate = (output: string, purpose: "extraction" | "extraction_repair"): ExtractionDraftResult => {
    const parsed = Api38ExtractionDraftResultSchema.parse(normalizeExtractionDraftInput(job.sourceUnits
      ? resolveModelSourceReferences(parseServerJson(output, purpose), job.sourceUnits)
      : parseServerJson(output, purpose)), { reportInput: true });
    if (parsed.language !== job.memoryLanguage) throw new Error(`Expected canonical language ${job.memoryLanguage}, received ${parsed.language}`);
    return parsed;
  };
  const validateRepair = async (repaired: string): Promise<ExtractionDraftResult> => validateStructuredRepairOrRegenerate({
    original: first,
    repaired,
    purpose: "extraction",
    regenerate: async () => {
      const regenerated = await callProvider(store, job.id, sourceMessages, signal, "extraction");
      store.stageOutput(job.id, regenerated);
      return regenerated;
    },
    validate: (output, phase) => validate(output, phase === "repair" ? "extraction_repair" : "extraction"),
  });
  let raw: unknown;
  let resolved: unknown;
  try {
    raw = parseServerJson(first, "extraction");
    resolved = normalizeExtractionDraftInput(job.sourceUnits ? resolveModelSourceReferences(raw, job.sourceUnits) : raw);
    const parsed = Api38ExtractionDraftResultSchema.parse(resolved, { reportInput: true });
    if (parsed.language !== job.memoryLanguage) throw new Error(`Expected canonical language ${job.memoryLanguage}, received ${parsed.language}`);
    return store.cacheExtraction(job, parsed);
  } catch (firstError) {
    onRepair?.();
    const rawWindow = structuredJsonErrorWindow(first, firstError);
    console.warn(`[RCM] Server LLM validation repair purpose=extraction issue=${validationSummary(firstError)}${rawWindow === undefined ? "" : ` rawWindow=${JSON.stringify(rawWindow)}`}`);
    const fieldRepair = job.sourceUnits ? planExtractionFieldRepair(raw, resolved, firstError, job.sourceUnits) : undefined;
    if (fieldRepair) {
      const response = await callRepairProvider(() => callProvider(store, job.id, fieldRepair.messages, signal, "extraction_repair"));
      if (isUnchangedStructuredRepair(first, response)) return store.cacheExtraction(job, await validateRepair(response));
      let fieldRepairOutput: unknown;
      try {
        fieldRepairOutput = parseServerJson(response, "extraction_repair");
      } catch (error) {
        if (error instanceof StructuredJsonSyntaxError) return store.cacheExtraction(job, await validateRepair(response));
        throw error;
      }
      const corrected = applyExtractionFieldRepair(raw, fieldRepair, fieldRepairOutput);
      const repaired = JSON.stringify(corrected);
      store.stageOutput(job.id, repaired);
      return store.cacheExtraction(job, await validateRepair(repaired));
    }
    const repaired = await callRepairProvider(() => callProvider(store, job.id, buildAuxiliaryRepairMessages({
      originalMessages: sourceMessages,
      invalidOutput: first,
      validationError: firstError,
      request: { kind: "extraction", sourceMode: job.sourceUnits ? "source_units" : "message_ids" },
    }), signal, "extraction_repair"));
    store.stageOutput(job.id, repaired);
    return store.cacheExtraction(job, await validateRepair(repaired));
  }
}

export async function repairSourceEvidenceWithServerLlm(store: ServerLlmStore, job: LeasedJob, draft: ExtractionDraftResult, signal: AbortSignal): Promise<ExtractionDraftResult> {
  const issues = inspectSourceReferences(draft, job.auditSourceMessages ?? []).filter((issue) => issue.reason !== "access_unverified");
  if (!issues.length || !job.sourceUnits) return draft;
  const messages = sourceRepairMessages(draft, issues, job.sourceUnits);
  if (!messages) return draft;
  const raw = await callProvider(store, job.id, messages, signal, "extraction_repair");
  return applySourceRepairs(draft, parseServerJson(raw, "extraction_repair"), issues, job.sourceUnits);
}

export async function repairPassageAccessWithServerLlm(store: ServerLlmStore, job: LeasedJob, draft: ExtractionDraftResult, plan: SourceAccessRepairPlan, signal: AbortSignal): Promise<ExtractionDraftResult> {
  const response = await callProvider(store, job.id, [{ role: "system", content: plan.systemPrompt }, { role: "user", content: plan.userPrompt }], signal, "extraction_repair");
  return applySourceAccessRepair(draft, plan, parseServerJson(response, "extraction_repair"));
}

export async function calibrateInitialSetupWithServerLlm(store: ServerLlmStore, job: LeasedJob, signal: AbortSignal): Promise<InitialCalibrationResult> {
  const validate = (raw: string, label: "initial_calibration" | "initial_calibration_repair"): InitialCalibrationResult => {
    const parsed = InitialCalibrationResultSchema.parse(parseServerJson(raw, label));
    return job.initialCalibration
      ? normalizeAndValidateSetupEvidence(job.initialCalibration.resolvedSetup, parsed, job.initialCalibration.identityHints)
      : parsed;
  };
  const parts = job.initialCalibration?.promptParts?.length ? job.initialCalibration.promptParts
    : [{ systemPrompt: job.systemPrompt ?? "", userPrompt: job.userPrompt ?? job.prompt }];
  const results: InitialCalibrationResult[] = [];
  for (const part of parts) {
    const cached = store.cachedPage(job.id, "initial_calibration", part.systemPrompt, part.userPrompt);
    if (cached !== undefined) { results.push(InitialCalibrationResultSchema.parse(cached)); continue; }
    const messages = part.systemPrompt
      ? [{ role: "system" as const, content: part.systemPrompt }, { role: "user" as const, content: part.userPrompt }]
      : [{ role: "user" as const, content: part.userPrompt }];
    const first = await callProvider(store, job.id, messages, signal, "initial_calibration");
    try { const parsed = validate(first, "initial_calibration"); store.cachePage(job.id, "initial_calibration", part.systemPrompt, part.userPrompt, parsed); results.push(parsed); }
    catch (firstError) {
      const repaired = await callRepairProvider(() => callProvider(store, job.id, buildAuxiliaryRepairMessages({
        originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "initial_calibration" },
      }), signal, "initial_calibration_repair"));
      const parsed = await validateStructuredRepairOrRegenerate({
        original: first, repaired, purpose: "initial_calibration",
        regenerate: () => callProvider(store, job.id, messages, signal, "initial_calibration"),
        validate: (output, phase) => {
          return validate(output, phase === "repair" ? "initial_calibration_repair" : "initial_calibration");
        },
      }); store.cachePage(job.id, "initial_calibration", part.systemPrompt, part.userPrompt, parsed); results.push(parsed);
    }
  }
  return mergeInitialCalibrationResults(results);
}

export async function auditExtractionWithServerLlm(store: ServerLlmStore, job: LeasedJob, result: unknown, signal: AbortSignal, onRepair?: () => void): Promise<ExtractionAuditSubmission> {
  const draft = extractionAuditDraftForJob(job, result);
  const messages = buildExtractionAuditMessages({
    memoryLanguage: job.memoryLanguage,
    sourceMessages: job.auditSourceMessages ?? [],
    draft,
    existingOpenPromises: job.auditExistingOpenPromises,
    recallCandidates: job.recallCandidates,
    sourceRecovery: job.sourceRecovery,
    sourceRecoveryContext: job.sourceRecoveryContext,
  });
  const first = await callProvider(store, job.id, messages, signal, "audit");
  const validatePatch = (value: unknown) => { const patch = ExtractionAuditPatchSchema.parse(resolveDirectDialogueEvidence(value,job.sourceUnits??[])); return job.sourceRecovery ? validateSourceRecoveryPatch(patch,draft) : patch; };
  try { return { patch: validatePatch(parseServerJson(first, "audit")) }; }
  catch (firstError) {
    onRepair?.();
    const repaired = await callRepairProvider(() => callProvider(store, job.id, buildAuxiliaryRepairMessages({
      originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "audit" },
    }), signal, "audit_repair"));
    return validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "audit",
      regenerate: () => callProvider(store, job.id, messages, signal, "audit"),
      validate: (output, phase) => {
        return { patch: validatePatch(parseServerJson(output, phase === "repair" ? "audit_repair" : "audit")) };
      },
    });
  }
}

export async function episodeWithServerLlm(store: ServerLlmStore, job: LeasedJob, signal: AbortSignal): Promise<EpisodeCapsuleResult> {
  if (!job.episode) throw new Error("Episode job is missing its prompt plan");
  let drafts: EpisodeDraftResult[] = [];
  for (const draft of job.episode.drafts) {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: draft.systemPrompt }, { role: "user", content: draft.userPrompt },
    ];
    const first = await callProvider(store, job.id, messages, signal, "episode_draft");
    try { drafts.push(EpisodeDraftResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeDraftInput(parseServerJson(first, "episode_draft"), draft.sourceMessageIds),job.sourceUnits??[]))); }
    catch (firstError) {
      const repaired = await callRepairProvider(() => callProvider(store, job.id, buildAuxiliaryRepairMessages({
        originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "episode_draft" },
      }), signal, "episode_draft_repair"));
      drafts.push(await validateStructuredRepairOrRegenerate({
        original: first, repaired, purpose: "episode_draft",
        regenerate: () => callProvider(store, job.id, messages, signal, "episode_draft"),
        validate: (output, phase) => {
          return EpisodeDraftResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeDraftInput(parseServerJson(output, phase === "repair" ? "episode_draft_repair" : "episode_draft"), draft.sourceMessageIds),job.sourceUnits??[]));
        },
      }));
    }
  }
  while (drafts.length > 1 && estimateTokens(JSON.stringify(drafts)) > 45_000) {
    const consolidated: EpisodeDraftResult[] = [];
    for (const group of groupEpisodeDrafts(drafts)) {
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: job.episode.finalizeSystemPrompt },
        { role: "user", content: `Consolidate these adjacent episode drafts into one strict episode draft JSON. Retain only dialogue that passes KEY DIALOGUE SELECTION; deduplicate routine or synopsis-redundant lines rather than preserving a quota. Preserve source message IDs and each retained dialogue's complete displayed source form, including quotation marks and any immediately following parenthesized counterpart; do not invent evidence.\n${JSON.stringify(group)}` },
      ];
      const first = await callProvider(store, job.id, messages, signal, "episode_draft");
      const sourceIds = [...new Set(group.flatMap((draft) => draft.evidence.map((item) => item.messageId)))];
      try { consolidated.push(EpisodeDraftResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeDraftInput(parseServerJson(first, "episode_draft"), sourceIds),job.sourceUnits??[]))); }
      catch (firstError) {
        const repaired = await callRepairProvider(() => callProvider(store, job.id, buildAuxiliaryRepairMessages({
          originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "episode_draft" },
        }), signal, "episode_draft_repair"));
        consolidated.push(await validateStructuredRepairOrRegenerate({
          original: first, repaired, purpose: "episode_draft",
          regenerate: () => callProvider(store, job.id, messages, signal, "episode_draft"),
          validate: (output, phase) => {
            return EpisodeDraftResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeDraftInput(parseServerJson(output, phase === "repair" ? "episode_draft_repair" : "episode_draft"), sourceIds),job.sourceUnits??[]));
          },
        }));
      }
    }
    if (consolidated.length >= drafts.length) break;
    drafts = consolidated;
  }
  const userPrompt = job.episode.finalizeUserPrompt.replace("{{DRAFTS}}", JSON.stringify(drafts));
  job.systemPrompt = job.episode.finalizeSystemPrompt;
  job.userPrompt = userPrompt;
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: job.episode.finalizeSystemPrompt }, { role: "user", content: userPrompt },
  ];
  const first = await callProvider(store, job.id, messages, signal, "episode_finalize");
  try {
    const parsed = EpisodeCapsuleResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeCapsuleInput(parseServerJson(first, "episode_finalize"), job.sourceMessageIds),job.sourceUnits??[]));
    if (parsed.language !== job.memoryLanguage) throw new Error(`Expected canonical language ${job.memoryLanguage}, received ${parsed.language}`);
    return parsed;
  }
  catch (firstError) {
    const repaired = await callRepairProvider(() => callProvider(store, job.id, buildAuxiliaryRepairMessages({
      originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "episode_finalize" },
    }), signal, "episode_finalize_repair"));
    return validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "episode_finalize",
      regenerate: () => callProvider(store, job.id, messages, signal, "episode_finalize"),
      validate: (output, phase) => {
        const parsed = EpisodeCapsuleResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeCapsuleInput(parseServerJson(output, phase === "repair" ? "episode_finalize_repair" : "episode_finalize"), job.sourceMessageIds),job.sourceUnits??[]));
        if (parsed.language !== job.memoryLanguage) throw new Error(`Canonical language is still ${parsed.language}; expected ${job.memoryLanguage}`);
        return parsed;
      },
    });
  }
}

export async function reconcileWithServerLlm(
  store: ServerLlmStore,
  jobId: string,
  prompts: { systemPrompt: string; userPrompt: string; stateExtraction?: boolean; sourceUnits?: import("@rcm/shared").SourceUnit[] },
  signal: AbortSignal,
  onRepair?: () => void,
  accessRepair?: { plan: SourceAccessRepairPlan; onResponse: (value: unknown) => void },
): Promise<ReconciliationResult> {
  const sourceMessages = [{ role: "system" as const, content: prompts.systemPrompt + (accessRepair ? `\nAlso complete the independent source-access task. Keep decisions and sourceAccessCorrections as separate fields in the same JSON object.\n${accessRepair.plan.systemPrompt}` : "") },
    { role: "user" as const, content: accessRepair ? JSON.stringify({ ledger: JSON.parse(prompts.userPrompt), sourceAccess: JSON.parse(accessRepair.plan.userPrompt) }) : prompts.userPrompt }];
  const purpose = accessRepair ? "reconciliation_repair" : "reconciliation";
  const first = await callProvider(store, jobId, sourceMessages, signal, purpose);
  const validate = (output: string, label: ServerLlmPurpose): ReconciliationResult => {
    const raw = parseServerJson(output, label);
    const result = parseReconciliationResult(raw, prompts.sourceUnits);
    if (prompts.stateExtraction && !result.state) throw new Error("State extraction response is missing state");
    accessRepair?.onResponse(raw);
    return result;
  };
  try { return validate(first, purpose); } catch (firstError) {
    onRepair?.();
    const repairPurpose = prompts.stateExtraction ? "state_response_repair" : "reconciliation_repair";
    const reason = validationSummary(firstError);
    console.warn(`[RCM] Server LLM validation repair purpose=${repairPurpose} issue=${reason}`);
    let repaired: string;
    try { repaired = await callRepairProvider(() => callProvider(store, jobId, buildAuxiliaryRepairMessages({
      originalMessages: sourceMessages, invalidOutput: first, validationError: firstError, request: { kind: "reconciliation" },
    }), signal, repairPurpose)); }
    catch (error) { throw new Error(`State response repair failed: ${String(error)}; initial_validation=${reason}`); }
    return validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "reconciliation",
      regenerate: () => callProvider(store, jobId, sourceMessages, signal, "reconciliation"),
      validate: (output, phase) => validate(output, phase === "repair" ? repairPurpose : "reconciliation"),
    });
  }
}

export async function checkLedgerConsistencyWithServerLlm(store: ServerLlmStore, job: LeasedJob, signal: AbortSignal, onRepair?: () => void): Promise<LedgerConsistencyResult> {
  const parts = job.ledgerConsistency?.promptParts?.length ? job.ledgerConsistency.promptParts : [{ systemPrompt: job.systemPrompt ?? "", userPrompt: job.userPrompt ?? job.prompt }];
  const merged = new Map<string, LedgerConsistencyResult["groups"][number]>();
  for (const part of parts) {
    const cached = store.cachedPage(job.id, "ledger_consistency", part.systemPrompt, part.userPrompt);
    if (cached !== undefined) {
      for (const group of LedgerConsistencyResultSchema.parse(cached).groups) {
        const prior = merged.get(group.itemRef);
        merged.set(group.itemRef, prior ? { itemRef: group.itemRef, closures: [...prior.closures, ...group.closures] } : group);
      }
      continue;
    }
    const sourceMessages = part.systemPrompt ? [{ role: "system" as const, content: part.systemPrompt }, { role: "user" as const, content: part.userPrompt }] : [{ role: "user" as const, content: part.userPrompt }];
    const first = await callProvider(store, job.id, sourceMessages, signal, "ledger_consistency");
    let parsed: LedgerConsistencyResult;
    try { parsed = LedgerConsistencyResultSchema.parse(parseServerJson(first, "ledger_consistency")); }
    catch (firstError) {
    onRepair?.();
    const repaired = await callRepairProvider(() => callProvider(store, job.id, buildAuxiliaryRepairMessages({
      originalMessages: sourceMessages, invalidOutput: first, validationError: firstError, request: { kind: "ledger_consistency" },
    }), signal, "ledger_consistency_repair"));
    parsed = await validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "ledger_consistency",
      regenerate: () => callProvider(store, job.id, sourceMessages, signal, "ledger_consistency"),
      validate: (output, phase) => {
        return LedgerConsistencyResultSchema.parse(parseServerJson(output, phase === "repair" ? "ledger_consistency_repair" : "ledger_consistency"));
      },
    });
    }
    const expected = new Set("itemRefs" in part ? part.itemRefs : job.ledgerConsistency?.groups.map((group) => group.itemRef) ?? []);
    if (parsed.groups.length !== expected.size || new Set(parsed.groups.map((group) => group.itemRef)).size !== expected.size || parsed.groups.some((group) => !expected.has(group.itemRef))) throw new Error("Ledger page did not return every supplied group exactly once");
    store.cachePage(job.id, "ledger_consistency", part.systemPrompt, part.userPrompt, parsed);
    for (const group of parsed.groups) {
      const prior = merged.get(group.itemRef);
      merged.set(group.itemRef, prior ? { itemRef: group.itemRef, closures: [...prior.closures, ...group.closures] } : group);
    }
  }
  return LedgerConsistencyResultSchema.parse({ groups: [...merged.values()] });
}

export async function projectRelationshipsWithServerLlm(store: ServerLlmStore, job: LeasedJob, signal: AbortSignal): Promise<RelationshipProjectionResult> {
  const sourceMessages = job.systemPrompt && job.userPrompt
    ? [{ role: "system" as const, content: job.systemPrompt }, { role: "user" as const, content: job.userPrompt }]
    : [{ role: "user" as const, content: job.prompt }];
  const first = await callProvider(store, job.id, sourceMessages, signal, "relationship_projection");
  try { return RelationshipProjectionResultSchema.parse(parseServerJson(first, "relationship_projection"), { reportInput: true }); }
  catch (firstError) {
    const repaired = await callRepairProvider(() => callProvider(store, job.id, buildAuxiliaryRepairMessages({
      originalMessages: sourceMessages, invalidOutput: first, validationError: firstError, request: { kind: "relationship_projection" },
    }), signal, "relationship_projection_repair"));
    return validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "relationship_projection",
      regenerate: () => callProvider(store, job.id, sourceMessages, signal, "relationship_projection"),
      validate: (output, phase) => {
        return RelationshipProjectionResultSchema.parse(parseServerJson(output, phase === "repair" ? "relationship_projection_repair" : "relationship_projection"), { reportInput: true });
      },
    });
  }
}

export async function consolidateStorySpineWithServerLlm(store: ServerLlmStore, job: LeasedJob, signal: AbortSignal): Promise<StorySpineConsolidationResult> {
  const systemPrompt = job.systemPrompt ?? "";
  const userPrompt = job.userPrompt ?? "";
  const validateGenerationShape = (value: unknown): StorySpineConsolidationResult => {
    const parsed = StorySpineConsolidationResultSchema.parse(value);
    if (!job.storyConsolidation) throw new Error("Story consolidation metadata unavailable");
    validateStorySpineConsolidation(parsed, job.storyConsolidation);
    return parsed;
  };
  const first = await callProvider(store, job.id, [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], signal, "story_consolidation");
  store.stageOutput(job.id, first);
  try { return validateGenerationShape(parseServerJson(first, "story_consolidation")); }
  catch (error) {
    store.stageOutput(job.id, first, validationSummary(error));
    const second = await callRepairProvider(() => callProvider(store, job.id, buildAuxiliaryRepairMessages({
      originalMessages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      invalidOutput: first,
      validationError: error,
      request: { kind: "story_spine", level: job.storyConsolidation?.level ?? "segment" },
    }), signal, "story_consolidation_repair"));
    store.stageOutput(job.id, second);
    return validateStructuredRepairOrRegenerate({
      original: first, repaired: second, purpose: "story_consolidation",
      regenerate: () => callProvider(store, job.id, [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], signal, "story_consolidation"),
      validate: (output, phase) => {
        return validateGenerationShape(parseServerJson(output, phase === "repair" ? "story_consolidation_repair" : "story_consolidation"));
      },
    });
  }
}


export async function quizWithServerLlm(store: ServerLlmStore, job: LeasedJob, signal: AbortSignal): Promise<unknown> {
  const out = await callProvider(store, job.id, [{ role: "system", content: job.systemPrompt ?? "" },
    { role: "user", content: job.userPrompt ?? "" }], signal, "quiz");
  store.stageOutput(job.id, out);
  return parseServerJson(out, "quiz");
}
