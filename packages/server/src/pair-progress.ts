import { randomUUID } from "node:crypto";
import { estimateTokens, PAIR_PROGRESS_DEFAULTS, PairProgressPatchSchema,
  type PairProgress, type PairProgressItem, type PairProgressCell, type PairProgressResponse, type ExtractionDraftResult } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { listEntities, normalizeEntityName } from "./entities.js";
import { readPersonaName } from "./view-preferences.js";

type Pair = Pick<PairProgress, "persona" | "character">;
type Row = {
  id: string; persona: string; character: string; item_id: string; label: string;
  mode: "each" | "mutual"; hidden: number; custom: number; cells_json: string; created_at: number;
};

function lastExtractedProgressOrdinal(db: RcmDatabase, chatId: string): number {
  return (db.prepare(`SELECT COALESCE(MAX(msg.ordinal),-1) ordinal
    FROM memories m JOIN json_each(m.evidence_json) ev
    JOIN messages msg ON msg.chat_id=m.chat_id AND msg.message_id=json_extract(ev.value,'$.messageId')
    WHERE m.chat_id=? AND m.active=1`).get(chatId) as { ordinal: number }).ordinal;
}

/** Repair pre-extraction-boundary cells once, including corrections retained on scene completion. */
export function readProgressCells(db: RcmDatabase, chatId: string, row: Pick<Row, "id" | "cells_json">): PairProgressCell[] {
  const cells = JSON.parse(row.cells_json) as PairProgressCell[];
  const legacy = cells.filter(cell => cell.userNotYetBoundaryVersion !== 1
    && (cell.userNotYetAfterOrdinal !== undefined || cell.source === "user" && cell.state === "not_yet"));
  if (legacy.length) {
    const boundary = lastExtractedProgressOrdinal(db, chatId);
    for (const cell of legacy) {
      cell.userNotYetAfterOrdinal = Math.min(cell.userNotYetAfterOrdinal ?? boundary, boundary);
      cell.userNotYetBoundaryVersion = 1;
    }
    db.prepare("UPDATE pair_progress SET cells_json=? WHERE id=?").run(JSON.stringify(cells), row.id);
  }
  return cells;
}

function isPendingProgress(cell: PairProgressCell): boolean {
  return cell.state === "not_yet" || cell.state === "unknown" && cell.source !== "user";
}

function progressEvidenceDropReason(db: RcmDatabase, chatId: string, cell: PairProgressCell,
  source: "scene" | "setup", messageIds: string[]): string | undefined {
  if (cell.userNotYetAfterOrdinal === undefined) return cell.source === "user" ? "cell_done_or_locked" : undefined;
  if (source !== "scene") return "user_boundary_requires_scene";
  if (!messageIds.length) return "empty_evidence";
  const message = db.prepare("SELECT ordinal FROM messages WHERE chat_id=? AND message_id=? AND lifecycle IN ('committed','pending','client_pruned')");
  for (const id of messageIds) {
    const row = message.get(chatId, id) as { ordinal: number } | undefined;
    if (!row) return "evidence_unavailable";
    if (row.ordinal <= cell.userNotYetAfterOrdinal) return "user_boundary";
  }
}

export function resetAutomaticProgressCell(cell: PairProgressCell): PairProgressCell {
  if (cell.state !== "done") return cell;
  return { ...cell, state: cell.userNotYetAfterOrdinal !== undefined ? "not_yet"
      : cell.source === "scene" ? cell.stateBeforeScene ?? "unknown" : "unknown",
    source: cell.userNotYetAfterOrdinal === undefined ? cell.source : "user",
    stateBeforeScene: undefined, memoryId: undefined, messageIds: [], updatedAt: Date.now() };
}

function resolveProgressPairs(db: RcmDatabase, chatId: string, hint?: string): { pairs: Pair[]; unavailableReason: PairProgressResponse["unavailableReason"] } {
  const entities = listEntities(db, chatId);
  const name = readPersonaName(db, chatId, hint);
  if (!name) return { pairs: [], unavailableReason: "persona_missing" };
  const matches = entities.filter(entity => [entity.id, entity.key, entity.name, entity.displayName, ...entity.aliases]
    .some(value => normalizeEntityName(value) === normalizeEntityName(name)));
  if (matches.length !== 1) return { pairs: [], unavailableReason: matches.length ? "persona_ambiguous" : "persona_missing" };
  const pairs = entities.filter(entity => entity.id !== matches[0]!.id && entity.setupProminence === "primary"
    && ["character", "person"].includes(entity.type)).map(entity => ({ persona: matches[0]!.name, character: entity.name }));
  return { pairs, unavailableReason: "not_primary_character" };
}

