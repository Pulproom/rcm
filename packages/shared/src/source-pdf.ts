/** Source-only PDF transport. These are product-owned provider/model identifiers. */
export interface SourcePdfSettings { enabled: boolean; fontPt: number; }
export interface SourceTransport { kind: 'text' | 'pdf'; pages?: number; fontPt?: number; estimatedTextInputTokens?: number; }
/** Restore/read boundary: retain only bounded product metadata, never arbitrary JSON fields. */
export function readSourceTransport(value: unknown): SourceTransport | null {
  if (typeof value === 'string') { try { value=JSON.parse(value); } catch { return null; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record=value as Record<string,unknown>;
  if (record.kind === 'text') return {kind:'text'};
  if (record.kind !== 'pdf' || typeof record.pages !== 'number' || !Number.isInteger(record.pages) || record.pages<1 || record.pages>1000
    || typeof record.fontPt !== 'number' || !Number.isInteger(record.fontPt) || record.fontPt<1 || record.fontPt>10) return null;
  const estimate = record.estimatedTextInputTokens;
  return {kind:'pdf',pages:record.pages,fontPt:record.fontPt,
    ...(typeof estimate === 'number' && Number.isInteger(estimate) && estimate > 0 && estimate <= 1_000_000 ? {estimatedTextInputTokens:estimate} : {})};
}
export function sourcePdfUnavailable(config: {engine: string; provider: string; model: string}): string | undefined {
  if (config.engine !== 'server') return 'RCM 서버에서 처리할 때만 쓸 수 있어요.';
  if (!['vertex', 'gemini_api'].includes(config.provider) || !/^gemini-(?:flash(?:-lite)?-latest|\d+(?:\.\d+)?-flash(?:-[a-z0-9.]+)*)$/i.test(config.model.trim()))
    return 'Vertex·Gemini API의 Flash 모델에서만 쓸 수 있어요.';
}
/** A4 points; margin = exactly 2 × fontPt, leading = exactly 1.2 × fontPt.
 * Latin-1 scalars advance half an em; all other Unicode scalars advance one em. */
export function sourcePdfGeometry(fontPt: number) {
  const width=595.28, height=841.89, margin=2*fontPt, leading=1.2*fontPt;
  return {width,height,margin,leading,columnsWidth:width-2*margin,rows:Math.floor((height-2*margin-fontPt)/leading)+1};
}
export const sourcePdfAdvance = (character: string): number => character.codePointAt(0)! < 256 ? 500 : 1000;
export function layoutSourcePdf(text: string, fontPt: number): {lines: string[]; pages: number} {
  const geometry=sourcePdfGeometry(fontPt),lines:string[]=[];
  for (const original of text.split('\n')) {
    let line='',used=0;
    for(const character of original) {
      const advance=sourcePdfAdvance(character)*fontPt/1000;
      if(line && used+advance>geometry.columnsWidth) {lines.push(line);line='';used=0;}
      line+=character;used+=advance;
    }
    lines.push(line);
  }
  return {lines,pages:Math.ceil(lines.length/geometry.rows)};
}
