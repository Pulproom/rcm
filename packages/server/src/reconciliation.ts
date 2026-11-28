import { assertChatUnlocked, chatUpgradeLock } from './upgrade-lock.js';
import { stateCandidateValue } from './now-delivery.js';
import { finishReviewedBatches, coverageRetryFamilies } from './source-coverage.js';
import { stateDetailSupport } from "@rcm/shared";
import { type StateItemDrop } from "@rcm/shared";
import { appendJobStateDrops } from "./jobs.js";
import { ModelContentValidationError } from "@rcm/shared";
import { ROLEPLAY_ARCHIVE_FRAMING } from "@rcm/shared";
import { parseSocialRelation, sameSocialRelationScope, resolveSocialRelation, resolveStateDetailLinks, UNSUPPORTED_SOCIAL_RELATION } from "./social-relations.js";
import { remapStateMemoryKeys, scopeMemoryKey } from './extraction-memory-keys.js';
import { transitionEvidenceJson, compatibleIndependentAssertion, canAutomaticallyChange, committedEditOrdinal, USER_CORRECTION_GUIDANCE } from "./user-corrections.js";
import { createHash, randomUUID } from "node:crypto";
import {
  estimateTokens, measureAuxiliaryPrompt,
  STORY_TIME_GUIDANCE, STATE_CLASSIFICATION_GUIDANCE,
  ExtractionResultSchema,
  StateObservationSchema,
  ReconciliationResultSchema,
  ReconciliationDecisionSchema,
  type ExtractionDraftResult,
  type ExtractionResult,
  type ReconciliationResult,
  type ReconciliationSubmission,
  type StateObservation,
} from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { ingestExtraction, preserveLinkedAssertionAccess } from "./ingest.js";
import { normalizeLedgerPredicate, normalizeLedgerText } from "./normalization.js";
import { buildEntityIdentityResolver, type ResolvedEntityIdentity } from "./entities.js";

type ObservationKind = StateObservation["kind"];
interface Candidate { id: string; kind: ObservationKind; value: Record<string, unknown>; immutable?: boolean }
export interface CandidateEntry { itemRef: string; observation: StateObservation; candidates: Candidate[]; reviewReason?: string }
export const UNSUPPLIED_STATE_REVIEW_REASON = 'Same-property prior candidates were not supplied to the state model; review before creating concurrent state';

export const normalizePredicate = normalizeLedgerPredicate;
export const normalizeText = normalizeLedgerText;
const stableHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const parseEvidence = (value: unknown): unknown[] => {
  try { return Array.isArray(value) ? value : JSON.parse(String(value ?? "[]")); }
  catch { return []; }
};

/** candidatesFor already checks resolved identities and social-relation scope.
 * Beliefs have no separate proposition key: predicate is their typed property key.
 * Different-key semantic equivalence remains the model's responsibility. */
export function hasUnsuppliedStateProperty(entry: CandidateEntry, suppliedIds: ReadonlySet<string>): boolean {
  const observation = entry.observation;
  const key = normalizePredicate(observation.kind === 'promise_event' ? observation.promiseKeyHint : observation.predicateHint);
  return entry.candidates.some(candidate => !suppliedIds.has(candidate.id)
    && normalizePredicate(String(candidate.value.predicate ?? candidate.value.promise_key ?? '')) === key);
}

function requiresProtectedStateReview(entry: CandidateEntry, decision: ReconciliationResult['decisions'][number]): boolean {
  const predicate = normalizePredicate(entry.observation.kind === 'promise_event' ? entry.observation.promiseKeyHint : entry.observation.predicateHint);
  const protectedProperty = entry.candidates.filter(candidate => candidate.immutable && normalizePredicate(String(candidate.value.predicate ?? candidate.value.promise_key)) === predicate);
  const compatible = decision.action === 'coexist' && entry.observation.kind === 'character_belief'
    && protectedProperty.every(candidate => decision.compatibleWithIds?.includes(candidate.id));
  const independentAssertion=entry.observation.kind==='world_fact' && compatibleIndependentAssertion({create:decision.action==='create',targetIds:decision.targetIds,compatibleWithIds:decision.compatibleWithIds,protectedIds:protectedProperty.map(candidate=>candidate.id),candidateIds:entry.candidates.map(candidate=>candidate.id)});
  return decision.targetIds.some(id => entry.candidates.some(candidate => candidate.id === id && candidate.immutable))
    || decision.action !== 'ignore' && protectedProperty.length > 0 && !compatible && !independentAssertion;
}

const placeholders = (values: string[]): string => values.map(() => "?").join(",");

