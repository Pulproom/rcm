import type { AlbumPhotoFit, AlbumPhotoShape } from "./album.js";

export interface AlbumImageSize { width?: number; height?: number }
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export const albumImageRatio = (size: AlbumImageSize): number => size.width && size.height ? size.width / size.height : 1;
export const albumPhotoRatio = (shape: AlbumPhotoShape, sourceRatio = 1): number => ({ landscape: 1.5, portrait: 2 / 3, square: 1, original: sourceRatio })[shape];
export const albumDefaultFit = (shape: AlbumPhotoShape): AlbumPhotoFit => ({ shape, x: 50, y: 50, zoom: 1 });

/** A block default is explicit; otherwise a multi-photo slot follows its source orientations. */
export function albumPhotoGroupLayout(photos: readonly (AlbumImageSize & { fit?: AlbumPhotoFit })[], shape?: AlbumPhotoShape): { shape: AlbumPhotoShape; justified: boolean; ratios: number[] } {
  const natural = photos.map(albumImageRatio);
  shape ??= photos.length < 2 ? "original" : natural.every(r => r < 1) ? "portrait" : natural.every(r => r > 1) ? "landscape" : "original";
  const shapes = photos.map(p => p.fit?.shape ?? shape);
  return { shape, justified: photos.length > 1 && (shapes.includes("original") || new Set(shapes).size > 1), ratios: shapes.map((s, i) => albumPhotoRatio(s, natural[i])) };
}

/** The covered image scales around its focus; total overflow is the only legal pan range. */
export function panAlbumPhotoFit(fit: AlbumPhotoFit, dx: number, dy: number, width: number, height: number, sourceRatio: number): AlbumPhotoFit {
  const xOverflow = Math.max(width, height * sourceRatio) * fit.zoom - width;
  const yOverflow = Math.max(height, width / sourceRatio) * fit.zoom - height;
  return { ...fit, x: xOverflow > .01 ? clamp(fit.x - dx / xOverflow * 100, 0, 100) : fit.x, y: yOverflow > .01 ? clamp(fit.y - dy / yOverflow * 100, 0, 100) : fit.y };
}
export const zoomAlbumPhotoFit = (fit: AlbumPhotoFit, zoom: number): AlbumPhotoFit => ({ ...fit, zoom: clamp(zoom, 1, 3) });

/** Ordinary cover/contain geometry, also projected into the board's allowed image viewport. */
export function albumFitCrop(fit: AlbumPhotoFit, sourceRatio: number): { x: number; y: number; w: number; h: number; ratio: number } {
  const ratio = albumPhotoRatio(fit.shape, sourceRatio), w = Math.min(1, ratio / sourceRatio) / fit.zoom, h = Math.min(1, sourceRatio / ratio) / fit.zoom;
  return { x: (1 - w) * fit.x / 100, y: (1 - h) * fit.y / 100, w, h, ratio };
}
