import type { PluginSettings } from "./types.js";

export type ServerConnectionIssueKind = "unconfigured" | "unauthorized" | "unavailable";

export interface ServerConnectionIssue {
  kind: ServerConnectionIssueKind;
  title: string;
  detail: string;
  technical?: string;
}

export const SERVER_RESPONSE_DELAYED = "서버 응답이 잠시 늦어지고 있습니다. 다시 확인하고 있습니다.";

type MutableConnectionState = {
  activityStatusError?: string;
  serverConnectionIssue?: ServerConnectionIssue;
  serverConnectionFailureCount?: number;
  serverConnectionLastFailureAt?: number;
};

export function isServerConfigured(settings: Pick<PluginSettings, "serverUrl" | "serverToken">): boolean {
  const token = settings.serverToken.trim();
  return Boolean(settings.serverUrl.trim() && token && token !== "change-me");
}

export function describeServerConnectionIssue(
  settings: Pick<PluginSettings, "serverUrl" | "serverToken">,
  error?: unknown,
): ServerConnectionIssue | undefined {
  if (!isServerConfigured(settings)) return {
    kind: "unconfigured",
    title: "기억 서버 연결이 필요합니다",
    detail: "설정에서 서버 주소와 토큰을 저장하면 기억 처리를 시작합니다.",
  };
  if (error === undefined) return undefined;
  const technical = error instanceof Error ? error.message : String(error);
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
  const issue = describeServerConnectionIssue(settings, error);
  if (!issue) {
    noteServerConnectionSuccess(state);
    return undefined;
  }
  if (issue.kind === "unconfigured" || issue.kind === "unauthorized") {
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
