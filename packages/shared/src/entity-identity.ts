/** Structural identity matching over explicit entity declarations only. */
export const normalizeEntityName = (value:string):string => value.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase();
export interface ResolvedEntityIdentity { canonical:string; variants:string[]; ambiguous:boolean; known?:boolean }
export function createEntityIdentityResolver(entities:readonly {id:string;name:string;terms:readonly string[]}[]):(value:string)=>ResolvedEntityIdentity {
  const byValue=new Map<string,typeof entities[number][]>();
  for(const entity of entities) for(const term of entity.terms) {
    const key=normalizeEntityName(term), matches=byValue.get(key) ?? [];
    if(!matches.some(item=>item.id===entity.id))matches.push(entity);
    byValue.set(key,matches);
  }
  return value=>{
    const matches=byValue.get(normalizeEntityName(value)) ?? [];
    if(matches.length!==1)return {canonical:value,variants:[value],ambiguous:matches.length>1,known:false};
    const entity=matches[0]!;
    return {canonical:entity.name,variants:entity.terms.filter(term=>byValue.get(normalizeEntityName(term))?.length===1),ambiguous:false,known:true};
  };
}
