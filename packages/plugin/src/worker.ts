import { supportFailure } from "./support-diagnostics.js";
import { consumeAuxiliaryRepair } from "@rcm/shared";
import { isChatMemoryEnabled } from "./settings.js";
import { parseReconciliationResult, type SourceUnit } from "@rcm/shared";
import { prepareAuxiliaryText, resolveDirectDialogueEvidence, resolveModelSourceReferences, inspectSourceReferences, sourceRepairMessages, applySourceRepairs, planExtractionFieldRepair, applyExtractionFieldRepair, planSourceAccessRepair, applySourceAccessRepair, type SourceAccessRepairPlan, type ExtractionDraftResult } from "@rcm/shared";
import { mergeInitialCalibrationResults, measureAuxiliaryPrompt, mergeExtractionPages } from "@rcm/shared";
import { validateGroupingResult, validateSourceRecoveryPatch } from "@rcm/shared";
import { Api38ExtractionDraftResultSchema, EpisodeCapsuleResultSchema, EpisodeDraftResultSchema, buildAuxiliaryRepairMessages, buildExtractionAuditMessages, extractionAuditDraftForJob, ExtractionAuditPatchSchema, InitialCalibrationResultSchema, LedgerConsistencyResultSchema, ReconciliationResultSchema, RelationshipProjectionResultSchema, StorySpineConsolidationResultSchema, StructuredJsonSyntaxError, isUnchangedStructuredRepair, validateStructuredRepairOrRegenerate, estimateTokens, groupEpisodeDrafts, normalizeEpisodeCapsuleInput, normalizeEpisodeDraftInput, normalizeExtractionDraftInput, normalizeStructuredModelOptionals, parseStructuredModelJson, structuredValidationDiagnostic, validateStorySpineConsolidation, type EpisodeDraftResult, type ExtractionAuditSubmission, type LeasedJob, type OperationLlmCallStats, type ReconciliationSubmission } from "@rcm/shared";
import type { ServerClient } from "./api-client.js";
import { addLog, saveSettings } from "./settings.js";
import type { RuntimeState } from "./types.js";
import { showWorkerPauseNotice, updateWorkerMenuButton } from "./attention.js";
import { describeServerConnectionIssue, isServerConfigured } from "./connection.js";
import { finishTiming, startTiming } from "./timing.js";

const attentionReconciliationFlights = new WeakMap<RuntimeState, Promise<boolean>>();

async function pauseWithAttention(state: RuntimeState, message: string): Promise<void> {
  state.settings.workerPaused = true;
  state.settings.workerAttention = { at: Date.now(), message };
  try { await saveSettings(state.settings); } catch (saveError) { addLog(state.logs, "warn", `Could not persist automatic pause: [오류 원문 제외]`); }
  await showWorkerPauseNotice(state);
}

export async function reconcileAutomaticServerPause(
  state: RuntimeState,
  client: Pick<ServerClient, "resumeServerWorker">,
  observation: { failedJobs?: number; worker?: RuntimeState["serverWorker"]; available: boolean },
  dependencies: { persist?: typeof saveSettings; updateMenu?: typeof updateWorkerMenuButton } = {},
): Promise<boolean> {
  if (state.settings.extractionEngine !== "server" || !state.settings.workerAttention || !observation.available) return false;
  const worker = observation.worker;
  if (!worker || Number(observation.failedJobs ?? 0) > 0 || worker.state === "faulted" || worker.state === "risu") return false;
  const existing = attentionReconciliationFlights.get(state);
  if (existing) return existing;
  const flight = (async () => {
    try {
      state.serverWorker = worker.state === "paused"
        ? await client.resumeServerWorker(state.workerId)
        : worker;
      state.settings.workerPaused = false;
      delete state.settings.workerAttention;
      await (dependencies.persist ?? saveSettings)(state.settings);
      await (dependencies.updateMenu ?? updateWorkerMenuButton)(state);
      state.publishActivity?.();
      return true;
    } catch (error) {
      addLog(state.logs, "warn", `Could not reconcile recovered server worker state: [오류 원문 제외]`);
      return false;
    } finally {
      attentionReconciliationFlights.delete(state);
    }
  })();
  attentionReconciliationFlights.set(state, flight);
  return flight;
}

export function responseText(response: any): string {
  if (typeof response === "string") return response;
  if (response?.type === "fail") throw new Error(`Auxiliary model failed: ${String(response.result ?? "unknown provider error")}`);
  if (typeof response?.result === "string") return response.result;
  if (typeof response?.content === "string") return response.content;
  if (typeof response?.text === "string") return response.text;
  if (Array.isArray(response)) return response.map(responseText).join("");
  return String(response ?? "");
}

export function parseJson(text: string): unknown {
  return parseStructuredModelJson(text).value;
}

type WorkerJsonPurpose = "memory_group" | "memory_group_repair" | "extraction" | "extraction_repair" | "initial_calibration" | "initial_calibration_repair" | "audit" | "audit_repair" | "reconciliation" | "reconciliation_repair" | "state_response_repair" | "ledger_consistency" | "ledger_consistency_repair" | "relationship_projection" | "relationship_projection_repair" | "story_consolidation" | "story_consolidation_repair" | "quiz" | "episode_draft" | "episode_draft_repair" | "episode_finalize" | "episode_finalize_repair";

async function generateQuiz(state: RuntimeState, job: LeasedJob): Promise<unknown> {
  return parseWorkerJson(state, await runModel(state, [
    { role: "system", content: job.systemPrompt ?? "" },
    { role: "user", content: job.userPrompt ?? "" },
  ], "quiz"), "quiz");
}

