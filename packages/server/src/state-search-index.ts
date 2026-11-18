import { estimateTokens } from "@rcm/shared";
import Database from "better-sqlite3";
import type { RcmDatabase } from "./db.js";
import { collectStateEvidence, stateEvidenceFingerprintMigration, type StateEvidence } from "./state-evidence.js";
import { snapshotBeforeMigration } from "./db-snapshot.js";
import type { StateOutcomeCapture } from "./state-outcomes.js";
import { stateCorpusVersionQuery } from "./state-corpus-revision.js";

/** Request-local collection. Re-read after intervening writes, including writes
 * from another connection; collection itself may backfill legacy access rows.
 * Perspective labels affect diagnostic rejections only, never the corpus.
 */
export function stateEvidenceReader(db: RcmDatabase, chatId: string, trace?: StateOutcomeCapture, perspective = ""): (() => StateEvidence[]) & { collections: number } {
  const revision = stateCorpusVersionQuery(db);
  const version = () => JSON.stringify(revision.get(chatId));
  let collected: StateEvidence[] | undefined, at: string | undefined;
  const read = () => {
    const before = version();
    if (!collected || at !== before) {
      read.collections++;
      collected = collectStateEvidence(db, chatId, trace, perspective);
      const after = version();
      // A relevant write during collection (including its own lazy backfill)
      // makes the snapshot speculative. Never label old rows with a new token.
      at = before === after ? after : undefined;
    }
    return collected;
  };
  read.collections = 0;
  return read;
}

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
      if (version !== 1) {
        if (cache.prepare("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").get()) snapshotBeforeMigration(cache, 1);
        cache.exec("DROP TABLE IF EXISTS state_vectors; PRAGMA user_version=1");
      }
      cache.exec("CREATE TABLE IF NOT EXISTS state_vectors(chat_id TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,model TEXT NOT NULL,vector TEXT NOT NULL,PRIMARY KEY(chat_id,id))");
      cache.exec("CREATE TABLE IF NOT EXISTS state_fingerprint_versions(chat_id TEXT PRIMARY KEY,version INTEGER NOT NULL)");
      return run(cache);
    } finally { cache.close(); }
  }
  /** Preserve valid vectors across the fingerprint formula change. Failure is
   * disposable-cache work only: unmatched rows follow ordinary reindexing. */
  private migrateFingerprints(cache: Database.Database, chatId: string): void {
    if (cache.prepare("SELECT 1 FROM state_fingerprint_versions WHERE chat_id=? AND version=2").get(chatId)) return;
    const mark = () => cache.prepare("INSERT OR REPLACE INTO state_fingerprint_versions VALUES(?,2)").run(chatId);
    try {
      cache.transaction(() => {
        if (cache.prepare("SELECT 1 FROM state_vectors WHERE chat_id=? LIMIT 1").get(chatId)) {
          const update = cache.prepare("UPDATE state_vectors SET fingerprint=? WHERE chat_id=? AND id=? AND fingerprint=?");
          for (const [id, fingerprints] of stateEvidenceFingerprintMigration(this.canonical, chatId))
            update.run(fingerprints.current, chatId, id, fingerprints.legacy);
        }
        mark();
      })();
    } catch {
      // Do not retry the expensive legacy scan on every request after failure.
      // If the sidecar itself cannot be written, its existing error path applies.
      try { mark(); } catch { /* Normal cache reads/reindexing remain available. */ }
    }
  }
  /** Synchronous cache cleanup after a user deletion; never calls a provider. */
  prune(chatId: string): void {
    if (this.path === ":memory:") return;
    try {
      const valid = new Map(collectStateEvidence(this.canonical, chatId).map(item => [item.id, item.fingerprint]));
      this.use(cache => {
        this.migrateFingerprints(cache, chatId);
        for (const row of cache.prepare("SELECT id,fingerprint FROM state_vectors WHERE chat_id=?").all(chatId) as Array<{ id: string; fingerprint: string }>) {
          if (valid.get(row.id) !== row.fingerprint) cache.prepare("DELETE FROM state_vectors WHERE chat_id=? AND id=?").run(chatId, row.id);
        }
      });
    } catch (error) {
      this.status.available = false;
      this.status.lastError = error instanceof Error ? error.message : String(error);
    }
  }
  async index(chatId: string, embed: (texts: string[]) => Promise<number[][]>, signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted();
    // In-memory canonical databases intentionally have no persistent sidecar.
    if (this.path === ":memory:") return 0;
    this.status.chatId = chatId;
    const documents = collectStateEvidence(this.canonical, chatId);
    const pending = this.use(cache => {
      this.migrateFingerprints(cache, chatId);
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
      signal?.throwIfAborted();
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
  /** Completion proof for the existing eligible-document queue. Oversized states
   * retain the index's existing FTS-only policy; invalid/missing vectors do not
   * count as a completed eligible document. Never inspect or clear other chats.
   */
  assertComplete(chatId:string): void {
    if (this.path === ':memory:') return;
    const documents = collectStateEvidence(this.canonical,chatId).filter(item=>estimateTokens(item.text)<=4096);
    this.use(cache=>{
      this.migrateFingerprints(cache, chatId);
      const stored = new Map((cache.prepare('SELECT id,fingerprint,model FROM state_vectors WHERE chat_id=?').all(chatId) as
        {id:string;fingerprint:string;model:string}[]).map(row=>[row.id,row]));
      if (documents.some(item=>stored.get(item.id)?.fingerprint!==item.fingerprint || stored.get(item.id)?.model!==this.model)) throw new Error('STATE_EMBEDDINGS_INCOMPLETE');
    });
  }
  search(chatId: string, query: number[]): Map<string, number> {
    return this.searchMany(chatId, [query])[0]!;
  }
  /** One canonical snapshot and one parsed cache scan for all query views. */
  searchMany(chatId: string, queries: number[][], evidence?: StateEvidence[] | (() => StateEvidence[])): Map<string, number>[] {
    const scores = queries.map(() => new Map<string, number>());
    if (this.path === ":memory:" || queries.length === 0) return scores;
    this.status.chatId = chatId;
    let documents: Map<string, string> | undefined;
    const stored: Array<{ id: string; vector: number[] }> = [];
    try {
      const corpus = typeof evidence === "function" ? evidence() : evidence ?? collectStateEvidence(this.canonical, chatId);
      documents = new Map(corpus.map(item => [item.id, item.fingerprint]));
      const fingerprints = documents;
      this.use(cache => {
        this.migrateFingerprints(cache, chatId);
        for (const row of cache.prepare("SELECT id,fingerprint,vector FROM state_vectors WHERE chat_id=? AND model=?").iterate(chatId, this.model) as Iterable<{id:string;fingerprint:string;vector:string}>) {
          if (fingerprints.get(row.id) !== row.fingerprint) continue;
          stored.push({ id: row.id, vector: JSON.parse(row.vector) as number[] });
        }
      });
      this.status.available = true; this.status.lastError = "";
    } catch (error) {
      // State collection/cache failures leave primary vector retrieval usable.
      // Keep the valid prefix on a corrupt disposable cache, as single search did.
      this.status.available = false;
      this.status.lastError = error instanceof Error ? error.message : String(error);
    }
    queries.forEach((query, index) => {
      try {
        for (const { id, vector } of stored) {
          if (vector.length !== query.length) continue;
          let dot = 0, a = 0, b = 0;
          for (let i = 0; i < vector.length; i++) { dot += vector[i]! * query[i]!; a += vector[i]! ** 2; b += query[i]! ** 2; }
          if (a && b) scores[index]!.set(id, dot / Math.sqrt(a * b));
        }
      } catch (error) {
        this.status.available = false;
        this.status.lastError = error instanceof Error ? error.message : String(error);
      }
    });
    this.status.canonical = documents?.size ?? this.status.canonical; this.status.indexed = scores.at(-1)!.size;
    return scores;
  }
}
