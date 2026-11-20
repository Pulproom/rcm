import { SETTINGS_FAILURE_GUIDANCE, settingsFailureCode, settingsFailureMessage, auxiliaryUsageMetadata } from "@rcm/shared";
import { risuModelSlot, runRisuModel } from "./worker.js";
import { withAuxiliaryStoryFraming, planTranslation, translationSystemPrompt, validateTranslation, translationTimeoutMs, TranslationError, sanitizeDiagnosticText, prepareAuxiliaryText } from "@rcm/shared";
import type { RuntimeState, TranslationDisplay, TranslationProvider } from "./types.js";
import type { MemoryLanguage } from "@rcm/shared";
import { ServerClient } from "./api-client.js";
import { addLog, isChatMemoryEnabled } from "./settings.js";
import { retryAfterMs } from "./server-errors.js";
import { translationParts, splitTranslationBatch, untranslatedParts, TRANSLATION_CONTEXT_LIMITS, type TranslationBatch, type TranslationRequest } from "@rcm/shared";
import { readCurrentChatReaderTranslations } from "./context.js";

const chatTranslationGeneration = new Map<string, number>();
export function invalidateChatTranslations(chatId: string): void {
  chatTranslationGeneration.set(chatId, (chatTranslationGeneration.get(chatId) ?? 0) + 1);
}
async function translationCurrent(state: RuntimeState, chatIds: string[], current: () => boolean) {
  const generations = chatIds.map(id => chatTranslationGeneration.get(id));
  const characters = new Map<string, string>();
  if (state.current) characters.set(state.current.chatId, state.current.characterId);
  if (chatIds.some(id => !characters.get(id))) {
    try {
      await Promise.all(chatIds.filter(id => !characters.has(id)).map(async id => {
        const status = await clientFor(state).request<{chat:{characterId:string}|null}>(`/v1/chats/${encodeURIComponent(id)}/status`);
        if (!status.chat) throw new Error('Chat not found');
        characters.set(id,status.chat.characterId);
      }));
    } catch {
      addLog(state.logs, "warn", "번역할 채팅의 캐릭터를 확인하지 못했어요.", "TRANSLATION_CONTEXT_MISSING");
      return () => false;
    }
  }
  return () => current() && chatIds.every((id, index) => isChatMemoryEnabled(state.settings, id, characters.get(id)) && chatTranslationGeneration.get(id) === generations[index]);
}

const GOOGLE_URL_BYTE_LIMIT = 6_000;
const GOOGLE_431_RETRY_BYTE_LIMIT = 3_000;
const TRANSLATION_COOLDOWN_MS = 60_000;

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
  /** Local provenance only; cache identity and rows never include scene metadata. */
  scene?: { memoryId: string; participants: string[]; relationships: string[]; storyOrder?: number };
  dialogue?: { speaker: string; messageId?: string };
}
export type TranslationRecord = Pick<TranslationSource, "kind" | "itemId" | "text" | "scene" | "dialogue">;

