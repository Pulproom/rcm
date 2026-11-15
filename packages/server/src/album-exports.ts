import { randomBytes } from "node:crypto";
import { createReadStream, lstatSync } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";

const LINK_LIFETIME_MS = 30 * 60_000;
const fileTitle = (title: string) => {
  const clean = [...title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim().replace(/[. ]+$/, "")].slice(0, 60).join("") || "앨범";
  const bounded = [...clean].reduce((name, char) => Buffer.byteLength(name + char) <= 180 ? name + char : name, "");
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(bounded) ? `앨범-${bounded}` : bounded;
};
const dateStamp = (date: Date) => `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,"0")}${String(date.getDate()).padStart(2,"0")}-${String(date.getHours()).padStart(2,"0")}${String(date.getMinutes()).padStart(2,"0")}`;

/** Export files are user data. Expiring read capabilities never remove their files. */
export function createAlbumExportStore(dataDirectory: string) {
  // A sibling of albums keeps photo orphan sweeps and album restore/delete away from exports.
  const directory = resolve(dataDirectory, "album-exports");
  const links = new Map<string, { name: string; path: string; expiresAt: number }>();
  return {
    async save(title: string, stream: ReadableStream<Uint8Array>) {
      if (lstatExists(directory) && (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())) throw new Error("Export folder must be a directory");
      await mkdir(directory, { recursive: true });
      const base = `${fileTitle(title)}-${dateStamp(new Date())}`;
      let name = `${base}.html`, path = resolve(directory, name), handle;
      for (let number = 2; ; number++) {
        try { handle = await open(path, "wx", 0o600); break; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; name = `${base}-${number}.html`; path = resolve(directory, name); }
      }
      let bytes = 0;
      try {
        const reader = stream.getReader();
        try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; await handle.writeFile(chunk.value); bytes += chunk.value.byteLength; } }
        finally { reader.releaseLock(); }
        await handle.close();
      } catch (error) { await handle.close().catch(() => {}); await unlink(path).catch(() => {}); throw error; }
      const now = Date.now();
      for (const [token, entry] of links) if (entry.expiresAt <= now) links.delete(token);
      const token = randomBytes(32).toString("base64url"), expiresAt = now + LINK_LIFETIME_MS;
      links.set(token, { name, path, expiresAt });
      return { name, path, bytes, expiresAt, readPath: `/v1/album-exports/${token}/${encodeURIComponent(name)}` };
    },
    read(token: string, name: string) {
      const entry = links.get(token);
      if (!entry || entry.expiresAt <= Date.now()) { links.delete(token); return; }
      if (entry.name !== name || !lstatExists(entry.path) || !lstatSync(entry.path).isFile() || lstatSync(entry.path).isSymbolicLink()) return;
      return { name: entry.name, stream: Readable.toWeb(createReadStream(entry.path)) as ReadableStream<Uint8Array> };
    },
  };
}
function lstatExists(path: string): boolean { try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
export type AlbumExportStore = ReturnType<typeof createAlbumExportStore>;

/** Only this exact capability GET is public; write/list APIs retain normal authentication. */
export function registerAlbumExportReadRoute(app: Hono, store: AlbumExportStore): void {
  app.get("/v1/album-exports/:token/:name", context => {
    if (context.req.method !== "GET") return context.notFound();
    const file = store.read(context.req.param("token"), context.req.param("name"));
    if (!file) return context.notFound();
    return context.body(file.stream, 200, {
      "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' https:; font-src https: data:; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
  });
}
