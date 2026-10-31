import { formatServerError } from "../server-errors.js";
import { sanitizeDiagnosticText, type ChatLineageStatus, type ManualLineagePreview, type ManualLineagePreviewRequest } from "@rcm/shared";
import type { ServerClient } from "../api-client.js";
import type { RuntimeState } from "../types.js";
import type { DashboardData } from "../dashboard.js";
import { makePrepareRequest, readCurrentContext } from "../context.js";
import { addLog, isChatMemoryEnabled, saveSettings } from "../settings.js";
import { stopDeletedHostChatWork } from "../activity-state.js";
import { exportChatSettings } from "../backup-settings.js";
import { discardSetupCapture, loadSetupPicker, type SetupPicker } from "../setup-sources.js";
import { invalidateTranslationCache } from "../translation.js";
import { currentLineageOperation, runLineageOperation, lineageFailureMessage } from "../lineage-settings.js";
import { drainWorker } from "../worker.js";
declare const __RCM_DISTRIBUTION__: boolean;

export type HostChatInventoryItem = { characterId: string; characterName: string; chatId: string; chatTitle: string; messageCount: number };

export type HostChatInventory = {
  items: HostChatInventoryItem[];
  characterIds: Set<string>;
  completeCharacterIds: Set<string>;
  charactersComplete: boolean;
};

export type DataConfirmation = { action: "rebuild" | "delete"; chatId: string; acknowledged?: boolean };

export type DataViewState = {
  inventoryStatus: "idle" | "loading" | "ready" | "unavailable";
  inventory: HostChatInventoryItem[];
  deletedChatIds?: string[];
  inventoryPartial?: boolean;
  inventoryError?: string;
  inventoryErrorReport?: string;
  cleanupConfirmation?: string[];
  cleanupRunning?: boolean;
  cleanupResult?: string;
  cleanupErrorReport?: string;
  query: string;
  filter: "all" | "current" | "other";
  confirmation?: DataConfirmation;
  backupExportPhase?: "creating" | "downloading";
  backupExportChatId?: string;
  backupExportError?: string;
  backupExportErrorReport?: string;
};


export function withExtractionReviewOverride<T extends Record<string, unknown>>(
  payload: T,
  extractionReviewOverride: boolean,
): T & { extractionReviewOverride: boolean } {
  return { ...payload, extractionReviewOverride };
}


export async function syncCompleteSourceLedger(
  client: Pick<ServerClient, "request">,
  context: Awaited<ReturnType<typeof readCurrentContext>>,
): Promise<{ expectedSourceMessages: number; serverInstanceId: string }> {
  if (context.snapshotScope !== "full" || context.snapshot.length !== context.sourceMessageCount) {
    throw new Error(`전체 원문을 불러오지 못했습니다 (${context.snapshot.length}/${context.sourceMessageCount}). 다시 시도해 주세요.`);
  }
  await client.request(`/v1/chats/${encodeURIComponent(context.chatId)}/source-sync`, {
    method: "POST",
    body: JSON.stringify(makePrepareRequest(context, 0, { deferExtraction: true })),
  }, 120_000);
  return { expectedSourceMessages: context.sourceMessageCount, serverInstanceId: "" };
}


export async function requestBackupArchive(
  client: Pick<ServerClient, "request" | "raw">,
  state: RuntimeState,
  chatId?: string,
  contextReader: typeof readCurrentContext = readCurrentContext,
): Promise<Response> {
  if (chatId && state.current?.chatId === chatId) {
    const current = await contextReader(state, { snapshotMode: "full" });
    if (current.chatId !== chatId) throw new Error("현재 채팅이 바뀌었습니다. 다시 시도해 주세요.");
    await syncCompleteSourceLedger(client, current);
  }
  const characterId = !chatId ? undefined : state.current?.chatId === chatId ? state.current.characterId
    : (await client.request<{ items: Array<{ id: string; characterId: string }> }>("/v1/admin/chats")).items.find(chat => chat.id === chatId)?.characterId;
  if (chatId && !characterId) throw new Error("백업할 채팅의 캐릭터를 찾지 못했어요.");
  return client.raw("/v1/export", { method: "POST", body: JSON.stringify(
    chatId ? { chatId, chatSettings: exportChatSettings(state.settings, chatId, characterId!) }
      : { pluginSettings: state.settings, serverUrl: state.settings.serverUrl },
  ) }, 120_000);
}


