import { compareParsedStoryTimes, formatStoryTime, parseStoryTime, RelationshipProjectionItemSchema } from "@rcm/shared";
import type { SocialKnowledgeApiItem } from "../api-client.js";
import type { DashboardData } from "../dashboard.js";
import { displayText } from "../translation.js";
import type { TranslationDisplay } from "../types.js";
import { anniversaryDayOffset, buildAnniversaries, daysSinceFirstMet, daysSinceStoryTime, earliestFirstMetStoryTime, type MilestoneStage, upcomingMilestone } from "./diary.js";
import { chartPersonColors } from "./person-colors.js";
import { buildSceneLog, type SceneCard, type SceneChip, type SceneDay } from "./scene-log.js";
import { milestoneLabel, normalizeName, type PairSummary, pairKey, relationshipLabelTranslationKey } from "./pairs.js";
import { buildCast } from "./film/cast.js";
import { isLatinName, nameHtml } from "./film/names.js";
import { sceneDate } from "./film/scene.js";
import { avatar, btn, contactRow, empty, field, filters, fold, icon, menu, seg, type MenuItem } from "./film/ui.js";
import { promiseChainKey } from "./record-history.js";
import { sceneLocator, sceneNumbers } from "./scenes.js";
import { lex } from "./lexicon.js";
import { renderRelationshipFlow, type RelationshipFlowView, type RelationshipFlowMeta } from "./relationship-flow-view.js";

export type PairDiaryFilter = "all" | "key" | "intimacy" | "heart" | "promise" | "bookmark";
export type PairDiarySort = "newest" | "oldest";

type RelationshipAxisValue = { level: string; trend: string };

export type PairDetailRenderOptions = {
  copy(canonical: string, translationKey: string): string;
  diaryFilter: PairDiaryFilter;
  diarySort: PairDiarySort;
  flowView?: RelationshipFlowView;
  anniversaryEditorEntryId?: string;
  /** The scene log shows 지정 on each scene while an anniversary is being picked from it. */
  picking?: boolean;
  editingContent?: string;
  /** 부르는 이름 rows offer their editor (needs the server's social knowledge). */
  canEditCalls?: boolean;
  axisLabels: Record<string, string>;
  levelLabels: Record<string, string>;
  trendLabels: Record<string, string>;
  axisValue(item: any, axis: string): RelationshipAxisValue;
};

const escapeHtml = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const relationshipFrom = (item: any): string => String(item?.from ?? item?.from_entity ?? "");
const relationshipTo = (item: any): string => String(item?.to ?? item?.to_entity ?? "");

const latestStoryTime = (data: DashboardData): string | null => {
  let current: string | null = null;
  for (const memory of data.memories ?? []) {
    if (memory?.active === false) continue;
    const candidate = String(memory?.story_time_normalized ?? "").trim();
    if (!candidate || parseStoryTime(candidate).calendar === "unknown") continue;
    if (current === null || (compareParsedStoryTimes(parseStoryTime(current), parseStoryTime(candidate)) ?? 0) < 0) current = candidate;
  }
  return current;
};

const SCENE_FILTERS: Array<[PairDiaryFilter, string]> = [["all", "전체"], ["key", "주요 씬"], ["intimacy", "스킨십"], ["heart", "마음의 변화"], ["promise", "약속"], ["bookmark", "북마크"]];
const MARK_ICON: Partial<Record<SceneChip["kind"], string>> = {
  landmark: "landmark", love: "heart", up: "up", down: "down", promise_made: "check", promise_kept: "check", promise_broken: "close", bookmark: "bookmark",
};
const MARK_TONE: Partial<Record<SceneChip["kind"], string>> = { landmark: " is-key", love: " is-key", promise_broken: " is-cut", down: " is-cut" };

type LabelKeys = ReadonlyMap<string, string>;

const renderMark = (chip: SceneChip, options: PairDetailRenderOptions, memoryId: string, labelKeys: LabelKeys): string => {
  const plain = chip.kind === "minor" ? (chip.trend === "down" ? "down" : "up") : MARK_ICON[chip.kind];
  // The phone reads rises and falls as arrows; film keeps its carets.
  const name = lex().skin === "phone" && plain ? ({ up: "rise", down: "fall" } as Record<string, string>)[plain] ?? plain : plain;
  const label = chip.kind === "landmark" && labelKeys.has(`${memoryId}|${chip.label}`) ? options.copy(chip.label, labelKeys.get(`${memoryId}|${chip.label}`)!) : escapeHtml(chip.label);
  return `<span class="mark${MARK_TONE[chip.kind] ?? ""}">${name ? icon(name) : ""}${label}</span>`;
};

