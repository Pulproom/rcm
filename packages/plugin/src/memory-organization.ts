import { contiguousSourceRangeSelection, type MemoryGroupingResult } from '@rcm/shared';
import { displayText } from './translation.js';
import type { TranslationDisplay } from './types.js';
import { btn, empty, escapeHtml, fold, icon, notice, row } from './dashboard/film/ui.js';
import { lex } from './dashboard/lexicon.js';

export interface OrganizationRange {
  id: string; startOrdinal: number; endOrdinal: number; sourceMessageIds: string[]; eligible: boolean;
  sourceOrdinals?: number[];
  reason: string | null; excerpt: string; rawTokens: number; memoryIds: string[]; groupIds: string[];
  memoryExcluded?: boolean; canExclude?: boolean; exclusionReason?: string | null;
  selectable?: boolean;
}
export interface OrganizationData { ranges: OrganizationRange[]; groups: any[]; regenerations: any[]; additions?: any[]; legacyHolds?: Array<{ id: string }> }
export interface AdditionSource { id: string; role: string; content: string | null; ordinal: number; additionReason?: string | null; translatedContent?: string }
export interface AdditionView { rangeIds: string[]; startOrdinal: number; endOrdinal: number; messages: AdditionSource[]; selectedIds: string[]; request: string;
  estimate?: { rawTokens: number; initialCalls: number; note: string }; estimating?: boolean; origin?: 'detail' | 'selection' }
export interface OrganizationView {
  open: boolean; selection: string[]; focusedId: string; highlightedIds: string[]; mobileDetail: boolean;
  candidateId: string; detail?: { id: string; messages: Array<{ id: string; role: string; content: string | null; ordinal: number }> };
  data: OrganizationData; error?: string; busy?: boolean;
  addition?: AdditionView; search?: string; searchStatus?: string; jump?: string;
}
export type OrganizationTranslations = ReadonlyMap<string, string>;
export const createOrganizationView = (): OrganizationView => ({ open: false, selection: [], focusedId: '', highlightedIds: [], mobileDetail: false,
  candidateId: '', data: { ranges: [], groups: [], regenerations: [] } });
const html = escapeHtml;
const number = (value: number): string => Math.round(value).toLocaleString('ko-KR');
const action = (name: string, label: string, id = '', disabled = false, primary = false) => btn(label, { kind: primary ? 'primary' : 'secondary', action: name, data: { id }, disabled });
const rangeLabel = (range: OrganizationRange) => range.startOrdinal === range.endOrdinal ? `메시지 ${range.startOrdinal + 1}` : `메시지 ${range.startOrdinal + 1}–${range.endOrdinal + 1}`;

export function toggleOrganizationRange(ranges: OrganizationRange[], selected: string[], id: string): string[] {
  const range = ranges.find((row) => row.id === id);
  if (!range || !(range.selectable ?? range.eligible)) throw new Error(range?.reason ?? '선택할 수 없는 구간입니다.');
  const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
  if (!contiguousSourceRangeSelection(ranges, next)) throw new Error('연속된 구간을 선택해 주세요. 중간 구간은 건너뛸 수 없습니다.');
  return ranges.filter((row) => next.includes(row.id)).map((row) => row.id);
}

/** Include intermediate visible ranges when a memory has evidence in several batches. */
export function organizationMemoryRanges(ranges: OrganizationRange[], memoryId: string): string[] {
  const positions = ranges.flatMap((range, index) => range.memoryIds.includes(memoryId) ? [index] : []);
  return positions.length ? ranges.slice(positions[0], positions.at(-1)! + 1).filter(range => !range.memoryExcluded).map(range => range.id) : [];
}

