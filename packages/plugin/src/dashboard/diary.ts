import {
  ANNIVERSARY_KINDS,
  compareParsedStoryTimes,
  landmarkAlwaysInjected,
  parseStoryTime,
  type LandmarkKind,
} from "@rcm/shared";
import type { DashboardData } from "../dashboard.js";
import { isRecognitionMemory } from "@rcm/shared";
import { MILESTONE_LABELS, type PairSummary } from "./pairs.js";

export type DiaryEntry = {
  id: string;
  kind: "landmark" | "intimacy" | "relationship" | "promise" | "bookmark" | "secret_ended";
  minor: boolean;
  storyTime: string | null;
  ordinal: number | null;
  title: string;
  text: string;
  memoryId: string | null;
};

export type Anniversary = {
  hideKey: string;
  memoryId: string;
  index: number;
  kind: string;
  label: string;
  storyTime: string | null;
  place: string | null;
  alwaysInject: boolean;
  userDefined: boolean;
};

export const LANDMARK_LABELS: Record<string, string> = {
  confession: "고백한 날",
  relationship_change: "관계 변화",
  first_met: "처음 만난 날",
  romantic_relationship_established: "연인이 된 날",
  engagement: "약혼한 날",
  marriage: "결혼한 날",
  separation: "별거한 날",
  romantic_relationship_ended: "헤어진 날",
  reunion: "재결합한 날",
  divorce: "이혼한 날",
  anniversary_basis: "기념일",
  betrayal: "배신",
  death: "죽음",
  identity_reveal: "정체 공개",
  status_change: "상태 변화",
  boundary_change: "경계 변화",
  intimacy_milestone: "스킨십 이정표",
  other: "이정표",
};

const PROMISE_LABELS: Record<string, string> = {
  open: "약속을 맺음",
  kept: "약속을 지킴",
  broken: "약속이 깨짐",
};

const normalizeName = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
const ordinalOf = (item: any): number | null => {
  const value = item?.sourceOrdinal ?? item?.source_ordinal;
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
};
const memoryIdOf = (item: any): string | null => String(item?.sourceMemoryId ?? item?.source_memory_id ?? "").trim() || null;
const memoryStoryTime = (memory: any): string | null => String(memory?.story_time_normalized ?? memory?.storyTime ?? memory?.story_time ?? "").trim() || null;

const namesMatchPair = (left: unknown, right: unknown, pair: PairSummary): boolean => {
  const expected = new Set([normalizeName(pair.a), normalizeName(pair.b)]);
  const actual = new Set([normalizeName(left), normalizeName(right)]);
  return expected.size === 2 && actual.size === 2 && [...expected].every((name) => actual.has(name));
};

const arrayMatchesPair = (value: unknown, pair: PairSummary): boolean =>
  Array.isArray(value) && value.length === 2 && namesMatchPair(value[0], value[1], pair);

const itemMatchesPair = (item: any, pair: PairSummary): boolean =>
  arrayMatchesPair(item?.pair, pair)
  || arrayMatchesPair(item?.participants, pair)
  || namesMatchPair(item?.from, item?.to, pair)
  || namesMatchPair(item?.participantA, item?.participantB, pair)
  || namesMatchPair(item?.promisor, item?.promisee, pair);

const memoryMatchesPair = (memory: any, pair: PairSummary): boolean =>
  arrayMatchesPair(memory?.participants, pair)
  || (memory?.landmarkKinds ?? []).some((landmark: any) => arrayMatchesPair(landmark?.pair, pair));

/** A typed landmark reads by its kind ("고백한 날"); only user-named ones (기념일, 이정표) use their own label. */
export const landmarkLabel = (landmark: any): string => {
  const kind = String(landmark?.kind ?? "");
  const label = String(landmark?.label ?? "").trim();
  return ["anniversary_basis", "other"].includes(kind) ? label || LANDMARK_LABELS[kind] || "이정표" : LANDMARK_LABELS[kind] || label || kind || "이정표";
};

