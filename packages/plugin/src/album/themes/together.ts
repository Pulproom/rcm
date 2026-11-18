import type { AlbumTheme } from "@rcm/shared";

// Approved together-block mockup values; only these records use the program ledger override.
const voice = {
  book: { bottom: "22px", accent: "var(--accent)", h3: "600 15px/1.6 var(--sans)", rule: "1px solid var(--ink)", two: "400 21px/1.5 var(--display)", style: "italic", color: "var(--ink)",
    asof: "font:500 12.5px/1.4 var(--sans);color:var(--ink-3);letter-spacing:.04em;font-variant-numeric:tabular-nums" },
  program: { bottom: "30px", accent: "var(--c)", h3: "800 15px/1.4 var(--sans)", rule: "2px solid var(--ink)", two: "400 24px/1.35 var(--accent-serif)", style: "normal", color: "var(--ink)",
    asof: "font:700 12px/1 var(--sans);color:var(--paper);background:var(--c);padding:6px 9px;letter-spacing:.02em;font-variant-numeric:tabular-nums" },
  lp: { bottom: "26px", accent: "var(--label)", h3: "700 22px/1.3 var(--display)", rule: "3px solid var(--ink)", two: "500 19px/1.55 var(--sans)", style: "normal", color: "var(--ink)",
    asof: "font:700 12px/1 var(--sans);color:var(--ink);border:1.5px solid var(--ink);border-radius:999px;padding:6px 10px;font-variant-numeric:tabular-nums" },
  film: { bottom: "20px", accent: "var(--seal)", h3: "400 20px/1.5 var(--display)", rule: "1px solid var(--ink)", two: "400 29px/1.35 var(--hand)", style: "normal", color: "var(--hand-ink)",
    asof: "display:inline-block;padding:3px 9px 2px;border:1.5px solid var(--seal);border-radius:2px;color:var(--seal);font:700 12px/1.4 var(--sans);letter-spacing:.06em;font-variant-numeric:tabular-nums;transform:rotate(2deg);mix-blend-mode:multiply;opacity:.9" },
};
export function albumTogetherCss(theme: AlbumTheme, A: string): string {
  const v = voice[theme];
  return `
${A} .rd-together-head{position:relative}
${A} .rd-together-head .rd-h2{padding-right:112px}
${A} .rd-asof{position:absolute;right:0;bottom:${v.bottom};${v.asof};white-space:nowrap}
${A} .rd-together-ledger dt{white-space:nowrap}
${A} .rd-together-ledger b{font-variant-numeric:tabular-nums}
${A} .rd-two{display:block;font:${v.two};font-style:${v.style};color:${v.color};text-wrap:balance}
${A} .rd-together-optional{margin-top:56px;display:grid;gap:44px}
${A} .rd-together-opt .rd-together-h3{margin:0;font:${v.h3};color:var(--ink);padding-bottom:10px;border-bottom:${v.rule}}
${A} .rd-together-opt .rd-together-ledger{margin-top:0;border-top:0}
${A} .rd-quiz{margin:16px 0 0;font-size:16.5px;line-height:1.7;color:var(--ink-2)}
${A} .rd-quiz b{color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums}
${A} .alb-block--together .rd-quiz + .rd-note{margin-top:2px}
${A} .alb-block--together .rd-note{margin:12px 0 0;font:500 13.5px/1.6 var(--sans);color:var(--ink-3);font-variant-numeric:tabular-nums}
${A} .alb-block--together .rd-note b{display:inline;color:var(--ink);font-weight:700}
${A} .rd-days{margin-top:16px}
${A} .rd-together-months{display:grid;grid-template-columns:repeat(var(--weeks),minmax(0,1fr));white-space:nowrap;font:500 11.5px/1.4 var(--sans);color:var(--ink-3);margin-bottom:6px}
${A} .rd-together-cells{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,1fr);grid-template-columns:repeat(var(--weeks),minmax(0,1fr));gap:2px;aspect-ratio:var(--weeks)/7.4}
${A} .rd-together-cells i{display:block;border-radius:1.5px;background:color-mix(in srgb,var(--ink) 8%,transparent)}
${A} .rd-together-cells i.l1{background:color-mix(in srgb,var(--ink) 25%,transparent)}
${A} .rd-together-cells i.l2{background:color-mix(in srgb,var(--ink) 47%,transparent)}
${A} .rd-together-cells i.l3{background:color-mix(in srgb,var(--ink) 70%,transparent)}
${A} .rd-together-cells i.l4{background:var(--ink)}
${A} .rd-together-cells i.top{background:${v.accent};outline:1.5px solid ${v.accent};outline-offset:1px}
${A} .rd-together-cells i.z{background:transparent}
${A} .rd-hours{margin-top:18px}
${A} .rd-together-bars{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:3px;align-items:end;height:64px;border-bottom:1px solid var(--ink)}
${A} .rd-together-bars i{display:block;height:max(2px,calc(var(--h) * 100%));background:color-mix(in srgb,var(--ink) 60%,transparent);border-radius:1px 1px 0 0}
${A} .rd-together-bars i.pk{background:${v.accent}}
${A} .rd-together-ticks{display:grid;grid-template-columns:repeat(4,1fr);font:500 11.5px/1.4 var(--sans);color:var(--ink-3);margin-top:6px}
${theme === "program" ? `${A} .rd-together-ledger{display:block}
${A} .rd-together-ledger > div{display:grid;grid-template-columns:9em minmax(0,1fr);gap:4px 20px;align-items:baseline;padding:16px 0;border-bottom:1px solid var(--rule)}
${A} .rd-together-ledger dt{padding:0;border:0}
${A} .rd-together-ledger dd{padding:0;border:0}
${A} .rd-together-ledger dd > b{display:inline}
${A} .rd-together-ledger > div:last-child{border-bottom:0}
${A} .rd-together-opt .rd-together-ledger > div:first-child{padding-top:14px}
@media(max-width:640px){${A} .rd-together-ledger > div{grid-template-columns:1fr}}` : ""}
@media(max-width:640px){${A} .rd-together-ticks span:nth-child(2n){visibility:hidden}${A} .rd-together-ledger dt{white-space:normal}}
`;
}
