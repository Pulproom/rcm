import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { AlbumDocumentSchema, AlbumPairSchema } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { AlbumRevisionConflictError, createAlbum, deleteAlbum, duplicateAlbum, getAlbum, getAlbumVersion, listAlbums, listAlbumVersions, restoreAlbumVersion, saveAlbum } from "./albums.js";
import { ALBUM_THUMB_MAX_BYTES, AlbumPhotoValidationError, assertAlbumStorageId, listAlbumPhotos, saveAlbumPhoto, type AlbumPhotoStore } from "./album-photos.js";
import { collectAlbumMaterials, listAlbumChats } from "./album-materials.js";
import type { AlbumExportStore } from "./album-exports.js";
import { albumUpdateCandidates, albumUpdateSnapshot } from "./album-sync.js";
import { createAlbumTransfers } from "./album-transfer.js";
import { collectAlbumTogether } from "./album-together.js";

const timeZoneSchema = z.string().refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Invalid time zone");

const photoMeta = z.object({
  width: z.number().int().positive(), height: z.number().int().positive(), source: z.enum(["upload", "inlay"]),
  inlayId: z.string().uuid().optional(), caption: z.string().max(20_000).optional(),
});
const photoPatch = z.object({
  caption: z.string().max(20_000).nullable().optional(),
  publicUrl: z.url().refine(value => new URL(value).protocol === "https:", "Photo public URL must use https").nullable().optional(),
});
const notFound = (code: string): never => { throw Object.assign(new Error("Album or photo not found"), { code }); };

