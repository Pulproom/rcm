import { createEntityIdentityResolver, normalizeEntityName } from "./entity-identity.js";
import { STATE_PERSON_WRITING_FIELDS } from "./entity-person-fields.js";
import { parseStructuredModelJson } from "./structured-json.js";
import type { ReconciliationResult } from "./index.js";
import type { SourceUnit } from "./source-references.js";

export type StateWritingContext = {
  stateContract?: "r10" | "r11";
  eventDraft?: {entities?:Array<{key?:string;name:string;aliases?:string[]}>;memories:Array<{key:string;participants?:string[];witnesses?:Array<{name:string}>;details?:Array<{key:string}>}>};
  recognition?:Array<{holder:string;subject:string;knownAs?:string[]}>;
  priorLedger: Array<{ id: string; kind: string; value: Record<string, unknown> }>;
};
/** Resolve only explicit identities in the input pool, never narrative text. */
export function stateWritingIdentity(context:StateWritingContext) {
  const entities=new Map<string,{id:string;name:string;terms:string[]}>();
  const add=(name:unknown,terms:string[]=[])=>{
    if(typeof name!=='string'||!name.trim())return;
    const id=normalizeEntityName(name),existing=entities.get(id);
    entities.set(id,{id,name:existing?.name ?? name,terms:[...(existing?.terms ?? []),name,...terms]});
  };
  for(const e of context.eventDraft?.entities ?? [])add(e.name,[...(e.aliases ?? []),...(e.key ? [e.key]:[])]);
  for(const m of context.eventDraft?.memories ?? [])for(const name of [...(m.participants ?? []),...(m.witnesses ?? []).map(w=>w.name)])add(name);
  for(const {value} of context.priorLedger)for(const field of ['subject','holder','promisor','promisee'])add(value[field]);
  for(const r of context.recognition ?? []){add(r.holder);add(r.subject,r.knownAs);}
  return createEntityIdentityResolver([...entities.values()]);
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export type StateSupportRef = { memoryKey: string; detailKey: string };
/** Explicit support takes precedence; old in-flight R10 links remain readable. */
export function stateDetailSupport(item: {support?: StateSupportRef[]; memoryKey?: string; detailKeys?: string[]}): StateSupportRef[] | undefined {
  return item.support ?? (item.detailKeys === undefined ? undefined : item.detailKeys.map(detailKey => ({memoryKey:item.memoryKey ?? '',detailKey})));
}
export const isNarrowState = (item: {kind:string;stateKind?:string}): boolean =>
  item.kind==='character_belief' || item.kind==='world_fact' && (item.stateKind==='secret' || item.stateKind==='goal');
function promiseLifecycleReason(status: unknown, event: unknown): string | undefined {
  if (status === "invalidated") return "Supplied promise is invalidated; use current-source content in a new commitment";
  if (["kept", "broken", "released"].includes(String(status)) && ["established", "reinforced"].includes(String(event))) return "Supplied promise is closed and cannot be reopened";
}

/** Decisions retain the supplied row identity after promiseId is expanded.
 * Recheck at every validation boundary, including repairs and cached pages. */
export function statePromiseLifecycleIssues(raw: unknown, context?: StateWritingContext): Array<{ path: (string | number)[]; point: string; message: string }> {
  if (!record(raw) || !record(raw.state) || !Array.isArray(raw.state.stateObservations) || !Array.isArray(raw.decisions)) return [];
  const decisions = raw.decisions.filter(record);
  return raw.state.stateObservations.flatMap((item, index) => {
    if (!record(item) || item.kind !== "promise_event") return [];
    const targets = decisions.filter(decision => decision.itemRef === `observation:${item.key}`).flatMap(decision => Array.isArray(decision.targetIds) ? decision.targetIds : []);
    if (typeof item.promiseId === "string") targets.push(item.promiseId);
    const reasons = (context?.priorLedger ?? []).filter(row => row.kind === "promise_event" && targets.includes(row.id))
      .map(row => promiseLifecycleReason(row.value.status, item.event)).filter((reason): reason is string => reason !== undefined);
    return reasons.length ? [{ path: ["state", "stateObservations", index], point: "state_writing:promise_lifecycle", message: [...new Set(reasons)].join("; ") }] : [];
  });
}
/** Used before raw-response diagnostics too: working notes are never persisted. */
export function stripStatePersonNotes(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.map(stripStatePersonNotes);
  if (!record(raw)) return raw;
  return Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "personNotes" && key !== "notes").map(([key, value]) => [key, stripStatePersonNotes(value)]));
}
export function sanitizeStateResponseForStaging(output: string): string | undefined {
  try { return JSON.stringify(stripStatePersonNotes(parseStructuredModelJson(output).value)); }
  catch { return undefined; } // Unsafe/truncated state text has metadata-only diagnostics.
}
export function stateWritingContext(userPrompt: string): StateWritingContext {
  try {
    const input: unknown = JSON.parse(userPrompt);
    if (!record(input)) return {priorLedger:[]};
    const stateContract = input.stateContract === "r10" || input.stateContract === "r11" ? input.stateContract : undefined;
    const priorLedger: StateWritingContext["priorLedger"] = [];
    for (const row of Array.isArray(input.priorLedger) ? input.priorLedger : []) {
      if (!record(row) || typeof row.id !== 'string' || typeof row.kind !== 'string') continue;
      const value = stateContract === 'r11' ? {...row, [STATE_PERSON_WRITING_FIELDS.believer.canonical]:row[STATE_PERSON_WRITING_FIELDS.believer.authored], promise_key:row.promiseKey, retention_scope:row.scope, scheduled_for:row.scheduledFor} : row.value;
      if (record(value)) priorLedger.push({id:row.id,kind:row.kind,value});
    }
    return {...(stateContract ? {stateContract} : {}), ...(Array.isArray(input.recognition) ? {recognition:input.recognition as NonNullable<StateWritingContext["recognition"]>} : {}), ...(record(input.eventDraft) && Array.isArray(input.eventDraft.memories) ? {eventDraft:input.eventDraft as StateWritingContext["eventDraft"]} : {}), priorLedger};
  } catch { return { priorLedger: [] }; }
}

