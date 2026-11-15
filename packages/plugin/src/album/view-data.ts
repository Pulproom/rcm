import { type AlbumDocument, type AlbumItem } from "@rcm/shared";
import { renderAlbum, type AlbumSection } from "./render.js";
import { albumThemeVoice } from "./themes/index.js";

export const buildAlbumJumpList = (doc: AlbumDocument, photoSrc: (id: string) => string = () => ""): AlbumSection[] =>
  renderAlbum(doc, { mode: "view", photoSrc }).sections;
export interface AlbumViewPhoto { photoId: string; caption: string; section: string; title: string }
/** Document order, including chapter art, excluding portraits and hidden descendants. */
export function buildAlbumPhotoList(doc: AlbumDocument): AlbumViewPhoto[] {
  const photos: AlbumViewPhoto[] = [];
  const seen = new Set<string>();
  const portraits = new Set([doc.people.me.photoId, doc.people.partner.photoId].filter(Boolean));
  for (const block of doc.blocks) {
    if (block.hidden || block.kind === "intro") continue;
    const section = block.title || albumThemeVoice(doc.style.theme).blocks[block.kind].title || doc.title;
    const visit = (items: AlbumItem[]) => items.forEach(item => {
      if (item.hidden) return;
      for (const photo of item.photos.filter(p => !portraits.has(p.photoId) && !seen.has(p.photoId))) { seen.add(photo.photoId); photos.push({ photoId: photo.photoId, caption: photo.caption ?? item.fields.caption ?? "", section, title: item.fields.title ?? "" }); }
      visit(item.children ?? []);
    });
    if (block.kind === "cover" && doc.coverPhotoId && !portraits.has(doc.coverPhotoId) && !seen.has(doc.coverPhotoId)) { seen.add(doc.coverPhotoId); photos.push({ photoId: doc.coverPhotoId, caption: "", section, title: doc.title }); }
    visit(block.items);
  }
  return photos;
}
export function albumPhotoCaption(photo: AlbumViewPhoto, albumTitle: string): string[] {
  const context = [...new Set([photo.section === albumTitle ? "" : photo.section, photo.title].filter(Boolean))].join(" · ") || albumTitle;
  return [...new Set([photo.caption.trim(), context].filter(Boolean))];
}
export const cycleAlbumPhoto = (index: number, delta: number, count: number): number => count ? ((index + delta) % count + count) % count : 0;
