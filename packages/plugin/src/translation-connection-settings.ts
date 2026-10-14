import { initialTranslationConnection, TranslationConnectionConfigSchema, SERVER_LLM_PROVIDER_OPTIONS,
  type ServerLlmPublicConfig, type TranslationConnectionPublicConfig } from "@rcm/shared";
import type { PluginSettings } from "./types.js";
import { providerCapability, updateProviderFields } from "./provider-settings.js";
import { secretInput, maskSecretInputs } from "./dashboard/film/ui.js";

const escape=(value:unknown)=>String(value).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
export function translationConnectionSettings(settings:PluginSettings, extraction:ServerLlmPublicConfig, saved?:TranslationConnectionPublicConfig):string {
  const c=saved??{...initialTranslationConnection(extraction,{model:settings.translationServerModel,temperature:settings.translationTemperature,thinking:settings.translationThinking,maxOutput:settings.translationServerMaxOutput}),keyConfigured:extraction.keyConfigured,dedicatedKeyConfigured:false};
  const capability=providerCapability(c.provider);
  const options=(values:ReadonlyArray<readonly [string,string]>,selected:string)=>values.map(([value,label])=>`<option value="${value}" ${value===selected?"selected":""}>${label}</option>`).join("");
  const field=(body:string,extra="",supported=true)=>`<label class="field" data-translation-mode="server" ${extra} ${settings.translationProvider==="server"&&supported?"":"hidden"}>${body}</label>`;
  const shared=c.credentialSource==="shared"&&c.provider===extraction.provider&&c.endpoint===extraction.endpoint;
  return field(`<span>프로바이더</span><select form="settings-form" name="translationServerProvider" data-previous-provider="${c.provider}">${options(SERVER_LLM_PROVIDER_OPTIONS,c.provider)}</select>`)
    +field(`<span>엔드포인트</span><input form="settings-form" name="translationServerEndpoint" value="${escape(c.endpoint)}">`)
    +field(`<span>인증정보</span><select form="settings-form" name="translationServerCredentialSource">${options([["shared","기억 추출 연결 공유"],["dedicated","이 연결 전용 인증정보 사용"]],c.credentialSource)}</select><small class="sub" data-translation-key-status data-configured-providers="${escape((extraction.configuredProviders??[]).join(','))}">${c.keyConfigured?"인증정보가 저장되어 있습니다.":"선택한 연결의 인증정보가 없습니다."}</small>`)
    +field(`<span>${capability.credentialLabel}</span>${secretInput("translationServerApiKey",capability.credentialLabel,{placeholder:capability.credentialPlaceholder,form:"settings-form"})}`,`data-translation-dedicated data-key-provider="${c.provider}" data-key-endpoint="${escape(c.endpoint)}" data-key-saved="${c.dedicatedKeyConfigured}"`,c.credentialSource==="dedicated")
    +field(`<span>모델 ID</span><input form="settings-form" name="translationServerModel" placeholder="${shared?"기억 추출 모델 사용":capability.defaultModel||"사용할 모델 ID"}" value="${escape(c.model)}" data-extraction-provider="${extraction.provider}" data-extraction-endpoint="${escape(extraction.endpoint)}">`)
    +field(`<span>Temperature</span><input form="settings-form" name="translationServerTemperature" type="number" min="0" max="2" step="0.05" value="${c.temperature}">`,'data-translation-capability="temperature"',capability.temperature)
    +field(`<span>Thinking</span><select form="settings-form" name="translationServerThinking">${options([["default","기본값"],["off","Off"],["low","Low"],["medium","Medium"],["high","High"]],c.thinking)}</select>`,'data-translation-capability="thinking"',capability.thinking)
    +field(`<span>처리 등급</span><select form="settings-form" name="translationServerServiceTier">${options([["standard","Standard"],["flex","Flex"],["priority","Priority"]],c.serviceTier)}</select>`,'data-translation-capability="serviceTier"',capability.serviceTier)
    +field(`<span>호출당 최대 출력</span><input form="settings-form" name="translationServerMaxOutput" type="number" min="256" max="128000" step="1" value="${c.maxOutputTokens}">`);
}
export function readTranslationConnectionSettings(form:FormData) {
  const provider=String(form.get("translationServerProvider"));
  return TranslationConnectionConfigSchema.parse({provider,endpoint:form.get("translationServerEndpoint"),model:form.get("translationServerModel"),
    credentialSource:form.get("translationServerCredentialSource"),temperature:Number(form.get("translationServerTemperature")),thinking:form.get("translationServerThinking"),
    serviceTier:providerCapability(provider).serviceTier?form.get("translationServerServiceTier"):"standard",maxOutputTokens:Number(form.get("translationServerMaxOutput")),
    ...(form.get("translationServerCredentialSource")==="dedicated"&&String(form.get("translationServerApiKey")??"").trim()?{apiKey:String(form.get("translationServerApiKey")).trim()}:{}),
  });
}
export function updateTranslationConnectionControls(root:HTMLElement,changed:string):void {
  maskSecretInputs(root);
  if(changed==="translationServerProvider")updateProviderFields(root,"translationServer");
  const value=(name:string)=>root.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value;
  const mode=value("translationProvider"),provider=value("translationServerProvider")??"",source=value("translationServerCredentialSource"),endpoint=value("translationServerEndpoint");
  const capability=providerCapability(provider);
  root.querySelectorAll<HTMLElement>("[data-translation-mode]").forEach(el=>{
    const feature=el.dataset.translationCapability as "temperature"|"thinking"|"serviceTier"|undefined;
    el.hidden=el.dataset.translationMode!==mode||Boolean(feature&&!capability[feature])||(el.hasAttribute("data-translation-dedicated")&&source!=="dedicated");
  });
  root.querySelectorAll<HTMLElement>("[data-translation-llm]").forEach(el=>{el.hidden=mode==="google";});
  const fixed=root.querySelector<HTMLElement>("[data-translation-static]");if(fixed)fixed.hidden=mode!=="risu"||value("translationSlot")!=="static";
  const key=root.querySelector<HTMLInputElement>('[name="translationServerApiKey"]');
  if(key&&["translationServerProvider","translationServerEndpoint"].includes(changed))key.value="";
  const dedicated=root.querySelector<HTMLElement>('[data-translation-dedicated]');
  const remove=root.querySelector<HTMLElement>('[data-remove-translation-row]');
  if(remove)remove.hidden=!(mode==="server"&&source==="dedicated"&&dedicated?.dataset.keySaved==="true"&&dedicated.dataset.keyProvider===provider&&dedicated.dataset.keyEndpoint===endpoint);
  const status=root.querySelector<HTMLElement>('[data-translation-key-status]');
  if(status)status.textContent=source==="shared"?(status.dataset.configuredProviders?.split(',').includes(provider)?"저장된 프로바이더 인증정보를 사용합니다.":"선택한 프로바이더의 저장된 인증정보가 없습니다."):"이 연결의 전용 인증정보를 사용합니다. 새 연결이면 입력해 주세요.";
  const model=root.querySelector<HTMLInputElement>('[name="translationServerModel"]');
  if(model)model.placeholder=source==="shared"&&provider===model.dataset.extractionProvider&&endpoint===model.dataset.extractionEndpoint?"기억 추출 모델 사용":capability.defaultModel||"사용할 모델 ID";
}
