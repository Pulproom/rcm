import { createHash, randomUUID } from "node:crypto";
import { ExtractionDraftResultSchema, ExtractionResultSchema, dialogueMessageMatches, resolveSourceQuote, sourceRangeIsVisible, normalizeRecognitionReferences, type ExtractionDraftResult } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { inspectDraftEvidence, rescueDraftDialogues } from "./evidence-review.js";
import { recordExtractionAudit } from "./extraction-audit.js";
import { fingerprintMatches, sourceFingerprint } from "./source-fingerprint.js";
import { canonicalizeExtraction, buildEntityIdentityResolver } from "./entities.js";
import { validateDialogueEvidence, replaceItemAccess } from "./ingest.js";
import { refreshMemoryFts } from "./memory-search-document.js";
import { storeSourcePassages } from "./source-evidence.js";
import { ingestSocialKnowledge, recognitionNameAdditions } from "./social-knowledge.js";

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
  citedEvidence?: ExactEvidence[];
  retryJobId?: string;
}
type AuditRow = { id: string; job_id: string; draft_json: string; source_message_ids_json: string; source_fingerprint_json: string; source_revision: number; status: string };
type ResolutionResult = {id:string; status:SmallReviewCandidate["status"]; message:string; jobId?:string;
  reason?:"source_location_missing" | "unsupported_kind" | "ineligible"};

/** Audit-only metadata. Never part of the extraction/model schema or canonical tables. */
export function readSmallReviews(draft: { smallReviews?: SmallReviewCandidate[] }): SmallReviewCandidate[] {
  return draft.smallReviews ?? [];
}

function eligibleSourceMessages(db: RcmDatabase, chatId: string, sources: string[]) {
  return db.prepare(`SELECT message_id,role,canonical_hash,canonical_content FROM messages WHERE chat_id=?
    AND message_id IN (SELECT value FROM json_each(?)) AND memory_excluded=0 AND host_visibility IN ('active','all_before')
    AND lifecycle IN ('committed','client_pruned') ORDER BY ordinal`).all(chatId, JSON.stringify(sources)) as Array<{message_id: string; role: string; canonical_hash: string; canonical_content: string}>;
}

function exactEvidence(db: RcmDatabase, chatId: string, sources: string[], messageId: string | undefined, quote: string): ExactEvidence[] | undefined {
  const rows = eligibleSourceMessages(db, chatId, sources);
  const eligible = messageId && sources.includes(messageId) ? rows.filter(row => row.message_id === messageId) : rows;
  // Passages and recognition evidence retain exact, globally unique selection.
  if (!resolveSourceQuote(eligible.map(row => row.canonical_content).join("\0"), quote)) return undefined;
  const matches = eligible.flatMap(row => {
    const selected = resolveSourceQuote(row.canonical_content, quote);
    if (!selected) return [];
    const startOffset = row.canonical_content.indexOf(selected);
    if (!sourceRangeIsVisible(row.canonical_content, startOffset, startOffset + selected.length)) return [];
    return [{ messageId: row.message_id, canonicalHash: row.canonical_hash, startOffset, endOffset: startOffset + selected.length, quote: selected }];
  });
  if (matches.length !== 1) return undefined;
  return matches;
}

/** A choice identifies exact source ranges, never an inferred speaker. */
function dialogueSourceChoices(db: RcmDatabase, chatId: string, sources: string[], item: SmallReviewCandidate) {
  const text = item.dialogue?.text;
  if (!text?.trim()) return [];
  const rows = eligibleSourceMessages(db, chatId, sources);
  return dialogueMessageMatches(text, rows.map(row => ({id:row.message_id,role:row.role,content:row.canonical_content,
    canonicalHash:row.canonical_hash}))).filter(match => match.complete).map(matched => {
      const row = matched.message;
      const evidence = matched.segments.map(({startOffset,endOffset,quote}) => ({
        messageId:row.id,canonicalHash:row.canonicalHash,startOffset,endOffset,quote}));
      const start = evidence[0]!.startOffset, end = evidence.at(-1)!.endOffset;
      // Hidden reasoning/images must not leak through the context preview.
      let before = start, after = end;
      while (before > Math.max(0, start - 160) && sourceRangeIsVisible(row.content, before - 1, start)) before--;
      while (after < Math.min(row.content.length, end + 160) && sourceRangeIsVisible(row.content, end, after + 1)) after++;
      return {role: row.role, id: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'), evidence,
        before: (before ? '…' : '') + row.content.slice(before, start), text,
        after: row.content.slice(end, after) + (after < row.content.length ? '…' : '')};
    });
}

