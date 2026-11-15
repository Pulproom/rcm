import { jsonrepair } from "jsonrepair";

export type StructuredJsonRepair = "jsonrepair" | "trailing_confidence_quote" | "key_quote_search" | "missing_closing_bracket";

export const MODEL_OUTPUT_TRUNCATED_MESSAGE = "보조 모델 응답이 최대 길이에서 잘렸어요. 보조 모델의 최대 출력 토큰을 늘리거나, 설정에서 ‘한 번에 정리할 턴’을 줄여 주세요.";

/** JSON framing only; escaped quotes/braces in prose are not structural tokens. */
export function isStructuredOutputTruncated(output: string): boolean {
  const text = output.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.search(/[\[{]/);
  if (start < 0) return false;
  const stack: string[] = [];
  let quoted = false, escaped = false;
  for (const char of text.slice(start)) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      if (stack.pop() !== (char === "}" ? "{" : "[")) return false;
      if (!stack.length) return false;
    }
  }
  if (!stack.length) return false;
  // Only a guarded repair without EOF completion can disprove truncation.
  try { parseStructuredModelJson(text.slice(start)); return false; } catch { return true; }
}

export function modelOutputTruncatedError(finishReason?: string): Error & { code: string; finishReason?: string } {
  return Object.assign(new Error(`MODEL_OUTPUT_TRUNCATED: ${MODEL_OUTPUT_TRUNCATED_MESSAGE}`), { code: "MODEL_OUTPUT_TRUNCATED", finishReason });
}

export class StructuredJsonSyntaxError extends SyntaxError {
  constructor(message: string) {
    super(message);
    this.name = "StructuredJsonSyntaxError";
  }
}

export interface StructuredJsonParseResult {
  value: unknown;
  repaired: boolean;
  repairs: StructuredJsonRepair[];
  keyQuoteInsertions?: number;
}

const OPTIONAL_STRING_FIELDS = new Set([
  "perspective", "storyTime", "customLabel", "initiator", "interactionContext", "circumstance",
  "sourceQuote", "memoryKey", "detailKey", "validFromMemoryKey", "source", "scheduledFor",
  "statusReason", "reason", "holder", "label", "landmark", "targetBeliefId",
]);

const OPTIONAL_ARRAY_FIELDS = new Set([
  "witnesses", "locations", "landmarkKinds", "keyDialogues", "details", "relationshipEvents",
  "socialKnowledge", "relationshipBaselines", "physicalIntimacy", "memoryRecallObservations", "atomRelations",
  "access", "activeTensions", "basisEventIds", "targetAssertionIds", "targetBeliefIds", "targetIds",
]);

/** Normalizes only optional model-output leaves for which null/blank and absence
 * have the same meaning. Required facts, enums, evidence, IDs, and prose are
 * deliberately left untouched so local code cannot manufacture valid output. */
export function normalizeStructuredModelOptionals(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeStructuredModelOptionals);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key === "sourcePassages" && Array.isArray(raw)) {
      output[key] = raw.map((passage) => {
        const normalized = normalizeStructuredModelOptionals(passage);
        if (normalized && typeof normalized === "object" && !Array.isArray(normalized)
          && (normalized as Record<string, unknown>).speaker === null) delete (normalized as Record<string, unknown>).speaker;
        return normalized;
      });
      continue;
    }
    if (OPTIONAL_STRING_FIELDS.has(key) && (raw === null || (typeof raw === "string" && raw.trim() === ""))) continue;
    if (OPTIONAL_ARRAY_FIELDS.has(key) && raw === null) {
      output[key] = [];
      continue;
    }
    output[key] = normalizeStructuredModelOptionals(raw);
  }
  return output;
}

