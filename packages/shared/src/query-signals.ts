import { estimateTokens, normalizeSearchTokens, type SearchQuerySignal } from "./index.js";

export const RISU_CONTINUATION_MARKER = "*says nothing*";

const FOCUS_QUERY_TOKEN_LIMIT = 1_200;
const SCENE_QUERY_TOKEN_LIMIT = 1_200;
const SCENE_MESSAGE_LIMIT = 4;

const QUERY_OMISSION = "\n[…]\n";

function splitOversizedQueryUnit(value: string, tokenLimit: number): string[] {
  const text = value.trim();
  if (!text || estimateTokens(text) <= tokenLimit) return text ? [text] : [];
  const words = text.split(/\s+/u).filter(Boolean);
  if (words.length <= 1) {
    const characters = [...text];
    const chunks: string[] = [];
    let current = "";
    for (const character of characters) {
      const candidate = `${current}${character}`;
      if (current && estimateTokens(candidate) > tokenLimit) {
        chunks.push(current);
        current = character;
      } else current = candidate;
    }
    if (current) chunks.push(current);
    return chunks;
  }
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && estimateTokens(candidate) > tokenLimit) {
      chunks.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks.flatMap((chunk) => estimateTokens(chunk) > tokenLimit
    ? splitOversizedQueryUnit(chunk, tokenLimit)
    : [chunk]);
}

function queryUnits(value: string, tokenLimit: number): string[] {
  const paragraphs = value.split(/\n\s*\n+/u).map((item) => item.trim()).filter(Boolean);
  const source = paragraphs.length > 0 ? paragraphs : [value.trim()];
  const maximumUnitTokens = Math.max(48, Math.floor(tokenLimit / 5));
  return source.flatMap((paragraph) => {
    const sentences = paragraph.split(/(?<=[.!?。！？])\s+/u).map((item) => item.trim()).filter(Boolean);
    return (sentences.length > 0 ? sentences : [paragraph])
      .flatMap((sentence) => splitOversizedQueryUnit(sentence, maximumUnitTokens));
  });
}

function boundedQueryText(value: string, tokenLimit: number): string {
  const text = value.trim();
  if (estimateTokens(text) <= tokenLimit) return text;
  const units = queryUnits(text, tokenLimit);
  if (units.length === 0) return "";
  const selected = new Set<number>([units.length - 1]);
  const assembled = (indexes: Set<number>): string => [...indexes]
    .sort((left, right) => left - right)
    .map((index) => units[index]!)
    .join(QUERY_OMISSION);
  while (selected.size < units.length) {
    const candidates = units.map((_, index) => index).filter((index) => !selected.has(index));
    candidates.sort((left, right) => {
      const normalized = (index: number): number => units.length <= 1 ? 1 : index / (units.length - 1);
      const distance = (index: number): number => Math.min(...[...selected].map((picked) => Math.abs(normalized(index) - normalized(picked))));
      return (distance(right) + normalized(right) * 0.02) - (distance(left) + normalized(left) * 0.02);
    });
    const next = candidates.find((index) => estimateTokens(assembled(new Set([...selected, index]))) <= tokenLimit);
    if (next === undefined) break;
    selected.add(next);
  }
  const result = assembled(selected);
  if (estimateTokens(result) <= tokenLimit) return result;
  return splitOversizedQueryUnit(units.at(-1)!, tokenLimit)[0] ?? "";
}

function focusInformation(value: string): number {
  const tokens = new Set(normalizeSearchTokens(value));
  const tokenSignal = Math.min(1, tokens.size / 8);
  const lengthSignal = Math.min(1, value.trim().length / 80);
  return tokenSignal * 0.7 + lengthSignal * 0.3;
}

export function composeQuerySignals(
  messages: Array<{ role: "user" | "assistant" | "system"; content: string; disabled?: boolean; id?: string }>,
): SearchQuerySignal[] {
  const active = messages.filter((message) => !message.disabled && message.role !== "system" && message.content.trim());
  const lastUser = [...active].reverse().findIndex(message => message.role === 'user');
  const focusIndex = lastUser < 0 ? -1 : active.length - lastUser - 1;
  const rawFocus = focusIndex >= 0 ? active[focusIndex]!.content : active.at(-1)?.content ?? "continue";
  // PocketRisu owns this exact empty-input marker. It remains in the source
  // ledger and extraction input, but it is not natural-language recall intent.
  const continuation = rawFocus.trim() === RISU_CONTINUATION_MARKER;
  const focus = continuation ? "" : boundedQueryText(rawFocus, FOCUS_QUERY_TOKEN_LIMIT);
  const sceneSource = (focusIndex >= 0 ? active.slice(0, focusIndex) : active.slice(0, -1))
    .filter((message) => !(message.role === "user" && message.content.trim() === RISU_CONTINUATION_MARKER))
    .slice(-SCENE_MESSAGE_LIMIT);
  const scene = boundedQueryText(sceneSource.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n"), SCENE_QUERY_TOKEN_LIMIT);
  const provenance = (rows: typeof messages) => rows.some(row => row.id !== undefined) ? { sourceMessageIds: rows.flatMap(row => row.id ? [row.id] : []) } : {};
  const focusSource = focusIndex >= 0 ? [active[focusIndex]!] : active.slice(-1);
  if (continuation) return scene
    ? [
      { kind: "continuation", text: RISU_CONTINUATION_MARKER, weight: 0, ...provenance(focusSource) },
      { kind: "scene", text: scene, weight: 1, ...provenance(sceneSource) },
    ]
    : [{ kind: "continuation", text: RISU_CONTINUATION_MARKER, weight: 0, ...provenance(focusSource) }];
  if (!scene) return [{ kind: "focus", text: focus || "continue", weight: 1, ...provenance(focusSource) }];
  const focusWeight = 0.2 + focusInformation(focus) * 0.4;
  return [
    { kind: "focus", text: focus || "continue", weight: Number(focusWeight.toFixed(3)), ...provenance(focusSource) },
    { kind: "scene", text: scene, weight: Number((1 - focusWeight).toFixed(3)), ...provenance(sceneSource) },
  ];
}
