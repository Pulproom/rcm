import { estimateTokens, estimateTokenUnits, normalizeSearchTokens, type ExtractionDraftResult } from '@rcm/shared';
import type { RcmDatabase } from './db.js';

// Large prior inputs degrade the auxiliary model; raising the user's cap must not grow them.
export const STATE_PRIOR_CONTEXT_TOKENS = 24_000;
const shares = {priorLedger:12_000,priorSeeds:4_000,recognition:3_000,relationships:2_000,pairProgress:1_000,existingMemories:2_000};
type Component = keyof typeof shares;
const components = Object.keys(shares) as Component[];
type Row = Record<string, any>;
type Context = Record<string, any>;

export const statePromptTokens = (systemPrompt:string, context:Context) => estimateTokens(JSON.stringify([
  {role:'system',content:systemPrompt},{role:'user',content:JSON.stringify(context)},
]));

export function emptyStatePrior(context:Context):Context {
  const empty={...context};
  for(const key of components) if(key in context) empty[key]=[];
  return empty;
}

/** Marginal wire costs include JSON escaping and sum exactly to the complete envelope. */
export function stateContextMeasurement(systemPrompt:string, context:Context) {
  const measured=emptyStatePrior(context);
  let units=estimateTokenUnits(JSON.stringify([{role:'system',content:systemPrompt},{role:'user',content:JSON.stringify(measured)}]));
  const requiredTokens=Math.ceil(units/42);
  let previous=requiredTokens;
  const prior={} as Record<Component,{tokens:number;count:number}>;
  for(const key of components) {
    // Replace the empty array's escaped content, preserving the actual envelope's order.
    if(key in context)units+=estimateTokenUnits(JSON.stringify(JSON.stringify(context[key])).slice(1,-1))-estimateTokenUnits('[]');
    const total=Math.ceil(units/42);
    prior[key]={tokens:total-previous,count:context[key]?.length ?? 0}; previous=total;
  }
  const required={system:estimateTokens(systemPrompt),sources:estimateTokens(JSON.stringify(context.sources)),
    eventDraft:estimateTokens(JSON.stringify(context.eventDraft)),userNote:context.userNote ? estimateTokens(JSON.stringify(context.userNote)):0};
  return {requiredTokens,priorTokens:previous-requiredTokens,totalTokens:previous,prior,
    required:{...required,serialization:requiredTokens-Object.values(required).reduce((sum,n)=>sum+n,0)}};
}

