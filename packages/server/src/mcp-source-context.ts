import { createHash } from "node:crypto";
import { estimateTokens, type McpQuestionAnswer, type McpSourceMetadata, type McpSourceRange, type MemoryContextItem } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import type { SemanticSearchResult, SemanticSourceHit } from "./embedding.js";
import { memoryAtomKey, memoryDetailAtomKey, memoryDialogueAtomKey } from "./memory-atoms.js";
import { evidenceRanker } from "./mcp-evidence.js";
import { presentationOnlySourcePassage } from "./source-evidence.js";
import { ContextWindows } from "./source-context-window.js";
import { collectStateEvidence, stateMcpEvidence, type StateEvidence } from "./state-evidence.js";

type Source = { message_id:string;canonical_content:string;canonical_hash:string;ordinal:number;role:string };
type Located = { source:Source;start:number;end:number;score:number;memoryId?:string };
type SourcePassage = { text:string;start:number;end:number;contiguous:boolean };
export interface McpProvidedSourceDiagnostic { sources:number;windows:number;candidates:number }
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");

function sentenceRanges(text:string,offset=0):Array<{start:number;end:number}>{
  try{return [...new Intl.Segmenter(undefined,{granularity:"sentence"}).segment(text)].flatMap(segment=>{
    const leading=segment.segment.search(/\S/u);if(leading<0)return[];
    return [{start:offset+segment.index+leading,end:offset+segment.index+segment.segment.trimEnd().length}];
  });}catch{return [...text.matchAll(/\S[\s\S]*?(?:[.!?。！？]+(?=\s|$)|$)/gu)].map(match=>({start:offset+match.index!,end:offset+match.index!+match[0].trimEnd().length}));}
}

function sentenceWindow(source:Source,start:number,end:number,paragraphStart:number,paragraphEnd:number,ceiling:number):SourcePassage|undefined{
  const sentences=sentenceRanges(source.canonical_content.slice(paragraphStart,paragraphEnd),paragraphStart);
  let first=sentences.findIndex(sentence=>sentence.end>start);let last=-1;
  for(let index=sentences.length-1;index>=0;index--)if(sentences[index]!.start<end){last=index;break;}
  if(first<0)return; if(last<first)last=first;
  const text=()=>source.canonical_content.slice(sentences[first]!.start,sentences[last]!.end);
  while(true){
    const candidates=[first>0?{first:first-1,last}:undefined,last+1<sentences.length?{first,last:last+1}:undefined]
      .filter((candidate):candidate is {first:number;last:number}=>Boolean(candidate))
      .map(candidate=>({...candidate,value:source.canonical_content.slice(sentences[candidate.first]!.start,sentences[candidate.last]!.end)}))
      .filter(candidate=>estimateTokens(candidate.value)<=ceiling).sort((left,right)=>left.value.length-right.value.length);
    const next=candidates[0];if(!next)break;first=next.first;last=next.last;
  }
  const value=text();return value?{text:value,start:sentences[first]!.start,end:sentences[last]!.end,contiguous:true}:undefined;
}

function paragraphsAround(source:Source,start:number,end:number,ceiling:number,expandAdjacent=true):SourcePassage|undefined {
  const paragraphs=[...source.canonical_content.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g)];
  let first=paragraphs.findIndex(part=>part.index!+part[0].length>start);
  let last=paragraphs.length-1;
  while(last>=0&&paragraphs[last]!.index!>=end)last--;
  if(first<0||last<first)return;
  const bounds=()=>({start:paragraphs[first]!.index!,end:paragraphs[last]!.index!+paragraphs[last]![0].length});
  const text=()=>{const range=bounds();return source.canonical_content.slice(range.start,range.end);};
  // Keep paragraph boundaries even when the semantic chunk is larger than the
  // display ceiling. The later span pass selects short sentence-safe excerpts.
  if(estimateTokens(text())>ceiling){const range=bounds();return sentenceWindow(source,start,end,range.start,range.end,ceiling);}
  if(expandAdjacent)for(const direction of [-1,1] as const){
      const next=direction<0?first-1:last+1;
      if(next<0||next>=paragraphs.length||presentationOnlySourcePassage(paragraphs[next]![0]))continue;
      const old=direction<0?first:last;
      if(direction<0)first=next;else last=next;
      if(estimateTokens(text())>ceiling){if(direction<0)first=old;else last=old;}
    }
  const range=bounds();
  // Keep the exact canonical slice. Removing presentation-only paragraphs here
  // would concatenate text and make later relative offsets point at the wrong
  // source position. The span pass skips those paragraphs while retaining
  // source coordinates for the excerpts it does select.
  const raw=text();
  const leading=raw.search(/\S/u);if(leading<0)return;
  const trimmed=raw.trimEnd();
  return {text:trimmed.slice(leading),start:range.start+leading,end:range.start+trimmed.length,contiguous:true};
}

