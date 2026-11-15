import { ALBUM_UPDATE_CSS } from "./album-update-css.js";
// Like the shell reset, keep defaults below component selectors. Explicit album roots and
// @scope proximity beat host button/button:hover rules in every state, including late styles.
export const ALBUM_CONTROLS_CSS = `
:is(.album-shelf,.album-wizard,.album-view,.ap-dialog) :is(button,summary):where(:not(:hover),:hover,:focus-visible,:active,:disabled){
 appearance:none;background:transparent;color:inherit;border:0;border-radius:0;box-shadow:none;font:inherit;padding:0;cursor:pointer
}
:is(.album-shelf,.album-wizard,.album-view,.ap-dialog) :is(button,summary):where(:focus-visible){outline:2px solid var(--focus,var(--accent,#2f6fd6));outline-offset:3px}
:is(.album-shelf,.album-wizard,.album-view,.ap-dialog) :is(button,summary):where(:active){filter:brightness(.95)}
:is(.album-shelf,.album-wizard,.album-view,.ap-dialog) :is(button,summary):where(:disabled){cursor:default}
/* Album shelves share the dashboard ground and toolbar treatment. */
.app .main:has(.album-shelf,.album-wizard),.app .page:has(.album-shelf,.album-wizard),.app .album-shelf,.app .album-wizard{background:transparent}
`;
export const ALBUM_VIEW_CSS = `
.album-view{position:fixed;inset:0;z-index:30;background:var(--house,#0f1012);color:var(--ink,#ebe8e2);font:14px/1.5 "Pretendard Variable",sans-serif;word-break:keep-all;container-type:inline-size}
.app .album-view{left:208px}
@media(min-width:900px){.app .album-view[data-skin=phone]{left:252px}}
.album-view *{box-sizing:border-box}
.album-view button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;min-height:44px}
.album-view button:focus-visible,.album-view [tabindex]:focus-visible{outline:2px solid var(--tungsten,#007aff);outline-offset:3px}
.av-base{height:100%;display:grid;grid-template-rows:56px minmax(0,1fr)}
.av-head{display:flex;align-items:center;gap:6px;padding:0 16px 0 12px;z-index:4}
.album-view .i{width:20px;height:20px;flex:none}
.album-view .av-back{display:inline-flex;align-items:center;gap:2px;padding:0 10px 0 4px;color:var(--ink-2);flex:none}
.av-title{min-width:0;flex:1;display:flex;align-items:baseline;gap:10px;padding-left:12px;border-left:1px solid var(--rule-2);margin-left:4px}
.av-title b{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.av-title small{font-size:12px;color:var(--ink-3);white-space:nowrap}
.album-view .av-icon{width:44px;display:grid;place-items:center;border-radius:4px;flex:none}
.album-view .av-icon:hover,.album-view .av-back:hover{background:var(--screen-3)}
.album-view .av-toc-trigger{display:inline-flex;align-items:center;gap:7px;padding:0 12px;border:1px solid var(--rule-2);border-radius:4px;max-width:260px;white-space:nowrap}
.album-view .av-head>button{height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 12px;border-radius:4px}
.av-toc-trigger .i,.av-pill .i{transform:rotate(90deg);width:16px;height:16px}
.av-toc-trigger .av-current{overflow:hidden;text-overflow:ellipsis;color:var(--ink-3)}
.av-scroll{overflow:auto;min-height:0;min-width:0;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--rule-2) transparent}
.album-view .av-pill{display:none}
.av-status{padding:20px}
.av-pop{position:absolute;right:16px;top:56px;width:292px;max-width:calc(100% - 24px);max-height:calc(100% - 72px);overflow:auto;z-index:30;padding:8px;background:var(--screen-2,#16171a);border:1px solid var(--rule-2,#333);border-radius:6px;box-shadow:0 24px 50px -18px #0008}
.av-pop--toc{right:66px}
.av-pop--menu{width:236px}
.av-pop-head{display:flex;align-items:center;justify-content:space-between;padding-left:10px}
.av-pop h3{font-size:12px;font-weight:600;color:var(--ink-3);margin:0}
.av-toc{list-style:none;padding:0;margin:0}
.album-view .av-toc button{display:grid;grid-template-columns:28px minmax(0,1fr);gap:4px;align-items:center;text-align:left;padding:8px 10px;width:100%;border-radius:4px;color:var(--ink-2)}
.av-toc i{font:500 11px "Archivo",sans-serif;color:var(--ink-3);font-variant-numeric:tabular-nums}
.av-toc span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.album-view .av-toc .is-current{background:var(--tungsten-dim,#ffffff0c);color:var(--ink);font-weight:600}
.av-toc button:hover,.av-menu button:hover{background:var(--screen-3)}
.av-menu button{width:100%;display:flex;align-items:center;gap:10px;padding:0 12px;text-align:left}
.av-menu hr{border:0;border-top:1px solid var(--rule);margin:6px 4px}
.album-view .av-danger{color:var(--cut,#e36b65)}
.av-scrim{position:absolute;inset:0;z-index:25}
.av-export-scrim{background:#0006}
.av-export{inset:50% auto auto 50%;transform:translate(-50%,-50%);width:420px;padding:24px;border-radius:14px}
.av-export h3{font-size:18px;color:var(--ink);margin:0 0 20px}
.av-export fieldset{border:0;padding:0;margin:0;display:grid;gap:8px}
.av-export label{display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 12px;border:1px solid var(--rule-2);border-radius:8px;cursor:pointer}
.av-export label:has(:checked){border-color:var(--accent,var(--tungsten));background:var(--tungsten-dim,#007aff0c)}
.av-export input{accent-color:var(--accent,var(--tungsten));width:18px;height:18px;flex:none}
.av-export input:focus-visible{outline:2px solid var(--accent,var(--tungsten));outline-offset:4px}
.av-export-note{font-size:12px;line-height:1.65;color:var(--ink-2);margin:16px 0 0}
.av-export-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.album-view .av-export-actions button{padding:0 20px;border-radius:8px;border:1px solid var(--rule-2)}
.album-view .av-export-save{background:var(--accent,var(--tungsten,#2e6a5d));color:var(--tungsten-ink,#fff);border-color:transparent}
.av-board{width:480px}.av-board p{line-height:1.65}.av-board-addresses{margin-top:20px;border-top:1px solid var(--rule-2);padding-top:8px}.av-board-addresses summary{min-height:44px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;color:var(--ink);list-style:none}.av-board-addresses summary::-webkit-details-marker{display:none}.av-board-addresses summary::after{content:"";width:7px;height:7px;margin-right:6px;border-right:1.5px solid var(--ink-2);border-bottom:1.5px solid var(--ink-2);transform:rotate(45deg)}.av-board-addresses[open] summary::after{transform:rotate(-135deg)}.av-board-addresses label{display:block;padding:10px 0;border:0;border-bottom:1px solid var(--rule)}.av-board-addresses label span{display:block;font-size:12px;color:var(--ink-2);margin-bottom:6px}.av-board-addresses input{width:100%;height:44px;padding:8px;background:var(--screen);color:var(--ink);border:1px solid var(--rule-2);border-radius:6px;font:inherit}.av-board-code{width:100%;height:150px;resize:vertical;background:var(--screen);color:var(--ink);border:1px solid var(--rule-2);padding:10px}.album-view .av-board .av-export-actions{flex-wrap:wrap}.album-view .av-board .av-export-actions button{padding:0 12px}.av-board button:disabled{opacity:.45;cursor:default}
.av-export[aria-busy=true] .av-export-save{cursor:progress}
.av-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%)}
.av-lightbox{position:absolute;inset:0;width:100%;max-width:100%;min-width:0;grid-template-columns:minmax(0,1fr);z-index:40;background:#0b0b0c;color:#f1eee8;display:grid;grid-template-rows:56px minmax(0,1fr) auto}
.av-lb-top{display:flex;align-items:center;justify-content:space-between;padding:0 8px 0 20px;color:#a9a59d;font-variant-numeric:tabular-nums}
.av-lb-top,.av-lb-bottom{min-width:0;max-width:100%}
.av-stage{min-width:0;grid-template-columns:minmax(0,1fr);min-height:0;position:relative;display:grid;place-items:center;padding:8px 88px;touch-action:pan-y}
.av-stage img{width:100%;max-width:100%;min-width:0;height:100%;min-height:0;object-fit:contain;display:block;filter:drop-shadow(0 30px 60px #0009)}
.album-view .av-arrow{position:absolute;top:50%;transform:translateY(-50%);width:48px;height:48px;display:grid;place-items:center;background:#ffffff14;border-radius:50%}
.av-prev{left:16px}.av-next{right:16px}
.av-caption{padding:16px 24px 8px;text-align:center}.av-caption p{margin:0;font-size:15px}.av-caption small{display:block;color:#a9a59d;font-size:12px;margin-top:3px}
.av-thumbs{display:flex;gap:6px;padding:10px 24px 20px;overflow-x:auto;overflow-y:hidden;width:100%;min-width:0;max-width:100%;scrollbar-width:thin}
.av-thumbs::before,.av-thumbs::after{content:"";margin:auto}
.album-view .av-thumbs button{flex:none;width:52px;height:44px;min-height:44px;padding:0;opacity:.45;background:#222;border-radius:3px;overflow:hidden}
.av-thumbs img{width:100%;height:100%;object-fit:cover}.album-view .av-thumbs .is-current{opacity:1;outline:2px solid #f1eee8;outline-offset:2px}
.av-dots{display:none;justify-content:center;gap:6px;padding:6px 20px 26px;flex-wrap:wrap}.av-dots i{width:6px;height:6px;border-radius:50%;background:#ffffff47}.av-dots .is-current{background:#f1eee8}
.album-view[data-skin=phone] .av-back,.album-view[data-skin=phone] .av-head .av-icon{color:var(--accent-text,#0066d6)}
.album-view[data-skin=phone] .av-toc-trigger{border-radius:999px}
.film:has(.album-view)::after{display:none}
body:has(.album-view){overflow:hidden}
@media(max-width:899px){.app .album-view{left:0}.app:has(.album-view)>.nav,.app:has(.album-view)>.topbar{display:none}}
@container(max-width:640px){
.av-base{grid-template-rows:52px minmax(0,1fr)}.av-head{padding:0 6px 0 2px;gap:0}.av-title{border:0;padding:0;margin:0;justify-content:center}.av-title b{font-size:16px}.av-title small,.album-view .av-toc-trigger{display:none}
.av-scroll{padding-bottom:80px}
.album-view .av-head .av-toc-trigger{display:none}
.album-view .av-pill{position:absolute;z-index:20;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translateX(-50%);display:inline-flex;align-items:center;gap:8px;max-width:calc(100% - 32px);height:44px;padding:0 16px;border-radius:999px;background:#141416e8;color:#f4f2ee;box-shadow:0 10px 28px -10px #0009}
.av-pill .av-current{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.av-pill i{font:500 11px "Archivo",sans-serif;opacity:.7}
.album-view[data-skin=phone] .av-pill{background:#fffffff0;color:#1c1c1e;box-shadow:0 8px 26px -8px #0005}
.av-pop{inset:auto 0 0;width:auto;max-width:none;max-height:72%;border-radius:16px 16px 0 0;padding:8px 12px max(24px,env(safe-area-inset-bottom));background:var(--screen)}
.av-pop::before{content:"";display:block;width:36px;height:5px;border-radius:3px;background:var(--rule-2);margin:0 auto 10px}
.album-view .av-board .av-export-actions button{font-size:12px;padding:0 8px}
.av-export{transform:none;padding:12px 20px max(24px,env(safe-area-inset-bottom))}.av-export-actions button{flex:1}
.av-scrim{background:#0006}.album-view .av-toc button{font-size:16px}
.av-lightbox{grid-template-rows:52px minmax(0,1fr) auto}.av-stage{padding:0}.album-view .av-arrow,.av-thumbs{display:none}.av-dots{display:flex}.av-caption{padding:14px 20px 4px}
}
@media(prefers-reduced-motion:reduce){.album-view *{scroll-behavior:auto!important}}

.av-export-done{width:min(440px,calc(100% - 24px))}
.av-export-done .av-pop-head{padding:0;margin-bottom:16px;gap:8px}.av-export-done .av-pop-head h3{margin:0;flex:1}
.av-export-result{display:flex;gap:12px;align-items:center;margin-bottom:14px}
.av-export-check{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--ok-dim,#e3f4e7);color:var(--ok,#248a3d);font-size:18px}
.av-export-result b{display:block;font-size:15px}.av-export-result small{display:block;color:var(--ink-2);font-size:12.5px;overflow-wrap:anywhere}
.av-export-link{display:flex;align-items:center;gap:8px;padding:0 6px 0 12px;min-height:44px;border-radius:12px;background:var(--screen-2);border:1px solid var(--rule)}
.album-view .av-export-link input{width:0;min-width:0;flex:1;height:36px;border:0;background:transparent;color:var(--ink-2);font:13px/1.4 ui-monospace,monospace;user-select:text}
.album-view .av-export-link button{height:34px;min-height:34px;flex:none;padding:0 14px;border-radius:9px;font-size:13.5px;font-weight:650;background:var(--tungsten);color:var(--tungsten-ink)}
.av-export-path{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px 8px;margin-top:16px;font-size:12.5px;color:var(--ink-2)}
.av-export-path label{grid-column:1/-1;padding:0;border:0;min-height:0;font-size:12px;color:var(--ink-2)}
.av-export-path textarea{resize:vertical;width:100%;min-width:0;border:1px solid var(--rule-2);border-radius:8px;background:var(--screen-2);color:var(--ink-2);padding:8px;font:12px/1.5 ui-monospace,monospace;user-select:text;overflow-wrap:anywhere}
.album-view .av-export-path button{padding:0 10px;border-radius:8px;background:var(--screen-2);color:var(--ink)}
.av-export-done :is(input,textarea){-webkit-user-select:text}
@container(max-width:640px){.av-export-done{inset:auto 0 0;width:auto;transform:none;max-height:92%;overflow:auto}}
` + ALBUM_UPDATE_CSS;

