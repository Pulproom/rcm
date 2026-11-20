import { withMemoryGuidance, canonicalizeSourceText, defaultCanonicalizationPolicy, imageComparisonText, sourceComparisonText, estimateTokens, selectTailStart, selectGigaTransTranslation, type CanonicalizationPolicy, type LineageProbeRequest, type MessageHostVisibility, type ResolvedSetupProjection, type SearchQuerySignal, type TurnPrepareRequest } from "@rcm/shared";
import type { ChatScopeTiming, ContextReadTimings, CurrentContext, DashboardContext, RuntimeState } from "./types.js";
import { addLog, isChatMemoryEnabled, serverScopeKey } from "./settings.js";
import { resolveUserPersonaName } from "./persona.js";
import { cachedSourceReceipt, ServerRequestError, type ServerClient } from './api-client.js';

import { hasRecentPocketSlot, pocketSlotEnabled, slotWriteConfirmed, storyChat, updatePocketSlot, withPocketSlotWrite } from "./pocket-memory-slot.js";

const encoder = new TextEncoder();
export const MEMORY_MARKER = "[[RCM]]";
export { composeQuerySignals, RISU_CONTINUATION_MARKER } from "@rcm/shared";

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function messageRole(message: any): "user" | "assistant" | "system" {
  if (message?.role === "user") return "user";
  if (message?.role === "system") return "system";
  return "assistant";
}

function loreContent(entry: any): string {
  return String(entry?.content ?? entry?.data ?? entry?.text ?? entry?.comment ?? "");
}

interface YumiTranslationRecord {
  v?: number;
  model?: string;
  segments?: Array<{ source?: string }>;
}

async function decodeYumiRecord(raw: unknown): Promise<YumiTranslationRecord | undefined> {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    if (raw.startsWith("u:")) return JSON.parse(raw.slice(2)) as YumiTranslationRecord;
    if (raw.startsWith("z:")) {
      const bytes = Uint8Array.from(atob(raw.slice(2)), (character) => character.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text()) as YumiTranslationRecord;
    }
    return JSON.parse(raw) as YumiTranslationRecord;
  } catch {
    return undefined;
  }
}

interface ResolvedMessageSource {
  content: string;
  sourceKind: "risu_display" | "yumi_model";
  sourceRecordId?: string;
}

export interface HostSourceLedgerSnapshot {
  chatId: string;
  chatTitle: string;
  characterId: string;
  characterName: string;
  messages: TurnPrepareRequest["messages"];
  messageVisibility: NonNullable<TurnPrepareRequest["messageVisibility"]>;
}

/** Read complete host ledgers without switching the user's active Risu chat. */
export async function readHostSourceLedgers(onlyChatIds?: ReadonlySet<string>): Promise<HostSourceLedgerSnapshot[]> {
  const database = await risuai.getDatabase(["characters"]);
  const raw = database?.characters;
  const characters = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
  const result: HostSourceLedgerSnapshot[] = [];
  for (const [characterIndex, character] of characters.entries()) {
    if (!character || typeof character !== "object") continue;
    const characterId = String((character as any).chaId ?? (character as any).id ?? characterIndex);
    const characterName = String((character as any).name ?? characterId).trim() || characterId;
    const chats = Array.isArray((character as any).chats) ? (character as any).chats : [];
    for (const [chatIndex, descriptor] of chats.entries()) {
      if (!descriptor || typeof descriptor !== "object") continue;
      const chatId = String(descriptor.id || `${characterId}:${chatIndex}`);
      if (onlyChatIds && !onlyChatIds.has(chatId)) continue;
      const chat = storyChat(await risuai.getChatFromIndex(characterIndex, chatIndex));
      if (!chat) throw new Error(`Risu 원문을 불러오지 못했어요: ${String(descriptor.name ?? descriptor.title ?? chatId)}`);
      assertCompleteHostChat(chat);
      if (String(chat.id || `${characterId}:${chatIndex}`) !== chatId) throw new Error('HOST_SOURCE_CHANGED');
      const source = chat.message;
      const resolved = await Promise.all(source.map((message: any) => resolveMessageSource(chat, message)));
      const allBefore = source.reduce((last: number, message: any, index: number) => message?.disabled === "allBefore" ? index : last, -1);
      const messageVisibility = await Promise.all(source.map(async (message: any, ordinal: number) => {
        const role = messageRole(message);
        const content = resolved[ordinal]?.content ?? "";
        const display = String(message?.data ?? message?.content ?? "");
        const displayComparison = sourceComparisonText(display);
        return {
          id: String(message?.chatId ?? message?.id ?? `${chatId}:${ordinal}`), ordinal,
          visibility: hostVisibility(source, ordinal, allBefore), role,
          contentHash: await sha256(`${role}\0${content}`),
          comparisonHash: await sha256(`${role}\0${sourceComparisonText(content)}`),
          sourceRecordId: resolved[ordinal]?.sourceRecordId,
          displayContentHash: await sha256(`${role}\0${display}`),
          displayComparisonHash: await sha256(`${role}\0${displayComparison}`),
        };
      }));
      result.push({
        chatId,
        chatTitle: String(chat.name ?? chat.title ?? descriptor.name ?? descriptor.title ?? "").trim() || `채팅 ${chatIndex + 1}`,
        characterId,
        characterName,
        messages: source.map((message: any, ordinal: number) => ({
          id: String(message?.chatId ?? message?.id ?? `${chatId}:${ordinal}`),
          role: messageRole(message),
          content: resolved[ordinal]?.content ?? "",
          ordinal,
          time: typeof message?.time === "number" ? message.time : undefined,
          generationId: message?.generationInfo?.generationId ? String(message.generationInfo.generationId) : undefined,
          sourceKind: resolved[ordinal]?.sourceKind ?? "risu_display",
          disabled: ["disabled", "comment"].includes(messageVisibility[ordinal]?.visibility ?? "active"),
        })),
        messageVisibility,
      });
    }
  }
  return result;
}

function messageDisplay(message: any): string {
  return String(message?.data ?? message?.content ?? "");
}

function yumiSourceRecordId(message: any, display: string): string {
  // Yumi's transport marker can precede its message metadata (including after
  // a tail replacement). The displayed record ID owns this representation;
  // never use a stale metadata ID to resolve a different response's original.
  return display.match(/<!--\s*yumi-tr:v1:([A-Za-z0-9_-]+):start\s*-->/)?.[1]
    ?? (typeof message?.__yumi_tr === "string" ? message.__yumi_tr : "");
}

function yumiSourceRecord(chat: any, id: string): string | undefined {
  const raw = id ? chat?.scriptstate?.[`$__yumi_tr.${id}`] : undefined;
  return typeof raw === "string" ? raw : undefined;
}

export function readMessageSourceInputs(chat: any) {
  assertCompleteHostChat(chat);
  return (chat.message as any[]).map(message => {
    const display = messageDisplay(message);
    const yumiId = yumiSourceRecordId(message, display);
    return {
      id: message?.chatId ?? message?.id,
      role: messageRole(message),
      display,
      generationId: message?.generationInfo?.generationId,
      time: message?.time,
      name: message?.name,
      saying: message?.saying,
      disabled: message?.disabled,
      isComment: message?.isComment,
      yumiMetadata: message?.__yumi_tr,
      yumiId,
      yumiRecord: yumiSourceRecord(chat, yumiId),
    };
  });
}

