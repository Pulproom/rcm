import { createHash } from "node:crypto";
import { ALBUM_BLOCK_KINDS, AlbumBondSchema, AlbumBondEventSchema, albumTurningPoints, albumDateOnly, ANNIVERSARY_KINDS, defaultBlockEnabled, orderStoryMemories, albumFieldsFingerprint,
  buildAnniversaries, landmarkLabel, type AlbumBlockKind, type AlbumMaterialItem, type AlbumMaterials, type StoredLandmarkKind } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { readMemoryBookmarks } from "./memory-bookmarks.js";
import { recognitionOnlyMemorySql } from "./memory-group-search.js";
import { parseLandmarkKinds } from "./memory-search-document.js";
import { listStorySpine } from "./story-spine.js";
import { listRecordedSocialKnowledge } from "./social-knowledge.js";
import { listPairProgress, readProgressCells } from "./pair-progress.js";
import { albumPairKey, albumPairPresent, type AlbumPair } from "@rcm/shared";
import { collectAlbumPairs } from "./album-pairs.js";
import { readPersonaName, readViewPreferences } from "./view-preferences.js";
import { lookupTranslations, translationCacheKey } from "./translation-cache.js";
import { userChatSql } from "./chat-work.js";
import type { AlbumChatSummary } from "@rcm/shared";
import { albumStoryPeriod, collectAlbumTogether } from "./album-together.js";

export type { AlbumMaterialItem, AlbumMaterials } from "@rcm/shared";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const identity = (...parts: string[]): string => hash(JSON.stringify(parts)).slice(0, 32);
const strings = (json: string): string[] => (JSON.parse(json) as unknown[]).filter((value): value is string => typeof value === "string");
interface SceneRow {
  id: string; type: string; title: string; content: string; story_time: string | null; story_time_normalized: string | null;
  locations_json: string; landmark_kinds_json: string; evidence_json: string; source_ordinal: number | null;
  salience: number; created_revision: number; created_at: number; participants_json: string;
}
interface ChapterGroup {
  groupId: string; title: string; summary: string; startOrdinal: number; endOrdinal: number;
  linkedMemoryIds: string[]; hidden: boolean; segments?: ChapterGroup[];
}

export function listAlbumChats(db: RcmDatabase): AlbumChatSummary[] {
  const scenes = db.prepare(`SELECT m.chat_id,m.id,m.story_time,m.story_time_normalized,m.created_revision FROM memories m
    JOIN chats c ON c.id=m.chat_id WHERE ${userChatSql("c")} AND m.active=1 AND m.type='episode'
    AND m.capsule_parent_id IS NULL AND NOT ${recognitionOnlyMemorySql("m")}`).all() as Array<{ chat_id: string; id: string; story_time: string | null; story_time_normalized: string | null; created_revision: number }>;
  const byChat = new Map<string, typeof scenes>();
  for (const scene of scenes) { const rows = byChat.get(scene.chat_id) ?? []; rows.push(scene); byChat.set(scene.chat_id, rows); }
  const chats = db.prepare(`SELECT id,chat_title,character_id,static_json FROM chats c WHERE ${userChatSql("c")} ORDER BY updated_at DESC,id`).all() as Array<{ id: string; chat_title: string | null; character_id: string; static_json: string | null }>;
  return chats.flatMap(chat => {
    const rows = byChat.get(chat.id); if (!rows?.length) return [];
    let characterName = chat.character_id;
    try { const name = JSON.parse(chat.static_json ?? "{}").characterName; if (typeof name === "string" && name.trim()) characterName = name.trim(); } catch { /* Same stored-ID fallback as materials. */ }
    const personaName = readPersonaName(db, chat.id) ?? "";
    return [{ chat: { id: chat.id, title: chat.chat_title ?? "", characterId: chat.character_id, characterName, personaName },
      people: { me: { name: personaName }, partner: { name: characterName } }, counts: { scenes: rows.length },
      period: albumStoryPeriod(rows) }];
  });
}

