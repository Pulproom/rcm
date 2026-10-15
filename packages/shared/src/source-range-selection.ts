/** Excluded rows bridge a selection; they never become selected source units. */
export function contiguousSourceRangeSelection<T extends { id: string; memoryExcluded?: boolean; startOrdinal: number; endOrdinal: number; sourceOrdinals?: number[] }>(ranges: T[], ids: string[]): boolean {
  const selected = ranges.filter(range => ids.includes(range.id) && !range.memoryExcluded);
  const spans = selected.map(range => ({ start: Math.min(...(range.sourceOrdinals?.length ? range.sourceOrdinals : [range.startOrdinal])),
    end: Math.max(...(range.sourceOrdinals?.length ? range.sourceOrdinals : [range.endOrdinal])) })).sort((a,b) => a.start-b.start);
  let end = spans[0]?.end;
  for (const span of spans.slice(1)) {
    // Holes inside an existing batch are not implicit members. Only a gap
    // between selected envelopes can require another source range.
    if (end !== undefined && span.start > end + 1 && ranges.some(range => !range.memoryExcluded && !ids.includes(range.id)
      && (range.sourceOrdinals?.length ? range.sourceOrdinals.some(ordinal => ordinal > end! && ordinal < span.start)
        : range.endOrdinal > end! && range.startOrdinal < span.start))) return false;
    end = Math.max(end ?? span.end, span.end);
  }
  return true;
}
