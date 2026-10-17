import { sourceRecoverySummary, operationLabel } from "@rcm/shared";
import { modelResponseFailureDetail } from "./support-diagnostics.js";
import { RISU_AUXILIARY_AUTH_FAILURE_MESSAGE } from "@rcm/shared";
import type { RuntimeState } from "./types.js";
import type { ServerClient } from "./api-client.js";
import { addLog, isChatMemoryEnabled, saveSettings } from "./settings.js";
import { describeServerConnectionIssue, isServerConnectionReady, noteServerConnectionFailure, SERVER_RESPONSE_DELAYED } from "./connection.js";
import { latestVisibleCompletedTiming, TIMING_COMPLETION_VISIBLE_MS, timingsForChat, type TimingEvent } from "./timing.js";
import { pluginUpdateNeeded } from "./updates.js";
import { quizEntryButton, quizReloadRow, quizViewHtml } from "./quiz-chip.js";
import { QuizSession } from "./quiz-session.js";

const BUTTON_ID = "risu-cognitive-memory-open";
export const MEMORY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 8a8.5 8.5 0 1 0 .5 7"/><path d="M16 9a4.5 4.5 0 1 0 .4 5"/><path d="M12 12 19.5 8"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19.5" cy="8" r="1.6" fill="currentColor" stroke="none"/></svg>';
const ALERT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e2735d" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/></svg>';
const WIDGET_SELECTOR = '[x-rcm-status-widget="true"]';
const WIDGET_STYLE_SELECTOR = '[x-rcm-status-style="true"]';

/** The chip's tokens, inlined because it lives in the host page. Film keeps its night screening look; phone follows 밤/낮 as a glass capsule. */
export type ChipSkin = {
  screen: string; button: string; hover: string; rule: string; border: string; ink: string; ink2: string; ink3: string;
  accent: string; accentInk: string; accentHover: string; wait: string; cut: string; ok: string; sans: string;
  radius: string; radiusOpen: string; buttonRadius: string; buttonAlign: string; shadow: string; backdrop: string;
};
const FILM_CHIP: ChipSkin = {
  screen: "#0f1012", button: "#16171a", hover: "#1e1f23", rule: "#222328", border: "1px solid #33353b",
  ink: "#ebe8e2", ink2: "#b3afa7", ink3: "#8b8881", accent: "#dba35a", accentInk: "#1b1308", accentHover: "#e6b575", wait: "#dba35a", cut: "#e2735d", ok: "#8fbf9a",
  sans: '"Pretendard Variable",Pretendard,"Pretendard JP","Noto Sans JP","Noto Sans SC",system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif',
  radius: "4px", radiusOpen: "6px", buttonRadius: "3px", buttonAlign: "left", shadow: "0 20px 44px -12px rgba(0,0,0,.85)", backdrop: "none",
};
const PHONE_SANS = '-apple-system,BlinkMacSystemFont,"SF Pro Text","Pretendard Variable",Pretendard,"Pretendard JP","Noto Sans JP","Noto Sans SC",system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';
const PHONE_CHIP_LIGHT: ChipSkin = {
  screen: "rgba(255,255,255,.8)", button: "rgba(118,118,128,.12)", hover: "rgba(118,118,128,.2)", rule: "rgba(60,60,67,.18)", border: ".5px solid rgba(0,0,0,.08)",
  ink: "#000000", ink2: "rgba(60,60,67,.85)", ink3: "#6C6C70", accent: "#007AFF", accentInk: "#ffffff", accentHover: "#0A6CE0", wait: "#FF9500", cut: "#FF3B30", ok: "#34C759",
  sans: PHONE_SANS, radius: "17px", radiusOpen: "16px", buttonRadius: "10px", buttonAlign: "center", shadow: "0 10px 30px -8px rgba(0,0,0,.28)", backdrop: "blur(24px) saturate(1.8)",
};
const PHONE_CHIP_DARK: ChipSkin = {
  screen: "rgba(30,30,32,.8)", button: "rgba(118,118,128,.24)", hover: "rgba(118,118,128,.36)", rule: "rgba(84,84,88,.6)", border: ".5px solid rgba(255,255,255,.12)",
  ink: "#ffffff", ink2: "rgba(235,235,245,.82)", ink3: "rgba(235,235,245,.6)", accent: "#0A84FF", accentInk: "#ffffff", accentHover: "#3395FF", wait: "#FF9F0A", cut: "#FF453A", ok: "#30D158",
  sans: PHONE_SANS, radius: "17px", radiusOpen: "16px", buttonRadius: "10px", buttonAlign: "center", shadow: "0 10px 30px -8px rgba(0,0,0,.6)", backdrop: "blur(24px) saturate(1.8)",
};
export function chipSkin(settings: Pick<RuntimeState["settings"], "dashboardSkin" | "dashboardTheme">): ChipSkin {
  if (settings.dashboardSkin !== "phone") return FILM_CHIP;
  return settings.dashboardTheme === "light" ? PHONE_CHIP_LIGHT : PHONE_CHIP_DARK;
}
const chipSkinKey = (settings: Pick<RuntimeState["settings"], "dashboardSkin" | "dashboardTheme">): string => `${settings.dashboardSkin}:${settings.dashboardTheme}`;
const STATUS_ICON_PATHS: Record<"ok" | "wait" | "bad" | "off", string> = {
  ok: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bad: '<path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/>',
  off: '<circle cx="12" cy="12" r="8"/><path d="M6.3 6.3 17.7 17.7"/>',
};
export const STATUS_TIMED_ATTRIBUTE = "x-rcm-status-timed";
export const STATUS_ROW_TIMED_ATTRIBUTE = "data-rcm-status-row-timed";
export const STATUS_ELAPSED_SELECTOR = '[data-rcm-status-elapsed="true"]';

export function statusElapsedSeconds(startedAt: number, observedAt = Date.now()): number {
  return Math.max(0, Math.floor((observedAt - startedAt) / 1_000));
}

export function statusElapsedLabel(startedAt: number, observedAt = Date.now()): string {
  return `${statusElapsedSeconds(startedAt, observedAt)}초`;
}

export function completedTimingSeconds(elapsedMs = 0): string {
  return `${(Math.max(0, elapsedMs) / 1_000).toFixed(1)}초`;
}

export function shouldShowStatusWidget(state: RuntimeState, dashboardHidden = false): boolean {
  if (state.pendingPrepare?.visible) return true;
  return state.settings.statusWidgetVisible !== false && !dashboardHidden && !!state.current && isChatMemoryEnabled(state.settings, state.current.chatId);
}

interface FloatingWidgetState { kind: string; label: string; detail: string; startedAt?: number; expiresAt?: number }

export function manualRetryState(state: RuntimeState, pending = state.statusSummary?.progress?.manualRetry === true, running?: boolean): FloatingWidgetState | undefined {
  if (!pending) return undefined;
  const current = state.current?.chatId;
  const active = running ?? Boolean(current && (state.currentJob?.chatId === current && state.currentJob?.kind !== "quiz"
    || state.serverWorker?.activeJob?.chatId === current && (state.serverWorker?.activeCalls ?? 0) > 0));
  if (state.settings.workerPaused || state.serverWorker?.state === "paused") return {
    kind: "paused", label: "다시 시도 대기 중", detail: "기억 처리가 일시정지되어 있어요. 처리 재개를 눌러 주세요.",
  };
  if (state.settings.extractionEngine === "risu" && state.mainGeneration && state.mainGeneration.expiresAt > Date.now()) return {
    kind: "queued", label: "다시 시도 대기 중", detail: "메인 응답이 끝나면 다시 시도해요",
  };
  return active ? { kind: "running", label: "다시 시도 중", detail: "실패했던 기억 작업을 다시 처리하고 있어요." }
    : { kind: "queued", label: "다시 시도 대기 중", detail: "작업이 시작되기를 기다리고 있어요." };
}

