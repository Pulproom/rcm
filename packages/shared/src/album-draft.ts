import { ALBUM_DRAFT_ORDER, AlbumDocumentSchema, AlbumItemSchema, defaultBlockEnabled, type AlbumBlockKind, type AlbumItem, type AlbumTheme } from "./album.js";
import { albumDateOnly, preferredAlbumLine, shortestAlbumLines } from "./album-presentation.js";
export { albumDateOnly } from "./album-presentation.js";
import type { AlbumBond } from "./album-bond.js";
import { albumTogetherItems, availableTogetherCards, type AlbumTogetherRecords } from "./album-together.js";
import { albumPairKey, type AlbumPair, type AlbumPairCandidate } from "./album-pair.js";
import { compareParsedStoryTimes, parseStoryTime } from "./story-time.js";

export type AlbumMaterialItem = Omit<AlbumItem, "children"> & { suggested: boolean; signals?: { pair?: boolean; anniversary: boolean; bookmark: boolean; illustration: boolean }; inlayIds?: string[]; children?: AlbumMaterialItem[] };
export interface AlbumMaterials {
  collectedAt?: number;
  pairs?: AlbumPairCandidate[];
  hiddenPairCount?: number;
  defaultPair?: AlbumPair;
  chat: { id: string; title: string; characterName: string; characterId?: string; personaName: string };
  people: { me: { name: string }; partner: { name: string } };
  counts: { scenes: number; chapters: number; promises: number; quotes: number };
  period: { from?: string; to?: string };
  blocks: Record<AlbumBlockKind, AlbumMaterialItem[]>;
  bond?: AlbumBond;
  together?: AlbumTogetherRecords;
}
/** Chat picker data excludes scene bodies, dialogues and relationship histories. */
export type AlbumChatSummary = Pick<AlbumMaterials, "chat" | "people" | "period"> & { counts: Pick<AlbumMaterials["counts"], "scenes"> };
/** Frozen transport parts keep JSON parsing below the host proxy's per-message budget. */
export interface AlbumTransferPage {
  transferId: string; next: number | null;
  entries: Array<{ path: Array<string | number>; value: unknown; append?: true }>;
}

/** Known calendars first; unparseable dates retain their relative order at the end. */
export function sortAlbumItemsByDate<T extends AlbumItem>(items: readonly T[]): T[] {
  const rank = (date: ReturnType<typeof parseStoryTime>) => date.calendar === "numeric" ? 0 : date.calendar === "unknown" ? 2 : 1;
  return items.map(item => ({ item, date: parseStoryTime(item.fields.date) }))
    .sort((a, b) => rank(a.date) - rank(b.date) || (compareParsedStoryTimes(a.date, b.date) ?? 0)).map(entry => entry.item);
}

export function sortAlbumFirsts<T extends AlbumItem>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return sortAlbumItemsByDate(items).filter(item => {
      const title = item.fields.title?.trim();
      if (!title) return true;
      if (seen.has(title)) return false;
      seen.add(title); return true;
    });
}