async function groupMemories(state: RuntimeState, job: LeasedJob): Promise<unknown> {
  const stage = job.memoryGrouping!;
  const messages = [{ role: 'system', content: stage.systemPrompt }, { role: 'user', content: stage.userPrompt }];
  const first = await runModel(state, messages, 'memory_group');
  try { return validateGroupingResult(parseWorkerJson(state, first, 'memory_group'), stage); }
  catch (error) {
    const repaired = await runModel(state, buildAuxiliaryRepairMessages({
      originalMessages: messages, invalidOutput: first, validationError: error, request: { kind: "memory_group" },
    }), 'memory_group_repair');
    return validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "memory_group",
      regenerate: () => runModel(state, messages, "memory_group"),
      validate: (output, phase) => {
        return validateGroupingResult(parseWorkerJson(state, output, phase === "repair" ? "memory_group_repair" : "memory_group"), stage);
      },
    });
  }
}
const validatedPartRecorders = new WeakMap<RuntimeState, (purpose: "initial_calibration" | "ledger_consistency" | "reconciliation", part: { systemPrompt: string; userPrompt: string }, result: unknown) => Promise<unknown>>();
const modelJobBudgets = new WeakMap<RuntimeState, NonNullable<LeasedJob["auxiliaryBudget"]>>();
const modelDraftRecorders = new WeakMap<RuntimeState, (output: string, storyValidationReason?: string) => Promise<unknown>>();
const modelCallRecorders = new WeakMap<RuntimeState, (purpose: WorkerJsonPurpose, outcome: "started" | "succeeded" | "failed", error?: unknown, usage?: Record<string, number>) => Promise<void>>();

function parseWorkerJson(state: RuntimeState, text: string, purpose: WorkerJsonPurpose): unknown {
  const parsed = parseStructuredModelJson(text);
  if (parsed.repaired) addLog(state.logs, "warn", `Local JSON syntax repair applied (${purpose}: ${parsed.repairs.join(", ")})${parsed.keyQuoteInsertions === undefined ? "" : ` keyQuoteInsertions=${parsed.keyQuoteInsertions}`}.`);
  return normalizeStructuredModelOptionals(parsed.value);
}

export function risuModelSlot(slot: import("./types.js").AuxiliaryMode | "translate", model: string) {
  return { mode: slot === "main" || slot === "static" ? "model" : slot, staticModel: slot === "static" ? model : undefined, allowPlugins: true };
}

async function runModel(state: RuntimeState, messages: any[], purpose: WorkerJsonPurpose): Promise<string> {
  const reportOutcome = async (outcome: "succeeded" | "failed", error?: unknown, usage?: Record<string, number>) => {
    if (state.currentJob?.kind === "quiz") return;
    try { await modelCallRecorders.get(state)?.(purpose, outcome, error, usage); }
    catch (reportError) { addLog(state.logs, "warn", `Could not record auxiliary model ${outcome} (${purpose}): [오류 원문 제외]`); }
  };
  state.internalModelCall = true;
  const timing = state.currentJob?.kind !== "quiz" && state.currentJob
    ? startTiming(state, { chatId: state.currentJob.chatId, kind: "auxiliary_llm", label: `보조 모델 · ${purpose}` })
    : undefined;
  try {
    const preparedMessages = messages.map(message => ({ ...message, content: typeof message.content === "string" ? prepareAuxiliaryText(message.content) : message.content }));
    const budget = modelJobBudgets.get(state) ?? { maxInputTokens: 80000, maxOutputTokens: 24000, llmTimeoutMs: 300000 };
    const measurement = measureAuxiliaryPrompt(preparedMessages, estimateTokens, budget);
    if (!measurement.fits) throw new Error(`AUXILIARY_INPUT_TOO_LARGE: ${measurement.estimatedInputTokens}/${budget.maxInputTokens} input tokens; source retained for replanning`);
    if (state.currentJob?.kind !== "quiz") await modelCallRecorders.get(state)?.(purpose, "started");
    const response = await risuai.runLLMModel({
      messages: preparedMessages,
      ...risuModelSlot(state.settings.auxiliaryMode, state.settings.staticModel),
    });
    if (state.currentJob?.kind !== "quiz" && response?.type === "fail" && typeof response.result === "string") await modelDraftRecorders.get(state)?.(response.result);
    const output = responseText(response);
    if (state.currentJob?.kind !== "quiz") await modelDraftRecorders.get(state)?.(output);
    const finishReason = response?.finish_reason ?? response?.finishReason ?? response?.choices?.[0]?.finish_reason ?? response?.candidates?.[0]?.finishReason;
    if (["LENGTH", "MAX_TOKENS", "MAX_OUTPUT_TOKENS"].includes(String(finishReason ?? "").toUpperCase())) {
      throw Object.assign(new Error(`Auxiliary model output truncated (${finishReason}); raw response retained`), { code: "MODEL_OUTPUT_TRUNCATED" });
    }
    const rawUsage = response?.usage ?? response?.usageMetadata;
    const inputTokens = rawUsage?.prompt_tokens ?? rawUsage?.input_tokens ?? rawUsage?.promptTokenCount;
    const outputTokens = rawUsage?.completion_tokens ?? rawUsage?.output_tokens ?? rawUsage?.candidatesTokenCount;
    const usage = Object.fromEntries([["inputTokens", inputTokens], ["outputTokens", outputTokens]].filter(([, value]) => typeof value === "number" && Number.isFinite(value)));
    await reportOutcome("succeeded", undefined, usage);
    if (timing) finishTiming(state, timing, "succeeded");
    return output;
  } catch (error) {
    addLog(state.logs, "error", "Auxiliary model call failed", supportFailure("auxiliary_call", error, { purpose, attempt: state.currentJob?.attempt }));
    await reportOutcome("failed", error);
    if (timing) finishTiming(state, timing, "failed");
    throw error;
  } finally {
    state.internalModelCall = false;
  }
}

