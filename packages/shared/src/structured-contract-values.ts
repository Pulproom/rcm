export const ITEM_ACCESS_BASIS_VALUES = ["experienced", "witnessed", "told", "heard", "inferred", "internal"] as const;

export const PHYSICAL_INTIMACY_ACT_VALUES = [
  "hand_holding", "embrace", "cuddling", "forehead_kiss", "cheek_kiss", "hand_kiss",
  "lip_kiss", "deep_kiss", "sexual_touch", "manual_sex", "oral_sex", "vaginal_sex", "anal_sex", "other",
] as const;

export const SIGNED_RELATIONSHIP_BASELINE_VALUES = [
  "unknown", "exceptional_negative", "strong_negative", "negative", "slight_negative", "neutral",
  "slight_positive", "positive", "strong_positive", "exceptional_positive",
] as const;

export const INTENSITY_RELATIONSHIP_BASELINE_VALUES = ["unknown", "none", "low", "moderate", "high", "extreme"] as const;

export const KEY_DIALOGUE_KIND_VALUES = ["promise", "confession", "threat", "revelation", "boundary", "value", "reversal", "highlight"] as const;

export const MEMORY_DETAIL_KIND_VALUES = ["causal_beat", "concrete_detail", "spatial_detail", "object_state", "character_state", "clue", "attempt_outcome", "open_thread", "other"] as const;

export const INITIAL_AFFECTION_LEVELS = ["unknown", "aversion", "none", "faint", "growing", "established", "strong", "deep", "conflicted"] as const;
export const INITIAL_TRUST_LEVELS = ["unknown", "distrust", "none", "fragile", "developing", "established", "strong", "deep", "conflicted"] as const;
export const INITIAL_INTIMACY_LEVELS = ["unknown", "avoidant", "none", "tentative", "developing", "established", "strong", "deep", "conflicted"] as const;
export const INITIAL_INTENSITY_LEVELS = ["unknown", "none", "low", "moderate", "high", "extreme"] as const;
export const RELATIONSHIP_TREND_VALUES = ["rising", "stable", "falling", "volatile", "unclear"] as const;
