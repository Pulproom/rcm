import { joinSplitEmphasisQuote } from '@rcm/shared';
import type { ServerClient } from '../api-client.js';

export type MemoryEvidence = { messageId?: string; quote?: string; startOffset?: number; endOffset?: number };
export type EvidenceState = { status: 'loading' | 'ready' | 'error'; items?: MemoryEvidence[]; error?: string };

/** Compact provenance is for dates/IDs; only the fold consumes loaded quote payloads. */
export function memoryEvidence(memory: any): MemoryEvidence[] {
  if (memory.evidenceSummary) return memory.dashboardEvidence?.items ?? [];
  try { const value = JSON.parse(memory.evidence_json ?? '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

/** Dashboard-lifetime cache; a connection/chat or memory version change drops its payload. */
export function createMemoryEvidenceLoader(client: Pick<ServerClient, 'request'>, changed: () => void) {
  let scope = '';
  const cache = new Map<string, { version: string; state: EvidenceState; pending?: Promise<void> }>();
  const entryFor = (memory: any, nextScope: string) => {
    if (scope !== nextScope) { scope = nextScope; cache.clear(); }
    const version = JSON.stringify([memory.updated_at, memory.created_revision]);
    let entry = cache.get(memory.id);
    if (entry?.version !== version) { cache.delete(memory.id); entry = undefined; }
    return entry;
  };
  return {
    read(memory: any, nextScope: string): EvidenceState | undefined { return entryFor(memory, nextScope)?.state; },
    load(memory: any, nextScope: string, chatId: string, retry = false): Promise<void> {
      const existing = entryFor(memory, nextScope);
      if (existing && !(retry && existing.state.status === 'error')) return existing.pending ?? Promise.resolve();
      const entry = { version: JSON.stringify([memory.updated_at, memory.created_revision]), state: { status: 'loading' } as EvidenceState, pending: undefined as Promise<void> | undefined };
      cache.set(memory.id, entry);
      const current = () => scope === nextScope && cache.get(memory.id) === entry;
      entry.pending = (async () => {
        // Defer the request until the loading state and promise are installed.
        await Promise.resolve();
        try {
          const result = await client.request<{ items: MemoryEvidence[]; updatedAt: number }>(`/v1/chats/${encodeURIComponent(chatId)}/memories/${encodeURIComponent(memory.id)}/evidence`);
          if (result.updatedAt !== memory.updated_at) throw new Error('기억이 바뀌었어요. 새로고침한 뒤 다시 열어 주세요.');
          entry.state = { status: 'ready', items: result.items };
        } catch (error) {
          entry.state = { status: 'error', error: error instanceof Error ? error.message : String(error) };
        }
        if (current()) changed();
      })();
      changed();
      return entry.pending;
    },
  };
}

export type EvidencePart = { text: string; index: number; start?: number; end?: number; joinBefore: string };
export type EvidenceGroup = { messageId?: string; count: number; parts: EvidencePart[] };

/** Display exact source order and whitespace, with the MCP excerpt convention […] for gaps.
 * MCP's renderer is server-specific; this view retains each original translation index. */
export function groupMemoryEvidence(evidence: MemoryEvidence[], messages: Map<string, any>): EvidenceGroup[] {
  const groups = new Map<string | undefined, { group: EvidenceGroup; items: Array<MemoryEvidence & { index: number }> }>();
  evidence.forEach((item, index) => {
    const entry = groups.get(item.messageId) ?? { group: { messageId: item.messageId, count: 0, parts: [] }, items: [] };
    entry.group.count++; entry.items.push({ ...item, index }); groups.set(item.messageId, entry);
  });
  const entries = [...groups.values()];
  entries.sort((a, b) => (messages.get(a.group.messageId ?? '')?.ordinal ?? Infinity) - (messages.get(b.group.messageId ?? '')?.ordinal ?? Infinity));
  return entries.map(({ group, items }) => {
    const source = messages.get(group.messageId ?? '');
    const text: string = source?.canonical_content ?? source?.content ?? '';
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!, next = items[i + 1];
      const joined = text && item.quote && next?.quote && next.index === item.index + 1 ? joinSplitEmphasisQuote(text, item.quote, next.quote) : undefined;
      const quote = joined ?? item.quote ?? (text || '원문 근거를 표시할 수 없어요.');
      if (joined) i++;
      const exact = item.startOffset !== undefined && text.slice(item.startOffset, item.startOffset + quote.length) === quote
        ? item.startOffset : text.indexOf(quote);
      const start = exact >= 0 && (item.startOffset === exact || text.indexOf(quote, exact + 1) < 0) ? exact : undefined;
      group.parts.push({ text: quote, index: item.index, start, end: start === undefined ? undefined : start + quote.length, joinBefore: '' });
    }
    if (group.parts.every(part => part.start !== undefined)) group.parts.sort((a, b) => a.start! - b.start!);
    group.parts.forEach((part, index) => {
      if (!index) return;
      const previous = group.parts[index - 1]!;
      const gap = previous.end !== undefined && part.start !== undefined && part.start >= previous.end ? text.slice(previous.end, part.start) : undefined;
      part.joinBefore = gap !== undefined && /^\s*$/u.test(gap) ? gap : '\n\n[…]\n\n';
    });
    return group;
  });
}
