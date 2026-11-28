// Deterministic source-only CID PDF, independently implemented without font binaries.
import {deflateSync} from 'node:zlib';
import {layoutSourcePdf, sourcePdfGeometry, sourcePdfAdvance} from '@rcm/shared';
const utf16hex = (text: string) => Buffer.from(text, 'utf16le').swap16().toString('hex').toUpperCase();
export function buildSourcePdf(text: string, fontPt: number) {
 const {width,height,margin,leading,rows:perPage}=sourcePdfGeometry(fontPt);
 const chars=[...new Set([...text].filter(c=>c!=='\n'))];
 if(chars.length>65534)throw Error('Too many distinct source scalars');
 const codes=new Map(chars.map((c,i)=>[c,i+1]));
 const advance=sourcePdfAdvance;
 const {lines}=layoutSourcePdf(text,fontPt);
 const pages=Array.from({length:Math.ceil(lines.length/perPage)},(_,i)=>lines.slice(i*perPage,(i+1)*perPage));
 const objects:Buffer[]=[];const add=(b:string|Buffer)=>{objects.push(Buffer.isBuffer(b)?b:Buffer.from(b,'ascii'));return objects.length;};
 const stream=(data:string|Buffer)=>{const compressed=deflateSync(Buffer.from(data));return Buffer.concat([Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),compressed,Buffer.from('\nendstream')]);};
 add('<< /Type /Catalog /Pages 2 0 R >>');add('');
 add('<< /Type /Font /Subtype /Type0 /BaseFont /RCMSource /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>');
 add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /RCMSource /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 1000 /W [1 [${chars.map(advance).join(' ')}]] /CIDToGIDMap 7 0 R >>`);
 add('<< /Type /FontDescriptor /FontName /RCMSource /Flags 4 /FontBBox [0 -200 1000 1000] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>');
 let cmap='/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /RCMUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
 for(let start=0;start<chars.length;start+=100){const chunk=chars.slice(start,start+100);cmap+=`${chunk.length} beginbfchar\n`+chunk.map(c=>`<${codes.get(c)!.toString(16).padStart(4,'0')}> <${utf16hex(c)}>`).join('\n')+'\nendbfchar\n';}
 cmap+='endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';add(stream(cmap));
 // Every CID points to .notdef. No embedded or OS fonts; the ToUnicode map carries the text.
 add(stream(Buffer.alloc((chars.length+1)*2)));
 const pageIds:number[]=[];
 for(const page of pages){const pageId=objects.length+1,contentId=pageId+1;pageIds.push(pageId);
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
  const content=`BT /F1 ${fontPt} Tf ${leading} TL 1 0 0 1 ${margin} ${height-margin-fontPt} Tm\n`+page.map((line,i)=>(i?'T*\n':'')+`<${[...line].map(c=>codes.get(c)!.toString(16).padStart(4,'0')).join('')}> Tj`).join('\n')+'\nET';add(stream(content));
 }
 objects[1]=Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id=>id+' 0 R').join(' ')}] >>`);
 const parts=[Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n','binary')],offsets=[0];let offset=parts[0]!.length;
 objects.forEach((b,i)=>{offsets.push(offset);const part=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),b,Buffer.from('\nendobj\n')]);parts.push(part);offset+=part.length;});
 parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
 return {bytes:Buffer.concat(parts),pages:pages.length,fontPt,marginPt:margin,leadingPt:leading,lines:lines.length,distinctScalars:chars.length};
}
