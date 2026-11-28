import { z } from "zod";
import { ModelContentValidationError, structuredValidationDiagnostic } from "./structured-repair.js";

export const QUIZ_BATCH_SIZE = 15;
export const QUIZ_REFILL_BELOW = 5;
export const QUIZ_MIX = { easy: 5, medium: 5, hard: 5 } as const;

export type QuizFormat = "choice4" | "ox";
export type QuizDifficulty = "easy" | "medium" | "hard";
export interface QuizDraftItem { format: QuizFormat; difficulty: QuizDifficulty; question: string; options: string[]; answerIndex: number; explanation: string; quote?: string; memoryRef: string }
export interface QuizJobMeta { refs: Record<string, string>; sceneCount: number; fingerprints?: Record<string, string>; limits?: Record<string, number>; targetCount?: number }
export interface QuizRegenerateResponse { retired: number; enqueued: boolean; reason?: "generating" | "disabled" | "no_material" | "model_not_configured" }
export interface QuizStatus { unanswered: number; generating: boolean }
export interface QuizStats { streak: number; bestStreak: number; answered: number; correct: number }
export interface QuizQuestion { id: string; attemptToken: string; retry: boolean; format: QuizFormat; difficulty: QuizDifficulty; question: string; options: string[]; storyTime?: string }
export const QuizAnswerRequestSchema = z.object({ chosenIndex: z.number().int().min(0), attemptToken: z.string().min(1) });
export type QuizAnswerRequest = z.infer<typeof QuizAnswerRequestSchema>;
export interface QuizNextResponse { enabled: boolean; available: boolean; remaining: number; generating: boolean; question: QuizQuestion | null; stats: QuizStats; waitingReason?: "model_not_configured" | "conversation_too_short" | "material_exhausted" }
export interface QuizSceneRef { memoryId: string; title: string; sceneNumber?: number; storyTime?: string; location?: string }
export interface QuizAnswerResponse { correct: boolean; chosenIndex: number; answerIndex: number; explanation: string; quote?: string; scene: QuizSceneRef | null; stats: QuizStats; remaining: number }

export const QuizDraftSchema = z.object({
  format: z.enum(["choice4", "ox"]),
  difficulty: z.enum(["easy", "medium", "hard"]),
  question: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)),
  answerIndex: z.number().int(),
  explanation: z.string().trim().optional().default(""),
  quote: z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().trim().min(1).optional()),
  memoryRef: z.string().trim().min(1),
});

const hasKoreanQuizProse = (item: QuizDraftItem): boolean => /[가-힣]/.test(item.question) && /[가-힣]/.test(item.explanation);

/** Shape and owned output-language checks (spec "형태 검사"). A broken item is dropped alone; quotes are never checked against the source. */
export function acceptQuizItems(raw: unknown, allowedRefs: ReadonlySet<string>): { items: QuizDraftItem[]; dropped: number } {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : null;
  if (!list) return { items: [], dropped: 0 };
  const items: QuizDraftItem[] = [];
  for (const entry of list) {
    const parsed = QuizDraftSchema.safeParse(entry);
    if (!parsed.success) continue;
    const item = parsed.data;
    if (!hasKoreanQuizProse(item)) continue;
    if (item.format === "ox" && (item.options.length !== 2 || new Set(item.options.map(option => option.toLowerCase())).size !== 2)) continue;
    const options = item.format === "ox" ? ["O", "X"] : item.options;
    if (item.format === "choice4" && options.length !== 4) continue;
    if (item.format === "ox" && item.answerIndex > 1) continue;
    if (item.answerIndex < 0 || item.answerIndex >= options.length) continue;
    if (new Set(options.map((option) => option.trim().toLowerCase())).size !== options.length) continue;
    if (!allowedRefs.has(item.memoryRef)) continue;
    items.push({ format: item.format, difficulty: item.difficulty, question: item.question, options, answerIndex: item.answerIndex, explanation: item.explanation, ...(item.quote ? { quote: item.quote } : {}), memoryRef: item.memoryRef });
  }
  return { items, dropped: list.length - items.length };
}

/** Preserve partial acceptance and intentional empty batches; repair only a batch the server would fail. */
export function validateQuizResult<T>(raw: T, allowedRefs: ReadonlySet<string>): T {
  if (raw && typeof raw === "object" && "items" in raw && Array.isArray(raw.items) && !raw.items.length) return raw;
  if (acceptQuizItems(raw, allowedRefs).items.length) return raw;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && "items" in raw && Array.isArray(raw.items) ? raw.items : [];
  const details = list.slice(0, 3).map((entry, index) => {
    const parsed = QuizDraftSchema.safeParse(entry, { reportInput: true });
    if (!parsed.success) return `items.${index}: ${structuredValidationDiagnostic(parsed.error)}`;
    const item = parsed.data;
    if (!hasKoreanQuizProse(item)) return `items.${index}: question and explanation must be written in Korean`;
    if (!allowedRefs.has(item.memoryRef)) return `items.${index}.memoryRef ${JSON.stringify(item.memoryRef)} was not supplied`;
    return `items.${index}: format=${JSON.stringify(item.format)} options=${JSON.stringify(item.options)} answerIndex=${item.answerIndex} has invalid option count, duplicate options or answer index`;
  });
  throw new ModelContentValidationError(`QUIZ_EMPTY: no valid quiz items; ${details.join("; ") || "items must contain valid questions or explicitly be []"}`);
}

/** UI-owned story date format, shared with the generation prompt. */
export function quizDateLabel(storyTime: string | undefined): string {
  if (!storyTime) return "";
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(storyTime);
  return match ? `${match[1]}.${match[2]}` : storyTime;
}
