import type { MemoryGroupingResult } from '@rcm/shared';
import { displayText } from './translation.js';
import type { TranslationDisplay } from './types.js';
import { btn, empty, escapeHtml, fold, icon, notice, row } from './dashboard/film/ui.js';
import { lex } from './dashboard/lexicon.js';

export interface OrganizationRange {
  id: string; startOrdinal: number; endOrdinal: number; sourceMessageIds: string[]; eligible: boolean;
  reason: string | null; excerpt: string; rawTokens: number; memoryIds: string[]; groupIds: string[];
}
export interface OrganizationData { ranges: OrganizationRange[]; groups: any[]; regenerations: any[]; legacyHolds?: Array<{ id: string }> }
export interface OrganizationView {
  open: boolean; selection: string[]; focusedId: string; highlightedIds: string[]; mobileDetail: boolean;
  candidateId: string; detail?: { id: string; messages: Array<{ id: string; role: string; content: string | null; ordinal: number }> };
  data: OrganizationData; error?: string; busy?: boolean;
}
export type OrganizationTranslations = ReadonlyMap<string, string>;
export const createOrganizationView = (): OrganizationView => ({ open: false, selection: [], focusedId: '', highlightedIds: [], mobileDetail: false,
  candidateId: '', data: { ranges: [], groups: [], regenerations: [] } });
const html = escapeHtml;
const number = (value: number): string => Math.round(value).toLocaleString('ko-KR');
const action = (name: string, label: string, id = '', disabled = false, primary = false) => btn(label, { kind: primary ? 'primary' : 'secondary', action: name, data: { id }, disabled });
const rangeLabel = (range: OrganizationRange) => `메시지 ${range.startOrdinal + 1}–${range.endOrdinal + 1}`;

export function toggleOrganizationRange(ranges: OrganizationRange[], selected: string[], id: string): string[] {
  const range = ranges.find((row) => row.id === id);
  if (!range?.eligible) throw new Error(range?.reason ?? '선택할 수 없는 구간입니다.');
  const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
  const positions = ranges.flatMap((row, index) => next.includes(row.id) ? [index] : []);
  if (positions.length && positions.at(-1)! - positions[0]! + 1 !== positions.length) throw new Error('연속된 구간을 선택해 주세요. 중간 구간은 건너뛸 수 없습니다.');
  return ranges.filter((row) => next.includes(row.id)).map((row) => row.id);
}

export function compareOrganizationMemories(before: any[], after: any[]) {
  const identity = (memory: any) => memory.key ?? memory.id;
  const left = new Map(before.map((memory) => [identity(memory), memory]));
  const right = new Map(after.map((memory) => [identity(memory), memory]));
  const summary = (memory: any) => JSON.stringify([memory.title, memory.content, memory.details ?? [], memory.keyDialogues ?? memory.dialogues ?? [], memory.knownBy ?? memory.known_by_json]);
  return {
    before: before.map((memory) => ({ ...memory, comparison: !right.has(identity(memory)) ? '제외' : summary(memory) === summary(right.get(identity(memory))) ? '유지' : '변경 전' })),
    after: after.map((memory) => ({ ...memory, comparison: !left.has(identity(memory)) ? '추가' : summary(memory) === summary(left.get(identity(memory))) ? '유지' : '변경 후' })),
  };
}

