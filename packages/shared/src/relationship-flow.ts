/** Shape coordinates only: these values are never relationship scores. */
export const FLOW_AXES = ["affection", "trust", "intimacy", "fear", "jealousy", "hostility"] as const;
export type FlowAxis = typeof FLOW_AXES[number];
type Effect = "increase" | "decrease" | "reveal" | "complicate" | "resolve";
type Impact = "minor" | "meaningful" | "major" | "turning";
export type FlowEvent = {
  hidden?: boolean;
  id: string; from: string; to: string; reason: string; sourceMemoryId?: string; sourceOrdinal: number;
  changes: { axis: string; effect: Effect; impact: Impact }[];
};
export type FlowPoint = {
  memoryId: string; scene: number; effect: Effect; impact: Impact; delta: number; value: number;
  reason: string; eventId: string; turning: boolean;
  reasons: { eventId: string; reason: string }[];
};
export type AxisFlow = { start: number; points: FlowPoint[]; end: number };
export const FLOW_IMPACT_WEIGHTS: Record<Impact, number> = { minor: 1, meaningful: 2, major: 3, turning: 4 };
const levels: Record<string, number> = {
  none: 0, low: 2, slight: 2, moderate: 4, strong: 6, high: 6, deep: 8, extreme: 8,
  aversion: 0, distrust: 0, avoidant: 0, faint: 2, fragile: 2, tentative: 2,
  growing: 4, developing: 4, established: 6,
};

export function buildAxisFlow(
  events: readonly FlowEvent[], from: string, to: string,
  sceneNumberOf: (memoryId: string, sourceOrdinal: number) => number | undefined,
  startLevelOf?: (axis: FlowAxis) => string | undefined,
  endLevelOf?: (axis: FlowAxis) => string | undefined,
): Record<FlowAxis, AxisFlow> {
  const result = Object.fromEntries(FLOW_AXES.map(axis => {
    const start = levels[startLevelOf?.(axis) ?? "unknown"] ?? 2;
    return [axis, { start, points: [] as FlowPoint[], end: start }];
  })) as Record<FlowAxis, AxisFlow>;
  const impactWeights = new Map<FlowPoint, number>();
  const byScene = new Map(FLOW_AXES.map(axis => [axis, new Map<number, FlowPoint>()]));
  for (const event of [...events].filter(event => event.from === from && event.to === to).sort((a, b) => a.sourceOrdinal - b.sourceOrdinal)) {
    const scene = sceneNumberOf(event.sourceMemoryId ?? "", event.sourceOrdinal);
    if (scene === undefined) continue;
    for (const change of event.changes) {
      if (!FLOW_AXES.includes(change.axis as FlowAxis)) continue;
      const flow = result[change.axis as FlowAxis];
      const delta = change.effect === "increase" ? FLOW_IMPACT_WEIGHTS[change.impact] : change.effect === "decrease" ? -FLOW_IMPACT_WEIGHTS[change.impact] : 0;
      const scenePoints = byScene.get(change.axis as FlowAxis)!;
      let point = scenePoints.get(scene);
      if (!point) {
        point = { memoryId: event.sourceMemoryId ?? "", scene, effect: change.effect, impact: change.impact, delta: 0, value: 0, reason: "", eventId: event.id, turning: false, reasons: [] };
        flow.points.push(point);
        scenePoints.set(scene, point);
      }
      point.delta += delta;
      impactWeights.set(point, (impactWeights.get(point) ?? 0) + FLOW_IMPACT_WEIGHTS[change.impact]);
      point.turning ||= change.impact === "turning";
      if (FLOW_IMPACT_WEIGHTS[change.impact] > FLOW_IMPACT_WEIGHTS[point.impact]) point.impact = change.impact;
      if (!event.hidden && !point.reasons.some(reason => reason.eventId === event.id)) point.reasons.push({ eventId: event.id, reason: event.reason });
      point.reason = point.reasons.map(reason => reason.reason).join(" · ");
      point.effect = point.delta > 0 ? "increase" : point.delta < 0 ? "decrease" : change.effect;
    }
  }
  for (const axis of FLOW_AXES) {
    const flow = result[axis];
    flow.points.sort((a, b) => a.scene - b.scene);
    const knownStart = levels[startLevelOf?.(axis) ?? "unknown"];
    const knownEnd = levels[endLevelOf?.(axis) ?? "unknown"];
    const delta = flow.points.reduce((sum, point) => sum + point.delta, 0);
    if (endLevelOf && knownStart === undefined && knownEnd !== undefined) flow.start = Math.max(0, Math.min(8, knownEnd - delta));
    flow.end = flow.start;
    const total = flow.points.reduce((sum, point) => sum + impactWeights.get(point)!, 0);
    let elapsed = 0;
    for (const point of flow.points) {
      if (knownEnd === undefined) point.value = flow.end + point.delta;
      else {
        elapsed += impactWeights.get(point)!;
        const progress = elapsed / total;
        const base = flow.start + (knownEnd - flow.start) * progress;
        // A small typed-event accent; equal endpoints remain a quiet, bounded line.
        const sign = base >= 8 ? -1 : base <= 0 ? 1 : Math.sign(point.delta);
        const bump = flow.start === knownEnd ? Math.sin(Math.PI * progress) * .25 * sign * Math.min(1, impactWeights.get(point)! / 4) : 0;
        point.value = progress === 1 ? knownEnd : Math.max(0, Math.min(8, base + bump));
      }
      flow.end = point.value;
    }
    if (knownEnd !== undefined) flow.end = knownEnd;
  }
  return result;
}

