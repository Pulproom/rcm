import { randomUUID } from "node:crypto";

const PART_BYTES = 768 * 1024;
const TRANSFER_TTL_MS = 60_000;
/** A bounded response spool, not a reusable materials cache. Snapshot ends on final read,
 * explicit close, expiry or eviction. A subsequent build always rereads current data. */
export function createAlbumTransfers() {
  const tooLarge = Symbol("album part too large");
  const smallJson = (value: unknown) => {
    let bound = 0;
    try {
      return JSON.stringify(value, (key, child: unknown) => {
        // Six bytes per UTF-16 code unit bounds JSON escaping. Stop while
        // visiting a large container, before allocating its complete JSON.
        bound += key.length * 6 + 3 + (typeof child === "string" ? child.length * 6 + 2 : 32);
        if (bound > PART_BYTES) throw tooLarge;
        return child;
      });
    } catch (error) { if (error === tooLarge) return undefined; throw error; }
  };
  const transfers = new Map<string, { pages: string[]; timer: ReturnType<typeof setTimeout> }>();
  const close = (id: string) => { const entry = transfers.get(id); if (entry) clearTimeout(entry.timer); transfers.delete(id); };
  const read = (id: string, page: number) => {
    const entry = transfers.get(id), result = entry?.pages[page];
    if (entry && page === entry.pages.length - 1) close(id);
    return result;
  };
  const open = (value: unknown) => {
    while (transfers.size >= 2) close(transfers.keys().next().value!);
    const id = randomUUID(), groups: string[][] = [[]];
    let bytes = 0;
    const emitJson = (json: string) => {
      const size = Buffer.byteLength(json);
      if (bytes + size > PART_BYTES && groups.at(-1)!.length) { groups.push([]); bytes = 0; }
      groups.at(-1)!.push(json); bytes += size + 1;
    };
    const emit = (path: Array<string | number>, value: unknown, append?: true) => emitJson(JSON.stringify({ path, value, ...(append ? { append } : {}) }));
    const visit = (value: unknown, path: Array<string | number>) => {
      if (value === undefined) return;
      const json = smallJson({ path, value });
      if (json !== undefined) { emitJson(json); return; }
      if (typeof value === "string") {
        emit(path, "");
        for (let i = 0; i < value.length; i += 64_000) emit(path, value.slice(i, i + 64_000), true);
      } else if (Array.isArray(value)) {
        emit(path, []); value.forEach((child, index) => visit(child ?? null, [...path, index]));
      } else if (value && typeof value === "object") {
        emit(path, {}); for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
      }
    };
    visit(value, []);
    const pages = groups.map((entries, index) => `{"transferId":${JSON.stringify(id)},"next":${index + 1 < groups.length ? index + 1 : "null"},"entries":[${entries.join(",")}]}`);
    if (pages.length > 1) {
      const timer = setTimeout(() => close(id), TRANSFER_TTL_MS); timer.unref(); transfers.set(id, { pages, timer });
    }
    return pages[0]!;
  };
  return { open, read, close };
}
