import { MemoryLanguageSchema, MemoryBudgetPresetSchema, MAX_MEMORY_BUDGET, RCM_API_REVISION, type MemoryLanguage, type ServerWorkerStatus } from "@rcm/shared";
import { ServerClient, ServerRequestError } from "../api-client.js";
import type { DashboardData } from "../dashboard.js";
import type { PluginSettings, RuntimeState } from "../types.js";
import { syncCurrentPocketSlot } from "../context.js";
import { isChatMemoryEnabled, saveSettings, resolveChatSetting } from "../settings.js";
import { invalidateChatTranslations } from "../translation.js";
type FormValues = Record<string, FormDataEntryValue>;
type ChatSettingsPatch = Pick<PluginSettings, "characterEnabled" | "chatEnabled" | "chatCatchUpPending" | "includeUserMessages" | "pairProgress" | "upcomingOccasions" | "memoryOnlyInjection" | "defaultChatEnabled" | "defaultIncludeUserMessages" | "defaultPairProgress" | "defaultUpcomingOccasions" | "defaultMemoryOnlyInjection">;
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
  narrationViewpoint: PluginSettings["narrationViewpoint"];
  perChatGroupTurns: PluginSettings["extractionGroupTurns"];
  memoryLanguage: MemoryLanguage;
  clearPendingMemoryLanguage: boolean;
  memoryLanguages: PluginSettings["memoryLanguages"];
  defaultMemoryBudget: PluginSettings["defaultMemoryBudget"];
  memoryBudgets: PluginSettings["memoryBudgets"];
  defaultMemoryLanguage: MemoryLanguage;
  defaultExtractionGroupTurns: number;
  defaultProfile: PluginSettings["defaultProfile"];
  profiles: PluginSettings["profiles"];
}

/** Read both scopes once; upgrade-locked controls keep their saved values. */
export function readChatSettingsChange(state: RuntimeState, form: HTMLFormElement, formData: FormData): ChatSettingsChange {
  const commonBoolean = (name: "defaultChatEnabled" | "defaultIncludeUserMessages" | "defaultPairProgress" | "defaultUpcomingOccasions" | "defaultMemoryOnlyInjection") =>
    form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.disabled ? state.settings[name] : formData.has(name);
  const common = {
    defaultChatEnabled: commonBoolean("defaultChatEnabled"),
    defaultIncludeUserMessages: commonBoolean("defaultIncludeUserMessages"),
    defaultPairProgress: commonBoolean("defaultPairProgress"),
    defaultUpcomingOccasions: commonBoolean("defaultUpcomingOccasions"),
    defaultMemoryOnlyInjection: commonBoolean("defaultMemoryOnlyInjection"),
  };
  const characterEnabled = formData.has("characterEnabled");
  const characterEnabledById = { ...state.settings.characterEnabled };
  const chatEnabledById = { ...state.settings.chatEnabled };
  const catchUpPending = { ...state.settings.chatCatchUpPending };
  const perChat = { ...state.settings.includeUserMessages };
  const progressByChat = { ...state.settings.pairProgress };
  const occasionsByChat = { ...state.settings.upcomingOccasions };
  const memoryOnlyByChat = { ...state.settings.memoryOnlyInjection };
  const put = (map: Record<string, boolean>, name: string) => {
    if (!state.current || !formData.has(name)) return; // Upgrade-locked controls preserve their entries.
    if (formData.get(name) === "inherit") delete map[state.current.chatId];
    else map[state.current.chatId] = formData.get(name) === "true";
  };
  put(chatEnabledById, "chatEnabled"); put(perChat, "includeUserMessages"); put(progressByChat, "pairProgress");
  put(occasionsByChat, "upcomingOccasions"); put(memoryOnlyByChat, "memoryOnlyInjection");
  const next = { ...state.settings, ...common, chatEnabled: chatEnabledById, includeUserMessages: perChat };
  const includeUserMessages = state.current ? resolveChatSetting(next, "includeUserMessages", state.current.chatId) : common.defaultIncludeUserMessages;
  const effectiveEnabled = characterEnabled && (state.current ? resolveChatSetting(next, "chatEnabled", state.current.chatId) : common.defaultChatEnabled);
  const chatWasEnabled = state.current ? isChatMemoryEnabled(state.settings, state.current.chatId, state.current.characterId) : false;
  if (state.current) {
    characterEnabledById[state.current.characterId] = characterEnabled;
    if (!chatWasEnabled && effectiveEnabled) catchUpPending[state.current.chatId] = true;
    if (!effectiveEnabled) delete catchUpPending[state.current.chatId];
  }
  return { characterEnabled, effectiveEnabled, chatWasEnabled, includeUserMessages, settings: {
      ...common, characterEnabled: characterEnabledById, chatEnabled: chatEnabledById, chatCatchUpPending: catchUpPending,
      includeUserMessages: perChat, memoryOnlyInjection: memoryOnlyByChat, upcomingOccasions: occasionsByChat, pairProgress: progressByChat,
    } };
}

