import { withMemoryGuidance, canonicalizeSourceText, defaultCanonicalizationPolicy, sourceComparisonText, estimateTokens, selectTailStart, type CanonicalizationPolicy, type LineageProbeRequest, type MessageHostVisibility, type ResolvedSetupProjection, type SearchQuerySignal, type TurnPrepareRequest } from "@rcm/shared";
import type { CurrentContext, DashboardContext, RuntimeState } from "./types.js";
import { serverScopeKey } from "./settings.js";
import { resolveUserPersonaName } from "./persona.js";

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
      const chatId = String(descriptor.id ?? `${characterId}:${chatIndex}`);
      if (onlyChatIds && !onlyChatIds.has(chatId)) continue;
      const chat = await risuai.getChatFromIndex(characterIndex, chatIndex);
      if (!chat) throw new Error(`Risu 원문을 불러오지 못했습니다: ${String(descriptor.name ?? descriptor.title ?? chatId)}`);
      const source = Array.isArray(chat.message) ? chat.message : [];
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

async function resolveMessageSource(chat: any, message: any): Promise<ResolvedMessageSource> {
  const display = String(message?.data ?? message?.content ?? "");
  // Yumi's transport marker can precede its message metadata (including after
  // a tail replacement). The displayed record ID owns this representation;
  // never use a stale metadata ID to resolve a different response's original.
  const markerId = display.match(/<!--\s*yumi-tr:v1:([A-Za-z0-9_-]+):start\s*-->/)?.[1]
    ?? (typeof message?.__yumi_tr === "string" ? message.__yumi_tr : "");
  if (markerId) {
    const record = await decodeYumiRecord(chat?.scriptstate?.[`$__yumi_tr.${markerId}`]);
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
        // Parse Yumi's owned envelope, not arbitrary comments or prose.
        const marked = display.match(/<!--\s*yumi-tr:v1:([A-Za-z0-9_-]+):start\s*-->([\s\S]*?)<!--\s*yumi-tr:v1:\1:end\s*-->/);
        const text = marked?.[1] === id ? marked[2] : !display.includes('<!--') && message.__yumi_tr === id ? display : undefined;
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

async function readCurrentChatIdentity(): Promise<{ characterIndex: number; character: any; chatIndex: number; chat: any; chatId: string }> {
  const characterIndex = await risuai.getCurrentCharacterIndex();
  if (!Number.isInteger(characterIndex) || characterIndex < 0) throw new NoActiveChatError();
  const character = await risuai.getCharacter();
  if (!character || typeof character !== "object") throw new NoActiveChatError();
  const chatIndex = await risuai.getCurrentChatIndex();
  if (!Number.isInteger(chatIndex) || chatIndex < 0) throw new NoActiveChatError();
  const chat = await risuai.getChatFromIndex(characterIndex, chatIndex);
  if (!chat) throw new NoActiveChatError();
  const characterId = String(character?.chaId ?? character?.id ?? characterIndex);
  return { characterIndex, character, chatIndex, chat, chatId: String(chat.id ?? `${characterId}:${chatIndex}`) };
}

function chatIdentityFields(characterIndex: number, character: any, chatIndex: number, chat: any) {
  const characterId = String(character?.chaId ?? character?.id ?? characterIndex);
  const chatTitle = String(chat.name ?? chat.title ?? "").trim() || `채팅 ${chatIndex + 1}`;
  const chatTitles = Object.fromEntries((Array.isArray(character?.chats) ? character.chats : [])
    .map((item: any, index: number) => {
      const id = String(item?.id ?? `${characterId}:${index}`);
      const title = String(item?.name ?? item?.title ?? "").trim();
      return title ? [id, title] : undefined;
    })
    .filter((entry: [string, string] | undefined): entry is [string, string] => Boolean(entry)));
  return { characterId, chatTitle, chatTitles };
}

async function sourceMessageVisibility(chatId: string, messages: any[], messageSources: Awaited<ReturnType<typeof resolveMessageSource>>[], canonicalizationPolicy: CurrentContext["canonicalizationPolicy"]): Promise<NonNullable<CurrentContext["messageVisibility"]>> {
  const allBefore = messages.reduce((last: number, message: any, index: number) => message?.disabled === "allBefore" ? index : last, -1);
  return Promise.all(messages.map(async (message: any, ordinal: number) => {
    const role = messageRole(message);
    const content = messageSources[ordinal]?.content ?? "";
    const contentHash = await sha256(`${role}\0${content}`);
    const comparison = sourceComparisonText(content, canonicalizationPolicy);
    const display = String(message?.data ?? message?.content ?? "");
    const displayComparison = sourceComparisonText(display, canonicalizationPolicy);
    return {
      id: String(message?.chatId ?? message?.id ?? `${chatId}:${ordinal}`), ordinal,
      visibility: hostVisibility(messages, ordinal, allBefore), role,
      contentHash,
      comparisonHash: comparison === content ? contentHash : await sha256(`${role}\0${comparison}`),
      sourceRecordId: messageSources[ordinal]?.sourceRecordId,
      displayContentHash: await sha256(`${role}\0${display}`),
      displayComparisonHash: await sha256(`${role}\0${displayComparison}`),
    };
  }));
}

/** Only lineage needs source hashes; perform this separately from dashboard paint. */
export async function readDashboardLineageRequest(context: DashboardContext): Promise<LineageProbeRequest> {
  const { chat, chatId } = await readCurrentChatIdentity();
  if (chatId !== context.chatId) throw new Error("Dashboard chat changed");
  const messages = Array.isArray(chat.message) ? chat.message : [];
  const sources = await Promise.all(messages.map((message: any) => resolveMessageSource(chat, message)));
  return {
    chatTitle: context.chatTitle, characterId: context.characterId, profile: context.profile,
    messageVisibility: await sourceMessageVisibility(chatId, messages, sources, context.canonicalizationPolicy),
    lineageHint: parseBranchLineageHint(messages), canonicalizationPolicy: context.canonicalizationPolicy,
    includeUserMessages: context.includeUserMessages, extractionGroupTurns: context.extractionGroupTurns, memoryLanguage: context.memoryLanguage,
  };
}

/** Dashboard/status identity: no source decoding, hashing, lore or all-bot database read. */
export async function readDashboardContext(state: RuntimeState): Promise<DashboardContext> {
  const generation = state.mainGeneration;
  const { characterIndex, character, chatIndex, chat, chatId } = await readCurrentChatIdentity();
  state.hostChatIdentity = { characterIndex, chatIndex, chatId };
  generation?.observe(chatId, chat);
  const database = await risuai.getDatabase(["personas", "selectedPersona"]);
  const identity = chatIdentityFields(characterIndex, character, chatIndex, chat);
  const characterName = String(character?.name ?? "Character");
  const messages = Array.isArray(chat.message) ? chat.message : [];
  const allBefore = messages.reduce((last: number, message: any, index: number) => message?.disabled === "allBefore" ? index : last, -1);
  const messageVisibility = messages.map((message: any, ordinal: number) => ({
    id: String(message?.chatId ?? message?.id ?? `${chatId}:${ordinal}`), ordinal,
    visibility: hostVisibility(messages, ordinal, allBefore), role: messageRole(message),
  }));
  const scopeKey = serverScopeKey(state.settings, chatId);
  const perspectives = (state.settings.perspectives[chatId] ?? []).map(name => name.trim()).filter(Boolean);
  const context: DashboardContext = {
    ...identity, chatId, characterName,
    identityHints: { userPersonaName: resolveUserPersonaName(database, chat), hostCharacterName: characterName, recentSpeakerNames: [], cachedPerspectives: scopeKey ? state.settings.detectedPerspectives[scopeKey] ?? [] : [] },
    activePerspectives: [...new Set(perspectives)].slice(0, 4), perspectiveMode: perspectives.length ? "manual" : "auto",
    profile: state.settings.profiles[chatId] ?? state.settings.defaultProfile,
    includeUserMessages: state.settings.includeUserMessages[chatId] ?? true,
    memoryOnlyInjection: state.settings.memoryOnlyInjection[chatId] ?? false,
    sourceProtectionTurns: state.settings.sourceProtectionTurns, editProtectionTurns: state.settings.editProtectionTurns,
    canonicalizationPolicy: state.settings.canonicalizationPolicy,
    extractionGroupTurns: state.settings.extractionGroupTurns[chatId] ?? 6,
    memoryLanguage: state.settings.memoryLanguages[chatId] ?? "en",
    sourceMessageCount: messages.length, sourceActiveMessageCount: messageVisibility.filter((item: any) => item.visibility === "active").length,
    messageVisibility, serverInstanceId: state.settings.serverInstances[state.settings.serverUrl.replace(/\/$/, "")],
    backfillApproved: scopeKey ? state.settings.backfillApproved[scopeKey] === true : false, postExtractionReview: state.settings.postExtractionReview,
  };
  // Preserve a full source snapshot for source-dependent actions until they explicitly refresh it.
  state.current = state.current?.chatId === chatId && "snapshot" in state.current ? { ...state.current, ...context } : context;
  state.refreshStatusWidget?.();
  return context;
}

export async function readOptionalDashboardContext(state: RuntimeState): Promise<{ context?: DashboardContext | CurrentContext; error?: string }> {
  try { return { context: await readDashboardContext(state) }; }
  catch (error) {
    state.current = undefined; state.refreshStatusWidget?.();
    return isNoActiveChatError(error) ? {} : { error: String(error) };
  }
}

export async function readCurrentChatId(state?: RuntimeState): Promise<string> {
  const generation = state?.mainGeneration;
  const { chatId, chat } = await readCurrentChatIdentity();
  generation?.observe(chatId, chat);
  if (generation && state?.mainGeneration?.id === generation.id) {
    const hashes = await Promise.all((Array.isArray(chat.message) ? chat.message : []).map((message: any, ordinal: number) => {
      const id = String(message?.chatId ?? message?.id ?? `${chatId}:${ordinal}`);
      return sha256(`${messageRole(message)}\0${String(message?.data ?? message?.content ?? "")}`).then(displayContentHash => ({ id, displayContentHash }));
    }));
    generation.observe(chatId, chat, hashes);
  }
  return chatId;
}

/** Existing host snapshots only: false before headers is not a generation-end signal. */
export async function observeCurrentHostGeneration(state: RuntimeState): Promise<{ chatId: string; chat: any } | undefined> {
  const generation = state.mainGeneration;
  if (!generation) return;
  try {
    const { chatId, chat } = await readCurrentChatIdentity();
    generation.observe(chatId, chat);
    if (state.mainGeneration?.id === generation.id) {
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
  options: { snapshotMode?: "auto" | "full" | "tail" } = {},
): Promise<CurrentContext> {
  const generation = state.mainGeneration;
  // PocketRisu may throw inside getCurrentChatIndex() while its home screen has
  // no selected character. Resolve the character first so that this normal UI
  // state does not masquerade as a server failure in callers such as Dashboard.
  const { characterIndex, character, chatIndex, chat, chatId } = await readCurrentChatIdentity();
  generation?.observe(chatId, chat);
  state.hostChatIdentity = { characterIndex, chatIndex, chatId };
  const [lore, database] = await Promise.all([
    risuai.getCurrentLorebookEntries(),
    risuai.getDatabase(["personas", "selectedPersona", "characters"]),
  ]);
  const { characterId, chatTitle, chatTitles } = chatIdentityFields(characterIndex, character, chatIndex, chat);
  const messages = Array.isArray(chat.message) ? chat.message : [];
  const lineageHint = parseBranchLineageHint(messages);
  const messageSources = await Promise.all(messages.map((message: any) => resolveMessageSource(chat, message)));
  const messageContents = messageSources.map((source) => source.content);
  const allBefore = messages.reduce((last: number, message: any, index: number) => message?.disabled === "allBefore" ? index : last, -1);
  let sourceActiveMessageCount = 0;
  let estimatedSourceTokens = 0;
  for (let ordinal = 0; ordinal < messages.length; ordinal += 1) {
    const message = messages[ordinal];
    if (hostVisibility(messages, ordinal, allBefore) !== "active") continue;
    sourceActiveMessageCount += 1;
    estimatedSourceTokens += estimateTokens(messageContents[ordinal] ?? "");
  }
  const requestedMode = options.snapshotMode ?? "auto";
  const snapshotScope: "full" | "tail" = requestedMode === "full"
    ? "full"
    : requestedMode === "tail"
      ? "tail"
      : messages.length <= LARGE_CHAT_MESSAGE_LIMIT && estimatedSourceTokens <= LARGE_CHAT_TOKEN_LIMIT ? "full" : "tail";
  let startOrdinal = 0;
  if (snapshotScope === "tail") {
    startOrdinal = selectTailStart(messageContents, TAIL_MESSAGE_LIMIT, TAIL_TOKEN_LIMIT);
  }
  const messageVisibility = await sourceMessageVisibility(chatId, messages, messageSources, state.settings.canonicalizationPolicy);
  generation?.observe(chatId, chat, messageVisibility);
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
  const hostCharacters = database?.characters && typeof database.characters === "object" ? database.characters : {};
  const recentSpeakerNames: string[] = [...new Set<string>(messages.slice(-12).flatMap((message: any): string[] => {
    const explicit = typeof message?.name === "string" ? message.name.trim() : "";
    const saying = typeof message?.saying === "string" ? message.saying : "";
    const resolved = saying && hostCharacters[saying] ? String(hostCharacters[saying]?.name ?? "").trim() : "";
    return [explicit, resolved].filter(Boolean);
  }))].slice(0, 12);
  const scopeKey = serverScopeKey(state.settings, chatId);
  const configuredPerspectives = (state.settings.perspectives[chatId] ?? []).map((name) => name.trim()).filter(Boolean);
  const activePerspectives = configuredPerspectives.length > 0 ? [...new Set(configuredPerspectives)].slice(0, 4) : [];
  const cachedPerspectives = scopeKey ? state.settings.detectedPerspectives[scopeKey] ?? [] : [];
  const description = String(character?.desc ?? character?.description ?? character?.personality ?? "");
  const staticProjection = {
    hash: await sha256(JSON.stringify({ characterName, description, lore: loreProjection })),
    characterName,
    description,
    lore: loreProjection,
  };
  const canonicalSnapshot = snapshot.map((message) => ({
    ...message,
    content: canonicalizeSourceText(message.content, state.settings.canonicalizationPolicy),
  }));
  // Exclusion belongs to the server. Send IDs, never a precombined source query
  // that the server could no longer separate into allowed/excluded messages.
  const querySources = canonicalSnapshot.filter(message => !message.disabled && message.role !== "system").slice(-512);
  const querySignals: SearchQuerySignal[] = [{ kind: "focus", text: "continue", weight: 1, sourceMessageIds: querySources.map(message => message.id) }];
  const query = "continue";
  const querySourceHash = await sha256(JSON.stringify(querySources.map(message => [message.id, message.role, message.content])));
  const context: CurrentContext = {
    chatId,
    chatTitle,
    chatTitles,
    characterId,
    characterName,
    activePerspectives,
    perspectiveMode: configuredPerspectives.length > 0 ? "manual" : "auto",
    identityHints: { userPersonaName, hostCharacterName: characterName, recentSpeakerNames, cachedPerspectives },
    chat,
    profile: state.settings.profiles[chatId] ?? state.settings.defaultProfile,
    includeUserMessages: state.settings.includeUserMessages[chatId] ?? true,
    memoryOnlyInjection: state.settings.memoryOnlyInjection[chatId] ?? false,
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
  state.current = context;
  state.refreshStatusWidget?.();
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
    extractionGroupTurns: context.extractionGroupTurns,
    editProtectionTurns: context.editProtectionTurns ?? 2,
    canonicalizationPolicy: context.canonicalizationPolicy,
    memoryLanguage: context.memoryLanguage,
    promptSourceMessageIds: [...new Set(options.promptSourceMessageIds ?? [])].slice(-512),
    memoryReferenceMode: options.memoryReferenceMode ?? "short",
    memoryGeneration: options.memoryGeneration,
    messages: context.snapshot,
    messageVisibility: context.messageVisibility ?? context.snapshot.map((message) => ({ id: message.id, ordinal: message.ordinal, visibility: message.disabled ? "disabled" : "active" })),
    lineageHint: context.lineageHint,
    query: context.query,
    querySignals: context.querySignals,
    serverInstanceId: context.serverInstanceId,
    backfillApproved: context.backfillApproved,
    perspectives: context.activePerspectives,
    perspectiveMode: context.perspectiveMode,
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
  return messages.map((message) => ({
    ...message,
    content: message.content.replace(MEMORY_CONTEXT_PATTERN, "").replaceAll(MEMORY_MARKER, ""),
  }));
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
      content: output[outputMarker]!.content.replace(MEMORY_MARKER, memoryMessage.content).replaceAll(MEMORY_MARKER, ""),
    };
    for (let index = 0; index < output.length; index += 1) {
      if (index !== outputMarker && output[index]!.content.includes(MEMORY_MARKER)) {
        output[index] = { ...output[index]!, content: output[index]!.content.replaceAll(MEMORY_MARKER, "") };
      }
    }
  }
  return { messages: output, packet: memoryMessage.content, injectedTokens, removedTokens: 0, omitted: false };
}