export type MemoryTransferMode = "lineage" | "archive";

export type MemoryTransferConfirmation = { message: string; title: string; confirm: string; cancel: string };


/** Build the exact lightweight inventory used to recognize a normal Risu JSON import. */
export function manualMemoryLineageRequest(
  context: NonNullable<RuntimeState["current"]>,
  parentChatId: string,
): ManualLineagePreviewRequest {
  return {
    parentChatId,
    targetMessageInventory: context.messageVisibility ?? [],
    target: {
      chatTitle: context.chatTitle,
      characterId: context.characterId,
      characterName: context.characterName,
      profile: context.profile,
      includeUserMessages: context.includeUserMessages,
      extractionGroupTurns: context.extractionGroupTurns,
      memoryLanguage: context.memoryLanguage,
    },
  };
}


/** Only the server's explicit no-shared-ID result may fall back to archive transplant. */
export function isMissingLineageIdentityError(error: unknown): boolean {
  return String(error).includes("At least two exact message IDs are required");
}


export type MemoryTransferPreviewResult = {
  current: NonNullable<RuntimeState["current"]>;
  request: ManualLineagePreviewRequest;
  mode: MemoryTransferMode;
  preview: ManualLineagePreview;
};


/** Preview exact lineage first, then prepare a complete source ledger for the ID-less archive fallback. */
export async function previewMemoryTransfer(
  client: Pick<ServerClient, "request">,
  state: RuntimeState,
  sourceChatId: string,
  contextReader: typeof readCurrentContext = readCurrentContext,
): Promise<MemoryTransferPreviewResult> {
  let current = await contextReader(state);
  let request = manualMemoryLineageRequest(current, sourceChatId);
  try {
    const preview = await client.request<ManualLineagePreview>(`/v1/chats/${encodeURIComponent(current.chatId)}/lineage/preview`, {
      method: "POST", body: JSON.stringify(request),
    }, 30_000);
    return { current, request, mode: "lineage", preview };
  } catch (error) {
    if (!isMissingLineageIdentityError(error)) throw error;
  }
  if (current.snapshotScope !== "full" || current.snapshot.length !== current.sourceMessageCount) {
    current = await contextReader(state, { snapshotMode: "full" });
  }
  await syncCompleteSourceLedger(client, current);
  request = manualMemoryLineageRequest(current, sourceChatId);
  const preview = await client.request<ManualLineagePreview>(`/v1/chats/${encodeURIComponent(current.chatId)}/memory-transplant/preview`, {
    method: "POST", body: JSON.stringify({ sourceChatId }),
  }, 30_000);
  return { current, request, mode: "archive", preview };
}


export function transferCountSummary(counts: Record<string, number>): string {
  const relationships = counts.relationships === undefined ? `관계 변화 ${Number(counts.relationshipEvents ?? 0).toLocaleString()}건` : `관계 ${Number(counts.relationships).toLocaleString()}개`;
  return `기억 ${Number(counts.memories ?? 0).toLocaleString()}개 · ${relationships} · 세계 상태 ${(Number(counts.assertions ?? 0) + Number(counts.beliefs ?? 0)).toLocaleString()}개 · 약속 ${Number(counts.promises ?? 0).toLocaleString()}개${Number(counts.translations ?? 0) > 0 ? ` · 번역 ${Number(counts.translations).toLocaleString()}개` : ""}`;
}