export function organizationJumpRange(ranges: OrganizationRange[], number: number): string | undefined {
  return ranges.find(range => range.startOrdinal <= number - 1 && range.endOrdinal >= number - 1)?.id;
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
    const detailFold = details.length ? fold('세부', details.map((detail: any) => `<p>${displayText(String(detail.text ?? ''), translations.get(`${memory.id}:detail:${detail.id}`), display)}${detail.sourceNumbers?.length ? `<span class="sub"> · 메시지 ${detail.sourceNumbers.join(', ')}</span>` : ''}</p>`).join(''), { count: details.length }) : '';
    const lineFold = lines.length ? fold('보존된 대사', lines.map((quote: any, index: number) => `<p class="quote"><b>${html(quote.speaker)}</b> ${displayText(String(quote.text ?? ''), translations.get(`${memory.id}:dialogue:${index}`), display)}</p>`).join(''), { count: lines.length }) : '';
    return `<article class="org-mem">${memory.comparison ? `<div class="lab">${html(memory.comparison)}</div>` : ''}<h4>${copy(memory, 'title')}</h4>${memory.sourceNumbers?.length ? `<p class="sub">근거 · 메시지 ${memory.sourceNumbers.join(', ')}</p>` : ''}<p>${copy(memory, 'content')}</p>${detailFold}${lineFold}</article>`;
  }).join('')}</div>`;
}
function groupingResult(result: MemoryGroupingResult): string {
  const review = result.reviewItems.length
    ? `<div class="msg msg--warning"><span class="msg__icon">${icon('alert')}</span><div><strong>함께 확인할 내용</strong><ul>${result.reviewItems.map((item) => `<li>${html(item.reason)}</li>`).join('')}</ul></div></div>`
    : '';
  return `<h4>${html(result.title)}</h4>${result.sections.map((section) => `<article class="org-mem"><h4>${html(section.title)}</h4><p>${html(section.summary)}</p></article>`).join('')}${review}`;
}
function canonicalStates(values: any[], sourceNumbers?: Map<string, number>, hideEmpty = false): string {
  const fields = [['relationshipEvents','관계 변화'],['assertions','사실'],['beliefs','믿음'],['promises','약속'],['physicalIntimacy','친밀 기록'],['socialKnowledge','인식'],['relationshipBaselines','관계 기준']] as const;
  return fields.map(([key, label]) => {
    const entries = values.flatMap((value) => value[key] ?? []);
    if (hideEmpty && !entries.length) return '';
    const items = entries.map((item: any) => `<li>${html([item.holder, item.subject, item.predicate, item.value, item.polarity, item.promisor, item.promisee, item.from, item.to, item.participantA, item.participantB, item.act, item.customLabel, item.reason, item.content, item.status, item.level, ...(item.participants ?? []), ...(item.knownAs ?? []), ...(item.addressTerms ?? []), ...(item.changes ?? []).map((change: any) => `${change.axis}: ${change.effect} (${change.impact})`)].filter(Boolean).join(' · '))}${sourceNumbers ? `<span class="sub"> · 메시지 ${[...new Set((item.evidence ?? []).map((e: any) => sourceNumbers.get(e.messageId)).filter(Boolean))].join(', ')}</span>` : ''}</li>`).join('');
    return fold(label, `<ul class="org-states">${items}</ul>`, { count: entries.length });
  }).join('');
}
const back = (name: string, label: string) => `<button type="button" class="back hit" data-action="${name}">${icon('back')}<span>${label}</span></button>`;
const cutNotice = (text: string) => `<div class="notice notice--cut" role="alert">${icon('alert')}<span>${html(text)}</span></div>`;

function candidateDetail(view: OrganizationView, memories: any[], translations: OrganizationTranslations, display: TranslationDisplay): string {
  const addition = view.data.additions?.find(row => `addition:${row.id}` === view.candidateId);
  if (addition) {
    const candidate = addition.candidate;
    const sourceNumbers = new Map<string, number>(addition.sourceFingerprint.map((item: any) => [item.messageId, item.ordinal + 1]));
    const withNumbers = (items: any[]) => items.map(item => ({ ...item, sourceNumbers: [...new Set((item.evidence ?? []).map((e: any) => sourceNumbers.get(e.messageId)).filter(Boolean))],
      details: item.details?.map((detail: any) => ({ ...detail, sourceNumbers: [...new Set((detail.evidence ?? []).map((e: any) => sourceNumbers.get(e.messageId)).filter(Boolean))] })) }));
    const ready = addition.status === 'ready';
    return `<article class="reader"><div class="reader__bar">${back('organization-back-detail', '구간 상세')}</div><h2 class="reader__title">기억 추가 결과</h2><p class="sub">기존 기억은 바뀌지 않아요</p>${addition.request ? `<p class="add__req"><b>요청</b>${html(addition.request)}</p>` : ''}${addition.error ? cutNotice(addition.error) : ''}${ready
      ? `${memoryList(withNumbers(candidate.memories), translations, display)}${canonicalStates([candidate], sourceNumbers, true)}`
      : `<p class="sub">${addition.status === 'stale' ? '원문이나 연결된 기억이 바뀌어 사용할 수 없는 후보예요.' : addition.status === 'failed' ? '작업을 끝내지 못했어요. 처리 상태에서 호출 상세도 확인할 수 있어요.' : '선택한 원문에서 기억을 찾고 있어요. 화면을 닫아도 작업은 유지돼요.'}</p>`}<div class="form__bar">${action('organization-discard-addition', '후보 버리기', addition.id)}${addition.canRetry ? action('organization-retry-addition', '실패 단계 다시 시도', addition.id) : ''}${ready ? action('organization-apply-addition', '적용', addition.id, Boolean(view.busy), true) : ''}</div></article>`;
  }
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
    ...view.data.regenerations.map((row) => ({ ...row, key: `regeneration:${row.id}`, label: row.mode === 'episode' ? '구간 재생성' : '이후 기억 재생성' })),
    ...(view.data.additions ?? []).map(row => ({ ...row, key: `addition:${row.id}`, label: '기억 추가' }))];
  const activeGroups = view.data.groups.filter((row) => row.status === 'capsuled');
  const candidateState = (status: string) => status === 'ready' ? '결과 확인' : status === 'failed' ? '확인 필요' : status === 'stale' ? '원문 변경됨' : '생성 중';
  const canToggleExclusion = (range: OrganizationRange) => Boolean(range.canExclude || range.memoryExcluded) && range.sourceMessageIds.length === 1;
  const exclusionLabel = (range: OrganizationRange) => range.memoryExcluded ? '제외 해제' : '기억에서 제외';
  const exclusionAction = (range: OrganizationRange) => canToggleExclusion(range) ? action('organization-memory-exclusion', exclusionLabel(range), range.id, Boolean(view.busy)) : '';
  const rowExclusion = (range: OrganizationRange) => canToggleExclusion(range) ? `<div class="org-range__action">${btn(exclusionLabel(range), { kind: 'quiet', action: 'organization-memory-exclusion', data: { id: range.id }, disabled: Boolean(view.busy) })}</div>` : '';
  const rows = view.data.ranges.map((range) => `<div data-range-id="${html(range.id)}" class="org-range${view.highlightedIds.includes(range.id) ? ' is-hl' : ''}${range.memoryExcluded ? ' is-excluded' : ''}${canToggleExclusion(range) ? ' has-action' : ''}"><label class="org-check"><input type="checkbox" data-action="organization-select" data-id="${html(range.id)}" ${view.selection.includes(range.id) ? 'checked' : ''} ${range.selectable ?? range.eligible ? '' : 'disabled'} aria-label="${rangeLabel(range)} 선택"></label>${row({ slug: rangeLabel(range), slugEnd: `기억 ${range.memoryIds.length}개 · 약 ${number(range.rawTokens)}토큰`, title: range.excerpt, sub: range.memoryExcluded ? '기억 제외됨' : range.reason ?? undefined, action: 'organization-detail', data: { id: range.id }, current: range.id === view.focusedId })}${rowExclusion(range)}</div>`).join('');
  const role = (value: string) => value === 'user' ? '사용자' : value === 'assistant' ? '캐릭터' : '시스템';
  const sources = focused && view.detail?.id === focused.id
    ? view.detail.messages.map((message) => fold(`메시지 ${message.ordinal + 1} · ${role(message.role)}`, `<p class="rec">${html(message.content ?? '원문을 사용할 수 없어')}</p>`, { preserveKey: `organization-source:${focused.id}:${message.id}` })).join('')
    : '<p class="sub">원문을 불러오는 중…</p>';
  const details = focused
    ? `<article class="reader"><div class="reader__bar">${back('organization-list', '구간 목록')}</div><h2 class="reader__title">${rangeLabel(focused)}</h2>${focused.reason ? notice(focused.reason) : ''}<div class="org-detail__action">${action('organization-add-memory', '기억 추가', focused.id, Boolean(view.busy))}${exclusionAction(focused)}</div><h3 class="org-h">연결된 기억</h3>${memoryList(memories.filter((memory) => focused.memoryIds.includes(memory.id)), translations, display)}<h3 class="org-h">원문</h3>${sources}</article>`
    : empty('원문 구간을 선택하세요', '목록에서 내용을 확인하고 연속된 묶음을 선택할 수 있습니다.');
  const holds = (view.data.legacyHolds ?? []).map((hold) => `<div class="msg msg--warning"><span class="msg__icon">${icon('alert')}</span><div><strong>이전 수동 보류가 남아 있습니다</strong><p>이미 처리된 기억은 유지하고, 미처리 원문만 다시 준비합니다.</p>${action('organization-release-hold', '수동 보류 해제', hold.id)}</div></div>`).join('');
  const pending = candidates.length ? `<section class="org-work"><h3 class="org-h">확인할 작업 <span class="n">${candidates.length}</span></h3>${candidates.map((item) => row({ title: item.label, end: `<span class="org-state">${candidateState(item.status)}</span>`, action: 'organization-candidate', data: { id: item.key }, current: item.key === view.candidateId })).join('')}</section>` : '';
  const applied = activeGroups.length ? fold('적용된 묶기', activeGroups.map((group) => `<div class="org-applied"><span>${html(group.title)}</span>${btn('묶기 해제', { kind: 'quiet', action: 'organization-ungroup', data: { id: group.id } })}</div>`).join(''), { count: activeGroups.length }) : '';
  const messageCount = selected.reduce((sum, row) => sum + row.sourceMessageIds.length, 0);
  const tokens = number(selected.reduce((sum, row) => sum + row.rawTokens, 0));
  const allEligible = selected.every(range => range.eligible);
  const selection = `<div class="org-sel"><div class="org-sel__sum">${selected.length ? `<b>${selected.length}개 묶음 · 메시지 ${messageCount}개</b><span>${selected.some(range => range.eligible) ? `원문 약 ${tokens}토큰 · 실제 청구량과 다릅니다` : '기본 기억 처리가 끝난 원문에서만 기억을 추가할 수 있어요'}</span>` : '<b>구간을 선택하세요</b><span>연속된 구간을 묶거나 다시 만들고, 빠진 기억을 추가할 수 있습니다.</span>'}</div><div class="org-sel__acts">${action('organization-create-group', '선택한 구간 묶기', '', selected.length < 2 || !allEligible || view.busy)}${action('organization-add-memory', '기억 추가', '', !selected.some(range => range.eligible) || view.busy, true)}${action('regenerate-episode', '이 구간 다시 만들기', selected[0]?.id ?? '', selected.length !== 1 || !allEligible || view.busy)}${action('regenerate-canonical', '여기부터 다시 만들기', selected[0]?.id ?? '', selected.length !== 1 || !allEligible || view.busy)}</div></div>`;
  const search = `<div class="org-find"><form id="organization-search-form" class="org-find__q"><label class="org-find__field">${icon('search')}<input name="query" type="search" enterkeyhint="search" value="${html(view.search ?? '')}" placeholder="원문 검색" maxlength="500" aria-label="원문 검색"></label>${view.search ? btn('지우기', { kind: 'quiet', action: 'organization-clear-search', data: { id: '' } }) : ''}</form><form id="organization-jump-form" class="org-find__n"><label class="org-find__field"><span aria-hidden="true">#</span><input name="ordinal" type="number" inputmode="numeric" enterkeyhint="go" min="1" step="1" value="${html(view.jump ?? '')}" placeholder="메시지" aria-label="메시지 번호로 이동"></label></form></div>${view.searchStatus ? `<p class="sub org-find__status" role="status">${html(view.searchStatus)}</p>` : ''}`;
  const list = `<div class="listcol">${search}${holds}${pending}${applied}<div class="list tl-rows" data-preserve-scroll="organization-list">${rows || empty('아직 원문 구간이 없습니다', '원문이 동기화되면 여기에 구간이 나타납니다.')}</div>${selection}</div>`;
  const busy = view.busy ? `<div class="notice" role="status">${icon('clock')}<span>처리 예상량을 확인하고 있습니다…</span></div>` : '';
  return `<div class="organization${view.mobileDetail ? ' is-detail' : ''}">${lex().skin === 'phone' ? `<div class="intro org-intro">${back('organization-close', '타임라인')}<h1 class="pagetitle">기억 정리</h1><p class="sub">원문을 선택하고, 결과를 확인한 뒤 적용하세요.</p></div>` : `<div class="intro"><p class="sub">원문을 선택하고, 결과를 확인한 뒤 적용하세요.</p><div class="intro__acts">${btn('타임라인으로', { kind: 'quiet', icon: 'back', action: 'organization-close' })}</div></div>`}${busy}${view.error ? cutNotice(view.error) : ''}<div class="split">${list}<div class="readercol" data-preserve-scroll="reader:organization:${escapeHtml(view.candidateId)}">${view.candidateId ? candidateDetail(view, memories, translations, display) : view.addition ? additionForm(view, display) : details}</div></div></div>`;
}

