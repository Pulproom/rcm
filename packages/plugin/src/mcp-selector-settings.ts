import { providerCapability, updateProviderFields } from "./provider-settings.js";
import { SERVER_LLM_PROVIDER_OPTIONS } from "@rcm/shared";
import { defaultMcpSelectorConfig, McpSelectorConfigSchema, type McpSelectorPublicConfig } from "@rcm/shared";
import { secretInput, maskSecretInputs, connectionCheck } from "./dashboard/film/ui.js";

const escape=(value:unknown)=>String(value).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
export function mcpSelectorSettings(config?:McpSelectorPublicConfig,configuredProviders:string[]=[]):string {
  const c=config??{...defaultMcpSelectorConfig,keyConfigured:false,dedicatedKeyConfigured:false};
  const capability = providerCapability(c.provider);
  const options=(values:ReadonlyArray<readonly [string,string]>,selected:string)=>values.map(([value,label])=>`<option value="${value}" ${value===selected?"selected":""}>${label}</option>`).join("");
  return `<div class="setting-group" data-mcp-selector data-key-provider="${escape(c.provider)}" data-key-endpoint="${escape(c.endpoint)}" data-key-saved="${c.dedicatedKeyConfigured}"><h3 class="model-section-title">기억 검색 (MCP)</h3>
    <div class="form__row">
    <label class="field field--check"><span><input type="checkbox" name="mcpEnabled" ${c.enabled?"checked":""}> 검색 보조 모델 사용</span><small class="sub">기억 도구가 불릴 때 필요한 기억을 골라 줍니다. Gemini Flash 계열을 권장합니다.</small></label>

      <label class="field"><span>모델 ID</span><input name="mcpModel" placeholder="${capability.defaultModel || "사용할 모델 ID"}" value="${escape(c.model)}"></label>
      <label class="field" ${capability.serviceTier ? "" : "hidden"}><span>처리 등급</span><select name="mcpServiceTier">${options([["standard","Standard"],["flex","Flex"],["priority","Priority"]],c.serviceTier)}</select></label>
    </div>
    <details class="settings-advanced"><summary>연결과 생성 설정</summary><div class="form__row connection-card">
      <label class="field"><span>프로바이더</span><select name="mcpProvider" data-previous-provider="${c.provider}">${options(SERVER_LLM_PROVIDER_OPTIONS,c.provider)}</select></label>
      <label class="field"><span>엔드포인트</span><input name="mcpEndpoint" value="${escape(c.endpoint)}"></label>
      <label class="field"><span>인증정보</span><select name="mcpCredentialSource">${options([["shared","저장된 프로바이더 인증정보 사용"],["dedicated","이 연결 전용 인증정보 사용"]],c.credentialSource)}</select><small class="sub" data-mcp-key-status data-configured-providers="${escape(configuredProviders.join(','))}">${c.credentialSource==="shared"?(c.keyConfigured?"저장된 공용 키를 사용합니다.":"선택한 프로바이더의 저장된 키가 없습니다."):(c.dedicatedKeyConfigured?"이 연결의 전용 키가 저장되어 있습니다.":"이 연결에 사용할 키를 입력해 주세요.")}</small></label>
      <label class="field" data-mcp-dedicated ${c.credentialSource==="dedicated"?"":"hidden"}><span>${capability.credentialLabel}</span>${secretInput("mcpApiKey", capability.credentialLabel, { placeholder: capability.credentialPlaceholder })}</label>
      <label class="field" ${capability.temperature ? "" : "hidden"}><span>Temperature</span><input name="mcpTemperature" type="number" min="0" max="2" step="0.05" value="${c.temperature}"></label>
      <label class="field" ${capability.thinking ? "" : "hidden"}><span>Thinking</span><select name="mcpThinking">${options([["default","Provider default"],["off","Off"],["low","Low"],["medium","Medium"],["high","High"]],c.thinking)}</select></label>
    ${connectionCheck("mcp", `<span class="settings-action__end" data-remove-mcp-row ${c.dedicatedKeyConfigured&&c.credentialSource==="dedicated"?"":"hidden"}><button class="btn btn--danger" type="button" data-action="remove-mcp-key">저장된 키 제거</button></span>`)}</div></details>
    <details class="settings-advanced"><summary>처리량과 재시도</summary><div class="form__row">
      <label class="field"><span>호출당 최대 입력 토큰</span><input name="mcpMaxInputTokens" type="number" min="1024" max="128000" value="${c.maxInputTokens}"></label>
      <label class="field"><span>호출당 최대 출력 토큰</span><input name="mcpMaxOutputTokens" type="number" min="256" max="32000" value="${c.maxOutputTokens}"></label>
      <label class="field"><span>호출 대기 시간 · 초</span><input name="mcpTimeoutSeconds" type="number" min="5" max="300" value="${c.llmTimeoutMs/1000}"></label>
      <label class="field"><span>최대 재시도 횟수</span><input name="mcpRetries" type="number" min="0" max="2" value="${c.retries}"><small class="sub">시간 초과·인증 오류는 재시도하지 않습니다.</small></label>
    </div></details>
  </div>`;
}

