import { copyText, MANUAL_COPY_MESSAGE } from "../clipboard.js";
import { renderScreenBar } from "./shell.js";
import { albumConfirm } from "./album-confirm.js";
import { renderBoardDialog, type BoardDialogState } from "./album-board.js";
import { renderAlbumForBoard, boardPublicUrl } from "../album/board-render.js";
import { lintBoardHtml } from "../album/board-lint.js";
import { buildPhotoZip } from "../album/board-zip.js";
import { albumUpdateAdditions, renderAlbumUpdateDialog, type AlbumUpdateState } from "./album-update.js";
import { albumVersionWhen, renderAlbumVersionBar, renderAlbumVersionList, renderAlbumVersionsDialog, type AlbumVersionsState } from "./album-versions.js";
import { createAlbumEditController, type AlbumImageHost } from "./album-edit.js";
import { albumDateFormat, applyAlbumUpdate, recommendedAlbumQuotes, isNewAlbumMaterial, type AlbumDocument, type AlbumItem } from "@rcm/shared";
import { albumClient, type AlbumHtmlExport, type AlbumPhoto } from "../album/api.js";
import { albumExportHasIntimacy, albumHtmlFilename, buildAlbumHtmlFile, estimateAlbumHtmlSizes, type AlbumHtmlQuality } from "../album/export-html.js";
import { triggerBackupDownload } from "./data-actions.js";
import { renderAlbum, type AlbumSection } from "../album/render.js";
import { escapeHtml as esc, icon } from "./film/ui.js";

export { buildAlbumJumpList, buildAlbumPhotoList, albumPhotoCaption, cycleAlbumPhoto } from "../album/view-data.js";
import { buildAlbumPhotoList, albumPhotoCaption, cycleAlbumPhoto, type AlbumViewPhoto } from "../album/view-data.js";
type ViewApi = ReturnType<typeof albumClient>;
const act = (name: string, text: string, cls = "", value = "", label = "") => `<button type="button" class="${cls}" data-album-action="${name}" data-value="${esc(value)}"${cls === "is-current" ? ' aria-current="true"' : ""}${label ? ` aria-label="${esc(label)}"` : ""}>${text}</button>`;

