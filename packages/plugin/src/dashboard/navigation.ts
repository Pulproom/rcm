import { buildRecordChains } from "./record-history.js";
import type { Tab } from "../dashboard.js";

export type ViewSnapshot = {
  tab: Tab;
  peopleView: unknown;
  selectedRelationship: string;
  relationshipPerson: string;
  relationshipMobileDetail: boolean;
  selectedMemory: string;
  timelineMobileDetail: boolean;
  scrollTop: number;
  scrollOwner?: "page" | "reader";
};

/** The film shell scrolls the document itself; this is the element that owns the page position. */
export function documentScroller(scope: ParentNode): HTMLElement | null {
  const owner = (scope as Partial<Node>).ownerDocument ?? (typeof document === "undefined" ? undefined : document);
  return (owner?.scrollingElement as HTMLElement | null | undefined) ?? null;
}

export function dashboardScrollOwner(
  scope: ParentNode,
  options: { mobile?: boolean } = {},
): {
  kind: "page" | "reader";
  element: HTMLElement | null;
  read(): number;
  restore(scrollTop: number): void;
} {
  const mobile = options.mobile ?? (typeof window !== "undefined" && window.matchMedia("(max-width: 899px)").matches);
  // On desktop a list + reader screen scrolls its reader column; everything else scrolls the document.
  const reader = mobile ? null : scope.querySelector<HTMLElement>(".split > .readercol");
  const readerScrolls = Boolean(reader) && (typeof getComputedStyle !== "function" || /auto|scroll/u.test(getComputedStyle(reader!).overflowY));
  const kind = readerScrolls ? "reader" : "page";
  const element = readerScrolls ? reader : documentScroller(scope);
  return {
    kind,
    element,
    read: () => element?.scrollTop ?? 0,
    restore: (scrollTop) => { if (element) element.scrollTop = scrollTop; },
  };
}

export class NavigationStack {
  readonly #snapshots: ViewSnapshot[] = [];

  push(snapshot: ViewSnapshot): void {
    this.#snapshots.push(snapshot);
  }

  pop(): ViewSnapshot | undefined {
    return this.#snapshots.pop();
  }

  clear(): void {
    this.#snapshots.length = 0;
  }

  toArray(): ViewSnapshot[] {
    return [...this.#snapshots];
  }

  truncate(size: number): void {
    this.#snapshots.length = Math.max(0, Math.min(this.#snapshots.length, size));
  }

  get size(): number {
    return this.#snapshots.length;
  }
}

export type DashboardNavigationRefresh = {
  sequence: number;
  restoreTarget?: ViewSnapshot;
  isCurrent(): boolean;
  snapshotAfterRefresh(): ViewSnapshot;
};

type NavigationControllerOptions = {
  stack: NavigationStack;
  getSnapshot(): ViewSnapshot;
  canNavigate(next: Partial<ViewSnapshot>): boolean | Promise<boolean>;
  applySnapshot(next: Partial<ViewSnapshot>): void;
  render(next: Partial<ViewSnapshot>): void;
  refresh(request: DashboardNavigationRefresh): Promise<void>;
};

export type DashboardNavigationController = {
  navigate(next: Partial<ViewSnapshot>, options: { push: boolean; resetHistory?: boolean }): Promise<boolean>;
  restore(snapshot: ViewSnapshot): Promise<boolean>;
  back(fallback: () => void): Promise<boolean>;
  supersede(): void;
  waitForRefresh(): Promise<void>;
};

export function createDashboardNavigationController(options: NavigationControllerOptions): DashboardNavigationController {
  let navigationSequence = 0;
  let lastRefresh = Promise.resolve();

  const transition = async (
    next: Partial<ViewSnapshot>,
    transitionOptions: { push: boolean; resetHistory?: boolean; restoreTarget?: ViewSnapshot },
  ): Promise<boolean> => {
    const allowed = options.canNavigate(next);
    if (!(typeof allowed === "boolean" ? allowed : await allowed)) return false;
    if (transitionOptions.resetHistory) options.stack.clear();
    const current = options.getSnapshot();
    const tab = next.tab ?? current.tab;
    const replacesReader = tab === current.tab && (
      (tab === "relationships" && next.selectedRelationship !== undefined)
      || (tab === "timeline" && next.selectedMemory !== undefined)
      || (tab === "initial" && next.peopleView !== undefined)
    );
    if (transitionOptions.push && !replacesReader) options.stack.push(current);

    const sequence = ++navigationSequence;
    options.applySnapshot(next);
    options.render(next);
    const request: DashboardNavigationRefresh = {
      sequence,
      ...(transitionOptions.restoreTarget ? { restoreTarget: transitionOptions.restoreTarget } : {}),
      isCurrent: () => sequence === navigationSequence,
      snapshotAfterRefresh: options.getSnapshot,
    };
    lastRefresh = options.refresh(request);
    void lastRefresh.catch(() => undefined);
    return true;
  };

  const navigate = (next: Partial<ViewSnapshot>, navigateOptions: { push: boolean; resetHistory?: boolean }) => transition(next, navigateOptions);
  const restore = (snapshot: ViewSnapshot) => transition(snapshot, { push: false, restoreTarget: snapshot });

  return {
    navigate,
    restore,
    async back(fallback: () => void): Promise<boolean> {
      const previous = options.stack.pop();
      if (previous) {
        const restored = await restore(previous);
        if (!restored) options.stack.push(previous);
        return restored;
      }
      navigationSequence += 1;
      fallback();
      return true;
    },
    supersede(): void {
      navigationSequence += 1;
    },
    waitForRefresh(): Promise<void> {
      return lastRefresh;
    },
  };
}

type NavigationActionTarget = { dataset: Record<string, string | undefined> };
type NavigationActionContext = {
  navigation: DashboardNavigationController;
  showRelationshipList(): void;
};

export async function handleDashboardNavigationAction(
  target: NavigationActionTarget,
  context: NavigationActionContext,
): Promise<boolean> {
  if (target.dataset.action === "open-relationship") {
    const key = target.dataset.key ?? "";
    await context.navigation.navigate({
      tab: "relationships",
      selectedRelationship: key,
      relationshipPerson: "",
      relationshipMobileDetail: true,
    }, { push: true });
    return true;
  }
  if (target.dataset.action === "back-relationship-list") {
    await context.navigation.back(context.showRelationshipList);
    return true;
  }
  return false;
}

/** Resolve the exact delivered ID after refresh; a replaced record must never select its successor. */
export async function handleSentNowNavigation(target: NavigationActionTarget, context: {
  navigation: DashboardNavigationController;
  getData(): import("../dashboard.js").DashboardData;
  view: import("./now.js").NowView;
  render(): void;
}): Promise<boolean> {
  if (target.dataset.action !== "open-sent-now") return false;
  if (!await context.navigation.navigate({ tab: "world" }, { push: true })) return true;
  await context.navigation.waitForRefresh();
  const data = context.getData();
  const kind = target.dataset.kind === "world_fact" ? "assertion" : target.dataset.kind;
  const chains = buildRecordChains(data);
  const chain = [...chains.values()].find(row => row.kind === kind && String(row.current?.id) === target.dataset.id);
  Object.assign(context.view, { mode: "now", selected: chain?.key ?? `missing:${kind}:${target.dataset.id}`, mobileDetail: true, listOnly: false });
  context.render();
  return true;
}
