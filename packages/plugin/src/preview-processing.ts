// Preview-only adapter. Recorded ranges stay unknown unless present in the
// recording; the synthetic scenario supplies its own explicit planned batches.
import {operationLabel,settingsFailureMessage,processingRunId,processingStageOrder,sumProcessingTotals,type ProcessingCall,type ProcessingHistory,type ProcessingJob,type ProcessingModel,type ProcessingTotals,type ProcessingUnit} from '@rcm/shared';
const sum=(calls:ProcessingCall[]):ProcessingTotals=>({...sumProcessingTotals(calls.map(c=>({calls:1,input:c.input,output:c.output,duration:c.duration,missingTokens:c.input===null||c.output===null?1:0}))),calls:calls.length});
export function previewProcessingHistory(raw:any[],chatId='demo',scope:'chat'|'all'='chat',sample=false,messages:any[]=[]):ProcessingHistory {
  if(sample){
    const at=Date.now(),runId=raw.map(j=>processingRunId(JSON.parse(j.payload_json??'{}'))).find(Boolean)??'preview-run';
    raw=raw.filter(j=>!processingRunId(JSON.parse(j.payload_json??'{}')));
    const diagnostics=(purpose:string,attempt:number,at:number,outcome='succeeded',repairReason?:string)=>[
      {purpose,attempt,outcome:'started',at,repairReason},{purpose,attempt,outcome,at:at+5000,usage:{promptTokens:24000,completionTokens:7000},repairReason}];
    for(let i=0;i<21;i++)raw.push({id:`preview-batch-${i}`,type:'extract',status:i<18?'done':i===18?'leased':'queued',attempts:i===10?3:1,created_at:at-4_000_000+i*10000,updated_at:at-3_900_000+i*10000,payload_json:JSON.stringify({backfillRunId:runId,startOrdinal:i*12,endOrdinal:Math.min(249,i*12+11),operationStageOrdinal:i+1,operationStageTotal:21,llmCallDiagnostics:i<18?[
      ...diagnostics('extraction',1,at-4_000_000+i*10000),
      ...(i===9?diagnostics('extraction_repair',1,at-3_994_000+i*10000,'succeeded','access'):[]),
      ...(i===10?[...diagnostics('reconciliation',1,at-3_994_000+i*10000,'failed'),{purpose:'reconciliation',attempt:2,outcome:'started',at:at-3_988_000+i*10000},...diagnostics('reconciliation',3,at-3_982_000+i*10000)]:diagnostics('reconciliation',1,at-3_994_000+i*10000))]:[]})});
    raw.push({id:'preview-story',type:'story_consolidation',status:'done',attempts:1,updated_at:at-3_000_000,payload_json:JSON.stringify({backfillRunId:runId,startOrdinal:0,endOrdinal:215,operationStageOrdinal:12,llmCallDiagnostics:diagnostics('story_consolidation',1,at-3_010_000)})},
      {id:'preview-recent-work',type:'extract',status:'done',attempts:1,updated_at:at-7000,payload_json:JSON.stringify({startOrdinal:250,endOrdinal:261,sourceTurnCount:6,llmCallDiagnostics:[...diagnostics('extraction',1,at-52000),...diagnostics('reconciliation',1,at-22000)]})},
      {id:'preview-recent-projection',type:'relationship_projection',status:'done',attempts:1,updated_at:at,payload_json:JSON.stringify({llmCallDiagnostics:diagnostics('relationship_projection',1,at-6500)})});
  }
  const identity:ProcessingModel=sample?{site:'server',provider:'vertex',slot:null,model:'example-model-with-a-very-long-identifier-for-processing-history-wrapping-2026'}:{site:null,provider:null,slot:null,model:null};
  const jobs=raw.filter(j=>{const p=JSON.parse(j.payload_json??'{}');return !p.inheritedReview&&j.status!=='archived';}).map((j):ProcessingJob=>{
    const p=JSON.parse(j.payload_json??'{}'),calls:ProcessingCall[]=[];
    for(const d of p.llmCallDiagnostics??[]){
      if(d.outcome==='started')calls.push({...identity,id:`${j.id}-call-${calls.length}`,jobId:j.id,purpose:d.purpose,at:d.at,input:null,output:null,duration:null,outcome:'running',code:null,reason:null,repairOf:d.purpose.endsWith('_repair')?calls.at(-1)?.id??null:null,repairReason:d.repairReason,attempt:d.attempt??null,attemptOutcome:null,attemptReason:null});
      else {
        let c=calls.findLast(c=>c.purpose===d.purpose&&c.outcome==='running'&&c.attempt===(d.attempt??null));
        if(!c){c={...identity,id:`${j.id}-call-${calls.length}`,jobId:j.id,purpose:d.purpose,at:d.at,input:null,output:null,duration:null,outcome:'unknown',code:null,reason:null,repairOf:null,attempt:d.attempt??null,attemptOutcome:null,attemptReason:null};calls.push(c);}
        else c.duration=typeof d.at==='number'?Math.max(0,d.at-c.at):null;
        c.outcome=d.outcome;c.input=d.usage?.promptTokens??d.usage?.inputTokens??null;c.output=d.usage?.completionTokens??d.usage?.outputTokens??null;
        if(sample)c.attemptReason=d.outcome==='failed'?'시간 초과':null;
      }
    }
    const latest=Math.max(0,...calls.map(c=>c.attempt??0));
    for(const call of calls){
      if(call.outcome==='running'&&(j.status!=='leased'||(call.attempt??0)<latest))call.outcome='interrupted';
      call.attemptOutcome=call.attempt===latest&&j.status==='done'?'succeeded':call.outcome;
      call.attemptCount=new Set(calls.filter(c=>c.purpose===call.purpose).map(c=>c.attempt).filter(a=>a!==null)).size;
    }
    const totals=sum(calls),expected=Math.max(calls.length,p.llmCallStats?.total??0);
    if(expected>calls.length)Object.assign(totals,{calls:expected,input:totals.input??p.llmUsage?.inputTokens??null,output:totals.output??p.llmUsage?.outputTokens??null,missingTokens:(totals.missingTokens??0)+expected-calls.length});
    const source=messages.filter(m=>(p.sourceMessageIds??[]).includes(m.message_id??m.messageId));
    const ordinals=source.flatMap(m=>typeof m.ordinal==='number'?[m.ordinal]:[]);
    return {id:j.id,type:j.type,status:j.status,at:Number(j.updated_at)||Date.now(),start:p.startOrdinal??(ordinals.length?Math.min(...ordinals):null),end:p.endOrdinal??(ordinals.length?Math.max(...ordinals):null),turns:p.sourceTurnCount??(source.filter(m=>m.role==='assistant').length||null),batch:p.operationStageOrdinal??null,calls,totals,moreCalls:false,attempts:j.attempts??1,notes:[...(j.status==='failed'&&j.last_error?[settingsFailureMessage(j.last_error)]:[]),...(p.candidateStatus==='ready'?['기억 후보 준비 · 적용 대기']:[]),...(p.smallReviewCount?['후보 보류 · 추가 호출 없음']:[])],technical:p};
  });
  const groups=new Map<string,ProcessingJob[]>();
  jobs.forEach(j=>{
    const run=processingRunId(j.technical);
    const started=j.calls.length?Math.min(...j.calls.map(c=>c.at)):null;
    const preceding=j.type==='relationship_projection'&&started!==null?jobs.filter(p=>['extract','extract_episode','episode'].includes(p.type)&&p.status==='done'&&p.at<=started).sort((a,b)=>b.at-a.at)[0]:undefined;
    const parent=preceding&&!processingRunId(preceding.technical)&&started!==null&&started<=preceding.at+30_000?preceding:undefined;
    const key=run?`run:${run}`:`job:${parent?.id??j.id}`;
    if(parent)for(const call of j.calls)call.after=true;
    groups.set(key,[...(groups.get(key)??[]),j]);
  });
  const items:ProcessingUnit[]=[...groups].map(([key,group]):ProcessingUnit=>{
    const run=key.startsWith('run:'),calls=group.flatMap(j=>j.calls),purposes=[...new Set(calls.map(c=>c.purpose.endsWith('_repair')?'repair':c.purpose))].sort((a,b)=>processingStageOrder(a)-processingStageOrder(b));
    const batches=group.filter(j=>['extract','extract_episode','episode'].includes(j.type)&&j.status!=='superseded').sort((a,b)=>(a.start??Infinity)-(b.start??Infinity)||(a.batch??0)-(b.batch??0));
    const ranges=run?batches:[group.find(j=>`job:${j.id}`===key)??group[0]!],starts=ranges.flatMap(j=>j.start===null?[]:[j.start]),ends=ranges.flatMap(j=>j.end===null?[]:[j.end]);
    const repaired=batches.filter(j=>j.calls.some(c=>c.purpose.endsWith('_repair'))),rerun=batches.filter(j=>j.attempts>1),sizes=batches.flatMap(j=>j.start!==null&&j.end!==null?[j.end-j.start+1]:[]);
    return {id:key.slice(4),chatId,chatTitle:sample?'별빛 아래의 기록':'이 채팅',kind:run?'run':'job',title:run?'과거 대화 정리':group[0]!.technical.sourceRecovery?'원문 발췌 보완':group[0]!.type==='extract'?'새 대화 정리':operationLabel(group[0]!.type),at:Math.max(...group.map(j=>j.at)),start:starts.length?Math.min(...starts):null,end:ends.length?Math.max(...ends):null,batchSize:run&&sizes.length?Math.max(...sizes):null,totalBatches:batches.length,completedBatches:batches.filter(j=>j.status==='done').length,status:group.some(j=>j.status==='failed')?'failed':group.some(j=>['leased','queued'].includes(j.status))?'running':'completed',models:[identity],totals:sumProcessingTotals(group.map(j=>j.totals)),stages:purposes.map(p=>{const selected=calls.filter(c=>(c.purpose.endsWith('_repair')?'repair':c.purpose)===p),totals=sum(selected),timed=selected.filter(c=>c.duration!==null).length;return{...totals,purpose:p,average:timed?(totals.duration??0)/timed:null};}),jobs:run?batches:group,repaired:repaired.slice(0,4),rerun:rerun.slice(0,4),jobCount:run?batches.length:group.length,repairJobCount:repaired.length,rerunJobCount:rerun.length,jobOffset:0,detailsLoaded:true};
  }).sort((a,b)=>b.at-a.at);
  if(sample&&scope==='all'){
    const base=items.find(u=>u.kind==='job');if(base)items.splice(1,0,{...base,id:'other-work',chatId:'other-chat',chatTitle:'조용한 여행',title:'줄거리 갱신',at:base.at-1000});
  }
  const since=new Date().setHours(0,0,0,0),todayUnits=items.filter(u=>u.jobs.some(j=>j.calls.some(c=>c.at>=since))),today=sum(items.flatMap(u=>u.jobs.flatMap(j=>j.calls)).filter(c=>c.at>=since));
  if(today.calls===0)Object.assign(today,{input:0,output:0,duration:0});
  if(sample){today.calls=(today.calls??0)+4;if(today.input!==null)today.input+=12500;if(today.output!==null)today.output+=4300;if(today.duration!==null)today.duration+=32000;}
  return {scope,items,nextOffset:null,today:{...today,chats:new Set(todayUnits.map(u=>u.chatId)).size,since},translations:sample?[{day:new Date().toLocaleDateString('sv-SE'),items:240,models:[identity],totals:{calls:4,input:12500,output:4300,duration:32000},average:8000}]:[],nextTranslationOffset:null};
}
