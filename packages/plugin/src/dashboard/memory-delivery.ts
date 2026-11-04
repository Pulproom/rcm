import { estimateTokens } from '@rcm/shared';
import type { ServerClient } from '../api-client.js';
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