export function progressPairs(db: RcmDatabase, chatId: string, hint?: string): Pair[] {
  return resolveProgressPairs(db, chatId, hint).pairs;
}

export function includesProgressPair(participants: string[], pair: Pair): boolean {
  const names = new Set(participants.map(normalizeEntityName));
  return names.has(normalizeEntityName(pair.persona)) && names.has(normalizeEntityName(pair.character));
}

function hasPairHistory(db: RcmDatabase, chatId: string, pair: Pair): boolean {
  const rows = db.prepare("SELECT participants_json FROM memories WHERE chat_id=? AND active=1").all(chatId) as Array<{ participants_json: string }>;
  return rows.some(row => includesProgressPair(JSON.parse(row.participants_json), pair));
}

function emptyCells(pair: Pair, mode: "each" | "mutual", state: "unknown" | "not_yet"): PairProgressCell[] {
  return (mode === "mutual" ? ["mutual"] : [pair.persona, pair.character]).map(side => ({
    side, state, source: "setup", messageIds: [], createdAt: 0, updatedAt: 0,
  }));
}

export function listPairProgress(db: RcmDatabase, chatId: string, hint?: string): PairProgress[] {
  return pairProgressResponse(db, chatId, hint).items;
}

export function pairProgressResponse(db: RcmDatabase, chatId: string, hint?: string): PairProgressResponse {
  const { pairs, unavailableReason } = resolveProgressPairs(db, chatId, hint);
  const rows = db.prepare("SELECT * FROM pair_progress WHERE chat_id=? ORDER BY created_at,id").all(chatId) as Row[];
  const items = pairs.map(pair => {
    const stored = rows.filter(row => row.persona === pair.persona && row.character === pair.character);
    const needsStartingState = PAIR_PROGRESS_DEFAULTS.some(item => !stored.some(row => row.item_id === item.id))
      || stored.some(row => (JSON.parse(row.cells_json) as PairProgressCell[])
        .some(cell => cell.state === "not_yet" && cell.source !== "user" && !cell.createdAt));
    const history = needsStartingState && hasPairHistory(db, chatId, pair);
    const items: PairProgressItem[] = PAIR_PROGRESS_DEFAULTS.map(item => ({
      ...item, hidden: false, custom: false, cells: emptyCells(pair, item.mode, history ? "unknown" : "not_yet"),
    }));
    for (const row of stored) {
      const cells = readProgressCells(db, chatId, row);
      // Unreleased DB57 stored untouched default cells with timestamp zero.
      // They are not a completed historical assessment or a user's correction.
      for (const cell of cells) if (history && cell.state === "not_yet" && cell.source !== "user" && !cell.createdAt) cell.state = "unknown";
      const item: PairProgressItem = { id: row.item_id, label: row.label, mode: row.mode,
        hidden: !!row.hidden, custom: !!row.custom, cells };
      const index = items.findIndex(candidate => candidate.id === item.id);
      if (index < 0) items.push(item);
      else items[index] = item;
    }
    return { ...pair, items };
  });
  return { items, unavailableReason };
}

function saveProgressItem(db: RcmDatabase, chatId: string, pair: Pair, item: PairProgressItem): void {
  const time = Date.now();
  for (const cell of item.cells) if (!cell.createdAt) Object.assign(cell, { createdAt: time, updatedAt: time });
  db.prepare(`INSERT INTO pair_progress(id,chat_id,persona,character,item_id,label,mode,hidden,custom,cells_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chat_id,persona,character,item_id) DO UPDATE SET
    label=excluded.label,hidden=excluded.hidden,cells_json=excluded.cells_json,updated_at=excluded.updated_at`)
    .run(randomUUID(), chatId, pair.persona, pair.character, item.id, item.label, item.mode,
      Number(item.hidden), Number(item.custom), JSON.stringify(item.cells), time, time);
}

/** Freeze the starting state before a new scene is inserted; old chats remain unknown. */
export function ensurePairProgress(db: RcmDatabase, chatId: string): PairProgress[] {
  const pairs = listPairProgress(db, chatId);
  for (const pair of pairs) {
    for (const item of pair.items) if (item.cells.some(cell => !cell.createdAt)) saveProgressItem(db, chatId, pair, item);
  }
  return pairs;
}

type ProgressEdit = { kind: "cell"; itemId: string; side: string; state: "done" | "not_yet" }
  | { kind: "add"; label: string; mode: "each" | "mutual" }
  | { kind: "remaining_not_yet" }
  | { kind: "remove" | "hide" | "restore"; itemId: string };