const parseArray=(value:unknown):Row[]=>{try{const parsed=typeof value==='string'?JSON.parse(value):value;return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const evidenceIds=(row:Row):string[]=>[...parseArray(row.evidence_json),...parseArray(row.evidence),...parseArray(row.automatic_closure_evidence_json)].flatMap(e=>typeof e.messageId==='string'?[e.messageId]:[]);
const textOf=(row:Row):string=>[row.subject,row.holder,row.promisor,row.promisee,row.from_entity,row.to_entity,row.persona,row.character,
  row.predicate,row.promise_key,row.value,row.content,row.text,row.summary,row.label,row.title,...(row.knownAs ?? []),...(row.cognition ?? []).map((r:Row)=>r.text)].filter(v=>typeof v==='string').join(' ');

/** Ranking is provenance and lexical retrieval, never a local interpretation of RP prose. */
export function selectStatePrior(db:RcmDatabase,chatId:string,context:Context,systemPrompt:string,budget:number,sourceIds:string[],draft:ExtractionDraftResult,jobId?:string):Context {
  const selected=emptyStatePrior(context), sourceSet=new Set(sourceIds);
  const memories=db.prepare('SELECT id,memory_key,evidence_json FROM memories WHERE chat_id=? AND active=1').all(chatId) as Row[];
  const linked=new Set<string>([...draft.memories.map(m=>m.key),...(draft.memoryRecallObservations ?? []).map(o=>o.memoryId)]);
  for(const relation of draft.atomRelations ?? []) for(const ref of [relation.source,relation.target]) if('memoryKey' in ref) linked.add(ref.memoryKey);
  if(jobId){
    const payload=JSON.parse((db.prepare('SELECT payload_json FROM jobs WHERE id=? AND chat_id=?').get(jobId,chatId) as {payload_json:string}|undefined)?.payload_json ?? '{}');
    const refs=new Set((draft.atomRelations ?? []).flatMap(r=>'atomRef' in r.target?[r.target.atomRef]:[]));
    for(const ref of payload.recallAtomRefs ?? []) if(refs.has(ref.atomRef)&&ref.detailId) linked.add(ref.detailId);
  }
  for(const memory of memories) if(linked.has(memory.id)||linked.has(memory.memory_key)||evidenceIds(memory).some(id=>sourceSet.has(id))) {linked.add(memory.id);linked.add(memory.memory_key);}
  const details=db.prepare('SELECT id,memory_id,source_end_ordinal FROM memory_details WHERE chat_id=? AND active=1').all(chatId) as Row[];
  const detailRows=new Map(details.map(row=>[row.id,row]));
  for(const detail of details) if(linked.has(detail.memory_id)) linked.add(detail.id);
  const relationships=new Map((db.prepare('SELECT * FROM relationship_projections WHERE chat_id=?').all(chatId) as Row[]).map(r=>[JSON.stringify([r.from_entity,r.to_entity]),r]));
  const sourceText=JSON.stringify(context.sources).toLocaleLowerCase();
  const names=new Set([...draft.entities.map(e=>e.name),...draft.memories.flatMap(m=>[...m.participants,...(m.details ?? []).flatMap(d=>d.participants ?? [])])].map(n=>n.toLocaleLowerCase()));
  for(const row of db.prepare('SELECT e.name,a.alias FROM entities e LEFT JOIN aliases a ON a.entity_id=e.id WHERE e.chat_id=?').all(chatId) as Row[])
    if([row.name,row.alias].some(n=>n&&n.length>1&&sourceText.includes(n.toLocaleLowerCase()))) names.add(row.name.toLocaleLowerCase());
  const query=new Set(normalizeSearchTokens(context.sources.map((s:Row)=>s.units.map((u:Row)=>u.text).join(' ')).join(' '),draft.language));
  const propertyQuery=new Set([...query,...normalizeSearchTokens(JSON.stringify(context.eventDraft),draft.language)]);
  const ranked=components.flatMap(key=>((context[key] ?? []) as Row[]).map((item,index)=>{
    const row=item.value && typeof item.value==='object'?item.value:item;
    const metadata=key==='priorSeeds'?detailRows.get(item.detailId):key==='relationships'?relationships.get(JSON.stringify([row.from_entity,row.to_entity])):row;
    const text=textOf(row), identities:string[]=([row.subject,row.holder,row.promisor,row.promisee,row.from_entity,row.to_entity,row.persona,row.character,...(row.seed?.noticedBy ?? [])] as unknown[]).filter((n):n is string=>typeof n==='string').map(n=>n.toLocaleLowerCase());
    const direct=evidenceIds(row).some(id=>sourceSet.has(id))||[item.id,item.detailId,row.source_memory_id,row.memory_id,row.key].some(id=>id&&linked.has(id));
    // This is lexical candidate retrieval, not a semantic duplicate/transition verdict.
    const subject=row.subject ?? row.promisor;
    const propertyTokens=normalizeSearchTokens(String(row.predicate ?? row.promise_key ?? ''),draft.language);
    const propertyMatch=key==='priorLedger'&&typeof subject==='string'&&sourceText.includes(subject.toLocaleLowerCase())
      &&propertyTokens.length>0&&propertyTokens.every(token=>propertyQuery.has(token));
    return {key,item,index,text,tokens:new Set(normalizeSearchTokens(text,draft.language)),identities,direct,propertyMatch,
      recency:Number(metadata?.source_end_ordinal ?? metadata?.valid_from_ordinal ?? metadata?.updated_revision ?? metadata?.created_revision ?? row.updatedAt ?? metadata?.updated_at ?? metadata?.created_at ?? 0),
      closed:key==='priorLedger'&&item.kind==='promise_event'&&!['open','offscreen'].includes(row.status)};
  }));
  const frequency=new Map<string,number>(),entityFrequency=new Map<string,number>();
  for(const row of ranked){for(const token of row.tokens)frequency.set(token,(frequency.get(token)??0)+1);for(const name of new Set(row.identities))entityFrequency.set(name,(entityFrequency.get(name)??0)+1);}
  const score=(row:typeof ranked[number])=>[...row.tokens].reduce((sum,t)=>sum+(query.has(t)?1/(frequency.get(t)??1):0),0)
    + [...new Set(row.identities)].reduce((sum,n)=>sum+(names.has(n)?1/(entityFrequency.get(n)??1):0),0);
  const scores=new Map(ranked.map(r=>[r,score(r)]));
  ranked.sort((a,b)=>Number(b.direct)-Number(a.direct)||Number(b.propertyMatch)-Number(a.propertyMatch)||(scores.get(b)!-scores.get(a)!)||Number(a.closed)-Number(b.closed)||b.recency-a.recency||a.index-b.index);
  const required=statePromptTokens(systemPrompt,selected),used=new Map<Component,number>();
  let total=required;
  const rowCosts=new WeakMap<Row,number>();
  const accepted=new Set<typeof ranked[number]>();
  const add=(entry:typeof ranked[number],limit:number)=>{
    if(accepted.has(entry)||entry.key==='priorSeeds'&&(selected.priorSeeds.length>=32||!entry.direct&&!scores.get(entry)))return;
    const before=total, list=selected[entry.key] as Row[];
    const fits=(item:Row)=>{
      // Ceil each escaped row separately: a conservative additive wire cost, including
      // its possible comma. At most one token of rounding slack per accepted row.
      const cost=rowCosts.get(item) ?? estimateTokens(JSON.stringify(JSON.stringify(item)).slice(1,-1)+',');
      if(item===entry.item)rowCosts.set(item,cost);
      if(cost>Math.min(limit,budget-(before-required)))return false;
      return true;
    };
    let item=entry.item;
    // Addition targets retain their identity; fit whole detail/dialogue rows, never clip prose.
    if(entry.key==='existingMemories'&&!fits(item)){
      const fitted={...item,details:[],keyDialogues:[]} as Row;
      if(!fits(fitted))return;
      for(const field of ['details','keyDialogues']) for(const detail of item[field] ?? []) {fitted[field].push(detail);if(!fits(fitted))fitted[field].pop();}
      item=fitted;
    }
    if(!fits(item))return;
    list.push(item);accepted.add(entry);
    total+=rowCosts.get(item) ?? estimateTokens(JSON.stringify(JSON.stringify(item)).slice(1,-1)+',');
    used.set(entry.key,(used.get(entry.key)??0)+total-before);
  };
  const shareTotal=Object.values(shares).reduce((a,b)=>a+b,0);
  for(const row of ranked)add(row,Math.max(0,budget*shares[row.key]/shareTotal-(used.get(row.key)??0)));
  for(const row of ranked)add(row,budget);
  // The complete envelope is authoritative; the additive bound must never undercount.
  if(statePromptTokens(systemPrompt,selected)-required>budget)throw new Error('State prior wire budget exceeded');
  return selected;
}