/** Compare the ordered source inputs without re-decoding or re-hashing them. */
export function sameMessageSourceInputs(previous: ReturnType<typeof readMessageSourceInputs>, chat: any, prefixLength?: number): boolean {
  if (!Array.isArray(chat?.message) || chat._placeholder) return false;
  if (prefixLength === undefined && previous.length !== chat.message.length) return false;
  if (prefixLength !== undefined && chat.message.length < prefixLength) return false;
  const sources = prefixLength === undefined ? previous : previous.slice(0, prefixLength);
  return sources.every((source, ordinal) => {
    const next = chat.message[ordinal];
    const display = messageDisplay(next);
    return source.id === (next?.chatId ?? next?.id)
      && source.role === messageRole(next)
      && source.display === display
      && source.generationId === next?.generationInfo?.generationId
      && source.time === next?.time
      && source.name === next?.name
      && source.saying === next?.saying
      && source.disabled === next?.disabled
      && source.isComment === next?.isComment
      && source.yumiId === (source.yumiMetadata === next?.__yumi_tr ? source.yumiId : yumiSourceRecordId(next, display))
      && source.yumiRecord === yumiSourceRecord(chat, source.yumiId);
  });
}

export function readContextMetadata() {
  return Promise.all([
    risuai.getCurrentLorebookEntries?.() ?? Promise.resolve([]),
    risuai.getDatabase(["personas", "selectedPersona"]),
  ]);
}

/** Host descriptors are JSON data. Compare their fields without serializing chat text. */
export function sameHostFields(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object"
    || Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && left.length !== (right as unknown[]).length) return false;
  const previous = left as Record<string, unknown>;
  const current = right as Record<string, unknown>;
  const keys = Object.keys(previous).filter(key => previous[key] !== undefined);
  return keys.length === Object.keys(current).filter(key => current[key] !== undefined).length
    && keys.every(key => Object.hasOwn(current, key) && sameHostFields(previous[key], current[key]));
}

async function resolveMessageSource(chat: any, message: any): Promise<ResolvedMessageSource> {
  const display = messageDisplay(message);
  const markerId = yumiSourceRecordId(message, display);
  return resolveSourceInput(display, markerId, yumiSourceRecord(chat, markerId));
}

async function resolveSourceInput(display: string, markerId: string, raw?: string): Promise<ResolvedMessageSource> {
  if (markerId) {
    const record = await decodeYumiRecord(raw);
    const model = typeof record?.model === "string" ? record.model : "";
    if (model.trim()) return { content: model, sourceKind: "yumi_model", sourceRecordId: markerId };
    const segmented = record?.segments?.map((segment) => segment.source ?? "").join("") ?? "";
    if (segmented.trim()) return { content: segmented, sourceKind: "yumi_model", sourceRecordId: markerId };
  }
  return {
    content: display,
    sourceKind: "risu_display",
    ...(markerId ? { sourceRecordId: markerId } : {}),
  };
}

export async function resolveMessageContent(chat: any, message: any): Promise<string> {
  return (await resolveMessageSource(chat, message)).content;
}

/** Parse Yumi's owned display envelope once for all reader-translation consumers. */
export function selectYumiTranslation(message: any, recordId: string): string | undefined {
  const display = String(message?.data ?? message?.content ?? "");
  const marked = display.match(/<!--\s*yumi-tr:v1:([A-Za-z0-9_-]+):start\s*-->([\s\S]*?)<!--\s*yumi-tr:v1:\1:end\s*-->/);
  return marked?.[1] === recordId ? marked[2] : !display.includes('<!--') && message.__yumi_tr === recordId ? display : undefined;
}

/** One host read per run; resolve/decode only the requested messages. No host writes or cache probes. */
export async function readCurrentChatReaderTranslations(chatId: string, messageIds: ReadonlySet<string>, policy: CanonicalizationPolicy = defaultCanonicalizationPolicy()): Promise<Map<string, { source: string; translation: string }>> {
  const result = new Map<string, { source: string; translation: string }>();
  if (!messageIds.size) return result;
  try {
    const identity = await readCurrentChatIdentity();
    if (identity.chatId !== chatId || identity.chat._placeholder || !Array.isArray(identity.chat.message)) return result;
    for (const [ordinal, message] of identity.chat.message.entries()) {
      const messageId = String(message?.chatId ?? message?.id ?? `${chatId}:${ordinal}`);
      if (!messageIds.has(messageId)) continue;
      const resolved = await resolveMessageSource(identity.chat, message);
      const display = String(message?.data ?? message?.content ?? "");
      const id = resolved.sourceRecordId;
      const translation = (id ? selectYumiTranslation(message, id) : undefined) ?? selectGigaTransTranslation(display);
      // Typographic script check, not natural-language meaning inference.
      if (!translation || !/\p{Script=Hangul}/u.test(translation)) continue;
      result.set(messageId, { source: canonicalizeSourceText(resolved.content, policy), translation });
    }
  } catch { /* Missing or changing host selection simply supplies no reference. */ }
  return result;
}

/** Read-only display translations. Never call a translator or mutate source text. */
export async function readHostSourceTranslations(chatId: string, sources: Array<{id:string;content:string|null}>, policy: CanonicalizationPolicy = defaultCanonicalizationPolicy()): Promise<Map<string,string>> {
  const translated = new Map<string,string>();
  if (!sources.length) return translated;
  try {
    const identity = await readCurrentChatIdentity();
    if (identity.chatId !== chatId) return translated;
    const messages: any[] = Array.isArray(identity.chat.message) ? identity.chat.message : [];
    const byId = new Map(messages.map((message, ordinal) => [String(message?.chatId ?? message?.id ?? `${chatId}:${ordinal}`), message]));
    for (const source of sources) {
      if (source.content === null || !source.content.trim()) continue;
      const message = byId.get(source.id);
      if (!message) continue;
      const resolved = await resolveMessageSource(identity.chat, message);
      // An old server revision must never acquire a newer reply's translation.
      if (canonicalizeSourceText(resolved.content, policy) !== source.content) continue;
      const display = String(message.data ?? message.content ?? '');
      if (resolved.sourceKind === 'yumi_model') {
        const id = resolved.sourceRecordId!;
        const text = selectYumiTranslation(message, id);
        if (text?.trim()) { translated.set(source.id, text); continue; }
      }
      // GigaTrans stores the source inside its complete owned blocks and the
      // already translated display outside them (the inverse of source selection).
      const withoutGigaSource = display.replace(/<GigaTrans\b[^>]*>[\s\S]*?<\/GigaTrans\s*>/gi, '');
      const gigaDisplay = withoutGigaSource.replace(/<GT-(?:CTRL\b[^>]*|SEP)\s*\/>/gi, '').trim();
      if (withoutGigaSource !== display && gigaDisplay && !/<\/?GigaTrans\b/i.test(gigaDisplay)) {
        translated.set(source.id, gigaDisplay); continue;
      }
      const keys = [...new Set([display, resolved.content, source.content].filter(Boolean))];
      try {
        for (const key of keys) {
          const cached = await risuai.getTranslationCache?.(key);
          if (cached?.trim()) { translated.set(source.id, cached); break; }
        }
        // PocketRisu's cache may use formatted HTML as its key. Only accept a
        // unique full-body match; substring matches alone cannot identify a reply.
        if (!translated.has(source.id) && risuai.searchTranslationCache && typeof DOMParser !== 'undefined') {
          const plain = (value: string) => new DOMParser().parseFromString(value.replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-6])>/gi, '\n'), 'text/html').body.textContent?.replace(/\s+/g,' ').trim();
          const expected = source.content.replace(/\s+/g,' ').trim();
          const matches = (await risuai.searchTranslationCache(source.content))
            .filter(entry => entry.value?.trim() && plain(entry.key) === expected);
          if (matches.length === 1) translated.set(source.id, matches[0]!.value);
        }
      } catch { /* Missing/denied host cache leaves the original available. */ }
    }
  } catch { /* A closed/switched host chat has no matching display translations. */ }
  return translated;
}

