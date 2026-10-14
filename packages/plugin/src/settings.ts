import { defaultCanonicalizationPolicy, sanitizeDiagnosticText } from "@rcm/shared";
import type { PluginSettings, RuntimeLog } from "./types.js";

export const SETTINGS_KEY = "rcm.settings.v1";
export const CACHE_KEY = "rcm.cache.v1";
const TOKEN_ARGUMENT = "hidden_server_token";
const diagnosticSecrets = new Set<string>();
export function rememberDiagnosticSecrets(values: readonly string[]): void {
  values.filter(Boolean).forEach(value => diagnosticSecrets.add(value));
}

export const defaults: PluginSettings = {
  settingsRevision: 21,
  serverUrl: "http://127.0.0.1:7331",
  serverToken: "",
  defaultChatEnabled: true,
  chatEnabled: {},
  chatCatchUpPending: {},
  workerPaused: false,
  statusWidgetVisible: true,
  quizEnabled: true,
  defaultProfile: "companion",
  profiles: {},
  perspectives: {},
  detectedPerspectives: {},
  includeUserMessages: {},
  memoryOnlyInjection: {},
  sourceProtectionTurns: 10,
  editProtectionTurns: 2,
  canonicalizationPolicy: defaultCanonicalizationPolicy(),
  extractionGroupTurns: {},
  memoryLanguages: {},
  backfillApproved: {},
  serverInstances: {},
  auxiliaryMode: "memory",
  extractionEngine: "server",
  postExtractionReview: false,
  staticModel: "",
  translationProvider: "google",
  translationSlot: "translate",
  translationModel: "",
  translationMaxOutput: 8000,
  translationServerModel: "",
  translationServerMaxOutput: 8000,
  translationTemperature: 0.3,
  translationThinking: "default",
  translationBackground: false,
  translationDisplay: "ko",
  autoTranslate: true,
  dashboardTheme: "light",
  dashboardSkin: "phone",
  defaultMemoryBudget: 6_000,
  memoryBudgets: {},
  mcpCap: 4_000,
  memoryToolsEnabled: true,
  storyOverviewBackups: {},
};

