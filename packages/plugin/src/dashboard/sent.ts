// "이번 턴에 전달한 기억": the home widget and its full view. Counts follow the tabs (기억/인물/현재),
// never the atoms inside a scene, so 24 scenes with 61 details reads as 24, not 85.
import type { TurnSearch } from "../turn-delivery.js";
import { escapeHtml, icon, btn } from "./film/ui.js";

export type SentScene = {
  memoryId: string;
  no: number;
  titleHtml: string;
  when: string;
  clarity?: "hazy" | "faint";
  details?: number;
  dialogues?: number;
};
export type SentPerson = { key?: string; namesHtml: string; labelHtml: string; meta: string };
export type SentState = { kind: "world_fact" | "basic_relation" | "belief" | "promise" | "relationship" | "recognition"; id: string; key?: string; tag: string; whoHtml: string; textHtml: string };
export type SentSearch = TurnSearch & { expandedMemory?: SentScene; scenes: Array<SentScene & { already: boolean }> };

export type SentData = {
  at?: number;
  tokens: number;
  target: number;
  /** Past the hard ceiling, where the packet would actually be cut. */
  over: boolean;
  estimated: boolean;
  /** 기억만 보내기: 인물·현재 were kept out on purpose. */
  memoryOnly: boolean;
  /** Search did not finish, so only the stable anchors went and nothing was itemised. */
  fallback: boolean;
  scenes: SentScene[];
  spine: number;
  people: SentPerson[];
  peopleCount: number;
  now: SentState[];
  searches: SentSearch[];
  note: string;
  packet: string;
};

export type PacketTranslationView = { key: string; source: string; google: boolean; pending?: boolean; translated?: string; showing?: boolean; error?: string };
export type SentView = { open: boolean; more: Set<string>; packetTranslation?: PacketTranslationView };

const CLARITY_LABEL = { hazy: "흐릿하게", faint: "어렴풋이" } as const;
const FALLBACK_NOTE = "검색이 끝나지 않아 기본 기억만 보냈어요. 항목별 목록은 없어요.";
const SCENES_FIRST = 6;
const PEOPLE_FIRST = 3;
const NOW_FIRST = 6;

const time = (at?: number) => at ? new Date(at).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" }) : "";
const sceneNo = (scene: SentScene) => scene.no > 0 ? `S#${scene.no}` : "";

export function sentTotal(data: SentData): number {
  return data.scenes.length + (data.memoryOnly ? 0 : data.peopleCount + data.now.length);
}

function mix(data: SentData): string {
  const cell = (value: string | number, label: string, off = false) =>
    `<div role="listitem"${off ? ' class="is-off"' : ""}><b>${value}</b><small>${label}</small></div>`;
  return `<div class="sent-mix" role="list" aria-label="종류별 개수">
    ${cell(data.scenes.length, "장면")}
    ${data.memoryOnly ? cell("보내지 않음", "인물", true) : cell(data.peopleCount, "인물")}
    ${data.memoryOnly ? cell("보내지 않음", "현재", true) : cell(data.now.length, "현재")}
    ${cell(data.searches.length, "검색")}
  </div>`;
}

function budget(data: SentData): string {
  const fill = data.target > 0 ? Math.min(100, Math.round(data.tokens / data.target * 100)) : 0;
  const tokens = `${data.estimated ? "약 " : ""}${data.tokens.toLocaleString()} 토큰`;
  return `<p class="sent-budget${data.over ? " is-over" : ""}" role="img" aria-label="목표 ${data.target.toLocaleString()} 토큰 중 ${data.tokens.toLocaleString()} 토큰"><span>${tokens}</span><i style="--v:${fill}%"></i><span>목표 ${data.target.toLocaleString()}</span></p>`;
}

/** The widget: counts, the three newest scenes, the budget, and the way into everything. */
export function sentWidget(data: SentData, phone: boolean): string {
  const shown = [...data.scenes].slice(0, 3);
  const rows = shown.map((scene) => `<button type="button" class="wg__row" data-action="open-timeline-memory" data-memory-id="${escapeHtml(scene.memoryId)}"><span class="wg__no">${sceneNo(scene)}</span><span class="wg__main">${scene.titleHtml}</span>${scene.clarity ? `<span class="wg__haze">${CLARITY_LABEL[scene.clarity]}</span>` : scene.when ? `<span class="wg__end">${escapeHtml(scene.when)}</span>` : ""}</button>`).join("");
  const rest = sentTotal(data) - shown.length;
  const head = phone
    ? `<h2 class="wg__h">${icon("arrow-right")}이번 턴에 전달한 기억${data.at ? `<span class="wg__time">${escapeHtml(time(data.at))}</span>` : ""}</h2>`
    : `<h2 class="sec">이번 턴에 전달한 기억${data.at ? ` <span class="n">${escapeHtml(time(data.at))}</span>` : ""}</h2>`;
  if (data.fallback) return `${head}<p class="wg__empty">${FALLBACK_NOTE}</p><div class="wg__list sent-widget">${budget(data)}<button type="button" class="wg__row wg__more" data-action="open-sent"><span>전체 보기</span><span class="wg__end">${icon("chevron")}</span></button></div>`;
  return `${head}${mix(data)}<div class="wg__list sent-widget">${rows}${budget(data)}<button type="button" class="wg__row wg__more" data-action="open-sent"><span>전체 보기</span><span class="wg__end">${rest > 0 ? `외 ${rest}개` : ""}${icon("chevron")}</span></button></div>`;
}

