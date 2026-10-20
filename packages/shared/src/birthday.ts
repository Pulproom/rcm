import { z } from "zod";

/** Month/day recur independently of the birth year; February 29 is always valid. */
export const birthdayMonthDays = (month: number): number =>
  [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;

export const EntityBirthdaySchema = z.object({
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.number().int().optional(),
}).refine(value => value.day <= birthdayMonthDays(value.month), {
  path: ["day"], message: "선택한 월에 없는 날짜예요.",
});
export type EntityBirthday = z.infer<typeof EntityBirthdaySchema>;