export function memoryTransferConfirmation(
  preview: ManualLineagePreview,
  mode: MemoryTransferMode,
  targetActiveMessageCount: number,
): MemoryTransferConfirmation {
  const source = `${preview.parent.characterName} · ${preview.parent.chatTitle || preview.parent.chatId}`;
  const target = `${preview.target.characterName} · ${preview.target.chatTitle || preview.target.chatId}`;
  const lines = [source, `→ ${target}`, ""];
  if (mode === "lineage") {
    lines.push(
      `동일한 대화 원문 ${preview.commonMessages.toLocaleString()}/${Math.max(0, targetActiveMessageCount).toLocaleString()}개를 확인했어요.`,
      transferCountSummary(preview.inheritedCounts),
      "현재 채팅과 새 봇 설정은 유지하며, 확인한 원문은 다시 처리하지 않아요.",
      "아직 정리되지 않은 원문은 현재 채팅의 수정 보호·기억 묶음 설정에 따라 처리돼요. 가져오기 자체는 모델을 호출하지 않아요.",
    );
    if (preview.clientPrunedMessages > 0) lines.push(`현재 JSON에 없는 이전 원문 ${preview.clientPrunedMessages.toLocaleString()}개도 서버 기록에서 이어받아요.`);
  } else {
    lines.push(
      "메시지 ID로 같은 대화임을 확인하지 못했어요.",
      transferCountSummary(preview.inheritedCounts),
      "원본 기억을 독립 기록으로 가져오며, 현재 채팅 원문은 별도의 이어진 대화로 처리될 수 있어요.",
      "현재 채팅 원문은 수정 보호·기억 묶음 설정에 따라 처리돼요. 가져오기 자체는 모델을 호출하지 않아요.",
    );
  }
  if (preview.requiresReplacement) {
    lines.push("", `현재 채팅의 기존 기록(${transferCountSummary(preview.targetDerivedCounts)})은 가져올 기록으로 교체돼요.`);
  }
  if (preview.targetQueuedJobs) lines.push("", `현재 채팅의 대기 작업 ${preview.targetQueuedJobs.toLocaleString()}개를 취소하고 기억을 가져와요.`);
  return {
    message: lines.join("\n"),
    title: "기억 가져오기 확인",
    confirm: preview.requiresReplacement ? "기존 기억 교체하고 가져오기" : mode === "lineage" ? "기억 가져오기" : "독립 기록으로 가져오기",
    cancel: "취소",
  };
}


/** Start a browser download and retain the object URL until Chromium consumes it. */
export function triggerBackupDownload(
  blob: Blob,
  filename: string,
  documentRef: Pick<Document, "createElement" | "body"> = document,
  urlApi: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
  scheduleCleanup: (callback: () => void) => unknown = (callback) => setTimeout(callback, 10_000),
): void {
  const url = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  documentRef.body.append(anchor);
  anchor.click();
  scheduleCleanup(() => {
    anchor.remove();
    urlApi.revokeObjectURL(url);
  });
}


export function requireChatMemoryEnabled(state: RuntimeState, chatId: string, characterId = state.current?.chatId === chatId ? state.current.characterId : undefined): void {
  if (!isChatMemoryEnabled(state.settings, chatId, characterId)) {
    throw new Error("현재 채팅에서 RCM이 꺼져 있어 새 기억 작업을 만들 수 없습니다. Settings에서 이 채팅의 RCM을 먼저 켜세요.");
  }
}


export function clearDeletedChatState(state: RuntimeState, chatId: string, clearActivation = true): void {
  if (state.lastTurnSearches?.chatId === chatId) state.lastTurnSearches = undefined;
  for (const scope of Object.keys(state.settings.backfillApproved)) if (scope.endsWith(`:${chatId}`)) delete state.settings.backfillApproved[scope];
  if (clearActivation) {
    delete state.settings.chatEnabled[chatId];
    delete state.settings.chatCatchUpPending[chatId];
    delete state.settings.memoryLanguages[chatId];
    delete state.settings.storyOverviewBackups[chatId];
  }
  invalidateRestoredChatState(state,chatId);
  if(state.current?.chatId===chatId)state.current.backfillApproved=false;
}


export function invalidateRestoredChatState(state: RuntimeState,chatId:string):void {
  delete state.cache[chatId];
  if (state.current?.chatId === chatId) {
    state.lastPrepare = undefined;
    state.lastInjection = undefined;
    state.automaticTurnPacket = undefined;
    state.activeModelRequest = undefined;
    state.lastPromptValidation = undefined;
    state.statusSummary = { queuedJobs: 0, failedJobs: 0, pendingReviews: 0, pendingEmbeddings: 0, failedEmbeddings: 0 };
  }
}


