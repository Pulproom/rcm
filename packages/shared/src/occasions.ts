import { EntityBirthdaySchema, compareParsedStoryTimes, parseStoryTime, isRecognitionMemory, type EntityBirthday, type StoredLandmarkKind } from "./index.js";
import { ANNIVERSARY_KINDS, landmarkAlwaysInjected } from "./landmark-injection.js";

export type OccasionMemory = {
  id: string; active?: boolean | number; recognitionOnly?: boolean; story_time_normalized?: string | null;
  story_time?: string | null; storyTime?: string | null; source_ordinal?: number | null; sourceOrdinal?: number | null;
  landmarkKinds?: StoredLandmarkKind[]; locations?: string[];
};
export type Anniversary = {
  hideKey: string; memoryId: string; index: number; kind: string; label: string; storyTime: string | null;
  place: string | null; alwaysInject: boolean; userDefined: boolean;
};
const normalizeName = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
const ordinalOf = (item: any): number | null => {
  const value = item?.sourceOrdinal ?? item?.source_ordinal;
  return value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
};
const memoryStoryTime = (memory: OccasionMemory): string | null => String(memory?.story_time_normalized ?? memory?.storyTime ?? memory?.story_time ?? "").trim() || null;
const arrayMatchesPair = (value: unknown, pair: { a: string; b: string }): boolean => Array.isArray(value) && value.length === 2
  && [...new Set(value.map(normalizeName))].sort().join("\0") === [pair.a, pair.b].map(normalizeName).sort().join("\0");
export const landmarkLabel = (landmark: StoredLandmarkKind): string =>
  landmark.userDefined || ["anniversary_basis", "other"].includes(landmark.kind)
    ? landmark.label || LANDMARK_LABELS[landmark.kind] || "이정표"
    : LANDMARK_LABELS[landmark.kind] || landmark.label || landmark.kind;

/** The latest comparable stored scene date; never the wall clock or live prose. */
export function latestStoryTime(data: { memories?: OccasionMemory[] }): string | null {
  let current: string | null = null;
  for (const memory of data.memories ?? []) {
    if (memory.active === false || memory.active === 0) continue;
    const candidate = memoryStoryTime(memory);
    if (!candidate || parseStoryTime(candidate).calendar === "unknown") continue;
    if (current === null || (compareParsedStoryTimes(parseStoryTime(current), parseStoryTime(candidate)) ?? 0) < 0) current = candidate;
  }
  return current;
}
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

