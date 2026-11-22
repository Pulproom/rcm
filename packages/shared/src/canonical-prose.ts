import { z } from 'zod';
import { ROLEPLAY_ARCHIVE_FRAMING } from './social-memory-guidance.js';

// Product-owned prose slots, shared by validation and future translation tools.
// Identity/name/alias, dialogue, sourceQuote, evidence, date and enum slots are absent.
const slots = (prefix: string, fields: readonly string[]) => fields.map(field => `${prefix}.${field}`);
const detail = ['text'] as const;
const observation = ['value', 'description', 'predicateHint', 'predicate', 'promiseKeyHint', 'content', 'amendment', 'statusReason', 'reason', 'notes', 'socialRelation.label', 'support.*.text'] as const;
const draft = [
  ...slots('entities.*', ['notes']),
  ...slots('memories.*', ['title', 'content', 'details.*.text', 'landmarkKinds.*.label']),
  'momentsToReturn.*.text',
];
const state = [
  ...draft,
  ...slots('detailAdditions.*.detail', detail), 'detailAdditions.*.text',
  ...slots('stateObservations.*', observation),
  'relationshipEvents.*.reason', 'relationshipBaselines.*.reason',
  'physicalIntimacy.*.customLabel', 'physicalIntimacy.*.circumstance',
  'decisions.*.reason', 'pairProgress.*.reason', 'seedResolutions.*.reason', 'seedResolutions.*.support.*.text',
  'notes', 'notes.*.what',
];
export const CANONICAL_PROSE_FIELDS = {
  extraction: draft,
  audit: [
    ...slots('detailAdditions.*.detail', detail),
    ...draft.filter(path => path.startsWith('memories.')).map(path => path.replace('memories.', 'memoryAdditions.')),
    'landmarkPatches.*.landmark.label',
    ...slots('observationAdditions.*', observation), ...slots('observationPatches.*.observation', observation),
    ...state.map(path => `additions.${path}`),
  ],
  state: [...state, ...state.map(path => `state.${path}`)],
} as const;
export type CanonicalProseStage = keyof typeof CANONICAL_PROSE_FIELDS;
export const CANONICAL_LANGUAGE_NAMES = { en: 'English', ko: 'Korean', ja: 'Japanese', zh: 'Chinese' } as const;
export const CANONICAL_LANGUAGE_UI_NAMES = { en: '영어', ko: '한국어', ja: '일본어', zh: '중국어' } as const;
export type CanonicalTranslationItem = { id: string; text: string };
export interface CanonicalTranslationPreview {
  language: keyof typeof CANONICAL_LANGUAGE_NAMES; memories: number; details: number; states: number; items: number; calls: number;
}
export const CanonicalTranslationResultSchema = z.object({ items: z.array(z.object({ id: z.string().min(1), text: z.string() })) });

/** Product-owned exact-string preservation, never a judgement about meaning. */
export function canonicalTranslationIssue(original: string, translated: string, registeredNames: readonly string[] = []) {
  if (!translated.trim()) return 'blank' as const;
  const quotes=original.match(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|«[^»]*»|"[^"]*"|(?<![\p{L}\p{N}])'[^'\n]+'(?![\p{L}\p{N}])/gu) ?? [];
  if (quotes.some(quote=>!translated.includes(quote))) return 'quoted_text_changed' as const;
  if (registeredNames.some(name=>name && original.includes(name) && !translated.includes(name))) return 'registered_name_changed' as const;
  return undefined;
}

export function canonicalTranslationSystemPrompt(language: keyof typeof CANONICAL_LANGUAGE_NAMES): string {
  const target = CANONICAL_LANGUAGE_NAMES[language];
  return `${ROLEPLAY_ARCHIVE_FRAMING}

You translate saved roleplay-memory records into ${target}, the archive's canonical language. Each item has an id and text. Return strict JSON only: {"items":[{"id":"…","text":"…"}]} with one entry for every supplied id, in the same order.
- Rewrite any part that is not in ${target} into natural ${target}. Keep parts already in ${target} exactly as they are.
- Keep the meaning, tense, attribution, names and numbers. Do not add, drop, soften or explain anything.
- Keep proper names as written in the item. Quoted speech inside an item stays in its original language.
- Never merge, split or reorder items.`;
}

/** Missing IDs are tolerated by completion. Unknown or duplicate IDs are not writable. */
export function validateCanonicalTranslation(value: unknown, items: CanonicalTranslationItem[]) {
  const result = CanonicalTranslationResultSchema.parse(value);
  const allowed = new Map(items.map((item, index) => [item.id, index]));
  let previous = -1;
  for (const item of result.items) {
    const index = allowed.get(item.id);
    if (index === undefined || index <= previous) throw new Error('CANONICAL_TRANSLATION_IDS: unknown, duplicate or reordered item');
    previous = index;
  }
  return result;
}

export function canonicalProseEntries(value: unknown, stage: CanonicalProseStage): Array<{ path: string; text: string }> {
  if (stage === 'audit' && value && typeof value === 'object' && 'patch' in value) value = value.patch;
  const entries = new Map<string, string>();
  const visit = (current: unknown, segments: string[], path: string) => {
    if (!segments.length) {
      if (typeof current === 'string') entries.set(path, current);
      else if (Array.isArray(current)) current.forEach((item, index) => visit(item, [], `${path}[${index}]`));
      return;
    }
    const [segment, ...rest] = segments;
    if (segment === '*') {
      if (Array.isArray(current)) current.forEach((item, index) => visit(item, rest, `${path}[${index}]`));
    } else if (current && typeof current === 'object' && !Array.isArray(current)) {
      visit((current as Record<string, unknown>)[segment!], rest, path ? `${path}.${segment}` : segment!);
    }
  };
  for (const field of CANONICAL_PROSE_FIELDS[stage]) visit(value, field.split('.'), '');
  return [...entries].map(([path, text]) => ({ path, text }));
}

/** Unicode script membership, not language detection. */
export function canonicalForeignScriptCount(text: string): number {
  return [...text.matchAll(/[\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu)].length;
}

export function memoryHasCanonicalScriptIssue(memory: unknown, language: string): boolean {
  return inspectCanonicalProse({ memories: [memory] }, language, 'extraction').length > 0;
}
export const CanonicalScriptIssueSchema = z.object({ path: z.string(), count: z.number().int().positive() });
export type CanonicalScriptIssue = z.infer<typeof CanonicalScriptIssueSchema>;
export const CanonicalLanguageDiagnosticSchema = z.object({
  stage: z.enum(['extraction', 'audit', 'state']), phase: z.enum(['initial', 'retained']),
  fields: z.array(CanonicalScriptIssueSchema),
  reason: z.enum(['repair_structure_changed']).optional(),
});
export type CanonicalLanguageDiagnostic = z.infer<typeof CanonicalLanguageDiagnosticSchema>;

/** Script membership in owned fields only; never a natural-language meaning test.
 * Counts Unicode code points, including supplementary Han ideographs. */
export function inspectCanonicalProse(value: unknown, language: string, stage: CanonicalProseStage): CanonicalScriptIssue[] {
  if (language !== 'en') return [];
  return canonicalProseEntries(value, stage).flatMap(({ path, text }) => {
    const count = canonicalForeignScriptCount(text);
    return count ? [{ path, count }] : [];
  });
}
