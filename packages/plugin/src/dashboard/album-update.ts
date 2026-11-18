import { albumDay, isNewAlbumMaterial, unusedAlbumMaterials, type AlbumDocument, type AlbumItem, type AlbumMaterialItem, type AlbumMaterials, type AlbumUpdateCandidates, type Candidate, type ChangedCandidate } from "@rcm/shared";
import { albumThemeVoice } from "../album/themes/index.js";
import { escapeHtml as esc } from "./film/ui.js";
import { renderAlbumScenePicker } from "./album-scene-picker.js";
import { ALBUM_FIELD_LABELS } from "./album-labels.js";

export interface AlbumUpdateState {
  candidates?: AlbumUpdateCandidates;
  materials?: AlbumMaterials;
  together?: AlbumMaterials["together"];
  sourceAdditions?: Candidate[];
  all?: boolean;
  add: string[];
  replace: string[];
  remove?: string[];
  quotePicks?: Record<string, string[]>;
  saving?: boolean;
  error?: string;
  conflict?: boolean;
}
const button = (action: string, text: string, extra = "") => `<button type="button" data-album-action="${action}" ${extra}>${text}</button>`;
const title = (item: Pick<AlbumItem, "fields">) => item.fields.title || item.fields.text || item.fields.summary || item.fields.body || "";
const flatten = (items: AlbumItem[]): AlbumItem[] => items.flatMap(i => [i, ...flatten(i.children ?? [])]);
const same = (a: AlbumItem, b: AlbumItem) => a.id === b.id || Boolean(a.origin && b.origin && a.origin.kind === b.origin.kind && a.origin.sourceId === b.origin.sourceId);
export function albumUpdateAdditions(doc: AlbumDocument, state: AlbumUpdateState): Candidate[] {
  if (state.sourceAdditions) return state.sourceAdditions;
  if (!state.materials) return state.candidates?.added ?? [];
  const kinds = new Set(doc.blocks.map(b => b.kind));
  const missing = Object.values(unusedAlbumMaterials(doc, state.materials)).flat().filter(c => kinds.has(c.blockKind));
  const seen = new Set<string>();
  return [...missing, ...(state.candidates?.added ?? []).filter(c => c.blockKind !== "story" || c.item.origin?.kind === "dialogue")].filter(c => {
    if (seen.has(c.item.id)) return false;
    seen.add(c.item.id); return true;
  });
}

