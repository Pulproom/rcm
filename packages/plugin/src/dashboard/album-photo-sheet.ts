import { albumDateFormat, albumPhotoItems, albumScenes, unplacedAlbumPhotos, placeAlbumPhotos, type AlbumDocument, type AlbumMaterials } from "@rcm/shared";
import type { albumClient, AlbumPhoto } from "../album/api.js";
import { createInlayReader, albumPhotoError, downscaleImage, importInlay, inlayBlob, type InlayHost } from "../album/photos.js";
import { escapeHtml as esc, icon } from "./film/ui.js";

type Api = ReturnType<typeof albumClient>;
export interface PhotoSheetTarget { sceneId?: string; blockId?: string; itemId?: string; cover?: boolean; person?: "me" | "partner"; replaceId?: string; library?: boolean }
export interface AlbumPhotoUploadFeedback { key: string; state: "uploading" | "error"; message?: string; sceneId?: string; blockId?: string; cover?: boolean }
interface Tile { file?: File; state?: "uploading" | "error"; message?: string; key: string; name: string; caption?: string; inlayId?: string; photoId?: string; sceneId?: string; chapterId?: string; date?: string; sourceId?: string; sourceName?: string }
const button = (action: string, text: string, attrs = "") => `<button type="button" data-photo-action="${action}" ${attrs}>${text}</button>`;

