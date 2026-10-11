import { createHash } from "node:crypto";
import type { McpEvidence, McpQuestionAnswer, McpSourceRange } from "@rcm/shared";
import { aggregateRerankUsage, type AggregatedRerankUsage, type EvidenceReranker } from "./reranker.js";
import { evidenceRanker } from "./mcp-evidence.js";
import { presentationOnlySourcePassage } from "./source-evidence.js";

const MAX_SPAN_CHARACTERS = 720;
const MAX_SOURCE_SPANS_PER_QUESTION = 2;
const MAX_PROVIDED_SOURCE_SPANS_PER_QUESTION = 8;
const SECOND_SPAN_MAX_GAP = .16;
// This is a direct-evidence gate, not a relative-ranking cutoff. A source
// passage that merely comes first among weak neighbours must be omitted.
const SOURCE_SPAN_ACCEPTANCE = .55;
const PROVIDED_SOURCE_SPAN_ACCEPTANCE = .65;
const SOURCE_ANCHORED_IDENTITY_ACCEPTANCE = .65;
const SOURCE_CONTEXT_IDENTITY_ACCEPTANCE = .57;
const SOURCE_UNANCHORED_ARCHIVE_IDENTITY_ACCEPTANCE = .70;
const MIN_FACET_SEPARATION = .05;
const MAX_PROMPT_SPANS_PER_WINDOW = 5;
const MAX_BARE_REPLY_CHARACTERS = 16;

export interface McpSourceSpanDiagnostic {
  elapsedMs: number;
  calls: number;
  usage?: AggregatedRerankUsage;
  questions: Array<{ question: string; candidates: number; selected: number; scores: number[]; identityScores?:number[];
    selectedScores?:Array<{score:number;identityScore?:number}> }>;
}

type SourceSpan = { evidence: McpEvidence; sourceText: string; start: number; end: number; anchors: McpEvidence[] };

function isSourceEvidence(evidence:McpEvidence):boolean {
  return evidence.basis==="archive context"||evidence.basis==="current prompt context";
}

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

function overlaps(left: McpSourceRange | undefined, right: McpSourceRange): boolean {
  if (!left || left.messageId !== right.messageId) return false;
  return Math.max(left.start, right.start) < Math.min(left.end, right.end);
}

function preciseRange(evidence: McpEvidence, start: number, end: number): McpSourceRange | undefined {
  return evidence.sourceRange ? {
    messageId: evidence.sourceRange.messageId,
    start: evidence.sourceRange.start + start,
    end: evidence.sourceRange.start + end,
  } : undefined;
}

/** Parent-memory labels can span several locations or times. A child excerpt
 * only inherits metadata explicitly anchored to its own source coordinates. */
function metadataForSpan(evidence: McpEvidence, sourceRange: McpSourceRange | undefined): Pick<McpEvidence, "location"> {
  if (!sourceRange || !evidence.sourceMetadata?.length) return {};
  const overlapping = evidence.sourceMetadata.filter(metadata => overlaps(metadata.sourceRange, sourceRange));
  if (!overlapping.length || overlapping.some(metadata => metadata.sourceRange.messageId !== sourceRange.messageId
    || metadata.sourceRange.start > sourceRange.start || metadata.sourceRange.end < sourceRange.end)) return {};
  const values = overlapping.map(metadata => metadata.location);
  return { location: values.length && values.every(value => typeof value === "string" && value === values[0]) ? values[0] : undefined };
}

function sentenceRanges(text: string): Array<{ start: number; end: number }> {
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
    return [...segmenter.segment(text)].flatMap(segment => {
      const leading = segment.segment.search(/\S/u);
      if (leading < 0) return [];
      const value = segment.segment.trimEnd();
      return [{ start: segment.index + leading, end: segment.index + value.length }];
    });
  } catch {
    return [...text.matchAll(/\S[\s\S]*?(?:[.!?。！？]+(?=\s|$)|$)/gu)].map(match => ({
      start: match.index!, end: match.index! + match[0].length,
    }));
  }
}

