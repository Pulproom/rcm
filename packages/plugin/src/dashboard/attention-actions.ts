import type { ServerClient } from "../api-client.js";
import type { DashboardData } from "../dashboard.js";

export type AttentionFilter = "all" | "duplicate" | "conflict" | "audit" | "small";
export type AttentionViewState = { selectedId: string; query: string; filter: AttentionFilter; mobileDetail: boolean };
type AttentionData = Pick<DashboardData, "reconciliationReviews" | "extractionAudits">;
type AttentionMutationAction = "resolve-reconciliation" | "resolve-small-review" | "resolve-small-review-bulk" | "retry-extraction-audit" | "resolve-conflict" | "delete-conflict";
type ReconciliationResolution = "merge" | "distinct" | "update" | "discard";
type MutationResult = { kind: "reconciliation"; reviewId: string; resolution: ReconciliationResolution }
  | { kind: "small" | "audit" | "conflict" };
type ConfirmConflictDelete = (message: string, options: { confirm: string; danger: boolean }) => Promise<boolean>;

const isAttentionFilter = (value: string | undefined): value is AttentionFilter =>
  ["all", "duplicate", "conflict", "audit", "small"].includes(value ?? "");

export const createAttentionView = (): AttentionViewState => ({ selectedId: "", query: "", filter: "all", mobileDetail: false });

export function isAttentionMutationAction(action: string | undefined): action is AttentionMutationAction {
  return ["resolve-reconciliation", "resolve-small-review", "resolve-small-review-bulk", "retry-extraction-audit", "resolve-conflict", "delete-conflict"].includes(action ?? "");
}

export interface AttentionController {
  applyTabFilter(filter: string | undefined): void;
  applySearch(): void;
  handleViewAction(action: string | undefined, target: HTMLElement): boolean;
  mutate(action: AttentionMutationAction, target: HTMLElement, chat: string, data: AttentionData,
    showSmallReviewSaved: (message: string) => void, confirmDelete: ConfirmConflictDelete): Promise<MutationResult | undefined>;
}

/** The caller keeps the shared refresh, dirty-form and error boundaries. */
export function createAttentionController(view: AttentionViewState, root: HTMLElement,
  render: () => void, client: Pick<ServerClient, "request">): AttentionController {
  return {
    applyTabFilter(filter) {
      if (!isAttentionFilter(filter)) return;
      view.filter = filter;
      view.selectedId = "";
      view.query = "";
      view.mobileDetail = false;
    },
    applySearch() {
      const query = view.query.trim().toLocaleLowerCase();
      let visible = 0;
      root.querySelectorAll<HTMLElement>("[data-attention-row]").forEach((row) => {
        const match = !query || Boolean(row.textContent?.toLocaleLowerCase().includes(query));
        row.hidden = !match;
        if (match) visible += 1;
      });
      const empty = root.querySelector<HTMLElement>("[data-attention-search-empty]");
      if (empty) empty.hidden = !query || visible > 0;
    },
    handleViewAction(action, target) {
      if (action === "attention-filter") {
        const next = target.dataset.filter;
        if (!isAttentionFilter(next)) return true;
        view.filter = next;
        view.selectedId = "";
        view.mobileDetail = false;
      } else if (action === "select-attention") {
        view.selectedId = target.dataset.id ?? "";
        view.mobileDetail = Boolean(view.selectedId);
      } else if (action === "attention-back") {
        view.mobileDetail = false;
      } else return false;
      render();
      return true;
    },
    async mutate(action, target, chat, data, showSmallReviewSaved, confirmDelete) {
      if (action === "resolve-reconciliation") {
        const reviewId = target.dataset.id ?? "";
        const resolution = target.dataset.resolution as ReconciliationResolution;
        const review = data.reconciliationReviews.find((item) => item.id === reviewId);
        if (!review) return;
        const form = root.querySelector<HTMLFormElement>(`.reconciliation-edit[data-review-id="${CSS.escape(reviewId)}"]`);
        const values = form ? new FormData(form) : undefined;
        const editedItem = { ...review.incoming };
        if (values) {
          if (review.itemKind === "memory") { editedItem.title = String(values.get("canonicalTitle") ?? editedItem.title); editedItem.content = String(values.get("canonicalContent") ?? editedItem.content); }
          else if ("value" in editedItem) editedItem.value = String(values.get("canonicalValue") ?? editedItem.value);
          else editedItem.content = String(values.get("canonicalValue") ?? editedItem.content);
        }
        await client.request(`/v1/chats/${chat}/reconciliation-reviews/${encodeURIComponent(reviewId)}`, { method: "PATCH", body: JSON.stringify({ action: resolution, targetId: target.dataset.targetId || undefined, editedItem }) });
        return { kind: "reconciliation", reviewId, resolution };
      }
      if (action === "resolve-small-review" || action === "resolve-small-review-bulk") {
        const visibleIds = new Set([...root.querySelectorAll<HTMLElement>("[data-attention-row]")].filter(row => !row.hidden).map(row => row.dataset.id));
        const items = action === "resolve-small-review-bulk"
          ? data.extractionAudits.flatMap(audit => (audit.smallReviews ?? []).filter((item: any) => item.status === "pending" && visibleIds.has(`small:${audit.id}:${item.id}`)).map((item: any) => ({auditId: audit.id, candidateId: item.id})))
          : [{auditId: target.dataset.auditId, candidateId: target.dataset.id}];
        if (!items.length) return;
        const response = await client.request<{items: Array<{message: string}>}>(`/v1/chats/${chat}/small-reviews/resolve`, {method: "POST", body: JSON.stringify({items, action: target.dataset.resolution})});
        showSmallReviewSaved(response.items[0]?.message ?? "후보를 처리했어요.");
        view.mobileDetail = false;
        view.selectedId = "";
        return { kind: "small" };
      }
      if (action === "retry-extraction-audit") {
        const auditId = target.dataset.id ?? "";
        await client.request(`/v1/chats/${chat}/extraction-audits/${encodeURIComponent(auditId)}/retry`, { method: "POST" });
        return { kind: "audit" };
      }
      if (action === "resolve-conflict") {
        await client.request(`/v1/chats/${chat}/conflicts/${encodeURIComponent(target.dataset.id ?? "")}`, { method: "PATCH", body: JSON.stringify({ resolution: target.dataset.resolution }) });
      } else {
        if (!await confirmDelete("확인 완료한 충돌 기록을 삭제할까요?", { confirm: "충돌 기록 삭제", danger: true })) return;
        await client.request(`/v1/chats/${chat}/conflicts/${encodeURIComponent(target.dataset.id ?? "")}`, { method: "DELETE" });
      }
      return { kind: "conflict" };
    },
  };
}