interface FloatingTimingRow { id: string; label: string; startedAt: number }

function completedTimingState(event: TimingEvent): FloatingWidgetState {
  const failed = event.outcome === "failed";
  const base = event.kind === "automatic_injection"
    ? event.outcome === "reused" ? "준비된 기억 재사용" : "전체 기억 준비"
    : event.label.replace(/ 호출$/, "");
  return {
    kind: failed ? "error" : "completed",
    label: `${base} ${failed ? "실패" : "완료"} · ${completedTimingSeconds(event.elapsedMs)}`,
    detail: failed ? "작업을 완료하지 못했습니다. 자세한 상태는 대시보드에서 확인해 주세요." : "요청한 기억 작업을 마쳤습니다.",
    expiresAt: (event.completedAt ?? 0) + TIMING_COMPLETION_VISIBLE_MS,
  };
}

export const auxiliaryPurposeLabel = operationLabel;

function activeGroupSuffix(state: RuntimeState, event?: { purpose: string; groupOrdinal?: number; groupTotal?: number }): string {
  if (event?.groupOrdinal && event.groupTotal) return ` ${event.groupOrdinal}/${event.groupTotal}`;
  if (event && !["extraction", "extraction_repair", "audit", "audit_repair", "reconciliation", "reconciliation_repair", "state_response_repair"].includes(event.purpose)) return "";
  const progress = liveBackfillProgress(state);
  return progress?.activeGroupOrdinal && progress.activeGroupTotal
    ? ` ${progress.activeGroupOrdinal}/${progress.activeGroupTotal}`
    : "";
}

function activeAuxiliaryLabel(state: RuntimeState, event: { purpose: string; groupOrdinal?: number; groupTotal?: number }): string {
  return `${auxiliaryPurposeLabel(event.purpose)}${activeGroupSuffix(state, event)}`;
}

export function activeStatusTimingRows(state: RuntimeState): FloatingTimingRow[] {
  return [
    ...timingsForChat(state, state.current?.chatId)
      .filter((event) => event.outcome === "running")
      .map((event) => ({ id: `local:${event.id}`, label: event.label, startedAt: event.startedAt })),
    ...(state.serverWorker?.auxiliaryCalls ?? [])
      .filter((event) => event.outcome === "running")
      .map((event) => ({ id: `server:${event.id}`, label: activeAuxiliaryLabel(state, event), startedAt: event.startedAt })),
  ].sort((left, right) => right.startedAt - left.startedAt).slice(0, 6);
}

export function statusTimingKey(state: RuntimeState): string {
  return activeStatusTimingRows(state).map((event) => `${event.id}\u0000${event.label}\u0000${event.startedAt}`).join("\u0001");
}

export function statusVisualKey(state: FloatingWidgetState): string {
  return `${state.kind}\u0000${state.label}\u0000${state.detail}`;
}

export function statusDragStarted(startX: number, startY: number, currentX: number, currentY: number): boolean {
  return Math.hypot(currentX - startX, currentY - startY) >= 6;
}

export function statusPointerRegion(x: number, y: number, width: number, headerHeight = 36): "toggle" | "header" | undefined {
  if (y < 0 || y > headerHeight || x < 0 || x > width) return undefined;
  return x >= width - headerHeight ? "toggle" : "header";
}

export function statusPointInRect(x: number, y: number, rect: { left: number; right: number; top: number; bottom: number }): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function statusWidgetWidth(expanded: boolean, viewportWidth: number): number {
  return Math.max(0, Math.min(expanded ? 232 : 156, viewportWidth - 16));
}

export function clampStatusPosition(left: number, top: number, viewportWidth: number, viewportHeight: number, widgetWidth = 154, widgetHeight = 48): { left: number; top: number } {
  const right = Math.max(8, viewportWidth - Math.max(154, widgetWidth) - 8);
  const bottom = Math.max(8, viewportHeight - Math.max(48, widgetHeight) - 8);
  return { left: Math.max(8, Math.min(right, left)), top: Math.max(8, Math.min(bottom, top)) };
}

function activeBackfillStage(state: RuntimeState): string | undefined {
  return state.currentJob?.phase ?? state.serverWorker?.phase ?? state.serverWorker?.activeJob?.kind;
}

function progressLabel(state: RuntimeState, stage = activeBackfillStage(state)): string {
  const progress = liveBackfillProgress(state);
  if (!progress?.totalGroups) return "";
  return ["first_extraction", "post_extraction_audit", "state_reconciliation", "storing", "retrying"].includes(stage ?? "") && progress.activeGroupOrdinal && progress.activeGroupTotal
    ? ` · ${progress.activeGroupOrdinal}/${progress.activeGroupTotal}`
    : ` · 완료 ${progress.processedGroups}/${progress.totalGroups}`;
}

function progressDetail(state: RuntimeState, fallback: string, activeStage = activeBackfillStage(state)): string {
  const progress = liveBackfillProgress(state);
  if (!progress?.totalGroups) return fallback;
  const stage = activeStage ? ` · ${operationLabel(activeStage)}` : "";
  const groupPosition = ["first_extraction", "post_extraction_audit", "state_reconciliation", "storing", "retrying"].includes(activeStage ?? "") && progress.activeGroupOrdinal && progress.activeGroupTotal
    ? `현재 묶음 ${progress.activeGroupOrdinal}/${progress.activeGroupTotal}`
    : `완료 ${progress.processedGroups}/${progress.totalGroups}`;
  return `${groupPosition}${stage} · 기억 ${progress.memories}개 · 세부 ${progress.details}개`;
}

function liveBackfillProgress(state: RuntimeState): NonNullable<NonNullable<RuntimeState["statusSummary"]>["progress"]> | undefined {
  const progress = state.statusSummary?.progress;
  return progress?.backfillRunId && progress.runComplete !== true ? progress : undefined;
}

function stageProgressDetail(state: RuntimeState, stage: "ledger" | "relationship" | "story", fallback: string): string {
  const progress = liveBackfillProgress(state);
  if (!progress) return fallback;
  if (stage === "ledger" && (progress.ledgerTotal ?? 0) > 0) {
    return `마지막 장부 대조 ${progress.ledgerProcessed ?? 0}/${progress.ledgerTotal} · 겹치거나 교체된 상태를 확인하고 있습니다.`;
  }
  if (stage === "relationship" && (progress.relationshipTotal ?? 0) > 0) {
    return `관계 상태 ${progress.relationshipProcessed ?? 0}/${progress.relationshipTotal} · 인물 사이의 최신 상태를 반영하고 있습니다.`;
  }
  if (stage === "story" && (progress.storyTotal ?? 0) > 0) {
    return `줄거리 ${progress.storyProcessed ?? 0}/${progress.storyTotal} · 완료된 기억을 장면과 이야기 흐름에 반영하고 있습니다.`;
  }
  return fallback;
}

function activeStartedAt(state: RuntimeState): number | undefined {
  if (state.currentJob?.kind !== "quiz" && state.currentJob?.startedAt && state.currentJob.chatId === state.current?.chatId) return state.currentJob.startedAt;
  const active = state.serverWorker?.activeJob;
  return active && (!active.chatId || active.chatId === state.current?.chatId) ? active.startedAt : undefined;
}

