import { MemoryBudgetPresetSchema } from "./memory-budget.js";
import { z } from "zod";

/** Chat preferences and its owning character switch; never unrelated settings. */
export const ChatBackupSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  characterEnabled: z.boolean().optional(),
  catchUpPending: z.boolean().optional(),
  profile: z.enum(["companion", "simulation"]).optional(),
  perspectives: z.array(z.string()).optional(),
  detectedPerspectives: z.array(z.string()).optional(),
  includeUserMessages: z.boolean().optional(),
  upcomingOccasions: z.boolean().optional(),
  pairProgress: z.boolean().optional(),
  memoryOnlyInjection: z.boolean().optional(),
  extractionGroupTurns: z.number().int().positive().optional(),
  memoryLanguage: z.enum(["en", "ko", "ja", "zh"]).optional(),
  backfillApproved: z.boolean().optional(),
  memoryBudget: MemoryBudgetPresetSchema.optional(),
  storyOverviewBackup: z.object({summary:z.string(),groupId:z.string(),startOrdinal:z.number(),endOrdinal:z.number(),savedAt:z.number()}).optional(),
}).strict();
export type ChatBackupSettings = z.infer<typeof ChatBackupSettingsSchema>;