export function editPairProgress(db: RcmDatabase, chatId: string, persona: string, character: string, action: ProgressEdit): PairProgress {
  const pair = listPairProgress(db, chatId).find(candidate => candidate.persona === persona && candidate.character === character);
  if (!pair) throw new Error("Only the persona and a primary character can have progress.");
  const boundary = lastExtractedProgressOrdinal(db, chatId);
  const setUserCell = (cell: PairProgressCell, state: "done" | "not_yet") =>
    Object.assign(cell, { state, source: "user" as const, memoryId: undefined, messageIds: [],
      userNotYetAfterOrdinal: state === "not_yet" ? boundary : undefined,
      userNotYetBoundaryVersion: state === "not_yet" ? 1 : undefined,
      stateBeforeScene: undefined, updatedAt: Date.now() });
  if (action.kind === "remaining_not_yet") {
    for (const item of pair.items) {
      const unknown = item.cells.filter(cell => cell.state === "unknown" && cell.source !== "user");
      if (!unknown.length) continue;
      for (const cell of unknown) setUserCell(cell, "not_yet");
      saveProgressItem(db, chatId, pair, item);
    }
  } else if (action.kind === "add") {
    const label = action.label.trim();
    if (!label || label.length > 120) throw new Error("Progress label must contain 1–120 characters.");
    saveProgressItem(db, chatId, pair, { id: randomUUID(), label, mode: action.mode, hidden: false, custom: true,
      cells: emptyCells(pair, action.mode, hasPairHistory(db, chatId, pair) ? "unknown" : "not_yet") });
  } else {
    const item = pair.items.find(candidate => candidate.id === action.itemId);
    if (!item) throw new Error("Progress item not found.");
    if (action.kind === "cell") {
      const cell = item.cells.find(candidate => candidate.side === action.side);
      if (!cell) throw new Error("Progress side does not belong to this item.");
      setUserCell(cell, action.state);
      saveProgressItem(db, chatId, pair, item);
    } else if (action.kind === "remove") {
      if (!item.custom) throw new Error("Default progress items can only be hidden.");
      db.prepare("DELETE FROM pair_progress WHERE chat_id=? AND persona=? AND character=? AND item_id=?")
        .run(chatId, persona, character, item.id);
    } else {
      if (item.custom) throw new Error("Only default progress items can be hidden or restored.");
      item.hidden = action.kind === "hide";
      saveProgressItem(db, chatId, pair, item);
    }
  }
  return listPairProgress(db, chatId).find(candidate => candidate.persona === persona && candidate.character === character)!;
}

export function pendingProgress(db: RcmDatabase, chatId: string, draft?: Pick<ExtractionDraftResult, "memories">) {
  return prepareProgress(db, chatId, draft).cells;
}

export type ProgressDrop = { itemId: string; side: string; reason: string };

export function prepareProgress(db: RcmDatabase, chatId: string, draft?: Pick<ExtractionDraftResult, "memories">) {
  // Only typed scene participation selects pairs; no prose meaning or keyword rules.
  const pairs = listPairProgress(db, chatId);
  const matched = pairs.filter(pair => !draft || draft.memories.some(memory => includesProgressPair(memory.participants, pair)));
  const cells = matched
    .flatMap(pair => pair.items.filter(item => !item.hidden).flatMap(item => item.cells
      .filter(isPendingProgress)
      .map(cell => ({ persona: pair.persona, character: pair.character, itemId: item.id, label: item.label, mode: item.mode, side: cell.side }))));
  return { cells, progressSent: { count: cells.length, cells: cells.map(({itemId, side}) => ({itemId, side})),
    ...(!cells.length ? { reason: !pairs.length ? "no_pair" : !matched.length ? "no_pair_matched_participants" : "all_cells_done_locked_or_hidden" } : {}) } };
}

export function validateProgressPatches(db: RcmDatabase, chatId: string, draft: ExtractionDraftResult, patches: unknown[], sourceIds: string[], drops: ProgressDrop[] = []) {
  const pairs = listPairProgress(db, chatId);
  return patches.flatMap(raw => {
    const parsed = PairProgressPatchSchema.safeParse(raw);
    const drop = (reason: string) => {
      const identity = raw as { itemId?: unknown; side?: unknown } | null;
      drops.push({ itemId: typeof identity?.itemId === "string" ? identity.itemId : "", side: typeof identity?.side === "string" ? identity.side : "", reason });
      return [];
    };
    if (!parsed.success) return drop("invalid_patch");
    const patch = parsed.data;
    const pair = pairs.find(pair => pair.persona === patch.persona && pair.character === patch.character);
    const cell = pair?.items.find(item => item.id === patch.itemId && !item.hidden)?.cells.find(cell => cell.side === patch.side);
    if (!pair) return drop("pair_not_found");
    if (!cell) return drop("cell_missing_or_hidden");
    if (!isPendingProgress(cell)) return drop("cell_done_or_locked");
    const memory = draft.memories.find(candidate => candidate.key === patch.memoryKey);
    if (!memory) return drop("memory_key_not_found");
    if (!memory.evidence.length) return drop("empty_evidence");
    if (memory.evidence.some(evidence => !sourceIds.includes(evidence.messageId))) return drop("evidence_outside_source");
    if (!includesProgressPair(memory.participants, patch)) return drop("participants_mismatch");
    const evidenceDrop = progressEvidenceDropReason(db, chatId, cell, "scene", memory.evidence.map(evidence => evidence.messageId));
    if (evidenceDrop) return drop(evidenceDrop);
    return [patch];
  });
}

