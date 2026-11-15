import { albumDateFormat, albumDateOnly, recommendedAlbumQuotes, recommendedAlbumScenes, sortAlbumItemsByDate, type AlbumDraftChoices, type AlbumMaterialItem } from "@rcm/shared";
import { chapterTitle } from "../album/render.js";
import { escapeHtml as esc, icon } from "./film/ui.js";

/** Shared chapter/day layout for creation and source updates. Actions remain owned by the caller. */
export interface AlbumScenePickerMode {
  chapterTag?: (chapter: AlbumMaterialItem) => string;
  scene: (scene: AlbumMaterialItem) => { checked: boolean; locked?: boolean; existingId?: string; lines?: boolean; tag?: string; after?: string };
}
export function renderAlbumScenePicker(chapters: AlbumMaterialItem[], choices: AlbumDraftChoices, period?: string, mode?: AlbumScenePickerMode): string {
  const dates = albumDateFormat(period);
  const action = (name: string, value: string) => `data-wiz-action="${name}" data-value="${esc(value)}"`;
  return `<div class="album-scene-picker">${chapters.map((chapter, ci) => {
    const recommended = new Set(recommendedAlbumScenes(chapter, choices.perChapter).map(i => i.id));
    const states = mode && new Map((chapter.children ?? []).map(scene => [scene.id, mode.scene(scene)]));
    const picked = (id: string) => states ? states.get(id)!.checked : choices.scenePicks?.[id] ?? recommended.has(id);
    const children = sortAlbumItemsByDate(chapter.children ?? []);
    const span = dates.span([children[0]?.fields.date, children.at(-1)?.fields.date].filter(Boolean).join(" — "));
    const days = new Map<string, AlbumMaterialItem[]>();
    for (const scene of children) { const day = albumDateOnly(scene.fields.date ?? ""), rows = days.get(day) ?? []; rows.push(scene); days.set(day, rows); }
    return `<details class="asp-chapter" data-wiz-fold="${esc(chapter.id)}"${ci === 0 ? " open" : ""}><summary><span class="asp-number">${String(ci + 1).padStart(2, "0")}</span><b>${esc(chapterTitle(chapter))}${mode?.chapterTag?.(chapter) ?? ""}</b><span class="asp-count"><strong>${children.filter(c => picked(c.id)).length}</strong>개 담음 · ${children.length}개 중${span ? ` · ${esc(span)}` : ""}</span>${icon("chevron")}</summary><div class="asp-days">${[...days].map(([day, scenes]) => `<div class="asp-day"><span class="asp-date">${esc(dates.date(day))}</span><div>${scenes.map(scene => {
      const state = states?.get(scene.id), on = picked(scene.id), quotes = recommendedAlbumQuotes(scene.children ?? []);
      const qp = choices.quotePicks?.[scene.id] ?? quotes.slice(0, 1).map(q => q.id);
      const line = (q: AlbumMaterialItem) => `<label class="asp-line${qp.includes(q.id) ? " on" : ""}"><input type="checkbox" ${mode ? `data-update-quote="${esc(q.id)}"` : action("quote", q.id)} data-scene="${esc(scene.id)}"${qp.includes(q.id) ? " checked" : ""}><span><q>${esc(q.fields.text ?? q.fields.body ?? "")}</q><small>${esc(q.fields.speaker ?? "")}</small></span></label>`;
      const signals = [[scene.signals?.anniversary, "기념일"], [scene.signals?.bookmark, "즐겨찾기"], [scene.signals?.illustration ?? Boolean(scene.inlayIds?.length || scene.photos.length), "삽화"]].filter(([yes]) => yes);
      return `<div class="asp-scene${on ? " on" : ""}"><label class="asp-title"><input class="asp-check" type="checkbox" ${mode ? `${state?.existingId ? `data-update-existing="${esc(state.existingId)}"` : `data-update-add="${esc(scene.id)}"`}${state?.locked ? " disabled" : ""}` : action("scene", scene.id)}${on ? " checked" : ""}><span>${esc(scene.fields.title ?? "")}${state?.tag ?? ""}${signals.map(([, text]) => `<small class="asp-signal">${text}</small>`).join("")}</span></label>${state?.after ?? ""}${(!mode || state?.lines) && on && quotes.length ? `<div class="asp-lines">${quotes.slice(0, 2).map(line).join("")}${quotes.length > 2 ? `<details data-wiz-fold="quotes-${esc(scene.id)}"><summary class="asp-more">대사 ${quotes.length - 2}줄 더</summary>${quotes.slice(2).map(line).join("")}</details>` : ""}</div>` : ""}</div>`;
    }).join("")}</div></div>`).join("")}</div></details>`;
  }).join("")}</div>`;
}

