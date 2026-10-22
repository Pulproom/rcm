export type MenuNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function nextMenuIndex(current: number, count: number, key: MenuNavigationKey): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (current < 0 || current >= count) return key === "ArrowDown" ? 0 : count - 1;
  return key === "ArrowDown" ? (current + 1) % count : (current - 1 + count) % count;
}

export function shouldCloseOnPointer(targetInsideOpenMenu: boolean): boolean {
  return !targetInsideOpenMenu;
}

export function installMenuController(root: HTMLElement): () => void {
  const closest = <T extends Element>(target: EventTarget | null, selector: string): T | null =>
    target && "closest" in target && typeof target.closest === "function" ? target.closest(selector) as T | null : null;
  const openMenus = (): HTMLDetailsElement[] =>
    [...root.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]")];
  const openMenuFor = (target: EventTarget | null): HTMLDetailsElement | null => {
    const menu = closest<HTMLDetailsElement>(target, "details[data-menu]");
    return menu?.open && root.contains(menu) ? menu : null;
  };
  const close = (menu: HTMLDetailsElement): void => {
    menu.open = false;
  };
  const popOf = (menu: HTMLDetailsElement): HTMLElement | null => menu.querySelector<HTMLElement>(":scope > .menu__pop");
  /**
   * A dropdown (wide screens) is lifted out of its card: fixed and anchored to its button, so a rounded card's
   * `overflow: hidden` can never clip it. Narrow screens already show menus as a fixed bottom sheet and are left alone.
   */
  const anchor = (menu: HTMLDetailsElement): void => {
    const pop = popOf(menu);
    const button = menu.querySelector<HTMLElement>(":scope > summary");
    if (!pop || !button || typeof getComputedStyle !== "function") return;
    if (!pop.dataset.anchored && getComputedStyle(pop).position !== "absolute") return;
    pop.dataset.anchored = "true";
    const view = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const rect = button.getBoundingClientRect();
    Object.assign(pop.style, { position: "fixed", left: "auto", bottom: "auto", right: `${Math.max(8, view.width - rect.right)}px`, top: `${rect.bottom + 6}px` });
    const height = pop.offsetHeight;
    const below = rect.bottom + 6 + height <= view.height - 8;
    const top = below ? rect.bottom + 6 : Math.max(8, rect.top - 6 - height);
    pop.style.top = `${top}px`;
    // A transformed ancestor would make "fixed" relative to itself; correct by the measured drift.
    const placed = pop.getBoundingClientRect();
    const drift = { x: placed.right - (view.width - Math.max(8, view.width - rect.right)), y: placed.top - top };
    if (Math.abs(drift.y) > 1) pop.style.top = `${top - drift.y}px`;
    if (Math.abs(drift.x) > 1) pop.style.right = `${Math.max(8, view.width - rect.right) + drift.x}px`;
  };
  const release = (menu: HTMLDetailsElement): void => {
    const pop = popOf(menu);
    if (!pop?.dataset.anchored) return;
    delete pop.dataset.anchored;
    for (const key of ["position", "left", "right", "top", "bottom"] as const) pop.style[key] = "";
  };
  // Re-measure from the stylesheet each time, so a resize into the phone sheet layout drops the anchoring.
  const reanchor = (): void => { for (const menu of openMenus()) if (popOf(menu)?.dataset.anchored) { release(menu); anchor(menu); } };

  const onToggle = (event: Event): void => {
    const target = event.target as HTMLDetailsElement | null;
    if (target?.matches?.("details[data-menu]") && !target.open) release(target);
    const menu = openMenuFor(event.target);
    if (!menu) return;
    for (const candidate of openMenus()) if (candidate !== menu) close(candidate);
    anchor(menu);
  };
  const onPointerDown = (event: PointerEvent): void => {
    for (const menu of openMenus()) {
      // The phone scrim is the menu's own ::before, so a tap on it targets the details element itself.
      const inside = event.target !== null && event.target !== menu && menu.contains(event.target as Node);
      if (shouldCloseOnPointer(inside)) close(menu);
    }
  };
  const onClick = (event: MouseEvent): void => {
    // Only a chosen item closes the menu; controls inside it (the act search) keep it open.
    const item = closest<HTMLElement>(event.target, "[role=menuitem]");
    const menu = closest<HTMLDetailsElement>(item, "details[data-menu]");
    if (menu && root.contains(menu)) close(menu);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      const menu = openMenuFor(event.target) ?? openMenus()[0];
      if (!menu) return;
      event.preventDefault();
      close(menu);
      menu.querySelector<HTMLElement>("summary")?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const menu = openMenuFor(event.target);
    if (!menu) return;
    // Disabled items stay visible but are skipped by arrow keys.
    const items = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")].filter((item) => !(item as HTMLButtonElement).disabled);
    const target = closest<HTMLElement>(event.target, "[role=menuitem]");
    const next = nextMenuIndex(target ? items.indexOf(target) : -1, items.length, event.key as MenuNavigationKey);
    if (next < 0) return;
    event.preventDefault();
    items[next]?.focus();
  };

  root.addEventListener("toggle", onToggle, true);
  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("scroll", reanchor, true);
  globalThis.window?.addEventListener("resize", reanchor);
  return () => {
    root.removeEventListener("toggle", onToggle, true);
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("scroll", reanchor, true);
    globalThis.window?.removeEventListener("resize", reanchor);
  };
}
