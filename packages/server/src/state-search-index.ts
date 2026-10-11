import { estimateTokens } from "@rcm/shared";
import Database from "better-sqlite3";
import type { RcmDatabase } from "./db.js";
import { collectStateEvidence } from "./state-evidence.js";

/** Disposable sidecar: it never changes the canonical DB's schema or facts. */
export class StateSearchIndex {
  private path: string;
  readonly status = { chatId: "", available: true, canonical: 0, indexed: 0, oversized: 0, lastError: "" };
  constructor(private canonical: RcmDatabase, private model: string) {
    this.path = canonical.name && canonical.name !== ":memory:" ? `${canonical.name}.state-search.db` : ":memory:";
  }
  private use<T>(run: (cache: Database.Database) => T): T {
    const cache = new Database(this.path);
    try {
      cache.pragma("journal_mode = WAL");
      const version = cache.pragma("user_version", { simple: true });
      if (version !== 1) cache.exec("DROP TABLE IF EXISTS state_vectors; PRAGMA user_version=1");
      cache.exec("CREATE TABLE IF NOT EXISTS state_vectors(chat_id TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,model TEXT NOT NULL,vector TEXT NOT NULL,PRIMARY KEY(chat_id,id))");
      return run(cache);
    } finally { cache.close(); }
  }
  /** Synchronous cache cleanup after a user deletion; never calls a provider. */
  prune(chatId: string): void {
    if (this.path === ":memory:") return;
    try {
      const valid = new Map(collectStateEvidence(this.canonical, chatId).map(item => [item.id, item.fingerprint]));
      this.use(cache => {
        for (const row of cache.prepare("SELECT id,fingerprint FROM state_vectors WHERE chat_id=?").all(chatId) as Array<{ id: string; fingerprint: string }>) {
          if (valid.get(row.id) !== row.fingerprint) cache.prepare("DELETE FROM state_vectors WHERE chat_id=? AND id=?").run(chatId, row.id);
        }
      });
    } catch (error) {
      this.status.available = false;
      this.status.lastError = error instanceof Error ? error.message : String(error);
    }
  }
  async index(chatId: string, embed: (texts: string[]) => Promise<number[][]>): Promise<number> {
    // In-memory canonical databases intentionally have no persistent sidecar.
    if (this.path === ":memory:") return 0;
    this.status.chatId = chatId;
    const documents = collectStateEvidence(this.canonical, chatId);
    const pending = this.use(cache => {
      const chats = new Set((this.canonical.prepare("SELECT id FROM chats").all() as {id:string}[]).map(row => row.id));
      for (const row of cache.prepare("SELECT DISTINCT chat_id FROM state_vectors").all() as {chat_id:string}[]) if (!chats.has(row.chat_id)) cache.prepare("DELETE FROM state_vectors WHERE chat_id=?").run(row.chat_id);
      const stored = new Map((cache.prepare("SELECT id,fingerprint,model FROM state_vectors WHERE chat_id=?").all(chatId) as { id: string; fingerprint: string; model: string }[]).map(row => [row.id, row]));
      const valid = new Set(documents.map(item => item.id));
      for (const id of stored.keys()) if (!valid.has(id)) cache.prepare("DELETE FROM state_vectors WHERE chat_id=? AND id=?").run(chatId, id);
      this.status.canonical = documents.length;
      this.status.indexed = documents.filter(item => stored.get(item.id)?.fingerprint === item.fingerprint && stored.get(item.id)?.model === this.model).length;
      this.status.oversized = documents.filter(item => estimateTokens(item.text) > 4096).length;
      return documents.filter(item => estimateTokens(item.text) <= 4096).filter(item => stored.get(item.id)?.fingerprint !== item.fingerprint || stored.get(item.id)?.model !== this.model);
    });
    let indexed = 0;
    for (let offset = 0; offset < pending.length; offset += 16) {
      const batch = pending.slice(offset, offset + 16);
      const vectors = await embed(batch.map(item => `${item.kind}; ${item.current ? "current" : "historical"}; ${item.text}`));
      const current = new Map(collectStateEvidence(this.canonical, chatId).map(item => [item.id, item.fingerprint]));
      this.use(cache => cache.transaction(() => {
        batch.forEach((item, index) => {
          const vector = vectors[index];
          if (current.get(item.id) !== item.fingerprint || !vector?.length || vector.some(value => !Number.isFinite(value))) return;
          cache.prepare("INSERT INTO state_vectors VALUES(?,?,?,?,?) ON CONFLICT(chat_id,id) DO UPDATE SET fingerprint=excluded.fingerprint,model=excluded.model,vector=excluded.vector")
            .run(chatId, item.id, item.fingerprint, this.model, JSON.stringify(vector));
          indexed++;
        });
      })());
    }
    this.status.indexed += indexed;
    return indexed;
  }
  search(chatId: string, query: number[]): Map<string, number> {
    if (this.path === ":memory:") return new Map();
    this.status.chatId = chatId;
    const documents = new Map(collectStateEvidence(this.canonical, chatId).map(item => [item.id, item.fingerprint]));
    const scores = new Map<string, number>();
    try { this.use(cache => {
      for (const row of cache.prepare("SELECT id,fingerprint,vector FROM state_vectors WHERE chat_id=? AND model=?").iterate(chatId, this.model) as Iterable<{id:string;fingerprint:string;vector:string}>) {
        if (documents.get(row.id) !== row.fingerprint) continue;
        const vector = JSON.parse(row.vector) as number[];
        if (vector.length !== query.length) continue;
        let dot = 0, a = 0, b = 0;
        for (let i = 0; i < vector.length; i++) { dot += vector[i]! * query[i]!; a += vector[i]! ** 2; b += query[i]! ** 2; }
        if (a && b) scores.set(row.id, dot / Math.sqrt(a * b));
      }
    });
      this.status.available = true; this.status.lastError = "";
    } catch (error) {
      // A disposable index failure must never erase canonical event retrieval.
      this.status.available = false;
      this.status.lastError = error instanceof Error ? error.message : String(error);
    }
    this.status.canonical = documents.size; this.status.indexed = scores.size;
    return scores;
  }
}
