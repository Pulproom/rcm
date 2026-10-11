import { parseSocialRelation, sameSocialRelationScope } from "./social-relations.js";
import { transitionEvidenceJson, canAutomaticallyChange, committedEditOrdinal, USER_CORRECTION_GUIDANCE } from "./user-corrections.js";
import { createHash, randomUUID } from "node:crypto";
import {
  estimateTokens, measureAuxiliaryPrompt,
  STORY_TIME_GUIDANCE, STATE_CLASSIFICATION_GUIDANCE,
  ExtractionResultSchema,
  ReconciliationResultSchema,
  type ExtractionDraftResult,
  type ExtractionResult,
  type ReconciliationResult,
  type ReconciliationSubmission,
  type StateObservation,
} from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { ingestExtraction } from "./ingest.js";
import { normalizeLedgerPredicate, normalizeLedgerText } from "./normalization.js";
import { buildEntityIdentityResolver, type ResolvedEntityIdentity } from "./entities.js";

type ObservationKind = StateObservation["kind"];
interface Candidate { id: string; kind: ObservationKind; value: Record<string, unknown>; immutable?: boolean }
interface CandidateEntry { itemRef: string; observation: StateObservation; candidates: Candidate[] }

export const normalizePredicate = normalizeLedgerPredicate;
export const normalizeText = normalizeLedgerText;
const stableHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const parseEvidence = (value: unknown): unknown[] => {
  try { return Array.isArray(value) ? value : JSON.parse(String(value ?? "[]")); }
  catch { return []; }
};

const placeholders = (values: string[]): string => values.map(() => "?").join(",");

function candidatesFor(db: RcmDatabase, chatId: string, observation: StateObservation, resolve: (value: string) => ResolvedEntityIdentity): Candidate[] {
  if (observation.kind === "world_fact") {
    const subjects = resolve(observation.subject).variants;
    return (db.prepare(`SELECT *
      FROM assertions WHERE chat_id=? AND subject COLLATE NOCASE IN (${placeholders(subjects)}) AND valid_to_revision IS NULL
      ORDER BY valid_from_revision,created_at`).all(chatId, ...subjects) as Array<Record<string, unknown>>).filter(row => sameSocialRelationScope(row.social_relation_json, observation.socialRelation)).map((row) => ({
        id: String(row.id), kind: observation.kind, value: { ...row, evidence: parseEvidence(row.evidence_json) },
        immutable: !canAutomaticallyChange(db,chatId,row,observation.evidence),
      }));
  }
  if (observation.kind === "character_belief") {
    const holders = resolve(observation.holder).variants;
    const subjects = resolve(observation.subject).variants;
    return (db.prepare(`SELECT *
      FROM beliefs WHERE chat_id=? AND holder COLLATE NOCASE IN (${placeholders(holders)}) AND subject COLLATE NOCASE IN (${placeholders(subjects)}) AND active=1 AND status='active'
      ORDER BY created_revision,created_at`).all(chatId, ...holders, ...subjects) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id), kind: observation.kind, value: { ...row, evidence: parseEvidence(row.evidence_json) }, immutable: !canAutomaticallyChange(db,chatId,row,observation.evidence),
      }));
  }
  const promisors = resolve(observation.promisor).variants;
  const promisees = resolve(observation.promisee).variants;
  return (db.prepare(`SELECT *
    FROM promises WHERE chat_id=? AND promisor COLLATE NOCASE IN (${placeholders(promisors)}) AND promisee COLLATE NOCASE IN (${placeholders(promisees)})
    ORDER BY updated_revision,created_at`).all(chatId, ...promisors, ...promisees) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), kind: observation.kind, value: row, immutable: !canAutomaticallyChange(db,chatId,row,observation.evidence),
    }));
}

export interface PreparedReconciliation {
  required: boolean;
  candidateSetHash?: string;
  systemPrompt?: string;
  userPrompt?: string;
  items: CandidateEntry[];
  local: StateObservation[];
  deferred: CandidateEntry[];
  parts?: Array<{ systemPrompt: string; userPrompt: string; itemRefs: string[]; estimatedInputTokens: number }>;
}

