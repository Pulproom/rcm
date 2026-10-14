import { risuModelSlot } from "./worker.js";
import { planTranslation, translationSystemPrompt, validateTranslation, TRANSLATION_TIMEOUT_MS, TranslationError, sanitizeDiagnosticText, prepareAuxiliaryText } from "@rcm/shared";
import type { RuntimeState, TranslationDisplay, TranslationProvider } from "./types.js";
import type { MemoryLanguage } from "@rcm/shared";
import { ServerClient } from "./api-client.js";
import { addLog } from "./settings.js";

const GOOGLE_URL_BYTE_LIMIT = 6_000;
const GOOGLE_431_RETRY_BYTE_LIMIT = 3_000;
const GOOGLE_COOLDOWN_MS = 60_000;
const GOOGLE_RATE_LIMIT_ERROR = "Google 번역 HTTP 429";

const escapeDisplayText = (value: string): string => value
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export function displayText(canonical: string, translated: string | undefined, display: TranslationDisplay): string {
  if (display === "en") return escapeDisplayText(canonical);
  if (translated !== undefined && translated !== "") return escapeDisplayText(translated);
  return `${escapeDisplayText(canonical)}<span class="orig-mark">원문</span>`;
}

export interface TranslationSource {
  serverInstanceId: string;
  chatId: string;
  kind: string;
  itemId: string;
  text: string;
  sourceLanguage: MemoryLanguage;
}
export interface TranslationResult extends TranslationSource { translated: string; cached: boolean; error?: string }
interface Prepared { source: TranslationSource; sourceHash: string; key: string }

let googleSlots = 0;
let googleCooldownUntil = 0;
const googleWaiters: Array<() => void> = [];
let risuBusy = false;
const risuWaiters: Array<() => void> = [];
let aggregatePending = 0;

export function googleTranslationCooldownMs(): number {
  return Math.max(0, googleCooldownUntil - Date.now());
}

const clientFor = (state: RuntimeState): ServerClient => new ServerClient(() => state.settings);
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
const cacheKey = (source: TranslationSource, hash: string): string =>
  [source.serverInstanceId, source.chatId, source.kind, source.itemId, hash, source.sourceLanguage, "ko"].join("\u001f");

async function prepare(records: TranslationSource[]): Promise<Prepared[]> {
  return Promise.all(records.map(async (source) => {
    const sourceHash = await sha256(source.text);
    return { source, sourceHash, key: cacheKey(source, sourceHash) };
  }));
}

async function withGoogleSlot<T>(task: () => Promise<T>): Promise<T> {
  if (googleTranslationCooldownMs()) throw new Error(GOOGLE_RATE_LIMIT_ERROR);
  if (googleSlots >= 2) await new Promise<void>((resolve) => googleWaiters.push(resolve));
  googleSlots += 1;
  try { return await task(); } finally { googleSlots -= 1; googleWaiters.shift()?.(); }
}
async function withRisuSlot<T>(task: () => Promise<T>): Promise<T> {
  if (risuBusy) await new Promise<void>((resolve) => risuWaiters.push(resolve));
  risuBusy = true;
  try { return await task(); } finally { risuBusy = false; risuWaiters.shift()?.(); }
}
function googleText(payload: unknown): string {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) throw new Error("Google 번역 응답 형식을 읽지 못했습니다.");
  return payload[0].map((segment) => Array.isArray(segment) && typeof segment[0] === "string" ? segment[0] : "").join("");
}
function googleTranslationUrl(text: string, sourceLanguage: MemoryLanguage): string {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx"); url.searchParams.set("sl", sourceLanguage); url.searchParams.set("tl", "ko"); url.searchParams.set("dt", "t"); url.searchParams.set("q", text);
  return url.toString();
}
const encodedBytes = (value: string): number => new TextEncoder().encode(value).byteLength;

