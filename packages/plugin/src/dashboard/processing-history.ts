import { readSourceTransport, operationLabel, settingsFailureMessage, type ProcessingCall, type ProcessingHistory, type ProcessingJob, type ProcessingModel, type ProcessingTotals, type ProcessingUnit } from '@rcm/shared';
import { btn, empty, escapeHtml as esc, fold, icon, loading } from './film/ui.js';
import { sourceRecoverySummary } from '@rcm/shared';
import type { ServerClient } from '../api-client.js';
import { modelResponseFailureDetail } from '../support-diagnostics.js';

type CallPage = { items: ProcessingCall[]; nextOffset: number | null; offset: number };
export interface ProcessingView {
  scope:'chat'|'all'; offset:number; translationOffset:number; history?:ProcessingHistory;
  loading:boolean; error?:string; openUnit?:string;
  units:Map<string,ProcessingUnit>; runs:Map<string,ProcessingUnit>; calls:Map<string,CallPage>; translations:Map<string,CallPage>;
}
export const createProcessingView = ():ProcessingView => ({scope:'chat',offset:0,translationOffset:0,loading:false,units:new Map(),runs:new Map(),calls:new Map(),translations:new Map()});
const number = (n:number|null|undefined) => n===null || n===undefined ? '<span class="ph-missing">—</span>' : Math.round(n).toLocaleString('ko-KR');
const duration = (n:number|null|undefined) => n===null || n===undefined ? '<span class="ph-missing">—</span>' : n<60_000 ? `${(n/1000).toFixed(n<10_000?1:0)}초` : `${Math.floor(n/60_000)}분${n<600_000&&n%60_000>=1000?`${Math.floor(n%60_000/1000)}초`:''}`;
const time = (at:number) => new Date(at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});
const date = (at:number|string) => {
  const value=new Date(typeof at==='string'?`${at}T12:00:00`:at),now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),day=new Date(value.getFullYear(),value.getMonth(),value.getDate());
  if(day.getTime()===today.getTime())return '오늘';
  const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);if(day.getTime()===yesterday.getTime())return '어제';
  return value.toLocaleDateString('ko-KR',{...(value.getFullYear()!==now.getFullYear()?{year:'numeric' as const}:{}),month:'long',day:'numeric'});
};
const chevron=()=>`<span class="chev" aria-hidden="true">${icon('chevron')}</span>`;
const missingNote=(n:number|undefined)=>n?`<p class="ph-note">${number(n)}회는 토큰 기록 없음</p>`:'';
const stripNumber=(n:number|null)=>n===null?'<span class="ph-missing">기록 없음</span>':number(n);
const range = (start:number|null,end:number|null) => start===null || end===null ? '' : start===end ? `메시지 ${start+1}` : `메시지 ${start+1}–${end+1}`;
const modelKey = (m:ProcessingModel) => JSON.stringify([m.site,m.provider,m.slot,m.model]);
const providerNames:Record<string,string>={vertex:'Vertex AI',gemini_api:'Gemini API',llm_gateway:'LLM Gateway',openai_compatible:'OpenAI 호환',vercel:'Vercel AI Gateway',copilot:'Copilot',ollama_cloud:'Ollama Cloud'};
const slotNames:Record<string,string>={model:'Main 슬롯',static:'직접 지정',memory:'Memory 슬롯',otherAx:'Other Aux 슬롯',translate:'Translate 슬롯',emotion:'Emotion 슬롯',submodel:'Submodel 슬롯'};
const modelName = (m:ProcessingModel) => [m.site==='server'?'RCM 서버':m.site==='risu'?'Risu 보조 모델':'실행 위치 기록 없음',m.site==='risu' ? slotNames[m.slot ?? ''] ?? m.slot ?? '슬롯 기록 없음' : providerNames[m.provider ?? ''] ?? m.provider ?? '공급자 기록 없음',m.model ?? '모델 기록 없음'];
function modelChips(models:ProcessingModel[]):string {
  return `<div class="ph-models">${models.map(m=>!m.site&&!m.provider&&!m.slot&&!m.model?'<div class="ph-model"><span class="ph-missing">모델 기록 없음</span></div>':`<div class="ph-model">${modelName(m).map((s,i)=>`<span${i===0?' class="ph-site"':''}>${esc(s)}</span>`).join('')}</div>`).join('')}</div>`;
}
const repairReasons:Record<string,string>={format:'형식 깨짐',fields:'상태 값 빠짐',source:'원문 근거 보완',access:'접근 근거 보완'};
const tag = (text:string,kind='') => `<span class="ph-tag${kind?` is-${kind}`:''}">${esc(text)}</span>`;
const sumRow = (totals:ProcessingTotals,withTime=true) => `<tr class="ph-sum"><th scope="row">합계${totals.calls===null?'':` ${number(totals.calls)}회`}</th><td>${number(totals.input)}</td><td>${number(totals.output)}</td>${withTime?`<td>${duration(totals.duration)}</td>`:''}</tr>`;
function table(head:string,last:string,rows:string,totals?:ProcessingTotals,missing=totals?.missingTokens):string {
  const body=rows+(totals?sumRow(totals):'');
  return `<div class="ph-table-wrap"><table class="ph-table"><colgroup><col class="ph-col-name"><col><col><col></colgroup><thead><tr><th scope="col">${head}</th><th scope="col">입력</th><th scope="col">출력</th><th scope="col">${last}</th></tr></thead><tbody>${body}</tbody></table>${missingNote(missing)}</div>`;
}
function callRows(calls:ProcessingCall[],baseline?:ProcessingModel,rerun=false):string {
  return calls.map(call=>{
    const repair=call.purpose.endsWith('_repair');
    const sourceTransport=readSourceTransport(call.sourceTransport);
    const estimate = sourceTransport?.estimatedTextInputTokens;
    const saving = estimate && call.input !== null && Number.isSafeInteger(call.input) && call.input >= 0 && call.input < estimate
      ? Number(((1 - call.input / estimate) * 100).toPrecision(2)) : undefined;
    const pdfTag = sourceTransport?.kind === 'pdf' ? tag('PDF') + (saving === undefined ? '' : tag(`약 ${saving}% 절감`)) : '';
    const label=call.attemptOnly?'작업 실행':repair?'다시 요청':call.purpose==='translation'?'참고 번역':operationLabel(call.purpose);
    const ownModel=!call.attemptOnly && baseline && modelKey(baseline)!==modelKey(call);
    const status=call.outcome==='running'?'진행 중':call.outcome==='failed'?'실패':call.outcome==='interrupted'?'중단됨':call.outcome==='succeeded'?'성공':'결과 기록 없음';
    const repeated=(call.attemptCount??(call.attemptOnly?rerun?2:0:0))>1;
    const attemptReason=call.outcome==='succeeded'?'성공':call.attemptReason??call.reason??status;
    const attempt=repeated?`<small class="ph-attempt is-${call.outcome==='succeeded'?'ok':'warn'}">${esc(`${call.attempt??'기록 없음'}번째 · ${attemptReason}`)}</small>`:'';
    const statusLine=!repeated&&['running','failed','interrupted'].includes(call.outcome)?`<small class="ph-attempt is-warn">${esc(call.reason??status)}</small>`:'';
    return `<tr${repair || call.outcome==='failed'?' class="ph-call-alert"':''}><th scope="row">${esc(label)}${pdfTag}${repair?tag(repairReasons[call.repairReason??''] ?? (call.purpose==='state_field_repair'?'상태 값 빠짐':'응답 보완'),'repair'):''}${call.after?tag('정리 뒤 자동','after'):''}${attempt}${statusLine}${sourceTransport?`<small>${esc(sourceTransport.kind==='pdf'?`${sourceTransport.pages}쪽 · ${sourceTransport.fontPt}pt`:'텍스트')}</small>`:''}${ownModel?`<small>${esc(modelName(call).join(' · '))}</small>`:''}</th><td>${number(call.input)}</td><td>${number(call.output)}</td><td>${duration(call.duration)}</td></tr>`;
  }).join('');
}

