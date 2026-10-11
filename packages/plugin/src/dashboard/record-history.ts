import { formatStoryTime } from "@rcm/shared";
import type { DashboardData } from "../dashboard.js";
import { displayText } from "../translation.js";
import type { TranslationDisplay } from "../types.js";
import { sceneLocator, type SceneRef } from "./scenes.js";
import { icon, menu, type MenuItem } from "./film/ui.js";
import { nameHtml } from "./film/names.js";

/**
 * A record's change history. Every version of a state, belief or promise stays in the ledger when it is
 * replaced or ended; versions sharing a subject and predicate (or a promise key) form one chain, newest first.
 * Only stored fields are compared (kind, polarity, status, user edits) — never the wording.
 */

export type RecordKind = "assertion" | "belief" | "promise";
export type RecordType = "promise" | "belief" | "condition" | "goal" | "secret";
export type RecordVersion = {
  id: string;
  item: any;
  text: string;
  textKey: string;
  from: number | null;
  to: number | null;
  /** State kind, belief polarity or promise status, already labelled. */
  tag: string;
  userEdited: boolean;
  /** The user deleted it as wrong; it stays readable under 지난 기록 only. */
  deleted?: boolean;
  reason?: string;
  reasonKey?: string;
};
export type RecordChain = {
  key: string;
  kind: RecordKind;
  type: RecordType;
  owner: string;
  /** The live record; null once the chain has ended. */
  current: any | null;
  versions: RecordVersion[];
  endedAt: number | null;
};

export const STATE_KIND_LABELS: Record<string, string> = { condition: "상태", goal: "목표", secret: "비밀" };
export const POLARITY_LABELS: Record<string, string> = { believes: "믿음", suspects: "의심", denies: "부정", knows: "확신", heard: "전해 들음" };
export const PROMISE_STATUS_LABELS: Record<string, string> = { open: "이행 전", kept: "이행됨", broken: "파기됨", released: "의무 해제", offscreen: "시점 경과", invalidated: "근거 무효", removed: "목록에서 지운 약속" };
const PREDICATE_LABELS: Record<string, string> = {
  located_in: "위치", controls: "통제", owns: "소유", is_open: "개방 상태", status: "상태",
  intends_to_leave: "떠날 의도", knows_about: "알고 있는 사실", trusts: "신뢰 판단",
};
export const predicateLabel = (value: unknown): string => PREDICATE_LABELS[String(value)] ?? String(value ?? "속성").replaceAll("_", " ");

const norm = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const ordinal = (value: unknown): number | null => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const escapeHtml = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export const assertionChainKey = (item: any): string => `assertion:${norm(item?.subject)}|${norm(item?.predicate)}`;
export const beliefChainKey = (item: any): string => `belief:${norm(item?.holder)}|${norm(item?.subject)}|${norm(item?.predicate)}`;
export const promiseChainKey = (item: any): string => `promise:${String(item?.promise_key || item?.promise_id || item?.id || "")}`;
export const chainKeyFor = (kind: RecordKind, item: any): string => kind === "assertion" ? assertionChainKey(item) : kind === "belief" ? beliefChainKey(item) : promiseChainKey(item);
/** The chain a live record leads; a record alive beside another under the same name has its own. */
export const liveChainKey = (chains: ReadonlyMap<string, RecordChain>, kind: RecordKind, item: any): string => {
  for (const chain of chains.values()) if (chain.kind === kind && chain.current === item) return chain.key;
  return chainKeyFor(kind, item);
};

const stateType = (item: any): RecordType => {
  const kind = String(item?.stateKind ?? item?.state_kind ?? "condition");
  return kind === "goal" || kind === "secret" ? kind : "condition";
};
const newestFirst = (left: RecordVersion, right: RecordVersion): number =>
  (right.from ?? -1) - (left.from ?? -1) || Number(right.item?.created_at ?? 0) - Number(left.item?.created_at ?? 0);

