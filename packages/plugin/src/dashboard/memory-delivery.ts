import type { RuntimeState } from "../types.js";
import type { AccessEditorKind } from "./film/ui.js";
import { estimateTokens } from '@rcm/shared';
import type { MemoryDetailAccessPatch, MemoryDetailAccessResponse, ServerClient } from '../api-client.js';
import { ServerRequestError } from '../server-errors.js';

export const ALWAYS_INJECT_LIMIT_MESSAGE = '5개까지 켤 수 있어요. 다른 기억에서 먼저 꺼 주세요.';
export const memoryDeliveryTokens = (memory: any): number => memory.alwaysInjectEstimatedTokens || estimateTokens(`${memory.title ?? ''}\n${memory.content ?? ''}`);

/** Keep the switch unchanged on rejection, including another device taking the last slot. */
export async function toggleAlwaysInject(client: Pick<ServerClient, 'patchMemory'>, chatId: string, memory: any, count: number): Promise<string> {
  const enabled = !memory.alwaysInject;
  try {
    const result = await client.patchMemory(chatId, memory.id, { alwaysInject: enabled });
    memory.alwaysInject = enabled;
    return enabled ? `항상 전달을 켰어요 · ${result.alwaysInject?.items.length ?? count + 1}/5` : '항상 전달을 껐어요';
  } catch (error) {
    if (error instanceof ServerRequestError && error.code === 'ALWAYS_INJECT_LIMIT') throw new Error(ALWAYS_INJECT_LIMIT_MESSAGE);
    throw error;
  }
}

/** The existing prepared-packet cache is the only retry invalidation mechanism. */
export function invalidateAutomaticTurnPacket(state: Pick<RuntimeState,"automaticTurnPacket">, chatId: string): void {
  if (state.automaticTurnPacket?.chatId === chatId) state.automaticTurnPacket = undefined;
}

/** All five access editors share the mutation and invalidate only after it succeeds. */
export async function saveMemoryAccess(client: Pick<ServerClient,"request">, state: Pick<RuntimeState,"automaticTurnPacket">,
  chatId: string, memoryId: string, itemId: string, kind: AccessEditorKind, patch: MemoryDetailAccessPatch): Promise<MemoryDetailAccessResponse> {
  const id=encodeURIComponent(itemId);
  const resource=kind === "memory" ? `memories/${id}` : kind === "promise" ? `promises/${id}` : kind === "physical_milestone" ? `physical-intimacy/${id}`
    : `memories/${encodeURIComponent(memoryId)}/${kind === "dialogue" ? "dialogues" : "details"}/${id}`;
  const result=await client.request<MemoryDetailAccessResponse>(`/v1/chats/${encodeURIComponent(chatId)}/${resource}/access`,{method:"PUT",body:JSON.stringify(patch)});
  if (!result.ok) throw new Error("아는 인물을 저장하지 못했어요.");
  invalidateAutomaticTurnPacket(state,chatId);
  return result;
}
