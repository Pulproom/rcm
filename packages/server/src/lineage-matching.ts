import { createHash } from 'node:crypto';
import { sourceComparisonText, type TurnPrepareRequest } from '@rcm/shared';
import type { RcmDatabase } from './db.js';

export interface LineageSource {
  message_id: string; ordinal: number; role: string; content_hash: string;
  content: string | null; lifecycle: string; host_visibility: string;
  source_record_id: string | null; display_content_hash: string | null;
  display_comparison_hash: string | null;
}
export type SourcePair = { parent: LineageSource; child: NonNullable<TurnPrepareRequest['messageVisibility']>[number] };
export function lineageSources(db: RcmDatabase, chatId: string): LineageSource[] {
  return db.prepare(`SELECT message_id,ordinal,role,content_hash,content,lifecycle,host_visibility,
      source_record_id,display_content_hash,display_comparison_hash FROM messages
    WHERE chat_id=? AND lifecycle IN ('committed','client_pruned','pending') ORDER BY ordinal`).all(chatId) as LineageSource[];
}

/** Exact source correspondence, never a similarity search over story prose. */
export function matchLineageSources(rows: LineageSource[], request: TurnPrepareRequest): SourcePair[] {
  const items = [...(request.messageVisibility ?? [])].sort((a,b) => a.ordinal-b.ordinal);
  if (!items.length || new Set(items.map(item => item.id)).size !== items.length) return [];
  const raw = new Map(request.messages.map(message => [message.id, message]));
  const hashes = new Map<string,string>();
  const matches = (row: LineageSource, item: typeof items[number]): boolean => {
    if (item.role && item.role !== row.role) return false;
    if (item.contentHash === row.content_hash) return true;
    // A copied Yumi marker points to the same source record while it exists.
    // When Yumi has already evicted that record, the independently retained
    // Risu display fingerprints still establish exact source identity.
    if (item.sourceRecordId && row.source_record_id && item.sourceRecordId === row.source_record_id) return true;
    if (item.displayComparisonHash && row.display_comparison_hash
      && item.displayComparisonHash === row.display_comparison_hash) return true;
    if (item.displayContentHash && row.display_content_hash
      && item.displayContentHash === row.display_content_hash) return true;
    if (row.content == null) return false;
    const childHash = item.comparisonHash ?? (raw.has(item.id)
      ? createHash('sha256').update(`${row.role}\0${sourceComparisonText(raw.get(item.id)!.content, request.canonicalizationPolicy)}`).digest('hex') : undefined);
    if (!childHash) return false;
    if (!hashes.has(row.message_id)) hashes.set(row.message_id, createHash('sha256')
      .update(`${row.role}\0${sourceComparisonText(row.content, request.canonicalizationPolicy)}`).digest('hex'));
    return hashes.get(row.message_id) === childHash;
  };
  const byId = new Map(rows.map(row => [row.message_id,row]));
  const identified = items.flatMap(child => {
    const parent = byId.get(child.id);
    return parent && matches(parent,child) ? [{parent,child}] : [];
  });
  if (identified.length) {
    const end = identified.at(-1)!.child.ordinal;
    const matched = new Set(identified.map(pair => pair.child.id));
    if (items.some(item => item.ordinal <= end && item.visibility !== 'comment' && !matched.has(item.id))) return [];
    if (identified.some((pair,index) => index > 0 && pair.parent.ordinal <= identified[index-1]!.parent.ordinal)) return [];
    return identified;
  }
  if (items.some(item => byId.has(item.id))) return [];
  // Reissued IDs: an uninterrupted ordered run must reach an end or the
  // explicit new branch marker. A shared greeting alone is not a copy.
  const runs: SourcePair[][] = [];
  for (let start=0; start<rows.length; start++) {
    if (!matches(rows[start]!,items[0]!)) continue;
    const pairs: SourcePair[] = [];
    for (let i=0; i<items.length && start+i<rows.length; i++) {
      if (!matches(rows[start+i]!,items[i]!)) break;
      pairs.push({parent:rows[start+i]!,child:items[i]!});
    }
    if (!pairs.length || new Set(pairs.map(pair=>pair.parent.ordinal-pair.child.ordinal)).size !== 1) continue;
    const next = items[pairs.length];
    if (pairs.length === items.length || start+pairs.length === rows.length
      || next?.ordinal === request.lineageHint?.markerOrdinal) runs.push(pairs);
  }
  // Repeated identical runs cannot establish which source occurrence is meant.
  return runs.length === 1 ? runs[0]! : [];
}
