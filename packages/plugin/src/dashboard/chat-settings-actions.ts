import { MemoryBudgetPresetSchema, MAX_MEMORY_BUDGET, RCM_API_REVISION, type MemoryLanguage, type ServerWorkerStatus } from "@rcm/shared";
import { ServerClient } from "../api-client.js";
import type { DashboardData } from "../dashboard.js";
import type { PluginSettings, RuntimeState } from "../types.js";
import { isChatMemoryEnabled } from "../settings.js";
import { invalidateChatTranslations } from "../translation.js";
type FormValues = Record<string, FormDataEntryValue>;
type ChatSettingsPatch = Pick<PluginSettings, "characterEnabled" | "chatEnabled" | "chatCatchUpPending" | "includeUserMessages" | "pairProgress" | "upcomingOccasions" | "memoryOnlyInjection">;
export interface ChatSettingsChange {
  characterEnabled: boolean;
  effectiveEnabled: boolean;
  chatWasEnabled: boolean;
  includeUserMessages: boolean;
  settings: ChatSettingsPatch;
}

export interface ChatTurnLimits {
  extractionGroupTurns: number;
  sourceProtectionTurns: number;
  editProtectionTurns: number;
}

export interface ChatMemorySettings {
  perChatGroupTurns: PluginSettings["extractionGroupTurns"];
  memoryLanguage: MemoryLanguage;
  memoryLanguages: PluginSettings["memoryLanguages"];
  defaultMemoryBudget: PluginSettings["defaultMemoryBudget"];
  memoryBudgets: PluginSettings["memoryBudgets"];
}

/** Read disabled chat controls directly, just as the combined settings form does. */
export function readChatSettingsChange(state: RuntimeState, form: HTMLFormElement, formData: FormData): ChatSettingsChange {
  const includeUserMessages = formData.has("includeUserMessages");
  const characterEnabled = formData.has("characterEnabled");
  // Disabled controls are absent from FormData; keep the chat's own checked value.
  const chatEnabled = form.querySelector<HTMLInputElement>('[name="chatEnabled"]')?.checked ?? false;
  const effectiveEnabled = characterEnabled && chatEnabled;
  const characterEnabledById = { ...state.settings.characterEnabled };
  const chatEnabledById = { ...state.settings.chatEnabled };
  const catchUpPending = { ...state.settings.chatCatchUpPending };
  const chatWasEnabled = state.current ? isChatMemoryEnabled(state.settings, state.current.chatId, state.current.characterId) : false;
  if (state.current) {
    characterEnabledById[state.current.characterId] = characterEnabled;
    chatEnabledById[state.current.chatId] = chatEnabled;
    if (!chatWasEnabled && effectiveEnabled)
      catchUpPending[state.current.chatId] = true;
    if (!effectiveEnabled)
      delete catchUpPending[state.current.chatId];
  }
  const perChat = { ...state.settings.includeUserMessages };
  if (state.current)
    perChat[state.current.chatId] = includeUserMessages;
  const progressByChat = { ...state.settings.pairProgress };
  if (state.current)
    progressByChat[state.current.chatId] = formData.has("pairProgress");
  const occasionsByChat = { ...state.settings.upcomingOccasions };
  if (state.current)
    occasionsByChat[state.current.chatId] = formData.has("upcomingOccasions");
  const memoryOnlyByChat = { ...state.settings.memoryOnlyInjection };
  if (state.current)
    memoryOnlyByChat[state.current.chatId] = formData.has("memoryOnlyInjection");
  return { characterEnabled, effectiveEnabled, chatWasEnabled, includeUserMessages, settings: {
      characterEnabled: characterEnabledById, chatEnabled: chatEnabledById, chatCatchUpPending: catchUpPending,
      includeUserMessages: perChat, memoryOnlyInjection: memoryOnlyByChat, upcomingOccasions: occasionsByChat, pairProgress: progressByChat,
    } };
}