const diarySort = (left: DiaryEntry, right: DiaryEntry): number => {
  if (left.storyTime && right.storyTime) {
    const compared = compareParsedStoryTimes(parseStoryTime(left.storyTime), parseStoryTime(right.storyTime));
    if (compared !== null && compared !== 0) return -compared;
  } else if (left.storyTime !== right.storyTime) {
    return left.storyTime === null ? 1 : -1;
  }
  if (left.ordinal !== right.ordinal) {
    if (left.ordinal === null) return 1;
    if (right.ordinal === null) return -1;
    return right.ordinal - left.ordinal;
  }
  return left.id.localeCompare(right.id, "ko");
};

export function buildDiary(data: DashboardData, pair: PairSummary): DiaryEntry[] {
  const memories = (data.memories ?? []).filter((memory: any) => memory?.active !== false && !isRecognitionMemory(memory));
  const byId = new Map(memories.map((memory: any) => [String(memory?.id ?? ""), memory]));
  const memoryAtOrdinal = (ordinal: number | null): any | undefined => ordinal === null
    ? undefined
    : memories.find((memory: any) => ordinalOf(memory) === ordinal);
  const sourceMemory = (item: any): any | undefined => byId.get(memoryIdOf(item) ?? "");
  const result: DiaryEntry[] = [];

  for (const memory of memories) {
    const ordinal = ordinalOf(memory);
    for (const [index, landmark] of (memory?.landmarkKinds ?? []).entries()) {
      if (!arrayMatchesPair(landmark?.pair, pair)) continue;
      result.push({
        id: `landmark:${String(memory?.id ?? "")}#${index}`,
        kind: "landmark",
        minor: false,
        storyTime: String(landmark?.storyTime ?? "").trim() || memoryStoryTime(memory),
        ordinal,
        title: landmarkLabel(landmark),
        text: String(memory?.title ?? memory?.content ?? "연결된 기억"),
        memoryId: String(memory?.id ?? "").trim() || null,
      });
    }
    if (memory?.bookmarked === true && memoryMatchesPair(memory, pair)) {
      result.push({
        id: `bookmark:${String(memory?.id ?? "")}`,
        kind: "bookmark",
        minor: false,
        storyTime: memoryStoryTime(memory),
        ordinal,
        title: String(memory?.title ?? "북마크한 기억"),
        text: String(memory?.content ?? ""),
        memoryId: String(memory?.id ?? "").trim() || null,
      });
    }
  }

  for (const item of data.physicalIntimacy ?? []) {
    if (!itemMatchesPair(item, pair)) continue;
    const memory = sourceMemory(item);
    const key = String(item?.milestoneKey ?? item?.kind ?? item?.act ?? "");
    result.push({
      id: `intimacy:${String(item?.id ?? key)}`,
      kind: "intimacy",
      minor: false,
      storyTime: memoryStoryTime(memory),
      ordinal: ordinalOf(item) ?? ordinalOf(memory),
      title: String(item?.customLabel ?? "").trim() || MILESTONE_LABELS[key] || key || "스킨십 기록",
      text: String(item?.circumstance ?? item?.sourceMemoryTitle ?? memory?.title ?? ""),
      memoryId: memoryIdOf(item),
    });
  }

  for (const item of data.relationshipEvents ?? []) {
    if (!itemMatchesPair(item, pair)) continue;
    const memory = sourceMemory(item);
    const changes = Array.isArray(item?.changes) ? item.changes : [];
    result.push({
      id: `relationship:${String(item?.id ?? "")}`,
      kind: "relationship",
      minor: changes.length > 0 && changes.every((change: any) => change?.impact === "minor"),
      storyTime: memoryStoryTime(memory),
      ordinal: ordinalOf(item) ?? ordinalOf(memory),
      title: `${String(item?.from ?? pair.a)} → ${String(item?.to ?? pair.b)} 관계 변화`,
      text: String(item?.reason ?? ""),
      memoryId: memoryIdOf(item),
    });
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
  for (const item of promiseEvents) {
    const status = String(item?.status ?? "");
    if (!itemMatchesPair(item, pair) || !PROMISE_LABELS[status]) continue;
    const memory = sourceMemory(item);
    result.push({
      id: `promise:${String(item?.id ?? item?.promise_id ?? item?.promise_key ?? "")}:${status}`,
      kind: "promise",
      minor: false,
      storyTime: memoryStoryTime(memory),
      ordinal: ordinalOf(item) ?? ordinalOf(memory),
      title: PROMISE_LABELS[status]!,
      text: String(item?.content ?? ""),
      memoryId: memoryIdOf(item),
    });
  }

  for (const item of data.endedAssertions ?? []) {
    if (String(item?.stateKind ?? item?.state_kind ?? "condition") !== "secret") continue;
    const subject = normalizeName(item?.subject);
    if (subject !== normalizeName(pair.a) && subject !== normalizeName(pair.b)) continue;
    const predicate = normalizeName(item?.predicate);
    if ((data.assertions ?? []).some((current: any) => String(current?.stateKind ?? current?.state_kind ?? "condition") === "secret"
      && normalizeName(current?.subject) === subject && normalizeName(current?.predicate) === predicate)) continue;
    const endedOrdinal = item?.valid_to_ordinal === null || item?.valid_to_ordinal === undefined
      ? ordinalOf(item)
      : Number(item.valid_to_ordinal);
    const endedMemory = memoryAtOrdinal(endedOrdinal);
    result.push({
      id: `secret:${String(item?.id ?? "")}`,
      kind: "secret_ended",
      minor: false,
      storyTime: endedMemory ? memoryStoryTime(endedMemory) : null,
      ordinal: Number.isFinite(endedOrdinal) ? endedOrdinal : null,
      title: `${String(item?.subject ?? "인물")}의 비밀 상태 종료`,
      text: [item?.predicate, item?.value].map((value) => String(value ?? "").trim()).filter(Boolean).join(" · "),
      memoryId: String(endedMemory?.id ?? "").trim() || null,
    });
  }

  return result.sort(diarySort);
}

export function remapHiddenAnniversariesAfterDelete(hidden: string[], memoryId: string, deletedIndex: number): string[] {
  const prefix = `${memoryId}#`;
  return [...new Set(hidden.flatMap((key) => {
    if (!key.startsWith(prefix)) return [key];
    const rawIndex = key.slice(prefix.length);
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || String(index) !== rawIndex) return [key];
    if (index === deletedIndex) return [];
    return [index > deletedIndex ? `${prefix}${index - 1}` : key];
  }))];
}

