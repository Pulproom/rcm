export type ParsedStoryTime = {
  raw: string;
  calendar: "numeric" | "era" | "partial" | "unknown";
  calendarKey?: string;
  year?: number;
  month?: number;
  day?: number;
  minute?: number;
  daypart?: string;
  daypartRank?: number;
  normalized?: string;
};

const DAYPARTS: Array<[RegExp, string, number]> = [
  [/이른\s*새벽|凌晨|\bearly\s+dawn\b/iu, "이른 새벽", 0.5], [/새벽|深夜|\bdawn\b/iu, "새벽", 1],
  [/이른\s*오전|早朝|早上|清晨|\bearly\s+morning\b/iu, "이른 오전", 1.5], [/늦은\s*오전|\blate\s+morning\b/iu, "늦은 오전", 2.5],
  [/오전|午前|上午|朝|\bmorning\b/iu, "오전", 2], [/정오|正午|中午|\bnoon\b/iu, "정오", 3],
  [/이른\s*오후|\bearly\s+afternoon\b/iu, "이른 오후", 3.5], [/늦은\s*오후|\blate\s+afternoon\b/iu, "늦은 오후", 4.5],
  [/오후|午後|下午|\bafternoon\b/iu, "오후", 4], [/해질녘|황혼|夕方|傍晚|\bdusk\b/iu, "해질녘", 5],
  [/이른\s*저녁|\bearly\s+evening\b/iu, "이른 저녁", 5.5], [/늦은\s*저녁|\blate\s+evening\b/iu, "늦은 저녁", 6.5],
  [/저녁|\bevening\b/iu, "저녁", 6], [/늦은\s*밤|\blate\s+night\b/iu, "늦은 밤", 7.5], [/밤|夜|晚上|\bnight\b/iu, "밤", 7], [/자정|午夜|\bmidnight\b/iu, "자정", 8],
];

const MONTHS = new Map<string, number>([
  ["january", 1], ["jan", 1], ["february", 2], ["feb", 2], ["march", 3], ["mar", 3],
  ["april", 4], ["apr", 4], ["may", 5], ["june", 6], ["jun", 6], ["july", 7], ["jul", 7],
  ["august", 8], ["aug", 8], ["september", 9], ["sep", 9], ["sept", 9], ["october", 10],
  ["oct", 10], ["november", 11], ["nov", 11], ["december", 12], ["dec", 12],
]);

const leapYear = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const validDate = (year: number | undefined, month: number | undefined, day: number | undefined): boolean => {
  if (year === undefined || year < 1 || year > 9999 || month === undefined || day === undefined || month < 1 || month > 12 || day < 1) return false;
  const days = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]!;
};
const validMonthDay = (month: number | undefined, day: number | undefined): boolean =>
  month !== undefined && day !== undefined && month >= 1 && month <= 12 && day >= 1 && day <= 31;