/** Every state, belief and promise chain of the chat, keyed by `chainKeyFor`. Social relations live on the relationship page. */
export function buildRecordChains(data: Pick<DashboardData, "assertions" | "endedAssertions" | "beliefs" | "endedBeliefs" | "promises" | "promiseHistory"> & { userDeletedBeliefs?: any[] }): Map<string, RecordChain> {
  const chains = new Map<string, RecordChain>();
  const chainFor = (key: string, kind: RecordKind, type: RecordType, owner: string): RecordChain => {
    const existing = chains.get(key);
    if (existing) return existing;
    const created: RecordChain = { key, kind, type, owner, current: null, versions: [], endedAt: null };
    chains.set(key, created);
    return created;
  };

  // Versions that follow one another in time are one record; versions alive at the same time under one name
  // (a second goal, a disputed belief) are separate records. The earliest track keeps the plain key.
  type Entry = { item: any; live: boolean; version: RecordVersion };
  const addTracks = (kind: "assertion" | "belief", entries: Entry[], owner: (item: any) => string) => {
    const groups = new Map<string, Entry[]>();
    for (const entry of entries) {
      const base = chainKeyFor(kind, entry.item);
      groups.set(base, [...(groups.get(base) ?? []), entry]);
    }
    for (const [base, group] of groups) {
      // A live version whose start is unknown is the newest; a finished one without a start is the oldest.
      const start = (entry: Entry): number => entry.version.from ?? (entry.live ? Number.POSITIVE_INFINITY : -1);
      const ordered = [...group].sort((left, right) => start(left) - start(right) || Number(left.live) - Number(right.live) || Number(left.item?.created_at ?? 0) - Number(right.item?.created_at ?? 0));
      const tracks: Entry[][] = [];
      for (const entry of ordered) {
        const track = tracks.find((candidate) => {
          const last = candidate[candidate.length - 1]!;
          if (last.live) return false;
          const end = last.version.to ?? last.version.from;
          return end === null || entry.version.from === null || end <= entry.version.from;
        });
        if (track) track.push(entry); else tracks.push([entry]);
      }
      tracks.forEach((track, index) => {
        const lead = track[track.length - 1]!;
        const live = track.find((entry) => entry.live);
        const chain = chainFor(index === 0 ? base : `${base}#${lead.version.id}`, kind, kind === "belief" ? "belief" : stateType(lead.item), owner(lead.item));
        chain.current = live?.item ?? null;
        chain.versions = track.map((entry) => entry.version);
      });
    }
  };
  const liveAssertions = new Set(data.assertions ?? []);
  addTracks("assertion", [...(data.assertions ?? []), ...(data.endedAssertions ?? [])].filter((item) => !item?.socialRelation).map((item) => {
    const live = liveAssertions.has(item);
    return { item, live, version: {
      id: String(item?.id ?? ""), item, text: String(item?.value ?? ""),
      textKey: live ? `assertion:${item.id}` : `history:assertions:${item.id}`,
      from: ordinal(item?.valid_from_ordinal ?? item?.lastMention?.ordinal), to: live ? null : ordinal(item?.valid_to_ordinal),
      tag: STATE_KIND_LABELS[String(item?.stateKind ?? item?.state_kind ?? "condition")] ?? "상태",
      userEdited: item?.user_edit_ordinal !== null && item?.user_edit_ordinal !== undefined,
    } };
  }), (item) => String(item?.subject ?? ""));
  const liveBeliefs = new Set(data.beliefs ?? []);
  addTracks("belief", [...(data.beliefs ?? []), ...(data.endedBeliefs ?? [])].map((item) => {
    const live = liveBeliefs.has(item);
    return { item, live, version: {
      id: String(item?.id ?? ""), item, text: String(item?.value ?? ""),
      textKey: live ? `belief:${item.id}` : `history:beliefs:${item.id}`,
      from: ordinal(item?.valid_from_ordinal ?? item?.lastMention?.ordinal), to: live ? null : ordinal(item?.valid_to_ordinal),
      tag: POLARITY_LABELS[String(item?.polarity ?? "believes")] ?? String(item?.polarity ?? "인식"),
      userEdited: item?.user_edit_ordinal !== null && item?.user_edit_ordinal !== undefined,
    } };
  }), (item) => String(item?.holder ?? ""));
  // A belief the user deleted as wrong is its own finished record, never a step of another.
  for (const item of data.userDeletedBeliefs ?? []) {
    const chain = chainFor(`belief-deleted:${item.id}`, "belief", "belief", String(item?.holder ?? ""));
    chain.versions = [{
      id: String(item?.id ?? ""), item, text: String(item?.value ?? ""), textKey: `history:beliefs:${item.id}`,
      from: ordinal(item?.valid_from_ordinal ?? item?.lastMention?.ordinal), to: ordinal(item?.valid_to_ordinal),
      tag: POLARITY_LABELS[String(item?.polarity ?? "believes")] ?? "인식", userEdited: true, deleted: true,
    }];
  }

  // A promise's chain is its event log; the live row is the newest event while it is still open.
  const events = new Map<string, any[]>();
  for (const event of data.promiseHistory ?? []) {
    if (event?.active === 0 || event?.active === false) continue;
    const key = promiseChainKey(event);
    events.set(key, [...(events.get(key) ?? []), event]);
  }
  const eventVersion = (event: any): RecordVersion => ({
    id: String(event?.id ?? ""), item: event, text: String(event?.content ?? ""), textKey: `history:promises:${event.id}`,
    from: ordinal(event?.source_ordinal), to: null,
    tag: PROMISE_STATUS_LABELS[String(event?.status)] ?? String(event?.status ?? "약속"), userEdited: event?.user_authored === 1 || event?.user_authored === true,
    ...(String(event?.status_reason ?? "").trim() ? { reason: String(event.status_reason), reasonKey: `promise-reason:${event.id}` } : {}),
  });
  for (const promise of data.promises ?? []) {
    const key = promiseChainKey(promise);
    const chain = chainFor(key, "promise", "promise", String(promise?.promisor ?? ""));
    chain.current = promise?.status === "open" ? promise : null;
    const log = events.get(key) ?? events.get(`promise:${promise.id}`) ?? [];
    events.delete(key);
    events.delete(`promise:${promise.id}`);
    chain.versions = log.length ? log.map(eventVersion) : [{
      id: String(promise?.id ?? ""), item: promise, text: String(promise?.content ?? ""), textKey: `promise:${promise.id ?? promise.promise_key}`,
      from: ordinal(promise?.lastMention?.ordinal), to: null, tag: PROMISE_STATUS_LABELS[String(promise?.status)] ?? "약속", userEdited: false,
    }];
    // The open promise is read under its own key, like every other row of 현재.
    if (chain.current && chain.versions.length) chain.versions.sort(newestFirst)[0]!.textKey = `promise:${promise.id ?? promise.promise_key}`;
  }
  // Events whose promise row an older 삭제 removed still read as an ended chain.
  for (const [key, log] of events) {
    const chain = chainFor(key, "promise", "promise", String(log[0]?.promisor ?? ""));
    chain.versions = log.map(eventVersion);
  }

  for (const chain of chains.values()) {
    chain.versions.sort(newestFirst);
    if (chain.current) {
      // The live record always leads, even when a backdated edit gave it an earlier start.
      const index = chain.versions.findIndex((version) => version.item === chain.current || (chain.kind === "promise" && version.textKey.startsWith("promise:")));
      if (index > 0) chain.versions.unshift(...chain.versions.splice(index, 1));
    } else {
      const top = chain.versions[0];
      chain.endedAt = chain.kind === "promise" ? top?.from ?? null : chain.versions.reduce<number | null>((last, version) => version.to !== null && (last === null || version.to > last) ? version.to : last, null);
    }
  }
  return chains;
}

