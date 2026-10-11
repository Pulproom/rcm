import type { MemoryContextItem } from "./index.js";
import { defaultMemoryScope, memoryAccessLabel, memoryEvidenceLabel, sameMemoryLabels } from "./memory-presentation.js";
import { structuredStoryTimeEnd } from "./story-time.js";

/** A stored record, not a claim that all siblings describe one occurrence.
 * Access must already be resolved. Keep identity, provenance and qualifiers
 * while projecting the same evidence for automatic and explicit reading. */
export interface MemoryScene {
  memoryId: string;
  sourceOrdinal?: number;
  storyTime?: string;
  title: string;
  clarity: MemoryContextItem["detail"];
  details: MemoryContextItem["details"];
  dialogues: MemoryContextItem["keyDialogues"];
  evidence: MemoryContextItem["evidence"];
  record: MemoryContextItem;
}

export function projectMemoryScene(item: MemoryContextItem): MemoryScene {
  return { memoryId: item.id, sourceOrdinal: item.sourceOrdinal, storyTime: item.storyTime,
    title: item.title, clarity: item.detail, details: item.details, dialogues: item.keyDialogues,
    evidence: item.evidence, record: item };
}

const escape = (text: string): string => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const access = (labels: readonly string[]): string => escape(memoryAccessLabel(labels));

export function renderMemoryScene(scene: MemoryScene, latestStoryTime?: number): string {
  const item = scene.record;
  // Only compare positions when every entry has one; partial positions must
  // not invent an order for unpositioned facts. Equal positions remain stable.
  const details = scene.details.every(detail => detail.sourceOrdinal !== undefined)
    ? [...scene.details].sort((a, b) => a.sourceOrdinal! - b.sourceOrdinal!) : scene.details;
  const dialogues = scene.dialogues.every(dialogue => dialogue.ordinal !== undefined)
    ? [...scene.dialogues].sort((a, b) => a.ordinal! - b.ordinal!) : scene.dialogues;
  const hasSummary = item.atomAccessVersion === 0 && Boolean(item.content);
  const headerLocations = [...new Set([...item.locations, ...details.flatMap(detail => detail.locations)])];
  const headerParticipants = [...new Set([...item.participants, ...details.flatMap(detail => detail.participants)])];
  const contextLine = (locations: string[], participants: string[]): string => [
    locations.length ? `Place: ${escape([...new Set(locations)].sort().join("; "))}` : "",
    participants.length ? `With: ${escape([...new Set(participants)].sort().join(", "))}` : "",
  ].filter(Boolean).join(" · ");
  const headerContext = contextLine(headerLocations, headerParticipants);
  const clarity = ["fragment", "deja_vu", "unrecalled"].includes(scene.clarity) ? ` recall_clarity="${scene.clarity === "fragment" ? "hazy" : "faint"}"` : "";
  const briefState = !hasSummary && scene.details.length === 1 && scene.details[0]!.kind === "character_state" && !scene.dialogues.length;
  const end = structuredStoryTimeEnd(scene.storyTime);
  const days = latestStoryTime !== undefined && Number.isFinite(latestStoryTime) && end !== undefined && latestStoryTime >= end
    ? Math.floor(latestStoryTime / 86_400_000) - Math.floor(end / 86_400_000) : undefined;
  const distance = days === undefined ? undefined : days === 0 ? "same day" : days > 365 ? "over a year"
    : days >= 60 ? `about ${Math.round(days / 30)} months` : days >= 14 ? `about ${Math.round(days / 7)} weeks` : `${days} days`;
  const when = scene.storyTime ? ` when="${escape(scene.storyTime)}"` : "";
  const beforeLatest = distance ? ` before_latest="${distance}"` : "";
  // Dialogues follow details in their own stored order; no inferred prose links.
  const entries = [
    ...(hasSummary ? [{ text: escape(item.content), labels: item.knownBy, bullet: "" }] : []),
    ...details.map((detail, index) => {
      const label = memoryEvidenceLabel(detail.epistemic);
      const qualifier = label === "Observed" ? "" : `${label}: `;
      // Compare only typed place sets, in displayed detail order. An empty
      // preceding set counts as a change; never infer a place from the prose.
      const location = headerLocations.length >= 2 && detail.locations.length
        && (index === 0 || !sameMemoryLabels(detail.locations, details[index - 1]!.locations))
        ? ` (at ${escape([...new Set(detail.locations)].sort().join("; "))})` : "";
      return { text: `${qualifier}${escape(detail.text)}${location}`, labels: detail.knownByLabels ?? detail.knownBy, bullet: "- " };
    }),
    ...dialogues.map(dialogue => ({ text: `${escape(dialogue.speaker)}: “${escape(dialogue.text)}”`, labels: dialogue.knownByLabels ?? dialogue.knownBy ?? [], bullet: "" })),
  ];
  if (!entries.length) return "";
  const defaultScope = defaultMemoryScope(entries.map(entry => entry.labels));
  const header = [access(defaultScope), headerContext].filter(Boolean).join(" · ");
  const body = entries.map(entry => {
    const prefix = sameMemoryLabels(defaultScope, entry.labels) ? "" : `[${access(entry.labels)}] `;
    return `${entry.bullet}${prefix}${entry.text}`;
  }).join("\n");
  return `<memory id="${escape(item.id)}"${when}${beforeLatest}${clarity}>\n${[header, briefState ? "Background record" : "", scene.title && escape(scene.title), body].filter(Boolean).join("\n")}\n</memory>`;
}
