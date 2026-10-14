import { translationConnectionSettings, readTranslationConnectionSettings, updateTranslationConnectionControls } from "./translation-connection-settings.js";
import { auxiliaryModelMissing, MODEL_SETUP_DETAIL, EMBEDDING_SETUP_DETAIL } from "./attention.js";
import type { TranslationConnectionPublicConfig } from "@rcm/shared";
import { planTranslation, estimateTokens as estimateTranslationTokens } from "@rcm/shared";
import { backgroundTranslationEnabled, callTranslationBatch, googleTranslationRecords, retranslateGoogleRecords, translationOutputBudget } from "./translation.js";
import { sanitizeDiagnosticText } from "@rcm/shared";
import { defaultAuxiliaryModelConfig, SERVER_LLM_PROVIDER_OPTIONS } from "@rcm/shared";
import { diagnosticReason, shareDiagnostic, supportFailure, supportJobs, supportTime } from "./support-diagnostics.js";
import { providerCapability, updateProviderFields } from "./provider-settings.js";
import { mcpSelectorSettings, readMcpSelectorSettings, updateMcpSelectorControls } from "./mcp-selector-settings.js";
import { mcpRequestTimeoutMs, type McpSelectorPublicConfig } from "@rcm/shared";
declare const __RCM_DISTRIBUTION__: boolean;
import { LANDMARK_KIND_VALUES, LandmarkKindSchema, RelationshipProjectionItemSchema, RCM_API_REVISION, RCM_PRODUCT_VERSION, RCM_PLUGIN_VERSION, compareNumericVersions, formatStoryTime, parseStoryTime, compareStoryTimes, estimateTokens, joinDialogueSpans, validateCanonicalRemovalRule, type CanonicalRemovalRule, type ChatLineageStatus, type LandmarkKind, type LineageProbeRequest, type LineageProbeResponse, type ManualLineagePreview, type ManualLineagePreviewRequest, type MemoryLanguage, type RpProfile, type ServerLlmPublicConfig, type ServerWorkerStatus } from "@rcm/shared";
import { SERVER_STATUS_TIMEOUT_MS, type ChatViewPreferences, type MemoryDetailAccessPatch, type MemoryDetailAccessResponse, type ServerClient } from "./api-client.js";
import { makePrepareRequest, readCurrentContext, readOptionalCurrentContext, readOptionalDashboardContext, readDashboardLineageRequest } from "./context.js";
import { addLog, rememberDiagnosticSecrets, defaults, isChatMemoryEnabled, normalizeMemoryOnlyInjection, supportedSettingsRevision, saveSettings, serverScopeKey, CACHE_KEY, loadStoredJson, saveStoredJson } from "./settings.js";
import type { ActivityProgress, DashboardSkin, InitialCalibrationActivity, PluginSettings, RuntimeState, TranslationDisplay } from "./types.js";
import { drainWorker, reconcileAutomaticServerPause } from "./worker.js";
import { readServerModelConnection, testSettingsConnection } from "./connection-tests.js";
import { connectionCheck } from "./dashboard/film/ui.js";
import { updateWorkerMenuButton, widgetState } from "./attention.js";
import { createOrganizationView, memoryOrganization, toggleOrganizationRange, type OrganizationData } from './memory-organization.js';
import { subscribeActivity } from "./activity.js";
import { translatePacket, clearTranslationCache, displayText, prefetchTranslationRecords, googleTranslationCooldownMs, invalidateTranslationCache, readCachedTranslations, translateRecords, translationCacheStats, type TranslationCacheStats, type TranslationSource } from "./translation.js";
import { inheritLineageSettings } from "./lineage-settings.js";
import {exportChatSettings,restoreChatSettings} from "./backup-settings.js";
import { ServerCompatibilityError, describeServerConnectionIssue, isServerConfigured, noteServerConnectionFailure, noteServerConnectionSuccess, SERVER_RESPONSE_DELAYED, type ServerConnectionIssue } from "./connection.js";
import { syncQuizSettings } from "./quiz-sync.js";
import { installServerUpdate, pluginUpdateNeeded, refreshUpdateStatus } from "./updates.js";
import { createDashboardNavigationController, dashboardScrollOwner, documentScroller, handleDashboardNavigationAction, handleSentNowNavigation, NavigationStack, type DashboardNavigationRefresh, type ViewSnapshot } from "./dashboard/navigation.js";
import { matchPersonaEntity } from "./persona.js";
import { buildPairs, entityForName, entityProminence, milestoneLabel, pairKey, PERSON_PROMINENCE_OPTIONS, relationshipLabelTranslationKey, relationshipSummaryLabel } from "./dashboard/pairs.js";
import { pairOpenPromises, pairSceneCount, renderRelationshipRow, renderPairDetail, type PairDiaryFilter, type PairDiarySort } from "./dashboard/pair-detail.js";
import { buildSceneLog, storyWeekday } from "./dashboard/scene-log.js";
import { landmarkLabel, remapHiddenAnniversariesAfterDelete } from "./dashboard/diary.js";
import { isInitialCalibrationMemory } from "@rcm/shared";
import { addressEditorForm, buildPersonDetail, renderPersonDetail } from "./dashboard/person.js";
import { buildNowPage, overduePromiseEntries, renderNowPage, runPromiseStatusMutation, type NowFilter, type NowSort, type NowView } from "./dashboard/now.js";
import { POLARITY_LABELS, predicateLabel, PROMISE_STATUS_LABELS, STATE_KIND_LABELS } from "./dashboard/record-history.js";
import { renderLockHome } from "./dashboard/phone/home.js";
import { MemoryLandmarkPatchQueue } from "./dashboard/landmark-mutations.js";
import { buildCrumbs, decorateFoldSummaries, handleShellNavigationAction, icon, renderFoldSummary, renderShell } from "./dashboard/shell.js";
import { FILM_CSS } from "./dashboard/film/css.js";
import { PHONE_CSS } from "./dashboard/phone/css.js";
import { lex, setSkin } from "./dashboard/lexicon.js";
import { avatar, btn, contactRow, empty, field, filters, fold, frame, iconBtn, loading, menu, notice, row, statusList, secretInput, toggleSecretInput, maskSecretInputs, tabs as filmTabs, type MenuItem } from "./dashboard/film/ui.js";
import { nameHtml } from "./dashboard/film/names.js";
import { dayPart, sceneDate, slugline } from "./dashboard/film/scene.js";
import { actScenes, compareStoryMemories, pickFrames, sceneLocator, sceneNumbers, storyScenes } from "./dashboard/scenes.js";
import { buildCast } from "./dashboard/film/cast.js";
import { installMenuController } from "./dashboard/film/menu.js";
import { buildHomePairs, homePencilCounts, homeRecentMemories, homeTranslationRecords, injectedStateRows, type InjectionManifest } from "./dashboard/home.js";
import { sentPage, sentWidget, type SentData, type SentPerson, type SentScene, type SentView } from "./dashboard/sent.js";

export type Tab = "overview" | "initial" | "story" | "timeline" | "relationships" | "world" | "reviews" | "conflicts" | "operations" | "data" | "settings";

export function mergeCompleteBackupSettings(current: PluginSettings, restored: unknown): PluginSettings {
  if (!restored || typeof restored !== "object" || !supportedSettingsRevision((restored as { settingsRevision?: unknown }).settingsRevision)) return current;
  return { ...(restored as PluginSettings), settingsRevision: defaults.settingsRevision,
    memoryOnlyInjection: normalizeMemoryOnlyInjection((restored as Partial<PluginSettings>).memoryOnlyInjection),
    serverUrl: current.serverUrl, serverToken: current.serverToken };
}

/** PocketRisu may transfer request buffers across a window boundary and detach them. */
export function backupRequestBody(bytes: ArrayBuffer): ArrayBuffer {
  return bytes.slice(0);
}
type NavGroupId = "home" | "memory" | "people" | "world" | "manage";
type NavItem = { tab: Tab; label: string; count?: number };
type NavGroup = { id: NavGroupId; label: string; icon: string; defaultTab: Tab; items: NavItem[] };
type ActionState = { kind: "success" | "error"; message: string };
type AttentionFilter = "all" | "duplicate" | "conflict" | "audit";
type AttentionViewState = { selectedId: string; query: string; filter: AttentionFilter; mobileDetail: boolean };
type WorldEditor = { social?: boolean; kind: "assertion" | "belief" | "promise"; id?: string; mode: "create" | "edit" | "end" | "delete"; stateKind?: string; subject?: string; target?: string; relationKind?: string; lockSubject?: boolean };
type IntimacyEditor = { id?: string; participantA?: string; participantB?: string };
type SocialEditor = { locked?: boolean; description?: string; holder: string; subject: string; level: string; knownAs: string; addressTerms?: string; editing: boolean; focus?: "address" };
export function relationshipSheetEditorsAfterSwitch(
  dirty: boolean,
  discardConfirmed: boolean,
): {
  intimacyEditor: undefined;
  relationshipEditing: false;
  relationshipEditingDirection: string;
  anniversaryEditorEntryId: string;
  socialEditor: undefined;
  worldEditor: undefined;
  worldEditorOnNow: false;
} | undefined {
  if (dirty && !discardConfirmed) return undefined;
  return {
    intimacyEditor: undefined,
    relationshipEditing: false,
    relationshipEditingDirection: "",
    anniversaryEditorEntryId: "",
    socialEditor: undefined,
    worldEditor: undefined,
    worldEditorOnNow: false,
  };
}
type PeopleViewState = {
  selectedId: string;
  query: string;
  prominence: "all" | "primary" | "supporting" | "reference";
  editing: boolean;
  mobileDetail: boolean;
  management: "" | "merge" | "delete";
};
export type TimelineViewState = {
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
};

const relationshipLandmarkKinds = new Set(["first_met", "romantic_relationship_established", "engagement", "marriage", "separation", "romantic_relationship_ended", "reunion", "divorce", "anniversary_basis"]);

export function editableLandmarkKinds(text: string, existing: LandmarkKind[], participants: string[], storyTime: string): LandmarkKind[] {
  const names = new Set<string>(LANDMARK_KIND_VALUES);
  const normalizedParticipants = participants.map((name) => String(name).trim()).filter(Boolean);
  const remaining = new Map<string, LandmarkKind[]>();
  for (const item of existing) remaining.set(item.kind, [...(remaining.get(item.kind) ?? []), item]);
  const entries = text.split(",").map((value) => value.trim()).filter(Boolean).map((value): LandmarkKind => {
    if (value.startsWith("other:")) {
      const label = value.slice(6).trim();
      const candidates = remaining.get("other") ?? [];
      const index = candidates.findIndex((item) => item.kind === "other" && item.label === label);
      if (index >= 0) return candidates.splice(index, 1)[0]!;
      return { kind: "other", label };
    }
    if (!names.has(value)) throw new Error(`알 수 없는 랜드마크 종류예요: ${value}`);
    const prior = remaining.get(value)?.shift();
    if (prior) return prior;
    if (relationshipLandmarkKinds.has(value)) {
      if (normalizedParticipants.length !== 2) throw new Error("관계 랜드마크를 새로 지정하려면 이 기억의 관련 인물이 정확히 두 명이어야 해요.");
      return { kind: value as LandmarkKind["kind"], pair: [normalizedParticipants[0]!, normalizedParticipants[1]!], ...(storyTime ? { storyTime } : {}) };
    }
    return { kind: value as LandmarkKind["kind"] };
  });
  const parsed = LandmarkKindSchema.array().max(12).safeParse(entries);
  if (!parsed.success) throw new Error("랜드마크 종류와 관련 인물을 확인해 주세요.");
  return parsed.data;
}

const landmarkEntryIdentity = (item: any): string => JSON.stringify([
  item?.kind ?? null, item?.label ?? null, item?.pair ?? null, item?.storyTime ?? null, item?.evidence ?? null,
]);

const landmarkEntryIndex = (items: any[], target: any, preferredIndex: number): number => {
  const identity = landmarkEntryIdentity(target);
  if (items[preferredIndex] && landmarkEntryIdentity(items[preferredIndex]) === identity) return preferredIndex;
  return items.findIndex((item) => landmarkEntryIdentity(item) === identity);
};

export function resetTimelineDetailScroll(scope: ParentNode): void {
  scope.querySelector<HTMLElement>('[data-preserve-scroll="timeline-detail"]')?.scrollTo({ left: 0, top: 0 });
  scope.querySelector<HTMLElement>(".split > .readercol")?.scrollTo({ left: 0, top: 0 });
  documentScroller(scope)?.scrollTo({ left: 0, top: 0 });
}
export type StoryViewState = {
  selectedGroupId: string;
  query: string;
  indexOpen: boolean;
  expandedMemoryId: string;
  editingOverview?: boolean;
  overviewDraft?: string;
  /** The season (story part) on screen; empty follows the selected act. */
  selectedPart?: string;
  /** A part or character detail open in the story sheet: `part|<season>` or `flow|<act>|<index>`. */
  detailSheet?: string;
};

type StoryOverviewBackup = RuntimeState["settings"]["storyOverviewBackups"][string];
export type HostChatInventoryItem = { characterId: string; characterName: string; chatId: string; chatTitle: string; messageCount: number };
type DataConfirmation = { action: "rebuild" | "delete"; chatId: string; acknowledged?: boolean };
type ServerInspector = {
  chatId: string;
  loading?: boolean;
  error?: string;
  memories: any[];
  storySpine: any;
  relationships: any[];
  assertions: any[];
  beliefs: any[];
  promises: any[];
  endedAssertions: any[];
  endedBeliefs: any[];
  userDeletedBeliefs: any[];
  promiseHistory: any[];
  reconciliationReviews: any[];
  conflicts: any[];
  ledger?: { items: any[]; total: number; offset: number; limit: number; includesContent: boolean };
};
type DataViewState = {
  inventoryStatus: "idle" | "loading" | "ready" | "unavailable";
  inventory: HostChatInventoryItem[];
  query: string;
  filter: "all" | "current" | "other";
  confirmation?: DataConfirmation;
  inspector?: ServerInspector;
  backupExportPhase?: "creating" | "downloading";
  backupExportChatId?: string;
  backupExportError?: string;
};

export function koreanTranslationEnabled(autoTranslate: boolean, display: RuntimeState["settings"]["translationDisplay"], canonicalLanguage: MemoryLanguage): boolean {
  return canonicalLanguage !== "ko" && autoTranslate && display !== "en";
}

export async function applyTranslationDisplay(
  state: RuntimeState,
  display: TranslationDisplay,
  persist: (settings: PluginSettings) => Promise<void>,
  rerender: () => void,
): Promise<void> {
  state.settings.translationDisplay = display;
  state.settings.autoTranslate = display === "ko";
  await persist(state.settings);
  rerender();
}

export function filterTimelineMemories(memories: any[], view: Pick<TimelineViewState, "landmarkOnly" | "bookmarkedOnly" | "pinnedOnly" | "includeInactive">): any[] {
  return memories.filter((memory) => !isInitialCalibrationMemory(memory)
    && (view.includeInactive || memory.active !== false)
    && (!view.landmarkOnly || Boolean(memory.landmark))
    && (!view.bookmarkedOnly || Boolean(memory.bookmarked))
    && (!view.pinnedOnly || Boolean(memory.pinned))).sort((left, right) => {
      const compared = compareStoryTimes(left.story_time ?? left.storyTime, right.story_time ?? right.storyTime);
      if (compared !== null && compared !== 0) return compared;
      const leftHasTime = Boolean(String(left.story_time ?? left.storyTime ?? "").trim());
      const rightHasTime = Boolean(String(right.story_time ?? right.storyTime ?? "").trim());
      if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1;
      return Number(left.created_revision ?? left.created_at ?? 0) - Number(right.created_revision ?? right.created_at ?? 0);
    });
}

function timelineMemoryView(memories: any[], view: TimelineViewState): { matching: any[]; topLevel: any[] } {
  const sort = view.sortOrder === "ascending" ? 1 : -1;
  const undated = (memory: any): number => Number(!String(memory?.story_time ?? memory?.storyTime ?? "").trim());
  const ordered = (items: any[]) => [...items].sort((left, right) => undated(left) - undated(right) || sort * compareStoryMemories(left, right));
  const matching = ordered(filterTimelineMemories(memories, view));
  const matchingIds = new Set(matching.map((memory) => memory.id));
  const matchingParents = new Set(matching.map((memory) => memory.capsule_parent_id).filter(Boolean));
  const topLevel = ordered(filterTimelineMemories(
    memories.filter((memory) => !memory.capsule_parent_id && (matchingIds.has(memory.id) || matchingParents.has(memory.id))),
    { ...view, landmarkOnly: false, bookmarkedOnly: false, pinnedOnly: false },
  ));
  return { matching, topLevel };
}

export function timelineDefaultMemoryId(memories: any[], view: TimelineViewState): string {
  return String(timelineMemoryView(memories, view).topLevel[0]?.id ?? "");
}

export function dashboardThemeFromColor(value: string, prefersDark: boolean): "dark" | "light" {
  const normalized = value.trim().toLowerCase();
  const hex = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  const channels = hex
    ? (hex.length === 3 ? [...hex].map((part) => parseInt(part + part, 16)) : [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)))
    : normalized.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)?.slice(1, 4).map(Number);
  if (!channels || channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) return prefersDark ? "dark" : "light";
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => {
    const unit = channel / 255;
    return unit <= .03928 ? unit / 12.92 : ((unit + .055) / 1.055) ** 2.4;
  });
  return .2126 * red + .7152 * green + .0722 * blue < .32 ? "dark" : "light";
}

export interface DashboardData {
  quizStatus?: import("@rcm/shared").QuizStatus;
  chatId?: string;
  loadedDatasets?: DashboardChatDataset[];
  failedDatasets?: DashboardChatDataset[];
  health?: {
    ok: boolean;
    version: string;
    apiRevision: number;
    instanceId: string;
    vectorEnabled: boolean;
    embeddingReady: boolean;
    embedding?: { configured: boolean; ready: boolean; model: string; dimension: number; pendingBlocks: number; failedBlocks: number; lastError?: string };
    serverLlm?: ServerLlmPublicConfig;
    mcpSelector?:McpSelectorPublicConfig;
    translationConnection?:TranslationConnectionPublicConfig;
    serverWorker?: ServerWorkerStatus;
    capabilities?: { recallPortfolioV2?: boolean; mcpAtomDelta?: boolean; memoryToolReadiness?: boolean; initialCalibration?: boolean; initialRelationshipProjection?: boolean; relationshipProjectionCursor?: boolean; offscreenPromises?: boolean; extractionAudit?: boolean; atomAccess?: boolean; beliefLifecycle?: boolean; reconciliationReview?: boolean; perspectiveResolution?: boolean; ingestionState?: boolean; qualitativeRelationships?: boolean; memoryDetails?: boolean; intimacyMilestones?: boolean; npcProminence?: boolean; adaptiveExtraction?: boolean; multilingualCanonicalMemory?: boolean; extractionGrouping?: boolean; promptCoverageSuppression?: boolean; durableLedger?: boolean; chatLineage?: boolean; manualLineageTransfer?: boolean; sourceLedgerInspection?: boolean; dashboardLineageProbe?: boolean; readOnlyLineageProbe?: boolean; recallCoverage?: boolean; socialKnowledge?: boolean; lineageAcknowledgement?: boolean; packetContractV2?: boolean; physicalIntimacy?: boolean; typedLandmarks?: boolean; resolvedRelationshipBaseline?: boolean; manualLedgerEditing?: boolean; memoryToolControl?: boolean; shortMemoryRefs?: boolean; multiGenerationLineage?: boolean; injectionManifest?: boolean; ledgerHistory?: boolean; typedSexMilestones?: boolean; deepRecall?: boolean; aspectProvenance?: boolean; creativeUnknownStates?: boolean; retrievalPlannerV2?: boolean; extractionBatches?: boolean; episodeRegeneration?: boolean; canonicalSuffixRegeneration?: boolean; storySpine?: boolean; storySpineV2?: boolean; memoryBudgetPresets?: boolean; holderMemoryTraces?: boolean; canonicalSourceNormalization?: boolean; editProtection?: boolean; cognitiveActivation?: boolean; serverServiceTier?: boolean; chatOperationLifecycleV2?: boolean; turnLineageDiscovery?: boolean; ledgerConsistencyBarrier?: boolean; canonicalLedgerIdentity?: boolean; providerJsonMode?: boolean; stateReconciliationV3?: boolean; pipelineRetryStatus?: boolean; repairDiagnosticsV2?: boolean; operationRunAccounting?: boolean; persistentBackfillResult?: boolean; retrievalDiagnostics?: boolean; memoryQuiz?: boolean; quizManagement?: boolean };
  };
  memories: any[];
  storySpine: any;
  messages: any[];
  relationships: any[];
  relationshipEvents: any[];
  physicalIntimacy: any[];
  entities: any[];
  socialKnowledge: any[];
  socialKnowledgeJobs: Record<string, number>;
  viewPreferences: ChatViewPreferences;
  personaEntity: string | null;
  assertions: any[];
  beliefs: any[];
  promises: any[];
  endedAssertions: any[];
  endedBeliefs: any[];
  userDeletedBeliefs: any[];
  promiseHistory: any[];
  conflicts: any[];
  reconciliationReviews: any[];
  extractionAudits: any[];
  jobs: any[];
  cancelledMessages: number;
  waitingForAssistant: number;
  bufferedMessages: number;
  backfillMessages: number;
  bufferedTurns: number;
  protectedTurns: number;
  bufferedSourceTokens: number;
  extractionGroupTurns: number;
  recoverableMessages: number;
  historicalBackfillMessages: number;
  ingestionState?: "historical_pending" | "managed" | "cleared";
  recallLogs: any[];
  adminChats: any[];
  lineage?: ChatLineageStatus;
  initialCalibration?: any;
  coldStartProgress?: ActivityProgress;
  jobsError?: string;
  adminError?: string;
  contextError?: string;
  error?: string;
  connectionIssue?: ServerConnectionIssue;
}

const emptyData = (): DashboardData => ({
  loadedDatasets: [], failedDatasets: [], memories: [], storySpine: { overview: null, currentProgress: [], arcs: [] }, messages: [], relationships: [], relationshipEvents: [], physicalIntimacy: [], entities: [], socialKnowledge: [], socialKnowledgeJobs: {}, viewPreferences: { personaEntity: null, hiddenAnniversaries: [] }, personaEntity: null, assertions: [], beliefs: [], promises: [], endedAssertions: [], endedBeliefs: [], userDeletedBeliefs: [], promiseHistory: [], conflicts: [], reconciliationReviews: [], extractionAudits: [], jobs: [], cancelledMessages: 0, waitingForAssistant: 0, bufferedMessages: 0, backfillMessages: 0, bufferedTurns: 0, protectedTurns: 0, bufferedSourceTokens: 0, extractionGroupTurns: 6, recoverableMessages: 0, historicalBackfillMessages: 0, recallLogs: [], adminChats: [], initialCalibration: { status: "unseeded", entities: [], relationships: [], locked: false, confirmationRequired: false },
});

export function availableNavigationSnapshot(snapshot: ViewSnapshot, data: DashboardData): ViewSnapshot {
  const next: ViewSnapshot = {
    ...snapshot,
    peopleView: snapshot.peopleView && typeof snapshot.peopleView === "object"
      ? { ...(snapshot.peopleView as Record<string, unknown>) }
      : snapshot.peopleView,
  };
  if (next.tab === "initial" && next.peopleView && typeof next.peopleView === "object") {
    const peopleView = next.peopleView as Partial<PeopleViewState>;
    const selectedId = String(peopleView.selectedId ?? "");
    const candidates = [...(data.initialCalibration?.entities ?? []), ...data.entities];
    if (selectedId && selectedId !== "__new__" && !candidates.some((person: any) => String(person?.id) === selectedId)) {
      peopleView.selectedId = "";
      peopleView.editing = false;
      peopleView.mobileDetail = false;
      peopleView.management = "";
    }
  }
  if (next.tab === "relationships" && next.selectedRelationship) {
    const exists = buildPairs(data, data.personaEntity).some((pair) => pair.key === next.selectedRelationship);
    if (!exists) {
      next.selectedRelationship = "";
      next.relationshipMobileDetail = false;
    }
  }
  if (next.tab === "timeline" && next.selectedMemory && !data.memories.some((memory) => String(memory?.id) === next.selectedMemory && !isInitialCalibrationMemory(memory))) {
    next.selectedMemory = "";
    next.timelineMobileDetail = false;
  }
  return next;
}

export const EDITOR_FORM_SELECTOR = "#memory-form, #manual-memory-form, #story-overview-form, #intimacy-form, #social-form, #world-state-form, #relationship-form, #anniversary-form, #anniversary-new-form, #detail-access-form, .person-editor, .initial-relationship-editor, .reconciliation-edit";
const EDITABLE_DASHBOARD_TABS: readonly Tab[] = ["initial", "story", "timeline", "relationships", "world", "reviews"];

type DashboardChatDataset = "memories" | "messages" | "relationships" | "world" | "conflicts" | "jobs" | "recallLogs" | "entities" | "reviews" | "lineage" | "socialKnowledge" | "physicalIntimacy" | "viewPreferences" | "status" | "audits" | "initialCalibration" | "storySpine";

const ALL_DASHBOARD_DATASETS: DashboardChatDataset[] = [
  "memories", "messages", "relationships", "world", "conflicts", "jobs", "recallLogs", "entities",
  "reviews", "lineage", "socialKnowledge", "physicalIntimacy", "viewPreferences", "status", "audits", "initialCalibration", "storySpine",
];

export function dashboardDatasetsForTab(tab: Tab): DashboardChatDataset[] {
  const byTab: Record<Tab, DashboardChatDataset[]> = {
    overview: ["memories", "relationships", "entities", "viewPreferences", "world", "conflicts", "jobs", "lineage", "status", "initialCalibration", "storySpine"],
    initial: ["memories", "relationships", "entities", "world", "socialKnowledge", "physicalIntimacy", "viewPreferences", "initialCalibration", "status"],
    story: ["memories", "storySpine", "entities", "relationships", "viewPreferences", "status"],
    timeline: ["memories", "messages", "status"],
    relationships: ["memories", "relationships", "entities", "world", "socialKnowledge", "physicalIntimacy", "viewPreferences", "initialCalibration", "status"],
    world: ["memories", "world", "messages", "entities", "viewPreferences", "initialCalibration", "conflicts", "reviews", "audits", "status"],
    reviews: ["conflicts", "reviews", "audits", "status"],
    conflicts: ["conflicts", "status"],
    operations: ["jobs", "status"],
    data: ["status"],
    settings: ["status"],
  };
  return [...byTab[tab]];
}

const escapeHtml = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

/** `reviewCount` is the pending 상태 확인 count shown on its section tab (0 hides it). */
export const dashboardNavigation = (reviewCount = 0): NavGroup[] => [
  { id: "home", label: "홈", icon: "overview", defaultTab: "overview", items: [] },
  { id: "memory", label: "기억", icon: "timeline", defaultTab: "timeline", items: [
    { tab: "timeline", label: "타임라인" }, { tab: "story", label: "줄거리" },
  ] },
  { id: "people", label: "인물", icon: "relationships", defaultTab: "initial", items: [
    { tab: "initial", label: "인물 목록" }, { tab: "relationships", label: "관계" },
  ] },
  { id: "world", label: "현재", icon: "clock", defaultTab: "world", items: [] },
  { id: "manage", label: "관리", icon: "operations", defaultTab: "reviews", items: [
    { tab: "reviews", label: "상태", count: reviewCount },
    { tab: "operations", label: "처리" },
    { tab: "data", label: "데이터" }, { tab: "settings", label: "설정" },
  ] },
];

export function dashboardNavGroup(tab: Tab): NavGroupId {
  return dashboardNavigation().find((group) => group.defaultTab === tab || group.items.some((item) => item.tab === tab))?.id ?? "home";
}

export function dashboardSecondaryNavigation(group: NavGroup, activeTab: Tab): string {
  if (!group.items.length) return "";
  return `<h1 class="pagetitle">${escapeHtml(group.label)}</h1>${filmTabs(group.items.map((item) => ({ label: item.label, selected: activeTab === item.tab, count: item.count, action: "tab", data: { tab: item.tab } })), group.label)}`;
}

export function dashboardChatContext(current?: Pick<NonNullable<RuntimeState["current"]>, "characterName" | "chatTitle">): { character: string; chat: string } {
  return { character: current?.characterName || "활성 채팅 없음", chat: current?.chatTitle || "" };
}

export function dashboardTopbarWorkState(
  activity: string,
  connectionIssue?: ServerConnectionIssue,
): { kind: "warn" | "error"; text: string } | undefined {
  if (connectionIssue) return {
    kind: ["unconfigured", "incompatible"].includes(connectionIssue.kind) ? "warn" : "error",
    text: connectionIssue.kind === "incompatible" ? connectionIssue.title : connectionIssue.kind === "unconfigured" ? "서버 연결 필요" : "연결 확인 필요",
  };
  return activity ? { kind: "warn", text: activity } : undefined;
}

export function dashboardChatProfileControl(profile: RpProfile, disabled = false): string {
  return `<label class="field chat-profile-setting"><span>채팅 유형</span><select data-action="set-profile-select" ${disabled ? "disabled" : ""}><option value="companion" ${profile === "companion" ? "selected" : ""}>Companion</option><option value="simulation" ${profile === "simulation" ? "selected" : ""}>World Simulation</option></select></label>`;
}

export type ExtractionReviewChoice = boolean | undefined;

/** Choose whether a Companion → Simulation transition also reprocesses past records. */
export async function chooseSimulationBackfill(
  estimatedTokens: number,
): Promise<boolean | undefined> {
  if (typeof document === "undefined" || typeof window === "undefined") return undefined;
  const dialog = document.createElement("dialog");
  dialog.className = "review-choice-dialog";
  dialog.setAttribute("aria-labelledby", "simulation-backfill-title");
  dialog.innerHTML = `<div class="review-choice-dialog__body"><h2 id="simulation-backfill-title">World Simulation으로 변경</h2><p>유형만 바꾸거나, 과거 기록을 다시 추출해 World Simulation 기억까지 준비할 수 있습니다.</p><fieldset class="review-choice-options"><legend>과거 기록 처리</legend><label><input type="radio" name="simulation-backfill" value="type-only" checked><span><strong>유형만 변경</strong><small>앞으로의 대화부터 World Simulation 방식으로 처리합니다.</small></span></label><label><input type="radio" name="simulation-backfill" value="backfill"><span><strong>과거 기록 다시 추출</strong><small>과거 원문 약 ${escapeHtml(estimatedTokens.toLocaleString())} 입력 토큰을 처리합니다. 호출량과 비용이 늘어날 수 있습니다.</small></span></label></fieldset><div class="actions"><button class="btn btn--primary" type="button" value="apply">변경</button><button class="btn" type="button" value="cancel">취소</button></div></div>`;
  document.body.append(dialog);
  try {
    return await new Promise<boolean | undefined>((resolve) => {
      let settled = false;
      const settle = (choice: boolean | undefined) => {
        if (settled) return;
        settled = true;
        resolve(choice);
      };
      dialog.addEventListener("click", (event) => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[value]");
        if (!button) return;
        if (button.value === "apply") {
          const checked = dialog.querySelector<HTMLInputElement>('input[name="simulation-backfill"]:checked');
          dialog.close(checked?.value ?? "type-only");
          return;
        }
        dialog.returnValue = "cancel";
        dialog.close();
      });
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        dialog.returnValue = "cancel";
        dialog.close();
      });
      dialog.addEventListener("close", () => settle(dialog.returnValue === "backfill" ? true : dialog.returnValue === "type-only" ? false : undefined), { once: true });
      dialog.showModal();
    });
  } finally {
    dialog.remove();
  }
}

export function withExtractionReviewOverride<T extends Record<string, unknown>>(
  payload: T,
  extractionReviewOverride: boolean,
): T & { extractionReviewOverride: boolean } {
  return { ...payload, extractionReviewOverride };
}

export async function syncCompleteSourceLedger(
  client: Pick<ServerClient, "request">,
  context: Awaited<ReturnType<typeof readCurrentContext>>,
): Promise<{ expectedSourceMessages: number; serverInstanceId: string }> {
  if (context.snapshotScope !== "full" || context.snapshot.length !== context.sourceMessageCount) {
    throw new Error(`전체 원문을 불러오지 못했습니다 (${context.snapshot.length}/${context.sourceMessageCount}). 다시 시도해 주세요.`);
  }
  await client.request(`/v1/chats/${encodeURIComponent(context.chatId)}/source-sync`, {
    method: "POST",
    body: JSON.stringify(makePrepareRequest(context, 0, { deferExtraction: true })),
  }, 120_000);
  return { expectedSourceMessages: context.sourceMessageCount, serverInstanceId: "" };
}

export async function requestBackupArchive(
  client: Pick<ServerClient, "request" | "raw">,
  state: RuntimeState,
  chatId?: string,
  contextReader: typeof readCurrentContext = readCurrentContext,
): Promise<Response> {
  if (chatId && state.current?.chatId === chatId) {
    const current = await contextReader(state, { snapshotMode: "full" });
    if (current.chatId !== chatId) throw new Error("현재 채팅이 바뀌었습니다. 다시 시도해 주세요.");
    await syncCompleteSourceLedger(client, current);
  }
  return client.raw("/v1/export", { method: "POST", body: JSON.stringify(
    chatId ? { chatId, chatSettings: exportChatSettings(state.settings, chatId) }
      : { pluginSettings: state.settings, serverUrl: state.settings.serverUrl },
  ) }, 120_000);
}

export type MemoryTransferMode = "lineage" | "archive";
export type MemoryTransferConfirmation = { message: string; title: string; confirm: string; cancel: string };

/** Build the exact lightweight inventory used to recognize a normal Risu JSON import. */
export function manualMemoryLineageRequest(
  context: NonNullable<RuntimeState["current"]>,
  parentChatId: string,
): ManualLineagePreviewRequest {
  return {
    parentChatId,
    targetMessageInventory: context.messageVisibility ?? [],
    target: {
      chatTitle: context.chatTitle,
      characterId: context.characterId,
      characterName: context.characterName,
      profile: context.profile,
      includeUserMessages: context.includeUserMessages,
      extractionGroupTurns: context.extractionGroupTurns,
      memoryLanguage: context.memoryLanguage,
    },
  };
}

/** Only the server's explicit no-shared-ID result may fall back to archive transplant. */
export function isMissingLineageIdentityError(error: unknown): boolean {
  return String(error).includes("At least two exact message IDs are required");
}

export type MemoryTransferPreviewResult = {
  current: NonNullable<RuntimeState["current"]>;
  request: ManualLineagePreviewRequest;
  mode: MemoryTransferMode;
  preview: ManualLineagePreview;
};

/** Preview exact lineage first, then prepare a complete source ledger for the ID-less archive fallback. */
export async function previewMemoryTransfer(
  client: Pick<ServerClient, "request">,
  state: RuntimeState,
  sourceChatId: string,
  contextReader: typeof readCurrentContext = readCurrentContext,
): Promise<MemoryTransferPreviewResult> {
  let current = await contextReader(state);
  let request = manualMemoryLineageRequest(current, sourceChatId);
  try {
    const preview = await client.request<ManualLineagePreview>(`/v1/chats/${encodeURIComponent(current.chatId)}/lineage/preview`, {
      method: "POST", body: JSON.stringify(request),
    }, 30_000);
    return { current, request, mode: "lineage", preview };
  } catch (error) {
    if (!isMissingLineageIdentityError(error)) throw error;
  }
  if (current.snapshotScope !== "full" || current.snapshot.length !== current.sourceMessageCount) {
    current = await contextReader(state, { snapshotMode: "full" });
  }
  await syncCompleteSourceLedger(client, current);
  request = manualMemoryLineageRequest(current, sourceChatId);
  const preview = await client.request<ManualLineagePreview>(`/v1/chats/${encodeURIComponent(current.chatId)}/memory-transplant/preview`, {
    method: "POST", body: JSON.stringify({ sourceChatId }),
  }, 30_000);
  return { current, request, mode: "archive", preview };
}

function transferCountSummary(counts: Record<string, number>): string {
  return `기억 ${Number(counts.memories ?? 0).toLocaleString()}개 · 관계 ${Number(counts.relationships ?? 0).toLocaleString()}개 · 세계 상태 ${(Number(counts.assertions ?? 0) + Number(counts.beliefs ?? 0)).toLocaleString()}개 · 약속 ${Number(counts.promises ?? 0).toLocaleString()}개${Number(counts.translations ?? 0) > 0 ? ` · 번역 ${Number(counts.translations).toLocaleString()}개` : ""}`;
}

export function memoryTransferConfirmation(
  preview: ManualLineagePreview,
  mode: MemoryTransferMode,
  targetActiveMessageCount: number,
): MemoryTransferConfirmation {
  const source = `${preview.parent.characterName} · ${preview.parent.chatTitle || preview.parent.chatId}`;
  const target = `${preview.target.characterName} · ${preview.target.chatTitle || preview.target.chatId}`;
  const lines = [source, `→ ${target}`, ""];
  if (mode === "lineage") {
    lines.push(
      `동일한 대화 원문 ${preview.commonMessages.toLocaleString()}/${Math.max(0, targetActiveMessageCount).toLocaleString()}개를 확인했어요.`,
      transferCountSummary(preview.inheritedCounts),
      "현재 채팅과 새 봇 설정은 유지하며, 확인한 원문은 다시 처리하지 않아요.",
      "아직 정리되지 않은 원문은 현재 채팅의 수정 보호·기억 묶음 설정에 따라 처리돼요. 가져오기 자체는 모델을 호출하지 않아요.",
    );
    if (preview.clientPrunedMessages > 0) lines.push(`현재 JSON에 없는 이전 원문 ${preview.clientPrunedMessages.toLocaleString()}개도 서버 기록에서 이어받아요.`);
  } else {
    lines.push(
      "메시지 ID로 같은 대화임을 확인하지 못했어요.",
      transferCountSummary(preview.inheritedCounts),
      "원본 기억을 독립 기록으로 가져오며, 현재 채팅 원문은 별도의 이어진 대화로 처리될 수 있어요.",
      "현재 채팅 원문은 수정 보호·기억 묶음 설정에 따라 처리돼요. 가져오기 자체는 모델을 호출하지 않아요.",
    );
  }
  if (preview.requiresReplacement) {
    lines.push("", `현재 채팅의 기존 기록(${transferCountSummary(preview.targetDerivedCounts)})은 가져올 기록으로 교체돼요.`);
  }
  return {
    message: lines.join("\n"),
    title: "기억 가져오기 확인",
    confirm: preview.requiresReplacement ? "기존 기억 교체하고 가져오기" : mode === "lineage" ? "기억 가져오기" : "독립 기록으로 가져오기",
    cancel: "취소",
  };
}

/** Start a browser download and retain the object URL until Chromium consumes it. */
export function triggerBackupDownload(
  blob: Blob,
  filename: string,
  documentRef: Pick<Document, "createElement" | "body"> = document,
  urlApi: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL,
  scheduleCleanup: (callback: () => void) => unknown = (callback) => setTimeout(callback, 10_000),
): void {
  const url = urlApi.createObjectURL(blob);
  const anchor = documentRef.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  documentRef.body.append(anchor);
  anchor.click();
  scheduleCleanup(() => {
    anchor.remove();
    urlApi.revokeObjectURL(url);
  });
}

/** Shared themed messages; native dialog supplies focus trapping and Escape. */
/** Film dialog markup; buttons stack on phones (cancel below). A destructive confirm names its verb and uses danger-solid. */
/** `keep` marks a dialog whose safe default is the cancel choice (e.g. an optional paid action): cancel carries the emphasis. */
export function dialogHtml(opts: { id: string; title: string; body: string; confirm: string; cancel?: string; danger?: boolean; notice?: boolean; keep?: boolean }): string {
  const confirm = `<button type="button" class="btn ${opts.danger ? "btn--danger-solid" : opts.keep ? "btn--secondary" : "btn--primary"}" value="confirm"${opts.notice ? " autofocus" : ""}>${escapeHtml(opts.confirm)}</button>`;
  const cancel = opts.notice ? "" : `<button type="button" class="btn ${opts.keep ? "btn--primary" : "btn--quiet"}" value="cancel" autofocus>${escapeHtml(opts.cancel ?? "취소")}</button>`;
  return `<h3 id="${opts.id}">${escapeHtml(opts.title)}</h3>${opts.body}<div class="dialog__actions">${cancel}${confirm}</div>`;
}

export async function confirmDashboard(message: string, notice = false, labels: { confirm?: string; cancel?: string; title?: string; danger?: boolean; keep?: boolean; bodyHtml?: string; className?: string } = {}): Promise<boolean> {
  const dialog = document.createElement("dialog");
  dialog.className = `dialog film${labels.className ? ` ${labels.className}` : ""}`;
  dialog.setAttribute("aria-labelledby", "rcm-message-title");
  dialog.innerHTML = dialogHtml({ id: "rcm-message-title", title: labels.title ?? (notice ? "RCM 안내" : "작업 확인"), body: labels.bodyHtml ?? `<p class="dialog__text">${escapeHtml(message)}</p>`, confirm: labels.confirm ?? "확인", cancel: labels.cancel, danger: labels.danger, keep: labels.keep, notice });
  document.body.append(dialog);
  try {
    return await new Promise<boolean>((resolve) => {
      // PocketRisu's plugin iframe can disallow form submission, including
      // method="dialog". Close explicitly so pointer and keyboard activation work.
      dialog.addEventListener("click", (event) => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[value]");
        if (button) dialog.close(button.value);
      });
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
      dialog.showModal();
    });
  } finally { dialog.remove(); }
}

async function alertDashboard(message: string): Promise<void> {
  await confirmDashboard(message, true);
}

export type ChatBackupImportChoice = "original" | "current" | undefined;

/** Choose the only meaningful destinations for a single-chat backup. */
export async function chooseChatBackupImport(canTransplant: boolean): Promise<ChatBackupImportChoice> {
  const dialog = document.createElement("dialog");
  dialog.className = "dialog film";
  dialog.setAttribute("aria-labelledby", "rcm-chat-backup-title");
  dialog.innerHTML = `<h3 id="rcm-chat-backup-title">채팅 백업 불러오기</h3><p class="dialog__text">이 백업을 어디에 복원할까요?</p><div class="dialog__actions"><button type="button" class="btn btn--quiet" value="cancel" autofocus>취소</button>${canTransplant ? '<button type="button" class="btn btn--secondary" value="current">현재 채팅으로 기억 이식</button>' : ""}<button type="button" class="btn btn--primary" value="original">원래 채팅에 복원</button></div>`;
  document.body.append(dialog);
  try {
    return await new Promise<ChatBackupImportChoice>((resolve) => {
      dialog.addEventListener("click", (event) => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[value]");
        if (button) dialog.close(button.value);
      });
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "original" || dialog.returnValue === "current" ? dialog.returnValue : undefined), { once: true });
      dialog.showModal();
    });
  } finally { dialog.remove(); }
}

const RELEASE_NOTES_ACK_KEY = "rcm.product-release-notes.v2";

export function releaseNotesAcknowledged(value: unknown, version: string): boolean {
  return !!value && typeof value === "object" && (value as { version?: unknown }).version === version;
}

export function releaseNotesForVersion(version: string): string | undefined {
  const releases: Record<string, string[]> = {
    "1.0.0": ["Risu Cognitive Memory의 첫 정식 릴리스입니다."],
  };
  return releases[version]?.map((line) => `• ${line}`).join("\n");
}

export function formatReleaseNotes(value: string): string {
  return value.replaceAll("\r", "").split("\n").map((line) => line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*[-*]\s+/, "• ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1"))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Release notes as a quiet, scrollable list: bullets become list items, other lines short paragraphs. */
export function releaseNotesHtml(message: string): string {
  const blocks: string[] = [];
  let items: string[] = [];
  const flush = () => { if (items.length) blocks.push(`<ul>${items.join("")}</ul>`); items = []; };
  for (const raw of message.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith("• ")) items.push(`<li>${escapeHtml(line.slice(2))}</li>`);
    else { flush(); blocks.push(`<p>${escapeHtml(line)}</p>`); }
  }
  flush();
  return `<div class="dialog__notes" tabindex="0">${blocks.join("")}</div>`;
}

export function completedProductReleaseNotice(
  status: RuntimeState["updateStatus"],
  currentPluginVersion = RCM_PLUGIN_VERSION,
): { version: string; message: string } | undefined {
  if (!status?.configured || status.error || status.available || status.restartRequired || pluginUpdateNeeded(status, currentPluginVersion)) return undefined;
  const version = status.latestVersion;
  if (!version || compareNumericVersions(version, currentPluginVersion) < 0) return undefined;
  const notes = formatReleaseNotes(status.latestReleaseNotes ?? "")
    || releaseNotesForVersion(version)
    || `RCM ${version} 업데이트가 완료되었습니다.`;
  const message = status.notesUrl ? `${notes}\n\n자세한 내용: ${status.notesUrl}` : notes;
  return { version, message };
}

async function showCompletedProductReleaseNotice(state: RuntimeState): Promise<void> {
  const notice = completedProductReleaseNotice(state.updateStatus);
  if (!notice) return;
  const acknowledgement = await loadStoredJson<{ version?: string }>(RELEASE_NOTES_ACK_KEY);
  if (releaseNotesAcknowledged(acknowledgement, notice.version)) return;
  const acknowledged = await confirmDashboard(notice.message, true, { title: `RCM ${notice.version} 업데이트`, confirm: "확인", bodyHtml: releaseNotesHtml(notice.message), className: "dialog--notes" });
  if (acknowledged) await saveStoredJson(RELEASE_NOTES_ACK_KEY, { version: notice.version });
}

/** Ask once for an expensive bulk operation without changing the saved default. */
export async function chooseExtractionReviewOverride(
  title: string,
  detail: string,
  defaultEnabled: boolean,
): Promise<ExtractionReviewChoice> {
  const defaultText = defaultEnabled ? "켜짐" : "꺼짐";
  if (typeof document === "undefined" || typeof window === "undefined") return undefined;
  const dialog = document.createElement("dialog");
  dialog.className = "dialog film";
  dialog.setAttribute("aria-labelledby", "review-choice-title");
  dialog.innerHTML = `<h3 id="review-choice-title">${escapeHtml(title)}</h3><p class="dialog__text">${escapeHtml(detail)}</p><fieldset class="choices"><legend class="sr-only">추출 방식</legend><label class="check"><input type="radio" name="review-mode" value="basic" ${defaultEnabled ? "" : "checked"}><span>기본 추출<small>한 번의 추출 결과를 바로 상태 대조에 사용합니다.</small></span></label><label class="check"><input type="radio" name="review-mode" value="review" ${defaultEnabled ? "checked" : ""}><span>재검수 추가<small>Gemini 3.7 Flash급 이상의 모델에서는 보통 필요하지 않습니다. 기억 묶음마다 호출이 1회 추가되며 추가 보완이나 재시도 시 더 늘 수 있습니다.</small></span></label></fieldset><p class="sub">이 선택은 이번 작업에만 적용되며 설정의 전역 기본값(${defaultText})은 바뀌지 않습니다.</p><div class="dialog__actions"><button class="btn btn--quiet" type="button" value="cancel">취소</button><button class="btn btn--primary" type="button" value="start">시작</button></div>`;
  document.body.append(dialog);
  try {
    return await new Promise<ExtractionReviewChoice>((resolve) => {
      let settled = false;
      const settle = (choice: ExtractionReviewChoice) => {
        if (settled) return;
        settled = true;
        resolve(choice);
      };
      dialog.addEventListener("click", (event) => {
        const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[value]");
        if (!button) return;
        const value = button.value;
        if (value === "start") {
          event.preventDefault();
          const checked = dialog.querySelector<HTMLInputElement>('input[name="review-mode"]:checked');
          dialog.close(checked?.value ?? "basic");
          return;
        }
        dialog.returnValue = value;
        dialog.close();
      });
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        dialog.returnValue = "cancel";
        dialog.close();
      });
      dialog.addEventListener("close", () => {
        settle(dialog.returnValue === "review" ? true : dialog.returnValue === "basic" ? false : undefined);
      });
      dialog.showModal();
    });
  } finally {
    dialog.remove();
  }
}

export function episodeRegenerationComparisonText(preview: any): string {
  const counts = preview?.counts ?? {};
  const describe = (value: any) => (value?.memories ?? []).map((memory: any, index: number) => {
    const details = (memory.details ?? []).map((item: any) => `  · ${item.text}`).join("\n");
    const dialogue = (memory.keyDialogues ?? []).map((item: any) => `  “${item.text}” — ${item.speaker}`).join("\n");
    return `${index + 1}. ${memory.title}\n${memory.content}${details ? `\n${details}` : ""}${dialogue ? `\n${dialogue}` : ""}`;
  }).join("\n\n") || "(에피소드 없음)";
  return `기존: 에피소드 ${counts.before?.memories ?? 0}, 세부 ${counts.before?.details ?? 0}, 대사 ${counts.before?.dialogues ?? 0}\n\n${describe(preview?.before)}\n\n──────── 새 후보 ────────\n새 후보: 에피소드 ${counts.after?.memories ?? 0}, 세부 ${counts.after?.details ?? 0}, 대사 ${counts.after?.dialogues ?? 0}\n\n${describe(preview?.after)}`;
}

export function canonicalRegenerationComparisonText(preview: any): string {
  const before = preview?.counts?.before ?? {}, after = preview?.counts?.after ?? {}, diff = preview?.diff ?? {};
  const delta = (key: string) => `+${diff[key]?.added ?? 0}/-${diff[key]?.removed ?? 0}`;
  const titles = (items: unknown) => Array.isArray(items) && items.length ? items.map((item) => `· ${String(item)}`).join("\n") : "(없음)";
  return `기존 이후 정본: 기억 ${before.memories ?? 0}, 세부 ${before.details ?? 0}, belief ${before.beliefs ?? 0}, 약속 ${before.promises ?? 0}\n새 후보: 기억 ${after.memories ?? 0}, 세부 ${after.details ?? 0}, belief ${after.beliefs ?? 0}, 약속 ${after.promises ?? 0}\n변화: 기억 ${delta("memories")}, 세부 ${delta("details")}, belief ${delta("beliefs")}, 약속 ${delta("promises")} · 변경 묶음 ${preview?.changedBatchCount ?? 0}개\n\n기존 주요 에피소드\n${titles(preview?.highlights?.before)}\n\n새 주요 에피소드\n${titles(preview?.highlights?.after)}`;
}

const parseJson = <T>(value: unknown, fallback: T): T => {
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};

const formatTime = (value: unknown): string => {
  const time = Number(value);
  return Number.isFinite(time) && time > 0 ? new Date(time).toLocaleString() : "—";
};

const formatRelativeTime = (value: unknown): string => {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return "아직 없음";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1_000));
  if (seconds < 60) return "방금 전";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}일 전` : new Date(time).toLocaleDateString();
};

const status = (kind: "ok" | "warn" | "error" | "neutral", text: string): string =>
  `<span class="state state--${kind}">${icon(kind === "ok" ? "check" : kind === "warn" || kind === "neutral" ? "clock" : "error")}<span>${escapeHtml(text)}</span></span>`;

type HomeMessageTone = "neutral" | "success" | "warning" | "danger";

function homeMessage(options: {
  title: string;
  bodyHtml?: string;
  actionsHtml?: string;
  tone?: HomeMessageTone;
  iconName?: string;
  role?: "status" | "alert";
  className?: string;
  detailsHtml?: string;
  disclosureLabel?: string;
}): string {
  const tone = options.tone ?? "neutral";
  const iconName = options.iconName ?? (tone === "danger" ? "error" : tone === "success" ? "check" : tone === "warning" ? "alert" : "clock");
  const className = options.className ? ` ${options.className}` : "";
  const content = `<span class="msg__icon">${icon(iconName)}</span><div class="msg__body"><b>${escapeHtml(options.title)}</b>${options.bodyHtml ?? ""}</div>`;
  if (options.detailsHtml !== undefined) {
    return `<details class="msg msg--${tone}${className}"${options.role ? ` role="${options.role}"` : ""}><summary>${content}<span class="msg__more">${escapeHtml(options.disclosureLabel ?? "상태 보기")}${icon("chevron")}</span></summary><div class="msg__details">${options.detailsHtml}</div></details>`;
  }
  return `<section class="msg msg--${tone}${className}" role="${options.role ?? (tone === "danger" ? "alert" : "status")}">${content}${options.actionsHtml ? `<div class="msg__acts">${options.actionsHtml}</div>` : ""}</section>`;
}

function pluginUpdateAction(state: RuntimeState): string {
  const url = state.updateStatus?.pluginUrl;
  if (url?.startsWith("https://")) return `<a class="btn btn--primary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">플러그인 받기</a>`;
  return btn("업데이트 방법 보기", { kind: "primary", action: "tab", data: { tab: "settings", settingsSection: "server" } });
}

export function updateNotice(state: RuntimeState): string {
  if (state.updateApplying) return homeMessage({
    title: state.updateApplying.error ? "서버 업데이트를 확인해 주세요" : `RCM ${state.updateApplying.targetVersion} 업데이트 중`,
    bodyHtml: `<p>${escapeHtml(state.updateApplying.error ?? "새 서버를 적용하고 다시 연결하고 있습니다. 잠시만 기다려 주세요.")}</p>`,
    tone: state.updateApplying.error ? "warning" : "neutral",
  });
  const update = state.updateStatus;
  const pluginUpdate = pluginUpdateNeeded(update);
  if (!update?.configured || (!update.available && !update.restartRequired && !pluginUpdate && !update.error)) return "";
  if (update.restartRequired) return homeMessage({
    title: "서버 업데이트가 준비되었습니다",
    bodyHtml: `<p>RCM ${escapeHtml(update.stagedVersion ?? update.latestServerVersion ?? "새 버전")} 적용을 마치려면 ${update.canApplyAutomatically ? "아래 버튼을 눌러 주세요" : "이번에는 서버를 다시 시작해 주세요"}. 사용자 설정과 기억 데이터는 유지됩니다.${pluginUpdate ? " 서버 설치 후 플러그인도 업데이트하면 다시 연결됩니다." : ""}</p>`,
    actionsHtml: update.canApplyAutomatically ? '<button class="btn btn--primary" data-action="stage-server-update">서버 업데이트 설치</button>' : undefined,
    tone: "warning",
  });
  if (update.available) return homeMessage({
    title: `RCM ${update.latestVersion ?? update.latestServerVersion ?? "새 버전"} 업데이트`,
    bodyHtml: pluginUpdate
      ? "<p>서버 설치 후 Risu 플러그인 메뉴의 + 버튼으로 플러그인도 업데이트하면 다시 연결됩니다.</p>"
      : "<p>새 서버 버전을 설치할 수 있습니다. 이 릴리스에는 플러그인 업데이트가 필요하지 않습니다.</p>",
    actionsHtml: update.canStageServer ? `<button class="btn btn--primary" data-action="stage-server-update">${update.canApplyAutomatically ? "서버 업데이트 설치" : "서버 업데이트 준비"}</button>` : '<button class="btn btn--quiet" data-action="tab" data-tab="settings" data-settings-section="server">설치 방법 보기 <span aria-hidden="true">→</span></button>',
    tone: "neutral",
  });
  if (pluginUpdate) return homeMessage({
    title: `RCM ${update.latestPluginVersion} 플러그인 업데이트 필요`,
    actionsHtml: pluginUpdateAction(state),
    bodyHtml: "<p>Risu 플러그인 메뉴의 + 버튼으로 새 플러그인을 설치해 주세요.</p>",
    tone: "warning",
  });
  return homeMessage({ title: "업데이트 확인에 실패했습니다", bodyHtml: `<p>${escapeHtml(update.error ?? "업데이트 정보를 읽지 못했습니다.")}</p>`, tone: "warning" });
}

/** Page intro under the group title and section tabs: the page title is for screen readers, the description a quiet line. */
function pageHeader(title: string, description: string, actions = ""): string {
  return `<div class="intro"><h2 class="sr-only">${escapeHtml(title)}</h2>${description ? `<p class="sub">${escapeHtml(description)}</p>` : ""}${actions ? `<div class="intro__acts">${actions}</div>` : ""}</div>`;
}

export function estimateBackfillAuxiliaryCalls(state: RuntimeState, data: Pick<DashboardData, "initialCalibration"> & Partial<DashboardData>): {
  initialCalls: number;
  storyCalls: number;
  extractionGroups: number;
  groupTurns: number;
  reviewIncluded: boolean;
} {
  const context = state.current;
  if (!context) return { initialCalls: 0, storyCalls: 0, extractionGroups: 0, groupTurns: 4, reviewIncluded: false };
  const visibleAssistantTurns = context.messageVisibility?.filter((message) => message.visibility === "active" && message.role === "assistant").length;
  const managed = data.adminChats?.some((chat) => chat.id === context.chatId && chat.ingestionState === "managed");
  const remaining = managed ? managedBackfillSource(state, data as DashboardData) : undefined;
  const completedTurns = remaining ? remaining.turns : visibleAssistantTurns === undefined
    ? Math.ceil(Math.max(0, context.sourceActiveMessageCount) / 2)
    : visibleAssistantTurns;
  const groupTurns = Math.min(50, Math.max(1, Math.round(context.extractionGroupTurns || 6)));
  const extractionGroups = completedTurns > 0 ? Math.ceil(completedTurns / groupTurns) : 0;
  const segmentCalls = Math.min(extractionGroups, Math.max(
    Math.floor(extractionGroups / 4),
    Math.floor(Math.max(0, managed ? 0 : context.estimatedSourceTokens ?? 0) / 40_000),
  ));
  const arcCalls = Math.floor(segmentCalls / 4);
  const overviewCalls = arcCalls;
  const initialStatus = data.initialCalibration?.status ?? "unseeded";
  const initialCalibrationCalls = ["unseeded", "awaiting_setup", "failed"].includes(initialStatus) ? 1 : 0;
  const reviewIncluded = state.settings.postExtractionReview;
  return {
    initialCalls: initialCalibrationCalls,
    storyCalls: segmentCalls + arcCalls + overviewCalls,
    extractionGroups,
    groupTurns,
    reviewIncluded,
  };
}

export function shouldOfferBackfill(state: RuntimeState, data: DashboardData): boolean {
  const context = state.current;
  if (!context || data.connectionIssue || !isChatMemoryEnabled(state.settings, context.chatId) || context.sourceActiveMessageCount === 0) return false;
  const serverInventoryKnown = Boolean(data.health?.ok) && !data.adminError;
  const serverChat = data.adminChats.find((chat) => chat.id === context.chatId);
  if ([data.lineage?.status, serverChat?.lineage?.status, state.lineageProbe?.result?.status].some(status => status === "choice_required" || status === "ambiguous")) return false;
  if (serverChat?.ingestionState === "managed") {
    if (!serverInventoryKnown || data.connectionIssue || data.jobsError) return false;
    const groupTurns = context.extractionGroupTurns || 6;
    // One full eligible group exceeds ordinary protected turns / sub-group remainder.
    const readyGroup = data.chatId === context.chatId && data.bufferedTurns >= groupTurns;
    // Count difference is a conservative lower bound; never compare against archived source.
    const unsynced = managedBackfillSource(state, data).unsynced;
    const ordinaryRemainder = 2 * ((context.editProtectionTurns ?? 2) + groupTurns - 1) + 1;
    return readyGroup || unsynced > ordinaryRemainder;
  }
  if (serverChat) return serverChat.ingestionState === "historical_pending" && Number(serverChat.historicalBackfillMessages ?? 0) > 0;
  return serverInventoryKnown && context.sourceActiveMessageCount > 10;
}

function managedBackfillSource(state: RuntimeState, data: DashboardData): { count: number; unsynced: number; turns: number } {
  const chat = data.adminChats.find((chat) => chat.id === state.current?.chatId);
  const unsynced = chat?.activeMessages === undefined ? 0
    : Math.max(0, (state.current?.sourceActiveMessageCount ?? 0) - Number(chat.activeMessages));
  return { count: Number(data.backfillMessages ?? 0) + unsynced, unsynced,
    turns: Number(data.bufferedTurns ?? 0) + Number(data.protectedTurns ?? 0) + Math.ceil(unsynced / 2) };
}

export const BACKFILL_SETUP_CAPTURE_MESSAGE = [
  "먼저 인물 설정을 가져와야 합니다.",
  "",
  "채팅에서 메시지를 한 번 전송해 주세요. 보내기 버튼이 녹색 원으로 바뀌면 생성을 취소해도 됩니다.",
  "그다음 이 화면으로 돌아와 ‘과거 대화로 기억 생성’을 다시 눌러 주세요.",
].join("\n");

export function capturedSetupForBackfill(state: RuntimeState, chatId: string): NonNullable<RuntimeState["lastResolvedSetup"]>["projection"] | undefined {
  return state.lastResolvedSetup?.chatId === chatId ? state.lastResolvedSetup.projection : undefined;
}

function requireChatMemoryEnabled(state: RuntimeState, chatId: string): void {
  if (!isChatMemoryEnabled(state.settings, chatId)) {
    throw new Error("현재 채팅에서 RCM이 꺼져 있어 새 기억 작업을 만들 수 없습니다. Settings에서 이 채팅의 RCM을 먼저 켜세요.");
  }
}

export function clearDeletedChatState(state: RuntimeState, chatId: string, clearActivation = true): void {
  if (state.lastTurnSearches?.chatId === chatId) state.lastTurnSearches = undefined;
  for (const scope of Object.keys(state.settings.backfillApproved)) if (scope.endsWith(`:${chatId}`)) delete state.settings.backfillApproved[scope];
  if (clearActivation) {
    delete state.settings.chatEnabled[chatId];
    delete state.settings.chatCatchUpPending[chatId];
    delete state.settings.memoryLanguages[chatId];
    delete state.settings.storyOverviewBackups[chatId];
  }
  invalidateRestoredChatState(state,chatId);
  if(state.current?.chatId===chatId)state.current.backfillApproved=false;
}

function invalidateRestoredChatState(state: RuntimeState,chatId:string):void {
  delete state.cache[chatId];
  if (state.current?.chatId === chatId) {
    state.lastPrepare = undefined;
    state.lastInjection = undefined;
    state.automaticTurnPacket = undefined;
    state.activeModelRequest = undefined;
    state.lastPromptValidation = undefined;
    state.statusSummary = { queuedJobs: 0, failedJobs: 0, pendingReviews: 0, pendingEmbeddings: 0, failedEmbeddings: 0 };
  }
}

export function syncReviewActivity(state: RuntimeState, data: Pick<DashboardData, "reconciliationReviews"> & { extractionAudits?: any[] }): void {
  const pendingReconciliations = data.reconciliationReviews.filter((item) => item.status === "pending").length;
  const pendingAudits = (data.extractionAudits ?? []).filter((item) => item.status === "pending_review" || item.status === "failed").length;
  const pendingReviews = pendingReconciliations + pendingAudits;
  const current = state.statusSummary;
  if (current?.pendingReconciliations === pendingReconciliations
    && current?.pendingReviews === pendingReviews) return;
  state.statusSummary = {
    ...(current ?? { queuedJobs: 0, failedJobs: 0, pendingEmbeddings: 0, failedEmbeddings: 0 }),
    pendingReconciliations,
    pendingReviews,
  };
  state.publishStatusSummary?.();
}

export function reviewBadgeVisible(state: RuntimeState): boolean {
  return (state.statusSummary?.pendingReviews ?? 0) > 0
    && (state.statusSummary?.queuedJobs ?? 0) === 0
    && !state.currentJob
    && (state.serverWorker?.activeCalls ?? 0) === 0;
}

export async function pauseWorkerForQueueMutation(
  state: RuntimeState,
  client: ServerClient,
  dependencies: { persist?: typeof saveSettings; updateMenu?: typeof updateWorkerMenuButton } = {},
): Promise<void> {
  if (state.settings.workerPaused) return;
  if (state.settings.extractionEngine === "server") state.serverWorker = await client.pauseServerWorker();
  state.settings.workerPaused = true;
  await (dependencies.persist ?? saveSettings)(state.settings);
  await (dependencies.updateMenu ?? updateWorkerMenuButton)(state);
  state.publishActivity?.();
}

export async function closeDashboardContainer(
  state: RuntimeState,
  hideContainer: () => Promise<void> = () => risuai.hideContainer(),
): Promise<void> {
  // The floating widget lives in PocketRisu's host document while this code
  // runs inside the plugin iframe. Restore it before the host hides/throttles
  // the iframe, otherwise the follow-up host call may never become visible.
  try {
    await state.setStatusWidgetHidden?.(false);
  } catch (error) {
    addLog(state.logs, "warn", `Status widget restore failed while closing dashboard: [오류 원문 제외]`);
  }
  await hideContainer();
}

function backfillNotice(state: RuntimeState, data: DashboardData): string {
  const lineageNotice = lineageProbeNotice(state);
  if (lineageNotice) return lineageNotice;
  const context = state.current;
  if (context && !isChatMemoryEnabled(state.settings, context.chatId)) return homeMessage({
    title: "현재 채팅에서 RCM이 꺼져 있습니다",
    bodyHtml: "<p>기존 기억은 보존되며 새 동기화·추출·과거 기억 생성·기억 도구 호출은 만들지 않습니다.</p>",
  });
  if (!context || !shouldOfferBackfill(state, data)) return "";
  const serverMissing = Boolean(data.health?.ok) && !data.adminError && !data.adminChats.some((chat) => chat.id === context.chatId);
  const serverChat = data.adminChats.find((chat) => chat.id === context.chatId);
  const pocketCount = Number(context.sourceMessageCount);
  const syncedCount = Number(serverChat?.messages ?? 0);
  const managed = serverChat?.ingestionState === "managed";
  const remaining = managedBackfillSource(state, data);
  const title = managed ? "남은 대화를 기억으로 정리할까요?" : "과거 대화를 기억으로 정리할까요?";
  const detail = managed
    ? `지금 기억은 그대로 두고, 아직 기억에 없는 원문 ${remaining.unsynced ? "최소 " : ""}${remaining.count.toLocaleString()}개만 처리합니다.`
    : serverMissing
    ? "현재 Risu 채팅 전체를 처음 동기화해 기억·관계·세계 사실을 만듭니다."
    : "서버에 아직 없는 과거 원문을 가져와 기억·관계·세계 사실을 만듭니다.";
  const calls = estimateBackfillAuxiliaryCalls(state, data);
  return homeMessage({
    title,
    bodyHtml: `<p>${detail}</p>${serverChat?.hasImportedMemory ? "<p>가져온 기억과 겹치는 대화는 다시 처리되어 비용이 늘 수 있습니다.</p>" : ""}<details class="home-backfill__details" data-preserve-open="home-backfill-calls"><summary><span>Risu 원문 ${pocketCount.toLocaleString()}개 · 서버 ${syncedCount.toLocaleString()}개 · 정리 묶음 약 ${calls.extractionGroups.toLocaleString()}</span><span class="chev" aria-hidden="true">${icon("chevron")}</span></summary><div class="home-backfill__calls"><p>기본은 묶음마다 장면 추출과 상태 추출·대조, 두 번의 호출입니다. 관계·줄거리 정리에도 보조 모델을 호출합니다. 전체 호출 수는 추출 결과에 따라 늘어납니다.</p><ul><li>${calls.groupTurns}턴씩 기억 정리 · 장면·상태 합계 약 ${(calls.extractionGroups * 2).toLocaleString()}회</li><li>초기 장부 ${calls.initialCalls}회 · 줄거리 정리 약 ${calls.storyCalls.toLocaleString()}회</li><li>관계 상태·마지막 장부 대조: 추출 결과에 따라 추가</li><li>재검수: 선택 시 묶음마다 1회 추가${calls.reviewIncluded ? " · 현재 기본값 켜짐" : ""}</li><li>형식·근거 보완, 이어서 추출, 재시도는 필요할 때 추가됩니다.</li></ul>${managed || context.estimatedSourceTokens === undefined ? "" : `<p>원문 약 ${context.estimatedSourceTokens.toLocaleString()}토큰</p>`}<p>원문 토큰은 실제 전송량이나 청구량이 아닙니다. 진행 화면에서 후처리를 포함한 실제 호출 수를 확인할 수 있습니다.</p></div></details><p class="home-backfill__hint">로어북에 과거 줄거리 요약이 있다면 잠시 끈 뒤 시작해 주세요.</p>`,
    actionsHtml: `<button class="btn btn--primary home-backfill__action" data-action="approve-backfill">${managed ? "남은 대화로 기억 생성" : "과거 대화로 기억 생성"}</button>`,
    className: "home-backfill",
  });
}

function lineageProbeNotice(state: RuntimeState): string {
  const probe = state.lineageProbe;
  if (probe?.status !== "ready" || !probe.result || probe.result.status === "none") return "";
  const candidates = probe.result.candidates;
  const selected = probe.selectedParentId ?? candidates[0]?.chatId ?? "";
  const choice = probe.result.status === "ambiguous"
    ? `<select data-action="select-probe-source">${candidates.map((item) => `<option value="${escapeHtml(item.chatId)}" ${selected === item.chatId ? "selected" : ""}>${escapeHtml(item.title || item.chatId)}</option>`).join("")}</select>`
    : "";
  return homeMessage({
    title: "기존 채팅에서 복사되거나 분기된 기록을 찾았습니다",
    bodyHtml: `<p>${candidates.length === 1 ? `${escapeHtml(candidates[0]!.title || candidates[0]!.chatId)} · 공통 원문 ${candidates[0]!.sharedMessages.toLocaleString()}개` : "이어받을 원본을 선택하세요."}</p>`,
    actionsHtml: `${choice}<button class="btn btn--primary" data-action="apply-probed-lineage" data-parent-id="${escapeHtml(selected)}">기억 이어받기</button>`,
  });
}

const lineageProbeFlights = new Map<string, Promise<void>>();

function lineageProbePayload(context: NonNullable<Awaited<ReturnType<typeof readOptionalCurrentContext>>["context"]>): LineageProbeRequest {
  const request = makePrepareRequest(context, 0, { deferExtraction: true });
  return {
    chatTitle: request.chatTitle,
    characterId: request.characterId,
    profile: request.profile,
    messageVisibility: request.messageVisibility ?? [],
    lineageHint: request.lineageHint,
    canonicalizationPolicy: request.canonicalizationPolicy,
    includeUserMessages: request.includeUserMessages,
    extractionGroupTurns: request.extractionGroupTurns,
    memoryLanguage: request.memoryLanguage,
  };
}

async function probeDashboardLineage(state: RuntimeState, client: ServerClient, context: NonNullable<RuntimeState["current"]>): Promise<void> {
  if (!isChatMemoryEnabled(state.settings, context.chatId)) return;
  let payload: LineageProbeRequest;
  try { payload = context.snapshot !== undefined ? lineageProbePayload(context) : await readDashboardLineageRequest(context); }
  catch { return; }
  if (state.current?.chatId !== context.chatId || !isChatMemoryEnabled(state.settings, context.chatId)) return;
  const projection = payload.messageVisibility;
  if (!projection.length) return;
  const last = projection.at(-1);
  const key = `${state.settings.serverUrl.replace(/\/$/, "")}:${context.chatId}:${projection.length}:${last?.id ?? ""}:${last?.contentHash ?? ""}:${payload.lineageHint?.parentChatId ?? ""}:${payload.lineageHint?.forkMessageId ?? ""}:${payload.lineageHint?.markerMessageId ?? ""}`;
  if (state.lineageProbe?.key === key && state.lineageProbe.status === "ready") return;
  const existing = lineageProbeFlights.get(key);
  if (existing) return existing;
  state.lineageProbe = { key, status: "checking" };
  const flight = (async () => {
    try {
      const result = await client.request<LineageProbeResponse>(`/v1/chats/${encodeURIComponent(context.chatId)}/lineage/probe`, { method: "POST", body: JSON.stringify(payload) }, 15_000);
      if (state.current?.chatId !== context.chatId) return;
      state.lineageProbe = { key, status: "ready", result, selectedParentId: result.candidates[0]?.chatId };
    } catch (error) {
      if (state.current?.chatId !== context.chatId) return;
      state.lineageProbe = { key, status: "failed", error: String(error) };
    } finally {
      lineageProbeFlights.delete(key);
    }
  })();
  lineageProbeFlights.set(key, flight);
  return flight;
}

export function pendingBufferNotice(data: DashboardData): string {
  if (data.ingestionState !== "managed" || (data.bufferedMessages <= 0 && data.waitingForAssistant <= 0)) return "";
  const tokens = data.bufferedSourceTokens >= 1_000 ? `${(data.bufferedSourceTokens / 1_000).toFixed(1)}k` : data.bufferedSourceTokens.toLocaleString();
  return `<div class="notice" role="status">${icon("clock")}<div><strong>정리 가능한 턴 ${data.bufferedTurns}/${data.extractionGroupTurns} · 약 ${tokens} tokens</strong></div></div>`;
}

function workerAttentionNotice(state: RuntimeState, linkToQueue = false): string {
  const attention = state.settings.workerAttention;
  if (!attention) return "";
  return homeMessage({
    title: "기억 처리가 오류로 멈췄습니다.",
    bodyHtml: `<p>${formatTime(attention.at)} · 처리 상태를 확인한 뒤 직접 재개하세요.</p>`,
    detailsHtml: `<code class="worker-error-code">${escapeHtml(attention.message)}</code>${linkToQueue ? '<button class="btn btn--quiet" data-action="tab" data-tab="operations">처리 상태에서 보기 <span aria-hidden="true">→</span></button>' : ""}`,
    disclosureLabel: "오류 내용",
    tone: "danger",
    role: "alert",
    className: "worker-error-notice",
  });
}

export function initialCalibrationNotice(data: Pick<DashboardData, "initialCalibration">): string {
  const calibration = data.initialCalibration;
  if (calibration?.status === "queued") return homeMessage({
    title: "초기 장부를 만들고 있습니다",
    bodyHtml: "<p>설정 원문에서 인물과 초기 관계를 먼저 정리합니다. 완료되면 확인을 요청할게요.</p>",
  });
  if (calibration?.status === "awaiting_confirmation") return homeMessage({
    title: "초기 장부 확인이 필요합니다",
    bodyHtml: "<p>분석된 인물과 초기 관계를 확인하면 과거 기억 생성을 이어서 시작합니다.</p>",
    actionsHtml: '<button class="btn btn--quiet" data-action="open-initial-calibration">초기 장부 확인 <span aria-hidden="true">→</span></button>',
    tone: "warning",
  });
  if (calibration?.status === "awaiting_setup") return homeMessage({
    title: "인물 설정을 먼저 가져와 주세요",
    bodyHtml: "<p>채팅에 메시지를 한 번 보내고 전송 버튼이 녹색 원으로 돌아오면, 기억 홈에서 ‘과거 대화로 기억 생성’을 다시 눌러 주세요.</p>",
    tone: "warning",
  });
  if (calibration?.status === "failed") return homeMessage({
    title: "초기 장부를 만들지 못했습니다",
    bodyHtml: `<p>${escapeHtml(calibration.lastError ?? "초기 설정 분석을 다시 시도하거나 건너뛸 수 있습니다.")}</p>`,
    actionsHtml: '<button class="btn btn--quiet" data-action="open-initial-calibration">초기 장부에서 확인 <span aria-hidden="true">→</span></button>',
    tone: "danger",
  });
  return "";
}

export function dashboardLiveDataSignature(summary: RuntimeState["statusSummary"]): string {
  return JSON.stringify({ progress: summary?.progress, initialCalibration: summary?.initialCalibration?.status });
}

function currentInjection(state: RuntimeState, instanceId?: string): RuntimeState["lastInjection"] {
  const injection = state.lastInjection;
  if (!injection) return undefined;
  // Explicit omission is a local delivery fact; it has no prepare response/instance.
  return injection.chatId === state.current?.chatId && (!instanceId || state.lastPrepare?.serverInstanceId === instanceId
    || (injection.omitted && injection.blocked === false && injection.prepareOutcome === "skipped")) ? injection : undefined;
}

function homeInjectionManifest(state: RuntimeState, instanceId?: string): InjectionManifest | undefined {
  const chatId = state.current?.chatId;
  if (!chatId) return undefined;
  const injection = currentInjection(state, instanceId);
  if (injection) return injection.manifest;
  const cached = state.cache[chatId];
  return cached && (!instanceId || cached.serverInstanceId === instanceId) ? cached.lastInjectionManifest : undefined;
}

/** The list observes its own box only when it really scrolls (desktop split); on phones the viewport is the root. */
const scrollingRoot = (element: HTMLElement | null): HTMLElement | null =>
  element && element.scrollHeight > element.clientHeight + 1 && /auto|scroll/u.test(getComputedStyle(element).overflowY) ? element : null;

const memoryPlace = (memory: any): string | null => {
  const place = Array.isArray(memory?.locations) ? memory.locations.filter(Boolean)[0] : memory?.location;
  return place ? String(place) : null;
};

/** The first key dialogue line of a scene, translated when a translation is loaded. */
function sceneSubtitle(memory: any, translations: Map<string, string>, display: TranslationDisplay): { html: string; speaker: string } | undefined {
  const lines: any[] = Array.isArray(memory?.keyDialogues) ? memory.keyDialogues : [];
  const index = lines.findIndex((line) => String(line?.text ?? "").trim());
  if (index < 0) return undefined;
  const line = lines[index];
  return { html: displayText(String(line.text), translations.get(`${memory.id}:dialogue:${index}`), display), speaker: String(line.speaker ?? "") };
}

function incompatibleHome(state: RuntimeState, data: DashboardData): string {
  const issue = data.connectionIssue!;
  const action = issue.requiredUpdate === "plugin" ? pluginUpdateAction(state)
    : btn("서버 업데이트 보기", { action: "tab", kind: "primary", data: { tab: "settings", settingsSection: "server" } });
  return `<div class="home"><h1 class="sr-only">홈</h1>${homeMessage({ title: issue.title, bodyHtml: `<p>${escapeHtml(issue.detail)}</p>`, actionsHtml: action, tone: "neutral" })}</div>`;
}

/** The body follows the same connection transition published to the topbar and chip. */
export function subscribeDashboardConnection(
  state: RuntimeState,
  updateData: (issue: ServerConnectionIssue | undefined) => void,
  render: () => void,
  refresh: () => Promise<void>,
): () => void {
  const signature = () => JSON.stringify([state.serverConnectionIssue?.kind, state.serverConnectionIssue?.requiredUpdate,
    state.serverConnectionIssue?.title, state.serverConnectionIssue?.detail]);
  let previous = signature();
  return subscribeActivity(state, () => {
    const next = signature();
    if (next === previous) return;
    previous = next;
    updateData(state.serverConnectionIssue);
    render();
    void refresh();
  });
}

export function overview(state: RuntimeState, data: DashboardData, translations: Map<string, string> = new Map(), loaded = true, sentView?: SentView): string {
  if (data.connectionIssue?.kind === "incompatible") return incompatibleHome(state, data);
  if (!loaded) {
    const failed = data.failedDatasets?.some((dataset) => dashboardDatasetsForTab("overview").includes(dataset));
    const body = failed ? notice("데이터를 불러오지 못했어요.", { tone: "cut", action: btn("다시 시도", { kind: "quiet", action: "refresh", hit: true }) }) : loading();
    return `<div class="home"><h1 class="sr-only">홈</h1><div class="home__poster"><section class="poster is-empty">${body}</section></div></div>`;
  }
  const canonicalLanguage = state.lastPrepare?.memoryLanguage ?? state.current?.memoryLanguage ?? (state.current ? state.settings.memoryLanguages[state.current.chatId] : undefined) ?? "en";
  const translationDisplay: TranslationDisplay = canonicalLanguage === "ko" ? "en" : state.settings.translationDisplay;
  const queued = data.jobs.filter((job) => ["queued", "leased"].includes(job.status)).length;
  const blockingFailed = data.jobs.filter((job) => job.status === "failed" && job.type === "extract").length;
  const advisoryFailed = data.jobs.filter((job) => job.status === "failed" && job.type !== "extract").length;
  const failed = blockingFailed + advisoryFailed;
  const currentChatId = state.current?.chatId ?? "";
  const currentInstanceId = data.health?.instanceId;
  const liveInjection = currentInjection(state, currentInstanceId);
  const cachedState = state.cache[currentChatId];
  const compatibleCache = cachedState && (!currentInstanceId || cachedState.serverInstanceId === currentInstanceId) ? cachedState : undefined;
  const cachedPacket = compatibleCache?.lastPacket ?? "";
  const packet = liveInjection?.packet ?? cachedPacket;
  const manifest = homeInjectionManifest(state, currentInstanceId);
  const injectionAt = liveInjection?.at ?? compatibleCache?.lastInjectionAt;
  const packetTokens = liveInjection ? liveInjection.injectedTokens : packet ? estimateTokens(packet) : 0;
  const hardTokenCeiling = liveInjection ? Math.floor(liveInjection.requestedBudget * 115 / 100) : 0;
  const chatEnabled = state.current ? isChatMemoryEnabled(state.settings, state.current.chatId) : false;
  const validation = state.lastPromptValidation?.chatId === currentChatId ? state.lastPromptValidation : undefined;
  const validationCopy = !state.current ? "활성 채팅 없음"
    : !chatEnabled ? "현재 채팅에서 RCM 꺼짐"
      : validation?.status === "marker_present" ? "[[RCM]] 표식 확인됨"
        : validation?.status === "existing_context" ? "기존 RCM 패킷 확인됨"
          : validation?.status === "marker_missing" ? "표식 누락 — 전송 중단"
            : "이번 실행에서 아직 모델 요청 없음";
  const resolvedPerspectives = state.lastPrepare?.perspectiveResolution?.perspectives ?? state.perspectiveStatus?.perspectives ?? [];
  type Tone = "ok" | "wait" | "bad";
  const statusItems: Array<{ tone: Tone; text: string }> = [
    data.health?.ok ? { tone: "ok", text: `서버 · ${data.health.version}` } : { tone: "bad", text: data.connectionIssue?.title ?? "서버 연결 확인 필요" },
    data.health?.embeddingReady
      ? { tone: "ok", text: `임베딩 · ${data.health.embedding?.model ?? "Context 4"} 준비됨` }
      : { tone: "wait", text: data.health?.embedding?.configured && data.health?.vectorEnabled ? "임베딩 준비 중" : "텍스트 검색 사용 중" },
    ...(state.current ? [{ tone: "ok" as Tone, text: `채팅 · ${state.current.chatTitle || state.current.characterName}` }] : []),
    ...(state.perspectiveStatus?.unresolved ? [{ tone: "wait" as Tone, text: "관점 확인 필요" }]
      : resolvedPerspectives.length ? [{ tone: "ok" as Tone, text: `관점 · ${resolvedPerspectives.join(" · ")}` }] : []),
    { tone: validation?.status === "marker_missing" ? "bad" : chatEnabled ? "ok" : "wait", text: validationCopy },
    ...(state.settings.workerPaused ? [{ tone: "wait" as Tone, text: "처리 일시정지" }] : state.workerBusy ? [{ tone: "wait" as Tone, text: "기억 처리 중" }] : []),
    data.jobsError ? { tone: "bad", text: "작업 큐 확인 필요" } : queued ? { tone: "wait", text: `작업 대기 · ${queued}건` } : { tone: "ok", text: "대기 작업 없음" },
    ...(blockingFailed ? [{ tone: "bad" as Tone, text: `추출 실패 ${blockingFailed}건` }] : []),
    ...(advisoryFailed ? [{ tone: "wait" as Tone, text: `부가 정리 실패 ${advisoryFailed}건` }] : []),
  ];
  const pendingConflicts = data.conflicts.filter((item) => item.status === "pending").length;
  const needsAttention = Boolean(data.connectionIssue) || !data.health?.ok || failed > 0 || validation?.status === "marker_missing" || state.settings.workerPaused || pendingConflicts > 0;
  const blockingAlert = blockingFailed > 0 && !data.connectionIssue;
  const blockingTitle = "기억 추출이 멈췄어요";
  const blockingCopy = queued > 0 ? `실패한 작업 ${blockingFailed}건 때문에 뒤의 ${queued}건이 기다리고 있어요.` : `실패한 작업 ${blockingFailed}건을 다시 시도해 주세요.`;
  const backfillPending = shouldOfferBackfill(state, data);
  const hasDerivedData = data.memories.length + data.relationships.length + data.assertions.length + data.promises.length > 0;
  const processing = queued > 0 || state.workerBusy;
  const jobsUnavailable = Boolean(data.jobsError);
  const healthTitle = data.connectionIssue?.title ?? (!data.health?.ok ? "기억 서버를 확인해 주세요"
    : jobsUnavailable ? "작업 목록을 불러오지 못했어요"
      : blockingFailed ? blockingTitle
      : advisoryFailed ? `완료하지 못한 부가 정리 ${advisoryFailed}건이 있습니다`
        : pendingConflicts ? `확인이 필요한 충돌 ${pendingConflicts}건`
          : validation?.status === "marker_missing" ? "표식 누락 — 전송 중단"
            : state.settings.workerPaused ? "처리 일시정지"
              : backfillPending && !hasDerivedData ? "아직 만들어진 기억이 없습니다"
                : processing ? "기억을 정리하고 있습니다"
                  : !hasDerivedData ? "첫 기억을 기다리고 있습니다"
                    : data.bufferedTurns > 0 ? "다음 기억 묶음을 기다리고 있습니다"
                      : "기억 처리가 정상입니다");
  const healthDetail = data.connectionIssue?.detail ?? (jobsUnavailable ? "작업 큐를 불러오지 못해 현재 처리 상태를 확인할 수 없습니다."
    : blockingFailed ? "해당 대화 묶음의 1차 추출이 끝나지 않아 이후 기억 추출을 멈췄습니다."
    : advisoryFailed ? "기억 추출은 계속 진행됐습니다. 관계·줄거리·최종 대조 같은 부가 작업은 처리 상태에서 다시 확인할 수 있습니다."
    : queued ? `대기 중 ${queued}건 · 완료된 항목부터 차례로 표시됩니다.`
    : backfillPending && !hasDerivedData ? "과거 대화로 기억을 생성하면 이곳에 채워집니다."
      : !hasDerivedData ? "완료된 RP 턴이 모이면 자동으로 정리합니다."
        : data.bufferedTurns > 0 ? `현재 ${data.bufferedTurns}/${data.extractionGroupTurns || 6}턴이 준비되었습니다.`
          : "처리 가능한 기록은 모두 반영되었습니다.");
  const alerts = `${updateNotice(state)}${lineagePanel(data)}${initialCalibrationNotice(data)}${backfillNotice(state, data)}${data.connectionIssue ? "" : workerAttentionNotice(state, true)}`;
  const numbers = sceneNumbers(data.memories);
  const recent = homeRecentMemories(data.memories);
  const sceneTitle = (memory: any): string => displayText(memory.title ?? "제목 없는 기억", translations.get(`${memory.id}:title`), translationDisplay);
  const sceneSlug = (memory: any): string => slugline(numbers.get(String(memory.id)) ?? 0, memoryPlace(memory), memory.story_time ?? memory.storyTime ?? null);

  const latest = recent[0];
  const latestSubtitle = latest ? sceneSubtitle(latest, translations, translationDisplay) : undefined;
  const latestDate = latest ? sceneDate(latest.story_time ?? latest.storyTime ?? null) : null;
  const poster = latest
    ? `<section class="poster" aria-label="${lex().nowShowing}"><div class="frame__slug"><b>${escapeHtml(sceneSlug(latest))}</b>${latestDate ? `<span class="tc">${escapeHtml(latestDate)}</span>` : ""}</div><h2><button type="button" data-action="open-timeline-memory" data-memory-id="${escapeHtml(latest.id)}">${sceneTitle(latest)}</button></h2>${latestSubtitle ? `<p class="subtitle"><span>${latestSubtitle.html}</span><small>${escapeHtml(latestSubtitle.speaker)}</small></p>` : ""}</section>`
    : `<section class="poster is-empty">${empty(lex().emptyScenes, backfillPending ? "과거 대화로 기억을 만들면 여기에 첫 씬이 걸립니다." : "대화가 몇 턴 쌓이면 첫 씬이 정리됩니다.")}</section>`;
  const recentFrames = recent.slice(1).map((memory) => {
    const date = sceneDate(memory.story_time ?? memory.storyTime ?? null);
    return frame({ slug: sceneSlug(memory), date: date ?? undefined, title: "", titleHtml: sceneTitle(memory), subtitle: sceneSubtitle(memory, translations, translationDisplay), action: "open-timeline-memory", data: { memoryId: String(memory.id) } });
  }).join("");
  const recentSection = `<section class="home__recent"><h2 class="sec">최근 씬 ${btn("씬 목록", { kind: "quiet", iconEnd: "chevron", action: "tab", data: { tab: "timeline" }, hit: true })}</h2>${recentFrames ? `<div class="strip3">${recentFrames}</div>` : ""}</section>`;

  const pencil = homePencilCounts(data);
  const pencilTotal = pencil.overdue + pencil.attention;
  const notices = [
    data.connectionIssue ? notice(`${healthTitle} · ${healthDetail}`, { tone: "cut", action: btn("서버 설정 열기", { kind: "quiet", action: "tab", data: { tab: "settings", settingsSection: "server" }, hit: true }) }) : "",
    blockingAlert ? notice(`${blockingTitle} · ${blockingCopy}`, { tone: "cut", action: `<span class="notice__acts">${btn("다시 시도", { kind: "primary", action: "retry-failed" })}${btn("처리 상태", { kind: "quiet", action: "tab", data: { tab: "operations" } })}</span>` }) : "",
    pendingConflicts ? notice(`확인이 필요한 충돌 ${pendingConflicts}건`, { tone: "cut", action: btn("관리로", { kind: "quiet", iconEnd: "chevron", action: "tab", data: { tab: "reviews", attentionFilter: "conflict" }, hit: true }) }) : "",
    // One thing to do, said plainly: what is waiting and how many.
    pencilTotal ? notice([pencil.overdue ? `기한 지난 약속 ${pencil.overdue}개` : "", pencil.attention ? `확인할 기록 ${pencil.attention}개` : ""].filter(Boolean).join(" · "), { tone: "cut", action: btn("확인하기", { kind: "quiet", iconEnd: "chevron", action: "tab", data: { tab: "world" }, hit: true }) }) : "",
  ].join("");

  const homePairs = buildHomePairs(data);
  const pairs = homePairs.length ? `<section><h2 class="sec">주연 <span class="n">${homePairs.length}</span></h2>${homePairs.map((pair) => {
    const label = pair.label ? displayText(pair.label, translations.get(relationshipLabelTranslationKey(pair)), translationDisplay) : "";
    const meta = [label, pair.days === null ? "" : `${pair.days}일`, pair.scenes ? `${pair.scenes}씬` : "", pair.lastScene ? escapeHtml(`마지막 씬 ${sceneDate(pair.lastScene) ?? pair.lastScene}`) : ""].filter(Boolean).join(" · ");
    return `<button type="button" class="pairrow" data-action="open-relationship" data-key="${escapeHtml(pair.key)}"><span class="names">${nameHtml(pair.a)}<span class="x" aria-label="와">×</span>${nameHtml(pair.b)}</span><span class="end">${icon("chevron")}</span>${meta ? `<span class="meta">${meta}</span>` : ""}</button>`;
  }).join("")}</section>` : "";

  const targetBudget = liveInjection?.requestedBudget ?? state.settings.memoryBudgets[currentChatId] ?? state.settings.defaultMemoryBudget;
  const hasInjection = Boolean(injectionAt && (packet || liveInjection || (manifest && manifest.source !== "empty")));
  const phoneHome = lex().skin === "phone";
  const lower = (name: string) => name.trim().toLocaleLowerCase();
  const pairKey = (a: string, b: string) => [lower(a), lower(b)].sort().join("|");
  const injectedScenes = new Map((compatibleCache?.lastInjectionScenes ?? []).map((scene) => [scene.id, scene]));
  const injectedIds = new Set(manifest?.memoryIds ?? []);
  const toSentScene = (id: string): SentScene | null => {
    const memory: any = (data.memories ?? []).find((item: any) => String(item?.id) === id);
    if (!memory) return null;
    const summary = injectedScenes.get(id);
    return { memoryId: id, no: numbers.get(id) ?? 0, titleHtml: sceneTitle(memory), when: sceneDate(memory.story_time ?? memory.storyTime ?? null) ?? "",
      clarity: summary?.clarity, details: summary?.details, dialogues: summary?.dialogues };
  };
  const sentPairs = new Map<string, { a: string; b: string }>();
  for (const pair of manifest?.relationshipPairs ?? []) if (!sentPairs.has(pairKey(pair.from, pair.to))) sentPairs.set(pairKey(pair.from, pair.to), { a: pair.from, b: pair.to });
  const sentPeople: SentPerson[] = [...sentPairs.values()].map(({ a, b }) => {
    const match = homePairs.find((pair) => pairKey(pair.a, pair.b) === pairKey(a, b));
    return { key: [a, b].sort().join("|"), namesHtml: `${nameHtml(a)} &amp; ${nameHtml(b)}`, meta: "",
      labelHtml: match?.label ? displayText(match.label, translations.get(relationshipLabelTranslationKey(match)), translationDisplay) : "" };
  });
  const intimacyCount = manifest?.intimacyMilestoneIds?.length ?? 0;
  if (intimacyCount) sentPeople.push({ namesHtml: "스킨십 기록", labelHtml: `${intimacyCount}개`, meta: "" });
  const sentNote = !liveInjection ? "마지막으로 준비한 기억이에요. 이번 답변에 실제로 들어갔는지는 확인하지 못했어요."
    : liveInjection.omitted && liveInjection.blocked === false ? "기억 없이 보냄"
    : liveInjection.evidenceInjected === false && liveInjection.guidanceInjected === true ? "이번에는 기억 없이 안내만 건넸어요."
      : liveInjection.evidenceInjected === false && liveInjection.guidanceInjected === false ? "이번에는 RCM 내용을 건네지 않았어요."
        : "답변을 쓰기 전에 메인 모델에게 건넨 기억이에요.";
  const sentData: SentData = {
    at: injectionAt, tokens: packetTokens, target: targetBudget, estimated: !liveInjection,
    over: hardTokenCeiling > 0 && packetTokens > hardTokenCeiling,
    memoryOnly: state.settings.memoryOnlyInjection?.[currentChatId] === true,
    fallback: manifest?.source === "fallback",
    scenes: (manifest?.memoryIds ?? []).flatMap((id) => toSentScene(id) ?? []).sort((left, right) => right.no - left.no),
    spine: manifest?.storySpineNodeIds?.length ?? 0,
    people: sentPeople, peopleCount: sentPairs.size + intimacyCount,
    now: manifest ? injectedStateRows(manifest, data, translations, translationDisplay) : [],
    searches: (state.lastTurnSearches?.chatId === currentChatId ? state.lastTurnSearches.calls : []).map((search) => ({ ...search,
      expandedMemory: search.expandedMemoryId ? toSentScene(search.expandedMemoryId) ?? undefined : undefined,
      scenes: search.memoryIds.flatMap((id) => { const scene = toSentScene(id); return scene ? [{ ...scene, already: injectedIds.has(id) || search.alreadyProvidedIds.includes(id) }] : []; }) })),
    note: sentNote, packet,
  };
  if (sentView?.open && hasInjection) {
    const key = JSON.stringify([currentInstanceId, currentChatId, injectionAt, packet, state.settings.translationProvider]);
    if (sentView.packetTranslation?.key !== key) sentView.packetTranslation = { key, source: packet, google: state.settings.translationProvider === "google" };
    return sentPage(sentData, sentView);
  }
  const injection = hasInjection
    ? phoneHome ? sentWidget(sentData, true) : `<section class="sent-home">${sentWidget(sentData, false)}</section>`
    : phoneHome ? `<h2 class="wg__h">${icon("arrow-right")}이번 턴에 전달한 기억</h2><p class="wg__empty">아직 없어요 · 다음 답변부터 보여요</p>`
      : '<section><h2 class="sec">이번 턴에 전달한 기억</h2><p class="sub">아직 전달된 기억이 없습니다. 메인 모델에 기억을 전달하면 여기에 보입니다.</p></section>';

  const bufferTarget = Math.max(1, data.extractionGroupTurns || state.current?.extractionGroupTurns || 6);
  const protectionTarget = Math.min(5, Math.max(1, Math.round(Number(state.current?.editProtectionTurns ?? state.settings.editProtectionTurns ?? 2))));
  const readyTurns = Math.max(0, data.bufferedTurns || 0);
  const protectedTurns = Math.max(0, data.protectedTurns || 0);
  const workflowTarget = bufferTarget + protectionTarget;
  const workflowTurns = Math.min(workflowTarget, readyTurns + protectedTurns);
  const workflow = backfillPending ? "" : `<div class="meter" role="img" aria-label="다음 기억 정리 ${workflowTurns} / ${workflowTarget}턴"><span>다음 기억 정리</span><i style="--v:${Math.round(workflowTurns / workflowTarget * 100)}%"></i><span>${workflowTurns} / ${workflowTarget}턴</span></div><p class="sub">최근 ${protectionTarget}턴을 수정에 대비해 보호하고, 그 앞의 ${bufferTarget}턴이 모이면 기억으로 정리합니다.${protectedTurns ? ` 보호 중 ${protectedTurns}턴.` : ""}</p>`;
  const homeSceneCount = storyScenes(data.memories).length;
  const counts: Array<[string, string]> = [
    ["Risu 원문", Number(state.current?.sourceMessageCount ?? 0).toLocaleString()],
    ["장면", homeSceneCount.toLocaleString()],
    ["관계", data.relationships.length.toLocaleString()],
    ["세계 사실", data.assertions.length.toLocaleString()],
    ["열린 약속", data.promises.filter((item) => item.status === "open").length.toLocaleString()],
  ];
  const phoneAdvisoryAlert = lex().skin === "phone" && !data.connectionIssue && !blockingAlert && !pendingConflicts && advisoryFailed > 0;
  const homeAttentionAlert = Boolean(data.connectionIssue) || blockingAlert || pendingConflicts > 0 || Boolean(state.settings.workerAttention) || phoneAdvisoryAlert;
  const processingBody = `<p class="sub">${escapeHtml(healthDetail)}</p>${statusList(statusItems)}<dl class="kv">${counts.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("")}</dl>${workflow}`;
  const backfillProgress = data.coldStartProgress;
  const measurableBackfill = backfillProgress && backfillProgress.runComplete === false && !backfillProgress.acknowledged
    && processing && !state.settings.workerPaused && !blockingFailed && backfillProgress.totalGroups > 0;
  const statusWord = blockingFailed ? "멈춤" : needsAttention || jobsUnavailable || state.settings.workerAttention ? "확인 필요" : processing ? "정리 중" : "정상";
  const statusDetail = blockingFailed ? `실패 ${blockingFailed}건` : statusWord === "확인 필요" ? healthTitle : processing ? `대기 ${queued}건` : `다음 기억까지 ${workflowTurns}/${workflowTarget}턴`;
  const processingMeter = measurableBackfill ? `<span class="wg__meter" role="img" aria-label="과거 대화 기억 정리 ${backfillProgress.processedGroups}/${backfillProgress.totalGroups}묶음"><i style="--v:${Math.min(100, Math.max(0, Math.round(backfillProgress.processedGroups / backfillProgress.totalGroups * 100)))}%"></i></span>` : "";
  const processingFold = data.connectionIssue ? "" : phoneHome
    ? `<h2 class="wg__h">${icon("refresh")}처리 상태</h2><details class="wg__processing" data-preserve-open="home-status"${needsAttention && !homeAttentionAlert ? " open" : ""}><summary><span class="wg__status"><span><b>${statusWord}</b><small> · ${escapeHtml(statusDetail)}</small></span><span class="chev" aria-hidden="true">${icon("chevron")}</span></span>${processingMeter}</summary><div class="fold__body">${processingBody}</div></details>`
    : fold(homeAttentionAlert ? "처리 상태" : `처리 상태 · ${healthTitle}`, processingBody, { role: "section", open: needsAttention && !homeAttentionAlert, preserveKey: "home-status" });

  if (lex().skin === "phone") {
    // The phone skin's home is a lock screen built from the same facts.
    const dueRows = overduePromiseEntries(buildNowPage(data, data.personaEntity, "promise", "recent")).map(({ row }) => row);
    const firstDue = dueRows[0];
    const latestTime = latest ? latest.story_time ?? latest.storyTime ?? null : null;
    const weekday = storyWeekday(latestTime);
    const part = dayPart(latestTime);
    const running = storyGroups(data.storySpine).at(-1);
    const runningPlace = running ? storyActPlaces(data.storySpine).get(running.key) : undefined;
    return renderLockHome({
      place: latest ? memoryPlace(latest) : null,
      date: latestDate,
      dayLine: [weekday ? `${weekday}요일${part ? ` ${part}` : ""}` : part ?? "", latest ? `${numbers.get(String(latest.id)) ?? 0}번째 장면` : ""].filter(Boolean).join(" · "),
      overdue: pencil.overdue,
      daysTogether: homePairs[0]?.days ?? null,
      scenes: homeSceneCount,
      latest: latest ? { memoryId: String(latest.id), speaker: latestSubtitle?.speaker ?? "", lineHtml: latestSubtitle?.html ?? null, titleHtml: sceneTitle(latest), sceneNo: numbers.get(String(latest.id)) ?? 0 } : null,
      overduePromise: firstDue ? { textHtml: displayText(firstDue.text || "내용 없음", translations.get(`promise:${firstDue.id}`), translationDisplay), who: [firstDue.promisor, firstDue.promisee].filter(Boolean).join(" → "), when: firstDue.scheduledFor ? formatStoryTime(firstDue.scheduledFor, true) : "", more: Math.max(0, dueRows.length - 1) } : null,
      chapter: running ? {
        label: runningPlace ? lex().partAct(runningPlace.season, runningPlace.act) : lex().act(0),
        titleHtml: displayText(String(running.group?.title ?? "이야기 구간"), translations.get(storyTranslationKey(running.key, "title")), translationDisplay),
        scenes: actScenes(running.group, data.memories).length,
      } : null,
      pairs: homePairs.map((pair) => ({ key: pair.key, a: pair.a, b: pair.b, labelHtml: pair.label ? displayText(pair.label, translations.get(relationshipLabelTranslationKey(pair)), translationDisplay) : "", days: pair.days })),
      recent: recent.slice(1, 4).map((memory) => ({ memoryId: String(memory.id), sceneNo: numbers.get(String(memory.id)) ?? 0, titleHtml: sceneTitle(memory), when: sceneDate(memory.story_time ?? memory.storyTime ?? null) })),
      injectionHtml: injection,
      processingHtml: processingFold,
      alerts: [
        ...(data.connectionIssue ? [{ tone: "cut" as const, text: healthTitle, action: "tab", data: { tab: "settings", settingsSection: "server" } }] : []),
        ...(blockingAlert ? [{ tone: "cut" as const, text: blockingTitle, body: blockingCopy, actions: [
          { label: "다시 시도", kind: "primary" as const, action: "retry-failed" },
          { label: "처리 상태", kind: "quiet" as const, action: "tab", data: { tab: "operations" } },
        ] }] : []),
        ...(pendingConflicts ? [{ tone: "cut" as const, text: `확인이 필요한 충돌 ${pendingConflicts}건`, action: "tab", data: { tab: "reviews", attentionFilter: "conflict" } }] : []),
        ...(pencil.attention ? [{ tone: "wait" as const, text: `확인할 기록 ${pencil.attention}개`, action: "tab", data: { tab: "world" } }] : []),
        ...(phoneAdvisoryAlert ? [{ tone: "wait" as const, text: healthTitle, action: "tab", data: { tab: "operations" } }] : []),
      ],
      noticesHtml: alerts,
      emptyTitle: lex().emptyScenes,
    });
  }

  return `<div class="home"><h1 class="sr-only">홈</h1>
    <div class="home__poster">${poster}</div>
    <div class="home__side">${alerts}${notices}${pairs}${injection}${processingFold}</div>
    ${recentSection}
  </div>`;
}

function lineagePanel(data: DashboardData): string {
  const lineage = data.lineage;
  if (!lineage || ["none", "reverted", "independent"].includes(lineage.status) || lineage.acknowledgedAt) return "";
  if (lineage.status === "ambiguous" || lineage.status === "choice_required") {
    const candidates = lineage.ambiguousCandidates ?? [];
    const fingerprint = candidates[0]?.fingerprint ?? "";
    return homeMessage({
      title: candidates.length > 1 ? "이어받을 원본 채팅을 선택해 주세요" : "복사된 채팅의 기억을 이어받을까요?",
      bodyHtml: candidates.length > 1
        ? "<p>같은 메시지를 가진 후보가 여러 개입니다.</p>"
        : "<p>원본의 기억을 이어받거나, 이 채팅을 독립적으로 시작할 수 있습니다.</p>",
      actionsHtml: `${candidates.map((item) => `<button class="btn${candidates.length === 1 ? " btn--primary" : ""}" data-action="select-lineage" data-parent-id="${escapeHtml(item.chatId)}">${candidates.length === 1 ? "기억 이어받기" : `${escapeHtml(item.title)} · ${item.sharedMessages}개 일치`}</button>`).join("")}<button class="btn" data-action="decline-lineage" data-fingerprint="${escapeHtml(fingerprint)}">새로 시작</button>`,
      tone: "warning",
    });
  }
  const labels: Record<string, string> = { messages: "원문", memories: "기억", relationships: "관계", assertions: "사실", beliefs: "belief", promises: "약속", socialKnowledge: "지인", physicalIntimacy: "스킨십", translations: "번역", pendingReextraction: "자식에서 다시 정리할 원문" };
  const counts = Object.entries(lineage.inheritedCounts ?? {}).filter(([, value]) => value > 0).map(([key, value]) => `${labels[key] ?? key} ${value}`).join(" · ");
  const kind = lineage.kind === "branch" ? "과거 분기" : lineage.kind === "pruned_copy" ? "앞부분을 자른 복사" : "전체 복사";
  return homeMessage({
    title: `${lineage.parentTitle ?? lineage.parentChatId ?? "원본 채팅"}에서 기억을 상속했습니다.`,
    bodyHtml: `<p>${kind}${lineage.forkOrdinal !== undefined ? ` · fork #${lineage.forkOrdinal}` : ""}${counts ? ` · ${escapeHtml(counts)}` : ""}</p>`,
    actionsHtml: '<button class="btn btn--primary" data-action="acknowledge-lineage">확인</button><button class="btn btn--danger" data-action="revert-lineage">상속 취소</button>',
    tone: "success",
  });
}

export function lineagePath(data: DashboardData): string {
  const ancestry = data.lineage?.ancestry ?? [];
  if (ancestry.length < 2) return "";
  const renderPath = (items: typeof ancestry): string => `<ol class="lineage">${items.map((item, index) => {
    const edge = index === 0 ? "" : `<span class="lineage__edge">${item.kind === "branch" ? "분기" : item.kind === "pruned_copy" ? "잘린 복사" : item.detection === "manual_cross_bot" ? "수동 상속" : "복사"}${item.forkOrdinal === undefined ? "" : ` #${item.forkOrdinal}`}</span>`;
    const label = item.title || item.chatId;
    const node = item.exists
      ? `<button type="button" class="linkbtn" data-action="view-server-data" data-chat-id="${escapeHtml(item.chatId)}" title="${escapeHtml(item.chatId)}">${escapeHtml(label)}</button>`
      : `<span class="sub" title="${escapeHtml(item.chatId)}">${escapeHtml(label)} · 원본 서버 자료 없음</span>`;
    return `<li>${edge}${node}</li>`;
  }).join("")}</ol>`;
  const path = renderPath(ancestry);
  return `<section class="lineage-block"><h2 class="sec">채팅 계보 <span class="n">각 채팅은 상속 시점 이후 독립적으로 진행됩니다</span></h2>${ancestry.length > 5 ? fold(`${ancestry[0]?.title || ancestry[0]?.chatId} → ${ancestry.length - 2}개 중간 세대 → ${ancestry.at(-1)?.title || ancestry.at(-1)?.chatId}`, path, { role: "section", preserveKey: "lineage-path" }) : path}</section>`;
}

export function noActiveChat(data: DashboardData, tab: Tab, state: RuntimeState): string {
  if (tab === "overview" && data.connectionIssue?.kind === "incompatible") return incompatibleHome(state, data);
  const headings: Record<Exclude<Tab, "data" | "settings">, [string, string]> = {
    overview: ["기억 홈", "현재 채팅의 기억 상태를 확인합니다."],
    initial: ["등장인물", "인물을 찾고 확인합니다."],
    story: ["줄거리", "이야기의 흐름을 한곳에서 읽습니다."],
    timeline: ["타임라인", "기억을 찾고 확인합니다."],
    relationships: ["관계", "인물 사이의 관계를 확인합니다."],
    world: ["현재", "지금 유효한 기록을 확인합니다."],
    reviews: ["상태 확인", "RCM이 자동으로 바꾸지 않은 상태와 충돌을 확인합니다."],
    conflicts: ["충돌", "자동으로 덮어쓰지 않은 사실 충돌을 검토합니다."],
    operations: ["처리 상태", "현재 채팅의 기억 처리와 실패한 작업을 확인합니다."],
  };
  const [title, description] = headings[tab as Exclude<Tab, "data" | "settings">] ?? headings.overview;
  const detail = data.contextError
    ? `Risu에서 현재 채팅 정보를 읽지 못했습니다: ${data.contextError}`
    : "캐릭터 채팅에 들어가면 이 탭에 해당 채팅의 기억과 작업 상태가 표시됩니다. 서버 연결과 전역 설정은 그대로 유지됩니다.";
  const items = [
    data.health?.ok ? { tone: "ok" as const, text: `서버 · ${data.health.version}` } : { tone: "bad" as const, text: "서버 연결 확인 필요" },
    data.health?.embeddingReady ? { tone: "ok" as const, text: `임베딩 · ${data.health.embedding?.model ?? "Context 4"} 준비됨` } : { tone: "wait" as const, text: data.health?.embedding?.configured ? "임베딩 확인 필요" : "텍스트 검색 사용 중" },
    { tone: "wait" as const, text: "활성 채팅 없음" },
  ];
  return `<div class="noactive"><h2 class="sr-only">${escapeHtml(title)}</h2><p class="sub">${escapeHtml(description)}</p>${empty("현재 선택된 채팅이 없습니다", detail, `<div class="decide">${btn("저장된 채팅 보기", { kind: "secondary", action: "tab", data: { tab: "data" } })}${btn("서버 설정 보기", { kind: "quiet", action: "tab", data: { tab: "settings" } })}</div>`)}${fold("상태 보기", statusList(items), { role: "section", preserveKey: "no-active-status" })}</div>`;
}

/** Deleting a person: what goes with them, counted by the server, before one irreversible button. */
function entityDeletePanel(preview?: any): string {
  const back = `<div class="reader__bar"><button type="button" class="back hit" data-action="close-people-management">${icon("back")}<span>인물</span></button></div>`;
  if (!preview) return `<article class="reader">${back}${empty("불러오는 중", "삭제할 기록을 세고 있습니다.")}</article>`;
  const impact = Object.entries(preview.impact ?? {}).filter(([, value]) => Number(value) > 0);
  const counts = impact.length ? `<dl class="kv delete-impact">${impact.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${Number(value).toLocaleString()}</dd>`).join("")}</dl>` : "";
  return `<article class="reader world-confirm" role="alert">${back}<h2 class="reader__title">인물 삭제</h2><div class="world-confirm__card"><p class="world-confirm__who world-confirm__person">${avatar(String(preview.entity?.name ?? ""), "sm")}${nameHtml(String(preview.entity?.name ?? ""))}</p>${counts}</div>${notice("이 인물과 인물에 대한 관계·인식·상태·약속 기록을 지웁니다. 장면은 남고, 등장 인물 목록에서만 빠집니다. 되돌릴 수 없습니다.", { tone: "cut" })}<div class="form__bar">${btn("취소", { kind: "quiet", action: "close-people-management" })}${btn("인물 삭제", { kind: "danger-solid", icon: "delete", action: "confirm-entity-delete", data: { id: String(preview.entity?.id ?? ""), revision: String(preview.revision ?? "") }, disabled: Boolean(preview.busy) })}</div></article>`;
}

function entityMergePanel(data: DashboardData, mergePreview?: any): string {
  const people = data.entities.filter((entity: any) => ["person", "character"].includes(entity.type));
  const back = `<div class="reader__bar"><button type="button" class="back hit" data-action="close-people-management">${icon("back")}<span>인물</span></button><div class="reader__acts">${iconBtn("close", "닫기", { action: "close-people-management" })}</div></div>`;
  if (people.length < 2) return `<article class="reader">${back}${empty("합칠 수 있는 인물이 없습니다", "인물이 두 명 이상일 때 중복을 합칠 수 있습니다.")}</article>`;
  const options = (selected?: string, excluded?: string) => `<option value="">인물을 선택하세요</option>${people
    .filter((entity: any) => String(entity.id) !== excluded)
    .sort((left: any, right: any) => entityProminence(left) - entityProminence(right) || compareUiText([left.name, right.name]))
    .map((entity: any) => `<option value="${escapeHtml(entity.id)}" ${String(entity.id) === selected ? "selected" : ""}>${escapeHtml(entity.displayName || entity.name)}</option>`).join("")}`;
  const preview = mergePreview ? `<div class="merge-preview"><p><b>${escapeHtml(mergePreview.source.name)}</b>의 연결 기록을 <b>${escapeHtml(mergePreview.target.name)}</b>(으)로 합칩니다. ${escapeHtml(mergePreview.source.name)} 항목은 목록에서 사라집니다.</p>${mergePreview.impact ? `<dl class="kv">${Object.entries(mergePreview.impact).slice(0, 4).map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${Number(value)}</dd>`).join("")}</dl>` : ""}<div class="form__bar">${btn("미리보기 닫기", { kind: "quiet", action: "cancel-entity-merge" })}${btn("인물 합치기", { kind: "danger-solid", action: "merge-entities-final", data: { sourceId: String(mergePreview.source.id), targetId: String(mergePreview.target.id), revision: String(mergePreview.revision) }, disabled: Boolean(mergePreview.busy) })}</div></div>` : "";
  return `<article class="reader">${back}<h2 class="reader__title">중복 인물 합치기</h2><form id="entity-merge-form" class="form"><div class="form__row">${field({ id: "merge-source", label: "합칠 인물", control: `<select id="merge-source" class="select" name="sourceId">${options(mergePreview?.source.id, mergePreview?.target.id)}</select>` })}${field({ id: "merge-target", label: "남길 인물", control: `<select id="merge-target" class="select" name="targetId">${options(mergePreview?.target.id, mergePreview?.source.id)}</select>` })}</div><div>${btn("병합 내용 확인", { kind: "secondary", action: "preview-entity-merge" })}</div></form>${preview}</article>`;
}

const autoLockCheckbox = (locked = false): string => `<label class="check"><input name="locked" type="checkbox"${locked ? " checked" : ""}><span>자동 변경 막기</span></label>`;

function socialEditorForm(editor: SocialEditor): string {
  const original = editor.editing ? `data-original-holder="${escapeHtml(editor.holder)}" data-original-subject="${escapeHtml(editor.subject)}"` : "";
  return `<form id="social-form" class="form" ${original}><div class="form__row">${field({ id: "social-holder", label: "알고 있는 사람", control: `<input id="social-holder" class="input" name="holder" value="${escapeHtml(editor.holder)}" required>` })}${field({ id: "social-subject", label: "대상 인물", control: `<input id="social-subject" class="input" name="subject" value="${escapeHtml(editor.subject)}" required>` })}</div>${field({ id: "social-level", label: "상태", control: `<select id="social-level" class="select" name="level"><option value="aware_of" ${editor.level === "aware_of" ? "selected" : ""}>존재를 알고 있음</option><option value="interacted" ${editor.level === "interacted" ? "selected" : ""}>직접 교류한 기록 있음</option></select>` })}${field({ id: "social-known-as", label: "알고 있는 이름·직함", control: `<input id="social-known-as" class="input" name="knownAs" value="${escapeHtml(editor.knownAs)}" placeholder="쉼표로 구분">` })}${field({ id: "social-address-terms", label: "부르는 이름", control: `<input id="social-address-terms" class="input notranslate" translate="no" name="addressTerms" value="${escapeHtml(editor.addressTerms ?? "")}" placeholder="쉼표로 구분">` })}${field({ id: "social-description", label: "기록", control: `<textarea id="social-description" class="textarea" name="description">${escapeHtml(editor.description ?? "")}</textarea>` })}${autoLockCheckbox(editor.locked)}<div class="form__bar">${btn("저장", { kind: "primary", action: "submit-form" })}${btn("취소", { kind: "quiet", action: "cancel-social" })}</div></form>`;
}

export function initialCalibrationPage(data: DashboardData, view: PeopleViewState, translations: TranslationView = new Map(), display: RuntimeState["settings"]["translationDisplay"] = "en", mergePreview?: any, socialEditor?: SocialEditor, deletePreview?: any): string {
  const calibration = data.initialCalibration ?? { status: "unseeded", entities: [], relationships: [], locked: false };
  const calibrationById = new Map((calibration.entities ?? []).map((item: any) => [String(item.id), item]));
  const calibrationByName = new Map((calibration.entities ?? []).flatMap((item: any) => [item.internalName, item.displayName]
    .filter(Boolean).map((value) => [String(value).normalize("NFKC").trim().toLocaleLowerCase(), item])));
  const seen = new Set<string>();
  const people = [...data.entities.map((entity: any) => {
    const initial = (calibrationById.get(String(entity.id))
      ?? calibrationByName.get(String(entity.name ?? entity.displayName ?? "").normalize("NFKC").trim().toLocaleLowerCase())) as any;
    if (initial) seen.add(String(initial.id));
    return {
      ...entity, ...initial,
      displayName: initial?.displayName || entity.displayName || entity.name,
      internalName: initial?.internalName || entity.name,
      aliases: initial?.aliases ?? entity.aliases ?? [],
      prominence: initial?.prominence || entity.setupProminence || entity.prominence || entity.tier || "supporting",
    };
  }), ...(calibration.entities ?? []).filter((item: any) => !seen.has(String(item.id)))];
  const query = view.query.trim().toLocaleLowerCase();
  const visible = people.filter((person: any) => {
    const prominence = PERSON_PROMINENCE_OPTIONS[entityProminence(person)]!.value;
    if (view.prominence !== "all" && prominence !== view.prominence) return false;
    return true;
  }).sort((left: any, right: any) => entityProminence(left) - entityProminence(right) || compareUiText([left.displayName, right.displayName]));
  const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
  // The persona leads as a pinned contact and opens when nothing is chosen.
  const personaKey = normalize(data.personaEntity ?? "");
  const me = personaKey ? people.find((person: any) => [person.displayName, person.internalName, person.name].some((value) => normalize(value) === personaKey)) : undefined;
  const selected = view.selectedId === "__new__" ? { id: "__new__", displayName: "", internalName: "", aliases: [], prominence: "supporting" }
    : view.selectedId ? people.find((person: any) => String(person.id) === view.selectedId) : me;
  const namesFor = (person: any) => new Set([person.displayName, person.internalName, person.name, ...(person.aliases ?? [])].map(normalize).filter(Boolean));
  const personPairs = buildPairs(data, data.personaEntity);
  const relationCount = (person: any) => {
    const names = namesFor(person);
    return personPairs.filter((pair) => names.has(normalize(pair.a)) || names.has(normalize(pair.b))).length;
  };
  const statusControls = calibration.status === "awaiting_confirmation"
    ? `${btn("기억 생성 시작", { kind: "primary", action: "initial-confirm" })}${btn("다시 분석", { kind: "quiet", action: "initial-retry" })}${btn("건너뛰기", { kind: "quiet", action: "initial-skip" })}`
    : calibration.status === "failed" ? `${btn("다시 분석", { kind: "primary", action: "initial-retry" })}${btn("건너뛰기", { kind: "quiet", action: "initial-skip" })}` : "";
  const setupNotice = calibration.status === "awaiting_setup" ? notice("다음 모델 요청에서 인물 설정을 가져옵니다.")
    : calibration.status === "queued" ? notice("초기 인물을 정리하고 있습니다.")
      : calibration.status === "awaiting_confirmation" ? notice("인물과 초기 관계를 확인해 주세요.", { action: `<span class="notice__acts">${statusControls}</span>` })
        : calibration.status === "failed" ? notice(`초기 인물을 정리하지 못했습니다. ${calibration.lastError ?? "잠시 후 다시 시도해 주세요."}`, { tone: "cut", action: `<span class="notice__acts">${statusControls}</span>` }) : "";
  const setupHolders = new Map<string, any[]>();
  for (const item of calibration.status === "awaiting_confirmation" ? calibration.socialKnowledge ?? [] : []) {
    const holder = String(item?.holder ?? "");
    setupHolders.set(holder, [...(setupHolders.get(holder) ?? []), item]);
  }
  const setupReview = setupHolders.size
    ? `<section class="setup-review" aria-label="시작 시점 설정표"><h2 class="sec">시작 시점 설정표 <span class="n">${calibration.socialKnowledge.length}</span></h2><p class="sub">대화가 시작될 때 각 인물이 상대를 어떻게 알고 있는지입니다. 확정한 뒤 인물 시트의 아는 사이에서 고칠 수 있습니다.</p><table class="table"><thead><tr><th scope="col">인물</th><th scope="col">아는 인물</th><th scope="col">수준</th><th scope="col">설명</th></tr></thead>${[...setupHolders.entries()].map(([holder, items]) => `<tbody>${items.map((item: any, index: number) => `<tr>${index === 0 ? `<th scope="rowgroup" rowspan="${items.length}">${nameHtml(holder)}</th>` : ""}<td data-label="아는 인물">${nameHtml(String(item.subject ?? ""))}</td><td data-label="수준">${item.level === "interacted" ? "직접 교류" : "존재만 앎"}</td><td data-label="설명">${displayText(String(item.description ?? ""), translations.get(`initial-social:${item.holder}|${item.subject}`), display)}</td></tr>`).join("")}</tbody>`).join("")}</table></section>` : "";
  const personRow = (person: any) => {
    const names = namesFor(person);
    const count = relationCount(person);
    const scenes = storyScenes(data.memories ?? []).filter((memory: any) => memory.active !== false && (memory.participants ?? []).some((name: string) => names.has(normalize(name)))).length;
    return contactRow({ names: [String(person.displayName ?? "")], titleHtml: nameHtml(String(person.displayName ?? "")),
      secondary: `관계 ${count} · ${scenes}장면`, action: "select-person", kind: "person",
      data: { id: String(person.id), search: [...names].join(" ") }, current: String(person.id) === String(selected?.id ?? "") });
  };
  const myCard = me ? `<section class="contact-group mecard" data-people-group><h3 class="sec">내 카드</h3><div class="list">${personRow(me)}</div></section>` : "";
  const groupHtml = myCard + PERSON_PROMINENCE_OPTIONS.map(({ value: key, label }, order) => {
    const items = visible.filter((person: any) => person !== me && entityProminence(person) === order);
    if (!items.length) return "";
    const rows = items.map(personRow);
    return `<details class="fold fold--section people-group" data-people-group data-preserve-open="people-group:${key}" open>${renderFoldSummary(label, items.length)}<div class="fold__body list">${rows.slice(0, 4).join("")}${rows.length > 4 ? fold("더 보기", rows.slice(4).join(""), { role: "more", count: rows.length - 4, preserveKey: `people-more:${key}`, open: Boolean(query) }) : ""}</div></details>`;
  }).join("");
  const editor = selected && view.editing ? (() => {
    const isNew = selected.id === "__new__";
    const prominenceSeg = `<div class="seg" role="radiogroup" aria-label="중요도">${PERSON_PROMINENCE_OPTIONS.map(({ value, label }, order) => `<label><input type="radio" name="prominence" value="${value}"${entityProminence(selected) === order ? " checked" : ""}><span>${label}</span></label>`).join("")}</div>`;
    return `<article class="reader is-editing"><div class="reader__bar"><button type="button" class="back hit" data-action="close-person-editor">${icon("back")}<span>인물</span></button></div><h2 class="reader__title">${isNew ? "인물 추가" : escapeHtml(selected.displayName || "인물 수정")}</h2><form class="form person-editor" data-entity-id="${escapeHtml(selected.id)}">${field({ id: "person-displayName", label: "표시 이름", control: `<input id="person-displayName" class="input" name="displayName" value="${escapeHtml(selected.displayName)}" required>` })}${field({ id: "person-aliases", label: "별칭", control: `<input id="person-aliases" class="input notranslate" translate="no" name="aliases" value="${escapeHtml((selected.aliases ?? []).join(", "))}" placeholder="쉼표로 구분">` })}<div class="field"><span class="label">중요도</span>${prominenceSeg}</div><div class="form__bar">${isNew || calibration.locked ? "" : btn("목록에서 삭제", { kind: "danger", icon: "delete", action: "delete-initial-entity", data: { id: String(selected.id), name: String(selected.displayName ?? "") } })}<span class="sp"></span>${btn("취소", { kind: "quiet", action: "close-person-editor" })}${btn("저장", { kind: "primary", icon: "save", action: isNew ? "add-initial-entity" : "save-initial-entity", data: { id: String(selected.id) } })}</div></form></article>`;
  })() : "";
  const reader = selected && !view.editing ? renderPersonDetail(
    buildPersonDetail({ ...data, entities: people }, String(selected.displayName || selected.internalName || selected.name || ""), data.personaEntity ?? null),
    {
      translations,
      display,
      personaOverride: data.viewPreferences?.personaEntity ?? null,
      socialEditor,
      socialBackfillBusy: Number(data.socialKnowledgeJobs?.queued ?? 0) + Number(data.socialKnowledgeJobs?.leased ?? 0),
      socialKnowledgeAvailable: data.health?.capabilities?.socialKnowledge === true,
      sceneAt: sceneLocator(data.memories ?? [], (time) => formatStoryTime(time, true)),
    },
  ) : "";
  const tools = `<div class="tl-tools"><label class="search">${icon("search")}<span class="sr-only">인물 검색</span><input class="input" type="search" data-action="people-search" value="${escapeHtml(view.query)}" placeholder="이름 또는 별칭 검색"></label>${iconBtn("add", "인물 추가", { action: "new-person" })}${menu({ label: "인물 관리 더보기", items: [
    { label: "중복 인물 합치기", icon: "people", action: "go-entity-merge" },
    ...(["ready", "inherited", "skipped"].includes(calibration.status) ? [{ label: "초기 설정 다시 읽기", icon: "refresh", action: "initial-retry" }] : []),
  ] })}</div>`;
  const filterBar = filters([{ value: "all", label: "전체" }, ...PERSON_PROMINENCE_OPTIONS].map(({ value, label }) => ({ label, pressed: view.prominence === value, action: "people-filter", data: { value } })), "중요도 필터");
  const detail = view.management === "merge" ? entityMergePanel(data, mergePreview) : view.management === "delete" ? entityDeletePanel(deletePreview) : editor || reader;
  const hasDetail = Boolean(selected || view.management);
  const list = `<div class="listcol">${tools}${filterBar}<div class="tl-rows" data-preserve-scroll="people-list">${groupHtml || empty("조건에 맞는 인물이 없습니다", "필터를 바꿔 보세요.")}<div data-people-search-empty hidden>${empty("검색 결과가 없습니다", "다른 이름이나 별칭으로 찾아보세요.")}</div></div></div>`;
  return `<div class="people${view.mobileDetail ? " is-detail" : ""}${hasDetail ? " has-detail" : ""}">${setupNotice}${setupReview}<div class="split">${list}<div class="readercol" data-preserve-scroll="reader:people:${escapeHtml(view.selectedId)}:${escapeHtml(view.management ?? "")}">${hasDetail ? detail : empty("인물을 고르세요", "목록에서 인물을 고르면 인물 시트가 열립니다.")}</div></div></div>`;
}

type TranslationView = Map<string, string>;

type StructuredTranslationRecord = { kind: string; itemId: string; text: string };

export function relationshipSceneTranslationRecords(data: DashboardData, selectedKey: string): StructuredTranslationRecord[] {
  if (!selectedKey) return [];
  const pair = buildPairs(data, data.personaEntity ?? null).find((item) => item.key === selectedKey);
  if (!pair) return [];
  const sceneMemoryIds = new Set(buildSceneLog(data, pair, "all")
    .flatMap((day) => day.scenes.map((scene) => scene.memoryId))
    .filter(Boolean));
  const sceneRecords = data.memories.filter((memory: any) => sceneMemoryIds.has(String(memory?.id ?? ""))).flatMap((memory: any) => [
    { kind: "memory-title", itemId: `${memory.id}:title`, text: String(memory.title ?? "") },
    { kind: "memory-content", itemId: `${memory.id}:content`, text: String(memory.content ?? "") },
  ]);
  const anniversaryRecords = data.memories.flatMap((memory: any) => (memory?.landmarkKinds ?? []).flatMap((landmark: any, index: number) => {
    const participants = Array.isArray(landmark?.pair) ? landmark.pair : [];
    const label = String(landmark?.label ?? "").trim();
    if (landmark?.kind !== "anniversary_basis" || participants.length !== 2 || pairKey(String(participants[0]), String(participants[1])) !== pair.key || !label) return [];
    return [{ kind: "landmark-label", itemId: `landmark:${memory.id}#${index}:label`, text: label }];
  }));
  const promiseRecords = pairOpenPromises(data, pair)
    .map((item: any) => ({ kind: "promise", itemId: `promise:${item.id ?? item.promise_key ?? ""}`, text: String(item.content ?? "") }));
  return [...sceneRecords, ...anniversaryRecords, ...promiseRecords];
}

export function applyStructuredTranslationCompletion(
  results: Array<{ itemId: string; translated: string; error?: string }>,
  translations: TranslationView,
  context: { dashboardOpen: boolean; activeTab: Tab; formDirty: boolean; hasActiveSelection: boolean; render: () => void },
): void {
  results.forEach((result) => { if (!result.error) translations.set(result.itemId, result.translated); });
  if (!context.dashboardOpen) return;
  if (context.activeTab === "initial") {
    if (!context.formDirty) context.render();
    return;
  }
  if (["overview", "story", "world", "relationships", "reviews"].includes(context.activeTab) && !context.hasActiveSelection) context.render();
}

const compareUiText = (...values: Array<[unknown, unknown]>): number => {
  for (const [left, right] of values) {
    const compared = String(left ?? "").localeCompare(String(right ?? ""), ["ko", "en"], { sensitivity: "base", numeric: true });
    if (compared !== 0) return compared;
  }
  return 0;
};
export function sortSocialKnowledge<T extends { holder?: unknown; subject?: unknown; knownAs?: unknown[] }>(items: T[]): T[] {
  return [...items].sort((left, right) => compareUiText(
    [left.holder, right.holder],
    [left.subject, right.subject],
    [(left.knownAs ?? []).join(" "), (right.knownAs ?? []).join(" ")],
  ));
}

export function shouldDeferDashboardRefresh(forceApply: boolean, formDirty: boolean, activeTab: Tab, hasSelection: boolean): boolean {
  return !forceApply && ((formDirty && EDITABLE_DASHBOARD_TABS.includes(activeTab)) || hasSelection);
}
const relationshipFrom = (item: any): string => String(item?.from ?? item?.from_entity ?? "");
const relationshipTo = (item: any): string => String(item?.to ?? item?.to_entity ?? "");
const relationshipAxis = (item: any, axis: string): { level: string; trend: string } => item?.axes?.[axis] ?? { level: "unknown", trend: "unclear" };
const relationshipLevelKo: Record<string, string> = {
  unknown: "미관측", aversion: "혐오·회피", distrust: "불신", avoidant: "친밀 회피", none: "없음", faint: "희미함", fragile: "불안정", tentative: "조심스러움",
  growing: "커지는 중", developing: "발전 중", established: "확립됨", strong: "강함", deep: "깊음", conflicted: "상충됨", low: "낮음", moderate: "중간", high: "높음", extreme: "극심함",
};
const relationshipTrendKo: Record<string, string> = { rising: "상승", stable: "유지", falling: "하락", volatile: "요동", unclear: "불명" };
const relationshipAxisText = (item: any, axis: string): string => {
  const value = relationshipAxis(item, axis);
  return `${relationshipLevelKo[value.level] ?? value.level} · ${relationshipTrendKo[value.trend] ?? value.trend}`;
};

const memoryTypeKo: Record<string, string> = { episode: "장면", event: "사건", promise: "약속", detail: "세부", memory: "기억", belief: "인식", secret: "비밀" };

const memoryKindLabel = (memory: any): string =>
  memory.episode?.resolution === "group" ? "통합 에피소드" : memoryTypeKo[memory.type] ?? memory.type ?? "기억";

const memoryDetailKindLabels: Record<string, string> = {
  causal_beat: "인과적 전개", concrete_detail: "구체적 세부", spatial_detail: "공간 세부", object_state: "사물 상태",
  character_state: "인물 상태", clue: "단서", attempt_outcome: "시도 결과", open_thread: "열린 흐름", other: "기타",
};
const memoryDetailKindLabel = (value: unknown): string => memoryDetailKindLabels[String(value ?? "").trim()] ?? "기타";
const sourceLifecycleLabels: Record<string, string> = {
  pending: "처리 중", superseded: "수정됨", client_pruned: "삭제됨", branch_truncated: "삭제됨", deleted: "삭제됨", hard_deleted: "삭제됨",
};
const sourceLifecycleLabel = (value: unknown): string => sourceLifecycleLabels[String(value ?? "").trim()] ?? "상태 확인 필요";

/** Slug for a timeline row or reader: scenes get `S#n. 장소 / 낮`, other memories their kind. */
function memorySlug(memory: any, numbers: Map<string, number>): string {
  const number = numbers.get(String(memory.id));
  if (number) return slugline(number, memoryPlace(memory), memory.story_time ?? memory.storyTime ?? null);
  return memoryKindLabel(memory);
}

/** Day group of a memory: the full calendar date is the key (years never merge), MM.DD is the label. */
const memoryDay = (memory: any): { key: string; label: string } => {
  const time = memory.story_time ?? memory.storyTime ?? null;
  const parsed = parseStoryTime(time);
  const key = parsed.normalized?.split(" ")[0]
    ?? (parsed.month !== undefined && parsed.day !== undefined ? `${parsed.calendarKey}:${parsed.year ?? ""}:${parsed.month}:${parsed.day}` : undefined);
  return time ? { key: key ?? `raw:${time}`, label: formatStoryTime(time, true) } : { key: "undated", label: "시간 미상" };
};

function memorySignals(memory: any): string {
  const signal = (on: boolean, name: string, label: string) => on ? `<span class="signal" role="img" aria-label="${label}" title="${label}">${icon(name)}</span>` : "";
  const html = `${signal(Boolean(memory.bookmarked), "bookmark", "북마크")}${signal(Boolean(memory.landmark), "landmark", "랜드마크")}${signal(Boolean(memory.pinned), "pin", "검색 우선 고정")}${signal(memory.active === false, "inactive", "비활성")}`;
  return html ? `<span class="row__signals">${html}</span>` : "";
}

const memoryDisplayTitle = (memory: any, translations: TranslationView, display: TranslationDisplay): string =>
  displayText(String(memory.title ?? ""), translations.get(`${memory.id}:title`), display);

function memoryRow(memory: any, selectedId: string, translations: TranslationView, translationEnabled: boolean, numbers: Map<string, number>): string {
  const display: TranslationDisplay = translationEnabled ? "ko" : "en";
  const title = memoryDisplayTitle(memory, translations, display);
  const content = displayText(String(memory.content ?? ""), translations.get(`${memory.id}:content`), display);
  return `<button type="button" class="row${memory.active === false ? " is-off" : ""}"${memory.id === selectedId ? ' aria-current="true"' : ""} data-action="select-memory" data-translate-memory="${escapeHtml(memory.id)}" data-id="${escapeHtml(memory.id)}" data-day="${escapeHtml(memoryDay(memory).key)}" data-landmark="${memory.landmark === true}" data-bookmarked="${memory.bookmarked === true}" data-pinned="${memory.pinned === true}" data-active="${memory.active !== false}"><div class="row__slug"><b>${escapeHtml(memorySlug(memory, numbers))}</b>${memorySignals(memory)}${memory.story_time ?? memory.storyTime ? `<span class="tc">${escapeHtml(formatStoryTime(memory.story_time ?? memory.storyTime))}</span>` : ""}</div><div class="row__title">${title}</div><div class="row__sub">${content}</div></button>`;
}

function memoryActionMenu(memory: any): string {
  const id = { id: String(memory.id) };
  return menu({ label: "기억 더보기", items: [
    { label: memory.bookmarked ? "북마크 해제" : "북마크", icon: "bookmark", action: "toggle-bookmark", data: id },
    { label: memory.pinned ? "검색 우선 해제" : "검색 우선 고정", icon: "pin", action: "toggle-pin", data: id },
    { label: memory.active === false ? "다시 사용" : "비활성화", icon: "inactive", action: "toggle-memory", data: id },
    { label: "관련 원문 보기", icon: "search", action: "related-source", data: id },
    { label: "기억 삭제", icon: "delete", action: "delete-memory", data: id, danger: true },
  ] });
}

/** Presentation only: all content stays in the DOM and expands without another request. */
export function expandableLongContent(label: string, html: string, textLength: number, story = false): string {
  if (textLength <= 1600) return html;
  const disclosure = `<details${story ? "" : ' class="fold"'}><summary><span>${escapeHtml(label)}</span><span class="n">전체 보기</span></summary><div class="fold__body">${html}</div></details>`;
  return story ? `<div class="story-disclosures">${disclosure}</div>` : disclosure;
}

const EPISTEMIC_LABELS: Record<string, string> = { observed: "관찰", stated: "진술", inferred: "추론", unresolved: "미확인" };
// Only second-hand knowing is named; seeing or living it is the default reading of a name.
const ACCESS_BASIS_LABELS: Record<string, string> = { told: "전해 들음", heard: "간접 전언·소문", inferred: "추측" };

/** 모두 아는: visible to whoever recalls it, characters who appear later included. Shared by 기본 관계 and memory details. */
const everyoneCheck = (name: string, checked: boolean, label: string): string => `<label class="check"><input type="checkbox" name="${name}"${checked ? " checked" : ""}><span>${label}<small>누가 떠올려도 보여요. 나중에 등장하는 인물도 포함돼요.</small></span></label>`;

const ACCESS_BASIS_OPTIONS: Record<import("@rcm/shared").ItemAccessBasis, string> = {
  experienced: "직접 참여", witnessed: "직접 목격·청취", told: "직접 전달받음", heard: "간접 전언·소문", inferred: "추론", internal: "자신의 생각·감정",
};
function accessHolderRow(name = "", basis = "witnessed", index = 0): string {
  const id = `access-holder-${index}`;
  return `<div class="access-holder-row">${field({ id, label: "인물", control: `<input id="${id}" class="input notranslate" translate="no" name="holder" value="${escapeHtml(name)}" placeholder="인물 이름">` })}${field({ id: `${id}-basis`, label: "알게 된 경로", control: `<select id="${id}-basis" class="select" name="basis">${Object.entries(ACCESS_BASIS_OPTIONS).map(([value, label]) => `<option value="${value}"${value === basis ? " selected" : ""}>${label}</option>`).join("")}</select>` })}${btn("제외", { kind: "quiet", action: "remove-access-holder" })}</div>`;
}

/** Uses the same active grants as retrieval, for both details and dialogue. */
export function detailAccessLine(memoryId: string, detail: any, editing: boolean, kind: "detail" | "dialogue" = "detail"): string {
  const holders: Array<{ name: string; basis?: string }> = Array.isArray(detail?.access?.holders) ? detail.access.holders : [];
  if (editing) {
    return `<form id="detail-access-form" class="form detail-know-form" data-memory-id="${escapeHtml(memoryId)}" data-detail-id="${escapeHtml(String(detail.id))}" data-item-kind="${kind}"><div class="access-holder-list">${holders.map((item, index) => accessHolderRow(item.name, item.basis, index)).join("")}</div>${btn("인물 추가", { kind: "quiet", action: "add-access-holder", icon: "plus" })}<p class="sub">인물이 없으면 작가만 아는 기록이에요. 직접 들은 대사는 ‘직접 목격·청취’, 대사로 전달받은 별개의 사건은 ‘직접 전달받음’을 골라 주세요.</p>${everyoneCheck("detailAccessEveryone", detail?.access?.everyone === true, "모두 아는 기억")}<div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-detail-access" })}${btn("저장", { kind: "primary", action: "submit-form", data: { formId: "detail-access-form" } })}</div></form>`;
  }
  const names = holders.map((item) => `${escapeHtml(item.name)}${ACCESS_BASIS_LABELS[item.basis ?? ""] ? `<span class="detail-know__how">(${ACCESS_BASIS_LABELS[item.basis ?? ""]})</span>` : ""}`).join(" · ");
  const label = detail?.access?.everyone === true ? "모두" : names || "작가만";
  if (kind === "dialogue") return `<small class="lines__access notranslate" translate="no" aria-label="아는 인물">${label}</small>`;
  return `<p class="detail-know"><span class="detail-know__k">아는 인물</span><span class="detail-know__v notranslate" translate="no">${label}</span><button type="button" class="linkbtn hit" data-action="edit-detail-access" data-memory-id="${escapeHtml(memoryId)}" data-detail-id="${escapeHtml(String(detail.id))}">수정</button></p>`;
}

function memoryDetail(memory: any, messages: Map<string, any>, translations: TranslationView, view: TimelineViewState, translationEnabled: boolean, sourceLanguage: MemoryLanguage, adjacent: { previous?: any; next?: any }, numbers: Map<string, number>, translationError?: string, personaNames: Set<string> = new Set()): string {
  if (!memory) return empty("표시할 기억이 없습니다", "검색이나 필터를 바꿔 보세요.");
  const evidence = parseJson<Array<{ messageId?: string; quote?: string }>>(memory.evidence_json, []);
  const displayedDialogues = joinDialogueSpans(Array.isArray(memory.keyDialogues) ? memory.keyDialogues : []);
  const locations = Array.isArray(memory.locations) ? memory.locations : [];
  const participants: string[] = Array.isArray(memory.participants) ? memory.participants.map(String).filter(Boolean) : [];
  const landmarkKinds = Array.isArray(memory.landmarkKinds) ? memory.landmarkKinds : [];
  const display: TranslationDisplay = translationEnabled ? "ko" : "en";
  const translatedContent = translations.get(`${memory.id}:content`);
  const translationReady = translations.has(`${memory.id}:content`);
  const title = memoryDisplayTitle(memory, translations, display);
  const sections = Array.isArray(memory.sections) ? memory.sections : [];
  const details = Array.isArray(memory.details) ? memory.details : [];
  const relationshipEvents = Array.isArray(memory.relationshipEvents) ? memory.relationshipEvents : [];
  const intimacyMilestones = Array.isArray(memory.intimacyMilestones) ? memory.intimacyMilestones : [];
  const key = String(memory.id);
  const back = `<button type="button" class="back hit" data-action="timeline-back">${icon("back")}<span>목록</span></button>`;
  if (view.editing) {
    const input = (name: string, value: unknown, extra = "") => `<input id="memory-${name}" class="input" name="${name}" value="${escapeHtml(value ?? "")}"${extra}>`;
    const editor = `<form id="memory-form" class="form" data-memory-id="${escapeHtml(memory.id)}">
      ${field({ id: "memory-title", label: "제목", control: input("title", memory.title, ` lang="${sourceLanguage}"`) })}
      ${field({ id: "memory-content", label: "내용", control: `<textarea id="memory-content" class="textarea" name="content" lang="${sourceLanguage}" rows="8">${escapeHtml(memory.content)}</textarea>` })}
      <div class="form__row">${field({ id: "memory-storyTime", label: "작중 시간", control: input("storyTime", memory.story_time, ' placeholder="원문에 명시된 날짜와 시간"') })}${field({ id: "memory-locations", label: "장소", control: input("locations", locations.join(", "), ' placeholder="쉼표로 구분"') })}</div>
      ${field({ id: "memory-participants", label: "등장 인물", control: input("participants", participants.join(", "), ' placeholder="쉼표로 구분"'), hint: "이름이 잘못 들어갔다면 여기서 고칩니다." })}
      ${landmarkKindsField("memory-landmarkKinds", landmarkKinds, Boolean(memory.landmark))}
      <div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-memory-edit" })}${btn("저장", { kind: "primary", icon: "save", action: "submit-form", data: { formId: "memory-form" } })}</div>
    </form>`;
    return `<article class="reader is-editing"><div class="reader__bar">${back}</div><div class="frame__slug"><b>${escapeHtml(memorySlug(memory, numbers))}</b></div><h2 class="reader__title">${title}</h2>${editor}</article>`;
  }
  const translationState = translationEnabled && !translationReady
    ? translationError ? notice("번역을 불러오지 못했습니다.", { tone: "cut", action: btn("다시 시도", { kind: "quiet", action: "retry-translation", data: { id: key } }) }) : notice("한국어 번역을 준비하고 있습니다.")
    : "";
  const phone = lex().skin === "phone";
  const lines = displayedDialogues.length ? `<div class="lines">${displayedDialogues.map((item: any, lineIndex: number) => {
    const translated = item.sourceIndexes.map((index: number) => translations.get(`${memory.id}:dialogue:${index}`)).filter((value: string | undefined): value is string => Boolean(value)).join(" … ") || undefined;
    // The phone skin draws lines as chat bubbles: the persona's on the right.
    const side = personaNames.has(String(item.speaker ?? "").normalize("NFKC").trim().toLocaleLowerCase()) ? "out" : "in";
    // A run of lines from one speaker names them once, like a message thread.
    const continues = lineIndex > 0 && String(displayedDialogues[lineIndex - 1]?.speaker ?? "") === String(item.speaker ?? "");
    const speaker = escapeHtml(item.speaker);
    const editable = Boolean(item.id && item.access);
    const tag = editable ? "button" : "p";
    const action = editable ? ` type="button" data-action="edit-detail-access" data-memory-id="${escapeHtml(memory.id)}" data-detail-id="${escapeHtml(String(item.id))}" title="아는 인물과 인지 경로 수정" aria-expanded="${view.accessEditing === item.id}"` : "";
    return `${phone && !continues && side === "in" ? `<small class="lines__speaker">${speaker}</small>` : ""}<div class="lines__row" data-side="${side}"><${tag} class="subtitle" data-side="${side}"${continues ? " data-cont" : ""}${action}><span>${displayText(item.text, translated, display)}</span>${phone ? "" : `<small>${speaker}</small>`}</${tag}>${editable ? detailAccessLine(memory.id, item, false, "dialogue") : ""}</div>${editable && view.accessEditing === item.id ? detailAccessLine(memory.id, item, true, "dialogue") : ""}`;
  }).join("")}</div>` : "";
  const record = `<div class="rec" lang="${display === "ko" ? "ko" : sourceLanguage}">${displayText(String(memory.content ?? ""), translatedContent, display)}</div>`;
  const labelledBlock = (label: string, count: number, body: string) => `<section class="memory-block"><h3 class="sec">${escapeHtml(label)} <span class="n">${count}</span></h3>${body}</section>`;
  const detailRow = (label: string, textHtml: string, body: string, preserveKey: string, core = false) => `<details class="memory-detail-row" data-preserve-open="${escapeHtml(preserveKey)}"><summary><span class="memory-detail-row__preview">${label ? `<span class="tag${core ? " is-core" : ""}">${escapeHtml(label)}</span>` : ""}${textHtml}</span><span class="chev" aria-hidden="true">${icon("chevron")}</span></summary><div class="memory-detail-row__body">${body}</div></details>`;
  const previewText = (text: unknown, translated?: string) => displayText(String(text ?? "").split(/\r?\n/)[0] ?? "", translated?.split(/\r?\n/)[0], display);
  // On the phone the row header already reads the first line, and opens to its full length; the body carries only the rest.
  const bodyText = (text: unknown, translated?: string): string => {
    if (!phone) return `<p>${displayText(String(text ?? ""), translated, display)}</p>`;
    const rest = (value: string) => value.split(/\r?\n/).slice(1).join("\n").trim();
    // Split the text the header actually shows: the translation when one is displayed, otherwise the source.
    const shownTranslation = display !== "en" && translated ? translated : "";
    const remainder = rest(shownTranslation || String(text ?? ""));
    if (!remainder) return "";
    return `<p>${shownTranslation ? displayText(remainder, remainder, display) : displayText(remainder, undefined, display)}</p>`;
  };
  const detailQuotes = (item: any) => {
    const sources = Array.isArray(item.evidence) ? item.evidence : [];
    return sources.filter((source: any) => source.quote).map((source: any) => `<blockquote class="quote">${escapeHtml(source.quote)}</blockquote>`).join("");
  };
  const kv = (rows: Array<[string, string]>) => `<dl class="kv">${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
  const sectionRows = sections.map((section: any) => {
    const title = String(section.title ?? ""), count = section.sourceMessageIds?.length ?? 0;
    const body = `<p class="sub">${escapeHtml(section.summary)}</p>`;
    const preserveKey = `memory-section:${key}:${section.id ?? section.title ?? ""}`;
    return phone ? detailRow("", `<b>${escapeHtml(title)}</b> <span class="n">${count}</span>`, body, preserveKey) : fold(title, body, { count, preserveKey });
  });
  const moreSections = phone && sectionRows.length > 3 ? fold("더 보기", sectionRows.slice(3).join(""), { role: "more", count: sectionRows.length - 3, preserveKey: `memory-sections:${key}` }) : "";
  const structure = !sectionRows.length ? "" : phone
    ? labelledBlock("장면 구성", sectionRows.length, `<div class="memory-card">${sectionRows.slice(0, 3).join("")}${moreSections}</div>`)
    : fold("장면 구성", sectionRows.join(""), { role: "section", count: sections.length, preserveKey: `memory-sections:${key}` });
  const infoFields = kv([["분류", memoryKindLabel(memory)], ["작중 시간", formatStoryTime(memory.story_time ?? memory.storyTime) || "기록 없음"], ["장소", locations.join(" · ") || "기록 없음"], ["회상 횟수", `${Number(memory.recall_count ?? 0)}회`]]);
  const info = fold("기억 정보", infoFields, { role: "section", preserveKey: `memory-info:${key}` });
  const structuredDetails = details.map((detail: any) => {
    const translated = translations.get(`${memory.id}:detail:${detail.id}`);
    const knowing = detailAccessLine(memory.id, detail, view.accessEditing === detail.id);
    const kind = memoryDetailKindLabel(detail.kind);
    const originalKind = detail.original_kind ? ` (원래 분류: ${memoryDetailKindLabel(detail.original_kind)})` : "";
    const body = `${bodyText(detail.text, translated)}${knowing}<p class="sub">${escapeHtml(EPISTEMIC_LABELS[detail.epistemic] ?? detail.epistemic)} · 인물 ${(detail.participants ?? []).map(escapeHtml).join(" · ") || "없음"} · 장소 ${(detail.locations ?? []).map(escapeHtml).join(" · ") || "없음"}${phone && originalKind ? ` · ${escapeHtml(originalKind.trim())}` : ""}</p>`;
    const preserveKey = `memory-detail:${key}:${detail.id}`;
    return phone ? detailRow(detail.role === "core" ? "핵심 사건" : kind, previewText(detail.text, translated), body + detailQuotes(detail), preserveKey, detail.role === "core")
      : fold(`${kind}${originalKind}${detail.role === "core" ? " · 핵심 사건" : ""}`, body, { preserveKey });
  });
  const relationshipDetails = relationshipEvents.map((event: any) => {
    const translated = translations.get(`relationship-event:${event.id}:reason`);
    const body = `${bodyText(event.reason, translated)}<p class="sub">${phone ? `${escapeHtml(event.from)} → ${escapeHtml(event.to)} · ` : ""}${(event.changes ?? []).map((change: any) => `${escapeHtml(change.axis)} ${escapeHtml(change.effect)} · ${escapeHtml(change.impact)}`).join(" · ")}</p>`;
    const preserveKey = `memory-event:${key}:${event.id}`;
    return phone ? detailRow("관계", previewText(event.reason, translated), body + detailQuotes(event), preserveKey) : fold(`${event.from} → ${event.to}`, body, { preserveKey });
  });
  const intimacyDetails = intimacyMilestones.map((item: any) => {
    const text = item.circumstance || "문맥 미기록";
    const translated = translations.get(`intimacy:${item.id}:circumstance`);
    const body = `<p>${displayText(text, translated, display)}</p><p class="sub">${escapeHtml(phone ? milestoneLabel(item) : item.act)} · ${escapeHtml(item.participantA)} · ${escapeHtml(item.participantB)} · ${escapeHtml(item.interactionContext)}</p>`;
    const preserveKey = `memory-intimacy:${key}:${item.id}`;
    return phone ? detailRow("스킨십", previewText(text, translated), body + detailQuotes(item), preserveKey) : fold(milestoneLabel(item), body, { preserveKey });
  });
  const detailRows = [...structuredDetails, ...relationshipDetails, ...intimacyDetails];
  const moreDetails = phone && detailRows.length > 3 ? fold("더 보기", detailRows.slice(3).join(""), { role: "more", count: detailRows.length - 3, preserveKey: `memory-details:${key}` }) : "";
  const detailsFold = !detailRows.length ? "" : phone
    ? labelledBlock("세부 기억", detailRows.length, `<div class="memory-card">${detailRows.slice(0, 3).join("")}${moreDetails}</div>`)
    : fold("세부기억과 관계 사건", detailRows.join(""), { role: "section", preserveKey: `memory-details:${key}` });
  const evidenceRows = evidence.map((item, index) => {
    const source = item.messageId ? messages.get(item.messageId) : undefined;
    const quote = String(item.quote ?? source?.content ?? "원문 근거를 표시할 수 없습니다.");
    const preview = quote.replace(/\s+/g, " ").trim();
    const titleQuote = preview.length > 60 ? `${preview.slice(0, 60)}…` : preview;
    const title = [String(source?.speaker ?? "").trim(), titleQuote].filter(Boolean).join(" · ") || "원문 근거";
    const lifecycle = String(source?.lifecycle ?? "").trim();
    const lifecycleText = lifecycle && lifecycle !== "committed" ? ` · ${sourceLifecycleLabel(lifecycle)}` : "";
    const body = `<blockquote class="quote">${displayText(quote, translations.get(`${memory.id}:evidence:${index}`), display)}</blockquote>`;
    const preserveKey = `memory-evidence:${key}:${index}`;
    return phone ? detailRow("", escapeHtml(`${title}${lifecycleText}`), body, preserveKey) : fold(`${title}${lifecycleText}`, body, { preserveKey });
  }).join("");
  const evidenceFold = fold("원문 근거", evidenceRows ? phone ? `<div class="memory-card">${evidenceRows}</div>` : evidenceRows : '<p class="sub">연결된 원문 근거가 없습니다.</p>', { role: "section", count: evidence.length, preserveKey: `memory-evidence:${key}` });
  const people = participants.length ? `<div class="participants">${participants.map((name) => `${avatar(name, "sm")}${nameHtml(name)}`).join('<span class="dot" aria-hidden="true">·</span>')}</div>` : "";
  const landmarkMarks = landmarkKinds.length ? `<div class="marks">${landmarkKinds.map((entry: any) => `<span class="mark is-key">${icon("landmark")}${escapeHtml(landmarkLabel(entry))}</span>`).join("")}</div>` : "";
  const pager = `<nav class="pager" aria-label="기억 이동">${btn("이전", { kind: "quiet", icon: "back", action: "timeline-adjacent", data: { id: adjacent.previous?.id ?? "" }, disabled: !adjacent.previous, hit: true })}${btn("다음", { kind: "quiet", iconEnd: "chevron", action: "timeline-adjacent", data: { id: adjacent.next?.id ?? "" }, disabled: !adjacent.next, hit: true })}</nav>`;
  const actions = `<div class="reader__acts">${iconBtn("edit", "기억 수정", { action: "edit-memory" })}${memoryActionMenu(memory)}</div>`;
  const content = phone
    ? `<div data-preserve-scroll="timeline-detail">${record}${lines ? labelledBlock("주요 대사", displayedDialogues.length, lines) : ""}${detailsFold}${structure}${evidenceFold}${info}</div>`
    : `${lines}<div data-preserve-scroll="timeline-detail">${expandableLongContent("기억 본문", record, Math.max(String(memory.content ?? "").length, String(translatedContent ?? "").length))}${info}${structure}${detailsFold}${evidenceFold}</div>`;
  return `<article class="reader"><div class="reader__bar">${back}${actions}</div><div class="frame__slug"><b>${escapeHtml(memorySlug(memory, numbers))}</b>${memorySignals(memory)}${memory.story_time ?? memory.storyTime ? `<span class="tc">${escapeHtml(formatStoryTime(memory.story_time ?? memory.storyTime))}</span>` : ""}</div><h2 class="reader__title">${title}</h2>${people}${landmarkMarks}${memory.active === false ? notice("현재 검색과 자동 주입에서 제외된 기억입니다.") : ""}${translationState}${content}${pager}</article>`;
}

/** Labels for picking a landmark kind; 기념일 기준 is set from a pair's scene log, so it is kept but never offered here. */
const LANDMARK_PICK_LABELS: Record<string, string> = {
  confession: "고백", first_met: "첫 만남", romantic_relationship_established: "연인이 됨", engagement: "약혼", marriage: "결혼",
  separation: "별거", romantic_relationship_ended: "이별", reunion: "재결합", divorce: "이혼", relationship_change: "관계 변화",
  betrayal: "배신", death: "죽음", identity_reveal: "정체 공개", status_change: "상태 변화", boundary_change: "경계 변화",
  intimacy_milestone: "스킨십 이정표", other: "기타",
};

/**
 * Landmark chips. A built-in kind is one chip however many entries of it the memory holds; every custom (기타) name is its own
 * chip; a new custom name is typed whole. A landmark recorded without any kind shows as 전환점 so saving never clears it unasked.
 */
function landmarkKindsField(id: string, existing: any[] = [], isLandmark = false): string {
  const picked = new Set(existing.map((entry: any) => String(entry?.kind ?? "")));
  const chip = (name: string, value: string, label: string, checked: boolean) => `<label class="kindpick__chip"><input type="checkbox" name="${name}" value="${escapeHtml(value)}"${checked ? " checked" : ""}><span>${escapeHtml(label)}</span></label>`;
  const builtIn = Object.entries(LANDMARK_PICK_LABELS).filter(([kind]) => kind !== "other").map(([kind, label]) => chip("landmarkKind", kind, label, picked.has(kind))).join("");
  const custom = existing.map((entry: any, index: number) => entry?.kind === "other" && entry?.label ? chip("landmarkKeep", String(index), String(entry.label), true) : "").join("");
  const plain = isLandmark && !existing.some((entry: any) => entry?.kind !== "anniversary_basis") ? chip("landmarkPlain", "1", "전환점", true) : "";
  const addOther = chip("landmarkKind", "other", "기타 추가", false);
  const other = `<div class="kindpick__other" data-landmark-other hidden>${field({ id: `${id}-other`, label: "기타 이름", control: `<input id="${id}-other" class="input" name="landmarkOther" maxlength="120" placeholder="예: 첫 키스">` })}</div>`;
  return `<fieldset class="kindpick" id="${id}"><legend class="label">랜드마크</legend><p class="hint">이 장면이 이야기의 전환점이면 골라 주세요. 고르지 않으면 일반 장면입니다.</p><div class="kindpick__chips">${plain}${builtIn}${custom}${addOther}</div>${other}</fieldset>`;
}

/**
 * The landmark entries the form now asks for, built from the memory's own entries: kept kinds keep every entry and its metadata,
 * cleared kinds drop theirs, a newly picked kind is made like the text editor made it, and 기념일 기준 always rides along.
 */
export function landmarksFromForm(form: HTMLFormElement, existing: LandmarkKind[], participants: string[], storyTime: string): { kinds: LandmarkKind[]; landmark: boolean } {
  const checked = (name: string) => new Set(Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)).map((input) => input.value));
  const kinds = checked("landmarkKind");
  const keep = checked("landmarkKeep");
  const kept = existing.filter((entry, index) => entry.kind === "anniversary_basis" || (entry.kind === "other" ? keep.has(String(index)) : kinds.has(entry.kind)));
  const added = [...kinds].filter((kind) => kind !== "other" && !existing.some((entry) => entry.kind === kind))
    .flatMap((kind) => editableLandmarkKinds(kind, [], participants, storyTime));
  const label = kinds.has("other") ? String((form.elements.namedItem("landmarkOther") as HTMLInputElement | null)?.value ?? "").trim() : "";
  const next = [...kept, ...added, ...(label ? [{ kind: "other" as const, label }] : [])];
  const parsed = LandmarkKindSchema.array().max(12).safeParse(next);
  if (!parsed.success) throw new Error("랜드마크는 12개까지 고를 수 있어요.");
  return { kinds: parsed.data, landmark: checked("landmarkPlain").size > 0 || parsed.data.some((entry) => entry.kind !== "anniversary_basis") };
}

function manualMemoryEditor(): string {
  const back = `<button type="button" class="back hit" data-action="cancel-manual-memory">${icon("back")}<span>목록</span></button>`;
  return `<article class="reader is-editing"><div class="reader__bar">${back}</div><h2 class="reader__title">타임라인 기억 추가</h2><form id="manual-memory-form" class="form">
    ${field({ id: "manual-title", label: "제목 (선택)", control: '<input id="manual-title" class="input" name="title" maxlength="500" placeholder="비워두면 기억 내용에서 만듭니다">' })}
    ${field({ id: "manual-content", label: "기억 내용", control: '<textarea id="manual-content" class="textarea" name="content" rows="8" maxlength="20000" required></textarea>' })}
    <div class="form__row">${field({ id: "manual-storyTime", label: "작중 시간", control: '<input id="manual-storyTime" class="input" name="storyTime" maxlength="240" placeholder="YYYY-MM-DD HH:mm 권장">' })}${field({ id: "manual-locations", label: "장소", control: '<input id="manual-locations" class="input" name="locations" placeholder="쉼표로 구분">' })}</div>
    ${field({ id: "manual-participants", label: "등장 인물", control: '<input id="manual-participants" class="input" name="participants" placeholder="쉼표로 구분">' })}
    ${landmarkKindsField("manual-landmarkKinds")}
    <div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-manual-memory" })}${btn("저장", { kind: "primary", icon: "save", action: "submit-form", data: { formId: "manual-memory-form" } })}</div>
  </form></article>`;
}

/** The persona's name and aliases, normalised, for matching dialogue speakers. Empty when no persona is resolved. */
function personaNameSet(data: DashboardData): Set<string> {
  const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
  const persona = normalize(data.personaEntity);
  if (!persona) return new Set();
  const entity = (data.entities ?? []).find((item: any) => [item?.name, item?.displayName].some((value) => normalize(value) === persona));
  return new Set([persona, ...((entity?.aliases ?? []) as unknown[]).map(normalize)].filter(Boolean));
}

export function timeline(data: DashboardData, selectedId: string, translations: TranslationView, view: TimelineViewState, translationEnabled: boolean, sourceLanguage: MemoryLanguage, translationError?: string): string {
  const messages = new Map(data.messages.map((message) => [message.message_id, message]));
  const numbers = sceneNumbers(data.memories);
  const { matching, topLevel } = timelineMemoryView(data.memories, view);
  const selectedBase = [...matching, ...topLevel].find((memory) => memory.id === selectedId) ?? topLevel[0];
  const selectedDetailIds = new Set((selectedBase?.details ?? []).map((detail: any) => detail.id));
  const selected = selectedBase ? { ...selectedBase,
    relationshipEvents: data.relationshipEvents.filter((event) => event.sourceMemoryId === selectedBase.id || selectedDetailIds.has(event.sourceDetailId)),
    intimacyMilestones: data.physicalIntimacy.filter((item) => item.sourceMemoryId === selectedBase.id),
  } : undefined;
  const storyOrdered = [...topLevel].sort(compareStoryMemories);
  const selectedIndex = storyOrdered.findIndex((memory) => memory.id === selectedBase?.id);
  const adjacent = { previous: selectedIndex > 0 ? storyOrdered[selectedIndex - 1] : undefined, next: selectedIndex >= 0 ? storyOrdered[selectedIndex + 1] : undefined };
  let lastDay = "";
  const rows = topLevel.map((memory) => {
    const day = memoryDay(memory);
    const header = day.key === lastDay ? "" : `<div class="day" data-day-header="${escapeHtml(day.key)}"><b>${escapeHtml(day.label)}</b></div>`;
    lastDay = day.key;
    const children = matching.filter((candidate) => candidate.capsule_parent_id === memory.id);
    const capsule = children.length ? `<details class="capsule-children fold"${children.some((child) => child.id === selected?.id) ? " open" : ""}><summary><span>원래 기억</span><span class="n">${children.length}</span></summary><div class="fold__body">${children.map((child) => memoryRow(child, selected?.id ?? "", translations, translationEnabled, numbers)).join("")}</div></details>` : "";
    return `${header}${memoryRow(memory, selected?.id ?? "", translations, translationEnabled, numbers)}${capsule}`;
  }).join("");
  const filterItems = [
    { label: "북마크", icon: "bookmark", pressed: view.bookmarkedOnly, action: "timeline-filter", data: { filter: "bookmark" } },
    { label: "랜드마크", icon: "landmark", pressed: view.landmarkOnly, action: "timeline-filter", data: { filter: "landmark" } },
    { label: "검색 우선", icon: "pin", pressed: view.pinnedOnly, action: "timeline-filter", data: { filter: "pinned" } },
    { label: "비활성 포함", icon: "inactive", pressed: view.includeInactive, action: "timeline-filter", data: { filter: "inactive" } },
  ];
  const filterBar = filters(filterItems.map(({ icon: _icon, ...item }) => item), "기억 필터");
  // The phone skin keeps the header to search, add and one menu; the filters live in that menu (a check marks the active ones).
  const menuFilters = lex().skin === "phone" ? [...filterItems.map((item) => ({ label: item.label, icon: item.pressed ? "check" : item.icon, action: item.action, data: item.data })), "sep" as const] : [];
  const tools = `<div class="tl-tools"><label class="search">${icon("search")}<span class="sr-only">기억 검색</span><input id="memory-search" class="input" type="search" value="${escapeHtml(view.query)}" placeholder="기억 검색"></label>${iconBtn("add", "기억 추가", { action: "new-manual-memory" })}${menu({ label: "타임라인 더보기", items: [
    ...menuFilters,
    { label: view.sortOrder !== "ascending" ? "오래된 순으로 보기" : "최근 순으로 보기", icon: view.sortOrder !== "ascending" ? "up" : "down", action: "timeline-order" },
    { label: "기억 정리", icon: "sliders", action: "organization-open" },
  ] })}</div>`;
  const list = `<div class="listcol">${tools}${filterBar}<p class="sub" data-timeline-count>기억 ${topLevel.length}개 · ${view.sortOrder !== "ascending" ? "최근 순" : "오래된 순"}</p><div class="list tl-rows" id="memory-rows" data-preserve-scroll="timeline-list">${rows || empty("조건에 맞는 기억이 없습니다", "검색어나 필터를 바꿔 보세요.")}<div data-timeline-search-empty hidden>${empty("검색 결과가 없습니다", "다른 단어로 찾아보세요.")}</div></div></div>`;
  const filteredListEmpty = data.memories.length > 0 && topLevel.length === 0;
  const reader = view.creating
    ? manualMemoryEditor()
    : filteredListEmpty
      ? empty("선택된 기억이 없습니다", "목록에서 기억을 고르거나 필터를 바꿔 보세요.")
    : selected
      ? memoryDetail(selected, messages, translations, view, translationEnabled, sourceLanguage, adjacent, numbers, translationError, personaNameSet(data))
      : empty("아직 기억이 없습니다", "대화가 쌓이면 장면이 여기에 정리됩니다.");
  return `<div class="timeline${view.mobileDetail ? " is-detail" : ""}"><div class="split">${list}<div class="readercol" data-preserve-scroll="reader:timeline:${escapeHtml(view.creating ? "new" : selected?.id ?? "")}"><div data-timeline-reader-empty style="display:none">${empty("선택된 기억이 없습니다", "목록에서 기억을 고르거나 필터를 바꿔 보세요.")}</div>${reader}</div></div></div>`;
}

const storyGroupKey = (group: any, fallback: string): string => String(group?.groupId ?? `${group?.level ?? "story"}:${group?.startOrdinal ?? fallback}:${group?.endOrdinal ?? fallback}`);
const storyTranslationKey = (groupKey: string, field: string, index?: number): string => `story:${groupKey}:${field}${index == null ? "" : `:${index}`}`;

const storyStartOrder = (left: any, right: any): number => {
  const ordinal = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : Number.MAX_SAFE_INTEGER;
  return ordinal(left?.startOrdinal) - ordinal(right?.startOrdinal) || ordinal(left?.endOrdinal) - ordinal(right?.endOrdinal);
};

/** Only segments are acts. Number them once across the story, before grouping into parts. */
function storyGroups(spine: any): Array<{ group: any; key: string; partKey: string | null; number: number }> {
  const nested = (spine?.arcs ?? []).flatMap((arc: any, arcIndex: number) => {
    const partKey = storyGroupKey(arc, `arc-${arcIndex}`);
    return (arc.segments ?? []).map((group: any, index: number) => ({ group, key: storyGroupKey(group, `${partKey}:segment-${index}`), partKey }));
  });
  const current = (spine?.currentProgress ?? []).map((group: any, index: number) => ({ group, key: storyGroupKey(group, `current-${index}`), partKey: null }));
  return [...nested, ...current].sort((left, right) => storyStartOrder(left.group, right.group) || left.key.localeCompare(right.key))
    .map((item, index) => ({ ...item, number: index + 1 }));
}


type StorySeason = { key: string; part: any | null; acts: ReturnType<typeof storyGroups> };

/** A long story reads as a series: parts are seasons in story order, and the acts no part has taken yet form the running season after them. */
function storySeasons(spine: any): StorySeason[] {
  const groups = storyGroups(spine);
  const parts = [...(spine?.arcs ?? [])].sort(storyStartOrder).map((part) => {
    const key = storyGroupKey(part, `arc-${(spine.arcs ?? []).indexOf(part)}`);
    return { key, part, acts: groups.filter((item) => item.partKey === key) };
  });
  const running = groups.filter((item) => item.partKey === null);
  return [...parts, ...(running.length ? [{ key: "running", part: null, acts: running }] : [])];
}

/** Each act's season and its number inside that season; acts restart at 1 in every season. */
function storyActPlaces(spine: any): Map<string, { season: number; act: number }> {
  const places = new Map<string, { season: number; act: number }>();
  storySeasons(spine).forEach((season, seasonIndex) => season.acts.forEach((item, act) => places.set(item.key, { season: seasonIndex, act })));
  return places;
}

/** The season and act on screen, always a coherent pair: a chosen season shows its own act (its latest when the chosen act is elsewhere, none when it is empty); otherwise the chosen act brings its season, and the running act is the default. */
function storySelection(spine: any, view: { selectedGroupId?: string; selectedPart?: string }) {
  const seasons = storySeasons(spine);
  const requested = seasons.findIndex((item) => item.key === view.selectedPart);
  const owner = seasons.findIndex((item) => item.acts.some((act) => act.key === view.selectedGroupId));
  const seasonIndex = requested >= 0 ? requested : owner >= 0 ? owner : seasons.length - 1;
  const season = seasons[seasonIndex];
  const act = season?.acts.find((item) => item.key === view.selectedGroupId) ?? season?.acts.at(-1);
  return { seasons, seasonIndex, season, act };
}

/** Live size of the owner's overview against this chat's Story limit. Over the limit the server drops
 * whole middle paragraphs, so the warning says what is lost rather than blocking the save. */
function storyOverviewCount(text: string, limit: number): { text: string; over: boolean } {
  const tokens = estimateTokens(text);
  if (!limit) return { text: `약 ${tokens.toLocaleString()}토큰`, over: false };
  return tokens > limit
    ? { text: `약 ${tokens.toLocaleString()}토큰 · 이 채팅의 줄거리 한도(약 ${limit.toLocaleString()}토큰)를 넘어 중간 문단부터 빠지고 전달돼요.`, over: true }
    : { text: `약 ${tokens.toLocaleString()} / ${limit.toLocaleString()}토큰`, over: false };
}

function storyTranslationRecords(spine: any): Array<{ kind: string; itemId: string; text: string }> {
  const records: Array<{ kind: string; itemId: string; text: string }> = [];
  const visit = (group: any, fallback: string) => {
    if (!group) return;
    const groupKey = storyGroupKey(group, fallback);
    [["title", group.title], ["summary", group.summary]].forEach(([field, text]) => {
      if (text) records.push({ kind: `story-${field}`, itemId: storyTranslationKey(groupKey, field), text: String(text) });
    });
    (group.beats ?? []).forEach((text: string, index: number) => { if (text) records.push({ kind: "story-beat", itemId: storyTranslationKey(groupKey, "beat", index), text: String(text) }); });
    (group.activeTransitions ?? []).forEach((text: string, index: number) => { if (text) records.push({ kind: "story-transition", itemId: storyTranslationKey(groupKey, "transition", index), text: String(text) }); });
    (group.flows ?? []).forEach((flow: any, flowIndex: number) => {
      const flowKey = storyGroupKey(flow, `${groupKey}:flow-${flowIndex}`);
      [["title", flow.title], ["summary", flow.summary]].forEach(([field, text]) => { if (text) records.push({ kind: `story-flow-${field}`, itemId: storyTranslationKey(flowKey, field), text: String(text) }); });
      (flow.beats ?? []).forEach((text: string, index: number) => { if (text) records.push({ kind: "story-flow-beat", itemId: storyTranslationKey(flowKey, "beat", index), text: String(text) }); });
      (flow.activeTransitions ?? []).forEach((text: string, index: number) => { if (text) records.push({ kind: "story-flow-transition", itemId: storyTranslationKey(flowKey, "transition", index), text: String(text) }); });
    });
    (group.segments ?? []).forEach((segment: any, index: number) => visit(segment, `${groupKey}:segment-${index}`));
  };
  visit(spine?.overview, "overview");
  (spine?.arcs ?? []).forEach((group: any, index: number) => visit(group, `arc-${index}`));
  (spine?.currentProgress ?? []).forEach((group: any, index: number) => visit(group, `current-${index}`));
  return records;
}

const STRIP_FRAMES = 3;

/** Story translation work in reading order: the logline, the act on screen, the open scene, that act's scenes, its season and the season's episode faces, then the rest of the story. */
export function storyScreenTranslationRecords(data: DashboardData, view: { selectedGroupId?: string; selectedPart?: string; expandedMemoryId?: string } = {}): Array<{ kind: string; itemId: string; text: string }> {
  const spine = data.storySpine;
  const all = storyTranslationRecords(spine);
  const { season, act } = storySelection(spine, view);
  const groupRecords = (key: string | undefined) => key ? all.filter((item) => item.itemId.startsWith(`story:${key}:`)) : [];
  const sceneRecords = (memory: any, dialogue: boolean) => {
    const lines: any[] = Array.isArray(memory.keyDialogues) ? memory.keyDialogues : [];
    const index = dialogue ? lines.findIndex((line) => String(line?.text ?? "").trim()) : -1;
    return [
      { kind: "memory-title", itemId: `${memory.id}:title`, text: String(memory.title ?? "") },
      ...(index < 0 ? [] : [{ kind: "dialogue", itemId: `${memory.id}:dialogue:${index}`, text: String(lines[index].text) }]),
    ];
  };
  const expanded = view.expandedMemoryId ? data.memories.find((memory) => String(memory.id) === view.expandedMemoryId) : undefined;
  const otherActs = (season?.acts ?? []).filter((item) => item.key !== act?.key);
  const records = [
    ...groupRecords(storyGroupKey(spine?.overview, "overview")),
    ...groupRecords(act?.key),
    ...(expanded ? [...sceneRecords(expanded, true), { kind: "memory-content", itemId: `${expanded.id}:content`, text: String(expanded.content ?? "") }] : []),
    ...(act ? actScenes(act.group, data.memories).flatMap((memory: any) => sceneRecords(memory, true)) : []),
    ...groupRecords(season?.part ? season.key : undefined),
    ...otherActs.flatMap((item) => [...groupRecords(item.key).filter((record) => /:(title|summary)$/u.test(record.itemId)), ...pickFrames(actScenes(item.group, data.memories), STRIP_FRAMES).flatMap((memory: any) => sceneRecords(memory, true))]),
    ...all,
    ...storyGroups(spine).slice().reverse().flatMap((item) => actScenes(item.group, data.memories)).flatMap((memory: any) => sceneRecords(memory, false)),
  ].filter((item) => item.text);
  return [...new Map(records.map((item) => [item.itemId, item])).values()];
}

export function storySpinePage(
  data: DashboardData,
  translations: TranslationView = new Map(),
  view: StoryViewState = { selectedGroupId: "", query: "", indexOpen: false, expandedMemoryId: "" },
  translationEnabled = false,
  sourceLanguage: MemoryLanguage = "en",
  overviewBackup?: StoryOverviewBackup,
  loaded = true,
): string {
  if (!loaded) {
    const failed = data.failedDatasets?.some((dataset) => dashboardDatasetsForTab("story").includes(dataset));
    return `<div class="story">${failed ? notice("데이터를 불러오지 못했어요.", { tone: "cut", action: btn("다시 시도", { kind: "quiet", action: "refresh", hit: true }) }) : loading()}</div>`;
  }
  const spine = data.storySpine ?? { overview: null, currentProgress: [], arcs: [] };
  const groups = storyGroups(spine);
  const parts: any[] = [...(spine.arcs ?? [])].sort(storyStartOrder);
  const pendingRange = data.storySpine?.pendingSourceRange;
  const pendingNotice = Number(pendingRange?.batchCount ?? 0) > 0
    ? notice(`아직 줄거리로 묶이지 않은 대화 · ${Number(pendingRange.batchCount)}묶음`) : "";
  const overview = spine.overview;
  const pageMenu = menu({ label: "줄거리 더보기", items: [
    ...(overview ? [{ label: "지금까지의 이야기 수정", icon: "edit", action: "edit-story-overview" }] : []),
    ...(overviewBackup && overviewBackup.summary !== String(overview?.summary ?? "") ? [{ label: "이전 요약 불러오기", icon: "refresh", action: "load-story-overview-backup" }] : []),
    { label: "줄거리 다시 만들기", icon: "refresh", action: "rebuild-story-spine" },
  ] });
  if (!overview && groups.length === 0 && parts.length === 0) return `<div class="story"><div class="story__bar">${pageMenu}</div>${empty("아직 정리된 줄거리가 없습니다", `이야기가 쌓이면 ${lex().actNoun}과 장면이 이곳에 이어집니다.`)}${pendingNotice}</div>`;
  const display: TranslationDisplay = translationEnabled ? "ko" : "en";
  const copy = (key: string, field: string, text: string, index?: number) => displayText(text, translations.get(storyTranslationKey(key, field, index)), display);
  const title = (group: any, key: string) => displayText(String(group?.title ?? "이야기 구간"), translations.get(storyTranslationKey(key, "title")), display);
  const overviewKey = storyGroupKey(overview, "overview");
  const numbers = sceneNumbers(data.memories);
  const cast = Array.isArray(data.relationships) && Array.isArray(data.entities) ? buildCast(data, data.personaEntity) : { persona: null, leads: [] };
  const castNames = [cast.persona?.name, ...cast.leads.map((lead) => lead.name)].filter((name): name is string => Boolean(name));
  const presents = castNames.length
    ? `<div class="presents">${castNames.slice(0, 3).map((name) => nameHtml(name)).join('<span class="amp" aria-label="그리고">&amp;</span>')}${castNames.length > 3 ? `<span class="more">외 ${castNames.length - 3}명</span>` : ""}</div>` : "";
  const sceneCount = storyScenes(data.memories).length;
  const lastIndex = groups.length - 1;
  const actLabel = (index: number) => lex().act(index);
  // A stretch of story reads as scene numbers and story dates, never raw source numbers.
  const sceneSpan = (scenes: any[]): string => {
    const nos = scenes.map((memory) => numbers.get(String(memory.id))).filter((no): no is number => Number.isFinite(no));
    const dates = scenes.map((memory) => sceneDate(memory.story_time ?? memory.storyTime ?? null)).filter((date): date is string => Boolean(date));
    const span = (first: string, last: string) => first === last ? first : `${first}–${last}`;
    return [nos.length ? `S#${span(String(Math.min(...nos)), String(Math.max(...nos)))}` : "", dates.length ? span(dates[0]!, dates[dates.length - 1]!) : ""].filter(Boolean).join(" · ");
  };
  const transitionList = (key: string, texts: string[]) => `<ul class="threadlist">${texts.map((text, index) => `<li>${icon("arrow-right")}<span>${copy(key, "transition", text, index)}</span></li>`).join("")}</ul>`;
  // An act's beats read as numbered stations.
  const rail = (key: string, texts: string[]) => `<ol class="rail">${texts.map((text, index) => `<li><span class="rail__no" aria-hidden="true">${index + 1}</span><p>${copy(key, "beat", text, index)}</p></li>`).join("")}</ol>`;
  // The story-level threads and the running act's threads say the same thing; the running act shows them once.
  const openThreads: { key: string; texts: string[] } = overview?.activeTransitions?.length
    ? { key: overviewKey, texts: overview.activeTransitions }
    : { key: groups[lastIndex]?.key ?? "", texts: groups[lastIndex]?.group.activeTransitions ?? [] };

  // A scene frame opens the scene sheet; the frame itself never grows, so its row in the grid keeps its height.
  const firstLine = (memory: any) => {
    const lines: any[] = Array.isArray(memory.keyDialogues) ? memory.keyDialogues : [];
    const index = lines.findIndex((line) => String(line?.text ?? "").trim());
    return index < 0 ? undefined : { html: displayText(String(lines[index].text), translations.get(`${memory.id}:dialogue:${index}`), display), speaker: String(lines[index].speaker ?? "") };
  };
  const sceneFrame = (memory: any) => {
    const date = sceneDate(memory.story_time ?? memory.storyTime ?? null);
    return frame({
      slug: memorySlug(memory, numbers),
      tag: memory.landmark ? lex().landmark : undefined, date: memory.landmark ? undefined : date ?? undefined,
      title: "", titleHtml: displayText(String(memory.title ?? ""), translations.get(`${memory.id}:title`), display),
      subtitle: firstLine(memory), mark: Boolean(memory.landmark), action: "toggle-story-memory", data: { memoryId: String(memory.id) },
    });
  };

  // Only one season and one act are on screen at a time, so the page never grows with the story.
  const { seasons, seasonIndex: selectedSeasonIndex, season, act: selectedAct } = storySelection(spine, view);
  const placeOf = storyActPlaces(spine);
  const runningSeason = seasons.length - 1;
  const fullLabel = (key: string) => { const place = placeOf.get(key); return place ? lex().partAct(place.season, place.act) : ""; };

  // The poster of an act is its strongest line of dialogue; an act with no dialogue shows its first scene's title.
  const poster = (scenes: any[]) => {
    const spoken = pickFrames(scenes, STRIP_FRAMES).find((memory) => Array.isArray(memory.keyDialogues) && memory.keyDialogues.some((line: any) => String(line?.text ?? "").trim()));
    if (spoken) {
      const index = spoken.keyDialogues.findIndex((line: any) => String(line?.text ?? "").trim());
      return { quote: true, html: displayText(String(spoken.keyDialogues[index].text), translations.get(`${spoken.id}:dialogue:${index}`), display), speaker: String(spoken.keyDialogues[index].speaker ?? "") };
    }
    const first = scenes[0];
    return { quote: false, html: first ? displayText(String(first.title ?? ""), translations.get(`${first.id}:title`), display) : "", speaker: "" };
  };

  const episode = (item: ReturnType<typeof storyGroups>[number]) => {
    const group = item.group;
    const scenes = actScenes(group, data.memories);
    const place = placeOf.get(item.key)!;
    const shot = poster(scenes);
    const now = item.number - 1 === lastIndex;
    const date = scenes.map((memory) => sceneDate(memory.story_time ?? memory.storyTime ?? null)).find(Boolean);
    const meta = [`${scenes.length}씬`, date ?? ""].filter(Boolean).join(" · ");
    return `<button type="button" class="ep${now ? " is-now" : ""}" data-action="select-story-group" data-group-id="${escapeHtml(item.key)}" data-season="${escapeHtml(seasons[place.season]!.key)}" data-cover="${(item.number - 1) % 6}" aria-current="${item.key === selectedAct?.key}">`
      + `<span class="ep__still"><span class="ep__no">${lex().act(place.act)}</span>${now ? `<span class="ep__now">${lex().nowShort}</span>` : ""}<span class="ep__line${shot.quote ? " is-quote" : ""}">${shot.html}</span>${shot.speaker ? `<span class="ep__who">${escapeHtml(shot.speaker)}</span>` : ""}</span>`
      + `<span class="ep__title">${title(group, item.key)}</span><span class="ep__syn">${copy(item.key, "summary", String(group.summary ?? ""))}</span><span class="ep__meta">${escapeHtml(meta)}</span></button>`;
  };

  // One act on screen: its synopsis, every scene in story order, then its beats, its people and what it hands on, all open.
  const actView = (item: ReturnType<typeof storyGroups>[number]) => {
    const group = item.group;
    const scenes = actScenes(group, data.memories);
    const current = item.number - 1 === lastIndex;
    const meta = [fullLabel(item.key), sceneSpan(scenes), current ? lex().nowShowing : "", group.pinned ? "검색 우선" : "", group.hidden ? "숨김" : ""].filter(Boolean).join(" · ");
    const actMenu = group.level !== "arc" ? "" : menu({ label: `${fullLabel(item.key)} 더보기`, items: [
      { label: group.hidden ? "숨김 해제" : `이 ${lex().actNoun} 숨기기`, icon: "inactive", action: "toggle-story-hidden", data: { groupId: String(group.groupId ?? ""), value: String(!group.hidden) } },
    ] });
    const section = (label: string, count: number, body: string) => body ? `<section class="actsec"><h3 class="sec">${label}${count ? ` <span class="n">${count}</span>` : ""}</h3>${body}</section>` : "";
    const reel = scenes.length ? `<div class="reel" data-drag-scroll data-preserve-scroll="reel:${escapeHtml(item.key)}">${scenes.map(sceneFrame).join("")}</div>` : "";
    const people = (group.flows ?? []).map((flow: any, flowIndex: number) => {
      const key = storyGroupKey(flow, `${item.key}:flow-${flowIndex}`);
      return `<article class="flowcard"><h4><button type="button" class="flowcard__open" data-action="open-story-sheet" data-sheet="${escapeHtml(`flow|${item.key}|${flowIndex}`)}">${nameHtml(String(flow.holder || flow.title || "관점"))}${icon("chevron")}</button></h4><p class="flowcard__text">${copy(key, "summary", String(flow.summary ?? ""))}</p>${flow.activeTransitions?.length ? transitionList(key, flow.activeTransitions) : ""}</article>`;
    }).join("");
    const handed = current ? openThreads : { key: item.key, texts: group.activeTransitions ?? [] };
    return `<article class="actview${current ? " is-now" : ""}" data-act="${escapeHtml(item.key)}" data-cover="${(item.number - 1) % 6}">`
      + `<div class="actview__lead"><header class="actview__head"><h2><span class="act__no">${lex().act(placeOf.get(item.key)?.act ?? 0)}</span>${title(group, item.key)}</h2>${actMenu}</header>`
      + `<span class="tc">${escapeHtml(meta)}</span><p class="actview__syn">${copy(item.key, "summary", String(group.summary ?? ""))}</p></div>`
      + section("장면", scenes.length, reel)
      + section("전개", group.beats?.length ?? 0, group.beats?.length ? rail(item.key, group.beats) : "")
      + section("인물", group.flows?.length ?? 0, people ? `<div class="flowcards">${people}</div>` : "")
      + section(current ? "이어지는 것" : `다음 ${lex().actNoun}으로 넘어간 것`, handed.texts.length, handed.texts.length ? transitionList(handed.key, handed.texts) : "")
      + `</article>`;
  };

  const seasonTabs = seasons.length > 1 ? `<div class="seasons" role="group" aria-label="부 선택">${seasons.map((item, index) => `<button type="button" class="season-tab" data-action="select-story-season" data-season="${escapeHtml(item.key)}" data-group-id="${escapeHtml(item.acts.at(-1)?.key ?? "")}" aria-current="${index === selectedSeasonIndex}"><span class="season-tab__no">${lex().part(index)}</span>${index === runningSeason && !item.part ? `<span class="season-tab__now">${lex().nowShort}</span>` : ""}</button>`).join("")}</div>` : "";
  // A season introduces its acts with a synopsis; its own beats, people and threads wait behind one link, in the sheet.
  const seasonHead = (() => {
    if (!season) return "";
    const part = season.part;
    const scenes = season.acts.flatMap((item) => actScenes(item.group, data.memories));
    const span = sceneSpan(scenes).split(" · ")[0] ?? "";
    const meta = [lex().part(selectedSeasonIndex), `${season.acts.length}${lex().actNoun}`, span, part ? "" : lex().nowShowing, part?.pinned ? "검색 우선" : "", part?.hidden ? "숨김" : ""].filter(Boolean).join(" · ");
    if (!part) return `<header class="season__head"><h2 class="season__title">${lex().part(selectedSeasonIndex)}</h2><span class="tc">${escapeHtml(meta)}</span></header>`;
    const actions = menu({ label: `${lex().part(selectedSeasonIndex)} 더보기`, items: [
      { label: part.pinned ? "검색 고정 해제" : "검색 우선 고정", icon: "pin", action: "toggle-story-pin", data: { groupId: String(part.groupId ?? ""), value: String(!part.pinned) } },
      { label: part.hidden ? "숨김 해제" : "이 부 숨기기", icon: "inactive", action: "toggle-story-hidden", data: { groupId: String(part.groupId ?? ""), value: String(!part.hidden) } },
    ] });
    return `<header class="season__head"><div class="season__titlebar"><h2 class="season__title">${title(part, season.key)}</h2>${actions}</div><span class="tc">${escapeHtml(meta)}</span><p class="syn">${copy(season.key, "summary", String(part.summary ?? ""))}</p>${part.beats?.length || part.flows?.length || part.activeTransitions?.length ? `<button type="button" class="season__more" data-action="open-story-sheet" data-sheet="${escapeHtml(`part|${season.key}`)}">이 ${lex().skin === "phone" ? "부" : "작품"}의 흐름${icon("chevron")}</button>` : ""}</header>`;
  })();
  const episodes = season ? `<div class="episodes" data-drag-scroll data-preserve-scroll="episodes:${escapeHtml(season.key)}">${season.acts.map(episode).join("")}</div>` : "";

  const actIndex = `<details class="menu actmenu" data-menu><summary class="btn btn--quiet hit">전체 ${lex().actNoun} ${groups.length}${icon("down")}</summary><div class="menu__pop menu__list" role="menu" aria-label="전체 ${lex().actNoun}"><div class="menu__title">전체 ${lex().actNoun} ${groups.length}</div><label class="search actmenu__search">${icon("search")}<input class="input" type="search" data-action="story-search" value="${escapeHtml(view.query)}" placeholder="${lex().actNoun} 제목과 요약 검색" aria-label="${lex().actNoun} 검색"></label>${groups.map((item) => `<button type="button" class="menu__item" role="menuitem" data-action="select-story-group" data-story-row data-group-id="${escapeHtml(item.key)}" data-season="${escapeHtml(seasons[placeOf.get(item.key)?.season ?? 0]?.key ?? "")}" aria-current="${item.key === selectedAct?.key}"><span class="no">${fullLabel(item.key)}</span><span class="t">${title(item.group, item.key)}</span><span class="k">${actScenes(item.group, data.memories).length}씬${item.number - 1 === lastIndex ? ` · ${lex().nowShort}` : ""}</span><span class="sr-only">${copy(item.key, "summary", String(item.group.summary ?? ""))}</span></button>`).join("")}<p class="sub" data-story-search-empty hidden>검색 결과가 없습니다.</p></div></details>`;
  const reelnav = `<div class="reelnav">${actIndex}${pageMenu}</div>`;
  const storyLimit = Number(spine?.storyLimitTokens) || 0;
  const draftCount = storyOverviewCount(view.overviewDraft ?? String(overview?.summary ?? ""), storyLimit);
  const overviewCount = `<p class="hint story__count${draftCount.over ? " is-over" : ""}" data-story-overview-count data-limit="${storyLimit}" aria-live="polite">${escapeHtml(draftCount.text)}</p>`;
  const overviewEditor = overview ? `<form id="story-overview-form" class="form story__edit" data-group-id="${escapeHtml(overview.groupId ?? "")}">${field({ id: "story-overview-summary", label: "지금까지의 이야기", control: `<textarea id="story-overview-summary" class="textarea" name="summary" rows="12" maxlength="120000" required>${escapeHtml(view.overviewDraft ?? String(overview.summary ?? ""))}</textarea>${overviewCount}`, hint: `대화 ${Number(overview.startOrdinal ?? 0) + 1}–${Number(overview.endOrdinal ?? 0) + 1} 범위는 그대로 유지됩니다.` })}<div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-story-overview" })}${btn("저장", { kind: "primary", icon: "save", type: "submit" })}</div></form>` : "";
  const loglineText = overview ? copy(overviewKey, "summary", String(overview.summary ?? "")) : "전체 요약을 준비하고 있습니다.";
  const loglineContent = overview
    ? lex().skin === "phone" ? `<p>${loglineText}</p>` : expandableLongContent("전체 요약", `<p>${loglineText}</p>`, String(overview.summary ?? "").length, true)
    : loglineText;
  const logline = view.editingOverview ? overviewEditor : `<div class="logline">${loglineContent}</div>`;
  const runtime = [`${sceneCount}씬`, seasons.some((item) => item.part) ? `${seasons.filter((item) => item.part).length}부` : "", `${groups.length}${lex().actNoun}`].filter(Boolean).map((text) => `<span>${text}</span>`).join("");
  const titlecard = `<section class="titlecard">${presents}<h1>${overview?.title ? title(overview, overviewKey) : "지금까지의 이야기"}</h1><div class="runtime">${runtime}</div>${lex().skin === "phone" ? logline : ""}</section>`;
  // Everything deeper than the page opens in one sheet: a scene, a part's flow, or a character's flow in an act.
  const sheetShell = (id: string, slug: string, body: string, foot = "") => `<dialog class="scene-sheet" data-scene="${escapeHtml(id)}" aria-labelledby="scene-sheet-title"><div class="scene-sheet__grip" aria-hidden="true"></div>`
    + `<header class="scene-sheet__bar"><span class="scene-sheet__slug">${escapeHtml(slug)}</span>${iconBtn("close", "닫기", { action: "close-scene-sheet" })}</header>`
    + `<div class="scene-sheet__body">${body}</div>${foot ? `<footer class="scene-sheet__foot">${foot}</footer>` : ""}</dialog>`;
  const sheetSection = (label: string, count: number, body: string) => body ? `<section class="sheet-sec"><h3 class="sec">${label}${count ? ` <span class="n">${count}</span>` : ""}</h3>${body}</section>` : "";
  const holderName = (flow: any) => String(flow?.holder || flow?.title || "관점");
  const sceneSheet = (() => {
    const memory = view.expandedMemoryId ? data.memories.find((item) => String(item.id) === view.expandedMemoryId) : undefined;
    if (!memory) return "";
    const owner = groups.find((item) => actScenes(item.group, data.memories).some((scene: any) => String(scene.id) === String(memory.id)));
    const scenes: any[] = owner ? actScenes(owner.group, data.memories) : [memory];
    const index = scenes.findIndex((scene) => String(scene.id) === String(memory.id));
    const step = (scene: any, label: string, name: string, end = false) => scene
      ? btn(label, { kind: "quiet", ...(end ? { iconEnd: name } : { icon: name }), action: "toggle-story-memory", data: { memoryId: String(scene.id) } })
      : "<span></span>";
    const line = firstLine(memory);
    const date = sceneDate(memory.story_time ?? memory.storyTime ?? null);
    const slug = [memorySlug(memory, numbers), memory.landmark ? lex().landmark : "", date ?? "", owner ? fullLabel(owner.key) : ""].filter(Boolean).join(" · ");
    return sheetShell(`scene|${memory.id}`, slug,
      `<h2 class="scene-sheet__title" id="scene-sheet-title">${displayText(String(memory.title ?? ""), translations.get(`${memory.id}:title`), display)}</h2>`
      + (line ? `<blockquote class="scene-sheet__line"><p>${line.html}</p>${line.speaker ? `<cite>${escapeHtml(line.speaker)}</cite>` : ""}</blockquote>` : "")
      + `<div class="scene-sheet__record">${displayText(String(memory.content ?? ""), translations.get(`${memory.id}:content`), display)}</div>`,
      `${step(scenes[index - 1], "이전 장면", "back")}${btn("타임라인에서 열기", { kind: "quiet", iconEnd: "arrow-right", action: "open-timeline-memory", data: { memoryId: String(memory.id) } })}${step(scenes[index + 1], "다음 장면", "chevron", true)}`);
  })();
  const detailSheet = (() => {
    const [kind, first = "", second = ""] = (view.detailSheet ?? "").split("|");
    if (kind === "part") {
      const target = seasons.find((item) => item.key === first && item.part);
      if (!target) return "";
      const part = target.part;
      const people = (part.flows ?? []).map((flow: any, flowIndex: number) => {
        const key = storyGroupKey(flow, `${target.key}:flow-${flowIndex}`);
        return `<article class="sheet-person"><h4>${nameHtml(holderName(flow))}</h4><p class="flowcard__text">${copy(key, "summary", String(flow.summary ?? ""))}</p>${flow.beats?.length ? rail(key, flow.beats) : ""}${flow.activeTransitions?.length ? transitionList(key, flow.activeTransitions) : ""}</article>`;
      }).join("");
      return sheetShell(`part|${target.key}`, [lex().part(seasons.indexOf(target)), `${target.acts.length}${lex().actNoun}`].join(" · "),
        `<h2 class="scene-sheet__title" id="scene-sheet-title">${title(part, target.key)}</h2>`
        + sheetSection("인물", part.flows?.length ?? 0, people ? `<div class="sheet-people">${people}</div>` : "")
        + sheetSection("전개", part.beats?.length ?? 0, part.beats?.length ? rail(target.key, part.beats) : "")
        + sheetSection("이어지는 흐름", part.activeTransitions?.length ?? 0, part.activeTransitions?.length ? transitionList(target.key, part.activeTransitions) : ""));
    }
    if (kind === "flow") {
      const owner = groups.find((item) => item.key === first);
      const flows: any[] = owner?.group.flows ?? [];
      const index = Number(second);
      const flow = flows[index];
      if (!owner || !flow) return "";
      const key = storyGroupKey(flow, `${owner.key}:flow-${index}`);
      const step = (at: number, end: boolean) => flows[at]
        ? btn(holderName(flows[at]), { kind: "quiet", ...(end ? { iconEnd: "chevron" } : { icon: "back" }), action: "open-story-sheet", data: { sheet: `flow|${owner.key}|${at}` } })
        : "<span></span>";
      return sheetShell(`flow|${owner.key}|${index}`, `${fullLabel(owner.key)} · 인물`,
        `<h2 class="scene-sheet__title" id="scene-sheet-title">${nameHtml(holderName(flow))}</h2><p class="scene-sheet__lede">${copy(key, "summary", String(flow.summary ?? ""))}</p>`
        + sheetSection("전개", flow.beats?.length ?? 0, flow.beats?.length ? rail(key, flow.beats) : "")
        + sheetSection("이어지는 것", flow.activeTransitions?.length ?? 0, flow.activeTransitions?.length ? transitionList(key, flow.activeTransitions) : ""),
        `${step(index - 1, false)}<span></span>${step(index + 1, true)}`);
    }
    return "";
  })();
  const body = `${seasonTabs}<section class="season" data-story-part="${escapeHtml(season?.key ?? "")}">${seasonHead}${episodes}</section>${selectedAct ? actView(selectedAct) : ""}${sceneSheet || detailSheet}`;
  return `<div class="story series" data-cover="${selectedAct ? (selectedAct.number - 1) % 6 : 0}">${groups.length ? reelnav : `<div class="story__bar">${pageMenu}</div>`}<div class="screening">${pendingNotice}${titlecard}${lex().skin === "phone" ? "" : logline}${body}</div></div>`;
}

const relationshipLevels: Record<string, string[]> = {
  affection: ["unknown", "aversion", "none", "faint", "growing", "established", "strong", "deep", "conflicted"],
  trust: ["unknown", "distrust", "none", "fragile", "developing", "established", "strong", "deep", "conflicted"],
  intimacy: ["unknown", "avoidant", "none", "tentative", "developing", "established", "strong", "deep", "conflicted"],
  fear: ["unknown", "none", "low", "moderate", "high", "extreme"],
  jealousy: ["unknown", "none", "low", "moderate", "high", "extreme"],
  hostility: ["unknown", "none", "low", "moderate", "high", "extreme"],
};
const relationshipTrends = ["rising", "stable", "falling", "volatile", "unclear"];

type RelationshipEditorPatch = {
  from: string;
  to: string;
  summary?: string | null;
  activeTensions?: string[];
  axis?: string;
  level?: string;
  trend?: string;
};

export function relationshipEditorPatches(values: Record<string, unknown>, current?: {
  summary?: string | null;
  activeTensions?: string[];
  axes?: Record<string, { level: string; trend: string }>;
}): RelationshipEditorPatch[] {
  const from = String(values.from ?? ""), to = String(values.to ?? "");
  const patches: RelationshipEditorPatch[] = [];
  const prose: Pick<RelationshipEditorPatch, "summary" | "activeTensions"> = {};
  const summary = String(values.summary ?? "").trim();
  const tensions = String(values.activeTensions ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (summary !== String(current?.summary ?? "")) prose.summary = summary || null;
  if (JSON.stringify(tensions) !== JSON.stringify(current?.activeTensions ?? [])) prose.activeTensions = tensions;
  if (Object.keys(prose).length) patches.push({ from, to, ...prose });
  for (const axis of Object.keys(relationshipLevels)) {
    const level = String(values[`${axis}Level`] ?? "unknown");
    const trend = String(values[`${axis}Trend`] ?? "unclear");
    const prior = relationshipAxis(current, axis);
    if (level !== prior.level || trend !== prior.trend) patches.push({ from, to, axis, level, trend });
  }
  return patches;
}
const relationshipAxisLabels: Record<string, string> = { affection: "애정", trust: "신뢰", intimacy: "친밀감", fear: "두려움", jealousy: "질투", hostility: "적대감" };
const relationshipAxisOrder = Object.keys(RelationshipProjectionItemSchema.shape.axes.shape);
const relationshipLevelWeight: Record<string, number> = { unknown: 0, none: 1, faint: 2, low: 2, tentative: 3, fragile: 3, growing: 4, developing: 4, moderate: 4, established: 5, strong: 6, high: 6, deep: 7, extreme: 7, conflicted: 6, distrust: 6, avoidant: 6, aversion: 7 };

export function relationshipAxisPresentation(axis: string, level: string): { tone: "neutral" | "positive" | "negative" | "mixed"; percent: number } {
  const negativeLevels = new Set(["aversion", "distrust", "avoidant"]);
  const intensityAxes = new Set(["fear", "jealousy", "hostility"]);
  const weight = Math.max(0, relationshipLevelWeight[level] ?? 0);
  const percent = ["unknown", "none"].includes(level) ? 0 : Math.max(14, Math.min(100, Math.round((weight / 7) * 100)));
  const tone = level === "conflicted" ? "mixed"
    : negativeLevels.has(level) || (intensityAxes.has(axis) && percent > 0) ? "negative"
      : percent > 0 ? "positive" : "neutral";
  return { tone, percent };
}

function personProminence(data: DashboardData, name: string): number {
  const normalized = name.normalize("NFKC").toLocaleLowerCase();
  const entity = data.entities.find((item) => [item.name, item.displayName, ...(item.aliases ?? [])]
    .some((value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase() === normalized));
  return entityProminence(entity);
}

function comparePeople(data: DashboardData, left: string, right: string): number {
  return personProminence(data, left) - personProminence(data, right) || compareUiText([left, right]);
}

export function relationshipsV2(state: RuntimeState, data: DashboardData, selectedKey: string, translations: TranslationView, display: RuntimeState["settings"]["translationDisplay"], _mergePreview?: any, intimacyEditor?: IntimacyEditor, section = "state", editing = false, relationshipTier = "all", mobileDetail = false, queryText = "", socialEditor?: SocialEditor, basicEditor?: WorldEditor, editingDirection = "", diaryFilter: PairDiaryFilter = "all", diarySort: PairDiarySort = "newest", anniversaryEditorEntryId = ""): string {
  const allRelationships = [...data.relationships].sort((left, right) => comparePeople(data, relationshipFrom(left), relationshipFrom(right)) || comparePeople(data, relationshipTo(left), relationshipTo(right)));
  const allPairs = buildPairs(data, data.personaEntity);
  const selectedPair = allPairs.find((pair) => pair.key === selectedKey);
  const selectedDirections = selectedPair ? allRelationships.filter((item) => pairKey(relationshipFrom(item), relationshipTo(item)) === selectedPair.key) : [];
  const selectedDirection = selectedPair ? [[selectedPair.a, selectedPair.b], [selectedPair.b, selectedPair.a]]
    .find(([from, to]) => `${from}|${to}` === editingDirection) : undefined;
  const selected = selectedDirection
    ? selectedDirections.find((item) => relationshipFrom(item) === selectedDirection[0] && relationshipTo(item) === selectedDirection[1])
    : selectedDirections[0];
  const selectedFrom = selectedDirection?.[0] ?? (relationshipFrom(selected) || selectedPair?.a || "");
  const selectedTo = selectedDirection?.[1] ?? (relationshipTo(selected) || selectedPair?.b || "");
  const persona = String(data.personaEntity ?? "").normalize("NFKC").trim().toLocaleLowerCase();
  const isMine = (pair: ReturnType<typeof buildPairs>[number]) => [pair.a, pair.b].some((name) => name.normalize("NFKC").trim().toLocaleLowerCase() === persona);
  const isMajor = (pair: ReturnType<typeof buildPairs>[number]) => isMine(pair) || [pair.a, pair.b].some((name) => entityProminence(entityForName(data, name)) === 0);
  const visiblePairs = allPairs.filter((pair) => relationshipTier === "all" || (relationshipTier === "primary" ? isMajor(pair) : !isMajor(pair)));
  const pairRow = (pair: ReturnType<typeof buildPairs>[number]) => {
    const names = [pair.a, pair.b].flatMap((name) => [name, ...(entityForName(data, name)?.aliases ?? [])]);
    return renderRelationshipRow(pair, pairSceneCount(data, pair), selectedKey, [...names, pair.label].filter(Boolean).join(" "), { translations, display });
  };
  const pairGroup = (label: string, pairs: ReturnType<typeof buildPairs>, key: string, counted: boolean) => {
    if (!pairs.length) return "";
    const rows = pairs.map(pairRow);
    return `<section class="contact-group relgroup" data-relationship-group><h3 class="sec">${label}${counted ? ` <span class="n">${pairs.length}</span>` : ""}</h3><div class="list">${rows.slice(0, 4).join("")}${rows.length > 4 ? fold("더 보기", rows.slice(4).join(""), { role: "more", count: rows.length - 4, preserveKey: `pairs-more:${key}`, open: Boolean(queryText) }) : ""}</div></section>`;
  };
  const relationGroups = pairGroup("내 관계", visiblePairs.filter(isMine), "mine", false)
    + pairGroup("다른 관계", visiblePairs.filter((pair) => !isMine(pair)), "others", true);

  const initial = (data.initialCalibration?.relationships ?? []).find((item: any) => item.from === selectedFrom && item.to === selectedTo);
  const editingInitialBaseline = data.initialCalibration?.status === "awaiting_confirmation" && Boolean(initial);
  const axisEditors = selectedPair ? relationshipAxisOrder.map((axis) => {
    const value = editingInitialBaseline ? { level: initial?.axes?.[axis] ?? "unknown", trend: "unclear" } : relationshipAxis(selected, axis);
    const trendEditor = editingInitialBaseline ? "" : field({ id: `axis-${axis}-trend`, label: "변화", control: `<select id="axis-${axis}-trend" class="select" name="${axis}Trend">${relationshipTrends.map((trend) => `<option value="${trend}" ${value.trend === trend ? "selected" : ""}>${escapeHtml(relationshipTrendKo[trend] ?? trend)}</option>`).join("")}</select>` });
    return `<fieldset class="axisedit" data-relationship-axis="${axis}"><legend>${relationshipAxisLabels[axis]}</legend><div class="form__row">${field({ id: `axis-${axis}-level`, label: "상태", control: `<select id="axis-${axis}-level" class="select" name="${axis}Level">${relationshipLevels[axis]!.map((level) => `<option value="${level}" ${value.level === level ? "selected" : ""}>${escapeHtml(relationshipLevelKo[level] ?? level)}</option>`).join("")}</select>` })}${trendEditor}</div></fieldset>`;
  }).join("") : "";
  const editorSummary = editingInitialBaseline ? initial?.summary ?? "" : selected?.summary ?? "";
  const relationshipEditor = selectedPair && editing ? `<form id="relationship-form" class="form"${editingInitialBaseline ? ` data-initial-baseline-id="${escapeHtml(initial.id)}"` : ""}><h3 class="subhead">${editingInitialBaseline ? "초기 관계 수정" : "관계 수정"} · ${escapeHtml(selectedFrom)} → ${escapeHtml(selectedTo)}</h3><input type="hidden" name="from" value="${escapeHtml(selectedFrom)}"><input type="hidden" name="to" value="${escapeHtml(selectedTo)}">${field({ id: "relationship-summary", label: "관계 요약", control: `<textarea id="relationship-summary" class="textarea" name="summary" rows="4">${escapeHtml(editorSummary)}</textarea>` })}${editingInitialBaseline ? '<p class="sub">확인 전 수정은 앞으로 변화가 쌓일 초기 관계로 저장됩니다.</p>' : field({ id: "relationship-tensions", label: "남은 갈등", control: `<input id="relationship-tensions" class="input" name="activeTensions" value="${escapeHtml((selected?.activeTensions ?? []).join(", "))}" placeholder="여러 항목은 쉼표로 구분">` })}<div class="axisedits">${axisEditors}</div>${editingInitialBaseline ? "" : autoLockCheckbox(selected?.locked)}<div class="form__bar">${btn("취소", { kind: "quiet", action: "close-relationship-editor" })}${btn("저장", { kind: "primary", icon: "save", action: "submit-form" })}</div></form>` : "";

  const intimacyLabels: Record<string, string> = { hand_holding: "손잡기", embrace: "포옹", cuddling: "껴안고 있기", forehead_kiss: "이마 키스", cheek_kiss: "볼 키스", hand_kiss: "손등 키스", lip_kiss: "입술 키스", deep_kiss: "깊은 키스", sexual_touch: "성적 스킨십", manual_sex: "손을 이용한 성행위", oral_sex: "구강 성교", vaginal_sex: "질 성교", anal_sex: "항문 성교" };
  const contextLabels: Record<string, string> = { mutual: "상호적", initiated: "한쪽이 시작", coerced: "강요된 상황", nonconsensual: "비합의", ambiguous: "불명확" };
  const editingIntimacy = intimacyEditor ? (data.physicalIntimacy ?? []).find((item: any) => item.id === intimacyEditor.id) : undefined;
  const intimacyPersonOptions = (value?: string) => `<option value="">인물을 선택하세요</option>${data.entities.filter((entity) => ["person", "character"].includes(entity.type)).sort((a, b) => entityProminence(a) - entityProminence(b) || compareUiText([a.name, b.name])).map((entity) => `<option value="${escapeHtml(entity.name)}" ${entity.name === value ? "selected" : ""}>${escapeHtml(entity.name)}</option>`).join("")}`;
  const actOptions = [...Object.keys(intimacyLabels), "other"].map((act) => `<option value="${act}" ${editingIntimacy?.act === act ? "selected" : ""}>${escapeHtml(act === "other" ? "기타" : intimacyLabels[act])}</option>`).join("");
  const select = (id: string, name: string, label: string, options: string, required = false) => field({ id, label, control: `<select id="${id}" class="select" name="${name}"${required ? " required" : ""}>${options}</select>` });
  const intimacyForm = intimacyEditor ? `<form id="intimacy-form" class="form" data-id="${escapeHtml(intimacyEditor.id ?? "")}"><h3 class="subhead">${intimacyEditor.id ? "스킨십 기록 수정" : "스킨십 기록 추가"}</h3><div class="form__row">${select("intimacy-a", "participantA", "참여자 1", intimacyPersonOptions(editingIntimacy?.participantA ?? intimacyEditor.participantA), true)}${select("intimacy-b", "participantB", "참여자 2", intimacyPersonOptions(editingIntimacy?.participantB ?? intimacyEditor.participantB), true)}</div><div class="form__row">${select("intimacy-act", "act", "행위", actOptions)}${field({ id: "intimacy-custom", label: "기타 행위명", control: `<input id="intimacy-custom" class="input" name="customLabel" value="${escapeHtml(editingIntimacy?.customLabel ?? "")}">` })}</div><div class="form__row">${select("intimacy-initiator", "initiator", "행위자", `<option value="">명시되지 않음</option><option value="mutual" ${editingIntimacy?.initiator === "mutual" ? "selected" : ""}>상호</option>${intimacyPersonOptions(editingIntimacy?.initiator).replace('<option value="">인물을 선택하세요</option>', "")}`)}${select("intimacy-context", "interactionContext", "상황", Object.entries(contextLabels).map(([key, label]) => `<option value="${key}" ${editingIntimacy?.interactionContext === key ? "selected" : ""}>${label}</option>`).join(""))}</div>${field({ id: "intimacy-circumstance", label: "당시 상황과 의도", control: `<textarea id="intimacy-circumstance" class="textarea" name="circumstance">${escapeHtml(editingIntimacy?.circumstance ?? "")}</textarea>` })}<label class="check"><input name="autoInject" type="checkbox"${editingIntimacy?.autoInject === false ? "" : " checked"}><span>자동 주입에 포함<small>끄면 기록은 남고, 기억 도구로 찾을 수 있습니다.</small></span></label><div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-intimacy" })}${btn("저장", { kind: "primary", icon: "save", action: "submit-form" })}</div></form>` : "";
  const detail = selectedPair ? renderPairDetail(data, selectedPair, {
    copy: (canonical, translationKey) => displayText(relationshipSummaryLabel(canonical), translations.get(translationKey), display),
    diaryFilter,
    diarySort,
    anniversaryEditorEntryId,
    editingContent: intimacyEditor ? intimacyForm : socialEditor?.focus === "address" ? addressEditorForm(socialEditor) : editing ? relationshipEditor : undefined,
    canEditCalls: data.health?.capabilities?.socialKnowledge === true,
    axisLabels: relationshipAxisLabels,
    levelLabels: relationshipLevelKo,
    trendLabels: relationshipTrendKo,
    axisValue: relationshipAxis,
  }) : "";
  const tools = `<div class="tl-tools"><label class="search">${icon("search")}<span class="sr-only">관계 검색</span><input class="input" type="search" data-action="relationship-search" value="${escapeHtml(queryText)}" placeholder="인물 또는 관계 검색"></label></div>`;
  const tierFilter = filters([["all", "전체"], ["primary", "주요"], ["supporting", "조연"]].map(([value, label]) => ({ label: label!, pressed: relationshipTier === value, action: "relationship-filter", data: { value: value! } })), "중요도 필터");
  const list = `<div class="listcol">${tools}${tierFilter}<div class="tl-rows" data-preserve-scroll="relationship-list">${relationGroups || empty("조건에 맞는 관계가 없습니다", "검색어나 필터를 바꿔 보세요.")}<div data-relationship-search-empty hidden>${empty("검색 결과가 없습니다", "다른 이름으로 찾아보세요.")}</div></div></div>`;
  const hasDetail = Boolean(basicEditor || selectedPair);
  const reader = basicEditor ? `<div class="relations-detail" data-preserve-scroll="relationship-detail">${worldEditorPanel(data, basicEditor)}</div>` : selectedPair ? `<div class="relations-detail" data-preserve-scroll="relationship-detail">${detail}</div>` : empty("관계를 고르세요", "목록에서 관계를 고르면 두 사람의 기록이 열립니다.");
  const stateContent = `<div class="relations${hasDetail && (mobileDetail || basicEditor) ? " is-detail" : ""}"><div class="split">${list}<div class="readercol" data-preserve-scroll="reader:relationship:${escapeHtml(selectedPair?.key ?? "")}:${escapeHtml(basicEditor ? "edit" : "")}">${reader}</div></div></div>`;

  const socialJobs = data.socialKnowledgeJobs ?? {}, socialBusy = Number(socialJobs.queued ?? 0) + Number(socialJobs.leased ?? 0);
  const chatEnabled = state.current ? isChatMemoryEnabled(state.settings, state.current.chatId) : false;
  const social = [...(data.socialKnowledge ?? [])].sort((left: any, right: any) => comparePeople(data, String(left.holder), String(right.holder))
    || comparePeople(data, String(left.subject), String(right.subject))
    || compareUiText([(left.knownAs ?? []).join(" "), (right.knownAs ?? []).join(" ")]));
  const socialGroups = new Map<string, any[]>(); social.forEach((item: any) => socialGroups.set(String(item.holder), [...(socialGroups.get(String(item.holder)) ?? []), item]));
  const openSocialGroups = socialGroups.size < 4;
  const socialRows = [...socialGroups.entries()].map(([holder, items]) => `<details class="fold" data-social-group data-preserve-open="social-group:${escapeHtml(holder)}"${openSocialGroups ? " open" : ""}><summary><span>${nameHtml(holder)}</span><span class="n">${items.length}</span></summary><div class="fold__body">${items.map((item) => `<article class="entry acquaintance" data-social-row><div class="entry__v"><b>${escapeHtml(holder)} → ${escapeHtml(item.subject)}</b> <small>${item.level === "interacted" ? "직접 교류한 기록 있음" : "존재를 알고 있음"}</small><p class="calls">${escapeHtml((item.knownAs ?? []).join(" · ") || "알고 있는 이름 없음")}</p>${(item.cognition ?? []).map((detail: any) => `<p>${displayText(detail.text, translations.get(`social-cognition:${detail.id}`), display)}</p>`).join("")}</div><div class="entry__src">${menu({ label: "지인 관계 더보기", items: [
    { label: "지인 관계 수정", icon: "edit", action: "edit-social", data: { holder: String(item.holder), subject: String(item.subject), level: String(item.level), knownAs: (item.knownAs ?? []).join(", ") } },
    { label: "지인 관계 삭제", icon: "delete", action: "delete-social", data: { holder: String(item.holder), subject: String(item.subject) }, danger: true },
  ] })}</div></article>`).join("")}</div></details>`).join("");
  const socialMenu = menu({ label: "지인 관계 더보기", items: socialBusy || !chatEnabled ? [] : [{ label: "지인 관계 다시 찾기", icon: "refresh", action: "backfill-social" }] });
  const socialNote = socialBusy ? `<p class="sub">다시 찾는 중 · ${socialBusy}</p>` : !chatEnabled ? '<p class="sub">지인 관계 다시 찾기는 RCM을 켜야 사용할 수 있습니다.</p>' : "";
  const socialContent = !data.health?.capabilities?.socialKnowledge
    ? `<div class="relations"><div class="listcol">${empty("이 기능을 사용하려면 서버를 업데이트해 주세요", "지인 관계는 최신 서버에서 제공됩니다.")}</div></div>`
    : `<div class="relations${socialEditor && !socialEditor.focus ? " is-detail" : ""}"><div class="split"><div class="listcol"><div class="tl-tools"><label class="search">${icon("search")}<span class="sr-only">지인 관계 검색</span><input class="input" type="search" data-action="social-search" placeholder="인물 또는 지인 관계 검색"></label>${iconBtn("add", "지인 관계 추가", { action: "new-social" })}${socialBusy || !chatEnabled ? "" : socialMenu}</div>${socialNote}<p class="sub"><span data-social-count>${social.length}개</span>의 지인 관계</p><div class="tl-rows" data-preserve-scroll="social-list">${socialRows || empty("아직 지인 관계가 없습니다", "인물이 서로를 알게 되면 여기에 쌓입니다.")}<div data-social-search-empty hidden>${empty("검색 결과가 없습니다", "다른 이름으로 찾아보세요.")}</div></div></div><div class="readercol">${socialEditor ? `<article class="reader"><div class="reader__bar"><button type="button" class="back hit" data-action="cancel-social">${icon("back")}<span>아는 사이</span></button></div>${socialEditorForm(socialEditor)}</article>` : empty("지인 관계를 고르세요", "수정하려면 항목의 더보기를 누르세요.")}</div></div></div>`;
  return section === "acquaintances" ? socialContent : stateContent;
}

function renderEvidenceIssues(item: any): string {
  const draft = item.draft ?? {};
  const review = item.evidenceReview;
  const issues = review?.issues ?? [];
  const sources = new Map<string, any>((review?.sourceMessages ?? []).map((source: any) => [source.id, source]));
  return issues.map((issue: any, index: number) => {
    const source = sources.get(issue.messageId);
    const parts = String(issue.path).replace(/\[(\d+)\]/g, ".$1").split(".");
    let candidate: any = draft;
    let owner: any = draft;
    for (const part of parts) { if (candidate?.speaker || candidate?.access) owner = candidate; candidate = candidate?.[part]; }
    if (candidate?.speaker || candidate?.access) owner = candidate;
    const access = (owner?.access ?? []).map((grant: any) => grant.holder).join(", ") || "확인 필요";
    const affected = owner?.holder ?? owner?.speaker ?? owner?.subject ?? "확인 필요";
    const reason = issue.reason === "access_unverified" ? "접근 범위 확인 필요" : issue.reason === "source_unavailable" ? "원문 참조 확인 필요" : issue.reason === "source_range_unverified" ? "원문 위치 확인 필요" : "원문과 발췌 불일치";
    return fold(`근거 ${index + 1} · ${issue.blocking ? "누적 상태 확인 필요" : "발췌 제외"} · ${reason}`, `<dl class="kv"><dt>영향 인물</dt><dd>${escapeHtml(affected)}</dd><dt>발언자</dt><dd>${escapeHtml(owner?.speaker ?? "서술 / 미지정")}</dd><dt>접근 범위</dt><dd>${escapeHtml(access)}</dd><dt>대응 원문</dt><dd>${source ? `${escapeHtml(source.role)} · ${Number(source.ordinal) + 1}번째 메시지` : "현재 참조로 원문을 확인할 수 없음"}</dd></dl><h4 class="subhead">후보 발췌</h4><blockquote class="quote">${escapeHtml(issue.quote ?? "발췌 없음")}</blockquote>${source ? `<pre class="packet">${escapeHtml(source.content)}</pre>` : ""}`, { preserveKey: `evidence-issue:${item.id}:${index}` });
  }).join("");
}



/** What a ledger record is called on screen: its state kind, its relation kind, or 인식·약속 — never the ledger's own name. */
export function worldRecordLabel(kind: "assertion" | "belief" | "promise", item: any, social = false): string {
  if (kind === "belief") return "인식";
  if (kind === "promise") return "약속";
  const relation = item?.socialRelation;
  if (relation) return relation.kind === "affiliation" ? "소속" : "기본 관계";
  if (social) return "기본 관계·소속";
  return STATE_KIND_LABELS[String(item?.stateKind ?? item?.state_kind ?? "condition")] ?? "상태";
}

/** A 기본 관계 reads as one sentence: 인물 → 상대 · 관계. The ledger key is derived from it, never typed. */
export function relationPreview(subject: string, target: string, label: string, kind: string, mutual: boolean): string {
  if (!subject || !target || !label) return "";
  return `${subject} ${kind === "interpersonal" && mutual ? "↔" : "→"} ${target} · ${label}`;
}

function relationFields(item: any, editor: WorldEditor): string {
  const relation = item.socialRelation;
  const kind = String(relation?.kind ?? editor.relationKind ?? "interpersonal");
  const subject = String(item.subject ?? editor.subject ?? "");
  const target = String(relation?.target ?? editor.target ?? "");
  const label = String(relation?.label ?? "");
  const mutual = relation?.direction === "mutual";
  const affiliation = kind === "affiliation";
  const text = (name: string, fieldLabel: string, value: string, extra = "", data = "") => field({ id: `world-${name}`, label: fieldLabel, control: `<input id="world-${name}" class="input" name="${name}" value="${escapeHtml(value)}"${extra}${data}>` });
  const kindSeg = `<div class="field"><span class="label">종류</span><div class="seg" role="radiogroup" aria-label="관계 종류">${[["interpersonal", "인물 간 관계"], ["affiliation", "소속·직책"]].map(([value, name]) => `<label><input type="radio" name="relationKind" value="${value}"${kind === value ? " checked" : ""}><span>${name}</span></label>`).join("")}</div></div>`;
  // The labels of 상대 and 관계 follow the kind: an affiliation names an organisation and a role.
  const targetLabel = affiliation ? "조직" : "상대";
  const relationLabel = affiliation ? "직책·역할" : "관계";
  const people = `<div class="relation-people">${text("subject", "인물", subject, ` required${editor.lockSubject ? " readonly" : ""}`)}<button type="button" class="relation-swap hit" data-action="swap-relation" aria-label="인물과 상대 바꾸기"${affiliation || editor.lockSubject ? " hidden" : ""}>${icon("swap")}</button>${field({ id: "world-relationTarget", label: targetLabel, control: `<input id="world-relationTarget" class="input" name="relationTarget" value="${escapeHtml(target)}" required>` })}</div>`;
  const mutualCheck = `<label class="check" data-for-kind="interpersonal"${affiliation ? " hidden" : ""}><input type="checkbox" name="relationMutual"${mutual ? " checked" : ""}><span>양방향 관계<small>상대에게도 같은 관계예요.</small></span></label>`;
  const knownBy = field({ id: "world-relationKnownBy", label: "아는 인물", control: `<input id="world-relationKnownBy" class="input" name="relationKnownBy" value="${escapeHtml((relation?.knownBy ?? []).join(", "))}" placeholder="쉼표로 구분">`, hint: "비우면 작가만 아는 기록이 됩니다." });
  const description = field({ id: "world-value", label: "설명 (선택)", control: `<textarea id="world-value" class="textarea" name="value" rows="2">${escapeHtml(item.value ?? "")}</textarea>` });
  return `${kindSeg}${people}${field({ id: "world-relationLabel", label: relationLabel, control: `<input id="world-relationLabel" class="input" name="relationLabel" value="${escapeHtml(label)}" required placeholder="${affiliation ? "예: 단장" : "예: 연인"}">` })}${mutualCheck}${description}${knownBy}${everyoneCheck("relationKnownByEveryone", relation?.knownByEveryone === true, "모두 아는 관계")}`;
}

/** Fill in what follows from the relation form's other fields: kind-dependent labels. */
function syncRelationForm(form: HTMLFormElement): void {
  const kind = form.querySelector<HTMLInputElement>('input[name="relationKind"]:checked')?.value ?? "interpersonal";
  const affiliation = kind === "affiliation";
  form.querySelectorAll<HTMLElement>("[data-for-kind]").forEach((node) => { node.hidden = node.dataset.forKind !== kind; });
  const targetLabel = form.querySelector<HTMLElement>('label[for="world-relationTarget"]');
  if (targetLabel) targetLabel.textContent = affiliation ? "조직" : "상대";
  const nameLabel = form.querySelector<HTMLElement>('label[for="world-relationLabel"]');
  if (nameLabel) nameLabel.textContent = affiliation ? "직책·역할" : "관계";
  const title = form.closest(".reader")?.querySelector<HTMLElement>(".reader__title[data-title-verb]");
  if (title) title.textContent = `${affiliation ? "소속" : "기본 관계"} ${title.dataset.titleVerb}`;
  const swap = form.querySelector<HTMLElement>(".relation-swap");
  if (swap) swap.hidden = kind !== "interpersonal" || Boolean(form.querySelector<HTMLInputElement>('input[name="subject"][readonly]'));
  const label = form.querySelector<HTMLInputElement>('input[name="relationLabel"]');
  if (label) label.placeholder = kind === "affiliation" ? "예: 단장" : "예: 연인";
}

const normalizeRelationText = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();

/** Another active 기본 관계 between the same two people under the same name, if any, and how it overlaps. */
export function findRelationOverlap(assertions: any[], draft: { id?: string; subject: string; target: string; label: string; kind: string; mutual: boolean }): { item: any; overlap: "same" | "covered" | "reverse" } | undefined {
  const subject = normalizeRelationText(draft.subject), target = normalizeRelationText(draft.target), label = normalizeRelationText(draft.label);
  for (const item of assertions) {
    const relation = item?.socialRelation;
    if (!relation || String(item.id) === String(draft.id ?? "") || relation.kind !== draft.kind || normalizeRelationText(relation.label) !== label) continue;
    const from = normalizeRelationText(item.subject), to = normalizeRelationText(relation.target);
    if (from === subject && to === target) return { item, overlap: "same" };
    if (draft.kind === "interpersonal" && from === target && to === subject) {
      return { item, overlap: draft.mutual || relation.direction === "mutual" ? "covered" : "reverse" };
    }
  }
  return undefined;
}

function worldEditorPanel(data: DashboardData, editor?: WorldEditor, backLabel = "목록"): string {
  if (!editor) return "";
  const collection = editor.kind === "assertion" ? data.assertions : editor.kind === "belief" ? data.beliefs : data.promises;
  // Ended and removed records can still be deleted from the ledger's history.
  const history: any[] = editor.kind === "assertion" ? data.endedAssertions ?? [] : editor.kind === "belief" ? [...(data.endedBeliefs ?? []), ...(data.userDeletedBeliefs ?? [])] : (data.promiseHistory ?? []).map((event: any) => ({ ...event, id: String(event.promise_id ?? event.id) }));
  const item = editor.mode === "create" ? { stateKind: editor.stateKind ?? "condition", subject: editor.subject ?? "" } : [...collection, ...history].find((value) => String(value.id) === editor.id);
  if (!item) return "";
  const label = editor.kind === "assertion" && editor.social && !item.socialRelation
    ? (editor.relationKind === "affiliation" ? "소속" : "기본 관계")
    : worldRecordLabel(editor.kind, item, editor.social);
  const canonical = editor.kind === "promise" ? item.content : item.value;
  const back = `<div class="reader__bar"><button type="button" class="back hit" data-action="cancel-world-edit">${icon("back")}<span>${escapeHtml(backLabel)}</span></button></div>`;
  if (editor.mode === "end" || editor.mode === "delete") {
    // 종료 keeps the record as history; 삭제 removes a record that should never have been there.
    const ending = editor.mode === "end";
    const who = editor.kind === "belief" ? `${item.holder ?? ""} → ${item.subject ?? ""}`
      : editor.kind === "promise" ? `${item.promisor ?? ""} → ${item.promisee ?? ""}`
        : [item.subject, item.socialRelation ? item.socialRelation.label : predicateLabel(item.predicate)].filter(Boolean).join(" · ");
    const note = ending
      ? notice("이야기에서 더 이상 사실이 아닌 것으로 표시합니다. 이전 기록에 남고, 자동 전달에서는 빠집니다.")
      : notice("잘못 기록된 항목을 지웁니다. 이전 기록에도 남지 않으며 되돌릴 수 없습니다.", { tone: "cut" });
    const confirm = ending
      ? btn("종료", { kind: "primary", action: "confirm-end-world", data: { kind: editor.kind, id: String(editor.id ?? "") } })
      : btn("삭제", { kind: "danger-solid", icon: "delete", action: "confirm-delete-world", data: { kind: editor.kind, id: String(editor.id ?? "") } });
    return `<article class="reader world-confirm"${ending ? "" : ' role="alert"'}>${back}<h2 class="reader__title">${escapeHtml(label)} ${ending ? "종료" : "삭제"}</h2><div class="world-confirm__card">${who ? `<p class="world-confirm__who">${escapeHtml(who)}</p>` : ""}<p class="rec">${escapeHtml(canonical || "선택한 기록")}</p></div>${note}<div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-world-edit" })}${confirm}</div></article>`;
  }
  const input = (name: string, fieldLabel: string, value: unknown, extra = "") => field({ id: `world-${name}`, label: fieldLabel, control: `<input id="world-${name}" class="input" name="${name}" value="${escapeHtml(value ?? "")}"${extra}>` });
  const textarea = (name: string, fieldLabel: string, value: unknown, extra = "") => field({ id: `world-${name}`, label: fieldLabel, control: `<textarea id="world-${name}" class="textarea" name="${name}"${extra}>${escapeHtml(value ?? "")}</textarea>` });
  const select = (name: string, fieldLabel: string, options: string) => field({ id: `world-${name}`, label: fieldLabel, control: `<select id="world-${name}" class="select" name="${name}">${options}</select>` });
  const stateKind = String(item.stateKind ?? item.state_kind ?? "condition");
  const knownBy = Array.isArray(item.knownBy) ? item.knownBy.map(String).join(", ") : "";
  const kindPick = select("stateKind", "종류", Object.entries(STATE_KIND_LABELS).map(([value, text]) => `<option value="${value}" ${stateKind === value ? "selected" : ""}>${text}</option>`).join(""));
  const knownByField = `<div data-state-only="goal secret"${["goal", "secret"].includes(stateKind) ? "" : " hidden"}>${field({ id: "world-knownBy", label: "아는 인물", control: `<input id="world-knownBy" class="input" name="knownBy" value="${escapeHtml(knownBy)}" placeholder="쉼표로 구분">`, hint: "이 목표나 비밀을 알고 있는 인물입니다." })}</div>`;
  const plainState = editor.kind === "assertion" && !(editor.social || item.socialRelation);
  const fields = editor.kind === "assertion" && !plainState
    ? relationFields(item, editor)
    : editor.kind === "assertion"
    ? `${kindPick}<div class="form__row">${input("subject", "대상", item.subject, " required")}${input("predicate", "항목", item.predicate, " required")}</div>${textarea("value", "내용", item.value, " required")}${knownByField}`
    : editor.kind === "belief"
      ? `<div class="form__row">${input("holder", "관점 인물", item.holder, " required")}${input("subject", "대상", item.subject, " required")}</div><div class="form__row">${input("predicate", "속성", item.predicate, " required")}${select("polarity", "인식", ["believes", "suspects", "denies", "knows", "heard"].map((value) => `<option value="${value}" ${item.polarity === value ? "selected" : ""}>${POLARITY_LABELS[value]}</option>`).join(""))}</div>${textarea("value", "내용", item.value, " required")}`
      : `<div class="form__row">${input("promisor", "약속한 인물", item.promisor, " required")}${input("promisee", "상대", item.promisee, " required")}</div><div class="form__row">${select("status", "상태", Object.entries(PROMISE_STATUS_LABELS).map(([value, text]) => `<option value="${value}" ${item.status === value ? "selected" : ""}>${text}</option>`).join(""))}${input("scheduledFor", "예정 시점", item.scheduled_for, ' placeholder="예: 화요일 점심"')}</div>${textarea("content", "약속 내용", item.content, " required")}${input("statusReason", "상태 메모", item.status_reason, ' placeholder="현재 상태의 근거"')}`;
  const scope = editor.kind === "promise" && editor.mode === "create" ? select("scope", "반복 여부", '<option value="future">한 번의 약속</option><option value="recurring">반복 약속</option>') : "";
  const verb = editor.mode === "create" ? "추가" : "수정";
  // The title follows the 종류 picker as it changes.
  const titleData = editor.kind === "assertion" ? ` data-title-verb="${verb}"` : "";
  return `<article class="reader is-editing">${back}<h2 class="reader__title"${titleData}>${escapeHtml(label)} ${verb}</h2><form id="world-state-form" class="form" data-kind="${editor.kind}" data-id="${escapeHtml(editor.id ?? "")}" data-mode="${editor.mode}"${plainState || editor.kind !== "assertion" ? "" : ` data-social="true" data-original-predicate="${escapeHtml(item.predicate ?? "")}" data-original-label="${escapeHtml(item.socialRelation?.label ?? "")}" data-original-target="${escapeHtml(item.socialRelation?.target ?? "")}"`}>${fields}${scope}${autoLockCheckbox(item.locked)}<div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-world-edit" })}${btn("저장", { kind: "primary", icon: "save", action: "submit-form" })}</div></form></article>`;
}


interface ConflictPresentation {
  title: string;
  explanation: string;
  changes: string[];
  allowKeepExisting: boolean;
}

export function conflictCategory(kind: unknown): string {
  switch (kind) {
    case "assertion": return "세계 사실";
    case "unattributed_claim": return "인물 주장";
    case "belief_action_target":
    case "belief_user_override": return "인물 인식";
    case "temporal_boundary_review": return "약속";
    case "source_revision": return "원문 근거";
    case "static_projection_changed": return "캐릭터 설정";
    default: return "기타 충돌";
  }
}

const objectValue = (value: unknown): Record<string, any> => {
  const parsed = parseJson<Record<string, any> | null>(value, null);
  return parsed && typeof parsed === "object" ? parsed : {};
};

export function describeConflict(item: any): ConflictPresentation {
  const existing = objectValue(item.existing_json);
  const incoming = objectValue(item.incoming_json);
  if (item.kind === "static_projection_changed") {
    const structured = existing.schema === "static_projection_summary.v1" && incoming.schema === "static_projection_summary.v1";
    if (!structured) return {
      title: "캐릭터 카드·로어북 구성이 변경됨",
      explanation: "변경 기록의 구조를 읽을 수 없습니다. 현재 설정을 다시 동기화한 뒤 확인하세요.",
      changes: [],
      allowKeepExisting: false,
    };
    const changes: string[] = [];
    if (existing.characterName !== incoming.characterName) changes.push(`캐릭터명: ${existing.characterName || "없음"} → ${incoming.characterName || "없음"}`);
    if (existing.description?.hash !== incoming.description?.hash) {
      changes.push(`캐릭터 설명 변경: ${Number(existing.description?.characters ?? 0).toLocaleString()}자 → ${Number(incoming.description?.characters ?? 0).toLocaleString()}자`);
    }
    const oldLore = new Map<string, { hash?: string }>((existing.lore?.entries ?? []).map((entry: any) => [String(entry.title), entry]));
    const newLore = new Map<string, { hash?: string }>((incoming.lore?.entries ?? []).map((entry: any) => [String(entry.title), entry]));
    const added = [...newLore.keys()].filter((title) => !oldLore.has(title));
    const removed = [...oldLore.keys()].filter((title) => !newLore.has(title));
    const changed = [...newLore.keys()].filter((title) => oldLore.has(title) && oldLore.get(title)?.hash !== newLore.get(title)?.hash);
    if (added.length) changes.push(`로어북 추가 ${added.length}개: ${added.slice(0, 5).join(", ")}${added.length > 5 ? " 외" : ""}`);
    if (removed.length) changes.push(`로어북 제거 ${removed.length}개: ${removed.slice(0, 5).join(", ")}${removed.length > 5 ? " 외" : ""}`);
    if (changed.length) changes.push(`로어북 내용 변경 ${changed.length}개: ${changed.slice(0, 5).join(", ")}${changed.length > 5 ? " 외" : ""}`);
    return {
      title: "캐릭터 카드·로어북 구성이 변경됨",
      explanation: "이미 생성된 기억의 해석 기준이 달라질 수 있어 자동으로 덮어쓰지 않고 검토 대상으로 남겼습니다. Risu 원문은 변경하지 않습니다.",
      changes: changes.length ? changes : ["구성 식별값이 변경됐지만 요약 가능한 항목 차이는 없습니다."],
      allowKeepExisting: false,
    };
  }
  if (item.kind === "assertion" || item.kind === "unattributed_claim") {
    return {
      title: item.kind === "assertion" ? "세계 상태 후보가 기존 사실과 충돌함" : "정본으로 확정되지 않은 새 주장이 들어옴",
      explanation: item.kind === "unattributed_claim"
        ? "보조 모델이 이를 등장인물의 주장으로 분류해 사실로 자동 확정하지 않았습니다. 근거를 확인한 뒤 채택하거나 폐기하세요."
        : "새 후보는 아직 세계 상태 장부에 저장되지 않았습니다. 근거를 확인한 뒤 채택하거나 폐기하세요.",
      changes: [
        `기존 값: ${existing.value ?? "기록 없음"}`,
        `새 후보: ${incoming.subject && incoming.predicate ? `${incoming.subject}.${incoming.predicate} = ` : ""}${incoming.value ?? "알 수 없음"}`,
      ],
      allowKeepExisting: true,
    };
  }
  if (item.kind === "belief_action_target") return {
    title: "인물 인식의 변경 대상을 찾지 못함",
    explanation: "새 인식이 어떤 기존 인식 기록을 강화하거나 대체해야 하는지 확정할 수 없어 자동 반영하지 않았습니다.",
    changes: [
      `관점 인물: ${incoming.holder ?? "알 수 없음"}`,
      `대상: ${incoming.subject ?? "알 수 없음"}`,
      `새 후보: ${incoming.value ?? "알 수 없음"}`,
    ],
    allowKeepExisting: true,
  };
  if (item.kind === "belief_user_override") return {
    title: "사용자가 수정한 인물 인식과 새 후보가 충돌함",
    explanation: "사용자가 직접 고친 인식을 보조 모델의 새 후보로 덮어쓰지 않고 확인 대상으로 남겼습니다.",
    changes: [
      `현재 인식: ${existing.value ?? "기록 없음"}`,
      `새 후보: ${incoming.value ?? "알 수 없음"}`,
    ],
    allowKeepExisting: true,
  };
  if (item.kind === "temporal_boundary_review") return {
    title: "분기 시점의 약속 상태를 확인해야 함",
    explanation: "채팅 분기 시점에 이 약속이 이미 만들어졌는지 확정할 근거가 부족해 자동으로 상속하지 않았습니다.",
    changes: [
      `약속: ${incoming.promisor ?? "미상"} → ${incoming.promisee ?? "미상"}`,
      `내용: ${incoming.content ?? "알 수 없음"}`,
      `기존 상태: ${incoming.status ?? "알 수 없음"}`,
    ],
    allowKeepExisting: false,
  };
  if (item.kind === "source_revision") return {
    title: "근거 원문이 수정되거나 삭제됨",
    explanation: "같은 메시지 ID에서 RCM이 읽은 본문이 달라져, 이전 본문을 근거로 만든 기억을 비활성화했습니다. 직접 편집뿐 아니라 번역 플러그인이 화면 본문과 모델용 본문을 교체할 때도 발생할 수 있습니다.",
    changes: [`영향받은 기억 ${Array.isArray(existing.memoryIds) ? existing.memoryIds.length : 0}개`, `처리 이유: ${incoming.reason ?? "원문 변경"}`],
    allowKeepExisting: false,
  };
  return {
    title: "분류되지 않은 기록 충돌",
    explanation: "기존 데이터와 새 후보가 일치하지 않아 자동 반영하지 않았습니다.",
    changes: [],
    allowKeepExisting: true,
  };
}

export function conflicts(data: DashboardData): string {
  const rows = data.conflicts.map((item) => {
    const view = describeConflict(item);
    const category = conflictCategory(item.kind);
    const assertionConflict = item.kind === "assertion" || item.kind === "unattributed_claim";
    const resolutionLabel = item.resolution === "accept_incoming" || (assertionConflict && item.resolution === "acknowledged")
      ? "새 사실로 채택됨"
      : item.resolution === "keep_existing" ? "후보 폐기됨" : "확인됨";
    const id = String(item.id);
    const actions = item.status === "pending"
      ? assertionConflict
        ? `${btn("후보 폐기", { kind: "quiet", action: "resolve-conflict", data: { id, resolution: "keep_existing" } })}${btn("새 사실로 채택", { kind: "primary", action: "resolve-conflict", data: { id, resolution: "accept_incoming" } })}`
        : `${view.allowKeepExisting ? btn("기존 값 유지", { kind: "secondary", action: "resolve-conflict", data: { id, resolution: "keep_existing" } }) : ""}${btn(item.kind === "static_projection_changed" ? "변경 확인" : "확인 완료", { kind: "primary", action: "resolve-conflict", data: { id, resolution: "acknowledged" } })}`
      : btn("충돌 기록 삭제", { kind: "danger", icon: "delete", action: "delete-conflict", data: { id } });
    return `<article class="conflict"><div class="row__slug"><b>${escapeHtml(category)}</b><span>${item.status === "pending" ? "검토 필요" : escapeHtml(resolutionLabel)} · revision ${item.created_revision} · ${escapeHtml(formatTime(item.created_at))}</span></div><h3 class="conflict__title">${escapeHtml(view.title)}</h3><p class="sub">${escapeHtml(view.explanation)}</p>${view.changes.length ? `<ul class="beats">${view.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>` : ""}${fold("기술 세부정보", `<pre class="packet">existing: ${escapeHtml(item.existing_json)}\nincoming: ${escapeHtml(item.incoming_json)}</pre>`, { role: "section", preserveKey: `conflict-technical:${id}` })}<div class="decide">${actions}</div></article>`;
  }).join("");
  return `${pageHeader("충돌", "원인 없는 덮어쓰기를 막고 사용자 검토 결과를 기록합니다.")}<div class="conflicts">${rows || empty("검토할 충돌이 없습니다", "새 기록이 기존 기록과 어긋나면 여기에 모입니다.")}</div>`;
}

type AttentionItem = { id: string; type: Exclude<AttentionFilter, "all">; title: string; summary: string; time: unknown; value: any; category?: string };

export function attentionPage(data: DashboardData, translations: TranslationView, display: RuntimeState["settings"]["translationDisplay"], view: AttentionViewState): string {
  const audits: AttentionItem[] = data.extractionAudits
    .filter((item) => item.status === "pending_review" || item.status === "failed")
    .map((item) => ({
      id: `audit:${item.id}`, type: "audit", title: item.evidenceReview?.blocking === false ? "일부 발췌 보류 · 기억 처리 계속" : "상태 확인 필요 · 후속 기억 처리 보류",
      summary: `저장된 기억 ${Number(item.evidenceReview?.appliedMemories ?? 0)}개 · 확인할 근거 ${item.evidenceReview?.issues?.length ?? 0}개`,
      time: item.updatedAt, value: item,
    }));
  const duplicates: AttentionItem[] = data.reconciliationReviews.filter((item) => item.status === "pending").map((item) => ({
    id: `duplicate:${item.id}`, type: "duplicate", title: String(item.incoming?.content ?? item.incoming?.value ?? item.itemRef ?? "상태 후보"),
    summary: String(item.decision?.reason || item.error || "사용자가 관리한 기존 상태와 새 관측을 함께 확인해야 합니다."), time: item.createdAt, value: item,
    category: item.itemKind === "world_fact" ? "세계 사실" : item.itemKind === "character_belief" ? "인물의 인식" : item.itemKind === "promise_event" ? "약속" : "상태",
  }));
  const conflictsPending: AttentionItem[] = data.conflicts.filter((item) => item.status === "pending").map((item) => {
    const presentation = describeConflict(item);
    return { id: `conflict:${item.id}`, type: "conflict", title: presentation.title, summary: presentation.explanation, time: item.created_at, value: item, category: conflictCategory(item.kind) };
  });
  const all = [...audits, ...duplicates, ...conflictsPending].sort((left, right) => Number(right.time ?? 0) - Number(left.time ?? 0));
  if (!all.length) return `<div class="attention">${pageHeader("상태 확인", "RCM이 자동으로 바꾸지 않은 상태와 충돌만 모았습니다.")}${empty("확인할 기록이 없습니다", "새로 확인이 필요한 기록이 생기면 여기에 모입니다.")}</div>`;
  const visible = view.filter === "all" ? all : all.filter((item) => item.type === view.filter);
  const selected = visible.find((item) => item.id === view.selectedId) ?? visible[0];
  const labels: Record<AttentionItem["type"], string> = { audit: "재검수", duplicate: "상태 확인", conflict: "충돌" };
  const count = (type: AttentionFilter) => type === "all" ? all.length : all.filter((item) => item.type === type).length;
  const filterBar = filters(([["all", "전체"], ["duplicate", "상태 확인"], ["conflict", "충돌"], ["audit", "재검수"]] as Array<[AttentionFilter, string]>)
    .map(([key, label]) => ({ label, pressed: view.filter === key, count: count(key), action: "attention-filter", data: { filter: key } })), "확인 항목 필터");
  const rows = visible.map((item) => `<button type="button" class="row" data-action="select-attention" data-id="${escapeHtml(item.id)}" data-attention-row${item.id === selected?.id ? ' aria-current="true"' : ""}><div class="row__slug"><b>${escapeHtml(item.category ?? labels[item.type])}</b><span>${escapeHtml(formatRelativeTime(item.time))}</span></div><div class="row__title">${escapeHtml(item.title)}</div><div class="row__sub">${escapeHtml(item.summary)}</div></button>`).join("");
  const back = `<div class="reader__bar"><button type="button" class="back hit" data-action="attention-back">${icon("back")}<span>목록</span></button></div>`;
  const technical = (key: string, body: string) => fold("기술 세부정보", `<pre class="packet">${body}</pre>`, { role: "section", preserveKey: `attention-technical:${key}` });
  let detail = empty("확인이 필요한 항목이 없습니다", "RCM이 스스로 판단하지 못한 기록이 생기면 여기에 모입니다.");
  if (selected?.type === "audit") {
    const item = selected.value, draft = item.draft ?? {};
    const counts = `기억 ${(draft.memories ?? []).length}개 · 상태 후보 ${(draft.stateObservations ?? []).length}개`;
    const ordinals = (item.evidenceReview?.sourceMessages ?? []).map((source: any) => Number(source.ordinal) + 1);
    const sourceRange = ordinals.length ? `${Math.min(...ordinals)}–${Math.max(...ordinals)}번째 메시지` : `${(item.sourceMessageIds ?? []).length}개 메시지`;
    detail = `<article class="reader">${back}<div class="frame__slug"><b>재검수</b></div><h2 class="reader__title">${escapeHtml(selected.title)}</h2><p class="sub">${item.evidenceReview?.blocking === false ? "확인되지 않은 발췌만 제외했습니다. 기억과 후속 처리는 계속 사용할 수 있습니다." : "미해결 후보는 보존되어 있습니다. 마지막 확정 기억으로 대화를 계속할 수 있습니다."}</p>${!item.evidenceReview?.issues?.length && item.error ? notice(`재검수 요청 실패 · ${item.error}`, { tone: "cut" }) : ""}<dl class="kv"><dt>원문 범위</dt><dd>${escapeHtml(sourceRange)}</dd><dt>적용된 기억</dt><dd>${Number(item.evidenceReview?.appliedMemories ?? 0)}개</dd><dt>보존된 초안</dt><dd>${escapeHtml(counts)}</dd><dt>시도</dt><dd>${Number(item.attempts ?? 1)}회</dd></dl>${renderEvidenceIssues(item)}${technical(String(item.id), escapeHtml(JSON.stringify(draft, null, 2)))}<div class="decide">${btn("다시 확인 · 보조 모델 호출", { kind: "primary", icon: "refresh", action: "retry-extraction-audit", data: { id: String(item.id) } })}</div></article>`;
  } else if (selected?.type === "duplicate") {
    const item = selected.value, incoming = item.incoming ?? {};
    const stateKind = item.itemKind === "world_fact" ? "세계 사실" : item.itemKind === "character_belief" ? "인물의 인식" : item.itemKind === "promise_event" ? "약속" : "상태";
    const target = item.candidates.find((candidate: any) => candidate.id === item.decision?.targetId) ?? item.candidates[0];
    const canonical = incoming.content ?? incoming.value ?? incoming.title ?? JSON.stringify(incoming);
    const candidateCopy = target?.value?.content ?? target?.value?.value ?? target?.value?.title ?? "비교할 기존 항목이 없습니다.";
    const incomingTranslation = translations.get(`reconciliation:${item.id}:incoming`), candidateTranslation = translations.get(`reconciliation:${item.id}:candidate`);
    const editFields = item.itemKind === "memory"
      ? `${field({ id: `recon-title-${escapeHtml(item.id)}`, label: "제목", control: `<input id="recon-title-${escapeHtml(item.id)}" class="input" name="canonicalTitle" value="${escapeHtml(incoming.title ?? "")}">` })}${field({ id: `recon-content-${escapeHtml(item.id)}`, label: "내용", control: `<textarea id="recon-content-${escapeHtml(item.id)}" class="textarea" name="canonicalContent">${escapeHtml(incoming.content ?? "")}</textarea>` })}`
      : field({ id: `recon-value-${escapeHtml(item.id)}`, label: "내용", control: `<textarea id="recon-value-${escapeHtml(item.id)}" class="textarea" name="canonicalValue">${escapeHtml(incoming.value ?? incoming.content ?? "")}</textarea>` });
    const id = String(item.id), targetId = String(target?.id ?? "");
    const mergeLabel = item.itemKind === "promise_event" ? "기존 약속에 반영" : "기존 상태에 근거 추가";
    const distinctLabel = item.itemKind === "promise_event" ? "별도 약속으로 보존" : "별도 상태로 보존";
    detail = `<article class="reader">${back}<div class="frame__slug"><b>${stateKind}</b></div><h2 class="reader__title">${escapeHtml(selected.title)}</h2><p class="sub">${escapeHtml(selected.summary)}</p><div class="cmp"><div><div class="lab">지금 기록</div><p>${displayText(String(candidateCopy), candidateTranslation, display)}</p></div><div class="new"><div class="lab">새로 들어온 기록</div><p>${displayText(String(canonical), incomingTranslation, display)}</p></div></div>${fold("새 기록 내용 편집", `<form class="form reconciliation-edit" data-review-id="${escapeHtml(item.id)}">${editFields}<p class="sub">편집한 내용은 아래에서 고른 처리에만 적용됩니다.</p></form>`, { preserveKey: `recon-edit:${id}` })}<div class="decide">${btn(mergeLabel, { kind: "primary", action: "resolve-reconciliation", data: { resolution: "merge", id, targetId }, disabled: !target })}${btn("새 기록으로 바꾸기", { kind: "secondary", action: "resolve-reconciliation", data: { resolution: "update", id, targetId }, disabled: !target })}${btn(distinctLabel, { kind: "secondary", action: "resolve-reconciliation", data: { resolution: "distinct", id } })}${btn("새 기록 버리기", { kind: "danger", action: "resolve-reconciliation", data: { resolution: "discard", id } })}</div></article>`;
  } else if (selected?.type === "conflict") {
    const item = selected.value, presentation = describeConflict(item);
    const assertionConflict = item.kind === "assertion" || item.kind === "unattributed_claim";
    const id = String(item.id);
    const actions = assertionConflict
      ? `${btn("새 사실로 채택", { kind: "primary", action: "resolve-conflict", data: { id, resolution: "accept_incoming" } })}${btn("새 사실 버리기", { kind: "danger", action: "resolve-conflict", data: { id, resolution: "keep_existing" } })}`
      : `${btn(item.kind === "static_projection_changed" ? "변경 확인" : "확인 완료", { kind: "primary", action: "resolve-conflict", data: { id, resolution: "acknowledged" } })}${presentation.allowKeepExisting ? btn("기존 값 유지", { kind: "secondary", action: "resolve-conflict", data: { id, resolution: "keep_existing" } }) : ""}`;
    detail = `<article class="reader">${back}<div class="frame__slug"><b>${escapeHtml(conflictCategory(item.kind))}</b></div><h2 class="reader__title">${escapeHtml(presentation.title)}</h2><p class="sub">${escapeHtml(presentation.explanation)}</p>${presentation.changes.length ? `<h3 class="sec">달라진 내용</h3><ul class="beats">${presentation.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>` : ""}${technical(id, `existing: ${escapeHtml(item.existing_json)}\nincoming: ${escapeHtml(item.incoming_json)}`)}<div class="decide">${actions}</div></article>`;
  }
  const list = `<div class="listcol"><div class="tl-tools"><label class="search">${icon("search")}<span class="sr-only">확인 항목 검색</span><input class="input" type="search" data-action="attention-search" value="${escapeHtml(view.query)}" placeholder="제목과 내용 검색"></label></div>${filterBar}<p class="sub">${visible.length}개</p><div class="tl-rows" data-preserve-scroll="attention-list">${rows || (view.filter === "all" ? empty("확인할 기록이 없습니다", "새로 확인이 필요한 기록이 생기면 여기에 모입니다.") : empty("이 필터에는 확인할 항목이 없습니다", "다른 필터를 골라 보세요."))}<div data-attention-search-empty hidden>${empty("검색 결과가 없습니다", "다른 단어로 찾아보세요.")}</div></div></div>`;
  return `<div class="attention${view.mobileDetail && selected ? " is-detail" : ""}">${pageHeader("상태 확인", "RCM이 자동으로 바꾸지 않은 상태와 충돌만 모았습니다.")}<div class="split">${list}<div class="readercol" data-preserve-scroll="reader:attention:${escapeHtml(selected?.id ?? "")}">${detail}</div></div></div>`;
}

const memoryToolRegistrationLabels = {
  unavailable: "플러그인 통신 API 없음", pending: "등록 확인 중", registered: "등록 확인됨",
  retrying: "등록 미확인 · 대기 중 자동 재시도", paused: "요청 처리 중 · 자동 재등록 대기", disabled: "사용 안 함",
};

export function pluginDiagnosticSummary(state: RuntimeState, data: DashboardData): string {
  // Metadata stays allowlisted; logs contain insertion-sanitized operational text.
  // Raw model/host errors are excluded at their log call sites.
  const version = (value: unknown) => typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value) ? value : "unknown";
  const registration = state.memoryToolRegistration;
  return JSON.stringify({
    pluginVersion: RCM_PLUGIN_VERSION, serverVersion: version(data.health?.version), apiRevision: RCM_API_REVISION,
    serverConnected: data.health?.ok === true, memoryToolsEnabled: state.settings.memoryToolsEnabled,
    providerManager: {
      status: !state.settings.memoryToolsEnabled ? "disabled" : ["registered", "retrying", "unavailable", "disabled", "pending", "paused"].includes(registration?.status ?? "") ? registration!.status : "unknown",
      consecutiveFailures: Number.isSafeInteger(registration?.failures) && registration!.failures >= 0 ? registration!.failures : 0,
    },
    recentLogs: Object.fromEntries(["info", "warn", "error"].map(level => [level, state.logs.filter(log => log.level === level).length])),
    processingEngine: ["risu", "server"].includes(state.settings.extractionEngine) ? state.settings.extractionEngine : "unknown",
    workerPaused: state.settings.workerPaused === true,
    recentErrors: state.logs.flatMap(log => {
      const diagnostic = shareDiagnostic(log.diagnostic);
      return diagnostic ? [{ at: supportTime(log.at), ...diagnostic }] : [];
    }).slice(0, 30),
    failedJobs: supportJobs(data.jobs),
    logs: state.logs.map(log => ({ at: new Date(supportTime(log.at) ?? 0).toISOString(), level: log.level,
      message: sanitizeDiagnosticText(log.message, [state.settings.serverToken], 1000),
      diagnostic: shareDiagnostic(log.diagnostic), reason: diagnosticReason(shareDiagnostic(log.diagnostic)),
      detail: log.detail ? sanitizeDiagnosticText(log.detail, [state.settings.serverToken]) : undefined,
    })),
  }, null, 2);
}

export function operations(state: RuntimeState, data: DashboardData): string {
  const serverMode = state.settings.extractionEngine === "server";
  const chatEnabled = state.current ? isChatMemoryEnabled(state.settings, state.current.chatId) : false;
  const serverWorker = data.health?.serverWorker ?? state.serverWorker;
  const failedCount = data.jobs.filter((job) => job.status === "failed").length;
  const blockingFailed = data.jobs.filter((job) => job.status === "failed" && job.type === "extract").length;
  const queued = data.jobs.filter((job) => ["queued", "leased"].includes(job.status)).length;
  const removableCount = data.jobs.filter((job) => ["queued", "failed"].includes(job.status) || (job.status === "leased" && Number(job.leased_until) < Date.now())).length;
  const jobTypeLabels: Record<string, string> = {
    extract: "대화 기억 정리", extract_episode: "대화 기억 정리", episode: "대화 기억 정리",
    project_relationship: "관계 상태 갱신", relationship_projection: "관계 상태 갱신",
    story_consolidation: "줄거리 갱신", initial_calibration: "초기 인물 설정",
    embed: "검색 색인 갱신", social_knowledge: "지인 관계 정리", social_backfill: "지인 관계 다시 찾기",
    quiz: "퀴즈 만들기",
    audit_retry: "추출 재검수",
    ledger_consistency: "최종 장부 대조",
  };
  const jobStatusLabels: Record<string, string> = { queued: "대기 중", leased: "처리 중", failed: "실패", completed: "완료", done: "완료", cancelled: "취소됨", superseded: "교체됨" };
  const stageLabels: Record<string, string> = { queued: "대기", retrying: "자동 재시도", initial_calibration: "초기 인물 설정", first_extraction: "1차 기억 추출", post_extraction_audit: "추출 재검수", state_reconciliation: "세계·인식·약속 대조", ledger_consistency: "최종 장부 대조", relationship_projection: "관계 상태 투영", story_consolidation: "줄거리 갱신", storing: "기억 반영", complete: "전체 단계 완료", failed: "단계 실패" };
  const callPurposeLabels: Record<string, string> = {
    memory_group: "대화 묶음 나누기", memory_group_repair: "묶음 응답 형식 보완",
    extraction: "대화에서 기억 찾기", extraction_repair: "응답 형식 보완",
    initial_calibration: "초기 인물 설정", initial_calibration_repair: "초기 설정 응답 보완",
    audit: "추출 결과 재검수", audit_repair: "재검수 응답 보완",
    reconciliation: "상태 추출·기존 기억과 대조", reconciliation_repair: "상태 대조·접근 근거 보완", state_response_repair: "상태 응답 형식 보완",
    ledger_consistency: "마지막 장부 대조", ledger_consistency_repair: "장부 응답 형식 보완",
    relationship_projection: "관계 상태 갱신", relationship_projection_repair: "관계 응답 형식 보완",
    story_consolidation: "줄거리 갱신", story_consolidation_repair: "줄거리 응답 형식 보완",
    episode_draft: "장면 기억 초안", episode_draft_repair: "장면 초안 응답 보완",
    episode_finalize: "장면 기억 마무리", episode_finalize_repair: "장면 응답 형식 보완",
  };
  type RawCallDiagnostic = { purpose?: unknown; attempt?: unknown; outcome?: unknown; at?: unknown; error?: unknown; usage?: unknown };
  type OperationCall = {
    purpose: string; attempt: number; startedAt?: number; endedAt?: number;
    outcome: "running" | "succeeded" | "failed" | "interrupted";
    error?: string; usage?: Record<string, unknown>;
  };
  const callDuration = (call: OperationCall): string => {
    if (!call.startedAt) return "";
    const elapsed = Math.max(0, (call.endedAt ?? Date.now()) - call.startedAt);
    if (elapsed < 60_000) return `${Math.max(0.1, elapsed / 1_000).toFixed(1)}초`;
    const minutes = Math.floor(elapsed / 60_000), seconds = Math.floor((elapsed % 60_000) / 1_000);
    return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`;
  };
  const operationCalls = (payload: Record<string, unknown>, status: string, updatedAt: number): OperationCall[] => {
    const diagnostics = Array.isArray(payload.llmCallDiagnostics) ? payload.llmCallDiagnostics as RawCallDiagnostic[] : [];
    const calls: OperationCall[] = [];
    for (const diagnostic of diagnostics) {
      const purpose = String(diagnostic.purpose ?? "unknown"), attempt = Math.max(0, Number(diagnostic.attempt) || 0);
      const at = Number(diagnostic.at), observedAt = Number.isFinite(at) && at > 0 ? at : undefined;
      if (diagnostic.outcome === "started") {
        calls.push({ purpose, attempt, startedAt: observedAt, outcome: "interrupted" });
        continue;
      }
      if (diagnostic.outcome !== "succeeded" && diagnostic.outcome !== "failed") continue;
      const match = calls.findLast((call) => call.purpose === purpose && call.outcome === "interrupted" && (!attempt || !call.attempt || call.attempt === attempt));
      const call = match ?? { purpose, attempt, outcome: "interrupted" as const };
      if (!match) calls.push(call);
      call.endedAt = observedAt;
      call.outcome = diagnostic.outcome;
      if (diagnostic.error) call.error = String(diagnostic.error);
      if (diagnostic.usage && typeof diagnostic.usage === "object" && !Array.isArray(diagnostic.usage)) call.usage = diagnostic.usage as Record<string, unknown>;
    }
    if (status === "leased") {
      const activeCall = calls.findLast((call) => call.outcome === "interrupted");
      if (activeCall) activeCall.outcome = "running";
    }
    calls.forEach((call, index) => {
      if (call.outcome !== "interrupted" || call.endedAt) return;
      call.endedAt = calls.slice(index + 1).find((next) => next.startedAt)?.startedAt
        ?? (Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : undefined);
    });
    return calls;
  };
  const stepIcons: Record<string, string> = { succeeded: "check", failed: "error", running: "clock", interrupted: "inactive" };
  const step = (outcome: string, label: string, stateText: string, detail = "", usage = "") =>
    `<div class="step is-${outcome}">${icon(stepIcons[outcome] ?? "clock")}<div class="step__main"><b>${escapeHtml(label)}</b><span class="sub">${escapeHtml(stateText)}</span>${detail}</div>${usage ? `<span class="step__usage">${escapeHtml(usage)}</span>` : ""}</div>`;
  const callRows = (calls: OperationCall[]) => {
    const seen = new Map<string, number>();
    return calls.map((call) => {
      const occurrence = (seen.get(call.purpose) ?? 0) + 1;
      seen.set(call.purpose, occurrence);
      const baseLabel = callPurposeLabels[call.purpose] ?? String(call.purpose).replaceAll("_", " ");
      const label = occurrence > 1 ? `${baseLabel} 재시도 ${occurrence - 1}` : baseLabel;
      const stateLabel = call.outcome === "succeeded" ? "완료" : call.outcome === "failed" ? "실패" : call.outcome === "running" ? "진행 중" : "중단됨";
      const input = Number(call.usage?.promptTokens ?? call.usage?.inputTokens), output = Number(call.usage?.completionTokens ?? call.usage?.outputTokens);
      const cached = Number(call.usage?.cachedInputTokens ?? call.usage?.cachedTokens ?? call.usage?.cacheReadInputTokens);
      const usageLine = [Number.isFinite(input) ? `입력 ${input.toLocaleString()}` : "", Number.isFinite(output) ? `출력 ${output.toLocaleString()}` : "", Number.isFinite(cached) && cached > 0 ? `캐시 ${cached.toLocaleString()}` : ""].filter(Boolean).join(" · ");
      const detail = call.error ? `<p class="step__err">${escapeHtml(call.error)}</p>` : call.outcome === "interrupted" ? '<p class="sub">완료 응답 없이 작업이 다시 시작됐습니다.</p>' : "";
      return step(call.outcome, label, `${stateLabel}${callDuration(call) ? ` · ${callDuration(call)}` : ""}`, detail, usageLine || "토큰 사용량 미제공");
    }).join("");
  };
  const jobRow = (job: any) => {
    const payload = parseJson<Record<string, unknown>>(job.payload_json, {});
    const sourceRecovery = payload.sourceRecovery === true;
    const stage = String(payload.pipelineStage ?? (job.status === "queued" ? "queued" : ""));
    const stageLabel = sourceRecovery && stage === "post_extraction_audit" ? "원문 발췌 보완" : stageLabels[stage];
    const callStats = payload.llmCallStats as { total?: number; repairs?: number } | undefined;
    const usage = payload.llmUsage as { inputTokens?: number; outputTokens?: number; callsWithUsage?: number } | undefined;
    const calls = operationCalls(payload, job.status, Number(job.updated_at));
    const totalCalls = Math.max(Number(callStats?.total ?? 0), calls.length);
    const retryAttempt = Math.max(0, Number(payload.pipelineRetryAttempt ?? 0));
    const summary = [retryAttempt ? `재시도 ${retryAttempt}회` : "", totalCalls ? `호출 ${totalCalls}회` : "",
      Number(usage?.callsWithUsage ?? 0) > 0 ? `입력 ${Number(usage!.inputTokens ?? 0).toLocaleString()} · 출력 ${Number(usage!.outputTokens ?? 0).toLocaleString()}토큰` : totalCalls ? "토큰 사용량 미제공" : "",
      !["done", "completed", "cancelled", "superseded"].includes(job.status) && stageLabel ? `현재 ${stageLabel}` : ""].filter(Boolean).join(" · ");
    const ordinal = Number(payload.operationStageOrdinal ?? 0), total = Number(payload.operationStageTotal ?? 0);
    const title = `${sourceRecovery ? "원문 발췌 보완" : jobTypeLabels[job.type] ?? String(job.type)}${ordinal > 0 && total > 1 ? ` ${ordinal}/${total}` : ""}`;
    const statusKey = job.status === "leased" && stage === "retrying" ? "retrying" : job.status;
    const statusLabel = statusKey === "retrying" ? "재시도" : jobStatusLabels[job.status] ?? job.status;
    const terminalState = ["cancelled", "superseded"].includes(job.status);
    const fallbackStep = (!calls.length || terminalState) ? step(job.status === "failed" ? "failed" : ["done", "completed"].includes(job.status) ? "succeeded" : "running", stageLabel ?? title, statusLabel, job.status === "failed" && job.last_error ? `<p class="step__err">${escapeHtml(job.last_error)}</p>` : "") : "";
    const stored = ["done", "completed"].includes(job.status) && (stage === "complete" || ["extract", "extract_episode", "episode", "audit_retry"].includes(job.type))
      ? step("succeeded", "기억 저장", "정리 결과 반영 완료") : "";
    const recentNote = totalCalls > calls.length && calls.length ? `<p class="sub">전체 ${totalCalls}회 중 최근 ${calls.length}회의 세부 기록을 표시합니다.</p>` : "";
    const errorCopy = job.status === "failed" && job.last_error && calls.every((call) => call.error !== job.last_error) ? `<p class="step__err">${escapeHtml(job.last_error)}</p>` : "";
    const active = ["queued", "leased", "failed"].includes(job.status);
    const jobIcon = job.status === "failed" ? "error" : job.status === "queued" ? "ring" : "clock";
    const rowDetail = job.status === "failed" ? job.last_error || "실패 원인을 확인해 주세요" : job.status === "leased" ? stageLabel || "기억 처리 중" : "";
    const terminalTag = terminalState ? `<span class="job__status is-${escapeHtml(statusKey)}">${escapeHtml(statusLabel)}</span>` : "";
    return `<details class="fold job${active ? "" : " job--history"} is-${escapeHtml(statusKey)}" data-preserve-open="operation-job-${escapeHtml(job.id ?? `${job.type}-${job.updated_at}`)}"><summary>${active ? `<span class="job__state" role="img" aria-label="${escapeHtml(statusLabel)}">${icon(jobIcon)}</span>` : ""}<span class="job__title"><span class="job__name">${escapeHtml(title)}${terminalTag}</span>${rowDetail ? `<small>${escapeHtml(rowDetail)}</small>` : ""}</span><span class="job__time">${escapeHtml(formatRelativeTime(job.updated_at))}</span><span class="chev" aria-hidden="true">${icon("chevron")}</span></summary><div class="fold__body">${summary ? `<p class="sub">${escapeHtml(summary)}</p>` : ""}<p class="sub">단계별 기록 · ${calls.length ? `${calls.length}개 호출` : "현재 상태"}</p>${callRows(calls)}${fallbackStep}${stored}${recentNote}${errorCopy}</div></details>`;
  };
  const isUnresolvedJob = (job: any): boolean => ["queued", "leased", "failed"].includes(job.status);
  const currentRunId = data.coldStartProgress?.acknowledged ? undefined : data.coldStartProgress?.backfillRunId;
  const currentJobs = currentRunId ? data.jobs.filter((job) => isUnresolvedJob(job) && parseJson<Record<string, unknown>>(job.payload_json, {}).backfillRunId === currentRunId) : [];
  const stageOrder: Record<string, number> = { initial_calibration: 0, extraction: 1, ledger_consistency: 2, relationship_projection: 3, story_consolidation: 4 };
  currentJobs.sort((left, right) => {
    const leftPayload = parseJson<Record<string, unknown>>(left.payload_json, {}), rightPayload = parseJson<Record<string, unknown>>(right.payload_json, {});
    return (stageOrder[String(leftPayload.operationStage ?? "")] ?? 9) - (stageOrder[String(rightPayload.operationStage ?? "")] ?? 9)
      || Number(leftPayload.operationStageOrdinal ?? 0) - Number(rightPayload.operationStageOrdinal ?? 0)
      || Number(left.created_at) - Number(right.created_at);
  });
  const historyJobs = data.jobs.filter((job) => !currentJobs.includes(job)).sort((left, right) => Number(right.updated_at) - Number(left.updated_at));
  const unresolvedJobs = [...currentJobs, ...historyJobs.filter(isUnresolvedJob)];
  const completedJobs = historyJobs.filter((job) => !isUnresolvedJob(job));
  const jobKind = (job: any): string => parseJson<Record<string, unknown>>(job.payload_json, {}).sourceRecovery === true ? "원문 발췌 보완" : jobTypeLabels[job.type] ?? String(job.type);
  const byKind = (jobs: any[]): Map<string, any[]> => {
    const groups = new Map<string, any[]>();
    for (const job of jobs) {
      const kind = jobKind(job);
      const group = groups.get(kind) ?? [];
      group.push(job);
      groups.set(kind, group);
    }
    return groups;
  };
  const kindTitle = (kind: string, jobs: any[]): string => {
    const ordinals = jobs.map((job) => Number(parseJson<Record<string, unknown>>(job.payload_json, {}).operationStageOrdinal ?? 0)).filter((ordinal) => ordinal > 0);
    if (!ordinals.length) return kind;
    const first = Math.min(...ordinals), last = Math.max(...ordinals);
    return `${kind} ${first === last ? first : `${first}–${last}`}`;
  };
  const clockTime = (at: number): string => Number.isFinite(at) && at > 0 ? new Date(at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }) : "시간 없음";
  const clockRange = (startAt: number, endAt: number): string => {
    const dated = startAt > 0 && endAt > 0 && new Date(startAt).toDateString() !== new Date(endAt).toDateString();
    const label = (at: number): string => {
      const date = new Date(at);
      return dated ? `${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")} ${clockTime(at)}` : clockTime(at);
    };
    const start = label(startAt), end = label(endAt);
    return start === end ? end : `${start} – ${end}`;
  };
  const jobGroup = (title: string, meta: string, time: string, body: string, key: string, queued = false): string =>
    `<details class="fold job-group${queued ? " is-queued" : ""}" data-preserve-open="${escapeHtml(key)}"><summary>${queued ? `<span class="job__state" role="img" aria-label="대기 중">${icon("ring")}</span>` : ""}<span class="job__title"><span class="job__name">${escapeHtml(title)}</span>${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</span>${time ? `<span class="job__time">${escapeHtml(time)}</span>` : ""}<span class="chev" aria-hidden="true">${icon("chevron")}</span></summary><div class="fold__body">${body}</div></details>`;
  const queuedJobs = unresolvedJobs.filter((job) => job.status === "queued");
  const queue = queuedJobs.length ? jobGroup(`대기 ${queuedJobs.length}건`, [...byKind(queuedJobs)].map(([kind, jobs]) => kindTitle(kind, jobs)).join(" · "), "", queuedJobs.map(jobRow).join(""), "operation-queue", true) : "";
  const visibleCurrent = `${unresolvedJobs.filter((job) => job.status === "leased").map(jobRow).join("")}${unresolvedJobs.filter((job) => job.status === "failed").map(jobRow).join("")}${queue}`;
  const phone = lex().skin === "phone";
  const monthDay = (at: number): string => { const date = new Date(at); return `${date.getMonth() + 1}월 ${date.getDate()}일`; };
  // A run's label carries its date unless it finished today.
  const runWhen = (at: number): string => new Date(at).toDateString() === new Date().toDateString() ? clockTime(at) : `${monthDay(at)} ${clockTime(at)}`;
  const runs = new Map<string, { title: string; jobs: any[] }>();
  for (const job of completedJobs) {
    const runId = parseJson<Record<string, unknown>>(job.payload_json, {}).backfillRunId;
    const date = new Date(Number(job.updated_at)).toLocaleDateString("ko-KR");
    const key = runId ? `run:${runId}` : `day:${date}`;
    const group = runs.get(key) ?? { title: runId ? "과거 대화 기억 생성" : phone ? "기억 처리" : `기억 처리 · ${monthDay(Number(job.updated_at))}`, jobs: [] };
    group.jobs.push(job);
    runs.set(key, group);
  }
  const countLabels: Record<string, string> = { "대화 기억 정리": "기억 정리", "줄거리 갱신": "줄거리", "관계 상태 갱신": "관계", "최종 장부 대조": "장부 대조", "퀴즈 만들기": "퀴즈" };
  const older = [...runs].map(([key, group]) => {
    const kinds = [...byKind(group.jobs)];
    const runTime = clockTime(Math.max(...group.jobs.map((job) => Number(job.updated_at))));
    if (phone) {
      // The run is the section label; a kind with one job opens straight to its steps.
      const rows = kinds.map(([kind, jobs]) => {
        jobs.sort((left, right) => Number(parseJson<Record<string, unknown>>(left.payload_json, {}).operationStageOrdinal ?? 0) - Number(parseJson<Record<string, unknown>>(right.payload_json, {}).operationStageOrdinal ?? 0) || Number(left.updated_at) - Number(right.updated_at));
        if (jobs.length === 1) return jobRow(jobs[0]);
        const startAt = Math.min(...jobs.map((job) => Number(job.created_at ?? job.updated_at)));
        const endAt = Math.max(...jobs.map((job) => Number(job.updated_at)));
        return jobGroup(kind, `${jobs.length}건 · ${clockRange(startAt, endAt)}`, "", jobs.map(jobRow).join(""), `operation-kind:${key}:${kind}`);
      }).join("");
      return `<section class="oprun"><h2 class="sec">${escapeHtml(group.title)} <span class="n">${escapeHtml(runWhen(Math.max(...group.jobs.map((job) => Number(job.updated_at)))))}</span></h2><div class="jobs jobs--grouped">${rows}</div></section>`;
    }
    const meta = kinds.map(([kind, jobs]) => `${countLabels[kind] ?? kind} ${jobs.length}`).join(" · ");
    const body = kinds.map(([kind, jobs]) => {
      jobs.sort((left, right) => Number(parseJson<Record<string, unknown>>(left.payload_json, {}).operationStageOrdinal ?? 0) - Number(parseJson<Record<string, unknown>>(right.payload_json, {}).operationStageOrdinal ?? 0) || Number(left.updated_at) - Number(right.updated_at));
      const startAt = Math.min(...jobs.map((job) => Number(job.created_at ?? job.updated_at)));
      const endAt = Math.max(...jobs.map((job) => Number(job.updated_at)));
      return jobGroup(kindTitle(kind, jobs), "", clockRange(startAt, endAt), jobs.map(jobRow).join(""), `operation-kind:${key}:${kind}`);
    }).join("");
    return jobGroup(group.title, meta, runTime, body, `operation-run:${key}`);
  }).join("");
  const jobs = `${visibleCurrent ? `<section><h2 class="sec">작업</h2><div class="jobs">${visibleCurrent}</div></section>` : ""}${older ? phone ? `<div data-preserve-scroll="operation-history">${older}</div>` : `<section data-preserve-scroll="operation-history"><h2 class="sec">완료</h2><div class="jobs">${older}</div></section>` : ""}`;
  const logs = state.logs.map((log) => `<li class="entry"><span class="entry__k">${escapeHtml(log.level)}</span><div class="entry__v">${escapeHtml(log.message)}${log.level !== "info" && (log.diagnostic || log.detail) ? `<small class="diagnostic-reason">${escapeHtml([diagnosticReason(log.diagnostic), log.detail].filter(Boolean).join(" · "))}</small>` : ""}<small>${escapeHtml(formatTime(log.at))}</small></div></li>`).join("");
  const workerAction = state.settings.workerPaused
    ? btn("처리 재개", { kind: "primary", action: "resume-worker" })
    : btn(serverMode ? "즉시 일시정지" : "현재 호출 후 일시정지", { kind: "secondary", action: "pause-worker" });
  const drainAction = !serverMode && !state.settings.workerPaused && !state.workerBusy && data.jobs.some((job) => job.status === "queued")
    ? btn("지금 처리", { kind: "primary", action: "drain-worker" })
    : "";
  const workerState = serverMode
    ? serverWorker?.state === "running"
      ? `서버 처리 중 · 활성 호출 ${serverWorker.activeCalls}개${serverWorker.controlLeaseUntil ? ` · 제어권 ${formatTime(serverWorker.controlLeaseUntil)}까지` : ""}`
      : serverWorker?.state === "faulted" ? `서버 오류로 중단 · ${serverWorker.lastError ?? "원인 미상"}`
        : state.settings.workerPaused ? "서버 일시정지됨 — 진행 중 HTTP 요청을 취소하고 새 호출을 시작하지 않습니다."
          : "서버 대기 중 · Risu 제어권이 유지되는 동안만 대기열을 처리합니다."
    : state.currentJob
    ? `진행 중 · 시도 ${state.currentJob.attempt}/3 · ${state.currentJob.sourceMessageCount}개 메시지 · ${formatTime(state.currentJob.startedAt)}`
    : state.settings.workerPaused ? "일시정지됨 — 명시적으로 재개할 때까지 LLM 작업을 lease하지 않습니다." : state.workerBusy ? "다음 작업을 확인하는 중" : "대기 중";
  const menuItems: MenuItem[] = [
    ...(data.cancelledMessages ? [{ label: `취소 원문 ${data.cancelledMessages}건 복구`, icon: "refresh", action: "restore-cancelled", disabled: !chatEnabled }] : []),
  ];
  const completedCount = data.jobs.filter((job) => ["done", "completed", "cancelled", "superseded"].includes(job.status)).length;
  const activeJobCount = data.jobs.filter(isUnresolvedJob).length;
  if (completedCount) menuItems.push({ label: `완료 기록 ${completedCount}건 정리`, icon: "check", action: "clear-completed-jobs" });
  if (removableCount) menuItems.push({ label: `대기열 ${removableCount}건 삭제`, icon: "delete", action: "delete-queue", danger: true });
  const serverUnavailable = !data.health?.ok;
  const modelMissing = !serverUnavailable && auxiliaryModelMissing({ ...state, serverWorker });
  const embeddingMissing = !serverUnavailable && data.health?.embedding?.configured === false;
  const workerFaulted = serverMode && serverWorker?.state === "faulted";
  const stalled = blockingFailed > 0 && !state.settings.workerPaused && !serverUnavailable && !workerFaulted;
  const operationTone = serverUnavailable ? "is-error" : modelMissing ? "is-paused" : state.settings.workerPaused ? "is-paused" : workerFaulted || stalled ? "is-error" : (serverMode ? serverWorker?.state === "running" : state.workerBusy) ? "is-running" : "is-idle";
  const operationTitle = serverUnavailable ? "서버 연결 확인 필요" : modelMissing ? "설정 필요" : state.settings.workerPaused ? "일시정지됨" : workerFaulted ? "처리 오류" : stalled ? "멈춤" : (serverMode ? serverWorker?.state === "running" : state.workerBusy) ? "기억 처리 중" : "정상 작동";
  const operationCopy = serverUnavailable ? (data.error || "RCM 서버 상태를 확인할 수 없습니다.") : modelMissing ? MODEL_SETUP_DETAIL : stalled ? `실패한 작업 ${failedCount}건 때문에 뒤의 ${queued}건이 기다리고 있어요.` : workerState;
  const progress = data.coldStartProgress;
  const retryAction = failedCount ? btn(`실패 ${failedCount}건 다시 시도`, { kind: "primary", action: "retry-failed", disabled: !chatEnabled }) : "";
  const pageActions = `${workerAction}${drainAction}${retryAction}${menuItems.length ? menu({ label: "처리 작업", items: menuItems }) : ""}`;
  // Acknowledgement is the durable dismissal boundary for one finished backfill run.
  // Completed jobs may later be archived from the operation ledger; that must not
  // resurrect an already dismissed card if an older server reports partial counts.
  const progressActive = Boolean(progress?.backfillRunId && (!progress.acknowledged || !progress.runComplete));
  const phaseStatus = (label: string, stateLabel: string, tone: "wait" | "run" | "done" | "warn") => `<dt>${label}</dt><dd class="is-${tone}">${stateLabel}</dd>`;
  const extractionState = progress && progress.failedGroups > 0 ? ["일부 실패", "warn"] as const : progress && progress.processedGroups >= progress.totalGroups ? ["완료", "done"] as const : ["진행", "run"] as const;
  const ledgerState = (progress?.ledgerFailed ?? 0) > 0 && !progress?.downstreamWaiting ? ["일부 실패", "warn"] as const : progress?.downstreamWaiting
    ? ((progress.ledgerTotal ?? 0) > 0 ? [`${progress.ledgerProcessed ?? 0}/${progress.ledgerTotal}`, "run"] as const : ["대기", "wait"] as const)
    : (progress?.ledgerTotal ?? 0) > 0 ? [(progress!.ledgerProcessed ?? 0) >= progress!.ledgerTotal! ? "완료" : `${progress!.ledgerProcessed ?? 0}/${progress!.ledgerTotal}`, (progress!.ledgerProcessed ?? 0) >= progress!.ledgerTotal! ? "done" : "run"] as const : ["대기", "wait"] as const;
  const relationshipState = progress?.downstreamWaiting ? ["대기", "wait"] as const : (progress?.relationshipFailed ?? 0) > 0 ? [`${progress?.relationshipProcessed ?? 0}/${progress?.relationshipTotal ?? 0} · 일부 실패`, "warn"] as const : progress && progress.pendingRelationshipPairs + progress.pendingRelationshipProjectionJobs > 0 ? [`${progress.relationshipProcessed ?? 0}/${progress.relationshipTotal ?? 0} · 진행`, "run"] as const : ["완료", "done"] as const;
  const storyState = progress?.downstreamWaiting ? ["대기", "wait"] as const : (progress?.storyFailed ?? 0) > 0 ? [`${progress?.storyProcessed ?? 0}/${progress?.storyTotal ?? 0} · 일부 실패`, "warn"] as const : (progress?.storyPending ?? 0) > 0 ? [`${progress?.storyProcessed ?? 0}/${progress?.storyTotal ?? 0} · 진행`, "run"] as const : ["완료", "done"] as const;
  const retryStatus = progress?.retryAttempt ? ` · 재시도 ${progress.retryAttempt}/${progress.retryMax ?? 3}` : "";
  const advisoryCount = (progress?.ledgerFailed ?? 0) + (progress?.relationshipFailed ?? 0) + (progress?.storyFailed ?? 0);
  const terminal = Boolean(progress?.runComplete);
  const panelTone = terminal ? advisoryCount > 0 || (progress?.failedGroups ?? 0) > 0 ? "warn" : "done" : "run";
  const callSummary = `보조 모델 호출 총 ${progress?.llmCalls ?? 0}회${(progress?.repairCalls ?? 0) > 0 ? ` (보완 ${progress!.repairCalls}회 포함)` : ""}`;
  const progressPercent = progress && progress.totalGroups > 0 ? Math.min(100, Math.round(progress.processedGroups / progress.totalGroups * 100)) : 0;
  const progressPanel = progressActive ? `<section class="progress is-${panelTone}"><h3 class="sec">${terminal ? `과거 대화 기억 생성 완료${advisoryCount > 0 || progress!.failedGroups > 0 ? " · 일부 정리 필요" : ""}` : "과거 대화 기억 생성"}</h3><div class="progress__card"><div class="meter" role="img" aria-label="대화 기억 정리 ${progress!.processedGroups} / ${progress!.totalGroups}"><span>대화 기억 정리</span><i style="--v:${progressPercent}%"></i><span>${progress!.processedGroups}/${progress!.totalGroups}</span></div><p class="sub">${progress!.activeStage && stageLabels[progress!.activeStage] ? `현재: ${escapeHtml(stageLabels[progress!.activeStage]!)} · ` : ""}${escapeHtml(retryStatus.replace(/^ · /, ""))}${retryStatus ? " · " : ""}${callSummary}</p><dl class="kv phases">${phaseStatus("대화 기억 정리", `${progress!.processedGroups}/${progress!.totalGroups} · ${extractionState[0]}`, extractionState[1])}${phaseStatus("마지막 장부 대조", ledgerState[0], ledgerState[1])}${phaseStatus("관계 상태", relationshipState[0], relationshipState[1])}${phaseStatus("줄거리", storyState[0], storyState[1])}<dt>기억 / 세부</dt><dd>${progress!.memories} / ${progress!.details}</dd><dt>최종 실패</dt><dd>${progress!.failedGroups + advisoryCount}</dd></dl>${terminal && !progress!.acknowledged ? `<div class="decide">${advisoryCount > 0 || progress!.failedGroups > 0 ? btn("실패 작업 다시 시도", { kind: "secondary", action: "retry-failed" }) : ""}${btn("확인", { kind: "primary", action: "acknowledge-backfill", data: { runId: String(progress!.backfillRunId) } })}</div>` : ""}</div></section>` : "";
  const stateTone = operationTone === "is-error" ? "bad" : operationTone === "is-idle" ? "ok" : "wait";
  return `<div class="operations" data-preserve-scroll="operations-page">${pageHeader("처리 상태", "기억 처리와 실패한 작업을 확인합니다.", pageActions)}
    ${state.episodeActivity?.status === "holding" ? homeMessage({ title: "이전 수동 보류가 남아 있습니다", bodyHtml: '<p>기억 정리에서 보류를 해제할 수 있습니다. 이미 처리된 기억은 그대로 유지됩니다.</p>', actionsHtml: btn("기억 정리 열기", { kind: "secondary", action: "organization-open" }), tone: "warning" }) : ""}
    ${workerAttentionNotice(state)}
    ${progressPanel}
    <div class="opstate">${statusList([{ tone: stateTone, text: operationTitle }])}<p class="sub">${escapeHtml(operationCopy)}</p>${modelMissing ? btn("모델 설정 열기", { kind: "quiet", action: "tab", data: { tab: "settings", settingsSection: "model" } }) : ""}${embeddingMissing ? `<p class="sub">${EMBEDDING_SETUP_DETAIL}</p>${btn("검색 임베딩 설정 열기", { kind: "quiet", action: "embedding-settings" })}` : ""}<span class="n">${activeJobCount ? `진행 ${activeJobCount}개` : completedCount ? `완료 기록 ${completedCount}개` : "대기열 비어 있음"}</span></div>
    ${jobs || empty(data.jobsError ? "작업 목록을 확인할 수 없습니다" : "처리할 작업이 없습니다", data.jobsError ? "서버 연결을 확인해 주세요." : "새 대화가 모이면 여기에 작업이 쌓입니다.")}
    ${state.settings.translationProvider !== "google" ? `<section><h3 class="sec">참고 번역</h3><div class="opstate">${statusList([{ tone: state.translationStats?.lastError ? "bad" : "ok", text: `호출 ${state.translationStats?.calls ?? 0}회 · 번역 ${state.translationStats?.items ?? 0}개 · ${state.translationStats?.tokens === undefined ? "토큰 미제공" : `${state.translationStats.tokens.toLocaleString()}토큰`}` }])}<p class="sub">이 실행 세션 기준${state.translationStats?.lastError ? ` · 마지막 오류: ${escapeHtml(state.translationStats.lastError)}` : ""}</p></div></section>` : ""}
    ${fold("고급 진단 · 이 기기의 플러그인 기록", `<section><h3 class="sec">현재 상태</h3><ul class="entries"><li class="entry"><span class="entry__k">도구 연결</span><div class="entry__v">Provider Manager · ${!state.settings.memoryToolsEnabled ? memoryToolRegistrationLabels.disabled : state.memoryToolRegistration ? memoryToolRegistrationLabels[state.memoryToolRegistration.status] : "등록 상태 확인 전"}</div></li></ul></section><section><div class="diagnostic-heading"><h3 class="sec">플러그인 기록</h3>${state.logs.length ? `<div class="diagnostic-actions"><button type="button" class="iconbtn hit" data-action="copy-plugin-diagnostics" aria-label="진단 정보 복사" title="버전·연결 상태·기록 전체를 복사합니다. 키·주소·채팅 내용은 제외합니다.">${icon("copy")}</button><button type="button" class="iconbtn hit" data-action="clear-plugin-logs" aria-label="기록 비우기">${icon("delete")}</button></div>` : ""}</div><ul class="entries">${logs || '<li class="entry"><div class="entry__v">런타임 로그가 없습니다.</div></li>'}</ul></section>`, { role: "section", preserveKey: "operations-diagnostics" })}</div>`;
}

export function acknowledgeBackfillLocally(data: DashboardData, runId: string): boolean {
  if (!data.coldStartProgress || data.coldStartProgress.backfillRunId !== runId) return false;
  data.coldStartProgress.acknowledged = true;
  return true;
}

const normalizeBotName = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

export async function readHostChatInventory(): Promise<HostChatInventoryItem[]> {
  const database = await risuai.getDatabase(["characters"]);
  if (!database || !("characters" in database)) throw new Error("Risu 채팅 목록 권한을 사용할 수 없습니다");
  const raw = database?.characters;
  const characters = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
  const items: HostChatInventoryItem[] = [];
  for (const [index, character] of characters.entries()) {
    if (!character || typeof character !== "object") continue;
    const characterId = String((character as any).chaId ?? (character as any).id ?? index);
    const characterName = String((character as any).name ?? characterId).trim() || characterId;
    const chats = Array.isArray((character as any).chats) ? (character as any).chats : [];
    for (const [chatIndex, chat] of chats.entries()) {
      if (!chat || typeof chat !== "object") continue;
      const chatId = String(chat.id ?? `${characterId}:${chatIndex}`);
      let messageCount = Array.isArray((chat as any).message) ? (chat as any).message.length : 0;
      if (!messageCount) {
        try {
          const full = await risuai.getChatFromIndex(index, chatIndex);
          messageCount = Array.isArray(full?.message) ? full.message.length : 0;
        } catch { /* explicit inventory remains useful even when one chat body is unavailable */ }
      }
      items.push({ characterId, characterName, chatId, chatTitle: String(chat.name ?? chat.title ?? "").trim() || `채팅 ${chatIndex + 1}`, messageCount });
    }
  }
  return items;
}

function confirmationPanel(chat: any, confirmation?: DataConfirmation): string {
  if (!confirmation || confirmation.chatId !== chat.id) return "";
  const action = confirmation.action;
  const chatId = String(chat.id);
  const title = action === "rebuild" ? "원문 장부에서 다시 만들까요?" : "RCM 기록을 완전히 삭제할까요?";
  const detail = action === "rebuild"
      ? `파생 데이터를 비운 뒤 서버에 보존된 /del 이전 원문 ${Number(chat.clientPrunedMessages ?? 0).toLocaleString()}개를 포함해 다시 만듭니다.${chat.pendingMemoryLanguage ? ` 기억 정본 언어도 ${String(chat.pendingMemoryLanguage).toUpperCase()}로 적용됩니다.` : ""}`
      : `원문 ${Number(chat.messages ?? 0).toLocaleString()}개, 기억 ${Number(chat.memories ?? 0).toLocaleString()}개와 계보 대응표를 제거합니다. RCM ZIP 백업 외에는 복구할 수 없습니다.`;
  const check = action === "delete" ? `<label class="check"><input type="checkbox" data-action="ack-delete" data-chat-id="${escapeHtml(chatId)}"${confirmation.acknowledged ? " checked" : ""}><span>RCM 원문 장부도 삭제됨을 이해했습니다</span></label>` : "";
  const buttons = `${btn("취소", { kind: "quiet", action: "cancel-data-operation" })}${action === "delete" ? btn("먼저 ZIP 백업", { kind: "secondary", icon: "download", action: "export-chat-backup", data: { chatId } }) : ""}${btn(action === "rebuild" ? "다시 만들기 시작" : "RCM 기록 삭제", { kind: action === "delete" ? "danger-solid" : "primary", action: "confirm-data-operation", data: { operation: action, chatId }, disabled: action === "delete" && !confirmation.acknowledged })}`;
  return `<div class="confirm${action === "delete" ? " is-danger" : ""}" role="alert"><b>${title}</b><p class="sub">${escapeHtml(detail)}</p>${check}<div class="decide">${buttons}</div></div>`;
}

function sourceLedgerTable(inspector: ServerInspector): string {
  const ledger = inspector.ledger;
  if (!ledger) return '<p class="sub">원문 장부 요약을 불러오는 중입니다.</p>';
  const rows = ledger.items.map((item) => `<tr><td>${Number(item.ordinal)}</td><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.lifecycle)}</td><td>${escapeHtml(item.host_visibility)}</td><td>${escapeHtml(item.extraction_state)}</td><td>${formatTime(item.event_time)}</td><td>${Number(item.content_bytes ?? 0).toLocaleString()}</td>${ledger.includesContent ? `<td class="srclog__content">${escapeHtml(item.content ?? "(본문 정리됨)")}</td>` : ""}</tr>`).join("");
  const previous = Math.max(0, ledger.offset - ledger.limit);
  const next = ledger.offset + ledger.limit;
  return `<div class="srclog__bar"><span class="sub">${ledger.offset + 1}–${Math.min(ledger.total, next)} / ${ledger.total}</span>${btn("이전", { kind: "quiet", icon: "back", action: "ledger-page", data: { offset: String(previous) }, disabled: ledger.offset === 0 })}${btn("다음", { kind: "quiet", iconEnd: "chevron", action: "ledger-page", data: { offset: String(next) }, disabled: next >= ledger.total })}</div><div class="tablewrap"><table class="table"><thead><tr><th>#</th><th>Role</th><th>Lifecycle</th><th>Visibility</th><th>Extraction</th><th>Time</th><th>Chars</th>${ledger.includesContent ? "<th>원문</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>${ledger.includesContent ? notice("원문은 이 화면에만 표시됩니다. 공유 화면이나 캡처에 포함되지 않도록 주의하세요.") : `<p class="sub">기본 보기에는 원문 본문을 전송하지 않습니다. 개인정보가 포함될 수 있습니다.</p>${btn("원문 내용 표시", { kind: "secondary", action: "reveal-ledger-content" })}`}`;
}

function serverInspectorView(data: DashboardData, inspector: ServerInspector | undefined, translations: TranslationView, display: RuntimeState["settings"]["translationDisplay"]): string {
  if (!inspector) return "";
  const chat = data.adminChats.find((item) => item.id === inspector.chatId);
  const effectiveDisplay: TranslationDisplay = chat?.memoryLanguage === "ko" ? "en" : display;
  const head = `<div class="inspector__head"><h2 class="sec">기록 보기 <span class="n">${escapeHtml(chat?.chatTitle || inspector.chatId)} · 읽기 전용</span></h2>${btn("닫기", { kind: "quiet", icon: "close", action: "close-server-inspector" })}</div>`;
  if (inspector.loading) return `<section class="inspector">${head}<p class="sub">불러오는 중입니다.</p></section>`;
  if (inspector.error) return `<section class="inspector">${head}${notice(inspector.error, { tone: "cut" })}</section>`;
  const memoryRows = inspector.memories.map((item) => {
    const title = displayText(String(item.title ?? ""), translations.get(`${item.id}:title`), effectiveDisplay);
    const content = displayText(String(item.content ?? ""), translations.get(`${item.id}:content`), effectiveDisplay);
    return `<details class="fold"><summary><span>${title}</span></summary><div class="fold__body"><p class="rec">${content}</p></div></details>`;
  }).join("") || '<p class="sub">기억이 없습니다.</p>';
  const relationshipRows = inspector.relationships.map((item) => `<tr><td>${escapeHtml(relationshipFrom(item))} → ${escapeHtml(relationshipTo(item))}</td><td>${["affection","trust","intimacy","fear","jealousy","hostility"].map((axis) => `${axis} ${relationshipAxisText(item, axis)}`).join(" · ")}</td></tr>`).join("");
  const worldRows = [
    ...inspector.assertions.map((item) => ["Fact", `${item.subject}.${item.predicate} = ${item.value}`]),
    ...inspector.beliefs.map((item) => ["Belief", `${item.holder}: ${item.subject}.${item.predicate} = ${item.value}`]),
    ...inspector.promises.map((item) => ["Promise", `${item.promisor} → ${item.promisee}: ${item.content} (${item.status})`]),
  ].map(([kind, value]) => `<tr><td>${kind}</td><td>${escapeHtml(value)}</td></tr>`).join("");
  const ledger = data.health?.capabilities?.sourceLedgerInspection ? sourceLedgerTable(inspector) : '<p class="sub">원문 장부 열람은 API 12 서버 업데이트가 필요합니다.</p>';
  return `<section class="inspector">${head}<h3 class="subhead">Memories</h3>${memoryRows}<h3 class="subhead">Relationships</h3><div class="tablewrap"><table class="table"><tbody>${relationshipRows || '<tr><td class="sub">관계가 없습니다.</td></tr>'}</tbody></table></div><h3 class="subhead">World facts · beliefs · promises</h3><div class="tablewrap"><table class="table"><tbody>${worldRows || '<tr><td class="sub">구조화 상태가 없습니다.</td></tr>'}</tbody></table></div><h3 class="subhead">Review · Conflicts</h3><p class="sub">${inspector.reconciliationReviews.length} review · ${inspector.conflicts.length} conflict</p><h3 class="subhead">Source ledger</h3>${ledger}</section>`;
}

export function dataManagement(state: RuntimeState, data: DashboardData, view: DataViewState, translations: TranslationView): string {
  const localByChat = new Map(view.inventory.map((item) => [item.chatId, item]));
  const currentCharacterId = state.current?.characterId;
  const serverHasCurrent = Boolean(state.current && data.adminChats.some((chat) => chat.id === state.current!.chatId));
  const visibleChats = serverHasCurrent || !state.current ? data.adminChats : [...data.adminChats, {
    id: state.current.chatId,
    characterId: state.current.characterId,
    characterName: state.current.characterName,
    chatTitle: state.current.chatTitle,
    updatedAt: 0,
    messages: 0,
    memories: 0,
    relationships: 0,
    assertions: 0,
    beliefs: 0,
    promises: 0,
    pendingReviews: 0,
    pendingConflicts: 0,
    approximateBytes: 0,
    serverRegistered: false,
  }];
  const classify = (chat: any): "current" | "other" => chat.characterId === currentCharacterId ? "current" : "other";
  const query = view.query.trim().toLocaleLowerCase();
  const filtered = visibleChats.filter((chat) => (view.filter === "all" || classify(chat) === view.filter)
    && (!query || `${chat.characterName} ${chat.chatTitle} ${chat.id}`.toLocaleLowerCase().includes(query)))
    .sort((left, right) => Number(right.characterId === currentCharacterId) - Number(left.characterId === currentCharacterId)
      || normalizeBotName(left.characterName).localeCompare(normalizeBotName(right.characterName), ["ko", "en"], { numeric: true })
      || Number(right.id === state.current?.chatId) - Number(left.id === state.current?.chatId)
      || String(left.chatTitle ?? "").localeCompare(String(right.chatTitle ?? ""), ["ko", "en"], { numeric: true })
      || Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0));
  let lastGroup = "";
  const rows = filtered.map((chat) => {
    const registered = chat.serverRegistered !== false;
    const local = localByChat.get(chat.id);
    const chatId = String(chat.id);
    const titleText = local?.chatTitle || state.current?.chatTitles?.[chat.id] || (state.current?.chatId === chat.id ? state.current?.chatTitle : "") || chat.chatTitle || "제목 없음";
    const botName = local?.characterName || chat.characterName || chat.characterId || "봇 이름 없음";
    const sourceCount = local?.messageCount ?? (state.current?.chatId === chat.id ? state.current?.sourceMessageCount : undefined);
    const inherited = chat.lineage?.status === "inherited" ? `<small>${escapeHtml(chat.lineage.parentTitle ?? chat.lineage.parentChatId ?? "원본")}에서 이어받음</small>` : "";
    const diagnostics = (typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) && data.health?.capabilities?.retrievalDiagnostics === true
      ? [{ label: chat.retrievalDiagnosticsEnabled === true ? "진단 기록 끄기" : "진단 기록 켜기", icon: "settings", action: "toggle-retrieval-diagnostics", data: { chatId, enabled: String(chat.retrievalDiagnosticsEnabled === true) } }]
      : [];
    const actions = registered ? menu({ label: `${botName} · ${titleText} 더보기`, title: `${botName} · ${titleText}`, items: [
      { label: "기록 보기", icon: "search", action: "view-server-data", data: { chatId } },
      { label: "이 채팅 백업", icon: "download", action: "export-chat-backup", data: { chatId }, disabled: Boolean(view.backupExportPhase) },
      ...diagnostics,
      ...(state.current && chat.id !== state.current.chatId ? [{ label: "현재 채팅으로 기억 가져오기", icon: "arrow-right", action: "inherit-from-chat", data: { chatId } }] : []),
      { label: "다시 만들기", icon: "refresh", action: "open-data-operation", data: { operation: "rebuild", chatId } },
      { label: "RCM 기록 삭제", icon: "delete", action: "open-data-operation", data: { operation: "delete", chatId }, danger: true },
    ] }) : '<span class="sub">RCM 서버 미등록</span>';
    // A row says what a person acts on; ids, byte sizes and per-table totals stay behind 기록 보기.
    const unsynced = sourceCount === undefined ? 0 : Math.max(0, Number(sourceCount) - Number(chat.messages ?? 0));
    const attention = Number(chat.pendingReviews ?? 0) + Number(chat.pendingConflicts ?? 0);
    const meta = [
      `기억 ${Number(chat.memories ?? 0).toLocaleString()} · 관계 ${Number(chat.relationships ?? 0)}`,
      registered ? `갱신 ${formatRelativeTime(chat.updatedAt)}` : "",
    ].filter(Boolean).map(escapeHtml).join(" · ");
    const flags = [
      unsynced ? `<span class="chatrow__flag">원문 ${unsynced.toLocaleString()}개 미동기화</span>` : "",
      attention ? `<span class="chatrow__flag">확인 필요 ${attention}</span>` : "",
    ].join("");
    const group = String(botName);
    const header = group !== lastGroup ? `<h2 class="sec chats__bot">${escapeHtml(group)}</h2>` : "";
    lastGroup = group;
    return `${header}<div class="chat" data-data-row><div class="chatrow"><div class="chatrow__main"><b>${escapeHtml(titleText)}</b>${inherited}<span class="chatrow__meta">${meta}</span>${flags}</div><div class="chatrow__acts">${actions}</div></div>${confirmationPanel(chat, view.confirmation)}</div>`;
  }).join("");
  const inventoryLabel = view.inventoryStatus === "loading" ? "Risu 원문과 대조 중…" : "Risu 원문과 대조";
  // Search and the bot filter earn their space only once the list is long; a typed query keeps them visible.
  const controls = visibleChats.length > 5 || query || view.filter !== "all"
    ? `<div class="tl-tools datatools"><label class="search">${icon("search")}<span class="sr-only">채팅 검색</span><input class="input" data-action="data-search" value="${escapeHtml(view.query)}" placeholder="봇 이름, 채팅 제목, ID 검색"></label><label class="relperson"><span class="sr-only">봇 필터</span><select class="select" data-action="data-filter"><option value="all" ${view.filter === "all" ? "selected" : ""}>전체 봇</option><option value="current" ${view.filter === "current" ? "selected" : ""}>현재 봇</option><option value="other" ${view.filter === "other" ? "selected" : ""}>다른 봇</option></select></label></div>`
    : "";
  const backupBusy = Boolean(view.backupExportPhase);
  const pageMenu = menu({ label: "데이터 더보기", items: [{ label: inventoryLabel, icon: "refresh", action: "load-data-inventory", disabled: view.inventoryStatus === "loading" }] });
  const importAction = `${btn("전체 백업", { kind: "secondary", action: "export-complete-backup", disabled: backupBusy })}<label class="btn btn--secondary" for="backup-file" title="백업 불러오기">백업 불러오기</label><input class="sr-only" id="backup-file" type="file" accept=".zip,application/zip"${backupBusy ? " disabled" : ""}>${pageMenu}`;
  const backupProgress = backupBusy ? notice(`${view.backupExportPhase === "creating" ? "백업 생성" : "다운로드"} · ${view.backupExportChatId ? "선택한 채팅의 RCM 데이터와 채팅별 설정" : "모든 RCM 데이터·설정·키"}을 저장하고 있습니다.`) : "";
  const backupError = view.backupExportError ? notice(`백업을 만들지 못했습니다. ${view.backupExportError}`, { tone: "cut" }) : "";
  return `<div class="datapage">${pageHeader("데이터", "채팅별 RCM 기록을 확인하고 백업하거나 삭제합니다.", importAction)}
    ${lineagePanel(data)}
    ${lineagePath(data)}
    ${lineageProbeNotice(state)}
    ${backupProgress}${backupError}${controls}${serverInspectorView(data, view.inspector, translations, state.settings.translationDisplay)}
    <section class="chats" aria-label="채팅별 RCM 데이터">${rows || empty("조건에 맞는 RCM 데이터가 없습니다", "검색어나 봇 필터를 바꿔 보세요.")}</section>
    <p class="sub">전체 백업에는 서버 토큰과 API 키가 들어 있습니다. 개인 파일로만 보관하세요.</p></div>`;
}

export async function setRetrievalDiagnostics(client: Pick<ServerClient, "request">, data: Pick<DashboardData, "adminChats" | "error">, chatId: string, enabled: boolean): Promise<boolean> {
  if (typeof __RCM_DISTRIBUTION__ !== "undefined" && __RCM_DISTRIBUTION__) return false;
  try {
    const result = await client.request<{ enabled: boolean }>(`/v1/admin/chats/${encodeURIComponent(chatId)}/retrieval-diagnostics`, {
      method: "PUT", body: JSON.stringify({ enabled }),
    });
    const chat = data.adminChats.find((item) => item.id === chatId);
    if (chat) chat.retrievalDiagnosticsEnabled = result.enabled;
    data.error = undefined;
    return result.enabled;
  } catch (error) {
    data.error = String(error);
    throw error;
  }
}

const SETTINGS_SECTIONS = ["chat", "memory", "display", "model", "server"] as const;
type SettingsSection = typeof SETTINGS_SECTIONS[number];

type ComparableServerLlmConfig = Pick<ServerLlmPublicConfig, "engine" | "provider" | "endpoint" | "model" | "temperature" | "thinking" | "serviceTier"> & Partial<Pick<ServerLlmPublicConfig, "maxInputTokens" | "maxOutputTokens" | "embeddingTimeoutMs" | "rerankTimeoutMs" | "llmTimeoutMs">>;

export function serverLlmUpdateRequired(
  current: ServerLlmPublicConfig | undefined,
  next: ComparableServerLlmConfig,
  apiKey = "",
): boolean {
  if (apiKey.trim()) return true;
  if (!current) return false;
  const endpoint = (value: string) => value.trim().replace(/\/+$/, "");
  return current.engine !== next.engine
    || current.provider !== next.provider
    || endpoint(current.endpoint) !== endpoint(next.endpoint)
    || current.model.trim() !== next.model.trim()
    || Number(current.temperature) !== Number(next.temperature)
    || current.thinking !== next.thinking
    || (current.serviceTier ?? "standard") !== next.serviceTier
    || ["maxInputTokens", "maxOutputTokens", "embeddingTimeoutMs", "rerankTimeoutMs", "llmTimeoutMs"].some(key => {
      const field = key as "maxInputTokens" | "maxOutputTokens" | "embeddingTimeoutMs" | "rerankTimeoutMs" | "llmTimeoutMs";
      return next[field] !== undefined && current[field] !== next[field];
    });
}

export function serverLlmUpdateRequiredForSettingsSave(
  bootstrappingServerConnection: boolean,
  current: ServerLlmPublicConfig | undefined,
  next: ComparableServerLlmConfig,
  apiKey = "",
): boolean {
  if (bootstrappingServerConnection) return Boolean(apiKey.trim());
  return serverLlmUpdateRequired(current, next, apiKey);
}

function translationSettings(values: Record<string, FormDataEntryValue>): Pick<PluginSettings, "translationProvider" | "translationSlot" | "translationModel" | "translationServerModel" | "translationMaxOutput" | "translationServerMaxOutput" | "translationTemperature" | "translationThinking" | "translationBackground"> {
  return { translationProvider: values.translationProvider === "server" ? "server" : values.translationProvider === "risu" ? "risu" : "google",
    translationSlot: String(values.translationSlot ?? "translate") as PluginSettings["translationSlot"], translationModel: String(values.translationModel ?? ""), translationServerModel: String(values.translationServerModel ?? ""),
    translationMaxOutput: Number(values.translationMaxOutput ?? 8000), translationServerMaxOutput: Number(values.translationServerMaxOutput ?? 8000), translationTemperature: Number(values.translationServerTemperature ?? .3), translationThinking: String(values.translationServerThinking ?? "default") as PluginSettings["translationThinking"], translationBackground: values.translationBackground === "on" };
}

export function settingsConnectionNeedsHealthProbe(
  current: Pick<PluginSettings, "serverUrl" | "serverToken">,
  next: Pick<PluginSettings, "serverUrl" | "serverToken">,
  health?: { ok?: boolean },
): boolean {
  return isServerConfigured(next) && (
    !health?.ok
    || current.serverUrl.replace(/\/+$/, "") !== next.serverUrl.replace(/\/+$/, "")
    || current.serverToken !== next.serverToken
  );
}

export function resetQuizSupportForConnectionChange(
  state: Pick<RuntimeState, "quizSupported">,
  current: Pick<PluginSettings, "serverUrl" | "serverToken">,
  next: Pick<PluginSettings, "serverUrl" | "serverToken">,
): void {
  if (current.serverUrl.replace(/\/+$/, "") !== next.serverUrl.replace(/\/+$/, "") || current.serverToken !== next.serverToken) {
    state.quizSupported = undefined;
  }
}

export const SERVER_SETUP_REQUIRED = "먼저 서버 주소와 토큰을 설정하고 연결을 확인해 주세요.";

export function settingsSaveFailureMessage(
  error: unknown,
  attempted: Pick<PluginSettings, "serverUrl" | "serverToken">,
): string {
  const message = (error instanceof Error ? error.message : String(error)).replace(/^Error:\s*/, "");
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden/i.test(message)) {
    return describeServerConnectionIssue(attempted, error)?.detail ?? "서버 토큰을 확인해 주세요.";
  }
  if (/failed to fetch|network|timed out|econn|enotfound|certificate|load failed/i.test(message)) {
    return describeServerConnectionIssue(attempted, error)?.detail ?? "서버 주소와 실행 상태를 확인해 주세요.";
  }
  return message || "설정을 저장하지 못했습니다.";
}

function regexRuleSummary(total: number, active: number): string {
  return total ? `<strong>${total}개 규칙</strong><small>· ${active}개 사용 중</small>` : "<strong>규칙 없음</strong>";
}

function regexRuleEditor(rule: CanonicalRemovalRule): string {
  return `<article class="settings-regex-rule" data-regex-rule><label class="settings-regex-enabled" title="규칙 사용"><input name="customRuleEnabled" type="checkbox" aria-label="규칙 사용" ${rule.enabled ? "checked" : ""}><span>규칙 사용</span></label><label class="field settings-regex-name"><span>규칙 이름</span><input name="customRuleName" value="${escapeHtml(rule.name)}" placeholder="예: 상태 패널"></label><label class="field settings-regex-flags"><span>Flags</span><input name="customRuleFlags" value="${escapeHtml(rule.flags || "gis")}" aria-describedby="regex-flags-help"></label><label class="field settings-regex-pattern"><span>정규식 패턴</span><input name="customRulePattern" value="${escapeHtml(rule.pattern)}" placeholder="제거할 문자열 패턴"></label><button class="iconbtn hit settings-regex-remove" type="button" data-action="remove-regex-rule" aria-label="규칙 삭제" title="규칙 삭제">${icon("delete")}</button></article>`;
}

function quizManagementBusy(state: RuntimeState, data: DashboardData): boolean {
  return Boolean(data.quizStatus?.generating || state.current && (state.currentJob?.kind === "quiz" && state.currentJob.chatId === state.current.chatId
    || state.serverWorker?.quizGenerating?.chatId === state.current.chatId));
}

export function settingsV2(
  state: RuntimeState,
  data: DashboardData,
  section: SettingsSection,
  voyageState?: ActionState,
  voyageBusy = false,
  cacheStats: TranslationCacheStats = { items: 0, bytes: 0, maxItems: 50_000, maxBytes: 128 * 1024 * 1024 },
  sectionOpen = false,
): string {
  const settings = state.settings;
  const hasCurrentChat = Boolean(state.current);
  const quizGenerating = quizManagementBusy(state, data);
  const currentChatEnabled = state.current ? isChatMemoryEnabled(settings, state.current.chatId) : settings.defaultChatEnabled;
  const includeUserMessages = state.current ? (settings.includeUserMessages[state.current.chatId] ?? true) : true;
  const memoryOnlyInjection = state.current ? (settings.memoryOnlyInjection[state.current.chatId] ?? false) : false;
  const extractionGroupTurns = state.current ? (settings.extractionGroupTurns[state.current.chatId] ?? 6) : 6;
  const desiredMemoryLanguage = state.current ? (settings.memoryLanguages[state.current.chatId] ?? "en") : "en";
  const currentMemoryBudget = state.current ? settings.memoryBudgets[state.current.chatId] : undefined;
  const currentProfile = state.current?.profile ?? "companion";
  const currentServerChat = state.current ? data.adminChats.find((chat) => chat.id === state.current!.chatId) : undefined;
  const activeMemoryLanguage = state.lastPrepare?.memoryLanguage ?? currentServerChat?.memoryLanguage ?? desiredMemoryLanguage;
  const pendingMemoryLanguage = state.lastPrepare?.pendingMemoryLanguage ?? currentServerChat?.pendingMemoryLanguage;
  const perspectives = state.current ? (settings.perspectives[state.current.chatId] ?? []).join(", ") : "";
  const perspectiveScope = state.current && data.health?.instanceId ? `${data.health.instanceId}:${state.current.chatId}` : "";
  const detectedPerspectives = perspectiveScope ? settings.detectedPerspectives[perspectiveScope] ?? state.lastPrepare?.perspectiveResolution?.perspectives ?? [] : [];
  const embedding = data.health?.embedding;
  const embeddingState = !data.health ? "서버 상태를 확인할 수 없음" : embedding?.ready ? `${embedding.model} · ${embedding.dimension}d · 사용 가능` : embedding?.configured ? `${embedding.model} · FTS로 대체 중` : "Voyage 키 없음 · FTS 사용 중";
  const connectionKind = data.connectionIssue?.kind === "incompatible" ? "is-pending" : data.health?.ok ? "is-ok" : data.connectionIssue?.kind === "unconfigured" ? "is-pending" : "is-error";
  const connectionTitle = data.connectionIssue?.title ?? (data.health?.ok ? "RCM 서버 연결됨" : "RCM 서버 연결 안 됨");
  const voyageLabel = !data.health ? data.connectionIssue?.detail ?? "Voyage 상태 확인 불가" : embedding?.ready ? "Voyage 사용 가능" : embedding?.configured ? "Voyage 연결 확인 필요" : "Voyage 키 없음, FTS 사용 중";
  const serverLlm = data.health?.serverLlm ?? { maxInputTokens: 80000, maxOutputTokens: 24000, embeddingTimeoutMs: 15000, rerankTimeoutMs: 45000, llmTimeoutMs: 300000, engine: settings.extractionEngine, ...defaultAuxiliaryModelConfig, serviceTier: "standard", keyConfigured: false, configuredProviders: [] };
  const serverConnectionReady = data.health?.ok === true;
  const configuredProviders = new Set(serverLlm.configuredProviders ?? []);
  const serverLlmStatus = serverLlm.keyConfigured ? "인증정보 저장됨" : "인증정보 없음";
  const pluginUpdateAvailable = pluginUpdateNeeded(state.updateStatus);
  const nav: Array<[SettingsSection, string, string]> = [["chat", "현재 채팅", "이 대화에만 적용"], ["memory", "기억", "주입 · 보호 · 원문 정리"], ["display", "화면", "테마 · 상태 칩 · 번역"], ["model", "모델", "추출 · 검색 · 임베딩 · 번역"], ["server", "서버", "연결 · 업데이트"]];
  // A pane is its groups only: the section's name is already on the tab or the row that opened it.
  const pane = (key: SettingsSection, title: string, content: string) => `<section data-settings-pane="${key}" ${section === key ? "" : "hidden"}><h2 class="${lex().skin === "phone" ? "settings-pane__title" : "sr-only"}">${title}</h2>${content}</section>`;
  const group = (title: string, body: string, extra = "") => `<div class="setting-group"${extra}>${title ? `<h3>${title}</h3>` : ""}${body}</div>`;
  const hint = (text: string) => text ? `<small class="sub">${text}</small>` : "";
  const check = (name: string, label: string, checked: boolean, note = "", disabled = false) => `<label class="field field--check"><span><input name="${name}" type="checkbox" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}> ${label}</span>${hint(note)}</label>`;
  const chatOff = hasCurrentChat ? "" : "disabled";
  const perspectivePlaceholder = detectedPerspectives.length ? `자동: ${detectedPerspectives.join(" · ")}` : "비워두면 자동 감지";

  const currentChat = pane("chat", "현재 채팅", `
    ${group("사용", `<div class="form__row">
      ${check("chatEnabled", "이 채팅에서 RCM 사용", currentChatEnabled, "끄면 이 채팅은 동기화하지 않습니다.", !hasCurrentChat)}
      ${dashboardChatProfileControl(currentProfile, !hasCurrentChat)}
      ${check("includeUserMessages", "유저 메시지도 기억에 포함", includeUserMessages, "", !hasCurrentChat)}
    </div>`)}
    ${group("정리 방식", `<div class="form__row">
      <label class="field"><span>한 번에 정리할 턴</span><input name="extractionGroupTurns" type="number" min="1" max="50" step="1" value="${extractionGroupTurns}" ${chatOff}>${hint("보호가 끝난 턴을 몇 개씩 모아 기억으로 만듭니다.")}</label>
      <label class="field"><span>기억 정본 언어</span><select name="memoryLanguage" ${chatOff}><option value="en" ${desiredMemoryLanguage === "en" ? "selected" : ""}>English</option><option value="ko" ${desiredMemoryLanguage === "ko" ? "selected" : ""}>한국어</option><option value="ja" ${desiredMemoryLanguage === "ja" ? "selected" : ""}>日本語</option><option value="zh" ${desiredMemoryLanguage === "zh" ? "selected" : ""}>中文</option></select>${hint(pendingMemoryLanguage ? `다음 재생성부터 ${escapeHtml(pendingMemoryLanguage.toUpperCase())}` : activeMemoryLanguage !== desiredMemoryLanguage ? `지금은 ${escapeHtml(activeMemoryLanguage.toUpperCase())}` : "")}</label>
      <label class="field"><span>기억 주입량</span><select name="chatMemoryBudget" ${chatOff}><option value="inherit" ${currentMemoryBudget === undefined ? "selected" : ""}>공통값 · ${settings.defaultMemoryBudget.toLocaleString()}</option>${[4_000, 6_000, 8_000, 12_000].map((value) => `<option value="${value}" ${currentMemoryBudget === value ? "selected" : ""}>${value.toLocaleString()} tokens</option>`).join("")}</select></label>
      ${check("memoryOnlyInjection", "기억만 보내기", memoryOnlyInjection, "인물·현재 탭은 계속 기록하지만 메인 모델에게는 보내지 않습니다.", !hasCurrentChat)}
    </div>`)}
    ${group("관점", `<div class="form__row">
      <label class="field"><span>관점 인물</span><input name="perspectives" value="${escapeHtml(perspectives)}" ${chatOff} placeholder="${escapeHtml(perspectivePlaceholder)}">${hint("여러 인물은 쉼표로 구분합니다.")}</label>
    </div>`)}`);

  const memory = pane("memory", "기억", `
    ${group("기억 주입", `<div class="form__row">
      <label class="field"><span>공통 기억 주입량</span><select name="defaultMemoryBudget">${[4_000, 6_000, 8_000, 12_000].map((value) => `<option value="${value}" ${settings.defaultMemoryBudget === value ? "selected" : ""}>${value.toLocaleString()} tokens</option>`).join("")}</select></label>
      ${check("memoryToolsEnabled", "메인 모델에 기억 도구 제공", settings.memoryToolsEnabled, "끄면 자동 주입만 사용합니다.")}
      <label class="field"><span>도구 호출당 최대 반환량</span><input name="mcpCap" type="number" min="1500" max="4000" step="100" value="${settings.mcpCap}"></label>
      <div class="field"><span>주입 위치</span><p class="sub">프리셋·캐릭터 설명·로어북 중 한 곳에 <code>[[RCM]]</code>을 넣으세요.</p></div>
    </div>`)}
    ${group("최근 대화 보호", `<div class="form__row">
      <label class="field"><span>원문 보호 · 턴</span><input name="sourceProtectionTurns" type="number" min="1" max="20" step="1" value="${settings.sourceProtectionTurns}">${hint("최근 N턴과 겹치는 기억은 덜 넣습니다.")}</label>
      <label class="field"><span>수정 보호 · 턴</span><input name="editProtectionTurns" type="number" min="1" max="5" step="1" value="${settings.editProtectionTurns}">${hint("최근 N턴은 수정이 끝날 때까지 기다립니다.")}</label>
      ${check("postExtractionReview", "보조 모델로 한 번 더 재검수", settings.postExtractionReview, "정확도가 오르는 대신 호출이 늘어납니다.")}
    </div>`)}
    ${group("원문 정리", `<div class="form__row">
      ${check("useLightboard", "Lightboard 데이터 제외", settings.canonicalizationPolicy.useLightboard, "LBDATA와 lb-lazy 태그를 기억 입력에서 뺍니다.")}
    </div><div class="settings-regex-toolbar"><div><strong>추가 제외 규칙</strong></div><button class="btn btn--secondary" type="button" data-action="add-regex-rule">규칙 추가</button></div><details class="settings-regex-disclosure" data-regex-disclosure><summary><span class="settings-regex-summary">${regexRuleSummary(settings.canonicalizationPolicy.customRules.length, settings.canonicalizationPolicy.customRules.filter((rule) => rule.enabled).length)}</span></summary><div class="settings-regex-body"><div class="settings-regex-list" data-regex-rules>${settings.canonicalizationPolicy.customRules.map(regexRuleEditor).join("")}<div class="settings-regex-empty" data-regex-empty ${settings.canonicalizationPolicy.customRules.length ? "hidden" : ""}>추가한 제외 규칙이 없습니다.</div></div><p class="settings-regex-note" id="regex-flags-help">위에서부터 순서대로 적용합니다. Flags 기본값은 <code>gis</code>이고, 이미 만든 기억에는 다시 만들 때 적용됩니다.</p></div></details>`)}`);

  const display = pane("display", "화면", `
    ${group("대시보드", `<div class="form__row">
      <div class="field"><span class="label">화면 테마</span><div class="seg" role="radiogroup" aria-label="화면 테마"><label><input type="radio" name="dashboardTheme" value="dark"${state.settings.dashboardTheme === "light" ? "" : " checked"}><span>${lex().themeDark}</span></label><label><input type="radio" name="dashboardTheme" value="light"${state.settings.dashboardTheme === "light" ? " checked" : ""}><span>${lex().themeLight}</span></label></div></div>
      <div class="field"><span class="label">디자인</span><div class="seg" role="radiogroup" aria-label="디자인"><label><input type="radio" name="dashboardSkin" value="film"${state.settings.dashboardSkin === "phone" ? "" : " checked"}><span>영화</span></label><label><input type="radio" name="dashboardSkin" value="phone"${state.settings.dashboardSkin === "phone" ? " checked" : ""}><span>폰</span></label></div></div>
    </div>`)}
    ${group("채팅 화면", `<div class="form__row">
      ${check("statusWidgetVisible", "상태 칩 보이기", settings.statusWidgetVisible !== false)}
      ${check("quizEnabled", "퀴즈 사용", settings.quizEnabled === true, "답변을 기다리는 동안 칩에서 풉니다. 보조 모델 호출이 조금 늘어납니다.")}
      ${hasCurrentChat && data.health?.capabilities?.quizManagement ? `<div class="field"><span>이 채팅 퀴즈</span><div class="decide" data-quiz-controls>${btn("남은 퀴즈 새로 만들기", { kind: "quiet", action: "quiz-regenerate", hit: true, disabled: quizGenerating })}${btn("점수 초기화", { kind: "quiet", action: "quiz-reset-stats", hit: true, disabled: quizGenerating })}</div></div>` : ""}
    </div>`)}
    ${group("참고 번역", `<label class="field"><span>표시</span><select name="translationDisplay"><option value="ko" ${settings.translationDisplay === "ko" ? "selected" : ""}>한국어 참고</option><option value="en" ${settings.translationDisplay === "en" ? "selected" : ""}>원문</option></select></label>`)}`);


  const capability = providerCapability(serverLlm.provider);
  const model = pane("model", "모델", `
    ${!isServerConfigured(settings) || !serverConnectionReady ? notice(SERVER_SETUP_REQUIRED, { action: btn("서버 설정으로 이동", { kind: "quiet", action: "settings-section", data: { section: "server" } }) }) : ""}
    <h3 class="model-section-title">기억 추출</h3>
    ${group("", `<div class="form__row connection-card">
      <label class="field"><span>처리 위치</span><select name="extractionEngine"><option value="risu" ${settings.extractionEngine === "risu" ? "selected" : ""}>Risu 보조 모델</option><option value="server" ${settings.extractionEngine === "server" ? "selected" : ""}>RCM 서버</option></select></label>
      <label class="field" data-engine-fields="risu" ${settings.extractionEngine === "risu" ? "" : "hidden"}><span>Risu 모델 슬롯</span><select name="auxiliaryMode">${[["main", "Main"], ["memory", "Memory"], ["otherAx", "Other AX"], ["static", "고정 모델 ID"]].map(([value, label]) => `<option value="${value}" ${settings.auxiliaryMode === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="field" data-engine-fields="risu" data-static-model ${settings.extractionEngine === "risu" && settings.auxiliaryMode === "static" ? "" : "hidden"}><span>고정 모델 ID</span><input name="staticModel" value="${escapeHtml(settings.staticModel)}"></label>
    <div class="settings-action-wrap" data-engine-fields="risu" ${settings.extractionEngine === "risu" ? "" : "hidden"}>${connectionCheck("risu")}</div></div>`)}
    ${group(`서버 모델 연결 <span class="sub" data-provider-key-status>· ${serverLlmStatus}</span>`, `<div class="form__row connection-card">
      <label class="field"><span>프로바이더</span><select name="serverLlmProvider" data-previous-provider="${serverLlm.provider}" data-configured-providers="${escapeHtml([...configuredProviders].join(","))}">${SERVER_LLM_PROVIDER_OPTIONS.map(([value, label]) => `<option value="${value}" ${serverLlm.provider === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="field"><span>엔드포인트</span><input name="serverLlmEndpoint" value="${escapeHtml(serverLlm.endpoint)}"></label>
      <label class="field"><span>${capability.credentialLabel}</span>${secretInput("serverLlmApiKey", capability.credentialLabel, { placeholder: capability.credentialPlaceholder })}</label>
      <label class="field"><span>모델 ID</span><input name="serverLlmModel" placeholder="${capability.defaultModel}" value="${escapeHtml(serverLlm.model)}"></label>
      <label class="field" ${capability.temperature ? "" : "hidden"}><span>Temperature</span><input name="serverLlmTemperature" type="number" min="0" max="2" step="0.05" value="${serverLlm.temperature}"></label>
      <label class="field" ${capability.thinking ? "" : "hidden"}><span>Thinking</span><select name="serverLlmThinking">${[["default", "기본값"], ["off", "Off"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]].map(([value, label]) => `<option value="${value}" ${serverLlm.thinking === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="field" ${capability.serviceTier ? "" : "hidden"}><span>처리 등급</span><select name="serverLlmServiceTier"><option value="standard" ${serverLlm.serviceTier === "standard" ? "selected" : ""}>Standard</option><option value="flex" ${serverLlm.serviceTier === "flex" ? "selected" : ""}>Flex · 저렴하지만 느림</option><option value="priority" ${serverLlm.serviceTier === "priority" ? "selected" : ""}>Priority · 비싸지만 우선 처리</option></select></label>
    ${connectionCheck("server", serverConnectionReady && configuredProviders.size ? `<span class="settings-action__end" data-remove-server-row ${serverLlm.keyConfigured ? "" : "hidden"}><button class="btn btn--danger" type="button" data-action="remove-server-llm-key">현재 인증정보 제거</button></span>` : "")}</div>`, ` data-engine-fields="server" ${settings.extractionEngine === "server" ? "" : "hidden"}`)}
    ${group("처리량", `<div class="form__row">
      <label class="field"><span>호출당 최대 입력 토큰</span><input name="maxInputTokens" type="number" min="1024" step="1" value="${serverLlm.maxInputTokens ?? 80000}">${hint("넘치는 입력은 원문을 보존하며 나누어 처리합니다.")}</label>
      <label class="field" data-engine-fields="server" ${settings.extractionEngine === "server" ? "" : "hidden"}><span>호출당 최대 출력 토큰</span><input name="maxOutputTokens" type="number" min="256" step="1" value="${serverLlm.maxOutputTokens ?? 24000}"></label>
      <div class="field" data-engine-fields="risu" ${settings.extractionEngine === "risu" ? "" : "hidden"}><span>최대 출력 토큰</span><p class="sub">Risu 보조 모델 설정을 따릅니다.</p></div>
    </div><details class="settings-advanced"><summary>대기 시간</summary><div class="form__row">
      <label class="field"><span>임베딩 · 초</span><input name="embeddingTimeoutSeconds" type="number" min="0.25" max="60" step="0.25" value="${(serverLlm.embeddingTimeoutMs ?? 15000) / 1000}"></label>
      <label class="field"><span>재정렬 · 초</span><input name="rerankTimeoutSeconds" type="number" min="1" max="90" step="1" value="${(serverLlm.rerankTimeoutMs ?? 45000) / 1000}"></label>
      <label class="field"><span>기억 추출·정리 · 초</span><input name="llmTimeoutSeconds" type="number" min="30" max="900" step="1" value="${(serverLlm.llmTimeoutMs ?? 300000) / 1000}"></label>
    </div></details>`)}
    ${mcpSelectorSettings(data.health?.mcpSelector, [...configuredProviders])}`);

  const updateStatus = state.updateStatus;
  const installedServerVersion = data.health?.ok
    ? data.health.version || updateStatus?.currentServerVersion
    : undefined;
  const installedVersions = `<p class="sub">RCM ${escapeHtml(RCM_PRODUCT_VERSION)} · 플러그인 ${escapeHtml(RCM_PLUGIN_VERSION)}${installedServerVersion ? ` · 서버 ${escapeHtml(installedServerVersion)}` : ""}</p>`;
  const updateNeedsAction = Boolean(updateStatus?.available || updateStatus?.restartRequired || pluginUpdateAvailable);
  const revisionMismatch = data.connectionIssue?.kind === "incompatible";
  const manualServerUpdate = revisionMismatch && data.connectionIssue?.requiredUpdate !== "plugin"
    ? `<p class="sub">서버 설치 패키지를 내려받아 수동으로 업데이트해 주세요. 사용자 설정과 기억 데이터는 유지됩니다.</p><a class="btn btn--primary" href="https://github.com/Pulproom/rcm/releases/latest" target="_blank" rel="noopener noreferrer">서버 패키지 받기</a>` : "";
  const update = updateStatus?.configured && !revisionMismatch ? group("업데이트", `<div class="settings-connection ${updateStatus.error ? "is-error" : updateNeedsAction ? "is-pending" : "is-ok"}" role="status"><span class="settings-connection__mark">${icon(updateStatus.error ? "error" : updateNeedsAction ? "clock" : "check")}</span><div><strong>${updateStatus.restartRequired ? updateStatus.canApplyAutomatically ? "서버 업데이트 설치 가능" : "서버 재시작 필요" : updateStatus.available ? `${escapeHtml(updateStatus.latestVersion ?? "새 버전")} 설치 가능` : pluginUpdateAvailable ? "플러그인 업데이트 필요" : "최신 버전 사용 중"}</strong><small>서버 ${escapeHtml(updateStatus.currentServerVersion)}${pluginUpdateAvailable ? ` · 플러그인 ${escapeHtml(updateStatus.latestPluginVersion ?? "새 버전")}` : ""}</small></div></div><div class="actions">${updateStatus.restartRequired && updateStatus.canApplyAutomatically || updateStatus.available && updateStatus.canStageServer ? `<button class="btn btn--primary" type="button" data-action="stage-server-update">${updateStatus.canApplyAutomatically ? "서버 업데이트 설치" : "서버 업데이트 준비"}</button>` : ""}<button class="btn btn--secondary" type="button" data-action="check-update">다시 확인</button></div>${pluginUpdateAvailable ? `<p class="sub">Risu 플러그인 메뉴의 + 버튼으로 새 플러그인을 설치해 주세요.</p>` : ""}`) : "";
  const server = pane("server", "서버", `
    <div class="settings-connection ${connectionKind}" role="status"><span class="settings-connection__mark">${icon(data.connectionIssue?.kind === "incompatible" ? "clock" : data.health?.ok ? "check" : data.connectionIssue?.kind === "unconfigured" ? "clock" : "error")}</span><div><strong>${connectionTitle}</strong><small>${data.health?.version ? `버전 ${escapeHtml(data.health.version)} · ` : ""}${embeddingState}</small></div></div>
    ${group("연결", `<div class="form__row">
      <label class="field"><span>서버 주소</span><input name="serverUrl" value="${escapeHtml(settings.serverUrl)}"></label>
      <label class="field"><span>서버 토큰</span>${secretInput("serverToken", "서버 토큰", { value: settings.serverToken })}</label>
    </div>`)}
    ${installedVersions}${data.connectionIssue?.kind === "incompatible" ? `<p class="sub">${escapeHtml(data.connectionIssue.detail)}</p>${data.connectionIssue.requiredUpdate === "plugin" ? pluginUpdateAction(state) : ""}` : ""}${manualServerUpdate}${update}`);
  const voyage = `<div class="setting-group" data-settings-model-extra ${section === "model" ? "" : "hidden"}><h3 class="model-section-title">검색 임베딩</h3><form id="voyage-form" class="connection-card"><label class="field"><span>Voyage API 키</span>${secretInput("voyageApiKey", "Voyage API 키", { placeholder: embedding?.configured ? "저장된 키 유지" : "키 입력", disabled: voyageBusy })}</label>${connectionCheck("voyage", embedding?.configured ? '<span class="settings-action__end"><button class="btn btn--danger" type="button" data-action="remove-voyage-key">저장된 키 제거</button></span>' : "")}${voyageState ? `<div class="notice" role="${voyageState.kind === "success" ? "status" : "alert"}">${icon(voyageState.kind === "success" ? "check" : "error")}<div>${escapeHtml(voyageState.message)}</div></div>` : ""}</form></div>`;
  const translation = `<section class="setting-group" data-settings-model-extra ${section === "model" ? "" : "hidden"}><h3 class="model-section-title">참고 번역</h3><div class="form__row connection-card" data-translation-card>
    <label class="field"><span>번역 방식</span><select form="settings-form" name="translationProvider">${[["google", "Google 번역 (무료)"], ["risu", "Risu 보조 모델"], ["server", "RCM 서버 모델"]].map(([v, label]) => `<option value="${v}" ${settings.translationProvider === v ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <label class="field" data-translation-mode="risu" ${settings.translationProvider === "risu" ? "" : "hidden"}><span>모델 슬롯</span><select form="settings-form" name="translationSlot">${[["translate", "Risu 번역 슬롯"], ["main", "Main"], ["memory", "Memory"], ["otherAx", "Other AX"], ["static", "고정 모델 ID"]].map(([v, label]) => `<option value="${v}" ${settings.translationSlot === v ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <label class="field" data-translation-static ${settings.translationProvider === "risu" && settings.translationSlot === "static" ? "" : "hidden"}><span>고정 모델 ID</span><input form="settings-form" name="translationModel" value="${escapeHtml(settings.translationModel)}"></label>
    ${translationConnectionSettings(settings,serverLlm,data.health?.translationConnection)}
    <label class="field" data-translation-mode="risu" ${settings.translationProvider === "risu" ? "" : "hidden"}><span>호출당 최대 출력</span><input form="settings-form" name="translationMaxOutput" type="number" min="256" max="128000" step="1" value="${settings.translationMaxOutput}"></label>
    <label class="field field--check" data-translation-llm ${settings.translationProvider === "google" ? "hidden" : ""}><span><input form="settings-form" name="translationBackground" type="checkbox" ${settings.translationBackground ? "checked" : ""}> 백그라운드 자동 번역</span><small class="sub">꺼두면 보고 있는 항목만 번역해요.</small></label>
    <div class="settings-action-wrap" data-translation-llm ${settings.translationProvider === "google" ? "hidden" : ""}>${connectionCheck("translation", `<span class="settings-action__end" data-remove-translation-row ${settings.translationProvider === "server" && data.health?.translationConnection?.credentialSource === "dedicated" && data.health.translationConnection.dedicatedKeyConfigured ? "" : "hidden"}><button class="btn btn--danger" type="button" data-action="remove-translation-key">저장된 키 제거</button></span>`)}</div>
    <div class="field"><span>번역 캐시</span><div class="settings-cache-row"><span class="sub">${cacheStats.items.toLocaleString()}개 · ${(cacheStats.bytes / 1024 / 1024).toFixed(1)} MiB</span></div></div><div class="settings-action-wrap"><div class="settings-action">${btn("이 채팅 비우기", { kind: "quiet", action: "clear-chat-translation-cache", disabled: !hasCurrentChat })}${btn("전체 비우기", { kind: "quiet", action: "clear-translation-cache" })}</div></div>
  </div></section>`;
  const saveAction = btn(voyageBusy ? "저장 중…" : "설정 저장", { kind: "primary", icon: "save", action: "save-settings", disabled: voyageBusy });
  // The phone skin lists the sections like the Settings app; on a phone a section opens as its own screen.
  const phone = lex().skin === "phone";
  const sectionIcons: Record<SettingsSection, [string, string]> = { chat: ["film", "green"], memory: ["bookmark", "indigo"], display: ["eye", "teal"], model: ["sliders", "orange"], server: ["settings", "gray"] };
  // Both skins list the sections; the film skin styles it as a quiet side list, not a second tab strip.
  const sectionNav = `<nav class="settings-nav" aria-label="설정 구간">${nav.map(([key, title, hint]) => `<button type="button" class="settings-nav__row" data-action="settings-section" data-section="${key}"${section === key ? ' aria-current="true"' : ""}><span class="settings-nav__ic settings-nav__ic--${sectionIcons[key][1]}">${icon(sectionIcons[key][0])}</span><span class="settings-nav__t">${title}<small>${hint}</small></span>${icon("chevron")}</button>`).join("")}</nav>`;
  const back = phone ? `<button type="button" class="back hit settings-back" data-action="settings-back">${icon("back")}<span>설정</span></button>` : "";
  return `<div class="settingspage${phone && sectionOpen ? " is-open" : ""}">${pageHeader("설정", "")}${sectionNav}<div class="settings-panel">${back}<form id="settings-form" class="form">${currentChat}${memory}${display}${model}${server}</form>${voyage}${translation}<div class="form__bar settings-bar">${saveAction}</div></div></div>`;
}

export function memoryTranslationRecords(memory: any, data: Pick<DashboardData, "messages" | "relationshipEvents" | "physicalIntimacy">): StructuredTranslationRecord[] {
    const evidence = parseJson<Array<{ messageId?: string; quote?: string }>>(memory.evidence_json, []);
    const messages = new Map(data.messages.map((message) => [message.message_id, message]));
    const relationshipEvents = data.relationshipEvents.filter((item) => item.sourceMemoryId === memory.id);
    const intimacyMilestones = data.physicalIntimacy.filter((item) => item.sourceMemoryId === memory.id);
    return [
      { kind: "memory-title", itemId: `${memory.id}:title`, text: String(memory.title) },
      { kind: "memory-content", itemId: `${memory.id}:content`, text: String(memory.content) },
      ...(memory.details ?? []).map((item: any) => ({ kind: "memory-detail", itemId: `${memory.id}:detail:${item.id}`, text: String(item.text ?? "") })),
      ...relationshipEvents.map((item: any) => ({ kind: "relationship-event", itemId: `relationship-event:${item.id}:reason`, text: String(item.reason ?? "") })),
      ...intimacyMilestones.map((item: any) => ({ kind: "physical-intimacy", itemId: `intimacy:${item.id}:circumstance`, text: String(item.circumstance ?? "") })),
      ...(memory.keyDialogues ?? []).map((item: any, index: number) => ({ kind: "dialogue", itemId: `${memory.id}:dialogue:${index}`, text: String(item.text) })),
      ...evidence.map((item, index) => ({ kind: "evidence", itemId: `${memory.id}:evidence:${index}`, text: String(item.quote ?? messages.get(item.messageId ?? "")?.content ?? "") })).filter((item) => item.text),
    ];
}

export function structuredTranslationRecords(state: RuntimeState, data: DashboardData, activeTab: Tab,
  storyView: { selectedGroupId?: string; selectedPart?: string; expandedMemoryId?: string } = {},
  selectedRelationship = "", sentOpen = false): StructuredTranslationRecord[] {
    const relationshipLabels = (activeTab === "overview" ? buildHomePairs(data) : ["initial", "relationships"].includes(activeTab) ? buildPairs(data, data.personaEntity) : [])
      .flatMap((pair) => pair.label ? [{ kind: "relationship-label", itemId: relationshipLabelTranslationKey(pair), text: pair.label }] : []);
    return  activeTab === "overview"
      ? [...relationshipLabels, ...homeTranslationRecords(homeInjectionManifest(state, data.health?.instanceId), data, sentOpen)]
      : activeTab === "story"
      ? storyScreenTranslationRecords(data, storyView)
      : ["initial", "relationships"].includes(activeTab)
      ? [
        ...relationshipLabels,
        ...(activeTab === "initial" ? data.assertions : data.assertions.filter(item => item.socialRelation)).flatMap(item => [
          { kind: "assertion", itemId: `assertion:${item.id}`, text: String(item.value) },
          { kind: "assertion-predicate", itemId: `assertion-predicate:${item.id}`, text: String(item.predicate) },
        ]),
        // The person sheet's ended-state fold shares the ledger's history keys.
        ...(activeTab === "initial" ? data.endedAssertions.filter((item) => !item.socialRelation).flatMap((item, index) => [
          { kind: "assertion-history", itemId: `history:assertions:${item.id ?? index}`, text: String(item.value) },
          { kind: "assertion-predicate", itemId: `assertion-predicate:${item.id ?? index}`, text: String(item.predicate) },
        ]) : []),
        ...(activeTab === "initial" ? data.beliefs.map((item, index) => ({ kind: "belief", itemId: `belief:${item.id ?? index}`, text: String(item.value) })) : []),
        ...(activeTab === "initial" ? data.promises.map((item, index) => ({ kind: "promise", itemId: `promise:${item.id ?? item.promise_key ?? index}`, text: String(item.content) })) : []),
        ...data.relationships.flatMap((item) => [
          { kind: "relationship", itemId: `relationship:${relationshipFrom(item)}|${relationshipTo(item)}:summary`, text: String(item.summary ?? "") },
          ...(item.activeTensions ?? []).map((text: string, index: number) => ({ kind: "relationship-tension", itemId: `relationship:${relationshipFrom(item)}|${relationshipTo(item)}:tension:${index}`, text })),
        ]),
        ...(data.socialKnowledge ?? []).flatMap((item: any) => (item.cognition ?? []).map((detail: any) => ({ kind: "social-cognition", itemId: `social-cognition:${detail.id}`, text: String(detail.text ?? "") }))),
        ...data.relationshipEvents.map((item) => ({ kind: "relationship-event", itemId: `relationship-event:${item.id}:reason`, text: String(item.reason ?? "") })),
        ...data.physicalIntimacy.map((item) => ({ kind: "physical-intimacy", itemId: `intimacy:${item.id}:circumstance`, text: String(item.circumstance ?? "") })),
        ...(activeTab === "relationships" ? relationshipSceneTranslationRecords(data, selectedRelationship) : []),
        ...(activeTab === "initial" ? data.memories.flatMap((memory: any) => (memory?.landmarkKinds ?? []).flatMap((landmark: any, index: number) => landmark?.kind === "anniversary_basis" && String(landmark?.label ?? "").trim()
          ? [{ kind: "landmark-label", itemId: `landmark:${memory.id}#${index}:label`, text: String(landmark.label) }] : []))
          : []),
        ...(data.initialCalibration?.socialKnowledge ?? []).filter((item: any) => String(item?.description ?? "").trim()).map((item: any) => ({
          kind: "initial-social",
          itemId: `initial-social:${item.holder}|${item.subject}`,
          text: String(item.description ?? ""),
        })),
        ...(data.initialCalibration?.relationships ?? []).map((item: any) => ({
          kind: "initial-relationship",
          itemId: `initial-relationship:${item.id ?? `${item.from}|${item.to}`}:summary`,
          text: String(item.summary ?? ""),
        })),
      ]
      : activeTab === "reviews"
        ? data.reconciliationReviews.filter((item) => item.status === "pending").flatMap((item) => {
          const incoming = item.incoming ?? {};
          const candidate = item.candidates.find((value: any) => value.id === item.decision?.targetId) ?? item.candidates[0];
          return [
            { kind: "reconciliation", itemId: `reconciliation:${item.id}:incoming`, text: String(incoming.content ?? incoming.value ?? incoming.title ?? "") },
            { kind: "reconciliation", itemId: `reconciliation:${item.id}:candidate`, text: String(candidate?.value?.content ?? candidate?.value?.value ?? candidate?.value?.title ?? "") },
          ];
        })
      : activeTab === "world"
        // 현재 and 지난 기록 read every version of a record, so its whole history is translated with it.
        ? [
          ...[...data.assertions, ...data.endedAssertions].filter((item) => !item.socialRelation).flatMap((item, index) => [
            { kind: data.assertions.includes(item) ? "assertion" : "assertion-history", itemId: data.assertions.includes(item) ? `assertion:${item.id ?? index}` : `history:assertions:${item.id ?? index}`, text: String(item.value) },
            { kind: "assertion-predicate", itemId: `assertion-predicate:${item.id ?? index}`, text: String(item.predicate) },
          ]),
          ...[...data.beliefs, ...data.endedBeliefs].flatMap((item, index) => [
            { kind: data.beliefs.includes(item) ? "belief" : "belief-history", itemId: data.beliefs.includes(item) ? `belief:${item.id ?? index}` : `history:beliefs:${item.id ?? index}`, text: String(item.value) },
            { kind: "belief-predicate", itemId: `belief-predicate:${item.id ?? index}`, text: predicateLabel(item.predicate) },
          ]),
          ...data.promises.map((item, index) => ({ kind: "promise", itemId: `promise:${item.id ?? item.promise_key ?? index}`, text: String(item.content) })),
          ...data.promiseHistory.flatMap((item, index) => [
            { kind: "promise-history", itemId: `history:promises:${item.id ?? index}`, text: String(item.content) },
            ...(String(item.status_reason ?? "").trim() ? [{ kind: "promise-reason", itemId: `promise-reason:${item.id ?? index}`, text: String(item.status_reason) }] : []),
          ]),
        ]
        : [];
}

/** Same builders as the readers; background work only warms their ordinary cache keys. */
export function backgroundTranslationRecords(state: RuntimeState, data: DashboardData): StructuredTranslationRecord[] {
  const records = [
    ...structuredTranslationRecords(state, data, "overview"),
    ...data.memories.slice().sort((a, b) => Number(b.updated_at) - Number(a.updated_at)).flatMap(memory => memoryTranslationRecords(memory, data)),
    ...structuredTranslationRecords(state, data, "initial"),
    ...structuredTranslationRecords(state, data, "relationships"),
    ...buildPairs(data, data.personaEntity).flatMap(pair => relationshipSceneTranslationRecords(data, pair.key)),
    ...storyScreenTranslationRecords(data),
    ...structuredTranslationRecords(state, data, "world"),
  ].filter(record => record.text);
  return [...new Map(records.map(record => [JSON.stringify([record.kind, record.itemId, record.text]), record])).values()];
}

function dashboardCanonicalLanguage(state: RuntimeState, chatId: string | undefined, adminChats: any[]): MemoryLanguage {
  if (!chatId) return "en";
  return (adminChats.find(chat => chat.id === chatId)?.memoryLanguage as MemoryLanguage | undefined)
    ?? state.activeMemoryLanguages?.[chatId]
    ?? state.settings.memoryLanguages[chatId] ?? "en";
}

function resolveDashboardPersonaEntity(context: RuntimeState["current"], entities: any[], viewPreferences: any): string | null {
  return matchPersonaEntity(context?.identityHints.userPersonaName, entities.map(entity => ({
    name: String(entity?.name ?? entity?.displayName ?? ""), aliases: Array.isArray(entity?.aliases) ? entity.aliases.map(String) : [],
  })), typeof viewPreferences?.personaEntity === "string" ? viewPreferences.personaEntity : null);
}

export async function loadCurrentChatTranslationSources(state: RuntimeState, client: ServerClient, chatId: string,
  scope: { serverInstanceId: string; memoryLanguage: MemoryLanguage }, isCurrent: () => boolean): Promise<TranslationSource[]> {
  if (!isCurrent() || scope.memoryLanguage === "ko") return [];
  const chat = encodeURIComponent(chatId);
  // These seven datasets supply the shared reader builders. Pair identity is
  // already canonical; entities/preferences only change ordering and tier.
  const [memories, relationships, world, storySpine, social, physical, initial] = await Promise.all([
    client.request<any>(`/v1/chats/${chat}/memories`), client.request<any>(`/v1/chats/${chat}/relationships`),
    client.request<any>(`/v1/chats/${chat}/world-state?includeHistory=true`), client.request<any>(`/v1/chats/${chat}/story-spine`),
    client.request<any>(`/v1/chats/${chat}/social-knowledge`), client.request<any>(`/v1/chats/${chat}/physical-intimacy`),
    client.request<any>(`/v1/chats/${chat}/initial-calibration`),
  ]);
  if (!isCurrent()) return [];
  const data: DashboardData = { ...emptyData(), health: { instanceId: scope.serverInstanceId }, memories: memories.items, relationships: relationships.items,
    relationshipEvents: relationships.events ?? [], ...world, storySpine, socialKnowledge: social.items, physicalIntimacy: physical.items, initialCalibration: initial };
  if (data.memories.some(memory => parseJson<Array<{ quote?: string }>>(memory.evidence_json, []).some(item => !item.quote))) {
    data.messages = (await client.request<any>(`/v1/chats/${chat}/messages`)).items;
  }
  if (!isCurrent()) return [];
  return backgroundTranslationRecords(state, data).map(record => ({ ...record,
    serverInstanceId: scope.serverInstanceId, chatId, sourceLanguage: scope.memoryLanguage }));
}

export async function prefetchCurrentChatTranslations(state: RuntimeState, client: ServerClient, chatId: string,
  scope: { serverInstanceId: string; memoryLanguage: MemoryLanguage }, isCurrent: () => boolean): Promise<TranslationSource[]> {
  if (!backgroundTranslationEnabled(state)) return [];
  return prefetchTranslationRecords(state, await loadCurrentChatTranslationSources(state, client, chatId, scope, isCurrent), isCurrent);
}

export async function loadDashboardData(
  state: RuntimeState,
  client: ServerClient,
  options: { tab?: Tab; previous?: DashboardData } = {},
): Promise<DashboardData> {
  const contextPromise = readOptionalDashboardContext(state);
  const requested = new Set(options.tab ? dashboardDatasetsForTab(options.tab) : ALL_DASHBOARD_DATASETS);
  if (!isServerConfigured(state.settings)) {
    const contextCall = await Promise.resolve(contextPromise).then(
      (value) => ({ status: "fulfilled", value }) as PromiseFulfilledResult<any>,
      (reason) => ({ status: "rejected", reason }) as PromiseRejectedResult,
    );
    return {
      ...emptyData(),
      loadedDatasets: [...requested],
      contextError: contextCall.status === "rejected" ? String(contextCall.reason) : contextCall.value.error,
      connectionIssue: describeServerConnectionIssue(state.settings),
    };
  }
  const [healthCall, contextCall, adminCall] = await Promise.allSettled([
    client.request<any>("/v1/health", {}, SERVER_STATUS_TIMEOUT_MS),
    contextPromise,
    client.request<any>("/v1/admin/chats"),
  ]);
  const optionalContext = contextCall.status === "fulfilled" ? contextCall.value : { error: String(contextCall.reason) };
  const context = optionalContext.context;
  let previous = options.previous && options.previous.chatId === context?.chatId ? options.previous : emptyData();
  if (healthCall.status === "fulfilled" && Number(healthCall.value?.apiRevision) !== RCM_API_REVISION) {
    const health = healthCall.value;
    // Update discovery must not delay the already-known compatibility state.
    void refreshUpdateStatus(state, client, { remote: true });
    return {
      ...emptyData(), chatId: context?.chatId, health, loadedDatasets: [...requested],
      connectionIssue: describeServerConnectionIssue(state.settings, new ServerCompatibilityError(Number(health?.apiRevision))),
    };
  }
  const adminChats = adminCall.status === "fulfilled" ? adminCall.value.items ?? [] : previous.adminChats;
  const serverHasCurrent = Boolean(context && adminChats.some((chat: any) => chat.id === context.chatId));
  // A successful inventory confirms deletion. Only an unavailable inventory
  // may keep cached chat data while the connection recovers.
  if (context && adminCall.status === "fulfilled" && !serverHasCurrent) previous = emptyData();
  const endpoint = (dataset: DashboardChatDataset): string => {
    const chat = encodeURIComponent(context!.chatId);
    const paths: Record<DashboardChatDataset, string> = {
      memories: "memories", messages: "messages", relationships: "relationships", world: "world-state?includeHistory=true",
      conflicts: "conflicts", jobs: "jobs", recallLogs: "recall-logs", entities: "entities", reviews: "reconciliation-reviews",
      lineage: "lineage", socialKnowledge: "social-knowledge", physicalIntimacy: "physical-intimacy", status: "status",
      viewPreferences: "view-preferences", audits: "extraction-audits", initialCalibration: "initial-calibration", storySpine: "story-spine",
    };
    return `/v1/chats/${chat}/${paths[dataset]}`;
  };
  const chatCalls = new Map<DashboardChatDataset, PromiseSettledResult<any>>();
  if (context && serverHasCurrent && healthCall.status === "fulfilled" && adminCall.status === "fulfilled") {
    if (options.tab === "overview") {
      try {
        const batch = await client.request<{ datasets: Record<string, { ok: true; value: unknown } | { ok: false; error: string }> }>(
            `/v1/chats/${encodeURIComponent(context.chatId)}/dashboard-home`);
        for (const dataset of requested) {
          const result = batch.datasets?.[dataset];
          chatCalls.set(dataset, result?.ok
            ? { status: "fulfilled", value: result.value }
            : { status: "rejected", reason: new Error(result?.error ?? `Missing dashboard dataset: ${dataset}`) });
        }
      } catch (reason) {
        for (const dataset of requested) chatCalls.set(dataset, { status: "rejected", reason });
      }
    } else await Promise.all([...requested].map(async (dataset) => {
      const result = await client.request<any>(endpoint(dataset)).then(
        (value) => ({ status: "fulfilled", value }) as PromiseFulfilledResult<any>,
        (reason) => ({ status: "rejected", reason }) as PromiseRejectedResult,
      );
      chatCalls.set(dataset, result);
    }));
  }
  let quizStatus = previous.quizStatus;
  if (options.tab === "settings" && context && serverHasCurrent && healthCall.status === "fulfilled" && healthCall.value?.capabilities?.quizManagement) {
    try { quizStatus = await client.quizStatus(context.chatId); } catch { quizStatus = undefined; }
  }
  const failedDatasets = [...chatCalls]
    .filter(([, result]) => result.status === "rejected")
    .map(([dataset]) => dataset);
  const loadedDatasets = new Set(previous.loadedDatasets ?? []);
  failedDatasets.forEach((dataset) => loadedDatasets.delete(dataset));
  if (context && adminCall.status === "fulfilled" && !serverHasCurrent) requested.forEach((dataset) => loadedDatasets.add(dataset));
  for (const [dataset, result] of chatCalls) if (result.status === "fulfilled") loadedDatasets.add(dataset);
  const value = (dataset: DashboardChatDataset, fallback: any) => chatCalls.get(dataset)?.status === "fulfilled"
    ? (chatCalls.get(dataset) as PromiseFulfilledResult<any>).value
    : fallback;
  const worldState = value("world", {
    assertions: previous.assertions, beliefs: previous.beliefs, promises: previous.promises,
    endedAssertions: previous.endedAssertions, endedBeliefs: previous.endedBeliefs,
    userDeletedBeliefs: previous.userDeletedBeliefs, promiseHistory: previous.promiseHistory,
  });
  const relationshipState = value("relationships", { items: previous.relationships, events: previous.relationshipEvents });
  const viewPreferences = value("viewPreferences", previous.viewPreferences);
  const entities = value("entities", { items: previous.entities }).items;
  const personaResolutionReady = Boolean(context)
    && chatCalls.get("viewPreferences")?.status === "fulfilled"
    && chatCalls.get("entities")?.status === "fulfilled";
  const personaEntity = personaResolutionReady
    ? resolveDashboardPersonaEntity(context, entities, viewPreferences)
    : requested.has("viewPreferences") ? null : previous.personaEntity;
  const jobsState = value("jobs", {
    items: previous.jobs, cancelledMessages: previous.cancelledMessages, waitingForAssistant: previous.waitingForAssistant,
    bufferedMessages: previous.bufferedMessages, backfillMessages: previous.backfillMessages, bufferedTurns: previous.bufferedTurns, protectedTurns: previous.protectedTurns, bufferedSourceTokens: previous.bufferedSourceTokens,
    extractionGroupTurns: previous.extractionGroupTurns, recoverableMessages: previous.recoverableMessages,
    historicalBackfillMessages: previous.historicalBackfillMessages, ingestionState: previous.ingestionState,
  });
  const lineage = value("lineage", previous.lineage ?? { status: "none" }) as ChatLineageStatus;
  const currentAdmin = context ? adminChats.find((chat: any) => chat.id === context.chatId) : undefined;
  const currentHasDerived = currentAdmin && ["memories", "relationships", "assertions", "beliefs", "promises"].some((key) => Number(currentAdmin[key] ?? 0) > 0);
  if (requested.has("lineage") && context && healthCall.status === "fulfilled" && healthCall.value?.capabilities?.readOnlyLineageProbe && lineage.status === "none" && !currentHasDerived) {
    void probeDashboardLineage(state, client, context);
  } else if (requested.has("lineage") && (!context || lineage.status !== "none" || currentHasDerived)) {
    state.lineageProbe = undefined;
  }
  return {
    chatId: context?.chatId,
    quizStatus,
    loadedDatasets: [...loadedDatasets],
    failedDatasets,
    health: healthCall.status === "fulfilled" ? healthCall.value : previous.health,
    memories: value("memories", { items: previous.memories }).items,
    storySpine: value("storySpine", previous.storySpine),
    messages: value("messages", { items: previous.messages }).items,
    relationships: relationshipState.items,
    relationshipEvents: relationshipState.events ?? [],
    coldStartProgress: value("status", { progress: previous.coldStartProgress }).progress,
    physicalIntimacy: value("physicalIntimacy", { items: previous.physicalIntimacy }).items,
    entities,
    socialKnowledge: value("socialKnowledge", { items: previous.socialKnowledge }).items,
    socialKnowledgeJobs: value("socialKnowledge", { jobs: previous.socialKnowledgeJobs }).jobs ?? {},
    viewPreferences: {
      personaEntity: typeof viewPreferences?.personaEntity === "string" ? viewPreferences.personaEntity : null,
      hiddenAnniversaries: Array.isArray(viewPreferences?.hiddenAnniversaries) ? viewPreferences.hiddenAnniversaries.map(String) : [],
    },
    personaEntity,
    assertions: worldState.assertions ?? [],
    beliefs: worldState.beliefs ?? [],
    promises: worldState.promises ?? [],
    endedAssertions: worldState.endedAssertions ?? [],
    endedBeliefs: worldState.endedBeliefs ?? [],
    userDeletedBeliefs: worldState.userDeletedBeliefs ?? [],
    promiseHistory: worldState.promiseHistory ?? [],
    conflicts: value("conflicts", { items: previous.conflicts }).items,
    reconciliationReviews: value("reviews", { items: previous.reconciliationReviews }).items,
    extractionAudits: value("audits", { items: previous.extractionAudits }).items,
    initialCalibration: value("initialCalibration", previous.initialCalibration),
    jobs: jobsState.items,
    cancelledMessages: Number(jobsState.cancelledMessages ?? 0),
    waitingForAssistant: Number(jobsState.waitingForAssistant ?? 0),
    bufferedMessages: Number(jobsState.bufferedMessages ?? 0),
    backfillMessages: Number(jobsState.backfillMessages ?? 0),
    bufferedTurns: Number(jobsState.bufferedTurns ?? 0),
    protectedTurns: Number(jobsState.protectedTurns ?? 0),
    bufferedSourceTokens: Number(jobsState.bufferedSourceTokens ?? 0),
    extractionGroupTurns: Number(jobsState.extractionGroupTurns ?? 6),
    recoverableMessages: Number(jobsState.recoverableMessages ?? 0),
    historicalBackfillMessages: Number(jobsState.historicalBackfillMessages ?? 0),
    ingestionState: jobsState.ingestionState,
    recallLogs: value("recallLogs", { items: previous.recallLogs }).items,
    adminChats,
    lineage,
    jobsError: requested.has("jobs")
      ? chatCalls.get("jobs")?.status === "rejected" ? String((chatCalls.get("jobs") as PromiseRejectedResult).reason) : undefined
      : previous.jobsError,
    adminError: adminCall.status === "rejected" ? String(adminCall.reason) : undefined,
    contextError: optionalContext.error,
    error: healthCall.status === "rejected" ? String(healthCall.reason) : undefined,
    connectionIssue: healthCall.status === "rejected" ? describeServerConnectionIssue(state.settings, healthCall.reason) : undefined,
  };
}

/** One stylesheet per skin; components share markup and each sheet draws it. */
export const dashboardStylesheet = (skin: DashboardSkin = "film"): string => skin === "phone" ? PHONE_CSS : FILM_CSS;

function applyDashboardSkin(skin: DashboardSkin): void {
  setSkin(skin);
  document.documentElement.dataset.skin = skin;
  const style = document.getElementById("rcm-style");
  if (style) style.textContent = dashboardStylesheet(skin);
}

export const filmTheme = (preferredTheme?: RuntimeState["settings"]["dashboardTheme"]): "night" | "day" => preferredTheme === "light" ? "day" : "night";

export function scheduleDashboardRetry(
  key: string,
  isCurrent: (key: string) => boolean,
  retry: () => void | Promise<void>,
  delayMs = 3_000,
): () => void {
  let cancelled = false;
  const timer = setTimeout(() => {
    if (!cancelled && isCurrent(key)) void retry();
  }, delayMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

async function applyDashboardTheme(preferredTheme?: RuntimeState["settings"]["dashboardTheme"]): Promise<void> {
  document.documentElement.dataset.theme = filmTheme(preferredTheme);
}

export async function openDashboard(state: RuntimeState, client: ServerClient): Promise<void> {
  document.documentElement.lang = "ko";
  document.documentElement.dataset.theme = filmTheme(state.settings.dashboardTheme);
  setSkin(state.settings.dashboardSkin);
  document.documentElement.dataset.skin = state.settings.dashboardSkin;
  document.title = "Risu Cognitive Memory";
  if (!document.getElementById("rcm-style")) {
    document.head.innerHTML = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@112..125,400..600&display=swap"><style id="rcm-style">${dashboardStylesheet(state.settings.dashboardSkin)}</style>`;
  } else applyDashboardSkin(state.settings.dashboardSkin);
  document.body.className = "film";
  document.body.innerHTML = '<div id="app" class="app" aria-busy="true"></div>';
  const root = document.getElementById("app")!;
  installMenuController(root);
  let focusSettings = state.dashboardFocusSettings;
  state.dashboardFocusSettings = undefined;
  let activeTab: Tab = focusSettings ? "settings" : "overview";
  let nowFilter: NowFilter = "all";
  let nowSort: NowSort = "recent";
  const nowView: NowView = { mode: "now", selected: "", mobileDetail: false, listOnly: false };
  const sentView: SentView = { open: false, more: new Set() };
  const promiseStatusInFlight = new Set<string>();
  const landmarkPatchQueue = new MemoryLandmarkPatchQueue<any>();
  const currentMemoryLandmarks = (memoryId: string): any[] => {
    const memory = data.memories.find((item) => item.id === memoryId);
    if (!memory) return [];
    if (!Array.isArray(memory.landmarkKinds)) memory.landmarkKinds = [];
    return memory.landmarkKinds;
  };
  let worldEditor: WorldEditor | undefined;
  // An editor opened from 현재 replaces the page until it is saved or cancelled.
  let worldEditorOnNow = false;
  let selectedMemory = "";
  const organizationView = createOrganizationView();
  let organizationChatId = state.current?.chatId;
  const timelineView: TimelineViewState = { query: "", landmarkOnly: false, bookmarkedOnly: false, pinnedOnly: false, includeInactive: false, editing: false, creating: false, mobileDetail: false };
  // The chip's quiz opens the dashboard on the scene a question came from.
  const focusMemoryId = state.dashboardFocusMemoryId;
  state.dashboardFocusMemoryId = undefined;
  if (focusMemoryId) { activeTab = "timeline"; selectedMemory = focusMemoryId; timelineView.mobileDetail = true; }
  const storyView: StoryViewState = { selectedGroupId: "", query: "", indexOpen: false, expandedMemoryId: "", editingOverview: false };
  const peopleView: PeopleViewState = { selectedId: "", query: "", prominence: "all", editing: false, mobileDetail: false, management: "" };
  const navigationStack = new NavigationStack();
  let selectedRelationship = "";
  let relationshipSection = "state";
  let relationshipEditing = false;
  let relationshipEditingDirection = "";
  let relationshipTier = "all";
  let relationshipPerson = "";
  let relationshipMobileDetail = false;
  let relationshipQuery = "";
  let pairDiaryFilter: PairDiaryFilter = "all";
  let pairDiarySort: PairDiarySort = "newest";
  let anniversaryEditorEntryId = "";
  let intimacyEditor: IntimacyEditor | undefined;
  let socialEditor: SocialEditor | undefined;
  let entityMergePreview: any | undefined;
  let entityDeletePreview: any | undefined;
  let voyageSaveState: ActionState | undefined;
  let actionSaveState: ActionState | undefined;
  let actionSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let settingsSaving = false;
  let quizActionBusy = false;
  let connectionCheckBusy = false;
  let voyageSaveBusy = false;
  const attentionView: AttentionViewState = { selectedId: "", query: "", filter: "all", mobileDetail: false };
  let settingsSection: SettingsSection = focusSettings ? "model" : "chat";
  /** Phone skin on a phone: a settings section shows as its own screen over the section list. */
  let settingsSectionOpen = Boolean(focusSettings);
  let data: DashboardData = { ...emptyData(), connectionIssue: state.serverConnectionIssue };
  let dashboardOpen = true;
  let refreshGeneration = 0;
  let dashboardRetryCancel: (() => void) | undefined;
  let dashboardRetryAttemptKey = "";
  let refreshing = true;
  let activityWasBusy = false;
  let lastServerActivitySignature = "";
  let lastLiveDataSignature = "";
  let activityRefreshPending = false;
  let formDirty = false;
  let newDataAvailable = false;
  let pendingData: DashboardData | undefined;
  let renderedPageTab: Tab | undefined;
  let renderedPageContent = "";
  let deferredPageRender = false;
  const dataView: DataViewState = { inventoryStatus: "idle", inventory: [], query: "", filter: "all" };
  let cacheStats: TranslationCacheStats = { items: 0, bytes: 0, maxItems: 50_000, maxBytes: 128 * 1024 * 1024 };
  const translations: TranslationView = new Map();
  const translationRequested = new Set<string>();
  let translationRetryTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingTranslationPatches = new Set<string>();
  let translationObserver: IntersectionObserver | undefined;
  let unsubscribeActivity: (() => void) | undefined;
  const activeCanonicalLanguage = (chatId = state.current?.chatId): MemoryLanguage => dashboardCanonicalLanguage(state, chatId, data.adminChats);

  const applyTimelineSearch = () => {
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
    const showReaderEmpty = !timelineView.creating && data.memories.length > 0 && searchEmpty;
    reader?.querySelectorAll<HTMLElement>(":scope > *").forEach((child) => {
      child.style.display = child.hasAttribute("data-timeline-reader-empty") === showReaderEmpty ? "" : "none";
    });
    root.querySelectorAll<HTMLElement>("#memory-rows > [data-day-header]").forEach((header) => {
      const day = header.dataset.dayHeader;
      header.hidden = !Array.from(root.querySelectorAll<HTMLElement>("#memory-rows > .row")).some((row) => row.dataset.day === day && !row.hidden);
    });
  };

  const applyPeopleSearch = () => {
    const query = peopleView.query.trim().toLocaleLowerCase();
    let visible = 0;
    root.querySelectorAll<HTMLElement>("[data-people-group]").forEach((group) => {
      let groupVisible = 0;
      group.querySelectorAll<HTMLElement>("[data-person-row]").forEach((row) => {
        const match = !query || Boolean((row.dataset.search ?? row.textContent)?.toLocaleLowerCase().includes(query));
        row.hidden = !match;
        if (match) groupVisible += 1;
      });
      group.hidden = groupVisible === 0;
      if (query && groupVisible) {
        if (group instanceof HTMLDetailsElement) group.open = true;
        group.querySelectorAll<HTMLDetailsElement>("details.fold--more").forEach((more) => { more.open = true; });
      }
      visible += groupVisible;
    });
    const count = root.querySelector<HTMLElement>("[data-people-count]");
    if (count) count.textContent = `${visible}명`;
    const empty = root.querySelector<HTMLElement>("[data-people-search-empty]");
    if (empty) empty.hidden = visible > 0;
  };


  const applyStorySearch = () => {
    const query = storyView.query.trim().toLocaleLowerCase();
    let visible = 0;
    root.querySelectorAll<HTMLElement>("[data-story-row]").forEach((row) => {
      const match = !query || Boolean(row.textContent?.toLocaleLowerCase().includes(query));
      row.hidden = !match;
      if (match) visible += 1;
    });
    const empty = root.querySelector<HTMLElement>("[data-story-search-empty]");
    if (empty) empty.hidden = !query || visible > 0;
  };

  const applyRelationshipSearch = () => {
    const query = relationshipQuery.trim().toLocaleLowerCase();
    let visible = 0;
    root.querySelectorAll<HTMLElement>("[data-relationship-group]").forEach((group) => {
      let groupVisible = 0;
      group.querySelectorAll<HTMLElement>("[data-relationship-row]").forEach((row) => {
        const match = !query || Boolean((row.dataset.search ?? row.textContent)?.toLocaleLowerCase().includes(query));
        row.hidden = !match;
        if (match) groupVisible += 1;
      });
      group.hidden = groupVisible === 0;
      if (query && groupVisible) {
        if (group instanceof HTMLDetailsElement) group.open = true;
        group.querySelectorAll<HTMLDetailsElement>("details.fold--more").forEach((more) => { more.open = true; });
      }
      visible += groupVisible;
    });
    root.querySelectorAll<HTMLElement>("[data-basic-relation]").forEach(row => {
      row.hidden = Boolean(query) && !row.textContent?.toLocaleLowerCase().includes(query);
      if (!row.hidden) visible += 1;
    });
    const count = root.querySelector<HTMLElement>("[data-relationship-count]");
    if (count) count.textContent = `${visible}개`;
    const empty = root.querySelector<HTMLElement>("[data-relationship-search-empty]");
    if (empty) empty.hidden = visible > 0;
  };

  const applyAttentionSearch = () => {
    const query = attentionView.query.trim().toLocaleLowerCase();
    let visible = 0;
    root.querySelectorAll<HTMLElement>("[data-attention-row]").forEach((row) => {
      const match = !query || Boolean(row.textContent?.toLocaleLowerCase().includes(query));
      row.hidden = !match;
      if (match) visible += 1;
    });
    const empty = root.querySelector<HTMLElement>("[data-attention-search-empty]");
    if (empty) empty.hidden = !query || visible > 0;
  };

  const hasActiveSelection = (): boolean => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    const node = selection.getRangeAt(0).commonAncestorContainer;
    return root.contains(node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement);
  };

  const editorSignature = (form: HTMLFormElement): string => JSON.stringify(Array.from(form.elements).flatMap((element) => {
    const control = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (!control.name) return [];
    return [[control.name, control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio") ? control.checked : control.value]];
  }));

  const setEditorBaselines = (scope: ParentNode = root) => {
    scope.querySelectorAll<HTMLFormElement>(EDITOR_FORM_SELECTOR).forEach((form) => {
      form.dataset.initialSignature = editorSignature(form);
    });
    scope.querySelectorAll<HTMLElement>("[data-dirty-only]").forEach((control) => { control.hidden = true; });
  };

  const editorHasChanges = (): boolean => {
    return Array.from(root.querySelectorAll<HTMLFormElement>(EDITOR_FORM_SELECTOR))
      .some((form) => form.dataset.initialSignature !== undefined && editorSignature(form) !== form.dataset.initialSignature);
  };

  const prepareRelationshipSheetSwitch = async (): Promise<boolean> => {
    formDirty = editorHasChanges();
    const reset = relationshipSheetEditorsAfterSwitch(formDirty,
      !formDirty || await confirmDashboard("저장하지 않은 관계 변경을 버릴까요?"));
    if (!reset) return false;
    ({ intimacyEditor, relationshipEditing, relationshipEditingDirection, anniversaryEditorEntryId, socialEditor, worldEditor, worldEditorOnNow } = reset);
    formDirty = false;
    return true;
  };

  const syncEditorDirtyState = () => {
    formDirty = editorHasChanges();
    root.querySelectorAll<HTMLElement>("[data-dirty-only]").forEach((control) => { control.hidden = !formDirty; });
  };

  const persistSettingsForm = async (form: HTMLFormElement) => {
    if (connectionCheckBusy) throw new Error("연결 확인이 끝난 뒤 저장해 주세요.");
    maskSecretInputs(root);
    const formData = new FormData(form);
    const values = Object.fromEntries(formData);
    rememberDiagnosticSecrets(["serverToken", "serverLlmApiKey", "mcpApiKey", "translationServerApiKey"].map(name => String(formData.get(name) ?? "")));
    if (!isServerConfigured({ serverUrl: String(values.serverUrl ?? ""), serverToken: String(values.serverToken ?? "") })) {
      throw Object.assign(new Error(SERVER_SETUP_REQUIRED), { code: "SERVER_SETUP_REQUIRED" });
    }
    const nextTranslation=formData.has("translationServerProvider")?readTranslationConnectionSettings(formData):undefined;
    const nextMcp=formData.has("mcpModel")?readMcpSelectorSettings(formData):undefined;
    const includeUserMessages = formData.has("includeUserMessages");
    const chatEnabled = formData.has("chatEnabled");
    const chatEnabledById = { ...state.settings.chatEnabled };
    const catchUpPending = { ...state.settings.chatCatchUpPending };
    const chatWasEnabled = state.current ? isChatMemoryEnabled(state.settings, state.current.chatId) : false;
    if (state.current) {
      chatEnabledById[state.current.chatId] = chatEnabled;
      if (!chatWasEnabled && chatEnabled) catchUpPending[state.current.chatId] = true;
      if (!chatEnabled) delete catchUpPending[state.current.chatId];
    }
    const perChat = { ...state.settings.includeUserMessages };
    if (state.current) perChat[state.current.chatId] = includeUserMessages;
    const memoryOnlyByChat = { ...state.settings.memoryOnlyInjection };
    if (state.current) memoryOnlyByChat[state.current.chatId] = formData.has("memoryOnlyInjection");
    const extractionGroupTurns = Math.min(50, Math.max(1, Math.round(Number(values.extractionGroupTurns ?? 6))));
    const sourceProtectionTurns = Math.min(20, Math.max(1, Math.round(Number(values.sourceProtectionTurns ?? 10))));
    const editProtectionTurns = Math.min(5, Math.max(1, Math.round(Number(values.editProtectionTurns ?? 2))));
    const customRules: CanonicalRemovalRule[] = Array.from(form.querySelectorAll<HTMLElement>("[data-regex-rule]")).map((row) => ({
      name: row.querySelector<HTMLInputElement>('input[name="customRuleName"]')?.value.trim() ?? "",
      enabled: row.querySelector<HTMLInputElement>('input[name="customRuleEnabled"]')?.checked === true,
      pattern: row.querySelector<HTMLInputElement>('input[name="customRulePattern"]')?.value ?? "",
      flags: row.querySelector<HTMLInputElement>('input[name="customRuleFlags"]')?.value.trim() || "gis",
    }));
    for (const [index, rule] of customRules.entries()) {
      if (!rule.name) throw new Error(`추가 제외 규칙 ${index + 1}의 이름을 입력하세요.`);
      const error = validateCanonicalRemovalRule(rule);
      if (error) throw new Error(`추가 제외 규칙 ${index + 1}: ${error}`);
    }
    const perChatGroupTurns = { ...state.settings.extractionGroupTurns };
    if (state.current) perChatGroupTurns[state.current.chatId] = extractionGroupTurns;
    const memoryLanguage = ["en", "ko", "ja", "zh"].includes(String(values.memoryLanguage)) ? String(values.memoryLanguage) as "en" | "ko" | "ja" | "zh" : "en";
    const memoryLanguages = { ...state.settings.memoryLanguages };
    if (state.current) memoryLanguages[state.current.chatId] = memoryLanguage;
    const allowedMemoryBudgets = new Set([4_000, 6_000, 8_000, 12_000]);
    const defaultMemoryBudget = allowedMemoryBudgets.has(Number(values.defaultMemoryBudget))
      ? Number(values.defaultMemoryBudget) as 4000 | 6000 | 8000 | 12000
      : 6000;
    const memoryBudgets = { ...state.settings.memoryBudgets };
    if (state.current) {
      if (values.chatMemoryBudget === "inherit") delete memoryBudgets[state.current.chatId];
      else if (allowedMemoryBudgets.has(Number(values.chatMemoryBudget))) memoryBudgets[state.current.chatId] = Number(values.chatMemoryBudget) as 4000 | 6000 | 8000 | 12000;
    }
    const nextServerConnection = {
      serverUrl: String(values.serverUrl).trim().replace(/\/$/, ""),
      serverToken: String(values.serverToken).trim(),
    };
    resetQuizSupportForConnectionChange(state, state.settings, nextServerConnection);
    let verifiedHealth = data.health;
    const bootstrappingServerConnection = settingsConnectionNeedsHealthProbe(state.settings, nextServerConnection, verifiedHealth);
    if (bootstrappingServerConnection) {
      const previousSettings = state.settings;
      state.settings = { ...state.settings, ...nextServerConnection };
      try {
        verifiedHealth = await client.request<any>("/v1/health");
      } finally {
        state.settings = previousSettings;
      }
    }
    if (verifiedHealth?.ok && Number(verifiedHealth.apiRevision ?? 0) !== RCM_API_REVISION) {
      throw new Error(`RCM API revision mismatch: expected ${RCM_API_REVISION}, received ${String(verifiedHealth.apiRevision ?? "unknown")}`);
    }
    if (state.current && memoryLanguage !== (state.settings.memoryLanguages[state.current.chatId] ?? "en")
      && (Number(verifiedHealth?.apiRevision ?? 0) !== RCM_API_REVISION || !verifiedHealth?.capabilities?.multilingualCanonicalMemory)) {
      throw new Error("현재 RCM 서버 계약에서만 기억 정본 언어를 변경할 수 있습니다.");
    }
    const perspectives = { ...state.settings.perspectives };
    const perspectiveNames = String(values.perspectives ?? "").split(/[,\n]/).map((name) => name.trim()).filter(Boolean);
    if (state.current) perspectives[state.current.chatId] = [...new Set(perspectiveNames)].slice(0, 4);
    const extractionEngine: ServerLlmPublicConfig["engine"] = values.extractionEngine === "server" ? "server" : "risu";
    if (extractionEngine === "server" && (Number(verifiedHealth?.apiRevision ?? 0) !== RCM_API_REVISION || !verifiedHealth?.serverLlm || !verifiedHealth?.capabilities?.serverServiceTier)) {
      throw new Error("RCM 서버 계약이 맞지 않습니다. 현재 빌드로 업데이트하고 재시작한 뒤 다시 저장하세요.");
    }
    if (state.settings.extractionEngine === "risu" && extractionEngine === "server" && state.workerBusy) {
      throw new Error("현재 Risu 보조모델 호출이 끝난 뒤 처리 방식을 변경하세요. 실행 중인 Risu 호출은 API로 취소할 수 없습니다.");
    }
    const previousTranslationProvider = state.settings.translationProvider;
    const memoryToolsWereEnabled = state.settings.memoryToolsEnabled;
    const quizWasEnabled = state.settings.quizEnabled === true;
    state.settings = { ...state.settings, ...nextServerConnection, extractionEngine, postExtractionReview: formData.has("postExtractionReview"), auxiliaryMode: String(values.auxiliaryMode) as any, staticModel: String(values.staticModel), ...translationSettings(values), translationDisplay: values.translationDisplay === "en" ? "en" : "ko", autoTranslate: values.translationDisplay !== "en", statusWidgetVisible: formData.has("statusWidgetVisible"), quizEnabled: formData.has("quizEnabled"), dashboardTheme: values.dashboardTheme === "light" ? "light" : "dark", dashboardSkin: values.dashboardSkin === "phone" ? "phone" : "film", defaultMemoryBudget, memoryBudgets, mcpCap: Number(values.mcpCap), memoryToolsEnabled: formData.has("memoryToolsEnabled"), chatEnabled: chatEnabledById, chatCatchUpPending: catchUpPending, includeUserMessages: perChat, memoryOnlyInjection: memoryOnlyByChat, sourceProtectionTurns, editProtectionTurns, canonicalizationPolicy: { useLightboard: formData.has("useLightboard"), useGigaTrans: true, customRules }, extractionGroupTurns: perChatGroupTurns, memoryLanguages, perspectives };
    if (state.current) {
      state.current.includeUserMessages = includeUserMessages;
      state.current.memoryOnlyInjection = memoryOnlyByChat[state.current.chatId] ?? false;
      state.current.sourceProtectionTurns = sourceProtectionTurns;
      state.current.editProtectionTurns = editProtectionTurns;
      state.current.canonicalizationPolicy = state.settings.canonicalizationPolicy;
      state.current.extractionGroupTurns = extractionGroupTurns;
      state.current.memoryLanguage = memoryLanguage;
      state.lastPromptValidation = chatEnabled ? undefined : { chatId: state.current.chatId, status: "disabled", at: Date.now() };
      if (!chatEnabled) {
        state.automaticTurnPacket = undefined;
        state.activeModelRequest = undefined;
      }
    }
    await saveSettings(state.settings);
    if (verifiedHealth?.ok) data.health = verifiedHealth;
    const serverConfigured = isServerConfigured(state.settings);
    state.serverConnectionIssue = serverConfigured ? undefined : describeServerConnectionIssue(state.settings);
    state.activityStatusError = undefined;
    state.activityReady = !serverConfigured;
    state.publishActivity?.();
    if (memoryToolsWereEnabled !== state.settings.memoryToolsEnabled) {
      const registration = state.settings.memoryToolsEnabled
        ? state.restoreMemoryToolDiscoveryRegistration?.()
        : state.syncMemoryToolRegistration?.(false);
      await registration?.catch((error) => addLog(state.logs, "warn", `Memory tool registration update failed: [오류 원문 제외]`));
      state.automaticTurnPacket = undefined;
      if (!state.settings.memoryToolsEnabled) showActionSaveState({ kind: "success", message: "기억 도구를 중지했습니다. 수동 설치한 외부 도구는 Provider 설정에서도 꺼주세요." });
    }
    await syncQuizSettings(state, client, quizWasEnabled);
    if (state.current) state.current = await readCurrentContext(state);
    const apiKey = String(values.serverLlmApiKey ?? "").trim();
    const nextServerLlm = {
      engine: extractionEngine,
      maxInputTokens: Number(values.maxInputTokens ?? verifiedHealth?.serverLlm?.maxInputTokens ?? 80000),
      maxOutputTokens: Number(values.maxOutputTokens ?? verifiedHealth?.serverLlm?.maxOutputTokens ?? 24000),
      embeddingTimeoutMs: Number(values.embeddingTimeoutSeconds ?? (verifiedHealth?.serverLlm?.embeddingTimeoutMs ?? 15000) / 1000) * 1000,
      rerankTimeoutMs: Number(values.rerankTimeoutSeconds ?? (verifiedHealth?.serverLlm?.rerankTimeoutMs ?? 45000) / 1000) * 1000,
      llmTimeoutMs: Number(values.llmTimeoutSeconds ?? (verifiedHealth?.serverLlm?.llmTimeoutMs ?? 300000) / 1000) * 1000,
      ...readServerModelConnection(formData),
    };
    if (serverConfigured && serverLlmUpdateRequiredForSettingsSave(bootstrappingServerConnection, verifiedHealth?.serverLlm, nextServerLlm, apiKey)) {
      const result = await client.request<{ worker: ServerWorkerStatus }>("/v1/admin/server-llm", {
        method: "PUT",
        body: JSON.stringify({ ...nextServerLlm, ...(apiKey ? { apiKey } : {}) }),
      });
      state.serverWorker = result.worker;
    }
    if(serverConfigured&&nextTranslation) {
      const current=data.health?.translationConnection;
      if(Boolean(nextTranslation.apiKey)||!current||Object.entries(nextTranslation).some(([key,value])=>key!=="apiKey"&&(current as any)[key]!==value)) {
        const response=await client.request<{config:TranslationConnectionPublicConfig}>("/v1/admin/translation",{method:"PUT",body:JSON.stringify(nextTranslation)});
        if(data.health)data.health.translationConnection=response.config;
        const key=root.querySelector<HTMLInputElement>('[name="translationServerApiKey"]');if(key)key.value="";
      }
    }
    if(serverConfigured&&nextMcp) {
      const currentMcp=data.health?.mcpSelector;
      const changed=Boolean(nextMcp.apiKey)||!currentMcp||Object.entries(nextMcp).some(([key,value])=>key!=="apiKey"&&(currentMcp as any)[key]!==value);
      if(changed){
        const response=await client.request<{config:McpSelectorPublicConfig}>("/v1/admin/mcp-selector",{method:"PUT",body:JSON.stringify(nextMcp)});
        if(data.health)data.health.mcpSelector=response.config;
        if(state.lastPrepare)state.lastPrepare.mcpRequestTimeoutMs=mcpRequestTimeoutMs(response.config);
        const keyField=root.querySelector<HTMLInputElement>('[name="mcpApiKey"]');if(keyField)keyField.value="";
      }
    }
    if (serverConfigured && state.current && chatWasEnabled && isChatMemoryEnabled(state.settings, state.current.chatId)) {
      state.lastPrepare = await client.prepare(makePrepareRequest(await readCurrentContext(state), 0, { deferExtraction: false }), 5_000);
    }
    if (previousTranslationProvider !== state.settings.translationProvider) {
      translations.clear(); translationRequested.clear();
      if (previousTranslationProvider === "google" && state.settings.translationProvider !== "google" && state.current && data.health?.instanceId) {
        const chatId = state.current.chatId;
        const records = await loadCurrentChatTranslationSources(state, client, chatId, { serverInstanceId: data.health.instanceId, memoryLanguage: dashboardCanonicalLanguage(state, chatId, data.adminChats) }, () => state.current?.chatId === chatId);
        const google = await googleTranslationRecords(state, records);
        if (google.length) {
          const calls = planTranslation(google.map((r, i) => ({ id: String(i), text: r.text })), translationOutputBudget(state)).length;
          const tokens = google.reduce((sum, r) => sum + estimateTranslationTokens(r.text), 0);
          if (await confirmDashboard(`이미 Google로 번역된 항목이 ${google.length}개 있어요. 보조 모델로 다시 번역할까요? 예상: 호출 약 ${calls}회 · 원문 약 ${tokens.toLocaleString()}토큰`, false, { title: "참고 번역", cancel: "그대로 두기", confirm: "다시 번역", keep: true })) {
            void retranslateGoogleRecords(state, google).then(() => { translations.clear(); translationRequested.clear(); render(); });
          }
        }
      }
    }
    if (serverConfigured && !state.settings.workerPaused) void drainWorker(state, client);
  };

  const loadDataInventory = async () => {
    if (dataView.inventoryStatus !== "idle") return;
    dataView.inventoryStatus = "loading";
    render();
    try {
      dataView.inventory = await readHostChatInventory();
      dataView.inventoryStatus = "ready";
    } catch (error) {
      dataView.inventory = [];
      dataView.inventoryStatus = "unavailable";
      addLog(state.logs, "warn", `Risu chat inventory unavailable: [오류 원문 제외]`);
    }
    if (activeTab === "data") render();
  };

  const loadServerInspector = async (chatId: string, offset = 0, includeContent = false) => {
    dataView.inspector = { chatId, loading: true, memories: [], storySpine: [], relationships: [], assertions: [], beliefs: [], promises: [], endedAssertions: [], endedBeliefs: [], userDeletedBeliefs: [], promiseHistory: [], reconciliationReviews: [], conflicts: [] };
    render();
    try {
      const encoded = encodeURIComponent(chatId);
      const ledgerRequest = data.health?.capabilities?.sourceLedgerInspection
        ? client.request<any>(`/v1/admin/chats/${encoded}/source-ledger?offset=${Math.max(0, offset)}&limit=50&includeContent=${includeContent}`)
        : Promise.resolve(undefined);
      const [memories, storySpineState, relationshipsState, worldState, reconciliationState, conflictState, ledger] = await Promise.all([
        client.request<any>(`/v1/chats/${encoded}/memories`),
        client.request<any>(`/v1/chats/${encoded}/story-spine`),
        client.request<any>(`/v1/chats/${encoded}/relationships`),
        client.request<any>(`/v1/chats/${encoded}/world-state?includeHistory=true`),
        client.request<any>(`/v1/chats/${encoded}/reconciliation-reviews`),
        client.request<any>(`/v1/chats/${encoded}/conflicts`),
        ledgerRequest,
      ]);
      dataView.inspector = {
        chatId,
        memories: memories.items ?? [], storySpine: storySpineState, relationships: relationshipsState.items ?? [],
        assertions: worldState.assertions ?? [], beliefs: worldState.beliefs ?? [], promises: worldState.promises ?? [],
        endedAssertions: worldState.endedAssertions ?? [], endedBeliefs: worldState.endedBeliefs ?? [],
        userDeletedBeliefs: worldState.userDeletedBeliefs ?? [], promiseHistory: worldState.promiseHistory ?? [],
        reconciliationReviews: reconciliationState.items ?? [], conflicts: conflictState.items ?? [], ledger,
      };
      const sourceLanguage = activeCanonicalLanguage(chatId);
      if (data.health?.instanceId && state.settings.translationDisplay !== "en" && sourceLanguage !== "ko") {
        const cached = await readCachedTranslations(state, (memories.items ?? []).flatMap((memory: any) => [
          { serverInstanceId: data.health!.instanceId, chatId, sourceLanguage, kind: "memory-title", itemId: `${memory.id}:title`, text: String(memory.title ?? "") },
          { serverInstanceId: data.health!.instanceId, chatId, sourceLanguage, kind: "memory-content", itemId: `${memory.id}:content`, text: String(memory.content ?? "") },
        ]), state.settings.translationProvider);
        cached.forEach((item) => translations.set(item.itemId, item.translated));
      }
    } catch (error) {
      dataView.inspector = { chatId, error: String(error), memories: [], storySpine: [], relationships: [], assertions: [], beliefs: [], promises: [], endedAssertions: [], endedBeliefs: [], userDeletedBeliefs: [], promiseHistory: [], reconciliationReviews: [], conflicts: [] };
    }
    if (activeTab === "data") render();
  };

  const exportCompleteBackup = async (chatId?:string) => {
    if (dataView.backupExportPhase) return;
    try {
      dataView.backupExportError = undefined;
      dataView.backupExportChatId=chatId;
      dataView.backupExportPhase = "creating"; render();
      const response = await requestBackupArchive(client, state, chatId);
      const blob = await response.blob();
      dataView.backupExportPhase = "downloading"; render();
      triggerBackupDownload(blob, `rcm-${chatId?`chat-${chatId.replace(/[^a-zA-Z0-9_-]/g,"_")}`:"complete"}-backup-${new Date().toISOString().slice(0, 10)}.zip`);
    } finally {
      dataView.backupExportPhase = undefined;
      dataView.backupExportChatId = undefined;
      render();
    }
  };

  const restoreChatBackup = async (bytes: ArrayBuffer) => {
    const response=await client.raw("/v1/import/chat",{method:"POST",headers:{"Content-Type":"application/zip"},body:backupRequestBody(bytes)},180_000);
    const restored=await response.json() as any;
    invalidateRestoredChatState(state,restored.chatId);
    state.settings.serverInstances[state.settings.serverUrl.replace(/\/$/,"")]=restored.serverInstanceId;
    restoreChatSettings(state.settings,restored.chatId,restored.chatSettings);
    await saveStoredJson(CACHE_KEY,state.cache);
    await saveSettings(state.settings);
    await alertDashboard("채팅의 RCM 기록과 설정을 복원했습니다.");
    await refresh();
  };

  const restoreCompleteBackup = async (bytes: ArrayBuffer) => {
    const response = await client.raw("/v1/import/restore", { method: "POST", headers: { "Content-Type": "application/zip" }, body: backupRequestBody(bytes) }, 180_000);
    const restored = await response.json() as any;
    for(const chatId of new Set([...Object.keys(state.cache),...(state.current?[state.current.chatId]:[])]))invalidateRestoredChatState(state,chatId);
    await saveStoredJson(CACHE_KEY,state.cache);
    if (supportedSettingsRevision(restored.pluginSettings?.settingsRevision)) {
      state.settings = mergeCompleteBackupSettings(state.settings, restored.pluginSettings);
      await saveSettings(state.settings);
    }
    addLog(state.logs, "info", `Complete memory backup restored (${Number(restored.vectorsRestored ?? 0)} vectors)`);
    await alertDashboard("기억 복원이 완료되었습니다. 현재 서버 주소와 토큰은 유지되었습니다. 복원된 임베딩·보조 모델 키와 서버 설정을 적용하려면 RCM 서버를 재시작해 주세요.");
    await refresh();
  };

  const transplantChatBackup = async (bytes: ArrayBuffer, sourceChatId: string) => {
    if (!state.current) throw new Error("현재 채팅을 찾지 못했습니다.");
    const targetChatId = state.current.chatId;
    if (!data.adminChats.some((chat) => chat.id === targetChatId)) await syncCompleteSourceLedger(client, await readCurrentContext(state, { snapshotMode: "full" }));
    const path = `/v1/import/transplant?sourceChatId=${encodeURIComponent(sourceChatId)}&targetChatId=${encodeURIComponent(targetChatId)}`;
    const response = await client.raw(path, { method: "POST", headers: { "Content-Type": "application/zip" }, body: backupRequestBody(bytes) }, 180_000);
    const result = await response.json() as any;
    invalidateRestoredChatState(state,targetChatId);
    await saveStoredJson(CACHE_KEY,state.cache);
    addLog(state.logs, "info", `Memory transplanted without re-extraction (${Number(result.memories ?? 0)} memories)`);
    await refresh();
  };

  const activeDisplay = (): TranslationDisplay => activeCanonicalLanguage() === "ko" ? "en" : state.settings.translationDisplay;
  const datasetsLoaded = (tab: Tab): boolean => dashboardDatasetsForTab(tab).every((dataset) => data.loadedDatasets?.includes(dataset));
  const activeContent = () => !state.current && !["data", "settings"].includes(activeTab) ? noActiveChat(data, activeTab, state)
    : activeTab === "overview" ? overview(state, data, translations, datasetsLoaded("overview"), sentView)
    : activeTab === "initial" ? initialCalibrationPage(data, peopleView, translations, activeDisplay(), entityMergePreview, socialEditor, entityDeletePreview)
    : activeTab === "story" ? storySpinePage(data, translations, storyView, koreanTranslationEnabled(state.settings.autoTranslate, state.settings.translationDisplay, activeCanonicalLanguage()), activeCanonicalLanguage(), state.current ? state.settings.storyOverviewBackups[state.current.chatId] : undefined, datasetsLoaded("story"))
    : activeTab === "timeline" ? organizationView.open ? memoryOrganization(organizationView, data.memories, translations, activeDisplay()) : timeline(data, selectedMemory, translations, timelineView, koreanTranslationEnabled(state.settings.autoTranslate, state.settings.translationDisplay, activeCanonicalLanguage()), activeCanonicalLanguage(), state.translationActivity?.error)
      : activeTab === "relationships" ? relationshipsV2(state, data, selectedRelationship, translations, activeDisplay(), entityMergePreview, intimacyEditor, relationshipSection, relationshipEditing, relationshipTier, relationshipMobileDetail, relationshipQuery, socialEditor, worldEditor, relationshipEditingDirection, pairDiaryFilter, pairDiarySort, anniversaryEditorEntryId)
        : activeTab === "world" ? worldEditor && worldEditorOnNow ? `<div class="now-edit">${worldEditorPanel(data, worldEditor, "현재")}</div>`
            : renderNowPage(data, data.personaEntity, nowFilter, nowSort, promiseStatusInFlight, translations, activeDisplay(), nowView)
          : activeTab === "reviews" ? attentionPage(data, translations, activeDisplay(), attentionView)
            : activeTab === "conflicts" ? conflicts(data)
              : activeTab === "operations" ? operations(state, data)
                : activeTab === "data" ? dataManagement(state, data, dataView, translations)
                  : settingsV2(state, data, settingsSection, voyageSaveState, voyageSaveBusy, cacheStats, settingsSectionOpen);

  const patchTranslatedMemory = (memory: any) => {
    if (!dashboardOpen || activeTab !== "timeline" || formDirty) return;
    if (hasActiveSelection()) { pendingTranslationPatches.add(memory.id); return; }
    render();
  };

  const scheduleTranslationRetry = () => {
    if (!dashboardOpen || translationRetryTimer !== undefined) return;
    const cooldownMs = state.settings.translationProvider === "google" ? googleTranslationCooldownMs() : 0;
    translationRetryTimer = setTimeout(() => {
      translationRetryTimer = undefined;
      if (dashboardOpen) render();
    }, cooldownMs || 60_000);
  };

  const deferTranslationRetry = () => {
    if (!dashboardOpen || translationRetryTimer !== undefined) return true;
    if (state.settings.translationProvider === "google" && googleTranslationCooldownMs()) {
      scheduleTranslationRetry();
      return true;
    }
    return false;
  };

  const queueMemoryTranslation = async (memory: any, force = false) => {
    const sourceLanguage = activeCanonicalLanguage();
    if (!state.settings.autoTranslate || state.settings.translationDisplay === "en" || sourceLanguage === "ko" || !state.current || !data.health?.instanceId) return;
    if (deferTranslationRetry()) return;
    const provider = state.settings.translationProvider;
    const requestKey = `${memory.id}:${provider}:${memory.updated_at}`;
    if (!force && translationRequested.has(requestKey)) return;
    translationRequested.add(requestKey);
    const records = memoryTranslationRecords(memory, data).map(record => ({ ...record,
      serverInstanceId: data.health!.instanceId, chatId: state.current!.chatId, sourceLanguage }));
    const results = await translateRecords(state, records, provider);
    if (results.some((result) => result.error)) {
      translationRequested.delete(requestKey);
      scheduleTranslationRetry();
    }
    for (const result of results) {
      if (!result.error) translations.set(result.itemId, result.translated);
    }
    if (isServerConfigured(state.settings)) cacheStats = await translationCacheStats(state).catch(() => cacheStats);
    patchTranslatedMemory(memory);
  };

  const hydrateCachedMemoryTranslations = async (next: DashboardData) => {
    const sourceLanguage = activeCanonicalLanguage();
    if (!state.current || !next.health?.instanceId || state.settings.translationDisplay === "en" || sourceLanguage === "ko") return;
    const records = (activeTab === "overview"
      ? structuredTranslationRecords(state, next, "overview").map(record => ({ ...record,
        serverInstanceId: next.health!.instanceId, chatId: state.current!.chatId, sourceLanguage }))
      : [...next.memories.flatMap((memory) => [
      { serverInstanceId: next.health!.instanceId, chatId: state.current!.chatId, sourceLanguage, kind: "memory-title", itemId: `${memory.id}:title`, text: String(memory.title ?? "") },
      { serverInstanceId: next.health!.instanceId, chatId: state.current!.chatId, sourceLanguage, kind: "memory-content", itemId: `${memory.id}:content`, text: String(memory.content ?? "") },
    ]), ...storyTranslationRecords(next.storySpine).map((record) => ({ ...record, serverInstanceId: next.health!.instanceId, chatId: state.current!.chatId, sourceLanguage })), ...next.reconciliationReviews.filter((item) => item.status === "pending").flatMap((item) => {
      const candidate = item.candidates.find((value: any) => value.id === item.decision?.targetId) ?? item.candidates[0];
      return [
        { serverInstanceId: next.health!.instanceId, chatId: state.current!.chatId, sourceLanguage, kind: "reconciliation", itemId: `reconciliation:${item.id}:incoming`, text: String(item.incoming?.content ?? item.incoming?.value ?? item.incoming?.title ?? "") },
        { serverInstanceId: next.health!.instanceId, chatId: state.current!.chatId, sourceLanguage, kind: "reconciliation", itemId: `reconciliation:${item.id}:candidate`, text: String(candidate?.value?.content ?? candidate?.value?.value ?? candidate?.value?.title ?? "") },
      ];
    })]).filter((item) => item.text);
    if (!records.length) return;
    const cached = await readCachedTranslations(state, records, state.settings.translationProvider);
    for (const item of cached) translations.set(item.itemId, item.translated);
  };

  const observeVisibleMemories = () => {
    translationObserver?.disconnect();
    if (!state.settings.autoTranslate || state.settings.translationDisplay === "en" || activeCanonicalLanguage() === "ko" || activeTab !== "timeline") return;
    translationObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        const id = (entry.target as HTMLElement).dataset.translateMemory;
        const memory = data.memories.find((item) => item.id === id);
        if (memory) void queueMemoryTranslation(memory);
      }
    }, { root: scrollingRoot(root.querySelector<HTMLElement>("#memory-rows")), threshold: 0.05 });
    root.querySelectorAll<HTMLElement>("[data-translate-memory]").forEach((element) => translationObserver?.observe(element));
    const selected = data.memories.find((item) => item.id === selectedMemory);
    if (selected) void queueMemoryTranslation(selected);
  };

  const queueStructuredTranslations = async () => {
    const sourceLanguage = activeCanonicalLanguage();
    if (!state.settings.autoTranslate || state.settings.translationDisplay === "en" || sourceLanguage === "ko" || !["overview", "story", "world", "initial", "relationships", "reviews"].includes(activeTab) || !state.current || !data.health?.instanceId) return;
    if (deferTranslationRetry()) return;
    const provider = state.settings.translationProvider;
    const source = structuredTranslationRecords(state, data, activeTab, storyView, selectedRelationship, sentView.open);
    const records = source.filter((item) => item.text && !translationRequested.has(`${item.itemId}:${provider}`)).slice(0, 32);
    if (!records.length) return;
    records.forEach((item) => translationRequested.add(`${item.itemId}:${provider}`));
    const results = await translateRecords(state, records.map((record) => ({ ...record, serverInstanceId: data.health!.instanceId, chatId: state.current!.chatId, sourceLanguage })), provider);
    for (const result of results) {
      if (result.error) translationRequested.delete(`${result.itemId}:${provider}`);
    }
    if (results.some((result) => result.error)) scheduleTranslationRetry();
    applyStructuredTranslationCompletion(results, translations, {
      dashboardOpen,
      activeTab,
      formDirty,
      hasActiveSelection: hasActiveSelection(),
      render,
    });
  };

  const renderedHtml = new WeakMap<HTMLElement, string>();
  const setHtmlIfChanged = (element: HTMLElement, next: string) => {
    if (renderedHtml.get(element) === next) return;
    element.innerHTML = next;
    renderedHtml.set(element, next);
  };

  const pencilCount = () => Math.max(0, Number(state.statusSummary?.pendingReviews ?? 0));
  // The bar names a scene the way the reader shows it: its translation while translations are on.
  const crumbMemoryTitle = (memory: any): string => koreanTranslationEnabled(state.settings.autoTranslate, state.settings.translationDisplay, activeCanonicalLanguage())
    ? translations.get(`${memory.id}:title`) ?? "" : "";
  // The memory organization screen sits over the timeline; the bar names it instead of the scene chosen behind it.
  const screenCrumbs = () => {
    const crumbs = buildCrumbs(currentViewSnapshot(), data, navigationStack.toArray(), crumbMemoryTitle);
    return organizationView.open && activeTab === "timeline" ? [...crumbs.slice(0, -1), { label: "기억 정리" }] : crumbs;
  };
  const currentShell = () => renderShell({
    tab: activeTab,
    crumbs: screenCrumbs(),
    translation: state.settings.translationDisplay === "en" ? "en" : "ko",
    pencilCount: pencilCount(),
    chatTitle: state.current?.chatTitle || state.current?.characterName || "",
  });

  const updateTopbar = () => {
    root.querySelectorAll<HTMLButtonElement>("[data-quiz-controls] button").forEach(button => { button.disabled = quizActionBusy || quizManagementBusy(state, data); });
    const topbar = root.querySelector<HTMLElement>(".topbar");
    if (!topbar) return;
    const summary = state.statusSummary;
    const floatingStatus = widgetState(state);
    const quizActivity = floatingStatus.kind === "quiz" ? floatingStatus.label : "";
    const sourceRecovery = state.currentJob?.sourceRecovery === true || state.serverWorker?.activeJob?.sourceRecovery === true;
    const auditing = state.currentJob?.phase === "post_extraction_audit" || state.serverWorker?.phase === "post_extraction_audit";
    const reconciling = state.currentJob?.phase === "state_reconciliation" || state.serverWorker?.phase === "state_reconciliation";
    const activity = refreshing ? "정보 갱신 중" : state.episodeActivity?.status === "holding" ? `에피소드 보류 중 · ${state.episodeActivity.turnCount}턴` : ["queued", "processing"].includes(state.episodeActivity?.status ?? "") ? "에피소드 정리 중" : sourceRecovery ? "원문 발췌 보완 중" : auditing ? "추출 재검수 중" : reconciling ? "상태 장부 대조 중" : (state.currentJob && state.currentJob.kind !== "quiz") || (state.serverWorker?.activeCalls ?? 0) > 0 ? "기억 추출 중" : (summary?.pendingEmbeddings ?? 0) > 0 ? "검색 인덱싱 중" : (state.translationActivity?.pending ?? 0) > 0 ? "번역 중" : quizActivity;
    const workState = dashboardTopbarWorkState(activity && activity === quizActivity ? "" : activity, state.serverConnectionIssue ?? data.connectionIssue);
    const currentStatus = settingsSaving
      ? status("warn", "저장 중…")
      : actionSaveState
      ? status(actionSaveState.kind === "success" ? "ok" : "error", actionSaveState.message)
      : workState ? status(workState.kind, workState.text)
      : state.activityStatusError === SERVER_RESPONSE_DELAYED ? status("warn", "서버 응답 지연")
      : data.error ? status("error", "서버 확인 필요") : data.contextError ? status("warn", "채팅 확인 필요") : !state.current ? status("warn", "활성 채팅 없음") : quizActivity ? status("neutral", quizActivity) : status("ok", "동기화됨");
    setHtmlIfChanged(topbar, currentShell().bar);
    const statusElement = topbar.querySelector<HTMLElement>(".bar__state");
    if (statusElement) statusElement.innerHTML = currentStatus;
    const refreshButton = topbar.querySelector<HTMLButtonElement>('[data-action="refresh"]');
    if (refreshButton) refreshButton.disabled = refreshing;
  };

  const showActionSaveState = (next: ActionState) => {
    actionSaveState = next;
    if (actionSaveTimer) clearTimeout(actionSaveTimer);
    updateTopbar();
    actionSaveTimer = setTimeout(() => {
      actionSaveState = undefined;
      actionSaveTimer = undefined;
      if (dashboardOpen) updateTopbar();
    }, 2_400);
  };

  const updateRegexRuleSummary = () => {
    const rules = Array.from(root.querySelectorAll<HTMLElement>("[data-regex-rule]"));
    const summary = root.querySelector<HTMLElement>(".settings-regex-summary");
    if (summary) setHtmlIfChanged(summary, regexRuleSummary(rules.length, rules.filter((rule) => rule.querySelector<HTMLInputElement>('input[name="customRuleEnabled"]')?.checked).length));
  };

  const updateNavBadges = () => {
    const nav = root.querySelector<HTMLElement>(".nav");
    if (nav) setHtmlIfChanged(nav, currentShell().nav);
  };

  const serverActivitySignature = () => JSON.stringify({
    summary: state.statusSummary,
    worker: state.serverWorker,
    currentJob: state.currentJob?.id,
    workerBusy: state.workerBusy,
  });

  const measurePhoneClamps = () => {
    if (!dashboardOpen || lex().skin !== "phone") return;
    root.querySelectorAll<HTMLDetailsElement>("details.clamp:not([open])").forEach((details) => {
      const text = details.querySelector<HTMLElement>(".clamp__text");
      if (text) details.toggleAttribute("data-fits", text.scrollHeight <= text.clientHeight + 1);
    });
  };
  const onDashboardResize = () => measurePhoneClamps();
  // A clamp opened while it overflowed may fit by the time it is closed again (the window may have grown).
  root.addEventListener("toggle", (event) => {
    if (event.target instanceof HTMLDetailsElement && event.target.classList.contains("clamp") && !event.target.open) measurePhoneClamps();
  }, true);
  window.addEventListener("resize", onDashboardResize, { passive: true });

  // The scene sheet is rendered with the story page; each render shows it modally again and wires its exits.
  let sheetShown = { scene: "", top: 0 };
  const presentSceneSheet = () => {
    const sheet = root.querySelector<HTMLDialogElement>("dialog.scene-sheet");
    if (!sheet || sheet.open) return;
    const again = sheet.dataset.scene === sheetShown.scene;
    sheet.addEventListener("close", () => {
      // A replaced sheet is no longer in the page; only the one the reader closed clears the state.
      if (!sheet.isConnected) return;
      storyView.expandedMemoryId = "";
      storyView.detailSheet = "";
      sheetShown = { scene: "", top: 0 };
      render();
    });
    sheet.addEventListener("click", (event) => { if (event.target === sheet) sheet.close(); });
    // A downward swipe that starts with the text scrolled to its top closes the sheet, as on iOS.
    const body = sheet.querySelector<HTMLElement>(".scene-sheet__body");
    let startY = Number.NaN;
    sheet.addEventListener("touchstart", (event) => { startY = (body?.scrollTop ?? 0) <= 0 ? event.touches[0]?.clientY ?? Number.NaN : Number.NaN; }, { passive: true });
    sheet.addEventListener("touchend", (event) => { if ((event.changedTouches[0]?.clientY ?? 0) - startY > 90) sheet.close(); }, { passive: true });
    body?.addEventListener("scroll", () => { sheetShown.top = body.scrollTop; }, { passive: true });
    // The same scene shown again after a render (a translation arrived) keeps its reading place and does not re-enter.
    if (again) sheet.classList.add("is-shown");
    sheet.showModal();
    if (again && body) body.scrollTop = sheetShown.top;
    else sheetShown = { scene: sheet.dataset.scene ?? "", top: 0 };
  };
  const render = (preservePageScroll = true) => {
    const previousSidebar = root.querySelector<HTMLElement>(".nav");
    const previousRows = root.querySelector<HTMLElement>("#memory-rows");
    const timelineAnchor = (() => {
      if (!previousRows) return undefined;
      const rows = Array.from(previousRows.querySelectorAll<HTMLElement>(":scope > .row[data-id]"));
      const anchor = rows.findLast((row) => row.offsetTop <= previousRows.scrollTop) ?? rows[0];
      return anchor?.dataset.id ? { id: anchor.dataset.id, offset: previousRows.scrollTop - anchor.offsetTop } : undefined;
    })();
    const preservedScroll = new Map(Array.from(root.querySelectorAll<HTMLElement>("[data-preserve-scroll]"))
      .map((element) => [element.dataset.preserveScroll!, { left: element.scrollLeft, top: element.scrollTop }] as const));
    const preservedOpen = new Map(Array.from(root.querySelectorAll<HTMLDetailsElement>("[data-preserve-open]"))
      .map((element) => [element.dataset.preserveOpen!, element.open] as const));
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusAction = previousFocus?.closest<HTMLElement>("[data-action]");
    const focusIdentity = focusAction ? { action: focusAction.dataset.action, id: focusAction.dataset.id } : undefined;
    const focusDisclosure = previousFocus?.closest<HTMLDetailsElement>("[data-preserve-open]");
    const focusDisclosureKey = focusDisclosure?.dataset.preserveOpen;
    const sidebarScroll = { left: previousSidebar?.scrollLeft ?? 0, top: previousSidebar?.scrollTop ?? 0 };
    const pageScroller = documentScroller(root);
    const pageScroll = { left: pageScroller?.scrollLeft ?? 0, top: pageScroller?.scrollTop ?? 0 };
    const rowsScroll = previousRows?.scrollTop ?? 0;
    const content = activeContent();
    if (!root.querySelector(".topbar")) root.innerHTML = '<header class="topbar"></header><main class="main" id="main-content"><div class="subnav"></div><div class="page"></div></main><nav class="nav" aria-label="RCM 메뉴"></nav>';
    const nav = root.querySelector<HTMLElement>(".nav")!;
    const secondaryNav = root.querySelector<HTMLElement>(".subnav")!;
    const page = root.querySelector<HTMLElement>(".page")!;
    updateTopbar();
    setHtmlIfChanged(nav, currentShell().nav);
    const groups = dashboardNavigation(reviewBadgeVisible(state) ? Number(state.statusSummary?.pendingReviews ?? 0) : 0);
    const activeGroupId = dashboardNavGroup(activeTab);
    const activeGroup = groups.find((group) => group.id === activeGroupId) ?? groups[0]!;
    setHtmlIfChanged(secondaryNav, dashboardSecondaryNavigation(activeGroup, activeTab));
    secondaryNav.hidden = activeGroup.items.length === 0;
    const activeElement = document.activeElement as HTMLElement | null;
    const protectFocusedControl = !organizationView.open && page.dataset.tab === activeTab && Boolean(activeElement && page.contains(activeElement) && activeElement.matches("input, select, textarea"));
    const protectDirtyForm = formDirty && EDITABLE_DASHBOARD_TABS.includes(activeTab) && page.dataset.tab === activeTab;
    const pageContent = content;
    const pageUnchanged = page.dataset.tab === activeTab && renderedPageTab === activeTab && renderedPageContent === pageContent;
    let replacedPage = false;
    if (!pageUnchanged && !protectDirtyForm && !protectFocusedControl) {
      page.dataset.tab = activeTab;
      page.innerHTML = pageContent;
      renderedPageTab = activeTab;
      renderedPageContent = pageContent;
      deferredPageRender = false;
      replacedPage = true;
      if (focusSettings === "embedding" && !refreshing) {
        focusSettings = undefined;
        requestAnimationFrame(() => { root.querySelector("#voyage-form")?.scrollIntoView({ block: "center" }); root.querySelector<HTMLInputElement>('[name="voyageApiKey"]')?.focus({ preventScroll: true }); });
      }
    } else if (!pageUnchanged) {
      deferredPageRender = true;
    }
    if ((protectDirtyForm || protectFocusedControl) && newDataAvailable && !page.querySelector(".new-data")) {
      page.insertAdjacentHTML("afterbegin", `<div class="notice new-data" role="status">${icon("clock")}<div><strong>새 데이터 있음</strong><div class="sub">편집 내용을 보호하고 있습니다. 저장하거나 취소하면 최신 서버 데이터를 반영합니다.</div></div></div>`);
    }
    if (!newDataAvailable) page.querySelector(".new-data")?.remove();
    decorateFoldSummaries(page);
    const nextSidebar = root.querySelector<HTMLElement>(".nav");
    const nextRows = root.querySelector<HTMLElement>("#memory-rows");
    root.querySelectorAll<HTMLDetailsElement>("[data-preserve-open]").forEach((element) => {
      if (preservedOpen.get(element.dataset.preserveOpen!)) element.open = true;
    });
    nextSidebar?.scrollTo(sidebarScroll);
    if (preservePageScroll) pageScroller?.scrollTo(pageScroll);
    root.querySelectorAll<HTMLElement>("[data-preserve-scroll]").forEach((element) => {
      const position = preservedScroll.get(element.dataset.preserveScroll!);
      if (position) element.scrollTo(position);
    });
    if (nextRows) {
      const anchor = timelineAnchor && Array.from(nextRows.querySelectorAll<HTMLElement>(":scope > .row[data-id]"))
        .find((row) => row.dataset.id === timelineAnchor.id);
      nextRows.scrollTop = anchor ? anchor.offsetTop + timelineAnchor.offset : rowsScroll;
    }
    if (focusIdentity?.action) {
      Array.from(root.querySelectorAll<HTMLElement>("[data-action]")).find((element) => element.dataset.action === focusIdentity.action && element.dataset.id === focusIdentity.id)?.focus({ preventScroll: true });
    } else if (focusDisclosureKey) {
      root.querySelector<HTMLDetailsElement>(`[data-preserve-open="${focusDisclosureKey}"]`)?.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
    }
    if (activeTab === "timeline") applyTimelineSearch();
    if (activeTab === "story") applyStorySearch();
    if (activeTab === "story") presentSceneSheet();
    if (activeTab === "initial") applyPeopleSearch();
    if (activeTab === "relationships" && relationshipSection !== "acquaintances") applyRelationshipSearch();
    if (activeTab === "reviews") applyAttentionSearch();
    if (replacedPage) setEditorBaselines(page);
    root.setAttribute("aria-busy", "false");
    // Move only each horizontal control, preserving the page and reader positions.
    root.querySelectorAll<HTMLElement>(".tabs, .seg").forEach(control => {
      const selected = control.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"], input:checked')?.closest<HTMLElement>("button, label");
      if (!selected || control.scrollWidth <= control.clientWidth) return;
      const box = control.getBoundingClientRect(), item = selected.getBoundingClientRect();
      if (item.left < box.left) control.scrollLeft += item.left - box.left;
      else if (item.right > box.right) control.scrollLeft += item.right - box.right;
    });
    measurePhoneClamps();
    observeVisibleMemories();
    void queueStructuredTranslations();
  };

  const currentNavigationOwner = () => dashboardScrollOwner(root);

  const currentNavigationScroll = (): number => currentNavigationOwner().read();

  const currentViewSnapshot = (): ViewSnapshot => ({
    tab: activeTab,
    peopleView: { ...peopleView },
    selectedRelationship,
    relationshipPerson,
    relationshipMobileDetail,
    selectedMemory,
    timelineMobileDetail: timelineView.mobileDetail,
    scrollTop: currentNavigationScroll(),
    scrollOwner: currentNavigationOwner().kind,
  });

  const applyNavigationSnapshot = (next: Partial<ViewSnapshot>): void => {
    if (next.peopleView && typeof next.peopleView === "object") Object.assign(peopleView, next.peopleView);
    if (next.selectedRelationship !== undefined) selectedRelationship = next.selectedRelationship;
    if (next.relationshipPerson !== undefined) relationshipPerson = next.relationshipPerson;
    if (next.relationshipMobileDetail !== undefined) relationshipMobileDetail = next.relationshipMobileDetail;
    if (next.selectedMemory !== undefined) selectedMemory = next.selectedMemory;
    if (next.timelineMobileDetail !== undefined) timelineView.mobileDetail = next.timelineMobileDetail;
  };

  const refresh = async (options: { forceApply?: boolean; navigation?: DashboardNavigationRefresh } = {}) => {
    const generation = ++refreshGeneration;
    const requestedTab = activeTab;
    refreshing = true;
    updateTopbar();
    try {
      const refreshed = await loadDashboardData(state, client, { tab: requestedTab, previous: data });
      if (refreshed.chatId === state.current?.chatId) data.quizStatus = refreshed.quizStatus;
      if (organizationChatId !== state.current?.chatId) {
        Object.assign(organizationView, createOrganizationView());
        organizationChatId = state.current?.chatId;
      }
      if (organizationView.open && state.current) {
        organizationView.data = await client.request<OrganizationData>(`/v1/chats/${encodeURIComponent(state.current.chatId)}/memory-organization`);
      }
      const previousIssue = state.serverConnectionIssue;
      if (refreshed.connectionIssue) {
        const confirmed = noteServerConnectionFailure(state, state.settings, refreshed.connectionIssue.kind === "incompatible" ? new ServerCompatibilityError(Number(refreshed.health?.apiRevision)) : new Error(refreshed.error ?? refreshed.connectionIssue.technical ?? refreshed.connectionIssue.detail));
        refreshed.connectionIssue = confirmed;
        if (!confirmed) {
          state.activityReady = true;
          if (previousIssue || state.activityStatusError === SERVER_RESPONSE_DELAYED) state.publishActivity?.();
          refreshing = false;
          updateTopbar();
          return;
        }
      } else noteServerConnectionSuccess(state);
      const connectionChanged = previousIssue?.kind !== state.serverConnectionIssue?.kind
        || previousIssue?.detail !== state.serverConnectionIssue?.detail
        || state.activityReady !== true;
      state.activityReady = true;
      if (connectionChanged) state.publishActivity?.();
      const recovered = await reconcileAutomaticServerPause(state, client, {
        failedJobs: refreshed.jobs.filter((job) => job.status === "failed").length,
        worker: refreshed.health?.serverWorker ?? state.serverWorker,
        available: !refreshed.connectionIssue && !refreshed.jobsError && !refreshed.error && Boolean(refreshed.health?.serverWorker ?? state.serverWorker),
      });
      if (recovered && refreshed.health && state.serverWorker) refreshed.health.serverWorker = state.serverWorker;
      if (generation !== refreshGeneration || !dashboardOpen) return;
      if (activeTab === "reviews") syncReviewActivity(state, refreshed);
      await hydrateCachedMemoryTranslations(refreshed);
      if (generation !== refreshGeneration || !dashboardOpen) return;
      if (shouldDeferDashboardRefresh(options.forceApply === true, formDirty || connectionCheckBusy, activeTab, hasActiveSelection())) {
        pendingData = refreshed;
        newDataAvailable = true;
      } else {
        data = refreshed;
        pendingData = undefined;
        newDataAvailable = false;
      }
      if (!pendingData) {
        const validationTarget = options.navigation?.snapshotAfterRefresh() ?? currentViewSnapshot();
        applyNavigationSnapshot(availableNavigationSnapshot(validationTarget, data));
      }
      if (refreshed.health?.instanceId) {
        const serverUrl = state.settings.serverUrl.replace(/\/$/, "");
        if (state.settings.serverInstances[serverUrl] !== refreshed.health.instanceId) {
          state.settings.serverInstances[serverUrl] = refreshed.health.instanceId;
          await saveSettings(state.settings);
          if (state.current) state.current = await readCurrentContext(state);
        }
      }
      if (refreshed.initialCalibration?.status === "awaiting_confirmation"
        && ["overview", "data", "operations"].includes(activeTab)) activeTab = "initial";
      const timelineMemories = timelineMemoryView(data.memories, timelineView);
      const visibleTimelineIds = new Set([...timelineMemories.matching, ...timelineMemories.topLevel].map((memory) => String(memory.id)));
      if (!visibleTimelineIds.has(selectedMemory)) selectedMemory = timelineDefaultMemoryId(data.memories, timelineView);
      const availableStoryGroups = storyGroups(data.storySpine);
      if (!availableStoryGroups.some((item) => item.key === storyView.selectedGroupId)) {
        const selectedStory = availableStoryGroups.at(-1);
        storyView.selectedGroupId = selectedStory?.key ?? "";
        storyView.expandedMemoryId = "";
        storyView.detailSheet = "";
      }
    } catch (error) {
      console.error("[RCM dashboard] initial data load failed", error);
      const confirmed = noteServerConnectionFailure(state, state.settings, error);
      if (confirmed) data = { ...data, error: String(error), connectionIssue: confirmed };
    } finally {
      if (generation === refreshGeneration) {
        refreshing = false;
        updateTopbar();
      }
    }
    if (generation !== refreshGeneration || !dashboardOpen) return;
    const failed = (data.failedDatasets ?? []).filter((dataset) => dashboardDatasetsForTab(activeTab).includes(dataset));
    if (!failed.length) {
      dashboardRetryCancel?.();
      dashboardRetryCancel = undefined;
      dashboardRetryAttemptKey = "";
    } else {
      const retryKey = `${state.current?.chatId ?? ""}:${activeTab}`;
      if (!dashboardRetryCancel && dashboardRetryAttemptKey !== retryKey) {
        dashboardRetryAttemptKey = retryKey;
        dashboardRetryCancel = scheduleDashboardRetry(retryKey, (key) => {
          const current = dashboardOpen && key === `${state.current?.chatId ?? ""}:${activeTab}`;
          if (!current) dashboardRetryCancel = undefined;
          return current;
        },
        async () => {
          dashboardRetryCancel = undefined;
          await refresh();
        });
      }
    }
    if (!pendingData) render(); else { updateTopbar(); updateNavBadges(); }
  };

  const navigation = createDashboardNavigationController({
    stack: navigationStack,
    getSnapshot: currentViewSnapshot,
    canNavigate: async (next) => {
      if (organizationView.open && !await discardReadyOrganizationCandidate()) return false;
      if (next.tab === "relationships" || (activeTab === "relationships" && (next.selectedRelationship !== undefined || next.tab !== undefined))) {
        return prepareRelationshipSheetSwitch();
      }
      return true;
    },
    applySnapshot: (next) => {
      const nextTab = next.tab ?? activeTab;
      if (activeTab === "settings" && nextTab !== "settings") applyDashboardSkin(state.settings.dashboardSkin);
      if (nextTab === "timeline" && activeTab !== "timeline") timelineView.mobileDetail = false;
      if (nextTab === "initial" && activeTab !== "initial") {
        peopleView.selectedId = "";
        peopleView.editing = false;
        peopleView.mobileDetail = false;
        peopleView.management = "";
      }
      if (nextTab === "relationships" && activeTab !== "relationships") {
        selectedRelationship = "";
        relationshipMobileDetail = false;
      }
      if (nextTab === "relationships" && next.selectedRelationship !== undefined) relationshipSection = "state";
      organizationView.open = false;
      timelineView.creating = false;
      timelineView.editing = false;
      storyView.editingOverview = false;
      storyView.overviewDraft = undefined;
      activeTab = nextTab;
      formDirty = false;
      if (pendingData) {
        data = pendingData;
        pendingData = undefined;
        newDataAvailable = false;
      }
      applyNavigationSnapshot(next);
    },
    render: (next) => {
      render(false);
      if (next.scrollTop !== undefined) {
        currentNavigationOwner().restore(next.scrollTop);
      }
    },
    refresh: (navigationRequest) => refresh({ forceApply: true, navigation: navigationRequest }),
  });
  const navigate = navigation.navigate;
  const personNavigationView = (rawName: string): PeopleViewState => {
    const name = rawName.normalize("NFKC").trim().toLocaleLowerCase();
    const candidates = [...(data.initialCalibration?.entities ?? []), ...data.entities];
    const person = candidates.find((item: any) => [item.name, item.displayName, item.internalName, ...(item.aliases ?? [])]
      .some((value) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase() === name));
    return {
      ...peopleView,
      selectedId: person ? String(person.id) : "",
      query: person ? "" : rawName,
      editing: false,
      mobileDetail: Boolean(person),
      management: "",
    };
  };

  const saveVoyageKey = async (form: HTMLFormElement): Promise<boolean> => {
    if (voyageSaveBusy) return false;
    const apiKey = String(new FormData(form).get("voyageApiKey") ?? "").trim();
    rememberDiagnosticSecrets([apiKey]);
    if (!apiKey) {
      voyageSaveState = { kind: "error", message: "Voyage API key를 입력하세요." };
      render();
      return false;
    }
    voyageSaveBusy = true;
    voyageSaveState = undefined;
    render();
    try {
      await client.request("/v1/admin/voyage-key", { method: "PUT", body: JSON.stringify({ apiKey }) }, 15_000);
      voyageSaveState = { kind: "success", message: "서버 검증을 통과해 저장했습니다. Vector 검색을 사용할 수 있습니다." };
      addLog(state.logs, "info", "Voyage API key validated and saved on the server");
      await refresh();
      return true;
    } catch (error) {
      voyageSaveState = { kind: "error", message: String(error) };
      addLog(state.logs, "error", `Voyage API key save failed: [오류 원문 제외]`, supportFailure("voyage_save", error));
      return false;
    } finally {
      voyageSaveBusy = false;
      render();
    }
  };

  const changeChatProfile = async (profile: RpProfile): Promise<boolean> => {
    if (!state.current || !["companion", "simulation"].includes(profile)) return false;
    if (profile === state.current.profile) { data.error = undefined; return false; }
    const sourceContext = await readCurrentContext(state);
    const transitioningToSimulation = state.current.profile === "companion" && profile === "simulation";
    const backfill = transitioningToSimulation
      ? await chooseSimulationBackfill(sourceContext.estimatedSourceTokens)
      : false;
    if (backfill === undefined) return false;
    const serverHasChat = data.adminChats.some((item) => item.id === state.current?.chatId);
    if (!data.adminError && data.health?.ok && !serverHasChat) {
      if (backfill) {
        await alertDashboard("과거 기록을 다시 추출하려면 먼저 이 채팅의 RCM 서버 연결을 완료해 주세요.");
        return false;
      }
      state.settings.profiles[state.current.chatId] = profile;
      state.current.profile = profile;
      clearDeletedChatState(state, state.current.chatId, false);
      await saveSettings(state.settings);
      addLog(state.logs, "info", "Chat mode saved locally; full backfill is required before server state can be updated");
      render();
      return true;
    }
    let extractionReviewOverride: boolean | undefined;
    if (backfill) {
      requireChatMemoryEnabled(state, state.current.chatId);
      const tokens = sourceContext.estimatedSourceTokens;
      extractionReviewOverride = await chooseExtractionReviewOverride(
        "World Simulation 백필을 재검수할까요?",
        `World Simulation에 필요한 과거 원문 약 ${tokens.toLocaleString()} 입력 토큰을 처리합니다. 2차 재검수는 정확도를 높일 수 있지만 호출량과 비용이 늘어납니다.`,
        state.settings.postExtractionReview,
      );
      if (extractionReviewOverride === undefined) return false;
    }
    const chatId = state.current.chatId;
    const scope = backfill ? serverScopeKey(state.settings, chatId) : undefined;
    const profileRequest = backfill ? withExtractionReviewOverride({ profile, backfill }, extractionReviewOverride as boolean) : { profile, backfill: false };
    await client.request(`/v1/chats/${encodeURIComponent(chatId)}`, { method: "PATCH", body: JSON.stringify(profileRequest) });
    state.settings.profiles[chatId] = profile;
    state.current.profile = profile;
    if (scope) state.settings.backfillApproved[scope] = true;
    await saveSettings(state.settings);
    await refresh({ forceApply: true });
    return true;
  };

  let dragScroll: { element: HTMLElement; pointerId: number; startX: number; scrollLeft: number; moved: boolean } | undefined;
  let suppressDragClickUntil = 0;
  root.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-drag-scroll]");
    if (!element || element.scrollWidth <= element.clientWidth) return;
    dragScroll = { element, pointerId: event.pointerId, startX: event.clientX, scrollLeft: element.scrollLeft, moved: false };
  });
  root.addEventListener("pointermove", (event) => {
    if (!dragScroll || dragScroll.pointerId !== event.pointerId) return;
    const delta = event.clientX - dragScroll.startX;
    if (!dragScroll.moved && Math.abs(delta) < 5) return;
    if (!dragScroll.moved) {
      dragScroll.moved = true;
      // Capturing on pointer-down retargets a normal click to the overflowing
      // rail, so linked-memory buttons stop receiving clicks when the rail is
      // actually scrollable. Capture only after a deliberate drag begins.
      dragScroll.element.setPointerCapture(event.pointerId);
    }
    dragScroll.element.classList.add("is-dragging");
    dragScroll.element.scrollLeft = dragScroll.scrollLeft - delta;
    event.preventDefault();
  });
  const finishDragScroll = (event: PointerEvent) => {
    if (!dragScroll || dragScroll.pointerId !== event.pointerId) return;
    if (dragScroll.moved) suppressDragClickUntil = Date.now() + 250;
    dragScroll.element.classList.remove("is-dragging");
    if (dragScroll.element.hasPointerCapture(event.pointerId)) dragScroll.element.releasePointerCapture(event.pointerId);
    dragScroll = undefined;
  };
  root.addEventListener("pointerup", finishDragScroll);
  root.addEventListener("pointercancel", finishDragScroll);
  root.addEventListener("click", (event) => {
    if (Date.now() < suppressDragClickUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  const discardReadyOrganizationCandidate = async (): Promise<boolean> => {
    const candidateId = organizationView.candidateId;
    const item = candidateId.startsWith("group:")
      ? organizationView.data.groups.find((group) => `group:${group.id}` === candidateId)
      : organizationView.data.regenerations.find((run) => `regeneration:${run.id}` === candidateId);
    if (!candidateId || item?.status !== "ready" || !state.current) return true;
    const confirmed = await confirmDashboard(
      "적용하지 않은 후보를 버릴까요? 이 후보는 다시 열 수 없습니다.",
      false,
      { title: "후보 버리기", confirm: "후보 버리기", cancel: "계속 확인" },
    );
    if (!confirmed) return false;
    try {
      const chat = encodeURIComponent(state.current.chatId);
      if (candidateId.startsWith("group:")) await client.request(`/v1/chats/${chat}/memory-groups/${encodeURIComponent(item.id)}/discard`, { method: "POST" });
      else await client.request(`/v1/chats/${chat}/regenerations/${encodeURIComponent(item.id)}`, { method: "DELETE" }, 120_000);
      organizationView.candidateId = "";
      organizationView.selection = [];
      organizationView.mobileDetail = Boolean(organizationView.focusedId);
      await refresh({ forceApply: true });
      return true;
    } catch (error) {
      organizationView.error = error instanceof Error ? error.message : String(error);
      render();
      return false;
    }
  };

  root.addEventListener("click", async (event) => {
    const clickedElement = event.target as HTMLElement;
    const target = clickedElement.closest<HTMLElement>("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "test-connection") {
      const status = target.closest("[data-connection-check]")?.querySelector<HTMLElement>("[data-connection-result]");
      const form = root.querySelector<HTMLFormElement>("#settings-form");
      if (!status || !form) return;
      if (connectionCheckBusy || settingsSaving) { status.textContent = "진행 중인 확인 또는 저장이 끝난 뒤 다시 시도해 주세요."; return; }
      connectionCheckBusy = true;
      maskSecretInputs(root);
      const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-action="test-connection"], [data-action="save-settings"]')].filter(button => !button.disabled);
      buttons.forEach(button => { button.disabled = true; });
      status.textContent = target.dataset.target === "risu" ? "Risu 응답 확인 중… 호스트의 대기 시간과 출력 설정을 따릅니다." : "응답 확인 중…";
      target.setAttribute("aria-busy", "true");
      try {
        const started = Date.now();
        if (target.dataset.target === "translation" && new FormData(form).get("translationProvider") !== "server") {
          state.translationStats ??= { calls: 0, items: 0 };
          const probe = { ...state, settings: { ...state.settings, ...translationSettings(Object.fromEntries(new FormData(form))) } };
          await callTranslationBatch(probe, [{ id: "connection", text: "Hello", partIndex: 0, partCount: 1 }]);
          state.translationStats = probe.translationStats;
        } else await testSettingsConnection(state, new FormData(form), target.dataset.target ?? "", root.querySelector<HTMLInputElement>('[name="voyageApiKey"]')?.value ?? "");
        const elapsed = Date.now() - started;
        if (status.isConnected) { status.classList.remove("is-error"); status.innerHTML = `${icon("check")}<span>응답 ${(elapsed / 1000).toFixed(1)}초</span>`; }
        addLog(state.logs, "info", `Connection check succeeded (${target.dataset.target})`);
      } catch (error) {
        if (status.isConnected) { status.classList.add("is-error"); status.innerHTML = `${icon("error")}<span>${escapeHtml(error instanceof Error ? error.message : "연결 확인 실패")}</span>`; }
        addLog(state.logs, "warn", `Connection check failed (${target.dataset.target})`, supportFailure("connection_test", error, { target: target.dataset.target }), (error as { detail?: string }).detail);
      } finally {
        connectionCheckBusy = false;
        buttons.forEach(button => { button.disabled = false; });
        target.removeAttribute("aria-busy");
      }
      return;
    }
    if (action === "toggle-secret") {
      toggleSecretInput(target);
      return;
    }
    if (action === "clear-plugin-logs") {
      state.logs.length = 0;
      render();
      showActionSaveState({ kind: "success", message: "기록을 비웠습니다." });
      return;
    }
    if (action === "copy-plugin-diagnostics") {
      const summary = pluginDiagnosticSummary(state, data);
      try {
        try {
          await navigator.clipboard.writeText(summary);
        } catch {
          // Clipboard API may be blocked in the host's plugin iframe.
          const field = document.createElement("textarea");
          field.className = "sr-only";
          field.value = summary;
          document.body.append(field);
          try {
            field.select();
            if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
          } finally { field.remove(); target.focus(); }
        }
        showActionSaveState({ kind: "success", message: "진단 정보를 복사했습니다." });
      } catch {
        showActionSaveState({ kind: "error", message: "복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요." });
      }
      return;
    }
    if (["data-search", "data-filter", "select-probe-source", "ack-delete"].includes(action ?? "")) return;
    // The pair sheet shows one editor at a time; opening another asks before dropping typed changes, then closes the rest.
    if (["edit-relationship", "new-intimacy", "edit-intimacy", "new-anniversary", "designate-anniversary", "edit-address", "new-social", "edit-social", "new-world", "edit-world", "end-world", "delete-world"].includes(action ?? "")
      && activeTab === "relationships") {
      if (editorHasChanges() && !await confirmDashboard("저장하지 않은 변경을 버릴까요?")) return;
      formDirty = false;
      if (!["new-anniversary", "designate-anniversary"].includes(action ?? "")) anniversaryEditorEntryId = "";
    }
    if (action === "restore-crumb") {
      const crumbs = screenCrumbs();
      if (await handleShellNavigationAction(target, crumbs, navigation, navigationStack)) {
        updateTopbar();
      }
      return;
    }
    if (action === "back-relationship-list" && !navigationStack.size && !await prepareRelationshipSheetSwitch()) return;
    if (["open-relationship", "back-relationship-list"].includes(action ?? "") && await handleDashboardNavigationAction(target, {
      navigation,
      showRelationshipList: () => {
        selectedRelationship = "";
        relationshipMobileDetail = false;
        render();
      },
    })) {
      if (action === "open-relationship" && target.dataset.scrollTarget === "pair-diary") {
        await navigation.waitForRefresh();
        root.querySelector<HTMLElement>('[data-pair-section="diary"]')?.scrollIntoView({ block: "start" });
      }
      return;
    }
    if (action === "close") {
      if (organizationView.open && !await discardReadyOrganizationCandidate()) return;
      dashboardOpen = false;
      sentView.packetTranslation = undefined;
      if (translationRetryTimer !== undefined) clearTimeout(translationRetryTimer);
      translationRetryTimer = undefined;
      unsubscribeActivity?.();
      translationObserver?.disconnect();
      window.removeEventListener("resize", onDashboardResize);
      if (actionSaveTimer) clearTimeout(actionSaveTimer);
      dashboardRetryCancel?.();
      dashboardRetryCancel = undefined;
      await closeDashboardContainer(state);
      return;
    }
    if (action === "set-translation-display") {
      const display = target.dataset.display;
      if (display !== "ko" && display !== "en") return;
      await applyTranslationDisplay(state, display, saveSettings, () => render(false));
      return;
    }
    if (action === "tab") {
      dashboardRetryCancel?.();
      dashboardRetryCancel = undefined;
      const nextTab = target.dataset.tab as Tab;
      if (nextTab === "world") nowView.mobileDetail = false;
      sentView.open = false;
      const previousSettingsSection = settingsSection;
      const previousAttentionView = { ...attentionView };
      if (nextTab === "settings" && (SETTINGS_SECTIONS as readonly string[]).includes(target.dataset.settingsSection ?? "")) {
        settingsSection = target.dataset.settingsSection as SettingsSection;
        settingsSectionOpen = true;
      } else if (nextTab === "settings") settingsSectionOpen = false;
      const requestedAttentionFilter = target.dataset.attentionFilter as AttentionFilter | undefined;
      if (nextTab === "reviews" && requestedAttentionFilter && ["all", "duplicate", "conflict", "audit"].includes(requestedAttentionFilter)) {
        attentionView.filter = requestedAttentionFilter;
        attentionView.selectedId = "";
        attentionView.query = "";
        attentionView.mobileDetail = false;
      }
      if (await navigate({
        tab: nextTab, scrollTop: 0, selectedMemory: "", timelineMobileDetail: false,
        selectedRelationship: "", relationshipPerson: "", relationshipMobileDetail: false,
        peopleView: { ...peopleView, selectedId: "", editing: false, mobileDetail: false, management: "" },
      }, { push: false, resetHistory: true })) {
        // A top-level tab opens at its top, never at the previous page's scroll depth.
        documentScroller(root)?.scrollTo({ top: 0 });
      } else {
        settingsSection = previousSettingsSection;
        Object.assign(attentionView, previousAttentionView);
      }
      return;
    }
    if (action === "open-initial-calibration") {
      activeTab = "initial";
      peopleView.selectedId = "";
      peopleView.editing = false;
      peopleView.mobileDetail = false;
      peopleView.management = "";
      formDirty = false;
      render(false);
      void refresh({ forceApply: true });
      return;
    }
    if (action === "add-regex-rule") {
      const list = root.querySelector<HTMLElement>("[data-regex-rules]");
      if (!list) return;
      const disclosure = root.querySelector<HTMLDetailsElement>("[data-regex-disclosure]");
      if (disclosure) disclosure.open = true;
      const shell = document.createElement("div");
      shell.innerHTML = regexRuleEditor({ name: "", enabled: true, pattern: "", flags: "gis" });
      const row = shell.firstElementChild as HTMLElement | null;
      if (!row) return;
      list.append(row);
      const empty = list.querySelector<HTMLElement>("[data-regex-empty]");
      if (empty) empty.hidden = true;
      updateRegexRuleSummary();
      row.querySelector<HTMLInputElement>('input[name="customRuleName"]')?.focus();
      formDirty = true;
      return;
    }
    if (action === "remove-regex-rule") {
      const list = target.closest("[data-regex-rules]");
      target.closest("[data-regex-rule]")?.remove();
      const empty = list?.querySelector<HTMLElement>("[data-regex-empty]");
      if (empty) empty.hidden = Boolean(list?.querySelector("[data-regex-rule]"));
      updateRegexRuleSummary();
      formDirty = true;
      return;
    }
    if (action === "embedding-settings") {
      activeTab = "settings";
      settingsSection = "model";
      settingsSectionOpen = true;
      focusSettings = "embedding";
      render(false);
      return;
    }
    if (action === "settings-section") {
      const next = target.dataset.section as SettingsSection;
      if (!(SETTINGS_SECTIONS as readonly string[]).includes(next)) return;
      maskSecretInputs(root);
      settingsSection = next;
      settingsSectionOpen = true;
      root.querySelectorAll<HTMLElement>("[data-settings-pane]").forEach((pane) => { pane.hidden = pane.dataset.settingsPane !== next; });
      root.querySelectorAll<HTMLElement>('.settingspage .tab[data-action="settings-section"]').forEach((button) => button.setAttribute("aria-selected", String(button.dataset.section === next)));
      root.querySelectorAll<HTMLElement>(".settings-nav__row").forEach((row) => { if (row.dataset.section === next) row.setAttribute("aria-current", "true"); else row.removeAttribute("aria-current"); });
      root.querySelector(".settingspage")?.classList.add("is-open");
      root.querySelectorAll<HTMLElement>("[data-settings-model-extra]").forEach(element => { element.hidden = next !== "model"; });
      if (next === "server" && target.closest(".notice")) root.querySelector<HTMLInputElement>('[name="serverUrl"]')?.focus({ preventScroll: true });
      documentScroller(root)?.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    if (action === "settings-back") {
      maskSecretInputs(root);
      settingsSectionOpen = false;
      root.querySelector(".settingspage")?.classList.remove("is-open");
      documentScroller(root)?.scrollTo({ top: 0 });
      return;
    }
    if (action === "attention-filter") {
      const next = target.dataset.filter as AttentionFilter;
      if (!["all", "duplicate", "conflict", "audit"].includes(next)) return;
      attentionView.filter = next;
      attentionView.selectedId = "";
      attentionView.mobileDetail = false;
      render(false);
      return;
    }
    if (action === "select-attention") {
      attentionView.selectedId = target.dataset.id ?? "";
      attentionView.mobileDetail = Boolean(attentionView.selectedId);
      render(false);
      return;
    }
    if (action === "attention-back") {
      attentionView.mobileDetail = false;
      render(false);
      return;
    }
    if (action === "load-data-inventory") {
      dataView.inventoryStatus = "idle";
      void loadDataInventory();
      return;
    }
    if (action === "apply-probed-lineage" && state.current && state.lineageProbe?.result?.fingerprint) {
      const parentChatId = target.dataset.parentId || state.lineageProbe.selectedParentId;
      if (!parentChatId) return;
      try {
        await client.request(`/v1/chats/${encodeURIComponent(state.current.chatId)}/lineage/apply`, { method: "POST", body: JSON.stringify({ ...lineageProbePayload(await readCurrentContext(state)), parentChatId, fingerprint: state.lineageProbe.result.fingerprint }) }, 60_000);
        await inheritLineageSettings(state, state.current, parentChatId);
        state.lineageProbe = undefined;
        addLog(state.logs, "info", "Read-only lineage match applied without provider calls");
        await refresh({ forceApply: true });
      } catch (error) {
        const failedProbe = state.lineageProbe;
        if (failedProbe) state.lineageProbe = { key: failedProbe.key, status: "failed", result: failedProbe.result, selectedParentId: parentChatId, error: String(error) };
        data.error = String(error);
        render();
      }
      return;
    }
    if (action === "refresh") { await refresh(); return; }
    if (action === "check-update") {
      try {
        await refreshUpdateStatus(state, client, { remote: true, force: true });
      } catch (error) { data.error = error instanceof Error ? error.message : String(error); }
      render();
      await showCompletedProductReleaseNotice(state);
      return;
    }
    if (action === "stage-server-update") {
      if (state.serverConnectionIssue?.kind === "incompatible" || data.connectionIssue?.kind === "incompatible") return;
      target.setAttribute("disabled", "true");
      try {
        const result = await installServerUpdate(state, client);
        if (result.status === "completed") {
          showActionSaveState({ kind: "success", message: `RCM ${result.targetVersion ?? "새 버전"} 서버 업데이트를 완료했습니다.` });
          await refresh({ forceApply: true });
          await showCompletedProductReleaseNotice(state);
        }
        else if (result.status === "failed") data.error = result.message ?? "서버 업데이트를 완료하지 못했습니다.";
      } catch (error) { data.error = error instanceof Error ? error.message : String(error); }
      render();
      return;
    }
    if (action === "edit-story-overview") {
      const overview = data.storySpine?.overview;
      if (!overview) return;
      storyView.editingOverview = true;
      storyView.overviewDraft = String(overview.summary ?? "");
      formDirty = false;
      render(false);
      window.requestAnimationFrame(() => root.querySelector<HTMLTextAreaElement>('#story-overview-form textarea[name="summary"]')?.focus());
      return;
    }
    if (action === "load-story-overview-backup" && state.current) {
      const backup = state.settings.storyOverviewBackups[state.current.chatId];
      if (!backup) return;
      storyView.editingOverview = true;
      storyView.overviewDraft = backup.summary;
      formDirty = false;
      render(false);
      window.requestAnimationFrame(() => root.querySelector<HTMLTextAreaElement>('#story-overview-form textarea[name="summary"]')?.focus());
      return;
    }
    if (action === "cancel-story-overview") {
      formDirty = editorHasChanges();
      if (formDirty && !await confirmDashboard("저장하지 않은 줄거리 수정을 버릴까요?")) return;
      storyView.editingOverview = false;
      storyView.overviewDraft = undefined;
      formDirty = false;
      if (pendingData) { data = pendingData; pendingData = undefined; newDataAvailable = false; }
      render(false);
      return;
    }
    if (action === "toggle-story-index") {
      storyView.indexOpen = !storyView.indexOpen;
      render(false);
      return;
    }
    if (action === "select-story-season") {
      // A season opens on its latest act, with the episode row back at its start.
      storyView.selectedPart = target.dataset.season ?? "";
      storyView.selectedGroupId = target.dataset.groupId ?? "";
      storyView.expandedMemoryId = "";
      storyView.detailSheet = "";
      render();
      return;
    }
    if (action === "select-story-group") {
      // An episode card or the act index puts that act on screen, in its own season, and brings it into view.
      target.closest<HTMLDetailsElement>("details[data-menu]")?.removeAttribute("open");
      storyView.selectedGroupId = target.dataset.groupId ?? "";
      storyView.selectedPart = target.dataset.season ?? "";
      storyView.expandedMemoryId = "";
      storyView.detailSheet = "";
      render();
      // After render has restored the page position, glide to the act and stop below the sticky act bar.
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const shown = root.querySelector<HTMLElement>(".actview");
        const scroller = documentScroller(root);
        if (!shown || !scroller) return;
        // Only bars that stay pinned while scrolling cover the act.
        const barBottom = Math.max(0, ...Array.from(root.querySelectorAll<HTMLElement>(".topbar, .reelnav"))
          .filter((bar) => /sticky|fixed/u.test(getComputedStyle(bar).position))
          .map((bar) => bar.getBoundingClientRect().bottom));
        scroller.scrollTo({ top: scroller.scrollTop + shown.getBoundingClientRect().top - barBottom - 12, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }));
      return;
    }
    if (action === "toggle-story-memory" || action === "open-story-sheet") {
      const id = target.dataset.memoryId ?? "";
      const previousMain = documentScroller(root);
      const mainPosition = { left: previousMain?.scrollLeft ?? 0, top: previousMain?.scrollTop ?? 0 };
      target.blur();
      storyView.expandedMemoryId = action === "toggle-story-memory" && storyView.expandedMemoryId !== id ? id : "";
      storyView.detailSheet = action === "open-story-sheet" ? target.dataset.sheet ?? "" : "";
      render();
      const restorePosition = () => documentScroller(root)?.scrollTo(mainPosition);
      restorePosition();
      window.requestAnimationFrame(() => {
        restorePosition();
        window.requestAnimationFrame(restorePosition);
      });
      return;
    }
    if ((action === "toggle-story-pin" || action === "toggle-story-hidden" || action === "rebuild-story-spine") && state.current) {
      const chat = encodeURIComponent(state.current.chatId);
      if (action === "rebuild-story-spine") {
        if (!await confirmDashboard("현재 파생 스토리 지도만 다시 만들까요? 정본 기억과 원문은 변경되지 않습니다.")) return;
        await client.request(`/v1/chats/${chat}/story-spine/rebuild`, { method: "POST" });
        void drainWorker(state, client);
      } else {
        await client.request(`/v1/chats/${chat}/story-spine/${encodeURIComponent(target.dataset.groupId ?? "")}`, {
          method: "PATCH",
          body: JSON.stringify(action === "toggle-story-pin" ? { pinned: target.dataset.value === "true" } : { hidden: target.dataset.value === "true" }),
        });
      }
      await refresh({ forceApply: true });
      return;
    }
    if (action === "close-scene-sheet") {
      target.closest<HTMLDialogElement>("dialog")?.close();
      return;
    }
    if (action === "open-timeline-memory") {
      storyView.expandedMemoryId = "";
      storyView.detailSheet = "";
      await navigate({ tab: "timeline", selectedMemory: target.dataset.memoryId ?? "", timelineMobileDetail: true }, { push: true });
      resetTimelineDetailScroll(root);
      return;
    }
    if (action === "pair-diary-filter") {
      const next = target.dataset.value as PairDiaryFilter;
      if (["all", "key", "intimacy", "heart", "promise", "bookmark"].includes(next)) pairDiaryFilter = next;
      render();
      return;
    }
    if (action === "anniversary-pick") {
      // The scene log grows a 지정 button on each scene until one is chosen or the pick is cancelled.
      anniversaryEditorEntryId = `pick:${target.dataset.key ?? ""}`;
      render();
      root.querySelector<HTMLElement>('[data-pair-section="diary"]')?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    if (action === "open-sent-now") {
      nowFilter = "all";
      await handleSentNowNavigation(target, { navigation, getData: () => data, view: nowView, render });
      root.querySelector<HTMLElement>('[data-action="select-now-record"][aria-current="true"]')?.scrollIntoView({ block: "nearest" });
      root.querySelector<HTMLElement>(".readercol")?.scrollIntoView({ block: "start" });
      return;
    }
    if (action === "open-now-record") {
      const key = target.dataset.key ?? "";
      if (!await navigate({ tab: "world" }, { push: true })) return;
      Object.assign(nowView, { mode: "now", selected: key, mobileDetail: Boolean(key), listOnly: false });
      render();
      return;
    }
    if (action === "designate-anniversary") {
      anniversaryEditorEntryId = target.dataset.entryId ?? "";
      formDirty = false;
      render();
      root.querySelector<HTMLInputElement>('#anniversary-form input[name="label"]')?.focus();
      return;
    }
    if (action === "new-anniversary") {
      anniversaryEditorEntryId = `new:${target.dataset.key ?? ""}`;
      intimacyEditor = undefined;
      relationshipEditing = false;
      socialEditor = undefined;
      formDirty = false;
      render();
      root.querySelector<HTMLInputElement>('#anniversary-new-form input[name="label"]')?.focus();
      return;
    }
    if (action === "add-access-holder") {
      const list = root.querySelector(".access-holder-list");
      const index = Math.max(-1, ...Array.from(list?.querySelectorAll<HTMLInputElement>('input[name="holder"]') ?? []).map(input => Number(input.id.replace("access-holder-", "")))) + 1;
      list?.insertAdjacentHTML("beforeend", accessHolderRow("", "witnessed", index));
      list?.querySelector<HTMLInputElement>(`#access-holder-${index}`)?.focus();
      formDirty = true;
      return;
    }
    if (action === "remove-access-holder") {
      target.closest(".access-holder-row")?.remove();
      formDirty = true;
      root.querySelector<HTMLButtonElement>('[data-action="add-access-holder"]')?.focus();
      return;
    }
    if (action === "edit-detail-access") {
      // Selecting a quote for copying must not open its editor on pointer release.
      const selection = root.ownerDocument.getSelection();
      if (target.matches(".lines .subtitle") && event.detail > 0 && selection?.toString()
        && (target.contains(selection.anchorNode) || target.contains(selection.focusNode))) return;
      if (editorHasChanges() && !await confirmDashboard("저장하지 않은 변경을 버릴까요?")) return;
      formDirty = false;
      timelineView.accessEditing = timelineView.accessEditing === target.dataset.detailId
        ? undefined : target.dataset.detailId ?? "";
      render();
      root.querySelector<HTMLInputElement>('#detail-access-form input[name="holder"]')?.focus();
      return;
    }
    if (action === "cancel-detail-access") {
      timelineView.accessEditing = undefined;
      formDirty = false;
      render();
      return;
    }
    if (action === "cancel-anniversary") {
      anniversaryEditorEntryId = "";
      formDirty = false;
      render();
      return;
    }
    if (action === "submit-form") {
      const form = target.dataset.formId
        ? root.querySelector<HTMLFormElement>(`#${target.dataset.formId}`)
        : target.closest<HTMLFormElement>("form");
      if (!form) return;
      if (!form.reportValidity()) return;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      return;
    }
    if (action === "inherit-from-chat") {
      if (!state.current) return;
      const sourceChatId = target.dataset.chatId ?? "";
      if (!sourceChatId) return;
      const button = target as HTMLButtonElement;
      const originalLabel = button.textContent ?? "현재 채팅으로 기억 가져오기";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = "같은 대화인지 확인 중…";
      try {
        const { current, request, mode, preview } = await previewMemoryTransfer(client, state, sourceChatId);
        const eligibleMessages = (request.targetMessageInventory ?? []).filter((item) => item.visibility === "active" && item.role && item.contentHash).length;
        const copy = memoryTransferConfirmation(preview, mode, eligibleMessages);
        const confirmed = await confirmDashboard(copy.message, false, copy);
        if (!confirmed) return;
        button.textContent = "기억 가져오는 중…";
        if (mode === "lineage") {
          await client.request(`/v1/chats/${encodeURIComponent(current.chatId)}/lineage/inherit`, {
            method: "POST",
            body: JSON.stringify({ ...request, fingerprint: preview.fingerprint, replaceDerived: preview.requiresReplacement === true }),
          }, 120_000);
          addLog(state.logs, "info", `동일한 대화 원문 ${preview.commonMessages}개를 확인해 현재 채팅으로 기억을 가져왔습니다.`);
        } else {
          await client.request(`/v1/chats/${encodeURIComponent(current.chatId)}/memory-transplant`, {
            method: "POST",
            body: JSON.stringify({ sourceChatId, fingerprint: preview.fingerprint, replaceDerived: preview.requiresReplacement === true }),
          }, 120_000);
          addLog(state.logs, "info", "메시지 ID 연결이 없어 보관된 기억을 현재 채팅의 독립 기록으로 가져왔습니다.");
        }
        await refresh({ forceApply: true });
        await alertDashboard(mode === "lineage"
          ? "같은 대화 원문을 연결하고 기억을 가져왔어요. 확인된 원문은 다시 처리하지 않습니다."
          : "보관된 기억을 독립 기록으로 가져왔어요. 현재 채팅 원문은 별도로 처리될 수 있습니다.");
      } catch (error) {
        await alertDashboard(`기억을 가져오지 못했어요.\n\n${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.removeAttribute("aria-busy");
          button.textContent = originalLabel;
        }
      }
      return;
    }
    if (action === "view-server-data") { await loadServerInspector(target.dataset.chatId ?? ""); return; }
    if ((typeof __RCM_DISTRIBUTION__ === "undefined" || !__RCM_DISTRIBUTION__) && action === "toggle-retrieval-diagnostics") {
      const chatId = target.dataset.chatId ?? "";
      try {
        const enabled = await setRetrievalDiagnostics(client, data, chatId, target.dataset.enabled !== "true");
        addLog(state.logs, "info", `Retrieval diagnostics ${enabled ? "enabled" : "disabled"} for chat ${chatId}`);
        render();
      } catch (error) { data.error = String(error); render(); }
      return;
    }
    if (action === "close-server-inspector") { dataView.inspector = undefined; render(); return; }
    if (action === "reveal-ledger-content" && dataView.inspector) { await loadServerInspector(dataView.inspector.chatId, dataView.inspector.ledger?.offset ?? 0, true); return; }
    if (action === "ledger-page" && dataView.inspector) { await loadServerInspector(dataView.inspector.chatId, Number(target.dataset.offset ?? 0), dataView.inspector.ledger?.includesContent === true); return; }
    if (action === "export-complete-backup" || action === "export-chat-backup") { try { const chatId=action==="export-chat-backup"?(target.dataset.chatId||state.current?.chatId):undefined;if(action==="export-chat-backup"&&!chatId)throw new Error("백업할 채팅을 선택해주세요.");await exportCompleteBackup(chatId); } catch (error) { dataView.backupExportError = error instanceof Error ? error.message : String(error); render(); } return; }
    if (action === "open-data-operation") {
      dataView.confirmation = { action: target.dataset.operation as DataConfirmation["action"], chatId: target.dataset.chatId ?? "" };
      render(); return;
    }
    if (action === "cancel-data-operation") { dataView.confirmation = undefined; render(); return; }
    if (action === "confirm-data-operation" && dataView.confirmation) {
      const { action: operation, chatId } = dataView.confirmation;
      try {
        if (operation === "rebuild") requireChatMemoryEnabled(state, chatId);
        const extractionReviewOverride = operation === "rebuild"
          ? await chooseExtractionReviewOverride(
            "전체 기억을 재검수할까요?",
            "전체 원문을 다시 추출한 뒤 보조 모델이 각 그룹의 결과를 한 번 더 검토할 수 있습니다. 정확도는 높아질 수 있지만 호출량과 비용이 늘어납니다.",
            state.settings.postExtractionReview,
          )
          : undefined;
        if (operation === "rebuild" && extractionReviewOverride === undefined) return;
        const path = operation === "rebuild" ? `/v1/chats/${encodeURIComponent(chatId)}/reprocess`
          : `/v1/chats/${encodeURIComponent(chatId)}`;
        let rebuildContext: Awaited<ReturnType<typeof readCurrentContext>> | undefined;
        let expectedSourceMessages: number | undefined;
        if (operation === "rebuild" && state.current?.chatId === chatId) {
          rebuildContext = await readCurrentContext(state, { snapshotMode: "full" });
          const synced = await syncCompleteSourceLedger(client, rebuildContext);
          expectedSourceMessages = synced.expectedSourceMessages;
          const serverUrl = state.settings.serverUrl.replace(/\/$/, "");
          state.settings.serverInstances[serverUrl] = synced.serverInstanceId;
          await saveSettings(state.settings);
        }
        const resolvedSetup = operation === "rebuild" && state.lastResolvedSetup?.chatId === chatId
          ? state.lastResolvedSetup.projection
          : undefined;
        const result = await client.request<any>(path, {
          method: operation === "rebuild" ? "POST" : "DELETE",
          ...(operation === "rebuild" ? {
            body: JSON.stringify(withExtractionReviewOverride({
              activatePendingMemoryLanguage: true,
              resolvedSetup,
              identityHints: rebuildContext?.identityHints,
              expectedSourceMessages,
            }, extractionReviewOverride as boolean)),
          } : {}),
        }, operation === "rebuild" ? 120_000 : 30_000);
        if (operation === "rebuild" && state.current?.chatId === chatId && !state.settings.workerPaused) void drainWorker(state, client);
        if (operation === "delete") {
          clearDeletedChatState(state, chatId);
          if (data.chatId === chatId) {
            ++refreshGeneration; // Ignore reads started before the deletion.
            data = { ...emptyData(), chatId, health: data.health, adminChats: data.adminChats.filter(item => item.id !== chatId) };
            pendingData = undefined;
            newDataAvailable = false;
            Object.assign(organizationView, createOrganizationView());
            render();
          }
          await invalidateTranslationCache(state, { chatId });
          await saveSettings(state.settings);
        }
        addLog(state.logs, "info", operation === "rebuild"
          ? result.awaitingCalibration
            ? "Initial setup analysis queued; confirm the setup ledger before transcript extraction starts"
            : `Ledger rebuild queued: ${Number(result.queuedJobs ?? 0)} job(s)`
          : `Data operation completed: ${operation}`);
        if (operation === "rebuild" && result.awaitingCalibration) activeTab = "initial";
        dataView.confirmation = undefined;
        if (dataView.inspector?.chatId === chatId) dataView.inspector = undefined;
        await refresh({ forceApply: operation === "delete" });
      } catch (error) {
        const message = String(error);
        data.error = message.includes("(INITIAL_SETUP_REQUIRED)")
          ? "초기 장부를 만들려면 이 채팅의 최종 설정문을 먼저 불러와야 합니다. 새 플러그인을 설치한 뒤 모델 요청을 한 번 실행하고, 페이지를 새로고침하지 않은 상태에서 다시 시도하세요. 응답 생성을 시작한 뒤 취소해도 됩니다. 기존 기억은 삭제되지 않았습니다."
          : message;
        render();
      }
      return;
    }
    if (action === "select-lineage" && state.current) {
      const selectedChatId = data.chatId ?? state.current.chatId;
      const current = await readCurrentContext(state);
      if (current.chatId !== selectedChatId) {
        await refresh();
        await alertDashboard('채팅이 변경되었습니다. 현재 채팅에서 다시 선택해 주세요.');
        return;
      }
      try {
        await client.request(`/v1/chats/${encodeURIComponent(current.chatId)}/lineage/select`, { method: "POST", body: JSON.stringify({ ...lineageProbePayload(current), parentChatId: target.dataset.parentId,
          fingerprint: data.lineage?.ambiguousCandidates?.find(item => item.chatId === target.dataset.parentId)?.fingerprint }) }, 30_000);
      } catch (error) {
        if (!String(error).includes('LINEAGE_PROBE_STALE')) throw error;
        await refresh();
        await alertDashboard('원문이나 원본 기억이 변경되어 상속을 적용하지 않았습니다. 목록을 확인하고 다시 선택해 주세요.');
        return;
      }
      await refresh(); return;
    }
    if (action === "decline-lineage" && state.current) {
      await client.request(`/v1/chats/${encodeURIComponent(state.current.chatId)}/lineage/decline`, { method: "POST", body: JSON.stringify({ fingerprint: target.dataset.fingerprint }) }, 15_000);
      await refresh(); return;
    }
    if (action === "acknowledge-lineage" && state.current) {
      await client.request(`/v1/chats/${encodeURIComponent(state.current.chatId)}/lineage/acknowledge`, { method: "POST" }, 30_000);
      await refresh(); return;
    }
    if (action === "revert-lineage" && state.current) {
      if (!await confirmDashboard("상속된 기억과 파생 상태를 비우고, 현재 Risu 원문만으로 다시 시작할까요? Risu 원문은 변경되지 않습니다.")) return;
      await client.request(`/v1/chats/${encodeURIComponent(state.current.chatId)}/lineage/revert`, { method: "POST" }, 30_000);
      await refresh(); return;
    }
    if (action === "select-memory") {
      formDirty = editorHasChanges();
      if (formDirty && !await confirmDashboard("저장하지 않은 정본 변경을 버리고 다른 기억을 열까요?")) return;
      formDirty = false;
      navigation.supersede();
      selectedMemory = target.dataset.id ?? "";
      const memory = data.memories.find((item) => item.id === selectedMemory);
      timelineView.editing = false;
      timelineView.creating = false;
      timelineView.mobileDetail = true;
      render(false);
      resetTimelineDetailScroll(root);
      if (memory) void queueMemoryTranslation(memory);
      return;
    }
    if (action === "new-manual-memory") {
      formDirty = false;
      timelineView.editing = false;
      timelineView.creating = true;
      timelineView.mobileDetail = true;
      render(false);
      return;
    }
    if (action === "cancel-manual-memory") {
      formDirty = editorHasChanges();
      if (formDirty && !await confirmDashboard("저장하지 않은 기억을 버리고 목록으로 돌아갈까요?")) return;
      formDirty = false;
      timelineView.creating = false;
      timelineView.mobileDetail = false;
      render(false);
      return;
    }
    if (action === "timeline-filter") {
      timelineView.creating = false;
      const filter = target.dataset.filter;
      if (filter === "bookmark") timelineView.bookmarkedOnly = !timelineView.bookmarkedOnly;
      if (filter === "landmark") timelineView.landmarkOnly = !timelineView.landmarkOnly;
      if (filter === "pinned") timelineView.pinnedOnly = !timelineView.pinnedOnly;
      if (filter === "inactive") timelineView.includeInactive = !timelineView.includeInactive;
      const visible = timelineMemoryView(data.memories, timelineView);
      const visibleIds = new Set([...visible.matching, ...visible.topLevel].map((memory) => String(memory.id)));
      if (!visibleIds.has(selectedMemory)) selectedMemory = timelineDefaultMemoryId(data.memories, timelineView);
      timelineView.editing = false;
      render(false);
      return;
    }
    if (action === "timeline-order") {
      timelineView.sortOrder = timelineView.sortOrder !== "ascending" ? "ascending" : "descending";
      render(false);
      return;
    }
    if (action === "edit-memory") {
      timelineView.editing = true;
      render(false);
      return;
    }
    if (action === "timeline-back") {
      formDirty = editorHasChanges();
      if (formDirty && !await confirmDashboard("저장하지 않은 정본 변경을 버리고 목록으로 돌아갈까요?")) return;
      formDirty = false;
      timelineView.editing = false;
      timelineView.creating = false;
      if (navigationStack.size) {
        await navigation.back(() => undefined);
        return;
      }
      timelineView.mobileDetail = false;
      render(false);
      return;
    }
    if (action === "timeline-adjacent" && target.dataset.id) {
      formDirty = editorHasChanges();
      if (formDirty && !await confirmDashboard("저장하지 않은 정본 변경을 버리고 다른 기억을 열까요?")) return;
      formDirty = false;
      selectedMemory = target.dataset.id;
      timelineView.editing = false;
      timelineView.mobileDetail = true;
      render(false);
      resetTimelineDetailScroll(root);
      const memory = data.memories.find((item) => item.id === selectedMemory);
      if (memory) void queueMemoryTranslation(memory);
      return;
    }
    if (action === "cancel-memory-edit") {
      formDirty = editorHasChanges();
      if (formDirty && !await confirmDashboard("저장하지 않은 정본 변경을 버리고 수정 화면을 닫을까요?")) return;
      formDirty = false;
      timelineView.editing = false;
      if (pendingData) { data = pendingData; pendingData = undefined; newDataAvailable = false; }
      render();
      return;
    }
    if (action === "retry-translation") {
      const memory = data.memories.find((item) => item.id === target.dataset.id);
      if (memory) void queueMemoryTranslation(memory, true);
      return;
    }
    if (action === "clear-translation-cache" || action === "clear-chat-translation-cache") {
      if (action === "clear-chat-translation-cache") { if (!state.current) return; await invalidateTranslationCache(state, { chatId: state.current.chatId, serverInstanceId: data.health?.instanceId }); }
      else await clearTranslationCache(state);
      translations.clear();
      translationRequested.clear();
      cacheStats = await translationCacheStats(state);
      render();
      return;
    }
    if (action === "quiz-reset-stats" || action === "quiz-regenerate") {
      const chatId = state.current?.chatId;
      if (!chatId || quizActionBusy || !data.health?.capabilities?.quizManagement) return;
      quizActionBusy = true;
      const controls = root.querySelectorAll<HTMLButtonElement>("[data-quiz-controls] button");
      controls.forEach(button => { button.disabled = true; });
      try {
        const status = await client.quizStatus(chatId);
        if (state.current?.chatId !== chatId) return;
        data.quizStatus = status;
        if (status.generating) {
          showActionSaveState({ kind: "error", message: "퀴즈 만드는 중이에요. 끝난 뒤 다시 시도해 주세요." });
          return;
        }
        const regenerate = action === "quiz-regenerate";
        const message = regenerate
          ? (status.unanswered ? `안 푼 퀴즈 ${status.unanswered}개를 정리하고 새로 만들어요. 보조 모델을 한 번 호출해요.` : "새 퀴즈를 만들어요. 보조 모델을 한 번 호출해요.")
          : "연속 정답·정답률이 0이 돼요. 문제는 그대로예요.";
        if (!await confirmDashboard(message, false, { title: "이 채팅 퀴즈", confirm: regenerate ? "새로 만들기" : "점수 초기화" }) || state.current?.chatId !== chatId) return;
        if (regenerate) {
          const result = await client.quizRegenerate(chatId);
          const reasons = { model_not_configured: "보조 모델을 설정하면 퀴즈를 만들 수 있어요.", no_material: "새로 낼 재료가 아직 없어요", generating: "퀴즈 만드는 중이에요. 끝난 뒤 다시 시도해 주세요.", disabled: "퀴즈 사용을 켜고 저장한 뒤 다시 시도해 주세요." };
          showActionSaveState({ kind: result.enqueued || result.reason === "no_material" || result.reason === "model_not_configured" ? "success" : "error",
            message: result.enqueued ? "새 퀴즈 만들기를 시작했어요." : reasons[result.reason ?? "no_material"] });
        } else {
          await client.quizResetStats(chatId);
          showActionSaveState({ kind: "success", message: "이 채팅의 퀴즈 점수를 초기화했어요." });
        }
        await state.refreshQuizWidget?.();
        await refresh();
      } catch (error) {
        showActionSaveState({ kind: "error", message: `퀴즈 작업을 완료하지 못했어요. ${String(error)}` });
      } finally {
        quizActionBusy = false;
        updateTopbar();
      }
      return;
    }
    if (action === "select-person") {
      navigation.supersede();
      const id = target.dataset.id ?? "";
      peopleView.selectedId = peopleView.selectedId === id ? "" : id;
      peopleView.editing = false;
      peopleView.mobileDetail = Boolean(peopleView.selectedId);
      peopleView.management = "";
      formDirty = false;
      render(false);
      return;
    }
    if (action === "relationship-filter") {
      if (!await prepareRelationshipSheetSwitch()) return;
      const value = target.dataset.value ?? "all";
      if (["all", "primary", "supporting"].includes(value)) relationshipTier = value;
      relationshipMobileDetail = false;
      render(false);
      return;
    }
    if (action === "people-filter") {
      const value = target.dataset.value as PeopleViewState["prominence"];
      if (["all", "primary", "supporting", "reference"].includes(value)) peopleView.prominence = value;
      peopleView.selectedId = "";
      peopleView.editing = false;
      peopleView.mobileDetail = false;
      peopleView.management = "";
      render(false);
      return;
    }
    if (action === "new-person") {
      peopleView.selectedId = "__new__";
      peopleView.editing = true;
      peopleView.mobileDetail = true;
      peopleView.management = "";
      formDirty = false;
      render(false);
      return;
    }
    if (action === "edit-person") {
      peopleView.editing = true;
      peopleView.management = "";
      formDirty = false;
      render(false);
      return;
    }
    if (action === "close-people-management") {
      peopleView.management = "";
      peopleView.mobileDetail = false;
      entityMergePreview = undefined;
      entityDeletePreview = undefined;
      render(false);
      return;
    }
    if (action === "close-person" || action === "close-person-editor") {
      formDirty = editorHasChanges();
      if (formDirty && !await confirmDashboard("저장하지 않은 인물 변경을 버릴까요?")) return;
      const adding = peopleView.selectedId === "__new__";
      formDirty = false;
      peopleView.editing = false;
      if (action === "close-person" && navigationStack.size) {
        await navigation.back(() => undefined);
        return;
      }
      if (action === "close-person" || adding) {
        peopleView.selectedId = "";
        peopleView.mobileDetail = false;
      }
      render(false);
      return;
    }
    if (action === "open-person-relations") {
      await navigate({
        tab: "relationships",
        relationshipPerson: target.dataset.name ?? "",
        selectedRelationship: "",
        relationshipMobileDetail: false,
      }, { push: true });
      return;
    }
    if (action === "open-relationship-person") {
      await navigate({
        tab: "initial",
        peopleView: personNavigationView(target.dataset.personName ?? ""),
      }, { push: true });
      return;
    }
    if (action === "open-now-owner") {
      await navigate({ tab: "initial", peopleView: personNavigationView(target.dataset.owner ?? "") }, { push: true });
      return;
    }
    if (action === "open-now-attention") {
      await navigate({ tab: "reviews" }, { push: true });
      return;
    }
    if (action === "now-filter") {
      const next = target.dataset.value as NowFilter;
      if (["all", "promise", "belief", "condition", "goal", "secret"].includes(next)) nowFilter = next;
      render();
      return;
    }
    if (action === "relationship-section") {
      if (!await prepareRelationshipSheetSwitch()) return;
      navigation.supersede();
      relationshipSection = target.dataset.section === "acquaintances" ? "acquaintances" : "state";
      selectedRelationship = "";
      relationshipMobileDetail = false;
      render(); return;
    }
    if (action === "edit-relationship") { intimacyEditor = undefined; relationshipEditingDirection = target.dataset.directionKey ?? ""; relationshipEditing = true; render(); return; }
    if (action === "close-relationship-editor") {
      formDirty = editorHasChanges();
      if (formDirty && !await confirmDashboard("저장하지 않은 관계 변경을 버릴까요?")) return;
      relationshipEditing = false; relationshipEditingDirection = ""; intimacyEditor = undefined; formDirty = false; render(); return;
    }
    if (action === "reset-relationship-auto") {
      const [from, to] = (target.dataset.key ?? "").split("|");
      if (!from || !to || !state.current) return;
      if (!await confirmDashboard("수동으로 고정한 관계 요약과 값을 해제하고, 저장된 초기 상태와 관계 변화를 기준으로 다시 계산할까요?\n\n완료 전까지 현재 값이 표시될 수 있습니다.")) return;
      const chat = encodeURIComponent(state.current.chatId);
      const result = await client.request<{ ok: boolean }>(`/v1/chats/${chat}/relationships`, { method: "PATCH", body: JSON.stringify({ from, to, clear: true }) });
      if (!result.ok) throw new Error("자동 계산으로 되돌리지 못했습니다.");
      relationshipEditing = false;
      relationshipEditingDirection = "";
      formDirty = false;
      await refresh({ forceApply: true });
      showActionSaveState({ kind: "success", message: "수동 수정을 해제하고 관계를 다시 계산하고 있습니다." });
      return;
    }
    if (action === "now-mode") {
      const next = target.dataset.value === "past" ? "past" : "now";
      if (nowView.mode !== next) { nowView.mode = next; nowView.selected = ""; nowView.mobileDetail = false; }
      render(); return;
    }
    if (action === "select-now-record") {
      // On a wide screen, choosing the open record again closes the reader and leaves the list alone.
      if (window.matchMedia("(min-width: 900px)").matches && target.getAttribute("aria-current") === "true") {
        nowView.listOnly = true;
        nowView.selected = "";
        render(); return;
      }
      nowView.listOnly = false;
      navigation.supersede();
      nowView.selected = target.dataset.key ?? "";
      nowView.mobileDetail = Boolean(nowView.selected);
      render();
      if (nowView.mobileDetail) window.scrollTo({ top: 0 });
      return;
    }
    if (action === "open-sent") {
      navigation.supersede();
      sentView.open = true;
      sentView.more.clear();
      render();
      window.scrollTo({ top: 0 });
      void queueStructuredTranslations();
      return;
    }
    if (action === "translate-sent-packet") {
      const packet = sentView.packetTranslation;
      if (!packet || packet.pending) return;
      if (packet.translated !== undefined) { packet.showing = !packet.showing; render(); return; }
      packet.pending = true; packet.error = undefined; render();
      try {
        const translated = await translatePacket(state, packet.source, activeCanonicalLanguage(), () => dashboardOpen && sentView.packetTranslation === packet);
        if (dashboardOpen && sentView.packetTranslation === packet) { packet.translated = translated; packet.showing = true; }
      } catch (error) {
        const code = (error as { code?: string })?.code ?? "MODEL_CONNECTION_FAILED";
        packet.error = ({ TAG_SEQUENCE_CHANGED: "태그 변경", MISSING_ITEMS: "번역 항목 누락", TIMEOUT: "응답 시간 초과", ABORTED_OR_TIMEOUT: "번역 취소", INVALID_CONFIG: "번역 설정 확인 필요", INVALID_RESPONSE: "응답 형식 오류", MODEL_OUTPUT_TRUNCATED: "번역 응답 잘림", GOOGLE_TRANSLATION_FAILED: "Google 응답 실패", MODEL_CONNECTION_FAILED: "모델 연결 실패" } as Record<string, string>)[code] ?? code;
      } finally { packet.pending = false; if (dashboardOpen) render(); }
      return;
    }
    if (action === "close-sent") {
      sentView.open = false;
      render(); return;
    }
    if (action === "sent-more") {
      sentView.more.add(target.dataset.key ?? "");
      render(); return;
    }
    if (action === "now-back") {
      nowView.mobileDetail = false;
      render(); return;
    }
    if (action === "new-world") {
      const kind = target.dataset.kind as WorldEditor["kind"];
      if (!["assertion", "belief", "promise"].includes(kind)) return;
      if (activeTab === "initial" && target.dataset.social === "true") {
        if (!await navigate({ tab: "relationships", selectedRelationship: "", relationshipPerson: "", relationshipMobileDetail: true }, { push: true })) return;
      }
      worldEditor = { kind, mode: "create", social: target.dataset.social === "true", stateKind: target.dataset.stateKind, subject: target.dataset.personName,
        target: target.dataset.relationTarget, relationKind: target.dataset.relationKind, lockSubject: target.dataset.lockSubject === "true" };
      worldEditorOnNow = activeTab === "world";
      formDirty = false;
      render();
      root.querySelector<HTMLElement>(".world-editor")?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (action === "edit-world" || action === "end-world" || action === "delete-world") {
      const kind = target.dataset.kind as WorldEditor["kind"];
      if (!["assertion", "belief", "promise"].includes(kind) || !target.dataset.id) return;
      if (action === "edit-world" && kind === "promise" && ["kept", "broken"].includes(target.dataset.status ?? "")) {
        if (!state.current) return;
        const promiseId = target.dataset.id;
        const promiseStatus = target.dataset.status!;
        const promiseChat = encodeURIComponent(state.current.chatId);
        const renderPromiseBusyState = () => {
          if (dashboardOpen && activeTab === "world") render();
        };
        await runPromiseStatusMutation(promiseStatusInFlight, promiseId, async () => {
          try {
            const result = await client.request<{ ok: boolean; item?: any }>(`/v1/chats/${promiseChat}/world-state`, {
              method: "PATCH",
              body: JSON.stringify({ kind: "promise", id: promiseId, status: promiseStatus }),
            });
            if (!result.ok || !result.item) throw new Error("약속 상태를 저장하지 못했습니다.");
            data.promises = data.promises.map((item) => item.id === promiseId ? result.item : item);
            await refresh({ forceApply: true });
            showActionSaveState({ kind: "success", message: promiseStatus === "kept" ? "약속을 지킨 것으로 기록했습니다." : "약속이 깨진 것으로 기록했습니다." });
          } catch (error) {
            showActionSaveState({ kind: "error", message: `약속 상태 저장 실패 · ${String(error)}` });
          }
        }, renderPromiseBusyState);
        return;
      }
      // A person's 소속 opens its editor where the relations live, like adding one does.
      if (activeTab === "initial" && target.dataset.social === "true") {
        if (!await navigate({ tab: "relationships", selectedRelationship: "", relationshipPerson: "", relationshipMobileDetail: true }, { push: true })) return;
      }
      worldEditor = { kind, id: target.dataset.id, mode: action === "edit-world" ? "edit" : action === "end-world" ? "end" : "delete", social: target.dataset.social === "true" };
      worldEditorOnNow = activeTab === "world";
      formDirty = false;
      render();
      root.querySelector<HTMLElement>(".world-editor")?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (action === "swap-relation") {
      const form = target.closest<HTMLFormElement>("form");
      const subject = form?.elements.namedItem("subject") as HTMLInputElement | null;
      const other = form?.elements.namedItem("relationTarget") as HTMLInputElement | null;
      if (!form || !subject || !other) return;
      [subject.value, other.value] = [other.value, subject.value];
      syncRelationForm(form);
      syncEditorDirtyState();
      return;
    }
    if (action === "cancel-world-edit") {
      formDirty = false;
      worldEditor = undefined;
      if (pendingData) { data = pendingData; pendingData = undefined; newDataAvailable = false; }
      render();
      return;
    }
    if (action === "new-intimacy") { formDirty = false; relationshipEditing = false; relationshipEditingDirection = ""; intimacyEditor = { participantA: target.dataset.a, participantB: target.dataset.b }; render(); return; }
    if (action === "edit-intimacy") { formDirty = false; relationshipEditing = false; relationshipEditingDirection = ""; intimacyEditor = { id: target.dataset.id }; render(); return; }
    if (action === "cancel-intimacy") {
      formDirty = false;
      intimacyEditor = undefined;
      if (pendingData) { data = pendingData; pendingData = undefined; newDataAvailable = false; }
      render();
      return;
    }
    if (action === "save-settings") {
      if (connectionCheckBusy) return;
      const form = root.querySelector<HTMLFormElement>("#settings-form");
      if (!form) return;
      maskSecretInputs(root);
      settingsSaving = true;
      target.setAttribute("disabled", "");
      updateTopbar();
      try {
        await persistSettingsForm(form);
        const voyageForm = root.querySelector<HTMLFormElement>("#voyage-form");
        const voyageKey = voyageForm ? String(new FormData(voyageForm).get("voyageApiKey") ?? "").trim() : "";
        const voyageSaved = voyageKey ? await saveVoyageKey(voyageForm!) : true;
        if (!voyageSaved) throw new Error("일반 설정은 저장했지만 Voyage 키 검증에 실패했습니다.");
        addLog(state.logs, "info", "Settings persistence verified");
        if (!voyageKey) await refresh();
        settingsSaving = false;
        showActionSaveState({ kind: "success", message: "저장됨" });
      } catch (error) {
        settingsSaving = false;
        addLog(state.logs, "error", `Settings save failed: [오류 원문 제외]`, supportFailure("settings_save", error));
        const attempted = new FormData(form);
        showActionSaveState({ kind: "error", message: settingsSaveFailureMessage(error, {
          serverUrl: String(attempted.get("serverUrl") ?? state.settings.serverUrl).trim(),
          serverToken: String(attempted.get("serverToken") ?? state.settings.serverToken).trim(),
        }) });
      } finally {
        settingsSaving = false;
        target.removeAttribute("disabled");
        updateTopbar();
      }
      return;
    }
    if (action === "save-voyage-key") {
      const form = root.querySelector<HTMLFormElement>("#voyage-form");
      if (form) await saveVoyageKey(form);
      return;
    }
    if (action === "remove-voyage-key") {
      if (!await confirmDashboard("현재 RCM 서버에 저장된 Voyage API key를 제거할까요? 검색은 FTS로 계속됩니다.", false, { confirm: "키 제거", danger: true })) return;
      try {
        await client.request("/v1/admin/voyage-key", { method: "DELETE" });
        addLog(state.logs, "info", "Voyage API key removed from the server");
        await refresh();
      } catch (error) { data.error = String(error); render(); }
      return;
    }
    if(action === "remove-translation-key") {
      try {
        const response=await client.request<{config:TranslationConnectionPublicConfig}>("/v1/admin/translation-key",{method:"DELETE"});
        if(data.health)data.health.translationConnection=response.config;
        render();
      }catch(error){showActionSaveState({kind:"error",message:`번역 인증정보 제거 실패 · ${String(error)}`});}
      return;
    }
    if(action === "remove-mcp-key") {
      try {
        const response=await client.request<{config:McpSelectorPublicConfig}>("/v1/admin/mcp-selector-key",{method:"DELETE"});
        if(data.health)data.health.mcpSelector=response.config;
        render();
      }catch(error){showActionSaveState({kind:"error",message:`MCP 인증정보 제거 실패 · ${String(error)}`});}
      return;
    }
    if (action === "remove-server-llm-key") {
      if (!await confirmDashboard("현재 선택한 프로바이더의 인증정보를 제거할까요? 서버 처리는 즉시 일시정지됩니다.", false, { confirm: "인증정보 제거", danger: true })) return;
      try {
        const result = await client.request<{ worker: ServerWorkerStatus }>("/v1/admin/server-llm-key", { method: "DELETE" });
        state.serverWorker = result.worker;
        state.settings.workerPaused = true;
        await saveSettings(state.settings);
        addLog(state.logs, "info", "Server LLM API key removed; worker paused");
        await refresh();
      } catch (error) { data.error = String(error); render(); }
      return;
    }
    if (!state.current) return;
    const chat = encodeURIComponent(state.current.chatId);
    try {
      if (action?.startsWith('organization-') || action === 'related-source') {
        organizationView.error = undefined;
        try {
          const id = target.dataset.id ?? '';
          const leavesCandidate = ['organization-close', 'organization-list', 'organization-back-detail', 'organization-detail', 'organization-select', 'organization-candidate'].includes(action ?? '');
          if (leavesCandidate && !await discardReadyOrganizationCandidate()) return;
          if (action === 'organization-close') organizationView.open = false;
          else if (action === 'organization-list') { organizationView.mobileDetail = false; organizationView.candidateId = ''; }
          else if (action === 'organization-back-detail') { organizationView.candidateId = ''; organizationView.mobileDetail = Boolean(organizationView.focusedId); }
          else if (action === 'organization-open' || action === 'related-source') {
            organizationView.open = true; activeTab = 'timeline';
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
            organizationView.focusedId = id; organizationView.candidateId = ''; organizationView.mobileDetail = true;
            organizationView.detail = await client.request(`/v1/chats/${chat}/source-ranges/${encodeURIComponent(id)}`);
          } else if (action === 'organization-candidate') { organizationView.candidateId = id; organizationView.mobileDetail = true; }
          else if (action === 'organization-create-group') {
            requireChatMemoryEnabled(state, state.current.chatId);
            const estimate = await client.request<any>(`/v1/chats/${chat}/memory-groups/preview`, { method: 'POST', body: JSON.stringify({ batchIds: organizationView.selection, postExtractionReview: state.settings.postExtractionReview }) });
            const review = await chooseExtractionReviewOverride('선택한 원문 구간을 묶을까요?',
              `원문 묶음 ${estimate.sourceBatchIds.length}개 · 메시지 ${estimate.messageCount}개\n원문 약 ${estimate.rawTokens.toLocaleString()}토큰 · 전체 예상 입력 약 ${estimate.estimatedInputTokens.toLocaleString()}토큰\n처음 ${estimate.initialCalls}회${estimate.mergeRequired ? ' + 단계별 통합' : ''}로 처리합니다. 재검수를 사용하면 검수 단계가 추가됩니다. 이 수치는 실제 청구량이 아닙니다.\n기존 세부·대사·상태는 보존되며, 결과를 확인한 뒤 적용할 수 있습니다.${estimate.partialIds.length ? ` 범위 밖 근거도 가진 기억 ${estimate.partialIds.length}개는 원래 위치에 남습니다.` : ''}`,
              state.settings.postExtractionReview);
            if (review === undefined) return;
            const created = await client.request<{ runId: string }>(`/v1/chats/${chat}/memory-groups/create`, { method: 'POST', body: JSON.stringify({ batchIds: organizationView.selection, postExtractionReview: review }) });
            organizationView.candidateId = `group:${created.runId}`; organizationView.mobileDetail = true;
            void drainWorker(state, client);
            await refresh({ forceApply: true }); return;
          } else if (action === 'organization-release-hold') {
            const result = await client.request<any>(`/v1/chats/${chat}/episodes/${encodeURIComponent(id)}/release`, { method: 'POST' });
            state.episodeActivity = result.active ?? null;
            await refresh({ forceApply: true }); return;
          } else if (action === 'organization-discard-group' || action === 'organization-discard-regeneration') {
            await discardReadyOrganizationCandidate();
            return;
          } else if (action === 'organization-ungroup' || action.endsWith('-group')) {
            const operation = action === 'organization-ungroup' ? 'ungroup' : action.includes('-apply-') ? 'apply' : action.includes('-discard-') ? 'discard' : 'retry';
            await client.request(`/v1/chats/${chat}/memory-groups/${encodeURIComponent(id)}/${operation}`, { method: 'POST' });
            if (operation !== 'retry') { organizationView.candidateId = ''; organizationView.selection = []; organizationView.mobileDetail = false; }
            else void drainWorker(state, client);
            await refresh({ forceApply: true }); return;
          } else if (action === 'organization-apply-regeneration') {
            await client.request(`/v1/chats/${chat}/regenerations/${encodeURIComponent(id)}/apply`, { method: 'POST' }, 120_000);
            organizationView.candidateId = ''; organizationView.selection = []; organizationView.mobileDetail = false;
            await refresh({ forceApply: true }); return;
          }
        } catch (error) { organizationView.error = error instanceof Error ? error.message : String(error); }
        render();
        if (action === 'organization-select') {
          const control = [...root.querySelectorAll<HTMLInputElement>('[data-action="organization-select"]')].find((input) => input.dataset.id === target.dataset.id);
          control?.focus({ preventScroll: true });
        } else if (action === 'organization-candidate' || action === 'organization-detail') {
          const heading = root.querySelector<HTMLElement>('.organization .reader__title');
          if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
        }
        return;
      }
      if (action === "toggle-anniversary-always" || action === "delete-anniversary" || action === "hide-anniversary") {
        if (action === "hide-anniversary") {
          const hideKey = target.dataset.hideKey ?? "";
          if (!hideKey) return;
          const hiddenAnniversaries = [...new Set([...(data.viewPreferences?.hiddenAnniversaries ?? []), hideKey])];
          data.viewPreferences = await client.putViewPreferences(state.current.chatId, { hiddenAnniversaries });
          render();
          showActionSaveState({ kind: "success", message: "기념일 숨김" });
          return;
        }
        const memoryId = target.dataset.memoryId ?? "";
        const index = Number(target.dataset.landmarkIndex);
        const memory = data.memories.find((item) => item.id === memoryId);
        const landmark = Number.isInteger(index) && Array.isArray(memory?.landmarkKinds) ? memory.landmarkKinds[index] : undefined;
        if (!memory || !landmark) throw new Error("변경할 기념일을 찾지 못했습니다.");
        const deleting = action === "delete-anniversary";
        let appliedIndex = index;
        if (deleting) {
          if (landmark.kind !== "anniversary_basis") throw new Error("사용자가 지정한 기념일만 삭제할 수 있습니다.");
          if (!await confirmDashboard(`기념일 '${String(landmark.label ?? "")}'을 삭제할까요?`, false, { confirm: "기념일 삭제", danger: true })) return;
        }
        await landmarkPatchQueue.enqueue(memoryId,
          () => currentMemoryLandmarks(memoryId),
          (latest) => {
            const next = [...latest];
            appliedIndex = landmarkEntryIndex(next, landmark, index);
            const current = appliedIndex >= 0 ? next[appliedIndex] : undefined;
            if (!current) throw new Error("변경할 기념일을 찾지 못했습니다.");
            if (deleting) next.splice(appliedIndex, 1);
            else next[appliedIndex] = { ...current, alwaysInject: target.dataset.value === "true" };
            return next;
          },
          async (landmarkKinds) => {
            const result = await client.patchMemory(state.current!.chatId, memoryId, { landmarkKinds });
            if (!result.ok) throw new Error("기념일 변경을 저장하지 못했습니다.");
          });
        if (deleting) {
          const hiddenAnniversaries = remapHiddenAnniversariesAfterDelete(
            data.viewPreferences?.hiddenAnniversaries ?? [], memoryId, appliedIndex,
          );
          data.viewPreferences = await client.putViewPreferences(state.current.chatId, { hiddenAnniversaries });
        }
        await refresh({ forceApply: true });
        showActionSaveState({ kind: "success", message: action === "delete-anniversary" ? "기념일 삭제됨" : "항상 전달 설정 저장됨" });
        return;
      }
      if (action === "initial-confirm" || action === "initial-skip" || action === "initial-retry") {
        if (action === "initial-skip" && !await confirmDashboard(data.initialCalibration?.status === "failed"
          ? "초기 분석 없이 원문 기억 생성을 계속할까요? 이름과 별칭은 나중에 인물 설정에서 직접 추가할 수 있습니다."
          : "분석된 초기 이름·관계축을 사용하지 않고 원문 기억 생성을 시작할까요?")) return;
        if (action === "initial-retry" && data.initialCalibration?.status === "awaiting_confirmation"
          && !await confirmDashboard("현재 미확정 이름·초기 관계 장부를 버리고 같은 렌더링 설정으로 다시 분석할까요? 직접 수정한 값도 교체됩니다.")) return;
        if (action === "initial-retry" && ["ready", "inherited", "skipped"].includes(data.initialCalibration?.status ?? "")
          && !await confirmDashboard("현재 인물 설정을 다시 읽을까요? 직접 수정한 초기 이름과 관계값이 새 분석 결과로 바뀔 수 있습니다.")) return;
        const freshSetup = action === "initial-retry" && state.lastResolvedSetup?.chatId === state.current.chatId
          ? state.lastResolvedSetup.projection
          : undefined;
        const result = await client.request<{ calibration: InitialCalibrationActivity }>(`/v1/chats/${chat}/initial-calibration/${action === "initial-confirm" ? "confirm" : action === "initial-skip" ? "skip" : "retry"}`, {
          method: "POST",
          ...(freshSetup ? { body: JSON.stringify({ resolvedSetup: freshSetup, identityHints: state.current.identityHints }) } : {}),
        }, 120_000);
        state.statusSummary = {
          ...(state.statusSummary ?? { queuedJobs: 0, failedJobs: 0, pendingReviews: 0, pendingEmbeddings: 0, failedEmbeddings: 0 }),
          initialCalibration: result.calibration,
        };
        state.publishStatusSummary?.();
        void drainWorker(state, client);
        await refresh({ forceApply: true });
      } else if (action === "save-initial-entity" || action === "add-initial-entity") {
        const form = target.closest<HTMLFormElement>("form");
        if (!form?.reportValidity()) return;
        const values = new FormData(form);
        const payload = { displayName: String(values.get("displayName") ?? "").trim(), aliases: String(values.get("aliases") ?? "").split(",").map((item) => item.trim()).filter(Boolean), prominence: String(values.get("prominence") ?? "supporting") };
        const id = action === "save-initial-entity" ? encodeURIComponent(target.dataset.id ?? "") : "";
        await client.request(`/v1/chats/${chat}/initial-calibration/entities${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
        formDirty = false;
        peopleView.editing = false;
        if (!id) { peopleView.selectedId = ""; peopleView.mobileDetail = false; }
        await refresh({ forceApply: true });
      } else if (action === "delete-initial-entity") {
        const name = target.dataset.name ?? "이 인물";
        if (!await confirmDashboard(`${name}을(를) 초기 이름 장부에서 삭제할까요? 연결된 초기 관계축도 함께 제거됩니다.`, false, { confirm: "인물 삭제", danger: true })) return;
        await client.request(`/v1/chats/${chat}/initial-calibration/entities/${encodeURIComponent(target.dataset.id ?? "")}`, { method: "DELETE" });
        formDirty = false;
        peopleView.selectedId = "";
        peopleView.editing = false;
        peopleView.mobileDetail = false;
        await refresh({ forceApply: true });
      } else if (action === "save-initial-relationship") {
        const form = target.closest<HTMLFormElement>("form");
        if (!form) return;
        const values = new FormData(form);
        const axes = Object.fromEntries(["affection", "trust", "intimacy", "fear", "jealousy", "hostility"].map((axis) => [axis, String(values.get(axis) ?? "unknown")]));
        await client.request(`/v1/chats/${chat}/initial-calibration/relationships/${encodeURIComponent(target.dataset.id ?? "")}`, { method: "PATCH", body: JSON.stringify({ axes, summary: String(values.get("summary") ?? "") }) });
        formDirty = false;
        await refresh({ forceApply: true });
      } else if (action === "go-entity-merge") {
        activeTab = "initial";
        peopleView.selectedId = "";
        peopleView.editing = false;
        peopleView.mobileDetail = true;
        peopleView.management = "merge";
        render(false);
      } else if (action === "delete-intimacy") {
        await client.request(`/v1/chats/${chat}/physical-intimacy/${encodeURIComponent(target.dataset.id ?? "")}`, { method: "DELETE" });
        intimacyEditor = undefined;
        await refresh({ forceApply: true });
        showActionSaveState({ kind: "success", message: "스킨십 기록 삭제됨" });
      } else if (action === "confirm-end-world" || action === "confirm-delete-world") {
        const kind = target.dataset.kind as WorldEditor["kind"];
        const itemId = target.dataset.id ?? "";
        const mode = action === "confirm-end-world" ? "end" : "delete";
        await client.request(`/v1/chats/${chat}/world-state/${encodeURIComponent(kind)}/${encodeURIComponent(itemId)}?mode=${mode}`, { method: "DELETE" });
        showActionSaveState({ kind: "success", message: mode === "end" ? "종료됨" : "삭제됨" });
        await invalidateTranslationCache(state, { serverInstanceId: data.health?.instanceId, chatId: state.current.chatId, itemIdPrefix: `${kind}:${itemId}` });
        translations.delete(`${kind}:${itemId}`);
        formDirty = false;
        worldEditor = undefined;
        nowView.selected = "";
        nowView.mobileDetail = false;
        if (pendingData) { data = pendingData; pendingData = undefined; newDataAvailable = false; }
        addLog(state.logs, "info", `${kind} ${mode === "end" ? "ended" : "deleted"} in the ledger`);
      } else if (action === "resolve-reconciliation") {
        const reviewId = target.dataset.id ?? "";
        const resolution = target.dataset.resolution as "merge" | "distinct" | "update" | "discard";
        const review = data.reconciliationReviews.find((item) => item.id === reviewId);
        if (!review) return;
        const form = root.querySelector<HTMLFormElement>(`.reconciliation-edit[data-review-id="${CSS.escape(reviewId)}"]`);
        const values = form ? new FormData(form) : undefined;
        const editedItem = { ...review.incoming };
        if (values) {
          if (review.itemKind === "memory") { editedItem.title = String(values.get("canonicalTitle") ?? editedItem.title); editedItem.content = String(values.get("canonicalContent") ?? editedItem.content); }
          else if ("value" in editedItem) editedItem.value = String(values.get("canonicalValue") ?? editedItem.value);
          else editedItem.content = String(values.get("canonicalValue") ?? editedItem.content);
        }
        await client.request(`/v1/chats/${chat}/reconciliation-reviews/${encodeURIComponent(reviewId)}`, { method: "PATCH", body: JSON.stringify({ action: resolution, targetId: target.dataset.targetId || undefined, editedItem }) });
        await invalidateTranslationCache(state, { chatId: state.current.chatId, itemIdPrefix: `reconciliation:${reviewId}:` });
        formDirty = false;
        addLog(state.logs, "info", `Duplicate review resolved: ${resolution}`);
      } else if (action === "retry-extraction-audit") {
        const auditId = target.dataset.id ?? "";
        await client.request(`/v1/chats/${chat}/extraction-audits/${encodeURIComponent(auditId)}/retry`, { method: "POST" });
        addLog(state.logs, "info", "Extraction audit queued again with its preserved source and first draft");
      } else if (action === "approve-backfill") {
        requireChatMemoryEnabled(state, state.current.chatId);
        const resolvedSetup = capturedSetupForBackfill(state, state.current.chatId);
        if (!resolvedSetup) {
          await alertDashboard(BACKFILL_SETUP_CAPTURE_MESSAGE);
          addLog(state.logs, "info", "과거 대화로 기억 생성을 시작하지 않음: 초기 설정 캡처가 필요합니다.");
          return;
        }
        const extractionReviewOverride = await chooseExtractionReviewOverride(
          "과거 대화 백필을 재검수할까요?",
          `기존 기억은 유지하고 아직 처리하지 않은 원문만 기억으로 만듭니다. 2차 재검수는 호출량과 비용이 늘어납니다.`,
          state.settings.postExtractionReview,
        );
        if (extractionReviewOverride === undefined) return;
        const fullContext = await readCurrentContext(state, { snapshotMode: "full" });
        const prepared = await client.prepare(withExtractionReviewOverride(
          makePrepareRequest(fullContext, 0, { forceBackfill: true, deferExtraction: false, resolvedSetup }),
          extractionReviewOverride,
        ), 120_000);
        state.statusSummary = {
          ...(state.statusSummary ?? { queuedJobs: 0, failedJobs: 0, pendingReviews: 0, pendingEmbeddings: 0, failedEmbeddings: 0 }),
          initialCalibration: prepared.initialCalibration,
        };
        state.publishStatusSummary?.();
        const serverUrl = state.settings.serverUrl.replace(/\/$/, "");
        state.settings.serverInstances[serverUrl] = prepared.serverInstanceId;
        state.settings.backfillApproved[`${prepared.serverInstanceId}:${fullContext.chatId}`] = true;
        await saveSettings(state.settings);
        void drainWorker(state, client);
      } else if (action === "set-profile") {
        await changeChatProfile(target.dataset.profile as RpProfile);
      } else if (action === "regenerate-episode" || action === "regenerate-canonical") {
        if (organizationView.busy) return;
        requireChatMemoryEnabled(state, state.current.chatId);
        const batchId = target.dataset.id ?? "";
        const range = organizationView.data.ranges.find((row) => row.id === batchId);
        if (!range?.eligible) throw new Error(range?.reason ?? "원문 구간을 다시 선택해 주세요.");
        const canonical = action === "regenerate-canonical";
        organizationView.busy = true;
        organizationView.error = undefined;
        render();
        try {
          const estimate = await client.request<any>(`/v1/chats/${chat}/extraction-batches/${encodeURIComponent(batchId)}/preview-regeneration`, { method: 'POST', body: JSON.stringify({ canonical }) });
          // A read may finish after the user has left this chat or screen.
          if (!organizationView.open || encodeURIComponent(state.current?.chatId ?? '') !== chat
            || organizationView.selection.length !== 1 || organizationView.selection[0] !== batchId) return;
          organizationView.busy = false;
          render();
          const review = await chooseExtractionReviewOverride(
            canonical ? "여기부터 기억 후보를 다시 만들까요?" : "이 구간의 기억 후보를 다시 만들까요?",
            `${canonical ? "선택 지점부터 최신 적격 원문까지 기억과 상태를 다시 계산합니다." : "선택한 원문 묶음의 기억·세부·대사만 다시 만들고 상태 장부는 유지합니다."} 결과는 자동으로 적용되지 않습니다.\n묶음 ${estimate.batchCount}개 · 메시지 ${estimate.messageCount}개 · 원문 약 ${estimate.rawTokens.toLocaleString()}토큰\n전체 예상 입력 약 ${estimate.estimatedInputTokens.toLocaleString()}토큰, 기본 추출 약 ${estimate.estimatedExtractionCalls}회입니다. 재검수·상태 대조·긴 입력 분할에 따라 호출이 추가될 수 있으며 실제 청구량과 다릅니다.`,
            state.settings.postExtractionReview,
          );
          if (review === undefined) return;
          const started = await client.request<{ runId: string }>(`/v1/chats/${chat}/extraction-batches/${encodeURIComponent(batchId)}/${action}`, { method: "POST", body: JSON.stringify({ postExtractionReview: review }) }, 120_000);
          organizationView.candidateId = `regeneration:${started.runId}`;
          organizationView.mobileDetail = true;
          void drainWorker(state, client);
          await refresh({ forceApply: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          organizationView.error = `기억 후보 생성을 준비하지 못했습니다. ${message}`;
          addLog(state.logs, "error", `Regeneration preparation failed: [오류 원문 제외]`);
        } finally {
          organizationView.busy = false;
          if (dashboardOpen) render();
        }
        return;
      } else if (action === "toggle-bookmark" || action === "toggle-pin" || action === "toggle-memory") {
        const memory = data.memories.find((item) => item.id === target.dataset.id);
        if (!memory) return;
        const body = action === "toggle-bookmark" ? { bookmarked: !memory.bookmarked }
          : action === "toggle-pin" ? { pinned: !memory.pinned } : { active: !memory.active };
        await client.request(`/v1/chats/${chat}/memories/${encodeURIComponent(memory.id)}`, { method: "PATCH", body: JSON.stringify(body) });
      } else if (action === "delete-memory") {
        const id = target.dataset.id ?? "";
        if (!await confirmDashboard("이 기억과 연결된 trace/edge를 영구 삭제할까요? Risu 원문은 삭제되지 않습니다.", false, { title: "기억 삭제", confirm: "기억 삭제", danger: true })) return;
        await client.request(`/v1/chats/${chat}/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
        await invalidateTranslationCache(state, { chatId: state.current.chatId, itemIdPrefix: `${id}:` });
        selectedMemory = "";
      } else if (action === "resolve-conflict") {
        await client.request(`/v1/chats/${chat}/conflicts/${encodeURIComponent(target.dataset.id ?? "")}`, { method: "PATCH", body: JSON.stringify({ resolution: target.dataset.resolution }) });
      } else if (action === "delete-conflict") {
        if (!await confirmDashboard("확인 완료한 충돌 기록을 삭제할까요?", false, { confirm: "충돌 기록 삭제", danger: true })) return;
        await client.request(`/v1/chats/${chat}/conflicts/${encodeURIComponent(target.dataset.id ?? "")}`, { method: "DELETE" });
      } else if (action === "preview-entity-merge") {
        const form = root.querySelector<HTMLFormElement>("#entity-merge-form");
        if (!form) return;
        const values = new FormData(form);
        const sourceId = String(values.get("sourceId") ?? "");
        const targetId = String(values.get("targetId") ?? "");
        if (!sourceId || !targetId || sourceId === targetId) throw new Error("서로 다른 두 인물을 선택하세요.");
        entityMergePreview = await client.request(`/v1/chats/${chat}/entities/merge-preview`, { method: "POST", body: JSON.stringify({ sourceId, targetId }) });
        render();
        return;
      } else if (action === "cancel-entity-merge") {
        entityMergePreview = undefined;
        render();
        return;
      } else if (action === "merge-entities-final") {
        await client.request(`/v1/chats/${chat}/entities/merge`, { method: "POST", body: JSON.stringify({ sourceId: target.dataset.sourceId, targetId: target.dataset.targetId, revision: Number(target.dataset.revision) }) });
        entityMergePreview = undefined;
        peopleView.management = "";
        peopleView.mobileDetail = false;
        selectedRelationship = "";
        relationshipPerson = "";
        relationshipMobileDetail = false;
      } else if (action === "open-entity-delete") {
        const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
        const name = normalize(target.dataset.personName);
        const entity: any = data.entities.find((item: any) => [item.name, item.displayName].some((value) => normalize(value) === name));
        if (!entity) throw new Error("삭제할 인물을 찾지 못했습니다.");
        entityDeletePreview = undefined;
        peopleView.management = "delete";
        peopleView.mobileDetail = true;
        render(false);
        const preview: any = await client.request(`/v1/chats/${chat}/entities/${encodeURIComponent(String(entity.id))}/delete-preview`, { method: "POST", body: "{}" });
        // The panel names the person the way the list does.
        entityDeletePreview = { ...preview, entity: { ...preview?.entity, id: preview?.entity?.id ?? entity.id, name: entity.displayName || entity.name || preview?.entity?.name } };
        render(false);
        return;
      } else if (action === "confirm-entity-delete") {
        entityDeletePreview = { ...entityDeletePreview, busy: true };
        render(false);
        try {
          await client.request(`/v1/chats/${chat}/entities/${encodeURIComponent(target.dataset.id ?? "")}?revision=${encodeURIComponent(target.dataset.revision ?? "")}`, { method: "DELETE" });
        } catch (error) {
          entityDeletePreview = { ...entityDeletePreview, busy: false };
          const text = String(error);
          throw new Error(text.includes("ENTITY_DELETE_BUSY") ? "기억 정리가 진행 중이라 지금은 삭제할 수 없습니다. 잠시 후 다시 시도하세요."
            : text.includes("ENTITY_DELETE_STALE") ? "확인한 뒤 기록이 바뀌었습니다. 인물 삭제를 다시 열어 확인해 주세요."
              : text.includes("ENTITY_IS_PERSONA") ? "페르소나는 삭제할 수 없습니다. 먼저 페르소나 지정을 해제하세요." : text);
        }
        const deletedName = String(entityDeletePreview?.entity?.name ?? "");
        entityDeletePreview = undefined;
        peopleView.management = "";
        peopleView.selectedId = "";
        peopleView.mobileDetail = false;
        selectedRelationship = "";
        relationshipPerson = "";
        relationshipMobileDetail = false;
        showActionSaveState({ kind: "success", message: deletedName ? `${deletedName} 삭제됨` : "인물 삭제됨" });
      } else if (action === "set-persona") {
        const personaEntity = target.dataset.personaEntity?.trim() || null;
        await client.putViewPreferences(state.current.chatId, { personaEntity });
        showActionSaveState({ kind: "success", message: personaEntity ? `${personaEntity} 페르소나 지정됨` : "페르소나 지정 해제됨" });
      } else if (action === "new-social" || action === "edit-social") {
        socialEditor = {
          holder: action === "edit-social" ? target.dataset.holder ?? "" : "",
          subject: action === "edit-social" ? target.dataset.subject ?? "" : "",
          level: action === "edit-social" ? target.dataset.level ?? "aware_of" : "aware_of",
          knownAs: action === "edit-social" ? target.dataset.knownAs ?? "" : "",
          addressTerms: action === "edit-social" ? (data.socialKnowledge.find(item => item.holder === target.dataset.holder && item.subject === target.dataset.subject)?.addressTerms ?? []).join(", ") : "",
          description: action === "edit-social" ? (data.socialKnowledge.find(item => item.holder === target.dataset.holder && item.subject === target.dataset.subject)?.cognition ?? []).map((item: any) => item.text).join("\n") : "",
          locked:action === "edit-social" ? data.socialKnowledge.find(item=>item.holder===target.dataset.holder && item.subject===target.dataset.subject)?.locked ?? false : false,
          editing: action === "edit-social",
        };
        render();
        root.querySelector<HTMLInputElement>('#social-form input[name="holder"]')?.focus();
        return;
      } else if (action === "edit-address") {
        // The record may not exist yet: two people who share a scene have met, so a new one starts as 직접 교류.
        const holder = target.dataset.holder ?? "", subject = target.dataset.subject ?? "";
        const existing: any = data.socialKnowledge.find((item) => item.holder === holder && item.subject === subject);
        intimacyEditor = undefined;
        relationshipEditing = false;
        socialEditor = {
          holder, subject, focus: "address", editing: Boolean(existing), locked:existing?.locked ?? false,
          level: String(existing?.level ?? "interacted"), knownAs: (existing?.knownAs ?? []).join(", "),
          addressTerms: (existing?.addressTerms ?? []).join(", "),
        };
        formDirty = false;
        render();
        root.querySelector<HTMLInputElement>('#social-form input[name="addressTerms"]')?.focus();
        return;
      } else if (action === "cancel-social") {
        socialEditor = undefined;
        formDirty = false;
        render();
        return;
      } else if (action === "delete-social") {
        await client.request(`/v1/chats/${chat}/social-knowledge`, { method: "DELETE", body: JSON.stringify({ holder: target.dataset.holder, subject: target.dataset.subject }) });
      } else if (action === "backfill-social") {
        requireChatMemoryEnabled(state, state.current.chatId);
        const result = await client.request<{ queuedJobs: number }>(`/v1/chats/${chat}/social-knowledge/backfill`, { method: "POST" });
        addLog(state.logs, "info", result.queuedJobs ? `지인 관계 백필 ${result.queuedJobs}개 묶음을 대기열에 추가했습니다.` : "이미 지인 관계 백필이 진행 중이거나 처리할 원문이 없습니다.");
      } else if (action === "drain-worker") {
        await drainWorker(state, client);
      } else if (action === "pause-worker") {
        state.settings.workerPaused = true;
        if (state.settings.extractionEngine === "server") state.serverWorker = await client.pauseServerWorker();
        await saveSettings(state.settings);
        addLog(state.logs, "info", state.settings.extractionEngine === "server"
          ? "Server queue paused; active HTTP requests were aborted"
          : state.workerBusy ? "Queue pause requested; the current model call may finish" : "Queue paused");
      } else if (action === "resume-worker") {
        state.settings.workerPaused = false;
        delete state.settings.workerAttention;
        await saveSettings(state.settings);
        await updateWorkerMenuButton(state);
        if (state.settings.extractionEngine === "server") state.serverWorker = await client.resumeServerWorker(state.workerId);
        addLog(state.logs, "info", "Queue resumed by user");
        void drainWorker(state, client);
      } else if (action === "retry-failed") {
        requireChatMemoryEnabled(state, state.current.chatId);
        if (!await confirmDashboard("실패한 기억 처리 작업의 시도 횟수를 초기화해 다시 대기 상태로 둘까요? 서버 worker가 실행 중이면 곧바로 다시 처리합니다.")) return;
        const result = await client.request<{ retried: number }>(`/v1/chats/${chat}/jobs/retry-failed`, { method: "POST" });
        addLog(state.logs, "info", `${result.retried} failed extraction job(s) returned to queued state`);
      } else if (action === "acknowledge-backfill") {
        const runId = target.dataset.runId ?? "";
        if (!runId) return;
        const previousAcknowledged = data.coldStartProgress?.acknowledged;
        const closedLocally = acknowledgeBackfillLocally(data, runId);
        if (closedLocally) render();
        try {
          await client.request(`/v1/chats/${chat}/backfill-runs/${encodeURIComponent(runId)}/acknowledge`, { method: "POST" });
        } catch (error) {
          if (closedLocally && data.coldStartProgress?.backfillRunId === runId) {
            data.coldStartProgress.acknowledged = previousAcknowledged;
            render();
          }
          throw error;
        }
        addLog(state.logs, "info", "Backfill result acknowledged");
      } else if (action === "delete-queue") {
        if (!await confirmDashboard(`${state.settings.workerPaused ? "" : "안전한 삭제를 위해 worker를 먼저 일시정지합니다.\n\n"}현재 채팅의 queued/failed/만료된 작업을 삭제할까요? 원문은 보존되며 자동 재생성을 막기 위해 취소 상태로 표시됩니다.`)) return;
        await pauseWorkerForQueueMutation(state, client);
        const result = await client.request<{ deletedJobs: number; cancelledMessages: number }>(`/v1/chats/${chat}/jobs`, { method: "DELETE" });
        addLog(state.logs, "info", `${result.deletedJobs} extraction job(s) deleted; ${result.cancelledMessages} source message(s) cancelled`);
        showActionSaveState({ kind: "success", message: `대기열 ${result.deletedJobs}건 삭제됨 · worker 일시정지` });
      } else if (action === "clear-completed-jobs") {
        if (!await confirmDashboard("완료·취소·교체된 작업 기록을 대기열 목록에서 정리할까요? 기억과 검토 기록은 그대로 보존됩니다.")) return;
        const result = await client.request<{ archivedJobs: number }>(`/v1/chats/${chat}/jobs/completed`, { method: "DELETE" });
        addLog(state.logs, "info", `${result.archivedJobs} completed job record(s) archived`);
        showActionSaveState({ kind: "success", message: `완료 기록 ${result.archivedJobs}건 정리됨` });
      } else if (action === "restore-cancelled") {
        requireChatMemoryEnabled(state, state.current.chatId);
        if (!await confirmDashboard(`${state.settings.workerPaused ? "" : "안전한 복구를 위해 worker를 먼저 일시정지합니다.\n\n"}취소된 원문을 pending 상태로 되돌릴까요? 다음 동기화에서 작업이 다시 생성될 수 있지만, worker는 일시정지를 유지합니다.`)) return;
        await pauseWorkerForQueueMutation(state, client);
        const result = await client.request<{ restoredMessages: number }>(`/v1/chats/${chat}/jobs/requeue-cancelled`, { method: "POST" });
        addLog(state.logs, "info", `${result.restoredMessages} cancelled source message(s) restored to pending`);
        showActionSaveState({ kind: "success", message: `취소 원문 ${result.restoredMessages}개 복구됨 · worker 일시정지` });
      }
      await refresh({ forceApply: true });
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/, "");
      addLog(state.logs, "error", `Dashboard action failed: [오류 원문 제외]`, supportFailure("dashboard_action", error));
      showActionSaveState({ kind: "error", message: "작업 실패 · 관리 → 처리 상태에서 확인" });
    }
  });

  root.addEventListener("keydown", async (event) => {
    if (event.key !== "Escape") return;
    if (organizationView.open && organizationView.candidateId) {
      event.preventDefault();
      if (await discardReadyOrganizationCandidate()) {
        organizationView.candidateId = "";
        organizationView.mobileDetail = Boolean(organizationView.focusedId);
        render(false);
      }
      return;
    }
  });

  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const values = Object.fromEntries(new FormData(form));
    const mutationForm = ["memory-form", "manual-memory-form", "story-overview-form", "relationship-form", "social-form", "world-state-form", "intimacy-form", "anniversary-form", "anniversary-new-form", "detail-access-form"].includes(form.id);
    const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"], button[data-action="submit-form"]')
      ?? root.querySelector<HTMLButtonElement>(`button[data-action="submit-form"][data-form-id="${form.id}"]`);
    if (mutationForm) { form.setAttribute("aria-busy", "true"); if (submitButton) submitButton.disabled = true; }
    let successMessage = "";
    try {
      if (form.id === "settings-form") {
        settingsSaving = true;
        updateTopbar();
        await persistSettingsForm(form);
        addLog(state.logs, "info", "Settings persistence verified");
        await refresh();
        settingsSaving = false;
        showActionSaveState({ kind: "success", message: "저장됨" });
        return;
      } else if (form.id === "voyage-form") {
        await saveVoyageKey(form);
        return;
      } else if (!state.current) {
        throw new Error("현재 채팅 정보를 아직 불러오는 중입니다.");
      } else if (form.id === "story-overview-form") {
        const overview = data.storySpine?.overview;
        const groupId = form.dataset.groupId ?? overview?.groupId ?? "";
        const summary = String(values.summary ?? "").trim();
        if (!groupId || !overview) throw new Error("수정할 전체 요약을 찾지 못했습니다.");
        if (!summary) throw new Error("지금까지의 이야기를 입력해 주세요.");
        const chatId = state.current.chatId;
        const chat = encodeURIComponent(chatId);
        const result = await client.request<{ ok: boolean }>(`/v1/chats/${chat}/story-spine/${encodeURIComponent(groupId)}`, { method: "PATCH", body: JSON.stringify({ summary }) });
        if (!result.ok) throw new Error("줄거리 요약을 저장하지 못했습니다.");
        state.settings.storyOverviewBackups = { ...state.settings.storyOverviewBackups, [chatId]: {
          summary, groupId, startOrdinal: Number(overview.startOrdinal ?? 0), endOrdinal: Number(overview.endOrdinal ?? 0), savedAt: Date.now(),
        } };
        try { await saveSettings(state.settings); }
        catch (error) { addLog(state.logs, "warn", `Story overview saved, but its rebuild draft backup failed: [오류 원문 제외]`); }
        await invalidateTranslationCache(state, { serverInstanceId: data.health?.instanceId, chatId, itemId: storyTranslationKey(storyGroupKey(overview, "overview"), "summary") });
        translations.delete(storyTranslationKey(storyGroupKey(overview, "overview"), "summary"));
        storyView.editingOverview = false;
        storyView.overviewDraft = undefined;
        formDirty = false;
        successMessage = "지금까지의 이야기 저장됨";
      } else if (form.id === "detail-access-form") {
        const memoryId = form.dataset.memoryId ?? "", detailId = form.dataset.detailId ?? "";
        const grants = Array.from(form.querySelectorAll<HTMLElement>(".access-holder-row")).map(row => ({
          name: row.querySelector<HTMLInputElement>('input[name="holder"]')!.value.trim(),
          basis: row.querySelector<HTMLSelectElement>('select[name="basis"]')!.value as import("@rcm/shared").ItemAccessBasis,
        })).filter(item => item.name);
        if (new Set(grants.map(item => item.name.normalize("NFKC").toLocaleLowerCase())).size !== grants.length) throw new Error("같은 인물을 두 번 입력하지 말아 주세요.");
        const holders = grants.map(item => item.name), bases = Object.fromEntries(grants.map(item => [item.name, item.basis]));
        const kind = form.dataset.itemKind === "dialogue" ? "dialogues" : "details";
        const result = await client.request<MemoryDetailAccessResponse>(`/v1/chats/${encodeURIComponent(state.current.chatId)}/memories/${encodeURIComponent(memoryId)}/${kind}/${encodeURIComponent(detailId)}/access`, { method: "PUT", body: JSON.stringify({ holders, bases, everyone: (form.elements.namedItem("detailAccessEveryone") as HTMLInputElement | null)?.checked ?? false } satisfies MemoryDetailAccessPatch) });
        if (!result.ok) throw new Error("아는 인물을 저장하지 못했습니다.");
        const detail = data.memories.find((item) => item.id === memoryId)?.[kind === "dialogues" ? "keyDialogues" : "details"]?.find((item: any) => item.id === detailId);
        if (detail) { detail.access = result.access; detail.knownBy = result.knownBy; }
        timelineView.accessEditing = undefined;
        formDirty = false;
        successMessage = "아는 인물과 인지 경로 저장됨";
      } else if (form.id === "anniversary-new-form") {
        const label = String(values.label ?? "").trim();
        const storyTime = String(values.storyTime ?? "").trim();
        const a = form.dataset.a ?? "", b = form.dataset.b ?? "";
        if (!label) throw new Error("기념일 이름을 입력해 주세요.");
        if (!storyTime) throw new Error("작중 날짜를 입력해 주세요.");
        if (!a || !b) throw new Error("기념일을 붙일 두 사람을 찾지 못했습니다.");
        const note = String(values.note ?? "").trim();
        const chat = encodeURIComponent(state.current.chatId);
        const result = await client.request<{ ok: boolean; id: string }>(`/v1/chats/${chat}/memories`, { method: "POST", body: JSON.stringify({
          title: label, content: note || `${label} — ${a} · ${b} (설정상 과거)`, storyTime, participants: [a, b],
          landmarkKinds: [{ kind: "anniversary_basis", label, pair: [a, b], storyTime }],
        }) });
        if (!result.ok || !result.id) throw new Error("기념일을 저장하지 못했습니다.");
        anniversaryEditorEntryId = "";
        formDirty = false;
        pendingData = undefined; newDataAvailable = false;
        successMessage = "기념일 추가됨";
      } else if (form.id === "anniversary-form") {
        const label = String(values.label ?? "").trim();
        if (!label) throw new Error("기념일 이름을 입력해 주세요.");
        const memoryId = form.dataset.memoryId ?? "";
        const memory = data.memories.find((item) => item.id === memoryId);
        const pair = buildPairs(data, data.personaEntity).find((item) => item.key === selectedRelationship);
        if (!memory || !pair) throw new Error("기념일로 지정할 관계 기록을 찾지 못했습니다.");
        await landmarkPatchQueue.enqueue(memoryId,
          () => currentMemoryLandmarks(memoryId),
          (latest) => [...latest, { kind: "anniversary_basis", label, pair: [pair.a, pair.b] }],
          async (landmarkKinds) => {
            const result = await client.patchMemory(state.current!.chatId, memoryId, { landmarkKinds });
            if (!result.ok) throw new Error("기념일을 저장하지 못했습니다.");
          });
        anniversaryEditorEntryId = "";
        formDirty = false;
        successMessage = "기념일로 지정됨";
      } else if (form.id === "manual-memory-form") {
        const chat = encodeURIComponent(state.current.chatId);
        const participants = String(values.participants ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        const storyTime = String(values.storyTime ?? "").trim();
        const landmarkKinds = landmarksFromForm(form, [], participants, storyTime).kinds;
        const result = await client.request<{ ok: boolean; id: string }>(`/v1/chats/${chat}/memories`, { method: "POST", body: JSON.stringify({
          title: String(values.title ?? "").trim(), content: String(values.content ?? "").trim(), storyTime, participants, landmarkKinds,
        }) });
        if (!result.ok || !result.id) throw new Error("수동 기억을 저장하지 못했습니다.");
        const locations = String(values.locations ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        if (locations.length) await client.patchMemory(state.current.chatId, result.id, { locations });
        selectedMemory = result.id;
        timelineView.creating = false;
        timelineView.mobileDetail = true;
        formDirty = false;
        successMessage = "타임라인 기억 추가됨";
      } else if (form.id === "memory-form") {
        const memoryId = form.dataset.memoryId ?? "";
        const locations = String(values.locations ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        const memory = data.memories.find((item) => item.id === memoryId);
        const existingLandmarks = Array.isArray(memory?.landmarkKinds) ? memory.landmarkKinds : [];
        let participants = Array.isArray(memory?.participants) ? memory.participants : [];
        if (!participants.length && typeof memory?.participants_json === "string") {
          try { participants = JSON.parse(memory.participants_json); } catch { participants = []; }
        }
        const landmarks = landmarksFromForm(form, existingLandmarks, participants, String(values.storyTime ?? "").trim());
        const initial = new Map<string, unknown>(JSON.parse(form.dataset.initialSignature ?? "[]") as Array<[string, unknown]>);
        const changed = (name: string, value: unknown): boolean => !initial.has(name) || initial.get(name) !== value;
        const patch: Record<string, unknown> = {};
        if (changed("title", String(values.title ?? ""))) patch.title = values.title;
        if (changed("content", String(values.content ?? ""))) patch.content = values.content;
        if (changed("storyTime", String(values.storyTime ?? ""))) patch.storyTime = String(values.storyTime ?? "").trim() || null;
        if (changed("locations", String(values.locations ?? ""))) patch.locations = locations;
        if (changed("participants", String(values.participants ?? ""))) patch.participants = [...new Set(String(values.participants ?? "").split(",").map((value) => value.trim()).filter(Boolean))];
        // Picking any kind makes the scene a landmark; clearing every chip makes it an ordinary scene again.
        if (JSON.stringify(landmarks.kinds) !== JSON.stringify(existingLandmarks)) patch.landmarkKinds = landmarks.kinds;
        if (Boolean(memory?.landmark) !== landmarks.landmark) patch.landmark = landmarks.landmark;
        if (Object.keys(patch).length === 0) {
          formDirty = false;
          successMessage = "변경 사항 없음";
        } else {
          const result = await client.patchMemory(state.current.chatId, memoryId, patch);
          if (!result.ok) throw new Error("기억을 찾지 못해 저장하지 못했습니다. 새로고침 후 다시 시도하세요.");
        }
        if ("title" in patch) {
          await invalidateTranslationCache(state, { serverInstanceId: data.health?.instanceId, chatId: state.current.chatId, itemId: `${memoryId}:title` });
          translations.delete(`${memoryId}:title`);
        }
        if ("content" in patch) {
          await invalidateTranslationCache(state, { serverInstanceId: data.health?.instanceId, chatId: state.current.chatId, itemId: `${memoryId}:content` });
          translations.delete(`${memoryId}:content`);
        }
        formDirty = false;
        timelineView.editing = false;
        pendingData = undefined; newDataAvailable = false;
        successMessage = "기억 저장됨";
      } else if (form.id === "relationship-form") {
        const chat = encodeURIComponent(state.current.chatId);
        const from = String(values.from ?? ""), to = String(values.to ?? "");
        const current = data.relationships.find((item) => relationshipFrom(item) === from && relationshipTo(item) === to);
        let changes = 0;
        const nextSummary = String(values.summary ?? "").trim();
        const initialBaselineId = form.dataset.initialBaselineId;
        if (initialBaselineId && data.initialCalibration?.status === "awaiting_confirmation") {
          const axes = Object.fromEntries(Object.keys(relationshipLevels).map((axis) => [axis, String(values[`${axis}Level`] ?? "unknown")]));
          const result = await client.request<{ ok: boolean }>(`/v1/chats/${chat}/initial-calibration/relationships/${encodeURIComponent(initialBaselineId)}`, {
            method: "PATCH", body: JSON.stringify({ axes, summary: nextSummary }),
          });
          if (!result.ok) throw new Error("초기 관계를 저장하지 못했습니다.");
          changes = 1;
        } else {
          const endpoint = `/v1/chats/${chat}/relationships`;
          const locked=(form.elements.namedItem("locked") as HTMLInputElement | null)?.checked ?? false;
          const patches=relationshipEditorPatches(values,current);
          if(!patches.length && locked !== Boolean(current?.locked)) patches.push({from,to});
          for (const patch of patches) {
            const result = await client.request<{ ok: boolean }>(endpoint, { method: "PATCH", body: JSON.stringify({...patch,locked}) });
            if (!result.ok) throw new Error(patch.axis
              ? `${relationshipAxisLabels[patch.axis as keyof typeof relationshipAxisLabels] ?? patch.axis} 상태를 저장하지 못했습니다.`
              : "관계 요약을 저장하지 못했습니다.");
            changes += 1;
          }
        }
        formDirty = false;
        successMessage = changes ? (initialBaselineId ? "초기 관계 저장됨" : "관계 상태 저장됨") : "변경 사항 없음";
        relationshipEditing = false;
        relationshipEditingDirection = "";
        intimacyEditor = undefined;
        if (!changes) {
          render();
          showActionSaveState({ kind: "success", message: successMessage });
          return;
        }
      } else if (form.id === "social-form") {
        const chat = encodeURIComponent(state.current.chatId);
        const result = await client.request<{ items: any[] }>(`/v1/chats/${chat}/social-knowledge`, { method: "PUT", body: JSON.stringify({
          holder: String(values.holder ?? "").trim(), subject: String(values.subject ?? "").trim(), level: values.level,
          ...(values.description === undefined ? {} : { description: String(values.description).trim() }),
          knownAs: String(values.knownAs ?? "").split(",").map((value) => value.trim()).filter(Boolean),
          ...(values.addressTerms === undefined ? {} : { addressTerms: String(values.addressTerms).split(",").map((value) => value.trim()).filter(Boolean) }),
          previousHolder: form.dataset.originalHolder || undefined,
          previousSubject: form.dataset.originalSubject || undefined,
          // The 부르는 이름 sheet has no lock control; leaving locked out keeps the pair's current lock.
          ...(form.elements.namedItem("locked") instanceof HTMLInputElement ? { locked: (form.elements.namedItem("locked") as HTMLInputElement).checked } : {}),
        }) });
        if (!Array.isArray(result.items)) throw new Error("지인 관계 저장 결과를 확인하지 못했습니다.");
        data.socialKnowledge = result.items;
        successMessage = socialEditor?.focus === "address" ? "이름·호칭 저장됨" : "지인 관계 저장됨";
        socialEditor = undefined;
        formDirty = false;
      } else if (form.id === "intimacy-form") {
        const chat = encodeURIComponent(state.current.chatId);
        const itemId = form.dataset.id ?? "";
        const body = {
          participantA: String(values.participantA ?? "").trim(), participantB: String(values.participantB ?? "").trim(),
          act: String(values.act ?? ""), customLabel: String(values.customLabel ?? "").trim() || undefined,
          initiator: String(values.initiator ?? "").trim() || undefined,
          interactionContext: String(values.interactionContext ?? "ambiguous"),
          circumstance: String(values.circumstance ?? "").trim() || undefined,
          autoInject: (form.elements.namedItem("autoInject") as HTMLInputElement | null)?.checked !== false,
        };
        await client.request(`/v1/chats/${chat}/physical-intimacy${itemId ? `/${encodeURIComponent(itemId)}` : ""}`, { method: itemId ? "PATCH" : "POST", body: JSON.stringify(body) });
        formDirty = false;
        intimacyEditor = undefined;
        pendingData = undefined; newDataAvailable = false;
        successMessage = itemId ? "스킨십 기록 수정됨" : "스킨십 기록 추가됨";
      } else if (form.id === "world-state-form") {
        const chat = encodeURIComponent(state.current.chatId);
        const kind = form.dataset.kind as WorldEditor["kind"];
        const itemId = form.dataset.id ?? "";
        const creating = form.dataset.mode === "create";
        const body: Record<string, unknown> = { kind, ...(creating ? {} : { id: itemId }), locked:(form.elements.namedItem("locked") as HTMLInputElement | null)?.checked ?? false };
        for (const key of ["subject", "predicate", "holder", "promisor", "promisee", "value", "content", "polarity", "status", "scope", "scheduledFor", "statusReason", "sourceMessageId"]) {
          if (values[key] !== undefined) body[key] = String(values[key]).trim();
        }
        if (values.stateKind !== undefined) {
          body.stateKind = String(values.stateKind);
          if (["goal", "secret"].includes(String(values.stateKind))) body.knownBy = String(values.knownBy ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        }
        if (values.relationTarget !== undefined) {
          const relationKind = String(values.relationKind ?? "interpersonal");
          const relationTarget = String(values.relationTarget).trim(), relationLabel = String(values.relationLabel ?? "").trim();
          const subject = String(values.subject ?? "").trim();
          const mutual = relationKind === "interpersonal" && values.relationMutual !== undefined;
          const overlap = findRelationOverlap(data.assertions, { id: creating ? undefined : itemId, subject, target: relationTarget, label: relationLabel, kind: relationKind, mutual });
          if (overlap) {
            const existing = overlap.item;
            const existingText = relationPreview(String(existing.subject), String(existing.socialRelation.target), String(existing.socialRelation.label), relationKind, existing.socialRelation.direction === "mutual");
            if (overlap.overlap === "reverse" && creating && await confirmDashboard(`${existingText}이(가) 이미 있어요. 서로 같은 관계로 합칠까요?`, false, { confirm: "서로 같은 관계로 합치기" })) {
              const merged = await client.request<{ ok: boolean }>(`/v1/chats/${chat}/world-state`, { method: "PATCH", body: JSON.stringify({
                kind: "assertion", id: String(existing.id),
                socialRelation: { ...existing.socialRelation, direction: "mutual" }, knownBy: existing.socialRelation.knownBy ?? [], knownByEveryone: existing.socialRelation.knownByEveryone ?? false,
              }) });
              if (!merged.ok) throw new Error("관계를 합치지 못했습니다.");
              formDirty = false;
              worldEditor = undefined;
              pendingData = undefined; newDataAvailable = false;
              await refresh({ forceApply: true });
              showActionSaveState({ kind: "success", message: "서로 같은 관계로 합쳤어요" });
              return;
            }
            if (overlap.overlap !== "reverse") {
              worldEditor = { kind: "assertion", id: String(existing.id), mode: "edit", social: true };
              formDirty = false;
              render();
              showActionSaveState({ kind: "error", message: `${existingText}이(가) 이미 있어 그 관계를 열었어요.` });
              return;
            }
            if (creating) return;
          }
          // The ledger key follows the relation; an existing key is kept while the relation's name and party stay the same.
          const keepKey = !creating && form.dataset.originalLabel === relationLabel && form.dataset.originalTarget === relationTarget && form.dataset.originalPredicate;
          body.predicate = keepKey ? form.dataset.originalPredicate : `${relationLabel} · ${relationTarget}`;
          body.value = String(values.value ?? "").trim() || relationPreview(subject, relationTarget, relationLabel, relationKind, mutual);
          body.socialRelation = { target: relationTarget, label: relationLabel, kind: relationKind, direction: mutual ? "mutual" : "directed" };
          body.knownByEveryone = (form.elements.namedItem("relationKnownByEveryone") as HTMLInputElement | null)?.checked ?? false;
          body.knownBy = String(values.relationKnownBy ?? "").split(",").map(value => value.trim()).filter(Boolean);
        }
        const result = await client.request<{ ok: boolean; item?: any }>(`/v1/chats/${chat}/world-state`, { method: creating ? "POST" : "PATCH", body: JSON.stringify(body) });
        if (!result.ok) throw new Error("기록을 저장하지 못했습니다.");
        if (!creating && !result.item) throw new Error("저장 후 서버 값을 다시 확인하지 못했습니다.");
        if (!creating && kind === "assertion") data.assertions = data.assertions.map((item) => item.id === itemId ? result.item : item);
        if (!creating && kind === "belief") data.beliefs = data.beliefs.map((item) => item.id === itemId ? result.item : item);
        if (!creating && kind === "promise") data.promises = data.promises.map((item) => item.id === itemId ? result.item : item);
        const savedId = String(result.item?.id ?? itemId ?? "");
        await invalidateTranslationCache(state, { serverInstanceId: data.health?.instanceId, chatId: state.current.chatId, itemIdPrefix: `${kind}:${itemId}` });
        translations.delete(`${kind}:${itemId}`);
        formDirty = false;
        worldEditor = undefined;
        pendingData = undefined; newDataAvailable = false;
        successMessage = creating ? "기록 추가됨" : "기록 저장됨";
      }
      await refresh({ forceApply: mutationForm });
      if (successMessage) showActionSaveState({ kind: "success", message: successMessage });
    } catch (error) {
      const duplicateId = String(error).match(/existingId=([^\s]+)/)?.[1];
      if (duplicateId && form.id === "intimacy-form") {
        intimacyEditor = { id: duplicateId };
        showActionSaveState({ kind: "error", message: "같은 기록이 있어 기존 항목 수정 화면을 열었습니다." });
        render();
        return;
      }
      if (form.id === "world-state-form" && String(error).includes("REVERSE_RELATION_EXISTS")) {
        showActionSaveState({ kind: "error", message: "반대 방향으로 같은 관계가 이미 있어요. 그 관계를 서로 같은 관계로 바꿔 주세요." });
        if (duplicateId) { formDirty = false; worldEditor = { kind: "assertion", id: duplicateId, mode: "edit", social: true }; render(); }
        return;
      }
      if (duplicateId && form.id === "world-state-form") {
        formDirty = false;
        worldEditor = { kind: form.dataset.kind as WorldEditor["kind"], id: duplicateId, mode: "edit", social: form.dataset.social === "true" };
        showActionSaveState({ kind: "error", message: "같은 활성 항목이 있어 기존 항목 수정 화면을 열었습니다." });
        render();
        return;
      }
      if (form.id === "settings-form") {
        settingsSaving = false;
        addLog(state.logs, "error", `Settings save failed: [오류 원문 제외]`, supportFailure("settings_save", error));
        const attempted = new FormData(form);
        showActionSaveState({ kind: "error", message: settingsSaveFailureMessage(error, {
          serverUrl: String(attempted.get("serverUrl") ?? state.settings.serverUrl).trim(),
          serverToken: String(attempted.get("serverToken") ?? state.settings.serverToken).trim(),
        }) });
      } else {
        data.error = String(error);
        if (mutationForm) showActionSaveState({ kind: "error", message: `저장 실패 · ${String(error)}` });
      }
      if (form.id !== "settings-form") render();
    } finally {
      if (form.id === "settings-form") {
        settingsSaving = false;
        updateTopbar();
      }
      if (mutationForm && form.isConnected) {
        form.removeAttribute("aria-busy");
        if (submitButton) submitButton.disabled = false;
      }
    }
  });

  root.addEventListener("input", (event) => {
    const relationForm = (event.target as HTMLElement).closest<HTMLFormElement>('#world-state-form[data-social="true"]');
    if (relationForm) syncRelationForm(relationForm);
    const input = event.target as HTMLInputElement;
    if (input.closest("#memory-form") || input.closest("#manual-memory-form") || input.closest("#story-overview-form") || input.closest("#intimacy-form") || input.closest("#social-form") || input.closest("#world-state-form") || input.closest("#relationship-form") || input.closest("#anniversary-form") || input.closest("#anniversary-new-form") || input.closest("#detail-access-form") || input.closest(".person-editor") || input.closest(".initial-relationship-editor")) syncEditorDirtyState();
    if (input.dataset.action === "people-search") {
      peopleView.query = input.value;
      applyPeopleSearch();
      return;
    }
    if (input.dataset.action === "relationship-search") {
      relationshipQuery = input.value;
      applyRelationshipSearch();
      return;
    }
    if (input.dataset.action === "data-search") {
      dataView.query = input.value;
      const query = input.value.trim().toLocaleLowerCase();
      root.querySelectorAll<HTMLElement>("[data-data-row]").forEach((row) => { row.hidden = Boolean(query) && !row.textContent?.toLocaleLowerCase().includes(query); });
      return;
    }
    if (input.dataset.action === "attention-search") {
      attentionView.query = input.value;
      applyAttentionSearch();
      return;
    }
    if (input.dataset.action === "social-search") {
      const query = input.value.trim().toLocaleLowerCase();
      let visible = 0;
      root.querySelectorAll<HTMLElement>("[data-social-group]").forEach((group) => {
        let groupVisible = 0;
        group.querySelectorAll<HTMLElement>("[data-social-row]").forEach((row) => {
          const match = !query || Boolean(row.textContent?.toLocaleLowerCase().includes(query));
          row.hidden = !match;
          if (match) groupVisible += 1;
        });
        group.hidden = groupVisible === 0;
        if (query && groupVisible) (group as HTMLDetailsElement).open = true;
        visible += groupVisible;
      });
      const count = root.querySelector<HTMLElement>("[data-social-count]");
      if (count) count.textContent = `${visible}개`;
      const empty = root.querySelector<HTMLElement>("[data-social-search-empty]");
      if (empty) empty.hidden = visible > 0;
      return;
    }
    if (input.id === "story-overview-summary") {
      storyView.overviewDraft = input.value;
      const count = root.querySelector<HTMLElement>("[data-story-overview-count]");
      if (count) {
        const next = storyOverviewCount(input.value, Number(count.dataset.limit) || 0);
        count.textContent = next.text;
        count.classList.toggle("is-over", next.over);
      }
      return;
    }
    if (input.dataset.action === "story-search") {
      storyView.query = input.value;
      applyStorySearch();
      return;
    }
    if (input.id !== "memory-search") return;
    timelineView.query = input.value;
    applyTimelineSearch();
  });

  root.addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name === "landmarkKind" && input.value === "other") {
      const other = input.closest("form")?.querySelector<HTMLElement>("[data-landmark-other]");
      if (other) other.hidden = !input.checked;
    }
    const relationForm = input.closest<HTMLFormElement>('#world-state-form[data-social="true"]');
    if (relationForm) syncRelationForm(relationForm);
    if (input.name === "stateKind" && input.closest("#world-state-form")) {
      const value = input.value;
      input.closest("form")?.querySelectorAll<HTMLElement>("[data-state-only]").forEach((node) => { node.hidden = !(node.dataset.stateOnly ?? "").split(" ").includes(value); });
      const title = input.closest(".reader")?.querySelector<HTMLElement>(".reader__title[data-title-verb]");
      if (title) title.textContent = `${worldRecordLabel("assertion", { stateKind: value })} ${title.dataset.titleVerb}`;
    }
    if (input.closest("#memory-form") || input.closest("#manual-memory-form") || input.closest("#story-overview-form") || input.closest("#intimacy-form") || input.closest("#social-form") || input.closest("#world-state-form") || input.closest("#relationship-form") || input.closest("#anniversary-form") || input.closest("#anniversary-new-form") || input.closest("#detail-access-form") || input.closest(".person-editor") || input.closest(".initial-relationship-editor")) syncEditorDirtyState();
    if (input.name === "customRuleEnabled") updateRegexRuleSummary();
    if (input.dataset.action === "set-profile-select") {
      try {
        const changed = await changeChatProfile(input.value as RpProfile);
        if (!changed) input.value = state.current?.profile ?? state.settings.defaultProfile;
      } catch (error) {
        data.error = String(error);
        input.value = state.current?.profile ?? state.settings.defaultProfile;
      }
      render(false);
      return;
    }
    if (input.name === "dashboardSkin") {
      applyDashboardSkin(input.value === "phone" ? "phone" : "film");
      return;
    }
    if (input.name === "dashboardTheme") {
      document.documentElement.dataset.theme = filmTheme(input.value === "light" ? "light" : "dark");
      return;
    }
    if (input.dataset.action === "now-sort") {
      nowSort = input.value === "stale" ? "stale" : "recent";
      render();
      return;
    }
    if (input.dataset.action === "pair-diary-sort") {
      pairDiarySort = input.value === "oldest" ? "oldest" : "newest";
      render();
      return;
    }
    if (input.dataset.action === "data-filter") { dataView.filter = input.value as DataViewState["filter"]; render(); return; }
    if (input.dataset.action === "select-probe-source" && state.lineageProbe) {
      state.lineageProbe.selectedParentId = input.value || undefined;
      render(); return;
    }
    const confirmation = dataView.confirmation;
    if (input.dataset.action === "ack-delete" && confirmation && confirmation.chatId === input.dataset.chatId) {
      confirmation.acknowledged = input.checked;
      const confirm = root.querySelector<HTMLButtonElement>('[data-action="confirm-data-operation"][data-operation="delete"]');
      if (confirm) confirm.disabled = !input.checked;
      return;
    }
    if (["translationProvider", "translationSlot", "translationServerProvider", "translationServerEndpoint", "translationServerCredentialSource"].includes(input.name)) {
      updateTranslationConnectionControls(root,input.name);return;
    }
    if (input.name === "extractionEngine") {
      root.querySelectorAll<HTMLElement>("[data-engine-fields]").forEach((element) => { element.hidden = element.dataset.engineFields !== input.value; });
      const auxiliary = root.querySelector<HTMLSelectElement>('select[name="auxiliaryMode"]');
      const staticModel = root.querySelector<HTMLElement>("[data-static-model]");
      if (staticModel) staticModel.hidden = input.value !== "risu" || auxiliary?.value !== "static";
      return;
    }
    if (input.name === "auxiliaryMode") {
      const staticModel = root.querySelector<HTMLElement>("[data-static-model]");
      const engine = root.querySelector<HTMLSelectElement>('select[name="extractionEngine"]')?.value;
      if (staticModel) staticModel.hidden = engine !== "risu" || input.value !== "static";
      return;
    }
    if(["mcpProvider","mcpEndpoint","mcpCredentialSource"].includes(input.name)) {updateMcpSelectorControls(root,input.name);return;}
    if (input.name === "serverLlmProvider") {
      maskSecretInputs(root);
      const configured = new Set((input.dataset.configuredProviders ?? "").split(",").filter(Boolean));
      const configuredHere = configured.has(input.value);
      const keyStatus = root.querySelector<HTMLElement>("[data-provider-key-status]");
      const keyInput = root.querySelector<HTMLInputElement>('input[name="serverLlmApiKey"]');
      const remove = root.querySelector<HTMLElement>('[data-remove-server-row]');
      if (keyStatus) keyStatus.textContent = configuredHere ? "인증정보 저장됨" : "인증정보 없음";
      if (keyInput) {
        keyInput.value = "";

      }
      if (remove) remove.hidden = !configuredHere;
      updateProviderFields(root, "serverLlm");
      return;
    }
    if (input.id !== "backup-file" || !input.files?.[0]) return;
    try {
      const bytes = await input.files[0].arrayBuffer();
      input.value = "";
      const response = await client.raw("/v1/import/inspect", { method: "POST", headers: { "Content-Type": "application/zip" }, body: backupRequestBody(bytes) }, 60_000);
      const inspection = await response.json() as any;
      const scope = inspection?.manifest?.scope;
      if (scope === "complete") {
        if (await confirmDashboard("현재 RCM 서버의 모든 기억과 설정을 이 백업으로 교체할까요? 현재 설치의 서버 주소와 토큰은 유지됩니다.")) await restoreCompleteBackup(bytes);
        return;
      }
      if (scope !== "chat") throw new Error("지원하지 않는 백업 종류입니다.");
      const sourceChatId = inspection?.manifest?.chats?.[0]?.id;
      if (!sourceChatId) throw new Error("백업에서 원래 채팅 ID를 찾지 못했습니다.");
      const canTransplant = Boolean(state.current?.chatId && state.current.chatId !== sourceChatId);
      const choice = await chooseChatBackupImport(canTransplant);
      if (choice === "original") await restoreChatBackup(bytes);
      else if (choice === "current") await transplantChatBackup(bytes, sourceChatId);
    } catch (error) { data.error = String(error); render(); }
  });

  root.addEventListener("focusout", () => {
    queueMicrotask(() => {
      if (!deferredPageRender || formDirty || hasActiveSelection()) return;
      const page = root.querySelector<HTMLElement>(".page");
      const active = document.activeElement as HTMLElement | null;
      if (page && active && page.contains(active) && active.matches("input, select, textarea")) return;
      render();
    });
  });

  document.addEventListener("selectionchange", () => {
    if (hasActiveSelection() || formDirty) return;
    if (pendingData) {
      data = pendingData;
      pendingData = undefined;
      newDataAvailable = false;
      render();
      return;
    }
    if (pendingTranslationPatches.size) {
      const ids = [...pendingTranslationPatches];
      pendingTranslationPatches.clear();
      for (const id of ids) {
        const memory = data.memories.find((item) => item.id === id);
        if (memory) patchTranslatedMemory(memory);
      }
    }
  });

  render();
  await state.setStatusWidgetHidden?.(true);
  try { await risuai.showContainer("fullscreen"); }
  catch (error) {
    await state.setStatusWidgetHidden?.(false);
    throw error;
  }
  // PocketRisu reparents a previously display:none sandbox iframe when showing
  // it. Let Chromium schedule a visible frame before replacing the shell with
  // network-backed content, otherwise the completed render can remain visually
  // stale until the next pointer event even though the DOM is already current.
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  const themeReady = applyDashboardTheme(state.settings.dashboardTheme);
  await refresh();

  // Statistics belong to Settings; they must not delay Home's data request.
  if (dashboardOpen && isServerConfigured(state.settings)) {
    void translationCacheStats(state).then(stats => {
      if (!dashboardOpen) return;
      cacheStats = stats;
      if (activeTab === "settings" && !formDirty) render();
    }).catch(() => {});
  }
  if (isServerConfigured(state.settings) && !state.updateDashboardChecked) {
    state.updateDashboardChecked = true;
    await refreshUpdateStatus(state, client, { remote: true, force: true });
    render();
  }
  await themeReady;
  await showCompletedProductReleaseNotice(state);
  lastServerActivitySignature = serverActivitySignature();
  lastLiveDataSignature = dashboardLiveDataSignature(state.statusSummary);
  const toolRegistrationSignature = () => JSON.stringify([state.memoryToolRegistration?.status, state.memoryToolRegistration?.failures]);
  let lastToolRegistrationSignature = toolRegistrationSignature();
  const refreshFromActivity = async () => {
    if (refreshing) { activityRefreshPending = true; return; }
    do {
      activityRefreshPending = false;
      await refresh();
    } while (dashboardOpen && activityRefreshPending);
  };
  let lastTranslationStatsSignature = JSON.stringify(state.translationStats);
  const unsubscribeConnection = subscribeDashboardConnection(state, issue => {
    data = { ...data, connectionIssue: issue, loadedDatasets: issue ? data.loadedDatasets : [] };
  }, () => render(), refreshFromActivity);
  const unsubscribeStatus = subscribeActivity(state, () => {
    if (!dashboardOpen) return;
    const summary = state.statusSummary;
    const busy = !!state.currentJob || (state.serverWorker?.activeCalls ?? 0) > 0 || (summary?.queuedJobs ?? 0) > 0 || (summary?.pendingEmbeddings ?? 0) > 0 || ["queued", "processing"].includes(state.episodeActivity?.status ?? "");
    const nextServerSignature = serverActivitySignature();
    const serverActivityChanged = nextServerSignature !== lastServerActivitySignature;
    const nextLiveDataSignature = dashboardLiveDataSignature(summary);
    const liveDataChanged = nextLiveDataSignature !== lastLiveDataSignature;
    lastServerActivitySignature = nextServerSignature;
    lastLiveDataSignature = nextLiveDataSignature;
    updateTopbar();
    updateNavBadges();
    const translationStatsSignature = JSON.stringify(state.translationStats);
    if (translationStatsSignature !== lastTranslationStatsSignature) {
      lastTranslationStatsSignature = translationStatsSignature;
      if (activeTab === "operations") render();
    }
    const nextToolRegistrationSignature = toolRegistrationSignature();
    if (nextToolRegistrationSignature !== lastToolRegistrationSignature) {
      lastToolRegistrationSignature = nextToolRegistrationSignature;
      if (activeTab === "operations") render();
    }
    if (!serverActivityChanged && !liveDataChanged) return;
    if (liveDataChanged || (activityWasBusy && !busy) || (activeTab === "settings" && serverActivityChanged)) void refreshFromActivity();
    activityWasBusy = busy;
  });
  unsubscribeActivity = () => { unsubscribeConnection(); unsubscribeStatus(); };
}