export function readChatTurnLimits(values: FormValues): ChatTurnLimits {
  const extractionGroupTurns = Math.min(50, Math.max(1, Math.round(Number(values.extractionGroupTurns || values.defaultExtractionGroupTurns || 6))));
  const sourceProtectionTurns = Math.min(20, Math.max(1, Math.round(Number(values.sourceProtectionTurns ?? 10))));
  const editProtectionTurns = Math.min(5, Math.max(1, Math.round(Number(values.editProtectionTurns ?? 2))));
  return { extractionGroupTurns, sourceProtectionTurns, editProtectionTurns };
}

export function readChatMemorySettings(state: RuntimeState, values: FormValues, extractionGroupTurns: number): ChatMemorySettings {
  const perChatGroupTurns = { ...state.settings.extractionGroupTurns };
  const defaultExtractionGroupTurns = readChatTurnLimits({ extractionGroupTurns: values.defaultExtractionGroupTurns ?? String(state.settings.defaultExtractionGroupTurns) }).extractionGroupTurns;
  if (state.current && values.extractionGroupTurns !== undefined) {
    if (values.extractionGroupTurns === "") delete perChatGroupTurns[state.current.chatId];
    else perChatGroupTurns[state.current.chatId] = extractionGroupTurns;
  }
  const defaultMemoryLanguage = MemoryLanguageSchema.safeParse(values.defaultMemoryLanguage).data ?? state.settings.defaultMemoryLanguage;
  const memoryLanguages = { ...state.settings.memoryLanguages };
  if (state.current && values.memoryLanguage !== undefined) {
    if (values.memoryLanguage === "inherit") delete memoryLanguages[state.current.chatId];
    else if (values.memoryLanguage !== values.memoryLanguageServerValue) {
      const parsed = MemoryLanguageSchema.safeParse(values.memoryLanguage);
      if (parsed.success) memoryLanguages[state.current.chatId] = parsed.data;
    }
  }
  const memoryLanguage = state.current ? memoryLanguages[state.current.chatId] ?? defaultMemoryLanguage : defaultMemoryLanguage;
  const defaultProfile = values.defaultProfile === "simulation" ? "simulation" : values.defaultProfile === "companion" ? "companion" : state.settings.defaultProfile;
  const profiles = { ...state.settings.profiles };
  if (state.current && values.profile !== undefined) {
    if (values.profile === "inherit") delete profiles[state.current.chatId];
    else if (values.profile === "companion" || values.profile === "simulation") profiles[state.current.chatId] = values.profile;
  }
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
  const narrationViewpoint = { ...state.settings.narrationViewpoint };
  if (state.current && values.narrationViewpoint !== undefined && values.narrationViewpointChanged === "true")
    narrationViewpoint[state.current.chatId] = String(values.narrationViewpoint).trim();
  const clearPendingMemoryLanguage = values.memoryLanguage === "inherit" &&
    (values.clearPendingMemoryLanguage === "true" || Boolean(state.current && Object.hasOwn(state.settings.memoryLanguages, state.current.chatId)));
  return { narrationViewpoint, perChatGroupTurns, memoryLanguage, clearPendingMemoryLanguage, memoryLanguages, defaultMemoryBudget, memoryBudgets, defaultMemoryLanguage, defaultExtractionGroupTurns, defaultProfile, profiles };
}

