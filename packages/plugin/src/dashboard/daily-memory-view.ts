import { holidayForStoryDate } from "./holidays.js";
import { holidayMark } from "./holiday-view.js";
import { parseStoryTime, formatStoryTime } from "@rcm/shared";
import { escapeHtml, btn, icon } from "./film/ui.js";
import { slugline } from "./film/scene.js";
import { relativePlayTime, type DailyMemory } from "./daily-memory.js";

/** The copy callback shares the timeline's title/dialogue/landmark translation keys. */
export function renderDailyMemory(pick: DailyMemory | null, skin: "film" | "phone", sceneNo: number,
  copy: (text: string, key: string) => string, now: Date): string {
  if (!pick) return "";
  const memory = pick.memory;
  const index = (memory.keyDialogues ?? []).findIndex((line: any) => String(line.text ?? "").trim());
  const dialogue = index < 0 ? null : memory.keyDialogues[index];
  const speaker = String(dialogue?.speaker ?? "");
  const line = dialogue ? copy(String(dialogue.text), `${memory.id}:dialogue:${index}`) : copy(String(memory.title), `${memory.id}:title`);
  const place = String(memory.locations?.[0] ?? memory.location ?? "");
  const storyTime = memory.story_time_normalized ?? memory.story_time ?? memory.storyTime ?? null;
  // Real play time only when the reason is a real-date anniversary; otherwise speak in the story's own clock,
  // so "63일 전" never sits next to a smaller story D+ and reads like a contradiction.
  const realDate = pick.reason === "year" || pick.reason === "month" || pick.reason === "week";
  const relative = realDate ? relativePlayTime(pick.playedAt, now) : undefined;
  const storyClock = typeof pick.storyDay === "number" ? (pick.storyDay > 0 ? `처음 만난 지 D+${pick.storyDay}` : pick.storyDay === 0 ? "처음 만난 날" : "")
    : (storyTime ? `이야기 속 ${formatStoryTime(storyTime)}` : "");
  const time = relative ?? storyClock;
  const primary = speaker || memory.participants?.[0] || "";
  // A curated card tone per scene (stable for that scene), not the people's colours: those vary too much to always sit well on the home.
  let toneHash = 2166136261;
  for (const char of String(memory.id ?? "")) toneHash = Math.imul(toneHash ^ char.codePointAt(0)!, 16777619) >>> 0;
  const style = skin === "phone" ? ` data-tone="${toneHash % 6}"` : "";
  const holiday = holidayForStoryDate(parseStoryTime(storyTime));
  const holidayTone = pick.reason === "holiday" && holiday ? ` data-holiday="${holiday.tone}"${holiday.id === "christmas" ? " data-holiday-gradient" : ""}` : "";
  const reason = pick.anniversary ? `${copy(pick.anniversary.label, pick.anniversary.key)} 그날` : escapeHtml(pick.label);
  // The whole card opens the scene: one stretched button keeps it a single keyboard stop with a real name.
  const open = `<button type="button" class="daily-memory__hit" data-action="open-timeline-memory" data-memory-id="${escapeHtml(String(memory.id))}" aria-label="${escapeHtml(`장면 열기 · S#${sceneNo}`)}"></button>`;
  return `<section class="daily-memory daily-memory--${skin}" aria-label="오늘의 추억">
    <div class="daily-memory__heading"><h2>오늘의 추억</h2>${btn("다른 추억 ›", { kind: "quiet", action: "next-daily-memory", hit: true })}</div>
    <article class="daily-memory__card"${style}>
      ${skin === "phone" ? `<div class="daily-memory__top"><div class="daily-memory__reason"${holidayTone}>${reason}</div>${holidayMark(holiday, skin)}${icon("chevron")}</div>` : `<div class="daily-memory__slate"><span>${escapeHtml(slugline(sceneNo, place || null, storyTime))}</span>${holiday ? holidayMark(holiday, skin) : `<span>${escapeHtml(time)}</span>`}</div>`}
      <div class="daily-memory__body"><blockquote>${dialogue ? `“${line}”` : line}</blockquote>${speaker ? `<p class="daily-memory__speaker">— ${escapeHtml(speaker)}</p>` : ""}</div>
      ${skin === "phone" ? `<div class="daily-memory__foot"><span class="daily-memory__meta">${escapeHtml([`S#${sceneNo}`, place].filter(Boolean).join(" · "))}</span><span>${escapeHtml(time)}</span></div>` : `<div class="daily-memory__credit credit">${escapeHtml(pick.credit)}</div><p class="daily-memory__caption">${reason}</p>`}
      ${open}
    </article>
  </section>`;
}
