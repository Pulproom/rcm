import { ModelContentValidationError } from "./structured-repair.js";
import type { ExtractionAuditPatch, ExtractionDraftResult } from "./index.js";

export function validateSourceRecoveryPatch(patch: ExtractionAuditPatch, draft?: ExtractionDraftResult): ExtractionAuditPatch {
  for (const [key, value] of Object.entries(patch)) {
    if (["access", "discardItemRefs", "keepPendingItemRefs", "additions"].includes(key)) continue;
    if (Array.isArray(value) && value.length) throw new ModelContentValidationError(`Source recovery cannot change ${key}`);
  }
  for (const [key, value] of Object.entries(patch.additions)) {
    if (key !== "sourcePassages" && value !== undefined && (!Array.isArray(value) || value.length)) throw new ModelContentValidationError(`Source recovery cannot add ${key}`);
  }
  const dialogueRefs = new Set((draft?.memories ?? []).flatMap(memory => (memory.keyDialogues ?? [])
    .map((dialogue, index) => `dialogue:${memory.key}:${dialogue.messageId}:${index}`)));
  if ([...patch.access.map((item) => item.itemRef), ...patch.discardItemRefs, ...patch.keepPendingItemRefs]
    .some((ref) => !/^source:\d+$/.test(ref) && !dialogueRefs.has(ref))) {
    throw new ModelContentValidationError("Source recovery may change only source:N refs or supplied dialogue refs");
  }
  return patch;
}

/** References address the frozen audit draft, never an array already spliced by a patch. */
export function applySourceAccessPatch(result: ExtractionDraftResult, patch: ExtractionAuditPatch): string[] {
  const original = [...(result.sourcePassages ?? [])];
  const resolve = (ref: string) => {
    const index = /^source:(\d+)$/.exec(ref)?.[1];
    const passage = index === undefined ? undefined : original[Number(index)];
    if (!passage) throw new ModelContentValidationError(`Unknown audit itemRef: ${ref}`);
    return passage;
  };
  const pending: string[] = [];
  const updated = new Set<string>();
  for (const item of patch.access.filter((item) => item.itemRef.startsWith("source:"))) {
    if (updated.has(item.itemRef)) throw new ModelContentValidationError(`Duplicate source access patch: ${item.itemRef}`);
    updated.add(item.itemRef);
    const passage = resolve(item.itemRef);
    // An audit cannot turn a failed access decision into a narrator-only declaration.
    if (!item.grants.length) pending.push(item.itemRef);
    else passage.access = item.grants;
  }
  const removed = new Set([...patch.discardItemRefs, ...patch.keepPendingItemRefs, ...pending]
    .filter((ref) => ref.startsWith("source:")).map(resolve));
  if (removed.size) result.sourcePassages = original.filter((passage) => !removed.has(passage));
  return pending;
}
