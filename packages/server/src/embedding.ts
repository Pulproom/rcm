import { EVERYONE_HOLDER, itemAccessKnowledge } from "./item-access.js";
import { StateSearchIndex } from "./state-search-index.js";
import { recognitionDetailSql, searchableMemoryParentSql } from "./memory-group-search.js";
import { loadItemAccess, resolveItemAccess } from "./item-access.js";
import { createHash } from "node:crypto";
import { buildSourceUnits, splitAuxiliarySource, estimateTokens, queryViewAuthority, type SearchQuerySignal } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { now } from "./db.js";
import { memoryEmbeddingDocument } from "./memory-search-document.js";

const DIMENSION = 1024;
const QUERY_TIMEOUT_MS = 10_000;
const INDEX_TIMEOUT_MS = 60_000;
const QUERY_CACHE_TTL = 5 * 60_000;
const MAX_QUERY_CACHE = 512;
const MAX_BLOCK_ATTEMPTS = 2;
const BLOCK_PAGE_SIZE = 10;
const MAX_BLOCK_PAGES = 100;
const MAX_ITEM_ATTEMPTS = 3;

export class EmbeddingRequestError extends Error {
  constructor(readonly status: number) { super(`Voyage embedding request failed (${status})`); }
}

interface VoyageEmbedding {
  embedding: number[];
  index: number;
  text?: string;
}

interface VoyageGroup {
  data?: VoyageEmbedding[];
  embeddings?: number[][];
  index: number;
}

interface VoyageResponse {
  data?: VoyageGroup[];
  results?: Array<{ embeddings: number[][]; index: number }>;
}

interface MessageRow {
  message_id: string;
  role: string;
  content: string;
  content_hash: string;
  lifecycle: string;
  host_visibility?: string;
  ordinal: number;
}

interface TranscriptChunk {
  text: string;
  messageIds: string[];
  ranges: Array<{ messageId: string; canonicalHash: string; start: number; end: number }>;
}

export interface EmbeddingOptions {
  enabled: boolean;
  vectorEnabled: boolean;
  apiKey: string;
  endpoint: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SemanticMemoryHit {
  memoryId: string;
  score: number;
  kind: "memory" | "memory_detail" | "transcript_chunk";
  sourceId: string;
  viewIndex?: number;
}

export interface SemanticStoryHit {
  nodeId: string;
  score: number;
  kind: "story_segment" | "story_arc" | "story_overview";
}

export interface SemanticSourceHit { chunkId: string; messageIds: string[]; score: number; viewIndex?: number }

export interface SemanticSearchResult {
  stateScores?: Map<string, number>;
  searchUnavailable?: boolean;
  atomHits?: Map<string, SemanticMemoryHit[]>;
  sourceHits?: SemanticSourceHit[];
  scores: Map<string, number>;
  hits: Map<string, SemanticMemoryHit>;
  viewScores?: Array<Map<string, number>>;
  storyScores?: Map<string, number>;
  storyHits?: Map<string, SemanticStoryHit>;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const transcriptBlockHash = (messages: MessageRow[]): string => sha256(
  messages.map((message) => `${message.message_id}\0${message.content_hash}`).join("\0"),
);

function splitLongMessage(message: MessageRow): TranscriptChunk[] {
  const prefix = `[${message.message_id}] ${message.role.toUpperCase()}:\n`;
  const pieces: TranscriptChunk[] = [];
  const units = buildSourceUnits([{ id: message.message_id, content: message.content, canonicalHash: message.content_hash }], { granularity: "display" });
  for (const unit of units) {
    for (const part of splitAuxiliarySource(unit.text, text => estimateTokens(prefix + text), 512)) {
      pieces.push({ text: prefix + part.text, messageIds: [message.message_id], ranges: [{
        messageId: message.message_id, canonicalHash: message.content_hash,
        start: unit.start + part.start, end: unit.start + part.end,
      }] });
    }
  }
  return pieces;
}

export function chunkTranscript(messages: MessageRow[]): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let parts: string[] = [];
  let messageIds: string[] = [];
  let ranges: TranscriptChunk["ranges"] = [];
  let tokens = 0;
  const flush = () => {
    if (parts.length === 0) return;
    chunks.push({ text: parts.join("\n\n"), messageIds: [...new Set(messageIds)], ranges });
    parts = [];
    messageIds = [];
    tokens = 0;
    ranges = [];
  };
  for (const message of messages) {
    for (const piece of splitLongMessage(message)) {
      if (parts.length > 0 && estimateTokens([...parts, piece.text].join("\n\n")) > 512) flush();
      parts.push(piece.text);
      messageIds.push(...piece.messageIds);
      ranges.push(...piece.ranges);
      tokens = estimateTokens(parts.join("\n\n"));
      if (tokens >= 384) flush();
    }
  }
  flush();
  return chunks;
}

export class EmbeddingService {
  readonly model: string;
  readonly stateIndex: StateSearchIndex;
  readonly dimension = DIMENSION;
  readonly #fetch: typeof fetch;
  #timeoutMs: number;
  #warming: Promise<void> | null = null;
  #indexQueue: Promise<number> = Promise.resolve(0);
  #indexRetryAfter = 0;
  #queryRetryAfter = 0;
  #indexError = "";
  #queryError = "";
  #queryCache = new Map<string, { vector: number[]; expiresAt: number }>();

  constructor(
    private readonly db: RcmDatabase,
    private readonly options: EmbeddingOptions,
  ) {
    this.model = options.model ?? "voyage-context-4";
    this.stateIndex = new StateSearchIndex(db, this.model);
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? QUERY_TIMEOUT_MS;
  }

  setTimeoutMs(value: number): void {
    if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid embedding timeout");
    this.#timeoutMs = value;
  }

  get ready(): boolean {
    return this.options.enabled && this.options.vectorEnabled && Boolean(this.options.apiKey);
  }

