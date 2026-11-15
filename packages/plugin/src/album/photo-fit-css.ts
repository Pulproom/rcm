/** The same covered frame and source-orientation rows are used by the editor, reader and file. */
const R = ".alb-album:is(.alb-theme--book,.alb-theme--program,.alb-theme--lp,.alb-theme--film)";
export const ALBUM_PHOTO_FIT_CSS = `
${R} .alb-upload-tile{min-height:140px;display:flex;align-items:center;justify-content:center;gap:10px;background:transparent;border:1.5px dashed var(--ink-2);color:var(--ink-2);font:500 13px/1.5 var(--sans);padding:18px}
${R} .alb-photo-frame{position:relative;display:block;width:100%;overflow:hidden}
${R} .alb-fit-frame{height:auto;isolation:isolate;overflow:hidden}
${R} .alb-fit-frame .ph{display:block;width:100%;height:100%;object-fit:cover;max-width:none;max-height:none}
${R} .alb-photo-set .alb-photo-cell{min-width:0}
${R} .alb-photo-set .alb-photo-cell .alb-photo{width:100%;max-width:none;aspect-ratio:auto;margin:0}
${R} .alb-photo-set .alb-photo-image{position:relative}
${R} .alb-photo-set .alb-photo-break{display:none}
${R} .rd-plates.n1>.alb-photo-cell{width:100%;max-width:min(100%,calc(720px * var(--album-photo-ratio)),calc((100svh - 56px) * .78 * var(--album-photo-ratio)))}
${R} .alb-block[data-photo-columns] :is(.rd-shots,.rd-single){display:grid;grid-template-columns:repeat(var(--album-photo-columns),minmax(0,1fr));gap:12px;margin-top:18px}
${R} .alb-photo-set.alb-photo-justified{display:flex;flex-wrap:wrap;column-gap:12px;row-gap:0;align-items:flex-start}
${R} .alb-photo-justified>.alb-photo-cell{flex:var(--album-photo-ratio) 1 0%;margin-bottom:18px}
.alb-album.alb-theme--film .alb-photo-justified>.alb-photo-cell{flex-basis:18px}
${R} .alb-photo-justified>.alb-photo-break{flex:0 0 100%;height:0;border:0;margin:0;padding:0}
${R} :is(.n2,.n4,[data-set-columns="2"]).alb-photo-justified>.alb-break-two,${R} :is(.n3,.n5,[data-set-columns="3"]).alb-photo-justified>.alb-break-three,${R} [data-set-columns="1"].alb-photo-justified>.alb-photo-break{display:block}
@container(max-width:940px){.alb-album.alb-theme--book .n5.alb-photo-justified>.alb-photo-break{display:none}.alb-album.alb-theme--book .n5.alb-photo-justified>.alb-break-two{display:block}}
@container(max-width:900px){.alb-album.alb-theme--program .n5.alb-photo-justified>.alb-photo-break{display:none}.alb-album.alb-theme--program .n5.alb-photo-justified>.alb-break-two{display:block}}
@container(max-width:860px){.alb-album.alb-theme--lp .n5.alb-photo-justified>.alb-photo-break{display:none}.alb-album.alb-theme--lp .n5.alb-photo-justified>.alb-break-two{display:block}}
@container(max-width:700px){.alb-album.alb-theme--film .n5.alb-photo-justified>.alb-photo-break{display:none}.alb-album.alb-theme--film .n5.alb-photo-justified>.alb-break-two{display:block}}
${R} .alb-block--gallery[data-photo-columns] .alb-gallery-set{display:grid;grid-template-columns:repeat(var(--gallery-columns),minmax(0,1fr));gap:12px;align-items:start}
${R} .alb-gallery-set[data-set-columns="1"]{--gallery-columns:1}
${R} .alb-gallery-set[data-set-columns="2"]{--gallery-columns:2}
${R} .alb-gallery-set[data-set-columns="3"]{--gallery-columns:3}
${R} .alb-gallery-set[data-set-columns="4"]{--gallery-columns:4}
${R} .alb-gallery-set>.alb-photo-cell{width:auto;max-width:none;min-width:0;margin:0;transform:none}
${R} .alb-gallery-set .alb-photo{margin:0;transform:none}
@container(max-width:480px){${R} .alb-gallery-set:is([data-set-columns="3"],[data-set-columns="4"]){--gallery-columns:2}}
${R} .rd-cover .alb-photo{position:relative;height:auto;aspect-ratio:auto}
${R} .rd-cover .alb-photo-image{position:relative;inset:auto}
${R} .rd-cover .alb-photo-frame{height:auto}
${R} :is(.rd-people,.rd-avatar) .alb-photo-frame{height:100%}
${R} :is(.xp-slot,.alb-photo-slot){appearance:none;display:flex;align-items:center;justify-content:center;min-height:100px;width:100%;padding:18px;border:1.5px dashed var(--ink-2);border-radius:6px;box-shadow:none;background:transparent;color:var(--ink-2);font:600 13px/1.5 var(--sans);cursor:pointer}
.alb-album.alb-theme--film .rd-cover{min-height:0;padding:22px}
.alb-album.alb-theme--film .rd-cover .rd-frame{display:block;min-width:0;padding:28px 48px;text-align:center}
.alb-album.alb-theme--film .rd-cover h1{font-size:clamp(40px,7cqi,76px);line-height:1.15;margin:0 auto}
.alb-album.alb-theme--film .rd-cover .rd-cover-rule{margin:16px auto 14px}
.alb-album.alb-theme--film .rd-cover .rd-stamp{padding:4px 12px 3px;font-size:14px;line-height:1.3}
.alb-album.alb-theme--film .rd-cover .rd-card{margin-top:10px;font-size:13px;line-height:1.6}
.alb-album.alb-theme--film .rd-cover-spread{display:grid;grid-template-columns:minmax(0,1fr);justify-items:center;align-items:center;gap:24px;max-width:820px;margin:24px auto 0;text-align:center}
.alb-album.alb-theme--film .rd-cover.has-photo.has-epigraph .rd-cover-spread{grid-template-columns:auto minmax(0,1fr);gap:44px;text-align:left;justify-items:stretch}
.alb-album.alb-theme--film .rd-cover .rd-print{position:relative;width:min(clamp(200px,30cqi,300px),calc((100svh - 410px)*.6667));height:auto;aspect-ratio:auto;margin:0 auto;padding:10px 10px 30px;transform:rotate(-1.6deg);background:#efe6d2;box-shadow:0 14px 30px -18px #0009}
.alb-album.alb-theme--film .rd-cover .rd-print:has([data-fit-shape=landscape]){width:clamp(280px,42cqi,410px)}
.alb-album.alb-theme--film .rd-cover .rd-epigraph{position:static;align-self:auto;margin:0;max-width:26em;min-width:0}
.alb-album.alb-theme--film .rd-cover .rd-epigraph p{font:400 clamp(22px,3.1cqi,30px)/1.55 var(--hand);color:var(--hand-ink);text-wrap:pretty}
.alb-album.alb-theme--film .rd-cover.has-epigraph .rd-epigraph::before{content:"“";display:block;height:26px;font:400 54px/.6 var(--display);color:var(--ink);opacity:.35}
.alb-album.alb-theme--film .rd-cover cite{margin-top:10px;font:500 13px/1.4 var(--sans);color:var(--ink-3)}
.alb-album.alb-theme--film :is(.xp-slot,.alb-photo-slot){color:#494235;border-color:#615747;min-height:140px}
@container(max-width:640px){
.alb-album.alb-theme--film .rd-cover{padding:12px}
.alb-album.alb-theme--film .rd-cover .rd-frame{padding:40px 18px 30px;outline-offset:-8px}
.alb-album.alb-theme--film .rd-cover-spread,.alb-album.alb-theme--film .rd-cover.has-photo.has-epigraph .rd-cover-spread{grid-template-columns:minmax(0,1fr);gap:24px;justify-items:center;text-align:center;margin-top:26px}
.alb-album.alb-theme--film .rd-cover .rd-print,.alb-album.alb-theme--film .rd-cover .rd-print:has([data-fit-shape=landscape]){width:64%}
.alb-album.alb-theme--film .rd-cover .rd-epigraph p{font-size:22px}
}
${R} .alb-photo-frame>:is(.xp-slot,.alb-photo-slot,.alb-upload-tile){position:absolute;inset:0;min-height:0;height:100%;margin:0}
${R} .alb-person-photo{position:relative;aspect-ratio:4/5;overflow:hidden;min-width:0}
${R} .alb-person-photo>.alb-photo-frame{position:absolute;inset:0;height:100%;width:100%}
${R} .alb-person-photo .ph{width:100%;height:100%;object-fit:cover;object-position:50% 50%;max-height:none;max-width:none}
${R} :is(.rd-face,.rd-avatar) .alb-person-photo{height:100%;width:100%;margin:0;aspect-ratio:auto}
${R} :is(.rd-face,.rd-avatar){overflow:hidden}
`;
