import { formatServerError } from "../server-errors.js";
import { compareStoryTimes, orderStoryMemories, isScene, isRecognitionMemory } from "@rcm/shared";
import { isMissingServerRoute, ServerRequestError, type ServerClient } from "../api-client.js";
import type { EpisodeActivity, RuntimeState } from "../types.js";
import { readHostSourceTranslations } from "../context.js";
import { createOrganizationView, toggleOrganizationRange, organizationMemoryRanges, organizationJumpRange, type AdditionView, type OrganizationData, type OrganizationView } from "../memory-organization.js";
import { requireChatMemoryEnabled } from "./data-actions.js";

interface GroupingEstimate {
  sourceBatchIds: string[];
  messageCount: number;
  rawTokens: number;
  estimatedInputTokens: number;
  initialCalls: number;
  mergeRequired: boolean;
  partialIds: string[];
}

interface RegenerationEstimate {
  batchCount: number;
  messageCount: number;
  rawTokens: number;
  estimatedInputTokens: number;
  estimatedExtractionCalls: number;
  estimatedStoryCalls?: { total: number; segment: number; arc: number; overview: number };
  estimatedRelationshipCalls?: number;
}

function keepRejectionReason(reason: string): string {
  const reasons: Record<string, string> = {
    not_a_lost_item: '현재 보존할 수 있는 누락 기록이 아니에요',
    dependency_unavailable: '연결된 근거 기록을 찾을 수 없어요',
    missing_evidence: '근거가 없어요',
    source_unavailable: '근거 원문을 사용할 수 없어요',
    missing_source_fingerprint: '원문이 그대로인지 확인할 수 없어요',
    source_changed: '근거 원문이 바뀌었어요',
    evidence_span_changed: '인용 범위가 원문과 맞지 않아요',
    evidence_quote_changed: '인용문이 원문과 맞지 않아요',
    replacement_batch_unavailable: '다시 만든 원문 묶음에 연결할 수 없어요',
    replacement_identity_conflict: '다시 만든 기록과 겹쳐요',
  };
  // This prefix is the server's structured rejection code, not a prose heuristic.
  const access = reason.startsWith('access_');
  return `${access ? '접근 권한의 ' : ''}${reasons[access ? reason.slice(7) : reason] ?? '보존 조건을 확인할 수 없어요'}`;
}

export interface OrganizationActionHost {
  render(invalidate?: boolean): void;
  refresh(): Promise<void>;
  openTimeline(): void;
  discardReadyOrganizationCandidate(): Promise<boolean>;
  drainWorker(): void;
  chooseExtractionReviewOverride(title: string, detail: string, defaultEnabled: boolean): Promise<boolean | undefined>;
  renderSourceNavigationCompletion(): void;
  isDashboardOpen(): boolean;
  regenerationFailed(error: unknown): void;
}

export interface OrganizationController {
  handleAction(action: string, target: HTMLElement, chat: string): Promise<void>;
  regenerate(action: "regenerate-episode" | "regenerate-canonical", target: HTMLElement, chat: string): Promise<void>;
  openAdditionFromMemory(getSelection: () => { selectedMemory: string; memoryOpen: boolean }): Promise<void>;
  reset(): void;
  refreshData(): Promise<void>;
  submit(form: HTMLFormElement, values: Record<string, FormDataEntryValue>): Promise<void>;
  handleInput(input: HTMLInputElement): boolean;
}

/** The shell owns confirmation, refresh, render and shared action-error handling.
 * Addition reads keep their identity/epoch guards across renders and chat switches. */
