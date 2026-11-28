import { ALBUM_THEMES, resolveAlbumTint } from "@rcm/shared";
import type { AlbumSummary } from "../album/api.js";
import { btn, escapeHtml as esc, icon, menu } from "./film/ui.js";

export interface AlbumShelfOptions {
  photoUrl: (albumId: string, photoId: string, size: "thumb") => string;
  totals?: { albums: number; chats: number };
}

export function renderAlbumMiniCover(album: Pick<AlbumSummary, "id" | "title" | "theme" | "tint" | "names" | "coverPhotoId" | "sceneCount" | "chapterCount" | "promiseCount" | "coverQuote" | "coverFocus">, photoUrl: AlbumShelfOptions["photoUrl"] = () => ""): string {
    const theme = ALBUM_THEMES.find(t => t === album.theme) ?? "book";
    const tint = resolveAlbumTint(theme, album.tint);
    const names = esc((album.names ?? []).filter(Boolean).join(" · "));
    const url = album.coverPhotoId ? photoUrl(album.id, album.coverPhotoId, "thumb") : "";
    const image = url && (url.startsWith("blob:") || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(url))
      ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async" style="object-position:${album.coverFocus?.x ?? 50}% ${album.coverFocus?.y ?? 50}%;transform:scale(${album.coverFocus?.zoom ?? 1});transform-origin:${album.coverFocus?.x ?? 50}% ${album.coverFocus?.y ?? 50}%">` : "";
    const title = `<b class="album-shelf-cover-title">${esc(album.title)}</b>`;
    const people = `<small>${album.coverQuote ? `<q class="album-shelf-cover-line">${esc(album.coverQuote)}</q>` : ""}<span>${names}</span></small>`;
    const cover = theme === "lp" ? (image ? `${title}<span class="album-shelf-deck"><span class="album-shelf-record"></span><span class="album-shelf-jacket">${image}</span></span>${people}` : `<span class="album-shelf-record"></span>${title}${people}`)
      : theme === "film" ? `${title}<span class="album-shelf-cover-rule"></span>${image ? `<span class="album-shelf-print">${image}</span>` : ""}${people}`
      : `${title}${image}${people}`;
    return `<span class="album-shelf-mc album-shelf-mc--${theme}"${tint ? ` data-tint="${tint}"` : ""}>${cover}</span>`;
}

export function renderAlbumShelf(summaries: AlbumSummary[], options: AlbumShelfOptions): string {
  const create = () => btn("새 앨범", { action: "new-album", icon: "add", kind: "primary", hit: true }).replace('class="btn ', 'class="album-shelf-act btn ');
  const heading = `<header class="album-shelf-head"><div><h1>앨범</h1>${summaries.length ? `<p>앨범 ${options.totals?.albums ?? summaries.length}개 · 채팅 ${options.totals?.chats ?? new Set(summaries.map(a => a.sourceChatId).filter(Boolean)).size}개</p>` : ""}</div>${summaries.length ? create() : ""}</header>`;
  if (!summaries.length) return `<section class="album-shelf">${heading}<div class="album-shelf-empty"><div class="album-shelf-stack" aria-hidden="true"><span></span><span></span><span>${icon("add")}</span></div><p>남기고 싶은 채팅을 골라 첫 앨범을 만들어요.</p>${create()}</div></section>`;
  const cards = summaries.map(album => {
    const names = esc((album.names ?? []).filter(Boolean).join(" · "));
    const actions = menu({ label: `${album.title} 메뉴`, trigger: { icon: "more", className: "album-shelf-menu" }, items: [
      { label: "열기", action: "open-album", icon: "album", data: { albumId: album.id } },
      { label: "새 기억으로 업데이트", action: "update-album", icon: "refresh", data: { albumId: album.id } },
      { label: "복제", action: "duplicate-album", icon: "copy", data: { albumId: album.id } },
      { label: "HTML 파일로 저장", action: "export-album-html", icon: "download", data: { albumId: album.id } },
      { label: "앨범 지우기", action: "delete-album", icon: "delete", danger: true, data: { albumId: album.id } },
    ] }).replace('<summary ', `<summary data-action="album-menu" data-album-id="${esc(album.id)}" `);
    return `<article class="album-card" data-album-id="${esc(album.id)}"><button type="button" class="album-shelf-thumb" data-action="open-album" data-album-id="${esc(album.id)}" aria-label="${esc(album.title)} 열기">${renderAlbumMiniCover(album, options.photoUrl)}${(album.newMemoryCount ?? 0) > 0 ? `<span class="album-shelf-tag"><i aria-hidden="true"></i>새 기억 ${album.newMemoryCount}</span>` : ""}</button><div class="album-shelf-meta"><button type="button" class="album-shelf-title" data-action="open-album" data-album-id="${esc(album.id)}" title="${esc(album.title)}">${esc(album.title)}</button>${actions}<small>${names}</small><small>${album.periodLabel ? `<span>${esc(album.periodLabel)}</span> ` : ""}<span>${album.periodLabel ? "· " : ""}장면 ${album.sceneCount ?? 0}</span></small></div></article>`;
  }).join("");
  return `<section class="album-shelf">${heading}<div class="album-shelf-grid">${cards}<button type="button" class="album-shelf-new-card" data-action="new-album"><span class="album-shelf-plus">${icon("add")}</span>새 앨범</button></div></section>`;
}
