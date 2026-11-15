export const ALBUM_SHELF_CSS = `
.album-shelf { padding: 14px 0 32px; }
.album-shelf-head { display: flex; align-items: flex-end; gap: 16px; margin-bottom: 26px; }
.album-shelf-head h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -.01em; }
.album-shelf-head p { margin: 4px 0 0; font-size: 13px; color: var(--ink-3); }
.album-shelf-head .album-shelf-act { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border-radius: 4px; font-weight: 600; font-size: 14px; background: var(--tungsten); color: var(--album-accent-ink); white-space: nowrap; }
:root[data-skin="phone"] .album-shelf-head h1 { font-size: 34px; letter-spacing: -.02em; }
:root[data-skin="phone"] .album-shelf-head .album-shelf-act { border-radius: 999px; background: rgba(0,122,255,.12); color: var(--accent-text); }
:root[data-skin="film"] .album-shelf-head h1 { font-weight: 600; }
:root[data-skin="film"] .album-shelf-kicker { font: 500 10.5px "Archivo"; font-stretch: 125%; letter-spacing: .28em; color: var(--tungsten); text-transform: uppercase; margin-bottom: 6px; }

.album-shelf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 30px 22px; }
.album-card { position: relative; min-width: 0; content-visibility: auto; contain-intrinsic-block-size: auto 400px; }
.album-card:has(details[open]),.album-card:focus-within { content-visibility: visible; }
.album-shelf .album-shelf-thumb { position: relative; aspect-ratio: 4/5; border-radius: 4px; overflow: hidden; display: block; box-shadow: 0 1px 0 rgba(255,255,255,.04) inset, 0 16px 34px -18px rgba(0,0,0,.8); }
:root[data-skin="phone"] .album-shelf .album-shelf-thumb { border-radius: 12px; box-shadow: 0 8px 22px -14px rgba(0,0,0,.35); }
.album-shelf-meta { display: grid; grid-template-columns: minmax(0, 1fr) 36px; gap: 2px 6px; margin-top: 12px; }
.album-shelf-meta b { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.album-shelf-meta small { grid-column: 1; font-size: 12.5px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.album-shelf-more { grid-row: 1 / span 2; grid-column: 2; align-self: start; width: 36px; height: 36px; margin: -6px -8px 0 0; display: grid; place-items: center; border-radius: 50%; color: var(--ink-3); font-weight: 700; letter-spacing: 1px; }
.album-shelf-more.on { background: var(--screen-3, rgba(0,0,0,.06)); color: var(--ink); }
.album-shelf-tag { display: inline-flex; align-items: center; gap: 5px; position: absolute; left: 10px; top: 10px; z-index: 2; padding: 3px 8px; border-radius: 99px; font: 600 10.5px "Pretendard Variable"; background: rgba(0,0,0,.55); color: #fff; backdrop-filter: blur(6px); }
.album-shelf-tag i { width: 6px; height: 6px; border-radius: 50%; background: #8fbf9a; }
.album-shelf .album-shelf-new-card { aspect-ratio: 4/5; border: 1.5px dashed var(--rule-2, #c7c7cc); border-radius: 4px; display: grid; place-content: center; justify-items: center; gap: 10px; color: var(--ink-3); font-size: 14px; }
:root[data-skin="phone"] .album-shelf .album-shelf-new-card { border-radius: 12px; border-color: #c7c7cc; }
.album-shelf-new-card .album-shelf-plus { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--screen-3, #fff); color: var(--tungsten); font-size: 24px; font-weight: 300; }

.album-mini-stage { position:absolute;inset:0;width:200px;height:250px;transform:scale(calc(100cqi / 200px));transform-origin:top left; }
.album-shelf-mc .album-shelf-cover-line{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;font:400 11px/1.4 var(--display,"Eulyoo",serif);margin-bottom:6px;quotes:"“" "”"}
/* Mini covers share the reading themes' surfaces, inks and display faces. */
.album-shelf-mc { position:absolute;inset:0;overflow:hidden;padding:13%;display:flex;flex-direction:column;justify-content:space-between;text-align:left;isolation:isolate; }
.album-shelf-cover-title { min-width:0;max-width:100%;white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere;position:relative;z-index:1;flex-shrink:0; }
.album-shelf-mc small { display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 11px/1.4 "Pretendard Variable",Pretendard,sans-serif;position:relative;z-index:1;flex-shrink:0; }
.album-shelf-mc img { display:block;width:100%;object-fit:cover; }
.album-shelf-mc--book { --cloth:#4a2f44;--cloth-ink:#f1e9e4;background:var(--cloth);color:var(--cloth-ink); }
.album-shelf-mc--book[data-tint=ink] { --cloth:#25282d; }
.album-shelf-mc--book[data-tint=pine] { --cloth:#2b4a3d; }
.album-shelf-mc--book[data-tint=navy] { --cloth:#25355c; }
.album-shelf-mc--book[data-tint=brick] { --cloth:#7a3a2c; }
.album-shelf-mc--book .album-shelf-cover-title { font:600 22px/1.12 "Eulyoo","MaruBuri",serif;letter-spacing:-.02em; }
.album-shelf-mc--book small { border-top:1px solid #f1e9e440;padding-top:8px;color:color-mix(in srgb,#f1e9e4 76%,var(--cloth)); }
.album-shelf-mc--book:has(> img) { display:grid;grid-template-columns:minmax(0,1fr) 42%;grid-template-rows:minmax(0,1fr) auto;column-gap:8px; }
.album-shelf-mc--book:has(> img) .album-shelf-cover-title { grid-column:1/-1;align-self:start; }
.album-shelf-mc--book > img { grid-column:2;grid-row:2;align-self:end;aspect-ratio:3/4;box-shadow:0 10px 18px -10px #0009; }
.album-shelf-mc--book:has(> img) small { grid-column:1;grid-row:2;align-self:end; }
.album-shelf-mc--program { --c:#2438b8;background:var(--c);color:#fff; }
.album-shelf-mc--program[data-tint=sea] { --c:#0f4c81; }
.album-shelf-mc--program[data-tint=dusk] { --c:#b23a2e; }
.album-shelf-mc--program[data-tint=forest] { --c:#1e5b4a; }
.album-shelf-mc--program[data-tint=ink] { --c:#15161a; }
.album-shelf-mc--program .album-shelf-cover-title { font:800 24px/.98 "Pretendard Variable",Pretendard,sans-serif;letter-spacing:-.04em; }
.album-shelf-mc--program small { border-top:1px solid #ffffff59;padding-top:8px;color:#ffffffd1; }
/* Text owns its rows; the poster photograph takes only the remaining space. */
.album-shelf-mc--program:has(> img) { display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:8px;min-height:0; }
.album-shelf-mc--program > img { min-height:0;height:100%; }
.album-shelf-mc--lp { --sleeve:#efb71d;--sleeve-ink:#17130c;--sleeve-ink-2:color-mix(in oklab,var(--sleeve-ink) 72%,var(--sleeve));--label:#d9482b;--sheet:#f6f3ec;--vinyl:#121110;background:var(--sleeve);color:var(--sleeve-ink); }
.album-shelf-mc--lp[data-tint=tomato] { --sleeve:#c23e22;--sleeve-ink:#fff1dc;--label:#efb71d;--sleeve-ink-2:color-mix(in oklab,var(--sleeve-ink) 100%,var(--sleeve)); }
.album-shelf-mc--lp[data-tint=sky] { --sleeve:#8fc1e3;--sleeve-ink:#111a24;--label:#e8553a; }
.album-shelf-mc--lp[data-tint=pink] { --sleeve:#f2a9b6;--sleeve-ink:#2a1218;--label:#2b3f8f; }
.album-shelf-mc--lp[data-tint=black] { --sleeve:#1c1a19;--sleeve-ink:#efb71d;--label:#d9482b; }
.album-shelf-mc--lp .album-shelf-cover-title { font:700 26px/1 "Stellar","Pretendard Variable",serif; }
.album-shelf-mc--lp small { color:var(--sleeve-ink-2); }
.album-shelf-record { position:absolute;z-index:-1;width:70%;aspect-ratio:1;right:-28%;bottom:12%;border-radius:50%;background:radial-gradient(circle,var(--sheet) 0 1.3%,#0000 1.4%),radial-gradient(circle,var(--label) 0 17.5%,#0000 17.7%),repeating-radial-gradient(circle,#ffffff12 0 1px,#0000 1px 5px),conic-gradient(from 20deg,#0000 0 8%,#ffffff24 12%,#0000 17% 50%,#ffffff1c 56%,#0000 62%),var(--vinyl); }
.album-shelf-mc--lp[data-tint=black] .album-shelf-record { box-shadow:0 0 0 1px #ffffff26; }
.album-shelf-mc--lp:has(.album-shelf-jacket) { justify-content:center;gap:18px; }
.album-shelf-jacket { width:82%;aspect-ratio:1;min-height:0;flex-shrink:0;overflow:hidden;background:var(--sleeve);position:relative;z-index:1;border:1px solid color-mix(in srgb,var(--sleeve-ink) 60%,transparent);box-shadow:2px 3px 8px #0003;display:flex;align-items:flex-end;padding:10px; }
.album-shelf-jacket .album-shelf-cover-title { max-height:100%; }
.album-shelf-jacket img { position:absolute;inset:0;height:100%; }
.album-shelf-mc--lp:has(.album-shelf-jacket) .album-shelf-record { width:64%;right:5%;top:24%;bottom:auto; }
.album-shelf-mc--film { --paper:#d5cbb3;--display:"Song Myung","Gowun Batang",serif;--mini-ink-3:#5c5446;background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 .16  0 0 0 0 .13  0 0 0 0 .09  0 0 0 1.5 -.86'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23s)'/%3E%3C/svg%3E"),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='640'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.03 .16' numOctaves='4' seed='11'/%3E%3CfeColorMatrix values='0 0 0 0 .98  0 0 0 0 .95  0 0 0 0 .86  0 0 0 .5 -.2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23f)'/%3E%3C/svg%3E"), var(--paper);color:#2a2620;text-align:center;justify-content:center; }
.album-shelf-mc--film[data-tint=gray] { --paper:#cdcbc4; }
.album-shelf-mc--film[data-tint=kraft] { --paper:#c4a983;--mini-ink-3:#433c31; }
.album-shelf-mc--film::before { content:"";position:absolute;inset:7%;border:2px solid #2a2620;outline:1px solid #2a2620;outline-offset:-5px;pointer-events:none; }
.album-shelf-mc--film .album-shelf-cover-title { font:400 21px/1.2 var(--display); }
.album-shelf-cover-rule { width:28px;height:1px;flex-shrink:0;background:#2a2620;margin:10px auto; }
.album-shelf-mc--film small { color:var(--mini-ink-3); }
.album-shelf-print { display:block;width:56%;padding:4px;background:#e6decb;box-shadow:0 1px 3px #3b2f1a40;margin:0 auto 10px;min-height:0;flex-shrink:0; }
.album-shelf-print img { aspect-ratio:4/3;height:auto; }
.album-shelf-mc--film:has(.album-shelf-print) .album-shelf-cover-title { min-height:0;flex-shrink:1; }
.album-shelf-thumb:has(> .album-shelf-tag) > .album-shelf-mc { padding-top:max(13%,40px); }
/* empty */
.album-shelf-empty { min-height: 520px; display: grid; place-content: center; justify-items: center; text-align: center; gap: 18px; padding: 0 24px; }
.album-shelf-empty .album-shelf-stack { position: relative; width: 170px; height: 150px; }
.album-shelf-empty .album-shelf-stack span { position: absolute; width: 104px; aspect-ratio: 4/5; border-radius: 6px; border: 1.5px dashed var(--rule-2, #c7c7cc); }
.album-shelf-empty .album-shelf-stack span:nth-child(1) { left: 6px; top: 10px; transform: rotate(-8deg); }
.album-shelf-empty .album-shelf-stack span:nth-child(2) { right: 6px; top: 6px; transform: rotate(7deg); }
.album-shelf-empty .album-shelf-stack span:nth-child(3) { left: 33px; top: 0; background: var(--screen-3, #fff); border-style: solid; border-color: var(--rule-2, #e5e5ea); display: grid; place-items: center; color: var(--tungsten); font-size: 30px; font-weight: 300; }
.album-shelf-empty p { margin: 0; color: var(--ink-2); font-size: 15px; }
.album-shelf-empty .album-shelf-act { display: inline-flex; align-items: center; height: 40px; padding: 0 18px; border-radius: 4px; font-weight: 600; background: var(--tungsten); color: var(--album-accent-ink); }
:root[data-skin="phone"] .album-shelf-empty .album-shelf-act { border-radius: 999px; background: var(--tungsten); color: #fff; }

@media (max-width: 640px) {
  .album-shelf { padding: 4px 0 24px; }
  .album-shelf-head { flex-wrap: wrap; margin-bottom: 18px; }
  .album-shelf-head h1 { font-size: 30px; }
  .album-shelf-head .album-shelf-act { height: 34px; padding: 0 12px; font-size: 13.5px; }
  .album-shelf-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px 14px; }
}


.album-shelf { --album-accent-ink: #1b1308; word-break: keep-all; overflow-wrap: anywhere; }
:root[data-skin="phone"] .album-shelf { --album-accent-ink: #fff; }
.album-shelf .album-shelf-thumb { width: 100%; border: 0; padding: 0; text-align: inherit; }
.album-shelf-meta { grid-template-columns: minmax(0,1fr) 36px; }
.album-shelf .album-shelf-title { grid-column: 1; text-align: left; font-size: 15px; font-weight: 600; color: var(--ink); padding: 0; }
.album-shelf-ttl b { font-weight: inherit; }
.album-shelf-meta small { max-width: 100%; white-space: normal; }
.album-shelf-meta small > span { white-space: nowrap; }
.album-shelf-menu { grid-column: 2; grid-row: 1 / span 2; justify-self: end; align-self: start; }
.album-shelf-menu > summary { width: 36px; height: 36px; }
.album-shelf .album-shelf-menu[open]::before { display: none; }
.album-shelf .album-shelf-menu[open] > .menu__pop { position: absolute; inset: auto 0 auto auto; width: 210px; min-width: 0; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow-y: auto; padding: 6px; border-radius: 6px; z-index: 60; }
.album-shelf .menu__item{background:transparent;color:var(--ink-2);border:0;border-radius:4px;box-shadow:none;font:inherit;padding:8px 12px;appearance:none}
.album-shelf .menu__item:hover,.album-shelf .menu__item:focus-visible{background:var(--screen-3);color:var(--ink)}
.album-shelf .menu__item--danger{color:var(--cut)}
.album-shelf .album-shelf-menu[open] > .menu__pop .menu__title { display: none; }
.album-shelf .album-shelf-menu[open] > .menu__pop .menu__item { min-height: 40px; font-size: 14px; }
:root[data-skin="phone"] .album-shelf .menu__pop { border-radius: 13px; }
.album-shelf-empty { min-height: min(520px,65dvh); }
.album-shelf-empty p { max-width: 100%; }
.album-shelf .album-shelf-new-card { background: transparent; padding: 0; }
.album-shelf .album-shelf-new-card:hover { border-color: var(--tungsten); color: var(--ink); }
@media (max-width:899px) {
  .nav:has([data-tab="albums"]) { grid-template-columns: repeat(6,minmax(0,1fr)); }
  .nav:has([data-tab="albums"]) > button { min-width: 0; white-space: nowrap; font-size: 10.5px; }
  .album-shelf-menu > summary { width: 44px; height: 44px; }
  .album-shelf-meta { grid-template-columns: minmax(0,1fr) 44px; }
  .album-shelf .album-shelf-menu[open] > .menu__pop .menu__item { min-height: 44px; }
}
`;