export function createOrganizationController(organizationView: OrganizationView, root: HTMLElement, state: RuntimeState,
  client: Pick<ServerClient, "request">, host: OrganizationActionHost): OrganizationController {
  const { render } = host;
  let organizationChatId = state.current?.chatId;
  let additionEstimateEpoch = 0;
  let additionEstimateTimer: ReturnType<typeof setTimeout> | undefined;
  const updateAdditionEstimate = async (): Promise<void> => {
    const addition = organizationView.addition;
    if (!addition || !state.current) return;
    const epoch = ++additionEstimateEpoch;
    addition.estimate = undefined;
    addition.estimating = Boolean(addition.selectedIds.length);
    const paintEstimate = () => {
      const line = root.querySelector<HTMLElement>('[data-addition-estimate]');
      if (line) line.textContent = addition.estimating ? '예상량을 확인하고 있어요…' : addition.estimate
        ? `원문 약 ${addition.estimate.rawTokens.toLocaleString()}토큰 · 보조 호출 약 ${addition.estimate.initialCalls}회 · ${addition.estimate.note}` : '사용할 메시지를 선택해 주세요.';
      const button = root.querySelector<HTMLButtonElement>('#organization-addition-form [data-action="submit-form"]');
      if (button) button.disabled = Boolean(organizationView.busy || addition.estimating || !addition.estimate);
    };
    paintEstimate();
    if (!addition.selectedIds.length) return;
    const chatId = state.current!.chatId;
    try {
      const estimate = await client.request<NonNullable<AdditionView['estimate']>>(`/v1/chats/${encodeURIComponent(chatId)}/memory-additions/preview`, {
        method: 'POST', body: JSON.stringify({ rangeIds: addition.rangeIds, messageIds: addition.selectedIds, request: addition.request, postExtractionReview: state.settings.postExtractionReview }),
      });
      if (epoch !== additionEstimateEpoch || organizationView.addition !== addition || state.current?.chatId !== chatId) return;
      addition.estimate = estimate;
      organizationView.error = undefined; organizationView.errorReport = undefined;
    } catch (error) {
      if (epoch !== additionEstimateEpoch || organizationView.addition !== addition) return;
      organizationView.errorReport = formatServerError(error);
      organizationView.error = error instanceof Error ? error.message : String(error);
      const line = root.querySelector<HTMLElement>('[data-addition-estimate]');
      if (line) line.textContent = organizationView.error;
    } finally {
      if (epoch === additionEstimateEpoch && organizationView.addition === addition) {
        addition.estimating = false;
        paintEstimate();
        if (!addition.estimate && organizationView.error) {
          const line = root.querySelector<HTMLElement>('[data-addition-estimate]');
          if (line) line.textContent = organizationView.error;
        }
      }
    }
  };
  const openMemoryAddition = async (rangeIds: string[]): Promise<void> => {
    if (!state.current) return;
    const chatId = state.current!.chatId;
    const sources = await client.request<Omit<AdditionView, 'selectedIds' | 'request'>>(`/v1/chats/${encodeURIComponent(chatId)}/memory-additions/sources`, {
      method: 'POST', body: JSON.stringify({ rangeIds }),
    });
    if (state.current?.chatId !== chatId || !organizationView.open) return;
    const addition: AdditionView = { ...sources, selectedIds: sources.messages.filter(message => !message.additionReason).map(message => message.id), request: '' };
    organizationView.addition = addition;
    organizationView.candidateId = '';
    organizationView.mobileDetail = true;
    render();
    await Promise.all([updateAdditionEstimate(), readHostSourceTranslations(chatId, addition.messages, state.settings.canonicalizationPolicy).then(found => {
      if (state.current?.chatId !== chatId || organizationView.addition !== addition) return;
      for (const message of addition.messages) message.translatedContent = found.get(message.id);
      render();
    })]);
  };
  const scrollOrganizationRange = (id: string) => {
    const target = Array.from(root.querySelectorAll<HTMLElement>('[data-range-id]')).find(element => element.dataset.rangeId === id);
    target?.scrollIntoView({ block: 'center' });
  };

  return {
    reset() { Object.assign(organizationView, createOrganizationView()); },
    async refreshData() {
      if (organizationChatId !== state.current?.chatId) {
        Object.assign(organizationView, createOrganizationView());
        organizationChatId = state.current?.chatId;
      }
      if (organizationView.open && state.current) {
        organizationView.data = await client.request<OrganizationData>(`/v1/chats/${encodeURIComponent(state.current.chatId)}/memory-organization`);
      }
    },
    async handleAction(action, target, chat) {
      organizationView.error = undefined; organizationView.errorReport = undefined;
      try {
        const id = target.dataset.id ?? '';
        const leavesCandidate = ['organization-close', 'organization-list', 'organization-back-detail', 'organization-detail', 'organization-select', 'organization-candidate', 'organization-add-memory'].includes(action ?? '');
        if (leavesCandidate && !await host.discardReadyOrganizationCandidate()) return;
        if (action === 'organization-close') organizationView.open = false;
        else if (action === 'organization-list') { organizationView.mobileDetail = false; organizationView.candidateId = ''; organizationView.addition = undefined; }
        else if (action === 'organization-back-detail') { organizationView.candidateId = ''; organizationView.addition = undefined; organizationView.mobileDetail = Boolean(organizationView.focusedId); }
        else if (action === 'organization-add-memory') {
          if (!organizationView.open) {
            organizationView.open = true;
            host.openTimeline();
            organizationView.data = await client.request<OrganizationData>(`/v1/chats/${chat}/memory-organization`);
          }
          if (!id) organizationView.focusedId = '';
          await openMemoryAddition(id ? [id] : organizationView.selection);
          if (organizationView.addition) organizationView.addition.origin = id ? 'detail' : 'selection';
        } else if (action === 'organization-addition-message' || action === 'organization-addition-toggle-all') {
          const addition = organizationView.addition;
          if (!addition || organizationView.busy) return;
          const eligibleIds = addition.messages.filter(message => !message.additionReason).map(message => message.id);
          if (action === 'organization-addition-toggle-all') addition.selectedIds = eligibleIds.every(id => addition.selectedIds.includes(id)) ? [] : eligibleIds;
          else if (eligibleIds.includes(id)) addition.selectedIds = addition.selectedIds.includes(id) ? addition.selectedIds.filter(item => item !== id) : eligibleIds.filter(item => item === id || addition.selectedIds.includes(item));
          addition.estimate = undefined;
          render();
          await updateAdditionEstimate();
        } else if (action === 'organization-clear-search') {
          organizationView.search = ''; organizationView.searchStatus = ''; organizationView.highlightedIds = [];
        } else if (['organization-apply-addition', 'organization-discard-addition', 'organization-retry-addition'].includes(action ?? '')) {
          if (organizationView.busy) return;
          const operation = action!.split('-')[1];
          organizationView.busy = true; render();
          try {
            await client.request(`/v1/chats/${chat}/memory-additions/${encodeURIComponent(id)}/${operation}`, { method: 'POST' });
            if (operation !== 'retry') { organizationView.candidateId = ''; organizationView.addition = undefined; organizationView.mobileDetail = false; }
            else host.drainWorker();
            await host.refresh();
          } finally { organizationView.busy = false; render(); }
          return;
        }
        else if (action === 'organization-open' || action === 'related-source') {
          organizationView.open = true; host.openTimeline();
          organizationView.data = await client.request<OrganizationData>(`/v1/chats/${chat}/memory-organization`);
          if (action === 'related-source') {
            organizationView.highlightedIds = organizationView.data.ranges.filter((row) => row.memoryIds.includes(id)).map((row) => row.id);
            organizationView.focusedId = organizationView.highlightedIds[0] ?? '';
            organizationView.candidateId = '';
            if (organizationView.focusedId) {
              organizationView.detail = await client.request(`/v1/chats/${chat}/source-ranges/${encodeURIComponent(organizationView.focusedId)}`);
              organizationView.mobileDetail = true;
            } else organizationView.error = '이 기억에 연결된 처리 원문 묶음이 없어.';
          }
        } else if (action === 'organization-select') {
          organizationView.selection = toggleOrganizationRange(organizationView.data.ranges, organizationView.selection, id);
        } else if (action === 'organization-detail') {
          organizationView.focusedId = id; organizationView.candidateId = ''; organizationView.addition = undefined; organizationView.mobileDetail = true;
          organizationView.detail = await client.request(`/v1/chats/${chat}/source-ranges/${encodeURIComponent(id)}`);
        } else if (action === 'organization-candidate') { organizationView.candidateId = id; organizationView.mobileDetail = true; }
        else if (action === 'organization-memory-exclusion') {
          const range = organizationView.data.ranges.find(row => row.id === id);
          if (!range || range.sourceMessageIds.length !== 1 || organizationView.busy) return;
          organizationView.busy = true; render();
          try {
            await client.request(`/v1/chats/${chat}/messages/${encodeURIComponent(range.sourceMessageIds[0]!)}/memory-exclusion`, {
              method: 'PUT', body: JSON.stringify({ excluded: !range.memoryExcluded }),
            });
            organizationView.selection = organizationView.selection.filter(selected => selected !== id);
          } finally {
            organizationView.busy = false;
            organizationView.data = await client.request(`/v1/chats/${chat}/memory-organization`);
          }
          await host.refresh(); return;
        } else if (action === 'organization-create-group') {
          requireChatMemoryEnabled(state, state.current!.chatId);
          const estimate = await client.request<GroupingEstimate>(`/v1/chats/${chat}/memory-groups/preview`, { method: 'POST', body: JSON.stringify({ batchIds: organizationView.selection, postExtractionReview: state.settings.postExtractionReview }) });
          const review = await host.chooseExtractionReviewOverride('선택한 원문 구간을 묶을까요?',
            `원문 묶음 ${estimate.sourceBatchIds.length}개 · 메시지 ${estimate.messageCount}개\n원문 약 ${estimate.rawTokens.toLocaleString()}토큰 · 전체 예상 입력 약 ${estimate.estimatedInputTokens.toLocaleString()}토큰\n처음 ${estimate.initialCalls}회${estimate.mergeRequired ? ' + 단계별 통합' : ''}로 처리합니다. 재검수를 사용하면 검수 단계가 추가됩니다. 이 수치는 실제 청구량이 아닙니다.\n기존 세부·대사·상태는 보존되며, 결과를 확인한 뒤 적용할 수 있습니다.${estimate.partialIds.length ? ` 범위 밖 근거도 가진 기억 ${estimate.partialIds.length}개는 원래 위치에 남습니다.` : ''}`,
            state.settings.postExtractionReview);
          if (review === undefined) return;
          const created = await client.request<{ runId: string }>(`/v1/chats/${chat}/memory-groups/create`, { method: 'POST', body: JSON.stringify({ batchIds: organizationView.selection, postExtractionReview: review }) });
          organizationView.candidateId = `group:${created.runId}`; organizationView.mobileDetail = true;
          host.drainWorker();
          await host.refresh(); return;
        } else if (action === 'organization-release-hold') {
          const result = await client.request<{ active?: EpisodeActivity | null }>(`/v1/chats/${chat}/episodes/${encodeURIComponent(id)}/release`, { method: 'POST' });
          state.episodeActivity = result.active ?? null;
          await host.refresh(); return;
        } else if (action === 'organization-discard-group' || action === 'organization-discard-regeneration') {
          await host.discardReadyOrganizationCandidate();
          return;
        } else if (action === 'organization-ungroup' || action.endsWith('-group')) {
          const operation = action === 'organization-ungroup' ? 'ungroup' : action.includes('-apply-') ? 'apply' : action.includes('-discard-') ? 'discard' : 'retry';
          await client.request(`/v1/chats/${chat}/memory-groups/${encodeURIComponent(id)}/${operation}`, { method: 'POST' });
          if (operation !== 'retry') { organizationView.candidateId = ''; organizationView.selection = []; organizationView.mobileDetail = false; }
          else host.drainWorker();
          await host.refresh(); return;
        } else if (action === 'organization-apply-regeneration') {
          // A persisted itemDiff can outlive a server downgrade. The dedicated route fails closed on old servers.
          const keepLostItemIds = [...root.querySelectorAll<HTMLInputElement>('input[name="keep-lost"]:checked')].map((input) => input.value);
          const operation = keepLostItemIds.length ? 'apply-with-keep' : 'apply';
          await client.request(`/v1/chats/${chat}/regenerations/${encodeURIComponent(id)}/${operation}`, { method: 'POST', ...(keepLostItemIds.length ? { body: JSON.stringify({ keepLostItemIds }) } : {}) }, 120_000)
            .catch(error => {
              if (keepLostItemIds.length && isMissingServerRoute(error)) throw new Error('고른 기록을 보존하려면 RCM 서버를 업데이트해 주세요. 아직 적용하지 않았어요.');
              throw error;
            });
          organizationView.candidateId = ''; organizationView.selection = []; organizationView.mobileDetail = false;
          await host.refresh(); return;
        }
      } catch (error) {
        organizationView.errorReport = formatServerError(error);
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof ServerRequestError && error.code === 'KEEP_ITEMS_REJECTED') {
          const diff: Array<{ id: string; before?: { text?: string } }> | undefined = organizationView.data.regenerations
            .find(run => `regeneration:${run.id}` === organizationView.candidateId)?.preview?.itemDiff;
          const reasons = error.rejectedItems?.map(item => `${diff?.find(change => change.id === item.id)?.before?.text ?? item.id}: ${keepRejectionReason(item.reason)}`) ?? [];
          organizationView.error = ['고른 기록을 보존할 수 없어 적용하지 않았어요.', ...reasons].join(' · ');
        } else organizationView.error = message;
      }
      render();
      if (action === 'organization-select') {
        const control = [...root.querySelectorAll<HTMLInputElement>('[data-action="organization-select"]')].find((input) => input.dataset.id === target.dataset.id);
        control?.focus({ preventScroll: true });
      } else if (action === 'organization-candidate' || action === 'organization-detail') {
        const heading = root.querySelector<HTMLElement>('.organization .reader__title');
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      }
    },
    async regenerate(action, target, chat) {
      if (organizationView.busy) return;
      requireChatMemoryEnabled(state, state.current!.chatId);
      const batchId = target.dataset.id ?? "";
      const range = organizationView.data.ranges.find((row) => row.id === batchId);
      if (!range?.eligible) throw new Error(range?.reason ?? "원문 구간을 다시 선택해 주세요.");
      const canonical = action === "regenerate-canonical";
      organizationView.busy = true;
      organizationView.error = undefined; organizationView.errorReport = undefined;
      render();
      try {
        const estimate = await client.request<RegenerationEstimate>(`/v1/chats/${chat}/extraction-batches/${encodeURIComponent(batchId)}/preview-regeneration`, { method: 'POST', body: JSON.stringify({ canonical }) });
        // A read may finish after the user has left this chat or screen.
        if (!organizationView.open || encodeURIComponent(state.current?.chatId ?? '') !== chat
          || organizationView.selection.length !== 1 || organizationView.selection[0] !== batchId) return;
        organizationView.busy = false;
        render();
        const review = await host.chooseExtractionReviewOverride(
          canonical ? "여기부터 기억 후보를 다시 만들까요?" : "이 구간의 기억 후보를 다시 만들까요?",
          `${canonical ? "선택한 지점부터 최신 원문까지 기억과 상태를 다시 계산합니다." : "선택한 원문 묶음의 기억·세부·대사만 다시 만들고 상태 장부는 유지합니다."} 결과는 자동으로 적용되지 않습니다.\n묶음 ${estimate.batchCount}개 · 메시지 ${estimate.messageCount}개 · 원문 약 ${estimate.rawTokens.toLocaleString()}토큰\n전체 예상 입력 약 ${estimate.estimatedInputTokens.toLocaleString()}토큰, 기본 추출 약 ${estimate.estimatedExtractionCalls}회입니다.${canonical && estimate.estimatedStoryCalls ? `\n적용하면 줄거리 약 ${estimate.estimatedStoryCalls.total}회(구간 ${estimate.estimatedStoryCalls.segment} · 줄거리 묶음 ${estimate.estimatedStoryCalls.arc} · 전체 개요 ${estimate.estimatedStoryCalls.overview})와 관계 약 ${estimate.estimatedRelationshipCalls}회가 이어집니다.` : ''} 재검수·보정에 따라 호출이 늘 수 있고, 실제 청구량과는 다릅니다.`,
          state.settings.postExtractionReview,
        );
        if (review === undefined) return;
        const started = await client.request<{ runId: string }>(`/v1/chats/${chat}/extraction-batches/${encodeURIComponent(batchId)}/${action}`, { method: "POST", body: JSON.stringify({ postExtractionReview: review }) }, 120_000);
        organizationView.candidateId = `regeneration:${started.runId}`;
        organizationView.mobileDetail = true;
        host.drainWorker();
        await host.refresh();
      } catch (error) {
        organizationView.errorReport = formatServerError(error);
        const message = error instanceof Error ? error.message : String(error);
        organizationView.error = `기억 후보 생성을 준비하지 못했습니다. ${message}`;
        host.regenerationFailed(error);
      } finally {
        organizationView.busy = false;
        if (host.isDashboardOpen()) render();
      }
    },
    async openAdditionFromMemory(getSelection) {
      organizationView.open = true;
      host.openTimeline();
      const chat = encodeURIComponent(state.current!.chatId);
      try {
        organizationView.data = await client.request<OrganizationData>(`/v1/chats/${chat}/memory-organization`);
        const { selectedMemory, memoryOpen } = getSelection();
        const rangeIds = organizationMemoryRanges(organizationView.data.ranges, memoryOpen ? selectedMemory : '');
        organizationView.highlightedIds = rangeIds;
        organizationView.selection = rangeIds;
        organizationView.focusedId = rangeIds[0] ?? '';
        organizationView.candidateId = '';
        if (rangeIds.length) await openMemoryAddition(rangeIds);
        else { organizationView.mobileDetail = false; organizationView.addition = undefined; render(); }
      } catch (error) {
        organizationView.errorReport = formatServerError(error); organizationView.error = error instanceof Error ? error.message : String(error); render(); }
    },
    async submit(form, values) {
      if (!state.current || organizationView.busy) return;
      const chatId = state.current!.chatId, chat = encodeURIComponent(chatId);
      organizationView.error = undefined; organizationView.errorReport = undefined;
      try {
        if (form.id === 'organization-addition-form') {
          const addition = organizationView.addition;
          if (!addition || organizationView.busy || addition.estimating || !addition.estimate) return;
          requireChatMemoryEnabled(state, chatId);
          const body={rangeIds:addition.rangeIds,messageIds:addition.selectedIds,request:addition.request,postExtractionReview:state.settings.postExtractionReview};
          const serialized=JSON.stringify(body);
          if(addition.submission?.body!==serialized) addition.submission={key:crypto.randomUUID(),body:serialized};
          organizationView.busy = true; render();
          const created = await client.request<{ runId: string }>(`/v1/chats/${chat}/memory-additions/create`, {
            method: 'POST', body: JSON.stringify({...body,idempotencyKey:addition.submission!.key}),
          });
          if (state.current?.chatId !== chatId) return;
          organizationView.candidateId = `addition:${created.runId}`;
          organizationView.addition = undefined;
          host.drainWorker();
          await host.refresh();
        } else {
          const jumping = form.id === 'organization-jump-form';
          const query = jumping ? `ordinal=${encodeURIComponent(String(values.ordinal))}` : `q=${encodeURIComponent(String(values.query))}`;
          if (jumping) organizationView.jump = String(values.ordinal); else organizationView.search = String(values.query);
          const found = await client.request<{ ranges: OrganizationData['ranges']; messageNumbers: number[]; truncated: boolean }>(`/v1/chats/${chat}/source-ranges/search?${query}`);
          if (state.current?.chatId !== chatId) return;
          organizationView.highlightedIds = found.ranges.map(range => range.id);
          organizationView.searchStatus = found.ranges.length ? `${found.ranges.length}개 구간을 찾았어요${found.truncated ? ' · 처음 200개 메시지만 표시해요' : ''}` : '일치하는 원문 구간이 없어요.';
          organizationView.mobileDetail = false;
          host.renderSourceNavigationCompletion();
          const id = jumping ? organizationJumpRange(found.ranges, Number(values.ordinal)) : found.ranges[0]?.id;
          if (id) scrollOrganizationRange(id);
        }
      } catch (error) {
        organizationView.errorReport = formatServerError(error); organizationView.error = error instanceof Error ? error.message : String(error); }
      finally {
        organizationView.busy = false;
        if (form.id === 'organization-addition-form') render();
        else host.renderSourceNavigationCompletion();
      }
    },
    handleInput(input) {
      if (input.name === 'keep-lost') {
        const selected = new Set(organizationView.keepLostItemIds[organizationView.candidateId]);
        if (input.checked) selected.add(input.value); else selected.delete(input.value);
        organizationView.keepLostItemIds[organizationView.candidateId] = [...selected];
        return true;
      }
      if (input.closest('#organization-addition-form') && organizationView.addition) {
        organizationView.addition.request = input.value;
        organizationView.addition.estimate = undefined;
        additionEstimateEpoch++;
        if (additionEstimateTimer) clearTimeout(additionEstimateTimer);
        const button = root.querySelector<HTMLButtonElement>('#organization-addition-form [data-action="submit-form"]');
        if (button) button.disabled = true;
        additionEstimateTimer = setTimeout(() => void updateAdditionEstimate(), 400);
        return true;
      }
      if (input.closest('#organization-search-form')) { organizationView.search = input.value; return true; }
      if (input.closest('#organization-jump-form')) { organizationView.jump = input.value; return true; }
      return false;
    },
  };
}

