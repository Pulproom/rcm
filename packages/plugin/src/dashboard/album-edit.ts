import { renderScreenBar } from "./shell.js";
import { albumConfirm } from "./album-confirm.js";
import { createAlbumPhotoTools } from "./album-photo-tools.js";
import { createAlbumLinePicker } from "./album-line-picker.js";
import { ALBUM_DRAFT_ORDER, ALBUM_THEMES, ALBUM_TINTS, ALBUM_TOGETHER_CARDS, ALBUM_TOGETHER_DEFAULT_ON, albumTogetherItems, availableTogetherCards, unusedAlbumMaterials, placeAlbumPhotos, albumScenes, type Candidate, type AlbumBlockKind, type AlbumMaterials, type AlbumDocument, type AlbumItem, type AlbumTheme, type AlbumTogetherRecords, type AlbumTogetherCardId } from "@rcm/shared";
import type { albumClient } from "../album/api.js";
import { albumItems, createAlbumEditSession, duplicateBlock, editField, insertAlbumMemories, insertBlock, moveBlock, removeBlock, setStyle, toggleBlockHidden } from "../album/edit.js";
import { albumRisuPortraitRole, bindAlbumPersonImages, readAlbumProfileImages, type AlbumProfileImage, type PersonImageHost } from "../album/person-images.js";
import { createAlbumPhotoSheet, type PhotoSheetTarget } from "./album-photo-sheet.js";
import { albumItemSecondaryText, renderAlbum } from "../album/render.js";
import { ALBUM_TINT_SWATCHES, albumThemeVoice } from "../album/themes/index.js";
import { renderAlbumMiniCover } from "./album-shelf.js";
import { ALBUM_TINT_LABELS } from "./album-wizard.js";
import { escapeHtml as esc, icon } from "./film/ui.js";
import { ALBUM_EDIT_CONTENT_CSS } from "./album-edit-css.js";
import { TOGETHER_LABELS, togetherAsOf, togetherCardText, togetherHour, togetherNumber, visibleTogetherCards } from "../album/together.js";

