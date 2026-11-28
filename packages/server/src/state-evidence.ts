import { backfillLegacyParticipantAccess } from "./access-migration.js";
import { isEndedPromiseStatus, promiseFirstMade, type PromiseFirstMade } from "./promise-recency.js";
import { validItemAccessScope, EVERYONE_HOLDER, itemAccessKnowledge, type ItemAccessScope } from "./item-access.js";
import { createItemAccessReadContext, loadKnownByLabels, type ItemAccessReadContext, linkedDetailKnowledge, promiseLinkedSupport, correctedPromiseDetailIds, projectPromiseRow } from "./item-access.js";
import { createHash } from "node:crypto";
import { stateCandidateValue } from './now-delivery.js';
import { normalizeSearchTokens, scopeOf, storedStoryTimeEnd, type KnowledgeScope, type McpEvidence, type StateKind } from "@rcm/shared";
import { publicKnowledgeScope } from "./item-access.js";
import type { RcmDatabase } from "./db.js";
import { listSocialKnowledge, hasRecognitionContent, joinSentences, recognitionNaming, socialKnowledgeLevelLabel, type SocialKnowledgeLevel } from "./social-knowledge.js";
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
  /** Presentation only: stored story time supporting the latest cited source. */
  recordedStoryTime?: string;
  promiseStatus?: string;
  firstMade?: PromiseFirstMade;
  promisePinned?: boolean;
  alwaysInject?: boolean;
  promiseRecent?: boolean;
  due?: string;
  /** Automatic presentation only; excluded from search text and the atom fingerprint. */
  previous?: { item: StateEvidence; changedAt?: string };
  /** Presentation links only; excluded from ranking text and fingerprints. */
  linkedDetailIds?: string[];
  historyLabel?: string;
  currentItemId?: string;
  displayText?: string;
  /** Existing presentation identity; wording changes must not alter deduplication. */
  dedupeText?: string;
  dedupeBody?: string;
  automatic?: { subject: string; body: string; axes?: Record<string, {level: string; trend: string}>; tensions?: string[]; summaryReady?: boolean; recognitionLevel?: SocialKnowledgeLevel; knownAs?: string[]; addressTerms?: string[]; addressTermsUserEdited?: boolean;
    /** Null is missing access, distinct from explicit narrator-only. */
    scope?: KnowledgeScope | null };
}
const parse = (value: string | null | undefined): any[] => { try { const parsed: unknown = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
const norm = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
const beliefPolarityLabel: Record<string, string> = { knows: "knows", heard: "heard, not confirmed", believes: "believes" };

const restrictedStateKind = (value: unknown): boolean => value === "goal" || value === "secret";
const recordedKnowledgeScope = (scope: ItemAccessScope): KnowledgeScope | null => scope.explicit && validItemAccessScope(scope)
  ? scopeOf(publicKnowledgeScope(itemAccessKnowledge(scope))) : null;

/** Empty public records have unrecorded knowers; only the sentinel declares nobody. */
export function stateEvidenceScope(item: StateEvidence): KnowledgeScope | undefined {
  if (item.automatic?.scope !== undefined) return item.automatic.scope ?? undefined;
  const scope = publicKnowledgeScope(item.holders);
  return scope.knownByEveryone || scope.knownBy.length || item.holders.includes(NARRATOR_ARCHIVE_HOLDER) ? scopeOf(scope) : undefined;
}

export function resolveAssertionHolders(db: RcmDatabase, chatId: string, row: any): string[] | null {
  return assertionHolders(db, chatId, [row]).get(String(row.id)) ?? null;
}

/** Resolve direct grants in one batch for the collection. */
function assertionHolders(db: RcmDatabase, chatId: string, rows: any[], reads?:ItemAccessReadContext): Map<string, string[] | null> {
  const directScopes = loadItemAccessScopes(db, chatId, rows.map(row => ({kind:"assertion",id:String(row.id)})));
  const supported = (row:any): string[] | null => {
    if (row.linked_detail_ids_json != null && row.user_edit_ordinal == null)
      return linkedDetailKnowledge(db,chatId,parse(row.linked_detail_ids_json),reads) ?? null;
    const direct = storedItemAccessScope(directScopes, "assertion", String(row.id));
    if (direct.explicit && validItemAccessScope(direct)) return direct.narratorOnly ? [NARRATOR_ARCHIVE_HOLDER] : itemAccessKnowledge(direct);
    const relation = parseSocialRelation(row.social_relation_json);
    if (relation && !direct.pending) return relation.manual && !relation.knownByEveryone && !relation.knownBy?.length ? [NARRATOR_ARCHIVE_HOLDER] : socialRelationKnowledge(db,chatId,relation,reads) ?? null;
    if (!restrictedStateKind(row.state_kind)) return direct.pending ? null : [];
    if (direct.explicit) return null;
    return parse(row.evidence_json).length ? [row.subject] : null;
  };
  return new Map(rows.map(row=>[String(row.id),supported(row)]));
}

/** Re-materialize from canonical rows; cached prose never grants validity or access.
 * Historical supersession is distinct from source deletion and branch rollback. */
export function collectStateEvidence(db: RcmDatabase, chatId: string, trace?: StateOutcomeCapture, perspective = ""): StateEvidence[] {
  return readStateEvidence(db, chatId, trace, perspective);
}

/** Migration only: compare both formulas from the same canonical snapshot. */
export function stateEvidenceFingerprintMigration(db: RcmDatabase, chatId: string): Map<string, { legacy: string; current: string }> {
  const fingerprints = new Map<string, { legacy: string; current: string }>();
  readStateEvidence(db, chatId, undefined, "", fingerprints);
  return fingerprints;
}

function readStateEvidence(db: RcmDatabase, chatId: string, trace?: StateOutcomeCapture, perspective = "",
  migration?: Map<string, { legacy: string; current: string }>): StateEvidence[] {
  backfillLegacyParticipantAccess(db, chatId);
  const turn = Number((db.prepare("SELECT completed_turn_count FROM chats WHERE id=?").get(chatId) as { completed_turn_count: number } | undefined)?.completed_turn_count ?? 0);
  const result: StateEvidence[] = [];
  const pending: Array<() => void> = [];
  const sourceIds = new Set<string>();
  const sources = new Map<string, any>();
  const sourceIdentities = new Map<string, unknown>();
  const correctedIds = new Set<string>();
  const predecessors = new Map<string, Array<{ id: string; evidence: any[] }>>();
  const link = (id: string, successor: string | undefined, evidence: any[]) => {
    if (!successor) return;
    predecessors.set(successor, [...(predecessors.get(successor) ?? []), { id, evidence }]);
    for (const entry of evidence) if (typeof entry.messageId === "string") sourceIds.add(entry.messageId);
  };
  const validCitation = (entry: any): boolean => {
    if (!entry.messageId) return true;
    const source = sources.get(entry.messageId);
    return !!source && ["committed", "client_pruned"].includes(source.lifecycle) && ["active", "all_before"].includes(source.host_visibility)
      && (!entry.canonicalHash || entry.canonicalHash === source.canonical_hash)
      && (!entry.transitionCanonicalHash || entry.transitionCanonicalHash === source.canonical_hash)
      && (!entry.quote || source.canonical_content?.includes(entry.quote));
  };
  const recordRejection = (kind: string, id: string, reason: string): void => trace?.record(perspective, { id: `${kind}:${id}`, kind }, "not_collected", { reason });
  const rejected = (kind: string, id: string, reason: string): void => { pending.push(() => recordRejection(kind, id, reason)); };
  const reads=createItemAccessReadContext(db,chatId);
  const origins=promiseFirstMade(db,chatId);
  const labelItems:Array<{kind:import('./item-access.js').ItemAccessKind;id:string}>=[];
  const pendingLabels:Array<()=>void>=[];
  const memories = new Map((db.prepare("SELECT id,active,user_managed,evidence_json,story_time,story_time_normalized FROM memories WHERE chat_id=?").all(chatId) as any[]).map(row => [row.id, row]));
  const supportTimes = new Map<string, Set<string>>();
  for (const memory of memories.values()) {
    const time = storedStoryTimeEnd(memory.story_time) !== undefined ? memory.story_time : memory.story_time_normalized;
    if (!memory.active || storedStoryTimeEnd(time) === undefined) continue;
    for (const entry of parse(memory.evidence_json)) if (typeof entry.messageId === "string") {
      const times = supportTimes.get(entry.messageId) ?? new Set<string>();
      times.add(time); supportTimes.set(entry.messageId, times);
    }
  }
  const add = (kind: string, row: any, text: string, holders: string[], subjects: string[], current: boolean, evidence = parse(row.evidence_json), stateKind?: StateKind, automatic?: StateEvidence["automatic"], presentation: Pick<StateEvidence,"linkedDetailIds"|"historyLabel"|"currentItemId"|"displayText"|"dedupeText"|"dedupeBody"> = {}) => {
    const corrected=row.user_edit_ordinal != null || row.userEdited===true;
    if (corrected) correctedIds.add(`${kind}:${row.id}`);
    if (!text.trim()) { rejected(kind, row.id, "empty_text"); return; }
    if (!corrected && row.source_memory_id && !memories.get(row.source_memory_id)?.active) { rejected(kind, row.id, "inactive_memory"); return; }
    const citationScope = evidence.length ? "atom" : "parent_memory";
    if (!evidence.length && row.source_memory_id) evidence = parse(memories.get(row.source_memory_id)?.evidence_json);
    for (const entry of evidence) if (typeof entry.messageId === "string") sourceIds.add(entry.messageId);
    pending.push(() => {
      if(corrected) evidence=evidence.filter(validCitation);
      else if(evidence.some(entry=>!validCitation(entry))) { recordRejection(kind, row.id, "invalid_source_visibility_hash_or_quote"); return; }
      const ids = evidence.flatMap((entry: any) => typeof entry.messageId === "string" ? [entry.messageId] : []);
      const item = { id: `${kind}:${row.id}`, kind, text, holders: [...new Set(holders)],
        ...(stateKind ? { stateKind } : {}),
        ...(kind === "relationship" ? {relationship: {from:row.from, to:row.to, stale:row.stale}} : {}),
        subjects: [...new Set(subjects.filter(Boolean))], current, memoryId: row.source_memory_id || undefined, sourceIds: [...new Set<string>(ids)] };
      const fingerprintRow = stateCandidateValue(row);
      const fingerprint = createHash("sha256").update(JSON.stringify([item, fingerprintRow, ids.map((id: string) => sourceIdentities.get(id))])).digest("hex");
      // Legacy whole-message formula is used only by the one-time sidecar migration.
      if (migration) migration.set(item.id, { current: fingerprint,
        legacy: createHash("sha256").update(JSON.stringify([item, fingerprintRow, ids.map((id: string) => sources.get(id))])).digest("hex") });
      // Ordinal selects the latest support, not the largest calendar value.
      // Ambiguous/missing clocks and manual corrections never borrow an older time.
      const latestSource = ids.reduce<string | undefined>((latest, id) => latest === undefined
        || sources.get(id)?.ordinal > sources.get(latest)?.ordinal ? id : latest, undefined);
      const times = latestSource ? supportTimes.get(latestSource) : undefined;
      const recordedStoryTime = !corrected && times?.size === 1 ? [...times][0] : undefined;
      const accessKind=kind==="world_fact" || kind==="basic_relation"?"assertion":kind==="promise"?"promise":kind==="intimacy"?"physical_milestone":undefined;
      const collected:StateEvidence={ ...item, alwaysInject: current && row.always_inject === 1, fingerprint, citations: evidence, citationScope, automatic, ...presentation, recordedStoryTime,
        updatedRevision: row.updated_revision ?? row.updatedRevision ?? row.valid_from_revision ?? row.created_revision,
        updatedOrdinal: Math.max(row.user_edit_ordinal ?? row.userEditOrdinal ?? -1, row.source_end_ordinal ?? row.valid_from_ordinal ?? -1,
          ...ids.map(id => sources.get(id)?.ordinal ?? -1)),
        ...(kind === "promise_history" ? {promiseStatus:row.status} : {}),
        ...(kind === "promise" ? { firstMade: origins.get(row.id), promiseStatus: row.status, promisePinned: row.pinned === 1 && (row.status === "open" || isEndedPromiseStatus(row.status)),
          promiseRecent: isEndedPromiseStatus(row.status) && row.ended_at_turn != null && turn >= row.ended_at_turn && turn < row.recency_until_turn, due: row.scheduled_for ?? undefined } : {}),
        };
      if (accessKind) {
        labelItems.push({kind:accessKind,id:String(row.id)});
        pendingLabels.push(()=>{collected.knownByLabels=labels(accessKind,String(row.id),item.holders);});
      }
      result.push(collected);
    });
  };
  const assertions = db.prepare("SELECT * FROM assertions WHERE chat_id=? ORDER BY valid_from_revision DESC,id").all(chatId) as any[];
  const assertionAccess = assertionHolders(db,chatId,assertions,reads);
  for (const row of assertions) {
    const relation = parseSocialRelation(row.social_relation_json);
    const evidence = parse(row.evidence_json);
    const holders = assertionAccess.get(String(row.id));
    if (!holders) { rejected(relation ? "basic_relation" : "world_fact", row.id, "access"); continue; }
    const current = row.valid_to_revision === null;
    const kind = relation ? "basic_relation" : "world_fact";
    const closure = parse(row.automatic_closure_evidence_json);
    const successors = [...new Set(closure.map(entry => entry.successorId).filter(Boolean))];
    if (!current && successors.length === 1) link(`${kind}:${row.id}`, `assertion:${successors[0]}`, closure);
    add(relation ? "basic_relation" : "world_fact", row, `${row.subject}: ${row.predicate} — ${row.value}${row.source && row.source !== "manual" ? ` (Source: ${row.source})` : ""}${current ? "" : " (historical; no longer current)"}`,
      holders, [row.subject, ...(relation ? [relation.target] : [])], current, evidence, relation ? "condition" : row.state_kind,
      { subject: relation ? `${row.subject} → ${relation.target}` : row.subject, body: row.value },
      {linkedDetailIds: row.linked_detail_ids_json != null ? parse(row.linked_detail_ids_json) : relation?.detailIds, displayText:`${relation ? `${row.subject} & ${relation.target}` : row.subject}: ${relation ? "" : `${row.predicate.replaceAll("_", " ")} — `}${row.value}${row.source && row.source !== "manual" ? ` (Source: ${row.source})` : ""}`, ...(!current ? {historyLabel:"before it changed",currentItemId:successors.length === 1 ? `${kind}:${successors[0]}` : undefined} : {})});
  }
  const beliefs=db.prepare("SELECT * FROM beliefs WHERE chat_id=? ORDER BY created_revision DESC,id").all(chatId) as any[];
  const beliefScopes=loadItemAccessScopes(db,chatId,beliefs.map(row=>({kind:'belief',id:row.id})));
  for (const row of beliefs) {
    if (!(row.active === 1 || row.status === "superseded") || ["pending_review", "disputed"].includes(row.status)) {
      rejected("belief", row.id, ["pending_review", "disputed"].includes(row.status) ? "review" : "inactive"); continue;
    }
    const recorded = storedItemAccessScope(beliefScopes,'belief',row.id,[row.holder]);
    const holders = row.linked_detail_ids_json != null && row.user_edit_ordinal == null ? linkedDetailKnowledge(db,chatId,parse(row.linked_detail_ids_json),reads)
      : validItemAccessScope(recorded) ? recorded.narratorOnly ? [NARRATOR_ARCHIVE_HOLDER] : itemAccessKnowledge(recorded) : undefined;
    if (!holders) { rejected("belief",row.id,"access"); continue; }
    const current = row.active === 1 && row.status === "active";
    if (!current && row.status === "superseded") link(`belief:${row.id}`, row.superseded_by ? `belief:${row.superseded_by}` : undefined, parse(row.automatic_closure_evidence_json));
    const label = beliefPolarityLabel[row.polarity] ? current ? beliefPolarityLabel[row.polarity] : "formerly believed" : undefined;
    const subject = `${row.holder} → ${row.subject}${label ? ` (${label})` : ""}`;
    const legacyBody = `${row.polarity === "knows" ? "records as known" : row.polarity === "heard" ? "has heard" : row.polarity} ${row.value}`;
    const body = label ? row.value : legacyBody;
    const suffix = ` (${row.predicate.replaceAll("_", " ")})${row.source && row.source !== "manual" ? ` (Source: ${row.source})` : ""}`;
    add("belief", row, `${row.holder} ${current ? row.polarity === "knows" ? "records as known" : row.polarity === "heard" ? "has heard" : row.polarity : "previously held this belief"}: ${row.subject} — ${row.predicate}: ${row.value}${row.source && row.source !== "manual" ? ` (Source: ${row.source})` : ""}${current ? "." : ` (stance: ${row.polarity}).`}`, holders, [row.holder, row.subject], current, undefined, undefined,
      { subject, body },
      {linkedDetailIds:row.linked_detail_ids_json != null ? parse(row.linked_detail_ids_json) : undefined,
        displayText:`${subject}: ${body}${suffix}`, dedupeText:`${row.holder} → ${row.subject}: ${legacyBody}${suffix}`, dedupeBody:legacyBody,
        ...(!current ? {historyLabel:"before it changed", currentItemId:row.superseded_by ? `belief:${row.superseded_by}` : undefined} : {})});
  }
  const promises = reads.promises.map(row=>projectPromiseRow(db,chatId,row,undefined,reads));
  const access = loadItemAccess(db, chatId, promises.map(row => ({ kind: "promise" as const, id: row.id })),reads);
  const promiseScopes = loadItemAccessScopes(db, chatId, promises.map(row => ({ kind: "promise" as const, id: row.id })),reads);
  const promiseById = new Map(promises.map(row => [row.id, row]));
  const promiseEvents = reads.events.filter(row=>row.active===1 && row.status!=='invalidated').map(row=>projectPromiseRow(db,chatId,row,row.id,reads));
  for (const row of promises) {
    const support = promiseLinkedSupport(db,chatId,row.id,undefined,reads);
    if (support && !support.holders.length) { rejected("promise",row.id,"access"); continue; }
    const scope = resolveItemAccess(access, "promise", row.id, [row.promisor, row.promisee]);
    const recorded = storedItemAccessScope(promiseScopes, "promise", row.id);
    add("promise", row, `${row.promisor} → ${row.promisee}: ${row.content} [${row.status === "offscreen" ? "scheduled time passed; outcome unconfirmed" : row.status}]${row.scheduled_for ? ` Due: ${row.scheduled_for}.` : ""}${row.status_reason ? ` ${row.status_reason}` : ""}`, support?.holders ?? itemAccessKnowledge(scope), [row.promisor, row.promisee], row.status === "open", undefined, undefined,
      { subject: `${row.promisor} → ${row.promisee}`, body: row.content,
        // Author labels use recorded access. Keep the legacy participant fallback
        // above only for the existing character-facing access contract.
        scope: support ? scopeOf(publicKnowledgeScope(support.holders)) : recordedKnowledgeScope(recorded) },
      {linkedDetailIds:support?.ids ?? (row.user_edit_ordinal != null ? correctedPromiseDetailIds(db,chatId,row.id) : undefined),displayText:`${row.promisor} → ${row.promisee}: ${row.content}${row.scheduled_for ? ` Due: ${row.scheduled_for}.` : ""}${row.status_reason ? ` ${row.status_reason}` : ""}`});
  }
  for (const row of [...promiseEvents].reverse()) {
    const parent = promiseById.get(row.promise_id);
    if (!parent || parent.content === row.content && parent.status === row.status && parent.status_reason === row.status_reason) continue;
    const support = promiseLinkedSupport(db,chatId,parent.id,row.id,reads);
    if (support && !support.holders.length) { rejected("promise_history",row.id,"access"); continue; }
    const scope = resolveItemAccess(access, "promise", row.promise_id, [row.promisor, row.promisee]);
    const recorded = storedItemAccessScope(promiseScopes, "promise", row.promise_id);
    add("promise_history", row, `${row.promisor} → ${row.promisee}: ${row.content} [${row.status}]${row.status_reason ? ` ${row.status_reason}` : ""}`, support?.holders ?? itemAccessKnowledge(scope), [row.promisor, row.promisee], false, undefined, undefined,
      {subject:`${row.promisor} → ${row.promisee}`,body:row.content,
        scope:support ? scopeOf(publicKnowledgeScope(support.holders)) : recordedKnowledgeScope(recorded)}, {linkedDetailIds:support?.ids,displayText:`${row.promisor} → ${row.promisee}: ${row.content}${row.scheduled_for ? ` Due: ${row.scheduled_for}.` : ""}${row.status_reason ? ` ${row.status_reason}` : ""}`, historyLabel:promiseStatusLabel[row.status] ?? "promise changed", currentItemId:`promise:${row.promise_id}`});
  }
  for (const item of listSocialKnowledge(db, chatId)) {
    if (!hasRecognitionContent({...item,body:item.cognition.map(detail=>detail.text).join(" ")})) { rejected("recognition",`${item.holder}:${item.subject}`,"empty_text"); continue; }

    add("recognition", { id: `${item.holder}:${item.subject}`,userEdited:item.userEdited, evidence_json: JSON.stringify(item.evidence) }, `${item.holder} ${item.knownAs.length ? `knows ${item.subject} as ${item.knownAs.join(", ")}` : `knows of ${item.subject}`}: ${item.cognition.map(detail => detail.text).join(" ")} ${item.level === "interacted" ? "(interacted; not necessarily in person)" : "(aware only; no meeting recorded)"}`, [item.holder], [item.holder, item.subject], true, undefined, undefined,
      { subject: `${item.holder} → ${item.subject}`, body: item.cognition.map(detail => detail.text).join(" "), recognitionLevel: item.level, knownAs: item.knownAs, addressTerms:item.addressTerms, addressTermsUserEdited:item.userEdited },
      {linkedDetailIds:item.cognition.map(detail=>detail.id)});
  }
  for (const row of db.prepare("SELECT * FROM social_knowledge_events WHERE chat_id=? AND active=1 ORDER BY source_end_ordinal DESC,created_revision DESC,id").iterate(chatId) as Iterable<any>) {
    const details = parse(row.cognition_detail_ids_json).flatMap(id => db.prepare(`SELECT d.id,d.text FROM visible_memory_details d JOIN memories m ON m.id=d.memory_id WHERE d.id=? AND d.chat_id=? AND d.active=1 AND m.active=1 AND EXISTS(SELECT 1 FROM item_access a WHERE a.chat_id=d.chat_id AND a.item_kind='detail' AND a.item_id=d.id AND a.active=1 AND a.holder=? COLLATE NOCASE)`).all(id, chatId, row.holder) as { id: string; text: string }[]);
    if (!details.length) continue;
    add("recognition_history", row, `Recorded recognition change for ${row.holder} about ${parse(row.known_as_json).join(", ") || "an unnamed person"} (${row.action}): ${details.map(detail => detail.text).join(" ")}`, [row.holder], [row.holder, row.subject], false, undefined, undefined,
      {subject:`${row.holder} → ${row.subject}`,body:details.map(detail=>detail.text).join(" "), recognitionLevel:row.level ?? undefined,
        knownAs:parse(row.known_as_json),addressTerms:parse(row.address_terms_json)},
      {linkedDetailIds:details.map(detail=>detail.id),historyLabel:row.user_edit_ordinal != null ? "corrected" : recognitionActionLabel[row.action] ?? "recognition changed",
        currentItemId:`recognition:${row.holder}:${row.subject}`});
  }
  const relationshipEvents=db.prepare("SELECT * FROM visible_relationship_events WHERE chat_id=? AND active=1 ORDER BY source_end_ordinal DESC,created_revision DESC,id").all(chatId) as any[];
  const relationshipById=new Map(relationshipEvents.map(row=>[row.id,row]));
  for (const row of listRelationshipProjections(db, chatId)) {
    const {summaryReady,...projection} = row;
    const basis = row.basisEventIds.map(id => relationshipById.get(id) as {evidence_json:string;source_detail_id:string|null} | undefined);
    if (!row.userEdited && !row.locked && basis.some(event => !event)) { rejected("relationship", `${row.from}:${row.to}`, "inactive_basis"); continue; }
    const basisEvidence = JSON.stringify(basis.flatMap(event => event ? parse(event.evidence_json) : []));
    const summary = row.summary || Object.entries(row.axes).filter(([, axis]) => axis.level !== "unknown").map(([axis, value]) => `${axis}: ${value.level}`).join("; ");
    const displaySummary = !summaryReady ? "Relationship summary is not ready yet." : summary;
    add("relationship", { id: `${row.from}:${row.to}`, evidence_json: basisEvidence, ...projection }, `${row.from} → ${row.to}${summary ? `: ${summary}` : ""}${row.stale ? " [Last recorded relationship; update pending.]" : ""}${row.activeTensions.length ? ` Unresolved tensions: ${row.activeTensions.join("; ")}` : ""}`, [row.from], [row.from, row.to], true, undefined, undefined,
      { subject: `${row.from} → ${row.to}`, body: displaySummary, axes: row.axes, tensions: row.activeTensions, summaryReady },
      {linkedDetailIds:basis.flatMap(event=>event?.source_detail_id ? [event.source_detail_id] : [])});
    for (const [axis,value] of Object.entries(row.axes)) if (value.level !== "unknown") {
      add("relationship_axis",{id:`${row.from}:${row.to}:${axis}`,evidence_json:basisEvidence,...projection},`${row.from} toward ${row.to} — ${axis}: ${value.level}; trend: ${value.trend}.`,[row.from],[row.from,row.to],true,undefined,undefined,undefined,
        {displayText:`${row.from} toward ${row.to} — ${plainStateValue(axis)}: ${plainStateValue(value.level)}; ${plainStateValue(value.trend)}.`});
    }
  }
  for (const row of relationshipEvents) {
    add("relationship_history", row, `${row.from_entity} → ${row.to_entity}: ${row.reason}. Recorded change: ${parse(row.changes_json).map(change => `${change.axis}: ${change.effect} (${change.impact})`).join("; ")}`, [row.from_entity], [row.from_entity, row.to_entity], false,undefined,undefined,undefined,
      {linkedDetailIds:row.source_detail_id ? [row.source_detail_id] : [],historyLabel:"relationship changed",currentItemId:`relationship:${row.from_entity}:${row.to_entity}`,
        displayText:`${row.from_entity} → ${row.to_entity}: ${joinSentences([row.reason,parse(row.changes_json).map(change=>`${plainStateValue(change.axis)} ${plainStateValue(change.effect)} (${plainStateValue(change.impact)})`).join("; ")])}`});
  }
  const milestones = db.prepare("SELECT * FROM physical_intimacy_milestones WHERE chat_id=? AND active=1 AND deleted_by_user=0 ORDER BY source_start_ordinal,id").all(chatId) as any[];
  const physicalAccess = loadItemAccess(db, chatId, milestones.map(row => ({kind:"physical_milestone" as const,id:row.id})));
  const physicalScopes = loadItemAccessScopes(db, chatId, milestones.map(row => ({kind:"physical_milestone" as const,id:row.id})));
  for (const row of milestones) {
    const scope = resolveItemAccess(physicalAccess,"physical_milestone",row.id,[row.participant_a,row.participant_b]);
    const recorded=storedItemAccessScope(physicalScopes,"physical_milestone",row.id);
    const text=`${row.participant_a} and ${row.participant_b}: ${row.custom_label || row.act.replaceAll("_"," ")}. ${row.circumstance || "Occurrence recorded; does not imply ongoing consent."}`;
    add("intimacy",row,text,itemAccessKnowledge(scope),[row.participant_a,row.participant_b],false,undefined,undefined,
      {subject:`${row.participant_a} → ${row.participant_b}`,body:text,
        scope:recordedKnowledgeScope(recorded)});
  }
  for (const row of db.prepare("SELECT * FROM memories WHERE chat_id=? AND active=1 AND landmark_kinds_json<>'[]'").iterate(chatId) as Iterable<any>) {
    for (const [index, landmark] of parse(row.landmark_kinds_json).entries()) {
      // Landmark names/times are authorial metadata, never an access grant.
      add("landmark",{...row,id:`${row.id}:${index}`,source_memory_id:row.id},`${landmark.label || String(landmark.kind).replaceAll("_"," ")}${row.story_time ? ` — ${row.story_time}` : ""}`,[],parse(row.participants_json),false);
    }
  }
  // Fetch only cited source rows, once, after parent-memory citation fallback.
  // Keep the legacy projection/order for migration; ordinary fingerprints use
  // source identity and hashes, never the whole canonical message.
  if (sourceIds.size) for (const row of db.prepare(`SELECT message_id,canonical_hash,content_hash,canonical_content,ordinal,lifecycle,host_visibility
    FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?)) AND memory_excluded=0`).all(chatId, JSON.stringify([...sourceIds])) as any[]) {
    sources.set(row.message_id, row);
    const { canonical_content: _content, ...identity } = row;
    sourceIdentities.set(row.message_id, identity);
  }
  for (const collect of pending) collect();
  const labels=loadKnownByLabels(db,chatId,labelItems,reads);
  for (const annotate of pendingLabels) annotate();
  const byId = new Map(result.map(item => [item.id, item]));
  for (const item of result) {
    // A manual correction no longer asserts the original transition value/date.
    if (!item.current || correctedIds.has(item.id)) continue;
    const key = ["world_fact", "basic_relation"].includes(item.kind) ? item.id.replace(/^[^:]+:/, "assertion:") : item.id;
    const links = predecessors.get(key);
    // Explicit one-to-one succession only. Missing/ambiguous history stays absent.
    if (links?.length !== 1) continue;
    const prior = byId.get(links[0]!.id), transition = links[0]!.evidence;
    if (!prior || prior.current || !prior.sourceIds.length || !item.sourceIds.length
      || !transition.some(entry => entry.messageId) || !transition.every(validCitation)
      || !prior.automatic?.body || (prior.dedupeBody ?? prior.automatic.body) === (item.dedupeBody ?? item.automatic?.body)) continue;
    // Author rendering gives the predecessor its own scope; it never inherits
    // the current row's holders. Character-facing evidence does not emit notes.
    const memory = item.memoryId ? memories.get(item.memoryId) : undefined;
    const time = memory?.active ? memory.story_time_normalized || memory.story_time : undefined;
    item.previous = { item: prior, ...(typeof time === "string" && storedStoryTimeEnd(time) !== undefined ? { changedAt: time } : {}) };
  }
  return result;
}
const stateKindLabels: Record<string, string> = {world_fact:"World fact",basic_relation:"Basic relation",belief:"Belief",promise:"Promise",promise_history:"Earlier promise",recognition:"Recognition",recognition_history:"Earlier recognition",relationship:"Relationship",relationship_history:"Relationship change",relationship_axis:"Recorded feeling",intimacy:"Physical intimacy",landmark:"Milestone"};
export const stateKindLabel = (kind: string, stateKind?: StateKind): string => kind === "world_fact" && stateKind === "goal" ? "Goal"
  : kind === "world_fact" && stateKind === "secret" ? "Secret"
    : stateKindLabels[kind] ?? "Recorded state";

export function canAccessStateEvidence(item: StateEvidence, perspective: string): boolean {
  return perspective === "narrator" || item.holders.includes(EVERYONE_HOLDER)
    || item.holders.some(holder => norm(holder) === norm(perspective))
    || item.kind === "world_fact" && !restrictedStateKind(item.stateKind);
}

/** Rank channels, not incomparable raw scores. No prose is classified as true,
 * answered, secret, or resolved by lexical matching. */
export function rankStateEvidence(items: StateEvidence[], query: string, options: {
  automaticPromises?: boolean; trace?: StateOutcomeCapture; perspective: string; archive?: boolean; history?: boolean; continuity?: boolean; activeNames?: string[]; semantic?: Map<string, number>;
  /** Automatic packets only: resolved subject scope from the scene-names renderer. */
  sceneRecognitionIds?: ReadonlySet<string>;
}): Array<{ item: StateEvidence; score: number }> {
  const eligiblePromise = (item: StateEvidence) => options.automaticPromises && item.kind === "promise" && (item.promisePinned || item.promiseRecent);
  const visible = items.filter(item => {
    if ((options.archive || options.automaticPromises) && item.automatic?.scope === null) {
      options.trace?.record(options.perspective, item, "not_collected", { reason: "missing_access" }); return false;
    }
    if (!(options.history || eligiblePromise(item) || item.current && item.kind !== "relationship_axis")) {
      options.trace?.record(options.perspective, item, "not_current", item.kind === "relationship_axis" ? { reason: "axis_not_in_current_ledger" } : {}); return false;
    }
    if (!(options.archive || canAccessStateEvidence(item, options.perspective))) {
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
  const associated = (options.continuity ?? !options.history) ? visible.filter(item => (item.current || eligiblePromise(item) || options.history)
    && (item.kind === "recognition" && options.sceneRecognitionIds !== undefined ? options.sceneRecognitionIds.has(item.id)
      : (item.kind === "relationship" && (options.activeNames?.length ?? 0) > 1 ? item.subjects.slice(1) : item.subjects).some(subject => names.has(norm(subject))))) : [];
  const scores = new Map<string, number>();
  for (const channel of [lexical.map(entry => entry.item), semantic, associated]) channel.forEach((item, index) => scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (60 + index + 1)));
  const ranked = visible.filter(item => {
    if (options.automaticPromises && (item.promisePinned || item.alwaysInject)) scores.set(item.id, scores.get(item.id) ?? 0);
    if (!scores.has(item.id)) { options.trace?.record(options.perspective, item, "not_linked"); return false; }
    if (!(options.archive || options.history || item.kind !== "relationship" || (options.activeNames?.length ?? 0) <= 1
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

const promiseStatusLabel: Record<string,string> = {invalidated:"withdrawn from the record",open:"open",kept:"kept",broken:"broken",released:"released",offscreen:"scheduled time passed; outcome unknown"};
const recognitionActionLabel: Record<string,string> = {establish:"first learned",retract:"no longer recognized"};
const plainStateValues: Record<string,string> = {
  affection:"affection",trust:"trust",intimacy:"closeness",fear:"fear",jealousy:"jealousy",hostility:"hostility",
  increase:"increased",decrease:"decreased",reveal:"came to light",complicate:"became complicated",resolve:"was resolved",
  minor:"small change",meaningful:"meaningful change",major:"major change",turning:"turning point",
  unknown:"not recorded",aversion:"aversion",none:"none",faint:"slight",growing:"growing",established:"established",strong:"strong",deep:"deep",conflicted:"mixed feelings",
  distrust:"distrust",fragile:"fragile",developing:"developing",avoidant:"avoids closeness",tentative:"tentative",
  low:"low",moderate:"moderate",high:"high",extreme:"extreme",rising:"increasing",stable:"unchanged",falling:"decreasing",volatile:"changing often",unclear:"direction unclear",
};
const plainStateValue = (value: string): string => plainStateValues[value] ?? "not recorded";

/** One presentation for current/history equality; retrieval text stays untouched. */
export function stateEvidenceText(item: StateEvidence): string {
  const display=item.automatic;
  if(item.displayText)return item.displayText;
  if(!display)return item.text;
  if(item.kind === "recognition" || item.kind === "recognition_history"){
    const names=display.knownAs ?? [], subject=item.subjects[1] ?? "them";
    const naming=recognitionNaming(subject,names);
    return `${item.subjects[0]} → ${subject}: ${joinSentences([naming, display.body ? `Sees them as: ${display.body}` : undefined, display.addressTerms?.length ? `Calls ${display.addressTerms.map(term=>JSON.stringify(term)).join(", ")}.` : undefined, display.recognitionLevel ? socialKnowledgeLevelLabel[display.recognitionLevel] : undefined])}`;
  }
  return `${item.kind === "basic_relation" ? display.subject.replaceAll(" → ", " & ") : display.subject}: ${display.body}${display.tensions?.length ? ` Tension: ${display.tensions.join("; ")}` : ""}${item.relationship?.stale ? " [Last recorded relationship; update pending.]" : ""}${item.due ? ` Due: ${item.due}.` : ""}`;
}

/** Condition includes location/status in the stored enum; never classify prose. */
export function lastRecordedStateText(item: StateEvidence, text: string): string {
  return item.current && item.kind==="world_fact" && item.stateKind==="condition"
    ? `Last recorded${item.recordedStoryTime ? ` (${item.recordedStoryTime})` : ""}: ${text}` : text;
}

export function stateMcpEvidence(item: StateEvidence): McpEvidence {
  const narratorOnly = stateEvidenceScope(item)?.kind === "narrator";
  const kind = item.kind === "promise_history" ? "Promise" : item.kind === "recognition_history" ? "Recognition" : stateKindLabel(item.kind,item.stateKind);
  const label = item.historyLabel ? `Earlier (${item.historyLabel})` : item.kind === "promise" ? `${kind}, ${promiseStatusLabel[item.promiseStatus ?? "open"] ?? "outcome unknown"}` : kind;
  return { atomKey: `state:${item.id}:${item.fingerprint}`, kind: "fact", text: `${label}: ${lastRecordedStateText(item,stateEvidenceText(item))}`,
    knownBy:narratorOnly ? [NARRATOR_ARCHIVE_HOLDER] : item.holders, knownByLabels:narratorOnly ? undefined : item.knownByLabels,
    recognitionId:item.kind === "recognition" && item.current ? item.id : undefined,
    basis:item.kind === "belief" ? "recorded belief" : item.current ? "current recorded state" : "historical record" };
}