export function readMcpSelectorSettings(form:FormData) {
  return McpSelectorConfigSchema.parse({enabled:form.has("mcpEnabled"),provider:form.get("mcpProvider"),endpoint:form.get("mcpEndpoint"),
    model:form.get("mcpModel"),credentialSource:form.get("mcpCredentialSource"),temperature:Number(form.get("mcpTemperature")),
    thinking:form.get("mcpThinking"),serviceTier:providerCapability(String(form.get("mcpProvider"))).serviceTier?form.get("mcpServiceTier"):"standard",maxInputTokens:Number(form.get("mcpMaxInputTokens")),
    maxOutputTokens:Number(form.get("mcpMaxOutputTokens")),llmTimeoutMs:Number(form.get("mcpTimeoutSeconds"))*1000,retries:Number(form.get("mcpRetries")),
    ...(form.get("mcpCredentialSource")==="dedicated"&&String(form.get("mcpApiKey")??"").trim()?{apiKey:String(form.get("mcpApiKey")).trim()}:{}),
  });
}

export function updateMcpSelectorControls(root:HTMLElement,changed:string):void {
  maskSecretInputs(root);
  const provider=root.querySelector<HTMLSelectElement>('[name="mcpProvider"]')?.value;
  const mode=root.querySelector<HTMLSelectElement>('[name="mcpCredentialSource"]')?.value;
  const status=root.querySelector<HTMLElement>('[data-mcp-key-status]');
  const key=root.querySelector<HTMLInputElement>('[name="mcpApiKey"]');
  const dedicated=root.querySelector<HTMLElement>('[data-mcp-dedicated]');
  const remove=root.querySelector<HTMLElement>('[data-remove-mcp-row]');
  if(dedicated)dedicated.hidden=mode!=="dedicated";
  if(changed==="mcpProvider") updateProviderFields(root,"mcp");
  if(changed==="mcpProvider"||changed==="mcpEndpoint"){if(key)key.value="";if(remove)remove.hidden=true;}
  if(status)status.textContent=mode==="shared"?(status.dataset.configuredProviders?.split(',').includes(provider??"")?"저장된 공용 키를 사용합니다.":"선택한 프로바이더의 저장된 키가 없습니다."):"선택한 연결의 전용 키를 사용합니다. 새 연결이면 키를 입력해 주세요.";
  const group=root.querySelector<HTMLElement>('[data-mcp-selector]');
  if(remove)remove.hidden=!(mode==="dedicated"&&group?.dataset.keySaved==="true"&&group.dataset.keyProvider===provider&&group.dataset.keyEndpoint===root.querySelector<HTMLInputElement>('[name="mcpEndpoint"]')?.value);
}
