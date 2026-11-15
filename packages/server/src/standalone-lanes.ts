import { escapeMemoryText as escape } from "@rcm/shared";
import { standaloneScopeText, type KnowledgeScope } from "@rcm/shared";

/** Apply POV only after admission. Scopes stay canonical; never infer holders
 * from display names or prose. Match only the renderer-owned row prefixes. */
export function standaloneViewpoint(data: string, scopes: readonly (KnowledgeScope | undefined)[], viewpoint?: string): string {
  if (!viewpoint) return data;
  const tags = new Map(scopes.flatMap(scope => {
    if (!scope) return [];
    const plain = `[${escape(standaloneScopeText(scope))}] `;
    const tagged = `[${escape(standaloneScopeText(scope, viewpoint))}] `;
    const lower = (value: string) => value.replace("[Known by", "[known by").replace("[No character knows", "[no character knows");
    return [[lower(plain), lower(tagged)], [plain, tagged]];
  }));
  return data.split("\n").map(line => {
    const prefix = line.startsWith("- ") ? "- " : line.startsWith("<first ") ? line.slice(0, line.indexOf(">") + 1) : "";
    if (!prefix) return line;
    for (const [plain, tagged] of tags) {
      if (line.startsWith(prefix + plain)) return prefix + tagged + line.slice(prefix.length + plain.length);
      // Owned state grammar: subject [knowledge]: body. Other lanes keep prefix tags.
      const suffix = ` ${plain.trimEnd()}: `;
      if (prefix === "- " && line.includes(suffix)) return line.replace(suffix, ` ${tagged.trimEnd()}: `);
    }
    return line;
  }).join("\n");
}