function structuredJsonCandidate(text: string): string {
  if (!text.trim()) throw new StructuredJsonSyntaxError("Structured model returned an empty response.");
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced !== undefined) return fenced;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new StructuredJsonSyntaxError("Structured model response did not contain a complete JSON object.");
  const prefix = text.slice(0, start);
  const suffix = text.slice(end + 1);
  // A JSON continuation after the last nested object is part of the response,
  // even when the model added a preamble. Never hide its keys or cut-off string.
  if (/^\s*[,:[{"'\]]/.test(suffix)) return text.slice(start);
  if (/^[ \t\r\n\ufeff]*$/.test(prefix) && /^[ \t\r\n]*$/.test(suffix)) return text;
  return text.slice(start, end + 1);
}

/** jsonrepair turns dangling numeric quotes into strings; keep the numeric
 * confidence contract, as covered by the server extraction regression. */
function repairConfidenceQuotes(input: string): string {
  let output = "";
  let inString = false, escaped = false;
  let stringStart = -1, lastString = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') { inString = false; lastString = input.slice(stringStart, index + 1); }
      continue;
    }
    if (char === '"') { output += char; inString = true; stringStart = index; continue; }
    if (char === ":" && lastString === '"confidence"') {
      const value = input.slice(index + 1).match(/^(\s*-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)"(?=\s*[,}\]])/);
      if (value) {
        output += `:${value[1]}`;
        index += value[0].length;
        lastString = "";
        continue;
      }
    }
    output += char;
  }
  return output;
}

function parsePosition(error: unknown): number | undefined {
  if (!(error instanceof SyntaxError)) return undefined;
  const position = error.message.match(/position\s+(\d+)/i)?.[1];
  if (position === undefined) return undefined;
  const parsed = Number(position);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Each candidate quotes one key-shaped identifier completely (one or two insertions), so a half-quoted
 * key can never look like progress by swallowing the following text into a string. */
function keyQuoteCandidates(text: string, position: number): number[][] {
  const candidates: number[][] = [];
  const from = Math.max(0, position - 64);
  const to = Math.min(text.length, position + 1);
  const identifiers = /[A-Za-z_][A-Za-z0-9_]*/g;
  identifiers.lastIndex = from;
  let match: RegExpExecArray | null;
  while ((match = identifiers.exec(text)) !== null && match.index <= to) {
    const start = match.index;
    const end = start + match[0].length;
    let before = start - 1;
    while (before >= 0 && /\s/.test(text[before] ?? "")) before -= 1;
    let after = end;
    while (after < text.length && /\s/.test(text[after] ?? "")) after += 1;
    if (!["{", ",", '"'].includes(text[before] ?? "")) continue;
    if (text[after] === '"') {
      after += 1;
      while (after < text.length && /\s/.test(text[after] ?? "")) after += 1;
    }
    if (text[after] !== ":") continue;
    const missing = [text[start - 1] !== '"' ? start : -1, text[end] !== '"' ? end : -1].filter((index) => index >= 0);
    if (missing.length) candidates.push(missing);
  }
  return candidates;
}

type JsonTokenScan = { end: number; keyQuotePositions: Set<number>; duplicateKey: boolean };

function skipJsonWhitespace(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index] ?? "")) index += 1;
  return index;
}

function scanJsonString(text: string, start: number): { end: number; value: string } | undefined {
  if (text[start] !== '"') return undefined;
  let escaped = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      const raw = text.slice(start, index + 1);
      try {
        return { end: index + 1, value: JSON.parse(raw) as string };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function scanJsonValue(text: string, start: number, keyQuotePositions: Set<number>): JsonTokenScan | undefined {
  const index = skipJsonWhitespace(text, start);
  if (text[index] === '"') {
    const string = scanJsonString(text, index);
    return string ? { end: string.end, keyQuotePositions, duplicateKey: false } : undefined;
  }
  if (text[index] === "{") return scanJsonObject(text, index, keyQuotePositions);
  if (text[index] === "[") return scanJsonArray(text, index, keyQuotePositions);
  let end = index;
  while (end < text.length && !/[\s,}\]]/.test(text[end] ?? "")) end += 1;
  return end > index ? { end, keyQuotePositions, duplicateKey: false } : undefined;
}

function scanJsonArray(text: string, start: number, keyQuotePositions: Set<number>): JsonTokenScan | undefined {
  let index = skipJsonWhitespace(text, start + 1);
  let duplicateKey = false;
  if (text[index] === "]") return { end: index + 1, keyQuotePositions, duplicateKey };
  while (index < text.length) {
    const value = scanJsonValue(text, index, keyQuotePositions);
    if (!value) return undefined;
    index = skipJsonWhitespace(text, value.end);
    duplicateKey ||= value.duplicateKey;
    if (text[index] === ",") {
      index = skipJsonWhitespace(text, index + 1);
      continue;
    }
    if (text[index] === "]") return { end: index + 1, keyQuotePositions, duplicateKey };
    return undefined;
  }
  return undefined;
}