/** Expands product-owned JSON fields only. No prose inference or source lookup.
 * Invalid values remain available to the existing validators and item isolation. */
export function expandStateWritingFormat(raw: unknown, context?: StateWritingContext, sourceUnits?: SourceUnit[], diagnostic:(message:string)=>void=message=>console.warn(`[RCM] ${message}`)): unknown {
  if (!record(raw)) return raw;
  const result = stripStatePersonNotes(raw) as Record<string, unknown>;
  const state = record(result.state) ? result.state : result;
  const items = (name: string): Record<string, unknown>[] => Array.isArray(state[name]) ? state[name].filter(record) : [];
  const decisions: unknown[] = [];
  const observations = items("stateObservations");
  if(context?.stateContract==='r11') {
    const {authored,canonical}=STATE_PERSON_WRITING_FIELDS.believer;
    for(const item of observations)if(item.kind==='character_belief' && item[authored]!==undefined){item[canonical]=item[authored];delete item[authored];}
  }
  const keys = new Set(observations.map(o => o.key));
  observations.forEach((item, index) => {
    // R10's empty narrow support is owned syntax for owner-only knowledge.
    if (isNarrowState(item as {kind:string;stateKind?:string}) && Array.isArray(item.support) && !item.support.length) delete item.support;
    const hadKey = item.key !== undefined;
    if (!hadKey) {
      let n = index + 1;
      while (keys.has(`o${n}`)) n++;
      item.key = `o${n}`;
      keys.add(item.key);
    }
    const decision = (action: unknown, targetIds: unknown) => decisions.push({
      itemRef: `observation:${item.key}`, action, targetIds,
      ...("compatibleWithIds" in item ? { compatibleWithIds: item.compatibleWithIds } : {}),
      ...("reason" in item ? { reason: item.reason } : {}),
    });
    if (item.kind === "promise_event" && "promiseId" in item) {
      const matches = context?.priorLedger.filter(row => row.id === item.promiseId) ?? [];
      const row = matches.length === 1 && matches[0]!.kind === "promise_event" ? matches[0] : undefined;
      const value = row?.value;
      // Even a mixed-shape input cannot supply its own replacement for an
      // unavailable/invalidated/closed ledger occurrence.
      for (const field of ["promiseKeyHint", "promisor", "promisee", "content"]) delete item[field];
      if (value && !promiseLifecycleReason(value.status, item.event)) {
        Object.assign(item, { promiseKeyHint: value.promise_key, promisor: value.promisor, promisee: value.promisee, content: value.content });
        if (item.scope === undefined && ["future", "recurring"].includes(String(value.retention_scope))) item.scope = value.retention_scope;
        decision("reinforce", [item.promiseId]);
        delete item.promiseId;
      }
    } else if (item.kind === "promise_event" && !hadKey) {
      decision(item.action ?? "create", item.targetIds ?? []);
    } else if (["world_fact", "character_belief"].includes(String(item.kind)) && item.action !== undefined) {
      decision(item.action, item.targetIds ?? []);
    }
    for (const field of ["action", "targetIds", "compatibleWithIds", "reason"]) delete item[field];
  });
  if (decisions.length) result.decisions = Array.isArray(result.decisions) ? [...result.decisions, ...decisions] : result.decisions === undefined ? decisions : result.decisions;
  else if (result.decisions === undefined && ("state" in result || "stateObservations" in state || "socialKnowledge" in state)) result.decisions = [];

  if (Array.isArray(state.detailAdditions)) state.detailAdditions = state.detailAdditions.map(item => {
    if (!record(item) || "detail" in item || !("key" in item)) return item;
    const { memoryKey, ...detail } = item;
    return { memoryKey, detail };
  });
  // Reserve keys already authored anywhere for the same parent memory.
  const used = new Map<unknown, Set<unknown>>();
  const reserve = (memoryKey: unknown, key: unknown) => {
    if (!used.has(memoryKey)) used.set(memoryKey, new Set());
    used.get(memoryKey)!.add(key);
  };
  if(context?.stateContract==='r11')for(const memory of context.eventDraft?.memories ?? [])for(const detail of memory.details ?? [])reserve(memory.key,detail.key);
  items("detailAdditions").forEach(item => { if (record(item.detail)) reserve(item.memoryKey, item.detail.key); });
  items("memories").forEach(memory => { if (Array.isArray(memory.details)) memory.details.filter(record).forEach(detail => reserve(memory.key, detail.key)); });
  if(context?.stateContract==='r11') {
    const identity=stateWritingIdentity(context);
    const seeds=Array.isArray(result.seedResolutions) ? result.seedResolutions.filter(record) : [];
    for(const [index,item] of [...observations,...seeds].entries()) {
      if(!Array.isArray(item.support))continue;
      if(item.support.length>1)diagnostic(`R11:multiple_support item ${item.key ?? item.detailId} retains ${item.support.length} references`);
      item.support=item.support.map((support:unknown)=>{
        if(!record(support)||support.detailKey!==undefined||typeof support.text!=='string')return support;
        const base=`state-support:${item.key ?? `seed:${item.detailId ?? index}`}`;
        let key=base,n=2;
        while(used.get(support.memoryKey)?.has(key))key=`${base}#${n++}`;
        reserve(support.memoryKey,key);
        for(const grant of Array.isArray(support.knownBy) ? support.knownBy : [])if(record(grant)&&typeof grant[STATE_PERSON_WRITING_FIELDS.knower.authored]==='string') {
          const name=grant[STATE_PERSON_WRITING_FIELDS.knower.authored] as string;
          const resolved=identity(name);
          if(!resolved.known||resolved.ambiguous)diagnostic(`R11:inline_name item ${item.key ?? item.detailId} has an unresolved or ambiguous knower ${JSON.stringify(name)}; kept`);
        }
        const owners=item.kind==='character_belief' ? [item.holder,item.subject] : item.kind==='promise_event' ? [item.promisor,item.promisee] : item.kind==='world_fact' ? [item.subject] : [];
        const detail={text:support.text,key,kind:'character_state',role:'core',epistemic:'observed',salience:.5,retention:item.retention ?? 'arc',
          participants:[...new Set(owners.filter(name=>typeof name==='string'))],locations:[],knownBy:support.knownBy,evidence:support.evidence,confidence:item.confidence};
        if(state.detailAdditions===undefined)state.detailAdditions=[];
        if(Array.isArray(state.detailAdditions))state.detailAdditions.push({memoryKey:support.memoryKey,detail});
        return {memoryKey:support.memoryKey,detailKey:key};
      });
    }
  }
  for(const item of observations) {
    if (item.kind === 'world_fact' && record(item.socialRelation) && item.support === undefined && item.memoryKey === undefined && item.detailKeys === undefined) {
      for (const field of ['support','memoryKey','detailKeys']) if (item.socialRelation[field] !== undefined) item[field] = structuredClone(item.socialRelation[field]);
    }
    if (item.kind === "world_fact" && record(item.socialRelation) && Array.isArray(item.support) && item.support.length && item.support.every(ref => record(ref) && typeof ref.memoryKey === 'string' && typeof ref.detailKey === 'string')) {
      const refs = item.support as StateSupportRef[];
      if (item.socialRelation.memoryKey === undefined && item.socialRelation.detailKeys === undefined && item.socialRelation.support === undefined) {
        item.socialRelation.support = structuredClone(refs);
        item.socialRelation.memoryKey = refs[0]!.memoryKey;
        item.socialRelation.detailKeys = refs.filter(ref => ref.memoryKey === refs[0]!.memoryKey).map(ref => ref.detailKey);
      }
    }
    if (item.kind === "world_fact" && record(item.socialRelation) && item.memoryKey !== undefined && item.detailKeys !== undefined) {
      if (item.socialRelation.memoryKey === undefined) item.socialRelation.memoryKey = item.memoryKey;
      if (item.socialRelation.detailKeys === undefined) item.socialRelation.detailKeys = structuredClone(item.detailKeys);
    }
  }
  for (const social of items("socialKnowledge")) {
    if (!record(social.description)) continue; // malformed descriptions stay invalid, never invented
    const base = `recognition:${JSON.stringify([social.holder, social.subject])}`;
    let key = base, n = 2;
    while (used.get(social.memoryKey)?.has(key)) key = `${base}#${n++}`;
    reserve(social.memoryKey, key);
    const description = social.description;
    const detail = { ...description, key, kind: "character_state",
      ...(description.participants === undefined ? { participants: [social.holder, social.subject] } : {}),
      ...(description.evidence === undefined ? { evidence: social.evidence } : {}) };
    if (state.detailAdditions === undefined) state.detailAdditions = [];
    if (Array.isArray(state.detailAdditions)) state.detailAdditions.push({ memoryKey: social.memoryKey, detail });
    social.cognitionDetailKeys = Array.isArray(social.cognitionDetailKeys) ? [...social.cognitionDetailKeys, key] : social.cognitionDetailKeys === undefined ? [key] : social.cognitionDetailKeys;
    delete social.description;
  }
  for (const baseline of items("relationshipBaselines")) if (baseline.source === undefined) baseline.source = "transcript";

  if(context?.stateContract==='r11') {
    const expandKnowers=(value:unknown):void=>{
      if(Array.isArray(value)){value.forEach(expandKnowers);return;}
      if(!record(value))return;
      if(Array.isArray(value.knownBy)&&value.knownBy.some(record)) {
        const {authored,canonical}=STATE_PERSON_WRITING_FIELDS.knower;
        value.access=value.knownBy.map(grant=>record(grant) ? {[canonical]:grant[authored],basis:grant.basis,confidence:grant.confidence ?? value.confidence ?? 1,...(grant.evidence===undefined ? {} : {evidence:grant.evidence})} : grant);
        delete value.knownBy;
      }
      // An empty explicit knower list is narrator-only, including inline support.
      else if(Array.isArray(value.knownBy)&&!value.knownBy.length&&value.access===undefined&&('epistemic' in value||'act' in value))value.access=[];
      Object.values(value).forEach(expandKnowers);
    };
    expandKnowers(result);
  }
  expandItemEvidenceWritingFormat(result, sourceUnits);
  const details = [...items("detailAdditions").map(item => item.detail), ...items("memories").flatMap(memory => Array.isArray(memory.details) ? memory.details : [])];
  for (const detail of details) if (record(detail) && detail.knownBy === undefined && Array.isArray(detail.access)) {
    detail.knownBy = [...new Set(detail.access.filter(record).map(grant => grant.holder))];
  }
  return result;
}

