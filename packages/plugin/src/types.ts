import type { PrepareClientTimings } from "./api-client.js";
import type { InjectedScene, TurnSearch } from "./turn-delivery.js";
import type { CanonicalizationPolicy, ChatLineageHint, ExtractionEngine, LineageProbeResponse, MemoryBudgetPreset, MemoryLanguage, MemoryToolOpportunity, MessageHostVisibility, ResolvedSetupProjection, RpProfile, SearchQuerySignal, ServerWorkerStatus, TurnPrepareResponse } from "@rcm/shared";
import type { ServerConnectionIssue } from "./connection.js";

export type AuxiliaryMode = "main" | "memory" | "otherAx" | "static";
export type TranslationProvider = "google" | "risu";
export type TranslationDisplay = "ko" | "en";
export type DashboardTheme = "dark" | "light";
export type DashboardSkin = "film" | "phone";

export interface PluginSettings {
  settingsRevision: number;
  serverUrl: string;
  serverToken: string;
  defaultChatEnabled: boolean;
  chatEnabled: Record<string, boolean>;
  chatCatchUpPending: Record<string, boolean>;
  workerPaused: boolean;
  workerAttention?: { at: number; message: string };
  statusWidgetPosition?: { left: number; top: number };
  statusWidgetVisible?: boolean;
  quizEnabled?: boolean;
  defaultProfile: RpProfile;
  profiles: Record<string, RpProfile>;
  perspectives: Record<string, string[]>;
  detectedPerspectives: Record<string, string[]>;
  includeUserMessages: Record<string, boolean>;
  memoryOnlyInjection: Record<string, boolean>;
  sourceProtectionTurns: number;
  editProtectionTurns: number;
  canonicalizationPolicy: CanonicalizationPolicy;
  extractionGroupTurns: Record<string, number>;
  memoryLanguages: Record<string, MemoryLanguage>;
  backfillApproved: Record<string, boolean>;
  serverInstances: Record<string, string>;
  auxiliaryMode: AuxiliaryMode;
  extractionEngine: ExtractionEngine;
  postExtractionReview: boolean;
  staticModel: string;
  translationProvider: TranslationProvider;
  translationDisplay: TranslationDisplay;
  autoTranslate: boolean;
  dashboardTheme: DashboardTheme;
  dashboardSkin: DashboardSkin;
  defaultMemoryBudget: MemoryBudgetPreset;
  memoryBudgets: Record<string, MemoryBudgetPreset>;
  mcpCap: number;
  memoryToolsEnabled: boolean;
  storyOverviewBackups: Record<string, { summary: string; groupId: string; startOrdinal: number; endOrdinal: number; savedAt: number }>;
}

export interface CachedChatState {
  serverInstanceId?: string;
  stableAnchors: string;
  lastPacket: string;
  lastRevision: number;
  lastPreparedAt: number;
  lastInjectionManifest?: NonNullable<TurnPrepareResponse["injectionManifest"]>;
  /** Clarity and attached detail counts of the scenes in that manifest. */
  lastInjectionScenes?: InjectedScene[];
  /** Memory-tool searches the model ran since that injection. */
  lastTurnSearches?: TurnSearch[];
  lastInjectedTokens?: number;
  lastInjectionAt?: number;
}

export interface RuntimeLog {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
}

export type { TimingEvent } from "./timing.js";

export interface CurrentContext {
  chatId: string;
  chatTitle: string;
  chatTitles?: Record<string, string>;
  characterId: string;
  characterName: string;
  activePerspectives: string[];
  perspectiveMode: "auto" | "manual";
  identityHints: {
    userPersonaName?: string;
    hostCharacterName?: string;
    recentSpeakerNames: string[];
    cachedPerspectives: string[];
  };
  chat: any;
  profile: RpProfile;
  includeUserMessages: boolean;
  memoryOnlyInjection?: boolean;
  sourceProtectionTurns?: number;
  editProtectionTurns?: number;
  canonicalizationPolicy?: CanonicalizationPolicy;
  extractionGroupTurns: number;
  memoryLanguage: MemoryLanguage;
  sourceMessageCount: number;
  sourceActiveMessageCount: number;
  estimatedSourceTokens: number;
  snapshotScope: "full" | "tail";
  snapshot: Array<{ id: string; role: "user" | "assistant" | "system"; content: string; ordinal: number; time?: number; generationId?: string; sourceKind: "risu_display" | "yumi_model"; disabled: boolean }>;
  messageVisibility?: Array<{ id: string; ordinal: number; visibility: MessageHostVisibility; role?: "user" | "assistant" | "system"; contentHash?: string }>;
  lineageHint?: ChatLineageHint;
  staticProjection: { hash: string; characterName: string; description: string; lore: Array<{ title: string; content: string }> };
  query: string;
  querySignals: SearchQuerySignal[];
  serverInstanceId?: string;
  backfillApproved: boolean;
  postExtractionReview?: boolean;
}

