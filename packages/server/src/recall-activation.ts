import { now, type RcmDatabase } from "./db.js";
import type { RetrievalSelectionRole } from "./retrieval.js";

const DELIVERY_PERSPECTIVE = "__automatic_delivery__";

/** Passive receipt history shares the existing lifecycle/FKs, never character activation. */
export function automaticDeliveryHistory(db: RcmDatabase, chatId: string): Map<string, number> {
  return new Map((db.prepare(`SELECT memory_id,last_turn_seq FROM memory_activation_state
    WHERE chat_id=? AND perspective=?`).all(chatId, DELIVERY_PERSPECTIVE) as Array<{memory_id:string;last_turn_seq:number}>)
    .map(row => [row.memory_id, row.last_turn_seq]));
}

export function recordAutomaticDelivery(db: RcmDatabase, chatId: string, memoryIds: string[]): void {
  const chat = db.prepare("SELECT completed_turn_count FROM chats WHERE id=?").get(chatId) as {completed_turn_count:number}|undefined;
  if (!chat) return;
  const write = db.prepare(`INSERT INTO memory_activation_state(chat_id,perspective,memory_id,activation,last_turn_seq,updated_at)
    SELECT chat_id,?,id,0,?,? FROM memories WHERE chat_id=? AND id=? AND active=1
    ON CONFLICT(chat_id,perspective,memory_id) DO UPDATE SET last_turn_seq=MAX(last_turn_seq,excluded.last_turn_seq),updated_at=excluded.updated_at`);
  db.transaction(() => { for (const id of new Set(memoryIds)) write.run(DELIVERY_PERSPECTIVE, chat.completed_turn_count, now(), chatId, id); })();
}

/** Turn-scoped recall history. This state cannot establish a typed connection
 * or grant access to a memory; retrieval owns those decisions. */
export interface AutomaticActivationObservation {
  memoryId: string;
  role: RetrievalSelectionRole;
  observed: number;
  viaMemoryId?: string;
  atomEvidence?: Array<{ atomKey: string; observed: number; viaMemoryId: string }>;
}

/** Rebind a path observation to its first surviving endpoint after trimming. */
export function deliveredActivationObservation(observation: AutomaticActivationObservation,
  deliveredAtomKeys: ReadonlySet<string>): AutomaticActivationObservation | undefined {
  if (!observation.atomEvidence) return observation;
  const atomEvidence = observation.atomEvidence.filter(atom => deliveredAtomKeys.has(atom.atomKey));
  const first = atomEvidence[0];
  return first ? { ...observation, observed: first.observed, viaMemoryId: first.viaMemoryId, atomEvidence } : undefined;
}

type ActivationRow = { memory_id: string; activation: number; via_memory_id: string | null; last_turn_seq: number; path_expires_turn: number | null };

const decayActivation = (activation: number, lastTurn: number, completedTurn: number): number =>
  activation * Math.pow(0.4, Math.max(0, completedTurn - lastTurn));

export function loadResidualActivations(db: RcmDatabase, chatId: string, perspective: string,
  candidates: readonly string[], completedTurn: number, pruneExpired: boolean) {
  const activationRows = perspective === "narrator" || candidates.length === 0 ? []
    : db.prepare(`SELECT memory_id,activation,via_memory_id,last_turn_seq,path_expires_turn FROM memory_activation_state
      WHERE chat_id=? AND perspective=? COLLATE NOCASE AND memory_id IN (${candidates.map(() => "?").join(",")})`).all(chatId, perspective, ...candidates) as ActivationRow[];
  const expiredActivationIds: string[] = [];
  const residualActivations = new Map(activationRows.flatMap((row): Array<[string, ActivationRow & { decayed: number }]> => {
    const decayed = decayActivation(row.activation, row.last_turn_seq, completedTurn);
    if (decayed < 0.05) expiredActivationIds.push(row.memory_id);
    return decayed >= 0.05 ? [[row.memory_id, { ...row, decayed }]] : [];
  }));
  if (perspective !== "narrator" && pruneExpired && expiredActivationIds.length > 0) {
    const removeActivation = db.prepare("DELETE FROM memory_activation_state WHERE chat_id=? AND perspective=? COLLATE NOCASE AND memory_id=?");
    db.transaction(() => {
      for (const memoryId of expiredActivationIds) removeActivation.run(chatId, perspective, memoryId);
    })();
  }
  return residualActivations;
}

export function persistAutomaticActivationObservations(
  db: RcmDatabase,
  chatId: string,
  perspective: string,
  completedTurn: number,
  observations: AutomaticActivationObservation[],
): void {
  if (["narrator", "__shared__", "shared"].includes(perspective.toLocaleLowerCase()) || observations.length === 0) return;
  const read = db.prepare(`SELECT activation,last_turn_seq,via_memory_id,path_expires_turn
    FROM memory_activation_state WHERE chat_id=? AND perspective=? COLLATE NOCASE AND memory_id=?`);
  const write = db.prepare(`INSERT INTO memory_activation_state(
      chat_id,perspective,memory_id,activation,via_memory_id,last_turn_seq,path_expires_turn,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(chat_id,perspective,memory_id) DO UPDATE SET
      activation=excluded.activation,
      via_memory_id=excluded.via_memory_id,
      last_turn_seq=excluded.last_turn_seq,
      path_expires_turn=excluded.path_expires_turn,
      updated_at=excluded.updated_at`);
  db.transaction(() => {
    for (const observation of observations) {
      if (observation.observed <= 0) continue;
      const previous = read.get(chatId, perspective, observation.memoryId) as
        | { activation: number; last_turn_seq: number; via_memory_id: string | null; path_expires_turn: number | null }
        | undefined;
      const decayed = previous
        ? decayActivation(previous.activation, previous.last_turn_seq, completedTurn)
        : 0;
      const priorPathActive = Boolean(previous?.via_memory_id)
        && previous?.path_expires_turn !== null
        && Number(previous?.path_expires_turn ?? -1) >= completedTurn;
      // A direct focus hit may refresh activation, but it must not erase the
      // recent-serendipity cooldown before its three completed turns elapse.
      const viaMemoryId = observation.role === "serendipity"
        ? observation.viaMemoryId ?? null
        : priorPathActive ? previous?.via_memory_id ?? null : null;
      const pathExpiresTurn = observation.role === "serendipity" && viaMemoryId
        ? completedTurn + 3
        : priorPathActive ? previous?.path_expires_turn ?? null : null;
      write.run(
        chatId,
        perspective,
        observation.memoryId,
        Math.min(1, Math.max(decayed, observation.observed)),
        viaMemoryId,
        completedTurn,
        pathExpiresTurn,
        now(),
      );
    }
  })();
}

