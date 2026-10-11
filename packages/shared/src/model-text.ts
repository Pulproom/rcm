/** Known Risu image markup, not a classifier for narrative content. */
const markupTokens = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)(?=[\s/>=])(?:"[^"]*"|'[^']*'|[^'"<>])*>/gi;

/** Image-only protocol regions. Offsets always refer to the unchanged source. */
export function modelImageRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const stack: Array<{ name: string; start: number; image: boolean; asset: boolean; hasImage: boolean }> = [];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "tag"]);
  const assetClasses = new Set(["am-image", "am-generated-image", "am-illustration-projection"]);
  for (const match of text.matchAll(markupTokens)) {
    if (!match[1]) continue;
    const token = match[0];
    const name = match[1].toLowerCase();
    if (token.startsWith("</")) {
      // Broken nesting is not permission to consume the remaining narrative.
      if (stack.at(-1)?.name !== name) { stack.length = 0; continue; }
      const frame = stack.pop()!;
      if (frame.image || frame.asset && frame.hasImage) ranges.push({ start: frame.start, end: match.index! + token.length });
      if (frame.hasImage && stack.length) stack.at(-1)!.hasImage = true;
      continue;
    }
    const attributes = new Map<string, string>();
    const body = token.slice(1 + match[1].length, -1);
    for (const attribute of body.matchAll(/(?:^|\s)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      attributes.set(attribute[1]!.toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    const asset = ["div", "span", "figure"].includes(name) && (attributes.get("class") ?? "").split(/\s+/).some(value => assetClasses.has(value.replace(/^x-risu-/, "")));
    const image = name === "lb-xnai" || name === "lb-lazy" && attributes.get("id") === "lb-xnai";
    const simpleImage = /^<(?:img(?=\s|=)|tag(?=\s*=))/i.test(token);
    const hasImage = image || simpleImage;
    if (hasImage && stack.length) stack.at(-1)!.hasImage = true;
    if (simpleImage || image && /\/\s*>$/.test(token)) ranges.push({ start: match.index!, end: match.index! + token.length });
    if (!voidTags.has(name) && !/\/\s*>$/.test(token)) stack.push({ name, start: match.index!, image, asset, hasImage });
  }
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function stripModelImageTags(text: string): string {
  // A boundary remains so removing a tag cannot fuse neighboring words.
  let cursor = 0;
  const parts: string[] = [];
  for (const range of modelImageRanges(text)) {
    parts.push(text.slice(cursor, range.start), " ");
    cursor = range.end;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

/** Keep JSON escaping valid when a prompt contains a serialized transcript. */
export function prepareAuxiliaryText(text: string): string {
  const decoded = text.replace(new RegExp(`${markupTokens.source}|"(?:\\\\.|[^"\\\\])*"`, "gi"), (part) => {
    if (part.startsWith("<")) return part;
    try {
      const decoded = JSON.parse(part);
      const clean = stripModelImageTags(decoded);
      return clean === decoded ? part : JSON.stringify(clean);
    } catch { return stripModelImageTags(part); }
  });
  // Plain quoted dialogue is not JSON: an attribute quote may interrupt the
  // string scan above. Remove complete remaining tags in that original text.
  return stripModelImageTags(decoded);
}