function memoryList(memories: any[], translations: OrganizationTranslations = new Map(), display: TranslationDisplay = 'en'): string {
  const copy = (memory: any, field: 'title' | 'content') => displayText(String(memory[field] ?? ''), translations.get(`${memory.id}:${field}`), display);
  if (!memories.length) return '<p class="sub">기억이 없습니다.</p>';
  return `<div class="org-mems">${memories.map((memory) => {
    const details = memory.details ?? [];
    const lines = memory.keyDialogues ?? memory.dialogues ?? [];
    const detailFold = details.length ? fold('세부', details.map((detail: any) => `<p>${displayText(String(detail.text ?? ''), translations.get(`${memory.id}:detail:${detail.id}`), display)}</p>`).join(''), { count: details.length }) : '';
    const lineFold = lines.length ? fold('보존된 대사', lines.map((quote: any, index: number) => `<p class="quote"><b>${html(quote.speaker)}</b> ${displayText(String(quote.text ?? ''), translations.get(`${memory.id}:dialogue:${index}`), display)}</p>`).join(''), { count: lines.length }) : '';
    return `<article class="org-mem">${memory.comparison ? `<div class="lab">${html(memory.comparison)}</div>` : ''}<h4>${copy(memory, 'title')}</h4><p>${copy(memory, 'content')}</p>${detailFold}${lineFold}</article>`;
  }).join('')}</div>`;
}
function groupingResult(result: MemoryGroupingResult): string {
  const review = result.reviewItems.length
    ? `<div class="msg msg--warning"><span class="msg__icon">${icon('alert')}</span><div><strong>함께 확인할 내용</strong><ul>${result.reviewItems.map((item) => `<li>${html(item.reason)}</li>`).join('')}</ul></div></div>`
    : '';
  return `<h4>${html(result.title)}</h4>${result.sections.map((section) => `<article class="org-mem"><h4>${html(section.title)}</h4><p>${html(section.summary)}</p></article>`).join('')}${review}`;
}
function canonicalStates(values: any[]): string {
  const fields = [['relationshipEvents','관계 변화'],['assertions','사실'],['beliefs','믿음'],['promises','약속'],['physicalIntimacy','친밀 기록']] as const;
  return fields.map(([key, label]) => {
    const entries = values.flatMap((value) => value[key] ?? []);
    const items = entries.map((item: any) => `<li>${html([item.holder, item.subject, item.predicate, item.value, item.polarity, item.promisor, item.promisee, item.from, item.to, item.participantA, item.participantB, item.act, item.customLabel, item.reason, item.content, item.status, ...(item.changes ?? []).map((change: any) => `${change.axis}: ${change.effect} (${change.impact})`)].filter(Boolean).join(' · '))}</li>`).join('');
    return fold(label, `<ul class="org-states">${items}</ul>`, { count: entries.length });
  }).join('');
}
const back = (name: string, label: string) => `<button type="button" class="back hit" data-action="${name}">${icon('back')}<span>${label}</span></button>`;
const cutNotice = (text: string) => `<div class="notice notice--cut" role="alert">${icon('alert')}<span>${html(text)}</span></div>`;

