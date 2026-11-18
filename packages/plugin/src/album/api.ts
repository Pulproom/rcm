import type { AlbumDocument, AlbumMaterials, AlbumSummary, AlbumUpdateCandidates, AlbumPair, AlbumChatSummary, AlbumTransferPage, AlbumTogetherRecords } from "@rcm/shared";
import type { ServerClient } from "../api-client.js";

// API100 wire shapes. Keep the browser client independent of server/Node imports.
export type { AlbumSummary } from "@rcm/shared";
export interface AlbumPhotoMeta {
  mime: string; width: number; height: number; source: "upload" | "inlay"; inlayId?: string; caption?: string;
}
export interface AlbumPhoto extends AlbumPhotoMeta {
  id: string; albumId: string; ext: string; bytes: number; createdAt: number; publicUrl?: string;
}
export type { AlbumMaterialItem, AlbumMaterials } from "@rcm/shared";
export interface AlbumHtmlExport { name: string; path: string; bytes: number; expiresAt: number; readPath: string; url: string }
export type AlbumPhotoSize = "thumb" | "full";

/** Retain one instance per album view; call closeAlbum on close/server switch. */
export type AlbumVersionRow = { revision: number; createdAt: number; title: string | null; theme: AlbumSummary["theme"]; tint?: string; sceneCount: number; photoCount: number };
export function albumClient(client: Pick<ServerClient, "request" | "raw" | "url">) {
  const readTransfer = async <T>(path: string): Promise<T> => {
    let page = await client.request<T | AlbumTransferPage>(path);
    // Small in-memory preview transports can still return the original value.
    if (!page || typeof page !== "object" || !("entries" in page) || !("transferId" in page)) return page as T;
    const id = page.transferId;
    let value: unknown;
    let spoolOpen = (page as AlbumTransferPage).next !== null;
    try {
      while (true) {
        spoolOpen = (page as AlbumTransferPage).next !== null;
        for (const entry of (page as AlbumTransferPage).entries) {
          if (!entry.path.length) { value = entry.append ? String(value) + entry.value : entry.value; continue; }
          let parent = value as Record<string | number, unknown>;
          for (const key of entry.path.slice(0, -1)) {
            if (!parent || !Object.hasOwn(parent, key)) throw new Error("Invalid album transfer path");
            parent = parent[key] as typeof parent;
          }
          const key = entry.path.at(-1)!;
          Object.defineProperty(parent, key, { value: entry.append ? String(parent[key]) + entry.value : entry.value, configurable: true, enumerable: true, writable: true });
        }
        const next: number | null = (page as AlbumTransferPage).next;
        if (next === null) return value as T;
        page = await client.request<AlbumTransferPage>(`/v1/album-transfers/${encodeURIComponent(id)}/${next}`);
      }
    } finally { if (spoolOpen) await client.request(`/v1/album-transfers/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {}); }
  };
  type CachedPhoto = { albumId: string; photoId: string; size: AlbumPhotoSize; controller: AbortController; promise: Promise<string>; url?: string };
  const cache = new Map<string, CachedPhoto>();
  const path = (id: string) => `/v1/albums/${encodeURIComponent(id)}`;
  const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const photoPath = (id: string, photoId: string) => `${path(id)}/photos/${encodeURIComponent(photoId)}`;
  const invalidate = (albumId: string, photoId?: string, size?: AlbumPhotoSize): void => {
    for (const [key, entry] of cache) if (entry.albumId === albumId && (photoId === undefined || entry.photoId === photoId) && (size === undefined || entry.size === size)) {
      cache.delete(key); entry.controller.abort();
      if (entry.url) URL.revokeObjectURL(entry.url);
    }
  };
  const closeAlbum = (albumId: string): void => invalidate(albumId);
  const loadPhoto = (albumId: string, photoId: string, size: AlbumPhotoSize): Promise<string> => {
    const key = JSON.stringify([albumId, photoId, size]);
    const existing = cache.get(key); if (existing) return existing.promise;
    const controller = new AbortController();
    const entry: CachedPhoto = { albumId, photoId, size, controller, promise: undefined! };
    cache.set(key, entry);
    entry.promise = (async () => {
      try {
        const response = await client.raw(`${photoPath(albumId, photoId)}?size=${size}`, { signal: controller.signal });
        const blob = await response.blob();
        if (cache.get(key) !== entry || controller.signal.aborted) throw new DOMException("Album closed", "AbortError");
        entry.url = URL.createObjectURL(blob);
        return entry.url;
      } catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
    })();
    return entry.promise;
  };
  return {
    list: () => client.request<{ albums: AlbumSummary[] }>("/v1/albums"),
    chats: () => client.request<{ items: AlbumChatSummary[] }>("/v1/album-chats"),
    get: (id: string) => client.request<{ document: AlbumDocument; revision: number; photos?: AlbumPhoto[] }>(path(id)),
    photos: (id: string) => client.request<{ photos: AlbumPhoto[] }>(`${path(id)}/photos`),
    create: (document: AlbumDocument) => client.request<{ id: string; revision: number }>("/v1/albums", { method: "POST", body: JSON.stringify({ document }) }),
    save: (id: string, document: AlbumDocument, expectedRevision: number) => client.request<{ revision: number }>(path(id), { method: "PUT", body: JSON.stringify({ document, expectedRevision }) }),
    storeHtml: async (id: string, html: string): Promise<AlbumHtmlExport> => {
      const file = await client.request<Omit<AlbumHtmlExport, "url">>(`${path(id)}/exports`, { method: "POST", body: html, headers: { "Content-Type": "text/html; charset=utf-8" } });
      return { ...file, url: client.url(file.readPath) };
    },
    versions: (id: string) => client.request<{ versions: AlbumVersionRow[] }>(`${path(id)}/versions`),
    version: (id: string, revision: number) => client.request<{ document: AlbumDocument; revision: number; createdAt: number }>(`${path(id)}/versions/${revision}`),
    restoreVersion: (id: string, revision: number, expectedRevision: number) => client.request<{ revision: number }>(`${path(id)}/versions/${revision}/restore`, { method: "POST", body: JSON.stringify({ expectedRevision }) }),
    duplicate: (id: string) => client.request<{ id: string }>(`${path(id)}/duplicate`, { method: "POST" }),
    remove: async (id: string) => {
      const result = await client.request<{ ok: true }>(path(id), { method: "DELETE" }); closeAlbum(id); return result;
    },
    materials: (chatId: string, pair?: AlbumPair) => readTransfer<AlbumMaterials>(`/v1/chats/${encodeURIComponent(chatId)}/album-materials?${new URLSearchParams({ paged: "1", tz: timeZone(), ...(pair ?? {}) })}`),
    together: (chatId: string): Promise<AlbumTogetherRecords> => client.request(`/v1/chats/${encodeURIComponent(chatId)}/album-together?${new URLSearchParams({ tz: timeZone() })}`),
    candidates: (id: string) => client.request<AlbumUpdateCandidates>(`${path(id)}/update-candidates`),
    update: (id: string) => readTransfer<{ candidates: AlbumUpdateCandidates; materials?: AlbumMaterials; together?: AlbumTogetherRecords }>(`${path(id)}/update-materials?${new URLSearchParams({ tz: timeZone() })}`),
    uploadPhoto: (id: string, bytes: Uint8Array, meta: AlbumPhotoMeta) => {
      const { mime, ...fields } = meta;
      const header = JSON.stringify(fields).replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
      return client.request<{ photo: AlbumPhoto }>(`${path(id)}/photos`, { method: "POST", body: bytes as BodyInit,
        headers: { "Content-Type": mime, "X-RCM-Photo-Meta": header } });
    },
    uploadThumbnail: async (id: string, photoId: string, bytes: Uint8Array, mime: string) => {
      const result = await client.request<{ ok: true }>(`${photoPath(id, photoId)}/thumb`, { method: "PUT", body: bytes as BodyInit, headers: { "Content-Type": mime } });
      invalidate(id, photoId, "thumb"); return result;
    },
    updatePhoto: (id: string, photoId: string, patch: { caption?: string | null; publicUrl?: string | null }) =>
      client.request<{ photo: AlbumPhoto }>(photoPath(id, photoId), { method: "PATCH", body: JSON.stringify(patch) }),
    removePhoto: async (id: string, photoId: string) => {
      const result = await client.request<{ ok: true }>(photoPath(id, photoId), { method: "DELETE" }); invalidate(id, photoId); return result;
    },
    loadPhoto,
    readPhoto: async (albumId: string, photoId: string): Promise<Blob> => (await client.raw(`${photoPath(albumId, photoId)}?size=full`)).blob(),
    closeAlbum,
  };
}
