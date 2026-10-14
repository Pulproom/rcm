export type StateOutcome = "delivered" | "not_collected" | "not_current" | "perspective_blocked" | "not_linked"
  | "prompt_covered" | "budget" | "deduped" | "final_ceiling" | "memory_only" | "not_rendered";

export interface StateOutcomeEntry {
  id: string; kind: string; perspectives: string[]; outcome: StateOutcome;
  reason?: string; rank?: number; title?: string;
  rendered?: "folded_into_names" | "omitted_empty";
  /** Final eligible peripheral survivors, not a claim that one alone would fund the row. */
  keptPeripheralMemoryIds?: string[];
}
export interface StateOutcomeReport {
  entries: StateOutcomeEntry[];
  omittedCount: number;
  nonCandidateCounts?: Partial<Record<StateOutcome, number>>;
  budgets: Array<{ perspective: string; budgetTokens: number; usedTokens: number }>;
}

/** Diagnostic sidecar only. One entry per state/perspective; never used to select a packet. */
export class StateOutcomeCapture {
  private entries = new Map<string, StateOutcomeEntry>();
  private lines = new Map<string, string>();
  private budgets = new Map<string, StateOutcomeReport["budgets"][number]>();
  private omittedCount = 0;
  private nonCandidates = new Map<string, StateOutcome>();

  record(perspective: string, item: { id: string; kind: string; text?: string }, outcome: StateOutcome,
    extra: Pick<StateOutcomeEntry, "reason" | "rank" | "keptPeripheralMemoryIds" | "rendered"> = {}): void {
    const key = JSON.stringify([perspective, item.id]);
    if (["not_collected", "not_current", "perspective_blocked", "not_linked", "memory_only"].includes(outcome)) {
      this.nonCandidates.set(key, outcome);
      return;
    }
    this.nonCandidates.delete(key);
    const previous = this.entries.get(key);
    if (!previous && this.entries.size >= 300) { this.omittedCount++; return; }
    this.entries.set(key, { ...previous, id: item.id, kind: item.kind, perspectives: [perspective], outcome,
      ...(item.text ? { title: item.text.replace(/\s+/g, " ").slice(0, 120) } : {}), ...extra });
  }

  budget(perspective: string, budgetTokens: number, usedTokens: number): void {
    this.budgets.set(perspective, { perspective, budgetTokens, usedTokens });
  }

  emitted(perspective: string, id: string, line: string): void {
    const key = JSON.stringify([perspective, id]);
    if (this.entries.has(key)) this.lines.set(key, line);
  }

  /** Rebuilds are speculative until the last render. Reset only previously emitted rows. */
  beginAssembly(): void {
    for (const key of this.lines.keys()) this.entries.get(key)!.outcome = "final_ceiling";
  }

  assembled(perspective: string, line: string, duplicate: boolean): void {
    for (const [key, rendered] of this.lines) {
      const entry = this.entries.get(key)!;
      if (entry.outcome === "final_ceiling" && rendered === line && (entry.perspectives[0] === perspective || perspective === "shared" && entry.perspectives[0] === "__shared__")) {
        entry.outcome = duplicate ? "deduped" : "delivered";
        return;
      }
    }
  }

  snapshot(): StateOutcomeReport {
    const nonCandidateCounts: Partial<Record<StateOutcome, number>> = {};
    for (const outcome of this.nonCandidates.values()) nonCandidateCounts[outcome] = (nonCandidateCounts[outcome] ?? 0) + 1;
    return { entries: [...this.entries.values()].map(entry => ({ ...entry })), omittedCount: this.omittedCount,
      nonCandidateCounts,
      budgets: [...this.budgets.values()].map(budget => ({ ...budget })) };
  }
}
