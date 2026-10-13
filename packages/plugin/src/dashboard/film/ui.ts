// Film component helpers. Each returns an HTML string; every label and attribute value is escaped here,
// while `body`, `control`, `end`, `record`, and `action` slots take caller-built HTML.
import { lex } from "../lexicon.js";
import { formatStoryTime } from "@rcm/shared";

export const escapeHtml = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

/** Promise text and its scene fill the row; only the meta line shares space with the menu. */
export function promiseEntry(parts: { direction: string; scheduledFor?: string; status?: string; body: string; src: string; actions?: string }): string {
  const meta = [parts.direction, parts.status, parts.scheduledFor ? `예정 · ${formatStoryTime(parts.scheduledFor)}` : ""].filter(Boolean).join(" · ");
  return `<li class="entry entry--promise"><div class="entry__head"><span class="entry__who">${escapeHtml(meta)}</span>${parts.actions ?? ""}</div><span class="entry__body">${parts.body}</span>${parts.src ? `<div class="entry__src">${parts.src}</div>` : ""}</li>`;
}

type Data = Record<string, string>;

const dataAttrs = (data?: Data): string => Object.entries(data ?? {})
  .map(([key, value]) => ` data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${escapeHtml(value)}"`).join("");

const actionAttrs = (action?: string, data?: Data): string =>
  `${action ? ` data-action="${escapeHtml(action)}"` : ""}${dataAttrs(data)}`;

export const ICONS: Record<string, string> = {
  overview: '<path d="M4 5h7v6H4zM13 5h7v10h-7zM4 13h7v6H4zM13 17h7v2h-7z"/>',
  timeline: '<path d="M6 3v18M6 7h8M6 12h12M6 17h9"/>',
  relationships: '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="8" r="3"/><circle cx="12" cy="17" r="3"/><path d="m9.7 8.2 4.5-.5m1.1 3-2 3.6m-3.2.2-1.8-4.8"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"/>',
  conflicts: '<path d="M12 4.2 2.8 20.2h18.4L12 4.2Z"/><path d="M12 10.2v4m0 3h.01"/>',
  reviews: '<path d="M5 4h14v16H5zM8 8h8M8 12h5"/><path d="m14 16 2 2 4-5"/>',
  operations: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="10" cy="18" r="1.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.4.25.74.6 1 .99.25.4.4.85.4 1.32V11h.2v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  home: '<path d="m4 11 8-6 8 6v8a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 5 6 9m7-4-2 4m7-4-2 4"/>',
  people: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6"/><circle cx="17" cy="8" r="2.6"/><path d="M16 13.2c2.4.2 4 1.8 4.6 4.3"/>',
  clip: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 3.5h6v3H9zm-.5 8 2 2 4-4m-6 7h7"/>',
  sliders: '<path d="M4 7h10m4 0h2M4 17h4m4 0h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  check: '<path d="M5 12.5 9.5 17 19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ring: '<circle cx="12" cy="12" r="9"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>',
  save: '<path d="M4.5 5h15v14h-15z"/><path d="M7.5 5v5h8V5M8 19v-6h8v6"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 19h14"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  delete: '<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7M10 11v6m4-6v6"/>',
  bookmark: '<path d="m12 3 2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84L6.6 19.6l1.03-6-4.36-4.25 6.03-.88L12 3Z"/>',
  pin: '<path d="M7 3h10l-1 7 4 4H4l4-4-1-7Z"/><path d="M12 14v7"/>',
  inactive: '<circle cx="12" cy="12" r="8"/><path d="M6.3 6.3 17.7 17.7"/>',
  "arrow-right": '<path d="M5 12h14M15 8l4 4-4 4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  landmark: '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/>',
  down: '<path d="m7 10 5 5 5-5"/>',
  up: '<path d="m7 14 5-5 5 5"/>',
  swap: '<path d="M7 7h12m-3-3 3 3-3 3M17 17H5m3-3-3 3 3 3"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  pencil: '<path d="m4.5 19.5 4-1 11-11-3-3-11 11z"/><path d="m14.5 5.5 3 3"/>',
  alert: '<path d="M12 4.2 2.8 20.2h18.4L12 4.2Z"/><path d="M12 10.2v4m0 3h.01"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
};

export const icon = (name: string): string =>
  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ICONS.overview}</svg>`;

export type ButtonKind = "primary" | "secondary" | "quiet" | "danger" | "danger-solid";

const AVATAR_HUES = [350, 26, 62, 98, 134, 170, 206, 242, 278, 314];

/** A monogram circle for a person; its hue is fixed by the name so the same person reads the same everywhere. Film hides it. */
export function avatar(name: string, size: "sm" | "md" | "xl" = "md"): string {
  const text = String(name ?? "").trim();
  // FNV-1a picks one of ten pastel hues spaced so neighbours in a list rarely look alike.
  let hash = 2166136261;
  for (const char of text.toLocaleLowerCase()) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0;
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length];
  const initial = Array.from(text)[0]?.toLocaleUpperCase() ?? "?";
  return `<span class="av av--${size}" style="--av-h:${hue}" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

