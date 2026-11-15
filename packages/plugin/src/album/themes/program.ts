/** Program book skin of the shared reading skeleton. Values follow the approved B mockup. */
const B = ".alb-album.alb-theme--program";
export const PROGRAM_ALBUM_CSS = String.raw`
@font-face{font-family:"MaruBuri";font-weight:400;font-display: swap;src:url("https://hangeul.pstatic.net/hangeul_static/webfont/MaruBuri/MaruBuri-Regular.woff2") format("woff2")}
@font-face{font-family:"MaruBuri";font-weight:600;font-display: swap;src:url("https://hangeul.pstatic.net/hangeul_static/webfont/MaruBuri/MaruBuri-SemiBold.woff2") format("woff2")}

${B} {
  --paper: #f0eee8; --paper-2: #e4e1d8; --ink: #15161a; --ink-2: #3f4046; --ink-3: #62636b; --rule: #cfccc2;
  --sans: "SUIT Variable", "Pretendard Variable", system-ui, sans-serif; --accent-serif: "Instrument Serif", "MaruBuri", serif;
  --c: #2438b8; --rail: 232px;
}
${B}, ${B} * { box-sizing: border-box; }
${B} { margin: 0; background: var(--paper); color: var(--ink); font: 400 17px/1.85 var(--sans); word-break: keep-all; overflow-wrap: anywhere; -webkit-font-smoothing: antialiased; }
${B} ::selection { background: var(--ink); color: var(--paper); }
${B} :is(a,.rd-jump) { color: inherit; text-decoration: none; }
${B} :is(a,button,[tabindex]):focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
${B} .rd-chapter > div.rd-row a:focus-visible, ${B} .rd-cover a:focus-visible { outline-color: #fff; }
${B} h1, ${B} h2, ${B} h3, ${B} p, ${B} blockquote, ${B} ol, ${B} ul, ${B} dl, ${B} dd { margin: 0; padding: 0; }
${B} ol, ${B} ul { list-style: none; }
${B} :is(.rd-num,.rd-hm,.rd-letters h3 .rd-to,.rd-toc li i,.rd-rail li i) { font-family: var(--accent-serif); font-style: italic; font-weight: 400; font-variant-numeric: lining-nums; }

/* cover */
${B} .rd-cover { min-height: min(calc(100svh - 56px), 860px); display: grid; align-content: space-between; gap: 48px; padding: 56px clamp(24px, 5cqi, 72px) 52px; background: var(--c); color: #fff; }
${B} .rd-cover h1 { font: 800 clamp(54px, 11.5cqi, 148px)/0.94 var(--sans); letter-spacing: -.04em; text-wrap: balance; }
${B} .rd-cover h1 .rd-amp { font: italic 400 1.08em/0.9 var(--accent-serif); letter-spacing: -.02em; padding: 0 .06em; }
${B} .rd-cover .rd-cover-foot { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 32px 48px; align-items: end; padding-top: 24px; border-top: 1px solid #ffffff59; }
${B} .rd-who { font: 600 15px/1.6 var(--sans); font-variant-numeric: tabular-nums; }
${B} .rd-card { display: block; font-weight: 400; color: #ffffffd1; }
${B} .rd-cover blockquote p { font: 700 clamp(22px, 3cqi, 34px)/1.4 var(--sans); letter-spacing: -.025em; text-wrap: balance; }
${B} .rd-cover cite { display: block; margin-top: 10px; font: 500 13.5px/1.4 var(--sans); font-style: normal; color: #ffffffd1; }

/* shell */
${B} .rd-shell { display: grid; grid-template-columns: var(--rail) minmax(0, 780px); gap: 0 clamp(32px, 5cqi, 72px); justify-content: center; padding: 0 clamp(24px, 4cqi, 56px); }
${B} .rd-rail { position: sticky; top: 0; align-self: start; max-height: calc(100svh - 56px); overflow: auto; padding: 44px 0 40px; font: 500 14px/1.45 var(--sans); scrollbar-width: none; }
${B} .rd-rail > :is(a,button,span) > b { display: block; font: 800 17px/1.3 var(--sans); letter-spacing: -.02em; }
${B} .rd-rail small { display: block; margin-top: 4px; font: 400 12.5px/1.5 var(--sans); color: var(--ink-3); font-variant-numeric: tabular-nums; }
${B} .rd-rail ol { margin-top: 26px; border-top: 1px solid var(--ink); }
${B} .rd-rail li > :is(a,button,span) { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 0 6px; padding: 11px 0; border-bottom: 1px solid var(--rule); color: var(--ink-2); transition: color .2s; }
${B} .rd-rail li > :is(a,button):hover, ${B} .rd-rail li > [aria-current] { color: var(--ink); }
${B} .rd-rail li i { font-size: 21px; line-height: 1.05; color: var(--k); }
${B} .rd-rail li b { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
${B} .rd-rail li > [aria-current] b { font-weight: 800; }
${B} .rd-rail li span { grid-column: 2; font: 400 12.5px/1.5 var(--sans); font-style: normal; color: var(--ink-3); font-variant-numeric: tabular-nums; }
${B} .rd-rail .rd-after { margin-top: 16px; display: grid; }
${B} .rd-rail .rd-after > * { padding: 7px 0; color: var(--ink-3); }
${B} .rd-rail .rd-after > :hover { color: var(--ink); }
${B} .rd-toc { display: none; }

/* chapter */
${B} .rd-chapter { padding-top: 44px; }
${B} .rd-chapter + .rd-chapter { padding-top: 96px; }
${B} .rd-chapter > div.rd-row { background: var(--c); color: #fff; }
${B} .rd-chapter > div.rd-row { padding: 34px 40px 40px; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 30px; align-items: start; }
${B} .rd-chapter > div.rd-row .rd-num { font-size: 96px; line-height: .86; letter-spacing: -.02em; }
${B} .rd-chapter h2 { font: 800 clamp(26px, 3.3cqi, 36px)/1.25 var(--sans); letter-spacing: -.035em; text-wrap: balance; }
${B} .rd-chapter .rd-span { margin-top: 8px; font: 500 13.5px/1.5 var(--sans); color: #ffffffd6; font-variant-numeric: tabular-nums; }
${B} .rd-chapter .rd-lede { grid-column: 1 / -1; margin-top: 30px; padding-top: 22px; border-top: 1px solid #ffffff59; font: 500 18px/1.75 var(--sans); letter-spacing: -.01em; text-wrap: pretty; }

${B} .rd-scene { display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: 0 32px; padding: 48px 0 0 40px; }
${B} .rd-scene .rd-note { position: sticky; top: 28px; align-self: start; font: 500 13px/1.55 var(--sans); color: var(--ink-3); font-variant-numeric: tabular-nums; }
${B} .rd-scene .rd-note .rd-hm { display: block; font-size: 38px; line-height: 1; color: var(--c); letter-spacing: -.01em; margin-bottom: 8px; }
${B} .rd-scene .rd-note .rd-day { display: block; font: italic 400 38px/1.2 var(--accent-serif); color: var(--c); letter-spacing: -.01em; margin-bottom: 8px; }
${B} .rd-scene h3 { font: 800 22px/1.42 var(--sans); letter-spacing: -.03em; text-wrap: balance; }
${B} .rd-scene .rd-body { margin-top: 12px; color: var(--ink-2); text-wrap: pretty; white-space: pre-line; }
${B} .rd-line { margin-top: 26px; padding-top: 20px; border-top: 2px solid var(--c); }
${B} .rd-line p { font: 700 23px/1.5 var(--sans); letter-spacing: -.03em; color: var(--c); text-wrap: pretty; }
${B} .rd-line cite, ${B} .rd-sec.alb-block--quotes cite { display: block; margin-top: 8px; font: 600 13px/1.4 var(--sans); font-style: normal; color: var(--ink-3); }
${B} .rd-scene + .rd-scene > .rd-text { border-top: 1px solid var(--rule); padding-top: 48px; }
${B} .rd-scene + .rd-scene .rd-note { padding-top: 52px; }

/* interlude: kept lines on ink */
${B} .rd-sec.alb-block--quotes { margin: 112px 0 0; padding: 72px clamp(24px, 5cqi, 72px) 84px; background: var(--ink); color: var(--paper); }
${B} .rd-sec.alb-block--quotes h2 { font: 800 15px/1.4 var(--sans); letter-spacing: -.01em; color: #b9b8b0; }
${B} .rd-sec.alb-block--quotes ol { margin: 34px auto 0; max-width: 1040px; display: grid; gap: 44px; }
${B} .rd-sec.alb-block--quotes li { max-width: 78%; }
${B} .rd-sec.alb-block--quotes li.r { justify-self: end; text-align: right; }
${B} .rd-sec.alb-block--quotes p { font: 800 clamp(26px, 3.6cqi, 44px)/1.3 var(--sans); letter-spacing: -.04em; text-wrap: balance; }
${B} .rd-sec.alb-block--quotes li.r p { color: var(--k); }
${B} .rd-sec.alb-block--quotes cite { color: #b9b8b0; }

/* after */
${B} .rd-sec { padding-top: 104px; }
${B} .rd-sec .rd-h2 { font: 800 clamp(30px, 4cqi, 44px)/1.15 var(--sans); letter-spacing: -.04em; padding-bottom: 18px; border-bottom: 2px solid var(--ink); }
${B} .rd-vows li { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 0 24px; padding: 24px 0; border-bottom: 1px solid var(--rule); }
${B} .rd-vows .rd-st { justify-self: start; align-self: start; margin-top: 3px; padding: 5px 11px 4px; border: 1.5px solid var(--ink); border-radius: 99px; font: 700 13px/1.2 var(--sans); }
${B} .rd-vows .kept .rd-st { background: var(--ink); color: var(--paper); }
${B} .rd-vows p { font-weight: 500; text-wrap: pretty; }
${B} .rd-vows .rd-to { display: block; margin-top: 6px; font: 500 13px/1.5 var(--sans); color: var(--ink-3); }

${B} .rd-letters { display: grid; grid-template-columns: 1fr 1fr; gap: 0 40px; }
${B} .rd-letters article { padding-top: 26px; }
${B} .rd-letters h3 { font: 800 21px/1.35 var(--sans); letter-spacing: -.03em; }
${B} .rd-letters h3 .rd-to { font-size: 1.5em; line-height: .8; color: var(--k); margin-right: 2px; }
${B} .rd-letters p { margin-top: 12px; color: var(--ink-2); text-wrap: pretty; }
${B} .rd-arrow{font-family:"Pretendard Variable",system-ui,sans-serif}
${B} .rd-letter .rd-sign{display:flex;align-items:center;gap:8px;font:600 13px/1.4 var(--sans);color:var(--ink-3);text-align:left;margin-top:12px}
${B} .rd-sign::before{content:"";width:18px;height:1px;background:currentColor;flex:none}
${B} .rd-face{float:left;width:72px;height:90px;margin:2px 20px 8px 0}
${B} .rd-face .alb-photo{height:100%}
${B} .rd-face .ph{width:100%;height:100%;object-fit:cover;display:block}
${B} .rd-letter::after{content:"";display:block;clear:both}

${B} .rd-calls { display: grid; gap: 30px; padding-top: 28px; }
${B} .rd-calls small { display: block; font: 600 13px/1.5 var(--sans); color: var(--ink-3); }
${B} .rd-calls p { margin-top: 2px; display: flex; flex-wrap: wrap; gap: 0 .5em; font: italic 400 clamp(26px, 3.8cqi, 42px)/1.18 var(--accent-serif); letter-spacing: -.01em; color: var(--k); }

${B} .rd-ledger { display: grid; grid-template-columns: 1fr 1fr; gap: 0 40px; font-size: 15.5px; line-height: 1.7; }
${B} .rd-ledger > div { padding-top: 26px; }
${B} .rd-ledger dt { font: 800 15px/1.4 var(--sans); letter-spacing: -.01em; padding-bottom: 10px; border-bottom: 1px solid var(--ink); }
${B} .rd-ledger dd { padding: 14px 0; border-bottom: 1px solid var(--rule); color: var(--ink-2); }
${B} .rd-ledger dd > b { display: block; font-weight: 700; color: var(--ink); }
${B} .rd-ledger dd small { display: block; font: 500 13px/1.6 var(--sans); color: var(--ink-3); font-variant-numeric: tabular-nums; }
${B} .rd-ledger .alb-block--progress dd { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
${B} .rd-ledger .rd-steps { font: 600 13px/1.5 var(--sans); color: var(--ink-3); white-space: nowrap; }
${B} .rd-ledger .rd-steps .on { color: var(--ink); }

${B} .rd-colophon { margin-top: 120px; padding: 30px clamp(24px, 5cqi, 72px) 44px; background: var(--c); color: #fff; display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; font: 600 14px/1.5 var(--sans); font-variant-numeric: tabular-nums; }
${B} .rd-colophon b { font-weight: 800; letter-spacing: -.02em; }

@container (max-width: 900px) {
  ${B} { font-size: 16.5px; }
  ${B} .rd-cover { padding: 40px 22px 36px; }
  ${B} .rd-cover .rd-cover-foot { grid-template-columns: 1fr; }
  ${B} .rd-shell { grid-template-columns: minmax(0, 1fr); padding: 0; }
  ${B} .rd-rail { display: none; }
  ${B} .rd-toc { display: block; padding: 36px 22px 4px; }
  ${B} .rd-toc h2 { font: 800 15px/1.4 var(--sans); padding-bottom: 10px; border-bottom: 1px solid var(--ink); }
  ${B} .rd-toc li > :is(a,button,span) { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 0 8px; align-items: baseline; min-height: 48px; padding: 11px 0; border-bottom: 1px solid var(--rule); font: 700 15.5px/1.4 var(--sans); letter-spacing: -.02em; }
  ${B} .rd-toc li i { font-size: 22px; color: var(--k); }
  ${B} .rd-toc li span { font: 400 12.5px/1.4 var(--sans); font-style: normal; color: var(--ink-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
  ${B} .rd-chapter, ${B} .rd-chapter + .rd-chapter { padding-top: 56px; }
  ${B} .rd-chapter > div.rd-row { padding: 26px 22px 30px; gap: 0 18px; }
  ${B} .rd-chapter > div.rd-row .rd-num { font-size: 68px; }
  ${B} .rd-chapter .rd-lede { font-size: 16.5px; margin-top: 22px; }
  ${B} .rd-scene { grid-template-columns: 1fr; padding: 36px 22px 0; }
  ${B} .rd-scene .rd-note { position: static; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 8px; margin-bottom: 10px; }
  ${B} .rd-scene .rd-note .rd-hm { font-size: 28px; margin: 0; }
  ${B} .rd-scene .rd-note .rd-day { display: inline; font-size: 28px; margin: 0; }
  ${B} .rd-scene + .rd-scene > .rd-text { border-top: 0; padding-top: 0; }
  ${B} .rd-scene + .rd-scene { margin-top: 36px; border-top: 1px solid var(--rule); }
  ${B} .rd-scene + .rd-scene .rd-note { padding-top: 0; }
  ${B} .rd-line p { font-size: 20.5px; }
  ${B} .rd-sec.alb-block--quotes { margin-top: 72px; padding: 52px 22px 60px; }
  ${B} .rd-sec.alb-block--quotes li { max-width: 94%; }
  ${B} .rd-sec { padding: 72px 22px 0; }
  ${B} .rd-vows li { grid-template-columns: 1fr; gap: 10px; }
  ${B} .rd-letters, ${B} .rd-ledger { grid-template-columns: 1fr; }
  ${B} .rd-colophon { margin-top: 80px; padding: 26px 22px 36px; }
}


/* Photo geometry from the mockup; real photos retain the reading renderer's image behaviour. */
${B} .rd-plates {display:grid;gap:12px;margin-top:24px}${B} .rd-plates .alb-photo {margin:0}
${B} .rd-plates.n2, ${B} .rd-plates.n4 {grid-template-columns:1fr 1fr}${B} .rd-plates.n3, ${B} .rd-plates.n5 {grid-template-columns:1fr 1fr 1fr}
${B} .rd-shots {display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:28px}${B} .rd-shots .alb-photo {margin:0}
${B} .rd-cover.has-photo {grid-template-columns:minmax(0,1fr) minmax(0,360px);grid-template-rows:1fr auto;column-gap:48px}
${B} .rd-cover.has-photo .rd-cover-foot {grid-column:1/-1}
${B} .rd-cover-photo {grid-column:2;grid-row:1;margin:0;aspect-ratio:4/5;align-self:start}${B} .rd-cover-photo .ph {color:#ffffffd6}
@container (max-width:900px){${B} .rd-cover.has-photo {grid-template-columns:1fr;grid-template-rows:none}${B} .rd-cover-photo {grid-column:1;width:78%}}

${B}{--c1:#2438b8;--lift1:#9fb0ff;--c2:#bf3f27;--lift2:#ff9d85;--c3:#1e5b4a;--lift3:#7fd3b6;--c4:#7a2e52;--lift4:#eb9cc4;--c5:#22303f;--lift5:#a9bfd6}
${B}[data-tint=sea]{--c1:#0f4c81;--lift1:color-mix(in oklab, #0f4c81 45%, white);--c2:#17766b;--lift2:color-mix(in oklab, #17766b 45%, white);--c3:#2c5f8a;--lift3:color-mix(in oklab, #2c5f8a 45%, white);--c4:#3b4a8c;--lift4:color-mix(in oklab, #3b4a8c 45%, white);--c5:#1b2a41;--lift5:color-mix(in oklab, #1b2a41 45%, white)}
${B}[data-tint=dusk]{--c1:#b23a2e;--lift1:color-mix(in oklab, #b23a2e 45%, white);--c2:#a8501a;--lift2:color-mix(in oklab, #a8501a 45%, white);--c3:#8a2d52;--lift3:color-mix(in oklab, #8a2d52 45%, white);--c4:#5b2a6b;--lift4:color-mix(in oklab, #5b2a6b 45%, white);--c5:#3a2440;--lift5:color-mix(in oklab, #3a2440 45%, white)}
${B}[data-tint=forest]{--c1:#1e5b4a;--lift1:color-mix(in oklab, #1e5b4a 45%, white);--c2:#3d6b2f;--lift2:color-mix(in oklab, #3d6b2f 45%, white);--c3:#6b5b1e;--lift3:color-mix(in oklab, #6b5b1e 45%, white);--c4:#7a4a23;--lift4:color-mix(in oklab, #7a4a23 45%, white);--c5:#23352c;--lift5:color-mix(in oklab, #23352c 45%, white)}
${B}[data-tint=ink]{--c1:#15161a;--lift1:color-mix(in oklab, #15161a 45%, white);--c2:#3a3b40;--lift2:color-mix(in oklab, #3a3b40 45%, white);--c3:#55565d;--lift3:color-mix(in oklab, #55565d 45%, white);--c4:#2a2b30;--lift4:color-mix(in oklab, #2a2b30 45%, white);--c5:#6b4a2a;--lift5:color-mix(in oklab, #6b4a2a 45%, white)}
${B} .rd-chapter:nth-of-type(5n+1){--c:var(--c1)}
${B} :is(.rd-rail,.rd-toc) li:nth-child(5n+1){--k:var(--c1)}
${B} .rd-said li:nth-child(5n+1){--k:var(--lift1)}
${B} .rd-chapter:nth-of-type(5n+2){--c:var(--c2)}
${B} :is(.rd-rail,.rd-toc) li:nth-child(5n+2){--k:var(--c2)}
${B} .rd-said li:nth-child(5n+2){--k:var(--lift2)}
${B} .rd-chapter:nth-of-type(5n+3){--c:var(--c3)}
${B} :is(.rd-rail,.rd-toc) li:nth-child(5n+3){--k:var(--c3)}
${B} .rd-said li:nth-child(5n+3){--k:var(--lift3)}
${B} .rd-chapter:nth-of-type(5n+4){--c:var(--c4)}
${B} :is(.rd-rail,.rd-toc) li:nth-child(5n+4){--k:var(--c4)}
${B} .rd-said li:nth-child(5n+4){--k:var(--lift4)}
${B} .rd-chapter:nth-of-type(5n+5){--c:var(--c5)}
${B} :is(.rd-rail,.rd-toc) li:nth-child(5n+5){--k:var(--c5)}
${B} .rd-said li:nth-child(5n+5){--k:var(--lift5)}

/* Adapt the shared field and photo ownership wrappers to the mockup geometry. */
${B}{container-type:inline-size;isolation:isolate;overflow-x:clip;min-height:100%;--c:var(--c1)}
${B} :is(section,div,li,figure){min-width:0}
${B} :is(a,.rd-jump){font:inherit;background:none;border:0;padding:0;text-align:inherit;cursor:pointer}
${B} :is(.rd-cover,.rd-chapter>div.rd-row) :is(a,button,[tabindex]):focus-visible{outline-color:#fff}
${B} .rd-rail li b{font:inherit}
${B} :is(.rd-rail,.rd-toc) li > :is(a,button,span){width:100%}
${B} .rd-cover-title{min-width:0}
${B} .rd-who{margin:0}
${B} .rd-card{font:400 15px/1.6 var(--sans)}
${B} .rd-chapter>div.rd-row>.rd-text{display:contents}
${B} .rd-chapter>div.rd-row>.rd-num{grid-column:1;grid-row:1/3}
${B} .rd-chapter :is(h2,.rd-span){grid-column:2}
${B} .rd-chapter .rd-lede{grid-column:1/-1}
${B} :is(.rd-time,.rd-inline-note){display:none}
${B} .rd-place{display:block}
${B} .rd-sec .rd-row{display:block}
${B} .rd-sec.alb-block--quotes .rd-h2{padding:0;border:0}
${B} .rd-vow-copy{display:flex;flex-direction:column-reverse}
${B} .rd-direction--partner{--k:var(--c1)}
${B} .rd-direction--me{--k:var(--c2)}
${B} .rd-calls em{font:inherit;font-style:inherit}
${B} .rd-ledger{grid-auto-flow:row}
${B} .rd-ledger>.alb-block--progress{grid-column:2;grid-row:1/4}
${B} .rd-ledger>:not(.alb-block--progress){grid-column:1}
${B} .rd-ledger .alb-block--progress dd > b{display:inline}
${B} .alb-photo{margin:0;min-width:0;overflow:hidden}
${B} .rd-plates .ph{display:block;width:100%;height:auto}
${B} .rd-plates:not(.n1) .ph{aspect-ratio:3/2;object-fit:cover}
${B} .rd-shots .ph{display:block;aspect-ratio:1;width:100%;height:auto;object-fit:cover}
${B} .rd-cover-photo .alb-photo{aspect-ratio:4/5}
${B} .rd-cover-photo .ph{display:block;width:100%;height:100%;object-fit:cover}
/* Unspecified blocks retain the book's behaviour, using this skin's existing type and paper. */
${B} .rd-writing{margin-top:22px;white-space:pre-line;text-wrap:pretty}
${B} .rd-single .alb-photo{margin-top:28px}
${B} .rd-single .ph{display:block;width:100%;height:auto}
${B} .rd-divider{border:0;border-top:1px solid var(--rule);margin:136px auto 0;width:min(640px,calc(100% - 56px))}
${B} .rd-people{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:30px}
${B} .rd-people .alb-photo{aspect-ratio:4/5;background:var(--paper-2)}
${B} .rd-people .ph{width:100%;height:100%;object-fit:cover;display:block}
${B} .rd-people figcaption{margin-top:10px;font:600 17px/1.5 var(--sans)}
${B}.alb-mode--edit .rd-scene>.rd-note{position:static}
${B} .alb-block-tools{margin:24px auto 0}
${B} .alb-block--hidden{opacity:.55}
${B} .xp-slot{display:grid;place-items:center;width:100%;min-height:72px;margin-top:24px;border:1.5px dashed var(--ink-3);background:none;color:var(--ink-3);font:500 13px/1 var(--sans)}
@container (max-width:900px){
 ${B} .rd-plates.n5{grid-template-columns:1fr 1fr}
 ${B} .rd-toc li b{font:inherit}
 ${B} .rd-toc .rd-after{display:none}
 ${B} .rd-place{display:inline}
 ${B} .rd-ledger>.alb-block--progress,${B} .rd-ledger>:not(.alb-block--progress){grid-column:1;grid-row:auto}
 ${B} .rd-divider{margin-top:88px;width:min(640px,calc(100% - 48px))}
}
@media (prefers-reduced-motion:reduce){${B} *{scroll-behavior:auto!important;transition:none!important}}
`;