function candidateDetail(view: OrganizationView, memories: any[], translations: OrganizationTranslations, display: TranslationDisplay): string {
  const group = view.data.groups.find((row) => `group:${row.id}` === view.candidateId);
  const run = view.data.regenerations.find((row) => `regeneration:${row.id}` === view.candidateId);
  if (!group && !run) return empty('확인할 후보를 선택하세요', '목록의 확인할 작업에서 결과를 고를 수 있습니다.');
  const item = group ?? run, ready = item.status === 'ready';
  const kind = group ? 'group' : 'regeneration';
  const before = group ? memories.filter((memory) => group.memberIds.includes(memory.id)) : run.preview?.beforeCurrentMemories ?? (Array.isArray(run.preview?.before)
    ? run.preview.before.flatMap((value: any) => value.memories) : run.preview?.before?.memories ?? []);
  const after = group ? [] : run.preview?.afterCurrentMemories ?? (Array.isArray(run.preview?.after) ? run.preview.after.flatMap((value: any) => value.memories) : run.preview?.after?.memories ?? []);
  const compared = compareOrganizationMemories(before, after);
  const title = group ? '묶기 결과' : run.mode === 'episode' ? '구간 재생성 결과' : '이후 기억 재생성 결과';
  const status = item.status === 'failed' ? '작업을 끝내지 못했습니다.' : item.status === 'stale' ? '원문이나 기억이 바뀌어 이 결과를 사용할 수 없습니다.' : '후보를 만드는 중입니다.';
  const beforeColumn = () => `<div><div class="lab">현재 기억 ${before.length}개</div>${memoryList(group ? before : compared.before, translations, display)}${run?.mode === 'canonical_suffix' ? canonicalStates([run.preview.beforeStates]) : ''}</div>`;
  const afterColumn = () => `<div class="new"><div class="lab">${group ? '새 통합 에피소드' : `새 기억 ${after.length}개`}</div>${group ? groupingResult(group.candidate) : memoryList(compared.after, translations, display)}${run?.mode === 'canonical_suffix' ? canonicalStates([run.preview.afterStates]) : ''}</div>`;
  const compare = ready
    ? `<div class="cmp org-cmp">${beforeColumn()}${afterColumn()}</div>${group ? notice('기존 세부·대사·접근 권한과 관계·사실·믿음·약속은 보존됩니다. 묶기는 표시 방식과 통합 요약을 바꿉니다.') : ''}`
    : `<p class="sub">${status}</p>`;
  const lead = ready ? '현재 기억은 아직 변경되지 않았습니다. 결과를 확인한 뒤 적용하세요.' : '기존 기억을 계속 사용합니다. 화면을 닫아도 작업은 유지됩니다.';
  const actions = `${action(`organization-discard-${kind}`, '후보 버리기', item.id)}${group && item.canRetry ? action('organization-retry-group', '실패 단계 다시 시도', item.id) : ''}${ready ? action(`organization-apply-${kind}`, '적용', item.id, false, true) : ''}`;
  return `<article class="reader"><div class="reader__bar">${back('organization-back-detail', '구간 상세')}</div><h2 class="reader__title">${title}</h2><p class="sub">${lead}</p>${item.error ? cutNotice(item.error) : ''}${compare}<div class="form__bar">${actions}</div></article>`;
}

