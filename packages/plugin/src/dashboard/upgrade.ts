import type { UpgradeStatus } from '../api-client.js';
import { upgradeErrorReason } from '../server-errors.js';
import { btn, escapeHtml, icon, iconBtn } from './film/ui.js';
import { recoveryProgress } from './gap-recovery.js';

const legacy = (status: UpgradeStatus) => status.summary.legacyMemories > 0
  && status.summary.rebuiltContract !== status.summary.currentContract;
const failed = (status: UpgradeStatus) => status.lastRun?.status === 'failed'
  || Boolean(status.lastRun?.phase === 2 && status.lastRun.error && status.lock);

export function renderUpgradeCard(status: UpgradeStatus): string | null {
  if (!status.summary.totalMemories) return null;
  const run = status.lastRun, lock = status.lock;
  const workOff = status.workEnabled === false;
  const result = run?.status === 'applied' || failed(status);
  if (!lock && (status.dismissed || !legacy(status) && !result)) return null;
  let title: string, body = '', actions = '', progress = '';
  if (failed(status)) {
    title = '다시 만들기를 마치지 못했어요';
    body = upgradeErrorReason(run?.error);
    if (run?.phase === 2) actions = btn('마무리 다시 시도', { kind: 'primary', action: 'upgrade-finish-retry' });
    else {
      body += ' 이전 기억은 그대로예요.';
      actions = (!['RUN_NOT_RESUMABLE', 'SHADOW_REVIEW_REQUIRED'].includes(run?.error ?? '')
        ? btn('이어서 하기', { kind: 'primary', action: 'upgrade-resume', disabled:workOff }) : '')
        + btn('그만두기', { kind: 'quiet', action: 'upgrade-cancel' });
    }
  } else if (lock) {
    title = lock.phase === 1 ? `새 버전으로 다시 만드는 중 · ${lock.done}/${lock.total}` : '마무리하는 중 · 줄거리와 검색 정리';
    body = lock.phase === 1 ? '끝날 때까지 이 채팅은 쉬어요. 다른 채팅은 그대로 쓸 수 있어요.' : '거의 끝났어요. 이 단계는 멈출 수 없어요.';
    progress = recoveryProgress(lock.done, lock.total);
    if (lock.phase === 1) actions = btn('취소하고 이전 기억으로 계속', { kind: 'quiet', action: 'upgrade-cancel' });
  } else if (run?.status === 'applied') {
    title = `새 버전으로 다시 만들었어요 · 기억 ${status.summary.visibleTotalMemories}개`;
    const close = iconBtn('close', '닫기', { action: 'upgrade-dismiss' });
    return `<section class="gap-card noti noti--done noti--one" aria-live="polite"><span class="noti__ic noti__ic--gray">${icon('refresh')}</span><span class="noti__hd"><b>${escapeHtml(title)}</b></span>${close}</section>`;
  } else {
    title = `이전 버전으로 만든 기억${status.summary.visibleLegacyMemories ? ` ${status.summary.visibleLegacyMemories}개` : ''}`;
    body = '새 버전으로 다시 만들면 누가 무엇을 아는지 더 정확해져요.';
    actions = btn('다시 만들기', { kind: 'primary', action: 'upgrade-sheet' }) + btn('그대로 두기', { kind: 'quiet', action: 'upgrade-dismiss' });
  }
  const bad = failed(status);
  const bodyHtml = escapeHtml(body) + (workOff && bad && run?.phase === 1 ? `<br><span role="status">${escapeHtml(upgradeErrorReason('CHAT_WORK_OFF'))}</span>` : '');
  return `<section class="gap-card noti${bad ? ' is-bad' : ''}" aria-live="polite"><span class="noti__ic noti__ic--${bad ? 'red' : 'gray'}">${icon(bad ? 'alert' : 'refresh')}</span><span class="noti__hd"><b>${escapeHtml(title)}</b></span>${body ? `<span class="noti__bd">${bodyHtml}</span>` : ''}<div class="noti__acts">${progress}${actions}</div></section>`;
}

