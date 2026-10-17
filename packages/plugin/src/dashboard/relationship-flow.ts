/** Shape coordinates only: these values are never relationship scores. */
export const FLOW_AXES = ["affection", "trust", "intimacy", "fear", "jealousy", "hostility"] as const;
export type FlowAxis = typeof FLOW_AXES[number];
type Effect = "increase" | "decrease" | "reveal" | "complicate" | "resolve";
type Impact = "minor" | "meaningful" | "major" | "turning";
export type FlowEvent = {
  id: string; from: string; to: string; reason: string; sourceMemoryId?: string; sourceOrdinal: number;
  changes: { axis: string; effect: Effect; impact: Impact }[];
};
export type FlowPoint = {
  memoryId: string; scene: number; effect: Effect; impact: Impact; delta: number; value: number;
  reason: string; eventId: string; turning: boolean;
  reasons: { eventId: string; reason: string }[];
};
export type AxisFlow = { start: number; points: FlowPoint[]; end: number };
const weights: Record<Impact, number> = { minor: 1, meaningful: 2, major: 3, turning: 4 };
const levels: Record<string, number> = {
  none: 0, low: 2, slight: 2, moderate: 4, strong: 6, high: 6, deep: 8, extreme: 8,
  aversion: 0, distrust: 0, avoidant: 0, faint: 2, fragile: 2, tentative: 2,
  growing: 4, developing: 4, established: 6,
};

export function buildAxisFlow(
  events: readonly FlowEvent[], from: string, to: string,
  sceneNumberOf: (memoryId: string, sourceOrdinal: number) => number | undefined,
  startLevelOf?: (axis: FlowAxis) => string | undefined,
): Record<FlowAxis, AxisFlow> {
  const result = Object.fromEntries(FLOW_AXES.map(axis => {
    const start = levels[startLevelOf?.(axis) ?? "unknown"] ?? 2;
    return [axis, { start, points: [] as FlowPoint[], end: start }];
  })) as Record<FlowAxis, AxisFlow>;
  const byScene = new Map(FLOW_AXES.map(axis => [axis, new Map<number, FlowPoint>()]));
  for (const event of [...events].filter(event => event.from === from && event.to === to).sort((a, b) => a.sourceOrdinal - b.sourceOrdinal)) {
    const scene = sceneNumberOf(event.sourceMemoryId ?? "", event.sourceOrdinal);
    if (scene === undefined) continue;
    for (const change of event.changes) {
      if (!FLOW_AXES.includes(change.axis as FlowAxis)) continue;
      const flow = result[change.axis as FlowAxis];
      const delta = change.effect === "increase" ? weights[change.impact] : change.effect === "decrease" ? -weights[change.impact] : 0;
      const scenePoints = byScene.get(change.axis as FlowAxis)!;
      let point = scenePoints.get(scene);
      if (!point) {
        point = { memoryId: event.sourceMemoryId ?? "", scene, effect: change.effect, impact: change.impact, delta: 0, value: 0, reason: "", eventId: event.id, turning: false, reasons: [] };
        flow.points.push(point);
        scenePoints.set(scene, point);
      }
      point.delta += delta;
      point.turning ||= change.impact === "turning";
      if (weights[change.impact] > weights[point.impact]) point.impact = change.impact;
      if (!point.reasons.some(reason => reason.eventId === event.id)) point.reasons.push({ eventId: event.id, reason: event.reason });
      point.reason = point.reasons.map(reason => reason.reason).join(" · ");
      point.effect = point.delta > 0 ? "increase" : point.delta < 0 ? "decrease" : change.effect;
    }
  }
  for (const flow of Object.values(result)) {
    flow.points.sort((a, b) => a.scene - b.scene);
    for (const point of flow.points) { point.value = flow.end + point.delta; flow.end = point.value; }
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
