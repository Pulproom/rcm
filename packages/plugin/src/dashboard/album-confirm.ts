import { escapeHtml as esc } from "./film/ui.js";

export function albumConfirm(root: HTMLElement, title: string, body: string): Promise<boolean> {
  return new Promise(resolve => {
    const previous = document.activeElement as HTMLElement | null, host = root.querySelector<HTMLElement>(".album-edit,.album-view")!;
    const base = host.querySelector<HTMLElement>(".ae-base,.av-base")!, overlay = document.createElement("div");
    overlay.className = "ac-overlay";
    overlay.innerHTML = `<div class="ac-scrim"></div><section class="ac-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="ac-head"><b>${esc(title)}</b></div><p>${esc(body)}</p><div class="ac-buttons"><button type="button" data-confirm="cancel">취소</button><button type="button" class="ac-danger" data-confirm="delete">지우기</button></div></section>`;
    const wasInert = base.inert; host.append(overlay); base.inert = true;
    const finish = (yes: boolean) => { overlay.remove(); base.inert = wasInert; previous?.isConnected && previous.focus({ preventScroll: true }); resolve(yes); };
    overlay.addEventListener("click", e => { const n = (e.target as HTMLElement).closest<HTMLElement>("[data-confirm],.ac-scrim"); if (n) { e.stopPropagation(); finish(n.dataset.confirm === "delete"); } });
    overlay.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } if (e.key === "Tab") { const n = [...overlay.querySelectorAll<HTMLButtonElement>("button")]; if (e.shiftKey && document.activeElement === n[0]) { e.preventDefault(); n.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === n.at(-1)) { e.preventDefault(); n[0]?.focus(); } } });
    overlay.querySelector<HTMLButtonElement>('.ac-buttons [data-confirm="cancel"]')!.focus();
  });
}

export const ALBUM_CONFIRM_CSS = `
.ac-overlay{position:absolute;inset:0;z-index:100}.ac-scrim{position:absolute;inset:0;background:#0000002e}
.ac-sheet{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,calc(100% - 32px));background:var(--screen);color:var(--ink);border-radius:16px;padding:18px;box-shadow:0 18px 40px -20px #0006}
.ac-head{display:flex;align-items:center;justify-content:space-between;min-height:32px;margin-bottom:8px}.ac-head b{font-size:17px;font-weight:700}.album-view .ac-close{width:36px;height:36px;min-width:36px;min-height:36px;border-radius:50%;display:grid;place-items:center;color:var(--ink-2);background:var(--screen-3)}
.ac-sheet p{color:var(--ink-2);font-size:14.5px;line-height:1.6;margin:0 0 18px}.ac-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px}.album-view .ac-buttons button{height:46px;min-height:46px;border-radius:12px;background:var(--screen-3);color:var(--ink);font-size:15px;font-weight:650}.album-view .ac-buttons .ac-danger{background:#ff3b30;color:#fff}
@container(max-width:767px){.ac-sheet{inset:auto 0 0;width:auto;transform:none;border-radius:16px 16px 0 0;padding-bottom:max(18px,env(safe-area-inset-bottom))}}
`;