/** Shared wire expansion for event and state outputs, before source resolution. */
export function expandItemEvidenceWritingFormat(raw: unknown, sourceUnits?: SourceUnit[], diagnostic: (message: string) => void = message => console.warn(`[RCM] writing-format: ${message}`)): void {
  const sources = new Map(sourceUnits?.map(unit => [unit.ref, unit]));
  const expandRange = (ref: string): string[] => {
    const range = /^s(\d+)-s(\d+)$/.exec(ref);
    if (!range || !sourceUnits) return [ref];
    const start = Number(range[1]), end = Number(range[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end - start + 1 > sourceUnits.length) return [ref];
    const selected: SourceUnit[] = [];
    for (let index = start; index <= end; index++) {
      const unit = sources.get(`s${index}`), previous = selected.at(-1);
      // Do not turn a missing/cross-message/cross-revision range into valid
      // standalone refs. Leave it for the unchanged selector to reject.
      if (!unit || previous && (unit.messageId !== previous.messageId || unit.canonicalHash !== previous.canonicalHash || unit.start <= previous.start)) return [ref];
      selected.push(unit);
    }
    return selected.map(unit => unit.ref);
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!record(value)) return;
    if (typeof value.evidence === "string") value.evidence = [value.evidence];
    if (Array.isArray(value.evidence)) {
      const refs = [...new Set(value.evidence.filter((item): item is string => typeof item === "string").flatMap(expandRange))];
      // Gathered strings are a citation set. The existing selector needs them
      // in source order; preserve invalid spellings for its normal rejection.
      refs.sort((left, right) => {
        const a = /^s(\d+)(?:-s\d+)?$/.exec(left), b = /^s(\d+)(?:-s\d+)?$/.exec(right);
        if (!a) return b ? 1 : 0;
        if (!b) return -1;
        return Number(a[1]) - Number(b[1]);
      });
      if (refs.length) value.evidence = [{ sourceRef: refs }, ...value.evidence.filter(item => typeof item !== "string")];
    }
    if (Array.isArray(value.access)) for (const grant of value.access) {
      if (!record(grant)) continue;
      // Product-owned enum alias, never an inference about narrative prose.
      if (grant.basis === "observed") { grant.basis = "witnessed"; diagnostic("access.basis observed normalized to witnessed"); }
      if (grant.evidence === undefined) {
        if (value.evidence !== undefined) grant.evidence = structuredClone(value.evidence);
        else if (value.sourceRef !== undefined) grant.evidence = [{ sourceRef: structuredClone(value.sourceRef), ...(value.quote === undefined ? {} : { quote: value.quote }) }];
      }
    }
    Object.values(value).forEach(walk);
  };
  walk(raw);
}

