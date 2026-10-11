import type { RcmDatabase } from "./db.js";
import { normalizeLedgerPredicate } from "./normalization.js";

export interface UserCorrection { id?: string; user_edit_ordinal?: number | null; auto_locked?: number; holder?: string; subject?: string; predicate?: string; valid_from_revision?: number; social_relation_json?: string | null }

interface TransitionEvidence { messageId?: string; canonicalHash?: string; transitionCanonicalHash?: string; successorId?: string; action?: 'dispute'; previousStatus?: string }

function assertionPredecessors(db: RcmDatabase, chatId: string, id: string): Array<Record<string,any>> {
  return db.prepare(`SELECT * FROM assertions WHERE chat_id=? AND EXISTS
    (SELECT 1 FROM json_each(automatic_closure_evidence_json) WHERE json_extract(value,'$.successorId')=?)`)
    .all(chatId,id) as Array<Record<string,any>>;
}

/** A correction is provenance; only the explicit switch freezes automatic state. */
export const isAutoLocked = (row: UserCorrection): boolean => row.auto_locked === 1;
export const isUserCorrected = (row: UserCorrection): boolean => row.user_edit_ordinal != null;
/** Source cleanup/rollback never revokes a user's correction, regardless of lock. */
export const UNCORRECTED_SQL = "user_edit_ordinal IS NULL AND auto_locked=0";
export const USER_CORRECTION_GUIDANCE = `User edits are baselines, not permanent locks. auto_locked=1 prohibits automatic replacement, closure or contradiction. An unlocked user_edit_ordinal baseline may change only with direct source evidence after that ordinal; old-source replay or silence cannot undo it. Preserve prior values as history. For coexistence of genuinely compatible, independent beliefs, return action=coexist and compatibleWithIds listing all protected prior belief IDs in that holder/subject scope. For a genuinely independent new assertion or promise, return action=create and compatibleWithIds listing the protected prior candidate IDs; a changed property/key alone never authorizes a new contrary current row. This typed declaration means the new belief does not replace, end or contradict those beliefs. Different wording or a changed key alone does not establish independence. Never use coexistence to evade a protected target.`;

export function committedEditOrdinal(db: RcmDatabase, chatId: string): number {
  return Number((db.prepare("SELECT COALESCE(MAX(ordinal),-1) ordinal FROM messages WHERE chat_id=? AND lifecycle IN ('committed','client_pruned')").get(chatId) as { ordinal: number }).ordinal);
}

/** Only live, committed source after the edit authorizes automatic transitions.
 * Evidence IDs are structural provenance; no natural-language classification. */
export function canAutomaticallyChange(db: RcmDatabase, chatId: string, row: UserCorrection, evidence: readonly { messageId?: string }[]): boolean {
  if (isAutoLocked(row)) return false;
  // Explicit assertion ancestry retains edit chronology across renamed properties.
  // Locks belong to their actual row, not to automatically generated successors.
  let editOrdinal=row.user_edit_ordinal;
  if(editOrdinal==null && row.valid_from_revision!=null && row.id) {
    const ancestors=new Map<string,UserCorrection>([[row.id,row]]);
    for(const ancestor of ancestors.values()) for(const prior of assertionPredecessors(db,chatId,ancestor.id!)) {
      if(!ancestors.has(prior.id)) ancestors.set(prior.id,prior);
    }
    const floors=[...ancestors.values()].flatMap(prior=>prior.user_edit_ordinal==null ? [] : [prior.user_edit_ordinal]);
    if(floors.length) editOrdinal=Math.max(...floors);
  }
  if(editOrdinal==null && row.holder && row.subject && row.predicate) {
    const historical = db.prepare("SELECT * FROM beliefs WHERE chat_id=? AND holder=? COLLATE NOCASE AND subject=? COLLATE NOCASE AND user_edit_ordinal IS NOT NULL").all(chatId,row.holder,row.subject);
    const floors=(historical as Array<Record<string,any>>).filter(prior=>normalizeLedgerPredicate(prior.predicate)===normalizeLedgerPredicate(row.predicate!)).map(prior=>Number(prior.user_edit_ordinal));
    if(floors.length) editOrdinal=Math.max(...floors);
  }
  if(editOrdinal==null) return true;
  // Invalid old branch sources cannot become new evidence after rebasing an edit.
  if (evidence.some(item => item.messageId && !db.prepare(`SELECT 1 FROM messages WHERE chat_id=? AND message_id=?
    AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`).get(chatId,item.messageId))) return false;
  return evidence.some(item => item.messageId && db.prepare(`SELECT 1 FROM messages WHERE chat_id=? AND message_id=?
    AND ordinal>? AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`)
    .get(chatId, item.messageId, editOrdinal));
}

