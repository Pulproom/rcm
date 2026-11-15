import { type AlbumBlock, type AlbumDocument, type AlbumItem } from "./album.js";
import type { AlbumMaterials } from "./album-draft.js";

/** Gallery frames are uniform; legacy size/auto values use the current gallery defaults. */
export function albumGalleryLayout(block: Pick<AlbumBlock, "photoColumns" | "photoShape">): { columns: 2 | 3 | 4; shape: "landscape" | "portrait" | "square" } {
  return { columns: block.photoColumns === 2 || block.photoColumns === 4 ? block.photoColumns : 3,
    shape: block.photoShape === "landscape" || block.photoShape === "portrait" ? block.photoShape : "square" };
}

export const albumPhotoItems = (items: AlbumItem[]): AlbumItem[] => items.flatMap(i => [i, ...albumPhotoItems(i.children ?? [])]);
export const albumScenes = (doc: AlbumDocument): AlbumItem[] => doc.blocks.filter(b => b.kind === "story").flatMap(b => b.items.flatMap(i => i.children?.some(s => s.fields.title !== undefined || s.fields.summary !== undefined) ? i.children : [i]));
export interface AlbumPhotoPlacement { photoId: string; caption?: string; width?: number; height?: number; sceneId?: string; blockId?: string; inlayId?: string }
/** Storage without a document reference is the tray. Hidden and gallery placements still own files. */
export function unplacedAlbumPhotos<T extends { id: string }>(doc: AlbumDocument, stored: readonly T[]): T[] {
  const used = new Set([doc.coverPhotoId, doc.people.me.photoId, doc.people.partner.photoId,
    ...doc.blocks.flatMap(b => albumPhotoItems(b.items).flatMap(i => i.photos.map(p => p.photoId))),
    ...(doc.coverLine?.photos.map(p => p.photoId) ?? [])]);
  return stored.filter(p => !used.has(p.id));
}
/** A move changes references, never image storage. Explicit empty sceneId means unplaced. */
export function placeAlbumPhotos(doc: AlbumDocument, photos: AlbumPhotoPlacement[], materials?: AlbumMaterials): AlbumDocument {
  const next = structuredClone(doc), scenes = next.blocks.filter(b => b.kind === "story").flatMap(b => albumPhotoItems(b.items));
  const sourceScenes = materials?.blocks.story.flatMap(c => c.children ?? []) ?? [];
  for (const p of photos) {
    const source = p.inlayId ? sourceScenes.find(s => s.inlayIds?.includes(p.inlayId!)) : undefined;
    const target = p.sceneId !== undefined ? scenes.find(s => s.id === p.sceneId) : source ? scenes.find(s => s.id === source.id || Boolean(s.origin && source.origin && s.origin.kind === source.origin.kind && s.origin.sourceId === source.origin.sourceId)) : undefined;
    // Other block roles (cover/portraits/single photo) are independent references.
    for (const s of scenes) s.photos = s.photos.filter(ref => ref.photoId !== p.photoId);
    for (const b of next.blocks.filter(b => b.kind === "gallery")) for (const i of b.items) i.photos = i.photos.filter(ref => ref.photoId !== p.photoId);
    const ref = { photoId: p.photoId, width: p.width, height: p.height, ...(p.caption !== undefined ? { caption: p.caption } : {}) };
    if (target) target.photos.push(ref);
    else if (p.blockId) {
      const block = next.blocks.find(b => b.id === p.blockId && (b.kind === "gallery" || b.kind === "photo"));
      if (block) block.items.push({ id: `photo:${p.photoId}`, fields: {}, edited: {}, photos: [ref] });
    }
  }
  return next;
}
