import { createHash, randomUUID } from "node:crypto";
import { ExtractionDraftResultSchema, ExtractionResultSchema, resolveSourceQuote, normalizeRecognitionReferences, type ExtractionDraftResult } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { inspectDraftEvidence } from "./evidence-review.js";
import { recordExtractionAudit } from "./extraction-audit.js";
import { fingerprintMatches, sourceFingerprint } from "./source-fingerprint.js";
import { canonicalizeExtraction } from "./entities.js";
import { validateDialogueEvidence, replaceItemAccess } from "./ingest.js";
import { refreshMemoryFts } from "./memory-search-document.js";
import { storeSourcePassages } from "./source-evidence.js";
import { ingestSocialKnowledge } from "./social-knowledge.js";

type Memory = ExtractionDraftResult["memories"][number];
type Dialogue = NonNullable<Memory["keyDialogues"]>[number];
type Recognition = NonNullable<ExtractionDraftResult["socialKnowledge"]>[number];
type Passage = NonNullable<ExtractionDraftResult["sourcePassages"]>[number];
type ExactEvidence = Dialogue["evidence"][number];
export interface SmallReviewCandidate {
  id: string;
  kind: "dialogue" | "passage" | "recognition";
  status: "pending" | "kept" | "discarded" | "stale";
  reason: string;
  parentMemoryId?: string;
  memory?: Memory;
  dialogue?: Dialogue;
  passage?: Passage;
  recognition?: Recognition;
  verifiedEvidence?: ExactEvidence[];
  retryJobId?: string;
}
type AuditRow = { id: string; job_id: string; draft_json: string; source_message_ids_json: string; source_fingerprint_json: string; source_revision: number; status: string };

/** Audit-only metadata. Never part of the extraction/model schema or canonical tables. */
export function readSmallReviews(draft: { smallReviews?: SmallReviewCandidate[] }): SmallReviewCandidate[] {
  return draft.smallReviews ?? [];
}

function exactEvidence(db: RcmDatabase, chatId: string, sources: string[], messageId: string | undefined, quote: string): ExactEvidence[] | undefined {
  const rows = db.prepare(`SELECT message_id,canonical_hash,canonical_content FROM messages WHERE chat_id=?
    AND message_id IN (SELECT value FROM json_each(?)) AND memory_excluded=0 AND host_visibility IN ('active','all_before')
    AND lifecycle IN ('committed','client_pruned')`).all(chatId, JSON.stringify(sources)) as Array<{message_id: string; canonical_hash: string; canonical_content: string}>;
  const eligible = messageId && sources.includes(messageId) ? rows.filter(row => row.message_id === messageId) : rows;
  // An ambiguous occurrence in any eligible message disqualifies the choice.
  if (!resolveSourceQuote(eligible.map(row => row.canonical_content).join("\0"), quote)) return undefined;
  const matches = eligible.flatMap(row => {
    const selected = resolveSourceQuote(row.canonical_content, quote);
    if (!selected) return [];
    const startOffset = row.canonical_content.indexOf(selected);
    return [{ messageId: row.message_id, canonicalHash: row.canonical_hash, startOffset, endOffset: startOffset + selected.length, quote: selected }];
  });
  if (matches.length !== 1) return undefined;
  return matches;
}

