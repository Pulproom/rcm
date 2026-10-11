export function emptyPacketManifest() {
  return {
    stateEvidenceIds: [] as string[],
    atomKeys: [] as string[], memoryIds: [] as string[], detailIds: [] as string[],
    relationshipPairs: [] as Array<{ from: string; to: string; stale: boolean }>,
    beliefIds: [] as string[], assertionIds: [] as string[], promiseIds: [] as string[], intimacyMilestoneIds: [] as string[],
  };
}
export type PacketManifest = ReturnType<typeof emptyPacketManifest>;
export function mergePacketManifests(items: PacketManifest[]): PacketManifest {
  const result = emptyPacketManifest();
  for (const key of Object.keys(result) as Array<keyof PacketManifest>) {
    (result as any)[key] = [...new Map(items.flatMap((item) => (item[key] ?? []) as any[]).map((value) => [JSON.stringify(value), value])).values()];
  }
  return result;
}
