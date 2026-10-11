export interface StorySpineSupportAccess {
  scopeHint: "shared" | "perspective";
  accessibleTo: string[];
  sourceOrdinal?: number;
}

export interface StorySpineValidationContext {
  level: "segment" | "arc" | "overview";
  allowedSupportItemIds: readonly string[];
  supportAccess: Record<string, StorySpineSupportAccess>;
}

interface StoryBeat {
  supportItemIds: string[];
}

interface StoryNode {
  scope: "shared" | "perspective";
  holder?: string;
  beats: StoryBeat[];
}

interface StoryResult {
  nodes: StoryNode[];
}

const normalizedHolder = (value: string | undefined): string => (value ?? "shared").normalize("NFKC").toLocaleLowerCase();

/** Validates the semantic source/access contract after the JSON schema succeeds. */
export function validateStorySpineConsolidation(result: StoryResult, context: StorySpineValidationContext): void {
  if (context.level === "overview" && (result.nodes.length !== 1
    || result.nodes[0]?.scope !== "perspective"
    || normalizedHolder(result.nodes[0]?.holder) !== "narrator")) {
    throw new Error("Story overview must contain exactly one narrator node");
  }
  const allowed = new Set(context.allowedSupportItemIds);
  const outputScopes = new Set<string>();
  for (const node of result.nodes) {
    const outputKey = `${node.scope}:${normalizedHolder(node.holder)}`;
    if (outputScopes.has(outputKey)) throw new Error(`Duplicate story spine scope in one generation group: ${outputKey}`);
    outputScopes.add(outputKey);
    for (const beat of node.beats) for (const id of beat.supportItemIds) {
      if (!allowed.has(id)) throw new Error(`Story spine cited an unknown support item: ${id}`);
      const access = context.supportAccess[id];
      if (!access) throw new Error(`Story spine support access is unavailable: ${id}`);
      if (node.scope === "shared" && access.scopeHint !== "shared") throw new Error(`Private support cannot enter a shared story spine node: ${id}`);
      if (context.level !== "overview" && node.scope === "perspective"
        && !access.accessibleTo.some((holder) => normalizedHolder(holder) === normalizedHolder(node.holder))) {
        throw new Error(`Story spine support is not accessible to holder ${node.holder}: ${id}`);
      }
    }
  }
}
