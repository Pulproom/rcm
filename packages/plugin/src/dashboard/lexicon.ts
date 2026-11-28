export type Lexicon = {
  act: (index: number) => string;
  /** Plural noun for acts in menus. */
  actNoun: string;
  part: (index: number) => string;
  partAct: (part: number, act: number) => string;
  nowShowing: string;
  nowShort: string;
  themeDark: string;
  themeLight: string;
  landmark: string;
  /** Empty home notification title. */
  emptyScenes: string;
  slug: (no: number, place: string | null) => string;
};

const PHONE: Lexicon = {
  act: (index) => `${index + 1}막`,
  actNoun: "막",
  part: (index) => `${index + 1}부`,
  partAct: (part, act) => `${part + 1}부 ${act + 1}막`,
  nowShowing: "지금 진행 중",
  nowShort: "진행 중",
  themeDark: "다크",
  themeLight: "라이트",
  landmark: "기념일",
  emptyScenes: "아직 도착한 장면이 없어요",
  slug: (no, place) => [`S#${no}`, place].filter(Boolean).join(" · "),
};

export function lex(): Lexicon {
  return PHONE;
}
