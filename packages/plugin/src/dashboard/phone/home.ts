import { nameHtml } from "../film/names.js";
import { avatar, btn, escapeHtml, icon } from "../film/ui.js";

type NotificationAction = { label: string; kind: "primary" | "quiet"; action: string; data?: Record<string, string> };

/** Everything the lock-screen home shows. Fields named `…Html` are already escaped or translated markup. */
export type LockHomeInput = {
  place: string | null;
  date: string | null;
  dayLine: string;
  overdue: number;
  daysTogether: number | null;
  scenes: number;
  latest: { memoryId: string; speaker: string; lineHtml: string | null; titleHtml: string; sceneNo: number } | null;
  overduePromise: { textHtml: string; who: string; when: string; more: number } | null;
  chapter: { label: string; titleHtml: string; scenes: number } | null;
  pairs: Array<{ key: string; a: string; b: string; labelHtml: string; days: number | null }>;
  recent: Array<{ memoryId: string; sceneNo: number; titleHtml: string; when: string | null }>;
  /** Film's own sections, each in its own widget card. */
  injectionHtml: string;
  processingHtml: string;
  alerts: Array<{ tone: "cut" | "wait"; text: string; body?: string; action?: string; data?: Record<string, string>; actions?: NotificationAction[] }>;
  /** App notices (update, backfill, lineage…) rendered as they are, above the notifications. */
  noticesHtml: string;
  emptyTitle: string;
};

const attrs = (action: string, data: Record<string, string> = {}): string =>
  ` data-action="${escapeHtml(action)}"${Object.entries(data).map(([key, value]) => ` data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${escapeHtml(value)}"`).join("")}`;

const notification = (opts: { tone: string; iconName: string; head: string; meta: string; body: string; foot?: string; action?: string; data?: Record<string, string>; actions?: NotificationAction[] }): string => {
  const inner = `<span class="noti__ic noti__ic--${opts.tone}">${icon(opts.iconName)}</span><span class="noti__hd"><b>${opts.head}</b><span>${opts.meta}</span></span><span class="noti__bd">${opts.body}</span>${opts.foot ? `<span class="noti__ft">${opts.foot}</span>` : ""}`;
  if (opts.actions?.length) return `<div class="noti">${inner}<div class="noti__acts">${opts.actions.map(({ label, ...options }) => btn(label, options)).join("")}</div></div>`;
  return opts.action
    ? `<button type="button" class="noti"${attrs(opts.action, opts.data)}>${inner}</button>`
    : `<div class="noti">${inner}</div>`;
};

/**
 * The phone skin's home: a lock screen. The story's own date stands in for the clock, three quiet widgets
 * count what matters, and what happened or needs a decision arrives as notifications.
 */