function sourceSpans(evidence: McpEvidence, excluded: McpSourceRange[], anchors: McpEvidence[]): SourceSpan[] {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const paragraph of evidence.text.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/gu)) {
    const paragraphStart = paragraph.index!;
    const paragraphEnd = paragraphStart + paragraph[0].length;
    if (paragraph[0].length <= MAX_SPAN_CHARACTERS) ranges.push({ start: paragraphStart, end: paragraphEnd });
  }
  // Dialogue turns are sometimes separated by paragraph breaks. Keep the
  // sentence windows continuous across those breaks so a question and its
  // answer compete as one short, readable passage.
  const sentences = sentenceRanges(evidence.text);
  for (let index = 0; index < sentences.length; index++) {
    for (let count = 1; count <= 3 && index + count <= sentences.length; count++) {
      const start = sentences[index]!.start;
      const end = sentences[index + count - 1]!.end;
      if (end - start <= MAX_SPAN_CHARACTERS) ranges.push({ start, end });
    }
  }
  const unique = new Map<string, SourceSpan>();
  for (const range of ranges) {
    const text = evidence.text.slice(range.start, range.end).trim();
    if (text.length < 18 || presentationOnlySourcePassage(text)) continue;
    const sourceRange = preciseRange(evidence, range.start, range.end);
    if (sourceRange && excluded.some(item => overlaps(sourceRange, item))) continue;
    const identity = `${sourceRange?.messageId ?? "source"}:${sourceRange?.start ?? range.start}:${sourceRange?.end ?? range.end}:${text}`;
    const metadata = metadataForSpan(evidence, sourceRange);
    unique.set(identity, { sourceText: evidence.text, start: range.start, end: range.end, anchors, evidence: {
      ...evidence, atomKey: `atom:v1:${hash(identity).slice(0, 32)}`,
      bundleKey: `source-span:${hash(identity).slice(0, 24)}`, text, sourceRange,
      // Do not inherit message- or memory-level metadata without a matching
      // source anchor. It would label a correct excerpt with a later scene.
      time: undefined, location: metadata.location,
      sourceMetadata: undefined,
    }});
  }
  return [...unique.values()];
}

function rangesOverlap(left: McpSourceRange | undefined, right: McpSourceRange | undefined): boolean {
  return Boolean(left && right && overlaps(left, right));
}

function surroundingSentences(span: SourceSpan): { before?: string; after?: string } {
  const sentences = sentenceRanges(span.sourceText);
  const first = sentences.findIndex(sentence => sentence.end > span.start);
  let last = -1;
  for (let index = sentences.length - 1; index >= 0; index--) {
    if (sentences[index]!.start < span.end) { last = index; break; }
  }
  return {
    before: first > 0 ? span.sourceText.slice(sentences[first - 1]!.start, sentences[first - 1]!.end).trim() : undefined,
    after: last >= 0 && last + 1 < sentences.length
      ? span.sourceText.slice(sentences[last + 1]!.start, sentences[last + 1]!.end).trim() : undefined,
  };
}

function anchorForJudging(evidence: McpEvidence): string {
  return [evidence.kind === "dialogue" ? "Dialogue" : "Fact", evidence.speaker && `Speaker: ${evidence.speaker}`, evidence.text]
    .filter(Boolean).join("; ");
}

function referenceLeadIn(span: SourceSpan): string | undefined {
  const value = span.sourceText.slice(Math.max(0, span.start - 360), span.start).trim();
  return value || undefined;
}

function candidateForJudging(span: SourceSpan): string {
  // Preceding prompt context exists only to resolve genuinely short replies
  // such as "No" or "These fit perfectly". Repeating it beside every
  // full passage leaks the user's premise into relevance scoring and can make
  // an unrelated paragraph appear to answer the question.
  const replyContext=span.evidence.basis==="current prompt context"&&span.evidence.text.length<=MAX_BARE_REPLY_CHARACTERS
    ?span.evidence.context:undefined;
  return ["Candidate passage:",span.evidence.text,replyContext].filter(Boolean).join("\n");
}