function rangesOverlap(left:McpSourceRange,right:McpSourceRange):boolean {
  return left.messageId===right.messageId&&Math.max(left.start,right.start)<Math.min(left.end,right.end);
}

function substantiallySameRange(left:McpSourceRange,right:McpSourceRange):boolean {
  if(left.messageId!==right.messageId)return false;
  const overlap=Math.max(0,Math.min(left.end,right.end)-Math.max(left.start,right.start));
  const shorter=Math.min(left.end-left.start,right.end-right.start);
  return shorter>0&&overlap/shorter>=.8;
}

function citationMetadata(db:RcmDatabase,chatId:string,source:Source,sourceRange:McpSourceRange):McpSourceMetadata[] {
  const rows=db.prepare(`SELECT locations_json,evidence_json FROM memory_details
    WHERE chat_id=? AND active=1 AND EXISTS(
      SELECT 1 FROM json_each(evidence_json) WHERE json_extract(value,'$.messageId')=?)`)
    .all(chatId,source.message_id) as Array<{locations_json:string;evidence_json:string}>;
  const annotations=new Map<string,McpSourceMetadata>();
  for(const row of rows){
    let locations:string[];let citations:Array<{messageId?:string;quote?:string}>;
    try { locations=JSON.parse(row.locations_json||"[]");citations=JSON.parse(row.evidence_json||"[]"); } catch { continue; }
    // A list of locations is scene-level context, not a precise source label.
    // Surface it only when this directly cited detail names exactly one place.
    if(locations.length!==1||typeof locations[0]!=="string"||!locations[0].trim())continue;
    for(const citation of citations){
      if(citation.messageId!==source.message_id||!citation.quote)continue;
      const start=source.canonical_content.indexOf(citation.quote);
      if(start<0||source.canonical_content.indexOf(citation.quote,start+1)>=0)continue;
      const range={messageId:source.message_id,start,end:start+citation.quote.length};
      if(!rangesOverlap(range,sourceRange))continue;
      annotations.set(`${range.messageId}:${range.start}:${range.end}:${locations[0]}`,{sourceRange:range,location:locations[0].trim()});
    }
  }
  return [...annotations.values()];
}

/** Materializes an indexed transcript hit only while its current canonical block
 * identity and exact substring remain valid. */
function locateSourceHit(db:RcmDatabase,chatId:string,hit:SemanticSourceHit,source:(id:string)=>Source|undefined):Located[] {
  const chunk=db.prepare(`SELECT e.content,e.content_hash,e.source_json,b.content_hash AS block_hash,b.message_ids_json
    FROM embedding_items e JOIN embedding_blocks b ON b.id=e.block_id AND b.chat_id=e.chat_id
    WHERE e.chat_id=? AND e.item_id=? AND e.kind='transcript_chunk' AND b.status='indexed'`).get(chatId,hit.chunkId) as
    {content:string;content_hash:string;source_json:string;block_hash:string;message_ids_json:string}|undefined;
  if(!chunk||hash(chunk.content)!==chunk.content_hash)return [];
  const rows=(JSON.parse(chunk.message_ids_json) as string[]).map(source);
  if(rows.some(row=>!row)||hash(rows.map(row=>`${row!.message_id}\0${row!.canonical_hash}`).join("\0"))!==chunk.block_hash)return [];
  const { ranges } = JSON.parse(chunk.source_json) as { ranges: Array<McpSourceRange & { canonicalHash: string }> };
  return ranges.flatMap(range => {
    const row = rows.find(row => row?.message_id === range.messageId);
    if (!row || row.canonical_hash !== range.canonicalHash || range.start < 0 || range.end > row.canonical_content.length || range.end <= range.start) return [];
    const text = row.canonical_content.slice(range.start, range.end);
    return chunk.content.includes(`[${row.message_id}] ${row.role.toUpperCase()}:\n${text}`)
      ? [{ source: row, start: range.start, end: range.end, score: hit.score }] : [];
  });
}

