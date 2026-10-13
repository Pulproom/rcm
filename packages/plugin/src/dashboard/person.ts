import type { DashboardData } from "../dashboard.js";
import { displayText } from "../translation.js";
import type { TranslationDisplay } from "../types.js";
import { buildPairs, entityForName, entityProminence, PERSON_PROMINENCE_OPTIONS, type PairSummary } from "./pairs.js";
import { avatar, btn, field, fold, icon, iconBtn, menu, promiseEntry } from "./film/ui.js";
import { pairSceneCount, renderRelationshipRow } from "./pair-detail.js";
import { nameHtml } from "./film/names.js";

export type LedgerRow = {
  id?: string;
  subject?: string;
  predicate?: string;
  value?: string;
  stateKind?: string;
  knownBy?: string[];
  socialRelation?: { kind?: string; label?: string; target?: string };
  [key: string]: unknown;
};
export type PromiseRow = {
  id?: string;
  promise_key?: string;
  promisor?: string;
  promisee?: string;
  content?: string;
  status?: string;
  scheduled_for?: string;
  [key: string]: unknown;
};
export type BeliefRow = {
  id?: string;
  holder?: string;
  subject?: string;
  predicate?: string;
  value?: string;
  [key: string]: unknown;
};
export type AcquaintanceRow = {
  holder?: string;
  subject?: string;
  level?: string;
  knownAs?: string[];
  addressTerms?: string[];
  derived?: "mutual_interaction";
  derivedFrom?: string;
  cognition?: Array<{ id?: string; text?: string }>;
  [key: string]: unknown;
};

export type PersonDetail = {
  name: string;
  prominence: string;
  aliases: string[];
  affiliations: string[];
  /** The same 소속, with the ledger ids their row menus act on. */
  affiliationRecords?: Array<{ id: string; label: string }>;
  /** 소속 that ended, newest first. */
  endedAffiliations?: LedgerRow[];
  isPersona: boolean;
  now: { condition: LedgerRow[]; goal: LedgerRow[]; secret: LedgerRow[]; ended: LedgerRow[] };
  personaPair: PairSummary | null;
  openPromises: PromiseRow[];
  endedPromises: PromiseRow[];
  beliefs: { held: BeliefRow[]; about: BeliefRow[]; endedHeld?: BeliefRow[]; endedAbout?: BeliefRow[] };
  otherPairs: PairSummary[];
  pairScenes: Record<string, number>;
  acquaintances: AcquaintanceRow[];
};

export type SocialEditorState = {
  description?: string;
  holder: string;
  subject: string;
  level: string;
  knownAs: string;
  addressTerms?: string;
  editing: boolean;
  /** "address" edits this direction's names and address terms from the pair sheet. */
  focus?: "address";
};

export type PersonDetailRenderOptions = {
  translations?: Map<string, string>;
  display?: TranslationDisplay;
  personaOverride?: string | null;
  socialEditor?: SocialEditorState;
  socialBackfillBusy?: number;
  socialKnowledgeAvailable?: boolean;
  /** Resolves a source memory id or ordinal to its scene, so each row links to the timeline. */
  sceneAt?: (target: unknown) => { memoryId: string; label: string } | null;
};

const normalizeName = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
const escapeHtml = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const namesForEntity = (entity: any, fallback: string): Set<string> => new Set([
  fallback,
  entity?.name,
  entity?.displayName,
  ...(Array.isArray(entity?.aliases) ? entity.aliases : []),
].map(normalizeName).filter(Boolean));

const pairContains = (pair: PairSummary, names: Set<string>): boolean => names.has(normalizeName(pair.a)) || names.has(normalizeName(pair.b));

const affiliationLabel = (item: any): string => {
  const relation = item?.socialRelation;
  const label = String(relation?.label ?? "").trim();
  const target = String(relation?.target ?? "").trim();
  return [label, target].filter(Boolean).join(" · ");
};

