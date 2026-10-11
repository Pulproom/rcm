import type { DashboardData, Tab } from "../dashboard.js";
import { buildPairs } from "./pairs.js";
import { icon, iconBtn, seg } from "./film/ui.js";

export { icon };
import type { DashboardNavigationController, NavigationStack, ViewSnapshot } from "./navigation.js";

export type Crumb = { label: string; snapshot?: ViewSnapshot; stackPosition?: number };

const escapeHtml = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const tabLabels: Record<Tab, string> = {
  overview: "홈",
  initial: "인물",
  story: "기억",
  timeline: "기억",
  relationships: "인물",
  world: "현재",
  reviews: "관리",
  conflicts: "관리",
  operations: "관리",
  data: "관리",
  settings: "관리",
};

const selectedPersonName = (snapshot: ViewSnapshot, data: DashboardData): string => {
  if (!snapshot.peopleView || typeof snapshot.peopleView !== "object") return "";
  const selectedId = String((snapshot.peopleView as { selectedId?: unknown }).selectedId ?? "");
  if (!selectedId || selectedId === "__new__") return "";
  const candidates = [...(data.initialCalibration?.entities ?? []), ...(data.entities ?? [])];
  const person = candidates.find((item: any) => String(item?.id ?? "") === selectedId);
  return String(person?.name ?? person?.displayName ?? "").trim();
};

type MemoryTitle = (memory: any) => string;

const snapshotLabel = (snapshot: ViewSnapshot, data: DashboardData, memoryTitle: MemoryTitle): string => {
  if (snapshot.tab === "initial") return selectedPersonName(snapshot, data) || tabLabels.initial;
  if (snapshot.tab === "relationships" && snapshot.selectedRelationship) {
    const pair = buildPairs(data, data.personaEntity).find((item) => item.key === snapshot.selectedRelationship);
    if (pair) return `${pair.a} & ${pair.b}`;
    const names = snapshot.selectedRelationship.split("|").map((name) => name.trim()).filter(Boolean);
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
  }
  if (snapshot.tab === "timeline" && snapshot.selectedMemory) {
    const memory = data.memories.find((item: any) => String(item?.id ?? "") === snapshot.selectedMemory);
    const title = (memory ? memoryTitle(memory) || String(memory.title ?? "") : "").trim();
    if (title) return title;
  }
  return tabLabels[snapshot.tab];
};

/** `memoryTitle` names a selected scene as the screen shows it (its translation when one is displayed). */
export function buildCrumbs(state: ViewSnapshot, data: DashboardData, stack: ViewSnapshot[], memoryTitle: MemoryTitle = () => ""): Crumb[] {
  const steps = [...stack, state].reduce<Array<Required<Crumb>>>((crumbs, snapshot, stackPosition) => {
    const label = snapshotLabel(snapshot, data, memoryTitle);
    const crumb = { label, snapshot, stackPosition };
    if (crumbs.at(-1)?.label === label) crumbs[crumbs.length - 1] = crumb;
    else crumbs.push(crumb);
    return crumbs;
  }, []);
  return steps.map((crumb, index) => index === steps.length - 1 ? { label: crumb.label } : crumb);
}

const foldChevron = (): string => `<span class="chev" aria-hidden="true">${icon("chevron")}</span>`;

/** Film fold summary; the enclosing `<details>` gets `class="fold"` (added by `decorateFoldSummaries` when missing). */
export function renderFoldSummary(label: string, count?: number): string {
  const countSlot = count === undefined ? "" : `<span class="n">${count}</span>`;
  return `<summary><span>${escapeHtml(label)}</span>${countSlot}${foldChevron()}</summary>`;
}