const chevron = `<span class="sent-row__end">${icon("chevron")}</span>`;
const pill = (clarity?: "hazy" | "faint") => clarity ? `<span class="pill pill--haze">${CLARITY_LABEL[clarity]}</span> ` : "";

function sceneMeta(scene: SentScene): string {
  const parts = [scene.when, scene.details ? `세부 ${scene.details}` : "", scene.dialogues ? `대사 ${scene.dialogues}` : ""].filter(Boolean);
  if (scene.clarity && !scene.details && !scene.dialogues) parts.push("요지만");
  return `${pill(scene.clarity)}${escapeHtml(parts.join(" · "))}`;
}

function sceneRow(scene: SentScene, extra = ""): string {
  return `<button type="button" class="sent-row" data-action="open-timeline-memory" data-memory-id="${escapeHtml(scene.memoryId)}"><span class="sent-row__k">${sceneNo(scene)}</span><span class="sent-row__t">${scene.titleHtml}</span>${chevron}<span class="sent-row__m">${extra}${sceneMeta(scene)}</span></button>`;
}

function stateNavigation(row: SentState): string {
  const identity = `data-kind="${row.kind}" data-id="${escapeHtml(row.id)}"`;
  if (row.kind === "relationship" || row.kind === "basic_relation") return `${identity} data-action="open-relationship" data-key="${escapeHtml(row.key ?? "")}"`;
  if (row.kind === "recognition") return `${identity} data-action="open-relationship-person" data-person-name="${escapeHtml(row.key ?? "")}"`;
  return `${identity} data-action="open-sent-now"`;
}

const CALL_REASONS: Record<string, string> = {
  auxiliary_call: "보조 호출에서는 사용할 수 없어요", tools_disabled: "도구가 꺼져 있어요", chat_disabled: "이 채팅의 기억이 꺼져 있어요",
  empty_query: "질문이 비어 있어요", empty_ref: "기억 주소가 비어 있어요", no_memory: "처리된 기억이 없어요",
  chat_changed: "채팅이 바뀌었어요", earlier_generation: "이전 답변의 호출이에요", invalid_ref: "기억 주소를 사용할 수 없어요",
  snapshot_changed: "기억이 바뀌었어요", transport_error: "통신이 끊겼어요", invalid_packet: "응답 형식을 읽지 못했어요",
  request_cancelled: "호출이 취소됐어요",
  budget_rejected: "응답이 토큰 한도를 넘었어요",
};

function callRow(call: SentSearch, index: number): string {
  const expanded = call.expandedMemory;
  const question = call.kind === "recall" ? `<q>${escapeHtml(call.query)}</q>`
    : `${expanded ? `<button type="button" class="sent-call__memory" data-action="open-timeline-memory" data-memory-id="${escapeHtml(expanded.memoryId)}">${sceneNo(expanded)} ${expanded.titleHtml}</button>` : `<span>${escapeHtml(call.ref ?? "")} · 기억을 확인할 수 없어요</span>`}${call.query ? `<q>${escapeHtml(call.query)}</q>` : ""}`;
  const status = call.reason ? `가져오지 못함 · ${CALL_REASONS[call.reason] ?? "호출을 마치지 못했어요"}`
    : !call.response ? "가져오는 중" : call.scenes.length ? `장면 ${call.scenes.length}개` : "가져온 장면 없음";
  const raw = call.response ? `<details class="sent-call__raw" data-preserve-open="sent-call-${index}"><summary>응답 원문<small>약 ${call.responseTokens.toLocaleString()} 토큰${call.responseTruncated ? " · 잘림 (64 KB까지 표시)" : ""}</small></summary><pre class="packet">${escapeHtml(call.response)}</pre></details>` : "";
  return `<li class="sent-call"><div class="sent-q">${icon(call.kind === "expand" ? "eye" : "search")}<span><b class="sent-call__kind">${call.kind === "expand" ? "기억 펼쳐보기" : "기억 회상"}</b>${question}<small${call.reason ? ' class="is-fail"' : ""}>${escapeHtml(status)}</small></span></div>${call.scenes.map(scene => sceneRow(scene, `${scene.already ? '<span class="pill">이미 전달됨</span> ' : ""}${sceneNo(scene) ? `${sceneNo(scene)} · ` : ""}`)).join("")}${raw}</li>`;
}

function moreButton(view: SentView, key: string, hidden: number): string {
  return hidden > 0 && !view.more.has(key) ? `<li><button type="button" class="sent-more" data-action="sent-more" data-key="${key}">나머지 ${hidden}개 보기</button></li>` : "";
}

