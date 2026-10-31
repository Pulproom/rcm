import type { StoredLandmarkKind } from "@rcm/shared";
import type { ServerClient } from "../api-client.js";
import type { DashboardData } from "../dashboard.js";
import type { PairDiaryFilter, PairDiarySort } from "./pair-detail.js";
import type { MemoryLandmarkPatchQueue } from "./landmark-mutations.js";
import { remapHiddenAnniversariesAfterDelete } from "./diary.js";

export interface PairViewState {
  diaryFilter: PairDiaryFilter;
  diarySort: PairDiarySort;
  anniversaryEditorEntryId: string;
}

export const createPairView = (): PairViewState => ({ diaryFilter: "all", diarySort: "newest", anniversaryEditorEntryId: "" });

export type AnniversaryAction = "toggle-anniversary-always" | "delete-anniversary" | "hide-anniversary";
export function isAnniversaryAction(action: string | undefined): action is AnniversaryAction {
  return ["toggle-anniversary-always", "delete-anniversary", "hide-anniversary"].includes(action ?? "");
}

export interface PairActionHost {
  render(): void;
  openEditor(kind: "new" | "designate" | "cancel"): void;
}

export interface AnniversaryMutationContext {
  getData(): DashboardData;
  getChatId(): string;
  queue: MemoryLandmarkPatchQueue<StoredLandmarkKind>;
  currentLandmarks(memoryId: string): StoredLandmarkKind[];
  confirmDelete(message: string): Promise<boolean>;
}

export interface PairController {
  handleViewAction(action: string | undefined, target: HTMLElement): boolean;
  applyDiarySort(value: string): void;
  changeProgress(action: string, target: HTMLElement, chatId: string): Promise<void>;
  addProgress(form: HTMLFormElement, values: Record<string, FormDataEntryValue>, chatId: string): Promise<void>;
  mutateAnniversary(action: AnniversaryAction, target: HTMLElement, context: AnniversaryMutationContext): Promise<{ refresh: boolean; message: string } | undefined>;
}

const landmarkEntryIdentity = (item: StoredLandmarkKind): string => JSON.stringify([
  item?.kind ?? null, item?.label ?? null, item?.pair ?? null, item?.storyTime ?? null, item?.evidence ?? null,
]);

const landmarkEntryIndex = (items: StoredLandmarkKind[], target: StoredLandmarkKind, preferredIndex: number): number => {
  const identity = landmarkEntryIdentity(target);
  if (items[preferredIndex] && landmarkEntryIdentity(items[preferredIndex]) === identity) return preferredIndex;
  return items.findIndex((item) => landmarkEntryIdentity(item) === identity);
};