const renderScene = (scene: SceneCard, options: PairDetailRenderOptions, labelKeys: LabelKeys): string => {
  const entryId = `scene:${scene.memoryId}`;
  const chips = scene.chips.filter((chip, index, all) => all.findIndex((other) => other.kind === chip.kind && other.label === chip.label) === index);
  const slate = [scene.slate.no > 0 ? `S#${scene.slate.no}` : "", scene.slate.time ?? "", scene.slate.place ?? ""].filter(Boolean).map(escapeHtml).join(" · ");
  const title = scene.memoryId ? options.copy(scene.title, `${scene.memoryId}:title`) : escapeHtml(scene.title);
  const opener = scene.memoryId
    ? `<button class="scene__title" type="button" data-action="open-timeline-memory" data-memory-id="${escapeHtml(scene.memoryId)}">${title}</button>`
    : `<span class="scene__title">${title}</span>`;
  const actions = scene.memoryId && options.picking ? btn("지정", { kind: "quiet", action: "designate-anniversary", data: { entryId, memoryId: scene.memoryId }, hit: true }) : "";
  const editor = scene.memoryId && entryId === options.anniversaryEditorEntryId
    ? `<form id="anniversary-form" class="form" data-memory-id="${escapeHtml(scene.memoryId)}">${field({ id: `anniversary-label-${escapeHtml(scene.memoryId)}`, label: "기념일 이름", control: `<input id="anniversary-label-${escapeHtml(scene.memoryId)}" class="input" name="label" maxlength="120" required>` })}<div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-anniversary" })}${btn("저장", { kind: "primary", action: "submit-form" })}</div></form>`
    : "";
  return `<article class="scene${scene.key ? " is-key" : ""}" data-scene="${escapeHtml(scene.memoryId)}"><div class="scene__slug"><b>${slate || "장면"}</b>${actions}</div>${opener}${chips.length ? `<div class="marks">${chips.map((chip) => renderMark(chip, options, scene.memoryId, labelKeys)).join("")}</div>` : ""}${editor}</article>`;
};

const shortDate = (storyTime: string | null): string => sceneDate(storyTime) ?? storyTime ?? "날짜 미기록";

/** Changed scenes shown before the log folds; the cut falls at the end of a day. */
const SCENE_LOG_LIMIT = 10;

type LogEntry = { day: SceneDay; scene: SceneCard; quiet: boolean };

/**
 * The scene log is the pair's chronicle of change. With no filter, scenes where nothing between the two changed
 * collapse into one "그 사이 장면" line between the scenes that did.
 */
const renderChronicle = (entries: LogEntry[], options: PairDetailRenderOptions, labelKeys: LabelKeys): string => {
  const dayLabel = (day: SceneDay) => `<b>${escapeHtml(day.date ? shortDate(day.date) : "날짜 미상")}</b>${day.weekday ? `<span>${escapeHtml(day.weekday)}</span>` : ""}`;
  let html = "";
  let lastDay: SceneDay | null = null;
  for (let index = 0; index < entries.length;) {
    const entry = entries[index]!;
    if (!entry.quiet) {
      if (entry.day !== lastDay) html += `<div class="day">${dayLabel(entry.day)}</div>`;
      lastDay = entry.day;
      html += renderScene(entry.scene, options, labelKeys);
      index += 1;
      continue;
    }
    const run: LogEntry[] = [];
    while (index < entries.length && entries[index]!.quiet) run.push(entries[index++]!);
    const rows = run.map(({ day, scene }) => {
      const slate = [scene.slate.no > 0 ? `S#${scene.slate.no}` : "", day.date ? shortDate(day.date) : ""].filter(Boolean).map(escapeHtml).join(" · ");
      const title = scene.memoryId ? options.copy(scene.title, `${scene.memoryId}:title`) : escapeHtml(scene.title);
      return `<li>${scene.memoryId ? `<button type="button" data-action="open-timeline-memory" data-memory-id="${escapeHtml(scene.memoryId)}"><span>${slate}</span>${title}</button>` : `<span><span>${slate}</span>${title}</span>`}</li>`;
    }).join("");
    html += `<details class="gap" data-preserve-open="gap:${escapeHtml(run[0]!.scene.memoryId || run[0]!.scene.title)}"><summary>그 사이 장면 ${run.length}개</summary><ul class="gap__list">${rows}</ul></details>`;
  }
  return `<div class="scenelog">${html}</div>`;
};

const renderSceneLog = (days: SceneDay[], options: PairDetailRenderOptions, labelKeys: LabelKeys, preserveKey: string): string => {
  if (!days.length) return empty("이 조건에 맞는 장면이 없습니다", "필터를 바꿔 보세요.");
  const collapseQuiet = options.diaryFilter === "all";
  const entries: LogEntry[] = days.flatMap((day) => day.scenes.map((scene) => ({ day, scene, quiet: collapseQuiet && !scene.key && scene.chips.length === 0 })));
  let shown = 0;
  let cut = entries.length;
  for (let index = 0; index < entries.length; index++) {
    if (!entries[index]!.quiet) shown += 1;
    if (shown >= SCENE_LOG_LIMIT) {
      cut = index + 1;
      while (cut < entries.length && entries[cut]!.day === entries[index]!.day) cut += 1;
      break;
    }
  }
  const rest = entries.slice(cut);
  // An anniversary being named inside the folded part keeps the fold open.
  const editing = rest.some(({ scene }) => `scene:${scene.memoryId}` === options.anniversaryEditorEntryId);
  const more = rest.length
    ? fold("더 보기", renderChronicle(rest, options, labelKeys), { role: "more", count: rest.filter((entry) => !entry.quiet).length || rest.length, open: editing, preserveKey })
    : "";
  return `${renderChronicle(entries.slice(0, cut), options, labelKeys)}${more}`;
};