export interface AlbumDraftChoices {
  blocks?: AlbumBlockKind[];
  perChapter?: number;
  scenePicks?: Record<string, boolean>;
  quotePicks?: Record<string, string[]>;
  tint?: string;
  title?: string;
}
export function recommendedAlbumScenes(chapter: AlbumMaterialItem, count = 2): AlbumMaterialItem[] {
  return sortAlbumItemsByDate(chapter.children ?? []).sort((a, b) =>
    Number(b.signals?.pair ?? false) - Number(a.signals?.pair ?? false)
    || Number(b.signals?.anniversary ?? false) - Number(a.signals?.anniversary ?? false)
    || Number(b.signals?.bookmark ?? false) - Number(a.signals?.bookmark ?? false)
    || Number(b.signals?.illustration ?? Boolean(b.inlayIds?.length || b.photos.length)) - Number(a.signals?.illustration ?? Boolean(a.inlayIds?.length || a.photos.length))
    || (a.signals || b.signals ? 0 : Number(b.suggested ?? false) - Number(a.suggested ?? false))).slice(0, Math.max(1, Math.min(5, count)));
}
export function recommendedAlbumQuotes<T extends AlbumItem & { suggested?: boolean }>(items: T[]): T[] {
  return shortestAlbumLines(items).sort((a, b) => Number(b.suggested ?? false) - Number(a.suggested ?? false) || [...(a.fields.text ?? a.fields.body ?? "")].length - [...(b.fields.text ?? b.fields.body ?? "")].length);
}
/** Shared wizard defaults. Caller supplies identity; no clock, storage, or source mutation. */
export function buildAlbumDraft(materials: AlbumMaterials, options: { id: string; theme?: AlbumTheme; choices?: AlbumDraftChoices }) {
  const choices = options.choices ?? {};
  const copy = (item: AlbumMaterialItem): AlbumItem => AlbumItemSchema.parse({ ...item,
    photos: [...item.photos, ...(item.inlayIds ?? []).map(photoId => ({ photoId }))], children: item.children?.map(copy),
  });
  const story = materials.blocks.story.map(chapter => {
    const picked = new Set(recommendedAlbumScenes(chapter, choices.perChapter ?? 2));
    return copy({ ...chapter, children: (chapter.children ?? []).filter(scene => choices.scenePicks?.[scene.id] ?? picked.has(scene))
      .map(scene => ({ ...scene, children: choices.quotePicks?.[scene.id] ? (scene.children ?? []).filter(q => choices.quotePicks![scene.id]!.includes(q.id)) : recommendedAlbumQuotes(scene.children ?? []).slice(0, 1) })) });
  });
  const dates = [materials.period.from, materials.period.to].filter((date): date is string => Boolean(date)).map(albumDateOnly);
  const gallery = materials.blocks.gallery.map(copy);
  const enabled = ALBUM_DRAFT_ORDER.filter(kind => kind === "cover" || (choices.blocks ? choices.blocks.includes(kind) : defaultBlockEnabled(kind)));
  const interludes = enabled.includes("quotes");
  const blocks = enabled.filter(kind => kind !== "quotes").flatMap(kind => {
    if (kind === "together") return materials.together && availableTogetherCards(materials.together).length
      ? [{ id: "together", kind, together: materials.together, items: albumTogetherItems(materials.together) }] : [];
    if (kind === "story" && interludes) {
      const groups = [];
      const used = new Set<string>();
      for (let at = 0; at < story.length; at += 3) {
        const chapters = story.slice(at, at + 3);
        const candidates = chapters.flatMap(ch => (ch.children ?? []).flatMap(sc => (sc.children ?? []).map(q => ({ ...q, fields: { ...q.fields, date: q.fields.date ?? sc.fields.date ?? "" } })))).filter(q => !used.has(q.id));
        const line = preferredAlbumLine(candidates, materials.people);
        groups.push({ id: at ? `story-${at / 3 + 1}` : "story", kind: "story", items: chapters });
        if (line) { used.add(line.id); groups.push({ id: `quotes-${at / 3 + 1}`, kind: "quotes", items: [line] }); }
      }
      return groups;
    }
    return [{ id: kind, kind, ...(kind === "bond" ? { bond: materials.bond } : {}),
      items: kind === "cover" ? [] : kind === "story" ? story : kind === "gallery" ? gallery
        : kind === "firsts" ? sortAlbumFirsts(materials.blocks.firsts).map(copy) : kind === "hearts" ? materials.blocks.hearts.filter(item => {
          const names = [materials.people.me.name, materials.people.partner.name];
          const from = item.fields.from, to = item.fields.to;
          return Boolean(from && to && from !== to && names.includes(from) && names.includes(to));
        }).map(copy) : materials.blocks[kind].map(copy),
    }];
  });
  if (interludes && !enabled.includes("story")) {
    const line = preferredAlbumLine(materials.blocks.quotes, materials.people);
    if (line) blocks.splice(Math.min(2, blocks.length), 0, { id: "quotes-1", kind: "quotes", items: [copy(line)] });
  }
  // Interludes own their chosen line; all other chosen lines stay inside their scenes.
  const lifted = new Set(blocks.filter(b => b.kind === "quotes").flatMap(b => b.items.map(i => i.id)));
  for (const b of blocks.filter(b => b.kind === "story")) for (const ch of b.items) for (const sc of ch.children ?? []) sc.children = sc.children?.filter(q => !lifted.has(q.id));
  return AlbumDocumentSchema.parse({ version: 1, id: options.id,
    title: choices.title?.trim() || [materials.people.me.name, materials.people.partner.name].filter(Boolean).join(" & "),
    subtitle: materials.chat.characterName || materials.chat.title, people: materials.people,
    periodLabel: [...new Set(dates)].join(" — "), style: { theme: options.theme ?? "book", tint: choices.tint },
    source: { chatId: materials.chat.id, chatTitle: materials.chat.title, characterName: materials.chat.characterName, characterId: materials.chat.characterId,
      personaName: materials.chat.personaName, sourceAvailable: true, defaultPair: albumPairKey({ me: materials.people.me.name, partner: materials.people.partner.name }) === albumPairKey(materials.defaultPair ?? { me: materials.chat.personaName, partner: materials.chat.characterName }) },
    blocks,
  });
}