export function prepareReconciliation(db: RcmDatabase, chatId: string, draft: ExtractionDraftResult, maxInputTokens = 80_000): PreparedReconciliation {
  const resolve = buildEntityIdentityResolver(db, chatId);
  const canonicalize = (observation: StateObservation): StateObservation => {
    if (observation.kind === "world_fact") return { ...observation, subject: resolve(observation.subject).canonical, ...(observation.socialRelation ? { socialRelation: { ...observation.socialRelation, target: resolve(observation.socialRelation.target).canonical } } : {}) };
    if (observation.kind === "character_belief") return { ...observation, holder: resolve(observation.holder).canonical, subject: resolve(observation.subject).canonical };
    return { ...observation, promisor: resolve(observation.promisor).canonical, promisee: resolve(observation.promisee).canonical };
  };
  const all = draft.stateObservations.map(canonicalize).map((observation) => ({ itemRef: `observation:${observation.key}`, observation, candidates: candidatesFor(db, chatId, observation, resolve) }));
  const candidates = all.filter((entry) => entry.candidates.length > 0);
  const local = all.filter((entry) => entry.candidates.length === 0).map((entry) => entry.observation);
  const systemPrompt = `You reconcile source-grounded roleplay state observations with a bounded canonical ledger, comparing the same property even if wording changed. Return strict JSON only as {"decisions":[{"itemRef":"observation:...","action":"create|reinforce|supersede|end|coexist|dispute|ignore","targetIds":["allowed existing id"],"reason":"short reason"}]}. Return exactly one decision for every supplied itemRef. Use only supplied target IDs. Never target immutable=true. create, coexist and ignore use no target; reinforce, supersede, end and dispute require a target. Treat each observation as a candidate interpretation. Read cited evidence and preserve statements, beliefs, attempts and completed events as different things. Ignore unsupported interpretations. A passed deadline or silence never proves a world fact, belief or promise ended. Event memories are preserved separately.\n${STATE_CLASSIFICATION_GUIDANCE}\n${STORY_TIME_GUIDANCE}\n${USER_CORRECTION_GUIDANCE}`;
  const items: CandidateEntry[] = [];
  const deferred: CandidateEntry[] = [];
  const pageEntries: CandidateEntry[][] = [];
  let page: CandidateEntry[] = [];
  const render = (entries: CandidateEntry[]) => JSON.stringify({ items: entries.map(({ itemRef, observation, candidates: found }) => ({ itemRef, observation, candidates: found })) });
  for (const entry of candidates) {
    const trial = [...page, entry];
    if (measureAuxiliaryPrompt([{ role: "system", content: systemPrompt }, { role: "user", content: render(trial) }], estimateTokens, { maxInputTokens, maxOutputTokens: 0 }).fits) { page = trial; items.push(entry); continue; }
    if (page.length) { pageEntries.push(page); page = []; }
    if (measureAuxiliaryPrompt([{ role: "system", content: systemPrompt }, { role: "user", content: render([entry]) }], estimateTokens, { maxInputTokens, maxOutputTokens: 0 }).fits) { page = [entry]; items.push(entry); }
    else deferred.push(entry);
  }
  if (page.length) pageEntries.push(page);
  if (!items.length) return { required: false, items: [], local, deferred };
  const publicItems = items.map(({ itemRef, observation, candidates }) => ({ itemRef, observation, candidates }));
  const parts = pageEntries.map((entries) => { const userPrompt = render(entries); return { systemPrompt, userPrompt,
    itemRefs: entries.map((entry) => entry.itemRef), estimatedInputTokens: measureAuxiliaryPrompt([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], estimateTokens, { maxInputTokens, maxOutputTokens: 0 }).estimatedInputTokens }; });
  return {
    required: true,
    candidateSetHash: stableHash(publicItems.map(({ itemRef, candidates }) => ({ itemRef, candidates }))),
    systemPrompt: parts[0]!.systemPrompt,
    userPrompt: parts[0]!.userPrompt,
    parts,
    items,
    local,
    deferred,
  };
}

