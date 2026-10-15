import { withAuxiliaryStoryFraming } from "./social-memory-guidance.js";
import { ACCESS_BASIS_GUIDANCE } from "./state-classification.js";
import {
  INITIAL_AFFECTION_LEVELS,
  INITIAL_INTENSITY_LEVELS,
  INITIAL_INTIMACY_LEVELS,
  INITIAL_TRUST_LEVELS,
  INTENSITY_RELATIONSHIP_BASELINE_VALUES,
  ITEM_ACCESS_BASIS_VALUES,
  KEY_DIALOGUE_KIND_VALUES,
  MEMORY_DETAIL_KIND_VALUES,
  PHYSICAL_INTIMACY_ACT_VALUES,
  RELATIONSHIP_TREND_VALUES,
  SIGNED_RELATIONSHIP_BASELINE_VALUES,
} from "./structured-contract-values.js";
import { StructuredJsonSyntaxError } from "./structured-json.js";

export interface AuxiliaryRepairMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type AuxiliaryRepairRequest =
  | { kind: "memory_group" }
  | { kind: "extraction"; sourceMode: "source_units" | "message_ids" }
  | { kind: "initial_calibration" }
  | { kind: "episode_draft" }
  | { kind: "episode_finalize" }
  | { kind: "audit" }
  | { kind: "reconciliation" }
  | { kind: "ledger_consistency" }
  | { kind: "relationship_projection" }
  | { kind: "story_spine"; level: "segment" | "arc" | "overview" };

function diagnosticValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value).slice(0, 180);
  }
  if (Array.isArray(value)) return `[array length=${value.length}]`;
  if (typeof value === "object") return `{object keys=${Object.keys(value as Record<string, unknown>).slice(0, 8).join(",")}}`;
  return String(value).slice(0, 180);
}

/** A bounded, non-secret-bearing repair diagnostic shared by server and Risu workers. */
export function structuredValidationDiagnostic(error: unknown): string {
  const issues = (error as { issues?: Array<{ path?: PropertyKey[]; code?: string; message?: string; values?: unknown[]; input?: unknown }> } | undefined)?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues.slice(0, 12).map((issue) => {
      const parts = [`path=${issue.path?.join(".") || "root"}`, `code=${issue.code || "invalid"}`];
      const received = diagnosticValue(issue.input);
      if (received !== undefined) parts.push(`received=${received}`);
      if (Array.isArray(issue.values) && issue.values.length) parts.push(`allowed=${issue.values.map((value) => String(value)).join("|").slice(0, 500)}`);
      if (issue.message) parts.push(`message=${issue.message.replace(/\s+/g, " ").slice(0, 300)}`);
      return parts.join(" ");
    }).join("; ");
  }
  if (error instanceof SyntaxError) return `invalid_json: ${error.message.replace(/\s+/g, " ").slice(0, 500)}`;
  if (error instanceof Error) return `${error.name}: ${error.message.replace(/\s+/g, " ").slice(0, 500)}`;
  return `unknown_validation_error: ${String(error).replace(/\s+/g, " ").slice(0, 500)}`;
}

export function isUnchangedStructuredRepair(original: string, repaired: string): boolean {
  return original.trim() === repaired.trim();
}

export async function validateStructuredRepairOrRegenerate<T>(args: {
  original: string;
  repaired: string;
  purpose: string;
  regenerate: () => Promise<string>;
  validate: (output: string, phase: "repair" | "regeneration") => T | Promise<T>;
}): Promise<T> {
  if (isUnchangedStructuredRepair(args.original, args.repaired)) {
    const regenerated = await args.regenerate();
    try {
      return await args.validate(regenerated, "regeneration");
    } catch (error) {
      throw new Error(`UNCHANGED_INVALID_REPAIR: ${args.purpose} returned the same invalid JSON and fresh regeneration was invalid`, { cause: error });
    }
  }
  try {
    return await args.validate(args.repaired, "repair");
  } catch (error) {
    if (!(error instanceof StructuredJsonSyntaxError)) throw error;
    const regenerated = await args.regenerate();
    try {
      return await args.validate(regenerated, "regeneration");
    } catch (cause) {
      throw new Error(`INVALID_REPAIR_SYNTAX: ${args.purpose} repair was not valid JSON and fresh regeneration was invalid`, { cause });
    }
  }
}