export type DashboardContext = Omit<CurrentContext, "chat" | "estimatedSourceTokens" | "snapshotScope" | "snapshot" | "lineageHint" | "staticProjection" | "query" | "querySignals"> & { estimatedSourceTokens?: number; snapshot?: never; snapshotScope?: never };

export interface RuntimeState {
  settings: PluginSettings;
  quizSupported?: boolean;
  quizSynced?: { chatId: string; enabled: boolean };
  cache: Record<string, CachedChatState>;
  logs: RuntimeLog[];
  current?: CurrentContext | DashboardContext;
  lastPrepare?: TurnPrepareResponse;
  lastResolvedSetup?: { chatId: string; projection: ResolvedSetupProjection };
  activeMemoryLanguages?: Record<string, MemoryLanguage>;
  perspectiveStatus?: { perspectives: string[]; unresolved: boolean; omissionReason?: TurnPrepareResponse["omissionReason"] };
  automaticTurnPacket?: {
    turnKey: string;
    chatId: string;
    memoryOnlyInjection?: boolean;
    requestedBudget: number;
    promptSourceMessageIds: string[];
    latestMessageId?: string;
    response: TurnPrepareResponse;
  };
  lastInjection?: {
    turnKey: string;
    chatId: string;
    packet: string;
    requestedBudget: number;
    preparedTokens: number;
    injectedTokens: number;
    removedTokens: number;
    reused: boolean;
    prepareElapsedMs?: number;
    prepareTimeoutMs?: number;
    prepareClientTimings?: PrepareClientTimings;
    packetApplyMs?: number;
    memoryToolRegistrationMs?: number;
    memoryToolRegistration?: "not_run" | "completed" | "failed";
    traceDelivery?: { eventId: string; requestId: string; status: "queued" | "succeeded" | "failed"; startedAt: number; elapsedMs?: number; error?: string };
    prepareRequestId?: string;
    prepareOutcome?: "fresh" | "reused" | "timeout" | "error" | "skipped";
    prepareError?: string;
    /** Client-side checkpoints used to distinguish server preparation from delivery. */
    clientStages?: {
      response: "received" | "not_received" | "not_requested";
      body: "read" | "not_read" | "failed";
      json: "parsed" | "failed" | "not_parsed";
      schema: "parsed" | "failed" | "not_parsed";
      packet: "injected" | "omitted";
      registration: "not_run" | "completed" | "failed";
      diagnostic: "queued" | "not_queued";
    };
    omitted: boolean;
    omissionReason?: "marker_absent" | "empty_packet" | "injection_budget" | "budget_zero" | "no_memories" | "unresolved_perspective" | "no_relevance";
    /** True when the provider request was rejected before dispatch. */
    blocked?: boolean;
    blockReason?: string;
    /** Whether the common interpretation guidance reached the model this turn. */
    guidanceInjected?: boolean;
    /** Whether the packet contained a record beyond the common guidance. */
    evidenceInjected?: boolean;
    manifest: NonNullable<TurnPrepareResponse["injectionManifest"]>;
    at: number;
  };
  lastPromptValidation?: {
    chatId: string;
    status: "marker_present" | "existing_context" | "marker_missing" | "disabled";
    at: number;
  };
  modelRequestEpoch?: number;
  activeModelRequest?: { chatId: string; turnKey?: string; latestMessageId?: string; startedAt?: number; packet?: string; plannedTools?: string[] };
  retryCounts: Record<string, number>;
  workerId: string;
  idleTimer?: number;
  postResponseTimer?: number;
  pendingOutputSyncChatId?: string;
  serverHeartbeatTimer?: number;
  statusWidgetTimer?: number;
  activityTimer?: number;
  updateNextCheckAt?: number;
  updateLocalRecheckAt?: number;
  updateDashboardChecked?: boolean;
  updateCheckPromise?: Promise<RuntimeState["updateStatus"] | undefined>;
  updateApplying?: { targetVersion: string; startedAt: number; error?: string };
  updateStatus?: {
    configured: boolean;
    channel: "stable";
    currentServerVersion: string;
    apiRevision: number;
    checkedAt?: string;
    available: boolean;
    latestVersion?: string;
    latestPluginVersion?: string;
    latestServerVersion?: string;
    latestReleaseNotes?: string;
    minimumPluginVersion?: string;
    minimumServerVersion?: string;
    notesUrl?: string;
    pluginUrl?: string;
    canStageServer: boolean;
    canApplyAutomatically?: boolean;
    stagedVersion?: string;
    restartRequired?: boolean;
    error?: string;
  };
  workerBusy: boolean;
  currentJob?: { id: string; chatId: string; attempt: number; sourceMessageCount: number; sourceTurnCount?: number; startedAt: number; kind?: string; sourceRecovery?: boolean; phase?: "first_extraction" | "initial_calibration" | "relationship_projection" | "story_consolidation" | "social_backfill" | "capsule" | "post_extraction_audit" | "state_reconciliation" | "ledger_consistency" | "storing" };
  serverWorker?: ServerWorkerStatus;
  statusSummary?: {
    queuedJobs: number; failedJobs: number; blockingFailedJobs?: number; advisoryFailedJobs?: number; pendingReviews: number; pendingReconciliations?: number;
    waitingForAssistant?: number; bufferedMessages?: number; bufferedTurns?: number; bufferedSourceTokens?: number;
    extractionGroupTurns?: number; recoverableMessages?: number; historicalBackfillMessages?: number;
    ingestionState?: "historical_pending" | "managed" | "cleared"; pendingEmbeddings: number; failedEmbeddings: number;
    progress?: ActivityProgress;
    initialCalibration?: InitialCalibrationActivity;
    episode?: EpisodeActivity | null;
  };
  episodeActivity?: EpisodeActivity | null;
  translationActivity?: { pending: number; error?: string };
  activitySubscribers?: Set<(summary: RuntimeState["statusSummary"]) => void>;
  activityRevision?: number;
  statusSummaryRevision?: number;
  activityReady?: boolean;
  activityStatusError?: string;
  serverConnectionIssue?: ServerConnectionIssue;
  serverConnectionFailureCount?: number;
  serverConnectionLastFailureAt?: number;
  publishActivity?: () => void;
  publishStatusSummary?: () => void;
  refreshStatusWidget?: () => void;
  syncMemoryToolRegistration?: (enabled: boolean) => Promise<void>;
  restoreMemoryToolDiscoveryRegistration?: () => Promise<void>;
  setStatusWidgetHidden?: (hidden: boolean) => Promise<void>;
  mcpTurnKey: string;
  mcpTraceCalls?: number;
  mcpReturnedMemoryIds?: string[];
  mcpReturnedMemorySignatures?: string[];
  mcpReturnedAtomKeys?: string[];
  mcpReturnedSourceRanges?: import("@rcm/shared").McpSourceRange[];
  mcpGuidanceDelivered?: boolean;
  retrievalTraceEnabled?: boolean;
  memoryReferenceSnapshot?: string;
  memoryToolAvailability?: Record<string, boolean>;
  memoryToolOpportunity?: { chatId: string; turnKey: string; referenceTurnKey: string; value: MemoryToolOpportunity };
  memoryToolExposureKeys?: Record<string, boolean>;
  lastPromptSourceMessageIds?: string[];
  internalModelCall: boolean;
  timingEvents?: import("./timing.js").TimingEvent[];
  openDashboard?: () => void;
  /** Set by the chip's quiz before openDashboard: the memory the dashboard opens on. */
  dashboardFocusMemoryId?: string;
  lineageProbe?: { key: string; status: "checking" | "ready" | "failed"; result?: LineageProbeResponse; selectedParentId?: string; error?: string };
}

