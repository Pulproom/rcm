export interface SimilaritySignature {
  all: Set<string>;
  body: Set<string>;
}

export function signatureSimilarity(leftTokens: SimilaritySignature, rightTokens: SimilaritySignature): number {
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 || b.size === 0) return 0;
    let shared = 0;
    const smaller = a.size <= b.size ? a : b;
    const larger = a.size <= b.size ? b : a;
    for (const token of smaller) if (larger.has(token)) shared += 1;
    return shared / (a.size + b.size - shared);
  };
  return Math.max(jaccard(leftTokens.all, rightTokens.all), jaccard(leftTokens.body, rightTokens.body));
}
