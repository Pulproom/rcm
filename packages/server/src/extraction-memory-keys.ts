import { createHash } from "node:crypto";
import type { ExtractionResult } from "@rcm/shared";

/** Model declarations are local to one extraction batch. Canonical keys must
 * not let another batch's common label (such as mem-1) overwrite old events.
 * Hash the local key, not its array position: audit retries can restore an
 * earlier omitted item or reorder items without changing existing identities.
 * Apply once after model/audit processing, before canonical storage. */
export function scopeExtractionMemoryKeys(result: ExtractionResult, scopeId: string): ExtractionResult {
  if (new Set(result.memories.map(memory => memory.key)).size !== result.memories.length) {
    throw new Error("Duplicate local memory key in extraction result");
  }
  const keys = new Map(result.memories.map(memory => [memory.key,
    `batch:${scopeId}:${createHash("sha256").update(memory.key).digest("hex")}`]));
  const remap = (key: string): string => keys.get(key) ?? key;
  const withMemoryKey = <T extends { memoryKey?: string }>(item: T): T =>
    item.memoryKey === undefined ? item : { ...item, memoryKey: remap(item.memoryKey) };
  return {
    ...result,
    memories: result.memories.map(memory => ({ ...memory, key: remap(memory.key), associations: memory.associations.map(remap) })),
    assertions: result.assertions.map(item => ({ ...item,
      ...(item.validFromMemoryKey ? { validFromMemoryKey: remap(item.validFromMemoryKey) } : {}),
      ...(item.socialRelation ? { socialRelation: withMemoryKey(item.socialRelation) } : {}),
    })),
    promises: result.promises.map(withMemoryKey),
    socialKnowledge: result.socialKnowledge?.map(withMemoryKey),
    relationshipEvents: result.relationshipEvents?.map(withMemoryKey),
    physicalIntimacy: result.physicalIntimacy?.map(withMemoryKey),
    atomRelations: result.atomRelations?.map(relation => ({ ...relation,
      source: { ...relation.source, memoryKey: remap(relation.source.memoryKey) },
      target: "atomRef" in relation.target ? relation.target
        : { ...relation.target, memoryKey: remap(relation.target.memoryKey) },
    })),
  };
}
