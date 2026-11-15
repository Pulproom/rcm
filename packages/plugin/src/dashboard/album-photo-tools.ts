import type { AlbumPhotoUploadFeedback } from "./album-photo-sheet.js";
import { albumGalleryLayout, albumPhotoItems, placeAlbumPhotos, unplacedAlbumPhotos, type AlbumBlock, albumDefaultFit, albumPhotoRatio, panAlbumPhotoFit, zoomAlbumPhotoFit, type AlbumPhotoFit, type AlbumPhotoShape, type AlbumDocument } from "@rcm/shared";
import type { albumClient, AlbumPhoto } from "../album/api.js";
import { albumConfirm } from "./album-confirm.js";
import { removeAlbumPhotoReferences } from "../album/edit.js";
import { escapeHtml as esc, icon } from "./film/ui.js";

type Mode = { cover: boolean; frame: HTMLElement; figure: HTMLElement; image: HTMLImageElement; blockId: string; itemId: string; index: number; fit: AlbumPhotoFit; sourceRatio: number; width: number; height: number; frameStyle: string | null; imageStyle: string | null; shape: string | null; trigger: HTMLElement };
const SHAPES: [AlbumPhotoShape, string][] = [["landscape", "가로 3:2"], ["portrait", "세로 2:3"], ["square", "정사각"], ["original", "원본"]];
const button = (a: string, text: string, extra = "") => `<button type="button" data-photo-tool="${a}" ${extra}>${text}</button>`;

