export interface SentenceSegment {
  segment: string;
  index: number;
  /** Offsets immediately after periods at suppressed ICU boundaries. */
  suppressedEnds: number[];
}

let segmenter: Intl.Segmenter | undefined;

export function segmentSentences(text: string): SentenceSegment[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "sentence" });
  const result: SentenceSegment[] = [];
  for (const part of segmenter.segment(text)) {
    const previous = result.at(-1);
    // Typographic boundary rule, not semantic classification: no title/word list.
    // A complete 1–3-letter token beginning uppercase, period + whitespace,
    // followed by an uppercase letter stays with the following ICU sentence.
    if (previous && /(?:^|[^\p{L}\p{N}\p{M}_])\p{Lu}\p{L}{0,2}\.\s+$/u.test(previous.segment)
      && /^\p{Lu}/u.test(part.segment)) {
      previous.suppressedEnds.push(previous.index + previous.segment.trimEnd().length);
      previous.segment += part.segment;
    } else result.push({ segment: part.segment, index: part.index, suppressedEnds: [] });
  }
  return result;
}
