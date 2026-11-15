import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, join, resolve } from "node:path";
import type { RcmDatabase } from "./db.js";

export interface AlbumPhotoMeta {
  mime: string;
  width: number;
  height: number;
  source: "upload" | "inlay";
  inlayId?: string;
  publicUrl?: string;
  caption?: string;
}
export interface AlbumPhoto extends AlbumPhotoMeta {
  id: string;
  albumId: string;
  ext: string;
  bytes: number;
  createdAt: number;
}
export const ALBUM_IMAGE_EXTENSIONS = ["jpg", "png", "webp", "gif"] as const;
export const ALBUM_THUMB_MAX_BYTES = 512 * 1024;
export interface AlbumThumbnail { mime: string; ext: string; bytes: Uint8Array }
export interface AlbumPhotoRestoreEntry { photo: AlbumPhoto; bytes: Uint8Array; thumbnail?: AlbumThumbnail }
export class AlbumPhotoValidationError extends Error {
  constructor(message: string, readonly code: "ALBUM_PHOTO_TOO_LARGE" | "ALBUM_PHOTO_UNSUPPORTED" | "ALBUM_PHOTO_INVALID") {
    super(message);
    this.name = "AlbumPhotoValidationError";
  }
}

// IDs and extensions are owned storage syntax, never RP text interpretation.
export function assertAlbumStorageId(id: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id)) throw new Error("Invalid album storage ID");
}
function imageFormat(bytes: Uint8Array): { mime: string; ext: string } {
  const starts = (...header: number[]) => header.every((byte, i) => bytes[i] === byte);
  if (starts(137,80,78,71,13,10,26,10)) return { mime: "image/png", ext: "png" };
  if (starts(255,216,255)) return { mime: "image/jpeg", ext: "jpg" };
  const header = Buffer.from(bytes.subarray(0, 12)).toString("latin1");
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return { mime: "image/gif", ext: "gif" };
  if (header.startsWith("RIFF") && header.slice(8) === "WEBP") return { mime: "image/webp", ext: "webp" };
  throw new AlbumPhotoValidationError("Unsupported image bytes", "ALBUM_PHOTO_UNSUPPORTED");
}

function validateImageMime(bytes: Uint8Array, mime?: string): { mime: string; ext: string } {
  const format = imageFormat(bytes);
  if (mime !== undefined && format.mime !== mime) throw new AlbumPhotoValidationError("Declared mime does not match image bytes", "ALBUM_PHOTO_UNSUPPORTED");
  return format;
}

export function validateAlbumThumbnail(bytes: Uint8Array, mime?: string): { mime: string; ext: string } {
  if (bytes.byteLength > ALBUM_THUMB_MAX_BYTES) throw new AlbumPhotoValidationError("Thumbnail exceeds 512 KiB", "ALBUM_PHOTO_TOO_LARGE");
  return validateImageMime(bytes, mime);
}

export function validateAlbumPhoto(bytes: Uint8Array, meta: AlbumPhotoMeta): { mime: string; ext: string } {
  if (bytes.byteLength > 8 * 1024 * 1024) throw new AlbumPhotoValidationError("Photo exceeds 8 MB", "ALBUM_PHOTO_TOO_LARGE");
  const format = validateImageMime(bytes, meta.mime);
  if (![meta.width, meta.height].every(value => Number.isSafeInteger(value) && value > 0) || !["upload", "inlay"].includes(meta.source)) {
    throw new AlbumPhotoValidationError("Invalid photo dimensions or source", "ALBUM_PHOTO_INVALID");
  }
  if (meta.publicUrl && new URL(meta.publicUrl).protocol !== "https:") throw new AlbumPhotoValidationError("Photo public URL must use https", "ALBUM_PHOTO_INVALID");
  return format;
}

