import { ALBUM_PHOTO_TOOLS_CSS } from "./album-photo-tools.js";
import { ALBUM_CONFIRM_CSS } from "./album-confirm.js";
import { ALBUM_LINE_PICKER_CSS } from "./album-line-picker.js";
/** Chrome stays outside the dashboard's album boundary. Only the second sheet styles the book. */
export const ALBUM_EDIT_CSS = ALBUM_LINE_PICKER_CSS + ALBUM_CONFIRM_CSS + `

.album-edit{--ae-pop-bg:#111214;--ae-pop-ink:#ecebe8;--ae-pop-muted:#aaa8a2;--ae-pop-rule:#33363c;--ae-pop-hover:#202226;--ae-pop-input:#17181b;--ae-pop-selected:#ecebe8;--ae-pop-selected-ink:#111214;--ae-pop-accent:#dba35a;--ae-pop-accent-ink:#1b1308;--ae-pop-shadow:0 16px 40px -20px #0009}
:root:not([data-theme=night]) .album-edit[data-skin=phone]{--ae-pop-bg:#fff;--ae-pop-ink:#1c1c1e;--ae-pop-muted:#5b5b61;--ae-pop-rule:#d1d1d6;--ae-pop-hover:#f2f2f7;--ae-pop-input:#f7f7fa;--ae-pop-selected:var(--tungsten);--ae-pop-selected-ink:var(--tungsten-ink);--ae-pop-accent:#0066d6;--ae-pop-accent-ink:#fff;--ae-pop-shadow:0 14px 34px -18px #0004}
.album-edit{--ae-accent:var(--tungsten,var(--ae-pop-accent));--ae-accent-ink:var(--tungsten-ink,var(--ae-pop-accent-ink));--ae-radius:6px}
.album-edit[data-skin=phone]{--ae-radius:12px}
.ae-base{height:100%;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:56px minmax(0,1fr);position:relative;z-index:0}
.ae-base.ae-has-panel{grid-template-columns:minmax(0,1fr) 320px}
.ae-head{grid-column:1/-1;display:flex;align-items:center;gap:4px;padding:0 12px 0 16px;z-index:6;min-width:0}
.album-edit button{min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:var(--ae-radius);padding:0 10px;font-size:13px}
.album-edit button:where(:hover:not(:disabled)){background:var(--screen-3)}
.album-edit button:disabled{opacity:.38;cursor:default}
.album-edit button[hidden]{display:none}
.album-edit .ae-primary{background:var(--ae-accent);color:var(--ae-accent-ink);font-weight:600;padding:0 18px}
.album-edit .ae-primary:hover{background:var(--ae-accent);filter:brightness(1.05)}
.ae-title{min-width:0;flex:1;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.ae-title b{font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.ae-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-3)}
.ae-status::before{content:'';width:6px;height:6px;flex:none;border-radius:50%;background:#6fbf8b}
.ae-status[data-status=saving]::before{background:var(--ae-pop-accent)}
.ae-status[data-status=conflict]::before,.ae-status[data-status=error]::before{background:var(--cut,#e5806f)}
.ae-status[data-status=conflict],.ae-status[data-status=error]{color:var(--cut)}
.ae-scroll{position:relative;overflow:auto;min-height:0;min-width:0;padding:24px 0 120px;background:var(--house);scrollbar-width:thin;scrollbar-color:var(--rule-2) transparent;overscroll-behavior:contain}
.ae-panel{min-height:0;overflow:auto;background:var(--screen);border-left:1px solid var(--rule);scrollbar-width:thin}
.ae-psec{padding:18px;border-bottom:1px solid var(--rule)}
.ae-psec h3{margin:0 0 12px;font-size:12.5px;font-weight:600;color:var(--ink-3);display:flex;justify-content:space-between}
.ae-psec small{font-weight:400;color:var(--ink-3);font-size:12px}
.ae-themes{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.album-edit .ae-themes button{min-width:0;display:grid;padding:6px 6px 8px;border:1px solid var(--rule-2);background:var(--screen-2);text-align:left;justify-content:stretch;gap:7px}
.album-edit .ae-themes button[aria-pressed=true]{outline:2px solid var(--ae-accent);outline-offset:-1px}
.ae-mini{container-type:inline-size;position:relative;display:block;width:100%;aspect-ratio:4/5;overflow:hidden}
.ae-tints{display:flex;flex-wrap:wrap;gap:5px}
.album-edit .ae-tints button{border-radius:50%;background:var(--swatch);border:5px solid var(--screen);width:44px;height:44px}
.album-edit .ae-tints button[aria-pressed=true]{outline:2px solid var(--ink);outline-offset:-3px}
.ae-photo-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ae-photo-row img{width:44px;height:44px;object-fit:cover;border-radius:3px}
.ae-person{display:flex;align-items:center;gap:12px;min-height:56px}
.ae-person img,.ae-person-empty{width:44px;height:44px;border-radius:50%;object-fit:cover;flex:none}.ae-person-empty{background:var(--screen-3)}
.ae-person>div{flex:1;min-width:0}.ae-person b{font-size:14px;display:block;overflow-wrap:anywhere}.ae-person small{font-size:12px;color:var(--ink-3)}
.album-edit .ae-person button{height:34px;min-height:34px;padding:0 10px;border-radius:8px;font-size:12.5px;color:var(--accent-text,var(--ae-accent))}
.ae-person-menu{display:grid;gap:2px}.album-edit .ae-person-menu button{justify-content:flex-start}.ae-person-menu p{font-size:12px;margin:4px 0;color:var(--ink-3)}.ae-person-menu p:empty{display:none}
.ae-block-list{position:relative;list-style:none;margin:0;padding:0;display:grid;gap:2px}
.ae-block-list li{position:relative;display:flex;align-items:center;gap:4px;height:40px;min-width:0;padding:0 6px 0 2px;border-radius:8px;color:var(--ink-2);user-select:none}
.ae-block-list li:hover{background:var(--screen-3)}
.album-edit .ae-block-list button{min-height:36px;padding:0 6px}
.album-edit .ae-block-list button[data-drag-id]{min-width:28px;width:28px;height:32px;min-height:32px;color:var(--ae-pop-muted);touch-action:none}
.ae-block-list button[data-edit-action=select]{flex:1;justify-content:flex-start;min-width:0;text-align:left}
.ae-block-list .ae-off button[data-edit-action=select]{opacity:.5;text-decoration:line-through}
.ae-block-list li:has(button[aria-pressed=true]){background:var(--screen-3);color:var(--ink)}.album-edit .ae-block-list button[aria-pressed=true]{background:none}
.ae-block-list button[data-drag-id],.ae-tools button[data-drag-id]{cursor:grab}
.ae-tools{position:absolute;z-index:15;display:flex;align-items:center;gap:2px;padding:4px;border-radius:10px;background:var(--ae-pop-bg);color:var(--ae-pop-ink);border:1px solid var(--ae-pop-rule);box-shadow:var(--ae-pop-shadow);overflow-x:auto;white-space:nowrap;font:13px/1 'Pretendard Variable',sans-serif;transform:translateX(-50%);width:max-content}
.ae-tools[hidden]{display:none}.ae-tools b{font-size:12.5px;padding:0 6px}.album-edit .ae-tools button{flex:none;color:inherit;border-radius:7px}
.album-edit .ae-danger{color:var(--cut,#e5806f)}
.album-edit .ae-tools button:hover{background:var(--ae-pop-hover)}
.album-edit .ae-tools button{height:36px;min-height:36px;min-width:36px;padding:0 8px;border-radius:6px}
.ae-tools b{padding:0 10px 0 4px;font-size:13px;font-weight:600}
.ae-tools .ae-toolbar-grip{color:var(--ae-pop-muted);cursor:default}
.ae-tool-sep{width:1px;height:20px;background:var(--ae-pop-rule);margin:0 4px;flex:none}
.album-edit .ae-more,.album-edit .ae-tools .ae-more{color:var(--ae-pop-accent);font-weight:600}
.ae-more i{font-style:normal;display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:color-mix(in srgb,var(--ae-pop-accent) 15%,transparent);font-size:12px}
.ae-panel-add{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.album-edit .ae-panel-add button{height:40px;min-height:40px;display:flex;align-items:center;gap:8px;padding:0 12px;border-radius:8px;background:var(--screen-2);border:1px solid var(--rule-2);font-size:13px;color:var(--ink-2);justify-content:flex-start;min-width:0;text-align:left}
.album-edit .ae-panel-add button:hover{background:var(--screen-3);border-color:var(--rule-2);color:var(--ink)}
.ae-panel-add button em{margin-left:auto;font-style:normal;font-size:12px;color:var(--ae-pop-accent)}
.ae-sub{margin:14px 0 8px;font-size:12px;color:var(--ink-3)}
.album-edit .ae-memory-add button{color:var(--ink)}
.ae-dragging{opacity:.35}
.ae-drag-ind{position:absolute;left:6px;right:6px;height:3px;border-radius:2px;background:var(--ae-pop-accent);opacity:.55;pointer-events:none;z-index:2}
.ae-ghost{position:fixed;z-index:80;pointer-events:none;height:40px;display:flex;align-items:center;gap:8px;padding:0 12px;border-radius:8px;background:var(--ae-pop-hover);color:var(--ae-pop-ink);box-shadow:0 14px 30px -10px #000c;font-size:13.5px;transform:rotate(-1.5deg)}
.ae-drop-line{position:absolute;height:4px;border-radius:2px;background:var(--drop-accent,#2f6fd6);opacity:.35;pointer-events:none;z-index:10}
.ae-overlay:not(:empty){position:absolute;inset:0;z-index:50;isolation:isolate}
.ae-scrim{position:absolute;inset:0;background:#0007}
.ae-sheet{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(480px,calc(100% - 32px));max-height:86%;display:flex;flex-direction:column;background:var(--screen);color:var(--ink);border:1px solid var(--rule-2);border-radius:12px;box-shadow:0 24px 60px -20px #0009;overflow:hidden}
.album-edit .ae-block-sheet{border:0;border-radius:16px;padding:18px;box-shadow:0 18px 40px -20px #0006;width:min(420px,calc(100% - 32px))}.album-edit .ae-block-sheet>header{padding:0;min-height:32px;margin-bottom:8px}.album-edit .ae-block-sheet h2{font-size:17px;font-weight:700}.album-edit .ae-block-sheet>header button{width:36px;height:36px;min-width:36px;min-height:36px;border-radius:50%;display:grid;place-items:center;color:var(--ink-2);background:var(--screen-3)}.album-edit .ae-block-sheet .ae-sheet-body{padding:0}.album-edit .ae-block-sheet .ae-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0 12px}.album-edit .ae-block-sheet .ae-pair button{height:46px;min-height:46px;border-radius:12px;background:var(--screen-3);font-size:15px;font-weight:650;justify-content:center}.album-edit .ae-block-sheet .ae-pair button:disabled{color:#b4b4b8}.album-edit .ae-block-sheet .ae-action-group{border-radius:12px;background:var(--screen-2);overflow:hidden;display:block}.album-edit .ae-block-sheet .ae-action-group button{width:100%;height:50px;min-height:50px;display:flex;align-items:center;gap:12px;padding:0 16px;font-size:15px;color:var(--ink);text-align:left;border-radius:0;border:0;background:transparent}.album-edit .ae-block-sheet .ae-action-group button+button{border-top:1px solid var(--rule)}.album-edit .ae-block-sheet .ae-action-group button:hover{background:var(--screen-3)}.album-edit .ae-block-sheet .ae-action-group .i{width:19px;height:19px;color:var(--focus,#2f6fd6)}.album-edit .ae-block-sheet .ae-action-group .ae-danger,.album-edit .ae-block-sheet .ae-action-group .ae-danger .i{color:#ff3b30}.album-edit .ae-block-sheet .ae-sheet-more{margin-top:12px}.album-edit .ae-block-sheet::before{display:none}
.ae-add-pop{transform:none;width:360px;max-height:60%}.ae-add-pop>header{display:none}.ae-text-sheet .ae-sheet-body{padding-top:14px}
.ae-sheet>header{display:flex;align-items:center;padding:8px 8px 4px 18px;flex:none}
.ae-sheet h2{margin:0;flex:1;font-size:16px;font-weight:650}
.ae-sheet-body{overflow:auto;min-height:0;padding:8px 18px 24px;scrollbar-width:thin}
.ae-block-actions{display:grid;gap:14px}.ae-block-actions>button{width:100%;justify-content:flex-start;padding:0 12px}
.ae-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.album-edit .ae-pair button{height:52px;background:var(--screen);font-size:15px;border-radius:12px}
.ae-action-group{background:var(--screen);border-radius:12px;overflow:hidden}
.album-edit .ae-action-group button{width:100%;height:50px;justify-content:flex-start;gap:12px;padding:0 16px;border-radius:0;border-bottom:1px solid var(--rule);font-size:15.5px;text-align:left}
.ae-action-group button:last-child{border-bottom:0}
.ae-action-group .i,.ae-pair .i{color:var(--ae-accent)}
.ae-action-group .ae-danger .i{color:var(--cut,#e5806f)}
.album-edit[data-skin=film] .ae-pair button,.album-edit[data-skin=film] .ae-action-group{background:var(--screen-2)}
.ae-add-options{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.ae-add-options button{display:flex;flex-direction:column;min-height:68px;gap:8px}
.ae-text-label{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--ink-3)}
.ae-sheet textarea{display:block;width:100%;min-height:180px;max-height:40dvh;resize:vertical;padding:14px;border:1px solid var(--rule-2);border-radius:8px;background:var(--screen-2);color:var(--ink);font:16px/1.6 'Pretendard Variable',sans-serif}
.ae-sheet-acts{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.ae-dock{display:none}
.ae-picker-scrim{background:transparent}
.ae-picker{position:absolute;z-index:1;min-width:240px;max-width:calc(100% - 24px);padding:12px;background:var(--ae-pop-bg);color:var(--ae-pop-ink);border:1px solid var(--ae-pop-rule);border-radius:12px;box-shadow:0 20px 50px -18px #000c;font:13px/1.5 'Pretendard Variable',Pretendard,system-ui,sans-serif}
.ae-picker h4{margin:0 0 10px;font-size:12px;font-weight:600;color:var(--ae-pop-muted)}
.ae-seg{display:flex;gap:6px;flex-wrap:wrap}
.album-edit .ae-seg button{min-height:38px;padding:0 14px;border-radius:8px;background:var(--ae-pop-hover);color:var(--ae-pop-ink)}
.album-edit .ae-seg button[aria-pressed=true]{background:var(--ae-pop-ink);color:var(--ae-pop-bg);font-weight:600}
.ae-fieldrow{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ae-fieldrow label{display:grid;gap:4px;min-width:0;font-size:12px;color:var(--ae-pop-muted)}
.ae-fieldrow input{width:100%;min-width:0;height:38px;padding:0 10px;border-radius:8px;border:1px solid var(--ae-pop-rule);background:var(--ae-pop-input);color:var(--ae-pop-ink);font:14px 'Pretendard Variable',sans-serif;color-scheme:normal}
.ae-picker-foot{display:flex;justify-content:space-between;margin-top:12px}
.album-edit .ae-picker-foot button{min-height:34px;padding:0 12px;border-radius:8px}
.ae-picker-foot .ae-clear{color:var(--ae-pop-muted)}
.ae-more-sheet{position:absolute;z-index:9;width:380px;max-width:calc(100% - 24px);background:var(--ae-pop-bg);color:var(--ae-pop-ink);border:1px solid var(--ae-pop-rule);border-radius:14px;box-shadow:var(--ae-pop-shadow);font:13px/1.5 'Pretendard Variable',Pretendard,system-ui,sans-serif;overflow:hidden}
.ae-more-sheet header{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:14px 16px 10px;border-bottom:1px solid var(--ae-pop-rule)}
.ae-more-sheet header b{font-size:14px}.ae-more-sheet header small{color:var(--ae-pop-muted);font-size:12px;flex:none}
.ae-more-sheet ul{list-style:none;margin:0;max-height:300px;overflow:auto;padding:6px;scrollbar-width:thin}
.ae-more-sheet li label{display:grid;grid-template-columns:22px minmax(0,1fr);gap:2px 10px;padding:10px;border-radius:8px;cursor:pointer}
.ae-more-sheet li label:hover{background:var(--ae-pop-input)}
.ae-more-sheet li input{grid-row:1/3;margin:3px 0 0;width:16px;height:16px;accent-color:var(--ae-pop-accent)}
.ae-more-sheet li span{color:var(--ae-pop-ink);overflow-wrap:anywhere}.ae-more-sheet li small{color:var(--ae-pop-muted);font-size:12px}
.ae-more-group{padding:10px 10px 4px;font-size:12px;font-weight:600;color:#b9b8b3;overflow-wrap:anywhere}
.ae-more-sheet footer{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px 12px 16px;border-top:1px solid var(--ae-pop-rule)}
.ae-more-sheet footer small{color:var(--ae-pop-muted);font-size:12px}
.album-edit .ae-more-sheet footer button{height:36px;min-height:36px;padding:0 16px;border-radius:8px;background:var(--ae-pop-accent);color:var(--ae-pop-accent-ink);font-weight:600;flex:none}
.album-edit .ae-more-sheet footer button:disabled{opacity:.4;cursor:default}
@container(max-width:767px){
.ae-base,.ae-base.ae-has-panel{grid-template-columns:minmax(0,1fr);grid-template-rows:56px minmax(0,1fr) auto}
.ae-head{padding:0 8px 0 4px}.ae-title{justify-content:center;text-align:center;gap:0;flex-direction:column;align-items:center;flex-wrap:nowrap}
.ae-title b{font-size:14px}.ae-status{font-size:10px}.ae-head .ae-undo{order:-1}
.ae-head .ae-pc,.ae-panel,.ae-tools{display:none!important}
.ae-head .ae-done{padding:0 14px}.ae-scroll{padding:22px 0 100px}
.ae-dock{display:flex;justify-content:space-around;padding:6px 8px max(8px,env(safe-area-inset-bottom));background:var(--screen);border-top:1px solid var(--rule);z-index:10}
.ae-dock button{flex-direction:column;gap:2px;min-width:80px;font-size:11px}
.ae-sheet{left:0;right:0;top:auto;bottom:0;transform:none;width:auto;max-height:86%;border-radius:16px 16px 0 0;border:0;padding-bottom:env(safe-area-inset-bottom)}
.album-edit .ae-block-sheet{left:0;right:0;bottom:0;top:auto;transform:none;width:auto;border-radius:16px 16px 0 0;padding-bottom:max(18px,env(safe-area-inset-bottom))}
.ae-sheet::before{content:'';width:36px;height:5px;flex:none;border-radius:3px;background:var(--rule-2);margin:8px auto 2px}
.ae-more-sheet.ae-sheet{max-width:none}.ae-more-sheet.ae-sheet::before{background:var(--ae-pop-rule)}
.album-edit[data-skin=phone] .ae-block-sheet{background:var(--house)}
.ae-block-actions .ae-pair{margin-bottom:0}
.ae-sheet-body .ae-psec{padding-left:0;padding-right:0}
.ae-title [data-edit-action=reload],.ae-title [data-edit-action=retry]{min-height:20px;font-size:10px;padding:0 2px}
}

.ae-person-acts{display:flex;gap:2px;flex:none}
.album-edit .ae-person-acts button{min-width:0;padding:0 9px;color:var(--accent-text,var(--tungsten));font-size:13px;font-weight:600;border-radius:8px}
.album-edit .ae-person-acts button:hover{background:var(--tungsten-dim)}
.ae-person-sheet{display:flex;flex-direction:column;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100% - 32px));max-height:calc(100% - 40px);overflow:hidden;background:var(--ae-pop-bg);color:var(--ae-pop-ink);border:1px solid var(--ae-pop-rule);border-radius:16px;box-shadow:0 24px 60px -24px #0007}
.ae-person-sheet>header{flex:none;display:flex;align-items:center;gap:10px;padding:16px 18px 6px}
.ae-person-sheet h3{margin:0;flex:1;font-size:17px;font-weight:700}
.ae-person-sheet>header button{width:32px;height:32px;min-height:32px;min-width:32px;border-radius:50%;background:var(--ae-pop-hover)}
.ae-person-sub{flex:none;padding:0 18px 14px;margin:0;color:var(--ae-pop-muted);font-size:13px}
.ae-person-sheet>form{display:flex;flex-direction:column;min-height:0;flex:1}.ae-person-body{min-height:0;overflow:auto;scrollbar-width:thin;padding:8px 18px 0}.ae-person-sheet [role=status]{flex:none}
.ae-person-body h4{margin:0;padding:4px 0 6px;font-size:12.5px;font-weight:650;color:var(--ae-pop-muted)}
.ae-person-loading p,.ae-person-empty-state{margin:0 0 14px;color:var(--ae-pop-muted);font-size:13px}
.ae-person-skeleton{aspect-ratio:1;border-radius:12px;background:var(--ae-pop-hover);border:1px solid var(--ae-pop-rule)}
.ae-person-sheet form>[role=status]:not(:empty){margin:0;padding:0 18px 12px;color:var(--ae-pop-muted);font-size:13px}
.ae-person-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:0 0 16px}
.album-edit .ae-person-choice{position:relative;display:block;min-width:0;aspect-ratio:1;border-radius:12px;overflow:hidden;padding:0;background:var(--ae-pop-hover);color:var(--ae-pop-ink);outline-offset:2px}
.album-edit .ae-person-choice[aria-pressed=true]{outline:3px solid var(--tungsten)}
.ae-person-choice img{display:block;width:100%;height:100%;object-fit:cover}
.ae-person-choice>span{position:absolute;bottom:6px;left:6px;max-width:calc(100% - 12px);padding:2px 7px;border-radius:6px;background:#0009;color:#fff;font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ae-person-choice>i{position:absolute;right:6px;top:6px;width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:var(--tungsten);color:var(--tungsten-ink);font-style:normal;font-size:12px}
.album-edit .ae-person-device{display:flex;flex-direction:column;justify-content:center;gap:4px;border:1.5px dashed var(--ae-pop-muted);padding:6px;font-size:12px}
.ae-person-device>span{font-size:12px;position:static;background:none;color:inherit;padding:0;white-space:normal}
.ae-person-sheet footer{flex:none;display:flex;justify-content:flex-end;gap:8px;padding:12px 18px 16px;border-top:1px solid var(--ae-pop-rule)}
.ae-person-sheet footer button{padding:0 16px;border-radius:10px;background:var(--ae-pop-hover)}
.ae-person-sheet footer .ae-primary{background:var(--tungsten);color:var(--tungsten-ink)}
@container(max-width:767px){.ae-person-sheet{left:0;right:0;top:auto;bottom:0;transform:none;width:100%;max-height:90%;border-radius:16px 16px 0 0}.ae-person-grid{gap:8px}}

:root:not([data-theme=night]) .album-edit[data-skin=phone] .apt-thumb button{background:var(--screen);color:var(--ink);border:1px solid var(--rule-2)}
:root:not([data-theme=night]) .album-edit[data-skin=phone] .apt-placed{background:var(--screen);color:var(--tungsten);border:1px solid var(--rule-2)}
`;