const renderView = (item: any | undefined, from: string, to: string, options: PairDetailRenderOptions): string => {
  const directionKey = `${from}|${to}`;
  const items: MenuItem[] = [
    { label: "관계 수정", icon: "edit", action: "edit-relationship", data: { directionKey } },
    ...(Object.keys(item?.overrides ?? {}).length ? [{ label: "수동 수정 해제", icon: "refresh", action: "reset-relationship-auto", data: { key: directionKey } }] : []),
  ];
  // Projection pending is the server-owned placeholder, not a prose classification.
  const summary = ["Projection pending", "아직 계산 전"].includes(String(item?.summary).trim()) ? "" : String(item?.summary ?? "");
  const phone = lex().skin === "phone";
  const tensions = (item?.activeTensions ?? []).map((text: string, index: number) => `<li>${phone ? icon("cloud") : ""}${options.copy(text, `relationship:${directionKey}:tension:${index}`)}</li>`).join("");
  const face = `<div class="pov__head"><h3>${phone ? avatar(from, "sm") : ""}${nameHtml(from)}<span class="pov__to">→ ${escapeHtml(to)}</span></h3></div><div class="pov__card">${summary ? `<p class="pov__text">${options.copy(summary, `relationship:${directionKey}:summary`)}</p>` : ""}${tensions ? `<ul class="beats tensions">${tensions}</ul>` : ""}${summary || tensions ? "" : '<p class="pov__none">아직 관측되지 않음</p>'}</div>`;
  return `<div class="pov">${menu({ label: `${from}의 시선`, items, face: { html: face, className: "pov__face" } })}</div>`;
};

const canonicalAxes = Object.keys(RelationshipProjectionItemSchema.shape.axes.shape);

/** How far a level fills its meter on the phone; conflicted reads as a half bar with its own pattern. */
const LEVEL_FILL: Record<string, number> = {
  none: 0, faint: 16, low: 20, tentative: 26, fragile: 26, aversion: 30, distrust: 30, avoidant: 30,
  growing: 42, moderate: 50, developing: 55, conflicted: 55, established: 72, high: 72, strong: 86, deep: 100, extreme: 100,
};
const STRONG_LEVELS = ["strong", "deep", "high", "extreme"];

/**
 * Both directions' feelings as mirrored meters: the first direction grows left from the axis name, the second right,
 * each in its person's chart colour (the same pair of colours as 흐름).
 */
const emotionMeters = (directions: readonly Direction[], axes: string[], valueOf: (item: any, axis: string) => RelationshipAxisValue | undefined, options: PairDetailRenderOptions, label: string, footer = ""): string => {
  let unobserved = false;
  const [first, second] = chartPersonColors(directions[0]?.[0] ?? "", directions[1]?.[0] ?? "");
  const tone = (color: { h: number; s: number; l: number }) => `--pc:hsl(${color.h} ${color.s}% ${color.l}%)`;
  const side = (item: any, axis: string, end: "l" | "r") => {
    const value = item ? valueOf(item, axis) : undefined;
    const known = value && value.level !== "unknown";
    if (!known) unobserved = true;
    const level = known ? options.levelLabels[value.level] ?? value.level : "—";
    const trend = known && value.trend ? options.trendLabels[value.trend] ?? value.trend : "";
    const arrow = known && value.trend === "rising" ? `<span class="feel__trend is-up">${icon("rise")}</span>` : known && value.trend === "falling" ? `<span class="feel__trend is-down">${icon("fall")}</span>` : "";
    const fill = known ? LEVEL_FILL[value.level] ?? 50 : 0;
    const cls = known && value.level === "conflicted" ? " is-conflicted" : "";
    const word = `<span class="feel__word${known && STRONG_LEVELS.includes(value.level) ? " is-strong" : ""}"${trend ? ` title="${escapeHtml(`${level} · ${trend}`)}"` : ""}>${end === "l" ? `${arrow}${escapeHtml(level)}` : `${escapeHtml(level)}${arrow}`}</span>`;
    return `<div class="feel__side feel__side--${end}"><span class="feel__bar${cls}"><i style="width:${fill}%"></i></span>${word}</div>`;
  };
  const dir = ([from, to]: Direction) => lex().skin === "phone"
    ? `<span class="meters__dir">${avatar(from, "sm")}${icon("arrow-right")}${avatar(to, "sm")}<span class="sr-only">${escapeHtml(from)} → ${escapeHtml(to)}</span></span>`
    : `<span class="meters__dir">${escapeHtml(from)} → ${escapeHtml(to)}</span>`;
  const rows = axes.map((axis) => `<div class="feel"><span class="feel__axis">${escapeHtml(options.axisLabels[axis] ?? axis)}</span>${side(directions[0]?.[2], axis, "l")}${side(directions[1]?.[2], axis, "r")}</div>`).join("");
  return `<div class="meters" role="group" aria-label="${escapeHtml(label)}" style="${tone(first)};--pc2:hsl(${second.h} ${second.s}% ${second.l}%)"><div class="meters__head">${directions[0] ? dir(directions[0]) : ""}${directions[1] ? dir(directions[1]) : ""}</div>${rows}${unobserved ? '<p class="meters__note">— 아직 관측되지 않음</p>' : ""}${footer}</div>`;
};

type Direction = readonly [string, string, any];

const renderEmotions = (data: DashboardData, directions: readonly Direction[], options: PairDetailRenderOptions, meta: RelationshipFlowMeta, footer = ""): string => {
  const others = [...new Set(directions.flatMap(([, , item]) => Object.keys(item?.axes ?? {})))].filter((axis) => !canonicalAxes.includes(axis)).sort();
  const axes = [...canonicalAxes, ...others];
  const switcher = seg("감정 보기", [
    { value: "now", label: "지금", pressed: options.flowView?.mode !== "flow", action: "pair-emotion-view" },
    { value: "flow", label: "흐름", pressed: options.flowView?.mode === "flow", action: "pair-emotion-view" },
  ]);
  return `<section class="psec"><div class="sec-head"><h2 class="sec">감정 <span class="n">${axes.length}</span></h2>${switcher}</div>${options.flowView?.mode === "flow" ? renderRelationshipFlow(data, directions, options, meta) : emotionMeters(directions, axes, options.axisValue, options, "서로의 감정", footer)}</section>`;
};