/** Register after the application's authentication and API revision middleware. */
export function registerAlbumRoutes(app: Hono, { db, photoStore, exportStore }: { db: RcmDatabase; photoStore: AlbumPhotoStore; exportStore: AlbumExportStore }): void {
  const routes = new Hono();
  const transfers = createAlbumTransfers();
  routes.get("/album-transfers/:id/:part", context => {
    const part = z.coerce.number().int().nonnegative().parse(context.req.param("part"));
    const json = transfers.read(context.req.param("id"), part);
    return json === undefined ? context.json({ code: "ALBUM_TRANSFER_EXPIRED", error: "Album transfer expired; reload the source" }, 410) : context.body(json, 200, { "Content-Type": "application/json" });
  });
  routes.delete("/album-transfers/:id", context => { transfers.close(context.req.param("id")); return context.json({ ok: true }); });
  const album = (id: string) => { assertAlbumStorageId(id); return getAlbum(db, id) ?? notFound("ALBUM_NOT_FOUND"); };
  const photo = (albumId: string, photoId: string) => {
    assertAlbumStorageId(albumId); assertAlbumStorageId(photoId);
    return listAlbumPhotos(db, albumId).find(entry => entry.id === photoId) ?? notFound("ALBUM_PHOTO_NOT_FOUND");
  };
  routes.onError((error, context) => {
    if (error instanceof AlbumRevisionConflictError) return context.json({ error: error.message, code: error.code, revision: error.revision }, 409);
    const code = (error as Error & { code?: string }).code ?? "ALBUM_INVALID_REQUEST";
    if (["ALBUM_NOT_FOUND", "ALBUM_PHOTO_NOT_FOUND", "ALBUM_SOURCE_NOT_FOUND", "ALBUM_VERSION_NOT_FOUND"].includes(code)) return context.json({ error: error.message, code }, 404);
    if (code === "ALBUM_DOCUMENT_TOO_LARGE" || code === "ALBUM_PHOTO_TOO_LARGE") return context.json({ error: error.message, code }, 413);
    if (error instanceof AlbumPhotoValidationError && error.code === "ALBUM_PHOTO_UNSUPPORTED") return context.json({ error: error.message, code }, 415);
    if (code === "SQLITE_CONSTRAINT_PRIMARYKEY") return context.json({ error: "Album already exists", code: "ALBUM_ALREADY_EXISTS" }, 409);
    return context.json({ error: error.message, code }, 400);
  });
  routes.get("/albums", context => context.json({ albums: listAlbums(db) }));
  routes.get("/album-chats", context => context.json({ items: listAlbumChats(db) }));
  routes.post("/albums", async context => {
    const { document } = z.object({ document: AlbumDocumentSchema }).parse(await context.req.json());
    return context.json(createAlbum(db, document), 201);
  });
  routes.get("/albums/:id", context => { const id = context.req.param("id"); return context.json({ ...album(id), photos: listAlbumPhotos(db, id) }); });
  routes.put("/albums/:id", async context => {
    const id = context.req.param("id"); album(id);
    const body = z.object({ document: AlbumDocumentSchema, expectedRevision: z.number().int().positive() }).parse(await context.req.json());
    return context.json(saveAlbum(db, id, body.document, body.expectedRevision));
  });
  routes.post("/albums/:id/exports", async context => {
    const current = album(context.req.param("id"));
    if (context.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "text/html" || !context.req.raw.body) return context.json({ error: "HTML file required", code: "ALBUM_EXPORT_INVALID" }, 400);
    const result = await exportStore.save(current.document.title, context.req.raw.body);
    return context.json(result, 201);
  });
  routes.get("/albums/:id/versions", context => {
    const id = context.req.param("id"); album(id);
    return context.json({ versions: listAlbumVersions(db, id) });
  });
  routes.get("/albums/:id/versions/:revision", context => {
    const id = context.req.param("id"); album(id);
    const revision = z.coerce.number().int().positive().parse(context.req.param("revision"));
    return context.json(getAlbumVersion(db, id, revision) ?? notFound("ALBUM_VERSION_NOT_FOUND"));
  });
  routes.post("/albums/:id/versions/:revision/restore", async context => {
    const id = context.req.param("id"); album(id);
    const revision = z.coerce.number().int().positive().parse(context.req.param("revision"));
    const { expectedRevision } = z.object({ expectedRevision: z.number().int().positive() }).parse(await context.req.json());
    return context.json(restoreAlbumVersion(db, id, revision, expectedRevision) ?? notFound("ALBUM_VERSION_NOT_FOUND"));
  });
  routes.post("/albums/:id/duplicate", context => {
    const id = context.req.param("id"); album(id);
    return context.json(duplicateAlbum(db, photoStore, id), 201);
  });
  routes.delete("/albums/:id", context => {
    const id = context.req.param("id"); album(id); deleteAlbum(db, photoStore, id);
    return context.json({ ok: true });
  });
  routes.get("/chats/:id/album-materials", context => {
    const me = context.req.query("me"), partner = context.req.query("partner");
    const pair = me === undefined && partner === undefined ? undefined : AlbumPairSchema.parse({ me, partner });
    const timeZone = timeZoneSchema.optional().parse(context.req.query("tz"));
    const materials = collectAlbumMaterials(db, context.req.param("id"), { preferTranslation: true, pair, timeZone });
    return context.req.query("paged") === "1" ? context.body(transfers.open(materials), 200, { "Content-Type": "application/json" }) : context.json(materials);
  });
  routes.get("/chats/:id/album-together", context => {
    const timeZone = timeZoneSchema.parse(context.req.query("tz"));
    const chatId = context.req.param("id");
    if (!db.prepare("SELECT 1 FROM chats WHERE id=?").get(chatId)) notFound("ALBUM_SOURCE_NOT_FOUND");
    return context.json(collectAlbumTogether(db, chatId, { timeZone }));
  });
  routes.get("/albums/:id/update-materials", context => {
    const timeZone = timeZoneSchema.optional().parse(context.req.query("tz"));
    return context.body(transfers.open(albumUpdateSnapshot(db, album(context.req.param("id")).document, { timeZone })), 200, { "Content-Type": "application/json" });
  });
  routes.get("/albums/:id/update-candidates", context => context.json(albumUpdateCandidates(db, album(context.req.param("id")).document)));
  routes.get("/albums/:id/photos", context => {
    const id = context.req.param("id"); assertAlbumStorageId(id);
    if (!db.prepare("SELECT 1 FROM albums WHERE id=?").get(id)) notFound("ALBUM_NOT_FOUND");
    return context.json({ photos: listAlbumPhotos(db, id) });
  });
  routes.post("/albums/:id/photos", bodyLimit({ maxSize: 8 * 1024 * 1024 + 1024,
    onError: context => context.json({ error: "Photo exceeds 8 MB", code: "ALBUM_PHOTO_TOO_LARGE" }, 413),
  }), async context => {
    const id = context.req.param("id"); album(id);
    const meta = photoMeta.parse(JSON.parse(context.req.header("X-RCM-Photo-Meta") ?? "{}"));
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const mime = (context.req.header("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
    return context.json({ photo: saveAlbumPhoto(db, photoStore, id, bytes, { ...meta, mime }) }, 201);
  });
  routes.patch("/albums/:id/photos/:photoId", async context => {
    const id = context.req.param("id"), photoId = context.req.param("photoId"); photo(id, photoId);
    const patch = photoPatch.parse(await context.req.json());
    db.transaction(() => {
      if (patch.caption !== undefined) db.prepare("UPDATE album_photos SET caption=? WHERE album_id=? AND id=?").run(patch.caption, id, photoId);
      if (patch.publicUrl !== undefined) db.prepare("UPDATE album_photos SET public_url=? WHERE album_id=? AND id=?").run(patch.publicUrl, id, photoId);
    })();
    return context.json({ photo: photo(id, photoId) });
  });
  routes.put("/albums/:id/photos/:photoId/thumb", bodyLimit({ maxSize: ALBUM_THUMB_MAX_BYTES,
    onError: context => context.json({ error: "Thumbnail exceeds 512 KiB", code: "ALBUM_PHOTO_TOO_LARGE" }, 413),
  }), async context => {
    const stored = photo(context.req.param("id"), context.req.param("photoId"));
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    const mime = (context.req.header("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
    photoStore.saveThumbnail(stored.albumId, stored.id, bytes, mime);
    return context.json({ ok: true });
  });
  routes.delete("/albums/:id/photos/:photoId", context => {
    const stored = photo(context.req.param("id"), context.req.param("photoId"));
    db.prepare("DELETE FROM album_photos WHERE album_id=? AND id=?").run(stored.albumId, stored.id);
    photoStore.remove(stored.albumId, stored.id, stored.ext);
    return context.json({ ok: true });
  });
  routes.get("/albums/:id/photos/:photoId", context => {
    const size = z.enum(["thumb", "full"]).parse(context.req.query("size") ?? "full");
    const stored = photo(context.req.param("id"), context.req.param("photoId"));
    const thumbnail = size === "thumb" ? photoStore.readThumbnail(stored.albumId, stored.id) : undefined;
    return context.body(new Uint8Array(thumbnail?.bytes ?? photoStore.read(stored.albumId, stored.id, stored.ext)), 200, {
      "Content-Type": thumbnail?.mime ?? stored.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    });
  });
  app.route("/v1", routes);
}