/** The creation picker also owns the update layout; explicit choices add lines or remove placed scenes. */
export function renderAlbumUpdateDialog(doc: AlbumDocument, state: AlbumUpdateState): string {
  const c = state.candidates, disabled = state.saving || state.conflict ? " disabled" : "";
  if (c && !c.available) return `<section class="av-pop av-export av-update"><p class="au-empty">원래 채팅을 찾을 수 없어 업데이트할 수 없어요</p><footer class="au-foot">${button("album-overlay-close", "닫기")}</footer></section>`;
  const additions = albumUpdateAdditions(doc, state), current = flatten(doc.blocks.flatMap(b => b.items));
  const material = (i: AlbumItem): AlbumMaterialItem => ({ ...i, suggested: true, children: i.children?.map(material) });
  const chapters: AlbumMaterialItem[] = state.materials?.blocks.story.map(ch => ({ ...ch, children: [...(ch.children ?? [])] })) ?? doc.blocks.filter(b => b.kind === "story").flatMap(b => b.items).map(ch => ({ ...ch, suggested: true, children: [...(ch.children ?? []), ...additions.filter(a => a.blockKind === "story").map(a => a.item)].map(material) }));
  // The full view also keeps placed scenes whose original material has disappeared.
  for (const stored of doc.blocks.filter(b => b.kind === "story").flatMap(b => b.items)) {
    const source = chapters.find(ch => same(ch, stored));
    if (!source) { chapters.push(material(stored)); continue; }
    const missing = (stored.children ?? []).filter(scene => !source.children?.some(sc => same(sc, scene))).map(material);
    if (missing.length) source.children = [...(source.children ?? []), ...missing];
  }
  const byId = new Map<string, number>(), byOrigin = new Map<string, number>();
  const origin = (item: AlbumItem) => item.origin && JSON.stringify([item.origin.kind, item.origin.sourceId]);
  current.forEach((item, index) => { if (!byId.has(item.id)) byId.set(item.id, index); const key = origin(item); if (key && !byOrigin.has(key)) byOrigin.set(key, index); });
  const existing = (item: AlbumItem) => {
    const key = origin(item), index = Math.min(byId.get(item.id) ?? Infinity, key ? byOrigin.get(key) ?? Infinity : Infinity);
    return current[index];
  };
  const changes = new Map(c?.changed.map(row => [row.itemId, row]));
  const changedFor = (item: AlbumItem) => changes.get(existing(item)?.id ?? "");
  const isFresh = (item: AlbumItem) => state.materials ? isNewAlbumMaterial(doc, item) : Boolean(c?.added.some(a => a.item.id === item.id));
  const tag = (kind: string, text: string) => `<i class="au-tag ${kind}">${text}</i>`;
  const changed = (row: ChangedCandidate) => {
    const index = byId.get(row.itemId), live = index === undefined ? row.before : current[index]!.fields;
    const keys = [...new Set([...Object.keys(row.before), ...Object.keys(row.after)])].filter(k => ALBUM_FIELD_LABELS[k] && row.before[k] !== row.after[k]);
    const before = keys.map(k => esc(live[k] ?? "")).join(" · "), after = keys.map(k => esc(row.after[k] ?? "")).join(" · ");
    return row.userEdited ? `<details class="au-compare" data-update-detail="${esc(row.itemId)}"><summary>비교 보기 · 내가 고친 글</summary><div class="au-diff"><del>전: ${before}</del><br><ins>${after}</ins><p>고친 글은 자동으로 바꾸지 않아요. 필요하면 꾸미기에서 직접 고쳐 주세요.</p></div></details>` : `<div class="au-diff"><div><del>전: ${before}</del></div><div><ins>${after}</ins></div><div class="au-acts">${button("album-update-keep", "그대로 두기", `data-value="${esc(row.itemId)}" class="${state.replace.includes(row.itemId) ? "" : "on"}"${disabled}`)}${button("album-update-replace", "새 내용으로", `data-value="${esc(row.itemId)}" class="${state.replace.includes(row.itemId) ? "on" : ""}"${disabled}`)}</div></div>`;
  };
  const scenes = chapters.flatMap(ch => ch.children ?? []), newCount = scenes.filter(s => !existing(s) && isFresh(s)).length;
  const changedCount = c?.changed.length ?? 0, changedSceneCount = c?.changed.filter(row => scenes.some(sc => existing(sc)?.id === row.itemId)).length ?? 0, includedCount = scenes.filter(s => existing(s)).length;
  const visible = chapters.map(ch => ({ ...ch, children: (ch.children ?? []).filter(sc => state.all || !existing(sc) && isFresh(sc) || changedFor(sc)) })).filter(ch => ch.children.length);
  let body = !c ? `<p class="au-empty" role="status">${state.error ? esc(state.error) + button("album-update-reload", "다시 찾기") : "새 기억을 찾는 중…"}</p>` : renderAlbumScenePicker(visible, { quotePicks: state.quotePicks }, doc.periodLabel, {
    chapterTag: ch => !existing(ch) && ch.children?.some(isFresh) ? tag("new", "새 장") : "",
    scene: sc => { const old = existing(sc), change = changedFor(sc), removed = Boolean(old && state.remove?.includes(old.id)); return { checked: Boolean(old ? !removed : state.add.includes(sc.id)), locked: Boolean(disabled), existingId: old?.id, lines: !old, tag: removed ? tag("out", "빠짐") : change ? tag("chg", "바뀜") : !old && isFresh(sc) ? tag("new", "새로") : "", after: removed ? '<p class="au-outnote">적용하면 앨범에서 빠져요. 쓴 글과 사진도 같이 빠져요.</p>' : change ? changed(change) : "" }; },
  });
  const others = additions.filter(a => a.blockKind !== "story" || !scenes.some(sc => sc.id === a.item.id)).filter(a => state.all || isFresh(a.item));
  if (c) for (const kind of [...new Set([...others.map(a => a.blockKind), ...c.changed.filter(row => !scenes.some(sc => existing(sc)?.id === row.itemId)).map(row => row.blockKind)])]) {
    body += `<section class="au-section"><h4>${albumThemeVoice(doc.style.theme).blocks[kind].title}</h4>${others.filter(a => a.blockKind === kind).map(a => `<label class="au-row"><input type="checkbox" data-update-add="${esc(a.item.id)}"${state.add.includes(a.item.id) ? " checked" : ""}${disabled}><span>${esc(title(a.item))}${isFresh(a.item) ? tag("new", "새로") : ""}</span></label>`).join("")}${c.changed.filter(row => row.blockKind === kind && !scenes.some(sc => existing(sc)?.id === row.itemId)).map(row => `<article class="au-record-change"><b>${esc(title({ fields: row.after }))}${tag("chg", "바뀜")}</b>${changed(row)}</article>`).join("")}</section>`;
  }
  const freshOthers = others.some(a => isFresh(a.item));
  if (c && !state.all && !newCount && !changedCount && !freshOthers) body = '<p class="au-empty-note">앨범에 넣지 않은 다른 장면도 "전체"에서 골라 넣을 수 있어요. 이미 넣은 장면도 "전체"에서 뺄 수 있어요.</p>';
  const date = albumDay(new Date(doc.lastUpdatedFromMaterialsAt ?? doc.createdAt).toISOString().slice(0, 10));
  const count = state.add.length + state.replace.length + (state.remove?.length ?? 0);
  return `<section class="av-pop av-update au-picker" role="dialog" aria-modal="true" aria-label="새로 생긴 장면을 넣을까요?" aria-busy="${Boolean(state.saving || !c && !state.error)}"><header class="au-head"><h3>새로 생긴 장면을 넣을까요?</h3><p>${date}에 앨범을 만든 뒤로 ${newCount || changedSceneCount ? `새 장면 <b>${newCount}</b>개, 바뀐 기록 <b>${changedCount}</b>개가 생겼어요.` : "새로 생긴 장면이 없어요."}</p><div class="au-summary"><span>${tag("new", "새로")} ${newCount}</span><span>${tag("chg", "바뀜")} ${changedCount}</span><span>이미 넣은 장면 ${includedCount}</span><div class="seg au-filter" role="group" aria-label="표시할 기억">${button("album-update-new", "새로 생긴 것만", `aria-pressed="${!state.all}"${disabled}`)}${button("album-update-full", "전체", `aria-pressed="${Boolean(state.all)}"${disabled}`)}</div></div></header><div class="au-body">${body}</div>${c && state.error ? `<p class="au-error" role="alert">${esc(state.error)}${state.conflict ? button("album-update-reload", "새로 불러오기") : ""}</p>` : ""}<footer class="au-foot">${button("album-overlay-close", "닫기")}<span>넣기 <b>${state.add.length}</b> · 빼기 <b>${state.remove?.length ?? 0}</b> · 바꾸기 <b>${state.replace.length}</b></span>${button("album-update-apply", state.saving ? "반영 중…" : "적용", `class="av-export-save"${!count || disabled ? " disabled" : ""}`)}</footer></section>`;
}
