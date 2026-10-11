import { createHash } from "node:crypto";
import type { MemoryContextItem } from "@rcm/shared";

export type MemoryAtomKind = "state" | "summary" | "detail" | "dialogue" | "source" | "physical_occurrence" | "physical_detail" | "relationship_landmark";

export function memoryAtomKey(kind: MemoryAtomKind, id: string, content: string): string {
  const digest = createHash("sha256").update(`${kind}\0${id}\0${content}`).digest("hex").slice(0, 32);
  return `atom:v1:${digest}`;
}

export function memorySummaryAtomKey(item: MemoryContextItem): string | undefined {
  if (!item.title && !item.content) return undefined;
  return memoryAtomKey("summary", item.id, `${item.title}\0${item.content}`);
}

export function memoryDetailAtomKey(detail: Pick<MemoryContextItem["details"][number], "id" | "text">): string {
  return memoryAtomKey("detail", detail.id, detail.text);
}

export function memoryDialogueAtomKey(
  memoryId: string,
  dialogue: MemoryContextItem["keyDialogues"][number],
): string {
  const identity = dialogue.id ?? `${memoryId}\0${dialogue.messageId}\0${dialogue.speaker}\0${dialogue.kind}`;
  return memoryAtomKey("dialogue", identity, dialogue.text);
}

export function memoryAtomKeys(item: MemoryContextItem): string[] {
  const summary = item.atomAccessVersion > 0 ? undefined : memorySummaryAtomKey(item);
  return [
    ...(summary ? [summary] : []),
    ...item.details.map(memoryDetailAtomKey),
    ...item.keyDialogues.map((dialogue) => memoryDialogueAtomKey(item.id, dialogue)),
  ];
}

export function physicalOccurrenceAtomKey(item: { id: string; milestone_key: string; participant_a: string; participant_b: string }): string {
  return memoryAtomKey("physical_occurrence", item.id, `${item.participant_a}\0${item.participant_b}\0${item.milestone_key}`);
}

export function physicalDetailAtomKey(item: { id: string; act: string; initiator: string | null; interaction_context: string; circumstance: string | null; source_memory_id: string | null }): string {
  return memoryAtomKey("physical_detail", item.id, `${item.act}\0${item.initiator ?? ""}\0${item.interaction_context}\0${item.circumstance ?? ""}\0${item.source_memory_id ?? ""}`);
}

export function relationshipLandmarkAtomKey(memoryId: string, index: number, landmark: MemoryContextItem["landmarkKinds"][number]): string {
  return memoryAtomKey("relationship_landmark", `${memoryId}:${index}`, JSON.stringify(landmark));
}

export function filterMemoryAtoms(item: MemoryContextItem, excluded: ReadonlySet<string>): MemoryContextItem {
  if (excluded.size === 0) return item;
  const summaryKey = memorySummaryAtomKey(item);
  return {
    ...item,
    ...(summaryKey && excluded.has(summaryKey) ? { title: "", content: "" } : {}),
    details: item.details.filter((detail) => !excluded.has(memoryDetailAtomKey(detail))),
    keyDialogues: item.keyDialogues.filter((dialogue) => !excluded.has(memoryDialogueAtomKey(item.id, dialogue))),
  };
}

export function hasRenderableMemoryAtom(item: MemoryContextItem): boolean {
  return Boolean(item.title || item.content || item.details.length || item.keyDialogues.length);
}