function candidateForIdentity(span:SourceSpan):string {
  const context=surroundingSentences(span);
  const replyContext=span.evidence.basis==="current prompt context"&&span.evidence.text.length<=MAX_BARE_REPLY_CHARACTERS
    ?span.evidence.context:undefined;
  return ["Candidate passage:",span.evidence.text,
    replyContext,
    context.before&&`Nearby preceding context (identity only): ${context.before}`,
    context.after&&`Nearby following context (identity only): ${context.after}`,
    referenceLeadIn(span)&&`Earlier source context (identity only): ${referenceLeadIn(span)}`,
  ].filter(Boolean).join("\n");
}

/**
 * Produces short, exact source candidates without treating a relevance score as
 * factual verification. Each retained source window contributes at most one
 * readable excerpt, and the final response budget decides how many are shown.
 */
export function refineMcpSourceSpansLocally(
  answers: McpQuestionAnswer[],
  overallQuery: string,
  excluded: McpSourceRange[] = [],
): McpSourceSpanDiagnostic {
  const started = performance.now();
  const questions: McpSourceSpanDiagnostic["questions"] = [];
  for (const answer of answers) {
    const structured = answer.evidence.filter(evidence => !isSourceEvidence(evidence));
    const anchors = new Map<string, McpEvidence[]>();
    for (const evidence of structured) {
      const key = evidence.bundleKey ?? evidence.atomKey;
      const group = anchors.get(key) ?? [];
      group.push(evidence);
      anchors.set(key, group);
    }
    const sources = answer.evidence.filter(isSourceEvidence);
    const selected = sources.flatMap((evidence, sourceIndex) => {
      const key = evidence.bundleKey ?? evidence.atomKey;
      const spans = sourceSpans(evidence, excluded, anchors.get(key) ?? []);
      if (!spans.length) return [];
      const rank = evidenceRanker(answer.question || overallQuery, spans.map(span => span.evidence.text));
      const best = spans.map(span => ({ span, score: rank(span.evidence.text) }))
        .sort((left, right) => right.score - left.score
          || left.span.evidence.text.length - right.span.evidence.text.length)[0];
      return best ? [{ ...best, sourceIndex }] : [];
    }).sort((left, right) => left.sourceIndex - right.sourceIndex || right.score - left.score)
      .slice(0, MAX_SOURCE_SPANS_PER_QUESTION);
    answer.evidence = [...structured, ...selected.map(candidate => candidate.span.evidence)];
    questions.push({
      question: answer.question, candidates: sources.length, selected: selected.length,
      scores: selected.map(candidate => candidate.score),
      selectedScores: selected.map(candidate => ({ score: candidate.score })),
    });
  }
  return { elapsedMs: performance.now() - started, calls: 0, questions };
}

/** Narrows accepted source passages to excerpts that independently answer the
 * facet. Scene relevance supplies candidates; it does not establish that a
 * particular sentence answers the question. */