export function hostVisibility(messages: any[], ordinal: number, allBefore: number): MessageHostVisibility {
  const message = messages[ordinal];
  if (message?.isComment === true) return "comment";
  if (allBefore >= 0 && ordinal <= allBefore) return "all_before";
  if (message?.disabled === true) return "disabled";
  return "active";
}

export function parseBranchLineageHint(messages: any[]): CurrentContext["lineageHint"] {
  for (let ordinal = messages.length - 1; ordinal >= 0; ordinal -= 1) {
    const message = messages[ordinal];
    const raw = String(message?.data ?? message?.content ?? "");
    const match = raw.match(/\{\{specialcomment::branchedfrom::([\s\S]*?)::\}\}/i);
    if (match) {
      const parts = match[1]!.split("::");
      const parentChatId = parts.shift()?.trim();
      const forkMessageId = parts.pop()?.trim();
      if (parentChatId && forkMessageId) return {
        kind: "branch",
        parentChatId,
        parentChatTitle: parts.join("::").trim() || undefined,
        forkMessageId,
        markerMessageId: String(message?.chatId ?? message?.id ?? "").trim() || undefined,
        markerOrdinal: ordinal,
      };
    }
  }
  return undefined;
}

const LARGE_CHAT_MESSAGE_LIMIT = 256;
const LARGE_CHAT_TOKEN_LIMIT = 120_000;
const TAIL_MESSAGE_LIMIT = 64;
const TAIL_TOKEN_LIMIT = 32_000;
export class NoActiveChatError extends Error {
  constructor() {
    super("No active Risu chat");
    this.name = "NoActiveChatError";
  }
}

export function isNoActiveChatError(error: unknown): boolean {
  if (error instanceof NoActiveChatError) return true;
  const message = String(error);
  return /No active Risu chat/i.test(message)
    || /Cannot read properties of (?:undefined|null).*chatPage/i.test(message);
}

function assertCompleteHostChat(chat: any): void {
  if (!chat || chat._placeholder === true || !Array.isArray(chat.message)) throw new Error('HOST_SOURCE_INCOMPLETE');
}

export function readHostSelection() {
  return Promise.all([risuai.getCurrentCharacterIndex(), risuai.getCurrentChatIndex()]);
}

export async function assertHostSelection(characterIndex: number, chatIndex: number): Promise<void> {
  const [currentCharacter, currentChat] = await readHostSelection();
  if (currentCharacter !== characterIndex || currentChat !== chatIndex) throw new Error('HOST_SELECTION_CHANGED');
}

interface HostChatSnapshot {
  characterIndex: number;
  character: any;
  chatIndex: number;
  rawChat?: any;
  chat: any;
  chatId: string;
}

async function readCurrentChatIdentity(preferDescriptor = false, timing?: ChatScopeTiming): Promise<HostChatSnapshot> {
  const characterIndex = await risuai.getCurrentCharacterIndex();
  if (!Number.isInteger(characterIndex) || characterIndex < 0) throw new NoActiveChatError();
  if (timing) timing.fullHostChatReads += 1;
  const character = await risuai.getCharacter();
  if (!character || typeof character !== "object") throw new NoActiveChatError();
  const chatIndex = await risuai.getCurrentChatIndex();
  if (!Number.isInteger(chatIndex) || chatIndex < 0) throw new NoActiveChatError();
  const descriptor = character?.chats?.[chatIndex];
  // Both supported V3 implementations snapshot the same loaded chat slot in
  // getCharacter and getChatFromIndex. Only a stable, complete loaded slot can
  // supply the initial baseline; placeholders/legacy descriptors still fetch.
  let rawChat = descriptor;
  if (!preferDescriptor || !descriptor?.id || descriptor._placeholder || !Array.isArray(descriptor.message)) {
    if (timing) timing.fullHostChatReads += 1;
    rawChat = await risuai.getChatFromIndex(characterIndex, chatIndex);
  }
  const chat = storyChat(rawChat);
  if (!chat) throw new NoActiveChatError();
  const characterId = String(character?.chaId ?? character?.id ?? characterIndex);
  await assertHostSelection(characterIndex, chatIndex);
  if (!chat.id && character?.chats?.[chatIndex]?.id) throw new Error('HOST_CHAT_ID_LOADING');
  const chatId = String(chat.id || `${characterId}:${chatIndex}`);
  return { characterIndex, character, chatIndex, chat, chatId, rawChat };
}

function chatIdentityFields(characterIndex: number, character: any, chatIndex: number, chat: any) {
  const characterId = String(character?.chaId ?? character?.id ?? characterIndex);
  const chatTitle = String(chat.name ?? chat.title ?? "").trim() || `채팅 ${chatIndex + 1}`;
  const chatTitles = Object.fromEntries((Array.isArray(character?.chats) ? character.chats : [])
    .map((item: any, index: number) => {
      const id = String(item?.id || `${characterId}:${index}`);
      const title = String(item?.name ?? item?.title ?? "").trim();
      return id && title ? [id, title] : undefined;
    })
    .filter((entry: [string, string] | undefined): entry is [string, string] => Boolean(entry)));
  return { characterId, chatTitle, chatTitles };
}

async function sourceMessageProjection(chatId: string, messages: any[], messageSources: ResolvedMessageSource[], canonicalizationPolicy = defaultCanonicalizationPolicy()) {
  const allBefore = messages.reduce((last: number, message: any, index: number) => message?.disabled === "allBefore" ? index : last, -1);
  return Promise.all(messages.map(async (message: any, ordinal: number) => {
    const role = messageRole(message);
    const content = messageSources[ordinal]?.content ?? "";
    const display = messageDisplay(message);
    const canonicalContent = canonicalizeSourceText(content, canonicalizationPolicy);
    const canonicalDisplay = display === content ? canonicalContent : canonicalizeSourceText(display, canonicalizationPolicy);
    const comparison = imageComparisonText(canonicalContent);
    const displayComparison = canonicalDisplay === canonicalContent ? comparison : imageComparisonText(canonicalDisplay);
    // A normal display source often has just one distinct input for all four digests.
    const hashes = new Map<string, Promise<string>>();
    const hash = (text: string) => {
      const existing = hashes.get(text);
      if (existing) return existing;
      const digest = sha256(`${role}\0${text}`);
      hashes.set(text, digest);
      return digest;
    };
    const [contentHash, comparisonHash, displayContentHash, displayComparisonHash] = await Promise.all([
      hash(content), hash(comparison), hash(display), hash(displayComparison),
    ]);
    return {
      visibility: {
        id: String(message?.chatId ?? message?.id ?? `${chatId}:${ordinal}`), ordinal,
        visibility: hostVisibility(messages, ordinal, allBefore), role,
        contentHash, comparisonHash, sourceRecordId: messageSources[ordinal]?.sourceRecordId,
        displayContentHash, displayComparisonHash,
      },
      canonicalContent,
    };
  }));
}