/**
 * Which start the pair's round days count from: marriage, else becoming a couple, else the first meeting.
 * A later divorce or break-up recorded for the same pair undoes that stage.
 */
function milestoneBasis(data: DashboardData, pair: PairSummary, anniversaries: ReturnType<typeof buildAnniversaries>, firstMet: string | null): { stage: MilestoneStage; storyTime: string | null } {
  const after = (left: string, right: string) => (compareParsedStoryTimes(parseStoryTime(left), parseStoryTime(right)) ?? 0) > 0;
  const endings = (data.memories ?? []).filter((memory: any) => memory?.active !== false).flatMap((memory: any) => (memory?.landmarkKinds ?? [])
    .filter((landmark: any) => Array.isArray(landmark?.pair) && pairKey(String(landmark.pair[0]), String(landmark.pair[1])) === pair.key)
    .map((landmark: any) => ({ kind: String(landmark?.kind ?? ""), storyTime: String(landmark?.storyTime ?? memory?.story_time_normalized ?? memory?.story_time ?? "") })));
  const latest = (kind: string) => anniversaries.filter((item) => item.kind === kind && item.storyTime)
    .reduce<string | null>((found, item) => found === null || after(item.storyTime!, found) ? item.storyTime! : found, null);
  const undone = (start: string, endKind: string) => endings.some((item) => item.kind === endKind && item.storyTime && after(item.storyTime, start));
  const married = latest("marriage");
  if (married && !undone(married, "divorce")) return { stage: "married", storyTime: married };
  const dating = latest("romantic_relationship_established");
  if (dating && !undone(dating, "romantic_relationship_ended")) return { stage: "dating", storyTime: dating };
  return { stage: "met", storyTime: firstMet };
}

const creditName = (name: string): string => `<span class="nm${isLatinName(name) ? "" : " is-cjk"}">${escapeHtml(name)}</span>`;

/** The all-scenes count is shared with list cells and the detail hero. */
export const pairSceneCount = (data: DashboardData, pair: PairSummary): number =>
  buildSceneLog(data, pair, "all").reduce((sum, day) => sum + day.scenes.length, 0);

export const pairOpenPromises = (data: DashboardData, pair: PairSummary): DashboardData["promises"] =>
  (data.promises ?? []).filter((item: any) => item.status === "open" && pairKey(String(item.promisor), String(item.promisee)) === pair.key);

export function renderRelationshipRow(pair: PairSummary, scenes: number, selectedKey = "", search = "", options: { translations?: ReadonlyMap<string, string>; display?: TranslationDisplay } = {}): string {
  const translated = options.translations?.get(relationshipLabelTranslationKey(pair));
  const label = pair.label ? displayText(pair.label, translated, options.display ?? "en") : "";
  return contactRow({ names: [pair.a, pair.b], titleHtml: `${nameHtml(pair.a)} &amp; ${nameHtml(pair.b)}`,
    secondary: "", secondaryHtml: [label, `${scenes}장면`].filter(Boolean).join(" · "), action: "open-relationship",
    data: { key: pair.key, search: [search || [pair.a, pair.b, pair.label].filter(Boolean).join(" "), translated].filter(Boolean).join(" ") }, current: pair.key === selectedKey, kind: "relationship" });
}

