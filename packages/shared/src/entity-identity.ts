/** Structural identity matching over explicit entity declarations only. */
// Product-owned categories from the former free-type contract, not story-word heuristics.
export const PLACE_OBJECT_ENTITY_TYPES = ["place", "location", "object", "item", "thing", "장소", "사물", "물건"] as const;
export const ORGANIZATION_ENTITY_TYPES = ["organization", "group", "faction", "guild", "단체", "조직"] as const;
const placeObjectTypes: ReadonlySet<string> = new Set(PLACE_OBJECT_ENTITY_TYPES);
const organizationTypes: ReadonlySet<string> = new Set(ORGANIZATION_ENTITY_TYPES);
export function classifyEntityType(type: string): "place_object" | "organization" | "being" {
  const normalized = type.trim().toLowerCase();
  return placeObjectTypes.has(normalized) ? "place_object" : organizationTypes.has(normalized) ? "organization" : "being";
}
export const isPersonEntityType = (type: string): boolean => classifyEntityType(type) === "being";
/** Setup prominence owns starring status; the person type never encodes a role. */
export const isMainCharacterEntity = (entity: { type: string; setupProminence?: string }): boolean =>
  isPersonEntityType(entity.type) && entity.setupProminence === "primary";
export const normalizeEntityName = (value:string):string => value.normalize("NFKC").trim().replace(/\s+/g," ").toLocaleLowerCase();
export interface ModelIdentityEntity {type:string;name:string;id?:string;key?:string;displayName?:string;internalName?:string;aliases?:readonly string[]}
/** Canonical person use or explicit user/setup authority rescues a free type.
 * This is a read projection; only an explicit person edit changes the stored type. */
export function effectiveEntityType(entity:{type:string;origin?:string;userManaged?:boolean}, canonicalPersonUse=false):string {
  return classifyEntityType(entity.type)==='place_object' && (canonicalPersonUse||entity.userManaged||entity.origin==='setup'||entity.origin==='manual')
    ? 'character' : entity.type;
}
/** Identity suggestions only; prose and world-state subjects are not filtered.
 * A shared alias can still denote an allowed being/group, and unknown names stay. */
export function modelEntityIdentityContext<T extends ModelIdentityEntity>(input:readonly T[], identityEntities:readonly ModelIdentityEntity[]=[]) {
  const identifiers=(entity:ModelIdentityEntity)=>[entity.id,entity.key,entity.name,entity.displayName,entity.internalName,...(entity.aliases ?? [])]
    .filter((name):name is string=>typeof name==='string');
  const byTerm=new Map<string,ModelIdentityEntity[]>();
  for(const entity of identityEntities)for(const term of new Set(identifiers(entity).map(normalizeEntityName))) {
    const matches=byTerm.get(term) ?? [];matches.push(entity);byTerm.set(term,matches);
  }
  // Lease-supplied effective DB types outrank stale draft type words. Never
  // mutate the frozen draft, and do not guess when an identifier is ambiguous.
  const stored=input.map(entity=>{
    const match=identifiers(entity).map(term=>byTerm.get(normalizeEntityName(term))).find(matches=>matches?.length===1)?.[0];
    return match ? {...entity,type:match.type} : entity;
  });
  const policy=[...identityEntities,...stored];
  const terms=(rows:readonly ModelIdentityEntity[])=>new Set(rows.flatMap(identifiers).map(normalizeEntityName));
  const allowed=terms(policy.filter(entity=>classifyEntityType(entity.type)!=='place_object')),excluded=terms(policy.filter(entity=>classifyEntityType(entity.type)==='place_object'));
  const dbAllowed=terms(identityEntities.filter(entity=>classifyEntityType(entity.type)!=='place_object')),
    dbExcluded=terms(identityEntities.filter(entity=>classifyEntityType(entity.type)==='place_object'));
  const allowsName=(name:string)=>{
    if(typeof name!=='string')return true;
    const term=normalizeEntityName(name);
    // A draft alias must not grant personhood to a DB-only place. An alias
    // actually shared with a protected DB identity remains usable.
    return dbExcluded.has(term) ? dbAllowed.has(term) : !excluded.has(term)||allowed.has(term);
  };
  const entities=stored.filter(entity=>classifyEntityType(entity.type)!=='place_object'&&allowsName(entity.name)&&(!entity.key||allowsName(entity.key)))
    .map(entity=>entity.aliases ? {...entity,aliases:entity.aliases.filter(allowsName)} : entity);
  return {entities,allowsName};
}
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