/** Only lineage needs source hashes; perform this separately from dashboard paint. */
export async function readDashboardLineageRequest(context: DashboardContext): Promise<LineageProbeRequest> {
  const { chat, chatId, characterIndex, chatIndex } = await readCurrentChatIdentity();
  if (chatId !== context.chatId) throw new Error("Dashboard chat changed");
  assertCompleteHostChat(chat);
  const messages = chat.message;
  const sources = await Promise.all(messages.map((message: any) => resolveMessageSource(chat, message)));
  const messageVisibility = (await sourceMessageProjection(chatId, messages, sources, context.canonicalizationPolicy)).map(source => source.visibility);
  const latest = storyChat(await risuai.getChatFromIndex(characterIndex, chatIndex));
  if (!sameHostFields(latest?.message, messages)
    || sources.some((source: ResolvedMessageSource) => source.sourceRecordId && yumiSourceRecord(chat, source.sourceRecordId) !== yumiSourceRecord(latest, source.sourceRecordId))) throw new Error('HOST_SOURCE_CHANGED');
  await assertHostSelection(characterIndex, chatIndex);
  return {
    chatTitle: context.chatTitle, characterId: context.characterId, profile: context.profile,
    messageVisibility,
    lineageHint: parseBranchLineageHint(messages), canonicalizationPolicy: context.canonicalizationPolicy,
    includeUserMessages: context.includeUserMessages, extractionGroupTurns: context.extractionGroupTurns, memoryLanguage: context.memoryLanguage,
  };
}

export async function syncCurrentPocketSlot(state: RuntimeState, chatId: string, characterId: string): Promise<boolean> {
  return withPocketSlotWrite(chatId, async () => {
    if (!risuai.setChatToIndex) throw new Error("이 호스트에서는 채팅 슬롯을 설정할 수 없어요.");
    const [characterIndex, chatIndex] = await readHostSelection();
    const chat = await risuai.getChatFromIndex(characterIndex, chatIndex);
    if (!chat?.id || chat.id !== chatId) throw new Error("채팅이 바뀌었어요. 설정을 다시 열어 주세요.");
    const install = isChatMemoryEnabled(state.settings, chatId, characterId);
    const next = updatePocketSlot(chat, install);
    if (next !== chat) {
      await assertHostSelection(characterIndex, chatIndex);
      const latest = await risuai.getChatFromIndex(characterIndex, chatIndex);
      if (state.unloaded || state.mainRequest?.preparing || state.activeModelRequest || install !== isChatMemoryEnabled(state.settings, chatId, characterId) || !sameHostFields(chat, latest)) throw new Error("채팅이 변경 중이에요. 전송이 끝난 뒤 다시 시도해 주세요.");
      await risuai.setChatToIndex(characterIndex, chatIndex, next);
    }
    const saved = next === chat ? chat : await risuai.getChatFromIndex(characterIndex, chatIndex);
    if (!slotWriteConfirmed(saved, chat.id, install)) throw new Error("PocketRisu에서 슬롯 저장을 확인하지 못했어요. 채팅을 다시 열어 상태를 확인해 주세요.");
    await assertHostSelection(characterIndex, chatIndex);
    if (state.current?.chatId === chat.id) state.current!.pocketSlotEnabled = install;
    return install;
  });
}

/** Dashboard/status identity: no source decoding, hashing, lore or all-bot database read. */
export async function readDashboardContext(state: RuntimeState): Promise<DashboardContext> {
  const generation = state.mainGeneration;
  const { characterIndex, character, chatIndex, chat, chatId, rawChat } = await readCurrentChatIdentity();
  const database = await risuai.getDatabase(["personas", "selectedPersona"]);
  await assertHostSelection(characterIndex, chatIndex);
  if (state.current?.chatId !== chatId) {
    state.statusSummary = undefined;
    state.lastPrepare = undefined;
    state.chatOpen = undefined;
    state.lineageOperation = undefined;
    state.activityReady = false;
  }
  state.hostChatIdentity = { characterIndex, chatIndex, chatId };
  generation?.observe(chatId, chat);
  const identity = chatIdentityFields(characterIndex, character, chatIndex, chat);
  let installed = pocketSlotEnabled(chat);
  const enabled = isChatMemoryEnabled(state.settings, chatId, identity.characterId);
  if (rawChat?.id && risuai.setChatToIndex && !state.mainRequest?.preparing && !state.activeModelRequest
    && (!slotWriteConfirmed(rawChat, chatId, enabled) || (enabled && !hasRecentPocketSlot(rawChat)))) {
    try { installed = await syncCurrentPocketSlot(state, chatId, identity.characterId); }
    catch { addLog(state.logs, "warn", "Could not reconcile the active chat's memory slot"); }
    await assertHostSelection(characterIndex, chatIndex);
  }
  const characterName = String(character?.name ?? "Character");
  const messages = Array.isArray(chat.message) ? chat.message : [];
  const allBefore = messages.reduce((last: number, message: any, index: number) => message?.disabled === "allBefore" ? index : last, -1);
  const messageVisibility = messages.map((message: any, ordinal: number) => ({
    id: String(message?.chatId ?? message?.id ?? `${chatId}:${ordinal}`), ordinal,
    visibility: hostVisibility(messages, ordinal, allBefore), role: messageRole(message),
  }));
  const scopeKey = serverScopeKey(state.settings, chatId);
  const context: DashboardContext = {
    pocketSlotEnabled: installed,
    ...identity, chatId, characterName, hostIdentity: !chat.id ? { kind: 'position', listFingerprint: '' } : undefined,
    identityHints: { userPersonaName: resolveUserPersonaName(database, chat), hostCharacterName: characterName, recentSpeakerNames: [], cachedPerspectives: [] },
    narrationViewpoint: state.settings.narrationViewpoint[chatId] || undefined,
    profile: state.settings.profiles[chatId] ?? state.settings.defaultProfile,
    includeUserMessages: state.settings.includeUserMessages[chatId] ?? true,
    memoryOnlyInjection: state.settings.memoryOnlyInjection[chatId] ?? false,
    upcomingOccasions: state.settings.upcomingOccasions[chatId] ?? true,
    pairProgress: state.settings.pairProgress[chatId] ?? false,
    sourceProtectionTurns: state.settings.sourceProtectionTurns, editProtectionTurns: state.settings.editProtectionTurns,
    canonicalizationPolicy: state.settings.canonicalizationPolicy,
    extractionGroupTurns: state.settings.extractionGroupTurns[chatId] ?? 6,
    memoryLanguage: state.settings.memoryLanguages[chatId] ?? "en",
    sourceMessageCount: messages.length, sourceActiveMessageCount: messageVisibility.filter((item: any) => item.visibility === "active").length,
    sourceMessageTimes: messages.flatMap((message: any, ordinal: number) => typeof message?.time === "number" && Number.isFinite(message.time) && message.time > 0
      ? [{ id: String(message.chatId ?? message.id ?? `${chatId}:${ordinal}`), ordinal, time: message.time }] : []),
    messageVisibility, serverInstanceId: state.settings.serverInstances[state.settings.serverUrl.replace(/\/$/, "")],
    backfillApproved: scopeKey ? state.settings.backfillApproved[scopeKey] === true : false, postExtractionReview: state.settings.postExtractionReview,
  };
  // Preserve a full source snapshot for source-dependent actions until they explicitly refresh it.
  state.current = state.current?.chatId === chatId && "snapshot" in state.current ? { ...state.current, ...context } : context;
  state.refreshStatusWidget?.();
  return context;
}

export async function readOptionalDashboardContext(state: RuntimeState): Promise<{ context?: DashboardContext | CurrentContext; error?: string }> {
  const previous = state.current;
  try { return { context: await readDashboardContext(state) }; }
  catch (error) {
    if (isNoActiveChatError(error) && state.current === previous && await risuai.getCurrentCharacterIndex().catch(() => 0) < 0) state.current = undefined;
    state.refreshStatusWidget?.();
    return isNoActiveChatError(error) ? {} : { error: String(error) };
  }
}

