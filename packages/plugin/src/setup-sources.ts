import { estimateTokens, type ResolvedSetupProjection } from "@rcm/shared";
import { sha256 } from "./context.js";
import { addLog, isChatMemoryEnabled } from "./settings.js";
import type { RuntimeState } from "./types.js";

export interface SetupSource {
  id: string;
  name: string;
  group: string;
  folder?: string;
  folderKey?: string;
  keys: string;
  kind: "description" | "firstMessage" | "persona" | "note" | "lore";
  raw: string;
  parsed: string;
  tokens: number;
  used: boolean;
  always: boolean;
  cbs: boolean;
  defaultSelected: boolean;
  /** The greeting this chat actually opened with (Risu chat.fmIndex). */
  current?: boolean;
}
export interface SetupPicker {
  chatId: string;
  items: SetupSource[];
  selected: Set<string>;
  fallback?: "chat" | "error";
  unparsed?: boolean;
  tab: "recommended" | "all";
  query: string;
  preview?: string;
  /** Row whose parsed text is unfolded inline (narrow screens); only set by a tap. */
  peek?: string;
  /** Opened from 「초기 설정 다시 읽기」 on an established ledger. */
  reread?: boolean;
  busy?: boolean;
  error?: string;
}

// Only chat IDs and boolean flags reach plugin storage. The first two completed
// turns use boolean milestones so reloads do not reset the reminder threshold.
// Request IDs, setup materials and main-model prompts never enter this store.
const setupAttentionKey = (chatId: string, kind: string) => `rcm:setup-attention:${kind}:${encodeURIComponent(chatId)}`;
const attentionClaims = new Set<string>();
/** Both first-turn setup and chats enabled after their opening need the picker. */
export function setupPickerNeeded(status: string | undefined): boolean {
  return status === "unseeded" || status === "awaiting_setup";
}

export async function claimSetupAttention(chatId: string, kind: "opened" | "alerted", eligible = () => true): Promise<boolean> {
  const key = setupAttentionKey(chatId, kind);
  if (attentionClaims.has(key)) return false;
  attentionClaims.add(key);
  try {
    const storage = await risuai.getLocalPluginStorage();
    if (await storage.getItem<boolean>(key) === true || !eligible()) return false;
    await storage.setItem(key, true);
    if (!eligible()) { await storage.setItem(key, false); return false; }
    return true;
  } finally { attentionClaims.delete(key); }
}

export function observeSetupAttention(state: RuntimeState, chatId: string, status: string | undefined): void {
  if (!status) return;
  state.setupAttention ??= {};
  if (setupPickerNeeded(status)) state.setupAttention[chatId] ??= { completedTurns: 0 };
  else delete state.setupAttention[chatId];
}

export async function firstOpenSetupPicker(state: RuntimeState, chatId: string, status: string | undefined): Promise<SetupPicker | undefined> {
  if (!setupPickerNeeded(status)) return;
  try {
    if (await claimSetupAttention(chatId, "opened")) return await loadSetupPicker(state, chatId);
  } catch { addLog(state.logs, "warn", "설정 재료 안내를 열지 못했어요. 홈에서 다시 열 수 있어요."); }
}