/** Validate owned link syntax/IDs only. Knowledge comes from canonical storage, never these prompt copies. */
export function stateDetailLinkIssues(result:ReconciliationResult, parents:Array<{key:string;details?:Array<{key:string}>}>): Array<{path:(string|number)[];point:string;message:string}> {
  const memories=(result.state?.memories ?? []).flatMap((memory,index)=>memory.key.startsWith('state_') ? [] : [{path:['state','memories',index],point:'R10:state_memory_key',message:'New state memory keys must start with state_'}]);
  return [...memories,...(result.state?.stateObservations ?? []).flatMap((item,index) => {
    const decision=result.decisions.find(decision=>decision.itemRef===`observation:${item.key}`);
    const required=item.kind==='promise_event' ? !decision?.targetIds.length : ['create','supersede','coexist','dispute'].includes(decision?.action ?? '');
    const refs=stateDetailSupport(item);
    if (!required && item.memoryKey===undefined && refs===undefined) return [];
    const issue=(message:string)=>({path:['state','stateObservations',index],point:'R10:detail_links',message});
    if (!refs?.length || refs.some(ref=>!parents.some(parent=>parent.key===ref.memoryKey && parent.details?.some(detail=>detail.key===ref.detailKey))))
      return isNarrowState(item) ? [] : [issue("Record requires nonempty support (or memoryKey/detailKeys) pointing to this result's details")];
    const identity=(refs:StateSupportRef[])=>JSON.stringify([...new Set(refs.map(ref=>JSON.stringify([ref.memoryKey,ref.detailKey])))].sort());
    if (item.kind==='world_fact' && item.socialRelation && identity(stateDetailSupport(item.socialRelation) ?? [])!==identity(refs))
      return [issue('Item and nested socialRelation links disagree')];
    return [];
  })];
}

