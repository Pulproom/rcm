import { CANONICAL_LANGUAGE_UI_NAMES, type CanonicalTranslationPreview } from '@rcm/shared';
import type { ServerClient } from '../api-client.js';
import { btn } from './film/ui.js';

export function canonicalTranslationHint(estimate: CanonicalTranslationPreview): string {
  return `같은 묶음의 기억 ${estimate.memories}개·상태 ${estimate.states}줄을 ${CANONICAL_LANGUAGE_UI_NAMES[estimate.language]}로 · 대사는 그대로`;
}

export function canonicalTranslationConfirmation(estimate: CanonicalTranslationPreview): string {
  const language = CANONICAL_LANGUAGE_UI_NAMES[estimate.language];
  return `<p class="dialog__text">이 기억이 만들어질 때 함께 저장된 내용을 ${language}로 바꿔요. 이미 ${language}인 문장은 그대로 둬요.</p><ul class="canonical-confirm"><li>기억 ${estimate.memories}개 · 세부 ${estimate.details}줄</li><li>상태·인식·약속 ${estimate.states}줄</li><li>대사와 원문 인용은 바꾸지 않아요</li></ul><p class="sub">보조모델 호출 약 ${estimate.calls}번 · 원래 문장은 따로 보관해요</p>`;
}

export function canonicalSelectionBar(selection: Set<string>): string {
  return `<div class="org-sel retry-sel canonical-sel"><div class="org-sel__sum"><b>${selection.size}개 선택</b></div><div class="org-sel__acts">${btn('정본 언어로 바꾸기', { kind: 'primary', action: 'translate-canonical', disabled: !selection.size })}</div></div>`;
}

export async function loadCanonicalMenuPreview(details: HTMLDetailsElement, chatId: string, client: Pick<ServerClient, 'request'>): Promise<void> {
  const button = details.querySelector<HTMLElement>('[data-action="translate-canonical"]');
  const hint = button?.querySelector<HTMLElement>('.menu__hint');
  if (!hint) return;
  const estimate = await client.request<CanonicalTranslationPreview>(`/v1/chats/${encodeURIComponent(chatId)}/canonical-translation/preview`, {
    method: 'POST', body: JSON.stringify({ memoryIds: [button!.dataset.id] }),
  });
  if (details.isConnected) {
    hint.textContent = canonicalTranslationHint(estimate);
    // The real subtitle can add a line after the menu's first measurement.
    window.dispatchEvent(new Event('resize'));
  }
}

/** Follow the existing job read only while the initiating dashboard scope is open. */
export function followCanonicalTranslation(client: Pick<ServerClient, 'request'>, chatId: string, jobId: string, host: {
  active(): boolean; changed(): Promise<void>; done(message: string): Promise<void>; failed(error: unknown): void;
}): void {
  const poll = async () => {
    if (!host.active()) return;
    try {
      const result = await client.request<{ items: Array<{ id: string; status: string; last_error?: string; payload_json: string }> }>(`/v1/chats/${encodeURIComponent(chatId)}/jobs`);
      if (!host.active()) return;
      const job = result.items.find(item => item.id === jobId);
      if (!job) return;
      const progress = JSON.parse(job.payload_json).canonicalTranslation;
      if (['failed','cancelled','archived'].includes(job.status)) {
        if (progress?.applied) await host.changed();
        throw new Error(job.last_error || '정본 언어로 바꾸기가 중단됐어요. 관리 → 처리에서 확인해 주세요.');
      }
      if (job.status === 'done') {
        const skipped = progress?.diagnostics?.length ?? 0;
        await host.changed();
        await host.done(`정본 언어로 바꿨어요 · ${progress?.applied ?? 0}문장${skipped ? ` · ${skipped}개는 누락되거나 바뀌어 그대로 두었어요` : ''}`);
      } else if (job.status === 'queued' || job.status === 'leased') setTimeout(() => void poll(), 2000);
    } catch (error) { if (host.active()) host.failed(error); }
  };
  setTimeout(() => void poll(), 1000);
}
