import { escapeMemoryText as escape, escapeMemoryAttribute } from "./memory-escaping.js";
import type { MemoryContextItem } from "./index.js";
import { memoryEvidenceLabel, sameMemoryLabels } from "./memory-presentation.js";
import { formatTagNames, headerScopeText, includesPerson, isException, lineScopeTag, viewpointUnknownTag, scopeOf, scopeRelation, secretTargets, type KnowledgeScope } from "./knowledge-scope.js";
import { coarseStoryTime, storedStoryTimeEnd } from "./story-time.js";

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

export interface CardRenderOptions {
  viewpoint?: string;
  latestStoryTime?: number;
  plot: "emit" | "omit";
  clarity?: Array<{ name: string; level: "hazy" | "faint" }>;
  compact?: boolean;
}

/** Empty user-edited/legacy junk plots keep the tolerant legacy path. */
export function isAuthorCard(item: Pick<MemoryContextItem, "cardShape" | "content">): boolean {
  return item.cardShape === 1 && Boolean(item.content.trim());
}

export function emitsMemoryPlot(item: Pick<MemoryContextItem,"cardShape"|"content"|"atomAccessVersion">): boolean {
  return Boolean(item.content.trim()) && (isAuthorCard(item) || item.atomAccessVersion === 0);
}

/** Reserve the header and every non-universal scope override, independent of POV. */
export function povSlots(scene: MemoryScene): number {
  const card = scopeOf(scene.record);
  return 1 + [...scene.details, ...scene.dialogues].filter(entry => {
    const scope = scopeOf(entry);
    return scope.kind !== "universal" && (lineScopeTag(scope, card) !== undefined
      || isAuthorCard(scene.record) && isException(entry,scene.record.knownBy));
  }).length;
}