export function buildAnniversaries(data: { memories?: OccasionMemory[] }, pair: { a: string; b: string }, hidden: string[]): Anniversary[] {
  const anniversaryKinds = new Set<string>(ANNIVERSARY_KINDS);
  const hiddenKeys = new Set(hidden);
  const candidates = (data.memories ?? []).filter((memory: any) => memory?.active !== false && memory?.active !== 0 && !isRecognitionMemory(memory)).flatMap((memory: any, memoryIndex: number) => (memory?.landmarkKinds ?? []).flatMap((landmark: StoredLandmarkKind, index: number) => {
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
      userDefined: landmark.userDefined === true || landmark.kind === "anniversary_basis",
      markedUserDefined: landmark.userDefined === true,
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
    if (item.kind !== "anniversary_basis" || item.markedUserDefined) return true;
    const firstMet = candidates.find((candidate) => candidate.kind === "first_met" && !candidate.markedUserDefined
      && candidate.memoryId === item.memoryId
      && candidate.pair.map(normalizeName).sort().join("|") === item.pair.map(normalizeName).sort().join("|")
      && sameLandmarkDate(candidate, item));
    return !firstMet;
  }).map((item) => {
    if (item.kind !== "first_met" || item.markedUserDefined) return item;
    const basis = candidates.find((candidate) => candidate.kind === "anniversary_basis" && !candidate.markedUserDefined
      && candidate.memoryId === item.memoryId
      && candidate.pair.map(normalizeName).sort().join("|") === item.pair.map(normalizeName).sort().join("|")
      && sameLandmarkDate(candidate, item));
    if (!basis || !sameLandmarkDate(item, basis)) return item;
    return { ...item, hideKey: basis.hideKey, index: basis.index, label: basis.label, alwaysInject: basis.alwaysInject, userDefined: true };
  });
  // Choose user authority before applying hidden keys; hiding must not revive automatic bases.
  const authoritative = merged.filter(item => !["first_met", "romantic_relationship_established", "marriage"].includes(item.kind)
    || item.userDefined || !merged.some(other => other.kind === item.kind && other.userDefined));
  const earliestConfession = authoritative.filter((item) => item.kind === "confession").sort(compareOldest)[0]?.hideKey;
  return authoritative
    .filter((item) => !hiddenKeys.has(item.hideKey))
    .filter((item) => item.kind !== "confession" || item.hideKey === earliestConfession || item.explicitlyInjected)
    .sort(compareOldest)
    .map(({ sourceOrdinal: _sourceOrdinal, memoryIndex: _memoryIndex, explicitlyInjected: _explicitlyInjected, markedUserDefined: _markedUserDefined, pair: _pair, ...item }) => item);
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
  const startDay = utcDay(partialDates ? 2000 : start.year!, start.month!, start.day!) * 86_400_000;
  const currentDay = utcDay(partialDates ? 2000 : current.year!, current.month!, current.day!) * 86_400_000;
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


const DAY = 86_400_000;
const utcDay = (year: number, month: number, day: number): number => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / DAY;
};
const calendarDate = (value: string | null) => {
  const date = parseStoryTime(value);
  if (!["numeric", "partial"].includes(date.calendar) || date.month === undefined || date.day === undefined) return null;
  const checked = new Date(utcDay(date.year ?? 2000, date.month, date.day) * DAY);
  return checked.getUTCMonth() + 1 === date.month && checked.getUTCDate() === date.day ? date : null;
};
const displayDay = (day: number, yearless: boolean) => yearless ? utcDay(2000, 1, 1) + ((day - utcDay(2000, 1, 1)) % 366 + 366) % 366 : day;
const dateAt = (day: number, yearless: boolean): string => {
  const date = new Date(displayDay(day, yearless) * DAY);
  const md = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return yearless ? md : `${String(date.getUTCFullYear()).padStart(4, "0")}-${md}`;
};
export type Occasion = {
  key: string; kind: "birthday" | "anniversary"; label: string; date: string; remaining: number;
  month: number; day: number; memoryId?: string; person?: string; pair?: [string, string];
  years?: number; days?: number;
};
export type OccasionBirthday = { key?: string; name: string; birthday: EntityBirthday };
export const occasionOffsetLabel = (remaining: number): string => remaining === 0 ? "오늘" : remaining < 0 ? `${-remaining}일 전` : `D-${remaining}`;

/** Stored typed endings remain effective even when their anniversary row is hidden. */
export function milestoneBasis(memories: OccasionMemory[], pair: [string, string], anniversaries: Anniversary[]): Anniversary | null {
  const after = (left: string, right: string) => (compareParsedStoryTimes(parseStoryTime(left), parseStoryTime(right)) ?? 0) > 0;
  const endings = memories.filter(memory => memory.active !== false && memory.active !== 0).flatMap(memory =>
    (memory.landmarkKinds ?? []).filter(mark => arrayMatchesPair(mark.pair, { a: pair[0], b: pair[1] }))
      .map(mark => ({ kind: mark.kind, date: mark.storyTime ?? memoryStoryTime(memory) })));
  for (const [kind, end] of [["marriage", "divorce"], ["romantic_relationship_established", "romantic_relationship_ended"], ["first_met", ""]]) {
    const candidates = anniversaries.filter(item => item.kind === kind && item.storyTime);
    const selected = candidates.reduce<Anniversary | null>((found, item) => !found ||
      (kind === "first_met" ? after(found.storyTime!, item.storyTime!) : after(item.storyTime!, found.storyTime!)) ? item : found, null);
    if (selected && !endings.some(item => item.kind === end && item.date && after(item.date, selected.storyTime!))) return selected;
  }
  return null;
}

/** Pure calendar calculation shared by the final packet and dashboard. Bounds are inclusive. */
export function calculateOccasions(input: {
  asOf: string | null; memories?: OccasionMemory[]; birthdays?: OccasionBirthday[]; hidden?: string[];
  minOffset?: number; maxOffset?: number;
}): Occasion[] {
  const current = calendarDate(input.asOf);
  if (!current) return [];
  const yearless = current.year === undefined;
  const year = current.year ?? 2000;
  const today = utcDay(year, current.month!, current.day!);
  const min = input.minOffset ?? -3, max = input.maxOffset ?? 14;
  const result: Occasion[] = [];
  const add = (base: Omit<Occasion, "date" | "remaining" | "month" | "day">, day: number) => {
    const remaining = day - today;
    if (remaining < min || remaining > max) return;
    const date = new Date(displayDay(day, yearless) * DAY);
    result.push({ ...base, date: dateAt(day, yearless), remaining, month: date.getUTCMonth() + 1, day: date.getUTCDate() });
  };
  const yearly = (month: number, day: number, startYear: number | undefined, emit: (day: number, years?: number) => void) => {
    if (yearless) {
      // A yearless story has no asserted year or anniversary number; use the established 2000 cycle.
      for (let cycle = Math.floor(min / 366) - 1; cycle <= Math.ceil(max / 366) + 1; cycle++) emit(utcDay(2000, month, day) + cycle * 366);
      return;
    }
    for (let y = year + Math.floor(min / 366) - 1; y <= year + Math.ceil(max / 365) + 1; y++) {
      const candidate = utcDay(y, month, day);
      if (new Date(candidate * DAY).getUTCMonth() !== month - 1 || (startYear !== undefined && y <= startYear)) continue;
      emit(candidate, startYear === undefined ? undefined : y - startYear);
    }
  };
  for (const person of input.birthdays ?? []) yearly(person.birthday.month, person.birthday.day, undefined, day =>
    add({ key: `birthday:${person.key ?? person.name}`, kind: "birthday", person: person.name, label: `${person.name} 생일` }, day));
  const memories = input.memories ?? [];
  const pairs = new Map<string, [string, string]>();
  for (const memory of memories) for (const mark of memory.landmarkKinds ?? []) if (mark.pair) {
    pairs.set(mark.pair.map(normalizeName).sort().join("\0"), mark.pair);
  }
  for (const pair of pairs.values()) {
    const anniversaries = buildAnniversaries({ memories }, { a: pair[0], b: pair[1] }, input.hidden ?? []);
    const basis = milestoneBasis(memories, pair, anniversaries);
    for (const item of anniversaries) {
      const isBasisKind = ["first_met", "romantic_relationship_established", "marriage"].includes(item.kind);
      if (isBasisKind && item.hideKey !== basis?.hideKey) continue;
      const date = calendarDate(item.storyTime);
      if (!date) continue;
      const base = { key: item.hideKey, kind: "anniversary" as const, memoryId: item.memoryId, pair, label: item.label };
      yearly(date.month!, date.day!, date.year, (day, years) => {
        const label = item.userDefined || !isBasisKind || !years ? item.label
          : item.kind === "marriage" ? `결혼 ${years}주년` : item.kind === "first_met" ? `만난 지 ${years}년` : `연애 ${years}주년`;
        add({ ...base, label, years }, day);
      });
      // Unknown years cannot establish an elapsed 100-day count.
      if (item.hideKey === basis?.hideKey && !yearless && date.year !== undefined) {
        const start = utcDay(date.year, date.month!, date.day!);
        const first = Math.max(100, Math.ceil((today + min - start) / 100) * 100);
        for (let days = first; start + days <= today + max; days += 100) {
          const prefix = item.kind === "marriage" ? "결혼한 지" : item.kind === "first_met" ? "만난 지" : "사귄 지";
          add({ ...base, label: item.userDefined ? item.label : `${prefix} ${days}일`, days }, start + days);
        }
      }
    }
  }
  return result.sort((a, b) => Math.abs(a.remaining) - Math.abs(b.remaining) || b.remaining - a.remaining || a.key.localeCompare(b.key));
}

export type BirthdayPerson = { key?: string; name: string; names: string[]; birthday: EntityBirthday };

/** Stored for everyone; recurring occasion surfaces share the existing primary/persona policy. */
export function birthdayPeople(data: { entities?: Array<{ id?: string; name?: string; displayName?: string; internalName?: string; key?: string; aliases?: string[]; birthday?: unknown; setupProminence?: string; prominence?: string; tier?: string }>; personaEntity?: string | null }): BirthdayPerson[] {
  return (data.entities ?? []).flatMap(entity => {
    const names = [entity.name, entity.displayName, entity.internalName, entity.key, ...(entity.aliases ?? [])].map(normalizeName).filter(Boolean);
    if (!["primary", "major", "main"].includes(String(entity.setupProminence ?? entity.prominence ?? entity.tier ?? "supporting").toLocaleLowerCase()) && (!data.personaEntity || !names.includes(normalizeName(data.personaEntity)))) return [];
    const birthday = EntityBirthdaySchema.safeParse(entity.birthday);
    return birthday.success ? [{ key: entity.id ?? entity.key ?? entity.name, name: String(entity.displayName || entity.name), names, birthday: birthday.data }] : [];
  });
}

