/** Backfill's baseline estimate. Repairs, continuation and additional state pages
 * depend on generated output; embeddings are a separate operation. */
export function estimateBackfillCalls(input: {
  completedTurns: number; groupTurns: number; sourceTokens: number;
  initialStatus: string; reviewIncluded: boolean;
}) {
  const groupTurns = Math.min(50, Math.max(1, Math.round(input.groupTurns || 6)));
  const extractionGroups = input.completedTurns > 0 ? Math.ceil(input.completedTurns / groupTurns) : 0;
  const segmentCalls = Math.ceil(extractionGroups / 4);
  const arcCalls = Math.ceil(segmentCalls / 4);
  // Backfill flushes both remainders and builds one settled overview. Raw
  // source length does not predict atom paging against the configured budget.
  return {initialCalls: ['unseeded','awaiting_setup','failed'].includes(input.initialStatus) ? 1 : 0,
    storyCalls: segmentCalls + arcCalls + (arcCalls ? 1 : 0), extractionGroups, groupTurns, reviewIncluded: input.reviewIncluded};
}
