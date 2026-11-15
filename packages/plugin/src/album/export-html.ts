import { albumDateFormat, type AlbumDocument, type AlbumItem } from "@rcm/shared";
import { escapeHtml as esc } from "../dashboard/film/ui.js";
import { ALBUM_VIEW_CSS } from "../dashboard/album-editor-css.js";
import { renderAlbum } from "./render.js";
import { albumPhotoCaption, buildAlbumPhotoList } from "./view-data.js";
import { ALBUM_FONT_LINKS } from "./themes/index.js";
import { ALBUM_EXPORT_SCRIPT } from "./export-runtime.js";

export type AlbumHtmlQuality = "keep" | "normal" | "light";
type PhotoMeta = { id: string; bytes: number; mime: string; width: number; height: number };
export const albumExportHasIntimacy = (doc: AlbumDocument): boolean => doc.blocks.some(b => b.kind === "intimacy" && !b.hidden);
export const albumHtmlFilename = (title: string, people?: AlbumDocument["people"]): string => {
  const pair = people && [people.me.name, people.partner.name].filter(Boolean).join(" & ");
  if (pair && title !== pair) title = `${pair} — ${title}`;
  const stem = title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_").trim().replace(/[. ]+$/, "").slice(0, 120) || "앨범";
  return `${/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? "_" : ""}${stem}.html`;
};
const visibleDoc = (doc: AlbumDocument): AlbumDocument => {
  const items = (list: AlbumItem[]): AlbumItem[] => list.filter(i => !i.hidden).map(i => ({ ...i, children: i.children && items(i.children) }));
  return { ...doc, blocks: doc.blocks.filter(b => !b.hidden).map(b => ({ ...b, items: items(b.items) })) };
};
// Web fonts remain remote; installed stacks keep the file usable offline.
const sans = 'system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';
const serif = '"Iowan Old Style","Palatino Linotype","AppleMyungjo","Batang",serif';
const fonts: Record<string, string> = {
  '"SUIT Variable"': sans, '"Pretendard Variable"': sans,
  '"Song Myung"': serif, '"Gowun Batang"': serif,
  '"Instrument Serif"': serif, '"Stellar"': '"Bodoni MT","Didot",' + serif, '"MaruBuri"': serif, '"Eulyoo"': serif,
  '"Kyobo25"': '"Segoe Print","Bradley Hand","AppleMyungjo","Batang",serif',
};
function exportFonts(css: string, theme: string): { css: string; links: string } {
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  css = css.replace(/@font-face\s*\{[^}]*\}/g, "");
  // Shared theme additions contain selectors for all four books. Keep only this book.
  css = css.replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selector: string) => {
    const themes = [...selector.matchAll(/alb-theme--([a-z]+)/g)].map(m => m[1]);
    return themes.length && !themes.includes(theme) ? "" : rule;
  });
  const used = new Set(Object.keys(fonts).filter(name => css.includes(name)));
  const links = (ALBUM_FONT_LINKS.match(/<link[^>]+>/g) ?? []).filter(link =>
    (link.includes("pretendard") && used.has('"Pretendard Variable"')) ||
    (link.includes("SUIT@") && used.has('"SUIT Variable"')) ||
    (link.includes("Instrument+Serif") && used.has('"Instrument Serif"')) ||
    (link.includes("Gowun+Batang") && (used.has('"Gowun Batang"') || used.has('"Song Myung"')))).join("");
  const selected = faces.filter(face => used.has(face.match(/font-family:\s*("[^"]+")/)?.[1] ?? ""));
  css = css.replace(/(font(?:-family)?\s*:\s*)([^;{}]+)/g, (declaration, property: string, value: string) => {
    const name = Object.keys(fonts).filter(name => value.includes(name)).sort((a, b) => value.indexOf(a) - value.indexOf(b))[0];
    if (!name) return declaration;
    return property + value.replace(/(?:sans-serif|monospace|serif)\s*$/, fonts[name]!);
  });
  // Inline SVG namespace, not a resource request.
  css = css.replaceAll("http://www.w3.org/2000/svg", "http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg");
  return { css: selected.join("\n") + css, links };
}
const fileCss = `html,body{margin:0;height:100%;font-family:${sans}}button{font:inherit} .album-view{--house:#f2f1ed;--screen:#faf9f6;--screen-2:#faf9f6;--screen-3:#eae8e1;--ink:#252522;--ink-2:#53534d;--ink-3:#77776e;--rule:#dddbd3;--rule-2:#cfccc1;--tungsten:#2e6a5d;--tungsten-dim:#2e6a5d12}.av-title{border:0}.av-pop--toc{right:16px}.alb-photo[role=button]{cursor:zoom-in}.alb-album [tabindex]:focus-visible{outline:2px solid currentColor;outline-offset:3px}.album-view .av-toc-trigger{flex:none}.av-scroll .alb-album{min-height:100%}`;

function file(doc: AlbumDocument, sources: Map<string, string>, photoMeta: readonly PhotoMeta[] = []): string {
  const images = [...sources.values()], imageIndices = new Map([...sources.keys()].map((id, i) => [id, i]));
  const references = new Map([...sources.keys()].map((id, i) => [id, `data:image/png;base64,${btoa(String(i))}`]));
  const photos = buildAlbumPhotoList(doc).filter(p => sources.has(p.photoId));
  const indices = new Map(photos.map((p, i) => [p.photoId, i]));
  const rendered = renderAlbum(doc, { mode: "export", photoSrc: id => references.get(id) ?? "", exportPhotoIndex: id => indices.get(id), storedPhotos: photoMeta });
  // Each image occurs once in the file even when a theme repeats its featured plate.
  let book = rendered.html;
  for (const [id, src] of references) book = book.replaceAll(`src="${src}"`, `data-image-index="${imageIndices.get(id)}"`);
  const data = { images, sections: rendered.sections.map(({ id, label, number }) => ({ id, label, number })),
    photos: photos.map(p => ({ image: imageIndices.get(p.photoId)!, alt: p.caption || p.title, caption: albumPhotoCaption(p, doc.title) })) };
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  const font = exportFonts(ALBUM_VIEW_CSS + rendered.css, doc.style.theme);
  const title = esc(doc.title), label = esc(data.sections[0]?.label ?? "목차");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; script-src 'unsafe-inline'; font-src https://cdn.jsdelivr.net https://hangeul.pstatic.net https://fonts.gstatic.com; base-uri 'none'; form-action 'none'"><title>${title}</title>${font.links}<style>${font.css}${fileCss}</style></head><body><main class="album-view"><div class="av-base"><header class="av-head"><div class="av-title"><b>${title}</b><small>${esc(albumDateFormat(doc.periodLabel).header)}</small></div>${data.sections.length ? `<button type="button" class="av-toc-trigger" data-action="toc" aria-haspopup="dialog" aria-expanded="false">목차 · <span class="av-current">${label}</span>⌄</button>` : ""}</header><div class="av-scroll">${book}</div>${data.sections.length ? `<button type="button" class="av-pill" data-action="toc" aria-haspopup="dialog" aria-expanded="false"><i class="av-number">01</i><span class="av-current">${label}</span>⌄</button>` : ""}</div><div class="av-overlay"></div></main><script type="application/json" id="album-data">${json}</script><script>${ALBUM_EXPORT_SCRIPT}</script></body></html>`;
}
function photoIds(doc: AlbumDocument): string[] {
  const ids = new Set(buildAlbumPhotoList(doc).map(p => p.photoId));
  // Also include portraits actually used by the renderer, outside the lightbox list.
  renderAlbum(doc, { mode: "export", photoSrc: id => { ids.add(id); return "data:image/png;base64,AA=="; } });
  return [...ids];
}
async function photoData(blob: Blob, quality: AlbumHtmlQuality): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error("지원하지 않는 사진 형식이에요.");
  if (quality !== "keep" && blob.type !== "image/gif") {
    const image = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, (quality === "normal" ? 1600 : 1000) / Math.max(image.width, image.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("사진을 변환하지 못했어요.");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await canvas.convertToBlob({ type: "image/webp", quality: .82 });
    } finally { image.close(); }
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
}
export async function buildAlbumHtmlFile(document: AlbumDocument, photos: (id: string) => Promise<Blob>, quality: AlbumHtmlQuality, photoMeta: readonly PhotoMeta[] = []): Promise<{ html: string; bytes: number }> {
  const doc = visibleDoc(document), sources = new Map<string, string>();
  // One original at a time bounds decoder memory for large albums. A failed photo aborts the save.
  for (const id of photoIds(doc)) sources.set(id, await photoData(await photos(id), quality));
  const html = file(doc, sources, photoMeta);
  return { html, bytes: new Blob([html]).size };
}
/** Base64 + repeated markup overhead, with an area-based estimate for compressed images. */
export function estimateAlbumHtmlSize(document: AlbumDocument, photoMeta: readonly PhotoMeta[], quality: AlbumHtmlQuality): number {
  return estimateAlbumHtmlSizes(document, photoMeta)[quality];
}
export function estimateAlbumHtmlSizes(document: AlbumDocument, photoMeta: readonly PhotoMeta[]): Record<AlbumHtmlQuality, number> {
  const doc = visibleDoc(document), ids = photoIds(doc);
  const placeholders = new Map(ids.map((id, i) => [id, `data:image/png;base64,${btoa(`photo-${i}`)}`]));
  const html = file(doc, placeholders, photoMeta);
  const base = new Blob([html]).size;
  const images = ids.map(id => ({ meta: photoMeta.find(p => p.id === id), placeholder: placeholders.get(id)!, occurrences: html.split(placeholders.get(id)!).length - 1 }));
  return Object.fromEntries((["keep", "normal", "light"] as const).map(quality => {
    let bytes = base;
    for (const { meta, placeholder, occurrences } of images) {
      const scale = quality === "keep" || meta?.mime === "image/gif" ? 1 : Math.min(1, (quality === "normal" ? 1600 : 1000) / Math.max(meta?.width || 1600, meta?.height || 1200));
      const size = meta ? (quality === "keep" || meta.mime === "image/gif" ? meta.bytes : Math.min(meta.bytes, meta.width * meta.height * scale * scale * .22)) : 350_000 * scale * scale;
      bytes += occurrences * (4 * Math.ceil(size / 3) + 32 - placeholder.length);
    }
    return [quality, Math.ceil(bytes)];
  })) as Record<AlbumHtmlQuality, number>;
}
