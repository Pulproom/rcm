export function normalizeUnitScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000) / 1_000;
}

export function normalizeSignedScore(value: number): number {
  return Math.round(Math.max(-1, Math.min(1, value)) * 1_000) / 1_000;
}