/** Stored names, participant sets and source order only; no inference from dialogue text. */
export function withSceneTranslationContext(records: TranslationRecord[], data: { memories?: any[]; relationships?: any[] }): TranslationRecord[] {
  const byRecord = new Map<string, { scene: NonNullable<TranslationSource["scene"]>; dialogue?: TranslationSource["dialogue"] }>();
  const from = (row: any) => String(row.from ?? row.from_entity ?? "");
  const to = (row: any) => String(row.to ?? row.to_entity ?? "");
  for (const memory of data.memories ?? []) {
    const participants = [...new Set<string>((memory.participants ?? []).map(String))].map(name => name.slice(0, TRANSLATION_CONTEXT_LIMITS.speaker)).slice(0, 100);
    const speakers = [...new Set<string>((memory.keyDialogues ?? []).map((line: any) => String(line.speaker ?? "")))];
    const relationships = [...new Set(speakers.flatMap(speaker => participants.filter(name => name !== speaker).flatMap(other => {
      const pair = (data.relationships ?? []).filter(row => row.summaryReady !== false && String(row.summary ?? "").trim()
        && (from(row) === speaker && to(row) === other || from(row) === other && to(row) === speaker));
      const row = pair.find(row => from(row) === speaker) ?? pair[0];
      return row ? [`${from(row)} → ${to(row)}: ${row.summary}`.slice(0, TRANSLATION_CONTEXT_LIMITS.relationship)] : [];
    }).slice(0, 3)))];
    const scene = { memoryId: String(memory.id), participants, relationships, storyOrder: memory.source_ordinal == null ? undefined : Number(memory.source_ordinal) };
    for (const field of ["title", "content"]) byRecord.set(`${memory.id}:${field}`, { scene });
    for (const detail of memory.details ?? []) byRecord.set(`${memory.id}:detail:${detail.id}`, { scene });
    // These IDs are the reader builders' owned record grammar, not prose matching.
    for (const record of records) if (record.kind === "evidence" && record.itemId.startsWith(`${memory.id}:evidence:`)) byRecord.set(record.itemId, { scene });
    (memory.keyDialogues ?? []).forEach((line: any, index: number) => byRecord.set(`${memory.id}:dialogue:${index}`, {
      scene, dialogue: { speaker: String(line.speaker ?? "").slice(0, TRANSLATION_CONTEXT_LIMITS.speaker), ...(line.messageId ? { messageId: String(line.messageId) } : {}) },
    }));
  }
  return records.map(record => byRecord.has(record.itemId) ? { ...record, ...byRecord.get(record.itemId)! } : record);
}

/** A position ratio in the source, never cross-language semantic matching. */
function readerWindow(source: string, translation: string, quotes: string[]): string | undefined {
  if (!source || !translation) return undefined;
  const positions = quotes.map(quote => {
    const exact = source.indexOf(quote);
    const start = exact >= 0 ? exact : source.indexOf(quote.slice(0, 40));
    return start >= 0 ? (start + quote.length / 2) / source.length : .5;
  });
  const low = Math.min(...positions) * translation.length;
  const high = Math.max(...positions) * translation.length;
  let start = Math.max(0, Math.floor(low - 350));
  let end = Math.min(translation.length, Math.ceil(high + 350));
  const snap = (position: number) => {
    const before = translation.lastIndexOf("\n", position), after = translation.indexOf("\n", position);
    const closest = before >= 0 && (after < 0 || position - before <= after - position) ? before + 1 : after;
    return closest >= 0 && Math.abs(closest - position) <= 100 ? closest : position;
  };
  if (start) start = snap(start);
  if (end < translation.length) end = snap(end);
  const text = translation.slice(start, end).trim();
  return text ? `${start ? "…" : ""}${text}${end < translation.length ? "…" : ""}` : undefined;
}
export interface TranslationResult extends TranslationSource { translated: string; cached: boolean; error?: string }
interface Prepared { source: TranslationSource; sourceHash: string; key: string }

let googleSlots = 0;
let cooldownUntil = 0;
const failureBursts = new WeakMap<RuntimeState, number>();
const googleWaiters: Array<() => void> = [];
let risuBusy = false;
const risuWaiters: Array<() => void> = [];
let aggregatePending = 0;

