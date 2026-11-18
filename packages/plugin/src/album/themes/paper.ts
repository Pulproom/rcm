import { albumTogetherCss } from "./together.js";
/** Theme D: approved rough-paper hand variant, scoped to the album scroller. */
const B = ".alb-album.alb-theme--film";
export const PAPER_ALBUM_CSS = String.raw`
@font-face { font-family: "Kyobo25"; font-display: swap; src: url("https://cdn.jsdelivr.net/gh/projectnoonnu/2604-1@1.1/KyoboHandwriting2025lyb.woff2") format("woff2"); }
${B} {
  --paper: #d5cbb3; --paper-2: #cfc5ae; --ink: #2a2620; --ink-2: #453f35; --ink-3: #5c5446; --rule: #2a262052; --rule-soft: #2a262030;
  --seal: #9d3527;
  --display: "Song Myung", "Gowun Batang", serif; --serif: "Gowun Batang", "Noto Serif KR", serif; --hand: "Kyobo25", "Gowun Batang", serif; --sans: "Pretendard Variable", Pretendard, system-ui, sans-serif;
  --measure: 580px; --hand-ink: #26324f;
}
${B}, ${B} * { box-sizing: border-box; }
${B} { margin: 0; color: var(--ink); font: 400 17px/2 var(--serif); word-break: keep-all; overflow-wrap: anywhere;
  
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 .16  0 0 0 0 .13  0 0 0 0 .09  0 0 0 1.5 -.86'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23s)'/%3E%3C/svg%3E"),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='640'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.03 .16' numOctaves='4' seed='11'/%3E%3CfeColorMatrix values='0 0 0 0 .98  0 0 0 0 .95  0 0 0 0 .86  0 0 0 .5 -.2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23f)'/%3E%3C/svg%3E"),
    var(--paper); }
${B} h1, ${B} h2, ${B} h3, ${B} .rd-body, ${B} .rd-lede, ${B} .rd-said p, ${B} .rd-letter p, ${B} .rd-vows p { text-shadow: 0 0 .7px #2a262099; }
${B} ::selection { background: #2a2620; color: var(--paper); }
${B} a { color: inherit; text-decoration: none; }
${B} a:focus-visible { outline: 2px solid var(--seal); outline-offset: 3px; }
${B} h1, ${B} h2, ${B} h3, ${B} p, ${B} blockquote, ${B} ol, ${B} ul, ${B} dl, ${B} dd { margin: 0; padding: 0; }
${B} ol, ${B} ul { list-style: none; }
${B} .rd-col { max-width: calc(var(--measure) + 56px); margin: 0 auto; padding: 0 28px; }
${B} .rd-dbl { height: 6px; border-top: 3px solid var(--ink); border-bottom: 1px solid var(--ink); }
${B} .rd-stamp { display: inline-block; padding: 3px 9px 2px; border: 1.5px solid var(--seal); border-radius: 2px; color: var(--seal); font: 700 13px/1.4 var(--sans); letter-spacing: .06em; font-variant-numeric: tabular-nums; transform: rotate(-2.5deg); mix-blend-mode: multiply; opacity: .9; white-space: nowrap; }
${B} .rd-cover { min-height: min(calc(100svh - 56px), 860px); display: grid; padding: 26px; }
${B} .rd-cover .rd-frame { display: grid; align-content: space-between; justify-items: center; text-align: center; padding: 64px 28px 44px; border: 3px solid var(--ink); outline: 1px solid var(--ink); outline-offset: -9px; }
${B} .rd-cover h1 { font: 400 clamp(46px, 8.4cqi, 88px)/1.16 var(--display); text-wrap: balance; max-width: 10em; }
${B} .rd-cover .rd-cover-rule { width: 64px; height: 0; margin: 30px auto 26px; border-top: 1px solid var(--ink); }
${B} .rd-cover .rd-stamp { font-size: 15px; padding: 5px 13px 4px; transform: rotate(-3deg); }
${B} .rd-cover .rd-card { margin-top: 18px; font: 500 13.5px/1.6 var(--sans); color: var(--ink-3); }
${B} .rd-cover blockquote { max-width: 26em; }
${B} .rd-cover blockquote p { font: 400 clamp(26px, 3.4cqi, 34px)/1.5 var(--hand); text-wrap: balance; }
${B} .rd-cover cite { display: block; margin-top: 6px; font: 500 13px/1.4 var(--sans); font-style: normal; color: var(--ink-3); }
${B} .rd-toc { padding-top: 96px; }
${B} .rd-toc h2, ${B} .rd-sec h2 { font: 400 30px/1.3 var(--display); padding-bottom: 14px; }
${B} .rd-toc li > :is(a,button,span) { display: grid; grid-template-columns: auto minmax(0, auto) minmax(24px, 1fr) auto; gap: 0 10px; align-items: baseline; padding: 13px 0; }
${B} .rd-toc li i { font: 400 18px/1.5 var(--display); font-style: normal; min-width: 1.7em; }
${B} .rd-toc li b { font: 700 16.5px/1.6 var(--serif); text-wrap: pretty; }
${B} .rd-toc li u { align-self: end; margin-bottom: .55em; border-bottom: 2px dotted var(--rule); text-decoration: none; }
${B} .rd-toc li u:has(+ span:empty) { visibility: hidden; }
${B} .rd-toc li span { font: 500 13px/1.5 var(--sans); color: var(--ink-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
${B} .rd-toc li > :is(a,button,span):hover b { text-decoration: underline; text-underline-offset: 5px; }
${B} .rd-toc .rd-after { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--rule); display: flex; flex-wrap: wrap; gap: 0 18px; font: 500 13.5px/1.5 var(--sans); color: var(--ink-3); }
${B} .rd-toc .rd-after > :is(a,button) { padding: 9px 0; }
${B} .rd-toc .rd-after > :is(a,button):hover { color: var(--ink); }
${B} .rd-chapter { padding-top: 120px; }
${B} .rd-chapter header { padding-top: 26px; }
${B} .rd-chapter h2 { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 18px; align-items: baseline; font: 400 clamp(27px, 3.8cqi, 36px)/1.36 var(--display); text-wrap: balance; }
${B} .rd-chapter h2 i { font-style: normal; font-size: 1.5em; line-height: 1; }
${B} .rd-chapter .rd-span { margin-top: 10px; font: 500 13.5px/1.5 var(--sans); color: var(--ink-3); font-variant-numeric: tabular-nums; }
${B} .rd-chapter .rd-lede { margin-top: 22px; padding-bottom: 30px; border-bottom: 1px solid var(--ink); font-size: 18px; line-height: 1.95; color: var(--ink-2); text-wrap: pretty; }
${B} .rd-scene { padding-top: 46px; }
${B} .rd-scene + .rd-scene { margin-top: 46px; border-top: 1px dashed var(--rule); }
${B} .rd-scene .rd-at { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-bottom: 14px; font: 500 13px/1.5 var(--sans); color: var(--ink-3); font-variant-numeric: tabular-nums; }
${B} .rd-scene h3 { font: 400 22.5px/1.5 var(--display); text-wrap: pretty; }
${B} .rd-scene .rd-body { margin-top: 12px; text-indent: 1em; text-wrap: pretty; }
${B} .rd-line { margin-top: 26px; padding: 0 16px 0 44px; position: relative; background-image: repeating-linear-gradient(to bottom, #0000 0 43px, var(--rule) 43px 44px); }
${B} .rd-line::before { content: ""; position: absolute; left: 30px; top: -6px; bottom: -6px; border-left: 1px solid #9d352766; }
${B} .rd-line p { font: 400 25px/44px var(--hand); padding-top: 9px; margin-bottom: -9px; color: var(--hand-ink); text-wrap: pretty; }
${B} .rd-line cite { display: block; font: 500 13px/44px var(--sans); font-style: normal; color: var(--ink-3); }
${B} .rd-sec { padding-top: 120px; }
${B} .rd-sec .rd-h2 { padding-top: 24px; }
${B} .rd-said { display: grid; gap: 30px; }
${B} .rd-vows li { padding: 20px 0; border-bottom: 1px dashed var(--rule); }
${B} .rd-vows .rd-vow-at { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-bottom: 8px; font: 500 13px/1.5 var(--sans); color: var(--ink-3); }
${B} .rd-vows .rd-open { display: inline-block; padding: 3px 9px 2px; border: 1.5px dashed var(--ink-3); border-radius: 2px; font-weight: 700; letter-spacing: .06em; }
${B} .rd-vows p { text-wrap: pretty; }
${B} .rd-letter { padding: 26px 0 30px; border-bottom: 1px dashed var(--rule); }
${B} .rd-letter h3 { font: 400 20px/1.5 var(--display); }
${B} .rd-letter p { margin-top: 10px; text-indent: 1em; text-wrap: pretty; }
${B} .rd-letter .rd-sign { margin-top: 12px; text-indent: 0; text-align: right; font: 400 27px/1.3 var(--hand); color: var(--hand-ink); }
${B} .rd-ledger > div { display: grid; grid-template-columns: 7.2em minmax(0, 1fr); gap: 2px 18px; padding: 18px 0; border-bottom: 1px dashed var(--rule); }
${B} .rd-ledger dt { font: 400 18px/1.8 var(--display); }
${B} .rd-ledger dd { font-size: 16px; line-height: 1.85; color: var(--ink-2); }
${B} .rd-ledger dd + dd { grid-column: 2; margin-top: 8px; }
${B} .rd-ledger dd b { color: var(--ink); }
${B} .rd-ledger dd small { display: block; font: 500 13px/1.6 var(--sans); color: var(--ink-3); font-variant-numeric: tabular-nums; }
${B} .rd-ledger .rd-words { font: 400 29px/1.35 var(--hand); color: var(--hand-ink); }
${B} .rd-ledger .on { color: var(--ink); font-weight: 700; }
${B} .rd-colophon { margin: 128px auto 0; padding: 0 28px 84px; max-width: calc(var(--measure) + 56px); }
${B} .rd-colophon div { padding: 20px 22px; border: 1px solid var(--ink); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: baseline; font: 500 13.5px/1.6 var(--sans); color: var(--ink-2); font-variant-numeric: tabular-nums; }
${B} .rd-colophon b { font: 400 19px/1.4 var(--display); color: var(--ink); }


@container (max-width: 700px) {${B} { font-size: 16.5px; line-height: 1.95; }
${B} .rd-cover { padding: 14px; min-height: min(calc(100svh - 148px), 760px); }
${B} .rd-cover .rd-frame { padding: 48px 18px 34px; outline-offset: -8px; }
${B} .rd-col { padding: 0 24px; }
${B} .rd-toc { padding-top: 64px; }
${B} .rd-toc li > :is(a,button,span) { grid-template-columns: auto minmax(0, 1fr) auto; }
${B} .rd-toc li u { display: none; }
${B} .rd-chapter, ${B} .rd-sec { padding-top: 84px; }
${B} .rd-chapter .rd-lede { font-size: 17px; }
${B} .rd-scene { padding-top: 38px; }
${B} .rd-scene + .rd-scene { margin-top: 38px; }
${B} .rd-line { padding: 0 8px 0 34px; background-image: repeating-linear-gradient(to bottom, #0000 0 39px, var(--rule) 39px 40px); }
${B} .rd-line::before { left: 22px; }
${B} .rd-line p { font-size: 23px; line-height: 40px; padding-top: 8px; margin-bottom: -8px; }
${B} .rd-line cite { line-height: 40px; }
${B} .rd-ledger > div { grid-template-columns: 1fr; }
${B} .rd-ledger dd + dd { grid-column: 1; }
${B} .rd-colophon { margin-top: 88px; padding: 0 24px 60px; }

}
/* The mockup's empty photo slot belongs only to editing, never to a real image. */
${B} .slot {display:grid;place-items:center;width:100%;height:100%;min-height:72px;border:1.5px dashed currentColor;font:500 13px/1 var(--sans);letter-spacing:.02em}
${B} .rd-plates {display:grid;gap:12px;margin-top:24px}
${B} .rd-plates figure {margin:0}
${B} .rd-plates.n2, ${B} .rd-plates.n4 {grid-template-columns:1fr 1fr}
${B} .rd-plates.n3, ${B} .rd-plates.n5 {grid-template-columns:1fr 1fr 1fr}
${B} .rd-shots {display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:28px}
${B} .rd-shots figure {margin:0}
${B} .slot {color:var(--ink-3)}
${B} .rd-print {position:relative;padding:9px;background:#e6decb;box-shadow:0 1px 3px #3b2f1a40,0 12px 20px -14px #3b2f1a80}
${B} .rd-print i {position:absolute;width:22px;height:22px;background:var(--ink);opacity:.86}
${B} .rd-print .c1 {left:-4px;top:-4px;clip-path:polygon(0 0,100% 0,0 100%)}
${B} .rd-print .c2 {right:-4px;top:-4px;clip-path:polygon(0 0,100% 0,100% 100%)}
${B} .rd-print .c3 {left:-4px;bottom:-4px;clip-path:polygon(0 0,0 100%,100% 100%)}
${B} .rd-print .c4 {right:-4px;bottom:-4px;clip-path:polygon(100% 0,100% 100%,0 100%)}
${B} .rd-cover .rd-print {margin:26px auto;width:min(62%,330px);aspect-ratio:4/3;transform:rotate(-1.2deg)}
${B} .rd-plates {gap:20px;margin-top:30px}
${B} .rd-plates.n1 figure {width:fit-content;max-width:80%;transform:rotate(-1deg);justify-self:start}
${B} .rd-plates.n2 figure:first-child {transform:rotate(-1.2deg)}
${B} .rd-plates.n2 figure:last-child {transform:rotate(1deg)}
${B} .rd-shots {gap:20px}

${B}{container-type:inline-size;isolation:isolate;overflow-x:clip;min-height:100%;scrollbar-color:#a89e88 var(--paper)}
${B}[data-tint=navy]{--seal:#2b4a7a}
${B}[data-tint=grass]{--seal:#3d6442}
${B}[data-tint=gray]{--paper:#cdcbc4}
${B}[data-tint=kraft]{--paper:#c4a983;--seal:#7a2a1e;--ink-3:#433c31}
${B} .rd-vignette{position:sticky;top:0;height:calc(100svh - 56px);margin-bottom:calc(-1 * (100svh - 56px));pointer-events:none;z-index:3;box-shadow:inset 0 0 140px #5a47234d}
${B} :is(section,div,li,figure){min-width:0}
${B} figure{margin:0}
${B} .rd-jump{color:inherit;text-decoration:none;font:inherit;background:none;border:0;padding:0;text-align:inherit;cursor:pointer;width:100%}
${B} :is(a,button,[tabindex]):focus-visible{outline:2px solid var(--seal);outline-offset:3px}
${B} .rd-cover .rd-amp{font:inherit}
${B} .rd-cover .rd-epigraph{align-self:end}
${B} .rd-cover .rd-epigraph p{color:var(--hand-ink)}
${B} .rd-toc .rd-after>*{width:auto}
${B} .rd-scene .rd-body{white-space:pre-line}
${B} .rd-said>li{margin-top:26px}
${B} .rd-letter::after{content:"";display:block;clear:both}
${B} .rd-face{float:left;width:72px;height:90px;margin:4px 18px 6px 0;padding:5px;background:#e6decb;box-shadow:0 1px 3px #3b2f1a40,0 12px 20px -14px #3b2f1a80}
${B} .rd-face .alb-photo{height:100%}
${B} .rd-face .ph{display:block;width:100%;height:100%;object-fit:cover}
${B} .rd-ledger em{font:inherit;font-style:normal}
${B} .rd-plates .rd-print{aspect-ratio:auto}
${B} .rd-print .ph{display:block;width:100%;height:auto;min-height:0;border:0}
${B} .rd-plates:not(.n1) .ph{aspect-ratio:3/2;object-fit:cover}
${B} .rd-shots .ph{aspect-ratio:1;object-fit:cover}
${B} :is(.rd-plates,.rd-shots,.rd-single) figcaption{font:400 20px/1.35 var(--hand);color:var(--hand-ink);text-align:center;margin-top:6px}
${B} .rd-cover .rd-print{aspect-ratio:auto}
${B} .alb-photo[role=button]{cursor:zoom-in}
${B} .rd-writing{margin-top:22px;white-space:pre-line;text-wrap:pretty}
${B} .rd-people{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:30px}
${B} .rd-people .ph{display:block;width:100%;height:auto}
${B} .rd-divider{border:0;border-top:1px solid var(--rule);margin:120px auto 0;width:min(var(--measure),calc(100% - 56px))}
@container(max-width:700px){
 ${B} .rd-plates.n5{grid-template-columns:1fr 1fr}
 ${B}{font-size:16.5px;line-height:1.95}
 ${B} .rd-vignette{box-shadow:inset 0 0 60px #5a472340}
 ${B} .rd-divider{margin-top:84px}
}
` + albumTogetherCss("film", B);