function verifiedCitations(rows: ReturnType<typeof eligibleSourceMessages>, evidence: ExactEvidence[]) {
  return evidence.filter(span => rows.some(row => row.message_id === span.messageId && row.canonical_hash === span.canonicalHash
    && Number.isInteger(span.startOffset) && Number.isInteger(span.endOffset) && span.startOffset >= 0
    && span.endOffset <= row.canonical_content.length && span.endOffset > span.startOffset
    && row.canonical_content.slice(span.startOffset,span.endOffset) === span.quote
    && sourceRangeIsVisible(row.canonical_content,span.startOffset,span.endOffset)));
}

function reviewSourceMatches(db: RcmDatabase, chatId: string, sources: string[], messageId: string | undefined, text: string, cited?: ExactEvidence[], kind: "dialogue" | "passage" = "dialogue") {
  const eligible = eligibleSourceMessages(db, chatId, sources);
  const rows = eligible.filter(row => !eligible.some(candidate => candidate.message_id === messageId) || row.message_id === messageId);
  const allowed = cited === undefined ? undefined : verifiedCitations(rows,cited)
    .map(span => ({messageId:span.messageId,start:span.startOffset,end:span.endOffset}));
  const matches = dialogueMessageMatches(text, rows.map(row => ({id:row.message_id,role:kind === "dialogue" ? row.role : undefined,
    content:row.canonical_content,canonicalHash:row.canonical_hash})), allowed, kind);
  if (matches.length !== 1) return { hasMatch:matches.some(match => match.segments.length), complete: false, segments: [], evidence: [] };
  const matched = matches[0]!;
  return { hasMatch:matched.segments.length > 0, complete:matched.complete, segments:matched.segments, evidence:matched.segments.map(({startOffset,endOffset,quote}) => ({
    messageId:matched.message.id,canonicalHash:matched.message.canonicalHash,startOffset,endOffset,quote})) };
}

function hasSourceFragment(db: RcmDatabase, chatId: string, sources: string[], item: Pick<SmallReviewCandidate,'dialogue'|'passage'>) {
  return reviewSourceMatches(db,chatId,sources,undefined,item.dialogue?.text ?? item.passage?.quote ?? '',undefined,item.dialogue ? "dialogue" : "passage").hasMatch;
}

function nameOnlyEvidence(db: RcmDatabase, chatId: string, sources: string[], recognition: Recognition): Recognition["evidence"] {
  const eligible = new Set(eligibleSourceMessages(db, chatId, sources).map(row => row.message_id));
  return recognition.evidence.flatMap(evidence => eligible.has(evidence.messageId)
    ? evidence.quote ? exactEvidence(db, chatId, sources, evidence.messageId, evidence.quote) ?? [{messageId: evidence.messageId}]
      : [{messageId: evidence.messageId}]
    : []);
}

/** Freeze exact storage identities rather than hashing again without collision reservations. */
export function storedReviewParents(db:RcmDatabase,chatId:string,keys:ReadonlyMap<string,string>):Map<string,string> {
  const parents=new Map<string,string>();
  for(const [local,canonical] of keys) {
    const row=db.prepare('SELECT id FROM memories WHERE chat_id=? AND memory_key=? AND active=1').get(chatId,canonical) as {id:string}|undefined;
    if(row) parents.set(local,row.id);
  }
  return parents;
}