/** Complete, stable IDs only: absent metadata must never imply host deletion. */
export async function readCurrentChatPresence(): Promise<{ chatId: string; chatTitle?: string; inventory?: { characterId: string; chatIds: string[] } }> {
  const { character, chatId, chat, chatIndex, characterIndex } = await readCurrentChatIdentity();
  const {chatTitle} = chatIdentityFields(characterIndex,character,chatIndex,chat);
  const characterId = character.chaId ?? character.id;
  const chats = character.chats;
  if (typeof characterId !== "string" || !characterId || !Array.isArray(chats)
    || chats.some(chat => typeof chat?.id !== "string" || !chat.id)) return { chatId, chatTitle };
  const chatIds = chats.map(chat => chat.id as string);
  if (!chatIds.includes(chatId) || new Set(chatIds).size !== chatIds.length) return { chatId, chatTitle };
  return { chatId, chatTitle, inventory: { characterId, chatIds } };
}

export async function readCurrentChatId(state?: RuntimeState, timing?: ChatScopeTiming, expected?: HostChatSnapshot): Promise<string> {
  return (await readCurrentChatScope(state, timing, expected)).chatId;
}

/** Current V3 hosts expose indices, but no message-free stable chat ID API.
 * Once a request owns a stable identity, re-read only its chat, not the entire
 * character. ID-less/legacy snapshots retain the full identity fallback.
 */
export async function readCurrentChatScope(state?: RuntimeState, timing?: ChatScopeTiming, expected?: HostChatSnapshot): Promise<{ chatId: string; characterId: string; hostSnapshot: HostChatSnapshot }> {
  const startedAt = timing ? performance.now() : 0;
  const generation = state?.mainGeneration;
  let hostSnapshot: HostChatSnapshot;
  if (expected?.chat.id) {
    await assertHostSelection(expected.characterIndex, expected.chatIndex);
    if (timing) timing.fullHostChatReads += 1;
    const rawChat = await risuai.getChatFromIndex(expected.characterIndex, expected.chatIndex);
    const chat = storyChat(rawChat);
    if (!chat) throw new NoActiveChatError();
    if (!chat.id) throw new Error('HOST_CHAT_ID_LOADING');
    hostSnapshot = { ...expected, rawChat, chat, chatId: String(chat.id) };
  } else hostSnapshot = await readCurrentChatIdentity(!expected, timing);
  const { chatId, chat, character, characterIndex, chatIndex } = hostSnapshot;
  if (timing) timing.hostChatReadMs += performance.now() - startedAt;
  generation?.observe(chatId, chat);
  if (generation && state?.mainGeneration?.id === generation.id) {
    const hashingStartedAt = timing ? performance.now() : 0;
    const hashes = await Promise.all((Array.isArray(chat.message) ? chat.message : []).map((message: any, ordinal: number) => {
      const id = String(message?.chatId ?? message?.id ?? `${chatId}:${ordinal}`);
      return sha256(`${messageRole(message)}\0${String(message?.data ?? message?.content ?? "")}`).then(displayContentHash => ({ id, displayContentHash }));
    }));
    if (timing) timing.hashingMs += performance.now() - hashingStartedAt;
    generation.observe(chatId, chat, hashes);
  }
  if (generation || expected?.chat.id) await assertHostSelection(characterIndex, chatIndex);
  const scope = { chatId, characterId: String(character?.chaId ?? character?.id ?? characterIndex), hostSnapshot };
  if (timing) timing.totalMs += performance.now() - startedAt;
  return scope;
}

/** Read the original slot to detect a shifted index, then recheck the selection. */
export async function confirmCurrentChatScope(expected: HostChatSnapshot, timing: ChatScopeTiming): Promise<HostChatSnapshot> {
  const startedAt = performance.now();
  try {
    if (!expected.chat.id) return await readCurrentChatIdentity(false, timing);
    const { characterIndex, chatIndex } = expected;
    timing.fullHostChatReads += 1;
    const rawChat = await risuai.getChatFromIndex(characterIndex, chatIndex);
    const chat = storyChat(rawChat);
    await assertHostSelection(characterIndex, chatIndex);
    if (!chat?.id) throw new Error("HOST_SOURCE_CHANGED");
    return { ...expected, rawChat, chat, chatId: String(chat.id) };
  } finally {
    timing.hostChatReadMs += performance.now() - startedAt;
  }
}

/** Existing host snapshots only: false before headers is not a generation-end signal. */
export async function observeCurrentHostGeneration(state: RuntimeState): Promise<{ chatId: string; chat: any } | undefined> {
  const generation = state.mainGeneration;
  if (!generation) return;
  try {
    const { chatId, chat } = await readCurrentChatIdentity();
    generation.observe(chatId, chat);
    if (state.mainGeneration?.id === generation.id && generation.chatId === chatId) {
      // Exact source-revision checks reuse the display hash contract. Only the
      // existing source prefix is hashed; streaming output is excluded.
      const messages = Array.isArray(chat.message) ? chat.message : [];
      const hashes = await Promise.all(messages.flatMap((message: any, ordinal: number) => {
        const id = String(message?.chatId ?? message?.id ?? `${chatId}:${ordinal}`);
        if (!generation.sources?.has(id) || id === generation.outputId) return [];
        const role = messageRole(message), content = String(message?.data ?? message?.content ?? "");
        return [sha256(`${role}\0${content}`).then(displayContentHash => ({ id, displayContentHash }))];
      }));
      generation.observe(chatId, chat, hashes);
    }
    return { chatId, chat };
  } catch (error) {
    if (isNoActiveChatError(error)) generation.observe(undefined, undefined);
    // A failed host read supplies no evidence of a stop.
    return undefined;
  }
}

export async function readOptionalCurrentContext(
  state: RuntimeState,
  options: { snapshotMode?: "auto" | "full" | "tail" } = {},
): Promise<{ context?: CurrentContext; error?: string }> {
  try {
    return { context: await readCurrentContext(state, options) };
  } catch (error) {
    state.current = undefined;
    state.refreshStatusWidget?.();
    return isNoActiveChatError(error) ? {} : { error: String(error) };
  }
}