function scanJsonObject(text: string, start: number, keyQuotePositions: Set<number>): JsonTokenScan | undefined {
  let index = skipJsonWhitespace(text, start + 1);
  const keys = new Set<string>();
  let duplicateKey = false;
  if (text[index] === "}") return { end: index + 1, keyQuotePositions, duplicateKey };
  while (index < text.length) {
    const keyStart = index;
    const key = scanJsonString(text, keyStart);
    if (!key) return undefined;
    keyQuotePositions.add(keyStart);
    keyQuotePositions.add(key.end - 1);
    if (keys.has(key.value)) duplicateKey = true;
    keys.add(key.value);
    index = skipJsonWhitespace(text, key.end);
    if (text[index] !== ":") return undefined;
    const value = scanJsonValue(text, index + 1, keyQuotePositions);
    if (!value) return undefined;
    index = skipJsonWhitespace(text, value.end);
    duplicateKey ||= value.duplicateKey;
    if (text[index] === ",") {
      index = skipJsonWhitespace(text, index + 1);
      continue;
    }
    if (text[index] === "}") return { end: index + 1, keyQuotePositions, duplicateKey };
    return undefined;
  }
  return undefined;
}

function scanJsonTokens(text: string): JsonTokenScan | undefined {
  const keyQuotePositions = new Set<number>();
  const scan = scanJsonValue(text, 0, keyQuotePositions);
  if (!scan || skipJsonWhitespace(text, scan.end) !== text.length) return undefined;
  return scan;
}

function shiftedInsertions(insertions: number[], insertion: number): void {
  for (let index = 0; index < insertions.length; index += 1) {
    if (insertions[index]! >= insertion) insertions[index]! += 1;
  }
  insertions.push(insertion);
}

function parseStrictJson(text: string): { value: unknown; error?: StructuredJsonSyntaxError } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { value: undefined, error: new StructuredJsonSyntaxError(message) };
  }
}

/** jsonrepair cannot recover open-only key quotes. Keep the bounded search
 * and its key-position/duplicate-key checks for that existing regression. */
function repairKeyQuotes(candidate: string, error: StructuredJsonSyntaxError): { text: string; insertions: number } {
  if (candidate.length > 200_000 || parsePosition(error) === undefined) throw error;
  let current = candidate;
  const insertions: number[] = [];
  for (let count = 0; ; count += 1) {
    const parsed = parseStrictJson(current);
    if (!parsed.error) {
      const scan = scanJsonTokens(current);
      if (!scan || scan.duplicateKey || insertions.some((index) => !scan.keyQuotePositions.has(index))) throw error;
      return { text: current, insertions: insertions.length };
    }
    if (count >= 32) throw error;
    const failurePosition = parsePosition(parsed.error);
    if (failurePosition === undefined) throw error;
    const candidates = keyQuoteCandidates(current, failurePosition);
    let best: { text: string; positions: number[]; score: number } | undefined;
    for (const positions of candidates) {
      let trial = current;
      for (const insertion of [...positions].reverse()) trial = trial.slice(0, insertion) + '"' + trial.slice(insertion);
      const trialParse = parseStrictJson(trial);
      const score = trialParse.error ? (parsePosition(trialParse.error) ?? -1) : Number.POSITIVE_INFINITY;
      if (score > failurePosition + positions.length && (!best || score > best.score)) best = { text: trial, positions, score };
    }
    if (!best) throw error;
    current = best.text;
    best.positions.forEach((insertion, offset) => shiftedInsertions(insertions, insertion + offset));
  }
  throw error;
}

type ModelJsonScan = { keys: Set<string>; stack: string[]; mismatched: boolean; completeEnd: boolean };

/** Tokenizes our JSON syntax, not prose: colons inside string values are never
 * keys. Also accepts single-quoted and bare keys for the local repair input. */
