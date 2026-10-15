import Database from "better-sqlite3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RETRIEVAL_TRACE_CHAT_PREFIX } from "./retrieval-trace.js";
import type { RecallPathObservation } from "./recall-path.js";
import type { AtomPath } from "./atom-path-search.js";

export interface TraceEvent {
  currentState?: import("./state-outcomes.js").StateOutcomeReport;
  selector?: import("./mcp-selector.js").SelectorDiagnostic;
  schema?: string;
  id?: string;
  at?: number;
  kind?: string;
  chatId?: string;
  traceContext?: { requestId?: string; turnKey?: string; callIndex?: number };
  source?: { userTurn?: number; sourceOrdinal?: number; latestMessageId?: string };
  query?: unknown;
  aspects?: unknown[];
  packet?: unknown;
  response?: unknown;
  selectedIds?: string[];
  searchRequestId?: string;
  prepareOutcome?: string;
  prepareElapsedMs?: number;
  timings?: Record<string, number>;
  syncTimings?: Record<string, number>;
  injectedTokens?: number;
  manifest?: { memoryIds?: string[]; atomKeys?: string[] };
  retrieval?: Record<string, any>;
  retrievals?: Array<Record<string, any>>;
  budget?: Record<string, any>;
  selection?: Record<string, any>;
  story?: Record<string, any>;
  overlap?: Record<string, any>;
  continuity?: Record<string, any>;
  toolOpportunity?: Record<string, any>;
  transport?: string;
  offeredTools?: string[];
  /** Tool names observed in the actual provider request, when the host records it. */
  actualTools?: string[];
  observationStatus?: "observed" | "unmatched" | "unavailable" | "read_error" | "malformed" | "ambiguous";
  exposureEvidence?: "provider_request" | "registration_ack" | "unknown";
  outcome?: string;
  elapsedMs?: number;
  toolName?: string;
  cacheHit?: boolean;
  newAtomCount?: number;
  [key: string]: unknown;
}

export interface TraceParseResult {
  events: TraceEvent[];
  invalidLines: number;
  unsupportedLines: number;
}

type LatencyBand = "within_target" | "slow" | "over_limit" | "failed" | "unmeasured";

const nonnegativeNumber = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const ordinal = (value: unknown): number | null | undefined => value === null ? null : Number.isInteger(value) ? nonnegativeNumber(value) : undefined;

function latencyBand(elapsedMs: unknown, outcome: string | undefined): LatencyBand {
  if (["timeout", "error", "failed", "rejected"].includes(outcome ?? "")) return "failed";
  const elapsed = nonnegativeNumber(elapsedMs);
  if (elapsed === undefined || !["fresh", "reused", "delivered"].includes(outcome ?? "")) return "unmeasured";
  return elapsed > 10_000 ? "over_limit" : elapsed > 5_000 ? "slow" : "within_target";
}

const latencyLabels: Record<LatencyBand, string> = {
  within_target: "5초 이내", slow: "5~10초 · 지연 관찰", over_limit: "10초 초과",
  failed: "실패/중단 · 성공 지연과 별도", unmeasured: "시간 또는 완료 결과 미기록",
};

export interface TurnAnalysis {
  chatId: string;
  turnKey: string;
  userTurn?: number;
  at: number;
  queryExcerpt: string;
  eventKinds: string[];
  searchInjection: string;
  prepare: { outcome?: string; elapsedMs?: number; latency: LatencyBand; timeoutMs?: number; fallbackTokens?: number; clientTimings?: Record<string, number> };
  timings?: Record<string, number>;
  syncTimings?: Record<string, number>;
  currentState?: import("./state-outcomes.js").StateOutcomeReport;
  manifestStatus: "기록됨" | "미기록";
  atomPreservation?: { roleTokens: Record<string, number>; focusExpected: number; focusDelivered: number;
    injectedRoleTokens?: Record<string, number>; focusInjected?: number; cueAnchorExpected: number; cueAnchorDelivered: number;
    cueAnchorInjected?: number; cueAnchorMemoryIds: string[]; forcedDrops: number; decisions: unknown[] };
  candidates: number;
  eligible: number;
  selected: number;
  packetTokens?: number;
  preparedPacketTokens?: number;
  targetTokens: number;
  hardTokenCeiling: number;
  toolSummary: string;
  mcpTimings: Array<{ requestId?: string; toolName?: string; outcome?: string; reason?: string; ref?: string; origin?: string; latency: LatencyBand; server?: Record<string, number>; selector?: import("./mcp-selector.js").SelectorDiagnostic; requestMs?: number; elapsedMs?: number; cacheHit: boolean }>;
  elapsedMs?: number;
  status: "정상" | "확인 필요";
  warnings: string[];
  selectedMemories: Array<{ id: string; title: string; role: string; outcome: string }>;
  recallPaths: Array<{ requestId?: string; kind: "automatic_search" | "mcp_search"; perspective: string;
    candidateId: string; outcome: string; observation: RecallPathObservation; atomPath?: AtomPath }>;
  pathFates: Array<{ requestId?: string; kind: "automatic_search" | "mcp_search"; perspective: string; candidateId: string;
    endpointId: string; retrievalOutcome: string; finalRole?: string; atomOutcomes: Array<{ atomKey: string; outcome: string; delivered?: boolean }> }>;
  connections: {
    automaticSearchId?: string;
    injectionSearchRequestId?: string;
    mcpSearchIds: string[];
    mcpDeliverySearchRequestIds: string[];
  };
  budget: { packetTokens?: number; preparedPacketTokens?: number; targetTokens: number; hardTokenCeiling: number;
    overflowTokens: number; estimatorHeadroomTokens: number; processedThrough?: number | null; latestProcessed?: number | null;
    refillAdded?: number; unusedTokens?: number; unusedReason?: string; sectionTokens?: Record<string,number>; stateKinds?: Record<string,number>; stateInventory?: Record<string,number>; stateSearch?: {available:boolean;canonical:number;indexed:number;oversized:number}; sceneDelivery?: Array<{ref?:string;memoryId:string;details:number;dialogues:number}> };
  tools: { opportunities: number; exposures: number; exposureEvents: number; unknownExposure: number; acknowledged: number; plannedEmpty: number; confirmedAbsent: number; calls: number; errors: number; registrations: Array<{ outcome?: string; diagnostics?: unknown }> };
  events: TraceEvent[];
}

export interface DiagnosticAnalysis {
  sourceRecovery?: { jobs: number; withAdditions: number; noOp: number; failed: number; unreported: number };
  qualityReview: { status: "manual_review_required"; criteria: string[]; note: string };
  schema: "rcm.retrieval-diagnostics-report.v2";
  generatedAt: string;
  source: string;
  status: "정상" | "확인 필요" | "기록 없음";
  selectedChats: string[];
  invalidLines: number;
  unsupportedLines: number;
  warnings: string[];
  turns: TurnAnalysis[];
}

const textValue = (value: unknown): string => typeof value === "string" ? value : "";
const excerpt = (value: unknown, max = 180): string => textValue(value).replace(/\s+/gu, " ").trim().slice(0, max);
const escapeCell = (value: unknown, max = 120): string => String(value ?? "").replaceAll("|", "\\|").replace(/\s+/gu, " ").slice(0, max);
const idList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
function clientStageSummary(event: TraceEvent | undefined): string {
  const stages = event?.clientStages as Record<string, unknown> | undefined;
  if (!stages) return "미기록";
  const fields = ["response", "body", "json", "schema", "registration", "packet", "diagnostic"];
  const delivery = event?.traceDelivery as Record<string, unknown> | undefined;
  return `${fields.map((key) => `${key}=${String(stages[key] ?? "미기록")}`).join(", ")}; packetApplyMs=${typeof event?.packetApplyMs === "number" ? event.packetApplyMs.toFixed(2) : "미기록"}; memoryToolRegistrationMs=${typeof event?.memoryToolRegistrationMs === "number" ? event.memoryToolRegistrationMs.toFixed(2) : "미기록"}; traceDelivery=${String(delivery?.status ?? "미기록")}`;
}