function callTable(job:ProcessingJob,view:ProcessingView,models:ProcessingModel[],chatId:string,omitTable=false):string {
  const page=view.calls.get(job.id),calls=page?.items ?? job.calls;
  const rows=calls.length?callRows(calls,models[0],job.attempts>1):`<tr><th scope="row">${esc(operationLabel(job.type))}${tag(operationLabel(job.status))}</th><td colspan="3" class="ph-empty-cell">호출 기록 없음</td></tr>`;
  const paging=page || job.moreCalls ? `<div class="ph-paging">${page?.offset?btn('이전 호출',{kind:'quiet',action:'processing-calls',data:{chatId,jobId:job.id,offset:String(Math.max(0,page.offset-40))}}):''}${(page?page.nextOffset!==null:job.moreCalls)?btn('다음 호출',{kind:'quiet',action:'processing-calls',data:{chatId,jobId:job.id,offset:String(page?.nextOffset ?? 40)}}):''}</div>`:'';
  const recovery=sourceRecoverySummary(job.technical.sourceRecoveryMetadata as any);
  const withheld=Array.isArray(job.technical.withheldRecognitions)?job.technical.withheldRecognitions as Array<{holder?:string;what?:string}>:[];
  const withheldNote=withheld.length?`<section class="ph-withheld"><h4>보류한 인물 인지 ${withheld.length}건</h4><ul>${withheld.map(item=>`<li><b>${esc(item.holder || '인물')}</b> ${esc(item.what || '인식 기록')}</li>`).join('')}</ul><p>연결된 기억에 이 인물이 사실을 알게 된 장면이 없어 보류했어요.</p>${job.technical.withheldReviewable?btn('상태에서 확인',{kind:'quiet',action:'processing-review',data:{chatId,attentionFilter:'small'}}):''}</section>`:'';
  return `${omitTable?'':table('호출','시간',rows,job.totals)}${paging}${job.notes.map(n=>`<p class="ph-note">${esc(n)}</p>`).join('')}${recovery?`<p class="ph-note">${esc(recovery)}</p>`:''}${withheldNote}`;
}