export function assertChatMemoryLanguageSupported(state: RuntimeState, memoryLanguage: MemoryLanguage, verifiedHealth: DashboardData["health"]): void {
  if (state.current && memoryLanguage !== resolveChatSetting(state.settings, "memoryLanguages", state.current.chatId)
    && (Number(verifiedHealth?.apiRevision ?? 0) !== RCM_API_REVISION || !verifiedHealth?.capabilities?.multilingualCanonicalMemory)) {
    throw new Error("현재 RCM 서버 계약에서만 기억 정본 언어를 변경할 수 있어요.");
  }
}

export async function applyChatWorkSettings(state: RuntimeState, change: ChatSettingsChange, nextServerConnection: Pick<PluginSettings, "serverUrl" | "serverToken">, clearVisibleTranslations: () => void, confirmCancel?: () => Promise<boolean>): Promise<void> {
  const { characterEnabled, effectiveEnabled, chatWasEnabled } = change;
  const { chatEnabled: chatEnabledById, chatCatchUpPending: catchUpPending } = change.settings;
  const workClient = new ServerClient(() => ({ ...state.settings, ...nextServerConnection }));
  const requestWork = async <T>(path:string, body:Record<string,unknown>):Promise<T> => {
    try { return await workClient.request<T>(path,{method:'PUT',body:JSON.stringify(body)}); }
    catch (error) {
      if (!(error instanceof ServerRequestError) || error.code !== 'UPGRADE_ACTIVE' || !confirmCancel) throw error;
      if (!await confirmCancel()) throw new Error('기억 끄기를 취소했어요.');
      return workClient.request<T>(path,{method:'PUT',body:JSON.stringify({...body,cancelUpgrade:true})});
    }
  };
  const current = state.current;
  const characterChanged = !!current && (state.settings.characterEnabled[current.characterId] !== false) !== characterEnabled;
  if (state.settings.defaultChatEnabled !== change.settings.defaultChatEnabled) {
    const applied = await requestWork<{chatEnabled:Record<string,boolean>}>("/v1/admin/chat-work", {
      defaultChatEnabled:change.settings.defaultChatEnabled, chatEnabled:chatEnabledById, characterEnabled:change.settings.characterEnabled,
      current:current && {chatId:current.chatId,characterId:current.characterId,characterChanged,
        chatChanged:state.settings.chatEnabled[current.chatId] !== chatEnabledById[current.chatId]},
    });
    for (const [id, enabled] of Object.entries(applied.chatEnabled)) {
      invalidateChatTranslations(id);
      if (id === current?.chatId && !characterChanged) continue; // The form already updated this chat's catch-up state.
      if (enabled) catchUpPending[id] = true;
      else delete catchUpPending[id];
    }
    if (current && (chatWasEnabled !== effectiveEnabled || characterChanged)) clearVisibleTranslations();
    state.serverWorker = undefined;
    return;
  }
  if (state.current) {
    if (characterChanged) {
      const result = await requestWork<{
        chatIds: string[];
      }>(`/v1/characters/${encodeURIComponent(state.current.characterId)}/work`, {
        enabled: characterEnabled, chatEnabled: chatEnabledById, defaultChatEnabled: change.settings.defaultChatEnabled,
      });
      for (const id of new Set([...result.chatIds, state.current.chatId])) {
        invalidateChatTranslations(id);
        if (characterEnabled && resolveChatSetting({ ...state.settings, ...change.settings }, "chatEnabled", id))
          catchUpPending[id] = true;
        else
          delete catchUpPending[id];
      }
      state.serverWorker = undefined;
    }
    else {
      const result = await requestWork<{
        worker: ServerWorkerStatus;
      }>(`/v1/chats/${encodeURIComponent(state.current.chatId)}/work`, {
        enabled: effectiveEnabled,
      });
      state.serverWorker = result.worker;
    }
    if (chatWasEnabled !== effectiveEnabled || characterChanged) {
      invalidateChatTranslations(state.current.chatId);
      clearVisibleTranslations();
    }
  }
}