export function buildPersonDetail(data: DashboardData, name: string, personaEntity: string | null): PersonDetail {
  const requested = normalizeName(name);
  const entity = (data.entities ?? []).find((item: any) => namesForEntity(item, "").has(requested));
  const names = namesForEntity(entity, name);
  const canonicalName = String(entity?.name ?? entity?.displayName ?? name).trim() || name;
  const aliases: string[] = [...new Set<string>((Array.isArray(entity?.aliases) ? entity.aliases : [])
    .map((alias: unknown) => String(alias).trim())
    .filter((alias: string) => alias && normalizeName(alias) !== normalizeName(canonicalName)))];
  const matches = (value: unknown): boolean => names.has(normalizeName(value));
  const isPersona = personaEntity !== null && matches(personaEntity);
  const current = (data.assertions ?? []).filter((item: any) => matches(item?.subject) && !item?.socialRelation);
  const byKind = (kind: "condition" | "goal" | "secret") => current.filter((item: any) => String(item?.stateKind ?? "condition") === kind);
  const pairs = buildPairs(data, personaEntity).filter((pair) => pairContains(pair, names));
  // Other people read in the list's order: 주요 → 조연 → 배경, then by name.
  const byProminence = (name: string) => entityProminence(entityForName(data, name));
  const otherOf = (pair: PairSummary) => names.has(normalizeName(pair.a)) ? pair.b : pair.a;
  const pairOrder = (left: PairSummary, right: PairSummary) => byProminence(otherOf(left)) - byProminence(otherOf(right)) || otherOf(left).localeCompare(otherOf(right));
  const counterpart = (item: any) => String(matches(item?.holder) ? item?.subject : item?.holder ?? "");
  const endedOrdinal = (item: any) => Number(item?.valid_to_ordinal ?? item?.validToOrdinal ?? -1);
  const personaPair = !isPersona && personaEntity
    ? pairs.find((pair) => pair.tier === 1 && pairContains(pair, new Set([normalizeName(personaEntity)]))) ?? null
    : null;

  return {
    name: canonicalName,
    prominence: String(entity?.setupProminence ?? entity?.prominence ?? entity?.tier ?? "supporting"),
    aliases,
    affiliations: [...new Set((data.assertions ?? [])
      .filter((item: any) => matches(item?.subject) && item?.socialRelation?.kind === "affiliation")
      .map(affiliationLabel)
      .filter(Boolean))],
    affiliationRecords: (data.assertions ?? [])
      .filter((item: any) => matches(item?.subject) && item?.socialRelation?.kind === "affiliation" && item?.id)
      .map((item: any) => ({ id: String(item.id), label: affiliationLabel(item) }))
      .filter((item: { label: string }) => item.label),
    endedAffiliations: (data.endedAssertions ?? []).filter((item: any) => matches(item?.subject) && item?.socialRelation?.kind === "affiliation")
      .sort((left: any, right: any) => endedOrdinal(right) - endedOrdinal(left)),
    isPersona,
    now: {
      condition: byKind("condition"),
      goal: byKind("goal"),
      secret: byKind("secret"),
      ended: (data.endedAssertions ?? []).filter((item: any) => matches(item?.subject) && !item?.socialRelation && !item?.social_relation_json)
        .sort((left: any, right: any) => endedOrdinal(right) - endedOrdinal(left)),
    },
    personaPair,
    openPromises: (data.promises ?? []).filter((item: any) => item?.status === "open" && (matches(item?.promisor) || matches(item?.promisee))),
    endedPromises: (data.promises ?? []).filter((item: any) => item?.status !== "open" && (matches(item?.promisor) || matches(item?.promisee))),
    beliefs: {
      held: (data.beliefs ?? []).filter((item: any) => matches(item?.holder)),
      about: (data.beliefs ?? []).filter((item: any) => matches(item?.subject)),
      // Ended views only; a belief the user deleted is gone, not over.
      endedHeld: (data.endedBeliefs ?? []).filter((item: any) => matches(item?.holder)),
      endedAbout: (data.endedBeliefs ?? []).filter((item: any) => matches(item?.subject)),
    },
    pairScenes: Object.fromEntries(pairs.map((pair) => [pair.key, pairSceneCount(data, pair)])),
    otherPairs: (isPersona ? pairs : pairs.filter((pair) => pair !== personaPair)).sort(pairOrder),
    acquaintances: (data.socialKnowledge ?? []).filter((item: any) => matches(item?.holder) || matches(item?.subject))
      .sort((left: any, right: any) => byProminence(counterpart(left)) - byProminence(counterpart(right)) || counterpart(left).localeCompare(counterpart(right))),
  };
}

