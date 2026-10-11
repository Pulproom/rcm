export const intimacyMilestoneKeys = (act: string): string[] => {
  const keys = ["first_physical_intimacy"];
  if (act === "hand_holding") keys.push("first_hand_holding");
  if (["embrace", "cuddling"].includes(act)) keys.push("first_embrace");
  if (["forehead_kiss", "cheek_kiss", "hand_kiss", "lip_kiss", "deep_kiss"].includes(act)) keys.push("first_kiss");
  if (act === "deep_kiss") keys.push("first_deep_kiss");
  if (act === "sexual_touch") keys.push("first_sexual_touch");
  if (act === "manual_sex") keys.push("first_manual_sex");
  if (act === "oral_sex") keys.push("first_oral_sex");
  if (act === "vaginal_sex") keys.push("first_vaginal_sex");
  if (act === "anal_sex") keys.push("first_anal_sex");
  return keys;
};

/** Compact, model-facing label used inside a wrapper that already states these are first occurrences. */
export const intimacyMilestonePacketType = (milestoneKey: string): string => milestoneKey.startsWith("first_")
  ? milestoneKey.slice("first_".length)
  : milestoneKey;
