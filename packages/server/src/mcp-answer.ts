import { buildEmissionPlan, omitStateLinkedDetails, buildManifest, emittedMemoryItems, factReasonsFor, memoryFactReasons, planMemoryCard, type EmissionPlan, type FactSelectedMemory } from "./emission-plan.js";
import { chatPacketPricing, chargedSectionTokens, chargedPacketTokens } from "./charged-cost.js";
import { plotBundleDetailIds } from "./automatic-packet.js";
import { storedNarrationViewpoint } from "./perspectives.js";
import { appendMcpSourceContext, prepareMcpSourcePresentation } from "./mcp-source-context.js";
import { evidenceRanker, memoryDetailEvidence, memoryPlotEvidence, rankMcpRecords } from "./mcp-evidence.js";
import { segmentSentences, emitsMemoryPlot, estimateTokens, isAuthorCard, renderMcpAnswer, unrepeatedMcpEvidence, mcpSourcePresentation, type McpEvidence, type McpQuestionAnswer, type McpSourceRange, type MemoryContextItem } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { selectFactReasons, type retrieve, type RetrievalAudience } from "./retrieval.js";
import type { SemanticSearchResult } from "./embedding.js";
import { memoryAtomKeys, memoryDetailAtomKey, memoryDialogueAtomKey, memorySummaryAtomKey } from "./memory-atoms.js";
import { retrieveSourceEvidence, sourceEvidenceAtomKey, type SourceEvidenceItem } from "./source-evidence.js";
import { targetDetailSourceEvidence } from "./target-source-evidence.js";
import { type McpRerankDiagnostic } from "./mcp-rerank.js";
import type { EvidenceReranker } from "./reranker.js";
import { type McpSourceSpanDiagnostic } from "./mcp-source-span.js";
import { collectStateEvidence, selectStateEvidence, stateMcpEvidence, type StateEvidence } from "./state-evidence.js";
import { McpSelector, type SelectorDiagnostic } from "./mcp-selector.js";
import { mcpEvidenceVersion, selectorBundles } from "./mcp-selector-bundles.js";

/** Only a delivered current recognition row replaces the Names pair. */
export function mcpRecognitionIds(answers: McpQuestionAnswer[]): Set<string> {
  return new Set(answers.flatMap(answer=>[...(answer.alreadyProvidedEvidence??[]),...answer.evidence]
    .flatMap(entry=>entry.recognitionId ? [entry.recognitionId] : [])));
}

/** Rendering and accounting consume the same final plan, including budget omissions. */
export function renderAuthorMcpAnswer(answers: McpQuestionAnswer[], plan: EmissionPlan, candidates: MemoryContextItem[],
  reference: (id: string) => string | undefined = () => undefined, viewpoint?: string, supplied: ReadonlySet<string> = new Set()): string {
  const items = emittedMemoryItems(plan);
  return renderMcpAnswer(answers,reference,{viewpoint,cards:plan.cards.map((card,index)=>({...card,item:{...items[index]!,content:card.item.content},
    moreDetails:candidates.find(item=>item.id===card.memoryId)?.details.some(detail=>!card.detailIds.includes(detail.id) && !supplied.has(memoryDetailAtomKey(detail)))}))});
}