/** Placement references, storage tray and direct photo gestures share one editor lifecycle. */
export function createAlbumPhotoTools(root: HTMLElement, api: ReturnType<typeof albumClient>, hooks: {
  document: () => AlbumDocument; apply: (doc: AlbumDocument) => void; render: () => void;
  photoSrc: (id: string) => string; photoLoaded: (id: string, url: string) => void;
  flush: () => Promise<boolean>; forgotten: (id: string) => void; choose: () => void;
}) {
  let stored: AlbumPhoto[] = [], epoch = 0, active = false, error = "", deleting = false;
  let uploads: AlbumPhotoUploadFeedback[] = [];
  let mode: Mode | undefined;
  let pointer: { id: number; x: number; y: number; startX: number; startY: number; grip: HTMLElement; photoId?: string; ghost?: HTMLElement; target?: HTMLElement; timer?: ReturnType<typeof setTimeout> } | undefined;
  const fingers = new Map<number, { x: number; y: number }>();
  let gesture: { fit: AlbumPhotoFit; x: number; y: number; distance: number } | undefined;
  const beginGesture = () => { if (!mode) return; const points = [...fingers.values()]; const first = points[0]; gesture = first ? { fit: { ...mode.fit }, x: first.x, y: first.y, distance: points[1] ? Math.hypot(first.x - points[1].x, first.y - points[1].y) : 0 } : undefined; };
  const host = () => root.querySelector<HTMLElement>(".album-edit")!;
  const refresh = async () => {
    if (!active) return;
    const run = ++epoch, id = hooks.document().id;
    try {
      const loaded = await api.photos(id); if (!active || run !== epoch) return;
      stored = loaded.photos ?? [];
      await Promise.allSettled(stored.map(async p => {
        const url = await api.loadPhoto(id, p.id, "thumb"); if (active && run === epoch) hooks.photoLoaded(p.id, url);
      }));
      if (active && run === epoch) hooks.render();
    } catch { if (active && run === epoch) { error = "사진 목록을 불러오지 못했어요."; hooks.render(); } }
  };
  const tray = () => {
    // The API already orders album_photos by created_at,id. Placement never reorders the library.
    const unused = new Set(unplacedAlbumPhotos(hooks.document(), stored).map(p => p.id));
    return `<section class="ae-psec apt-tray-section"><h3><span>사진 <small>${stored.length}장</small></span>${stored.length ? button("delete-all", "안 쓴 사진 지우기", deleting || !unused.size ? "disabled" : "") : ""}</h3><div class="apt-tray">${uploads.map(p => `<div class="apt-upload-tile" role="status">${p.state === "uploading" ? '<span class="ap-spinner" aria-hidden="true"></span>올리는 중…' : esc(p.message || "사진을 올리지 못했어요.")}</div>`).join("")}${stored.map(p => `<div class="apt-thumb" tabindex="0" role="button" data-tray-photo="${esc(p.id)}" aria-label="${unused.has(p.id) ? "" : "앨범에 넣은 사진 · "}사진 옮기기">${hooks.photoSrc(p.id) ? `<img src="${esc(hooks.photoSrc(p.id))}" alt="" draggable="false">` : ""}${unused.has(p.id) ? "" : `<span class="apt-placed" role="img" aria-label="앨범에 넣은 사진">${icon("check")}</span>`}${button("delete", "×", `data-photo-id="${esc(p.id)}" aria-label="사진 지우기"${deleting ? " disabled" : ""}`)}</div>`).join("")}${stored.length ? `<p>페이지의 사진 자리로 끌어서 넣어요</p>${button("choose", "키보드로 자리 고르기", 'class="apt-keyboard"')}` : ""}</div>${error ? `<p role="status">${esc(error)}</p>` : ""}</section>`;
  };
  const blockPanel = (block?: AlbumBlock) => {
    if (!block || !["gallery", "photo"].includes(block.kind)) return "";
    const gallery = block.kind === "gallery", defaults = albumGalleryLayout(block);
    const columns = gallery ? [[2, "2"], [3, "3"], [4, "4"]] as const : [[3, "작게"], [2, "중간"], [1, "크게"]] as const;
    const shapes = gallery ? SHAPES.filter(([shape]) => shape !== "original") : [["auto", "자동"], ...SHAPES];
    return `<section class="ae-psec apt-size"><h3>사진 묶음</h3><div><span>${gallery ? "열" : "크기"}</span><span class="apt-seg">${columns.map(([n, label]) => button("columns", label, `data-block-id="${esc(block.id)}" data-value="${n}" aria-pressed="${(gallery ? defaults.columns : block.photoColumns ?? 2) === n}"`)).join("")}</span></div><div><span>모양</span><span class="apt-seg">${shapes.map(([value, label]) => button("shape", label!, `data-block-id="${esc(block.id)}" data-value="${value}" aria-pressed="${(gallery ? defaults.shape : block.photoShape ?? "auto") === value}"`)).join("")}</span></div></section>`;
  };
  const endMode = (apply: boolean) => {
    const m = mode; if (!m) return; mode = undefined;
    for (const id of fingers.keys()) if (m.frame.hasPointerCapture(id)) m.frame.releasePointerCapture(id);
    fingers.clear(); gesture = undefined;
    // Restore this placement directly. The dashboard deliberately skips identical HTML strings;
    // rerendering the unchanged document cannot undo temporary DOM edits in that host path.
    m.figure.querySelector(".apt-fitbar")?.remove(); m.frame.classList.remove("apt-fitting");
    if (m.frameStyle === null) m.frame.removeAttribute("style"); else m.frame.setAttribute("style", m.frameStyle);
    if (m.imageStyle === null) m.image.removeAttribute("style"); else m.image.setAttribute("style", m.imageStyle);
    if (m.shape === null) m.frame.removeAttribute("data-fit-shape"); else m.frame.dataset.fitShape = m.shape;
    if (apply) {
      const next = structuredClone(hooks.document());
      if (m.cover) next.coverFocus = { ...m.fit };
      else { const item = albumPhotoItems(next.blocks.find(b => b.id === m.blockId)?.items ?? []).find(i => i.id === m.itemId); const ref = item?.photos[m.index]; if (ref) { ref.fit = { ...m.fit }; ref.width = m.width; ref.height = m.height; delete ref.crop; } }
      hooks.apply(next);
    } else if (m.trigger.isConnected) m.trigger.focus({ preventScroll: true });
  };
  const paintFit = () => {
    const m = mode; if (!m) return;
    const ratio = albumPhotoRatio(m.fit.shape, m.sourceRatio);
    m.frame.style.aspectRatio = String(ratio); m.frame.style.setProperty("--apt-fit-ratio", String(ratio)); m.frame.dataset.fitShape = m.fit.shape;
    m.image.style.cssText = `width:100%;height:100%;max-width:none;max-height:none;object-fit:cover;object-position:${m.fit.x}% ${m.fit.y}%;transform:scale(${m.fit.zoom});transform-origin:${m.fit.x}% ${m.fit.y}%`;
    const slider = m.figure.querySelector<HTMLInputElement>("[data-fit-zoom]"); if (slider) slider.value = String(m.fit.zoom);
    const label = m.figure.querySelector<HTMLElement>(".apt-zoom-value"); if (label) label.textContent = `${m.fit.zoom.toFixed(1)}×`;
    m.figure.querySelectorAll<HTMLElement>('[data-photo-tool="fit-shape"]').forEach(n => n.setAttribute("aria-pressed", String(n.dataset.value === m.fit.shape)));
  };
  const startMode = (n: HTMLElement) => {
    if (mode) endMode(false);
    const figure = n.closest<HTMLElement>(".alb-photo") ?? host().querySelector<HTMLElement>('.rd-cover .alb-photo');
    const frame = figure?.querySelector<HTMLElement>(".alb-photo-frame"), image = frame?.querySelector<HTMLImageElement>("img"); if (!frame || !image?.naturalWidth) return;
    const blockId = figure!.closest<HTMLElement>("[data-album-block]")?.dataset.albumBlock ?? "", itemId = figure!.closest<HTMLElement>("[data-album-item]")?.dataset.albumItem ?? "";
    const index = Number((n.dataset.albumPhotoField ?? "").split(".")[1] ?? 0), cover = Boolean(figure!.closest(".rd-cover"));
    const block = hooks.document().blocks.find(b => b.id === blockId);
    const ref = albumPhotoItems(block?.items ?? []).find(i => i.id === itemId)?.photos[index];
    const source = stored.find(p => p.id === (cover ? hooks.document().coverPhotoId : ref?.photoId));
    const width = source?.width ?? image.naturalWidth, height = source?.height ?? image.naturalHeight;
    const initial = albumDefaultFit((frame.dataset.fitShape || "original") as AlbumPhotoShape);
    mode = { cover, frame, figure: figure!, image, blockId, itemId, index, fit: cover ? { ...initial, ...hooks.document().coverFocus } : { ...initial, ...ref?.fit }, sourceRatio: width / height, width, height, frameStyle: frame.getAttribute("style"), imageStyle: image.getAttribute("style"), shape: frame.getAttribute("data-fit-shape"), trigger: n };
    if (block?.kind === "gallery") mode.fit.shape = albumGalleryLayout(block).shape;
    frame.classList.add("apt-fitting");
    figure!.querySelector(".alb-photo-image")!.insertAdjacentHTML("afterend", `<div class="apt-fitbar" role="group" aria-label="사진 맞추기"><div class="apt-fit-shapes">${(block?.kind === "gallery" ? [] : SHAPES).map(([shape, text]) => button("fit-shape", text, `data-value="${shape}"`)).join("")}</div><div class="apt-fit-controls"><label><span class="apt-zoom-value">1.0×</span><input type="range" min="1" max="3" step=".01" value="1" data-fit-zoom aria-label="사진 확대"></label>${button("fit-cancel", "취소")}${button("fit-done", "완료", 'class="apt-ok"')}</div></div>`);
    paintFit(); figure!.scrollIntoView({ block: "center" });
  };
  const deleteStored = async (id?: string) => {
    if (deleting) return;
    const run = epoch, albumId = hooks.document().id;
    const photos = id ? stored.filter(p => p.id === id) : unplacedAlbumPhotos(hooks.document(), stored); if (!photos.length) return;
    const placed = id && !unplacedAlbumPhotos(hooks.document(), photos).length;
    deleting = true; error = ""; hooks.render();
    try {
      if (!await albumConfirm(root, "사진 지우기", `${placed ? "이 사진을 앨범에서 사용한 모든 자리에서도 빼요." : id ? "이 사진을 지워요." : `안 쓴 사진 ${photos.length}장을 지워요.`} 저장된 파일이 삭제되며 되돌릴 수 없어요.`)) return;
      if (!active || run !== epoch) return;
      if (id && !unplacedAlbumPhotos(hooks.document(), photos).length) hooks.apply(removeAlbumPhotoReferences(hooks.document(), id));
      if (!await hooks.flush()) { error = "앨범을 먼저 저장해 주세요."; return; }
      for (const photo of photos) {
        if (!active || run !== epoch) return;
        if (!unplacedAlbumPhotos(hooks.document(), [photo]).length) { if (id) error = "사진이 다시 사용되고 있어요. 다시 시도해 주세요."; continue; }
        await api.removePhoto(albumId, photo.id);
        if (!active || run !== epoch) return;
        stored = stored.filter(p => p.id !== photo.id); hooks.forgotten(photo.id);
      }
    }
    catch { error = "일부 사진을 지우지 못했어요. 다시 시도해 주세요."; }
    finally { deleting = false; if (active && run === epoch) hooks.render(); }
  };
  root.addEventListener("click", e => {
    if (active && mode && (e.target as HTMLElement).closest(".apt-fitting") && !(e.target as HTMLElement).closest("[data-photo-tool]")) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    const n = (e.target as HTMLElement).closest<HTMLElement>('[data-photo-tool],[data-album-action="fit-photo"]'); if (!active || !n) return;
    e.preventDefault(); e.stopImmediatePropagation(); const a = n.dataset.photoTool ?? n.dataset.albumAction;
    if (a === "delete" || a === "delete-all") { void deleteStored(a === "delete" ? n.dataset.photoId : undefined); return; }
    if (a === "choose") { hooks.choose(); return; }
    if (a === "fit-photo") { startMode(n); return; }
    if (a === "fit-cancel" || a === "fit-done") { endMode(a === "fit-done"); return; }
    if (a === "fit-shape" && mode) { mode.fit.shape = n.dataset.value as AlbumPhotoShape; paintFit(); mode.figure.scrollIntoView({ block: "center" }); return; }
    if (a === "columns" || a === "shape") { hooks.apply({ ...hooks.document(), blocks: hooks.document().blocks.map(b => b.id === n.dataset.blockId ? { ...b, ...(a === "columns" ? { photoColumns: Number(n.dataset.value) as 1 | 2 | 3 | 4 } : { photoShape: n.dataset.value === "auto" ? undefined : n.dataset.value as AlbumPhotoShape }) } : b) }); }
  });
  const dropTarget = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('.rd-cover .alb-photo-frame,.alb-photo-slot,.xp-slot,.rd-scene[data-album-item],.rd-chapter[data-album-item],.alb-block--gallery,.alb-block--photo');
  const lift = () => {
    const p = pointer; if (!p?.photoId || p.ghost) return;
    const ghost = document.createElement("div"); ghost.className = "apt-ghost"; ghost.innerHTML = `<img src="${esc(hooks.photoSrc(p.photoId))}" alt="">`; host().append(ghost); if (p.grip.closest(".ae-overlay")) { host().classList.add("apt-drag-from-sheet"); host().querySelector<HTMLElement>(".ae-base")!.inert = false; } p.ghost = ghost; p.grip.classList.add("apt-lifted");
    host().querySelectorAll('.rd-cover .alb-photo-frame,.alb-photo-slot,.xp-slot,.rd-scene[data-album-item],.rd-chapter[data-album-item],.alb-block--gallery,.alb-block--photo').forEach(n => n.classList.add("apt-drop-ready"));
    ghost.style.left = `${p.x + 12}px`; ghost.style.top = `${p.y - 40}px`;
  };
  const finish = (apply: boolean) => {
    const p = pointer; if (!p) return; pointer = undefined; clearTimeout(p.timer);
    p.ghost?.remove(); if (host()?.classList.contains("apt-drag-from-sheet")) { host().classList.remove("apt-drag-from-sheet"); host().querySelector<HTMLElement>(".ae-base")!.inert = true; } p.grip.classList.remove("apt-lifted"); host()?.querySelectorAll(".apt-drop-ready,.apt-drop-hover").forEach(n => n.classList.remove("apt-drop-ready", "apt-drop-hover"));
    if (apply && p.ghost && p.target && p.photoId) {
      const n = p.target, d = hooks.document();
      if (n.closest(".rd-cover")) hooks.apply({ ...d, coverPhotoId: p.photoId });
      else {
        const item = n.closest<HTMLElement>("[data-album-item]"), block = n.closest<HTMLElement>("[data-album-block]");
        hooks.apply(placeAlbumPhotos(d, [{ photoId: p.photoId, width: stored.find(row => row.id === p.photoId)?.width, height: stored.find(row => row.id === p.photoId)?.height, ...(item ? { sceneId: item.dataset.albumItem } : { blockId: block?.dataset.albumBlock }) }]));
      }
    }
    if (p.grip.hasPointerCapture(p.id)) p.grip.releasePointerCapture(p.id);
  };
  root.addEventListener("input", e => { const n = e.target as HTMLInputElement; if (mode && n.hasAttribute("data-fit-zoom")) { mode.fit = zoomAlbumPhotoFit(mode.fit, Number(n.value)); paintFit(); } });
  root.addEventListener("wheel", e => { if (!mode || !(e.target as HTMLElement).closest(".apt-fitting")) return; e.preventDefault(); e.stopPropagation(); mode.fit = zoomAlbumPhotoFit(mode.fit, mode.fit.zoom * Math.exp(-e.deltaY * .0015)); paintFit(); }, { passive: false });
  root.addEventListener("pointerdown", e => {
    if (!mode || !(e.target as HTMLElement).closest(".apt-fitting") || e.button !== 0) return;
    e.preventDefault(); mode.frame.setPointerCapture(e.pointerId); fingers.set(e.pointerId, { x: e.clientX, y: e.clientY }); beginGesture();
  });
  root.addEventListener("pointermove", e => {
    if (!mode || !gesture || !fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY }); const points = [...fingers.values()]; const r = mode.frame.getBoundingClientRect();
    mode.fit = points[1] && gesture.distance > 0 ? zoomAlbumPhotoFit(gesture.fit, gesture.fit.zoom * Math.hypot(points[0]!.x - points[1].x, points[0]!.y - points[1].y) / gesture.distance) : panAlbumPhotoFit(gesture.fit, e.clientX - gesture.x, e.clientY - gesture.y, r.width, r.height, mode.sourceRatio);
    paintFit();
  });
  const liftFinger = (e: PointerEvent) => { if (!fingers.delete(e.pointerId)) return; if (mode?.frame.hasPointerCapture(e.pointerId)) mode.frame.releasePointerCapture(e.pointerId); beginGesture(); };
  root.addEventListener("pointerup", liftFinger); root.addEventListener("pointercancel", liftFinger); root.addEventListener("lostpointercapture", liftFinger);
  root.addEventListener("pointerdown", e => {
    if (!active || e.button !== 0 || (e.target as HTMLElement).closest("button,input")) return;
    const n = (e.target as HTMLElement).closest<HTMLElement>("[data-tray-photo]"); if (!n) return;
    n.setPointerCapture(e.pointerId); pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, grip: n, photoId: n.dataset.trayPhoto,  };
    if (e.pointerType === "touch" && pointer.photoId) pointer.timer = setTimeout(lift, 350);
    else e.preventDefault();
  });
  root.addEventListener("pointermove", e => {
    const p = pointer; if (!p || p.id !== e.pointerId) return; p.x = e.clientX; p.y = e.clientY;
    const dx = p.x - p.startX, dy = p.y - p.startY;
    if (p.photoId) {
      if (!p.ghost && Math.hypot(dx, dy) > 4) { if (e.pointerType === "touch") { clearTimeout(p.timer); return; } lift(); }
      if (!p.ghost) return; e.preventDefault(); p.ghost.style.left = `${p.x + 12}px`; p.ghost.style.top = `${p.y - 40}px`;
      p.target?.classList.remove("apt-drop-hover"); p.target = dropTarget(p.x, p.y) ?? undefined; p.target?.classList.add("apt-drop-hover");
    }
  });
  root.addEventListener("pointerup", e => { if (pointer?.id === e.pointerId) finish(true); });
  root.addEventListener("pointercancel", e => { if (pointer?.id === e.pointerId) finish(false); });
  root.addEventListener("lostpointercapture", e => { if (pointer?.id === e.pointerId) finish(false); });
  root.addEventListener("keydown", e => { if (!active) return; if (e.key === "Escape" && (mode || pointer)) { e.preventDefault(); e.stopImmediatePropagation(); finish(false); endMode(false); } if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).matches("[data-tray-photo]")) { e.preventDefault(); hooks.choose(); } }, true);
  return { tray, blockPanel, refresh, get uploads() { return uploads; }, setUploads(next: AlbumPhotoUploadFeedback[]) { uploads = next; if (active) hooks.render(); }, get stored() { return stored; }, get editing() { return Boolean(mode); }, open: () => { active = true; void refresh(); }, close: () => { finish(false); endMode(false); uploads = []; active = false; epoch++; stored = []; }, hydrate: () => { if (mode && !mode.frame.isConnected) { mode = undefined; fingers.clear(); gesture = undefined; } } };
}