/** Called only by the background committed-output sync, never awaited by a request hook. */
export function completeSetupAttentionTurn(state: RuntimeState, chatId: string, requestId: string | undefined): void {
  const waiting = state.setupAttention?.[chatId];
  if (!waiting || !requestId || waiting.lastRequestId === requestId) return;
  waiting.lastRequestId = requestId;
  waiting.counting = (waiting.counting ?? Promise.resolve()).then(async () => {
    if (state.setupAttention?.[chatId] !== waiting || state.unloaded) return;
    const storage = await risuai.getLocalPluginStorage();
    if (!waiting.completedTurns) {
      const [first, second] = await Promise.all([storage.getItem<boolean>(setupAttentionKey(chatId, "turn-1")), storage.getItem<boolean>(setupAttentionKey(chatId, "turn-2"))]);
      waiting.completedTurns = second === true ? 2 : first === true ? 1 : 0;
    }
    waiting.completedTurns += 1;
    if (waiting.completedTurns < 3) await storage.setItem(setupAttentionKey(chatId, `turn-${waiting.completedTurns}`), true);
    if (waiting.completedTurns < 3 || state.settings.statusWidgetVisible !== false) return;
    setTimeout(() => {
      const eligible = () => !state.unloaded && !state.mainGeneration && state.current?.chatId === chatId
        && isChatMemoryEnabled(state.settings, chatId) && state.settings.statusWidgetVisible === false
        && state.setupAttention?.[chatId] === waiting;
      if (!eligible() || typeof risuai.alert !== "function") return;
      void (async () => {
        if (await claimSetupAttention(chatId, "alerted", eligible)) {
          await risuai.alert!("RCM: 대시보드에서 설정 재료를 골라 주세요. 채팅은 계속할 수 있어요.");
        }
      })().catch(() => addLog(state.logs, "warn", "설정 재료 안내를 표시하지 못했어요. 홈에서 확인할 수 있어요."));
    }, 0);
  }).catch(() => addLog(state.logs, "warn", "설정 재료 안내 상태를 저장하지 못했어요. 홈에서 확인할 수 있어요."));
}
/** Delete unreleased persistent captures without reading their text or contacting a server. */
export async function cleanupSetupCaptures(state: RuntimeState): Promise<void> {
  try {
    const storage = await risuai.getLocalPluginStorage();
    for (const key of await storage.keys()) if (key.startsWith("rcm:setup-capture:")) await storage.removeItem(key);
  } catch { addLog(state.logs, "warn", "이전 설정 캡처를 지우지 못했어요. 기기 저장소를 확인해 주세요."); }
}
/** Raw main-request text is memory-only. No host reads, parsing, storage or network. */
export function captureSetupRequest(state: RuntimeState, chatId: string, projection: ResolvedSetupProjection | undefined): void {
  state.lastResolvedSetup = projection ? { chatId, projection } : undefined;
}
export function discardSetupCapture(state: RuntimeState, chatId: string): void {
  if (state.lastResolvedSetup?.chatId === chatId) state.lastResolvedSetup = undefined;
}
const normalized = (text: string): string => text.replace(/\s+/gu, " ").trim();
export function selectSetupDefaults(items: SetupSource[], capture?: ResolvedSetupProjection): SetupSource[] {
  const rendered = normalized(capture?.messages.map(item => item.content).join("\n") ?? "");
  return items.map(item => {
    const parsed = normalized(item.parsed);
    const used = Boolean(parsed && rendered.includes(parsed));
    const defaultSelected = Boolean(parsed) && (item.kind === "description" || item.kind === "persona"
      || (item.kind !== "firstMessage" && (capture ? used : item.kind === "lore" && item.always)));
    return { ...item, tokens: estimateTokens(item.parsed), used, defaultSelected };
  });
}
type Lore = { mode?: string; key?: string; secondkey?: string; comment?: string; name?: string; content?: string; folder?: string; alwaysActive?: boolean };
export function setupLoreSources(entries: Lore[], characterCount: number, chatCount: number): SetupSource[] {
  const groupAt = (index: number) => index < characterCount ? "캐릭터 로어북" : index < characterCount + chatCount ? "채팅 로어북" : "모듈";
  // Risu's owned format: folder rows have mode=folder, children reference their key.
  const folders = new Map(entries.flatMap((entry, index) => entry.mode === "folder"
    ? [[`${groupAt(index)}:${entry.key}`, entry.comment || entry.name || "폴더"] as const] : []));
  return entries.flatMap((entry, index) => entry.mode === "folder" ? [] : [{
    id: `lore-${index}`, name: entry.comment || entry.name || entry.key || "이름 없는 항목", group: groupAt(index),
    folderKey: entry.folder,
    folder: entry.folder ? folders.get(`${groupAt(index)}:${entry.folder}`) : undefined,
    keys: [entry.key, entry.secondkey].filter(Boolean).join(", "), kind: "lore" as const,
    raw: entry.content ?? "", parsed: "", tokens: 0, used: false, always: entry.alwaysActive === true,
    cbs: (entry.content ?? "").includes("{{"), defaultSelected: false,
  }]);
}
export function setupGroups(items: SetupSource[]): Array<{ key: string; group: string; folder?: string; items: SetupSource[] }> {
  const groups = new Map<string, { key: string; group: string; folder?: string; items: SetupSource[] }>();
  for (const item of items) {
    const key = encodeURIComponent(JSON.stringify([item.group, item.folderKey ?? item.folder ?? ""]));
    if (!groups.has(key)) groups.set(key, { key, group: item.group, folder: item.folder, items: [] });
    groups.get(key)!.items.push(item);
  }
  return [...groups.values()];
}
export async function setupProjection(items: SetupSource[], selected: Set<string>): Promise<ResolvedSetupProjection | undefined> {
  const headers = { description: "Character description", firstMessage: "First message", persona: "Persona", note: "Author's note", lore: "Lorebook" };
  const messages = items.filter(item => selected.has(item.id) && item.parsed.trim()).map(item => ({ role: "system" as const,
    content: `[${headers[item.kind]}${item.kind === "lore" ? `: ${item.name.replace(/\s+/gu, " ").trim() || "이름 없는 항목"}` : ""}]\n${item.parsed.trim()}` }));
  return messages.length ? { messages, fingerprint: await sha256(JSON.stringify(messages)) } : undefined;
}
export async function selectedSetupProjection(picker: SetupPicker): Promise<ResolvedSetupProjection | undefined> {
  if (picker.fallback) return undefined;
  return setupProjection(picker.items, picker.selected);
}
export async function readSetupHost(): Promise<{ character: any; chat: any; chatId: string }> {
  const characterIndex = await risuai.getCurrentCharacterIndex();
  const character = await risuai.getCharacter();
  const chatIndex = await risuai.getCurrentChatIndex();
  const chat = await risuai.getChatFromIndex(characterIndex, chatIndex);
  return { character, chat, chatId: chat ? String(chat.id ?? `${character?.chaId ?? character?.id ?? characterIndex}:${chatIndex}`) : "" };
}
async function readSetupSources(chatId: string, unparsed: boolean): Promise<SetupSource[]> {
  const host = await readSetupHost();
  if (host.chatId !== chatId) throw new Error("setup chat changed");
  const [entries, database] = await Promise.all([unparsed ? Promise.resolve([...(host.character?.globalLore ?? []), ...(host.chat?.localLore ?? [])]) : risuai.getCurrentLorebookEntries!(), risuai.getDatabase(["personas", "selectedPersona"])]);
  const personas = Array.isArray(database?.personas) ? database.personas : [];
  const persona = personas.find((item: any) => item.id === host.chat.bindedPersona)
    ?? (typeof database?.selectedPersona === "number" ? personas[database.selectedPersona] : personas.find((item: any) => item.id === database?.selectedPersona));
  const source = (id: string, name: string, group: string, kind: SetupSource["kind"], raw: string): SetupSource =>
    ({ id, name, group, kind, raw, parsed: "", keys: "", tokens: 0, used: false, always: false, cbs: raw.includes("{{"), defaultSelected: false });
  const items = [
    source("description", "설명", "캐릭터 카드", "description", String(host.character?.desc ?? "")),
    ...firstMessageSources(host.character, host.chat, source),
    source("persona", `페르소나${persona?.name ? ` · ${persona.name}` : ""}`, "나와 노트", "persona", String(persona?.personaPrompt ?? "")),
    source("note", "작가의 노트", "나와 노트", "note", String(host.chat?.note ?? "")),
    ...setupLoreSources(entries, host.character?.globalLore?.length ?? 0, host.chat?.localLore?.length ?? 0),
  ];
  // Parsing every candidate is necessary for capture matching; none are run through editprocess or variable writes.
  // Each host call is a bridge round trip; run them together so a large lorebook opens in one round trip.
  await Promise.all(items.map(async item => {
    item.parsed = item.raw && !unparsed && risuai.parseRisuChat
      ? await risuai.parseRisuChat(item.raw, { processRegex: false, runVar: false, rmVar: true }) : item.raw;
  }));
  if ((await readSetupHost()).chatId !== chatId) throw new Error("setup chat changed");
  return items;
}
/** The main greeting plus every alternate greeting, listed in card order; the one this chat used is marked. */
export function firstMessageSources(character: any, chat: any, source: (id: string, name: string, group: string, kind: SetupSource["kind"], raw: string) => SetupSource): SetupSource[] {
  const used = Number.isInteger(chat?.fmIndex) ? Number(chat.fmIndex) : -1;
  const alternates: unknown[] = Array.isArray(character?.alternateGreetings) ? character.alternateGreetings : [];
  return [
    { ...source("firstMessage", "첫 메시지", "캐릭터 카드", "firstMessage", String(character?.firstMessage ?? "")), current: used === -1 },
    ...alternates.map((text, index) => ({ ...source(`firstMessage:${index + 1}`, `추가 첫 메시지 ${index + 1}`, "캐릭터 카드", "firstMessage", String(text ?? "")), current: used === index })),
  ];
}
export async function loadSetupPicker(state: RuntimeState, chatId: string): Promise<SetupPicker> {
  const capture = state.lastResolvedSetup?.chatId === chatId ? state.lastResolvedSetup.projection : undefined;
  const picker: SetupPicker = { chatId, items: [], selected: new Set(), tab: "recommended", query: "" };
  picker.unparsed = typeof risuai.parseRisuChat !== "function" || typeof risuai.getCurrentLorebookEntries !== "function";
  try {
    if ((await readSetupHost()).chatId !== chatId) return { ...picker, fallback: "chat" };
    picker.items = selectSetupDefaults(await readSetupSources(chatId, picker.unparsed), capture);
    picker.selected = new Set(picker.items.filter(item => item.defaultSelected).map(item => item.id));
    picker.preview = picker.items.find(item => item.defaultSelected)?.id;
    return picker;
  } catch {
    return { ...picker, items: [], fallback: "error" };
  }
}