function emptyFinal(draft: ExtractionDraftResult): ExtractionResult {
  return ExtractionResultSchema.parse({
    language: draft.language,
    entities: draft.entities,
    memories: draft.memories,
    sourcePassages: draft.sourcePassages,
    relationshipEvents: draft.relationshipEvents,
    socialKnowledge: draft.socialKnowledge,
    relationshipBaselines: draft.relationshipBaselines,
    physicalIntimacy: draft.physicalIntimacy,
    memoryRecallObservations: draft.memoryRecallObservations,
    atomRelations: draft.atomRelations,
    seedResolutions: draft.seedResolutions,
  });
}

const promiseStatus = (event: Extract<StateObservation, { kind: "promise_event" }>["event"]): "open" | "kept" | "broken" | "released" | "offscreen" =>
  event === "kept" || event === "broken" || event === "released" ? event : event === "scheduled_passed" ? "offscreen" : "open";

function addObservation(result: ExtractionResult, observation: StateObservation, action: string, targetIds: string[], canonical?: string, compatibleWithIds?: string[]): void {
  if (observation.kind === "world_fact") {
    result.assertions.push({
      subject: observation.subject, predicate: canonical || observation.predicateHint, value: observation.value,
      ...(compatibleWithIds?.length ? { compatibleWithIds } : {}),
      socialRelation: observation.socialRelation, validFromMemoryKey: observation.socialRelation?.memoryKey,
      stateKind: observation.socialRelation ? "condition" : observation.stateKind,
      changeType: action === "supersede" ? "update" : action === "dispute" ? "claim" : "initial",
      confidence: observation.confidence, evidence: observation.evidence, retention: observation.retention,
      ...(targetIds.length ? { targetAssertionIds: targetIds } : {}),
    });
  } else if (observation.kind === "character_belief") {
    result.beliefs.push({
      holder: observation.holder, subject: observation.subject, predicate: canonical || observation.predicateHint, value: observation.value,
      polarity: observation.stance, confidence: observation.confidence, source: observation.source, evidence: observation.evidence,
      retention: observation.retention, action: action === "create" ? "new" : action === "end" ? "supersede" : action as "reinforce" | "supersede" | "coexist" | "dispute",
      ...(compatibleWithIds?.length ? { compatibleWithIds } : {}),
      ...(targetIds.length ? { targetBeliefId: targetIds[0], targetBeliefIds: targetIds } : {}),
    });
  } else {
    result.promises.push({
      key: canonical || observation.promiseKeyHint, promisor: observation.promisor, promisee: observation.promisee,
      content: observation.content, status: promiseStatus(observation.event), scheduledFor: observation.scheduledFor,
      statusReason: observation.statusReason, memoryKey: observation.memoryKey, scope: observation.scope,
      evidence: observation.evidence, access: observation.access,
      ...(compatibleWithIds?.length ? { compatibleWithIds } : {}),
    });
  }
}

function recordReview(db: RcmDatabase, chatId: string, jobId: string, sourceIds: string[], entry: CandidateEntry, decision: unknown, error: string): void {
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number }).revision;
  db.prepare(`INSERT INTO reconciliation_items(id,chat_id,job_id,item_ref,item_kind,incoming_json,candidates_json,model_decision_json,model_error,source_message_ids_json,status,created_revision,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(randomUUID(), chatId, jobId, entry.itemRef, entry.observation.kind, JSON.stringify({ item: entry.observation }), JSON.stringify(entry.candidates), decision ? JSON.stringify(decision) : null, error, JSON.stringify(sourceIds), revision, Date.now());
}

function recordAutomatic(db: RcmDatabase, chatId: string, jobId: string, sourceIds: string[], entry: CandidateEntry, decision: unknown, status: string): void {
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number }).revision;
  const timestamp = Date.now();
  db.prepare(`INSERT INTO reconciliation_items(id,chat_id,job_id,item_ref,item_kind,incoming_json,candidates_json,model_decision_json,source_message_ids_json,status,resolution_json,created_revision,created_at,resolved_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), chatId, jobId, entry.itemRef, entry.observation.kind, JSON.stringify({ item: entry.observation }), JSON.stringify(entry.candidates), JSON.stringify(decision), JSON.stringify(sourceIds), status, JSON.stringify({ automatic: true }), revision, timestamp, timestamp);
}

