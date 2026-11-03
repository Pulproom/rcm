import { estimateTokens } from '@rcm/shared';
import type { ServerClient } from '../api-client.js';
import { ServerRequestError } from '../server-errors.js';
import { escapeHtml } from './film/ui.js';

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

export function deliverySwitches(memory: any, count: number): string {
  const row = (label: string, hint: string, on: boolean, action: string, disabled = false) => `<button type="button" class="delivery-switch" role="switch" aria-checked="${on}" aria-label="${label}" data-action="${action}" data-id="${escapeHtml(memory.id)}"${disabled ? ' disabled aria-disabled="true"' : ''}><span><b>${label}</b><small>${escapeHtml(hint)}</small></span><i aria-hidden="true"></i></button>`;
  const limited = !memory.alwaysInject && count >= 5;
  return `<section class="delivery-group"><h3 class="sec">전달</h3><div class="memory-card">${row('검색 우선 고정', '관련 있을 때 먼저 찾아요', Boolean(memory.pinned), 'toggle-pin')}${row('항상 전달', `매 턴 꼭 넣어요 · 약 ${memoryDeliveryTokens(memory)}토큰 · ${count}/5`, Boolean(memory.alwaysInject), 'toggle-always-inject', limited)}</div>${limited ? `<p class="sub">${ALWAYS_INJECT_LIMIT_MESSAGE}</p>` : ''}</section>`;
}
