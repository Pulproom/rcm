import { createHash } from "node:crypto";
import { InitialCalibrationResultSchema, LedgerConsistencyResultSchema, ReconciliationResultSchema, inspectSourceReferences } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";

export type CachedAuxiliaryPurpose = "initial_calibration" | "ledger_consistency" | "reconciliation";
export const auxiliaryPageKey = (purpose: CachedAuxiliaryPurpose, systemPrompt: string, userPrompt: string): string =>
  `${purpose}:${createHash("sha256").update(JSON.stringify([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }])).digest("hex")}`;

function validatePage(purpose: CachedAuxiliaryPurpose, userPrompt: string, input: unknown): unknown {
  const supplied = JSON.parse(userPrompt) as { renderedSetup?: Array<{ sourceIndex: number; content: string }>; items?: Array<{ itemRef: string; candidates: Array<{ id: string; immutable?: boolean }> }>; groups?: Array<{ itemRef: string; states: Array<{ id: string; immutable: boolean; createdRevision: number; sourceOrdinal?: number | null; evidenceMessageIds: string[] }> }> };
  if (purpose === "initial_calibration") {
    const parsed = InitialCalibrationResultSchema.parse(input);
    const sources = new Map<number, string[]>();
    for (const item of supplied.renderedSetup ?? []) sources.set(item.sourceIndex, [...(sources.get(item.sourceIndex) ?? []), item.content]);
    for (const evidence of [...parsed.entities.flatMap((item) => item.evidence), ...parsed.relationships.flatMap((item) => item.evidence), ...parsed.socialKnowledge.flatMap(item => item.evidence)])
      if (!sources.get(evidence.sourceIndex)?.some((content) => content.includes(evidence.quote))) throw new Error("Initial calibration evidence is outside the supplied setup page");
    return parsed;
  }
  if (purpose === "reconciliation") {
    const parsed = ReconciliationResultSchema.parse(input);
    const stateInput = supplied as typeof supplied & {eventDraft?:unknown;priorLedger?:Array<{id:string;immutable:boolean}>};
    if (stateInput.eventDraft) {
      if (!parsed.state) throw new Error("State extraction page requires state");
      const expected = new Set(parsed.state.stateObservations.map(item=>`observation:${item.key}`));
      const refs = parsed.decisions.map(item=>item.itemRef);
      if(refs.length!==expected.size || new Set(refs).size!==expected.size || refs.some(ref=>!expected.has(ref)))throw new Error("State decisions must cover every observation exactly once");
      const allowed = new Map((stateInput.priorLedger??[]).map(item=>[item.id,item]));
      if(parsed.decisions.some(d=>d.targetIds.some(id=>!allowed.has(id)||allowed.get(id)!.immutable)))throw new Error("State target is outside the supplied mutable ledger");
      return parsed;
    }
    const expected = new Set(supplied.items?.map((item) => item.itemRef) ?? []);
    const refs = parsed.decisions.map((item) => item.itemRef);
    if (refs.length !== expected.size || new Set(refs).size !== expected.size || refs.some((ref) => !expected.has(ref))) throw new Error("Validated auxiliary page must return every supplied itemRef exactly once");
    for (const decision of parsed.decisions) {
      const item = supplied.items!.find((candidate) => candidate.itemRef === decision.itemRef)!;
      const allowed = new Map(item.candidates.map((candidate) => [candidate.id, candidate]));
      if (decision.targetIds.some((id) => !allowed.has(id) || allowed.get(id)!.immutable)) throw new Error("Reconciliation target is outside the supplied mutable candidates");
    }
    return parsed;
  }
  const parsed = LedgerConsistencyResultSchema.parse(input);
  const expected = new Set(supplied.groups?.map((item) => item.itemRef) ?? []);
  const refs = parsed.groups.map((item) => item.itemRef);
  if (refs.length !== expected.size || new Set(refs).size !== expected.size || refs.some((ref) => !expected.has(ref))) throw new Error("Validated auxiliary page must return every supplied itemRef exactly once");
  for (const decision of parsed.groups) {
    const states = new Map(supplied.groups!.find((group) => group.itemRef === decision.itemRef)!.states.map((state) => [state.id, state]));
    for (const closure of decision.closures) {
      const target = states.get(closure.targetId); const replacement = states.get(closure.replacementId);
      const later = target && replacement && (target.sourceOrdinal != null && replacement.sourceOrdinal != null ? replacement.sourceOrdinal > target.sourceOrdinal : replacement.createdRevision > target.createdRevision);
      if (!target || !replacement || target.id === replacement.id || target.immutable || !replacement.evidenceMessageIds.length || !later) throw new Error("Ledger closure is unsafe for the supplied page");
    }
  }
  return parsed;
}

