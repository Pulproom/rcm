import type { DashboardData } from "../dashboard.js";
import type { RuntimeState, TranslationDisplay } from "../types.js";
import { displayText } from "../translation.js";
import { buildAnniversaries, daysSinceFirstMet } from "./diary.js";
import { recentScenes, storyScenes } from "./scenes.js";
import { buildNowPage, overduePromiseEntries } from "./now.js";
import { buildPairs, normalizeName, type PairSummary } from "./pairs.js";
import { formatStoryTime, compareParsedStoryTimes, parseStoryTime } from "@rcm/shared";

export type InjectionManifest = NonNullable<RuntimeState["cache"][string]["lastInjectionManifest"]>;
export type HomeTranslationRecord = { kind: string; itemId: string; text: string };
export type HomePair = { key: string; a: string; b: string; label: string | null; days: number | null; scenes: number; lastScene: string | null };

const text = (value: unknown): string => String(value ?? "").trim();
const byId = <T extends { id?: unknown }>(items: T[] | undefined, id: unknown): T | undefined =>
  (items ?? []).find((item) => String(item?.id ?? "") === String(id ?? ""));
const safeText = (value: unknown): string => displayText(text(value), undefined, "en");

export type InjectedStateRow = { tag: string; whoHtml: string; textHtml: string };

/** Every 현재 record that went this turn, in the 현재 tab's order: states, beliefs, promises. */
export function injectedStateRows(
  manifest: InjectionManifest,
  data: Pick<DashboardData, "assertions" | "promises" | "beliefs">,
  translations: ReadonlyMap<string, string>,
  display: TranslationDisplay = "ko",
): InjectedStateRow[] {
  return [
    ...manifest.assertionIds.flatMap((id) => {
      const item: any = byId(data.assertions as any[], id);
      return item ? [{ tag: "상태", whoHtml: safeText(item.subject), textHtml: displayText(text(item.value), translations.get(`assertion:${item.id}`), display) }] : [];
    }),
    ...(manifest.beliefIds ?? []).flatMap((id) => {
      const item: any = byId(data.beliefs as any[], id);
      return item ? [{ tag: "인식", whoHtml: `${safeText(item.holder)} → ${safeText(item.subject)}`, textHtml: displayText(text(item.value), translations.get(`belief:${item.id}`), display) }] : [];
    }),
    ...manifest.promiseIds.flatMap((id) => {
      const item: any = byId(data.promises as any[], id);
      return item ? [{ tag: "약속", whoHtml: `${safeText(item.promisor)} → ${safeText(item.promisee)}`, textHtml: displayText(text(item.content), translations.get(`promise:${item.id ?? item.promise_key}`), display) }] : [];
    }),
  ];
}

/** The poster scene and the three before it, newest first. */
export function homeRecentMemories(memories: DashboardData["memories"]): DashboardData["memories"] {
  return recentScenes(memories, 4);
}

export function homeTranslationRecords(
  manifest: InjectionManifest | undefined,
  data: Pick<DashboardData, "memories" | "assertions" | "promises" | "beliefs">,
  /** The full view of this turn's delivery is open, so every 현재 record it lists is visible. */
  sentOpen = false,
): HomeTranslationRecord[] {
  const visible = [
    // Injected scene titles are short and lead the widget; 현재 records show only in the full view.
    ...(manifest?.memoryIds ?? []).flatMap((id) => {
      const memory: any = byId(data.memories as any[], id);
      return memory && text(memory.title) ? [{ kind: "memory-title", itemId: `${memory.id}:title`, text: text(memory.title) }] : [];
    }),
    ...homeRecentMemories(data.memories).flatMap((memory) => {
      const lines: any[] = Array.isArray(memory.keyDialogues) ? memory.keyDialogues : [];
      const index = lines.findIndex((line) => text(line?.text));
      return [
        { kind: "memory-title", itemId: `${memory.id}:title`, text: text(memory.title) },
        ...(index < 0 ? [] : [{ kind: "dialogue", itemId: `${memory.id}:dialogue:${index}`, text: text(lines[index].text) }]),
      ];
    }),
    ...(manifest && sentOpen ? [
      ...manifest.assertionIds.flatMap((id) => { const item: any = byId(data.assertions as any[], id); return item ? [{ kind: "assertion", itemId: `assertion:${item.id}`, text: text(item.value) }] : []; }),
      ...(manifest.beliefIds ?? []).flatMap((id) => { const item: any = byId(data.beliefs as any[], id); return item ? [{ kind: "belief", itemId: `belief:${item.id}`, text: text(item.value) }] : []; }),
      ...manifest.promiseIds.flatMap((id) => { const item: any = byId(data.promises as any[], id); return item ? [{ kind: "promise", itemId: `promise:${item.id ?? item.promise_key}`, text: text(item.content) }] : []; }),
    ] : []),
    // The phone home leads with the first overdue promise; it reads the same promise key as the ledger.
    ...overduePromiseEntries(buildNowPage(data as DashboardData, (data as DashboardData).personaEntity ?? null, "promise", "recent")).slice(0, 1)
      .map(({ row }) => ({ kind: "promise", itemId: `promise:${row.id}`, text: text(row.text) })),
  ];
  return [...new Map(visible.filter((record) => record.text).map((record) => [record.itemId, record])).values()];
}

const latestStoryTime = (data: DashboardData): string | null => {
  let current: string | null = null;
  for (const memory of data.memories ?? []) {
    if (memory?.active === false) continue;
    const candidate = text(memory?.story_time_normalized);
    if (!candidate || parseStoryTime(candidate).calendar === "unknown") continue;
    if (current === null || (compareParsedStoryTimes(parseStoryTime(current), parseStoryTime(candidate)) ?? 0) < 0) current = candidate;
  }
  return current;
};

const involves = (memory: any, pair: PairSummary): boolean => {
  const names = (Array.isArray(memory?.participants) ? memory.participants : []).map(text);
  return names.includes(pair.a) && names.includes(pair.b);
};

/** Main relationships for the call sheet: the persona-centred (tier 1) pairs only, persona named first. */
export function buildHomePairs(data: DashboardData): HomePair[] {
  const now = latestStoryTime(data);
  const scenes = storyScenes(data.memories ?? []).filter((memory) => memory.active !== false);
  const persona = normalizeName(data.personaEntity);
  return buildPairs(data, data.personaEntity).filter((pair) => pair.tier === 1).map((pair) => {
    const anniversaries = buildAnniversaries(data, pair, data.viewPreferences?.hiddenAnniversaries ?? []);
    const shared = scenes.filter((memory) => involves(memory, pair));
    const last: any = shared.at(-1);
    const [a, b] = persona && normalizeName(pair.b) === persona ? [pair.b, pair.a] : [pair.a, pair.b];
    return {
      key: pair.key, a, b, label: pair.label,
      days: daysSinceFirstMet(anniversaries, now),
      scenes: shared.length,
      lastScene: last ? text(last.story_time ?? last.storyTime) || null : null,
    };
  });
}

export function homePencilCounts(data: DashboardData): { overdue: number; attention: number } {
  const page = buildNowPage(data, data.personaEntity, "promise", "recent");
  return {
    overdue: overduePromiseEntries(page).length,
    attention: page.pendingAttention,
  };
}
