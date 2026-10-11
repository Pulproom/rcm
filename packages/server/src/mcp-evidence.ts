import { projectMemoryScene, normalizeSearchTokens, type McpEvidence, type McpQuestionAnswer, type MemoryContextItem } from "@rcm/shared";
import type { SemanticSearchResult } from "./embedding.js";
import { memoryDetailAtomKey, memoryDialogueAtomKey, memorySummaryAtomKey } from "./memory-atoms.js";

/** Retrieval ranking only: term rarity is measured in the accessible corpus.
 * No natural-language label is interpreted as an answer type or truth claim. */
export function evidenceRanker(query: string, corpus: string[]): (text: string) => number {
  const documents = corpus.map(text => new Set(normalizeSearchTokens(text)));
  const weights = new Map([...new Set(normalizeSearchTokens(query))].map(token => {
    const frequency = documents.filter(document => document.has(token)).length;
    return [token, Math.log(1 + documents.length / Math.max(1, frequency))] as const;
  }));
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  const scores = new Map<string, number>();
  return text => {
    const cached = scores.get(text);
    if (cached !== undefined) return cached;
    const tokens = new Set(normalizeSearchTokens(text));
    const score = total ? [...weights].reduce((sum, [token, weight]) => sum + (tokens.has(token) ? weight : 0), 0) / total : 0;
    scores.set(text, score);
    return score;
  };
}

export interface McpRecordSelection {
  answers: McpQuestionAnswer[];
  detailIds: string[];
  memoryIds: string[];
  /** Scene-level hits locate original citations even when extraction omitted the queried detail. */
  sourceMemoryIds: string[];
  /** Query-grounded atoms that remain useful if final budget removes them. */
  eligibleAtomKeysByMemory: Map<string, Set<string>>;
}

type AtomCandidate = { evidence: McpEvidence; memoryId: string; detailId?: string; score: number; directScore: number; core: boolean; supplied: boolean };

/** A focused ref expansion has no semantic or generative call. Keep only the
 * strongest atom-local lexical matches plus factual/core context when needed.
 * An absent focus returns no atom instead of silently dumping the whole
 * referenced record. */
function focusedSeedCandidates(candidates: AtomCandidate[]): AtomCandidate[] {
  const ranked = candidates.filter(candidate => candidate.directScore > 0)
    .sort((left, right) => right.directScore - left.directScore || right.score - left.score);
  const peak = ranked[0]?.directScore ?? 0;
  // Match the same minimum lexical confidence used for ordinary retrieval.
  // This rejects stopword-only overlap without a language-specific stopword
  // list. A wrong ref should report no local match instead of exposing the
  // memory's unrelated core and source transcript.
  if (peak < .12) return [];
  const selected = ranked.filter(candidate => candidate.directScore >= peak * .4).slice(0, 6);
  // A short line often repeats only one distinctive term from the surrounding
  // fact. Once a real local match exists, keep up to two such dialogue atoms
  // at a lower relative threshold so focus does not erase the scene's voice.
  for (const dialogue of ranked.filter(candidate => candidate.evidence.kind === "dialogue"
    && candidate.directScore >= peak * .2 && !selected.includes(candidate)).slice(0, 2)) {
    if (selected.length < 6) selected.push(dialogue);
  }
  const context = candidates.filter(candidate => candidate.core)
    .sort((left, right) => right.directScore - left.directScore || right.score - left.score)[0];
  if (context && !selected.includes(context)) return [context, ...selected.slice(0, 5)];
  if (selected.some(candidate => candidate.evidence.kind === "fact")) return selected.slice(0, 6);
  const factualContext = candidates.filter(candidate => candidate.evidence.kind === "fact")
    .sort((left, right) => right.directScore - left.directScore || right.score - left.score)[0];
  return factualContext ? [factualContext, ...selected.slice(0, 5)] : selected.slice(0, 6);
}

/** Selects answer evidence per requested question. Parent summaries may locate a
 * scene; only independently authorized record summaries can be evidence. */
