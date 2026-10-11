// What the main model received this turn, kept beside the injection manifest for the home screen.
import type { TurnPrepareResponse } from "@rcm/shared";

export interface InjectedScene {
  id: string;
  /** Set only when the scene went as a gist the model should recall loosely. */
  clarity?: "hazy" | "faint";
  details: number;
  dialogues: number;
}

export interface TurnSearch {
  query: string;
  at: number;
  memoryIds: string[];
}

const MAX_TURN_SEARCHES = 8;

/** Mirrors the packet's `recall_clarity`: fragment is hazy, déjà vu and below are faint. */
export function summarizeInjectedScenes(selected: TurnPrepareResponse["selected"] | undefined): InjectedScene[] {
  return (selected ?? []).map((item) => {
    const clarity = item.detail === "fragment" ? "hazy" : item.detail === "deja_vu" || item.detail === "unrecalled" ? "faint" : undefined;
    return { id: item.id, ...(clarity ? { clarity } : {}), details: item.details?.length ?? 0, dialogues: item.keyDialogues?.length ?? 0 } as InjectedScene;
  });
}

/** One memory-tool search the model ran while answering. A new injection starts the list over. */
export function recordTurnSearch(searches: TurnSearch[] | undefined, query: string, memoryIds: string[], at = Date.now()): TurnSearch[] {
  const trimmed = query.trim();
  if (!trimmed) return searches ?? [];
  return [...(searches ?? []), { query: trimmed, at, memoryIds: [...new Set(memoryIds)] }].slice(-MAX_TURN_SEARCHES);
}
