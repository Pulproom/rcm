import { z } from "zod";

export const PAIR_PROGRESS_DEFAULTS = [
  { id: "contact_exchange", label: "연락처 교환", mode: "mutual" },
  { id: "knows_residence", label: "사는 곳 알기", mode: "each" },
  { id: "visited_home", label: "집에 가 보기", mode: "each" },
  { id: "met_family_friends", label: "가족·친구 만나기", mode: "each" },
] as const;
export const PairProgressModeSchema = z.enum(["each", "mutual"]);
export const PairProgressCellSchema = z.object({
  side: z.string().min(1),
  state: z.enum(["done", "not_yet", "unknown"]),
  source: z.enum(["scene", "setup", "user"]),
  memoryId: z.string().optional(),
  messageIds: z.array(z.string()).default([]),
  // Inclusive source-order boundary of the last user not_yet correction.
  // Retained on scene completion so invalidation can restore that correction.
  userNotYetAfterOrdinal: z.number().int().min(-1).optional(),
  // Version 1 uses extracted memory evidence instead of the latest synced message.
  userNotYetBoundaryVersion: z.literal(1).optional(),
  // Missing only on older scene checks; their prior state cannot be inferred.
  stateBeforeScene: z.enum(["not_yet", "unknown"]).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type PairProgressCell = z.infer<typeof PairProgressCellSchema>;
export interface PairProgressItem {
  id: string;
  label: string;
  mode: "each" | "mutual";
  hidden: boolean;
  custom: boolean;
  cells: PairProgressCell[];
}
export interface PairProgress {
  persona: string;
  character: string;
  items: PairProgressItem[];
}
export type PairProgressUnavailableReason = "persona_missing" | "persona_ambiguous" | "not_primary_character";
export interface PairProgressResponse {
  items: PairProgress[];
  /** Explanation for a relationship that is absent from items. */
  unavailableReason: PairProgressUnavailableReason;
}
export const PairProgressPatchSchema = z.object({
  persona: z.string().min(1),
  character: z.string().min(1),
  itemId: z.string().min(1),
  side: z.string().min(1),
  memoryKey: z.string().min(1),
});
export type PairProgressPatch = z.infer<typeof PairProgressPatchSchema>;
// Optional advisory output must never trigger a repair or discard valid memories.
export const PairProgressPatchesSchema = z.array(z.unknown()).transform(items => items.flatMap(item => {
  const parsed = PairProgressPatchSchema.safeParse(item);
  return parsed.success ? [parsed.data] : [];
})).optional().catch(undefined);
export const SetupPairProgressSchema = z.array(z.object({
  personaKey: z.string().min(1),
  characterKey: z.string().min(1),
  itemId: z.string().min(1),
  side: z.string().min(1),
  evidence: z.object({ sourceIndex: z.number().int().nonnegative(), quote: z.string().min(1) }),
}).optional().catch(undefined)).transform(items => items.filter((item): item is NonNullable<typeof item> => !!item)).optional().catch(undefined);
