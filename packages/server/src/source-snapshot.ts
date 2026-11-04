import type { TurnPrepareRequest } from '@rcm/shared';
import type { RcmDatabase } from './db.js';
import { sha256 } from './lifecycle.js';

const revisionKey = (chatId: string) => `source_snapshot_revision:${chatId}`;
export function sourceSnapshotRevision(db: RcmDatabase, chatId: string): number {
  return Number((db.prepare('SELECT value FROM server_meta WHERE key=?').get(revisionKey(chatId)) as { value: string } | undefined)?.value ?? 0);
}

export type SourceMutationPolicy = { allowDestructive: boolean; held: boolean; destructive: boolean };
export const isPositionalChat = (request: Pick<TurnPrepareRequest, 'chatId' | 'characterId'>): boolean =>
  request.chatId.startsWith(`${request.characterId}:`) && /^\d+$/.test(request.chatId.slice(request.characterId.length + 1));

function sourceRows(db: RcmDatabase, chatId: string) {
  return db.prepare('SELECT message_id,ordinal,role,content_hash,lifecycle,source_kind,host_visibility FROM messages WHERE chat_id=? ORDER BY ordinal,message_id').all(chatId) as Array<{ message_id: string; ordinal: number; role: string; content_hash: string; lifecycle: string; source_kind: string; host_visibility: string }>;
}
export function sourceInventory(db: RcmDatabase, chatId: string): string { return sha256(JSON.stringify(sourceRows(db, chatId))); }
export function sourceSnapshotStatus(db: RcmDatabase, chatId: string) {
  const held = db.prepare('SELECT value FROM server_meta WHERE key=?').get(`source_snapshot_held:${chatId}`) as { value: string } | undefined;
  return { sourceRevision: sourceSnapshotRevision(db, chatId), sourceInventory: sourceInventory(db, chatId),
    ...(held ? JSON.parse(held.value) : {}) };
}

/** Server-owned replay/evaluation inventory, read from its isolated SQLite snapshot. */
export function storedSourceSnapshot(db: RcmDatabase, chatId: string): Pick<TurnPrepareRequest, 'sourceSnapshot' | 'messageVisibility'> {
  const items = db.prepare('SELECT message_id AS id,role,content_hash AS contentHash,host_visibility AS visibility FROM messages WHERE chat_id=? ORDER BY ordinal,message_id').all(chatId) as NonNullable<TurnPrepareRequest['messageVisibility']>;
  return { sourceSnapshot: { baseRevision: sourceSnapshotRevision(db, chatId), baseInventory: sourceInventory(db, chatId), complete: true, messageCount: items.length },
    messageVisibility: items.map((item, ordinal) => ({ ...item, ordinal })) };
}

/** Only source destruction needs a current receipt. Safe additions always reach retrieval. */
export function withSourceSnapshot<T extends object>(db: RcmDatabase, request: TurnPrepareRequest, apply: (policy: SourceMutationPolicy, allowDiscovery: boolean) => T): T & ReturnType<typeof sourceSnapshotStatus> {
  return db.transaction(() => {
    const proof = request.sourceSnapshot, inventory = request.messageVisibility;
    const complete = Boolean(proof?.complete && inventory && proof.messageCount === inventory.length
      && new Set(inventory.map(m => m.id)).size === inventory.length
      && new Set(request.messages.map(m => m.id)).size === request.messages.length
      && inventory.every((m, index) => m.ordinal === index && m.role && m.contentHash)
      && (request.snapshotScope === 'tail' || request.messages.length === inventory.length)
      && request.messages.every(m => {
        const entry = inventory[m.ordinal];
        return entry && entry.id === m.id && entry.role === m.role && entry.contentHash === sha256(`${m.role}\0${m.content}`);
      }));
    const revision = sourceSnapshotRevision(db, request.chatId), stored = sourceRows(db, request.chatId);
    const baseline = sha256(JSON.stringify(stored));
    let reason = !proof ? 'proof_required' : !complete ? 'incomplete'
      : proof.baseRevision !== revision ? 'stale'
      : proof.baseInventory !== baseline && stored.length > 0 ? 'stale' : undefined;
    const put = db.prepare('INSERT INTO server_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const positional = isPositionalChat(request);
    if (positional) {
      const key = `source_position_list:${request.chatId}`;
      const previous = (db.prepare('SELECT value FROM server_meta WHERE key=?').get(key) as { value: string } | undefined)?.value;
      const current = request.hostIdentity?.listFingerprint;
      // A changed list is reattached only by a full, identical existing ledger.
      // A different chat occupying the same slot cannot establish that evidence.
      const sameSources = complete && stored.every(row => row.source_kind === 'archive' || !['pending', 'committed'].includes(row.lifecycle) || inventory!.some(m => m.id === row.message_id && m.ordinal === row.ordinal && m.contentHash === row.content_hash));
      if (current && sameSources) put.run(key, current);
      else if (!current || current !== previous) reason = 'position_changed';
    }
    const policy: SourceMutationPolicy = { allowDestructive: !reason, held: false, destructive: false };
    const beforeLineage = db.prepare('SELECT status,parent_chat_id,ordinal_offset FROM chat_lineage WHERE child_chat_id=?').get(request.chatId);
    const result = apply(policy, !reason && !positional);
    const afterLineage = db.prepare('SELECT status,parent_chat_id,ordinal_offset FROM chat_lineage WHERE child_chat_id=?').get(request.chatId);
    if (policy.destructive || JSON.stringify(beforeLineage) !== JSON.stringify(afterLineage)) put.run(revisionKey(request.chatId), String(revision + 1));
    const heldKey = `source_snapshot_held:${request.chatId}`;
    if (policy.held) put.run(heldKey, JSON.stringify({ sourceChangeHeld: reason ?? 'incomplete', sourceNotice: reason === 'proof_required'
      ? '원문 변경을 반영하려면 RCM 플러그인을 업데이트해 주세요.'
      : reason === 'position_changed' ? '채팅 위치가 바뀌어 원문 변경을 보류했어요.' : '원문 변경을 다시 확인하고 있어요. 채팅은 계속할 수 있어요.' }));
    else db.prepare('DELETE FROM server_meta WHERE key=?').run(heldKey);
    return { ...result, ...sourceSnapshotStatus(db, request.chatId) };
  })();
}