type RenderEssentials = Required<Pick<PersonDetailRenderOptions, "translations" | "display">> & Pick<PersonDetailRenderOptions, "sceneAt">;

/**
 * A row's one link: the scene where it was last mentioned (or its source scene), opening that memory on the timeline.
 * Raw source numbers and quoted evidence stay on the timeline reader.
 */
const sceneLink = (item: Record<string, unknown>, options: RenderEssentials, target?: unknown): string => {
  const mention = (item?.lastMention ?? {}) as { ordinal?: unknown };
  const scene = options.sceneAt?.(target ?? item?.source_memory_id ?? item?.sourceMemoryId ?? mention.ordinal) ?? null;
  return scene ? `<button class="linkbtn" type="button" data-action="open-timeline-memory" data-memory-id="${escapeHtml(scene.memoryId)}">${escapeHtml(scene.label)}</button>` : "";
};

/**
 * A ledger line. A state's name is its title; a promise's or belief's direction (who → whom) is a small line
 * above the text. The section heading names the kind, so only an exceptional kind or stance (목표, 비밀, 의심) is tagged.
 */
const entry = (parts: { tag?: string; title?: string; who?: string; body: string; src: string; note?: string }): string => {
  const tag = parts.tag ? `<span class="entry__tag">${parts.tag}</span>` : "";
  // A stance reads after the direction, like a promise's status: "A → B · 의심".
  const who = parts.who ? `<span class="entry__who">${parts.who}${parts.title || !parts.tag ? "" : ` · ${tag}`}</span>` : "";
  const title = parts.title ? `<span class="entry__title">${tag}${parts.title}</span>` : "";
  const bodyTag = parts.title || parts.who ? "" : tag;
  const note = parts.note ? `<small>${parts.note}</small>` : "";
  const src = parts.src ? `<div class="entry__src">${parts.src}</div>` : "";
  return `<li class="entry"><div class="entry__v">${who}${title}<span class="entry__body">${bodyTag}${parts.body}</span>${note}</div>${src}</li>`;
};

const mentionOrdinal = (item: Record<string, unknown>): number => {
  const ordinal = (item?.lastMention as { ordinal?: unknown } | undefined)?.ordinal;
  return typeof ordinal === "number" ? ordinal : -1;
};
const byRecentMention = <T extends Record<string, unknown>>(rows: T[]): T[] => [...rows].sort((left, right) => mentionOrdinal(right) - mentionOrdinal(left));

/** The most recently mentioned rows stay open; the rest fold behind one line so a long story keeps a short sheet. */
const limitedEntries = (rows: string[], limit: number, label: string, preserveKey: string): string => {
  if (!rows.length) return "";
  const shown = `<ul class="entries entries--flat">${rows.slice(0, limit).join("")}</ul>`;
  const rest = rows.slice(limit);
  return rest.length ? `${shown}${fold(label, `<ul class="entries entries--flat">${rest.join("")}</ul>`, { role: "more", count: rest.length, preserveKey })}` : shown;
};

const assertionRow = (item: LedgerRow, tag: string, options: RenderEssentials): string => {
  const predicate = displayText(String(item?.predicate ?? ""), options.translations.get(`assertion-predicate:${item?.id}`), options.display);
  const value = displayText(String(item?.value ?? ""), options.translations.get(`assertion:${item?.id}`), options.display);
  const knownBy = Array.isArray(item?.knownBy) ? item.knownBy.map(String).filter(Boolean) : [];
  // 목표·비밀 is a small kind line above the state's name, like a promise's direction line.
  return entry({ who: tag || undefined, title: predicate, body: value, src: sceneLink(item, options), note: knownBy.length ? `아는 인물 · ${escapeHtml(knownBy.join(" · "))}` : "" });
};

