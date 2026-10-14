import { initialTranslationConnection, SERVER_LLM_DEFAULT_MODELS, TranslationConnectionConfigSchema,
  TranslationLegacySettingsSchema, TRANSLATION_TIMEOUT_MS, type TranslationConnectionConfig,
  type TranslationConnectionPublicConfig } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { ConnectionCredentials } from "./connection-credentials.js";
import { ServerLlmStore, validateEndpoint, normalizeDirectGeminiThinking, testProviderConnection } from "./server-llm.js";

type Config = Omit<TranslationConnectionConfig,"apiKey">;
export class TranslationConnection {
  private credentials:ConnectionCredentials;
  constructor(private db:RcmDatabase, secretsPath:string, private llm:ServerLlmStore) {
    this.credentials=new ConnectionCredentials(secretsPath,"TRANSLATION",llm);
  }
  private get stored():Config|undefined {
    const row=this.db.prepare("SELECT value FROM server_meta WHERE key='translation_connection_config'").get() as {value:string}|undefined;
    return row?TranslationConnectionConfigSchema.omit({apiKey:true}).parse(JSON.parse(row.value)):undefined;
  }
  private publish(config:Config):TranslationConnectionPublicConfig {
    return {...config,keyConfigured:Boolean(this.credentials.resolve(config)),dedicatedKeyConfigured:Boolean(this.credentials.dedicated(config))};
  }
  get publicConfig():TranslationConnectionPublicConfig|undefined { const config=this.stored; return config?this.publish(config):undefined; }
  private save(config:Config):TranslationConnectionPublicConfig {
    this.db.prepare("INSERT INTO server_meta(key,value) VALUES('translation_connection_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(config));
    return this.publish(config);
  }
  initialize(legacy:unknown):TranslationConnectionPublicConfig {
    return this.publicConfig??this.save(initialTranslationConnection(this.llm.publicConfig,TranslationLegacySettingsSchema.parse(legacy)));
  }
  private effective(config:Config) {
    const extraction=this.llm.config;
    const sharesConnection=config.credentialSource==="shared"&&config.provider===extraction.provider&&config.endpoint===extraction.endpoint;
    const model=config.model||(sharesConnection?extraction.model:SERVER_LLM_DEFAULT_MODELS[config.provider]);
    if(!model)throw new Error("이 프로바이더는 모델 ID를 입력해야 합니다.");
    return {...config,model,thinking:normalizeDirectGeminiThinking(config.provider,model,config.thinking),llmTimeoutMs:TRANSLATION_TIMEOUT_MS};
  }
  private prepare(input:unknown) {
    const {apiKey,...config}=TranslationConnectionConfigSchema.parse(input);
    config.endpoint=validateEndpoint(config.provider,config.endpoint);
    const effective=this.effective(config);
    if(["gemini_api","ollama_cloud","copilot","vercel"].includes(config.provider)&&config.serviceTier!=="standard")throw new Error("This provider supports Standard only");
    if(config.provider==="vertex"&&config.serviceTier!=="standard"&&new URL(config.endpoint).hostname!=="aiplatform.googleapis.com")throw new Error("Vertex Flex/Priority requires the global endpoint");
    const key=this.credentials.input(config,apiKey);
    return {config,effective,key,saveKey:Boolean(apiKey)};
  }
  update(input:unknown):TranslationConnectionPublicConfig {
    const {config,key,saveKey}=this.prepare(input);
    if(saveKey)this.credentials.save(config,key);
    return this.save(config);
  }
  resolve(legacy:unknown={}) {
    const {keyConfigured,dedicatedKeyConfigured,...config}=this.initialize(legacy);
    return {config:this.effective(config),apiKey:this.credentials.resolve(config)};
  }
  async testConnection(input:unknown,signal:AbortSignal):Promise<void> {
    const {effective,key}=this.prepare(input);
    await testProviderConnection(this.llm,effective,key,signal);
  }
  clearDedicatedKey():void { const config=this.stored; if(config)this.credentials.save(config,null); }
}
