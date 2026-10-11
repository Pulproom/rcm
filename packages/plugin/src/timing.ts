import type { RuntimeState } from "./types.js";

export type TimingKind = "automatic_injection" | "mcp" | "auxiliary_llm";
export type TimingOutcome = "running" | "succeeded" | "failed" | "reused";

export interface TimingEvent {
  id: string;
  chatId: string;
  kind: TimingKind;
  label: string;
  startedAt: number;
  elapsedMs?: number;
  completedAt?: number;
  outcome: TimingOutcome;
}

const EVENTS_PER_CHAT = 8;

export function startTiming(state: RuntimeState, event: Omit<TimingEvent, "id" | "startedAt" | "outcome"> & { startedAt?: number }): TimingEvent {
  const timing: TimingEvent = {
    ...event,
    id: crypto.randomUUID(),
    startedAt: event.startedAt ?? Date.now(),
    outcome: "running",
  };
  state.timingEvents = [timing, ...(state.timingEvents ?? [])]
    .filter((item, index, events) => item.chatId !== timing.chatId || events.slice(0, index + 1).filter(candidate => candidate.chatId === timing.chatId).length <= EVENTS_PER_CHAT);
  state.publishActivity?.();
  return timing;
}

export function finishTiming(state: RuntimeState, timing: TimingEvent, outcome: Exclude<TimingOutcome, "running">): void {
  timing.completedAt = Date.now();
  timing.elapsedMs = Math.max(0, timing.completedAt - timing.startedAt);
  timing.outcome = outcome;
  state.publishActivity?.();
}

export function timingsForChat(state: RuntimeState, chatId: string | undefined): TimingEvent[] {
  return chatId ? (state.timingEvents ?? []).filter((event) => event.chatId === chatId) : [];
}

export const TIMING_COMPLETION_VISIBLE_MS = 2_000;

export function latestVisibleCompletedTiming(state: RuntimeState, chatId: string | undefined, observedAt = Date.now()): TimingEvent | undefined {
  return timingsForChat(state, chatId)
    .filter(event => event.outcome !== "running" && event.completedAt !== undefined
      && observedAt < event.completedAt + TIMING_COMPLETION_VISIBLE_MS)
    .sort((left, right) => right.completedAt! - left.completedAt!)[0];
}
