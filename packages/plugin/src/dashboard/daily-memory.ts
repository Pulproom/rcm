import { holidayForStoryDate } from "./holidays.js";
import { parseStoryTime } from "@rcm/shared";
import type { DashboardData } from "../dashboard.js";
import { buildAnniversaries, daysSinceFirstMet } from "./diary.js";
import { buildPairs } from "./pairs.js";
import { sceneLocator, storyScenes } from "./scenes.js";
import { birthdayPeople, birthdaysForStoryDate, type BirthdayPerson } from "./birthdays.js";
import { normalizeName } from "./pairs.js";

export type MessagePlayTime = { id: string; ordinal: number; time: number };
export type DailyMemory = {
  memory: any;
  reason: "birthday" | "year" | "month" | "week" | "story-day" | "anniversary" | "holiday" | "archive";
  label: string;
  credit: string;
  playedAt?: number;
  anniversary?: { label: string; key: string };
  /** Story days since the pair's first meeting at this scene (story clock, not real play time). */
  storyDay?: number | null;
  birthdays?: BirthdayPerson[];
  birthday?: { person: BirthdayPerson; sceneMatches: boolean };
};
export type DailyMemoryView = { key: string; offset: number };
const DAY = 86_400_000;
const text = (value: unknown): string => String(value ?? "").trim();
const hash = (value: string): number => {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.codePointAt(0)!, 16777619) >>> 0;
  return result;
};
/** Local calendar dates projected onto UTC: DST never changes the day count. */
const localDay = (date: Date): number => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
export const dailyMemoryKey = (chatId: string, now: Date): string => `${chatId}:${localDay(now)}`;

/** Exact calendar anniversary, with no rollover/clamping from Feb 29 or a missing month-end day. */
function priorDate(now: Date, years: number, months: number): number | undefined {
  const target = new Date(now.getFullYear() - years, now.getMonth() - months, 1);
  target.setDate(now.getDate());
  const month = ((now.getMonth() - months) % 12 + 12) % 12;
  return target.getMonth() === month ? localDay(target) : undefined;
}

