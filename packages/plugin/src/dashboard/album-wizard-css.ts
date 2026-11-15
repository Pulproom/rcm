import { ALBUM_SCENE_PICKER_CSS } from "./album-scene-picker.js";
/* Approved wizard B; scoped to the creation surface. */
export const ALBUM_WIZARD_CSS = ALBUM_SCENE_PICKER_CSS + String.raw`

.album-wizard { height: 100%; display: grid; grid-template-columns: 208px minmax(0, 1fr); position: relative; font-family: "Pretendard Variable", Pretendard, system-ui, sans-serif; }
.album-wizard[data-skin="film"] { --house: #070708; --screen: #0f1012; --screen-2: #16171a; --screen-3: #1e1f23; --rule: #222328; --rule-2: #33353b; --ink: #ebe8e2; --ink-2: #b3afa7; --ink-3: #8b8881; --accent: #dba35a; --accent-ink: #1b1308; --accent-soft: rgba(219,163,90,.12); --sub: #f4ecd0; --ok: #8fbf9a; --r: 4px; --r-lg: 6px; background: var(--house); color: var(--ink); }
.album-wizard[data-skin="phone"] { --accent:var(--tungsten); --accent-ink:var(--tungsten-ink); --accent-soft:var(--tungsten-dim); --r:10px; --r-lg:14px; background:transparent; color:var(--ink); font-family:-apple-system,"Pretendard Variable",Pretendard,sans-serif; }
.album-wizard ::selection { background: var(--accent); color: var(--accent-ink); }
.album-wizard .wizard-main { position: relative; min-width: 0; display: grid; grid-template-rows: auto auto auto; width:100%; }
.album-wizard .scroll { min-width:0; }
.album-wizard .chat { content-visibility:auto; contain-intrinsic-block-size:auto 90px; }
.album-wizard .whead { display: flex; align-items: center; gap: 12px; min-height: 72px; padding: 12px 24px; border-bottom: 1px solid var(--rule); }
.album-wizard .whead .x { width: 36px; height: 36px; margin-left: -8px; display: grid; place-items: center; border-radius: 50%; color: var(--ink-2); }
.album-wizard .whead .x:hover { background: var(--screen-3); }
.album-wizard .whead b { font-size: 15px; font-weight: 600; }
.album-wizard .whead .count { margin-left: auto; font-size: 13px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.album-wizard[data-skin="phone"] .whead { background:var(--house); border-bottom:0; }
.album-wizard .strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 14px 24px 0; }
.album-wizard .strip button { appearance: none; border: 0; background: none; padding: 0; text-align: left; font: inherit; color: var(--ink-3); cursor: pointer; }
.album-wizard .strip i { display: block; height: 3px; border-radius: 2px; background: var(--rule-2); margin-bottom: 8px; }
.album-wizard .strip .done i, .album-wizard .strip .on i { background: var(--accent); }
.album-wizard .strip span { font-size: 14px; }
.album-wizard .strip .on span { color: var(--ink); font-weight: 600; }
.album-wizard .body { display: grid; min-width:0; }
.album-wizard .body--B { grid-template-columns: minmax(0, 1fr) 300px; }
.album-wizard .pane { padding: 34px 40px 48px; max-width: 760px; width: 100%; }
.album-wizard .body--B .pane { justify-self: center; max-width: 700px; }
.album-wizard .pane h2 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: -.01em; text-wrap: balance; }
.album-wizard[data-skin="film"] .pane h2 { font-weight: 300; font-size: 27px; }
.album-wizard[data-skin="phone"] .pane h2 { font-size: 28px; font-weight: 700; letter-spacing: -.02em; }
.album-wizard .pane .lead { margin: 8px 0 26px; color: var(--ink-3); font-size: 14px; max-width: 60ch; }
.album-wizard .peek { border-left: 1px solid var(--rule); padding: 28px 24px; display: grid; align-content: start; gap: 18px; position: sticky; top: 70px; align-self:start; }
.album-wizard .peek h3 { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--ink-3); }
.album-wizard .peek .cover { width: 168px; aspect-ratio: 4/5; position: relative; border-radius: 4px; overflow: hidden; box-shadow: 0 16px 34px -18px rgba(0,0,0,.6); justify-self: center; }
.album-wizard .spine { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule); }
.album-wizard .spine li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--rule); font-size: 13px; color: var(--ink-2); }
.album-wizard .spine li span:last-child { color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.album-wizard .spine li.off { color: var(--ink-3); text-decoration: line-through; text-decoration-color: var(--rule-2); }
.album-wizard .peek .tot { font-size: 13px; color: var(--ink-2); }
.album-wizard .peek .tot b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
.album-wizard .foot { position:relative;z-index:1;display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-top: 1px solid var(--rule); background: var(--house); }
.album-wizard .foot .sum { display:none; font-size: 13px; color: var(--ink-3); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.album-wizard .foot .sum b { color: var(--ink-2); font-weight: 600; font-variant-numeric: tabular-nums; }
.album-wizard .btn { appearance: none; border: 0; font: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 44px; padding: 0 20px; border-radius: var(--r); font-size: 15px; font-weight: 600; white-space: nowrap; }
.album-wizard .btn--go { margin-left: auto; background: var(--accent); color: var(--accent-ink); min-width: 120px; }
.album-wizard .btn--go:hover { filter: brightness(1.06); }
.album-wizard .btn--ghost { background: transparent; color: var(--ink-2); padding: 0 14px; }
.album-wizard .btn--ghost:hover { background: var(--screen-3); }
.album-wizard .btn[disabled] { opacity: .4; cursor: default; }
.album-wizard[data-skin="phone"] .btn { border-radius: 999px; }
.album-wizard[data-skin="phone"] .foot { background: var(--house); border-top-color: transparent; box-shadow: 0 -1px 0 var(--rule); }
.album-wizard :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.album-wizard .list { display: grid; border-top: 1px solid var(--rule); }
.album-wizard[data-skin="phone"] .list { border: 0; background: var(--screen); border-radius: var(--r-lg); overflow: hidden; }
.album-wizard .chat { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 4px 14px; align-items: center; padding: 14px 4px; border-bottom: 1px solid var(--rule); cursor: pointer; }
.album-wizard[data-skin="phone"] .chat { padding: 12px 16px; }
.album-wizard[data-skin="phone"] .chat:last-child { border-bottom: 0; }
.album-wizard .chat:hover { background: var(--screen-2); }
.album-wizard .mono { grid-row: span 2; width: 44px; height: 44px; border-radius: var(--r); display: grid; place-items: center; background: var(--screen-3); color: var(--ink-2); font-size: 15px; font-weight: 600; }
.album-wizard[data-skin="phone"] .mono { border-radius: 50%; }
.album-wizard .chat b { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; gap: 8px; align-items: center; }
.album-wizard .chat small { grid-column: 2; font-size: 12.5px; color: var(--ink-3); }
.album-wizard .chat small span { white-space: nowrap; }
.album-wizard .pair-heading{margin:30px 0 14px;font-size:18px;font-weight:650;color:var(--ink)}
.album-wizard .chat.pair{grid-template-columns:minmax(0,1fr) auto}.album-wizard .pair small{grid-column:1}.album-wizard .pair .radio{grid-column:2;grid-row:1/3}
.album-wizard .pill { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 99px; font-size: 11px; font-weight: 600; background: var(--accent-soft); color: var(--accent); white-space: nowrap; flex: none; }
.album-wizard[data-skin="phone"] .pill { color: var(--accent-text); }
.album-wizard .pill i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.album-wizard .radio { grid-row: span 2; width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid var(--rule-2); display: grid; place-items: center; }
.album-wizard .sel .radio { border-color: var(--accent); }
.album-wizard .sel .radio::after { content: ""; width: 12px; height: 12px; border-radius: 50%; background: var(--accent); }
.album-wizard .hint { margin: 14px 0 0; font-size: 12.5px; color: var(--ink-3); }
.album-wizard .blk { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 2px 16px; align-items: center; padding: 14px 4px; border-bottom: 1px solid var(--rule); }
.album-wizard[data-skin="phone"] .blk { padding: 12px 16px; }
.album-wizard[data-skin="phone"] .list .blk:last-child { border-bottom: 0; }
.album-wizard .blk > b { grid-column:1;grid-row:1; font-size: 15px; font-weight: 600; }
.album-wizard .blk p { grid-column: 1;grid-row:2; margin: 0; font-size: 12.5px; color: var(--ink-3); }
.album-wizard .blk .n { grid-column:2;grid-row:1/3; font-size: 13px; color: var(--ink-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.album-wizard .blk.off b, .album-wizard .blk.off .n { color: var(--ink-3); }
.album-wizard .sw { grid-column:3;grid-row:1/3; position: relative; width: 46px; height: 28px; border-radius: 99px; background: var(--rule-2); cursor: pointer; transition: background .18s cubic-bezier(.2,.8,.2,1); border: 0; padding: 0; }
.album-wizard .sw::after { content: ""; position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .18s cubic-bezier(.2,.8,.2,1); }
.album-wizard .sw[aria-checked="true"] { background: var(--accent); }
.album-wizard[data-skin="phone"] .sw[aria-checked="true"] { background: #34c759; }
.album-wizard .sw[aria-checked="true"]::after { transform: translateX(18px); }
.album-wizard .sw[disabled] { opacity: .45; cursor: default; }
.album-wizard .block-lock { grid-column:3;grid-row:1/3;white-space:nowrap; font-size: 12px; color: var(--ink-3); width: 46px; text-align: center; }
.album-wizard .group-h { margin: 26px 0 8px; font-size: 13px; font-weight: 600; color: var(--ink-3); }
.album-wizard[data-skin="phone"] .group-h { margin-left: 16px; font-weight: 500; text-transform: none; }
.album-wizard .group-h:first-child { margin-top: 0; }
.album-wizard .per { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 14px; padding:12px 14px;border-radius:12px;background:var(--screen-2);margin:20px 0 6px; }
.album-wizard .per label { font-size: 14px; font-weight: 600; }
.album-wizard .step { height:44px; min-height:44px; padding:0; margin:0; gap:0; display: inline-flex; align-items: center; border: 1px solid var(--rule-2); border-radius: var(--r); overflow: hidden; }
.album-wizard[data-skin="phone"] .step { border-radius: 999px; }
.album-wizard .step button { appearance: none; border: 0; background: none; width: 40px; height: 36px; font-size: 18px; color: var(--ink-2); cursor: pointer; font-family: inherit; }
.album-wizard .step button:hover { background: var(--screen-3); }
.album-wizard .step output { min-width: 34px; text-align: center; font-weight: 650; font-variant-numeric: tabular-nums; }
.album-wizard .per small { flex-basis: 100%; font-size: 12.5px; color: var(--ink-3); }
.album-wizard .per .reset { margin-left: auto; font-size: 13px; color: var(--accent); background: none; border: 0; cursor: pointer; font-family: inherit; padding: 6px 0; }
.album-wizard[data-skin="phone"] .per .reset { color: var(--accent-text); }
.album-wizard .themes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.album-wizard .th { appearance: none; border: 0; background: none; padding: 0; text-align: left; font: inherit; color: inherit; cursor: pointer; display: grid; gap: 10px; }
.album-wizard .th .mcw { position: relative; aspect-ratio: 4/5; border-radius: 4px; overflow: hidden; outline: 1px solid var(--rule); outline-offset: 0; transition: outline-color .15s, transform .2s cubic-bezier(.2,.8,.2,1); box-shadow: 0 12px 28px -18px rgba(0,0,0,.6); }
.album-wizard .th:hover .mcw { transform: translateY(-2px); }
.album-wizard .th.sel .mcw { outline: 2px solid var(--accent); outline-offset: 3px; }
.album-wizard .th > b { font-size: 14.5px; font-weight: 600; display: flex; gap: 6px; align-items: center; }
.album-wizard .th > small { font-size: 12px; color: var(--ink-3); line-height: 1.45; }
.album-wizard .th .def { font-size: 11px; font-weight: 600; color: var(--ink-3); border: 1px solid var(--rule-2); border-radius: 4px; padding: 0 5px; }
.album-wizard .tints { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 22px; }
.album-wizard .tints > span { font-size: 13px; color: var(--ink-3); margin-right: 4px; }
.album-wizard .tint { width: 34px; height: 34px; border-radius: 50%; border: 0; cursor: pointer; position: relative; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
.album-wizard .tint.sel { box-shadow: 0 0 0 2px var(--house), 0 0 0 4px var(--accent); }
.album-wizard .filmnote { display: flex; gap: 12px; margin-top: 22px; padding: 14px 16px; border-radius: var(--r-lg); background: var(--screen-2); border: 1px solid var(--rule); font-size: 13.5px; color: var(--ink-2); }
.album-wizard .filmnote .ico { color: var(--accent); margin-top: 2px; }
.album-wizard .filmnote b { color: var(--ink); font-weight: 600; }
.album-wizard .field { margin-top: 26px; display: grid; gap: 6px; max-width: 460px; }
.album-wizard .field label { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.album-wizard .field input { height: 44px; padding: 0 14px; border-radius: var(--r); border: 1px solid var(--rule-2); background: var(--screen); color: var(--ink); font: inherit; font-size: 15px; caret-color: var(--accent); }
.album-wizard .field input:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent; }
.album-wizard .field small { font-size: 12px; color: var(--ink-3); }
@container (max-width: 640px) {.album-wizard { grid-template-columns: 1fr; }
.album-wizard .whead { padding: 0 16px; height: 52px; }
.album-wizard .strip { padding: 10px 16px 0; }
.album-wizard .strip span { font-size: 14px; }
.album-wizard .body--B { grid-template-columns: 1fr; }
.album-wizard .pane { padding: 22px 16px 28px; }
.album-wizard[data-skin="film"] .pane h2 { font-size: 24px; }
.album-wizard[data-skin="phone"] .pane h2 { font-size: 26px; }
.album-wizard .pane .lead { margin-bottom: 20px; font-size: 13.5px; }
.album-wizard .foot { padding: 10px 16px 16px; }
.album-wizard .foot .sum { display:block;white-space:normal;flex:1;font-size:12px }
.album-wizard .foot .btn--go { min-width:80px;padding:0 14px }
.album-wizard .foot.b .peekbtn { display: inline-flex; }
.album-wizard .themes { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 14px; }
.album-wizard .per small { order: 3; }
}
.album-wizard .peekbtn { display: none; align-items: center; gap: 6px; height: 44px; padding: 0 12px; border-radius: var(--r); background: var(--screen-3); color: var(--ink-2); font-size: 13px; font-weight: 600; border: 0; font-family: inherit; white-space: nowrap; font-variant-numeric: tabular-nums; }
.album-wizard[data-skin="phone"] .peekbtn { border-radius: 999px; }
@media (prefers-reduced-motion: reduce) {.album-wizard * { transition: none !important; } }

.album-wizard{display:block;min-width:0;max-width:100%;container-type:inline-size;word-break:keep-all;overflow-wrap:anywhere}
.album-wizard *{box-sizing:border-box}
.main:has(> .page > .album-wizard){padding:0;max-width:none;justify-self:stretch}
.album-wizard .pane h2{outline:none}
.album-wizard .wizard-main{margin:0;padding:0;max-width:none;grid-template-columns:1fr;border:0;background:transparent}
.album-wizard .body{align-items:start}
.album-wizard .peek{height:max-content}
.album-wizard .album-shelf-mc{position:absolute;inset:0;width:100%;height:100%}
.album-wizard .whead .phone-back{display:none}
.album-wizard .whead button{border:0;background:transparent;min-width:44px;min-height:44px}
.album-wizard .strip button{min-height:44px}
.album-wizard .sw::before{content:"";position:absolute;inset:-8px 0}
.album-wizard .step button{width:44px;height:44px}
.album-wizard .reset,.album-wizard .more-lines{min-height:44px;display:flex;align-items:center}
.album-wizard .chat{min-height:72px}
.album-wizard .chat b{flex-wrap:wrap;white-space:normal}
.album-wizard input.radio{appearance:auto;accent-color:var(--accent);margin:0;flex:none}
.album-wizard .radio::after{display:none}
.album-wizard .tint{width:44px;height:44px;background:var(--swatch);border:5px solid var(--house)}
.album-wizard .sr-only{position:absolute;width:1px;height:1px;opacity:0}
.album-wizard label:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:3px}
.album-wizard .wizard-sheet{position:fixed;inset:auto 0 0;max-height:90dvh;overflow:auto;z-index:20;background:var(--house);border:1px solid var(--rule-2);border-radius:16px 16px 0 0;box-shadow:0 -14px 40px #0005;padding:12px 20px}
.album-wizard .wizard-sheet .peek{display:grid;border:0;padding:12px 0}
.album-wizard .tot{margin:0}
@container(max-width:640px){
.album-wizard .whead .desktop-close,.album-wizard .previous{display:none}
.album-wizard .whead .phone-back{display:grid}
.album-wizard .body--B{grid-template-columns:minmax(0,1fr)}
.album-wizard .peek{display:none}
.album-wizard .whead{padding-inline:16px}
.album-wizard .themes{grid-template-columns:repeat(2,minmax(0,1fr))}
}
.page:has(.album-wizard){padding:0;max-width:none}
.main:has(> .page > .album-wizard) > .subnav{display:none}
/* The wizard shares the document scroll; the summary follows it without a nested scroller. */
.album-wizard .foot{position:sticky;bottom:0}
/* The title and step strip stay right under the dashboard top bar (film 50/54px, phone 48px or the floating pill ending at 62px). */
.album-wizard{--wz-top:50px}
:root[data-skin=phone] .album-wizard{--wz-top:48px}
@media(min-width:900px){
.album-wizard{--wz-top:54px}
:root[data-skin=phone] .album-wizard{--wz-top:62px;padding-top:14px}
}
.album-wizard .wizard-main>div:first-child{position:sticky;top:var(--wz-top);z-index:5;background:var(--house)}
.album-wizard .peek{top:calc(var(--wz-top) + 130px)}
.album-wizard .strip button:disabled{opacity:1;color:var(--ink-3)}
.album-wizard .strip .on{color:var(--ink)}
@container(max-width:640px){.album-wizard .foot{flex-wrap:wrap}.album-wizard .foot .sum{flex-basis:100%}}
@media(max-width:899px){
.app:has(.album-wizard){--nav-clearance:0px}
.app:has(.album-wizard)>.nav{display:none}
}


.album-wizard .body--pair .pane h2{font-size:26px;font-weight:700;letter-spacing:-.02em}
.album-wizard .pair-chosen{display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:18px;border-radius:12px;background:var(--screen);font-size:13.5px;color:var(--ink-2)}
.album-wizard .pair-chosen b{color:var(--ink)}
.album-wizard .pair-change{margin-left:auto;flex:none;min-height:40px;padding:0 10px;color:var(--accent-text,var(--accent));border-radius:8px;font-size:13px;font-weight:600}
.album-wizard .pair-list .pair{display:flex;align-items:center;gap:12px;min-height:64px;padding:10px 16px}
.album-wizard .pair-faces{display:flex;flex:none}
.album-wizard .pair-face{display:grid;place-items:center;width:30px;height:30px;overflow:hidden;border-radius:50%;border:2px solid var(--screen);background:var(--accent-soft);color:var(--ink);font-size:12px;font-weight:650}
.album-wizard .pair-face+.pair-face{margin-left:-9px}
.album-wizard .pair-face img{width:100%;height:100%;object-fit:cover}
.album-wizard .pair-copy{min-width:0;flex:1}
.album-wizard .pair-copy b{display:block;font-size:15px;font-weight:650}
.album-wizard .pair-copy small{display:block;margin-top:2px;font-size:12.5px;color:var(--ink-3)}
.album-wizard .pair-me{display:inline-flex;align-items:center;height:18px;padding:0 6px;margin-left:6px;border-radius:5px;background:var(--accent-soft);color:var(--accent-text,var(--accent));font-size:11px;font-weight:700;vertical-align:2px}
.album-wizard .pair-hidden{margin-top:12px;font-size:12.5px;color:var(--ink-3)}
@container(max-width:640px){.album-wizard .body--pair .pane{padding:24px 16px 28px}.album-wizard .pair-chosen{flex-wrap:wrap}.album-wizard .pair-list .pair{padding:10px 12px}}
`;