async function extract(state: RuntimeState, job: LeasedJob, onRepair?: () => void): Promise<unknown> {
  const sourceMessages = job.systemPrompt && job.userPrompt
    ? [{ role: "system", content: job.systemPrompt }, { role: "user", content: job.userPrompt }]
    : [{ role: "user", content: job.prompt }];
  const first = await runModel(state, sourceMessages, "extraction");
  const validate = (output: string, purpose: "extraction" | "extraction_repair"): ExtractionDraftResult => {
    const parsed = Api38ExtractionDraftResultSchema.parse(normalizeExtractionDraftInput(job.sourceUnits
      ? resolveModelSourceReferences(parseWorkerJson(state, output, purpose), job.sourceUnits)
      : parseWorkerJson(state, output, purpose)), { reportInput: true });
    if (parsed.language !== job.memoryLanguage) throw new Error(`Expected canonical language ${job.memoryLanguage}, received ${parsed.language}`);
    return parsed;
  };
  const validateRepair = (repaired: string): Promise<ExtractionDraftResult> => validateStructuredRepairOrRegenerate({
    original: first,
    repaired,
    purpose: "extraction",
    regenerate: () => runModel(state, sourceMessages, "extraction"),
    validate: (output, phase) => validate(output, phase === "repair" ? "extraction_repair" : "extraction"),
  });
  let raw: unknown;
  let resolved: unknown;
  try {
    raw = parseWorkerJson(state, first, "extraction");
    resolved = normalizeExtractionDraftInput(job.sourceUnits ? resolveModelSourceReferences(raw, job.sourceUnits) : raw);
    const parsed = Api38ExtractionDraftResultSchema.parse(resolved, { reportInput: true });
    if (parsed.language !== job.memoryLanguage) throw new Error(`Expected canonical language ${job.memoryLanguage}, received ${parsed.language}`);
    return parsed;
  } catch (firstError) {
    onRepair?.();
    const fieldRepair = job.sourceUnits ? planExtractionFieldRepair(raw, resolved, firstError, job.sourceUnits) : undefined;
    if (fieldRepair) {
      const response = await runModel(state, fieldRepair.messages, "extraction_repair");
      if (isUnchangedStructuredRepair(first, response)) return validateRepair(response);
      let fieldRepairOutput: unknown;
      try {
        fieldRepairOutput = parseWorkerJson(state, response, "extraction_repair");
      } catch (error) {
        if (error instanceof StructuredJsonSyntaxError) return validateRepair(response);
        throw error;
      }
      const corrected = applyExtractionFieldRepair(raw, fieldRepair, fieldRepairOutput);
      const repaired = JSON.stringify(corrected);
      return validateRepair(repaired);
    }
    const repaired = await runModel(state, buildAuxiliaryRepairMessages({
      originalMessages: sourceMessages,
      invalidOutput: first,
      validationError: firstError,
      request: { kind: "extraction", sourceMode: job.sourceUnits ? "source_units" : "message_ids" },
    }), "extraction_repair");
    return validateRepair(repaired);
  }
}

async function checkLedgerConsistency(state: RuntimeState, job: LeasedJob, onRepair?: () => void): Promise<unknown> {
  const parts = job.ledgerConsistency?.promptParts?.length ? job.ledgerConsistency.promptParts : [{ systemPrompt: job.systemPrompt ?? "", userPrompt: job.userPrompt ?? job.prompt }];
  const merged = new Map<string, { itemRef: string; closures: Array<{ targetId: string; replacementId: string; reason: string }> }>();
  for (const part of parts) {
    const messages = part.systemPrompt ? [{ role: "system", content: part.systemPrompt }, { role: "user", content: part.userPrompt }] : [{ role: "user", content: part.userPrompt }];
    const cachedResult = "cachedResult" in part ? part.cachedResult : undefined;
    const first = cachedResult === undefined ? await runModel(state, messages, "ledger_consistency") : "";
    let parsed;
    try { parsed = LedgerConsistencyResultSchema.parse(cachedResult ?? parseWorkerJson(state, first, "ledger_consistency")); }
    catch (firstError) {
      if (cachedResult !== undefined) throw firstError;
      onRepair?.();
      const repaired = await runModel(state, buildAuxiliaryRepairMessages({
        originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "ledger_consistency" },
      }), "ledger_consistency_repair");
      parsed = await validateStructuredRepairOrRegenerate({
        original: first, repaired, purpose: "ledger_consistency",
        regenerate: () => runModel(state, messages, "ledger_consistency"),
        validate: (output, phase) => {
          return LedgerConsistencyResultSchema.parse(parseWorkerJson(state, output, phase === "repair" ? "ledger_consistency_repair" : "ledger_consistency"));
        },
      });
    }
    const expected = new Set("itemRefs" in part ? part.itemRefs : job.ledgerConsistency?.groups.map(group => group.itemRef) ?? []);
    if (parsed.groups.length !== expected.size || new Set(parsed.groups.map(group => group.itemRef)).size !== expected.size || parsed.groups.some(group => !expected.has(group.itemRef))) throw new Error("Ledger page did not return every supplied group exactly once");
    if (cachedResult === undefined) await validatedPartRecorders.get(state)?.("ledger_consistency", part, parsed);
    for (const group of parsed.groups) {
      const prior = merged.get(group.itemRef);
      merged.set(group.itemRef, prior ? { itemRef: group.itemRef, closures: [...prior.closures, ...group.closures] } : group);
    }
  }
  return LedgerConsistencyResultSchema.parse({ groups: [...merged.values()] });
}

