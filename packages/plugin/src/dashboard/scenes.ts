import { compareStoryMemories, isScene, storyScenes, sceneNumbers } from "@rcm/shared";
export { compareStoryMemories, isScene, storyScenes, sceneNumbers };
import { isRecognitionMemory } from "@rcm/shared";

/** `number` and `place` let a caller write a short range (S#12–S#31) or name where it happened. */
export type SceneRef = { memoryId: string; label: string; number?: number; place?: string };

/**
 * Finds the scene a source ordinal belongs to: the active scene whose first source message is the
 * latest one at or before it. A scene's `source_ordinal` is its first source message.
 */
export function sceneLocator(memories: any[], formatDate: (storyTime: string) => string): (ordinal: unknown) => SceneRef | null {
  const numbers = sceneNumbers(memories);
  const scenes = storyScenes(memories)
    .filter((memory) => memory.active !== false && Number.isFinite(Number(memory.source_ordinal)))
    .sort((left, right) => Number(left.source_ordinal) - Number(right.source_ordinal));
  const ref = (memory: any): SceneRef => {
    const date = memory.story_time ? formatDate(String(memory.story_time)) : "";
    const number = numbers.get(String(memory.id));
    const place = Array.isArray(memory.locations) ? String(memory.locations[0] ?? "").trim() : "";
    return { memoryId: String(memory.id), label: [`S#${number ?? "?"}`, date].filter(Boolean).join(" · "), ...(number === undefined ? {} : { number }), ...(place ? { place } : {}) };
  };
  const byId = new Map(scenes.map((memory) => [String(memory.id), memory]));
  return (target: unknown) => {
    if (typeof target === "string" && byId.has(target)) return ref(byId.get(target));
    const ordinal = Number(target);
    if (target === null || target === undefined || target === "" || !Number.isFinite(ordinal)) return null;
    let found: any = null;
    for (const memory of scenes) {
      if (Number(memory.source_ordinal) > ordinal) break;
      found = memory;
    }
    return found ? ref(found) : null;
  };
}

/** The latest active scenes, newest first. */
export const recentScenes = (memories: any[], count: number): any[] =>
  storyScenes(memories).filter((memory) => memory.active !== false).slice(-count).reverse();

/** An act's linked memories in story order (capsule children and initial calibration excluded). */
export const actScenes = (group: any, memories: any[]): any[] => {
  const ids = new Set((group?.linkedMemoryIds ?? []).map(String));
  return memories.filter((memory) => memory && ids.has(String(memory.id)) && !memory.capsule_parent_id && !isRecognitionMemory(memory)).sort(compareStoryMemories);
};

/** Up to `count` frames for an act strip: landmarks first, then scenes with dialogue spread across the act, shown in story order. */
export function pickFrames(scenes: any[], count: number): any[] {
  const landmarks = scenes.filter((memory) => memory.landmark);
  const spoken = scenes.filter((memory) => !memory.landmark && Array.isArray(memory.keyDialogues) && memory.keyDialogues.some((line: any) => String(line?.text ?? "").trim()));
  const rest = scenes.filter((memory) => !landmarks.includes(memory) && !spoken.includes(memory));
  const spread = (items: any[], n: number) => n <= 0 ? [] : items.length <= n ? items : Array.from({ length: n }, (_, index) => items[Math.floor(index * items.length / n)]);
  const chosen = [...landmarks.slice(0, count)];
  chosen.push(...spread(spoken, count - chosen.length));
  chosen.push(...spread(rest, count - chosen.length));
  const order = new Map(scenes.map((memory, index) => [memory, index]));
  return chosen.sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
}
