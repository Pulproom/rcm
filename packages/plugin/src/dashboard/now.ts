import { formatStoryTime, compareParsedStoryTimes, parseStoryTime } from "@rcm/shared";
import type { DashboardData } from "../dashboard.js";
import { displayText } from "../translation.js";
import type { TranslationDisplay } from "../types.js";
import { entityProminence } from "./pairs.js";
import { sceneLocator, type SceneRef } from "./scenes.js";
import { btn, empty, fold, icon, menu, type MenuItem } from "./film/ui.js";
import { assertionChainKey, buildRecordChains, liveChainKey, renderRecordDetail, type RecordChain } from "./record-history.js";
import { nameHtml } from "./film/names.js";
import { lex } from "./lexicon.js";

export type NowFilter = "all" | "promise" | "belief" | "condition" | "goal" | "secret";
export type NowSort = "recent" | "stale";
/** 현재 lists live records; 지난 기록 lists chains that ended. Both open one record's history beside the list. */
export type NowMode = "now" | "past";
/** `listOnly`: on a wide screen the reader is closed and the list stands alone. */
export type NowView = { mode: NowMode; selected: string; mobileDetail: boolean; listOnly?: boolean };
export type NowGroup = { owner: string | null; isPersona: boolean; rank: number; rows: NowRow[] };
export type NowRow = {
  id: string;
  /** The record chain this row belongs to (see record-history). */
  key: string;
  /** Earlier versions in the chain. */
  changes: number;
  /** A past version's own translation key; live rows derive theirs from type and id. */
  textKey?: string;
  endedAt?: number | null;
  deleted?: boolean;
  type: "promise" | "belief" | "condition" | "goal" | "secret";
  text: string;
  subject?: string;
  predicate?: string;
  holder?: string;
  polarity?: string;
  promisor?: string;
  promisee?: string;
  scheduledFor?: string;
  lastMention: { ordinal: number | null; storyTime: string | null };
  overdue: boolean;
};

export async function runPromiseStatusMutation(
  inFlight: Set<string>,
  promiseId: string,
  mutation: () => Promise<unknown>,
  onBusyChange: () => void,
): Promise<boolean> {
  if (!promiseId || inFlight.has(promiseId)) return false;
  inFlight.add(promiseId);
  try {
    onBusyChange();
    await mutation();
    return true;
  } finally {
    inFlight.delete(promiseId);
    onBusyChange();
  }
}

type OwnedNowRow = NowRow & { owner: string | null; ownerRank: number };