export type FlowBin = { key: string; points: FlowPoint[]; last: FlowPoint };

/** Binning changes marker density only; every original point still shapes the line and opens its scene. */
export function binFlowPoints(points: readonly FlowPoint[], range: readonly [number, number], limit = 22): FlowBin[] {
  const size = Math.max(1, Math.ceil((range[1] - range[0] + 1) / limit));
  const bins: FlowBin[] = [];
  let bucket: number | undefined;
  for (const point of points) {
    const nextBucket = Math.floor((point.scene - range[0]) / size);
    const previous = bins.at(-1);
    if (!point.turning && previous && !previous.last.turning && bucket === nextBucket) {
      previous.points.push(point);
      previous.last = point;
      previous.key = `${previous.points[0]!.scene}-${point.scene}`;
    } else {
      bins.push({ key: `${point.scene}-${point.scene}`, points: [point], last: point });
    }
    bucket = nextBucket;
  }
  return bins;
}

export type CurveSeries = { start: number; points: { scene: number; value: number }[] };
export type FlowScale = { low: number; high: number };

export function sharedFlowScale(series: readonly CurveSeries[]): FlowScale {
  let low = Infinity, high = -Infinity;
  for (const flow of series) for (const value of [flow.start, ...flow.points.map(point => point.value)]) {
    low = Math.min(low, value); high = Math.max(high, value);
  }
  if (!Number.isFinite(low)) return { low: 0, high: 4 };
  if (high - low < 4) { const mid = (high + low) / 2; low = mid - 2; high = mid + 2; }
  return { low, high };
}

/** Where a stored level sits on the fixed vertical scale; pulling away sits just below none. */
const LADDER_STEP: Record<string, number> = {
  none: 0, faint: 1, fragile: 1, tentative: 1, growing: 2, developing: 2, established: 3, strong: 4, deep: 5,
  low: 1, moderate: 2, high: 3, extreme: 4, aversion: -0.8, distrust: -0.8, avoidant: -0.8,
};
const INTENSITY_AXES: readonly FlowAxis[] = ["fear", "jealousy", "hostility"];
/** The top step of an axis: deep for the built-and-proven axes, extreme for the intensity axes. */
export const ladderTop = (axis: FlowAxis): number => INTENSITY_AXES.includes(axis) ? 4 : 5;
export const ladderTopLevel = (axis: FlowAxis): string => INTENSITY_AXES.includes(axis) ? "extreme" : "deep";
export const ladderScale = (top: number): FlowScale => ({ low: 0, high: top });

/**
 * Re-express a flow on the level ladder. Only the starting and current levels are known; the changes between
 * them keep their shape, so the line leaves the starting step and arrives at the current one.
 */