// Timeline selection and display state; the dashboard retains dirty-editor/navigation gates.
export interface TimelineViewState {
  query: string;
  landmarkOnly: boolean;
  bookmarkedOnly: boolean;
  pinnedOnly: boolean;
  includeInactive: boolean;
  editing: boolean;
  creating: boolean;
  mobileDetail: boolean;
  sortOrder?: "ascending" | "descending";
  /** Detail whose 아는 인물 is being edited in place. */
  accessEditing?: string;
  textEditing?: {id:string; kind:"detail"|"event"};
}


export interface TimelineMemory {
  id: string;
  active?: boolean;
  landmark?: boolean;
  bookmarked?: boolean;
  pinned?: boolean;
  story_time?: string | null;
  storyTime?: string | null;
  created_revision?: number;
  created_at?: number;
  capsule_parent_id?: string | null;
  memoryKey?: unknown;
  memory_key?: unknown;
  recognitionOnly?: unknown;
}

export const createTimelineView = (): TimelineViewState => ({ query: "", landmarkOnly: false, bookmarkedOnly: false, pinnedOnly: false, includeInactive: false, editing: false, creating: false, mobileDetail: false });

export function filterTimelineMemories<T extends TimelineMemory>(memories: T[], view: Pick<TimelineViewState, "landmarkOnly" | "bookmarkedOnly" | "pinnedOnly" | "includeInactive">): T[] {
  const filtered = memories.filter((memory) => !isRecognitionMemory(memory)
    && (view.includeInactive || memory.active !== false)
    && (!view.landmarkOnly || Boolean(memory.landmark))
    && (!view.bookmarkedOnly || Boolean(memory.bookmarked))
    && (!view.pinnedOnly || Boolean(memory.pinned)));
  return orderStoryMemories(filtered, memories.filter(isScene));
}

