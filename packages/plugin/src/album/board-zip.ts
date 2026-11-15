import { zipSync } from 'fflate';
import type { AlbumDocument } from '@rcm/shared';
import type { AlbumPhoto } from './api.js';
import { boardPhotoParts, buildBoardPhotoList } from './board-render.js';

const safe = (value: string) => value.replace(/[<>:"/\\|?*\u0000-\u001f\u007f\s]/g,'').replace(/\.+$/g,'').slice(0,70);
export async function buildPhotoZip(doc: AlbumDocument, photos: AlbumPhoto[], readPhoto: (id: string) => Promise<Blob>): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const [index, slot] of buildBoardPhotoList(doc, photos).entries()) {
    const meta = photos.find(p=>p.id === slot.photoId);
    if (!meta || !/^(?:jpe?g|png|webp|gif)$/i.test(meta.ext)) throw new Error('사진 형식을 확인할 수 없어요.');
    const name = `${String(index+1).padStart(2,'0')}-${boardPhotoParts(doc, slot).map(safe).filter(Boolean).join('-') || '사진'}.${meta.ext.toLowerCase()}`;
    files[name] = new Uint8Array(await (await readPhoto(slot.photoId)).arrayBuffer());
  }
  return zipSync(files, { level: 0 });
}
