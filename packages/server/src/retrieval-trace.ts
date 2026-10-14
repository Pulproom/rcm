import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RcmDatabase } from "./db.js";

export type RetrievalTraceMode = "off" | "metadata" | "full";

export interface RetrievalTraceConfig {
  mode: RetrievalTraceMode;
  path: string;
  maxEvents: number;
  maxAgeDays: number;
}

export const RETRIEVAL_TRACE_CHAT_PREFIX = "retrieval_trace_chat:";

export interface RetrievalTraceEvent {
  schema?: "rcm.retrieval-trace.v19";
  currentState?: import("./state-outcomes.js").StateOutcomeReport;
  id: string;
  at?: number;
  kind: "automatic_search" | "automatic_injection" | "mcp_search" | "mcp_delivery" | "tool_exposure";
  chatId: string;
  traceContext?: {
    requestId: string;
    turnKey: string;
    latestMessageId?: string;
    attempt?: number;
    callIndex?: number;
  };
  query?: string;
  aspects?: string[];
  querySignals?: Array<{ kind: string; text: string; weight: number }>;
  packet?: string;
  response?: string;
  [key: string]: unknown;
}

const digest = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 16);

function boundedText(value: unknown, max = 120_000): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length <= max ? value : `${value.slice(0, max)}\n[trace truncated]`;
}

function redactText(value: unknown): unknown {
  if (typeof value === "string") return { length: value.length, sha256: digest(value) };
  if (Array.isArray(value)) return value.map(redactText);
  return value;
}

export class RetrievalTraceWriter {
  readonly enabled: boolean;
  readonly dashboardAvailable: boolean;
  private queue: Promise<void> = Promise.resolve();
  private writes = 0;

  constructor(private readonly db: RcmDatabase, private readonly config: RetrievalTraceConfig) {
    this.enabled = config.mode !== "off";
    this.dashboardAvailable = config.mode === "full";
  }

  isChatEnabled(chatId: string): boolean {
    if (!this.enabled || !chatId) return false;
    return Boolean(this.db.prepare("SELECT 1 FROM server_meta WHERE key=? AND value='1'").get(`${RETRIEVAL_TRACE_CHAT_PREFIX}${chatId}`));
  }

  setChatEnabled(chatId: string, enabled: boolean): void {
    if (!this.db.prepare("SELECT 1 FROM chats WHERE id=?").get(chatId)) throw new Error("Chat not found");
    const key = `${RETRIEVAL_TRACE_CHAT_PREFIX}${chatId}`;
    if (enabled) this.db.prepare("INSERT INTO server_meta(key,value) VALUES(?, '1') ON CONFLICT(key) DO UPDATE SET value='1'").run(key);
    else this.db.prepare("DELETE FROM server_meta WHERE key=?").run(key);
  }

  record(event: RetrievalTraceEvent): Promise<void> {
    if (!this.isChatEnabled(event.chatId)) return Promise.resolve();
    // Freeze source position, timestamp and payload before delayed file I/O.
    let line: string;
    try { line = JSON.stringify(this.sanitize(event)); }
    catch (error) {
      console.warn(`[RCM] Retrieval trace snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
      return Promise.resolve();
    }
    this.queue = this.queue.then(() => this.write(line)).catch((error) => {
      console.warn(`[RCM] Retrieval trace write failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return this.queue;
  }

  private sourcePosition(chatId: string, latestMessageId?: string): Record<string, unknown> | undefined {
    if (!latestMessageId) return undefined;
    const row = this.db.prepare("SELECT ordinal,role FROM messages WHERE chat_id=? AND message_id=?").get(chatId, latestMessageId) as { ordinal: number; role: string } | undefined;
    if (!row) return { latestMessageId };
    const userTurn = (this.db.prepare("SELECT count(*) AS count FROM messages WHERE chat_id=? AND lifecycle='committed' AND host_visibility IN ('active','all_before') AND role='user' AND ordinal<=?").get(chatId, row.ordinal) as { count: number }).count;
    return { latestMessageId, sourceOrdinal: row.ordinal, sourceRole: row.role, userTurn };
  }

  private sanitize(event: RetrievalTraceEvent): Record<string, unknown> {
    const full = this.config.mode === "full";
    const proseKeys = new Set(["title", "summary", "text", "content", "dialogue", "question", "quote", "aspect"]);
    const redactDiagnostics = (value: unknown): unknown => {
      if (full || !value || typeof value !== "object") return value;
      if (Array.isArray(value)) return value.map(redactDiagnostics);
      const source = value as Record<string, unknown>;
      return Object.fromEntries(Object.entries(source)
        .filter(([key]) => key !== "matchedLexicalTokens")
        .map(([key, item]) => [key, proseKeys.has(key) ? redactText(item) : redactDiagnostics(item)]));
    };
    const querySignals = event.querySignals?.map((signal) => ({
      ...signal,
      text: full ? boundedText(signal.text, 8_000) : redactText(signal.text),
    }));
    const sanitized: Record<string, unknown> = {
      ...event,
      schema: "rcm.retrieval-trace.v19",
      at: event.at ?? Date.now(),
      source: this.sourcePosition(event.chatId, event.traceContext?.latestMessageId),
      query: full ? boundedText(event.query, 32_000) : redactText(event.query),
      aspects: full ? event.aspects?.map((item) => boundedText(item, 4_000)) : redactText(event.aspects),
      querySignals,
      packet: full ? boundedText(event.packet) : redactText(event.packet),
      response: full ? boundedText(event.response) : redactText(event.response),
      answers: redactDiagnostics(event.answers),
      coverage: redactDiagnostics(event.coverage),
      retrieval: redactDiagnostics(event.retrieval),
      retrievals: redactDiagnostics(event.retrievals),
      story: redactDiagnostics(event.story),
      currentState: event.currentState ? { ...event.currentState,
        entries: event.currentState.entries.map(({ title, ...entry }) => ({ ...entry, ...(full && title ? { title } : {}) })),
      } : undefined,
    };
    for (const key of ["query", "aspects", "querySignals", "packet", "response"] as const) if (sanitized[key] === undefined) delete sanitized[key];
    return sanitized;
  }

  private async write(line: string): Promise<void> {
    await mkdir(dirname(this.config.path), { recursive: true });
    await appendFile(this.config.path, `${line}\n`, "utf8");
    this.writes += 1;
    if (this.writes % 20 === 0 || (await stat(this.config.path)).size > 16 * 1024 * 1024) await this.compact();
  }

  private async compact(): Promise<void> {
    const content = await readFile(this.config.path, "utf8").catch(() => "");
    const cutoff = Date.now() - this.config.maxAgeDays * 86_400_000;
    const lines = content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const value = JSON.parse(line) as { at?: number };
        return (value.at ?? 0) >= cutoff ? [line] : [];
      } catch { return []; }
    }).slice(-this.config.maxEvents);
    const temporary = `${this.config.path}.tmp`;
    await writeFile(temporary, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
    await rename(temporary, this.config.path);
  }
}
