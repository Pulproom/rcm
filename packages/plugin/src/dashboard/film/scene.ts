import { formatStoryTime, parseStoryTime } from "@rcm/shared";
import { lex } from "../lexicon.js";

export type DayPart = "낮" | "밤";

/** story_time is a product-owned model field, so parsing its documented clock formats is structural rather than RP prose inference. */
export function dayPart(storyTime: string | null): DayPart | null {
  const minute = parseStoryTime(storyTime).minute;
  if (minute === undefined) return null;
  const hour = Math.floor(minute / 60);
  return hour >= 6 && hour < 18 ? "낮" : "밤";
}

export function slugline(no: number, place: string | null, storyTime: string | null): string {
  return lex().slug(no, place, dayPart(storyTime));
}

/** Date-only credits use the same formatter as all other dashboard story times. */
export function sceneDate(storyTime: string | null): string | null {
  return storyTime ? formatStoryTime(storyTime, true) : null;
}
