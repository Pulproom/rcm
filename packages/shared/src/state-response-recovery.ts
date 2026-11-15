import { normalizeAuxiliaryResponse } from "./auxiliary-response-shape.js";
import { AuxiliaryShapeDiagnosticSchema, type AuxiliaryShapeDiagnostic } from "./auxiliary-shape.js";
import { z } from "zod";
import { ModelContentValidationError } from "./structured-repair.js";
import { StateExtractionSchema } from "./index.js";
import type { ReconciliationResult } from "./index.js";
import { planExtractionFieldRepair, applyExtractionFieldRepair } from "./extraction-field-repair.js";
import { resolveModelSourceReferences, type SourceUnit } from "./source-references.js";
import { SIGNED_RELATIONSHIP_BASELINE_VALUES, INTENSITY_RELATIONSHIP_BASELINE_VALUES } from "./structured-contract-values.js";
import { expandStateWritingFormat, type StateWritingContext } from "./state-writing-format.js";

export type StateEnvelopeFix = "flat_envelope" | "lifted_sibling" | "null_optional" | "numeric_scale" | "writing_format";
export const STATE_LIST_KEYS: readonly string[] = ["entities", "memories", "detailAdditions", "stateObservations", "relationshipEvents", "socialKnowledge", "relationshipBaselines", "physicalIntimacy"];
export const STATE_SIBLING_KEYS = ["decisions", "pairProgress", "seedResolutions"] as const;
export class StateEnvelopeConflictError extends Error {}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const empty = (value: unknown) => Array.isArray(value) && value.length === 0;

/** Consult the item schema, including its discriminant, rather than a vocabulary
 * of optional property names. Required null values stay available to validation. */
function removeOptionalNulls(value: unknown, schema: z.ZodType, fixes: Set<StateEnvelopeFix>): unknown {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault || schema instanceof z.ZodNullable || schema instanceof z.ZodCatch) {
    return removeOptionalNulls(value, schema.unwrap() as z.ZodType, fixes);
  }
  if (schema instanceof z.ZodPipe) return removeOptionalNulls(value, schema.out as z.ZodType, fixes);
  if (schema instanceof z.ZodDiscriminatedUnion && record(value)) {
    const option = schema.options.find(option => option instanceof z.ZodObject && option.shape[schema.def.discriminator]?.safeParse(value[schema.def.discriminator]).success);
    return option ? removeOptionalNulls(value, option as z.ZodType, fixes) : value;
  }
  if (schema instanceof z.ZodArray && Array.isArray(value)) return value.map(item => removeOptionalNulls(item, schema.element as z.ZodType, fixes));
  if (schema instanceof z.ZodObject && record(value)) {
    const output = { ...value };
    for (const [key, child] of Object.entries(schema.shape) as [string, z.ZodType][]) {
      if (!(key in output)) continue;
      if (output[key] === null && child.isOptional()) {
        delete output[key];
        fixes.add("null_optional");
      } else output[key] = removeOptionalNulls(output[key], child, fixes);
    }
    return output;
  }
  return value;
}