function additionForm(view: OrganizationView, display: TranslationDisplay): string {
  const addition = view.addition!;
  const selectable = addition.messages.filter(message => !message.additionReason);
  const chosen = selectable.filter(message => addition.selectedIds.includes(message.id)).length;
  const allSelected = selectable.length > 0 && chosen === selectable.length;
  const roleLabel = (value: string) => value === 'user' ? '사용자' : value === 'assistant' ? '캐릭터' : '시스템';
  const firstLine = (value: string | null) => (value ?? '').split('\n').map(line => line.trim()).find(Boolean) ?? '원문을 사용할 수 없어요';
  const messages = addition.messages.map(message => {
    const on = addition.selectedIds.includes(message.id) && !message.additionReason;
    const content = display === 'ko' ? message.translatedContent || message.content : message.content;
    const missing = display === 'ko' && !message.translatedContent && message.content !== null;
    return `<div class="add-msg${on ? '' : ' is-off'}"><label class="add-msg__ck"><input type="checkbox" data-action="organization-addition-message" data-id="${html(message.id)}" ${on ? 'checked' : ''} ${message.additionReason || view.busy ? 'disabled' : ''} aria-label="메시지 ${message.ordinal+1} 사용"></label><details class="add-msg__body" data-preserve-open="organization-source:addition:${html(message.id)}"><summary><span class="add-msg__who">메시지 ${message.ordinal+1} · ${roleLabel(message.role)}${message.additionReason ? ` · ${html(message.additionReason)}` : ''}${missing ? ' · <small class="sub">번역 없음</small>' : ''}</span><span class="add-msg__pv">${html(firstLine(content))}</span><span class="chev" aria-hidden="true">${icon('chevron')}</span></summary><p class="rec">${html(content ?? '원문을 사용할 수 없어요')}</p></details></div>`;
  }).join('');
  const estimate = addition.estimating ? '예상량을 확인하고 있어요…'
    : addition.estimate ? `원문 약 ${number(addition.estimate.rawTokens)}토큰 · 보조 모델 약 ${addition.estimate.initialCalls}회${addition.estimate.note ? `<br>${html(addition.estimate.note)}` : ''}` : '사용할 메시지를 선택해 주세요.';
  return `<article class="reader add"><div class="reader__bar">${addition.origin === 'detail' ? back('organization-back-detail', '구간 상세') : back('organization-list', '구간 목록')}</div><h2 class="reader__title">메시지 ${addition.startOrdinal+1}–${addition.endOrdinal+1}에서 기억 추가</h2><p class="sub">지금 기억은 그대로 두고, 고른 원문에서 빠진 내용만 찾아요.</p><div class="add__head"><h3 class="org-h">원문 · ${addition.messages.length}개 중 ${chosen}개 선택</h3>${selectable.length ? btn(allSelected ? '전체 선택 해제' : '전체 선택', { kind: 'quiet', action: 'organization-addition-toggle-all', data: { id: '' }, disabled: Boolean(view.busy) }) : ''}</div><div class="add__msgs">${messages}</div><form id="organization-addition-form" class="add__form"><label class="add__field"><span class="org-h">모델에게 요청 <small>(선택)</small></span><textarea name="request" rows="3" ${view.busy ? 'disabled' : ''} placeholder="예: 이 장면에서 건넨 물건과 그 의미를 꼭 넣어 줘">${html(addition.request)}</textarea></label><p class="add__note">원문에 근거가 있는 것만 기억이 돼요. 모델에게는 원문이 전달돼요.</p><div class="add__foot"><p class="add__est" role="status" data-addition-estimate>${estimate}</p>${btn('기억 찾기', { kind: 'primary', type: 'submit', disabled: Boolean(view.busy || addition.estimating || !addition.estimate || !addition.selectedIds.length) })}</div></form></article>`;
}
