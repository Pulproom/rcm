import { chartPersonColors } from "./person-colors.js";
import type { DashboardData } from "../dashboard.js";
import type { PairDetailRenderOptions } from "./pair-detail.js";
import { avatar, btn, icon } from "./film/ui.js";
import { dayPart } from "./film/scene.js";
import { type Anniversary, landmarkLabel } from "./diary.js";
import { lex } from "./lexicon.js";
import { MILESTONE_LABELS, pairKey } from "./pairs.js";
import { buildAxisFlow, FLOW_AXES, firstFlowSync, flowKnots, flowPinLabels, flowValueAt, flowY, sharedFlowScale, type AxisFlow, type FlowAxis, type FlowPoint, type CurveSeries, type FlowScale } from "./relationship-flow.js";
import { sceneLocator, sceneNumbers } from "./scenes.js";

export type RelationshipFlowView = { mode?: "now" | "flow"; axis?: string; scene?: number };
export type RelationshipFlowMeta = { anniversaries: Anniversary[]; days: number | null; scenes: number };
type Direction = readonly [string, string, any];
type Copy = PairDetailRenderOptions["copy"];
const esc = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const labels: Record<FlowAxis, string> = { affection: "애정", trust: "신뢰", intimacy: "친밀", fear: "두려움", jealousy: "질투", hostility: "적대" };
const reason = (point: FlowPoint, copy: Copy) => point.reasons.map(item => copy(item.reason, `relationship-event:${item.eventId}:reason`)).join(" · ");
const sign = (delta: number) => delta > 0 ? "▲" : delta < 0 ? "▼" : "•";
const r = (value: number) => Math.round(value * 1000) / 1000;
const xOf = (scene: number, range: readonly [number, number]) => (scene - range[0]) / (range[1] - range[0]) * 100;

function pairFlows(data: DashboardData, a: string, b: string) {
  const numbers = sceneNumbers(data.memories ?? []);
  const locate = sceneLocator(data.memories ?? [], () => "");
  const events = (data.relationshipEvents ?? []).map((event: any) => ({ ...event, sourceMemoryId: event.sourceMemoryId || locate(event.sourceOrdinal)?.memoryId || "" }));
  const direction = (from: string, to: string) => {
    const initial = data.initialCalibration?.relationships?.find((item: any) => item.from === from && item.to === to);
    return buildAxisFlow(events, from, to, id => numbers.get(id), axis => initial?.axes?.[axis]);
  };
  return { series: [direction(a, b), direction(b, a)] as const, range: [1, Math.max(2, ...numbers.values())] as [number, number], numbers };
}
const changesOf = (series: readonly Record<FlowAxis, AxisFlow>[], axis?: FlowAxis) => series.flatMap((flows, person) =>
  (axis ? [axis] : FLOW_AXES).flatMap(axis => flows[axis].points.map(point => ({ point, axis, person }))));

export function renderFlowReadout(data: DashboardData, names: readonly [string, string], axis: FlowAxis, scene: number | undefined, copy: Copy): string {
  if (scene === undefined) return '<p class="duet-hint">그래프를 누르거나 밀어 보세요. 그 장면에서 두 사람의 마음이 어떻게 바뀌었는지 보여줘요.</p>';
  const { series, range, numbers } = pairFlows(data, ...names);
  // That scene's own changes; when it has none, the nearest change within two scenes, so a near miss still answers.
  const all = changesOf(series, axis);
  let changes = all.filter(({ point }) => point.scene === scene);
  if (!changes.length) {
    const near = all.filter(({ point }) => Math.abs(point.scene - scene) <= 2).sort((a, b) => Math.abs(a.point.scene - scene) - Math.abs(b.point.scene - scene))[0];
    changes = near ? all.filter(({ point }) => point.scene === near.point.scene) : [];
  }
  changes.sort((a, b) => a.person - b.person);
  const memoryId = [...numbers].find(([, number]) => number === scene)?.[0];
  return `<div class="duet-readout__head"><b>S#${scene}</b>${memoryId ? btn("장면 열기 ›", { kind: "quiet", action: "open-timeline-memory", data: { memoryId }, hit: true }) : ""}</div>${changes.length ? `<ul>${changes.map(({ point, person }) => `<li class="duet-person-${person}"><span>S#${point.scene} · <b>${esc(names[person])}</b> <i>${sign(point.delta)}</i></span><span>${reason(point, copy)}</span></li>`).join("")}</ul>` : '<p class="duet-hint">이 장면에는 기록된 마음의 변화가 없어요.</p>'}`;
}

