import { estimateTokens } from "@rcm/shared";
import { setupGroups, type SetupPicker, type SetupSource } from "../setup-sources.js";
import { btn, escapeHtml as esc, icon, notice, seg } from "./film/ui.js";

const count = (value: number): string => value.toLocaleString();

/** Cards keep their grid children; only plain buttons may replace the whole label. */
export function setupEntryLoading(target: HTMLElement): () => void {
  let label = target.matches(".btn") ? target : target.querySelector<HTMLElement>(".noti__bd, .sub");
  const appended = !label;
  if (!label) {
    label = target.ownerDocument.createElement("span");
    label.className = "sub";
    target.append(label);
  }
  const original = label.innerHTML;
  label.textContent = "재료를 불러오는 중…";
  target.setAttribute("aria-busy", "true");
  return () => {
    if (appended) label.remove();
    else label.innerHTML = original;
    target.removeAttribute("aria-busy");
  };
}

/** One-time explanation shown in a dialog before 「초기 설정 다시 읽기」 opens the picker. */
export const REREAD_NOTICE_HTML = `<div class="setup-note"><p class="dialog__text">고른 재료로 처음 설정을 다시 정리해요.</p><dl><div><dt>더해져요</dt><dd>처음에 놓친 인물</dd></div><div><dt>새로 정해져요</dt><dd>이야기에서 아직 바뀌지 않은 관계의 처음 값</dd></div><div><dt>그대로예요</dt><dd>장면 기억과 타임라인, 이야기에서 바뀐 관계, 직접 고친 인물과 관계값</dd></div></dl></div>`;

/** Selection circle as its own 44px target; the row name opens the parsed preview. */
function pick(label: string, action: string, id: string, checked: boolean | "mixed", disabled: boolean): string {
  return `<button type="button" class="setup-pick" role="checkbox" aria-checked="${checked}" aria-label="${esc(label)}" data-action="${action}" data-id="${esc(id)}"${disabled ? " disabled" : ""}><span class="setup-pick__dot" aria-hidden="true"></span></button>`;
}

function tags(item: SetupSource): string {
  return `${item.current ? '<span class="setup-tag setup-tag--current">이 채팅</span>' : ""}${item.used ? '<span class="setup-tag setup-tag--used">지난 요청</span>' : ""}${item.always ? '<span class="setup-tag setup-tag--always">항상 켜짐</span>' : ""}${item.cbs ? '<span class="setup-tag setup-tag--cbs">CBS</span>' : ""}`;
}

function row(view: SetupPicker, item: SetupSource): string {
  const empty = !item.parsed.trim();
  const on = view.selected.has(item.id);
  const open = view.preview === item.id;
  const peek = view.peek === item.id;
  const meta = `${tags(item)}${item.keys ? `<span class="setup-row__keys">${esc(item.keys)}</span>` : ""}${empty ? '<span class="setup-row__keys">내용 없음</span>' : ""}`;
  return `<div class="setup-row${on ? " is-on" : ""}${open ? " is-open" : ""}">
    <div class="setup-row__line">${pick(`${item.name} 읽기`, "setup-toggle", item.id, on, Boolean(view.busy) || empty)}<button type="button" class="setup-row__main" data-action="setup-preview" data-id="${esc(item.id)}" aria-expanded="${peek}"><span class="setup-row__name">${esc(item.name)}</span>${meta ? `<span class="setup-row__meta">${meta}</span>` : ""}</button><span class="setup-row__tok">${count(item.tokens)}</span></div>
    ${peek ? `<div class="setup-row__peek"><p>${esc(item.parsed || "내용이 없어요.")}</p></div>` : ""}</div>`;
}

function lists(view: SetupPicker): string {
  const query = view.query.trim().toLocaleLowerCase();
  // 추천 keeps only this chat's greeting; the other greetings wait in 전체.
  const visible = view.items.filter(item => (view.tab === "all" || (item.kind !== "lore" && (item.kind !== "firstMessage" || item.current !== false)) || item.defaultSelected || item.used)
    && (!query || `${item.name} ${item.keys}`.toLocaleLowerCase().includes(query)));
  const everything = setupGroups(view.items);
  let heading = "";
  return setupGroups(visible).map(group => {
    const all = everything.find(candidate => candidate.key === group.key)!.items.filter(item => item.parsed.trim());
    const chosen = all.filter(item => view.selected.has(item.id)).length;
    const state = chosen === 0 ? false : chosen === all.length ? true : "mixed";
    const disabled = Boolean(view.busy) || !all.length;
    const head = group.group !== heading
      ? `<h3 class="setup-group__h"><span>${esc(group.group)}</span>${group.folder ? "" : `<button type="button" class="setup-link" data-action="setup-group" data-id="${esc(group.key)}"${disabled ? " disabled" : ""}>${state === true ? "모두 해제" : "모두 선택"}</button>`}</h3>`
      : "";
    heading = group.group;
    const rows = group.items.map(item => row(view, item)).join("");
    const body = group.folder
      ? `<details class="setup-folder" open data-preserve-open="setup-${esc(group.key)}"><summary class="setup-folder__head">${pick(`${group.folder} 모두 읽기`, "setup-group", group.key, state, disabled)}<span class="setup-folder__name">${esc(group.folder)}</span><span class="setup-folder__count">${chosen}/${all.length}</span></summary>${rows}</details>`
      : rows;
    return `${head}<div class="setup-cells">${body}</div>`;
  }).join("");
}