export async function finalizeMcpAnswer(db: RcmDatabase, chatId: string, result: ReturnType<typeof retrieve>, options: {
  memoryOnlyInjection?: boolean;
  audience?: RetrievalAudience; archiveView?: boolean; query: string; aspects?: string[]; tokenBudget: number; perspectives: string[]; promptIds?: string[]; excludedAtoms: string[];
  semantic: SemanticSearchResult[]; seedMemoryId?: string; referenceMemoryId?: string; reranker?: EvidenceReranker;
  excludedSourceRanges?: McpSourceRange[];
  currentMessageId?: string;
  stateEvidence?: () => StateEvidence[];
  selector?: Pick<McpSelector,"publicConfig"|"select">; signal?:AbortSignal; isCurrent?:()=>boolean;
}): Promise<{ answers: McpQuestionAnswer[]; rerank: McpRerankDiagnostic; sourceSpans: McpSourceSpanDiagnostic; selector?:SelectorDiagnostic; timings: Record<string, number> }> {
  if (options.audience) options = { ...options, archiveView: options.audience.kind === "author" };
  const sourceStarted = performance.now();
  const pricing = chatPacketPricing(db,chatId);
  const timings = { pricingReadMs: performance.now() - sourceStarted, evidenceVersionReadMs: 0,
    recordRankingMs: 0, stateEvidenceMs: 0, sourceContextMs: 0, sourceRankSetupMs: 0, detailBundleLookupMs: 0,
    sourceMetadataMs: 0, sourceMetadataReads: 0, selectorInputBuildMs: 0, selectorSourceOrderReadMs: 0,
    selectorAwaitMs: 0, sourcePresentationMs: 0, viewpointReadMs: 0, assemblySetupMs: 0, budgetFitMs: 0,
    budgetFitPasses: 0, finalAssemblyMs: 0, finalRenderMs: 0 };
  let stageStarted = performance.now();
  const useSelector=Boolean(options.selector?.publicConfig.enabled&&options.archiveView&&!options.seedMemoryId);
  const version=useSelector?mcpEvidenceVersion(db,chatId):undefined;
  if (useSelector) timings.evidenceVersionReadMs = performance.now() - stageStarted;
  stageStarted = performance.now();
  const supplied = new Set(options.excludedAtoms);
  const promptSources = new Set([...(options.promptIds ?? []), ...(options.currentMessageId ? [options.currentMessageId] : [])]);
  // Selector input may read visible chat; exact source output may not repeat it.
  // Keep authored facts/dialogue and their existing coverage rules unchanged.
  const deliverableEvidence = (entry: McpEvidence) => entry.kind !== "quote"
    || !promptSources.has((entry.sourceRange ?? entry[mcpSourcePresentation]?.range)?.messageId ?? "");
  // Authorization materializes the candidate set. Hit-only emission follows
  // MCP ranking and fitting, so a missing automatic hit cannot hide a fact here.
  const candidates = result.eligibleCandidates;
  const records = rankMcpRecords(candidates, options.query, options.aspects ?? [], options.semantic, supplied, options.seedMemoryId, { searchEnvelopes: result.mcpSearchEnvelopes, referenceMemoryId: options.referenceMemoryId, archiveView: options.archiveView });
  const answers: McpQuestionAnswer[] = records.answers;
  // Delivery state does not change candidate eligibility. Keep supplied plots
  // as status, while leaving their prose out of fitting, rendering and receipts.
  const suppliedPlots = new Set(candidates.filter(item=>emitsMemoryPlot(item) && supplied.has(memorySummaryAtomKey(item) ?? "")).map(item=>memorySummaryAtomKey(item)!));
  const providedPlots = answers.map(answer=>answer.evidence.filter(evidence=>suppliedPlots.has(evidence.atomKey)));
  for (const answer of answers) answer.evidence=answer.evidence.filter(evidence=>!suppliedPlots.has(evidence.atomKey));
  timings.recordRankingMs = performance.now() - stageStarted;
  stageStarted = performance.now();
  const stateEvidence = !options.memoryOnlyInjection && options.archiveView && !options.seedMemoryId
    ? (options.stateEvidence?.() ?? collectStateEvidence(db,chatId)) : [];
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
  timings.stateEvidenceMs = performance.now() - stageStarted;
  stageStarted = performance.now();
  let rankEvidence: ReturnType<typeof evidenceRanker> | undefined;
  const rank = (text: string) => {
    if (!rankEvidence) {
      const started = performance.now();
      const corpus = candidates.flatMap(item => [item.title, item.content, ...item.details.map(detail => detail.text), ...item.keyDialogues.map(dialogue => dialogue.text)]);
      rankEvidence = evidenceRanker(options.query, corpus);
      timings.sourceRankSetupMs = performance.now() - started;
    }
    return rankEvidence(text);
  };
  const bound = options.archiveView ? {items:[],atomKeys:[]} : targetDetailSourceEvidence(db, chatId, records.detailIds, options.perspectives, options.tokenBudget,
    options.excludedAtoms, options.promptIds ?? []);
  // Character source coordinates are display-only. Preserve its existing
  // admission, overlap accounting and public evidence projection.
  const sourcePresentationFor = (item:SourceEvidenceItem) => item.startOffset===undefined||item.endOffset===undefined
    ? undefined : {ordinal:item.ordinal,range:{messageId:item.messageId,start:item.startOffset,end:item.endOffset}};
  if (bound.items.length) {
    // Only character-scoped detail sources use this lookup. Keep the first
    // answer atom's bundle when several answers carry the same detail.
    const started = performance.now();
    const bundleByAtom = new Map<string, string | undefined>();
    for (const answer of answers) for (const entry of answer.evidence) {
      if (!bundleByAtom.has(entry.atomKey)) bundleByAtom.set(entry.atomKey, entry.bundleKey);
    }
    const targetDetails = new Set(bound.items.map(item => item.bundleKey));
    const detailBundles = new Map(candidates.flatMap(candidate => candidate.details.filter(detail => targetDetails.has(detail.id))
      .map(detail => [detail.id, bundleByAtom.get(memoryDetailAtomKey(detail))] as const)));
    timings.detailBundleLookupMs = performance.now() - started;
    for (const answer of answers) {
      const id = answer.evidence[0]?.memoryId;
      const evidence = bound.items.filter(item => item.memoryId === id);
      for (const item of evidence) if (!answer.evidence.some(entry => entry.text === item.quote)) answer.evidence.push({
        atomKey:sourceEvidenceAtomKey(item), bundleKey:detailBundles.get(item.bundleKey ?? ""), memoryId:item.memoryId, kind:"quote", text:item.quote,
        speaker:item.speaker ?? undefined, knownBy:item.holders, basis:item.epistemic,
        [mcpSourcePresentation]:sourcePresentationFor(item),
      });
    }
  }
  if (!options.archiveView && !options.seedMemoryId) {
    const sources = retrieveSourceEvidence(db, chatId, options.query, options.perspectives, options.tokenBudget,
      options.promptIds ?? [], options.semantic.flatMap(view => view.sourceHits ?? []), [], bound.atomKeys,
      quote => rank(quote) >= .12, { rank: quote => rank(quote), maxItems:2, budgetRatio:.3 });
    if (sources.items.length) answers[0]?.evidence.push(...sources.items.map(item => ({atomKey:sourceEvidenceAtomKey(item),
      kind:"quote" as const,text:item.quote,speaker:item.speaker ?? undefined,knownBy:item.holders,basis:item.epistemic,[mcpSourcePresentation]:sourcePresentationFor(item)})));
  }
  const sourceContext = options.archiveView
    ? appendMcpSourceContext(db, chatId, answers, candidates.filter(item => records.memoryIds.includes(item.id) || records.sourceMemoryIds.includes(item.id)
      || item.id === options.seedMemoryId && options.semantic.some(view=>view.sourceHits?.length)), options.semantic, options.tokenBudget, options.query,
      // Expand must exclude visible windows before ranking and the ten-window
      // cap. Recall retains them as selector input until the final output gate.
      options.seedMemoryId ? [...promptSources] : options.currentMessageId ? [options.currentMessageId] : [], Boolean(options.seedMemoryId), options.promptIds, useSelector, records.sourceMemoryIds, stateEvidence, records.queryRelevantAtomKeys)
    : undefined;
  if (!answers.length) answers.push({question:options.query,evidence:[],alreadyPresent:false,relatedRecords:true,searchUnavailable:options.semantic[0]?.searchUnavailable});
  timings.sourceContextMs = performance.now() - stageStarted;
  timings.sourceMetadataMs = sourceContext?.metadataMs ?? 0;
  timings.sourceMetadataReads = sourceContext?.metadataReads ?? 0;
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
    stageStarted = performance.now();
    const bundles=selectorBundles(db,chatId,options.query,answers,options.selector!.publicConfig.maxInputTokens);
    timings.selectorInputBuildMs = performance.now() - stageStarted;
    timings.selectorSourceOrderReadMs = bundles.sourceOrderReadMs;
    stageStarted = performance.now();
    const selection=await options.selector!.select(options.query,bundles.candidates,options.signal??new AbortController().signal,Math.max(128,options.tokenBudget-200),chatId);
    timings.selectorAwaitMs = performance.now() - stageStarted;
    selectorDiagnostic=selection.diagnostic;
    selectorDiagnostic.bundles=[...bundles.manifest].map(([id,evidence])=>({id,atomKeys:evidence.map(e=>e.atomKey)}));
    stageStarted = performance.now();
    const stale = options.signal?.aborted || options.isCurrent?.()===false || version!==mcpEvidenceVersion(db,chatId);
    timings.evidenceVersionReadMs += performance.now() - stageStarted;
    stageStarted = performance.now();
    if(stale){
      selectorDiagnostic.outcome="stale";selectorDiagnostic.failure="canonical_changed";
      for(const answer of answers){answer.evidence=[];answer.searchUnavailable=true;}
    }else if(selection.ids!==undefined){
      modelSelected=true;
      answers[0]!.synthesizedText=selection.answer;
      answers[0]!.synthesizedReferences=Object.fromEntries(selection.ids.map(id=>[id,
        [...new Set((bundles.manifest.get(id)??[]).filter(deliverableEvidence).flatMap(entry=>entry.memoryId?[entry.memoryId]:[]))]]));
      answers[0]!.evidence=selection.ids.flatMap(id=>bundles.manifest.get(id)??[]);
      for(const answer of answers.slice(1))answer.evidence=[];
    }
    timings.assemblySetupMs += performance.now() - stageStarted;
  }
  stageStarted = performance.now();
  for (const answer of answers) answer.evidence = answer.evidence.filter(deliverableEvidence);
  prepareMcpSourcePresentation(db,chatId,answers);
  timings.sourcePresentationMs = performance.now() - stageStarted;
  stageStarted = performance.now();
  for (const [index,answer] of answers.entries()) {
    answer.alreadyProvidedEvidence = [];
    answer.alreadyPresent = Boolean(providedPlots[index]?.length) || answer.evidence.some(evidence => supplied.has(evidence.atomKey));
  }
  const retained = answers.map(answer => ({ ...answer, evidence: [] as typeof answer.evidence,
    alreadyProvidedEvidence: [] as McpEvidence[] }));
  const planFor = (entries: McpQuestionAnswer[]): EmissionPlan => {
    const evidence=entries.flatMap(answer=>answer.evidence);
    const keys=new Set(evidence.map(entry=>entry.atomKey));
    const selected = result.eligibleCandidates.filter(item=>evidence.some(entry=>entry.memoryId===item.id)).map((item):FactSelectedMemory=>{
      const reasons = new Map(factReasonsFor(item));
      // Fitting selects explicit atom keys, including unfocused ref expansion.
      // Merely loading a sibling into the candidate pool grants no reason.
      for (const detail of item.details) if (keys.has(memoryDetailAtomKey(detail))) {
        reasons.set(detail.id,[...new Set([...(reasons.get(detail.id) ?? []),...selectFactReasons({mcpAtomRef:true})])]);
      }
      return {...item,[memoryFactReasons]:reasons};
    });
    const plan=buildEmissionPlan(selected,
      {promptSourceMessageIds:options.promptIds,excludedAtomKeys:supplied,excludeLineAtoms:false});
    for(const card of plan.cards){
      if(!keys.has(memorySummaryAtomKey(card.item)??""))card.plot="omit";
      card.detailIds=evidence.flatMap(entry=>card.item.details.filter(detail=>memoryDetailAtomKey(detail)===entry.atomKey).map(detail=>detail.id));
      card.detailIds=[...new Set(card.detailIds)];
      card.dialogueIds=card.item.keyDialogues.filter(dialogue=>keys.has(memoryDialogueAtomKey(card.memoryId,dialogue)))
        .map(dialogue=>dialogue.id??memoryDialogueAtomKey(card.memoryId,dialogue));
    }
    const stateKeys=new Set(evidence.map(entry=>entry.atomKey));
    omitStateLinkedDetails(plan,new Set(stateEvidence.filter(item=>stateKeys.has(stateMcpEvidence(item).atomKey)).flatMap(item=>item.linkedDetailIds ?? [])));
    return plan;
  };
  const viewpointStarted = performance.now();
  const viewpoint=options.archiveView ? storedNarrationViewpoint(db,chatId) : undefined;
  timings.viewpointReadMs = performance.now() - viewpointStarted;
  // Compare the stable single-row presentation (including access/qualifiers),
  // preserving deduplication identity across belief wording changes.
  const storedText = (item: typeof stateEvidence[number]) => (item.dedupeText ?? item.displayText ?? "").trim().replace(/[.!?。！？]$/u, "").trimEnd();
  const historyReplacements = new Map(stateEvidence.flatMap(item=>{
    if (!item.currentItemId) return [];
    const current = stateEvidence.find(entry=>entry.id===item.currentItemId);
    if (!current) return [];
    const render = (evidence: McpEvidence) => renderMcpAnswer([{question:"",evidence:[evidence],alreadyPresent:false}]);
    const presentation = (entry:typeof item) => render(stateMcpEvidence({...entry,current:current.current,historyLabel:undefined,
      text:"[stored text]",displayText:entry.kind==="belief"&&entry.automatic?undefined:"[stored text]",
      // The structured belief subject carries its stance outside the body.
      automatic:entry.automatic?{...entry.automatic,body:"[stored text]"}:undefined}));
    // Exact stored-string containment, not a judgement about natural-language meaning.
    const previous=storedText(item),contained=Boolean(previous&&storedText(current).includes(previous)
      &&item.kind===current.kind&&presentation(item)===presentation(current));
    const identical=render(stateMcpEvidence({...current,displayText:current.dedupeText ?? current.displayText})) === render(stateMcpEvidence({...item,kind:current.kind,
      current:current.current,historyLabel:undefined,displayText:item.dedupeText ?? item.displayText}));
    return identical||contained
      ? [[stateMcpEvidence(item).atomKey,{key:stateMcpEvidence(current).atomKey,contained}] as const] : [];
  }));
  // Collection has already validated lifecycle, evidence and access. A linked
  // successor need not rank for this query to be required context for history.
  const historySuccessors = new Map(stateEvidence.flatMap(item=>{
    const current = item.currentItemId && stateEvidence.find(entry=>entry.id===item.currentItemId);
    return current && current.current && current.automatic?.scope !== null
      ? [[stateMcpEvidence(item).atomKey,stateMcpEvidence(current)] as const] : [];
  }));
  const withoutRepeatedHistory = (entries: McpQuestionAnswer[]): McpQuestionAnswer[] => {
    const keys = new Set(entries.flatMap(answer=>answer.evidence.map(entry=>entry.atomKey)));
    return entries.map(answer=>({...answer,evidence:answer.evidence.filter(entry=>{
      const replacement = historyReplacements.get(entry.atomKey);
      return !replacement || !(keys.has(replacement.key) || replacement.contained && supplied.has(replacement.key));
    })}));
  };
  const fittedTokens = () => {
    timings.budgetFitPasses++;
    const visible = withoutRepeatedHistory(retained);
    if(!options.archiveView)return estimateTokens(renderMcpAnswer(visible,()=>"m0000000000000000"));
    const plan=planFor(visible);
    const packet=renderAuthorMcpAnswer(visible,plan,result.eligibleCandidates,()=>"m0000000000000000",undefined,supplied);
    return plan.cards.length ? chargedPacketTokens(packet,plan,pricing) : chargedSectionTokens(packet,pricing);
  };
  const targetBudget=options.tokenBudget;
  const hardBudget=options.tokenBudget;
  timings.assemblySetupMs += performance.now() - stageStarted - timings.viewpointReadMs;
  stageStarted = performance.now();
  // Reserve the complete answer before adding whole evidence bundles. Only if
  // the answer alone exceeds the cap, remove trailing complete sentences;
  // never slice a sentence or an exact source passage to fill a token slot.
  for (const answer of retained) {
    while (answer.synthesizedText && fittedTokens() > hardBudget) {
      const sentences=segmentSentences(answer.synthesizedText).map(part=>part.segment);
      sentences.pop();answer.synthesizedText=sentences.join("").trimEnd();
    }
  }
  const coreKeys = new Set(result.eligibleCandidates.flatMap(item => {
    const card = planMemoryCard(item);
    return [...(card.shape === 1 && card.plot === "emit" ? [memorySummaryAtomKey(item)!] : []),...item.details
      .filter(detail => card.shape === 1 ? card.minimumUnitIds.includes(detail.id) : detail.role === "core").map(memoryDetailAtomKey)];
  }));
  const budgetOmittedPlots = new Set<string>();
  const plotFor = (evidence: McpEvidence) => candidates.find(item => item.id === evidence.memoryId && emitsMemoryPlot(item) && !suppliedPlots.has(memorySummaryAtomKey(item)!));
  const admitPlot = (question:number,evidence:McpEvidence,budget:number) => {
    if (!options.archiveView || supplied.has(evidence.atomKey)) return;
    const target=retained[question]!.evidence;
    const plot=plotFor(evidence);
    if (plot && !budgetOmittedPlots.has(plot.id) && !target.some(entry=>entry.atomKey===memorySummaryAtomKey(plot))) {
      const bundleIds=plotBundleDetailIds(plot);
      // Focus ranks optional atoms; the minimum unit comes from the authorized card, not the shortlist.
      const bundle=[memoryPlotEvidence(plot),...plot.details.filter(detail=>bundleIds.has(detail.id)).map(detail=>memoryDetailEvidence(plot,detail))]
        .filter(entry=>!supplied.has(entry.atomKey) && !target.some(old=>old.atomKey===entry.atomKey));
      target.push(...bundle);
      if (fittedTokens()>budget) {
        target.splice(target.length-bundle.length);
        budgetOmittedPlots.add(plot.id);
      }
    }
  };
  const tryAdd=(question:number,evidence:McpEvidence,budget:number,provided=false)=>{
    const target=provided?retained[question]!.alreadyProvidedEvidence!:retained[question]!.evidence;
    // Delivery history affects final author emission, never record ranking.
    if (options.archiveView && supplied.has(evidence.atomKey)) return true;
    admitPlot(question,evidence,budget);
    const plot=plotFor(evidence);
    if (options.archiveView && plot && isAuthorCard(plot) && budgetOmittedPlots.has(plot.id)) return false;
    if (options.archiveView && plot && evidence.atomKey===memorySummaryAtomKey(plot) && budgetOmittedPlots.has(plot.id)) return true;
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
    const core = (!options.archiveView || candidates.some(item=>item.id===evidence.memoryId && !isAuthorCard(item))) && evidence.memoryId && !coreKeys.has(evidence.atomKey)
      && !target.some(entry => entry.memoryId === evidence.memoryId && coreKeys.has(entry.atomKey))
      ? answers[question]!.evidence.filter(entry => entry.memoryId === evidence.memoryId && coreKeys.has(entry.atomKey))
        .sort((a,b) => rank(b.text)-rank(a.text))[0] : undefined;
    const context = core ?? (evidence.kind === "dialogue" && !evidence.context
      ? answers[question]!.evidence.find(entry => entry.kind === "fact" && entry.memoryId === evidence.memoryId && !target.some(old => old.atomKey === entry.atomKey)) : undefined);
    if (evidence.kind === "dialogue" && !evidence.context && !context && !target.some(entry => entry.kind === "fact" && entry.memoryId === evidence.memoryId)) return false;
    if (target.some(entry => entry.atomKey === evidence.atomKey)) return true;
    const plotEvidence = !options.archiveView && plot ? memoryPlotEvidence(plot) : undefined;
    const successor = historySuccessors.get(evidence.atomKey);
    const requiredCurrent = successor && !retained.some(answer=>answer.evidence.some(entry=>entry.atomKey===successor.atomKey))
      ? successor : undefined;
    const additions = [...new Map([requiredCurrent,plotEvidence,context,evidence].filter((entry):entry is McpEvidence=>Boolean(entry))
      .filter(entry=>!options.archiveView || !supplied.has(entry.atomKey))
      .filter(entry=>!target.some(old=>old.atomKey===entry.atomKey)).map(entry=>[entry.atomKey,entry])).values()];
    target.push(...additions);
    const stateTokens = withoutRepeatedHistory(retained).flatMap(answer=>answer.evidence)
      .filter(item=>item.atomKey.startsWith("state:")).reduce((sum,item)=>sum+estimateTokens(item.text),0);
    if ((!evidence.atomKey.startsWith("state:") || stateTokens <= Math.floor(budget * .3)) && fittedTokens()<=budget) return true;
    target.splice(target.length-additions.length); return false;
  };
  // Candidate discovery and final delivery are separate budgets. In archive
  // recall, rotate records, state bundles and independent source ranges so a
  // long memory's siblings cannot consume every slot before source evidence.
  // State + qualifying source context is atomic at final rendering.
  if(!modelSelected)for (const answer of answers) answer.evidence.sort((a,b) => Number(a.kind === "quote") - Number(b.kind === "quote") || (a.kind === "quote" && b.kind === "quote"
    ? a.bundleKey?.startsWith("provided-source:")&&b.bundleKey?.startsWith("provided-source:")?0
      : Number(Boolean(b.bundleKey?.startsWith("provided-source:")))-Number(Boolean(a.bundleKey?.startsWith("provided-source:"))) || rank(b.text) - rank(a.text) : 0));
  if(options.archiveView&&!options.seedMemoryId){
    // A removed history row leaves useful source depth, not a new state bundle.
    const visibleCandidateKeys=new Set(withoutRepeatedHistory(answers).flatMap(answer=>answer.evidence.map(entry=>entry.atomKey)));
    for(let question=0;question<answers.length;question++){
      const groups=new Map<string,McpEvidence[]>();
      for(const evidence of answers[question]!.evidence){
        const key=evidence.bundleKey??evidence.atomKey;
        const group=groups.get(key)??[];group.push(evidence);groups.set(key,group);
      }
      const addsNewAtom=(group:McpEvidence[])=>group.some(e=>e.kind!=="quote"&&!supplied.has(e.atomKey)&&visibleCandidateKeys.has(e.atomKey));
      const citedGroups=[...groups.values()];
      // Keep citation order within each pass. Supplied anchors and removed
      // history can still contribute exact source depth after new information.
      const lanes=modelSelected?[[...citedGroups.filter(addsNewAtom),...citedGroups.filter(group=>!addsNewAtom(group))]]:citedGroups.reduce<McpEvidence[][][]>((lanes,group)=>{
        lanes[group.some(e=>visibleCandidateKeys.has(e.atomKey)&&e.atomKey.startsWith("state:"))?0:group.some(e=>visibleCandidateKeys.has(e.atomKey)&&e.kind!=="quote")?1:group.some(e=>e.bundleKey?.startsWith("provided-source:"))?2:3]!.push(group);return lanes;
      },[[],[],[],[]]);
      for(let index=0;index<Math.max(...lanes.map(lane=>lane.length));index++)for(const lane of lanes){
        const group=lane[index];if(!group)continue;
        // Optional evidence/source bundles may fail without discarding a fitted plot bundle.
        for (const evidence of group) admitPlot(question,evidence,targetBudget);
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
  timings.budgetFitMs = performance.now() - stageStarted;
  stageStarted = performance.now();
  for (const [index,answer] of retained.entries()) {
    answer.alreadyProvidedEvidence = answer.evidence.filter(evidence => supplied.has(evidence.atomKey));
    answer.alreadyPresent = Boolean(answer.alreadyProvidedEvidence.length || providedPlots[index]?.length
      || options.archiveView && answers[index]?.alreadyPresent);
  }
  const visible = withoutRepeatedHistory(retained);
  const covered: McpSourceRange[]=[];
  const seedMemoryId = options.seedMemoryId;
  const semanticExpand = seedMemoryId && options.query.trim() && (sourceContext?.semanticRanked
    || options.semantic.some(view => (view.hits.get(seedMemoryId)?.score ?? 0) >= .35));
  let sourceWindows = 0;
  for (const [index,answer] of retained.entries()) {
    const evidence=visible[index]!.evidence;
    const deduped = unrepeatedMcpEvidence(evidence,covered);
    // Apply the response limit after fitting and deduplication. The ten
    // source candidates still compete in the existing assembler order.
    answer.evidence = semanticExpand ? deduped.filter(entry => entry.kind !== "quote" || sourceWindows++ < 5) : deduped;
    if(evidence.length && !deduped.length)answer.alreadyPresent=true;
  }
  const keys = new Set(retained.flatMap(answer => answer.evidence.map(evidence => evidence.atomKey)));
  const alreadyProvidedAtomKeys = [...new Set([...providedPlots.flat().map(evidence=>evidence.atomKey),...retained.flatMap(answer => (answer.alreadyProvidedEvidence ?? []).map(evidence => evidence.atomKey))])];
  result.mcpFollowableMemoryIds = [...records.eligibleAtomKeysByMemory].flatMap(([memoryId, atomKeys]) =>
    answers.some((answer, index) => retained[index]?.evidence.length === 0 && !retained[index]?.alreadyProvidedEvidence?.length && answer.evidence.some(evidence =>
      evidence.memoryId === memoryId && atomKeys.has(evidence.atomKey) && !keys.has(evidence.atomKey) && !supplied.has(evidence.atomKey)))
      ? [memoryId] : []);
  result.emissionPlan = planFor(retained);
  result.selected = emittedMemoryItems(result.emissionPlan);
  result.deliveredAtomKeys = [...keys];
  result.deliveredSourceRanges = [...new Map(retained.flatMap(answer=>answer.evidence.flatMap(evidence=>evidence.dialogueSourceRanges ?? (evidence.sourceRange?[evidence.sourceRange]:[])))
    .map(range=>[`${range.messageId}:${range.start}:${range.end}`,range])).values()];
  const memoryKeys = new Set(result.eligibleCandidates.flatMap(memoryAtomKeys));
  result.emissionPlan.laneRows.push(...[...keys].filter(key=>!memoryKeys.has(key)).map(id=>({lane:"atomKeys",id})));
  result.structuredManifest = buildManifest(result.emissionPlan);
  result.coverage = retained.map(answer => ({ aspect: answer.question,
    status: answer.evidence.length ? "related" : answer.alreadyPresent ? "already_present" : "no_grounded_hit",
    memoryIds: [...new Set(answer.evidence.flatMap(evidence => evidence.memoryId ? [evidence.memoryId] : []))],
  }));
  const emittedKeys = new Set(result.structuredManifest.atomKeys);
  const emittedAnswers = retained.map(answer=>({...answer,evidence:answer.evidence.filter(evidence=>emittedKeys.has(evidence.atomKey)),
    alreadyProvidedEvidence:answer.alreadyProvidedEvidence?.filter(evidence=>emittedKeys.has(evidence.atomKey))}));
  result.answers = emittedAnswers;
  result.deliveredAtomKeys = [...emittedKeys];
  const renderStarted = performance.now();
  result.packet = options.archiveView ? renderAuthorMcpAnswer(emittedAnswers,result.emissionPlan,result.eligibleCandidates,undefined,viewpoint,supplied)
    : renderMcpAnswer(emittedAnswers);
  result.estimatedTokens = estimateTokens(result.packet);
  timings.finalRenderMs = performance.now() - renderStarted;
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
  timings.finalAssemblyMs = performance.now() - stageStarted - timings.finalRenderMs;
  return { answers: emittedAnswers, rerank, sourceSpans, selector:selectorDiagnostic, timings };
}
