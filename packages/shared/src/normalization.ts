import { modelImageRanges } from "./model-text.js";

export interface CanonicalRemovalRule {
  name: string;
  enabled: boolean;
  pattern: string;
  flags: string;
}

export interface CanonicalizationPolicy {
  useLightboard: boolean;
  useGigaTrans: boolean;
  customRules: CanonicalRemovalRule[];
}

export const defaultCanonicalizationPolicy = (): CanonicalizationPolicy => ({
  useLightboard: false,
  useGigaTrans: true,
  customRules: [],
});

export function validateCanonicalRemovalRule(rule: CanonicalRemovalRule): string | undefined {
  try {
    void new RegExp(rule.pattern, rule.flags || "gis");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// GigaTrans owns these marker tags: a control marker it appends to every reply
// and a separator between preserved head blocks and the display translation.
const GIGATRANS_MARKERS = /<GT-(?:CTRL\b[^>]*|SEP)\s*\/>/gi;

/** Parses GigaTrans's owned layout, never prose:
 * `head <GT-SEP/> translation <GigaTrans>source</GigaTrans> tail <GT-CTRL/>`.
 * Keep what the main model receives (head, source, tail) and drop only the
 * display translation, so a reply reads the same before and after translation.
 * Without a separator everything before a block is treated as translation. */
function selectGigaTransSource(value: string): string {
  const blocks = [...value.matchAll(/<GigaTrans\b[^>]*>([\s\S]*?)<\/GigaTrans\s*>/gi)];
  if (blocks.length === 0) return value;
  const kept: string[] = [];
  let cursor = 0;
  for (const block of blocks) {
    const start = block.index ?? 0;
    const before = value.slice(cursor, start);
    const separator = before.search(/<GT-SEP\s*\/>/i);
    // The lazy block match always starts at the leftmost opening tag, so an
    // incomplete opening can only remain after the last complete block, where
    // the tail below keeps it visible instead of silently dropping source.
    kept.push(separator >= 0 ? before.slice(0, separator) : "", block[1] ?? "");
    cursor = start + block[0].length;
  }
  kept.push(value.slice(cursor));
  return kept.map((part) => part.trim()).filter(Boolean).join("\n");
}

/** Parse GigaTrans's owned format, not prose: only the display between SEP and source. */
export function selectGigaTransTranslation(value: string): string | undefined {
  const match = /<GT-SEP\s*\/>([\s\S]*?)<GigaTrans\b[^>]*>[\s\S]*?<\/GigaTrans\s*>/i.exec(value);
  return match?.[1]?.trim() || undefined;
}

function stripLightboardData(value: string): string {
  return value
    .replace(/\[LBDATA START\][\s\S]*?\[LBDATA END\]/gi, "")
    .replace(/<lb-lazy\b[^>]*\/>/gi, "");
}

/** Yumi can expose its translated display before the matching model-source
 * record is readable by another plugin. Keep the displayed prose as the safe
 * fallback, but never let Yumi's owned transport comments become story text or
 * search terms. Incomplete comments remain visible instead of swallowing prose. */
export function stripYumiTransportComments(value: string): string {
  return value.replace(/<!--\s*yumi-tr\s*:[\s\S]*?-->/gi, "");
}

function tidyRemovedText(value: string): string {
  return value
    .replace(/[ \t]+$/gm, "")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
}

/** Comparison only: never use this projection as a quote or source-unit input. */
export function imageComparisonText(value: string): string {
  let text = value.replace(/\r\n/g, "\n");
  const ranges = modelImageRanges(text);
  // Work backwards so all positions still address the original string.
  for (const range of ranges.reverse()) {
    let start = range.start;
    let end = range.end;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextLine = text.indexOf("\n", end);
    const lineEnd = nextLine < 0 ? text.length : nextLine;
    if (/^[ \t]*$/.test(text.slice(lineStart, start)) && /^[ \t]*$/.test(text.slice(end, lineEnd))) {
      // An image's own line is presentation. Preserve neighboring prose lines,
      // including paragraph, list and Markdown hard-break boundaries.
      start = lineStart;
      end = nextLine < 0 ? lineEnd : nextLine + 1;
    } else if (/[ \t]$/.test(text.slice(0, start)) && /^[ \t]/.test(text.slice(end))) {
      // A <tag> B and A B have the same prose. Only collapse the space
      // directly introduced at this image boundary, not all prose whitespace.
      end += text.slice(end).match(/^[ \t]+/)![0].length;
    }
    text = text.slice(0, start) + text.slice(end);
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** Recognized image presentation changed; the actual source text did not. */
export function isImageOnlySourceChange(before: string, after: string): boolean {
  if (!modelImageRanges(before).length && !modelImageRanges(after).length) return false;
  return imageComparisonText(before) === imageComparisonText(after);
}

/** Compact identity projection for clone/branch comparison; not quote text. */
export function sourceComparisonText(value: string, policy = defaultCanonicalizationPolicy()): string {
  return imageComparisonText(canonicalizeSourceText(value, policy));
}

export function canonicalizeSourceText(value: string, policy: CanonicalizationPolicy): string {
  // GigaTrans source selection is unconditional. Current clients also publish
  // the policy marker as true; the UI no longer exposes a toggle.
  let result = selectGigaTransSource(value).replace(GIGATRANS_MARKERS, "");
  result = stripYumiTransportComments(result);
  if (policy.useLightboard) result = stripLightboardData(result);
  result = result.replace(/<thoughts\b[^>]*>[\s\S]*?<\/thoughts\s*>/gi, "");
  for (const rule of policy.customRules) {
    if (!rule.enabled || !rule.pattern) continue;
    result = result.replace(new RegExp(rule.pattern, rule.flags || "gis"), "");
  }
  return tidyRemovedText(result);
}