export async function refineMcpSourceSpans(
  answers: McpQuestionAnswer[],
  overallQuery: string,
  reranker: EvidenceReranker,
  excluded: McpSourceRange[] = [],
): Promise<McpSourceSpanDiagnostic> {
  const started = performance.now();
  const prepared = answers.map(answer => {
    const structured = answer.evidence.filter(evidence => !isSourceEvidence(evidence));
    const anchors = new Map<string, McpEvidence[]>();
    for (const evidence of structured) {
      const key = evidence.bundleKey ?? evidence.atomKey;
      const group = anchors.get(key) ?? [];
      group.push(evidence);
      anchors.set(key, group);
    }
    const spans = [...new Map(answer.evidence.filter(isSourceEvidence).flatMap(evidence => {
      const key = evidence.bundleKey ?? evidence.atomKey;
      const generated=sourceSpans(evidence, excluded, anchors.get(key) ?? structured.slice(0, 3));
      if(evidence.basis!=="current prompt context")return generated;
      if(generated.length<=MAX_PROMPT_SPANS_PER_WINDOW)return generated;
      const rank=evidenceRanker(answer.question||overallQuery,generated.map(span=>span.evidence.text));
      const lexical=[...generated].sort((left,right)=>rank(right.evidence.text)-rank(left.evidence.text)
        ||left.evidence.text.length-right.evidence.text.length).slice(0,2);
      // A direct reply may use only pronouns and rank weakly by terms. Preserve
      // both source-window boundaries alongside the lexical leaders so the
      // semantic verifier can still see such replies without receiving every
      // overlapping sentence combination.
      const first=[...generated].sort((left,right)=>left.start-right.start||left.end-right.end)[0]!;
      const last=[...generated].sort((left,right)=>right.end-left.end||right.start-left.start)[0]!;
      const lastContext=[...generated].sort((left,right)=>right.end-left.end||left.start-right.start)[0]!;
      return [...new Map([...lexical,first,last,lastContext].map(span=>[span.evidence.atomKey,span] as const)).values()];
    }).map(span => [span.evidence.atomKey, span] as const)).values()];
    return { answer, structured, spans };
  });
  const facetMembership=new Map<string,number>();
  for(const item of prepared)for(const key of new Set(item.spans.map(span=>span.evidence.atomKey)))
    facetMembership.set(key,(facetMembership.get(key)??0)+1);
  const calls = prepared.map(item => item.spans.length
    ? reranker.rerank([
      "Asserted answer passage detection.",
      `Requested detail: ${item.answer.question || overallQuery}`,
      "Rank a candidate highly only when the passage itself asserts the requested answer, not merely the same person, place, object, event, or topic.",
      "For a request asking who, the passage must identify the person or party. For a request asking whether or how, it must assert the outcome or method. Apply the analogous requirement to dates, names, reasons, actions, and dialogue.",
      "For a request asking whether a person was involved in a specific action, the passage must explicitly attribute that requested action to the person or explicitly deny it. Mentioning the same person doing a different action does not answer the request.",
      "For a request asking who, a pronoun without its named antecedent inside the candidate passage does not identify the requested party.",
      "For a request asking how someone responded, changed a plan, or acted afterward, the passage must assert that response or change. Restating the earlier preference, problem, or event does not answer what happened in response.",
      "When the request asks what a named person promised, said, or decided, the passage must attribute that statement or decision to that person. Merely addressing or mentioning the person is insufficient.",
      "Insufficient examples include: a venue without the requested work or title; attendance without the requested role; an object's appearance without whether it fit or worked; an event without the requested actor, reason, or outcome; and a question that asks for the answer without stating it.",
      "If the requested detail combines multiple facts, the candidate must explicitly supply every requested fact. One answered part does not cover the whole detail.",
      "A premise in the requested detail is not evidence. A mere scene, topic, person, place, or activity mention supplies no answer.",
      "A question or request is not evidence merely because it repeats the requested detail. User- and assistant-authored factual assertions may both answer; source role alone does not establish or reject an answer.",
      "The labeled preceding prompt context is never evidence. Use it only to resolve what a short reply in the candidate answers.",
      "Reject atmosphere, a nearby reaction, or a reply to an unrelated exchange. Apart from resolving a reply against labeled preceding context, judge nothing outside the candidate passage.",
    ].join("\n"), item.spans.map(span => ({ id: span.evidence.atomKey, text: candidateForJudging(span) })))
    : undefined);
  const results=await Promise.all(calls);
  // A relevance score alone can prefer a nearby replacement because it uses
  // the same nouns and appears elsewhere in a compound request. Verify source
  // referent identity independently, using a structured anchor when available,
  // without placing that context inside every direct-answer document. The
  // direct-answer floor is mandatory, so candidates already below their
  // basis-specific floor cannot benefit from an identity score and are not
  // sent through a second paid pass.
  const identitySpans=prepared.map((item,index)=>{
    const directScores=new Map(results[index]?.scores.map(score=>[score.id,score.score])??[]);
    return item.spans.filter(span=>{
      const floor=span.evidence.basis==="current prompt context"?PROVIDED_SOURCE_SPAN_ACCEPTANCE:SOURCE_SPAN_ACCEPTANCE;
      return (directScores.get(span.evidence.atomKey)??-Infinity)>=floor;
    });
  });
  const identityCalls=prepared.map((item,index)=>identitySpans[index]!.length
    ?reranker.rerank([
      "Occurrence identity check only.",
      `Required subject and occurrence: ${item.answer.question||overallQuery}`,
      "Critical actor check: when the required subject is a named speaker, promiser, or actor, reject a passage where someone else speaks or acts and merely addresses or mentions that subject.",
      item.structured.length&&`Anchor evidence for the intended subject and occurrence:\n${item.structured.slice(0,4).map(anchorForJudging).join("\n")}`,
      "Use the person, date, place, event, owner, and original/current/later qualifiers to identify the occurrence.",
      "Ignore words that merely name the type of answer being requested, and do not reward a candidate for supplying that answer for another occurrence.",
      "When an anchor is supplied, use it only to identify the intended subject and occurrence.",
      "Reject a candidate when it does not establish the required occurrence or when its time, place, subject, or comparison side conflicts.",
      "Reject a nearby, replacement, later, earlier, comparison, or similar subject unless the requested detail explicitly asks for it.",
      "Use nearby source context only to resolve identity. Do not score whether the candidate answers every requested field; the separate evidence-sufficiency check owns that decision.",
    ].join("\n"),identitySpans[index]!.map(span=>({id:span.evidence.atomKey,text:candidateForIdentity(span)})))
    :undefined);
  const identityResults=await Promise.all(identityCalls);
  const selectedByQuestion=prepared.map((item, index) => {
    const scoreMap = new Map(results[index]?.scores.map(score => [score.id, score.score]) ?? []);
    const identityMap=new Map(identityResults[index]?.scores.map(score=>[score.id,score.score])??[]);
    const ranked = item.spans.map(span => ({ evidence: span.evidence, score: scoreMap.get(span.evidence.atomKey) ?? -Infinity,
      identityScore:identityMap.get(span.evidence.atomKey) }))
      .sort((left, right) => right.score-left.score || left.evidence.text.length-right.evidence.text.length);
    const selected: typeof ranked = [];
    for (const candidate of ranked) {
      const sameBasis=selected.filter(current=>current.evidence.basis===candidate.evidence.basis).length;
      const basisLimit=candidate.evidence.basis==="current prompt context"
        ?MAX_PROVIDED_SOURCE_SPANS_PER_QUESTION:MAX_SOURCE_SPANS_PER_QUESTION;
      if(sameBasis>=basisLimit)continue;
      const directAcceptance=candidate.evidence.basis==="current prompt context"?PROVIDED_SOURCE_SPAN_ACCEPTANCE:SOURCE_SPAN_ACCEPTANCE;
      if (candidate.score < directAcceptance) continue;
      // Compare only the exact same span when it was proposed to several
      // facets. Distinct passages from one scene remain independent, while a
      // shared paragraph must support this facet more strongly than its
      // neighbors before it can be assigned here.
      if(candidate.evidence.basis==="archive context"&&(facetMembership.get(candidate.evidence.atomKey)??0)>1){
        const competing=Math.max(...results.flatMap((result,resultIndex)=>resultIndex===index?[]:
          [result?.scores.find(score=>score.id===candidate.evidence.atomKey)?.score??-Infinity]));
        if(candidate.score<competing+MIN_FACET_SEPARATION)continue;
      }
      const identityAcceptance=item.structured.length
        ?SOURCE_ANCHORED_IDENTITY_ACCEPTANCE
        :candidate.evidence.basis==="archive context"
          ?SOURCE_UNANCHORED_ARCHIVE_IDENTITY_ACCEPTANCE
          :SOURCE_CONTEXT_IDENTITY_ACCEPTANCE;
      if(candidate.identityScore!==undefined&&candidate.identityScore<identityAcceptance)continue;
      if (selected.length && candidate.score < selected[0]!.score - SECOND_SPAN_MAX_GAP) break;
      // Prompt candidates are ultimately collapsed to one confirmed excerpt.
      // Keep overlapping alternatives until the representative pass so a
      // slightly higher-scoring neighboring speaker cannot hide the complete
      // answer. Archive evidence can retain up to two spans and must remain
      // non-overlapping.
      if (candidate.evidence.basis==="archive context"
        &&selected.some(current => rangesOverlap(current.evidence.sourceRange, candidate.evidence.sourceRange))) continue;
      selected.push(candidate);
    }
    return {ranked,identityMap,selected};
  });
  const representativeCandidates=(selected:typeof selectedByQuestion[number]["selected"])=>{
    const promptVisible=selected.filter(candidate=>candidate.evidence.basis==="current prompt context");
    const bestDirect=Math.max(-Infinity,...promptVisible.map(candidate=>candidate.score));
    const bestIdentity=Math.max(-Infinity,...promptVisible.map(candidate=>candidate.identityScore??-Infinity));
    return promptVisible.filter(candidate=>candidate.score>=bestDirect-.12
      &&(candidate.identityScore===undefined||candidate.identityScore>=bestIdentity-.10));
  };
  const representativeCalls=selectedByQuestion.map((item,index)=>{
    const promptVisible=representativeCandidates(item.selected);
    return promptVisible.length>1?reranker.rerank([
      "Representative answer passage selection.",
      `Question: ${prepared[index]!.answer.question||overallQuery}`,
      "Choose the passage that explicitly answers the question as written.",
      "The requested named speaker or actor must make the statement or action. Reject a different speaker who merely addresses or mentions that person.",
      "Every requested field must appear in the passage; a pronoun without its named antecedent is incomplete.",
      "A different property, appearance, surrounding action, premise, or question is not the answer.",
      "Labeled context is not evidence and may only resolve a bare reply.",
    ].join("\n"),promptVisible.map(candidate=>({id:candidate.evidence.atomKey,text:["Candidate passage:",
      candidate.evidence.text,candidate.evidence.text.length<=MAX_BARE_REPLY_CHARACTERS?candidate.evidence.context:undefined]
      .filter(Boolean).join("\n")}))) : undefined;
  });
  const representativeResults=await Promise.all(representativeCalls);
  const questions:McpSourceSpanDiagnostic["questions"]=[];
  prepared.forEach((item,index)=>{
    const selection=selectedByQuestion[index]!;
    const representativeScores=new Map(representativeResults[index]?.scores.map(score=>[score.id,score.score])??[]);
    const promptVisible=selection.selected.filter(candidate=>candidate.evidence.basis==="current prompt context")
      .sort((left,right)=>(representativeScores.get(right.evidence.atomKey)??-Infinity)
        -(representativeScores.get(left.evidence.atomKey)??-Infinity));
    let promptIndex=0;
    const selected=selection.selected.map(candidate=>candidate.evidence.basis==="current prompt context"
      ?promptVisible[promptIndex++]!:candidate);
    item.answer.evidence=[...item.structured,...selected.map(candidate=>candidate.evidence)];
    questions.push({question:item.answer.question,candidates:item.spans.length,selected:selected.length,
      scores:selection.ranked.slice(0,8).map(candidate=>candidate.score),
      ...(selection.identityMap.size?{identityScores:selection.ranked.slice(0,8).map(candidate=>candidate.identityScore??-Infinity)}:{}),
      selectedScores:selected.map(candidate=>({score:candidate.score,...(candidate.identityScore===undefined?{}:{identityScore:candidate.identityScore})}))});
  });
  const providerResults=[...results,...identityResults,...representativeResults];
  const usage=aggregateRerankUsage(providerResults);
  return {elapsedMs:performance.now()-started,calls:[...calls,...identityCalls,...representativeCalls].filter(Boolean).length,questions,
    ...(usage?{usage}:{})};
}
