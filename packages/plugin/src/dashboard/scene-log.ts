import { formatStoryTime, compareParsedStoryTimes, parseStoryTime } from "@rcm/shared";
import type { DashboardData } from "../dashboard.js";
import { buildAnniversaries, landmarkLabel } from "./diary.js";
import { isRecognitionMemory } from "@rcm/shared";
import { MILESTONE_LABELS, type PairSummary } from "./pairs.js";

export type SceneChip = { kind: "landmark" | "love" | "up" | "down" | "promise_made" | "promise_kept" | "promise_broken" | "bookmark" | "secret_ended" | "minor"; label: string; trend?: "up" | "down" };
export type SceneCard = { memoryId: string; slate: { no: number; time: string | null; place: string | null }; date: string | null; title: string; chips: SceneChip[]; key: boolean };
export type SceneDay = { date: string | null; weekday: string | null; scenes: SceneCard[] };

type Scene = {
  memory: any;
  memoryId: string;
  no: number;
  ordinal: number | null;
  storyTime: string | null;
  date: string | null;
  dateKey: string | null;
  weekday: string | null;
  time: string | null;
  place: string | null;
  chips: Array<SceneChip & { order: number }>;
  key: boolean;
  fallbackTitle: string;
};

const AXIS_LABELS: Record<string, string> = {
  affection: "애정",
  trust: "신뢰",
  intimacy: "친밀감",
  fear: "두려움",
  jealousy: "질투",
  hostility: "적대감",
};

