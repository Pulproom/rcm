import { albumDefaultFit, albumFitCrop, albumImageRatio, albumDateFormat, albumDateOnly, albumPlaces, albumPromiseStatus, type AlbumDocument, type AlbumItem, type AlbumBlockKind, type AlbumCrop, type AlbumBlock } from "@rcm/shared";
import type { AlbumPhoto } from "./api.js";
import { escapeHtml as esc } from "../dashboard/film/ui.js";
import { albumPhotoCaption, type AlbumViewPhoto } from "./view-data.js";

interface Line { text: string; speaker: string; date: string }
interface Scene { title: string; summary: string; date: string; time: string; location: string; lines: Line[]; photos: BoardPhoto[] }
interface Chapter { title: string; summary: string; scenes: Scene[] }
export interface BoardPhoto extends AlbumViewPhoto { date: string; publicUrl?: string; crop?: AlbumCrop; focus?: { x: number; y: number }; shape?: AlbumBlock["photoShape"] }
interface Theme {
 ink: string; mut: string; line: string; acc: string; soft: string; plate: string; plate2: string; font: string; hf: string; mono: string;
 open(): string; close(): string; cover(): string; head(n: number, title: string, kind?: string): string;
 chapter(ch: Chapter, i: number, body: string): string; scene(s: Scene, j: number): string; quote(q: Line, i: number): string;
 slot(date: string, title: string, photos: BoardPhoto[], h?: number, onField?: boolean): string;
 divider(): string; galleryH: number; bodyOpen?: string; bodyClose?: string;
}
export function boardPublicUrl(value?: string): string | undefined {
  if (!value || !/^https:\/\//i.test(value)) return;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? value : undefined; } catch { return; }
}
const SANS = "'Pretendard','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif";
const SERIF = "'Noto Serif KR','Nanum Myeongjo','AppleMyungjo','Batang',serif";
const MONO = "'Consolas','Monaco','Courier New',monospace";
const hr = (css: string) => `<hr style="border:0;${css}">`;
const dot8 = (bg: string) => `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${bg};margin:0 5px;font-size:0;">&nbsp;</span>`;
const grad = (a: string, b: string, deg = 180) => `linear-gradient(${deg}deg,${a},${b})`;
const ST = { kept: ["&#10003;", "지킴"], broken: ["&#10005;", "깨짐"], open: ["&#9675;", "진행 중"] };

const boardDay = (v: string, dates: ReturnType<typeof albumDateFormat>) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(albumDateOnly(v)); return m ? `${Number(m[2])}월 ${Number(m[3])}일` : v ? dates.date(v) : ""; };
/** Day and name of a board photo slot; the copy dialog rows and ZIP file names share it so files map to slots. */
export const boardPhotoParts = (doc: AlbumDocument, p: BoardPhoto): [string, string] => [boardDay(p.date, albumDateFormat(doc.periodLabel)), p.title || p.caption || p.section || "사진"];

