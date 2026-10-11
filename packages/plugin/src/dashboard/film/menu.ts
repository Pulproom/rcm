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

  const onToggle = (event: Event): void => {
    const menu = openMenuFor(event.target);
    if (!menu) return;
    for (const candidate of openMenus()) if (candidate !== menu) close(candidate);
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
  return () => {
    root.removeEventListener("toggle", onToggle, true);
    root.removeEventListener("click", onClick);
    root.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerdown", onPointerDown);
  };
}
