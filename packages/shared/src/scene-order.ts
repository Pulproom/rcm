import { isRecognitionMemory } from "./memory-origin.js";
import { compareStoryTimes } from "./story-time.js";

/**
 * Story order: story_time first, then the scene's place in the chat (its first source message), then the revision.
 * A backfill creates every memory at one revision, so the source position is what keeps same-day scenes in order.
 */
export function compareStoryMemories(left: any, right: any): number {
  const byStoryTime = compareStoryTimes(left?.story_time ?? left?.storyTime, right?.story_time ?? right?.storyTime) ?? 0;
  if (byStoryTime !== 0) return byStoryTime;
  const leftSource = Number(left?.source_ordinal ?? left?.sourceOrdinal), rightSource = Number(right?.source_ordinal ?? right?.sourceOrdinal);
  if (Number.isFinite(leftSource) && Number.isFinite(rightSource) && leftSource !== rightSource) return leftSource - rightSource;
  // The id settles full ties so an ascending and a descending sort always mirror each other.
  return Number(left?.created_revision ?? left?.updated_revision ?? left?.updated_at ?? Number.MAX_SAFE_INTEGER)
    - Number(right?.created_revision ?? right?.updated_revision ?? right?.updated_at ?? Number.MAX_SAFE_INTEGER)
    || String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
}

/** A scene is an episode memory; capsule children and standalone recognition are not scenes. */
export const isScene = (memory: any): boolean =>
  Boolean(memory) && memory.type === "episode" && !memory.capsule_parent_id && !isRecognitionMemory(memory);

/** Scenes in story order. */
export const storyScenes = (memories: any[]): any[] => memories.filter(isScene).sort(compareStoryMemories);

/** Chronological scene numbers (S#n), stable across screens. */
export function sceneNumbers(memories: any[]): Map<string, number> {
  return new Map(storyScenes(memories).map((memory, index) => [String(memory.id), index + 1]));
}