async function calibrateInitialSetup(state: RuntimeState, job: LeasedJob): Promise<unknown> {
  const parts = job.initialCalibration?.promptParts?.length ? job.initialCalibration.promptParts
    : [{ systemPrompt: job.systemPrompt ?? "", userPrompt: job.userPrompt ?? job.prompt }];
  const results = [];
  for (const part of parts) {
    if ("cachedResult" in part && part.cachedResult !== undefined) {
      results.push(InitialCalibrationResultSchema.parse(part.cachedResult));
      continue;
    }
    const messages = part.systemPrompt ? [{ role: "system", content: part.systemPrompt }, { role: "user", content: part.userPrompt }]
      : [{ role: "user", content: part.userPrompt }];
    const first = await runModel(state, messages, "initial_calibration");
    try { results.push(InitialCalibrationResultSchema.parse(parseWorkerJson(state, first, "initial_calibration"))); }
    catch (firstError) {
      const repaired = await runModel(state, buildAuxiliaryRepairMessages({
        originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "initial_calibration" },
      }), "initial_calibration_repair");
      results.push(await validateStructuredRepairOrRegenerate({
        original: first, repaired, purpose: "initial_calibration",
        regenerate: () => runModel(state, messages, "initial_calibration"),
        validate: (output, phase) => {
          return InitialCalibrationResultSchema.parse(parseWorkerJson(state, output, phase === "repair" ? "initial_calibration_repair" : "initial_calibration"));
        },
      }));
    }
    await validatedPartRecorders.get(state)?.("initial_calibration", part, results.at(-1));
  }
  return mergeInitialCalibrationResults(results);
}

async function runEpisode(state: RuntimeState, job: LeasedJob): Promise<unknown> {
  const episode = job.episode;
  if (!episode) throw new Error("Episode job is missing its prompt plan.");
  let drafts: EpisodeDraftResult[] = [];
  for (const prompt of episode.drafts) {
    const messages = [{ role: "system", content: prompt.systemPrompt }, { role: "user", content: prompt.userPrompt }];
    const first = await runModel(state, messages, "episode_draft");
    try { drafts.push(EpisodeDraftResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeDraftInput(parseWorkerJson(state, first, "episode_draft"), prompt.sourceMessageIds),job.sourceUnits??[]))); }
    catch (firstError) {
      const repaired = await runModel(state, buildAuxiliaryRepairMessages({
        originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "episode_draft" },
      }), "episode_draft_repair");
      drafts.push(await validateStructuredRepairOrRegenerate({
        original: first, repaired, purpose: "episode_draft",
        regenerate: () => runModel(state, messages, "episode_draft"),
        validate: (output, phase) => {
          return EpisodeDraftResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeDraftInput(parseWorkerJson(state, output, phase === "repair" ? "episode_draft_repair" : "episode_draft"), prompt.sourceMessageIds),job.sourceUnits??[]));
        },
      }));
    }
  }
  while (drafts.length > 1 && estimateTokens(JSON.stringify(drafts)) > 45_000) {
    const consolidated: EpisodeDraftResult[] = [];
    for (const group of groupEpisodeDrafts(drafts)) {
      const messages = [
        { role: "system", content: episode.finalizeSystemPrompt },
        { role: "user", content: `Consolidate these adjacent episode drafts into one strict episode draft JSON. Preserve source message IDs and source-language dialogue text; do not invent evidence.\n${JSON.stringify(group)}` },
      ];
      const first = await runModel(state, messages, "episode_draft");
      const sourceIds = [...new Set(group.flatMap((draft) => draft.evidence.map((item) => item.messageId)))];
      try { consolidated.push(EpisodeDraftResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeDraftInput(parseWorkerJson(state, first, "episode_draft"), sourceIds),job.sourceUnits??[]))); }
      catch (firstError) {
        const repaired = await runModel(state, buildAuxiliaryRepairMessages({
          originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "episode_draft" },
        }), "episode_draft_repair");
        consolidated.push(await validateStructuredRepairOrRegenerate({
          original: first, repaired, purpose: "episode_draft",
          regenerate: () => runModel(state, messages, "episode_draft"),
          validate: (output, phase) => {
            return EpisodeDraftResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeDraftInput(parseWorkerJson(state, output, phase === "repair" ? "episode_draft_repair" : "episode_draft"), sourceIds),job.sourceUnits??[]));
          },
        }));
      }
    }
    if (consolidated.length >= drafts.length) break;
    drafts = consolidated;
  }
  const userPrompt = episode.finalizeUserPrompt.replace("{{DRAFTS}}", JSON.stringify(drafts));
  job.systemPrompt = episode.finalizeSystemPrompt;
  job.userPrompt = userPrompt;
  const messages = [{ role: "system", content: episode.finalizeSystemPrompt }, { role: "user", content: userPrompt }];
  const first = await runModel(state, messages, "episode_finalize");
  try {
    const parsed = EpisodeCapsuleResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeCapsuleInput(parseWorkerJson(state, first, "episode_finalize"), job.sourceMessageIds),job.sourceUnits??[]));
    if (parsed.language !== job.memoryLanguage) throw new Error(`Expected canonical language ${job.memoryLanguage}, received ${parsed.language}`);
    return parsed;
  }
  catch (firstError) {
    const repaired = await runModel(state, buildAuxiliaryRepairMessages({
      originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "episode_finalize" },
    }), "episode_finalize_repair");
    return validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "episode_finalize",
      regenerate: () => runModel(state, messages, "episode_finalize"),
      validate: (output, phase) => {
        const parsed = EpisodeCapsuleResultSchema.parse(resolveDirectDialogueEvidence(normalizeEpisodeCapsuleInput(parseWorkerJson(state, output, phase === "repair" ? "episode_finalize_repair" : "episode_finalize"), job.sourceMessageIds),job.sourceUnits??[]));
        if (parsed.language !== job.memoryLanguage) throw new Error(`Canonical language is still ${parsed.language}; expected ${job.memoryLanguage}`);
        return parsed;
      },
    });
  }
}