export function translationCooldownMs(): number {
  return Math.max(0, cooldownUntil - Date.now());
}
function checkCooldown(): void {
  if (translationCooldownMs()) throw new TranslationError("RATE_LIMITED", "");
  cooldownUntil = 0;
}
function translationFailure(state: RuntimeState, error: unknown, label = "Reference translation failed"): string {
  // A chat switch or reset cancels queued work; that is not a provider failure.
  if ((error as { code?: string })?.code === "CANCELLED") return (error as Error).message;
  if (settingsFailureCode(error) === "RATE_LIMITED") {
    // A locally blocked request must not extend the provider's cooldown.
    if (!translationCooldownMs()) cooldownUntil = Date.now() + ((error as { retryAfterMs?: number })?.retryAfterMs ?? TRANSLATION_COOLDOWN_MS);
  }
  const message = settingsFailureMessage(error, "translation");
  if ((failureBursts.get(state) ?? 0) <= Date.now()) {
    addLog(state.logs, "warn", `${label}: ${sanitizeDiagnosticText(message, [state.settings.serverToken])}`, "TRANSLATION_WARNING");
  }
  failureBursts.set(state, Math.max(cooldownUntil, Date.now() + TRANSLATION_COOLDOWN_MS));
  return message;
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
  checkCooldown();
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
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) throw new Error("Google 번역 응답 형식을 읽지 못했어요.");
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
    if (!fit) throw new Error("Google 번역 요청 한도를 맞출 수 없어요.");
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
  checkCooldown();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await risuai.nativeFetch(googleTranslationUrl(chunk, sourceLanguage), { method: "GET", signal: controller.signal });
    if (response.status === 429) {
      cooldownUntil = Math.max(cooldownUntil, Date.now() + (retryAfterMs(response.headers.get("Retry-After")) ?? TRANSLATION_COOLDOWN_MS));
      throw new TranslationError("RATE_LIMITED", "");
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
export async function callTranslationBatch(state: RuntimeState, batch: TranslationBatch, provider = state.settings.translationProvider, background = false, chatId = state.current?.chatId, finalRetry=false): Promise<{ items: ReturnType<typeof validateTranslation>; usage?: any; model: string; failure?: { code: string; retryAfterMs?: number } }> {
  checkCooldown();
  const items = translationParts(batch);
  const timeoutMs = translationTimeoutMs(provider === "server" ? state.settings.translationServerMaxOutput : state.settings.translationMaxOutput);
  const stats = state.translationStats ??= { calls: 0, items: 0 };
  stats.calls += 1;
  state.translationBackgroundRunning = background;
  state.publishActivity?.(); state.refreshStatusWidget?.();
  try {
    const call = async () => {
      if (provider === "server") return clientFor(state).request<{ items: Array<{ id: string; partIndex: number; ko: string }>; usage?: any; model: string }>("/v1/translations/batch", {
        method: "POST", body: JSON.stringify({ chatId, ...batch, model: state.settings.translationServerModel, temperature: state.settings.translationTemperature, thinking: state.settings.translationThinking, maxOutput: state.settings.translationServerMaxOutput }),
      }, timeoutMs * 3 + 5000);
      const { config } = await clientFor(state).request<{ config: { relaxAuxiliaryCensorship?: boolean } }>("/v1/admin/server-llm");
      let startedAt:number|undefined;
      const slot=risuModelSlot(state.settings.translationSlot,state.settings.translationModel);
      let response:any,failure:any,completedItems=0,outcome:'succeeded'|'failed'='failed',code:string|undefined;
      try {
        response = await runRisuModel(state, { messages: withAuxiliaryStoryFraming([{ role: "system", content: translationSystemPrompt }, { role: "user", content: JSON.stringify(batch) }], config.relaxAuxiliaryCensorship === true), ...slot }, undefined, timeoutMs,at=>{startedAt=at;});
        if (response?.type !== "success" || typeof response.result !== "string") throw new TranslationError(settingsFailureCode(response) ?? settingsFailureCode(response?.result) ?? "MODEL_CONNECTION_FAILED", "");
        const translated=validateTranslation(response.result, items, response.finish_reason ?? response.finishReason);
        outcome='succeeded';completedItems=translated.length-(finalRetry?0:untranslatedParts(items,translated).length);
        return { items: translated, usage: response.usage ?? response.usageMetadata, model: state.settings.translationSlot === "static" ? state.settings.translationModel : state.settings.translationSlot };
      } catch(error) { failure=error;code=settingsFailureCode(error) ?? 'MODEL_CONNECTION_FAILED';throw error; }
      finally {
        if(chatId&&startedAt!==undefined) await clientFor(state).request(`/v1/chats/${encodeURIComponent(chatId)}/processing/translations`,{
          method:'POST',body:JSON.stringify({id:crypto.randomUUID(),slot:state.settings.translationSlot==='static'?'static':slot.mode,model:typeof response?.model==='string'?sanitizeDiagnosticText(response.model,[],160):failure?.auxiliaryMetadata?.model!=='host_unknown'?failure?.auxiliaryMetadata?.model??failure?.risuCall?.model??slot.staticModel:slot.staticModel,
            provider:typeof response?.provider==='string'?sanitizeDiagnosticText(response.provider,[],160):failure?.auxiliaryMetadata?.provider!=='host_unknown'?failure?.auxiliaryMetadata?.provider??failure?.risuCall?.provider:undefined,
            startedAt,durationMs:(failure?.auxiliaryCallEndedAt??Date.now())-startedAt,itemCount:items.length,completedItems,outcome,code,usage:auxiliaryUsageMetadata(response?.usage ?? response?.usageMetadata ?? failure?.auxiliaryMetadata?.usage)})
        },8000).catch(()=>addLog(state.logs,'warn','참고 번역 호출 기록을 저장하지 못했어요.','MODEL_CALL_RECORD_FAILED'));
      }
    };
    // Each provider call owns its deadline, including a possible Korean-script retry.
    const result = await call();
    stats.lastError = undefined;
    const usage = result.usage;
    const input = usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokenCount;
    const output = usage?.completion_tokens ?? usage?.output_tokens ?? usage?.candidatesTokenCount;
    const total = usage?.total_tokens ?? usage?.totalTokenCount ?? (typeof input === "number" && typeof output === "number" ? input + output : undefined);
    if (typeof total === "number" && Number.isFinite(total)) stats.tokens = (stats.tokens ?? 0) + total;
    return result;
  } catch (error) {
    const code = settingsFailureCode(error) ?? (error as { code?: string })?.code ?? "MODEL_CONNECTION_FAILED";
    const detail = translationFailure(state, error);
    stats.lastError = `${code}: ${detail}`;
    throw new TranslationError(code, detail);
  } finally {
    state.translationBackgroundRunning = false;
    state.publishActivity?.(); state.refreshStatusWidget?.();
  }
}
async function translateRisuBatch(state: RuntimeState, records: Array<Pick<TranslationSource, "text"> & Partial<TranslationSource>>, provider: TranslationProvider, isCurrent: () => boolean, background: boolean, completed: (index: number, text: string, model: string) => Promise<void>, chatId = state.current?.chatId, finalRetry=false, canStore: () => boolean = isCurrent): Promise<{ translated: Map<string, string>; model: string; failures: Map<string, unknown> }> {
  return withRisuSlot(async () => {
    if (!isCurrent()) throw new TranslationError("CANCELLED", "Translation cancelled");
    checkCooldown();
    if(provider === "server") {
      const {config}=await clientFor(state).request<{config:import("@rcm/shared").TranslationConnectionPublicConfig}>("/v1/admin/translation/initialize", {
        method:"POST",body:JSON.stringify({model:state.settings.translationServerModel,temperature:state.settings.translationTemperature,thinking:state.settings.translationThinking,maxOutput:state.settings.translationServerMaxOutput}),
      });
      state.settings.translationServerMaxOutput=config.maxOutputTokens;
    }
    const messageIds = new Set(records.flatMap(record => record.kind === "dialogue" && record.chatId === state.current?.chatId && record.dialogue?.messageId
      ? [record.dialogue.messageId] : []));
    const reader = state.current?.chatId && messageIds.size
      ? await readCurrentChatReaderTranslations(state.current.chatId, messageIds, state.current.canonicalizationPolicy) : new Map<string, { source: string; translation: string }>();
    const request: TranslationRequest = { scenes: [], other: [] };
    const scenes = new Map<string, TranslationRequest["scenes"][number]>();
    for (const [index, record] of records.entries()) {
      const item = { id: String(index), text: prepareAuxiliaryText(record.text), ...(record.dialogue ? { speaker: record.dialogue.speaker } : {}) };
      if (!record.scene) { request.other.push(item); continue; }
      const key = JSON.stringify([record.chatId, record.scene.memoryId]);
      let scene = scenes.get(key);
      if (!scene) {
        scene = { participants: record.scene.participants, relationships: record.scene.relationships, references: [], items: [] };
        scenes.set(key, scene); request.scenes.push(scene);
        const messages = new Map<string, string[]>();
        for (const line of records) if (line.chatId === state.current?.chatId && line.chatId === record.chatId && line.scene?.memoryId === record.scene.memoryId && line.dialogue?.messageId) {
          const quotes = messages.get(line.dialogue.messageId) ?? []; quotes.push(line.text); messages.set(line.dialogue.messageId, quotes);
        }
        for (const [id, quotes] of messages) {
          const passage = reader.get(id);
          const window = passage && readerWindow(passage.source, passage.translation, quotes);
          if (window) {
            const text = prepareAuxiliaryText(window);
            scene.references.push(text.length > 16000 ? `${text.slice(0, 15999)}…` : text);
          }
        }
      }
      scene.items.push(item);
    }
    const batches = planTranslation(request, provider === "server" ? state.settings.translationServerMaxOutput : state.settings.translationMaxOutput);
    const translated = new Map<string, string>(); let model = "";
    const failures = new Map<string, unknown>();
    const stored = new Set<string>();
    const translateAndStore = async (batch: TranslationBatch) => {
      if (!isCurrent()) throw new TranslationError("CANCELLED", "Translation cancelled");
      const items = translationParts(batch);
      const response = await callTranslationBatch(state, batch, provider, background, chatId);
      // The server provider guards its own response; Risu retries here, once, without scene headers.
      const retry = provider === "risu" ? untranslatedParts(items, response.items) : [];
      if (retry.length && !isCurrent()) {
        // Moved away before the retry: keep the paid Korean results, leave the untranslated sources for later.
        const skipped = new Set(retry.map(part => part.id));
        response.items = response.items.filter(item => !skipped.has(item.id));
      } else if (retry.length) {
        const second = await callTranslationBatch(state, { scenes: [], other: retry.map(({ speaker: _speaker, ...part }) => part) }, provider, background, chatId,true);
        response.items = response.items.map(item => second.items.find(row => row.id === item.id && row.partIndex === item.partIndex) ?? item);
      }
      // A response already paid for stays usable after a chat switch: rows are keyed by chat and source.
      // Only an RCM-off or reset for that chat discards it.
      if (!canStore()) throw new TranslationError("CANCELLED", "Translation cancelled");
      model = response.model;
      for (const item of response.items) {
        if (failures.has(item.id)) continue; // A later part cannot complete a source whose earlier batch failed.
        translated.set(item.id, (translated.get(item.id) ?? "") + item.ko);
        const expected = items.find(part => part.id === item.id && part.partIndex === item.partIndex)!;
        if (item.partIndex === expected.partCount - 1) {
          await completed(Number(item.id), translated.get(item.id)!, model);
          stored.add(item.id);
        }
      }
      if (response.failure) {
        const error = Object.assign(new TranslationError(response.failure.code, ""), { retryAfterMs: response.failure.retryAfterMs });
        if (state.translationStats) state.translationStats.lastError = `${error.code}: ${error.message}`;
        throw error;
      }
    };
    for (const planned of batches) {
      // Do not pay for remaining fragments of a source already failed in this pass.
      const batch = background ? {
        scenes: planned.scenes.map(scene => ({ ...scene, items: scene.items.filter(item => !failures.has(item.id)) })).filter(scene => scene.items.length),
        other: planned.other.filter(item => !failures.has(item.id)),
      } : planned;
      if (!translationParts(batch).length) continue;
      try {
        try { await translateAndStore(batch); }
        catch (error) {
          const halves = provider === "risu" && (error as { code?: string })?.code === "MODEL_OUTPUT_TRUNCATED" ? splitTranslationBatch(batch) : undefined;
          if (!halves) throw error;
          // No recursion: a truncated half fails, leaving completed source rows cached.
          for (const half of halves) await translateAndStore(half);
        }
      } catch (error) {
        const code = settingsFailureCode(error) ?? (error as { code?: string })?.code;
        if (!background || !isCurrent() || code === "RATE_LIMITED" || code === "CHAT_WORK_HELD" || translationCooldownMs()) throw error;
        for (const item of translationParts(batch)) if (!stored.has(item.id)) {
          failures.set(item.id, error);
          translated.delete(item.id);
        }
      }
    }
    return { translated, model, failures };
  });
}
// Parse the packet's markup grammar only; never infer prose semantics. Quoted > stays in its tag.
const packetTag = () => /<!--[\s\S]*?-->|<\/?[A-Za-z_][\w:.-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/g;

/** Explicit, ephemeral translation: deliberately bypasses every cache and prefetch path. */
export async function translatePacket(state: RuntimeState, packet: string, sourceLanguage: MemoryLanguage, isCurrent: () => boolean = () => true): Promise<string> {
  const provider = state.settings.translationProvider;
  const chatId = state.current?.chatId;
  isCurrent = await translationCurrent(state, chatId ? [chatId] : [], isCurrent);
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
    const result = await translateRisuBatch(state, records, provider, isCurrent, false, async () => {}, chatId);
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
    const detail = translationFailure(state, error, `Packet translation failed: ${code}`);
    throw new TranslationError(code, detail);
  }
}

function changeActivity(state: RuntimeState, delta: number, error?: string): void {
  aggregatePending = Math.max(0, aggregatePending + delta);
  state.translationActivity = { pending: aggregatePending, ...(error ? { error } : {}) };
  state.publishActivity?.(); state.refreshStatusWidget?.();
}

// Evidence quotes and dialogue keep the language of the chat source, which can
// differ from the memory language (Korean input with English replies). Source
// text that already contains Hangul is shown as written instead of being sent to
// a translator again. This is a typographic script check, not a judgement of
// meaning; any other text follows the memory language as before.
const SOURCE_TEXT_KINDS = new Set(["evidence", "dialogue"]);
export const shownAsWritten = (record: Pick<TranslationSource, "kind" | "text" | "sourceLanguage">): boolean =>
  record.sourceLanguage === "ko" || SOURCE_TEXT_KINDS.has(record.kind) && /\p{Script=Hangul}/u.test(record.text);

async function translateRecordsUnlocked(state: RuntimeState, records: TranslationSource[], provider = state.settings.translationProvider, isCurrent: () => boolean = () => true, background = false, replaceGoogle = false): Promise<TranslationResult[]> {
  if (!records.length) return [];
  const canStore = await translationCurrent(state, [...new Set(records.map(record => record.chatId))], () => true);
  const requested = isCurrent;
  isCurrent = () => requested() && canStore();
  if (records.every(shownAsWritten)) return records.map((source) => ({ ...source, translated: source.text, cached: true }));
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
    for (const item of prepared) {
      if (shownAsWritten(item.source)) results.set(item.key, { ...item.source, translated: item.source.text, cached: true });
      else if (cached.has(item.key)) results.set(item.key, { ...item.source, translated: cached.get(item.key)!, cached: true });
    }
    const missing = [...new Map(prepared.filter(item => !results.has(item.key)).map(item => [item.key, item])).values()];
    for (const item of prepared) if (results.has(item.key)) backgroundRetries.get(state)?.get(item.source.chatId)?.delete(sourceIdentity(item.source));
    if (!missing.length) return prepared.map((item) => results.get(item.key)!);
    if (!isCurrent()) return prepared.map(item => results.get(item.key)).filter((item): item is TranslationResult => Boolean(item));
    pendingStarted = missing.length; changeActivity(state, pendingStarted);
    const fresh = new Map<string, string>();
    let batchError: string | undefined;
    let model = "";
    const fail = (item: Prepared, error: unknown) => {
      const message = translationFailure(state, error);
      batchError ??= message;
      const code = settingsFailureCode(error) ?? (error as { code?: string })?.code;
      if (background && isCurrent() && code !== "RATE_LIMITED" && code !== "CHAT_WORK_HELD" && !translationCooldownMs()) {
        const retries = backgroundRetriesFor(state, item.source.chatId);
        const key = sourceIdentity(item.source);
        const attempts = Math.min(6, (retries.get(key)?.attempts ?? 0) + 1);
        retries.set(key, { attempts, retryAt: Date.now() + Math.min(30 * 60_000, 60_000 * 2 ** (attempts - 1)) });
      }
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
          const { dialogue: _dialogue, scene: _scene, ...source } = item.source;
          await clientFor(state).request("/v1/translations/cache/upsert", { method: "POST", body: JSON.stringify({ items: [{ key: item.key, ...source, sourceHash: item.sourceHash, provider, model, targetLanguage: "ko", translated: text }] }) }, 8000);
          fresh.set(item.key, text);
          backgroundRetries.get(state)?.get(item.source.chatId)?.delete(sourceIdentity(item.source));
        }, records[0]!.chatId, false, canStore);
        const translated = response.translated; model = response.model;
        for (const [index, item] of missing.entries()) {
          const value = translated.get(String(index));
          if (!value) {
            const error = response.failures.get(String(index)) ?? new Error(`번역 결과에서 ${item.source.itemId} 항목이 빠졌어요.`);
            if (!background) throw error;
            fail(item, error);
          } else fresh.set(item.key, value);
        }
      } catch (error) {
        missing.filter(item => !fresh.has(item.key)).forEach((item) => fail(item, error));
      }
    }
    if (!isCurrent()) { changeActivity(state, -pendingStarted); return []; }
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
    return prepared.map((item) => results.get(item.key) ?? { ...item.source, translated: item.source.text, cached: false });
  } catch (error) {
    const message = translationFailure(state, error);
    changeActivity(state, pendingStarted ? -pendingStarted : 0, message);
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

type ScreenRequest = {
  records: TranslationSource[];
  current: Promise<() => boolean>;
  resolve: (results: TranslationResult[]) => void;
  reject: (error: unknown) => void;
};
const screenBatches = new WeakMap<RuntimeState, Map<string, ScreenRequest[]>>();
const sourceIdentity = (source: TranslationSource) => JSON.stringify([source.serverInstanceId, source.chatId, source.kind, source.itemId, source.text, source.sourceLanguage]);

async function runScreenBatch(state: RuntimeState, requests: ScreenRequest[], provider?: TranslationProvider): Promise<void> {
  const current = await Promise.all(requests.map(request => request.current));
  if (translationBusy) await new Promise<void>(resolve => screenTranslationWaiters.push(resolve));
  else translationBusy = true;
  try {
    const active = current.filter(check => check());
    const records = [...new Map(requests.filter((_, index) => current[index]!()).flatMap(request => request.records).map(record => [sourceIdentity(record), record])).values()];
    const results = await translateRecordsUnlocked(state, records, provider ?? state.settings.translationProvider, () => active.every(check => check()));
    const bySource = new Map(results.map(result => [sourceIdentity(result), result]));
    requests.forEach((request, index) => request.resolve(current[index]!() ? request.records.flatMap(record => bySource.has(sourceIdentity(record)) ? [bySource.get(sourceIdentity(record))!] : []) : []));
  } catch (error) { requests.forEach(request => request.reject(error)); }
  finally { releaseTranslation(); }
}

/** Coalesce one view's same-tick rows, deduplicate sources, and take priority over prefetch. */
export async function translateRecords(state: RuntimeState, records: TranslationSource[], provider?: TranslationProvider): Promise<TranslationResult[]> {
  if (!records.length) return [];
  changeActivity(state, records.length);
  let failure: string | undefined;
  try {
    const current = translationCurrent(state, [...new Set(records.map(record => record.chatId))], () => true);
    let batches = screenBatches.get(state);
    if (!batches) screenBatches.set(state, batches = new Map());
    // Never merge independent chat scopes or explicit provider overrides.
    const key = JSON.stringify([provider, [...new Set(records.map(record => record.chatId))].sort()]);
    let batch = batches.get(key);
    if (!batch) {
      batches.set(key, batch = []);
      const pending = batch;
      queueMicrotask(() => { batches.delete(key); void runScreenBatch(state, pending, provider); });
    }
    const results = await new Promise<TranslationResult[]>((resolve, reject) => batch.push({ records, current, resolve, reject }));
    failure = results.find(result => result.error)?.error;
    return results;
  } finally { changeActivity(state, -records.length, failure); }
}

type BackgroundRetry = { attempts: number; retryAt: number };
const backgroundRetries = new WeakMap<RuntimeState, Map<string, Map<string, BackgroundRetry>>>();
function backgroundRetriesFor(state: RuntimeState, chatId: string): Map<string, BackgroundRetry> {
  let chats = backgroundRetries.get(state);
  if (!chats) backgroundRetries.set(state, chats = new Map());
  let retries = chats.get(chatId);
  if (!retries) chats.set(chatId, retries = new Map());
  return retries;
}
export function resetBackgroundTranslationRetries(state: RuntimeState, chatId: string): void {
  backgroundRetries.get(state)?.delete(chatId);
}

/** Google keeps its bounded prefetch; LLM modes pack all pending sources by output budget. */
export async function prefetchTranslationRecords(state: RuntimeState, records: TranslationSource[], isCurrent: () => boolean): Promise<TranslationSource[]> {
  const provider = state.settings.translationProvider;
  if (!backgroundTranslationEnabled(state)) return [];
  if (translationCooldownMs()) return records;
  if (provider !== "google") {
    if (translationBusy) return records;
    translationBusy = true;
    try {
      const eligible = records.filter(record => (backgroundRetries.get(state)?.get(record.chatId)?.get(sourceIdentity(record))?.retryAt ?? 0) <= Date.now());
      if (!eligible.length) return records;
      const result = await translateRecordsUnlocked(state, eligible, provider, () => isCurrent() && backgroundTranslationEnabled(state) && state.settings.translationProvider === provider, true);
      const done = new Set(result.filter(item => !item.error).map(sourceIdentity));
      return records.filter(record => !done.has(sourceIdentity(record)));
    } finally { releaseTranslation(); }
  }
  const current = () => isCurrent() && state.settings.translationProvider === provider;
  let translated = 0;
  for (let offset = 0; offset < records.length && translated < 24; offset += 128) {
    if (!current()) return [];
    if (!state.settings.autoTranslate || state.settings.translationDisplay !== "ko") return records.slice(offset);
    if (translationBusy || translationCooldownMs()) return records.slice(offset);
    const candidates = records.slice(offset, offset + 128).filter(record => !shownAsWritten(record));
    const cached = await readCachedTranslations(state, candidates, provider);
    const cachedKeys = new Set(cached.map(record => JSON.stringify([record.kind, record.itemId, record.text])));
    const missing = candidates.filter(record => !cachedKeys.has(JSON.stringify([record.kind, record.itemId, record.text])));
    for (let index = 0; index < missing.length && translated < 24; index += 2) {
      if (!current()) return [];
      if (!state.settings.autoTranslate || state.settings.translationDisplay !== "ko") return [...missing.slice(index), ...records.slice(offset + 128)];
      if (translationBusy || translationCooldownMs()) return [...missing.slice(index), ...records.slice(offset + 128)];
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
  // Source text already in Korean is shown as written, even over an older cached
  // re-translation, and needs no cache entry.
  return prepared.flatMap((item) => shownAsWritten(item.source) ? [{ ...item.source, translated: item.source.text, cached: true }]
    : cached.has(item.key) ? [{ ...item.source, translated: cached.get(item.key)!, cached: true }] : []);
}
export async function clearTranslationCache(state: RuntimeState): Promise<void> {
  await clientFor(state).request("/v1/translations/cache", { method: "DELETE" });
}
export async function invalidateTranslationCache(state: RuntimeState, match: Partial<Pick<TranslationSource, "serverInstanceId" | "chatId" | "kind" | "itemId">> & { itemIdPrefix?: string }): Promise<void> {
  await clientFor(state).request("/v1/translations/cache/invalidate", { method: "POST", body: JSON.stringify(match) });
}

/** Wait out old cache writes before clearing, so late responses cannot restore the old translation. */
export async function retranslateChatRecords(state: RuntimeState, scope: Pick<TranslationSource, "chatId" | "serverInstanceId">, records: TranslationSource[]): Promise<TranslationResult[]> {
  invalidateChatTranslations(scope.chatId);
  const current = await translationCurrent(state, [scope.chatId], () => true);
  if (translationBusy) await new Promise<void>(resolve => screenTranslationWaiters.push(resolve)); else translationBusy = true;
  try {
    if (!current()) throw new Error("번역 설정이 바뀌었어요. 다시 시도해 주세요.");
    await invalidateTranslationCache(state, scope);
    return await translateRecordsUnlocked(state, records, state.settings.translationProvider, current);
  } finally { releaseTranslation(); }
}

/** Explicitly approved replacement uses the same visible background call path, even when automatic prefetch is off. */
export async function retranslateGoogleRecords(state: RuntimeState, records: TranslationSource[]): Promise<void> {
  const provider = state.settings.translationProvider;
  if (provider === "google") return;
  if (translationBusy) await new Promise<void>(resolve => screenTranslationWaiters.push(resolve)); else translationBusy = true;
  try {
    const results = await translateRecordsUnlocked(state, records, provider, () => state.settings.translationProvider === provider, true, true);
    const failed = results.find(item => item.error);
    if (failed) throw new Error(failed.error);
  } finally { releaseTranslation(); }
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