export function normalizeStateEnvelope(raw: unknown, context?: StateWritingContext, sourceUnits?: SourceUnit[]): { value: unknown; fixes: StateEnvelopeFix[]; diagnostics?:string[]; normalizations?:AuxiliaryShapeDiagnostic[] } {
  if (!record(raw)) return { value:raw,fixes:[] };
  const shaped = normalizeAuxiliaryResponse(raw,{contract:context?.stateContract ?? "legacy",purpose:"reconciliation"});
  if (!("state" in raw || STATE_LIST_KEYS.some(key => key in raw))) return {value:shaped.value,fixes:[],...(shaped.diagnostics.length ? {normalizations:shaped.diagnostics} : {})};
  let value = structuredClone(shaped.value) as Record<string,unknown>;
  const fixes = new Set<StateEnvelopeFix>();
  const flatKeys = STATE_LIST_KEYS.filter(key => key in value);
  if (flatKeys.length) {
    if (!("state" in value)) value.state = {};
    if (!record(value.state)) throw new StateEnvelopeConflictError("State envelope has incompatible placements");
    for (const key of flatKeys) {
      if (key in value.state && !empty(value.state[key]) && !empty(value[key])) throw new StateEnvelopeConflictError(`Conflicting state placements: ${key}`);
      if (!(key in value.state) || empty(value.state[key])) value.state[key] = value[key];
      delete value[key];
    }
    fixes.add("flat_envelope");
  }
  if (record(value.state)) {
    for (const key of STATE_SIBLING_KEYS) {
      if (!(key in value.state)) continue;
      if (key in value && !empty(value[key]) && !empty(value.state[key])) throw new StateEnvelopeConflictError(`Conflicting state sibling placements: ${key}`);
      if (!(key in value) || empty(value[key])) value[key] = value.state[key];
      delete value.state[key];
      fixes.add("lifted_sibling");
    }
  }
  const diagnostics:string[]=[];
  const expanded = expandStateWritingFormat(value, context, sourceUnits, message=>diagnostics.push(message)) as Record<string, unknown>;
  if (JSON.stringify(expanded) !== JSON.stringify(value)) fixes.add("writing_format");
  value = expanded;
  if (record(value.state)) {
    value.state = removeOptionalNulls(value.state, StateExtractionSchema, fixes);
    const baselines = (value.state as Record<string, unknown>).relationshipBaselines;
    if (Array.isArray(baselines)) for (const baseline of baselines) {
      if (!record(baseline)) continue;
      for (const axis of ["affection", "trust", "intimacy", "fear", "jealousy", "hostility"]) {
        const number = baseline[axis];
        const signed = ["affection", "trust", "intimacy"].includes(axis);
        if (typeof number !== "number" || !Number.isInteger(number) || number < (signed ? -4 : 0) || number > 4) continue;
        baseline[axis] = signed ? SIGNED_RELATIONSHIP_BASELINE_VALUES[number + 5] : INTENSITY_RELATIONSHIP_BASELINE_VALUES[number + 1];
        fixes.add("numeric_scale");
      }
    }
  }
  return { value, fixes: [...fixes], ...(shaped.diagnostics.length ? {normalizations:shaped.diagnostics} : {}), ...(diagnostics.length ? {diagnostics} : {}) };
}

/** Exact canonical JSON identity avoids positional drift and hash collisions.
 * Like the authored candidate, it belongs to raw diagnostics, never list UI. */
export function stateItemIdentity(list:string,candidate:unknown):string {
  const canonical=(value:unknown):unknown=>Array.isArray(value) ? value.map(canonical) : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
  return JSON.stringify([list,canonical(candidate)]);
}
export interface StateItemDrop { identity?:string; disposition?:"withheld"|"omitted"; candidate?: unknown; point?: string; path: (string | number)[]; list: string; key?: string; reason: string; cascadeOf?: string }
export interface StateRecoveryReport { normalizations?:AuxiliaryShapeDiagnostic[]; localFixes: string[]; fieldRepairCalls: number; correctedFields: number; drops: StateItemDrop[]; wholeRepair: boolean; regenerated: boolean }
export const StateRecoveryReportSchema = z.object({
  normalizations:z.array(AuxiliaryShapeDiagnosticSchema).optional(),
  localFixes: z.array(z.string()), fieldRepairCalls: z.number().int().min(0).max(1), correctedFields: z.number().int().nonnegative(),
  drops: z.array(z.object({ identity:z.string().optional(),disposition:z.enum(["withheld","omitted"]).optional(), candidate: z.unknown().optional(), point: z.string().optional(), path: z.array(z.union([z.string(), z.number().int().nonnegative()])), list: z.string(), key: z.string().optional(), reason: z.string(), cascadeOf: z.string().optional() })),
  wholeRepair: z.boolean(), regenerated: z.boolean(),
});