async function auditExtraction(state: RuntimeState, job: LeasedJob, result: unknown, onRepair?: () => void): Promise<ExtractionAuditSubmission> {
  const draft = extractionAuditDraftForJob(job, result);
  const messages = buildExtractionAuditMessages({
    memoryLanguage: job.memoryLanguage,
    sourceMessages: job.auditSourceMessages ?? [],
    draft,
    existingOpenPromises: job.auditExistingOpenPromises,
    recallCandidates: job.recallCandidates,
    sourceRecovery: job.sourceRecovery,
    sourceRecoveryContext: job.sourceRecoveryContext,
  });
  const first = await runModel(state, messages, "audit");
  const validatePatch = (value: unknown) => { const patch = ExtractionAuditPatchSchema.parse(resolveDirectDialogueEvidence(value,job.sourceUnits??[])); return job.sourceRecovery ? validateSourceRecoveryPatch(patch,draft) : patch; };
  try { return { patch: validatePatch(parseWorkerJson(state, first, "audit")) }; }
  catch (firstError) {
    onRepair?.();
    const repaired = await runModel(state, buildAuxiliaryRepairMessages({
      originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "audit" },
    }), "audit_repair");
    return validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "audit",
      regenerate: () => runModel(state, messages, "audit"),
      validate: (output, phase) => {
        return { patch: validatePatch(parseWorkerJson(state, output, phase === "repair" ? "audit_repair" : "audit")) };
      },
    });
  }
}

async function reconcileState(state: RuntimeState, prepared: { candidateSetHash?: string; sourceUnits?: SourceUnit[]; stateExtraction?: boolean; systemPrompt?: string; userPrompt?: string; parts?: Array<{ systemPrompt: string; userPrompt: string; sourceUnits?: SourceUnit[]; stateExtraction?: boolean; cachedResult?: unknown }> }, onRepair?: () => void,
  accessRepair?: { plan: SourceAccessRepairPlan; apply: (response: unknown) => void }): Promise<ReconciliationSubmission> {
  if (prepared.candidateSetHash && prepared.parts?.length) {
    const decisions = [];
    const seedResolutions = [];
    let extractedState;
    for (const [index, part] of prepared.parts.entries()) {
      const submission = part.cachedResult !== undefined
        ? { candidateSetHash: prepared.candidateSetHash, result: ReconciliationResultSchema.parse(part.cachedResult) }
        : await reconcileState(state, { candidateSetHash: prepared.candidateSetHash, ...part }, onRepair, index === 0 ? accessRepair : undefined);
      if (part.cachedResult === undefined) await validatedPartRecorders.get(state)?.("reconciliation", part, submission.result);
      decisions.push(...(submission.result?.decisions ?? []));
      seedResolutions.push(...(submission.result?.seedResolutions ?? []));
      if (part.stateExtraction) {
        if (!submission.result?.state) throw new Error("State extraction response is missing state");
        extractedState = submission.result.state;
      }
    }
    return { candidateSetHash: prepared.candidateSetHash, result: { decisions, seedResolutions, ...(extractedState ? {state: extractedState} : {}) } };
  }
  if (!prepared.candidateSetHash || !prepared.systemPrompt || !prepared.userPrompt) return {};
  const messages = [{ role: "system", content: prepared.systemPrompt }, { role: "user", content: prepared.userPrompt }];
  if (accessRepair) {
    messages[0]!.content += `\n\n${accessRepair.plan.systemPrompt}\nReturn the ledger decisions and sourceAccessCorrections together in the same JSON object.`;
    messages[1]!.content += `\n\n${accessRepair.plan.userPrompt}`;
  }
  const purpose = accessRepair ? "reconciliation_repair" : "reconciliation";
  const first = await runModel(state, messages, purpose);
  const validate = (output: string, label: WorkerJsonPurpose): ReconciliationSubmission => {
    const raw = parseWorkerJson(state, output, label);
    const result = parseReconciliationResult(raw, prepared.sourceUnits);
    if (prepared.stateExtraction && !result.state) throw new Error("State extraction response is missing state");
    accessRepair?.apply(raw);
    return { candidateSetHash: prepared.candidateSetHash, result };
  };
  try { return validate(first, purpose); }
  catch (firstError) {
    onRepair?.();
    const repairPurpose = prepared.stateExtraction ? "state_response_repair" : "reconciliation_repair";
    const reason = structuredValidationDiagnostic(firstError);
    addLog(state.logs, "warn", `상태 응답 검증 실패: ${reason}; repair=${repairPurpose}`);
    let repaired: string;
    try { repaired = await runModel(state, buildAuxiliaryRepairMessages({
      originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "reconciliation" },
    }), repairPurpose); }
    catch (error) { throw new Error(`State response repair failed: ${String(error)}; initial_validation=${reason}`); }
    return validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "reconciliation",
      regenerate: () => runModel(state, messages, "reconciliation"),
      validate: (output, phase) => validate(output, phase === "repair" ? repairPurpose : "reconciliation"),
    });
  }
}