const FILTERS: NowFilter[] = ["all", "promise", "belief", "condition", "goal", "secret"];
const normalizeName = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
const escapeHtml = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const entityName = (entity: any): string => String(entity?.name ?? entity?.displayName ?? "").trim();
const entityNames = (entity: any): string[] => [entityName(entity), ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
  .map(normalizeName).filter(Boolean);
const lastMention = (item: any): NowRow["lastMention"] => ({
  ordinal: Number.isFinite(Number(item?.lastMention?.ordinal)) && item?.lastMention?.ordinal !== null
    ? Number(item.lastMention.ordinal)
    : null,
  storyTime: String(item?.lastMention?.storyTime ?? "").trim() || null,
});

const currentStoryTime = (data: DashboardData): string | null => {
  let current: string | null = null;
  for (const memory of data.memories ?? []) {
    if (memory?.active === false) continue;
    const candidate = String(memory?.story_time_normalized ?? "").trim();
    if (!candidate) continue;
    const parsed = parseStoryTime(candidate);
    if (parsed.calendar === "unknown") continue;
    if (current === null || (compareParsedStoryTimes(parseStoryTime(current), parsed) ?? 0) < 0) current = candidate;
  }
  return current;
};

export function isPromiseOverdue(scheduledFor: string | null, storyTime: string | null): boolean {
  if (!scheduledFor || !storyTime) return false;
  const compared = compareParsedStoryTimes(parseStoryTime(scheduledFor), parseStoryTime(storyTime));
  return compared !== null && compared < 0;
}

const pendingAttentionCount = (data: DashboardData): number =>
  (data.extractionAudits ?? []).filter((item: any) => item?.status === "pending_review" || item?.status === "failed").length
  + (data.reconciliationReviews ?? []).filter((item: any) => item?.status === "pending").length
  + (data.conflicts ?? []).filter((item: any) => item?.status === "pending").length;

export function buildNowPage(
  data: DashboardData,
  personaEntity: string | null,
  filter: NowFilter,
  sort: NowSort,
  mode: NowMode = "now",
): { groups: NowGroup[]; counts: Record<NowFilter, number>; pendingAttention: number; chains: Map<string, RecordChain> } {
  const personaName = normalizeName(personaEntity);
  const owners = new Map<string, { name: string; rank: number; isPersona: boolean }>();
  for (const entity of data.entities ?? []) {
    const name = entityName(entity);
    if (!name) continue;
    const isPersona = Boolean(personaName) && entityNames(entity).includes(personaName);
    const owner = { name, rank: entityProminence(entity), isPersona };
    for (const alias of entityNames(entity)) if (!owners.has(alias) || isPersona) owners.set(alias, owner);
  }
  if (personaEntity && !owners.has(personaName)) owners.set(personaName, { name: personaEntity, rank: 0, isPersona: true });

  const ownerFor = (value: unknown): Pick<OwnedNowRow, "owner" | "ownerRank"> & { isPersona: boolean } => {
    const entity = owners.get(normalizeName(value));
    return entity
      ? { owner: entity.name, ownerRank: entity.rank, isPersona: entity.isPersona }
      : { owner: null, ownerRank: 3, isPersona: false };
  };
  const storyTime = currentStoryTime(data);
  const chains = buildRecordChains(data);
  const changes = (key: string): number => Math.max(0, (chains.get(key)?.versions.length ?? 1) - 1);
  const rows: OwnedNowRow[] = [];
  if (mode === "past") {
    for (const chain of chains.values()) {
      const top = chain.versions[0];
      if (chain.current || !top) continue;
      const item = top.item;
      const owner = ownerFor(chain.owner);
      const ended = chain.endedAt ?? top.from;
      rows.push({
        id: chain.kind === "promise" ? String(item?.promise_id ?? item?.id ?? "") : top.id, key: chain.key, changes: chain.versions.length - 1, textKey: top.textKey, endedAt: chain.endedAt, deleted: Boolean(top.deleted),
        type: chain.type, text: top.text, subject: String(item?.subject ?? ""), predicate: String(item?.predicate ?? ""),
        holder: String(item?.holder ?? ""), polarity: String(item?.polarity ?? ""), promisor: String(item?.promisor ?? ""), promisee: String(item?.promisee ?? ""),
        lastMention: { ordinal: ended, storyTime: null }, overdue: false, owner: owner.owner, ownerRank: owner.ownerRank,
      });
    }
  } else {
  for (const item of data.promises ?? []) {
    if (item?.status !== "open") continue;
    const owner = ownerFor(item?.promisor);
    rows.push({
      id: String(item?.id ?? item?.promise_key ?? ""), key: liveChainKey(chains, "promise", item), changes: changes(liveChainKey(chains, "promise", item)), type: "promise", text: String(item?.content ?? ""),
      promisor: String(item?.promisor ?? ""), promisee: String(item?.promisee ?? ""),
      scheduledFor: String(item?.scheduled_for ?? ""),
      lastMention: lastMention(item), overdue: isPromiseOverdue(String(item?.scheduled_for ?? "").trim() || null, storyTime),
      owner: owner.owner, ownerRank: owner.ownerRank,
    });
  }
  for (const item of data.beliefs ?? []) {
    const owner = ownerFor(item?.holder);
    rows.push({
      id: String(item?.id ?? ""), key: liveChainKey(chains, "belief", item), changes: changes(liveChainKey(chains, "belief", item)), type: "belief", text: String(item?.value ?? ""),
      holder: String(item?.holder ?? ""), subject: String(item?.subject ?? ""), polarity: String(item?.polarity ?? "believes"),
      lastMention: lastMention(item), overdue: false, owner: owner.owner, ownerRank: owner.ownerRank,
    });
  }
  for (const item of data.assertions ?? []) {
    if (item?.socialRelation) continue;
    const owner = ownerFor(item?.subject);
    const type = FILTERS.includes(item?.stateKind) && item.stateKind !== "all" && item.stateKind !== "promise" && item.stateKind !== "belief"
      ? item.stateKind as "condition" | "goal" | "secret"
      : "condition";
    rows.push({
      id: String(item?.id ?? ""), key: liveChainKey(chains, "assertion", item), changes: changes(liveChainKey(chains, "assertion", item)), type, text: String(item?.value ?? ""),
      subject: String(item?.subject ?? ""), predicate: String(item?.predicate ?? ""),
      lastMention: lastMention(item), overdue: false, owner: owner.owner, ownerRank: owner.ownerRank,
    });
  }
  }

  const counts = Object.fromEntries(FILTERS.map((value) => [value, value === "all" ? rows.length : rows.filter((row) => row.type === value).length])) as Record<NowFilter, number>;
  const selected = filter === "all" ? rows : rows.filter((row) => row.type === filter);
  const compareRows = (left: OwnedNowRow, right: OwnedNowRow): number => {
    const leftOrdinal = left.lastMention.ordinal;
    const rightOrdinal = right.lastMention.ordinal;
    if (leftOrdinal === null || rightOrdinal === null) {
      if (leftOrdinal !== rightOrdinal) return leftOrdinal === null ? 1 : -1;
    } else if (leftOrdinal !== rightOrdinal) return sort === "stale" ? leftOrdinal - rightOrdinal : rightOrdinal - leftOrdinal;
    return left.id.localeCompare(right.id, "ko");
  };
  const grouped = new Map<string, { owner: string | null; ownerRank: number; isPersona: boolean; rows: OwnedNowRow[] }>();
  for (const row of selected) {
    const key = row.owner === null ? "\0world" : normalizeName(row.owner);
    const group = grouped.get(key) ?? { owner: row.owner, ownerRank: row.ownerRank, isPersona: row.owner !== null && Boolean(owners.get(normalizeName(row.owner))?.isPersona), rows: [] };
    group.rows.push(row);
    grouped.set(key, group);
  }
  const groups = [...grouped.values()]
    // 주요 → 보조 → 배경 → WORLD; within a tier the persona comes first, then names.
    .sort((left, right) => left.ownerRank - right.ownerRank || Number(right.isPersona) - Number(left.isPersona) || String(left.owner ?? "").localeCompare(String(right.owner ?? ""), "ko"))
    .map((group): NowGroup => ({ owner: group.owner, isPersona: group.isPersona, rank: group.ownerRank, rows: group.rows.sort(compareRows).map(({ owner: _owner, ownerRank: _rank, ...row }) => row) }));

  return { groups, counts, pendingAttention: pendingAttentionCount(data), chains };
}

export function overduePromiseEntries(page: ReturnType<typeof buildNowPage>): Array<{ row: NowRow; owner: string | null }> {
  return page.groups.flatMap((group) => group.rows
    .filter((row) => row.type === "promise" && row.overdue)
    .map((row) => ({ row, owner: group.owner })));
}

const FILTER_ICONS: Record<NowFilter, string> = {
  all: "clip", promise: "check", belief: "eye", condition: "pencil", goal: "landmark", secret: "inactive",
};
const FILTER_LABELS: Record<NowFilter, string> = {
  all: "전체", promise: "약속", belief: "인식", condition: "상태", goal: "목표", secret: "비밀",
};
const RANK_LABELS: Record<number, string> = { 0: "주요", 1: "보조", 2: "배경" };
const TYPE_LABELS: Record<NowRow["type"], string> = {
  promise: "약속", belief: "인식", condition: "상태", goal: "목표", secret: "비밀",
};

/** The scene of the last mention, opening that memory on the timeline. */
const renderMention = (scene: SceneRef | null): string => scene
  ? `<button class="linkbtn" type="button" data-action="open-timeline-memory" data-memory-id="${escapeHtml(scene.memoryId)}">${escapeHtml(scene.label)}</button>`
  : "";

const POLARITY_LABELS: Record<string, string> = { believes: "믿음", suspects: "의심", denies: "부정", knows: "앎", heard: "전해 들음" };

/** Rows grouped under a person omit that person; ungrouped (world) rows must name their own subject. */
const rowLead = (row: NowRow, owner: string | null, translations: ReadonlyMap<string, string>, display: TranslationDisplay): string => {
  const predicate = row.predicate ? displayText(row.predicate, translations.get(`assertion-predicate:${row.id}`), display) : "";
  return row.type === "promise"
    ? `${row.promisor ? `${escapeHtml(row.promisor)} ` : ""}→ ${escapeHtml(row.promisee)}`
    : row.type === "belief"
      ? `${row.holder ? `${escapeHtml(row.holder)} → ` : ""}${escapeHtml(row.subject)}`
      : owner === null
        ? [row.subject ? escapeHtml(row.subject) : "", predicate].filter(Boolean).join(" · ")
        : predicate || escapeHtml(row.subject);
};

const rowText = (row: NowRow, translations: ReadonlyMap<string, string>, display: TranslationDisplay): string => {
  const translationKey = row.textKey ?? (row.type === "promise" ? `promise:${row.id}` : row.type === "belief" ? `belief:${row.id}` : `assertion:${row.id}`);
  return displayText(row.text || "내용 없음", translations.get(translationKey), display);
};

/**
 * One current record: its kind and who, the text, then where it was last seen. The record's verbs live in its
 * detail; only a promise keeps a way to settle it from the list (the phone's ring, Film's verbs when overdue).
 */
const renderRow = (
  row: NowRow,
  owner: string | null,
  promiseStatusBusy: boolean,
  translations: ReadonlyMap<string, string>,
  display: TranslationDisplay,
  opts: { verbsVisible: boolean; sceneAt?: (target: unknown) => SceneRef | null; selected?: boolean; past?: boolean },
): string => {
  const id = row.id;
  // A finished promise has nothing left to decide.
  const promiseVerbs = row.type === "promise" && !opts.past
    ? [
      { label: "지켜짐", icon: "check", action: "edit-world", data: { kind: "promise", id, status: "kept" }, disabled: promiseStatusBusy },
      { label: "깨짐", icon: "close", action: "edit-world", data: { kind: "promise", id, status: "broken" }, disabled: promiseStatusBusy },
    ]
    : [];
  // The phone skin reads promises like Reminders: a ring on the left holds 지켜짐/깨짐.
  const ring = lex().skin === "phone" && promiseVerbs.length
    ? `<span class="nr__ring">${menu({ label: "약속 처리", items: promiseVerbs, trigger: { icon: "ring", className: "ring" } })}</span>`
    : "";
  const verbs = opts.verbsVisible && !ring && promiseVerbs.length
    ? `<span class="nr__acts">${promiseVerbs.map((verb) => btn(verb.label, { kind: "quiet", icon: verb.icon, action: verb.action, data: verb.data, disabled: verb.disabled, hit: true })).join("")}</span>`
    : "";
  const polarity = row.type === "belief" && row.polarity && row.polarity !== "believes" ? escapeHtml(POLARITY_LABELS[row.polarity] ?? row.polarity) : "";
  const endedScene = opts.past && row.endedAt !== undefined && row.endedAt !== null ? opts.sceneAt?.(row.endedAt) ?? null : null;
  const ended = !opts.past ? "" : row.deleted ? "직접 삭제함" : (endedScene?.number !== undefined ? `S#${endedScene.number}에 끝남` : "끝남");
  const changed = row.changes > 0 ? `<span class="chg-n">${icon("clock")}${row.changes}번 바뀜</span>` : "";
  const meta = [polarity, row.scheduledFor && !opts.past ? `예정 · ${escapeHtml(formatStoryTime(row.scheduledFor))}` : "", opts.past ? escapeHtml(ended) : renderMention(opts.sceneAt?.(row.lastMention.ordinal) ?? null), row.overdue ? '<span class="is-due">예정 시각 지남</span>' : "", changed].filter(Boolean).join(" · ");
  // Every row reads the same: kind and who on a small line, then the text, then where it was seen.
  const lead = rowLead(row, owner, translations, display);
  const head = `<span class="nr__k"><b class="nr__kind">${TYPE_LABELS[row.type]}</b>${lead ? ` · ${lead}` : ""}</span>`;
  // A row opens its own record; selecting the open one again closes the reader.
  const what = `<button class="nr__what" type="button" data-action="select-now-record" data-key="${escapeHtml(row.key)}"${opts.selected ? ' aria-current="true"' : ""}>${head}<span class="nr__t">${rowText(row, translations, display)}</span></button>`;
  return `<div class="nr${row.overdue ? " is-due" : ""}${opts.selected ? " is-selected" : ""}${ring ? " has-ring" : ""}" data-kind="${row.type}">${ring}${what}${meta ? `<span class="nr__m">${meta}</span>` : ""}${verbs}</div>`;
};

/** Rows shown before a person's group folds; the most recent mentions come first. */
const GROUP_LIMIT = 5;

export function renderNowPage(
  data: DashboardData,
  personaEntity: string | null,
  filter: NowFilter,
  sort: NowSort,
  promiseStatusInFlight: ReadonlySet<string> = new Set(),
  translations: ReadonlyMap<string, string> = new Map(),
  display: TranslationDisplay = "en",
  view: NowView = { mode: "now", selected: "", mobileDetail: false, listOnly: false },
): string {
  const past = view.mode === "past";
  const page = buildNowPage(data, personaEntity, filter, sort, view.mode);
  const sceneAt = sceneLocator(data.memories ?? [], (time) => formatStoryTime(time, true));
  const attention = page.pendingAttention > 0 && !past
    ? `<button type="button" class="now-note" data-action="open-now-attention">확인할 기록 <b>${page.pendingAttention}건</b><span>관리로${icon("chevron")}</span></button>`
    : "";
  const ledgerMenu = menu({ label: "현재 기록 추가", trigger: { icon: "add", className: "now-add" }, items: [
    // On the 목표 or 비밀 filter, adding starts as that kind.
    { label: `${filter === "goal" ? "목표" : filter === "secret" ? "비밀" : "상태"} 추가`, icon: "add", action: "new-world", data: { kind: "assertion", stateKind: filter === "goal" || filter === "secret" ? filter : "condition" } },
    { label: "인식 추가", icon: "add", action: "new-world", data: { kind: "belief" } },
    { label: "약속 추가", icon: "add", action: "new-world", data: { kind: "promise" } },
  ] });
  const modes = `<div class="seg now-mode" role="group" aria-label="기록 범위">${([["now", "현재"], ["past", "지난 기록"]] as const).map(([value, label]) => `<button type="button" data-action="now-mode" data-value="${value}" aria-pressed="${view.mode === value}">${label}</button>`).join("")}</div>`;
  // One row of kinds, pinned with the range above the list; an empty kind stays, dimmed.
  const chips = `<div class="now-chips" data-preserve-scroll="now-chips" role="group" aria-label="현재 기록 필터">${FILTERS.map((value) => `<button type="button" class="now-chip${page.counts[value] ? "" : " is-empty"}" data-kind="${value}" data-action="now-filter" data-value="${value}" aria-pressed="${filter === value}"><span class="now-chip__ic" aria-hidden="true">${icon(FILTER_ICONS[value])}</span>${FILTER_LABELS[value]}<span class="n">${page.counts[value]}</span></button>`).join("")}</div>`;
  const sortLabels: Record<NowSort, string> = { recent: "최근 언급 순", stale: "오래 언급 안 된 순" };
  // The select sits invisibly over its label, so the bar shows a quiet link while the platform picker does the choosing.
  const sortControl = past ? "" : `<label class="now-sort">${icon("swap")}<span class="now-sort__t">${sortLabels[sort]}</span><select data-action="now-sort" aria-label="정렬">${(Object.keys(sortLabels) as NowSort[]).map((value) => `<option value="${value}" ${sort === value ? "selected" : ""}>${sortLabels[value]}</option>`).join("")}</select></label>`;
  const busy = (row: NowRow) => row.type === "promise" && promiseStatusInFlight.has(row.id);
  // Overdue promises ask for a decision, so they lead the page; they leave their person's group so nothing shows twice.
  const due = past ? [] : overduePromiseEntries(page);
  const ordered = [...due.map(({ row }) => row), ...page.groups.flatMap((group) => group.rows.filter((row) => !row.overdue))];
  // On a wide screen the reader shows the first record until another is chosen, unless the list was asked for alone.
  const selected = view.listOnly ? "" : ordered.some((row) => row.key === view.selected) ? view.selected : ordered[0]?.key ?? "";
  const rowOpts = (row: NowRow, verbsVisible: boolean) => ({ verbsVisible, sceneAt, selected: row.key === selected, past });
  const dueSection = due.length
    ? `<section class="who who--due"><h2 class="who-h">기한 지난 약속<span class="n">${due.length}</span></h2>${due.map(({ row, owner }) => renderRow(row, owner, busy(row), translations, display, rowOpts(row, true))).join("")}</section>`
    : "";
  const groups = page.groups.map((group) => {
    const rows = group.rows.filter((row) => !row.overdue);
    if (!rows.length) return "";
    const rank = group.owner === null ? "" : [group.isPersona ? "페르소나" : "", RANK_LABELS[group.rank] ?? ""].filter(Boolean).join(" · ");
    // World facts are one more lead in the call sheet, credited like a person.
    const head = nameHtml(group.owner ?? "World");
    const rendered = rows.map((row) => renderRow(row, group.owner, busy(row), translations, display, rowOpts(row, false)));
    const rest = rendered.slice(GROUP_LIMIT);
    const keepOpen = rows.slice(GROUP_LIMIT).some((row) => row.key === selected && view.mobileDetail);
    const more = rest.length ? fold("더 보기", rest.join(""), { role: "more", count: rest.length, open: keepOpen, preserveKey: `now-group:${group.owner ?? "world"}:${filter}:${view.mode}` }) : "";
    return `<section class="who"><h2 class="who-h">${head}<span class="n">${[rank, `${rows.length}`].filter(Boolean).join(" · ")}</span></h2>${rendered.slice(0, GROUP_LIMIT).join("")}${more}</section>`;
  }).join("");
  const body = dueSection + groups;
  const hint = past ? `<p class="now-hint">끝난 기록이에요. 이어지는 기록의 지난 모습은 각 기록 안에 있어요.</p>` : "";
  const emptyList = past ? empty("끝난 기록이 없습니다", "상태·인식이 끝나거나 약속이 마무리되면 여기에 모입니다.") : empty("표시할 현재 기록이 없습니다", "대화에서 약속·인식·상태가 생기면 인물별로 모입니다.");
  const chain = page.chains.get(selected);
  const detail = chain ? renderRecordDetail(chain, data, { translations, display, back: past ? "지난 기록" : "현재", actions: detailActions(chain, data, busy), fact: beliefFact(chain, data) }) : "";
  // Title, then the range and kinds as one pinned bar, then the list and the record scrolling on their own.
  const bar = `<div class="now-bar">${modes}${chips}<span class="now-bar__end">${sortControl}${past ? "" : ledgerMenu}</span></div>`;
  const state = `${view.mobileDetail && detail ? " is-detail" : ""}${view.listOnly ? " is-list-only" : ""}`;
  return `<div class="worldbook nowbook${state}"><h1 class="pagetitle">현재</h1>${bar}<div class="split"><div class="listcol"><div class="now-rows" data-preserve-scroll="now-list:${view.mode}">${attention}${hint}${body || emptyList}</div></div><div class="readercol">${detail || empty("기록을 고르세요", "목록에서 기록을 고르면 지금 내용과 변화가 열립니다.")}</div></div></div>`;
}

/** The verbs of the open record: a live one is edited or ended in place; a finished one can only be deleted when it was wrong. */
function detailActions(chain: RecordChain, data: DashboardData, busy: (row: NowRow) => boolean): Array<MenuItem | "sep"> {
  const live = chain.current;
  const top = chain.versions[0];
  const id = String(live?.id ?? (chain.kind === "promise" ? top?.item?.promise_id ?? top?.item?.id : top?.id) ?? "");
  if (!id) return [];
  const kind = chain.kind;
  if (top?.deleted) return [];
  // A finished promise is still a row: it can be corrected or reopened.
  if (!live && kind === "promise" && (data.promises ?? []).some((promise: any) => String(promise?.id) === id)) return [
    { label: "수정", icon: "edit", action: "edit-world", data: { kind, id } },
    "sep",
    { label: "삭제", icon: "delete", action: "delete-world", data: { kind, id }, danger: true },
  ];
  if (!live) return [{ label: "삭제", icon: "delete", action: "delete-world", data: { kind, id }, danger: true }];
  const promiseBusy = kind === "promise" && busy({ id, type: "promise" } as NowRow);
  return [
    ...(kind === "promise" ? [
      { label: "지켜짐", icon: "check", action: "edit-world", data: { kind, id, status: "kept" }, disabled: promiseBusy },
      { label: "깨짐", icon: "close", action: "edit-world", data: { kind, id, status: "broken" }, disabled: promiseBusy },
    ] : []),
    { label: "수정", icon: "edit", action: "edit-world", data: { kind, id } },
    ...(kind === "promise" ? [] : [{ label: "종료", icon: "inactive", action: "end-world", data: { kind, id } }]),
    "sep",
    { label: "삭제", icon: "delete", action: "delete-world", data: { kind, id }, danger: true },
  ];
}

/** A belief sits beside the world fact about the same thing, when the ledger has one. */
function beliefFact(chain: RecordChain, data: DashboardData): { text: string; key: string } | undefined {
  if (chain.kind !== "belief") return undefined;
  const item = chain.current ?? chain.versions[0]?.item;
  const key = assertionChainKey(item);
  const fact = (data.assertions ?? []).find((candidate: any) => !candidate?.socialRelation && assertionChainKey(candidate) === key);
  return fact ? { text: String(fact.value ?? ""), key: `assertion:${fact.id}` } : undefined;
}
