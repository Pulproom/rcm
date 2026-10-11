import { committedEditOrdinal } from "./user-corrections.js";
import { randomUUID } from "node:crypto";
import { ExtractionResultSchema } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { normalizeLedgerPredicate, normalizeLedgerText } from "./normalization.js";
import { parseSocialRelation, resolveSocialRelation, sameSocialRelationScope } from "./social-relations.js";

export type ConflictResolution = "accept_incoming" | "keep_existing" | "acknowledged";

type ConflictRow = {
  id: string;
  kind: string;
  existing_json: string;
  incoming_json: string;
  status: string;
  resolution: string | null;
};

function conflictError(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function resolveConflict(
  db: RcmDatabase,
  chatId: string,
  conflictId: string,
  requestedResolution: ConflictResolution,
  requestedTargetAssertionId?: string,
): { resolution: ConflictResolution; applied: boolean; assertionId?: string } {
  return db.transaction(() => {
    const conflict = db.prepare(`
      SELECT id,kind,existing_json,incoming_json,status,resolution FROM conflicts
      WHERE id=? AND chat_id=?
    `).get(conflictId, chatId) as ConflictRow | undefined;
    if (!conflict) throw conflictError("Conflict not found", "CONFLICT_NOT_FOUND");

    const assertionConflict = conflict.kind === "assertion" || conflict.kind === "unattributed_claim";
    const resolution = assertionConflict && requestedResolution === "acknowledged"
      ? "accept_incoming"
      : requestedResolution;
    if (resolution === "accept_incoming" && !assertionConflict) {
      throw conflictError("This conflict cannot be applied as a world fact", "CONFLICT_NOT_APPLICABLE");
    }
    const recoverableAcknowledgement = conflict.status === "resolved"
      && conflict.resolution === "acknowledged"
      && resolution === "accept_incoming";
    if (conflict.status !== "pending" && !recoverableAcknowledgement) {
      throw conflictError("Conflict has already been resolved", "CONFLICT_ALREADY_RESOLVED");
    }

    if (resolution !== "accept_incoming") {
      db.prepare("UPDATE conflicts SET status='resolved',resolution=?,resolved_at=? WHERE id=? AND chat_id=?")
        .run(resolution, Date.now(), conflictId, chatId);
      return { resolution, applied: false };
    }

    let incomingValue: unknown;
    try { incomingValue = JSON.parse(conflict.incoming_json); }
    catch { throw conflictError("Stored conflict candidate is invalid", "CONFLICT_CANDIDATE_INVALID"); }
    const parsed = ExtractionResultSchema.safeParse({ assertions: [incomingValue] });
    if (!parsed.success || parsed.data.assertions.length !== 1) {
      throw conflictError("Stored conflict candidate is invalid", "CONFLICT_CANDIDATE_INVALID");
    }
    const incoming = parsed.data.assertions[0]!;
    const evidenceIds = [...new Set(incoming.evidence.map((item) => item.messageId))];
    const evidenceRows = db.prepare(`
      SELECT message_id,ordinal FROM messages
      WHERE chat_id=? AND message_id IN (${evidenceIds.map(() => "?").join(",")})
        AND lifecycle='committed' AND visible=1 AND host_visibility IN ('active','all_before')
    `).all(chatId, ...evidenceIds) as Array<{ message_id: string; ordinal: number }>;
    if (evidenceRows.length !== evidenceIds.length) {
      throw conflictError("Candidate source is no longer active", "CONFLICT_SOURCE_STALE");
    }

    const chat = db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId) as { revision: number } | undefined;
    if (!chat) throw conflictError("Chat not found", "CHAT_NOT_FOUND");
    let sourceMemoryId: string | null = null;
    if (incoming.validFromMemoryKey) {
      sourceMemoryId = (db.prepare("SELECT id FROM memories WHERE chat_id=? AND memory_key=? AND active=1")
        .get(chatId, incoming.validFromMemoryKey) as { id: string } | undefined)?.id ?? null;
      if (!sourceMemoryId) throw conflictError("Candidate source memory is no longer active", "CONFLICT_SOURCE_STALE");
    }

    let socialRelation: string | null = null;
    if (incoming.socialRelation) {
      try { socialRelation = JSON.stringify(resolveSocialRelation(db, chatId, incoming.socialRelation, new Map())); }
      catch { throw conflictError("Candidate relation support is no longer active", "CONFLICT_SOURCE_STALE"); }
    }
    const revision = chat.revision + 1;
    const currentRows = (db.prepare(`
      SELECT id,predicate,value,state_kind,evidence_json,social_relation_json FROM assertions
      WHERE chat_id=? AND subject=? AND valid_to_revision IS NULL ORDER BY created_at DESC
    `).all(chatId, incoming.subject) as Array<{ id: string; predicate: string; value: string; state_kind: string; evidence_json: string; social_relation_json: string | null }>)
      .filter((row) => normalizeLedgerPredicate(row.predicate) === normalizeLedgerPredicate(incoming.predicate)
        && sameSocialRelationScope(row.social_relation_json, incoming.socialRelation));
    const incomingStateKind = incoming.socialRelation ? "condition" : incoming.stateKind;
    const concurrentState = incomingStateKind === "goal" || incomingStateKind === "secret";
    const payloadTargets = [...new Set(incoming.targetAssertionIds ?? [])];
    const explicitTargetId = requestedTargetAssertionId ?? (payloadTargets.length === 1 ? payloadTargets[0] : undefined);
    const sameValue = concurrentState
      ? currentRows.find((row) => row.state_kind === incomingStateKind && normalizeLedgerText(row.value) === normalizeLedgerText(incoming.value))
      : undefined;
    let replacementTarget: typeof currentRows[number] | undefined;
    let current = currentRows[0];
    if (concurrentState) {
      if (explicitTargetId) {
        replacementTarget = currentRows.find((row) => row.id === explicitTargetId);
        if (!replacementTarget) {
          throw conflictError("The target assertion is not a current row for this subject and predicate", "CONFLICT_TARGET_INVALID");
        }
        current = sameValue ?? replacementTarget;
      } else if (sameValue) {
        current = sameValue;
      } else if (currentRows.length > 0) {
        throw conflictError("Accepting a goal or secret conflict requires an explicit targetAssertionId", "CONFLICT_TARGET_REQUIRED");
      }
    }
    const timestamp = Date.now();
    let assertionId: string;
    if (current && normalizeLedgerText(current.value) === normalizeLedgerText(incoming.value)) {
      if (replacementTarget && replacementTarget.id !== current.id) {
        db.prepare("UPDATE assertions SET valid_to_revision=? WHERE id=?").run(revision, replacementTarget.id);
      }
      const evidence = [...JSON.parse(current.evidence_json), ...incoming.evidence].filter((item, index, all) =>
        all.findIndex((candidate) => candidate.messageId === item.messageId && (candidate.quote ?? "") === (item.quote ?? "")) === index);
      db.prepare("UPDATE assertions SET state_kind=?,confidence=MAX(confidence,?),evidence_json=?,social_relation_json=? WHERE id=?")
        .run(incomingStateKind, incoming.confidence, JSON.stringify(evidence), socialRelation, current.id);
      assertionId = current.id;
    } else {
      if (current) db.prepare("UPDATE assertions SET valid_to_revision=? WHERE id=?").run(revision, current.id);
      assertionId = randomUUID();
      const validFromOrdinal = Math.min(...evidenceRows.map((row) => row.ordinal));
      db.prepare(`
        INSERT INTO assertions(id,chat_id,subject,predicate,value,state_kind,confidence,valid_from_revision,valid_from_ordinal,source_memory_id,evidence_json,retention_class,created_at,social_relation_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(assertionId, chatId, incoming.subject, normalizeLedgerPredicate(incoming.predicate), incoming.value,
        incomingStateKind, incoming.confidence, revision, validFromOrdinal, sourceMemoryId, JSON.stringify(incoming.evidence), incoming.retention ?? "arc", timestamp, socialRelation);
    }
    db.prepare("UPDATE assertions SET user_edit_ordinal=? WHERE id=? AND chat_id=?").run(committedEditOrdinal(db,chatId),assertionId,chatId);
    db.prepare("UPDATE chats SET revision=?,updated_at=? WHERE id=?").run(revision, timestamp, chatId);
    db.prepare("UPDATE conflicts SET status='resolved',resolution='accept_incoming',resolved_at=? WHERE id=? AND chat_id=?")
      .run(timestamp, conflictId, chatId);
    return { resolution: "accept_incoming" as const, applied: true, assertionId };
  })();
}