type Coverage={total?:number;covered?:number;skipped?:Record<string,number>;policySkipped?:number;unresolved?:number;needsReview?:number};
const skipNames:Record<string,string>={trivial:'짧은 대화',ooc:'OOC',no_new_information:'새 정보 없음',merged:'앞 기억과 합침'};
const failedCall=(call:ProcessingCall)=>!!call.code||call.outcome==='failed'||call.outcome==='interrupted';
const count=(value:unknown)=>Array.isArray(value)?value.length:Number(value)||0;
/** Plain lines for a job's diagnostics; `alert` marks what is worth opening on a finished card. */
function technicalLines(job:ProcessingJob,calls:ProcessingCall[]):{lines:string[];alert:boolean} {
  const t=job.technical,lines:string[]=[];let alert=job.status==='failed';
  const c=t.sourceCoverage as Coverage|undefined;
  if(c?.total){
    const skipped=Object.entries(c.skipped??{}).filter(([,n])=>n>0).map(([k,n])=>`${skipNames[k]??k} ${n}`);
    lines.push(`원문 ${c.total}개 중 ${c.covered??0}개를 기억에 반영${skipped.length?` · 건너뜀: ${skipped.join(', ')}`:''}`);
    for(const [n,label] of [[c.unresolved,'근거를 찾지 못한 항목'],[c.needsReview,'검토가 필요한 항목'],[c.policySkipped,'설정에 따라 뺀 항목']] as const)if(n){lines.push(`${label} ${n}개`);alert=true;}
  }
  const progress=t.progressSent as {count?:number}|undefined;
  if(progress?.count)lines.push(`관계 진도 ${progress.count}칸을 확인해 ${count(t.progressApplied)}칸 체크${count(t.progressDrops)?` · ${count(t.progressDrops)}칸 제외`:''}`);
  if(count(t.progressDrops))alert=true;
  if(count(t.auditAdditionDrops)){lines.push(`재검수 추가 항목 ${count(t.auditAdditionDrops)}개 제외`);alert=true;}
  for(const call of calls.filter(failedCall)){lines.push(`${call.purpose.endsWith('_repair')?'다시 요청':operationLabel(call.purpose)}${call.attempt?` ${call.attempt}번째`:''} · ${call.attemptReason ?? call.reason ?? call.code ?? (call.outcome==='failed'?'실패':'중단됨')}`);alert=true;}
  return {lines,alert};
}

