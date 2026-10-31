import { addLog, saveSettings } from "./settings.js";
import type { ChatLineageStatus, MemoryLanguage } from "@rcm/shared";
import type { RuntimeState } from "./types.js";
import type { ServerClient } from "./api-client.js";
import { makePrepareRequest, readCurrentContext } from "./context.js";

export function lineageFailureMessage(error: unknown): string {
  const message = String(error);
  if (message.includes("TARGET_MEMORY_WORK_ACTIVE") || message.includes("Queued or active memory work must finish first")) return "지금 이 채팅의 기억을 정리하는 중이라, 끝난 뒤에 가져올 수 있어요.";
  if (message.includes("SOURCE_MEMORY_WORK_PENDING")) return "원본 채팅의 기억을 정리하고 있어요. 작업이 끝난 뒤에 가져와 주세요.";
  if (message.includes("PREVIEW_STALE") || message.includes("LINEAGE_PROBE_STALE")) return "확인하는 동안 채팅이나 작업 상태가 바뀌었어요. 다시 기억 가져오기를 눌러 확인해 주세요.";
  if (message.includes("TARGET_HAS_DERIVED_DATA")) return "현재 채팅에 기억이 생겼어요. 다시 확인하고 기존 기억을 교체할지 선택해 주세요.";
  if (message.includes("TARGET_INVENTORY_REQUIRED")) return "현재 채팅의 전체 원문을 확인하지 못했어요. 채팅을 다시 열고 시도해 주세요.";
  if (message.includes("different content") || message.includes("not in the same order")) return "같은 메시지의 내용이나 순서가 달라 기억을 연결할 수 없어요. 원본 채팅을 다시 확인해 주세요.";
  if (message.includes("At least two exact message IDs")) return "같은 대화의 메시지를 확인하지 못했어요. RCM ZIP 백업으로 가져와 주세요.";
  if (message.includes("not found")) return "가져올 채팅이나 기억을 찾지 못했어요. 채팅 목록을 새로 확인해 주세요.";
  if (message.includes("LINEAGE_CYCLE") || message.includes("must be different")) return "이 채팅을 원본으로 연결할 수 없어요. 다른 원본 채팅을 선택해 주세요.";
  if (message.includes("LINEAGE_ALREADY_APPLIED") || message.includes("LINEAGE_CHOICE_NOT_PENDING")) return "이미 기억 이어받기 선택이 처리됐어요. 현재 상태를 다시 확인해 주세요.";
  return "기억 가져오기를 완료했는지 확인하지 못했어요. 서버 연결과 현재 채팅 상태를 확인한 뒤 다시 시도해 주세요.";
}

export function needsOpenedChatResolution(state: RuntimeState, calibration: { status: string; locked?: boolean } | undefined, lineage: ChatLineageStatus | undefined): boolean {
  return Boolean(state.current) && !calibration?.locked && lineage?.status === "none"
    && currentLineageOperation(state)?.status !== "failed"
    && ["unseeded", "awaiting_setup", "queued", "awaiting_confirmation", "failed", "ready", "skipped"].includes(calibration?.status ?? "")
    && (state.chatOpen?.key !== `${state.settings.serverUrl}\0${state.current!.chatId}` || !state.chatOpen.resolved);
}

export function currentLineageOperation(state: RuntimeState): RuntimeState["lineageOperation"] {
  return state.lineageOperation?.chatId === state.current?.chatId ? state.lineageOperation : undefined;
}

type LineageResult = { lineage: ChatLineageStatus; memoryLanguage?: MemoryLanguage; initialCalibration?: NonNullable<RuntimeState["statusSummary"]>["initialCalibration"] };

/** A timeout ends the HTTP wait, not the server transaction. Accept its later receipt. */
export function reconcileLineageOperation(state: RuntimeState, chatId: string, lineage?: ChatLineageStatus): void {
  const operation = currentLineageOperation(state);
  if (!operation || operation.chatId !== chatId || operation.status !== 'failed' || !lineage) return;
  const previous = operation.previousLineage;
  const completed = operation.kind === 'open' ? lineage.status !== 'none'
    : lineage.status === 'inherited' && lineage.parentChatId === operation.parentChatId
      && (previous?.status !== 'inherited' || (lineage.appliedAt ?? 0) > (previous.appliedAt ?? 0));
  if (completed) {
    state.lineageOperation = undefined;
    if (operation.kind !== 'transfer' && lineage.status === 'inherited' && lineage.parentChatId) {
      void inheritLineageSettings(state,chatId,lineage.parentChatId);
    }
  }
}