export function btn(label: string, opts: {
  kind?: ButtonKind; icon?: string; iconEnd?: string; action?: string; data?: Data; disabled?: boolean; hit?: boolean; type?: "button" | "submit";
} = {}): string {
  const cls = `btn btn--${opts.kind ?? "secondary"}${opts.hit ? " hit" : ""}`;
  return `<button type="${opts.type ?? "button"}" class="${cls}"${actionAttrs(opts.action, opts.data)}${opts.disabled ? " disabled" : ""}>${opts.icon ? icon(opts.icon) : ""}${escapeHtml(label)}${opts.iconEnd ? icon(opts.iconEnd) : ""}</button>`;
}

export function iconBtn(name: string, label: string, opts: { action?: string; data?: Data; expanded?: boolean } = {}): string {
  const expanded = opts.expanded === undefined ? "" : ` aria-expanded="${opts.expanded}"`;
  return `<button type="button" class="iconbtn hit" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"${actionAttrs(opts.action, opts.data)}${expanded}>${icon(name)}</button>`;
}

/** Reveals only this input's current value, never a credential from the server. */
export function secretInput(name: string, label: string, opts: { value?: string; placeholder?: string; disabled?: boolean } = {}): string {
  return `<span class="secret-input"><input name="${escapeHtml(name)}" type="password" aria-label="${escapeHtml(label)}" value="${escapeHtml(opts.value ?? "")}" autocomplete="new-password" spellcheck="false" autocapitalize="off" placeholder="${escapeHtml(opts.placeholder ?? "")}"${opts.disabled ? " disabled" : ""}><button type="button" class="iconbtn" data-action="toggle-secret" data-secret-label="${escapeHtml(label)}" aria-label="${escapeHtml(label)} 표시" title="${escapeHtml(label)} 표시" aria-pressed="false"${opts.disabled ? " disabled" : ""}>${icon("eye")}</button></span>`;
}

export function toggleSecretInput(button: HTMLElement, visible?: boolean): void {
  const input = button.closest(".secret-input")?.querySelector<HTMLInputElement>("input");
  if (!input || input.disabled) return;
  const show = visible ?? input.type === "password";
  input.type = show ? "text" : "password";
  const label = `${button.dataset.secretLabel ?? "입력값"} ${show ? "숨기기" : "표시"}`;
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.setAttribute("aria-pressed", String(show));
}

export function maskSecretInputs(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-action="toggle-secret"]').forEach(button => toggleSecretInput(button, false));
}

export function connectionCheck(target: "risu" | "server" | "mcp" | "voyage", trailing = ""): string {
  const label = { risu: "Risu 보조 모델", server: "서버 보조 모델", mcp: "검색 보조 모델", voyage: "Voyage" }[target];
  const description = "짧은 확인 요청을 보냅니다. 호출 비용이 발생하며 설정은 저장하지 않아요.";
  return `<div class="connection-check settings-action" data-connection-check="${target}"><button type="button" class="btn btn--quiet" data-action="test-connection" data-target="${target}" title="${description}" aria-describedby="connection-help-${target}">연결 확인</button><span class="sr-only" id="connection-help-${target}">${description}</span><span class="connection-result" role="status" aria-live="polite" aria-label="${label} 연결 확인 결과" data-connection-result></span>${trailing}</div>`;
}

export function seg(name: string, options: Array<{ value: string; label: string; pressed: boolean; action?: string; data?: Data }>): string {
  const buttons = options.map((option) =>
    `<button type="button" aria-pressed="${option.pressed}" data-value="${escapeHtml(option.value)}"${actionAttrs(option.action, option.data)}>${escapeHtml(option.label)}</button>`).join("");
  return `<div class="seg" role="group" aria-label="${escapeHtml(name)}">${buttons}</div>`;
}

export function tabs(items: Array<{ label: string; selected: boolean; count?: number; action: string; data?: Data }>, label: string): string {
  const buttons = items.map((item) => {
    const count = item.count ? `<span class="count">${item.count}</span>` : "";
    return `<button type="button" class="tab" role="tab" aria-selected="${item.selected}"${actionAttrs(item.action, item.data)}>${escapeHtml(item.label)}${count}</button>`;
  }).join("");
  return `<div class="tabs" role="tablist" aria-label="${escapeHtml(label)}">${buttons}</div>`;
}

