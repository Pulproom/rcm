import { createHash } from "node:crypto";
import type { RcmDatabase } from "./db.js";

export const MEMORY_REF_SEQUENCE_PREFIX = "memory_ref_sequence:";

export function memoryReferenceHighWater(db: RcmDatabase): Map<string, bigint> {
  if (db.prepare("SELECT 1 FROM server_meta WHERE key='memory_ref_sequence'").get()) {
    throw new Error("Global memory reference counters require an explicit offline conversion before using per-chat references");
  }
  return new Map((db.prepare("SELECT key,value FROM server_meta WHERE key GLOB 'memory_ref_sequence:*'").all() as Array<{key:string;value:string}>)
    .map(row => [row.key, BigInt(row.value)]));
}

/** Delivered addresses persist per chat. Request scopes only protect in-flight
 * assembly; resolving an address never grants access or searches for a substitute. */
export class MemoryReferences {
  private scopes = new Map<string, { generation: string; revision: number; issued: Map<string, { id: string; version: string }> }>();
  constructor(private db: RcmDatabase) { memoryReferenceHighWater(db); }
  private revision(chatId: string): number {
    return (this.db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined)?.revision ?? -1;
  }
  version(chatId: string, id: string): string | undefined {
    const memory = this.db.prepare("SELECT * FROM memories WHERE chat_id=? AND id=? AND active=1").get(chatId, id);
    if (!memory) return;
    const details = this.db.prepare("SELECT * FROM memory_details WHERE chat_id=? AND memory_id=? ORDER BY id").all(chatId, id);
    const dialogues = this.db.prepare("SELECT * FROM memory_dialogues WHERE chat_id=? AND memory_id=? ORDER BY id").all(chatId, id);
    const access = this.db.prepare(`SELECT * FROM item_access WHERE chat_id=? AND (item_id=? OR item_id IN
      (SELECT id FROM memory_details WHERE memory_id=?) OR item_id IN (SELECT id FROM memory_dialogues WHERE memory_id=?)) ORDER BY id`).all(chatId, id, id, id);
    return createHash("sha256").update(JSON.stringify([this.revision(chatId), memory, details, dialogues, access])).digest("hex");
  }
  begin(chatId: string, generation: string): void {
    this.scopes.delete(chatId);
    this.scopes.set(chatId, { generation, revision: this.revision(chatId), issued: new Map() });
    while (this.scopes.size > 128) this.scopes.delete(this.scopes.keys().next().value!);
  }
  ensure(chatId: string, generation: string): boolean {
    if (!this.scopes.has(chatId)) this.begin(chatId, generation);
    return this.current(chatId, generation);
  }
  current(chatId: string, generation: string): boolean {
    const scope = this.scopes.get(chatId);
    return scope?.generation === generation && scope.revision === this.revision(chatId);
  }
  issue(chatId: string, generation: string, id: string, delivered = true): string | undefined {
    if (!this.current(chatId, generation)) return;
    const scope = this.scopes.get(chatId)!;
    const version = this.version(chatId, id);
    if (!version) return;
    const existing = this.db.prepare("SELECT ref FROM memory_references WHERE chat_id=? AND memory_id=?").get(chatId, id) as { ref: string } | undefined;
    if (existing) return existing.ref;
    for (const [ref, target] of scope.issued) if (target.id === id && target.version === version) {
      if (delivered) this.deliver(chatId, generation, [ref]);
      return ref;
    }
    if (scope.issued.size >= 512) return;
    // Persist the high-water mark independently of request registries. A stale
    // model-visible address must never acquire a different target after restart.
    const sequence = this.db.transaction(() => {
      const key = MEMORY_REF_SEQUENCE_PREFIX + chatId;
      const row = this.db.prepare("SELECT value FROM server_meta WHERE key=?").get(key) as { value: string } | undefined;
      const next = BigInt(row?.value ?? "0") + 1n;
      this.db.prepare("INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(next));
      return next;
    })();
    const ref = `m${sequence}`;
    scope.issued.set(ref, { id, version });
    if (delivered) this.deliver(chatId, generation, [ref]);
    return ref;
  }
  deliver(chatId: string, generation: string, refs: string[]): void {
    if (!this.current(chatId, generation)) return;
    for (const ref of refs) {
      const entry = this.scopes.get(chatId)!.issued.get(ref);
      if (!entry || entry.version !== this.version(chatId, entry.id)) continue;
      this.db.prepare("INSERT OR IGNORE INTO memory_references(chat_id,ref,memory_id) VALUES(?,?,?)").run(chatId, ref, entry.id);
    }
  }
  resolve(chatId: string, ref: string): string | undefined {
    return (this.db.prepare(`SELECT r.memory_id FROM memory_references r JOIN memories m
      ON m.chat_id=r.chat_id AND m.id=r.memory_id AND m.active=1 WHERE r.chat_id=? AND r.ref=?`)
      .get(chatId, ref) as { memory_id: string } | undefined)?.memory_id;
  }
}
