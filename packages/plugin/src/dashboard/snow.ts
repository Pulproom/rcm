export function christmasSnowEnabled(now: Date, enabled: boolean, reducedMotion: boolean, preview = false): boolean {
  return enabled && !reducedMotion && (preview || (now.getMonth() === 11 && [24, 25].includes(now.getDate())));
}

/** Own the home lifetime: leaving it releases the layer and every background subscription. */
export function createHomeSnow(document: Document, enabled: () => boolean, preview = false): { update: (home: boolean) => void; dispose: () => void } {
  let snow: ReturnType<typeof mountChristmasSnow> | undefined;
  const dispose = () => { snow?.dispose(); snow = undefined; };
  return {
    update(home) {
      if (!home) { dispose(); return; }
      snow ??= mountChristmasSnow(document, enabled, preview);
      snow.update();
    },
    dispose,
  };
}

/** Re-rendering home keeps the existing flakes moving. */
function mountChristmasSnow(document: Document, enabled: () => boolean, preview = false): { update: () => void; dispose: () => void } {
  const window = document.defaultView!;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const layer = document.createElement("div");
  layer.className = "christmas-snow";
  layer.setAttribute("aria-hidden", "true");
  // 34 flakes for wide screens; CSS keeps 18 on phones (film: 22 / 12) so density feels alike.
  layer.innerHTML = Array.from({ length: 34 }, (_, i) => {
    const depth = i % 3;
    return `<span style="left:${(i * 37 + 7) % 100}%;--snow-size:${4 + (i * 3) % 8}px;--snow-blur:${.5 + depth}px;--snow-opacity:${.7 - depth * .17};--snow-drift:${(i * 17) % 45 - 22}px;--snow-duration:${8 + i % 9}s;--snow-delay:-${(i * 7) % 16}s"></span>`;
  }).join("");
  let visible = true;
  const update = () => {
    layer.hidden = !christmasSnowEnabled(new Date(), enabled(), motion.matches, preview);
    layer.dataset.paused = String(document.hidden || !visible);
  };
  update();
  document.body.append(layer);
  // CSS-hidden host iframes do not necessarily receive a Page Visibility event.
  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    update();
  });
  observer.observe(document.documentElement);
  document.addEventListener("visibilitychange", update);
  document.addEventListener("change", update);
  motion.addEventListener("change", update);
  // Local midnight matters even if no server activity occurs while the dashboard is open.
  const timer = window.setInterval(update, 30_000);
  return { update, dispose: () => {
    layer.dataset.paused = "true";
    layer.remove();
    window.clearInterval(timer);
    observer.disconnect();
    document.removeEventListener("visibilitychange", update);
    document.removeEventListener("change", update);
    motion.removeEventListener("change", update);
  } };
}

export const SNOW_CSS = `
.christmas-snow { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 40; contain: strict; }
.christmas-snow[hidden] { display: none; }
.christmas-snow span { position: absolute; top: -20px; width: calc(var(--snow-size) * 1.7); height: calc(var(--snow-size) * 1.7); border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(255,255,255,.65) 25%, rgba(255,255,255,.18) 55%, transparent 75%); filter: blur(var(--snow-blur)); opacity: var(--snow-opacity); animation: christmas-snowfall var(--snow-duration) var(--snow-delay) linear infinite; }
/* Film: same flakes, a touch larger and greyer, fewer and slower — calm, but still visible on the dark set. */
:root[data-skin="film"] .christmas-snow span { background: radial-gradient(circle, rgba(236,234,228,.95) 0%, rgba(220,220,216,.6) 30%, rgba(200,204,210,.2) 55%, transparent 75%); opacity: calc(var(--snow-opacity) + .15); animation-duration: calc(var(--snow-duration) * .5 + 8s); }
/* Day themes: white alone vanishes on pale backgrounds, so each flake carries a soft cool glow (drop-shadow follows the fading core, so no ring). */
:root[data-theme^="day"] .christmas-snow span { background: radial-gradient(circle, #fff 0%, rgba(255,255,255,.92) 38%, rgba(255,255,255,0) 72%); filter: blur(calc(var(--snow-blur) * .45)) drop-shadow(0 0 3px rgba(130,150,210,.45)) drop-shadow(0 1px 4px rgba(120,140,200,.25)); opacity: calc(var(--snow-opacity) + .2); }
:root[data-skin="film"][data-theme^="day"] .christmas-snow span { filter: blur(calc(var(--snow-blur) * .45)) drop-shadow(0 0 3px rgba(110,110,122,.42)) drop-shadow(0 1px 4px rgba(100,100,112,.22)); }
:root[data-skin="film"] .christmas-snow span:nth-child(n+23) { display: none; }
@media (max-width: 899px) {
  .christmas-snow span:nth-child(n+19) { display: none; }
  :root[data-skin="film"] .christmas-snow span:nth-child(n+13) { display: none; }
}
.christmas-snow[data-paused="true"] span, .christmas-snow[hidden] span { animation-play-state: paused; }
@keyframes christmas-snowfall { 0% { transform: translate3d(0,-16px,0); } 50% { transform: translate3d(var(--snow-drift),50dvh,0); } 100% { transform: translate3d(calc(var(--snow-drift) * -.5),calc(100dvh + 32px),0); } }
@media (prefers-reduced-motion: reduce) { .christmas-snow { display: none; } .christmas-snow span { animation: none; } }
`;