export async function saveChatEnableSettings(state: RuntimeState, chatId: string | undefined, enabled: boolean): Promise<void> {
  await saveSettings(state.settings);
  if (chatId && state.current?.hostIdentity?.kind !== "position" && risuai.setChatToIndex) {
    if (state.current?.chatId !== chatId) throw new Error("채팅이 바뀌었어요. 설정을 다시 열어 주세요.");
    try { await syncCurrentPocketSlot(state, chatId, state.current.characterId); }
    catch (cause) { throw new Error(`RCM 사용 설정은 저장했어요. 슬롯 ${enabled ? "연결" : "정리"}를 확인하려면 해당 채팅에서 설정을 다시 저장해 주세요.`, { cause }); }
  }
}

/** Returns the disabled chat whose in-flight setup capture the caller must discard. */
export function applyCurrentChatSettings(state: RuntimeState, change: ChatSettingsChange, limits: ChatTurnLimits, memoryLanguage: MemoryLanguage): string | undefined {
  const { includeUserMessages, effectiveEnabled } = change;
  const { extractionGroupTurns, sourceProtectionTurns, editProtectionTurns } = limits;
  if (state.current) {
    state.current.includeUserMessages = includeUserMessages;
    state.current.pairProgress = resolveChatSetting(state.settings, "pairProgress", state.current.chatId);
    state.current.upcomingOccasions = resolveChatSetting(state.settings, "upcomingOccasions", state.current.chatId);
    state.current.memoryOnlyInjection = resolveChatSetting(state.settings, "memoryOnlyInjection", state.current.chatId);
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
  const chat = root.querySelector<HTMLInputElement | HTMLSelectElement>('[name="chatEnabled"]');
  if (chat)
    chat.disabled = chat instanceof HTMLSelectElement ? false : !checked;
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

/** Update scope state in-place so unsaved edits survive navigation and live status polls. */
export function syncScopedSettingsControls(root: ParentNode): void {
  let count = 0;
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-scoped-setting]").forEach(control => {
    const own = !control.disabled && control.value !== "" && control.value !== "inherit";
    if (own) count++;
    const wrap = control.closest(".scope-control");
    wrap?.classList.toggle("is-own", own); wrap?.classList.toggle("is-following", !own);
  });
  const label = root.querySelector("[data-scope-count]");
  if (label) label.textContent = `이 채팅만 따로 정한 항목 ${count}개`;
  const reset = root.querySelector<HTMLButtonElement>('[data-action="reset-scoped-settings"]');
  if (reset) reset.disabled = count === 0;
}

/** Browser-owned numeric validity distinguishes an incomplete number from an intentionally empty scope. */
export function validateSettingsNumbers(form: HTMLFormElement): void {
  form.querySelectorAll<HTMLInputElement>('[name="extractionGroupTurns"], [name="defaultExtractionGroupTurns"], [data-memory-budget] input[type="number"], [name="sourcePdfFontPt"]').forEach(input => {
    if (input.disabled || input.validity.valid) return;
    input.focus();
    const message = input.name === 'sourcePdfFontPt' ? '글자 크기는 4–10 사이의 정수로 입력해 주세요.' : input.closest("[data-memory-budget]")
      ? `기억 주입량은 1–${MAX_MEMORY_BUDGET.toLocaleString()} 사이의 정수로 입력해 주세요.`
      : "한 번에 정리할 턴은 1–50 사이의 정수로 입력해 주세요.";
    throw new Error(message);
  });
}