function scanModelJson(text: string): ModelJsonScan {
  const keys = new Set<string>();
  const stack: string[] = [];
  let mismatched = false;
  let completeEnd = false;
  let previous = "";
  for (let index = 0; index < text.length;) {
    index = skipJsonWhitespace(text, index);
    if (index >= text.length) break;
    const start = index;
    const char = text[index++]!;
    if (char === '"' || char === "'") {
      let closed = false;
      while (index < text.length) {
        const next = text[index++];
        if (next === "\\") index += 1;
        else if (next === char) { closed = true; break; }
      }
      if (!closed) throw new StructuredJsonSyntaxError("Local JSON repair cannot close an unterminated string.");
      const raw = text.slice(start, index);
      if (text[skipJsonWhitespace(text, index)] === ":") keys.add(JSON.parse(jsonrepair(raw)) as string);
      completeEnd = previous === ":" || previous === "[" || previous === ",";
      previous = "string";
      continue;
    }
    if ("{}[],:".includes(char)) {
      if (char === "{" || char === "[") stack.push(char);
      else if (char === "}" || char === "]") {
        if (stack.pop() !== (char === "}" ? "{" : "[")) mismatched = true;
      }
      completeEnd = char === "}" || char === "]";
      previous = char;
      continue;
    }
    while (index < text.length && !/[\s{}\[\],:'"]/.test(text[index]!)) index += 1;
    const raw = text.slice(start, index);
    // A closing-only key quote is syntax already supported by jsonrepair.
    if (text[index] === '"' && text[skipJsonWhitespace(text, index + 1)] === ":") index += 1;
    if (text[skipJsonWhitespace(text, index)] === ":") keys.add(raw);
    try { JSON.parse(raw); completeEnd = true; } catch { completeEnd = false; }
    previous = "literal";
  }
  return { keys, stack, mismatched, completeEnd };
}

function objectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (value && typeof value === "object") {
    if (!Array.isArray(value)) for (const key of Object.keys(value)) keys.add(key);
    for (const child of Object.values(value)) objectKeys(child, keys);
  }
  return keys;
}

// Ignore trailing commas that jsonrepair removes between existing closers;
// only a longer closing suffix can require completion at the end of the input.
function closingSuffix(text: string): string {
  return text.match(/(?:[}\],]\s*)*$/)?.[0].replace(/[\s,]/g, "") ?? "";
}

/** Strict parsing wins. Repairs may fix syntax, but may neither finish a string
 * nor turn a model-written object key into a value. */
export function parseStructuredModelJson(text: string, options?: { normalStop?: boolean }): StructuredJsonParseResult {
  let candidate: string;
  try { candidate = structuredJsonCandidate(text); }
  catch (error) {
    if (!options?.normalStop) throw error;
    candidate = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = candidate.indexOf("{");
    if (start < 0) throw error;
    candidate = candidate.slice(start);
  }
  const strict = parseStrictJson(candidate);
  if (!strict.error) return { value: strict.value, repaired: false, repairs: [] };
  const repairs: StructuredJsonRepair[] = [];
  const confidence = repairConfidenceQuotes(candidate);
  if (confidence !== candidate) repairs.push("trailing_confidence_quote");
  let input = confidence;
  let repaired: string;
  let keyQuoteInsertions: number | undefined;
  try { repaired = jsonrepair(input); }
  catch {
    const keys = repairKeyQuotes(input, strict.error);
    input = keys.text;
    keyQuoteInsertions = keys.insertions;
    repairs.push("key_quote_search");
    repaired = jsonrepair(input);
  }
  // These two legacy prepasses only remove a numeric quote or insert key
  // quotes: scan the model's tokens, never jsonrepair's guessed structure.
  const scan = scanModelJson(input);
  const parsed = parseStrictJson(repaired);
  if (parsed.error) throw strict.error;
  const keys = objectKeys(parsed.value);
  if ([...scan.keys].some(key => !keys.has(key))) {
    throw new StructuredJsonSyntaxError(`Local JSON repair lost an object key. ${strict.error.message}`);
  }
  if (closingSuffix(repaired).length > closingSuffix(input).length) {
    if (!options?.normalStop || scan.mismatched || !scan.stack.length || !scan.completeEnd) throw strict.error;
    repairs.push("missing_closing_bracket");
  }
  if (repaired !== input) repairs.push("jsonrepair");
  return { value: parsed.value, repaired: true, repairs, ...(keyQuoteInsertions === undefined ? {} : { keyQuoteInsertions }) };
}
