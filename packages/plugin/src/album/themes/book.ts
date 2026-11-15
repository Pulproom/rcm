/**
 * Theme "book" (한 권의 책): a cloth-bound hardcover on cool paper. Values follow the approved
 * reading mockup; the album scrolls inside the viewer, so viewport units become container units
 * and sticky notes stick to the album scroller.
 */
const noise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9 .55' numOctaves='3' seed='4'/%3E%3CfeColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 -.18'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
const B = ".alb-album.alb-theme--book";

export const BOOK_ALBUM_CSS = String.raw`
@font-face{font-family:"Eulyoo";font-weight:400;font-display: swap;src:url("https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2102-01@1.0/Eulyoo1945-Regular.woff") format("woff")}
@font-face{font-family:"Eulyoo";font-weight:600;font-display: swap;src:url("https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2102-01@1.0/Eulyoo1945-SemiBold.woff") format("woff")}
@font-face{font-family:"MaruBuri";font-weight:400;font-display: swap;src:url("https://hangeul.pstatic.net/hangeul_static/webfont/MaruBuri/MaruBuri-Regular.woff2") format("woff2")}
@font-face{font-family:"MaruBuri";font-weight:600;font-display: swap;src:url("https://hangeul.pstatic.net/hangeul_static/webfont/MaruBuri/MaruBuri-SemiBold.woff2") format("woff2")}
${B}{
 --paper:#f3f2ed;--paper-2:#fbfaf6;--ink:#1c1b1a;--ink-2:#4a4743;--ink-3:#6a665f;--rule:#d6d3c9;
 --cloth:#4a2f44;--cloth-ink:#f1e9e4;--accent:#5b3a52;
 --cloth-ink-2:color-mix(in srgb,var(--cloth-ink) 76%,var(--cloth));
 --serif:"MaruBuri","Noto Serif KR",serif;--display:"Eulyoo","MaruBuri",serif;--sans:"Pretendard Variable",Pretendard,system-ui,sans-serif;
 --margin:190px;--measure:640px;--gap:52px;--pad:28px;--sec:136px;
 container-type:inline-size;isolation:isolate;overflow-x:clip;min-height:100%;
 background:var(--paper);color:var(--ink);font:400 17px/1.95 var(--serif);
 word-break:keep-all;overflow-wrap:anywhere;-webkit-font-smoothing:antialiased;
}
${B}[data-tint=ink]{--cloth:#25282d;--accent:#3a3f47}
${B}[data-tint=pine]{--cloth:#2b4a3d;--accent:#2f5a48}
${B}[data-tint=navy]{--cloth:#25355c;--accent:#2d4273}
${B}[data-tint=brick]{--cloth:#7a3a2c;--accent:#8a4030}
${B},${B} *{box-sizing:border-box}
${B} ::selection{background:color-mix(in srgb,var(--accent) 22%,var(--paper));color:var(--ink)}
${B} :is(h1,h2,h3,p,blockquote,ol,ul,dl,dd,figure){margin:0;padding:0}
${B} :is(ol,ul){list-style:none}
${B} :is(a,.rd-jump){color:inherit;text-decoration:none;font:inherit;background:none;border:0;padding:0;text-align:inherit;cursor:pointer}
${B} :is(a,button,[tabindex]):focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:2px}
${B} :is(section,div,li,figure){min-width:0}

/* cover: a cloth-bound board */
${B} .rd-cover{position:relative;min-height:min(calc(100svh - 56px),860px);display:grid;grid-template-rows:auto auto 1fr;row-gap:0;align-content:space-between;padding:72px max(var(--pad),calc((100cqi - var(--margin) - var(--gap) - var(--measure)) / 2)) 64px;background:var(--cloth);color:var(--cloth-ink);overflow:hidden}
${B} .rd-cover::before{content:"";position:absolute;inset:0;background-image:${noise};opacity:.22;mix-blend-mode:soft-light;pointer-events:none}
${B} .rd-cover::after{content:"";position:absolute;inset:18px;border:1px solid color-mix(in srgb,var(--cloth-ink) 26%,transparent);pointer-events:none}
${B} .rd-cover>*{position:relative}
${B} .rd-cover-foot{display:contents}
${B} .rd-cover-meta{position:relative;grid-row:2}
${B} .rd-cover .rd-amp{font:inherit;letter-spacing:inherit}
${B} .rd-cover h1{font:600 clamp(52px,9.2cqi,96px)/1.08 var(--display);letter-spacing:-.025em;text-wrap:balance;max-width:11em}
${B} .rd-cover h1.long{font-size:clamp(38px,6.4cqi,68px);line-height:1.14}
${B} .rd-who{margin-top:28px;font:400 19px/1.6 var(--serif);color:var(--cloth-ink)}
${B} .rd-card{font:400 13.5px/1.6 var(--sans);color:var(--cloth-ink-2);letter-spacing:.01em}
${B} .rd-epigraph{position:relative;grid-row:3;align-self:end;margin-top:48px;max-width:30em;padding-top:22px;border-top:1px solid color-mix(in srgb,var(--cloth-ink) 34%,transparent)}
${B} .rd-epigraph p{font:400 clamp(20px,2.4cqi,26px)/1.6 var(--display);text-wrap:balance}
${B} .rd-epigraph cite,${B} .rd-cover cite{display:block;margin-top:10px;font:500 13px/1.4 var(--sans);font-style:normal;color:var(--cloth-ink-2)}
${B} .rd-cover.has-photo{grid-template-columns:minmax(0,1fr) minmax(0,330px);grid-template-rows:auto auto 1fr;column-gap:56px}
${B} .rd-cover.has-photo .rd-epigraph{grid-column:1;align-self:end}
${B} .rd-cover-photo{grid-column:2;grid-row:1/4;align-self:center}
${B} .rd-cover-photo .alb-photo{aspect-ratio:3/4;box-shadow:0 18px 40px -24px #0009}
${B} .rd-cover-photo .ph{width:100%;height:100%;object-fit:cover;display:block}

/* page grid: margin notes + text column */
${B} .rd-row{display:grid;grid-template-columns:var(--margin) minmax(0,var(--measure));column-gap:var(--gap);justify-content:center;padding:0 var(--pad)}
${B} .rd-row>.rd-note{grid-column:1;text-align:right}
${B} .rd-row>.rd-text{grid-column:2}
${B} .rd-note{font:400 13px/1.65 var(--sans);color:var(--ink-3);font-variant-numeric:tabular-nums}
${B} .rd-note b{display:block;font-weight:600;color:var(--ink-2)}
${B} .rd-hm{display:none}
${B} .rd-time::after{content:"\a";white-space:pre}
${B} .rd-h2{font:600 30px/1.3 var(--display);letter-spacing:-.02em}

${B} .rd-toc{padding-top:112px}
${B} .rd-toc ol{margin-top:28px;border-top:1px solid var(--ink)}
${B} .rd-toc li>*{display:grid;grid-template-columns:2.2em minmax(0,1fr) auto;gap:0 12px;align-items:baseline;width:100%;padding:15px 0;border-bottom:1px solid var(--rule)}
${B} .rd-toc li>.rd-jump:hover b,${B} .rd-toc li>a:hover b{color:var(--accent)}
${B} .rd-toc li i{font:600 17px/1.5 var(--display);font-style:normal;color:var(--accent);font-variant-numeric:tabular-nums}
${B} .rd-toc li b{font:600 17.5px/1.5 var(--display);text-wrap:pretty}
${B} .rd-toc li span{font:400 13px/1.5 var(--sans);color:var(--ink-3);white-space:nowrap;font-variant-numeric:tabular-nums}
${B} .rd-after{display:flex;flex-wrap:wrap;gap:0 18px;margin-top:10px;font:400 13.5px/1.9 var(--sans)}
${B} .rd-after>*{display:inline-flex;align-items:center;min-height:44px;color:var(--ink-2)}
${B} .rd-after>:hover{color:var(--accent)}

/* chapter */
${B} .rd-chapter{padding-top:var(--sec)}
${B} .rd-num{font:600 76px/1 var(--display);color:var(--accent);letter-spacing:-.04em;font-variant-numeric:lining-nums}
${B} .rd-chapter h2{font:600 clamp(28px,3.6cqi,38px)/1.32 var(--display);letter-spacing:-.02em;text-wrap:balance;padding-top:14px}
${B} .rd-span{margin-top:10px;font:400 13.5px/1.5 var(--sans);color:var(--ink-3);font-variant-numeric:tabular-nums}
${B} .rd-lede{margin-top:26px;padding-bottom:34px;border-bottom:1px solid var(--ink);font:400 19.5px/1.85 var(--serif);color:var(--ink-2);text-wrap:pretty}

${B} .rd-scene{padding-top:54px}
${B} .rd-scene>.rd-note{position:sticky;top:28px;align-self:start;padding-top:7px}
${B} .rd-scene h3{font:600 22px/1.5 var(--display);letter-spacing:-.015em;text-wrap:balance}
${B} .rd-inline-note{display:none}
${B} .rd-body{margin-top:14px;text-wrap:pretty;white-space:pre-line}
${B} .rd-scene+.rd-scene>.rd-text{border-top:1px solid var(--rule);padding-top:54px}
${B} .rd-scene+.rd-scene>.rd-note{padding-top:61px}
${B} .rd-line{position:relative;margin-top:30px;padding-left:34px}
${B} .rd-line::before{content:"\201C";position:absolute;left:-4px;top:-12px;font:600 54px/1 var(--display);color:var(--accent)}
${B} .rd-line p{font:400 21px/1.75 var(--display);letter-spacing:-.01em;text-wrap:pretty}
${B} :is(.rd-line,.rd-said li) cite{display:inline-flex;align-items:center;gap:8px;margin-top:8px;font:500 13px/1.4 var(--sans);font-style:normal;color:var(--ink-3)}
${B} :is(.rd-line,.rd-said li) cite::before{content:"";width:18px;height:1px;background:currentColor}

/* photos inside a scene: one at full measure keeps its own shape; two or more share fixed frames */
${B} .rd-plates{display:grid;gap:12px;margin-top:24px}
${B} .rd-plates .ph{display:block;width:100%;height:auto}
${B} .rd-plates.n2,${B} .rd-plates.n4{grid-template-columns:1fr 1fr}
${B} .rd-plates.n3,${B} .rd-plates.n5{grid-template-columns:1fr 1fr 1fr}
${B} .rd-plates:not(.n1) .ph{aspect-ratio:3/2;object-fit:cover}
${B} .rd-shots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:28px}
${B} .rd-shots .ph{aspect-ratio:1;width:100%;height:auto;object-fit:cover;display:block}
${B} .alb-photo[role=button]{cursor:zoom-in}

/* after the story */
${B} .rd-sec{padding-top:var(--sec)}
${B} .rd-said{margin-top:36px;display:grid;gap:34px}
${B} .rd-said li{max-width:86%}
${B} .rd-said li.r{justify-self:end;text-align:right}
${B} .rd-said p{font:400 24px/1.6 var(--display);letter-spacing:-.015em;text-wrap:balance}
${B} .rd-said li.r cite{flex-direction:row-reverse}
${B} .rd-vows{margin-top:30px;border-top:1px solid var(--ink)}
${B} .rd-vows li{padding:22px 0;border-bottom:1px solid var(--rule)}
${B} .rd-st{display:inline-flex;align-items:center;gap:7px;font:600 13px/1 var(--sans);color:var(--ink-3)}
${B} .rd-st::before{content:"";flex:none;box-sizing:border-box;width:9px;height:9px;border-radius:50%;border:1.5px solid currentColor}
${B} .kept .rd-st{color:var(--accent)}
${B} .kept .rd-st::before{background:currentColor}
${B} .broken .rd-st::before{background:linear-gradient(135deg,transparent 45%,currentColor 45% 55%,transparent 55%)}
${B} .rd-vow-copy{display:contents}
${B} .rd-vow-copy>.rd-to{margin-left:10px;font:400 13px/1 var(--sans);color:var(--ink-3)}
${B} .rd-vows p{margin-top:8px;text-wrap:pretty}
${B} .rd-letters{margin-top:30px;display:grid;gap:22px}
${B} .rd-letter{padding:30px 32px 34px;background:var(--paper-2);box-shadow:0 1px 0 #fff inset,0 14px 30px -22px #3a2c3466,0 2px 5px -3px #3a2c3440}
${B} .rd-letter h3{font:600 19px/1.5 var(--display);color:var(--accent)}
${B} .rd-letter p{margin-top:12px;text-wrap:pretty}
${B} .rd-arrow{font-family:"Pretendard Variable",system-ui,sans-serif}
${B} .rd-letter .rd-sign{display:flex;align-items:center;justify-content:flex-end;gap:8px;font:400 17px/1.5 var(--display);color:var(--ink-2);margin-top:16px}
${B} .rd-sign::before{content:"";width:18px;height:1px;background:currentColor;flex:none}
${B} .rd-face{float:left;width:64px;height:80px;margin:4px 18px 6px 0;box-shadow:0 6px 14px -8px #3a2c3466}
${B} .rd-face .alb-photo{height:100%}
${B} .rd-face .ph{width:100%;height:100%;object-fit:cover;display:block}
${B} .rd-letter::after{content:"";display:block;clear:both}
${B} .rd-ledger{margin-top:30px;border-top:1px solid var(--ink);font:400 15px/1.75 var(--sans);color:var(--ink-2)}
${B} .rd-ledger>div{display:grid;grid-template-columns:7.5em minmax(0,1fr);gap:4px 20px;padding:20px 0;border-bottom:1px solid var(--rule)}
${B} .rd-ledger dt{font:600 14px/1.9 var(--sans);color:var(--ink)}
${B} .rd-ledger dd+dd{grid-column:2}
${B} .rd-ledger em{display:inline-block;font:400 21px/1.5 var(--display);font-style:italic;color:var(--ink);margin-right:14px}
${B} .rd-ledger small{display:block;font-size:13px;color:var(--ink-3);font-variant-numeric:tabular-nums}
${B} .rd-ledger b{font-weight:600;color:var(--ink)}
${B} .rd-ledger .on{color:var(--accent);font-weight:600}
${B} .rd-writing{margin-top:22px;white-space:pre-line;text-wrap:pretty}
${B} .rd-single .alb-photo{margin-top:28px}
${B} .rd-single .ph{display:block;width:100%;height:auto}
${B} .rd-divider{border:0;border-top:1px solid var(--rule);margin:var(--sec) auto 0;width:min(var(--measure),calc(100% - 2 * var(--pad)))}
${B} .rd-people{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:30px}
${B} .rd-people .alb-photo{aspect-ratio:4/5;background:var(--paper-2)}
${B} .rd-people .ph{width:100%;height:100%;object-fit:cover;display:block}
${B} .rd-people figcaption,${B} .rd-people h3{margin-top:10px;font:600 17px/1.5 var(--display)}
${B} .rd-colophon{margin-top:var(--sec);padding:44px var(--pad) 72px;border-top:1px solid var(--rule);text-align:center;font:400 13px/1.8 var(--sans);color:var(--ink-3)}
${B} .rd-colophon b{display:block;font:600 17px/1.6 var(--display);color:var(--ink)}

/* edit mode keeps the reading layout; tools sit above each block */
${B}.alb-mode--edit .rd-scene>.rd-note{position:static}
${B} .alb-block-tools{max-width:calc(var(--margin) + var(--gap) + var(--measure));margin:24px auto 0;padding:0 var(--pad)}
${B} .alb-block--hidden{opacity:.55}
${B} .xp-slot{display:grid;place-items:center;width:100%;min-height:72px;margin-top:24px;border:1.5px dashed var(--ink-3);background:none;color:var(--ink-3);font:500 13px/1 var(--sans)}

@container (max-width:940px){
 ${B}{font-size:16.5px;line-height:1.9;--pad:24px;--sec:88px}
 ${B} .rd-cover{padding:56px 24px 48px;min-height:min(calc(100svh - 148px),760px)}
 ${B} .rd-cover::after{inset:10px}
 ${B} .rd-cover.has-photo{grid-template-columns:1fr;grid-template-rows:auto auto auto 1fr;row-gap:0}
 ${B} .rd-cover.has-photo .rd-epigraph{grid-row:4;margin-top:28px}
 ${B} .rd-cover.has-photo .rd-cover-photo{grid-row:3;margin-top:28px}
 ${B} .rd-cover-photo{grid-column:1;grid-row:auto;width:74%}
 ${B} .rd-cover-photo .alb-photo{aspect-ratio:4/5}
 ${B} .rd-row{grid-template-columns:minmax(0,var(--measure))}
 ${B} .rd-row>.rd-note,${B} .rd-row>.rd-text{grid-column:1}
 ${B} .rd-row>.rd-note{text-align:left}
 ${B} .rd-toc{padding-top:88px}
 ${B} .rd-num{font-size:56px}
 ${B} .rd-chapter h2{padding-top:10px}
 ${B} .rd-lede{font-size:18px}
 ${B} .rd-scene{padding-top:44px}
 ${B} .rd-scene>.rd-note{display:none}
 ${B} .rd-inline-note{display:block;margin-bottom:8px;font:400 13px/1.6 var(--sans);color:var(--ink-3);font-variant-numeric:tabular-nums}
 ${B} .rd-scene+.rd-scene>.rd-text{padding-top:44px}
 ${B} .rd-line{padding-left:26px}
 ${B} .rd-line::before{font-size:44px;left:-4px;top:-8px}
 ${B} .rd-line p{font-size:19.5px}
 ${B} .rd-said p{font-size:21px}
 ${B} .rd-said li{max-width:92%}
 ${B} .rd-letter{padding:24px 22px 26px}
 ${B} .rd-ledger>div{grid-template-columns:1fr}
 ${B} .rd-ledger dd+dd{grid-column:1}
 ${B} .rd-plates.n5,${B} .rd-shots{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (prefers-reduced-motion:reduce){${B} *{scroll-behavior:auto!important}}
`;
