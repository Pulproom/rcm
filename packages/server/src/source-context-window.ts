import {buildSourceUnits,estimateTokens} from '@rcm/shared';
import {createHash} from 'node:crypto';
import {presentationOnlySourcePassage} from './source-evidence.js';
export type Source={message_id:string;canonical_content:string;canonical_hash:string;ordinal:number};
export type Citation={messageId:string;quote?:string;canonicalHash?:string;startOffset?:number;endOffset?:number};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,12);
/** Restores contiguous canonical paragraphs, without treating their proximity
 * as proof of a shared event, speaker, date or character knowledge. */
export class ContextWindows {
 private cache=new Map<string,Array<{start:number;end:number;text:string;tokens:number}>>();
 constructor(private sources:Map<string,Source>){}
 blocks(source:Source){
  const cacheKey=source.message_id+'\0'+source.canonical_hash;
  if(this.cache.has(cacheKey))return this.cache.get(cacheKey)!;
  const units=buildSourceUnits([{id:source.message_id,content:source.canonical_content,canonicalHash:source.canonical_hash}],{granularity:'display'});
  const blocks:Array<{start:number;end:number;text:string;tokens:number}>=[];
  for(const unit of units){
   const last=blocks.at(-1),gap=last?source.canonical_content.slice(last.end,unit.start):'';
   if(last&&/^\s*$/u.test(gap)&&!/[\r\n]/u.test(gap)){
    last.end=unit.end;last.text=source.canonical_content.slice(last.start,last.end);last.tokens=estimateTokens(last.text);
   }else blocks.push({start:unit.start,end:unit.end,text:unit.text,tokens:estimateTokens(unit.text)});
  }
  // Known tool/display protocol is not a narrative passage. Keep offsets and
  // let omitted regions break context; do not delete/concatenate the raw source.
  const visible=blocks.filter(b=>!presentationOnlySourcePassage(b.text)&&!/^<tool_call>[\s\S]*<\/tool_call>$/u.test(b.text)&&!/^<!--\s*pm:tool:v1:[\s\S]*-->$/u.test(b.text));
  this.cache.set(cacheKey,visible);return visible;
 }
 around(citation:Citation,ceiling=512){
  const source=this.sources.get(citation.messageId);if(!source||citation.canonicalHash&&citation.canonicalHash!==source.canonical_hash)return;
  const raw=source.canonical_content;
  let start=citation.startOffset,end=citation.endOffset;
  if(start!==undefined||end!==undefined){
   if(!Number.isInteger(start)||!Number.isInteger(end)||start!<0||end!<=start!||end!>raw.length||citation.quote!==raw.slice(start,end))return;
  }else{
   if(!citation.quote)return;
   start=raw.indexOf(citation.quote);if(start<0||raw.indexOf(citation.quote,start+1)>=0)return;end=start+citation.quote.length;
  }
  const blocks=this.blocks(source);
  let left=blocks.findIndex(b=>b.start<=start!&&b.end>start!),right=blocks.findIndex(b=>b.start<end!&&b.end>=end!);
  if(left<0||right<left)return;
  const continuous=(l:number,r:number)=>blocks.slice(l+1,r+1).every((b,i)=>/^\s*$/u.test(raw.slice(blocks[l+i]!.end,b.start)));
  if(!continuous(left,right)||estimateTokens(raw.slice(blocks[left]!.start,blocks[right]!.end))>ceiling)return;
  let before=0,after=0;
  // Whole paragraphs, balanced context on both sides. Never infer speakers,
  // conditions, scene identity or access from prose. Protocol gaps are barriers.
  while(true){
   const choices=[{l:left,r:right+1,side:'after',used:after},{l:left-1,r:right,side:'before',used:before}]
    .filter(x=>x.l>=0&&x.r<blocks.length&&continuous(x.l,x.r)&&estimateTokens(raw.slice(blocks[x.l]!.start,blocks[x.r]!.end))<=ceiling)
    .sort((a,b)=>a.used-b.used);
   const next=choices[0];if(!next)break;
   if(next.side==='after')after+=blocks[next.r]!.tokens;else before+=blocks[next.l]!.tokens;
   left=next.l;right=next.r;
  }
  const from=blocks[left]!.start,to=blocks[right]!.end;
  return {id:'s'+hash(JSON.stringify([source.message_id,source.canonical_hash,from,to])),kind:'source_context',sourceOrder:source.ordinal,
   scope:'authorial archive; not character knowledge',text:raw.slice(from,to),
   provenance:{messageId:source.message_id,canonicalHash:source.canonical_hash,start:from,end:to,anchor:{start,end}},
   incompleteBefore:left>0,incompleteAfter:right<blocks.length-1};
 }
}