export function timelineMemoryView<T extends TimelineMemory>(memories: T[], view: TimelineViewState): { matching: T[]; topLevel: T[] } {
  const sort = view.sortOrder === "ascending" ? 1 : -1;
  const undated = (memory: T): number => Number(!String(memory?.story_time ?? memory?.storyTime ?? "").trim());
  const ordered = (items: T[]) => {
    const sorted = orderStoryMemories(items, memories.filter(isScene));
    return (sort < 0 ? sorted.reverse() : sorted).sort((left, right) => undated(left) - undated(right));
  };
  const matching = ordered(filterTimelineMemories(memories, view));
  const matchingIds = new Set(matching.map((memory) => memory.id));
  const matchingParents = new Set(matching.map((memory) => memory.capsule_parent_id).filter(Boolean));
  const topLevel = ordered(filterTimelineMemories(
    memories.filter((memory) => !memory.capsule_parent_id && (matchingIds.has(memory.id) || matchingParents.has(memory.id))),
    { ...view, landmarkOnly: false, bookmarkedOnly: false, pinnedOnly: false },
  ));
  return { matching, topLevel };
}

export function timelineDefaultMemoryId(memories: TimelineMemory[], view: TimelineViewState): string {
  return String(timelineMemoryView(memories, view).topLevel[0]?.id ?? "");
}


