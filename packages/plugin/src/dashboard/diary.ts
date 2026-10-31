import { normalizeName, memoryIdOf, memoryStoryTime, arrayMatchesPair, itemMatchesPair, memoryMatchesPair, mergePromiseHistory } from "./pair-records.js";
import { landmarkLabel } from "@rcm/shared";
export { buildAnniversaries, anniversaryDayOffset, earliestFirstMetStoryTime, daysSinceFirstMet, landmarkLabel, LANDMARK_LABELS, type Anniversary } from "@rcm/shared";
import {
  compareParsedStoryTimes,
  parseStoryTime,
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

const PROMISE_LABELS: Record<string, string> = {
  open: "약속을 맺음",
  kept: "약속을 지킴",
  broken: "약속이 깨짐",
};

const ordinalOf = (item: any): number | null => {
  const value = item?.sourceOrdinal ?? item?.source_ordinal;
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
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
    if (item.hidden) continue;
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

  const promiseEvents = mergePromiseHistory(data);
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