const CHIP_ORDER: Record<SceneChip["kind"], number> = {
  landmark: 0,
  love: 1,
  up: 2,
  down: 2,
  promise_made: 3,
  promise_kept: 3,
  promise_broken: 3,
  bookmark: 4,
  secret_ended: 5,
  minor: 6,
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** The weekday of a story time ("화"), when its calendar date is known. */
export const storyWeekday = (storyTime: string | null): string | null => sceneDate(storyTime).weekday;
const pad = (value: number): string => String(value).padStart(2, "0");
const normalizeName = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
const memoryIdOf = (item: any): string | null => String(item?.sourceMemoryId ?? item?.source_memory_id ?? "").trim() || null;
const ordinalOf = (item: any): number | null => {
  const value = item?.sourceOrdinal ?? item?.source_ordinal;
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
};
const memoryStoryTime = (memory: any): string | null => String(memory?.story_time_normalized ?? memory?.storyTime ?? memory?.story_time ?? "").trim() || null;

const namesMatchPair = (left: unknown, right: unknown, pair: PairSummary): boolean => {
  const expected = new Set([normalizeName(pair.a), normalizeName(pair.b)]);
  const actual = new Set([normalizeName(left), normalizeName(right)]);
  return expected.size === 2 && actual.size === 2 && [...expected].every((name) => actual.has(name));
};
const arrayMatchesPair = (value: unknown, pair: PairSummary): boolean =>
  Array.isArray(value) && value.length === 2 && namesMatchPair(value[0], value[1], pair);
export const itemMatchesPair = (item: any, pair: PairSummary): boolean =>
  arrayMatchesPair(item?.pair, pair)
  || arrayMatchesPair(item?.participants, pair)
  || namesMatchPair(item?.from, item?.to, pair)
  || namesMatchPair(item?.participantA, item?.participantB, pair)
  || namesMatchPair(item?.promisor, item?.promisee, pair);
const memoryMatchesPair = (memory: any, pair: PairSummary): boolean =>
  arrayMatchesPair(memory?.participants, pair)
  || (memory?.landmarkKinds ?? []).some((landmark: any) => arrayMatchesPair(landmark?.pair, pair));

const chronologicalMemorySort = (left: { memory: any; index: number }, right: { memory: any; index: number }): number => {
  const leftTime = memoryStoryTime(left.memory);
  const rightTime = memoryStoryTime(right.memory);
  if (leftTime && rightTime) {
    const compared = compareParsedStoryTimes(parseStoryTime(leftTime), parseStoryTime(rightTime));
    if (compared !== null && compared !== 0) return compared;
  } else if (leftTime !== rightTime) return leftTime === null ? 1 : -1;
  const leftOrdinal = ordinalOf(left.memory);
  const rightOrdinal = ordinalOf(right.memory);
  if (leftOrdinal !== rightOrdinal) {
    if (leftOrdinal === null) return 1;
    if (rightOrdinal === null) return -1;
    return leftOrdinal - rightOrdinal;
  }
  return left.index - right.index;
};

const sceneDate = (storyTime: string | null): { date: string | null; dateKey: string | null; weekday: string | null } => {
  if (!storyTime) return { date: null, dateKey: null, weekday: null };
  const parsed = parseStoryTime(storyTime);
  if (parsed.month === undefined || parsed.day === undefined) return { date: storyTime, dateKey: `raw:${storyTime}`, weekday: null };
  const date = formatStoryTime(storyTime, true);
  if (parsed.calendar !== "numeric" || parsed.year === undefined) {
    return { date, dateKey: `${parsed.calendarKey ?? parsed.calendar}:${parsed.year ?? ""}:${date}`, weekday: null };
  }
  return {
    date,
    dateKey: `${String(parsed.year).padStart(4, "0")}-${pad(parsed.month)}-${pad(parsed.day)}`,
    weekday: WEEKDAYS[new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay()] ?? null,
  };
};

/** The day header already names the date, so a scene's slate keeps only its clock (or the unparsed wording). */
const sceneTime = (memory: any, storyTime: string | null): string | null => {
  const raw = String(memory?.story_time ?? memory?.storyTime ?? storyTime ?? "").trim();
  const text = formatStoryTime(raw);
  const date = formatStoryTime(raw, true);
  if (!text || date === raw) return text || null;
  if (text === date) return null;
  return text.startsWith(`${date} `) ? text.slice(date.length + 1) : text;
};

const intimacyLabel = (item: any): string => {
  const key = String(item?.milestoneKey ?? item?.kind ?? item?.act ?? "");
  return String(item?.customLabel ?? "").trim() || MILESTONE_LABELS[key] || key || "스킨십 기록";
};
export function buildSceneLog(data: DashboardData, pair: PairSummary, filter: "all" | "key" | "intimacy" | "heart" | "promise" | "bookmark", sort: "newest" | "oldest" = "newest"): SceneDay[] {
  const direction = sort === "oldest" ? 1 : -1;
  const allMemories = (data.memories ?? []).filter((memory: any) => !isRecognitionMemory(memory));
  const allMemoryById = new Map(allMemories.map((memory: any) => [String(memory?.id ?? ""), memory]));
  const activeScenes = allMemories
    .map((memory: any, index: number) => ({ memory, index }))
    .filter(({ memory }) => memory?.active !== false && memory?.type === "episode")
    .sort(chronologicalMemorySort);
  const sceneById = new Map<string, Scene>();
  const scenes = activeScenes.map(({ memory }, index): Scene => {
    const storyTime = memoryStoryTime(memory);
    const date = sceneDate(storyTime);
    const scene: Scene = {
      memory,
      memoryId: String(memory?.id ?? ""),
      no: index + 1,
      ordinal: ordinalOf(memory),
      storyTime,
      ...date,
      time: sceneTime(memory, storyTime),
      place: Array.isArray(memory?.locations) ? String(memory.locations[0] ?? "").trim() || null : null,
      chips: [],
      key: false,
      fallbackTitle: "",
    };
    sceneById.set(scene.memoryId, scene);
    return scene;
  });
  const usedScenes = new Set<Scene>();
  const orphanScenes = new Map<string, Scene>();
  let chipOrder = 0;

  const targetScene = (item: any, directMemoryId = memoryIdOf(item), ordinal = ordinalOf(item)): Scene => {
    const direct = directMemoryId ? sceneById.get(directMemoryId) : undefined;
    if (direct) return direct;
    const sourceMemory = directMemoryId ? allMemoryById.get(directMemoryId) : undefined;
    const sourceOrdinal = ordinal ?? ordinalOf(sourceMemory);
    const previous = sourceOrdinal === null ? undefined : scenes.reduce<Scene | undefined>((closest, scene) => {
      if (scene.ordinal === null || scene.ordinal > sourceOrdinal) return closest;
      return !closest || closest.ordinal === null || scene.ordinal > closest.ordinal ? scene : closest;
    }, undefined);
    if (previous) return previous;
    const orphanKey = directMemoryId || `${String(item?.id ?? item?.promise_id ?? item?.promise_key ?? chipOrder)}`;
    const existing = orphanScenes.get(orphanKey);
    if (existing) return existing;
    const orphan: Scene = {
      memory: sourceMemory,
      memoryId: directMemoryId ?? "",
      no: 0,
      ordinal: sourceOrdinal,
      storyTime: null,
      date: null,
      dateKey: null,
      weekday: null,
      time: null,
      place: null,
      chips: [],
      key: false,
      fallbackTitle: String(item?.reason ?? item?.content ?? item?.circumstance ?? item?.value ?? "").trim() || "연결되지 않은 관계 기록",
    };
    orphanScenes.set(orphanKey, orphan);
    return orphan;
  };
  const addChip = (scene: Scene, chip: SceneChip): void => {
    usedScenes.add(scene);
    scene.chips.push({ ...chip, order: chipOrder++ });
  };

  const hidden = Array.isArray(data.viewPreferences?.hiddenAnniversaries) ? data.viewPreferences.hiddenAnniversaries : [];
  const anniversaryKeys = new Set(buildAnniversaries(data, pair, hidden).map((item) => item.hideKey));
  for (const memory of allMemories) {
    const memoryId = String(memory?.id ?? "").trim() || null;
    const ordinal = ordinalOf(memory);
    for (const [index, landmark] of (memory?.landmarkKinds ?? []).entries()) {
      if (!arrayMatchesPair(landmark?.pair, pair)) continue;
      const scene = targetScene(memory, memoryId, ordinal);
      addChip(scene, { kind: "landmark", label: landmarkLabel(landmark) });
      if (anniversaryKeys.has(`${memoryId ?? ""}#${index}`)) scene.key = true;
    }
  }

  for (const item of data.physicalIntimacy ?? []) {
    if (!itemMatchesPair(item, pair)) continue;
    addChip(targetScene(item), { kind: "love", label: intimacyLabel(item) });
  }

  for (const item of data.relationshipEvents ?? []) {
    if (!itemMatchesPair(item, pair)) continue;
    const scene = targetScene(item);
    for (const change of Array.isArray(item?.changes) ? item.changes : []) {
      const axis = AXIS_LABELS[String(change?.axis ?? "")] ?? String(change?.axis ?? "관계");
      const falling = ["decrease", "complicate"].includes(String(change?.effect ?? ""));
      if (change?.impact === "minor") {
        addChip(scene, { kind: "minor", label: `${axis} 소폭`, trend: falling ? "down" : "up" });
        continue;
      }
      if (!["meaningful", "major", "turning"].includes(String(change?.impact ?? ""))) continue;
      addChip(scene, { kind: falling ? "down" : "up", label: axis });
    }
  }

  const promiseEvents = [...(data.promiseHistory ?? [])];
  const recordedPromiseStates = new Set(promiseEvents.map((item: any) => [
    String(item?.promise_id ?? item?.id ?? item?.promise_key ?? ""),
    String(item?.status ?? ""),
  ].join("#")));
  for (const item of data.promises ?? []) {
    const key = [String(item?.id ?? item?.promise_id ?? item?.promise_key ?? ""), String(item?.status ?? "")].join("#");
    if (!recordedPromiseStates.has(key)) promiseEvents.push(item);
  }
  const promiseChips: Record<string, SceneChip> = {
    open: { kind: "promise_made", label: "약속 맺음" },
    kept: { kind: "promise_kept", label: "약속 지킴" },
    broken: { kind: "promise_broken", label: "약속 깨짐" },
  };
  for (const item of promiseEvents) {
    const chip = promiseChips[String(item?.status ?? "")];
    if (!chip || !itemMatchesPair(item, pair)) continue;
    addChip(targetScene(item), chip);
  }

  for (const memory of allMemories) {
    if (memory?.active === false || memory?.bookmarked !== true || !memoryMatchesPair(memory, pair)) continue;
    addChip(targetScene(memory, String(memory?.id ?? "").trim() || null, ordinalOf(memory)), { kind: "bookmark", label: "북마크" });
  }

  const currentSecretIds = new Set((data.assertions ?? []).flatMap((item: any) => {
    if (String(item?.stateKind ?? item?.state_kind ?? "condition") !== "secret") return [];
    const id = String(item?.id ?? "").trim();
    return id ? [id] : [];
  }));
  for (const item of data.endedAssertions ?? []) {
    if (String(item?.stateKind ?? item?.state_kind ?? "condition") !== "secret") continue;
    const subject = normalizeName(item?.subject);
    if (subject !== normalizeName(pair.a) && subject !== normalizeName(pair.b)) continue;
    const id = String(item?.id ?? "").trim();
    if (id && currentSecretIds.has(id)) continue;
    const rawEndedOrdinal = item?.valid_to_ordinal ?? item?.validToOrdinal;
    const endedOrdinal = rawEndedOrdinal !== null && rawEndedOrdinal !== undefined && Number.isFinite(Number(rawEndedOrdinal))
      ? Number(rawEndedOrdinal)
      : ordinalOf(item);
    const directMemoryId = rawEndedOrdinal === null || rawEndedOrdinal === undefined ? memoryIdOf(item) : null;
    addChip(targetScene(item, directMemoryId, endedOrdinal), { kind: "secret_ended", label: "비밀 종료" });
  }

  for (const scene of usedScenes) {
    scene.chips.sort((left, right) => CHIP_ORDER[left.kind] - CHIP_ORDER[right.kind] || left.order - right.order);
  }

  const matchesFilter = (scene: Scene): boolean => filter === "all"
    || (filter === "key" && scene.key)
    || (filter === "intimacy" && scene.chips.some((chip) => chip.kind === "love"))
    || (filter === "heart" && scene.chips.some((chip) => ["up", "down", "minor"].includes(chip.kind)))
    || (filter === "promise" && scene.chips.some((chip) => chip.kind.startsWith("promise_")))
    || (filter === "bookmark" && scene.chips.some((chip) => chip.kind === "bookmark"));

  const cardOf = (scene: Scene): SceneCard => ({
    memoryId: scene.memoryId,
    slate: { no: scene.no, time: scene.time, place: scene.place },
    date: scene.date,
    title: String(scene.memory?.title ?? "").trim() || scene.fallbackTitle,
    chips: scene.chips.map(({ order: _order, ...chip }) => chip),
    key: scene.key,
  });
  const filtered = [...usedScenes].filter(matchesFilter);
  const groups = new Map<string, { date: string | null; dateKey: string | null; weekday: string | null; storyTime: string | null; ordinal: number | null; scenes: Scene[] }>();
  for (const scene of filtered) {
    const key = scene.dateKey ?? "__undated__";
    const group = groups.get(key) ?? { date: scene.date, dateKey: scene.dateKey, weekday: scene.weekday, storyTime: scene.storyTime, ordinal: scene.ordinal, scenes: [] };
    group.scenes.push(scene);
    groups.set(key, group);
  }
  const orderedGroups = [...groups.values()].sort((left, right) => {
    if (left.dateKey === null || right.dateKey === null) return left.dateKey === right.dateKey ? 0 : left.dateKey === null ? 1 : -1;
    const compared = left.storyTime && right.storyTime
      ? compareParsedStoryTimes(parseStoryTime(left.storyTime), parseStoryTime(right.storyTime))
      : null;
    if (compared !== null && compared !== 0) return direction * compared;
    return direction * ((left.ordinal ?? -1) - (right.ordinal ?? -1));
  });
  return orderedGroups.map((group) => ({
    date: group.date,
    weekday: group.weekday,
    scenes: group.scenes
      .sort((left, right) => direction * (left.no - right.no || (left.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.ordinal ?? Number.MAX_SAFE_INTEGER)))
      .map(cardOf),
  }));
}