export function recordSmallReviews(db: RcmDatabase, chatId: string, jobId: string, sources: string[], draft: ExtractionDraftResult,
  scopeId: string, pendingRefs: string[] = [], explicitParents?: Map<string, string>): number {
  const issues = inspectDraftEvidence(db, chatId, sources, draft);
  if (issues.some(issue => issue.blocking)) return 0;
  const candidates: SmallReviewCandidate[] = [];
  const parent = (memory: Memory) => explicitParents?.get(memory.key) ?? (db.prepare("SELECT id FROM memories WHERE chat_id=? AND memory_key=? AND active=1")
    .get(chatId, `batch:${scopeId}:${createHash("sha256").update(memory.key).digest("hex")}`) as {id: string} | undefined)?.id;
  const add = (ref: string, candidate: Omit<SmallReviewCandidate, "id" | "status">) => candidates.push({ ...candidate,
    id: createHash("sha256").update(`${jobId}\0${ref}`).digest("hex"), status: "pending" });
  for (const [mi, memory] of draft.memories.entries()) for (const [di, dialogue] of (memory.keyDialogues ?? []).entries()) {
    const ref = `dialogue:${memory.key}:${dialogue.messageId}:${di}`;
    const problems = issues.filter(issue => issue.path.startsWith(`memories[${mi}].keyDialogues[${di}]`));
    if (!problems.length && !pendingRefs.includes(ref)) continue;
    let verifiedEvidence: ExactEvidence[] | undefined;
    try {
      validateDialogueEvidence(db, chatId, sources, ExtractionResultSchema.parse({memories: [{...memory, keyDialogues: [dialogue]}]}));
      verifiedEvidence = dialogue.evidence;
    } catch { verifiedEvidence = exactEvidence(db, chatId, sources, dialogue.messageId, dialogue.text); }
    add(ref, { kind: "dialogue", memory, dialogue, parentMemoryId: parent(memory), verifiedEvidence,
      reason: "대사 후보의 원문 위치를 확인하지 못했어요." });
  }
  for (const [index, passage] of (draft.sourcePassages ?? []).entries()) {
    const problems = issues.filter(issue => issue.path === `sourcePassages[${index}]` && issue.reason !== "access_unverified");
    if (!problems.length && !pendingRefs.includes(`source:${index}`)) continue;
    add(`source:${index}`, { kind: "passage", passage, verifiedEvidence: exactEvidence(db, chatId, sources, passage.messageId, passage.quote),
      reason: "발췌 후보의 원문 위치를 확인하지 못했어요." });
  }
  for (const issue of normalizeRecognitionReferences(draft).rejected) {
    const recognition = draft.socialKnowledge![issue.index]!;
    const memory = draft.memories.find(item => item.key === recognition.memoryKey);
    const verifiedEvidence = recognition.evidence.flatMap(evidence => evidence.quote ? exactEvidence(db, chatId, sources, evidence.messageId, evidence.quote) ?? [] : []);
    add(`recognition:${issue.index}`, { verifiedEvidence: verifiedEvidence.length ? verifiedEvidence : undefined, kind: "recognition", recognition, memory, parentMemoryId: memory && parent(memory),
      reason: "이 인식과 세부 기억의 접근 근거를 확인하지 못했어요." });
  }
  if (!candidates.length) return 0;
  let row = db.prepare("SELECT id,draft_json FROM extraction_audits WHERE chat_id=? AND job_id=?").get(chatId, jobId) as {id: string; draft_json: string} | undefined;
  if (!row) {
    recordExtractionAudit(db, chatId, jobId, sources, draft, undefined, "pending_review");
    row = db.prepare("SELECT id,draft_json FROM extraction_audits WHERE chat_id=? AND job_id=?").get(chatId, jobId) as typeof row;
  }
  const previous = new Map(readSmallReviews(JSON.parse(row!.draft_json)).map(item => [item.id, item]));
  db.prepare("UPDATE extraction_audits SET draft_json=?,updated_at=? WHERE id=?")
    .run(JSON.stringify({ ...draft, smallReviews: candidates.map(item => previous.get(item.id) ?? item) }), Date.now(), row!.id);
  db.prepare("UPDATE jobs SET payload_json=json_set(payload_json,'$.smallReviewCount',?) WHERE id=?").run(candidates.length, jobId);
  return candidates.length;
}

function preparedCandidate(db: RcmDatabase, chatId: string, sources: string[], item: SmallReviewCandidate): ExtractionDraftResult | undefined {
  if (item.kind === "recognition") {
    if (!item.recognition || !item.memory || !item.parentMemoryId) return;
    const details = db.prepare(`SELECT d.detail_key,d.text,a.holder FROM memory_details d JOIN item_access a ON a.item_id=d.id
      AND a.item_kind='detail' AND a.active=1 WHERE d.chat_id=? AND d.memory_id=? AND d.active=1`).all(chatId, item.parentMemoryId) as Array<{detail_key: string; text: string; holder: string}>;
    if (!item.recognition.cognitionDetailKeys?.length || item.recognition.cognitionDetailKeys.some(key => !details.some(detail => detail.detail_key === key
      && detail.holder.toLocaleLowerCase() === item.recognition!.holder.toLocaleLowerCase()
      && detail.text === item.memory!.details?.find(candidate => candidate.key === key)?.text))) return;
    const evidence = item.recognition.evidence.flatMap(e => e.quote ? exactEvidence(db, chatId, sources, e.messageId, e.quote) ?? [] : []);
    if (!evidence.length || evidence.length !== item.recognition.evidence.length) return;
    return ExtractionDraftResultSchema.parse({ socialKnowledge: [{ ...item.recognition, evidence }] });
  }
  const evidence = item.verifiedEvidence;
  if (!evidence?.length) return;
  const selected = evidence[0]!;
  let draft: ExtractionDraftResult;
  if (item.kind === "dialogue" && item.dialogue && item.memory && item.parentMemoryId) {
    const memory = { ...item.memory, details: [], keyDialogues: [{ ...item.dialogue, messageId: selected.messageId, evidence }] };
    draft = ExtractionDraftResultSchema.parse({ memories: [memory] });
    try { validateDialogueEvidence(db, chatId, sources, ExtractionResultSchema.parse(draft)); } catch { return; }
  } else if (item.kind === "passage" && item.passage) {
    draft = ExtractionDraftResultSchema.parse({ sourcePassages: [{ ...item.passage, messageId: selected.messageId, quote: selected.quote, startOffset: selected.startOffset }] });
  } else return;
  if (inspectDraftEvidence(db, chatId, sources, draft).length) return;
  return draft;
}