export function widgetState(state: RuntimeState): FloatingWidgetState {
  if (state.pendingPrepare?.visible) return { kind: "prepare-choice", label: "기억 준비 중", detail: "기다리면 기억을 담아 보내요. 3분이 지나도 끝나지 않으면 보내지 않아요.", startedAt: state.pendingPrepare.startedAt };
  const summary = state.statusSummary ?? { queuedJobs: 0, failedJobs: 0, pendingReviews: 0, pendingEmbeddings: 0, failedEmbeddings: 0 };
  if (state.current && !isChatMemoryEnabled(state.settings, state.current.chatId)) return { kind: "disabled", label: "꺼짐", detail: "현재 채팅에서는 새 기억 동기화·추출·도구 호출을 사용하지 않습니다." };
  const connectionIssue = state.serverConnectionIssue ?? describeServerConnectionIssue(state.settings);
  if (connectionIssue) return {
    kind: ["unconfigured", "incompatible"].includes(connectionIssue.kind) ? "setup" : "connection",
    label: connectionIssue.kind === "incompatible" ? connectionIssue.title : connectionIssue.kind === "unconfigured" ? "서버 연결 필요" : "연결 정보 확인",
    detail: connectionIssue.detail,
  };
  if (state.activityStatusError === SERVER_RESPONSE_DELAYED) return {
    kind: "connection",
    label: "서버 응답 확인 중",
    detail: SERVER_RESPONSE_DELAYED,
  };
  if (auxiliaryModelMissing(state)) return { kind: "model-setup", label: "설정 필요", detail: MODEL_SETUP_DETAIL };
  if (state.updateApplying) return state.updateApplying.error ? {
    kind: "review",
    label: "업데이트 확인 필요",
    detail: state.updateApplying.error,
  } : {
    kind: "timing",
    label: "서버 업데이트 중",
    detail: `RCM ${state.updateApplying.targetVersion}을 적용하고 다시 연결하고 있습니다.`,
    startedAt: state.updateApplying.startedAt,
  };
  if (state.updateStatus?.restartRequired) return {
    kind: "review",
    label: "서버 재시작 필요",
    detail: `RCM ${state.updateStatus.stagedVersion ?? state.updateStatus.latestServerVersion ?? "새 버전"} 설치를 마치려면 서버를 다시 시작해 주세요.`,
  };
  if (state.updateStatus?.available) return {
    kind: "review",
    label: "업데이트",
    detail: pluginUpdateNeeded(state.updateStatus)
      ? `${state.updateStatus.latestVersion ?? state.updateStatus.latestServerVersion ?? "새 버전"} 서버와 플러그인 업데이트가 필요합니다. 대시보드에서 확인해 주세요.`
      : `${state.updateStatus.latestVersion ?? state.updateStatus.latestServerVersion ?? "새 버전"} 서버 업데이트를 설치할 수 있습니다. 대시보드에서 확인해 주세요.`,
  };
  if (pluginUpdateNeeded(state.updateStatus)) return {
    kind: "review",
    label: "플러그인 업데이트 필요",
    detail: `Risu 플러그인 메뉴의 + 버튼으로 RCM ${state.updateStatus?.latestPluginVersion}을 설치해 주세요.`,
  };
  if (summary.auxiliaryAuthFailed) return { kind: "error", label: "보조 모델 인증 실패", detail: RISU_AUXILIARY_AUTH_FAILURE_MESSAGE };
  const retry = manualRetryState(state);
  if (retry && !(summary.blockingFailedJobs ?? summary.failedJobs)) return retry;
  const completedTiming = latestVisibleCompletedTiming(state, state.current?.chatId);
  if (completedTiming) return completedTimingState(completedTiming);
  const activeTiming = timingsForChat(state, state.current?.chatId).find((event) => event.outcome === "running");
  if (activeTiming) return {
    kind: "timing",
    label: activeTiming.kind === "automatic_injection" ? "전체 기억 준비 중" : activeTiming.kind === "mcp" ? "기억 도구 검색 중" : "보조 모델 처리 중",
    detail: activeTiming.label,
    startedAt: activeTiming.startedAt,
  };
  const activeServerTiming = state.serverWorker?.auxiliaryCalls?.find((event) => event.outcome === "running");
  if (activeServerTiming) return {
    kind: "timing",
    label: activeAuxiliaryLabel(state, activeServerTiming),
    detail: "현재 채팅의 기억을 정리하고 있습니다.",
    startedAt: activeServerTiming.startedAt,
  };
  if (!state.activityReady) return { kind: "checking", label: "확인 중", detail: "현재 채팅의 대기열과 오류 상태를 확인하고 있습니다." };
  if (state.lastPrepare?.lineage?.status === "choice_required" || state.lastPrepare?.lineage?.status === "ambiguous") return {
    kind: "review",
    label: "기억 이어받기 선택",
    detail: (state.lastPrepare.lineage.ambiguousCandidates?.length ?? 0) > 1
      ? "복사된 채팅과 일치하는 원본이 여러 개입니다. 대시보드에서 선택해 주세요."
      : "복사된 채팅에서 기억을 이어받거나 새로 시작할 수 있습니다.",
  };
  const blockingFailures = summary.blockingFailedJobs ?? summary.failedJobs;
  const calibration = summary.initialCalibration;
  const setupCaptured = Boolean(state.current && state.lastResolvedSetup?.chatId === state.current.chatId);
  const historicalBackfillPending = summary.ingestionState === "historical_pending" || Number(summary.historicalBackfillMessages ?? 0) > 0;
  if (calibration?.status === "awaiting_setup") return setupCaptured
    ? { kind: "review", label: "과거 기억 생성 준비됨", detail: "기억 홈에서 ‘과거 대화로 기억 생성’을 눌러 주세요." }
    : { kind: "review", label: "초기 설정 캡처 필요", detail: "채팅에 메시지를 한 번 보내 설정을 가져온 뒤 ‘과거 대화로 기억 생성’을 다시 눌러 주세요." };
  if (calibration?.status === "awaiting_confirmation") return { kind: "review", label: "초기 장부 확인 필요", detail: "분석된 인물과 초기 관계를 확인하면 과거 기억 생성을 이어서 시작합니다." };
  if (calibration?.status === "queued") {
    const startedAt = activeStartedAt(state);
    return {
      kind: "initial",
      label: "초기 장부 생성 중",
      detail: startedAt ? "인물과 초기 관계를 설정 원문에서 정리하고 있습니다." : "초기 장부 작업이 순서를 기다리고 있습니다.",
      startedAt,
    };
  }
  if (setupCaptured && historicalBackfillPending && (!calibration || calibration.status === "unseeded")) return {
    kind: "review",
    label: "과거 기억 생성 준비됨",
    detail: "기억 홈에서 ‘과거 대화로 기억 생성’을 눌러 주세요.",
  };
  if (state.settings.workerPaused) return { kind: "paused", label: "일시정지", detail: "기억 처리가 재개될 때까지 대기합니다." };
  const episode = state.episodeActivity;
  if (episode?.status === "failed") return { kind: "error", label: "캡슐 오류", detail: episode.lastError ?? "에피소드 캡슐을 만들지 못했습니다. 원문과 기존 기억은 그대로입니다." };
  const currentJob = state.currentJob?.kind !== "quiz" && state.currentJob?.chatId === state.current?.chatId ? state.currentJob : undefined;
  if (episode?.status === "queued" || episode?.status === "processing" || currentJob?.phase === "capsule") return { kind: "capsule", label: "에피소드 정리 중", detail: `${episode?.turnCount ?? 0}턴, 약 ${Math.max(1, Math.round((episode?.sourceTokens ?? 0) / 100) / 10)}k 토큰을 정리하고 있습니다.` };
  if (episode?.status === "holding") return { kind: "holding", label: "기억 보류 중", detail: `완료 ${episode.turnCount}턴 · 약 ${Math.max(0, Math.round(episode.sourceTokens / 100) / 10)}k 토큰` };
  const serverActiveJob = state.serverWorker?.activeJob;
  const serverJobIsCurrent = !serverActiveJob?.chatId || serverActiveJob.chatId === state.current?.chatId;
  if (!currentJob && serverActiveJob && !serverJobIsCurrent) return {
    kind: "running", label: "다른 채팅 기억 처리 중", detail: "서버는 모든 채팅의 보조 모델 작업을 한 번에 하나씩 처리합니다.", startedAt: serverActiveJob.startedAt,
  };
  if (state.serverWorker?.phase === "storing") return { kind: "storing", label: "기억 반영 중", detail: progressDetail(state, "추출 결과를 검증하고 장기기억에 반영하고 있습니다."), startedAt: activeStartedAt(state) };
  if (currentJob || (state.serverWorker?.activeCalls ?? 0) > 0) {
    const activeKind = serverActiveJob?.kind;
    const startedAt = activeStartedAt(state);
    const socialBackfill = currentJob?.phase === "social_backfill" || state.serverWorker?.phase === "social_backfill" || activeKind === "social_backfill";
    if (socialBackfill) return { kind: "running", label: "지인 관계 확인 중", detail: "기존 원문에서 직접 확인되는 만남과 인지 관계만 정리하고 있습니다.", startedAt };
    if (currentJob?.phase === "relationship_projection" || state.serverWorker?.phase === "relationship_projection" || activeKind === "relationship_projection") return { kind: "running", label: "관계 변화 정리 중", detail: stageProgressDetail(state, "relationship", "인물 사이의 최신 관계 상태를 반영하고 있습니다."), startedAt };
    if (currentJob?.phase === "story_consolidation" || state.serverWorker?.phase === "story_consolidation" || activeKind === "story_consolidation") return { kind: "running", label: "스토리 흐름 정리 중", detail: stageProgressDetail(state, "story", "완료된 기억을 장면과 이야기 흐름에 반영하고 있습니다."), startedAt };
    const sourceRecovery = currentJob?.sourceRecovery === true || serverActiveJob?.sourceRecovery === true;
    if (sourceRecovery) return { kind: "running", label: "원문 발췌 보완 중", detail: sourceRecoverySummary(currentJob?.sourceRecoveryMetadata ?? serverActiveJob?.sourceRecoveryMetadata) || "검색에 직접 관련된 과거 원문에서 빠진 장기 회상용 발췌가 있는지 확인하고 있습니다.", startedAt };
    const auditing = currentJob?.phase === "post_extraction_audit" || state.serverWorker?.phase === "post_extraction_audit";
    const reconciling = currentJob?.phase === "state_reconciliation" || state.serverWorker?.phase === "state_reconciliation";
    const checkingLedger = currentJob?.phase === "ledger_consistency" || state.serverWorker?.phase === "ledger_consistency" || activeKind === "ledger_consistency";
    const sourceMessageCount = currentJob?.sourceMessageCount ?? serverActiveJob?.sourceMessageCount;
    const sourceTurnCount = currentJob?.sourceTurnCount ?? serverActiveJob?.sourceTurnCount;
    const extractionDetail = sourceTurnCount
      ? `완결 ${sourceTurnCount}턴 · 원문 ${sourceMessageCount ?? 0}개를 정리하고 있습니다.`
      : `원문 ${sourceMessageCount ?? "여러"}개를 정리하고 있습니다.`;
    return {
      kind: "running",
      label: `${auditing ? "추출 결과 재검수 중" : reconciling ? "상태 장부 대조 중" : checkingLedger ? "최종 장부 대조 중" : "기억 추출 중"}${progressLabel(state)}`,
      detail: auditing
        ? progressDetail(state, "원문과 1차 기억 초안을 다시 대조하고 있습니다.")
        : reconciling
          ? progressDetail(state, "기존 세계 사실·인물 인식·약속과 새 관측을 대조하고 있습니다.")
          : checkingLedger
            ? stageProgressDetail(state, "ledger", "백필 전체에서 겹치거나 교체된 상태가 남았는지 제한적으로 확인하고 있습니다.")
            : progressDetail(state, extractionDetail),
      startedAt,
    };
  }
  if (state.settings.workerAttention || blockingFailures > 0 || summary.failedEmbeddings > 0) return { kind: "error", label: "오류", detail: `실패 ${blockingFailures + summary.failedEmbeddings || 1}건, 확인이 필요합니다.` };
  if (summary.progress?.retryAttempt) return {
    kind: "queued",
    label: `재시도 ${summary.progress.retryAttempt}/${summary.progress.retryMax ?? 3}`,
    detail: "같은 기억 묶음을 다시 처리한 뒤 다음 묶음으로 넘어갑니다.",
  };
  if (summary.pendingEmbeddings > 0 && state.serverWorker?.embeddingConfigured !== false) return { kind: "indexing", label: `검색 인덱싱 ${summary.pendingEmbeddings}`, detail: "새 기억의 벡터 검색 인덱스를 만들고 있습니다." };
  if (summary.queuedJobs > 0) {
    const count = summary.queuedJobs;
    return { kind: "queued", label: `대기 ${count}`, detail: "백그라운드 기억 작업이 순서를 기다립니다." };
  }
  if (summary.pendingReviews > 0) return { kind: "review", label: `상태 확인 ${summary.pendingReviews}`, detail: `확인할 기록 ${summary.pendingReviews}개가 기다리고 있습니다.` };
  if ((summary.advisoryFailedJobs ?? 0) > 0) return {
    kind: "review", label: `부가 정리 확인 ${summary.advisoryFailedJobs}`,
    detail: "기억 추출은 계속 완료됐습니다. 관계·줄거리·최종 대조 실패는 처리 상태에서 확인할 수 있습니다.",
  };
  if (state.lastPrepare?.lineage?.status === "inherited" && !state.lastPrepare.lineage.acknowledgedAt) return {
    kind: "review",
    label: state.lastPrepare.lineage.kind === "branch" ? "분기 기억 이어받음" : "복사 기억 이어받음",
    detail: state.lastPrepare.lineage.kind === "branch"
      ? "분기 이전의 기억을 이어받았습니다."
      : "선택한 원본 채팅의 기억을 이어받았습니다.",
  };
  if (state.perspectiveStatus?.unresolved && state.perspectiveStatus.omissionReason !== "no_memories") return {
    kind: "review",
    label: "관점 확인 필요",
    detail: state.perspectiveStatus.omissionReason === "unresolved_perspective"
      ? "등장인물 관점을 확정하지 못해 공유 기억만 안전하게 사용했습니다. Settings에서 자동 감지 결과를 확인하세요."
      : "마지막으로 확인된 관점 또는 공유 기억만 사용하고 있습니다.",
  };
  const quiz = state.currentJob?.kind === "quiz" ? state.currentJob : state.serverWorker?.quizGenerating;
  if (state.current && quiz?.chatId === state.current.chatId) return {
    kind: "quiz", label: "퀴즈 만드는 중", detail: "보조 모델이 새 퀴즈를 만들고 있어요.",
  };
  if (state.translationBackgroundRunning) return { kind: "quiz", label: "백그라운드 번역 중", detail: "보조 모델이 참고 번역을 만들고 있어요." };
  return { kind: "idle", label: "정상", detail: "새 기억 작업을 기다리고 있습니다." };
}

