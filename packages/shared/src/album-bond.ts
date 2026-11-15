import { z } from "zod";
import { FLOW_AXES } from "./relationship-flow.js";
import type { AlbumItem } from "./album.js";
import { albumDateOnly } from "./album-presentation.js";

export const ALBUM_AXIS_LABELS = { affection: "호감", trust: "신뢰", intimacy: "친밀", fear: "두려움", jealousy: "질투", hostility: "적대" } as const;
/** Product-owned projection enums only, never a reading of relationship prose. */
export const ALBUM_LEVEL_LABELS: Record<string, string> = {
  unknown: "—", none: "없음", aversion: "거리 둠", distrust: "불신", avoidant: "거리 둠",
  faint: "희미함", fragile: "아슬아슬", tentative: "조심스러움", growing: "자라는 중", developing: "자라는 중",
  established: "자리 잡음", strong: "단단함", deep: "아주 깊음", conflicted: "엇갈림",
  low: "조금", moderate: "어느 정도", high: "큼", extreme: "아주 큼",
};
export const albumLevelLabel = (level?: string): string => level && Object.hasOwn(ALBUM_LEVEL_LABELS, level) ? ALBUM_LEVEL_LABELS[level]! : "—";
const text = z.string().max(20_000);
export const AlbumBondEventSchema = z.object({
  id: z.string(), from: text, to: text, reason: text, date: text.default(""), title: text.default(""),
  sourceMemoryId: z.string().optional(), sourceOrdinal: z.number().int(), scene: z.number().int().nonnegative(),
  changes: z.array(z.object({ axis: z.enum(FLOW_AXES), effect: z.enum(["increase", "decrease", "reveal", "complicate", "resolve"]), impact: z.enum(["minor", "meaningful", "major", "turning"]) })),
});
export const AlbumBondSchema = z.object({
  events: z.array(AlbumBondEventSchema).default([]),
  directions: z.array(z.object({ from: text, to: text, baseline: z.record(z.string(), text).default({}), current: z.record(z.string(), text).default({}), tensions: z.array(text).default([]) })).default([]),
});
export type AlbumBond = z.infer<typeof AlbumBondSchema>;
export const albumBondReasons = (events: AlbumBond["events"]): string =>
  [...new Set(events.map(e => e.reason.trim()).filter(Boolean))].join(" ").slice(0, 20_000);

/** Major typed events are folded by source or day; all events still shape the curve. */
export function albumTurningPoints(events: AlbumBond["events"]): AlbumItem[] {
  const groups: AlbumBond["events"][] = [];
  for (const event of [...events].sort((a, b) => a.sourceOrdinal - b.sourceOrdinal)) {
    if (!event.changes.some(c => c.impact === "major" || c.impact === "turning")) continue;
    const day = albumDateOnly(event.date);
    const matches = groups.filter(group => group.some(other => (day && albumDateOnly(other.date) === day) || (event.sourceMemoryId && event.sourceMemoryId === other.sourceMemoryId)));
    if (!matches.length) groups.push([event]);
    else { matches[0]!.push(event, ...matches.slice(1).flat()); for (const group of matches.slice(1)) groups.splice(groups.indexOf(group), 1); }
  }
  return groups.map(group => ({ id: `bond:${group[0]!.id}`, fields: { title: group.find(e => e.title)?.title ?? "", date: albumDateOnly(group[0]!.date), summary: albumBondReasons(group) }, bondEventIds: group.map(e => e.id), photos: [], edited: {} }));
}
