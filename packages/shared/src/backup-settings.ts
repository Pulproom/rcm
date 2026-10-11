import { z } from "zod";

/** Only chat-owned preferences may travel in a single-chat archive. */
export const ChatBackupSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  catchUpPending: z.boolean().optional(),
  profile: z.enum(["companion", "simulation"]).optional(),
  perspectives: z.array(z.string()).optional(),
  detectedPerspectives: z.array(z.string()).optional(),
  includeUserMessages: z.boolean().optional(),
  memoryOnlyInjection: z.boolean().optional(),
  extractionGroupTurns: z.number().int().positive().optional(),
  memoryLanguage: z.enum(["en", "ko", "ja", "zh"]).optional(),
  backfillApproved: z.boolean().optional(),
  memoryBudget: z.union([z.literal(4000), z.literal(6000), z.literal(8000), z.literal(12000)]).optional(),
  storyOverviewBackup: z.object({summary:z.string(),groupId:z.string(),startOrdinal:z.number(),endOrdinal:z.number(),savedAt:z.number()}).optional(),
}).strict();
export type ChatBackupSettings = z.infer<typeof ChatBackupSettingsSchema>;
