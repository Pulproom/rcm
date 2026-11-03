import { withKoreanParticle, type GapRecoveryStatus } from '@rcm/shared';
import { btn, escapeHtml, icon, iconBtn } from './film/ui.js';
import { sceneNumbers, storyScenes } from './scenes.js';

type Hole = GapRecoveryStatus['holes'][number] & Partial<GapRecoveryStatus['results'][number]> & {jobIds?: string[]};

export function recoveryRows(status: GapRecoveryStatus): Hole[] {
  const rows: Hole[] = status.results.filter(row => ['queued', 'leased', 'done', 'failed'].includes(row.status)).map(row => ({...row, jobIds: row.canRetry ? [row.jobId] : []}));
  for (const hole of status.holes) if (!hole.sourceMessageIds.every(id => rows.some(row => row.sourceMessageIds.includes(id)))) rows.push({...hole});
  const holes: Hole[] = [];
  for (const row of rows.sort((a, b) => a.startOrdinal - b.startOrdinal)) {
    const prior = holes.at(-1);
    if (!prior || prior.endOrdinal + 1 !== row.startOrdinal) { holes.push(row); continue; }
    prior.endOrdinal = row.endOrdinal; prior.endTurn = row.endTurn;
    prior.turnCount = (prior.turnCount ?? prior.sourceMessageIds.length) + (row.turnCount ?? row.sourceMessageIds.length);
    prior.sourceMessageIds = [...prior.sourceMessageIds, ...row.sourceMessageIds];
    prior.jobIds = [...(prior.jobIds ?? []), ...(row.jobIds ?? [])];
    prior.canRetry = Boolean(prior.canRetry || row.canRetry);
    prior.error = [prior.error, row.error].filter(Boolean).join(' · ') || null;
    const states = [prior.status, row.status];
    prior.status = states.includes('leased') ? 'leased' : states.includes('queued') ? 'queued' : states.includes('failed') ? 'failed' : 'done';
    const memories = [...(prior.result?.memories ?? []), ...(row.result?.memories ?? [])];
    prior.result = memories.length ? { outcome: 'created', memories } : prior.result && row.result ? { outcome: 'nothing_to_add', memories: [] } : null;
  }
  return holes;
}

// Scene labels use Sino-Korean digit readings, including a closed syllable for 0.
const sceneAnd = (number: number): string => `S#${number}${withKoreanParticle(['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'][number % 10]!, '과/와').slice(-1)}`;

export function recoveryLocation(hole: Hole, memories: any[]): string {
  const numbers = sceneNumbers(memories);
  const scenes = storyScenes(memories).filter(memory => memory.active !== false && memory.source_ordinal != null)
    .sort((a, b) => Number(a.source_ordinal) - Number(b.source_ordinal));
  const before = scenes.filter(memory => Number(memory.source_ordinal) <= hole.startOrdinal).at(-1);
  const after = scenes.find(memory => Number(memory.source_ordinal) > hole.endOrdinal);
  const containing = before && Number(before.source_end_ordinal) >= hole.endOrdinal;
  const a = before && numbers.get(String(before.id)), b = after && numbers.get(String(after.id));
  return containing && a ? `S#${a} 안` : a && b ? `${sceneAnd(a)} S#${b} 사이` : `${hole.startTurn ?? hole.startOrdinal}–${hole.endTurn ?? hole.endOrdinal}턴`;
}

export function recoverySummary(status: GapRecoveryStatus) {
  const rows = recoveryRows(status);
  const created = rows.reduce((sum, row) => sum + (row.result?.memories.length ?? 0), 0);
  const empty = rows.filter(row => row.result?.outcome === 'nothing_to_add').length;
  const failed = rows.filter(row => row.status === 'failed');
  const complete = rows.filter(row => row.status === 'done').length;
  const running = rows.some(row => row.status === 'queued' || row.status === 'leased');
  return { rows, created, empty, failed, complete, running, started: rows.some(row => row.jobId),
    text: `새 기억 ${created}개 · 더할 장면 없음 ${empty}곳 · 실패 ${failed.length}곳` };
}

