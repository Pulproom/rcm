/** Content-free worker metadata; ordinals are stored zero-based. */
export interface SourceRecoveryMetadata {
  targets: Array<{ messageId: string; ordinal: number }>;
  matchKinds: string[];
  result?: { outcome: "added" | "no_excerpt"; passagesAdded: number } | { outcome: "failed"; failureCode: string };
}

export function sourceRecoverySummary(metadata: SourceRecoveryMetadata | undefined): string {
  if (!metadata?.targets?.length) return "";
  const ordinals = [...new Set(metadata.targets.map(target => target.ordinal).filter(ordinal => Number.isInteger(ordinal) && ordinal >= 0))];
  if (!ordinals.length) return "";
  const target = `메시지 ${ordinals.map(ordinal => ordinal + 1).join(", ")}`;
  const result = metadata.result;
  return `${target} · ${result?.outcome === "failed" ? "발췌 보완 실패" : result?.outcome === "added" ? `발췌 ${result.passagesAdded}개 추가` : result?.outcome === "no_excerpt" ? "추가할 발췌 없음" : "발췌 확인 중"}`;
}
