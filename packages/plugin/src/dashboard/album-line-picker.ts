import { AlbumItemSchema, albumCoverQuote, albumDay, albumLine, type AlbumDocument, type AlbumItem, type AlbumMaterials } from "@rcm/shared";
import { insertBlock } from "../album/edit.js";
import { escapeHtml as esc, icon } from "./film/ui.js";

export function albumMaterialLines(materials?: AlbumMaterials): { item: AlbumItem; scene: string; date: string }[] {
  if (!materials) return [];
  const rows = materials.blocks.story.flatMap(ch => (ch.children ?? []).flatMap(scene => (scene.children ?? []).map(item => ({ item, scene: scene.fields.title ?? "", date: item.fields.date ?? scene.fields.date ?? "" }))));
  rows.push(...materials.blocks.quotes.map(item => ({ item, scene: "", date: item.fields.date ?? "" })));
  const seen = new Set<string>();
  const key = (item: AlbumItem) => item.origin ? JSON.stringify([item.origin.kind, item.origin.sourceId]) : item.id;
  return rows.filter(row => { if (!albumLine(row.item).trim() || seen.has(key(row.item))) return false; seen.add(key(row.item)); return true; });
}

export function createAlbumLinePicker(root: HTMLElement, hooks: {
  document: () => AlbumDocument; materials: () => AlbumMaterials | undefined;
  apply: (next: AlbumDocument, blockId: string) => void;
}) {
  let active = false, blockId = "", adding = false, cover = false, all = false, search = "";
  let coverTab: "pick" | "write" = "pick", writtenText = "", writtenSpeaker = "", writtenId = "", customSpeaker = false;
  let anchor: DOMRect | undefined;
  let picked = new Set<string>(), previous: HTMLElement | null = null;
  const mount = () => root.querySelector<HTMLElement>(".ae-line-overlay");
  const button = (a: string, text: string, extra = "") => `<button type="button" data-line-action="${a}" ${extra}>${text}</button>`;
  const close = () => { active = false; mount()?.replaceChildren(); const base = root.querySelector<HTMLElement>(".ae-base"); if (base) base.inert = false; previous?.isConnected && previous.focus({ preventScroll: true }); };
  const sourceRows = () => {
    const rows = albumMaterialLines(hooks.materials()), doc = hooks.document();
    const existing = cover ? [albumCoverQuote(doc)].filter((i): i is AlbumItem => Boolean(i)) : doc.blocks.find(b => b.id === blockId)?.items ?? [];
    for (const item of existing) {
      const row = rows.find(r => r.item.id === item.id || item.origin && r.item.origin?.kind === item.origin.kind && r.item.origin.sourceId === item.origin.sourceId);
      if (row) row.item = item;
      else rows.push({ item, scene: "", date: item.fields.date ?? "" });
    }
    if (cover && writtenText.trim()) {
      const item = AlbumItemSchema.parse({ id: writtenId, fields: { text: writtenText, speaker: writtenSpeaker }, edited: { text: true, speaker: true } });
      const index = rows.findIndex(r => r.item.id === writtenId); if (index >= 0) rows[index] = { item, scene: "", date: "" }; else rows.push({ item, scene: "", date: "" });
    }
    return rows;
  };
  const paint = (focus = false) => {
    const m = mount(); if (!m || !active) return;
    const top = m.querySelector(".alp-list")?.scrollTop ?? 0;
    const focused = document.activeElement?.matches(".alp-search"), selection = (document.activeElement as HTMLInputElement)?.selectionStart;
    const doc = hooks.document(), names = new Set([doc.people.me.name.trim(), doc.people.partner.name.trim()]);
    const rows = sourceRows().filter(r => (cover || all || names.has(r.item.fields.speaker?.trim() ?? "")) && `${albumLine(r.item)} ${r.scene}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    let group = "";
    const tabs = `<div class="seg alp-cover-tabs" role="group" aria-label="표지 대사 입력">${button("pick", "고르기", `aria-pressed="${coverTab === "pick"}"`)}${button("write", "직접 쓰기", `aria-pressed="${coverTab === "write"}"`)}</div>`;
    const free = `<div class="alp-free"><label><span>문장</span><textarea class="alp-free-text" maxlength="20000" placeholder="표지에 남길 문장을 써 주세요">${esc(writtenText)}</textarea></label><small class="alp-char-count">${[...writtenText].length}자</small><div><p>누가 한 말인가요?</p><div class="alp-speakers">${[doc.people.me.name, doc.people.partner.name].map(name => button("speaker", esc(name), `data-speaker="${esc(name)}" aria-pressed="${!customSpeaker && writtenSpeaker === name}"`)).join("")}${button("speaker-custom", "직접 쓰기", `aria-pressed="${customSpeaker}"`)}${button("speaker-empty", "비우기", `aria-pressed="${!writtenSpeaker && !customSpeaker}"`)}</div>${customSpeaker ? `<input class="alp-free-speaker" aria-label="말한 사람" placeholder="이름" maxlength="20000" value="${esc(writtenSpeaker)}">` : ""}</div></div>`;

    m.innerHTML = `<div class="alp-scrim" data-line-action="close"></div><section class="alp-pop" role="dialog" aria-modal="true" aria-label="${cover ? "표지 대사" : "대사 고르기"}"><header><h4>${cover ? "표지 대사" : "대사 고르기"} <span>${""}</span></h4>${button("close", icon("close"), 'aria-label="닫기"')}</header>${cover ? tabs : `<div class="alp-seg">${button("own", "두 사람", `aria-pressed="${!all}"`)}${button("all", "모든 인물", `aria-pressed="${all}"`)}</div>`}${cover && coverTab === "write" ? free : `<input class="alp-search" placeholder="대사나 장면에서 찾기" aria-label="대사 찾기" value="${esc(search)}"><div class="alp-list">${rows.map(({ item, scene, date }) => {
      const heading = [albumDay(date), scene].filter(Boolean).join(" · "), label = !cover && heading !== group ? `<p class="alp-group">${esc(heading)}</p>` : ""; group = heading;
      return `${label}<label class="alp-opt${picked.has(item.id) ? " on" : ""}"><input type="${cover ? "radio" : "checkbox"}" name="album-line-choice" data-line-id="${esc(item.id)}"${picked.has(item.id) ? " checked" : ""}><span><p>${esc(albumLine(item))}</p><small>${esc([item.fields.speaker, cover ? albumDay(date) : ""].filter(Boolean).join(" · "))}</small></span></label>`;
    }).join("")}${cover ? `<label class="alp-opt alp-none"><input type="radio" name="album-line-choice" data-line-id=""${picked.has("") ? " checked" : ""}><span><p>대사 없이 표지 만들기</p></span></label>` : ""}${!rows.length ? '<p class="alp-empty">고를 대사가 없어요.</p>' : ""}</div>`}<footer><small>${cover ? picked.has("") ? "대사 없음" : "한 줄" : `${picked.size}줄 골랐어요`}</small>${cover ? button("close", "취소") : ""}${button("apply", cover ? "완료" : adding ? "넣기" : "바꾸기", `class="alp-ok"${cover && coverTab === "write" ? !writtenText.trim() ? " disabled" : "" : !picked.size ? " disabled" : ""}`)}</footer></section>`;
    const base = root.querySelector<HTMLElement>(".ae-base"); if (base) base.inert = true;
    const list = m.querySelector(".alp-list"); if (list) list.scrollTop = top;
    if (focused) { const input = m.querySelector<HTMLInputElement>(".alp-search")!; input.focus({ preventScroll: true }); if (selection != null) input.setSelectionRange(selection, selection); }
    else if (focus) m.querySelector<HTMLElement>("button")?.focus();
    else m.querySelector<HTMLInputElement>(`[data-line-id="${CSS.escape([...picked].at(-1) ?? "")}"]`)?.focus({ preventScroll: true });
    const pop = m.querySelector<HTMLElement>(".alp-pop")!;
    if (root.querySelector(".album-edit")!.clientWidth >= 768 && anchor) {
      const r = anchor, h = root.querySelector(".album-edit")!.getBoundingClientRect();
      pop.style.left = `${Math.max(12, Math.min(h.width - pop.offsetWidth - 12, r.left - h.left))}px`;
      pop.style.top = `${Math.max(12, Math.min(h.height - pop.offsetHeight - 12, r.bottom - h.top + 8))}px`;
    }
  };
  root.addEventListener("click", e => {
    const n = (e.target as HTMLElement).closest<HTMLElement>("[data-line-action]"); if (!active || !n) return;
    e.preventDefault(); e.stopPropagation();
    const a = n.dataset.lineAction;
    if (a === "close") { close(); return; }
    if (a === "all" || a === "own") { all = a === "all"; paint(); return; }
    if (cover && (a === "pick" || a === "write")) { coverTab = a; paint(); return; }
    if (cover && a?.startsWith("speaker")) {
      customSpeaker = a === "speaker-custom";
      writtenSpeaker = a === "speaker" ? n.dataset.speaker! : "";
      if (writtenText.trim()) picked = new Set([writtenId]);
      paint(); if (customSpeaker) mount()?.querySelector<HTMLInputElement>(".alp-free-speaker")?.focus(); return;
    }
    if (a === "apply" && (picked.size || cover && coverTab === "write" && writtenText.trim())) {
      let doc = hooks.document();
      if (!cover && adding) { doc = insertBlock(doc, blockId, "quotes"); blockId = doc.blocks[doc.blocks.findIndex(b => b.id === blockId) + 1]!.id; }
      const items = sourceRows().filter(r => picked.has(r.item.id)).map(r => AlbumItemSchema.parse({ ...r.item, fields: { ...r.item.fields, date: r.date } }));
      const userWritten = cover && (coverTab === "write" || picked.has(writtenId));
      if (userWritten && !writtenText.trim()) return;
      if (userWritten) { const line = AlbumItemSchema.parse({ id: writtenId, fields: { text: writtenText, speaker: writtenSpeaker }, edited: { text: true, speaker: true } }); close(); hooks.apply({ ...doc, coverLineId: line.id, coverLine: line, coverLineUserWritten: true }, blockId); return; }
      doc = cover ? { ...doc, coverLineUserWritten: false, coverLineId: picked.has("") ? "" : items[0]?.id ?? "", coverLine: picked.has("") ? undefined : items[0] } : { ...doc, blocks: doc.blocks.map(b => b.id === blockId ? { ...b, items } : b) };
      close(); hooks.apply(doc, blockId);
    }
  });
  root.addEventListener("input", e => { const n = e.target as HTMLInputElement;
    if (active && n.matches(".alp-free-text,.alp-free-speaker")) {
      if (n.matches(".alp-free-text")) writtenText = n.value; else writtenSpeaker = n.value;
      picked = new Set([writtenId]);
      const count = mount()?.querySelector(".alp-char-count"); if (count) count.textContent = `${[...writtenText].length}자`;
      const apply = mount()?.querySelector<HTMLButtonElement>('[data-line-action="apply"]'); if (apply) apply.disabled = !writtenText.trim(); return;
    }
    if (active && n.matches(".alp-search")) { search = n.value; paint(); } });
  root.addEventListener("change", e => { const n = e.target as HTMLInputElement; if (active && n.hasAttribute("data-line-id")) { if (cover) picked = new Set([n.dataset.lineId!]); else if (n.checked) picked.add(n.dataset.lineId!); else picked.delete(n.dataset.lineId!); paint(); } });
  root.addEventListener("keydown", e => {
    if (!active) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    if (e.key === "Tab") { const nodes = [...mount()!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]; if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0]?.focus(); } }
  }, true);
  return { open: (id: string, add: boolean, trigger?: HTMLElement, coverMode = false, rect?: DOMRect) => { anchor = rect ?? trigger?.getBoundingClientRect(); blockId = id; adding = add; cover = coverMode; all = false; search = ""; picked = new Set(cover ? [hooks.document().coverLineId ?? albumCoverQuote(hooks.document())?.id ?? ""] : add ? [] : hooks.document().blocks.find(b => b.id === id)?.items.map(i => i.id)); previous = trigger ?? document.activeElement as HTMLElement; const currentDoc = hooks.document(); writtenText = currentDoc.coverLineUserWritten && currentDoc.coverLine ? albumLine(currentDoc.coverLine) : ""; writtenSpeaker = currentDoc.coverLineUserWritten ? currentDoc.coverLine?.fields.speaker ?? "" : ""; writtenId = currentDoc.coverLineUserWritten && currentDoc.coverLine ? currentDoc.coverLine.id : `cover-written-${crypto.randomUUID()}`; customSpeaker = Boolean(writtenSpeaker && ![currentDoc.people.me.name, currentDoc.people.partner.name].includes(writtenSpeaker)); coverTab = currentDoc.coverLineUserWritten ? "write" : "pick"; active = true; paint(true); }, close, hydrate: () => paint(), get active() { return active; } };
}

export const ALBUM_LINE_PICKER_CSS = `
.ae-line-overlay:not(:empty){position:absolute;inset:0;z-index:65}
.alp-scrim{position:absolute;inset:0;background:#0002}
.alp-pop{position:absolute;z-index:20;width:340px;padding:12px;background:var(--ae-pop-bg);color:var(--ae-pop-ink);border:1px solid var(--ae-pop-rule);border-radius:12px;box-shadow:var(--ae-pop-shadow);font:13px/1.5 var(--sans,"Pretendard Variable",sans-serif);text-align:left;max-height:calc(100% - 24px);display:flex;flex-direction:column}
.alp-pop>header{display:flex;align-items:center}.alp-pop h4{font-size:12px;font-weight:600;color:var(--ae-pop-muted);margin:2px 2px 8px;flex:1;display:flex;justify-content:space-between}.album-edit .alp-pop header button{min-width:30px;min-height:30px;height:30px;padding:0;color:var(--ae-pop-muted)}
.alp-seg{display:flex;gap:4px;margin-bottom:8px}.album-edit .alp-seg button{height:30px;min-height:30px;padding:0 11px;border-radius:7px;background:var(--ae-pop-hover);color:var(--ae-pop-ink);font-size:12.5px}.album-edit .alp-seg button[aria-pressed=true]{background:var(--ae-pop-selected);color:var(--ae-pop-selected-ink);font-weight:650}
.alp-search{width:100%;height:34px;flex:none;border-radius:8px;border:1px solid var(--ae-pop-rule);background:var(--ae-pop-input);color:var(--ae-pop-ink);padding:0 10px;font:13px var(--sans,"Pretendard Variable",sans-serif);margin-bottom:6px}
.alp-list{max-height:270px;overflow:auto;scrollbar-width:thin;margin:0 -4px;padding:0 4px;min-height:0}.alp-group{font-size:11.5px;font-weight:650;color:var(--ae-pop-muted);margin:8px 8px 2px}
.alp-opt{display:grid;grid-template-columns:16px minmax(0,1fr);gap:10px;padding:8px;border-radius:8px;cursor:pointer}.alp-opt:hover{background:var(--ae-pop-hover)}.alp-opt input{appearance:none;margin:3px 0 0;width:16px;height:16px;border-radius:5px;border:1.5px solid var(--ae-pop-muted);padding:0;background:transparent;display:grid;place-items:center}.alp-opt input:checked{background:var(--ae-pop-accent);border-color:var(--ae-pop-accent)}.alp-opt input:checked::after{content:"";width:8px;height:4px;border-left:2px solid var(--ae-pop-accent-ink);border-bottom:2px solid var(--ae-pop-accent-ink);transform:translateY(-1px) rotate(-45deg)}
.alp-opt input[type=radio]{border-radius:50%}.alp-opt input[type=radio]:checked{border:5px solid var(--ae-pop-accent);background:transparent}.alp-opt input[type=radio]:checked::after{content:none}.alp-none p{font:500 13px/1.5 var(--sans);color:var(--ae-pop-muted)}
.alp-opt p{font:400 14px/1.5 var(--serif,"MaruBuri",serif);color:var(--ae-pop-ink);margin:0}.alp-opt small{display:block;color:var(--ae-pop-muted);font-size:11.5px;margin-top:1px}.alp-empty{color:var(--ae-pop-muted);padding:12px 8px}
.alp-pop>footer{display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid var(--ae-pop-rule)}.alp-pop>footer small{color:var(--ae-pop-muted)}.album-edit .alp-pop .alp-ok{height:34px;min-height:34px;padding:0 14px;border-radius:8px;background:var(--ae-pop-accent);color:var(--ae-pop-accent-ink);font-weight:650}
.album-edit .alp-pop button:where(:hover){background:var(--ae-pop-hover)}.album-edit .alp-pop .alp-ok:hover{background:var(--ae-pop-accent)}.album-edit .alp-pop button:focus-visible,.alp-pop input:focus-visible{outline:2px solid var(--ae-pop-accent);outline-offset:2px}
@container(max-width:767px){.alp-pop{inset:auto 0 0!important;width:auto;max-height:90%;border-radius:16px 16px 0 0;padding:18px}.alp-list{max-height:50dvh}.alp-scrim{background:#0007}}

.album-edit .alp-cover-tabs{align-self:flex-start;margin:0 0 12px;padding:2px;border-radius:9px;background:var(--ae-pop-hover)}
.album-edit .alp-cover-tabs button{height:28px;min-height:28px;min-width:0;padding:0 12px;border-radius:7px;font-size:13px;font-weight:600;color:var(--ae-pop-muted)}
.album-edit .alp-cover-tabs button[aria-pressed=true]{background:var(--ae-pop-bg);color:var(--ae-pop-ink);box-shadow:0 1px 3px #0002}
.alp-free{display:grid;gap:14px;padding:0 6px 8px}
.alp-free label>span,.alp-free p{display:block;margin:0 0 6px;font-size:12.5px;font-weight:650;color:var(--ae-pop-muted)}
.alp-free textarea{width:100%;min-height:96px;resize:vertical;border:1px solid var(--ae-pop-rule);border-radius:12px;padding:12px 14px;font:15.5px/1.55 var(--sans);color:var(--ae-pop-ink);background:var(--ae-pop-bg)}
.alp-free textarea:focus,.alp-free-speaker:focus{outline:2px solid var(--ae-pop-accent);outline-offset:2px}
.alp-char-count{justify-self:end;font-size:12px;color:var(--ae-pop-muted);margin-top:-8px}
.alp-speakers{display:flex;flex-wrap:wrap;gap:6px}
.album-edit .alp-speakers button{height:32px;min-height:32px;min-width:0;padding:0 12px;border-radius:999px;border:1px solid var(--ae-pop-rule);font-size:13px;font-weight:600;color:var(--ae-pop-ink);background:var(--ae-pop-bg)}
.album-edit .alp-speakers button[aria-pressed=true]{background:var(--ae-pop-selected);color:var(--ae-pop-selected-ink);border-color:var(--ae-pop-selected)}
.alp-free-speaker{width:100%;margin-top:10px;border:1px solid var(--ae-pop-rule);border-radius:8px;padding:8px 12px;background:var(--ae-pop-input);color:var(--ae-pop-ink);font:15px var(--sans)}
.alp-pop:has(.alp-cover-tabs){width:min(440px,calc(100% - 24px));padding:16px 18px}
.alp-pop:has(.alp-cover-tabs) h4{font-size:17px;font-weight:700;color:var(--ae-pop-ink)}
.alp-pop:has(.alp-cover-tabs)>footer small{margin-right:auto}
.alp-pop:has(.alp-cover-tabs)>footer{gap:8px}
`;
