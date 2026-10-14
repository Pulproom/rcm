import { estimateTokens } from "./index.js";
import { splitAuxiliarySource } from "./auxiliary-budget.js";
export const TRANSLATION_TIMEOUT_MS = 120_000;
export const TRANSLATION_DEFAULT_OUTPUT = 8000;
export class TranslationError extends Error {
  constructor(readonly code: string, detail: string) { super(detail); this.name = "TranslationError"; }
}
export interface TranslationPart { id: string; partIndex: number; partCount: number; text: string }
/** Output includes the JSON envelope; Korean expansion reserves 1.5 tokens per source token. */
export function planTranslation(items: Array<{ id: string; text: string }>, maxOutput = TRANSLATION_DEFAULT_OUTPUT): TranslationPart[][] {
  if (!Number.isSafeInteger(maxOutput) || maxOutput < 256 || maxOutput > 128000) throw new TranslationError("INVALID_CONFIG", "Translation output budget must be 256–128000 tokens");
  const budget = Math.floor(maxOutput / 1.5);
  const cost = (parts: TranslationPart[]) => estimateTokens(JSON.stringify({ items: parts }));
  const expanded = items.flatMap(item => {
    let target = Math.max(1, budget - cost([{ ...item, text: "", partIndex: 0, partCount: 1 }]) - 16);
    let pieces = splitAuxiliarySource(item.text, estimateTokens, target);
    while (pieces.some((p, i) => cost([{ id: item.id, text: p.text, partIndex: i, partCount: pieces.length }]) > budget)) {
      if (target === 1) throw new TranslationError("INVALID_CONFIG", "Translation item identifier exceeds output budget");
      target = Math.max(1, Math.floor(target * .75)); pieces = splitAuxiliarySource(item.text, estimateTokens, target);
    }
    return pieces.map((p, i) => ({ id: item.id, text: p.text, partIndex: i, partCount: pieces.length }));
  });
  const batches: TranslationPart[][] = []; let batch: TranslationPart[] = [];
  for (const part of expanded) {
    if (batch.length && cost([...batch, part]) > budget) { batches.push(batch); batch = []; }
    batch.push(part);
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export const translationSystemPrompt = 'Translate each text to natural Korean. Preserve proper names, numbers, directions, quotations, and meaning. Return strict JSON only as {"items":[{"id":string,"partIndex":number,"ko":string}]}. Return every supplied part separately with its exact id and partIndex.';
export function validateTranslation(content: string, expected: TranslationPart[], finishReason?: unknown): Array<{ id: string; partIndex: number; ko: string }> {
  if (["LENGTH", "MAX_TOKENS", "MAX_OUTPUT_TOKENS"].includes(String(finishReason ?? "").toUpperCase())) throw new TranslationError("MODEL_OUTPUT_TRUNCATED", "번역 응답이 잘려 저장하지 않았습니다.");
  let parsed: any;
  try { parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new TranslationError("INVALID_RESPONSE", "번역 모델이 유효한 JSON을 반환하지 않았습니다."); }
  if (!Array.isArray(parsed.items) || parsed.items.length !== expected.length) throw new TranslationError("INVALID_RESPONSE", "번역 응답의 항목 수가 맞지 않습니다.");
  return expected.map(part => {
    const matches = parsed.items.filter((item: any) => item.id === part.id && (item.partIndex === part.partIndex || (part.partCount === 1 && item.partIndex === undefined)));
    if (matches.length !== 1 || typeof matches[0].ko !== "string" || !matches[0].ko.trim()) throw new TranslationError("INVALID_RESPONSE", "번역 응답에 누락되거나 중복된 구간이 있습니다.");
    return { id: part.id, partIndex: part.partIndex, ko: matches[0].ko };
  });
}