export function createAlbumPhotoStore(rootDir: string) {
  const root = resolve(rootDir);
  const checkDirectory = (path: string) => {
    if (fs.existsSync(path) && (!fs.lstatSync(path).isDirectory() || fs.lstatSync(path).isSymbolicLink())) throw new Error("Album storage directory must not be a link or file");
  };
  const albumPath = (albumId: string) => {
    assertAlbumStorageId(albumId);
    checkDirectory(root);
    const path = join(root, albumId);
    checkDirectory(path);
    return path;
  };
  const photoPath = (albumId: string, photoId: string, ext: string, thumbnail = false) => {
    assertAlbumStorageId(photoId);
    if (!(ALBUM_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) throw new Error("Invalid album photo extension");
    return join(albumPath(albumId), `${photoId}${thumbnail ? ".thumb" : ""}.${ext}`);
  };
  const readFile = (path: string): Buffer => {
    if (!fs.lstatSync(path).isFile() || fs.lstatSync(path).isSymbolicLink()) throw new Error("Album photo must be a regular file");
    return fs.readFileSync(path);
  };
  const read = (albumId: string, photoId: string, ext: string): Buffer => readFile(photoPath(albumId, photoId, ext));
  const writeFile = (path: string, bytes: Uint8Array): void => {
    const temporary = `${path}.tmp`;
    try {
      fs.writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, path);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  };
  const readThumbnail = (albumId: string, photoId: string): AlbumThumbnail | undefined => {
    for (const ext of ALBUM_IMAGE_EXTENSIONS) {
      const path = photoPath(albumId, photoId, ext, true);
      if (!fs.existsSync(path)) continue;
      const bytes = readFile(path), format = validateAlbumThumbnail(bytes);
      if (format.ext !== ext) throw new Error("Invalid album thumbnail extension");
      return { ...format, bytes };
    }
    return undefined;
  };
  const saveThumbnail = (albumId: string, photoId: string, bytes: Uint8Array, mime: string): void => {
    const format = validateAlbumThumbnail(bytes, mime);
    writeFile(photoPath(albumId, photoId, format.ext, true), bytes);
    for (const ext of ALBUM_IMAGE_EXTENSIONS) if (ext !== format.ext) fs.rmSync(photoPath(albumId, photoId, ext, true), { force: true });
  };
  const save = (albumId: string, bytes: Uint8Array, meta: AlbumPhotoMeta): AlbumPhoto => {
    const format = validateAlbumPhoto(bytes, meta);
    const photo: AlbumPhoto = { ...meta, ...format, id: randomUUID(), albumId, bytes: bytes.byteLength, createdAt: Date.now() };
    const path = photoPath(albumId, photo.id, photo.ext);
    fs.mkdirSync(albumPath(albumId), { recursive: true });
    writeFile(path, bytes);
    return photo;
  };
  const remove = (albumId: string, photoId: string, ext: string): void => {
    fs.rmSync(photoPath(albumId, photoId, ext), { force: true });
    for (const thumbnailExt of ALBUM_IMAGE_EXTENSIONS) fs.rmSync(photoPath(albumId, photoId, thumbnailExt, true), { force: true });
  };
  const removeAlbum = (albumId: string): void => {
    fs.rmSync(albumPath(albumId), { recursive: true, force: true });
  };
  const copyAlbum = (sourceAlbumId: string, targetAlbumId: string, photos: AlbumPhoto[]): AlbumPhoto[] => {
    albumPath(sourceAlbumId);
    if (fs.existsSync(albumPath(targetAlbumId))) throw new Error("Album photo destination already exists");
    try {
      return photos.map(photo => {
        if (photo.albumId !== sourceAlbumId) throw new Error("Photo does not belong to source album");
        const copied = save(targetAlbumId, read(sourceAlbumId, photo.id, photo.ext), {
          mime: photo.mime, width: photo.width, height: photo.height, source: photo.source,
          ...(photo.inlayId !== undefined ? { inlayId: photo.inlayId } : {}),
          ...(photo.publicUrl !== undefined ? { publicUrl: photo.publicUrl } : {}),
          ...(photo.caption !== undefined ? { caption: photo.caption } : {}),
        });
        const thumbnail = readThumbnail(sourceAlbumId, photo.id);
        if (thumbnail) saveThumbnail(targetAlbumId, copied.id, thumbnail.bytes, thumbnail.mime);
        return copied;
      });
    } catch (error) { removeAlbum(targetAlbumId); throw error; }
  };
  const restorePrevious = (staging: string, ids: string[], previousIds: string[]) => {
    for (const id of [...ids].reverse()) {
      const target = albumPath(id), previous = join(staging, "previous", id);
      checkDirectory(previous);
      if (fs.existsSync(previous)) {
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(previous, target);
      } else if (!previousIds.includes(id)) fs.rmSync(target, { recursive: true, force: true });
    }
  };
  const sweepOrphans = (db: RcmDatabase): void => {
    checkDirectory(root);
    if (!fs.existsSync(root)) return;
    // An interrupted SQLite transaction rolls back, while directory renames do not.
    // Recover those renames before the ordinary orphan sweep can remove old photos.
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!/^\.restore-[a-zA-Z0-9]+$/.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const staging = join(root, entry.name), key = `album_restore:${entry.name}`, journal = join(staging, "journal.json");
      if (!db.prepare("SELECT 1 FROM server_meta WHERE key=?").get(key) && fs.existsSync(journal)) {
        if (!fs.lstatSync(journal).isFile() || fs.lstatSync(journal).isSymbolicLink()) throw new Error("Invalid album restore journal");
        const state = JSON.parse(fs.readFileSync(journal, "utf8")) as { ids: string[]; previousIds: string[] };
        if (!Array.isArray(state.ids) || !Array.isArray(state.previousIds)) throw new Error("Invalid album restore journal");
        for (const id of [...state.ids, ...state.previousIds]) { if (typeof id !== "string") throw new Error("Invalid album restore ID"); assertAlbumStorageId(id); }
        checkDirectory(join(staging, "previous"));
        restorePrevious(staging, state.ids, state.previousIds);
      }
      fs.rmSync(staging, { recursive: true, force: true });
      db.prepare("DELETE FROM server_meta WHERE key=?").run(key);
    }
    const albums = new Set((db.prepare("SELECT id FROM albums").all() as Array<{ id: string }>).map(row => row.id));
    const files = new Set((db.prepare("SELECT album_id, id, ext FROM album_photos").all() as Array<{ album_id: string; id: string; ext: string }>).flatMap(row => [
      `${row.album_id}/${row.id}.${row.ext}`, ...ALBUM_IMAGE_EXTENSIONS.map(ext => `${row.album_id}/${row.id}.thumb.${ext}`),
    ]));
    // Scan only this dedicated root. Dirents are not followed through symlinks/junctions.
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink() || !albums.has(entry.name)) {
        fs.rmSync(path, { recursive: true, force: true });
        continue;
      }
      for (const file of fs.readdirSync(path, { withFileTypes: true })) {
        if (!file.isFile() || file.isSymbolicLink() || file.name.endsWith(".tmp") || !files.has(`${entry.name}/${file.name}`)) {
          fs.rmSync(join(path, file.name), { recursive: true, force: true });
        }
      }
    }
    for (const { key } of db.prepare("SELECT key FROM server_meta WHERE key LIKE 'album_restore:%'").all() as Array<{ key: string }>) {
      const name = key.slice("album_restore:".length);
      if (/^\.restore-[a-zA-Z0-9]+$/.test(name) && !fs.existsSync(join(root, name))) db.prepare("DELETE FROM server_meta WHERE key=?").run(key);
    }
  };
  /** Stage every file before touching live folders. Call install inside the DB transaction,
   * rollback on failure, and finish only after the transaction commits. */
  const stageRestore = (entries: AlbumPhotoRestoreEntry[], albumIds: string[]) => {
    const ids = [...new Set(albumIds)];
    for (const id of ids) albumPath(id);
    for (const { photo, bytes, thumbnail } of entries) {
      photoPath(photo.albumId, photo.id, photo.ext);
      if (!ids.includes(photo.albumId) || photo.bytes !== bytes.length || validateAlbumPhoto(bytes, photo).ext !== photo.ext) throw new Error("Invalid restored album photo");
      if (thumbnail && validateAlbumThumbnail(thumbnail.bytes, thumbnail.mime).ext !== thumbnail.ext) throw new Error("Invalid restored album thumbnail");
    }
    checkDirectory(root);
    fs.mkdirSync(root, { recursive: true });
    const staging = fs.mkdtempSync(join(root, ".restore-"));
    const prepared = join(staging, "next"), previous = join(staging, "previous");
    const previousIds = ids.filter(id => fs.existsSync(albumPath(id)));
    const key = `album_restore:${basename(staging)}`;
    const finish = (db?: RcmDatabase) => {
      fs.rmSync(staging, { recursive: true, force: true });
      db?.prepare("DELETE FROM server_meta WHERE key=?").run(key);
    };
    try {
      fs.mkdirSync(previous);
      for (const { photo, bytes, thumbnail } of entries) {
        const folder = join(prepared, photo.albumId);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(join(folder, `${photo.id}.${photo.ext}`), bytes, { flag: "wx", mode: 0o600 });
        if (thumbnail) fs.writeFileSync(join(folder, `${photo.id}.thumb.${thumbnail.ext}`), thumbnail.bytes, { flag: "wx", mode: 0o600 });
      }
      fs.writeFileSync(join(staging, "journal.tmp"), JSON.stringify({ ids, previousIds }), { flag: "wx", mode: 0o600 });
      fs.renameSync(join(staging, "journal.tmp"), join(staging, "journal.json"));
    } catch (error) { finish(); throw error; }
    return {
      install: (db: RcmDatabase) => {
        for (const id of ids) {
          const target = albumPath(id), next = join(prepared, id);
          if (fs.existsSync(target)) fs.renameSync(target, join(previous, id));
          if (fs.existsSync(next)) fs.renameSync(next, target);
        }
        // This marker commits with the restored rows. Absence means rollback on restart.
        db.prepare("INSERT INTO server_meta(key,value) VALUES(?, '1')").run(key);
      },
      rollback: () => {
        restorePrevious(staging, ids, previousIds);
        finish();
      },
      finish,
    };
  };
  return { save, read, saveThumbnail, readThumbnail, remove, removeAlbum, copyAlbum, sweepOrphans, stageRestore };
}
export type AlbumPhotoStore = ReturnType<typeof createAlbumPhotoStore>;

