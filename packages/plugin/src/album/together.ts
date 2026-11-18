import { availableTogetherCards, type AlbumBlock, type AlbumTogetherCardId, type AlbumTogetherRecords } from "@rcm/shared";

export const TOGETHER_LABELS: Record<AlbumTogetherCardId, string> = {
  first: "처음 대화한 날", stories: "주고받은 이야기", words: "함께 쓴 글", "two-times": "두 개의 시간",
  days: "만난 날들", hours: "주로 만난 시간", streak: "연속 기록", quiz: "기억 퀴즈",
};
export const togetherNumber = (n: number) => n.toLocaleString("ko-KR");
export const togetherDay = (date: string, year = false) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${year ? `${y}. ` : ""}${m}. ${d}.`;
};
export function togetherLocal(records: AlbumTogetherRecords, time: number): { date: string; hour: number; minute: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: records.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(time).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}
export const togetherAsOf = (r: AlbumTogetherRecords) => `${togetherDay(togetherLocal(r, r.asOf).date)} 기준`;
export const togetherHour = (hour: number) => `${hour < 6 ? "새벽" : hour < 12 ? "아침" : hour < 18 ? "낮" : "밤"} ${hour % 12 || (hour ? 12 : 0)}시`;
export const togetherChars = (chars: number) => chars < 10_000 ? `${togetherNumber(chars)}자` : `약 ${togetherNumber(Math.round(chars / 10_000))}만 자`;
const books = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
export function togetherCardText(r: AlbumTogetherRecords, card: AlbumTogetherCardId): { label: string; value: string; note: string } {
  let value = "", note = "";
  switch (card) {
    case "first": value = r.firstAt === undefined ? "" : togetherDay(togetherLocal(r, r.firstAt).date, true); note = `${togetherNumber(r.dayNumber ?? 0)}일째`; break;
    case "stories": value = `${togetherNumber(r.stories)}번`; break;
    case "words": value = togetherChars(r.chars); note = r.books ? `소설책 ${r.books <= 10 ? `${books[r.books]} 권` : `${togetherNumber(r.books)}권`}쯤` : ""; break;
    case "two-times": value = `이야기 속 ${togetherNumber(r.storyDays ?? 0)}일을, 현실에서 ${r.realSpan ?? ""} 동안`; break;
    case "days": value = "날마다 칠한 달력"; if (r.topDay) note = `가장 많이 만난 날 ${togetherDay(r.topDay.date)} · ${togetherNumber(r.topDay.turns)}번`; break;
    case "hours": value = `주로 ${togetherHour(r.peakHour ?? 0)}쯤 만났어요`; break;
    case "streak": value = "가장 긴 대화 · 매일 만난 날"; break;
    case "quiz": if (r.quiz) { value = `${togetherNumber(r.quiz.answered)}문제 중 ${togetherNumber(r.quiz.correct)}개 맞힘`; note = `틀린 문제 ${togetherNumber(r.quiz.answered - r.quiz.correct)}개 · 최고 연속 정답 ${togetherNumber(r.quiz.bestStreak)}개`; } break;
  }
  return { label: TOGETHER_LABELS[card], value, note };
}
export function togetherStreakRows(r: AlbumTogetherRecords): Array<{ label: string; lead: string; value: string; note: string }> {
  const rows = [];
  if (r.longest) {
    const start = togetherLocal(r, r.longest.startAt), minutes = Math.floor(r.longest.minutes);
    const duration = [minutes >= 60 ? `${Math.floor(minutes / 60)}시간` : "", minutes % 60 || minutes < 60 ? `${minutes % 60}분` : ""].filter(Boolean).join(" ");
    const lead = togetherDay(start.date);
    rows.push({ label: "가장 긴 대화", lead, value: `${lead} ${togetherHour(start.hour)}${start.minute ? ` ${start.minute}분` : ""}부터 ${duration}`, note: `쉬지 않고 ${togetherNumber(r.longest.turns)}번` });
  }
  if (r.streak) rows.push({ label: "매일 만난 날", lead: `${togetherNumber(r.streak.days)}일`, value: `${togetherNumber(r.streak.days)}일 연속`, note: `${togetherDay(r.streak.from)} – ${togetherDay(r.streak.to)}` });
  return rows;
}
export function visibleTogetherCards(block: AlbumBlock): AlbumTogetherCardId[] {
  const available = new Set(block.together ? availableTogetherCards(block.together) : []);
  return block.items.filter(i => !i.hidden && available.has(i.id as AlbumTogetherCardId)).map(i => i.id as AlbumTogetherCardId);
}