/** Adds direct transcript and atom-bound source candidates. It does not decide
 * which candidate answers the question; the MCP evidence reranker does that. */
export function appendMcpSourceContext(db:RcmDatabase,chatId:string,answers:McpQuestionAnswer[],items:MemoryContextItem[],
  semantic:SemanticSearchResult[],tokenBudget:number,query:string,promptSourceMessageIds:string[]=[],bounded=false,providedSourceMessageIds:string[]=[],selectorCoverage=false,sourceMemoryIds:string[]=[],stateEvidence?:StateEvidence[]):{anchors:number;unmapped:number;windows:number;sourceCandidates:number;coherenceRemoved:number} {
  const promptSources=new Set(promptSourceMessageIds);
  const read=db.prepare(`SELECT message_id,canonical_content,canonical_hash,ordinal,role FROM messages WHERE chat_id=? AND message_id=?
    AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`);
  const cache=new Map<string,Source|undefined>();
  const windowSources=new Map<string,Source>();
  const contextWindows=new ContextWindows(windowSources);
  const source=(id:string)=>{
    if(!cache.has(id)){
      const row=read.get(chatId,id) as Source|undefined;
      cache.set(id,typeof row?.canonical_content==="string"&&row.canonical_content ? row : undefined);
      if(row?.canonical_content)windowSources.set(id,row);
    }
    return cache.get(id);
  };
  let anchors=0,unmapped=0,windows=0,sourceCandidates=0,coherenceRemoved=0;
  const evidencePositionCache=new Map<string,Located[]>();
  const positionsForEvidence=(item:MemoryContextItem,evidence:McpQuestionAnswer["evidence"][number]):Located[]=>{
    const cacheKey=`${item.id}\0${evidence.atomKey}`;
    const cached=evidencePositionCache.get(cacheKey);if(cached)return cached;
    const positions:Located[]=[];
    const detail=item.details.find(candidate=>memoryDetailAtomKey(candidate)===evidence.atomKey);
    if(detail){
      const row=db.prepare("SELECT evidence_json FROM memory_details WHERE chat_id=? AND id=? AND active=1").get(chatId,detail.id) as {evidence_json:string}|undefined;
      for(const citation of JSON.parse(row?.evidence_json??"[]") as Array<{messageId?:string;quote?:string}>){
        if(!citation.messageId||!citation.quote||promptSources.has(citation.messageId))continue;
        const current=source(citation.messageId);const start=current?.canonical_content.indexOf(citation.quote)??-1;
        if(current&&start>=0&&current.canonical_content.indexOf(citation.quote,start+1)<0)
          positions.push({source:current,start,end:start+citation.quote.length,score:1,memoryId:item.id});
        else unmapped++;
      }
    }
    const dialogue=item.keyDialogues.find(candidate=>memoryDialogueAtomKey(item.id,candidate)===evidence.atomKey);
    if(dialogue)for(const citation of dialogue.evidence){
      if(promptSources.has(citation.messageId))continue;
      const current=source(citation.messageId);
      if(current&&current.canonical_hash===citation.canonicalHash&&current.canonical_content.slice(citation.startOffset,citation.endOffset)===citation.quote)
        positions.push({source:current,start:citation.startOffset,end:citation.endOffset,score:1,memoryId:item.id});
      else unmapped++;
    }
    evidencePositionCache.set(cacheKey,positions);return positions;
  };
  const locatedCache=new Map<string,Located[]>();
  const materialize=(hit:SemanticSourceHit)=>{
    if(!locatedCache.has(hit.chunkId))locatedCache.set(hit.chunkId,locateSourceHit(db,chatId,hit,source));
    return locatedCache.get(hit.chunkId)!.map(position=>({...position,score:hit.score}));
  };
  const ceiling=Math.min(520,Math.max(140,Math.floor(tokenBudget/Math.max(3,answers.length*2))));
  const fullHits=[...(semantic[0]?.sourceHits??[])].filter(hit=>hit.score>=.35).sort((a,b)=>b.score-a.score);

  // Parent summaries are discovery hints, never answer evidence or access grants.
  // This function runs only for authorial archive reads. Follow the independently
  // ranked scene's cited messages before the atom shortlist can hide its source.
  // A parent citation may anchor the opening rather than the requested detail.
  // Restore separate canonical windows throughout that message; proximity does
  // not grant the parent's date, place or character knowledge to those windows.
  const sceneSources: McpQuestionAnswer["evidence"] = [];
  for (const memoryId of bounded ? [] : sourceMemoryIds) {
    if (!items.some(item => item.id === memoryId)) continue;
    const parent = db.prepare("SELECT evidence_json FROM memories WHERE chat_id=? AND id=? AND active=1")
      .get(chatId, memoryId) as { evidence_json: string } | undefined;
    if (!parent) continue;
    const visited = new Set<string>();
    for (const citation of JSON.parse(parent.evidence_json) as Array<{messageId?:string;quote?:string}>) {
      if (!citation.messageId || visited.has(citation.messageId) || promptSources.has(citation.messageId)) continue;
      const current = source(citation.messageId);
      if (!current || (citation.quote && !current.canonical_content.includes(citation.quote))) continue;
      visited.add(citation.messageId);
      for (const block of contextWindows.blocks(current)) {
        const window = contextWindows.around({ messageId: citation.messageId, canonicalHash: current.canonical_hash,
          quote: block.text, startOffset: block.start, endOffset: block.end }, 512);
        if (!window) continue;
        const range = { messageId: citation.messageId, start: window.provenance.start, end: window.provenance.end };
        if (sceneSources.some(e => e.sourceRange && substantiallySameRange(e.sourceRange, range))) continue;
        sceneSources.push({ atomKey: memoryAtomKey("source", hash(citation.messageId + window.provenance.canonicalHash + window.text), window.text),
          bundleKey: `scene-source:${memoryId}:${citation.messageId}:${range.start}`, memoryId, kind: "quote", text: window.text,
          knownBy: [], basis: "parent record context", sourceRange: range });
      }
    }
  }

  answers.forEach((answer,index)=>{
    answer.evidence.push(...sceneSources.filter(candidate => !answer.evidence.some(e => e.atomKey === candidate.atomKey)));
    windows += sceneSources.length;
    let boundedWindows=0;
    const view=semantic[answers.length>1?index+1:0]??semantic[0];
    const focusHits=[...(view?.sourceHits??[])].filter(hit=>hit.score>=.35).sort((a,b)=>b.score-a.score);
    const fullPosition=new Map(fullHits.map((hit,rank)=>[hit.chunkId,rank]));
    const focusPosition=new Map(focusHits.map((hit,rank)=>[hit.chunkId,rank]));
    const pool=[...new Map([...focusHits.slice(0,16),...fullHits.slice(0,24)].map(hit=>[hit.chunkId,hit])).values()];
    const located=pool.flatMap(hit=>materialize(hit).map(position=>({position,hit})))
      .filter(({position})=>!promptSources.has(position.source.message_id));
    sourceCandidates+=located.length;
    const passages=located.map(({position})=>{
      const restored=contextWindows.around({messageId:position.source.message_id,canonicalHash:position.source.canonical_hash,
        startOffset:position.start,endOffset:position.end,quote:position.source.canonical_content.slice(position.start,position.end)},512);
      return restored ? {text:restored.text,start:restored.provenance.start,end:restored.provenance.end,contiguous:true} : undefined;
    });
    const texts=passages.map(passage=>passage?.text??"");
    const focusRank=evidenceRanker(answer.question,texts);
    const fullRank=evidenceRanker(query,texts);
    const ranked=located.map((candidate,candidateIndex)=>{
      const text=texts[candidateIndex]!;
      const focusIndex=focusPosition.get(candidate.hit.chunkId);
      const fullIndex=fullPosition.get(candidate.hit.chunkId);
      const score=focusRank(text)*.5+fullRank(text)*.2
        +(focusIndex===undefined?0:.2/(focusIndex+1))+(fullIndex===undefined?0:.1/(fullIndex+1))+candidate.hit.score*.08;
      return {...candidate,passage:passages[candidateIndex],text,score};
    }).filter(candidate=>candidate.text).sort((a,b)=>b.score-a.score||b.hit.score-a.hit.score);
    for(const candidate of ranked){
      const position=candidate.position;
      const hitText=position.source.canonical_content.slice(position.start,position.end);
      if(answer.evidence.some(evidence=>evidence.text.includes(hitText)||hitText.includes(evidence.text)))continue;
      const sourceItems=items.filter(item=>item.evidenceMessageIds.includes(position.source.message_id));
      const relatedItem=sourceItems.find(item=>answer.evidence.some(evidence=>evidence.memoryId===item.id))??sourceItems[0];
      const relatedEvidence=relatedItem&&answer.evidence.find(evidence=>evidence.memoryId===relatedItem.id);
      const sourceRange=candidate.passage?.contiguous?{messageId:position.source.message_id,start:candidate.passage.start,end:candidate.passage.end}:undefined;
      const hitRange={messageId:position.source.message_id,start:position.start,end:position.end};
      // A display window may include adjacent paragraphs. Bind the source to
      // an atom only when the semantic hit itself overlaps that atom's exact
      // evidence, never because nearby text entered the display window.
      const bound=Boolean(relatedItem&&relatedEvidence&&positionsForEvidence(relatedItem,relatedEvidence)
        .some(anchor=>rangesOverlap({messageId:anchor.source.message_id,start:anchor.start,end:anchor.end},hitRange)));
      const key=bound?relatedEvidence!.bundleKey??relatedEvidence!.atomKey:`source:${position.source.message_id}:${position.start}`;
      // Different source hit ranges retain their own opportunity even when
      // they refer to the same memory or canonical message.
      answer.evidence.push({atomKey:memoryAtomKey("source",hash(position.source.message_id+position.source.canonical_hash+candidate.text),candidate.text),
        bundleKey:key,memoryId:bound?relatedItem?.id:undefined,kind:"quote",text:candidate.text,knownBy:[],basis:"archive context",
        context:bound?relatedItem?.title:undefined,sourceRange,
        sourceMetadata:sourceRange?citationMetadata(db,chatId,position.source,sourceRange):undefined});
      windows++;
    }

    for(const evidence of [...answer.evidence]){
      if(evidence.kind==="quote"&&evidence.basis==="archive context")continue;
      const item=items.find(candidate=>candidate.id===evidence.memoryId);
      if(!item)continue;
      const positions=positionsForEvidence(item,evidence);
      anchors+=positions.length;
      const positionRank=bounded?evidenceRanker(answer.question,positions.map(position=>position.source.canonical_content.slice(position.start,position.end))):undefined;
      const selectedPositions=bounded?[...positions].sort((left,right)=>positionRank!(right.source.canonical_content.slice(right.start,right.end))-positionRank!(left.source.canonical_content.slice(left.start,left.end))).slice(0,2):positions;
      for(const position of selectedPositions){
      if(bounded&&boundedWindows>=10)break;
      if(bounded&&answer.evidence.some(old=>old.kind==="quote"&&old.sourceRange?.messageId===position.source.message_id
        &&old.sourceRange.start<=position.start&&old.sourceRange.end>=position.end))continue;
      // Restore whole paragraphs around the verified anchor. Neighboring prose
      // is archive context, never an extension of the atom's character access.
      const window=bounded?contextWindows.around({messageId:position.source.message_id,
        canonicalHash:position.source.canonical_hash,startOffset:position.start,endOffset:position.end,
        quote:position.source.canonical_content.slice(position.start,position.end)},Math.min(512,ceiling)):undefined;
      const passage=bounded?(window?{text:window.text,start:window.provenance.start,end:window.provenance.end,contiguous:true}:undefined)
        :paragraphsAround(position.source,position.start,position.end,ceiling,true);const text=passage?.text;
      if(!passage||!text||text===evidence.text||answer.evidence.some(old=>old.text.includes(text)))continue;
      const key=evidence.bundleKey??evidence.atomKey;evidence.bundleKey=key;
      const sourceRange=passage.contiguous?{messageId:position.source.message_id,start:passage.start,end:passage.end}:undefined;
      answer.evidence.push({atomKey:memoryAtomKey("source",hash(position.source.message_id+position.source.canonical_hash+text),text),bundleKey:key,
        memoryId:item.id,kind:"quote",text,knownBy:[],basis:"archive context",
        context:item.title,sourceRange,
        sourceMetadata:sourceRange?citationMetadata(db,chatId,position.source,sourceRange):undefined});
      windows++;
      if(bounded)boundedWindows++;
      }
    }
  });
  if(!bounded){
    // Earlier prompt messages may contain the requested history. Discover
    // their exact paragraphs before restoration, rather than treating the
    // whole message as one event or excluding all already-provided sources.
    const blocks=[...new Set(providedSourceMessageIds)].filter(id=>!promptSources.has(id)).flatMap(id=>{
      const row=source(id);return row?contextWindows.blocks(row).map(block=>({row,block})):[];
    });
    const rank=evidenceRanker(query,blocks.map(({block})=>block.text));
    const ranked=blocks.map(entry=>({...entry,score:rank(entry.block.text)})).filter(entry=>entry.score>0)
      .sort((a,b)=>b.score-a.score);
    const chosen=ranked.slice(0,24);
    if(selectorCoverage)for(const id of new Set(ranked.map(entry=>entry.row.message_id))){
      const group=ranked.filter(entry=>entry.row.message_id===id);
      for(let bin=0;bin<4;bin++){
        const best=group.find(entry=>Math.min(3,Math.floor(entry.block.start/entry.row.canonical_content.length*4))===bin);
        if(best&&!chosen.includes(best))chosen.push(best);
      }
    }
    for(const answer of answers){
      for(const {row,block} of chosen){
        const window=contextWindows.around({messageId:row.message_id,canonicalHash:row.canonical_hash,startOffset:block.start,endOffset:block.end,quote:block.text},512);
        if(!window)continue;
        const range={messageId:row.message_id,start:window.provenance.start,end:window.provenance.end};
        if(answer.evidence.some(item=>item.sourceRange&&(selectorCoverage ? item.sourceRange.messageId===range.messageId&&item.sourceRange.start<=range.start&&item.sourceRange.end>=range.end : substantiallySameRange(item.sourceRange,range))))continue;
        answer.evidence.push({atomKey:memoryAtomKey("source",hash(window.id),window.text),bundleKey:`provided-source:${window.id}`,kind:"quote",text:window.text,knownBy:[],basis:"archive context",sourceRange:range});
        windows++;
      }
    }
    const states=new Map((stateEvidence??collectStateEvidence(db,chatId)).map(state=>[stateMcpEvidence(state).atomKey,state]));
    for(const answer of answers)for(const evidence of [...answer.evidence]){
      const state=states.get(evidence.atomKey);if(!state)continue;
      const restored=state.citations.flatMap(citation=>{
        if(promptSources.has(citation.messageId)||!source(citation.messageId))return[];
        const window=contextWindows.around(citation,512);return window?[window]:[];
      });
      const rank=evidenceRanker(state.text,restored.map(window=>window.text));
      const best=restored.sort((a,b)=>rank(b.text)-rank(a.text))[0];if(!best)continue;
      const key=`state-context:${evidence.atomKey}`;evidence.bundleKey=key;
      answer.evidence.push({atomKey:memoryAtomKey("source",hash(best.id),best.text),bundleKey:key,
        kind:"quote",text:best.text,knownBy:[],basis:state.citationScope==="atom"?"cited source context":"parent record context",
        sourceRange:{messageId:best.provenance.messageId,start:best.provenance.start,end:best.provenance.end}});
      windows++;
    }
  }
  return {anchors,unmapped,windows,sourceCandidates,coherenceRemoved};
}

