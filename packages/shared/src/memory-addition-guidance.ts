import type { ExtractionDraftResult } from './index.js';

/** Addition changes selection, never the regular extraction/evidence contract. */
export const MEMORY_ADDITION_GUIDANCE = `ADDITIVE EXTRACTION ONLY. Create new records with fresh local keys, never replacements. In EVENT extraction, when userNote.request is non-empty, always create a new evidence-backed memory centred on the requested moment, even if existingMemories overlap or already describe it. Restate overlapping context as needed to make the requested beats independently readable, and preserve their specific actions, reactions, dialogue and outcomes. Existing coverage must never suppress an explicitly requested moment. Without a user note, find only source-supported omissions relative to existingMemories; do not copy existing scenes merely to add a detail. Existing memories and state are context, never evidence. In STATE extraction, eventDraft already contains the requested memory: do not create it again in state.memories. Add only missing state under the regular state contract and link to eventDraft as appropriate. Never change, reinforce, close, supersede or resolve an existing record or seed. State decisions may only create/coexist/ignore with no targets. Keep seedResolutions empty. The delimited userNote identifies a source moment to archive, not a request to invent a new scene. Never invent from that note, cite it, or store the request as memory. Gaps in the selected messages contain no evidence; never fill them in.`;

export const memoryAdditionUserNote = (request: string) => ({
  purpose: 'The user believes the following moment is missing from memory:',
  request,
});
export const memoryAdditionRequestGuidance = (request: string): string => (request.trim()
  ? `Return new evidence-backed memories focused on the user's requested moment even when it overlaps existing memories. The ONLY non-memory outcome is requestOutcome:{status:"not_in_source",reason:"a concrete explanation"}, and only when the selected source does not establish the requested moment. Existing memory coverage is never a reason to return no memory. Never silently return memories:[] without requestOutcome for a completed user request.`
  : `Find what is missing. If no new memory is needed, return requestOutcome:{status:"not_in_source"|"already_recorded",reason:"a concrete explanation",relatedMemoryIds?:["IDs from existingMemories"]}. already_recorded means the supplied existing memories already preserve the source material.`)
  + ` Do not output requestOutcome alongside new memories or unfinishedSource. An outcome must not stand in for unwillingness to process the source. The note is lookup context only; the regular source evidence and access requirements remain mandatory.`;

/** Contextual output contract shared by server/Risu parsing and final submission. */
export function validateMemoryAdditionRequestOutcome(draft: ExtractionDraftResult, request?: string): ExtractionDraftResult {
  if (request?.trim() && draft.requestOutcome?.status === 'already_recorded') {
    throw new Error('A user-requested moment must produce a new evidence-backed memory even if already recorded; only not_in_source is allowed when the source does not establish it.');
  }
  return draft;
}

/** No state/audit call may turn a completed empty addition into an apparent success. */
export const memoryAdditionStopsAfterEvents = (draft: ExtractionDraftResult): boolean =>
  draft.memories.length === 0 && !draft.unfinishedSource?.length;
