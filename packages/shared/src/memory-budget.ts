import { z } from "zod";

export const MAX_MEMORY_BUDGET = 1_000_000; // Technical input guard, not a product preset.
export const MemoryBudgetPresetSchema = z.number().int().positive().max(MAX_MEMORY_BUDGET);
export type MemoryBudgetPreset = z.infer<typeof MemoryBudgetPresetSchema>;