export function parseTrace(content: string): TraceParseResult {
  const events: TraceEvent[] = [];
  let invalidLines = 0;
  let unsupportedLines = 0;
  for (const line of content.split(/\r?\n/u).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as TraceEvent;
      if (event.schema !== "rcm.retrieval-trace.v19") { unsupportedLines += 1; continue; }
      if (!event.chatId || !event.kind) { invalidLines += 1; continue; }
      events.push(event);
    } catch { invalidLines += 1; }
  }
  return { events, invalidLines, unsupportedLines };
}

function groupEvents(events: TraceEvent[]): TraceEvent[][] {
  const sourceGroups = new Map<string, TraceEvent[]>();
  for (const event of events) {
    const turnKey = event.source?.latestMessageId ?? (Number.isFinite(event.source?.userTurn) ? `user-turn:${event.source?.userTurn}` : undefined)
      ?? event.traceContext?.turnKey ?? event.traceContext?.requestId ?? event.id ?? `${event.kind}:${event.at}`;
    const key = `${event.chatId}:${turnKey}`;
    const group = sourceGroups.get(key) ?? [];
    group.push(event);
    sourceGroups.set(key, group);
  }
  const groups: TraceEvent[][] = [];
  for (const sourceGroup of sourceGroups.values()) {
    const ordered = sourceGroup.sort((left, right) => Number(left.at ?? 0) - Number(right.at ?? 0));
    const searches = ordered.filter((event) => event.kind === "automatic_search");
    if (searches.length <= 1) { groups.push(ordered); continue; }

    // A reroll keeps the same source message id, so split repeated prepare attempts by
    // request id. Events without an explicit link belong to the latest preceding
    // attempt (for example the host tool-exposure event emitted after prepare).
    const attempts = new Map<TraceEvent, TraceEvent[]>(searches.map((search) => [search, []]));
    const searchById = new Map<string, TraceEvent>();
    for (const search of searches) {
      for (const id of [search.id, search.traceContext?.requestId]) if (id) searchById.set(id, search);
    }
    for (const event of ordered) {
      const linkedId = event.kind === "automatic_injection" ? event.searchRequestId : undefined;
      const exact = linkedId ? searchById.get(linkedId) : undefined;
      const preceding = [...searches].reverse().find((search) => Number(search.at ?? 0) <= Number(event.at ?? 0));
      (attempts.get(exact ?? preceding ?? searches[0]!) ?? attempts.get(searches[0]!)!).push(event);
    }
    groups.push(...[...attempts.values()].filter((attempt) => attempt.length > 0));
  }
  return groups;
}

function retrievalsFor(event: TraceEvent | undefined): Array<Record<string, any>> {
  if (!event) return [];
  return event.retrievals?.length ? event.retrievals : event.retrieval ? [event.retrieval] : [];
}

function matchingSearch(events: TraceEvent[], injection?: TraceEvent): TraceEvent | undefined {
  const searches = events.filter((event) => event.kind === "automatic_search");
  const id = injection?.searchRequestId ?? injection?.traceContext?.requestId;
  const exact = id ? searches.find((event) => event.id === id || event.traceContext?.requestId === id) : undefined;
  if (exact || injection?.searchRequestId) return exact;
  // A single current-format attempt can be connected by its source turn.
  // Never guess between multiple prepare attempts.
  return searches.length === 1 ? searches[0] : undefined;
}