export async function readCurrentContext(
  state: RuntimeState,
  options: {
    snapshotMode?: "auto" | "full" | "tail"; timings?: ContextReadTimings;
    hostSnapshot?: HostChatSnapshot; sourceInputs?: ReturnType<typeof readMessageSourceInputs>;
    sourceReceipt?: ReturnType<typeof cachedSourceReceipt>; metadata?: Awaited<ReturnType<typeof readContextMetadata>>;
  } = {},
): Promise<CurrentContext> {
  const timing = options.timings;
  const startedAt = timing ? performance.now() : 0;
  if (timing) timing.count += 1;
  const generation = state.mainGeneration;
  const serverUrl = state.settings.serverUrl;
  const receiptChatId = options.hostSnapshot?.chatId ?? state.current?.chatId;
  // Capture before any host await: an older host read must not acquire a newer receipt.
  const receipt = options.hostSnapshot ? options.sourceReceipt : receiptChatId ? cachedSourceReceipt(state.settings, receiptChatId) : undefined;
  // PocketRisu may throw inside getCurrentChatIndex() while its home screen has
  // no selected character. Resolve the character first so that this normal UI
  // state does not masquerade as a server failure in callers such as Dashboard.
  const hostReadStartedAt = timing ? performance.now() : 0;
  // The injection caller will confirm this snapshot at its delivery boundary.
  const { characterIndex, character, chatIndex, chat, chatId } = options.hostSnapshot ?? await readCurrentChatIdentity();
  if (timing) timing.hostChatReadMs += performance.now() - hostReadStartedAt;
  const sourceHead = chatId === receiptChatId ? receipt : undefined;
  assertCompleteHostChat(chat);
  const descriptor = character?.chats?.[chatIndex];
  const comparisonStartedAt = timing ? performance.now() : 0;
  if (descriptor && descriptor !== options.hostSnapshot?.rawChat && !descriptor._placeholder && Array.isArray(descriptor.message) && descriptor.message !== chat.message
    && !sameHostFields(storyChat(descriptor).message, chat.message)) throw new Error('HOST_SOURCE_CHANGED');
  if (timing) timing.descriptorComparisonMs += performance.now() - comparisonStartedAt;
  const loreDatabaseStartedAt = timing ? performance.now() : 0;
  const [lore, database] = options.metadata ?? await readContextMetadata();
  if (timing) timing.loreDatabaseReadMs += performance.now() - loreDatabaseStartedAt;
  const { characterId, chatTitle, chatTitles } = chatIdentityFields(characterIndex, character, chatIndex, chat);
  const messages = Array.isArray(chat.message) ? chat.message : [];
  const lineageHint = parseBranchLineageHint(messages);
  const resolutionStartedAt = timing ? performance.now() : 0;
  const sourceInputs = options.sourceInputs ?? readMessageSourceInputs(chat);
  const messageSources = await Promise.all(sourceInputs.map(source => resolveSourceInput(source.display, source.yumiId, source.yumiRecord)));
  if (timing) timing.messageSourceResolutionMs += performance.now() - resolutionStartedAt;
  let sourceChars = 0;
  const messageContents = messageSources.map((source) => {
    if (timing) sourceChars += source.content.length;
    return source.content;
  });
  const visibilityStartedAt = timing ? performance.now() : 0;
  const sourceProjection = await sourceMessageProjection(chatId, messages, messageSources, state.settings.canonicalizationPolicy);
  const messageVisibility = sourceProjection.map(source => source.visibility);
  const messageTokens = messageContents.map(estimateTokens);
  let sourceActiveMessageCount = 0;
  let estimatedSourceTokens = 0;
  for (let ordinal = 0; ordinal < messages.length; ordinal += 1) {
    if (messageVisibility[ordinal]?.visibility !== "active") continue;
    sourceActiveMessageCount += 1;
    estimatedSourceTokens += messageTokens[ordinal]!;
  }
  const requestedMode = options.snapshotMode ?? "auto";
  const snapshotScope: "full" | "tail" = requestedMode === "full"
    ? "full"
    : requestedMode === "tail"
      ? "tail"
      : messages.length <= LARGE_CHAT_MESSAGE_LIMIT && estimatedSourceTokens <= LARGE_CHAT_TOKEN_LIMIT ? "full" : "tail";
  let startOrdinal = 0;
  if (snapshotScope === "tail") {
    startOrdinal = selectTailStart(messageTokens, TAIL_MESSAGE_LIMIT, TAIL_TOKEN_LIMIT);
  }
  if (timing) {
    timing.visibilityMs += performance.now() - visibilityStartedAt;
    // A full catch-up read replaces sizes, while durations/count accumulate.
    timing.messageCount = messages.length;
    timing.sourceChars = sourceChars;
    timing.estimatedSourceTokens = estimatedSourceTokens;
  }
  const snapshot: CurrentContext["snapshot"] = messages.slice(startOrdinal).map((message: any, localOrdinal: number) => {
    const ordinal = startOrdinal + localOrdinal;
    const content = messageContents[ordinal] ?? "";
    const explicitId = message?.chatId ?? message?.id;
    return {
      id: String(explicitId ?? `${chatId}:${ordinal}`),
      role: messageRole(message),
      content,
      ordinal,
      time: typeof message?.time === "number" ? message.time : undefined,
      generationId: message?.generationInfo?.generationId ? String(message.generationInfo.generationId) : undefined,
      sourceKind: messageSources[ordinal]?.sourceKind ?? "risu_display",
      disabled: ["disabled", "comment"].includes(messageVisibility[ordinal]?.visibility ?? "active"),
    };
  });
  const loreProjection = (Array.isArray(lore) ? lore : []).map((entry: any) => ({
    title: String(entry?.name ?? entry?.title ?? entry?.key ?? ""),
    content: loreContent(entry),
  }));
  const characterName = String(character?.name ?? "Character");
  const userPersonaName = resolveUserPersonaName(database, chat);
  // V3 characters is an indexed array on all supported hosts. Preserve the
  // existing indexed saying lookup; UUID saying values never matched it.
  const speakerIndexes = [...new Set<number>(messages.slice(-12).flatMap((message: any) => {
    const saying = message?.saying;
    const index = typeof saying === "string" && saying !== "" ? Number(saying) : -1;
    return Number.isSafeInteger(index) && index >= 0 && String(index) === saying ? [index] : [];
  }))];
  const hostCharacters: Record<string, any> = { [characterIndex]: character };
  const otherIndexes = speakerIndexes.filter(index => index !== characterIndex);
  if (otherIndexes.length) {
    const namesStartedAt = timing ? performance.now() : 0;
    if (risuai.getCharacterFromIndex) {
      try {
        const speakers = await Promise.all(otherIndexes.map(async index => [index, await risuai.getCharacterFromIndex!(index)] as const));
        for (const [index, speaker] of speakers) hostCharacters[index] = speaker;
      } catch {
        // V3's RPC proxy can expose a function for an unsupported method.
        Object.assign(hostCharacters, (await risuai.getDatabase(["characters"]))?.characters ?? {});
      }
    } else Object.assign(hostCharacters, (await risuai.getDatabase(["characters"]))?.characters ?? {});
    if (timing) timing.loreDatabaseReadMs += performance.now() - namesStartedAt;
  }
  const recentSpeakerNames: string[] = [...new Set<string>(messages.slice(-12).flatMap((message: any): string[] => {
    const explicit = typeof message?.name === "string" ? message.name.trim() : "";
    const saying = typeof message?.saying === "string" ? message.saying : "";
    const resolved = saying && hostCharacters[saying] ? String(hostCharacters[saying]?.name ?? "").trim() : "";
    return [explicit, resolved].filter(Boolean);
  }))].slice(0, 12);
  const scopeKey = serverScopeKey(state.settings, chatId);
  const description = String(character?.desc ?? character?.description ?? character?.personality ?? "");
  const staticProjection = {
    hash: await sha256(JSON.stringify({ characterName, description, lore: loreProjection })),
    characterName,
  };
  const canonicalSnapshot = snapshot.map((message) => ({
    ...message,
    content: sourceProjection[message.ordinal]!.canonicalContent,
  }));
  // Exclusion belongs to the server. Send IDs, never a precombined source query
  // that the server could no longer separate into allowed/excluded messages.
  const querySources = canonicalSnapshot.filter(message => !message.disabled && message.role !== "system").slice(-512);
  const querySignals: SearchQuerySignal[] = [{ kind: "focus", text: "continue", weight: 1, sourceMessageIds: querySources.map(message => message.id) }];
  const query = "continue";
  const querySourceHash = await sha256(JSON.stringify(querySources.map(message => [message.id, message.role, message.content])));
  const context: CurrentContext = {
    pocketSlotEnabled: pocketSlotEnabled(chat),
    hostIdentity: !chat.id ? { kind: 'position', listFingerprint: '' } : undefined,
    chatId,
    chatTitle,
    chatTitles,
    characterId,
    characterName,
    narrationViewpoint: state.settings.narrationViewpoint[chatId] || undefined,
    identityHints: { userPersonaName, hostCharacterName: characterName, recentSpeakerNames, cachedPerspectives: [] },
    chat,
    profile: state.settings.profiles[chatId] ?? state.settings.defaultProfile,
    includeUserMessages: state.settings.includeUserMessages[chatId] ?? true,
    memoryOnlyInjection: state.settings.memoryOnlyInjection[chatId] ?? false,
    upcomingOccasions: state.settings.upcomingOccasions[chatId] ?? true,
    pairProgress: state.settings.pairProgress[chatId] ?? false,
    sourceProtectionTurns: Math.min(20, Math.max(1, Math.round(state.settings.sourceProtectionTurns ?? 10))),
    editProtectionTurns: Math.min(5, Math.max(1, Math.round(state.settings.editProtectionTurns ?? 2))),
    canonicalizationPolicy: state.settings.canonicalizationPolicy,
    extractionGroupTurns: Math.min(50, Math.max(1, Math.round(state.settings.extractionGroupTurns[chatId] ?? 6))),
    memoryLanguage: state.settings.memoryLanguages[chatId] ?? "en",
    sourceMessageCount: messages.length,
    sourceActiveMessageCount,
    estimatedSourceTokens,
    snapshotScope,
    snapshot,
    messageVisibility,
    lineageHint,
    staticProjection,
    query,
    querySourceHash,
    querySignals,
    serverInstanceId: state.settings.serverInstances[state.settings.serverUrl.replace(/\/$/, "")],
    backfillApproved: scopeKey ? state.settings.backfillApproved[scopeKey] === true : false,
    postExtractionReview: state.settings.postExtractionReview,
  };
  // A destructive re-check uses another full read; normal turns use the host's full-read contract.
  if (options.snapshotMode === 'full' && !options.hostSnapshot) {
    const recheckStartedAt = timing ? performance.now() : 0;
    const latest = storyChat(await risuai.getChatFromIndex(characterIndex, chatIndex));
    if (timing) timing.hostChatReadMs += performance.now() - recheckStartedAt;
    assertCompleteHostChat(latest);
    const recheckComparisonStartedAt = timing ? performance.now() : 0;
    if (String(latest.id || `${context.characterId}:${chatIndex}`) !== chatId
      || !sameHostFields(latest.message, chat.message)
      || !sameMessageSourceInputs(sourceInputs, latest)) throw new Error('HOST_SOURCE_CHANGED');
    if (timing) timing.descriptorComparisonMs += performance.now() - recheckComparisonStartedAt;
  }
  context.sourceSnapshot = { baseRevision: sourceHead?.sourceRevision ?? 0, baseInventory: sourceHead?.sourceInventory, complete: true, messageCount: messages.length };
  if (!chat.id) context.hostIdentity = { kind: 'position', listFingerprint: Array.isArray(character.chats) ? await sha256(JSON.stringify(character.chats.map((item: any) => [item?.id ?? null, item?.name ?? item?.title ?? '']))) : '' };
  await assertHostSelection(characterIndex, chatIndex);
  if (state.settings.serverUrl !== serverUrl) throw new Error('SERVER_SCOPE_CHANGED');
  if (options.hostSnapshot && generation && state.mainGeneration?.id !== generation.id) throw new Error('HOST_GENERATION_CHANGED');
  state.hostChatIdentity = { characterIndex, chatIndex, chatId };
  generation?.observe(chatId, chat, messageVisibility);
  state.current = context;
  state.refreshStatusWidget?.();
  if (timing) timing.totalMs += performance.now() - startedAt;
  return context;
}

