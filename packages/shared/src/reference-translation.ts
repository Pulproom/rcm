import { ROLEPLAY_ARCHIVE_FRAMING } from "./social-memory-guidance.js";
import { estimateTokens } from "./index.js";
import { splitAuxiliarySource } from "./auxiliary-budget.js";
import { settingsFailureMessage } from "./support-diagnostics.js";
import { isStructuredOutputTruncated, parseStructuredModelJson } from "./structured-json.js";
import { z } from "zod";
export const translationTimeoutMs = (maxOutput: number): number => Math.max(120_000, maxOutput * 8);
export const TRANSLATION_DEFAULT_OUTPUT = 16000;
export class TranslationError extends Error {
  constructor(readonly code: string, detail: string) { super(code === "CHAT_WORK_HELD" ? detail : settingsFailureMessage({ code }, "translation")); this.name = "TranslationError"; }
}
export const TRANSLATION_CONTEXT_LIMITS = { speaker: 256, relationship: 768 } as const;
const TranslationItemSchema = z.object({
  id: z.string().max(512), text: z.string(), speaker: z.string().max(TRANSLATION_CONTEXT_LIMITS.speaker).optional(),
});
const TranslationPartSchema = TranslationItemSchema.extend({ partIndex: z.number().int().nonnegative(), partCount: z.number().int().positive() })
  .refine(part => part.partIndex < part.partCount, "Invalid translation part index");
