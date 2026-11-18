import { ALBUM_BLOCK_KINDS, AlbumItemSchema, type AlbumBlockKind, type AlbumDocument, type AlbumItem } from "./album.js";
import { sortAlbumItemsByDate, type AlbumMaterials } from "./album-draft.js";
import { compareStoryTimes } from "./story-time.js";
import { albumTogetherItems, type AlbumTogetherRecords } from "./album-together.js";

export interface Candidate { blockKind: AlbumBlockKind; item: AlbumItem; placeAfterItemId?: string; chapter?: { item: AlbumItem; placeAfterItemId?: string } }
export interface ChangedCandidate { blockKind: AlbumBlockKind; itemId: string; before: Record<string, string>; after: Record<string, string>; userEdited: boolean }
export interface RemovedCandidate { blockKind: AlbumBlockKind; itemId: string }
export interface AlbumUpdateCandidates { available: boolean; collectedAt?: number; added: Candidate[]; changed: ChangedCandidate[]; removed: RemovedCandidate[] }

// SHA-256 content fingerprints must be synchronous in the pure browser editor as well as Node.
// This is a change marker, not a password/security primitive. Keep the Node cross-check test.
const ROUND_CONSTANTS = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
];
function sha256(text: string): string {
  const input = new TextEncoder().encode(text);
  const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  bytes.set(input); bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, Math.floor(input.length / 0x20000000));
  view.setUint32(bytes.length - 4, input.length * 8);
  const state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const words = new Uint32Array(64);
  const rotate = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15]!, y = words[i - 2]!;
      words[i] = words[i - 16]! + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + words[i - 7]! + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
    }
    let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!, e = state[4]!, f = state[5]!, g = state[6]!, h = state[7]!;
    for (let i = 0; i < 64; i++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + ROUND_CONSTANTS[i]! + words[i]!) >>> 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0; d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    [a,b,c,d,e,f,g,h].forEach((value, i) => { state[i] = state[i]! + value; });
  }
  return Array.from(state, value => value.toString(16).padStart(8, "0")).join("");
}

export function albumFieldsFingerprint(fields: Record<string, string>): string {
  return sha256(JSON.stringify(Object.keys(fields).sort().map(key => [key, fields[key]!.normalize("NFC").replace(/\r\n?/g, "\n").trim()]))).slice(0, 16);
}

function locate(items: AlbumItem[], id: string): { item: AlbumItem; siblings: AlbumItem[]; index: number } | undefined {
  for (const [index, item] of items.entries()) {
    if (item.id === id) return { item, siblings: items, index };
    const child = locate(item.children ?? [], id);
    if (child) return child;
  }
}
const descendants = (items: AlbumItem[]): AlbumItem[] => items.flatMap(item => [item, ...descendants(item.children ?? [])]);

const originKey = (item: AlbumItem): string | undefined => item.origin ? JSON.stringify([item.origin.kind, item.origin.sourceId]) : undefined;
// Collection and application share the same ID-or-origin identity, including user copies.
const itemKeys = (item: AlbumItem): string[] => [JSON.stringify(["id", item.id]), ...(item.origin ? [JSON.stringify(["origin", item.origin.kind, item.origin.sourceId])] : [])];
const sameItem = (a: AlbumItem, b: AlbumItem): boolean => itemKeys(a).some(key => itemKeys(b).includes(key));
interface Entry { item: AlbumItem; siblings: AlbumItem[] }
function flatten(items: AlbumItem[]): Entry[] {
  return items.flatMap(item => [{ item, siblings: items }, ...flatten(item.children ?? [])]);
}

export const albumMaterialsSince = (document: AlbumDocument): number => document.lastUpdatedFromMaterialsAt ?? document.createdAt;
export const isNewAlbumMaterial = (document: AlbumDocument, item: AlbumItem): boolean => (item.createdAt ?? 0) > albumMaterialsSince(document);

export function refreshAlbumTogether(doc: AlbumDocument, records: AlbumTogetherRecords): AlbumDocument {
  const next = structuredClone(doc);
  for (const block of next.blocks) {
    if (block.kind !== "together") continue;
    block.together = structuredClone(records);
    const existing = new Set(block.items.map(item => item.id));
    block.items.push(...albumTogetherItems(records).filter(item => !existing.has(item.id)));
  }
  return next;
}

