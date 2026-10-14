import { readTranslationConnectionSettings } from "./translation-connection-settings.js";
import { connectionFailureReason, type ServerLlmPublicConfig, type ConnectionFailureCode } from "@rcm/shared";
import { providerCapability } from "./provider-settings.js";
import { rememberDiagnosticSecrets } from "./settings.js";
import { ServerClient, ServerRequestError } from "./api-client.js";
import { isServerConfigured } from "./connection.js";
import type { RuntimeState } from "./types.js";
import { readMcpSelectorSettings } from "./mcp-selector-settings.js";
import { responseText } from "./worker.js";

export function readServerModelConnection(form: FormData) {
  const provider = String(form.get("serverLlmProvider")) as ServerLlmPublicConfig["provider"];
  return {
    provider, endpoint: String(form.get("serverLlmEndpoint") ?? "").trim(), model: String(form.get("serverLlmModel") ?? "").trim(),
    temperature: Number(form.get("serverLlmTemperature")), thinking: String(form.get("serverLlmThinking")) as ServerLlmPublicConfig["thinking"],
    serviceTier: (providerCapability(provider).serviceTier ? String(form.get("serverLlmServiceTier") ?? "standard") : "standard") as ServerLlmPublicConfig["serviceTier"],
  };
}

export async function testSettingsConnection(state: RuntimeState, form: FormData, target: string, voyageKey = ""): Promise<number> {
  rememberDiagnosticSecrets([state.settings.serverToken, ...["serverToken", "serverLlmApiKey", "mcpApiKey", "translationServerApiKey"].map(name => String(form.get(name) ?? "")), voyageKey]);
  const started = performance.now();
  if (target === "risu") {
    if (state.risuConnectionTestRunning || state.workerBusy || state.internalModelCall || state.activeModelRequest || state.translationActivity?.pending) {
      throw new Error("진행 중인 응답·기억 처리·번역 또는 연결 확인이 끝난 뒤 다시 시도해 주세요.");
    }
    const selected = String(form.get("auxiliaryMode"));
    if (!["main", "memory", "otherAx", "static"].includes(selected)) throw new Error("Risu 모델 슬롯을 선택해 주세요.");
    const staticModel = String(form.get("staticModel") ?? "").trim();
    if (selected === "static" && !staticModel) throw new Error("고정 모델 ID를 입력해 주세요.");
    state.risuConnectionTestRunning = true;
    state.internalModelCall = true;
    try {
      const response = await risuai.runLLMModel({
        messages: [{ role: "user", content: "Connection check. Reply with OK only. Do not call any tools." }],
        mode: selected === "main" || selected === "static" ? "model" : selected as "memory" | "otherAx",
        ...(selected === "static" ? { staticModel } : {}), allowPlugins: true,
      });
      if (typeof response !== "string" && !["result", "content", "text"].some(key => typeof (response as any)?.[key] === "string")) throw new Error("Empty response");
      if (!responseText(response).trim()) throw new Error("Empty response");
      return performance.now() - started;
    } catch {
      // Host/provider errors can include submitted credentials or response text.
      throw new Error("Risu 모델 응답을 확인하지 못했어요. 선택한 슬롯의 모델·키·출력 설정을 확인해 주세요.");
    } finally {
      state.internalModelCall = false;
      state.risuConnectionTestRunning = false;
    }
  }
  const connection = { ...state.settings, serverUrl: String(form.get("serverUrl") ?? "").trim(), serverToken: String(form.get("serverToken") ?? "").trim() };
  if (!isServerConfigured(connection)) throw Object.assign(new Error("먼저 서버 주소와 토큰을 설정하고 연결을 확인해 주세요."), { code: "SERVER_SETUP_REQUIRED" });
  const client = new ServerClient(() => connection);
  const endpoint = form.get(target === "mcp" ? "mcpEndpoint" : target === "translation" ? "translationServerEndpoint" : "serverLlmEndpoint");
  if (target !== "voyage" && !String(endpoint ?? "").trim()) throw new ServerRequestError(connectionFailureReason("ENDPOINT_MISSING"), 0, "ENDPOINT_MISSING");
  let body;
  try { body = target === "voyage" ? { target, ...(voyageKey.trim() ? { apiKey: voyageKey.trim() } : {}) }
    : target === "translation" ? { target, config: readTranslationConnectionSettings(form) }
    : target === "mcp" ? { target, config: readMcpSelectorSettings(form) }
    : { target: "server", config: { engine: "server", ...readServerModelConnection(form), apiKey: String(form.get("serverLlmApiKey") ?? "").trim() || undefined } };
  } catch { throw new ServerRequestError(connectionFailureReason("INVALID_CONFIG"), 0, "INVALID_CONFIG"); }
  let result: { ok: boolean; elapsedMs: number; code?: ConnectionFailureCode; detail?: string; status?: number };
  try {
    result = await client.request("/v1/admin/connection-test", { method: "POST", body: JSON.stringify(body) }, 65_000);
  } catch (error) {
    if (error instanceof ServerRequestError && error.status === 404) throw new ServerRequestError("서버를 업데이트하면 연결 확인을 사용할 수 있어요.", error.status, error.code);
    if (error instanceof ServerRequestError && [401, 403].includes(error.status)) throw new ServerRequestError("RCM 서버 토큰을 확인해 주세요.", error.status, error.code);
    if (error instanceof ServerRequestError && error.status === 409) throw new ServerRequestError("다른 연결 확인이 끝난 뒤 다시 시도해 주세요.", error.status, error.code);
    throw new ServerRequestError(connectionFailureReason("NETWORK_ERROR"), 0, "NETWORK_ERROR");
  }
  if (!result.ok) throw Object.assign(new ServerRequestError(connectionFailureReason(result.code ?? "INVALID_RESPONSE", result.status), result.status ?? 0, result.code ?? "INVALID_RESPONSE"), { detail: result.detail });
  return result.elapsedMs;
}
