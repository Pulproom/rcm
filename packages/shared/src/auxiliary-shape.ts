import { z } from "zod";

export const AuxiliaryShapeDiagnosticSchema = z.object({
  contract:z.string(), purpose:z.string(), path:z.array(z.union([z.string(),z.number().int().nonnegative()])),
  rule:z.enum(["single_key_wrapper","declared_alias"]), beforeShape:z.string(), afterShape:z.string(),
});
export type AuxiliaryShapeDiagnostic = z.infer<typeof AuxiliaryShapeDiagnosticSchema>;
export interface AuxiliaryShapeContext { contract:string; purpose:string }
export interface AuxiliaryShapeAlias { path:readonly (string|number)[]; from:string; to:string }
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const shape=(v:unknown):string=>object(v) ? `object(${Object.keys(v).sort().join(",")})` : Array.isArray(v) ? "array" : v===null ? "null" : typeof v;

/** A lossless authored-value adapter. Zod's parsed/defaulted output is never
 * substituted for the input. Opaque record/unknown subtrees are not traversed. */
export function normalizeAuxiliaryShape(value:unknown,schema:z.ZodType,context:AuxiliaryShapeContext,aliases:readonly AuxiliaryShapeAlias[]=[]):{value:unknown;diagnostics:AuxiliaryShapeDiagnostic[]} {
  const diagnostics:AuxiliaryShapeDiagnostic[]=[];
  const visit=(value:unknown,schema:z.ZodType,path:(string|number)[],allowUnwrap=true):unknown=>{
    if(schema.safeParse(value).success)return value;
    if(schema instanceof z.ZodOptional||schema instanceof z.ZodDefault||schema instanceof z.ZodNullable||schema instanceof z.ZodCatch)return visit(value,schema.unwrap() as z.ZodType,path,allowUnwrap);
    if(schema instanceof z.ZodPipe)return visit(value,(schema.in instanceof z.ZodTransform ? schema.out : schema.in) as z.ZodType,path,allowUnwrap);
    const branches:readonly z.ZodType[]=schema instanceof z.ZodUnion ? schema.options as z.ZodType[] : [schema];
    const objects=branches.filter((branch):branch is z.ZodObject=>branch instanceof z.ZodObject);
    const emit=(rule:AuxiliaryShapeDiagnostic["rule"],before:unknown,after:unknown,at=path)=>diagnostics.push({...context,path:at,rule,beforeShape:shape(before),afterShape:shape(after)});
    if(allowUnwrap&&object(value)&&objects.length===branches.length&&Object.keys(value).length===1) {
      const key=Object.keys(value)[0]!;
      // Require an object-shaped expected branch. No primitive conversions,
      // aliases of declared fields, recursive unwraps or ambiguous unions.
      if(!objects.some(branch=>key in branch.shape)) {
        const inner=value[key];
        if(object(inner)&&branches.filter(branch=>branch.safeParse(inner).success).length===1){emit("single_key_wrapper",value,inner);return inner;}
      }
    }
    if(schema instanceof z.ZodDiscriminatedUnion&&object(value)) {
      const branch=objects.find(branch=>branch.shape[schema.def.discriminator]?.safeParse(value[schema.def.discriminator]).success);
      return branch ? visit(value,branch,path,false) : value;
    }
    if(schema instanceof z.ZodUnion) {
      const candidates=branches.map(branch=>{const start=diagnostics.length;const next=visit(value,branch,path,false);const changes=diagnostics.splice(start);return {next,changes,valid:next!==value&&branch.safeParse(next).success};}).filter(candidate=>candidate.valid);
      if(candidates.length===1){diagnostics.push(...candidates[0]!.changes);return candidates[0]!.next;}return value;
    }
    if(schema instanceof z.ZodArray&&Array.isArray(value)) {
      const next=value.map((child,index)=>visit(child,schema.element as z.ZodType,[...path,index]));
      return next.some((child,index)=>child!==value[index]) ? next : value;
    }
    if(!(schema instanceof z.ZodObject)||!object(value))return value;
    let next=value;
    for(const alias of aliases.filter(alias=>alias.path.length===path.length&&alias.path.every((key,i)=>key===path[i]))) {
      const target=schema.shape[alias.to] as z.ZodType|undefined;
      if(target&&!(alias.from in schema.shape)&&alias.from in next&&!(alias.to in next)&&!target.safeParse(next[alias.to]).success&&target.safeParse(next[alias.from]).success) {
        const before=next;next={...next,[alias.to]:next[alias.from]};delete next[alias.from];emit("declared_alias",before,next,[...path,alias.to]);
      }
    }
    for(const [key,child] of Object.entries(schema.shape) as [string,z.ZodType][])if(key in next) {
      const normalized=visit(next[key],child,[...path,key]);
      if(normalized!==next[key])next={...next,[key]:normalized};
    }
    return next;
  };
  return {value:visit(value,schema,[]),diagnostics};
}