export function collectAlbumUpdateCandidates(document: AlbumDocument, materials: AlbumMaterials, options: { includeOld?: boolean } = {}): AlbumUpdateCandidates {
  const result: AlbumUpdateCandidates = { available: true, collectedAt: materials.collectedAt, added: [], changed: [], removed: [] };
  for (const kind of ALBUM_BLOCK_KINDS) {
    if (kind === "cover" || kind === "together") continue; // Chrome and record snapshots are never update materials.
    const previous = document.blocks.filter(block => block.kind === kind).flatMap(block => flatten(block.items));
    const currentByKey = new Map<string, Entry[]>();
    for (const entry of previous) {
      for (const key of itemKeys(entry.item)) currentByKey.set(key, [...(currentByKey.get(key) ?? []), entry]);
    }
    const matchesFor = (item: AlbumItem) => [...new Set(itemKeys(item).flatMap(key => currentByKey.get(key) ?? []))];
    const fresh = sortAlbumItemsByDate(materials.blocks[kind]).map(item => AlbumItemSchema.parse(item));
    const freshEntries = flatten(fresh);
    const freshOrigins = new Set(freshEntries.map(({ item }) => originKey(item)).filter(key => key !== undefined));
    for (const { item } of previous) {
      const key = originKey(item);
      if (key && !freshOrigins.has(key)) result.removed.push({ blockKind: kind, itemId: item.id });
    }
    // Compare independently of chapter membership: regrouping must not hide changed scenes.
    for (const { item } of freshEntries) {
      for (const { item: old } of matchesFor(item)) {
        if (old.origin && item.origin && old.origin.fingerprint !== item.origin.fingerprint) result.changed.push({
          blockKind: kind, itemId: old.id, before: { ...old.fields }, after: { ...item.fields }, userEdited: Object.keys(old.edited).length > 0,
        });
      }
    }
    const visit = (items: AlbumItem[], parent?: AlbumItem, offeredAncestor = false) => {
      let preceding: AlbumItem | undefined;
      for (const item of items) {
        const matches = matchesFor(item);
        if (matches.length) {
          // A copied/moved scene is still present; do not add another copy under a new parent.
          const local = matches.find(entry => parent ? entry.siblings === parent.children : document.blocks.some(block => block.kind === kind && block.items === entry.siblings));
          if (local) preceding = local.item;
          visit(sortAlbumItemsByDate(item.children ?? []), matches[0]!.item);
        } else {
          const anchor = preceding?.id ?? parent?.id;
          if (!offeredAncestor) result.added.push({ blockKind: kind, item, ...(anchor ? { placeAfterItemId: anchor } : {}) });
          // Existing scenes can survive under a regrouped chapter. Offer their new children
          // separately, since adding that chapter preserves those scenes in their old location.
          visit(sortAlbumItemsByDate(item.children ?? []), undefined, true);
        }
      }
    };
    visit(fresh);
  }
  if (!options.includeOld) result.added = result.added.flatMap(candidate => {
    if (candidate.blockKind === "story" && materials.blocks.story.some(ch => sameItem(ch, candidate.item))) {
      const children = candidate.item.children?.filter(scene => isNewAlbumMaterial(document, scene)) ?? [];
      return children.length ? [{ ...candidate, item: { ...candidate.item, children } }] : [];
    }
    return isNewAlbumMaterial(document, candidate.item) ? [candidate] : [];
  });
  return result;
}

/** The editor offers missing scenes individually; selecting one can also restore its chapter. */
export function unusedAlbumMaterials(document: AlbumDocument, materials: AlbumMaterials): Record<AlbumBlockKind, Candidate[]> {
  const result = Object.fromEntries(ALBUM_BLOCK_KINDS.map(kind => [kind, []])) as unknown as Record<AlbumBlockKind, Candidate[]>;
  const candidates = collectAlbumUpdateCandidates(document, materials, { includeOld: true });
  for (const candidate of candidates.added) {
    if (candidate.blockKind === "cover" || candidate.blockKind === "together") continue;
    if (candidate.blockKind !== "story") { result[candidate.blockKind].push(candidate); continue; }
    const chapter = materials.blocks.story.find(item => sameItem(item, candidate.item));
    if (chapter) {
      const present = new Set(descendants(document.blocks.filter(b => b.kind === "story").flatMap(b => b.items)).flatMap(itemKeys));
      for (const scene of sortAlbumItemsByDate(chapter.children ?? [])) {
        if (!itemKeys(scene).some(key => present.has(key))) result.story.push({ blockKind: "story", item: AlbumItemSchema.parse(scene), chapter: { item: { ...candidate.item, children: [] }, placeAfterItemId: candidate.placeAfterItemId } });
      }
    } else {
      const sourceChapter = materials.blocks.story.find(ch => ch.children?.some(scene => sameItem(scene, candidate.item)));
      const currentChapter = sourceChapter && document.blocks.filter(b => b.kind === "story").flatMap(b => b.items).find(item => sameItem(item, sourceChapter));
      if (sourceChapter && currentChapter) result.story.push({ ...candidate, chapter: { item: { ...currentChapter, children: [] } } });
    }
  }
  return result;
}

