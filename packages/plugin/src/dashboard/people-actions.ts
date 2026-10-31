import { EntityBirthdaySchema } from "@rcm/shared";
import type { ServerClient } from "../api-client.js";
import type { DashboardData } from "../dashboard.js";
import { lex } from "./lexicon.js";
import { renderPersonColorPicker } from "./person.js";

export interface PeopleViewState {
  selectedId: string;
  query: string;
  prominence: "all" | "primary" | "supporting" | "reference";
  editing: boolean;
  mobileDetail: boolean;
  management: "" | "merge" | "delete";
}

export interface SocialEditor {
  locked?: boolean;
  description?: string;
  holder: string;
  subject: string;
  level: string;
  knownAs: string;
  addressTerms?: string;
  editing: boolean;
  focus?: "address";
}

interface SocialKnowledgeRow {
  holder: string;
  subject: string;
  level?: string;
  knownAs?: string[];
  addressTerms?: string[];
  cognition?: Array<{ text: string }>;
  locked?: boolean;
}

export interface EntityMergePreview {
  revision: number;
  source: { id: string; name: string };
  target: { id: string; name: string };
  impact?: Record<string, number>;
  busy?: boolean;
}

export interface EntityDeletePreview {
  entity?: { id: string; name: string };
  impact?: Record<string, number>;
  revision?: number;
  busy?: boolean;
}

export interface PeopleManagementState {
  mergePreview?: EntityMergePreview;
  deletePreview?: EntityDeletePreview;
}

export const createPeopleView = (): PeopleViewState => ({ selectedId: "", query: "", prominence: "all", editing: false, mobileDetail: false, management: "" });

export interface PeopleActionHost {
  getData(): DashboardData;
  getChatId(): string | undefined;
  render(invalidate?: boolean): void;
  prepareEditor(action: "select-person" | "new-person" | "edit-person"): void;
}

type ManagementAction = "preview-entity-merge" | "cancel-entity-merge" | "merge-entities-final" | "open-entity-delete" | "confirm-entity-delete";
export function isPeopleManagementAction(action: string | undefined): action is ManagementAction {
  return ["preview-entity-merge", "cancel-entity-merge", "merge-entities-final", "open-entity-delete", "confirm-entity-delete"].includes(action ?? "");
}

export interface PeopleController {
  applySearch(): void;
  handleViewAction(action: string | undefined, target: HTMLElement): boolean;
  closePerson(action: "close-person" | "close-person-editor", discardChanges: () => Promise<boolean>, back: () => Promise<boolean>): Promise<void>;
  enterMerge(): void;
  saveColor(form: HTMLFormElement, color: string | null, refresh: () => Promise<void>): Promise<void>;
  savePerson(action: "save-initial-entity" | "add-initial-entity", target: HTMLElement, chat: string): Promise<boolean | undefined>;
  deleteInitialPerson(target: HTMLElement, chat: string, confirmDelete: (message: string) => Promise<boolean>): Promise<boolean | undefined>;
  manage(action: ManagementAction, target: HTMLElement, chat: string): Promise<{ refresh: boolean; resetRelationship?: boolean; message?: string } | undefined>;
  setPersona(target: HTMLElement, chatId: string): Promise<string>;
  socialEditor(action: "new-social" | "edit-social" | "edit-address", target: HTMLElement): SocialEditor;
  deleteSocial(target: HTMLElement, chat: string): Promise<void>;
}

