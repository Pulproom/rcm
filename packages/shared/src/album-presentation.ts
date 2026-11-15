import type { AlbumDocument, AlbumItem } from "./album.js";
import { parseStoryTime } from "./story-time.js";

/** Product-owned status enum, not a classification of prose. */
export function albumPromiseStatus(value?: string): "kept" | "broken" | "pending" {
  return value === "kept" ? "kept" : value === "broken" ? "broken" : "pending";
}
export const albumStatusLabel = (value?: string): string => ({ kept: "지킴", broken: "깨짐", pending: "진행 중" })[albumPromiseStatus(value)];
export const albumLine = (item: AlbumItem): string => item.fields.text ?? item.fields.body ?? "";
/** One cover selection for the reader and shelf; only exact, trimmed speaker names qualify. */
export function albumCoverQuote(doc: AlbumDocument): AlbumItem | undefined {
  if (doc.coverLineId !== undefined) {
    if (!doc.coverLineId) return;
    const find = (items: AlbumItem[]): AlbumItem | undefined => {
      for (const item of items) { if (item.id === doc.coverLineId) return item; const child = find(item.children ?? []); if (child) return child; }
    };
    return find(doc.blocks.flatMap(b => b.items)) ?? (doc.coverLine?.id === doc.coverLineId ? doc.coverLine : undefined);
  }
  const walk = (items: AlbumItem[]): AlbumItem[] => items.filter(i => !i.hidden).flatMap(i => [i, ...walk(i.children ?? [])]);
  const lines = doc.blocks.filter(b => !b.hidden && (b.kind === "quotes" || b.kind === "story"))
    .flatMap(b => walk(b.items)).filter(i => i.fields.speaker && albumLine(i).trim());
  return preferredAlbumLine(lines, doc.people);
}
export function preferredAlbumLine<T extends AlbumItem>(lines: readonly T[], people: AlbumDocument["people"]): T | undefined {
  const names = new Set([people.me.name.trim(), people.partner.name.trim()].filter(Boolean));
  const visible = lines.filter(i => !i.hidden && albumLine(i).trim());
  const own = visible.filter(i => names.has(i.fields.speaker?.trim() ?? ""));
  return [...(own.length ? own : visible)].sort((a, b) => [...albumLine(a).trim()].length - [...albumLine(b).trim()].length)[0];
}
/** Distinct display lines, shortest suitable (8+ code points) first. Original items are retained. */
export function shortestAlbumLines<T extends AlbumItem>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const line = albumLine(item).trim();
    if (!line || seen.has(line)) return false;
    seen.add(line); return true;
  }).sort((a, b) => Number([...albumLine(a)].length < 8) - Number([...albumLine(b)].length < 8)
    || [...albumLine(a)].length - [...albumLine(b)].length);
}
/** Hangul final-consonant arithmetic only. Non-Hangul uses the vowel form. */
export function albumParticle(name: string, consonant: string, vowel: string): string {
  if (!name) return "";
  const last = name.charCodeAt(name.length - 1);
  return name + (last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? consonant : vowel);
}
export function albumDisplayDate(value?: string): string {
  if (!value || value === "undefined") return "";
  const date = parseStoryTime(value);
  return date.calendar === "numeric" && date.month !== undefined && date.day !== undefined
    ? `${date.year}. ${date.month}. ${date.day}.` : value;
}
export function albumDisplayPeriod(value?: string): string {
  return [...new Set((value ?? "").split(/\s+[—–-]\s+/u).map(albumDisplayDate).filter(Boolean))].join(" – ");
}
export function albumPlaces(items: readonly AlbumItem[]): string[] {
  return [...new Set(items.map(item => item.fields.location?.split(",")[0]?.trim()).filter((v): v is string => Boolean(v)))].slice(0, 3);
}
/** One album-wide calendar policy; stored fields are never rewritten. */
export function albumDateFormat(period?: string) {
  const parts = (period ?? "").split(/\s+[—–-]\s+/u);
  const parsed = parts.map(parseStoryTime);
  const sameYear = parsed.length > 0 && parsed.every(d => d.calendar === "numeric" && d.month !== undefined && d.day !== undefined && d.year === parsed[0]!.year);
  const format = (value: string | undefined, short: boolean): string => {
    if (!value || value === "undefined") return "";
    const d = parseStoryTime(value);
    return d.calendar === "numeric" && d.month !== undefined && d.day !== undefined
      ? `${short ? "" : `${d.year}. `}${d.month}. ${d.day}.` : value;
  };
  const span = (value?: string) => [...new Set((value ?? "").split(/\s+[—–-]\s+/u).map(v => format(v, sameYear)).filter(Boolean))].join(" – ");
  const unique = [...new Set(parts.map(albumDisplayDate).filter(Boolean))];
  return { date: (value?: string) => format(value, sameYear), span,
    header: unique.map((v, n) => format(v, sameYear && n > 0)).join(" – ") };
}
const calendarDate = (value?: string) => {
  const d = parseStoryTime(value);
  return d.calendar === "numeric" && d.year !== undefined && d.month !== undefined && d.day !== undefined ? d : undefined;
};
/** Reading-form day ("5월 12일"); text that is not a numeric calendar date is kept as stored. */
export function albumDay(value?: string): string {
  if (!value || value === "undefined") return "";
  const d = calendarDate(value);
  return d ? `${d.month}월 ${d.day}일` : value;
}
/** Dotted reading day; non-calendar text remains unboxed and unchanged. */
export function albumDayDots(value?: string): string {
  if (!value || value === "undefined") return "";
  const d = calendarDate(value);
  return d ? `${d.month}. ${d.day}.` : value;
}
/** Reading-form clock ("오전 11:45"), empty when the value carries no clock. */
export function albumClock(value?: string): string {
  const d = calendarDate(value);
  if (d?.minute === undefined) return "";
  const hour = Math.floor(d.minute / 60), minute = String(d.minute % 60).padStart(2, "0");
  return `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${minute}`;
}
/** Reading-form 24-hour clock ("11:45"), with the same calendar policy as albumClock. */
export function albumClock24(value?: string): string {
  const d = calendarDate(value);
  if (d?.minute === undefined) return "";
  return `${String(Math.floor(d.minute / 60)).padStart(2, "0")}:${String(d.minute % 60).padStart(2, "0")}`;
}
/** A promise date is shown only when it is a real calendar day. */
export const albumPromiseDay = (value?: string): string => calendarDate(value) ? albumDay(value) : "";
/** "2025년 5월 12일 – 18일" plus the inclusive day count; unreadable periods keep their stored text. */
export function albumPeriod(period?: string): { text: string; days: number } {
  const parts = [...new Set((period ?? "").split(/\s+[—–-]\s+/u).map(part => part.trim()).filter(Boolean))];
  const [a, b] = parts.map(calendarDate);
  if (!a || parts.length > 2 || (parts.length === 2 && !b)) return { text: parts.join(" – "), days: 0 };
  const first = `${a.year}년 ${a.month}월 ${a.day}일`;
  if (!b) return { text: first, days: 1 };
  const last = `${b.year === a.year ? "" : `${b.year}년 `}${b.year === a.year && b.month === a.month ? "" : `${b.month}월 `}${b.day}일`;
  const days = Math.round((Date.UTC(b.year!, b.month! - 1, b.day!) - Date.UTC(a.year!, a.month! - 1, a.day!)) / 86_400_000) + 1;
  return { text: `${first} – ${last}`, days: Math.max(1, days) };
}
/** Dotted pamphlet period, using the same calendar and abbreviation rules as albumPeriod. */
export function albumPeriodDots(period?: string): string {
  const parts = [...new Set((period ?? "").split(/\s+[—–-]\s+/u).map(part => part.trim()).filter(Boolean))];
  const [a, b] = parts.map(calendarDate);
  if (!a || parts.length > 2 || (parts.length === 2 && !b)) return albumPeriod(period).text;
  const first = `${a.year}. ${a.month}. ${a.day}.`;
  if (!b) return first;
  return `${first} – ${b.year === a.year ? "" : `${b.year}. `}${b.year === a.year && b.month === a.month ? "" : `${b.month}. `}${b.day}.`;
}
/** Punctuation only; short openers join forward, short tails join back, at most three display lines. */
export function albumLyricLines(text: string): string[] {
  const parts = text.split(/(?<=[,.?!…])\s+/u).filter(Boolean);
  for (let n = 0; n < parts.length - 1;) {
    if ([...parts[n]!].length < 7) parts.splice(n, 2, `${parts[n]} ${parts[n + 1]}`);
    else n++;
  }
  const result = parts.reduce<string[]>((lines, part) => {
    if ([...part].length < 6 && lines.length) lines[lines.length - 1] += ` ${part}`;
    else lines.push(part);
    return lines;
  }, []);
  while (result.length > 3) result.splice(result.length - 2, 2, result.slice(-2).join(" "));
  return result;
}

export function albumDateOnly(value: string): string {
  const date = parseStoryTime(value);
  return date.calendar === "numeric" && date.year !== undefined && date.month !== undefined && date.day !== undefined
    ? `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}` : value;
}