export function recoveryCard(status: GapRecoveryStatus | undefined, memories: any[], phone: boolean, dismissed = false): string {
  if (!status) return '';
  const s = recoverySummary(status);
  if (!s.rows.length || dismissed && !status.holeCount && !s.running) return '';
  const title = s.running ? `빠진 기억 만드는 중 · ${s.complete}/${s.rows.length}곳`
    : s.failed.length ? `빠진 기억 ${s.failed.length}곳을 만들지 못했어요`
      : s.started ? `빠진 기억을 채웠어요 · 새 기억 ${s.created}개` : `중간에 빠진 기억 ${s.rows.length}곳`;
  const body = s.running ? '끝나면 여기서 결과를 볼 수 있어요.'
    : s.failed.length ? `새 기억 ${s.created}개를 채웠어요. ${s.failed.map(row => `${recoveryLocation(row, memories)}는 ${row.error || '다시 시도해 주세요'}`).join('. ')}.`
      : s.started ? '' : `${phone ? '' : '입력 없이 이어진 턴이 기억으로 정리되지 못했어요. '}장면 기억만 만들고 관계·약속은 그대로 둬요.`;
  const actions = s.running ? btn('결과 보기', { kind: 'quiet', action: 'gap-sheet' })
    : s.failed.length ? btn('다시 시도', { kind: 'primary', action: 'gap-retry' }) + btn('결과 보기', { kind: 'quiet', action: 'gap-sheet' })
      : s.started ? btn('결과 보기', { kind: 'quiet', action: 'gap-sheet' }) + iconBtn('close', '닫기', { action: 'gap-dismiss' })
        : btn('빠진 기억 만들기', { kind: 'primary', action: 'gap-start' }) + (!phone ? btn('구간 보기', { kind: 'quiet', action: 'gap-sheet' }) : '');
  if (phone) return `<section class="gap-card noti${s.failed.length ? ' is-bad' : ''}" aria-live="polite"><span class="noti__ic noti__ic--${s.failed.length ? 'red' : 'gray'}">${icon(s.failed.length ? 'alert' : 'film')}</span><span class="noti__hd"><button type="button" class="gap-open" data-action="gap-sheet"><b>${escapeHtml(title)}</b></button></span><span class="noti__bd">${escapeHtml(body)}</span><div class="noti__acts">${s.running ? recoveryProgress(s.complete, s.rows.length) : ''}${actions}</div></section>`;
  return `<section class="gap-card ${phone ? 'noti' : 'notice'}${s.failed.length ? ' is-bad' : ''}" aria-live="polite"><div><strong>${escapeHtml(title)}</strong>${body ? `<p>${escapeHtml(body)}</p>` : ''}${s.running ? recoveryProgress(s.complete, s.rows.length) : ''}<div class="notice__acts">${actions}</div></div></section>`;
}

export function recoveryProgress(done: number, total: number): string {
  return `<div class="gap-progress" role="progressbar" aria-label="기억 정리" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><i style="width:${total ? Math.min(100, done / total * 100) : 0}%"></i></div>`;
}

export function recoverySheet(status: GapRecoveryStatus, memories: any[]): string {
  const s = recoverySummary(status);
  const turns = s.rows.reduce((n, row) => n + (row.turnCount ?? row.sourceMessageIds.length), 0);
  return `<div class="gap-sheet__head"><h2 id="gap-title">${s.started && !s.running ? '빠진 기억을 채웠어요' : `중간에 빠진 기억 ${s.rows.length}곳`}</h2>${btn('닫기', { kind: 'quiet', icon: 'close', action: 'gap-close' })}</div><p class="sub">${s.started ? escapeHtml(s.text) : '장면 기억만 만들고 관계·약속은 그대로 둬요.'}</p><ul class="gap-holes">${s.rows.map(row => {
    const failed = row.status === 'failed';
    const result = row.result?.outcome === 'created' ? row.result.memories.map(memory => `새 기억 「${memory.title}」`).join(' · ')
      : row.result?.outcome === 'nothing_to_add' ? '더할 장면이 없었어요' : failed ? row.error || '다시 시도해 주세요' : row.jobId ? '기억 만드는 중' : '아직 만들지 않았어요';
    return `<li class="${failed ? 'is-bad' : row.result ? 'is-done' : 'is-pending'}">${icon(failed ? 'alert' : row.result ? 'check' : 'film')}<div><b>${escapeHtml(recoveryLocation(row, memories))}</b><span class="n">${row.turnCount ?? row.sourceMessageIds.length}턴</span><p>${escapeHtml(result)}${failed && row.result ? `<br>${escapeHtml(row.error)}` : ''}</p></div>${failed ? btn('다시 시도', { kind: 'quiet', action: 'gap-retry', data: { jobIds: JSON.stringify(row.jobIds ?? [row.jobId]) } }) : ''}</li>`;
  }).join('')}</ul><div class="gap-sheet__foot"><span class="sub">${s.rows.length}곳 · ${turns}턴</span><div class="actions">${!s.started ? btn('나중에', { kind: 'quiet', action: 'gap-close' }) + btn('빠진 기억 만들기', { kind: 'primary', action: 'gap-start' }) : btn('확인', { kind: 'primary', action: 'gap-close' })}</div></div>`;
}