async function projectRelationships(state: RuntimeState, job: LeasedJob): Promise<unknown> {
  const messages = job.systemPrompt && job.userPrompt
    ? [{ role: "system", content: job.systemPrompt }, { role: "user", content: job.userPrompt }]
    : [{ role: "user", content: job.prompt }];
  const first = await runModel(state, messages, "relationship_projection");
  try { return RelationshipProjectionResultSchema.parse(parseWorkerJson(state, first, "relationship_projection"), { reportInput: true }); }
  catch (firstError) {
    const repaired = await runModel(state, buildAuxiliaryRepairMessages({
      originalMessages: messages, invalidOutput: first, validationError: firstError, request: { kind: "relationship_projection" },
    }), "relationship_projection_repair");
    return validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "relationship_projection",
      regenerate: () => runModel(state, messages, "relationship_projection"),
      validate: (output, phase) => {
        return RelationshipProjectionResultSchema.parse(parseWorkerJson(state, output, phase === "repair" ? "relationship_projection_repair" : "relationship_projection"), { reportInput: true });
      },
    });
  }
}

async function consolidateStorySpine(state: RuntimeState, job: LeasedJob): Promise<unknown> {
  const messages = job.systemPrompt && job.userPrompt
    ? [{ role: "system", content: job.systemPrompt }, { role: "user", content: job.userPrompt }]
    : [{ role: "user", content: job.prompt }];
  const first = await runModel(state, messages, "story_consolidation");
  const validate = (text: string, purpose: WorkerJsonPurpose) => {
    const parsed = StorySpineConsolidationResultSchema.parse(parseWorkerJson(state, text, purpose));
    if (!job.storyConsolidation) throw new Error("Story consolidation metadata unavailable");
    validateStorySpineConsolidation(parsed, job.storyConsolidation);
    return parsed;
  };
  try { return validate(first, "story_consolidation"); }
  catch (firstError) {
    await modelDraftRecorders.get(state)?.(first, structuredValidationDiagnostic(firstError));
    const repaired = await runModel(state, buildAuxiliaryRepairMessages({
      originalMessages: messages,
      invalidOutput: first,
      validationError: firstError,
      request: { kind: "story_spine", level: job.storyConsolidation?.level ?? "segment" },
    }), "story_consolidation_repair");
    return validateStructuredRepairOrRegenerate({
      original: first, repaired, purpose: "story_consolidation",
      regenerate: () => runModel(state, messages, "story_consolidation"),
      validate: (output, phase) => {
        return validate(output, phase === "repair" ? "story_consolidation_repair" : "story_consolidation");
      },
    });
  }
}

export function scheduleWorker(state: RuntimeState, client: ServerClient): void {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  if (state.settings.workerPaused || !isServerConfigured(state.settings)) return;
  if (state.settings.extractionEngine === "server") {
    state.idleTimer = window.setTimeout(() => void heartbeatServerWorker(state, client), 500);
    return;
  }
  state.idleTimer = window.setTimeout(() => void drainWorker(state, client), 15_000);
}

export async function heartbeatServerWorker(state: RuntimeState, client: ServerClient): Promise<void> {
  if (state.settings.workerPaused || state.settings.extractionEngine !== "server" || !isServerConfigured(state.settings)) return;
  try {
    state.serverWorker = await client.heartbeat(state.workerId, state.current && isChatMemoryEnabled(state.settings, state.current.chatId) ? state.current.chatId : undefined);
    state.serverConnectionIssue = undefined;
    state.activityStatusError = undefined;
    state.publishActivity?.();
    if (state.serverWorker.state === "faulted") {
      await pauseWithAttention(state, state.serverWorker.lastError ?? "Server extraction worker faulted");
    }
  } catch (error) {
    state.serverConnectionIssue = describeServerConnectionIssue(state.settings, error);
    state.activityStatusError = state.serverConnectionIssue?.detail;
    state.publishActivity?.();
    addLog(state.logs, "warn", `Server worker heartbeat failed: [오류 원문 제외]`, supportFailure("worker_heartbeat", error));
  }
}