function fallback(view: SetupPicker): string {
  const why = view.fallback === "error" ? "설정 재료를 불러오지 못했어요. 채팅을 확인한 뒤 다시 열어 주세요."
      : "이 채팅을 Risu에서 열면 고를 수 있어요.";
  return `<div class="setup-hold" role="status"><b>지금은 고를 수 없어요.</b> ${why}</div>
    ${notice("최신 Risu에서 이 채팅을 열고 재료를 골라 주세요. 지금은 건너뛰기를 사용할 수 있어요.")}`;
}

export function setupSourcesPage(view: SetupPicker): string {
  const selected = view.items.filter(item => view.selected.has(item.id));
  const total = view.fallback ? 0 : selected.length;
  const tokens = view.fallback ? 0 : selected.reduce((sum, item) => sum + item.tokens, 0);
  const preview = view.items.find(item => item.id === view.preview);
  const picker = `${seg("재료 범위", [
    { value: "recommended", label: "추천", pressed: view.tab === "recommended", action: "setup-tab", data: { id: "recommended" } },
    { value: "all", label: `전체 ${view.items.length}`, pressed: view.tab === "all", action: "setup-tab", data: { id: "all" } },
  ])}<label class="setup-search">${icon("search")}<input type="search" data-setup-search aria-label="이름이나 키워드로 찾기" placeholder="이름이나 키워드" value="${esc(view.query)}"></label><div data-setup-list>${lists(view) || `<p class="setup-foot-note">일치하는 재료가 없어요.</p>`}</div>`;
  const aside = view.fallback ? "" : `<aside class="setup-preview" aria-label="풀린 내용">${preview
    ? `<p class="setup-preview__kicker">${esc(preview.group)}${preview.folder ? ` · ${esc(preview.folder)}` : ""}</p><h2>${esc(preview.name)}</h2><p class="setup-preview__meta"><span>약 ${count(preview.tokens)}토큰</span>${preview.keys ? `<span>키워드 ${esc(preview.keys)}</span>` : ""}${tags(preview)}</p><div class="setup-preview__doc"><p>${esc(preview.parsed || "내용이 없어요.")}</p></div>${preview.cbs ? '<p class="setup-foot-note">{{user}} 같은 CBS는 지금 채팅 기준으로 풀어서 보여요.</p>' : ""}`
    : `<p class="setup-preview__empty">재료 이름을 누르면 풀린 내용을 볼 수 있어요.</p>`}</aside>`;
  return `<section class="setup" aria-labelledby="setup-title" aria-busy="${Boolean(view.busy)}">
    <header class="setup__head"><div class="setup__bar"><button type="button" class="setup-back" data-action="setup-close">${icon("back")}<span>홈</span></button>${view.fallback ? "" : `<button type="button" class="setup-link" data-action="setup-clear"${view.busy ? " disabled" : ""}>전체 해제</button>`}</div>
    <h1 id="setup-title" class="setup__title">설정 재료</h1><p class="setup__lede">처음 인물과 관계를 정할 때 읽을 내용이에요.${view.fallback ? "" : " 고른 것만 읽어요."} 직접 고친 인물과 관계값은 그대로 지켜요.</p></header>
    ${view.unparsed ? notice("구형 Risu에서는 {{…}} CBS가 풀리지 않은 원문을 읽어요. 업데이트하면 CBS와 모듈 로어북을 사용할 수 있어요.") : ""}
    ${view.error ? `<div role="alert">${notice(view.error, { tone: "cut" })}</div>` : ""}
    <div class="setup__cols${view.fallback ? " is-held" : ""}"><div class="setup__list" data-preserve-scroll="setup-list">${view.fallback ? fallback(view) : picker}</div>${aside}</div>
    <footer class="setup__dock"><div class="setup__total"><span aria-live="polite">${view.fallback ? `설정 <b>${count(total)}묶음</b>` : `선택 <b>${count(total)}개</b>`} · 약 ${count(tokens)}토큰</span>${view.fallback ? "" : `<button type="button" class="setup-link" data-action="setup-reset"${view.busy ? " disabled" : ""}>기본값으로</button>`}</div>
    <div class="setup__acts">${view.reread ? btn("취소", { kind: "quiet", action: "setup-close", disabled: view.busy }) : btn("건너뛰기", { kind: "quiet", action: "setup-skip", disabled: view.busy })}${btn(view.busy ? "읽는 중…" : view.reread ? "다시 읽기" : "이대로 읽기", { kind: "primary", action: "setup-submit", disabled: view.busy || total === 0 })}</div></footer></section>`;
}
