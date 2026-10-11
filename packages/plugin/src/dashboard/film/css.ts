// Film dashboard stylesheet. Ported verbatim from the approved visual contract (film.css); one theme = one token block, components read tokens only.
export const FILM_CSS = `
/* RCM · Film — tokens and components. One theme = one token block; components read tokens only. */
:root, :root[data-theme="night"] {
  color-scheme: dark;
  /* house lights and screens */
  --house: #070708; --screen: #0f1012; --screen-2: #16171a; --screen-3: #1e1f23;
  --rule: #222328; --rule-2: #33353b; --edge: #63666d;
  /* ink */
  --ink: #ebe8e2; --ink-2: #b3afa7; --ink-3: #8b8881; --sub: #f4ecd0;
  /* one light source, two signals */
  --tungsten: #dba35a; --tungsten-ink: #1b1308; --tungsten-dim: rgba(219,163,90,.14); --accent-text: #dba35a; --focus: #dba35a;
  --cut: #e2735d; --cut-dim: rgba(226,115,93,.12); --cut-ink: #1b0905; --ok: #8fbf9a;
  --scrim: rgba(0,0,0,.6); --shadow: 0 20px 44px -12px rgba(0,0,0,.85); --lift: 0 14px 30px -18px rgba(0,0,0,.9);
  /* type */
  --sans: "Pretendard Variable", Pretendard, "Pretendard JP", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", system-ui, -apple-system, "Apple SD Gothic Neo", "Hiragino Sans", "Yu Gothic UI", "PingFang SC", "Microsoft YaHei", "Malgun Gothic", sans-serif;
  --cjk: "Pretendard Variable", Pretendard, "Pretendard JP", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", "Hiragino Sans", "Yu Gothic UI", "PingFang SC", "Microsoft YaHei", "Malgun Gothic", sans-serif;
  --credit: "Archivo", var(--cjk);
  /* Type roles. Set pieces (poster, title card, credit names) keep their own sizes. */
  --t-title: 22px; --t-head: 18px; --t-read: 16px; --t-body: 15px; --t-ui: 14px; --t-small: 13px; --t-micro: 12px; --t-credit: 11px;
  /* space, shape, motion */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 20px; --s6: 24px; --s7: 32px; --s8: 44px;
  --r: 3px; --control: 32px; --hit: 32px; --ease: cubic-bezier(.2,.8,.2,1); --fast: 140ms;
}
:root[data-theme^="day"] {
  color-scheme: light;
  --house: #efeee9; --screen: #f8f7f3; --screen-2: #e7e5df; --screen-3: #ffffff;
  --rule: #dcd9d1; --rule-2: #c9c5bb; --edge: #8a867c;
  --ink: #17171a; --ink-2: #47464a; --ink-3: #625f59; --sub: #17171a; --ok: #356b43;
  --scrim: rgba(20,18,14,.35); --shadow: 0 18px 40px -14px rgba(40,30,10,.35); --lift: 0 10px 22px -16px rgba(40,30,10,.3); --focus: #17171a;
}
/* 낮 · 전구: the marquee bulb. Amber only fills; text accents stay ink so nothing turns brown. */
:root[data-theme="day-bulb"] {
  --tungsten: #f2a93b; --tungsten-ink: #1d1406; --tungsten-dim: rgba(242,169,59,.22); --accent-text: #17171a;
  --cut: #c23a22; --cut-dim: rgba(194,58,34,.1); --cut-ink: #fff;
}
/* 낮 · 벨벳 (default day): the theatre seat. One deep crimson; danger shifts to vermilion so they never meet. */
:root[data-theme="day"], :root[data-theme="day-velvet"] {
  --tungsten: #9e1f3a; --tungsten-ink: #fff5f6; --tungsten-dim: rgba(158,31,58,.1); --accent-text: #9e1f3a;
  --cut: #b0420f; --cut-dim: rgba(176,66,15,.1); --cut-ink: #fff;
}
/* 낮 · 시안: the colour-timing blue of a daylight print. */
:root[data-theme="day-print"] {
  --tungsten: #2753c7; --tungsten-ink: #f5f8ff; --tungsten-dim: rgba(39,83,199,.1); --accent-text: #2753c7;
  --cut: #c0392b; --cut-dim: rgba(192,57,43,.1); --cut-ink: #fff;
}
@media (max-width: 760px) { :root, :root[data-theme] { --control: 36px; --hit: 44px; } }

/* base — resets use :where() so every component rule below wins without specificity tricks */
.film { background: var(--house); color: var(--ink); font: 400 var(--t-body)/1.65 var(--sans); word-break: keep-all; overflow-wrap: break-word; -webkit-font-smoothing: antialiased; }
:where(.film) *, :where(.film) *::before, :where(.film) *::after { box-sizing: border-box; }
/* the hidden attribute (search filters, conditional fields) beats every component display rule; :not(#_) lifts it to id weight */
.film [hidden]:not(#_) { display: none; }
:where(.film) ::selection { background: var(--tungsten-dim); color: var(--ink); }
:where(.film) :focus { outline: none; }
:where(.film) :focus-visible { outline: 1.5px solid var(--focus); outline-offset: 2px; }
:where(.film) button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
:where(.film) * { scrollbar-width: thin; scrollbar-color: var(--rule-2) transparent; }
.credit { font-family: var(--credit); font-stretch: 125%; text-transform: uppercase; letter-spacing: .24em; font-weight: 500; }
.tc { font-variant-numeric: tabular-nums; color: var(--ink-3); font-size: var(--t-micro); letter-spacing: .02em; }
.i { width: 16px; height: 16px; flex: none; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
/* A small visual control keeps a 44px touch target on phones. */
.hit { position: relative; }
.hit::after { content: ""; position: absolute; left: 50%; top: 50%; width: max(100%, var(--hit)); height: max(100%, var(--hit)); transform: translate(-50%, -50%); }

/* button: primary (one per view), secondary, quiet, danger */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: var(--control); padding: 0 14px; border-radius: var(--r); font-size: var(--t-ui); font-weight: 600; white-space: nowrap; transition: background var(--fast) var(--ease), color var(--fast) var(--ease); }
.btn .i { width: 15px; height: 15px; }
.btn--primary { background: var(--tungsten); color: var(--tungsten-ink); }
.btn--primary:hover, .btn--primary.is-hover { background: color-mix(in srgb, var(--tungsten) 86%, var(--ink)); }
.btn--primary:active, .btn--primary.is-active { background: color-mix(in srgb, var(--tungsten) 80%, #000); }
.btn--secondary { background: var(--screen-2); color: var(--ink); }
.btn--secondary:hover, .btn--secondary.is-hover { background: var(--screen-3); }
.btn--secondary:active, .btn--secondary.is-active { background: var(--rule-2); }
.btn--quiet { color: var(--ink-2); padding: 0 10px; }
.btn--quiet:hover, .btn--quiet.is-hover { color: var(--ink); background: var(--screen-2); }
.btn--quiet:active, .btn--quiet.is-active { background: var(--screen-3); }
.btn--danger { color: var(--cut); background: var(--cut-dim); }
.btn--danger:hover, .btn--danger.is-hover { background: color-mix(in srgb, var(--cut) 22%, transparent); }
.btn--danger-solid { background: var(--cut); color: var(--cut-ink); }
.btn.is-focus { outline: 1.5px solid var(--focus); outline-offset: 2px; }
.btn:disabled, .btn.is-disabled { opacity: .4; cursor: not-allowed; }
.btn.is-busy { cursor: progress; }
.btn.is-busy .spin { width: 13px; height: 13px; border-radius: 50%; border: 1.5px solid currentColor; border-right-color: transparent; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.iconbtn { display: inline-grid; place-items: center; width: var(--control); height: var(--control); border-radius: var(--r); color: var(--ink-3); transition: background var(--fast) var(--ease), color var(--fast) var(--ease); }
.iconbtn:hover, .iconbtn.is-hover, .iconbtn[aria-expanded="true"] { color: var(--ink); background: var(--screen-2); }
.iconbtn:disabled { opacity: .4; }
.linkbtn { color: var(--ink-2); font-size: var(--t-small); text-decoration: underline; text-decoration-color: var(--rule-2); text-underline-offset: 3px; }
.linkbtn:hover, .linkbtn.is-hover { color: var(--ink); text-decoration-color: var(--ink-3); }

/* segmented: 번역 / 원문, sort */
.seg { display: inline-flex; max-width: 100%; overflow-x: auto; scrollbar-width: none; padding: 2px; gap: 2px; border-radius: calc(var(--r) + 2px); background: var(--screen-2); }
.seg button { height: calc(var(--control) - 6px); padding: 0 11px; border-radius: var(--r); font-size: var(--t-small); font-weight: 600; color: var(--ink-3); }
.seg button:hover { color: var(--ink-2); }
.seg button[aria-pressed="true"] { background: var(--screen-3); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.35); }

/* tabs: section tabs and chapter tabs share one grammar */
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--rule); overflow-x: auto; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tab { position: relative; flex: none; height: 42px; padding: 0 14px; font-size: var(--t-ui); color: var(--ink-3); white-space: nowrap; }
.tab::after { content: ""; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px; background: transparent; }
.tab:hover, .tab.is-hover { color: var(--ink-2); }
.tab[aria-selected="true"] { color: var(--ink); font-weight: 600; }
.tab[aria-selected="true"]::after { background: var(--tungsten); }
.tab .count { margin-left: 6px; color: var(--cut); font-size: var(--t-micro); font-variant-numeric: tabular-nums; }

/* filters: rectangular toggles with a count; they scroll, never wrap, on phones */
.filters { display: flex; gap: 6px; flex-wrap: wrap; }
@media (max-width: 760px) { .filters { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin-right: -16px; padding-right: 16px; mask-image: linear-gradient(90deg, #000 calc(100% - 24px), transparent); } .filters::-webkit-scrollbar { display: none; } }
.filter { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: var(--r); background: var(--screen-2); color: var(--ink-3); font-size: var(--t-small); font-weight: 600; }
.filter .n { font-weight: 400; font-variant-numeric: tabular-nums; }
.filter:hover, .filter.is-hover { color: var(--ink-2); background: var(--screen-3); }
.filter[aria-pressed="true"] { background: var(--ink); color: var(--house); }
.filter[aria-pressed="true"] .n { color: color-mix(in srgb, var(--house) 70%, var(--ink)); }

/* fields: no white glare on click — focus is a tungsten edge only */
/* align-content keeps a control at its own height when a neighbour in the row carries a hint. */
.field { display: grid; gap: 6px; align-content: start; }
.field > label, .field > .label { font-size: var(--t-small); font-weight: 600; color: var(--ink-2); }
.field .hint { font-size: var(--t-micro); color: var(--ink-3); line-height: 1.5; }
.field .err { font-size: var(--t-micro); color: var(--cut); line-height: 1.5; }
.input, .select, .textarea { width: 100%; min-height: var(--control); padding: 0 11px; border: 1px solid var(--edge); border-radius: var(--r); background: var(--screen); color: var(--ink); font: 400 var(--t-ui)/1.5 var(--sans); transition: border-color var(--fast) var(--ease); }
.textarea { padding: 9px 11px; min-height: 84px; resize: vertical; }
.input::placeholder, .textarea::placeholder { color: var(--ink-3); }
.input:hover, .select:hover, .textarea:hover { border-color: color-mix(in srgb, var(--edge) 60%, var(--ink)); }
.input:focus, .select:focus, .textarea:focus, .input.is-focus { border-color: var(--focus); outline: none; }
.input[aria-invalid="true"] { border-color: var(--cut); }
.input:disabled, .select:disabled { opacity: .45; }
.select { appearance: none; padding-right: 32px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b8881' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 9px center; background-size: 15px; }
.select option { background: var(--screen-3); color: var(--ink); }
.search { position: relative; display: flex; align-items: center; }
.search .i { position: absolute; left: 11px; color: var(--ink-3); pointer-events: none; }
.search .input { padding-left: 34px; }
.check { display: inline-flex; align-items: flex-start; gap: 10px; cursor: pointer; font-size: var(--t-ui); }
.check input { appearance: none; flex: none; width: 16px; height: 16px; margin: 2px 0 0; border: 1px solid var(--edge); border-radius: 2px; background: var(--screen); display: grid; place-items: center; }
.check input:checked { background: var(--tungsten); border-color: var(--tungsten); }
.check input:checked::after { content: ""; width: 8px; height: 4px; border: 1.6px solid var(--tungsten-ink); border-top: 0; border-right: 0; transform: translateY(-1px) rotate(-45deg); }
.check small { display: block; color: var(--ink-3); font-size: var(--t-micro); margin-top: 2px; }
.switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; font-size: var(--t-ui); }
.switch input { appearance: none; position: relative; width: 34px; height: 20px; margin: 0; border-radius: 999px; background: var(--rule-2); transition: background var(--fast) var(--ease); }
.switch input::after { content: ""; position: absolute; left: 3px; top: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--ink-2); transition: transform var(--fast) var(--ease), background var(--fast); }
.switch input:checked { background: var(--tungsten); }
.switch input:checked::after { transform: translateX(14px); background: var(--tungsten-ink); }

/* menu: the one "더보기" — popover on desktop, sheet on phones */
.menu { position: relative; display: inline-block; }
.menu__list { min-width: 200px; padding: 5px; border-radius: 4px; background: var(--screen-3); box-shadow: var(--shadow), 0 0 0 1px var(--rule); }
.menu__pop { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; }
.menu__item { width: 100%; display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 10px; border-radius: var(--r); font-size: var(--t-ui); color: var(--ink); text-align: left; }
.menu__item .i { color: var(--ink-3); }
.menu__item:hover, .menu__item.is-hover { background: var(--rule); }
.menu__item:disabled { opacity: .45; cursor: not-allowed; background: none; }
.menu__item .k { margin-left: auto; font-size: var(--t-micro); color: var(--ink-3); }
.menu__item--danger, .menu__item--danger .i { color: var(--cut); }
.menu__sep { height: 1px; margin: 5px 6px; background: var(--rule); }
.sheet { position: fixed; inset: auto 0 0 0; z-index: 50; padding: 8px 8px calc(8px + env(safe-area-inset-bottom)); background: var(--screen-3); border-radius: 12px 12px 0 0; box-shadow: 0 -20px 40px -10px rgba(0,0,0,.7); }
.sheet__grab { width: 36px; height: 4px; margin: 2px auto 10px; border-radius: 2px; background: var(--rule-2); }
.sheet__title { padding: 2px 12px 8px; font-size: var(--t-small); color: var(--ink-3); }
.sheet .menu__item { height: 48px; font-size: var(--t-body); padding: 0 12px; }
.sheet__cancel { width: 100%; height: 48px; margin-top: 6px; border-radius: 8px; background: var(--screen-2); font-weight: 600; }
.scrim { position: fixed; inset: 0; z-index: 40; background: var(--scrim); }

/* rows and lists: one rule per boundary, owned by the row */
.list { list-style: none; margin: 0; padding: 0; }
.row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4px 12px; align-items: center; padding: 12px 10px; margin: 0 -10px; border-radius: var(--r); text-align: left; width: calc(100% + 20px); }
.list > li + li > .row, .list > .row + .row { box-shadow: 0 -1px 0 var(--rule); }
.row:hover, .row.is-hover { background: var(--screen); box-shadow: none; }
.row[aria-current="true"] { background: var(--screen-2); }
.row[aria-current="true"] .row__title { color: var(--ink); }
.row__slug { grid-column: 1 / -1; display: flex; justify-content: space-between; gap: 10px; font-size: var(--t-micro); color: var(--ink-3); }
.row__slug b { color: var(--ink-2); font-weight: 600; }
.row__title { font-size: var(--t-body); font-weight: 600; color: var(--ink); line-height: 1.45; }
.row__sub { grid-column: 1; font-size: var(--t-small); color: var(--ink-2); line-height: 1.6; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.row__end { grid-row: span 2; display: flex; align-items: center; gap: 4px; color: var(--ink-3); font-size: var(--t-small); }
.row .quote { grid-column: 1; color: var(--sub); font-size: var(--t-body); }

/* fold: summary owns the only rule */
.fold > summary { list-style: none; display: flex; align-items: center; gap: 8px; min-height: 44px; border-bottom: 1px solid var(--rule); cursor: pointer; font-size: var(--t-ui); font-weight: 600; color: var(--ink-2); }
.fold > summary::-webkit-details-marker { display: none; }
.fold > summary:hover { color: var(--ink); }
.fold > summary .n { font-weight: 400; color: var(--ink-3); font-size: var(--t-micro); }
.fold > summary .chev { margin-left: auto; color: var(--ink-3); transition: transform var(--fast) var(--ease); }
.fold[open] > summary .chev { transform: rotate(90deg); }
.fold__body { padding: 12px 0 4px; }

/* frame: a scene still with slugline and subtitle */
.frame { display: grid; grid-template-rows: auto auto auto; align-content: start; gap: 10px; min-height: 0; padding: 12px 14px 14px; border-radius: var(--r); background: var(--screen); text-align: left; width: 100%; box-shadow: var(--lift); transition: box-shadow var(--fast) var(--ease); }
.frame:hover, .frame.is-hover { box-shadow: 0 0 0 1px var(--rule-2), var(--lift); }
.frame__slug { display: flex; justify-content: space-between; gap: 10px; font-size: var(--t-micro); color: var(--ink-3); }
.frame__slug b { color: var(--ink-2); font-weight: 600; }
.frame__slug .tag { color: var(--accent-text); }
.frame__title { font-size: var(--t-body); color: var(--ink-2); line-height: 1.5; }
.subtitle { margin: 0; text-align: center; font-size: var(--t-body); line-height: 1.55; color: var(--sub); }
.subtitle > span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.subtitle small { display: block; margin-top: 3px; font-size: var(--t-micro); color: var(--ink-3); }
.frame.is-mark { box-shadow: 0 0 0 1px var(--tungsten-dim), var(--lift); }
.frame__rec { display: none; border-top: 1px solid var(--rule); padding-top: 10px; font-size: var(--t-small); color: var(--ink-2); line-height: 1.75; }
.frame[aria-expanded="true"] .frame__rec { display: block; }

/* credit block: the pair's opening titles */
.titles { position: relative; padding: 52px 24px 44px; text-align: center; background: var(--screen); }
.titles::before, .titles::after { content: ""; position: absolute; left: 0; right: 0; height: 16px; background: var(--house); }
.titles::before { top: 0; } .titles::after { bottom: 0; }
.titles .starring { font-size: var(--t-credit); color: var(--ink-3); }
.titles .nm { margin-top: 14px; font-family: var(--credit); font-stretch: 125%; font-weight: 500; font-size: 28px; letter-spacing: .24em; padding-left: .24em; text-transform: uppercase; }
.titles .as { font-size: var(--t-small); color: var(--ink-3); }
.titles .and { margin: 14px 0 0; font-size: var(--t-credit); color: var(--accent-text); }
.titles .calls { margin-top: 10px; color: var(--sub); font-size: var(--t-body); }
.titles .calls small { display: block; font-size: var(--t-micro); color: var(--ink-3); }

/* name: one component for every person's name in any script */
.name { font-family: var(--credit); font-stretch: 125%; font-weight: 500; text-transform: uppercase; letter-spacing: .22em; }
.name.is-cjk { font-family: var(--cjk); font-stretch: normal; text-transform: none; letter-spacing: .08em; font-weight: 600; }
.titles .nm.is-cjk { font-family: var(--cjk); font-stretch: normal; text-transform: none; letter-spacing: .14em; padding-left: .14em; font-weight: 600; font-size: 26px; }
.pairs { display: flex; gap: 6px; flex-wrap: wrap; }
@media (max-width: 760px) { .pairs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin-right: -16px; padding-right: 16px; } }
.pair { flex: none; display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; border-radius: var(--r); background: var(--screen-2); color: var(--ink-2); font-size: var(--t-small); }
.pair .x { color: var(--ink-3); font-size: var(--t-micro); }
.pair:hover { background: var(--screen-3); color: var(--ink); }
.pair[aria-pressed="true"] { background: var(--ink); color: var(--house); }
.pair[aria-pressed="true"] .x { color: color-mix(in srgb, var(--house) 60%, var(--ink)); }

/* notice, status list, empty */
.notice { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--r); background: var(--screen); font-size: var(--t-ui); }
.notice .i { color: var(--accent-text); }
.notice--cut .i { color: var(--cut); }
.notice .btn { margin-left: auto; }
.status { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 2px 24px; }
.status li { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; font-size: var(--t-small); color: var(--ink-2); }
.status .i { width: 14px; height: 14px; margin-top: 3px; }
.status .ok .i { color: var(--ok); } .status .wait .i { color: var(--ink-3); } .status .bad { color: var(--ink); } .status .bad .i { color: var(--cut); }
.empty { padding: 28px 0; text-align: center; color: var(--ink-3); font-size: var(--t-ui); }
.empty b { display: block; color: var(--ink-2); font-weight: 600; margin-bottom: 4px; }
.empty .btn { margin-top: 12px; }
.empty.is-loading .i { display: block; width: 18px; height: 18px; margin: 0 auto 8px; }

/* dialog: centered on desktop, a sheet on phones */
.dialog { width: min(420px, calc(100vw - 32px)); padding: 22px 22px 18px; border-radius: 6px; background: var(--screen-3); box-shadow: var(--shadow), 0 0 0 1px var(--rule); }
.dialog h3 { margin: 0; font-size: var(--t-head); font-weight: 650; }
.dialog p { margin: 8px 0 0; color: var(--ink-2); font-size: var(--t-body); line-height: 1.7; }
.dialog__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
@media (max-width: 760px) { .dialog__actions { flex-direction: column-reverse; } .dialog__actions .btn { width: 100%; height: 40px; } }

/* form: stacked fields, one action bar */
.form { display: grid; gap: 16px; }
.form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 760px) { .form__row { grid-template-columns: 1fr; } }
.form__bar { display: flex; justify-content: flex-end; gap: 8px; padding-top: 16px; border-top: 1px solid var(--rule); }
@media (max-width: 760px) { .form__bar { position: sticky; bottom: 0; margin: 0 -16px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: var(--house); } .form__bar .btn { flex: 1; } }

@media (prefers-reduced-motion: reduce) { .film *, .film *::before, .film *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }

/* menu (details-based): closed pops are hidden; on phones the open pop becomes a bottom sheet over a scrim */
.menu > summary { list-style: none; }
.menu > summary::-webkit-details-marker { display: none; }
.menu:not([open]) > .menu__pop { display: none; }
@media (max-width: 760px) {
  .menu[open] > .menu__pop { position: fixed; inset: auto 0 0 0; z-index: 50; min-width: 0; padding: 8px 8px calc(8px + env(safe-area-inset-bottom)); border-radius: 12px 12px 0 0; }
  .menu[open]::before { content: ""; position: fixed; inset: 0; z-index: 49; background: var(--scrim); }
  .menu[open] > .menu__pop .menu__item { height: 48px; font-size: var(--t-body); }
  .menu[open] > .menu__pop .menu__title { display: block; }
}
.menu__title { display: none; padding: 2px 12px 8px; font-size: var(--t-small); color: var(--ink-3); }

/* shell: top bar, bottom nav on phones, sidebar on desktop; the document is the only scroller */
html, body { margin: 0; min-height: 100%; }
.app { min-height: 100vh; display: flex; flex-direction: column; }
.topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 10px; height: 50px; padding: 0 8px 0 16px; overflow-x: clip; background: color-mix(in srgb, var(--house) 90%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--rule); }
.topbar .where { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--t-ui); color: var(--ink-3); white-space: nowrap; overflow: hidden; }
.topbar .where b { color: var(--ink); font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.topbar .where button { color: var(--ink-3); flex: none; max-width: 12em; overflow: hidden; text-overflow: ellipsis; }
.topbar .where button:hover { color: var(--ink); }
.topbar .where .sep { color: var(--rule-2); }
.topbar .sp { flex: 1; }
.topbar .bar__state:empty { display: none; }
@media (max-width: 760px) { .topbar .state > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; } .topbar .seg { flex: none; } }
.state { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-small); color: var(--ink-3); white-space: nowrap; }
.state .i { width: 14px; height: 14px; }
.state--ok .i { color: var(--ok); }
.state--warn .i { color: var(--accent-text); }
.state--error { color: var(--ink); } .state--error .i { color: var(--cut); }
.brand { display: none; }
.main { flex: 1; min-width: 0; padding: 18px 16px 32px; }
.subnav { margin: 0 0 22px; }
.subnav[hidden] { display: none; }
.pagetitle { margin: 4px 0 10px; font-size: var(--t-title); font-weight: 650; letter-spacing: -.01em; }
/* phone-skin hooks: avatars and other phone-only markup stay out of the film picture */
.av, .filter__ic { display: none; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.nav { position: sticky; bottom: 0; z-index: 10; display: grid; grid-template-columns: repeat(5, 1fr); height: calc(58px + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom); border-top: 1px solid var(--rule); background: var(--house); }
.nav > button { position: relative; display: grid; place-items: center; align-content: center; gap: 3px; font-size: var(--t-micro); color: var(--ink-3); }
.nav > button .i { width: 18px; height: 18px; }
.nav > button[aria-current="page"] { color: var(--ink); font-weight: 600; }
.nav > button[aria-current="page"]::before { content: ""; position: absolute; top: 0; left: 50%; width: 18px; height: 2px; margin-left: -9px; background: var(--tungsten); }
.nav .badge { position: absolute; top: 7px; left: calc(50% + 6px); min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px; background: var(--cut); color: var(--cut-ink); font-size: var(--t-credit); font-weight: 700; line-height: 15px; text-align: center; }
@media (min-width: 900px) {
  .app { display: grid; grid-template-columns: 208px minmax(0, 1fr); grid-template-rows: auto 1fr; }
  .topbar { grid-column: 2; grid-row: 1; height: 54px; padding: 0 16px 0 28px; }
  /* On wide screens the content column centres in the space beside the sidebar instead of leaving one empty margin. */
  .main { grid-column: 2; grid-row: 2; justify-self: center; padding: 28px 40px 60px; max-width: 1240px; width: 100%; }
  .nav { grid-row: 1 / 3; grid-column: 1; position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 2px; padding: 18px 12px; border-top: 0; border-right: 1px solid var(--rule); }
  .brand { display: block; padding: 6px 12px 22px; }
  .brand .credit { font-size: 13px; letter-spacing: .3em; }
  .brand small { display: block; margin-top: 4px; font-size: var(--t-micro); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nav > button { display: flex; justify-content: flex-start; align-items: center; gap: 12px; height: 40px; padding: 0 12px; border-radius: var(--r); font-size: var(--t-ui); }
  .nav > button:hover { background: var(--screen); color: var(--ink-2); }
  .nav > button[aria-current="page"] { background: var(--screen-2); }
  .nav > button[aria-current="page"]::before { top: 10px; left: 0; width: 2px; height: 20px; margin: 0; }
  .nav .badge { position: static; margin-left: auto; }
}

/* page grammar shared by screens */
:is(h2, h3).sec { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin: 34px 0 10px; font-size: var(--t-head); font-weight: 650; }
:is(h2, h3).sec .n { font-size: var(--t-micro); color: var(--ink-3); font-weight: 400; }
:is(h2, h3).sec .btn { margin-left: auto; align-self: center; }
.sub { margin: 8px 0 0; color: var(--ink-3); font-size: var(--t-small); line-height: 1.6; }
.kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 16px; margin: 12px 0 0; font-size: var(--t-small); }
.kv dt { color: var(--ink-3); }
.kv dd { margin: 0; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.packet { margin: 10px 0 0; padding: 12px 14px; max-height: 360px; overflow: auto; border-radius: var(--r); background: var(--screen); color: var(--ink-2); font: 400 12px/1.6 ui-monospace, "SFMono-Regular", Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.meter { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: var(--t-micro); color: var(--ink-3); font-variant-numeric: tabular-nums; }
.meter i { flex: 1; min-width: 40px; height: 3px; border-radius: 2px; background: var(--rule-2); position: relative; overflow: hidden; }
.meter i::after { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--v, 0%); background: var(--tungsten); }
.meter.is-over i::after { background: var(--cut); }
.orig-mark { margin-left: 6px; font-size: var(--t-micro); font-weight: 500; letter-spacing: 0; color: var(--ink-3); white-space: nowrap; }
.fold { margin-top: 18px; }
.notice + .notice { margin-top: 8px; }
.notice > span { min-width: 0; }

/* home · 지금 상영 중 */
.home { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-areas: "poster" "side" "recent"; }
.home__poster { grid-area: poster; }
.home__side { grid-area: side; min-width: 0; }
.home__side > :first-child { margin-top: 18px; }
.home__recent { grid-area: recent; min-width: 0; }
.poster { position: relative; display: grid; gap: 14px; padding: 34px 20px 30px; background: var(--screen); text-align: center; }
.poster::before, .poster::after { content: ""; position: absolute; left: 0; right: 0; height: 14px; background: var(--house); }
.poster::before { top: 0; } .poster::after { bottom: 0; }
.poster .frame__slug { justify-content: center; flex-wrap: wrap; gap: 4px 14px; }
.poster h2 { margin: 0; font-size: 24px; font-weight: 300; line-height: 1.45; letter-spacing: .01em; text-wrap: balance; overflow-wrap: anywhere; }
.poster h2 button { font-weight: inherit; text-align: center; }
.poster h2 button:hover { color: var(--sub); }
.poster .subtitle { font-size: var(--t-read); max-width: 44ch; margin: 0 auto; }
.poster.is-empty { padding: 20px; }
.pairrow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 12px; align-items: center; width: calc(100% + 20px); padding: 12px 10px; margin: 0 -10px; border-radius: var(--r); text-align: left; }
.pairrow:hover { background: var(--screen); }
.pairrow + .pairrow { box-shadow: 0 -1px 0 var(--rule); }
.pairrow:hover + .pairrow { box-shadow: none; }
.pairrow .names { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; min-width: 0; font-size: var(--t-body); }
.pairrow .x { color: var(--ink-3); font-size: var(--t-micro); }
.pairrow .meta { grid-column: 1; font-size: var(--t-small); color: var(--ink-3); }
.pairrow .end { grid-row: span 2; color: var(--ink-3); }
.inject { list-style: none; margin: 0; padding: 0; }
.inject li { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; padding: 9px 0; font-size: var(--t-ui); color: var(--ink-2); line-height: 1.6; }
.inject li + li { border-top: 1px solid var(--rule); }
.inject .tag { font-size: var(--t-micro); color: var(--ink-3); padding-top: 2px; }
.strip3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
/* Recent scenes are glanced at: one line of slate, three of title, then open the scene. */
.strip3 > .frame { min-width: 0; grid-template-columns: minmax(0, 1fr); }
.strip3 .frame__slug b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.strip3 .frame__title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
@media (min-width: 900px) {
  .home { grid-template-columns: minmax(0, 1.25fr) minmax(320px, 1fr); grid-template-rows: auto 1fr; grid-template-areas: "poster side" "recent side"; gap: 0 44px; align-items: start; }
  .home__side > :first-child { margin-top: 0; }
  .home__side > section:first-child > h2.sec:first-child { margin-top: 0; }
  .home .poster { padding: 52px 32px 46px; }
  .home .poster h2 { font-size: 28px; }
}

/* 기억 · 타임라인: list → reader on phones, sticky list + reader on desktop */
.tl-tools { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.tl-tools .search { flex: 1; min-width: 0; }
.datatools .relperson { flex: none; width: 160px; }
@media (max-width: 760px) { .datatools { flex-wrap: wrap; } .datatools .search { flex-basis: 100%; } }
.listcol .filters { margin-bottom: 4px; }
.listcol > .sub { margin: 8px 0 4px; }
.day { display: flex; gap: 8px; margin: 18px 0 2px; font-size: var(--t-micro); color: var(--ink-3); }
.day b { color: var(--ink-2); font-weight: 600; font-variant-numeric: tabular-nums; }
.tl-rows > .day:first-child { margin-top: 6px; }
.tl-rows > .row + .row, .tl-rows > .fold + .row { box-shadow: 0 -1px 0 var(--rule); }
.tl-rows > .row:hover + .row, .tl-rows > .row[aria-current="true"] + .row { box-shadow: none; }
.tl-rows .row__title { overflow-wrap: anywhere; }
.row.is-off .row__title, .row.is-off .row__sub { color: var(--ink-3); }
.row__signals { display: inline-flex; gap: 4px; color: var(--ink-3); }
.row__signals .i, .frame__slug .row__signals .i { width: 13px; height: 13px; }
.capsule-children { margin: 0 0 6px; }
.capsule-children > summary { min-height: 36px; font-size: var(--t-small); font-weight: 500; }
.readercol { min-width: 0; }
.reader__bar { display: flex; align-items: center; gap: 8px; min-height: 36px; margin-bottom: 10px; }
.reader__acts { display: flex; gap: 2px; margin-left: auto; }
.back { display: inline-flex; align-items: center; gap: 4px; padding: 6px 6px 6px 0; color: var(--ink-2); font-size: var(--t-ui); }
.back:hover { color: var(--ink); }
.reader .frame__slug { justify-content: flex-start; flex-wrap: wrap; gap: 4px 14px; }
.reader__title { margin: 10px 0 6px; font-size: var(--t-title); font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; }
.participants { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: var(--t-small); color: var(--ink-3); }
.participants .dot { color: var(--rule-2); }
.reader .notice { margin-top: 14px; }
.lines { display: grid; gap: 14px; margin: 22px 0 0; padding: 20px 18px; background: var(--screen); border-radius: var(--r); }
.lines .subtitle > span { display: block; -webkit-line-clamp: unset; overflow: visible; }
.rec { margin: 20px 0 0; max-width: 66ch; font-size: var(--t-read); line-height: 1.95; color: var(--ink); white-space: pre-line; overflow-wrap: anywhere; }
.quote { margin: 0; padding-left: 12px; border-left: 2px solid var(--rule-2); color: var(--ink-2); font-size: var(--t-body); line-height: 1.75; white-space: pre-line; overflow-wrap: anywhere; }
.pager { display: flex; justify-content: space-between; margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--rule); }
/* The memory reader keeps one centred measure: title, dialogue and record share its width. */
.timeline .readercol > .reader { max-width: 720px; margin-inline: auto; }
.now-edit > .reader { max-width: 720px; }
.timeline .rec { max-width: none; }
.reader.is-editing .form { margin-top: 18px; }
.form > .subhead { margin: 8px 0 -6px; padding-top: 16px; border-top: 1px solid var(--rule); }
@media (max-width: 899px) {
  .timeline:not(.is-detail) .readercol, .timeline.is-detail .listcol { display: none; }
  .main .form__bar { bottom: calc(58px + env(safe-area-inset-bottom)); }
}
@media (min-width: 900px) {
  /* A list + reader screen fills the viewport under the top bar: the page stays put and each column scrolls on its own. */
  .main:has(> .page > * > .split) { display: flex; flex-direction: column; height: calc(100vh - 54px); height: calc(100dvh - 54px); padding-bottom: 0; }
  .main:has(> .page > * > .split) > .page, .page > :has(> .split) { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .split { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 0 40px; flex: 1; min-height: 0; }
  .split .listcol { display: flex; flex-direction: column; min-height: 0; }
  .split .tl-rows { position: relative; flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 10px 28px; margin: 0 -10px; }
  /* position: relative keeps absolutely placed descendants (sr-only labels, menus) inside the scrolling column. */
  .split > .readercol { position: relative; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 12px 60px 0; margin-right: -12px; }
  .back { display: none; }
}

/* 기억 · 줄거리: a series of features — title card and logline, PART tabs, the part's acts as stills, the chosen act on the screen */
.story__bar { display: flex; justify-content: flex-end; }
/* no backdrop-filter here: it would become the containing block of the fixed bottom-sheet menu on phones */
.reelnav { position: sticky; top: 50px; z-index: 8; display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin: -22px -16px 0; padding: 4px 8px 4px 16px; background: var(--house); border-bottom: 1px solid var(--rule); }
.actmenu > summary { gap: 4px; }
.actmenu > summary .i { width: 14px; height: 14px; }
.actmenu .menu__pop { width: min(380px, calc(100vw - 32px)); max-height: min(60vh, 520px); overflow: auto; }
.actmenu__search { margin: 2px 2px 6px; }
.actmenu .menu__item { height: auto; min-height: 38px; padding: 8px 10px; display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 10px; align-items: baseline; }
.actmenu .menu__item .no { font-family: var(--credit); font-stretch: 125%; font-size: var(--t-credit); letter-spacing: .2em; color: var(--ink-3); white-space: nowrap; }
.actmenu .menu__item[aria-current="true"] .no { color: var(--accent-text); }
.actmenu .menu__item .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.screening { max-width: 1120px; }
.titlecard { position: relative; margin: 20px -16px 0; padding: 60px 24px 50px; text-align: center; background: var(--screen); }
.titlecard::before, .titlecard::after { content: ""; position: absolute; left: 0; right: 0; height: 16px; background: var(--house); }
.titlecard::before { top: 0; } .titlecard::after { bottom: 0; }
.titlecard .presents { display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; gap: 4px 10px; font-size: var(--t-credit); color: var(--ink-2); }
.titlecard .presents .amp, .titlecard .presents .more { color: var(--ink-3); }
.titlecard h1 { margin: 20px auto 18px; max-width: 22ch; font-size: 25px; font-weight: 300; line-height: 1.5; letter-spacing: .02em; text-wrap: balance; overflow-wrap: anywhere; }
.titlecard .runtime { display: flex; justify-content: center; gap: 16px; font-size: var(--t-small); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.logline { margin: 26px 0 0; max-width: 68ch; color: var(--ink-2); font-size: var(--t-read); line-height: 1.9; }
.logline p { margin: 0; white-space: pre-line; }
.story__edit { margin-top: 24px; }
.story__count { margin: 6px 0 0; font-size: var(--t-micro); line-height: 1.5; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.story__count.is-over { color: var(--cut); }
.act__no { font-family: var(--credit); font-stretch: 125%; font-weight: 500; font-size: var(--t-credit); letter-spacing: .3em; color: var(--accent-text); margin-right: 12px; vertical-align: 2px; white-space: nowrap; }
.beats { margin: 0; padding-left: 20px; color: var(--ink-2); font-size: var(--t-body); line-height: 1.8; }
.beats li + li { margin-top: 6px; }
.reel { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory; margin: 0 -16px; padding: 4px 16px 10px; scrollbar-width: none; }
.reel::-webkit-scrollbar { display: none; }
.reel > .frame { flex: 0 0 84%; scroll-snap-align: center; }
.reel.is-dragging { cursor: grabbing; scroll-snap-type: none; }
/* Story threads, beats and character flows: shapes, not paragraphs */
.threadlist { list-style: none; margin: 0; padding: 0; max-width: 64ch; }
.threadlist li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 10px; padding: 5px 0; font-size: var(--t-body); line-height: 1.7; color: var(--ink); }
.threadlist .i { width: 14px; height: 14px; margin-top: 5px; color: var(--accent-text); }
.rail { list-style: none; margin: 6px 0 0; padding: 0; max-width: 64ch; }
.rail li { --rail-line: calc(var(--t-body) * 1.7); position: relative; display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 14px; padding-bottom: 16px; }
.rail li::before { content: ""; position: absolute; left: 12.5px; top: calc((var(--rail-line) - 26px) / 2 + 30px); bottom: 4px; width: 1px; background: var(--rule-2); }
.rail li:last-child { padding-bottom: 0; }
.rail li:last-child::before { display: none; }
.rail__no { width: 26px; height: 26px; margin-top: calc((var(--rail-line) - 26px) / 2); border: 1px solid var(--rule-2); border-radius: 50%; display: grid; place-items: center; font-size: var(--t-micro); color: var(--ink-3); font-variant-numeric: tabular-nums; }
.rail p { margin: 0; font-size: var(--t-body); line-height: 1.7; color: var(--ink-2); }
.flowcards { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
.flowcard { min-width: 0; padding: 16px 16px 12px; border-radius: var(--r); background: var(--screen); }
.flowcard h4 { margin: 0 0 10px; }
.flowcard .threadlist { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--rule); }
.flowcard .threadlist li { font-size: var(--t-small); color: var(--ink-2); padding: 3px 0; }
.flowcard .threadlist .i { margin-top: 4px; }
@media (min-width: 900px) {
  .reelnav { top: 54px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 12px; height: 58px; margin: -22px -40px 0; padding: 0 36px; background: color-mix(in srgb, var(--house) 92%, transparent); backdrop-filter: blur(10px); }
  .actmenu, .reelnav > .menu { align-self: center; }
  .titlecard { margin: 28px 0 0; padding: 52px 40px 44px; }
  .titlecard h1 { font-size: 30px; max-width: 26ch; }
  .logline { font-size: var(--t-read); }
  .reel { display: grid; gap: 10px; overflow: visible; margin: 0; padding: 0; }
  .reel > .frame { flex: none; }
}

/* 인물: list + person sheet share the timeline split; entries are the ledger lines of a person */
@media (max-width: 899px) {
  .people:not(.is-detail) .readercol, .people.is-detail .listcol { display: none; }
}
.people > .notice, .people > .setup-review { margin-bottom: 18px; }
.notice__acts { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.people-group { margin-top: 6px; }
.people-group > summary { min-height: 38px; font-size: var(--t-small); }
.people-group > .fold__body { padding-top: 2px; }
.person-row .row__title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: var(--t-ui); }
.row__count { flex: none; font-family: inherit; font-size: var(--t-micro); font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--ink-3); }
.person-row .row__title .name.is-cjk { font-size: var(--t-body); }
/* Shared people/relationship cells retain the Film list mechanics. */
.contact-row__avs { display: none; }
.contact-row__body { min-width: 0; }
.contact-row .row__title { display: block; }
:is(.contact-row, .contact-group, .people-group)[hidden] { display: none; }
.contact-row .row__title { font-size: var(--t-ui); font-weight: 600; }
.contact-row .row__sub { font-size: var(--t-small); font-weight: 400; color: var(--ink-3); }
.contact-group > h3.sec { font-size: var(--t-small); font-weight: 400; color: var(--ink-3); margin: 18px 0 8px; }
.contact-group > h3.sec .n { font-size: inherit; color: inherit; }
.person__name { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 12px; margin: 8px 0 12px; font-size: var(--t-title); font-weight: 500; line-height: 1.35; overflow-wrap: anywhere; }
.person__name .name.is-cjk { font-size: 24px; }
.person__facts { margin: 0 0 8px; }
.psec h3.sec { margin: 30px 0 8px; }
.subhead { margin: 16px 0 4px; font-size: var(--t-ui); font-weight: 600; color: var(--ink-3); }
.entries { list-style: none; margin: 0; padding: 0; }
.entry { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 4px 12px; padding: 11px 0; font-size: var(--t-body); line-height: 1.65; }
.entries > .entry + .entry, .acquaintance + .acquaintance { border-top: 1px solid var(--rule); }
/* A row whose only trailing control is its ··· menu keeps that menu at the row's top-right. */
.entry:has(> .entry__k):has(> .entry__src > .menu:only-child) { grid-template-columns: 52px minmax(0, 1fr) auto; }
.entry:has(> .entry__k) > .entry__src:has(> .menu:only-child) { grid-column: 3; grid-row: 1; align-self: start; }
/* A fold with its own ··· keeps the menu at the summary's right edge, left of the chevron. */
.foldbox { position: relative; margin-top: 18px; }
.foldbox > .fold { margin-top: 0; }
.foldbox__acts { position: absolute; top: 6px; right: 30px; }
.psec .foldbox { margin-top: 2px; }
.entry__k { font-size: var(--t-micro); color: var(--ink-3); padding-top: 3px; }
.entry__v { min-width: 0; overflow-wrap: anywhere; }
.entry__v b { font-weight: 600; }
.entry__v small { display: block; margin-top: 2px; font-size: var(--t-micro); color: var(--ink-3); }
.entry__src { grid-column: 2; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; font-size: var(--t-micro); color: var(--ink-3); }
.acquaintance { grid-template-columns: minmax(0, 1fr); overflow-wrap: anywhere; }
.acquaintance .calls { margin: 4px 0 0; color: var(--sub); }
.acquaintance p { margin: 4px 0 0; color: var(--ink-2); }
.cite { display: inline; }
.cite > summary { display: inline; list-style: none; cursor: pointer; }
.cite > summary::-webkit-details-marker { display: none; }
.cite__body { margin-top: 6px; padding-left: 10px; border-left: 2px solid var(--rule-2); color: var(--ink-2); font-size: var(--t-small); line-height: 1.7; }
.person .pairrow .meta { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0 10px; }
.person .pairrow .meta__who { color: var(--ink-3); font-weight: 500; white-space: nowrap; }
.person .pairrow .meta__text { color: var(--ink-2); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
@media (max-width: 760px) { .person .pairrow .meta { grid-template-columns: minmax(0, 1fr); } }
.social-editor { margin-top: 16px; }
/* 랜드마크 picker and the 기본 관계 form: chips for kinds, two parties around a swap, and the relation read back as one line */
#world-state-form [hidden], .kindpick [hidden] { display: none !important; }
.kindpick { display: grid; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
.kindpick > legend { margin: 0 0 2px; padding: 0; }
.kindpick > .hint { margin: 0; font-size: var(--t-micro); line-height: 1.5; color: var(--ink-3); }
.kindpick__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.kindpick__chip { position: relative; display: inline-grid; }
.kindpick__chip input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
.kindpick__chip span { display: grid; place-items: center; min-height: 30px; padding: 0 12px; border: 1px solid var(--rule-2); border-radius: 999px; font-size: var(--t-small); color: var(--ink-2); }
.kindpick__chip input:checked + span { border-color: var(--tungsten); background: color-mix(in srgb, var(--tungsten) 16%, transparent); color: var(--ink); }
.kindpick__chip input:focus-visible + span { outline: 1.5px solid var(--focus); outline-offset: 2px; }
.relation-people { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end; gap: 8px; }
.relation-people:has(> .relation-swap[hidden]) { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.relation-swap { display: grid; place-items: center; width: 40px; height: var(--control); color: var(--ink-3); }
.relation-swap:hover { color: var(--ink); }
@media (max-width: 560px) {
  .relation-people, .relation-people:has(> .relation-swap[hidden]) { grid-template-columns: minmax(0, 1fr); }
  .relation-swap { justify-self: center; height: 32px; transform: rotate(90deg); }
}
/* 인물 profile, 아는 사이 names and the 기념일 header: labels read small, values read plain */
.person__profile { margin-top: 4px; }
.detail-know { display: grid; grid-template-columns: max-content minmax(0, 1fr) auto; align-items: baseline; gap: 10px; margin: 8px 0 0; font-size: var(--t-small); }
.detail-know__k { color: var(--ink-3); }
.detail-know__v { color: var(--ink); overflow-wrap: anywhere; }
.detail-know__how { margin-left: 3px; color: var(--ink-3); }
.detail-know-form { margin-top: 8px; }
.access-holder-list { display: grid; gap: 12px; }
.access-holder-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto; gap: 8px; align-items: end; }
.access-holder-row > * { min-width: 0; }
@media (max-width: 600px) { .access-holder-row { grid-template-columns: minmax(0, 1fr) auto; } .access-holder-row > :first-child { grid-column: 1 / -1; } }
.sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.sec-head > .sec { margin-bottom: 0; }
.anniversary-new { margin: 10px 0 14px; }
.seg label { position: relative; display: inline-grid; }
.seg label input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.seg label span { display: grid; place-items: center; height: calc(var(--control) - 6px); padding: 0 12px; border-radius: var(--r); font-size: var(--t-small); font-weight: 600; color: var(--ink-3); }
.seg label input:checked + span { background: var(--screen-3); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.35); }
.seg label input:focus-visible + span { outline: 1.5px solid var(--focus); outline-offset: 2px; }
.form__bar .sp { flex: 1; }
.table { width: 100%; border-collapse: collapse; font-size: var(--t-ui); }
.table th, .table td { padding: 10px 12px 10px 0; text-align: left; vertical-align: top; border-bottom: 1px solid var(--rule); }
.table thead th { font-size: var(--t-micro); font-weight: 600; color: var(--ink-3); }
.table tbody th { font-weight: 500; }
@media (max-width: 760px) {
  .table thead { display: none; }
  .table, .table tbody, .table tr, .table th, .table td { display: block; width: 100%; }
  .table tbody { padding: 10px 0; border-bottom: 1px solid var(--rule); }
  .table tbody th { padding: 0 0 6px; border: 0; }
  .table td { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; padding: 3px 0; border: 0; }
  .table td::before { content: attr(data-label); font-size: var(--t-micro); color: var(--ink-3); }
}
.merge-preview { margin-top: 20px; padding: 16px; border-radius: var(--r); background: var(--screen); }
.merge-preview p { margin: 0; line-height: 1.7; }

/* 관계: opening credits, facts, two points of view, 명장면, intimacy, scene log */
@media (max-width: 899px) {
  .relations:not(.is-detail) .readercol, .relations.is-detail .listcol { display: none; }
}
.relfilters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 4px; }
.relperson .select { min-width: 140px; }
.tl-tools .relperson { flex: none; }
.relgroup + .relgroup { margin-top: 14px; }
/* The persona's pairs lead unlabeled; the rest follow one quiet divider. */
.relgroup__h { margin: 0 0 2px; padding-top: 12px; border-top: 1px solid var(--rule); font-size: var(--t-micro); font-weight: 500; color: var(--ink-3); }
.relgroup .pairrow .meta { display: grid; gap: 1px; }
.relgroup .pairrow .meta__who { color: var(--ink-3); font-weight: 500; }
.relgroup .pairrow .meta__text { color: var(--ink-2); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.pairrow .meta.is-label { color: var(--accent-text); }
.pairrow[aria-current="true"] { background: var(--screen-2); }
.refrow > summary .names { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; font-weight: 500; }
.refrow > summary .x { color: var(--ink-3); font-size: var(--t-micro); }
.titles .nm { display: block; overflow-wrap: anywhere; }
.titles__name { display: block; margin: 0 auto; max-width: 100%; }
.titles__name:hover .nm { color: var(--sub); }
.titles .tie { margin-top: 18px; font-size: var(--t-small); color: var(--ink-3); }
.pairsheet .titles { margin: 8px -16px 0; }
.pairsheet .pairs { margin: 4px 0 12px; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); margin: 0; padding: 18px 0; border-bottom: 1px solid var(--rule); text-align: center; }
.facts dd { margin: 0; font-size: var(--t-title); font-weight: 300; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.facts dt { font-size: var(--t-micro); color: var(--ink-3); }
.povs { display: grid; gap: 0; }
.pov { padding: 14px 0; }
.pov + .pov { border-top: 1px solid var(--rule); }
.pov__head { display: flex; align-items: center; gap: 8px; }
.pov__head h3 { flex: 1; min-width: 0; display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin: 0; font-size: var(--t-ui); font-weight: 500; }
.pov__head h3 .name { color: var(--accent-text); }
.pov__to { color: var(--ink-3); font-size: var(--t-small); }
.pov__text { font-size: var(--t-body); line-height: 1.8; color: var(--ink-2); overflow-wrap: anywhere; }
.pov__none { margin: 6px 0 0; font-size: var(--t-small); color: var(--ink-3); }
/* Axes read as one line of label · value; empty axes stay but step back. */
.emotion-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: var(--t-ui); }
.emotion-table th, .emotion-table td { padding: 12px 10px; overflow-wrap: anywhere; }
.emotion-table thead th { color: var(--ink-3); font-size: var(--t-small); font-weight: 400; text-align: right; }
.emotion-table th:first-child { width: 24%; text-align: left; }
.emotion-table tbody th { color: var(--ink-2); font-weight: 400; }
.emotion-table tbody tr { border-top: 1px solid var(--rule); }
.emotion-table td { text-align: right; font-size: var(--t-ui); }
.emotion-table td.emotion-table__strong { color: var(--cut); font-weight: 600; }
.emotion-table td.emotion-table__empty { color: color-mix(in srgb, var(--ink-3) 60%, var(--screen)); }
.emotion-note { margin: 8px 4px 0; font-size: var(--t-small); font-weight: 400; color: var(--ink-3); }

/* A clamped text that unfolds in place (details > summary > .clamp__text). */
.clamp > summary { display: block; list-style: none; cursor: pointer; }
.clamp > summary::-webkit-details-marker { display: none; }
.clamp__text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.clamp--3 .clamp__text { -webkit-line-clamp: 3; }
.clamp > summary:hover .clamp__text { color: var(--ink); }
.clamp[open] .clamp__text { -webkit-line-clamp: unset; overflow: visible; }
.tensions { margin-top: 10px; }
.frame__label { display: block; margin-bottom: 2px; color: var(--accent-text); font-weight: 600; font-size: var(--t-small); }
/* 기념일: the day it marks leads the card; the scene and its line follow. */
.anni { position: relative; flex: 0 0 84%; scroll-snap-align: center; border-radius: var(--r); background: var(--screen); box-shadow: var(--lift); }
.anni__open { display: grid; gap: 6px; width: 100%; padding: 16px 44px 16px 16px; text-align: left; border-radius: inherit; }
.anni__open:hover { background: var(--screen-2); }
.anni__label { font-size: var(--t-head); font-weight: 650; line-height: 1.4; color: var(--accent-text); overflow-wrap: anywhere; }
.anni__when { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-small); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.anni__pin .i { width: 12px; height: 12px; color: var(--accent-text); }
.anni__scene { display: block; line-height: 1.6; }
.anni__slug { display: block; font-size: var(--t-meta, var(--t-small)); color: var(--ink-3); }
.anni__title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: var(--t-ui); font-weight: 600; color: var(--ink); }
.anni .subtitle { margin-top: 6px; text-align: left; }
.anni__acts { position: absolute; top: 8px; right: 6px; }
.logbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }
.logbar .filters { flex: 1; min-width: 0; }
@media (max-width: 760px) { .logbar .filters { flex-basis: 100%; } .logbar .sortpick { margin-left: auto; } }
.sortpick .select { height: 28px; min-height: 28px; font-size: var(--t-small); }
.scenelog .day:first-child { margin-top: 8px; }
.scene { padding: 12px 0; }
.scenelog > .scene + .scene { border-top: 1px solid var(--rule); }
.scene__slug { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; font-size: var(--t-micro); color: var(--ink-3); }
.scene__slug b { color: var(--ink-2); font-weight: 600; }
.scene__title { display: block; margin-top: 2px; font-size: var(--t-body); font-weight: 600; line-height: 1.5; text-align: left; color: var(--ink); overflow-wrap: anywhere; }
button.scene__title:hover { color: var(--sub); }
/* Quiet scenes between changes fold into one line; opened, they list as compact links. */
.gap { margin: 2px 0; }
.gap > summary { display: flex; align-items: center; gap: 8px; min-height: 36px; list-style: none; cursor: pointer; font-size: var(--t-small); color: var(--ink-3); }
.gap > summary::-webkit-details-marker { display: none; }
.gap > summary::before { content: ""; width: 18px; border-top: 1px dashed var(--rule-2); }
.gap > summary:hover { color: var(--ink-2); }
.gap__list { margin: 0 0 8px 26px; padding: 0; list-style: none; display: grid; gap: 2px; }
.gap__list button, .gap__list li > span { display: block; width: 100%; padding: 4px 0; text-align: left; font-size: var(--t-ui); color: var(--ink-2); overflow-wrap: anywhere; }
.gap__list button:hover { color: var(--ink); }
.gap__list span > span, .gap__list button > span { margin-right: 8px; font-size: var(--t-micro); color: var(--ink-3); }
.scenelog > .gap + .scene, .scenelog > .scene + .gap { border-top: 1px solid var(--rule); }
[data-pair-section="diary"] > .fold { margin-top: 8px; }
.marks { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-size: var(--t-small); color: var(--ink-3); }
.mark { display: inline-flex; align-items: center; gap: 4px; }
.mark .i { width: 13px; height: 13px; }
.mark.is-key { color: var(--accent-text); }
.mark.is-cut { color: var(--cut); }
.scene .form { margin-top: 12px; }
.pairsheet__edit { margin-top: 20px; }
.axisedits { display: grid; gap: 12px; }
.axisedit { margin: 0; padding: 12px 0 0; border: 0; border-top: 1px solid var(--rule); }
.axisedit legend { padding: 0; font-size: var(--t-small); font-weight: 600; color: var(--ink-2); }
@media (min-width: 900px) {
  .pairsheet .titles { margin: 8px 0 0; }
  .pairsheet .reel { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; }
  .reel > .anni { flex: none; }
  .povs { grid-template-columns: 1fr 1fr; gap: 0 32px; }
  .pov + .pov { border-top: 0; }
}

/* 현재 · 콜시트: overdue promises first, then one group per person; verbs live in each row's ··· */
.who-h { display: flex; align-items: baseline; gap: 10px; margin: 30px 0 2px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); font-size: var(--t-head); font-weight: 500; }
.who-h .n { font-size: var(--t-micro); color: var(--ink-3); font-weight: 400; }
.who--due .who-h { font-weight: 650; color: var(--accent-text); }
.who--due .who-h .n { color: var(--accent-text); }
.who .fold { margin-top: 2px; }
.st-row { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 2px 10px; align-items: start; padding: 12px 0; }
.st-row + .st-row { border-top: 1px solid var(--rule); }
.st-row--plain { grid-template-columns: minmax(0, 1fr) auto; }
.st-row__kind { grid-row: span 2; font-size: var(--t-micro); color: var(--ink-3); padding-top: 3px; }
.st-row.is-due .st-row__kind { color: var(--accent-text); }
.st-row__what { grid-column: 2; font-size: var(--t-body); line-height: 1.65; text-align: left; color: var(--ink); overflow-wrap: anywhere; }
.st-row--plain .st-row__what, .st-row--plain .st-row__meta { grid-column: 1; }
button.st-row__what:hover { color: var(--sub); }
.st-row__who, .st-row__title, .st-row__text { display: block; }
.st-row__who { margin-bottom: 2px; font-size: var(--t-small); font-weight: 500; color: var(--ink-3); }
.st-row__title { margin-bottom: 2px; font-size: var(--t-body); font-weight: 600; line-height: 1.5; color: var(--ink); }
.st-row__text { color: var(--ink-2); }
button.st-row__what:hover .st-row__text { color: var(--ink); }
.st-row__meta { grid-column: 2; font-size: var(--t-micro); color: var(--ink-3); }
.st-row__meta .is-due { color: var(--accent-text); }
.st-row__acts { grid-column: -2; grid-row: 1 / span 2; display: flex; align-items: center; gap: 2px; }
.st-row__acts .btn { padding: 0 8px; }
@media (max-width: 760px) {
  .st-row { grid-template-columns: 40px minmax(0, 1fr) auto; }
  .st-row--plain { grid-template-columns: minmax(0, 1fr) auto; }
  .who--due .st-row { grid-template-columns: 40px minmax(0, 1fr); }
  .who--due .st-row--plain { grid-template-columns: minmax(0, 1fr); }
  .who--due .st-row__acts { grid-column: 1 / -1; grid-row: auto; justify-content: flex-start; margin: 4px 0 0 -8px; }
}

/* 인물 시트: kind lives in the section heading; only an exceptional stance or kind is tagged */
.entries--flat > .entry { grid-template-columns: minmax(0, 1fr); }
.entries--flat > .entry > .entry__src { grid-column: 1; }
.entry__tag { margin-right: 6px; font-size: var(--t-micro); font-weight: 600; color: var(--accent-text); }
.entry__who, .entry__title, .entry__body { display: block; }
.entry__who { margin-bottom: 2px; font-size: var(--t-small); font-weight: 500; color: var(--ink-3); }
.entry__title { margin-bottom: 2px; font-size: var(--t-body); font-weight: 600; line-height: 1.5; color: var(--ink); }
.entry__body { color: var(--ink-2); }
.entry.entry--promise { grid-template-columns: minmax(0, 1fr); overflow-wrap: anywhere; }
.entry__head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.entry__head > .entry__who { flex: 1; min-width: 0; }
.entry__head > .menu { flex: none; }
.entry--promise > .entry__src { grid-column: 1; }
/* Long ledger text keeps a readable measure inside the wide reader column. */
.person .entry__title, .person .entry__body { max-width: 44em; }
.psec .fold { margin-top: 2px; }
/* A subsection inside a person section (whose view): a small label over a hairline, above its own rows. */
.subsec { margin: 18px 0 0; padding-bottom: 6px; border-bottom: 1px solid var(--rule); font-size: var(--t-ui); font-weight: 600; color: var(--ink-2); }
.psec > h3.sec + .subsec { margin-top: 4px; }

/* 종료 · 삭제 confirmations: the record sits on a slate under its title, the consequence below it, then the verbs */
:root:not([data-skin="phone"]) .world-confirm .reader__title { margin-bottom: 18px; }
:root:not([data-skin="phone"]) .world-confirm__card { max-width: 68ch; padding: 18px 20px; border: 1px solid var(--rule); border-radius: var(--r); background: var(--screen); }
:root:not([data-skin="phone"]) .world-confirm__who { display: flex; align-items: center; gap: 10px; margin: 0 0 8px; font-size: var(--t-small); letter-spacing: .04em; color: var(--ink-3); }
:root:not([data-skin="phone"]) .world-confirm__person { margin: 0; font-size: var(--t-read); letter-spacing: 0; color: var(--ink); }
:root:not([data-skin="phone"]) .world-confirm__card .rec { margin: 0; font-size: var(--t-read); line-height: 1.75; color: var(--ink); }
:root:not([data-skin="phone"]) .world-confirm .notice { box-sizing: border-box; width: 100%; max-width: 68ch; margin-top: 14px; }
:root:not([data-skin="phone"]) .world-confirm .form__bar { max-width: 68ch; }
:root:not([data-skin="phone"]) .delete-impact { margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--rule); }
:root:not([data-skin="phone"]) .entry__body.is-empty { color: var(--ink-3); }
/* 현재: the records beside one record's history; on phones the list and the record are separate views */
@media (max-width: 899px) {
  .worldbook:not(.is-detail) .readercol, .worldbook.is-detail .listcol { display: none; }
}
.worldbook > .pagetitle { margin-top: 0; }
.now-hint { margin: 2px 0 0; font-size: var(--t-small); line-height: 1.5; color: var(--ink-3); }
.chg-n { display: inline-flex; align-items: center; gap: 3px; color: var(--tungsten); white-space: nowrap; }
.chg-n .i { width: 13px; height: 13px; }
/* One record: what it says now (or last said), then every step it took. */
.rec-who { margin: 6px 0 2px; font-size: var(--t-small); color: var(--ink-3); }
.rec-who .linkbtn { font-size: inherit; }
.rec .reader__title { margin: 0; }
.rec-now { margin-top: 14px; padding: 14px 16px 0; background: var(--screen); overflow: hidden; }
.rec-now__end { margin: 0 0 4px; font-size: var(--t-small); font-weight: 600; color: var(--cut); }
.rec-now__text { margin: 0 0 14px; font-size: var(--t-read); line-height: 1.6; color: var(--ink); text-wrap: pretty; overflow-wrap: anywhere; }
.rec-now__meta { margin: 0 -16px; }
.rec-now__meta > div { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 12px; padding: 11px 16px; border-top: 1px solid var(--rule); }
.rec-now__meta dt { font-size: var(--t-ui); color: var(--ink-3); }
.rec-now__meta dd { margin: 0; font-size: var(--t-ui); color: var(--ink); overflow-wrap: anywhere; }
.rec-truth { display: flex; align-items: flex-start; gap: 6px; margin: 8px 16px 0; font-size: var(--t-small); line-height: 1.5; color: var(--ink-3); }
.rec-truth .i { flex: none; width: 15px; height: 15px; margin-top: 1px; }
.rec-history { margin-top: 26px; }
/* The rail and every dot share one centre line (--rail) and the first text line's centre (--dot-y). */
.chg { --rail: 20px; --dot-y: 20px; margin: 0; padding: 6px 0; list-style: none; background: var(--screen); }
.chg > li { position: relative; padding: 0 16px 0 40px; }
.chg > li::before { content: ""; position: absolute; left: var(--rail); top: 0; bottom: 0; width: 2px; transform: translateX(-50%); background: var(--rule-2); }
.chg > li:first-child::before { top: var(--dot-y); }
.chg > li:last-child::before { bottom: auto; height: var(--dot-y); }
.chg > li:only-child::before { display: none; }
.chg > .chg__step { padding-top: calc(var(--dot-y) - 9px); padding-bottom: 12px; }
.chg__step::after { content: ""; position: absolute; left: var(--rail); top: var(--dot-y); box-sizing: border-box; width: 10px; height: 10px; border: 2px solid var(--ink-3); border-radius: 50%; background: var(--screen); transform: translate(-50%, -50%); }
.chg__step.is-now::after { width: 12px; height: 12px; border-color: var(--tungsten); background: var(--tungsten); box-shadow: 0 0 0 4px color-mix(in srgb, var(--tungsten) 20%, transparent); }
.chg__step.is-end::after { border-color: var(--cut); background: var(--cut); }
.chg__step.is-done::after { border-color: var(--ok); background: var(--ok); }
.chg__when { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 18px; line-height: 18px; }
.chg__when b { font-size: var(--t-small); font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.chg__step.is-now .chg__when b { color: var(--tungsten); }
.chg__scene { font-size: var(--t-small); text-align: right; }
.chg__text { margin: 3px 0 0; font-size: var(--t-ui); line-height: 1.55; color: var(--ink-2); text-wrap: pretty; overflow-wrap: anywhere; }
.chg__step.is-now .chg__text { color: var(--ink); }
.chg__why { margin: 4px 0 0; font-size: var(--t-small); line-height: 1.5; color: var(--ink-3); }
.chg__tag { display: inline-block; margin-top: 6px; padding: 2px 8px; font-size: var(--t-micro); color: var(--ink-2); background: var(--screen-3); }
.chg > .chg__step.has-acts { padding-right: 44px; }
.chg__acts { position: absolute; top: calc(var(--dot-y) - 14px); right: 8px; }
.chg__acts .iconbtn { width: 28px; height: 28px; }
.chg > .chg__how { padding-top: 2px; padding-bottom: 2px; font-size: var(--t-micro); line-height: 18px; color: var(--ink-3); }
.row__title--text { font-weight: 400; font-size: var(--t-body); line-height: 1.6; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; }
.worldbook .list h3.sec { margin: 18px 0 4px; font-size: var(--t-ui); }

/* 설정: section tabs, grouped fields (label wraps its control), one save bar */
.settingspage > .tabs { margin: 4px 0 8px; }
.settings-panel { margin-top: 12px; max-width: 760px; }
.setting-group { padding: 20px 0 8px; }
.setting-group + .setting-group { border-top: 1px solid var(--rule); }
.setting-group > h3, .setting-section-copy h3 { margin: 0 0 12px; font-size: var(--t-ui); font-weight: 650; }
.setting-section-copy p { margin: -6px 0 12px; }
.field > span:first-child:not(.label) { font-size: var(--t-small); font-weight: 600; color: var(--ink-2); }
.field > :is(input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]), select, textarea) { width: 100%; min-height: var(--control); padding: 0 11px; border: 1px solid var(--edge); border-radius: var(--r); background-color: var(--screen); color: var(--ink); font: 400 var(--t-ui)/1.5 var(--sans); }
.field > textarea { padding: 9px 11px; min-height: 84px; resize: vertical; }
.field > select { appearance: none; padding-right: 32px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238b8881' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 9px center; background-size: 15px; }
.field > :is(input, select, textarea):focus { border-color: var(--focus); outline: none; }
.field > :is(input, select, textarea):disabled { opacity: .45; }
.field > small { font-size: var(--t-micro); color: var(--ink-3); line-height: 1.5; }
.field--check > span:first-child { display: inline-flex; align-items: flex-start; gap: 10px; font-size: var(--t-ui); font-weight: 400; color: var(--ink); cursor: pointer; }
.field--check input[type="checkbox"] { appearance: none; flex: none; width: 16px; height: 16px; margin: 2px 0 0; border: 1px solid var(--edge); border-radius: 2px; background: var(--screen); display: grid; place-items: center; }
.field--check input[type="checkbox"]:checked { background: var(--tungsten); border-color: var(--tungsten); }
.field--check input[type="checkbox"]:checked::after { content: ""; width: 8px; height: 4px; border: 1.6px solid var(--tungsten-ink); border-top: 0; border-right: 0; transform: translateY(-1px) rotate(-45deg); }
.settings-connection { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: var(--r); background: var(--screen); margin-bottom: 14px; }
.settings-connection__mark .i { width: 16px; height: 16px; }
.settings-connection.is-ok .settings-connection__mark { color: var(--ok); }
.settings-connection.is-error .settings-connection__mark { color: var(--cut); }
.settings-connection.is-pending .settings-connection__mark { color: var(--accent-text); }
.settings-connection strong { display: block; font-size: var(--t-ui); }
.settings-connection small { color: var(--ink-3); font-size: var(--t-micro); }
.settings-cache-row { display: flex; align-items: center; gap: 8px; }
.field > .seg { justify-self: start; }
/* A group that ends in a closed fold lets the next group's rule be the only line between them. */
.setting-group > details.fold:last-child:not([open]) > summary { border-bottom: 0; }
.settings-regex-disclosure { margin-top: 10px; }
.settings-regex-summary { display: inline-flex; align-items: baseline; gap: 8px; }
.settings-regex-summary strong { font-weight: 600; }
.settings-regex-summary small { font-size: var(--t-micro); font-weight: 400; color: var(--ink-3); }
.settings-regex-body { display: grid; gap: 12px; }
.settings-regex-list { display: grid; gap: 10px; }
.settings-regex-empty, .settings-regex-note { margin: 0; font-size: var(--t-small); font-weight: 400; color: var(--ink-3); line-height: 1.6; }
.settings-regex-note code { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; color: var(--ink-2); }
.settings-regex-rule { display: grid; grid-template-columns: minmax(0, 1fr) 96px; gap: 10px 12px; align-items: end; padding: 12px 14px 14px; border-radius: var(--r); background: var(--screen); }
.settings-regex-enabled { display: inline-flex; align-items: center; gap: 8px; font-size: var(--t-ui); color: var(--ink); cursor: pointer; }
.settings-regex-enabled input { width: 16px; height: 16px; margin: 0; accent-color: var(--tungsten); }
.settings-regex-remove { grid-column: 2; grid-row: 1; justify-self: end; }
.settings-regex-pattern { grid-column: 1 / -1; }
@media (max-width: 760px) { .settings-regex-rule { grid-template-columns: minmax(0, 1fr); } .settings-regex-remove { grid-column: 1; } }
.settings-regex-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-top: 14px; }
.settings-regex-toolbar span { display: block; font-size: var(--t-micro); color: var(--ink-3); }
/* 추가 제외 규칙 reads as one more labelled field of 원문 정리, its add action a quiet link */
:root:not([data-skin="phone"]) .settings-regex-toolbar { align-items: center; margin-top: 18px; }
:root:not([data-skin="phone"]) .settings-regex-toolbar strong { font-size: var(--t-small); font-weight: 600; color: var(--ink-2); }
:root:not([data-skin="phone"]) .settings-regex-toolbar .btn { min-height: 0; height: auto; padding: 0; border: 0; background: none; color: var(--accent-text); font-size: var(--t-small); font-weight: 500; }
/* an opened disclosure flows straight into its fields */
.settings-advanced[open] > summary { border-bottom: 0; }
/* 설정 sections: a quiet side list beside the panel; on narrow screens a row of pills */
:root:not([data-skin="phone"]) .settings-nav { display: flex; gap: 6px; overflow-x: auto; margin: 4px 0 8px; scrollbar-width: none; }
:root:not([data-skin="phone"]) .settings-nav__row { display: flex; align-items: center; gap: 8px; flex: none; min-height: 34px; padding: 0 14px; border: 1px solid var(--rule); border-radius: 999px; background: none; color: var(--ink-2); font-size: var(--t-small); cursor: pointer; }
:root:not([data-skin="phone"]) .settings-nav__row[aria-current="true"] { border-color: var(--ink); color: var(--ink); font-weight: 600; }
:root:not([data-skin="phone"]) .settings-nav__ic, :root:not([data-skin="phone"]) .settings-nav__t small, :root:not([data-skin="phone"]) .settings-nav__row > .i:last-child { display: none; }
@media (min-width: 900px) {
  :root:not([data-skin="phone"]) .settingspage { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 0 40px; align-items: start; }
  :root:not([data-skin="phone"]) .settingspage > .intro { grid-column: 1 / -1; }
  :root:not([data-skin="phone"]) .settings-nav { position: sticky; top: 16px; flex-direction: column; gap: 0; overflow: visible; margin: 12px 0 0; border-top: 1px solid var(--rule); }
  :root:not([data-skin="phone"]) .settings-nav__row { gap: 12px; min-height: 0; padding: 12px 8px 12px 14px; border: 0; border-bottom: 1px solid var(--rule); border-radius: 0; text-align: left; font-size: var(--t-ui); font-weight: 400; color: var(--ink-2); box-shadow: inset 2px 0 0 transparent; }
  :root:not([data-skin="phone"]) .settings-nav__row[aria-current="true"] { border-color: var(--rule); color: var(--ink); font-weight: 600; box-shadow: inset 2px 0 0 var(--tungsten); }
  :root:not([data-skin="phone"]) .settings-nav__ic { display: grid; place-items: center; color: var(--ink-3); }
  :root:not([data-skin="phone"]) .settings-nav__ic .i { width: 16px; height: 16px; }
  :root:not([data-skin="phone"]) .settings-nav__row[aria-current="true"] .settings-nav__ic { color: var(--accent-text); }
  :root:not([data-skin="phone"]) .settings-nav__t { display: block; flex: 1; min-width: 0; }
  :root:not([data-skin="phone"]) .settings-nav__t small { display: block; margin-top: 2px; font-size: var(--t-micro); font-weight: 400; color: var(--ink-3); }
  :root:not([data-skin="phone"]) .settings-panel { margin-top: 0; }
}
.settings-bar { margin-top: 20px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }

/* 관리 · shared: page intro, message cards, verbs, comparisons, dialogs */
.intro { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 0 0 16px; }
.intro > .sub { margin: 0; flex: 1 1 260px; }
.intro__acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.msg { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; margin: 0 0 12px; padding: 14px 16px; border-radius: var(--r); background: var(--screen); }
.msg__icon { color: var(--accent-text); padding-top: 2px; }
.msg--warning .msg__icon, .msg--danger .msg__icon { color: var(--cut); }
.msg--success .msg__icon { color: var(--ok); }
.msg__body b { display: block; font-size: var(--t-ui); font-weight: 600; }
.msg__body p { margin: 4px 0 0; color: var(--ink-2); font-size: var(--t-body); line-height: 1.7; overflow-wrap: anywhere; }
.msg__acts { grid-column: 2; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
details.msg > summary { display: contents; list-style: none; cursor: pointer; }
details.msg > summary::-webkit-details-marker { display: none; }
.msg__more { grid-column: 2; display: inline-flex; align-items: center; gap: 4px; font-size: var(--t-small); color: var(--ink-3); }
.msg__more .i { width: 13px; height: 13px; transition: transform var(--fast) var(--ease); }
details.msg[open] .msg__more .i { transform: rotate(90deg); }
.msg__details { grid-column: 2; margin-top: 8px; }

/* Backfill content stays in the shared message content column. */
.home-backfill__meta { display: flex; flex-wrap: wrap; gap: var(--s3) var(--s6); margin: var(--s4) 0; }
.home-backfill__meta > div { display: flex; flex-direction: column; min-width: 0; gap: var(--s1); }
.home-backfill__meta dt { color: var(--ink-3); font-size: var(--t-small); }
.home-backfill__meta dd { order: -1; margin: 0; color: var(--ink); font-size: var(--t-head); font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.home-backfill__meta dd small { font-size: var(--t-small); font-weight: 400; }
.home-backfill__hint { display: flex; align-items: flex-start; gap: var(--s2); color: var(--ink-3); font-size: var(--t-small); line-height: 1.6; }
.home-backfill__hint > .i { flex: none; margin-top: var(--s1); }
/* A compact action: 32px visible, the transparent ::before keeps a 44px hit area. */
.home-backfill__action { position: relative; height: 32px; max-width: 100%; padding: 0 var(--s4); font-size: var(--t-small); }
.home-backfill__action::before { content: ""; position: absolute; inset: -6px 0; }
.home-backfill__details { flex-basis: 100%; min-width: 0; margin-top: var(--s2); color: var(--ink-2); font-size: var(--t-small); line-height: 1.7; overflow-wrap: anywhere; }
.home-backfill__details > summary { align-content: center; min-height: var(--s8); cursor: pointer; color: var(--ink-3); }
.home-backfill__details > summary:hover { color: var(--ink); }
.home-backfill__details > p { margin: var(--s2) 0 0; }
.home-backfill__details > ul { margin: var(--s3) 0; padding-left: var(--s4); }
.home-backfill__details li + li { margin-top: var(--s1); }

.decide { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.cmp { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
.cmp > div { padding: 14px 16px; background: var(--screen); border-radius: var(--r); }
.cmp .lab { font-size: var(--t-micro); color: var(--ink-3); margin-bottom: 6px; }
.cmp p { margin: 0; font-size: var(--t-body); line-height: 1.7; overflow-wrap: anywhere; }
.cmp .new { box-shadow: inset 0 0 0 1px var(--tungsten-dim); }
.cmp .new .lab { color: var(--accent-text); }
@media (max-width: 760px) { .cmp { grid-template-columns: 1fr; } }
@media (max-width: 899px) { .attention:not(.is-detail) .readercol, .attention.is-detail .listcol { display: none; } }
.conflict { padding: 16px 0; }
.conflict + .conflict { border-top: 1px solid var(--rule); }
.conflict__title { margin: 4px 0 0; font-size: var(--t-body); font-weight: 600; }
.lineage { list-style: none; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0; padding: 0; font-size: var(--t-ui); }
.lineage li { display: inline-flex; align-items: center; gap: 8px; }
.lineage__edge { font-size: var(--t-micro); color: var(--ink-3); }
.lineage__edge::before { content: "→ "; }
.noactive .empty { padding-top: 40px; }
.noactive .decide { justify-content: center; }
dialog.dialog { border: 0; color: var(--ink); max-height: calc(100vh - 32px); overflow: auto; }
dialog.dialog::backdrop { background: var(--scrim); }
.dialog__text { white-space: pre-wrap; overflow-wrap: anywhere; }
.dialog .choices { display: grid; gap: 12px; margin: 16px 0 0; padding: 0; border: 0; }
.dialog .check small { display: block; margin-top: 2px; }
@media (max-width: 760px) {
  dialog.dialog { width: 100%; max-width: none; margin: auto 0 0; padding: 20px 16px calc(16px + env(safe-area-inset-bottom)); border-radius: 12px 12px 0 0; }
}

/* 처리 상태 */
.opstate { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 16px; padding: 14px 16px; border-radius: var(--r); background: var(--screen); }
.opstate .status li { font-size: var(--t-ui); color: var(--ink); font-weight: 600; }
.opstate > .sub { grid-column: 1; margin: 0; }
.opstate > .n { grid-column: 2; grid-row: 1 / span 2; font-size: var(--t-micro); color: var(--ink-3); }
.progress { margin: 0 0 18px; padding: 4px 0 8px; }
.progress h3.sec { margin-top: 8px; }
.phases dd.is-done { color: var(--ok); } .phases dd.is-warn { color: var(--cut); } .phases dd.is-run { color: var(--accent-text); }
.job > summary, .job-group > summary { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto auto; align-items: start; gap: 8px; min-height: 44px; padding-block: 10px; font-weight: 400; }
.job--history > summary, .job-group > summary { grid-template-columns: minmax(0, 1fr) auto auto; }
.job-group.is-queued > summary { grid-template-columns: 18px minmax(0, 1fr) auto; }
.job__state { display: inline-flex; width: 18px; flex: none; color: var(--ink-3); }
.job__state .i { width: 18px; height: 18px; }
.job.is-failed .job__state { color: var(--cut); }
.job.is-leased .job__state, .job.is-retrying .job__state { color: var(--accent-text); }
.job.is-done .job__state, .job.is-completed .job__state { color: var(--ok); }
.job__title { flex: 1; min-width: 0; font-size: var(--t-ui); color: var(--ink); }
.job__name { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job__status { display: inline-block; margin-left: 6px; padding: 1px 5px; border: 1px solid var(--rule-2); border-radius: var(--r); color: var(--ink-2); font-size: var(--t-micro); font-weight: 600; line-height: 1.35; vertical-align: 1px; }
.job__status.is-superseded { color: var(--accent-text); border-color: var(--tungsten); }
.job__status.is-cancelled { color: var(--cut); border-color: var(--cut); }
.job__title small { display: block; font-size: var(--t-meta, var(--t-small)); color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job.is-failed .job__title small { color: var(--cut); }
.job.is-leased .job__title small, .job.is-retrying .job__title small { color: var(--accent-text); }
.job__time { font-size: var(--t-meta, var(--t-small)); color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.job-group + .job-group { margin-top: 0; }
.job + .job, .jobs > .fold { margin-top: 0; }
.step { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 8px 0; font-size: var(--t-ui); }
.step + .step { border-top: 1px solid var(--rule); }
.step > .i { width: 14px; height: 14px; margin-top: 3px; color: var(--ink-3); }
.step.is-succeeded > .i { color: var(--ok); } .step.is-failed > .i { color: var(--cut); } .step.is-running > .i { color: var(--accent-text); }
.step__main b { display: block; font-weight: 600; }
.step__main .sub { margin: 0; }
.step__usage { font-size: var(--t-micro); color: var(--ink-3); white-space: nowrap; }
.step__err { margin: 4px 0 0; color: var(--cut); font-size: var(--t-small); overflow-wrap: anywhere; }
@media (max-width: 760px) { .step { grid-template-columns: 16px minmax(0, 1fr); } .step__usage { grid-column: 2; } }

/* 데이터 */
.datapage .facts { margin-bottom: 16px; grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); row-gap: 12px; }
@media (max-width: 760px) { .datapage .facts dd { font-size: var(--t-head); } }
.chat + .chat { border-top: 1px solid var(--rule); }
.chatrow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: start; padding: 14px 0; }
.chatrow__main b { display: block; font-weight: 600; overflow-wrap: anywhere; }
.chatrow__main small { display: block; }
.chatrow__meta { display: block; margin-top: 4px; font-size: var(--t-small); color: var(--ink-3); line-height: 1.6; }
.chatrow__flag { display: inline-block; margin: 4px 10px 0 0; font-size: var(--t-small); color: var(--cut); }
.chats__bot + .chat { border-top: 0; }
.confirm { margin: 0 0 14px; padding: 14px 16px; border-radius: var(--r); background: var(--screen); }
.confirm.is-danger { box-shadow: inset 0 0 0 1px var(--cut-dim); }
.confirm .check { margin-top: 10px; }
.confirm .decide { margin-top: 12px; justify-content: flex-end; }
.inspector { margin: 0 0 18px; padding: 4px 0 12px; border-bottom: 1px solid var(--rule); }
.inspector__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tablewrap { overflow-x: auto; }
.srclog__bar { display: flex; align-items: center; gap: 6px; margin: 8px 0; }
.srclog__bar .sub { margin: 0 auto 0 0; }
.srclog__content { white-space: pre-wrap; max-width: 60ch; }

/* 기억 → 기억 정리: source ranges (checkbox + row), selection bar, before/after comparison */
.org-range { display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: start; }
.org-range + .org-range { box-shadow: 0 -1px 0 var(--rule); }
.org-range.is-hl { box-shadow: inset 2px 0 var(--tungsten); }
.org-check { display: grid; place-items: center; min-height: 44px; padding-top: 6px; }
.org-check input { width: 18px; height: 18px; accent-color: var(--tungsten); }
.org-range .row__title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.org-h { display: flex; align-items: baseline; gap: 8px; margin: 22px 0 8px; font-size: var(--t-small); font-weight: 600; color: var(--ink-2); }
.org-h .n { color: var(--cut); font-variant-numeric: tabular-nums; }
.org-work { margin-bottom: 8px; }
.org-work .org-h { margin-top: 0; }
.org-state { font-size: var(--t-small); color: var(--ink-3); }
.org-applied { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; overflow-wrap: anywhere; }
.org-sel { display: grid; gap: 10px; padding: 14px 0 4px; border-top: 1px solid var(--rule); background: var(--house); }
.org-sel__sum { display: grid; gap: 2px; font-size: var(--t-small); color: var(--ink-3); }
.org-sel__sum b { color: var(--ink); font-weight: 600; }
.org-sel__acts { display: flex; flex-wrap: wrap; gap: 6px; }
.org-mems { display: grid; }
.org-mem { padding: 14px 0; border-bottom: 1px solid var(--rule); overflow-wrap: anywhere; }
.org-mem h4 { margin: 0 0 6px; font-size: var(--t-body); font-weight: 600; }
.org-mem p { margin: 0; font-size: var(--t-body); line-height: 1.75; color: var(--ink-2); white-space: pre-line; }
.org-mem .lab { margin-bottom: 4px; }
.org-mem .fold { margin-top: 8px; }
.org-cmp { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
.org-cmp .org-mem:last-child { border-bottom: 0; }
.org-states { margin: 0; padding-left: 18px; font-size: var(--t-body); line-height: 1.7; color: var(--ink-2); overflow-wrap: anywhere; }
.organization .reader .form__bar { margin-top: 24px; }
@media (max-width: 899px) {
  .organization:not(.is-detail) .readercol, .organization.is-detail .listcol, .organization.is-detail > .intro { display: none; }
  .org-sel { position: sticky; bottom: calc(58px + env(safe-area-inset-bottom)); margin: 0 -16px; padding: 12px 16px; }
  .org-sel__acts .btn { flex: 1 1 auto; }
}
@media (max-width: 760px) { .org-cmp { grid-template-columns: 1fr; } }
@media (min-width: 900px) { .org-sel { position: sticky; bottom: 0; } }

/* phones: every button, icon button, segment and filter keeps a 44px touch target, like .hit */
@media (max-width: 760px) {
  .btn { height: 32px; }
  .btn:not(.btn--quiet) { padding-inline: 12px; }
  .btn, .iconbtn, .seg button, .filter { position: relative; }
  .btn::after, .iconbtn::after, .seg button::after, .filter::after { content: ""; position: absolute; left: 50%; top: 50%; width: max(100%, var(--hit)); height: max(100%, var(--hit)); transform: translate(-50%, -50%); }
  .seg { overflow: visible; }
  .seg label input { inset: auto; left: 50%; top: 50%; width: max(100%, var(--hit)); height: max(100%, var(--hit)); transform: translate(-50%, -50%); }
  .filters { padding-block: 8px; margin-block: -8px; }
}
/* iOS zooms into any field under 16px; last so it beats sized pickers */
@media (max-width: 760px) { .film :is(.input, .select, .textarea, .field > input, .field > select, .field > textarea) { font-size: 16px; } }
/* 기억 · 줄거리: a series of features. PART tabs, each part opens on its own title card, its acts are subtitled stills, the chosen act plays on the screen below */
:root:not([data-skin="phone"]) .series .seasons { display: flex; gap: 4px; margin: 40px -16px 0; padding: 0 16px; overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--rule); }
:root:not([data-skin="phone"]) .series .seasons::-webkit-scrollbar { display: none; }
:root:not([data-skin="phone"]) .season-tab { flex: none; display: flex; align-items: center; gap: 8px; height: 48px; margin-bottom: -1px; padding: 0 14px; border-bottom: 2px solid transparent; color: var(--ink-3); white-space: nowrap; transition: color var(--fast) var(--ease); }
:root:not([data-skin="phone"]) .season-tab__no { font-family: var(--credit); font-stretch: 125%; font-weight: 500; font-size: var(--t-credit); letter-spacing: .26em; }
:root:not([data-skin="phone"]) .season-tab__now { font-size: var(--t-micro); color: var(--accent-text); }
:root:not([data-skin="phone"]) .season-tab:hover { color: var(--ink-2); }
:root:not([data-skin="phone"]) .season-tab[aria-current="true"] { color: var(--ink); border-bottom-color: var(--tungsten); }
:root:not([data-skin="phone"]) .series .season__head { display: grid; justify-items: center; gap: 10px; margin-top: 44px; text-align: center; }
:root:not([data-skin="phone"]) .season__titlebar { display: grid; grid-template-columns: var(--hit) minmax(0, 1fr) var(--hit); align-items: center; width: 100%; }
:root:not([data-skin="phone"]) .season__titlebar::before { content: ""; }
:root:not([data-skin="phone"]) .season__title { justify-self: center; max-width: 24ch; margin: 0; font-size: 25px; font-weight: 300; line-height: 1.45; letter-spacing: .02em; text-wrap: balance; overflow-wrap: anywhere; }
:root:not([data-skin="phone"]) .series .season__head > .tc { font-variant-numeric: tabular-nums; }
:root:not([data-skin="phone"]) .series .season__head .syn { max-width: 68ch; margin: 14px 0 0; text-align: left; font-size: var(--t-read); line-height: 1.85; color: var(--ink-2); }
:root:not([data-skin="phone"]) .season__folds { width: 100%; max-width: 68ch; text-align: left; }
:root:not([data-skin="phone"]) .series .episodes { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(230px, 74%); gap: 14px; margin: 32px -16px 0; padding: 4px 16px 12px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding-inline: 16px; scrollbar-width: none; }
:root:not([data-skin="phone"]) .series .episodes::-webkit-scrollbar { display: none; }
:root:not([data-skin="phone"]) .ep { display: grid; align-content: start; gap: 4px; min-width: 0; text-align: left; scroll-snap-align: start; }
:root:not([data-skin="phone"]) .ep__still { position: relative; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; aspect-ratio: 16 / 9; margin-bottom: 8px; padding: 34px 18px 14px; border-radius: var(--r); overflow: hidden; text-align: center;
  background: radial-gradient(110% 80% at 50% 35%, #1a1b1f 0%, #070708 100%); box-shadow: 0 0 0 1px rgba(255,255,255,.04), var(--lift); transition: box-shadow var(--fast) var(--ease); }
:root:not([data-skin="phone"]) .ep:hover .ep__still { box-shadow: 0 0 0 1px rgba(255,255,255,.14), var(--lift); }
:root:not([data-skin="phone"]) .ep[aria-current="true"] .ep__still { box-shadow: 0 0 0 1px var(--tungsten), var(--lift); }
:root:not([data-skin="phone"]) .ep__no { position: absolute; top: 12px; left: 14px; font-family: var(--credit); font-stretch: 125%; font-weight: 500; font-size: var(--t-credit); letter-spacing: .3em; color: #dba35a; }
:root:not([data-skin="phone"]) .ep__now { position: absolute; top: 10px; right: 12px; font-size: var(--t-micro); color: #dba35a; }
:root:not([data-skin="phone"]) .ep__line { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; font-size: var(--t-small); line-height: 1.55; color: #f4ecd0; text-shadow: 0 1px 2px rgba(0,0,0,.9); text-wrap: balance; }
:root:not([data-skin="phone"]) .ep__line:not(.is-quote) { color: #b3afa7; font-style: italic; }
:root:not([data-skin="phone"]) .ep__line .orig-mark { color: #8b8881; }
:root:not([data-skin="phone"]) .ep__who { font-size: var(--t-micro); color: #8b8881; }
:root:not([data-skin="phone"]) .ep__title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: var(--t-body); font-weight: 500; line-height: 1.45; color: var(--ink-2); }
:root:not([data-skin="phone"]) .ep[aria-current="true"] .ep__title, :root:not([data-skin="phone"]) .ep:hover .ep__title { color: var(--ink); }
:root:not([data-skin="phone"]) .ep__syn { display: none; }
:root:not([data-skin="phone"]) .ep__meta { font-size: var(--t-small); color: var(--ink-3); font-variant-numeric: tabular-nums; }
:root:not([data-skin="phone"]) .series .actview { margin-top: 44px; padding-top: 40px; border-top: 1px solid var(--rule); scroll-margin-top: 110px; }
:root:not([data-skin="phone"]) .actview__head { display: flex; align-items: flex-start; gap: 8px; }
:root:not([data-skin="phone"]) .actview__head h2 { flex: 1; min-width: 0; margin: 0; font-size: var(--t-title); font-weight: 600; line-height: 1.45; overflow-wrap: anywhere; }
:root:not([data-skin="phone"]) .series .actview__lead > .tc { display: block; margin-top: 10px; }
:root:not([data-skin="phone"]) .actview__syn { max-width: 68ch; margin: 20px 0 0; font-size: var(--t-read); line-height: 1.9; color: var(--ink-2); white-space: pre-line; }
:root:not([data-skin="phone"]) .series .actview .reel { margin-top: 26px; }
:root:not([data-skin="phone"]) .series .actsec { margin-top: 40px; }
:root:not([data-skin="phone"]) .series .actsec > .sec { margin: 0 0 14px; }
:root:not([data-skin="phone"]) .series .actsec .reel { margin-top: 0; }
:root:not([data-skin="phone"]) .series .actsec .rail, :root:not([data-skin="phone"]) .series .actsec > .threadlist { max-width: 68ch; }
:root:not([data-skin="phone"]) .series .actview .flowcards { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
:root:not([data-skin="phone"]) .flowcard__text { margin: 0; font-size: var(--t-small); line-height: 1.75; color: var(--ink-2); }
@media (min-width: 900px) {
  :root:not([data-skin="phone"]) .series .seasons { margin-inline: 0; padding-inline: 0; }
  :root:not([data-skin="phone"]) .series .episodes { grid-auto-flow: row; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 26px 18px; margin-inline: 0; padding-inline: 0; overflow: visible; }
  :root:not([data-skin="phone"]) .season__title { font-size: 30px; }
  :root:not([data-skin="phone"]) .series .actview .reel { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-inline: 0; padding-inline: 0; overflow: visible; }
  :root:not([data-skin="phone"]) .series .actview .reel > .frame { min-width: 0; }
}
/* scene sheet: the projector stops on one scene. The house goes dark with letterbox bars and the frame sits on the screen with its subtitle */
:root:not([data-skin="phone"]) .scene-sheet { --ink: #ebe8e2; --ink-2: #b3afa7; --ink-3: #8b8881; --rule: #222328; --rule-2: #33353b; --screen: #16171a; --accent-text: #dba35a; width: min(780px, calc(100vw - 32px)); max-height: 80vh; margin: auto; padding: 0; border: 0; border-radius: var(--r); overflow: hidden; color: #ebe8e2; background: #0f1012; box-shadow: 0 0 0 1px rgba(255,255,255,.06), 0 30px 80px -20px rgba(0,0,0,.9); }
:root:not([data-skin="phone"]) .scene-sheet[open] { display: flex; flex-direction: column; animation: scene-sheet-in 360ms var(--ease); }
:root:not([data-skin="phone"]) .scene-sheet::backdrop { background: linear-gradient(#000 0 8vh, rgba(0,0,0,.84) 8vh calc(100% - 8vh), #000 calc(100% - 8vh)); animation: scene-sheet-dim 420ms ease-out; }
@keyframes scene-sheet-in { from { opacity: 0; transform: scale(.985); } }
@keyframes scene-sheet-dim { from { opacity: 0; } }
:root:not([data-skin="phone"]) .scene-sheet__grip { display: none; }
:root:not([data-skin="phone"]) .scene-sheet__bar { flex: none; display: flex; align-items: center; gap: 8px; padding: 14px 12px 0 26px; }
:root:not([data-skin="phone"]) .scene-sheet__slug { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--t-small); color: #dba35a; }
:root:not([data-skin="phone"]) .scene-sheet__bar .iconbtn { color: #b3afa7; }
:root:not([data-skin="phone"]) .scene-sheet__body { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 18px 26px 30px; }
:root:not([data-skin="phone"]) .scene-sheet__title { margin: 0; text-align: center; font-size: var(--t-title); font-weight: 300; line-height: 1.5; letter-spacing: .02em; text-wrap: balance; color: #ebe8e2; }
:root:not([data-skin="phone"]) .scene-sheet__line { margin: 26px auto 0; max-width: 46ch; text-align: center; }
:root:not([data-skin="phone"]) .scene-sheet__line p { margin: 0; font-size: var(--t-read); line-height: 1.7; color: #f4ecd0; }
:root:not([data-skin="phone"]) .scene-sheet__line cite { display: block; margin-top: 6px; font-style: normal; font-size: var(--t-small); color: #8b8881; }
:root:not([data-skin="phone"]) .scene-sheet__lede { max-width: 56ch; margin: 22px auto 0; text-align: center; font-size: var(--t-read); line-height: 1.85; color: #f4ecd0; }
:root:not([data-skin="phone"]) .scene-sheet .sheet-sec { max-width: 68ch; margin: 34px auto 0; }
:root:not([data-skin="phone"]) .scene-sheet .sheet-sec > .sec { margin: 0 0 14px; }
:root:not([data-skin="phone"]) .sheet-people { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
:root:not([data-skin="phone"]) .sheet-person { min-width: 0; padding: 16px 16px 8px; border-radius: var(--r); background: #16171a; }
:root:not([data-skin="phone"]) .sheet-person h4 { margin: 0 0 10px; }
:root:not([data-skin="phone"]) .sheet-person > .flowcard__text { margin-bottom: 12px; }
:root:not([data-skin="phone"]) .sheet-person .rail p, :root:not([data-skin="phone"]) .sheet-person .threadlist li { font-size: var(--t-small); }
:root:not([data-skin="phone"]) .season__more { display: inline-flex; align-items: center; gap: 4px; min-height: var(--hit); margin-top: 4px; font-size: var(--t-small); color: var(--accent-text); }
:root:not([data-skin="phone"]) .season__more .i { width: 13px; height: 13px; }
:root:not([data-skin="phone"]) .series .actview .flowcard { position: relative; }
:root:not([data-skin="phone"]) .series .actview .flowcard:hover { box-shadow: 0 0 0 1px var(--rule-2); }
:root:not([data-skin="phone"]) .flowcard__open { display: inline-flex; align-items: center; gap: 6px; text-align: left; }
:root:not([data-skin="phone"]) .flowcard__open::after { content: ""; position: absolute; inset: 0; }
:root:not([data-skin="phone"]) .flowcard__open .i { width: 13px; height: 13px; color: var(--ink-3); }
:root:not([data-skin="phone"]) .scene-sheet__record { max-width: 68ch; margin: 30px auto 0; padding-top: 24px; border-top: 1px solid #222328; font-size: var(--t-read); line-height: 1.9; color: #b3afa7; white-space: pre-line; }
:root:not([data-skin="phone"]) :is(.scene-sheet__record, .scene-sheet__title, .scene-sheet__line) .orig-mark { color: #8b8881; }
:root:not([data-skin="phone"]) .scene-sheet__foot { flex: none; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 4px; padding: 8px 12px; border-top: 1px solid #222328; }
:root:not([data-skin="phone"]) .scene-sheet__foot .btn { color: #b3afa7; }
:root:not([data-skin="phone"]) .scene-sheet__foot > :first-child { justify-self: start; }
:root:not([data-skin="phone"]) .scene-sheet__foot > :last-child { justify-self: end; }
:root:not([data-skin="phone"]) :is(.scene-sheet.is-shown[open], .scene-sheet.is-shown::backdrop) { animation: none; }
@media (prefers-reduced-motion: reduce) { :root:not([data-skin="phone"]) :is(.scene-sheet[open], .scene-sheet::backdrop) { animation: none; } }

/* ---- 이번 턴에 전달한 기억: home widget and full view ---- */
.sent-mix { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 4px 0 6px; padding: 10px 0; border: 1px solid var(--rule); border-radius: var(--r); }
.sent-mix > div { display: grid; justify-items: center; gap: 1px; min-width: 0; }
.sent-mix > div + div { border-left: 1px solid var(--rule); }
.sent-mix b { font-size: 19px; font-weight: 650; letter-spacing: -.01em; color: var(--ink); font-variant-numeric: tabular-nums; line-height: 1.2; }
.sent-mix small { font-size: var(--t-micro); color: var(--ink-3); }
.sent-mix .is-off b { font-size: var(--t-micro); font-weight: 500; color: var(--ink-3); line-height: 1.9; }
.sent-widget { display: grid; }
.sent-widget .wg__row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; min-height: 40px; padding: 6px 0; color: inherit; text-align: left; }
.sent-widget .wg__row + .wg__row { border-top: 1px solid var(--rule); }
.sent-widget .wg__row:hover .wg__main { color: var(--accent-text); }
.sent-widget .wg__no { min-width: 3.4em; font-size: var(--t-micro); color: var(--ink-3); font-variant-numeric: tabular-nums; }
.sent-widget .wg__main { min-width: 0; font-size: var(--t-ui); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sent-widget .wg__end, .sent-widget .wg__haze { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-micro); color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sent-widget .wg__haze { color: var(--accent-text); }
.sent-widget .wg__end .i { width: 14px; height: 14px; }
.sent-widget .wg__more { grid-template-columns: minmax(0, 1fr) auto; font-size: var(--t-ui); font-weight: 600; border-top: 1px solid var(--rule); }
.sent-budget { display: flex; align-items: center; gap: 10px; margin: 0; padding: 8px 0 10px; font-size: var(--t-micro); color: var(--ink-3); font-variant-numeric: tabular-nums; }
.sent-budget i { flex: 1; min-width: 40px; height: 3px; border-radius: 2px; background: var(--rule-2); overflow: hidden; }
.sent-budget i::after { content: ""; display: block; width: var(--v, 0%); height: 100%; background: var(--tungsten); }
.sent-budget.is-over i::after { background: var(--cut); }
.sent { max-width: 760px; margin: 0 auto; padding: 4px 0 48px; }
.sent__top { display: flex; align-items: center; min-height: 40px; }
.sent .pagetitle { margin: 2px 0; }
.sent__when { margin: 0 0 12px; font-size: var(--t-small); color: var(--ink-3); font-variant-numeric: tabular-nums; }
.sent__note { margin: 0 0 20px; max-width: 62ch; font-size: var(--t-small); line-height: 1.55; color: var(--ink-2); }
.sent__h { display: flex; align-items: baseline; gap: 8px; margin: 28px 0 8px; font-size: var(--t-ui); font-weight: 650; }
.sent__h .n { font-weight: 400; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.sent__h small { margin-left: auto; font-size: var(--t-micro); font-weight: 400; color: var(--ink-3); }
.sent-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); }
.sent-list > li { border-bottom: 1px solid var(--rule); }
.sent-row { display: grid; grid-template-columns: 3.2em minmax(0, 1fr) auto; align-items: start; gap: 2px 10px; width: 100%; padding: 10px 2px; text-align: left; color: inherit; }
button.sent-row:hover .sent-row__t { color: var(--accent-text); }
.sent-row__k { padding-top: 2px; font-size: var(--t-micro); color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sent-row__t { min-width: 0; font-size: var(--t-ui); font-weight: 600; line-height: 1.45; text-wrap: pretty; }
.sent-row__t.is-text { font-weight: 400; color: var(--ink-2); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.sent-row__t .who { font-weight: 600; color: var(--ink); }
.sent-row__m { grid-column: 2; font-size: var(--t-micro); color: var(--ink-3); }
.sent-row__end { padding-top: 2px; color: var(--ink-3); }
.sent-row__end .i { width: 14px; height: 14px; }
.sent-row__m .pill { margin-right: 4px; }
.pill { display: inline-block; padding: 0 6px; border-radius: 8px; font-size: var(--t-micro); font-weight: 500; line-height: 1.6; color: var(--ink-2); background: var(--screen-2); white-space: nowrap; }
.pill--haze { color: var(--accent-text); background: var(--tungsten-dim); }
.sent-more { display: block; width: 100%; padding: 10px 2px; text-align: left; font-size: var(--t-ui); color: var(--accent-text); }
.sent-off { margin: 0; padding: 10px 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); font-size: var(--t-ui); color: var(--ink-3); }
.sent-q { display: flex; gap: 8px; padding: 12px 2px 2px; font-size: var(--t-ui); line-height: 1.5; }
.sent-q .i { flex: none; width: 15px; height: 15px; margin-top: 3px; color: var(--accent-text); }
.sent-q q { quotes: "“" "”"; font-weight: 600; }
.sent-q small { display: block; font-size: var(--t-micro); color: var(--ink-3); }
.sent-raw { margin-top: 28px; }
.sent-raw > summary { display: flex; align-items: center; gap: 6px; padding: 10px 2px; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); font-size: var(--t-ui); font-weight: 600; list-style: none; cursor: pointer; }
.sent-raw > summary::-webkit-details-marker { display: none; }
.sent-raw > summary small { margin-left: auto; font-weight: 400; font-size: var(--t-micro); color: var(--ink-3); }
.sent-raw > summary .i { width: 14px; height: 14px; color: var(--ink-3); transition: transform var(--fast) var(--ease); }
.sent-raw[open] > summary .i { transform: rotate(90deg); }
.sent-raw .packet { margin-top: 10px; }
@media (min-width: 900px) {
  .sent { max-width: 1040px; }
  .sent__head { display: grid; grid-template-columns: minmax(0, 1fr) 420px; gap: 28px; align-items: end; margin-bottom: 8px; }
  .sent__head .sent-mix { margin: 0 0 20px; }
  .sent__cols { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 0 32px; align-items: start; }
  .sent__cols > div > .sent__h:first-child { margin-top: 4px; }
}
/* ---- 현재: title, the range and kinds as one bar, then the list and the record scrolling on their own ---- */
.nowbook > .pagetitle { margin: 0 0 10px; }
.now-bar { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; }
.now-bar .now-mode { flex: none; display: flex; margin: 0; }
.now-bar .now-mode button { min-width: 64px; padding-inline: 12px; }
.now-chips { display: flex; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.now-chips::-webkit-scrollbar { display: none; }
.now-chip { display: inline-flex; align-items: center; gap: 6px; flex: none; height: 30px; padding: 0 10px; border: 1px solid var(--rule); border-radius: 15px; font-size: var(--t-small); color: var(--ink-2); }
.now-chip__ic { display: none; }
.now-chip .n { color: var(--ink-3); font-variant-numeric: tabular-nums; }
.now-chip[aria-pressed="true"] { border-color: var(--tungsten); color: var(--ink); background: var(--tungsten-dim); }
.now-chip.is-empty { opacity: .55; }
.now-bar__end { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; flex: none; }
.now-sort { position: relative; display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 8px; font-size: var(--t-small); color: var(--accent-text); cursor: pointer; }
.now-sort .i { width: 15px; height: 15px; }
.now-sort select { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.now-sort:focus-within { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: var(--r); }
.now-note { display: flex; align-items: center; gap: 6px; width: 100%; margin: 0 0 6px; padding: 9px 2px; border-bottom: 1px solid var(--rule); font-size: var(--t-small); color: var(--ink-2); text-align: left; }
.now-note b { color: var(--cut); font-weight: 600; }
.now-note span { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; color: var(--accent-text); }
.now-note .i { width: 14px; height: 14px; }
.now-hint { margin: 0 0 6px; font-size: var(--t-small); line-height: 1.5; color: var(--ink-3); }
.nr { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; padding: 10px 2px; border-top: 1px solid var(--rule); }
.nr__what { grid-column: 1; display: grid; gap: 2px; min-width: 0; text-align: left; color: inherit; }
.nr__what:hover .nr__t { color: var(--accent-text); }
.nr__k { font-size: var(--t-small); color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nr__kind { font-weight: 600; color: var(--ink-2); }
.nr__t { font-size: var(--t-ui); line-height: 1.55; color: var(--ink); max-width: 44em; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.nr__m { grid-column: 1; font-size: var(--t-small); color: var(--ink-3); }
.nr__m .is-due { color: var(--cut); }
.nr__acts { grid-column: 2; grid-row: 1 / span 2; display: inline-flex; align-items: center; gap: 4px; }
.nr.is-due .nr__kind { color: var(--cut); }
@media (min-width: 900px) { .nr.is-selected { background: var(--screen-2); } }
@media (min-width: 900px) {
  .nowbook .split .listcol { min-height: 0; }
  .nowbook .now-rows { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 10px 28px; margin: 0 -10px; }
  .nowbook.is-list-only .split { grid-template-columns: minmax(0, 1fr); }
  .nowbook.is-list-only .readercol { display: none; }
  .nowbook.is-list-only .now-rows { max-width: 920px; }
}
@media (max-width: 899px) {
  .now-bar { flex-wrap: wrap; row-gap: 8px; }
  .now-bar .now-mode { flex: 1 0 100%; }
  .now-bar .now-mode button { flex: 1; }
  .now-chips { flex: 1; }
  .now-sort__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .nowbook.is-detail > .pagetitle, .nowbook.is-detail > .now-bar { display: none; }
}

/* ---- cards that open their own verbs: a record is the button, so rows carry no ··· ---- */
.cardmenu { position: relative; display: block; }
.cardmenu > summary { list-style: none; cursor: pointer; }
.cardmenu > summary::-webkit-details-marker { display: none; }
.cardmenu > .menu__pop { right: 8px; top: calc(100% - 4px); }
.entry:has(> .cardmenu, > .entry__tap) { padding: 0; }
.entry__face { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; width: 100%; padding: 11px 0; text-align: left; color: inherit; border-radius: inherit; }
.entry__tap { grid-template-columns: minmax(0, 1fr) auto; column-gap: 10px; }
.entry__tap > :not(.i) { grid-column: 1; }
.entry__tap > .i { grid-column: 2; grid-row: 1 / span 3; align-self: center; width: 14px; height: 14px; color: var(--ink-3); }
.entry__face > .entry__src { font-size: var(--t-small); color: var(--accent-text); }
.pov__face { display: block; border-radius: inherit; }
@media (hover: hover) { :is(.entry__face, .pov__face):hover { background-color: color-mix(in srgb, var(--ink) 4%, transparent); } }
.cardmenu[open] > summary, .entry__tap:active { background-color: var(--screen-2); }
:is(.entry__face, .pov__face):focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
.pickbar { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; padding: 6px 6px 6px 12px; border: 1px solid var(--tungsten); border-radius: var(--r); font-size: var(--t-small); color: var(--ink); }
.pickbar .btn { margin-left: auto; }

/* ---- 아는 사이: one contact per person on rules; an open contact hangs off a lit rule ---- */
/* The title keeps its top margin; the two icons sit on its line, not centred on the margin. */
.acq__acts { display: inline-flex; align-self: flex-end; gap: 2px; margin: 0 -6px -1px auto; }
.acquaintances > .sec-head { margin-bottom: 8px; }
.acquaintances > .sec-head > .sec { margin-top: 30px; }
.acq-list { list-style: none; margin: 0; padding: 0; border-bottom: 1px solid var(--rule); }
.acq-list > li { border-top: 1px solid var(--rule); }
.acq__row { list-style: none; cursor: pointer; }
.acq__row::-webkit-details-marker { display: none; }
.acq__row .row__end .i { transition: transform var(--fast) var(--ease); }
.acq[open] > .acq__row .row__end .i { transform: rotate(90deg); }
.acq[open] > .acq__row .row__title .name { color: var(--tungsten); }
.acq__how.is-met { display: inline-flex; align-items: baseline; gap: 2px; color: var(--ok); }
.acq__how .i { width: 12px; height: 12px; align-self: center; }
.acq__body { margin: 0 0 14px 2px; padding: 0 2px 4px 18px; border-left: 1px solid var(--tungsten); }
.acq__side { padding: 6px 0 12px; }
.acq__side + .acq__side { padding-top: 12px; border-top: 1px dashed var(--rule-2); }
.acq__h { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: var(--t-small); color: var(--ink-3); }
.acq__h b { font-weight: 600; color: var(--ink-2); }
.acq__lv.is-met { color: var(--ok); }
.acq__h > .menu { margin-left: auto; }
.acq__edit { list-style: none; cursor: pointer; font-size: var(--t-small); color: var(--accent-text); }
.acq__edit::-webkit-details-marker { display: none; }
.acq__tagrow { display: grid; grid-template-columns: 4.8em minmax(0, 1fr); gap: 8px; margin: 6px 0 0; }
.acq__k { padding-top: 4px; font-size: var(--t-micro); letter-spacing: .04em; color: var(--ink-3); }
.acq__tags { display: flex; flex-wrap: wrap; gap: 6px; }
.acq__tag { padding: 2px 9px; border: 1px solid var(--rule-2); border-radius: var(--r); font-size: var(--t-small); line-height: 1.6; color: var(--ink-2); }
.acq__tag--call { border-color: color-mix(in srgb, var(--tungsten) 60%, transparent); background: var(--tungsten-dim); color: var(--sub); }
.acq__memo { margin: 10px 0 0; max-width: 62ch; font-size: var(--t-body); line-height: 1.7; color: var(--ink-2); }

`;