export async function drainWorker(state: RuntimeState, client: ServerClient): Promise<void> {
  if (!isServerConfigured(state.settings)) return;
  if (state.settings.extractionEngine === "server") {
    await heartbeatServerWorker(state, client);
    return;
  }
  if (state.settings.workerPaused || state.workerBusy || state.risuConnectionTestRunning) return;
  state.workerBusy = true;
  try {
    for (;;) {
      if (state.settings.workerPaused) break;
      const job = await client.lease(state.workerId);
      state.serverConnectionIssue = undefined;
      state.activityStatusError = undefined;
      if (!job) break;
      const leaseHeartbeat = globalThis.setInterval(() => {
        void client.renewLease(job.id, state.workerId).catch((error) => addLog(state.logs, "warn", `작업 lease 갱신 실패: [오류 원문 제외]`));
      }, 20_000);
      const firstStage = job.kind === "relationship_projection" ? "relationship_projection" : job.kind === "story_consolidation" ? "story_consolidation" : job.kind === "ledger_consistency" ? "ledger_consistency" : "first_extraction";
      const llmCallStats: OperationLlmCallStats = { total: job.llmCallStats?.total ?? 0, repairs: job.llmCallStats?.repairs ?? 0, byPurpose: { ...(job.llmCallStats?.byPurpose ?? {}) } };
      let repairBudgetUsed = job.repairBudgetUsed ?? (llmCallStats.repairs > (llmCallStats.byPurpose.state_response_repair ?? 0));
      let stateRepairBudgetUsed = job.stateRepairBudgetUsed ?? ((llmCallStats.byPurpose.state_response_repair ?? 0) > 0);
      if (job.auxiliaryBudget) modelJobBudgets.set(state, job.auxiliaryBudget);
      validatedPartRecorders.set(state, async (purpose, part, result) => client.validatedAuxiliaryPart?.(job.id, state.workerId, purpose, part, result));
      modelDraftRecorders.set(state, async (output, storyValidationReason) => client.stageDraft?.(job.id, state.workerId, output, storyValidationReason));
      modelCallRecorders.set(state, async (purpose, outcome, error, usage) => {
        if (outcome === "started") {
          ({ repairBudgetUsed, stateRepairBudgetUsed } = consumeAuxiliaryRepair(purpose, { repairBudgetUsed, stateRepairBudgetUsed }));
          llmCallStats.total += 1;
          llmCallStats.byPurpose[purpose] = (llmCallStats.byPurpose[purpose] ?? 0) + 1;
          if (purpose.endsWith("_repair")) {
            llmCallStats.repairs += 1;
          }
        }
        const phase = state.currentJob?.phase;
        const stage = phase === "post_extraction_audit" || phase === "state_reconciliation" || phase === "ledger_consistency"
          || phase === "relationship_projection" || phase === "story_consolidation" || phase === "storing" ? phase : firstStage;
        await client.progress(job.id, state.workerId, stage, 0, llmCallStats, { purpose, attempt: job.attempt, outcome, at: Date.now(),
          ...(outcome === "failed" ? { error: String(error ?? "Model call failed") } : {}), ...(usage && Object.keys(usage).length ? { usage } : {}) });
      });
      state.currentJob = { id: job.id, chatId: job.chatId, attempt: job.attempt, sourceMessageCount: job.sourceMessageIds.length, sourceTurnCount: job.sourceTurnCount, startedAt: Date.now(), kind: job.kind, sourceRecovery: job.sourceRecovery, phase: job.kind === "episode" ? "capsule" : job.kind === "social_backfill" ? "social_backfill" : job.kind === "initial_calibration" ? "initial_calibration" : firstStage };
      state.publishActivity?.();
      try {
        if (job.kind !== "initial_calibration" && job.kind !== "social_backfill" && job.kind !== "episode" && job.kind !== "quiz") await client.progress(job.id, state.workerId, firstStage).catch(() => undefined);
        let result = job.kind === 'memory_group' ? await groupMemories(state, job) : job.kind === "audit_retry" ? job.auditDraft : job.kind === "episode" ? await runEpisode(state, job) : job.kind === "initial_calibration" ? await calibrateInitialSetup(state, job) : job.kind === "relationship_projection" ? await projectRelationships(state, job) : job.kind === "story_consolidation" ? await consolidateStorySpine(state, job) : job.kind === "ledger_consistency" ? await checkLedgerConsistency(state, job) : job.kind === "quiz" ? await generateQuiz(state, job) : await extract(state, job);
        if (job.kind === "extract" && job.continuationDraft) result = mergeExtractionPages(job.continuationDraft, result as any);
        const recoveringDialogues = job.kind === "audit_retry" && job.sourceRecovery
          && Boolean(job.auditDraft?.memories.some(memory => memory.keyDialogues?.length));
        if (recoveringDialogues && job.sourceUnits) {
          const issues = inspectSourceReferences(result, job.auditSourceMessages ?? [])
            .filter(issue => issue.reason !== "access_unverified");
          const messages = issues.length ? sourceRepairMessages(result, issues, job.sourceUnits) : null;
          if (messages) {
            try {
              const repaired = parseWorkerJson(state, await runModel(state, messages, "extraction_repair"), "extraction_repair");
              result = applySourceRepairs(result, repaired, issues, job.sourceUnits);
            } catch (error) { addLog(state.logs, "warn", `대사 원문 보완 미해결: [오류 원문 제외]`); }
          }
        }
        const incomplete = Boolean((result as any)?.unfinishedSource?.length);
        const reviewable = job.kind === "extract" || job.kind === "audit_retry" || job.kind === "episode" || job.kind === "social_backfill";
        if (!incomplete && job.postExtractionReview && reviewable && state.currentJob) {
          state.currentJob.phase = "post_extraction_audit";
          state.publishActivity?.();
          await client.progress(job.id, state.workerId, "post_extraction_audit").catch(() => undefined);
        }
        let audit = !incomplete && job.postExtractionReview && reviewable ? await auditExtraction(state, job, result) : undefined;
        let reconciliation: ReconciliationSubmission | undefined;
        if (!incomplete && !recoveringDialogues && job.kind !== 'memory_group' && job.kind !== "initial_calibration" && job.kind !== "relationship_projection" && job.kind !== "story_consolidation" && job.kind !== "ledger_consistency" && job.kind !== "quiz") {
          const reconciliationDraft = job.kind === "episode" ? extractionAuditDraftForJob(job, result) : result;
          let prepared = await client.prepareReconciliation(job.id, state.workerId, reconciliationDraft, audit);
          const repairIssues = prepared.evidenceIssues?.filter((issue) => issue.reason !== "access_unverified") ?? [];
          if (job.sourceUnits && prepared.groundingDraft && repairIssues.length) {
            result = prepared.groundingDraft;
            if (audit?.patch) audit = { ...audit, patch: ExtractionAuditPatchSchema.parse({ keepPendingItemRefs: audit.patch.keepPendingItemRefs }) };
            try {
              const messages = sourceRepairMessages(result, repairIssues, job.sourceUnits);
              if (messages) {
                const repaired = parseWorkerJson(state, await runModel(state, messages, "extraction_repair"), "extraction_repair");
                result = applySourceRepairs(result, repaired, repairIssues, job.sourceUnits);
              }
            } catch (error) { addLog(state.logs, "warn", `원문 보완 미해결: [오류 원문 제외]`); }
            prepared = await client.prepareReconciliation(job.id, state.workerId, result, audit);
          }
          const accessDraft = prepared.groundingDraft ?? result;
          const accessPlan = job.kind === "extract" && !job.memoryOnly && !job.sourceRecovery && !repairBudgetUsed && job.sourceUnits
            && !audit?.patch?.keepPendingItemRefs.length
            && (!audit?.patch || prepared.groundingDraft)
            ? planSourceAccessRepair(accessDraft as ExtractionDraftResult, job.sourceUnits, job.auditSourceMessages ?? []) : undefined;
          const applyAccess = (response: unknown) => {
            result = applySourceAccessRepair(accessDraft as ExtractionDraftResult, accessPlan!, response);
            if (audit?.patch) audit = { ...audit, patch: ExtractionAuditPatchSchema.parse({ keepPendingItemRefs: audit.patch.keepPendingItemRefs }) };
          };
          if (prepared.required && !job.memoryOnly && !job.sourceRecovery) {
            if (state.currentJob) state.currentJob.phase = "state_reconciliation";
            state.publishActivity?.();
            await client.progress(job.id, state.workerId, "state_reconciliation").catch(() => undefined);
            reconciliation = await reconcileState(state, prepared, undefined, accessPlan ? { plan: accessPlan, apply: applyAccess } : undefined);
          } else if (accessPlan) {
            try {
              const response = await runModel(state, [{ role: "system", content: accessPlan.systemPrompt }, { role: "user", content: accessPlan.userPrompt }], "extraction_repair");
              applyAccess(parseWorkerJson(state, response, "extraction_repair"));
            } catch (error) { addLog(state.logs, "warn", `원문 접근 근거 보완 미해결: [오류 원문 제외]`); }
          }
        }
        if (job.kind !== "quiz") {
          if (state.currentJob) state.currentJob.phase = "storing";
          state.publishActivity?.();
          await client.progress(job.id, state.workerId, "storing").catch(() => undefined);
        }
        const completed = await client.complete(job.id, state.workerId, result, reconciliation, audit);
        if (completed?.pendingReconciliations) state.statusSummary = { ...(state.statusSummary ?? { queuedJobs: 0, failedJobs: 0, pendingReviews: 0, pendingEmbeddings: 0, failedEmbeddings: 0 }), pendingReviews: (state.statusSummary?.pendingReviews ?? 0) + completed.pendingReconciliations, pendingReconciliations: (state.statusSummary?.pendingReconciliations ?? 0) + completed.pendingReconciliations };
        if (completed?.pendingReconciliations) state.publishStatusSummary?.();
        if (completed?.warnings?.length) addLog(state.logs, "warn", "Auxiliary job completed with warnings");
        addLog(state.logs, "info", `${job.kind === "quiz" ? "Quiz batch" : job.kind === "episode" ? "Episode capsule" : job.kind === "story_consolidation" ? "Story spine consolidation" : "Memory extraction"} completed (${job.sourceMessageIds.length} messages)`);
      } catch (error) {
        addLog(state.logs, "error", "Auxiliary job failed", supportFailure("worker_job", error, { kind: job.kind, attempt: job.attempt }));
        const failure = await client.fail(job.id, state.workerId, String(error));
        if (failure.status === "queued") {
          addLog(state.logs, "warn", `기억 묶음 재시도 ${failure.attempt + 1}/${failure.maxAttempts}: [오류 원문 제외]`);
          continue;
        }
        if (job.kind === "relationship_projection") {
          addLog(state.logs, "error", `관계 요약 갱신 실패(사건 장부와 기존 요약은 유지됨): [오류 원문 제외]`);
          continue;
        }
        if (job.kind === "story_consolidation") {
          addLog(state.logs, "error", `Story spine 생성 실패(기존 spine과 정본은 유지됨): [오류 원문 제외]`);
          continue;
        }
        if (job.kind === 'memory_group') {
          addLog(state.logs, 'warn', `묶기 후보 생성 실패(기존 기억은 유지됨): [오류 원문 제외]`);
          continue;
        }
        if (job.kind === "ledger_consistency") {
          addLog(state.logs, "warn", `최종 장부 대조 실패(기억과 기존 상태는 유지됨): [오류 원문 제외]`);
          continue;
        }
        if (job.kind === "quiz") {
          addLog(state.logs, "warn", `퀴즈 묶음 처리를 보류했습니다: [오류 원문 제외]`);
          continue;
        }
        addLog(state.logs, "error", `해당 채팅의 후속 기억 처리를 보류했습니다: [오류 원문 제외]`);
        continue;
      } finally {
        clearInterval(leaseHeartbeat);
        modelDraftRecorders.delete(state);
        validatedPartRecorders.delete(state);
        modelJobBudgets.delete(state);
        modelCallRecorders.delete(state);
        state.currentJob = undefined;
        state.publishActivity?.();
      }
    }
  } catch (error) {
    state.serverConnectionIssue = describeServerConnectionIssue(state.settings, error);
    state.activityStatusError = state.serverConnectionIssue?.detail;
    addLog(state.logs, "warn", `Worker queue connection failed without pausing processing: [오류 원문 제외]`, supportFailure("worker_queue", error));
  } finally {
    state.workerBusy = false;
    state.currentJob = undefined;
    state.publishActivity?.();
  }
}