export function smallReviewView(db: RcmDatabase, chatId: string, sources: string[], item: SmallReviewCandidate) {
  const prepared = preparedCandidate(db, chatId, sources, item);
  const recognition = item.recognition;
  return { id: item.id, kind: item.kind, status: item.status, reason: item.reason, retryJobId: item.retryJobId,
    text: item.dialogue?.text ?? item.passage?.quote ?? (recognition?.cognitionDetailKeys ?? [])
      .map(key => item.memory?.details?.find(detail => detail.key === key)?.text).filter(Boolean).join(" · "),
    speaker: item.dialogue?.speaker ?? item.passage?.speaker, holder: recognition?.holder, subject: recognition?.subject, memoryTitle: recognition ? item.memory?.title : undefined,
    verifiedEvidence: item.verifiedEvidence ?? prepared?.socialKnowledge?.[0]?.evidence,
    canKeep: item.status === "pending" && Boolean(prepared), canRetry: item.status === "pending" && item.kind !== "recognition" && !item.retryJobId };
}

/** Same evidence, canonicalization and access path as source-recovery ingestion. */
export function ingestReviewedDialogue(db: RcmDatabase, chatId: string, sources: string[], memory: Memory, parentId: string): void {
  const parent = db.prepare("SELECT m.id,m.known_by_json,c.revision FROM memories m JOIN chats c ON c.id=m.chat_id WHERE m.chat_id=? AND m.id=? AND m.active=1").get(chatId, parentId) as {id: string; known_by_json: string; revision: number} | undefined;
  if (!parent) throw new Error("원래 기억이 바뀌어 후보를 남길 수 없어요.");
  const canonical = canonicalizeExtraction(db, chatId, validateDialogueEvidence(db, chatId, sources, ExtractionResultSchema.parse({ memories: [memory] }))).memories[0]!.keyDialogues![0]!;
  const evidenceJson = JSON.stringify(canonical.evidence);
  const existing = db.prepare("SELECT id FROM memory_dialogues WHERE memory_id=? AND speaker=? AND text=? AND kind=? AND evidence_json=?")
    .get(parent.id, canonical.speaker, canonical.text, canonical.kind, evidenceJson) as {id: string} | undefined;
  const id = existing?.id ?? randomUUID();
  if (!existing) {
    const ordinal = (db.prepare("SELECT COALESCE(MAX(ordinal),-1)+1 AS value FROM memory_dialogues WHERE memory_id=?").get(parent.id) as {value: number}).value;
    db.prepare("INSERT INTO memory_dialogues(id,chat_id,memory_id,speaker,text,message_id,evidence_json,kind,ordinal,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, chatId, parent.id, canonical.speaker, canonical.text, canonical.messageId, evidenceJson, canonical.kind, ordinal, Date.now());
  }
  const grants = canonical.access ?? (JSON.parse(parent.known_by_json) as string[]).map(holder => ({holder, basis: "witnessed", evidence: canonical.evidence, confidence: 1}));
  replaceItemAccess(db, chatId, "dialogue", id, grants, parent.revision, Date.now());
  refreshMemoryFts(db, parent.id);
}

export function resolveSmallReviews(db: RcmDatabase, chatId: string, selections: Array<{auditId: string; candidateId: string}>, action: "keep" | "hold" | "discard" | "retry") {
  return db.transaction(() => selections.map(selection => {
    const audit = db.prepare("SELECT * FROM extraction_audits WHERE id=? AND chat_id=?").get(selection.auditId, chatId) as AuditRow | undefined;
    if (!audit) throw new Error("확인할 후보를 찾을 수 없어요.");
    const draft = JSON.parse(audit.draft_json);
    const item = readSmallReviews(draft).find(candidate => candidate.id === selection.candidateId);
    if (!item) throw new Error("확인할 후보를 찾을 수 없어요.");
    if (item.status !== "pending") return { id: item.id, status: item.status, message: "이미 처리된 후보예요." };
    const sources: string[] = JSON.parse(audit.source_message_ids_json);
    const expected = JSON.parse(audit.source_fingerprint_json);
    const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as {revision: number}).revision;
    const stale = revision < audit.source_revision || !sources.length || expected.length !== sources.length
      || !fingerprintMatches(db, chatId, expected) || item.parentMemoryId && !db.prepare("SELECT 1 FROM memories WHERE id=? AND chat_id=? AND active=1").get(item.parentMemoryId, chatId);
    let message = "보류를 유지했어요. 추가 호출은 없어요.";
    if (stale) { item.status = "stale"; message = "확인한 뒤 원문이나 기억이 바뀌었어요. 오래된 후보를 닫았어요."; }
    else if (action === "keep") {
      const prepared = preparedCandidate(db, chatId, sources, item);
      if (!prepared) throw new Error("검증된 원문과 접근 근거가 있는 후보만 남길 수 있어요.");
      if (item.kind === "dialogue") ingestReviewedDialogue(db, chatId, sources, prepared.memories[0]!, item.parentMemoryId!);
      else if (item.kind === "passage") {
        storeSourcePassages(db, chatId, prepared.sourcePassages, undefined, sources);
        const passage = prepared.sourcePassages![0]!;
        if (!db.prepare("SELECT 1 FROM source_passages WHERE chat_id=? AND message_id=? AND quote=? AND active=1").get(chatId, passage.messageId, passage.quote)) throw new Error("발췌를 저장할 수 없어요.");
      } else if (!ingestSocialKnowledge(db, chatId, prepared.socialKnowledge!, new Map([[item.recognition!.memoryKey!, item.parentMemoryId!]]), undefined, true)) {
        throw new Error("기존 인식을 보호하고 있어 후보를 적용하지 않았어요.");
      }
      item.status = "kept"; message = "검증된 근거와 함께 남겼어요.";
    } else if (action === "discard") { item.status = "discarded"; message = "후보를 뺐어요. 저장된 기억은 그대로예요."; }
    else if (action === "retry") {
      if (item.kind === "recognition") throw new Error("이 인식은 보류 유지 또는 빼기를 선택해 주세요.");
      if (!item.retryJobId) {
        const id = randomUUID(), timestamp = Date.now();
        const shell = ExtractionDraftResultSchema.parse({ memories: item.memory && item.dialogue ? [{ ...item.memory, details: [], keyDialogues: [item.dialogue] }] : [], sourcePassages: item.passage ? [item.passage] : [] });
        db.prepare("INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'audit_retry','queued',?,0,?,?)")
          .run(id, chatId, JSON.stringify({ sourceMessageIds: sources, sourceFingerprint: sourceFingerprint(db, chatId, sources), auditDraft: shell, sourceRecovery: true,
            postExtractionReview: false, smallReviewRetry: { auditId: audit.id, candidateId: item.id },
            dialogueRecovery: item.dialogue ? [{ ref: item.memory!.key, parentMemoryId: item.parentMemoryId, dialogue: item.dialogue }] : [],
            trigger: "retry", llmCallStats: {total: 0, repairs: 0, byPurpose: {}} }), timestamp, timestamp);
        item.retryJobId = id;
      }
      message = "보조 모델 재확인을 예약했어요. 추가 호출 1회예요.";
    }
    db.prepare("UPDATE extraction_audits SET draft_json=?,updated_at=? WHERE id=?").run(JSON.stringify(draft), Date.now(), audit.id);
    return { id: item.id, status: item.status, message, jobId: item.retryJobId };
  }))();
}

export function finishSmallReviewRetry(db: RcmDatabase, chatId: string, retry: {auditId: string; candidateId: string}, verified: boolean): void {
  const row = db.prepare("SELECT draft_json FROM extraction_audits WHERE id=? AND chat_id=?").get(retry.auditId, chatId) as {draft_json: string} | undefined;
  if (!row) return;
  const draft = JSON.parse(row.draft_json), item = readSmallReviews(draft).find(candidate => candidate.id === retry.candidateId);
  if (!item || item.status !== "pending") return;
  if (verified) item.status = "kept";
  db.prepare("UPDATE extraction_audits SET draft_json=?,updated_at=? WHERE id=?").run(JSON.stringify(draft), Date.now(), retry.auditId);
}
