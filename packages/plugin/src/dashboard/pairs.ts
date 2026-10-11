import type { DashboardData } from "../dashboard.js";

export type PairKey = string;

export type PairDirection = {
  from: string;
  to: string;
  summary: string;
  axes: Record<string, { level: string; trend: string }> | null;
};

export type PairSummary = {
  key: PairKey;
  a: string;
  b: string;
  tier: 1 | 2;
  label: string | null;
  directions: PairDirection[];
  latestMilestone: { label: string; ordinal: number | null } | null;
};

export const MILESTONE_LABELS: Record<string, string> = {
  first_physical_intimacy: "첫 친밀 행위",
  first_hand_holding: "첫 손잡기",
  first_embrace: "첫 포옹",
  first_kiss: "첫 입맞춤",
  first_deep_kiss: "첫 깊은 키스",
  first_sexual_touch: "첫 성적 접촉",
  first_manual_sex: "첫 손을 이용한 성행위",
  first_oral_sex: "첫 구강 성행위",
  first_vaginal_sex: "첫 질 성교",
  first_anal_sex: "첫 항문 성교",
  first_sex: "첫 성행위",
};

export const relationshipSummaryLabel = (value: unknown): string =>
  String(value ?? "").trim() === "Projection pending" ? "아직 계산 전" : String(value ?? "");

/** List text for a pair's latest milestone. */

const pairNames = (left: unknown, right: unknown): [string, string] | null => {
  const names = [String(left ?? "").trim(), String(right ?? "").trim()].sort();
  return names[0] && names[1] && names[0] !== names[1] ? names as [string, string] : null;
};

export function pairKey(left: string, right: string): PairKey {
  return [left, right].sort().join("|");
}

export const relationshipLabelTranslationKey = (pair: { key: PairKey }): string => `relationship-label:${pair.key}`;

export const entityName = (entity: any): string => String(entity?.name ?? entity?.displayName ?? "").trim();
export const normalizeName = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();

export const PERSON_PROMINENCE_OPTIONS = [
  { value: "primary", label: "주요" },
  { value: "supporting", label: "조연" },
  { value: "reference", label: "배경" },
] as const;

export const entityProminence = (entity: any): number => {
  const value = String(entity?.setupProminence ?? entity?.prominence ?? entity?.tier ?? "supporting").toLocaleLowerCase();
  if (["primary", "major", "main"].includes(value)) return 0;
  if (["reference", "incidental", "background"].includes(value)) return 2;
  return 1;
};

export const entityForName = (data: DashboardData, name: string): any => {
  const normalized = normalizeName(name);
  return data.entities.find((entity) => [entityName(entity), ...(entity?.aliases ?? [])]
    .some((candidate) => normalizeName(candidate) === normalized));
};

const nameImportance = (data: DashboardData, name: string): number => entityProminence(entityForName(data, name));

export const milestoneLabel = (item: any): string => {
  if (item?.act === "other" && String(item?.customLabel ?? "").trim()) return String(item.customLabel).trim();
  const key = String(item?.milestoneKey ?? item?.kind ?? "").trim();
  return MILESTONE_LABELS[key] ?? (String(item?.act ?? "").trim() || key || "스킨십");
};

const sourceOrdinal = (item: any): number | null => {
  const value = item?.sourceOrdinal;
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
};

export function buildPairs(data: DashboardData, personaEntity: string | null): PairSummary[] {
  const pairs = new Map<PairKey, PairSummary>();
  const ensurePair = (left: unknown, right: unknown): PairSummary | null => {
    const names = pairNames(left, right);
    if (!names) return null;
    const [a, b] = names;
    const key = pairKey(a, b);
    const existing = pairs.get(key);
    if (existing) return existing;
    const pair: PairSummary = { key, a, b, tier: 2, label: null, directions: [], latestMilestone: null };
    pairs.set(key, pair);
    return pair;
  };

  for (const relationship of data.relationships) {
    const from = String(relationship?.from ?? relationship?.from_entity ?? "").trim();
    const to = String(relationship?.to ?? relationship?.to_entity ?? "").trim();
    const pair = ensurePair(from, to);
    if (!pair) continue;
    const axes = relationship?.axes && typeof relationship.axes === "object"
      ? relationship.axes as Record<string, { level: string; trend: string }>
      : null;
    pair.directions.push({ from, to, summary: String(relationship?.summary ?? ""), axes });
  }

  const milestoneByPair = new Map<PairKey, { item: any; index: number }>();
  (data.physicalIntimacy ?? []).forEach((item: any, index: number) => {
    if (item?.active === false) return;
    const pair = ensurePair(item?.participantA, item?.participantB);
    if (!pair) return;
    const current = milestoneByPair.get(pair.key);
    const ordinal = sourceOrdinal(item);
    const currentOrdinal = sourceOrdinal(current?.item);
    if (!current || (ordinal ?? -1) > (currentOrdinal ?? -1) || ((ordinal ?? -1) === (currentOrdinal ?? -1) && index > current.index)) {
      milestoneByPair.set(pair.key, { item, index });
    }
  });

  for (const memory of data.memories ?? []) {
    if (memory?.active === false) continue;
    for (const landmark of memory?.landmarkKinds ?? []) {
      if (Array.isArray(landmark?.pair) && landmark.pair.length === 2) ensurePair(landmark.pair[0], landmark.pair[1]);
    }
  }

  for (const [key, value] of milestoneByPair) {
    const pair = pairs.get(key);
    const label = milestoneLabel(value.item);
    if (pair && label) pair.latestMilestone = {
      label,
      ordinal: sourceOrdinal(value.item),
    };
  }

  for (const assertion of data.assertions ?? []) {
    const relation = assertion?.socialRelation;
    if (relation?.kind !== "interpersonal") continue;
    const names = pairNames(assertion?.subject, relation?.target);
    const pair = names ? ensurePair(names[0], names[1]) : undefined;
    const label = String(relation?.label ?? "").trim();
    if (pair && label && !(pair.label ?? "").split(" · ").includes(label)) pair.label = pair.label ? `${pair.label} · ${label}` : label;
  }

  if (personaEntity) {
    const persona = normalizeName(personaEntity);
    for (const pair of pairs.values()) {
      const other = normalizeName(pair.a) === persona ? pair.b : normalizeName(pair.b) === persona ? pair.a : null;
      if (other && entityProminence(entityForName(data, other)) === 0) pair.tier = 1;
    }
  }

  const personaOther = (pair: PairSummary): string => normalizeName(pair.a) === normalizeName(personaEntity) ? pair.b : pair.a;
  return [...pairs.values()].sort((left, right) => left.tier - right.tier
    || (left.tier === 1 && right.tier === 1
      ? nameImportance(data, personaOther(left)) - nameImportance(data, personaOther(right))
        || personaOther(left).localeCompare(personaOther(right), "ko")
      : left.a.localeCompare(right.a, "ko") || left.b.localeCompare(right.b, "ko")));
}