const drawnFlows = new Set<string>();

function curve(flow: CurveSeries, range: [number, number], scale: FlowScale): string {
  // Hermite segments as Béziers; the map to plot space is affine, so the curve keeps its shape.
  const { xs, ys, ms } = flowKnots(flow, range[0]);
  const X = (scene: number) => xOf(scene, range), Y = (value: number) => flowY(value, scale);
  let path = `M${r(X(xs[0]!))},${r(Y(ys[0]!))}`;
  for (let i = 0; i < xs.length - 1; i++) {
    const h = xs[i + 1]! - xs[i]!;
    path += ` C${r(X(xs[i]! + h / 3))},${r(Y(ys[i]! + ms[i]! * h / 3))} ${r(X(xs[i + 1]! - h / 3))},${r(Y(ys[i + 1]! - ms[i + 1]! * h / 3))} ${r(X(xs[i + 1]!))},${r(Y(ys[i + 1]!))}`;
  }
  return `${path} L100,${r(Y(ys[ys.length - 1]!))}`;
}

const pinCredits: Record<string, string> = { first_met: "FIRST MEETING", confession: "CONFESSION", romantic_relationship_established: "TOGETHER", engagement: "ENGAGED", marriage: "MARRIED", first_kiss: "FIRST KISS", first_deep_kiss: "FIRST KISS", first_hand_holding: "FIRST TOUCH", first_embrace: "FIRST EMBRACE", first_physical_intimacy: "FIRST INTIMACY", first_sex: "FIRST INTIMACY" };
function chartPins(data: DashboardData, meta: RelationshipFlowMeta, names: readonly [string, string], numbers: Map<string, number>, copy: Copy) {
  const pins = meta.anniversaries.map(item => ({ scene: numbers.get(item.memoryId), label: lex().skin === "film" && !item.userDefined ? esc(pinCredits[item.kind] ?? item.label) : item.userDefined ? copy(item.label, `landmark:${item.hideKey}:label`) : esc(item.label) }));
  for (const memory of data.memories ?? []) for (const [index, landmark] of (memory.landmarkKinds ?? []).entries()) {
    if (landmark.kind !== "intimacy_milestone" || !landmark.pair || pairKey(...landmark.pair as [string, string]) !== pairKey(...names) || data.viewPreferences?.hiddenAnniversaries?.includes(`${memory.id}#${index}`)) continue;
    const intimacy = (data.physicalIntimacy ?? []).find((item: any) => item.sourceMemoryId === memory.id && pairKey(item.participantA, item.participantB) === pairKey(...names));
    const key = intimacy?.milestoneKey ?? "";
    const label = lex().skin === "film" ? pinCredits[key] ?? landmark.label ?? "FIRST INTIMACY" : MILESTONE_LABELS[key] ?? landmarkLabel(landmark);
    pins.push({ scene: numbers.get(memory.id), label: esc(label) });
  }
  return pins.filter((pin): pin is { scene: number; label: string } => pin.scene !== undefined).sort((a, b) => a.scene - b.scene);
}

