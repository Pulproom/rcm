/** LP skin of the shared reading skeleton. Values follow the approved C mockup. */
const C = ".alb-album.alb-theme--lp";
export const LP_READING_CSS = String.raw`
@font-face { font-family: "Stellar"; font-weight: 700; font-display: swap; src: url("https://cdn.jsdelivr.net/gh/Project-Noonnu/2608201622@stellar-serif/stellar-serif/Stellar_Serif_Bold_Condensed.woff2") format("woff2"); }
${C} { --sleeve: #efb71d; --sleeve-ink: #17130c; --sleeve-ink-2: color-mix(in oklab, var(--sleeve-ink) 72%, var(--sleeve)); --sleeve-rule: color-mix(in srgb, var(--sleeve-ink) 35%, transparent);
  --sheet: #f6f3ec; --ink: #17140f; --ink-2: #403b33; --ink-3: #6a645a; --rule: #d5d0c4;
  --vinyl: #121110; --label: #d9482b;
  --display: "Stellar", "Pretendard Variable", serif; --sans: "Pretendard Variable", Pretendard, system-ui, sans-serif;
  --pad: clamp(24px, 5cqi, 72px); --wide: 1080px; }
${C}, ${C} * { box-sizing: border-box; }
${C} { margin: 0; background: var(--sheet); color: var(--ink); font: 400 17px/1.85 var(--sans); word-break: keep-all; overflow-wrap: anywhere; -webkit-font-smoothing: antialiased; }
${C} ::selection { background: var(--sleeve); color: var(--sleeve-ink); }
${C} :is(a,.rd-jump) { color: inherit; text-decoration: none; }
${C} :is(a,.rd-jump):focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
${C} h1, ${C} h2, ${C} h3, ${C} p, ${C} blockquote, ${C} ol, ${C} ul, ${C} dl, ${C} dd { margin: 0; padding: 0; }
${C} ol, ${C} ul { list-style: none; }
${C} :is(.rd-chapter,.rd-sec,.rd-toc) { max-width: var(--wide); margin: 0 auto; padding: 0 var(--pad); }
${C} .rd-cover { position: relative; min-height: min(calc(100svh - 56px), 860px); display: grid; align-content: space-between; gap: 40px; padding: 52px var(--pad) 48px; background: var(--sleeve); color: var(--sleeve-ink); overflow: hidden; isolation: isolate; }
${C} .rd-cover h1 { font: 700 clamp(64px, 13.5cqi, 176px)/0.92 var(--display); letter-spacing: -.01em; text-wrap: balance; max-width: 8em; }
${C} .rd-cover .rd-cover-foot { display: grid; gap: 22px; max-width: min(46%, 520px); }
${C} .rd-cover .rd-cover-meta { padding-top: 16px; border-top: 2px solid var(--sleeve-ink); font: 700 15px/1.6 var(--sans); font-variant-numeric: tabular-nums; }
${C} .rd-cover .rd-cover-meta .rd-card { display: block; font-weight: 500; color: var(--sleeve-ink-2); }
${C} .rd-cover blockquote p { font: 700 clamp(26px, 3.4cqi, 40px)/1.18 var(--display); text-wrap: balance; }
${C} .rd-cover cite { display: block; margin-top: 8px; font: 600 13.5px/1.4 var(--sans); font-style: normal; color: var(--sleeve-ink-2); }
${C} .rd-disc { position: absolute; z-index: -1; right: calc(-1 * clamp(90px, 13cqi, 190px)); bottom: calc(-1 * clamp(110px, 15cqi, 210px)); width: clamp(360px, 58cqi, 760px); aspect-ratio: 1; border-radius: 50%;
  background:
    radial-gradient(circle, var(--sheet) 0 1.3%, #0000 1.4%),
    radial-gradient(circle, var(--label) 0 17.5%, #0000 17.7%),
    repeating-radial-gradient(circle, #ffffff12 0 1px, #0000 1px 5px),
    conic-gradient(from 20deg, #0000 0 8%, #ffffff24 12%, #0000 17% 50%, #ffffff1c 56%, #0000 62%),
    var(--vinyl);
  box-shadow: 0 24px 60px -24px #2a1e0299, 0 4px 10px -4px #2a1e0266; }
${C} .rd-toc { padding-top: 84px; }
${C} .rd-toc .rd-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 0 48px; }
${C} .rd-toc h2 { font: 700 30px/1.2 var(--display); padding-bottom: 12px; border-bottom: 3px solid var(--ink); }
${C} .rd-toc li :is(a,.rd-jump) { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 0 10px; align-items: baseline; padding: 14px 0; border-bottom: 1px solid var(--rule); }
${C} .rd-toc li i { font: 700 22px/1.2 var(--display); font-style: normal; }
${C} .rd-toc li b { font: 650 16.5px/1.45 var(--sans); letter-spacing: -.015em; text-wrap: pretty; }
${C} .rd-toc li span { font: 500 13px/1.5 var(--sans); color: var(--ink-3); white-space: nowrap; font-variant-numeric: tabular-nums; }
${C} .rd-toc li :is(a,.rd-jump):hover b { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; }
${C} .rd-toc .rd-after { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 0 18px; font: 500 13.5px/1.5 var(--sans); color: var(--ink-3); }
${C} .rd-toc .rd-after :is(a,.rd-jump) { padding: 9px 0; }
${C} .rd-toc .rd-after :is(a,.rd-jump):hover { color: var(--ink); }
${C} .rd-chapter { padding-top: 104px; }
${C} .rd-chapter > .rd-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 26px; align-items: end; padding-bottom: 18px; border-bottom: 3px solid var(--ink); }
${C} .rd-chapter .rd-num { align-self: stretch; display: grid; place-items: center; min-width: 108px; padding: 10px 16px 4px; background: var(--sleeve); color: var(--sleeve-ink); font: 700 64px/1 var(--display); }
${C} .rd-chapter h2 { font: 700 clamp(32px, 4.6cqi, 54px)/1.08 var(--display); text-wrap: balance; }
${C} .rd-chapter .rd-span { margin-top: 8px; font: 500 13.5px/1.5 var(--sans); color: var(--ink-3); font-variant-numeric: tabular-nums; }
${C} .rd-chapter .rd-lede { margin-top: 22px; max-width: 46em; font: 500 18.5px/1.75 var(--sans); letter-spacing: -.01em; color: var(--ink-2); text-wrap: pretty; }
${C} .rd-scene { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 320px); gap: 0 56px; padding-top: 44px; margin-top: 44px; border-top: 1px solid var(--rule); }
${C} .rd-chapter > .rd-row + .rd-scene, ${C} .rd-lede + .rd-scene { border-top: 0; margin-top: 0; }
${C} .rd-scene.solo { grid-template-columns: minmax(0, 44em); }
${C} .rd-scene h3 { font: 700 21.5px/1.42 var(--sans); letter-spacing: -.03em; text-wrap: balance; }
${C} .rd-scene .rd-at { margin-top: 6px; font: 500 13px/1.6 var(--sans); color: var(--ink-3); font-variant-numeric: tabular-nums; }
${C} .rd-scene .rd-body { margin-top: 14px; color: var(--ink-2); text-wrap: pretty; }
${C} .rd-lyric { align-self: start; position: sticky; top: 28px; padding: 22px 0 0; border-top: 3px solid var(--ink); }
${C} .rd-lyric p { font: 700 27px/1.24 var(--display); }
${C} .rd-lyric p span { display: block; }
${C} .rd-lyric cite, ${C} .rd-sec.alb-block--quotes cite { display: block; margin-top: 12px; font: 600 13px/1.4 var(--sans); font-style: normal; color: var(--ink-3); }
${C} .rd-sec.alb-block--quotes { margin-top: 120px; padding: 76px var(--pad) 88px; background: var(--sleeve); color: var(--sleeve-ink); text-align: center; }
${C} .rd-sec.alb-block--quotes h2 { font: 700 15px/1.4 var(--sans); color: var(--sleeve-ink-2); }
${C} .rd-sec.alb-block--quotes ol { margin: 40px auto 0; max-width: 900px; display: grid; gap: 46px; }
${C} .rd-sec.alb-block--quotes p { font: 700 clamp(30px, 4.6cqi, 56px)/1.12 var(--display); text-wrap: balance; }
${C} .rd-sec.alb-block--quotes cite { color: var(--sleeve-ink-2); }
${C} .rd-sec { padding-top: 104px; }
${C} .rd-sec .rd-h2 { font: 700 clamp(34px, 4.6cqi, 54px)/1.08 var(--display); padding-bottom: 14px; border-bottom: 3px solid var(--ink); }
${C} .rd-vows li { display: grid; grid-template-columns: 92px minmax(0, 44em); gap: 0 26px; padding: 24px 0; border-bottom: 1px solid var(--rule); }
${C} .rd-vows .rd-st { font: 700 25px/1.25 var(--display); color: var(--ink-3); }
${C} .rd-vows .kept .rd-st { color: var(--ink); }
${C} .rd-vows .kept .rd-st::after { content: ""; display: block; width: 28px; height: 4px; margin-top: 4px; background: var(--sleeve); }
${C} .rd-vows p { font-weight: 500; text-wrap: pretty; }
${C} .rd-vows small { display: block; margin-top: 6px; font: 500 13px/1.5 var(--sans); color: var(--ink-3); }
${C} .rd-letters { display: grid; grid-template-columns: 1fr 1fr; gap: 0 48px; padding-top: 28px; }
${C} .rd-letters h3 { font: 700 27px/1.2 var(--display); }
${C} .rd-letters p { margin-top: 12px; color: var(--ink-2); text-wrap: pretty; }
${C} .rd-calls { display: grid; gap: 28px; padding-top: 28px; }
${C} .rd-calls small { display: block; font: 600 13px/1.5 var(--sans); color: var(--ink-3); }
${C} .rd-calls p { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 10px 12px; }
${C} .rd-calls p > em { padding: 6px 18px 2px; background: var(--vinyl); color: var(--sheet); font: 700 clamp(28px, 4cqi, 44px)/1.2 var(--display); }
${C} .rd-calls dd + dd p > em { background: var(--sleeve); color: var(--sleeve-ink); }
${C} .rd-ledger { padding-top: 10px; }
${C} .rd-ledger > div { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 0 26px; padding: 22px 0; border-bottom: 1px solid var(--rule); }
${C} .rd-ledger dt { font: 700 23px/1.3 var(--display); }
${C} .rd-ledger dd { padding: 3px 0 12px; font-size: 15.5px; line-height: 1.7; color: var(--ink-2); }
${C} .rd-ledger dd:last-child { padding-bottom: 0; }
${C} .rd-ledger dd b { font-weight: 700; color: var(--ink); }
${C} .rd-ledger dd small { display: block; font: 500 13px/1.6 var(--sans); color: var(--ink-3); font-variant-numeric: tabular-nums; }
${C} .rd-ledger .alb-block--progress dd { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; max-width: 34em; }
${C} .rd-ledger .rd-steps { font: 600 13px/1.5 var(--sans); color: var(--ink-3); white-space: nowrap; }
${C} .rd-ledger .rd-steps .on { color: var(--ink); }
${C} .rd-colophon { margin-top: 120px; padding: 30px var(--pad) 40px; background: var(--vinyl); color: #e9e4d8; display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap; font: 500 14px/1.5 var(--sans); font-variant-numeric: tabular-nums; }
${C} .rd-colophon b { font: 700 26px/1.1 var(--display); color: var(--sleeve); }
@container (max-width: 860px) {
${C} { font-size: 16.5px; }
${C} .rd-cover { padding: 36px 22px 34px; }
${C} .rd-cover .rd-cover-foot { max-width: none; }
${C} .rd-disc { right: -150px; top: 150px; bottom: auto; width: 400px; }
${C} :is(.rd-chapter,.rd-sec,.rd-toc) { padding: 0 22px; }
${C} .rd-toc { padding-top: 56px; }
${C} .rd-toc .rd-sides { grid-template-columns: 1fr; gap: 34px; }
${C} .rd-chapter, ${C} .rd-sec { padding-top: 76px; }
${C} .rd-chapter > .rd-row { grid-template-columns: 1fr; gap: 14px; align-items: start; }
${C} .rd-chapter .rd-num { justify-self: start; min-width: 0; font-size: 44px; padding: 8px 14px 2px; }
${C} .rd-scene, ${C} .rd-scene.solo { grid-template-columns: 1fr; padding-top: 36px; margin-top: 36px; }
${C} .rd-lyric { position: static; margin-top: 26px; }
${C} .rd-lyric p { font-size: 25px; }
${C} .rd-sec.alb-block--quotes { margin-top: 84px; padding: 54px 22px 62px; }
${C} .rd-vows li { grid-template-columns: 1fr; gap: 8px; }
${C} .rd-letters { grid-template-columns: 1fr; gap: 30px; }
${C} .rd-ledger > div { grid-template-columns: 1fr; gap: 10px; }
${C} .rd-colophon { margin-top: 84px; padding: 26px 22px 34px; }
}
${C} .rd-plates { display:grid;gap:12px;margin-top:24px }
${C} .rd-plates figure { margin:0 }
${C} .rd-plates.n2, ${C} .rd-plates.n4 { grid-template-columns:1fr 1fr }
${C} .rd-plates.n3, ${C} .rd-plates.n5 { grid-template-columns:1fr 1fr 1fr }
${C} .rd-shots { display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:28px }
${C} .rd-shots figure { margin:0 }
${C} .rd-rec { position:absolute;right:calc(var(--pad) + 9cqi);top:50%;transform:translateY(-54%);width:min(33cqi,400px);aspect-ratio:1 }
${C} .rd-rec .rd-art { position:absolute;inset:0;margin:0;background:var(--sleeve);box-shadow:0 18px 40px -22px #2a1e02b3,0 2px 6px -2px #2a1e0266 }
${C} .rd-rec .rd-disc { position:absolute;inset:auto;top:0;left:27%;right:auto;bottom:auto;width:100%;z-index:-1 }
@container (max-width:860px) {
${C} .rd-plates.n5 { grid-template-columns:1fr 1fr }
${C} .rd-cover .rd-cover-foot { order:2 }
${C} .rd-rec { order:1;position:relative;right:auto;top:auto;transform:none;width:62%;margin:6px 0 }
${C} .rd-rec .rd-disc { left:30%;top:0;width:100% }
}

/* Shared ownership wrappers and unspecified blocks retain the book's behaviour. */
${C}{container-type:inline-size;isolation:isolate;overflow-x:clip;min-height:100%;--paper:var(--sheet);--paper-2:#e4e1d8}
${C} :is(section,div,li,figure){min-width:0}
${C} :is(a,.rd-jump){font:inherit;background:none;border:0;padding:0;text-align:inherit;cursor:pointer}
${C} :is(a,button,[tabindex]):focus-visible{outline:2px solid var(--ink);outline-offset:3px}
${C} .rd-toc li > :is(a,button,span){width:100%;display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:0 10px;align-items:baseline;padding:14px 0;border-bottom:1px solid var(--rule)}
${C} .rd-cover .rd-amp{font:inherit}
${C} .rd-cover .rd-who{font:inherit}
${C} .rd-cover .rd-card{display:block;font:500 15px/1.6 var(--sans);color:var(--sleeve-ink-2)}
${C} .rd-sec.alb-block--quotes{max-width:none}
${C} .rd-sec.alb-block--quotes .rd-h2{padding:0;border:0}
${C} .rd-sec.alb-block--quotes .rd-said li{justify-self:center}
${C} .rd-lyric .rd-line + .rd-line{margin-top:26px}
${C} .rd-scene .rd-body{white-space:pre-line}
${C} .rd-vow-copy{display:flex;flex-direction:column-reverse}
${C} .rd-vows .rd-to{display:block;margin-top:6px;font:500 13px/1.5 var(--sans);color:var(--ink-3)}
${C} .rd-calls em{font-style:normal}
${C} .rd-arrow{font-family:"Pretendard Variable",system-ui,sans-serif}
${C} .rd-letter .rd-sign{display:flex;align-items:center;gap:8px;font:600 13px/1.4 var(--sans);color:var(--ink-3);text-align:left;margin-top:12px}
${C} .rd-sign::before{content:"";width:18px;height:1px;background:currentColor;flex:none}
${C} .rd-face{float:left;width:72px;height:90px;margin:2px 20px 8px 0}
${C} .rd-face .alb-photo{height:100%}
${C} .rd-face .ph{width:100%;height:100%;object-fit:cover;display:block}
${C} .rd-letter::after{content:"";display:block;clear:both}
${C} .alb-photo{margin:0;min-width:0;overflow:hidden}
${C} .rd-plates .ph{display:block;width:100%;height:auto}
${C} .rd-plates:not(.n1) .ph{aspect-ratio:3/2;object-fit:cover}
${C} .rd-shots .ph{display:block;aspect-ratio:1;width:100%;height:auto;object-fit:cover}
${C} .rd-rec .alb-photo{height:100%;aspect-ratio:1}
${C} .rd-rec .ph{display:block;width:100%;height:100%;object-fit:cover}
${C} .rd-writing{margin-top:22px;white-space:pre-line;text-wrap:pretty}
${C} .rd-single .alb-photo{margin-top:28px}
${C} .rd-single .ph{display:block;width:100%;height:auto}
${C} .rd-divider{border:0;border-top:1px solid var(--rule);margin:136px auto 0;width:min(640px,calc(100% - 56px))}
${C} .rd-people{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:30px}
${C} .rd-people .alb-photo{aspect-ratio:4/5;background:var(--paper-2)}
${C} .rd-people .ph{width:100%;height:100%;object-fit:cover;display:block}
${C} .rd-people figcaption{margin-top:10px;font:600 17px/1.5 var(--display)}
${C} .alb-block-tools{margin:24px auto 0}
${C} .alb-block--hidden{opacity:.55}
${C} .xp-slot{display:grid;place-items:center;width:100%;min-height:72px;margin-top:24px;border:1.5px dashed var(--ink-3);background:none;color:var(--ink-3);font:500 13px/1 var(--sans)}
@container (max-width:860px){${C} .rd-divider{margin-top:88px;width:min(640px,calc(100% - 48px))}}
/* Tomato is nudged from #d9482b so the cream reaches 4.71:1 for small text (approved tint list allows contrast nudges). */
${C}[data-tint=tomato]{--sleeve:#c23e22;--sleeve-ink:#fff1dc;--label:#efb71d;--sleeve-ink-2:color-mix(in oklab,var(--sleeve-ink) 100%,var(--sleeve))}
${C}[data-tint=sky]{--sleeve:#8fc1e3;--sleeve-ink:#111a24;--label:#e8553a}
${C}[data-tint=pink]{--sleeve:#f2a9b6;--sleeve-ink:#2a1218;--label:#2b3f8f}
${C}[data-tint=black]{--sleeve:#1c1a19;--sleeve-ink:#efb71d;--label:#d9482b}
${C}[data-tint=black] .rd-disc{box-shadow:0 0 0 1px #ffffff26,0 24px 60px -24px #2a1e0299,0 4px 10px -4px #2a1e0266}
@media (prefers-reduced-motion:reduce){${C} *{scroll-behavior:auto!important}}
`;
