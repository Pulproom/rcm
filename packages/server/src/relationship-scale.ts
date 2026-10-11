export const RELATIONSHIP_AXES = ["affection", "trust", "fear", "jealousy", "intimacy", "hostility"] as const;
export type RelationshipAxis = (typeof RELATIONSHIP_AXES)[number];