export function renderMemoryScene(scene: MemoryScene, options: CardRenderOptions): string {
  const item = scene.record;
  if (options.compact) {
    const names = item.knownByEveryone ? "everyone" : item.knownBy.join(", ");
    return `<memory id="${escapeMemoryAttribute(item.id)}" title="${escapeMemoryAttribute(item.title)}" known_by="${escapeMemoryAttribute(names)}">${escape(item.content)}</memory>`;
  }
  const author = isAuthorCard(item);
  const { latestStoryTime, viewpoint } = options;
  const card = scopeOf(item);
  const plotScope = author ? scopeOf({knownBy:item.plotKnowers ?? []}) : card;
  // Only compare positions when every entry has one; partial positions must
  // not invent an order for unpositioned facts. Within one source message the
  // exact quote position orders the lines; a detail without one follows the
  // positioned lines of its message. Equal positions remain stable.
  const offset = (detail: MemoryScene["details"][number]) => detail.sourceOffset ?? Number.MAX_SAFE_INTEGER;
  const details = scene.details.every(detail => detail.sourceOrdinal !== undefined)
    ? [...scene.details].sort((a, b) => a.sourceOrdinal! - b.sourceOrdinal! || offset(a) - offset(b)) : scene.details;
  const dialogues = scene.dialogues.every(dialogue => dialogue.ordinal !== undefined)
    ? [...scene.dialogues].sort((a, b) => a.ordinal! - b.ordinal!) : scene.dialogues;
  const headerLocations = [...new Set([...item.locations, ...details.flatMap(detail => detail.locations)])];
  const headerParticipants = [...new Set([...item.participants, ...details.flatMap(detail => detail.participants)])];
  const alsoInvolved = headerParticipants.filter(name => !includesPerson(scopeOf({knownBy:item.knownBy}), name));
  const header = [
    author ? `Present: ${formatTagNames(item.knownBy)}` : item.cardShape === 0
      ? `Recorded knowledge scope: ${card.kind === "universal" ? "everyone" : card.kind === "narrator" ? "no character" : formatTagNames(card.names)}`
      : headerScopeText(card),
    alsoInvolved.length ? `Also involved: ${formatTagNames(alsoInvolved.sort())}` : "",
    ...(options.clarity ?? []).filter(entry => includesPerson(plotScope, entry.name)).map(entry => `${entry.level} for ${formatTagNames([entry.name])}`),
    viewpoint && !includesPerson(plotScope, viewpoint) ? viewpointUnknownTag(viewpoint, includesPerson(card, viewpoint)) : "",
  ].filter(Boolean).map(escape).join(" · ");
  const end = storedStoryTimeEnd(scene.storyTime);
  const days = latestStoryTime !== undefined && Number.isFinite(latestStoryTime) && end !== undefined && latestStoryTime >= end
    ? Math.floor(latestStoryTime / 86_400_000) - Math.floor(end / 86_400_000) : undefined;
  // Recent records keep their exact date and time; the newest record may lag
  // the chat, so they get no relative label. Older ones read as people recall.
  const ago = days === undefined || days < 7 ? undefined : days < 14 ? "about a week ago" : days < 30 ? "a few weeks ago"
    : days < 60 ? "about a month ago" : days < 365 ? "a few months ago" : days < 730 ? "about a year ago" : "years ago";
  const shownTime = scene.storyTime && ago ? coarseStoryTime(scene.storyTime) : scene.storyTime;
  const when = shownTime ? ` when="${escapeMemoryAttribute(shownTime)}"` : "";
  const beforeLatest = ago ? ` (${ago})` : "";
  const place = headerLocations.length ? ` place="${escapeMemoryAttribute(headerLocations.sort().join("; "))}"` : "";
  const tags = (scope: KnowledgeScope, hiddenFrom?: readonly string[], exception = false, labels?: readonly string[]): string => {
    // Labels annotate acquisition basis only; raw scopes still decide knowledge and POV.
    const annotated = scope.kind === "set" && labels && !sameMemoryLabels(labels,scope.names);
    const override = lineScopeTag(scope, card) ?? (exception ? headerScopeText(scope).replace(/^No character knows$/, "no character knows").replace(/^Known by/, "known by") : undefined);
    const scopeTag = annotated ? `${scopeRelation(scope,card) === "inside" ? "only" : "known by"} ${formatTagNames(labels)}`
      : override;
    const targets = author ? hiddenFrom ?? [] : secretTargets(hiddenFrom, scope);
    const values = [scopeTag, targets.length ? `secret from ${formatTagNames(targets)}` : "", override && viewpoint && !includesPerson(scope, viewpoint) ? viewpointUnknownTag(viewpoint) : ""].filter(Boolean);
    return values.length ? `[${escape(values.join(" · "))}] ` : "";
  };
  const detailLines = details.map((detail, index) => {
      const label = memoryEvidenceLabel(detail.epistemic);
      const qualifier = label === "Observed" ? "" : `${label}: `;
      // Compare only typed place sets, in displayed detail order. An empty
      // preceding set counts as a change; never infer a place from the prose.
      const location = headerLocations.length >= 2 && detail.locations.length
        && (index === 0 || !sameMemoryLabels(detail.locations, details[index - 1]!.locations))
        ? ` (at ${escape([...new Set(detail.locations)].sort().join("; "))})` : "";
      const exception = author && isException(detail,item.knownBy);
      return { exception, text: `- ${tags(scopeOf(detail), detail.hiddenFrom, exception, detail.knownByLabels)}${qualifier}${escape(detail.text)}${location}` };
    });
  const dialogueLines = dialogues.map(dialogue => `${tags(scopeOf(dialogue),undefined,false,dialogue.knownByLabels)}${escape(dialogue.speaker)}: “${escape(dialogue.text)}”`);
  const entries = [
    ...(options.plot === "emit" && emitsMemoryPlot(item) ? [`Plot: ${escape(item.content)}`] : []),
    ...(author ? detailLines.filter(line=>line.exception).map(line=>line.text) : detailLines.map(line=>line.text)),
    ...dialogueLines,
    ...(author ? detailLines.filter(line=>!line.exception).map(line=>line.text) : []),
  ];
  return `<memory id="${escapeMemoryAttribute(item.id)}"${when}${place}>\n${[header + beforeLatest, scene.title && escape(scene.title), ...entries].filter(Boolean).join("\n")}\n</memory>`;
}
