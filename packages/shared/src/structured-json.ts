export type StructuredJsonRepair = "bom" | "trailing_comma" | "raw_control_character" | "missing_object_key_quote" | "trailing_confidence_quote" | "key_quote_search";

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
  if (/^[ \t\r\n\ufeff]*$/.test(prefix) && /^[ \t\r\n]*$/.test(suffix)) return text;
  return text.slice(start, end + 1);
}

function repairStructuredJsonCandidate(candidate: string): { text: string; repairs: StructuredJsonRepair[] } {
  const repairs = new Set<StructuredJsonRepair>();
  let input = candidate;
  let firstContent = 0;
  while (firstContent < input.length && /[ \t\r\n]/.test(input[firstContent] ?? "")) firstContent += 1;
  if (input.charCodeAt(firstContent) === 0xfeff) {
    input = input.slice(0, firstContent) + input.slice(firstContent + 1);
    repairs.add("bom");
  }

  // Some JSON-mode models emit bare keys or keys with only their closing
  // quote (for example: {affection:{...},trust":{...}}). Repair only
  // ASCII schema keys in an object-key position. The container-aware scan is
  // deliberately narrower than a regex so similar prose inside string values
  // is never rewritten.
  {
    let output = "";
    let inString = false;
    let escaped = false;
    const containers: Array<"object" | "array"> = [];
    for (let index = 0; index < input.length; index += 1) {
      const char = input[index] ?? "";
      if (inString) {
        output += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        output += char;
        inString = true;
        continue;
      }
      if (char === "{") containers.push("object");
      else if (char === "[") containers.push("array");
      else if (char === "}" || char === "]") containers.pop();

      output += char;
      const mayStartObjectKey = (char === "{" && containers.at(-1) === "object")
        || (char === "," && containers.at(-1) === "object");
      if (!mayStartObjectKey) continue;

      let keyStart = index + 1;
      while (keyStart < input.length && /[ \t\r\n]/.test(input[keyStart] ?? "")) keyStart += 1;
      if (!/[A-Za-z_]/.test(input[keyStart] ?? "")) continue;
      let keyEnd = keyStart + 1;
      while (keyEnd < input.length && /[A-Za-z0-9_-]/.test(input[keyEnd] ?? "")) keyEnd += 1;
      const hasClosingQuote = input[keyEnd] === '"';
      const boundary = keyEnd + (hasClosingQuote ? 1 : 0);
      let colon = boundary;
      while (colon < input.length && /[ \t\r\n]/.test(input[colon] ?? "")) colon += 1;
      if (input[colon] !== ":") continue;

      output += `${input.slice(index + 1, keyStart)}"${input.slice(keyStart, keyEnd)}"`;
      index = boundary - 1;
      repairs.add("missing_object_key_quote");
    }
    input = output;
  }

  let output = "";
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  let lastString = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }
      if (char === '"') {
        output += char;
        inString = false;
        lastString = input.slice(stringStart, index + 1);
        continue;
      }
      const code = char.charCodeAt(0);
      if (code < 0x20) {
        output += ({ 8: "\\b", 9: "\\t", 10: "\\n", 12: "\\f", 13: "\\r" } as Record<number, string>)[code]
          ?? `\\u${code.toString(16).padStart(4, "0")}`;
        repairs.add("raw_control_character");
        continue;
      }
      output += char;
      continue;
    }
    if (char === '"') {
      output += char;
      inString = true;
      stringStart = index;
      continue;
    }
    // confidence is a numeric field in the model contract. Remove only a
    // dangling quote after a complete numeric literal at that value boundary.
    // Quoted numbers, prose, unknown fields and malformed numbers stay intact;
    // the ordinary schema still checks type and range after syntax recovery.
    if (char === ":" && lastString === '"confidence"') {
      const value = input.slice(index + 1).match(/^(\s*-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)"(?=\s*[,}\]])/);
      if (value) {
        output += `:${value[1]}`;
        index += value[0].length;
        repairs.add("trailing_confidence_quote");
        lastString = "";
        continue;
      }
    }
    if (char === ",") {
      let next = index + 1;
      while (next < input.length && /[ \t\r\n]/.test(input[next] ?? "")) next += 1;
      if (input[next] === "}" || input[next] === "]") {
        repairs.add("trailing_comma");
        continue;
      }
    }
    output += char;
  }
  return { text: output, repairs: [...repairs] };
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

/** Parses one model-produced JSON object and only repairs unambiguous JSON syntax defects. */
export function parseStructuredModelJson(text: string): StructuredJsonParseResult {
  const candidate = structuredJsonCandidate(text);
  const strict = parseStrictJson(candidate);
  if (!strict.error) return { value: strict.value, repaired: false, repairs: [] };

  const repaired = repairStructuredJsonCandidate(candidate);
  const stage1 = parseStrictJson(repaired.text);
  if (!stage1.error) return { value: stage1.value, repaired: true, repairs: repaired.repairs };

  // The search starts from the model's own text, not the stage-1 output: one open-only key flips
  // quote parity, after which stage-1 rules would read string content as keys.
  if (candidate.length > 200_000) throw strict.error;
  if (parsePosition(strict.error) === undefined) throw strict.error;

  let current = candidate;
  const insertions: number[] = [];
  for (let count = 0; ; count += 1) {
    const parsed = parseStrictJson(current);
    if (!parsed.error) {
      const scan = scanJsonTokens(current);
      if (!scan || scan.duplicateKey || insertions.some((index) => !scan.keyQuotePositions.has(index))) throw strict.error;
      return {
        value: parsed.value,
        repaired: true,
        repairs: ["key_quote_search"],
        keyQuoteInsertions: insertions.length,
      };
    }
    if (count >= 32) throw strict.error;
    const failurePosition = parsePosition(parsed.error);
    if (failurePosition === undefined) throw strict.error;
    const candidates = keyQuoteCandidates(current, failurePosition);
    let best: { text: string; positions: number[]; score: number } | undefined;
    for (const positions of candidates) {
      let trial = current;
      for (const insertion of [...positions].reverse()) trial = trial.slice(0, insertion) + '"' + trial.slice(insertion);
      const trialParse = parseStrictJson(trial);
      const score = trialParse.error ? (parsePosition(trialParse.error) ?? -1) : Number.POSITIVE_INFINITY;
      if (score > failurePosition + positions.length && (!best || score > best.score)) best = { text: trial, positions, score };
    }
    if (!best) throw strict.error;
    current = best.text;
    best.positions.forEach((insertion, offset) => shiftedInsertions(insertions, insertion + offset));
  }
  throw strict.error;
}