export function renderUpgradeLine(status: UpgradeStatus): string | null {
  if (!status.summary.totalMemories || !status.lock && !legacy(status)) return null;
  const lock = status.lock;
  const suffix = lock ? `새 버전으로 다시 만드는 중 ${lock.done}/${lock.total}` : `이전 버전${status.summary.visibleLegacyMemories ? ` ${status.summary.visibleLegacyMemories}개` : ''}`;
  return `<div class="lr-line"><p class="sub"><span data-timeline-count>기억 ${status.summary.visibleTotalMemories}개</span> · ${escapeHtml(suffix)}</p>${lock ? recoveryProgress(lock.done, lock.total) : btn('새 버전으로 다시 만들기', { kind: 'quiet', iconEnd: 'chevron', action: 'upgrade-sheet', hit: true })}</div>`;
}

export function upgradeSheet(status: UpgradeStatus): string {
  const p = status.preview;
  const blockedReason = status.workEnabled === false ? 'CHAT_WORK_OFF' : p?.blockedReason;
  const facts = [
    ['film', `다시 만들 범위 <span class="n">원문 ${p?.turns ?? 0}턴 · 기억 ${status.summary.visibleTotalMemories}개</span>`, `이전 버전 기억${status.summary.visibleLegacyMemories ? ` ${status.summary.visibleLegacyMemories}개와` : '과'} 업데이트 뒤에 만든 기억까지 모두 새로 만들어요.`],
    ['swap', '새 기억으로 바뀌는 것', '직접 만들거나 고친 기억, 지운 항목, 북마크도 새로 만든 기억으로 바뀌어요.'],
    ['pause', '그동안 이 채팅은 쉬어요', '다른 채팅과 다른 봇은 그대로 쓸 수 있어요. 도중에 끊겨도 이어서 만들어요.'],
    ['sparkle', `보조 모델 약 ${p?.estimatedCalls ?? 0}회`, '검색 임베딩은 따로 만들어요.'],
  ];
  return `<div class="gap-sheet__head"><h2 id="upgrade-title">새 버전으로 다시 만들기</h2>${btn('닫기', { kind: 'quiet', icon: 'close', action: 'upgrade-close' })}</div><p class="sub">이 채팅의 기억을 처음부터 새 버전으로 다시 만들어요.</p>
<ul class="lr-facts">${facts.map(([ic, title, body], i) => `<li${i === 1 ? ' class="is-warn"' : ''}>${icon(ic!)}<b>${title}</b><p>${body}</p></li>`).join('')}</ul>
<label class="lr-opt"><input type="checkbox" data-upgrade-backup> 다시 만들기 전에 이 채팅 백업하기</label>
<p class="sub" data-upgrade-error role="status"${blockedReason ? '' : ' hidden'}>${blockedReason ? escapeHtml(upgradeErrorReason(blockedReason)) : ''}</p>
<div class="gap-sheet__foot"><div class="actions">${btn('나중에', { kind: 'quiet', action: 'upgrade-close' })}${btn('새 버전으로 다시 만들기', { kind: 'primary', action: 'upgrade-start', data: { backup: 'false' }, disabled: !p || Boolean(blockedReason) })}</div></div>`;
}

/** The sheet uses action buttons: Risu does not support native form submission. */
export function openUpgradeSheet(status: UpgradeStatus, actions: { start(backup: boolean): Promise<void> }): HTMLDialogElement {
  const previousFocus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog film gap-sheet';
  dialog.setAttribute('aria-labelledby', 'upgrade-title');
  dialog.innerHTML = upgradeSheet(status);
  document.body.append(dialog);
  dialog.addEventListener('change', () => {
    const start = dialog.querySelector<HTMLElement>('[data-action="upgrade-start"]')!;
    start.dataset.backup = String(dialog.querySelector<HTMLInputElement>('[data-upgrade-backup]')!.checked);
  });
  dialog.addEventListener('click', async event => {
    const control = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (event.target === dialog || control?.dataset.action === 'upgrade-close') { dialog.close(); return; }
    if (control?.dataset.action !== 'upgrade-start' || control.disabled) return;
    control.disabled = true;
    try { await actions.start(control.dataset.backup === 'true'); dialog.close(); }
    catch (error) {
      const reason = dialog.querySelector<HTMLElement>('[data-upgrade-error]')!;
      reason.textContent = upgradeErrorReason((error as { code?: string }).code); reason.hidden = false;
      control.disabled = (error as {code?:string}).code === 'CHAT_WORK_OFF';
    }
  });
  dialog.addEventListener('close', () => { dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); }, { once: true });
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('[data-action="upgrade-close"]')?.focus();
  return dialog;
}
