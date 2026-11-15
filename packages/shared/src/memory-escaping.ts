/** Model-facing envelopes are read as text, not decoded by an HTML renderer.
 * Keep prose punctuation literal; protect angle brackets so data cannot add tags. */
export function escapeMemoryText(value: string): string {
  return value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Attributes keep XML quoting rules independently of readable text nodes. */
export function escapeMemoryAttribute(value: string): string {
  return escapeMemoryText(value.replaceAll("&", "&amp;"))
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;")
    .replaceAll("\r", "&#13;").replaceAll("\n", "&#10;");
}
