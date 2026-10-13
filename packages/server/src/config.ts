import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

declare const __RCM_DISTRIBUTION__: boolean | undefined;

const boundedNumber = (value: string | undefined, fallback: number, minimum: number, maximum: number): number => {
  const parsed = Number(value ?? fallback);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
};

export interface ServerConfig {
  host: string;
  port: number;
  token: string;
  dbPath: string;
  embeddings: "voyage" | "off";
  embeddingModel: string;
  voyageApiKey: string;
  llmApiKeys?: Partial<Record<"gemini_api" | "vertex" | "llm_gateway" | "openai_compatible" | "vercel" | "ollama_cloud" | "copilot", string>>;
  secretsPath: string;
  voyageEndpoint: string;
  embeddingTimeoutMs: number;
  rerankEndpoint?: string;
  rerankModel?: string;
  rerankTimeoutMs?: number;
  llmTimeoutMs: number;
  leaseSeconds: number;
  retrievalTrace: "off" | "metadata" | "full";
  retrievalTracePath: string;
  retrievalTraceMaxEvents: number;
  retrievalTraceMaxAgeDays: number;
  updateManifestUrl?: string;
  updateChannel?: "stable";
  installDir?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dbPath = resolve(env.RCM_DB_PATH || "./data/risu-cognitive-memory.db");
  const secretsPath = resolve(env.RCM_SECRETS_PATH || "./data/secrets.env");
  mkdirSync(dirname(dbPath), { recursive: true });
  mkdirSync(dirname(secretsPath), { recursive: true });
  let savedVoyageKey = "";
  const savedLlmKeys: ServerConfig["llmApiKeys"] = {};
  if (existsSync(secretsPath)) {
    const lines = readFileSync(secretsPath, "utf8").split(/\r?\n/);
    const saved=Object.fromEntries(lines.filter(line=>line.trim()&&!line.trim().startsWith("#")&&line.includes("=")).map(line=>{
      const index=line.indexOf("=");return [line.slice(0,index).trim(),line.slice(index+1).trim()];
    }));
    env={...saved,...Object.fromEntries(Object.entries(env).filter(([,value])=>value!==undefined))};
    const voyageLine = lines.find((entry) => entry.trim().startsWith("VOYAGE_API_KEY="));
    if (voyageLine) savedVoyageKey = voyageLine.slice(voyageLine.indexOf("=") + 1).trim();
  }
  for (const provider of ["gemini_api", "vertex", "llm_gateway", "openai_compatible", "vercel", "ollama_cloud", "copilot"] as const) {
    const value = env[`RCM_LLM_API_KEY_${provider.toUpperCase()}`];
    if (value) savedLlmKeys[provider] = value;
  }

  const host = env.RCM_HOST || "127.0.0.1";
  const token = env.RCM_TOKEN || "change-me";
  if (!["127.0.0.1", "::1", "localhost"].includes(host) && token === "change-me") {
    throw new Error("RCM_TOKEN must be changed before binding the server beyond loopback");
  }
  return {
    host,
    port: Number(env.RCM_PORT || 7331),
    token,
    dbPath,
    embeddings: env.RCM_EMBEDDINGS === "off" ? "off" : "voyage",
    embeddingModel: "voyage-context-4",
    voyageApiKey: env.VOYAGE_API_KEY || savedVoyageKey,
    llmApiKeys: savedLlmKeys,
    secretsPath,
    voyageEndpoint: env.RCM_VOYAGE_ENDPOINT || "https://api.voyageai.com/v1/contextualizedembeddings",
    embeddingTimeoutMs: boundedNumber(env.RCM_EMBEDDING_TIMEOUT_MS, 15_000, 250, 60_000),
    rerankEndpoint: env.RCM_RERANK_ENDPOINT || "https://api.voyageai.com/v1/rerank",
    rerankModel: env.RCM_RERANK_MODEL || "rerank-3",
    rerankTimeoutMs: boundedNumber(env.RCM_RERANK_TIMEOUT_MS, 45_000, 1_000, 90_000),
    llmTimeoutMs: boundedNumber(env.RCM_LLM_TIMEOUT_MS, 300_000, 30_000, 900_000),
    leaseSeconds: Math.max(30, Number(env.RCM_LEASE_SECONDS || 90)),
    retrievalTrace: typeof __RCM_DISTRIBUTION__ !== "undefined" && __RCM_DISTRIBUTION__ ? "off" : env.RCM_RETRIEVAL_TRACE === "full" ? "full" : env.RCM_RETRIEVAL_TRACE === "metadata" ? "metadata" : "off",
    retrievalTracePath: typeof __RCM_DISTRIBUTION__ !== "undefined" && __RCM_DISTRIBUTION__ ? "" : resolve(env.RCM_RETRIEVAL_TRACE_PATH || `${dirname(dbPath)}/diagnostics/retrieval-trace.jsonl`),
    retrievalTraceMaxEvents: Math.max(20, Math.min(5_000, Number(env.RCM_RETRIEVAL_TRACE_MAX_EVENTS || 200))),
    retrievalTraceMaxAgeDays: Math.max(1, Math.min(90, Number(env.RCM_RETRIEVAL_TRACE_MAX_AGE_DAYS || 7))),
    updateManifestUrl: env.RCM_UPDATE_MANIFEST_URL?.trim() || undefined,
    updateChannel: "stable",
    installDir: env.RCM_INSTALL_DIR ? resolve(env.RCM_INSTALL_DIR) : undefined,
  };
}

/** Portable runtime preferences; local installation paths stay with the host. */
export function backupServerSettings(config:ServerConfig):Record<string,string> {
  return {
    RCM_EMBEDDINGS:config.embeddings,
    RCM_VOYAGE_ENDPOINT:config.voyageEndpoint,RCM_EMBEDDING_TIMEOUT_MS:String(config.embeddingTimeoutMs),
    RCM_RERANK_ENDPOINT:config.rerankEndpoint??"https://api.voyageai.com/v1/rerank",RCM_RERANK_MODEL:config.rerankModel??"rerank-3",
    RCM_RERANK_TIMEOUT_MS:String(config.rerankTimeoutMs??45000),RCM_LLM_TIMEOUT_MS:String(config.llmTimeoutMs),
    RCM_LEASE_SECONDS:String(config.leaseSeconds),RCM_RETRIEVAL_TRACE:config.retrievalTrace,
    RCM_RETRIEVAL_TRACE_MAX_EVENTS:String(config.retrievalTraceMaxEvents),RCM_RETRIEVAL_TRACE_MAX_AGE_DAYS:String(config.retrievalTraceMaxAgeDays),
    ...(config.updateManifestUrl ? { RCM_UPDATE_MANIFEST_URL: config.updateManifestUrl } : {}),
    RCM_UPDATE_CHANNEL: config.updateChannel ?? "stable",
  };
}