export interface TimelineController {
  applySearch(memoryCount: number): void;
  select(action: "select-memory" | "timeline-adjacent"): void;
  beginManual(): void;
  closeDetail(): void;
  handleViewAction(action: "timeline-filter" | "timeline-order" | "edit-memory", target: HTMLElement, memories: TimelineMemory[], selectedMemory: string): string;
}

export function createTimelineController(timelineView: TimelineViewState, root: HTMLElement): TimelineController {
  return {
    applySearch(memoryCount) {
      const query = timelineView.query.trim().toLocaleLowerCase();
      let visible = 0;
      root.querySelectorAll<HTMLElement>("#memory-rows > .row").forEach((row) => {
        const match = !query || Boolean(row.textContent?.toLocaleLowerCase().includes(query));
        row.hidden = !match;
        if (match) visible += 1;
      });
      let visibleChildren = 0;
      root.querySelectorAll<HTMLDetailsElement>("#memory-rows > .capsule-children").forEach((group) => {
        let childVisible = 0;
        group.querySelectorAll<HTMLElement>(".row").forEach((row) => {
          const match = !query || Boolean(row.textContent?.toLocaleLowerCase().includes(query));
          row.hidden = !match;
          if (match) childVisible += 1;
        });
        group.hidden = childVisible === 0;
        visibleChildren += childVisible;
      });
      const count = root.querySelector<HTMLElement>("[data-timeline-count]");
      if (count) count.textContent = `기억 ${visible}개`;
      const searchEmptyNote = root.querySelector<HTMLElement>("[data-timeline-search-empty]");
      if (searchEmptyNote) searchEmptyNote.hidden = !query || visible + visibleChildren > 0;
      const reader = root.querySelector<HTMLElement>(".timeline .readercol");
      const searchEmpty = Boolean(query) && visible + visibleChildren === 0;
      // The reader keeps its content; a no-match search only swaps which child is shown, so no re-render is needed.
      const showReaderEmpty = !timelineView.creating && memoryCount > 0 && searchEmpty;
      reader?.querySelectorAll<HTMLElement>(":scope > *").forEach((child) => {
        child.style.display = child.hasAttribute("data-timeline-reader-empty") === showReaderEmpty ? "" : "none";
      });
      root.querySelectorAll<HTMLElement>("#memory-rows > [data-day-header]").forEach((header) => {
        const day = header.dataset.dayHeader;
        header.hidden = !Array.from(root.querySelectorAll<HTMLElement>("#memory-rows > .row")).some((row) => row.dataset.day === day && !row.hidden);
      });
    },

    select(action) {
      if (action === "select-memory") { timelineView.textEditing = undefined; timelineView.creating = false; }
      timelineView.editing = false;
      timelineView.mobileDetail = true;
    },
    beginManual() {
      timelineView.editing = false;
      timelineView.creating = true;
      timelineView.mobileDetail = true;
    },
    closeDetail() {
      timelineView.creating = false;
      timelineView.mobileDetail = false;
    },
    handleViewAction(action, target, memories, selectedMemory) {
      if (action === "timeline-filter") {
        timelineView.creating = false;
        const filter = target.dataset.filter;
        if (filter === "bookmark") timelineView.bookmarkedOnly = !timelineView.bookmarkedOnly;
        if (filter === "landmark") timelineView.landmarkOnly = !timelineView.landmarkOnly;
        if (filter === "pinned") timelineView.pinnedOnly = !timelineView.pinnedOnly;
        if (filter === "inactive") timelineView.includeInactive = !timelineView.includeInactive;
        const visible = timelineMemoryView(memories, timelineView);
        const visibleIds = new Set([...visible.matching, ...visible.topLevel].map((memory) => String(memory.id)));
        if (!visibleIds.has(selectedMemory)) selectedMemory = timelineDefaultMemoryId(memories, timelineView);
        timelineView.editing = false;
        return selectedMemory;
      }
      if (action === "timeline-order") {
        timelineView.sortOrder = timelineView.sortOrder !== "ascending" ? "ascending" : "descending";
        return selectedMemory;
      }
      if (action === "edit-memory") {
        timelineView.editing = true;
        return selectedMemory;
      }
      return selectedMemory;
    },
  };
}