function analyzeTurn(events: TraceEvent[]): TurnAnalysis {
  const injection = [...events].reverse().find((event) => event.kind === "automatic_injection");
  const search = matchingSearch(events, injection);
  const failedPrepare = injection?.prepareOutcome === "timeout" || injection?.prepareOutcome === "error";
  const prepare = {
    outcome: injection?.prepareOutcome,
    clientTimings: injection?.prepareClientTimings as Record<string, number> | undefined,
    elapsedMs: nonnegativeNumber(injection?.prepareElapsedMs),
    latency: latencyBand(injection?.prepareElapsedMs, injection?.prepareOutcome),
    timeoutMs: typeof injection?.prepareTimeoutMs === "number" ? injection.prepareTimeoutMs : undefined,
    fallbackTokens: typeof injection?.fallbackTokens === "number" ? injection.fallbackTokens : undefined,
  };
  const failureLabel = injection?.prepareOutcome === "timeout" ? "준비 시간 초과" : "준비 오류";
  const deliveryLabel = typeof injection?.injectedTokens !== "number" ? "전달량 미기록"
    : injection.injectedTokens > 0 && (prepare.fallbackTokens ?? 0) > 0 ? "상태 캐시로 대체" : "기억 미전달";
  const retrievals = retrievalsFor(search);
  const candidates = Math.max(0, ...retrievals.map((item) => Number(item.candidateCount ?? item.candidates?.length ?? 0)));
  const eligible = Math.max(0, ...retrievals.map((item) => Number(item.eligibleCount ?? 0)));
  const selectedIds = idList(search?.selectedIds);
  const selectedCandidateMap = new Map<string, { id: string; title: string; role: string; outcome: string }>();
  for (const retrieval of retrievals) for (const item of retrieval.candidates ?? []) {
    if (selectedIds.includes(String(item.id)) || item.outcome === "selected") selectedCandidateMap.set(String(item.id), {
      id: String(item.id), title: String(item.title ?? item.id), role: String(item.selectionRole ?? item.candidateClass ?? "-"), outcome: String(item.outcome ?? "selected"),
    });
  }
  for (const id of selectedIds) if (!selectedCandidateMap.has(id)) selectedCandidateMap.set(id, { id, title: id, role: "-", outcome: "selected" });
  const warnings: string[] = [];
  if (!search && injection?.prepareOutcome !== "reused") warnings.push("대응하는 자동 검색 이벤트가 없습니다.");
  if (failedPrepare) warnings.push(`${failureLabel}·${deliveryLabel}`);
  if (injection && !injection.prepareOutcome) warnings.push("준비 결과가 미기록입니다.");
  if (search && !injection) warnings.push("검색은 기록됐지만 클라이언트 결과가 기록되지 않았습니다.");
  if (search && injection?.searchRequestId && injection.searchRequestId !== search.id && injection.searchRequestId !== search.traceContext?.requestId) warnings.push("검색과 주입의 요청 ID가 일치하지 않습니다.");
  if (eligible > 0 && selectedIds.length === 0) warnings.push("사용 가능한 후보가 있지만 선택된 기억이 없습니다.");
  if (search?.story?.nodes?.some((node: Record<string, any>) => node.level === "overview" && String(node.holder ?? "").normalize("NFKC").trim().toLocaleLowerCase() === "narrator")
    && idList(search.story.selectedNodeIds).length === 0) warnings.push("줄거리가 있지만 패킷에 들어가지 않았습니다.");
  if (selectedIds.length > Math.max(candidates, eligible)) warnings.push("선택된 기억 수가 후보 수보다 많습니다.");
  const packetTokens = typeof injection?.injectedTokens === "number" ? injection.injectedTokens : undefined;
  const preparedPacketTokens = typeof search?.budget?.finalPacketTokens === "number" ? search.budget.finalPacketTokens : undefined;
  const targetTokens = Number(search?.budget?.targetBudget ?? search?.budget?.actualTokenBudget ?? 0);
  const hardTokenCeiling = Number(search?.budget?.hardTokenCeiling ?? 0);
  if (hardTokenCeiling > 0 && (packetTokens ?? 0) > hardTokenCeiling) warnings.push("실제 주입 패킷이 최대 토큰 한도를 넘었습니다.");
  if (hardTokenCeiling > 0 && (preparedPacketTokens ?? 0) > hardTokenCeiling) warnings.push("서버 준비 패킷이 최대 토큰 한도를 넘었습니다.");
  if (selectedIds.length > 0 && !search?.packet && !injection?.packet && Number(injection?.injectedTokens ?? 0) === 0) warnings.push("선택된 기억은 있지만 주입 패킷이 없습니다.");
  const injectedIds = idList(injection?.manifest?.memoryIds);
  const missingIds = Array.isArray(injection?.manifest?.memoryIds) ? selectedIds.filter((id) => !injectedIds.includes(id)) : [];
  if (missingIds.length) warnings.push(`선택된 기억 ${missingIds.length}개가 실제 주입 manifest에 없습니다.`);
  const exposures = events.filter((event) => event.kind === "tool_exposure");
  const mcpSearches = events.filter((event) => event.kind === "mcp_search");
  const clientRequestIds = new Set(events.filter(event => event.kind === "mcp_delivery" && event.origin === "client")
    .map(event => event.traceContext?.requestId).filter(Boolean));
  const deliveries = events.filter(event => event.kind === "mcp_delivery"
    && !(event.origin === "server" && event.traceContext?.requestId && clientRequestIds.has(event.traceContext.requestId)));
  const opportunity = search?.toolOpportunity;
  const opportunityCount = idList(opportunity?.recallCandidateMemoryIds).length + (Array.isArray(opportunity?.followCandidates) ? opportunity.followCandidates.length : 0);
  if (opportunityCount > 0 && exposures.length === 0) warnings.push("기억 도구 후보가 있지만 호스트 노출 기록이 없습니다.");
  // A registration timeout only says that the acknowledgement was not seen in
  // time. Provider Manager may already have applied the bundle, so it is an
  // observation gap rather than evidence that the provider request lacked the
  // tools. Keep this separate from confirmed transport/registration failures.
  const observedProviderEvents = exposures.filter((event) => Array.isArray(event.actualTools));
  const unknownExposureKeys = new Set<string>();
  const exposureUnknown = exposures.filter((event) => {
    if (observedProviderEvents.length || !["timeout", "registration_acknowledged_late"].includes(String(event.outcome))) return false;
    const registrationId = (event.registration as Record<string, unknown> | undefined)?.requestId;
    const key = `${event.transport ?? "unknown"}:${registrationId ?? event.id ?? event.at}`;
    if (unknownExposureKeys.has(key)) return false;
    unknownExposureKeys.add(key);
    return true;
  });
  const exposureFailures = exposures.filter((event) => ["error", "not_connected", "stale_turn", "registration_rejected_late"].includes(String(event.outcome)));
  const latestExposures = [...new Map(exposures.filter((event) => !String(event.outcome).startsWith("registration_")).map((event) => [event.transport ?? "unknown", event])).values()];
  // offeredTools describes the bundle RCM intended/registered. It is not an
  // observation of the provider request. Only an explicit actualTools field
  // can confirm what the model request received.
  const offeredExposures = latestExposures.filter((event) => Array.isArray(event.actualTools) && idList(event.actualTools).length > 0);
  const acknowledgedExposures = latestExposures.filter((event) => event.outcome === "offered" && idList(event.offeredTools).length > 0);
  const confirmedAbsent = observedProviderEvents.filter((event) => idList(event.actualTools).length === 0).length;
  const providerLogReadFailed = latestExposures.some((event) => event.observationStatus === "read_error");
  if (exposureFailures.length) warnings.push(`기억 도구 노출 문제 ${exposureFailures.length}건이 있습니다.`);
  if (exposureUnknown.length) warnings.push(`기억 도구 등록 확인이 늦어 실제 provider 노출 여부를 확인할 수 없는 기록이 ${exposureUnknown.length}건 있습니다.`);
  const mcpErrors = events.filter((event) => event.kind?.startsWith("mcp_") && ["timeout", "error", "failed"].includes(String(event.outcome)));
  const rejected = deliveries.filter(event => event.outcome === "rejected");
  if (rejected.length) warnings.push(`MCP 거절/중단 ${rejected.length}건이 있습니다.`);
  if (mcpErrors.length) warnings.push(`MCP 오류 ${mcpErrors.length}건이 있습니다.`);
  const knownMcpSearchIds = new Set(mcpSearches.flatMap((event) => [event.id, event.traceContext?.requestId]).filter((value): value is string => Boolean(value)));
  const unlinkedDeliveries = deliveries.filter((event) => event.searchRequestId && !knownMcpSearchIds.has(event.searchRequestId));
  if (unlinkedDeliveries.length) warnings.push(`검색 요청과 연결되지 않은 MCP 응답이 ${unlinkedDeliveries.length}건 있습니다.`);
  if (prepare.latency === "over_limit") warnings.push("클라이언트 준비 요청이 10초를 넘었습니다.");
  const slowDeliveries = deliveries.filter(event => latencyBand(event.elapsedMs, event.outcome) === "over_limit");
  if (slowDeliveries.length) warnings.push(`MCP 도구 반환이 10초를 넘긴 호출이 ${slowDeliveries.length}건 있습니다.`);
  const toolNames = new Map<string, number>();
  for (const delivery of deliveries) toolNames.set(String(delivery.toolName ?? "memory tool"), (toolNames.get(String(delivery.toolName ?? "memory tool")) ?? 0) + 1);
  const toolSummary = deliveries.length
    ? [...toolNames].map(([name, count]) => `${name} ${count}회`).join(" · ")
    : offeredExposures.length ? "provider 노출 확인, 호출 없음"
      : confirmedAbsent ? "provider 요청에 RCM 도구 미포함 확인"
      : providerLogReadFailed ? "호스트 로그 읽기 실패 · 실제 노출 미확인"
      : latestExposures.some((event) => event.outcome === "timeout")
        ? exposures.some((event) => event.outcome === "registration_rejected_late" && latestExposures.some((latest) => (latest.registration as any)?.requestId === (event.registration as any)?.requestId && (event.registration as any)?.requestId))
          ? "등록 거부 확인 지연"
          : exposures.some((event) => event.outcome === "registration_acknowledged_late" && latestExposures.some((latest) => (latest.registration as any)?.requestId === (event.registration as any)?.requestId && (event.registration as any)?.requestId))
          ? "등록 확인 지연 (실제 노출 여부 미확인)" : "등록 확인 시간 초과 (실제 노출 여부 미확인)"
        : latestExposures.some((event) => ["error", "not_connected", "stale_turn"].includes(String(event.outcome))) ? "노출 실패"
        : latestExposures.some((event) => event.outcome === "empty") ? "도구 없음으로 계획됨 (provider 노출 미확인)"
          : acknowledgedExposures.length ? "등록 확인, provider 노출 미확인"
          : opportunityCount > 0 ? "노출 기록 없음" : "없음";
  const at = Math.max(...events.map((event) => Number(event.at ?? 0)), 0);
  // Compare observed client requests only, never mix registration/server phases
  // into the end-to-end latency or infer a missing client duration from them.
  const elapsedValues = [prepare.elapsedMs, ...deliveries.map(event => nonnegativeNumber(event.elapsedMs))].filter((value): value is number => value !== undefined);
  const injectedAtomKeys = Array.isArray(injection?.manifest?.atomKeys) ? new Set(idList(injection.manifest.atomKeys)) : undefined;
  const injectedDecisions = injectedAtomKeys && Array.isArray(search?.atomPreservation)
    ? search.atomPreservation.filter((atom: any) => !failedPrepare && injectedAtomKeys.has(atom.atomKey)) : undefined;
  return {
    chatId: String(events[0]?.chatId ?? "unknown"),
    turnKey: String(events[0]?.traceContext?.turnKey ?? events[0]?.traceContext?.requestId ?? events[0]?.id ?? "unknown"),
    userTurn: events.map((event) => event.source?.userTurn).find((value) => Number.isFinite(value)),
    at,
    queryExcerpt: excerpt(search?.query ?? events.find((event) => typeof event.query === "string")?.query),
    eventKinds: [...new Set(events.map((event) => String(event.kind)))],
    searchInjection: failedPrepare ? `${failureLabel}·${deliveryLabel}`
      : injection?.prepareOutcome === "reused" ? "재사용"
        : injection && !injection.prepareOutcome ? "준비 결과 미기록"
          : injection?.omitted ? "주입 생략"
            : injection?.prepareOutcome === "skipped" ? "준비 생략"
              : search ? injection ? "정상" : "클라이언트 결과 미기록" : "검색 없음",
    mcpTimings: deliveries.map(delivery => ({requestId:delivery.traceContext?.requestId ?? delivery.searchRequestId,
      toolName: delivery.toolName, outcome: delivery.outcome, reason: delivery.reason as string | undefined, ref: delivery.ref as string | undefined, origin: delivery.origin as string | undefined, latency: latencyBand(delivery.elapsedMs, delivery.outcome),
      server: ((delivery.searchRequestId ? mcpSearches.find(event => event.id === delivery.searchRequestId || event.traceContext?.requestId === delivery.searchRequestId)?.timings : undefined) ?? delivery.serverTimings) as Record<string, number> | undefined,
      selector: delivery.searchRequestId ? mcpSearches.find(event => event.id === delivery.searchRequestId || event.traceContext?.requestId === delivery.searchRequestId)?.selector : undefined,
      requestMs: nonnegativeNumber(delivery.requestMs),
      elapsedMs: nonnegativeNumber(delivery.elapsedMs), cacheHit: delivery.cacheHit === true})),
    prepare,
    timings: search?.timings,
    syncTimings: search?.syncTimings,
    manifestStatus: Array.isArray(injection?.manifest?.memoryIds) ? "기록됨" : "미기록",
    atomPreservation: Array.isArray(search?.atomPreservation) ? {
      roleTokens: (search.roleTokens ?? {}) as Record<string, number>,
      focusExpected: search.atomPreservation.filter((atom: any) => atom.role === "focus" && atom.bundle).length,
      focusDelivered: search.atomPreservation.filter((atom: any) => atom.role === "focus" && atom.bundle && atom.delivered).length,
      cueAnchorExpected: search.atomPreservation.filter((atom: any) => atom.cueAnchor).length,
      cueAnchorDelivered: search.atomPreservation.filter((atom: any) => atom.cueAnchor && atom.delivered).length,
      cueAnchorMemoryIds: [...new Set(search.atomPreservation.filter((atom: any) => atom.cueAnchor).map((atom: any) => String(atom.memoryId)))],
      injectedRoleTokens: injectedDecisions?.reduce((totals: Record<string, number>, atom: any) => {
        totals[atom.role] = (totals[atom.role] ?? 0) + Number(atom.tokens ?? 0); return totals;
      }, {}),
      focusInjected: injectedDecisions?.filter((atom: any) => atom.role === "focus" && atom.bundle).length,
      cueAnchorInjected: injectedDecisions?.filter((atom: any) => atom.cueAnchor).length,
      forcedDrops: search.atomPreservation.filter((atom: any) => ["hard_ceiling", "memory_removed"].includes(String(atom.outcome))
        && (atom.cueAnchor || (atom.role === "focus" && (atom.bundle || atom.direct)) || (atom.role === "continuity" && atom.bundle))).length,
      decisions: search.atomPreservation,
    } : undefined,
    currentState: search?.currentState,
    candidates, eligible, selected: selectedIds.length, packetTokens, preparedPacketTokens, targetTokens, hardTokenCeiling, toolSummary,
    elapsedMs: elapsedValues.length ? Math.max(...elapsedValues) : undefined,
    status: warnings.length ? "확인 필요" : "정상", warnings, selectedMemories: [...selectedCandidateMap.values()],
    recallPaths: events.filter((event) => event.kind === "automatic_search" || event.kind === "mcp_search").flatMap((event) =>
      retrievalsFor(event).flatMap((retrieval) => (retrieval.candidates ?? []).flatMap((candidate: any) => candidate.recallPath ? [{
        requestId: event.id, kind: event.kind as "automatic_search" | "mcp_search", perspective: String(retrieval.perspective ?? ""),
        candidateId: String(candidate.id), outcome: String(candidate.outcome), observation: candidate.recallPath as RecallPathObservation,
        ...(candidate.atomPath ? { atomPath: candidate.atomPath as AtomPath } : {}),
      }] : []))),
    pathFates: events.filter((event) => event.kind === "automatic_search" || event.kind === "mcp_search").flatMap((event) =>
      retrievalsFor(event).flatMap((retrieval) => (retrieval.candidates ?? []).flatMap((candidate: any) => {
        if (!candidate.atomPath) return [];
        // The candidate owns the endpoint memory; AtomPath intentionally stores
        // atom IDs only. Automatic trim decisions belong only to the automatic
        // search from which they were recorded, never to a later MCP search.
        const endpointId = String(candidate.id);
        const decisions = event.kind === "automatic_search" && event === search && Array.isArray(event.atomPreservation)
          ? event.atomPreservation.filter((atom: any) => String(atom.memoryId) === endpointId) : [];
        return [{ requestId: event.id, kind: event.kind as "automatic_search" | "mcp_search", perspective: String(retrieval.perspective ?? ""),
          candidateId: String(candidate.id), endpointId, retrievalOutcome: String(candidate.outcome),
          ...(decisions.length ? { finalRole: String(decisions[0].role), atomOutcomes: decisions.map((atom: any) => ({ atomKey: String(atom.atomKey), outcome: String(atom.outcome), delivered: injectedAtomKeys?.has(String(atom.atomKey)) })) } : { atomOutcomes: [] }) }];
      }))),
    connections: {
      automaticSearchId: search?.id,
      injectionSearchRequestId: injection?.searchRequestId,
      mcpSearchIds: mcpSearches.flatMap((event) => event.id ? [event.id] : []),
      mcpDeliverySearchRequestIds: deliveries.flatMap((event) => event.searchRequestId ? [event.searchRequestId] : []),
    },
    budget: { packetTokens, preparedPacketTokens, targetTokens, hardTokenCeiling,
      processedThrough: ordinal(search?.budget?.processedThrough), latestProcessed: ordinal(search?.budget?.latestProcessed),
      sectionTokens: search?.budget?.sectionTokens, stateKinds: search?.budget?.stateKinds, stateInventory: search?.budget?.stateInventory, stateSearch: search?.budget?.stateSearch, sceneDelivery: search?.budget?.sceneDelivery,
      refillAdded: nonnegativeNumber(search?.budget?.refillAdded), unusedTokens: nonnegativeNumber(search?.budget?.unusedTokens),
      unusedReason: typeof search?.budget?.unusedReason === "string" ? search.budget.unusedReason : undefined,
      overflowTokens: Math.max(0, (packetTokens ?? 0) - targetTokens),
      estimatorHeadroomTokens: Number(search?.budget?.estimatorHeadroomTokens ?? Math.max(0, (preparedPacketTokens ?? 0) - targetTokens)) },
    tools: { opportunities: opportunityCount, exposures: offeredExposures.length, exposureEvents: exposures.length,
      unknownExposure: exposureUnknown.length, acknowledged: acknowledgedExposures.length,
      plannedEmpty: latestExposures.filter((event) => event.outcome === "empty").length, confirmedAbsent,
      calls: deliveries.length, errors: exposureFailures.length + mcpErrors.length, registrations: exposures.filter((event) => event.registration).map((event) => ({ outcome: event.outcome, diagnostics: event.registration })) },
    events,
  };
}