function candidatesFor(db: RcmDatabase, chatId: string, observation: StateObservation, resolve: (value: string) => ResolvedEntityIdentity): Candidate[] {
  if (observation.kind === "world_fact") {
    const subjects = resolve(observation.subject).variants;
    return (db.prepare(`SELECT *
      FROM assertions WHERE chat_id=? AND subject COLLATE NOCASE IN (${placeholders(subjects)}) AND valid_to_revision IS NULL
      ORDER BY valid_from_revision,created_at`).all(chatId, ...subjects) as Array<Record<string, unknown>>).filter(row => sameSocialRelationScope(row.social_relation_json, observation.socialRelation, resolve)).map((row) => ({
        id: String(row.id), kind: observation.kind, value: { ...stateCandidateValue(row), evidence: parseEvidence(row.evidence_json) },
        immutable: !canAutomaticallyChange(db,chatId,row,observation.evidence),
      }));
  }
  if (observation.kind === "character_belief") {
    const holders = resolve(observation.holder).variants;
    const subjects = resolve(observation.subject).variants;
    return (db.prepare(`SELECT *
      FROM beliefs WHERE chat_id=? AND holder COLLATE NOCASE IN (${placeholders(holders)}) AND subject COLLATE NOCASE IN (${placeholders(subjects)}) AND active=1 AND status='active'
      ORDER BY created_revision,created_at`).all(chatId, ...holders, ...subjects) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id), kind: observation.kind, value: { ...stateCandidateValue(row), evidence: parseEvidence(row.evidence_json) }, immutable: !canAutomaticallyChange(db,chatId,row,observation.evidence),
      }));
  }
  const promisors = resolve(observation.promisor).variants;
  const promisees = resolve(observation.promisee).variants;
  return (db.prepare(`SELECT *
    FROM promises WHERE chat_id=? AND promisor COLLATE NOCASE IN (${placeholders(promisors)}) AND promisee COLLATE NOCASE IN (${placeholders(promisees)})
    ORDER BY updated_revision,created_at`).all(chatId, ...promisors, ...promisees) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), kind: observation.kind, value: stateCandidateValue(row), immutable: !canAutomaticallyChange(db,chatId,row,observation.evidence),
    }));
}

export interface PreparedReconciliation {
  required: boolean;
  candidateSetHash?: string;
  systemPrompt?: string;
  userPrompt?: string;
  reviewExemptItemRefs?: string[];
  items: CandidateEntry[];
  local: StateObservation[];
  deferred: CandidateEntry[];
  parts?: Array<{ systemPrompt: string; userPrompt: string; itemRefs: string[]; reviewExemptItemRefs: string[]; estimatedInputTokens: number }>;
}

export function prepareReconciliation(db: RcmDatabase, chatId: string, draft: ExtractionDraftResult, maxInputTokens = 80_000): PreparedReconciliation {
  const resolve = buildEntityIdentityResolver(db, chatId);
  const canonicalize = (observation: StateObservation): StateObservation => {
    if (observation.kind === "world_fact") return { ...observation, subject: resolve(observation.subject).canonical, ...(observation.socialRelation ? { socialRelation: { ...observation.socialRelation, target: resolve(observation.socialRelation.target).canonical } } : {}) };
    if (observation.kind === "character_belief") return { ...observation, holder: resolve(observation.holder).canonical, subject: resolve(observation.subject).canonical };
    return { ...observation, promisor: resolve(observation.promisor).canonical, promisee: resolve(observation.promisee).canonical };
  };
  const all: CandidateEntry[] = draft.stateObservations.map(canonicalize).map((observation) => ({ itemRef: `observation:${observation.key}`, observation, candidates: candidatesFor(db, chatId, observation, resolve) }));
  for (const entry of all) {
    if (entry.observation.kind !== 'world_fact' || !entry.observation.socialRelation) continue;
    const relation=entry.observation.socialRelation;
    const refs=stateDetailSupport(relation) ?? [];
    const supported = refs.length && refs.every(ref=>draft.memories.some(memory=>memory.key===ref.memoryKey && memory.details?.some(detail=>detail.key===ref.detailKey)))
      || !!resolveSocialRelation(db, chatId, relation, new Map());
    if (!supported) {
      entry.reviewReason = UNSUPPORTED_SOCIAL_RELATION;
    }
    const subjects=resolve(entry.observation.subject).variants;
    const rows=db.prepare(`SELECT * FROM assertions WHERE chat_id=? AND subject COLLATE NOCASE IN (${placeholders(subjects)}) AND valid_to_revision IS NULL AND social_relation_json IS NOT NULL`).all(chatId,...subjects) as Array<Record<string,unknown>>;
    const ambiguous=resolve(relation.target).ambiguous;
    const uncertain=rows.filter(row=>{
      const stored=parseSocialRelation(row.social_relation_json)!;
      return stored.kind===relation.kind && stored.direction===relation.direction && (ambiguous || resolve(stored.target).ambiguous);
    });
    if (ambiguous || uncertain.length) {
      entry.reviewReason='Ambiguous social relation target; select an unambiguous entity before applying state';
      entry.candidates=uncertain.map(row=>({id:String(row.id),kind:entry.observation.kind,value:{...stateCandidateValue(row),evidence:parseEvidence(row.evidence_json)},immutable:!canAutomaticallyChange(db,chatId,row,entry.observation.evidence)}));
    }
  }
  const candidates = all.filter((entry) => entry.candidates.length > 0 || entry.reviewReason);
  const local = all.filter((entry) => entry.candidates.length === 0 && !entry.reviewReason).map((entry) => entry.observation);
  const systemPrompt = `${ROLEPLAY_ARCHIVE_FRAMING}

You reconcile source-grounded roleplay state observations with a bounded canonical ledger, comparing the same property even if wording changed. Return strict JSON only as {"decisions":[{"itemRef":"observation:...","action":"create|reinforce|supersede|end|coexist|dispute|ignore","targetIds":["allowed existing id"],"reason":"short reason"}]}. Return exactly one decision for every supplied itemRef. Use only supplied target IDs. Never target immutable=true. create, coexist and ignore use no target; reinforce, supersede, end and dispute require a target. Treat each observation as a candidate interpretation. Read cited evidence and preserve statements, beliefs, attempts and completed events as different things. Ignore unsupported interpretations. A passed deadline or silence never proves a world fact, belief or promise ended. Event memories are preserved separately.\n${STATE_CLASSIFICATION_GUIDANCE}\n${STORY_TIME_GUIDANCE}\n${USER_CORRECTION_GUIDANCE}`;
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
    reviewExemptItemRefs: entries.filter(entry => entry.reviewReason).map(entry => entry.itemRef),
    itemRefs: entries.map((entry) => entry.itemRef), estimatedInputTokens: measureAuxiliaryPrompt([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], estimateTokens, { maxInputTokens, maxOutputTokens: 0 }).estimatedInputTokens }; });
  return {
    required: true,
    candidateSetHash: stableHash(publicItems.map(({ itemRef, candidates }) => ({ itemRef, candidates }))),
    systemPrompt: parts[0]!.systemPrompt,
    userPrompt: parts[0]!.userPrompt,
    reviewExemptItemRefs: parts[0]!.reviewExemptItemRefs,
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
    pairProgress: draft.pairProgress,
  });
}

