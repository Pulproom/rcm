import { z } from "zod";
import { normalizeAuxiliaryShape, type AuxiliaryShapeAlias, type AuxiliaryShapeContext } from "./auxiliary-shape.js";
import { extractionDraftSchema, ExtractionAuditPatchSchema, EpisodeDraftResultSchema, EpisodeCapsuleResultSchema, InitialCalibrationResultSchema, LedgerConsistencyResultSchema, RelationshipProjectionResultSchema, StorySpineConsolidationResultSchema, ReconciliationResultSchema, StateExtractionSchema, StateObservationSchema, SeedResolutionSchema, ItemAccessGrantSchema } from "./index.js";
import { MemoryGroupingResultSchema } from "./memory-grouping.js";
import { QuizDraftSchema } from "./quiz.js";

// Aliases are contract declarations, never inferred from a misspelled field.
const predicateAlias={from:"predicate",to:"predicateHint"};
const CONTRACT_OBSERVATION_ALIASES:Readonly<Record<string,Readonly<Record<string,readonly typeof predicateAlias[]>>>>={
  r11:{world_fact:[predicateAlias],character_belief:[predicateAlias]},
};

/** Authored contracts may differ from the storage shape. Overrides here declare
 * only wire fields; expansion and all semantic/link checks still run afterward. */
export function normalizeAuxiliaryResponse(value:unknown,context:AuxiliaryShapeContext) {
  const purpose=context.purpose.replace(/_repair$/, "");
  let schema:z.ZodType|undefined;
  const aliases:AuxiliaryShapeAlias[]=[];
  if(purpose==="reconciliation"||purpose==="state_response") {
    const ref=z.object({memoryKey:z.string().min(1),detailKey:z.string().min(1)});
    const selectors=z.array(z.union([z.string().min(1),z.object({sourceRef:z.string().min(1),quote:z.string().optional()}),z.object({messageId:z.string().min(1)})])).min(1);
    const knower=z.object({who:z.string().min(1),basis:ItemAccessGrantSchema.shape.basis,
      confidence:ItemAccessGrantSchema.shape.confidence,evidence:selectors.optional()});
    const inline=z.object({memoryKey:z.string().min(1),text:z.string().min(1),knownBy:z.array(knower),evidence:selectors});
    const support=z.array(context.contract==="r11" ? z.union([ref,inline]) : ref).min(1).optional();
    const observation=z.discriminatedUnion("kind",StateObservationSchema.options.map(option=>option.extend({support})) as unknown as typeof StateObservationSchema.options);
    const state=StateExtractionSchema.safeExtend({stateObservations:z.array(observation).default([])});
    const nested=!!value&&typeof value==="object"&&"state" in value;
    const seedResolutions=z.array(SeedResolutionSchema.extend({support})).optional();
    schema=nested ? ReconciliationResultSchema.extend({state:state.optional(),seedResolutions}) : z.object({...state.shape,decisions:ReconciliationResultSchema.shape.decisions.optional(),seedResolutions});
    if(context.contract==="r11"&&value&&typeof value==="object") {
      const container=nested ? (value as {state?:unknown}).state : value;
      const observations=container&&typeof container==="object" ? (container as {stateObservations?:unknown}).stateObservations : undefined;
      if(Array.isArray(observations))observations.forEach((item,index)=>{
        const metadata=Object.hasOwn(CONTRACT_OBSERVATION_ALIASES,context.contract) ? CONTRACT_OBSERVATION_ALIASES[context.contract] : undefined;
        const declared=metadata && typeof item?.kind==="string" && Object.hasOwn(metadata,item.kind) ? metadata[item.kind] : [];
        for(const alias of declared ?? [])aliases.push({path:[...(nested ? ["state"] : []),"stateObservations",index],...alias});
      });
    }
  } else if(purpose==="extraction")schema=extractionDraftSchema(context.contract as Parameters<typeof extractionDraftSchema>[0]);
  else if(purpose==="audit")schema=ExtractionAuditPatchSchema;
  else if(purpose==="episode_draft")schema=EpisodeDraftResultSchema;
  else if(purpose==="episode_finalize")schema=EpisodeCapsuleResultSchema;
  else if(purpose==="initial_calibration")schema=InitialCalibrationResultSchema;
  else if(purpose==="ledger_consistency")schema=LedgerConsistencyResultSchema;
  else if(purpose==="relationship_projection")schema=RelationshipProjectionResultSchema;
  else if(purpose==="story_consolidation")schema=StorySpineConsolidationResultSchema;
  else if(purpose==="memory_group")schema=MemoryGroupingResultSchema;
  else if(purpose==="quiz")schema=Array.isArray(value) ? z.array(QuizDraftSchema) : z.object({items:z.array(QuizDraftSchema)});
  return schema ? normalizeAuxiliaryShape(value,schema,context,aliases) : {value,diagnostics:[]};
}
