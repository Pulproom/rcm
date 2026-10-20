import { escapeHtml } from "./film/ui.js";
import type { StoryHoliday } from "./holidays.js";

export function holidayMark(holiday: StoryHoliday | undefined, skin: "phone" | "film", prefix = ""): string {
  if (!holiday) return "";
  return skin === "phone"
    ? `<span class="holiday-pill" data-holiday="${holiday.tone}"><span aria-hidden="true">${holiday.emoji}</span>${escapeHtml(holiday.label)}</span>`
    : `<span class="holiday-credit credit" data-holiday="${holiday.tone}">${prefix}${escapeHtml(holiday.credit)}</span>`;
}

export function holidayDateCredit(holiday: StoryHoliday): string {
  return `${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][holiday.month - 1]} ${holiday.day}`;
}

/** Shared occasion tokens, with opaque pill fills so contrast holds on glass as well as lists. */
export const HOLIDAY_CSS = `
[data-holiday="xmas"] { --holiday-bg: #153d25; --holiday-ink: #6ee08f; --holiday-film: #8fbf9a; }
[data-holiday="halloween"] { --holiday-bg: #48320d; --holiday-ink: #ffb547; --holiday-film: #e0924a; }
[data-holiday="valentine"] { --holiday-bg: #4a1d2b; --holiday-ink: #ff7a97; --holiday-film: #e07a90; }
[data-holiday="newyear"] { --holiday-bg: #282747; --holiday-ink: #a5a3ff; --holiday-film: #b2aedb; }
[data-holiday="white"] { --holiday-bg: #183b40; --holiday-ink: #7fdceb; --holiday-film: #9bc4cd; }
[data-holiday="april"] { --holiday-bg: #372747; --holiday-ink: #d1a8ef; --holiday-film: #c3a9cf; }
[data-holiday="yearend"] { --holiday-bg: #403313; --holiday-ink: #e8c76e; --holiday-film: #d4bb80; }
:root[data-theme^="day"] [data-holiday="xmas"] { --holiday-bg: #e3f4e8; --holiday-ink: #1e7a3c; --holiday-film: #356b43; }
:root[data-theme^="day"] [data-holiday="halloween"] { --holiday-bg: #ffebd6; --holiday-ink: #a45100; --holiday-film: #98501a; }
:root[data-theme^="day"] [data-holiday="valentine"] { --holiday-bg: #ffe3ea; --holiday-ink: #c2185b; --holiday-film: #a13b59; }
:root[data-theme^="day"] [data-holiday="newyear"] { --holiday-bg: #e6e9ff; --holiday-ink: #3f3bc9; --holiday-film: #56518d; }
:root[data-theme^="day"] [data-holiday="white"] { --holiday-bg: #e8f3fa; --holiday-ink: #1f6e94; --holiday-film: #326778; }
:root[data-theme^="day"] [data-holiday="april"] { --holiday-bg: #f1e6fa; --holiday-ink: #754397; --holiday-film: #72517f; }
:root[data-theme^="day"] [data-holiday="yearend"] { --holiday-bg: #faf0d8; --holiday-ink: #79601d; --holiday-film: #766027; }
.holiday-pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px; border-radius: 999px; background: var(--holiday-bg); color: var(--holiday-ink); font-size: var(--t-cap, var(--t-micro)); line-height: 1.2; font-weight: 600; white-space: nowrap; }
.holiday-credit { color: var(--holiday-film); }
.day:has(.holiday-pill), .day:has(.holiday-credit) { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
:root[data-skin="film"] .day:has(.holiday-credit) { font-family: var(--credit); font-size: var(--t-credit); letter-spacing: .12em; }
.daily-memory--phone .daily-memory__top:has(.holiday-pill) { justify-content: flex-start; gap: 6px; }
.daily-memory__top:has(.holiday-pill) > .i { margin-left: auto; }
.daily-memory__top:has(.holiday-pill) { flex-wrap: wrap; }
.daily-memory__top > .holiday-pill { flex: 0 0 auto; }
.daily-memory--phone .daily-memory__top:has(.holiday-pill) { align-items: center; }
.daily-memory--phone .daily-memory__top:has(.holiday-pill) > .i { margin-top: 0; }
.daily-memory--phone .daily-memory__top > .holiday-pill { gap: 5px; padding: 6px 12px; border-radius: 14px; font-size: var(--t-cap); line-height: 1.2; }
.daily-memory--phone .daily-memory__top > .holiday-pill > [aria-hidden] { font-size: 1em; line-height: 1; }
.daily-memory--phone .daily-memory__reason[data-holiday] { background: var(--holiday-bg); color: var(--holiday-ink); }
.daily-memory--phone .daily-memory__reason[data-holiday-gradient] { background: linear-gradient(135deg, #237b42, #ba303e); color: #fff; }
`;
