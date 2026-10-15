import { EVERYONE_HOLDER, itemAccessKnowledge, intersectAccessKnowledge } from "./item-access.js";
import { knownByLabels } from "./item-access.js";
import { createHash } from "node:crypto";
import { normalizeSearchTokens, type McpEvidence, type StateKind } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { listSocialKnowledge, type SocialKnowledgeLevel } from "./social-knowledge.js";
import { listRelationshipProjections } from "./relationship-projections.js";
import { parseSocialRelation, socialRelationKnowledge } from "./social-relations.js";
import { loadItemAccess, loadItemAccessScopes, resolveItemAccess, storedItemAccessScope, NARRATOR_ARCHIVE_HOLDER } from "./item-access.js";
import type { StateOutcomeCapture } from "./state-outcomes.js";
import type { Citation } from "./source-context-window.js";

export interface StateEvidence {
  id: string; kind: string; text: string; holders: string[]; subjects: string[];
  stateKind?: StateKind;
  relationship?: {from:string;to:string;stale:boolean};
  current: boolean; memoryId?: string; sourceIds: string[]; fingerprint: string;
  citations: Citation[];
  citationScope: "atom" | "parent_memory";
  knownByLabels?: string[];
  updatedRevision?: number;
  updatedOrdinal?: number;
  promiseStatus?: string;
  due?: string;
  /** Automatic presentation only; excluded from search text and the atom fingerprint. */
  automatic?: { subject: string; body: string; tensions?: string[]; recognitionLevel?: SocialKnowledgeLevel };
}
const parse = (value: string | null | undefined): any[] => { try { const parsed: unknown = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
const norm = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();

const restrictedStateKind = (value: unknown): boolean => value === "goal" || value === "secret";
const evidenceKey = (item: any): string => JSON.stringify([
  item.messageId, item.canonicalHash ?? null, item.startOffset ?? null, item.endOffset ?? null, item.quote ?? null,
]);

export function resolveAssertionHolders(db: RcmDatabase, chatId: string, row: any): string[] {
  if (!restrictedStateKind(row.state_kind)) return [];
  const directScopes = loadItemAccessScopes(db, chatId, [{ kind: "assertion", id: String(row.id) }]);
  const direct = storedItemAccessScope(directScopes, "assertion", String(row.id));
  if (direct.explicit) return itemAccessKnowledge(direct);

  const evidence = parse(row.evidence_json);
  if (!evidence.length) return [];
  const evidenceKeys = new Set(evidence.map(evidenceKey));
  const details = db.prepare(`SELECT d.id,d.evidence_json,d.known_by_json FROM memory_details d
    JOIN memories m ON m.id=d.memory_id
    WHERE d.chat_id=? AND d.active=1 AND m.active=1 AND (? IS NULL OR d.memory_id=?)`).all(chatId, row.source_memory_id, row.source_memory_id) as Array<{ id: string; evidence_json: string; known_by_json: string }>;
  const matching = details.filter((detail) => parse(detail.evidence_json).some((item: any) => evidenceKeys.has(evidenceKey(item))));
  if (!matching.length) return [];
  const scopes = loadItemAccessScopes(db, chatId, matching.map((detail) => ({ kind: "detail" as const, id: detail.id })));
  const resolved = matching.map((detail) => itemAccessKnowledge(storedItemAccessScope(scopes, "detail", detail.id, parse(detail.known_by_json))));
  return [...new Set(resolved.reduce(intersectAccessKnowledge))];
}

/** Re-materialize from canonical rows; cached prose never grants validity or access.
 * Historical supersession is distinct from source deletion and branch rollback. */
export function collectStateEvidence(db: RcmDatabase, chatId: string, trace?: StateOutcomeCapture, perspective = ""): StateEvidence[] {
  const result: StateEvidence[] = [];
  const pending: Array<() => void> = [];
  const sourceIds = new Set<string>();
  const sources = new Map<string, any>();
  const recordRejection = (kind: string, id: string, reason: string): void => trace?.record(perspective, { id: `${kind}:${id}`, kind }, "not_collected", { reason });
  const rejected = (kind: string, id: string, reason: string): void => { pending.push(() => recordRejection(kind, id, reason)); };
  const memories = new Map((db.prepare("SELECT id,active,user_managed,evidence_json FROM memories WHERE chat_id=?").all(chatId) as any[]).map(row => [row.id, row]));
  const add = (kind: string, row: any, text: string, holders: string[], subjects: string[], current: boolean, evidence = parse(row.evidence_json), stateKind?: StateKind, automatic?: StateEvidence["automatic"]) => {
    const corrected=row.user_edit_ordinal != null || row.userEdited===true;
    if (!text.trim()) { rejected(kind, row.id, "empty_text"); return; }
    if (!corrected && row.source_memory_id && !memories.get(row.source_memory_id)?.active) { rejected(kind, row.id, "inactive_memory"); return; }
    const citationScope = evidence.length ? "atom" : "parent_memory";
    if (!evidence.length && row.source_memory_id) evidence = parse(memories.get(row.source_memory_id)?.evidence_json);
    for (const entry of evidence) if (typeof entry.messageId === "string") sourceIds.add(entry.messageId);
    pending.push(() => {
      const validCitation=(entry:any):boolean=>{
        if(!entry.messageId) return true;
        const source=sources.get(entry.messageId);
        return !!source && ["committed","client_pruned"].includes(source.lifecycle) && ["active","all_before"].includes(source.host_visibility)
          && (!entry.canonicalHash || entry.canonicalHash===source.canonical_hash) && (!entry.quote || source.canonical_content?.includes(entry.quote));
      };
      if(corrected) evidence=evidence.filter(validCitation);
      else if(evidence.some(entry=>!validCitation(entry))) { recordRejection(kind, row.id, "invalid_source_visibility_hash_or_quote"); return; }
      const ids = evidence.flatMap((entry: any) => typeof entry.messageId === "string" ? [entry.messageId] : []);
      const item = { id: `${kind}:${row.id}`, kind, text, holders: [...new Set(holders.filter(holder => holder !== NARRATOR_ARCHIVE_HOLDER))],
        ...(stateKind ? { stateKind } : {}),
        ...(kind === "relationship" ? {relationship: {from:row.from, to:row.to, stale:row.stale}} : {}),
        subjects: [...new Set(subjects.filter(Boolean))], current, memoryId: row.source_memory_id || undefined, sourceIds: [...new Set<string>(ids)] };
      const fingerprint = createHash("sha256").update(JSON.stringify([item, row, ids.map((id: string) => sources.get(id))])).digest("hex");
      const accessKind=kind==="world_fact" || kind==="basic_relation"?"assertion":kind==="promise"?"promise":kind==="intimacy"?"physical_milestone":undefined;
      result.push({ ...item, fingerprint, citations: evidence, citationScope, automatic,
        updatedRevision: row.updated_revision ?? row.updatedRevision ?? row.valid_from_revision ?? row.created_revision,
        updatedOrdinal: Math.max(row.user_edit_ordinal ?? row.userEditOrdinal ?? -1, row.source_end_ordinal ?? row.valid_from_ordinal ?? -1,
          ...ids.map(id => sources.get(id)?.ordinal ?? -1)),
        ...(kind === "promise" ? { promiseStatus: row.status, due: row.scheduled_for ?? undefined } : {}),
        ...(accessKind?{knownByLabels:knownByLabels(db,chatId,accessKind,String(row.id),item.holders)}:{}) });
    });
  };
  for (const row of db.prepare("SELECT * FROM assertions WHERE chat_id=? ORDER BY valid_from_revision DESC,id").iterate(chatId) as Iterable<any>) {
    const relation = parseSocialRelation(row.social_relation_json);
    const evidence = parse(row.evidence_json);
    const holders = relation ? socialRelationKnowledge(db, chatId, relation) : resolveAssertionHolders(db, chatId, row);
    if (!holders) { rejected(relation ? "basic_relation" : "world_fact", row.id, "access"); continue; }
    const current = row.valid_to_revision === null;
    add(relation ? "basic_relation" : "world_fact", row, `${row.subject}: ${row.predicate} — ${row.value}${row.source && row.source !== "manual" ? ` (Source: ${row.source})` : ""}${current ? "" : " (historical; no longer current)"}`,
      holders, [row.subject, ...(relation ? [relation.target] : [])], current, evidence, relation ? "condition" : row.state_kind,
      { subject: relation ? `${row.subject} → ${relation.target}` : row.subject, body: row.value });
  }
  for (const row of db.prepare("SELECT * FROM beliefs WHERE chat_id=? ORDER BY created_revision DESC,id").iterate(chatId) as Iterable<any>) {
    if (!(row.active === 1 || row.status === "superseded") || ["pending_review", "disputed"].includes(row.status)) {
      rejected("belief", row.id, ["pending_review", "disputed"].includes(row.status) ? "review" : "inactive"); continue;
    }
    const current = row.active === 1 && row.status === "active";
    add("belief", row, `${row.holder} ${current ? row.polarity === "knows" ? "records as known" : row.polarity === "heard" ? "has heard" : row.polarity : "previously held this belief"}: ${row.subject} — ${row.predicate}: ${row.value}${row.source && row.source !== "manual" ? ` (Source: ${row.source})` : ""}${current ? "." : ` (stance: ${row.polarity}).`}`, [row.holder], [row.holder, row.subject], current, undefined, undefined,
      { subject: `${row.holder} → ${row.subject}`, body: `${row.polarity === "knows" ? "Records as known" : row.polarity === "heard" ? "Has heard" : row.polarity}: ${row.value}` });
  }
  const promises = db.prepare("SELECT * FROM promises WHERE chat_id=? ORDER BY updated_revision DESC,id").all(chatId) as any[];
  const access = loadItemAccess(db, chatId, promises.map(row => ({ kind: "promise" as const, id: row.id })));
  const promiseById = new Map(promises.map(row => [row.id, row]));
  for (const row of promises) {
    const scope = resolveItemAccess(access, "promise", row.id, [row.promisor, row.promisee]);
    add("promise", row, `${row.promisor} → ${row.promisee}: ${row.content} [${row.status === "offscreen" ? "scheduled time passed; outcome unconfirmed" : row.status}]${row.scheduled_for ? ` Due: ${row.scheduled_for}.` : ""}${row.status_reason ? ` ${row.status_reason}` : ""}`, itemAccessKnowledge(scope), [row.promisor, row.promisee], row.status === "open" || row.status === "offscreen", undefined, undefined,
      { subject: `${row.promisor} → ${row.promisee}`, body: row.content });
  }
  for (const row of db.prepare("SELECT * FROM promise_events WHERE chat_id=? AND active=1 ORDER BY source_ordinal DESC,created_revision DESC,id").iterate(chatId) as Iterable<any>) {
    const parent = promiseById.get(row.promise_id);
    if (!parent || parent.content === row.content && parent.status === row.status && parent.status_reason === row.status_reason) continue;
    const scope = resolveItemAccess(access, "promise", row.promise_id, [row.promisor, row.promisee]);
    add("promise_history", row, `${row.promisor} → ${row.promisee}: ${row.content} [${row.status}]${row.status_reason ? ` ${row.status_reason}` : ""}`, itemAccessKnowledge(scope), [row.promisor, row.promisee], false);
  }
  for (const item of listSocialKnowledge(db, chatId)) {

    add("recognition", { id: `${item.holder}:${item.subject}`,userEdited:item.userEdited, evidence_json: JSON.stringify(item.evidence) }, `${item.holder} ${item.knownAs.length ? `knows ${item.subject} as ${item.knownAs.join(", ")}` : `knows of ${item.subject}`}: ${item.cognition.map(detail => detail.text).join(" ")} ${item.level === "interacted" ? "(interacted; not necessarily in person)" : "(aware only; no meeting recorded)"}`, [item.holder], [item.holder, item.subject], true, undefined, undefined,
      { subject: `${item.holder} → ${item.knownAs[0] ?? "unnamed person"}`, body: item.cognition.map(detail => detail.text).join(" "), recognitionLevel: item.level });
  }
  for (const row of db.prepare("SELECT * FROM social_knowledge_events WHERE chat_id=? AND active=1 ORDER BY source_end_ordinal DESC,created_revision DESC,id").iterate(chatId) as Iterable<any>) {
    const details = parse(row.cognition_detail_ids_json).flatMap(id => db.prepare(`SELECT d.text FROM memory_details d JOIN memories m ON m.id=d.memory_id WHERE d.id=? AND d.chat_id=? AND d.active=1 AND m.active=1 AND EXISTS(SELECT 1 FROM item_access a WHERE a.chat_id=d.chat_id AND a.item_kind='detail' AND a.item_id=d.id AND a.active=1 AND a.holder=? COLLATE NOCASE)`).all(id, chatId, row.holder) as { text: string }[]);
    if (!details.length) continue;
    add("recognition_history", row, `Recorded recognition change for ${row.holder} about ${parse(row.known_as_json).join(", ") || "an unnamed person"} (${row.action}): ${details.map(detail => detail.text).join(" ")}`, [row.holder], [row.holder, row.subject], false);
  }
  for (const row of listRelationshipProjections(db, chatId)) {
    const basis = row.basisEventIds.map(id => db.prepare("SELECT evidence_json FROM relationship_events WHERE chat_id=? AND id=? AND active=1").get(chatId,id) as {evidence_json:string} | undefined);
    if (!row.userEdited && !row.locked && basis.some(event => !event)) { rejected("relationship", `${row.from}:${row.to}`, "inactive_basis"); continue; }
    const basisEvidence = JSON.stringify(basis.flatMap(event => event ? parse(event.evidence_json) : []));
    const summary = row.summary || Object.entries(row.axes).filter(([, axis]) => axis.level !== "unknown").map(([axis, value]) => `${axis}: ${value.level}`).join("; ");
    add("relationship", { id: `${row.from}:${row.to}`, evidence_json: basisEvidence, ...row }, `${row.from} → ${row.to}: ${summary}${row.stale ? " [Last recorded relationship; update pending.]" : ""}${row.activeTensions.length ? ` Unresolved tensions: ${row.activeTensions.join("; ")}` : ""}`, [row.from], [row.from, row.to], true, undefined, undefined,
      { subject: `${row.from} → ${row.to}`, body: summary, tensions: row.activeTensions });
    for (const [axis,value] of Object.entries(row.axes)) if (value.level !== "unknown") {
      add("relationship_axis",{id:`${row.from}:${row.to}:${axis}`,evidence_json:basisEvidence,...row},`${row.from} toward ${row.to} — ${axis}: ${value.level}; trend: ${value.trend}.`,[row.from],[row.from,row.to],true);
    }
  }
  for (const row of db.prepare("SELECT * FROM relationship_events WHERE chat_id=? AND active=1 ORDER BY source_end_ordinal DESC,created_revision DESC,id").iterate(chatId) as Iterable<any>) {
    add("relationship_history", row, `${row.from_entity} → ${row.to_entity}: ${row.reason}. Recorded change: ${parse(row.changes_json).map(change => `${change.axis}: ${change.effect} (${change.impact})`).join("; ")}`, [row.from_entity], [row.from_entity, row.to_entity], false);
  }
  const milestones = db.prepare("SELECT * FROM physical_intimacy_milestones WHERE chat_id=? AND active=1 AND deleted_by_user=0 ORDER BY source_start_ordinal,id").all(chatId) as any[];
  const physicalAccess = loadItemAccess(db, chatId, milestones.map(row => ({kind:"physical_milestone" as const,id:row.id})));
  for (const row of milestones) {
    const scope = resolveItemAccess(physicalAccess,"physical_milestone",row.id,[row.participant_a,row.participant_b]);
    add("intimacy",row,`${row.participant_a} and ${row.participant_b}: ${row.custom_label || row.act.replaceAll("_"," ")}. ${row.circumstance || "Occurrence recorded; does not imply ongoing consent."}`,itemAccessKnowledge(scope),[row.participant_a,row.participant_b],false);
  }
  for (const row of db.prepare("SELECT * FROM memories WHERE chat_id=? AND active=1 AND landmark_kinds_json<>'[]'").iterate(chatId) as Iterable<any>) {
    for (const [index, landmark] of parse(row.landmark_kinds_json).entries()) {
      // Landmark names/times are authorial metadata, never an access grant.
      add("landmark",{...row,id:`${row.id}:${index}`,source_memory_id:row.id},`${landmark.label || String(landmark.kind).replaceAll("_"," ")}${row.story_time ? ` — ${row.story_time}` : ""}`,[],parse(row.participants_json),false);
    }
  }
  // Fetch only cited source rows, once, after parent-memory citation fallback.
  // Keep the projection/order identical: source rows also enter the fingerprint.
  if (sourceIds.size) for (const row of db.prepare(`SELECT message_id,canonical_hash,content_hash,canonical_content,ordinal,lifecycle,host_visibility
    FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?)) AND memory_excluded=0`).all(chatId, JSON.stringify([...sourceIds])) as any[]) {
    sources.set(row.message_id, row);
  }
  for (const collect of pending) collect();
  return result;
}
const stateKindLabels: Record<string, string> = {world_fact:"World fact",basic_relation:"Basic relation",belief:"Belief",promise:"Promise",promise_history:"Earlier promise",recognition:"Recognition",recognition_history:"Earlier recognition",relationship:"Relationship",relationship_history:"Relationship change",relationship_axis:"Recorded feeling",intimacy:"Physical intimacy",landmark:"Milestone"};
export const stateKindLabel = (kind: string, stateKind?: StateKind): string => kind === "world_fact" && stateKind === "goal" ? "Goal"
  : kind === "world_fact" && stateKind === "secret" ? "Secret"
    : stateKindLabels[kind] ?? "Recorded state";

/** Rank channels, not incomparable raw scores. No prose is classified as true,
 * answered, secret, or resolved by lexical matching. */
export function rankStateEvidence(items: StateEvidence[], query: string, options: {
  trace?: StateOutcomeCapture; perspective: string; archive?: boolean; history?: boolean; continuity?: boolean; activeNames?: string[]; semantic?: Map<string, number>;
}): Array<{ item: StateEvidence; score: number }> {
  const visible = items.filter(item => {
    if (!(options.history || item.current && item.kind !== "relationship_axis")) {
      options.trace?.record(options.perspective, item, "not_current", item.kind === "relationship_axis" ? { reason: "axis_not_in_current_ledger" } : {}); return false;
    }
    if (!(options.archive || options.perspective === "narrator" || item.holders.includes(EVERYONE_HOLDER)
      || item.holders.some(holder => norm(holder) === norm(options.perspective)) || item.kind === "world_fact" && !restrictedStateKind(item.stateKind))) {
      options.trace?.record(options.perspective, item, "perspective_blocked"); return false;
    }
    return true;
  });
  // Entity identity is an automatic continuity channel, not sufficient lexical
  // evidence that a ledger answers an arbitrary question about those people.
  const entityTokens = new Set(items.flatMap(item => item.holders.flatMap(holder => normalizeSearchTokens(holder))));
  const tokens = new Set(normalizeSearchTokens(query).filter(token => !entityTokens.has(token)));
  const lexical = visible.map(item => ({ item, score: [...new Set(normalizeSearchTokens(item.text))].reduce((sum, token) => sum + Number(tokens.has(token)), 0) / Math.max(1,tokens.size) }))
    .filter(entry => entry.score > 0 && (options.continuity || entry.score >= .2)).sort((a, b) => b.score - a.score);
  const semantic = visible.filter(item => (options.semantic?.get(item.id) ?? 0) >= .35).sort((a, b) => options.semantic!.get(b.id)! - options.semantic!.get(a.id)!);
  const names = new Set([options.perspective, ...(options.activeNames ?? [])].map(norm));
  const associated = (options.continuity ?? !options.history) ? visible.filter(item => (item.current || options.history) && (item.kind === "relationship" && (options.activeNames?.length ?? 0) > 1 ? item.subjects.slice(1) : item.subjects).some(subject => names.has(norm(subject)))) : [];
  const scores = new Map<string, number>();
  for (const channel of [lexical.map(entry => entry.item), semantic, associated]) channel.forEach((item, index) => scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (60 + index + 1)));
  const ranked = visible.filter(item => {
    if (!scores.has(item.id)) { options.trace?.record(options.perspective, item, "not_linked"); return false; }
    if (!(options.history || item.kind !== "relationship" || (options.activeNames?.length ?? 0) <= 1
      || item.subjects.slice(1).some(subject=>names.has(norm(subject))) || (options.semantic?.get(item.id) ?? 0)>=.35)) {
      options.trace?.record(options.perspective, item, "not_linked", { reason: "relationship_scene_scope" }); return false;
    }
    return true;
  })
    .sort((a, b) => scores.get(b.id)! - scores.get(a.id)! || a.id.localeCompare(b.id));
  return ranked.map(item => ({ item, score: scores.get(item.id)! }));
}

export function selectStateEvidence(items: StateEvidence[], query: string, options: Parameters<typeof rankStateEvidence>[2]): StateEvidence[] {
  const ranked = rankStateEvidence(items, query, options);
  // Reserve discovery opportunity for each represented kind, not output slots.
  // The shared automatic ledger uses the relevance scores before this MCP discovery ordering.
  const firsts = [...new Map([...ranked].reverse().map(entry => [entry.item.kind, entry])).values()];
  return [...firsts.sort((a,b) => b.score - a.score), ...ranked.filter(entry => !firsts.includes(entry))].map(entry => entry.item);
}

export function stateMcpEvidence(item: StateEvidence): McpEvidence {
  return { atomKey: `state:${item.id}:${item.fingerprint}`, kind: "fact", text: `${stateKindLabel(item.kind, item.stateKind)}: ${item.text}`, knownBy: item.holders,knownByLabels:item.knownByLabels,
    basis: item.kind === "belief" ? "recorded belief" : item.current ? "current recorded state" : "historical record" };
}