export async function readHostChatInventory(): Promise<HostChatInventory> {
  const database = await risuai.getDatabase(["characters"]);
  if (!database || !("characters" in database)) throw new Error("Risu 채팅 목록 권한을 사용할 수 없습니다");
  const raw = database?.characters;
  if (!raw || typeof raw !== "object") throw new Error("Risu 캐릭터 목록을 읽지 못했습니다");
  const characters = Array.isArray(raw) ? raw : Object.values(raw);
  const items: HostChatInventoryItem[] = [];
  const characterIds = new Set<string>();
  const completeCharacterIds = new Set<string>();
  const duplicateCharacterIds = new Set<string>();
  let charactersComplete = true;
  for (const [index, character] of characters.entries()) {
    if (!character || typeof character !== "object") { charactersComplete = false; continue; }
    const stableId = character.chaId ?? character.id;
    const stableCharacter = typeof stableId === "string" && stableId.length > 0;
    if (!stableCharacter) charactersComplete = false;
    else {
      if (characterIds.has(stableId)) { charactersComplete = false; duplicateCharacterIds.add(stableId); }
      characterIds.add(stableId);
    }
    const characterId = String((character as any).chaId ?? (character as any).id ?? index);
    const characterName = String((character as any).name ?? characterId).trim() || characterId;
    const chats = Array.isArray((character as any).chats) ? (character as any).chats : [];
    let complete = stableCharacter && Array.isArray(character.chats);
    const chatIds = new Set<string>();
    for (const [chatIndex, chat] of chats.entries()) {
      if (!chat || typeof chat !== "object") { complete = false; continue; }
      if (typeof chat.id !== "string" || !chat.id || chatIds.has(chat.id)) complete = false;
      if (typeof chat.id === "string" && chat.id) chatIds.add(chat.id);
      const chatId = String(chat.id ?? `${characterId}:${chatIndex}`);
      let messageCount = Array.isArray((chat as any).message) ? (chat as any).message.length : 0;
      if (!messageCount) {
        try {
          const full = await risuai.getChatFromIndex(index, chatIndex);
          if (!full || full.id !== chat.id || !Array.isArray(full.message)) complete = false;
          messageCount = Array.isArray(full?.message) ? full.message.length : 0;
        } catch { complete = false; /* Keep counts already read, but never infer deletion from this character. */ }
      }
      items.push({ characterId, characterName, chatId, chatTitle: String(chat.name ?? chat.title ?? "").trim() || `채팅 ${chatIndex + 1}`, messageCount });
    }
    if (complete) completeCharacterIds.add(characterId);
  }
  for (const id of duplicateCharacterIds) completeCharacterIds.delete(id);
  return { items, characterIds, completeCharacterIds, charactersComplete };
}


export function deletedHostChats(state: RuntimeState, data: Pick<DashboardData, "adminChats">, view: DataViewState): any[] {
  const ids = new Set(view.deletedChatIds);
  return data.adminChats.filter(chat => ids.has(chat.id) && chat.id !== state.current?.chatId);
}


export async function scanDeletedHostChats(state: RuntimeState, client: Pick<ServerClient, "request">, data: Pick<DashboardData, "adminChats">, view: DataViewState): Promise<void> {
  view.deletedChatIds = [];
  view.cleanupConfirmation = undefined;
  view.cleanupResult = undefined; view.cleanupErrorReport = undefined;
  view.inventoryError = undefined; view.inventoryErrorReport = undefined;
  view.inventoryPartial = false;
  view.inventoryStatus = "loading";
  let inventory: HostChatInventory;
  try {
    inventory = await readHostChatInventory();
  } catch {
    view.inventory = [];
    view.inventoryStatus = "unavailable";
    return;
  }
  view.inventory = inventory.items;
  view.inventoryPartial = !inventory.charactersComplete || inventory.completeCharacterIds.size !== inventory.characterIds.size;
  const hostIds = new Set(inventory.items.map(item => item.chatId));
  view.deletedChatIds = data.adminChats.filter(chat => chat.id !== state.current?.chatId && !hostIds.has(chat.id)
    && (inventory.completeCharacterIds.has(chat.characterId)
      || (inventory.charactersComplete && !inventory.characterIds.has(chat.characterId)))).map(chat => chat.id);
  const failures: string[] = [];
  for (const chat of deletedHostChats(state, data, view)) {
    if (chat.id === state.current?.chatId) continue;
    try { await stopDeletedHostChatWork(state, client, chat.id); }
    catch (error) { view.inventoryErrorReport ||= formatServerError(error); failures.push(`${chat.chatTitle || chat.id}: ${sanitizeDiagnosticText(String(error))}`); }
  }
  view.inventoryError = failures.length ? `작업 중지 실패 ${failures.length}개 · ${failures.join(" · ")}. 다시 찾아 주세요.` : undefined;
  view.inventoryStatus = "ready";
}