export const correctionView = (row: UserCorrection) => ({ userEdited: isUserCorrected(row), userEditOrdinal: row.user_edit_ordinal ?? null, locked: isAutoLocked(row) });

/** Transition validity is separate from exact atom/access evidence identity. */
export function transitionSourceEvidence<T extends {messageId?:string}>(db: RcmDatabase, chatId: string, evidence: readonly T[]): Array<T & {transitionCanonicalHash?:string}> {
  return evidence.map(item=>({...item,...(item.messageId ? {
    transitionCanonicalHash:(db.prepare("SELECT canonical_hash FROM messages WHERE chat_id=? AND message_id=?").get(chatId,item.messageId) as {canonical_hash:string}|undefined)?.canonical_hash
  } : {})}));
}

export function transitionEvidenceJson(db: RcmDatabase, chatId: string, evidence: readonly {messageId?:string}[], transition?: Pick<TransitionEvidence,'successorId'|'action'|'previousStatus'>): string {
  const items: readonly {messageId?:string}[]=evidence.length ? evidence : transition ? [{}] : [];
  return JSON.stringify(transitionSourceEvidence(db,chatId,items).map(({transitionCanonicalHash,...item})=>
    ({...item,...transition,...(item.messageId ? {canonicalHash:transitionCanonicalHash} : {})})));
}

/** Retract source-backed transitions, including same-row promises and ends with
 * no successor. User-authored history and explicit user ends are separate. */