export function analyzeTrace(parsed: TraceParseResult, options: { source: string; enabledChatIds?: Set<string>; latestEnabledChatId?: string; chatId?: string; allChats?: boolean; turns?: number;
  sourceRecoveryJobs?: Array<{ chatId: string; metadata?: import("@rcm/shared").SourceRecoveryMetadata }> }): DiagnosticAnalysis {
  const allowedEvents = options.chatId
    ? parsed.events.filter((event) => event.chatId === options.chatId)
    : options.enabledChatIds ? parsed.events.filter((event) => options.enabledChatIds!.has(String(event.chatId))) : parsed.events;
  const latestEventChat = [...allowedEvents].sort((left, right) => Number(right.at ?? 0) - Number(left.at ?? 0))[0]?.chatId;
  const latestChat = options.latestEnabledChatId && allowedEvents.some((event) => event.chatId === options.latestEnabledChatId)
    ? options.latestEnabledChatId : latestEventChat;
  const selectedEvents = options.chatId || options.allChats ? allowedEvents : allowedEvents.filter((event) => event.chatId === latestChat);
  const turns = groupEvents(selectedEvents).map(analyzeTurn).sort((left, right) => right.at - left.at).slice(0, Math.max(1, options.turns ?? 12));
  const globalWarnings = [
    ...(parsed.invalidLines ? [`손상되거나 필수 필드가 없는 trace ${parsed.invalidLines}줄을 제외했습니다.`] : []),
    ...(parsed.unsupportedLines ? [`지원하지 않는 trace ${parsed.unsupportedLines}줄을 제외했습니다.`] : []),
  ];
  const warnings = [...globalWarnings, ...turns.flatMap((turn) => turn.warnings.map((warning) => `턴 ${turn.userTurn ?? turn.turnKey}: ${warning}`))];
  const selectedChats = [...new Set(turns.map(turn => turn.chatId))];
  const recoveryJobs = options.sourceRecoveryJobs?.filter(job => selectedChats.includes(job.chatId));
  const withAdditions = recoveryJobs?.filter(job => job.metadata?.result?.outcome === "added").length ?? 0;
  const noOp = recoveryJobs?.filter(job => job.metadata?.result?.outcome === "no_excerpt").length ?? 0;
  const failed = recoveryJobs?.filter(job => job.metadata?.result?.outcome === "failed").length ?? 0;
  return {
    qualityReview: {
      status: "manual_review_required",
      criteria: ["관련 사실과 핵심 근거", "관계·약속·인물 목소리의 연속성", "근거 있는 의외성과 다음 장면의 재료", "관점 경계·중복·핵심 근거와의 예산 경쟁"],
      note: "자동 판정은 전달·운영 상태다. 낮은 질문 유사도나 주변 기억 비중만으로 RP 품질 실패를 판정하지 않는다. 실제 전달 본문을 별도 검토한다.",
    },
    schema: "rcm.retrieval-diagnostics-report.v2", generatedAt: new Date().toISOString(), source: options.source,
    status: turns.length === 0 ? "기록 없음" : warnings.length ? "확인 필요" : "정상",
    selectedChats, invalidLines: parsed.invalidLines, unsupportedLines: parsed.unsupportedLines, warnings, turns,
    ...(recoveryJobs ? { sourceRecovery: { jobs: recoveryJobs.length, withAdditions, noOp, failed, unreported: recoveryJobs.length - withAdditions - noOp - failed } } : {}),
  };
}