/** The full view: everything that went, grouped like the tabs, then what the model looked up itself. */
export function sentPage(data: SentData, view: SentView): string {
  const scenes = view.more.has("scenes") ? data.scenes : data.scenes.slice(0, SCENES_FIRST);
  const people = view.more.has("people") ? data.people : data.people.slice(0, PEOPLE_FIRST);
  const now = view.more.has("now") ? data.now : data.now.slice(0, NOW_FIRST);
  const memorySection = `<h2 class="sent__h">기억 <span class="n">장면 ${data.scenes.length}${data.spine ? ` · 줄거리 ${data.spine}` : ""}</span><small>최근 순</small></h2>
    ${data.scenes.length ? `<ul class="sent-list">${scenes.map((scene) => `<li>${sceneRow(scene)}</li>`).join("")}${moreButton(view, "scenes", data.scenes.length - scenes.length)}</ul>` : '<p class="sent-off">이번에는 장면을 보내지 않았어요.</p>'}`;
  const off = '<p class="sent-off">기억만 보내기가 켜져 있어 보내지 않았어요.</p>';
  const peopleSection = `<h2 class="sent__h">인물 <span class="n">${data.memoryOnly ? "" : data.peopleCount}</span></h2>
    ${data.memoryOnly ? off : data.people.length ? `<ul class="sent-list">${people.map((person) => `<li><button type="button" class="sent-row"${person.key ? ` data-action="open-relationship" data-key="${escapeHtml(person.key)}"` : ' data-action="tab" data-tab="relationships"'}><span class="sent-row__k">관계</span><span class="sent-row__t"><span class="who">${person.namesHtml}</span>${person.labelHtml ? ` · ${person.labelHtml}` : ""}</span>${chevron}${person.meta ? `<span class="sent-row__m">${escapeHtml(person.meta)}</span>` : ""}</button></li>`).join("")}${moreButton(view, "people", data.people.length - people.length)}</ul>` : '<p class="sent-off">이번에는 인물 기록을 보내지 않았어요.</p>'}`;
  const nowSection = `<h2 class="sent__h">현재 <span class="n">${data.memoryOnly ? "" : data.now.length}</span></h2>
    ${data.memoryOnly ? off : data.now.length ? `<ul class="sent-list">${now.map((row) => `<li><button type="button" class="sent-row" ${stateNavigation(row)}><span class="sent-row__k">${escapeHtml(row.tag)}</span><span class="sent-row__t is-text"><span class="who">${row.whoHtml}</span> · ${row.textHtml}</span>${chevron}</button></li>`).join("")}${moreButton(view, "now", data.now.length - now.length)}</ul>` : '<p class="sent-off">이번에는 현재 기록을 보내지 않았어요.</p>'}`;
  const searchSection = data.searches.length ? `<h2 class="sent__h">답변 중 찾아본 기억 <span class="n">${data.searches.length}번</span></h2>
    <ul class="sent-list">${data.searches.map(callRow).join("")}</ul>` : "";
  const translation = view.packetTranslation;
  const controls = `<div class="sent-raw__tools">${translation?.google ? '<small>Google 번역은 태그도 함께 번역돼요</small>' : ""}${btn(translation?.pending ? "번역 중…" : translation?.showing ? "원문으로" : "번역해서 보기", { kind: "quiet", action: "translate-sent-packet", disabled: translation?.pending })}</div>${translation?.error ? `<p class="sent-raw__error" role="status">번역하지 못했어요 · ${escapeHtml(translation.error)}</p>` : ""}`;
  const raw = data.packet ? `<details class="sent-raw" data-preserve-open="sent-raw"><summary>원문 보기<small>메인 모델이 받은 그대로</small><span class="chev" aria-hidden="true">${icon("chevron")}</span></summary>${controls}<pre class="packet">${escapeHtml(translation?.showing ? translation.translated ?? data.packet : data.packet)}</pre></details>` : "";
  return `<div class="sent">
    <div class="sent__top"><button type="button" class="back" data-action="close-sent">${icon("back")}홈</button></div>
    <div class="sent__head">
      <div>
        <h1 class="pagetitle">이번 턴에 전달한 기억</h1>
        <p class="sent__when">${escapeHtml([data.at ? `${time(data.at)}에 준비` : "", `${data.estimated ? "약 " : ""}${data.tokens.toLocaleString()} 토큰 (목표 ${data.target.toLocaleString()})`].filter(Boolean).join(" · "))}</p>
        <p class="sent__note">${escapeHtml(data.fallback ? FALLBACK_NOTE : data.note)}${data.searches.length ? " ‘답변 중 찾아본 기억’은 모델이 답변하면서 직접 검색해 가져간 거예요." : ""}</p>
      </div>
      ${data.fallback ? "" : mix(data)}
    </div>
    ${data.fallback ? searchSection + raw : `<div class="sent__cols"><div>${memorySection}</div><div>${peopleSection}${nowSection}${searchSection}${raw}</div></div>`}
  </div>`;
}