const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
const normalizedValue = (year: number, month: number, day: number, minute?: number): string =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}${minute === undefined ? "" : ` ${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`}`;

function parseClock(raw: string): { minute?: number; daypart?: string; daypartRank?: number } {
  const meridiemText = raw.replace(/\b([ap])\s*\.\s*m\s*\.?/giu, "$1m");
  const daypartMatch = DAYPARTS.find(([pattern]) => pattern.test(raw));
  const colon = meridiemText.match(/(?:\b(am|pm)\s*)?([01]?\d|2[0-3]):([0-5]\d)(?:\s*(am|pm)\b)?/iu);
  let minute: number | undefined;
  if (colon) {
    const marker = (colon[1] || colon[4] || "").toLocaleLowerCase();
    let hour = Number(colon[2]);
    if (marker) {
      if (hour < 1 || hour > 12) return {};
      hour = hour % 12 + (marker === "pm" ? 12 : 0);
    } else if (hour <= 12 && daypartMatch) {
      if (["오후", "이른 오후", "늦은 오후", "저녁", "이른 저녁", "늦은 저녁", "밤", "늦은 밤"].includes(daypartMatch[1]) && hour < 12) hour += 12;
      if (["오전", "이른 오전", "늦은 오전", "새벽", "이른 새벽"].includes(daypartMatch[1]) && hour === 12) hour = 0;
    }
    minute = hour * 60 + Number(colon[3]);
  } else {
    const localized = meridiemText.match(/(?:(오전|오후|午前|午後|上午|下午)\s*)?([01]?\d|2[0-3])\s*(?:시|時|时|点|點)(?:\s*([0-5]?\d)\s*분?)?(?:\s*(am|pm)\b)?/iu);
    if (localized) {
      let hour = Number(localized[2]);
      const marker = localized[1] || localized[4]?.toLocaleLowerCase();
      if ((marker === "오전" || marker === "午前" || marker === "上午" || marker === "am") && hour === 12) hour = 0;
      if ((marker === "오후" || marker === "午後" || marker === "下午" || marker === "pm") && hour < 12) hour += 12;
      minute = hour * 60 + Number(localized[3] ?? 0);
    }
  }
  return { minute, daypart: daypartMatch?.[1], daypartRank: daypartMatch?.[2] };
}

function parsedNumeric(raw: string, year: number, month: number, day: number, time: ReturnType<typeof parseClock>): ParsedStoryTime {
  if (!validDate(year, month, day)) return { raw, calendar: "unknown", ...time };
  return { raw, calendar: "numeric", calendarKey: "numeric", year, month, day, ...time, normalized: normalizedValue(year, month, day, time.minute) };
}

/** Parses structural status-panel forms owned by RCM, never relative prose. */
export function parseStoryTime(value: unknown): ParsedStoryTime {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { raw, calendar: "unknown" };
  const time = parseClock(raw);
  const searchable = raw.replace(/\([^)]{1,20}\)/gu, " ").replace(/\s+/gu, " ").trim();
  const unitDate = searchable.match(/(?:^|\s)(\d{1,4})\s*(?:년|年)\s*(\d{1,2})\s*(?:월|月)\s*(\d{1,2})\s*(?:일|日)?/u);
  if (unitDate) return parsedNumeric(raw, Number(unitDate[1]), Number(unitDate[2]), Number(unitDate[3]), time);
  const yearFirst = searchable.match(/(?:^|\s)(\d{1,4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?=\D|$)/u);
  if (yearFirst) return parsedNumeric(raw, Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]), time);
  const dayFirst = searchable.match(/(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s*,?\s*(\d{1,4})(?![\d:])/iu);
  const dayFirstMonth = dayFirst ? MONTHS.get(dayFirst[2]!.toLocaleLowerCase()) : undefined;
  if (dayFirst && dayFirstMonth) return parsedNumeric(raw, Number(dayFirst[3]), dayFirstMonth, Number(dayFirst[1]), time);
  const monthFirst = searchable.match(/(?:^|\s)([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{1,4})(?![\d:])/iu);
  const monthFirstMonth = monthFirst ? MONTHS.get(monthFirst[1]!.toLocaleLowerCase()) : undefined;
  if (monthFirst && monthFirstMonth) return parsedNumeric(raw, Number(monthFirst[3]), monthFirstMonth, Number(monthFirst[2]), time);
  const trailingYear = searchable.match(/(?:^|\s)(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,4})(?=\D|$)/u);
  if (trailingYear) {
    const first = Number(trailingYear[1]);
    const second = Number(trailingYear[2]);
    const [month, day] = first > 12 ? [second, first] : [first, second];
    return parsedNumeric(raw, Number(trailingYear[3]), month, day, time);
  }
  const monthDay = searchable.match(/(?:^|\s)(\d{1,2})\s*[-/.]\s*(\d{1,2})(?=\D|$)/u);
  const era = searchable.match(/^(.{1,40}?)\s+(\d{1,4})(?:년|年)(?:\s|$)/u);
  if (era && !/^\d+$/u.test(era[1]!.trim())) return {
    raw, calendar: "era", calendarKey: `era:${era[1]!.normalize("NFKC").trim().toLocaleLowerCase()}`, year: Number(era[2]),
    ...(validMonthDay(Number(monthDay?.[1]), Number(monthDay?.[2])) ? { month: Number(monthDay![1]), day: Number(monthDay![2]) } : {}), ...time,
  };
  const numericYear = searchable.match(/^(\d{1,4})(?:년|年)(?:\s|$)/u);
  if (numericYear) {
    const year = Number(numericYear[1]);
    const month = Number(monthDay?.[1]);
    const day = Number(monthDay?.[2]);
    if (validDate(year, month, day)) return parsedNumeric(raw, year, month, day, time);
    return { raw, calendar: "numeric", calendarKey: "numeric", year, ...time };
  }
  if (monthDay && validMonthDay(Number(monthDay[1]), Number(monthDay[2]))) return {
    raw, calendar: "partial", calendarKey: "partial", month: Number(monthDay[1]), day: Number(monthDay[2]), ...time,
  };
  return { raw, calendar: "unknown", ...time };
}

export const normalizeStoryTime = (value: unknown): string | undefined => parseStoryTime(value).normalized;

/** Only the product-owned STORY_TIME_GUIDANCE grammar: YYYY-MM-DD[ HH:mm],
 * optionally followed by ` ~ HH:mm` or a full end date/time. Never parse RP
 * prose or normalize natural-language dates for automatic relative labels. */
export function structuredStoryTimeEnd(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^(\d{4}-\d{2}-\d{2})(?: ([0-2]\d:[0-5]\d))?(?: ~ (?:(\d{4}-\d{2}-\d{2})(?: ([0-2]\d:[0-5]\d))?|([0-2]\d:[0-5]\d)))?$/u);
  if (!match) return undefined;
  const timestamp = (date: string, clock = "00:00"): number | undefined => {
    const [year, month, day] = date.split("-").map(Number);
    if (!validDate(year, month, day) || Number(clock.slice(0, 2)) > 23) return undefined;
    return Date.parse(`${date}T${clock}:00Z`);
  };
  const start = timestamp(match[1]!, match[2]);
  const end = timestamp(match[3] ?? match[1]!, match[3] ? match[4] : match[5] ?? match[2]);
  // A short end clock is same-day by contract; do not infer an overnight span.
  return start !== undefined && end !== undefined && end >= start ? end : undefined;
}

/** Returns null when two calendar systems cannot be compared safely. */
export function compareParsedStoryTimes(left: ParsedStoryTime, right: ParsedStoryTime): number | null {
  if (left.calendar === "unknown" || right.calendar === "unknown") return null;
  if (left.calendar !== right.calendar || left.calendarKey !== right.calendarKey) return null;
  for (const field of ["year", "month", "day"] as const) {
    const a = left[field]; const b = right[field];
    if (a === undefined || b === undefined) { if (a !== b) return a === undefined ? 1 : -1; continue; }
    if (a !== b) return a - b;
  }
  const aTime = left.minute ?? (left.daypartRank === undefined ? undefined : left.daypartRank * 180);
  const bTime = right.minute ?? (right.daypartRank === undefined ? undefined : right.daypartRank * 180);
  if (aTime === undefined || bTime === undefined) return aTime === bTime ? 0 : aTime === undefined ? 1 : -1;
  return aTime - bTime;
}

export const compareStoryTimes = (left: unknown, right: unknown): number | null => compareParsedStoryTimes(parseStoryTime(left), parseStoryTime(right));

/** Shared model guidance, not a schema restriction or stored-value rewrite. */
export const STORY_TIME_GUIDANCE = `STORY TIME
For storyTime, scheduledFor and other story date/time fields: when the source gives a calendar date/time, write YYYY-MM-DD HH:mm (date only: YYYY-MM-DD; span: YYYY-MM-DD HH:mm ~ HH:mm, or a full end date/time if the day changes). When no calendar date is given, keep the source's own wording (e.g. "late evening", "Year 123", an era or seasonal name). Never invent a date.`;