export function renderRelationshipFlow(data: DashboardData, directions: readonly Direction[], options: PairDetailRenderOptions, meta: RelationshipFlowMeta): string {
  const names: [string, string] = [directions[0]![0], directions[0]![1]];
  const { series, range, numbers } = pairFlows(data, ...names);
  const all = changesOf(series);
  const turning = all.filter(({ point }) => point.turning).sort((a, b) => b.point.scene - a.point.scene)[0];
  const memoryChange = turning ?? all.filter(({ point }) => point.impact === "major").sort((a, b) => b.point.scene - a.point.scene)[0];
  const hasEvents = (axis: FlowAxis) => series.some(flows => flows[axis].points.length > 0);
  const axis = FLOW_AXES.includes(options.flowView?.axis as FlowAxis) ? options.flowView!.axis as FlowAxis : hasEvents("affection") ? "affection" : turning?.axis ?? "affection";
  const axisOrder = [...FLOW_AXES.filter(hasEvents), ...FLOW_AXES.filter(axis => !hasEvents(axis))];
  const chips = axisOrder.map(axisKey => {
    const value = options.axisValue(directions[0]![2], axisKey);
    return `<button type="button" class="duet-chip${hasEvents(axisKey) ? "" : " is-quiet"}" data-action="pair-flow-axis" data-axis="${axisKey}" aria-pressed="${axisKey === axis}"><b>${labels[axisKey]}</b><small>${hasEvents(axisKey) ? `${esc(options.levelLabels[value.level] ?? value.level)} ${value.trend === "rising" ? "▲" : value.trend === "falling" ? "▼" : ""}` : "조용함"}</small></button>`;
  }).join("");
  const flows = series.map(flows => flows[axis]);
  const scale = sharedFlowScale(flows);
  const scene = options.flowView?.scene === undefined ? undefined : Math.max(range[0], Math.min(range[1], options.flowView.scene));
  const colors = chartPersonColors(...names);
  const style = colors.map((color, index) => `--flow-${index === 0 ? "a" : "b"}-h:${r(color.h)};--flow-${index === 0 ? "a" : "b"}-s:${r(color.s)}%;--flow-${index === 0 ? "a" : "b"}-l:${r(color.l)}%`).join(";");
  const header = `<header class="duet-head">${lex().skin === "phone" ? `<div class="duet-avatars pair-avs">${avatar(names[0])}${avatar(names[1])}</div>` : ""}<div><p class="duet-credit">${esc(names.join(" & "))}</p><h3>두 사람의 마음</h3><p class="duet-meta">함께한 ${meta.scenes}장면${meta.days === null ? "" : ` · 처음 만난 지 D+${meta.days}`}</p></div></header>`;
  const pins = chartPins(data, meta, names, numbers, options.copy);
  const pinLayout = flowPinLabels(pins, range, 240);
  const pinHtml = pins.map((pin, index) => `<span class="duet-pin" data-pin-scene="${pin.scene}" style="left:${r(pinLayout[index]!.left)}%"><i>${icon("heart")}</i><span class="duet-pin__label is-${pinLayout[index]!.anchor}"${pinLayout[index]!.showLabel ? "" : " hidden"}>${pin.label}</span></span>`).join("");
  const paths = flows.map((flow, person) => {
    const path = curve(flow, range, scale), id = `duet-fade-${person}`;
    return `<g class="duet-person-${person}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><path class="duet-area" fill="url(#${id})" d="${path} L100,100 L0,100 Z"/><path class="duet-line" pathLength="1" d="${path}"/></g>`;
  }).join("");
  const dots = flows.map((flow, person) => `<i class="duet-end duet-person-${person}" style="left:100%;top:${r(flowY(flow.end, scale))}%"></i>`).join("");
  const sync = axis === "affection" ? firstFlowSync(flows[0]!, flows[1]!, range) : undefined;
  const syncHtml = sync ? `<span class="duet-sync" style="left:${r(xOf(sync.scene, range))}%;top:${r(flowY(sync.value, scale))}%"><i></i><small>${lex().skin === "phone" ? "같은 마음" : "IN SYNC"}</small></span>` : "";
  const axisTurning = changesOf(series, axis).filter(({ point }) => point.turning).sort((a, b) => b.point.scene - a.point.scene)[0];
  const turnHtml = axisTurning ? `<i class="duet-turn duet-person-${axisTurning.person}" style="left:${r(xOf(axisTurning.point.scene, range))}%;top:${r(flowY(axisTurning.point.value, scale))}%"></i>` : "";
  const cursor = `<div class="duet-cursor"${scene === undefined ? " hidden" : ""} style="left:${scene === undefined ? 0 : r(xOf(scene, range))}%"><b>S#${scene ?? ""}</b>${flows.map((flow, person) => `<i class="duet-cursor__dot duet-person-${person}" style="top:${scene === undefined ? 50 : r(flowY(flowValueAt(flow, scene, range[0]), scale))}%"></i>`).join("")}</div>`;
  // Draw the lines in once per pair and axis; scrubbing and other re-renders must not replay it.
  const drawKey = `${names.join("|")}|${axis}`, fresh = !drawnFlows.has(drawKey);
  drawnFlows.add(drawKey);
  const chart = `<div class="duet-chart${fresh ? " is-drawing" : ""}" role="img" tabindex="0" data-action="pair-flow-scrub" data-axis="${axis}" data-from="${esc(names[0])}" data-to="${esc(names[1])}" data-first="${range[0]}" data-last="${range[1]}" data-scene="${scene ?? ""}" data-curves="${esc(JSON.stringify(flows.map(flow => ({ start: flow.start, points: flow.points.map(({ scene, value }) => ({ scene, value })) }))))}" aria-label="${esc(names.join("와 "))}의 ${labels[axis]} 흐름, S#${range[0]}부터 S#${range[1]}까지. 좌우 화살표로 장면을 고를 수 있어요."><div class="duet-plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="duet-grid" d="M0,25 H100 M0,50 H100 M0,75 H100"/>${paths}<path class="duet-baseline" d="M0,100 H100"/></svg>${pins.map(pin => `<i class="duet-pin-rule" style="left:${r(xOf(pin.scene, range))}%"></i>`).join("")}${dots}${syncHtml}${turnHtml}${cursor}</div><div class="duet-pins" aria-hidden="true">${pinHtml}</div><div class="duet-ruler" aria-hidden="true"><span>S#${range[0]}</span><span>S#${Math.round((range[0] + range[1]) / 2)}</span><span>S#${range[1]}</span></div></div>`;
  const legend = `<div class="duet-legend">${names.map((name, person) => `<span class="duet-person-${person}"><i></i>${esc(name)}의 마음</span>`).join("")}</div>`;
  // Only the axis being looked at speaks up when it is quiet; the chips already mark the others as 조용함.
  const quietLines: Record<FlowAxis, string> = {
    affection: "아직 마음이 움직인 장면이 없어요.", trust: "아직 믿음이 오간 장면이 없어요.", intimacy: "아직 가까워진 장면이 없어요.",
    fear: "두려워할 일은 아직 없었어요.", jealousy: "질투할 일은 아직 없었어요.", hostility: "다툴 일은 아직 없었어요.",
  };
  const quiet = hasEvents(axis) ? "" : `<p>${quietLines[axis]}</p>`;
  const recent = changesOf(series, axis).sort((a, b) => b.point.scene - a.point.scene || a.person - b.person).slice(0, 3);
  const recentHtml = `<section class="duet-recent"><h4>최근 변화</h4><ul>${recent.map(({ point, person }) => `<li><button type="button" class="duet-person-${person}" data-action="open-timeline-memory" data-memory-id="${esc(point.memoryId)}"><span class="duet-scene">S#${point.scene}</span><span><b>${esc(names[person])}</b> · ${reason(point, options.copy)}</span><i class="duet-trend${point.delta > 0 ? " is-up" : point.delta < 0 ? " is-down" : ""}">${sign(point.delta)}</i></button></li>`).join("")}</ul>${recent.length ? "" : '<p class="duet-hint">아직 기록된 마음의 변화가 없어요.</p>'}</section>`;
  const memoryHtml = memoryChange ? (() => {
    const { point, person } = memoryChange;
    const memory = (data.memories ?? []).find(item => item.id === point.memoryId);
    const dialogues = memory?.keyDialogues ?? [], index = dialogues.findIndex((line: any) => String(line.text ?? "").trim());
    const dialogue = index < 0 ? undefined : dialogues[index];
    const place = memory?.locations?.[0] ?? "장소 미상";
    const slug = lex().skin === "phone" ? `추억 · S#${point.scene} · ${esc(place)}` : `S#${point.scene}. ${esc(place)}${dayPart(memory?.story_time ?? null) ? ` — ${dayPart(memory.story_time) === "낮" ? "DAY" : "NIGHT"}` : ""}`;
    return `<figure class="duet-memory"><figcaption>${slug}</figcaption><blockquote>${dialogue ? options.copy(String(dialogue.text), `${point.memoryId}:dialogue:${index}`) : reason(point, options.copy)}</blockquote><p>— ${esc(dialogue?.speaker ?? names[person])}${dialogue ? ` · ${reason(point, options.copy)}` : ""}</p>${btn("장면 열기 ›", { kind: "quiet", action: "open-timeline-memory", data: { memoryId: point.memoryId }, hit: true })}</figure>`;
  })() : "";
  return `<div class="duet" style="${style}">${header}<div class="duet-chips" role="group" aria-label="마음의 축" data-preserve-scroll="duet-chips:${esc(names.join("|"))}" data-drag-scroll>${chips}</div><div class="duet-layout"><div class="duet-primary"><section class="duet-panel">${legend}${chart}<div class="duet-readout" data-flow-readout aria-live="polite">${renderFlowReadout(data, names, axis, scene, options.copy)}</div></section>${quiet ? `<div class="duet-quiet">${quiet}</div>` : ""}</div><aside class="duet-aside">${memoryHtml}${recentHtml}</aside></div></div>`;
}

