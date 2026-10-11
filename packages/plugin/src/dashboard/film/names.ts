const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]!);

const LATIN_NAME = /^[\p{Script=Latin} .'’-]+$/u;

export function isLatinName(name: string): boolean {
  return /\p{Script=Latin}/u.test(name) && LATIN_NAME.test(name);
}

/** Subject particle for a name: a Hangul last syllable decides 이/가; any other script can't be read, so it gets 이(가) (spelling rule, not meaning). */
export function subjectParticle(name: string): "이" | "가" | "이(가)" {
  const last = name.trim().at(-1) ?? "";
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code >= 11172) return "이(가)";
  return code % 28 !== 0 ? "이" : "가";
}

export function nameHtml(name: string, extraClass = ""): string {
  const classes = ["name", extraClass.trim(), isLatinName(name) ? "" : "is-cjk"].filter(Boolean).join(" ");
  return `<span class="${escapeHtml(classes)}">${escapeHtml(name)}</span>`;
}