export function invalidateAutomaticTransitions(db: RcmDatabase, chatId: string, messageIds: readonly string[]): string[] {
  if(!messageIds.length) return [];
  const invalidIds=new Set(messageIds);
  const idsJson=JSON.stringify([...invalidIds]);
  const affectedPromises=(db.prepare(`UPDATE promise_events SET active=0 WHERE chat_id=? AND user_authored=0 AND active=1 AND (
    EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId') IN (SELECT value FROM json_each(?)))
    OR evidence_json='[]' AND source_ordinal IN (SELECT ordinal FROM messages WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?)))
    OR evidence_json='[]' AND source_memory_id IN (SELECT memory_id FROM evidence_spans WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?)))) RETURNING promise_id`)
    .all(chatId,idsJson,chatId,idsJson,chatId,idsJson) as Array<{promise_id:string}>).map(row=>row.promise_id);
  const evidenceValid=(evidence:TransitionEvidence[]):boolean=>evidence.every(item=>{
    if(!item.messageId) return true;
    if(invalidIds.has(item.messageId)) return false;
    // Cleanup and hiding do not revoke a retained transition. Only this
    // invalidation set (or an actual changed canonical hash) rewinds it.
    const source=db.prepare("SELECT canonical_hash FROM messages WHERE chat_id=? AND message_id=?").get(chatId,item.messageId) as {canonical_hash:string}|undefined;
    const hash=item.transitionCanonicalHash ?? item.canonicalHash;
    return !!source && (!hash || hash===source.canonical_hash);
  });
  const predecessors=(table:'beliefs'|'assertions',row:Record<string,any>):Array<Record<string,any>>=>table==='beliefs'
    ? db.prepare("SELECT * FROM beliefs WHERE chat_id=? AND superseded_by=? AND automatic_closure_evidence_json IS NOT NULL").all(chatId,row.id) as Array<Record<string,any>>
    : assertionPredecessors(db,chatId,row.id);
  const successor=(table:'beliefs'|'assertions',row:Record<string,any>):Record<string,any>|undefined=> {
    const id=table==='beliefs' ? row.superseded_by : (JSON.parse(row.automatic_closure_evidence_json ?? '[]') as TransitionEvidence[])[0]?.successorId;
    return id ? db.prepare(`SELECT * FROM ${table} WHERE id=? AND chat_id=?`).get(id,chatId) as Record<string,any>|undefined : undefined;
  };
  const sourceValid=(row:Record<string,any>):boolean=> {
    if(isUserCorrected(row) || isAutoLocked(row)) return true;
    if(row.status==='pending_review' || row.status==='disputed') return false;
    // Assertions have no pending-review status. Their incoming transition owns
    // the source hash even when the original assertion evidence was unversioned.
    if(row.valid_from_revision!=null) {
      const incoming=predecessors('assertions',row);
      if(incoming.some(prior=>!evidenceValid(JSON.parse(prior.automatic_closure_evidence_json)))) return false;
    }
    return evidenceValid(JSON.parse(row.evidence_json))
      && (!row.source_memory_id || !db.prepare("SELECT 1 FROM evidence_spans WHERE chat_id=? AND memory_id=? AND message_id IN (SELECT value FROM json_each(?))").get(chatId,row.source_memory_id,idsJson));
  };
  for(const table of ['beliefs','assertions'] as const) {
    // Start only at this invalidation, then follow predecessor links. A prior
    // sync may have invalidated a middle successor while a later one was live.
    const seeds = db.prepare(`SELECT * FROM ${table} WHERE chat_id=? AND (
      EXISTS(SELECT 1 FROM json_each(automatic_closure_evidence_json) WHERE json_extract(value,'$.messageId') IN (SELECT value FROM json_each(?)))
      OR EXISTS(SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId') IN (SELECT value FROM json_each(?))))`)
      .all(chatId,idsJson,idsJson) as Array<Record<string,any>>;
    const affected=new Map(seeds.map(row=>[row.id,row]));
    // Map iteration includes new predecessors and visits each row only once.
    for(const row of affected.values()) {
      for(const prior of predecessors(table,row)) if(!affected.has(prior.id)) affected.set(prior.id,prior);
    }
    // Capture validity before reopening any predecessor removes its closure hash.
    const validity=new Map([...affected.values()].map(row=>[row.id,sourceValid(row)]));
    for(const row of affected.values()) {
      if(row.automatic_closure_evidence_json==null) continue;
      const closure=JSON.parse(row.automatic_closure_evidence_json) as TransitionEvidence[];
      // An end with live evidence is a final state even without a successor.
      if(evidenceValid(closure)) continue;
      if(!validity.get(row.id)) continue;
      if(table==='beliefs' && closure[0]?.action==='dispute') {
        // Ordinary beliefs keep their existing dispute lifecycle. A correction
        // restores the recorded baseline status, without rewriting its value.
        if(isUserCorrected(row) && row.status==='disputed') db.prepare("UPDATE beliefs SET status=?,automatic_closure_evidence_json=NULL WHERE id=?")
          .run(closure[0].previousStatus,row.id);
        continue;
      }
      let next=successor(table,row);
      const seen=new Set<string>([row.id]);
      let liveSuccessor=false;
      while(next && !seen.has(next.id)) {
        seen.add(next.id);
        if((validity.get(next.id) ?? sourceValid(next)) && ((table==='beliefs'?next.active===1 && next.status==='active':next.valid_to_revision==null)
          || next.automatic_closure_evidence_json!=null && evidenceValid(JSON.parse(next.automatic_closure_evidence_json)))) { liveSuccessor=true; break; }
        next=successor(table,next);
      }
      if(liveSuccessor) continue;
      if(table==='beliefs') db.prepare("UPDATE beliefs SET active=1,status='active',superseded_by=NULL,valid_to_ordinal=NULL,automatic_closure_evidence_json=NULL WHERE id=?").run(row.id);
      else db.prepare("UPDATE assertions SET valid_to_revision=NULL,valid_to_ordinal=NULL,automatic_closure_evidence_json=NULL WHERE id=?").run(row.id);
    }
  }
  const promiseAtoms=new Map([...new Set(affectedPromises)].map(id=>[id,db.prepare("SELECT promisor,promisee,content FROM promises WHERE chat_id=? AND id=?").get(chatId,id)]));
  restoreCorrectedPromises(db,chatId,[...promiseAtoms.keys()]);
  // Same-row automatic transitions can change a corrected promise's Story atom
  // without deactivating its ID. Report only actual content changes.
  return [...promiseAtoms].filter(([id,before])=>JSON.stringify(before)!==JSON.stringify(db.prepare("SELECT promisor,promisee,content FROM promises WHERE chat_id=? AND id=?").get(chatId,id))).map(([id])=>id);
}

