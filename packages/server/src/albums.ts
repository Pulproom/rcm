import { randomUUID } from "node:crypto";
import { ALBUM_THEMES, albumPairPresent, resolveAlbumTint, AlbumDocumentSchema, type AlbumDocument, type AlbumItem, type AlbumSummary } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { albumShelfFields, type AlbumShelfFields } from "./album-summary.js";
import { assertAlbumStorageId, insertAlbumPhoto, listAlbumPhotos, type AlbumPhotoStore } from "./album-photos.js";

export type { AlbumSummary } from "@rcm/shared";
const ALBUM_VERSION_GAP_MS = 10 * 60 * 1000;
const ALBUM_VERSION_LIMIT = 30;
// Both album lists use the same definition; their document table is aliased as a.
const ALBUM_SCENE_COUNT_SQL = `(SELECT coalesce(SUM(CASE WHEN json_extract(i.value,'$.origin.kind')='chapter'
    OR EXISTS(SELECT 1 FROM json_each(i.value,'$.children') c WHERE json_type(c.value,'$.fields.title') IS NOT NULL OR json_type(c.value,'$.fields.summary') IS NOT NULL)
    THEN coalesce(json_array_length(i.value,'$.children'),0) ELSE 1 END),0)
  FROM json_each(a.document_json,'$.blocks') b, json_each(b.value,'$.items') i
  WHERE json_extract(b.value,'$.kind')='story' AND coalesce(json_extract(b.value,'$.hidden'),0)=0)`;

type StoredAlbum = { revision: number; document_json: string; created_at: number; updated_at: number; source_available: number };
type AlbumVersionSummary = Pick<AlbumSummary, "revision" | "theme" | "tint" | "sceneCount"> & { createdAt: number; title: string | null; photoCount: number };

export class AlbumRevisionConflictError extends Error {
  readonly code = "ALBUM_REVISION_CONFLICT";
  constructor(readonly revision: number) {
    super("Album was changed on another device");
    this.name = "AlbumRevisionConflictError";
  }
}

function serializeDocument(document: AlbumDocument): string {
  const json = JSON.stringify(document);
  if (Buffer.byteLength(json, "utf8") > 4 * 1024 * 1024) throw Object.assign(new Error("Album document exceeds 4 MB"), { code: "ALBUM_DOCUMENT_TOO_LARGE" });
  return json;
}

export function listAlbums(db: RcmDatabase): AlbumSummary[] {
  const rows = db.prepare(`SELECT id,title,source_chat_id AS sourceChatId,source_available AS sourceAvailable,
    cover_photo_id AS coverPhotoId,period_label AS periodLabel,revision,updated_at AS updatedAt,summary_json
    FROM albums ORDER BY updated_at DESC,id`).all() as Array<Omit<AlbumSummary, "sourceAvailable"> & { sourceAvailable: number; summary_json: string }>;
  const entries = rows.map(({ summary_json, ...row }) => ({ row, fields: JSON.parse(summary_json) as AlbumShelfFields, newMemoryCount: 0 }));
  const byChat = new Map<string, typeof entries>();
  for (const entry of entries) if (entry.row.sourceAvailable && entry.row.sourceChatId) {
    const group = byChat.get(entry.row.sourceChatId) ?? []; group.push(entry); byChat.set(entry.row.sourceChatId, group);
  }
  // One chat scan at its oldest watermark; parse each participant list only once.
  const memories = db.prepare(`WITH boundaries AS (
    SELECT source_chat_id,MIN(json_extract(summary_json,'$.since')) since FROM albums
    WHERE source_available=1 AND source_chat_id IS NOT NULL GROUP BY source_chat_id)
    SELECT m.chat_id,m.created_at,m.participants_json FROM boundaries b JOIN memories m ON m.chat_id=b.source_chat_id
    WHERE m.active=1 AND m.type='episode' AND m.capsule_parent_id IS NULL AND m.created_at>=0 AND m.created_at>b.since`);
  for (const memory of memories.iterate() as Iterable<{ chat_id: string; created_at: number; participants_json: string }>) {
    const participants = JSON.parse(memory.participants_json) as string[];
    for (const entry of byChat.get(memory.chat_id) ?? []) if (memory.created_at > entry.fields.since && albumPairPresent(participants, entry.fields.pair)) entry.newMemoryCount++;
  }
  return entries.map(({ row, fields: { since: _since, pair: _pair, ...fields }, newMemoryCount }) => ({ ...row, ...fields, newMemoryCount, sourceAvailable: Boolean(row.sourceAvailable) }));
}

