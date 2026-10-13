import { defaultAuxiliaryModelConfig, SERVER_LLM_DEFAULT_ENDPOINTS, type ServerLlmProvider } from "@rcm/shared";

interface ProviderCapability {
  serviceTier: boolean; temperature: boolean; thinking: boolean;
  credentialLabel: string; credentialPlaceholder: string; defaultModel: string;
}
const apiKey = { credentialLabel: "API 키", credentialPlaceholder: "API 키" };
export const PROVIDER_CAPABILITIES: Record<ServerLlmProvider, ProviderCapability> = {
  llm_gateway: { ...apiKey, serviceTier: true, temperature: true, thinking: true, defaultModel: defaultAuxiliaryModelConfig.model },
  openai_compatible: { ...apiKey, serviceTier: true, temperature: true, thinking: true, defaultModel: "" },
  vertex: { credentialLabel: "서비스 계정 JSON", credentialPlaceholder: "서비스 계정 JSON", serviceTier: true, temperature: true, thinking: true, defaultModel: "gemini-3.8-flash" },
  gemini_api: { ...apiKey, serviceTier: false, temperature: true, thinking: true, defaultModel: "gemini-3.8-flash" },
  vercel: { ...apiKey, serviceTier: false, temperature: true, thinking: true, defaultModel: "google/gemini-3.8-flash" },
  ollama_cloud: { ...apiKey, serviceTier: false, temperature: true, thinking: true, defaultModel: "glm-5.3" },
  copilot: { credentialLabel: "GitHub 토큰", credentialPlaceholder: "Copilot 권한이 있는 GitHub 토큰", serviceTier: false, temperature: false, thinking: false, defaultModel: "gemini-3.8-flash" },
};
export function providerCapability(provider: string): ProviderCapability {
  return PROVIDER_CAPABILITIES[provider as ServerLlmProvider] ?? PROVIDER_CAPABILITIES.llm_gateway;
}
export function providerModelOnChange(value: string, previous: string, next: string): string {
  return !value.trim() || value === providerCapability(previous).defaultModel ? providerCapability(next).defaultModel : value;
}
/** One policy for extraction and MCP; hidden controls retain their saved values. */
export function updateProviderFields(root: HTMLElement, prefix: "serverLlm" | "mcp"): void {
  const select = root.querySelector<HTMLSelectElement>(`[name="${prefix}Provider"]`);
  if (!select) return;
  const result = root.querySelector<HTMLElement>(`[data-connection-check="${prefix === "mcp" ? "mcp" : "server"}"] [data-connection-result]`);
  if (result) { result.replaceChildren(); result.classList.remove("is-error"); }
  const capability = providerCapability(select.value);
  const model = root.querySelector<HTMLInputElement>(`[name="${prefix}Model"]`);
  if (model) {
    model.value = providerModelOnChange(model.value, select.dataset.previousProvider ?? select.value, select.value);
    model.placeholder = capability.defaultModel || "사용할 모델 ID";
  }
  select.dataset.previousProvider = select.value;
  const endpoint = root.querySelector<HTMLInputElement>(`[name="${prefix}Endpoint"]`);
  if (endpoint) endpoint.value = SERVER_LLM_DEFAULT_ENDPOINTS[select.value as ServerLlmProvider];
  for (const [suffix, supported] of [["ServiceTier", capability.serviceTier], ["Temperature", capability.temperature], ["Thinking", capability.thinking]] as const) {
    const field = root.querySelector(`[name="${prefix}${suffix}"]`)?.closest<HTMLElement>(".field");
    if (field) field.hidden = !supported;
  }
  const key = root.querySelector<HTMLInputElement>(`[name="${prefix}ApiKey"]`);
  if (key) {
    key.placeholder = capability.credentialPlaceholder;
    key.setAttribute("aria-label", capability.credentialLabel);
    const label = key.closest(".field")?.querySelector("span");
    if (label) label.textContent = capability.credentialLabel;
    const toggle = key.parentElement?.querySelector<HTMLButtonElement>('[data-action="toggle-secret"]');
    if (toggle) {
      toggle.dataset.secretLabel = capability.credentialLabel;
      toggle.setAttribute("aria-label", capability.credentialLabel + " 표시");
      toggle.title = capability.credentialLabel + " 표시";
    }
  }
}
