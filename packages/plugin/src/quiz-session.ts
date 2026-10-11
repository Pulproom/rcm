import type { QuizAnswerResponse, QuizNextResponse } from "@rcm/shared";
import { ServerRequestError, isMissingServerRoute } from "./api-client.js";
import type { QuizView } from "./quiz-chip.js";

export interface QuizSessionDeps {
  client: { quizNext(chatId: string): Promise<QuizNextResponse>; quizAnswer(chatId: string, itemId: string, chosenIndex: number, attemptToken: string): Promise<QuizAnswerResponse> };
  chatId(): string | undefined;
  /** 퀴즈 사용 is on and the server has not been found to lack the quiz. */
  enabled(): boolean;
  setSupported(supported: boolean): void;
  log(message: string): void;
}


/**
 * The chip's quiz state. Every request remembers the chat and the session epoch it started in;
 * a reply that lands after a chat switch or a reset is dropped, so one chat never shows or answers another's question.
 */
export class QuizSession {
  next: QuizNextResponse | undefined;
  view: QuizView | undefined;
  /** Questions answered in this sitting, so the header can say 3/8. */
  answered = 0;
  /** The last refresh failed for a reason other than an old server; the chip offers 다시 시도 instead of the entry button. */
  loadFailed = false;
  private busy = false;
  private epoch = 0;
  private retry: (() => Promise<void>) | undefined;

  constructor(private readonly deps: QuizSessionDeps) {}

  /** A chat switch or a closed chip: forget everything and ignore replies still in flight. */
  reset(): void {
    this.epoch += 1;
    this.next = undefined;
    this.view = undefined;
    this.answered = 0;
    this.loadFailed = false;
    this.busy = false;
    this.retry = undefined;
  }

  /** Loads the next question. Returns false when the request failed (not when the quiz is simply off). */
  async refresh(): Promise<boolean> {
    const chatId = this.deps.chatId();
    if (!this.deps.enabled() || !chatId) { this.next = undefined; this.loadFailed = false; return true; }
    const epoch = this.epoch;
    try {
      const next = await this.deps.client.quizNext(chatId);
      if (epoch !== this.epoch || chatId !== this.deps.chatId()) return true;
      this.next = next;
      this.loadFailed = false;
      this.deps.setSupported(true);
      return true;
    } catch (error) {
      if (epoch !== this.epoch || chatId !== this.deps.chatId()) return true;
      this.next = undefined;
      if (error instanceof ServerRequestError && error.code === "CHAT_NOT_FOUND") { this.loadFailed = false; return true; }
      if (isMissingServerRoute(error)) { this.loadFailed = false; this.deps.setSupported(false); return true; }
      this.loadFailed = true;
      this.deps.log(`Quiz unavailable: ${String(error)}`);
      return false;
    }
  }

  /** Opens the quiz on the question already loaded for the entry button. */
  start(): void {
    this.answered = 0;
    this.showQuestion();
  }

  /** 다음 문제 / 결과 보기: fetch, then show the question or the done view; a failed fetch shows 다시 시도. */
  async advance(): Promise<void> {
    const epoch = this.epoch;
    const loaded = await this.refresh();
    if (epoch !== this.epoch) return;
    if (!loaded) {
      this.fail("다음 문제를 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.", () => this.advance());
      return;
    }
    this.showQuestion();
  }

  async answer(index: number): Promise<void> {
    const view = this.view;
    const chatId = this.deps.chatId();
    if (view?.mode !== "question" || this.busy || !chatId) return;
    const epoch = this.epoch;
    this.busy = true;
    try {
      const answer = await this.deps.client.quizAnswer(chatId, view.question.id, index, view.question.attemptToken);
      if (epoch !== this.epoch || chatId !== this.deps.chatId()) return;
      this.answered += 1;
      this.retry = undefined;
      this.view = { mode: "result", question: view.question, answer, index: view.index, total: view.total };
    } catch (error) {
      if (epoch !== this.epoch || chatId !== this.deps.chatId()) return;
      this.deps.log(`Quiz answer failed: ${String(error)}`);
      this.fail("답을 보내지 못했어요. 연결을 확인하고 다시 시도해 주세요.", async () => { this.view = view; await this.answer(index); });
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }

  async retryLast(): Promise<void> {
    const retry = this.retry;
    this.retry = undefined;
    await retry?.();
  }

  close(): void {
    this.epoch += 1;
    this.busy = false;
    this.view = undefined;
    this.retry = undefined;
  }

  private fail(message: string, retry: () => Promise<void>): void {
    this.retry = retry;
    this.view = { mode: "error", message };
  }

  private showQuestion(): void {
    const next = this.next;
    this.view = next?.question
      ? { mode: "question", question: next.question, stats: next.stats, index: this.answered + 1, total: this.answered + Math.max(next.remaining, 1) }
      : { mode: "done", stats: next?.stats ?? { streak: 0, bestStreak: 0, answered: 0, correct: 0 } };
  }
}