/** Refresh, error reporting and shared editor state remain with the dashboard. */
export function createPairController(view: PairViewState, root: HTMLElement,
  client: Pick<ServerClient, "request" | "patchMemory" | "putViewPreferences">, host: PairActionHost): PairController {
  return {
    handleViewAction(action, target) {
      if (action === "pair-diary-filter") {
        const next = target.dataset.value as PairDiaryFilter;
        if (["all", "key", "intimacy", "heart", "promise", "bookmark"].includes(next)) view.diaryFilter = next;
      } else if (action === "anniversary-pick") {
        // The scene log grows a 지정 button on each scene until one is chosen or the pick is cancelled.
        view.anniversaryEditorEntryId = `pick:${target.dataset.key ?? ""}`;
      } else if (action === "designate-anniversary") {
        view.anniversaryEditorEntryId = target.dataset.entryId ?? "";
        host.openEditor("designate");
      } else if (action === "new-anniversary" || action === "new-first-met") {
        view.anniversaryEditorEntryId = action === "new-first-met" ? `new:first-met:${target.dataset.key ?? ""}` : `new:${target.dataset.key ?? ""}`;
        host.openEditor("new");
      } else if (action === "cancel-anniversary") {
        view.anniversaryEditorEntryId = "";
        host.openEditor("cancel");
      } else return false;
      host.render();
      if (action === "anniversary-pick") root.querySelector<HTMLElement>('[data-pair-section="diary"]')?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      if (action === "designate-anniversary") root.querySelector<HTMLInputElement>('#anniversary-form input[name="label"]')?.focus();
      if (action === "new-anniversary" || action === "new-first-met") root.querySelector<HTMLInputElement>('#anniversary-new-form input[name="label"]')?.focus();
      return true;
    },
    applyDiarySort(value) {
      view.diarySort = value === "oldest" ? "oldest" : "newest";
      host.render();
    },
    async changeProgress(action, target, chatId) {
      const kind=action.slice("progress-".length);
      const body={persona:target.dataset.persona,character:target.dataset.character,action:{kind,itemId:target.dataset.itemId,...(kind==="cell"?{side:target.dataset.side,state:target.dataset.state}:{})}};
      await client.request(`/v1/chats/${encodeURIComponent(chatId)}/pair-progress`,{method:"POST",body:JSON.stringify(body)});
    },
    async addProgress(form, values, chatId) {
      await client.request(`/v1/chats/${encodeURIComponent(chatId)}/pair-progress`,{method:"POST",body:JSON.stringify({persona:form.dataset.persona,character:form.dataset.character,action:{kind:"add",label:String(values.label??""),mode:values.mode}})});
    },
    async mutateAnniversary(action, target, context) {
      const { getData, getChatId, queue, currentLandmarks, confirmDelete } = context;
      if (action === "hide-anniversary") {
        const hideKey = target.dataset.hideKey ?? "";
        if (!hideKey) return;
        const hiddenAnniversaries = [...new Set([...(getData().viewPreferences?.hiddenAnniversaries ?? []), hideKey])];
        getData().viewPreferences = await client.putViewPreferences(getChatId(), { hiddenAnniversaries });
        return { refresh: false, message: "기념일 숨김" };
      }
      const memoryId = target.dataset.memoryId ?? "";
      const index = Number(target.dataset.landmarkIndex);
      const memory = getData().memories.find((item) => item.id === memoryId);
      const landmark = Number.isInteger(index) && Array.isArray(memory?.landmarkKinds) ? memory.landmarkKinds[index] : undefined;
      if (!memory || !landmark) throw new Error("변경할 기념일을 찾지 못했습니다.");
      const deleting = action === "delete-anniversary";
      let appliedIndex = index;
      if (deleting) {
        if (landmark.kind !== "anniversary_basis" && !landmark.userDefined) throw new Error("사용자가 지정한 기념일만 삭제할 수 있습니다.");
        if (!await confirmDelete(`기념일 '${String(landmark.label ?? "")}'을 삭제할까요?`)) return;
      }
      await queue.enqueue(memoryId,
        () => currentLandmarks(memoryId),
        (latest) => {
          const next = [...latest];
          appliedIndex = landmarkEntryIndex(next, landmark, index);
          const current = appliedIndex >= 0 ? next[appliedIndex] : undefined;
          if (!current) throw new Error("변경할 기념일을 찾지 못했습니다.");
          if (deleting) next.splice(appliedIndex, 1);
          else next[appliedIndex] = { ...current, alwaysInject: target.dataset.value === "true" };
          return next;
        },
        async (landmarkKinds) => {
          const result = await client.patchMemory(getChatId(), memoryId, { landmarkKinds });
          if (!result.ok) throw new Error("기념일 변경을 저장하지 못했습니다.");
        });
      if (deleting) {
        const hiddenAnniversaries = remapHiddenAnniversariesAfterDelete(
          getData().viewPreferences?.hiddenAnniversaries ?? [], memoryId, appliedIndex,
        );
        getData().viewPreferences = await client.putViewPreferences(getChatId(), { hiddenAnniversaries });
      }
      return { refresh: true, message: action === "delete-anniversary" ? "기념일 삭제됨" : "항상 전달 설정 저장됨" };
    },
  };
}
