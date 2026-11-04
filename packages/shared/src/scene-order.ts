import { isRecognitionMemory } from "./memory-origin.js";
import { parseStoryTime } from "./story-time.js";

/**
 * Decide precision for the entire day before sorting. Pairwise clock/source
 * fallback is not transitive when a date-only scene sits between timed scenes.
 * Pass the full context when ordering a filtered view so S# stays consistent.
 */
export function orderStoryMemories<T>(memories: T[], context: readonly any[] = memories): T[] {
  const number = (value: unknown): number => value == null || value === "" || !Number.isFinite(Number(value)) ? Number.MAX_SAFE_INTEGER : Number(value);
  const describe = (memory: any) => {
    const raw = String(memory?.story_time ?? memory?.storyTime ?? "").trim();
    const time = parseStoryTime(raw || String(memory?.story_time_normalized ?? memory?.storyTimeNormalized ?? ""));
    const date = [number(time.year), number(time.month), number(time.day)];
    const calendar = time.calendar === "unknown" ? "~unknown" : `${time.calendar}:${time.calendarKey ?? ""}`;
    return { memory, time, date, calendar, day: JSON.stringify([calendar, ...date]) };
  };
  const descriptions = context.map(describe);
  const precision = (item: ReturnType<typeof describe>) => item.time.minute !== undefined ? "clock" : item.time.daypartRank !== undefined ? "daypart" : "date";
  const dayPrecision = new Map<string, string>();
  for (const item of descriptions) {
    const current = dayPrecision.get(item.day), incoming = precision(item);
    dayPrecision.set(item.day, current && current !== incoming ? "mixed" : incoming);
  }
  return memories.map(describe).sort((a, b) => {
    const byDate = Number(a.time.calendar === "unknown") - Number(b.time.calendar === "unknown")
      || a.calendar.localeCompare(b.calendar) || a.date[0]! - b.date[0]! || a.date[1]! - b.date[1]! || a.date[2]! - b.date[2]!;
    if (byDate) return byDate;
    const mode = dayPrecision.get(a.day);
    const byClock = mode === "clock" ? number(a.time.minute) - number(b.time.minute)
      : mode === "daypart" ? number(a.time.daypartRank) - number(b.time.daypartRank) : 0;
    const left: any = a.memory, right: any = b.memory;
    return byClock || number(left?.source_ordinal ?? left?.sourceOrdinal) - number(right?.source_ordinal ?? right?.sourceOrdinal)
      || number(left?.created_revision ?? left?.updated_revision ?? left?.updated_at) - number(right?.created_revision ?? right?.updated_revision ?? right?.updated_at)
      || String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
  }).map(item => item.memory);
}

/** A scene is an episode memory; capsule children and standalone recognition are not scenes. */
export const isScene = (memory: any): boolean =>
  Boolean(memory) && memory.type === "episode" && !memory.capsule_parent_id && !isRecognitionMemory(memory);

/** Scenes in story order. */
export const storyScenes = (memories: any[]): any[] => orderStoryMemories(memories.filter(isScene));

/** Chronological scene numbers (S#n), stable across screens. */
export function sceneNumbers(memories: any[]): Map<string, number> {
  return new Map(storyScenes(memories).map((memory, index) => [String(memory.id), index + 1]));
}