export class StateItemValidationError extends ModelContentValidationError {
  constructor(readonly issues: Array<{ path: (string | number)[]; message: string; point: string }>) { super(issues.map(issue => `${issue.point}: ${issue.message}`).join("; ")); }
}
/** Inspect product-owned decision IDs only. Never invent a missing decision. */
export function stateDecisionIssues(result: ReconciliationResult, suppliedIds?: ReadonlySet<string>) {
  const issues: StateItemValidationError["issues"] = [];
  const observations = result.state?.stateObservations ?? [];
  const expected = new Set(observations.map(item => `observation:${item.key}`));
  observations.forEach((observation, index) => {
    const matches = result.decisions.filter(decision => decision.itemRef === `observation:${observation.key}`);
    const path = ["state", "stateObservations", index];
    if (matches.length !== 1 || observations.filter(item => item.key === observation.key).length !== 1) {
      issues.push({ path, point: "C4:decision_coverage", message: "Observation needs exactly one unambiguous decision" }); return;
    }
    const decision = matches[0]!;
    const targets = decision.targetIds;
    const needsTarget = ["reinforce", "supersede", "end", "dispute"].includes(decision.action);
    if ((needsTarget && !targets.length) || (!needsTarget && targets.length)
      || suppliedIds && targets.some(id => !suppliedIds.has(id))) {
      issues.push({ path, point: "C5:decision_targets", message: "Decision has unavailable targets or invalid target cardinality" });
    }
  });
  result.decisions.forEach((decision, index) => {
    if (!expected.has(decision.itemRef)) issues.push({ path: ["decisions", index], point: "C4:decision_coverage", message: "Decision names no observation" });
  });
  return issues;
}

type Item = { path: (string | number)[]; list: string; value: unknown; array: unknown[]; index: number };
function stateItems(raw: unknown): Item[] {
  if (!record(raw)) return [];
  const items: Item[] = [];
  const lists = [...STATE_LIST_KEYS.map(list => ({ parent: raw.state, list, prefix: ["state", list] })),
    ...STATE_SIBLING_KEYS.map(list => ({ parent: raw, list, prefix: [list] })),
    ...(!("state" in raw) ? [...STATE_LIST_KEYS,"assertions","beliefs","promises"].map(list=>({parent:raw,list,prefix:[list]})) : [])];
  for (const { parent, list, prefix } of lists) {
    const array = record(parent) ? parent[list] : undefined;
    if (Array.isArray(array)) array.forEach((value, index) => items.push({ path: [...prefix, index], list, value, array, index }));
  }
  return items;
}

/** Drop complete list items only. Paths remain relative to the authored response,
 * even when several dependent records are removed in the same pass. */