export function filters(items: Array<{ label: string; pressed: boolean; count?: number; icon?: string; action: string; data?: Data }>, label: string): string {
  const buttons = items.map((item) => {
    const count = item.count === undefined ? "" : ` <span class="n">${item.count}</span>`;
    // The phone skin draws icon filters as tiles; Film hides the icon.
    const mark = item.icon ? `<span class="filter__ic" aria-hidden="true">${icon(item.icon)}</span>` : "";
    return `<button type="button" class="filter"${actionAttrs(item.action, item.data)} aria-pressed="${item.pressed}">${mark}${escapeHtml(item.label)}${count}</button>`;
  }).join("");
  return `<div class="filters" role="group" aria-label="${escapeHtml(label)}">${buttons}</div>`;
}

export type MenuItem = { label: string; icon?: string; action: string; data?: Data; danger?: boolean; count?: number; disabled?: boolean };

/**
 * `trigger` swaps the ··· button for another symbol (the phone skin's reminder ring) and adds its class.
 * `face` makes the given markup the trigger instead, so a whole card opens its own verbs.
 */
export function menu(opts: { label: string; title?: string; items: Array<MenuItem | "sep">; trigger?: { icon: string; className: string }; face?: { html: string; className: string } }): string {
  const safe = opts.items.filter((item) => item === "sep" || !item.danger);
  const danger = opts.items.filter((item): item is MenuItem => item !== "sep" && Boolean(item.danger));
  const sequence: Array<MenuItem | "sep"> = danger.length ? [...safe, "sep", ...danger] : safe;
  // Separators only ever sit between two items.
  const cleaned = sequence.filter((item, index, all) => item !== "sep"
    || (index > 0 && all[index - 1] !== "sep" && all.slice(index + 1).some((next) => next !== "sep")));
  const body = cleaned.map((item) => {
    if (item === "sep") return '<div class="menu__sep" role="separator"></div>';
    const count = item.count === undefined ? "" : `<span class="k">${item.count}</span>`;
    return `<button type="button" class="menu__item${item.danger ? " menu__item--danger" : ""}" role="menuitem"${actionAttrs(item.action, item.data)}${item.disabled ? " disabled" : ""}>${item.icon ? icon(item.icon) : ""}<span>${escapeHtml(item.label)}</span>${count}</button>`;
  }).join("");
  const title = `<div class="menu__title">${escapeHtml(opts.title ?? opts.label)}</div>`;
  const summary = opts.face
    ? `<summary class="${opts.face.className}" aria-label="${escapeHtml(opts.label)}">${opts.face.html}</summary>`
    : `<summary class="iconbtn hit" aria-label="${escapeHtml(opts.label)}" title="${escapeHtml(opts.label)}">${icon(opts.trigger?.icon ?? "more")}</summary>`;
  return `<details class="menu${opts.trigger ? ` ${opts.trigger.className}` : ""}${opts.face ? " cardmenu" : ""}" data-menu>${summary}<div class="menu__pop menu__list" role="menu" aria-label="${escapeHtml(opts.label)}">${title}${body}</div></details>`;
}

/** `actions` (a `menu()`) sits at the summary's right edge, outside the summary so it never toggles the fold. */
export function fold(summary: string, body: string, opts: { count?: number; open?: boolean; preserveKey?: string; actions?: string; role?: "more" | "section" } = {}): string {
  const more = opts.role === "more" && lex().skin === "phone";
  const label = more ? `${opts.count ?? 0}개 더 보기` : summary;
  const count = more || opts.count === undefined ? "" : `<span class="n">${opts.count}</span>`;
  const preserve = opts.preserveKey ? ` data-preserve-open="${escapeHtml(opts.preserveKey)}"` : "";
  const details = `<details class="fold${opts.role ? ` fold--${opts.role}` : ""}"${opts.open ? " open" : ""}${preserve}><summary><span>${escapeHtml(label)}</span>${count}<span class="chev" aria-hidden="true">${icon("chevron")}</span></summary><div class="fold__body">${body}</div></details>`;
  return opts.actions ? `<div class="foldbox">${details}<div class="foldbox__acts">${opts.actions}</div></div>` : details;
}

/** Shared contact cell; `secondaryHtml` accepts escaped translation markup from `displayText`. */
export function contactRow(opts: { names: string[]; titleHtml: string; secondary: string; secondaryHtml?: string; action: string; data?: Data; current?: boolean; kind: "person" | "relationship" }): string {
  return `<button type="button" class="row contact-row ${opts.kind}-row"${actionAttrs(opts.action, opts.data)} data-${opts.kind === "person" ? "person" : "relationship"}-row${opts.current ? ' aria-current="true"' : ""}><span class="contact-row__avs">${opts.names.map((name) => avatar(name)).join("")}</span><span class="contact-row__body"><span class="row__title">${opts.titleHtml}</span><span class="row__sub">${opts.secondaryHtml ?? escapeHtml(opts.secondary)}</span></span><span class="row__end">${icon("chevron")}</span></button>`;
}