const TranslationSceneSchema = z.object({
  participants: z.array(z.string().max(TRANSLATION_CONTEXT_LIMITS.speaker)).max(100),
  relationships: z.array(z.string().max(TRANSLATION_CONTEXT_LIMITS.relationship)).max(300),
  references: z.array(z.string().max(16000)).max(1000),
  items: z.array(TranslationItemSchema).min(1).max(10000),
});
export const TranslationRequestSchema = z.object({
  scenes: z.array(TranslationSceneSchema).max(10000), other: z.array(TranslationItemSchema).max(10000),
}).refine(request => request.other.length + request.scenes.reduce((n, scene) => n + scene.items.length, 0) <= 10000, "Too many translation items");
export const TranslationBatchSchema = TranslationRequestSchema.safeExtend({
  scenes: z.array(TranslationSceneSchema.extend({ items: z.array(TranslationPartSchema).min(1).max(10000) })).max(10000),
  other: z.array(TranslationPartSchema).max(10000),
});
export type TranslationRequest = z.infer<typeof TranslationRequestSchema>;
export interface TranslationPart { id: string; partIndex: number; partCount: number; text: string; speaker?: string }
export interface TranslationBatch { scenes: Array<Omit<TranslationRequest["scenes"][number], "items"> & { items: TranslationPart[] }>; other: TranslationPart[] }
export const translationParts = (batch: TranslationBatch): TranslationPart[] => [...batch.scenes.flatMap(scene => scene.items), ...batch.other];
export const translationItemCost = (batch: TranslationRequest): number => estimateTokens(JSON.stringify({ ...batch, scenes: batch.scenes.map(scene => ({ ...scene, references: [] })) }));
export const translationReferenceCost = (batch: TranslationRequest): number => batch.scenes.reduce((total, scene) => total + scene.references.reduce((n, text) => n + estimateTokens(text), 0), 0);
/** Scene headers count toward input cost; reader windows have their own budget. */
export function planTranslation(request: TranslationRequest, maxOutput = TRANSLATION_DEFAULT_OUTPUT): TranslationBatch[] {
  if (!Number.isSafeInteger(maxOutput) || maxOutput < 256 || maxOutput > 128000) throw new TranslationError("INVALID_CONFIG", "Translation output budget must be 256–128000 tokens");
  const budget = Math.floor(maxOutput / 3);
  const batches: TranslationBatch[] = [];
  let batch: TranslationBatch = { scenes: [], other: [] };
  const flush = () => { if (translationParts(batch).length) batches.push(batch); batch = { scenes: [], other: [] }; };
  const groups = [...request.scenes.map(scene => ({ header: { participants: scene.participants, relationships: scene.relationships, references: scene.references }, items: scene.items })), { header: undefined, items: request.other }];
  for (const group of groups) {
    const wrap = (items: TranslationPart[]): TranslationBatch => group.header ? { scenes: [{ ...group.header, items }], other: [] } : { scenes: [], other: items };
    const expanded = group.items.flatMap(item => {
      const whole = { ...item, partIndex: 0, partCount: 1 };
      if (translationItemCost(wrap([whole])) <= budget) return [whole];
      let target = Math.max(1, budget - translationItemCost(wrap([{ ...item, text: "", partIndex: 0, partCount: 1 }])) - 16);
      let pieces = splitAuxiliarySource(item.text, estimateTokens, target);
      while (pieces.some((p, i) => translationItemCost(wrap([{ ...item, text: p.text, partIndex: i, partCount: pieces.length }])) > budget)) {
        if (target === 1) throw new TranslationError("INVALID_CONFIG", "Translation scene header exceeds output budget");
        target = Math.max(1, Math.floor(target * .75)); pieces = splitAuxiliarySource(item.text, estimateTokens, target);
      }
      return pieces.map((p, i) => ({ ...item, text: p.text, partIndex: i, partCount: pieces.length }));
    });
    const append = (target: TranslationBatch, items: TranslationPart[]): TranslationBatch => group.header
      ? { scenes: [...target.scenes, { ...group.header, items }], other: target.other }
      : { scenes: target.scenes, other: [...target.other, ...items] };
    if (group.header && translationItemCost(wrap(expanded)) <= budget) {
      if (translationItemCost(append(batch, expanded)) > budget) flush();
      batch = append(batch, expanded);
    } else {
      let chunk: TranslationPart[] = [];
      for (const part of expanded) {
        if (translationItemCost(append(batch, [...chunk, part])) > budget) { if (chunk.length) batch = append(batch, chunk); flush(); chunk = []; }
        chunk.push(part);
      }
      if (chunk.length) batch = append(batch, chunk);
    }
  }
  flush();
  return batches.map(batch => {
    let remaining = Math.floor(maxOutput / 2);
    return { ...batch, scenes: batch.scenes.map(scene => ({ ...scene, references: scene.references.filter(text => {
      const cost = estimateTokens(text);
      if (cost > remaining) { remaining = 0; return false; }
      remaining -= cost; return true;
    }) })) };
  });
}
/** Split once at the nearest scene boundary; only a lone scene is split by parts. */
export function splitTranslationBatch(batch: TranslationBatch): [TranslationBatch, TranslationBatch] | undefined {
  const groups: TranslationBatch[] = batch.scenes.map(scene => ({ scenes: [scene], other: [] }));
  if (batch.other.length) groups.push({ scenes: [], other: batch.other });
  if (groups.length > 1) {
    const costs = groups.map(translationItemCost);
    const target = costs.reduce((sum, cost) => sum + cost, 0) / 2;
    let cost = 0, boundary = 1, distance = Infinity;
    for (let index = 1; index < groups.length; index++) {
      cost += costs[index - 1]!;
      if (Math.abs(cost - target) < distance) { boundary = index; distance = Math.abs(cost - target); }
    }
    const combine = (groups: TranslationBatch[]): TranslationBatch => ({ scenes: groups.flatMap(group => group.scenes), other: groups.flatMap(group => group.other) });
    return [combine(groups.slice(0, boundary)), combine(groups.slice(boundary))];
  }
  const items = translationParts(batch);
  if (items.length < 2) return undefined;
  const middle = Math.ceil(items.length / 2);
  const wrap = (items: TranslationPart[]): TranslationBatch => batch.scenes.length
    ? { scenes: [{ ...batch.scenes[0]!, items }], other: [] } : { scenes: [], other: items };
  return [wrap(items.slice(0, middle)), wrap(items.slice(middle))];
}
/** Typographic script guard only, never a judgement of translation meaning. */
export function untranslatedParts(expected: TranslationPart[], translated: Array<{ id: string; partIndex: number; ko: string }>): TranslationPart[] {
  return expected.filter(part => /\p{L}/u.test(part.text) && !/\p{Script=Hangul}/u.test(part.text)
    && !/\p{Script=Hangul}/u.test(translated.find(row => row.id === part.id && row.partIndex === part.partIndex)?.ko ?? ""));
}
export const translationSystemPrompt = `${ROLEPLAY_ARCHIVE_FRAMING}

Translate each text into natural Korean for a reader following this roleplay.

Input
- scenes: story records in story order. Each scene gives the people present (participants), how the speakers relate to the others as recorded now (relationships, which may be later than the scene), references and the items to translate: its title, record text and dialogue lines, each line with its speaker. references are Korean passages the reader already read in the chat where the scene's lines were spoken, each possibly cut at either end; they show how the reader has been hearing these characters.
- other: items that belong to no single scene.
- A long text may come as several parts with the same id and consecutive partIndex values.

How to translate
- Title and record text: translate faithfully and naturally. Preserve proper names, numbers, directions, quotations and meaning.
- Dialogue: translate each line in full from its original text, as spoken, present-day Korean. Give it the voice the references show for that speaker with the same people, in this scene or elsewhere in this request: speech level (반말 or 존댓말), forms of address and nicknames, word choice and rhythm. Learn the voice from the references rather than copying their sentences; where a reference holds this very line, keep the expressions the reader already saw only where they fit your full translation.
- Take only Korean from the references, never their layout: no quotation marks they add, no original-language half of a bilingual pair, no notes.
- Keep each line's strength: do not make it sound older, stiffer, sweeter, harsher or more storybook-like than the original, and add no swearing that is not there.
- Use relationships only to choose the speech level and the form of address when no reference shows them; do not add feelings or meaning from them. When nothing shows them, choose what the scene makes most natural and keep it for every line by that speaker in the scene.
- Write names the way the references write them. Keep other words in another language than the main text, including terms of endearment, as they are, written in Korean letters (for example, chérie → 셰리).
- Every ko is Korean text. Do not add explanations, notes or words that are not in the text.

Return strict JSON only as {"items":[{"id":string,"partIndex":number,"ko":string}]}, with every part from every scene and from other, each with its exact id and partIndex.`;
export function validateTranslation(content: string, expected: TranslationPart[], finishReason?: unknown): Array<{ id: string; partIndex: number; ko: string }> {
  if (["LENGTH", "MAX_TOKENS", "MAX_OUTPUT_TOKENS"].includes(String(finishReason ?? "").toUpperCase()) || isStructuredOutputTruncated(content)) throw new TranslationError("MODEL_OUTPUT_TRUNCATED", "");
  let parsed: any;
  try { parsed = parseStructuredModelJson(content, { normalStop: String(finishReason ?? "").trim().toUpperCase() === "STOP" }).value; }
  catch { throw new TranslationError("INVALID_RESPONSE", "번역 모델이 유효한 JSON을 반환하지 않았어요."); }
  if (!Array.isArray(parsed.items) || parsed.items.length !== expected.length) throw new TranslationError("INVALID_RESPONSE", "번역 응답의 항목 수가 맞지 않아요.");
  return expected.map(part => {
    const matches = parsed.items.filter((item: any) => item.id === part.id && (item.partIndex === part.partIndex || (part.partCount === 1 && item.partIndex === undefined)));
    if (matches.length !== 1 || typeof matches[0].ko !== "string" || !matches[0].ko.trim()) throw new TranslationError("INVALID_RESPONSE", "번역 응답에 누락되거나 중복된 구간이 있어요.");
    return { id: part.id, partIndex: part.partIndex, ko: matches[0].ko };
  });
}
