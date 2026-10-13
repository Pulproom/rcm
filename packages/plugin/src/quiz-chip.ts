import { quizDateLabel, type QuizAnswerResponse, type QuizNextResponse, type QuizQuestion, type QuizStats } from "@rcm/shared";
import type { ChipSkin } from "./attention.js";

/** What the chip shows while the quiz is open. `index`/`total` count this sitting: answered so far plus what remains. */
export type QuizView =
  | { mode: "question"; question: QuizQuestion; stats: QuizStats; index: number; total: number }
  | { mode: "result"; question: QuizQuestion; answer: QuizAnswerResponse; index: number; total: number }
  | { mode: "done"; stats: QuizStats }
  | { mode: "error"; message: string };

const DIFFICULTY_LABEL = { easy: "쉬움", medium: "보통", hard: "어려움" } as const;

const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const tint = (color: string, amount: number): string => `color-mix(in srgb, ${color} ${amount}%, transparent)`;

export { quizDateLabel } from "@rcm/shared";

const buttonBase = (skin: ChipSkin): string =>
  `box-sizing:border-box;width:100%;min-height:36px;margin-top:6px;padding:8px 12px;border:0;border-radius:${skin.buttonRadius};font-family:inherit;font-size:13px;font-weight:600;line-height:1.4;cursor:pointer;text-align:${skin.buttonAlign}`;
const primaryButton = (skin: ChipSkin): string => `${buttonBase(skin)};background:${skin.accent};color:${skin.accentInk}`;
const quietButton = (skin: ChipSkin): string => `${buttonBase(skin)};background:${skin.button};color:${skin.ink}`;

/** Quiz action or preparation guidance above 대시보드 열기; hidden when unavailable or off. */
export function quizEntryButton(next: QuizNextResponse | undefined, skin: ChipSkin, waiting: boolean): string {
  if (!next?.enabled) return "";
  if (!next.available || !next.question) return `<p role="status" style="margin:8px 0 0;font-size:12px;line-height:1.5;color:${skin.ink3};overflow-wrap:anywhere">${next.generating ? "새 퀴즈를 만들고 있어요." : "다음 장면이 쌓이거나 지난 장면이 다시 열리면 새 퀴즈가 생겨요."}</p>`;
  const count = next.remaining > 0 ? next.remaining : 1;
  const centred = skin.buttonAlign === "center";
  const layout = centred ? "display:block" : "display:flex;justify-content:space-between;align-items:baseline;gap:8px";
  return `<button type="button" data-rcm-quiz-start="true" data-waiting="${waiting}" style="${primaryButton(skin)};${layout}">퀴즈 풀기<span style="font-weight:500;opacity:.82">${centred ? " · " : ""}${count}문제${centred ? "" : " 남음"}</span></button>`;
}

/** Shown in place of the entry button when the quiz could not be loaded. */
export function quizReloadRow(skin: ChipSkin): string {
  return `<div style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:${skin.ink3}"><span style="flex:1">퀴즈를 불러오지 못했어요.</span><button type="button" data-rcm-quiz-reload="true" style="min-height:28px;padding:4px 10px;border:0;border-radius:${skin.buttonRadius};background:${skin.button};color:${skin.ink};font-family:inherit;font-size:12px;font-weight:600;cursor:pointer">다시 시도</button></div>`;
}

const header = (skin: ChipSkin, title: string, streak?: number): string =>
  `<div style="display:flex;align-items:center;gap:8px;margin:-2px 0 10px"><strong style="flex:1;font-size:13px;font-weight:600;color:${skin.ink}">${escapeHtml(title)}</strong>${streak ? `<span style="font-size:12px;color:${skin.ink3};font-variant-numeric:tabular-nums">🔥 ${streak}</span>` : ""}<button type="button" data-rcm-quiz-close="true" aria-label="퀴즈 닫기" style="display:grid;place-items:center;width:28px;height:28px;margin-right:-6px;border:0;border-radius:${skin.buttonRadius};background:transparent;color:${skin.ink3};font:inherit;font-size:16px;line-height:1;cursor:pointer">×</button></div>`;

const difficultyTag = (skin: ChipSkin, question: QuizQuestion): string => {
  const color = question.difficulty === "easy" ? skin.ok : question.difficulty === "hard" ? skin.cut : skin.accent;
  const date = quizDateLabel(question.storyTime);
  // A question missed earlier comes back marked, so the second try reads as a second chance rather than a repeat.
  const retry = question.retry ? `<span style="padding:1px 6px;border-radius:9px;border:1px solid ${tint(skin.cut, 45)};font-weight:600;color:${skin.ink2}">다시 풀기</span>` : "";
  return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;color:${skin.ink3}">${retry}<span style="padding:2px 7px;border-radius:9px;font-weight:600;background:${tint(color, 20)};color:${skin.ink2}">${DIFFICULTY_LABEL[question.difficulty]}</span>${date ? `<span>${escapeHtml(date)}</span>` : ""}</div>`;
};

const questionText = (skin: ChipSkin, question: QuizQuestion): string =>
  `<p style="margin:8px 0 4px;font-size:15px;font-weight:600;line-height:1.45;color:${skin.ink};word-break:keep-all;overflow-wrap:anywhere">${escapeHtml(question.question)}</p>`;