function restoreCorrectedPromises(db: RcmDatabase, chatId: string, promiseIds: readonly string[]): void {
  for (const id of promiseIds) {
    if(!db.prepare("SELECT 1 FROM promises WHERE chat_id=? AND id=? AND user_edit_ordinal IS NOT NULL").get(chatId,id)) continue;
    const event=db.prepare(`SELECT * FROM promise_events WHERE chat_id=? AND promise_id=? AND active=1
      ORDER BY created_revision DESC,created_at DESC,rowid DESC LIMIT 1`).get(chatId,id) as Record<string,any>|undefined;
    if(event) db.prepare("UPDATE promises SET promisor=?,promisee=?,content=?,status=?,scheduled_for=?,status_reason=?,source_memory_id=?,source_batch_id=?,updated_revision=? WHERE id=?")
      .run(event.promisor,event.promisee,event.content,event.status,event.scheduled_for,event.status_reason,event.source_memory_id,event.source_batch_id,event.created_revision,id);
  }
}

export function rebaseCorrectionsAfterTailRollback(db: RcmDatabase, chatId: string): void {
  const retained=committedEditOrdinal(db,chatId);
  for(const table of ['beliefs','assertions','promises','social_knowledge_events','relationship_projections']) {
    db.prepare(`UPDATE ${table} SET user_edit_ordinal=? WHERE chat_id=? AND user_edit_ordinal>?`).run(retained,chatId,retained);
  }
}

/** A full replay starts with the last user baseline rather than dropping it
 * with its automatically generated successor. Explicit user ends stay ended. */
export function rewindAutomaticSuccessorsToCorrections(db: RcmDatabase, chatId: string): void {
  db.prepare("UPDATE beliefs SET active=1,status=COALESCE(json_extract(automatic_closure_evidence_json,'$[0].previousStatus'),'active'),superseded_by=NULL,valid_to_ordinal=NULL,automatic_closure_evidence_json=NULL WHERE chat_id=? AND user_edit_ordinal IS NOT NULL AND automatic_closure_evidence_json IS NOT NULL").run(chatId);
  db.prepare("UPDATE assertions SET valid_to_revision=NULL,valid_to_ordinal=NULL,automatic_closure_evidence_json=NULL WHERE chat_id=? AND user_edit_ordinal IS NOT NULL AND automatic_closure_evidence_json IS NOT NULL").run(chatId);
  db.prepare("UPDATE promise_events SET active=0 WHERE chat_id=? AND user_authored=0 AND promise_id IN (SELECT id FROM promises WHERE user_edit_ordinal IS NOT NULL)").run(chatId);
  restoreCorrectedPromises(db,chatId,(db.prepare("SELECT id FROM promises WHERE chat_id=? AND user_edit_ordinal IS NOT NULL").all(chatId) as Array<{id:string}>).map(row=>row.id));
}