/** Only source play metadata is used; memory creation/update time is never a play date. */
export function dailyMemoryCandidates(data: DashboardData, times: readonly MessagePlayTime[], chatId: string, now: Date): DailyMemory[] {
  const scenes = storyScenes(data.memories).filter(memory => memory.active !== false);
  if (scenes.length < 12) return [];
  const eligible = scenes.filter(memory => text(memory.title) || (memory.keyDialogues ?? []).some((line: any) => text(line.text)));
  const byId = new Map(times.filter(row => Number.isFinite(row.time) && row.time > 0).map(row => [row.id, row.time]));
  const byOrdinal = new Map(times.filter(row => byId.has(row.id)).map(row => [row.ordinal, row.time]));
  const playTimes = new Map(scenes.map(memory => {
    let evidence: any[] = [];
    try { const parsed: unknown = JSON.parse(memory.evidence_json ?? "[]"); if (Array.isArray(parsed)) evidence = parsed; } catch { /* Missing provenance has no real-date anniversary. */ }
    const ids = new Set([...evidence.map(row => row?.messageId), ...(memory.keyDialogues ?? []).map((row: any) => row.messageId),
      ...(memory.sections ?? []).flatMap((row: any) => row.sourceMessageIds ?? [])]);
    const found = [...ids].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    const ordinal = memory.source_ordinal ?? memory.sourceOrdinal;
    if (ordinal !== null && ordinal !== undefined && byOrdinal.has(Number(ordinal))) found.push(byOrdinal.get(Number(ordinal))!);
    return [String(memory.id), [...new Set(found)].sort((a, b) => a - b)] as const;
  }));
  const locate = sceneLocator(scenes, value => value);
  const sceneIds = new Set(scenes.map(memory => String(memory.id)));
  const memoriesById = new Map(data.memories.map(memory => [String(memory.id), memory]));
  const impacts = new Map<string, Set<string>>();
  for (const event of data.relationshipEvents ?? []) {
    const source = memoriesById.get(String(event.sourceMemoryId));
    const id = source?.capsule_parent_id ?? (sceneIds.has(String(event.sourceMemoryId)) ? event.sourceMemoryId
      : locate(event.sourceOrdinal ?? source?.source_ordinal)?.memoryId);
    if (!id) continue;
    const values = impacts.get(String(id)) ?? new Set<string>();
    for (const change of event.changes ?? []) values.add(change.impact);
    impacts.set(String(id), values);
  }
  const score = (memory: any): number => (impacts.get(String(memory.id))?.has("turning") ? 3 : 0)
    + (impacts.get(String(memory.id))?.has("major") ? 2 : 0)
    + (memory.landmark || memory.landmarkKinds?.length ? 2 : 0)
    + ((memory.keyDialogues ?? []).some((line: any) => text(line.text)) ? 2 : 0) + (memory.bookmarked ? 3 : 0);
  const ranked = [...eligible].sort((a, b) => score(b) - score(a)
    || hash(`${chatId}:${a.id}`) - hash(`${chatId}:${b.id}`) || String(a.id).localeCompare(String(b.id)));
  const result: DailyMemory[] = [];
  const people = birthdayPeople(data);
  const sceneBirthdays = (memory: any) => birthdaysForStoryDate(parseStoryTime(memory.story_time_normalized ?? memory.story_time ?? memory.storyTime), people);
  // The story clock for a scene: days since the first meeting of the pair that appears in it (else the first pair that has one).
  const pairItems = buildPairs(data, data.personaEntity).map(pair => ({ pair, items: buildAnniversaries(data, pair, data.viewPreferences?.hiddenAnniversaries ?? []) }))
    .filter(entry => entry.items.some(item => item.kind === "first_met"));
  const storyDayOf = (memory: any): number | null => {
    const names = new Set((memory.participants ?? []).map((name: unknown) => String(name).toLocaleLowerCase()));
    const entry = pairItems.find(({ pair }) => names.has(pair.a.toLocaleLowerCase()) && names.has(pair.b.toLocaleLowerCase())) ?? pairItems[0];
    return entry ? daysSinceFirstMet(entry.items, memory.story_time_normalized ?? memory.story_time ?? memory.storyTime ?? null) : null;
  };
  const append = (memory: any, reason: DailyMemory["reason"], label: string, credit: string, playedAt?: number, anniversary?: DailyMemory["anniversary"], birthday?: DailyMemory["birthday"]) => {
    if (result.some(item => item.memory.id === memory.id)) return;
    result.push({ memory, reason, label, credit, playedAt: playedAt ?? playTimes.get(String(memory.id))?.[0], storyDay: storyDayOf(memory), birthdays: sceneBirthdays(memory), ...(anniversary ? { anniversary } : {}), ...(birthday ? { birthday } : {}) });
  };
  const celebrating = birthdaysForStoryDate({ month: now.getMonth() + 1, day: now.getDate() }, people);
  // Real local birthday leads; story dates only choose/tag a scene, never define "today".
  for (const sceneMatches of [true, false]) for (const memory of ranked) {
    const person = celebrating.find(person => sceneMatches
      ? sceneBirthdays(memory).some(match => match === person)
      : (memory.participants ?? []).some((name: unknown) => person.names.includes(normalizeName(name))));
    if (person) append(memory, "birthday", "Happy Birthday!", "HAPPY BIRTHDAY", undefined, undefined, { person, sceneMatches });
  }
  const targets = [
    { day: priorDate(now, 1, 0), reason: "year", label: "1년 전 오늘", credit: "A YEAR AGO TODAY" },
    { day: priorDate(now, 0, 1), reason: "month", label: "한 달 전 오늘", credit: "A MONTH AGO TODAY" },
    { day: localDay(now) - 7, reason: "week", label: "일주일 전 오늘", credit: "A WEEK AGO TODAY" },
  ] as const;
  for (const target of targets) {
    if (target.day === undefined) continue;
    for (const memory of ranked) {
      const playedAt = playTimes.get(String(memory.id))?.find(time => localDay(new Date(time)) === target.day);
      if (playedAt !== undefined) append(memory, target.reason, target.label, target.credit, playedAt);
    }
  }
  const currentStoryTime = scenes.at(-1)?.story_time_normalized ?? scenes.at(-1)?.story_time ?? null;
  const current = parseStoryTime(currentStoryTime);
  const anniversaries = buildPairs(data, data.personaEntity).flatMap(pair => {
    const items = buildAnniversaries(data, pair, data.viewPreferences?.hiddenAnniversaries ?? []);
    const days = daysSinceFirstMet(items, currentStoryTime);
    const round = days !== null && ([50, 100, 200, 365].includes(days) || (days > 200 && days % 100 === 0));
    const first = items.find(item => item.kind === "first_met");
    return [
      ...(round && first ? [{ ...first, days }] : []),
      ...items.filter(item => {
        const date = parseStoryTime(item.storyTime);
        const calendarMatches = current.calendarKey === date.calendarKey
          || (["numeric", "partial"].includes(current.calendar) && ["numeric", "partial"].includes(date.calendar));
        return current.month !== undefined && current.day !== undefined && current.month === date.month && current.day === date.day
          && calendarMatches && item.memoryId !== String(scenes.at(-1)?.id)
          && (current.year === undefined || date.year === undefined || date.year <= current.year);
      }).map(item => ({ ...item, days: null })),
    ];
  });
  // Round story days precede named anniversaries; scene scoring settles multiple pairs/scenes.
  for (const round of [true, false]) for (const memory of ranked) {
    const item = anniversaries.find(item => item.memoryId === String(memory.id) && (item.days !== null) === round);
    if (item) append(memory, round ? "story-day" : "anniversary", round ? `처음 만난 지 D+${item.days}` : `${item.label} 그날`, round ? `DAY ${item.days}` : "ON THIS STORY DAY", undefined,
      !round && item.userDefined ? { label: item.label, key: `landmark:${item.memoryId}#${item.index}:label` } : undefined);
  }
  const holiday = holidayForStoryDate({ month: now.getMonth() + 1, day: now.getDate() });
  if (holiday) for (const memory of ranked) {
    const date = parseStoryTime(memory.story_time_normalized ?? memory.story_time ?? memory.storyTime);
    if (holidayForStoryDate(date)?.id === holiday.id) append(memory, "holiday", `그해 ${holiday.label}`, `THAT ${holiday.credit}`);
  }
  const recentIds = new Set(scenes.slice(-10).map(memory => memory.id));
  const archive = ranked.filter(memory => !recentIds.has(memory.id));
  const start = archive.length ? (localDay(now) + hash(chatId)) % archive.length : 0;
  for (let index = 0; index < archive.length; index++) append(archive[(start + index) % archive.length], "archive", "다시 보는 장면", "FROM THE ARCHIVE");
  return result;
}

export function selectDailyMemory(data: DashboardData, times: readonly MessagePlayTime[], chatId: string, now: Date, view?: DailyMemoryView): DailyMemory | null {
  const candidates = dailyMemoryCandidates(data, times, chatId, now);
  const offset = view?.key === dailyMemoryKey(chatId, now) ? view.offset : 0;
  return candidates[offset % candidates.length] ?? null;
}

export function relativePlayTime(time: number | undefined, now: Date): string | null {
  if (time === undefined) return null;
  const date = new Date(time), days = localDay(now) - localDay(date);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days === 0) return "오늘";
  if (priorDate(now, 1, 0) === localDay(date)) return "1년 전";
  if (priorDate(now, 0, 1) === localDay(date)) return "한 달 전";
  return `${days}일 전`;
}
