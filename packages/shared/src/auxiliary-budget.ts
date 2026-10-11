export interface AuxiliaryPromptBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface AuxiliaryPromptMeasurement {
  estimatedInputTokens: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  fits: boolean;
}

/** Measure the serialized, provider-ready message contents. Callers must pass
 * every instruction, source, reference, repair request and JSON envelope. */
export function measureAuxiliaryPrompt(
  messages: Array<{ role: string; content: string }>,
  estimate: (text: string) => number,
  budget: AuxiliaryPromptBudget,
): AuxiliaryPromptMeasurement {
  const estimatedInputTokens = estimate(JSON.stringify(messages));
  return { ...budget, estimatedInputTokens, fits: estimatedInputTokens <= budget.maxInputTokens };
}

/** Lossless fallback splitter. It prefers paragraph/newline boundaries and
 * retains UTF-16 source offsets so no caller needs to infer tokens from chars. */
export function splitAuxiliarySource(
  source: string,
  estimate: (text: string) => number,
  maxTokens: number,
): Array<{ start: number; end: number; text: string; estimatedTokens: number }> {
  if (maxTokens < 1) throw new Error("Auxiliary input budget must be positive");
  const parts: Array<{ start: number; end: number; text: string; estimatedTokens: number }> = [];
  let start = 0;
  while (start < source.length) {
    let low = start + 1;
    let high = source.length;
    let fit = start;
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      if (estimate(source.slice(start, middle)) <= maxTokens) { fit = middle; low = middle + 1; }
      else high = middle - 1;
    }
    if (fit === start) throw new Error(`Source cannot progress within ${maxTokens} input tokens at offset ${start}`);
    let end = fit;
    if (fit < source.length) {
      const paragraph = source.lastIndexOf("\n\n", Math.max(start, fit - 2));
      const newline = source.lastIndexOf("\n", fit - 1);
      const preferred = paragraph >= start ? paragraph + 2 : newline >= start ? newline + 1 : -1;
      if (preferred > start && preferred <= fit) end = preferred;
      if (end < source.length && /[\uD800-\uDBFF]/u.test(source[end - 1] ?? "") && /[\uDC00-\uDFFF]/u.test(source[end] ?? "")) end -= 1;
    }
    if (end <= start) {
      const codePoint = source.codePointAt(start);
      end = start + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
      if (estimate(source.slice(start, end)) > maxTokens) throw new Error(`Source cannot progress within ${maxTokens} input tokens at offset ${start}`);
    }
    const text = source.slice(start, end);
    parts.push({ start, end, text, estimatedTokens: estimate(text) });
    start = end;
  }
  return parts;
}
