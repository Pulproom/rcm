import { ServerRequestError, isMissingServerRoute, isServerConnectionFailure, type ServerClient } from "./api-client.js";
import { isServerConnectionReady, noteServerConnectionFailure } from "./connection.js";
import { isChatMemoryEnabled } from "./settings.js";
import { addLog } from "./settings.js";
import type { RuntimeState } from "./types.js";
import { runBackgroundChatWrite } from "./activity-state.js";

export async function syncQuizEnabled(state: RuntimeState, client: Pick<ServerClient, "quizSetEnabled">): Promise<void> {
  if (!state.current || state.quizSupported === false || !isServerConnectionReady(state)) return;
  const chatId = state.current.chatId;
  const characterId = state.current.characterId;
  if (!isChatMemoryEnabled(state.settings, chatId, characterId)) return;
  const enabled = state.settings.quizEnabled === true;
  if (state.quizSynced?.chatId === chatId && state.quizSynced.enabled === enabled) return;
  const syncMark = { chatId, enabled };
  state.quizSynced = syncMark;
  try {
    const applied = await runBackgroundChatWrite(state, chatId, "quiz-enabled", async () => {
      if (!isChatMemoryEnabled(state.settings, chatId, characterId)) return;
      const currentEnabled = state.settings.quizEnabled === true;
      await client.quizSetEnabled(chatId, currentEnabled);
      state.quizSupported = true;
      if (state.current?.chatId === chatId && state.settings.quizEnabled === currentEnabled) state.quizSynced = { chatId, enabled: currentEnabled };
    });
    if (!applied && state.quizSynced === syncMark) state.quizSynced = undefined;
  } catch (error) {
    if (error instanceof ServerRequestError && error.code === "CHAT_NOT_FOUND") {
      if (state.quizSynced === syncMark) state.quizSynced = undefined;
      return;
    }
    if (isMissingServerRoute(error)) {
      state.quizSupported = false;
      return;
    }
    if (state.quizSynced === syncMark) state.quizSynced = undefined;
    if (isServerConnectionFailure(error)) { noteServerConnectionFailure(state, state.settings, error); return; }
    addLog(state.logs, "warn", `퀴즈 설정 동기화 실패: ${String(error)}`);
  }
}

export async function syncQuizSettings(state: RuntimeState, client: Pick<ServerClient, "quizSetEnabled" | "quizDisableAll">, previouslyEnabled: boolean): Promise<void> {
  if (!isServerConnectionReady(state)) return;
  if (previouslyEnabled && state.settings.quizEnabled !== true) {
    try {
      await runBackgroundChatWrite(state, undefined, "quiz-disable-all", async () => {
        if (state.settings.quizEnabled === true) return;
        await client.quizDisableAll();
        state.quizSynced = undefined;
      });
    } catch (error) {
      if (isServerConnectionFailure(error)) { noteServerConnectionFailure(state, state.settings, error); return; }
      if (isMissingServerRoute(error)) return;
      addLog(state.logs, "warn", `퀴즈 설정 동기화 실패: ${String(error)}`);
    }
    return;
  }
  await syncQuizEnabled(state, client);
}
