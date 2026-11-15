import { albumPairKey, albumPairPresent, type AlbumPair, type AlbumPairCandidate } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";

/** Projection summaries are also the album's letters; all sources use stored entity names. */
export function collectAlbumPairs(db: RcmDatabase, chatId: string, defaultPair: AlbumPair, participants: readonly string[][]): { pairs: AlbumPairCandidate[]; hiddenPairCount: number; recorded: AlbumPairCandidate[] } {
  const pairs = new Map<string, AlbumPair>();
  const add = (me: string, partner: string) => {
    if (me === partner) return;
    const names = [me, partner].sort();
    const pair = names.includes(defaultPair.me) ? { me: defaultPair.me, partner: names.find(n => n !== defaultPair.me)! } : { me: names[0]!, partner: names[1]! };
    pairs.set(albumPairKey(pair), pair);
  };
  add(defaultPair.me, defaultPair.partner);
  const rows = db.prepare(`SELECT from_entity AS a,to_entity AS b FROM relationship_events WHERE chat_id=? AND active=1 AND user_hidden=0
    UNION SELECT from_entity,to_entity FROM relationship_projections WHERE chat_id=?
    UNION SELECT from_entity,to_entity FROM relationship_baselines WHERE chat_id=? AND active=1
    UNION SELECT persona,character FROM pair_progress WHERE chat_id=?
    UNION SELECT holder,subject FROM social_knowledge_events WHERE chat_id=? AND active=1
    UNION SELECT participant_a,participant_b FROM physical_intimacy_milestones WHERE chat_id=? AND active=1 AND deleted_by_user=0
    UNION SELECT json_extract(document_json,'$.people.me.name'),json_extract(document_json,'$.people.partner.name') FROM albums WHERE source_chat_id=?`).all(...Array(7).fill(chatId)) as { a: string; b: string }[];
  for (const row of rows) if (row.a && row.b) add(row.a, row.b);
  const events = db.prepare(`SELECT e.from_entity AS me,e.to_entity AS partner FROM relationship_events e LEFT JOIN memories m ON m.id=e.source_memory_id AND m.chat_id=e.chat_id
    WHERE e.chat_id=? AND e.active=1 AND e.user_hidden=0 AND (e.source_memory_id IS NULL OR m.active=1)`).all(chatId) as AlbumPair[];
  const eventCounts = new Map<string, number>();
  for (const event of events) { const key = albumPairKey(event); eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1); }
  const defaultKey = albumPairKey(defaultPair);
  const recorded = [...pairs.values()].map(pair => ({ ...pair, hasPersona: Boolean(defaultPair.me && [pair.me, pair.partner].includes(defaultPair.me)),
    sharedSceneCount: participants.filter(names => albumPairPresent(names, pair)).length, relationshipEventCount: eventCounts.get(albumPairKey(pair)) ?? 0 }))
    .sort((a, b) => Number(b.hasPersona) - Number(a.hasPersona) || b.sharedSceneCount - a.sharedSceneCount || albumPairKey(a).localeCompare(albumPairKey(b)));
  const shown = recorded.filter(pair => pair.relationshipEventCount > 0 || (albumPairKey(pair) === defaultKey && (pair.sharedSceneCount > 0 || recorded.length === 1)));
  return { pairs: shown, hiddenPairCount: recorded.length - shown.length, recorded };
}
