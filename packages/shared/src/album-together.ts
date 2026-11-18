import { z } from "zod";
import type { AlbumItem } from "./album.js";
import { compareParsedStoryTimes, parseStoryTime } from "./story-time.js";

export const ALBUM_TOGETHER_CARDS = ["first", "stories", "words", "two-times", "days", "hours", "streak", "quiz"] as const;
export type AlbumTogetherCardId = typeof ALBUM_TOGETHER_CARDS[number];
export const ALBUM_TOGETHER_DEFAULT_ON: ReadonlySet<AlbumTogetherCardId> = new Set(["first", "stories", "words", "two-times"]);
const count = z.number().int().nonnegative();
const quizSchema = z.object({ answered: count, correct: count, bestStreak: count });
export const AlbumTogetherRecordsSchema = z.object({
  asOf: z.number(), timeZone: z.string(), lastTurnAt: z.number().optional(), firstAt: z.number().optional(), dayNumber: count.optional(),
  stories: count, chars: count, books: count, storyDays: count.optional(), realSpan: z.string().optional(),
  days: z.array(z.tuple([z.string(), count])).optional(), topDay: z.object({ date: z.string(), turns: count }).optional(),
  hours: z.array(count).length(24).optional(), peakHour: count.max(23).optional(),
  longest: z.object({ startAt: z.number(), minutes: z.number().nonnegative(), turns: count }).optional(),
  streak: z.object({ days: count, from: z.string(), to: z.string() }).optional(), quiz: quizSchema.optional(),
});
export type AlbumTogetherRecords = z.infer<typeof AlbumTogetherRecordsSchema>;
export interface TogetherMessage { ordinal: number; role: "user" | "assistant"; time?: number; chars: number; turn?: number }
const DAY = 86_400_000;
const dayStamp = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function summarizeTogether(input: {
  messages: TogetherMessage[]; quiz?: AlbumTogetherRecords["quiz"]; storyPeriod?: { from?: string; to?: string }; timeZone: string; now: number;
}): AlbumTogetherRecords {
  const firstUser = input.messages.reduce((first, m) => m.role === "user" ? Math.min(first, m.ordinal) : first, Infinity);
  const messages = input.messages.filter(m => m.role !== "assistant" || m.ordinal >= firstUser).sort((a, b) => a.ordinal - b.ordinal);
  const chars = messages.reduce((sum, m) => sum + m.chars, 0);
  const records: AlbumTogetherRecords = { asOf: input.now, timeZone: input.timeZone,
    stories: new Set(messages.flatMap(m => m.turn === undefined ? [] : [m.turn])).size, chars, books: Math.floor(chars / 250_000) };
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const local = (time: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(time).map(p => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  };
  const today = local(input.now).date;
  const firstAt = messages[0]?.time;
  if (firstAt !== undefined) {
    records.firstAt = firstAt;
    const start = local(firstAt).date;
    const elapsedDays = Math.max(0, Math.round((dayStamp(today) - dayStamp(start)) / DAY));
    records.dayNumber = elapsedDays + 1;
    const [sy, sm, sd] = start.split("-").map(Number) as [number, number, number];
    const [ey, em, ed] = today.split("-").map(Number) as [number, number, number];
    const months = Math.max(0, (ey - sy) * 12 + em - sm - Number(ed < sd));
    records.realSpan = months < 1 ? `${elapsedDays}일` : months < 12 ? `${months}개월` : `${Math.floor(months / 12)}년${months % 12 ? ` ${months % 12}개월` : ""}`;
  }
  const from = parseStoryTime(input.storyPeriod?.from), to = parseStoryTime(input.storyPeriod?.to);
  if (from.calendar === "numeric" && to.calendar === "numeric" && from.normalized && to.normalized && (compareParsedStoryTimes(from, to) ?? 1) <= 0) {
    records.storyDays = Math.round((dayStamp(to.normalized.slice(0, 10)) - dayStamp(from.normalized.slice(0, 10))) / DAY) + 1;
  }
  const timed = messages.filter((m): m is TogetherMessage & { time: number } => m.time !== undefined).sort((a, b) => a.time - b.time || a.ordinal - b.ordinal);
  const turnTimes = new Map<number, number>();
  for (const m of timed) if (m.turn !== undefined) turnTimes.set(m.turn, m.time);
  const days = new Map<string, number>(), hours = Array<number>(24).fill(0);
  for (const time of turnTimes.values()) {
    const { date, hour } = local(time);
    days.set(date, (days.get(date) ?? 0) + 1); hours[hour]!++;
    records.lastTurnAt = Math.max(records.lastTurnAt ?? time, time);
  }
  const allDays = [...days].sort(([a], [b]) => a.localeCompare(b));
  if (allDays.length) {
    const cutoff = new Date(dayStamp(today)); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
    records.days = allDays.filter(([date]) => date >= cutoff.toISOString().slice(0, 10) && date <= today);
    const top = records.days.reduce<[string, number] | undefined>((best, day) => !best || day[1] > best[1] ? day : best, undefined);
    if (top) records.topDay = { date: top[0], turns: top[1] };
    records.hours = hours; records.peakHour = hours.indexOf(Math.max(...hours));
    let start = allDays[0]![0], previous = start, length = 0;
    for (const [date] of allDays) {
      if (dayStamp(date) - dayStamp(previous) > DAY) { start = date; length = 0; }
      length++;
      if (length > (records.streak?.days ?? 0)) records.streak = { days: length, from: start, to: date };
      previous = date;
    }
  }
  let session: typeof timed = [];
  const finish = () => {
    if (!session.length) return;
    const minutes = (session.at(-1)!.time - session[0]!.time) / 60_000;
    if (!records.longest || minutes > records.longest.minutes) records.longest = { startAt: session[0]!.time, minutes,
      turns: new Set(session.flatMap(m => m.turn === undefined ? [] : [m.turn])).size };
  };
  for (const message of timed) {
    if (session.length && message.time - session.at(-1)!.time > 30 * 60_000) { finish(); session = []; }
    session.push(message);
  }
  finish();
  if (input.quiz && input.quiz.answered > 0) records.quiz = { ...input.quiz };
  return records;
}

export function availableTogetherCards(r: AlbumTogetherRecords): AlbumTogetherCardId[] {
  return ALBUM_TOGETHER_CARDS.filter(card => {
    switch (card) {
      case "first": return r.firstAt !== undefined && r.dayNumber !== undefined;
      case "stories": return r.stories > 0;
      case "words": return r.chars > 0;
      case "two-times": return r.storyDays !== undefined && r.realSpan !== undefined;
      case "days": return Boolean(r.days?.length);
      case "hours": return r.peakHour !== undefined && Boolean(r.hours?.some(n => n > 0));
      case "streak": return Boolean(r.longest || r.streak);
      case "quiz": return Boolean(r.quiz?.answered);
    }
  });
}
export function albumTogetherItems(r: AlbumTogetherRecords): AlbumItem[] {
  return availableTogetherCards(r).map(id => ({ id, hidden: !ALBUM_TOGETHER_DEFAULT_ON.has(id), fields: {}, edited: {}, photos: [] }));
}
