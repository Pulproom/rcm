/** Calendar presentation only: no prose, locale clock or scene content is consulted. */
export const STORY_HOLIDAYS = [
  { id: "newyear", month: 1, day: 1, emoji: "🎆", label: "새해", tone: "newyear" },
  { id: "valentine", month: 2, day: 14, emoji: "💝", label: "발렌타인데이", tone: "valentine" },
  { id: "white", month: 3, day: 14, emoji: "🍬", label: "화이트데이", tone: "white" },
  { id: "april-fools", month: 4, day: 1, emoji: "🃏", label: "만우절", tone: "april" },
  { id: "halloween", month: 10, day: 31, emoji: "🎃", label: "할로윈", tone: "halloween" },
  { id: "christmas-eve", month: 12, day: 24, emoji: "🎁", label: "크리스마스 이브", tone: "xmas" },
  { id: "christmas", month: 12, day: 25, emoji: "🎄", label: "크리스마스", tone: "xmas" },
  { id: "newyear-eve", month: 12, day: 31, emoji: "🎇", label: "한 해의 마지막 날", tone: "yearend" },
] as const;
export type StoryHoliday = typeof STORY_HOLIDAYS[number];

/** A small date/descriptor boundary also leaves future personal occasions out of the renderers. */
export function holidayForStoryDate(date: { month?: number; day?: number } | null | undefined): StoryHoliday | undefined {
  return STORY_HOLIDAYS.find(holiday => holiday.month === date?.month && holiday.day === date?.day);
}
