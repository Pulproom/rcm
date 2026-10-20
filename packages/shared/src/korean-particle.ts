type ParticlePair = "이/가" | "은/는" | "을/를" | "과/와" | "으로/로";

/** Choose from the final Hangul syllable only; foreign names remain explicit. */
export function withKoreanParticle(name: string, pair: ParticlePair): string {
  const value = name.trimEnd(), code = value.charCodeAt(value.length - 1);
  const [closed, open] = pair.split("/");
  if (code < 0xac00 || code > 0xd7a3 || !Number.isFinite(code)) return `${value}${closed}(${open})`;
  const batchim = (code - 0xac00) % 28;
  return `${value}${batchim === 0 || pair === "으로/로" && batchim === 8 ? open : closed}`;
}
