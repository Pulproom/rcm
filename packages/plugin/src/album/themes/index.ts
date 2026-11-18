import { ALBUM_PHOTO_FIT_CSS } from "../photo-fit-css.js";
import { ALBUM_BLOCK_KINDS, type AlbumBlockKind, type AlbumTheme } from "@rcm/shared";
import { LP_READING_CSS } from "./lp-reading.js";
import { BOOK_ALBUM_CSS } from "./book.js";
import { PAPER_ALBUM_CSS } from "./paper.js";
import { PROGRAM_ALBUM_CSS } from "./program.js";
/** Identifying inks, rather than the paper surfaces, for the editor's tint picker. */
export const ALBUM_TINT_SWATCHES: Record<AlbumTheme, Record<string, string>> = {
  book: { plum: "#4a2f44", ink: "#25282d", pine: "#2b4a3d", navy: "#25355c", brick: "#7a3a2c" },
  program: { primary: "#2438b8", sea: "#0f4c81", dusk: "#b23a2e", forest: "#1e5b4a", ink: "#15161a" },
  lp: { mustard: "#efb71d", tomato: "#c23e22", sky: "#8fc1e3", pink: "#f2a9b6", black: "#1c1a19" },
  film: { seal: "#9d3527", navy: "#2b4a7a", grass: "#3d6442", gray: "#cdcbc4", kraft: "#c4a983" },
};
const titles: Record<AlbumBlockKind, string> = { cover: "", intro: "두 사람", firsts: "처음", story: "이야기", quotes: "저장한 말", promises: "약속", bond: "관계", hearts: "서로에게", progress: "함께한 걸음", nicknames: "부르는 말", gallery: "사진", intimacy: "가까워진 순간", text: "기록", photo: "사진", divider: "", together: "함께한 시간" };
export function albumThemeVoice(theme: AlbumTheme) {
  const overrides: Partial<Record<AlbumBlockKind, string>> = { quotes: theme === "lp" ? "가사" : "남겨 둔 말", bond: "가까워진 순간", intimacy: "스킨십" };
  return { blocks: Object.fromEntries(ALBUM_BLOCK_KINDS.map(kind => [kind, { title: overrides[kind] ?? titles[kind] }])) as Record<AlbumBlockKind, { title: string }> };
}
export const ALBUM_FONT_LINKS = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"><link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/sun-typeface/SUIT@2/fonts/variable/woff2/SUIT-Variable.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&amp;display=swap"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&amp;family=Song+Myung&amp;display=swap">';
export function albumThemeCss(theme: AlbumTheme): string {
  return ({ book: BOOK_ALBUM_CSS, program: PROGRAM_ALBUM_CSS, lp: LP_READING_CSS, film: PAPER_ALBUM_CSS })[theme] + supporting + ALBUM_PHOTO_FIT_CSS;
}

export const ALBUM_FONT_CSS = [...new Set([BOOK_ALBUM_CSS, PROGRAM_ALBUM_CSS, LP_READING_CSS, PAPER_ALBUM_CSS].flatMap(css => css.match(/@font-face\s*\{[^}]*\}/g) ?? []))].join("\n");

const supporting = String.raw`
.alb-album .rd-chapter { content-visibility:auto; contain-intrinsic-block-size:auto 1600px; }
@media print { .alb-album .rd-chapter { content-visibility:visible; contain-intrinsic-block-size:none; } }
.alb-album .rd-chapter-art{max-width:var(--measure,640px);margin:20px auto}

.alb-album:is(.alb-theme--book,.alb-theme--program,.alb-theme--lp,.alb-theme--film) .rd-sec.alb-block--quotes{padding-block:0;margin-top:0;background:transparent;color:var(--ink)}
.alb-album .rd-inter{position:relative;padding:54px 0 50px;text-align:center}
.alb-album .rd-inter::before,.alb-album .rd-inter::after{content:"";display:block;width:36px;height:1px;background:var(--ink-3);margin:0 auto;opacity:.55}
.alb-album .rd-inter blockquote{padding:22px 0 18px;margin:0;border:0}
.alb-album:is(.alb-theme--book,.alb-theme--program,.alb-theme--lp,.alb-theme--film) .rd-sec.alb-block--quotes .rd-inter blockquote p{font:400 23px/1.6 var(--display,var(--serif,var(--accent-serif,var(--sans))));letter-spacing:-.01em;text-wrap:balance}
.alb-album:is(.alb-theme--book,.alb-theme--program,.alb-theme--lp,.alb-theme--film) .rd-sec.alb-block--quotes .rd-inter cite{display:block;margin-top:10px;font:500 12.5px/1.4 var(--sans);font-style:normal;color:var(--ink-3);letter-spacing:.02em}
.alb-album .rd-inter.two blockquote+blockquote{padding-top:6px}
.alb-album:is(.alb-theme--book,.alb-theme--program,.alb-theme--lp,.alb-theme--film) .rd-sec.alb-block--quotes .rd-inter.two blockquote p{font-size:20px}

/* Independent reader/export boundary; component selectors retain their theme-specific values. */
@scope (.alb-album) {
 :scope button:where(:not(:hover),:hover,:focus-visible,:active,:disabled){appearance:none;background:transparent;color:inherit;border:0;border-radius:0;box-shadow:none;font:inherit;padding:0;cursor:pointer}
 :scope button:where(:focus-visible){outline:2px solid var(--editor-accent,var(--accent,var(--ink)));outline-offset:3px}
 :scope button:where(:active){filter:brightness(.95)}
 :scope button:where(:disabled){cursor:default}
}

/* Reading photo captions share one contract; cover, portraits and letter faces are excluded. */
.alb-album:is(.alb-theme--book,.alb-theme--program,.alb-theme--lp,.alb-theme--film) .rd-plates.n1 .alb-photo{aspect-ratio:auto}
.alb-album:is(.alb-theme--book,.alb-theme--program,.alb-theme--lp,.alb-theme--film) .rd-plates.n1 .ph{display:block;aspect-ratio:auto;width:auto;max-width:100%;height:auto;max-height:min(calc((100svh - 56px) * .78),720px)}
.alb-album:is(.alb-theme--book,.alb-theme--program,.alb-theme--lp) :is(.rd-plates,.rd-shots,.rd-single) figcaption{font:400 13px/1.6 var(--sans);color:var(--ink-3);margin-top:8px}
.alb-album:is(.alb-theme--book,.alb-theme--program,.alb-theme--lp) :is(.rd-plates.n1,.rd-single) figcaption{display:flex;gap:8px;align-items:center;margin-top:10px}
.alb-album:is(.alb-theme--book,.alb-theme--program,.alb-theme--lp) :is(.rd-plates.n1,.rd-single) figcaption::before{content:"";width:18px;height:1px;background:currentColor;flex:none}
.alb-album:not(.alb-theme--film) .rd-leader{display:none}
`;