export function syncLineageActivity(state: RuntimeState, chatId: string, lineage: ChatLineageStatus, initialCalibration?: LineageResult["initialCalibration"]): void {
  if (state.current?.chatId !== chatId) return;
  reconcileLineageOperation(state,chatId,lineage);
  state.statusSummary = {
    ...(state.statusSummary ?? { queuedJobs: 0, failedJobs: 0, pendingReviews: 0, pendingEmbeddings: 0, failedEmbeddings: 0 }),
    lineage, ...(initialCalibration ? { initialCalibration } : {}),
  };
  state.activityReady = true;
  // Invalidate older status polls before publishing the mutation response.
  state.publishStatusSummary?.();
}

/** Publish the mutation itself; dashboard refresh and the next poll are observers. */
export async function runLineageOperation(state: RuntimeState, chatId: string, kind: "open" | "select" | "transfer", action: () => Promise<LineageResult>, parentChatId?: string): Promise<void> {
  if (currentLineageOperation(state)?.status === "running") return;
  const operation: NonNullable<RuntimeState["lineageOperation"]> = { chatId, kind, status: "running", previousLineage:state.statusSummary?.lineage, ...(parentChatId ? { parentChatId } : {}) };
  state.lineageOperation = operation;
  state.publishActivity?.();
  try {
    const result = await action();
    if (state.current?.chatId !== chatId || state.lineageOperation !== operation) return;
    state.lineageOperation = undefined;
    syncLineageActivity(state, chatId, result.lineage, result.initialCalibration);
    if (kind !== 'transfer' && result.lineage.status === "inherited" && result.lineage.parentChatId) {
      await inheritLineageSettings(state, chatId, result.lineage.parentChatId, result.memoryLanguage);
    }
  } catch (error) {
    addLog(state.logs, "error", `Lineage operation failed: ${String(error)}`);
    if (state.current?.chatId === chatId && state.lineageOperation === operation) {
      state.lineageOperation = { ...operation, status: "failed", error: lineageFailureMessage(error) };
      state.publishActivity?.();
    }
    throw error;
  }
}

/** Shared by host selection polling and dashboard entry; never captures a prompt. */
export async function resolveOpenedChat(state: RuntimeState, client: ServerClient): Promise<void> {
  const chatId = state.current?.chatId;
  if (!chatId) return;
  const key = `${state.settings.serverUrl}\0${chatId}`;
  if (state.chatOpen?.key === key) return state.chatOpen.pending;
  const pending = runLineageOperation(state, chatId, "open", async () => {
    const context = await readCurrentContext(state);
    if (context.chatId !== chatId) throw new Error("Chat changed before lineage resolution");
    return client.request<LineageResult>(
      `/v1/chats/${encodeURIComponent(chatId)}/open`, {
        method: "POST", body: JSON.stringify({ ...makePrepareRequest(context, 0, { deferExtraction: true }), workerId: state.workerId }),
      }, 60_000);
  });
  const opening: NonNullable<RuntimeState["chatOpen"]> = { key, pending };
  state.chatOpen = opening;
  try { await pending; opening.resolved = true; }
  catch (error) { if (state.chatOpen === opening) state.chatOpen = undefined; throw error; }
}

export async function inheritLineageSettings(state: RuntimeState, target: string | { chatId: string }, parentId: string, inheritedMemoryLanguage?: MemoryLanguage): Promise<void> {
  const chatId = typeof target === "string" ? target : target.chatId;
  let changed = false;
  const copy = <T>(record: Record<string, T>, fallback?: T): void => {
    if (Object.hasOwn(record, chatId)) return;
    const value = record[parentId] ?? fallback;
    if (value !== undefined) { record[chatId] = structuredClone(value); changed = true; }
  };
  copy(state.settings.chatEnabled, state.settings.defaultChatEnabled);
  copy(state.settings.profiles, state.settings.defaultProfile);
  copy(state.settings.includeUserMessages, true);
  copy(state.settings.upcomingOccasions, true);
  copy(state.settings.pairProgress, false);
  copy(state.settings.memoryOnlyInjection, false);
  copy(state.settings.extractionGroupTurns, 6);
  copy(state.settings.memoryLanguages, inheritedMemoryLanguage ?? "en");
  copy(state.settings.memoryBudgets, state.settings.defaultMemoryBudget);
  copy(state.settings.perspectives, []);
  if (!changed) return;
  try { await saveSettings(state.settings); }
  catch (error) { addLog(state.logs, "warn", `Lineage setting persistence failed: [오류 원문 제외]`); }
}