/** The per-chat delete path is shared by individual and bulk cleanup. */
export async function deleteServerChatRecords(state: RuntimeState, client: Pick<ServerClient, "request">, chatId: string): Promise<void> {
  await client.request(`/v1/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" }, 30_000);
  await discardSetupCapture(state, chatId);
  clearDeletedChatState(state, chatId);
  await invalidateTranslationCache(state, { chatId });
  await saveSettings(state.settings);
}


export async function cleanupDeletedHostChats(state: RuntimeState, client: Pick<ServerClient, "request">, data: Pick<DashboardData, "adminChats">, view: DataViewState): Promise<void> {
  if (view.cleanupRunning || !view.cleanupConfirmation || view.inventoryStatus !== "ready") return;
  const confirmed = new Set(view.cleanupConfirmation);
  const chats = deletedHostChats(state, data, view).filter(chat => confirmed.has(chat.id));
  view.cleanupRunning = true; view.cleanupErrorReport = undefined;
  view.cleanupConfirmation = undefined;
  let deleted = 0;
  let skipped = 0;
  const failures: string[] = [];
  try {
    for (const chat of chats) {
      if (chat.id === state.current?.chatId) { skipped++; continue; }
      try {
        await deleteServerChatRecords(state, client, chat.id);
        data.adminChats = data.adminChats.filter(item => item.id !== chat.id);
        view.deletedChatIds = view.deletedChatIds?.filter(id => id !== chat.id);
        deleted++;
      } catch (error) { view.cleanupErrorReport ||= formatServerError(error); failures.push(`${chat.chatTitle || chat.id}: ${sanitizeDiagnosticText(String(error))}`); }
    }
    view.cleanupResult = `RCM 기록 ${deleted}개 정리했어요${failures.length ? ` · 실패 ${failures.length}개: ${failures.join(" · ")}` : ""}${skipped ? ` · 현재 채팅 ${skipped}개 제외` : ""}`;
  } finally { view.cleanupRunning = false; }
}


export async function setRetrievalDiagnostics(client: Pick<ServerClient, "request">, data: Pick<DashboardData, "adminChats" | "error">, chatId: string, enabled: boolean): Promise<boolean> {
  if (typeof __RCM_DISTRIBUTION__ !== "undefined" && __RCM_DISTRIBUTION__) return false;
  try {
    const result = await client.request<{ enabled: boolean }>(`/v1/admin/chats/${encodeURIComponent(chatId)}/retrieval-diagnostics`, {
      method: "PUT", body: JSON.stringify({ enabled }),
    });
    const chat = data.adminChats.find((item) => item.id === chatId);
    if (chat) chat.retrievalDiagnosticsEnabled = result.enabled;
    data.error = undefined;
    return result.enabled;
  } catch (error) {
    data.error = String(error);
    throw error;
  }
}

export const createDataView = (): DataViewState => ({ inventoryStatus: "idle", inventory: [], query: "", filter: "all" });
type RefreshData = (options?: { forceApply?: boolean }) => Promise<void>;
type ChooseReview = (title: string, detail: string, defaultEnabled: boolean) => Promise<boolean | undefined>;
type ConfirmTransfer = (message: string, fallback: boolean, options: MemoryTransferConfirmation) => Promise<boolean>;
export interface DataController {
  handleViewAction(action: string | undefined, target: HTMLElement, data: DashboardData): boolean;
  applySearch(query: string): void;
  applyFilter(value: string): void;
  acknowledgeDelete(input: HTMLInputElement): boolean;
  loadInventory(data: DashboardData, isActive: () => boolean): Promise<void>;
  cleanup(data: DashboardData): Promise<boolean>;
  exportBackup(chatId?: string): Promise<void>;
  inheritFromChat(target: HTMLElement, confirm: ConfirmTransfer, alert: (message: string) => Promise<void>, refresh: RefreshData): Promise<void>;
  confirmOperation(getData: () => DashboardData, chooseReview: ChooseReview, openInitial: (picker?: SetupPicker) => void,
    currentChatDeleted: (chatId: string) => void): Promise<{ forceApply: boolean } | undefined>;
}

/** Screen-local state and work; the dashboard owns shared reads, refreshes and errors. */
export function createDataController(state: RuntimeState, view: DataViewState, root: HTMLElement,
  render: () => void, client: ServerClient): DataController {
  return {
    handleViewAction(action, target, data) {
      if (action === "open-deleted-chat-cleanup") {
        if (view.inventoryStatus !== "ready" || view.cleanupRunning) return true;
        view.confirmation = undefined;
        view.cleanupConfirmation = deletedHostChats(state, data, view).map(chat => chat.id);
      } else if (action === "cancel-deleted-chat-cleanup") view.cleanupConfirmation = undefined;
      else if (action === "open-data-operation") {
        if (view.cleanupRunning) return true;
        view.cleanupConfirmation = undefined;
        view.confirmation = { action: target.dataset.operation as DataConfirmation["action"], chatId: target.dataset.chatId ?? "" };
      } else if (action === "cancel-data-operation") view.confirmation = undefined;
      else return false;
      render();
      return true;
    },
    applySearch(query) {
      view.query = query;
      const normalized = query.trim().toLocaleLowerCase();
      root.querySelectorAll<HTMLElement>("[data-data-row]").forEach((row) => { row.hidden = Boolean(normalized) && !row.textContent?.toLocaleLowerCase().includes(normalized); });
    },
    applyFilter(value) { view.filter = value as DataViewState["filter"]; render(); },
    acknowledgeDelete(input) {
      const confirmation = view.confirmation;
      if (input.dataset.action !== "ack-delete" || !confirmation || confirmation.chatId !== input.dataset.chatId) return false;
      confirmation.acknowledged = input.checked;
      const confirm = root.querySelector<HTMLButtonElement>('[data-action="confirm-data-operation"][data-operation="delete"]');
      if (confirm) confirm.disabled = !input.checked;
      return true;
    },
    async cleanup(data) {
      if (view.cleanupRunning) return false;
      const cleanup = cleanupDeletedHostChats(state, client, data, view);
      render();
      await cleanup;
      return true;
    },
    async loadInventory(data, isActive) {
      if (view.inventoryStatus === "loading" || view.cleanupRunning) return;
      const scan = scanDeletedHostChats(state, client, data, view);
      render();
      await scan;
      if (isActive()) render();
    },
    async exportBackup(chatId) {
      if (view.backupExportPhase) return;
      try {
        view.backupExportError = undefined; view.backupExportErrorReport = undefined;
        view.backupExportChatId=chatId;
        view.backupExportPhase = "creating"; render();
        const response = await requestBackupArchive(client, state, chatId);
        const blob = await response.blob();
        view.backupExportPhase = "downloading"; render();
        triggerBackupDownload(blob, `rcm-${chatId?`chat-${chatId.replace(/[^a-zA-Z0-9_-]/g,"_")}`:"complete"}-backup-${new Date().toISOString().slice(0, 10)}.zip`);
      } finally {
        view.backupExportPhase = undefined;
        view.backupExportChatId = undefined;
        render();
      }
    },
    async inheritFromChat(target, confirmDashboard, alertDashboard, refresh) {
      if (!state.current) return;
      if (currentLineageOperation(state)?.status === 'running') return;
      const sourceChatId = target.dataset.chatId ?? "";
      if (!sourceChatId) return;
      const button = target as HTMLButtonElement;
      const originalLabel = button.textContent ?? "현재 채팅으로 기억 가져오기";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "같은 대화인지 확인 중…";
      try {
        const { current, request, mode, preview } = await previewMemoryTransfer(client, state, sourceChatId);
        const eligibleMessages = (request.targetMessageInventory ?? []).filter((item) => item.visibility === "active" && item.role && item.contentHash).length;
        const copy = memoryTransferConfirmation(preview, mode, eligibleMessages);
        const confirmed = await confirmDashboard(copy.message, false, copy);
        if (!confirmed) return;
        if (state.current?.chatId !== current.chatId) throw new Error('Chat changed before lineage resolution');
        button.textContent = "기억 가져오는 중…";
        await runLineageOperation(state,current.chatId,'transfer',async () => {
          if (mode === "lineage") {
            const result = await client.request<{lineage:ChatLineageStatus}>(`/v1/chats/${encodeURIComponent(current.chatId)}/lineage/inherit`, {
              method: "POST",
              body: JSON.stringify({ ...request, fingerprint: preview.fingerprint, replaceDerived: preview.requiresReplacement === true }),
            }, 120_000);
            addLog(state.logs, "info", `동일한 대화 원문 ${preview.commonMessages}개를 확인해 현재 채팅으로 기억을 가져왔습니다.`);
            return result;
          } else {
            const result = await client.request<{lineage:ChatLineageStatus}>(`/v1/chats/${encodeURIComponent(current.chatId)}/memory-transplant`, {
              method: "POST",
              body: JSON.stringify({ sourceChatId, fingerprint: preview.fingerprint, replaceDerived: preview.requiresReplacement === true }),
            }, null);
            addLog(state.logs, "info", "메시지 ID 연결이 없어 보관된 기억을 현재 채팅의 독립 기록으로 가져왔습니다.");
            return result;
          }
        },mode === 'lineage' ? sourceChatId : undefined);
        await refresh({ forceApply: true });
        await alertDashboard(mode === "lineage"
          ? "같은 대화 원문을 연결하고 기억을 가져왔어요. 확인된 원문은 다시 처리하지 않습니다."
          : "보관된 기억을 독립 기록으로 가져왔어요. 현재 채팅 원문은 별도로 처리될 수 있습니다.");
      } catch (error) {
        addLog(state.logs, "error", `Memory transfer failed: ${String(error)}`);
        if (currentLineageOperation(state)) render();
        else await alertDashboard(lineageFailureMessage(error));
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
          button.textContent = originalLabel;
        }
      }
      return;
    },
    async confirmOperation(getData, chooseExtractionReviewOverride, openInitial, currentChatDeleted) {
      if (!view.confirmation) return;
      if (view.cleanupRunning) return;
      const { action: operation, chatId } = view.confirmation;
      if (operation === "rebuild") requireChatMemoryEnabled(state, chatId, getData().adminChats.find(chat => chat.id === chatId)?.characterId);
      const extractionReviewOverride = operation === "rebuild"
        ? await chooseExtractionReviewOverride(
          "전체 기억을 재검수할까요?",
          "전체 원문을 다시 추출한 뒤 보조 모델이 각 그룹의 결과를 한 번 더 검토할 수 있습니다. 정확도는 높아질 수 있지만 호출량과 비용이 늘어납니다.",
          state.settings.postExtractionReview,
        )
        : undefined;
      if (operation === "rebuild" && extractionReviewOverride === undefined) return;
      let rebuildContext: Awaited<ReturnType<typeof readCurrentContext>> | undefined;
      let expectedSourceMessages: number | undefined;
      if (operation === "rebuild" && state.current?.chatId === chatId) {
        rebuildContext = await readCurrentContext(state, { snapshotMode: "full" });
        const synced = await syncCompleteSourceLedger(client, rebuildContext);
        expectedSourceMessages = synced.expectedSourceMessages;
        const serverUrl = state.settings.serverUrl.replace(/\/$/, "");
        state.settings.serverInstances[serverUrl] = synced.serverInstanceId;
        await saveSettings(state.settings);
      }
      let result: any = {};
      if (operation === "delete") await deleteServerChatRecords(state, client, chatId);
      else result = await client.request<any>(`/v1/chats/${encodeURIComponent(chatId)}/reprocess`, {
        method: "POST",
        body: JSON.stringify(withExtractionReviewOverride({
          activatePendingMemoryLanguage: true,
          identityHints: rebuildContext?.identityHints,
          expectedSourceMessages,
        }, extractionReviewOverride as boolean)),
      }, 120_000).catch(async (error) => {
        if (operation === "rebuild" && error?.code === "INITIAL_SETUP_REQUIRED" && state.current?.chatId === chatId) {
          const picker = { ...await loadSetupPicker(state, chatId), rebuild: { expectedSourceMessages, extractionReviewOverride: extractionReviewOverride as boolean } };
          view.confirmation = undefined;
          openInitial(picker);
          return { setupRequired: true };
        }
        throw error;
      });
      if (result.setupRequired) { render(); return; }
      if (operation === "rebuild" && state.current?.chatId === chatId && !state.settings.workerPaused) void drainWorker(state, client);
      if (operation === "delete") {
        getData().adminChats = getData().adminChats.filter(item => item.id !== chatId);
        view.deletedChatIds = view.deletedChatIds?.filter(id => id !== chatId);
        if (getData().chatId === chatId) currentChatDeleted(chatId);
      }
      addLog(state.logs, "info", operation === "rebuild"
        ? result.awaitingCalibration
          ? "Initial setup analysis queued; confirm the setup ledger before transcript extraction starts"
          : `Ledger rebuild queued: ${Number(result.queuedJobs ?? 0)} job(s)`
        : `Data operation completed: ${operation}`);
      if (operation === "rebuild" && result.awaitingCalibration) openInitial();
      view.confirmation = undefined;
      return { forceApply: operation === "delete" };
    },
  };
}