export function isolateInvalidStateItems(raw: unknown, error: unknown): { value: unknown; drops: StateItemDrop[] } | undefined {
  if (!(error instanceof z.ZodError || error instanceof StateItemValidationError) || !error.issues.length) return;
  const value = structuredClone(raw);
  const items = stateItems(value);
  const removed = new Map<Item, StateItemDrop>();
  const remove = (item: Item, reason: string, cascadeOf?: string) => {
    const candidate = record(item.value) ? item.value : {};
    const detail = record(candidate.detail) ? candidate.detail : {};
    removed.set(item, { path: item.path, list: item.list,point:`state_schema:${item.list}`,candidate:structuredClone(item.value),identity:stateItemIdentity(item.list,item.value),disposition:"withheld",
      ...(typeof candidate.key === "string" ? { key: candidate.key } : typeof detail.key === "string" ? { key: detail.key } : {}), reason, ...(cascadeOf ? { cascadeOf } : {}) });
  };
  for (const issue of error.issues) {
    const item = items.find(item => item.path.every((key, index) => issue.path[index] === key));
    if (!item) return;
    const reason = "point" in issue ? `${issue.point}: ${issue.message}` : `${issue.path.join(".")}: ${issue.code}`;
    if (removed.has(item)) removed.get(item)!.reason += `; ${reason}`;
    else remove(item, reason);
    if ("point" in issue) Object.assign(removed.get(item)!, { point: issue.point, candidate: structuredClone(item.value) });
  }
  const linkedTo = (candidate: unknown, memoryKey: unknown, detailKeys?: unknown[]): boolean => {
    if (!record(candidate)) return false;
    if (!detailKeys && typeof memoryKey === "string" && (candidate.memoryKey === memoryKey || candidate.validFromMemoryKey === memoryKey)) return true;
    if (Array.isArray(candidate.support) && candidate.support.some(ref=>record(ref) && ref.memoryKey===memoryKey && (!detailKeys || detailKeys.includes(ref.detailKey)))) return true;
    if (detailKeys && (memoryKey === undefined || candidate.memoryKey === undefined || candidate.memoryKey === memoryKey)) {
      if (detailKeys.includes(candidate.detailKey)) return true;
      for (const key of ["cognitionDetailKeys", "detailKeys"]) if (Array.isArray(candidate[key]) && candidate[key].some(key => detailKeys.includes(key))) return true;
    }
    return Object.values(candidate).some(child => Array.isArray(child)
      ? child.some(item => linkedTo(item, memoryKey, detailKeys)) : linkedTo(child, memoryKey, detailKeys));
  };
  // Fixed point: removing a memory can remove an addition, its recognition,
  // a relation observation and finally that observation's decision.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [source, drop] of [...removed]) {
      const sourceValue = record(source.value) ? source.value : {};
      for (const item of items) {
        if (removed.has(item)) continue;
        const candidate = record(item.value) ? item.value : {};
        let linked = source.list === "stateObservations" && typeof sourceValue.key === "string" && item.list === "decisions" && candidate.itemRef === `observation:${sourceValue.key}`;
        linked ||= source.list === "decisions" && typeof candidate.key === "string" && item.list === "stateObservations" && sourceValue.itemRef === `observation:${candidate.key}`;
        if (source.list === "memories") {
          linked ||= linkedTo(candidate, sourceValue.key);
          const keys = Array.isArray(sourceValue.details) ? sourceValue.details.filter(record).map(detail => detail.key).filter(key => typeof key === "string") : [];
          if (keys.length) linked ||= linkedTo(candidate, sourceValue.key, keys);
        }
        if (source.list === "detailAdditions" && record(sourceValue.detail) && typeof sourceValue.detail.key === "string") linked ||= linkedTo(candidate, sourceValue.memoryKey, [sourceValue.detail.key]);
        if (!linked) continue;
        remove(item, "dependent record removed", drop.path.join("."));
        if (drop.point) Object.assign(removed.get(item)!, { point: `${drop.point}:dependent`, reason: `${drop.point}:dependent record removed`, candidate: structuredClone(item.value) });
        changed = true;
      }
    }
  }
  const linkDrops: StateItemDrop[] = [];
  // Associations are optional edges, not the memory's evidence. Retain the
  // grounded memory, but report removal of every edge to an isolated memory.
  for (const item of items) {
    if (removed.has(item) || item.list !== "memories" || !record(item.value) || !Array.isArray(item.value.associations)) continue;
    item.value.associations = item.value.associations.filter((key, index) => {
      const source = [...removed].find(([source]) => source.list === "memories" && record(source.value) && source.value.key === key);
      if (!source) return true;
      const point = `${source[1].point ?? "state_schema"}:association`;
      linkDrops.push({ path: [...item.path, "associations", index], list: "associations", point,
        candidate: key,identity:stateItemIdentity("associations",{memoryKey:(item.value as Record<string,unknown>).key,key}),disposition:"withheld", reason: `${point}: referenced memory withheld`, cascadeOf: source[1].path.join(".") });
      return false;
    });
  }
  for (const item of [...removed.keys()].sort((a, b) => b.index - a.index)) item.array.splice(item.index, 1);
  return { value, drops: [...removed.values(), ...linkDrops] };
}

/** A state selector failure is attributable without parsing an exception's text. */
export function inspectStateSourceSelectors(raw: unknown, units: SourceUnit[]): void {
  const issues: StateItemValidationError["issues"] = [];
  const allowed = new Set(units.map(unit=>unit.messageId));
  const checkIds = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.every(checkIds);
    if (!record(value)) return true;
    return Object.entries(value).every(([key,child])=>key==="messageId" ? typeof child==="string"&&allowed.has(child) : checkIds(child));
  };
  for (const item of stateItems(raw)) {
    try {
      const resolved = resolveModelSourceReferences(item.value,units);
      if (!checkIds(resolved)) issues.push({path:item.path,point:"C2:source_selectors",message:"Item has an out-of-job citation"});
    } catch { issues.push({path:item.path,point:"C2:source_selectors",message:"Item has a malformed or forbidden source selector"}); }
  }
  if (issues.length) throw new StateItemValidationError(issues);
}