export function splitGoogleTranslationText(text: string, sourceLanguage: MemoryLanguage, maxUrlBytes = GOOGLE_URL_BYTE_LIMIT): string[] {
  if (!text) return [];
  const points = Array.from(text);
  const chunks: string[] = [];
  let offset = 0;
  while (offset < points.length) {
    let low = 1;
    let high = points.length - offset;
    let fit = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = points.slice(offset, offset + middle).join("");
      if (encodedBytes(googleTranslationUrl(candidate, sourceLanguage)) <= maxUrlBytes) { fit = middle; low = middle + 1; }
      else high = middle - 1;
    }
    if (!fit) throw new Error("Google 번역 요청 한도를 맞출 수 없습니다.");
    let end = offset + fit;
    if (end < points.length) {
      const minimumNaturalBreak = offset + Math.floor(fit * 0.7);
      for (let index = end - 1; index >= minimumNaturalBreak; index -= 1) {
        if (/\s/u.test(points[index]!)) { end = index + 1; break; }
      }
    }
    chunks.push(points.slice(offset, end).join(""));
    offset = end;
  }
  return chunks;
}

async function requestGoogleTranslation(chunk: string, sourceLanguage: MemoryLanguage, retry431 = true): Promise<string> {
  // Check after acquiring a slot, including queued requests and smaller 431 parts.
  if (googleTranslationCooldownMs()) throw new Error(GOOGLE_RATE_LIMIT_ERROR);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await risuai.nativeFetch(googleTranslationUrl(chunk, sourceLanguage), { method: "GET", signal: controller.signal });
    if (response.status === 429) {
      const retryAfterSeconds = Number(response.headers.get("Retry-After"));
      const cooldownMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 && retryAfterSeconds <= 3_600
        ? retryAfterSeconds * 1_000 : GOOGLE_COOLDOWN_MS;
      googleCooldownUntil = Math.max(googleCooldownUntil, Date.now() + cooldownMs);
      throw new Error(GOOGLE_RATE_LIMIT_ERROR);
    }
    if (response.status === 431 && retry431) {
      const smaller = splitGoogleTranslationText(chunk, sourceLanguage, GOOGLE_431_RETRY_BYTE_LIMIT);
      if (smaller.length > 1) {
        const translated: string[] = [];
        for (const part of smaller) translated.push(await requestGoogleTranslation(part, sourceLanguage, false));
        return translated.join("");
      }
    }
    if (!response.ok) throw new Error(`Google 번역 HTTP ${response.status}`);
    return googleText(await response.json());
  } finally { clearTimeout(timer); }
}