  get status(): {
    configured: boolean;
    ready: boolean;
    model: string;
    dimension: number;
    pendingBlocks: number;
    failedBlocks: number;
    stateSearch: StateSearchIndex["status"];
    lastError?: string;
  } {
    return {
      configured: this.options.enabled && Boolean(this.options.apiKey),
      ready: this.ready,
      model: this.model,
      dimension: this.dimension,
      pendingBlocks: (this.db.prepare("SELECT count(*) AS count FROM embedding_blocks WHERE status='queued'").get() as { count: number }).count,
      failedBlocks: (this.db.prepare("SELECT count(*) AS count FROM embedding_blocks WHERE status='failed'").get() as { count: number }).count,
      lastError: [this.#indexError, this.#queryError].filter(Boolean).join("; ") || undefined,
      stateSearch: { ...this.stateIndex.status },
    };
  }

  warm(): void {
    if (!this.ready || this.#warming || Date.now() < this.#indexRetryAfter) return;
    this.#warming = this.indexPending().then(() => {
      console.log(`[RCM] Voyage embedding ready: ${this.model} (${this.dimension}d)`);
    }).catch((error) => {
      this.#recordFailure(error, "index");
    }).finally(() => { this.#warming = null; });
  }

  async #requestWithKey(inputs: string[][], inputType: "document" | "query", timeoutMs: number, apiKey: string, deadline = Date.now() + timeoutMs): Promise<number[][][]> {
    const split = async (): Promise<number[][][]> => {
      if (inputs.length > 1) {
        const middle = Math.ceil(inputs.length / 2);
        return [...await this.#requestWithKey(inputs.slice(0, middle), inputType, timeoutMs, apiKey, deadline),
          ...await this.#requestWithKey(inputs.slice(middle), inputType, timeoutMs, apiKey, deadline)];
      }
      const chunks = inputs[0] ?? [];
      if (chunks.length <= 1) throw new Error("Voyage input exceeds the manual chunk request limit");
      const middle = Math.ceil(chunks.length / 2);
      const left = await this.#requestWithKey([chunks.slice(0, middle)], inputType, timeoutMs, apiKey, deadline);
      const right = await this.#requestWithKey([chunks.slice(middle)], inputType, timeoutMs, apiKey, deadline);
      return [[...left[0]!, ...right[0]!]];
    };
    if (Date.now() >= deadline) throw new Error("Voyage request deadline exceeded");
    if (inputs.flat().reduce((sum, text) => sum + estimateTokens(text), 0) > 28_000) return split();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    try {
      const response = await this.#fetch(this.options.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          inputs,
          input_type: inputType,
          model: this.model,
          output_dimension: this.dimension,
          output_dtype: "float",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorText = await response.text();
        if ([400, 413].includes(response.status) && /token|context.{0,20}(?:length|limit)|too (?:large|long)/i.test(errorText)
          && (inputs.length > 1 || (inputs[0]?.length ?? 0) > 1)) return split();
        throw new EmbeddingRequestError(response.status);
      }
      const payload = await response.json() as VoyageResponse;
      const groups = payload.data
        ? payload.data.sort((a, b) => a.index - b.index).map((group) =>
            group.data
              ? group.data.sort((a, b) => a.index - b.index).map((item) => item.embedding)
              : group.embeddings ?? [],
          )
        : (payload.results ?? []).sort((a, b) => a.index - b.index).map((group) => group.embeddings);
      if (groups.length !== inputs.length || groups.some((group, index) =>
        group.length !== inputs[index]?.length || group.some((vector) => vector.length !== this.dimension),
      )) throw new Error("Voyage returned an unexpected embedding shape");
      return groups;
    } finally {
      clearTimeout(timeout);
    }
  }

  async #request(inputs: string[][], inputType: "document" | "query"): Promise<number[][][]> {
    const timeoutMs = Math.max(inputType === "query" ? QUERY_TIMEOUT_MS : INDEX_TIMEOUT_MS, this.#timeoutMs);
    const result = await this.#requestWithKey(inputs, inputType, timeoutMs, this.options.apiKey);
    if (inputType === "query") this.#queryError = "";
    return result;
  }

  async testConnection(apiKey = this.options.apiKey): Promise<void> {
    const candidate = apiKey.trim();
    if (candidate.length < 12) throw new Error("Voyage API key is too short");
    if (!/^[A-Za-z0-9._-]+$/.test(candidate)) throw new Error("Voyage API key contains unsupported characters");
    await this.#requestWithKey([["Risu Cognitive Memory connection check"]], "query", this.#timeoutMs, candidate);
  }

  async validateAndSetApiKey(apiKey: string): Promise<void> {
    const candidate = apiKey.trim();
    await this.testConnection(candidate);
    this.options.apiKey = candidate;
    this.#indexError = "";
    this.#queryError = "";
    this.#queryRetryAfter = 0;
    this.#indexRetryAfter = 0;
    this.#queryCache.clear();
  }

  clearApiKey(): void {
    this.options.apiKey = "";
    this.#queryCache.clear();
    this.#indexError = "";
    this.#queryError = "";
    this.#queryRetryAfter = 0;
    this.#indexRetryAfter = 0;
  }

  #recordFailure(error: unknown, lane: "index" | "query"): void {
    const message = `[${lane}] ${error instanceof Error ? error.message : String(error)}`;
    if (lane === "index") {
      this.#indexError = message;
      this.#indexRetryAfter = Date.now() + 5 * 60_000;
    } else {
      this.#queryError = message;
      this.#queryRetryAfter = Date.now() + 30_000;
    }
    console.warn(`[RCM] Voyage ${lane} backoff; lexical retrieval remains active`, message);
  }

  #deleteRows(rowids: number[]): void {
    if (rowids.length === 0) return;
    const placeholders = rowids.map(() => "?").join(",");
    this.db.transaction(() => {
      if (this.options.vectorEnabled) this.db.prepare(`DELETE FROM embedding_vectors_v4_chat WHERE rowid IN (${placeholders})`).run(...rowids.map((rowid) => BigInt(rowid)));
      this.db.prepare(`DELETE FROM embedding_items WHERE rowid IN (${placeholders})`).run(...rowids);
    })();
  }