export async function recoverStateResponse(args: {
  first: string;
  parse: (text: string) => unknown;
  validate: (raw: unknown) => ReconciliationResult;
  sourceUnits?: SourceUnit[];
  writing?: StateWritingContext;
  callModel: (messages: { role: "system" | "user"; content: string }[], purpose: "state_field_repair") => Promise<string>;
  wholeRepair: (error: unknown) => Promise<ReconciliationResult>;
}): Promise<{ result: ReconciliationResult; report: StateRecoveryReport }> {
  const report: StateRecoveryReport = { localFixes: [], fieldRepairCalls: 0, correctedFields: 0, drops: [], wholeRepair: false, regenerated: false };
  const wholeRepair = async (error: unknown) => {
    report.wholeRepair = true;
    const result = await args.wholeRepair(error);
    // A whole replacement is validated independently of attempted isolation.
    // Those attempts cannot describe the final replacement's withheld items.
    report.drops = [];
    return { result, report };
  };
  let raw: unknown;
  try {
    const normalized = normalizeStateEnvelope(args.parse(args.first), args.writing, args.sourceUnits);
    raw = normalized.value;
    if(normalized.normalizations?.length)report.normalizations = normalized.normalizations;
    report.localFixes = [...normalized.fixes,...(normalized.diagnostics ?? [])];
  } catch (error) { return wholeRepair(error); }
  let error: unknown;
  try { return { result: args.validate(raw), report }; } catch (caught) { error = caught; }
  // Do not spend the small repair on syntax, envelope or cross-item failures.
  if (!isolateInvalidStateItems(raw, error)) return wholeRepair(error);
  if (error instanceof z.ZodError) {
    const enumIssues = error.issues.filter(issue => issue.code === "invalid_value");
    const resolved = args.sourceUnits ? resolveModelSourceReferences(raw, args.sourceUnits) : raw;
    const plan = enumIssues.length ? planExtractionFieldRepair(raw, resolved, { issues: enumIssues }, args.sourceUnits ?? []) : undefined;
    if (plan) {
      report.fieldRepairCalls = 1;
      try {
        const response = args.parse(await args.callModel(plan.messages, "state_field_repair"));
        // Reuse the call-1 patch validator for each fully supplied correction.
        // Unresolved state fields have no sourcePassages exception: they remain
        // invalid and are isolated below. Never synthesize a correction.
        if (record(response) && Object.keys(response).every(key => key === "corrections") && Array.isArray(response.corrections) && response.corrections.length <= plan.fields.length) {
          const corrections = response.corrections;
          for (const field of plan.fields) {
            const matches = corrections.filter(correction => record(correction) && correction.id === field.id);
            if (matches.length !== 1) continue;
            try {
              raw = applyExtractionFieldRepair(raw, { ...plan, fields: [field] }, { corrections: matches });
              report.correctedFields += 1;
            } catch { /* An out-of-contract correction leaves its item invalid. */ }
          }
        }
      } catch { /* A failed small call must not discard valid siblings. */ }
      try { return { result: args.validate(raw), report }; } catch (caught) { error = caught; }
    }
  }
  let isolated = isolateInvalidStateItems(raw, error);
  if (!isolated) return wholeRepair(error);
  report.drops.push(...isolated.drops);
  // Revalidate after each deterministic removal until only survivors remain.
  while (isolated) {
    raw = isolated.value;
    try { return { result: args.validate(raw), report }; } catch (caught) {
      const next = isolateInvalidStateItems(raw, caught);
      if (!next || !next.drops.length) return wholeRepair(caught);
      report.drops.push(...next.drops);
      isolated = next;
    }
  }
  return wholeRepair(error);
}