/** How one version gave way to the next, from stored fields only. */
function transition(newer: RecordVersion, older: RecordVersion, kind: RecordKind): string {
  if (newer.userEdited && kind !== "promise") return "직접 수정함";
  if (newer.tag !== older.tag) return kind === "promise" ? `${older.tag}에서 ${newer.tag}` : kind === "belief" ? "인식이 바뀜" : "종류가 바뀜";
  return kind === "promise" ? "약속이 고쳐짐" : "새 내용으로 바뀜";
}

const sceneRange = (from: SceneRef | null, to: SceneRef | null): string => {
  const start = from?.number === undefined ? "" : `S#${from.number}`;
  const end = to?.number === undefined ? "" : `S#${to.number}`;
  return start && end && start !== end ? `${start}–${end}` : start || end;
};

export type RecordDetailOptions = {
  translations: ReadonlyMap<string, string>;
  display: TranslationDisplay;
  back: string;
  actions: Array<MenuItem | "sep">;
  /** The world fact a belief is about, when there is one. */
  fact?: { text: string; key: string };
};

/** One record: what it says now (or last said), then every step it took to get there. */
export function renderRecordDetail(chain: RecordChain, data: Pick<DashboardData, "memories">, options: RecordDetailOptions): string {
  const sceneAt = sceneLocator(data.memories ?? [], (time) => formatStoryTime(time, true));
  const copy = (text: string, key?: string) => displayText(text || "내용 없음", key ? options.translations.get(key) : undefined, options.display);
  const top = chain.versions[0];
  const item = chain.current ?? top?.item ?? {};
  const ownerLink = (name: string) => name ? `<button type="button" class="linkbtn" data-action="open-now-owner" data-owner="${escapeHtml(name)}">${nameHtml(name)}</button>` : "World";
  const kindLabel = chain.kind === "belief" ? "인식" : chain.kind === "promise" ? "약속" : STATE_KIND_LABELS[chain.type] ?? "상태";
  const who = chain.kind === "belief"
    ? `${ownerLink(String(item.holder ?? ""))} → ${escapeHtml(item.subject ?? "")} · ${kindLabel}`
    : chain.kind === "promise" ? `${kindLabel} · ${escapeHtml(PROMISE_STATUS_LABELS[String(item.status)] ?? "")}`
      : `${ownerLink(String(item.subject ?? ""))} · ${kindLabel}`;
  const title = chain.kind === "promise"
    ? `${escapeHtml(item.promisor ?? "미상")} → ${escapeHtml(item.promisee ?? "미상")}`
    : copy(predicateLabel(item.predicate), `${chain.kind}-predicate:${item.id}`);

  const first = top ? sceneAt(top.from) : null;
  const ended = chain.current === null && chain.kind !== "promise";
  const end = chain.endedAt === null ? null : sceneAt(chain.endedAt);
  const span = !first ? "" : chain.current ? `${sceneRange(first, null)}부터 지금까지` : ended && end ? `${sceneRange(first, null)}부터 ${sceneRange(end, null)}까지` : sceneRange(first, null);
  const meta: Array<[string, string]> = [];
  if (span) meta.push(["기록", escapeHtml(span)]);
  if (chain.kind === "belief") {
    meta.push(["인식", escapeHtml(POLARITY_LABELS[String(item.polarity ?? "believes")] ?? String(item.polarity ?? ""))]);
    if (String(item.source ?? "").trim() && !String(item.source).startsWith("user_")) meta.push(["근거", escapeHtml(item.source)]);
  }
  if (chain.kind === "promise" && item.scheduled_for) meta.push(["예정", escapeHtml(formatStoryTime(item.scheduled_for))]);
  const deleted = Boolean(top?.deleted);
  const endLabel = deleted ? '<p class="rec-now__end">직접 삭제함</p>' : ended && end ? `<p class="rec-now__end">${escapeHtml(sceneRange(end, null) || "이전")}에 끝남</p>` : "";
  const card = `<div class="rec-now${ended ? " is-ended" : ""}">${endLabel}<p class="rec-now__text">${copy(top?.text ?? "", top?.textKey)}</p>${meta.length ? `<dl class="rec-now__meta">${meta.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>` : ""}</div>`;
  const truth = options.fact ? `<p class="rec-truth">${icon("clip")}<span>실제 상태 · ${copy(options.fact.text, options.fact.key)}</span></p>` : "";

  // A single live version has no history worth a section; an ended or changed record shows its steps.
  const showSteps = chain.versions.length > 1 || chain.current === null;
  const steps: string[] = [];
  if (ended && end && !deleted) steps.push(`<li class="chg__step is-end"><span class="chg__when"><b>${escapeHtml(sceneRange(end, null) || "끝남")}</b>${sceneLink(end)}</span><p class="chg__text">여기서 끝났어요.</p></li>`, `<li class="chg__how">끝남</li>`);
  chain.versions.forEach((version, index) => {
    const older = chain.versions[index + 1];
    const isNow = index === 0 && chain.current !== null;
    const from = sceneAt(version.from);
    const to = version.to === null ? null : sceneAt(version.to);
    const when = isNow ? "지금" : sceneRange(from, to) || "시점 미상";
    const kindShift = older && chain.kind !== "promise" && older.tag !== version.tag ? `${older.tag} → ${version.tag}` : version.tag;
    const tag = [kindShift, older ? "" : "처음 기록"].filter(Boolean).join(" · ");
    const reason = version.reason ? `<p class="chg__why">${copy(version.reason, version.reasonKey)}</p>` : "";
    const state = isNow ? " is-now" : chain.kind === "promise" && index === 0 && chain.current === null ? (version.item?.status === "kept" ? " is-done" : " is-end") : "";
    // A wrong past version can be deleted on its own; the record itself keeps going.
    const own = !isNow && !version.deleted && chain.kind !== "promise" && version.id
      ? `<span class="chg__acts">${menu({ label: "이 버전 더보기", items: [{ label: "이 버전 삭제", icon: "delete", action: "delete-world", data: { kind: chain.kind, id: version.id }, danger: true }] })}</span>`
      : "";
    steps.push(`<li class="chg__step${state}${own ? " has-acts" : ""}">${own}<span class="chg__when"><b>${escapeHtml(when)}</b>${sceneLink(from)}</span><p class="chg__text">${copy(version.text, version.textKey)}</p>${reason}<span class="chg__tag">${escapeHtml(tag)}</span></li>`);
    if (older) steps.push(`<li class="chg__how">${escapeHtml(transition(version, older, chain.kind))}</li>`);
  });
  const history = showSteps ? `<section class="psec rec-history"><h2 class="sec">변화 <span class="n">${chain.versions.length}</span></h2><ol class="chg">${steps.join("")}</ol></section>` : "";
  const actions = options.actions.length ? `<div class="reader__acts">${menu({ label: "기록 더보기", items: options.actions })}</div>` : "";
  return `<article class="reader rec"><div class="reader__bar"><button type="button" class="back hit" data-action="now-back">${icon("back")}<span>${escapeHtml(options.back)}</span></button>${actions}</div><p class="rec-who">${who}</p><h2 class="reader__title">${title}</h2>${card}${truth}${history}</article>`;
}

const sceneLink = (scene: SceneRef | null): string => scene
  ? `<button type="button" class="linkbtn chg__scene" data-action="open-timeline-memory" data-memory-id="${escapeHtml(scene.memoryId)}">${escapeHtml(scene.place ?? scene.label)}</button>`
  : "";