/** Counts only renderer-owned labels; never grades prose or answer sufficiency. */
function presentationSummary(events: TraceEvent[]): string[] {
  const injection = [...events].reverse().find(event => event.kind === "automatic_injection" && typeof event.packet === "string");
  const lines: string[] = [];
  const search = [...events].reverse().find(event => event.kind === "automatic_search");
  if (search?.budget?.refillRejected) lines.push(`- 보충 예산 탈락: 세부·대사 ${search.budget.refillRejected.atomBudget}개 / 온전한 기억 ${search.budget.refillRejected.sceneBudget}개 (각 보충 시점 기준)`);
  if (injection) {
    const packet = injection.packet as string;
    const states = [...packet.matchAll(/<recorded_state\b[^>]*>([\s\S]*?)<\/recorded_state>/g)]
      .flatMap(match => match[1]!.split("\n").filter(line => line.startsWith("- ")));
    const compactScopes = states.filter(line => /^- .* \[[^\]]+\]: /u.test(line)).length;
    lines.push(`- 실제 출력 표기: 지식 범위 ${(packet.match(/Known by |Authorial record;/g) ?? []).length + compactScopes}회 / Observed ${(packet.match(/Observed[: (]/g) ?? []).length}회 / 동일 상태 줄 중복 ${states.length - new Set(states).size}개`);
  }
  for (const event of events.filter(event => event.kind === "mcp_delivery" && event.outcome !== "rejected" && typeof event.response === "string")) {
    lines.push(`- MCP 실제 반환: 상세 기록 ${(String(event.response).match(/^Record /gm) ?? []).length}개 / 정확 원문 ${(String(event.response).match(/^- Exact source/gm) ?? []).length}개 · 문맥 충분성은 본문 수동 검토`);
  }
  const observed = [...events].reverse().find(event => event.kind === "tool_exposure" && event.transport === "provider_request");
  if (observed) lines.push(`- 실제 도구 설명 일치: ${observed.toolDescriptionMatches ? Object.entries(observed.toolDescriptionMatches as Record<string,boolean>).map(([name,match])=>`${name}=${match ? "현재 정의 일치" : "다름 또는 누락"}`).join(", ") || "관찰된 기억 도구 없음" : "확인 불가"}`);
  return lines;
}

function candidateTable(turn: TurnAnalysis): string {
  const search = turn.events.find((event) => event.kind === "automatic_search" && event.id === turn.connections.automaticSearchId);
  const candidates = retrievalsFor(search).flatMap((retrieval) => retrieval.candidates ?? []).slice(0, 20);
  if (!candidates.length) return "후보 상세가 없습니다.";
  return [
    "|결과|기억|역할|score|직접 근거|semantic|인지 보너스|lane|관찰 경로|",
    "|---|---|---|---:|---:|---:|---:|---|---|",
    ...candidates.map((item) => `|${escapeCell(item.outcome)}|${escapeCell(item.title ?? item.id)}|${escapeCell(item.selectionRole ?? item.candidateClass ?? "-")}|${Number(item.score ?? 0).toFixed(3)}|${Number(item.baseDirect ?? item.directSignal ?? 0).toFixed(3)}|${Number(item.semanticScore ?? 0).toFixed(3)}|${Number(item.cognitiveBonus ?? 0).toFixed(3)}|${escapeCell((item.lanes ?? []).join(", "))}|${escapeCell(recallPathSummary(item.recallPath, item.atomPath), 512)}|`),
  ].join("\n");
}

function recallPathSummary(observation: RecallPathObservation | undefined, atomPath?: AtomPath): string {
  if (atomPath) return `atom: ${atomPath.atomIds.join(" → ")} · ${atomPath.relations.length}홉 · support=${atomPath.support.toFixed(3)} · ${atomPath.relations.map(relation => relation.kind).join(", ")}`;
  if (!observation) return "기록 없음";
  const paths = (["direct", "graph", "event"] as const).flatMap((kind) => {
    const path = observation[kind];
    const root = path?.anchor.rootEvidence;
    const support = root?.status === "observed_atom" ? ` · query[${[...new Set(root.signals.map((signal) => signal.viewIndex))].join(",")}]`
      : root ? ` · ${root.status}` : "";
    return path ? [`${kind}: ${path.anchor.kind} · ${path.hops.length}홉 → ${path.targetMemoryId}${support}`] : [];
  });
  if (observation.unobserved.length) paths.push(`미관찰: ${observation.unobserved.join(", ")}`);
  return paths.join("; ");
}