export function readChatTurnLimits(values: FormValues): ChatTurnLimits {
  const extractionGroupTurns = Math.min(50, Math.max(1, Math.round(Number(values.extractionGroupTurns ?? 6))));
  const sourceProtectionTurns = Math.min(20, Math.max(1, Math.round(Number(values.sourceProtectionTurns ?? 10))));
  const editProtectionTurns = Math.min(5, Math.max(1, Math.round(Number(values.editProtectionTurns ?? 2))));
  return { extractionGroupTurns, sourceProtectionTurns, editProtectionTurns };
}

export function readChatMemorySettings(state: RuntimeState, values: FormValues, extractionGroupTurns: number): ChatMemorySettings {
  const perChatGroupTurns = { ...state.settings.extractionGroupTurns };
  if (state.current)
    perChatGroupTurns[state.current.chatId] = extractionGroupTurns;
  const memoryLanguage = ["en", "ko", "ja", "zh"].includes(String(values.memoryLanguage)) ? String(values.memoryLanguage) as "en" | "ko" | "ja" | "zh" : "en";
  const memoryLanguages = { ...state.settings.memoryLanguages };
  if (state.current)
    memoryLanguages[state.current.chatId] = memoryLanguage;
  const readBudget = (name: string): number => {
    const value = values[name] === "custom" ? values[`${name}Custom`] : values[name];
    const parsed = MemoryBudgetPresetSchema.safeParse(Number(value));
    if (!parsed.success) throw new Error(`기억 주입량은 1–${MAX_MEMORY_BUDGET.toLocaleString()} 사이의 정수로 입력해 주세요.`);
    return parsed.data;
  };
  const defaultMemoryBudget = values.defaultMemoryBudget === undefined ? state.settings.defaultMemoryBudget : readBudget("defaultMemoryBudget");
  const memoryBudgets = { ...state.settings.memoryBudgets };
  if (state.current) {
    if (values.chatMemoryBudget === "inherit") delete memoryBudgets[state.current.chatId];
    else if (values.chatMemoryBudget !== undefined) memoryBudgets[state.current.chatId] = readBudget("chatMemoryBudget");
  }
  return { perChatGroupTurns, memoryLanguage, memoryLanguages, defaultMemoryBudget, memoryBudgets };
}

export function assertChatMemoryLanguageSupported(state: RuntimeState, memoryLanguage: MemoryLanguage, verifiedHealth: DashboardData["health"]): void {
  if (state.current && memoryLanguage !== (state.settings.memoryLanguages[state.current.chatId] ?? "en")
    && (Number(verifiedHealth?.apiRevision ?? 0) !== RCM_API_REVISION || !verifiedHealth?.capabilities?.multilingualCanonicalMemory)) {
    throw new Error("현재 RCM 서버 계약에서만 기억 정본 언어를 변경할 수 있습니다.");
  }
}

export function readChatPerspectives(state: RuntimeState, values: FormValues): PluginSettings["perspectives"] {
  const perspectives = { ...state.settings.perspectives };
  const perspectiveNames = String(values.perspectives ?? "").split(/[,\n]/).map((name) => name.trim()).filter(Boolean);
  if (state.current)
    perspectives[state.current.chatId] = [...new Set(perspectiveNames)].slice(0, 4);
  return perspectives;
}