  #storeItem(item: {
    itemId: string;
    chatId: string;
    kind: "memory" | "memory_detail" | "transcript_chunk" | "story_segment" | "story_arc" | "story_overview";
    sourceId: string;
    blockId?: string;
    sourceIds?: string[];
    sourceRanges?: TranscriptChunk["ranges"];
    content: string;
    contentHash: string;
    vector: number[];
  }): void {
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO embedding_items(
          item_id,chat_id,kind,source_id,block_id,source_json,content,content_hash,model,dimension,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(item_id) DO UPDATE SET
          chat_id=excluded.chat_id,kind=excluded.kind,source_id=excluded.source_id,block_id=excluded.block_id,
          source_json=excluded.source_json,content=excluded.content,content_hash=excluded.content_hash,
          model=excluded.model,dimension=excluded.dimension,updated_at=excluded.updated_at
      `).run(
        item.itemId, item.chatId, item.kind, item.sourceId, item.blockId ?? null,
        JSON.stringify(item.sourceRanges ? { messageIds: item.sourceIds, ranges: item.sourceRanges } : item.sourceIds ?? []), item.content, item.contentHash, this.model, this.dimension, now(),
      );
      const stored = this.db.prepare("SELECT rowid FROM embedding_items WHERE item_id=?").get(item.itemId) as { rowid: number };
      if (this.options.vectorEnabled) {
        this.db.prepare("DELETE FROM embedding_vectors_v4_chat WHERE rowid=?").run(BigInt(stored.rowid));
        this.db.prepare("INSERT INTO embedding_vectors_v4_chat(rowid,embedding,chat_id) VALUES(?,?,?)").run(
          BigInt(stored.rowid), JSON.stringify(item.vector), item.chatId,
        );
      }
    })();
  }

  #requeueRowIdCollisionBlocks(chatId?: string): number {
    const rows = this.db.prepare(`SELECT id FROM embedding_blocks
      WHERE status IN ('failed','queued') AND attempts>=? AND last_error LIKE 'UNIQUE constraint failed on embedding_vectors_v4_chat%'
        ${chatId ? "AND chat_id=?" : ""}`).all(MAX_BLOCK_ATTEMPTS, ...(chatId ? [chatId] : [])) as Array<{ id: string }>;
    const mark = this.db.prepare("INSERT OR IGNORE INTO server_meta(key,value) VALUES(?,?)");
    const requeue = this.db.prepare("UPDATE embedding_blocks SET status='queued',attempts=0,last_error=NULL,updated_at=? WHERE id=? AND status IN ('failed','queued') AND attempts>=?");
    return this.db.transaction(() => rows.reduce((count, row) => {
      const key = `embedding_rowid_recovery:${row.id}`;
      if (mark.run(key, String(now())).changes !== 1) return count;
      return count + requeue.run(now(), row.id, MAX_BLOCK_ATTEMPTS).changes;
    }, 0))();
  }

  #discardStaleBlocks(chatId?: string): number {
    const blocks = this.db.prepare(`
      SELECT id,chat_id,content_hash,message_ids_json FROM embedding_blocks
      WHERE status IN ('queued','indexed') ${chatId ? "AND chat_id=?" : ""}
    `).all(...(chatId ? [chatId] : [])) as Array<{ id: string; chat_id: string; content_hash: string; message_ids_json: string }>;
    let discarded = 0;
    for (const block of blocks) {
      const ids = JSON.parse(block.message_ids_json) as string[];
      if (ids.length === 0) continue;
      const messages = this.db.prepare(`
        SELECT message_id,role,CASE WHEN canonical_hash<>'' THEN canonical_content ELSE content END AS content,
          CASE WHEN canonical_hash<>'' THEN canonical_hash ELSE content_hash END AS content_hash,lifecycle,host_visibility,ordinal FROM messages
        WHERE chat_id=? AND memory_excluded=0 AND message_id IN (${ids.map(() => "?").join(",")})
        ORDER BY ordinal
      `).all(block.chat_id, ...ids) as MessageRow[];
      const valid = messages.length === ids.length
        && messages.every((message) => message.content && (message.host_visibility === undefined || message.host_visibility === "active") && ["committed", "client_pruned"].includes(message.lifecycle))
        && transcriptBlockHash(messages) === block.content_hash;
      if (valid) continue;
      const rows = this.db.prepare("SELECT rowid FROM embedding_items WHERE block_id=?").all(block.id) as Array<{ rowid: number }>;
      this.#deleteRows(rows.map((row) => row.rowid));
      this.db.prepare("UPDATE embedding_blocks SET status='stale',updated_at=? WHERE id=?").run(now(), block.id);
      discarded += 1;
    }
    return discarded;
  }

  async #indexMemories(chatId?: string): Promise<number> {
    const rows = this.db.prepare(`
      SELECT id,chat_id,title,content,locations_json,landmark_kinds_json FROM memories
      WHERE active=1 AND ${searchableMemoryParentSql()} ${chatId ? "AND chat_id=?" : ""}
      ORDER BY updated_at
    `).all(...(chatId ? [chatId] : [])) as Array<{ id: string; chat_id: string; title: string; content: string; locations_json: string; landmark_kinds_json: string }>;
    const pending: Array<Record<string, any> & { itemId: string; content: string; contentHash: string }> = rows.flatMap((row) => {
      const content = memoryEmbeddingDocument(this.db, row);
      const contentHash = sha256(content);
      const itemId = `memory:${row.id}`;
      const item = this.db.prepare("SELECT content_hash,model,dimension FROM embedding_items WHERE item_id=?").get(`memory:${row.id}`) as
        | { content_hash: string; model: string; dimension: number }
        | undefined;
      const failure = this.db.prepare("SELECT content_hash,attempts FROM embedding_failures WHERE item_id=?").get(itemId) as
        | { content_hash: string; attempts: number }
        | undefined;
      if (failure?.content_hash === contentHash && failure.attempts >= MAX_ITEM_ATTEMPTS) return [];
      return item?.content_hash === contentHash && item.model === this.model && item.dimension === this.dimension
        ? [] : [{ ...row, itemId, content, contentHash }];
    }).slice(0, 200);
    if (pending.length === 0) return 0;
    let indexed = 0;
    let offset = 0;
    while (offset < pending.length) {
      const batch: typeof pending = [];
      let tokens = 0;
      while (offset < pending.length && batch.length < 128) {
        const row = pending[offset]!;
        const cost = estimateTokens(row.content);
        if (batch.length > 0 && tokens + cost > 80_000) break;
        batch.push(row);
        tokens += cost;
        offset += 1;
      }
      try {
        const groups = await this.#request(batch.map((row) => [row.content]), "document");
        batch.forEach((row, index) => {
          this.#storeItem({
            itemId: row.itemId, chatId: row.chat_id, kind: "memory", sourceId: row.id,
            content: row.content, contentHash: row.contentHash, vector: groups[index]![0]!,
          });
          this.db.prepare("DELETE FROM embedding_failures WHERE item_id=?").run(row.itemId);
        });
        indexed += batch.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const record = this.db.prepare(`
          INSERT INTO embedding_failures(item_id,chat_id,content_hash,attempts,last_error,updated_at)
          VALUES(?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET
            chat_id=excluded.chat_id,
            attempts=CASE WHEN embedding_failures.content_hash=excluded.content_hash THEN embedding_failures.attempts+1 ELSE 1 END,
            content_hash=excluded.content_hash,last_error=excluded.last_error,updated_at=excluded.updated_at
        `);
        for (const row of batch) record.run(row.itemId, row.chat_id, row.contentHash, 1, message.slice(0, 1000), now());
        this.#recordFailure(error, "index");
        break;
      }
    }
    return indexed;
  }

  async #indexContextualDetails(chatId?: string): Promise<number> {
    const rows = this.db.prepare(`SELECT d.* FROM memory_details d JOIN memories m ON m.id=d.memory_id
      WHERE d.active=1 AND m.active=1 AND ${searchableMemoryParentSql("m")} AND NOT ${recognitionDetailSql('d')} ${chatId ? "AND d.chat_id=?" : ""}
      ORDER BY d.chat_id,d.memory_id,d.created_at,d.id`).all(...(chatId ? [chatId] : [])) as any[];
    const groups = new Map<string, any[]>();
    for (const row of rows) {
      const access = loadItemAccess(this.db, row.chat_id, [{ kind: "detail", id: row.id }]);
      const scope = resolveItemAccess(access, "detail", row.id, JSON.parse(row.known_by_json));
      const holders = [...itemAccessKnowledge(scope)].sort();
      const scopeKey = JSON.stringify(holders);
      const key = JSON.stringify([row.chat_id, row.memory_id, scopeKey]);
      groups.set(key, [...(groups.get(key) ?? []), { ...row, holders, scopeKey }]);
    }
    let indexed = 0;
    for (const members of groups.values()) {
      if (indexed >= 240) break;
      const first = members[0]!;
      const sourceIds = [...new Set(members.flatMap((row) => (JSON.parse(row.evidence_json) as Array<{ messageId: string }>).map((item) => item.messageId)))];
      const passages = this.db.prepare(`SELECT p.quote,p.access_json,p.canonical_hash,p.start_offset,m.ordinal FROM source_passages p
        JOIN messages m ON m.chat_id=p.chat_id AND m.message_id=p.message_id AND m.canonical_hash=p.canonical_hash
        WHERE p.chat_id=? AND p.active=1 AND m.lifecycle IN ('committed','client_pruned') AND m.memory_excluded=0 AND m.host_visibility IN ('active','all_before')
        AND p.message_id IN (SELECT value FROM json_each(?)) ORDER BY m.ordinal,p.start_offset`)
        .all(first.chat_id, JSON.stringify(sourceIds)) as Array<{ quote: string; access_json: string; canonical_hash: string }>;
      const contexts = passages.filter((row) => JSON.stringify((JSON.parse(row.access_json) as Array<{ holder: string }>).map((grant) => grant.holder).sort()) === first.scopeKey).map((row) => row.quote);
      const documents = members.map((row) => `${row.kind}: ${row.text}\nParticipants: ${JSON.parse(row.participants_json).join(", ")}`);
      const inputs = [...contexts, ...documents];
      const groupHash = sha256(JSON.stringify({ scope: first.scopeKey, ids: members.map((row) => row.id), inputs }));
      const hashes = documents.map((content) => sha256(`${groupHash}\0${content}`));
      const fresh = members.every((row, index) => {
        const item = this.db.prepare("SELECT content_hash,model,dimension FROM embedding_items WHERE item_id=?").get(`detail:${row.id}`) as any;
        return item?.content_hash === hashes[index] && item.model === this.model && item.dimension === this.dimension;
      });
      if (fresh) continue;
      try {
        const vectors = (await this.#request([inputs], "document"))[0]!;
        members.forEach((row, index) => this.#storeItem({ itemId: `detail:${row.id}`, chatId: row.chat_id, kind: "memory_detail", sourceId: row.id,
          sourceIds: [row.memory_id], content: documents[index]!, contentHash: hashes[index]!, vector: vectors[contexts.length + index]! }));
        indexed += members.length;
      } catch (error) { this.#recordFailure(error, "index"); break; }
    }
    return indexed;
  }

  async #indexStorySpine(chatId?: string): Promise<number> {
    const rows = this.db.prepare(`SELECT id,chat_id,level,scope,holder,title,summary,beats_json,active_transitions_json
      FROM story_spine_nodes WHERE generation_id='active' AND status='active' AND hidden=0 AND level IN ('arc','segment')
      ${chatId ? "AND chat_id=?" : ""} ORDER BY updated_at`).all(...(chatId ? [chatId] : [])) as Array<Record<string, any>>;
    const documents = rows.flatMap(row => row.level === "segment"
      ? (JSON.parse(row.beats_json) as Array<{ text: string }>).map((beat, index) => ({ ...row, searchId: `beat:${row.id}:${index}`, searchText: beat.text }))
      : [{ ...row, searchId: `spine:${row.id}`, searchText: `${row.title}\n${row.summary}` }]);
    const pending: Array<Record<string, any> & { itemId: string; content: string; contentHash: string }> = documents.flatMap((row) => {
      const content = row.searchText;
      const contentHash = sha256(content);
      const itemId = row.searchId;
      const item = this.db.prepare("SELECT content_hash,model,dimension FROM embedding_items WHERE item_id=?").get(itemId) as { content_hash: string; model: string; dimension: number } | undefined;
      const failure = this.db.prepare("SELECT content_hash,attempts FROM embedding_failures WHERE item_id=?").get(itemId) as { content_hash: string; attempts: number } | undefined;
      if (failure?.content_hash === contentHash && failure.attempts >= MAX_ITEM_ATTEMPTS) return [];
      return item?.content_hash === contentHash && item.model === this.model && item.dimension === this.dimension
        ? [] : [{ ...row, itemId, content, contentHash }];
    }).slice(0, 200);
    if (!pending.length) return 0;
    let indexed = 0;
    for (let offset = 0; offset < pending.length;) {
      const batch: typeof pending = [];
      let tokens = 0;
      while (offset < pending.length && batch.length < 96) {
        const row = pending[offset]!;
        const cost = estimateTokens(row.content);
        if (batch.length && tokens + cost > 80_000) break;
        batch.push(row); tokens += cost; offset += 1;
      }
      try {
        const groups = await this.#request(batch.map((row) => [row.content]), "document");
        batch.forEach((row, index) => this.#storeItem({
          itemId: row.itemId, chatId: row.chat_id, kind: row.level === "segment" ? "story_segment" : "story_arc",
          sourceId: row.id, content: row.content, contentHash: row.contentHash, vector: groups[index]![0]!,
        }));
        for (const row of batch) this.db.prepare("DELETE FROM embedding_failures WHERE item_id=?").run(row.itemId);
        indexed += batch.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const record = this.db.prepare(`INSERT INTO embedding_failures(item_id,chat_id,content_hash,attempts,last_error,updated_at)
          VALUES(?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET chat_id=excluded.chat_id,
          attempts=CASE WHEN embedding_failures.content_hash=excluded.content_hash THEN embedding_failures.attempts+1 ELSE 1 END,
          content_hash=excluded.content_hash,last_error=excluded.last_error,updated_at=excluded.updated_at`);
        for (const row of batch) record.run(row.itemId, row.chat_id, row.contentHash, 1, message.slice(0, 1000), now());
        this.#recordFailure(error, "index"); break;
      }
    }
    return indexed;
  }

  #removeInactiveMemoryItems(chatId?: string): number {
    const rows = this.db.prepare(`
      SELECT item.rowid FROM embedding_items item
      LEFT JOIN memories memory ON memory.id=item.source_id AND memory.active=1 AND ${searchableMemoryParentSql("memory")}
      LEFT JOIN memory_details detail ON detail.id=item.source_id AND detail.active=1
      LEFT JOIN story_spine_nodes spine ON spine.id=item.source_id AND spine.generation_id='active' AND spine.status='active' AND spine.hidden=0
      WHERE ((item.kind='memory' AND memory.id IS NULL) OR (item.kind='memory_detail' AND detail.id IS NULL)
        OR (item.kind='story_overview')
        OR (item.kind IN ('story_arc','story_segment') AND spine.id IS NULL)) ${chatId ? "AND item.chat_id=?" : ""}
    `).all(...(chatId ? [chatId] : [])) as Array<{ rowid: number }>;
    this.#deleteRows(rows.map((row) => row.rowid));
    return rows.length;
  }

  async #indexBlocks(chatId?: string): Promise<{ selected: number; indexed: number }> {
    const blocks = this.db.prepare(`
      SELECT id,chat_id,content_hash,message_ids_json,attempts FROM embedding_blocks
      WHERE status='queued' AND attempts<? ${chatId ? "AND chat_id=?" : ""}
      ORDER BY created_at LIMIT ${BLOCK_PAGE_SIZE}
    `).all(MAX_BLOCK_ATTEMPTS, ...(chatId ? [chatId] : [])) as Array<{
      id: string; chat_id: string; content_hash: string; message_ids_json: string; attempts: number;
    }>;
    let indexed = 0;
    for (const block of blocks) {
      const ids = JSON.parse(block.message_ids_json) as string[];
      const messages = this.db.prepare(`
        SELECT message_id,role,CASE WHEN canonical_hash<>'' THEN canonical_content ELSE content END AS content,
          CASE WHEN canonical_hash<>'' THEN canonical_hash ELSE content_hash END AS content_hash,lifecycle,host_visibility,ordinal FROM messages
        WHERE chat_id=? AND memory_excluded=0 AND message_id IN (${ids.map(() => "?").join(",")})
        ORDER BY ordinal
      `).all(block.chat_id, ...ids) as MessageRow[];
      if (messages.length !== ids.length || messages.some((message) => message.host_visibility !== undefined && message.host_visibility !== "active") || transcriptBlockHash(messages) !== block.content_hash) {
        this.db.prepare("UPDATE embedding_blocks SET status='stale',updated_at=? WHERE id=?").run(now(), block.id);
        continue;
      }
      const chunks = chunkTranscript(messages);
      if (chunks.length === 0) continue;
      this.db.prepare("UPDATE embedding_blocks SET attempts=attempts+1,updated_at=? WHERE id=?").run(now(), block.id);
      try {
        const vectors = (await this.#request([chunks.map((chunk) => chunk.text)], "document"))[0]!;
        const oldRows = this.db.prepare("SELECT rowid FROM embedding_items WHERE block_id=?").all(block.id) as Array<{ rowid: number }>;
        this.#deleteRows(oldRows.map((row) => row.rowid));
        chunks.forEach((chunk, index) => this.#storeItem({
          itemId: `chunk:${block.id}:${index}`, chatId: block.chat_id, kind: "transcript_chunk", sourceId: block.id,
          blockId: block.id, sourceIds: chunk.messageIds, sourceRanges: chunk.ranges, content: chunk.text, contentHash: sha256(chunk.text), vector: vectors[index]!,
        }));
        this.db.prepare("UPDATE embedding_blocks SET status='indexed',chunk_count=?,last_error=NULL,updated_at=? WHERE id=?").run(
          chunks.length, now(), block.id,
        );
        indexed += chunks.length;
      } catch (error) {
        const attempts = block.attempts + 1;
        const status = attempts >= MAX_BLOCK_ATTEMPTS ? "failed" : "queued";
        const message = error instanceof Error ? error.message : String(error);
        this.db.prepare("UPDATE embedding_blocks SET status=?,last_error=?,updated_at=? WHERE id=?").run(status, message.slice(0, 1000), now(), block.id);
        this.#recordFailure(error, "index");
        break;
      }
    }
    return { selected: blocks.length, indexed };
  }

  indexPending(chatId?: string): Promise<number> {
    if (!this.ready || Date.now() < this.#indexRetryAfter) return Promise.resolve(0);
    const run = async () => {
      if (Date.now() < this.#indexRetryAfter) return 0;
      this.#requeueRowIdCollisionBlocks(chatId);
      this.#discardStaleBlocks(chatId);
      this.#removeInactiveMemoryItems(chatId);
      const memories = await this.#indexMemories(chatId);
      if (Date.now() < this.#indexRetryAfter) return memories;
      const details = await this.#indexContextualDetails(chatId);
      if (Date.now() < this.#indexRetryAfter) return memories + details;
      const spine = await this.#indexStorySpine(chatId);
      let blocks = 0;
      for (let page = 0; page < MAX_BLOCK_PAGES; page += 1) {
        if (Date.now() < this.#indexRetryAfter) break;
        const result = await this.#indexBlocks(chatId);
        blocks += result.indexed;
        if (result.selected < BLOCK_PAGE_SIZE || result.indexed === 0) break;
      }
      if (Date.now() < this.#indexRetryAfter) return memories + details + spine + blocks;
      let states = 0;
      const chats = chatId ? [{id:chatId}] : this.db.prepare("SELECT id FROM chats").all() as {id:string}[];
      for (const chat of chats) states += await this.stateIndex.index(chat.id, async texts => (await this.#request(texts.map(text => [text]), "document")).map(group => group[0]!));
      this.#indexError = "";
      return memories + details + spine + blocks + states;
    };
    this.#indexQueue = this.#indexQueue.then(run, run).catch((error) => {
      this.#recordFailure(error, "index");
      return 0;
    });
    return this.#indexQueue;
  }

  removeMemory(memoryId: string): void {
    const items = this.db.prepare("SELECT rowid FROM embedding_items WHERE item_id=? OR (kind='memory_detail' AND source_json LIKE ?)").all(`memory:${memoryId}`, `%${memoryId}%`) as Array<{ rowid: number }>;
    this.#deleteRows(items.map((item) => item.rowid));
    this.db.prepare("DELETE FROM embedding_failures WHERE item_id=?").run(`memory:${memoryId}`);
  }

  removeChat(chatId: string): void {
    const rows = this.db.prepare("SELECT rowid FROM embedding_items WHERE chat_id=?").all(chatId) as Array<{ rowid: number }>;
    this.#deleteRows(rows.map((row) => row.rowid));
    this.db.prepare("DELETE FROM embedding_failures WHERE chat_id=?").run(chatId);
    this.db.prepare("DELETE FROM embedding_blocks WHERE chat_id=?").run(chatId);
  }

  async #queryVectors(queries: string[], chatId: string): Promise<Array<number[] | null>> {
    const result: Array<number[] | null> = Array(queries.length).fill(null);
    const missingByKey = new Map<string, { query: string; indexes: number[] }>();
    const timestamp = Date.now();
    queries.forEach((query, index) => {
      const key = sha256(`${this.model}\0${chatId}\0${query}`);
      const cached = this.#queryCache.get(key);
      if (cached && cached.expiresAt > timestamp) result[index] = cached.vector;
      else {
        const pending = missingByKey.get(key);
        if (pending) pending.indexes.push(index);
        else missingByKey.set(key, { query, indexes: [index] });
      }
    });
    const missing = [...missingByKey.entries()].map(([key, value]) => ({ key, ...value }));
    if (missing.length === 0 || Date.now() < this.#queryRetryAfter) return result;
    try {
      const vectors = await this.#request(missing.map((item) => [item.query.slice(0, 32_000)]), "query");
      missing.forEach((item, localIndex) => {
        const vector = vectors[localIndex]?.[0] ?? null;
        item.indexes.forEach((index) => { result[index] = vector; });
        if (vector) this.#queryCache.set(item.key, { vector, expiresAt: Date.now() + QUERY_CACHE_TTL });
      });
      while (this.#queryCache.size > MAX_QUERY_CACHE) this.#queryCache.delete(this.#queryCache.keys().next().value!);
      return result;
    } catch (error) {
      this.#recordFailure(error, "query");
      return result;
    }
  }

  #searchVector(vector: number[], chatId: string, total: number, limit: number): SemanticSearchResult {
    try {
      const stateScores = this.stateIndex.search(chatId, vector);
      const searchUnavailable = !this.stateIndex.status.available || this.stateIndex.status.indexed < this.stateIndex.status.canonical;
      if (total === 0) return { stateScores, searchUnavailable, scores: new Map(), hits: new Map() };
      const k = Math.min(total, Math.max(80, limit * 8));
      const rawRows = this.db.prepare(`
        SELECT rowid,distance FROM embedding_vectors_v4_chat
        WHERE embedding MATCH ? AND k=? AND chat_id=? ORDER BY distance
      `).all(JSON.stringify(vector), k, chatId) as Array<{ rowid: number | bigint; distance: number }>;
      const rows = rawRows.map((row) => ({ rowid: Number(row.rowid), distance: row.distance }));
      if (rows.length === 0) return { stateScores, searchUnavailable, scores: new Map(), hits: new Map(), storyScores: new Map(), storyHits: new Map() };
      const distances = new Map(rows.map((row) => [row.rowid, row.distance]));
      const mapped = this.db.prepare(`
        SELECT rowid,item_id,kind,source_id,source_json FROM embedding_items
        WHERE chat_id=? AND rowid IN (${rows.map(() => "?").join(",")})
      `).all(chatId, ...rows.map((row) => row.rowid)) as Array<{
        rowid: number; item_id: string; kind: "memory" | "memory_detail" | "transcript_chunk" | "story_segment" | "story_arc" | "story_overview"; source_id: string; source_json: string;
      }>;
      const scores = new Map<string, number>();
      const hits = new Map<string, SemanticMemoryHit>();
      const atomHits = new Map<string, SemanticMemoryHit[]>();
      const sourceHits: SemanticSourceHit[] = [];
      const storyScores = new Map<string, number>();
      const storyHits = new Map<string, SemanticStoryHit>();
      const record = (memoryId: string, score: number, kind: SemanticMemoryHit["kind"], sourceId: string): void => {
        atomHits.set(memoryId, [...(atomHits.get(memoryId) ?? []), { memoryId, score, kind, sourceId }]);
        scores.set(memoryId, Math.max(scores.get(memoryId) ?? 0, score));
        if (score > (hits.get(memoryId)?.score ?? -1)) hits.set(memoryId, { memoryId, score, kind, sourceId });
      };
      for (const item of mapped) {
        const score = Math.max(0, 1 - (distances.get(item.rowid) ?? 2) / 2);
        if (item.kind.startsWith("story_")) {
          const searchId = item.kind === "story_segment" ? item.item_id : item.source_id;
          storyScores.set(searchId, Math.max(storyScores.get(searchId) ?? 0, score));
          if (score > (storyHits.get(item.source_id)?.score ?? -1)) storyHits.set(item.source_id, { nodeId: item.source_id, score, kind: item.kind as SemanticStoryHit["kind"] });
          continue;
        }
        if (item.kind === "memory") {
          record(item.source_id, score, item.kind as "memory", item.source_id);
          continue;
        }
        if (item.kind === "memory_detail") {
          const memoryId = (JSON.parse(item.source_json) as string[])[0];
          if (memoryId) record(memoryId, score * 1.05, item.kind, item.source_id);
          continue;
        }
        const { messageIds } = JSON.parse(item.source_json) as { messageIds: string[] };
        if (messageIds.length === 0 || this.db.prepare(`SELECT 1 FROM messages WHERE chat_id=? AND memory_excluded=1
          AND message_id IN (SELECT value FROM json_each(?)) LIMIT 1`).get(chatId,JSON.stringify(messageIds))) continue;
        sourceHits.push({ chunkId: item.item_id, messageIds, score });
        const evidence = this.db.prepare(`
          SELECT DISTINCT memory_id FROM evidence_spans
          WHERE chat_id=? AND memory_id IS NOT NULL AND message_id IN (${messageIds.map(() => "?").join(",")})
        `).all(chatId, ...messageIds) as Array<{ memory_id: string }>;
        for (const row of evidence) record(row.memory_id, score * 0.9, "transcript_chunk", item.source_id);
      }
      const limited = new Map([...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit));
      const limitedStory = new Map([...storyScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.min(24, limit)));
      return { stateScores, searchUnavailable, atomHits, sourceHits, scores: limited, hits: new Map([...hits].filter(([memoryId]) => limited.has(memoryId))), storyScores: limitedStory, storyHits: new Map([...storyHits].filter(([nodeId]) => limitedStory.has(nodeId))) };
    } catch (error) {
      this.#recordFailure(error, "query");
      return { scores: new Map(), hits: new Map(), storyScores: new Map(), storyHits: new Map() };
    }
  }

  async searchManyDetailed(signals: SearchQuerySignal[], chatId: string, limit = 80): Promise<SemanticSearchResult> {
    if (!this.ready || signals.length === 0) return { scores: new Map(), hits: new Map(), storyScores: new Map(), storyHits: new Map() };
    this.#discardStaleBlocks(chatId);
    const total = (this.db.prepare("SELECT count(*) AS count FROM embedding_items WHERE chat_id=?").get(chatId) as { count: number }).count;
    const searchable = signals.map((signal, index) => ({ signal, index }))
      .filter(({ signal }) => signal.kind !== "continuation" && signal.weight > 0);
    if (searchable.length === 0) return { scores: new Map(), hits: new Map(), viewScores: signals.map(() => new Map()), storyScores: new Map(), storyHits: new Map() };
    const searchedVectors = await this.#queryVectors(searchable.map(({ signal }) => signal.text), chatId);
    const vectors = new Map(searchable.map((entry, index) => [entry.index, searchedVectors[index]]));
    const results = new Map(searchable.flatMap(({ index }) => {
      const vector = vectors.get(index);
      return vector ? [[index, this.#searchVector(vector, chatId, total, limit)] as const] : [];
    }));
    const separation = (result: SemanticSearchResult): number => {
      const window = [...result.scores.values()].slice(0, 24);
      return window.length > 1 ? window[0]! - window.at(-1)! : 0;
    };
    const focusSeparation = Math.max(0, ...searchable.flatMap(({ signal, index }) =>
      signal.kind === "focus" && results.has(index) ? [separation(results.get(index)!)] : []));
    const stateScores = new Map<string, number>();
    const peak = new Map<string, number>();
    const consensus = new Map<string, number>();
    const hits = new Map<string, SemanticMemoryHit>();
    const atomHits = new Map<string, SemanticMemoryHit[]>();
    const sourceHits: SemanticSourceHit[] = [];
    const storyPeak = new Map<string, number>();
    const storyConsensus = new Map<string, number>();
    const storyHits = new Map<string, SemanticStoryHit>();
    const viewScores: Array<Map<string, number>> = [];
    let semanticScale = 0;
    const totalWeight = Math.max(0.0001, searchable.reduce((sum, { signal }) => sum + Math.max(0, signal.weight), 0));
    const maximumWeight = Math.max(0, ...searchable.map(({ signal }) => signal.weight));
    signals.forEach((signal, index) => {
      const result = results.get(index);
      if (!result) { viewScores.push(new Map()); return; }
      // A vague cue can rank something first even when every memory is nearly
      // equally unrelated. Compare its separation with the full input before
      // normalization erases that ambiguity. No language/word-length gate.
      const cueReliability = signal.kind === "cue" && focusSeparation > 0
        ? Math.min(1, separation(result) / focusSeparation) : 1;
      for (const [id, score] of result.stateScores ?? []) stateScores.set(id, Math.max(stateScores.get(id) ?? 0, score * signal.weight));
      for (const [memoryId, entries] of result.atomHits ?? []) {
        atomHits.set(memoryId, [...(atomHits.get(memoryId) ?? []), ...entries.map((hit) => ({ ...hit, viewIndex: index }))]);
      }
      sourceHits.push(...(result.sourceHits ?? []).map((hit) => ({ ...hit, viewIndex: index })));
      const ranked = [...result.scores.entries()];
      viewScores.push(new Map([...result.scores].map(([id, score]) => [id, score * cueReliability])));
      if (ranked.length === 0) return;
      semanticScale = Math.max(semanticScale, ranked[0]![1]);
      // Raw embedding similarities have a large shared baseline. Adding them
      // across query views rewards memories that are merely acceptable for
      // every paragraph and can bury the exact result that tops one concrete
      // cue. Fuse each view by its local rank and separation from the tail.
      const fusionWindow = ranked.slice(0, Math.min(24, ranked.length));
      const top = fusionWindow[0]![1];
      const floor = fusionWindow.at(-1)![1];
      const viewReliability = (signal.kind === "scene" ? 0.82 : signal.kind === "cue" ? 1 : 0.94)
        * queryViewAuthority(signal.weight, maximumWeight);
      fusionWindow.forEach(([memoryId, score], rank) => {
        const separated = top > floor ? Math.max(0, Math.min(1, (score - floor) / (top - floor))) : 0;
        const rankEvidence = 1 / (1 + rank * 0.22);
        const evidence = separated * 0.72 + rankEvidence * 0.28;
        peak.set(memoryId, Math.max(peak.get(memoryId) ?? 0, evidence * viewReliability * cueReliability));
        consensus.set(memoryId, (consensus.get(memoryId) ?? 0) + evidence * Math.max(0, signal.weight) * cueReliability);
      });
      for (const [memoryId, hit] of result.hits) {
        if (!peak.has(memoryId)) continue;
        if (hit.score > (hits.get(memoryId)?.score ?? -1)) hits.set(memoryId, hit);
      }
      const storyRanked = [...(result.storyScores ?? new Map()).entries()];
      if (storyRanked.length) {
        const storyTop = storyRanked[0]![1];
        const storyFloor = storyRanked.at(-1)![1];
        storyRanked.slice(0, 16).forEach(([nodeId, score], rank) => {
          const separated = storyTop > storyFloor ? Math.max(0, Math.min(1, (score - storyFloor) / (storyTop - storyFloor))) : 0;
          const evidence = separated * 0.72 + (1 / (1 + rank * 0.22)) * 0.28;
          storyPeak.set(nodeId, Math.max(storyPeak.get(nodeId) ?? 0, evidence * viewReliability));
          storyConsensus.set(nodeId, (storyConsensus.get(nodeId) ?? 0) + evidence * Math.max(0, signal.weight));
        });
        for (const [nodeId, hit] of result.storyHits ?? []) if (hit.score > (storyHits.get(nodeId)?.score ?? -1)) storyHits.set(nodeId, hit);
      }
    });
    const fused = new Map<string, number>();
    for (const memoryId of new Set([...peak.keys(), ...consensus.keys()])) {
      fused.set(memoryId, (peak.get(memoryId) ?? 0) * 0.72 + ((consensus.get(memoryId) ?? 0) / totalWeight) * 0.28);
    }
    const bestFusion = Math.max(0, ...fused.values());
    const scores = new Map([...fused.entries()]
      .map(([memoryId, score]) => [memoryId, bestFusion > 0 ? score / bestFusion * semanticScale : 0] as const)
      .sort((a, b) => b[1] - a[1]).slice(0, limit));
    const storyFused = new Map<string, number>();
    for (const nodeId of new Set([...storyPeak.keys(), ...storyConsensus.keys()])) storyFused.set(nodeId, (storyPeak.get(nodeId) ?? 0) * 0.72 + ((storyConsensus.get(nodeId) ?? 0) / totalWeight) * 0.28);
    const storyBest = Math.max(0, ...storyFused.values());
    const storyScores = new Map([...storyFused.entries()].map(([nodeId, score]) => [nodeId, storyBest > 0 ? score / storyBest : 0] as const).sort((a, b) => b[1] - a[1]).slice(0, 24));
    return { stateScores, atomHits, sourceHits, scores, hits: new Map([...hits].filter(([memoryId]) => scores.has(memoryId))), viewScores, storyScores, storyHits: new Map([...storyHits].filter(([nodeId]) => storyScores.has(nodeId))) };
  }

  async searchMany(signals: SearchQuerySignal[], chatId: string, limit = 80): Promise<Map<string, number>> {
    return (await this.searchManyDetailed(signals, chatId, limit)).scores;
  }

  async search(query: string, chatId: string, limit = 80): Promise<Map<string, number>> {
    return this.searchMany([{ kind: "focus", text: query, weight: 1 }], chatId, limit);
  }

  async searchDetailed(query: string, chatId: string, limit = 80): Promise<SemanticSearchResult> {
    return this.searchManyDetailed([{ kind: "focus", text: query, weight: 1 }], chatId, limit);
  }

  async searchBatchDetailed(queries: string[], chatId: string, limit = 80): Promise<SemanticSearchResult[]> {
    if (!this.ready || queries.length === 0) return queries.map(() => ({ searchUnavailable: true, scores: new Map(), hits: new Map(), storyScores: new Map(), storyHits: new Map() }));
    this.#discardStaleBlocks(chatId);
    const total = (this.db.prepare("SELECT count(*) AS count FROM embedding_items WHERE chat_id=?").get(chatId) as { count: number }).count;
    const vectors = await this.#queryVectors(queries, chatId);
    return queries.map((_query, index) => vectors[index] ? this.#searchVector(vectors[index]!, chatId, total, limit) : { searchUnavailable: true, scores: new Map(), hits: new Map(), storyScores: new Map(), storyHits: new Map() });
  }
}