/** Adds exact canonical windows from messages that the main model can already
 * see. These candidates are judged with the same source-span gate as archived
 * evidence, then moved to alreadyProvidedEvidence. They never become a new
 * delivery, reinforcement, or access grant. */
export function appendMcpProvidedSourceContext(db:RcmDatabase,chatId:string,answers:McpQuestionAnswer[],
  promptSourceMessageIds:string[],tokenBudget:number,query:string,currentMessageId?:string):McpProvidedSourceDiagnostic {
  if(!answers.length||!promptSourceMessageIds.length)return {sources:0,windows:0,candidates:0};
  const read=db.prepare(`SELECT message_id,canonical_content,canonical_hash,ordinal,role FROM messages WHERE chat_id=? AND message_id=?
    AND lifecycle IN ('committed','client_pruned') AND host_visibility IN ('active','all_before')`);
  const promptSources=[...new Set(promptSourceMessageIds)].filter(id=>id!==currentMessageId).flatMap(id=>{
    const row=read.get(chatId,id) as Source|undefined;
    return typeof row?.canonical_content==="string"&&row.canonical_content.trim()?[row]:[];
  }).sort((left,right)=>left.ordinal-right.ordinal);
  const sources=promptSources.filter(source=>source.role!=="user");
  const precedingContext=new Map(sources.flatMap(source=>{
    const prior=[...promptSources].reverse().find(candidate=>candidate.ordinal<source.ordinal);
    if(!prior)return[];
    const text=prior.canonical_content.slice(-600).trim();
    return text?[[source.message_id,text] as const]:[];
  }));
  const ceiling=Math.min(520,Math.max(320,Math.floor(tokenBudget/Math.max(3,answers.length*2))));
  const windows=[...new Map(sources.flatMap(source=>{
    const paragraphs=[...source.canonical_content.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g)];
    return paragraphs.flatMap(paragraph=>{
      if(presentationOnlySourcePassage(paragraph[0]))return [];
      const start=paragraph.index!;const end=start+paragraph[0].length;
      const passage=paragraphsAround(source,start,end,ceiling);
      return passage&&!presentationOnlySourcePassage(passage.text)
        ?[[`${source.message_id}:${passage.start}:${passage.end}`,{source,passage}] as const]:[];
    });
  })).values()];
  let candidates=0;
  for(const answer of answers){
    const texts=windows.map(window=>window.passage.text);
    const facetRank=evidenceRanker(answer.question,texts);
    const limit=64;
    // API68 facets are self-contained atomic questions. Candidate discovery
    // must therefore remain stable when unrelated sibling facets are added to
    // or removed from the overall request.
    const ordered=windows.map((window,index)=>({window,score:facetRank(texts[index]!) }))
      .sort((left,right)=>right.score-left.score||right.window.source.ordinal-left.window.source.ordinal);
    // Adjacent paragraphs from one long prompt message often expand into many
    // heavily overlapping windows. Do not let those duplicates consume every
    // recall slot and hide a later, directly answering passage in the same
    // message. This is diversity only; the semantic verifier below remains the
    // sole evidence-acceptance decision.
    const ranked:typeof ordered=[];
    const add=(candidate:typeof ordered[number])=>{
      const range={messageId:candidate.window.source.message_id,start:candidate.window.passage.start,end:candidate.window.passage.end};
      if(ranked.some(current=>substantiallySameRange(range,{messageId:current.window.source.message_id,
        start:current.window.passage.start,end:current.window.passage.end})))return;
      ranked.push(candidate);
    };
    // Reserve positional coverage in every visible assistant message before
    // filling by global score. This keeps a long message or another turn from
    // hiding a short pronoun-heavy answer whose own terms rank weakly.
    const bySource=new Map<string,typeof ordered>();
    for(const candidate of ordered){
      const id=candidate.window.source.message_id;
      const group=bySource.get(id)??[];group.push(candidate);bySource.set(id,group);
    }
    for(const group of bySource.values()){
      for(const fraction of [0,.2,.4,.6,.8,1]){
        if(ranked.length>=limit)break;
        const target=(group[0]!.window.source.canonical_content.length-1)*fraction;
        const candidate=[...group].sort((left,right)=>
          Math.abs(left.window.passage.start-target)-Math.abs(right.window.passage.start-target))[0]!;
        add(candidate);
      }
    }
    for(const candidate of ordered){
      if(ranked.length>=limit)break;
      add(candidate);
    }
    for(const {window:{source,passage}} of ranked){
      const sourceRange={messageId:source.message_id,start:passage.start,end:passage.end};
      const identity=`${source.message_id}:${source.canonical_hash}:${passage.start}:${passage.end}`;
      answer.evidence.push({atomKey:memoryAtomKey("source",hash(identity),passage.text),
        bundleKey:`provided-source:${source.message_id}:${passage.start}`,kind:"quote",text:passage.text,knownBy:[],
        basis:"current prompt context",context:[`Source role: ${source.role}`,precedingContext.get(source.message_id)
          &&`Immediately preceding prompt context (not evidence; use only to resolve what a reply refers to): ${precedingContext.get(source.message_id)}`]
          .filter(Boolean).join("\n"),sourceRange});
      candidates++;
    }
  }
  return {sources:sources.length,windows:windows.length,candidates};
}
