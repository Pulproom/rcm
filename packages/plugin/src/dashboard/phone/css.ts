import { FILM_CSS } from "../film/css.js";

/**
 * Phone skin layer. It loads after FILM_CSS, which keeps the layout mechanics (split columns, scroll owners,
 * phone detail views); this layer remaps the film tokens to an iOS palette and redraws the components.
 */
export const PHONE_SKIN_CSS = `
/* ===== RCM · Phone skin =====
   Loaded after FILM_CSS (which keeps the layout mechanics: split columns, scroll owners, phone detail views).
   This layer remaps the film tokens to an iOS palette and redraws the components. */
:root, :root[data-theme="night"] {
  color-scheme: dark;
  --house: #000000; --screen: #1C1C1E; --screen-2: #2C2C2E; --screen-3: #2C2C2E;
  --rule: rgba(84,84,88,.45); --rule-2: rgba(84,84,88,.65); --edge: rgba(84,84,88,.65);
  --ink: #FFFFFF; --ink-2: rgba(235,235,245,.82); --ink-3: rgba(235,235,245,.6); --sub: #FFFFFF;
  --tungsten: #0A84FF; --tungsten-ink: #FFFFFF; --tungsten-dim: rgba(10,132,255,.22); --accent-text: #3D9BFF; --focus: #0A84FF;
  --cut: #FF453A; --cut-dim: rgba(255,69,58,.18); --cut-ink: #FFFFFF; --ok: #30D158;
  --scrim: rgba(0,0,0,.5); --shadow: 0 16px 40px -12px rgba(0,0,0,.7); --lift: none;
  --credit: var(--sans);
  --t-title: 1.625rem; --t-sheet: 1.375rem; --t-head: 1.25rem; --t-read: 1rem; --t-body: 1.0625rem; --t-ui: 0.9375rem; --t-meta: 0.8125rem; --t-cap: 0.75rem;
  /* Aliases for selectors inherited from Film. */
  --t-small: var(--t-meta); --t-sub: var(--t-meta); --t-list: var(--t-ui); --t-micro: var(--t-meta); --t-credit: var(--t-cap);
  --r: 12px; --control: 36px; --hit: 44px;
  /* phone-only */
  --sep: rgba(84,84,88,.65); --fill: rgba(118,118,128,.24); --bubble: #26252A;
  --glass: rgba(30,30,32,.72); --glass-edge: rgba(255,255,255,.12); --glass-shade: 0 8px 24px -10px rgba(0,0,0,.6);
  --k-green: #30D158; --k-orange: #FF9F0A; --k-red: #FF453A; --k-teal: #40C8E0; --k-indigo: #5E5CE6; --k-pink: #FF375F; --k-yellow: #FFD60A; --k-gray: #8E8E93; --pink-text: #FF6482;
}
:root[data-theme^="day"], :root[data-theme="day"], :root[data-theme="day-velvet"], :root[data-theme="day-bulb"], :root[data-theme="day-print"] {
  color-scheme: light;
  --house: #F2F2F7; --screen: #FFFFFF; --screen-2: #E9E9EE; --screen-3: #FFFFFF;
  --rule: rgba(60,60,67,.18); --rule-2: rgba(60,60,67,.29); --edge: rgba(60,60,67,.29);
  --ink: #000000; --ink-2: rgba(60,60,67,.85); --ink-3: #6C6C70; --sub: #000000;
  --tungsten: #007AFF; --tungsten-ink: #FFFFFF; --tungsten-dim: rgba(0,122,255,.12); --accent-text: #0066D6; --focus: #007AFF;
  --cut: #FF3B30; --cut-dim: rgba(255,59,48,.1); --cut-ink: #FFFFFF; --ok: #248A3D;
  --scrim: rgba(0,0,0,.25); --shadow: 0 12px 34px -10px rgba(0,0,0,.18);
  --sep: rgba(60,60,67,.29); --fill: rgba(118,118,128,.12); --bubble: #E9E9EB;
  --glass: rgba(250,250,252,.74); --glass-edge: rgba(255,255,255,.8); --glass-shade: 0 8px 24px -10px rgba(0,0,0,.22);
  --k-green: #34C759; --k-orange: #FF9500; --k-red: #FF3B30; --k-teal: #30B0C7; --k-indigo: #5856D6; --k-pink: #FF2D55; --k-yellow: #FFCC00; --k-gray: #8E8E93; --pink-text: #C7194A;
}

/* base: no film lettering anywhere */
.film { font: 400 var(--t-body)/1.45 var(--sans); letter-spacing: -.005em; }
.credit, .name, .name.is-cjk, .titles .nm, .titles .nm.is-cjk, .chapter .no, .act__no, .actmenu .menu__item .no {
  font-family: var(--sans); font-stretch: normal; text-transform: none; letter-spacing: 0; padding-left: 0;
}
.name { font-weight: 600; }
:where(.film) ::selection { background: var(--tungsten-dim); }
.tc { font-size: var(--t-meta); font-weight: 400; letter-spacing: 0; }
.tag, .mark, .inject .tag, .tab .count { font-size: var(--t-cap); font-weight: 600; }
.credit, .starring, .and { font-weight: 600; }
.i { stroke-width: 1.8; }

/* page header: the iOS large title */
.pagetitle { margin: 6px 0 12px; font-size: 34px; font-weight: 700; line-height: 1.2; letter-spacing: -.02em; }
:is(h2, h3).sec { margin: 24px 4px 7px; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); letter-spacing: 0; }
:is(h2, h3).sec .n { font-size: var(--t-meta); }
.sub { color: var(--ink-3); font-size: var(--t-meta); }
/* One detail title role; page and lock-screen display titles keep their own scale. */
.reader__title, .person__name, .pair-name, .titlecard h1, .film .settingspage .setting-section-copy h2.sr-only {
  font-size: var(--t-sheet); font-weight: 700; line-height: 1.25; letter-spacing: -.01em;
}

/* controls */
.btn { height: var(--control); padding: 0 16px; border-radius: 12px; font-size: var(--t-ui); font-weight: 600; }
/* Labelled actions are text-only; back, pagers and disclosure triggers keep navigation icons. */
.btn:not(.back):not(.pager .btn):not(.srclog__bar .btn):not(summary) > .i { display: none; }
.btn--primary { background: var(--tungsten); color: #fff; }
.btn--primary:hover, .btn--primary.is-hover { background: color-mix(in srgb, var(--tungsten) 88%, #000); }
.btn--secondary { background: var(--fill); color: var(--tungsten); }
.btn--secondary:hover, .btn--secondary.is-hover { background: color-mix(in srgb, var(--fill) 70%, var(--ink) 8%); }
.btn--quiet { color: var(--accent-text); padding: 0 8px; }
.btn--quiet:hover, .btn--quiet.is-hover { color: var(--accent-text); background: var(--fill); }
.btn--danger { color: var(--cut); background: var(--cut-dim); }
@media (max-width: 760px) {
  .btn { height: 32px; }
  .btn:not(.btn--quiet) { padding-inline: 12px; }
}
.iconbtn { border-radius: 50%; color: var(--tungsten); }
.iconbtn:hover, .iconbtn.is-hover, .iconbtn[aria-expanded="true"] { color: var(--tungsten); background: var(--fill); }
.linkbtn { color: var(--accent-text); text-decoration: none; }
.linkbtn:hover, .linkbtn.is-hover { color: var(--accent-text); text-decoration: underline; }

/* segmented controls: 번역/원문, sort, radio groups, and section tabs */
.seg { padding: 2px; gap: 0; border-radius: 9px; background: var(--fill); }
.seg button, .seg label span { min-height: 30px; height: auto; padding: 0 12px; border-radius: 7px; font-size: var(--t-ui); font-weight: 500; color: var(--ink); }
.seg button[aria-pressed="true"], .seg label input:checked + span { background: var(--screen); color: var(--ink); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.14), 0 0 0 .5px rgba(0,0,0,.04); }
:root[data-theme="night"] .seg button[aria-pressed="true"], :root[data-theme="night"] .seg label input:checked + span { background: #636366; }
.tabs { display: flex; gap: 0; padding: 2px; border-bottom: 0; border-radius: 9px; background: var(--fill); }
.tab { min-height: 30px; height: auto; padding: 0 10px; border-radius: 7px; font-size: var(--t-ui); font-weight: 500; color: var(--ink); }
.tab { flex-grow: 1; }
.tab::after { display: none; }
.tab[aria-selected="true"] { background: var(--screen); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.14); }
:root[data-theme="night"] .tab[aria-selected="true"] { background: #636366; }
.tab .count { color: var(--cut); }

/* filters: rounded pills */
.filter { height: 30px; padding: 0 12px; border-radius: 15px; background: var(--fill); color: var(--ink); font-size: var(--t-ui); font-weight: 500; }
.filter:hover, .filter.is-hover { background: color-mix(in srgb, var(--fill) 60%, var(--ink) 10%); color: var(--ink); }
.filter[aria-pressed="true"] { background: var(--tungsten); color: #fff; }
.filter[aria-pressed="true"] .n { color: rgba(255,255,255,.8); }
.filter .n { color: var(--ink-3); }

/* fields */
.input, .select, .textarea { min-height: 36px; padding: 0 12px; border: 0; border-radius: 10px; background: var(--fill); color: var(--ink); font: 400 var(--t-body)/1.4 var(--sans); }
.textarea { padding: 10px 12px; }
.input:hover, .select:hover, .textarea:hover { border-color: transparent; }
.input:focus, .select:focus, .textarea:focus, .input.is-focus { box-shadow: 0 0 0 2px var(--tungsten-dim); }
.input::placeholder, .textarea::placeholder { color: var(--ink-3); }
.search .i { color: var(--ink-3); width: 17px; height: 17px; left: 9px; }
.search .input { padding-left: 32px; }
.field > label, .field > .label { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.check input { border-radius: 50%; width: 22px; height: 22px; border: 1.5px solid var(--ink-3); background: transparent; }
.check input:checked { background: var(--tungsten); border-color: var(--tungsten); }
.check input:checked::after { border-color: #fff; }
.switch input { width: 51px; height: 31px; background: var(--fill); }
.switch input::after { left: 2px; top: 2px; width: 27px; height: 27px; background: #fff; box-shadow: 0 3px 8px rgba(0,0,0,.15); }
.switch input:checked { background: var(--k-green); }
.switch input:checked::after { transform: translateX(20px); background: #fff; }

/* menus, sheets, dialogs */
.menu__list { padding: 6px; border-radius: 14px; background: var(--screen); box-shadow: var(--shadow), 0 0 0 .5px var(--rule); }
.menu__item { height: 44px; padding: 0 12px; border-radius: 9px; font-size: var(--t-ui); }
.menu__item .i { color: var(--ink); }
.menu__item:hover, .menu__item.is-hover { background: var(--fill); }
.menu__sep { height: 6px; margin: 4px -6px; background: var(--fill); }
.dialog { border-radius: 14px; background: var(--screen); box-shadow: var(--shadow); }
.notice { border-radius: 12px; background: var(--screen); padding: 12px 16px; font-size: var(--t-ui); }
.notice .i { color: var(--tungsten); }
.notice--cut .i { color: var(--cut); }
.empty { color: var(--ink-3); font-size: var(--t-ui); }
.empty b { color: var(--ink); font-size: var(--t-body); }
.meter i::after { background: var(--tungsten); }
.packet { border-radius: 12px; background: var(--screen); }

/* grouped lists: every list item is a cell; a run of cells reads as one rounded group */
:is(.row, .pairrow, .entry, .scene, .acquaintance) {
  margin: 0; width: 100%; padding: 11px 16px; border-radius: 0; box-shadow: none;
  background-color: var(--screen); background-repeat: no-repeat;
}
:is(.row, .pairrow, .entry, .scene, .acquaintance) + :is(.row, .pairrow, .entry, .scene, .acquaintance) {
  background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; box-shadow: none; border-top: 0;
}
:is(.row, .pairrow, .entry, .scene, .acquaintance):not(:is(.row, .pairrow, .entry, .scene, .acquaintance) + *) { border-top-left-radius: 12px; border-top-right-radius: 12px; }
:is(.row, .pairrow, .entry, .scene, .acquaintance):not(:has(+ :is(.row, .pairrow, .entry, .scene, .acquaintance))) { border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; }
.list > li { background: var(--screen); }
:is(.row, .pairrow):hover, :is(.row, .pairrow).is-hover { --row-fill: color-mix(in srgb, var(--screen) 92%, var(--ink)); background-color: var(--row-fill); }
.row__slug { font-size: var(--t-meta); color: var(--ink-3); }
.row__slug b { color: var(--ink-3); font-weight: 400; }
.row__title { font-size: var(--t-ui); font-weight: 600; line-height: 1.35; }
.row__sub { font-size: var(--t-meta); color: var(--ink-3); line-height: 1.4; }
.row__end { color: var(--ink-3); }
/* selection is shown only where list and detail sit side by side */
@media (min-width: 900px) {
  :is(.row, .pairrow)[aria-current="true"] { --row-fill: var(--tungsten); background-color: var(--row-fill); }
  :is(.row, .pairrow)[aria-current="true"] :is(.row__title, .row__slug, .row__slug b, .row__sub, .row__end, .names, .meta, .meta__who, .meta__text, .row__count, .x, .name, .mecard__k, .tc, .row__signals) { color: #fff; }
}
@media (max-width: 899px) { :is(.row, .pairrow)[aria-current="true"] { --row-fill: var(--screen); background-color: var(--row-fill); } }
.day { margin: 22px 4px 7px; font-size: var(--t-meta); color: var(--ink-3); }
.day b { color: var(--ink-3); font-weight: 400; }
.tl-rows > .day:first-child { margin-top: 8px; }
.entries > .entry + .entry, .acquaintance + .acquaintance, .scenelog > .scene + .scene, .scenelog > .gap + .scene, .scenelog > .scene + .gap { border-top: 0; }
.entry { grid-template-columns: 48px minmax(0, 1fr); font-size: var(--t-ui); font-weight: 400; line-height: 1.5; color: var(--ink); }
.entry__k { font-size: var(--t-meta); color: var(--ink-3); }
.entry__src { font-size: var(--t-meta); }
.subhead { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }

/* disclosure: a cell with a chevron */
.fold { margin-top: 12px; }
.fold > summary { min-height: 44px; padding: 0 16px; border-bottom: 0; border-radius: 12px; background: var(--screen); font-size: var(--t-body); font-weight: 400; color: var(--ink); }
.fold > summary:hover { color: var(--ink); }
.fold > summary .n { font-size: var(--t-body); color: var(--ink-3); margin-left: auto; }
.fold > summary .chev { margin-left: 0; color: var(--ink-3); }
.fold > summary > span:first-child:not(.chev) { flex: 1; }
.fold.job > summary > .job__state:first-child, .fold.job-group > summary > .job__state:first-child { flex: none; width: 18px; }
.fold.job > summary, .fold.job-group > summary { gap: 8px; padding: 10px 16px; }
.jobs > :is(.job, .job-group) { margin: 0 0 12px; border-radius: 12px; background: var(--screen); overflow: hidden; }
.fold.job > .fold__body, .fold.job-group > .fold__body { padding: 0 16px 12px; background: var(--screen); }
.job__status { padding: 1px 6px; border-radius: 6px; background: var(--fill); color: var(--ink-2); font-size: var(--t-cap); }
.job__status.is-superseded { background: var(--tungsten-dim); color: var(--accent-text); }
.job__status.is-cancelled { background: var(--cut-dim); color: var(--cut); }
.job-group > .fold__body > :is(.job, .job-group) { margin-top: 0; }
.job-group > .fold__body > :is(.job, .job-group) > summary { padding-inline: 0; border-radius: 0; background-image: linear-gradient(var(--sep), var(--sep)); background-size: 100% .5px; background-position: center top; background-repeat: no-repeat; }
.job-group .job__time { white-space: normal; text-align: right; }
/* same-kind burst: children read as sub-items under one guide line */
.fold.job-group.job-burst > .fold__body { padding: 0 16px 10px 34px; background: linear-gradient(var(--sep), var(--sep)) 22px 0 / 1px calc(100% - 14px) no-repeat, var(--screen); }
.fold.job-group.job-burst > .fold__body > .job--child > summary { min-height: 40px; padding-block: 8px; }
.job--child .job__name { font-size: var(--t-meta); font-weight: 400; color: var(--ink-2); }
.job--child .job__time { font-size: var(--t-micro); }
/* withheld recognition: a quiet note inside a finished job, never an error tone */
.withheld { margin: 4px 0 14px; padding: 12px 14px; border-radius: var(--r); background: var(--screen-2); }
.withheld__head { margin: 0 0 8px; font-size: var(--t-meta); font-weight: 600; color: var(--ink-2); }
.withheld__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.withheld__list li { display: grid; grid-template-columns: minmax(2.5em, max-content) 1fr; gap: 12px; align-items: baseline; font-size: var(--t-ui); color: var(--ink); line-height: 1.45; }
.withheld__list b { font-weight: 600; color: var(--ink-2); overflow-wrap: anywhere; }
.withheld__list span { min-width: 0; overflow-wrap: anywhere; }
.withheld__why { margin: 10px 0 6px; font-size: var(--t-meta); color: var(--ink-3); line-height: 1.5; }
.withheld .btn { margin-left: -8px; }
/* a summary of bare text: the chevron is its only span and keeps to its icon size at the right */
.fold > summary > .chev:first-child { flex: none; margin-left: auto; }
.fold[open] > summary { border-radius: 12px 12px 0 0; }
.fold > .fold__body { padding: 0; }
.fold:not(.fold--section)[open] > .fold__body > :first-child:is(.row, .pairrow, .entry, .scene, .acquaintance) { border-top-left-radius: 0; border-top-right-radius: 0; background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; }
.fold:not(.fold--section)[open] > .fold__body > :is(.entries, .list, .tl-rows) > :first-child { border-top-left-radius: 0; border-top-right-radius: 0; }
.foldbox__acts { right: 44px; top: 4px; }

/* frames and cards: flat, no lift */
.frame { border-radius: 12px; background: var(--screen); box-shadow: none; padding: 14px 16px 16px; }
.frame:hover, .frame.is-hover { box-shadow: none; background: color-mix(in srgb, var(--screen) 94%, var(--ink)); }
.frame.is-mark { box-shadow: none; }
.frame__slug { font-size: var(--t-meta); }
.frame__slug b { color: var(--ink-3); font-weight: 400; }
.frame__slug .tag { color: var(--k-red); font-weight: 600; }
.frame__title { font-size: var(--t-ui); font-weight: 600; line-height: 1.4; color: var(--ink); }
.subtitle { color: var(--ink); font-size: var(--t-ui); }
.subtitle small { font-size: var(--t-meta); }

/* shell: glass chrome only */
.app { background: var(--house); }
.topbar { height: 48px; background: var(--glass); border-bottom: .5px solid var(--sep); }
.topbar .where { font-size: var(--t-ui); color: var(--ink-3); }
.topbar .where b { font-size: var(--t-body); font-weight: 600; }
.topbar .where button { color: var(--accent-text); }
.topbar .where .sep { color: var(--ink-3); }
.back { height: 36px; padding: 0 14px 0 8px; border-radius: 18px; color: var(--tungsten); font-size: var(--t-ui); background: var(--glass); box-shadow: inset 0 0 0 .5px var(--glass-edge), var(--glass-shade); }
.back:hover { color: var(--tungsten); }
.back .i { width: 20px; height: 20px; stroke-width: 2.2; }
@media (max-width: 899px) {
  .main { padding: 14px 16px 112px; }
  .nav { position: fixed; left: 16px; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); z-index: 20; height: 62px; padding: 0 6px; border: 0; border-radius: 31px; align-items: center; background: var(--glass); box-shadow: inset 0 0 0 .5px var(--glass-edge), var(--glass-shade); }
  .nav > button { height: 52px; border-radius: 26px; gap: 2px; font-size: var(--t-cap); font-weight: 600; color: var(--ink); }
  .nav > button .i { width: 24px; height: 24px; stroke-width: 1.7; }
  .nav > button[aria-current="page"] { color: var(--tungsten); background: var(--fill); font-weight: 600; }
  .nav > button[aria-current="page"]::before { display: none; }
  .nav .badge { top: 5px; background: var(--k-red); color: #fff; font-size: var(--t-cap); }
  .main .form__bar { bottom: calc(90px + env(safe-area-inset-bottom)); background: var(--house); }
}
@media (min-width: 900px) {
  .app { grid-template-columns: 252px minmax(0, 1fr); }
  .nav { top: 14px; height: calc(100vh - 28px); height: calc(100dvh - 28px); margin: 14px 0 14px 14px; padding: 18px 12px; border-right: 0; border-radius: 26px; background: var(--glass); box-shadow: inset 0 0 0 .5px var(--glass-edge), var(--glass-shade); }
  .brand { padding: 4px 10px 18px; }
  .brand .credit { font-size: var(--t-body); font-weight: 700; letter-spacing: 0; }
  .brand small { font-size: var(--t-meta); }
  .nav > button { height: 40px; padding: 0 12px; border-radius: 12px; font-size: var(--t-ui); color: var(--ink); }
  .nav > button .i { width: 20px; height: 20px; color: var(--tungsten); }
  .nav > button:hover { background: var(--fill); color: var(--ink); }
  .nav > button[aria-current="page"] { background: var(--tungsten-dim); color: var(--accent-text); font-weight: 600; }
  .nav > button[aria-current="page"]::before { display: none; }
  .nav .badge { min-width: 20px; height: 20px; border-radius: 10px; background: var(--k-red); color: #fff; font-size: var(--t-cap); line-height: 20px; }
  /* the toolbar floats like the rail: same inset, same glass, so the two read as one set of panes */
  .topbar { top: 14px; margin: 14px 14px -14px; padding-inline: 20px 12px; border-bottom: 0; border-radius: 24px; background: var(--glass); box-shadow: inset 0 0 0 .5px var(--glass-edge), var(--glass-shade); }
  .split { grid-template-columns: clamp(330px, 32%, 400px) minmax(0, 1fr); gap: 0 28px; }
  .split > .readercol { padding-left: 28px; border-left: .5px solid var(--sep); }
}

/* glass needs support; without it, and for reduced transparency, chrome turns opaque */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .topbar, .back, .nav { background: var(--screen); }
}
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .topbar, .back, .nav { -webkit-backdrop-filter: blur(20px) saturate(1.8); backdrop-filter: blur(20px) saturate(1.8); }
}
@media (prefers-reduced-transparency: reduce) {
  .topbar, .back, .nav { background: var(--screen); -webkit-backdrop-filter: none; backdrop-filter: none; }
}

/* avatars: monogram circles, hue from the name */
.av { display: inline-grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%; color: #fff; font: 600 var(--t-ui)/1 var(--sans); background: linear-gradient(hsl(var(--av-h, 220) 62% 66%), hsl(var(--av-h, 220) 52% 50%)); }
.av--sm { width: 28px; height: 28px; font-size: var(--t-cap); }
.av--xl { width: 88px; height: 88px; font-size: 34px; }
/* ---- 인물 · 관계 ---- */
/* group headers read like a contacts index: small grey label, the group's cells below */
.people-group { margin-top: 6px; }
.people-group > summary { min-height: 32px; padding: 0 4px; background: none; border-radius: 0; font-size: var(--t-meta); color: var(--ink-3); }
.people-group > summary .n { font-size: var(--t-meta); margin-left: 4px; }
.people-group > summary > span:first-child { flex: none; }
.people-group > summary .chev { margin-left: auto; }
.people-group[open] > summary { border-radius: 0; }
.fold.people-group[open] > .fold__body > :first-child:is(.row) { border-top-left-radius: 12px; border-top-right-radius: 12px; background-image: none; }
.contact-row { display: flex; align-items: center; gap: 12px; }
.contact-row__avs { display: flex; flex: none; align-items: center; }
.contact-row__avs .av { width: 34px; height: 34px; font-size: var(--t-ui); }
.contact-row__avs .av + .av { margin-left: -12px; box-shadow: 0 0 0 2px var(--row-fill, var(--screen)); }
.contact-row__body { flex: 1; min-width: 0; }
.contact-row .row__title { display: block; font-size: var(--t-ui); font-weight: 600; }
.contact-row .row__title .name, .contact-row .row__title .name.is-cjk { font-size: var(--t-ui); font-weight: 600; }
.contact-row .row__sub { display: block; margin-top: 2px; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.contact-row .row__end { flex: none; color: var(--ink-3); }
.contact-group > h3.sec { margin: 18px 4px 7px; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.mecard { margin: 0 0 14px; }
.relgroup + .relgroup { margin-top: 0; }
.pairrow .names { align-items: center; gap: 2px 8px; font-size: var(--t-ui); }
.pairrow .names .name { font-weight: 600; }
.names .av { width: 28px; height: 28px; font-size: var(--t-cap); }
.names .av + .av { margin-left: -12px; box-shadow: 0 0 0 2px var(--row-fill, var(--screen)); }
.pairrow .x { color: var(--ink-3); }
.pairrow .meta { font-size: var(--t-meta); }
.pairrow .meta.is-label { color: var(--ink-3); font-weight: 400; }
.relgroup .pairrow .meta__who, .person .pairrow .meta__who { color: var(--ink-3); font-weight: 400; font-size: var(--t-meta); }
.relgroup .pairrow .meta__text, .person .pairrow .meta__text { color: var(--ink-2); font-size: var(--t-ui); font-weight: 400; line-height: 1.5; }
.pairrow .end { color: var(--ink-3); }

/* person card: the contact header */
.person__name { flex-direction: column; align-items: center; gap: 10px; margin: 4px 0 2px; text-align: center; }
.person__name .name, .person__name .name.is-cjk { font: inherit; letter-spacing: inherit; }
.person__name .tc { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.person .person__facts { margin: 0 0 8px; text-align: left; }
.person__facts .entry__who { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.person__facts .entry__body { font-size: var(--t-ui); color: var(--ink); }
.psec > :is(h2, h3).sec { margin: 24px 4px 7px; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.psec > :is(h2, h3).sec .n { font-size: inherit; color: inherit; font-weight: 400; }
.subsec { margin: 18px 4px 7px; padding: 0; border: 0; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.entry__title { font-size: var(--t-ui); font-weight: 600; }
.entry__body { font-size: var(--t-ui); font-weight: 400; line-height: 1.5; color: var(--ink-2); }
.entry__who { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.entry--promise > .entry__body { font-size: var(--t-ui); color: var(--ink); }
.entry__src { color: var(--ink-3); }
.entry__src .linkbtn { color: var(--accent-text); font-size: var(--t-meta); }
.entry__tag { font-size: var(--t-meta); color: var(--ink-3); font-weight: 400; }
.pairsheet .entry__v > b { display: block; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }

/* pair sheet: contact header for two */
.titles--plain { padding: 6px 0 2px; background: none; text-align: center; }
.titles--plain::before, .titles--plain::after { display: none; }
.pairsheet .titles--plain { margin: 0; }
.pair-avs { display: flex; justify-content: center; }
.pair-avs .av + .av { margin-left: -18px; box-shadow: 0 0 0 3px var(--house); }
.pair-name { margin: 12px 0 2px; overflow-wrap: anywhere; }
.pair-name .name, .pair-name .name.is-cjk { font: inherit; letter-spacing: inherit; }
.pair-tie { margin: 0; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.pairsheet .facts { display: flex; flex-wrap: wrap; justify-content: center; gap: 2px 14px; padding: 4px 0 6px; border: 0; }
.pairsheet .facts > div { display: flex; align-items: baseline; gap: 4px; }
.pairsheet .facts dd { font-size: var(--t-ui); font-weight: 600; letter-spacing: 0; }
.pairsheet .facts dt { font-size: var(--t-meta); color: var(--ink-3); }
.pairsheet .pairs { margin: 10px 0 4px; justify-content: center; }
.pair { height: 30px; border-radius: 15px; background: var(--fill); color: var(--ink); font-size: var(--t-ui); }
.pair[aria-pressed="true"] { background: var(--tungsten); color: #fff; }

/* Directional prose stays in now; both directions share one fixed-axis table. */
.povs { grid-template-columns: 1fr; gap: 0; }
.pov { padding: 0; }
.pov + .pov { border-top: 0; }
.pov__head { margin: 12px 4px 7px; }
.pov__head h3, .pov__head h3 .name, .pov__head h3 .name.is-cjk { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); letter-spacing: 0; }
.pov__to { font-size: var(--t-meta); }
.pov > .clamp { padding: 11px 16px 13px; background: var(--screen); border-radius: 12px; }
.pov > .clamp:has(+ .tensions) { border-radius: 12px 12px 0 0; }
.pov__text { font-size: var(--t-ui); font-weight: 400; color: var(--ink-2); line-height: 1.5; }
.pov .tensions { margin: 0; padding: 0 16px 12px 34px; background: var(--screen); border-radius: 0 0 12px 12px; font-size: var(--t-ui); line-height: 1.5; }
.emotion-table { border-collapse: separate; border-spacing: 0; border-radius: 12px; overflow: hidden; background: var(--screen); }
.emotion-table th, .emotion-table td { padding: 11px 12px; }
.emotion-table thead th { font-size: var(--t-meta); }
.emotion-table tbody tr { border: 0; }
.emotion-table tbody :is(th, td) { border-top: .5px solid var(--sep); }
.emotion-table tbody th { font-size: var(--t-ui); color: var(--ink); }
.emotion-note { font-size: var(--t-meta); }

/* anniversaries: a calendar list, D+ on the right */
.pairsheet .reel { display: block; margin: 0; padding: 0; overflow: hidden; border-radius: 12px; background: var(--screen); }
.anni { border-radius: 0; background: none; box-shadow: none; }
.anni + .anni { background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; background-repeat: no-repeat; }
.anni__open { grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; padding: 11px 48px 12px 16px; }
.anni__open:hover { background: color-mix(in srgb, var(--screen) 92%, var(--ink)); }
.anni__label { grid-column: 1; font-size: var(--t-ui); font-weight: 600; color: var(--ink); }
.anni__when { grid-column: 2; grid-row: 1; font-size: var(--t-meta); color: var(--ink-3); }
.anni__pin .i { color: var(--k-red); }
.anni__scene, .anni .subtitle { grid-column: 1 / -1; }
.anni .subtitle { font-size: var(--t-ui); color: var(--ink-2); }
.anni__acts { top: 6px; right: 6px; }

/* scene log rows */
.scene__slug { font-size: var(--t-meta); }
.scene__slug b { color: var(--ink-3); font-weight: 500; }
/* a scene reads like every other sheet row: small slug line, then plain text */
.scene__title { font-size: var(--t-ui); font-weight: 400; }
button.scene__title:hover { color: var(--accent-text); }
.mark.is-key { color: var(--k-pink); }
.gap > summary { color: var(--ink-3); }
.logbar { margin: 4px 0 8px; }
/* people fixes: one heading per point of view; a fold's own ··· sits clear of its count */

.foldbox > .fold > summary .n { margin-right: 34px; }
/* ---- 기억 · 타임라인과 장면 ---- */
.listcol > .sub { margin: 10px 4px 0; }
.tl-rows .row__slug { font-size: var(--t-meta); }
.tl-rows .row__sub { -webkit-line-clamp: 2; }
.row__signals { color: var(--ink-3); }
.capsule-children > summary { min-height: 36px; font-size: var(--t-ui); color: var(--accent-text); background: var(--screen); }
.reader .frame__slug { margin-top: 4px; font-size: var(--t-meta); color: var(--ink-3); }
.reader .frame__slug b { color: var(--ink-3); font-weight: 400; }
.reader__title { margin: 6px 0 10px; }
.participants { align-items: center; gap: 6px 4px; font-size: var(--t-ui); color: var(--ink-2); }
.reader > .participants { margin-bottom: 16px; }
.reader > .participants:has(+ .marks) { margin-bottom: 8px; }
.reader > .marks { margin: 0 0 16px; }
.participants .dot { display: none; }
.participants .av { width: 24px; height: 24px; font-size: var(--t-cap); }
.participants .name, .participants .name.is-cjk { margin-right: 8px; font-size: var(--t-ui); font-weight: 500; color: var(--ink-2); letter-spacing: 0; }
/* key lines are a chat thread: the persona's on the right in tint, everyone else on the left */
.lines { display: flex; flex-direction: column; gap: 6px; margin: 18px 0 0; padding: 12px 12px 14px; border-radius: 12px; background: var(--screen); }
.lines .subtitle { display: flex; flex-direction: column-reverse; align-self: flex-start; max-width: 80%; padding: 8px 13px 9px; border-radius: 19px; background: var(--bubble); color: var(--ink); text-align: left; font-size: var(--t-read); line-height: 1.35; }
.lines .subtitle small { margin: 0 0 2px; font-weight: 600; font-size: var(--t-cap); color: var(--ink-3); }
.lines .subtitle[data-side="out"] { align-self: flex-end; background: var(--tungsten); color: #fff; }
.lines .subtitle[data-side="out"] small { display: none; }
.lines .subtitle[data-side="out"] .orig-mark { color: rgba(255,255,255,.75); }
.rec { margin: 0 0 18px; padding: 0; border-radius: 0; background: none; font-size: var(--t-body); line-height: 1.6; color: var(--ink); }
/* Native disclosures share one inset card, without nested section folds. */
.memory-card { overflow: hidden; border-radius: 12px; background: var(--screen); }
.memory-block > h3.sec { margin-top: 20px; }
.memory-detail-row > summary { list-style: none; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 11px 16px; font-size: var(--t-ui); font-weight: 400; color: var(--ink); cursor: pointer; }
.memory-detail-row > summary::-webkit-details-marker { display: none; }
.memory-detail-row + .memory-detail-row > summary, .fold--more .memory-detail-row:first-child > summary { background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; background-repeat: no-repeat; }
.memory-detail-row__preview { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; line-height: 1.5; }
.memory-detail-row__preview b { font-weight: 600; }
.memory-detail-row__preview .n { margin-left: 4px; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.memory-detail-row .tag { display: inline-block; margin-right: 6px; padding: 1px 7px; border-radius: 6px; background: var(--fill); font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); vertical-align: 1px; }
.memory-detail-row .tag.is-core { background: color-mix(in srgb, var(--k-orange) 14%, transparent); color: var(--k-orange); }
:root[data-theme^="day"] .memory-detail-row .tag.is-core { color: #B25E00; }
.memory-detail-row > summary .chev { flex: none; color: var(--ink-3); transition: transform var(--fast) var(--ease); }
.memory-detail-row[open] > summary .chev { transform: rotate(90deg); }
.memory-detail-row__body { padding: 0 16px 12px; font-size: var(--t-ui); font-weight: 400; line-height: 1.5; color: var(--ink); overflow-wrap: anywhere; }
.memory-detail-row__body p { margin: 0 0 8px; white-space: pre-line; }
.memory-detail-row__body .sub { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
/* A scene-section row has one summary paragraph; the other rows keep their separate meta line. */
.memory-detail-row__body > p.sub:only-child { font-size: var(--t-ui); line-height: 1.5; color: var(--ink-2); }
.memory-detail-row__body .quote { margin-top: 8px; padding-left: 10px; border-left: 2px solid var(--sep); font-size: var(--t-ui); line-height: 1.5; }
.reader .kv dd { font-size: var(--t-ui); font-weight: 400; line-height: 1.5; }
.pager { border-top: 0; margin-top: 18px; padding-top: 0; }
.reader .notice { margin-top: 12px; }
/* ---- 현재: reminders ---- */
.who { margin-top: 0; }
.who-h { margin: 24px 4px 7px; padding: 0; border: 0; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.who-h .n { font-size: var(--t-meta); }
.who-h .name, .who-h .name.is-cjk { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); letter-spacing: 0; }
.who--due .who-h, .who--due .who-h .n { color: var(--cut); font-weight: 600; }
.st-row { padding: 11px 16px; background-color: var(--screen); background-repeat: no-repeat; }
.st-row + .st-row { border-top: 0; background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; }
.st-row:not(.st-row + .st-row) { border-top-left-radius: 12px; border-top-right-radius: 12px; }
.st-row:not(:has(+ .st-row)) { border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; }
.st-row__kind { font-size: var(--t-meta); color: var(--ink-3); }
.st-row.is-due .st-row__kind, .st-row__meta .is-due { color: var(--cut); }
.st-row__who { font-size: var(--t-meta); color: var(--ink-3); font-weight: 400; }
.st-row__title { font-size: var(--t-ui); font-weight: 600; }
.st-row__what { font-size: var(--t-ui); font-weight: 400; line-height: 1.5; }
.st-row__text { font-size: var(--t-ui); font-weight: 400; line-height: 1.5; color: var(--ink); }
.st-row__meta { margin-top: 3px; font-size: var(--t-meta); }
.st-row__meta .linkbtn { font-size: var(--t-meta); }
.who--due .st-row__acts .btn { height: 30px; padding: 0 12px; border-radius: 15px; background: var(--fill); color: var(--tungsten); font-size: var(--t-meta); }
.who .fold { margin-top: 8px; }

/* long text: three lines, then 더 보기 unfolds it in place */
.clamp__more { display: block; margin-top: 4px; font-size: var(--t-ui); color: var(--accent-text); }
.clamp[open] .clamp__more { display: none; }
.clamp[data-fits] .clamp__more { display: none; }
.clamp[data-fits] > summary { cursor: default; pointer-events: none; }
.clamp > summary:hover .clamp__text { color: inherit; }

/* ---- 기억 정리: a screen pushed over the timeline. Its own large title; the ranges are one inset list with iOS check circles;
   the selection floats in a glass bar that offers only the actions the current choice allows ---- */
.main:has(.organization) > .subnav { display: none; }
.org-intro { display: grid; justify-items: start; gap: 2px; margin: 0 0 4px; }
.org-intro .back { display: inline-flex; align-items: center; }
.org-intro .pagetitle { margin: 10px 0 0; }
.org-intro .sub { margin: 0; }
.organization .org-h { margin: 24px 4px 7px; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.organization .org-work .org-h { margin-top: 18px; }
.organization .org-h .n { font-weight: 600; color: var(--k-red); }
.organization .org-work .row { border-radius: 12px; }
.organization .tl-rows { flex: 0 1 auto; margin-top: 0; border-radius: 12px; background: var(--screen); }
.org-range { grid-template-columns: 48px minmax(0, 1fr); background: transparent; }
.org-range.is-hl { box-shadow: none; background-color: var(--tungsten-dim); }
.org-range + .org-range { box-shadow: none; background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 48px) .5px; background-position: right top; background-repeat: no-repeat; }
.organization .org-range .row { padding-left: 0; border-radius: 0; background: transparent; }
.org-check { align-self: stretch; padding: 0; place-items: center; }
.org-check input { -webkit-appearance: none; appearance: none; width: 22px; height: 22px; margin: 0; border: 1.5px solid var(--rule-2); border-radius: 50%; background: transparent; cursor: pointer; transition: background-color var(--fast) var(--ease), border-color var(--fast) var(--ease); }
.org-check input:checked { border-color: var(--tungsten); background: var(--tungsten) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.5l4 4 8-9' fill='none' stroke='white' stroke-width='2.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 15px no-repeat; }
.org-check input:disabled { opacity: .35; cursor: default; }
.org-check input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
/* the selection bar: a summary, then the primary action across the bar and the single-range actions side by side */
.organization .org-sel { gap: 10px; margin-top: 12px; padding: 12px 14px 14px; border: 0; border-radius: 20px; background: var(--screen); }
.organization .org-sel__sum { gap: 1px; font-size: var(--t-meta); color: var(--ink-3); }
.organization .org-sel__sum b { font-size: var(--t-ui); font-weight: 600; color: var(--ink); }
.organization .org-sel__acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.organization .org-sel__acts .btn { width: 100%; }
.organization .org-sel__acts .btn--primary { grid-column: 1 / -1; }
.organization .org-sel__acts .btn:disabled { display: none; }
.organization .org-sel__acts:not(:has(.btn:not(:disabled))) { display: none; }
@media (max-width: 899px) {
  .organization .org-sel { position: sticky; bottom: calc(90px + env(safe-area-inset-bottom)); z-index: 5; margin: 12px 0 0; padding: 12px 14px 14px; border-radius: 22px; background: var(--glass); -webkit-backdrop-filter: blur(24px) saturate(1.8); backdrop-filter: blur(24px) saturate(1.8); box-shadow: inset 0 0 0 .5px var(--glass-edge), var(--glass-shade); }
}
@media (min-width: 900px) {
  .org-range:has(> .row[aria-current="true"]) { background-color: var(--tungsten); }
  .org-range:has(> .row[aria-current="true"]), .org-range:has(> .row[aria-current="true"]) + .org-range { background-image: none; }
  .org-range:has(> .row[aria-current="true"]) .org-check input { border-color: rgba(255,255,255,.8); }
  .org-range:has(> .row[aria-current="true"]) .org-check input:checked { border-color: #fff; background-color: #fff; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.5l4 4 8-9' fill='none' stroke='%23007AFF' stroke-width='2.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
  .organization .org-sel { position: sticky; bottom: 0; }
}
/* the range and candidate readers: inset cards for memories and sources, grey labels above them */
.organization .org-mems { gap: 8px; }
.organization .org-mem { padding: 14px 16px; border: 0; border-radius: 12px; background: var(--screen); }
.organization .org-mem h4 { margin: 0 0 4px; font-size: var(--t-ui); font-weight: 600; line-height: 1.4; }
.organization .org-mem p { font-size: var(--t-ui); line-height: 1.55; color: var(--ink-2); }
.organization .org-mem .lab, .organization .org-cmp > div > .lab { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.organization .org-cmp > div > .lab { margin: 0 4px 7px; }
.organization .org-cmp { gap: 20px; }
/* a compare column is a labelled group, not a card: its memories are the cards */
.organization .org-cmp > div { padding: 0; border-radius: 0; background: none; box-shadow: none; }
.organization .org-cmp .new > .lab { color: var(--accent-text); }
.organization .org-cmp > div > .sub, .organization .reader > p.sub { margin: 0 4px; font-size: var(--t-meta); line-height: 1.45; color: var(--ink-3); }
.organization .org-cmp .new > h4 { margin: 0 4px 8px; font-size: var(--t-body); font-weight: 700; }
.organization .reader > .sub { margin-bottom: 4px; }
.organization .reader > details.fold { margin-top: 8px; border-radius: 12px; overflow: hidden; background: var(--screen); }
.organization .reader > details.fold > summary { background: transparent; }
.organization .reader > details.fold > :not(summary) { padding: 0 16px 14px; }
.organization .reader .rec { margin: 0; font-size: var(--t-ui); line-height: 1.6; color: var(--ink-2); white-space: pre-line; }
.organization .reader .form__bar { margin-top: 20px; padding-top: 0; border-top: 0; }
/* ---- 종료 · 삭제: the record as one inset card under the large title, then what will happen, then the verbs ---- */
.world-confirm .reader__title { margin-bottom: 14px; }
.world-confirm__card { padding: 14px 16px; border-radius: 12px; background: var(--screen); }
.world-confirm__who { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font-size: var(--t-meta); color: var(--ink-3); }
.world-confirm__person { margin: 0; font-size: 17px; font-weight: 600; color: var(--ink); }
.world-confirm__card .rec { margin: 0; font-size: var(--t-body); line-height: 1.5; color: var(--ink); }
.world-confirm .notice { margin-top: 12px; }
.world-confirm .form__bar { margin-top: 16px; padding-top: 0; border-top: 0; }
.delete-impact { margin: 12px 0 0; padding-top: 10px; border-top: .5px solid var(--sep); font-size: var(--t-ui); }
.delete-impact { grid-template-columns: minmax(0, 1fr) auto; row-gap: 6px; }
.delete-impact dd { text-align: right; color: var(--ink); font-weight: 600; }
.entry__body.is-empty { color: var(--ink-3); }
@media (max-width: 899px) {
  /* on a phone the verbs read like an action sheet: full width, the consequential one first */
  .world-confirm .form__bar { display: flex; flex-direction: column-reverse; align-items: stretch; gap: 8px; }
  .world-confirm .form__bar .btn { width: 100%; min-height: 44px; justify-content: center; border-radius: 14px; font-size: var(--t-body); }
}

/* ---- 랜드마크 chips and the 기본 관계 form: filled pills like iOS tokens; the relation reads back on its own card ---- */
.kindpick > .hint { font-size: var(--t-meta); }
.kindpick__chip span { min-height: 34px; padding: 0 14px; border: 0; background: var(--fill); font-size: var(--t-ui); color: var(--ink); }
.kindpick__chip input:checked + span { background: var(--tungsten); color: #fff; font-weight: 600; }
.relation-swap { color: var(--tungsten); }

/* ---- 인물 profile and 아는 사이: names open under the title as an inset list; each acquaintance names which names it shows ---- */
.person .person__profile { margin-top: 14px; }
.detail-know { font-size: var(--t-ui); gap: 12px; }
.detail-know__k { font-size: var(--t-meta); }
.detail-know .linkbtn { font-size: var(--t-meta); }
.sec-head > .btn { min-height: 32px; }
.anniversary-new { padding: 14px 16px; border-radius: 12px; background: var(--screen); }

/* ---- 관리 ---- */
.subnav .tabs, .settings-tabs { margin-bottom: 4px; }
.check input { border-radius: 6px; }
/* ---- 홈 · 잠금화면 ---- */
.lock { --lock-ink: rgba(20,20,30,.9); --lock-ink-2: rgba(30,30,40,.76); --lock-glass: rgba(255,255,255,.3); --lock-edge: rgba(255,255,255,.7);
  position: relative; isolation: isolate; margin: -14px -16px 0; padding: 18px 16px 120px; min-height: calc(100vh - 48px); min-height: calc(100dvh - 48px); color: var(--lock-ink); }
:root[data-theme="night"] .lock { --lock-ink: rgba(255,255,255,.94); --lock-ink-2: rgba(255,255,255,.66); --lock-glass: rgba(40,40,46,.5); --lock-edge: rgba(255,255,255,.14); }
.lock__wall { position: absolute; inset: 0; z-index: -1;
  background: var(--lock-wallpaper); }
:root { --lock-wallpaper: radial-gradient(110% 60% at 15% 0%, #F6C9D6 0%, transparent 62%), radial-gradient(100% 60% at 100% 18%, #C9D8F6 0%, transparent 60%), radial-gradient(120% 70% at 50% 100%, #E9DDF3 0%, transparent 65%), #EEEAF2; }
:root[data-theme="night"] { --lock-wallpaper: radial-gradient(110% 60% at 15% 0%, #5A2340 0%, transparent 62%), radial-gradient(100% 60% at 100% 18%, #1E3470 0%, transparent 60%), radial-gradient(120% 70% at 50% 100%, #3A2552 0%, transparent 65%), #0B0B10; }
.lock__time { text-align: center; padding-top: 8px; }
.lock__place { margin: 0; font-size: var(--t-ui); font-weight: 600; color: var(--lock-ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lock__date { margin: 2px 0 0; font-size: 88px; font-weight: 700; line-height: 1; letter-spacing: -.04em; font-variant-numeric: tabular-nums; color: var(--lock-ink); }
.lock__day { margin: 6px 0 0; font-size: var(--t-meta); font-weight: 400; color: var(--lock-ink-2); }
.lock__widgets { display: flex; gap: 8px; margin: 18px 6px 0; }
.lw { flex: 1 1 0; min-width: 0; display: grid; justify-items: center; gap: 3px; padding: 9px 4px 10px; border-radius: 16px; color: var(--lock-ink); text-align: center; }
.lw b { font-size: var(--t-head); font-weight: 700; line-height: 1.1; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.lw span { font-size: var(--t-meta); color: var(--lock-ink-2); }
.lock__notes { display: grid; gap: 8px; margin-top: clamp(24px, 7vh, 72px); }
.noti { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 1px 10px; width: 100%; padding: 12px 14px 13px; border-radius: 22px; color: var(--lock-ink); text-align: left; }
.noti__ic { grid-row: span 3; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 9px; color: #fff; background: var(--k-gray); }
.noti__ic .i { width: 21px; height: 21px; stroke-width: 2; }
.noti__ic--green { background: var(--k-green); } .noti__ic--orange { background: var(--k-orange); } .noti__ic--red { background: var(--k-red); } .noti__ic--gray { background: var(--k-gray); }
.noti__hd { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.noti__hd b { min-width: 0; font-size: var(--t-ui); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.noti__hd span { flex: none; font-size: var(--t-meta); color: var(--lock-ink-2); }
.noti__bd { font-size: var(--t-ui); line-height: 1.35; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.noti__bd:empty { display: none; }
.noti__ft { margin-top: 2px; font-size: var(--t-meta); color: var(--lock-ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.noti__ft .orig-mark, .noti__bd .orig-mark { color: var(--lock-ink-2); }
.noti__acts { grid-column: 2; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.noti__acts .btn { height: auto; min-height: 36px; padding: 0 14px; border-radius: 18px; font-size: var(--t-meta); }
.noti__acts .btn--quiet { background: var(--tungsten-dim); color: var(--accent-text); }
.lock__notes > .notice, .lock__notes > .msg { border-radius: 18px; }
/* Notification body never outranks its title: both sit at the UI size, the title carries the weight. */
.msg__body p { font-size: var(--t-ui); line-height: 1.5; }
/* App notices on the lock screen read as notifications: the same square app icon and column as .noti. */
.lock__notes > .msg { grid-template-columns: 38px minmax(0, 1fr); gap: 1px 10px; margin: 0; padding: 12px 14px 13px; border-radius: 22px; color: var(--lock-ink); }
.lock__notes > .msg > .msg__icon { grid-row: span 2; align-self: start; display: grid; place-items: center; width: 38px; height: 38px; padding: 0; border-radius: 9px; color: #fff; background: var(--k-gray); }
.lock__notes > .msg--warning > .msg__icon, .lock__notes > .msg--danger > .msg__icon { background: var(--k-red); color: #fff; }
.lock__notes > .msg--success > .msg__icon { background: var(--k-green); color: #fff; }
.lock__notes > .msg > .msg__icon .i { width: 21px; height: 21px; stroke-width: 2; }
.lock__notes > .msg .msg__body p { margin-top: 1px; color: var(--lock-ink); }
.lock__notes > .msg .msg__acts { margin-top: 10px; }
.home-backfill__details.fold > summary { min-height: 32px; padding: 0; border-radius: 0; background: none; color: var(--lock-ink-2); font-size: var(--t-meta); }
.home-backfill__details.fold[open] > summary { border-radius: 0; }
.home-backfill__calls { border-radius: 12px; background: color-mix(in srgb, var(--lock-ink) 6%, transparent); color: var(--lock-ink-2); font-size: var(--t-meta); }
.lock__notes > .msg .msg__body .home-backfill__calls p { margin: 0; color: inherit; font-size: inherit; line-height: inherit; }
.lock__notes > .msg .msg__body p.home-backfill__hint { color: var(--lock-ink-2); font-size: var(--t-meta); }
.home-backfill__action { height: 32px; padding: 0 14px; border-radius: 16px; background: var(--tungsten-dim); color: var(--accent-text); font-size: var(--t-meta); }
.home-backfill__action:hover, .home-backfill__action.is-hover { background: color-mix(in srgb, var(--tungsten-dim) 100%, var(--tungsten) 10%); }
.lw, .noti, .wg, .lock__notes > .notice, .lock__notes > .msg { background: var(--lock-glass); box-shadow: inset 0 0 0 .5px var(--lock-edge); }
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .lw, .noti, .wg, .lock__notes > .notice, .lock__notes > .msg { -webkit-backdrop-filter: blur(24px) saturate(1.8); backdrop-filter: blur(24px) saturate(1.8); }
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .lw, .noti, .wg, .lock__notes > .notice, .lock__notes > .msg { background: var(--screen); }
}
@media (prefers-reduced-transparency: reduce) {
  .lw, .noti, .wg, .lock__notes > .notice, .lock__notes > .msg { background: var(--screen); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
button.lw:hover, button.noti:hover, button.wg__row:hover { box-shadow: inset 0 0 0 .5px var(--lock-edge), 0 6px 18px -10px rgba(0,0,0,.3); }
.main:has(> .page > .lock) { container: lock-home / inline-size; }
@container lock-home (min-width: 900px) {
  .lock { display: grid; grid-template-columns: minmax(0, 1fr) clamp(380px, 42%, 560px); gap: 0 32px; align-items: center; margin: -28px -40px -60px -26px; padding: 48px 56px; min-height: calc(100vh - 54px); min-height: calc(100dvh - 54px); border-radius: 0; }
  .lock__date { font-size: 112px; }
  .lock__widgets { max-width: 420px; margin: 26px auto 0; }
  .lock__notes { margin-top: 0; }
}
/* a story time that is not a plain date (free text, ranges) stays a headline, not a clock */
.lock__date--free { margin-top: 8px; font-size: 30px; line-height: 1.2; letter-spacing: -.02em; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
@container lock-home (min-width: 900px) { .lock__date--free { font-size: 40px; } }
.chg-n { color: var(--accent-text); }
.rec-who { margin: 6px 4px 2px; font-size: var(--t-meta); }
.rec .reader__title { margin: 0 4px; }
.rec-now, .chg { border-radius: 12px; }
.rec-now__end { font-size: var(--t-meta); }
.rec-now__meta > div { border-top: 0; background: linear-gradient(var(--sep), var(--sep)) right top / calc(100% - 16px) .5px no-repeat; }
.rec-truth { font-size: var(--t-meta); }
.chg__when b, .chg__scene { font-size: var(--t-meta); }
.chg__scene { color: var(--accent-text); }
.chg__why { font-size: var(--t-meta); }
.chg__tag { border-radius: 9px; background: var(--fill); }
/* ---- pair header: names open the person, address terms under the tie ---- */
.pair-name__who { font: inherit; color: inherit; border-radius: 8px; }
.pair-name__who:hover { color: var(--accent-text); }
.titles--plain .calls { margin-top: 6px; font-size: var(--t-ui); color: var(--ink-2); }
.titles--plain .calls small { display: inline; margin-left: 6px; font-size: var(--t-meta); color: var(--ink-3); }
/* ---- 홈 · 위젯 페이지 (잠금화면 아래로 스크롤) ---- */
.lock__more { display: grid; gap: 12px; margin-top: 20px; }
.wg { display: block; width: 100%; padding: 12px 16px; border-radius: 22px; color: var(--lock-ink); text-align: left; }
.wg__h { display: flex; align-items: center; gap: 6px; margin: 2px 0 4px; font-size: var(--t-meta); font-weight: 600; color: var(--ink-3); }
.wg__h .i { width: 15px; height: 15px; }
.wg__list { display: grid; }
.wg__row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; min-height: 46px; padding: 6px 0; color: inherit; text-align: left; border-radius: 0; }
.wg__row + .wg__row { border-top: .5px solid color-mix(in srgb, var(--lock-ink) 14%, transparent); }
button.wg__row:hover { box-shadow: none; color: var(--accent-text); }
.wg__main { min-width: 0; font-size: var(--t-ui); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wg__main .name, .wg__main .name.is-cjk { font-size: var(--t-ui); font-weight: 600; letter-spacing: 0; }
.wg__main small { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.wg__avs { display: flex; }
.wg__avs .av + .av { margin-left: -10px; box-shadow: 0 0 0 2px var(--lock-edge); }
.wg__no { min-width: 3.4em; font-size: var(--t-meta); font-weight: 400; color: var(--lock-ink-2); font-variant-numeric: tabular-nums; }
.wg__end { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-meta); color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.wg__end .i { width: 15px; height: 15px; }
.wg__empty { margin: 6px 0; font-size: var(--t-meta); color: var(--ink-3); }
.wg__processing > summary { display: block; min-height: 44px; padding-block: 8px; list-style: none; cursor: pointer; }
.wg__processing > summary::-webkit-details-marker { display: none; }
.wg__status { display: flex; align-items: center; gap: 8px; }
.wg__status > span:first-child { flex: 1; min-width: 0; }
.wg__status b { font-size: var(--t-ui); font-weight: 600; }
.wg__status small { font-size: var(--t-meta); color: var(--ink-3); }
.wg__processing[open] .chev { transform: rotate(90deg); }
.wg__meter { display: block; height: 4px; margin-top: 8px; border-radius: 2px; background: color-mix(in srgb, var(--ink-3) 20%, transparent); overflow: hidden; }
.wg__meter i { display: block; width: var(--v); height: 100%; background: var(--tungsten); }
.wg__processing > .fold__body { margin-top: 10px; padding: 12px 0 0; border-top: .5px solid var(--sep); }
/* 이번 턴에 전달한 기억: a widget on glass, then inset grouped lists in the full view */
.wg--sent .wg__h .wg__time { margin-left: auto; font-weight: 400; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.wg--sent .sent-mix { margin: 6px 0 4px; border: 0; border-radius: 14px; background: color-mix(in srgb, var(--lock-ink) 6%, transparent); }
.wg--sent .sent-mix > div + div { border-left: 0; box-shadow: inset .5px 0 0 color-mix(in srgb, var(--lock-ink) 16%, transparent); }
.wg--sent .sent-mix b { color: var(--lock-ink); }
.wg--sent .sent-mix small, .wg--sent .sent-mix .is-off b { font-size: var(--t-meta); color: var(--lock-ink-2); }
.wg--sent .sent-widget .wg__row { min-height: 46px; border-top: 0; }
.wg--sent .sent-widget .wg__row + .wg__row, .wg--sent .sent-budget + .wg__row { border-top: .5px solid color-mix(in srgb, var(--lock-ink) 14%, transparent); }
.wg--sent .sent-widget .wg__no { font-size: var(--t-meta); color: var(--lock-ink-2); }
.wg--sent .sent-widget .wg__end, .wg--sent .sent-widget .wg__haze { font-size: var(--t-meta); color: var(--ink-3); }
.wg--sent .sent-widget .wg__more { min-height: 44px; }
.wg--sent .sent-widget .wg__more .wg__end { color: var(--lock-ink-2); }
.wg--sent .sent-budget { font-size: var(--t-meta); color: var(--lock-ink-2); }
.wg--sent .sent-budget i { height: 4px; background: color-mix(in srgb, var(--lock-ink) 14%, transparent); }
.wg--sent .sent-budget i::after { border-radius: 2px; }
.sent { padding: 4px 0 48px; }
.sent__when, .sent__h small, .sent-row__m, .sent-q small, .sent-raw > summary small { font-size: var(--t-meta); }
.sent__note { margin: 0 4px 20px; color: var(--ink-3); font-size: var(--t-meta); }
.sent .sent-mix { border: 0; border-radius: 12px; background: var(--screen); }
.sent .sent-mix > div + div { border-left: 0; box-shadow: inset .5px 0 0 var(--sep); }
.sent .sent-mix small { font-size: var(--t-meta); }
.sent__h { margin: 26px 4px 8px; }
.sent-list, .sent-off { border: 0; border-radius: 12px; background: var(--screen); overflow: hidden; }
.sent-list > li { border: 0; }
.sent-off { padding: 14px 16px; }
.sent-row { padding: 11px 14px 11px 16px; }
.sent-row__k, .sent-row__end { font-size: var(--t-meta); }
.sent-row__end .i { width: 15px; height: 15px; }
.sent-list > li + li > .sent-row, .sent-list > li + li > .sent-more, .sent-list > li + li > .sent-q {
  background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; background-repeat: no-repeat; }
button.sent-row:hover { background-color: color-mix(in srgb, var(--ink) 4%, transparent); }
button.sent-row:hover .sent-row__t { color: inherit; }
.pill { padding: 1px 7px; background: var(--fill); }
.pill--haze { background: color-mix(in srgb, var(--tungsten) 12%, transparent); }
.sent-more { padding: 12px 16px; }
/* A call's raw response is a quiet disclosure under its question, aligned with the question text. */
.sent-call__kind { font-size: var(--t-meta); }
.sent-call__memory { color: var(--accent-text); font-weight: 600; text-decoration: none; }
.sent-call__raw { margin: 0 16px 10px 39px; }
.sent-call__raw.fold > summary { min-height: 36px; padding: 6px 0; gap: 6px; border-radius: 0; background: none; font-size: var(--t-meta); color: var(--ink-3); }
.sent-call__raw.fold > summary small { margin-left: 2px; font-size: inherit; }
.sent-call__raw.fold > summary .chev { margin-left: 0; }
.sent-call__raw.fold[open] > summary { border-radius: 0; }
.sent-call__raw .packet { margin: 2px 0 0; background: var(--fill); }
.sent-q small.is-fail { color: var(--cut); }
.sent-q { padding: 12px 16px 4px; }
.sent-q + .sent-row { padding-top: 6px; }
.sent-raw > summary { padding: 12px 16px; border: 0; border-radius: 12px; background: var(--screen); }
/* Opened, the summary, its translate tools and the packet read as one card. */
.sent-raw[open] > .sent-raw__tools, .sent-raw[open] > .sent-raw__error { margin: 0; padding: 0 16px 4px; background: var(--screen); }
.sent-raw[open] > .sent-raw__tools .btn { min-height: 32px; padding-inline: 0; background: none; }
.sent-raw[open] > .sent-raw__tools small, .sent-raw[open] > .sent-raw__error { font-size: var(--t-meta); }
.sent-raw[open] > .packet { margin: 0; border-radius: 0 0 12px 12px; box-shadow: inset 0 .5px 0 var(--sep); }
@media (min-width: 900px) { .sent { padding: 16px 0 56px; } }
/* 현재: one pinned bar (range, kinds as Reminders-coloured chips, sort, add), then rows read alike */
.nowbook { --kc: var(--tungsten); }
.now-bar { position: sticky; top: 48px; z-index: 5; margin: 0 -16px 4px; padding: 8px 16px 10px; background: color-mix(in srgb, var(--house) 88%, transparent); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
.now-chip { height: 34px; padding: 0 12px 0 6px; border: 0; border-radius: 17px; background: var(--screen); font-size: var(--t-ui); font-weight: 600; color: var(--ink); box-shadow: inset 0 0 0 .5px var(--sep); }
.now-chip__ic { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; color: #fff; background: var(--kc); }
.now-chip__ic .i { width: 13px; height: 13px; stroke-width: 2.2; }
.now-chip .n { font-weight: 600; color: var(--ink-3); }
.now-chip[aria-pressed="true"] { background: var(--kc); color: #fff; box-shadow: none; }
.now-chip[aria-pressed="true"] .now-chip__ic { background: rgba(255,255,255,.25); }
.now-chip[aria-pressed="true"] .n { color: rgba(255,255,255,.85); }
.now-chip.is-empty { opacity: 1; color: var(--ink-3); }
.now-chip.is-empty .now-chip__ic { opacity: .45; }
:is(.now-chip, .nr)[data-kind="all"] { --kc: var(--tungsten); }
:is(.now-chip, .nr)[data-kind="promise"] { --kc: var(--k-orange); }
:is(.now-chip, .nr)[data-kind="belief"] { --kc: var(--k-indigo); }
:is(.now-chip, .nr)[data-kind="condition"] { --kc: var(--k-teal); }
:is(.now-chip, .nr)[data-kind="goal"] { --kc: var(--k-green); }
:is(.now-chip, .nr)[data-kind="secret"] { --kc: var(--k-gray); }
.now-sort { height: 34px; border-radius: 17px; font-size: var(--t-meta); }
.now-chips { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent); padding-right: 24px; }
.now-note { margin: 4px 0 6px; padding: 10px 14px; border: 0; border-radius: 12px; background: var(--screen); font-size: var(--t-meta); }
.now-hint { margin: 4px 4px 6px; font-size: var(--t-meta); }
.nowbook .who-h { margin: 18px 4px 6px; }
.nowbook .who-h .name, .nowbook .who-h .name.is-cjk { font-size: var(--t-ui); font-weight: 650; color: var(--ink); }
.nr { padding: 11px 16px 12px; border-top: 0; background-color: var(--screen); background-repeat: no-repeat; }
.nr + .nr { background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; }
.nr:not(.nr + .nr) { border-top-left-radius: 12px; border-top-right-radius: 12px; }
.nr:not(:has(+ .nr)) { border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; }
.nr.has-ring { padding-left: 50px; }
.nr__ring { position: absolute; left: 10px; top: 7px; }
.nr__ring .menu.ring > summary { width: 34px; height: 34px; color: var(--ink-3); }
.nr__ring .menu.ring > summary .i { width: 24px; height: 24px; stroke-width: 1.5; }
.nr__ring .menu.ring > summary:hover, .nr__ring .menu.ring[open] > summary { color: var(--kc); background: none; }
.nr__k { font-size: var(--t-meta); }
.nr__kind { font-weight: 600; color: var(--kc); }
.nr__t { font-size: var(--t-ui); line-height: 1.5; }
.nr__what:hover .nr__t { color: inherit; }
.nr__m { margin-top: 2px; font-size: var(--t-meta); font-variant-numeric: tabular-nums; }
.nr__m .linkbtn { font-size: var(--t-meta); }
.nr.is-due .nr__kind { color: var(--cut); }
@media (min-width: 900px) { .nr.is-selected { background-color: var(--fill); } }
.who .fold .nr:first-child { border-top-left-radius: 12px; border-top-right-radius: 12px; }
@media (min-width: 900px) {
  .now-bar { position: static; margin: 0 0 12px; padding: 0; background: none; -webkit-backdrop-filter: none; backdrop-filter: none; }
  .nowbook .now-rows { padding: 0 12px 40px 0; margin: 0; }
}
/* 관계: cards open their own verbs; one-verb rows are plain buttons with a chevron */
.entry > .cardmenu { border-radius: inherit; }
.entry__face { padding: 11px 16px; }
.entry__tap > .i { width: 15px; height: 15px; }
.entry__face > .entry__src { font-size: var(--t-meta); }
.cardmenu[open] > summary, .entry__tap:active { background-color: var(--fill); }
.pairsheet .povs > .pov { padding: 0; }
.pairsheet .pov > .cardmenu { border-radius: inherit; }
.pairsheet .povs > .pov:first-child { border-radius: 12px 12px 0 0; }
.pairsheet .povs > .pov:last-child { border-radius: 0 0 12px 12px; }
.pairsheet .povs > .pov:only-child { border-radius: 12px; }
.pairsheet .pov__face { padding: 11px 16px 12px; }
.pickbar { margin: 0 0 10px; padding: 8px 8px 8px 14px; border: 0; border-radius: 12px; background: color-mix(in srgb, var(--tungsten) 12%, var(--screen)); font-size: var(--t-meta); }
.scene__slug > .btn { height: 30px; min-height: 30px; padding: 0 12px; border-radius: 15px; background: var(--fill); color: var(--accent-text); font-size: var(--t-meta); font-weight: 600; }
/* 아는 사이: the person list's contact rows in one card; an open contact shows names as tags */
.acq__acts { margin-bottom: -8px; }
.acquaintances > .sec-head { margin-bottom: 7px; }
.acquaintances > .sec-head > .sec { margin-top: 24px; }
.acq-list { border: 0; border-radius: 12px; background: var(--screen); overflow: hidden; }
.acq-list > li { border-top: 0; }
.acq-list .acq__row { border-radius: 0; background-color: transparent; }
.acq-list > li + li > .acq > .acq__row { background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 62px) .5px; background-position: right top; background-repeat: no-repeat; }
@media (hover: hover) { .acq__row:hover { background-color: color-mix(in srgb, var(--ink) 4%, transparent); } }
.acq[open] > .acq__row { background-color: color-mix(in srgb, var(--ink) 3%, transparent); }
.acq[open] > .acq__row .row__title .name { color: inherit; }
.acq__how.is-met { color: var(--k-green); font-weight: 600; }
.acq__how .i { stroke-width: 2.6; }
.acq__body { margin: 0; padding: 0 16px 6px 62px; border: 0; }
.acq__side { padding: 10px 0 12px; }
.acq__side + .acq__side { padding-top: 10px; border-top: .5px solid var(--sep); }
.acq__h { gap: 6px; margin-bottom: 6px; font-size: var(--t-meta); }
.acq__lv { font-size: var(--t-cap); font-weight: 600; }
.acq__lv.is-met { color: var(--k-green); }
.acq__edit { padding: 4px 6px; margin: -4px -6px; border-radius: 8px; font-size: var(--t-meta); font-weight: 600; }
.acq__tagrow { grid-template-columns: 4.6em minmax(0, 1fr); }
.acq__k { padding-top: 3px; font-size: var(--t-cap); letter-spacing: 0; }
.acq__tagrow > .is-empty { padding-top: 2px; font-size: var(--t-meta); line-height: 1.5; color: var(--ink-3); }
.acq__tags { gap: 5px; }
.acq__tag { padding: 2px 9px; border: 0; border-radius: 10px; font-size: var(--t-meta); line-height: 1.5; background: var(--fill); }
.acq__tag--call { color: var(--accent-text); background: color-mix(in srgb, var(--tungsten) 13%, transparent); font-weight: 600; }
.acq__memo { margin-top: 8px; max-width: none; font-size: var(--t-ui); line-height: 1.5; }
/* Film's injection and processing sections, set on glass */
.wg--film > section > h2.sec { margin: 2px 0 6px; color: var(--lock-ink-2); font-weight: 600; }
.wg h2.wg__h:has(> .n) { flex-wrap: wrap; row-gap: 2px; }
.wg h2.wg__h > .n { flex-basis: 100%; margin: 0; font-weight: 400; color: var(--ink-3); }
.wg--film > * + * { margin-top: 14px; }
.wg--film > .wg__processing { margin-top: 0; }
.wg--film .inject { font-size: var(--t-ui); font-weight: 400; color: var(--ink-2); }
.wg--film .inject .tag { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.wg--film .sub, .wg--film .meter { color: var(--lock-ink-2); }
.wg--film .fold > summary { background: none; padding-left: 0; padding-right: 0; }
.wg--film .fold > summary, .wg--film .fold > summary .fold__label { font-size: var(--t-ui); font-weight: 600; }
/* the wallpaper runs under the tab bar to the bottom of the page */
@media (max-width: 899px) { .lock { margin-bottom: -112px; } }
/* ---- quieter lists: one line per memory, two-line reminders ---- */
/* timeline: the title on one line with its date, scene and place in grey below; the summary waits in the reader */
#memory-rows .row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 2px 8px; padding: 10px 16px; }
#memory-rows .row > * { grid-column: 1 / -1; order: 3; }
#memory-rows .row__slug { display: contents; }
#memory-rows .row__title { order: 1; grid-row: 1; grid-column: 1 / -1; font-size: var(--t-ui); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#memory-rows .row__slug .tc { order: 1; grid-row: 2; grid-column: 2; align-self: center; font-size: var(--t-meta); white-space: nowrap; color: var(--ink-3); }
#memory-rows .row__slug b { order: 2; grid-row: 2; grid-column: 1; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#memory-rows .row__slug .row__signals { order: 2; grid-row: 2; grid-column: 3; justify-self: end; }
#memory-rows .row__sub { display: none; }
@media (min-width: 900px) { #memory-rows .row[aria-current="true"] :is(.row__slug b, .row__slug .tc, .row__signals) { color: rgba(255,255,255,.86); } }
.st-row, .who .st-row, .who .st-row--plain { position: relative; grid-template-columns: minmax(0, 1fr); }
.st-row__kind { position: absolute; top: 11px; left: 16px; padding: 0; line-height: 1.5; }
.st-row__kind::after { content: " ·"; }
.st-row__kind + .st-row__what > :first-child { padding-left: 2.8em; }
.who .st-row__what, .who .st-row__meta { grid-column: 1; }
.who .st-row__acts { grid-column: 1; grid-row: auto; }
.st-row__who { line-height: 1.5; }
.st-row__text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.who--due .st-row__acts .btn { height: 28px; }
/* ---- critique pass: reach, filters, second-level tabs ---- */
/* inline links (S#, sources) keep a 44px touch target on phones, like .btn */
@media (max-width: 760px) {
  .linkbtn { position: relative; }
  .linkbtn::after { content: ""; position: absolute; left: 50%; top: 50%; width: max(100%, var(--hit)); height: max(100%, var(--hit)); transform: translate(-50%, -50%); }
}
/* the timeline's filters live in its ··· menu; the chip row returns only while one is on, so it can be switched off */
/* Timeline filters live in its ··· menu; only active ones show as chips. People and relationship tiers stay visible. */
.timeline .listcol > .filters:not(:has([aria-pressed="true"])) { display: none; }
.timeline .listcol > .filters .filter:not([aria-pressed="true"]) { display: none; }
/* settings sections are a second level: plain text tabs with an underline, not another segmented control */
.settingspage .tabs { gap: 18px; padding: 0 4px; background: none; border-radius: 0; box-shadow: inset 0 -.5px 0 var(--sep); }
.settingspage .tab { height: 38px; padding: 0; border-radius: 0; background: none; color: var(--ink-3); font-weight: 500; }
.settingspage .tab[aria-selected="true"], :root[data-theme="night"] .settingspage .tab[aria-selected="true"] { background: none; color: var(--ink); font-weight: 600; box-shadow: inset 0 -2px 0 var(--tungsten); }
/* ---- critique pass 2 ---- */
/* the overdue count is the lock screen's one urgent number; the promise notification carries the same tint */
.noti:has(> .noti__ic--orange) { background: color-mix(in srgb, var(--k-orange) 12%, var(--lock-glass)); }
/* a folded people group previews its first faces */
.people-group > summary .fold-avs { display: flex; order: 2; margin-left: auto; }
.people-group > summary .chev { order: 3; margin-left: 8px; }
.people-group > summary .fold-avs .av + .av { margin-left: -8px; box-shadow: 0 0 0 2px var(--house); }
.people-group[open] > summary .fold-avs { display: none; }
.people-group[open] > summary .chev { margin-left: auto; }
/* phones: lists fade out under the floating tab bar instead of being cut by it */
@media (max-width: 899px) {
  .film:not(:has(.lock)):not(.dialog)::after { content: ""; position: fixed; left: 0; right: 0; bottom: 0; z-index: 19; height: calc(96px + env(safe-area-inset-bottom)); background: linear-gradient(color-mix(in srgb, var(--house) 0%, transparent), var(--house) 78%); pointer-events: none; }
}
/* ---- iOS fidelity ---- */
/* the system face first: SF Pro and Apple SD Gothic Neo on Apple devices, Pretendard elsewhere */
.film { --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Pretendard Variable", Pretendard, "Pretendard JP", "Noto Sans JP", "Noto Sans SC", "Noto Sans TC", system-ui, "Apple SD Gothic Neo", "Hiragino Sans", "Malgun Gothic", sans-serif; -webkit-tap-highlight-color: transparent; }
/* cells darken while pressed, like a table view; no web tap flash */
:is(.row, .pairrow, .wg__row, .menu__item, .anni__open, button.noti, button.lw, .st-row__what, .people-group > summary):active { background-color: color-mix(in srgb, var(--ink) 8%, var(--screen)); }
@media (max-width: 899px) {
  /* a pushed detail has only its back button on top; the large title and section tabs belong to the list */
  .main:has(> .page > .is-detail) > .subnav { display: none; }
  /* top-level screens show the large title; the bar's inline title appears only once it scrolls away */
  .film:not(:has(.page > .is-detail)) .topbar .where { visibility: hidden; }
  @supports (animation-timeline: scroll()) {
    .film:not(:has(.page > .is-detail)):not(:has(.lock)):not(:has(.page > .timeline)) .topbar .where { visibility: visible; animation: rcm-inline-title linear both; animation-timeline: scroll(root); animation-range: 36px 72px; }
  }
}
@keyframes rcm-inline-title { from { opacity: 0; } to { opacity: 1; } }
/* menus read like iOS context menus: label first, its symbol trailing; the sheet title centred */
.menu__item { justify-content: flex-start; gap: 12px; }
.menu__item > span { order: 1; flex: 1; min-width: 0; text-align: left; }
.menu__item > .k { order: 2; flex: none; }
.menu__item > .i { order: 3; flex: none; }
.menu__title { text-align: center; }
/* switches, not checkboxes */
:is(.field--check, label.check) input[type="checkbox"] { appearance: none; position: relative; flex: none; display: block; width: 51px; height: 31px; margin: 0; padding: 0; border: 0; border-radius: 16px; background: rgba(120,120,128,.16); cursor: pointer; transition: background-color .2s ease; }
:root[data-theme="night"] :is(.field--check, label.check) input[type="checkbox"] { background: rgba(120,120,128,.36); }
:is(.field--check, label.check) input[type="checkbox"]::after, :is(.field--check, label.check) input[type="checkbox"]:checked::after { content: ""; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0,0,0,.15), 0 3px 1px rgba(0,0,0,.06); transform: none; transition: transform .2s ease; }
:is(.field--check, label.check) input[type="checkbox"]:checked, :root[data-theme="night"] :is(.field--check, label.check) input[type="checkbox"]:checked { background: var(--k-green); border-color: transparent; }
:is(.field--check, label.check) input[type="checkbox"]:checked::after { transform: translateX(20px); }
:is(.field--check, label.check) input[type="checkbox"]:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { :is(.field--check, label.check) input[type="checkbox"], :is(.field--check, label.check) input[type="checkbox"]::after { transition: none; } }
label.check:has(> input[type="checkbox"]) { display: flex; flex-direction: row-reverse; justify-content: space-between; align-items: center; width: 100%; }
/* ---- wide screens: the lock screen's wallpaper fills the whole content area; its content stays in a centred column ---- */
@media (min-width: 900px) {
  .main:has(> .page > .lock) { max-width: none; }
  /* the wallpaper sits behind the whole window, so the glass rail and toolbar show it instead of a hard edge */
  .app:has(.lock) { background: var(--lock-wallpaper); background-attachment: fixed; }
  .lock__wall { display: none; }
}
@container lock-home (min-width: 900px) {
  .lock { padding-inline: max(56px, calc((100% - 1160px) / 2)); }
  .lock__date:not(.lock__date--free) { font-size: clamp(64px, 8.5vw, 112px); white-space: nowrap; }
}
/* ---- desktop lock screen: the page holds still; only the notification and widget column scrolls ---- */
.lock__side { display: contents; }
@container lock-home (min-width: 900px) {
  .lock { height: calc(100vh - 48px); height: calc(100dvh - 48px); min-height: 0; padding-block: 0; align-items: stretch; overflow: hidden; }
  .lock__time { grid-row: 1; align-self: center; position: static; padding-top: 0; }
  .lock__side { display: block; grid-column: 2; grid-row: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14vh 6px 48px; scrollbar-width: none; -webkit-mask-image: linear-gradient(transparent, #000 28px, #000 calc(100% - 40px), transparent); mask-image: linear-gradient(transparent, #000 28px, #000 calc(100% - 40px), transparent); }
  .lock__side::-webkit-scrollbar { display: none; }
  .lock__side > .lock__notes { margin-top: 0; }
}
/* ---- iOS review pass ---- */
/* the content never shifts sideways when a page gains or loses its scrollbar */
:root[data-skin="phone"] { scrollbar-gutter: stable; }
/* section segments size to their labels on wide screens, like an iPad toolbar control */
@media (min-width: 900px) { .subnav .tabs { max-width: 420px; } }
/* 현재: Reminders' ring holds the promise verbs; the ··· sits at the row's end */
.st-row__ring { position: absolute; left: 10px; top: 7px; }
.st-row__ring .menu.ring > summary { width: 34px; height: 34px; color: var(--ink-3); }
.st-row__ring .menu.ring > summary .i { width: 24px; height: 24px; stroke-width: 1.5; }
.st-row__ring .menu.ring > summary:hover, .st-row__ring .menu.ring[open] > summary { color: var(--tungsten); background: none; }
.st-row:has(> .st-row__ring) { padding-left: 50px; }
.st-row:has(> .st-row__ring) > .st-row__kind { left: 50px; }
.who .st-row__acts { position: absolute; top: 6px; right: 6px; }
.who .st-row__what { padding-right: 30px; }
/* Labelled thread panel; a speaker's run names them once. */
.lines { gap: 3px; margin: 0; padding: 10px; border-radius: 16px; background: var(--fill); }
:root[data-theme^="day"] .lines { background: rgba(118,118,128,.07); }
.lines .subtitle:not([data-side="out"]) { background: var(--screen); }
:root[data-theme="night"] .lines .subtitle:not([data-side="out"]) { background: var(--bubble); }
.lines .subtitle[data-cont] small { display: none; }
.lines__speaker { margin: 2px 10px 0; font-size: var(--t-cap); font-weight: 600; color: var(--ink-3); }
.lines__speaker:not(:first-child) { margin-top: 9px; }
.lines__row { flex-direction: row; flex-wrap: wrap; justify-content: flex-start; gap: 4px 8px; text-align: start; }
.lines__row[data-side="out"] { flex-direction: row-reverse; }
.lines__row > .subtitle { max-width: 100%; }
.lines__access { font-size: var(--t-cap); }
/* ---- 설정: the Settings app. A section list (icon tile, name, ›) opens each section; on a phone as its own screen, on PC beside the list ---- */
.settings-nav { display: grid; margin: 10px 0 0; overflow: hidden; border-radius: 12px; background: var(--screen); }
.settings-nav__row { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 12px; width: 100%; min-height: 54px; padding: 8px 14px 8px 16px; color: var(--ink); text-align: left; }
.settings-nav__row + .settings-nav__row { background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 58px) .5px; background-position: right top; background-repeat: no-repeat; }
.settings-nav__ic { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; color: #fff; background: var(--k-gray); }
.settings-nav__ic .i { width: 18px; height: 18px; stroke-width: 2; }
.settings-nav__ic--green { background: var(--k-green); } .settings-nav__ic--indigo { background: var(--k-indigo); } .settings-nav__ic--gray { background: var(--k-gray); } .settings-nav__ic--teal { background: var(--k-teal); } .settings-nav__ic--orange { background: var(--k-orange); }
.settings-nav__t { min-width: 0; font-size: var(--t-body); }
.settings-nav__t small { display: block; margin-top: 1px; font-size: var(--t-meta); color: var(--ink-3); }
.settings-nav__row > .i { width: 15px; height: 15px; color: var(--ink-3); }
@media (max-width: 899px) {
  .settingspage:not(.is-open) .settings-panel { display: none; }
  .settingspage.is-open > :is(.settings-nav, .intro) { display: none; }
  .main:has(.settingspage.is-open) > .subnav { display: none; }
  .settings-back { margin: 0 0 14px; }
}
@media (min-width: 900px) {
  .settingspage { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 0 28px; align-items: start; }
  .settingspage > .intro { grid-column: 1 / -1; }
  .settings-nav { position: sticky; top: 64px; }
  .settings-nav__row[aria-current="true"] { background-color: var(--tungsten); color: #fff; }
  .settings-nav__row[aria-current="true"] small, .settings-nav__row[aria-current="true"] > .i { color: rgba(255,255,255,.82); }
  .settings-nav__row[aria-current="true"] + .settings-nav__row, .settings-nav__row:has(+ [aria-current="true"]) + [aria-current="true"] { background-image: none; }
  .settings-back { display: none; }
  .settingspage .settings-panel { margin-top: 0; max-width: 700px; }
}
/* each setting is its own inset cell; its explanation reads as the grey footer beneath */
.film .settingspage .setting-group { padding: 0; border: 0; }
.film .settingspage .setting-group + .setting-group { border-top: 0; }
.film .settingspage .setting-group > h3 { margin: 26px 16px 7px; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.film .settingspage :is(.setting-group, .setting-group > details) > .form__row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; padding: 0; background: none; }
.film .settingspage :is(.setting-group, .setting-group > form) > .field { margin-bottom: 12px; }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field { position: relative; isolation: isolate; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto auto auto; gap: 0 12px; min-height: 0; margin: 0; padding: 0; background: none; }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field::before { content: ""; grid-row: 1 / 3; grid-column: 1 / -1; z-index: -1; border-radius: 12px; background: var(--screen); }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field > span:first-child { grid-row: 1; grid-column: 1; align-self: center; padding: 12px 0 12px 16px; font-size: var(--t-body); font-weight: 400; color: var(--ink); }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field > :is(select, input[type="number"]) { grid-row: 1; grid-column: 2; align-self: center; width: auto; max-width: 48vw; min-height: 32px; margin-right: 14px; border: 0; background-color: transparent; color: var(--ink-3); text-align: right; text-align-last: right; }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field > select { padding: 0 22px 0 0; background-position: right 0 center; }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field > input[type="number"] { width: 84px; border-radius: 8px; background: var(--fill); color: var(--ink); text-align: center; }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field > :is(input:not([type="checkbox"]):not([type="radio"]):not([type="number"]), textarea, p.sub, .secret-input) { grid-row: 2; grid-column: 1 / -1; width: auto; margin: 0 16px 12px; border: 0; }
.film .settingspage .secret-input > input { border: 0; background: var(--fill); }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field > :is(input:not([type="checkbox"]):not([type="radio"]):not([type="number"]), textarea) { background: var(--fill); }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field > small { grid-row: 3; grid-column: 1 / -1; padding: 7px 16px 0; font-size: var(--t-meta); line-height: 1.4; color: var(--ink-3); }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field--check > span:first-child { grid-column: 1 / -1; display: flex; flex-direction: row-reverse; justify-content: space-between; align-items: center; gap: 12px; padding: 7px 16px; }
/* ---- owner pass: acquaintances, chapter picker, state rows, act close, settings odds ---- */
/* Acquaintances share the ledger's meta, names and description rhythm. */
.entry.acquaintance { grid-template-columns: minmax(0, 1fr); }
.acquaintance .entry__title { font-size: var(--t-ui); font-weight: 600; color: var(--ink); }
.acquaintance .entry__body { font-size: var(--t-ui); font-weight: 400; color: var(--ink-2); }
/* the row's ··· keeps its hit area without pushing the names line down */
.acquaintance .entry__head { align-items: center; justify-content: space-between; }
.acquaintance .entry__head > .menu { margin-block: -8px -8px; }
.entry.acquaintance { row-gap: 2px; }
.acquaintance > :is(.entry__title, .entry__body) { margin-top: 0; }
/* film's full-width row rules stay out of grouped cells; contact cells inset the hairline to the name */
:is(.list > .row + .row, .list > li + li > .row, .tl-rows > .row + .row, .tl-rows > .fold + .row, .pairrow + .pairrow) { box-shadow: none; }
.contact-row + .contact-row { background-size: calc(100% - 62px) .5px; }
.relationship-row + .relationship-row { background-size: calc(100% - 84px) .5px; }
/* a body with no title above it is the row's text: who → whom, then the words in ink */
.entry__who + .entry__body, .entry__head + .entry__body { color: var(--ink); }
/* every first-line ··· (promise, milestone, scene) sits on that line without pushing the text down */
:is(.entry__head, .scene__slug) { align-items: center; }
:is(.entry__head, .scene__slug) > .menu { margin-block: -8px; }
.entry--promise { row-gap: 2px; }
/* pair 지금: one grouped card, each direction a cell with its who line inside, like a promise */
.pairsheet .povs { border-radius: 12px; background: var(--screen); }
.pairsheet .pov { padding: 11px 16px 12px; }
.pairsheet .pov + .pov { background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; background-repeat: no-repeat; }
.pairsheet .pov__head { display: flex; align-items: center; margin: 0 0 2px; }
.pairsheet .pov__head > .menu { margin-block: -8px; }
.pairsheet .pov__head h3 { gap: 0; }
.pairsheet .pov__to { margin-left: 4px; }
.pairsheet .pov > .clamp, .pairsheet .pov > .clamp:has(+ .tensions) { padding: 0; border-radius: 0; background: none; }
.pairsheet .pov__text { color: var(--ink); }
.pov__none { margin: 0; font-size: var(--t-ui); color: var(--ink-3); }
/* an opened detail row reads its whole line in the header; the body only adds what follows */
.memory-detail-row[open] > summary .memory-detail-row__preview { display: block; -webkit-line-clamp: unset; overflow: visible; }
/* the sheet's closing folds (세부 정보 · 스킨십 기록 · 부르는 이름) read as one short list of disclosure lines */
.pairsheet > details.fold--section { margin-top: 24px; }
.pairsheet > .psec > details.fold--section:only-child { margin-top: 0; }
/* 처리 상태: the backfill summary is one inset card — progress, then label · value cells, then its action */
.operations .progress { margin: 0 0 8px; padding: 0; }
.operations .progress > h3.sec { margin: 8px 4px 7px; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.progress__card { overflow: hidden; padding: 12px 16px 0; border-radius: 12px; background: var(--screen); }
.progress__card > .meter { margin: 0; font-size: var(--t-meta); color: var(--ink-3); }
.progress__card > .meter > span:first-child { display: none; }
.progress__card > .sub { margin: 6px 0 10px; font-size: var(--t-meta); color: var(--ink-3); }
.progress__card > .phases { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0; margin: 0 -16px; padding: 0; }
.operations .opstate .status li { font-weight: 400; }
.progress__card > .phases > :is(dt, dd) { margin: 0; padding: 11px 0; border-top: .5px solid var(--sep); font-size: var(--t-ui); font-weight: 400; line-height: 1.35; }
.progress__card > .phases > dt { margin-left: 16px; color: var(--ink); }
.progress__card > .phases > dd { padding-right: 16px; color: var(--ink-3); text-align: right; font-variant-numeric: tabular-nums; }
.progress__card > .phases > dd.is-done { color: var(--ok); }
.progress__card > .phases > dd.is-warn { color: var(--cut); }
.progress__card > .phases > dd.is-run { color: var(--accent-text); }
.progress__card > .decide { display: flex; justify-content: flex-end; gap: 8px; margin: 0 -16px; padding: 10px 16px; border-top: .5px solid var(--sep); }
.progress__card > .decide > .btn { flex: none; min-width: 88px; justify-content: center; }
/* completed runs: each run is a labelled grouped card of kind rows */
.oprun > h2.sec { margin: 24px 4px 7px; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.oprun > h2.sec .n { margin-left: 4px; color: inherit; font-weight: 400; }
.jobs--grouped { overflow: hidden; border-radius: 12px; background: var(--screen); }
.jobs--grouped > :is(.job, .job-group) { margin: 0; border-radius: 0; }
.jobs--grouped > :is(.job, .job-group) + :is(.job, .job-group) > summary { background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; background-repeat: no-repeat; }
.jobs--grouped :is(.job, .job-group) > summary { display: flex; align-items: center; }
.jobs--grouped :is(.job, .job-group) > summary > .job__title { flex: 1; }
/* job rows read as list text, not headings */
.operations :is(.job__name, .step__main b) { font-weight: 400; }
.operations .job__name { font-size: var(--t-ui); color: var(--ink); }
/* 데이터: chats grouped under their bot, each chat one cell */
.chats > .chats__bot { margin: 22px 4px 7px; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.chats > .chats__bot:first-child { margin-top: 8px; }
.chats > .chat { padding: 0 16px; background: var(--screen); }
.chats > .chat + .chat { border-top: 0; background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; background-repeat: no-repeat; }
.chats > .chat:not(.chat + .chat) { border-top-left-radius: 12px; border-top-right-radius: 12px; }
.chats > .chat:not(:has(+ .chat)) { border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; }
.chats .chatrow { align-items: center; padding: 11px 0; }
.chats .chatrow__main b { font-size: var(--t-ui); font-weight: 600; color: var(--ink); }
.chats .chatrow__meta { margin-top: 2px; font-size: var(--t-meta); line-height: 1.4; color: var(--ink-3); }
.chats .chatrow__acts > .menu { margin-block: -8px; }
.datapage > .sub:last-child { margin: 12px 4px 0; font-size: var(--t-meta); color: var(--ink-3); }
/* relationship edit: an axis's 상태 and 변화 sit side by side, one row per axis */
.pairsheet__edit .form__row:has(> .field > select) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.pairsheet .pov .tensions { padding: 6px 0 0 18px; border-radius: 0; background: none; color: var(--ink-2); }
/* an anniversary: its name leads, the scene title reads as text, the line and its speaker share a row */
.anni__title { font-weight: 400; color: var(--ink); }
.anni__open { padding-right: 60px; }
/* 세부 정보's two lists are labelled like any other section */
.pairsheet .subhead { margin: 18px 4px 7px; padding: 0; border: 0; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.pairsheet .fold__body > .subhead:first-child { margin-top: 4px; }
.anni__acts { top: 3px; right: 16px; }
.anni .subtitle { display: block; margin-top: 2px; }
.anni .subtitle > span { display: inline; }
.anni .subtitle small { display: inline; margin-left: 6px; padding: 0; color: var(--ink-3); }
/* the chapter picker sits right, where its list opens */
@media (min-width: 900px) { .reelnav { display: flex; justify-content: flex-end; } }
/* a state or goal row: its kind is a small line above the title, like the who line of a promise */
.st-row__kind + .st-row__what > .st-row__title { padding-left: 0; padding-top: 19px; }
.st-row:has(> .st-row__what > .st-row__title) > .st-row__kind::after { content: ""; }
/* 설정 odds: prompt placement as a cell, the cache line as a value row, extra exclusion rules as their own group */
.settings-injection { padding: 12px 16px; border-radius: 12px; background: var(--screen); font-size: var(--t-body); }
.settings-injection p { margin: 0; }
.settings-injection p.sub { margin-top: 6px; font-size: var(--t-meta); }
.settings-injection code { padding: 1px 5px; border-radius: 5px; background: var(--fill); font-size: .92em; }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field > .settings-cache-row { grid-row: 1; grid-column: 2; align-self: center; display: flex; align-items: center; gap: 4px; margin-right: 8px; }
.film .settingspage .field > [data-quiz-controls] { grid-row: 2; grid-column: 1 / -1; margin: 0 6px 6px; }
.settings-cache-row .sub { font-size: var(--t-ui); color: var(--ink-3); }
.settings-regex-toolbar { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 26px 16px 7px; }
.settings-regex-toolbar strong { display: block; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.settings-regex-toolbar span { display: block; margin-top: 2px; font-size: var(--t-meta); color: var(--ink-3); }
.settings-regex-toolbar .btn { height: auto; padding: 0; background: none; color: var(--accent-text); font-weight: 400; }
.settings-regex-disclosure { margin-top: 0; }
.settings-regex-summary strong { font-weight: 400; }
.settings-regex-summary small { color: var(--ink-3); font-size: var(--t-ui); }
.settings-regex-body { padding: 0 16px 12px; border-radius: 0 0 12px 12px; background: var(--screen); }
.settings-regex-empty { padding: 10px 0 4px; font-size: var(--t-ui); color: var(--ink-3); }
.settings-regex-note { margin: 8px 0 0; font-size: var(--t-meta); color: var(--ink-3); }
.settings-regex-rule { grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; padding: 12px 0; border-radius: 0; background: none; box-shadow: inset 0 .5px 0 var(--sep); }
.settings-regex-rule > .field { grid-column: 1 / -1; }
.settings-regex-rule > .field > span:first-child { font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.film .settings-regex-rule > .field > input { border: 0; background: var(--fill); }
.settings-regex-enabled { grid-row: 1; grid-column: 1; justify-content: space-between; flex-direction: row-reverse; width: 100%; font-size: var(--t-body); }
.settings-regex-remove { grid-row: 1; grid-column: 2; color: var(--cut); }
.settings-regex-enabled input[type="checkbox"] { appearance: none; position: relative; flex: none; width: 51px; height: 31px; margin: 0; border: 0; border-radius: 16px; background: rgba(120,120,128,.16); cursor: pointer; transition: background-color .2s ease; }
.settings-regex-enabled input[type="checkbox"]::after { content: ""; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 3px 8px rgba(0,0,0,.15), 0 3px 1px rgba(0,0,0,.06); transition: transform .2s ease; }
.settings-regex-enabled input[type="checkbox"]:checked { background: var(--k-green); }
.settings-regex-enabled input[type="checkbox"]:checked::after { transform: translateX(20px); }
@media (prefers-reduced-motion: reduce) { .settings-regex-enabled input[type="checkbox"], .settings-regex-enabled input[type="checkbox"]::after { transition: none; } }
/* a short segmented choice (밤/낮, 영화/폰) sits at the row's end, like a Settings value */
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field > .seg { grid-row: 1; grid-column: 2; align-self: center; margin: 0 14px 0 0; }
/* settings: the open section names itself; settings without their own footer share one inset group, hairline between */
.film .settingspage .setting-section-copy h2.sr-only { position: static; width: auto; height: auto; overflow: visible; clip-path: none; white-space: normal; margin: 14px 0 4px; color: var(--ink); }
.film .settingspage .setting-section-copy p { margin: 0 0 8px; font-size: var(--t-meta); }
.film .settingspage :is(.setting-group, .setting-group > details) > .form__row > .field:not(:has(> small)):has(+ .field)::before { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.film .settingspage :is(.setting-group, .setting-group > details) > .form__row > .field:not(:has(> small)) + .field { margin-top: -14px; }
.film .settingspage :is(.setting-group, .setting-group > details) > .form__row > .field:not(:has(> small)) + .field::before { border-top-left-radius: 0; border-top-right-radius: 0; background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; background-repeat: no-repeat; }
/* settings: one group is one card. A footnote belongs to its row and sits inside the cell under the label,
   so a group never breaks into separate cards; hairlines separate the rows, the first and last visible rows round the card. */
.film .settingspage :is(.setting-group, .setting-group > details) > .form__row { gap: 0; }
.film .settingspage :is(.setting-group, .setting-group > details) > .form__row > .field:not(:has(> small)) + .field { margin-top: 0; }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field::before { grid-row: 1 / -1; border-radius: 0; background-image: none; }
.film .settingspage :is(.setting-group, .setting-group > details) > .form__row > .field:not([hidden]) ~ .field::before { background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; background-repeat: no-repeat; }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field:not(.field:not([hidden]) ~ .field)::before { border-top-left-radius: 12px; border-top-right-radius: 12px; }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field:not(:has(~ .field:not([hidden])))::before { border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; }
.film .settingspage :is(:is(.setting-group, .setting-group > details) > .form__row, .setting-group, .setting-group > form) > .field > small { padding: 0 16px 11px; margin-top: -4px; }
.film .settingspage :is(.setting-group, .setting-group > details) > .form__row > .btn { justify-self: start; margin: 10px 4px 0; }
.film .settingspage .settings-advanced[open] > .form__row > .field:not(.field:not([hidden]) ~ .field)::before { border-top-left-radius: 0; border-top-right-radius: 0; background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; background-repeat: no-repeat; }
/* an opened section names itself like any detail screen */
.settings-pane__title { margin: 4px 4px 2px; font-size: var(--t-sheet); font-weight: 700; line-height: 1.25; letter-spacing: -.01em; color: var(--ink); }
.settingspage .setting-group:first-of-type > h3, .settings-pane__title + .setting-group > h3, .settings-pane__title + .settings-connection { margin-top: 18px; }
@media (min-width: 900px) { .settings-pane__title { display: none; } }
/* ---- disclosures have explicit roles; settings/cells keep the default 17px row ---- */
.fold.fold--more { margin-top: 0; }
.fold.fold--more > summary { min-height: 44px; gap: 4px; border-radius: 0 0 12px 12px; background: var(--screen); background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; background-repeat: no-repeat; font-size: var(--t-ui); font-weight: 500; color: var(--accent-text); }
.fold.fold--more > summary > span:first-child { flex: none; }
.fold.fold--more > summary .chev { color: inherit; transform: rotate(90deg); }
.fold.fold--more[open] > summary { display: none; }
.fold.fold--more > .fold__body { padding: 0; }
:is(.row, .pairrow, .entry, .scene, .acquaintance, .st-row):has(+ .fold--more),
:is(.scenelog, .entries, .list, .tl-rows):has(+ .fold--more) > :last-child { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.fold--more[open] > .fold__body > :first-child:is(.st-row, .scene),
.fold--more[open] > .fold__body > :first-child:is(.scenelog, .entries, .list, .tl-rows) > :first-child { border-top-left-radius: 0; border-top-right-radius: 0; background-image: linear-gradient(var(--sep), var(--sep)); background-size: calc(100% - 16px) .5px; background-position: right top; background-repeat: no-repeat; }
/* a revealed run that opens on a new date is a new group: the card above closes, the date keeps its own gap */
:is(.scenelog, .tl-rows):has(+ .fold--more[open] > .fold__body > :first-child > .day:first-child) > :last-child { border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; }
.fold--more[open] > .fold__body > :is(.scenelog, .tl-rows) > .day:first-child { margin-top: 22px; background-image: none; }
.fold--more > .fold__body > :last-child:is(.st-row, .row, .pairrow, .entry, .scene),
.fold--more > .fold__body > :last-child:is(.scenelog, .entries, .list, .tl-rows) > :last-child { border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; }
.fold.fold--section { margin-top: 16px; }
.fold.fold--section:not([open]) + .fold.fold--section:not([open]) { margin-top: 0; }
.fold.fold--section > summary { min-height: 44px; padding: 4px; border-radius: 0; background: none; font-size: var(--t-meta); font-weight: 400; color: var(--ink-3); }
.fold.fold--section > summary > span:first-child { flex: none; }
.fold.fold--section > summary .n { margin-left: 2px; font-size: var(--t-meta); font-weight: 400; color: inherit; }
.fold.fold--section > summary .chev { margin-left: auto; }
.fold.fold--section > .fold__body { padding: 0; }
.fold--section > .fold__body > :is(.kv, .packet, .sub, .status) { padding: 12px 16px; border-radius: 12px; background: var(--screen); }
/* ---- 기억 · 줄거리: a series in glass. One soft light, the chosen act's two hues, sits behind the whole app;
   every surface over it is frosted glass and the type stays quiet, so the light is the only loud thing on the page ---- */
/* the hues are registered colours, so choosing another act slowly re-lights the page instead of cutting to it */
@property --h1 { syntax: "<color>"; inherits: true; initial-value: #FF375F; }
@property --h2 { syntax: "<color>"; inherits: true; initial-value: #FF9F0A; }
.app:has(.series) { --h1: var(--k-pink); --h2: var(--k-orange); --g: 58%; background: transparent; transition: --h1 1.4s var(--ease), --h2 1.4s var(--ease); }
:root[data-theme^="day"] .app:has(.series) { --g: 56%; }
.app:has(.series[data-cover="1"]) { --h1: var(--k-indigo); --h2: var(--k-teal); }
.app:has(.series[data-cover="2"]) { --h1: var(--k-orange); --h2: var(--k-yellow); }
.app:has(.series[data-cover="3"]) { --h1: #AF52DE; --h2: var(--k-pink); }
.app:has(.series[data-cover="4"]) { --h1: var(--tungsten); --h2: var(--k-indigo); }
.app:has(.series[data-cover="5"]) { --h1: var(--k-teal); --h2: var(--k-green); }
/* one blurred layer fixed behind the app, so the light has no edge anywhere */
.app:has(.series)::before { content: ""; position: fixed; inset: -12%; z-index: -1; pointer-events: none;
  background:
    radial-gradient(42% 38% at 14% 18%, color-mix(in srgb, var(--h1) var(--g), transparent), transparent 100%),
    radial-gradient(46% 42% at 88% 38%, color-mix(in srgb, var(--h2) var(--g), transparent), transparent 100%),
    radial-gradient(52% 44% at 48% 92%, color-mix(in srgb, color-mix(in srgb, var(--h1) 50%, var(--h2)) var(--g), transparent), transparent 100%);
  filter: blur(70px); }
.series { padding-bottom: 56px; }
.series :is(.titlecard, .season-tab, .ep__still, .actview__lead, .actview .frame, .actview .flowcard) {
  background: color-mix(in srgb, var(--screen) 52%, transparent); -webkit-backdrop-filter: blur(28px) saturate(1.6); backdrop-filter: blur(28px) saturate(1.6);
  box-shadow: inset 0 0 0 .5px var(--glass-edge), 0 12px 32px -16px rgba(0,0,0,.4); }
/* the act index scrolls away with the page; only the glass top bar stays pinned. It drops the Film bar's blur band and sits above the glass hero, whose backdrop blur would otherwise cover its menus */
.series .reelnav { position: relative; top: auto; z-index: 6; display: flex; justify-content: flex-end; height: auto; margin: 0; padding: 0; border: 0; background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; }

/* hero: the whole story */
.series .titlecard { position: relative; margin: 8px 0 0; padding: 72px 20px 20px; border-radius: 28px; display: grid; gap: 6px; text-align: left; overflow: hidden; color: var(--ink); }
.series .titlecard::before, .series .titlecard::after { display: none; }
.series .titlecard h1 { order: 1; max-width: 16ch; margin: 0; font-size: 34px; font-weight: 800; line-height: 1.12; letter-spacing: -.025em; text-wrap: balance; color: var(--ink); }
.series .titlecard .presents { order: 2; justify-content: flex-start; margin-top: 6px; }
.series .titlecard .presents, .series .titlecard .presents .name, .series .titlecard .presents .name.is-cjk, .series .titlecard .presents .amp, .series .titlecard .presents .more { font-size: var(--t-ui); font-weight: 600; letter-spacing: 0; color: var(--ink); }
.series .titlecard .presents .amp, .series .titlecard .presents .more { font-weight: 400; color: var(--ink-2); }
.series .titlecard .runtime { order: 3; justify-content: flex-start; justify-self: start; gap: 0; font-size: var(--t-meta); color: var(--ink-2); }
.series .titlecard .runtime span + span::before { content: "·"; margin: 0 6px; }
.series .titlecard .logline { order: 4; max-width: none; margin: 12px 0 0; padding: 0; border-radius: 0; background: none; font-size: var(--t-ui); line-height: 1.55; color: var(--ink-2); }
.series .titlecard .logline p { margin: 0; white-space: pre-line; }
.series .titlecard .orig-mark { color: var(--ink-2); }

/* seasons: glass pills; the chosen one is solid */
.series .seasons { display: flex; gap: 8px; margin: 24px -16px 0; padding: 2px 16px; overflow-x: auto; scrollbar-width: none; }
.series .seasons::-webkit-scrollbar { display: none; }
.season-tab { flex: none; display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 18px; color: var(--ink); font-size: var(--t-ui); font-weight: 600; transition: background-color var(--fast) var(--ease), color var(--fast) var(--ease); }
.series .season-tab[aria-current="true"] { background: var(--ink); color: var(--house); box-shadow: none; }
.season-tab__now { font-size: var(--t-cap); font-weight: 600; color: var(--accent-text); }
.season-tab[aria-current="true"] .season-tab__now { color: color-mix(in srgb, var(--house) 70%, var(--tungsten)); }
.series .season__head { display: grid; gap: 4px; margin: 22px 4px 0; }
.season__titlebar { display: flex; align-items: flex-start; gap: 8px; }
.season__titlebar .menu { margin: -6px -8px 0 0; }
.season__title { flex: 1; min-width: 0; margin: 0; font-size: var(--t-sheet); font-weight: 700; line-height: 1.25; letter-spacing: -.01em; color: var(--ink); text-wrap: pretty; }
.series .season__head .tc { color: var(--ink-3); }
.series .season__head .syn { margin: 6px 0 0; font-size: var(--t-ui); line-height: 1.55; color: var(--ink-2); }
.season__more { justify-self: start; display: inline-flex; align-items: center; gap: 2px; min-height: 44px; font-size: var(--t-ui); font-weight: 600; color: var(--accent-text); }
.season__more .i { width: 14px; height: 14px; }

/* episodes: one glass card per act, its strongest line on the face */
.series .episodes { display: grid; grid-auto-flow: column; grid-auto-columns: min(76%, 300px); gap: 12px; margin: 16px -16px 0; padding: 0 16px 6px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding-inline: 16px; scrollbar-width: none; }
.series .episodes::-webkit-scrollbar { display: none; }
.ep { display: grid; align-content: start; gap: 2px; min-width: 0; text-align: left; scroll-snap-align: start; }
.ep__still { position: relative; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px; aspect-ratio: 16 / 11; margin-bottom: 8px; padding: 44px 16px 15px; border-radius: 18px; overflow: hidden; color: var(--ink); transition: transform 320ms var(--ease), box-shadow var(--fast) var(--ease); }
.ep:hover .ep__still { transform: scale(1.012); }
.ep:active .ep__still { transform: scale(.985); }
.series .ep[aria-current="true"] .ep__still { box-shadow: inset 0 0 0 1.5px var(--ink), 0 12px 32px -16px rgba(0,0,0,.4); }
.ep__no { position: absolute; top: 13px; left: 16px; font-size: var(--t-meta); font-weight: 700; color: var(--ink-3); }
.ep__now { position: absolute; top: 10px; right: 10px; height: 24px; padding: 0 10px; border-radius: 12px; background: var(--fill); font-size: var(--t-cap); font-weight: 600; line-height: 24px; color: var(--ink); }
.ep__line { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; font-size: 16px; font-weight: 600; line-height: 1.35; letter-spacing: -.01em; text-wrap: pretty; }
.ep__line.is-quote::before { content: "\\201C"; }
.ep__line.is-quote::after { content: "\\201D"; }
.ep__line .orig-mark, .ep__who { color: var(--ink-3); }
.ep__who { font-size: var(--t-cap); font-weight: 600; }
.ep__title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: var(--t-ui); font-weight: 600; line-height: 1.35; color: var(--ink); }
.ep__syn { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: var(--t-meta); line-height: 1.4; color: var(--ink-3); }
.ep__meta { margin-top: 2px; font-size: var(--t-cap); color: var(--ink-3); }

/* the chosen act: a glass lead, then its scenes, beats, people and what it hands on, all open */
.series .actview { margin-top: 44px; scroll-margin-top: 72px; }
.actview__lead { padding: 24px 22px; border-radius: 26px; color: var(--ink); }
.actview__head { display: flex; align-items: flex-start; gap: 8px; }
.actview__head .menu { margin: -8px -10px 0 0; }
.actview__head .menu > summary { color: var(--ink-3); }
.actview__head h2 { flex: 1; min-width: 0; margin: 0; font-size: 28px; font-weight: 800; line-height: 1.15; letter-spacing: -.025em; color: var(--ink); text-wrap: balance; }
.series .actview .act__no { display: none; }
.series .actview__lead > .tc { display: block; margin-top: 10px; font-size: var(--t-meta); color: var(--ink-3); }
.actview__syn { max-width: 60ch; margin: 14px 0 0; font-size: 18px; line-height: 1.6; color: var(--ink); white-space: pre-line; text-wrap: pretty; }
.actview__syn .orig-mark { color: var(--ink-3); }
.series .actsec { margin-top: 36px; }
.series .actsec > .sec { margin: 0 4px 12px; font-size: 20px; font-weight: 700; line-height: 1.2; letter-spacing: -.01em; color: var(--ink); }
.series .actsec > .sec .n { font-size: inherit; font-weight: 600; color: var(--ink-3); }
.series .actsec .reel { margin: 0 -16px; padding: 0 16px 4px; }
.series .actview .frame { gap: 10px; padding: 18px 18px 20px; border-radius: 22px; }
.series .actview .frame:hover { background: color-mix(in srgb, var(--screen) 70%, transparent); }
.series .actview .frame__title { font-size: var(--t-ui); font-weight: 600; color: var(--ink-2); }
.series .actview .subtitle { text-align: left; }
.series .actview .subtitle span { font-size: 17px; font-weight: 600; line-height: 1.35; letter-spacing: -.01em; color: var(--ink); }
.series .actview .subtitle small { display: block; margin-top: 6px; font-size: var(--t-meta); color: var(--ink-3); }
.series .actsec .rail { max-width: 68ch; margin: 0 4px; }
.series .actsec .rail li { grid-template-columns: 28px minmax(0, 1fr); gap: 8px; padding-bottom: 14px; }
.series .actsec .rail li::before { display: none; }
.series .actsec .rail__no { display: block; width: auto; height: auto; margin: 0; padding-top: 2px; border: 0; border-radius: 0; font-size: var(--t-ui); font-weight: 600; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.series .actsec .rail p { font-size: var(--t-body); line-height: 1.55; color: var(--ink); }
.series .actview .flowcards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.series .actview .flowcard { position: relative; padding: 18px; border-radius: 22px; }
.series .actview .flowcard:hover { background: color-mix(in srgb, var(--screen) 70%, transparent); }
.flowcard__open { display: inline-flex; align-items: center; gap: 4px; text-align: left; }
.flowcard__open::after { content: ""; position: absolute; inset: 0; border-radius: inherit; }
.flowcard__open .i { width: 14px; height: 14px; color: var(--ink-3); }
.series .actview .flowcard h4 { margin: 0 0 10px; }
.series .actview .flowcard h4 .name, .series .actview .flowcard h4 .name.is-cjk { font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
.flowcard__text { margin: 0; font-size: var(--t-ui); line-height: 1.5; color: var(--ink-2); }
.series .actview .threadlist { margin: 0; }
.series .actview .threadlist .i { color: var(--ink-3); }
.series .actview .flowcard .threadlist { margin-top: 14px; padding-top: 12px; border-top: .5px solid var(--sep); }
.series .actview .flowcard .threadlist li { font-size: var(--t-ui); color: var(--ink-2); }
.series .actsec > .threadlist { max-width: 68ch; margin: 0 4px; }
.series .actsec > .threadlist li { padding: 6px 0; font-size: var(--t-body); line-height: 1.5; color: var(--ink); }
@media (min-width: 900px) {
  .series .titlecard { padding: 120px 36px 32px; }
  .series .titlecard h1 { max-width: 18ch; font-size: 48px; }
  .series .titlecard .logline { max-width: 62ch; font-size: var(--t-body); }
  .series .seasons { margin-inline: 0; padding-inline: 0; }
  .series .episodes { grid-auto-flow: row; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 24px 16px; margin-inline: 0; padding-inline: 0; overflow: visible; }
  .actview__lead { padding: 40px 40px 38px; border-radius: 30px; }
  .actview__head h2 { font-size: 36px; }
  .actview__syn { font-size: 19px; }
  .series .actsec { margin-top: 44px; }
  .series .actsec > .sec { font-size: 22px; }
  .series .actsec .reel { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-inline: 0; padding-inline: 0; overflow: visible; }
  .series .actsec .reel > .frame { min-width: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .app:has(.series) { transition: none; }
  .ep__still { transition: none; }
  .ep:hover .ep__still, .ep:active .ep__still { transform: none; }
}

/* ---- scene sheet: one scene read in a glass sheet; it rises from the bottom on a phone and floats centred on a desktop ---- */
.scene-sheet { width: min(640px, 100vw); max-width: 100vw; max-height: min(88vh, 900px); margin: auto auto 0; padding: 0; border: 0; border-radius: 28px 28px 0 0; overflow: hidden; color: var(--ink);
  background: color-mix(in srgb, var(--screen) 74%, transparent); -webkit-backdrop-filter: blur(40px) saturate(1.7); backdrop-filter: blur(40px) saturate(1.7);
  box-shadow: inset 0 0 0 .5px var(--glass-edge), 0 -12px 40px -12px rgba(0,0,0,.45); }
.scene-sheet[open] { display: flex; flex-direction: column; animation: scene-sheet-rise 420ms cubic-bezier(.2,.9,.25,1); }
.scene-sheet::backdrop { background: rgba(0,0,0,.3); animation: scene-sheet-fade 300ms ease-out; }
@keyframes scene-sheet-rise { from { transform: translateY(40%); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes scene-sheet-pop { from { transform: scale(.96); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes scene-sheet-fade { from { opacity: 0; } }
.scene-sheet__grip { flex: none; width: 36px; height: 5px; margin: 8px auto 0; border-radius: 3px; background: var(--rule-2); }
.scene-sheet__bar { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 10px 2px 22px; }
.scene-sheet__slug { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--t-meta); color: var(--ink-3); }
.scene-sheet__bar .iconbtn { color: var(--ink-2); }
.scene-sheet__body { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 4px 22px 24px; }
.scene-sheet__title { margin: 0; font-size: 24px; font-weight: 800; line-height: 1.2; letter-spacing: -.02em; text-wrap: balance; }
.scene-sheet__line { margin: 20px 0 0; padding: 0; }
.scene-sheet__line p { margin: 0; font-size: 20px; font-weight: 600; line-height: 1.4; letter-spacing: -.01em; text-wrap: pretty; }
.scene-sheet__line p::before { content: "\\201C"; }
.scene-sheet__line p::after { content: "\\201D"; }
.scene-sheet__line cite { display: block; margin-top: 6px; font-style: normal; font-size: var(--t-meta); color: var(--ink-3); }
.scene-sheet__lede { margin: 14px 0 0; font-size: 19px; font-weight: 500; line-height: 1.5; letter-spacing: -.01em; color: var(--ink); }
.scene-sheet .sheet-sec { margin-top: 28px; }
.scene-sheet .sheet-sec > .sec { margin: 0 0 10px; font-size: 17px; font-weight: 700; color: var(--ink); }
.scene-sheet .sheet-sec > .sec .n { font-size: inherit; font-weight: 600; color: var(--ink-3); }
.scene-sheet .rail { max-width: none; margin: 0; }
.scene-sheet .rail li { grid-template-columns: 26px minmax(0, 1fr); gap: 8px; padding-bottom: 12px; }
.scene-sheet .rail li::before { display: none; }
.scene-sheet .rail__no { display: block; width: auto; height: auto; margin: 0; padding-top: 2px; border: 0; border-radius: 0; font-size: var(--t-ui); font-weight: 600; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.scene-sheet .rail p { font-size: var(--t-body); line-height: 1.55; color: var(--ink); }
.scene-sheet .threadlist { max-width: none; margin: 0; }
.scene-sheet .threadlist li { font-size: var(--t-body); line-height: 1.5; color: var(--ink); }
.scene-sheet .threadlist .i { color: var(--ink-3); }
.sheet-people { display: grid; gap: 10px; }
.sheet-person { padding: 16px 16px 6px; border-radius: 18px; background: color-mix(in srgb, var(--ink) 5%, transparent); }
.sheet-person h4 { margin: 0 0 6px; }
.sheet-person h4 .name, .sheet-person h4 .name.is-cjk { font-size: 17px; font-weight: 700; }
.sheet-person > .flowcard__text { margin-bottom: 12px; }
.sheet-person .rail p, .sheet-person .threadlist li { font-size: var(--t-ui); color: var(--ink-2); }
.scene-sheet__record { margin-top: 22px; font-size: var(--t-body); line-height: 1.65; color: var(--ink-2); white-space: pre-line; }
.scene-sheet__foot { flex: none; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 4px; padding: 8px 10px calc(10px + env(safe-area-inset-bottom)); border-top: .5px solid var(--sep); }
.scene-sheet__foot > :first-child { justify-self: start; }
.scene-sheet__foot > :last-child { justify-self: end; }
@media (min-width: 900px) {
  .scene-sheet { margin: auto; max-height: 82vh; border-radius: 28px; box-shadow: inset 0 0 0 .5px var(--glass-edge), 0 30px 80px -20px rgba(0,0,0,.5); }
  .scene-sheet[open] { animation-name: scene-sheet-pop; animation-duration: 280ms; }
  .scene-sheet__grip { display: none; }
  .scene-sheet__bar { padding: 14px 14px 4px 30px; }
  .scene-sheet__body { padding: 6px 30px 30px; }
  .scene-sheet__title { font-size: 30px; }
  .scene-sheet__line p { font-size: 22px; }
}
.scene-sheet.is-shown[open], .scene-sheet.is-shown::backdrop { animation: none; }
@media (prefers-reduced-motion: reduce) { .scene-sheet[open], .scene-sheet::backdrop { animation: none; } }

/* Model group titles outrank the grey setting sub-labels. */
.film .settingspage h3.model-section-title, .film .settingspage .setting-group > h3.model-section-title { margin: 32px 16px 12px; font-size: var(--t-body); font-weight: 600; color: var(--ink); }
.film .settingspage .model-section-title + .setting-group { padding-top: 0; }
.film .settingspage :is(.setting-group, .setting-group > details) > .form__row.connection-card, .film .settingspage form.connection-card { background: var(--screen); border-radius: 12px; }
.film .settingspage :is(.setting-group, .setting-group > details) > .form__row.connection-card > .field::before { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.film .settingspage .connection-card .settings-action { margin: 0 16px; padding: 0; border-color: var(--sep); }
.film .settingspage .settings-action .btn { padding: 0 4px; margin: 0; background: transparent; box-shadow: none; border: 0; text-align: left; }
.film .settingspage .settings-action .btn--danger { color: var(--cut); }
.film .settingspage .settings-action .btn--quiet { color: var(--accent-text); }
/* Inside a memory-tool call everything hangs from the question's text edge: no empty number column. */
.sent-call .sent-row { grid-template-columns: minmax(0, 1fr) auto; padding-left: 39px; }
.sent-call .sent-row__k { display: none; }
.sent-call .sent-row__m { grid-column: 1; }
`;

export const PHONE_CSS: string = FILM_CSS + PHONE_SKIN_CSS;