const promiseStatus = (event: Extract<StateObservation, { kind: "promise_event" }>["event"]): "open" | "kept" | "broken" | "released" | "offscreen" =>
  event === "kept" || event === "broken" || event === "released" ? event : event === "scheduled_passed" ? "offscreen" : "open";

/** Only an end that explicitly names an already-ended row is a no-op.
 * No identity is inferred for create/coexist, and unresolved rows stay reviewable. */
export function repeatsLedgerEnd(
  db: RcmDatabase, chatId: string, observation: StateObservation, decision: ReconciliationResult["decisions"][number],
): boolean {
  if (decision.action !== "end" || !decision.targetIds.length || decision.compatibleWithIds?.length
    || observation.kind === "promise_event") return false;
  const resolve = buildEntityIdentityResolver(db, chatId);
  const subject = resolve(observation.subject);
  const holder = observation.kind === "character_belief" ? resolve(observation.holder) : undefined;
  if (subject.ambiguous || holder?.ambiguous) return false;
  const statement = observation.kind === "world_fact"
    ? db.prepare("SELECT subject,predicate,social_relation_json FROM assertions WHERE chat_id=? AND id=? AND valid_to_revision IS NOT NULL")
    : db.prepare("SELECT holder,subject,predicate FROM beliefs WHERE chat_id=? AND id=? AND active=0 AND valid_to_ordinal IS NOT NULL AND status IN ('active','superseded') AND COALESCE(source,'') NOT LIKE 'user_deleted:%'");
  return decision.targetIds.every(id => {
    const row = statement.get(chatId, id) as { subject: string; holder?: string; predicate: string; social_relation_json?: string } | undefined;
    if (!row || normalizePredicate(row.predicate) !== normalizePredicate(observation.predicateHint)) return false;
    const sameIdentity = (stored: string, canonical: string) => {
      const identity = resolve(stored);
      return !identity.ambiguous && identity.canonical === canonical;
    };
    return sameIdentity(row.subject, subject.canonical) && (observation.kind === "world_fact"
      ? sameSocialRelationScope(row.social_relation_json, observation.socialRelation, resolve)
      : !!row.holder && sameIdentity(row.holder, holder!.canonical));
  });
}

/** An explicit repeat of a recorded outcome is a no-op, even across a user edit. */
function repeatsPromiseOutcome(observation: StateObservation, target: Candidate | undefined): boolean {
  if (observation.kind !== "promise_event" || target?.kind !== "promise_event") return false;
  if (observation.event !== "kept" && observation.event !== "broken" && observation.event !== "released") return false;
  const saved = target.value;
  return observation.promiseKeyHint === saved.promise_key
    && observation.promisor === saved.promisor && observation.promisee === saved.promisee
    && observation.content === saved.content && observation.event === saved.status
    && observation.scope === saved.retention_scope && !observation.amendment
    && (observation.scheduledFor === undefined || observation.scheduledFor === saved.scheduled_for)
    && (observation.statusReason === undefined || observation.statusReason === saved.status_reason)
    && observation.access === undefined && observation.support === undefined && observation.detailKeys === undefined;
}