export function cachedAuxiliaryPage(payload: Record<string, any>, purpose: CachedAuxiliaryPurpose, systemPrompt: string, userPrompt: string): unknown | undefined {
  const key = auxiliaryPageKey(purpose, systemPrompt, userPrompt);
  const candidate = payload.validatedAuxiliaryParts?.[key]?.result;
  if (candidate === undefined) return undefined;
  try { return validatePage(purpose, userPrompt, candidate); } catch { return undefined; }
}

export function storeValidatedAuxiliaryPage(db: RcmDatabase, jobId: string, workerId: string | undefined, input: {
  purpose: CachedAuxiliaryPurpose; systemPrompt: string; userPrompt: string; result: unknown;
}): string {
  const row = (workerId
    ? db.prepare("SELECT payload_json FROM jobs WHERE id=? AND status='leased' AND lease_owner=?").get(jobId, workerId)
    : db.prepare("SELECT payload_json FROM jobs WHERE id=? AND status='leased' AND lease_owner IS NOT NULL").get(jobId)) as { payload_json: string } | undefined;
  if (!row) throw new Error("Lease not found while storing validated auxiliary page");
  const payload = JSON.parse(row.payload_json || "{}") as Record<string, any>;
  const planned = (payload.auxiliaryPromptParts ?? []) as Array<{ purpose: string; systemPrompt: string; userPrompt: string }>;
  if (!planned.some((part) => part.purpose === input.purpose && part.systemPrompt === input.systemPrompt && part.userPrompt === input.userPrompt)) throw new Error("Auxiliary page does not match the server-planned prompt");
  const result = validatePage(input.purpose, input.userPrompt, input.result);
  if (input.purpose === "reconciliation" && (result as any).state) {
    const messages=db.prepare(`SELECT message_id AS id,canonical_content AS content,canonical_hash AS canonicalHash FROM messages
      WHERE chat_id=(SELECT chat_id FROM jobs WHERE id=?) AND message_id IN (SELECT value FROM json_each(?))
      AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`)
      .all(jobId,JSON.stringify(payload.sourceMessageIds??[])) as Array<{id:string;content:string;canonicalHash:string}>;
    if(inspectSourceReferences((result as any).state,messages).some(issue=>issue.blocking))throw new Error("State page contains unverified current source evidence");
  }
  const key = auxiliaryPageKey(input.purpose, input.systemPrompt, input.userPrompt);
  payload.validatedAuxiliaryParts = { ...(payload.validatedAuxiliaryParts ?? {}), [key]: { purpose: input.purpose, result, validatedAt: Date.now() } };
  if (workerId) db.prepare("UPDATE jobs SET payload_json=?,updated_at=? WHERE id=? AND status='leased' AND lease_owner=?")
    .run(JSON.stringify(payload), Date.now(), jobId, workerId);
  else db.prepare("UPDATE jobs SET payload_json=?,updated_at=? WHERE id=? AND status='leased' AND lease_owner IS NOT NULL")
    .run(JSON.stringify(payload), Date.now(), jobId);
  return key;
}
