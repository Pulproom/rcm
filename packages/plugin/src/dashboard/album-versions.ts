import { renderAlbumMiniCover } from "./album-shelf.js";
import type { AlbumDocument } from "@rcm/shared";
import type { AlbumVersionRow } from "../album/api.js";
import { escapeHtml as esc, icon } from "./film/ui.js";

/** Leafing through kept looks: `doc` is set once a past look is on screen. */
export interface AlbumVersionsState {
  list?: AlbumVersionRow[];
  index: number;
  doc?: AlbumDocument;
  loading?: boolean;
  restoring?: boolean;
  error?: string;
}

const button = (action: string, text: string, extra = "") => `<button type="button" data-album-action="${action}" ${extra}>${text}</button>`;

/** Local wall-clock label, e.g. `11. 2. 오후 8:27`; the year appears only when it is not this year. */
export function albumVersionWhen(createdAt: number, now = Date.now()): string {
  const d = new Date(createdAt), hour = d.getHours();
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : `${d.getFullYear()}. `;
  return `${year}${d.getMonth() + 1}. ${d.getDate()}. ${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function cover(row: AlbumVersionRow): string {
  return `<span class="avh-cover" aria-hidden="true"><span class="album-mini-stage">${renderAlbumMiniCover({ id: "version", title: row.title ?? "", theme: row.theme, tint: row.tint, names: [], coverPhotoId: null })}</span></span>`;
}

function meta(row: AlbumVersionRow, currentTitle: string): string {
  return [
    row.title && row.title !== currentTitle ? `「${esc(row.title)}」` : "",
    row.sceneCount === undefined ? "" : `장면 ${row.sceneCount}`,
    row.photoCount === undefined ? "" : `사진 ${row.photoCount || "없음"}`,
  ].filter(Boolean).join(" · ");
}

/** Shown from the menu until a past look is ready, and when there is nothing kept yet. */
export function renderAlbumVersionsDialog(state: AlbumVersionsState | undefined): string {
  const busy = !state || state.loading;
  const body = state?.error ? `<div class="au-empty" role="alert">${esc(state.error)}</div>`
    : busy ? '<div class="au-empty" role="status">남겨 둔 모습을 불러오는 중…</div>'
    : '<div class="au-empty"><b>아직 남겨 둔 모습이 없어요</b><p>앨범을 다시 고치기 시작하면 고치기 전 모습이 여기에 남아요.</p></div>';
  return `<div class="av-scrim av-export-scrim" data-album-action="album-overlay-close"></div><section class="av-pop av-export av-update" role="dialog" aria-modal="true" aria-label="버전 기록" aria-busy="${busy && !state?.error}"><header class="au-head"><h3>버전 기록</h3>${button("album-overlay-close", icon("close"), 'aria-label="닫기"')}</header><div class="au-body">${body}</div><footer class="au-foot">${button("album-overlay-close", "닫기")}</footer></section>`;
}

/** The date list above the bar; rows are newest first. */
export function renderAlbumVersionList(state: AlbumVersionsState, currentTitle: string): string {
  const rows = (state.list ?? []).map((row, i) => button("album-version-pick",
    `${cover(row)}<span class="avh-main"><b>${albumVersionWhen(row.createdAt)}</b><small>${meta(row, currentTitle)}</small></span>`,
    `class="avh-row" data-value="${i}"${i === state.index ? ' aria-current="true"' : ""}`)).join("");
  return `<div class="av-scrim" data-album-action="album-overlay-close"></div><div class="av-pop av-pop--versions" role="dialog" aria-modal="true" aria-label="남겨 둔 모습">${rows}</div>`;
}

export function renderAlbumVersionBar(state: AlbumVersionsState, listOpen: boolean): string {
  const list = state.list ?? [], row = list[state.index];
  if (!row) return "";
  const hold = state.restoring ? " disabled" : "";
  return `<div class="avh-bar" role="toolbar" aria-label="버전 기록" aria-busy="${Boolean(state.loading || state.restoring)}">${state.error ? `<p class="avh-error" role="alert">${esc(state.error)}</p>` : ""}${
    button("album-version-step", icon("back"), `class="avh-step" data-value="1" aria-label="더 예전 모습"${state.index >= list.length - 1 ? " disabled" : hold}`)}${
    button("album-version-list", `<b>${albumVersionWhen(row.createdAt)}</b><small>${list.length - state.index} / ${list.length}</small>${icon("chevron")}`, `class="avh-when" aria-haspopup="dialog" aria-expanded="${listOpen}"${hold}`)}${
    button("album-version-step", icon("chevron"), `class="avh-step" data-value="-1" aria-label="더 최근 모습"${state.index <= 0 ? " disabled" : hold}`)}<i class="avh-sep" aria-hidden="true"></i>${
    button("album-version-restore", state.restoring ? "되돌리는 중…" : "이 모습으로 되돌리기", `class="av-export-save avh-restore"${state.loading || state.restoring ? " disabled" : ""}`)}</div>`;
}

export const ALBUM_VERSIONS_CSS = `
.av-base.is-past .av-scroll{padding-bottom:96px}
.avh-chip{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:99px;background:var(--accent-soft,var(--tungsten-dim));color:var(--accent-text,var(--tungsten));font-size:11.5px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums;flex:none;align-self:center}
.avh-bar{position:absolute;z-index:20;left:50%;bottom:24px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:6px;max-width:calc(100% - 32px);background:var(--screen-2);border:1px solid var(--rule-2);border-radius:14px;box-shadow:0 20px 44px -18px #0009}
.album-view .avh-step{width:44px;display:grid;place-items:center;border-radius:10px;color:var(--ink-2);flex:none}
.album-view .avh-when{display:inline-flex;align-items:center;gap:10px;padding:0 12px;border-radius:10px;white-space:nowrap;font-variant-numeric:tabular-nums}
.album-view :is(.avh-step,.avh-when):hover,.album-view .avh-when[aria-expanded=true]{background:var(--screen-3)}
.album-view .avh-bar button:disabled{opacity:.36;cursor:default}.album-view .avh-step:disabled{background:none}
.avh-when b{font-size:14.5px;font-weight:550}.avh-when small{font-size:12px;color:var(--ink-3)}
.album-view .avh-when .i{width:14px;height:14px;color:var(--ink-3);transform:rotate(-90deg)}.album-view .avh-when[aria-expanded=true] .i{transform:rotate(90deg)}
.avh-sep{width:1px;height:24px;background:var(--rule-2);margin:0 6px;flex:none}
.album-view .avh-restore{padding:0 20px;border-radius:8px;font-weight:600;white-space:nowrap}
.avh-bar[aria-busy=true] .avh-restore{cursor:progress}
.avh-error{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);margin:0;padding:6px 12px;border-radius:8px;background:var(--screen-2);border:1px solid var(--rule-2);color:var(--cut);font-size:13px;white-space:nowrap}
.album-view .avh-row{display:grid;grid-template-columns:30px minmax(0,1fr);gap:0 14px;align-items:center;width:100%;min-height:58px;padding:8px 10px;border-radius:8px;text-align:left}
.album-view .avh-row:hover{background:var(--screen-3)}.album-view .avh-row[aria-current=true]{background:var(--accent-soft,var(--tungsten-dim))}
.avh-cover{container-type:inline-size;position:relative;width:30px;height:40px;border-radius:2px;box-shadow:0 0 0 1px #8080804a;overflow:hidden}
.avh-main{min-width:0}.avh-main b{display:block;font-size:14.5px;font-weight:550;line-height:1.45;font-variant-numeric:tabular-nums}.avh-main small{display:block;font-size:12.5px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.album-view[data-skin=phone] .avh-bar{border-radius:999px;background:var(--screen);border-color:var(--rule)}.album-view[data-skin=phone] .avh-step{border-radius:50%}.album-view[data-skin=phone] :is(.avh-when,.avh-restore){border-radius:999px}
@container(min-width:641px){.av-pop--versions{right:auto;top:auto;left:50%;bottom:92px;transform:translateX(-50%);width:400px;padding:6px;border-radius:14px;max-height:min(420px,calc(100% - 180px))}}
@container(max-width:640px){
.av-base.is-past .av-scroll{padding-bottom:148px}
.avh-bar,.album-view[data-skin=phone] .avh-bar{left:0;right:0;bottom:0;transform:none;max-width:none;flex-wrap:wrap;justify-content:space-between;gap:4px 0;padding:8px 12px max(20px,env(safe-area-inset-bottom));border-radius:0;border-width:1px 0 0;box-shadow:none}
.album-view .avh-when{flex:1;justify-content:center}.avh-sep{display:none}.album-view .avh-restore{flex-basis:100%}
.avh-chip{font-size:11px;padding:0 7px}
}
`;
