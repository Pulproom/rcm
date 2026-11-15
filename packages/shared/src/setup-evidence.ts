import type { InitialCalibrationResult, ResolvedSetupProjection } from "./index.js";
import { ModelContentValidationError } from "./structured-repair.js";

const normalizeEntityName = (value: string): string => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

function exactSlice(source: string, candidate: string): string | undefined {
  const sought = candidate.trim();
  if (!sought) return undefined;
  const index = source.toLocaleLowerCase().indexOf(sought.toLocaleLowerCase());
  if (index < 0) return undefined;
  const word = /[\p{L}\p{N}_]/u;
  if (word.test(sought[0] ?? "") && word.test(source[index - 1] ?? "")) return undefined;
  if (word.test(sought.at(-1) ?? "") && word.test(source[index + sought.length] ?? "")) return undefined;
  return source.slice(index, index + sought.length);
}

export function normalizeAndValidateSetupEvidence(
  projection: ResolvedSetupProjection,
  result: Omit<InitialCalibrationResult, "socialKnowledge"> & Partial<Pick<InitialCalibrationResult, "socialKnowledge">>,
  identityHints: { hostCharacterName?: string; userPersonaName?: string } = {},
): InitialCalibrationResult {
  const normalized: InitialCalibrationResult = {
    pairProgress: result.pairProgress,
    socialKnowledge: (result.socialKnowledge ?? []).map(item => ({...item, evidence: item.evidence.map(e => ({...e}))})),
    entities: result.entities.map((entity) => ({ ...entity, aliases: [...entity.aliases], evidence: entity.evidence.map((item) => ({ ...item })) })),
    relationships: result.relationships.map((relationship) => ({
      ...relationship, axes: { ...relationship.axes }, evidence: relationship.evidence.map((item) => ({ ...item })),
    })),
  };
  const issues: string[] = [];
  const anchorNames = [identityHints.hostCharacterName, identityHints.userPersonaName].map((value) => normalizeEntityName(value ?? "")).filter(Boolean);
  const keys = new Set<string>();
  const relationshipKeys = new Set<string>();
  const relocateExactQuote = (item: { sourceIndex: number; quote: string }): { sourceIndex: number; quote: string } | undefined => {
    const preferred = projection.messages[item.sourceIndex]?.content;
    if (preferred?.includes(item.quote)) return item;
    const sourceIndex = projection.messages.findIndex((message) => message.content.includes(item.quote));
    return sourceIndex < 0 ? undefined : { sourceIndex, quote: item.quote };
  };
  const entityNameEvidence = (entity: InitialCalibrationResult["entities"][number], preferredIndices: number[]): { sourceIndex: number; quote: string } | undefined => {
    const candidates = [entity.displayName, ...entity.aliases.filter(Boolean).sort((left, right) => right.length - left.length)].filter(Boolean);
    const indices = [...new Set([...preferredIndices, ...projection.messages.map((_, index) => index)])];
    for (const sourceIndex of indices) {
      const source = projection.messages[sourceIndex]?.content;
      if (!source) continue;
      for (const candidate of candidates) {
        const quote = exactSlice(source, candidate);
        if (quote) return { sourceIndex, quote };
      }
    }
    return undefined;
  };
  for (const entity of normalized.entities) {
    if (entity.birthday) {
      const evidence = relocateExactQuote(entity.birthday.evidence);
      if (evidence) entity.birthday = { ...entity.birthday, evidence };
      else delete entity.birthday;
    }
    if (keys.has(entity.key)) issues.push(`duplicate entity key ${entity.key}`);
    keys.add(entity.key);
    const names = [entity.displayName, ...entity.aliases].map(normalizeEntityName);
    const exact = entity.evidence.map(relocateExactQuote).filter((item): item is { sourceIndex: number; quote: string } => Boolean(item));
    if (exact.length) entity.evidence = exact;
    else {
      const repaired = entityNameEvidence(entity, entity.evidence.map((item) => item.sourceIndex));
      if (repaired) entity.evidence = [repaired];
      else if (!anchorNames.some((anchor) => names.includes(anchor))) issues.push(`entity ${entity.key} has no exact setup identity evidence`);
      else entity.evidence = [];
    }
  }
  for (const relationship of normalized.relationships) {
    const pairKey = `${relationship.fromKey}\0${relationship.toKey}`;
    if (relationshipKeys.has(pairKey)) issues.push(`duplicate relationship ${relationship.fromKey}->${relationship.toKey}`);
    relationshipKeys.add(pairKey);
    if (!keys.has(relationship.fromKey) || !keys.has(relationship.toKey)) issues.push(`relationship ${relationship.fromKey}->${relationship.toKey} cites an unknown entity key`);
    if (relationship.fromKey === relationship.toKey) issues.push(`relationship ${relationship.fromKey}->${relationship.toKey} is self-directed`);
    if (Object.values(relationship.axes).every((value) => value === "unknown")) issues.push(`relationship ${relationship.fromKey}->${relationship.toKey} has no known setup axis`);
    const exact = relationship.evidence.map(relocateExactQuote).filter((item): item is { sourceIndex: number; quote: string } => Boolean(item));
    if (exact.length !== relationship.evidence.length) issues.push(`relationship ${relationship.fromKey}->${relationship.toKey} has non-verbatim setup evidence`);
    relationship.evidence = exact;
  }
  const recognitionKeys = new Set<string>();
  for (const item of normalized.socialKnowledge) {
    const key = `${item.holderKey}\0${item.subjectKey}`;
    if (recognitionKeys.has(key) || item.holderKey === item.subjectKey || !keys.has(item.holderKey) || !keys.has(item.subjectKey)) issues.push("Invalid or duplicate setup recognition pair");
    recognitionKeys.add(key);
    const exact = item.evidence.map(relocateExactQuote).filter((e): e is {sourceIndex:number;quote:string} => Boolean(e));
    if (!exact.length || exact.length !== item.evidence.length) issues.push("Setup recognition has non-verbatim evidence");
    item.evidence = exact;
  }
  if (issues.length) throw new ModelContentValidationError(`Initial calibration evidence validation failed: ${issues.slice(0, 8).join("; ")}${issues.length > 8 ? `; +${issues.length - 8} more` : ""}`);
  return normalized;
}

