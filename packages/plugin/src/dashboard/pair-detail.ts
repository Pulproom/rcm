import { compareParsedStoryTimes, formatStoryTime, parseStoryTime, RelationshipProjectionItemSchema } from "@rcm/shared";
import type { SocialKnowledgeApiItem } from "../api-client.js";
import type { DashboardData } from "../dashboard.js";
import { displayText } from "../translation.js";
import type { TranslationDisplay } from "../types.js";
import { anniversaryDayOffset, buildAnniversaries, daysSinceFirstMet } from "./diary.js";
import { buildSceneLog, type SceneCard, type SceneChip, type SceneDay } from "./scene-log.js";
import { milestoneLabel, normalizeName, type PairSummary, pairKey, relationshipLabelTranslationKey } from "./pairs.js";
import { buildCast } from "./film/cast.js";
import { isLatinName, nameHtml } from "./film/names.js";
import { sceneDate } from "./film/scene.js";
import { avatar, btn, contactRow, empty, field, filters, fold, icon, menu, type MenuItem } from "./film/ui.js";
import { promiseChainKey } from "./record-history.js";
import { sceneLocator, sceneNumbers } from "./scenes.js";
import { lex } from "./lexicon.js";

export type PairDiaryFilter = "all" | "key" | "intimacy" | "heart" | "promise" | "bookmark";
export type PairDiarySort = "newest" | "oldest";

type RelationshipAxisValue = { level: string; trend: string };

export type PairDetailRenderOptions = {
  copy(canonical: string, translationKey: string): string;
  diaryFilter: PairDiaryFilter;
  diarySort: PairDiarySort;
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
  const name = chip.kind === "minor" ? (chip.trend === "down" ? "down" : "up") : MARK_ICON[chip.kind];
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
  const tensions = (item?.activeTensions ?? []).map((text: string, index: number) => `<li>${options.copy(text, `relationship:${directionKey}:tension:${index}`)}</li>`).join("");
  const face = `<div class="pov__head"><h3>${nameHtml(from)}<span class="pov__to">→ ${escapeHtml(to)}</span></h3></div><div class="pov__card">${summary ? `<p class="pov__text">${options.copy(summary, `relationship:${directionKey}:summary`)}</p>` : ""}${tensions ? `<ul class="beats tensions">${tensions}</ul>` : ""}${summary || tensions ? "" : '<p class="pov__none">아직 관측되지 않음</p>'}</div>`;
  return `<div class="pov">${menu({ label: `${from}의 시선`, items, face: { html: face, className: "pov__face" } })}</div>`;
};

const canonicalAxes = Object.keys(RelationshipProjectionItemSchema.shape.axes.shape);
type Direction = readonly [string, string, any];