function addObservation(result: ExtractionResult, observation: StateObservation, action: string, targetIds: string[], canonical?: string, compatibleWithIds?: string[]): void {
  if (observation.kind === "world_fact") {
    result.assertions.push({
      subject: observation.subject, predicate: canonical || observation.predicateHint, value: observation.value,
      ...(compatibleWithIds?.length ? { compatibleWithIds } : {}),
      socialRelation: observation.socialRelation, validFromMemoryKey: observation.memoryKey ?? observation.support?.[0]?.memoryKey ?? observation.socialRelation?.memoryKey,
      memoryKey: observation.memoryKey ?? observation.support?.[0]?.memoryKey, detailKeys: observation.detailKeys, support: observation.support,
      stateKind: observation.socialRelation ? "condition" : observation.stateKind,
      // Targeted initial is reinforce; untargeted initial is create/coexist.
      changeType: action === "supersede" ? "update" : action === "dispute" ? "claim" : "initial",
      confidence: observation.confidence, evidence: observation.evidence, retention: observation.retention,
      ...(targetIds.length ? { targetAssertionIds: targetIds } : {}),
    });
  } else if (observation.kind === "character_belief") {
    result.beliefs.push({
      memoryKey: observation.memoryKey ?? observation.support?.[0]?.memoryKey, detailKeys: observation.detailKeys, support: observation.support,
      holder: observation.holder, subject: observation.subject, predicate: canonical || observation.predicateHint, value: observation.value,
      polarity: observation.stance, confidence: observation.confidence, source: observation.source, evidence: observation.evidence,
      retention: observation.retention, action: action === "create" ? "new" : action === "end" ? "supersede" : action as "reinforce" | "supersede" | "coexist" | "dispute",
      ...(compatibleWithIds?.length ? { compatibleWithIds } : {}),
      ...(targetIds.length ? { targetBeliefId: targetIds[0], targetBeliefIds: targetIds } : {}),
    });
  } else {
    result.promises.push({
      key: canonical || observation.promiseKeyHint, promisor: observation.promisor, promisee: observation.promisee,
      content: observation.content, event: observation.event, amendment: observation.amendment,
      ...(observation.rewritesContent ? {rewritesContent: true} : {}),
      status: promiseStatus(observation.event), scheduledFor: observation.scheduledFor,
      statusReason: observation.statusReason, memoryKey: observation.memoryKey ?? observation.support?.[0]?.memoryKey, detailKeys: observation.detailKeys, support: observation.support, scope: observation.scope,
      evidence: observation.evidence, access: observation.access,
      ...(compatibleWithIds?.length ? { compatibleWithIds } : {}),
    });
  }
}

