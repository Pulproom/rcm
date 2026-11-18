import { mapEntityPersonFields } from "./entity-person-fields.js";
import { createEntityIdentityResolver, normalizeEntityName } from './entity-identity.js';
import { expandItemEvidenceWritingFormat } from './state-writing-format.js';
import { resolveModelSourceReferences, type SourceUnit } from './source-references.js';
import { z } from 'zod';
import { ITEM_ACCESS_BASIS_VALUES } from './structured-contract-values.js';

// Evidence selectors are resolved and verified by the existing source pipeline.
export const MomentToReturnSchema = z.object({
  memoryKey:z.string().trim().min(1), detailKey:z.string().trim().min(1).optional(), text:z.string().trim().min(1),
  epistemic:z.enum(['observed','stated','inferred']),
  access:z.array(z.object({holder:z.string().trim().min(1),basis:z.enum(ITEM_ACCESS_BASIS_VALUES),confidence:z.number().min(0).max(1).default(1),evidence:z.array(z.unknown()).min(1)})),
  evidence:z.array(z.unknown()).min(1),
});

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Product-owned E1d/E1e/E1f wire syntax. No prose interpretation or knowledge from presence. */
export function expandEventWritingFormat(input: unknown, canonicalExisting: (name: string) => string = name => name,
  diagnostic: (message: string) => void = message => console.warn(`[RCM] event-writing: ${message}`), sourceUnits?: SourceUnit[], contract: 'e1d' | 'e1e' | 'e1f' = 'e1d'): unknown {
  const result = structuredClone(input);
  if (!record(result)) return result;
  const fill = (item: Record<string, any>, field: string, value: unknown): void => {
    if (item[field] === undefined) { item[field] = value; diagnostic(`missing ${field} defaulted`); }
  };
  for (const field of ['sourcePassages','unfinishedSource','skippedSource','memoryRecallObservations','atomRelations','entities']) fill(result, field, []);
  expandItemEvidenceWritingFormat(result, sourceUnits, diagnostic);
  const entities = Array.isArray(result.entities) ? result.entities.filter(record).filter(entity => typeof entity.name === 'string') : [];
  const incoming = createEntityIdentityResolver(entities.map(entity => ({ id: entity.key, name: entity.name,
    terms: [entity.key, entity.name, ...(Array.isArray(entity.aliases) ? entity.aliases : [])] })));
  const canonical = (name: string): string => {
    const identity = incoming(name);
    const resolved = canonicalExisting(identity.ambiguous ? name : identity.canonical);
    if (resolved !== name) diagnostic('declared entity alias canonicalized');
    return resolved;
  };
  // Access identity is established before the optional seed subset check.
  mapEntityPersonFields(result,canonical);
  if (contract === 'e1e' || contract === 'e1f') {
    if (result.momentsToReturn !== undefined && !Array.isArray(result.momentsToReturn)) diagnostic('momentsToReturn: invalid list ignored');
    const memories = Array.isArray(result.memories) ? result.memories.filter(record) : [];
    const witnessKinds: Record<string, string> = { saw_or_heard_it: 'witness', told_later: 'heard', worked_it_out: 'inferred' };
    for (const memory of memories) for (const witness of Array.isArray(memory.witnesses) ? memory.witnesses.filter(record) : []) {
      witness.kind = witnessKinds[witness.kind] ?? witness.kind;
    }
    for (const [index, moment] of (Array.isArray(result.momentsToReturn) ? result.momentsToReturn : []).entries()) {
      if (contract === 'e1f' && record(moment)) {
        if (!['wish','taste','attachment','curiosity','feeling'].includes(moment.reveals)) diagnostic(`momentsToReturn[${index}]: missing or invalid reveals ignored`);
        delete moment.reveals;
      }
      const reject = (reason: string) => diagnostic(`momentsToReturn[${index}]: ${reason}`);
      if (!MomentToReturnSchema.safeParse(moment).success || !record(moment)) {
        reject('invalid moment dropped'); continue;
      }
      if (sourceUnits) {
        try {
          const resolved = resolveModelSourceReferences({evidence:moment.evidence,access:moment.access},sourceUnits) as Record<string, any>;
          const allowed = new Set(sourceUnits.map(unit => unit.messageId));
          const citations = [...resolved.evidence,...resolved.access.flatMap((grant: Record<string, any>) => grant.evidence)];
          if (citations.some(citation => !allowed.has(citation.messageId))) throw new Error('unavailable citation');
        } catch { reject('unverified source evidence; moment dropped'); continue; }
      }
      const matches = memories.filter(memory => memory.key === moment.memoryKey);
      if (matches.length !== 1) { reject('unknown or ambiguous memoryKey'); continue; }
      const memory = matches[0]!;
      if (!Array.isArray(memory.details)) memory.details = [];
      let detail: Record<string, any> | undefined;
      if (moment.detailKey !== undefined) {
        const targets = memory.details.filter((item: unknown) => record(item) && item.key === moment.detailKey);
        if (targets.length !== 1) { reject('unknown or ambiguous detailKey'); continue; }
        detail = targets[0];
      } else {
        // The moment list is consumed below. Re-expanding the resulting draft is a no-op.
        const base = `moment:${index + 1}`;
        let key = base, suffix = 2;
        while (memory.details.some((item: unknown) => record(item) && item.key === key)) key = `${base}#${suffix++}`;
        detail = { key, kind: 'concrete_detail', text: moment.text, epistemic: moment.epistemic,
          access: structuredClone(moment.access), hiddenFrom: [], evidence: structuredClone(moment.evidence) };
        memory.details.push(detail);
      }
      const holders = [...new Set<string>(moment.access.filter(record).filter((grant: Record<string, any>) => typeof grant.holder === 'string').map((grant: Record<string, any>) => grant.holder))];
      const allowed = new Set((Array.isArray(detail!.access) ? detail!.access : []).filter(record).filter((grant: Record<string, any>) => typeof grant.holder === 'string').map((grant: Record<string, any>) => normalizeEntityName(grant.holder)));
      if (!holders.length) { reject('empty access; fact retained without seed'); continue; }
      if (holders.some(holder => !allowed.has(normalizeEntityName(holder)))) { reject('access outside linked detail; fact retained without seed'); continue; }
      const seed = { status: 'open', noticedBy: holders };
      if (detail!.seed && JSON.stringify(detail!.seed) !== JSON.stringify(seed)) { reject('occupied seed slot retained'); continue; }
      detail!.seed = seed;
    }
    delete result.momentsToReturn;
  }
  for (const memory of Array.isArray(result.memories) ? result.memories.filter(record) : []) {
    fill(memory, 'retention', 'arc');
    fill(memory, 'salience', .5);
    if (memory.retention === 'scene' && memory.type !== 'episode') {
      memory.retention = 'arc'; diagnostic('non-episode scene retention normalized to arc');
    }
    // Old-habit knownBy is accepted but never owns the scene roster.
    const participants = Array.isArray(memory.participants) ? memory.participants : [];
    const witnesses = Array.isArray(memory.witnesses) ? memory.witnesses.filter(record).filter(w => w.kind === 'witness').map(w => w.name) : [];
    memory.knownBy = [...new Set([...participants, ...witnesses].filter((name): name is string => typeof name === 'string').map(canonical))];
    for (const detail of Array.isArray(memory.details) ? memory.details.filter(record) : []) {
      fill(detail, 'retention', memory.retention);
      fill(detail, 'salience', .5);
      detail.role = 'supporting';
      if (detail.knownBy === undefined && Array.isArray(detail.access)) detail.knownBy = [...new Set(detail.access.filter(record).map((grant: Record<string, any>) => grant.holder))];
      else if (Array.isArray(detail.knownBy)) detail.knownBy = [...new Set(detail.knownBy.map(name => typeof name === 'string' ? canonical(name) : name))];
      if (detail.seed === null) delete detail.seed;
      if ((contract === 'e1e' || contract === 'e1f') && record(detail.seed)) delete detail.seed.type;
      if (record(detail.seed) && detail.seed.status === undefined) detail.seed.status = 'open';
      if (record(detail.seed) && Array.isArray(detail.seed.noticedBy)) {
        const holders = new Set(Array.isArray(detail.access) ? detail.access.filter(record).filter((grant: Record<string, any>) => typeof grant.holder === 'string').map((grant: Record<string, any>) => normalizeEntityName(grant.holder)) : []);
        detail.seed.noticedBy = [...new Set(detail.seed.noticedBy.map(name => typeof name === 'string' ? canonical(name) : name))]
          .filter(name => {
            if (typeof name === 'string' && holders.has(normalizeEntityName(name))) return true;
            diagnostic('seed noticedBy outside detail access dropped'); return false;
          });
        if (!detail.seed.noticedBy.length) { delete detail.seed; diagnostic('seed with empty noticedBy dropped'); }
      }
      if (contract === 'e1d' && Array.isArray(detail.hiddenFrom) && detail.hiddenFrom.length > 16) {
        detail.hiddenFrom = detail.hiddenFrom.slice(0, 16);
        diagnostic('hiddenFrom clipped to 16 names');
      }
    }
  }
  return result;
}