export const ALBUM_SCENE_PICKER_CSS = `
.album-scene-picker{--asp-accent:var(--accent-text,var(--accent,var(--tungsten)));--asp-fill:var(--accent,var(--tungsten));--asp-soft:var(--accent-soft,var(--tungsten-dim));font-family:var(--sans,system-ui,sans-serif)}
.album-scene-picker .asp-chapter{border-top:1px solid var(--rule)}
.album-scene-picker .asp-chapter:first-of-type{margin-top:18px}
.album-scene-picker .asp-chapter>summary{list-style:none;display:grid;grid-template-columns:28px minmax(0,1fr) auto 20px;align-items:baseline;gap:10px;padding:16px 2px 14px;cursor:pointer}
.album-scene-picker summary::-webkit-details-marker{display:none}
.album-scene-picker .asp-chapter>summary::before,.album-scene-picker .asp-chapter>summary::after{content:none}
.album-scene-picker .asp-number{font-size:12.5px;font-weight:700;color:var(--ink-3);font-variant-numeric:tabular-nums}
.album-scene-picker .asp-chapter>summary>b{font-size:15.5px;font-weight:700}
.album-scene-picker .asp-count{font-size:12.5px;color:var(--ink-3);white-space:nowrap;font-variant-numeric:tabular-nums}
.album-scene-picker .asp-count strong{color:var(--asp-accent);font-weight:750}
.album-scene-picker .asp-chapter>summary>.i{align-self:center;color:var(--ink-3);transform:rotate(90deg);transition:transform .15s}
.album-scene-picker .asp-chapter[open]>summary>.i{transform:rotate(-90deg)}
.album-scene-picker .asp-days{padding-bottom:14px}
.album-scene-picker .asp-day{display:grid;grid-template-columns:64px minmax(0,1fr);gap:0 12px;content-visibility:auto;contain-intrinsic-block-size:auto 200px}
.album-scene-picker .asp-date{position:sticky;top:64px;align-self:start;padding-top:11px;font-size:12.5px;font-weight:650;color:var(--ink-3);font-variant-numeric:tabular-nums}
.album-scene-picker .asp-day+.asp-day{margin-top:6px}
.album-scene-picker .asp-scene{position:relative;padding:9px 0 9px 34px;border-radius:10px}
.album-scene-picker .asp-title{display:block;font-size:14.5px;line-height:1.55;color:var(--ink-3);cursor:pointer}
.album-scene-picker .asp-scene.on>.asp-title{color:var(--ink);font-weight:560}
.album-scene-picker input{appearance:none;display:grid;place-items:center;margin:3px 0 0;width:16px;height:16px;border-radius:5px;border:1.5px solid var(--rule-2);background:var(--screen);padding:0;flex:none;cursor:pointer}
.album-scene-picker input:checked{background:var(--asp-fill);border-color:var(--asp-fill)}
.album-scene-picker input:checked::after{content:"";width:8px;height:4px;border-left:2px solid var(--accent-ink,var(--tungsten-ink,#fff));border-bottom:2px solid var(--accent-ink,var(--tungsten-ink,#fff));transform:translateY(-1px) rotate(-45deg)}
.album-scene-picker .asp-check{position:absolute;left:4px;top:10px;margin:0;width:22px;height:22px;border-radius:50%}
.album-scene-picker .asp-signal{margin-left:6px;font-size:11.5px;font-weight:650;color:var(--asp-accent);white-space:nowrap}
.album-scene-picker .asp-signal::before{content:"· ";color:var(--ink-3)}
.album-scene-picker .asp-scene:hover{background:var(--screen-2)}
.album-scene-picker .asp-lines{margin:8px 0 4px;padding-left:12px;border-left:2px solid var(--asp-soft);display:grid;gap:2px}
.album-scene-picker .asp-line{display:grid;grid-template-columns:18px minmax(0,1fr);gap:8px;padding:5px 6px;border-radius:8px;cursor:pointer}
.album-scene-picker .asp-line:hover{background:var(--screen)}
.album-scene-picker .asp-line q{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;quotes:"“" "”";font:400 14px/1.6 var(--serif,AppleMyungjo,serif);color:var(--ink-3)}
.album-scene-picker .asp-line.on q{color:var(--ink)}
.album-scene-picker .asp-line small{display:block;margin-top:1px;font-size:12px;color:var(--ink-3)}
.album-scene-picker .asp-more{list-style:none;margin:2px 0 0 32px;min-height:32px;display:flex;align-items:center;font-size:12.5px;font-weight:650;color:var(--asp-accent);cursor:pointer}
.album-wizard .album-scene-picker :is(.asp-chapter>summary,.asp-more)::after,.au-picker .album-scene-picker :is(.asp-chapter>summary,.asp-more)::after{content:none}
@container(max-width:560px){.album-scene-picker .asp-day{grid-template-columns:1fr}.album-scene-picker .asp-date{position:static;padding:8px 0 0 4px}.album-scene-picker .asp-chapter>summary{grid-template-columns:24px minmax(0,1fr) 20px;row-gap:2px}.album-scene-picker .asp-count{grid-column:2;grid-row:2;white-space:normal}.album-scene-picker .asp-chapter>summary>.i{grid-column:3;grid-row:1}}
`;
