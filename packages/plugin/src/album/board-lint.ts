/** Arca guide v6.6 §1-1, plus the product's stricter inline-flex prohibition. No DOM required. */
export interface BoardLintResult { ok: boolean; problems: { rule: string; excerpt: string }[] }
const blockedTags = new Set('style script link code button form input select textarea mark small big kbd samp var tt audio object picture source svg math template noscript dl dt dd abbr cite dfn q data bdi bdo wbr'.split(' '));
const blockedProperty = /^(?:flex(?:-.+)?|grid(?:-.+)?|position|z-index|overflow(?:-.+)?|gap|row-gap|column-gap|transform(?:-.+)?|animation(?:-.+)?|transition(?:-.+)?|opacity|filter|backdrop-filter|clip-path|mask(?:-.+)?|-webkit-.+|cursor|pointer-events|user-select|resize|writing-mode|content|mix-blend-mode|isolation|outline(?:-.+)?)$/i;
const decode = (s: string) => s.replace(/&#(x[\da-f]+|\d+);?/gi, (_, n: string) => { const cp = n[0]?.toLowerCase() === 'x' ? parseInt(n.slice(1),16) : Number(n); return cp <= 0x10ffff ? String.fromCodePoint(cp) : ''; }).replace(/&colon;/gi, ':').replace(/&tab;|&newline;/gi, '').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&amp;/gi, '&');
export function lintBoardHtml(html: string): BoardLintResult {
  const problems: BoardLintResult['problems'] = [];
  const add = (rule: string, excerpt: string) => problems.push({ rule, excerpt: excerpt.slice(0,60) });
  for (const token of html.matchAll(/<!--[\s\S]*?(?:-->|$)|<\/?[a-z][^<>]*?(?:"[^"]*"|'[^']*')?[^<>]*>/gi)) {
    const tag = token[0];
    if (tag.startsWith('<!--')) { add('HTML 주석', tag); continue; }
    const name = /^<\/?([\w-]+)/.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (blockedTags.has(name)) add(`<${name}>`, tag);
    for (const attr of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      const key = attr[1]!.toLowerCase(), value = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
      if (key === 'class' || key.startsWith('on')) add(`${key}=`, attr[0]);
      if (['src','href','action','poster','srcset','xlink:href'].includes(key) && /(?:javascript|data)\s*:/i.test(value.replace(/[\u0000-\u0020]/g,''))) add('금지 URL', attr[0]);
      if (key !== 'style') continue;
      const css = value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\([\da-f]{1,6})\s?/gi, (_,n: string)=>String.fromCodePoint(Math.min(0x10ffff,parseInt(n,16)))).replace(/\\([^\da-f])/gi,'$1');
      for (const declaration of css.split(';')) {
        const colon = declaration.indexOf(':'); if (colon < 0) continue;
        const property = declaration.slice(0,colon).trim(), val = declaration.slice(colon+1).trim();
        if (blockedProperty.test(property)) add(property, declaration);
        if (property.toLowerCase() === 'display' && /^(?:inline-)?(?:flex|grid)\b/i.test(val)) add('display', declaration);
      }
      for (const match of css.matchAll(/url\s*\(|(?:javascript|data)\s*:|conic-gradient|@media|@keyframes|::before|::after|:hover|:nth-child/gi)) add(match[0], css.slice(Math.max(0,match.index-12),match.index+45));
    }
  }
  return { ok: problems.length === 0, problems };
}
