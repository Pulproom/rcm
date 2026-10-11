import { createHash } from "node:crypto";
import type { RcmDatabase } from "./db.js";

/** Addresses are issued only for delivered memories. A new generation, source
 * revision, or target mutation invalidates them; lookup never searches. */
export class MemoryReferences {
  private scopes = new Map<string, { generation: string; revision: number; issued: Map<string, { id: string; version: string; delivered: boolean }> }>();
  constructor(private db: RcmDatabase) {}
  private revision(chatId: string): number {
    return (this.db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined)?.revision ?? -1;
  }
  private version(chatId: string, id: string): string | undefined {
    const memory = this.db.prepare("SELECT * FROM memories WHERE chat_id=? AND id=? AND active=1").get(chatId, id);
    if (!memory) return;
    const details = this.db.prepare("SELECT * FROM memory_details WHERE chat_id=? AND memory_id=? ORDER BY id").all(chatId, id);
    const dialogues = this.db.prepare("SELECT * FROM memory_dialogues WHERE chat_id=? AND memory_id=? ORDER BY id").all(chatId, id);
    const access = this.db.prepare(`SELECT * FROM item_access WHERE chat_id=? AND (item_id=? OR item_id IN
      (SELECT id FROM memory_details WHERE memory_id=?) OR item_id IN (SELECT id FROM memory_dialogues WHERE memory_id=?)) ORDER BY id`).all(chatId, id, id, id);
    return createHash("sha256").update(JSON.stringify([memory, details, dialogues, access])).digest("hex");
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
    for (const [ref, target] of scope.issued) if (target.id === id && target.version === version) { target.delivered ||= delivered; return ref; }
    if (scope.issued.size >= 512) return;
    // Persist the high-water mark independently of request registries. A stale
    // model-visible address must never acquire a different target after restart.
    const sequence = this.db.transaction(() => {
      const row = this.db.prepare("SELECT value FROM server_meta WHERE key='memory_ref_sequence'").get() as { value: string } | undefined;
      const next = BigInt(row?.value ?? "0") + 1n;
      this.db.prepare("INSERT INTO server_meta(key,value) VALUES('memory_ref_sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(next));
      return next;
    })();
    const ref = `m${sequence}`;
    scope.issued.set(ref, { id, version, delivered });
    return ref;
  }
  deliver(chatId: string, generation: string, refs: string[]): void {
    if (!this.current(chatId, generation)) return;
    for (const ref of refs) { const entry = this.scopes.get(chatId)!.issued.get(ref); if (entry) entry.delivered = true; }
  }
  resolve(chatId: string, generation: string, ref: string): string | undefined {
    if (!this.current(chatId, generation)) return;
    const target = this.scopes.get(chatId)!.issued.get(ref);
    return target?.delivered && this.version(chatId, target.id) === target.version ? target.id : undefined;
  }
}