type Api = ReturnType<typeof albumClient>;
export type AlbumImageHost = PersonImageHost & Pick<RisuPluginApi, "readInlay">;
interface FieldTarget { blockId: string; itemId: string; key: string; document: boolean; personEnd?: string }
import { ALBUM_FIELD_LABELS as labels } from "./album-labels.js";
const themeNames = { book: "한 권의 책", program: "프로그램북", lp: "가요 LP", film: "갱지" };
const button = (action: string, text: string, extra = "") => `<button type="button" data-edit-action="${action}" ${extra}>${text}</button>`;
const svg = (path: string) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${path}</svg>`;
const undoIcon = svg('<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>');
const redoIcon = svg('<path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14"/>');
const grip = svg('<path d="M9 5h1m4 0h1M9 10h1m4 0h1M9 15h1m4 0h1M9 20h1m4 0h1"/>');

export function createAlbumEditController(root: HTMLElement, api: Api, hooks: {
  host?: AlbumImageHost; photoSrc: (id: string) => string;
  photoLoaded: (id: string, url: string) => void; render: () => void; done: (doc: AlbumDocument) => void;
}) {
  let session: ReturnType<typeof createAlbumEditSession> | undefined, original: AlbumDocument | undefined;
  let selected = "", panel = true, overlay: "" | "block" | "add" | "text" | "panel" | "picker" | "more" | "cards" | "person" = "";
  let personTarget: "me" | "partner" = "me", anchorRect: DOMRect | undefined;
  let personImages: AlbumProfileImage[] = [], personBotName = "", personMissingBot = false, personLoading = false, personSelection = "", personRun = 0;
  const clearPersonImages = () => { personRun++; personImages.forEach(i => URL.revokeObjectURL(i.url)); personImages = []; };
  const memoryPicks = new Set<string>();
  let fieldTarget: FieldTarget | undefined, returnFocus: HTMLElement | null = null, personDispose: (() => void) | undefined;
  let drag: { id: string; pointer: number; grip: HTMLElement; row: HTMLElement; ghost: HTMLElement; indicator: HTMLElement; pageLine: HTMLElement; destination: number; startX: number; startY: number; lifted: boolean; x: number; y: number; frame: number } | undefined;
  let html = "", epoch = 0, observed: HTMLElement | null = null;
  let fieldObserver: IntersectionObserver | undefined;
  const decorated = new WeakSet<HTMLElement>();
  let materials: AlbumMaterials | undefined;
  let lastTogether: AlbumTogetherRecords | undefined, togetherLoading = false, togetherError = "";
  let unusedCache: { document: AlbumDocument; materials: AlbumMaterials; value: ReturnType<typeof unusedAlbumMaterials> } | undefined;
  const newNicknames = new Set<string>();
  const host = () => root.querySelector<HTMLElement>(".album-edit");
  const phone = () => (host()?.clientWidth ?? window.innerWidth) < 768;
  const doc = () => session!.document;
  const unused = () => {
    if (!materials) return undefined;
    const document = doc();
    if (unusedCache?.document !== document || unusedCache.materials !== materials) unusedCache = { document, materials, value: unusedAlbumMaterials(document, materials) };
    return unusedCache.value;
  };
  const moreItems = () => { const kind = doc().blocks.find(b => b.id === selected)?.kind; return kind ? unused()?.[kind] ?? [] : []; };
  const name = (id: string) => { const b = doc().blocks.find(b => b.id === id); return b ? b.title || (b.kind === "quotes" ? "대사" : b.kind === "cover" ? "표지" : b.kind === "divider" ? "구분선" : albumThemeVoice(doc().style.theme).blocks[b.kind].title) : "블록"; };
  const fieldItem = (d: AlbumDocument, t: FieldTarget): AlbumItem | undefined => albumItems(d.blocks.find(b => b.id === t.blockId)?.items ?? []).find(i => i.id === t.itemId);
  const read = (d: AlbumDocument, t: FieldTarget): string => {
    if (t.document) {
      if (t.key === "people.me.name") return d.people.me.name;
      if (t.key === "people.partner.name") return d.people.partner.name;
      return ["title", "subtitle", "periodLabel"].includes(t.key) ? String(d[t.key as "title"] ?? "") : "";
    }
    const caption = /^photos\.(\d+)\.caption$/.exec(t.key);
    if (caption) return fieldItem(d, t)?.photos[Number(caption[1])]?.caption ?? "";
    return t.itemId ? fieldItem(d, t)?.fields[t.key] ?? "" : (d.blocks.find(b => b.id === t.blockId)?.title ?? albumThemeVoice(d.style.theme).blocks[d.blocks.find(b => b.id === t.blockId)?.kind ?? "text"].title);
  };
  const target = (node: HTMLElement): FieldTarget => ({ blockId: node.closest<HTMLElement>("[data-album-block]")?.dataset.albumBlock ?? "", itemId: node.closest<HTMLElement>("[data-album-item]")?.dataset.albumItem ?? "", key: node.dataset.albumField!, document: node.closest<HTMLElement>("[data-album-scope]")?.dataset.albumScope === "document", personEnd: node.dataset.personEnd });
  const edited = (t: FieldTarget) => t.itemId && !t.document ? Boolean(fieldItem(doc(), t)?.edited[t.key]) : original ? read(doc(), t) !== read(original, t) : false;
  const updateStatus = () => {
    if (!session) return;
    const heading = host()?.querySelector(".ae-title b"); if (heading) heading.textContent = doc().title;
    host()?.querySelectorAll<HTMLElement>(".ae-status").forEach(n => { n.textContent = session!.message; n.dataset.status = session!.status; });
    host()?.querySelectorAll<HTMLButtonElement>('[data-edit-action="reload"]').forEach(n => { n.hidden = session!.status !== "conflict"; });
    host()?.querySelectorAll<HTMLButtonElement>('[data-edit-action="retry"]').forEach(n => { n.hidden = session!.status !== "error"; });
    host()?.querySelectorAll<HTMLButtonElement>('[data-edit-action="undo"],[data-edit-action="redo"]').forEach(n => { n.disabled = n.dataset.editAction === "undo" ? !session!.canUndo : !session!.canRedo; });
  };
  const scrollToSelected = () => {
    const s = [...host()!.querySelectorAll<HTMLElement>("[data-album-block]")].find(s => s.dataset.albumBlock === selected);
    s?.scrollIntoView({ block: "nearest" }); s?.focus({ preventScroll: true }); positionTools();
  };
  const focusSheet = () => [...host()?.querySelectorAll<HTMLElement>(".ae-overlay input:not([hidden]):not(:disabled),.ae-overlay textarea,.ae-overlay button:not(:disabled)") ?? []].find(n => n.getClientRects().length)?.focus({ preventScroll: true });
  const repaint = () => {
    const top = host()?.querySelector(".ae-scroll")?.scrollTop ?? 0, panelTop = host()?.querySelector(".ae-panel")?.scrollTop ?? 0;
    html = ""; personDispose?.(); hooks.render(); hydrate();
    const scroller = host()?.querySelector(".ae-scroll"); if (scroller) scroller.scrollTop = top;
    const pane = host()?.querySelector(".ae-panel"); if (pane) pane.scrollTop = panelTop; positionTools();
    if (overlay && !host()?.contains(document.activeElement)) focusSheet();
  };
  const apply = (next: AlbumDocument, redraw = true) => { session?.apply(next); if (redraw) repaint(); };
  const insertMemories = (candidates: Candidate[], ids: string[], kind?: AlbumBlockKind) => {
    const before = new Set(doc().blocks.flatMap(b => albumItems(b.items).map(i => i.id)));
    const next = insertAlbumMemories(doc(), candidates, ids, kind);
    if (kind) {
      const block = next.blocks.find(b => b.kind === kind)!;
      if (kind === "bond" && materials?.bond) block.bond = structuredClone(materials.bond);
      selected = block.id;
    }
    overlay = ""; memoryPicks.clear(); apply(next);
    const fresh = [...host()?.querySelectorAll<HTMLElement>("[data-album-item]") ?? []].filter(n => !before.has(n.dataset.albumItem!));
    if (kind) scrollToSelected(); else fresh[0]?.scrollIntoView({ block: "center" });
    fresh.forEach(n => n.classList.add("ae-fresh"));
    positionTools();
  };
  const removeNickname = (blockId: string, itemId: string, redraw = true) => { newNicknames.delete(itemId); apply({ ...doc(), blocks: doc().blocks.map(b => b.id === blockId ? { ...b, items: b.items.filter(i => i.id !== itemId) } : b) }, redraw); };
  const photos = createAlbumPhotoSheet(root, api, hooks.host ?? {}, { document: doc, materials: () => materials, apply, photoSrc: hooks.photoSrc, photoLoaded: hooks.photoLoaded, storedChanged: () => void photoTools.refresh(), uploadProgress: rows => photoTools.setUploads(rows) });
  const photoTools = createAlbumPhotoTools(root, api, { document: doc, apply, render: repaintPanels, photoSrc: hooks.photoSrc, photoLoaded: hooks.photoLoaded, flush: () => session!.flush(), forgotten: id => session!.forgetPhoto(id), choose: () => showPhotos({ library: true }) });
  const lines = createAlbumLinePicker(root, { document: doc, materials: () => materials, apply: (next, id) => { selected = id; apply(next); scrollToSelected(); } });
  const showPhotos = (target: PhotoSheetTarget = {}) => { overlay = ""; paintChrome(); void photos.open(target); };
  const write = (t: FieldTarget, value: string, restore = false, redraw = true) => {
    if (value.length > 20000) value = value.slice(0, 20000);
    if (value === read(doc(), t) && !restore) return;
    if (t.document) {
      if (t.key === "people.me.name" || t.key === "people.partner.name") {
        const side = t.key === "people.me.name" ? "me" : "partner";
        apply({ ...doc(), people: { ...doc().people, [side]: { ...doc().people[side], name: value } } }, redraw);
      } else if (["title", "subtitle", "periodLabel"].includes(t.key)) apply({ ...doc(), [t.key]: value }, redraw);
    } else if (t.itemId) apply(editField(doc(), t.blockId, t.itemId, t.key, value, restore), redraw);
    else apply({ ...doc(), blocks: doc().blocks.map(b => b.id === t.blockId ? { ...b, title: restore && original?.blocks.find(b => b.id === t.blockId)?.title === undefined ? undefined : value } : b) }, redraw);
  };
  const closeSheet = () => {
    const previous = overlay;
    overlay = ""; paintChrome();
    const replacement = fieldTarget && [...host()?.querySelectorAll<HTMLElement>("[data-album-field]") ?? []].find(n => n.getClientRects().length && JSON.stringify(target(n)) === JSON.stringify(fieldTarget));
    (returnFocus?.isConnected ? returnFocus : previous === "more" || previous === "cards" ? host()?.querySelector<HTMLElement>(`[data-edit-action="${previous}"]`) : replacement ?? host()?.querySelector<HTMLElement>('[data-edit-action="panel"]'))?.focus({ preventScroll: true });
  };
  const showSheet = (kind: typeof overlay, trigger?: HTMLElement) => { returnFocus = trigger ?? document.activeElement as HTMLElement; anchorRect = returnFocus?.getBoundingClientRect?.(); overlay = kind; paintChrome(); focusSheet(); };
  const personOptions = (t: FieldTarget) => {
    const raw = read(doc(), t), direction = ["me_to_partner", "partner_to_me"].includes(raw) || Boolean(t.personEnd && !["from", "to"].includes(t.key));
    const codes = ["me", "partner"] as const;
    const options = codes.map(code => {
      const other = code === "me" ? "partner" : "me";
      const value = direction ? t.personEnd === "to" ? `${other}_to_${code}` : `${code}_to_${other}` : ["persona", "character"].includes(raw) ? code === "me" ? "persona" : "character" : ["from", "to"].includes(t.key) && !["me", "partner"].includes(raw) ? doc().people[code].name : code;
      return button("pick-value", esc(doc().people[code].name), `data-value="${esc(value)}" aria-pressed="${raw === value}"`);
    });
    if (!["from", "to"].includes(t.key) && !direction) options.push(button("pick-value", "두 사람", `data-value="${raw === "both" ? "both" : "mutual"}" aria-pressed="${raw === "mutual" || raw === "both"}"`));
    return options.join("");
  };
  const pickerBody = () => {
    if (!fieldTarget) return "";
    const t = fieldTarget, raw = read(doc(), t);
    const input = (id: string, label: string, type: string, value: string) => `<label for="${id}">${label}<input id="${id}" type="${type}" value="${esc(value)}"></label>`;
    if (t.key === "date" || t.key === "periodLabel") {
      // Parse only the stored numeric date/period syntax; prose is not interpreted.
      const dates = [...raw.matchAll(/(\d{4})[-.]\s*(\d{1,2})[-.]\s*(\d{1,2})/g)].map(m => `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`), time = raw.match(/[ T](\d{2}:\d{2})/)?.[1] ?? "";
      const period = t.key === "periodLabel";
      return `<div class="ae-fieldrow">${input("ae-date", period ? "시작 날짜" : "날짜", "date", dates[0] ?? "")}${input(period ? "ae-end-date" : "ae-time", period ? "끝 날짜" : "시간 (선택)", period ? "date" : "time", period ? dates.at(-1) ?? "" : time)}</div><div class="ae-picker-foot">${button("pick-value", "날짜 없음", 'data-value="" class="ae-clear"')}${button("pick-apply", "적용", 'class="ae-primary"')}</div>`;
    }
    const statuses = doc().blocks.find(b => b.id === t.blockId)?.kind === "progress" ? [["done", "했어요"], ["not_yet", "아직"], ["unknown", "기록 없음"]] : [["open", "진행 중"], ["kept", "지킴"], ["broken", "깨짐"]];
    return `<div class="ae-seg">${t.key === "status" ? statuses.map(([value, label]) => button("pick-value", label!, `data-value="${value}" aria-pressed="${raw === value}"`)).join("") : personOptions(t)}</div>`;
  };
  const focusPanel = (selector: string) => {
    if (phone()) showSheet("panel"); else setPanel(true);
    const section = host()?.querySelector<HTMLElement>(`${phone() ? ".ae-overlay" : ".ae-panel"} ${selector}`);
    section?.scrollIntoView({ block: "center" }); section?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  };
  const blockActions = (mobile: boolean) => {
    const block = doc().blocks.find(b => b.id === selected); if (!block) return "";
    const at = doc().blocks.indexOf(block);
    const count = moreItems().length;
    const more = block.kind === "together" ? button("cards", `카드 고르기 <i>${visibleTogetherCards(block).length}/${block.together ? availableTogetherCards(block.together).length : 0}</i>`, 'class="ae-more" aria-haspopup="dialog"')
      : block.kind === "quotes" ? button("replace-lines", "대사 바꾸기", 'class="ae-more" aria-haspopup="dialog"') : count ? button("more", `더 넣기 <i>${count}</i>`, 'class="ae-more" aria-haspopup="dialog"') : "";
    const moves = button("move", icon("up") + (mobile ? "위로" : ""), `data-delta="-1" aria-label="위로" ${at === 0 ? "disabled" : ""}`) + button("move", icon("down") + (mobile ? "아래로" : ""), `data-delta="1" aria-label="아래로" ${at === doc().blocks.length - 1 ? "disabled" : ""}`);
    return `${mobile ? `<div class="ae-pair">${moves}</div><div class="ae-action-group">${button("add", icon("add") + "아래에 블록 추가")}` : `${button("grip", grip, 'aria-label="블록 이동 버튼으로 이동" title="위로·아래로 버튼으로 이동" class="ae-toolbar-grip"')}<b>${esc(name(selected))}</b>${moves}<span class="ae-tool-sep" aria-hidden="true"></span>${more}${more ? '<span class="ae-tool-sep" aria-hidden="true"></span>' : ""}`}${button("hide", icon("eye") + (block.hidden ? "보이기" : "숨기기"))}${button("duplicate", icon("copy") + "복제")}${button("delete", icon("delete") + "지우기", 'class="ae-danger"')}${mobile ? `</div>${more ? `<div class="ae-sheet-more">${more}</div>` : ""}` : ""}${mobile && fieldTarget?.blockId === selected && edited(fieldTarget) ? button("restore", "원래대로") : ""}`;
  };
  const addChoices = () => ([['text', '글'], ['photo', '사진'], ['gallery', '사진 묶음'], ['quotes', '대사'], ['divider', '구분선']] as const).map(([kind, label]) => button("insert", label, `data-kind="${kind}"`)).join("")
    + button("insert-together", togetherLoading ? "불러오는 중…" : "함께한 시간", togetherLoading ? "disabled" : "")
    + (togetherError ? `<p class="ae-sub" role="status">${esc(togetherError)}</p>` : "");
  const memoryChoices = () => {
    const remaining = unused();
    const kinds = ALBUM_DRAFT_ORDER.filter(kind => remaining?.[kind].length && !doc().blocks.some(b => b.kind === kind));
    return kinds.length ? `<p class="ae-sub">이 채팅에서 더 가져오기</p><div class="ae-panel-add ae-memory-add">${kinds.map(kind => button("insert-memory-block", `${esc(kind === "story" ? "빠진 장면" : albumThemeVoice(doc().style.theme).blocks[kind].title)} <em>${remaining![kind].length}</em>`, `data-kind="${kind}"`)).join("")}</div>` : "";
  };
  const panelBody = () => {
    const d = doc();
    const image = (id?: string) => id && hooks.photoSrc(id) ? `<img src="${esc(hooks.photoSrc(id))}" alt="">` : "";
    return `<section class="ae-psec"><h3>테마</h3><div class="ae-themes">${ALBUM_THEMES.map(theme => button("theme", `<span class="ae-mini"><span class="album-mini-stage">${renderAlbumMiniCover({ id: d.id, title: d.title, theme, tint: theme === d.style.theme ? d.style.tint : undefined, names: [d.people.me.name, d.people.partner.name], coverPhotoId: d.coverPhotoId ?? null, chapterCount: d.blocks.filter(b => b.kind === "story").flatMap(b => b.items).length, sceneCount: d.blocks.filter(b => b.kind === "story").flatMap(b => b.items.flatMap(i => i.children ?? [])).length, promiseCount: d.blocks.filter(b => b.kind === "promises").flatMap(b => b.items).length }, (_a, id) => hooks.photoSrc(id))}</span></span>` + themeNames[theme], `data-theme="${theme}" aria-pressed="${theme === d.style.theme}"`)).join("")}</div></section>
      ${ALBUM_TINTS[d.style.theme].length ? `<section class="ae-psec"><h3>색</h3><div class="ae-tints">${ALBUM_TINTS[d.style.theme].map(t => button("tint", "", `data-tint="${t}" aria-label="${ALBUM_TINT_LABELS[t]}" aria-pressed="${d.style.tint === t}" style="--swatch:${ALBUM_TINT_SWATCHES[d.style.theme][t]}"`)).join("")}</div></section>` : ""}
      <section class="ae-psec ae-cover-tools"><h3>표지 사진</h3><div class="ae-photo-row">${image(d.coverPhotoId)}${button("cover-photo", "바꾸기")}${d.coverPhotoId ? '<button type="button" data-album-action="fit-photo">맞추기</button>' : ""}${button("cover-remove", "빼기", d.coverPhotoId ? "" : "disabled")}</div></section>
      <section class="ae-psec"><h3>두 사람</h3>${(["me", "partner"] as const).map(person => `<div class="ae-person" data-album-person="${person}">${image(d.people[person].photoId) || '<span class="ae-person-empty" aria-hidden="true"></span>'}<div><b>${esc(d.people[person].name)}</b><small>${d.people[person].photoSource === "upload" ? "직접 올린 사진" : (d.people[person].photoAsset === "persona" || d.people[person].photoAsset?.startsWith("persona:")) ? "페르소나 사진" : d.people[person].photoAsset === "main" ? "봇 대표 이미지" : "Risu에서 고른 사진"}</small></div><span class="ae-person-acts">${button("person-menu", "불러오기", `data-person="${person}" aria-haspopup="dialog"`)}${button("person-upload", "올리기", `data-person="${person}"`)}</span></div>`).join("")}</section>
      ${photoTools.tray()}${photoTools.blockPanel(d.blocks.find(b => b.id === selected))}
      <section class="ae-psec"><h3>블록 <small>끌어서 순서 바꾸기</small></h3><ol class="ae-block-list">${d.blocks.map(b => `<li data-drop-id="${esc(b.id)}" class="${b.hidden ? "ae-off" : ""}">${button("grip", grip, `data-drag-id="${esc(b.id)}" aria-label="${esc(name(b.id))} 끌어서 옮기기"`)}${button("select", esc(name(b.id)), `data-id="${esc(b.id)}" aria-pressed="${b.id === selected}"`)}${button("block-menu", "···", `data-id="${esc(b.id)}" aria-label="${esc(name(b.id))} 블록 메뉴" aria-haspopup="dialog"`)}</li>`).join("")}</ol></section><section class="ae-psec"><h3>블록 추가</h3><div class="ae-panel-add">${addChoices()}</div>${memoryChoices()}</section>`;
  };
  const sheetHtml = () => {
    if (!overlay || (!phone() && overlay === "panel")) return "";
    let body = "", title = "";
    if (overlay === "cards") {
      const block = doc().blocks.find(b => b.id === selected), records = block?.together;
      const available = new Set(records ? availableTogetherCards(records) : []);
      const rows = ALBUM_TOGETHER_CARDS.map(card => {
        const enabled = available.has(card), checked = block?.items.some(i => i.id === card && !i.hidden);
        const text = records && enabled ? togetherCardText(records, card) : undefined;
        const summary = !text ? card === "quiz" ? "아직 푼 문제가 없어요" : "시각 기록이 없어요"
          : card === "first" ? `${text.value} · ${text.note}` : card === "two-times" ? `이야기 속 ${togetherNumber(records!.storyDays!)}일 · 현실 ${records!.realSpan}`
          : card === "hours" ? `주로 ${togetherHour(records!.peakHour!)}쯤` : text.value;
        return `${card === "first" || card === "days" ? `<li class="ae-more-group">${ALBUM_TOGETHER_DEFAULT_ON.has(card) ? "기본" : "더 보기"}</li>` : ""}<li${enabled ? "" : ' class="off"'}><label><input type="checkbox" data-edit-action="toggle-card" data-card="${card}"${checked && enabled ? " checked" : ""}${enabled ? "" : " disabled"}><span>${TOGETHER_LABELS[card]}</span><small>${esc(summary)}</small></label></li>`;
      }).join("");
      return `<div class="ae-scrim${phone() ? "" : " ae-cards-scrim"}" data-edit-action="close-sheet"></div><section class="ae-more-sheet ae-cards${phone() ? " ae-sheet" : ""}" role="dialog" aria-modal="true" aria-label="보일 카드"><header><b>보일 카드</b><small>${records ? esc(togetherAsOf(records)) : ""}</small></header><ul>${rows}</ul></section>`;
    }
    if (overlay === "more") {
      title = `아직 안 넣은 ${name(selected)}`;
      let group = "";
      const rows = moreItems().map(c => {
        const chapter = c.chapter?.item;
        const heading = chapter && chapter.id !== group ? `<li class="ae-more-group">${esc(chapter.fields.title ?? "")}</li>` : "";
        if (chapter) group = chapter.id;
        const main = ["text", "body", "title", "summary", "caption"].map(key => c.item.fields[key]).find(Boolean) ?? "사진";
        return `${heading}<li><label><input type="checkbox" data-memory-id="${esc(c.item.id)}" ${memoryPicks.has(c.item.id) ? "checked" : ""}><span>${esc(main)}</span><small>${esc(albumItemSecondaryText(c.item, doc()))}</small></label></li>`;
      }).join("");
      return `<div class="ae-scrim${phone() ? "" : " ae-picker-scrim"}" data-edit-action="close-sheet"></div><section class="ae-more-sheet${phone() ? " ae-sheet" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><b>${esc(title)}</b><small>이 채팅의 기억에서</small></header><ul>${rows}</ul><footer><small>날짜 순서에 맞춰 들어가요</small>${button("insert-memories", memoryPicks.size ? `${memoryPicks.size}개 넣기` : "넣기", memoryPicks.size ? "" : "disabled")}</footer></section>`;
    }
    if (overlay === "person") {
      title = `${doc().people[personTarget].name} 사진 바꾸기`;
      const chosen = personImages.find(i => i.key === personSelection);
      const device = `<button type="button" class="ae-person-choice ae-person-device" data-album-person-source="upload">${icon("add")}<span>기기에서 올리기</span></button>`;
      const groupOrder = albumRisuPortraitRole(doc(), personTarget) === "me" ? ["페르소나", "대표 이미지", "카드 아이콘"] : ["대표 이미지", "카드 아이콘", "페르소나"];
      const groups = groupOrder.map(group => {
        const images = personImages.filter(i => i.group === group);
        if (!images.length) return group === "페르소나" ? `<div class="ae-person-grid">${device}</div>` : "";
        return `<h4>${group}${group === "카드 아이콘" ? ` ${images.length}` : ""}</h4><div class="ae-person-grid">${images.map(i => button("person-pick", `<img src="${esc(i.url)}" alt=""><span>${esc(i.name)}</span>${i.key === personSelection ? '<i aria-hidden="true">✓</i>' : ""}`, `class="ae-person-choice" data-key="${esc(i.key)}" aria-label="${esc(i.name)}" aria-pressed="${i.key === personSelection}"`)).join("")}${group === "페르소나" ? device : ""}</div>`;
      }).join("");
      return `<div class="ae-scrim" data-edit-action="close-sheet"></div><section class="ae-person-sheet" role="dialog" aria-modal="true" aria-label="${esc(doc().people[personTarget].name)}의 사진 고르기"><header><h3>${esc(doc().people[personTarget].name)}의 사진 고르기</h3>${button("close-sheet", icon("close"), 'aria-label="닫기"')}</header>${personBotName ? `<p class="ae-person-sub">${esc(personBotName)}의 프로필 사진이에요.</p>` : personMissingBot ? '<p class="ae-person-sub">이 채팅의 봇을 찾을 수 없어요.</p>' : ""}<form id="ae-person-image" class="alb-person-tools" data-album-person="${personTarget}"${chosen ? ` data-person-path="${esc(chosen.path)}" data-person-asset="${esc(chosen.key)}"` : ""}><input type="file" accept="image/*" hidden><div class="ae-person-body">${personLoading ? `<div class="ae-person-loading" role="status"><p>사진 불러오는 중…</p><div class="ae-person-grid" aria-hidden="true">${'<span class="ae-person-skeleton"></span>'.repeat(4)}</div></div>` : `${personImages.length ? "" : '<p class="ae-person-empty-state">불러올 프로필 사진이 없어요. 기기에서 올려 주세요.</p>'}${groups}`}</div><p role="status" aria-live="polite"></p><footer>${doc().people[personTarget].photoId ? button("person-remove", "사진 빼기", 'class="ae-danger"') : ""}${button("close-sheet", "취소")}<button type="button" class="ae-primary" data-album-person-source="risu"${!chosen || personLoading ? " disabled" : ""}>이 사진 쓰기</button></footer></form></section>`;
    }
    if (overlay === "picker" && fieldTarget) {
      title = labels[fieldTarget.key] ?? fieldTarget.key; body = pickerBody();
      if (!phone()) return `<div class="ae-scrim ae-picker-scrim" data-edit-action="close-sheet"></div><section class="ae-picker" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h4>${esc(title)}</h4>${body}</section>`;
    }
    if (overlay === "block") { title = name(selected); body = `<div class="ae-block-actions">${blockActions(true)}</div>`; }
    if (overlay === "add") { title = "블록 추가"; body = `<div class="ae-panel-add">${addChoices()}</div>${memoryChoices()}`; }
    if (overlay === "panel") { title = "꾸미기"; body = panelBody(); }
    if (overlay === "text" && fieldTarget) {
      title = labels[fieldTarget.key] ?? fieldTarget.key;
      body = `<label class="ae-text-label" for="ae-text-value">${esc(title)} ${edited(fieldTarget) ? button("restore", "원래대로") : ""}</label><textarea id="ae-text-value" maxlength="20000">${esc(read(doc(), fieldTarget))}</textarea><div class="ae-sheet-acts">${button("close-sheet", "취소")}${button("save-text", "저장", 'class="ae-primary"')}</div>`;
    }
    return `<div class="ae-scrim" data-edit-action="close-sheet"></div><section class="ae-sheet${overlay === "block" ? " ae-block-sheet" : ""}${overlay === "text" ? " ae-text-sheet" : ""}${overlay === "add" && !phone() ? " ae-add-pop" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">${overlay === "text" ? "" : `<header><h2>${esc(title)}</h2>${button("close-sheet", icon("close"), 'aria-label="닫기"')}</header>`}<div class="ae-sheet-body">${body}</div></section>`;
  };
  const positionTools = () => {
    const h = host(), tools = h?.querySelector<HTMLElement>(".ae-tools"), section = [...h?.querySelectorAll<HTMLElement>("[data-album-block]") ?? []].find(n => n.dataset.albumBlock === selected);
    if (!h || !tools) return;
    tools.hidden = !section || phone() || Boolean(overlay && overlay !== "more" && overlay !== "cards");
    if (section) {
      const r = section.getBoundingClientRect(), hr = h.getBoundingClientRect(), scroll = h.querySelector<HTMLElement>(".ae-scroll")!.getBoundingClientRect();
      tools.hidden ||= r.bottom < scroll.top + 44 || r.top > scroll.bottom;
      const top = r.top + (section.closest(".rd-ledger") || section.matches(".alb-block--story,.alb-block--together") ? -44 : 18);
      tools.hidden ||= top < scroll.top;
      tools.style.top = `${top - hr.top}px`;
      tools.style.maxWidth = `${Math.max(0, scroll.width - 24)}px`;
      const half = tools.offsetWidth / 2;
      tools.style.left = `${Math.max(scroll.left + 12 + half, Math.min(scroll.right - 12 - half, r.left + r.width / 2)) - hr.left}px`;
    }
  };
  const openPerson = async (person: "me" | "partner", trigger: HTMLElement, upload = false) => {
    clearPersonImages(); personTarget = person; personSelection = doc().people[person].photoAsset ?? ""; personBotName = ""; personMissingBot = false; personLoading = !upload;
    showSheet("person", trigger);
    if (upload) { host()?.querySelector<HTMLInputElement>('#ae-person-image input[type="file"]')?.click(); return; }
    const run = personRun;
    const result = await readAlbumProfileImages(doc(), person, hooks.host ?? { async getCharacter() { return undefined; }, async getDatabase() { return {}; } });
    if (run !== personRun || !session || overlay !== "person") { result.images.forEach(i => URL.revokeObjectURL(i.url)); return; }
    personImages = result.images; personBotName = result.name; personMissingBot = result.missingBot; personLoading = false; paintChrome();
  };
  const bindPeople = () => {
    personDispose?.(); if (!session) return;
    const snapshot = structuredClone(doc()), generation = epoch;
    const personApi = { ...api, save: async (_id: string, next: AlbumDocument) => {
      if (generation !== epoch || !session) throw new Error("Album closed");
      let current = doc();
      for (const person of ["me", "partner"] as const) if (snapshot.people[person].photoId !== next.people[person].photoId) current = { ...current, people: { ...current.people, [person]: { ...current.people[person], photoId: next.people[person].photoId, photoSource: next.people[person].photoSource, photoAsset: next.people[person].photoAsset } } };
      session.apply(current); await session.flush(); return { revision: doc().revision };
    } };
    personDispose = bindAlbumPersonImages(host()!, snapshot, personApi, hooks.host ?? { async getCharacter() { return undefined; }, async getDatabase() { return {}; } }, (person, url) => { if (generation !== epoch) return; hooks.photoLoaded(snapshot.people[person].photoId!, url); overlay = ""; repaint(); });
  };
  const paintChrome = () => {
    if (!session) return;
    host()?.querySelectorAll<HTMLElement>("[data-album-block]").forEach(n => n.classList.toggle("alb-editor-selected", n.dataset.albumBlock === selected));
    host()?.querySelectorAll<HTMLElement>('.ae-block-list [data-edit-action="select"]').forEach(n => n.setAttribute("aria-pressed", String(n.dataset.id === selected)));
    const side = host()?.querySelector(".ae-panel");
    if (side) { side.querySelector(".apt-size")?.remove(); side.querySelector(".ae-block-list")?.closest("section")?.insertAdjacentHTML("beforebegin", photoTools.blockPanel(doc().blocks.find(b => b.id === selected))); }
    const tools = host()?.querySelector(".ae-tools"); if (tools) tools.innerHTML = blockActions(false);
    const slot = host()?.querySelector(".ae-overlay"); if (slot) slot.innerHTML = sheetHtml();
    const base = host()?.querySelector<HTMLElement>(".ae-base"); if (base) base.inert = Boolean(overlay);
    positionTools();
    const picker = host()?.querySelector<HTMLElement>(".ae-picker");
    if (picker && anchorRect) {
      const r = anchorRect, h = host()!.getBoundingClientRect();
      picker.style.left = `${Math.max(12, Math.min(h.width - picker.offsetWidth - 12, r.left - h.left))}px`;
      picker.style.top = `${Math.max(12, Math.min(h.height - picker.offsetHeight - 12, r.bottom - h.top + 8))}px`;
    }
    const more = host()?.querySelector<HTMLElement>(".ae-more-sheet");
    if (more && !phone() && anchorRect) {
      const h = host()!.getBoundingClientRect(), r = anchorRect;
      const tools = host()?.querySelector<HTMLElement>(".ae-tools")?.getBoundingClientRect();
      const left = overlay === "cards" && tools ? tools.left + tools.width / 2 - more.offsetWidth * .3 : r.left;
      more.style.left = `${Math.max(12, Math.min(h.width - more.offsetWidth - 12, left - h.left))}px`;
      more.style.top = `${Math.max(60, Math.min(h.height - more.offsetHeight - 12, r.bottom - h.top + 8))}px`;
    }
    const add = host()?.querySelector<HTMLElement>(".ae-add-pop");
    if (add && returnFocus?.isConnected) {
      const r = returnFocus.getBoundingClientRect(), h = host()!.getBoundingClientRect();
      add.style.left = Math.max(12, Math.min(h.width - 372, r.left - h.left + r.width / 2 - 180)) + "px";
      add.style.top = Math.max(60, Math.min(h.height - 190, r.bottom - h.top + 6)) + "px";
    }
    bindPeople();
  };
  const resize = new ResizeObserver(() => {
    if (!session) return;
    host()?.querySelectorAll<HTMLElement>("[data-album-field]").forEach(n => { n.contentEditable = n.hasAttribute("data-pick") ? "false" : "plaintext-only"; }); positionTools();
  });
  function decorateRings(nodes: HTMLElement[]) {
    // Read every surface before writing ring styles; alternating these forced
    // a style/layout flush for each field on a large album.
    const backgrounds = new Map<Element, number[]>();
    const background = (surface: HTMLElement | null): number[] => {
      if (!surface) return [243, 242, 237];
      const cached = backgrounds.get(surface); if (cached) return cached;
      const color = getComputedStyle(surface).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
      const rgb = color.length >= 3 && (color[3] ?? 1) > .95 ? color : background(surface.parentElement);
      backgrounds.set(surface, rgb); return rgb;
    };
    const accents = nodes.filter(n => !decorated.has(n)).map(n => {
      const rgb = background(n.matches(".alb-block--cover") ? n.querySelector<HTMLElement>(".rd-cover") : n);
      const luminance = (channels: number[]) => channels.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [ .2126, .7152, .0722 ][i]!, 0);
      // First ring colour with 3:1 against the surface: default blue, deep blue on mid-light paper/sleeves, light blue or white on dark ones.
      const b = luminance(rgb.length ? rgb : [243, 242, 237]);
      const rings: [string, number[]][] = [["#2f6fd6", [47, 111, 214]], ["#1d3f8f", [29, 63, 143]], ["#8fb4ff", [143, 180, 255]], ["#ffffff", [255, 255, 255]]];
      const ratio = (c: number[]) => { const a = luminance(c); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
      const ring = rings.find(([, c]) => ratio(c) >= 3)?.[0] ?? "#ffffff";
      return { n, ring };
    });
    accents.forEach(({ n, ring }) => {
      decorated.add(n);
      n.style.setProperty("--editor-accent", ring);
      n.style.setProperty("--editor-soft", `${ring}1f`);
    });

  }
  function repaintPanels() {
    const pane = host()?.querySelector(".ae-panel");
    if (pane) pane.innerHTML = panelBody();
    paintChrome();
  }
  function setPanel(value: boolean) {
    panel = value;
    const h = host(), base = h?.querySelector(".ae-base"), old = h?.querySelector(".ae-panel");
    base?.classList.toggle("ae-has-panel", panel);
    if (!panel) old?.remove();
    else if (!old && base) {
      const aside = document.createElement("aside"); aside.className = "ae-panel"; aside.setAttribute("aria-label", "전체 꾸미기"); aside.innerHTML = panelBody(); base.append(aside);
    }
    h?.querySelectorAll('[data-edit-action="panel"]').forEach(n => n.setAttribute("aria-pressed", String(panel)));
    paintChrome();
  }
  function hydrate() {
    const h = host(); if (!h || !session) return;
    if (observed === h) { updateStatus(); photos.hydrate(); lines.hydrate(); photoTools.hydrate(); return; }
    resize.disconnect(); resize.observe(h); observed = h;
    h.querySelectorAll<HTMLElement>("[data-album-block]").forEach(n => {
      n.tabIndex = 0; n.setAttribute("aria-label", `${name(n.dataset.albumBlock!)} 블록`);
      n.classList.toggle("alb-editor-selected", n.dataset.albumBlock === selected);
    });
    h.querySelectorAll<HTMLElement>("[data-album-field]").forEach(n => {
      if (newNicknames.has(target(n).itemId)) { n.classList.add("rd-call-new"); n.dataset.placeholder = "부르는 말"; }
      n.tabIndex = 0; n.contentEditable = n.hasAttribute("data-pick") ? "false" : "plaintext-only";
      if (n.hasAttribute("data-pick")) { n.setAttribute("role", "button"); n.setAttribute("aria-haspopup", "dialog"); }
      n.setAttribute("aria-label", labels[n.dataset.albumField!] ?? n.dataset.albumField!);
      n.classList.toggle("alb-editor-edited", edited(target(n))); n.spellcheck = false;
    });
    const nodes = [...h.querySelectorAll<HTMLElement>("[data-album-field],[data-album-block]")];
    fieldObserver?.disconnect();
    if (typeof IntersectionObserver === "undefined") decorateRings(nodes);
    else {
      fieldObserver = new IntersectionObserver(entries => {
        const shown = entries.filter(e => e.isIntersecting).map(e => e.target as HTMLElement);
        shown.forEach(n => fieldObserver?.unobserve(n)); decorateRings(shown);
      }, { root: h.querySelector(".ae-scroll"), rootMargin: "160px" });
      nodes.forEach(n => fieldObserver!.observe(n));
    }

    paintChrome(); updateStatus(); photos.hydrate(); lines.hydrate(); photoTools.hydrate();
  }
  const clear = () => { fieldObserver?.disconnect(); clearPersonImages(); finishDrag(false); memoryPicks.clear(); newNicknames.clear(); lines.close(); photoTools.close(); photos.dispose(); materials = undefined; lastTogether = undefined; togetherLoading = false; togetherError = ""; unusedCache = undefined; original = undefined; epoch++; session?.dispose(); session = undefined; personDispose?.(); resize.disconnect(); observed = null; html = ""; overlay = ""; };
  const open = async (initial: AlbumDocument) => {
    clear(); const generation = epoch; original = structuredClone(initial); selected = "";
    lastTogether = initial.blocks.find(b => b.kind === "together")?.together;
    session = createAlbumEditSession(initial, api.save, updateStatus); repaint(); photoTools.open();
    if (initial.source.chatId && initial.source.sourceAvailable) {
      try {
        const loaded = await api.materials(initial.source.chatId, { me: initial.people.me.name, partner: initial.people.partner.name }); if (epoch !== generation || !original) return; materials = loaded;
        lastTogether = loaded.together ?? lastTogether;
        const sources = albumItems(Object.values(materials.blocks).flat());
        original.blocks.forEach(b => albumItems(b.items).forEach(i => {
          const source = sources.find(s => i.origin ? s.origin?.kind === i.origin.kind && s.origin?.sourceId === i.origin.sourceId : s.id === i.id);
          if (source) i.fields = { ...source.fields };
        }));
        host()?.querySelectorAll<HTMLElement>("[data-album-field]").forEach(n => n.classList.toggle("alb-editor-edited", edited(target(n))));
        repaintPanels();
      } catch { /* Disconnected/deleted source: retain the editor-entry values. */ }
    }
  };
  const act = async (n: HTMLElement) => {
    if (!session) return;
    const a = n.dataset.editAction;
    if (a === "replace-lines" || a === "insert" && n.dataset.kind === "quotes") { const rect = n.getBoundingClientRect(); overlay = ""; paintChrome(); lines.open(selected, a === "insert", n, false, rect); return; }
    if (a === "grip") { host()?.querySelector<HTMLElement>('.ae-tools [data-edit-action="move"]:not(:disabled)')?.focus(); return; }
    if ((a === "pick-value" || a === "pick-apply") && fieldTarget) {
      let value = n.dataset.value ?? "";
      if (a === "pick-apply") {
        const date = host()?.querySelector<HTMLInputElement>("#ae-date")?.value ?? "";
        const end = host()?.querySelector<HTMLInputElement>("#ae-end-date")?.value ?? "";
        const time = host()?.querySelector<HTMLInputElement>("#ae-time")?.value ?? "";
        const raw = read(doc(), fieldTarget);
        const formatDay = (date: string) => raw.match(/\d{4}\.\s*\d/) ? date.split("-").map(Number).join(". ") + "." : date;
        value = fieldTarget.key === "periodLabel" ? [date, end].filter(Boolean).map(formatDay).join(" — ") : date + (date && time ? `${raw.includes("T") ? "T" : " "}${time}` : "");
      }
      overlay = ""; write(fieldTarget, value); closeSheet(); return;
    }
    if (n.dataset.id) selected = n.dataset.id;
    if (a === "photo" || a === "cover-photo") { showPhotos(a === "cover-photo" ? { cover: true } : {}); return; }
    if (a === "done") { const current = document.activeElement as HTMLElement; if (current?.isContentEditable) current.blur(); if (await session.flush()) { const saved = doc(); clear(); hooks.done(saved); } return; }
    if (a === "reload") { const fresh = await api.get(doc().id).catch(() => undefined); if (fresh) await open({ ...fresh.document, revision: fresh.revision }); return; }
    if (a === "retry") { await session.flush(); return; }
    if (a === "undo" || a === "redo") { session[a](); repaint(); return; }
    if (a === "panel") { if (phone()) showSheet("panel", n); else setPanel(!panel); return; }
    if (a === "select") { paintChrome(); scrollToSelected(); return; }
    if (a === "block-menu") { showSheet("block", n); return; }
    if (a === "close-sheet") { closeSheet(); return; }
    if (a === "more") { memoryPicks.clear(); showSheet("more", n); return; }
    if (a === "cards") { if (doc().blocks.find(b => b.id === selected)?.kind === "together") showSheet("cards", n); return; }
    if (a === "toggle-card") {
      const block = doc().blocks.find(b => b.id === selected), card = n.dataset.card as AlbumTogetherCardId;
      if (!block?.together || !availableTogetherCards(block.together).includes(card)) return;
      apply({ ...doc(), blocks: doc().blocks.map(b => b.id === selected ? { ...b, items: b.items.map(i => i.id === card ? { ...i, hidden: !i.hidden } : i) } : b) });
      host()?.querySelector<HTMLInputElement>(`.ae-cards input[data-card="${card}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (a === "insert-together") {
      if (togetherLoading) return;
      const generation = epoch;
      togetherLoading = true; togetherError = ""; repaintPanels();
      try {
        const records = lastTogether ?? (doc().source.sourceAvailable && doc().source.chatId ? await api.together(doc().source.chatId!) : undefined);
        if (generation !== epoch || !session) return;
        lastTogether = records;
        if (!records || !availableTogetherCards(records).length) { togetherError = "아직 담을 기록이 없어요."; return; }
        const next = insertBlock(doc(), selected, "together"), block = next.blocks[next.blocks.findIndex(b => b.id === selected) + 1]!;
        block.together = structuredClone(records); block.items = albumTogetherItems(records); selected = block.id;
        overlay = ""; apply(next); scrollToSelected();
      } catch { if (generation === epoch) togetherError = "기록을 불러오지 못했어요. 다시 눌러 주세요."; }
      finally { if (generation === epoch) { togetherLoading = false; repaintPanels(); } }
      return;
    }
    if (a === "insert-memories") { if (memoryPicks.size) insertMemories(moreItems(), [...memoryPicks]); return; }
    if (a === "insert-memory-block") {
      const kind = n.dataset.kind as AlbumBlockKind, candidates = unused()?.[kind];
      if (candidates?.length && !doc().blocks.some(b => b.kind === kind)) insertMemories(candidates, candidates.map(c => c.item.id), kind);
      return;
    }
    if (a === "person-menu" || a === "person-upload") { void openPerson(n.dataset.person === "partner" ? "partner" : "me", n, a === "person-upload"); return; }
    if (a === "person-pick") { personSelection = n.dataset.key!; paintChrome(); return; }
    if (a === "person-remove") {
      const person = { ...doc().people[personTarget] }; delete person.photoId; delete person.photoSource;
      overlay = ""; apply({ ...doc(), people: { ...doc().people, [personTarget]: person } }); return;
    }
    if (a === "add") { if (!selected) selected = doc().blocks.at(-1)?.id ?? ""; showSheet("add", n); return; }
    if (a === "delete") {
      const id = selected, generation = epoch, block = doc().blocks.find(b => b.id === id); if (!block) return;
      const photos = albumItems(block.items).reduce((n, i) => n + i.photos.length, 0);
      overlay = ""; paintChrome();
      const body = photos ? `'${name(id)}' 블록과 안의 사진 ${photos}장 배치가 빠져요. 사진은 '사진' 패널에 남고, 되돌리기로 다시 살릴 수 있어요.` : `'${name(id)}' 블록이 빠져요. 되돌리기로 다시 살릴 수 있어요.`;
      if (await albumConfirm(root, "블록 지우기", body) && generation === epoch && session) { const next = removeBlock(doc(), id); selected = next.blocks[0]?.id ?? ""; apply(next); }
      return;
    }
    if (a === "move") { apply(moveBlock(doc(), selected, Number(n.dataset.delta))); scrollToSelected(); return; }
    if (a === "hide") { apply(toggleBlockHidden(doc(), selected)); return; }
    if (a === "duplicate") { const next = duplicateBlock(doc(), selected); selected = next.blocks[next.blocks.findIndex(b => b.id === selected) + 1]!.id; overlay = ""; apply(next); scrollToSelected(); if (n.dataset.kind === "photo" || n.dataset.kind === "gallery") showPhotos({ blockId: selected }); return; }
    if (a === "insert" && ["text", "photo", "gallery", "divider"].includes(n.dataset.kind ?? "")) { const next = insertBlock(doc(), selected, n.dataset.kind as "text"); selected = next.blocks[next.blocks.findIndex(b => b.id === selected) + 1]!.id; overlay = ""; apply(next); scrollToSelected(); if (n.dataset.kind === "photo" || n.dataset.kind === "gallery") showPhotos({ blockId: selected }); return; }
    if (a === "theme" && ALBUM_THEMES.includes(n.dataset.theme as AlbumTheme)) { apply(setStyle(doc(), { theme: n.dataset.theme as AlbumTheme })); return; }
    if (a === "tint") { apply(setStyle(doc(), { tint: n.dataset.tint })); return; }
    if (a === "cover-remove") { if (doc().coverPhotoId) apply({ ...doc(), coverPhotoId: undefined, coverFocus: undefined }); return; }
    if (a === "save-text" && fieldTarget) { const value = host()?.querySelector<HTMLTextAreaElement>("textarea")?.value ?? ""; overlay = ""; write(fieldTarget, value); closeSheet(); return; }
    if (a === "restore" && fieldTarget && original) { overlay = ""; write(fieldTarget, read(original, fieldTarget), true); closeSheet(); }
  };
  root.addEventListener("click", e => {
    const n = e.target as HTMLElement; if (!session || !n.closest(".album-edit")) return;
    const action = n.closest<HTMLElement>("[data-edit-action]"); if (action) { e.preventDefault(); e.stopPropagation(); void act(action); return; }
    if (n.closest(".ae-photo-overlay")) return;
    const photoAction = n.closest<HTMLElement>("[data-album-action]");
    if (photoAction?.dataset.albumAction === "clear-caption") {
      e.preventDefault();
      const caption = photoAction.parentElement!.querySelector<HTMLElement>("[data-album-field]")!;
      write(target(caption), ""); return;
    }
    if (photoAction?.dataset.albumAction === "cover-tools") { focusPanel(".ae-cover-tools"); return; }
    if (photoAction?.dataset.albumAction === "person-tools") { void openPerson(photoAction.dataset.person === "me" ? "me" : "partner", photoAction); return; }
    if (photoAction?.dataset.albumAction === "quote-remove") {
      const itemId = photoAction.closest<HTMLElement>("[data-album-item]")!.dataset.albumItem!;
      const blockId = photoAction.closest<HTMLElement>("[data-album-block]")!.dataset.albumBlock!;
      const remove = (items: AlbumItem[]): AlbumItem[] => items.filter(i => i.id !== itemId).map(i => i.children ? { ...i, children: remove(i.children) } : i);
      apply({ ...doc(), blocks: doc().blocks.map(b => b.id === blockId ? { ...b, items: remove(b.items) } : b) }); return;
    }
    if (photoAction?.dataset.albumAction === "nickname-add" || photoAction?.dataset.albumAction === "nickname-remove") {
      const blockId = photoAction.closest<HTMLElement>("[data-album-block]")!.dataset.albumBlock!;
      if (photoAction.dataset.albumAction === "nickname-remove") { removeNickname(blockId, photoAction.closest<HTMLElement>("[data-album-item]")!.dataset.albumItem!); return; }
      const id = `nickname-${crypto.randomUUID()}`, from = photoAction.dataset.from ?? doc().people.me.name, to = photoAction.dataset.to ?? doc().people.partner.name;
      newNicknames.add(id);
      apply({ ...doc(), blocks: doc().blocks.map(b => b.id === blockId ? { ...b, items: [...b.items, { id, fields: { from, to, text: "" }, photos: [], edited: {} }] } : b) });
      host()?.querySelector<HTMLElement>(`[data-album-item="${id}"] [data-album-field]`)?.focus(); return;
    }
    if (photoAction && ["add-photo", "replace-photo", "remove-photo"].includes(photoAction.dataset.albumAction!)) {
      e.preventDefault();
      const itemId = photoAction.closest<HTMLElement>("[data-album-item]")?.dataset.albumItem;
      const blockId = photoAction.closest<HTMLElement>("[data-album-block]")?.dataset.albumBlock;
      const sceneId = doc().blocks.find(b => b.id === blockId)?.kind === "story" ? itemId : undefined;
      const key = photoAction.dataset.albumPhotoField ?? "";
      if (key.startsWith("people.")) { void openPerson(key.includes(".me.") ? "me" : "partner", photoAction); return; }
      if (photoAction.dataset.albumAction === "remove-photo") {
        let next = structuredClone(doc());
        const id = photoAction.dataset.photoId!;
        if (key === "coverPhotoId") delete next.coverPhotoId;
        else { const item = albumItems(next.blocks.find(b => b.id === blockId)?.items ?? []).find(i => i.id === itemId); if (item) item.photos = item.photos.filter(p => p.photoId !== id); }
        apply(next); return;
      }
      showPhotos({ sceneId, blockId: sceneId ? undefined : blockId, itemId, cover: key === "coverPhotoId", person: key.startsWith("people.") ? key.includes(".me.") ? "me" : "partner" : undefined, replaceId: photoAction.dataset.albumAction === "replace-photo" ? photoAction.dataset.photoId : undefined }); return;
    }
    if (photoAction?.dataset.albumAction === "album-photo-open" || n.closest(".av-overlay")) return;
    if (n.closest(".ae-panel,.ae-overlay,.ae-head,.alb-person-tools")) return;
    const field = n.closest<HTMLElement>("[data-album-field]"); if (field?.hasAttribute("data-pick")) { e.preventDefault(); fieldTarget = target(field); selected = fieldTarget.blockId; if (fieldTarget.key === "coverLineId") { lines.open(selected, false, field, true); return; } showSheet("picker", field); return; }
    if (field) return;
    const section = n.closest<HTMLElement>("[data-album-block]"); if (section) { selected = section.dataset.albumBlock!; if (phone() && !n.closest("summary,input,button")) showSheet("block", section); else paintChrome(); }
  });
  root.addEventListener("change", e => {
    const input = e.target as HTMLInputElement;
    if (!session || overlay !== "more" || !input.matches(".ae-more-sheet input[data-memory-id]")) return;
    if (input.checked) memoryPicks.add(input.dataset.memoryId!); else memoryPicks.delete(input.dataset.memoryId!);
    const add = host()?.querySelector<HTMLButtonElement>('[data-edit-action="insert-memories"]');
    if (add) { add.textContent = memoryPicks.size ? `${memoryPicks.size}개 넣기` : "넣기"; add.disabled = !memoryPicks.size; }
  });
  root.addEventListener("animationend", e => { if (e.animationName === "ae-fresh") (e.target as HTMLElement).classList.remove("ae-fresh"); });
  root.addEventListener("focusin", e => {
    const n = e.target as HTMLElement; if (!session || !n.matches(".album-edit [data-album-field]")) return;
    if (typeof getComputedStyle === "function") decorateRings([n]);
    const t = target(n); fieldTarget = t; selected = t.blockId;
    if (n.hasAttribute("data-pick")) { paintChrome(); return; }
    n.classList.add("alb-editor-editing");
    n.dataset.editStart = n.innerText; paintChrome();
  });
  root.addEventListener("focusout", e => {
    const n = e.target as HTMLElement; if (!session || !n.matches(".album-edit [data-album-field]") || n.dataset.editStart === undefined) return;
    n.classList.remove("alb-editor-editing");
    const t = target(n);
    if (newNicknames.has(t.itemId)) { newNicknames.delete(t.itemId); n.classList.remove("rd-call-new"); if (!n.innerText.trim()) { delete n.dataset.editStart; const word = n.closest(".rd-call-word"); const separator = word?.previousElementSibling?.matches(".rd-call-sep") ? word.previousElementSibling : word?.nextElementSibling?.matches(".rd-call-sep") ? word.nextElementSibling : null; separator?.remove(); word?.remove(); removeNickname(t.blockId, t.itemId, false); return; } }
    const value = n.innerText; if (value !== n.dataset.editStart) write(target(n), value, false, false); n.classList.toggle("alb-editor-edited", edited(target(n))); delete n.dataset.editStart;
  });
  root.addEventListener("input", e => {
    const n = e.target as HTMLElement;
    if (session && n.matches(".album-edit [data-placeholder]") && !n.textContent) n.replaceChildren();
  });
  root.addEventListener("paste", e => {
    const n = e.target as HTMLElement; if (!session || !n.isContentEditable || !n.closest(".album-edit")) return;
    e.preventDefault(); const text = e.clipboardData?.getData("text/plain") ?? "", sel = window.getSelection(); if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0); range.deleteContents(); const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true); sel.removeAllRanges(); sel.addRange(range);
  });
  root.addEventListener("keydown", e => {
    if (!session || photos.active || lines.active || photoTools.editing || !(e.target as HTMLElement).closest(".album-edit")) return;
    const n = e.target as HTMLElement;
    if ((e.key === "Enter" || e.key === " ") && n.matches('[role="button"][data-album-action]')) { e.preventDefault(); n.click(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !n.matches("textarea")) { e.preventDefault(); if (n.isContentEditable) n.blur(); session[e.shiftKey ? "redo" : "undo"](); repaint(); return; }
    if (e.key === "Enter" && !e.isComposing && n.isContentEditable && newNicknames.has(target(n).itemId)) { e.preventDefault(); n.blur(); return; }
    if (e.key === "Escape") { if (drag) { e.preventDefault(); finishDrag(false); } else if (overlay) { e.preventDefault(); closeSheet(); } else if (n.isContentEditable) { n.textContent = n.dataset.editStart ?? ""; n.blur(); } return; }
    if (e.key === "Enter" && !e.isComposing && n.isContentEditable && ["title", "date", "caption", "speaker", "subtitle", "periodLabel", "people.me.name", "people.partner.name"].includes(n.dataset.albumField ?? "")) { e.preventDefault(); n.blur(); return; }
    if ((e.key === "Enter" || e.key === " ") && !n.isContentEditable && n.matches("[data-album-field],[data-album-block]")) { e.preventDefault(); n.click(); if (!phone() && !n.hasAttribute("data-album-field")) host()?.querySelector<HTMLElement>(".ae-tools button")?.focus(); }
    if (e.key === "Tab" && overlay) {
      const nodes = [...host()!.querySelectorAll<HTMLElement>(".ae-overlay button:not(:disabled),.ae-overlay textarea,.ae-overlay input:not([hidden]):not(:disabled)")].filter(n => n.getClientRects().length);
      if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1)?.focus(); }
      if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0]?.focus(); }
    }
  });
  root.addEventListener("scroll", e => { if (session && (e.target as HTMLElement).matches(".ae-scroll")) positionTools(); }, true);
  const updateDrag = () => {
    const d = drag; if (!d || !d.lifted) return;
    const list = d.row.parentElement!, rows = [...list.querySelectorAll<HTMLElement>("[data-drop-id]")].filter(n => n !== d.row);
    const before = rows.find(n => d.y < n.getBoundingClientRect().top + n.offsetHeight / 2);
    d.destination = before ? rows.indexOf(before) : rows.length;
    const edge = before?.getBoundingClientRect().top ?? rows.at(-1)?.getBoundingClientRect().bottom ?? list.getBoundingClientRect().top;
    d.indicator.style.top = `${edge - list.getBoundingClientRect().top - 1.5}px`;
    d.ghost.style.left = `${d.x + 12}px`; d.ghost.style.top = `${d.y - 20}px`;
    const ids = doc().blocks.filter(b => b.id !== d.id), landing = ids[d.destination];
    const page = [...host()!.querySelectorAll<HTMLElement>("[data-album-block]")];
    const section = page.find(n => n.dataset.albumBlock === (landing?.id ?? ids.at(-1)?.id));
    const scroll = host()!.querySelector<HTMLElement>(".ae-scroll")!, sr = scroll.getBoundingClientRect();
    if (section) {
      const r = section.getBoundingClientRect(), boundary = landing ? r.top : r.bottom;
      // Bring the actual stored-order landing boundary into the canvas viewport.
      const sheetTop = host()?.querySelector(".ae-sheet")?.getBoundingClientRect().top ?? sr.bottom;
      const visibleBottom = Math.min(sr.bottom, sheetTop), middle = sr.top + (visibleBottom - sr.top) / 2;
      if (boundary < sr.top + 16 || boundary > visibleBottom - 16) scroll.scrollTop += boundary - middle;
      const rect = section.getBoundingClientRect();
      d.pageLine.style.setProperty("--drop-accent", getComputedStyle(section).getPropertyValue("--editor-accent"));
      d.pageLine.style.top = `${(landing ? rect.top : rect.bottom) - sr.top + scroll.scrollTop - 2}px`;
      d.pageLine.style.left = `${Math.max(12, rect.left - sr.left + 12)}px`;
      d.pageLine.style.width = `${Math.max(0, Math.min(rect.width - 24, sr.width - 24))}px`;
    }
  };
  const finishDrag = (drop: boolean) => {
    const d = drag; if (!d) return; drag = undefined; cancelAnimationFrame(d.frame);
    if (d.grip.hasPointerCapture(d.pointer)) d.grip.releasePointerCapture(d.pointer);
    d.ghost.remove(); d.indicator.remove(); d.pageLine.remove(); d.row.classList.remove("ae-dragging");
    if (drop && d.lifted) { selected = d.id; const from = doc().blocks.findIndex(b => b.id === d.id); apply(moveBlock(doc(), d.id, d.destination - from)); scrollToSelected(); }
  };
  root.addEventListener("pointerdown", e => {
    const n = (e.target as HTMLElement).closest<HTMLElement>(".ae-block-list [data-drag-id]");
    if (!session || !n || e.button !== 0 || drag) return;
    e.preventDefault(); n.focus({ preventScroll: true }); n.setPointerCapture(e.pointerId);
    const row = n.closest<HTMLElement>("[data-drop-id]")!, ghost = document.createElement("div"), indicator = document.createElement("div"), pageLine = document.createElement("div");
    ghost.className = "ae-ghost"; ghost.textContent = name(n.dataset.dragId!); ghost.style.width = `${row.offsetWidth}px`;
    indicator.className = "ae-drag-ind"; pageLine.className = "ae-drop-line";
    for (const node of [ghost, indicator, pageLine]) node.setAttribute("aria-hidden", "true");
    drag = { id: n.dataset.dragId!, pointer: e.pointerId, grip: n, row, ghost, indicator, pageLine, destination: 0, startX: e.clientX, startY: e.clientY, lifted: false, x: e.clientX, y: e.clientY, frame: 0 };
  });
  root.addEventListener("pointermove", e => {
    const d = drag; if (!d || e.pointerId !== d.pointer) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.lifted && Math.hypot(d.x - d.startX, d.y - d.startY) >= 4) {
      d.lifted = true; d.row.classList.add("ae-dragging"); d.row.parentElement!.append(d.indicator); host()!.append(d.ghost); host()!.querySelector(".ae-scroll")!.append(d.pageLine);
      const tick = () => { if (!drag) return; const pane = d.row.closest<HTMLElement>(".ae-panel,.ae-sheet-body"); if (pane) { const r = pane.getBoundingClientRect(); const delta = d.y > r.bottom - 32 ? 8 : d.y < r.top + 32 ? -8 : 0; if (delta) { pane.scrollTop += delta; updateDrag(); } } d.frame = requestAnimationFrame(tick); }; d.frame = requestAnimationFrame(tick);
    }
    updateDrag();
  });
  root.addEventListener("pointerup", e => { if (drag?.pointer === e.pointerId) finishDrag(true); });
  root.addEventListener("pointercancel", e => { if (drag?.pointer === e.pointerId) finishDrag(false); });
  root.addEventListener("lostpointercapture", e => { if (drag?.pointer === e.pointerId) finishDrag(false); });
  return { open, clear, hydrate, async applyUpdate(next: AlbumDocument) { apply(next); return session!.flush(); }, get document() { return session ? doc() : undefined; }, get active() { return Boolean(session); }, render() {
    if (!session) return ""; if (html) return html;
    const rendered = renderAlbum(doc(), { mode: "edit", photoSrc: hooks.photoSrc, storedPhotos: photoTools.stored, uploadingPhotos: photoTools.uploads });
    return html = `<section class="album-view album-edit" data-skin="phone"><style>${rendered.css}${ALBUM_EDIT_CONTENT_CSS}</style><div class="ae-base${panel ? " ae-has-panel" : ""}">${renderScreenBar(`<div class="ae-title"><b>${esc(doc().title)}</b><span class="ae-status" data-status="${session.status}" role="status" aria-live="polite">${session.message}</span>${button("reload", "새로 불러오기", session.status === "conflict" ? "" : "hidden")}${button("retry", "다시 저장", session.status === "error" ? "" : "hidden")}</div>${button("undo", undoIcon, `class="ae-undo" aria-label="되돌리기 (Ctrl+Z)" ${session.canUndo ? "" : "disabled"}`)}${button("redo", redoIcon, `class="ae-pc" aria-label="다시 하기 (Ctrl+Shift+Z)" ${session.canRedo ? "" : "disabled"}`)}${button("photo", icon("album") + "사진 고르기", 'class="ae-pc"')}${button("panel", icon("edit") + "꾸미기", `class="ae-pc" aria-pressed="${panel}"`)}${button("done", "완료", 'class="ae-primary ae-done"')}`, "ae-head")}<div class="ae-scroll">${rendered.html}${doc().blocks.length ? "" : button("add", icon("add") + "블록 추가")}</div>${panel ? `<aside class="ae-panel" aria-label="전체 꾸미기">${panelBody()}</aside>` : ""}<nav class="ae-dock" aria-label="꾸미기 도구">${button("photo", icon("album") + "사진")}${button("add", icon("add") + "블록 추가")}${button("panel", icon("edit") + "꾸미기")}</nav></div><div class="ae-tools" role="toolbar" aria-label="블록 꾸미기"></div><div class="ae-overlay">${sheetHtml()}</div><div class="ae-photo-overlay"></div><div class="ae-line-overlay"></div><div class="av-overlay"></div></section>`;
  } };
}