export const ALBUM_PHOTO_TOOLS_CSS = `
.apt-upload-tile{display:flex;align-items:center;justify-content:center;gap:6px;aspect-ratio:1;border:1px dashed var(--rule);border-radius:8px;background:var(--screen-3);color:var(--ink-2);font:500 12px/1.5 var(--sans);padding:8px;text-align:center}.apt-upload-tile .ap-spinner{width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:ap-spin .8s linear infinite}
.apt-tray{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.apt-thumb{position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;cursor:grab;background:var(--screen-3);touch-action:none}.apt-thumb img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}.apt-lifted{opacity:.35}
.apt-placed{position:absolute;left:4px;bottom:4px;width:18px;height:18px;display:grid;place-items:center;border-radius:50%;background:#111214ba;color:#fff;pointer-events:none}.album-edit .apt-placed .i{width:12px;height:12px}
.apt-tray p{grid-column:1/-1;margin:4px 0 0;font-size:12px;color:var(--ink-3)}.album-edit .apt-tray .apt-keyboard{grid-column:1/-1;justify-self:start;font-size:12px;font-weight:600;color:var(--accent-text,var(--ae-accent));padding:0;min-height:32px}
.album-edit .apt-thumb button{position:absolute;right:4px;top:4px;min-width:20px;min-height:20px;width:20px;height:20px;padding:0;border-radius:50%;background:#111214d9;color:#fff;opacity:0}.apt-thumb:hover button,.apt-thumb:focus-within button{opacity:1}.album-edit .apt-tray-section h3>button{font:500 12px var(--sans);color:var(--ink-3);padding:0;min-height:20px}
.apt-size>div{display:flex;align-items:center;justify-content:space-between;height:34px;gap:8px}.apt-seg{display:inline-flex;padding:2px;border-radius:9px;background:var(--screen-3)}.album-edit .apt-seg button{height:28px;min-height:28px;min-width:0;padding:0 10px;border-radius:7px;font-size:12.5px;font-weight:600;color:var(--ink-2)}.album-edit .apt-seg button[aria-pressed=true]{background:var(--screen);color:var(--ink);box-shadow:0 1px 3px #0002}
.apt-ghost{position:fixed;width:86px;aspect-ratio:1;border-radius:8px;overflow:hidden;box-shadow:0 18px 30px -12px #0008;transform:rotate(-4deg);pointer-events:none;z-index:99;outline:2px solid #fff}.apt-ghost img{width:100%;height:100%;object-fit:cover}
.alb-album .apt-drop-ready{outline:1.5px dashed #2f6fd666;outline-offset:-2px}.alb-album .apt-drop-hover{outline:2px solid #2f6fd6;background:#2f6fd61f}.alb-album :is(.xp-slot,.alb-photo-slot).apt-drop-ready{position:relative;color:transparent}.alb-album :is(.xp-slot,.alb-photo-slot).apt-drop-ready::after{content:"여기에 놓기";color:#2f6fd6;position:absolute;inset:0;padding:12px 14px;text-align:left}
.alb-album .apt-fitting{max-width:min(100%,calc((100svh - 280px) * var(--apt-fit-ratio)));margin-inline:auto;position:relative;overflow:hidden;touch-action:none;cursor:grab;outline:2px solid #2f6fd6;outline-offset:-2px}.alb-album .apt-fitting:active{cursor:grabbing}.alb-album .alb-photo-image:has(.apt-fitting)>.ptools{display:none}
.album-edit.apt-drag-from-sheet .ae-overlay{opacity:0;pointer-events:none}.alb-album .alb-photo-cell:has(.apt-fitting){grid-column:1/-1;flex-basis:100%}
.alb-album .apt-fitbar{position:relative;z-index:6;width:fit-content;max-width:100%;margin:10px auto 0;padding:8px;border-radius:10px;background:var(--ae-pop-bg,#111214);color:var(--ae-pop-ink,#ecebe8);border:1px solid var(--ae-pop-rule,#33363c);box-shadow:0 10px 28px -12px #0006;font:500 12.5px/1.4 var(--sans)}
.apt-fit-shapes,.apt-fit-controls{display:flex;align-items:center;gap:4px;flex-wrap:wrap}.apt-fit-controls{margin-top:8px}.apt-fit-controls>label{display:flex;align-items:center;gap:8px;flex:1;min-width:120px}.apt-fit-controls input{width:100%;min-width:50px;max-width:180px;margin:0;accent-color:var(--ae-pop-accent,#dba35a);cursor:ew-resize}.apt-zoom-value{min-width:32px;font-variant-numeric:tabular-nums;white-space:nowrap}
.alb-album .apt-fitbar button:where(:not(:hover),:hover,:focus-visible,:active,:disabled){appearance:none;background:transparent;color:inherit;border:0;box-shadow:none;font:inherit;min-height:32px;padding:0 8px;border-radius:7px;cursor:pointer;white-space:nowrap}.alb-album .apt-fitbar button:hover{background:var(--ae-pop-hover,#202226)}.alb-album .apt-fitbar button[aria-pressed=true]{background:var(--ae-pop-selected,#ecebe8);color:var(--ae-pop-selected-ink,#111214)}.alb-album .apt-fitbar .apt-ok{background:var(--ae-pop-accent,#dba35a);color:var(--ae-pop-accent-ink,#1b1308);font-weight:650}.alb-album .apt-fitbar button:focus-visible,.apt-fitbar input:focus-visible{outline:2px solid var(--ae-pop-accent,#dba35a);outline-offset:2px}
@media(max-width:767px),(hover:none){.album-edit .apt-thumb button{opacity:1}}
`;
