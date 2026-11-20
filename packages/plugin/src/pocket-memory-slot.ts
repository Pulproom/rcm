// PocketRisu routes a message with this memo to a preset's memory card.
// Use our own body so a real Hypa summary never becomes an RCM marker.
const memo = "supaMemory";
const legacyBody = "[[RCM_POCKET_MEMORY_SLOT]]";
const slotToken = /\[\[RCM_POCKET_MEMORY_SLOT(?::[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\]\]/;
const allSlotTokens = new RegExp(slotToken.source, "g");

function owned(row: any, chat: any): boolean {
  // PocketRisu reissues every chatId on copy/branch. The exact reserved
  // comment body survives that operation; ordinary story text is untouched.
  return row?.role === "char" && row.isComment === true && typeof row.data === "string" && slotToken.exec(row.data)?.[0] === row.data
    && (row.chatId === memo || row.rcmPocketSlot === true || chat.rcmPocketMemorySlot === true);
}

export function storyChat(chat: any): any {
  return Array.isArray(chat?.message) && chat.message.some((row: any) => owned(row, chat))
    ? { ...chat, rcmPocketMemorySlot: true, message: chat.message.filter((row: any) => !owned(row, chat)) }
    : chat;
}

export function updatePocketSlot(chat: any, install: boolean): any {
  if (!chat?.id || chat._placeholder || !Array.isArray(chat.message)) throw new Error("채팅을 다시 열어 주세요.");
  const story = storyChat(chat);
  if (!install) {
    if (!story.rcmPocketMemorySlot) return story;
    const { rcmPocketMemorySlot: _optIn, ...removed } = story;
    return removed;
  }
  if (story.message.some((row: any) => row?.chatId === memo)) throw new Error("다른 메시지가 장기기억 ID를 사용하고 있어요.");
  const message = [...story.message];
  // Keep the latest real turn last for continuation and reroll.
  const cutoff = message.findLastIndex((row: any) => row.disabled === "allBefore");
  const before = message.findLastIndex((row: any) => row.role === "user" && !row.isComment && !row.disabled);
  const index = Math.max(cutoff + 1, before >= 0 ? before : message.length - 1);
  const previous = chat.message.find((row: any) => owned(row, chat));
  const canReuse = previous?.rcmPocketSlotOwner === chat.id && previous.data !== legacyBody;
  if (canReuse && !previous.disabled && chat.message[index]?.chatId === memo && owned(chat.message[index], chat) && chat.message.length === message.length + 1 && chat.rcmPocketMemorySlot === true) return chat;
  const data = canReuse ? previous.data : `[[RCM_POCKET_MEMORY_SLOT:${crypto.randomUUID()}]]`;
  message.splice(index, 0, { chatId: memo, role: "char", isComment: true, rcmPocketSlot: true, rcmPocketSlotOwner: chat.id, data });
  return { ...chat, message, rcmPocketMemorySlot: true };
}

export function slotWriteConfirmed(chat: any, chatId: string, enabled: boolean): boolean {
  if (chat?.id !== chatId || chat._placeholder || !Array.isArray(chat.message)) return false;
  const slots = chat.message.filter((row: any) => owned(row, chat));
  return enabled ? slots.length === 1 && !slots[0].disabled && slots[0].chatId === memo && chat.rcmPocketMemorySlot === true : !slots.length && !chat.rcmPocketMemorySlot;
}

export function pocketSlotEnabled(chat: any): boolean {
  return chat?.rcmPocketMemorySlot === true || chat?.message?.some((row: any) => owned(row, chat)) === true;
}

// Keep one carrier in the recent window. Moving it on every output would send the
// whole chat through the plugin bridge on each turn. A missing request still forces repair.
export function hasRecentPocketSlot(chat: any): boolean {
  const rows = chat.message;
  if (!Array.isArray(rows)) return false;
  for (let i = rows.length - 1; i >= Math.max(0, rows.length - 8); i--) {
    const row = rows[i];
    if (row.disabled === "allBefore") return false;
    if (!row.disabled && row.chatId === memo && row.rcmPocketSlotOwner === chat.id && owned(row, chat)) return true;
  }
  return false;
}

// An output listener may already be moving the slot when the user turns it off.
const pendingWrites = new Map<string, Promise<void>>();
export async function withPocketSlotWrite<T>(chatId: string, write: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(chatId) ?? Promise.resolve();
  const operation = previous.then(write);
  const done = operation.then(() => {}, () => {});
  pendingWrites.set(chatId, done);
  try { return await operation; }
  finally { if (pendingWrites.get(chatId) === done) pendingWrites.delete(chatId); }
}

// Re-read the host's committed slot: an earlier output listener may have
// saved other fields since PocketRisu made its shared event snapshot.
export async function maintainPocketSlot(characterIndex: number, chatIndex: number, chatId: string, stillCurrent: () => boolean, installIfMissing = false): Promise<boolean> {
  return withPocketSlotWrite(chatId, async () => {
    if (!risuai.setChatToIndex || !stillCurrent()) return false;
    const chat = await risuai.getChatFromIndex(characterIndex, chatIndex);
    if (chat?.id !== chatId || chat._placeholder || (!installIfMissing && !pocketSlotEnabled(chat)) || !stillCurrent()) return false;
    const next = updatePocketSlot(chat, true);
    if (next === chat) return false;
    await risuai.setChatToIndex(characterIndex, chatIndex, next);
    const saved = await risuai.getChatFromIndex(characterIndex, chatIndex);
    if (!slotWriteConfirmed(saved, chatId, true)) throw new Error("장기기억 슬롯 복구 결과를 호스트에서 확인할 수 없어요. [RCM-SLOT-SAVE]");
    return true;
  });
}

function isHistoryFallback(row: OpenAIChat): boolean {
  // The carrier is a char turn. A system/user memory block can legitimately
  // use the same wrapper as ordinary history.
  return row.memo === memo && row.role === "assistant" && slotToken.test(row.content)
    && row.content.startsWith("<Previous Conversation>") && row.content.endsWith("</Previous Conversation>");
}

export function hasUnroutedPocketSlot(messages: OpenAIChat[]): boolean {
  return messages.some(isHistoryFallback);
}

// Only report transport metadata. A preset, chat, or another plugin may
// have changed either field before the request hook receives the messages.
export function missingPocketSlotReason(messages: OpenAIChat[]): string {
  const unmatched = messages.filter(row => slotToken.test(row.content) && row.memo !== memo);
  if (unmatched.length) {
    const roles = [...new Set(unmatched.map(row => row.role))].join(", ");
    return `슬롯 본문이 도착했지만 장기기억 블록 위치를 확인하지 못했어요. [RCM-SLOT-TEXT] 역할 ${roles}, 메시지 ${unmatched.length}개`;
  }
  if (messages.some(row => row.memo === memo)) {
    return "장기기억 메시지 ID는 요청에 남았지만 RCM 슬롯 본문이 없어요. [RCM-SLOT-ID]";
  }
  return "요청에 장기기억 메시지 ID와 RCM 슬롯 본문이 모두 없어요. [RCM-SLOT-ABSENT]";
}

// Recovery uses the private token and the saved chat. Authors' template
// text, the role chosen by the preset, and the message index are opaque.
export function requestPocketSlot(messages: OpenAIChat[], marker: string): OpenAIChat | undefined {
  let candidate: OpenAIChat | undefined;
  for (const row of messages) {
    if (row.content.includes(marker) || row.content.includes("<rp_memory_context>")) return;
    const match = slotToken.exec(row.content);
    if (!match) continue;
    if (candidate || isHistoryFallback(row) || slotToken.test(row.content.slice(match.index + match[0].length))) return;
    // Without a memory card, PocketRisu explicitly wraps this chat entry in
    // its history fallback. A later transformer can merge that entry.
    const before = row.content.slice(0, match.index);
    if (row.memo !== memo && before.lastIndexOf("<Previous Conversation>") > before.lastIndexOf("</Previous Conversation>")
      && row.content.indexOf("</Previous Conversation>", match.index) !== -1) return;
    candidate = row;
  }
  return candidate;
}

export function confirmPocketSlotSource(chat: any, row: OpenAIChat, requireChatOwner = false): boolean {
  if (!chat?.id || !slotWriteConfirmed(chat, chat.id, true)) return false;
  const saved = chat.message.find((item: any) => owned(item, chat));
  const token = slotToken.exec(row.content)?.[0];
  if (requireChatOwner && (saved.rcmPocketSlotOwner !== chat.id || token === legacyBody)) return false;
  if (!token || saved.data !== token || (saved.rcmPocketSlotOwner && saved.rcmPocketSlotOwner !== chat.id)) return false;
  return !chat.message.some((item: any) => !owned(item, chat)
    && (String(item.data ?? "").includes(token) || (token === legacyBody && row.memo && item.chatId === row.memo)));
}

// A disabled chat may still have a carrier from before a character-wide toggle.
export function stripDisabledPocketSlot(messages: OpenAIChat[], chat: any): OpenAIChat[] {
  if (!messages.some(row => slotToken.test(row.content))) return messages;
  const token = chat?.message?.find((row: any) => owned(row, chat))?.data;
  if (!token) return messages;
  return messages.flatMap(row => {
    if (!row.content.includes(token)) return [row];
    const content = row.content.replaceAll(token, "");
    return content.trim() ? [{ ...row, content }] : [];
  });
}

export function resolvePocketSlot(messages: OpenAIChat[], marker: string, candidate: OpenAIChat | null | undefined): OpenAIChat[] {
  if (!messages.some(row => slotToken.test(row.content))) return messages;
  return messages.flatMap(row => {
    if (!slotToken.test(row.content)) return [row];
    const content = row === candidate ? row.content.replace(slotToken, marker) : row.content.replace(allSlotTokens, "");
    if (row.memo === memo) {
      // Drop unused memory blocks; retain a manual marker merged into the same row.
      if (row !== candidate && !row.content.includes(marker)) return [];
      const { memo: _transportId, ...block } = row;
      return [{ ...block, content }];
    }
    // Other host messages can contain merged prompt text, including real story turns.
    return content.trim() ? [{ ...row, content }] : [];
  });
}