/** The sheet's mark means a document placement, including cover/portraits and hidden references. */
export function isAlbumSheetPhotoPlaced(doc: AlbumDocument, tile: { photoId?: string; inlayId?: string }, stored: readonly Pick<AlbumPhoto, "id" | "inlayId">[]): boolean {
  const id = tile.photoId ?? (tile.inlayId ? stored.find(p => p.inlayId === tile.inlayId)?.id : undefined);
  return Boolean(id && !unplacedAlbumPhotos(doc, [{ id }]).length);
}
/** One mounted overlay per editor. Its async work never rewrites an older document snapshot. */
export function createAlbumPhotoSheet(root: HTMLElement, api: Api, host: InlayHost, hooks: {
  document: () => AlbumDocument; materials: () => AlbumMaterials | undefined; apply: (next: AlbumDocument) => void;
  photoSrc: (id: string) => string; photoLoaded: (id: string, url: string) => void; storedChanged?: () => void; uploadProgress?: (uploads: AlbumPhotoUploadFeedback[]) => void;
}) {
  let active = false, epoch = 0, busy = false, tab = "inlay", scope = "all", stage = "pick", error = "";
  let target: PhotoSheetTarget = {}, tiles: Tile[] = [], stored: AlbumPhoto[] = [], selected = new Set<string>(), touched = new Set<string>();
  let destinations = new Map<string, string>(), expanded = "", returnFocus: HTMLElement | null = null;
  let observer: IntersectionObserver | undefined, reader = createInlayReader(host);
  const ownedUrls = new Set<string>();
  const thumbs = new Map<string, string>(), skipped = new Set<string>(), loading = new Set<string>();
  const hostNode = () => root.querySelector<HTMLElement>(".ae-photo-overlay");
  const chapters = () => hooks.document().blocks.filter(b => b.kind === "story").flatMap(b => b.items);
  const sceneName = (id?: string) => albumScenes(hooks.document()).find(s => s.id === id)?.fields.title ?? "";
  const added = (tile: Tile) => isAlbumSheetPhotoPlaced(hooks.document(), tile, stored);
  const currentTiles = () => tiles.filter(t => !skipped.has(t.key) && (tab === "inlay" ? Boolean(t.inlayId) : !t.inlayId || Boolean(t.photoId)) && (tab !== "inlay" || scope === "all" || (scope === "scene" ? t.sceneId === target.sceneId : t.chapterId === tiles.find(t => t.sceneId === target.sceneId)?.chapterId)));
  const mark = (t: Tile) => `<span class="ap-check">${selected.has(t.key) ? selected.size ? [...selected].indexOf(t.key) + 1 : "" : ""}</span>`;
  const progress = () => hooks.uploadProgress?.(tiles.filter(t => t.state).map(t => ({ key: t.key, state: t.state!, message: t.message, sceneId: target.sceneId, blockId: target.blockId, cover: target.cover })));
  const tileHtml = (t: Tile) => t.state ? `<div class="ap-tile ap-upload-${t.state}" role="status">${t.state === "uploading" ? `<span class="ap-spinner">${icon("refresh")}</span><span>올리는 중…</span>` : `<span>${esc(t.message || "사진을 올리지 못했어요.")}</span>${button("retry-upload", "다시 올리기", `data-key="${esc(t.key)}"${busy ? " disabled" : ""}`)}`}</div>` : button("tile", `${thumbs.has(t.key) || t.photoId && hooks.photoSrc(t.photoId) ? `<img src="${esc(thumbs.get(t.key) || hooks.photoSrc(t.photoId!))}" alt="">` : '<span class="ap-placeholder" aria-hidden="true"></span>'}${mark(t)}${added(t) ? '<small class="ap-placed">넣음</small>' : ""}`, `class="ap-tile" data-key="${esc(t.key)}" aria-label="${esc(t.name)}" aria-pressed="${selected.has(t.key)}"`);
  const picker = (t: Tile) => `<div class="ap-picker">${chapters().map((ch, n) => `<details${n === 0 ? " open" : ""}><summary><i>${String(n + 1).padStart(2, "0")}</i>${esc(ch.fields.title ?? "장")}<small>장면 ${ch.children?.length ?? 1}</small></summary>${(ch.children?.some(s => s.fields.title) ? ch.children : [ch])!.map(s => `<label><input type="radio" name="place-${esc(t.key)}" data-photo-place="${esc(t.key)}" value="${esc(s.id)}"${destinations.get(t.key) === s.id ? " checked" : ""}><small>${esc(albumDateFormat(hooks.document().periodLabel).date(s.fields.date))}</small><span>${esc(s.fields.title ?? "장면")}</span></label>`).join("")}</details>`).join("")}<label><input type="radio" name="place-${esc(t.key)}" data-photo-place="${esc(t.key)}" value=""${!destinations.get(t.key) ? " checked" : ""}>자리 없이 두기</label></div>`;
  const placement = () => `<ul class="ap-placements">${tiles.filter(t => selected.has(t.key) && !skipped.has(t.key)).map(t => `<li><div class="ap-place-row">${thumbs.get(t.key) || t.photoId && hooks.photoSrc(t.photoId) ? `<img src="${esc(thumbs.get(t.key) || hooks.photoSrc(t.photoId!))}" alt="">` : '<span class="ap-place-placeholder"></span>'}<div><b>${esc(t.name)}</b><small>${t.inlayId && t.sceneId && destinations.get(t.key) === t.sceneId ? "원래 장면으로" : "직접 고른 사진"}</small></div>${button("where", `${destinations.get(t.key) ? icon("check") + esc(sceneName(destinations.get(t.key))) : "장면 고르기"}${icon("chevron")}`, `class="ap-where" data-key="${esc(t.key)}" aria-expanded="${expanded === t.key}"`)}</div>${expanded === t.key ? picker(t) : ""}</li>`).join("")}</ul>`;
  const body = () => {
    if (stage === "place") return placement();
    if (tab === "upload") return `<div class="ap-drop">${icon("album")}<p>사진을 여기에 놓거나 골라 주세요</p>${button("upload", "사진 고르기", busy ? "disabled" : "")}<input type="file" accept="image/*" multiple hidden></div><div class="ap-grid">${tiles.filter(t => t.key.startsWith("upload:")).map(tileHtml).join("")}</div>`;
    const list = currentTiles(), groups = new Map<string, Tile[]>();
    for (const tile of list) { const id = tab === "inlay" ? tile.sourceId || tile.sceneId || "" : ""; groups.set(id, [...groups.get(id) ?? [], tile]); }
    return `${tab === "inlay" ? `<div class="ap-scope" role="group" aria-label="인레이 범위">${[["scene", "이 장면"], ["chapter", "이 챕터"], ["all", "전체"]].map(([id, text]) => button("scope", text!, `data-value="${id}" aria-pressed="${scope === id}"${id !== "all" && !target.sceneId ? " disabled" : ""}`)).join("")}</div>` : ""}${[...groups].map(([_id, items]) => `<section class="ap-group">${tab === "inlay" ? `<h3>${esc(items[0]!.date ?? "")} ${esc(items[0]!.sourceName ?? "")}<small>${items.length}장</small></h3>` : ""}<div class="ap-grid">${items.map(tileHtml).join("")}</div></section>`).join("") || '<p class="ap-empty">사진이 없어요.</p>'}`;
  };
  const close = (force = false) => {
    if (busy && !force) return;
    active = false; epoch++; observer?.disconnect(); reader.close(); hooks.uploadProgress?.([]);
    for (const src of ownedUrls) URL.revokeObjectURL(src); ownedUrls.clear();
    thumbs.clear(); loading.clear(); hostNode()?.replaceChildren();
    const base = root.querySelector<HTMLElement>(".ae-base"); if (base) base.inert = false;
    hooks.storedChanged?.();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else root.querySelector<HTMLElement>('[data-edit-action="photo"]')?.focus();
  };
  const load = async (tile: Tile, generation: number) => {
    if (loading.has(tile.key) || thumbs.has(tile.key) || skipped.has(tile.key)) return;
    loading.add(tile.key);
    try {
      if (tile.photoId) {
        const url = hooks.photoSrc(tile.photoId) || await api.loadPhoto(hooks.document().id, tile.photoId, "thumb");
        if (!active || generation !== epoch) return; hooks.photoLoaded(tile.photoId, url); thumbs.set(tile.key, url);
      } else if (tile.inlayId) {
        const asset = await reader.read(tile.inlayId); if (!active || generation !== epoch) return;
        if (!asset || asset.type !== "image") { skipped.add(tile.key); selected.delete(tile.key); paint(); return; }
        const small = await downscaleImage(inlayBlob(asset.data), 320);
        if (!active || generation !== epoch) return;
        const url = URL.createObjectURL(new Blob([new Uint8Array(small.bytes)], { type: small.mime })); ownedUrls.add(url); thumbs.set(tile.key, url);
        tile.name = asset.name || tile.name;
      }
      const node = hostNode()?.querySelector<HTMLElement>(`[data-key="${CSS.escape(tile.key)}"].ap-tile`);
      if (node && thumbs.has(tile.key)) { const img = document.createElement("img"); img.src = thumbs.get(tile.key)!; img.alt = ""; node.querySelector(".ap-placeholder")?.replaceWith(img); }
    } catch { if (generation === epoch) { error = "일부 사진을 불러오지 못했어요. 다시 열어 주세요."; const status = hostNode()?.querySelector('[role="status"]'); if (status) status.textContent = error; } }
    finally { loading.delete(tile.key); }
  };
  const paint = (focus = false) => {
    const mount = hostNode(); if (!active || !mount) return;
    const top = mount.querySelector(".ap-body")?.scrollTop ?? 0;
    const focused = document.activeElement as HTMLInputElement | null, focusKey = focused?.dataset.key, placeKey = focused?.dataset.photoPlace, placeValue = focused?.value;
    const focusAction = focused?.dataset.photoAction, focusValue = focused?.dataset.value;
    const direct = Boolean(target.sceneId || target.cover || target.blockId || target.person);
    mount.innerHTML = `<div class="ap-scrim" data-photo-action="close"></div><section class="ap-dialog" role="dialog" aria-modal="true" aria-label="${stage === "place" ? "어디에 넣을까요?" : "사진 넣기"}" aria-busy="${busy}"><header><h2>${stage === "place" ? "어디에 넣을까요?" : "사진 넣기"}<small>${esc(sceneName(target.sceneId))}</small></h2>${button("close", icon("close"), 'aria-label="닫기"')}</header>${stage === "pick" ? `<div class="ap-tabs" role="tablist" aria-label="사진 출처">${[["inlay", "인레이"], ["album", "이 앨범"], ["upload", "새로 올리기"]].map(([key, label]) => button("tab", `${label}${key === "inlay" ? `<small>${tiles.filter(t => t.inlayId).length}</small>` : ""}`, `role="tab" data-value="${key}" aria-selected="${tab === key}"`)).join("")}</div>` : ""}<div class="ap-body">${body()}</div><p class="ap-error" role="status">${esc(error)}</p><footer><span>${stage === "place" ? '사진은 「사진」 패널에서도 고를 수 있어요' : `<b>${selected.size}장</b> 골랐어요`}</span>${stage === "place" ? button("back", "이전") : ""}${button("insert", busy ? "넣는 중…" : stage === "pick" && !direct ? "다음" : "넣기", `class="ap-primary"${busy || !selected.size ? " disabled" : ""}`)}</footer></section>`;
    const base = root.querySelector<HTMLElement>(".ae-base"); if (base) base.inert = true;
    const scroll = mount.querySelector(".ap-body")!; scroll.scrollTop = top;
    observer?.disconnect();
    observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return; observer?.unobserve(entry.target);
      const tile = tiles.find(t => t.key === (entry.target as HTMLElement).dataset.key); if (tile) void load(tile, epoch);
    }), { root: scroll, rootMargin: "120px" });
    mount.querySelectorAll(".ap-tile").forEach(node => observer!.observe(node));
    if (focus) mount.querySelector<HTMLElement>("button")?.focus();
    else if (placeKey) mount.querySelector<HTMLElement>(`[data-photo-place="${CSS.escape(placeKey)}"][value="${CSS.escape(placeValue ?? "")}"]`)?.focus({ preventScroll: true });
    else if (focusKey) mount.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    else if (focusAction) mount.querySelector<HTMLElement>(`[data-photo-action="${CSS.escape(focusAction)}"]${focusValue ? `[data-value="${CSS.escape(focusValue)}"]` : ""}`)?.focus({ preventScroll: true });
    if (!mount.contains(document.activeElement)) mount.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  };
  const open = async (options: PhotoSheetTarget = {}) => {
    if (busy) return;
    close(); active = true; const generation = ++epoch; reader = createInlayReader(host);
    target = options; selected = new Set(); touched = new Set(); destinations = new Map(); skipped.clear(); tiles = []; stored = [];
    scope = target.sceneId ? "scene" : "all"; stage = "pick"; tab = options.library ? "album" : "inlay"; expanded = ""; error = "";
    returnFocus = document.activeElement as HTMLElement;
    paint(true);
    try { stored = (await api.photos(hooks.document().id)).photos; }
    catch { error = "앨범 사진 목록을 불러오지 못했어요."; }
    if (!active || generation !== epoch) return;
    const doc = hooks.document(), scenes = albumScenes(doc), dates = albumDateFormat(doc.periodLabel);
    const ownIds = new Set(doc.blocks.flatMap(b => albumPhotoItems(b.items).flatMap(i => i.photos.map(p => p.photoId))));
    [doc.coverPhotoId, doc.people.me.photoId, doc.people.partner.photoId].forEach(id => { if (id) ownIds.add(id); });
    for (const ch of hooks.materials()?.blocks.story ?? []) for (const source of ch.children ?? []) {
      const scene = scenes.find(s => s.id === source.id || Boolean(s.origin && source.origin && s.origin.sourceId === source.origin.sourceId && s.origin.kind === source.origin.kind));
      for (const uuid of source.inlayIds ?? []) if (!tiles.some(t => t.inlayId === uuid)) {
        const saved = stored.find(p => p.inlayId === uuid);
        const tile: Tile = { key: `inlay:${uuid}`, inlayId: uuid, photoId: saved?.id, caption: saved?.caption, name: saved?.caption || `인레이 · ${dates.date(source.fields.date)}`, sceneId: scene?.id, chapterId: ch.id, date: dates.date(source.fields.date), sourceId: source.id, sourceName: source.fields.title };
        tiles.push(tile); if (added(tile)) selected.add(tile.key); if (scene) destinations.set(tile.key, scene.id);
      }
    }
    for (const id of new Set([...ownIds, ...stored.map(p => p.id)])) if (!tiles.some(t => t.photoId === id)) {
      const saved = stored.find(p => p.id === id), scene = scenes.find(s => s.photos.some(p => p.photoId === id));
      const tile: Tile = { key: `photo:${id}`, photoId: id, caption: saved?.caption, name: saved?.caption || "앨범 사진", sceneId: scene?.id };
      tiles.push(tile); if (scene) destinations.set(tile.key, scene.id);
    }
    if (!tiles.some(t => t.inlayId)) tab = "album";
    if (options.library) selected.clear(); else selected = new Set(currentTiles().filter(t => selected.has(t.key) && t.photoId !== target.replaceId).map(t => t.key));
    paint(true);
  };
  const insert = async () => {
    const direct = Boolean(target.sceneId || target.cover || target.blockId || target.person);
    if (stage === "pick" && !direct) { stage = "place"; paint(true); return; }
    busy = true; error = ""; paint(); const generation = epoch, bookId = hooks.document().id;
    try {
      const chosen = tiles.filter(t => selected.has(t.key) && !skipped.has(t.key));
      const placements: { photoId: string; width?: number; height?: number; caption?: string; sceneId?: string; blockId?: string }[] = [];
      for (const tile of chosen) {
        if (!tile.photoId && tile.inlayId) {
          const imported = await importInlay(bookId, tile.inlayId, { readInlay: id => reader.read(id) }, api);
          if (!imported) { skipped.add(tile.key); continue; }
          tile.photoId = imported.id; tile.caption = imported.caption; stored.push(imported);
          // Imported files remain in storage even if a later read fails.

        }
        if (!tile.photoId) continue;
        const url = await api.loadPhoto(bookId, tile.photoId, "thumb");
        if (generation !== epoch) return; hooks.photoLoaded(tile.photoId, url);
        if (!direct && added(tile) && !touched.has(tile.key) && ownPhoto(tile.photoId)) continue;
        placements.push({ photoId: tile.photoId, width: stored.find(p => p.id === tile.photoId)?.width, height: stored.find(p => p.id === tile.photoId)?.height, caption: tile.caption, sceneId: target.blockId ? undefined : target.sceneId ?? destinations.get(tile.key) ?? "", blockId: target.blockId });
      }
      let next = hooks.document();
      if (target.cover || target.person) {
        const id = placements[0]?.photoId;
        if (id) next = target.person ? { ...next, people: { ...next.people, [target.person]: { ...next.people[target.person], photoId: id } } } : { ...next, coverPhotoId: id };
      } else if (target.blockId && !target.sceneId && next.blocks.find(b => b.id === target.blockId)?.kind === "photo") {
        next = structuredClone(next); const block = next.blocks.find(b => b.id === target.blockId)!;
        let item = block.items.find(i => i.id === target.itemId) ?? block.items[0];
        if (!item) { item = { id: crypto.randomUUID(), fields: {}, edited: {}, photos: [] }; block.items.push(item); }
        item.photos = [...item.photos.filter(p => p.photoId !== target.replaceId && !placements.some(q => q.photoId === p.photoId)), ...placements.map(({ photoId, caption, width, height }) => ({ photoId, caption, width, height }))];
      } else next = placeAlbumPhotos(next, placements);
      if (target.replaceId && !placements.some(p => p.photoId === target.replaceId)) {
        // A replaced image remains available in the tray; replacing never destroys it.
        if (target.sceneId) { next = structuredClone(next); const item = albumPhotoItems(next.blocks.flatMap(b => b.items)).find(i => i.id === target.sceneId); if (item) item.photos = item.photos.filter(p => p.photoId !== target.replaceId); }
      }
      hooks.apply(next); busy = false; close();
    } catch (e) { error = albumPhotoError(e); }
    finally { busy = false; if (active) paint(); }
  };
  const ownPhoto = (id: string) => !unplacedAlbumPhotos(hooks.document(), [{ id }]).length;
  const upload = async (files: FileList | File[], retry?: Tile) => {
    if (busy) return;
    const pending = Array.from(files).map(file => retry ?? { key: `upload:${crypto.randomUUID()}`, name: file.name, file });
    if (!retry) tiles.push(...pending);
    for (const tile of pending) { tile.state = "uploading"; tile.message = undefined; }
    busy = true; error = ""; const generation = epoch; paint(); progress();
    try {
      for (const tile of pending) {
        try {
          const { bytes, ...meta } = await downscaleImage(tile.file!);
          const { photo } = await api.uploadPhoto(hooks.document().id, bytes, { ...meta, source: "upload" });
          if (!active || generation !== epoch) return;
          stored.push(photo); tile.photoId = photo.id;
          const url = await api.loadPhoto(hooks.document().id, photo.id, "thumb");
          if (!active || generation !== epoch) return;
          hooks.photoLoaded(photo.id, url); thumbs.set(tile.key, url); tile.state = undefined; selected.add(tile.key); touched.add(tile.key);
        } catch (e) { if (!active || generation !== epoch) return; tile.state = "error"; tile.message = albumPhotoError(e); }
        paint(); progress();
      }
    } finally { busy = false; if (active && generation === epoch) { paint(); progress(); hooks.storedChanged?.(); } }
  };
  root.addEventListener("click", e => {
    const n = (e.target as HTMLElement).closest<HTMLElement>("[data-photo-action]"); if (!active || !n) return;
    e.preventDefault(); e.stopPropagation(); if (busy) return;
    const a = n.dataset.photoAction, key = n.dataset.key!;
    if (a === "close") { close(); return; }
    if (a === "insert") { void insert(); return; }
    if (a === "retry-upload") { const tile = tiles.find(t => t.key === key); if (tile?.file) void upload([tile.file], tile); return; }
    if (a === "upload") { hostNode()?.querySelector<HTMLInputElement>('input[type="file"]')?.click(); return; }
    if (a === "tile") {
      if (selected.has(key)) selected.delete(key);
      else { if (target.cover || target.person) selected.clear(); selected.add(key); }
      touched.add(key);
    }
    if (a === "tab") tab = n.dataset.value!;
    if (a === "scope") scope = n.dataset.value!;
    if (a === "where") expanded = expanded === key ? "" : key;
    if (a === "back") stage = "pick";
    paint();
  });
  root.addEventListener("change", e => {
    const n = e.target as HTMLInputElement; if (!active || busy || !n.closest(".ap-dialog")) return;
    if (n.type === "file" && n.files) void upload(n.files);
    if (n.dataset.photoPlace) { destinations.set(n.dataset.photoPlace, n.value); touched.add(n.dataset.photoPlace); paint(); }
  });
  root.addEventListener("dragover", e => { if (active && (e.target as HTMLElement).closest(".ap-drop")) e.preventDefault(); });
  root.addEventListener("drop", e => { if (active && (e.target as HTMLElement).closest(".ap-drop")) { e.preventDefault(); if (e.dataTransfer?.files) void upload(e.dataTransfer.files); } });
  root.addEventListener("keydown", e => {
    if (!active) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    if (e.key === "Tab") {
      const nodes = [...hostNode()?.querySelectorAll<HTMLElement>('button:not(:disabled),input,summary') ?? []].filter(n => n.getClientRects().length);
      if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0]?.focus(); }
    }
  }, true);
  return { open, close, dispose: () => close(true), hydrate: () => { if (active) paint(); }, get active() { return active; } };
}