type OptionState = "idle" | "right" | "wrong" | "dim";
const optionButton = (skin: ChipSkin, question: QuizQuestion, index: number, state: OptionState, interactive: boolean): string => {
  const ox = question.format === "ox";
  const border = state === "right" ? skin.ok : state === "wrong" ? skin.cut : skin.rule;
  const background = state === "right" ? tint(skin.ok, 16) : state === "wrong" ? tint(skin.cut, 14) : "transparent";
  const opacity = state === "dim" ? ";opacity:.55" : "";
  const action = interactive ? ` data-rcm-quiz-option="${index}"` : ` aria-disabled="true"`;
  const label = escapeHtml(question.options[index]);
  const shape = ox
    ? `flex:1;min-height:52px;justify-content:center;font-size:20px;font-weight:700`
    : `width:100%;min-height:40px;margin-top:6px;font-size:13px;font-weight:500;text-align:left`;
  const number = ox ? "" : `<span aria-hidden="true" style="min-width:12px;font-weight:600;color:${skin.ink3}">${index + 1}</span>`;
  return `<button type="button" data-state="${state}"${action} style="box-sizing:border-box;display:flex;align-items:center;gap:8px;${shape};padding:8px 10px;border:1px solid ${border};border-radius:${skin.buttonRadius};background:${background};color:${skin.ink};font-family:inherit;line-height:1.4;cursor:${interactive ? "pointer" : "default"};word-break:keep-all;overflow-wrap:anywhere${opacity}">${number}<span>${label}</span></button>`;
};

const optionList = (skin: ChipSkin, question: QuizQuestion, states: OptionState[], interactive: boolean): string => {
  const buttons = question.options.map((_, index) => optionButton(skin, question, index, states[index] ?? "idle", interactive)).join("");
  return question.format === "ox" ? `<div style="display:flex;gap:8px;margin-top:10px">${buttons}</div>` : `<div style="margin-top:4px">${buttons}</div>`;
};

const statsRow = (skin: ChipSkin, stats: QuizStats): string =>
  `<div style="display:flex;justify-content:space-between;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid ${skin.rule};font-size:12px;color:${skin.ink3};font-variant-numeric:tabular-nums"><span>연속 <b style="color:${skin.ink}">${stats.streak}</b> · 최고 ${stats.bestStreak}</span><span>누적 <b style="color:${skin.ink}">${stats.correct}</b>/${stats.answered}</span></div>`;

const sceneLine = (skin: ChipSkin, answer: QuizAnswerResponse): string => {
  const scene = answer.scene;
  if (!scene) return "";
  const parts = [scene.sceneNumber ? `S#${scene.sceneNumber}` : "", quizDateLabel(scene.storyTime), scene.location ?? ""].filter(Boolean);
  const label = parts.length ? parts.join(" · ") : scene.title;
  return `<button type="button" data-rcm-quiz-scene="${escapeHtml(scene.memoryId)}" style="display:block;margin:6px 0 0;padding:0;border:0;background:none;color:${skin.accent};font-family:inherit;font-size:12px;line-height:1.5;text-align:left;cursor:pointer">${escapeHtml(label)} →</button>`;
};

export function quizViewHtml(view: QuizView, skin: ChipSkin): string {
  if (view.mode === "error") {
    return `${header(skin, "퀴즈")}<div role="alert" style="font-size:13px;color:${skin.cut}">${escapeHtml(view.message)}</div><button type="button" data-rcm-quiz-retry="true" style="${quietButton(skin)}">다시 시도</button>`;
  }
  if (view.mode === "done") {
    return `${header(skin, "퀴즈")}<p style="margin:0;font-size:15px;font-weight:600;line-height:1.45;color:${skin.ink}">준비된 문제를 다 풀었어요 🎉</p><p style="margin:6px 0 0;font-size:13px;line-height:1.5;color:${skin.ink2}">다음 장면이 쌓이거나 지난 장면이 다시 열리면 새 퀴즈가 생겨요.</p>${statsRow(skin, view.stats)}<button type="button" data-rcm-quiz-done="true" style="${quietButton(skin)}">닫기</button>`;
  }
  const title = `퀴즈 ${view.index}/${view.total}`;
  if (view.mode === "question") {
    return `${header(skin, title, view.stats.streak)}${difficultyTag(skin, view.question)}${questionText(skin, view.question)}${optionList(skin, view.question, [], true)}`;
  }
  const { answer, question } = view;
  const states: OptionState[] = question.options.map((_, index) => index === answer.answerIndex ? "right" : index === answer.chosenIndex ? "wrong" : "dim");
  const verdict = answer.correct
    ? `<p role="status" style="margin:0 0 2px;font-size:16px;font-weight:700;color:${skin.ok}">⭕ 정답!</p>`
    : `<p role="status" style="margin:0 0 2px;font-size:16px;font-weight:700;color:${skin.cut}">❌ 아쉬워요</p>`;
  const explanation = answer.explanation ? `<p style="margin:10px 0 0;font-size:13px;line-height:1.5;color:${skin.ink2}">${escapeHtml(answer.explanation)}</p>` : "";
  const quote = answer.quote ? `<p style="margin:6px 0 0;padding-left:8px;border-left:2px solid ${skin.rule};font-size:12px;line-height:1.5;color:${skin.ink3}">“${escapeHtml(answer.quote)}”</p>` : "";
  const nextLabel = answer.remaining > 0 ? "다음 문제" : "결과 보기";
  return `${header(skin, title, answer.stats.streak)}<div aria-live="polite">${verdict}${questionText(skin, question)}</div>${optionList(skin, question, states, false)}${explanation}${quote}${sceneLine(skin, answer)}${statsRow(skin, answer.stats)}<button type="button" data-rcm-quiz-next="true" style="${primaryButton(skin)}">${nextLabel}</button>`;
}