export function makePrepareRequest(
  context: CurrentContext,
  tokenBudget: number,
  options: { forceBackfill?: boolean; deferExtraction?: boolean; promptSourceMessageIds?: string[]; resolvedSetup?: ResolvedSetupProjection; memoryReferenceMode?: "short" | "none"; memoryGeneration?: string; extractionReviewOverride?: boolean; traceContext?: TurnPrepareRequest["traceContext"]; memoryBudgetPreset?: TurnPrepareRequest["memoryBudgetPreset"] } = {},
): TurnPrepareRequest {
  return {
    chatId: context.chatId,
    chatTitle: context.chatTitle,
    characterId: context.characterId,
    profile: context.profile,
    includeUserMessages: context.includeUserMessages,
    memoryOnlyInjection: context.memoryOnlyInjection ?? false,
    upcomingOccasions: context.upcomingOccasions ?? true,
    pairProgress: context.pairProgress ?? false,
    extractionGroupTurns: context.extractionGroupTurns,
    editProtectionTurns: context.editProtectionTurns ?? 2,
    canonicalizationPolicy: context.canonicalizationPolicy,
    memoryLanguage: context.memoryLanguage,
    promptSourceMessageIds: [...new Set(options.promptSourceMessageIds ?? [])].slice(-512),
    memoryReferenceMode: options.memoryReferenceMode ?? "short",
    memoryGeneration: options.memoryGeneration,
    messages: context.snapshot,
    sourceSnapshot: context.sourceSnapshot,
    hostIdentity: context.hostIdentity,
    messageVisibility: context.messageVisibility ?? context.snapshot.map((message) => ({ id: message.id, ordinal: message.ordinal, visibility: message.disabled ? "disabled" : "active" })),
    lineageHint: context.lineageHint,
    query: context.query,
    querySignals: context.querySignals,
    serverInstanceId: context.serverInstanceId,
    backfillApproved: context.backfillApproved,
    perspectives: [],
    narrationViewpoint: context.narrationViewpoint || undefined,
    identityHints: context.identityHints,
    tokenBudget,
    memoryBudgetPreset: options.memoryBudgetPreset,
    staticProjection: context.staticProjection,
    resolvedSetup: options.resolvedSetup,
    snapshotScope: context.snapshotScope,
    forceBackfill: options.forceBackfill ?? false,
    deferExtraction: options.deferExtraction ?? false,
    postExtractionReview: context.postExtractionReview ?? false,
    extractionReviewOverride: options.extractionReviewOverride,
    traceContext: options.traceContext,
  };
}

/** Final PocketRisu setup after active lorebook selection and CBS/toggle rendering. */
export async function resolvedSetupProjection(messages: OpenAIChat[]): Promise<ResolvedSetupProjection | undefined> {
  const projected = messages
    .filter((message) => !message.memo && message.role !== "function")
    .map((message) => ({
      role: message.role as "system" | "user" | "assistant",
      content: message.content
        .replace(/<rp_memory_context>[\s\S]*?<\/rp_memory_context>/gi, "")
        .replace(/<rp_memory_result(?:\s[^>]*)?>[\s\S]*?<\/rp_memory_result>/gi, "")
        .replace(/\[\[RCM\]\]/g, "")
        .trim(),
    }))
    .filter((message) => message.content && message.content !== "[Start a new chat]");
  if (projected.length === 0) return undefined;
  return { fingerprint: await sha256(JSON.stringify(projected)), messages: projected };
}

/** Memo IDs visible in the configured recent source-turn window. */
export function protectedPromptSourceMessageIds(messages: OpenAIChat[], sourceProtectionTurns = 10): string[] {
  const turns: Array<{ indices: number[]; completed: boolean }> = [];
  let current: number[] = [];
  let hasAssistant = false;
  const finishTurn = () => {
    if (current.length > 0) turns.push({ indices: current, completed: hasAssistant });
    current = [];
    hasAssistant = false;
  };
  messages.forEach((message, index) => {
    if (message.role === "system") return;
    if (message.role === "function") return;
    if (message.role === "user" && current.length > 0 && hasAssistant) finishTurn();
    current.push(index);
    if (message.role === "assistant") hasAssistant = true;
  });
  finishTurn();

  const selectedIndices = [
    ...turns.filter((turn) => turn.completed).slice(-Math.max(1, sourceProtectionTurns)),
    ...turns.filter((turn) => !turn.completed),
  ].flatMap((turn) => turn.indices);
  return selectedIndices
    .flatMap((index) => typeof messages[index]?.memo === "string" && messages[index]!.memo!.trim() && messages[index]!.content.trim()
      ? [messages[index]!.memo!.trim()]
      : [])
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(-512);
}

