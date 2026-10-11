/** Distribution builds exclude diagnostic storage and formatting. */
export const RETRIEVAL_TRACE_CHAT_PREFIX = "";
export class RetrievalTraceWriter {
  readonly enabled = false;
  readonly dashboardAvailable = false;
  constructor(..._args: unknown[]) {}
  isChatEnabled(_chatId: string): boolean { return false; }
  setChatEnabled(_chatId: string, _enabled: boolean): void {}
  record(_event: unknown): Promise<void> { return Promise.resolve(); }
}