export async function applyChatWorkSettings(state: RuntimeState, change: ChatSettingsChange, nextServerConnection: Pick<PluginSettings, "serverUrl" | "serverToken">, clearVisibleTranslations: () => void): Promise<void> {
  const { characterEnabled, effectiveEnabled, chatWasEnabled } = change;
  const { chatEnabled: chatEnabledById, chatCatchUpPending: catchUpPending } = change.settings;
  if (state.current) {
    const workClient = new ServerClient(() => ({ ...state.settings, ...nextServerConnection }));
    const characterChanged = (state.settings.characterEnabled[state.current.characterId] !== false) !== characterEnabled;
    if (characterChanged) {
      const result = await workClient.request<{
        chatIds: string[];
      }>(`/v1/characters/${encodeURIComponent(state.current.characterId)}/work`, {
        method: "PUT", body: JSON.stringify({ enabled: characterEnabled, chatEnabled: chatEnabledById, defaultChatEnabled: state.settings.defaultChatEnabled }),
      });
      for (const id of new Set([...result.chatIds, state.current.chatId])) {
        invalidateChatTranslations(id);
        if (characterEnabled && (chatEnabledById[id] ?? state.settings.defaultChatEnabled))
          catchUpPending[id] = true;
        else
          delete catchUpPending[id];
      }
      state.serverWorker = undefined;
    }
    else {
      const result = await workClient.request<{
        worker: ServerWorkerStatus;
      }>(`/v1/chats/${encodeURIComponent(state.current.chatId)}/work`, {
        method: "PUT", body: JSON.stringify({ enabled: effectiveEnabled }),
      });
      state.serverWorker = result.worker;
    }
    if (chatWasEnabled !== effectiveEnabled || characterChanged) {
      invalidateChatTranslations(state.current.chatId);
      clearVisibleTranslations();
    }
  }
}

/** Returns the disabled chat whose in-flight setup capture the caller must discard. */
export function applyCurrentChatSettings(state: RuntimeState, change: ChatSettingsChange, limits: ChatTurnLimits, memoryLanguage: MemoryLanguage): string | undefined {
  const { includeUserMessages, effectiveEnabled } = change;
  const { pairProgress: progressByChat, upcomingOccasions: occasionsByChat, memoryOnlyInjection: memoryOnlyByChat } = change.settings;
  const { extractionGroupTurns, sourceProtectionTurns, editProtectionTurns } = limits;
  if (state.current) {
    state.current.includeUserMessages = includeUserMessages;
    state.current.pairProgress = progressByChat[state.current.chatId] ?? false;
    state.current.upcomingOccasions = occasionsByChat[state.current.chatId] ?? true;
    state.current.memoryOnlyInjection = memoryOnlyByChat[state.current.chatId] ?? false;
    state.current.sourceProtectionTurns = sourceProtectionTurns;
    state.current.editProtectionTurns = editProtectionTurns;
    state.current.canonicalizationPolicy = state.settings.canonicalizationPolicy;
    state.current.extractionGroupTurns = extractionGroupTurns;
    state.current.memoryLanguage = memoryLanguage;
    state.lastPromptValidation = effectiveEnabled ? undefined : { chatId: state.current.chatId, status: "disabled", at: Date.now() };
    if (!effectiveEnabled)
      return state.current.chatId;
  }
}

export function syncChatEnabledControl(root: HTMLElement, checked: boolean): void {
  const chat = root.querySelector<HTMLInputElement>('[name="chatEnabled"]');
  if (chat)
    chat.disabled = !checked;
  const note = root.querySelector<HTMLElement>("[data-character-disabled]");
  if (note)
    note.hidden = checked;
  const usual = root.querySelector<HTMLElement>("[data-character-enabled-note]");
  if (usual)
    usual.hidden = !checked;
}

/** Keep custom fields and the inherited-budget hint in sync without rerendering a dirty form. */
export function syncMemoryBudgetControls(root: ParentNode): void {
  const common = root.querySelector<HTMLSelectElement>('[name="defaultMemoryBudget"]');
  const commonValue = Number(common?.value === "custom" ? root.querySelector<HTMLInputElement>('[name="defaultMemoryBudgetCustom"]')?.value : common?.value);
  root.querySelectorAll<HTMLElement>("[data-memory-budget]").forEach(field => {
    const select = field.querySelector<HTMLSelectElement>("select")!;
    const custom = field.querySelector<HTMLInputElement>("input")!;
    custom.hidden = select.value !== "custom";
    custom.disabled = select.disabled || custom.hidden;
    field.querySelector<HTMLElement>("small")!.hidden = !(Number(select.value === "inherit" ? commonValue : select.value === "custom" ? custom.value : select.value) > 12_000);
  });
}
