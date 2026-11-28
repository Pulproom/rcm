import type { RcmDatabase } from './db.js';

/** Delivery preferences are absent from model inputs and canonical-state bindings. */
export function stateCandidateValue<T extends Record<string, any>>(row: T): Omit<T, 'always_inject' | 'pinned'> {
  const {always_inject: _always, pinned: _pinned, ...value}=row;
  return value;
}

/** Promises retain the released pinned slot, including completed outcomes. */
export const deliverablePromiseSql = "status IN ('open','kept','broken','released','offscreen')";
export function nowAlwaysInjectCount(db: RcmDatabase, chatId: string): number {
  return Number(db.prepare(`SELECT
    (SELECT count(*) FROM assertions WHERE chat_id=? AND valid_to_revision IS NULL AND always_inject=1) +
    (SELECT count(*) FROM beliefs WHERE chat_id=? AND active=1 AND status='active' AND always_inject=1) +
    (SELECT count(*) FROM promises WHERE chat_id=? AND ${deliverablePromiseSql} AND pinned=1)`)
    .pluck().get(chatId, chatId, chatId));
}

/** Only explicit same-identity successors inherit the preference; endings do not. */
export function inheritNowDelivery(db: RcmDatabase, table: 'assertions' | 'beliefs', id: string, predecessors: readonly { always_inject?: number }[]): void {
  if (predecessors.some(row => row.always_inject === 1)) db.prepare(`UPDATE ${table} SET always_inject=1 WHERE id=?`).run(id);
}