const promiseRow = (item: PromiseRow, options: RenderEssentials): string => {
  const key = `promise:${item?.id ?? item?.promise_key ?? ""}`;
  return promiseEntry({ direction: `${item?.promisor ?? ""} → ${item?.promisee ?? ""}`, scheduledFor: item?.scheduled_for, body: displayText(String(item?.content ?? ""), options.translations.get(key), options.display), src: sceneLink(item, options) });
};

const PROMISE_STATUS_LABELS: Record<string, string> = { kept: "지켜짐", broken: "깨짐", released: "해제됨", cancelled: "취소됨", expired: "만료됨" };

const endedPromiseRow = (item: PromiseRow, options: RenderEssentials): string => {
  const key = `promise:${item?.id ?? item?.promise_key ?? ""}`;
  const status = String(item?.status ?? "");
  return promiseEntry({ direction: `${item?.promisor ?? ""} → ${item?.promisee ?? ""}`, status: PROMISE_STATUS_LABELS[status] ?? status, body: displayText(String(item?.content ?? ""), options.translations.get(key), options.display), src: sceneLink(item, options) });
};

const endedAssertionRow = (item: LedgerRow, options: RenderEssentials): string => {
  const predicate = displayText(String(item?.predicate ?? ""), options.translations.get(`assertion-predicate:${item?.id}`), options.display);
  const value = displayText(String(item?.value ?? ""), options.translations.get(`history:assertions:${item?.id}`), options.display);
  const endedAt = item?.valid_to_ordinal ?? item?.validToOrdinal;
  const scene = typeof endedAt === "number" ? sceneLink(item, options, endedAt) : "";
  return entry({ title: predicate, body: value, src: scene ? `종료 ${scene}` : "" });
};

const endedAffiliationRow = (item: LedgerRow, options: RenderEssentials): string => {
  const endedAt = item?.valid_to_ordinal ?? item?.validToOrdinal;
  const scene = typeof endedAt === "number" ? sceneLink(item, options, endedAt) : "";
  return entry({ who: "소속", body: escapeHtml(affiliationLabel(item)), src: scene ? `종료 ${scene}` : "" });
};

const endedBeliefRow = (item: BeliefRow, lead: string, options: RenderEssentials): string => {
  const endedAt = (item as any)?.valid_to_ordinal;
  const scene = typeof endedAt === "number" ? sceneLink(item, options, endedAt) : "";
  return entry({ who: escapeHtml(lead), body: displayText(String(item?.value ?? ""), options.translations.get(`history:beliefs:${item?.id}`), options.display), src: scene ? `종료 ${scene}` : "" });
};

const POLARITY_LABELS: Record<string, string> = { believes: "믿음", suspects: "의심", denies: "부정", knows: "앎", heard: "전해 들음" };

const beliefRow = (item: BeliefRow, lead: string, options: RenderEssentials): string => {
  const key = `belief:${item?.id ?? ""}`;
  const polarity = String(item?.polarity ?? "believes");
  // 믿음 is the default stance; only a different stance earns a tag.
  return entry({ tag: polarity === "believes" ? "" : escapeHtml(POLARITY_LABELS[polarity] ?? polarity), who: escapeHtml(lead), body: displayText(String(item?.value ?? ""), options.translations.get(key), options.display), src: sceneLink(item, options) });
};

export const socialEditorForm = (editor: SocialEditorState): string => {
  const input = (name: string, label: string, value: string, extra = "") => field({ id: `social-${name}`, label, control: `<input id="social-${name}" class="input" name="${name}" value="${escapeHtml(value)}"${extra}>` });
  return `<form id="social-form" class="form social-editor" data-original-holder="${escapeHtml(editor.editing ? editor.holder : "")}" data-original-subject="${escapeHtml(editor.editing ? editor.subject : "")}"><h4 class="subhead">${editor.editing ? `${escapeHtml(editor.holder)} → ${escapeHtml(editor.subject)}` : "지인 관계 추가"}</h4><div class="form__row">${input("holder", "알고 있는 사람", editor.holder, " required")}${input("subject", "대상 인물", editor.subject, " required")}</div>${field({ id: "social-level", label: "상태", control: `<select id="social-level" class="select" name="level"><option value="aware_of" ${editor.level === "aware_of" ? "selected" : ""}>존재를 알고 있음</option><option value="interacted" ${editor.level === "interacted" ? "selected" : ""}>직접 교류한 기록 있음</option></select>` })}${input("knownAs", "알고 있는 이름·직함", editor.knownAs, ' placeholder="쉼표로 구분"')}${input("addressTerms", "부르는 이름", editor.addressTerms ?? "", ' placeholder="쉼표로 구분"')}${field({ id: "social-description", label: "인지 설명 · 사용자 편집", control: `<textarea id="social-description" class="textarea" name="description">${escapeHtml(editor.description ?? "")}</textarea>` })}<div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-social" })}${btn("저장", { kind: "primary", icon: "save", action: "submit-form" })}</div></form>`;
};

