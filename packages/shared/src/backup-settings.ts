import { MemoryBudgetPresetSchema } from "./memory-budget.js";
import { z } from "zod";

/** Chat preferences and its owning character switch; never unrelated settings. */
const CurrentChatBackupSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  characterEnabled: z.boolean().optional(),
  catchUpPending: z.boolean().optional(),
  profile: z.enum(["companion", "simulation"]).optional(),
  narrationViewpoint: z.string().trim().optional(),
  lineageSettingsFrom: z.string().min(1).optional(),
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

/** Released backups carry retired perspective fields; discard them on import. */
const LegacyChatBackupSettingsSchema = CurrentChatBackupSettingsSchema.extend({
  perspectives: z.array(z.string()).optional(),
  detectedPerspectives: z.array(z.string()).optional(),
}).transform(({ perspectives: _perspectives, detectedPerspectives: _detectedPerspectives, ...settings }) => settings);

export const ChatBackupSettingsSchema = z.union([CurrentChatBackupSettingsSchema, LegacyChatBackupSettingsSchema]);
export type ChatBackupSettings = z.infer<typeof ChatBackupSettingsSchema>;