function technicalDetails(jobs:ProcessingJob[],key:string,view:ProcessingView):string {
  const unique=[...new Map(jobs.filter(job=>Object.keys(job.technical).length).map(job=>[job.id,job])).values()];
  const sections=unique.map(job=>{
    const calls=view.calls.get(job.id)?.items??job.calls,{lines,alert}=technicalLines(job,calls);
    return {job,calls,lines,alert};
  }).filter(item=>item.alert);
  if(!sections.length)return '';
  const report=sections.map(({job,calls})=>{
    const {modelResponseDiagnostic:_response,withheldRecognitions:_withheld,...rest}=job.technical;
    const callFailures=calls.filter(failedCall).map(({purpose,attempt,outcome,code,reason})=>({purpose,attempt,outcome,code,reason}));
    return {job:job.id,type:job.type,status:job.status,start:job.start,end:job.end,...rest,...(callFailures.length?{callFailures}:{})};
  });
  const body=sections.map(({job,lines})=>{
    const diagnostic=job.status==='failed'?modelResponseFailureDetail(job.technical.modelResponseDiagnostic as any,esc):'';
    const where=range(job.start,job.end)?` · ${range(job.start,job.end)}`:'';
    return `<section class="ph-tech">${sections.length>1?`<h4 class="ph-subhead">${esc(operationLabel(job.type))}${esc(where)}</h4>`:''}${diagnostic}${lines.length?`<ul>${lines.map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`:''}</section>`;
  }).join('');
  const copy=`<div class="ph-tech-copy">${btn('진단 복사',{kind:'quiet',action:'copy-processing-diagnostics'})}<textarea data-processing-diagnostic readonly hidden aria-label="진단 정보">${esc(JSON.stringify(report,null,2))}</textarea></div>`;
  return fold('기술 세부정보',body+copy,{role:'section',preserveKey:`processing-tech:${key}`});
}

function unitCalls(unit:ProcessingUnit,view:ProcessingView):string {
  const rows=unit.jobs.map(job=>callRows(view.calls.get(job.id)?.items ?? job.calls,unit.models[0],job.attempts>1)).join('');
  return `${table('호출','시간',rows || '<tr><th scope="row">호출 기록 없음</th><td colspan="3" class="ph-empty-cell">기록 없음</td></tr>',unit.totals)}${unit.jobs.map(j=>callTable(j,view,unit.models,unit.chatId,true)).join('')}${technicalDetails(unit.jobs,unit.id,view)}`;
}

function jobScope(job:ProcessingJob):string {return [job.turns?`최근 ${job.turns}턴`:'',range(job.start,job.end)].filter(Boolean).join(' · ');}
function jobState(job:ProcessingJob):string {
  return job.status==='queued' ? job.technical.pipelineManualRetry?'다시 시도 대기 중':'대기 중'
    : job.status==='leased' ? operationLabel(String(job.technical.pipelineStage ?? 'leased'))
    : ['done','completed'].includes(job.status)?'':operationLabel(job.status);
}
function jobFold(job:ProcessingJob,view:ProcessingView,unit:ProcessingUnit,context='all'):string {
  const repair=job.calls.filter(c=>c.purpose.endsWith('_repair'));
  const repairedNames=[...new Set(repair.map(c=>operationLabel(job.calls.find(p=>p.id===c.repairOf)?.purpose??c.purpose.replace(/_repair$/,''))))];
  const reruns=[...new Set(job.calls.filter(c=>(c.attemptCount??0)>1).map(c=>c.purpose))];
  const repeated=reruns.map(p=>`${operationLabel(p)}를 ${new Set(job.calls.filter(c=>c.purpose===p).map(c=>c.attempt)).size}번 실행`).join(' · ');
  const small=context==='다시 요청이 있었던 묶음'?`${repairedNames.join(' · ')||'응답'}를 다시 요청`:context==='다시 실행된 묶음'?repeated||`작업을 ${job.attempts}번 실행`:[operationLabel(job.type),jobState(job)].filter(Boolean).join(' · ');
  return `<details class="ph-batch" data-preserve-open="processing-batch:${esc(context)}:${esc(job.id)}"><summary><span>${esc(range(job.start,job.end)||operationLabel(job.type))}<small>${esc(small)}</small></span><span>${number(job.totals.calls)}회</span>${chevron()}</summary>${callTable(job,view,unit.models,unit.chatId)}</details>`;
}

export function renderProcessingUnit(unit:ProcessingUnit,view:ProcessingView):string {
  const key=`${unit.chatId}:${unit.id}`;
  const detail=view.units.get(key)??view.runs.get(key);
  // A batch page supplies folds; the refreshed summary owns live progress.
  if(detail&&!unit.detailsLoaded)unit={...unit,repaired:detail.repaired,rerun:detail.rerun,detailsLoaded:true};
  const all=view.scope==='all',run=unit.kind==='run';
  const runScope=`${unit.start!==null&&unit.end!==null?`${range(unit.start,unit.end)}${unit.batchSize?'를 ': ' · '}`:''}${unit.batchSize?`${unit.batchSize}개씩 `:''}${unit.totalBatches}묶음 · ${unit.status==='completed'?'모두 완료':unit.status==='ready'?'모두 완료 · 반영 대기':unit.status==='interrupted'?'중단됨':`${unit.completedBatches}/${unit.totalBatches} ${unit.status==='failed'?'확인 필요':'진행 중'}`}`;
  const scope=run?runScope:unit.jobs[0]?[jobScope(unit.jobs[0]),jobState(unit.jobs[0])].filter(Boolean).join(' · '):range(unit.start,unit.end);
  const header=`<header class="ph-card-head"><div class="ph-title">${all?`<span class="ph-chat">${esc(unit.chatTitle)}</span>`:''}<h3>${esc(unit.title)}</h3><time datetime="${new Date(unit.at).toISOString()}">${esc(time(unit.at))}</time></div>${scope?`<p>${esc(scope)}</p>`:''}${run&&unit.status==='running'?`<div class="ph-bar" role="progressbar" aria-label="과거 대화 정리" aria-valuenow="${unit.completedBatches}" aria-valuemin="0" aria-valuemax="${unit.totalBatches || 1}"><i style="--v:${Math.min(100,unit.completedBatches/Math.max(1,unit.totalBatches)*100)}%"></i></div>`:''}${modelChips(unit.models)}</header>`;
  if(!run) return `<article class="ph-card" data-processing-unit="${esc(unit.id)}">${header}${unitCalls(unit,view)}</article>`;
  const stageRows=unit.stages.length?unit.stages.map(stage=>`<tr${stage.purpose==='repair'?' class="ph-call-alert"':''}><th scope="row">${esc(stage.purpose==='repair'?'다시 요청':operationLabel(stage.purpose))} · ${number(stage.calls)}회</th><td>${number(stage.input)}</td><td>${number(stage.output)}</td><td>${duration(stage.average)}</td></tr>`).join(''):'<tr><th scope="row">단계 기록 없음</th><td colspan="3" class="ph-empty-cell">기록 없음</td></tr>';
  const exceptions=(label:string,jobs:ProcessingJob[],count:number)=>count?`<h4 class="ph-subhead">${label}${count>jobs.length?` · ${jobs.length}/${count}`:''}</h4>${jobs.map(j=>jobFold(j,view,unit,label)).join('')}`:'';
  const page=view.runs.get(key);
  const allJobs=page?`<div class="ph-batches">${page.jobs.map(j=>jobFold(j,view,unit)).join('')}</div><div class="ph-paging">${page.jobOffset?btn('이전 묶음',{kind:'quiet',action:'processing-run',data:{chatId:unit.chatId,runId:unit.id,offset:String(Math.max(0,page.jobOffset-8))}}):''}${unit.jobCount>8?`<span>${page.jobs.length?page.jobOffset+1:0}–${Math.min(page.jobOffset+page.jobs.length,unit.jobCount)} / ${unit.jobCount}</span>`:''}${page.jobOffset+page.jobs.length<unit.jobCount?btn('다음 묶음',{kind:'quiet',action:'processing-run',data:{chatId:unit.chatId,runId:unit.id,offset:String(page.jobOffset+8)}}):''}</div>`:'';
  return `<article class="ph-card ph-run" data-processing-unit="${esc(unit.id)}">${header}${unit.incomplete?'<p class="ph-note">일부 호출의 세부 기록이 없어요. 남아 있는 호출만 단계별로 표시해요.</p>':''}${table('단계','평균',stageRows,unit.totals)}${exceptions('다시 요청이 있었던 묶음',unit.repaired,unit.repairJobCount)}${exceptions('다시 실행된 묶음',unit.rerun,unit.rerunJobCount)}<div class="ph-run-action">${btn(page?'묶음 접기':`묶음 ${unit.totalBatches}개 모두 보기`,{kind:'quiet',action:page?'processing-close-run':'processing-run',data:{chatId:unit.chatId,runId:unit.id,offset:'0'}})}</div>${allJobs}${technicalDetails([...unit.repaired,...unit.rerun,...(page?.jobs??[])],unit.id,view)}</article>`;
}

function allRows(units:ProcessingUnit[],view:ProcessingView):string {
 const body=units.map(unit=>{
  const key=`${unit.chatId}:${unit.id}`,open=view.openUnit===key,detail=view.units.get(key);
  return `<tr><th scope="row"><button type="button" class="ph-unit-button" data-action="processing-open-unit" data-unit-id="${esc(key)}" data-chat-id="${esc(unit.chatId)}" data-job-id="${esc(unit.id)}" aria-expanded="${open}"><span class="ph-chat">${esc(unit.chatTitle)}</span><span class="ph-work-title">${esc(unit.title)} ${chevron()}</span></button><small>${esc([time(unit.at),range(unit.start,unit.end)].filter(Boolean).join(' · '))}</small></th><td>${number(unit.totals.calls)}${unit.totals.calls===null?'':'회'}</td><td>${number(unit.totals.input)}</td><td>${number(unit.totals.output)}</td></tr>${open?`<tr class="ph-all-detail"><td colspan="4">${detail?`${modelChips(detail.models)}${unitCalls(detail,view)}`:loading()}</td></tr>`:''}`;
 }).join('');
 return `<div class="ph-card ph-all"><table class="ph-table"><colgroup><col class="ph-col-name"><col class="ph-col-count"><col><col></colgroup><thead><tr><th scope="col">처리</th><th scope="col">호출</th><th scope="col">입력</th><th scope="col">출력</th></tr></thead><tbody>${body}</tbody></table>${missingNote(units.reduce((n,u)=>n+(u.totals.missingTokens??0),0))}</div>`;
}

export function renderProcessingHistory(view:ProcessingView):string {
  const history=view.history;
  const segment=`<div class="ph-scope" role="group" aria-label="처리 범위">${(['chat','all'] as const).map(scope=>`<button type="button" data-action="processing-scope" data-scope="${scope}" aria-pressed="${view.scope===scope}">${scope==='chat'?'이 채팅':'모든 채팅'}</button>`).join('')}</div>`;
  if(!history) return `${segment}${view.error?`<div class="ph-error" role="alert">${esc(view.error)}${btn('다시 시도',{kind:'quiet',action:'processing-refresh'})}</div>`:loading()}`;
  const totals=`<div class="ph-totals" aria-label="오늘 합계"><div><span>오늘 호출</span><b>${stripNumber(history.today.calls)}</b></div><div><span>입력 토큰</span><b${(history.today.input??0)>=1_000_000?' class="ph-total-wide"':''}>${stripNumber(history.today.input)}</b></div><div><span>출력 토큰</span><b${(history.today.output??0)>=1_000_000?' class="ph-total-wide"':''}>${stripNumber(history.today.output)}</b></div>${view.scope==='all'?`<p>오늘 처리가 있었던 채팅 ${stripNumber(history.today.chats)}개</p>`:''}${missingNote(history.today.missingTokens)}</div>`;
  const days=new Map<string,ProcessingUnit[]>();
  for(const unit of history.items){const day=date(unit.at);days.set(day,[...(days.get(day)??[]),unit]);}
  const entries=[...days].map(([day,units])=>{
    let html='',compact:ProcessingUnit[]=[];
    const flush=()=>{if(compact.length){html+=allRows(compact,view);compact=[];}};
    for(const unit of units){if(view.scope==='all'&&unit.kind==='job')compact.push(unit);else{flush();html+=renderProcessingUnit(unit,view);}}flush();
    return `<section class="ph-day"><h2 class="sec">${esc(day)}</h2>${html}</section>`;
  }).join('');
  const translations=history.translations.map(day=>{
    const page=view.translations.get(day.day),model=day.models[0];
    return `<article class="ph-card ph-translation"><header class="ph-card-head"><button type="button" class="ph-translation-button" data-action="processing-translation" data-day="${esc(day.day)}" aria-expanded="${!!page}"><b>${esc(date(day.day))}</b><span>${day.items===null?'번역 수 기록 없음':`${number(day.items)}개 번역`} ${chevron()}</span></button>${modelChips(day.models)}</header>${table('호출','평균',`<tr><th scope="row">참고 번역 · ${number(day.totals.calls)}회</th><td>${number(day.totals.input)}</td><td>${number(day.totals.output)}</td><td>${duration(day.average)}</td></tr>`,undefined,day.totals.missingTokens)}${page?`${table('호출','시간',callRows(page.items,model))}<div class="ph-paging">${page.offset?btn('이전 호출',{kind:'quiet',action:'processing-translation-page',data:{day:day.day,offset:String(Math.max(0,page.offset-40))}}):''}${page.nextOffset!==null?btn('다음 호출',{kind:'quiet',action:'processing-translation-page',data:{day:day.day,offset:String(page.nextOffset)}}):''}</div>`:''}</article>`;
  }).join('');
  return `<section class="processing-history" aria-busy="${view.loading}">${segment}${view.error?`<p class="ph-error" role="alert">${esc(view.error)}${btn('다시 시도',{kind:'quiet',action:'processing-refresh'})}</p>`:''}${totals}<div data-preserve-scroll="operation-history">${entries || empty('처리 기록이 없어요','새 대화가 모이면 여기에 기록이 쌓여요.')}</div><div class="ph-paging">${view.offset?btn('이전 기록',{kind:'quiet',action:'processing-page',data:{offset:String(Math.max(0,view.offset-12))}}):''}${history.nextOffset!==null?btn('다음 기록',{kind:'quiet',action:'processing-page',data:{offset:String(history.nextOffset)}}):''}</div><section class="ph-day"><h2 class="sec">참고 번역</h2>${translations || '<p class="sub">저장된 번역 호출 기록이 없어요.</p>'}<div class="ph-paging">${view.translationOffset?btn('이전 날짜',{kind:'quiet',action:'processing-translation-days',data:{offset:String(Math.max(0,view.translationOffset-7))}}):''}${history.nextTranslationOffset!==null?btn('다음 날짜',{kind:'quiet',action:'processing-translation-days',data:{offset:String(history.nextTranslationOffset)}}):''}</div></section></section>`;
}

export class ProcessingController {
  readonly view=createProcessingView();
  private generation=0;
  private context='';
  constructor(private client:ServerClient,private current:()=>{chatId?:string;server:string}){}
  async refresh():Promise<void>{
    const current=this.current(),key=`${current.server}:${current.chatId ?? ''}`;
    if(key!==this.context){Object.assign(this.view,createProcessingView());this.context=key;if(!current.chatId)this.view.scope='all';}
    const generation=++this.generation;
    this.view.loading=true;
    try{
      const prefix=this.view.scope==='all'?'/v1/processing':`/v1/chats/${encodeURIComponent(current.chatId ?? '')}/processing`;
      const history=await this.client.request<ProcessingHistory>(`${prefix}?offset=${this.view.offset}&translationOffset=${this.view.translationOffset}&timezoneMinutes=${-new Date().getTimezoneOffset()}`);
      if(generation!==this.generation || key!==`${this.current().server}:${this.current().chatId ?? ''}`)return;
      this.view.history=history;this.view.error=undefined;
    }catch(error){if(generation===this.generation)this.view.error=settingsFailureMessage(error);}
    finally{if(generation===this.generation)this.view.loading=false;}
  }
  async action(action:string,data:DOMStringMap):Promise<void>{
    const v=this.view;
    const key=`${data.chatId}:${data.runId}`;
    if(action==='processing-close-run'){v.runs.delete(key);return;}
    if(action==='processing-translation'&&v.translations.has(data.day!)){v.translations.delete(data.day!);return;}
    if(action==='processing-scope'||action==='processing-page'||action==='processing-translation-days'||action==='processing-refresh'){
      if(action==='processing-scope'){v.scope=data.scope==='all'?'all':'chat';v.offset=0;v.translationOffset=0;v.history=undefined;}
      if(action==='processing-page')v.offset=Number(data.offset)||0;
      if(action==='processing-translation-days')v.translationOffset=Number(data.offset)||0;
      v.units.clear();v.runs.clear();v.calls.clear();v.translations.clear();
      await this.refresh();return;
    }
    const generation=this.generation;
    try{
      const offset=Number(data.offset)||0,chat=encodeURIComponent(data.chatId ?? this.current().chatId ?? '');
      if(action==='processing-open-unit'){
        const id=data.unitId!;if(v.openUnit===id){v.openUnit=undefined;return;}v.openUnit=id;
        const unit=await this.client.request<ProcessingUnit>(`/v1/chats/${chat}/processing/jobs/${encodeURIComponent(data.jobId!)}`);
        if(generation===this.generation)v.units.set(id,unit);
      }else if(action==='processing-run'){
        const run=await this.client.request<ProcessingUnit>(`/v1/chats/${chat}/processing/runs/${encodeURIComponent(data.runId!)}?offset=${offset}`);
        if(generation===this.generation)v.runs.set(key,run);
      }else if(action==='processing-calls'){
        const page=await this.client.request<CallPage>(`/v1/chats/${chat}/processing/jobs/${encodeURIComponent(data.jobId!)}/calls?offset=${offset}`);
        if(generation===this.generation)v.calls.set(data.jobId!,{...page,offset});
      }else if(action==='processing-translation'||action==='processing-translation-page'){
        const query=new URLSearchParams({offset:String(offset),timezoneMinutes:String(-new Date().getTimezoneOffset())});
        if(v.scope==='chat'&&this.current().chatId)query.set('chatId',this.current().chatId!);
        const page=await this.client.request<CallPage>(`/v1/processing/translations/${encodeURIComponent(data.day!)}?${query}`);
        if(generation===this.generation)v.translations.set(data.day!,{...page,offset});
      }
    }catch(error){if(generation===this.generation)v.error=settingsFailureMessage(error);}
  }
}