/** Edits directional names while preserving the record's cognition and lock state. */
export const addressEditorForm = (editor: SocialEditorState): string => {
  const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
  return `<form id="social-form" class="form social-editor address-editor" data-original-holder="${escapeHtml(editor.editing ? editor.holder : "")}" data-original-subject="${escapeHtml(editor.editing ? editor.subject : "")}"><h3 class="subhead">${escapeHtml(editor.holder)} → ${escapeHtml(editor.subject)}</h3>${hidden("holder", editor.holder)}${hidden("subject", editor.subject)}${hidden("level", editor.level || "interacted")}${field({ id: "social-knownAs", label: "알고 있는 이름", control: `<input id="social-knownAs" class="input notranslate" translate="no" name="knownAs" value="${escapeHtml(editor.knownAs)}" placeholder="쉼표로 구분">` })}${field({ id: "social-addressTerms", label: "부르는 이름", control: `<input id="social-addressTerms" class="input notranslate" translate="no" name="addressTerms" value="${escapeHtml(editor.addressTerms ?? "")}" placeholder="쉼표로 구분">`, hint: "대사에서 상대를 부를 때 쓰는 이름입니다." })}<div class="form__bar">${btn("취소", { kind: "quiet", action: "cancel-social" })}${btn("저장", { kind: "primary", icon: "save", action: "submit-form" })}</div></form>`;
};

/**
 * 아는 사이 as a contact list: both directions between this person and one other read as one contact.
 * The row is the person list's contact row; opening it shows each direction's names as tags
 * (blue for what they call, grey for learned names) and the scene that taught it.
 */
