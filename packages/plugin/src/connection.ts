import { RCM_API_REVISION } from "@rcm/shared";
import type { PluginSettings } from "./types.js";

export type ServerConnectionIssueKind = "unconfigured" | "unauthorized" | "unavailable" | "incompatible";

export interface ServerConnectionIssue {
  kind: ServerConnectionIssueKind;
  title: string;
  detail: string;
  technical?: string;
  requiredUpdate?: "plugin" | "server";
}

/** Health is reachable; the memory protocol still requires an exact revision. */
export class ServerCompatibilityError extends Error {
  readonly code = "API_REVISION_MISMATCH";
  constructor(readonly receivedRevision: number, readonly expectedRevision = RCM_API_REVISION) {
    super(`RCM API revision mismatch: expected ${expectedRevision}, received ${receivedRevision}`);
  }
}

export const SERVER_RESPONSE_DELAYED = "서버 응답이 잠시 늦어지고 있습니다. 다시 확인하고 있습니다.";

type MutableConnectionState = {
  activityStatusError?: string;
  serverConnectionIssue?: ServerConnectionIssue;
  serverConnectionFailureCount?: number;
  serverConnectionLastFailureAt?: number;
};

export function isServerApiIncompatible(state: MutableConnectionState): boolean {
  return state.serverConnectionIssue?.kind === "incompatible";
}

export function isServerConnectionReady(state: MutableConnectionState & { activityReady?: boolean; settings: Pick<PluginSettings, "serverUrl" | "serverToken"> }): boolean {
  return state.activityReady === true && !state.serverConnectionIssue && !state.activityStatusError && isServerConfigured(state.settings);
}

export function isServerConfigured(settings: Pick<PluginSettings, "serverUrl" | "serverToken">): boolean {
  const token = settings.serverToken.trim();
  return Boolean(settings.serverUrl.trim() && token && token !== "change-me");
}

export function describeServerConnectionIssue(
  settings: Pick<PluginSettings, "serverUrl" | "serverToken">,
  error?: unknown,
  previous?: ServerConnectionIssue,
): ServerConnectionIssue | undefined {
  if (!isServerConfigured(settings)) return {
    kind: "unconfigured",
    title: "기억 서버 연결이 필요합니다",
    detail: "설정에서 서버 주소와 토큰을 저장하면 기억 처리를 시작합니다.",
  };
  if (error === undefined) return undefined;
  const technical = error instanceof Error ? error.message : String(error);
  if (error instanceof ServerCompatibilityError || (error as { code?: string } | null)?.code === "API_REVISION_MISMATCH") {
    const received = error instanceof ServerCompatibilityError ? error.receivedRevision
      : Number((error as { expectedApiRevision?: number }).expectedApiRevision);
    const expected = error instanceof ServerCompatibilityError ? error.expectedRevision : RCM_API_REVISION;
    const knownDirection = Number.isInteger(received) && received > 0 && received !== expected;
    if (!knownDirection && previous?.kind === "incompatible" && previous.requiredUpdate) return previous;
    const requiredUpdate = knownDirection ? received < expected ? "server" : "plugin" : undefined;
    const serverOlder = requiredUpdate === "server";
    return {
      kind: "incompatible",
      requiredUpdate,
      title: !requiredUpdate ? "서버·플러그인 업데이트 필요" : serverOlder ? "서버 업데이트 필요" : "플러그인 업데이트 필요",
      detail: !requiredUpdate ? "서버와 플러그인 버전을 확인한 뒤 함께 업데이트해 주세요." : serverOlder ? "서버에는 연결되지만 서버 버전이 맞지 않습니다. 서버를 업데이트하면 다시 연결됩니다."
        : "서버에는 연결되지만 플러그인 버전이 맞지 않습니다. Risu 플러그인 메뉴의 + 버튼으로 플러그인을 업데이트하면 다시 연결됩니다.",
      technical,
    };
  }
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden/i.test(technical)) return {
    kind: "unauthorized",
    title: "서버 연결 정보를 확인해 주세요",
    detail: "서버 토큰이 맞지 않습니다. 설정에서 연결 정보를 확인해 주세요.",
    technical,
  };
  return {
    kind: "unavailable",
    title: "기억 서버에 연결할 수 없습니다",
    detail: "서버 주소와 실행 상태를 확인해 주세요.",
    technical,
  };
}

export function noteServerConnectionSuccess(state: MutableConnectionState): void {
  state.serverConnectionFailureCount = 0;
  state.serverConnectionLastFailureAt = undefined;
  state.serverConnectionIssue = undefined;
  state.activityStatusError = undefined;
}

export function noteServerConnectionFailure(
  state: MutableConnectionState,
  settings: Pick<PluginSettings, "serverUrl" | "serverToken">,
  error?: unknown,
  confirmationThreshold = 2,
  now = Date.now(),
): ServerConnectionIssue | undefined {
  const issue = describeServerConnectionIssue(settings, error, state.serverConnectionIssue);
  if (!issue) {
    noteServerConnectionSuccess(state);
    return undefined;
  }
  if (issue.kind === "unconfigured" || issue.kind === "unauthorized" || issue.kind === "incompatible") {
    state.serverConnectionFailureCount = confirmationThreshold;
    state.serverConnectionLastFailureAt = now;
    state.serverConnectionIssue = issue;
    state.activityStatusError = issue.detail;
    return issue;
  }
  const distinctFailure = state.serverConnectionLastFailureAt === undefined || now - state.serverConnectionLastFailureAt >= 750;
  const failures = (state.serverConnectionFailureCount ?? 0) + (distinctFailure ? 1 : 0);
  state.serverConnectionFailureCount = failures;
  state.serverConnectionLastFailureAt = now;
  if (failures < confirmationThreshold) {
    state.serverConnectionIssue = undefined;
    state.activityStatusError = SERVER_RESPONSE_DELAYED;
    return undefined;
  }
  state.serverConnectionIssue = issue;
  state.activityStatusError = issue.detail;
  return issue;
}
