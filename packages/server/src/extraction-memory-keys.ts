import { ModelContentValidationError } from "@rcm/shared";
import { createHash } from "node:crypto";
import type { ExtractionResult } from "@rcm/shared";

export function availableMemoryKey(base:string,reserved?:ReadonlySet<string>):string {
  let key=base, suffix=2;
  while (reserved?.has(key)) key=`${base}#${suffix++}`;
  return key;
}

export const scopeMemoryKey = (key: string, scopeId: string, reserved?:ReadonlySet<string>): string =>
  availableMemoryKey(`batch:${scopeId}:${createHash("sha256").update(key).digest("hex")}`,reserved);

/** Model declarations are local to one extraction batch. Canonical keys must
 * not let another batch's common label (such as mem-1) overwrite old events.
 * Hash the local key, not its array position: audit retries can restore an
 * earlier omitted item or reorder items without changing existing identities.
 * Apply once after model/audit processing, before canonical storage. */
export function scopeExtractionMemoryKeys(result: ExtractionResult, scopeId: string, reserved?:ReadonlySet<string>): ExtractionResult {
  if (new Set(result.memories.map(memory => memory.key)).size !== result.memories.length) {
    throw new ModelContentValidationError("Duplicate local memory key in extraction result");
  }
  const keys = new Map(result.memories.map(memory => [memory.key,
    scopeMemoryKey(memory.key, scopeId, reserved)]));
  return remapExtractionMemoryKeys(result,keys);
}

/** Every typed local link follows the same mapping in scoping and regeneration. */
export function remapExtractionMemoryKeys(result: ExtractionResult, keys: ReadonlyMap<string,string>): ExtractionResult {
  const remap = (key: string): string => keys.get(key) ?? key;
  const withMemoryKey = <T extends { memoryKey?: string; support?:Array<{memoryKey:string;detailKey:string}> }>(item: T): T =>
    ({ ...item, ...(item.memoryKey === undefined ? {} : {memoryKey:remap(item.memoryKey)}),
      ...(item.support === undefined ? {} : {support:item.support.map(ref=>({...ref,memoryKey:remap(ref.memoryKey)}))}) });
  return {
    ...result,
    memories: result.memories.map(memory => ({ ...memory, key: remap(memory.key), associations: memory.associations.map(remap) })),
    assertions: result.assertions.map(item => ({ ...withMemoryKey(item),
      ...(item.validFromMemoryKey ? { validFromMemoryKey: remap(item.validFromMemoryKey) } : {}),
      ...(item.socialRelation ? { socialRelation: withMemoryKey(item.socialRelation) } : {}),
    })),
    pairProgress: result.pairProgress?.map(withMemoryKey),
    promises: result.promises.map(withMemoryKey),
    beliefs: result.beliefs.map(withMemoryKey),
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
