import { createHash } from "node:crypto";
import { buildSourceUnits, segmentSentences, sourceRangeIsVisible } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { upgradeLockSql } from "./upgrade-lock.js";

// Canonical evidence only. Jobs, extraction/audit/reconciliation drafts, batch
// replay snapshots, diagnostics and revision bodies remain historical inputs.
const evidenceColumns: Record<string, string[]> = {
  memories: ["evidence_json"], memory_details: ["evidence_json", "seed_json"],
  memory_dialogues: ["evidence_json"], episode_sections: ["evidence_json", "key_dialogues_json"],
  memory_recall_events: ["evidence_json"], assertions: ["evidence_json", "automatic_closure_evidence_json"],
  beliefs: ["evidence_json", "automatic_closure_evidence_json"], item_access: ["evidence_json"],
  social_knowledge_events: ["evidence_json"], promise_events: ["evidence_json"],
  atom_relations: ["evidence_json"], relationship_baselines: ["evidence_json"],
  relationship_events: ["evidence_json"], physical_intimacy_milestones: ["evidence_json"],
  source_passages: ["access_json"],
};
type Evidence = Record<string, unknown>;
type Bounds = { start: number; end: number; cuts: number[] };
type Source = { content: string; hash: string; units: Bounds[] };
type Counts = { extended: number; merged: number; rows: number };
export interface AbbreviationRepairResult extends Counts { byChat: Record<string, Counts> }

/** Coalesce independently cited fragments; never infer evidence from typography.
 * No model calls, source edits or memory deletion.
 * Hashless legacy quotes require a unique exact current-source occurrence.
 * Supplied hashes/offsets must match; ambiguous, hidden and stale spans stay put.
 */
