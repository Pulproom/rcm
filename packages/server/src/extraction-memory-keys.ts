import { remapExtractionMemoryKeys, ModelContentValidationError } from "@rcm/shared";
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
  return remapExtractionMemoryKeys(result, extractionMemoryKeyMap(result, scopeId, reserved));
}

export function extractionMemoryKeyMap(result: Pick<ExtractionResult, 'memories'>, scopeId: string, reserved?:ReadonlySet<string>): Map<string,string> {
  if (new Set(result.memories.map(memory => memory.key)).size !== result.memories.length) {
    throw new ModelContentValidationError("Duplicate local memory key in extraction result");
  }
  return new Map(result.memories.map(memory => [memory.key,
    scopeMemoryKey(memory.key, scopeId, reserved)]));
}

export { remapExtractionMemoryKeys, remapStateMemoryKeys } from "@rcm/shared";