export function getAlbum(db: RcmDatabase, id: string): { document: AlbumDocument; revision: number } | undefined {
  const row = db.prepare("SELECT document_json,revision FROM albums WHERE id=?").get(id) as { document_json: string; revision: number } | undefined;
  return row ? { document: AlbumDocumentSchema.parse(JSON.parse(row.document_json)), revision: row.revision } : undefined;
}

export function listAlbumVersions(db: RcmDatabase, id: string): AlbumVersionSummary[] {
  const rows = db.prepare(`SELECT revision,created_at AS createdAt,
    CASE WHEN json_valid(a.document_json) THEN json_extract(a.document_json,'$.title') END AS title,
    CASE WHEN json_valid(a.document_json) THEN json_extract(a.document_json,'$.style.theme') END AS theme,
    CASE WHEN json_valid(a.document_json) THEN json_extract(a.document_json,'$.style.tint') END AS tint,
    CASE WHEN json_valid(a.document_json) THEN ${ALBUM_SCENE_COUNT_SQL} ELSE 0 END AS sceneCount,
    CASE WHEN json_valid(a.document_json) THEN
      (SELECT COUNT(DISTINCT value) FROM json_tree(a.document_json,'$.blocks') WHERE key='photoId') ELSE 0 END AS photoCount
    FROM album_versions a WHERE album_id=? ORDER BY revision DESC`).all(id) as AlbumVersionSummary[];
  return rows.map(row => {
    const theme = ALBUM_THEMES.find(theme => theme === row.theme) ?? "book";
    return { ...row, theme, tint: resolveAlbumTint(theme, row.tint) };
  });
}

export function getAlbumVersion(db: RcmDatabase, id: string, revision: number): { document: AlbumDocument; revision: number; createdAt: number } | undefined {
  const row = db.prepare("SELECT document_json,revision,created_at AS createdAt FROM album_versions WHERE album_id=? AND revision=?").get(id, revision) as { document_json: string; revision: number; createdAt: number } | undefined;
  return row ? { document: AlbumDocumentSchema.parse(JSON.parse(row.document_json)), revision: row.revision, createdAt: row.createdAt } : undefined;
}

function storedAlbum(db: RcmDatabase, id: string): StoredAlbum {
  const row = db.prepare("SELECT revision,document_json,created_at,updated_at,source_available FROM albums WHERE id=?").get(id) as StoredAlbum | undefined;
  if (!row) throw new Error("Album not found");
  return row;
}

/** Preserve the stored JSON verbatim, with the time that look was last saved. */
function captureAlbumVersion(db: RcmDatabase, id: string, current: StoredAlbum): void {
  db.prepare("INSERT INTO album_versions(album_id,revision,document_json,created_at) VALUES(?,?,?,?) ON CONFLICT(album_id,revision) DO NOTHING")
    .run(id, current.revision, current.document_json, current.updated_at);
  db.prepare(`DELETE FROM album_versions WHERE album_id=? AND revision NOT IN
    (SELECT revision FROM album_versions WHERE album_id=? ORDER BY revision DESC LIMIT ?)`)
    .run(id, id, ALBUM_VERSION_LIMIT);
}

function updateAlbum(db: RcmDatabase, id: string, doc: AlbumDocument, current: StoredAlbum, now: number): { revision: number } {
  doc.revision = current.revision + 1;
  doc.createdAt = current.created_at;
  doc.lastUpdatedFromMaterialsAt ??= AlbumDocumentSchema.parse(JSON.parse(current.document_json)).lastUpdatedFromMaterialsAt ?? current.created_at;
  doc.updatedAt = now;
  const json = serializeDocument(doc);
  db.prepare(`UPDATE albums SET title=?,source_chat_id=?,source_available=?,document_json=?,summary_json=?,revision=?,cover_photo_id=?,period_label=?,updated_at=? WHERE id=? AND revision=?`)
    .run(doc.title, doc.source.chatId, Number(doc.source.sourceAvailable), json, JSON.stringify(albumShelfFields(doc)), doc.revision, doc.coverPhotoId ?? null, doc.periodLabel ?? null, doc.updatedAt, id, current.revision);
  return { revision: doc.revision };
}

export function createAlbum(db: RcmDatabase, document: AlbumDocument): { id: string; revision: 1 } {
  const doc = AlbumDocumentSchema.parse(document);
  assertAlbumStorageId(doc.id);
  doc.revision = 1;
  doc.createdAt = doc.updatedAt = Date.now();
  doc.lastUpdatedFromMaterialsAt = doc.createdAt;
  const json = serializeDocument(doc);
  db.prepare(`INSERT INTO albums(id,title,source_chat_id,source_available,document_json,summary_json,revision,cover_photo_id,period_label,created_at,updated_at)
    VALUES(?,?,?,?,?,?,1,?,?,?,?)`).run(doc.id, doc.title, doc.source.chatId, Number(doc.source.sourceAvailable), json, JSON.stringify(albumShelfFields(doc)), doc.coverPhotoId ?? null, doc.periodLabel ?? null, doc.createdAt, doc.updatedAt);
  return { id: doc.id, revision: 1 };
}