// Deliberately album-owned: the global dashboard scope must still stop at .alb-album.
export const ALBUM_EDIT_CONTENT_CSS = ALBUM_PHOTO_TOOLS_CSS + `
.alb-album.alb-mode--edit .ae-fresh{animation:ae-fresh 1.6s ease-out}
@keyframes ae-fresh{0%{background:#2f6fd626}100%{background:transparent}}
@media(prefers-reduced-motion:reduce){.alb-album.alb-mode--edit .ae-fresh{animation:none}}
.alb-album.alb-mode--edit{--editor-accent:#2f6fd6;--editor-soft:#2f6fd61f;overflow:visible}
.alb-album.alb-mode--edit [data-album-block]{position:relative;scroll-margin-top:20px}
.alb-album.alb-mode--edit [data-album-block]::before{content:"";position:absolute;inset:0;border:1.5px solid transparent;border-radius:8px;pointer-events:none;transition:border-color .12s;z-index:2}
.alb-album.alb-mode--edit [data-album-block]:hover::before{border-color:#2f6fd633}
.alb-album.alb-mode--edit [data-album-block].alb-editor-selected::before{border-color:var(--editor-accent)}
.alb-album.alb-mode--edit [data-album-field]{cursor:text;border-radius:3px;min-height:1em;white-space:pre-wrap;outline:1.5px solid transparent;outline-offset:3px;transition:outline-color .12s,background-color .12s}
.alb-album.alb-mode--edit [data-album-field]:hover{outline-color:var(--editor-soft);background:var(--editor-soft)}
.alb-album.alb-mode--edit [data-album-field]:focus{outline:1.5px solid var(--editor-accent);background:transparent}
.alb-album.alb-mode--edit [data-placeholder]:empty::before{content:attr(data-placeholder);color:#9b968c;font-style:normal;pointer-events:none}
.alb-album.alb-mode--edit [data-pick]{cursor:pointer;text-decoration:underline dotted 1px;text-underline-offset:4px;text-decoration-color:color-mix(in srgb,currentColor 45%,transparent)}
.alb-album.alb-mode--edit [data-pick]:empty::before{content:attr(aria-label);opacity:.65}
.alb-album.alb-mode--edit [data-pick]:hover{color:var(--editor-accent);text-decoration-color:var(--editor-accent)}
.alb-album.alb-mode--edit .alb-editor-edited{position:relative}
.alb-album.alb-mode--edit .alb-editor-edited::after{content:"";position:absolute;left:-10px;top:.55em;width:5px;height:5px;border-radius:50%;background:var(--editor-accent)}
.alb-album.alb-mode--edit .alb-photo-image{position:relative}
.alb-album.alb-mode--edit .alb-photo-image .ph{display:block;width:100%;height:auto}
.alb-album.alb-mode--edit .rd-cover .alb-photo-image{position:relative;inset:auto}
.alb-album.alb-mode--edit .rd-cover .alb-photo-image .ph{height:100%;object-fit:cover}
.alb-album.alb-mode--edit .ptools{position:absolute;top:8px;right:8px;display:flex;gap:4px;opacity:0;transition:opacity .12s;z-index:3}
.alb-album.alb-mode--edit .alb-photo:hover .ptools,.alb-album.alb-mode--edit .alb-photo:focus-within .ptools,.alb-album.alb-mode--edit .alb-editor-selected .ptools{opacity:1}
.alb-album.alb-mode--edit .ptools button{appearance:none;border:0;min-width:34px;min-height:34px;width:34px;height:34px;padding:0;display:grid;place-items:center;border-radius:8px;background:var(--ae-pop-bg);color:var(--ae-pop-ink);backdrop-filter:blur(6px);font:20px/1 var(--sans);cursor:pointer}
.alb-album.alb-mode--edit .ptools button:is([data-album-action=fit-photo]){width:auto;padding:0 8px;font:600 12px/1 var(--sans)}
.alb-album.alb-mode--edit .ptools button:hover{background:var(--ae-pop-bg)}
.alb-album.alb-mode--edit .alb-photo-caption{position:relative;padding-right:28px}
.alb-album.alb-mode--edit .caption-x{position:absolute;right:0;top:0;width:24px;height:24px;min-height:24px;padding:0;border:0;border-radius:50%;background:var(--ink);color:var(--paper);box-shadow:none;font:600 14px/1 var(--sans);appearance:none;opacity:0;cursor:pointer}
.alb-album.alb-mode--edit .alb-photo-caption:hover .caption-x,.alb-album.alb-mode--edit .alb-photo-caption:focus-within .caption-x{opacity:1}
.alb-album.alb-mode--edit figcaption[data-placeholder]{min-height:1.6em}
.alb-album.alb-mode--edit figcaption[data-placeholder]:empty::before{width:auto;height:auto;background:none;flex:initial}
.alb-album.alb-mode--edit .alb-photo-slot{display:flex;width:100%;min-height:80px;border:1.5px dashed var(--ink-2);border-radius:6px;background:transparent;color:var(--ink-2);font:500 13px/1.5 var(--sans);align-items:center;justify-content:center;cursor:pointer}
.alb-album.alb-mode--edit .rd-cover .alb-photo-slot{min-height:180px;color:inherit;border-color:currentColor}
.alb-album.alb-mode--edit .rd-cover .alb-photo:has(>.alb-photo-slot){display:flex}
.alb-album.alb-mode--edit .rd-cover .alb-photo-slot{flex:1;align-self:stretch;margin:0}
.alb-album.alb-mode--edit [data-album-action=cover-tools]{cursor:pointer}
.alb-album.alb-mode--edit .rd-face{position:relative;cursor:pointer}
.alb-album.alb-mode--edit .rd-face-overlay{position:absolute;inset:0;display:grid;place-items:center;background:#0008;color:#fff;font:600 12px/1 var(--sans);opacity:0;transition:opacity .12s}
.alb-album.alb-mode--edit .rd-face:hover .rd-face-overlay,.alb-album.alb-mode--edit .rd-face:focus-within .rd-face-overlay{opacity:1}
.alb-album.alb-mode--edit .rd-face-empty{border:1.5px dashed var(--rule);box-shadow:none}
.alb-album.alb-mode--edit .rd-face-slot{display:grid;place-items:center;width:100%;height:100%;font:500 12px/1 var(--sans);color:var(--ink-3)}

.alb-album.alb-mode--edit .rd-edit-words .rd-call-word{position:relative;outline:1.5px solid transparent;outline-offset:2px;white-space:normal;cursor:text}
.alb-album.alb-mode--edit .rd-call-word:hover{background:var(--editor-soft);outline-color:var(--editor-soft)}
.alb-album.alb-mode--edit .rd-call-word [data-album-field]{display:inline;min-width:1ch}
.alb-album.alb-mode--edit .rd-call-word [data-placeholder]:empty::before{content:""}
.alb-album.alb-mode--edit .rd-call-word .rd-call-new{display:inline-block;min-width:7ch;padding:3px 8px;border:1px solid var(--ink);border-radius:6px;color:var(--ink);background:var(--paper);font:inherit;line-height:inherit}
.alb-album.alb-mode--edit .rd-call-word .rd-call-new:empty::before{content:attr(data-placeholder);color:var(--ink-2);pointer-events:none}
.alb-album.alb-mode--edit .rd-call-word .rd-call-new:focus{outline:2px solid var(--editor-accent);outline-offset:3px}
.alb-album.alb-mode--edit .rd-line{position:relative}
.alb-album.alb-mode--edit .quote-x{appearance:none;position:absolute;right:0;top:0;width:20px;height:20px;min-width:20px;min-height:20px;border:0;border-radius:50%;background:var(--ae-pop-bg);color:var(--ae-pop-ink);box-shadow:none;font:700 12px/20px var(--sans);padding:0;cursor:pointer;z-index:2;opacity:0}
.alb-album.alb-mode--edit .rd-line:is(:hover,:focus-within) .quote-x{opacity:1}
@media(max-width:767px),(hover:none){.alb-album.alb-mode--edit .quote-x{opacity:1}}

.alb-album.alb-mode--edit .rd-call-sep{color:var(--ink-3)}
.alb-album.alb-mode--edit .rd-call-word .call-x{appearance:none;position:absolute;right:-9px;top:-9px;width:18px;height:18px;min-width:18px;min-height:18px;border:0;border-radius:50%;background:var(--ae-pop-bg);color:var(--ae-pop-ink);box-shadow:none;font:700 11px/18px var(--sans);padding:0;text-align:center;font-style:normal;cursor:pointer;z-index:2;opacity:0}
.alb-album.alb-mode--edit .rd-call-word:hover .call-x,.alb-album.alb-mode--edit .rd-call-word:focus-within .call-x{opacity:1}
.alb-album.alb-mode--edit .rd-call-add{appearance:none;display:inline-block;margin-left:8px;font:600 12.5px/1 var(--sans);font-style:normal;color:var(--ink-3);padding:5px 8px;border:0;border-radius:6px;background:transparent;box-shadow:none;vertical-align:2px;cursor:pointer}
.alb-album.alb-mode--edit .rd-call-add:hover{color:var(--editor-accent);background:var(--editor-soft)}
@media(max-width:767px),(hover:none){.alb-album.alb-mode--edit .ptools,.alb-album.alb-mode--edit .caption-x{opacity:1}.alb-album.alb-mode--edit .rd-call-word:not(:focus-within) .call-x{opacity:0}}
@media(prefers-reduced-motion:reduce){.alb-album.alb-mode--edit [data-album-field],.alb-album.alb-mode--edit [data-album-block]::before{transition:none}}

:root:not([data-theme=night]) .album-edit[data-skin=phone] .alb-album .caption-x{background:var(--ae-pop-bg);color:var(--ae-pop-ink);border:1px solid var(--ae-pop-rule)}
`;
