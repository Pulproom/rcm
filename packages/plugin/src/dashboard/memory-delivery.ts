import type { RuntimeState } from "../types.js";
import type { AccessEditorKind } from "./film/ui.js";
import { estimateTokens } from '@rcm/shared';
import type { MemoryDetailAccessPatch, MemoryDetailAccessResponse, ServerClient } from '../api-client.js';

export const memoryDeliveryTokens = (memory: any): number => memory.alwaysInjectEstimatedTokens || estimateTokens(`${memory.title ?? ''}\n${memory.content ?? ''}`);

/** Update the switch only after a successful save. */
export async function toggleAlwaysInject(client: Pick<ServerClient, 'patchMemory'>, chatId: string, memory: any, count: number): Promise<string> {
  const enabled = !memory.alwaysInject;
  const result = await client.patchMemory(chatId, memory.id, { alwaysInject: enabled });
  memory.alwaysInject = enabled;
  return enabled ? `항상 전달을 켰어요 · ${result.alwaysInject?.items.length ?? count + 1}` : '항상 전달을 껐어요';
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