export function collectAlbumMaterials(db: RcmDatabase, chatId: string, options: { preferTranslation: true; pair?: AlbumPair; timeZone?: string }): AlbumMaterials {
  return db.transaction(() => {
    const collectedAt = Date.now();
    const chat = db.prepare("SELECT id,chat_title,character_id,static_json,memory_language FROM chats WHERE id=?").get(chatId) as {
      id: string; chat_title: string | null; character_id: string; static_json: string | null; memory_language: string;
    } | undefined;
    if (!chat) throw Object.assign(new Error("Album source chat not found"), { code: "ALBUM_SOURCE_NOT_FOUND" });
    let characterName = chat.character_id;
    try {
      const name = (JSON.parse(chat.static_json ?? "{}") as { characterName?: unknown }).characterName;
      if (typeof name === "string" && name.trim()) characterName = name.trim();
    } catch { /* The stored character ID remains the same fallback used by the dashboard. */ }
    const personaName = readPersonaName(db, chatId) ?? "";
    const blocks = Object.fromEntries(ALBUM_BLOCK_KINDS.map(kind => [kind, []])) as unknown as Record<AlbumBlockKind, AlbumMaterialItem[]>;
    const pending: Array<{ item: AlbumMaterialItem; field: string; kind: string; itemId: string; text: string }> = [];
    const item = (block: AlbumBlockKind, kind: string, sourceId: string, fields: Record<string, string>, createdAt = 0): AlbumMaterialItem => ({
      createdAt,
      id: `${block}:${kind}:${sourceId}`, origin: { kind, sourceId, fingerprint: "pending" }, edited: {}, fields, photos: [], suggested: defaultBlockEnabled(block),
    });
    const translatedField = (target: AlbumMaterialItem, field: string, kind: string, itemId: string) => {
      const text = target.fields[field];
      if (text) pending.push({ item: target, field, kind, itemId, text });
    };
    const memories = db.prepare(`SELECT m.id,m.type,m.title,m.content,m.story_time,m.story_time_normalized,m.locations_json,m.landmark_kinds_json,m.evidence_json,m.participants_json,
      m.salience,m.created_revision,m.created_at,NULL AS source_ordinal
      FROM memories m WHERE m.chat_id=? AND m.active=1 AND m.capsule_parent_id IS NULL
        AND NOT ${recognitionOnlyMemorySql("m")}`).all(chatId) as SceneRow[];
    // Read each chat-owned source table once. An ORDER BY on the old per-scene
    // IN query made SQLite walk the entire message ordinal index for every scene.
    const evidence = new Map<string, Set<string>>();
    for (const row of db.prepare("SELECT memory_id,message_id FROM evidence_spans WHERE chat_id=?").all(chatId) as Array<{ memory_id: string; message_id: string }>) {
      const ids = evidence.get(row.memory_id) ?? new Set<string>(); ids.add(row.message_id); evidence.set(row.memory_id, ids);
    }
    type Dialogue = { id: string; memory_id: string; message_id: string; speaker: string; text: string; created_at: number };
    const dialogues = new Map<string, Dialogue[]>();
    for (const row of db.prepare("SELECT id,memory_id,message_id,speaker,text,created_at FROM memory_dialogues WHERE chat_id=? ORDER BY memory_id,ordinal,id").all(chatId) as Dialogue[]) {
      const rows = dialogues.get(row.memory_id) ?? []; rows.push(row); dialogues.set(row.memory_id, rows);
    }
    const wanted = new Set<string>();
    for (const memory of memories) {
      const ids = evidence.get(memory.id) ?? new Set<string>();
      for (const ref of JSON.parse(memory.evidence_json) as Array<{ messageId?: string }>) if (ref.messageId) ids.add(ref.messageId);
      evidence.set(memory.id, ids);
      for (const id of ids) wanted.add(id);
      for (const dialogue of dialogues.get(memory.id) ?? []) wanted.add(dialogue.message_id);
    }
    type SourceMessage = { message_id: string; ordinal: number; lifecycle: string; body: string };
    const sourceMessages = new Map((db.prepare(`SELECT message_id,ordinal,lifecycle,COALESCE(content,canonical_content,'') body FROM messages
      WHERE chat_id=? AND message_id IN (SELECT value FROM json_each(?))`).all(chatId, JSON.stringify([...wanted])) as SourceMessage[]).map(row => [row.message_id, row]));
    for (const memory of memories) {
      const ordinals = [...evidence.get(memory.id)!].flatMap(id => { const row = sourceMessages.get(id); return row ? [row.ordinal] : []; });
      memory.source_ordinal = ordinals.length ? Math.min(...ordinals) : null;
    }
    const rows = orderStoryMemories(memories.filter(memory => memory.type === "episode"));
    const defaultPair = { me: personaName, partner: characterName };
    const { pairs: candidates, hiddenPairCount, recorded } = collectAlbumPairs(db, chatId, { me: personaName, partner: characterName }, rows.map(row => strings(row.participants_json)));
    const requested = options.pair;
    const initialPair = candidates.find(p => albumPairKey(p) === albumPairKey(defaultPair)) ?? candidates[0] ?? defaultPair;
    const candidate = recorded.find(p => albumPairKey(p) === albumPairKey(requested ?? initialPair));
    if (!candidate) throw Object.assign(new Error("Choose a recorded album pair"), { code: "ALBUM_PAIR_NOT_FOUND" });
    const chosen = requested && !candidate.hasPersona ? requested : candidate;
    const people = { me: { name: chosen.me }, partner: { name: chosen.partner } };
    const a = chosen.me, b = chosen.partner;
    const matchesPair = (left: string, right: string) => albumPairKey({ me: left, partner: right }) === albumPairKey(chosen);
    const pairSql = "((from_entity=? AND to_entity=?) OR (from_entity=? AND to_entity=?))";
    const pairArgs = [chatId, a, b, b, a];
    const byId = new Map(rows.map(row => [row.id, row]));
    const landmarks = memories.map(row => ({ ...row, landmarkKinds: parseLandmarkKinds(row.landmark_kinds_json), locations: strings(row.locations_json) }));
    const hidden = readViewPreferences(db, chatId).hiddenAnniversaries;
    const pairs = new Map<string, [string, string]>();
    for (const memory of landmarks) for (const landmark of memory.landmarkKinds) if (landmark.pair) {
      const pair = [...landmark.pair].sort() as [string, string]; pairs.set(JSON.stringify(pair), pair);
    }
    const firsts = new Map<string, { memoryId: string; index: number; label: string; date: string; location: string; kind: string }>();
    for (const [a, b] of [...pairs.values()].filter(([a, b]) => matchesPair(a, b))) for (const anniversary of buildAnniversaries({ memories: landmarks }, { a, b }, hidden)) {
      firsts.set(anniversary.hideKey, { memoryId: anniversary.memoryId, index: anniversary.index, label: anniversary.label,
        date: anniversary.storyTime ?? "", location: anniversary.place ?? "", kind: anniversary.kind });
    }
    for (const memory of landmarks) memory.landmarkKinds.forEach((landmark: StoredLandmarkKind, index: number) => {
      if (landmark.pair && !matchesPair(...landmark.pair)) return;
      const key = `${memory.id}#${index}`;
      if ((ANNIVERSARY_KINDS as readonly string[]).includes(landmark.kind) || hidden.includes(key) || landmark.kind === "intimacy_milestone") return;
      firsts.set(key, { memoryId: memory.id, index, label: landmarkLabel(landmark), date: landmark.storyTime ?? memory.story_time_normalized ?? memory.story_time ?? "",
        location: memory.locations[0] ?? "", kind: landmark.kind });
    });
    for (const [key, first] of firsts) {
      const entry = item("firsts", "landmark", key, { title: first.label, date: first.date, location: first.location, kind: first.kind }, memories.find(m => m.id === first.memoryId)?.created_at);
      if (first.kind === "anniversary_basis") translatedField(entry, "title", "landmark-label", `landmark:${key}:label`);
      blocks.firsts.push(entry);
    }
    const landmarkScenes = new Set([...firsts.values()].map(first => first.memoryId));
    const bookmarks = readMemoryBookmarks(db, chatId);
    const sceneItems = new Map<string, AlbumMaterialItem>();
    for (const row of rows) {
      const scene = item("story", "memory", row.id, { date: row.story_time_normalized ?? row.story_time ?? "", location: strings(row.locations_json)[0] ?? "", title: row.title, summary: row.content }, row.created_at);
      translatedField(scene, "title", "memory-title", `${row.id}:title`);
      translatedField(scene, "summary", "memory-content", `${row.id}:content`);
      const inlays = new Set<string>();
      // Only IDs tied to this scene's evidence/dialogues; never its whole batch.
      const sourceIds = new Set([...evidence.get(row.id)!, ...(dialogues.get(row.id) ?? []).map(d => d.message_id)]);
      const sources = [...sourceIds].flatMap(id => { const source = sourceMessages.get(id); return source && ["committed", "pending", "client_pruned"].includes(source.lifecycle) ? [source] : []; })
        .sort((a, b) => a.ordinal - b.ordinal || a.message_id.localeCompare(b.message_id));
      for (const { body } of sources) {
        // Parse Risu-owned inlay envelopes only; never classify or return prose.
        for (const match of body.matchAll(/\{\{inlay(?:ed)?::([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}\}/gi)) inlays.add(match[1]!.toLowerCase());
      }
      scene.inlayIds = [...inlays];
      scene.signals = { pair: albumPairPresent(strings(row.participants_json), chosen), anniversary: landmarkScenes.has(row.id), bookmark: bookmarks.has(row.id), illustration: inlays.size > 0 };
      scene.children = (dialogues.get(row.id) ?? []).map((dialogue, index) => {
        const fields = { speaker: dialogue.speaker, text: dialogue.text, date: scene.fields.date! };
        const quote = item("quotes", "dialogue", dialogue.id, { ...fields }, dialogue.created_at); quote.suggested = index < 2;
        translatedField(quote, "text", "dialogue", `${row.id}:dialogue:${index}`); blocks.quotes.push(quote);
        const child = item("story", "dialogue", dialogue.id, fields, dialogue.created_at); child.suggested = index < 2;
        translatedField(child, "text", "dialogue", `${row.id}:dialogue:${index}`);
        return child;
      });
      sceneItems.set(row.id, scene);
    }
    const spine = listStorySpine(db, chatId) as { arcs: ChapterGroup[]; currentProgress: ChapterGroup[] };
    const groups = [...spine.arcs.flatMap(arc => arc.hidden ? [] : (arc.segments ?? [])), ...spine.currentProgress]
      .filter(group => !group.hidden).sort((a, b) => a.startOrdinal - b.startOrdinal || a.endOrdinal - b.endOrdinal || a.groupId.localeCompare(b.groupId));
    const assigned = new Set<string>();
    for (const group of groups) {
      const linked = new Set(group.linkedMemoryIds);
      const children = rows.filter(row => linked.has(row.id) && !assigned.has(row.id)).map(row => { assigned.add(row.id); return sceneItems.get(row.id)!; });
      if (!children.length) continue;
      const chapter = item("story", "chapter", group.groupId, { title: group.title, summary: group.summary, date: children[0]!.fields.date! });
      translatedField(chapter, "title", "story-title", `story:${group.groupId}:title`);
      translatedField(chapter, "summary", "story-summary", `story:${group.groupId}:summary`);
      chapter.createdAt = Math.min(...children.map(scene => scene.createdAt ?? 0));
      chapter.children = children; blocks.story.push(chapter);
    }
    const unassigned = rows.filter(row => !assigned.has(row.id)).map(row => sceneItems.get(row.id)!);
    if (unassigned.length) blocks.story.push({ ...item("story", "chapter", `unassigned:${chatId}`, { title: "", summary: "", date: unassigned[0]!.fields.date! }), createdAt: Math.min(...unassigned.map(scene => scene.createdAt ?? 0)), children: unassigned });
    for (const chapter of blocks.story) {
      const ranked = [...(chapter.children ?? [])].sort((a, b) => {
        const aid = a.origin!.sourceId, bid = b.origin!.sourceId;
        return Number(b.signals?.pair) - Number(a.signals?.pair) || Number(landmarkScenes.has(bid)) - Number(landmarkScenes.has(aid))
          || Number(bookmarks.has(bid)) - Number(bookmarks.has(aid))
          || Number(Boolean(b.inlayIds?.length)) - Number(Boolean(a.inlayIds?.length))
          || byId.get(bid)!.salience - byId.get(aid)!.salience;
      });
      const selected = new Set(ranked.slice(0, 3));
      for (const scene of chapter.children ?? []) scene.suggested = selected.has(scene);
    }
    const promises = db.prepare("SELECT id,promisor,promisee,content,status,scheduled_for,created_at FROM promises WHERE chat_id=? ORDER BY created_at,id").all(chatId) as Array<{ id: string; promisor: string; promisee: string; content: string; status: string; scheduled_for: string | null; created_at: number }>;
    for (const promise of promises) {
      const entry = item("promises", "promise", promise.id, { from: promise.promisor, to: promise.promisee, text: promise.content, status: promise.status, date: promise.scheduled_for ?? "" }, promise.created_at);
      translatedField(entry, "text", "promise", `promise:${promise.id}`); blocks.promises.push(entry);
    }
    for (const row of db.prepare("SELECT from_entity,to_entity,summary FROM relationship_projections WHERE chat_id=? ORDER BY from_entity,to_entity").all(chatId) as Array<{ from_entity: string; to_entity: string; summary: string }>) {
      if (!matchesPair(row.from_entity, row.to_entity)) continue;
      const entry = item("hearts", "relationship", identity(chatId, row.from_entity, row.to_entity), { from: row.from_entity, to: row.to_entity, summary: row.summary });
      entry.createdAt = (db.prepare("SELECT MIN(created_at) value FROM (SELECT created_at FROM relationship_events WHERE chat_id=? AND from_entity=? AND to_entity=? AND active=1 UNION ALL SELECT created_at FROM relationship_baselines WHERE chat_id=? AND from_entity=? AND to_entity=? AND active=1)").get(chatId, row.from_entity, row.to_entity, chatId, row.from_entity, row.to_entity) as { value: number | null }).value ?? 0;
      translatedField(entry, "summary", "relationship", `relationship:${row.from_entity}|${row.to_entity}:summary`); blocks.hearts.push(entry);
    }
    const progressPairs = listPairProgress(db, chatId).filter(pair => matchesPair(pair.persona, pair.character));
    // Non-persona stored progress is not part of the dashboard's persona-only defaults.
    for (const row of db.prepare("SELECT * FROM pair_progress WHERE chat_id=? ORDER BY created_at,id").all(chatId) as Array<{ id: string; persona: string; character: string; item_id: string; label: string; mode: "each" | "mutual"; hidden: number; custom: number; cells_json: string }>) {
      if (!matchesPair(row.persona, row.character)) continue;
      let pair = progressPairs.find(p => p.persona === row.persona && p.character === row.character);
      if (!pair) { pair = { persona: row.persona, character: row.character, items: [] }; progressPairs.push(pair); }
      if (!pair.items.some(i => i.id === row.item_id)) pair.items.push({ id: row.item_id, label: row.label, mode: row.mode, hidden: Boolean(row.hidden), custom: Boolean(row.custom), cells: readProgressCells(db, chatId, row) });
    }
    for (const pair of progressPairs) for (const progress of pair.items.filter(entry => !entry.hidden)) {
      const entry = item("progress", "progress", identity(chatId, pair.persona, pair.character, progress.id), { title: progress.label, persona: pair.persona, character: pair.character, mode: progress.mode });
      entry.createdAt = (db.prepare("SELECT created_at FROM pair_progress WHERE chat_id=? AND persona=? AND character=? AND item_id=?").get(chatId, pair.persona, pair.character, progress.id) as { created_at: number } | undefined)?.created_at ?? 0;
      if (progress.custom && chat.memory_language !== "ko") entry.fields.__lang = chat.memory_language;
      entry.children = progress.cells.map(cell => item("progress", "progress-cell", identity(chatId, pair.persona, pair.character, progress.id, cell.side), { side: cell.side, status: cell.state }, entry.createdAt));
      blocks.progress.push(entry);
    }
    for (const relation of listRecordedSocialKnowledge(db, chatId, [a, b])) for (const term of relation.addressTerms) {
      if (!matchesPair(relation.holder, relation.subject)) continue;
      const createdAt = (db.prepare("SELECT MIN(e.created_at) value FROM social_knowledge_events e,json_each(e.address_terms_json) t WHERE e.chat_id=? AND e.holder=? AND e.subject=? AND e.active=1 AND t.value=?").get(chatId, relation.holder, relation.subject, term) as { value: number | null }).value ?? 0;
      blocks.nicknames.push(item("nicknames", "nickname", identity(chatId, relation.holder, relation.subject, term), { from: relation.holder, to: relation.subject, text: term,
        ...(chat.memory_language !== "ko" ? { __lang: chat.memory_language } : {}) }, createdAt));
    }
    for (const row of db.prepare(`SELECT p.id,p.participant_a,p.participant_b,p.act,p.custom_label,p.circumstance,p.created_at,
      COALESCE(m.story_time_normalized,m.story_time,'') date FROM physical_intimacy_milestones p LEFT JOIN memories m ON m.id=p.source_memory_id AND m.chat_id=p.chat_id
      WHERE p.chat_id=? AND p.active=1 AND p.deleted_by_user=0 AND (p.source_memory_id IS NULL OR m.active=1) ORDER BY p.created_at,p.id`).all(chatId) as Array<{ id: string; participant_a: string; participant_b: string; act: string; custom_label: string | null; circumstance: string | null; date: string; created_at: number }>) {
      if (!matchesPair(row.participant_a, row.participant_b)) continue;
      const entry = item("intimacy", "intimacy", row.id, { from: row.participant_a, to: row.participant_b, act: row.act, title: row.custom_label ?? "", summary: row.circumstance ?? "", date: row.date }, row.created_at);
      translatedField(entry, "summary", "physical-intimacy", `intimacy:${row.id}:circumstance`); blocks.intimacy.push(entry);
    }
    // Source ordinals locate scenes; no prose classification.
    const orderedScenes = [...rows].sort((x, y) => (x.source_ordinal ?? 0) - (y.source_ordinal ?? 0));
    const eventRows = db.prepare(`SELECT e.*,m.title AS source_title,COALESCE(m.story_time_normalized,m.story_time,'') AS source_date FROM relationship_events e LEFT JOIN memories m ON m.id=e.source_memory_id AND m.chat_id=e.chat_id
      WHERE e.chat_id=? AND ${pairSql} AND e.active=1 AND e.user_hidden=0 AND (e.source_memory_id IS NULL OR m.active=1)
      ORDER BY e.source_start_ordinal,e.id`).all(...pairArgs) as Array<{ id: string; from_entity: string; to_entity: string; changes_json: string; reason: string; source_memory_id: string | null; source_start_ordinal: number | null; source_title: string | null; source_date: string; created_at: number }>;
    const bondEvents = eventRows.flatMap(row => {
      const source = memories.find(m => m.id === row.source_memory_id);
      const ordinal = row.source_start_ordinal ?? source?.source_ordinal ?? 0;
      const scene = orderedScenes.find(m => m.id === row.source_memory_id) ?? [...orderedScenes].reverse().find(m => (m.source_ordinal ?? 0) <= ordinal);
      const entry = item("bond", "relationship-event", row.id, { title: row.source_title ?? "", summary: row.reason, date: row.source_date || scene?.story_time_normalized || scene?.story_time || "" });
      translatedField(entry, "summary", "relationship-event", `relationship-event:${row.id}:reason`);
      if (row.source_memory_id) translatedField(entry, "title", "memory-title", `${row.source_memory_id}:title`);
      const parsed = AlbumBondEventSchema.safeParse({ id: row.id, from: row.from_entity, to: row.to_entity, reason: row.reason,
        sourceMemoryId: row.source_memory_id ?? undefined, sourceOrdinal: ordinal, scene: Math.max(1, orderedScenes.findIndex(m => m.id === scene?.id) + 1), changes: JSON.parse(row.changes_json) });
      return parsed.success ? [{ event: parsed.data, entry, originalTitle: row.source_title }] : [];
    });
    const projections = db.prepare(`SELECT from_entity,to_entity,axes_json,active_tensions_json FROM relationship_projections WHERE chat_id=? AND ${pairSql}`).all(...pairArgs) as Array<{ from_entity: string; to_entity: string; axes_json: string; active_tensions_json: string }>;
    const baselines = db.prepare(`SELECT from_entity,to_entity,projection_axes_json FROM relationship_baselines WHERE chat_id=? AND ${pairSql} AND active=1`).all(...pairArgs) as Array<{ from_entity: string; to_entity: string; projection_axes_json: string | null }>;
    const bondDirections = [[a, b], [b, a]].map(([from, to]) => {
      const projection = projections.find(p => p.from_entity === from && p.to_entity === to);
      const baseline = baselines.find(p => p.from_entity === from && p.to_entity === to);
      const levels = (json: string) => Object.fromEntries(Object.entries(JSON.parse(json) as Record<string, string | { level?: string }>).flatMap(([axis, value]) => {
        const level = typeof value === "string" ? value : value?.level;
        return typeof level === "string" ? [[axis, level]] : [];
      }));
      const tensions = strings(projection?.active_tensions_json ?? "[]").map((text, index) => {
        const entry = item("bond", "relationship-tension", `${from}|${to}:${index}`, { text });
        translatedField(entry, "text", "relationship-tension", `relationship:${from}|${to}:tension:${index}`);
        return entry;
      });
      return { from: from!, to: to!, baseline: levels(baseline?.projection_axes_json ?? "{}"), current: levels(projection?.axes_json ?? "{}"), tensions };
    });
    const counts = { scenes: rows.length, chapters: blocks.story.length, promises: blocks.promises.length, quotes: blocks.quotes.length };
    blocks.cover.push(item("cover", "chat", chatId, { title: chat.chat_title ?? "", me: people.me.name, partner: people.partner.name }));
    blocks.intro.push(item("intro", "chat", chatId, { me: people.me.name, partner: people.partner.name, ...Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, String(value)])) }));
    if (options.preferTranslation && chat.memory_language !== "ko") {
      const serverInstanceId = (db.prepare("SELECT value FROM server_meta WHERE key='instance_id'").get() as { value: string }).value;
      const prepared = pending.map(field => ({ ...field, key: translationCacheKey({ serverInstanceId, chatId, kind: field.kind, itemId: field.itemId,
        sourceHash: hash(field.text), provider: "", sourceLanguage: chat.memory_language, targetLanguage: "ko" }) }));
      const keys = [...new Set(prepared.map(field => field.key))];
      const cache = new Map<string, string>();
      for (let offset = 0; offset < keys.length; offset += 500) for (const entry of lookupTranslations(db, keys.slice(offset, offset + 500))) cache.set(entry.key, entry.translated);
      for (const field of prepared) {
        const translated = cache.get(field.key);
        if (translated?.trim()) field.item.fields[field.field] = translated;
        else field.item.fields.__lang = chat.memory_language;
      }
    }
    const firstSceneByDay = new Map<string, AlbumMaterialItem>();
    for (const scene of sceneItems.values()) { const day = albumDateOnly(scene.fields.date ?? ""); if (!firstSceneByDay.has(day)) firstSceneByDay.set(day, scene); }
    const bond = AlbumBondSchema.parse({ events: bondEvents.map(({ event, entry, originalTitle }) => {
      // A missing translated memory title falls back to that day's scene title, then its original.
      const dayScene = entry.fields.date ? firstSceneByDay.get(albumDateOnly(entry.fields.date)) : undefined;
      const title = entry.fields.title && entry.fields.title !== originalTitle ? entry.fields.title : dayScene?.fields.title || entry.fields.title;
      return { ...event, title, reason: entry.fields.summary, date: albumDateOnly(entry.fields.date ?? "") };
    }), directions: bondDirections.map(d => ({ ...d, tensions: d.tensions.map(t => t.fields.text!) })) });
    blocks.bond = albumTurningPoints(bond.events).map(turn => ({ ...turn, children: undefined, suggested: true,
      createdAt: Math.max(0, ...(turn.bondEventIds ?? []).map(id => eventRows.find(e => e.id === id)?.created_at ?? 0)),
      origin: { kind: "relationship-turn", sourceId: turn.id, fingerprint: "pending" } }));
    const finalize = (items: AlbumMaterialItem[]): void => {
      for (const entry of items) { entry.origin!.fingerprint = albumFieldsFingerprint(entry.fields); if (entry.children) finalize(entry.children); }
    };
    Object.values(blocks).forEach(finalize);
    const period = albumStoryPeriod(rows);
    return { collectedAt, pairs: candidates, hiddenPairCount, defaultPair, chat: { id: chatId, title: chat.chat_title ?? "", characterName, characterId: chat.character_id, personaName }, people, counts,
      period, blocks, bond, ...(options.timeZone ? { together: collectAlbumTogether(db, chatId, { timeZone: options.timeZone, now: collectedAt, storyPeriod: period }) } : {}) };
  })();
}