export interface ActivityProgress {
  processedMessages: number;
  totalMessages: number;
  processedGroups: number;
  totalGroups: number;
  failedGroups: number;
  memories: number;
  details: number;
  pendingRelationshipPairs: number;
  pendingRelationshipProjectionJobs: number;
  processedTasks?: number;
  totalTasks?: number;
  failedTasks?: number;
  activeStage?: string;
  activeGroupOrdinal?: number;
  activeGroupTotal?: number;
  retryAttempt?: number;
  retryMax?: number;
  ledgerProcessed?: number;
  ledgerTotal?: number;
  ledgerFailed?: number;
  downstreamWaiting?: boolean;
  relationshipProcessed?: number;
  relationshipTotal?: number;
  relationshipFailed?: number;
  storyProcessed?: number;
  storyTotal?: number;
  storyPending?: number;
  storyFailed?: number;
  llmCalls?: number;
  repairCalls?: number;
  runComplete?: boolean;
  acknowledged?: boolean;
  backfillRunId?: string;
}

export interface InitialCalibrationActivity {
  status: "unseeded" | "awaiting_setup" | "queued" | "awaiting_confirmation" | "ready" | "failed" | "inherited" | "skipped";
  origin?: "new_root" | "cold_start" | "inherited";
  confirmationRequired: boolean;
  locked: boolean;
  lastError?: string;
  updatedAt?: number;
}

export interface EpisodeActivity {
  id: string;
  status: "holding" | "queued" | "processing" | "failed";
  startOrdinal: number;
  endOrdinal?: number;
  sourceTokens: number;
  messageCount: number;
  turnCount: number;
  lastError?: string;
}