/** Returns at most `limit` raw characters around a JSON parser's reported location. */
export function structuredJsonErrorWindow(raw: string, error: unknown, limit = 160): string | undefined {
  if (!(error instanceof SyntaxError) || limit < 1 || !raw) return undefined;
  const message = error.message;
  const positioned = message.match(/(?:at\s+)?position\s+(\d+)/i)?.[1];
  let position = positioned === undefined ? Number.NaN : Number(positioned);
  if (!Number.isFinite(position)) {
    const lineColumn = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (lineColumn) {
      const targetLine = Number(lineColumn[1]);
      const targetColumn = Number(lineColumn[2]);
      let line = 1;
      position = 0;
      while (line < targetLine && position < raw.length) if (raw[position++] === "\n") line += 1;
      position += Math.max(0, targetColumn - 1);
    }
  }
  if (!Number.isFinite(position)) {
    const token = message.match(/Unexpected token ['"](.+?)['"]/i)?.[1];
    if (token) position = raw.indexOf(token);
  }
  if (!Number.isFinite(position) || position < 0) return undefined;
  const width = Math.min(limit, raw.length);
  const start = Math.max(0, Math.min(raw.length - width, Math.floor(position - width / 2)));
  return raw.slice(start, start + width);
}

type JsonFrame = { type: "{" | "["; path: string; keys: string[]; pendingKey?: string };

/**
 * Describes the bracket structure of output that JSON.parse rejects: where the
 * top-level keys ended up and which containers are left open. This parses the
 * product-owned JSON envelope only; it never reads the text inside strings.
 */
export function structuredJsonShapeDiagnostic(raw: string): string | undefined {
  try { JSON.parse(raw); return undefined; } catch { /* describe the structure below */ }
  const start = raw.indexOf("{");
  if (start < 0) return "no JSON object found";
  const stack: JsonFrame[] = [];
  const objects: Array<{ path: string; keys: string[] }> = [];
  const notes: string[] = [];
  let inString = false, escaped = false, text = "", closedAt = -1;
  for (let index = start; index < raw.length; index++) {
    const char = raw[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') {
        inString = false;
        const frame = stack.at(-1);
        if (frame?.type === "{" && raw.slice(index + 1).trimStart().startsWith(":")) {
          frame.pendingKey = text;
          if (!frame.keys.includes(text)) frame.keys.push(text);
        }
      } else text += char;
      continue;
    }
    if (closedAt >= 0) {
      if (!/\s/u.test(char)) { notes.push(`extra content after the top-level object closed at position ${closedAt}`); break; }
      continue;
    }
    if (char === '"') { inString = true; text = ""; continue; }
    if (char === "{" || char === "[") {
      const parent = stack.at(-1);
      const path = !parent ? "$" : parent.type === "{" ? `${parent.path}.${parent.pendingKey ?? "?"}` : `${parent.path}[]`;
      const frame: JsonFrame = { type: char, path, keys: [] };
      if (char === "{" && stack.length <= 1) objects.push(frame);
      stack.push(frame);
    } else if (char === "}" || char === "]") {
      const frame = stack.pop();
      if (!frame) { notes.push(`unexpected ${char} at position ${index}`); break; }
      if ((char === "}") !== (frame.type === "{")) { notes.push(`${char} at position ${index} closes ${frame.path}, which was opened with ${frame.type}`); break; }
      if (!stack.length) closedAt = index;
    }
  }
  const list = (keys: string[]) => keys.slice(0, 24).join(", ") + (keys.length > 24 ? ", …" : "");
  const shape = objects.map((object) => `${object.path === "$" ? "top-level keys" : `keys inside ${object.path.slice(2)}`}: ${list(object.keys)}`);
  if (inString) notes.push("the output ends inside a string");
  if (closedAt < 0 && stack.length) notes.push(`the output ends with ${stack.length} container(s) still open: ${stack.map((frame) => `${frame.path === "$" ? "the top-level object" : frame.path.slice(2)} (${frame.type === "{" ? "}" : "]"} missing)`).reverse().join(", ")}`);
  return [...shape, ...notes].join("; ");
}

const commonInstruction ="Correct only the previous response. Preserve valid, supported content and do not invent facts or evidence. Return the complete corrected JSON object only, with no commentary or Markdown.";

function taskInstruction(request: AuxiliaryRepairRequest): string {
  switch (request.kind) {
    case "memory_group":
      return "Use only supplied evidence IDs and keep every valid grouping section and member.";
    case "extraction": {
      if (request.sourceMode === "source_units") {
        return "Use the same sourceRef and evidenceSourceRefs contract as the original system prompt. Preserve valid items and their keys. Do not replace missing evidence with invented facts.";
      }
      const evidence = `[{"messageId":"one supplied message ID","quote":"optional exact source excerpt"}]`;
      const access = `[{"holder":"character name","basis":"experienced|witnessed|told|heard|inferred|internal","evidence":${evidence},"confidence":1.0}]`;
      return `Follow this first-pass structural contract:
- Every field named evidence is an array shaped ${evidence}; never use a string or one object.
- Every stateObservations[] item has non-empty evidence in that shape and a non-empty batch-local key. Remove an unsupported observation instead of dropping its evidence. Preserve an existing key or use a simple kind-and-index label; never turn it into a canonical predicate or promise key.
- Every access field is an array shaped ${access}. access[].basis is one of ${ITEM_ACCESS_BASIS_VALUES.join("|")}. Empty access means narrator archive only.
${ACCESS_BASIS_GUIDANCE}
- The top level is exactly language, entities, memories, stateObservations, relationshipEvents, socialKnowledge, relationshipBaselines, physicalIntimacy, memoryRecallObservations, atomRelations, sourcePassages, unfinishedSource. sourcePassages and unfinishedSource are required arrays; use [] when empty. Never add canonical assertions, beliefs, or promises.
- physicalIntimacy[].act is exactly one of ${PHYSICAL_INTIMACY_ACT_VALUES.join("|")}; use other with customLabel only when no listed act fits.
- details[].kind is exactly one of ${MEMORY_DETAIL_KIND_VALUES.join("|")} and keyDialogues[].kind is exactly one of ${KEY_DIALOGUE_KIND_VALUES.join("|")}.
- relationshipBaselines affection/trust/intimacy use ${SIGNED_RELATIONSHIP_BASELINE_VALUES.join("|")}; fear/jealousy/hostility use ${INTENSITY_RELATIONSHIP_BASELINE_VALUES.join("|")}.`;
    }
    case "initial_calibration":
      return "Return exactly {entities:[...],relationships:[...],socialKnowledge:[...]}. Keep all independently supported starting recognition. For each entity, copy only its shortest exact displayed name from the cited renderedSetup source. For each relationship or recognition, copy short contiguous supporting substrings verbatim without changing punctuation or whitespace. Fix the reported structural/citation error; do not empty a collection merely to pass validation. Omit an unsupported record instead of inventing evidence. Never add timeline events, later knowledge, promises, or physical acts.";
    case "episode_draft":
      return "Return the strict episode draft shape with title, summary, participants, storyTime, locations, evidence, and keyDialogues. Preserve supplied source message IDs and complete source-language dialogue forms; do not invent evidence.";
    case "episode_finalize":
      return "Return one strict episode capsule object matching the original requested schema. Preserve supported source message IDs and source-language evidence.";
    case "audit":
      return "Return exactly the top-level keys requested by the original audit prompt. Use only listed refs and source message IDs. Do not make canonical lifecycle decisions.";
    case "reconciliation":
      return "Match the original reconciliation schema. If state discovery was requested, preserve the state object and return one decision per state observation key. Otherwise return one decision per supplied itemRef. Use only supplied existing targetIds. Never drop source-supported records to hide a structural error.";
    case "ledger_consistency":
      return "Match the requested strict final-ledger schema. Return every supplied itemRef exactly once and use only supplied IDs.";
    case "relationship_projection":
      return `Match the requested relationship projection schema and preserve every requested pair exactly once. Each axis is {level,trend}; trend is ${RELATIONSHIP_TREND_VALUES.join("|")}. affection levels: ${INITIAL_AFFECTION_LEVELS.join("|")}. trust levels: ${INITIAL_TRUST_LEVELS.join("|")}. intimacy levels: ${INITIAL_INTIMACY_LEVELS.join("|")}. fear, jealousy, and hostility levels: ${INITIAL_INTENSITY_LEVELS.join("|")}.`;
    case "story_spine": {
      const shape = request.level === "overview"
        ? "For an overview, emit exactly one perspective node whose holder is narrator."
        : "Emit at most one shared node and at most one perspective node per holder.";
      return `Keep only supplied support item IDs and do not add facts. ${shape}`;
    }
  }
}

function repairRole(role: string): AuxiliaryRepairMessage["role"] {
  if (role === "system" || role === "user" || role === "assistant") return role;
  throw new Error(`Unsupported auxiliary repair message role: ${role}`);
}

/** Builds the identical task-specific full-output repair turn for server and Risu transports. */
export function buildAuxiliaryRepairMessages(args: {
  originalMessages: ReadonlyArray<{ role: string; content: string }>;
  invalidOutput: string;
  validationError: unknown;
  request: AuxiliaryRepairRequest;
}): AuxiliaryRepairMessage[] {
  const diagnostic = structuredValidationDiagnostic(args.validationError);
  const diagnosticLabel = args.request.kind === "extraction" && args.request.sourceMode === "message_ids"
    ? "Validation paths"
    : "Validation error";
  // A parser position alone points at the end of a long object; the bracket shape shows where it went wrong.
  const shape = args.validationError instanceof SyntaxError ? structuredJsonShapeDiagnostic(args.invalidOutput) : undefined;
  const structure = shape ? `\nJSON structure of the previous response: ${shape}. Compare it with the required shape and move misplaced keys and brackets; the content itself may already be correct.` : "";
  const original = withAuxiliaryStoryFraming(args.originalMessages.map((message) => ({ role: repairRole(message.role), content: message.content })));
  return [
    ...original,
    { role: "assistant", content: args.invalidOutput },
    { role: "user", content: `${commonInstruction}\n${taskInstruction(args.request)}\n${diagnosticLabel}: ${diagnostic}${structure}` },
  ];
}