export function buildAnniversaries(data: DashboardData, pair: PairSummary, hidden: string[]): Anniversary[] {
  const anniversaryKinds = new Set<string>(ANNIVERSARY_KINDS);
  const hiddenKeys = new Set(hidden);
  const candidates = (data.memories ?? []).filter((memory: any) => memory?.active !== false && !isRecognitionMemory(memory)).flatMap((memory: any, memoryIndex: number) => (memory?.landmarkKinds ?? []).flatMap((landmark: LandmarkKind, index: number) => {
    const hideKey = `${String(memory?.id ?? "")}#${index}`;
    if (!anniversaryKinds.has(landmark.kind) || !arrayMatchesPair(landmark.pair, pair)) return [];
    return [{
      hideKey,
      memoryId: String(memory?.id ?? ""),
      index,
      kind: landmark.kind,
      label: landmarkLabel(landmark),
      storyTime: String(landmark.storyTime ?? "").trim() || memoryStoryTime(memory),
      place: Array.isArray(memory?.locations) ? String(memory.locations[0] ?? "").trim() || null : null,
      alwaysInject: landmarkAlwaysInjected(landmark),
      userDefined: landmark.kind === "anniversary_basis",
      pair: landmark.pair!,
      sourceOrdinal: ordinalOf(memory),
      memoryIndex,
      explicitlyInjected: landmark.alwaysInject === true,
    }];
  }));
  const compareOldest = (left: typeof candidates[number], right: typeof candidates[number]): number => {
    if (left.storyTime && right.storyTime) {
      const compared = compareParsedStoryTimes(parseStoryTime(left.storyTime), parseStoryTime(right.storyTime));
      if (compared !== null && compared !== 0) return compared;
    } else if (left.storyTime !== right.storyTime) return left.storyTime === null ? 1 : -1;
    if (left.sourceOrdinal !== right.sourceOrdinal) {
      if (left.sourceOrdinal === null) return 1;
      if (right.sourceOrdinal === null) return -1;
      return left.sourceOrdinal - right.sourceOrdinal;
    }
    return left.memoryIndex - right.memoryIndex || left.index - right.index;
  };
  const sameLandmarkDate = (left: typeof candidates[number], right: typeof candidates[number]): boolean => {
    if (left.storyTime === right.storyTime) return true;
    if (!left.storyTime || !right.storyTime) return false;
    return compareParsedStoryTimes(parseStoryTime(left.storyTime), parseStoryTime(right.storyTime)) === 0;
  };
  const merged = candidates.filter((item) => {
    if (item.kind !== "anniversary_basis") return true;
    const firstMet = candidates.find((candidate) => candidate.kind === "first_met"
      && candidate.memoryId === item.memoryId
      && candidate.pair.map(normalizeName).sort().join("|") === item.pair.map(normalizeName).sort().join("|")
      && sameLandmarkDate(candidate, item));
    return !firstMet;
  }).map((item) => {
    if (item.kind !== "first_met") return item;
    const basis = candidates.find((candidate) => candidate.kind === "anniversary_basis"
      && candidate.memoryId === item.memoryId
      && candidate.pair.map(normalizeName).sort().join("|") === item.pair.map(normalizeName).sort().join("|")
      && sameLandmarkDate(candidate, item));
    if (!basis || !sameLandmarkDate(item, basis)) return item;
    return { ...item, hideKey: basis.hideKey, index: basis.index, label: basis.label, alwaysInject: basis.alwaysInject, userDefined: true };
  });
  const earliestConfession = merged.filter((item) => item.kind === "confession").sort(compareOldest)[0]?.hideKey;
  return merged
    .filter((item) => !hiddenKeys.has(item.hideKey))
    .filter((item) => item.kind !== "confession" || item.hideKey === earliestConfession || item.explicitlyInjected)
    .sort(compareOldest)
    .map(({ sourceOrdinal: _sourceOrdinal, memoryIndex: _memoryIndex, explicitlyInjected: _explicitlyInjected, pair: _pair, ...item }) => item);
}

