import { compareParsedStoryTimes, parseStoryTime } from "@rcm/shared";
import type { DashboardData } from "../../dashboard.js";
import { buildPairs, entityForName, entityProminence, normalizeName } from "../pairs.js";

export type CastMember = {
  name: string;
  role: "persona" | "character";
  scenes: number;
  lastScene: string | null;
};

type SceneStats = {
  scenes: number;
  lastScene: string | null;
  lastComparisonTime: string | null;
  lastOrdinal: number | null;
  lastIndex: number;
};

const firstTime = (...values: unknown[]): string | null => {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
};
const storyTime = (memory: any): string | null => firstTime(
  memory?.story_time,
  memory?.storyTime,
  memory?.story_time_normalized,
);
const comparisonTime = (memory: any): string | null => firstTime(
  memory?.story_time_normalized,
  memory?.storyTime,
  memory?.story_time,
);
const ordinal = (memory: any): number | null => {
  const value = memory?.sourceOrdinal ?? memory?.source_ordinal;
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
};

const isLater = (memory: any, index: number, current: SceneStats): boolean => {
  if (current.lastIndex < 0) return true;
  const candidateTime = comparisonTime(memory);
  if (candidateTime && current.lastComparisonTime) {
    const compared = compareParsedStoryTimes(parseStoryTime(current.lastComparisonTime), parseStoryTime(candidateTime));
    if (compared !== null && compared !== 0) return compared < 0;
  }
  const candidateOrdinal = ordinal(memory);
  if (candidateOrdinal !== null && current.lastOrdinal !== null && candidateOrdinal !== current.lastOrdinal) {
    return candidateOrdinal > current.lastOrdinal;
  }
  return index > current.lastIndex;
};

const statsFor = (data: DashboardData, name: string): SceneStats => {
  const normalized = normalizeName(name);
  const stats: SceneStats = { scenes: 0, lastScene: null, lastComparisonTime: null, lastOrdinal: null, lastIndex: -1 };
  (data.memories ?? []).forEach((memory: any, index: number) => {
    if (memory?.active === false || memory?.type !== "episode") return;
    const participants = Array.isArray(memory?.participants) ? memory.participants : [];
    if (!participants.some((participant: unknown) => normalizeName(participant) === normalized)) return;
    stats.scenes += 1;
    if (isLater(memory, index, stats)) {
      stats.lastScene = storyTime(memory);
      stats.lastComparisonTime = comparisonTime(memory);
      stats.lastOrdinal = ordinal(memory);
      stats.lastIndex = index;
    }
  });
  return stats;
};

const member = (data: DashboardData, name: string, role: CastMember["role"]): CastMember => {
  const stats = statsFor(data, name);
  return { name, role, scenes: stats.scenes, lastScene: stats.lastScene };
};

export function buildCast(data: DashboardData, personaEntity: string | null): { persona: CastMember | null; leads: CastMember[] } {
  const pairs = buildPairs(data, personaEntity);
  if (personaEntity) {
    const persona = normalizeName(personaEntity);
    const names = new Map<string, string>();
    for (const pair of pairs) {
      const other = normalizeName(pair.a) === persona ? pair.b : normalizeName(pair.b) === persona ? pair.a : null;
      if (other) names.set(normalizeName(other), other);
    }
    const leads = [...names.values()].map((name) => member(data, name, "character"))
      .sort((left, right) => right.scenes - left.scenes || left.name.localeCompare(right.name, "ko"));
    return { persona: member(data, personaEntity, "persona"), leads };
  }

  const names = new Map<string, string>();
  for (const pair of pairs) {
    names.set(normalizeName(pair.a), pair.a);
    names.set(normalizeName(pair.b), pair.b);
  }
  const leads = [...names.values()].map((name) => member(data, name, "character"))
    .sort((left, right) => entityProminence(entityForName(data, left.name)) - entityProminence(entityForName(data, right.name))
      || right.scenes - left.scenes
      || left.name.localeCompare(right.name, "ko"))
    .slice(0, 6);
  return { persona: null, leads };
}