/** Shared dirty-form, refresh, navigation and action-error boundaries stay in dashboard.ts. */
export function createPeopleController(peopleView: PeopleViewState, management: PeopleManagementState, root: HTMLElement,
  client: Pick<ServerClient, "request" | "putViewPreferences">, host: PeopleActionHost): PeopleController {
  const { getData, getChatId, render } = host;
  return {
    applySearch() {
      const query = peopleView.query.trim().toLocaleLowerCase();
      let visible = 0;
      root.querySelectorAll<HTMLElement>("[data-people-group]").forEach((group) => {
        let groupVisible = 0;
        group.querySelectorAll<HTMLElement>("[data-person-row]").forEach((row) => {
          const match = !query || Boolean((row.dataset.search ?? row.textContent)?.toLocaleLowerCase().includes(query));
          row.hidden = !match;
          if (match) groupVisible += 1;
        });
        group.hidden = groupVisible === 0;
        if (query && groupVisible) {
          if (group instanceof HTMLDetailsElement) group.open = true;
          group.querySelectorAll<HTMLDetailsElement>("details.fold--more").forEach((more) => { more.open = true; });
        }
        visible += groupVisible;
      });
      const count = root.querySelector<HTMLElement>("[data-people-count]");
      if (count) count.textContent = `${visible}명`;
      const empty = root.querySelector<HTMLElement>("[data-people-search-empty]");
      if (empty) empty.hidden = visible > 0;
    },
    handleViewAction(action, target) {
      if (action === "select-person") {
        host.prepareEditor(action);
        const id = target.dataset.id ?? "";
        peopleView.selectedId = peopleView.selectedId === id ? "" : id;
        peopleView.editing = false;
        peopleView.mobileDetail = Boolean(peopleView.selectedId);
        peopleView.management = "";
      } else if (action === "people-filter") {
        const value = target.dataset.value as PeopleViewState["prominence"];
        if (["all", "primary", "supporting", "reference"].includes(value)) peopleView.prominence = value;
        peopleView.selectedId = "";
        peopleView.editing = false;
        peopleView.mobileDetail = false;
        peopleView.management = "";
      } else if (action === "new-person") {
        peopleView.selectedId = "__new__";
        peopleView.editing = true;
        peopleView.mobileDetail = true;
        peopleView.management = "";
        host.prepareEditor(action);
      } else if (action === "edit-person") {
        peopleView.editing = true;
        peopleView.management = "";
        host.prepareEditor(action);
      } else if (action === "close-people-management") {
        peopleView.management = "";
        peopleView.mobileDetail = false;
        management.mergePreview = undefined;
        management.deletePreview = undefined;
      } else if (action === "open-person-color") {
        if (lex().skin !== "phone" || !getChatId()) return true;
        const entity = getData().entities.find(item => item.id === target.dataset.entityId);
        if (!entity) return true;
        const dialog = document.createElement("dialog");
        dialog.className = "dialog person-color-dialog";
        dialog.setAttribute("aria-label", `${entity.name} 색상`);
        dialog.innerHTML = renderPersonColorPicker(entity, getChatId()!);
        root.append(dialog);
        dialog.addEventListener("close", () => { dialog.remove(); root.querySelector<HTMLElement>('[data-action="open-person-color"]')?.focus({ preventScroll: true }); }, { once: true });
        dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
        dialog.showModal();
        return true;
      } else if (action === "close-person-color") {
        target.closest<HTMLDialogElement>("dialog")?.close();
        return true;
      } else return false;
      render(false);
      return true;
    },
    async closePerson(action, discardChanges, back) {
      if (!await discardChanges()) return;
      const adding = peopleView.selectedId === "__new__";
      peopleView.editing = false;
      if (action === "close-person" && await back()) return;
      if (action === "close-person" || adding) {
        peopleView.selectedId = "";
        peopleView.mobileDetail = false;
      }
      render(false);
    },
    enterMerge() {
      peopleView.selectedId = "";
      peopleView.editing = false;
      peopleView.mobileDetail = true;
      peopleView.management = "merge";
      render(false);
    },
    async saveColor(form, color, refresh) {
      const chatId = form.dataset.chatId;
      if (!chatId || getChatId() !== chatId || form.dataset.busy === "true") return;
      form.dataset.busy = "true";
      const errorLine = form.querySelector<HTMLElement>("[data-color-error]")!;
      errorLine.hidden = true;
      form.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = true; });
      try {
        await client.request(`/v1/chats/${encodeURIComponent(chatId)}/entities/${encodeURIComponent(form.dataset.entityId!)}/color`, { method: "PATCH", body: JSON.stringify({ color }) });
        form.closest<HTMLDialogElement>("dialog")?.close();
        if (getChatId() === chatId) await refresh();
      } catch (error) {
        errorLine.textContent = error instanceof Error ? error.message : "색상을 저장하지 못했어요. 다시 시도해 주세요.";
        errorLine.hidden = false;
      } finally {
        form.dataset.busy = "false";
        form.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = false; });
      }
    },
    async savePerson(action, target, chat) {
      const form = target.closest<HTMLFormElement>("form");
      if (!form?.reportValidity()) return;
      const values = new FormData(form);
      const month = Number(values.get("birthdayMonth")), day = Number(values.get("birthdayDay"));
      const year = String(values.get("birthdayYear") ?? "").trim();
      const birthday = month && day ? EntityBirthdaySchema.parse({ month, day, ...(year ? { year: Number(year) } : {}) }) : null;
      const payload = { birthday, displayName: String(values.get("displayName") ?? "").trim(), aliases: String(values.get("aliases") ?? "").split(",").map((item) => item.trim()).filter(Boolean), prominence: String(values.get("prominence") ?? "supporting") };
      const id = action === "save-initial-entity" ? encodeURIComponent(target.dataset.id ?? "") : "";
      await client.request(`/v1/chats/${chat}/initial-calibration/entities${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) });
      peopleView.editing = false;
      if (!id) { peopleView.selectedId = ""; peopleView.mobileDetail = false; }
      return true;
    },
    async deleteInitialPerson(target, chat, confirmDelete) {
      const name = target.dataset.name ?? "이 인물";
      if (!await confirmDelete(`${name}을(를) 초기 이름 장부에서 삭제할까요? 연결된 초기 관계축도 함께 제거됩니다.`)) return;
      await client.request(`/v1/chats/${chat}/initial-calibration/entities/${encodeURIComponent(target.dataset.id ?? "")}`, { method: "DELETE" });
      peopleView.selectedId = "";
      peopleView.editing = false;
      peopleView.mobileDetail = false;
      return true;
    },
    async manage(action, target, chat) {
      if (action === "preview-entity-merge") {
        const form = root.querySelector<HTMLFormElement>("#entity-merge-form");
        if (!form) return;
        const values = new FormData(form);
        const sourceId = String(values.get("sourceId") ?? "");
        const targetId = String(values.get("targetId") ?? "");
        if (!sourceId || !targetId || sourceId === targetId) throw new Error("서로 다른 두 인물을 선택하세요.");
        management.mergePreview = await client.request<EntityMergePreview>(`/v1/chats/${chat}/entities/merge-preview`, { method: "POST", body: JSON.stringify({ sourceId, targetId }) });
        render();
        return { refresh: false };
      } else if (action === "cancel-entity-merge") {
        management.mergePreview = undefined;
        render();
        return { refresh: false };
      } else if (action === "merge-entities-final") {
        await client.request(`/v1/chats/${chat}/entities/merge`, { method: "POST", body: JSON.stringify({ sourceId: target.dataset.sourceId, targetId: target.dataset.targetId, revision: Number(target.dataset.revision) }) });
        management.mergePreview = undefined;
        peopleView.management = "";
        peopleView.mobileDetail = false;
        return { refresh: true, resetRelationship: true };
      } else if (action === "open-entity-delete") {
        const normalize = (value: unknown) => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
        const name = normalize(target.dataset.personName);
        const entity = getData().entities.find((item) => [item.name, item.displayName].some((value) => normalize(value) === name));
        if (!entity) throw new Error("삭제할 인물을 찾지 못했습니다.");
        management.deletePreview = undefined;
        peopleView.management = "delete";
        peopleView.mobileDetail = true;
        render(false);
        const preview = await client.request<EntityDeletePreview>(`/v1/chats/${chat}/entities/${encodeURIComponent(String(entity.id))}/delete-preview`, { method: "POST", body: "{}" });
        // The panel names the person the way the list does.
        management.deletePreview = { ...preview, entity: { ...preview?.entity, id: preview?.entity?.id ?? entity.id, name: entity.displayName || entity.name || preview?.entity?.name } };
        render(false);
        return { refresh: false };
      } else if (action === "confirm-entity-delete") {
        management.deletePreview = { ...management.deletePreview, busy: true };
        render(false);
        try {
          await client.request(`/v1/chats/${chat}/entities/${encodeURIComponent(target.dataset.id ?? "")}?revision=${encodeURIComponent(target.dataset.revision ?? "")}`, { method: "DELETE" });
        } catch (error) {
          management.deletePreview = { ...management.deletePreview, busy: false };
          const text = String(error);
          throw new Error(text.includes("ENTITY_DELETE_BUSY") ? "기억 정리가 진행 중이라 지금은 삭제할 수 없습니다. 잠시 후 다시 시도하세요."
            : text.includes("ENTITY_DELETE_STALE") ? "확인한 뒤 기록이 바뀌었습니다. 인물 삭제를 다시 열어 확인해 주세요."
              : text.includes("ENTITY_IS_PERSONA") ? "페르소나는 삭제할 수 없습니다. 먼저 페르소나 지정을 해제하세요." : text);
        }
        const deletedName = String(management.deletePreview?.entity?.name ?? "");
        management.deletePreview = undefined;
        peopleView.management = "";
        peopleView.selectedId = "";
        peopleView.mobileDetail = false;
        return { refresh: true, resetRelationship: true, message: deletedName ? `${deletedName} 삭제됨` : "인물 삭제됨" };
      }
    },
    async setPersona(target, chatId) {
      const personaEntity = target.dataset.personaEntity?.trim() || null;
      await client.putViewPreferences(chatId, { personaEntity });
      return personaEntity ? `${personaEntity} 페르소나 지정됨` : "페르소나 지정 해제됨";
    },
    socialEditor(action, target) {
      if (action === "edit-address") {
        // The record may not exist yet: two people who share a scene have met, so a new one starts as 직접 교류.
        const holder = target.dataset.holder ?? "", subject = target.dataset.subject ?? "";
        const existing: SocialKnowledgeRow | undefined = getData().socialKnowledge.find((item) => item.holder === holder && item.subject === subject);
        return {
          holder, subject, focus: "address", editing: Boolean(existing), locked: existing?.locked ?? false,
          level: String(existing?.level ?? "interacted"), knownAs: (existing?.knownAs ?? []).join(", "),
          addressTerms: (existing?.addressTerms ?? []).join(", "),
        };
      }
      return {
        holder: action === "edit-social" ? target.dataset.holder ?? "" : "",
        subject: action === "edit-social" ? target.dataset.subject ?? "" : "",
        level: action === "edit-social" ? target.dataset.level ?? "aware_of" : "aware_of",
        knownAs: action === "edit-social" ? target.dataset.knownAs ?? "" : "",
        addressTerms: action === "edit-social" ? (getData().socialKnowledge.find(item => item.holder === target.dataset.holder && item.subject === target.dataset.subject)?.addressTerms ?? []).join(", ") : "",
        description: action === "edit-social" ? (getData().socialKnowledge.find(item => item.holder === target.dataset.holder && item.subject === target.dataset.subject)?.cognition ?? []).map((item: { text: string }) => item.text).join("\n") : "",
        locked: action === "edit-social" ? getData().socialKnowledge.find(item => item.holder === target.dataset.holder && item.subject === target.dataset.subject)?.locked ?? false : false,
        editing: action === "edit-social",
      };
    },
    async deleteSocial(target, chat) {
      await client.request(`/v1/chats/${chat}/social-knowledge`, { method: "DELETE", body: JSON.stringify({ holder: target.dataset.holder, subject: target.dataset.subject }) });
    },
  };
}
