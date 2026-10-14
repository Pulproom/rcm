import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { ServerLlmProvider } from "@rcm/shared";
import { saveSecret } from "./admin.js";
import { parseVertexServiceAccount, type ServerLlmStore } from "./server-llm.js";

type Connection = { provider:ServerLlmProvider; endpoint:string; credentialSource:"shared"|"dedicated" };
/** Dedicated credentials are scoped to both the consumer and exact connection. */
export class ConnectionCredentials {
  constructor(private path:string, private scope:"MCP"|"TRANSLATION", private llm:ServerLlmStore) {}
  private name(config:Connection):`RCM_${string}` {
    return `RCM_${this.scope}_API_KEY_${createHash("sha256").update(`${config.provider}\0${config.endpoint}`).digest("hex").slice(0,24).toUpperCase()}`;
  }
  dedicated(config:Connection):string {
    if (!existsSync(this.path)) return "";
    const prefix=this.name(config)+"=";
    return readFileSync(this.path,"utf8").split(/\r?\n/).find(line=>line.startsWith(prefix))?.slice(prefix.length).trim()??"";
  }
  resolve(config:Connection):string { return config.credentialSource==="shared"?this.llm.apiKeyFor(config.provider):this.dedicated(config); }
  input(config:Connection,apiKey?:string):string {
    if(apiKey&&config.credentialSource!=="dedicated")throw new Error("Choose dedicated credentials to save a separate key");
    if(apiKey&&config.provider!=="vertex"&&/[\r\n]/.test(apiKey))throw new Error("API key contains line breaks");
    return apiKey?(config.provider==="vertex"?JSON.stringify(parseVertexServiceAccount(apiKey)):apiKey):this.resolve(config);
  }
  save(config:Connection,key:string|null):void { saveSecret(this.path,this.name(config),key); }
}