export function repairAbbreviationEvidence(db: RcmDatabase, onlyChatId?: string): AbbreviationRepairResult {
  const result: AbbreviationRepairResult = { extended: 0, merged: 0, rows: 0, byChat: {} };
  db.transaction(() => {
    const chats = db.prepare(`SELECT c.id FROM chats c WHERE (? IS NULL OR c.id=?)
      AND NOT ${upgradeLockSql("c.id")}
      AND NOT EXISTS (SELECT 1 FROM regeneration_runs u WHERE u.mode='upgrade' AND u.shadow_chat_id=c.id)`)
      .all(onlyChatId ?? null, onlyChatId ?? null) as Array<{ id: string }>;
    for (const { id: chatId } of chats) {
      const counts: Counts = { extended: 0, merged: 0, rows: 0 };
      const sources = new Map<string, Source | undefined>();
      const source = (id: string): Source | undefined => {
        if (sources.has(id)) return sources.get(id);
        const row = db.prepare(`SELECT canonical_content,canonical_hash,role FROM messages WHERE chat_id=? AND message_id=?
          AND lifecycle IN ('committed','client_pruned') AND memory_excluded=0 AND host_visibility IN ('active','all_before')`)
          .get(chatId, id) as { canonical_content: string | null; canonical_hash: string; role: string } | undefined;
        let value: Source | undefined;
        if (row?.canonical_content && row.canonical_hash === createHash("sha256").update(`${row.role}\0${row.canonical_content}`).digest("hex")) {
          value = { content: row.canonical_content, hash: row.canonical_hash,
            units: buildSourceUnits([{ id, content: row.canonical_content, canonicalHash: row.canonical_hash }]).flatMap(unit =>
              segmentSentences(unit.text).flatMap(sentence => sentence.suppressedEnds.length ? [{
                start: unit.start + sentence.index, end: unit.start + sentence.index + sentence.segment.trimEnd().length,
                cuts: sentence.suppressedEnds.map(end => unit.start + end),
              }] : [])) };
        }
        sources.set(id, value); return value;
      };
      const locate = (item: Evidence) => {
        if (typeof item.messageId !== "string" || typeof item.quote !== "string" || !item.quote) return;
        const current = source(item.messageId);
        if (!current || item.canonicalHash !== undefined && item.canonicalHash !== current.hash
          || item.transitionCanonicalHash !== undefined && item.transitionCanonicalHash !== current.hash) return;
        const start = item.startOffset === undefined ? current.content.indexOf(item.quote) : item.startOffset;
        if (typeof start !== "number" || !Number.isInteger(start) || start < 0) return;
        const end = start + item.quote.length;
        if (!sourceRangeIsVisible(current.content, start, end) || current.content.slice(start, end) !== item.quote || item.endOffset !== undefined && item.endOffset !== end
          || item.startOffset === undefined && current.content.indexOf(item.quote, start + 1) >= 0) return;
        return { current, start, end };
      };
      const replace = (item: Evidence, start: number, end: number, current: Source): Evidence => ({ ...item,
        quote: current.content.slice(start, end),
        ...(item.startOffset !== undefined ? { startOffset: start } : {}),
        ...(item.endOffset !== undefined ? { endOffset: end } : {}),
      });
      const metadata = ({ quote, startOffset, endOffset, canonicalHash, ...rest }: Evidence) => JSON.stringify(rest);
      const list = (items: unknown[]): { values: unknown[]; removed: number[] } => {
        const entries = items.map((item, index) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return { item, index };
          const located = locate(item as Evidence);
          const unit = located?.current.units.find(unit => unit.cuts.includes(located.end));
          if (!located || !unit) return { item, index };
          // A suppressed ICU boundary is only a grouping hint. It cannot prove
          // that the following text shares this evidence's attribution/access.
          return { item, index, unit, located };
        });
        const removed = new Set<number>();
        for (const entry of entries) {
          if (!entry.located || !entry.unit || removed.has(entry.index)) continue;
          let span = locate(entry.item as Evidence)!;
          for (const sibling of entries) {
            if (sibling === entry || removed.has(sibling.index) || !sibling.item || typeof sibling.item !== "object" || Array.isArray(sibling.item)
              || metadata(sibling.item as Evidence) !== metadata(entry.item as Evidence)) continue;
            const other = locate(sibling.item as Evidence);
            if (!other || other.current !== span.current || other.start < entry.unit.start || other.end > entry.unit.end) continue;
            const gap = span.current.content.slice(Math.min(span.end, other.end), Math.max(span.start, other.start));
            if (Math.max(span.start, other.start) > Math.min(span.end, other.end) && !/^\s*$/u.test(gap)) continue;
            if (other.start < span.start || other.end > span.end) counts.extended++;
            entry.item = replace(entry.item as Evidence, Math.min(span.start, other.start), Math.max(span.end, other.end), span.current);
            span = locate(entry.item as Evidence)!;
            removed.add(sibling.index); counts.merged++;
          }
        }
        return { values: entries.filter(entry => !removed.has(entry.index)).map(entry => entry.item), removed: [...removed] };
      };
      const walk = (value: unknown): unknown => {
        if (Array.isArray(value)) return list(value.map(walk)).values;
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
      };
      for (const [table, columns] of Object.entries(evidenceColumns)) {
        const hasQuote = ["relationship_baselines", "physical_intimacy_milestones"].includes(table);
        const rows = db.prepare(`SELECT id,${columns.join(",")}${hasQuote ? ",source_quote" : ""} FROM ${table} WHERE chat_id=?`).all(chatId) as Array<Record<string, string | null>>;
        for (const row of rows) {
          const changes: Record<string, string> = {};
          for (const column of columns) {
            if (!row[column]) continue;
            const before = JSON.parse(row[column]!);
            const after = walk(before);
            if (JSON.stringify(before) === JSON.stringify(after)) continue;
            changes[column] = JSON.stringify(after);
            // These are display mirrors of a cited quote, never free text to infer.
            if (hasQuote && column === "evidence_json" && row.source_quote && Array.isArray(before) && Array.isArray(after)) {
              const matches = before.filter(item => item.quote === row.source_quote).flatMap(item => {
                const located = locate(item);
                return located ? after.filter(candidate => {
                  const merged = locate(candidate);
                  return merged && metadata(candidate) === metadata(item) && merged.current === located.current
                    && merged.start <= located.start && merged.end >= located.end;
                }).map(candidate => candidate.quote as string) : [];
              });
              if (new Set(matches).size === 1) changes.source_quote = matches[0]!;
            }
          }
          if (!Object.keys(changes).length) continue;
          db.prepare(`UPDATE ${table} SET ${Object.keys(changes).map(key => `${key}=?`).join(",")} WHERE id=?`)
            .run(...Object.values(changes), row.id);
          counts.rows++;
        }
      }
      // Legacy memory quote index has no offsets/hash. Group only siblings of
      // the same parent; unrelated memories and NULL-parent rows never coalesce.
      const spans = db.prepare("SELECT id,memory_id,message_id,quote FROM evidence_spans WHERE chat_id=? AND quote IS NOT NULL").all(chatId) as Array<{ id: string; memory_id: string | null; message_id: string; quote: string }>;
      const groups = new Map<string, typeof spans>();
      for (const row of spans) { const key = row.memory_id === null ? `span:${row.id}` : `memory:${row.memory_id}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
      for (const rows of groups.values()) {
        const before = rows.map(row => ({ messageId: row.message_id, quote: row.quote }));
        const repaired = list(before);
        let next = 0;
        rows.forEach((row, index) => {
          if (repaired.removed.includes(index)) { db.prepare("DELETE FROM evidence_spans WHERE id=?").run(row.id); counts.rows++; return; }
          const after = repaired.values[next++] as Evidence;
          if (after.quote !== row.quote) { db.prepare("UPDATE evidence_spans SET quote=? WHERE id=?").run(after.quote, row.id); counts.rows++; }
        });
      }
      // Fuse passage rows only when their complete access/epistemic metadata
      // agrees. Keep the surviving ID; no references or knowledge scopes change.
      const passages = db.prepare("SELECT * FROM source_passages WHERE chat_id=?").all(chatId) as Array<Record<string, any>>;
      const passageItems = passages.map(row => ({ messageId: row.message_id, canonicalHash: row.canonical_hash,
        startOffset: row.start_offset, endOffset: row.end_offset, quote: row.quote,
        speaker: row.speaker, epistemic: row.epistemic, access: row.access_json, batch: row.source_batch_id, active: row.active }));
      const repaired = list(passageItems);
      let next = 0;
      passages.forEach((row, index) => {
        if (repaired.removed.includes(index)) { db.prepare("DELETE FROM source_passages WHERE id=?").run(row.id); counts.rows++; return; }
        const after = repaired.values[next++] as Evidence;
        if (after.quote === row.quote && after.startOffset === row.start_offset && after.endOffset === row.end_offset) return;
        db.prepare("UPDATE source_passages SET start_offset=?,end_offset=?,quote=? WHERE id=?").run(after.startOffset, after.endOffset, after.quote, row.id);
        counts.rows++;
      });
      if (counts.rows) result.byChat[chatId] = counts;
      result.extended += counts.extended; result.merged += counts.merged; result.rows += counts.rows;
    }
  })();
  if (result.rows) console.info(`[RCM] abbreviation evidence repair extended=${result.extended} merged=${result.merged} rows=${result.rows} chats=${Object.keys(result.byChat).length}`);
  return result;
}