/** Dashboard presentation only. Omit years consistently without a chat-wide reference year.
 * Parse the existing structured story-time field; never infer dates from RP prose. */
export function formatStoryTime(value: unknown, dateOnly = false): string {
  const raw = typeof value === "string" ? value : "";
  const start = parseStoryTime(raw);
  if (!["numeric", "partial"].includes(start.calendar) || start.month === undefined || start.day === undefined) return raw;
  const date = (time: ParsedStoryTime): string => `${pad(time.month!)}.${pad(time.day!)}`;
  const clock = (time: ParsedStoryTime): string => time.minute === undefined ? "" : `${pad(Math.floor(time.minute / 60))}:${pad(time.minute % 60)}`;
  const point = (time: ParsedStoryTime): string => `${date(time)}${clock(time) ? ` ${clock(time)}` : ""}`;
  if (dateOnly) return date(start);
  // An ISO point's negative timezone offset is not a clock range.
  if (/^\d{1,4}-\d{1,2}-\d{1,2}T\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/iu.test(raw.trim())) return point(start);
  // Range punctuation belongs to the story-time field format. Date separators are never split.
  const range = raw.match(/^(.*?(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s*[ap]\s*\.?\s*m\.?)?)\s*(?:[~–—/\-]|\bto\b)\s*(.+)$/iu);
  if (!range) return point(start);
  let end = parseStoryTime(range[2]);
  const clockOnly = /^(?:[ap]\s*\.?\s*m\.?\s*)?(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s*[ap]\s*\.?\s*m\.?)?$/iu.test(range[2]!.trim());
  if (clockOnly && end.minute !== undefined) end = { ...start, ...parseClock(range[2]!), raw: range[2]! };
  if (!["numeric", "partial"].includes(end.calendar) || end.month === undefined || end.day === undefined || end.minute === undefined) return raw;
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
  return sameDay ? `${point(start)}–${clock(end)}` : `${point(start)} – ${point(end)}`;
}