export function memoryOrganization(view: OrganizationView, memories: any[], translations: OrganizationTranslations = new Map(), display: TranslationDisplay = 'en'): string {
  const selected = view.data.ranges.filter((row) => view.selection.includes(row.id));
  const focused = view.data.ranges.find((row) => row.id === view.focusedId);
  const candidates = [...view.data.groups.filter((row) => row.status !== 'capsuled').map((row) => ({ ...row, key: `group:${row.id}`, label: '묶기' })),
    ...view.data.regenerations.map((row) => ({ ...row, key: `regeneration:${row.id}`, label: row.mode === 'episode' ? '구간 재생성' : '이후 기억 재생성' }))];
  const activeGroups = view.data.groups.filter((row) => row.status === 'capsuled');
  const candidateState = (status: string) => status === 'ready' ? '결과 확인' : status === 'failed' ? '확인 필요' : status === 'stale' ? '원문 변경됨' : '생성 중';
  const rows = view.data.ranges.map((range) => `<div class="org-range${view.highlightedIds.includes(range.id) ? ' is-hl' : ''}"><label class="org-check"><input type="checkbox" data-action="organization-select" data-id="${html(range.id)}" ${view.selection.includes(range.id) ? 'checked' : ''} ${range.eligible ? '' : 'disabled'} aria-label="${rangeLabel(range)} 선택"></label>${row({ slug: rangeLabel(range), slugEnd: `기억 ${range.memoryIds.length}개 · 약 ${number(range.rawTokens)}토큰`, title: range.excerpt, sub: range.reason ?? undefined, action: 'organization-detail', data: { id: range.id }, current: range.id === view.focusedId })}</div>`).join('');
  const role = (value: string) => value === 'user' ? '사용자' : value === 'assistant' ? '캐릭터' : '시스템';
  const sources = focused && view.detail?.id === focused.id
    ? view.detail.messages.map((message) => fold(`메시지 ${message.ordinal + 1} · ${role(message.role)}`, `<p class="rec">${html(message.content ?? '원문을 사용할 수 없어')}</p>`, { preserveKey: `organization-source:${focused.id}:${message.id}` })).join('')
    : '<p class="sub">원문을 불러오는 중…</p>';
  const details = focused
    ? `<article class="reader"><div class="reader__bar">${back('organization-list', '구간 목록')}</div><h2 class="reader__title">${rangeLabel(focused)}</h2>${focused.reason ? notice(focused.reason) : ''}<h3 class="org-h">연결된 기억</h3>${memoryList(memories.filter((memory) => focused.memoryIds.includes(memory.id)), translations, display)}<h3 class="org-h">원문</h3>${sources}</article>`
    : empty('원문 구간을 선택하세요', '목록에서 내용을 확인하고 연속된 묶음을 선택할 수 있습니다.');
  const holds = (view.data.legacyHolds ?? []).map((hold) => `<div class="msg msg--warning"><span class="msg__icon">${icon('alert')}</span><div><strong>이전 수동 보류가 남아 있습니다</strong><p>이미 처리된 기억은 유지하고, 미처리 원문만 다시 준비합니다.</p>${action('organization-release-hold', '수동 보류 해제', hold.id)}</div></div>`).join('');
  const pending = candidates.length ? `<section class="org-work"><h3 class="org-h">확인할 작업 <span class="n">${candidates.length}</span></h3>${candidates.map((item) => row({ title: item.label, end: `<span class="org-state">${candidateState(item.status)}</span>`, action: 'organization-candidate', data: { id: item.key }, current: item.key === view.candidateId })).join('')}</section>` : '';
  const applied = activeGroups.length ? fold('적용된 묶기', activeGroups.map((group) => `<div class="org-applied"><span>${html(group.title)}</span>${btn('묶기 해제', { kind: 'quiet', action: 'organization-ungroup', data: { id: group.id } })}</div>`).join(''), { count: activeGroups.length }) : '';
  const messageCount = selected.reduce((sum, row) => sum + row.sourceMessageIds.length, 0);
  const tokens = number(selected.reduce((sum, row) => sum + row.rawTokens, 0));
  const selection = `<div class="org-sel"><div class="org-sel__sum">${selected.length ? `<b>${selected.length}개 묶음 · 메시지 ${messageCount}개</b><span>원문 약 ${tokens}토큰 · 실제 청구량과 다릅니다</span>` : '<b>구간을 선택하세요</b><span>연속된 구간을 골라 묶거나 다시 만들 수 있습니다.</span>'}</div><div class="org-sel__acts">${action('organization-create-group', '선택한 구간 묶기', '', selected.length < 2, true)}${action('regenerate-episode', '이 구간 다시 만들기', selected[0]?.id ?? '', selected.length !== 1 || view.busy)}${action('regenerate-canonical', '여기부터 다시 만들기', selected[0]?.id ?? '', selected.length !== 1 || view.busy)}</div></div>`;
  const list = `<div class="listcol">${holds}${pending}${applied}<div class="list tl-rows" data-preserve-scroll="organization-list">${rows || empty('아직 처리된 원문 묶음이 없습니다', '원문이 처리되면 여기에 구간이 나타납니다.')}</div>${selection}</div>`;
  const busy = view.busy ? `<div class="notice" role="status">${icon('clock')}<span>처리 예상량을 확인하고 있습니다…</span></div>` : '';
  return `<div class="organization${view.mobileDetail ? ' is-detail' : ''}">${lex().skin === 'phone' ? `<div class="intro org-intro">${back('organization-close', '타임라인')}<h1 class="pagetitle">기억 정리</h1><p class="sub">원문을 선택하고, 결과를 확인한 뒤 적용하세요.</p></div>` : `<div class="intro"><p class="sub">원문을 선택하고, 결과를 확인한 뒤 적용하세요.</p><div class="intro__acts">${btn('타임라인으로', { kind: 'quiet', icon: 'back', action: 'organization-close' })}</div></div>`}${busy}${view.error ? cutNotice(view.error) : ''}<div class="split">${list}<div class="readercol" data-preserve-scroll="reader:organization:${escapeHtml(view.candidateId)}">${view.candidateId ? candidateDetail(view, memories, translations, display) : details}</div></div></div>`;
}