/** All scrub interactions share the chart's data-action; only cursor/readout change during a drag. */
export function installRelationshipFlowScrub(root: HTMLElement): void {
  let drag: { chart: HTMLElement; pointerId: number } | undefined;
  const move = (chart: HTMLElement, scene: number) => {
    const first = Number(chart.dataset.first), last = Number(chart.dataset.last);
    const at = Math.max(first, Math.min(last, Math.round(scene)));
    if (chart.dataset.scene === String(at)) return;
    chart.dataset.scene = String(at);
    const flows = JSON.parse(chart.dataset.curves!) as CurveSeries[];
    const scale = sharedFlowScale(flows), cursor = chart.querySelector<HTMLElement>(".duet-cursor")!;
    cursor.hidden = false; cursor.style.left = `${xOf(at, [first, last])}%`;
    cursor.classList.toggle("is-start", at - first < (last - first) * .1);
    cursor.classList.toggle("is-end", last - at < (last - first) * .1);
    cursor.querySelector("b")!.textContent = `S#${at}`;
    cursor.querySelectorAll<HTMLElement>(".duet-cursor__dot").forEach((dot, person) => { dot.style.top = `${flowY(flowValueAt(flows[person]!, at, first), scale)}%`; });
    chart.classList.add("is-scrubbing");
    chart.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };
  const pointer = (chart: HTMLElement, event: PointerEvent) => {
    const box = chart.querySelector(".duet-plot")!.getBoundingClientRect();
    move(chart, Number(chart.dataset.first) + (event.clientX - box.left) / box.width * (Number(chart.dataset.last) - Number(chart.dataset.first)));
  };
  root.addEventListener("pointerdown", event => {
    const chart = (event.target as Element).closest<HTMLElement>('[data-action="pair-flow-scrub"]');
    if (!chart || event.button !== 0) return;
    drag = { chart, pointerId: event.pointerId }; chart.setPointerCapture(event.pointerId);
    pointer(chart, event); chart.focus({ preventScroll: true });
  });
  root.addEventListener("pointermove", event => { if (drag?.pointerId === event.pointerId) pointer(drag.chart, event); });
  const finish = (event: PointerEvent) => { if (drag?.pointerId === event.pointerId) { if (drag.chart.hasPointerCapture(event.pointerId)) drag.chart.releasePointerCapture(event.pointerId); drag = undefined; } };
  root.addEventListener("pointerup", finish); root.addEventListener("pointercancel", finish);
  root.addEventListener("keydown", event => {
    const chart = (event.target as Element).closest<HTMLElement>('[data-action="pair-flow-scrub"]');
    if (!chart || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = Number(chart.dataset.scene || chart.dataset.first);
    move(chart, event.key === "Home" ? Number(chart.dataset.first) : event.key === "End" ? Number(chart.dataset.last) : current + (event.key === "ArrowLeft" ? -1 : 1));
  });
}

export function layoutRelationshipFlow(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(".duet-chart").forEach(chart => {
    const pins = Array.from(chart.querySelectorAll<HTMLElement>(".duet-pin"));
    const layout = flowPinLabels(pins.map(pin => ({ scene: Number(pin.dataset.pinScene), label: pin.querySelector(".duet-pin__label")?.textContent ?? "" })), [Number(chart.dataset.first), Number(chart.dataset.last)], chart.getBoundingClientRect().width);
    pins.forEach((pin, index) => { const label = pin.querySelector<HTMLElement>(".duet-pin__label")!; label.hidden = !layout[index]!.showLabel; label.className = `duet-pin__label is-${layout[index]!.anchor}`; });
  });
}