export interface InjectionResult {
  messages: OpenAIChat[];
  /** Exact rooted memory payload placed in the outgoing request. */
  packet: string;
  injectedTokens: number;
  removedTokens: number;
  omitted: boolean;
  omissionReason?: "marker_absent" | "empty_packet" | "injection_budget";
}

const MEMORY_CONTEXT_PATTERN = /<rp_memory_context(?:\s[^>]*)?>[\s\S]*?<\/rp_memory_context>/gi;

export function inspectMemoryPrompt(messages: OpenAIChat[]): { hasMarker: boolean; contexts: string[] } {
  return {
    hasMarker: messages.some((message) => message.content.includes(MEMORY_MARKER)),
    contexts: messages.flatMap((message) => message.content.match(MEMORY_CONTEXT_PATTERN) ?? []),
  };
}

export function stripRcmPromptContent(messages: OpenAIChat[]): OpenAIChat[] {
  return messages.map(message => {
    // Native Hypa summaries may quote old prompt text verbatim.
    if (message.memo === "supaMemory" || message.memo === "hypaMemory") return message;
    const content = message.content.replace(MEMORY_CONTEXT_PATTERN, "").replaceAll(MEMORY_MARKER, "");
    return content === message.content ? message : { ...message, content };
  });
}

export function injectMemory(messages: OpenAIChat[], rawPacket: string, requestedBudget: number, hardCeiling = requestedBudget): InjectionResult {
  const source = messages.map((message) => ({ ...message }));
  const inspection = inspectMemoryPrompt(source);
  const markerIndex = source.findIndex((message) => message.content.includes(MEMORY_MARKER));
  const stripMarkers = (items: OpenAIChat[]): OpenAIChat[] => items.map((message) => ({
    ...message,
    content: message.content.replaceAll(MEMORY_MARKER, ""),
  }));
  if (inspection.contexts.length > 0) {
    const packet = inspection.contexts.join("\n");
    return {
      messages: stripMarkers(source),
      packet,
      injectedTokens: estimateTokens(packet),
      removedTokens: 0,
      omitted: false,
    };
  }
  if (markerIndex < 0) {
    return { messages, packet: "", injectedTokens: 0, removedTokens: 0, omitted: true, omissionReason: "marker_absent" };
  }
  if (requestedBudget <= 0) {
    return { messages: stripMarkers(source), packet: "", injectedTokens: 0, removedTokens: 0, omitted: true, omissionReason: "empty_packet" };
  }
  rawPacket = rawPacket.trim() ? withMemoryGuidance(rawPacket) : "";
  const boundedCeiling = Math.max(requestedBudget, hardCeiling);
  const packetTokens = rawPacket ? estimateTokens(rawPacket) : 0;
  if (packetTokens > boundedCeiling) {
    return { messages: stripMarkers(source), packet: "", injectedTokens: 0, removedTokens: 0, omitted: true, omissionReason: "injection_budget" };
  }
  if (!rawPacket) {
    return {
      messages: stripMarkers(source),
      packet: "",
      injectedTokens: 0,
      removedTokens: 0,
      omitted: true,
      omissionReason: "empty_packet",
    };
  }
  const packet = rawPacket;
  const injectedTokens = estimateTokens(packet);
  const memoryMessage: OpenAIChat = {
    role: "system",
    content: packet,
  };
  const output = source;
  const outputMarker = output.findIndex((message) => message.content.includes(MEMORY_MARKER));
  if (outputMarker >= 0) {
    output[outputMarker] = {
      ...output[outputMarker]!,
      content: output[outputMarker]!.content.replace(MEMORY_MARKER, () => memoryMessage.content).replaceAll(MEMORY_MARKER, ""),
    };
    for (let index = 0; index < output.length; index += 1) {
      if (index !== outputMarker && output[index]!.content.includes(MEMORY_MARKER)) {
        output[index] = { ...output[index]!, content: output[index]!.content.replaceAll(MEMORY_MARKER, "") };
      }
    }
  }
  return { messages: output, packet: memoryMessage.content, injectedTokens, removedTokens: 0, omitted: false };
}

const sourceRechecks = new WeakMap<RuntimeState, Promise<void>>();
export function hasHeldSourceRecheck(state: RuntimeState, chatId: string): boolean {
  const reason = cachedSourceReceipt(state.settings, chatId)?.sourceChangeHeld;
  return reason === 'stale' || reason === 'incomplete' || reason === 'proof_required';
}

export function recheckHeldSources(state: RuntimeState, client: ServerClient): void {
  const chatId = state.current?.chatId;
  if (!chatId || !hasHeldSourceRecheck(state, chatId) || sourceRechecks.has(state)) return;
  const serverUrl = state.settings.serverUrl;
  const pending = (async () => {
    const context = await readCurrentContext(state, { snapshotMode: 'full' });
    if (context.chatId !== chatId || state.settings.serverUrl !== serverUrl || state.unloaded) return;
    await client.request(`/v1/chats/${encodeURIComponent(chatId)}/source-sync`, { method: 'POST', body: JSON.stringify(makePrepareRequest(context, 0, { deferExtraction: true })) });
  })().catch(() => undefined).finally(() => sourceRechecks.delete(state));
  sourceRechecks.set(state, pending);
}

export async function syncCompleteSourceLedger(
  client: Pick<ServerClient, "request">,
  context: Awaited<ReturnType<typeof readCurrentContext>>,
  reread?: () => Promise<typeof context>,
): Promise<{ expectedSourceMessages: number; serverInstanceId: string }> {
  if (context.snapshotScope !== "full" || context.snapshot.length !== context.sourceMessageCount) {
    throw new Error(`전체 원문을 불러오지 못했어요 (${context.snapshot.length}/${context.sourceMessageCount}). 다시 시도해 주세요.`);
  }
  const result = await client.request<{sourceChangeHeld?:string;serverInstanceId?:string}>(`/v1/chats/${encodeURIComponent(context.chatId)}/source-sync`, {
    method: "POST",
    body: JSON.stringify(makePrepareRequest(context, 0, { deferExtraction: true })),
  }, 120_000);
  if (result.sourceChangeHeld === 'stale' && reread) return syncCompleteSourceLedger(client,await reread());
  if (result.sourceChangeHeld) throw new ServerRequestError('원문 확인 필요',409,'SOURCE_SNAPSHOT_HELD');
  return { expectedSourceMessages: context.sourceMessageCount, serverInstanceId: result.serverInstanceId ?? "" };
}

/** Each attempt reads the full host again, using the receipt saved by ServerClient. */
export async function syncCurrentSourceLedger(client: Pick<ServerClient,'request'>, state: RuntimeState, chatId: string,
  contextReader: typeof readCurrentContext = readCurrentContext): Promise<Awaited<ReturnType<typeof readCurrentContext>>> {
  const serverUrl=state.settings.serverUrl;
  const read = async () => {
    const context=await contextReader(state,{snapshotMode:'full'});
    if (context.chatId!==chatId || state.current?.chatId!==chatId || state.settings.serverUrl!==serverUrl) throw new Error('현재 채팅이 바뀌었어요. 다시 시도해 주세요.');
    return context;
  };
  let context=await read();
  await syncCompleteSourceLedger(client,context,async()=>context=await read());
  if (state.current?.chatId!==chatId || state.settings.serverUrl!==serverUrl) throw new Error('현재 채팅이 바뀌었어요. 다시 시도해 주세요.');
  return context;
}