/** `titleHtml` / `subHtml` take caller-built HTML (translated text from `displayText`) in place of `title` / `sub`. */
export function row(opts: {
  slug?: string; slugEnd?: string; title: string; titleHtml?: string; sub?: string; subHtml?: string; end?: string; current?: boolean; action?: string; data?: Data;
}): string {
  const tag = opts.action ? "button" : "div";
  const type = opts.action ? ' type="button"' : "";
  const current = opts.current ? ' aria-current="true"' : "";
  const slug = opts.slug || opts.slugEnd
    ? `<div class="row__slug">${opts.slug ? `<b>${escapeHtml(opts.slug)}</b>` : ""}${opts.slugEnd ? `<span>${escapeHtml(opts.slugEnd)}</span>` : ""}</div>`
    : "";
  const subContent = opts.subHtml ?? (opts.sub ? escapeHtml(opts.sub) : "");
  const sub = subContent ? `<div class="row__sub">${subContent}</div>` : "";
  const end = opts.end ? `<div class="row__end">${opts.end}</div>` : "";
  return `<${tag}${type} class="row"${current}${actionAttrs(opts.action, opts.data)}>${slug}<div class="row__title">${opts.titleHtml ?? escapeHtml(opts.title)}</div>${end}${sub}</${tag}>`;
}

/** `titleHtml` and `subtitle.html` take caller-built HTML (translated text from `displayText`). */
export function frame(opts: {
  slug: string; tag?: string; date?: string; title: string; titleHtml?: string; subtitle?: { text?: string; html?: string; speaker: string };
  record?: string; expanded?: boolean; mark?: boolean; action?: string; data?: Data;
}): string {
  const interactive = Boolean(opts.action || opts.record);
  const tag = interactive ? "button" : "div";
  const type = interactive ? ' type="button"' : "";
  const expanded = opts.record ? ` aria-expanded="${Boolean(opts.expanded)}"` : "";
  const slug = `<div class="frame__slug"><b title="${escapeHtml(opts.slug)}">${escapeHtml(opts.slug)}</b>${opts.tag ? `<span class="tag">${escapeHtml(opts.tag)}</span>` : ""}${opts.date ? `<span>${escapeHtml(opts.date)}</span>` : ""}</div>`;
  const subtitle = opts.subtitle ? `<p class="subtitle"><span>${opts.subtitle.html ?? escapeHtml(opts.subtitle.text)}</span><small>${escapeHtml(opts.subtitle.speaker)}</small></p>` : "";
  const record = opts.record ? `<div class="frame__rec">${opts.record}</div>` : "";
  return `<${tag}${type} class="frame${opts.mark ? " is-mark" : ""}"${expanded}${actionAttrs(opts.action, opts.data)}>${slug}<div class="frame__title">${opts.titleHtml ?? escapeHtml(opts.title)}</div>${subtitle}${record}</${tag}>`;
}

export function notice(text: string, opts: { tone?: "cut" | "plain"; action?: string } = {}): string {
  const cut = opts.tone === "cut";
  return `<div class="notice${cut ? " notice--cut" : ""}" role="status">${icon(cut ? "alert" : "clock")}<span>${escapeHtml(text)}</span>${opts.action ?? ""}</div>`;
}

const statusIcons = { ok: "check", wait: "clock", bad: "error" } as const;

export function statusList(items: Array<{ tone: "ok" | "wait" | "bad"; text: string }>): string {
  return `<ul class="status">${items.map((item) => `<li class="${item.tone}">${icon(statusIcons[item.tone])}<span>${escapeHtml(item.text)}</span></li>`).join("")}</ul>`;
}

export function empty(title: string, body: string, action?: string): string {
  return `<div class="empty"><b>${escapeHtml(title)}</b>${escapeHtml(body)}${action ?? ""}</div>`;
}

export function loading(): string {
  return `<div class="empty is-loading" role="status">${icon("clock")}<b>불러오는 중…</b></div>`;
}

export function field(opts: { id: string; label: string; control: string; hint?: string; error?: string }): string {
  const hint = opts.hint ? `<p class="hint">${escapeHtml(opts.hint)}</p>` : "";
  const error = opts.error ? `<p class="err" role="alert">${escapeHtml(opts.error)}</p>` : "";
  return `<div class="field"><label for="${escapeHtml(opts.id)}">${escapeHtml(opts.label)}</label>${opts.control}${hint}${error}</div>`;
}
