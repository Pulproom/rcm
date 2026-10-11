import type { McpEvidence, McpQuestionAnswer } from "@rcm/shared";
import { evidenceRanker } from "./mcp-evidence.js";

const PROTECTED_BUNDLES = 3;
const MAX_SHORTLIST_BUNDLES = 4;

export interface McpRerankQuestionDiagnostic {
  question: string;
  candidates: number;
  accepted: number;
  scores: Array<{ bundleKey: string; score: number; facetScore: number; overallScore: number }>;
}

export interface McpRerankDiagnostic {
  mode: "local_shortlist";
  elapsedMs: number;
  calls: number;
  acceptance: number;
  overallAcceptance: number;
  questions: McpRerankQuestionDiagnostic[];
}

const bundleKey = (evidence: McpEvidence): string => evidence.bundleKey ?? evidence.atomKey;

function renderCandidate(evidence: McpEvidence[]): string {
  return evidence.map(item => [item.text, item.speaker, item.time, item.location, ...(item.knownBy ?? [])]
    .filter(Boolean).join(" "))
    .join("\n");
}

/**
 * Keeps retrieval evidence as candidates instead of asking a relevance model to
 * certify truth. The semantic/lexical retrieval leaders are protected. Local
 * term coverage may add one diverse candidate from the rest of the six-item
 * pool, but it can never remove or reorder the protected leaders.
 */
export async function rerankMcpAnswers(answers: McpQuestionAnswer[]): Promise<McpRerankDiagnostic> {
  const started = performance.now();
  const questions: McpRerankQuestionDiagnostic[] = [];
  for (const answer of answers) {
    const groups = new Map<string, McpEvidence[]>();
    for (const evidence of answer.evidence) {
      const key = bundleKey(evidence);
      const group = groups.get(key) ?? [];
      group.push(evidence);
      groups.set(key, group);
    }
    const candidates = [...groups].map(([key, evidence], index) => ({ key, evidence, index, text: renderCandidate(evidence) }));
    const rank = evidenceRanker(answer.question, candidates.map(candidate => candidate.text));
    const scored = candidates.map(candidate => ({ ...candidate, score: rank(candidate.text) }));
    const selected: typeof scored = [];
    const add = (candidate: typeof scored[number] | undefined) => {
      if (candidate && !selected.some(item => item.key === candidate.key) && selected.length < MAX_SHORTLIST_BUNDLES) selected.push(candidate);
    };

    // Current ledger/state evidence is already typed and question-scoped. Keep
    // one such bundle without allowing it to expand the overall shortlist.
    add(scored.find(candidate => candidate.evidence.some(evidence => !evidence.memoryId && evidence.kind === "fact")));
    for (const candidate of scored.slice(0, PROTECTED_BUNDLES)) add(candidate);
    const remaining = scored.filter(candidate => !selected.some(item => item.key === candidate.key))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    if ((remaining[0]?.score ?? 0) > 0) add(remaining[0]);

    answer.evidence = selected.flatMap(candidate => candidate.evidence);
    questions.push({
      question: answer.question, candidates: candidates.length, accepted: selected.length,
      scores: scored.slice(0, 8).map(candidate => ({
        bundleKey: candidate.key, score: candidate.score, facetScore: candidate.score, overallScore: candidate.score,
      })),
    });
  }
  return { mode: "local_shortlist", elapsedMs: performance.now() - started, calls: 0, acceptance: 0, overallAcceptance: 0, questions };
}
