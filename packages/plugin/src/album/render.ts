import { ALBUM_THEMES, albumDay, albumDayDots, albumPeriod, albumPeriodDots, albumPromiseDay, albumDateFormat, albumLine, albumLyricLines, albumParticle, albumPromiseStatus, albumStatusLabel, parseStoryTime, resolveAlbumTint, albumCoverQuote, sortAlbumItemsByDate, sortAlbumFirsts, type AlbumBlock, type AlbumBlockKind, type AlbumDocument, type AlbumItem, albumGalleryLayout, albumDefaultFit, albumImageRatio, albumPhotoRatio, albumPhotoGroupLayout, type AlbumPhotoFit, type AlbumPhotoShape, type AlbumImageSize, type AlbumTheme } from "@rcm/shared";
import { escapeHtml as esc, icon } from "../dashboard/film/ui.js";
import { albumThemeCss, albumThemeVoice } from "./themes/index.js";

export interface AlbumSection { id: string; blockId: string; label: string; number: string }
export interface AlbumRenderOptions {
  mode: "view" | "edit" | "export";
  /** Only cached Blob URLs or raster data URIs; rendering never fetches. */
  photoSrc: (photoId: string, size: "thumb" | "full") => string;
  theme?: AlbumTheme;
  /** Public, sequential photo index for the standalone file; never a stored id. */
  exportPhotoIndex?: (photoId: string) => number | undefined;
  uploadingPhotos?: readonly { key: string; state: "uploading" | "error"; message?: string; sceneId?: string; blockId?: string; cover?: boolean }[];
  storedPhotos?: readonly ({ id: string } & AlbumImageSize)[];
}
interface Context { doc: AlbumDocument; options: AlbumRenderOptions; theme: AlbumTheme; index: number; chapters: AlbumItem[]; dates: ReturnType<typeof albumDateFormat> }
const editAttr = (key: string, value: string, c: Context) => c.options.mode === "edit" ? ` data-album-${key}="${esc(value)}"` : "";
const field = (tag: string, key: string, value: string | undefined, c: Context, cls = "") => {
  const pick = ["date", "side", "who", "direction", "from", "to", "status", "periodLabel"].includes(key);
  const placeholder = key.includes("caption") ? "설명 쓰기" : key === "title" ? "제목 쓰기" : "글 쓰기";
  return `<${tag} class="alb-field ${cls}"${editAttr("field", key, c)}${c.options.mode === "edit" ? pick ? ` data-pick="${key}"` : ` data-placeholder="${placeholder}"` : ""}>${["side", "who", "direction"].includes(key) ? readingSide(value, c) : esc(key === "date" ? c.dates.date(value) : value ?? "")}</${tag}>`;
};
const docField = (tag: string, key: string, value: string | undefined, c: Context, cls = "") => field(tag, key, value, c, cls).replace(`<${tag} `, `<${tag}${editAttr("scope", "document", c)} `);
const wrap = (item: AlbumItem, cls: string, html: string, c: Context, tag = "div") => `<${tag} class="alb-item ${cls}"${editAttr("item", item.id, c)}>${html}</${tag}>`;
const visible = (doc: AlbumDocument) => doc.blocks.filter(b => !b.hidden);
const isChapter = (i: AlbumItem) => i.origin?.kind === "chapter" || Boolean(i.children?.some(child => child.fields.title !== undefined || child.fields.summary !== undefined));
const scenes = (chapter: AlbumItem) => isChapter(chapter) ? chapter.children ?? [] : [chapter];
const textKey = (i: AlbumItem) => ["text", "body", "summary", "title"].find(key => i.fields[key] !== undefined) ?? "text";
const two = (n: number) => String(n).padStart(2, "0");
function side(value: string | undefined, c: Pick<Context, "doc">): string {
  if (!value) return "";
  const { me, partner } = c.doc.people;
  const labels: Record<string, string> = { me: me.name, persona: me.name, partner: partner.name, character: partner.name,
    me_to_partner: `${albumParticle(me.name, "이", "가")} ${partner.name}에게`, partner_to_me: `${albumParticle(partner.name, "이", "가")} ${me.name}에게`, mutual: `${albumParticle(me.name, "과", "와")} ${partner.name}` };
  return Object.hasOwn(labels, value) ? labels[value]! : [me.name, partner.name].includes(value) ? value : "";
}
function directionPeople(i: AlbumItem, c: Pick<Context, "doc">): { from: string; to: string } {
  let from = side(i.fields.from, c) || i.fields.from || "", to = side(i.fields.to, c) || i.fields.to || "";
  const code = i.fields.who ?? i.fields.direction ?? i.fields.side;
  if (!from && !to && (code === "me_to_partner" || code === "partner_to_me")) {
    from = c.doc.people[code === "me_to_partner" ? "me" : "partner"].name;
    to = c.doc.people[code === "me_to_partner" ? "partner" : "me"].name;
  }
  return { from, to };
}
/** Plain text counterpart of the reader's direction, status and date line. */
export function albumItemSecondaryText(item: AlbumItem, doc: AlbumDocument): string {
  const { from, to } = directionPeople(item, { doc }), code = item.fields.who ?? item.fields.direction ?? item.fields.side;
  const people = from && to ? `${from} → ${to}` : from || to || (code === "both" || code === "mutual" ? `${doc.people.me.name} · ${doc.people.partner.name}` : side(code, { doc }));
  const status = item.fields.status ? ({ done: "했어요", not_yet: "아직", unknown: "기록 없음" }[item.fields.status] ?? albumStatusLabel(item.fields.status)) : "";
  return [people || item.fields.speaker, status, albumDay(item.fields.date)].filter(Boolean).join(" · ");
}
function value(key: string, raw: string, c: Context): string {
  if (["from", "to"].includes(key) && ["me", "persona", "partner", "character"].includes(raw)) return side(raw, c);
  if (["side", "who", "direction"].includes(key)) return raw;
  if (key === "status") {
    const labels: Record<string, string> = { done: "함께 이룸", not_yet: "아직", unknown: "기록 없음", kept: "지킴", broken: "깨짐", pending: "진행 중", open: "진행 중" };
    return Object.hasOwn(labels, raw) ? labels[raw]! : "";
  }
  if (key === "location" && c.options.mode !== "edit") return raw.split(",")[0]?.trim() ?? "";
  if (key === "date") return raw;
  return raw;
}
function fields(i: AlbumItem, c: Context) {
  return {
    get(key: string, tag = "p", cls = "", display?: string) {
      if (i.fields[key] === undefined && display === undefined && c.options.mode !== "edit") return "";
      return field(tag, key, display ?? value(key, i.fields[key] ?? "", c), c, cls);
    },
  };
}
function uploadingPhotos(c: Context, itemId?: string, blockId?: string, cover = false): string {
  return (c.options.uploadingPhotos ?? []).filter(p => cover ? p.cover : itemId ? p.sceneId === itemId : blockId ? p.blockId === blockId : false).map(p => `<div class="alb-upload-tile" role="status">${p.state === "uploading" ? `<span class="ap-spinner">${icon("refresh")}</span><span>올리는 중…</span>` : `<span>${esc(p.message || "사진을 올리지 못했어요.")}</span>`}</div>`).join("");
}
function photo(id: string | undefined, caption: string, c: Context, key = "photos", captionKey?: string, fit?: AlbumPhotoFit, size: AlbumImageSize = {}): string {
  const variant = c.options.mode === "export" ? "full" : "thumb";
  const src = id ? c.options.photoSrc(id, variant) : "";
  const usable = src.startsWith("blob:") || /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(src);
  const edit = c.options.mode === "edit";
  const pending = edit && key === "coverPhotoId" ? uploadingPhotos(c, undefined, undefined, true) : "";
  let image = usable ? `<img class="ph" src="${esc(src)}" alt="${esc(caption)}" loading="${key === "coverPhotoId" ? "eager" : "lazy"}" decoding="async">`
    : pending ? pending : edit ? `<button type="button" class="slot xp-slot alb-photo-slot" data-album-action="add-photo" data-album-photo-field="${esc(key)}">${key === "coverPhotoId" ? "표지 사진 넣기" : key.startsWith("people.") ? "사진" : "사진 넣기"}</button>` : "";
  if (!image) return "";
  let ratio = 1;
  {
    const source = c.options.storedPhotos?.find(p => p.id === id);
    const sourceRatio = albumImageRatio({ width: size.width ?? source?.width, height: size.height ?? source?.height });
    if (key === "coverPhotoId") { const focus = c.doc.coverFocus; fit = { ...albumDefaultFit(c.theme === "lp" ? "square" : "portrait"), ...focus }; }
    if (!key.startsWith("people.")) {
      fit ??= albumDefaultFit("original"); ratio = albumPhotoRatio(fit.shape, sourceRatio);
      // The image box always covers the frame. Scaling around the same focus preserves legal pan edges.
      image = image.replace('<img ', `<img style="width:100%;height:100%;max-width:none;max-height:none;object-fit:cover;object-position:${fit.x}% ${fit.y}%;transform:scale(${fit.zoom});transform-origin:${fit.x}% ${fit.y}%" `);
      image = `<span class="alb-photo-frame alb-fit-frame" data-fit-shape="${fit.shape}" style="aspect-ratio:${ratio}">${image}</span>`;
    } else image = `<span class="alb-photo-frame">${image.replace('<img ', '<img style="width:100%;height:100%;object-fit:cover;object-position:50% 50%" ')}</span>`;
  }
  const tools = edit && usable && !key.startsWith("people.") ? `<span class="ptools"><button type="button" data-album-action="replace-photo" data-album-photo-field="${esc(key)}" data-photo-id="${esc(id!)}" aria-label="사진 바꾸기">↻</button>${`<button type="button" data-album-action="fit-photo" data-album-photo-field="${esc(key)}">맞추기</button>`}<button type="button" data-album-action="remove-photo" data-album-photo-field="${esc(key)}" data-photo-id="${esc(id!)}" aria-label="사진 빼기">×</button></span>` : "";
  const publicIndex = c.options.mode === "export" && id && !key.startsWith("people.") ? c.options.exportPhotoIndex?.(id) : undefined;
  const exportedAction = publicIndex !== undefined ? ` tabindex="0" role="button" aria-label="${esc(caption || "사진 크게 보기")}" data-photo-index="${publicIndex}"` : "";
  const captionHtml = captionKey ? edit ? `<div class="alb-photo-caption">${field("figcaption", captionKey, caption, c)}${caption ? `<button type="button" class="caption-x" data-album-action="clear-caption" data-album-photo-field="${esc(captionKey)}" aria-label="사진 설명 지우기">×</button>` : ""}</div>` : caption ? `<figcaption>${esc(caption)}</figcaption>` : "" : "";
  const coverAction = edit && usable && key === "coverPhotoId" ? ' tabindex="0" role="button" aria-label="표지 사진 꾸미기" data-album-action="cover-tools"' : "";
  return `<figure class="alb-photo${key.startsWith("people.") ? " alb-person-photo" : ""}${tools ? " xp-has" : ""}"${coverAction}${c.options.mode === "view" && id && !key.startsWith("people.") ? ` tabindex="0" role="button" aria-label="${esc(caption || "사진 크게 보기")}" data-album-action="album-photo-open" data-photo-id="${esc(id)}"` : exportedAction}${key === "coverPhotoId" || key.startsWith("people.") ? editAttr("scope", "document", c) : ""}>${tools ? `<div class="alb-photo-image">${image}${tools}</div>` : image}${captionHtml}</figure>`;
}
function count(c: Context) {
  const blocks = visible(c.doc), intro = blocks.find(b => b.kind === "intro")?.items[0]?.fields;
  const read = (key: string, fallback: number) => /^\d+$/.test(intro?.[key] ?? "") ? Number(intro![key]) : fallback;
  const promises = blocks.filter(b => b.kind === "promises").flatMap(b => b.items);
  return { scenes: read("scenes", c.chapters.flatMap(scenes).length), chapters: read("chapters", c.chapters.length), promises: read("promises", promises.length), kept: promises.filter(i => albumPromiseStatus(i.fields.status) === "kept").length };
}
const READING_SKINS: Record<AlbumTheme, { rail: boolean; callsSection: boolean; sides: boolean; lyricColumn: boolean; disc: boolean; paper: boolean }> = {
  book: { rail: false, callsSection: false, sides: false, lyricColumn: false, disc: false, paper: false },
  program: { rail: true, callsSection: true, sides: false, lyricColumn: false, disc: false, paper: false },
  lp: { rail: false, callsSection: true, sides: true, lyricColumn: true, disc: true, paper: false },
  film: { rail: false, callsSection: false, sides: false, lyricColumn: false, disc: false, paper: true },
};
const readingSkin = (c: Context) => READING_SKINS[c.theme];
const readingPair = (from: string, to: string) => `${esc(from)} <span class="rd-arrow" aria-label="에게">→</span> ${esc(to)}`;
/** Product-owned direction codes only; names never select a grammatical particle. */
function readingSide(code: string | undefined, c: Context): string {
  const { me, partner } = c.doc.people;
  if (code === "me_to_partner") return readingPair(me.name, partner.name);
  if (code === "partner_to_me") return readingPair(partner.name, me.name);
  if (code === "mutual" || code === "both") return `${esc(me.name)} · ${esc(partner.name)}`;
  return esc(side(code, c));
}
function readingDirection(i: AlbumItem, c: Context): string {
  const { from, to } = directionPeople(i, c);
  return from && to ? readingPair(from, to) : esc(from || to) || readingSide(i.fields.who ?? i.fields.direction ?? i.fields.side, c);
}
function letterPerson(i: AlbumItem, key: "from" | "to", display: string, c: Context): string {
  if (c.options.mode !== "edit") return esc(display);
  const storedKey = i.fields[key] !== undefined ? key : ["who", "direction", "side"].find(k => i.fields[k] !== undefined) ?? key;
  return field("span", storedKey, display, c).replace('<span ', `<span data-person-end="${key}" `);
}
function editableDirection(i: AlbumItem, c: Context): string {
  if (c.options.mode !== "edit") return readingDirection(i, c);
  if (i.fields.from !== undefined || i.fields.to !== undefined) {
    const { from, to } = directionPeople(i, c);
    return `${letterPerson(i, "from", from, c)} <span class="rd-arrow">→</span> ${letterPerson(i, "to", to, c)}`;
  }
  const key = ["who", "direction", "side"].find(k => i.fields[k] !== undefined) ?? "side";
  return field("span", key, i.fields[key] ?? "mutual", c);
}
const RECORD_KINDS: readonly AlbumBlockKind[] = ["nicknames", "firsts", "bond", "progress", "intimacy"];
const RECORDS_LABEL = "기록";
const isLoose = (i: AlbumItem) => i.id.startsWith("unassigned:") || Boolean(i.origin?.sourceId.startsWith("unassigned:"));
const lineKey = (i: AlbumItem) => i.origin?.sourceId ?? albumLine(i).trim();
const readingTitle = (block: AlbumBlock, c: Context) => block.title ?? albumThemeVoice(c.theme).blocks[block.kind].title;
function sceneDates(chapter: AlbumItem): string[] {
  return sortAlbumItemsByDate(scenes(chapter)).map(s => s.fields.date).filter((v): v is string => Boolean(v));
}
function readingSpan(chapter: AlbumItem): string {
  const dates = sceneDates(chapter), first = albumDay(dates[0] ?? chapter.fields.date), last = albumDay(dates.at(-1) ?? chapter.fields.date);
  return first === last ? first : `${first} – ${last}`;
}
/** A loose chapter shows its first day; the stored internal label is never printed unless the user wrote one. */
export function chapterTitle(chapter: AlbumItem): string {
  return (isLoose(chapter) && !chapter.edited.title || !chapter.fields.title?.trim()) ? albumDay(sceneDates(chapter)[0] ?? chapter.fields.date) : chapter.fields.title;
}
/** In-album jump: the viewer scrolls its own scroller; the saved file uses plain anchors. */
function jump(id: string, inner: string, c: Context): string {
  if (c.options.mode === "edit") return `<span>${inner}</span>`;
  return c.options.mode === "export" ? `<a href="#${esc(id)}">${inner}</a>`
    : `<button type="button" class="rd-jump" data-album-action="album-jump" data-value="${esc(id)}">${inner}</button>`;
}
type PhotoEntry = { ref: AlbumItem["photos"][number]; index: number; item?: AlbumItem };
function readingPhotoGroup(entries: PhotoEntry[], c: Context, cls: string, columns?: number, shape?: AlbumPhotoShape, uniform = false): string {
  const sizes = entries.map(({ ref }) => { const meta = c.options.storedPhotos?.find(p => p.id === ref.photoId); return { ...ref, width: ref.width ?? meta?.width, height: ref.height ?? meta?.height }; });
  const layout = albumPhotoGroupLayout(sizes, shape);
  const frames = entries.map(({ ref, index, item }, n) => {
    const frame = readingPrint(photo(ref.photoId, ref.caption ?? "", c, `photos.${index}`, `photos.${index}.caption`, { ...albumDefaultFit(layout.shape), ...ref.fit, ...(uniform ? { shape: layout.shape } : {}) }, sizes[n]), c);
    if (!frame) return "";
    const content = item ? wrap(item, "", frame, c) : frame;
    const end = n + 1;
    return `<div class="alb-photo-cell" style="--album-photo-ratio:${layout.ratios[n]}">${content}</div>${!uniform && end < entries.length ? `<span aria-hidden="true" class="alb-photo-break${end % 2 === 0 ? " alb-break-two" : ""}${end % 3 === 0 ? " alb-break-three" : ""}"></span>` : ""}`;
  }).filter(Boolean);
  return frames.length ? `<div class="${cls} alb-photo-set${layout.justified ? " alb-photo-justified" : ""}"${columns ? ` data-set-columns="${columns}"` : ""}>${frames.join("")}</div>` : "";
}
function readingPhotos(i: AlbumItem, c: Context): string {
  const frames = readingPhotoGroup(i.photos.map((ref, index) => ({ ref, index })), c, `rd-plates n${Math.min(i.photos.length, 5)}`);
  const pending = uploadingPhotos(c, i.id);
  if (frames || pending) return frames + pending;
  return c.options.mode === "edit" ? '<button type="button" class="xp-slot" data-album-action="add-photo" data-album-photo-field="photos">사진 넣기</button>' : "";
}
/** Matte corners decorate an existing photo; missing images never create a prop. */
function readingPrint(frame: string, c: Context): string {
  if (!frame || !readingSkin(c).paper) return frame;
  return frame.replace('class="alb-photo', 'class="rd-print alb-photo').replace('</figure>', '<i class="c1" aria-hidden="true"></i><i class="c2" aria-hidden="true"></i><i class="c3" aria-hidden="true"></i><i class="c4" aria-hidden="true"></i></figure>');
}
function readingLine(q: AlbumItem, c: Context): string {
  if (c.options.mode !== "edit" && !albumLine(q).trim()) return "";
  const f = fields(q, c), key = textKey(q);
  let text = f.get(key, "p");
  if (readingSkin(c).lyricColumn) text = `<p class="alb-field"${editAttr("field", key, c)}>${albumLyricLines(albumLine(q)).map(line => `<span>${esc(line)}</span>`).join("")}</p>`;
  return wrap(q, "rd-line", `${c.options.mode === "edit" ? '<button type="button" class="quote-x" data-album-action="quote-remove" aria-label="대사 지우기">×</button>' : ""}${text}${q.fields.speaker ? `<cite>${f.get("speaker", "span")}</cite>` : ""}`, c, "blockquote");
}
function readingScene(s: AlbumItem, c: Context): string {
  const f = fields(s, c), day = albumDay(s.fields.date), place = s.fields.location ?? "";
  if (readingSkin(c).paper) {
    const parsed = parseStoryTime(s.fields.date);
    const numeric = parsed.calendar === "numeric" && parsed.month !== undefined && parsed.day !== undefined;
    const date = day || c.options.mode === "edit" ? f.get("date", "span", numeric ? "rd-stamp" : "", albumDayDots(s.fields.date)) : "";
    const where = [place || c.options.mode === "edit" ? f.get("location", "span", "", place) : ""].filter(Boolean).join(" · ");
    const lines = (s.children ?? []).filter(q => c.options.mode === "edit" || !q.hidden && Boolean(albumLine(q).trim())).map(q => readingLine(q, c)).join("");
    return wrap(s, "rd-scene", `${date || where ? `<p class="rd-at">${date}${where ? `<span>${where}</span>` : ""}</p>` : ""}${f.get("title", "h3")}${f.get("summary", "p", "rd-body")}${readingPhotos(s, c)}${lines}`, c, "article");
  }
  if (readingSkin(c).lyricColumn) {
    const lines = (s.children ?? []).filter(q => c.options.mode === "edit" || !q.hidden && Boolean(albumLine(q).trim()));
    const edit = c.options.mode === "edit";
    const at = [day || edit ? f.get("date", "span", "", day) : "", place || edit ? f.get("location", "span", "", place) : ""].filter(Boolean).join(" · ");
    return wrap(s, `rd-scene${lines.length ? "" : " solo"}`, `<div class="rd-text">${f.get("title", "h3")}${at ? `<p class="rd-at">${at}</p>` : ""}${f.get("summary", "p", "rd-body")}${readingPhotos(s, c)}</div>${lines.length ? `<aside class="rd-lyric">${lines.map(q => readingLine(q, c)).join("")}</aside>` : ""}`, c, "article");
  }
  const note = `${s.fields.date !== undefined ? f.get("date", "b", "rd-day", day) : ""}${f.get("location", "span", "rd-place", place)}`;
  const inline = c.options.mode === "edit" ? [f.get("date", "span", "", day), f.get("location", "span", "", place)].filter(Boolean).join(" · ") : [day, place].filter(Boolean).map(esc).join(" · ");
  const lines = (s.children ?? []).filter(q => c.options.mode === "edit" || !q.hidden && Boolean(albumLine(q).trim())).map(q => readingLine(q, c)).join("");
  return wrap(s, "rd-scene rd-row", `<aside class="rd-note">${note}</aside><div class="rd-text">${inline ? `<p class="rd-inline-note"${c.options.mode === "edit" ? "" : ' aria-hidden="true"'}>${inline}</p>` : ""}${f.get("title", "h3")}${f.get("summary", "p", "rd-body")}${readingPhotos(s, c)}${lines}</div>`, c, "article");
}
/** Codes depend only on the visible chapter count and its stored position. */
function readingTrack(n: number, c: Context): string {
  if (!readingSkin(c).sides) return String(n);
  const edit = c.options.mode === "edit";
  const half = Math.ceil(c.doc.blocks.filter(block => block.kind === "story" && (edit || !block.hidden)).flatMap(block => block.items).filter(chapter => edit || !chapter.hidden).length / 2);
  return n <= half ? `A${n}` : `B${n - half}`;
}
function readingChapter(chapter: AlbumItem, n: number, id: string, c: Context): string {
  if (!isChapter(chapter)) return readingScene(chapter, c);
  const f = fields(chapter, c), rows = scenes(chapter).filter(s => c.options.mode === "edit" || !s.hidden);
  const title = (tag: string) => isLoose(chapter) && !chapter.edited.title && c.options.mode === "edit"
    ? f.get("title", tag, "", "").replace('data-placeholder="제목 쓰기"', `data-placeholder="${esc(chapterTitle(chapter))}"`)
    : f.get("title", tag, "", chapterTitle(chapter));
  const span = [isLoose(chapter) ? "" : readingSpan(chapter), `장면 ${rows.length}`].filter(Boolean).join(" · ");
  if (readingSkin(c).paper) {
    const head = `<header><h2><i aria-hidden="true">${n}</i>${title("span")}</h2><p class="rd-span">${esc(span)}</p>${chapter.fields.summary?.trim() || c.options.mode === "edit" ? f.get("summary", "p", "rd-lede") : ""}</header>`;
    return `<section class="rd-chapter rd-col alb-item"${editAttr("item", chapter.id, c)}${c.options.mode === "edit" ? "" : ` id="${id}" tabindex="-1"`}><div class="rd-dbl"></div>${head}${chapter.photos.length ? `<div class="rd-chapter-art">${readingPhotos(chapter, c)}</div>` : ""}${rows.map(s => readingScene(s, c)).join("")}</section>`;
  }
  if (readingSkin(c).sides) {
    const head = `<header class="rd-row"><span class="rd-num" aria-hidden="true">${readingTrack(n, c)}</span><div class="rd-text">${title("h2")}<p class="rd-span">${esc(span)}</p></div></header>`;
    const lede = chapter.fields.summary?.trim() || c.options.mode === "edit" ? f.get("summary", "p", "rd-lede") : "";
    return `<section class="rd-chapter alb-item"${editAttr("item", chapter.id, c)}${c.options.mode === "edit" ? "" : ` id="${id}" tabindex="-1"`}>${head}${lede}${chapter.photos.length ? `<div class="rd-chapter-art">${readingPhotos(chapter, c)}</div>` : ""}${rows.map(s => readingScene(s, c)).join("")}</section>`;
  }
  const head = `<div class="rd-row"><div class="rd-note rd-num" aria-hidden="true">${n}</div><header class="rd-text">${title("h2")}<p class="rd-span">${esc(span)}</p>${chapter.fields.summary?.trim() || c.options.mode === "edit" ? f.get("summary", "p", "rd-lede") : ""}</header></div>`;
  return `<section class="rd-chapter alb-item"${editAttr("item", chapter.id, c)}${c.options.mode === "edit" ? "" : ` id="${id}" tabindex="-1"`}>${head}${chapter.photos.length ? `<div class="rd-chapter-art">${readingPhotos(chapter, c)}</div>` : ""}${rows.map(s => readingScene(s, c)).join("")}</section>`;
}
function readingCover(c: Context): string {
  const { doc } = c, period = albumPeriod(doc.periodLabel), line = albumCoverQuote(doc);
  const coverPhoto = photo(doc.coverPhotoId, doc.title, c, "coverPhotoId");
  const title = c.options.mode === "edit" ? docField("h1", "title", doc.title, c, [...doc.title].length > 22 ? "long" : "")
    : `<h1 class="alb-field ${[...doc.title].length > 22 ? "long" : ""}">${esc(doc.title).replaceAll(" &amp; ", ' <i class="rd-amp">&amp;</i> ')}</h1>`;
  const periodText = period.text ? `${period.text}${period.days > 1 ? `${readingSkin(c).callsSection ? " · " : ", "}${period.days}일` : ""}` : "";
  const who = c.options.mode === "edit" ? `<p class="rd-who"${editAttr("scope", "document", c)}>${field("span", "periodLabel", periodText, c)}</p>` : periodText ? `<p class="rd-who">${esc(periodText)}</p>` : "";
  const card = doc.subtitle || c.options.mode === "edit" ? docField("p", "subtitle", doc.subtitle, c, "rd-card") : "";
  const epigraph = line || c.options.mode === "edit" ? `<blockquote class="rd-epigraph"${c.options.mode === "edit" ? ' data-album-field="coverLineId" data-pick="coverLineId" data-album-scope="document"' : ""}><p>${line ? esc(albumLine(line)) : "표지 대사 고르기"}</p>${line?.fields.speaker ? `<cite>${esc(line.fields.speaker)}</cite>` : ""}</blockquote>` : "";
  if (readingSkin(c).paper) {
    const stamp = albumPeriodDots(doc.periodLabel);
    const periodHtml = stamp || c.options.mode === "edit" ? `<span class="rd-stamp"${editAttr("scope", "document", c)}>${field("span", "periodLabel", stamp, c)}</span>` : "";
    return `<header class="rd-cover${coverPhoto ? " has-photo" : ""}${line ? " has-epigraph" : ""}"><div class="rd-frame"><div>${title}<div class="rd-cover-rule"></div>${periodHtml}${card}</div><div class="rd-cover-spread">${readingPrint(coverPhoto, c)}${epigraph}</div></div></header>`;
  }
  if (readingSkin(c).disc) {
    const disc = '<div class="rd-disc" aria-hidden="true"></div>';
    return `<header class="rd-cover${coverPhoto ? " has-photo" : ""}"><div class="rd-cover-title">${title}</div><div class="rd-cover-foot">${epigraph}<div class="rd-cover-meta">${who}${card}</div></div>${coverPhoto ? `<div class="rd-rec"><div class="rd-art">${coverPhoto}</div>${disc}</div>` : disc}</header>`;
  }
  return `<header class="rd-cover${coverPhoto ? " has-photo" : ""}"><div class="rd-cover-title">${title}</div>${coverPhoto ? `<div class="rd-cover-photo">${coverPhoto}</div>` : ""}<div class="rd-cover-foot"><div class="rd-cover-meta">${who}${card}</div>${epigraph}</div></header>`;
}
function readingQuotes(items: AlbumItem[], _shown: Set<string>, c: Context): string {
  const rows = items.filter(i => c.options.mode === "edit" || !i.hidden && Boolean(albumLine(i).trim()));
  if (!rows.length) return "";
  return `<div class="rd-inter${rows.length > 1 ? " two" : ""}">${rows.map(i => {
    const f = fields(i, c), day = albumDay(i.fields.date);
    return wrap(i, "", `${f.get(textKey(i), "p")}<cite>${f.get("speaker", "span")}${day || c.options.mode === "edit" ? ` · ${f.get("date", "span", "", day)}` : ""}</cite>`, c, "blockquote");
  }).join("")}</div>`;
}
function readingPromises(items: AlbumItem[], c: Context): string {
  return `<ul class="rd-vows">${items.map(i => {
    const f = fields(i, c), status = albumPromiseStatus(i.fields.status), day = albumPromiseDay(i.fields.date);
    const to = [editableDirection(i, c), c.options.mode === "edit" ? f.get("date", "span", "", day) : esc(day)].filter(Boolean).join(" · ");
    if (readingSkin(c).paper) return wrap(i, status, `<div class="rd-vow-at">${f.get("status", "span", status === "kept" ? "rd-stamp" : "rd-open", albumStatusLabel(i.fields.status))}${to ? `<span class="rd-to">${to}</span>` : ""}</div>${f.get(textKey(i), "p")}`, c, "li");
    return wrap(i, status, `${f.get("status", "span", "rd-st", albumStatusLabel(i.fields.status))}<div class="rd-vow-copy">${to ? `<span class="rd-to">${to}</span>` : ""}${f.get(textKey(i), "p")}</div>`, c, "li");
  }).join("")}</ul>`;
}
function readingHearts(items: AlbumItem[], c: Context): string {
  return `<div class="rd-letters">${items.map(i => {
    const f = fields(i, c), { from, to } = directionPeople(i, c);
    const heading = to || c.options.mode === "edit" ? `<h3><span class="rd-to">${letterPerson(i, "to", to, c)}</span>에게</h3>` : "";
    const sender = (["me", "partner"] as const).find(key => c.doc.people[key].name === from);
    const person = sender && c.doc.people[sender];
    const face = person?.photoId ? photo(person.photoId, person.name, c, `people.${sender}.photoId`) : "";
    const portrait = c.options.mode === "edit" && sender ? `<span class="rd-face${face.includes("<img") ? "" : " rd-face-empty"}" tabindex="0" role="button" aria-label="${esc(person!.name)} 사진 바꾸기" data-album-action="person-tools" data-person="${sender}">${face.includes("<img") ? face : '<span class="rd-face-slot">사진</span>'}<span class="rd-face-overlay">사진 바꾸기</span></span>` : face.includes("<img") ? `<span class="rd-face">${face}</span>` : "";
    return wrap(i, `rd-letter rd-direction--${sender ?? "partner"}`, `${portrait}${heading}${f.get(textKey(i), "p")}${from || c.options.mode === "edit" ? `<p class="rd-sign">${letterPerson(i, "from", from, c)}</p>` : ""}`, c, "article");
  }).join("")}</div>`;
}
/** Only names the two people use for each other, and never a "nickname" that is the target's own name. */
function readingCalls(items: AlbumItem[], c: Context): string {
  const { me, partner } = c.doc.people;
  const who = (v?: string) => side(v, c) || v || "";
  const pairs = items.filter(i => c.options.mode === "edit" || (() => {
    const from = who(i.fields.from), to = who(i.fields.to), word = (i.fields[textKey(i)] ?? "").trim();
    return from !== to && [me.name, partner.name].includes(from) && [me.name, partner.name].includes(to) && word && word !== to;
  })());
  const directions = [[partner.name, me.name], [me.name, partner.name]];
  return directions.map(([from, to]) => {
    const own = pairs.filter(i => who(i.fields.from) === from && who(i.fields.to) === to);
    if (c.options.mode === "edit") {
      const sender = from === me.name ? "me" : "partner";
      return `<dd class="rd-direction--${sender}"><small>${readingPair(from!, to!)}</small><${readingSkin(c).callsSection ? "p" : "span"} class="rd-words rd-edit-words">${own.map(i => wrap(i, "rd-call-word", `${fields(i, c).get(textKey(i), "span")}<button type="button" class="call-x" data-album-action="nickname-remove" aria-label="호칭 지우기">×</button>`, c, "em")).join(readingSkin(c).callsSection ? "" : '<span class="rd-call-sep">, </span>')}<button type="button" class="rd-call-add" data-album-action="nickname-add" data-from="${esc(from!)}" data-to="${esc(to!)}">+ 추가</button></${readingSkin(c).callsSection ? "p" : "span"}></dd>`;
    }
    return own.length ? `<dd class="rd-direction--${from === me.name ? "me" : "partner"}"><small>${readingPair(from!, to!)}</small>${readingSkin(c).paper ? '<span class="rd-words">' : readingSkin(c).callsSection ? "<p>" : ""}${own.map(i => wrap(i, "", fields(i, c).get(textKey(i), "span"), c, "em")).join(readingSkin(c).paper ? ", " : "")}${readingSkin(c).paper ? "</span>" : readingSkin(c).callsSection ? "</p>" : ""}</dd>` : "";
  }).join("");
}
function readingRecordRows(block: AlbumBlock, c: Context): string {
  const items = block.items.filter(i => c.options.mode === "edit" || !i.hidden);
  let rows = "";
  if (block.kind === "nicknames") rows = readingCalls(items, c);
  else if (block.kind === "firsts" || block.kind === "intimacy") rows = (block.kind === "firsts" && c.options.mode !== "edit" ? sortAlbumFirsts(items) : sortAlbumItemsByDate(items)).map(i => {
    const f = fields(i, c), meta = c.options.mode === "edit" ? `${f.get("date", "span", "", albumDay(i.fields.date))} · ${f.get("location", "span")}` : [albumDay(i.fields.date), i.fields.location ?? ""].filter(Boolean).map(esc).join(" · ");
    return wrap(i, "", `${f.get("title", "b")}${meta ? `<small>${meta}</small>` : ""}${f.get("summary", "span")}`, c, "dd");
  }).join("");
  else if (block.kind === "bond") rows = sortAlbumItemsByDate(items).map(i => {
    const f = fields(i, c), day = albumDay(i.fields.date);
    return wrap(i, "", `${f.get("title", "b")}${day || c.options.mode === "edit" ? `<small>${c.options.mode === "edit" ? f.get("date", "span", "", day) : esc(day)}</small>` : ""}${f.get("summary", "span")}`, c, "dd");
  }).join("");
  else if (block.kind === "progress") rows = items.map(i => {
    const f = fields(i, c), sides = (i.children ?? []).map(cell => {
      const done = cell.fields.status === "done", name = readingSide(cell.fields.side, c);
      return wrap(cell, done ? "on" : "", c.options.mode === "edit" ? `${field("span", "side", cell.fields.side, c)} ${field("span", "status", done ? "했어요" : "아직", c)}` : `${name ? `${name} ` : ""}${done ? "했어요" : "아직"}`, c, "span");
    }).join(" · ");
    return wrap(i, "", `${f.get("title", "b")} <span class="rd-steps">${sides}</span>`, c, "dd");
  }).join("");
  if (!rows && c.options.mode !== "edit") return "";
  return `<div class="alb-block alb-block--${block.kind}${block.hidden ? " alb-block--hidden" : ""}"${editAttr("block", block.id, c)}><dt>${field("span", "title", readingTitle(block, c), c)}</dt>${readingSkin(c).sides ? `<div class="rd-record-list">${rows}</div>` : rows}</div>`;
}
function readingPeople(c: Context): string {
  const cards = (["me", "partner"] as const).map(key => {
    const p = c.doc.people[key], image = photo(p.photoId, p.name, c, `people.${key}.photoId`);
    return `<figure${editAttr("scope", "document", c)}>${image}<figcaption>${c.options.mode === "edit" ? docField("span", `people.${key}.name`, p.name, c) : esc(p.name)}</figcaption></figure>`;
  });
  return `<div class="rd-people">${cards.join("")}</div>`;
}
function readingSection(id: string, title: string, body: string, block: AlbumBlock, c: Context): string {
  const heading = block.kind !== "quotes" && (title || c.options.mode === "edit") ? field("h2", "title", title, c, "rd-h2") : "";
  const gallery = albumGalleryLayout(block);
  const photos = ["photo", "gallery"].includes(block.kind) ? ` data-photo-columns="${block.kind === "gallery" ? gallery.columns : block.photoColumns ?? 2}" data-photo-shape="${block.kind === "gallery" ? gallery.shape : block.photoShape ?? "auto"}" style="--album-photo-columns:${block.kind === "gallery" ? gallery.columns : block.photoColumns ?? 2}"` : "";
  return `<section${photos} class="rd-sec${readingSkin(c).paper ? " rd-col" : ""} alb-block alb-block--${block.kind}${block.hidden ? " alb-block--hidden" : ""}"${c.options.mode === "edit" ? editAttr("block", block.id, c) : ` id="${id}" tabindex="-1"`}>${readingSkin(c).paper ? '<div class="rd-dbl"></div>' : ""}<div class="rd-row"><div class="rd-text">${heading}${body}</div></div></section>`;
}
function renderReading(doc: AlbumDocument, c: Context): { html: string; sections: AlbumSection[] } {
  const edit = c.options.mode === "edit", skin = readingSkin(c);
  const isRecord = (kind: AlbumBlockKind) => RECORD_KINDS.includes(kind) && !(skin.callsSection && kind === "nicknames");
  const alignAfter = (part: string) => skin.rail ? `<div class="rd-shell rd-shell--after"><div aria-hidden="true"></div><div class="rd-main">${part}</div></div>` : part;
  const blocks = doc.blocks.map((block, index) => ({ block, index })).filter(({ block }) => edit || !block.hidden);
  const shown = new Set(c.chapters.flatMap(scenes).flatMap(s => (s.children ?? []).filter(q => !q.hidden).flatMap(q => [lineKey(q), albumLine(q).trim()])));
  const sections: AlbumSection[] = [], sectionLinks: { id: string; label: string }[] = [];
  const push = (id: string, blockId: string, label: string) => sections.push({ id, blockId, label, number: two(sections.length + 1) });
  let chapterNo = 0, html = "", toc = "", storyOpen = false;
  const tracks: string[] = [];
  const parts: string[] = [];
  for (let n = 0; n < blocks.length; n++) {
    const { block, index } = blocks[n]!, id = `album-section-${index}`, sub = { ...c, index };
    const items = block.items.filter(i => edit || !i.hidden);
    if (storyOpen && block.kind !== "story") { parts.push("</div></div>"); storyOpen = false; }
    if (block.kind === "cover") { parts.push(`<div class="alb-block alb-block--cover"${editAttr("block", block.id, c)}${edit ? "" : ` id="${id}" tabindex="-1"`}>${readingCover(sub)}</div>`, "\u0000toc"); push(id, block.id, doc.title); continue; }
    if (block.kind === "story") {
      const chapters = items.map(chapter => { const number = ++chapterNo, cid = `album-chapter-${index}-${number}`; push(cid, block.id, chapterTitle(chapter) || `${number}`); return { chapter, number, cid }; });
      const entries = chapters.map(({ chapter, number, cid }) => `<li>${jump(cid, `<i>${readingTrack(number, c)}</i><b>${esc(chapterTitle(chapter))}</b><u class="rd-leader" aria-hidden="true"></u><span>${isLoose(chapter) ? "" : esc(readingSpan(chapter))}</span>`, c)}</li>`);
      tracks.push(...entries);
      toc += entries.join("");
      if (skin.rail && !storyOpen) { parts.push('<div class="rd-shell">\u0000rail<div class="rd-main">'); storyOpen = true; }
      parts.push(`<div class="alb-block alb-block--story${block.hidden ? " alb-block--hidden" : ""}"${editAttr("block", block.id, c)}>${chapters.map(({ chapter, number, cid }) => readingChapter(chapter, number, cid, sub)).join("")}</div>`);
      continue;
    }
    if (skin.callsSection && block.kind === "nicknames") {
      const calls = readingCalls(items, sub);
      if (calls || edit) {
        const label = readingTitle(block, c);
        parts.push(alignAfter(readingSection(id, label, `<dl class="rd-calls">${calls}</dl>`, block, sub)));
        push(id, block.id, label); sectionLinks.push({ id, label });
      }
      continue;
    }
    if (isRecord(block.kind)) {
      // Consecutive supporting records read as one ledger; each block stays its own movable row.
      const group = [block];
      while (blocks[n + 1] && isRecord(blocks[n + 1]!.block.kind)) group.push(blocks[++n]!.block);
      const rows = group.map(b => readingRecordRows(b, sub)).join("");
      if (!rows) continue;
      const label = RECORDS_LABEL;
      parts.push(alignAfter(`<section class="rd-sec${skin.paper ? " rd-col" : ""}"${edit ? "" : ` id="${id}" tabindex="-1"`}><div class="rd-row"><div class="rd-text">${skin.paper ? '<div class="rd-dbl"></div>' : ""}<h2 class="rd-h2">${esc(label)}</h2><dl class="rd-ledger">${rows}</dl></div></div></section>`));
      push(id, block.id, label); sectionLinks.push({ id, label });
      continue;
    }
    if (block.kind === "divider") { parts.push(alignAfter(`<div class="alb-block alb-block--divider"${editAttr("block", block.id, c)}><hr class="rd-divider"></div>`)); continue; }
    const title = readingTitle(block, c);
    let body = "";
    if (block.kind === "quotes") body = readingQuotes(items, shown, sub);
    else if (block.kind === "promises") body = items.length ? readingPromises(items, sub) : "";
    else if (block.kind === "hearts") body = items.length ? readingHearts(items, sub) : "";
    else if (block.kind === "intro") body = readingPeople(sub);
    else if (block.kind === "gallery" && !edit && !items.some(i => i.photos.length)) continue;
    else if (block.kind === "gallery" || block.kind === "photo") {
      const entries = items.flatMap(item => item.photos.map((ref, index) => ({ ref, index, item })));
      const gallery = albumGalleryLayout(block);
      body = block.kind === "gallery" ? readingPhotoGroup(entries, sub, "rd-shots alb-gallery-set", Math.min(gallery.columns, entries.length), gallery.shape, true)
        : readingPhotoGroup(entries, sub, entries.length === 1 ? "rd-single" : "rd-shots", block.photoColumns ?? 2, block.photoShape);
      if (!body && edit) body = `<div class="rd-single">${photo(undefined, "", sub)}</div>`;
      body = uploadingPhotos(sub, undefined, block.id) + body;
    } else if (block.kind === "text") body = items.map(i => { const f = fields(i, sub); return wrap(i, "rd-writing", f.get(textKey(i), "p"), sub); }).join("");
    if (!body && !edit) continue;
    const section = readingSection(id, title, body, block, sub);
    parts.push(alignAfter(section));
    const label = title || (block.kind === "photo" ? "사진" : block.kind === "text" ? RECORDS_LABEL : "");
    if (label) { push(id, block.id, label); sectionLinks.push({ id, label }); }
  }
  if (storyOpen) parts.push("</div></div>");
  const coverId = sections.find(section => doc.blocks.find(block => block.id === section.blockId)?.kind === "cover")?.id;
  const rail = skin.rail ? `<nav class="rd-rail" aria-label="차례">${coverId ? jump(coverId, `<b>${esc(doc.title)}</b>`, c) : `<b>${esc(doc.title)}</b>`}<small>${esc(albumPeriod(doc.periodLabel).text)}</small><ol>${toc}</ol><div class="rd-after">${sectionLinks.map(a => jump(a.id, esc(a.label), c)).join("")}</div></nav>` : "";
  if (toc && skin.sides) {
    const half = Math.ceil(tracks.length / 2);
    const side = (label: string, entries: string[]) => entries.length ? `<div><h2>${label}</h2><ol>${entries.join("")}</ol></div>` : "";
    toc = `<nav class="rd-toc" aria-label="차례"><div class="rd-sides">${side("A면", tracks.slice(0, half))}${side("B면", tracks.slice(half))}</div>${sectionLinks.length ? `<p class="rd-after">${sectionLinks.map(a => jump(a.id, esc(a.label), c)).join("")}</p>` : ""}</nav>`;
  } else if (toc) toc = `<nav class="rd-toc${skin.paper ? " rd-col" : ""}" aria-label="차례"><div class="rd-row"><div class="rd-text"><h2 class="rd-h2">차례</h2>${skin.paper ? '<div class="rd-dbl"></div>' : ""}<ol>${toc}</ol>${sectionLinks.length ? `<p class="rd-after">${sectionLinks.map(a => jump(a.id, esc(a.label), c)).join("")}</p>` : ""}</div></div></nav>`;
  html = parts.map(part => part === "\u0000toc" ? toc : part.replace("\u0000rail", rail)).join("");
  if (!parts.includes("\u0000toc")) html = toc + html;
  const period = albumPeriod(doc.periodLabel);
  const colophon = `<b>${esc(doc.title)}</b><span>${esc(period.text)}</span>`;
  html += `<footer class="rd-colophon">${skin.paper ? `<div>${colophon}</div>` : colophon}</footer>`;
  return { html, sections };
}

/** Pure projection in stored block order; source documents and stored values are never rewritten. */
export function renderAlbum(doc: AlbumDocument, options: AlbumRenderOptions): { html: string; css: string; sections: AlbumSection[] } {
  const requested = options.theme ?? doc.style.theme, theme = ALBUM_THEMES.includes(requested) ? requested : "book";
  const blocks = visible(doc), chapters = blocks.filter(b => b.kind === "story").flatMap(b => b.items);
  const c: Context = { doc, options, theme, index: 0, chapters, dates: albumDateFormat(doc.periodLabel) };
  const reading = renderReading(doc, c), tint = resolveAlbumTint(theme, doc.style.tint);
  return { html: `<article class="alb-album alb-theme--${theme} alb-mode--${options.mode}"${tint ? ` data-tint="${tint}"` : ""}>${readingSkin(c).paper ? '<div class="rd-vignette" aria-hidden="true"></div>' : ""}${reading.html}</article>`, css: albumThemeCss(theme), sections: reading.sections };
}