export function renderLockHome(input: LockHomeInput): string {
  const widgetItems: Array<{ value: string; label: string; action: string; data: Record<string, string>; due?: boolean }> = [
    { value: String(input.overdue), label: "기한 지난 약속", action: "tab", data: { tab: "world" }, due: input.overdue > 0 },
    ...(input.daysTogether === null ? [] : [{ value: `D+${input.daysTogether}`, label: "함께한 날", action: "", data: {} }]),
    { value: String(input.scenes), label: "함께한 장면", action: "tab", data: { tab: "timeline" } },
  ];
  const widgets = widgetItems.map((item) => item.action
    ? `<button type="button" class="lw${item.due ? " lw--due" : ""}"${attrs(item.action, item.data)}><b>${escapeHtml(item.value)}</b><span>${escapeHtml(item.label)}</span></button>`
    : `<div class="lw"><b>${escapeHtml(item.value)}</b><span>${escapeHtml(item.label)}</span></div>`).join("");

  const notes = [
    ...input.alerts.map((alert) => notification({ tone: alert.tone === "cut" ? "red" : "gray", iconName: "alert", head: escapeHtml(alert.text), meta: "", body: escapeHtml(alert.body ?? ""), action: alert.action, data: alert.data, actions: alert.actions })),
    input.latest
      ? notification({
        tone: "green", iconName: "film",
        head: escapeHtml(input.latest.speaker || "새 장면"),
        meta: escapeHtml(input.latest.sceneNo > 0 ? `S#${input.latest.sceneNo}` : "새 장면"),
        body: input.latest.lineHtml ? `“${input.latest.lineHtml}”` : input.latest.titleHtml,
        foot: input.latest.lineHtml ? input.latest.titleHtml : undefined,
        action: "open-timeline-memory", data: { memoryId: input.latest.memoryId },
      })
      : notification({ tone: "gray", iconName: "film", head: escapeHtml(input.emptyTitle), meta: "", body: "대화가 몇 턴 쌓이면 첫 장면이 도착합니다." }),
    input.overduePromise
      ? notification({
        tone: "orange", iconName: "check", head: "약속", meta: escapeHtml(`${input.overduePromise.when} · 지남`),
        body: input.overduePromise.textHtml,
        foot: escapeHtml([input.overduePromise.who, input.overduePromise.more ? `외 ${input.overduePromise.more}개` : ""].filter(Boolean).join(" · ")),
        action: "tab", data: { tab: "world" },
      })
      : "",
  ].filter(Boolean).join("");

  // Below the lock screen, the widget page: everything the Film home shows, one card per subject.
  const chapter = input.chapter
    ? `<section class="wg"><h2 class="wg__h">${icon("film")}지금 진행 중</h2><button type="button" class="wg__row" data-action="tab" data-tab="story"><span class="wg__no">${escapeHtml(input.chapter.label)}</span><span class="wg__main">${input.chapter.titleHtml}</span><span class="wg__end">${input.chapter.scenes}장면${icon("chevron")}</span></button></section>`
    : "";
  const pairs = input.pairs.length
    ? `<section class="wg"><h2 class="wg__h">${icon("people")}함께하는 사이</h2><div class="wg__list">${input.pairs.map((pair) => `<button type="button" class="wg__row" data-action="open-relationship" data-key="${escapeHtml(pair.key)}"><span class="wg__avs">${avatar(pair.a, "sm")}${avatar(pair.b, "sm")}</span><span class="wg__main">${nameHtml(pair.a)} &amp; ${nameHtml(pair.b)}${pair.labelHtml ? `<small> · ${pair.labelHtml}</small>` : ""}</span><span class="wg__end">${pair.days === null ? "" : `D+${pair.days}`}${icon("chevron")}</span></button>`).join("")}</div></section>`
    : "";
  const recent = input.recent.length
    ? `<section class="wg"><h2 class="wg__h">${icon("film")}최근 장면</h2><div class="wg__list">${input.recent.map((scene) => `<button type="button" class="wg__row" data-action="open-timeline-memory" data-memory-id="${escapeHtml(scene.memoryId)}"><span class="wg__no">${scene.sceneNo > 0 ? `S#${scene.sceneNo}` : ""}</span><span class="wg__main">${scene.titleHtml}</span>${scene.when ? `<span class="wg__end">${escapeHtml(scene.when)}</span>` : ""}</button>`).join("")}</div></section>`
    : "";
  const widgetPage = `${chapter}${pairs}${recent}${input.injectionHtml ? `<section class="wg wg--sent">${input.injectionHtml}</section>` : ""}${input.processingHtml ? `<section class="wg wg--film">${input.processingHtml}</section>` : ""}`;

  return `<div class="lock"><h1 class="sr-only">홈</h1><div class="lock__wall" aria-hidden="true"></div>
    <section class="lock__time">${input.place ? `<p class="lock__place">${escapeHtml(input.place)}</p>` : ""}<p class="lock__date${/^\d{1,2}\.\d{1,2}$/.test(input.date ?? "") ? "" : " lock__date--free"}">${escapeHtml(input.date ?? "—")}</p><p class="lock__day">${escapeHtml(input.dayLine)}</p><div class="lock__widgets">${widgets}</div></section>
    <div class="lock__side"><section class="lock__notes" aria-label="알림">${input.noticesHtml}${notes}</section>
    ${widgetPage ? `<section class="lock__more" aria-label="위젯">${widgetPage}</section>` : ""}</div>
  </div>`;
}