function fullBlocks(turn: TurnAnalysis): string {
  const blocks: string[] = [];
  for (const event of turn.events) for (const [label, value] of [["질문", event.query], ["최종 패킷", event.packet], ["MCP 응답", event.response]] as const) {
    if (typeof value === "string" && value) blocks.push(`<details><summary>${label} 전체 내용</summary>\n\n\`\`\`text\n${value}\n\`\`\`\n</details>`);
  }
  return blocks.join("\n\n");
}

function assemblySummary(budget: TurnAnalysis["budget"]): string[] {
  const position = (value: number | null | undefined) => value === undefined ? "미기록" : value === null ? "없음" : String(value);
  const amount = (value: number | undefined, unit: string) => value === undefined ? "미기록" : `${value}${unit}`;
  const gap = budget.latestProcessed !== undefined && budget.latestProcessed !== null && budget.processedThrough !== undefined
    && (budget.processedThrough === null || budget.latestProcessed > budget.processedThrough);
  const reason = budget.unusedReason === "eligible_scene_or_whole_atom_limit"
    ? "적격 장면 또는 온전한 근거 단위의 수용 한계 (세부 원인은 구분되지 않음)"
    : budget.unusedReason ? escapeCell(budget.unusedReason) : budget.unusedTokens === 0 ? "해당 없음" : "미기록";
  return [
    ...(budget.sectionTokens ? [`- 구역별 추정 토큰: ${Object.entries(budget.sectionTokens).map(([key,value])=>`${key}=${value}`).join(", ")}`] : []),
    ...(budget.stateInventory ? [`- 유효한 상태 검색 원본(과거·권한 제한 포함): ${Object.entries(budget.stateInventory).map(([key,value])=>`${key}=${value}`).join(", ")}`] : []),
    ...(budget.stateSearch ? [`- 상태 의미 색인: ${budget.stateSearch.indexed}/${budget.stateSearch.canonical}, ${budget.stateSearch.available ? "사용 가능" : "장애"}, 길이 제한 제외 ${budget.stateSearch.oversized}`] : []),
    ...(budget.stateKinds ? [`- 전달된 상태 종류: ${Object.entries(budget.stateKinds).map(([key,value])=>`${key}=${value}`).join(", ")}`] : []),
    ...(budget.sceneDelivery ? [`- 장면별 detail/대사: ${budget.sceneDelivery.map(item=>`${item.ref ?? item.memoryId}: ${item.details}/${item.dialogues}`).join(", ")}`] : []),
    `- 처리 완료 원문 위치(서버 ordinal, 0부터): 연속 완료 ${position(budget.processedThrough)} / 개별 완료 마지막 ${position(budget.latestProcessed)}${gap ? " · 중간 미처리 구간 있음" : ""}`,
    `- 서버 조립: 온전한 근거·묶음 ${amount(budget.refillAdded, "개")} 보충 / 준비 후 미사용 예산 ${amount(budget.unusedTokens, "토큰")} / 사유: ${reason}`,
  ];
}

function currentStateBlock(state: import("./state-outcomes.js").StateOutcomeReport | undefined, detail: boolean): string[] {
  if (!state) return ["", "**현재 항목**", "", "- 미기록", ""];
  const counts = new Map<string, number>();
  for (const [outcome, count] of Object.entries(state.nonCandidateCounts ?? {})) counts.set(outcome, count);
  for (const entry of state.entries) counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);
  const lines = ["", "**현재 항목**", "", "- 서버 준비 패킷 기준 · 상태/관점별 판정 (실제 주입은 같은 request ID로 별도 확인)",
    `- 결과: ${[...counts].map(([outcome, count]) => `${outcome}=${count}`).join(", ") || "후보 없음"}`,
    `- 기록 상한으로 생략: ${state.omittedCount}개${state.omittedCount ? " (위 집계는 기록된 항목만 포함)" : ""}`,
    ...state.budgets.map(budget => budget.perspective === "shared"
      ? `- state budget (shared): ${budget.budgetTokens}토큰 / 사용 ${budget.usedTokens}토큰 (동일 행 1회 계산)`
      : `- ${escapeCell(budget.perspective)} 상태 예산: ${budget.budgetTokens}토큰 / 사용 ${budget.usedTokens}토큰 (병합 전 상태 줄)`), ""];
  if (detail) for (const outcome of counts.keys()) {
    if (outcome === "delivered" || !state.entries.some(entry => entry.outcome === outcome)) continue;
    lines.push(`**${escapeCell(outcome)}**`, "");
    for (const entry of state.entries.filter(entry => entry.outcome === outcome)) lines.push(
      `- ${escapeCell(entry.id)} · ${escapeCell(entry.kind)} · 관점 ${escapeCell(entry.perspectives.join(", "))}${entry.rank === undefined ? "" : ` · 순위 ${entry.rank}`}${entry.rendered ? ` · 표시 ${escapeCell(entry.rendered)}` : ""}${entry.reason ? ` · ${escapeCell(entry.reason)}` : ""}${typeof entry.title === "string" ? ` · ${escapeCell(entry.title)}` : ""}${entry.keptPeripheralMemoryIds ? ` · 함께 남은 주변 기억: ${entry.keptPeripheralMemoryIds.length ? entry.keptPeripheralMemoryIds.map(id => escapeCell(id)).join(", ") : "없음"}` : ""}`);
    lines.push("");
  }
  return lines;
}