export function applyReconciliation(db: RcmDatabase, chatId: string, jobId: string, sourceIds: string[], draft: ExtractionDraftResult, submission?: ReconciliationSubmission): { result: ExtractionResult; pending: number; autoResolved: number } {
  const row = db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(jobId) as { payload_json: string } | undefined;
  let maxInputTokens = 80_000;
  try { const payload = JSON.parse(row?.payload_json ?? "{}"); maxInputTokens = Number(payload.auxiliaryBudget?.maxInputTokens ?? payload.serverLlmSnapshot?.maxInputTokens ?? maxInputTokens); } catch { /* use stable default */ }
  const prepared = prepareReconciliation(db, chatId, draft, maxInputTokens);
  const result = emptyFinal(draft);
  let parsed: ReconciliationResult | undefined;
  if (prepared.required) {
    if (!submission) throw new Error("Worker did not provide state reconciliation data");
    if (submission.error) throw new Error(`State reconciliation failed: ${submission.error}`);
    if (submission.candidateSetHash !== prepared.candidateSetHash) throw new Error("Candidate set changed before completion");
    parsed = ReconciliationResultSchema.parse(submission.result);
    const expectedRefs = new Set(prepared.items.map((entry) => entry.itemRef));
    const seen = new Set<string>();
    for (const decision of parsed.decisions) {
      if (!expectedRefs.has(decision.itemRef)) throw new Error(`Model returned an unknown reconciliation itemRef: ${decision.itemRef}`);
      if (seen.has(decision.itemRef)) throw new Error(`Model returned duplicate reconciliation decisions for ${decision.itemRef}`);
      seen.add(decision.itemRef);
    }
    for (const itemRef of expectedRefs) if (!seen.has(itemRef)) throw new Error(`Missing model decision for ${itemRef}`);
  }
  for (const observation of prepared.local) addObservation(result, observation, "create", [], observation.kind === "promise_event" ? observation.promiseKeyHint : observation.predicateHint);
  let pending = 0;
  for (const entry of prepared.deferred) {
    recordReview(db, chatId, jobId, sourceIds, entry, undefined, `State candidate item and its required prior state exceed the configured ${maxInputTokens}-token input budget`);
    pending += 1;
  }
  if (!prepared.required) return { result, pending, autoResolved: prepared.local.length };
  const decisions = new Map(parsed!.decisions.map((decision) => [decision.itemRef, decision]));
  let autoResolved = prepared.local.length;
  for (const entry of prepared.items) {
    const decision = decisions.get(entry.itemRef)!;
    const targets = decision.targetIds.map((id) => entry.candidates.find((candidate) => candidate.id === id)).filter(Boolean) as Candidate[];
    if (targets.length !== decision.targetIds.length) throw new Error(`Model selected a target outside the allowed candidates for ${entry.itemRef}`);
    const needsTarget = ["reinforce", "supersede", "end", "dispute"].includes(decision.action);
    if (needsTarget && targets.length === 0) throw new Error(`${decision.action} requires a target for ${entry.itemRef}`);
    if (["create", "coexist", "ignore"].includes(decision.action) && targets.length > 0) throw new Error(`${decision.action} cannot select a target for ${entry.itemRef}`);
    const predicate = normalizePredicate(entry.observation.kind === "promise_event" ? entry.observation.promiseKeyHint : entry.observation.predicateHint);
    const protectedProperty = entry.candidates.filter(candidate => candidate.immutable && (["create","coexist"].includes(decision.action) || normalizePredicate(String(candidate.value.predicate ?? candidate.value.promise_key)) === predicate));
    const compatible = ((decision.action === "coexist" && entry.observation.kind === "character_belief")
      || decision.action === "create" && entry.observation.kind !== "character_belief" && protectedProperty.every(candidate => normalizePredicate(String(candidate.value.predicate ?? candidate.value.promise_key)) !== predicate))
      && protectedProperty.every(candidate => decision.compatibleWithIds?.includes(candidate.id));
    if (decision.compatibleWithIds?.some(id => !entry.candidates.some(candidate => candidate.id === id))) throw new Error("Coexistence references an unavailable candidate");
    if (targets.some((target) => target.immutable) || decision.action !== "ignore" && protectedProperty.length && !compatible) {
      recordReview(db, chatId, jobId, sourceIds, entry, decision, "User-managed canonical state cannot be changed automatically");
      pending += 1;
      continue;
    }
    if (decision.action === "ignore") { recordAutomatic(db, chatId, jobId, sourceIds, entry, decision, "ignored"); autoResolved += 1; continue; }
    const canonical = entry.observation.kind === "promise_event"
      ? String(targets[0]?.value.promise_key ?? entry.observation.promiseKeyHint)
      : String(targets[0]?.value.predicate ?? entry.observation.predicateHint);
    if (decision.action === "end" && entry.observation.kind !== "promise_event") {
      const ordinal = entry.observation.evidence.length ? (db.prepare("SELECT MIN(ordinal) AS ordinal FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))").get(chatId, JSON.stringify(entry.observation.evidence.map((item) => item.messageId))) as { ordinal: number | null }).ordinal : null;
      for (const target of targets ?? []) {
        if (entry.observation.kind === "world_fact") db.prepare("UPDATE assertions SET valid_to_revision=(SELECT revision FROM chats WHERE id=?),valid_to_ordinal=?,automatic_closure_evidence_json=? WHERE id=? AND chat_id=? AND valid_to_revision IS NULL").run(chatId, ordinal, transitionEvidenceJson(db,chatId,entry.observation.evidence), target.id, chatId);
        else db.prepare("UPDATE beliefs SET active=0,status='superseded',valid_to_ordinal=?,automatic_closure_evidence_json=? WHERE id=? AND chat_id=? AND active=1").run(ordinal, transitionEvidenceJson(db,chatId,entry.observation.evidence), target.id, chatId);
      }
    } else addObservation(result, entry.observation, decision.action, decision.targetIds, canonical, decision.compatibleWithIds);
    recordAutomatic(db, chatId, jobId, sourceIds, entry, decision, decision.action);
    autoResolved += 1;
  }
  return { result: ExtractionResultSchema.parse(result), pending, autoResolved };
}