export function listAlbumPhotos(db: RcmDatabase, albumId: string): AlbumPhoto[] {
  const rows = db.prepare(`SELECT id, album_id AS albumId, mime, ext, width, height, bytes, source,
    inlay_id AS inlayId, public_url AS publicUrl, caption, created_at AS createdAt FROM album_photos WHERE album_id=? ORDER BY created_at,id`).all(albumId) as Array<Omit<AlbumPhoto, "inlayId" | "publicUrl" | "caption"> & { inlayId: string | null; publicUrl: string | null; caption: string | null }>;
  return rows.map(({ inlayId, publicUrl, caption, ...row }) => ({ ...row,
    ...(inlayId !== null ? { inlayId } : {}), ...(publicUrl !== null ? { publicUrl } : {}), ...(caption !== null ? { caption } : {}),
  }));
}

export function insertAlbumPhoto(db: RcmDatabase, photo: AlbumPhoto): void {
  db.prepare(`INSERT INTO album_photos(id,album_id,mime,ext,width,height,bytes,source,inlay_id,public_url,caption,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(photo.id, photo.albumId, photo.mime, photo.ext, photo.width, photo.height, photo.bytes, photo.source,
    photo.inlayId ?? null, photo.publicUrl ?? null, photo.caption ?? null, photo.createdAt);
}

/** DB ownership/deduplication belongs here; the file store itself needs no DB binding. */
export function saveAlbumPhoto(db: RcmDatabase, photoStore: AlbumPhotoStore, albumId: string, bytes: Uint8Array, meta: AlbumPhotoMeta): AlbumPhoto {
  return db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM albums WHERE id=?").get(albumId)) throw new Error("Album not found");
    if (meta.inlayId !== undefined) {
      const existing = listAlbumPhotos(db, albumId).find(photo => photo.inlayId === meta.inlayId);
      if (existing) return existing;
    }
    const photo = photoStore.save(albumId, bytes, meta);
    try { insertAlbumPhoto(db, photo); }
    catch (error) { photoStore.remove(albumId, photo.id, photo.ext); throw error; }
    return photo;
  }).immediate();
}