export function toLadderFlow(flow: AxisFlow, startLevel: string | undefined, currentLevel: string | undefined, top: number): AxisFlow {
  const startStep = LADDER_STEP[startLevel ?? ""] ?? 0, target = LADDER_STEP[currentLevel ?? ""];
  if (!flow.points.length) { const at = target ?? startStep; return { start: at, points: [], end: at }; }
  const rise = flow.end - flow.start;
  const fitted = target === undefined || rise === 0 ? 0 : (target - startStep) / rise;
  // An unknown or contradicting current level keeps a plain half step per unit of change.
  const slope = fitted > 0 ? fitted : 0.5;
  const drift = target === undefined ? 0 : target - (startStep + rise * slope);
  const points = flow.points.map((point, index) => ({ ...point,
    value: Math.max(-0.8, Math.min(top + 0.3, startStep + (point.value - flow.start) * slope + drift * (index + 1) / flow.points.length)) }));
  return { start: startStep, points, end: points[points.length - 1]!.value };
}

export const flowY = (value: number, scale: FlowScale): number => 14 + (1 - (value - scale.low) / (scale.high - scale.low)) * 72;

/**
 * Monotone cubic knots (Fritsch–Carlson): the curve passes through every change and never overshoots between them,
 * so a run of small rises reads as one smooth climb instead of a ripple. The SVG path, scrub dots and sync detection
 * all evaluate this same curve.
 */
export function flowKnots(flow: CurveSeries, firstScene = 1): { xs: number[]; ys: number[]; ms: number[] } {
  const xs = [firstScene], ys = [flow.start];
  for (const point of flow.points) {
    if (point.scene <= xs[xs.length - 1]!) { ys[ys.length - 1] = point.value; continue; }
    xs.push(point.scene); ys.push(point.value);
  }
  const n = xs.length, d: number[] = [], ms = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!));
  if (n > 1) { ms[0] = d[0]!; ms[n - 1] = d[n - 2]!; }
  for (let i = 1; i < n - 1; i++) ms[i] = d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { ms[i] = 0; ms[i + 1] = 0; continue; }
    const a = ms[i]! / d[i]!, b = ms[i + 1]! / d[i]!, h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); ms[i] = t * a * d[i]!; ms[i + 1] = t * b * d[i]!; }
  }
  return { xs, ys, ms };
}

export function flowValueAt(flow: CurveSeries, scene: number, firstScene = 1): number {
  const { xs, ys, ms } = flowKnots(flow, firstScene);
  if (scene <= xs[0]!) return ys[0]!;
  for (let i = 0; i < xs.length - 1; i++) {
    if (scene > xs[i + 1]!) continue;
    const h = xs[i + 1]! - xs[i]!, t = (scene - xs[i]!) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * ms[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * ms[i + 1]!;
  }
  return ys[ys.length - 1]!;
}

export function firstFlowSync(a: CurveSeries, b: CurveSeries, range: readonly [number, number]): { scene: number; value: number } | undefined {
  const diff = (scene: number) => flowValueAt(a, scene, range[0]) - flowValueAt(b, scene, range[0]);
  let previous = diff(range[0]);
  let apart = Math.abs(previous) > 1e-6;
  for (let scene = range[0] + 1; scene <= range[1]; scene++) {
    const current = diff(scene);
    if (apart && (Math.abs(current) < 1e-6 || current * previous < 0)) {
      let low = scene - 1, high = scene;
      const sign = diff(low);
      if (Math.abs(current) >= 1e-6) for (let i = 0; i < 24; i++) {
        const mid = (low + high) / 2;
        if (diff(mid) * sign > 0) low = mid; else high = mid;
      } else low = high;
      const at = (low + high) / 2;
      return { scene: at, value: flowValueAt(a, at, range[0]) };
    }
    apart ||= Math.abs(current) > 1e-6;
    previous = current;
  }
  return undefined;
}

/** Pixel estimates keep pins even when their labels cannot fit. */
export function flowPinLabels(pins: readonly { scene: number; label: string }[], range: readonly [number, number], width: number): { left: number; showLabel: boolean; anchor: "start" | "middle" | "end" }[] {
  let previousRight = -Infinity;
  return pins.map(pin => {
    const left = (pin.scene - range[0]) / (range[1] - range[0]) * 100;
    const textWidth = Math.min(width, Array.from(pin.label).reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 11 : 6), 0));
    const x = left / 100 * width;
    const anchor = x < textWidth / 2 ? "start" : x + textWidth / 2 > width ? "end" : "middle";
    const start = anchor === "start" ? x : anchor === "end" ? x - textWidth : x - textWidth / 2;
    const showLabel = start >= previousRight + 10;
    if (showLabel) previousRight = start + textWidth;
    return { left, showLabel, anchor };
  });
}