/** Returns handled optional candidates (reviewed or dropped), so neither blocks extraction. */
export function recordSmallReviews(db: RcmDatabase, chatId: string, jobId: string, sources: string[], draft: ExtractionDraftResult,
  scopeId: string, pendingRefs: string[] = [], explicitParents?: Map<string, string>): number {
  draft = rescueDraftDialogues(db, chatId, sources, draft);
  const issues = inspectDraftEvidence(db, chatId, sources, draft);
  if (issues.some(issue => issue.blocking)) return 0;
  const candidates: SmallReviewCandidate[] = [];
  const payload = db.prepare("SELECT payload_json FROM jobs WHERE id=? AND chat_id=?").get(jobId, chatId) as {payload_json:string} | undefined;
  const units = JSON.parse(payload?.payload_json ?? '{}').reviewSourceUnits ?? [];
  const rows = eligibleSourceMessages(db, chatId, sources);
  const citedEvidence = (ids: string[], evidence: ExactEvidence[] = []) => {
    const refs = ids.filter(id => id.startsWith('unresolved:')).flatMap(id => id.slice(11).split(','));
    const expanded = refs.flatMap(ref => {
      const range = /^s(\d+)-s(\d+)$/.exec(ref);
      if (!range) return [ref];
      const start = Number(range[1]), end = Number(range[2]);
      return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start && end - start < units.length
        ? Array.from({length:end-start+1},(_,index)=>`s${start+index}`) : [ref];
    });
    const referenced = expanded.map(ref => units.find((unit:any) => unit.ref === ref));
    const selected = (referenced.some(unit => !unit) ? [] : referenced).flatMap((unit: any) => {
      const row = rows.find(row => row.message_id === unit.messageId && row.canonical_hash === unit.canonicalHash);
      return row ? [{messageId:unit.messageId,canonicalHash:unit.canonicalHash,startOffset:unit.start,endOffset:unit.end,
        quote:row.canonical_content.slice(unit.start,unit.end)}] : [];
    });
    return [...new Map(verifiedCitations(rows,[...evidence, ...selected])
      .map(span => [`${span.messageId}:${span.startOffset}:${span.endOffset}`, span])).values()];
  };
  const parent = (memory: Memory) => explicitParents ? explicitParents.get(memory.key) : (db.prepare("SELECT id FROM memories WHERE chat_id=? AND memory_key=? AND active=1")
    .get(chatId, `batch:${scopeId}:${createHash("sha256").update(memory.key).digest("hex")}`) as {id: string} | undefined)?.id;
  const drops: Array<{array:string;index:number;issues:Array<{path:Array<string|number>;message:string}>}> = [];
  const add = (ref: string, candidate: Omit<SmallReviewCandidate, "id" | "status">, path: Array<string|number>) => {
    if ((candidate.dialogue || candidate.passage) && !hasSourceFragment(db,chatId,sources,candidate)) {
      drops.push({array:String(path[0]),index:Number(path[1]),issues:[{path,message:'source_fragment_missing: No candidate fragment matches an eligible batch source.'}]});
      return;
    }
    candidates.push({ ...candidate, id: createHash("sha256").update(`${jobId}\0${ref}`).digest("hex"), status: "pending" });
  };
  for (const [mi, memory] of draft.memories.entries()) for (const [di, dialogue] of (memory.keyDialogues ?? []).entries()) {
    const ref = `dialogue:${memory.key}:${dialogue.messageId}:${di}`;
    const problems = issues.filter(issue => issue.path.startsWith(`memories[${mi}].keyDialogues[${di}]`));
    if (!problems.length && !pendingRefs.includes(ref)) continue;
    let verifiedEvidence: ExactEvidence[] | undefined;
    try {
      validateDialogueEvidence(db, chatId, sources, ExtractionResultSchema.parse({memories: [{...memory, keyDialogues: [dialogue]}]}));
      verifiedEvidence = dialogue.evidence;
    } catch {
      const matched = reviewSourceMatches(db, chatId, sources, dialogue.messageId, dialogue.text);
      verifiedEvidence = matched.complete ? matched.evidence : undefined;
    }
    add(ref, { kind: "dialogue", memory, dialogue, parentMemoryId: parent(memory), verifiedEvidence,
      citedEvidence: citedEvidence([dialogue.messageId, ...dialogue.evidence.map(span => span.messageId)], dialogue.evidence),
      reason: "대사 후보의 원문 위치를 확인하지 못했어요." }, ['memories',mi,'keyDialogues',di]);
  }
  for (const [index, passage] of (draft.sourcePassages ?? []).entries()) {
    const problems = issues.filter(issue => issue.path === `sourcePassages[${index}]` && issue.reason !== "access_unverified");
    if (!problems.length && !pendingRefs.includes(`source:${index}`)) continue;
    add(`source:${index}`, { kind: "passage", passage, verifiedEvidence: exactEvidence(db, chatId, sources, passage.messageId, passage.quote),
      citedEvidence: citedEvidence([passage.messageId], exactEvidence(db, chatId, sources, passage.messageId, passage.quote)),
      reason: "발췌 후보의 원문 위치를 확인하지 못했어요." }, ['sourcePassages',index]);
  }
  for (const issue of normalizeRecognitionReferences(draft,buildEntityIdentityResolver(db,chatId)).rejected) {
    const recognition = draft.socialKnowledge![issue.index]!;
    const memory = draft.memories.find(item => item.key === recognition.memoryKey);
    const verifiedEvidence = recognition.evidence.flatMap(evidence => evidence.quote ? exactEvidence(db, chatId, sources, evidence.messageId, evidence.quote) ?? [] : []);
    add(`recognition:${issue.index}`, { verifiedEvidence: verifiedEvidence.length ? verifiedEvidence : undefined, kind: "recognition", recognition, memory, parentMemoryId: memory && parent(memory),
      reason: "이 인식과 세부 기억의 접근 근거를 확인하지 못했어요." }, ['socialKnowledge',issue.index]);
  }
  if (drops.length) {
    const existing = JSON.parse(payload?.payload_json ?? '{}').auditAdditionDrops ?? [];
    db.prepare("UPDATE jobs SET payload_json=json_set(payload_json,'$.auditAdditionDrops',json(?),'$.smallReviewCount',?) WHERE id=?")
      .run(JSON.stringify([...existing,...drops]),candidates.length,jobId);
  }
  if (!candidates.length) return drops.length;
  let row = db.prepare("SELECT id,draft_json FROM extraction_audits WHERE chat_id=? AND job_id=?").get(chatId, jobId) as {id: string; draft_json: string} | undefined;
  if (!row) {
    recordExtractionAudit(db, chatId, jobId, sources, draft, undefined, "pending_review");
    row = db.prepare("SELECT id,draft_json FROM extraction_audits WHERE chat_id=? AND job_id=?").get(chatId, jobId) as typeof row;
  }
  const previous = new Map(readSmallReviews(JSON.parse(row!.draft_json)).map(item => [item.id, item]));
  db.prepare("UPDATE extraction_audits SET draft_json=?,updated_at=? WHERE id=?")
    .run(JSON.stringify({ ...draft, smallReviews: candidates.map(item => previous.get(item.id) ?? item) }), Date.now(), row!.id);
  db.prepare("UPDATE jobs SET payload_json=json_set(payload_json,'$.smallReviewCount',?) WHERE id=?").run(candidates.length, jobId);
  return candidates.length + drops.length;
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

function authoredCandidate(db: RcmDatabase, chatId: string, sources: string[], item: SmallReviewCandidate): SmallReviewCandidate | undefined {
  if (!item.dialogue && !item.passage) return;
  if (!hasSourceFragment(db,chatId,sources,item)) return;
  const choices = dialogueSourceChoices(db, chatId, sources, item);
  if (choices.length > 1) return;
  if (choices.length === 1 && item.dialogue) {
    const evidence = choices[0]!.evidence;
    return {...item, verifiedEvidence:evidence, dialogue:{...item.dialogue,messageId:evidence[0]!.messageId,evidence}};
  }
  const declared = item.dialogue?.evidence ?? (item.passage && sources.includes(item.passage.messageId)
    ? exactEvidence(db,chatId,sources,item.passage.messageId,item.passage.quote) ?? [] : []);
  const cited = verifiedCitations(eligibleSourceMessages(db,chatId,sources),
    item.citedEvidence?.length ? item.citedEvidence : declared);
  const ids = [...new Set(cited.map(span => span.messageId))];
  const originalId = item.dialogue?.messageId ?? item.passage!.messageId;
  let messageId = sources.includes(originalId) ? originalId : ids.length === 1 ? ids[0] : undefined;
  // A missing model citation must not discard a uniquely located visible fragment.
  // The user approves the authored wording; evidence still records the exact source.
  const matched = reviewSourceMatches(db, chatId, sources, messageId, item.dialogue?.text ?? item.passage!.quote,
    cited.length ? cited : undefined, item.dialogue ? "dialogue" : "passage");
  const evidence = matched.evidence.length ? matched.evidence : cited;
  if (!messageId && new Set(evidence.map(span => span.messageId)).size === 1) messageId = evidence[0]!.messageId;
  if (!messageId || !evidence.length || evidence.some(span => span.messageId !== messageId)) return;
  return { ...item, verifiedEvidence: evidence,
    ...(item.dialogue ? {dialogue: {...item.dialogue, messageId, evidence}} : {}),
    ...(item.passage ? {passage: {...item.passage, messageId, quote:evidence[0]!.quote, startOffset:evidence[0]!.startOffset}} : {}) };
}

export function smallReviewView(db: RcmDatabase, chatId: string, sources: string[], item: SmallReviewCandidate) {
  const prepared = preparedCandidate(db, chatId, sources, item);
  const authored = item.status === "pending" ? authoredCandidate(db, chatId, sources, item) : undefined;
  const canKeepAsWritten = Boolean(authored && preparedCandidate(db, chatId, sources, authored));
  const recognition = item.recognition;
  const additions = recognition && recognitionNameAdditions(db, chatId, recognition);
  const canKeep = item.status === "pending" && Boolean(prepared);
  const sourceMatches = item.dialogue || item.passage ? reviewSourceMatches(db, chatId, sources,
    item.dialogue?.messageId ?? item.passage?.messageId, item.dialogue?.text ?? item.passage!.quote, undefined, item.dialogue ? "dialogue" : "passage") : undefined;
  const sourceChoices = !canKeep ? dialogueSourceChoices(db, chatId, sources, item) : [];
  return { sourceChoices: sourceChoices.length > 1 ? sourceChoices.map(({evidence, ...choice}) => choice) : [], id: item.id, kind: item.kind, status: item.status, reason: item.reason, retryJobId: item.retryJobId,
    text: item.dialogue?.text ?? item.passage?.quote ?? (recognition?.cognitionDetailKeys ?? [])
      .map(key => item.memory?.details?.find(detail => detail.key === key)?.text).filter(Boolean).join(" · "),
    speaker: item.dialogue?.speaker ?? item.passage?.speaker, holder: recognition?.holder, subject: recognition?.subject, memoryTitle: recognition ? item.memory?.title : undefined,
    verifiedEvidence: item.verifiedEvidence ?? prepared?.socialKnowledge?.[0]?.evidence,
    ...(sourceMatches ? { sourceMatches: { complete: sourceMatches.complete, segments: sourceMatches.segments.map(({textStart, textEnd}) => ({textStart, textEnd})) } } : {}),
    ...(item.kind === "recognition" ? { level: recognition?.level, knownAs: additions?.knownAs ?? [], addressTerms: additions?.addressTerms ?? [],
      canKeepNames: item.status === "pending" && !canKeep && Boolean(additions && (additions.knownAs.length || additions.addressTerms.length)
        && nameOnlyEvidence(db, chatId, sources, recognition!).length) } : {}),
    canKeep, canKeepAsWritten, canRetry: item.status === "pending" && item.kind !== "recognition" && !item.retryJobId };
}

export function visibleSmallReviews(db: RcmDatabase, chatId: string, sources: string[], candidates: SmallReviewCandidate[]) {
  return candidates.filter(item => item.status !== 'pending' || item.kind === 'recognition' || hasSourceFragment(db,chatId,sources,item))
    .map(candidate => smallReviewView(db, chatId, sources, candidate))
    .filter(item => item.kind !== "recognition" || item.status !== "pending" || item.canKeep || item.canKeepNames);
}

export function countPendingSmallReviews(db: RcmDatabase, chatId: string): number {
  const rows = db.prepare(`SELECT source_message_ids_json AS sources,json_extract(draft_json,'$.smallReviews') AS candidates
    FROM extraction_audits WHERE chat_id=? AND json_array_length(draft_json,'$.smallReviews')>0`)
    .all(chatId) as Array<{ sources: string; candidates: string }>;
  return rows.reduce((count, row) => {
    const pending = (JSON.parse(row.candidates) as SmallReviewCandidate[]).filter(item => item.status === "pending");
    return count + visibleSmallReviews(db, chatId, JSON.parse(row.sources), pending).length;
  }, 0);
}

/** Same evidence, canonicalization and access path as source-recovery ingestion. */
export function ingestReviewedDialogue(db: RcmDatabase, chatId: string, sources: string[], memory: Memory, parentId: string): void {
  const parent = db.prepare("SELECT m.id,m.card_shape,m.known_by_json,c.revision FROM memories m JOIN chats c ON c.id=m.chat_id WHERE m.chat_id=? AND m.id=? AND m.active=1").get(chatId, parentId) as {id: string; card_shape:0|1; known_by_json: string; revision: number} | undefined;
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
  const grants = canonical.access ?? (parent.card_shape === 1 ? [] : (JSON.parse(parent.known_by_json) as string[]).map(holder => ({holder, basis: "witnessed", evidence: canonical.evidence, confidence: 1})));
  replaceItemAccess(db, chatId, "dialogue", id, grants, parent.revision, Date.now());
  refreshMemoryFts(db, parent.id);
}

export function resolveSmallReviews(db: RcmDatabase, chatId: string, selections: Array<{auditId: string; candidateId: string; sourceChoiceId?: string}>, action: "keep" | "keep_as_written" | "keep_names" | "hold" | "discard" | "retry") {
  const bulkKeep = action === "keep_as_written" && selections.length > 1;
  const resolveOne = (selection: typeof selections[number]): ResolutionResult => {
    const audit = db.prepare("SELECT * FROM extraction_audits WHERE id=? AND chat_id=?").get(selection.auditId, chatId) as AuditRow | undefined;
    if (!audit) throw new Error("확인할 후보를 찾을 수 없어요.");
    const draft = JSON.parse(audit.draft_json);
    const item = readSmallReviews(draft).find(candidate => candidate.id === selection.candidateId);
    if (!item) throw new Error("확인할 후보를 찾을 수 없어요.");
    if (action === "keep_as_written" && item.kind !== "dialogue" && item.kind !== "passage") {
      if (bulkKeep) return {id:item.id,status:item.status,message:"대사와 발췌만 그대로 남길 수 있어요.",reason:"unsupported_kind"};
      throw new Error("대사와 발췌만 그대로 남길 수 있어요.");
    }
    if (item.status !== "pending") return { id: item.id, status: item.status, message: "이미 처리된 후보예요." };
    const sources: string[] = JSON.parse(audit.source_message_ids_json);
    const expected = JSON.parse(audit.source_fingerprint_json);
    const revision = (db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as {revision: number}).revision;
    const stale = revision < audit.source_revision || !sources.length || expected.length !== sources.length
      || !fingerprintMatches(db, chatId, expected) || item.parentMemoryId && !db.prepare("SELECT 1 FROM memories WHERE id=? AND chat_id=? AND active=1").get(item.parentMemoryId, chatId);
    let message = "보류를 유지했어요. 추가 호출은 없어요.";
    if (stale) { item.status = "stale"; message = "확인한 뒤 원문이나 기억이 바뀌었어요. 오래된 후보를 닫았어요."; }
    else if (action === "keep_names") {
      if (item.kind !== "recognition" || !item.recognition) throw new Error("검증된 원문과 접근 근거가 있는 후보만 남길 수 있어요.");
      const additions = recognitionNameAdditions(db, chatId, item.recognition);
      if (!additions) throw new Error("기존 인식을 보호하고 있어 후보를 적용하지 않았어요.");
      if (!additions.knownAs.length && !additions.addressTerms.length) message = "이미 저장된 이름이에요.";
      else {
        const evidence = nameOnlyEvidence(db, chatId, sources, item.recognition);
        if (!evidence.length) throw new Error("검증된 원문과 접근 근거가 있는 후보만 남길 수 있어요.");
        const memoryKey = item.parentMemoryId ? item.recognition.memoryKey : undefined;
        const memoryByKey = item.parentMemoryId && memoryKey ? new Map([[memoryKey, item.parentMemoryId]]) : undefined;
        if (!ingestSocialKnowledge(db, chatId, [{holder: item.recognition.holder, subject: item.recognition.subject,
          level: item.recognition.level, ...additions, evidence, cognitionDetailKeys: [], ...(memoryKey ? {memoryKey} : {})}], memoryByKey, undefined, true)) {
          throw new Error("기존 인식을 보호하고 있어 후보를 적용하지 않았어요.");
        }
        message = "이름과 호칭을 남겼어요.";
      }
      item.status = "kept";
    } else if (action === "keep" || action === "keep_as_written") {
      let candidate = item;
      const keepAsWritten = action === "keep_as_written";
      const choices = keepAsWritten && !preparedCandidate(db, chatId, sources, item) ? dialogueSourceChoices(db, chatId, sources, item) : [];
      if (keepAsWritten && choices.length > 1 && !selection.sourceChoiceId) {
        return {id:item.id,status:item.status,message:"같은 대사의 원문이 여러 곳에 있어요. 하나를 골라 주세요."};
      }
      if (keepAsWritten && selection.sourceChoiceId) {
        const selected = choices.find(choice => choice.id === selection.sourceChoiceId);
        if (!selected || !item.dialogue) throw new Error("선택한 원문이 바뀌었어요. 다시 확인해 주세요.");
        candidate = {...item, verifiedEvidence: selected.evidence, dialogue: {...item.dialogue,
          messageId: selected.evidence[0]!.messageId, evidence: selected.evidence}};
      } else if (keepAsWritten && (item.dialogue || item.passage)) {
        const authored = authoredCandidate(db, chatId, sources, item);
        if (!authored) return {id:item.id,status:item.status,message:"원문 위치가 없어 남겨 뒀어요.",reason:"source_location_missing"};
        candidate = authored;
      }
      let prepared = preparedCandidate(db, chatId, sources, candidate);
      if (prepared && keepAsWritten && candidate.passage) {
        prepared = ExtractionDraftResultSchema.parse({sourcePassages: candidate.verifiedEvidence!.map(span => ({...candidate.passage,
          messageId:span.messageId,quote:span.quote,startOffset:span.startOffset}))});
        if (inspectDraftEvidence(db,chatId,sources,prepared).length) throw new Error("검증된 원문과 접근 근거가 있는 후보만 남길 수 있어요.");
      }
      if (!prepared) throw new Error("검증된 원문과 접근 근거가 있는 후보만 남길 수 있어요.");
      if (item.kind === "dialogue") ingestReviewedDialogue(db, chatId, sources, prepared.memories[0]!, item.parentMemoryId!);
      else if (item.kind === "passage") {
        storeSourcePassages(db, chatId, prepared.sourcePassages, undefined, sources);
        for (const passage of prepared.sourcePassages!) {
          if (!db.prepare("SELECT 1 FROM source_passages WHERE chat_id=? AND message_id=? AND quote=? AND active=1").get(chatId, passage.messageId, passage.quote)) throw new Error("발췌를 저장할 수 없어요.");
        }
      } else if (!ingestSocialKnowledge(db, chatId, prepared.socialKnowledge!, new Map([[item.recognition!.memoryKey!, item.parentMemoryId!]]), undefined, true)) {
        throw new Error("기존 인식을 보호하고 있어 후보를 적용하지 않았어요.");
      }
      Object.assign(item, candidate, { status: "kept" }); message = "검증된 근거와 함께 남겼어요.";
    } else if (action === "discard") { item.status = "discarded"; message = "후보를 뺐어요. 저장된 기억은 그대로예요."; }
    else if (action === "retry") {
      if (item.kind === "recognition") throw new Error("이 인식은 이름만 남기기 또는 빼기를 선택해 주세요.");
      if (!item.retryJobId) {
        const id = randomUUID(), timestamp = Date.now();
        const original = db.prepare('SELECT payload_json FROM jobs WHERE id=?').get(audit.job_id) as {payload_json:string}|undefined;
        const priorContract = JSON.parse(original?.payload_json ?? '{}');
        const promptContract = priorContract.promptContract ?? null;
        const stateContract = priorContract.stateContract ?? null;
        const shell = ExtractionDraftResultSchema.parse({ memories: item.memory && item.dialogue ? [{ ...item.memory, details: [], keyDialogues: [item.dialogue] }] : [], sourcePassages: item.passage ? [item.passage] : [] });
        db.prepare("INSERT INTO jobs(id,chat_id,type,status,payload_json,attempts,created_at,updated_at) VALUES(?,?,'audit_retry','queued',?,0,?,?)")
          .run(id, chatId, JSON.stringify({ promptContract, stateContract, sourceMessageIds: sources, sourceFingerprint: sourceFingerprint(db, chatId, sources), auditDraft: shell, sourceRecovery: true,
            postExtractionReview: false, smallReviewRetry: { auditId: audit.id, candidateId: item.id },
            dialogueRecovery: item.dialogue ? [{ ref: item.memory!.key, parentMemoryId: item.parentMemoryId, dialogue: item.dialogue }] : [],
            trigger: "retry", llmCallStats: {total: 0, repairs: 0, byPurpose: {}} }), timestamp, timestamp);
        item.retryJobId = id;
      }
      message = "보조 모델 재확인을 예약했어요. 추가 호출 1회예요.";
    }
    db.prepare("UPDATE extraction_audits SET draft_json=?,updated_at=? WHERE id=?").run(JSON.stringify(draft), Date.now(), audit.id);
    return { id: item.id, status: item.status, message, jobId: item.retryJobId };
  };
  if (!bulkKeep) return db.transaction(() => selections.map(resolveOne))();
  return selections.map(selection => {
    try { return db.transaction(() => resolveOne(selection))(); }
    catch (error) { return {id:selection.candidateId,status:"pending",reason:"ineligible",
      message:error instanceof Error ? error.message : "후보를 남길 수 없어요."}; }
  });
}

export function finishSmallReviewRetry(db: RcmDatabase, chatId: string, retry: {auditId: string; candidateId: string}, verified: boolean): void {
  const row = db.prepare("SELECT draft_json FROM extraction_audits WHERE id=? AND chat_id=?").get(retry.auditId, chatId) as {draft_json: string} | undefined;
  if (!row) return;
  const draft = JSON.parse(row.draft_json), item = readSmallReviews(draft).find(candidate => candidate.id === retry.candidateId);
  if (!item || item.status !== "pending") return;
  if (verified) item.status = "kept";
  db.prepare("UPDATE extraction_audits SET draft_json=?,updated_at=? WHERE id=?").run(JSON.stringify(draft), Date.now(), retry.auditId);
}