/** R11 structural learning/payoff guards inspect expanded storage-shape access.
 * They return item issues for recovery/review; they never infer a change from prose. */
export function stateR11SupportIssues(result:ReconciliationResult,parents:Array<{key:string;details?:Array<{key:string;access?:Array<{holder:string}>}>}>,identity:(name:string)=>{canonical:string;ambiguous:boolean}) {
  const resolve=(ref:StateSupportRef)=>parents.find(parent=>parent.key===ref.memoryKey)?.details?.find(detail=>detail.key===ref.detailKey);
  const issues:Array<{path:(string|number)[];point:string;message:string}>=[];
  for(const [index,item] of (result.state?.stateObservations ?? []).entries()) {
    if(item.kind!=='character_belief')continue;
    const action=result.decisions.find(d=>d.itemRef===`observation:${item.key}`)?.action;
    if(action!=='end'&&action!=='supersede')continue;
    const refs=stateDetailSupport(item),believer=identity(item.holder);
    if(!refs?.length||believer.ambiguous||!refs.every(ref=>resolve(ref)?.access?.some(grant=>{
      const knower=identity(grant.holder);
      return !knower.ambiguous&&normalizeEntityName(knower.canonical)===normalizeEntityName(believer.canonical);
    })))issues.push({path:['state','stateObservations',index],point:'R11:belief_learning_support',message:'Belief ending/replacement withheld: support must resolve and include the believer in every detail knower set'});
  }
  for(const [index,item] of (result.seedResolutions ?? []).entries())if(!item.support?.length||!item.support.every(ref=>resolve(ref)))
    issues.push({path:['seedResolutions',index],point:'R11:seed_support',message:'Seed closure withheld: payoff support must resolve to a detail in this batch'});
  return issues;
}
