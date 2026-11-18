import { CHAT_WORK_HELD_MESSAGE, type ChatLineageStatus } from "@rcm/shared";
import { CACHE_KEY, saveStoredJson, isChatMemoryEnabled } from '../settings.js';
import type { ServerClient } from "../api-client.js";
import { upgradeErrorReason } from "../server-errors.js";
import type { DashboardData, Tab, confirmDashboard } from "../dashboard.js";
import type { InitialCalibrationActivity, RuntimeState } from "../types.js";
import { currentLineageOperation } from "../lineage-settings.js";
import { setupPickerNeeded, claimSetupAttention, firstOpenSetupPicker, observeSetupAttention, loadSetupPicker, readSetupHost, setupGroups, selectedSetupProjection, type SetupPicker } from "../setup-sources.js";
import { setupEntryLoading, REREAD_NOTICE_HTML, setupSourcesPage } from "./setup-sources.js";
import type { PeopleController } from "./people-actions.js";

export interface DashboardSetupPicker extends SetupPicker {
  upgrade?: {backup:boolean};
  rebuild?: { expectedSourceMessages?: number; extractionReviewOverride: boolean };
}

export interface SetupViewState {
  picker?: DashboardSetupPicker;
  loading: boolean;
  confirming?: "initial-confirm" | "initial-skip";
  openChecked: Set<string>;
}

export const createSetupView = (): SetupViewState => ({ loading: false, openChecked: new Set() });
/** The empty placeholder starts as "unseeded"; trust setup only after the server answered. */
export const setupPendingIn = (data: DashboardData, probe?: RuntimeState["lineageProbe"]): boolean => Boolean(data.loadedDatasets?.includes("initialCalibration")) && setupPickerNeeded(data.initialCalibration?.status, data.lineage, probe);

type InitialSetupAction = "initial-confirm" | "initial-skip" | "save-initial-entity" | "add-initial-entity" | "delete-initial-entity" | "save-initial-relationship";
export function isInitialSetupAction(action: string | undefined): action is InitialSetupAction {
  return ["initial-confirm", "initial-skip", "save-initial-entity", "add-initial-entity", "delete-initial-entity", "save-initial-relationship"].includes(action ?? "");
}

export interface SetupActionHost {
  syncSources(chatId: string): Promise<void>;
  getData(): DashboardData;
  getActiveTab(): Tab;
  setActiveTab(tab: "initial" | "overview"): void;
  clearEditor(): void;
  render(invalidate?: boolean): void;
  refresh(): Promise<void>;
  confirm: typeof confirmDashboard;
  drainWorker(): void;
}

export interface SetupController {
  openUpgrade(backup:boolean): Promise<void>;
  open(action: "open-setup-sources" | "initial-retry", target: HTMLElement): Promise<void>;
  loadPicker(chatId: string): Promise<void>;
  handlePickerAction(action: string, target: HTMLElement): Promise<void>;
  observeRefresh(refreshed: DashboardData, isCurrentRefresh: () => boolean): Promise<void>;
  mutateInitial(action: InitialSetupAction, target: HTMLElement, chat: string,
    people: Pick<PeopleController, "savePerson" | "deleteInitialPerson">): Promise<{ clearEditor: boolean } | undefined>;
  saveRelationshipBaseline(initialBaselineId: string, chat: string, values: Record<string, FormDataEntryValue>, axisNames: string[], summary: string): Promise<void>;
  handleSearch(input: HTMLInputElement): boolean;
}

/** The shell retains shared render/refresh, dirty-editor and action-error boundaries.
 * Live getters deliberately read the current dashboard data again after each await. */