export function saveAlbum(db: RcmDatabase, id: string, document: AlbumDocument, expectedRevision: number): { revision: number } {
  const doc = AlbumDocumentSchema.parse(document);
  if (doc.id !== id) throw new Error("Album document ID does not match");
  return db.transaction(() => {
    const current = storedAlbum(db, id);
    if (current.revision !== expectedRevision) throw new AlbumRevisionConflictError(current.revision);
    const now = Date.now();
    const previous = AlbumDocumentSchema.parse(JSON.parse(current.document_json));
    const materialsUpdated = (doc.lastUpdatedFromMaterialsAt ?? current.created_at) > (previous.lastUpdatedFromMaterialsAt ?? current.created_at);
    if (materialsUpdated || now - current.updated_at >= ALBUM_VERSION_GAP_MS) captureAlbumVersion(db, id, current);
    return updateAlbum(db, id, doc, current, now);
  }).immediate();
}

export function restoreAlbumVersion(db: RcmDatabase, id: string, versionRevision: number, expectedRevision: number): { revision: number } | undefined {
  return db.transaction(() => {
    const current = storedAlbum(db, id);
    if (current.revision !== expectedRevision) throw new AlbumRevisionConflictError(current.revision);
    const version = getAlbumVersion(db, id, versionRevision);
    if (!version) return undefined;
    version.document.source.sourceAvailable = Boolean(current.source_available);
    captureAlbumVersion(db, id, current);
    return updateAlbum(db, id, version.document, current, Date.now());
  }).immediate();
}

export function duplicateAlbum(db: RcmDatabase, photoStore: AlbumPhotoStore, id: string): { id: string } {
  const targetId = randomUUID();
  try {
    return db.transaction(() => {
      const original = getAlbum(db, id);
      if (!original) throw new Error("Album not found");
      const photos = listAlbumPhotos(db, id);
      const copies = photoStore.copyAlbum(id, targetId, photos);
      const ids = new Map(photos.map((photo, index) => [photo.id, copies[index]!.id]));
      const remap = (photoId: string): string => {
        const copiedId = ids.get(photoId);
        if (!copiedId) throw new Error("Album references a missing photo");
        return copiedId;
      };
      const doc = original.document;
      doc.id = targetId;
      if (doc.coverPhotoId) doc.coverPhotoId = remap(doc.coverPhotoId);
      for (const person of [doc.people.me, doc.people.partner]) if (person.photoId) person.photoId = remap(person.photoId);
      const remapItems = (items: AlbumItem[]): void => {
        for (const item of items) {
          item.photos = item.photos.map(photo => ({ ...photo, photoId: remap(photo.photoId) }));
          if (item.children) remapItems(item.children);
        }
      };
      for (const block of doc.blocks) remapItems(block.items);
      createAlbum(db, doc);
      for (const photo of copies) insertAlbumPhoto(db, photo);
      return { id: targetId };
    }).immediate();
  } catch (error) { photoStore.removeAlbum(targetId); throw error; }
}

export function deleteAlbum(db: RcmDatabase, photoStore: AlbumPhotoStore, id: string): void {
  assertAlbumStorageId(id);
  db.prepare("DELETE FROM albums WHERE id=?").run(id);
  // A crash after the commit leaves only orphans, removed by the next startup sweep.
  photoStore.removeAlbum(id);
}

export function markSourceDeleted(db: RcmDatabase, chatId: string): void {
  db.transaction(() => {
    const rows = db.prepare("SELECT id FROM albums WHERE source_chat_id=? AND source_available=1").all(chatId) as Array<{ id: string }>;
    setSourceAvailability(db, rows, false);
  }).immediate();
}

/** Reconnect keepsakes only after their source chats have been restored. */
export function markSourcesRestored(db: RcmDatabase): void {
  db.transaction(() => {
    const rows = db.prepare("SELECT id FROM albums WHERE source_available=0 AND source_chat_id IN (SELECT id FROM chats)").all() as Array<{ id: string }>;
    setSourceAvailability(db, rows, true);
  }).immediate();
}

function setSourceAvailability(db: RcmDatabase, rows: Array<{ id: string }>, available: boolean): void {
  for (const { id } of rows) {
    const current = storedAlbum(db, id);
    const doc = AlbumDocumentSchema.parse(JSON.parse(current.document_json));
    doc.source.sourceAvailable = available;
    updateAlbum(db, id, doc, current, Date.now());
  }
}
