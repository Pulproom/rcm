import { createHash, randomUUID } from "node:crypto";
import type { ExtractedAtomRelation, ExtractionResult, ItemAccessGrant } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { loadItemAccess, resolveItemAccess, visibleTo } from "./item-access.js";

/** Internal lease snapshot; only atomRef and its snippet enter the model prompt. */
export interface RecallAtomReference { atomRef: string; detailId: string; fingerprint: string }
export interface AtomRelationContext { sourceMessageIds: string[]; atomRefs: RecallAtomReference[] }
interface DetailRow {
  id: string; memory_id: string; kind: string; text: string; epistemic: string; evidence_json: string;
}
interface SourceRow { message_id: string; canonical_content: string; ordinal: number }
interface Span { messageId: string; start: number; end: number; ordinal: number }

export function atomFingerprint(detail: Pick<DetailRow, "kind" | "text" | "epistemic" | "evidence_json">): string {
  return createHash("sha256").update(JSON.stringify([detail.kind, detail.text, detail.epistemic, detail.evidence_json])).digest("hex");
}

/** A repeated quote cannot identify which occurrence links two atoms. */
function exactSpans(evidence: Array<{ messageId: string; quote?: string }>, sources: Map<string, SourceRow>): Span[] | undefined {
  if (!evidence.length) return undefined;
  const spans: Span[] = [];
  for (const item of evidence) {
    const source = sources.get(item.messageId);
    if (!source || !item.quote?.trim()) return undefined;
    const start = source.canonical_content.indexOf(item.quote);
    if (start < 0 || source.canonical_content.indexOf(item.quote, start + 1) >= 0) return undefined;
    spans.push({ messageId: item.messageId, start, end: start + item.quote.length, ordinal: source.ordinal });
  }
  return spans;
}
const overlaps = (a: Span[], b: Span[]): boolean => a.some(left => b.some(right =>
  left.messageId === right.messageId && left.start < right.end && right.start < left.end));

/** Called inside ingestion's transaction, after all batch details and grants exist.
 * Invalid optional links are reported without discarding their valid memories.
 * Semantic relation correctness is an extraction/audit responsibility; this
 * function verifies exact provenance, endpoint identity, time and access.
 */