async function translateGoogle(text: string, sourceLanguage: MemoryLanguage, isCurrent: () => boolean): Promise<string> {
  const chunks = splitGoogleTranslationText(text, sourceLanguage);
  const translated: string[] = [];
  for (const chunk of chunks) {
    if (!isCurrent()) throw new Error("Translation cancelled");
    translated.push(await withGoogleSlot(() => {
      if (!isCurrent()) throw new Error("Translation cancelled");
      return requestGoogleTranslation(chunk, sourceLanguage);
    }));
  }
  return translated.join("");
}
export const translationOutputBudget = (state: RuntimeState) => state.settings.translationProvider === "server" ? state.settings.translationServerMaxOutput : state.settings.translationMaxOutput;
export const backgroundTranslationEnabled = (state: RuntimeState) => state.settings.translationProvider === "google" || state.settings.translationBackground;
export async function callTranslationBatch(state: RuntimeState, items: import("@rcm/shared").TranslationPart[], provider = state.settings.translationProvider, background = false) {
  const stats = state.translationStats ??= { calls: 0, items: 0 };
  stats.calls += 1;
  state.translationBackgroundRunning = background;
  state.publishActivity?.(); state.refreshStatusWidget?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = async () => {
      if (provider === "server") return clientFor(state).request<{ items: Array<{ id: string; partIndex: number; ko: string }>; usage?: any; model: string }>("/v1/translations/batch", {
        method: "POST", body: JSON.stringify({ items, model: state.settings.translationServerModel, temperature: state.settings.translationTemperature, thinking: state.settings.translationThinking, maxOutput: state.settings.translationServerMaxOutput }),
      }, TRANSLATION_TIMEOUT_MS + 5000);
      const response = await risuai.runLLMModel({ messages: [{ role: "system", content: translationSystemPrompt }, { role: "user", content: JSON.stringify({ items }) }], ...risuModelSlot(state.settings.translationSlot, state.settings.translationModel) });
      if (response?.type !== "success" || typeof response.result !== "string") throw new TranslationError("MODEL_CONNECTION_FAILED", String(response?.result || "Risu 번역 모델 호출 실패"));
      return { items: validateTranslation(response.result, items, response.finish_reason ?? response.finishReason), usage: response.usage ?? response.usageMetadata, model: state.settings.translationSlot === "static" ? state.settings.translationModel : state.settings.translationSlot };
    };
    const result = await Promise.race([call(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TranslationError("TIMEOUT", "참고 번역 호출이 120초를 넘었습니다.")), TRANSLATION_TIMEOUT_MS); })]);
    const usage = result.usage;
    const input = usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokenCount;
    const output = usage?.completion_tokens ?? usage?.output_tokens ?? usage?.candidatesTokenCount;
    const total = usage?.total_tokens ?? usage?.totalTokenCount ?? (typeof input === "number" && typeof output === "number" ? input + output : undefined);
    if (typeof total === "number" && Number.isFinite(total)) stats.tokens = (stats.tokens ?? 0) + total;
    return result;
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "MODEL_CONNECTION_FAILED";
    const detail = sanitizeDiagnosticText(error instanceof Error ? error.message : String(error), [state.settings.serverToken]);
    stats.lastError = `${code}: ${detail}`;
    addLog(state.logs, "warn", `Reference translation failed: ${stats.lastError}`);
    throw new TranslationError(code, detail);
  } finally {
    if (timer) clearTimeout(timer);
    state.translationBackgroundRunning = false;
    state.publishActivity?.(); state.refreshStatusWidget?.();
  }
}
async function translateRisuBatch(state: RuntimeState, records: Pick<TranslationSource, "text">[], provider: TranslationProvider, isCurrent: () => boolean, background: boolean, completed: (index: number, text: string, model: string) => Promise<void>): Promise<{ translated: Map<string, string>; model: string }> {
  return withRisuSlot(async () => {
    if (!isCurrent()) throw new TranslationError("ABORTED_OR_TIMEOUT", "Translation cancelled");
    if(provider === "server") {
      const {config}=await clientFor(state).request<{config:import("@rcm/shared").TranslationConnectionPublicConfig}>("/v1/admin/translation/initialize", {
        method:"POST",body:JSON.stringify({model:state.settings.translationServerModel,temperature:state.settings.translationTemperature,thinking:state.settings.translationThinking,maxOutput:state.settings.translationServerMaxOutput}),
      });
      state.settings.translationServerMaxOutput=config.maxOutputTokens;
    }
    const batches = planTranslation(records.map((record, index) => ({ id: String(index), text: prepareAuxiliaryText(record.text) })), provider === "server" ? state.settings.translationServerMaxOutput : state.settings.translationMaxOutput);
    const translated = new Map<string, string>(); let model = "";
    for (const items of batches) {
      if (!isCurrent()) throw new TranslationError("ABORTED_OR_TIMEOUT", "Translation cancelled");
      const response = await callTranslationBatch(state, items, provider, background);
      model = response.model;
      for (const item of response.items) {
        translated.set(item.id, (translated.get(item.id) ?? "") + item.ko);
        const expected = items.find(part => part.id === item.id && part.partIndex === item.partIndex)!;
        if (item.partIndex === expected.partCount - 1) await completed(Number(item.id), translated.get(item.id)!, model);
      }
    }
    return { translated, model };
  });
}
// Parse the packet's markup grammar only; never infer prose semantics. Quoted > stays in its tag.
const packetTag = () => /<!--[\s\S]*?-->|<\/?[A-Za-z_][\w:.-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/g;

/** Explicit, ephemeral translation: deliberately bypasses every cache and prefetch path. */
export async function translatePacket(state: RuntimeState, packet: string, sourceLanguage: MemoryLanguage, isCurrent: () => boolean = () => true): Promise<string> {
  const provider = state.settings.translationProvider;
  try {
    if (provider === "google") return await translateGoogle(packet, sourceLanguage, isCurrent);
    const tags = [...packet.matchAll(packetTag())];
    const pieces: string[] = []; const records: Array<{ text: string }> = []; const positions: number[] = [];
    let offset = 0;
    const text = (value: string) => {
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value)!;
      pieces.push(match[1]!);
      if (match[2]) { positions.push(pieces.length); records.push({ text: match[2] }); pieces.push(""); }
      pieces.push(match[3]!);
    };
    for (const tag of tags) { text(packet.slice(offset, tag.index)); pieces.push(tag[0]); offset = tag.index! + tag[0].length; }
    text(packet.slice(offset));
    if (!records.length) return packet;
    const result = await translateRisuBatch(state, records, provider, isCurrent, false, async () => {});
    positions.forEach((position, index) => {
      const value = result.translated.get(String(index));
      if (!value?.trim()) throw new TranslationError("MISSING_ITEMS", "번역 항목 누락");
      pieces[position] = value;
    });
    const translated = pieces.join("");
    if (JSON.stringify(translated.match(packetTag()) ?? []) !== JSON.stringify(tags.map(tag => tag[0]))) {
      throw new TranslationError("TAG_SEQUENCE_CHANGED", "태그 변경");
    }
    if (state.translationStats) state.translationStats.items += records.length;
    return translated;
  } catch (error) {
    const code = (error as { code?: string })?.code ?? (provider === "google" ? "GOOGLE_TRANSLATION_FAILED" : "MODEL_CONNECTION_FAILED");
    const detail = sanitizeDiagnosticText(error instanceof Error ? error.message : String(error), [state.settings.serverToken]);
    addLog(state.logs, "warn", `Packet translation failed: ${code}: ${detail}`);
    throw new TranslationError(code, detail);
  }
}

