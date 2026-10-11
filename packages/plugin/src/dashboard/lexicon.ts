import type { DashboardSkin } from "../types.js";

export type Lexicon = {
  skin: DashboardSkin;
  /** Act/chapter label: film "ACT II", phone "2막". */
  act: (index: number) => string;
  /** Plural noun for acts in menus. */
  actNoun: string;
  /** Season (story part) label: film "PART II", phone "2부". */
  part: (index: number) => string;
  /** Season and act together: film "PART II · ACT III", phone "2부 3막". */
  partAct: (part: number, act: number) => string;
  /** Running-act marker: film "지금 상영 중", phone "지금 진행 중". */
  nowShowing: string;
  /** Short running marker on chapter tabs: film "상영 중", phone "진행 중". */
  nowShort: string;
  themeDark: string;
  themeLight: string;
  /** Landmark tag on a scene frame: film "명장면", phone "기념일". */
  landmark: string;
  /** Empty home poster title. */
  emptyScenes: string;
  /** Whether opening credits render. */
  credits: boolean;
  starring: string;
  and: string;
  /** Scene slug: film `S#12. 장소 / 낮`, phone `S#12 · 장소`. */
  slug: (no: number, place: string | null, period: string | null) => string;
};

const romanNumeral = (value: number): string => [["M", 1000], ["CM", 900], ["D", 500], ["CD", 400], ["C", 100], ["XC", 90], ["L", 50], ["XL", 40], ["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]]
  .reduce((result, [numeral, amount]) => { let text = result.text; let rest = result.rest; while (rest >= (amount as number)) { text += numeral; rest -= amount as number; } return { text, rest }; }, { text: "", rest: Math.max(1, value) }).text;

const FILM: Lexicon = {
  skin: "film",
  act: (index) => `ACT ${romanNumeral(index + 1)}`,
  actNoun: "막",
  part: (index) => `PART ${romanNumeral(index + 1)}`,
  partAct: (part, act) => `PART ${romanNumeral(part + 1)} · ACT ${romanNumeral(act + 1)}`,
  nowShowing: "지금 상영 중",
  nowShort: "상영 중",
  themeDark: "밤",
  themeLight: "낮 · 벨벳",
  landmark: "명장면",
  emptyScenes: "아직 상영한 씬이 없습니다",
  credits: true,
  starring: "Starring",
  and: "And",
  slug: (no, place, period) => `S#${no}. ${place?.trim() || "장소 미상"}${period ? ` / ${period}` : ""}`,
};

const PHONE: Lexicon = {
  skin: "phone",
  act: (index) => `${index + 1}막`,
  actNoun: "막",
  part: (index) => `${index + 1}부`,
  partAct: (part, act) => `${part + 1}부 ${act + 1}막`,
  nowShowing: "지금 진행 중",
  nowShort: "진행 중",
  themeDark: "다크",
  themeLight: "라이트",
  landmark: "기념일",
  emptyScenes: "아직 도착한 장면이 없습니다",
  credits: false,
  starring: "",
  and: "",
  slug: (no, place) => [`S#${no}`, place].filter(Boolean).join(" · "),
};

let current: Lexicon = FILM;
export function setSkin(skin: DashboardSkin): void {
  current = skin === "phone" ? PHONE : FILM;
}
export function lex(): Lexicon {
  return current;
}
