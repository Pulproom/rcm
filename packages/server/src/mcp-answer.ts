import { appendMcpSourceContext } from "./mcp-source-context.js";
import { evidenceRanker, rankMcpRecords } from "./mcp-evidence.js";
import { estimateTokens, renderMcpAnswer, type McpEvidence, type McpQuestionAnswer, type McpSourceRange } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import type { retrieve } from "./retrieval.js";
import type { SemanticSearchResult } from "./embedding.js";
import { emptyPacketManifest } from "./packet-manifest.js";
import { memoryAtomKeys, memoryDetailAtomKey, memoryDialogueAtomKey, memorySummaryAtomKey } from "./memory-atoms.js";
import { retrieveSourceEvidence, sourceEvidenceAtomKey } from "./source-evidence.js";
import { targetDetailSourceEvidence } from "./target-source-evidence.js";
import { type McpRerankDiagnostic } from "./mcp-rerank.js";
import type { EvidenceReranker } from "./reranker.js";
import { type McpSourceSpanDiagnostic } from "./mcp-source-span.js";
import { collectStateEvidence, selectStateEvidence, stateMcpEvidence } from "./state-evidence.js";
import { McpSelector, type SelectorDiagnostic } from "./mcp-selector.js";
import { mcpEvidenceVersion, selectorBundles } from "./mcp-selector-bundles.js";