/** Approved board.html factories, with document data and shared date/visibility policies. */
function board(doc: AlbumDocument, photos: AlbumPhoto[]): { html: string; photos: BoardPhoto[] } {
  const visible = (items: AlbumItem[]): AlbumItem[] => items.filter(i => !i.hidden).map(i => ({ ...i, children: visible(i.children ?? []) }));
  const blocks = doc.blocks.filter(b => !b.hidden).map(b => ({ ...b, items: visible(b.items) }));
  const fields = (kind: AlbumBlockKind) => blocks.filter(b => b.kind === kind).flatMap(b => b.items);
  const dates = albumDateFormat(doc.periodLabel), dot = (v: string) => esc(dates.date(v)), full = dot, period = () => esc(dates.header);
  const kday = (v: string) => boardDay(v, dates);
  const caption = (date: string, title: string, refs: BoardPhoto[]) => esc([kday(date), title].filter(Boolean).join(" ")) + ` · 사진 ${refs.length}장`;
  const refs = (item: AlbumItem, section: string): BoardPhoto[] => item.photos.map(p => ({ photoId: p.photoId, caption: p.caption ?? item.fields.caption ?? photos.find(m => m.id === p.photoId)?.caption ?? "", title: item.fields.title ?? "", section, date: item.fields.date ?? "", crop: p.fit ? albumFitCrop(p.fit, albumImageRatio({ width: p.width ?? photos.find(m => m.id === p.photoId)?.width, height: p.height ?? photos.find(m => m.id === p.photoId)?.height })) : undefined, publicUrl: boardPublicUrl(photos.find(m => m.id === p.photoId)?.publicUrl) }));
  const personRef = (id: string | undefined, title: string) => id ? [{ photoId: id, caption: "", title, section: title, date: "", crop: id === doc.coverPhotoId && doc.coverFocus ? albumFitCrop({ ...albumDefaultFit(doc.style.theme === "lp" ? "square" : "portrait"), ...doc.coverFocus }, albumImageRatio(photos.find(p => p.id === id) ?? {})) : undefined, publicUrl: boardPublicUrl(photos.find(m => m.id === id)?.publicUrl) }] : [];
  const scene = (i: AlbumItem): Scene => ({ title: i.fields.title ?? "", summary: i.fields.summary ?? "", date: i.fields.date ?? "", time: "", location: albumPlaces([i])[0] ?? "", photos: refs(i, "장면"), lines: (i.children ?? []).map(line) });
  const line = (i: AlbumItem): Line => ({ text: i.fields.text ?? i.fields.body ?? i.fields.summary ?? i.fields.title ?? "", speaker: i.fields.speaker ?? "", date: i.fields.date ?? "" });
  const chapters = (items: AlbumItem[]): Chapter[] => items.map(i => ({ title: i.fields.title ?? "", summary: i.fields.summary ?? "", scenes: (i.children?.some(s => s.fields.title !== undefined || s.fields.summary !== undefined) ? i.children : [i]).map(scene) }));
  const allChapters = chapters(fields("story"));
  const counts = fields("intro")[0]?.fields ?? {};
  const count = (key: string, fallback: number) => /^\d+$/.test(counts[key] ?? "") ? Number(counts[key]) : fallback;
  const D = { title: doc.title, subtitle: doc.subtitle, me: doc.people.me.name, partner: doc.people.partner.name, period: [doc.periodLabel?.split(/\s+[—–-]\s+/u)[0] ?? ""], cover: personRef(doc.coverPhotoId, "표지"), chapters: allChapters,
    places: albumPlaces(fields("story").flatMap(i => i.children ?? [i])), counts: { scenes: count("scenes", allChapters.reduce((n,c)=>n+c.scenes.length,0)), chapters: count("chapters", allChapters.length), promises: count("promises", fields("promises").length) } };
  const ordered: BoardPhoto[] = [];
  const namesCaption = (name: string) => {
    const calls = fields("nicknames").filter(i => (i.fields.from === "me" || i.fields.from === "persona" ? D.me : i.fields.from === "partner" || i.fields.from === "character" ? D.partner : i.fields.from) === name).map(i=>i.fields.text ?? i.fields.title ?? "").filter(Boolean);
    return esc(name) + (calls.length ? `<div style="font-size:12px;font-weight:400;">부르는 말 ${calls.map(esc).join(", ")}</div>` : "");
  };
  const slotTable = ({ h, cell, cap, capFirst = false, margin = "14px 0 0", refs = [] }: { h: number; cell: string; cap: { style: string; html: string }; capFirst?: boolean; margin?: string; refs?: BoardPhoto[] }) => {
    ordered.push(...refs);
    const images = refs.filter(p=>p.publicUrl).map(p => `<img src="${esc(p.publicUrl!)}" alt="${esc(albumPhotoCaption(p, doc.title).join(" · "))}" style="max-width:100%;${p.crop ? `width:100%;aspect-ratio:${p.crop.ratio};object-fit:fill;object-view-box:inset(${p.crop.y * 100}% ${(1 - p.crop.x - p.crop.w) * 100}% ${(1 - p.crop.y - p.crop.h) * 100}% ${p.crop.x * 100}%);` : p.focus ? `width:100%;height:${h}px;object-fit:cover;object-position:${p.focus.x}% ${p.focus.y}%;` : p.shape && p.shape !== "original" ? `width:100%;aspect-ratio:${p.shape === "square" ? "1" : "1.5"};object-fit:cover;` : ""}">`).join("");
    const c = `<tr><td style="${cap.style}">${cap.html}</td></tr>`, e = `<tr><td style="height:${h}px;${cell}">${images}</td></tr>`;
    return `<table style="width:100%;border-collapse:collapse;border:0;margin:${margin};"><tbody>${capFirst ? c + e : e + c}</tbody></table>`;
  };
function book() {
  const P = { bg1: "#f8f8f6", bg2: "#f0efeb", ink: "#1c1c1a", mut: "#66665f", line: "#d6d5cf", acc: "#2e6a5d", soft: "rgba(46,106,93,0.09)", plate: "#e9e8e3", plate2: "#dfded8" };
  let plate = 1;
  const t = { ...P, font: SANS, hf: SERIF, mono: MONO } as unknown as Theme;
  t.open = () => `<div style="max-width:760px;margin:0 auto;padding:28px 22px 34px;background:${grad(P.bg1, P.bg2)};border:1px solid ${P.line};color:${P.ink};font-family:${SANS};font-size:15px;line-height:1.75;word-break:keep-all;">`;
  t.close = () => `</div>`;
  t.slot = (date, title, n, h = 190) => slotTable({ refs: n, h, cell: `background:${grad(P.plate, P.plate2)};border:1px solid ${P.line};`,
    cap: { style: `padding:7px 0 0;border:0;font-size:12px;color:${P.mut};`, html: `<span style="font-family:${MONO};color:${P.acc};">도판 ${String(plate++).padStart(2, "0")}</span>&nbsp; ${caption(date, title, n)}` } });
  t.cover = () => `
<table style="width:100%;border-collapse:collapse;border:0;"><tbody><tr>
<td style="padding:0;border:0;font-family:${MONO};font-size:11px;letter-spacing:2px;color:${P.acc};">RECORD</td>
<td style="padding:0;border:0;text-align:right;font-family:${MONO};font-size:12px;color:${P.mut};">${period()}</td></tr></tbody></table>
<div style="font-family:${SERIF};font-size:32px;line-height:1.25;font-weight:700;letter-spacing:-0.5px;color:${P.ink};margin:14px 0 6px;">${esc(D.title)}</div>
<div style="font-size:15px;color:${P.mut};">${esc(D.subtitle)}</div>
${hr(`border-top:2px solid ${P.ink};margin:18px 0 0;`)}
${D.cover.length ? t.slot(D.period[0]!, "표지", D.cover, 240) : ""}
<table style="width:100%;border-collapse:collapse;border:0;margin:14px 0 0;font-size:13px;"><tbody>
${[["기간", period()], ["인물", `${esc(D.me)} · ${esc(D.partner)}`], ["수록", `장면 ${D.counts.scenes} · ${D.counts.chapters}장 · 약속 ${D.counts.promises}`]].map(([k, v]) =>
  `<tr><td style="width:64px;padding:8px 0;border:0;border-bottom:1px solid ${P.line};color:${P.mut};">${k}</td><td style="padding:8px 0;border:0;border-bottom:1px solid ${P.line};color:${P.ink};">${v}</td></tr>`).join("")}
</tbody></table>`;
  t.head = (n, title) => `
<table style="width:100%;border-collapse:collapse;border:0;margin:38px 0 6px;"><tbody><tr>
<td style="width:40px;padding:0 0 8px;border:0;border-bottom:1px solid ${P.ink};font-family:${MONO};font-size:13px;color:${P.acc};vertical-align:bottom;">${String(n).padStart(2, "0")}</td>
<td style="padding:0 0 8px;border:0;border-bottom:1px solid ${P.ink};font-family:${SERIF};font-size:21px;font-weight:700;color:${P.ink};vertical-align:bottom;">${title}</td></tr></tbody></table>`;
  t.chapter = (ch, i, body) => `
<details${i === 0 ? " open" : ""} style="margin:10px 0 0;"><summary style="padding:12px 14px;background:${grad(P.soft, "rgba(0,0,0,0)", 90)};border:1px solid ${P.line};color:${P.ink};font-size:15px;font-weight:700;">
<span style="font-family:${MONO};font-size:12px;color:${P.acc};">제${i + 1}장</span>&nbsp; ${esc(ch.title)} <span style="float:right;font-size:12px;font-weight:400;color:${P.mut};">장면 ${ch.scenes.length}</span></summary>
<div style="padding:4px 14px 6px;border:1px solid ${P.line};border-top:0;">
<div style="padding:12px 0;font-size:14px;color:${P.mut};border-bottom:1px solid ${P.line};">${esc(ch.summary)}</div>${body}</div></details>`;
  t.scene = (s) => `
<div style="padding:16px 0;border-bottom:1px solid ${P.line};">
<div style="font-family:${MONO};font-size:12px;color:${P.mut};">${full(s.date)}${s.time ? " " + esc(s.time) : ""}${s.location ? " · " + esc(s.location) : ""}</div>
<div style="font-family:${SERIF};font-size:18px;font-weight:700;color:${P.ink};margin:4px 0 6px;">${esc(s.title)}</div>
<div style="font-size:15px;color:${P.ink};">${esc(s.summary)}</div>
${s.lines.map(l => `<div style="margin:10px 0 0;padding:8px 12px;border-left:2px solid ${P.acc};background:${grad(P.soft, "rgba(0,0,0,0)", 90)};font-size:14px;color:${P.ink};"><strong style="font-size:12px;color:${P.acc};">${esc(l.speaker)}</strong><br>“${esc(l.text)}”</div>`).join("")}
${s.photos.length ? t.slot(s.date, s.title, s.photos) : ""}</div>`;
  t.quote = (q) => `<div style="padding:16px 0;border-bottom:1px solid ${P.line};"><div style="font-family:${SERIF};font-size:19px;line-height:1.6;color:${P.ink};">“${esc(q.text)}”</div><div style="font-size:12px;color:${P.mut};margin-top:6px;">— ${esc(q.speaker)}${q.date ? " · " + full(q.date) : ""}</div></div>`;
  t.divider = () => `<div style="text-align:center;margin:30px 0 0;">${dot8(P.line)}${dot8(P.acc)}${dot8(P.line)}</div>`;
  t.galleryH = 260;
  return t;
}

function lp(tint: string) {
  const S = { red: ["#d4402a", "#bf3520"], blue: ["#2a4cad", "#1f3b8c"], green: ["#2f6b4f", "#24553e"], mustard: ["#cc9a2e", "#b98722"], black: ["#24211f", "#161413"] }[tint as "red"]!;
  const dark = tint === "mustard";
  const on = dark ? "#2a1d0c" : "#fbf1df", mut = dark ? "#4a3618" : "#f6e4ca", rule = dark ? "rgba(42,29,12,0.30)" : "rgba(251,241,223,0.32)";
  const P = { ink: on, mut, line: rule, acc: on, soft: dark ? "rgba(42,29,12,0.08)" : "rgba(251,241,223,0.10)", plate: "rgba(251,241,223,0.12)", plate2: "rgba(251,241,223,0.06)" };
  const C = { cream: "#f7eedb", cream2: "#efe3c8", ink: "#1f1814", mut: "#6a5d52", line: "#dccdb0" };
  const t = { ...P, font: SANS, hf: SERIF, mono: MONO } as unknown as Theme;
  t.open = () => `<div style="max-width:760px;margin:0 auto;padding:24px 20px 34px;background:${grad(S[0]!, S[1]!, 170)};color:${on};font-family:${SANS};font-size:15px;line-height:1.75;word-break:keep-all;">`;
  t.close = () => `</div>`;
  const insertSlot = (date: string, title: string, n: BoardPhoto[]) => slotTable({ refs: n, h: 180, cell: `background:${grad("#ece0c6", "#e4d6b9")};border:1px dashed #b9ab95;`,
    cap: { style: `padding:6px 0 0;border:0;font-size:12px;color:${C.mut};`, html: caption(date, title, n) } });
  t.slot = (date, title, n, h = 200) => slotTable({ refs: n, h, cell: `background:${grad(P.plate, P.plate2)};border:1px dashed ${dark ? "rgba(42,29,12,0.45)" : "rgba(251,241,223,0.60)"};`,
    cap: { style: `padding:6px 0 0;border:0;font-size:12px;color:${mut};`, html: caption(date, title, n) } });
  const disc = `<div style="width:64px;height:128px;border-radius:0 64px 64px 0;background:radial-gradient(circle at 0% 50%,${S[0]!} 0,${S[0]!} 13px,#f7eedb 14px,#f7eedb 16px,#151210 17px,#2c2723 28px,#151210 29px,#2a2521 41px,#141110 42px,#28231f 54px,#0e0c0b 64px);box-shadow:5px 6px 14px rgba(0,0,0,0.35);font-size:0;">&nbsp;</div>`;
  t.cover = () => `
<table style="width:100%;border-collapse:collapse;border:0;"><tbody><tr>
<td style="padding:0;border:0;font-size:13px;font-weight:700;color:${on};">${esc(D.me)}과 ${esc(D.partner)}</td>
<td style="padding:0;border:0;text-align:right;font-family:${SERIF};font-size:20px;font-weight:900;color:${on};">제1집</td></tr></tbody></table>
<table style="width:100%;max-width:540px;border-collapse:collapse;border:0;margin:22px 0 0;"><tbody><tr>
<td style="padding:0;border:0;vertical-align:middle;">
<div style="padding:12px 12px 16px;background:${grad(S[0]!, S[1]!, 150)};box-shadow:0 16px 30px rgba(40,10,0,0.45),inset 0 0 0 1px rgba(251,241,223,0.20);">
${D.cover.length ? t.slot(D.period[0]!, "표지", D.cover, 230).replace("margin:14px 0 0", "margin:0") : ""}
<div style="font-family:${SERIF};font-size:34px;line-height:1.08;font-weight:900;letter-spacing:-1.5px;color:${on};margin-top:12px;">${esc(D.title)}</div></div></td>
<td style="width:64px;padding:0;border:0;vertical-align:middle;">${disc}</td></tr></tbody></table>
<table style="width:100%;border-collapse:collapse;border:0;margin:22px 0 0;font-size:13px;"><tbody>
${[["녹음", period()], ["장소", D.places.map(esc).join(", ")], ["수록", `장면 ${D.counts.scenes}곡 · ${D.counts.chapters}장`]].map(([k, v]) =>
  `<tr><td style="width:56px;padding:8px 0;border:0;border-top:1px solid ${rule};color:${mut};">${k}</td><td style="padding:8px 0;border:0;border-top:1px solid ${rule};color:${on};">${v}</td></tr>`).join("")}
</tbody></table>
${([{ side: "A면", list: D.chapters.slice(0, 2) }, { side: "B면", list: D.chapters.slice(2) }]).map(({side, list}) => `
<div style="font-family:${SERIF};font-size:22px;font-weight:900;color:${on};margin:26px 0 4px;">${side}</div>
<table style="width:100%;border-collapse:collapse;border:0;"><tbody>${list.map((c, i) => `<tr>
<td style="width:24px;padding:8px 0;border:0;border-bottom:1px dotted ${rule};font-weight:700;color:${on};vertical-align:top;">${i + 1}</td>
<td style="padding:8px 0;border:0;border-bottom:1px dotted ${rule};color:${on};">${esc(c.title)}</td>
<td style="width:40px;padding:8px 0;border:0;border-bottom:1px dotted ${rule};text-align:right;font-size:12px;color:${mut};vertical-align:top;">${c.scenes.length}곡</td></tr>`).join("")}</tbody></table>`).join("")}`;
  t.head = (n, title) => `<div style="margin:40px 0 12px;font-family:${SERIF};font-size:30px;line-height:1.1;font-weight:900;letter-spacing:-1px;color:${on};">${title}</div>`;
  t.chapter = (ch, i, body) => `
<details${i === 0 ? " open" : ""} style="margin:0;"><summary style="padding:12px 2px;border-top:1px solid ${rule};color:${on};font-size:16px;font-weight:700;">
<span style="font-family:${MONO};font-size:12px;color:${mut};">${i < 2 ? "A" : "B"}${i < 2 ? i + 1 : i - 1}</span>&nbsp; ${esc(ch.title)} <span style="float:right;font-size:12px;font-weight:400;color:${mut};">${ch.scenes.length}곡</span></summary>
<div style="margin:2px 0 18px;padding:20px 18px 8px;background:${grad(C.cream, C.cream2, 175)};color:${C.ink};box-shadow:0 16px 30px rgba(40,10,0,0.35);">
<div style="font-size:12px;letter-spacing:2px;color:${C.mut};">LINER NOTES</div>
<div style="font-family:${SERIF};font-size:17px;line-height:1.6;color:${C.ink};margin:4px 0 4px;">${esc(ch.summary)}</div>${body}</div></details>`;
  t.scene = (s, j) => `
<div style="padding:14px 0;border-top:1px dashed ${C.line};">
<table style="width:100%;border-collapse:collapse;border:0;"><tbody><tr>
<td style="width:24px;padding:0;border:0;font-weight:700;color:${C.ink};vertical-align:top;">${j + 1}</td>
<td style="padding:0;border:0;font-weight:700;color:${C.ink};">${esc(s.title)}</td>
<td style="width:70px;padding:0;border:0;text-align:right;font-family:${MONO};font-size:12px;color:${C.mut};vertical-align:top;">${dot(s.date)}</td></tr></tbody></table>
<div style="font-size:14px;color:${C.ink};margin:6px 0 0 24px;">${esc(s.summary)}</div>
${s.lines.map(l => `<div style="margin:12px 0 0;text-align:center;font-family:${SERIF};font-size:17px;line-height:1.6;color:${C.ink};">${esc(l.text)}<div style="font-family:${SANS};font-size:11px;letter-spacing:1px;color:${C.mut};">${esc(l.speaker)}</div></div>`).join("")}
${s.photos.length ? insertSlot(s.date, s.title, s.photos) : ""}</div>`;
  t.quote = (q) => `<div style="padding:16px 0;text-align:center;border-bottom:1px solid ${rule};"><div style="font-family:${SERIF};font-size:21px;line-height:1.55;color:${on};">${esc(q.text)}</div><div style="font-size:12px;color:${mut};margin-top:6px;">${esc(q.speaker)}${q.date ? " · " + dot(q.date) : ""}</div></div>`;
  t.divider = () => `<div style="text-align:center;margin:32px 0 0;">${dot8(on)}${dot8(on)}${dot8(on)}</div>`;
  t.galleryH = 260;
  return t;
}

function film() {
  const P = { ink: "#2a241e", mut: "#6b5d4c", line: "rgba(90,70,45,0.28)", acc: "#8f3a2a", soft: "rgba(143,58,42,0.07)", plate: "#ddd3c2", plate2: "#cfc3ae", white: "#fdfbf6", white2: "#f4eee2" };
  const EN = { firsts: "FIRST TIMES", intro: "THE TWO OF US", story: "SCENES", quotes: "SAVED LINES", promises: "PROMISES", bond: "RELATIONSHIP", hearts: "LETTERS", gallery: "PHOTOGRAPHS", nicknames: "NAMES", progress: "TOGETHER", intimacy: "CLOSER", text: "NOTE", photo: "PHOTOGRAPH" };
  const t = { ...P, font: SERIF, hf: SERIF, mono: MONO } as unknown as Theme;
  const strip = (cells: number, extra = "") => `<table style="width:100%;border-collapse:collapse;border:0;background:${grad("#241f1b", "#16120f")};${extra}"><tbody><tr>${
    Array.from({ length: cells }, () => `<td style="padding:6px 0;border:0;text-align:center;"><span style="display:inline-block;width:11px;height:8px;border-radius:2px;background:${grad("#efe4cf", "#d6c6a4")};font-size:0;">&nbsp;</span></td>`).join("")}</tr></tbody></table>`;
  const polaroid = (date: string, title: string, n: BoardPhoto[], h: number, align: string) => `
<div style="width:74%;max-width:440px;margin:${align === "right" ? "30px 0 0 auto" : align === "left" ? "30px 0 0 0" : "30px auto 0"};padding:12px 12px 4px;background:${grad(P.white, P.white2)};box-shadow:0 10px 22px rgba(60,40,15,0.30),0 1px 2px rgba(60,40,15,0.20);">
<div style="width:90px;height:22px;margin:-24px auto 10px;background:rgba(226,210,170,0.78);border-left:1px dashed rgba(150,120,70,0.40);border-right:1px dashed rgba(150,120,70,0.40);font-size:0;">&nbsp;</div>
${slotTable({ refs: n, h, margin: "0", cell: `background:${grad(P.plate, P.plate2)};border:0;`, cap: { style: `padding:10px 2px 8px;border:0;text-align:center;font-family:${SERIF};font-size:14px;color:${P.ink};`, html: caption(date, title, n) } })}</div>`;
  let flip = 0;
  t.open = () => `<div style="max-width:760px;margin:0 auto;background:${grad("#ede3d0", "#e1d2b6", 175)};box-shadow:inset 0 0 90px rgba(90,60,25,0.28);border:1px solid #d1c09f;color:${P.ink};font-family:${SERIF};font-size:15px;line-height:1.8;word-break:keep-all;">${strip(16)}`;
  t.bodyOpen = `<div style="padding:0 22px 30px;">`; t.bodyClose = `</div>`;
  t.close = () => `${strip(16)}</div>`;
  t.slot = (date, title, n, h = 220) => polaroid(date, title, n, h, (flip++ % 2) ? "right" : "left");
  t.cover = () => `
<div style="padding:34px 22px 10px;text-align:center;">
<div style="font-family:${MONO};font-size:12px;letter-spacing:2px;color:${P.acc};">${period()}</div>
<div style="font-family:${SERIF};font-size:34px;line-height:1.25;font-weight:700;color:${P.ink};margin:12px 0 6px;">${esc(D.title)}</div>
<div style="font-size:15px;color:${P.mut};">${esc(D.subtitle)}</div>
${D.cover.length ? polaroid(D.period[0]!, "표지", D.cover, 250, "center") : ""}</div>`;
  t.head = (n, title, kind) => `
<div style="margin:44px 0 12px;"><div style="font-size:12px;letter-spacing:4px;color:${P.acc};">${EN[kind as keyof typeof EN] ?? ""}</div>
<div style="font-size:24px;font-weight:700;color:${P.ink};margin-top:2px;padding-bottom:10px;border-bottom:1px dashed ${P.line};">${title}</div></div>`;
  t.chapter = (ch, i, body) => `
<details${i === 0 ? " open" : ""} style="margin:6px 0 0;"><summary style="padding:12px 0;border-bottom:1px dashed ${P.line};color:${P.ink};font-size:18px;font-weight:700;">
<span style="font-family:${MONO};font-size:11px;letter-spacing:2px;color:${P.acc};">CHAPTER ${String(i + 1).padStart(2, "0")}</span>&nbsp; ${esc(ch.title)}</summary>
<div style="padding:10px 0 4px;"><div style="font-size:15px;color:${P.mut};">${esc(ch.summary)}</div>${body}</div></details>`;
  t.scene = (s) => `
<div style="padding:6px 0 18px;">
${s.photos.length ? t.slot(s.date, s.title, s.photos) : ""}
<div style="margin-top:16px;font-family:${MONO};font-size:12px;color:${P.acc};">${dot(s.date)}${s.time ? " " + esc(s.time) : ""}${s.location ? " · " + esc(s.location) : ""}</div>
<div style="font-size:18px;font-weight:700;color:${P.ink};margin:2px 0 6px;">${esc(s.title)}</div>
<div style="font-size:15px;color:${P.ink};">${esc(s.summary)}</div>
${s.lines.map(l => `<div style="margin:12px 0 0;padding:10px 14px;background:${grad("#f8f2e5", "#efe5d0")};border-left:3px solid ${P.acc};font-size:16px;color:#4a3426;box-shadow:0 2px 6px rgba(60,40,15,0.12);">“${esc(l.text)}” <span style="font-size:12px;color:${P.mut};">— ${esc(l.speaker)}</span></div>`).join("")}</div>`;
  t.quote = (q, i) => `<div style="width:86%;margin:${i % 2 ? "14px 0 0 auto" : "14px 0 0 0"};padding:16px 18px;background:${grad(P.white, P.white2)};box-shadow:0 6px 14px rgba(60,40,15,0.18);"><div style="font-size:18px;line-height:1.65;color:#3a2a20;">“${esc(q.text)}”</div><div style="font-size:12px;color:${P.mut};margin-top:6px;">— ${esc(q.speaker)}${q.date ? " · " + dot(q.date) : ""}</div></div>`;
  t.divider = () => `<div style="width:50%;margin:34px auto 0;">${strip(8)}</div>`;
  t.galleryH = 260;
  return t;
}

  const VOICE = { book: { firsts: "처음", story: "이야기", quotes: "남겨 둔 말", promises: "약속", bond: "관계", hearts: "서로에게", gallery: "사진", intro: "두 사람", nicknames: "부르는 말", text: "메모" },
    lp: { firsts: "처음", story: "수록곡", quotes: "가사", promises: "약속", bond: "관계", hearts: "서로에게", gallery: "사진", intro: "함께한 사람", nicknames: "부르는 말", text: "메모" },
    film: { firsts: "처음", story: "이야기", quotes: "저장한 말", promises: "약속", bond: "관계", hearts: "서로에게", gallery: "사진", intro: "두 사람", nicknames: "부르는 말", text: "메모" } }[doc.style.theme === "program" ? "book" : doc.style.theme];
  // Board output retains the legacy LP palette and its red fallback independently of the reading skin.
  const tint = doc.style.theme === "lp" ? (["red", "blue", "green", "mustard", "black"].includes(doc.style.tint ?? "") ? doc.style.tint! : "red") : "";
  const t = doc.style.theme === "lp" ? lp(tint) : doc.style.theme === "film" ? film() : book();
  const row = (l: string, r: string, sub = "") => `<tr><td style="width:84px;padding:10px 0;border:0;border-bottom:1px solid ${t.line};font-family:${t.mono};font-size:12px;color:${t.mut};vertical-align:top;">${l}</td><td style="padding:10px 0;border:0;border-bottom:1px solid ${t.line};color:${t.ink};"><strong style="font-weight:700;">${r}</strong>${sub ? `<div style="font-size:13px;color:${t.mut};">${sub}</div>` : ""}</td></tr>`;
  const table = (rows: string) => `<table style="width:100%;border-collapse:collapse;border:0;"><tbody>${rows}</tbody></table>`;
  const name = (v?: string) => v === "me" || v === "persona" ? D.me : v === "partner" || v === "character" ? D.partner : v ?? "";
  const relation = (i: AlbumItem) => ({ from: name(i.fields.from), to: name(i.fields.to) });
  let n = 0, out = t.open(), bodyOpened = false;
  for (const block of blocks) {
    const items = block.items;
    if (block.kind === "cover") { out += t.cover(); continue; }
    if (!bodyOpened) { out += t.bodyOpen ?? ""; bodyOpened = true; }
    if (block.kind === "divider") { out += t.divider(); continue; }
    if (block.kind === "nicknames" && blocks.some(b=>b.kind === "intro")) continue;
    const section = (kind: string, html: string) => { if (html) out += t.head(++n, esc(block.title || VOICE[kind as keyof typeof VOICE] || ({ intimacy: "가까워진 순간", progress: "함께한 걸음", photo: "사진" }[kind as "intimacy" | "progress" | "photo"] ?? "")), kind) + html; };
    const photoGrid = (entries: BoardPhoto[]) => {
      const columns = block.photoColumns ?? 2;
      return table(Array.from({ length: Math.ceil(entries.length / columns) }, (_, row) => `<tr>${entries.slice(row * columns, (row + 1) * columns).map(p => `<td style="width:${100 / columns}%;padding:6px;vertical-align:top;border:0;">${t.slot(p.date, p.caption || p.title || "사진", [{ ...p, shape: block.photoShape ?? "landscape" }], t.galleryH)}</td>`).join("")}</tr>`).join(""));
    };
    const X = { firsts: items.map(scene), chapters: chapters(items), quotes: items.map(line),
      promises: items.map(i=>({ ...relation(i), text: line(i).text, status: albumPromiseStatus(i.fields.status) === "pending" ? "open" as const : albumPromiseStatus(i.fields.status) as "kept" | "broken" })),
      hearts: items.map(i=>({ ...relation(i), summary: line(i).text })), bond: items.map(scene),
      nicknames: items.map(i=>({ ...relation(i), text: line(i).text })), note: items.map(i=>line(i).text).join("\n"), gallery: items.flatMap(i=>refs(i, "사진")) };
    switch(block.kind) {
      case "intro": section("intro", table(`<tr>${[D.me, D.partner].map(name => `<td style="width:50%;padding:0 ${name === D.me ? "6px" : "0"} 0 ${name === D.me ? "0" : "6px"};border:0;vertical-align:top;">${
    slotTable({ refs: personRef(name === D.me ? doc.people.me.photoId : doc.people.partner.photoId, name), h: 130, margin: "0", cell: `background:${grad(t.plate, t.plate2)};border:0;`, cap: { style: `padding:8px 0 0;border:0;font-size:15px;font-weight:700;color:${t.ink};`, html: `${namesCaption(name)} <span style="font-size:12px;font-weight:400;color:${t.mut};">${personRef(name === D.me ? doc.people.me.photoId : doc.people.partner.photoId, name).length ? "· 사진 1장" : ""}</span>` } })}</td>`).join("")}</tr>`)); break;
      case "firsts": section("firsts", table(X.firsts.map(f => row(full(f.date), esc(f.title), [f.location, f.summary].filter(Boolean).map(esc).join(" · "))).join(""))); break;
      case "story": section("story", X.chapters.map((ch, i) => t.chapter(ch, i, ch.scenes.map((s, j) => t.scene(s, j)).join(""))).join("")); break;
      case "quotes": out += `<div style="padding:54px 0 50px;text-align:center;"><div style="width:36px;height:1px;background:${t.line};margin:0 auto;"></div>${X.quotes.map(q => `<blockquote style="margin:0;padding:22px 0 18px;border:0;"><div style="font-family:${t.hf};font-size:${X.quotes.length > 1 ? 20 : 23}px;line-height:1.6;">${esc(q.text)}</div><div style="margin-top:10px;font-family:${SANS};font-size:12.5px;line-height:1.4;color:${t.mut};">${esc([q.speaker,kday(q.date)].filter(Boolean).join(" · "))}</div></blockquote>`).join("")}<div style="width:36px;height:1px;background:${t.line};margin:0 auto;"></div></div>`; break;
      case "promises": section("promises", table(X.promises.map(p => `<tr><td style="width:84px;padding:10px 0;border:0;border-bottom:1px solid ${t.line};vertical-align:top;"><span style="display:inline-block;padding:1px 8px;border:1px ${p.status === "open" ? "dashed" : "solid"} ${p.status === "kept" ? t.acc : t.mut};color:${p.status === "kept" ? t.acc : t.mut};font-family:${SANS};font-size:12px;">${ST[p.status][0]} ${ST[p.status][1]}</span></td><td style="padding:10px 0;border:0;border-bottom:1px solid ${t.line};color:${t.ink};">${esc(p.text)}<div style="font-size:12px;color:${t.mut};">${esc(p.from)} → ${esc(p.to)}</div></td></tr>`).join(""))); break;
      case "hearts": section("hearts", X.hearts.map(h => `<div style="margin:0 0 12px;padding:14px 16px;border:1px solid ${t.line};background:${grad(t.soft, "rgba(0,0,0,0)")};"><div style="font-family:${SANS};font-size:12px;font-weight:700;color:${t.acc};">${esc(h.from)} → ${esc(h.to)}</div><div style="font-family:${t.hf};font-size:16px;line-height:1.75;color:${t.ink};margin-top:4px;">${esc(h.summary)}</div></div>`).join("")); break;
      case "bond": section("bond", table(X.bond.map(b => row(full(b.date), esc(b.title), esc(b.summary))).join(""))); break;
      case "nicknames": section("nicknames", X.nicknames.map(x => `<span style="display:inline-block;margin:0 8px 8px 0;padding:6px 12px;border:1px solid ${t.line};background:${grad(t.soft, "rgba(0,0,0,0)")};font-size:15px;color:${t.ink};"><span style="font-size:12px;color:${t.mut};">${esc(x.from)} → ${esc(x.to)}</span>&nbsp; ${esc(x.text)}</span>`).join("")); break;
      case "text": section("text", `<div style="font-family:${t.hf};font-size:16px;line-height:1.8;color:${t.ink};">${esc(X.note)}</div>`); break;
      case "gallery": if (X.gallery.length) section("gallery", photoGrid(X.gallery)); break;
      case "photo": for (const i of items) if (i.photos.length) section("photo", photoGrid(refs(i, "사진"))); break;
      case "intimacy": section("intimacy", table(items.map(i=>row(dot(i.fields.date ?? ""), esc(i.fields.title ?? ""), esc([i.fields.summary, ...albumPlaces([i])].filter(Boolean).join(" · ")))).join(""))); break;
      case "progress": section("progress", table(items.map(i=>row(esc(i.fields.title ?? ""), ["me", "partner"].map(side=>`${esc(doc.people[side as "me" | "partner"].name)} · ${i.children?.some(c=>c.fields.side === side && c.fields.status === "done") ? "함께함" : "아직"}`).join(" / "))).join(""))); break;
    }
  }
  out += (bodyOpened ? t.bodyClose ?? "" : "") + t.close();
  const seen = new Set<string>();
  return { html: out.replace(/\n/g, ""), photos: ordered.filter(p => { if (seen.has(p.photoId)) return false; seen.add(p.photoId); return true; }) };
}
export const renderAlbumForBoard = (doc: AlbumDocument, photos: AlbumPhoto[]): string => board(doc, photos).html;
/** Includes portraits, in actual board slot order. Shared by ZIP and the address editor. */
export const buildBoardPhotoList = (doc: AlbumDocument, photos: AlbumPhoto[]): BoardPhoto[] => board(doc, photos).photos;
