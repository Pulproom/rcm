import { lex } from "./lexicon.js";
import { defaultPersonColor } from "./person-colors.js";
import { EntityColorSchema, type EntityBirthday } from "@rcm/shared";
import { birthdayLabel } from "./birthdays.js";
import type { DashboardData } from "../dashboard.js";
import { displayText } from "../translation.js";
import type { TranslationDisplay } from "../types.js";
import { buildPairs, entityForName, entityProminence, PERSON_PROMINENCE_OPTIONS, relationshipLabelTranslationKey, type PairSummary } from "./pairs.js";
import { avatar, btn, contactRow, field, fold, icon, iconBtn, menu, promiseEntry } from "./film/ui.js";
import { appListCard, appPromiseRow, pairSceneCount } from "./pair-detail.js";
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
  entityId?: string;
  color?: string | null;
  birthday?: EntityBirthday;
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

export const affiliationLabel = (item: any): string => {
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
    entityId: entity?.id,
    color: entity?.color ?? null,
    birthday: entity?.birthday,
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

const PROMISE_STATUS_LABELS: Record<string, string> = { kept: "지켜짐", broken: "깨짐", released: "취소됨", offscreen: "화면 밖에서 처리됨", cancelled: "취소됨", expired: "만료됨" };

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

/** Who holds a belief about what: the holder's small avatar and name, then the subject. */
const beliefLead = (holder: string, subject: string): string =>
  `<span class="entry__lead">${avatar(holder, "sm")}<b>${escapeHtml(holder)}</b>${icon("arrow-right")}<span>${escapeHtml(subject)}</span></span>`;

const endedBeliefRow = (item: BeliefRow, lead: string, options: RenderEssentials): string => {
  const endedAt = (item as any)?.valid_to_ordinal;
  const scene = typeof endedAt === "number" ? sceneLink(item, options, endedAt) : "";
  return entry({ who: lead, body: displayText(String(item?.value ?? ""), options.translations.get(`history:beliefs:${item?.id}`), options.display), src: scene ? `종료 ${scene}` : "" });
};

const POLARITY_LABELS: Record<string, string> = { believes: "믿음", suspects: "의심", denies: "부정", knows: "앎", heard: "전해 들음" };

const beliefRow = (item: BeliefRow, lead: string, options: RenderEssentials): string => {
  const key = `belief:${item?.id ?? ""}`;
  const polarity = String(item?.polarity ?? "believes");
  // 믿음 is the default stance; only a different stance earns a tag.
  return entry({ tag: polarity === "believes" ? "" : escapeHtml(POLARITY_LABELS[polarity] ?? polarity), who: lead, body: displayText(String(item?.value ?? ""), options.translations.get(key), options.display), src: sceneLink(item, options) });
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
  const copy = (text: string, key: string) => displayText(text, renderOptions.translations.get(key), renderOptions.display);
  const prominence = PERSON_PROMINENCE_OPTIONS[entityProminence({ prominence: detail.prominence })]!.label;
  const pairs = [...(detail.personaPair ? [detail.personaPair] : []), ...detail.otherPairs];
  const pairLabel = (pair: PairSummary) => pair.label ? copy(pair.label, relationshipLabelTranslationKey(pair)) : "";
  const overrideMatches = options.personaOverride !== null && options.personaOverride !== undefined && detail.isPersona;
  const personMenu = menu({ label: "인물 더보기", items: [
    { label: "프로필 수정", icon: "edit", action: "edit-person" },
    { label: "기본 관계 추가", icon: "add", action: "new-world", data: { kind: "assertion", social: "true", relationKind: "interpersonal", personName: detail.name } },
    { label: "소속 추가", icon: "add", action: "new-world", data: { kind: "assertion", social: "true", relationKind: "affiliation", personName: detail.name, lockSubject: "true" } },
    overrideMatches
      ? { label: "페르소나 지정 해제", icon: "people", action: "set-persona", data: { personaEntity: "" } }
      : { label: "페르소나로 지정", icon: "people", action: "set-persona", data: { personaEntity: detail.name } },
    // The persona cannot be deleted; unassign it first.
    ...(detail.isPersona ? [] : ["sep" as const, { label: "인물 삭제", icon: "delete", action: "open-entity-delete", data: { personName: detail.name }, danger: true }]),
  ] });
  const face = lex().skin === "phone" && detail.entityId
    ? `<button type="button" class="person__avatar-button" data-action="open-person-color" data-entity-id="${escapeHtml(detail.entityId)}" aria-label="${escapeHtml(detail.name)} 색상 바꾸기">${avatar(detail.name, "xl")}</button>`
    : avatar(detail.name, "xl");
  // A contact card's head: the face, the name, the names they also go by, and their billing.
  const aka = detail.aliases.length ? `<p class="person__aka notranslate" translate="no">${escapeHtml(detail.aliases.join(" · "))}</p>` : "";
  const roleText = detail.isPersona ? "페르소나" : `${escapeHtml(prominence)} 인물`;
  const role = detail.birthday && lex().skin === "phone"
    ? `<div class="person__chips"><p class="person__role">${roleText}</p><span class="holiday-pill" data-holiday="birthday"><span aria-hidden="true">🎂</span>${escapeHtml(birthdayLabel(detail.birthday))}</span></div>`
    : `<p class="person__role">${roleText}${detail.birthday ? ` · <span data-holiday="birthday">생일 ${escapeHtml(birthdayLabel(detail.birthday))}</span>` : ""}</p>`;
  // Only this tab knows which person you are looking at, so the one shortcut here is the pair with the persona.
  const mine = !detail.isPersona && detail.personaPair ? (() => {
    const pair = detail.personaPair;
    const [me, them] = normalizeName(pair.b) === normalizeName(detail.name) ? [pair.a, pair.b] : [pair.b, pair.a];
    const label = pairLabel(pair);
    return `<button type="button" class="person__mine" data-action="open-relationship" data-key="${escapeHtml(pair.key)}"><span class="person__mine-avs">${avatar(me)}${avatar(them)}</span><span class="person__mine-tx"><span class="person__mine-k">나와의 관계</span><span class="person__mine-t">${nameHtml(me)} &amp; ${nameHtml(them)}${label ? `<span class="person__mine-label">${label}</span>` : ""}</span></span><span class="person__mine-n">${detail.pairScenes[pair.key] ?? 0}장면</span>${icon("chevron")}</button>`;
  })() : "";
  const header = `<div class="reader__bar"><button type="button" class="back hit" data-action="close-person">${icon("back")}<span>인물</span></button><div class="reader__acts">${personMenu}</div></div><header class="person__head"><h2 class="person__name">${face}${nameHtml(detail.name)}</h2>${aka}${role}</header>${mine}`;

  // 소속 as contact fields under the head (aliases already read under the name). Each is its own field, so it can be edited, ended or deleted where it is read.
  const affiliationFields = detail.affiliationRecords?.length
    ? detail.affiliationRecords.map((item) => {
      const data = { kind: "assertion", id: item.id, social: "true" };
      const actions = menu({ label: `소속 ${item.label} 더보기`, items: [
        { label: "수정", icon: "edit", action: "edit-world", data },
        { label: "종료", icon: "inactive", action: "end-world", data },
        "sep",
        { label: "삭제", icon: "delete", action: "delete-world", data, danger: true },
      ] });
      return `<div class="pfield"><span class="pfield__v">${escapeHtml(item.label)}</span>${actions}</div>`;
    })
    : detail.affiliations.map((label) => `<div class="pfield"><span class="pfield__v">${escapeHtml(label)}</span></div>`);
  const endedAffiliations = detail.endedAffiliations?.length
    ? fold("종료된 소속", `<ul class="entries entries--flat">${detail.endedAffiliations.map((item) => endedAffiliationRow(item, renderOptions)).join("")}</ul>`, { role: "section", count: detail.endedAffiliations.length, preserveKey: `person-ended-affiliations:${detail.name}` })
    : "";
  const section = (title: string, body: string, count?: number, head = "") => `<section class="psec">${head ? `<div class="sec-head">` : ""}<h2 class="sec">${title}${count === undefined ? "" : ` <span class="n">${count}</span>`}</h2>${head ? `${head}</div>` : ""}${body}</section>`;
  const profile = affiliationFields.length || endedAffiliations
    ? section("소속", `<div class="stack">${affiliationFields.length ? `<div class="pfields">${affiliationFields.join("")}</div>` : ""}${endedAffiliations}</div>`, affiliationFields.length || undefined)
    : "";

  // 지금 can grow long over a story, so it stays plain text rows: no per-row icon, the newest four open.
  const tags: Record<string, string> = { condition: "", goal: "목표", secret: "비밀" };
  const currentRows = byRecentMention([
    ...detail.now.condition.map((item) => ({ ...item, __tag: tags.condition })),
    ...detail.now.goal.map((item) => ({ ...item, __tag: tags.goal })),
    ...detail.now.secret.map((item) => ({ ...item, __tag: tags.secret })),
  ]).map((item) => assertionRow(item, String(item.__tag), renderOptions));
  const ended = detail.now.ended.length
    ? fold("종료된 상태", `<ul class="entries entries--flat">${detail.now.ended.map((item) => endedAssertionRow(item, renderOptions)).join("")}</ul>`, { role: "section", count: detail.now.ended.length, preserveKey: `person-ended:${detail.name}` })
    : "";
  const now = currentRows.length || detail.now.ended.length
    ? section("지금", `<div class="stack">${limitedEntries(currentRows, 4, "더 보기", `person-now:${detail.name}`)}${ended}</div>`, currentRows.length || undefined)
    : "";

  // 관계 from this person's side: the other person's face and name, the pair's label and scenes.
  const relationRows = pairs.map((pair) => {
    const other = normalizeName(pair.a) === normalizeName(detail.name) ? pair.b : pair.a;
    return contactRow({ names: [other], titleHtml: nameHtml(other), secondary: "", secondaryHtml: [pairLabel(pair), `${detail.pairScenes[pair.key] ?? 0}장면`].filter(Boolean).join(" · "),
      action: "open-relationship", data: { key: pair.key }, kind: "relationship" });
  });
  const relationships = pairs.length ? section("관계", `<div class="list">${relationRows.slice(0, 4).join("")}${relationRows.length > 4 ? fold("더 보기", relationRows.slice(4).join(""), { role: "more", count: relationRows.length - 4, preserveKey: `person-pairs:${detail.name}` }) : ""}</div>`, pairs.length) : "";

  const endedPromises = detail.endedPromises.length
    ? fold("종료된 약속", `<ul class="entries entries--flat">${byRecentMention(detail.endedPromises).map((item) => endedPromiseRow(item, renderOptions)).join("")}</ul>`, { role: "section", count: detail.endedPromises.length, preserveKey: `person-ended-promises:${detail.name}` })
    : "";
  const sceneAt = (target: unknown) => renderOptions.sceneAt?.(target) ?? null;
  const promises = detail.openPromises.length || detail.endedPromises.length
    ? section("약속", `<div class="stack">${detail.openPromises.length ? appListCard(byRecentMention(detail.openPromises).map((item) => appPromiseRow(item, copy, sceneAt)), `person-promises:${detail.name}`) : ""}${endedPromises}</div>`, detail.openPromises.length || undefined)
    : "";

  // 인식: what this person thinks, and what others think of them — one section, two views.
  const beliefList = (rows: BeliefRow[], lead: (item: BeliefRow) => string, key: string) =>
    limitedEntries(byRecentMention(rows).map((item) => beliefRow(item, lead(item), renderOptions)), 3, "더 보기", `person-${key}:${detail.name}`);
  const endedBeliefs = (rows: BeliefRow[] | undefined, lead: (item: BeliefRow) => string, key: string) => rows?.length
    ? fold("종료된 인식", `<ul class="entries entries--flat">${rows.map((item) => endedBeliefRow(item, lead(item), renderOptions)).join("")}</ul>`, { role: "section", count: rows.length, preserveKey: `person-ended-${key}:${detail.name}` })
    : "";
  const heldLead = (item: BeliefRow) => beliefLead(detail.name, String(item?.subject ?? ""));
  const aboutLead = (item: BeliefRow) => beliefLead(String(item?.holder ?? ""), detail.name);
  const views = [
    { key: "held", label: `${escapeHtml(detail.name)}의 생각`, rows: detail.beliefs.held, ended: detail.beliefs.endedHeld, lead: heldLead },
    { key: "about", label: `${escapeHtml(detail.name)}에 대한 생각`, rows: detail.beliefs.about, ended: detail.beliefs.endedAbout, lead: aboutLead },
  ].filter((view) => view.rows.length || view.ended?.length);
  const pane = (view: typeof views[number]) => `<div class="beliefs__pane beliefs__pane--${view.key} stack">${beliefList(view.rows, view.lead, view.key)}${endedBeliefs(view.ended, view.lead, view.key)}</div>`;
  const beliefCount = views.reduce((sum, view) => sum + view.rows.length, 0) || undefined;
  const beliefs = views.length === 2
    ? `<section class="psec beliefs"><div class="sec-head"><h2 class="sec">인식${beliefCount === undefined ? "" : ` <span class="n">${beliefCount}</span>`}</h2><div class="seg seg--sm" role="radiogroup" aria-label="인식 보기">${views.map((view, index) => `<label><input type="radio" name="person-beliefs:${escapeHtml(detail.name)}" value="${view.key}"${index === 0 ? " checked" : ""}><span>${view.label}</span></label>`).join("")}</div></div>${views.map(pane).join("")}</section>`
    : views.length ? section(views[0]!.label, pane(views[0]!), views[0]!.rows.length || undefined) : "";

  const socialBusy = Number(options.socialBackfillBusy ?? 0);
  const socialActions = `<span class="acq__acts">${options.socialKnowledgeAvailable === false || socialBusy ? "" : iconBtn("refresh", "지인 관계 다시 찾기", { action: "backfill-social" })}${iconBtn("add", "지인 관계 추가", { action: "new-social" })}</span>`;
  const contactList = acquaintanceContacts(detail.name, [detail.name, ...detail.aliases], detail.acquaintances, renderOptions);
  const people = new Set(detail.acquaintances.map((item) => [item?.holder, item?.subject].map((name) => String(name ?? "").trim().toLocaleLowerCase()).sort().join("|"))).size;
  const acquaintances = detail.acquaintances.length || options.socialEditor || options.socialKnowledgeAvailable === true
    ? `<section class="psec acquaintances"><div class="sec-head"><h2 class="sec">아는 사이 <span class="n">${people}</span></h2>${socialActions}</div>${socialBusy ? `<p class="sub">다시 찾는 중 · ${socialBusy}</p>` : ""}${options.socialEditor ? socialEditorForm(options.socialEditor) : ""}${contactList || (options.socialEditor ? "" : '<p class="sub">아직 아는 사이가 없습니다.</p>')}</section>`
    : "";

  // Every person follows the same section order.
  return `<article class="reader person appsheet">${header}${profile}${now}${relationships}${promises}${beliefs}${acquaintances}</article>`;
}

export function renderPersonColorPicker(entity: { id: string; name: string; color?: string | null }, chatId: string): string {
  const parsed = EntityColorSchema.safeParse(entity.color);
  const color = parsed.success && parsed.data ? parsed.data : defaultPersonColor(entity.name).hex;
  return `<form id="person-color-form" class="form" data-entity-id="${escapeHtml(entity.id)}" data-chat-id="${escapeHtml(chatId)}"><div class="person-color-head"><span class="person-color-preview" style="--pick:${color}" aria-hidden="true">${escapeHtml(Array.from(entity.name.trim())[0] ?? "?")}</span><div><h2>${escapeHtml(entity.name)}의 색</h2><p class="person-color-note">인물 카드와 관계 그래프에 함께 쓰여요</p></div></div><label class="person-color-field"><span class="sr-only">인물 색상</span><input type="color" name="color" value="${color}" aria-label="인물 색상"><span class="person-color-hint" aria-hidden="true">눌러서 색 고르기</span></label><p class="err" data-color-error aria-live="polite" hidden></p><div class="form__bar">${btn("기본 색으로", { kind: "quiet", action: "reset-person-color" })}${btn("취소", { kind: "quiet", action: "close-person-color" })}${btn("저장", { kind: "primary", action: "submit-form", data: { formId: "person-color-form" } })}</div></form>`;
}