export function applyAlbumUpdate(document: AlbumDocument, selection: { add: string[]; replace: string[]; remove?: string[]; quotePicks?: Record<string, string[]> }, candidates: AlbumUpdateCandidates): AlbumDocument {
  const next = structuredClone(document);
  if (!candidates.available) return next;
  const replacements = new Set(selection.replace), additions = new Set(selection.add);
  const inserted = new Set<string>();
  for (const candidate of candidates.changed) {
    if (!replacements.has(candidate.itemId) || candidate.userEdited) continue;
    for (const block of next.blocks.filter(block => block.kind === candidate.blockKind)) {
      const current = locate(block.items, candidate.itemId)?.item;
      // Recheck live edits: a user can edit after the server calculated this candidate.
      if (!current || Object.keys(current.edited).length || albumFieldsFingerprint(current.fields) !== albumFieldsFingerprint(candidate.before)) continue;
      current.fields = { ...candidate.after };
      if (current.origin) current.origin.fingerprint = albumFieldsFingerprint(current.fields);
    }
  }
  for (const candidate of candidates.added) {
    if (!additions.has(candidate.item.id)) continue;
    if (candidate.chapter) {
      const chapter = candidate.chapter;
      const present = next.blocks.filter(b => b.kind === candidate.blockKind).flatMap(b => b.items).find(item => sameItem(item, chapter.item));
      if (!present) {
        const withChapter = applyAlbumUpdate(next, { add: [chapter.item.id], replace: [] }, { available: true, added: [{ blockKind: candidate.blockKind, ...chapter }], changed: [], removed: [] });
        next.blocks = withChapter.blocks;
      }
    }
    const blocks = next.blocks.filter(block => block.kind === candidate.blockKind);
    if (!blocks.length) continue;
    const existing = descendants(blocks.flatMap(block => block.items));
    const presentKeys = new Set(existing.flatMap(itemKeys));
    const copyNew = (source: AlbumItem): AlbumItem | undefined => {
      const keys = itemKeys(source);
      if (keys.some(key => presentKeys.has(key))) return;
      const copy = AlbumItemSchema.parse(source);
      keys.forEach(key => presentKeys.add(key));
      if (copy.children) copy.children = copy.children.filter(child => selection.quotePicks?.[source.id] === undefined || selection.quotePicks[source.id]!.includes(child.id)).flatMap(child => { const copied = copyNew(child); return copied ? [copied] : []; });
      return copy;
    };
    const added = copyNew(candidate.item);
    if (!added) continue;
    const anchorId = candidate.placeAfterItemId ?? candidate.chapter?.item.id;
    const anchor = anchorId ? blocks.map(block => locate(block.items, anchorId)).find(Boolean) : undefined;
    // Server anchors the first child after its parent heading; other anchors are same-kind siblings.
    // Origin kinds here are our typed material structure, not prose classification.
    const childAnchor = anchor && (candidate.chapter?.item.id === anchor.item.id || added.origin && anchor.item.origin && added.origin.kind !== anchor.item.origin.kind);
    if (anchorId && !anchor) continue; // A deleted/moved anchor requires fresh candidates.
    const target = childAnchor ? (anchor.item.children ??= []) : anchor?.siblings ?? blocks[0]!.items;
    let position = childAnchor ? 0 : anchor ? anchor.index + 1 : target.length;
    while (target[position] && inserted.has(target[position]!.id)) position++;
    if (added.fields.date) {
      const later = target.findIndex(item => (compareStoryTimes(item.fields.date, added.fields.date) ?? 0) > 0);
      if (later >= 0) position = later;
      else {
        for (let index = 0; index < target.length; index++) {
          const compared = compareStoryTimes(target[index]!.fields.date, added.fields.date);
          if (compared !== null && compared <= 0) position = Math.max(position, index + 1);
        }
      }
    }
    target.splice(position, 0, added);
    inserted.add(added.id);
  }
  // Only an explicit editor choice removes stored content; source disappearance stays advisory.
  const removed = new Set(selection.remove ?? []);
  const removeSelected = (items: AlbumItem[]): AlbumItem[] => items.filter(item => !removed.has(item.id)).map(item => item.children ? { ...item, children: removeSelected(item.children) } : item);
  for (const block of next.blocks) if (block.kind === "story") block.items = removeSelected(block.items);
  // Removed origins are advisory only. Album text, photos and user ordering remain owned by the user.
  if (candidates.collectedAt !== undefined) next.lastUpdatedFromMaterialsAt = Math.max(document.lastUpdatedFromMaterialsAt ?? document.createdAt, candidates.collectedAt);
  return next;
}