export function rankMcpRecords(items: MemoryContextItem[], query: string, facets: string[], semantic: SemanticSearchResult[],
  supplied: Set<string>, seed?: string, options: { searchEnvelopes?: Map<string,string>; referenceMemoryId?: string; archiveView?: boolean } = {}): McpRecordSelection {
  const sceneText = (item: MemoryContextItem) => [options.searchEnvelopes?.get(item.id), item.title, item.content,
    ...item.details.map(detail => detail.text), ...item.keyDialogues.map(dialogue => dialogue.text)].filter(Boolean).join(" ");
  const corpus = items.flatMap(item => [sceneText(item), ...item.details.map(detail => detail.text), ...item.keyDialogues.map(dialogue => dialogue.text)]);
  const questions = facets.length ? facets : [query];
  const eligibleAtomKeysByMemory = new Map<string, Set<string>>();
  const markEligible = (memoryId: string, atomKey: string) => {
    const keys = eligibleAtomKeysByMemory.get(memoryId) ?? new Set<string>();
    keys.add(atomKey); eligibleAtomKeysByMemory.set(memoryId, keys);
  };
  const selectedDetails = new Set<string>();
  const selectedMemories = new Set<string>();
  const sourceMemories = new Set<string>();
  const fullRank = evidenceRanker(query, corpus);
  const fullView = semantic[0];

  const answers = questions.map((question, questionIndex): McpQuestionAnswer => {
    const focusRank = facets.length ? evidenceRanker(question, corpus) : fullRank;
    const view = facets.length ? semantic[questionIndex + 1] ?? semantic[0] : semantic[0];
    const candidates: AtomCandidate[] = [];
    const scenes: Array<{ id: string; score: number }> = [];
    for (const item of items) {
      if (seed && item.id !== seed) continue;
      const scene = sceneText(item);
      const sceneLexical = focusRank(scene);
      const sceneSemantic = view?.hits.get(item.id)?.score ?? 0;
      // API68 facets are complete atomic questions. Once facets are present,
      // unrelated words in the parent request must not alter their candidate
      // ordering or eligibility.
      const fullSceneLexical = facets.length ? sceneLexical : fullRank(scene);
      const fullSceneSemantic = facets.length ? sceneSemantic : fullView?.hits.get(item.id)?.score ?? 0;
      const target = item.id === seed;
      if (options.archiveView && !seed && (sceneLexical >= .14 || fullSceneLexical >= .16 || sceneSemantic >= .35 || fullSceneSemantic >= .35)) {
        scenes.push({ id: item.id, score: sceneLexical * .72 + fullSceneLexical * .28 + sceneSemantic * .32 });
      }
      if (!target && sceneLexical < .14 && fullSceneLexical < .16 && sceneSemantic < .35 && fullSceneSemantic < .35) continue;
      // A standalone summary is itself a readable atom (for example a manual
      // timeline record). An atom-scoped parent's summary never grants access.
      if (item.atomAccessVersion === 0 && item.content && !item.details.length && !item.keyDialogues.length) {
        const atomKey = memorySummaryAtomKey(item)!;
        candidates.push({memoryId:item.id,supplied:supplied.has(atomKey),score:Math.max(sceneLexical,sceneSemantic),directScore:sceneLexical,core:true,
          evidence:{atomKey,memoryId:item.id,kind:"fact",text:item.content,context:item.title,
            time:item.storyTime,knownBy:item.knownBy,basis:"stored_record"}});
      }
      const directDetails = new Map((view?.atomHits?.get(item.id) ?? [])
        .filter(hit => hit.kind === "memory_detail" && hit.score >= .35).map(hit => [hit.sourceId, hit.score]));
      for (const detail of item.details) {
        const atomKey = memoryDetailAtomKey(detail);
        const atomText = `${detail.text} ${detail.participants.join(" ")} ${detail.locations.join(" ")}`;
        const focusLexical = focusRank(atomText);
        const fullLexical = facets.length ? focusLexical : fullRank(atomText);
        const directSemantic = directDetails.get(detail.id) ?? 0;
        if (!target && focusLexical < .12 && fullLexical < .16 && directSemantic < .35) continue;
        candidates.push({ memoryId:item.id, detailId:detail.id, supplied:supplied.has(atomKey), directScore:focusLexical + directSemantic, core:detail.role === "core",
          score: focusLexical * .72 + fullLexical * .28 + directSemantic * .32
            + Math.max(sceneLexical, sceneSemantic) * .08 + Math.max(fullSceneLexical, fullSceneSemantic) * .03,
          evidence:{atomKey,bundleKey:`anchor:${atomKey}`,memoryId:item.id,kind:"fact",text:detail.text,time:item.storyTime,
            location:detail.locations.join(", "),knownBy:detail.knownBy,knownByLabels:detail.knownByLabels,basis:detail.epistemic,context:projectMemoryScene(item).title} });
      }
      for (const dialogue of item.keyDialogues) {
        const atomKey = memoryDialogueAtomKey(item.id, dialogue);
        const atomText = `${dialogue.speaker} ${dialogue.text}`;
        const focusLexical = focusRank(atomText);
        const fullLexical = facets.length ? focusLexical : fullRank(atomText);
        if (!target && focusLexical < .12 && fullLexical < .16) continue;
        candidates.push({memoryId:item.id,supplied:supplied.has(atomKey),directScore:focusLexical,core:false,score:focusLexical*.72+fullLexical*.28
          +Math.max(sceneLexical,sceneSemantic)*.08+Math.max(fullSceneLexical,fullSceneSemantic)*.03,
          evidence:{atomKey,bundleKey:`anchor:${atomKey}`,memoryId:item.id,kind:"dialogue",text:dialogue.text,speaker:dialogue.speaker,
            time:item.storyTime,knownBy:dialogue.knownBy,knownByLabels:dialogue.knownByLabels,context:projectMemoryScene(item).title,
            dialogueSourceRanges:dialogue.evidence.map(span=>({messageId:span.messageId,start:span.startOffset,end:span.endOffset}))} });
      }
    }
    // Delivery state must not steer evidence eligibility. A supplied best match
    // remains the best match and cannot be replaced by a different scene.
    candidates.sort((left,right)=>right.score-left.score
      || Number(right.memoryId===options.referenceMemoryId)-Number(left.memoryId===options.referenceMemoryId));
    const memoryIds = [...new Set(candidates.map(candidate => candidate.memoryId))].slice(0, seed ? 1 : 3);
    for (const scene of scenes.sort((a,b) => b.score-a.score).slice(0, 3)) {
      sourceMemories.add(scene.id);
      // Keep the scene's authorized atoms as well as its source navigation.
      // Otherwise its recorded time and dialogue disappear at this boundary.
      if (!memoryIds.includes(scene.id)) memoryIds.push(scene.id);
    }
    // Retrieve compact candidates first, then locally materialize the selected
    // records. A sibling is context, never proof that it answers the question.
    const chosen: AtomCandidate[] = [];
    for (const memoryId of memoryIds) {
      const ranked = candidates.filter(candidate => candidate.memoryId === memoryId);
      const focused = Boolean(seed && query.trim());
      chosen.push(...(focused ? focusedSeedCandidates(ranked) : ranked));
      if (focused) continue;
      const item = items.find(item => item.id === memoryId)!;
      for (const detail of item.details) {
        const atomKey = memoryDetailAtomKey(detail);
        if (chosen.some(candidate => candidate.evidence.atomKey === atomKey)) continue;
        chosen.push({ memoryId, detailId: detail.id, score: 0, directScore: 0, core:detail.role === "core", supplied: supplied.has(atomKey), evidence: {
          atomKey, memoryId, bundleKey: `anchor:${atomKey}`, kind: "fact", text: detail.text,
          context: projectMemoryScene(item).title, time: item.storyTime, location: detail.locations.join(", "), knownBy: detail.knownBy,knownByLabels:detail.knownByLabels, basis: detail.epistemic,
        } });
      }
      for (const dialogue of item.keyDialogues) {
        const atomKey = memoryDialogueAtomKey(item.id, dialogue);
        if (chosen.some(candidate => candidate.evidence.atomKey === atomKey)) continue;
        chosen.push({ memoryId, score: 0, directScore: 0, core:false, supplied: supplied.has(atomKey), evidence: { atomKey, memoryId,
          bundleKey: `anchor:${atomKey}`, kind: "dialogue", text: dialogue.text, speaker: dialogue.speaker,
          context: projectMemoryScene(item).title, time: item.storyTime, knownBy: dialogue.knownBy,knownByLabels:dialogue.knownByLabels,
          dialogueSourceRanges: dialogue.evidence.map(span => ({ messageId: span.messageId, start: span.startOffset, end: span.endOffset })),
        } });
      }
    }
    for (const candidate of chosen) {
      markEligible(candidate.memoryId, candidate.evidence.atomKey);
      selectedMemories.add(candidate.memoryId);
      if(candidate.detailId) selectedDetails.add(candidate.detailId);
    }
    if (!(seed && query.trim())) chosen.sort((a,b) => b.score - a.score);
    return {question,evidence:chosen.map(candidate=>candidate.evidence),alreadyPresent:chosen.some(candidate=>candidate.supplied),
      relatedRecords:true,searchUnavailable:view?.searchUnavailable};
  });
  return {answers,detailIds:[...selectedDetails],memoryIds:[...selectedMemories],sourceMemoryIds:[...sourceMemories],eligibleAtomKeysByMemory};
}