export function renderMarkdown(analysis: DiagnosticAnalysis, detail = false): string {
  const lines = [
    "# 진단 보고서", "",
    `- 전달·운영 판정: **${analysis.status}**`,
    `- RP 품질: 수동 검토 필요 — ${analysis.qualityReview.note}`,
    `- RP 검토 기준: ${analysis.qualityReview.criteria.join(" / ")}`,
    `- 생성: ${analysis.generatedAt}`,
    `- 대상 채팅: ${analysis.selectedChats.length ? analysis.selectedChats.map((id) => `\`${id}\``).join(", ") : "없음"}`,
    `- 분석 범위: 최근 ${analysis.turns.length}턴`,
    analysis.sourceRecovery ? `- 원문 발췌 보완(선택 채팅의 보존된 전체 작업): 작업 ${analysis.sourceRecovery.jobs}개 / 발췌 추가 ${analysis.sourceRecovery.withAdditions}개 / 추가 없음 ${analysis.sourceRecovery.noOp}개 / 실패 ${analysis.sourceRecovery.failed}개 / 결과 미기록 ${analysis.sourceRecovery.unreported}개` : "- 원문 발췌 보완: 작업 메타데이터 미기록",
    "- 지연 관찰: 완료된 클라이언트 요청은 5초 이내 / 5~10초 지연 관찰 / 10초 초과 경고로 구분합니다. 실패·중단은 별도이며, 개별 관측으로 p50·p95 목표 달성을 판정하지 않습니다.", "",
  ];
  if (!analysis.turns.length) return [...lines, "분석할 진단 기록이 없습니다.", ""].join("\n");
  const healthyTurns = analysis.turns.filter((turn) => turn.status === "정상").length;
  const linkedTurns = analysis.turns.filter((turn) => turn.searchInjection === "정상").length;
  lines.push("## 정상 항목", "",
    `- 분석한 ${analysis.turns.length}턴 중 ${healthyTurns}턴에서 자동 경고가 없었습니다.`,
    `- 검색과 주입이 연결되고 준비가 정상 완료된 턴은 ${linkedTurns}턴입니다.`, "",
    "## 확인이 필요한 항목", "",
    ...(analysis.warnings.length ? analysis.warnings.map((warning) => `- ${warning}`) : ["- 없습니다."]), "");
  lines.push("## 최근 턴", "", "|턴|검색→주입|후보·선택|실제 주입 토큰|기억 도구|클라이언트 최장 요청|판정|", "|---|---|---:|---:|---|---:|---|",
    ...analysis.turns.map((turn) => `|${escapeCell(turn.userTurn ?? turn.turnKey)}|${turn.searchInjection}|${turn.candidates}/${turn.selected}|${turn.packetTokens?.toLocaleString() ?? "기록 없음"}${turn.targetTokens ? ` / ${turn.targetTokens.toLocaleString()}` : ""}|${escapeCell(turn.toolSummary)}|${turn.elapsedMs === undefined ? "-" : `${turn.elapsedMs.toLocaleString()}ms`}|${turn.status}|`), "");
  for (const turn of analysis.turns) {
    const blocks = detail ? fullBlocks(turn) : "";
    const matchedSearch = matchingSearch(turn.events, [...turn.events].reverse().find((event) => event.kind === "automatic_injection"));
    const story = matchedSearch?.story;
    lines.push(`<details><summary>턴 ${escapeCell(turn.userTurn ?? turn.turnKey)} 상세 · ${turn.status}</summary>`, "",
      turn.queryExcerpt ? `**질문 발췌:** ${escapeCell(turn.queryExcerpt)}` : "**질문 발췌:** 없음", "",
      `- 이벤트: ${turn.eventKinds.join(", ")}`,
      `- 후보 ${turn.candidates}, eligible ${turn.eligible}, 선택 ${turn.selected}`,
      ...(matchedSearch?.selection?.seedCounts ? [`- Seed 상태: open=${matchedSearch.selection.seedCounts.open}, fulfilled=${matchedSearch.selection.seedCounts.fulfilled}, abandoned=${matchedSearch.selection.seedCounts.abandoned}`] : []),
      ...(matchedSearch?.selection?.roleCounts ? [`- 역할별 서버 준비 기억 수: ${Object.entries(matchedSearch.selection.roleCounts).map(([role,count]) => `${role}=${count}`).join(", ")}`] : []),
      ...(Array.isArray(matchedSearch?.selection?.memories) ? matchedSearch.selection.memories.map((item: any) =>
        `- ${escapeCell(item.memoryId)} · ${escapeCell(item.role)} · ${escapeCell(item.reason?.kind ?? "미기록")}${typeof item.reason?.score === "number" ? ` (raw=${item.reason.score.toFixed(3)}${typeof item.reason.adjustedScore === "number" ? `, adjusted=${item.reason.adjustedScore.toFixed(3)}` : ""})` : ""}${item.reason?.kind === "open_seed" ? ` (type=${escapeCell(item.reason.seedType)}; detail=${escapeCell(item.reason.detailId)})` : ""}${item.reason?.kind === "not_recalled_for" ? ` (같은 인물: ${escapeCell((item.reason.participants ?? []).join(", "))}; ${item.reason.turns === null ? "전달 이력 없음" : `${item.reason.turns}개 완결 턴 동안 미전달`})` : ""}`) : []),
      ...(story ? [`- 줄거리: 후보 ${story.eligibleNodeCount ?? "미기록"}개 / 선택 ${idList(story.selectedNodeIds).length}개${(story.nodes ?? []).filter((node: Record<string, any>) => node.trimmedBeatCount !== undefined).map((node: Record<string, any>) => ` / ${escapeCell(node.id)} 예산으로 생략한 beat ${node.trimmedBeatCount}개 (trimmedBeatCount)`).join("")}`] : []),
      `- 서버 준비 ${turn.preparedPacketTokens === undefined ? "기록 없음" : `${turn.preparedPacketTokens}토큰`} / 실제 주입 ${turn.packetTokens === undefined ? "기록 없음" : `${turn.packetTokens}토큰`}`,
      `- 준비 결과: ${turn.prepare.outcome ?? "미기록"} / 요청 제한: ${turn.prepare.timeoutMs === undefined ? "미기록" : `${turn.prepare.timeoutMs}ms`} / fallback: ${turn.prepare.fallbackTokens === undefined ? "미기록" : `${turn.prepare.fallbackTokens}토큰`}`,
      `- 클라이언트 준비 시간: ${turn.prepare.elapsedMs === undefined ? "미기록" : `${turn.prepare.elapsedMs.toFixed(2)}ms`} / ${latencyLabels[turn.prepare.latency]}`,
      `- 클라이언트 단계별 시간(ms): ${["setupMs", "serializeMs", "requestMs", "bodyMs", "parseMs", "schemaMs"].map((key) => `${key}=${typeof turn.prepare.clientTimings?.[key] === "number" ? turn.prepare.clientTimings[key]!.toFixed(2) : "미기록"}`).join(", ")}`,
      `- 클라이언트 단계: ${clientStageSummary([...turn.events].reverse().find((event) => event.kind === "automatic_injection"))}`,
      `- 실제 주입 manifest: ${turn.manifestStatus}`,
      ...(turn.atomPreservation ? [
        `- 서버 focus 핵심 근거: ${turn.atomPreservation.focusDelivered}/${turn.atomPreservation.focusExpected}개 보존 / 보호 근거 강제 축소: ${turn.atomPreservation.forcedDrops}개`,
        `- 사용자 cue 보정: ${turn.atomPreservation.cueAnchorDelivered}/${turn.atomPreservation.cueAnchorExpected}개 서버 보존 / 실제 주입 ${turn.atomPreservation.cueAnchorInjected ?? "미기록"}개${turn.atomPreservation.cueAnchorMemoryIds.length ? ` / 기억 ${turn.atomPreservation.cueAnchorMemoryIds.join(", ")}` : ""}`,
        `- 역할별 서버 준비 본문 토큰(공유 XML·상태 제외): ${Object.entries(turn.atomPreservation.roleTokens).map(([role, tokens]) => `${role}=${tokens}`).join(", ")}`,
        `- 실제 주입 focus 핵심 근거: ${turn.atomPreservation.focusInjected ?? "미기록"} / 역할별 실제 주입 본문 토큰: ${turn.atomPreservation.injectedRoleTokens === undefined ? "미기록" : Object.entries(turn.atomPreservation.injectedRoleTokens).map(([role, tokens]) => `${role}=${tokens}`).join(", ") || "0"}`,
      ] : []),
      `- 서버 단계별 시간(ms): ${["syncMs", "embeddingMs", "retrievalMs", "assemblyMs", "finalizeMs", "totalMs"].map((key) => `${key}=${typeof turn.timings?.[key] === "number" ? turn.timings[key]!.toFixed(2) : "미기록"}`).join(", ")}`,
      `- sync 세부 단계(ms): ${["requestBodyReadMs", "requestParseMs", "lineageMs", "snapshotMs", "calibrationMs", "inheritedEnqueueMs", "episodeMembershipMs", "ingestionMs", "extractionEnqueueMs", "projectionQueueMs", "workerWakeMs", "maintenanceMs"].map((key) => `${key}=${typeof turn.syncTimings?.[key] === "number" ? turn.syncTimings[key]!.toFixed(2) : "미기록"}`).join(", ")}`,
      `- 기본 예산 ${turn.targetTokens || "-"} / 허용 최대 ${turn.hardTokenCeiling || "-"}토큰`,
      ...assemblySummary(turn.budget),
      ...presentationSummary(turn.events),
      ...(turn.budget.overflowTokens > 0 && (turn.packetTokens ?? 0) <= turn.hardTokenCeiling ? [`- 실제 주입은 내부 추정기로 설정 예산보다 ${turn.budget.overflowTokens}토큰 높으며, 15% 토크나이저 보정 범위 안입니다.`] : []),
      `- 기억 도구: ${turn.toolSummary}`,
      ...turn.mcpTimings.map(timing => `- ${escapeCell(timing.toolName ?? "MCP")} (${escapeCell(timing.requestId ?? "검색 ID 미기록")}): ${timing.origin === "server" ? "서버 거절 관측 (클라이언트 반환 미기록)" : "반환 결과"} ${escapeCell(timing.outcome ?? "미기록")}${timing.reason ? ` · 사유 ${escapeCell(timing.reason)}` : ""}${timing.ref ? ` · ref ${escapeCell(timing.ref)}` : ""} / ${latencyLabels[timing.latency]}`),
      ...turn.mcpTimings.map(({selector:s,server,cacheHit}) => `- MCP 보조모델: ${cacheHit ? "동일 요청 캐시 · 추가 호출 없음" : s ? `${escapeCell(s.provider)} / ${escapeCell(s.model)} · ${s.calls}회 · ${s.elapsedMs.toFixed(2)}ms · ${s.outcome}${s.failure?` (${escapeCell(s.failure)})`:""} · 후보 ${s.candidates}개 → 사용 근거 ${s.selectedIds.length}개 · 자연어 ${s.answerChars??"미보고"}자 · provider 입력 ${s.promptTokens??"미보고"} / 출력 ${s.completionTokens??"미보고"}토큰` : server?.selectorCalls===0 ? "호출 없음" : "미기록"}`),
      ...turn.mcpTimings.map(timing => `- MCP ${timing.requestId ?? "검색 ID 미기록"}: ${timing.cacheHit ? "동일 요청 캐시" : `서버 ${timing.server?.serverMs?.toFixed(2) ?? "미기록"}ms (임베딩 ${timing.server?.embeddingMs?.toFixed(2) ?? "미기록"}, 검색 ${timing.server?.retrievalMs?.toFixed(2) ?? "미기록"}, 로컬 후보 압축 ${timing.server?.rerankMs?.toFixed(2) ?? "미기록"}, 로컬 원문 발췌 ${timing.server?.spanRerankMs?.toFixed(2) ?? "미기록"}, 근거·예산 정리 ${timing.server?.finalizationMs?.toFixed(2) ?? "미기록"}), Voyage rerank ${timing.server?.rerankTotalTokens?.toLocaleString() ?? "미보고"}토큰 (${timing.server?.rerankUsageCalls?.toLocaleString() ?? "0"}회 + 원문 ${timing.server?.spanRerankUsageCalls?.toLocaleString() ?? "0"}회), 클라이언트 요청 왕복 ${timing.requestMs?.toFixed(2) ?? "미기록"}ms`}; 도구 반환까지 ${timing.elapsedMs?.toFixed(2) ?? "미기록"}ms. 반환 이후 provider 대기는 관측하지 않음; Gateway 원인은 해당 로그로만 판단.`),
      ...(turn.pathFates.length ? [`- typed path 운명: ${turn.pathFates.map((path) => `${path.perspective || "관점 미기록"}/${path.endpointId} ${path.retrievalOutcome}${path.finalRole ? ` → ${path.finalRole}` : ""}${path.atomOutcomes.length ? ` [${path.atomOutcomes.map((atom) => `${atom.atomKey}:${atom.outcome}${atom.delivered === undefined ? "" : atom.delivered ? ":전달" : ":미전달"}`).join(", ")}]` : " [최종 atom 미기록]"}`).join(" · ")}`] : []),
      ...turn.tools.registrations.map((entry) => {
        const info = entry.diagnostics as Record<string, unknown>;
        return `- 도구 등록: ${entry.outcome} / requestId=${info.requestId ?? "미기록"} / 전송 완료=${info.postMs ?? "미기록"}ms / 확인 대기=${info.ackWaitMs ?? "미기록"}ms`;
      }),
      ...(turn.warnings.length ? turn.warnings.map((warning) => `- 확인: ${warning}`) : ["- 확인 결과: 특이사항 없음"]), "",
      ...currentStateBlock(turn.currentState, detail),
      candidateTable(turn), "", ...(blocks ? [blocks, ""] : []), "</details>", "");
  }
  return lines.join("\n");
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function enabledChats(dbPath: string): { ids: Set<string>; latestChatId?: string; sourceRecoveryJobs: Array<{ chatId: string; metadata?: import("@rcm/shared").SourceRecoveryMetadata }> } | undefined {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(`SELECT s.key FROM server_meta s JOIN chats c ON s.key=? || c.id
        WHERE s.key LIKE ? AND s.value='1' ORDER BY c.updated_at DESC`).all(RETRIEVAL_TRACE_CHAT_PREFIX, `${RETRIEVAL_TRACE_CHAT_PREFIX}%`) as Array<{ key: string }>;
      const chatIds = rows.map((row) => row.key.slice(RETRIEVAL_TRACE_CHAT_PREFIX.length));
      const sourceRecoveryJobs = (db.prepare(`SELECT chat_id AS chatId,json_extract(payload_json,'$.sourceRecoveryMetadata') metadata
        FROM jobs WHERE json_extract(payload_json,'$.sourceRecovery')=1`).all() as Array<{ chatId: string; metadata: string | null }>)
        .map(row => ({ chatId: row.chatId, metadata: row.metadata ? JSON.parse(row.metadata) : undefined }));
      return { ids: new Set(chatIds), latestChatId: chatIds[0], sourceRecoveryJobs };
    } finally { db.close(); }
  } catch { return undefined; }
}

export async function writeDiagnosticReport(outDir: string, analysis: DiagnosticAnalysis, detail = false): Promise<{ markdownPath: string; jsonPath: string }> {
  await mkdir(outDir, { recursive: true });
  const markdownPath = resolve(outDir, "latest-summary.md");
  const jsonPath = resolve(outDir, "latest-analysis.json");
  await Promise.all([
    writeFile(markdownPath, renderMarkdown(analysis, detail), "utf8"),
    writeFile(jsonPath, `${JSON.stringify({ ...analysis, turns: analysis.turns.map(({ events: _events, ...turn }) => turn) }, null, 2)}\n`, "utf8"),
  ]);
  return { markdownPath, jsonPath };
}

export async function runReportCli(): Promise<DiagnosticAnalysis> {
  const root = process.env.INIT_CWD ?? process.cwd();
  const tracePath = resolve(root, option("--trace") ?? "./data/local-staging/diagnostics/retrieval-trace.jsonl");
  const dbPath = resolve(root, option("--db") ?? "./data/local-staging/risu-cognitive-memory.db");
  const outDir = resolve(root, option("--out-dir") ?? "./data/local-staging/diagnostics");
  const content = await readFile(tracePath, "utf8").catch(() => "");
  const enabled = enabledChats(dbPath);
  const analysis = analyzeTrace(parseTrace(content), {
    source: tracePath, enabledChatIds: enabled?.ids, latestEnabledChatId: enabled?.latestChatId,
    sourceRecoveryJobs: enabled?.sourceRecoveryJobs,
    chatId: option("--chat"), allChats: process.argv.includes("--all-chats"),
    turns: Math.max(1, Math.min(200, Number(option("--turns") ?? 12) || 12)),
  });
  const { markdownPath, jsonPath } = await writeDiagnosticReport(outDir, analysis, process.argv.includes("--detail"));
  process.stdout.write(`${markdownPath}\n${jsonPath}\n`);
  return analysis;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runReportCli();
