export interface SimilaritySignature {
  all: Set<string>;
  body: Set<string>;
}

export function signatureSimilarity(leftTokens: SimilaritySignature, rightTokens: SimilaritySignature): number {
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    for (const token of a) if (b.has(token)) shared += 1;
    return shared / (a.size + b.size - shared);
  };
  return Math.max(jaccard(leftTokens.all, rightTokens.all), jaccard(leftTokens.body, rightTokens.body));
}
