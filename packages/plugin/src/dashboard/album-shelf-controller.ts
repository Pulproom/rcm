import { albumClient, type AlbumSummary } from "../album/api.js";
import type { ServerClient } from "../api-client.js";
import { renderAlbumShelf } from "./album-shelf.js";
import { btn, notice } from "./film/ui.js";

/** Shelf lifetime owns thumbnail URLs; the full editor/wizard are subsequent tasks. */
export function createAlbumShelfController(root: HTMLElement, client: ServerClient, hooks: {
  skin: () => "film" | "phone"; render: () => void;
  confirm: (message: string) => Promise<boolean>;
}) {
  const api = albumClient(client);
  let albums: AlbumSummary[] = [], loaded = false, error = "", generation = 0, identity = "";
  let observer: IntersectionObserver | undefined;
  let lifetime = 0;
  let html = "", renderedSkin = "", renderEpoch = 0, frame = 0, reservedHeight = 0;
  let mounted: HTMLElement | null = null;
  const BATCH_SIZE = 24;
  const busy = new Set<string>();
  const urls = new Map<string, string>();
  const loading = new Set<string>();
  const clear = () => {
    generation++; lifetime++; observer?.disconnect();
    if (frame) cancelAnimationFrame(frame); frame = 0; mounted = null; html = ""; reservedHeight = 0;
    for (const album of albums) api.closeAlbum(album.id);
    albums = []; urls.clear(); loading.clear(); busy.clear(); loaded = false; error = "";
  };
  const options = () => ({ skin: hooks.skin(), photoUrl: (id: string, _photo: string, _size: "thumb") => urls.get(id) ?? "" });
  const refresh = async (serverIdentity: string) => {
    if (identity !== serverIdentity) { clear(); identity = serverIdentity; }
    const current = ++generation;
    try {
      const response = await api.list();
      if (current !== generation) return;
      if (!loaded || JSON.stringify(albums) !== JSON.stringify(response.albums)) {
        reservedHeight = root.querySelector<HTMLElement>(".album-shelf-grid")?.scrollHeight ?? 0;
        html = ""; renderEpoch++;
      }
      for (const old of albums) if (!response.albums.some(a => a.id === old.id && a.coverPhotoId === old.coverPhotoId && a.revision === old.revision)) {
        api.closeAlbum(old.id); urls.delete(old.id); loading.delete(old.id);
      }
      albums = response.albums; loaded = true; error = "";
    } catch { if (current === generation) error = "앨범을 불러오지 못했어요."; }
  };
  const hydrate = () => {
    const grid = root.querySelector<HTMLElement>(".album-shelf-grid");
    if (!grid || grid === mounted) return;
    if (frame) cancelAnimationFrame(frame); frame = 0; mounted = grid;
    observer?.disconnect();
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer?.unobserve(entry.target);
        const card = entry.target as HTMLElement;
        const album = albums.find(a => a.id === card.dataset.albumId);
        if (!album?.coverPhotoId || urls.has(album.id) || loading.has(album.id)) continue;
        loading.add(album.id);
        const current = lifetime;
        void api.loadPhoto(album.id, album.coverPhotoId, "thumb").then(url => {
          if (current !== lifetime || !albums.some(a => a.id === album.id && a.coverPhotoId === album.coverPhotoId && a.revision === album.revision)) return;
          urls.set(album.id, url);
          const mountedCard = root.querySelector<HTMLElement>(`[data-album-id="${CSS.escape(album.id)}"].album-card`);
          if (!mountedCard) return;
          const fragment = document.createElement("template");
          fragment.innerHTML = renderAlbumShelf([album], options());
          const cover = fragment.content.querySelector(".album-shelf-mc");
          if (cover) mountedCard.querySelector(".album-shelf-mc")?.replaceWith(cover);
        }).catch(() => { /* Keep the typographic cover when a file is unavailable. */ })
          .finally(() => loading.delete(album.id));
      }
    }, { rootMargin: "160px" });
    root.querySelectorAll(".album-card").forEach(card => observer!.observe(card));
    // Keep the mounted shelf stable on dashboard repaints. Parse a bounded
    // number of cards per frame, then retain every card for normal find/focus.
    let count = Math.min(BATCH_SIZE, albums.length);
    const epoch = renderEpoch;
    const append = () => {
      if (mounted !== grid || !grid.isConnected || epoch !== renderEpoch) return;
      const next = albums.slice(count, count + BATCH_SIZE); count += next.length;
      const fragment = document.createElement("template"); fragment.innerHTML = renderAlbumShelf(next, options());
      for (const card of fragment.content.querySelectorAll(".album-card")) {
        grid.insertBefore(card, grid.querySelector(".album-shelf-new-card")); observer!.observe(card);
      }
      if (count < albums.length) frame = requestAnimationFrame(append);
      else grid.style.minHeight = "";
    };
    if (count < albums.length) frame = requestAnimationFrame(append); else grid.style.minHeight = "";
  };
  const handle = async (target: HTMLElement): Promise<boolean> => {
    const action = target.dataset.action ?? "", id = target.dataset.albumId;
    // Dashboard routes view, wizard, update and export actions; this controller owns shelf mutations.
    if (["album-menu", "open-album", "new-album", "update-album", "export-album-html", "copy-album-board"].includes(action)) return true;
    if (!["duplicate-album", "delete-album"].includes(action)) return false;
    if (!id || busy.has(id) || !albums.some(a => a.id === id)) return true;
    busy.add(id);
    const current = generation;
    try {
      if (action === "delete-album") {
        if (!await hooks.confirm("이 앨범과 앨범 사진을 지울까요? 지운 앨범은 되돌릴 수 없어요. 원본 채팅은 남아요.") || current !== generation) return true;
        await api.remove(id);
      } else if (action === "duplicate-album") await api.duplicate(id);
      if (current === generation) { await refresh(identity); hooks.render(); }
    } catch { if (current === generation) { error = "앨범 요청을 완료하지 못했어요."; hooks.render(); } }
    finally { busy.delete(id); }
    return true;
  };
  return { refresh, hydrate, handle, clear,
    render: () => {
      if (error) return notice(error, { tone: "cut", action: btn("다시 시도", { action: "refresh" }) });
      if (!loaded) return '<p class="sub" role="status">앨범 불러오는 중…</p>';
      if (!html || renderedSkin !== hooks.skin()) {
        renderedSkin = hooks.skin();
        html = renderAlbumShelf(albums.slice(0, BATCH_SIZE), { ...options(), totals: { albums: albums.length, chats: new Set(albums.map(a => a.sourceChatId).filter(Boolean)).size } })
          .replace('<section class="album-shelf"', `<section data-album-render="${renderEpoch}" class="album-shelf"`)
          .replace('class="album-shelf-grid"', `class="album-shelf-grid" style="min-height:${reservedHeight}px"`);
      }
      return html;
    },
  };
}
