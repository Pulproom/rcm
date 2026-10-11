import { ProviderBudget } from "./provider-budget.js";
import { serve } from "@hono/node-server";
import { createApp } from "./api.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { EmbeddingService } from "./embedding.js";
import { ServerLlmStore } from "./server-llm.js";
import { ServerExtractionWorker } from "./server-worker.js";
import { UpdateService } from "./update-service.js";

const config = loadConfig();
if (process.env.RCM_TASK_BUDGET_PATH) globalThis.fetch = new ProviderBudget(process.env.RCM_TASK_BUDGET_PATH).wrap(globalThis.fetch);
const handle = openDatabase(config.dbPath);
const embeddings = new EmbeddingService(handle.db, {
  enabled: config.embeddings === "voyage",
  vectorEnabled: handle.vectorEnabled,
  apiKey: config.voyageApiKey,
  endpoint: config.voyageEndpoint,
  model: config.embeddingModel,
  timeoutMs: config.embeddingTimeoutMs,
});
const llmStore = new ServerLlmStore(handle.db, config.secretsPath, config.llmApiKeys ?? {}, config.llmTimeoutMs);
const serverWorker = new ServerExtractionWorker(handle.db, llmStore, embeddings, config.leaseSeconds);
const updateService = new UpdateService(config);
const app = createApp({ db: handle.db, config, embeddings, vectorEnabled: handle.vectorEnabled, llmStore, serverWorker, updateService });

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[RCM] Server listening on http://${info.address}:${info.port}`);
  console.log("[RCM] Contextual memory details: enabled");
  if (config.token === "change-me") console.warn("[RCM] RCM_TOKEN is using the insecure default. Set a private token before remote access.");
  if (config.embeddings === "voyage" && !config.voyageApiKey) console.warn("[RCM] VOYAGE_API_KEY is missing; FTS retrieval remains active.");
  embeddings.warm();
  void updateService.check();
});