/** Skin chrome is shared; album paper remains inside its own reading scope. */
export const ALBUM_SCREEN_CSS = `
.album-view .screen-bar{grid-column:1/-1;grid-row:1}
.au-screen{position:absolute;inset:0;z-index:40;isolation:isolate;display:grid;grid-template-rows:56px minmax(0,1fr);background:var(--house)}
.au-screen>.au-picker{position:relative;z-index:auto;inset:auto;min-height:0;min-width:0}
:root[data-skin=phone] :is(.album-wizard,.au-picker){--ink-3:var(--ink-2)}
:root[data-skin=phone] .album-wizard{background:transparent;--wz-top:62px;padding-top:14px}
:root[data-skin=phone] .album-wizard .whead{background:transparent}
:root[data-skin=phone] .album-wizard :is(.wizard-main>div:first-child,.foot){background:var(--house)}
:root[data-skin=phone] .album-view,:root[data-skin=phone] .au-screen{background:var(--house)}
:root[data-skin=phone] .album-view :is(.av-base,.ae-base,.au-screen){grid-template-rows:0 minmax(0,1fr)}
:root[data-skin=phone] .album-view .screen-bar{grid-row:1;grid-column:1/-1;position:sticky;z-index:20;flex-shrink:0;min-width:0}
:root[data-skin=phone] .album-view :is(.av-scroll,.ae-scroll){padding-top:76px;background:transparent}
:root[data-skin=phone] .album-view .ae-panel{margin-top:76px}
:root[data-skin=phone] .au-screen>.au-picker{padding-top:76px;background:transparent}
:root[data-skin=phone] .au-screen .au-foot{background:transparent}
@container(max-width:767px){:root[data-skin=phone] .album-view .ae-base{grid-template-rows:0 minmax(0,1fr) auto}}
`;
