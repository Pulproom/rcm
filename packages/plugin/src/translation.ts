import { prepareAuxiliaryText } from "@rcm/shared";
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
const cacheKey = (source: TranslationSource, hash: string, provider: TranslationProvider): string =>
  [source.serverInstanceId, source.chatId, source.kind, source.itemId, hash, provider, source.sourceLanguage, "ko"].join("\u001f");

async function prepare(records: TranslationSource[], provider: TranslationProvider): Promise<Prepared[]> {
  return Promise.all(records.map(async (source) => {
    const sourceHash = await sha256(source.text);
    return { source, sourceHash, key: cacheKey(source, sourceHash, provider) };
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
function extractJson(value: string): unknown {
  const clean = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = clean.indexOf("{"); const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("번역 모델이 JSON을 반환하지 않았습니다.");
  return JSON.parse(clean.slice(start, end + 1));
}
async function translateRisuBatch(state: RuntimeState, records: TranslationSource[], isCurrent: () => boolean): Promise<Map<string, string>> {
  return withRisuSlot(async () => {
    const systemPrompt = prepareAuxiliaryText('Translate each text to natural Korean. Preserve proper names, numbers, directions, quotations, and meaning. Return strict JSON only as {"items":[{"id":string,"partIndex":number,"ko":string}]}. Return every supplied part separately with its exact id and partIndex. Source languages: ' + JSON.stringify(Object.fromEntries(records.map(record => [record.itemId, record.sourceLanguage]))));
    const plan = await clientFor(state).request<{ parts: Array<{ systemPrompt: string; userPrompt: string; items: Array<{ id: string; partIndex: number; partCount: number }> }> }>("/v1/admin/auxiliary/translation-plan", {
      method: "POST", body: JSON.stringify({ systemPrompt, items: records.map(record => ({ id: record.itemId, text: prepareAuxiliaryText(record.text) })) }),
    });
    const translated = new Map<string, Map<number, string>>();
    const totals = new Map<string, number>();
    for (const part of plan.parts) {
      if (!isCurrent()) throw new Error("Translation cancelled");
      const response = await risuai.runLLMModel({ messages: [{ role: "system", content: part.systemPrompt }, { role: "user", content: part.userPrompt }], mode: "translate", allowPlugins: true });
      if (response?.type !== "success" || typeof response.result !== "string") throw new Error(response?.result || "Risu 번역 모델 호출에 실패했습니다.");
      const reason = response?.finish_reason ?? response?.finishReason;
      if (["LENGTH", "MAX_TOKENS", "MAX_OUTPUT_TOKENS"].includes(String(reason ?? "").toUpperCase())) throw new Error("번역 응답이 잘려 저장하지 않았습니다.");
      const parsed = extractJson(response.result) as { items?: Array<{ id?: unknown; partIndex?: unknown; ko?: unknown }> };
      for (const expected of part.items) {
        const matches = (parsed.items ?? []).filter(item => item.id === expected.id && (item.partIndex === expected.partIndex || (expected.partCount === 1 && item.partIndex === undefined)));
        if (matches.length !== 1 || typeof matches[0]!.ko !== "string") throw new Error("번역 응답에 누락되거나 중복된 구간이 있습니다.");
        const pieces = translated.get(expected.id) ?? new Map<number, string>();
        if (pieces.has(expected.partIndex)) throw new Error("번역 구간이 중복되었습니다.");
        pieces.set(expected.partIndex, matches[0]!.ko); translated.set(expected.id, pieces); totals.set(expected.id, expected.partCount);
      }
    }
    return new Map(records.map(record => {
      const pieces = translated.get(record.itemId);
      if (!pieces || pieces.size !== totals.get(record.itemId)) throw new Error("번역이 끝나지 않은 원문이 있습니다.");
      return [record.itemId, [...pieces].sort(([left], [right]) => left - right).map(([, text]) => text).join("")];
    }));
  });
}
function changeActivity(state: RuntimeState, delta: number, error?: string): void {
  aggregatePending = Math.max(0, aggregatePending + delta);
  state.translationActivity = { pending: aggregatePending, ...(error ? { error } : {}) };
  state.publishActivity?.(); state.refreshStatusWidget?.();
}

async function translateRecordsUnlocked(state: RuntimeState, records: TranslationSource[], provider = state.settings.translationProvider, isCurrent: () => boolean = () => true): Promise<TranslationResult[]> {
  if (!records.length) return [];
  if (records.every((record) => record.sourceLanguage === "ko")) return records.map((source) => ({ ...source, translated: source.text, cached: true }));
  let pendingStarted = 0;
  try {
    const prepared = await prepare(records, provider);
    const cachedRows = await clientFor(state).request<{ items: Array<{ key: string; translated: string }> }>("/v1/translations/cache/lookup", {
      method: "POST", body: JSON.stringify({ keys: prepared.map((item) => item.key) }),
    }, 8_000).then((result) => result.items).catch(() => []);
    const cached = new Map(cachedRows.map((row) => [row.key, row.translated]));
    const results = new Map<string, TranslationResult>();
    for (const item of prepared) if (cached.has(item.key)) results.set(item.key, { ...item.source, translated: cached.get(item.key)!, cached: true });
    const missing = prepared.filter((item) => !cached.has(item.key));
    if (!missing.length) return prepared.map((item) => results.get(item.key)!);
    if (!isCurrent()) return prepared.map(item => results.get(item.key)).filter((item): item is TranslationResult => Boolean(item));
    pendingStarted = missing.length; changeActivity(state, pendingStarted);
    const fresh = new Map<string, string>();
    let batchError: string | undefined;
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
        const translated = await translateRisuBatch(state, missing.map((item) => item.source), isCurrent);
        for (const item of missing) {
          const value = translated.get(item.source.itemId);
          if (!value) throw new Error(`번역 결과에서 ${item.source.itemId} 항목이 빠졌습니다.`);
          fresh.set(item.key, value);
        }
      } catch (error) {
        fresh.clear();
        missing.forEach((item) => fail(item, error));
      }
    }
    const cacheItems = missing.flatMap((item) => {
      const translated = fresh.get(item.key);
      if (!translated) return [];
      results.set(item.key, { ...item.source, translated, cached: false });
      return [{ key: item.key, serverInstanceId: item.source.serverInstanceId, chatId: item.source.chatId, kind: item.source.kind, itemId: item.source.itemId,
        sourceHash: item.sourceHash, provider, sourceLanguage: item.source.sourceLanguage, targetLanguage: "ko", translated }];
    });
    if (cacheItems.length && isCurrent()) await clientFor(state).request("/v1/translations/cache/upsert", { method: "POST", body: JSON.stringify({ items: cacheItems }) }, 8_000).catch(() => undefined);
    changeActivity(state, -pendingStarted, batchError); pendingStarted = 0;
    if (batchError) addLog(state.logs, "warn", `Reference translation failed: ${batchError}`);
    return prepared.map((item) => results.get(item.key) ?? { ...item.source, translated: item.source.text, cached: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    changeActivity(state, pendingStarted ? -pendingStarted : 0, message);
    addLog(state.logs, "warn", `Reference translation failed: ${message}`);
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

/** At most 24 uncached records, two per batch; yield the provider to any reader. */
export async function prefetchTranslationRecords(state: RuntimeState, records: TranslationSource[], isCurrent: () => boolean): Promise<TranslationSource[]> {
  const provider = state.settings.translationProvider;
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
  const prepared = await prepare(records, provider);
  const response = await clientFor(state).request<{ items: Array<{ key: string; translated: string }> }>("/v1/translations/cache/lookup", { method: "POST", body: JSON.stringify({ keys: prepared.map((item) => item.key) }) });
  const cached = new Map(response.items.map((item) => [item.key, item.translated]));
  return prepared.flatMap((item) => cached.has(item.key) ? [{ ...item.source, translated: cached.get(item.key)!, cached: true }] : []);
}
export async function clearTranslationCache(state: RuntimeState): Promise<void> {
  await clientFor(state).request("/v1/translations/cache", { method: "DELETE" });
}
export async function invalidateTranslationCache(state: RuntimeState, match: Partial<Pick<TranslationSource, "serverInstanceId" | "chatId" | "kind" | "itemId">> & { itemIdPrefix?: string }): Promise<void> {
  await clientFor(state).request("/v1/translations/cache/invalidate", { method: "POST", body: JSON.stringify(match) });
}
