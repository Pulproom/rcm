import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type BudgetBucket = "context" | "rerank" | "gateway";
/** One durable ledger shared by every experiment and worker, even across
 * processes. Unknown outcomes retain reservations; retrying reserves again. */
export class ProviderBudget {
  private db: Database.Database;
  constructor(path: string, limits = { context: 1_000_000, rerank: 1_000_000, gateway: 50 }) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS limits(bucket TEXT PRIMARY KEY, maximum REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,bucket TEXT NOT NULL,reserved REAL NOT NULL,charged REAL NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS prices(model TEXT PRIMARY KEY,input REAL NOT NULL,output REAL NOT NULL);`);
    for (const [bucket, limit] of Object.entries(limits)) {
      this.db.prepare("INSERT OR IGNORE INTO limits VALUES(?,?)").run(bucket, limit);
      if ((this.db.prepare("SELECT maximum FROM limits WHERE bucket=?").get(bucket) as { maximum: number }).maximum !== limit) throw new Error("Budget limit differs from the existing task ledger");
    }
  }
  setPrice(model: string, input: number, output: number): void {
    if (![input, output].every(value => Number.isFinite(value) && value > 0)) throw new Error("Unknown model pricing");
    this.db.prepare("INSERT OR REPLACE INTO prices VALUES(?,?,?)").run(model, input, output);
  }
  reserve(bucket: BudgetBucket, amount: number): string {
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid budget reservation");
    return this.db.transaction(() => {
      const { maximum } = this.db.prepare("SELECT maximum FROM limits WHERE bucket=?").get(bucket) as { maximum: number };
      const { used } = this.db.prepare("SELECT COALESCE(SUM(charged),0) AS used FROM calls WHERE bucket=?").get(bucket) as { used: number };
      if (used + amount > maximum) throw new Error(`Task ${bucket} budget exhausted`);
      const id = randomUUID();
      this.db.prepare("INSERT INTO calls VALUES(?,?,?,?,?,?)").run(id, bucket, amount, amount, "reserved", Date.now());
      return id;
    }).immediate();
  }
  settle(id: string, actual?: number): void {
    if (actual !== undefined && Number.isFinite(actual) && actual >= 0) this.db.prepare("UPDATE calls SET charged=?,status='settled' WHERE id=?").run(actual, id);
    else this.db.prepare("UPDATE calls SET status='unknown' WHERE id=?").run(id);
  }
  snapshot(): unknown { return this.db.prepare("SELECT l.bucket,l.maximum,COALESCE(SUM(c.charged),0) AS used,COUNT(c.id) AS calls FROM limits l LEFT JOIN calls c ON c.bucket=l.bucket GROUP BY l.bucket").all(); }
  close(): void { this.db.close(); }
  wrap(original: typeof fetch): typeof fetch {
    return async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if ((init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() !== "POST") return original(input, init);
      const voyage = url.hostname === "api.voyageai.com";
      const gateway = url.hostname === "api.llmgateway.io";
      if (!voyage && !gateway) {
        if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return original(input, init);
        throw new Error("Unbudgeted provider destination blocked");
      }
      const body = JSON.parse(String(init?.body ?? (input instanceof Request ? await input.clone().text() : undefined)));
      const bucket: BudgetBucket = gateway ? "gateway" : url.pathname.endsWith("/rerank") ? "rerank" : "context";
      let reserved: number;
      let price: { input: number; output: number } | undefined;
      if (gateway) {
        if (!["gemini-3.7-flash", "gemini-3.8-flash", "gemini-3.6-flash", "glm-5.2"].includes(body.model) || body.stream) throw new Error("Unapproved evaluation model or streaming request");
        price = this.db.prepare("SELECT input,output FROM prices WHERE model=?").get(body.model) as typeof price;
        const maximum = body.max_tokens ?? body.max_completion_tokens;
        if (!price || !Number.isInteger(maximum) || maximum < 1) throw new Error("Verified pricing and bounded output are required");
        reserved = Buffer.byteLength(JSON.stringify(body), "utf8") * 2 * price.input + maximum * price.output + .01;
      } else {
        const texts = bucket === "rerank" ? (body.documents as unknown[]).map(document => `${body.query}\n${typeof document === "string" ? document : JSON.stringify(document)}`) : body.inputs ?? body.input;
        reserved = Buffer.byteLength(JSON.stringify(texts), "utf8") * 2;
      }
      const id = this.reserve(bucket, reserved);
      try {
        const response = await original(input, init);
        const payload = await response.clone().json().catch(() => ({})) as any;
        const usage = payload.usage;
        const actual = gateway ? usage?.cost ?? (price && Number.isFinite(usage?.prompt_tokens) && Number.isFinite(usage?.completion_tokens)
          ? usage.prompt_tokens * price.input + usage.completion_tokens * price.output : undefined) : usage?.total_tokens;
        this.settle(id, response.ok ? actual : undefined);
        return response;
      } catch (error) { this.settle(id); throw error; }
    };
  }
}
