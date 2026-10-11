import contract from "./mcp-contract.json" with { type: "json" };
/** Minimal host fetch-log shape exposed by the Risu v3 fetchLogs permission. */
export interface ProviderFetchLog {
  url: string;
  body: string;
  status?: number;
  response?: string;
  error?: string;
  timestamp: number;
}

export interface ProviderToolObservation {
  status: "observed" | "unmatched" | "unavailable" | "read_error" | "malformed" | "ambiguous";
  /** RCM tool names found in the exact matched provider request. */
  actualTools?: string[];
  toolDescriptionMatches?: Record<string, boolean>;
  timestamp?: number;
  logIndex?: number;
}

const RCM_TOOL_NAMES = new Set(contract.tools.map(tool => tool.name));

function promptTexts(root: Record<string, unknown>): string[] {
  const texts: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") { texts.push(value); return; }
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.content === "string") texts.push(record.content);
    if (typeof record.text === "string") texts.push(record.text);
    if (record.content && typeof record.content === "object") visit(record.content);
    if (record.parts) visit(record.parts);
  };
  // These are the prompt-bearing fields used by OpenAI-compatible, Gemini,
  // and Anthropic request envelopes. Arbitrary metadata (including a wrapper's
  // diagnostic packet field) is deliberately excluded from correlation.
  for (const key of ["messages", "input", "contents", "systemInstruction", "system"] as const) visit(root[key]);
  return texts;
}

function collectToolNames(root: Record<string, unknown>, descriptionMatches: Record<string, boolean>): Set<string> {
  const observe = (record: Record<string, unknown>) => {
    if (typeof record.name !== "string" || !RCM_TOOL_NAMES.has(record.name)) return;
    output.add(record.name);
    descriptionMatches[record.name] = record.description === contract.tools.find(tool => tool.name === record.name)?.description;
  };
  const output = new Set<string>();
  const tools = root.tools;
  if (!Array.isArray(tools)) return output;
  for (const item of tools) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const functionValue = record.function;
    if (functionValue && typeof functionValue === "object") {
      observe(functionValue as Record<string, unknown>);
    }
    observe(record);
    const declarations = record.functionDeclarations;
    if (Array.isArray(declarations)) for (const declaration of declarations) {
      if (declaration && typeof declaration === "object") observe(declaration as Record<string, unknown>);
    }
  }
  return output;
}

/**
 * Correlates a model request to the host fetch log without inspecting a URL
 * convention or relying on tool names being present. The exact packet text is
 * the correlation anchor. If it is absent, the result remains unknown.
 */
export function observeProviderRequest(
  logs: ProviderFetchLog[] | null | undefined,
  expectedPacket: string,
  startedAt: number,
  endedAt = Number.POSITIVE_INFINITY,
): ProviderToolObservation {
  if (!logs) return { status: "unavailable" };
  if (!expectedPacket) return { status: "unmatched" };
  let malformed = false;
  const matches: Array<{ index: number; timestamp: number; actualTools: string[]; toolDescriptionMatches: Record<string, boolean> }> = [];
  for (let index = 0; index < logs.length; index += 1) {
    const log = logs[index];
    if (!log || typeof log.body !== "string" || typeof log.timestamp !== "number" || log.timestamp < startedAt || log.timestamp > endedAt) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(log.body); }
    catch { malformed = true; continue; }
    const root = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    if (!promptTexts(root).some((text) => text.includes(expectedPacket))) continue;
    const toolDescriptionMatches: Record<string, boolean> = {};
    matches.push({ index, timestamp: log.timestamp, actualTools: [...collectToolNames(root, toolDescriptionMatches)].sort(), toolDescriptionMatches });
  }
  if (matches.length > 1) {
    const latestTimestamp = Math.max(...matches.map((match) => match.timestamp));
    const latest = matches.filter((match) => match.timestamp === latestTimestamp);
    if (latest.length !== 1) return { status: "ambiguous" };
    const match = latest[0]!;
    return { status: "observed", actualTools: match.actualTools, toolDescriptionMatches: match.toolDescriptionMatches, timestamp: match.timestamp, logIndex: match.index };
  }
  if (matches.length === 1) {
    const match = matches[0]!;
    return { status: "observed", actualTools: match.actualTools, toolDescriptionMatches: match.toolDescriptionMatches, timestamp: match.timestamp, logIndex: match.index };
  }
  return { status: malformed ? "malformed" : "unmatched" };
}