export function recordReconciliationReview(db: RcmDatabase, chatId: string, jobId: string, sourceIds: string[], entry: CandidateEntry, decision: unknown, error: string): void {
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number }).revision;
  db.prepare(`INSERT INTO reconciliation_items(id,chat_id,job_id,item_ref,item_kind,incoming_json,candidates_json,model_decision_json,model_error,source_message_ids_json,status,created_revision,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(randomUUID(), chatId, jobId, entry.itemRef, entry.observation.kind, JSON.stringify({ item: entry.observation }), JSON.stringify(entry.candidates), decision ? JSON.stringify(decision) : null, error, JSON.stringify(sourceIds), revision, Date.now());
  if(error===UNSUPPLIED_STATE_REVIEW_REASON) db.prepare("UPDATE jobs SET payload_json=json_set(payload_json,'$.stateInput.reviewCount',COALESCE(json_extract(payload_json,'$.stateInput.reviewCount'),0)+1) WHERE id=? AND json_type(payload_json,'$.stateInput')='object'").run(jobId);
}

/** Completion shares the storage mapping, including reserved/deleted-key suffixes.
 * Model decisions contain ledger IDs, not memory keys; do not rewrite their text. */
export function remapReconciliationReviews(db: RcmDatabase, chatId: string, jobId: string, keys: ReadonlyMap<string,string>): void {
  const rows = db.prepare("SELECT id,incoming_json,resolution_json FROM reconciliation_items WHERE chat_id=? AND job_id=? AND status='pending'")
    .all(chatId,jobId) as Array<{id:string;incoming_json:string;resolution_json:string|null}>;
  for (const row of rows) {
    const incoming=JSON.parse(row.incoming_json);
    const resolution=row.resolution_json ? JSON.parse(row.resolution_json) : null;
    if (resolution?.editedItem) resolution.editedItem=remapStateMemoryKeys(resolution.editedItem,keys);
    db.prepare('UPDATE reconciliation_items SET incoming_json=?,resolution_json=? WHERE id=?')
      .run(JSON.stringify({...incoming,item:remapStateMemoryKeys(incoming.item,keys)}),resolution ? JSON.stringify(resolution) : null,row.id);
  }
}

const missingReviewEvidence = () => Object.assign(new Error('근거 기억을 찾지 못해 적용하지 못했어요. 확인할 기록은 대기 상태로 남겨 두었어요.'),
  {code:'RECONCILIATION_EVIDENCE_UNAVAILABLE'});

/** Restore old draft-local links only within this producer's namespace. Old
 * inherited jobs have no original scope; their own copied batch snapshots and
 * memory ownership supply it without consulting a possibly deleted parent. */
function resolveReviewMemoryKeys(db:RcmDatabase,chatId:string,jobId:string,observation:StateObservation):StateObservation {
  const job=db.prepare('SELECT type,payload_json FROM jobs WHERE id=? AND chat_id=?').get(jobId,chatId) as {type:string;payload_json:string}|undefined;
  const payload=JSON.parse(job?.payload_json ?? '{}');
  const scope=job?.type==='memory_addition' ? `addition:${jobId}` : payload.batchId ?? payload.retryOfJobId ?? jobId;
  const batches=db.prepare('SELECT id,final_json FROM extraction_batches WHERE chat_id=? AND job_id=?').all(chatId,jobId) as Array<{id:string;final_json:string|null}>;
  const inheritedKeys=new Map<string,string>(batches.flatMap(batch=>(JSON.parse(batch.final_json ?? '{}').memories ?? [])
    .map((memory:{key:string})=>[memory.key,batch.id] as const)));
  const families=payload.inheritedReview ? coverageRetryFamilies(db,chatId) : new Map<string,string>();
  const remap=new Map<string,string>();
  const resolve=(key:string):string=>{
    if (remap.has(key)) return remap.get(key)!;
    const base=payload.episodeId && key===`episode:${payload.episodeId}` ? key : scopeMemoryKey(key,scope);
    const matchesBase=(candidate:string,expected:string)=>candidate===expected
      || candidate.startsWith(`${expected}#`) && /^#[1-9]\d*$/.test(candidate.slice(expected.length)) && Number(candidate.slice(expected.length+1))>=2;
    const candidates=db.prepare('SELECT memory_key,source_batch_id FROM memories WHERE chat_id=? AND active=1 AND (memory_key=? OR substr(memory_key,1,length(?)+1)=?||\'#\' OR memory_key IN (SELECT value FROM json_each(?)))')
      .all(chatId,base,base,base,JSON.stringify(payload.inheritedReview ? [...inheritedKeys.keys()] : [])) as Array<{memory_key:string;source_batch_id:string|null}>;
    const found=candidates.filter(candidate=> {
      if (payload.inheritedReview) {
        if (payload.retryOfJobId && matchesBase(candidate.memory_key,base)) return true;
        const owner=inheritedKeys.get(candidate.memory_key);
        if (!owner || candidate.source_batch_id!==(families.get(owner) ?? owner)) return false;
        if (key.startsWith('episode:') && matchesBase(candidate.memory_key,key)) return true;
        // Parse only the product-owned canonical key envelope; never prose.
        const match=/^batch:(.+):([a-f0-9]{64})(?:#[1-9]\d*)?$/.exec(candidate.memory_key);
        return matchesBase(candidate.memory_key,base) || !!match && matchesBase(candidate.memory_key,scopeMemoryKey(key,match[1]!));
      }
      // Source coverage may fold a retry into its owner batch. The canonical
      // namespace still records the exact producer scope after that transfer.
      return matchesBase(candidate.memory_key,base);
    });
    // A legacy local key can collide with an unrelated saved row. Resolve the
    // producer namespace first; exact canonical links require batch ownership.
    if (!found.length) {
      const direct=db.prepare('SELECT memory_key,source_batch_id FROM memories WHERE chat_id=? AND memory_key=? AND active=1').get(chatId,key) as {memory_key:string;source_batch_id:string|null}|undefined;
      const canonicalScope=/^batch:(.+):[a-f0-9]{64}(?:#[1-9]\d*)?$/.exec(key)?.[1];
      if (direct && (batches.some(batch=>direct.source_batch_id===(families.get(batch.id) ?? batch.id))
        || canonicalScope===scope
        || !batches.length && !direct.source_batch_id && !key.startsWith('batch:'))) found.push(direct);
    }
    if (found.length!==1) throw missingReviewEvidence();
    remap.set(key,found[0]!.memory_key);
    return found[0]!.memory_key;
  };
  const collect=(item:{memoryKey?:string;validFromMemoryKey?:string;support?:Array<{memoryKey:string}>})=>{
    if(item.memoryKey) resolve(item.memoryKey);
    if(item.validFromMemoryKey) resolve(item.validFromMemoryKey);
    for(const ref of item.support ?? []) resolve(ref.memoryKey);
  };
  collect(observation);
  if(observation.kind==='world_fact' && observation.socialRelation) collect(observation.socialRelation);
  const mapped=remapStateMemoryKeys(observation,remap);
  if (stateDetailSupport(mapped)!==undefined && !resolveStateDetailLinks(db,chatId,mapped,new Map())?.length
    || mapped.kind==='world_fact' && mapped.socialRelation && !resolveSocialRelation(db,chatId,mapped.socialRelation,new Map())) throw missingReviewEvidence();
  return mapped;
}

/** Convert new state without writing reconciliation decisions or closing rows. */
export function additiveReconciliationResult(draft: ExtractionDraftResult, submission?: ReconciliationSubmission, drops: StateItemDrop[] = []): ExtractionResult {
  const result = emptyFinal({...draft, seedResolutions: []});
  (draft.seedResolutions ?? []).forEach((candidate,index) => drops.push({ path: ["seedResolutions",index], list: "seedResolutions", point: "C11:additive_seed", reason: "C11:additive_seed: Memory additions cannot resolve existing seeds", candidate }));
  const decisions = new Map((submission?.result?.decisions ?? []).map(item => [item.itemRef, item]));
  for (const observation of draft.stateObservations) {
    const matches = submission?.result?.decisions.filter(decision => decision.itemRef === `observation:${observation.key}`);
    if (matches && matches.length !== 1) {
      drops.push({ path:["stateObservations",draft.stateObservations.indexOf(observation)], list:"stateObservations", key:observation.key, point:"C4:additive_decision_coverage", reason:"C4:additive_decision_coverage: missing or duplicate decision", candidate:{observation,decisions:matches} }); continue;
    }
    const decision = decisions.get(`observation:${observation.key}`);
    if (decision && (!['create', 'coexist', 'ignore'].includes(decision.action) || decision.targetIds.length)) {
      drops.push({ path: ["stateObservations", draft.stateObservations.indexOf(observation)], list: "stateObservations", key: observation.key, point: "C11:additive_decision", reason: "C11:additive_decision: Memory additions cannot change existing state", candidate: { observation, decision } });
      continue;
    }
    if (decision?.action !== 'ignore') addObservation(result, observation, decision?.action ?? 'create', [], undefined, decision?.compatibleWithIds);
  }
  return ExtractionResultSchema.parse(result);
}

function recordAutomatic(db: RcmDatabase, chatId: string, jobId: string, sourceIds: string[], entry: CandidateEntry, decision: unknown, status: string): void {
  const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number }).revision;
  const timestamp = Date.now();
  db.prepare(`INSERT INTO reconciliation_items(id,chat_id,job_id,item_ref,item_kind,incoming_json,candidates_json,model_decision_json,source_message_ids_json,status,resolution_json,created_revision,created_at,resolved_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), chatId, jobId, entry.itemRef, entry.observation.kind, JSON.stringify({ item: entry.observation }), JSON.stringify(entry.candidates), JSON.stringify(decision), JSON.stringify(sourceIds), status, JSON.stringify({ automatic: true }), revision, timestamp, timestamp);
}

export function applyReconciliation(db: RcmDatabase, chatId: string, jobId: string, sourceIds: string[], draft: ExtractionDraftResult, submission?: ReconciliationSubmission, validationBudget?: number, reviewItemRefs: ReadonlySet<string> = new Set()): { result: ExtractionResult; pending: number; autoResolved: number } {
  const row = db.prepare("SELECT payload_json FROM jobs WHERE id=?").get(jobId) as { payload_json: string } | undefined;
  let maxInputTokens = 80_000;
  try { const payload = JSON.parse(row?.payload_json ?? "{}"); maxInputTokens = Number(payload.auxiliaryBudget?.maxInputTokens ?? payload.serverLlmSnapshot?.maxInputTokens ?? maxInputTokens); } catch { /* use stable default */ }
  const prepared = prepareReconciliation(db, chatId, draft, validationBudget ?? maxInputTokens);
  const result = emptyFinal(draft);
  let parsed: ReconciliationResult | undefined;
  if (prepared.required) {
    if (!submission) throw new Error("Worker did not provide state reconciliation data");
    if (submission.error) throw new Error(`State reconciliation failed: ${submission.error}`);
    if (submission.candidateSetHash !== prepared.candidateSetHash) throw new Error("Candidate set changed before completion");
    parsed = ReconciliationResultSchema.parse(submission.result);
  } else if (submission?.result && !submission.error) {
    parsed = ReconciliationResultSchema.parse(submission.result);
  }

  const repeatedLocal = new Set<string>();
  for (const observation of prepared.local) {
    const ref = `observation:${observation.key}`;
    const matching = parsed?.decisions.filter(decision => decision.itemRef === ref) ?? [];
    if (matching.length === 1 && repeatsLedgerEnd(db, chatId, observation, matching[0]!)) {
      repeatedLocal.add(ref);
      continue;
    }
    addObservation(result, observation, "create", [], observation.kind === "promise_event" ? observation.promiseKeyHint : observation.predicateHint);
  }
  if (prepared.required) {
    const expected = new Set([...prepared.items.map(item => item.itemRef), ...repeatedLocal]);
    appendJobStateDrops(db, jobId, parsed!.decisions.flatMap((candidate, index) => expected.has(candidate.itemRef) ? []
      : [{ path: ["decisions", index], list: "decisions", point: "C4:decision_coverage", reason: "C4:decision_coverage: orphan decision", candidate }]));
  }

  let pending = 0;
  for (const entry of prepared.deferred) {
    recordReconciliationReview(db, chatId, jobId, sourceIds, entry, undefined, `State candidate item and its required prior state exceed the configured ${maxInputTokens}-token input budget`);
    pending += 1;
  }
  if (!prepared.required) return { result, pending, autoResolved: prepared.local.length };
  let autoResolved = prepared.local.length;
  for (const entry of prepared.items) {
    const matches = parsed!.decisions.filter(decision => decision.itemRef === entry.itemRef);
    const decision = matches.length === 1 ? matches[0]! : undefined;
    if (!decision) {
      recordReconciliationReview(db,chatId,jobId,sourceIds,entry,matches,"C4:decision_coverage: missing or duplicate decision"); pending++; continue;
    }
    if (entry.reviewReason) {
      recordReconciliationReview(db,chatId,jobId,sourceIds,entry,decision,entry.reviewReason);
      pending++; continue;
    }
    if (repeatsLedgerEnd(db, chatId, entry.observation, decision)) {
      recordAutomatic(db, chatId, jobId, sourceIds, entry, decision, "ignored");
      autoResolved += 1;
      continue;
    }
    const targets = decision.targetIds.map((id) => entry.candidates.find((candidate) => candidate.id === id)).filter(Boolean) as Candidate[];
    const invalidTarget = targets.length !== decision.targetIds.length;
    const needsTarget = ["reinforce", "supersede", "end", "dispute"].includes(decision.action);
    if (invalidTarget || (needsTarget && !targets.length) || (!needsTarget && targets.length)
      || decision.compatibleWithIds?.some(id => !entry.candidates.some(candidate => candidate.id === id))) {
      recordReconciliationReview(db,chatId,jobId,sourceIds,entry,decision,"C5:decision_targets: unavailable target, scope or action"); pending++; continue;
    }
    if(reviewItemRefs.has(entry.itemRef)) {
      recordReconciliationReview(db,chatId,jobId,sourceIds,entry,decision,UNSUPPLIED_STATE_REVIEW_REASON);
      pending++;continue;
    }
    if (decision.action === "reinforce" && targets.length === 1 && repeatsPromiseOutcome(entry.observation, targets[0])) {
      recordAutomatic(db, chatId, jobId, sourceIds, entry, decision, "ignored");
      autoResolved += 1;
      continue;
    }
    if (requiresProtectedStateReview(entry, decision)) {
      recordReconciliationReview(db, chatId, jobId, sourceIds, entry, decision, "C7:immutable_target: User-managed canonical state cannot be changed automatically");
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
    } else addObservation(result, entry.observation, decision.action, decision.targetIds, canonical,
      entry.observation.kind==='world_fact' && decision.action==='coexist' ? entry.candidates.map(candidate=>candidate.id) : decision.compatibleWithIds);
    recordAutomatic(db, chatId, jobId, sourceIds, entry, decision, decision.action);
    autoResolved += 1;
  }
  return { result: ExtractionResultSchema.parse(result), pending, autoResolved };
}

export interface ReconciliationReviewItem { id: string; itemRef: string; itemKind: ObservationKind; incoming: StateObservation; candidates: Candidate[]; decision?: unknown; error?: string; status: string; createdAt: number; resolvedAt?: number }
export function listReconciliationReviews(db: RcmDatabase, chatId: string, options: { pendingOnly?: boolean; reviewId?: string } = {}): ReconciliationReviewItem[] {
  const rows = db.prepare(`SELECT * FROM reconciliation_items WHERE chat_id=?${options.pendingOnly ? " AND status='pending'" : ""}${options.reviewId ? " AND id=?" : ""} ORDER BY status='pending' DESC,created_at DESC LIMIT 100`).all(chatId,...(options.reviewId ? [options.reviewId] : [])) as Array<Record<string, any>>;
  return rows.map((row) => ({ id: row.id, itemRef: row.item_ref, itemKind: row.item_kind, incoming: JSON.parse(row.incoming_json).item, candidates: JSON.parse(row.candidates_json), decision: row.model_decision_json ? JSON.parse(row.model_decision_json) : undefined, error: row.model_error ?? undefined, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at ?? undefined }));
}

export function resolveReconciliationReview(db: RcmDatabase, chatId: string, reviewId: string, input: { action: "merge" | "distinct" | "update" | "discard"; targetId?: string; editedItem?: unknown; automatic?: true }): void {
  db.transaction(() => {
  assertChatUnlocked(db,chatId);
  const row = db.prepare("SELECT * FROM reconciliation_items WHERE id=? AND chat_id=? AND status='pending'").get(reviewId, chatId) as Record<string, any> | undefined;
  if (!row) throw Object.assign(new Error("Reconciliation review is no longer pending"), { code: "RECONCILIATION_REVIEW_NOT_PENDING" });
  let observation = (input.editedItem ?? JSON.parse(row.incoming_json).item) as StateObservation;
  const candidates = JSON.parse(row.candidates_json) as Candidate[];
  if (input.action !== "discard") {
    observation=resolveReviewMemoryKeys(db,chatId,row.job_id,observation);
    const result = ExtractionResultSchema.parse({ language: "en" });
    const target = input.action==='merge' || input.action==='update' ? candidates.find((candidate) => candidate.id === input.targetId) : undefined;
    if ((input.action === "merge" || input.action === "update") && !target) throw new Error("Review target is unavailable; review remains pending");
    if (target && observation.kind === "promise_event" && (input.action === "merge" || input.action === "update")) {
      const savedDecision = ReconciliationDecisionSchema.safeParse(JSON.parse(row.model_decision_json ?? "null"));
      const ids = savedDecision.success ? savedDecision.data.targetIds : [];
      if (ids.length && (ids.length !== 1 || ids[0] !== target.id)) throw new Error("다른 약속이 선택됐어요. 플러그인을 업데이트하고 다시 확인해 주세요.");
    }
    const action = input.action === "merge" ? "reinforce" : input.action === "update" ? "supersede" : "coexist";
    let canonical = observation.kind === "promise_event" ? String(target?.value.promise_key ?? observation.promiseKeyHint) : String(target?.value.predicate ?? observation.predicateHint);
    // A user's separate-record decision covers the live typed property scope,
    // including rows absent from the saved review. Automatic repair is still
    // limited to its recorded candidates; it is not a new user confirmation.
    const coexistCandidates = input.action === 'distinct' && !input.automatic
      ? candidatesFor(db,chatId,observation,buildEntityIdentityResolver(db,chatId)).filter(candidate =>
        normalizePredicate(String(candidate.value.predicate ?? candidate.value.promise_key)) === normalizePredicate(canonical))
      : candidates;
    // An explicit separate promise needs its own identity, not an upsert of
    // the original promise when the model reused its key hint.
    if(input.action==='distinct' && observation.kind==='promise_event'
      && db.prepare('SELECT 1 FROM promises WHERE chat_id=? AND promise_key=?').get(chatId,canonical)) canonical=`review:${reviewId}`;
    addObservation(result, observation, action, target ? [target.id] : [], canonical,input.action==='distinct' ? coexistCandidates.map(candidate=>candidate.id) : undefined);
    {
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
        if (table === "assertions" && (item.state_kind === "secret" || item.state_kind === "goal") && item.linked_detail_ids_json != null
          && (item.user_edit_ordinal == null || stateDetailSupport(observation)?.length)) {
          const { revision } = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number };
          preserveLinkedAssertionAccess(db, chatId, item.id, JSON.parse(item.linked_detail_ids_json), revision, Date.now());
        }
        db.prepare(`UPDATE ${table} SET user_edit_ordinal=? WHERE id=? AND chat_id=?`).run(committedEditOrdinal(db,chatId),item.id,chatId);
      }
    }
  }
  db.prepare("UPDATE reconciliation_items SET status=?,resolution_json=?,resolved_at=? WHERE id=?").run(input.action === "discard" ? "discarded" : input.action === "distinct" ? "kept_separate" : input.action === "update" ? "updated" : "merged", JSON.stringify(input), Date.now(), reviewId);
  finishReviewedBatches(db,chatId);
  })();
}

/** One-time startup repair of reviews blocked only by unrelated protected properties.
 * Eligibility uses saved observations/decisions/candidates, never a fresh model decision.
 * Application deliberately follows the same transactional path as an explicit distinct.
 */
export function reconcileUnrelatedProtectedReviews(db: RcmDatabase): number {
  const marker = 'reconciliation_protected_property_cleanup_v1';
  if (db.prepare('SELECT 1 FROM server_meta WHERE key=?').get(marker)) return 0;
  return db.transaction(() => {
    const rows = db.prepare(`SELECT id,chat_id,item_ref,item_kind,incoming_json,candidates_json,model_decision_json
      FROM reconciliation_items WHERE status='pending' AND model_error=? AND model_decision_json IS NOT NULL
      ORDER BY created_at,rowid`).all('User-managed canonical state cannot be changed automatically') as Array<{
        id: string; chat_id: string; item_ref: string; item_kind: ObservationKind;
        incoming_json: string; candidates_json: string; model_decision_json: string;
      }>;
    let resolved = 0;
    let failed = 0;
    for (const row of rows) {
      if (chatUpgradeLock(db,row.chat_id)) continue;
      try {
        const decision = ReconciliationResultSchema.parse({ decisions: [JSON.parse(row.model_decision_json)] }).decisions[0]!;
        if (!['create', 'coexist'].includes(decision.action) || decision.targetIds.length || decision.itemRef !== row.item_ref) continue;
        const observation = StateObservationSchema.parse(JSON.parse(row.incoming_json).item);
        const candidates = JSON.parse(row.candidates_json) as Candidate[];
        if (observation.kind !== row.item_kind || !Array.isArray(candidates) || !candidates.length
          || candidates.some(candidate => !candidate || typeof candidate.id !== 'string' || candidate.kind !== observation.kind
            || !candidate.value || typeof (candidate.value.predicate ?? candidate.value.promise_key) !== 'string')) continue;
        const entry = { itemRef: row.item_ref, observation, candidates };
        const predicate = normalizePredicate(observation.kind === 'promise_event' ? observation.promiseKeyHint : observation.predicateHint);
        if (!candidates.some(candidate => candidate.immutable === true && normalizePredicate(String(candidate.value.predicate ?? candidate.value.promise_key)) !== predicate)
          || requiresProtectedStateReview(entry, decision)
          || decision.compatibleWithIds?.some(id => !candidates.some(candidate => candidate.id === id))) continue;
        // The recorded protection error proves the previous rule blocked this item.
        // The shared current rule can accept it only because the property scope shrank.
        db.transaction(() => resolveReconciliationReview(db, row.chat_id, row.id, { action: 'distinct', automatic: true }))();
        resolved += 1;
      } catch {
        // Invalid saved payloads or a distinct that current state cannot accept stay pending.
        failed += 1;
      }
    }
    db.prepare('INSERT INTO server_meta(key,value) VALUES(?,?)').run(marker, String(Date.now()));
    if (failed) console.warn(`[RCM] Protected-property review cleanup left ${failed} item(s) pending`);
    return resolved;
  })();
}