export function renderPairDetail(data: DashboardData, pair: PairSummary, options: PairDetailRenderOptions): string {
  const anniversaries = buildAnniversaries(data, pair, data.viewPreferences?.hiddenAnniversaries ?? []);
  const firstMet = earliestFirstMetStoryTime(anniversaries);
  const days = daysSinceFirstMet(anniversaries, latestStoryTime(data));
  const persona = normalizeName(data.personaEntity);
  const [lead, other] = persona && normalizeName(pair.b) === persona ? [pair.b, pair.a] : [pair.a, pair.b];
  const directions = [
    [lead, other, (data.relationships ?? []).find((item: any) => relationshipFrom(item) === lead && relationshipTo(item) === other)],
    [other, lead, (data.relationships ?? []).find((item: any) => relationshipFrom(item) === other && relationshipTo(item) === lead)],
  ] as const;
  const allScenes = pairSceneCount(data, pair);
  const role = [pair.label ? options.copy(pair.label, relationshipLabelTranslationKey(pair)) : "", `${allScenes}장면 함께함`].filter(Boolean).join(" · ");
  const socialKnowledge = (data.socialKnowledge ?? []) as SocialKnowledgeApiItem[];
  const isPersonaPair = Boolean(persona) && normalizeName(lead) === persona;
  const leads = isPersonaPair && Array.isArray(data.entities) ? buildCast(data, data.personaEntity).leads : [];
  const picker = leads.length > 1
    ? `<div class="pairs" role="group" aria-label="주연 고르기">${leads.map((member) => {
      const key = pairKey(lead, member.name);
      return `<button type="button" class="pair" data-action="open-relationship" data-key="${escapeHtml(key)}" aria-pressed="${key === pair.key}">${nameHtml(lead)}<span class="x">×</span>${nameHtml(member.name)}</button>`;
    }).join("")}</div>` : "";
  const titles = lex().credits ? `<section class="titles" aria-label="${escapeHtml(lead)}와 ${escapeHtml(other)}"><div class="starring credit">${lex().starring}</div><button type="button" class="titles__name" data-action="open-relationship-person" data-person-name="${escapeHtml(lead)}">${creditName(lead)}</button>${isPersonaPair ? '<div class="as">페르소나</div>' : ""}<div class="and credit">${lex().and}</div><button type="button" class="titles__name" data-action="open-relationship-person" data-person-name="${escapeHtml(other)}">${creditName(other)}</button><div class="tie">${role}</div></section>` : `<section class="titles titles--plain"><div class="pair-avs">${avatar(lead, "xl")}${avatar(other, "xl")}</div><h2 class="pair-name">${[lead, other].map((name) => `<button type="button" class="pair-name__who" data-action="open-relationship-person" data-person-name="${escapeHtml(name)}">${nameHtml(name)}</button>`).join(" &amp; ")}</h2><p class="pair-tie">${role}</p></section>`;
  const basicRelations = (data.assertions ?? []).filter((item: any) => item?.socialRelation?.kind === "interpersonal"
    && pairKey(String(item?.subject), String(item?.socialRelation?.target)) === pair.key);
  const pageMenu = menu({ label: "관계에 추가", title: "추가", trigger: { icon: "add", className: "pair-add" }, items: [
    { label: "기본 관계", icon: "add", action: "new-world", data: { kind: "assertion", social: "true", relationKind: "interpersonal", personName: lead, relationTarget: other } },
    { label: "스킨십 기록", icon: "heart", action: "new-intimacy", data: { a: pair.a, b: pair.b } },
    { label: "기념일", icon: "landmark", action: "new-anniversary", data: { key: pair.key } },
  ] });
  const bar = `<div class="reader__bar"><button type="button" class="back hit" data-action="back-relationship-list">${icon("back")}<span>관계</span></button><div class="reader__acts">${pageMenu}</div></div>`;
  if (options.editingContent) return `<article class="reader pairsheet">${bar}${titles}<div class="pairsheet__edit">${options.editingContent}</div></article>`;

  const sceneDays = buildSceneLog(data, pair, options.diaryFilter, options.diarySort);
  const sceneCount = sceneDays.reduce((sum, day) => sum + day.scenes.length, 0);
  const numbers = sceneNumbers(data.memories ?? []);
  const memoryById = new Map((data.memories ?? []).map((memory: any) => [String(memory?.id ?? ""), memory]));
  const anniversaryActions = (item: (typeof anniversaries)[number]): string => menu({ label: `${item.label} 더보기`, items: [
    { label: `항상 전달 · ${item.alwaysInject ? "켜짐" : "꺼짐"}`, icon: "pin", action: "toggle-anniversary-always", data: { memoryId: item.memoryId, landmarkIndex: String(item.index), value: String(!item.alwaysInject) } },
    item.userDefined
      ? { label: "기념일 삭제", icon: "delete", action: "delete-anniversary", data: { memoryId: item.memoryId, landmarkIndex: String(item.index) }, danger: true }
      : { label: "숨기기", icon: "inactive", action: "hide-anniversary", data: { hideKey: item.hideKey } },
    ] });
  // A date the story never showed becomes a short 설정상 과거 scene of the two, so it lives on the timeline and can be recalled.
  const creatingFirstMet = options.anniversaryEditorEntryId === `new:first-met:${pair.key}`;
  const creatingMark = creatingFirstMet || options.anniversaryEditorEntryId === `new:${pair.key}`;
  const newMark = creatingMark ? `<form id="anniversary-new-form" class="form anniversary-new" data-a="${escapeHtml(lead)}" data-b="${escapeHtml(other)}"><h3 class="subhead">기념일 추가</h3><div class="form__row">${field({ id: "anniversary-new-label", label: "기념일 이름", control: `<input id="anniversary-new-label" class="input" name="label" required maxlength="120" placeholder="예: 처음 만난 날"${creatingFirstMet ? ' value="처음 만난 날"' : ""}>` })}${field({ id: "anniversary-new-date", label: "작중 날짜", control: '<input id="anniversary-new-date" class="input" name="storyTime" required maxlength="240" placeholder="YYYY-MM-DD">' })}</div><label class="check"><input id="anniversary-new-first-met" name="firstMet" type="checkbox"${creatingFirstMet ? " checked" : ""}><span>첫 만남으로 쓰기<small>설정상 기억보다 앞선 첫 만남도 넣을 수 있어요.</small></span></label>${field({ id: "anniversary-new-note", label: "메모 (선택)", control: '<textarea id="anniversary-new-note" class="textarea" name="note" rows="2" maxlength="2000"></textarea>', hint: "타임라인에 설정상 과거 장면으로 함께 남습니다." })}<div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-anniversary" })}${btn("추가", { kind: "primary", icon: "add", action: "submit-form", data: { formId: "anniversary-new-form" } })}</div></form>` : "";
  const addMark = creatingMark ? "" : menu({ label: "기념일 추가", items: [
    { label: "날짜로 만들기", icon: "clock", action: "new-anniversary", data: { key: pair.key } },
    { label: "장면에서 고르기", icon: "film", action: "anniversary-pick", data: { key: pair.key } },
  ], face: { html: `${icon("add")}추가`, className: "btn btn--quiet hit" } });
  const intimacyItems = (data.physicalIntimacy ?? []).filter((item: any) => pairKey(String(item?.participantA), String(item?.participantB)) === pair.key);
  const labelKeys: LabelKeys = new Map((data.memories ?? []).flatMap((memory: any) => (memory?.landmarkKinds ?? []).flatMap((landmark: any, index: number) => landmark?.kind === "anniversary_basis" && String(landmark?.label ?? "").trim()
    ? [[`${memory.id}|${String(landmark.label)}`, `landmark:${memory.id}#${index}:label`] as [string, string]] : [])));
  const sortControl = `<label class="sortpick"><span class="sr-only">씬 로그 정렬</span><select class="select" data-action="pair-diary-sort"><option value="newest" ${options.diarySort === "newest" ? "selected" : ""}>최신순</option><option value="oldest" ${options.diarySort === "oldest" ? "selected" : ""}>오래된순</option></select></label>`;
  const filterBar = filters(SCENE_FILTERS.map(([value, label]) => ({ label, pressed: options.diaryFilter === value, action: "pair-diary-filter", data: { value } })), "씬 로그 필터");
  // 처음 설정된 관계: the setup's feelings in the same table as 감정, then each direction's own words.
  const initialItems = (data.initialCalibration?.relationships ?? []).filter((item: any) => pairKey(String(item?.from), String(item?.to)) === pair.key);
  const initialDirections: Direction[] = directions.map(([from, to]) => [from, to, initialItems.find((item: any) => String(item?.from) === from && String(item?.to) === to)] as const);
  const initialAxis = (item: any, axis: string): RelationshipAxisValue | undefined => typeof item?.axes?.[axis] === "string" ? { level: item.axes[axis], trend: "" } : undefined;
  const initialFelt = initialItems.some((item: any) => canonicalAxes.some((axis) => (initialAxis(item, axis)?.level ?? "unknown") !== "unknown"));
  const basisIds = new Set(directions.flatMap(([, , item]) => item?.basisEventIds ?? []));
  const basisItems = (data.relationshipEvents ?? []).filter((item: any) => basisIds.has(item.id));
  const picking = options.anniversaryEditorEntryId === `pick:${pair.key}`;
  const pickBar = picking ? `<div class="pickbar" role="status"><span>기념일로 만들 장면을 고르세요</span>${btn("취소", { kind: "quiet", action: "cancel-anniversary", hit: true })}</div>` : "";
  const log = `<section class="psec" data-pair-section="diary"><h2 class="sec">기록 <span class="n">${sceneCount}</span></h2>${pickBar}<div class="logbar">${filterBar}${sortControl}</div>${renderSceneLog(sceneDays, { ...options, picking }, labelKeys, `scenelog:${pair.key}:${options.diaryFilter}:${options.diarySort}`)}</section>`;
  const promises = pairOpenPromises(data, pair);
  const sceneAt = sceneLocator(data.memories ?? [], (time) => formatStoryTime(time, true));
  function relationMenuItems(item: any): Array<MenuItem | "sep"> {
    const data = { kind: "assertion", id: String(item.id), social: "true" };
    return [
      { label: "수정", icon: "edit", action: "edit-world", data },
      { label: "종료", icon: "inactive", action: "end-world", data },
      "sep",
      { label: "삭제", icon: "delete", action: "delete-world", data, danger: true },
    ];
  }
  return renderAppPairSheet(lex().skin !== "phone");

  /**
   * The sheet reads like a couple app: who they are to each other, a few numbers, then each part as its own card.
   * Film keeps its title credits, shows the numbers as a poster billing block and the names as screenplay cues.
   */
  function renderAppPairSheet(film: boolean): string {
    const [firstTone, secondTone] = chartPersonColors(lead, other);
    const tones = `--pc:hsl(${firstTone.h} ${firstTone.s}% ${firstTone.l}%);--pc2:hsl(${secondTone.h} ${secondTone.s}% ${secondTone.l}%)`;
    const relationPills = basicRelations.map((item: any) => {
      const label = String(item?.socialRelation?.label ?? "기본 관계");
      // The pair's own label shares the list row's translation, so the hero and the row read the same.
      const text = pair.label && normalizeName(label) === normalizeName(pair.label) ? options.copy(label, relationshipLabelTranslationKey(pair)) : options.copy(label, `relation-label:${item.id}`);
      // A one-way relation (스승, 보호자…) also names its direction; a mutual one reads by its name alone.
      const way = item?.socialRelation?.direction === "mutual" ? "" : `<small class="pair-rel__way">${escapeHtml(String(item?.subject ?? ""))} → ${escapeHtml(String(item?.socialRelation?.target ?? ""))}</small>`;
      return menu({ label, items: relationMenuItems(item), face: { className: "pair-rel", html: `<span>${text}</span>${way}` } });
    }).join("");
    const names = [lead, other].map((name) => `<button type="button" class="pair-name__who" data-action="open-relationship-person" data-person-name="${escapeHtml(name)}">${nameHtml(name)}</button>`).join('<span class="pair-name__amp">&amp;</span>');
    const hero = film
      ? titles.replace(/<div class="tie">[\s\S]*?<\/div>/, relationPills ? `<div class="tie pair-rels">${relationPills}</div>` : "")
      : `<section class="titles titles--plain pair-hero"><div class="pair-avs">${avatar(lead, "xl")}${avatar(other, "xl")}</div><h2 class="pair-name">${names}</h2>${relationPills ? `<div class="pair-rels">${relationPills}</div>` : ""}</section>`;

    const tile = (tone: string, iconName: string, label: string, value: string) => `<div class="pair-tile pair-tile--${tone}"><span class="pair-tile__k">${icon(iconName)}${label}</span><span class="pair-tile__v">${value}</span></div>`;
    const metTile = firstMet
      ? tile("met", "calendar", "첫 만남", escapeHtml(shortDate(firstMet)))
      : `<button type="button" class="pair-tile pair-tile--met pair-tile--add" data-action="new-first-met" data-key="${escapeHtml(pair.key)}"><span class="pair-tile__k">${icon("calendar")}첫 만남</span><span class="pair-tile__add">${icon("add")}추가</span></button>`;
    const bill = (label: string, value: string) => `<div class="bill"><b>${value}</b><span>${label}</span></div>`;
    const tiles = film
      ? `<div class="billing">${bill("함께한 시간", days === null ? "—" : `${days}<small>일</small>`)}${firstMet ? bill("첫 만남", escapeHtml(shortDate(firstMet))) : `<button type="button" class="bill bill--add" data-action="new-first-met" data-key="${escapeHtml(pair.key)}"><b>${icon("add")}</b><span>첫 만남 추가</span></button>`}${bill("함께한 장면", String(allScenes))}</div>`
      : `<div class="pair-tiles">${tile("days", "heart", "함께한 시간", days === null ? "—" : `${days}<small>일</small>`)}${metTile}${tile("scenes", "film", "함께한 장면", String(allScenes))}</div>`;

    const say = (holder: string, subject: string, end: "l" | "r", mine = false) => {
      const item = socialKnowledge.find((candidate) => normalizeName(candidate.holder) === normalizeName(holder) && normalizeName(candidate.subject) === normalizeName(subject));
      const met = socialKnowledge.some((candidate) => pairKey(candidate.holder, candidate.subject) === pair.key && candidate.level === "interacted");
      const known = item?.knownAs ?? [], terms = item?.addressTerms ?? [];
      if (!met && !known.length && !terms.length && !options.canEditCalls) return "";
      const others = known.filter((name) => !terms.some((term) => normalizeName(term) === normalizeName(name)));
      const words = [...terms.map((term) => `<b>${escapeHtml(term)}</b>`), ...others.map(escapeHtml)].join(" · ");
      const line = `<span class="say__bub notranslate${words ? "" : " is-empty"}" translate="no">${words || "아직 부르는 이름이 없어요"}</span>`;
      const inner = film
        ? `<span class="say__cue">${nameHtml(holder)}</span><span class="say__paren">(${escapeHtml(subject)}에게)</span>${line}`
        : `${mine ? "" : avatar(holder, "sm")}${line}`;
      return options.canEditCalls
        ? `<button type="button" class="say say--${end}${mine ? " is-mine" : ""}" data-action="edit-address" data-holder="${escapeHtml(holder)}" data-subject="${escapeHtml(subject)}" aria-label="${escapeHtml(holder)} → ${escapeHtml(subject)} 이름·호칭 ${known.length || terms.length ? "수정" : "추가"}">${inner}</button>`
        : `<div class="say say--${end}${mine ? " is-mine" : ""}">${inner}</div>`;
    };
    const says = isPersonaPair ? `${say(other, lead, "l")}${say(lead, other, "r", true)}` : `${say(lead, other, "l")}${say(other, lead, "r")}`;
    const callCard = says ? `<section class="psec pair-calls"><h2 class="sec">서로를 부르는 말</h2><div class="says" style="${tones}">${says}</div></section>` : "";

    const basisFooter = basisItems.length ? `<details class="meters__basis" data-preserve-open="pair-basis:${escapeHtml(pair.key)}"><summary>이 감정의 판단 근거 ${basisItems.length}</summary><ul>${basisItems.map((item: any) => `<li>${options.copy(String(item?.reason ?? ""), `relationship-event:${item.id}:reason`)}</li>`).join("")}</ul></details>` : "";
    const hearts = `<section class="psec"><h2 class="sec">서로의 마음</h2><div class="povs">${directions.map(([from, to, item]) => renderView(item, from, to, options)).join("")}</div></section>`;

    const promiseRow = (item: any) => {
      const scene = sceneAt(item.source_memory_id ?? item.sourceMemoryId ?? item.lastMention?.ordinal);
      const meta = [item.scheduled_for ? `<span class="pair-pill">예정</span>${escapeHtml(formatStoryTime(item.scheduled_for))}` : "", scene ? escapeHtml(scene.label) : ""].filter(Boolean).join('<span class="dot">·</span>');
      return `<li class="entry"><button type="button" class="entry__face entry__tap pair-row" data-action="open-now-record" data-key="${escapeHtml(promiseChainKey(item))}"><span class="pair-row__ic is-blue">${icon("check")}</span><span class="pair-row__tx"><span class="pair-row__t">${options.copy(String(item.content ?? ""), `promise:${item.id ?? item.promise_key ?? ""}`)}</span><span class="pair-row__s"><span class="pair-row__who">${avatar(String(item.promisor ?? ""), "sm")}${icon("arrow-right")}${avatar(String(item.promisee ?? ""), "sm")}<span class="pair-row__names">${escapeHtml(String(item.promisor ?? ""))} → ${escapeHtml(String(item.promisee ?? ""))}</span></span>${meta}</span></span>${icon("chevron")}</button></li>`;
    };
    const promiseList = promises.map(promiseRow);
    const listCard = (rows: string[], key: string) => `<div class="pair-card"><ul class="entries pair-list">${rows.slice(0, 3).join("")}</ul>${rows.length > 3 ? fold("더 보기", `<ul class="entries pair-list">${rows.slice(3).join("")}</ul>`, { role: "more", count: rows.length - 3, preserveKey: key }) : ""}</div>`;
    const promiseCard = promises.length ? `<section class="psec"><h2 class="sec">약속 <span class="n">${promises.length}</span></h2>${listCard(promiseList, `pair-promises:${pair.key}`)}</section>` : "";

    const basis = milestoneBasis(data, pair, anniversaries, firstMet);
    const next = upcomingMilestone(basis.storyTime, basis.stage === "met" ? days : daysSinceStoryTime(basis.storyTime, latestStoryTime(data)), basis.stage);
    const nextCard = next ? `<div class="pair-next"><span class="pair-cal">${next.month !== undefined ? `<span class="pair-cal__m">${next.month}월</span><span class="pair-cal__d">${next.day}</span>` : `<span class="pair-cal__icon">${icon("heart")}</span>`}</span><span class="pair-next__tx"><span class="pair-next__k">다가오는 기념일</span>${next.month !== undefined ? `<span class="pair-next__date">${next.month}월 ${next.day}일</span>` : ""}<span class="pair-next__t">${escapeHtml(next.label)}</span></span><span class="pair-next__dd">D-${next.remaining}</span></div>` : "";
    const anniversaryRows = anniversaries.map((item) => {
      const memory: any = memoryById.get(item.memoryId);
      const offset = anniversaryDayOffset(item, firstMet);
      const label = item.userDefined ? options.copy(item.label, `landmark:${item.hideKey}:label`) : escapeHtml(item.label);
      const scene = [`S#${numbers.get(item.memoryId) ?? "?"}`, item.place ?? ""].filter(Boolean).map(escapeHtml).join(" · ");
      return `<article class="anni anni--row"><button type="button" class="anni__open" data-action="open-timeline-memory" data-memory-id="${escapeHtml(item.memoryId)}"><span class="anni__date">${escapeHtml(shortDate(item.storyTime))}${offset === null ? "" : `<small>D+${offset}</small>`}</span><span class="anni__tx"><span class="anni__label">${label}${item.alwaysInject ? `<span class="anni__pin" title="항상 전달">${icon("pin")}</span>` : ""}</span><span class="anni__slug">${scene}${memory ? ` · ${options.copy(String(memory.title ?? ""), `${item.memoryId}:title`)}` : ""}</span></span></button><div class="anni__acts">${anniversaryActions(item)}</div></article>`;
    }).join("");
    const markCard = `<section class="psec"><div class="sec-head"><h2 class="sec">기념일 <span class="n">${anniversaries.length}</span></h2>${addMark}</div>${newMark}${nextCard}${anniversaryRows ? `<div class="reel">${anniversaryRows}</div>` : creatingMark ? "" : empty("아직 기념일이 없습니다", "추가에서 날짜로 만들거나 기록의 장면에서 고를 수 있습니다.")}</section>`;

    const keepsake = (item: any) => {
      const scene = sceneAt(item.source_memory_id ?? item.sourceMemoryId);
      const circumstance = String(item?.circumstance ?? "").trim();
      return `<li class="entry">${menu({ label: `${milestoneLabel(item)} 스킨십 기록`, items: [
        { label: "수정", icon: "edit", action: "edit-intimacy", data: { id: String(item.id) } },
        { label: "삭제", icon: "delete", action: "delete-intimacy", data: { id: String(item.id) }, danger: true },
      ], face: { className: "entry__face pair-row", html: `<span class="pair-row__tx"><span class="pair-row__t"><b>${escapeHtml(milestoneLabel(item))}</b></span>${circumstance ? `<span class="pair-row__clamp">${options.copy(circumstance, `intimacy:${item.id}:circumstance`)}</span>` : ""}${scene ? `<span class="pair-row__s">${escapeHtml(scene.label)}</span>` : ""}</span>` } })}</li>`;
    };
    const keepsakes = intimacyItems.map(keepsake);
    const intimacyCard = keepsakes.length ? `<section class="psec"><h2 class="sec">스킨십 기록 <span class="n">${keepsakes.length}</span></h2>${listCard(keepsakes, `intimacy:${pair.key}`)}</section>` : "";

    const initialViews = initialDirections.filter(([, , item]) => item).map(([from, to, item]) => `<div class="pov"><div class="pov__head"><h3>${avatar(from, "sm")}${nameHtml(from)}<span class="pov__to">→ ${escapeHtml(to)}</span></h3></div><p class="pov__text">${options.copy(String(item?.summary ?? "요약 없음"), `initial-relationship:${item?.id ?? `${from}|${to}`}:summary`)}</p></div>`).join("");
    const initialCard = initialItems.length ? `<section class="psec">${film ? "" : '<h2 class="sec">처음 설정된 관계</h2>'}${fold(film ? "처음 설정된 관계" : "캐릭터 카드에서 읽은 처음 모습", `${initialFelt ? emotionMeters(initialDirections, canonicalAxes, initialAxis, options, "처음 설정된 감정") : ""}<div class="povs povs--initial">${initialViews}</div>`, { role: "section", preserveKey: `pair-initial:${pair.key}` })}</section>` : "";

    const chronicle = log.replace('<h2 class="sec">기록 ', '<h2 class="sec">함께한 장면 ');
    return `<article class="reader pairsheet pairsheet--app">${bar}${picker}${hero}${tiles}${callCard}${renderEmotions(data, directions, options, { anniversaries, days, scenes: allScenes }, basisFooter)}${hearts}${promiseCard}${markCard}${chronicle}${intimacyCard}${initialCard}</article>`;
  }
}