export async function finalizeMcpAnswer(db: RcmDatabase, chatId: string, result: ReturnType<typeof retrieve>, options: {
  memoryOnlyInjection?: boolean;
  archiveView?: boolean; query: string; aspects?: string[]; tokenBudget: number; perspectives: string[]; promptIds?: string[]; excludedAtoms: string[];
  semantic: SemanticSearchResult[]; seedMemoryId?: string; referenceMemoryId?: string; reranker?: EvidenceReranker;
  excludedSourceRanges?: McpSourceRange[];
  currentMessageId?: string;
  selector?: Pick<McpSelector,"publicConfig"|"select">; signal?:AbortSignal; isCurrent?:()=>boolean;
}): Promise<{ answers: McpQuestionAnswer[]; rerank: McpRerankDiagnostic; sourceSpans: McpSourceSpanDiagnostic; selector?:SelectorDiagnostic }> {
  const sourceStarted = performance.now();
  const useSelector=Boolean(options.selector?.publicConfig.enabled&&options.archiveView&&!options.seedMemoryId);
  const version=useSelector?mcpEvidenceVersion(db,chatId):undefined;
  const supplied = new Set(options.excludedAtoms);
  const records = rankMcpRecords(result.eligibleCandidates, options.query, options.aspects ?? [], options.semantic, supplied, options.seedMemoryId, { searchEnvelopes: result.mcpSearchEnvelopes, referenceMemoryId: options.referenceMemoryId, archiveView: options.archiveView });
  const answers: McpQuestionAnswer[] = records.answers;
  const stateEvidence = !options.memoryOnlyInjection && options.archiveView && !options.seedMemoryId
    ? collectStateEvidence(db,chatId) : [];
  const stateAnswers = options.memoryOnlyInjection ? [] : options.archiveView && !options.seedMemoryId
    ? [{question:options.query,evidence:selectStateEvidence(stateEvidence,options.query,
      {perspective:"narrator",archive:true,history:true,continuity:true,semantic:options.semantic[0]?.stateScores}).map(stateMcpEvidence)}]
    : result.answers ?? [];
  for (const answer of answers) {
    const state = stateAnswers.find(entry => entry.question === answer.question)?.evidence.filter(entry => !entry.memoryId)
      ?? [];
    const seen = new Set(answer.evidence.map(entry => entry.atomKey));
    const records = answer.evidence;
    const states = options.seedMemoryId ? [] : state.filter(entry => !seen.has(entry.atomKey));
    answer.evidence = [];
    for (let index=0; index<Math.max(records.length,states.length); index++) {
      if (states[index]) answer.evidence.push(states[index]!);
      if (records[index]) answer.evidence.push(records[index]!);
    }
  }
  const corpus = result.eligibleCandidates.flatMap(item => [item.title, item.content, ...item.details.map(detail => detail.text), ...item.keyDialogues.map(dialogue => dialogue.text)]);
  const rank = evidenceRanker(options.query, corpus);
  // Source access remains independently checked. Delivery history is not access.
  const detailBundles = new Map(result.eligibleCandidates.flatMap(candidate=>candidate.details.map(detail=>[
    detail.id, answers.flatMap(answer=>answer.evidence).find(entry=>entry.atomKey===memoryDetailAtomKey(detail))?.bundleKey,
  ] as const)));
  const bound = options.archiveView ? {items:[],atomKeys:[]} : targetDetailSourceEvidence(db, chatId, records.detailIds, options.perspectives, options.tokenBudget,
    options.excludedAtoms, options.promptIds ?? []);
  for (const answer of answers) {
    const id = answer.evidence[0]?.memoryId;
    const evidence = bound.items.filter(item => item.memoryId === id);
    for (const item of evidence) if (!options.archiveView && !answer.evidence.some(entry => entry.text === item.quote)) answer.evidence.push({
      atomKey:sourceEvidenceAtomKey(item), bundleKey:detailBundles.get(item.bundleKey ?? ""), memoryId:item.memoryId, kind:"quote", text:item.quote,
      speaker:item.speaker ?? undefined, knownBy:item.holders, basis:item.epistemic,
    });
  }
  if (!options.archiveView && !options.seedMemoryId) {
    const sources = retrieveSourceEvidence(db, chatId, options.query, options.perspectives, options.tokenBudget,
      options.promptIds ?? [], options.semantic.flatMap(view => view.sourceHits ?? []), [], bound.atomKeys,
      quote => rank(quote) >= .12, { rank: quote => rank(quote), maxItems:2, budgetRatio:.3 });
    if (sources.items.length) answers[0]?.evidence.push(...sources.items.map(item => ({atomKey:sourceEvidenceAtomKey(item),
      kind:"quote" as const,text:item.quote,speaker:item.speaker ?? undefined,knownBy:item.holders,basis:item.epistemic})));
  }
  const sourceContext = options.archiveView
    ? appendMcpSourceContext(db, chatId, answers, result.eligibleCandidates.filter(item => records.memoryIds.includes(item.id) || records.sourceMemoryIds.includes(item.id)), options.seedMemoryId ? [] : options.semantic, options.tokenBudget, options.query,
      options.currentMessageId ? [options.currentMessageId] : [], Boolean(options.seedMemoryId), options.promptIds, useSelector, records.sourceMemoryIds, stateEvidence)
    : undefined;
  if (!answers.length) answers.push({question:options.query,evidence:[],alreadyPresent:false,relatedRecords:true,searchUnavailable:options.semantic[0]?.searchUnavailable});
  // These are retrieval candidates for the main model, not server-certified
  // answers. Preserve semantic leaders and use only local ranking to keep the
  // response compact.
  const rerank: McpRerankDiagnostic = { mode: "local_shortlist", elapsedMs: 0, calls: 0, acceptance: 0, overallAcceptance: 0, questions: [] };
  const providedSourceContext={sources:0,windows:0,candidates:0};
  // Exact verified passages stay intact. Do not shorten a source to a lexical
  // match and accidentally discard negation, speaker, or unresolved outcome.
  const sourceSpans: McpSourceSpanDiagnostic = { elapsedMs: 0, calls: 0, questions: [] };
  let selectorDiagnostic:SelectorDiagnostic|undefined;
  let modelSelected=false;
  if(useSelector){
    const bundles=selectorBundles(db,chatId,options.query,answers,options.selector!.publicConfig.maxInputTokens);
    const selection=await options.selector!.select(options.query,bundles.candidates,options.signal??new AbortController().signal,Math.max(128,options.tokenBudget-200));
    selectorDiagnostic=selection.diagnostic;
    selectorDiagnostic.bundles=[...bundles.manifest].map(([id,evidence])=>({id,atomKeys:evidence.map(e=>e.atomKey)}));
    if(options.signal?.aborted||options.isCurrent?.()===false||version!==mcpEvidenceVersion(db,chatId)){
      selectorDiagnostic.outcome="stale";selectorDiagnostic.failure="canonical_changed";
      for(const answer of answers){answer.evidence=[];answer.searchUnavailable=true;}
    }else if(selection.ids!==undefined){
      modelSelected=true;
      answers[0]!.synthesizedText=selection.answer;
      answers[0]!.synthesizedReferences=Object.fromEntries(selection.ids.map(id=>[id,
        [...new Set((bundles.manifest.get(id)??[]).flatMap(entry=>entry.memoryId?[entry.memoryId]:[]))]]));
      answers[0]!.evidence=selection.ids.flatMap(id=>bundles.manifest.get(id)??[]);
      for(const answer of answers.slice(1))answer.evidence=[];
    }
  }
  for (const answer of answers) {
    answer.alreadyProvidedEvidence = [];
    answer.alreadyPresent = answer.evidence.some(evidence => supplied.has(evidence.atomKey));
  }
  const retained = answers.map(answer => ({ ...answer, evidence: [] as typeof answer.evidence,
    alreadyProvidedEvidence: [] as McpEvidence[] }));
  const targetBudget=options.tokenBudget;
  const hardBudget=options.tokenBudget;
  // Reserve the complete answer before adding whole evidence bundles. Only if
  // the answer alone exceeds the cap, remove trailing complete sentences;
  // never slice a sentence or an exact source passage to fill a token slot.
  for (const answer of retained) {
    while (answer.synthesizedText && estimateTokens(renderMcpAnswer(retained,()=>"m0000000000000000")) > hardBudget) {
      const sentences=[...new Intl.Segmenter(undefined,{granularity:"sentence"}).segment(answer.synthesizedText)].map(part=>part.segment);
      sentences.pop();answer.synthesizedText=sentences.join("").trimEnd();
    }
  }
  const coreKeys = new Set(result.eligibleCandidates.flatMap(item => item.details
    .filter(detail => detail.role === "core").map(memoryDetailAtomKey)));
  const tryAdd=(question:number,evidence:McpEvidence,budget:number,provided=false)=>{
    const target=provided?retained[question]!.alreadyProvidedEvidence!:retained[question]!.evidence;
    if (evidence.kind === "quote") {
      const quotes = retained.flatMap(answer => answer.evidence).filter(item => item.kind === "quote");
      if (!options.archiveView && quotes.reduce((sum,item) => sum + estimateTokens(item.text),0) + estimateTokens(evidence.text) > (options.seedMemoryId || !answers.some(answer => answer.evidence.some(item => item.kind !== "quote")) ? budget : Math.floor(budget * .25))) return false;
      // Character-scoped recall retains its supporting-excerpt limits.
      // Authorial recall competes by complete bundles and final packet budget.
      if (!options.archiveView && !options.seedMemoryId && (evidence.memoryId
        ? quotes.some(item => item.memoryId === evidence.memoryId)
        : quotes.filter(item => !item.memoryId).length >= 2)) return false;
      if (evidence.sourceRange && quotes.some(item => item.sourceRange?.messageId === evidence.sourceRange!.messageId
        && item.sourceRange.start <= evidence.sourceRange!.start && item.sourceRange.end >= evidence.sourceRange!.end)) return true;
    }
    const core = evidence.memoryId && !coreKeys.has(evidence.atomKey)
      && !target.some(entry => entry.memoryId === evidence.memoryId && coreKeys.has(entry.atomKey))
      ? answers[question]!.evidence.filter(entry => entry.memoryId === evidence.memoryId && coreKeys.has(entry.atomKey))
        .sort((a,b) => rank(b.text)-rank(a.text))[0] : undefined;
    const context = core ?? (evidence.kind === "dialogue" && !evidence.context
      ? answers[question]!.evidence.find(entry => entry.kind === "fact" && entry.memoryId === evidence.memoryId && !target.some(old => old.atomKey === entry.atomKey)) : undefined);
    if (evidence.kind === "dialogue" && !evidence.context && !context && !target.some(entry => entry.kind === "fact" && entry.memoryId === evidence.memoryId)) return false;
    if (target.some(entry => entry.atomKey === evidence.atomKey)) return true;
    if (evidence.atomKey.startsWith("state:") && evidence.kind === "fact") {
      const stateTokens = retained.flatMap(answer => answer.evidence).filter(item => item.atomKey.startsWith("state:")).reduce((sum,item) => sum + estimateTokens(item.text), 0);
      if (stateTokens + estimateTokens(evidence.text) > Math.floor(budget * .3)) return false;
    }
    target.push(...(context ? [context] : []), evidence);
    if(estimateTokens(renderMcpAnswer(retained,()=>"m0000000000000000"))<=budget)return true;
    target.pop(); if (context) target.pop(); return false;
  };
  // Candidate discovery and final delivery are separate budgets. In archive
  // recall, rotate records, state bundles and independent source ranges so a
  // long memory's siblings cannot consume every slot before source evidence.
  // State + qualifying source context is atomic at final rendering.
  if(!modelSelected)for (const answer of answers) answer.evidence.sort((a,b) => Number(a.kind === "quote") - Number(b.kind === "quote") || (a.kind === "quote" && b.kind === "quote"
    ? a.bundleKey?.startsWith("provided-source:")&&b.bundleKey?.startsWith("provided-source:")?0
      : Number(Boolean(b.bundleKey?.startsWith("provided-source:")))-Number(Boolean(a.bundleKey?.startsWith("provided-source:"))) || rank(b.text) - rank(a.text) : 0));
  if(options.archiveView&&!options.seedMemoryId){
    for(let question=0;question<answers.length;question++){
      const groups=new Map<string,McpEvidence[]>();
      for(const evidence of answers[question]!.evidence){
        const key=evidence.bundleKey??evidence.atomKey;
        const group=groups.get(key)??[];group.push(evidence);groups.set(key,group);
      }
      const lanes=modelSelected?[[...groups.values()]]:[...groups.values()].reduce<McpEvidence[][][]>((lanes,group)=>{
        lanes[group.some(e=>e.atomKey.startsWith("state:"))?0:group.some(e=>e.kind!=="quote")?1:group.some(e=>e.bundleKey?.startsWith("provided-source:"))?2:3]!.push(group);return lanes;
      },[[],[],[],[]]);
      for(let index=0;index<Math.max(...lanes.map(lane=>lane.length));index++)for(const lane of lanes){
        const group=lane[index];if(!group)continue;
        const before=[...retained[question]!.evidence];
        if(!group.every(evidence=>tryAdd(question,evidence,targetBudget)))retained[question]!.evidence=before;
      }
    }
  }else{
  for(let question=0;question<answers.length;question++){
    const supplied=answers[question]!.alreadyProvidedEvidence?.[0];if(supplied)tryAdd(question,supplied,hardBudget,true);
  }
  for(let question=0;question<answers.length;question++){
    const primary=answers[question]!.evidence[0];if(primary)tryAdd(question,primary,hardBudget);
  }
  const max=Math.max(0,...answers.map(answer=>answer.evidence.length));
  for(let index=1;index<max;index++)for(let question=0;question<answers.length;question++){
    const evidence=answers[question]!.evidence[index];if(evidence)tryAdd(question,evidence,targetBudget);
  }
  }
  for (const answer of retained) {
    answer.alreadyProvidedEvidence = answer.evidence.filter(evidence => supplied.has(evidence.atomKey));
    answer.alreadyPresent = Boolean(answer.alreadyProvidedEvidence.length);
  }
  const keys = new Set(retained.flatMap(answer => answer.evidence.map(evidence => evidence.atomKey)));
  const alreadyProvidedAtomKeys = [...new Set(retained.flatMap(answer => (answer.alreadyProvidedEvidence ?? []).map(evidence => evidence.atomKey)))];
  result.mcpFollowableMemoryIds = [...records.eligibleAtomKeysByMemory].flatMap(([memoryId, atomKeys]) =>
    answers.some((answer, index) => retained[index]?.evidence.length === 0 && !retained[index]?.alreadyProvidedEvidence?.length && answer.evidence.some(evidence =>
      evidence.memoryId === memoryId && atomKeys.has(evidence.atomKey) && !keys.has(evidence.atomKey) && !supplied.has(evidence.atomKey)))
      ? [memoryId] : []);
  result.selected = result.eligibleCandidates.flatMap(item => {
    const summaryDelivered = item.atomAccessVersion === 0 && keys.has(memorySummaryAtomKey(item)!);
    const filtered = { ...item, title: summaryDelivered ? item.title : "", content: summaryDelivered ? item.content : "", atomAccessVersion: summaryDelivered ? 0 : 1,
      details: item.details.filter(detail => keys.has(memoryDetailAtomKey(detail))),
      keyDialogues: item.keyDialogues.filter(dialogue => keys.has(memoryDialogueAtomKey(item.id, dialogue))) };
    return memoryAtomKeys(filtered).length ? [filtered] : [];
  });
  result.deliveredAtomKeys = [...keys];
  result.deliveredSourceRanges = [...new Map(retained.flatMap(answer=>answer.evidence.flatMap(evidence=>evidence.dialogueSourceRanges ?? (evidence.sourceRange?[evidence.sourceRange]:[])))
    .map(range=>[`${range.messageId}:${range.start}:${range.end}`,range])).values()];
  result.structuredManifest = { ...emptyPacketManifest(), atomKeys: [...keys],
    memoryIds: [...new Set(retained.flatMap(answer => answer.evidence.flatMap(evidence => evidence.memoryId ? [evidence.memoryId] : [])))],
    detailIds: result.selected.flatMap(item => item.details.map(detail => detail.id)),
  };
  result.coverage = retained.map(answer => ({ aspect: answer.question,
    status: answer.evidence.length ? "related" : answer.alreadyPresent ? "already_present" : "no_grounded_hit",
    memoryIds: [...new Set(answer.evidence.flatMap(evidence => evidence.memoryId ? [evidence.memoryId] : []))],
  }));
  result.answers = retained;
  result.packet = renderMcpAnswer(retained);
  result.estimatedTokens = estimateTokens(result.packet);
  // Candidate delivery intentionally writes neither recall logs nor strength.
  if (result.diagnostics) {
    const keptIds = new Set(result.structuredManifest.memoryIds);
    Object.assign(result.diagnostics, { mcpSelector:selectorDiagnostic, mcpSourceContext: sourceContext, mcpProvidedSourceContext: providedSourceContext, mcpRerank: rerank, mcpSourceSpans: sourceSpans,
      mcpResponseBudget:{target:targetBudget,hard:hardBudget,used:result.estimatedTokens}, referenceMemoryId: options.referenceMemoryId,
      refConflict: Boolean(options.referenceMemoryId && !records.memoryIds.includes(options.referenceMemoryId)), mcpRecordSelection: retained.map(answer => ({question:answer.question, atomKeys:answer.evidence.map(entry=>entry.atomKey), includesSupplied:answer.alreadyPresent})) });
    result.diagnostics.selectedIds = [...keptIds];
    result.diagnostics.usedTokens = result.estimatedTokens;
    for (const candidate of result.diagnostics.candidates) candidate.outcome = keptIds.has(candidate.id) ? "selected" : records.memoryIds.includes(candidate.id) || records.sourceMemoryIds.includes(candidate.id) ? "final_packet_trim" : "not_reserved";
    Object.assign(result.diagnostics, { mcpFinalizationMs: performance.now() - sourceStarted });
    Object.assign(result.diagnostics, { alreadyProvidedAtomKeys });
  }
  return { answers: retained, rerank, sourceSpans, selector:selectorDiagnostic };
}