/** One table for both directions' feelings; the current projection and the setup baseline read the same way. */
const emotionTable = (directions: readonly Direction[], axes: string[], valueOf: (item: any, axis: string) => RelationshipAxisValue | undefined, options: PairDetailRenderOptions, label: string): string => {
  let unobserved = false;
  const rows = axes.map((axis) => `<tr><th scope="row">${escapeHtml(options.axisLabels[axis] ?? axis)}</th>${directions.map(([, , item]) => {
    const value = item ? valueOf(item, axis) : undefined;
    if (!value || value.level === "unknown") {
      unobserved = true;
      return '<td class="emotion-table__empty">—</td>';
    }
    const strong = ["strong", "deep", "high", "extreme"].includes(value.level);
    const level = options.levelLabels[value.level] ?? value.level;
    const trend = value.trend ? options.trendLabels[value.trend] ?? value.trend : "";
    return `<td${strong ? ' class="emotion-table__strong"' : ""}${trend ? ` title="${escapeHtml(`${level} · ${trend}`)}"` : ""}>${escapeHtml(level)}</td>`;
  }).join("")}</tr>`).join("");
  return `<table class="emotion-table" aria-label="${escapeHtml(label)}"><thead><tr><th scope="col"><span class="sr-only">감정</span></th>${directions.map(([from, to]) => `<th scope="col">${escapeHtml(from)} → ${escapeHtml(to)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>${unobserved ? '<p class="emotion-note">— 아직 관측되지 않음</p>' : ""}`;
};

const renderEmotions = (directions: readonly Direction[], options: PairDetailRenderOptions): string => {
  const others = [...new Set(directions.flatMap(([, , item]) => Object.keys(item?.axes ?? {})))].filter((axis) => !canonicalAxes.includes(axis)).sort();
  const axes = [...canonicalAxes, ...others];
  return `<section class="psec"><h2 class="sec">감정 <span class="n">${axes.length}</span></h2>${emotionTable(directions, axes, options.axisValue, options, "서로의 감정")}</section>`;
};

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
  const firstMet = anniversaries.find((item) => item.kind === "first_met")?.storyTime ?? null;
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
  const calls = (holder: string, subject: string) => {
    const item = socialKnowledge.find((candidate) => normalizeName(candidate.holder) === normalizeName(holder) && normalizeName(candidate.subject) === normalizeName(subject));
    const met = socialKnowledge.some(candidate => pairKey(candidate.holder, candidate.subject) === pair.key && candidate.level === "interacted");
    const known = item?.knownAs ?? [], terms = item?.addressTerms ?? [];
    if (!met && !known.length && !terms.length && !options.canEditCalls) return "";
    const names = (label: string, values: string[]) => `<span class="entry__who">${label}</span><span class="entry__body notranslate${values.length ? "" : " is-empty"}" translate="no">${values.length ? values.map(escapeHtml).join(" · ") : "아직 없음"}</span>`;
    const inner = `<span class="entry__who">${escapeHtml(holder)} → ${escapeHtml(subject)}</span>${names("알고 있는 이름", known)}${names("부르는 이름", terms)}`;
    return `<li class="entry entry--promise entry--calls">${options.canEditCalls
      ? `<button type="button" class="entry__face entry__tap" data-action="edit-address" data-holder="${escapeHtml(holder)}" data-subject="${escapeHtml(subject)}" aria-label="${escapeHtml(holder)} → ${escapeHtml(subject)} 이름·호칭 ${known.length || terms.length ? "수정" : "추가"}">${inner}${icon("chevron")}</button>`
      : inner}</li>`;
  };
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
  const facts = `<dl class="facts">${days === null ? "" : `<div><dd>${days}일</dd><dt>함께한 시간</dt></div>`}${firstMet ? `<div><dd>${escapeHtml(shortDate(firstMet))}</dd><dt>첫 만남</dt></div>` : ""}</dl>`;
  const views = `<section class="psec"><h2 class="sec">지금 <span class="n">${directions.filter(([, , item]) => item).length}</span></h2><div class="povs">${directions.map(([from, to, item]) => renderView(item, from, to, options)).join("")}</div>${facts}</section>`;
  const numbers = sceneNumbers(data.memories ?? []);
  const memoryById = new Map((data.memories ?? []).map((memory: any) => [String(memory?.id ?? ""), memory]));
  const anniversaryCards = anniversaries.map((item) => {
    const memory: any = memoryById.get(item.memoryId);
    const offset = anniversaryDayOffset(item, firstMet);
    const label = item.userDefined ? options.copy(item.label, `landmark:${item.hideKey}:label`) : escapeHtml(item.label);
    const lines: any[] = Array.isArray(memory?.keyDialogues) ? memory.keyDialogues : [];
    const lineIndex = lines.findIndex((line) => String(line?.text ?? "").trim());
    const line = lineIndex < 0 ? "" : `<span class="subtitle"><span>${options.copy(String(lines[lineIndex].text), `${item.memoryId}:dialogue:${lineIndex}`)}</span><small>${escapeHtml(String(lines[lineIndex].speaker ?? ""))}</small></span>`;
    const scene = [`S#${numbers.get(item.memoryId) ?? "?"}`, item.place ?? ""].filter(Boolean).map(escapeHtml).join(" · ");
    const actions = menu({ label: `${item.label} 더보기`, items: [
      { label: `항상 전달 · ${item.alwaysInject ? "켜짐" : "꺼짐"}`, icon: "pin", action: "toggle-anniversary-always", data: { memoryId: item.memoryId, landmarkIndex: String(item.index), value: String(!item.alwaysInject) } },
      item.userDefined
        ? { label: "기념일 삭제", icon: "delete", action: "delete-anniversary", data: { memoryId: item.memoryId, landmarkIndex: String(item.index) }, danger: true }
        : { label: "숨기기", icon: "inactive", action: "hide-anniversary", data: { hideKey: item.hideKey } },
    ] });
    const when = [escapeHtml(shortDate(item.storyTime)), offset === null ? "" : `D+${offset}`].filter(Boolean).join(" · ");
    return `<article class="anni"><button type="button" class="anni__open" data-action="open-timeline-memory" data-memory-id="${escapeHtml(item.memoryId)}"><span class="anni__label">${label}</span><span class="anni__when">${when}${item.alwaysInject ? `<span class="anni__pin" title="항상 전달">${icon("pin")}</span>` : ""}</span><span class="anni__scene"><span class="anni__slug">${scene}</span>${memory ? `<span class="anni__title">${options.copy(String(memory.title ?? ""), `${item.memoryId}:title`)}</span>` : ""}</span>${line}</button><div class="anni__acts">${actions}</div></article>`;
  }).join("");
  // A date the story never showed becomes a short 설정상 과거 scene of the two, so it lives on the timeline and can be recalled.
  const creatingMark = options.anniversaryEditorEntryId === `new:${pair.key}`;
  const newMark = creatingMark ? `<form id="anniversary-new-form" class="form anniversary-new" data-a="${escapeHtml(lead)}" data-b="${escapeHtml(other)}"><h3 class="subhead">기념일 추가</h3><div class="form__row">${field({ id: "anniversary-new-label", label: "기념일 이름", control: '<input id="anniversary-new-label" class="input" name="label" required maxlength="120" placeholder="예: 처음 만난 날">' })}${field({ id: "anniversary-new-date", label: "작중 날짜", control: '<input id="anniversary-new-date" class="input" name="storyTime" required maxlength="240" placeholder="YYYY-MM-DD">' })}</div>${field({ id: "anniversary-new-note", label: "메모 (선택)", control: '<textarea id="anniversary-new-note" class="textarea" name="note" rows="2" maxlength="2000"></textarea>', hint: "타임라인에 설정상 과거 장면으로 함께 남습니다." })}<div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-anniversary" })}${btn("추가", { kind: "primary", icon: "add", action: "submit-form", data: { formId: "anniversary-new-form" } })}</div></form>` : "";
  const addMark = creatingMark ? "" : menu({ label: "기념일 추가", items: [
    { label: "날짜로 만들기", icon: "clock", action: "new-anniversary", data: { key: pair.key } },
    { label: "장면에서 고르기", icon: "film", action: "anniversary-pick", data: { key: pair.key } },
  ], face: { html: `${icon("add")}추가`, className: "btn btn--quiet hit" } });
  const marks = `<section class="psec"><div class="sec-head"><h2 class="sec">기념일 <span class="n">${anniversaries.length}</span></h2>${addMark}</div>${newMark}${anniversaryCards ? `<div class="reel" data-drag-scroll data-preserve-scroll="marks:${escapeHtml(pair.key)}">${anniversaryCards}</div>` : creatingMark ? "" : empty("아직 기념일이 없습니다", "추가에서 날짜로 만들거나 기록의 장면에서 고를 수 있습니다.")}</section>`;

  const intimacyItems = (data.physicalIntimacy ?? []).filter((item: any) => pairKey(String(item?.participantA), String(item?.participantB)) === pair.key);
  // The milestone is the row's small first line, like a promise's direction; the circumstance reads full width.
  const intimacyEntry = (item: any) => `<li class="entry entry--promise">${menu({ label: `${milestoneLabel(item)} 스킨십 기록`, items: [
    { label: "수정", icon: "edit", action: "edit-intimacy", data: { id: String(item.id) } },
    { label: "삭제", icon: "delete", action: "delete-intimacy", data: { id: String(item.id) }, danger: true },
  ], face: { className: "entry__face", html: `<span class="entry__who">${escapeHtml(milestoneLabel(item))}</span><span class="entry__body">${options.copy(String(item?.circumstance ?? ""), `intimacy:${item.id}:circumstance`)}</span>` } })}</li>`;
  // Adding a record lives in the sheet's ··· menu only; this fold just reads the records.
  const intimacy = intimacyItems.length ? `<section class="psec">${fold("스킨십 기록", `<ul class="entries">${intimacyItems.map(intimacyEntry).join("")}</ul>`, { role: "section", count: intimacyItems.length, preserveKey: `intimacy:${pair.key}` })}</section>` : "";

  const labelKeys: LabelKeys = new Map((data.memories ?? []).flatMap((memory: any) => (memory?.landmarkKinds ?? []).flatMap((landmark: any, index: number) => landmark?.kind === "anniversary_basis" && String(landmark?.label ?? "").trim()
    ? [[`${memory.id}|${String(landmark.label)}`, `landmark:${memory.id}#${index}:label`] as [string, string]] : [])));
  const sortControl = `<label class="sortpick"><span class="sr-only">씬 로그 정렬</span><select class="select" data-action="pair-diary-sort"><option value="newest" ${options.diarySort === "newest" ? "selected" : ""}>최신순</option><option value="oldest" ${options.diarySort === "oldest" ? "selected" : ""}>오래된순</option></select></label>`;
  const filterBar = filters(SCENE_FILTERS.map(([value, label]) => ({ label, pressed: options.diaryFilter === value, action: "pair-diary-filter", data: { value } })), "씬 로그 필터");
  // 처음 설정된 관계: the setup's feelings in the same table as 감정, then each direction's own words.
  const initialItems = (data.initialCalibration?.relationships ?? []).filter((item: any) => pairKey(String(item?.from), String(item?.to)) === pair.key);
  const initialDirections: Direction[] = directions.map(([from, to]) => [from, to, initialItems.find((item: any) => String(item?.from) === from && String(item?.to) === to)] as const);
  const initialSummaries = initialDirections.filter(([, , item]) => item).map(([from, to, item]) => `<li class="entry entry--promise"><div class="entry__head"><span class="entry__who">${escapeHtml(from)} → ${escapeHtml(to)}</span></div><span class="entry__body">${options.copy(String(item?.summary ?? "요약 없음"), `initial-relationship:${item?.id ?? `${from}|${to}`}:summary`)}</span></li>`).join("");
  const initialAxis = (item: any, axis: string): RelationshipAxisValue | undefined => typeof item?.axes?.[axis] === "string" ? { level: item.axes[axis], trend: "" } : undefined;
  const initialFelt = initialItems.some((item: any) => canonicalAxes.some((axis) => (initialAxis(item, axis)?.level ?? "unknown") !== "unknown"));
  const initial = initialItems.length ? `<section class="psec">${fold("처음 설정된 관계", `${initialFelt ? `<h4 class="subhead">처음 감정</h4>${emotionTable(initialDirections, canonicalAxes, initialAxis, options, "처음 설정된 감정")}` : ""}<h4 class="subhead">처음 관계</h4><ul class="entries">${initialSummaries}</ul>`, { role: "section", preserveKey: `pair-initial:${pair.key}` })}</section>` : "";
  const basisIds = new Set(directions.flatMap(([, , item]) => item?.basisEventIds ?? []));
  const basisItems = (data.relationshipEvents ?? []).filter((item: any) => basisIds.has(item.id));
  const basis = basisItems.length ? `<section class="psec">${fold("판단 근거", `<ul class="entries">${basisItems.map((item: any) => `<li class="entry entry--promise"><span class="entry__body">${options.copy(String(item?.reason ?? ""), `relationship-event:${item.id}:reason`)}</span></li>`).join("")}</ul>`, { role: "section", count: basisItems.length, preserveKey: `pair-basis:${pair.key}` })}</section>` : "";
  const picking = options.anniversaryEditorEntryId === `pick:${pair.key}`;
  const pickBar = picking ? `<div class="pickbar" role="status"><span>기념일로 만들 장면을 고르세요</span>${btn("취소", { kind: "quiet", action: "cancel-anniversary", hit: true })}</div>` : "";
  const log = `<section class="psec" data-pair-section="diary"><h2 class="sec">기록 <span class="n">${sceneCount}</span></h2>${pickBar}<div class="logbar">${filterBar}${sortControl}</div>${renderSceneLog(sceneDays, { ...options, picking }, labelKeys, `scenelog:${pair.key}:${options.diaryFilter}:${options.diarySort}`)}</section>`;
  const promises = pairOpenPromises(data, pair);
  const sceneAt = sceneLocator(data.memories ?? [], (time) => formatStoryTime(time, true));
  const promiseRows = promises.map((item: any) => {
    const scene = sceneAt(item.source_memory_id ?? item.sourceMemoryId ?? item.lastMention?.ordinal);
    // The promise opens as its record in 현재, where it can be edited, kept or broken.
    const who = [`${item.promisor ?? ""} → ${item.promisee ?? ""}`, item.scheduled_for ? `예정 · ${formatStoryTime(item.scheduled_for)}` : ""].filter(Boolean).join(" · ");
    return `<li class="entry entry--promise"><button type="button" class="entry__face entry__tap" data-action="open-now-record" data-key="${escapeHtml(promiseChainKey(item))}"><span class="entry__who">${escapeHtml(who)}</span><span class="entry__body">${options.copy(String(item.content ?? ""), `promise:${item.id ?? item.promise_key ?? ""}`)}</span>${scene ? `<span class="entry__src">${escapeHtml(scene.label)}</span>` : ""}${icon("chevron")}</button></li>`;
  });
  // Several 기본 관계 can hold at once; each is one row that reads as a sentence and carries its own verbs.
  const relationRows = basicRelations.map((item: any) => {
    const relation = item.socialRelation;
    const data = { kind: "assertion", id: String(item.id), social: "true" };
    const direction = `${escapeHtml(String(item.subject ?? ""))} ${relation?.direction === "mutual" ? "↔" : "→"} ${escapeHtml(String(relation?.target ?? ""))}`;
    return `<li class="entry entry--promise entry--relation">${menu({ label: String(relation?.label ?? "기본 관계"), items: [
      { label: "수정", icon: "edit", action: "edit-world", data },
      { label: "종료", icon: "inactive", action: "end-world", data },
      "sep",
      { label: "삭제", icon: "delete", action: "delete-world", data, danger: true },
    ], face: { className: "entry__face", html: `<span class="entry__who">${direction}</span><span class="entry__body">${options.copy(String(relation?.label ?? ""), `relation-label:${item.id}`)}</span>` } })}</li>`;
  }).join("");
  const relationSection = relationRows ? `<section class="psec"><h2 class="sec">기본 관계 <span class="n">${basicRelations.length}</span></h2><ul class="entries">${relationRows}</ul></section>` : "";
  const promiseSection = promises.length ? `<section class="psec"><h2 class="sec">약속 <span class="n">${promises.length}</span></h2><ul class="entries">${promiseRows.slice(0, 3).join("")}</ul>${promiseRows.length > 3 ? fold("더 보기", `<ul class="entries">${promiseRows.slice(3).join("")}</ul>`, { role: "more", count: promiseRows.length - 3, preserveKey: `pair-promises:${pair.key}` }) : ""}</section>` : "";
  const callRows = `${calls(lead, other)}${calls(other, lead)}`;
  const callSection = callRows ? `<section class="psec pair-calls"><h2 class="sec">이름·호칭</h2><ul class="entries">${callRows}</ul></section>` : "";
  return `<article class="reader pairsheet">${bar}${picker}${titles}${relationSection}${callSection}${views}${renderEmotions(directions, options)}${promiseSection}${marks}${log}${intimacy}${initial}${basis}</article>`;
}