function changeActivity(state: RuntimeState, delta: number, error?: string): void {
  aggregatePending = Math.max(0, aggregatePending + delta);
  state.translationActivity = { pending: aggregatePending, ...(error ? { error } : {}) };
  state.publishActivity?.(); state.refreshStatusWidget?.();
}

async function translateRecordsUnlocked(state: RuntimeState, records: TranslationSource[], provider = state.settings.translationProvider, isCurrent: () => boolean = () => true, background = false, replaceGoogle = false): Promise<TranslationResult[]> {
  if (!records.length) return [];
  if (records.every((record) => record.sourceLanguage === "ko")) return records.map((source) => ({ ...source, translated: source.text, cached: true }));
  let pendingStarted = 0;
  try {
    const prepared = await prepare(records);
    const cachedRows: Array<{ key: string; translated: string; provider?: string }> = [];
    for (let offset = 0; offset < prepared.length; offset += 500) {
      const result = await clientFor(state).request<{ items: typeof cachedRows }>("/v1/translations/cache/lookup", {
        method: "POST", body: JSON.stringify({ keys: prepared.slice(offset, offset + 500).map(item => item.key) }),
      }, 8_000);
      cachedRows.push(...result.items);
    }
    const cached = new Map(cachedRows.filter(row => !replaceGoogle || row.provider !== "google").map((row) => [row.key, row.translated]));
    const results = new Map<string, TranslationResult>();
    for (const item of prepared) if (cached.has(item.key)) results.set(item.key, { ...item.source, translated: cached.get(item.key)!, cached: true });
    const missing = [...new Map(prepared.filter(item => !cached.has(item.key)).map(item => [item.key, item])).values()];
    if (!missing.length) return prepared.map((item) => results.get(item.key)!);
    if (!isCurrent()) return prepared.map(item => results.get(item.key)).filter((item): item is TranslationResult => Boolean(item));
    pendingStarted = missing.length; changeActivity(state, pendingStarted);
    const fresh = new Map<string, string>();
    let batchError: string | undefined;
    let model = "";
    const fail = (item: Prepared, error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      batchError ??= message;
      results.set(item.key, { ...item.source, translated: item.source.text, cached: false, error: message });
    };
    if (provider === "google") {
      const settled = await Promise.allSettled(missing.map((item) => translateGoogle(item.source.text, item.source.sourceLanguage, isCurrent)));
      settled.forEach((result, index) => {
        const item = missing[index]!;
        if (result.status === "fulfilled") fresh.set(item.key, result.value);
        else fail(item, result.reason);
      });
    } else {
      try {
        const response = await translateRisuBatch(state, missing.map((item) => item.source), provider, isCurrent, background, async (index, text, model) => {
          const item = missing[index]!;
          // Persist each completed source before another paid call. A later failure must not erase this work.
          await clientFor(state).request("/v1/translations/cache/upsert", { method: "POST", body: JSON.stringify({ items: [{ key: item.key, ...item.source, sourceHash: item.sourceHash, provider, model, targetLanguage: "ko", translated: text }] }) }, 8000);
          fresh.set(item.key, text);
        });
        const translated = response.translated; model = response.model;
        for (const [index, item] of missing.entries()) {
          const value = translated.get(String(index));
          if (!value) throw new Error(`번역 결과에서 ${item.source.itemId} 항목이 빠졌습니다.`);
          fresh.set(item.key, value);
        }
      } catch (error) {
        missing.filter(item => !fresh.has(item.key)).forEach((item) => fail(item, error));
      }
    }
    const cacheItems = missing.flatMap((item) => {
      const translated = fresh.get(item.key);
      if (!translated) return [];
      results.set(item.key, { ...item.source, translated, cached: false });
      return [{ key: item.key, serverInstanceId: item.source.serverInstanceId, chatId: item.source.chatId, kind: item.source.kind, itemId: item.source.itemId,
        sourceHash: item.sourceHash, provider, model, sourceLanguage: item.source.sourceLanguage, targetLanguage: "ko", translated }];
    });
    if (provider === "google" && isCurrent()) for (let offset = 0; offset < cacheItems.length; offset += 500) {
      await clientFor(state).request("/v1/translations/cache/upsert", { method: "POST", body: JSON.stringify({ items: cacheItems.slice(offset, offset + 500) }) }, 8_000);
    }
    if (provider !== "google" && state.translationStats) state.translationStats.items += cacheItems.length;
    changeActivity(state, -pendingStarted, batchError); pendingStarted = 0;
    if (batchError) addLog(state.logs, "warn", `Reference translation failed: ${sanitizeDiagnosticText(batchError ?? "cache request failed", [state.settings.serverToken])}`);
    return prepared.map((item) => results.get(item.key) ?? { ...item.source, translated: item.source.text, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    changeActivity(state, pendingStarted ? -pendingStarted : 0, message);
    addLog(state.logs, "warn", `Reference translation failed: ${sanitizeDiagnosticText(message, [state.settings.serverToken])}`);
    return records.map((source) => ({ ...source, translated: source.text, cached: false, error: message }));
  }
}

let translationBusy = false;
const screenTranslationWaiters: Array<() => void> = [];
function releaseTranslation(): void {
  const next = screenTranslationWaiters.shift();
  if (next) next();
  else translationBusy = false;
}

/** Screen requests take the next slot before background batches. */
export async function translateRecords(state: RuntimeState, records: TranslationSource[], provider = state.settings.translationProvider): Promise<TranslationResult[]> {
  if (translationBusy) await new Promise<void>(resolve => screenTranslationWaiters.push(resolve));
  else translationBusy = true;
  try { return await translateRecordsUnlocked(state, records, provider); }
  finally { releaseTranslation(); }
}

/** Google keeps its bounded prefetch; LLM modes pack all pending sources by output budget. */
export async function prefetchTranslationRecords(state: RuntimeState, records: TranslationSource[], isCurrent: () => boolean): Promise<TranslationSource[]> {
  const provider = state.settings.translationProvider;
  if (!backgroundTranslationEnabled(state)) return [];
  if (provider !== "google") {
    if (translationBusy) return records;
    translationBusy = true;
    try {
      const result = await translateRecordsUnlocked(state, records, provider, () => isCurrent() && backgroundTranslationEnabled(state) && state.settings.translationProvider === provider, true);
      return result.some(item => item.error) ? records : [];
    } finally { releaseTranslation(); }
  }
  const current = () => isCurrent() && state.settings.autoTranslate && state.settings.translationDisplay === "ko"
    && state.settings.translationProvider === provider;
  let translated = 0;
  for (let offset = 0; offset < records.length && translated < 24; offset += 128) {
    if (!current()) return [];
    if (translationBusy || provider === "google" && googleTranslationCooldownMs()) return records.slice(offset);
    const candidates = records.slice(offset, offset + 128).filter(record => record.sourceLanguage !== "ko");
    const cached = await readCachedTranslations(state, candidates, provider);
    const cachedKeys = new Set(cached.map(record => JSON.stringify([record.kind, record.itemId, record.text])));
    const missing = candidates.filter(record => !cachedKeys.has(JSON.stringify([record.kind, record.itemId, record.text])));
    for (let index = 0; index < missing.length && translated < 24; index += 2) {
      if (!current()) return [];
      if (translationBusy || provider === "google" && googleTranslationCooldownMs()) return [...missing.slice(index), ...records.slice(offset + 128)];
      translationBusy = true;
      try {
        const batch = missing.slice(index, index + Math.min(2, 24 - translated));
        const results = await translateRecordsUnlocked(state, batch, provider, current);
        translated += batch.length;
        if (results.some(record => record.error)) return [...missing.slice(index), ...records.slice(offset + 128)];
        if (translated >= 24) return [...missing.slice(index + batch.length), ...records.slice(offset + 128)];
      } finally { releaseTranslation(); }
    }
  }
  return [];
}

export interface TranslationCacheStats { items: number; bytes: number; maxItems: number; maxBytes: number }
export async function translationCacheStats(state: RuntimeState): Promise<TranslationCacheStats> {
  return clientFor(state).request<TranslationCacheStats>("/v1/translations/cache/stats");
}
export async function translationCacheCount(state: RuntimeState): Promise<number> {
  return (await translationCacheStats(state)).items;
}
export async function readCachedTranslations(state: RuntimeState, records: TranslationSource[], provider: TranslationProvider): Promise<TranslationResult[]> {
  const prepared = await prepare(records);
  const cached = new Map<string, string>();
  for (let offset = 0; offset < prepared.length; offset += 500) {
    const response = await clientFor(state).request<{ items: Array<{ key: string; translated: string }> }>("/v1/translations/cache/lookup", { method: "POST", body: JSON.stringify({ keys: prepared.slice(offset, offset + 500).map(item => item.key) }) });
    for (const row of response.items) cached.set(row.key, row.translated);
  }
  return prepared.flatMap((item) => cached.has(item.key) ? [{ ...item.source, translated: cached.get(item.key)!, cached: true }] : []);
}
export async function clearTranslationCache(state: RuntimeState): Promise<void> {
  await clientFor(state).request("/v1/translations/cache", { method: "DELETE" });
}
export async function invalidateTranslationCache(state: RuntimeState, match: Partial<Pick<TranslationSource, "serverInstanceId" | "chatId" | "kind" | "itemId">> & { itemIdPrefix?: string }): Promise<void> {
  await clientFor(state).request("/v1/translations/cache/invalidate", { method: "POST", body: JSON.stringify(match) });
}

/** Explicitly approved replacement uses the same visible background call path, even when automatic prefetch is off. */
export async function retranslateGoogleRecords(state: RuntimeState, records: TranslationSource[]): Promise<void> {
  const provider = state.settings.translationProvider;
  if (provider === "google") return;
  if (translationBusy) await new Promise<void>(resolve => screenTranslationWaiters.push(resolve)); else translationBusy = true;
  try { await translateRecordsUnlocked(state, records, provider, () => state.settings.translationProvider === provider, true, true); }
  finally { releaseTranslation(); }
}
export async function googleTranslationRecords(state: RuntimeState, records: TranslationSource[]): Promise<TranslationSource[]> {
  const prepared = await prepare(records);
  const keys = new Set<string>();
  for (let offset = 0; offset < prepared.length; offset += 500) {
    const response = await clientFor(state).request<{ items: Array<{ key: string; provider: string }> }>("/v1/translations/cache/lookup", { method: "POST", body: JSON.stringify({ keys: prepared.slice(offset, offset + 500).map(item => item.key) }) });
    for (const row of response.items) if (row.provider === "google") keys.add(row.key);
  }
  return prepared.filter(item => keys.has(item.key)).map(item => item.source);
}
