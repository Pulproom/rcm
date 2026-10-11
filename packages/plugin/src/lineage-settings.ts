import { addLog, saveSettings } from "./settings.js";
import type { MemoryLanguage } from "@rcm/shared";
import type { RuntimeState } from "./types.js";

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
  copy(state.settings.memoryOnlyInjection, false);
  copy(state.settings.extractionGroupTurns, 6);
  copy(state.settings.memoryLanguages, inheritedMemoryLanguage ?? "en");
  copy(state.settings.memoryBudgets, state.settings.defaultMemoryBudget);
  copy(state.settings.perspectives, []);
  if (!changed) return;
  try { await saveSettings(state.settings); }
  catch (error) { addLog(state.logs, "warn", `Lineage setting persistence failed: ${String(error)}`); }
}