export interface ReconciliationReviewItem { id: string; itemRef: string; itemKind: ObservationKind; incoming: StateObservation; candidates: Candidate[]; decision?: unknown; error?: string; status: string; createdAt: number; resolvedAt?: number }
export function listReconciliationReviews(db: RcmDatabase, chatId: string): ReconciliationReviewItem[] {
  const rows = db.prepare("SELECT * FROM reconciliation_items WHERE chat_id=? ORDER BY status='pending' DESC,created_at DESC LIMIT 100").all(chatId) as Array<Record<string, any>>;
  return rows.map((row) => ({ id: row.id, itemRef: row.item_ref, itemKind: row.item_kind, incoming: JSON.parse(row.incoming_json).item, candidates: JSON.parse(row.candidates_json), decision: row.model_decision_json ? JSON.parse(row.model_decision_json) : undefined, error: row.model_error ?? undefined, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at ?? undefined }));
}

export function resolveReconciliationReview(db: RcmDatabase, chatId: string, reviewId: string, input: { action: "merge" | "distinct" | "update" | "discard"; targetId?: string; editedItem?: unknown }): void {
  const row = db.prepare("SELECT * FROM reconciliation_items WHERE id=? AND chat_id=? AND status='pending'").get(reviewId, chatId) as Record<string, any> | undefined;
  if (!row) throw Object.assign(new Error("Reconciliation review is no longer pending"), { code: "RECONCILIATION_REVIEW_NOT_PENDING" });
  const observation = (input.editedItem ?? JSON.parse(row.incoming_json).item) as StateObservation;
  const candidates = JSON.parse(row.candidates_json) as Candidate[];
  if (input.action !== "discard") {
    const result = ExtractionResultSchema.parse({ language: "en" });
    const target = candidates.find((candidate) => candidate.id === input.targetId);
    if ((input.action === "merge" || input.action === "update") && !target) throw new Error("Review target is unavailable; review remains pending");
    const action = input.action === "merge" ? "reinforce" : input.action === "update" ? "supersede" : "create";
    const canonical = observation.kind === "promise_event" ? String(target?.value.promise_key ?? observation.promiseKeyHint) : String(target?.value.predicate ?? observation.predicateHint);
    addObservation(result, observation, action, target ? [target.id] : [], canonical);
    db.transaction(() => {
      const conflicts = Number((db.prepare("SELECT COUNT(*) n FROM conflicts WHERE chat_id=?").get(chatId) as {n:number}).n);
      const table = observation.kind === "world_fact" ? "assertions" : observation.kind === "character_belief" ? "beliefs" : "promises";
      const currentClause=table==='assertions'?'valid_to_revision IS NULL':table==='beliefs'?"active=1 AND status='active'":"status<>'invalidated'";
      if (target && !db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND chat_id=? AND ${currentClause}`).get(target.id,chatId)) throw new Error("Review target is unavailable; review remains pending");
      const before=db.prepare(`SELECT * FROM ${table} WHERE chat_id=?`).all(chatId) as Array<Record<string,any>>;
      ingestExtraction(db, chatId, result, undefined, undefined, undefined, true);
      if (Number((db.prepare("SELECT COUNT(*) n FROM conflicts WHERE chat_id=?").get(chatId) as {n:number}).n) > conflicts) throw new Error("Review application was rejected; review remains pending");
      const after=db.prepare(`SELECT * FROM ${table} WHERE chat_id=?`).all(chatId) as Array<Record<string,any>>;
      const changed=after.filter(item=>!before.some(prior=>prior.id===item.id && JSON.stringify(prior)===JSON.stringify(item)));
      const canonical=target && after.find(item=>item.id===target.id);
      // Explicit confirmation of an identical current record is a valid merge,
      // even if reinforcement wrote the same fields. This is typed equality,
      // not a local interpretation of the observation's prose.
      const confirmed=input.action==='merge' && canonical && (observation.kind==='character_belief'
        ? canonical.holder===observation.holder && canonical.subject===observation.subject && canonical.value===observation.value && canonical.polarity===observation.stance
        : observation.kind==='world_fact' ? canonical.subject===observation.subject && canonical.value===observation.value && canonical.state_kind===observation.stateKind
        : canonical.promisor===observation.promisor && canonical.promisee===observation.promisee && canonical.content===observation.content && canonical.status===promiseStatus(observation.event));
      if(!changed.length && confirmed) changed.push(canonical);
      if(!changed.length) throw new Error("Review application did not change state; review remains pending");
      for(const item of changed.filter(item=>table==='assertions'?item.valid_to_revision==null:table==='beliefs'?item.active===1:item.status!=='invalidated')) {
        db.prepare(`UPDATE ${table} SET user_edit_ordinal=? WHERE id=? AND chat_id=?`).run(committedEditOrdinal(db,chatId),item.id,chatId);
      }
    })();
  }
  db.prepare("UPDATE reconciliation_items SET status=?,resolution_json=?,resolved_at=? WHERE id=?").run(input.action === "discard" ? "discarded" : input.action === "distinct" ? "kept_separate" : input.action === "update" ? "updated" : "merged", JSON.stringify(input), Date.now(), reviewId);
}