export function createAlbumViewController(root: HTMLElement, api: ViewApi, hooks: {
  skin: () => "film" | "phone"; host?: AlbumImageHost; render: () => void; closed: () => void; confirm: (message: string) => Promise<boolean>; toast?: (message: string) => void;
}) {
  let active = false, doc: AlbumDocument | undefined, generation = 0, loading = false, error = "", busy = false;
  let sections: AlbumSection[] = [], photos: AlbumViewPhoto[] = [], current = 0, photoIndex = 0;
  // Keep the mounted book stable across unrelated dashboard refreshes.
  let renderedHtml = "";
  let overlay: "" | "toc" | "menu" | "photo" | "export" | "board" | "update" | "versions" = "", returnFocus: HTMLElement | null = null, photoError = "";
  let photoMeta: AlbumPhoto[] = [], exportQuality: AlbumHtmlQuality = "normal", exporting = false, exportError = "", exportRun = 0;
  let exportEstimates: Record<AlbumHtmlQuality, number> | undefined;
  let exportDone: AlbumHtmlExport | undefined, exportCopied: "" | "url" | "path" = "";
  let boardState: BoardDialogState = {};
  let updateState: AlbumUpdateState = { add: [], replace: [] }, updateRun = 0;
  // A kept look on screen (past.doc) stands in for the album until the user returns or restores it.
  let past: AlbumVersionsState | undefined, pastRun = 0;
  const pastDocs = new Map<number, AlbumDocument>();
  const urls = new Map<string, string>(), full = new Map<string, string>();
  const view = () => root.querySelector<HTMLElement>(".album-view");
  const phone = () => (view()?.clientWidth ?? window.innerWidth) <= 640;
  const shellInert = (value: boolean) => root.querySelectorAll<HTMLElement>(":scope > .nav,:scope > .topbar").forEach(n => { n.inert = value; });
  const clear = () => { past = undefined; pastRun++; pastDocs.clear(); updateRun++; updateState = { add: [], replace: [] }; exportRun++; exporting = false; exportEstimates = undefined; editor.clear(); shellInert(false); generation++; if (doc) api.closeAlbum(doc.id); doc = undefined; photoMeta = []; sections = []; photos = []; renderedHtml = ""; active = false; overlay = ""; urls.clear(); full.clear(); };
  const currentLabel = () => sections[current]?.label ?? "표지";
  const toc = () => `<ol class="av-toc">${sections.map((s, i) => `<li>${act("album-jump", `<i>${s.number}</i><span>${esc(s.label)}</span>`, i === current ? "is-current" : "", s.id)}</li>`).join("")}</ol>`;
  const overlayHtml = () => {
    if (!overlay) return "";
    if (overlay === "update" && doc) return `<div class="au-screen">${renderScreenBar(act("album-overlay-close", icon("back") + "<span>추억</span>", "av-back") + `<div class="av-title"><b>${esc(doc.title)}</b><small>${esc(albumDateFormat(doc.periodLabel).header)}</small></div>`, "av-head")}${renderAlbumUpdateDialog(doc, updateState)}</div>`;
    if (overlay === "versions") return past?.doc ? renderAlbumVersionList(past, doc?.title ?? "") : renderAlbumVersionsDialog(past);
    if (overlay === "board" && doc) return renderBoardDialog(doc, photoMeta, boardState);
    if (overlay === "export" && doc) {
      if (exportDone) return `<div class="av-scrim av-export-scrim" data-album-action="album-overlay-close"></div><section class="av-pop av-export av-export-done" role="dialog" aria-modal="true" aria-labelledby="album-export-title"><div class="av-pop-head"><h3 id="album-export-title">HTML 파일로 저장</h3>${act("album-overlay-close", icon("close"), "av-icon", "", "닫기")}</div><div class="av-export-result"><span class="av-export-check" aria-hidden="true">✓</span><div><b>파일을 만들었어요</b><small>${esc(exportDone.name)} · ${(exportDone.bytes / 1_000_000).toFixed(1)}MB</small></div></div><div class="av-export-link"><input readonly aria-label="HTML 파일 링크" value="${esc(exportDone.url)}">${act("album-export-copy-link", exportCopied === "url" ? "복사했어요" : "링크 복사", "av-export-save")}</div><p class="av-export-note">브라우저 주소창에 붙여 넣으면 열려요. 링크는 30분 동안 쓸 수 있어요.</p><div class="av-export-path"><label for="album-export-path">저장 위치</label><textarea id="album-export-path" readonly rows="2">${esc(exportDone.path)}</textarea>${act("album-export-copy-path", exportCopied === "path" ? "복사했어요" : "경로 복사")}</div>${exportError ? `<p role="status">${esc(exportError)}</p>` : ""}<div class="av-export-actions">${act("album-overlay-close", "닫기")}</div></section>`;

      const estimates = exportEstimates ??= estimateAlbumHtmlSizes(doc, photoMeta);
      const options = (["keep", "normal", "light"] as const).map((quality, i) => {
        const size = (estimates[quality] / 1_000_000).toFixed(1);
        return `<label><input type="radio" name="album-html-quality" value="${quality}"${quality === exportQuality ? " checked" : ""}${exporting ? " disabled" : ""}><span>${["원본 그대로", "보통", "가볍게"][i]} · 약 ${size} MB</span></label>`;
      }).join("");
      return `<div class="av-scrim av-export-scrim" data-album-action="album-overlay-close"></div><div class="av-pop av-export" role="dialog" aria-modal="true" aria-labelledby="album-export-title" aria-busy="${exporting}"><h3 id="album-export-title">HTML 파일로 저장</h3><fieldset${exporting ? " disabled" : ""}><legend class="av-sr-only">사진 화질</legend>${options}</fieldset>${albumExportHasIntimacy(doc) ? '<p class="av-export-note">가까워진 순간 블록이 들어 있어요. 파일을 다른 사람과 나눌 때 확인해 주세요.</p>' : ""}${exportError ? `<p role="alert">${esc(exportError)}</p>` : ""}<div class="av-export-actions">${act("album-overlay-close", "취소")}${act("album-export-save", exporting ? "만드는 중…" : "만들기", "av-export-save")}</div></div>`;
    }
    if (overlay === "photo") {
      const p = photos[photoIndex]; if (!p) return "";
      const caption = albumPhotoCaption(p, doc?.title ?? "");
      const src = full.get(p.photoId) || urls.get(p.photoId) || "";
      return `<div class="av-lightbox" role="dialog" aria-modal="true" aria-label="사진 크게 보기"><div class="av-lb-top"><span aria-live="polite">${photoIndex + 1} / ${photos.length}</span>${act("album-photo-close", icon("close"), "av-icon", "", "사진 닫기")}</div><div class="av-stage">${src ? `<img src="${esc(src)}" alt="${esc(p.caption || p.title)}">` : `<p role="status">${photoError || "사진 불러오는 중…"}</p>`}${act("album-photo-prev", icon("back"), "av-arrow av-prev", "", "이전 사진")}${act("album-photo-next", icon("chevron"), "av-arrow av-next", "", "다음 사진")}</div><div class="av-lb-bottom"><div class="av-caption">${caption.map((line, i) => i ? `<small>${esc(line)}</small>` : `<p>${esc(line)}</p>`).join("")}${photoError ? `<small role="status">${photoError}</small>` : ""}</div><div class="av-thumbs">${photos.map((p, i) => act("album-photo-select", urls.has(p.photoId) ? `<img src="${esc(urls.get(p.photoId)!)}" alt="">` : String(i + 1), i === photoIndex ? "is-current" : "", String(i), `${i + 1}번 사진`)).join("")}</div><div class="av-dots" aria-hidden="true">${photos.length <= 12 ? photos.map((_, i) => `<i class="${i === photoIndex ? "is-current" : ""}"></i>`).join("") : ""}</div></div></div>`;
    }
    return `<div class="av-scrim" data-album-action="album-overlay-close"></div><div class="av-pop av-pop--${overlay}" role="dialog" aria-modal="true" aria-label="${overlay === "toc" ? "목차" : "앨범 메뉴"}"><div class="av-pop-head"><h3>${overlay === "toc" ? "목차" : "앨범 메뉴"}</h3>${act("album-overlay-close", icon("close"), "av-icon", "", "닫기")}</div>${overlay === "toc" ? toc() : `<div class="av-menu">${act("update-album", icon("refresh") + "새 기억으로 업데이트")}${act("album-versions", icon("clock") + "버전 기록")}${act("duplicate-album", icon("copy") + "복제")}${act("export-album-html", icon("download") + "HTML 파일로 저장")}<hr>${act("delete-album", icon("delete") + "지우기", "av-danger")}</div>`}</div>`;
  };
  const paintOverlay = (focus = false) => {
    const slot = view()?.querySelector<HTMLElement>(".av-overlay"); if (!slot) return;
    const focused = document.activeElement as HTMLElement | null;
    const action = slot.contains(focused) ? focused?.dataset.albumAction : undefined;
    const value = focused?.dataset.value;
    const oldThumbScroll = slot.querySelector<HTMLElement>(".av-thumbs")?.scrollLeft ?? 0;
    const updateScroll = slot.querySelector(".au-body")?.scrollTop ?? 0;
    const openDetails = [...slot.querySelectorAll<HTMLElement>("details[open][data-update-detail]")].map(n => n.dataset.updateDetail);
    const folds = new Map([...slot.querySelectorAll<HTMLDetailsElement>("details[data-wiz-fold]")].map(n => [n.dataset.wizFold, n.open]));
    const updateInput = focused?.dataset.updateAdd ? ["add", focused.dataset.updateAdd] : focused?.dataset.updateReplace ? ["replace", focused.dataset.updateReplace] : undefined;
    slot.innerHTML = overlayHtml();
    const body = slot.querySelector(".au-body"); if (body) body.scrollTop = updateScroll;
    slot.querySelectorAll<HTMLDetailsElement>("details[data-update-detail]").forEach(n => { n.open = openDetails.includes(n.dataset.updateDetail); });
    slot.querySelectorAll<HTMLDetailsElement>("details[data-wiz-fold]").forEach(n => { if (folds.has(n.dataset.wizFold)) n.open = folds.get(n.dataset.wizFold)!; });
    const strip = slot.querySelector<HTMLElement>(".av-thumbs"), thumb = strip?.querySelector<HTMLElement>(".is-current");
    if (strip && thumb && strip.clientWidth) {
      strip.scrollLeft = oldThumbScroll;
      const bounds = strip.getBoundingClientRect(), selected = thumb.getBoundingClientRect();
      if (selected.left < bounds.left + 6) strip.scrollLeft += selected.left - bounds.left - 6;
      else if (selected.right > bounds.right - 6) strip.scrollLeft += selected.right - bounds.right + 6;
    }
    shellInert(Boolean(overlay));
    const base = view()?.querySelector<HTMLElement>(".av-base,.ae-base"); if (base) base.inert = Boolean(overlay);
    view()?.querySelectorAll('[data-album-action="album-toc"],[data-album-action="album-view-menu"]').forEach(n => n.setAttribute("aria-expanded", String(overlay === (n.getAttribute("data-album-action") === "album-toc" ? "toc" : "menu"))));
    if (focus) (slot.querySelector<HTMLElement>('.avh-row[aria-current="true"]') ?? [...slot.querySelectorAll<HTMLElement>('input:checked,button')].find(n => n.getClientRects().length && !n.closest('details:not([open])') && !n.matches(':disabled')))?.focus();
    else if (focused?.matches('input[name="album-html-quality"]')) slot.querySelector<HTMLElement>('input:checked')?.focus({ preventScroll: true });
    else if (updateInput) slot.querySelector<HTMLElement>(`[data-update-${updateInput[0]}="${CSS.escape(updateInput[1]!)}"]`)?.focus({ preventScroll: true });
    else if (action) slot.querySelector<HTMLElement>(`:is(button,input,summary)[data-album-action="${CSS.escape(action)}"]${value === undefined ? "" : `[data-value="${CSS.escape(value)}"]`}`)?.focus({ preventScroll: true });
  };
  const closeOverlay = () => {
    if (overlay === "update" && updateState.saving) return;
    if (overlay === "update") updateState = { add: [], replace: [] };
    if (overlay === "versions" && !past?.doc) { past = undefined; pastRun++; }
    updateRun++;
    exportRun++; exporting = false; overlay = ""; paintOverlay(); paintBar();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else view()?.querySelector<HTMLElement>(phone() ? ".av-pill" : ".av-toc-trigger")?.focus({ preventScroll: true });
  };
  const showOverlay = (kind: typeof overlay, trigger: HTMLElement) => { returnFocus = trigger; overlay = kind; paintOverlay(true); };
  const showUpdate = async (trigger: HTMLElement) => {
    if (!doc) return;
    const id = doc.id, epoch = generation, run = ++updateRun;
    updateState = { add: [], replace: [], remove: [], quotePicks: {} }; showOverlay("update", trigger);
    try {
      const { candidates, materials } = await api.update(id);
      if (epoch === generation && run === updateRun) {
        updateState.candidates = candidates; updateState.materials = materials;
        const additions = albumUpdateAdditions(doc, updateState); updateState.sourceAdditions = additions;
        updateState.add = additions.filter(c => c.blockKind === "story" && c.item.origin?.kind !== "dialogue" && isNewAlbumMaterial(doc!, c.item)).map(c => c.item.id);
        for (const candidate of additions) if (candidate.blockKind === "story") (updateState.quotePicks ??= {})[candidate.item.id] = recommendedAlbumQuotes(candidate.item.children ?? []).slice(0, 1).map(q => q.id);
        updateState.replace = candidates.changed.filter(c => !c.userEdited).map(c => c.itemId);
      }
    }
    catch { if (epoch === generation && run === updateRun) updateState.error = "새 기억을 불러오지 못했어요."; }
    if (epoch === generation && run === updateRun && overlay === "update") paintOverlay();
  };
  const paintUpdateRows = () => {
    const body = view()?.querySelector<HTMLElement>(".au-body"); if (!body || !doc) return;
    const focused = document.activeElement as HTMLInputElement | null;
    const key = ["data-update-add", "data-update-existing", "data-update-quote"].find(key => focused?.hasAttribute(key));
    const id = key && focused?.getAttribute(key), scroll = body.scrollTop;
    const folds = new Map([...body.querySelectorAll<HTMLDetailsElement>("details[data-wiz-fold]")].map(n => [n.dataset.wizFold, n.open]));
    const template = document.createElement("template"); template.innerHTML = renderAlbumUpdateDialog(doc, updateState);
    body.replaceChildren(...template.content.querySelector(".au-body")!.childNodes);
    body.querySelectorAll<HTMLDetailsElement>("details[data-wiz-fold]").forEach(n => { if (folds.has(n.dataset.wizFold)) n.open = folds.get(n.dataset.wizFold)!; });
    body.scrollTop = scroll;
    const foot = view()?.querySelector(".au-foot"), nextFoot = template.content.querySelector(".au-foot"); if (foot && nextFoot) foot.replaceChildren(...nextFoot.childNodes);
    view()?.querySelectorAll<HTMLElement>(".au-filter button").forEach(n => n.setAttribute("aria-pressed", String(Boolean(updateState.all) === (n.dataset.albumAction === "album-update-full"))));
    if (key && id) body.querySelector<HTMLElement>(`[${key}="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  };
  const showExport = async (trigger: HTMLElement) => {
    if (!doc) return;
    exportQuality = "normal"; exportError = ""; exportDone = undefined; exportCopied = "";
    exportEstimates = undefined;
    showOverlay("export", trigger);
    const epoch = generation;
    try { const loaded = await api.photos(doc.id); if (epoch === generation && overlay === "export") {
      if (JSON.stringify(photoMeta) !== JSON.stringify(loaded.photos)) { photoMeta = loaded.photos; exportEstimates = undefined; paintOverlay(); }
    } } catch { /* Stored estimates remain usable; the build reports read failures. */ }
  };
  const loadFull = async () => {
    const p = photos[photoIndex]; if (!p || !doc) return;
    const epoch = generation; photoError = "";
    try { const url = await api.loadPhoto(doc.id, p.photoId, "full"); if (epoch !== generation) return; full.set(p.photoId, url); }
    catch { if (epoch !== generation || photos[photoIndex]?.photoId !== p.photoId) return; photoError = "원본 사진을 불러오지 못했어요."; }
    if (overlay === "photo" && photos[photoIndex]?.photoId === p.photoId) paintOverlay();
  };
  const stepPhoto = (delta: number) => { photoIndex = cycleAlbumPhoto(photoIndex, delta, photos.length); photoError = ""; paintOverlay(); void loadFull(); };
  const spy = () => {
    const host = view(), scroll = host?.querySelector<HTMLElement>(".av-scroll"); if (!scroll || !sections.length) return;
    const top = scroll.getBoundingClientRect().top + 24;
    let next = 0;
    sections.forEach((s, i) => { const node = document.getElementById(s.id); if (node && node.getBoundingClientRect().top <= top) next = i; });
    if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2) next = sections.length - 1;
    current = next;
    host!.querySelectorAll(".av-current").forEach(n => { n.textContent = currentLabel(); });
    host!.querySelectorAll(".av-number").forEach(n => { n.textContent = sections[current]!.number; });
    host!.querySelectorAll<HTMLElement>('[data-album-action="album-jump"]').forEach(n => { const yes = n.dataset.value === sections[current]!.id; n.classList.toggle("is-current", yes); if (yes) n.setAttribute("aria-current", "location"); else n.removeAttribute("aria-current"); });
  };
  const hydrate = () => { if (!active) return; if (editor.active) { editor.hydrate(); paintOverlay(); return; } spy(); paintOverlay(); };
  const repaint = () => { renderedHtml = ""; hooks.render(); hydrate(); };
  const loadThumbs = async (id: string, target: AlbumDocument, epoch: number) => {
    const ids = new Set<string>();
    [target.coverPhotoId, target.people.me.photoId, target.people.partner.photoId].forEach(id => { if (id) ids.add(id); });
    const visit = (items: AlbumItem[]) => items.forEach(i => { if (!i.hidden) { i.photos.forEach(p => ids.add(p.photoId)); visit(i.children ?? []); } });
    target.blocks.filter(b => !b.hidden).forEach(b => visit(b.items));
    await Promise.allSettled([...ids].filter(photoId => !urls.has(photoId)).map(async photoId => { const url = await api.loadPhoto(id, photoId, "thumb"); if (epoch === generation) urls.set(photoId, url); }));
  };
  const menuTrigger = () => view()?.querySelector<HTMLElement>('[data-album-action="album-view-menu"]');
  const focusBar = (action = "album-version-list", value?: string) => {
    const bar = view()?.querySelector<HTMLElement>(".avh-bar");
    (bar?.querySelector<HTMLElement>(`[data-album-action="${CSS.escape(action)}"]${value === undefined ? "" : `[data-value="${CSS.escape(value)}"]`}:not(:disabled)`) ?? bar?.querySelector<HTMLElement>(".avh-when"))?.focus({ preventScroll: true });
  };
  const paintBar = () => {
    const bar = view()?.querySelector<HTMLElement>(".avh-bar"); if (!bar || !past) return;
    const focused = bar.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset : undefined;
    bar.outerHTML = renderAlbumVersionBar(past, overlay === "versions");
    if (focused) focusBar(focused.albumAction, focused.value);
  };
  const showVersion = async (index: number) => {
    const state = past, row = state?.list?.[index]; if (!doc || !state || !row) return;
    const id = doc.id, epoch = generation, run = ++pastRun;
    const live = () => epoch === generation && run === pastRun && past === state;
    state.index = index; state.error = ""; state.loading = true; paintBar();
    try {
      let version = pastDocs.get(row.revision);
      if (!version) { version = (await api.version(id, row.revision)).document; if (!live()) return; pastDocs.set(row.revision, version); }
      await loadThumbs(id, version, epoch); if (!live()) return;
      state.doc = version; photos = buildAlbumPhotoList(version);
    } catch { if (!live()) return; state.error = "이 모습을 불러오지 못했어요."; }
    state.loading = false;
    if (!state.doc) { paintOverlay(true); return; }
    // Keep the reading position so the same spot can be compared across looks.
    const focused = (document.activeElement as HTMLElement | null)?.dataset, top = view()?.querySelector(".av-scroll")?.scrollTop ?? 0;
    if (overlay === "versions") overlay = "";
    repaint();
    const scroll = view()?.querySelector(".av-scroll"); if (scroll) scroll.scrollTop = top;
    focusBar(focused?.albumAction, focused?.value);
  };
  const openVersions = async (trigger: HTMLElement) => {
    if (!doc) return;
    const id = doc.id, epoch = generation, run = ++pastRun, state: AlbumVersionsState = { index: 0, loading: true };
    past = state; showOverlay("versions", trigger);
    const live = () => epoch === generation && run === pastRun && past === state;
    try { const { versions } = await api.versions(id); if (!live()) return; state.list = versions; }
    catch { if (!live()) return; state.error = "버전 기록을 불러오지 못했어요."; }
    if (state.list?.length) { await showVersion(0); return; }
    state.loading = false; paintOverlay(true);
  };
  const exitPast = () => {
    if (!past) return;
    past = undefined; pastRun++; overlay = ""; photos = doc ? buildAlbumPhotoList(doc) : [];
    repaint(); menuTrigger()?.focus({ preventScroll: true });
  };
  const openAlbumView = async (id: string) => {
    clear(); active = true; loading = true; error = ""; current = 0; const epoch = generation; repaint();
    try {
      const loaded = await api.get(id); if (epoch !== generation) return; doc = loaded.document; photoMeta = loaded.photos ?? [];
      await loadThumbs(id, doc, epoch);
      if (epoch !== generation) return;
      photos = buildAlbumPhotoList(doc);
    } catch { if (epoch === generation) error = "앨범을 불러오지 못했어요."; }
    finally { if (epoch === generation) { loading = false; repaint(); view()?.querySelector<HTMLElement>(".av-back")?.focus(); } }
  };
  const editor = createAlbumEditController(root, api, {
    skin: hooks.skin, host: hooks.host, photoSrc: id => urls.get(id) ?? "", photoLoaded: (id, url) => urls.set(id, url),
    render: () => { renderedHtml = ""; hooks.render(); },
    done: saved => { doc = saved; photos = buildAlbumPhotoList(saved); repaint(); },
  });
  const handle = async (node: HTMLElement) => {
    if (!active || (editor.active && !node.dataset.albumAction?.startsWith("album-photo-"))) return;
    const action = node.dataset.albumAction, value = node.dataset.value ?? "";
    if (action === "album-edit" && doc) { closeOverlay(); renderedHtml = ""; await editor.open(doc); return; }
    if (action === "album-back") { clear(); hooks.closed(); return; }
    if (action === "album-toc") showOverlay("toc", node);
    if (action === "album-view-menu") showOverlay("menu", node);
    if (action === "album-versions" && doc) { closeOverlay(); await openVersions(menuTrigger() ?? node); }
    if (action === "album-versions-close") exitPast();
    if (action === "album-version-list" && past?.doc) { showOverlay("versions", node); paintBar(); }
    if (action === "album-version-step" && past?.doc && !past.restoring) await showVersion(past.index + Number(value));
    if (action === "album-version-pick" && past?.doc) { closeOverlay(); await showVersion(Number(value)); }
    if (action === "album-version-restore" && doc && past?.doc && !past.restoring && !past.loading) {
      const id = doc.id, epoch = generation, state = past, row = state.list![state.index]!;
      state.restoring = true; state.error = ""; paintBar();
      try {
        await api.restoreVersion(id, row.revision, doc.revision);
        if (epoch !== generation) return;
        await openAlbumView(id); hooks.toast?.(`${albumVersionWhen(row.createdAt)} 모습으로 되돌렸어요`);
      } catch (error) {
        if (epoch !== generation || past !== state) return;
        if ((error as { status?: number; code?: string })?.status === 409 || (error as { code?: string })?.code === "ALBUM_REVISION_CONFLICT") {
          await openAlbumView(id); hooks.toast?.("다른 기기에서 바뀌어서 앨범을 새로 불러왔어요"); return;
        }
        state.restoring = false; state.error = "되돌리지 못했어요. 다시 시도해 주세요."; paintBar();
      }
    }
    if (action === "update-album" && doc) await showUpdate(view()?.querySelector<HTMLElement>('[data-album-action="album-view-menu"]') ?? node);
    if (action === "album-update-reload" && doc) {
      if (updateState.conflict) { const id = doc.id; await openAlbumView(id); }
      if (doc) await showUpdate(view()!.querySelector<HTMLElement>('[data-album-action="album-view-menu"]')!);
    }
    if (action === "album-update-all" && updateState.candidates && !updateState.saving && !updateState.conflict) {
      const ids = updateState.candidates.added.map(c => c.item.id);
      updateState.add = ids.every(id => updateState.add.includes(id)) ? [] : ids; paintOverlay();
    }
    if ((action === "album-update-new" || action === "album-update-full") && !updateState.saving) { const all = action === "album-update-full";
      if (Boolean(updateState.all) === all) return;
      updateState.all = all;
      paintUpdateRows();
    }
    if ((action === "album-update-keep" || action === "album-update-replace") && !updateState.saving && !updateState.conflict) { updateState.replace = updateState.replace.filter(id => id !== node.dataset.value); if (action === "album-update-replace") updateState.replace.push(node.dataset.value!); paintUpdateRows(); }
    if (action === "album-update-apply" && doc && updateState.candidates && !updateState.saving && !updateState.conflict) {
      const count = updateState.add.length + updateState.replace.length + (updateState.remove?.length ?? 0); if (!count) return;
      const epoch = generation, next = applyAlbumUpdate(doc, updateState, { ...updateState.candidates, collectedAt: updateState.materials?.collectedAt ?? updateState.candidates.collectedAt, added: albumUpdateAdditions(doc, updateState) });
      updateState.saving = true; updateState.error = ""; paintOverlay();
      try {
        updateState.saving = false; closeOverlay(); renderedHtml = "";
        await editor.open(doc);
        if (epoch !== generation) return;
        if (await editor.applyUpdate(next)) hooks.toast?.(`${count}개를 반영했어요. 되돌리기로 취소할 수 있어요`);
      } catch (error) {
        if (epoch !== generation) return;
        // Keep the document and choices intact, just like the editor's autosave conflict.
        updateState.conflict = (error as { status?: number; code?: string })?.status === 409 || (error as { code?: string })?.code === "ALBUM_REVISION_CONFLICT";
        updateState.error = updateState.conflict ? "다른 기기에서 바뀌었어요" : "저장하지 못했어요. 다시 반영해 주세요.";
      } finally { if (epoch === generation) { updateState.saving = false; if (overlay === "update") paintOverlay(); } }
    }
    if (action === "export-album-html" && doc) await showExport(view()?.querySelector<HTMLElement>('[data-album-action="album-view-menu"]') ?? node);
    if (action === "copy-album-board" && doc) {
      boardState = {}; showOverlay("board", view()?.querySelector<HTMLElement>('[data-album-action="album-view-menu"]') ?? node);
    }
    if (action?.startsWith("album-board-") && doc && !boardState.busy) {
      const snapshot = doc, epoch = generation, run = exportRun;
      const current = () => epoch === generation && run === exportRun && overlay === "board";
      boardState.addressesOpen = !!view()?.querySelector<HTMLDetailsElement>(".av-board-addresses")?.open;
      if (action === "album-board-address-save") {
        const inputs = [...view()!.querySelectorAll<HTMLInputElement>("[data-board-photo]")];
        boardState.drafts = Object.fromEntries(inputs.map(input=>[input.dataset.boardPhoto!,input.value.trim()]));
        if (inputs.some(input=>input.value.trim() && !boardPublicUrl(input.value.trim()))) { boardState.error = "https:// 주소만 넣을 수 있어요"; paintOverlay(); return; }
        boardState.busy = true; boardState.error = ""; paintOverlay();
        try {
          for (const input of inputs) {
            if (!current()) return;
            const id = input.dataset.boardPhoto!, publicUrl = input.value.trim();
            if ((photoMeta.find(p=>p.id === id)?.publicUrl ?? "") === publicUrl) continue;
            const result = await api.updatePhoto(snapshot.id, id, { publicUrl: publicUrl || null });
            if (current()) photoMeta = photoMeta.map(p=>p.id === id ? result.photo : p);
          }
          if (current()) boardState.drafts = undefined;
        } catch { if (current()) boardState.error = "사진 주소를 저장하지 못했어요. 다시 시도해 주세요."; }
        finally { if (current()) { boardState.busy = false; paintOverlay(); } }
      }
      if (action === "album-board-zip") {
        boardState.busy = true; boardState.error = ""; paintOverlay();
        try {
          const bytes = await buildPhotoZip(snapshot, photoMeta, id=> { if (!current()) throw new Error("Cancelled"); return api.readPhoto(snapshot.id,id); });
          if (current()) triggerBackupDownload(new Blob([new Uint8Array(bytes)], { type: "application/zip" }), albumHtmlFilename(snapshot.title, snapshot.people).replace(/\.html$/, "-사진.zip"));
        } catch { if (current()) boardState.error = "사진을 모으지 못했어요. 다시 시도해 주세요."; }
        finally { if (current()) { boardState.busy = false; paintOverlay(); } }
      }
      if (action === "album-board-copy") {
        const html = renderAlbumForBoard(snapshot, photoMeta); if (!lintBoardHtml(html).ok) return;
        const copied = await copyText(html, () => {
          if (!current()) return;
          boardState.manual = true; paintOverlay();
          return view()?.querySelector<HTMLTextAreaElement>(".av-board-code");
        });
        if (current()) {
          if (copied) { closeOverlay(); hooks.toast?.("복사했어요. 아카라이브 편집기의 HTML 모드에 붙여 넣어 주세요."); }
          else hooks.toast?.(MANUAL_COPY_MESSAGE);
        }
      }
    }
    if ((action === "album-export-copy-link" || action === "album-export-copy-path") && exportDone) {
      const key = action === "album-export-copy-link" ? "url" : "path";
      const epoch = generation, run = exportRun;
      const current = () => epoch === generation && run === exportRun && overlay === "export";
      const copied = await copyText(exportDone[key], () => {
        if (!current()) return;
        exportCopied = ""; exportError = MANUAL_COPY_MESSAGE; paintOverlay();
        return view()?.querySelector<HTMLInputElement | HTMLTextAreaElement>(key === "url" ? ".av-export-link input" : "#album-export-path");
      });
      if (copied && current()) { exportCopied = key; exportError = ""; paintOverlay(); }
    }
    if (action === "album-export-save" && doc && !exporting) {
      const snapshot = doc, epoch = generation, run = ++exportRun;
      exporting = true; exportError = ""; paintOverlay();
      try {
        const result = await buildAlbumHtmlFile(snapshot, id => {
          if (epoch !== generation || run !== exportRun) throw new DOMException("Export cancelled", "AbortError");
          return api.readPhoto(snapshot.id, id);
        }, exportQuality, photoMeta);
        if (epoch !== generation || run !== exportRun) return;
        const stored = await api.storeHtml(snapshot.id, result.html);
        if (epoch === generation && run === exportRun && overlay === "export") exportDone = stored;
      } catch { if (epoch === generation && run === exportRun && overlay === "export") exportError = "파일을 만들지 못했어요. 사진을 불러올 수 있는지 확인해 주세요."; }
      finally { if (run === exportRun) { exporting = false; if (epoch === generation && overlay === "export") paintOverlay(true); } }
    }
    if (action === "album-overlay-close" || action === "album-photo-close") closeOverlay();
    if (action === "album-jump") {
      closeOverlay(); const target = document.getElementById(value), scroll = view()?.querySelector<HTMLElement>(".av-scroll");
      if (target && scroll) { const top = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 16; target.focus({ preventScroll: true }); scroll.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }
    }
    if (action === "album-photo-open") {
      if (editor.active && editor.document) photos = buildAlbumPhotoList(editor.document);
      const index = photos.findIndex(p => p.photoId === node.dataset.photoId); if (index < 0) return;
      photoIndex = index; photoError = ""; showOverlay("photo", node); void loadFull();
    }
    if (action === "album-photo-next") stepPhoto(1);
    if (action === "album-photo-prev") stepPhoto(-1);
    if (action === "album-photo-select") { photoIndex = cycleAlbumPhoto(Number(value), 0, photos.length); paintOverlay(); void loadFull(); }
    if ((action === "duplicate-album" || action === "delete-album") && doc && !busy) {
      const id = doc.id, epoch = generation; busy = true; closeOverlay();
      try {
        if (action === "delete-album") {
          if (!await albumConfirm(root, "앨범 지우기", "이 앨범과 저장된 앨범 사진이 지워져요. 되돌릴 수 없고, 원본 채팅은 남아요.") || epoch !== generation) return;
          await api.remove(id); if (epoch === generation) { clear(); hooks.closed(); }
        } else { const copy = await api.duplicate(id); if (epoch === generation) await openAlbumView(copy.id); }
      } catch { if (epoch === generation) { error = "앨범 요청을 완료하지 못했어요."; repaint(); } }
      finally { busy = false; }
    }
  };
  root.addEventListener("click", e => { const n = (e.target as HTMLElement).closest<HTMLElement>(".album-view [data-album-action]"); if (n) { e.preventDefault(); void handle(n); } });
  root.addEventListener("input", e => {
    const input = e.target as HTMLInputElement;
    if (overlay === "board" && input.dataset.boardPhoto) (boardState.drafts ??= {})[input.dataset.boardPhoto] = input.value;
  });
  root.addEventListener("change", e => {
    const input = e.target as HTMLInputElement;
    if (overlay === "update" && !updateState.saving && !updateState.conflict) {
      if (input.dataset.updateExisting) {
        const id = input.dataset.updateExisting; updateState.remove = input.checked ? (updateState.remove ?? []).filter(value => value !== id) : [...new Set([...(updateState.remove ?? []), id])];
        if (!input.checked) updateState.replace = updateState.replace.filter(value => value !== id);
        paintUpdateRows();
      } else if (input.dataset.updateQuote) {
        const scene = input.dataset.scene!, id = input.dataset.updateQuote;
        const selected = new Set(updateState.quotePicks?.[scene] ?? []); if (input.checked) selected.add(id); else selected.delete(id);
        (updateState.quotePicks ??= {})[scene] = [...selected]; paintUpdateRows();
      } else {
        const key = input.dataset.updateAdd ? "add" : input.dataset.updateReplace ? "replace" : undefined;
        if (key) { const id = input.dataset.updateAdd ?? input.dataset.updateReplace!; updateState[key] = input.checked ? [...new Set([...updateState[key], id])] : updateState[key].filter(value => value !== id); paintUpdateRows(); }
      }
    }
    if (input.name === "album-html-quality" && ["keep", "normal", "light"].includes(input.value)) exportQuality = input.value as AlbumHtmlQuality;
  });
  root.addEventListener("scroll", e => { if ((e.target as HTMLElement).matches?.(".av-scroll")) spy(); }, true);
  root.addEventListener("keydown", e => {
    if (!active || (editor.active && overlay !== "photo") || !(e.target as HTMLElement).closest(".album-view")) return;
    if (e.key === "Escape" && overlay) { e.preventDefault(); e.stopPropagation(); closeOverlay(); }
    else if (past?.doc && !overlay && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); exitPast(); }
    else if (past?.doc && !overlay && !past.restoring && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); void showVersion(past.index + (e.key === "ArrowLeft" ? 1 : -1)); }
    if (overlay === "photo" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); stepPhoto(e.key === "ArrowLeft" ? -1 : 1); }
    if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).matches('figure[data-album-action="album-photo-open"]')) { e.preventDefault(); void handle(e.target as HTMLElement); }
    if (e.key === "Tab" && overlay) {
      const nodes = [...view()!.querySelectorAll<HTMLElement>('.av-overlay button,.av-overlay input:not([type=radio]),.av-overlay input:checked,.av-overlay textarea,.av-overlay summary')].filter(n => n.getClientRects().length && (n.matches("summary") || !n.closest("details:not([open])")) && !n.matches(":disabled"));
      const first = nodes[0], last = nodes.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });
  let touch: { x: number; y: number } | undefined;
  root.addEventListener("touchstart", e => { if ((e.target as HTMLElement).closest(".av-stage") && e.touches.length === 1) touch = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }; }, { passive: true });
  root.addEventListener("touchend", e => { const end = e.changedTouches[0]; if (touch && end && overlay === "photo" && phone()) { const dx = end.clientX - touch.x, dy = end.clientY - touch.y; if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) stepPhoto(dx < 0 ? 1 : -1); } touch = undefined; }, { passive: true });
  window.addEventListener("pagehide", clear, { once: true });
  return { openAlbumView, openAlbumExport: async (id: string) => { await openAlbumView(id); if (doc) await showExport(menuTrigger()!); }, openAlbumUpdate: async (id: string) => { await openAlbumView(id); if (doc) await showUpdate(view()!.querySelector<HTMLElement>('[data-album-action="album-view-menu"]')!); }, openAlbumVersions: async (id: string) => { await openAlbumView(id); if (doc) await openVersions(menuTrigger()!); }, openAlbumBoard: async (id: string) => { await openAlbumView(id); if (doc) { boardState = {}; showOverlay("board", view()!.querySelector<HTMLElement>('[data-album-action="album-view-menu"]')!); } }, openAlbumEdit: async (id: string) => { await openAlbumView(id); if (doc) { renderedHtml = ""; await editor.open(doc); } }, clear, hydrate, get active() { return active; }, render: () => {
    if (editor.active) return editor.render();
    if (renderedHtml) return renderedHtml;
    const shown = past?.doc ?? doc, row = past?.doc ? past.list?.[past.index] : undefined;
    const rendered = shown && !loading ? renderAlbum(shown, { mode: "view", photoSrc: id => urls.get(id) ?? "", storedPhotos: photoMeta }) : undefined;
    sections = rendered?.sections ?? [];
    return renderedHtml = `<section class="album-view" data-skin="${hooks.skin()}"><div class="av-base${row ? " is-past" : ""}"${overlay ? " inert" : ""}>${renderScreenBar(`${row ? act("album-versions-close", icon("back") + "<span>지금 앨범</span>", "av-back") : act("album-back", icon("back") + "<span>추억</span>", "av-back")}<div class="av-title"><b>${esc(shown?.title ?? "앨범")}</b>${row ? `<span class="avh-chip">${albumVersionWhen(row.createdAt)}의 모습</span>` : `<small>${esc(albumDateFormat(doc?.periodLabel).header)}</small>`}</div>${act("album-toc", '목차 · <span class="av-current">' + esc(currentLabel()) + '</span>' + icon("chevron"), "av-toc-trigger")}${doc && !row ? act("album-edit", icon("edit") + "꾸미기", "av-edit") : ""}${doc && !row ? act("album-view-menu", icon("more"), "av-icon", "", "앨범 메뉴") : ""}`, "av-head")}<div class="av-scroll">${error ? `<p class="av-status" role="alert">${esc(error)}</p>` : ""}${loading ? '<p class="av-status" role="status">앨범 불러오는 중…</p>' : rendered ? `<style>${rendered.css}</style>${rendered.html}` : ""}</div>${row ? renderAlbumVersionBar(past!, overlay === "versions") : sections.length ? act("album-toc", `<i class="av-number">${sections[current]?.number ?? "01"}</i><span class="av-current">${esc(currentLabel())}</span>${icon("chevron")}`, "av-pill") : ""}</div><div class="av-overlay">${overlayHtml()}</div></section>`;
  } };
}
