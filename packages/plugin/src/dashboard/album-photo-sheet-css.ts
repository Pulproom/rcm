export const ALBUM_PHOTO_SHEET_CSS = `
.ap-dialog .ap-upload-uploading,.ap-dialog .ap-upload-error{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;padding:12px;background:var(--screen-2);color:var(--ink-2);font-size:13px;border:1px dashed var(--rule-2)}.album-edit .ap-upload-error button{color:var(--accent-text,var(--tungsten));font-size:12px;text-decoration:underline}
.ap-spinner{display:inline-flex;width:20px;height:20px;flex:none;align-items:center;justify-content:center;animation:ap-spin 1s linear infinite}.ap-spinner:empty{border:2px solid currentColor;border-right-color:transparent;border-radius:50%}.ap-spinner .i{width:20px;height:20px}@keyframes ap-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.ap-spinner{animation:none}}

.ae-photo-overlay{position:absolute;inset:0;z-index:80;pointer-events:none}
.ap-scrim{position:absolute;inset:0;background:#0007;pointer-events:auto}
.ap-dialog{position:absolute;pointer-events:auto;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,calc(100% - 64px));height:min(640px,calc(100% - 64px));display:flex;flex-direction:column;background:var(--screen);color:var(--ink);border:1px solid var(--rule-2);border-radius:12px;box-shadow:0 30px 80px -30px #000b;overflow:hidden;min-width:0}
.album-edit[data-skin=phone] .ap-dialog{background:var(--house);border:0}
.ap-dialog>header{display:flex;align-items:center;gap:8px;padding:10px 8px 6px 18px;flex:none}
.ap-dialog h2{margin:0;font-size:16px;font-weight:650;flex:1;min-width:0}
.ap-dialog h2 small{font-size:13px;color:var(--ink-3);font-weight:400;margin-left:6px}
.ap-dialog button:focus-visible,.ap-dialog summary:focus-visible,.ap-dialog input:focus-visible{outline:2px solid var(--ae-accent);outline-offset:2px}
.ap-body{flex:1;min-height:0;overflow:auto;padding:4px 18px 16px;scrollbar-width:thin;scrollbar-color:var(--rule-2) transparent;overscroll-behavior:contain}
.ap-dialog>footer{display:flex;align-items:center;gap:10px;padding:12px 18px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--rule);flex:none;background:inherit}
.ap-dialog>footer>span{flex:1;font-size:13.5px;color:var(--ink-2);min-width:0;word-break:keep-all}
.album-edit .ap-dialog .ap-primary{background:var(--ae-accent);color:var(--ae-accent-ink);font-weight:600;padding:0 22px;flex:none}
.ap-tabs{display:flex;gap:4px;padding:0 18px;border-bottom:1px solid var(--rule);flex:none}
.album-edit .ap-tabs button{position:relative;color:var(--ink-3);font-size:14px;border-radius:0;background:none}
.ap-tabs button small{font-size:12px;margin-left:4px}
.album-edit .ap-tabs [aria-selected=true]{color:var(--ink);font-weight:600}
.ap-tabs [aria-selected=true]::after{content:'';position:absolute;left:10px;right:10px;bottom:-1px;height:2px;background:var(--ae-accent)}
.ap-scope{display:inline-flex;margin:12px 0 4px;padding:2px;border-radius:9px;background:var(--screen-3)}
.album-edit .ap-scope button{font-size:13px;border-radius:7px;color:var(--ink-2)}
.album-edit .ap-scope [aria-pressed=true]{background:var(--screen);color:var(--ink);font-weight:600}
.ap-group h3{margin:18px 0 8px;font-size:13px;font-weight:600;display:flex;gap:8px;align-items:baseline}
.ap-group h3 small{color:var(--ink-3);font-weight:400}
.ap-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:6px}
.album-edit .ap-tile{padding:0;position:relative;aspect-ratio:1;min-width:0;width:100%;border:0;border-radius:4px;overflow:hidden;background:var(--screen-3)}
.ap-tile img{width:100%;height:100%;object-fit:cover;display:block}
.ap-tile .ap-check{position:absolute;right:6px;top:6px;width:24px;height:24px;border-radius:50%;border:2px solid #fff;background:#0004;display:grid;place-items:center;color:#fff;font:600 12px Archivo,sans-serif;box-shadow:0 1px 4px #0006}
.ap-tile[aria-pressed=true] .ap-check{background:var(--ae-accent);border-color:var(--ae-accent);color:var(--ae-accent-ink)}
.ap-tile[aria-pressed=true] img{transform:scale(.9);border-radius:3px}
.ap-placed{position:absolute;left:6px;bottom:6px;padding:1px 7px;border-radius:20px;background:#000a;color:#fff;font-size:11px}
.ap-drop{margin:14px 0;border:1.5px dashed var(--rule-2);border-radius:10px;min-height:160px;display:grid;place-items:center;align-content:center;gap:8px;color:var(--ink-3);font-size:14px;text-align:center}
.ap-drop p{margin:0}.ap-drop .i{width:28px;height:28px}.ap-drop input[hidden]{display:none}
.ap-placements{list-style:none;margin:8px 0 0;padding:0}
.ap-placements>li{padding:10px 0;border-bottom:1px solid var(--rule)}
.ap-place-row{display:flex;align-items:center;gap:12px;min-width:0}
.ap-place-row>img,.ap-place-placeholder{width:56px;height:56px;object-fit:cover;border-radius:4px;flex:none;background:var(--screen-3)}
.ap-place-row>div{flex:1;min-width:0}.ap-place-row b{display:block;font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-place-row small{display:block;font-size:12.5px;color:var(--ink-3)}
.album-edit .ap-where{border-radius:24px;background:var(--accent-soft,var(--screen-3));color:var(--ae-accent);max-width:45%;font-size:13px;line-height:1.4}
.ap-where .i{flex:none;width:15px;height:15px}
.ap-picker{margin:10px 0 2px 68px;border:1px solid var(--rule-2);border-radius:10px;overflow:hidden}
.ap-picker details+details{border-top:1px solid var(--rule)}
.ap-picker summary{list-style:none;display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;cursor:pointer;font-size:13.5px}
.ap-picker summary::-webkit-details-marker{display:none}
.ap-picker summary i{font-style:normal;font-size:11px;color:var(--ink-3)}
.ap-picker summary small{margin-left:auto;color:var(--ink-3);font-size:12px;white-space:nowrap}
.ap-picker label{display:flex;align-items:center;gap:10px;min-height:44px;padding:4px 12px;font-size:13.5px;color:var(--ink-2);cursor:pointer}
.ap-picker label small{color:var(--ink-3);font-size:12px;white-space:nowrap}
.ap-picker input{accent-color:var(--ae-accent);width:18px;height:18px;margin:0;flex:none}
.ap-error:empty{display:none}.ap-error{font-size:12px;color:var(--cut);margin:8px 18px}
.ap-empty{font-size:14px;color:var(--ink-3);padding:24px 0}
@container(max-width:767px){
.ap-dialog{left:0;right:0;bottom:0;top:auto;transform:none;width:auto;height:92%;border:0;border-radius:16px 16px 0 0}
.ap-dialog::before{content:'';width:36px;height:5px;background:var(--rule-2);border-radius:3px;margin:8px auto 2px;flex:none}
.ap-picker{margin-left:0}.ap-place-row{gap:10px}.ap-dialog>footer>span{font-size:12px}
.ap-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
`;
