import type { LandmarkKind } from "./index.js";

export const ANNIVERSARY_KINDS = ["first_met", "confession", "romantic_relationship_established", "engagement", "marriage", "anniversary_basis"] as const;

export const DEFAULT_ALWAYS_INJECT_KINDS: ReadonlySet<LandmarkKind["kind"]> = new Set([
  "first_met",
  "romantic_relationship_established",
  "engagement",
  "marriage",
  "separation",
  "romantic_relationship_ended",
  "reunion",
  "divorce",
]);

export function landmarkAlwaysInjected(landmark: LandmarkKind): boolean {
  return landmark.alwaysInject ?? DEFAULT_ALWAYS_INJECT_KINDS.has(landmark.kind);
}