const acquaintanceContacts = (person: string, selfNames: string[], items: AcquaintanceRow[], options: RenderEssentials): string => {
  const self = new Set(selfNames.map((name) => name.trim().toLocaleLowerCase()).filter(Boolean));
  const counterpart = (item: AcquaintanceRow) => self.has(String(item?.holder ?? "").trim().toLocaleLowerCase()) ? String(item?.subject ?? "") : String(item?.holder ?? "");
  const groups = new Map<string, AcquaintanceRow[]>();
  for (const item of items) {
    const other = counterpart(item);
    const key = other.trim().toLocaleLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const tags = (label: string, values: string[], kind: "call" | "known") => values.length
    ? `<div class="acq__tagrow"><span class="acq__k">${label}</span><span class="acq__tags notranslate" translate="no">${values.map((value) => `<span class="acq__tag acq__tag--${kind}">${escapeHtml(value)}</span>`).join("")}</span></div>`
    : `<div class="acq__tagrow"><span class="acq__k">${label}</span><span class="is-empty">아직 없음</span></div>`;
  const side = (item: AcquaintanceRow) => {
    const data = { holder: String(item?.holder ?? ""), subject: String(item?.subject ?? "") };
    const met = item?.level === "interacted";
    const calls = (item?.addressTerms ?? []).filter(Boolean);
    const known = (item?.knownAs ?? []).filter(Boolean);
    const memo = (item?.cognition ?? []).map((detail: any) => `<p class="acq__memo">${displayText(String(detail?.text ?? ""), options.translations.get(`social-cognition:${detail?.id}`), options.display)}</p>`).join("");
    const derivedOnly = item.derived === "mutual_interaction" && item.id === `mutual:${item.derivedFrom}`;
    const edit = menu({ label: `${data.holder} → ${data.subject} 편집`, items: [
      { label: derivedOnly ? "추가" : "수정", icon: derivedOnly ? "add" : "edit", action: "edit-social", data: { ...data, level: String(item?.level ?? ""), knownAs: (item?.knownAs ?? []).join(", ") } },
      ...(derivedOnly ? [] : [{ label: "삭제", icon: "delete" as const, action: "delete-social", data, danger: true }]),
    ], face: { html: derivedOnly ? "추가" : "편집", className: "acq__edit" } });
    return `<div class="acq__side" data-social-row><div class="acq__h"><b>${escapeHtml(data.holder)} → ${escapeHtml(data.subject)}</b><span class="acq__lv${met ? " is-met" : ""}">${met ? "직접 교류" : "존재만 앎"}</span>${edit}</div>${tags("알고 있는 이름", known, "known")}${tags("부르는 이름", calls, "call")}${memo}</div>`;
  };
  const contacts = [...groups.values()].map((rows) => {
    const other = counterpart(rows[0]!);
    // This person's own view leads; the other's view of them follows.
    const ordered = [...rows].sort((left, right) => Number(self.has(String(right?.holder ?? "").trim().toLocaleLowerCase())) - Number(self.has(String(left?.holder ?? "").trim().toLocaleLowerCase())));
    const metCount = rows.filter((item) => item?.level === "interacted").length;
    const how = metCount === 0 ? '<span class="acq__how">이름만 앎</span>' : `<span class="acq__how is-met">${icon("check")}만난 사이</span>`;
    const lead = ordered[0]!;
    const hint = (lead?.addressTerms ?? []).filter((name) => name !== other).slice(0, 2).join(", ") || (lead?.knownAs ?? []).find((name) => name !== other) || "";
    const sub = `${how}${hint ? ` · <span class="notranslate" translate="no">${escapeHtml(hint)}</span>` : ""}`;
    return `<li><details class="acq" name="acquaintances:${escapeHtml(person)}" data-preserve-open="acq:${escapeHtml(person)}:${escapeHtml(other)}"><summary class="row contact-row acq__row"><span class="contact-row__avs">${avatar(other)}</span><span class="contact-row__body"><span class="row__title">${nameHtml(other)}</span><span class="row__sub">${sub}</span></span><span class="row__end">${icon("chevron")}</span></summary><div class="acq__body">${ordered.map(side).join("")}</div></details></li>`;
  });
  return contacts.length ? `<ul class="acq-list">${contacts.join("")}</ul>` : "";
};

export function renderPersonDetail(detail: PersonDetail, options: PersonDetailRenderOptions = {}): string {
  const renderOptions: RenderEssentials = {
    translations: options.translations ?? new Map<string, string>(),
    display: options.display ?? "en",
    sceneAt: options.sceneAt,
  };
  const prominence = PERSON_PROMINENCE_OPTIONS[entityProminence({ prominence: detail.prominence })]!.label;
  const pairs = [...(detail.personaPair ? [detail.personaPair] : []), ...detail.otherPairs];
  // 별칭 is titled like every other section; editing lives in the page's ··· menu (이름·별칭 수정).
  const aliases = `<h3 class="sec">별칭</h3><ul class="entries entries--flat person__facts"><li class="entry person__aliases"><span class="entry__body notranslate${detail.aliases.length ? "" : " is-empty"}" translate="no">${detail.aliases.length ? escapeHtml(detail.aliases.join(" · ")) : "아직 없음"}</span></li></ul>`;
  const facts = [
    // Each 소속 is its own row, so it can be edited, ended or deleted where it is read.
    ...(detail.affiliationRecords?.length
      ? detail.affiliationRecords.map((item) => {
        const data = { kind: "assertion", id: item.id, social: "true" };
        const actions = menu({ label: `소속 ${item.label} 더보기`, items: [
          { label: "수정", icon: "edit", action: "edit-world", data },
          { label: "종료", icon: "inactive", action: "end-world", data },
          "sep",
          { label: "삭제", icon: "delete", action: "delete-world", data, danger: true },
        ] });
        return `<li class="entry entry--promise"><div class="entry__head"><span class="entry__who">소속</span>${actions}</div><span class="entry__body">${escapeHtml(item.label)}</span></li>`;
      })
      : detail.affiliations.length ? [entry({ who: "소속", body: escapeHtml(detail.affiliations.join(" · ")), src: "" })] : []),
  ].join("");
  const overrideMatches = options.personaOverride !== null && options.personaOverride !== undefined && detail.isPersona;
  const personMenu = menu({ label: "인물 더보기", items: [
    { label: "이름·별칭 수정", icon: "edit", action: "edit-person" },
    { label: "기본 관계 추가", icon: "add", action: "new-world", data: { kind: "assertion", social: "true", relationKind: "interpersonal", personName: detail.name } },
    { label: "소속 추가", icon: "add", action: "new-world", data: { kind: "assertion", social: "true", relationKind: "affiliation", personName: detail.name, lockSubject: "true" } },
    overrideMatches
      ? { label: "페르소나 지정 해제", icon: "people", action: "set-persona", data: { personaEntity: "" } }
      : { label: "페르소나로 지정", icon: "people", action: "set-persona", data: { personaEntity: detail.name } },
    // The persona cannot be deleted; unassign it first.
    ...(detail.isPersona ? [] : ["sep" as const, { label: "인물 삭제", icon: "delete", action: "open-entity-delete", data: { personName: detail.name }, danger: true }]),
  ] });
  const header = `<div class="reader__bar"><button type="button" class="back hit" data-action="close-person">${icon("back")}<span>인물</span></button><div class="reader__acts">${personMenu}</div></div><h2 class="person__name">${avatar(detail.name, "xl")}${nameHtml(detail.name)}<span class="tc">${detail.isPersona ? "페르소나" : escapeHtml(prominence)} · 관계 ${pairs.length}</span></h2>`;

  const tags: Record<string, string> = { condition: "", goal: "목표", secret: "비밀" };
  const currentRows = byRecentMention([
    ...detail.now.condition.map((item) => ({ ...item, __tag: tags.condition })),
    ...detail.now.goal.map((item) => ({ ...item, __tag: tags.goal })),
    ...detail.now.secret.map((item) => ({ ...item, __tag: tags.secret })),
  ]).map((item) => assertionRow(item, String(item.__tag), renderOptions));
  const section = (title: string, body: string, count?: number) => `<section class="psec"><h3 class="sec">${title}${count === undefined ? "" : ` <span class="n">${count}</span>`}</h3>${body}</section>`;
  const ended = detail.now.ended.length
    ? fold("종료된 상태", `<ul class="entries entries--flat">${detail.now.ended.map((item) => endedAssertionRow(item, renderOptions)).join("")}</ul>`, { role: "section", count: detail.now.ended.length, preserveKey: `person-ended:${detail.name}` })
    : "";
  const now = currentRows.length || detail.now.ended.length
    ? section("지금", `${limitedEntries(currentRows, 4, "더 보기", `person-now:${detail.name}`)}${ended}`, currentRows.length || undefined)
    : "";
  const endedPromises = detail.endedPromises.length
    ? fold("종료된 약속", `<ul class="entries entries--flat">${byRecentMention(detail.endedPromises).map((item) => endedPromiseRow(item, renderOptions)).join("")}</ul>`, { role: "section", count: detail.endedPromises.length, preserveKey: `person-ended-promises:${detail.name}` })
    : "";
  const promises = detail.openPromises.length || detail.endedPromises.length
    ? section("약속", `${limitedEntries(byRecentMention(detail.openPromises).map((item) => promiseRow(item, renderOptions)), 3, "더 보기", `person-promises:${detail.name}`)}${endedPromises}`, detail.openPromises.length || undefined)
    : "";
  const beliefList = (rows: BeliefRow[], lead: (item: BeliefRow) => string, key: string) =>
    limitedEntries(byRecentMention(rows).map((item) => beliefRow(item, lead(item), renderOptions)), 3, "더 보기", `person-${key}:${detail.name}`);
  // Both halves read as "holder → subject", like promises; each half is its own section, so one label names whose view it is.
  const endedBeliefs = (rows: BeliefRow[] | undefined, lead: (item: BeliefRow) => string, key: string) => rows?.length
    ? fold("종료된 인식", `<ul class="entries entries--flat">${rows.map((item) => endedBeliefRow(item, lead(item), renderOptions)).join("")}</ul>`, { role: "section", count: rows.length, preserveKey: `person-ended-${key}:${detail.name}` })
    : "";
  const heldLead = (item: BeliefRow) => `${detail.name} → ${String(item?.subject ?? "")}`;
  const aboutLead = (item: BeliefRow) => `${String(item?.holder ?? "")} → ${detail.name}`;
  const held = detail.beliefs.held.length || detail.beliefs.endedHeld?.length
    ? section(`${escapeHtml(detail.name)}의 인식`, `${beliefList(detail.beliefs.held, heldLead, "held")}${endedBeliefs(detail.beliefs.endedHeld, heldLead, "held")}`, detail.beliefs.held.length || undefined) : "";
  const about = detail.beliefs.about.length || detail.beliefs.endedAbout?.length
    ? section(`${escapeHtml(detail.name)}에 대한 인식`, `${beliefList(detail.beliefs.about, aboutLead, "about")}${endedBeliefs(detail.beliefs.endedAbout, aboutLead, "about")}`, detail.beliefs.about.length || undefined) : "";
  const beliefs = `${held}${about}`;
  const pairRows = pairs.map((pair) => renderRelationshipRow(pair, detail.pairScenes[pair.key] ?? 0, "", "", renderOptions));
  const relationships = pairs.length ? section(`${escapeHtml(detail.name)}의 관계`, `<div class="list">${pairRows.slice(0, 4).join("")}${pairRows.length > 4 ? fold("더 보기", pairRows.slice(4).join(""), { role: "more", count: pairRows.length - 4, preserveKey: `person-pairs:${detail.name}` }) : ""}</div>`, pairs.length) : "";
  const socialBusy = Number(options.socialBackfillBusy ?? 0);
  const socialActions = `<span class="acq__acts">${options.socialKnowledgeAvailable === false || socialBusy ? "" : iconBtn("refresh", "지인 관계 다시 찾기", { action: "backfill-social" })}${iconBtn("add", "지인 관계 추가", { action: "new-social" })}</span>`;
  const endedAffiliations = detail.endedAffiliations?.length
    ? fold("종료된 소속", `<ul class="entries entries--flat">${detail.endedAffiliations.map((item) => endedAffiliationRow(item, renderOptions)).join("")}</ul>`, { role: "section", count: detail.endedAffiliations.length, preserveKey: `person-ended-affiliations:${detail.name}` })
    : "";
  // Names and 소속 sit open under the title: they go wrong often enough to be checked at a glance.
  const profile = `<section class="psec person__profile">${aliases}${facts ? `<ul class="entries entries--flat person__facts">${facts}</ul>` : ""}${endedAffiliations}</section>`;
  const contactList = acquaintanceContacts(detail.name, [detail.name, ...detail.aliases], detail.acquaintances, renderOptions);
  const people = new Set(detail.acquaintances.map((item) => [item?.holder, item?.subject].map((name) => String(name ?? "").trim().toLocaleLowerCase()).sort().join("|"))).size;
  const acquaintances = detail.acquaintances.length || options.socialEditor || options.socialKnowledgeAvailable === true
    ? `<section class="psec acquaintances"><div class="sec-head"><h2 class="sec">아는 사이 <span class="n">${people}</span></h2>${socialActions}</div>${socialBusy ? `<p class="sub">다시 찾는 중 · ${socialBusy}</p>` : ""}${options.socialEditor ? socialEditorForm(options.socialEditor) : ""}${contactList || (options.socialEditor ? "" : '<p class="sub">아직 아는 사이가 없습니다.</p>')}</section>`
    : "";

  // Every person follows the same section order.
  return `<article class="reader person">${header}${profile}${now}${relationships}${promises}${beliefs}${acquaintances}</article>`;
}