export function createSetupController(setupView: SetupViewState, root: HTMLElement, state: RuntimeState,
  client: Pick<ServerClient, "request">, host: SetupActionHost): SetupController {
  const { render } = host;
  const assertUpgradeEnabled = () => {
    if (!state.current || !isChatMemoryEnabled(state.settings,state.current.chatId,state.current.characterId) || host.getData().upgrade?.workEnabled === false)
      throw Object.assign(new Error(CHAT_WORK_HELD_MESSAGE),{code:'CHAT_WORK_OFF'});
  };
  return {
    async openUpgrade(backup) {
      const chatId = state.current?.chatId;
      if (!chatId || currentLineageOperation(state)) return;
      assertUpgradeEnabled();
      const picker = await loadSetupPicker(state,chatId);
      if (state.current?.chatId !== chatId) return;
      setupView.picker = {...picker,upgrade:{backup}};
      host.setActiveTab('initial'); host.clearEditor(); render(false);
    },
    async open(action, target) {
      if (currentLineageOperation(state)) return;
      if (!state.current || setupView.loading || setupView.confirming) return;
      if (["choice_required", "ambiguous"].includes(host.getData().lineage?.status ?? "")) return;
      if (action === "open-setup-sources" && !setupPendingIn(host.getData(), state.lineageProbe)) return;
      if (action === "initial-retry" && ["ready", "inherited", "skipped"].includes(host.getData().initialCalibration?.status ?? "")
        && !await host.confirm("", false, { title: "초기 설정 다시 읽기", bodyHtml: REREAD_NOTICE_HTML, confirm: "재료 고르기", cancel: "취소", className: "reread-dialog" })) return;
      setupView.loading = true;
      const restoreLoading = setupEntryLoading(target);
      const chatId = state.current.chatId;
      try {
        const loaded = await loadSetupPicker(state, chatId);
        if (state.current?.chatId !== chatId) return;
        loaded.reread = action === "initial-retry" && ["ready", "inherited", "skipped"].includes(host.getData().initialCalibration?.status ?? "");
        setupView.picker = loaded;
        void claimSetupAttention(chatId, "opened").catch(() => undefined);
        host.setActiveTab("initial");
        host.clearEditor();
        render(false);
      } finally { setupView.loading = false; restoreLoading(); }
    },
    async loadPicker(chatId) { setupView.picker = await loadSetupPicker(state, chatId); },
    async handlePickerAction(action, target) {
      const view = setupView.picker!;
      if (view.busy) return;
      const id = target.dataset.id ?? "";
      if (action === "setup-close") { setupView.picker = undefined; host.setActiveTab("overview"); render(false); return; }
      if (action === "setup-tab") view.tab = id === "all" ? "all" : "recommended";
      if (action === "setup-clear") view.selected.clear();
      if (action === "setup-reset") view.selected = new Set(view.items.filter(item => item.defaultSelected).map(item => item.id));
      if (action === "setup-preview") { view.peek = view.peek === id ? undefined : id; view.preview = id; }
      if (action === "setup-toggle") { view.selected.has(id) ? view.selected.delete(id) : view.selected.add(id); }
      if (action === "setup-group") {
        const items = setupGroups(view.items).find(group => group.key === id)?.items.filter(item => item.parsed.trim()) ?? [];
        const all = items.every(item => view.selected.has(item.id));
        items.forEach(item => all ? view.selected.delete(item.id) : view.selected.add(item.id));
      }
      if (action === "setup-submit" || action === "setup-skip") {
        if (state.current?.chatId !== view.chatId) { view.error = "대시보드의 채팅이 바뀌었어요. 재료를 다시 열어 주세요."; render(); return; }
        if (action === "setup-skip" && !await host.confirm("설정 읽기를 건너뛸까요? 직접 정리한 인물과 관계값은 유지해요.")) return;
        if (action === "setup-skip" && ["ready", "inherited", "skipped"].includes(host.getData().initialCalibration?.status)) { setupView.picker = undefined; render(); return; }
        view.busy = true; view.error = undefined; render();
        try {
          if (view.upgrade) {
            if (action !== 'setup-submit') throw new Error('새 버전으로 다시 만들려면 초기 설정 자료를 선택해 주세요.');
            if ((await readSetupHost()).chatId !== view.chatId) throw new Error('Risu에서 이 채팅을 다시 열고 재료를 선택해 주세요.');
            const resolvedSetup = await selectedSetupProjection(view);
            if (!resolvedSetup) throw new Error('읽을 재료를 하나 이상 골라 주세요.');
            assertUpgradeEnabled();
            await host.syncSources(view.chatId);
            state.automaticTurnPacket=undefined; state.lastInjection=undefined;
            delete state.cache[view.chatId];
            void saveStoredJson(CACHE_KEY,state.cache).catch(()=>undefined);
            await client.request(`/v1/chats/${encodeURIComponent(view.chatId)}/upgrade`,{method:'POST',body:JSON.stringify({backup:view.upgrade.backup,resolvedSetup,identityHints:state.current.identityHints})},120_000);
            setupView.picker = undefined;
            host.setActiveTab('overview'); host.drainWorker(); await host.refresh();
            return;
          }
          const lineage = await client.request<ChatLineageStatus>(`/v1/chats/${encodeURIComponent(view.chatId)}/lineage`);
          if (["choice_required", "ambiguous"].includes(lineage.status) || (lineage.status === "inherited" && !view.reread && !view.rebuild)) {
            setupView.picker = undefined;
            await host.refresh();
            return;
          }
          if (action === "setup-submit" && !view.fallback && (await readSetupHost()).chatId !== view.chatId) throw new Error("Risu에서 이 채팅을 다시 열고 재료를 선택해 주세요.");
          const projection = action === "setup-submit" ? await selectedSetupProjection(view) : undefined;
          if (action === "setup-submit" && !projection) throw new Error("읽을 재료를 하나 이상 골라 주세요.");
          const rebuilding = action === "setup-submit" && view.rebuild;
          await host.syncSources(view.chatId);
          const result = await client.request<{ calibration: InitialCalibrationActivity }>(`/v1/chats/${encodeURIComponent(view.chatId)}/${rebuilding ? "reprocess" : `initial-calibration/${action === "setup-submit" ? "retry" : "skip"}`}`, {
            method: "POST", ...(projection ? { body: JSON.stringify({
              ...(rebuilding ? { ...rebuilding, activatePendingMemoryLanguage: true } : {}),
              resolvedSetup: projection, identityHints: state.current.identityHints,
            }) } : {}),
          }, 120_000);
          state.statusSummary = { ...(state.statusSummary ?? { queuedJobs: 0, failedJobs: 0, pendingReviews: 0, pendingEmbeddings: 0, failedEmbeddings: 0 }), initialCalibration: result.calibration };
          host.getData().initialCalibration = { ...host.getData().initialCalibration, ...result.calibration };
          observeSetupAttention(state, view.chatId, result.calibration.status);
          state.publishStatusSummary?.();
          setupView.picker = undefined;
          host.drainWorker();
          await host.refresh();
        } catch (error) {
          view.error = view.upgrade && (error as { code?: string }).code
            ? upgradeErrorReason((error as { code?: string }).code)
            : error instanceof Error ? error.message : "설정을 읽지 못했어요. 다시 시도해 주세요.";
        }
        finally { view.busy = false; state.requestActivityRefresh?.(); }
      }
      render();
    },
    async observeRefresh(refreshed, isCurrentRefresh) {
      if (refreshed.initialCalibration?.status === "awaiting_confirmation"
        && ["overview", "data", "operations"].includes(host.getActiveTab())) host.setActiveTab("initial");
      const setupChatId = refreshed.chatId;
      if (setupChatId && setupChatId === state.current?.chatId && !currentLineageOperation(state)) {
        observeSetupAttention(state, setupChatId, refreshed.initialCalibration?.status, refreshed.lineage);
        if (!setupView.openChecked.has(setupChatId)) {
          setupView.openChecked.add(setupChatId);
          if (!setupView.picker && host.getActiveTab() === "overview") {
            const picker = await firstOpenSetupPicker(state, setupChatId, refreshed.initialCalibration?.status, refreshed.lineage);
            if (picker && isCurrentRefresh() && state.current?.chatId === setupChatId && host.getActiveTab() === "overview") {
              setupView.picker = picker;
              host.setActiveTab("initial");
            }
          }
        }
      }
    },
    async mutateInitial(action, target, chat, people) {
      if (action === "initial-confirm" || action === "initial-skip") {
        if (currentLineageOperation(state) || setupView.confirming) return;
        setupView.confirming = action;
        render(false);
        const chatId = decodeURIComponent(chat);
        try {
          if (action === "initial-skip" && !await host.confirm(host.getData().initialCalibration?.status === "failed"
            ? "초기 분석 없이 원문 기억 생성을 계속할까요? 이름과 별칭은 나중에 인물 설정에서 직접 추가할 수 있어요."
            : "분석된 초기 이름·관계축을 사용하지 않고 원문 기억 생성을 시작할까요?")) return;
          await host.syncSources(chatId);
          const result = await client.request<{ calibration: InitialCalibrationActivity }>(`/v1/chats/${chat}/initial-calibration/${action === "initial-confirm" ? "confirm" : "skip"}`, { method: "POST" }, 120_000);
          if (state.current?.chatId !== chatId) return;
          state.statusSummary = {
            ...(state.statusSummary ?? { queuedJobs: 0, failedJobs: 0, pendingReviews: 0, pendingEmbeddings: 0, failedEmbeddings: 0 }),
            initialCalibration: result.calibration,
          };
          host.getData().initialCalibration = { ...host.getData().initialCalibration, ...result.calibration };
          observeSetupAttention(state, state.current!.chatId, result.calibration.status);
          state.publishStatusSummary?.();
          host.drainWorker();
          return { clearEditor: false };
        } finally { setupView.confirming = undefined; state.requestActivityRefresh?.(); render(false); }
      } else if (action === "save-initial-entity" || action === "add-initial-entity") {
        if (!await people.savePerson(action, target, chat)) return;
        return { clearEditor: true };
      } else if (action === "delete-initial-entity") {
        if (!await people.deleteInitialPerson(target, chat,
          message => host.confirm(message, false, { confirm: "인물 삭제", danger: true }))) return;
        return { clearEditor: true };
      } else if (action === "save-initial-relationship") {
        const form = target.closest<HTMLFormElement>("form");
        if (!form) return;
        const values = new FormData(form);
        const axes = Object.fromEntries(["affection", "trust", "intimacy", "fear", "jealousy", "hostility"].map((axis) => [axis, String(values.get(axis) ?? "unknown")]));
        await client.request(`/v1/chats/${chat}/initial-calibration/relationships/${encodeURIComponent(target.dataset.id ?? "")}`, { method: "PATCH", body: JSON.stringify({ axes, summary: String(values.get("summary") ?? "") }) });
        return { clearEditor: true };
      }
    },
    async saveRelationshipBaseline(initialBaselineId, chat, values, axisNames, summary) {
      const axes = Object.fromEntries(axisNames.map((axis) => [axis, String(values[`${axis}Level`] ?? "unknown")]));
      const result = await client.request<{ ok: boolean }>(`/v1/chats/${chat}/initial-calibration/relationships/${encodeURIComponent(initialBaselineId)}`, {
        method: "PATCH", body: JSON.stringify({ axes, summary }),
      });
      if (!result.ok) throw new Error("초기 관계를 저장하지 못했어요.");
    },
    handleSearch(input) {
      if (!input.hasAttribute("data-setup-search") || !setupView.picker) return false;
      setupView.picker.query = input.value;
      const template = document.createElement("template"); template.innerHTML = setupSourcesPage(setupView.picker);
      const list = root.querySelector("[data-setup-list]");
      if (list) list.innerHTML = template.content.querySelector("[data-setup-list]")?.innerHTML ?? "";
      return true;
    },
  };
}