function parseStored<T>(value: unknown): T | undefined {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string" || !value.trim()) return undefined;
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

/** Revision 20 differs only by the optional, default-off injection preference. */
export function supportedSettingsRevision(revision: unknown): boolean {
  return revision === defaults.settingsRevision || revision === 20;
}

export function normalizeMemoryOnlyInjection(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

export async function loadStoredJson<T>(key: string): Promise<T | undefined> {
  const local = await risuai.getLocalPluginStorage();
  return parseStored<T>(await local.getItem(key));
}

export async function saveStoredJson(key: string, value: unknown): Promise<void> {
  const local = await risuai.getLocalPluginStorage();
  await local.setItem(key, value);
}

export async function loadSettings(): Promise<PluginSettings> {
  const stored = await loadStoredJson<Partial<PluginSettings>>(SETTINGS_KEY);
  if (stored && !supportedSettingsRevision(stored.settingsRevision)) {
    throw Object.assign(new Error(`RCM pre-release settings ${stored.settingsRevision ?? "unknown"} are unsupported. Reinstall the plugin or clear its settings.`), { code: "PRE_RELEASE_SETTINGS_RESET_REQUIRED" });
  }
  const argUrl = await risuai.getArgument("server_url");
  const hiddenArgToken = await risuai.getArgument(TOKEN_ARGUMENT);
  const argProfile = await risuai.getArgument("default_profile");
  const storedTranslationDisplay = (stored as { translationDisplay?: unknown } | undefined)?.translationDisplay;
  const translationDisplay = storedTranslationDisplay === "en" ? "en" : "ko";
  const storedPolicy = stored?.canonicalizationPolicy;
  const canonicalizationPolicy = {
    useLightboard: storedPolicy?.useLightboard === true,
    useGigaTrans: true,
    customRules: Array.isArray(storedPolicy?.customRules) ? storedPolicy.customRules.filter((rule) => rule && typeof rule === "object").map((rule) => ({
      name: typeof rule.name === "string" ? rule.name : "",
      enabled: rule.enabled !== false,
      pattern: typeof rule.pattern === "string" ? rule.pattern : "",
      flags: typeof rule.flags === "string" ? rule.flags : "gis",
    })) : [],
  };
  const settings: PluginSettings = {
    ...defaults,
    defaultChatEnabled: stored?.defaultChatEnabled ?? defaults.defaultChatEnabled,
    chatEnabled: stored?.chatEnabled ?? {},
    chatCatchUpPending: stored?.chatCatchUpPending ?? {},
    workerPaused: stored?.workerPaused ?? defaults.workerPaused,
    workerAttention: stored?.workerAttention,
    statusWidgetPosition: stored?.statusWidgetPosition,
    statusWidgetVisible: stored?.statusWidgetVisible !== false,
    quizEnabled: stored?.quizEnabled ?? defaults.quizEnabled,
    profiles: stored?.profiles ?? {},
    perspectives: stored?.perspectives ?? {},
    detectedPerspectives: stored?.detectedPerspectives ?? {},
    includeUserMessages: stored?.includeUserMessages ?? {},
    memoryOnlyInjection: normalizeMemoryOnlyInjection(stored?.memoryOnlyInjection),
    sourceProtectionTurns: Math.min(20, Math.max(1, Math.round(Number(stored?.sourceProtectionTurns ?? defaults.sourceProtectionTurns)))),
    editProtectionTurns: Math.min(5, Math.max(1, Math.round(Number(stored?.editProtectionTurns ?? defaults.editProtectionTurns)))),
    canonicalizationPolicy,
    extractionGroupTurns: stored?.extractionGroupTurns ?? {},
    memoryLanguages: stored?.memoryLanguages ?? {},
    memoryBudgets: stored?.memoryBudgets ?? {},
    backfillApproved: stored?.backfillApproved ?? {},
    serverInstances: stored?.serverInstances ?? {},
    storyOverviewBackups: stored?.storyOverviewBackups ?? {},
    auxiliaryMode: stored?.auxiliaryMode ?? defaults.auxiliaryMode,
    extractionEngine: stored?.extractionEngine ?? defaults.extractionEngine,
    postExtractionReview: stored?.postExtractionReview ?? defaults.postExtractionReview,
    staticModel: stored?.staticModel ?? defaults.staticModel,
    translationProvider: stored?.translationProvider ?? defaults.translationProvider,
    translationSlot: stored?.translationSlot ?? defaults.translationSlot,
    translationModel: stored?.translationModel ?? defaults.translationModel,
    translationMaxOutput: stored?.translationMaxOutput ?? defaults.translationMaxOutput,
    translationServerModel: stored?.translationServerModel ?? defaults.translationServerModel,
    translationServerMaxOutput: stored?.translationServerMaxOutput ?? defaults.translationServerMaxOutput,
    translationTemperature: stored?.translationTemperature ?? defaults.translationTemperature,
    translationThinking: stored?.translationThinking ?? defaults.translationThinking,
    translationBackground: stored?.translationBackground === true,
    translationDisplay,
    autoTranslate: translationDisplay === "ko",
    dashboardTheme: stored?.dashboardTheme ?? defaults.dashboardTheme,
    dashboardSkin: stored?.dashboardSkin ?? defaults.dashboardSkin,
    defaultMemoryBudget: stored?.defaultMemoryBudget ?? defaults.defaultMemoryBudget,
    mcpCap: stored?.mcpCap ?? defaults.mcpCap,
    memoryToolsEnabled: stored?.memoryToolsEnabled ?? defaults.memoryToolsEnabled,
    serverUrl: stored?.serverUrl || (typeof argUrl === "string" && argUrl) || defaults.serverUrl,
    serverToken: stored?.serverToken
      || (typeof hiddenArgToken === "string" && hiddenArgToken)
      || defaults.serverToken,
    defaultProfile: stored?.defaultProfile ?? (argProfile === "simulation" ? "simulation" : "companion"),
  };
  const allowedBudgets = new Set([4_000, 6_000, 8_000, 12_000]);
  settings.defaultMemoryBudget = allowedBudgets.has(Number(settings.defaultMemoryBudget))
    ? Number(settings.defaultMemoryBudget) as PluginSettings["defaultMemoryBudget"]
    : defaults.defaultMemoryBudget;
  settings.memoryBudgets = Object.fromEntries(Object.entries(settings.memoryBudgets)
    .filter((entry): entry is [string, PluginSettings["defaultMemoryBudget"]] => allowedBudgets.has(Number(entry[1]))));
  settings.mcpCap = Math.max(1_500, Math.min(4_000, Number(settings.mcpCap) || defaults.mcpCap));
  settings.dashboardTheme = settings.dashboardTheme === "light" ? "light" : "dark";
  settings.dashboardSkin = settings.dashboardSkin === "phone" ? "phone" : "film";
  settings.settingsRevision = defaults.settingsRevision;
  rememberDiagnosticSecrets([settings.serverToken]);
  return settings;
}

function sameSettings(left: PluginSettings | undefined, right: PluginSettings): boolean {
  return !!left
    && left.settingsRevision === right.settingsRevision
    && left.serverUrl === right.serverUrl
    && left.serverToken === right.serverToken
    && left.defaultChatEnabled === right.defaultChatEnabled
    && JSON.stringify(left.chatEnabled) === JSON.stringify(right.chatEnabled)
    && JSON.stringify(left.chatCatchUpPending) === JSON.stringify(right.chatCatchUpPending)
    && left.workerPaused === right.workerPaused
    && JSON.stringify(left.workerAttention) === JSON.stringify(right.workerAttention)
    && JSON.stringify(left.statusWidgetPosition) === JSON.stringify(right.statusWidgetPosition)
    && (left.statusWidgetVisible !== false) === (right.statusWidgetVisible !== false)
    && (left.quizEnabled === true) === (right.quizEnabled === true)
    && left.defaultProfile === right.defaultProfile
    && left.auxiliaryMode === right.auxiliaryMode
    && left.extractionEngine === right.extractionEngine
    && left.postExtractionReview === right.postExtractionReview
    && left.staticModel === right.staticModel
    && left.translationProvider === right.translationProvider
    && ["translationSlot", "translationModel", "translationMaxOutput", "translationServerModel", "translationServerMaxOutput", "translationTemperature", "translationThinking", "translationBackground"].every(key => left[key as keyof PluginSettings] === right[key as keyof PluginSettings])
    && left.translationDisplay === right.translationDisplay
    && left.autoTranslate === right.autoTranslate
    && left.dashboardTheme === right.dashboardTheme
    && left.dashboardSkin === right.dashboardSkin
    && left.defaultMemoryBudget === right.defaultMemoryBudget
    && JSON.stringify(left.memoryBudgets) === JSON.stringify(right.memoryBudgets)
    && left.mcpCap === right.mcpCap
    && left.memoryToolsEnabled === right.memoryToolsEnabled
    && JSON.stringify(left.storyOverviewBackups) === JSON.stringify(right.storyOverviewBackups)
    && JSON.stringify(left.profiles) === JSON.stringify(right.profiles)
    && JSON.stringify(left.perspectives) === JSON.stringify(right.perspectives)
    && JSON.stringify(left.detectedPerspectives) === JSON.stringify(right.detectedPerspectives)
    && JSON.stringify(left.includeUserMessages) === JSON.stringify(right.includeUserMessages)
    && JSON.stringify(left.memoryOnlyInjection) === JSON.stringify(right.memoryOnlyInjection)
    && left.sourceProtectionTurns === right.sourceProtectionTurns
    && left.editProtectionTurns === right.editProtectionTurns
    && JSON.stringify(left.canonicalizationPolicy) === JSON.stringify(right.canonicalizationPolicy)
    && JSON.stringify(left.extractionGroupTurns) === JSON.stringify(right.extractionGroupTurns)
    && JSON.stringify(left.memoryLanguages) === JSON.stringify(right.memoryLanguages)
    && JSON.stringify(left.backfillApproved) === JSON.stringify(right.backfillApproved)
    && JSON.stringify(left.serverInstances) === JSON.stringify(right.serverInstances);
}

export function isChatMemoryEnabled(settings: PluginSettings, chatId: string): boolean {
  return settings.chatEnabled[chatId] ?? settings.defaultChatEnabled;
}

export function serverScopeKey(settings: PluginSettings, chatId: string): string | undefined {
  const instanceId = settings.serverInstances[settings.serverUrl.replace(/\/$/, "")];
  return instanceId ? `${instanceId}:${chatId}` : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function saveSettings(settings: PluginSettings): Promise<void> {
  rememberDiagnosticSecrets([settings.serverToken]);
  let storageError: unknown;
  let argumentError: unknown;

  try {
    const local = await risuai.getLocalPluginStorage();
    await local.setItem(SETTINGS_KEY, settings);
    const keys = await local.keys();
    if (!keys.includes(SETTINGS_KEY)) throw new Error("Local plugin storage did not enumerate the saved settings key.");
    const stored = parseStored<PluginSettings>(await local.getItem(SETTINGS_KEY));
    if (!sameSettings(stored, settings)) throw new Error("Local plugin storage read-back did not match the saved settings.");
  } catch (error) {
    storageError = error;
  }

  try {
    if (typeof risuai.setArgument !== "function") throw new Error("Plugin argument storage is unavailable.");
    await risuai.setArgument("server_url", settings.serverUrl);
    await risuai.setArgument(TOKEN_ARGUMENT, settings.serverToken);
    await risuai.setArgument("default_profile", settings.defaultProfile);
    const [serverUrl, serverToken, defaultProfile] = await Promise.all([
      risuai.getArgument("server_url"),
      risuai.getArgument(TOKEN_ARGUMENT),
      risuai.getArgument("default_profile"),
    ]);
    if (serverUrl !== settings.serverUrl || serverToken !== settings.serverToken || defaultProfile !== settings.defaultProfile) {
      throw new Error("Plugin argument read-back did not match the saved connection settings.");
    }
  } catch (error) {
    argumentError = error;
  }

  if (storageError || argumentError) {
    const failures = [
      storageError && `local storage: ${errorMessage(storageError)}`,
      argumentError && `plugin arguments: ${errorMessage(argumentError)}`,
    ].filter(Boolean);
    throw new Error(`Settings persistence verification failed — ${failures.join("; ")}`);
  }
}

export function addLog(logs: RuntimeLog[], level: RuntimeLog["level"], message: string, diagnostic?: RuntimeLog["diagnostic"], detail?: string): void {
  const secrets = [...diagnosticSecrets];
  logs.unshift({ at: Date.now(), level, message: sanitizeDiagnosticText(message, secrets, 1000), ...(diagnostic ? { diagnostic } : {}), ...(detail ? { detail: sanitizeDiagnosticText(detail, secrets) } : {}) });
  logs.splice(50);
}
