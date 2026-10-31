import type { DashboardData } from "../dashboard.js";
import type { PairSummary } from "./pairs.js";

export const normalizeName = (value: unknown): string => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
export const memoryIdOf = (item: any): string | null => String(item?.sourceMemoryId ?? item?.source_memory_id ?? "").trim() || null;
export const memoryStoryTime = (memory: any): string | null => String(memory?.story_time_normalized ?? memory?.storyTime ?? memory?.story_time ?? "").trim() || null;

const namesMatchPair = (left: unknown, right: unknown, pair: PairSummary): boolean => {
  const expected = new Set([normalizeName(pair.a), normalizeName(pair.b)]);
  const actual = new Set([normalizeName(left), normalizeName(right)]);
  return expected.size === 2 && actual.size === 2 && [...expected].every((name) => actual.has(name));
};
export const arrayMatchesPair = (value: unknown, pair: PairSummary): boolean =>
  Array.isArray(value) && value.length === 2 && namesMatchPair(value[0], value[1], pair);
export const itemMatchesPair = (item: any, pair: PairSummary): boolean =>
  arrayMatchesPair(item?.pair, pair)
  || arrayMatchesPair(item?.participants, pair)
  || namesMatchPair(item?.from, item?.to, pair)
  || namesMatchPair(item?.participantA, item?.participantB, pair)
  || namesMatchPair(item?.promisor, item?.promisee, pair);
export const memoryMatchesPair = (memory: any, pair: PairSummary): boolean =>
  arrayMatchesPair(memory?.participants, pair)
  || (memory?.landmarkKinds ?? []).some((landmark: any) => arrayMatchesPair(landmark?.pair, pair));

/** Keep history first; current records only fill states absent from history. */
export function mergePromiseHistory(data: Pick<DashboardData, "promiseHistory" | "promises">): any[] {
  const promiseEvents = [...(data.promiseHistory ?? [])];
  const recordedPromiseStates = new Set(promiseEvents.map((item: any) => [
    String(item?.promise_id ?? item?.id ?? item?.promise_key ?? ""),
    String(item?.status ?? ""),
  ].join("#")));
  for (const item of data.promises ?? []) {
    const key = [String(item?.id ?? item?.promise_id ?? item?.promise_key ?? ""), String(item?.status ?? "")].join("#");
    if (!recordedPromiseStates.has(key)) promiseEvents.push(item);
  }
  return promiseEvents;
}
