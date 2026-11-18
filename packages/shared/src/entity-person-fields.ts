import type { z } from "zod";

/** Contract-owned semantic annotation, independent of the visitor's field list.
 * Validation stays unchanged; contract coverage tests inspect this metadata. */
export const personIdentity = <T extends z.ZodString>(schema: T): T => schema.meta({rcmPersonSlot:true});

/** Identity fields owned by event/state, setup-link and review contracts.
 * Canonicalization and a single extraction result's ingest guard share this.
 * World/state subjects deliberately remain outside person-only identity. */
export const STATE_PERSON_WRITING_FIELDS = {
  believer: { authored: "believer", canonical: "holder" },
  knower: { authored: "who", canonical: "holder" },
} as const;
export const CALIBRATION_PERSON_LINK_FIELDS = {
  relationship: { from: "fromKey", to: "toKey" },
  recognition: { holder: "holderKey", subject: "subjectKey" },
  progress: { persona: "personaKey", character: "characterKey" },
} as const;

type PersonField = { field: string; array?: boolean; owners?: readonly string[]; kinds?: readonly string[]; requireBoth?: boolean; objectItemField?: string };
export const ENTITY_PERSON_FIELDS: readonly PersonField[] = [
  ...["speaker","holder","promisor","promisee","perspective","initiator","from","to","from_entity","to_entity","persona","character","side",
    "hostCharacterName","userPersonaName","personaEntity","entityId","participant_a","participant_b","character_name",
    ...Object.values(CALIBRATION_PERSON_LINK_FIELDS).flatMap(pair=>Object.values(pair))]
    .map(field => ({field})),
  {field:STATE_PERSON_WRITING_FIELDS.believer.authored,kinds:["character_belief"]},
  ...["participants","hiddenFrom","noticedBy","pair","perspectives","activePerspectives","recentSpeakerNames","cachedPerspectives","accessibleTo"]
    .map(field => ({field,array:true})),
  {field:"knownBy",array:true,objectItemField:STATE_PERSON_WRITING_FIELDS.knower.authored},
  {field:"subject",owners:["socialKnowledge","social_knowledge","recognition","socialKnowledgePatches.record"],kinds:["recognition"]},
  {field:"target",owners:["socialRelation"],kinds:["interpersonal"],requireBoth:true},
  {field:"name",owners:["witnesses"]},
];

/** Mutates only declared identity slots. Traversal also accepts partial drafts
 * and review envelopes; it never parses prose or treats entity declarations as use. */
export function mapEntityPersonFields(value: unknown, map: (name: string) => string, owner = ""): void {
  if (Array.isArray(value)) { for (const item of value) mapEntityPersonFields(item,map,owner); return; }
  if (!value || typeof value !== "object") return;
  const row = value as Record<string,unknown>;
  for (const definition of ENTITY_PERSON_FIELDS) {
    const {field,owners,kinds} = definition;
    const ownerMatches = owners?.some(expected => owner === expected || owner.endsWith('.'+expected)) ?? false;
    const kindMatches = kinds?.includes(String(row.kind)) ?? false;
    if ((owners || kinds) && (definition.requireBoth ? !ownerMatches || !kindMatches : !ownerMatches && !kindMatches)) continue;
    const item = row[field];
    if (definition.array && Array.isArray(item)) row[field] = item.map(name => {
      if (typeof name === "string") return map(name);
      if (definition.objectItemField && name && typeof name === "object") {
        const grant = name as Record<string,unknown>, key = definition.objectItemField;
        if (typeof grant[key] === "string") grant[key] = map(grant[key]);
      }
      return name;
    });
    else if (!definition.array && typeof item === "string") row[field] = map(item);
  }
  for (const [key,item] of Object.entries(row)) mapEntityPersonFields(item,map,owner ? owner+'.'+key : key);
}