export function storeAtomRelations(
  db: RcmDatabase, chatId: string, result: ExtractionResult, memoryByKey: Map<string, string>,
  context: AtomRelationContext | undefined, sourceBatchId: string | undefined,
  replaceAccess: (kind: string, id: string, grants: ItemAccessGrant[]) => void,
): string[] {
  const relations = result.atomRelations ?? [];
  if (!relations.length) return [];
  if (!context) return ["atomRelations: missing extraction source context; optional relations omitted"];
  const warnings: string[] = [];
  const currentIds = new Set(context.sourceMessageIds);
  const referenceByName = new Map(context.atomRefs.map(ref => [ref.atomRef, ref]));
  const details = new Map<string, DetailRow>();
  const currentDetails = new Set(result.memories.flatMap(memory => (memory.details ?? []).map(detail => JSON.stringify([memory.key, detail.key]))));
  const getDetail = db.prepare(`SELECT d.id,d.memory_id,d.kind,d.text,d.epistemic,d.evidence_json
    FROM memory_details d JOIN memories m ON m.id=d.memory_id AND m.chat_id=d.chat_id
    WHERE d.chat_id=? AND d.id=? AND d.active=1 AND m.active=1`);
  const resolve = (ref: ExtractedAtomRelation["target"]): DetailRow | undefined => {
    let id: string | undefined;
    if ("atomRef" in ref) id = referenceByName.get(ref.atomRef)?.detailId;
    else if (currentDetails.has(JSON.stringify([ref.memoryKey, ref.detailKey]))) {
      id = (db.prepare("SELECT id FROM memory_details WHERE chat_id=? AND memory_id=? AND detail_key=?")
        .get(chatId, memoryByKey.get(ref.memoryKey) ?? "", ref.detailKey) as { id: string } | undefined)?.id;
    }
    if (!id) return undefined;
    const detail = details.get(id) ?? getDetail.get(chatId, id) as DetailRow | undefined;
    if (!detail) return undefined;
    if ("atomRef" in ref && atomFingerprint(detail) !== referenceByName.get(ref.atomRef)!.fingerprint) return undefined;
    details.set(id, detail);
    return detail;
  };
  const pairs = relations.map(relation => ({ relation, source: resolve(relation.source), target: resolve(relation.target) }));
  const evidenceIds = new Set([...currentIds, ...[...details.values()].flatMap(detail =>
    (JSON.parse(detail.evidence_json) as Array<{ messageId: string }>).map(item => item.messageId))]);
  const sourceRows = db.prepare(`SELECT message_id,canonical_content,ordinal FROM messages WHERE chat_id=?
    AND message_id IN (SELECT value FROM json_each(?)) AND lifecycle IN ('committed','client_pruned')
    AND host_visibility IN ('active','all_before') AND canonical_content IS NOT NULL`)
    .all(chatId, JSON.stringify([...evidenceIds])) as SourceRow[];
  const sources = new Map(sourceRows.map(source => [source.message_id, source]));
  const currentSources = new Map(sourceRows.filter(source => currentIds.has(source.message_id)).map(source => [source.message_id, source]));
  const access = loadItemAccess(db, chatId, [...details.keys()].map(id => ({ kind: "detail", id })));
  const spansByDetail = new Map([...details.values()].map(detail => [detail.id,
    exactSpans(JSON.parse(detail.evidence_json), sources)]));
  // Reject conflicting kinds for an endpoint pair as a group, independently of input order.
  const kindsByPair = new Map<string, Set<string>>();
  const pairKey = (source: string, target: string) => JSON.stringify([source, target]);
  for (const { relation, source, target } of pairs) if (source && target) {
    const key = pairKey(source.id, target.id);
    const kinds = kindsByPair.get(key) ?? new Set<string>();
    kinds.add(relation.kind); kindsByPair.set(key, kinds);
  }
  const seen = new Set<string>();
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number }).revision;
  for (const [index, { relation, source, target }] of pairs.entries()) {
    const reject = (reason: string) => warnings.push(`atomRelations[${index}]: ${reason}; optional relation omitted`);
    if (!source || !target) { reject("endpoint unavailable or changed since extraction prompt"); continue; }
    const pair = pairKey(source.id, target.id);
    if (source.id === target.id || kindsByPair.get(pair)!.size !== 1 || seen.has(pair)) { reject("self, duplicate or conflicting relation"); continue; }
    const evidence = exactSpans(relation.evidence, currentSources);
    const sourceSpans = spansByDetail.get(source.id), targetSpans = spansByDetail.get(target.id);
    if (!evidence || !sourceSpans || !targetSpans || !overlaps(evidence, sourceSpans)
      || (!("atomRef" in relation.target) && !overlaps(evidence, targetSpans))) {
      reject("exact current evidence does not identify both required endpoints"); continue;
    }
    if (Math.max(...sourceSpans.map(span => span.ordinal)) < Math.max(...targetSpans.map(span => span.ordinal))) {
      reject("source precedes target"); continue;
    }
    const grants = relation.access.filter(grant => {
      const spans = exactSpans(grant.evidence, currentSources);
      return Boolean(spans && overlaps(spans, evidence))
        && visibleTo(resolveItemAccess(access, "detail", source.id), grant.holder)
        && visibleTo(resolveItemAccess(access, "detail", target.id), grant.holder);
    });
    if (grants.length !== relation.access.length) warnings.push(`atomRelations[${index}]: unverified relation access grants omitted`);
    const id = randomUUID();
    db.prepare(`INSERT INTO atom_relations(id,chat_id,source_detail_id,target_detail_id,kind,confidence,evidence_json,
      source_batch_id,source_start_ordinal,source_end_ordinal,created_revision,active,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)`).run(id, chatId, source.id, target.id, relation.kind, relation.confidence,
        JSON.stringify(relation.evidence), sourceBatchId ?? null, Math.min(...evidence.map(span => span.ordinal)),
        Math.max(...evidence.map(span => span.ordinal)), revision, Date.now());
    replaceAccess("atom_relation", id, grants);
    seen.add(pair);
  }
  return warnings;
}