export function applyProgressDone(db: RcmDatabase, chatId: string, patch: Pair & { itemId: string; side: string },
  source: "scene" | "setup", memoryId?: string, messageIds: string[] = []): boolean {
  const pair = listPairProgress(db, chatId).find(candidate => candidate.persona === patch.persona && candidate.character === patch.character);
  const item = pair?.items.find(candidate => candidate.id === patch.itemId && !candidate.hidden);
  const cell = item?.cells.find(candidate => candidate.side === patch.side && isPendingProgress(candidate));
  if (!pair || !item || !cell || progressEvidenceDropReason(db, chatId, cell, source, messageIds)) return false;
  Object.assign(cell, { stateBeforeScene: source === "scene" ? cell.state : undefined,
    state: "done", source, memoryId, messageIds, updatedAt: Date.now() });
  saveProgressItem(db, chatId, pair, item);
  return true;
}

export function resetProgress(db: RcmDatabase, chatId: string, source: "scene" | "setup", messageId?: string): void {
  for (const row of db.prepare("SELECT * FROM pair_progress WHERE chat_id=?").all(chatId) as Row[]) {
    const cells = readProgressCells(db, chatId, row);
    let changed = false;
    for (const cell of cells) if (cell.source === source && (!messageId || cell.messageIds.includes(messageId))) {
      // Another surviving historical scene may establish the same milestone.
      Object.assign(cell, resetAutomaticProgressCell(cell));
      changed = true;
    }
    if (changed) db.prepare("UPDATE pair_progress SET cells_json=?,updated_at=? WHERE id=?").run(JSON.stringify(cells), Date.now(), row.id);
  }
}

const xml = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("\n", " ").replaceAll("\r", " ");

function itemPhrases(pair: PairProgress, item: PairProgressItem): string[] {
  const cells = item.cells.filter(cell => cell.state === "not_yet");
  if (!cells.length) return [];
  // A user's own label is quoted verbatim so it never reads as part of the product sentence.
  const label = `"${xml(item.label)}"`;
  if (item.mode === "mutual") return [item.custom ? `${label} — not yet (mutual)` : "no contacts exchanged"];
  // These are fixed product templates for typed owner cells, never prose interpretation.
  if (cells.length === 2) {
    if (item.custom) return [`${label} — not yet for either`];
    if (item.id === "knows_residence") return ["neither knows where the other lives"];
    if (item.id === "visited_home") return ["neither has been inside the other's home"];
    return ["neither has met the other's family or friends"];
  }
  return cells.map(cell => {
    const owner = xml(cell.side), other = xml(cell.side === pair.persona ? pair.character : pair.persona);
    if (item.custom) return `${label} — not yet, ${other} → ${owner}`;
    if (item.id === "knows_residence") return `${other} doesn't know where ${owner} lives`;
    if (item.id === "visited_home") return `${other} hasn't been inside ${owner}'s home`;
    return `${other} hasn't met ${owner}'s family or friends`;
  });
}

export function renderPairProgress(pairs: PairProgress[], activeNames: string[] = [], budget = 120): string {
  const active = new Set(activeNames.map(normalizeEntityName));
  const lines: string[] = [];
  const wrap = (parts: string[]) => `<not_yet>No record yet. Play these as firsts unless the user establishes otherwise: ${parts.join(". ")}.</not_yet>`;
  const ordered = [...pairs].sort((a, b) => Number(active.has(normalizeEntityName(b.character))) - Number(active.has(normalizeEntityName(a.character))));
  for (const pair of ordered) {
    const prefix = `${xml(pair.persona)} &amp; ${xml(pair.character)} — `;
    const phrases: string[] = [];
    for (const item of pair.items.filter(candidate => !candidate.hidden)) {
      for (const phrase of itemPhrases(pair, item)) {
        const next = prefix + [...phrases, phrase].join("; ");
        if (estimateTokens(wrap([...lines, next])) <= budget) phrases.push(phrase);
      }
    }
    if (phrases.length) lines.push(prefix + phrases.join("; "));
  }
  return lines.length ? wrap(lines) : "";
}