export const MODEL_SETUP_DETAIL = "보조 모델이 설정되지 않아 기억을 만들 수 없어요.";
export const EMBEDDING_SETUP_DETAIL = "검색 임베딩이 없어 키워드 검색만 사용해요.";
export function auxiliaryModelMissing(state: RuntimeState): boolean {
  return state.settings.extractionEngine === "server" ? state.serverWorker?.modelConfigured === false
    : !["main", "memory", "otherAx", "static"].includes(state.settings.auxiliaryMode)
      || (state.settings.auxiliaryMode === "static" && !state.settings.staticModel.trim());
}

export async function installStatusWidget(state: RuntimeState, client: ServerClient): Promise<void> {
  let installedRoot: SafeRootDocument | undefined;
  let installedWidget: SafeRootElement | undefined;
  let installedWidgetStyle: SafeRootElement | undefined;
  let elapsedTimer: number | undefined;
  let completionTimer: number | undefined;
  let elapsedClockStopped = false;
  const installedListeners: Array<{ type: string; id: string }> = [];
  try {
    const root = await risuai.getRootDocument();
    installedRoot = root;
    const bodyHost = await root.querySelector("body");
    if (!bodyHost) throw new Error("Status widget requires a document body");
    await (await root.querySelector(WIDGET_SELECTOR))?.remove();
    await (await root.querySelector(WIDGET_STYLE_SELECTOR))?.remove();
    const widgetStyle = await root.createElement("style");
    installedWidgetStyle = widgetStyle;
    await widgetStyle.setAttribute("x-rcm-status-style", "true");
    const widgetStyleText = (skin: ChipSkin) => `
[x-rcm-status-widget] button:focus-visible{outline:1.5px solid ${skin.accent};outline-offset:-3px}
[x-rcm-status-widget] button:not([aria-disabled="true"]):not([data-rcm-quiz-scene]):hover{background:${skin.hover}!important}
[x-rcm-status-widget] button:is([data-rcm-open]:not([data-quiet]),[data-rcm-quiz-start],[data-rcm-quiz-next]):hover{background:${skin.accentHover}!important;color:${skin.accentInk}!important}
@media(pointer:coarse){
[x-rcm-status-widget] [data-rcm-drag]{height:44px!important}
[x-rcm-status-widget] button{min-height:36px!important}
[x-rcm-status-widget] [data-rcm-toggle]{width:44px!important;height:44px!important}
[x-rcm-status-widget][x-rcm-expanded="false"] [data-rcm-drag]{height:34px!important}
[x-rcm-status-widget][x-rcm-expanded="false"] [data-rcm-toggle]{height:34px!important;min-height:34px!important}
}
`;
    await widgetStyle.setTextContent(widgetStyleText(chipSkin(state.settings)));
    const styleHost = await root.querySelector("head") ?? bodyHost;
    await styleHost.appendChild(widgetStyle);
    const widget = await root.createElement("div");
    installedWidget = widget;
    await widget.setAttribute("x-rcm-status-widget", "true");
    const viewportWidth = await root.clientWidth();
    const viewportHeight = await root.clientHeight();
    const savedPosition = state.settings.statusWidgetPosition;
    const initialPosition = clampStatusPosition(savedPosition?.left ?? viewportWidth - statusWidgetWidth(false, viewportWidth) - 8, savedPosition?.top ?? viewportHeight - 140, viewportWidth, viewportHeight);
    let widgetLeft = initialPosition.left;
    let widgetTop = initialPosition.top;
    const baseStyles: Record<string, string> = {
      display: "none", position: "fixed", zIndex: "2147482900", boxSizing: "border-box", minWidth: "0", maxWidth: "calc(100vw - 16px)",
      fontSize: "12.5px", overflow: "hidden", left: `${widgetLeft}px`, top: `${widgetTop}px`,
    };
    for (const [name, value] of Object.entries(baseStyles)) await widget.setStyle(name, value);
    // The skin's surface: re-applied whenever the dashboard's skin or brightness changes.
    let appliedSkinKey = "";
    const applySkin = async (): Promise<ChipSkin> => {
      const skin = chipSkin(state.settings);
      const key = chipSkinKey(state.settings);
      if (key === appliedSkinKey) return skin;
      appliedSkinKey = key;
      const surface: Record<string, string> = {
        border: skin.border, borderRadius: skin.radius, backgroundColor: skin.screen, color: skin.ink, boxShadow: skin.shadow,
        fontFamily: skin.sans, backdropFilter: skin.backdrop, webkitBackdropFilter: skin.backdrop,
      };
      for (const [name, value] of Object.entries(surface)) await widget.setStyle(name, value);
      await widgetStyle.setTextContent(widgetStyleText(skin));
      return skin;
    };
    await applySkin();
    let expanded = false;
    let press: { x: number; y: number; region: "header" | "action" } | undefined;
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    let callObservedAt = 0;
    let actionError = "";
    let renderedStatusKey = "";
    // The quiz lives inside the expanded chip; QuizSession keeps its state and drops replies from another chat.
    const quizConnectionReady = (): boolean => isServerConnectionReady(state);
    const quiz = new QuizSession({
      client, chatId: () => state.current?.chatId,
      connectionReady: quizConnectionReady,
      connectionFailed: (error) => { noteServerConnectionFailure(state, state.settings, error); },
      enabled: () => state.settings.quizEnabled === true && state.quizSupported !== false && !!state.current && isChatMemoryEnabled(state.settings, state.current.chatId),
      setSupported: (supported) => { state.quizSupported = supported; },
      log: (message) => addLog(state.logs, "warn", message),
    });
    const quizOn = (): boolean => quizConnectionReady() && state.settings.quizEnabled === true && state.quizSupported !== false && !!state.current && isChatMemoryEnabled(state.settings, state.current.chatId);
    let elapsedLabelElement: SafeRootElement | undefined;
    let elapsedRowElements: SafeRootElement[] = [];
    let elapsedMarkerErrorReported = false;
    const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    const eventInsideWidget = async (event: any): Promise<{ inside: boolean; x: number; y: number; width: number; height: number }> => {
      const x = Number(event.clientX) - widgetLeft;
      const y = Number(event.clientY) - widgetTop;
      const width = await widget.clientWidth();
      const height = await widget.clientHeight();
      return { inside: Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= width && y >= 0 && y <= height, x, y, width, height };
    };
    const currentVisual = () => {
      const current = widgetState(state);
      if (["running", "initial", "storing", "capsule", "timing"].includes(current.kind)) {
        if (current.startedAt) callObservedAt = current.startedAt;
        else if (!callObservedAt) callObservedAt = Date.now();
        current.startedAt = callObservedAt;
      } else callObservedAt = 0;
      const tone: keyof typeof STATUS_ICON_PATHS = current.kind === "disabled" ? "off"
        : current.kind === "model-setup" ? "wait"
        : current.kind === "error" || ["paused", "review", "queued", "holding", "checking", "setup", "connection"].includes(current.kind) ? "bad"
          : ["running", "initial", "capsule", "storing", "indexing", "timing", "quiz", "prepare-choice"].includes(current.kind) ? "wait" : "ok";
      const skin = chipSkin(state.settings);
      const color = current.kind === "quiz" ? skin.ink3 : tone === "bad" ? skin.cut : tone === "wait" ? skin.wait : tone === "off" ? skin.ink3 : skin.ok;
      return { current, color, tone };
    };
    const cacheElapsedClockElements = async (rowCount: number): Promise<void> => {
      elapsedLabelElement = await widget.querySelector(STATUS_ELAPSED_SELECTOR) ?? undefined;
      const nextRows = await Promise.all(Array.from({ length: rowCount }, (_, index) => (
        widget.querySelector(`[${STATUS_ROW_TIMED_ATTRIBUTE}="${index}"]`)
      )));
      elapsedRowElements = nextRows.filter((element): element is SafeRootElement => Boolean(element));
      const missingMarkers = !elapsedLabelElement || elapsedRowElements.length !== rowCount;
      if (missingMarkers && !elapsedMarkerErrorReported) {
        elapsedMarkerErrorReported = true;
        addLog(state.logs, "warn", "Status widget clock markers were removed by host HTML sanitization");
      } else if (!missingMarkers) elapsedMarkerErrorReported = false;
    };
    const syncElapsedClocks = async (current: FloatingWidgetState): Promise<void> => {
      const startedAt = current.startedAt ?? 0;
      const observedAt = Date.now();
      const updates: Promise<void>[] = [];
      if (elapsedLabelElement) updates.push(elapsedLabelElement.setTextContent(startedAt ? ` · ${statusElapsedLabel(startedAt, observedAt)}` : ""));
      const rows = activeStatusTimingRows(state);
      for (let index = 0; index < Math.min(rows.length, elapsedRowElements.length); index += 1) {
        updates.push(elapsedRowElements[index]!.setTextContent(statusElapsedLabel(rows[index]!.startedAt, observedAt)));
      }
      await Promise.all(updates);
    };
    const keepInViewport = async (): Promise<void> => {
      await widget.setStyle("width", expanded ? `${statusWidgetWidth(true, await root.clientWidth())}px` : "max-content");
      const skin = chipSkin(state.settings);
      await widget.setStyle("borderRadius", expanded ? skin.radiusOpen : skin.radius);
      const width = await widget.clientWidth() || statusWidgetWidth(expanded, await root.clientWidth());
      const position = clampStatusPosition(
        widgetLeft,
        widgetTop,
        await root.clientWidth(),
        await root.clientHeight(),
        width,
        await widget.clientHeight(),
      );
      if (position.left !== widgetLeft) { widgetLeft = position.left; await widget.setStyle("left", `${widgetLeft}px`); }
      if (position.top !== widgetTop) { widgetTop = position.top; await widget.setStyle("top", `${widgetTop}px`); }
    };
    let dashboardHidden = false;
    let widgetChatId = state.current?.chatId;
    const syncVisibility = async () => {
      if (widgetChatId !== state.current?.chatId) {
        widgetChatId = state.current?.chatId;
        expanded = false;
        actionError = "";
        quiz.reset();
      }
      const visible = shouldShowStatusWidget(state, dashboardHidden);
      await widget.setStyle("display", visible ? "block" : "none");
      return visible;
    };
    const patchStatus = async () => {
      if (!await syncVisibility()) return;
      await keepInViewport();
      const { current, color } = currentVisual();
      await (await widget.querySelector('[data-rcm-status-dot="true"]'))?.setStyle("color", color);
      await (await widget.querySelector('[data-rcm-status-label-text="true"]'))?.setTextContent(current.label);
      await syncElapsedClocks(current);
      await (await widget.querySelector('[data-rcm-status-detail="true"]'))?.setTextContent(current.detail);
    };
    let patchQueue = Promise.resolve();
    const schedulePatch = (): Promise<void> => {
      patchQueue = patchQueue.then(patchStatus, patchStatus);
      return patchQueue;
    };
    const patchElapsedOnly = async (): Promise<void> => {
      if (!shouldShowStatusWidget(state, dashboardHidden)) return;
      await syncElapsedClocks(currentVisual().current);
    };
    let elapsedClockErrorReported = false;
    const reportElapsedClockError = (error: unknown): void => {
      if (elapsedClockErrorReported) return;
      elapsedClockErrorReported = true;
      addLog(state.logs, "warn", `Status widget clock update failed: [오류 원문 제외]`);
    };
    const clearElapsedTick = (): void => {
      if (elapsedTimer === undefined) return;
      window.clearTimeout(elapsedTimer);
      elapsedTimer = undefined;
    };
    const clearCompletionExpiry = (): void => {
      if (completionTimer === undefined) return;
      window.clearTimeout(completionTimer);
      completionTimer = undefined;
    };
    const scheduleCompletionExpiry = (current: FloatingWidgetState): void => {
      clearCompletionExpiry();
      if (!current.expiresAt) return;
      const delay = Math.max(0, current.expiresAt - Date.now());
      completionTimer = window.setTimeout(() => {
        completionTimer = undefined;
        void render().then(scheduleElapsedTick, reportElapsedClockError);
      }, delay);
    };
    const scheduleElapsedTick = (): void => {
      if (elapsedClockStopped || elapsedTimer !== undefined || !shouldShowStatusWidget(state, dashboardHidden)) return;
      if (!currentVisual().current.startedAt) return;
      elapsedTimer = window.setTimeout(() => {
        elapsedTimer = undefined;
        // Schedule the next timeout only after the SafeRoot bridge answers. The
        // host message breaks Chrome's hidden-frame chained-timer sequence.
        void patchElapsedOnly().then(() => {
          elapsedClockErrorReported = false;
        }, reportElapsedClockError).finally(scheduleElapsedTick);
      }, 1_000);
    };
    const requestElapsedPatch = (): void => {
      void patchElapsedOnly().then(() => {
        elapsedClockErrorReported = false;
      }, reportElapsedClockError);
      scheduleElapsedTick();
    };
    state.setStatusWidgetHidden = async (hidden) => {
      dashboardHidden = hidden;
      if (hidden) clearElapsedTick();
      if (!await syncVisibility()) return;
      // The elapsed timer sleeps while the dashboard covers the widget. Rebase
      // its text to wall time before revealing the widget again.
      await widget.setStyle("visibility", "hidden");
      await schedulePatch();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      await widget.setStyle("visibility", "visible");
      await schedulePatch();
      scheduleElapsedTick();
    };
    const render = async () => {
      await syncVisibility();
      await keepInViewport();
      const { current, color, tone } = currentVisual();
      const pendingPrepare = state.pendingPrepare;
      if (current.kind === "prepare-choice") expanded = true;
      const skin = await applySkin();
      renderedStatusKey = `${statusVisualKey(current)}\u0002${statusTimingKey(state)}\u0002${chipSkinKey(state.settings)}\u0002${state.serverWorker?.embeddingConfigured}\u0002${sourceRecoverySummary(state.statusSummary?.lastJobSourceRecovery)}`;
      const compactButtonStyle = `min-width:0;min-height:32px;border:0;border-radius:${skin.buttonRadius};background:${skin.button};color:${skin.ink};cursor:pointer;text-align:${skin.buttonAlign};font-family:inherit;font-size:12px;font-weight:600;line-height:1.5;white-space:normal;word-break:keep-all;overflow-wrap:anywhere;padding:6px 10px`;
      const activeRows = activeStatusTimingRows(state);
      const showDetail = !activeRows.some(event => event.label === current.detail);
      let body = showDetail ? `<div data-rcm-status-detail="true" style="color:${skin.ink2}">${escapeHtml(current.detail)}</div>` : "";
      const recovery = !state.currentJob && !state.serverWorker?.activeJob ? sourceRecoverySummary(state.statusSummary?.lastJobSourceRecovery) : "";
      if (recovery) body += `<div style="color:${skin.ink2}">${escapeHtml(recovery)}</div>`;
      body += modelResponseFailureDetail(state.statusSummary?.modelResponseDiagnostic, escapeHtml);
      if (current.kind === "prepare-choice" && pendingPrepare) body += `<div style="display:flex;gap:6px;margin-top:8px"><button data-rcm-prepare-omit="${escapeHtml(pendingPrepare.requestId)}" style="${compactButtonStyle};flex:1 1 0">기억 없이 보내기</button><button data-rcm-prepare-block="${escapeHtml(pendingPrepare.requestId)}" style="${compactButtonStyle};flex:1 1 0">보내지 않기</button></div>`;
      if (current.kind === "model-setup") body += `<button data-rcm-model-settings="true" style="${compactButtonStyle};width:100%;margin-top:6px">모델 설정 열기</button>`;
      if (quizConnectionReady() && state.serverWorker?.embeddingConfigured === false) body += `<p style="margin:8px 0 0;color:${skin.ink3};overflow-wrap:anywhere">${EMBEDDING_SETUP_DETAIL}</p><button data-rcm-embedding-settings="true" style="${compactButtonStyle};width:100%;margin-top:6px">검색 임베딩 설정 열기</button>`;
      const observedAt = Date.now();
      const timingRows = activeRows.map((event, index) => {
        return `<div style="display:flex;gap:6px;justify-content:space-between;padding-top:4px;font-variant-numeric:tabular-nums"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(event.label)}</span><span style="color:${skin.ink3};white-space:nowrap">진행 중 · <span ${STATUS_ROW_TIMED_ATTRIBUTE}="${index}">${statusElapsedLabel(event.startedAt, observedAt)}</span></span></div>`;
      }).join("");
      if (timingRows) body += `<div${showDetail ? ` style="border-top:1px solid ${skin.rule};margin-top:8px;padding-top:4px"` : ""}><div style="font-size:11px;color:${skin.ink3}">진행 중인 작업</div>${timingRows}</div>`;
      const dashboardLabel = state.statusSummary?.initialCalibration?.status === "awaiting_confirmation" ? "초기 장부 확인" : "대시보드";
      const waitingSince = state.activeModelRequest?.chatId === state.current?.chatId ? state.activeModelRequest?.startedAt : undefined;
      const quizStart = quizEntryButton(quizOn() ? quiz.next : undefined, skin, Boolean(waitingSince));
      const quizEntry = quizStart || (quizOn() && quiz.loadFailed ? quizReloadRow(skin) : "");
      const quizReady = quizOn() && quiz.next?.available && quiz.next.question;
      const dashboardTone = quizReady ? `background:${skin.button};color:${skin.ink}` : `background:${skin.accent};color:${skin.accentInk}`;
      // While the user decides how to send, the decision is the only action; the dashboard can wait.
      if (current.kind !== "prepare-choice") body += `${state.settings.workerPaused ? `<button data-rcm-resume="true" style="${compactButtonStyle};width:100%;margin-top:6px">처리 재개</button>` : ""}${quizEntry}<button data-rcm-open="true"${quizReady ? " data-quiet" : ""} style="${compactButtonStyle};width:100%;margin-top:6px;${dashboardTone}">${dashboardLabel} 열기</button>`;
      if (current.kind !== "prepare-choice" && quizOn() && quiz.view) body = quizViewHtml(quiz.view, skin);
      if (actionError) body = `<div role="alert" style="border-radius:${skin.buttonRadius};padding:7px 9px;margin-bottom:8px;background:rgba(226,115,93,.12);color:${skin.cut}">${escapeHtml(actionError)}</div>${body}`;
      await widget.setAttribute("x-rcm-expanded", String(expanded));
      await widget.setAttribute(STATUS_TIMED_ATTRIBUTE, current.startedAt ? "true" : "false");
      await widget.setInnerHTML(`<div data-rcm-drag="true" style="box-sizing:border-box;display:flex;align-items:center;gap:8px;height:34px;padding:0 4px 0 12px;cursor:grab;touch-action:none;white-space:nowrap"><span data-rcm-status-dot="true" aria-hidden="true" style="display:grid;place-items:center;width:14px;height:14px;flex:none;color:${color}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${STATUS_ICON_PATHS[tone]}</svg></span><strong data-rcm-status-label="true" title="${escapeHtml(current.label)}" style="display:flex;align-items:baseline;flex:1;min-width:0;line-height:1.4;white-space:nowrap;font-weight:600"><span aria-hidden="true" style="flex:none">RCM&nbsp;·&nbsp;</span><span data-rcm-status-label-text="true" style="min-width:0;overflow:hidden;text-overflow:ellipsis">${escapeHtml(current.label)}</span><span data-rcm-status-elapsed="true" aria-hidden="true" style="flex:none;font-weight:400;color:${skin.ink3};font-variant-numeric:tabular-nums">${current.startedAt ? ` · ${statusElapsedLabel(current.startedAt, observedAt)}` : ""}</span></strong><button type="button" data-rcm-toggle="true" aria-label="${expanded ? "접기" : "펼치기"}" style="display:grid;place-items:center;width:28px;height:28px;flex:none;border:0;background:transparent;border-radius:${skin.buttonRadius};color:${skin.ink3};cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="transform:rotate(${expanded ? "90deg" : "0deg"})"><path d="m9 6 6 6-6 6"/></svg></button></div>${expanded ? `<div style="border-top:1px solid ${skin.rule};padding:10px;line-height:1.55;max-height:calc(100vh - 60px);overflow:auto;box-sizing:border-box">${body}</div>` : ""}`);
      await cacheElapsedClockElements(expanded ? activeStatusTimingRows(state).length : 0);
      await syncElapsedClocks(current);
      await keepInViewport();
      scheduleCompletionExpiry(current);
    };

    const toggleExpanded = async (): Promise<void> => {
      expanded = !expanded;
      await render();
      if (expanded && !quiz.view && quizOn()) {
        await quiz.refresh();
        if (expanded) await render();
      }
    };

    type WidgetAction = { key: string; selector: string; run: () => void | Promise<void> };
    const closeQuiz = async (): Promise<void> => { quiz.close(); await quiz.refresh(); await render(); };
    const widgetActions = (): WidgetAction[] => {
      const pending = state.pendingPrepare;
      const actions: WidgetAction[] = [
        ...(pending?.visible ? (["omit", "block"] as const).map(choice => ({ key: `prepare-${choice}`, selector: `[data-rcm-prepare-${choice}="${pending.requestId}"]`, run: () => pending.choose(choice) })) : []),
        { key: "toggle", selector: '[data-rcm-toggle="true"]', run: toggleExpanded },
        { key: "open", selector: '[data-rcm-open="true"]', run: () => state.openDashboard?.() },
        ...["model", "embedding"].map((section): WidgetAction => ({ key: `${section}-settings`, selector: `[data-rcm-${section}-settings="true"]`, run: () => { state.dashboardFocusSettings = section as "model" | "embedding"; state.openDashboard?.(); } })),
        { key: "quiz-start", selector: '[data-rcm-quiz-start="true"]', run: async () => { quiz.start(); await render(); } },
        ...[0, 1, 2, 3].map((index): WidgetAction => ({ key: `quiz-option-${index}`, selector: `[data-rcm-quiz-option="${index}"]`, run: async () => { await quiz.answer(index); await render(); } })),
        { key: "quiz-next", selector: '[data-rcm-quiz-next="true"]', run: async () => { await quiz.advance(); await render(); } },
        { key: "quiz-close", selector: '[data-rcm-quiz-close="true"]', run: closeQuiz },
        { key: "quiz-done", selector: '[data-rcm-quiz-done="true"]', run: closeQuiz },
        { key: "quiz-scene", selector: "[data-rcm-quiz-scene]", run: () => {
          const memoryId = quiz.view?.mode === "result" ? quiz.view.answer.scene?.memoryId : undefined;
          if (memoryId) state.dashboardFocusMemoryId = memoryId;
          state.openDashboard?.();
        } },
        { key: "quiz-reload", selector: '[data-rcm-quiz-reload="true"]', run: async () => { await quiz.refresh(); await render(); } },
        { key: "quiz-retry", selector: '[data-rcm-quiz-retry="true"]', run: async () => { await quiz.retryLast(); await render(); } },
        { key: "resume", selector: '[data-rcm-resume="true"]', run: async () => { state.settings.workerPaused = false; delete state.settings.workerAttention; await saveSettings(state.settings); if (state.settings.extractionEngine === "server") state.serverWorker = await client.resumeServerWorker(state.workerId); else void import("./worker.js").then(({ drainWorker }) => drainWorker(state, client)); await render(); } },
      ];
      return actions;
    };
    const actionAt = async (x: number, y: number): Promise<WidgetAction | undefined> => {
      for (const action of widgetActions()) {
        const element = await widget.querySelector(action.selector);
        if (!element) continue;
        const rect = await element.getBoundingClientRect();
        if (statusPointInRect(x, y, rect)) return action;
      }
      return undefined;
    };
    const runAction = async (action: WidgetAction): Promise<void> => {
      actionError = "";
      try {
        await action.run();
      } catch (error) {
        actionError = String(error).replace(/^Error:\s*/, "");
        addLog(state.logs, "warn", `Episode action failed: [오류 원문 제외]`);
        await render();
      }
    };
    // Polling may update the compact status, but it must not rebuild an open
    // picker/confirmation panel while the user is scrolling or deciding.
    state.refreshQuizWidget = async () => {
      quiz.reset();
      await quiz.refresh();
      await render();
    };
    let quizReadiness = "";
    state.refreshStatusWidget = () => {
      const readiness = `${quizOn()}:${state.serverWorker?.modelConfigured}`;
      if (readiness !== quizReadiness) {
        quizReadiness = readiness;
        if (!quizOn()) quiz.reset();
        else if (expanded && !quiz.view) void quiz.refresh().then(render);
      }
      const next = currentVisual().current;
      const nextKey = `${statusVisualKey(next)}\u0002${statusTimingKey(state)}\u0002${chipSkinKey(state.settings)}\u0002${state.serverWorker?.embeddingConfigured}\u0002${sourceRecoverySummary(state.statusSummary?.lastJobSourceRecovery)}`;
      // An open quiz is not rebuilt by status polls; only a chat or skin change redraws it.
      const quizHolds = next.kind !== "prepare-choice" && quizOn() && Boolean(quiz.view) && nextKey.split("")[2] === renderedStatusKey.split("")[2];
      if (widgetChatId !== state.current?.chatId || (nextKey !== renderedStatusKey && !quizHolds)) {
        renderedStatusKey = nextKey;
        void render().then(scheduleElapsedTick, reportElapsedClockError);
      } else requestElapsedPatch();
    };
    await bodyHost.appendChild(widget);
    await render();
    const listen = async (type: string, callback: (event: any) => void | Promise<void>): Promise<void> => {
      installedListeners.push({ type, id: await root.addEventListener(type, callback) });
    };
    await listen("pointerdown", async (event: any) => {
      const hit = await eventInsideWidget(event);
      if (!hit.inside) return;
      const pointerRegion = statusPointerRegion(hit.x, hit.y, hit.width, await (await widget.querySelector('[data-rcm-drag="true"]'))?.clientHeight() ?? 36);
      if (pointerRegion === "toggle") {
        press = { x: Number(event.clientX), y: Number(event.clientY), region: "action" };
        return;
      }
      const region = pointerRegion === "header" ? "header" : undefined;
      press = { x: Number(event.clientX), y: Number(event.clientY), region: region ?? "action" };
      dragging = false;
      offsetX = Number(event.clientX) - widgetLeft; offsetY = Number(event.clientY) - widgetTop;
    });
    await listen("pointermove", async (event: any) => {
      if (!press) return;
      if (!dragging && !statusDragStarted(press.x, press.y, Number(event.clientX), Number(event.clientY))) return;
      if (press.region === "action") {
        press = undefined;
        return;
      }
      dragging = true;
      const width = await root.clientWidth();
      const height = await root.clientHeight();
      const position = clampStatusPosition(Number(event.clientX) - offsetX, Number(event.clientY) - offsetY, width, height, await widget.clientWidth(), await widget.clientHeight());
      widgetLeft = position.left;
      widgetTop = position.top;
      state.settings.statusWidgetPosition = { left: widgetLeft, top: widgetTop };
      await widget.setStyle("left", `${widgetLeft}px`); await widget.setStyle("top", `${widgetTop}px`);
    });
    await listen("pointerup", async (event: any) => {
      if (!press) return;
      const released = press;
      press = undefined;
      if (dragging) {
        dragging = false;
        await saveSettings(state.settings).catch(() => undefined);
        return;
      }
      const hit = await eventInsideWidget(event);
      if (!hit.inside) return;
      if (released.region === "header") {
        await toggleExpanded();
        return;
      }
      const action = await actionAt(Number(event.clientX), Number(event.clientY));
      if (action) await runAction(action);
    });
    await listen("pointercancel", async () => {
      press = undefined;
      dragging = false;
    });
    await keepInViewport();
    scheduleElapsedTick();
    await risuai.onUnload(async () => {
      elapsedClockStopped = true;
      clearElapsedTick();
      clearCompletionExpiry();
      state.refreshStatusWidget = undefined;
      state.refreshQuizWidget = undefined;
      state.setStatusWidgetHidden = undefined;
      for (const listener of installedListeners) await (root as any).removeEventListener(listener.type, listener.id);
      await widget.remove();
      await widgetStyle.remove();
    });
  } catch (error) {
    elapsedClockStopped = true;
    if (elapsedTimer !== undefined) window.clearTimeout(elapsedTimer);
    if (completionTimer !== undefined) window.clearTimeout(completionTimer);
    state.refreshStatusWidget = undefined;
    state.refreshQuizWidget = undefined;
    state.setStatusWidgetHidden = undefined;
    if (installedRoot) {
      for (const listener of installedListeners) {
        await Promise.resolve((installedRoot as any).removeEventListener(listener.type, listener.id)).catch(() => undefined);
      }
    }
    if (installedWidget) await installedWidget.remove().catch(() => undefined);
    if (installedWidgetStyle) await installedWidgetStyle.remove().catch(() => undefined);
    addLog(state.logs, "warn", `Status widget unavailable: [오류 원문 제외]`);
    // Chat menu state remains the fallback in hosts without SafeRoot support.
  }
}

export async function registerDashboardSetting(state: RuntimeState): Promise<void> {
  try {
    await risuai.registerSetting("Risu Cognitive Memory", () => state.openDashboard?.(), MEMORY_ICON, "html", "risu-cognitive-memory-settings");
  } catch (error) {
    addLog(state.logs, "warn", `Settings menu registration unavailable: [오류 원문 제외]`);
  }
}

export async function updateWorkerMenuButton(state: RuntimeState): Promise<void> {
  await risuai.registerButton(
    {
      name: state.settings.workerAttention ? "⚠ Cognitive Memory · 처리 멈춤" : "Cognitive Memory",
      icon: state.settings.workerAttention ? ALERT_ICON : MEMORY_ICON,
      iconType: "html",
      location: "chat",
      id: BUTTON_ID,
    },
    () => state.openDashboard?.(),
  );
}

export async function showWorkerPauseNotice(state: RuntimeState): Promise<void> {
  state.refreshStatusWidget?.();
  await updateWorkerMenuButton(state).catch((error) => {
    addLog(state.logs, "warn", `Worker menu unavailable: [오류 원문 제외]`);
  });
}
