// What the main model received this turn, kept beside the injection manifest for the home screen.
import { estimateTokens, type TurnPrepareResponse } from "@rcm/shared";

export interface InjectedScene {
  id: string;
  /** Set only when the scene went as a gist the model should recall loosely. */
  clarity?: "hazy" | "faint";
  details: number;
  dialogues: number;
}

export interface TurnSearch {
  kind: "recall" | "expand";
  /** query for recall, optional focus for expand. */
  query: string;
  ref?: string;
  expandedMemoryId?: string;
  at: number;
  memoryIds: string[];
  alreadyProvidedIds: string[];
  response: string;
  responseTokens: number;
  responseTruncated: boolean;
  /** A product-owned rejection/error code; absent for a delivered result. */
  reason?: string;
}

const MAX_CALL_RESPONSE_BYTES = 64 * 1024;

/** Keep an exact UTF-8 prefix in memory; the full returned text is never persisted. */
export function completeTurnSearch(call: TurnSearch, response: string, reason?: string): void {
  const bytes = new TextEncoder().encode(response);
  call.responseTokens = estimateTokens(response);
  call.responseTruncated = bytes.length > MAX_CALL_RESPONSE_BYTES;
  call.response = call.responseTruncated ? new TextDecoder().decode(bytes.subarray(0, MAX_CALL_RESPONSE_BYTES), { stream: true }) : response;
  call.reason = reason;
}

/** Mirrors the packet's `recall_clarity`: fragment is hazy, déjà vu and below are faint. */
export function summarizeInjectedScenes(selected: TurnPrepareResponse["selected"] | undefined): InjectedScene[] {
  return (selected ?? []).map((item) => {
    const clarity = item.detail === "fragment" ? "hazy" : item.detail === "deja_vu" || item.detail === "unrecalled" ? "faint" : undefined;
    return { id: item.id, ...(clarity ? { clarity } : {}), details: item.details?.length ?? 0, dialogues: item.keyDialogues?.length ?? 0 } as InjectedScene;
  });
}
