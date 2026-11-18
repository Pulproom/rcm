import { NARRATOR_ARCHIVE_HOLDER, publicKnowledgeScope } from "./item-access.js";
import { createHash } from "node:crypto";
import { estimateTokenUnits, estimateTokens, estimateTokensFromUnits, type McpEvidence, type McpQuestionAnswer } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { evidenceRanker } from "./mcp-evidence.js";
import { selectorInput, selectorSystemPrompt, type SelectorCandidate } from "./mcp-selector.js";

/** Canonical mutations during the asynchronous selector invalidate the whole
 * prepared result, including its local fallback. Activity/ref writes do not. */
export function mcpEvidenceVersion(db:RcmDatabase,chatId:string):string {
  const hash=createHash("sha256");
  hash.update(JSON.stringify(db.prepare("SELECT revision FROM chats WHERE id=?").get(chatId)));
  hash.update(JSON.stringify(db.prepare("SELECT message_id,canonical_hash,ordinal,lifecycle,host_visibility FROM messages WHERE chat_id=? ORDER BY message_id").all(chatId)));
  for(const table of ["memories","memory_details","memory_dialogues","item_access","assertions","beliefs","promises","promise_events","relationship_baselines","relationship_events","relationship_projections","social_knowledge_events","physical_intimacy_milestones"])
    hash.update(JSON.stringify(db.prepare(`SELECT * FROM ${table} WHERE chat_id=? ORDER BY rowid`).all(chatId)));
  return hash.digest("hex");
}

export function selectorBundles(db:RcmDatabase,chatId:string,query:string,answers:McpQuestionAnswer[],maxInputTokens:number) {
  const groups=new Map<string,McpEvidence[]>();
  for(const answer of answers)for(const evidence of answer.evidence){
    const key=evidence.bundleKey??evidence.atomKey;
    const group=groups.get(key)??[];if(!group.some(e=>e.atomKey===evidence.atomKey))group.push(evidence);groups.set(key,group);
  }
  const sourceOrderStarted=performance.now();
  const orders=new Map((db.prepare("SELECT message_id,ordinal FROM messages WHERE chat_id=?").all(chatId) as Array<{message_id:string;ordinal:number}>).map(row=>[row.message_id,row.ordinal]));
  const sourceOrderReadMs=performance.now()-sourceOrderStarted;
  const entries=[...groups.values()].map(evidence=>{
    const parts=evidence.map(e=>{
      const scope=e.knownBy || e.knownByEveryone ? publicKnowledgeScope(e.knownBy??[], e.knownByEveryone) : undefined;
      // Empty card-atom access means narration only. State rows require the
      // explicit sentinel; raw-source narration never establishes who knew it.
      const noCharacterKnows=Boolean(!scope?.knownByEveryone && !scope?.knownBy.length
        && (e.knownBy?.includes(NARRATOR_ARCHIVE_HOLDER) || e.knownBy?.length===0 && !e.atomKey.startsWith("state:") && e.kind!=="quote"));
      return {kind:e.kind,text:e.text,speaker:e.speaker,knowledge:scope?.knownBy,everyone:scope?.knownByEveryone,basis:e.basis,
        ...(noCharacterKnows ? {noCharacterKnows:true} : {}),...(e.hiddenFrom?.length ? {secretFrom:e.hiddenFrom} : {}),
        time:e.time,record:e.context,sourceOrder:e.sourceRange?orders.get(e.sourceRange.messageId):undefined};
    });
    const text=JSON.stringify(parts);
    // Enrich the selector input without changing the existing local rank text.
    return {evidence,text,parts:parts.map((value,index)=>({key:evidence[index]!.atomKey,value:{...value,
      knowledge:value.noCharacterKnows ? [] : evidence[index]!.knownByLabels ? publicKnowledgeScope(evidence[index]!.knownByLabels!,value.everyone).knownBy : value.knowledge,
      place:evidence[index]!.location}})),source:evidence.find(e=>e.sourceRange)?.sourceRange,lane:evidence.some(e=>e.atomKey.startsWith("state:"))?0:evidence.some(e=>e.kind!=="quote")?1:evidence.some(e=>e.bundleKey?.startsWith("scene-source:"))?2:3};
  });
  // Scene sources already carry the parent search ranking. Re-ranking their
  // prose by query-language overlap would discard cross-language scene hits.
  // Walk their canonical windows in order alongside the other evidence lanes.
  const sceneSources=entries.filter(e=>e.lane===2);
  const rank=evidenceRanker(query,entries.map(e=>e.text));
  entries.sort((a,b)=>rank(b.text)-rank(a.text));
  const lanes=[0,1,2,3].map(lane=>entries.filter(e=>e.lane===lane));
  lanes[2]=sceneSources;
  // Reserve strongest evidence from distinct positions of each source, not
  // just repeatedly overlapping windows at its beginning. This is coverage,
  // never a local semantic answer/sufficiency decision.
  const positional:typeof entries=[];
  const bySource=new Map<string,typeof entries>();
  for(const e of lanes[3]!)if(e.source){const group=bySource.get(e.source.messageId)??[];group.push(e);bySource.set(e.source.messageId,group);}
  for(const group of bySource.values()){
    const end=Math.max(...group.map(e=>e.source!.end));
    for(let bin=0;bin<4;bin++){const best=group.find(e=>Math.min(3,Math.floor(e.source!.start/Math.max(1,end)*4))===bin);if(best)positional.push(best);}
  }
  // Keep the positional alternatives of a leading source together. Globally
  // sorting these windows again would erase that coverage and leave only one
  // highly similar passage from each of many less useful messages.
  lanes[3]=[...new Set([...positional,...lanes[3]!])];
  const candidates:SelectorCandidate[]=[],manifest=new Map<string,McpEvidence[]>(),seen=new Set<string>();
  const ceiling=Math.max(0,maxInputTokens-512); // Reserve the bounded format-correction instruction.
  const wire = (content:string) => JSON.stringify([{role:"system",content:selectorSystemPrompt},{role:"user",content}]);
  let legacyUnits = estimateTokenUnits(wire(JSON.stringify({query,candidates:[]})));
  const separatorUnits = estimateTokenUnits(",");
  for(let index=0;index<Math.max(...lanes.map(lane=>lane.length));index++)for(const lane of lanes){
    const entry=lane[index];if(!entry)continue;
    const contentKey=createHash("sha256").update(entry.text).digest("hex");if(seen.has(contentKey))continue;
    // Keep the existing candidate allowance: compaction must save input, not
    // silently refill the request. Each JSON array entry is escaped once more
    // as message content. Its exact units add to the unchanged wire envelope.
    const legacyCandidate={id:`b${candidates.length+1}`,text:entry.text};
    const legacyEntry=JSON.stringify(JSON.stringify(legacyCandidate)).slice(1,-1);
    const nextUnits=legacyUnits+estimateTokenUnits(legacyEntry)+(candidates.length ? separatorUnits : 0);
    if(estimateTokensFromUnits(nextUnits)>ceiling)continue;
    const candidate={...legacyCandidate,parts:entry.parts};
    if(estimateTokens(wire(selectorInput(query,[...candidates,candidate])))>ceiling)continue;
    legacyUnits=nextUnits;
    seen.add(contentKey);candidates.push(candidate);manifest.set(candidate.id,entry.evidence);
  }
  return {candidates,manifest,sourceOrderReadMs};
}