/** Gives every plain disclosure the film fold shape. Menus, inline evidence (`.cite`), collapsed acts, in-place clamps, scene gaps and contact rows (`.acq`) keep their own shape. */
export function decorateFoldSummaries(scope: ParentNode): void {
  scope.querySelectorAll<HTMLDetailsElement>("details:not([data-menu]):not(.cite):not(.msg):not(.clamp):not(.gap):not(.acq)").forEach((details) => {
    const summary = Array.from(details.children).find((child): child is HTMLElement => child instanceof HTMLElement && child.tagName === "SUMMARY");
    if (!summary) return;
    // Inset card rows keep their own row styling; only the chevron is shared.
    if (!details.classList.contains("memory-detail-row")) details.classList.add("fold");
    if (summary.querySelector(".chev")) return;
    summary.insertAdjacentHTML("beforeend", foldChevron());
  });
}

const shellTabs: Array<{ tab: Tab; label: string; icon: string }> = [
  { tab: "overview", label: "홈", icon: "home" },
  { tab: "timeline", label: "기억", icon: "film" },
  { tab: "initial", label: "인물", icon: "people" },
  { tab: "world", label: "현재", icon: "clip" },
  { tab: "reviews", label: "관리", icon: "sliders" },
];

const activeShellTab = (tab: Tab): Tab => {
  if (tab === "story") return "timeline";
  if (tab === "relationships") return "initial";
  if (["conflicts", "operations", "data", "settings"].includes(tab)) return "reviews";
  return tab;
};

export function renderShell(opts: {
  tab: Tab;
  crumbs: Crumb[];
  translation: "ko" | "en";
  pencilCount: number;
  chatTitle?: string;
}): { nav: string; bar: string } {
  const selectedTab = activeShellTab(opts.tab);
  const brand = `<div class="brand"><span class="credit">RCM</span>${opts.chatTitle ? `<small>${escapeHtml(opts.chatTitle)}</small>` : ""}</div>`;
  const nav = `${brand}${shellTabs.map((item) => {
    const current = item.tab === selectedTab ? ' aria-current="page"' : "";
    const badge = item.tab === "world" && opts.pencilCount > 0
      ? `<span class="badge" aria-label="대조 필요 ${opts.pencilCount}개">${opts.pencilCount}</span>`
      : "";
    return `<button type="button" data-action="tab" data-tab="${item.tab}"${current}>${icon(item.icon)}<span>${item.label}</span>${badge}</button>`;
  }).join("")}`;
  const crumbs = opts.crumbs.map((crumb, index) => {
    if (!crumb.snapshot) return `<b>${escapeHtml(crumb.label)}</b>`;
    return `<button type="button" data-action="restore-crumb" data-crumb-index="${index}">${escapeHtml(crumb.label)}</button>`;
  }).flatMap((crumb, index) => index ? ['<span class="sep" aria-hidden="true">&rsaquo;</span>', crumb] : [crumb]).join("");
  const language = seg("표시 언어", [
    { value: "ko", label: "번역", pressed: opts.translation === "ko", action: "set-translation-display", data: { display: "ko" } },
    { value: "en", label: "원문", pressed: opts.translation === "en", action: "set-translation-display", data: { display: "en" } },
  ]);
  const bar = `<nav class="where" aria-label="현재 위치">${crumbs}</nav><span class="sp"></span><span class="bar__state" role="status" aria-live="polite" aria-atomic="true"></span>${language}${iconBtn("refresh", "새로고침", { action: "refresh" })}${iconBtn("close", "닫기", { action: "close" })}`;
  return { nav, bar };
}

export async function handleShellNavigationAction(
  target: { dataset: Record<string, string | undefined> },
  crumbs: Crumb[],
  navigation: Pick<DashboardNavigationController, "restore">,
  stack: Pick<NavigationStack, "truncate">,
): Promise<boolean> {
  if (target.dataset.action !== "restore-crumb") return false;
  const index = Number(target.dataset.crumbIndex);
  const crumb = Number.isInteger(index) ? crumbs[index] : undefined;
  if (!crumb?.snapshot) return false;
  const restored = await navigation.restore(crumb.snapshot);
  if (restored && crumb.stackPosition !== undefined) stack.truncate(crumb.stackPosition);
  return restored;
}
