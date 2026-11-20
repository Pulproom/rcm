import { isMainCharacterEntity, escapeMemoryText as escape } from "@rcm/shared";
import { modelEntityContext } from "./entities.js";
import type { RcmDatabase } from "./db.js";
import { estimateTokens, narrationLine, viewpointUnknownTag, NARRATION_NAME_MAX_CHARACTERS, povSlots, projectMemoryScene, renderMemoryScene, type CardRenderOptions, type MemoryScene } from "@rcm/shared";
import { buildEmissionPlan, emittedMemoryItems, type EmissionPlan } from "./emission-plan.js";

export interface PacketPricing { tagTokens: number; narrationTokens: number }

/** One bound over canonical names, never over the requested viewpoint.
 * Price the actual escaped templates after their shared display bounding. */
export function packetPricing(names: readonly string[]): PacketPricing {
  return {
    tagTokens: Math.max(0, ...names.map(name => estimateTokens(escape(` · ${viewpointUnknownTag(name, true)}`)))),
    narrationTokens: Math.max(0, ...names.map(name => estimateTokens("\n" + narrationLine(name)))),
  };
}

export function chatPacketPricing(db: RcmDatabase, chatId: string): PacketPricing {
  return packetPricing(modelEntityContext(db, chatId).entities.filter(isMainCharacterEntity).map(entity => entity.name));
}

// Standalone callers without a chat retain a safe bound; request paths pass their own pricing.
const fallbackPricing = packetPricing(['"'.repeat(NARRATION_NAME_MAX_CHARACTERS), "<".repeat(NARRATION_NAME_MAX_CHARACTERS)]);
export const POV_TAG_RESERVE_TOKENS = fallbackPricing.tagTokens;
export const NARRATION_RESERVE_TOKENS = fallbackPricing.narrationTokens;

export function chargedCardTokens(scene: MemoryScene, options: Omit<CardRenderOptions, "viewpoint">, pricing: PacketPricing = fallbackPricing): number {
  if (!options.compact) scene = projectMemoryScene(emittedMemoryItems(buildEmissionPlan([scene.record]))[0]!);
  return estimateTokens(renderMemoryScene(scene, { ...options, viewpoint: undefined })) + povSlots(scene) * pricing.tagTokens;
}

export function chargedLaneRowTokens(text: string, pricing: PacketPricing = fallbackPricing): number {
  return estimateTokens(text) + pricing.tagTokens;
}

/** Parse only our XML envelopes and row grammar, never the meaning of prose.
 * Card rows have their own reservation; guidance is not a knowledge lane.
 * Only owned knowledge-tag rows can gain a POV annotation. Untagged history,
 * Story and recently ended rows have no such slot. */
export function chargedSectionTokens(omniscientXml: string, pricing: PacketPricing = fallbackPricing): number {
  if (!omniscientXml) return 0;
  const lanes = omniscientXml.replace(/<memory\b[^>]*>[\s\S]*?<\/memory>/g, "")
    .replace(/<story_continuity>[\s\S]*?<\/story_continuity>/g, "")
    .replace(/<relationship_landmarks>[\s\S]*?<\/relationship_landmarks>/g, "")
    .replace(/<guidance>[\s\S]*?<\/guidance>/g, "")
    // Names rows describe a direction, never a knowledge/POV claim.
    .replace(/^Names \(who knows whom, by what name; terms used so far, new ones may come\)\n(?:- [^\n]*(?:\n|$))*/gm, "");
  const slots = (lanes.match(/^\s*- (?:\[(?:[Kk]nown by|[Nn]o character knows)[^\n]*\] |[^\n]* \[(?:[Kk]nown by|[Nn]o character knows)[^\n]*\]: )/gm)?.length ?? 0)
    + (lanes.match(/<(?:occasion|open_commitment|first)\b[^>]*>\[(?:[Kk]nown by|[Nn]o character knows)/g)?.length ?? 0);
  return estimateTokens(omniscientXml) + slots * pricing.tagTokens;
}

/** Input must be the omniscient render. Viewpoint is applied only after all
 * budget decisions. Count only emitted lines, including always-inject cards. */
export function chargedMemorySectionTokens(omniscientXml: string, plan: EmissionPlan, pricing: PacketPricing = fallbackPricing): number {
  return chargedSectionTokens(omniscientXml, pricing) + emittedMemoryItems(plan).reduce((sum, item, index) => {
    const card = plan.cards[index]!;
    const scene = projectMemoryScene({...item,content:card.item.content});
    const options = { plot: card.plot, clarity: item.clarity,
      compact:card.alwaysInject && card.shape === 0 };
    return sum + chargedCardTokens(scene, options, pricing) - estimateTokens(renderMemoryScene(scene, options));
  }, 0);
}

export function chargedPacketTokens(omniscientXml: string, plan: EmissionPlan, pricing: PacketPricing = fallbackPricing): number {
  return pricing.narrationTokens + chargedMemorySectionTokens(omniscientXml, plan, pricing);
}
