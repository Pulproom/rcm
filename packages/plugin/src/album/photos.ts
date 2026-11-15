import { albumPhotoItems, type AlbumDocument, type AlbumMaterials } from "@rcm/shared";
import type { albumClient, AlbumPhoto } from "./api.js";
export type InlayHost = Pick<RisuPluginApi, "readInlay">;
type UploadApi = Pick<ReturnType<typeof albumClient>, "uploadPhoto">;
export const PHOTO_OPEN_ERROR = "이 사진은 열 수 없어요. 다른 사진을 골라 주세요.";
const PHOTO_SIZE_ERROR = "사진은 8MB 이하로 골라 주세요.";
export function albumPhotoError(error: unknown): string {
  const failure = error as { status?: number; code?: string; message?: string } | undefined;
  return failure?.status === 413 || failure?.code === "ALBUM_PHOTO_TOO_LARGE" || failure?.message === PHOTO_SIZE_ERROR ? PHOTO_SIZE_ERROR : PHOTO_OPEN_ERROR;
}
function photoMime(bytes: Uint8Array): string {
  const head = String.fromCharCode(...bytes.slice(0, 12));
  if ([137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(head)) return "image/gif";
  return head.startsWith("RIFF") && head.slice(8) === "WEBP" ? "image/webp" : "";
}
export async function downscaleImage(blob: Blob, maxEdge = 2400): Promise<{ bytes: Uint8Array; mime: string; width: number; height: number }> {
  const input = new Uint8Array(await blob.arrayBuffer()), mime = photoMime(input);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(mime ? new Blob([input], { type: mime }) : blob); }
  catch { throw new Error(PHOTO_OPEN_ERROR); }
  try {
    const scale = mime === "image/gif" ? 1 : Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    let result = new Blob([input], { type: mime });
    if (scale < 1 || !mime) {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
      result = await canvas.convertToBlob({ type: "image/webp", quality: .88 });
    }
    if (result.size > 8 * 1024 * 1024) throw new Error(PHOTO_SIZE_ERROR);
    return { bytes: new Uint8Array(await result.arrayBuffer()), mime: result.type, width, height };
  } finally { bitmap.close(); }
}
export function inlayBlob(data: string): Blob {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(data);
  if (!match) throw new Error("사진 형식을 읽을 수 없어요.");
  return new Blob([Uint8Array.from(atob(match[2]!), c => c.charCodeAt(0))], { type: match[1]!.toLowerCase() });
}
export async function importInlay(albumId: string, inlayId: string, host: InlayHost, api: UploadApi): Promise<AlbumPhoto | null> {
  const inlay = await host.readInlay?.(inlayId);
  if (!inlay || inlay.type !== "image") return null;
  const { bytes, ...meta } = await downscaleImage(inlayBlob(inlay.data));
  return (await api.uploadPhoto(albumId, bytes, { ...meta, source: "inlay", inlayId, caption: inlay.name })).photo;
}
/** Shared by visible thumbnails and imports: one read per UUID, four in flight at most. */
export function createInlayReader(host: InlayHost) {
  type Asset = Awaited<ReturnType<NonNullable<InlayHost["readInlay"]>>>;
  const cache = new Map<string, Promise<Asset>>(), queue: (() => void)[] = [];
  let running = 0, closed = false;
  const drain = () => { while (running < 4 && queue.length) queue.shift()!(); };
  return {
    read(id: string): Promise<Asset> {
      if (closed) return Promise.resolve(null);
      const old = cache.get(id); if (old) return old;
      const promise = new Promise<Asset>((resolve, reject) => {
        queue.push(() => {
          if (closed) { resolve(null); return; }
          running++;
          Promise.resolve().then(() => host.readInlay?.(id) ?? null).then(resolve, error => { cache.delete(id); reject(error); }).finally(() => { running--; drain(); });
        }); drain();
      });
      cache.set(id, promise); return promise;
    },
    close() { closed = true; cache.clear(); drain(); },
  };
}
/** A new album must exist before its photo files can be stored. Never save raw inlay IDs. */
export async function importDraftInlays(draft: AlbumDocument, host: InlayHost, api: UploadApi, materials: AlbumMaterials): Promise<AlbumDocument> {
  const reader = createInlayReader(host), imported = new Map<string, Promise<AlbumPhoto | null>>();
  try {
    const next = structuredClone(draft);
    const inlays = new Set(Object.values(materials.blocks).flatMap(items => albumPhotoItems(items).flatMap(i => (i as typeof materials.blocks.story[number]).inlayIds ?? [])));
    await Promise.all(next.blocks.flatMap(b => albumPhotoItems(b.items)).map(async item => {
      item.photos = (await Promise.all(item.photos.map(async ref => {
        if (!inlays.has(ref.photoId)) return ref;
        let pending = imported.get(ref.photoId);
        if (!pending) { pending = importInlay(draft.id, ref.photoId, { readInlay: id => reader.read(id) }, api); imported.set(ref.photoId, pending); }
        const photo = await pending; return photo ? { ...ref, photoId: photo.id, width: photo.width, height: photo.height } : null;
      }))).filter(p => p !== null);
    }));
    return next;
  } finally { reader.close(); }
}