const numericDayOffset = (storyTime: string | null, firstMetStoryTime: string | null): number | null => {
  if (!storyTime || !firstMetStoryTime) return null;
  const start = parseStoryTime(firstMetStoryTime);
  const current = parseStoryTime(storyTime);
  const partialDates = start.calendar === "partial" && current.calendar === "partial"
    && start.month !== undefined && start.day !== undefined && current.month !== undefined && current.day !== undefined;
  const numericDates = start.calendar === "numeric" && current.calendar === "numeric"
    && start.year !== undefined && start.month !== undefined && start.day !== undefined
    && current.year !== undefined && current.month !== undefined && current.day !== undefined;
  if (!partialDates && !numericDates) return null;
  const startDay = Date.UTC(partialDates ? 2000 : start.year!, start.month! - 1, start.day!);
  const currentDay = Date.UTC(partialDates ? 2000 : current.year!, current.month! - 1, current.day!);
  const offset = Math.floor((currentDay - startDay) / 86_400_000);
  return offset >= 0 ? offset : null;
};

export function anniversaryDayOffset(anniversary: Anniversary, firstMetStoryTime: string | null): number | null {
  if (anniversary.kind === "first_met") return 0;
  return numericDayOffset(anniversary.storyTime, firstMetStoryTime);
}

export function earliestFirstMetStoryTime(anniversaries: Anniversary[]): string | null {
  let earliest: string | null = null;
  for (const item of anniversaries) {
    if (item.kind !== "first_met" || !item.storyTime) continue;
    if (earliest === null) { earliest = item.storyTime; continue; }
    const compared = compareParsedStoryTimes(parseStoryTime(item.storyTime), parseStoryTime(earliest));
    if (compared !== null && compared < 0) earliest = item.storyTime;
  }
  return earliest;
}

export function daysSinceFirstMet(anniversaries: Anniversary[], currentStoryTime: string | null): number | null {
  const firstMet = earliestFirstMetStoryTime(anniversaries);
  if (!firstMet || !currentStoryTime) return null;
  const offset = numericDayOffset(currentStoryTime, firstMet);
  return offset !== null && offset >= 0 ? offset : null;
}
