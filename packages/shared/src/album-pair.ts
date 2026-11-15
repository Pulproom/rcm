import { z } from "zod";

export const AlbumPairSchema = z.object({ me: z.string().max(20_000), partner: z.string().max(20_000) }).refine(p => p.me !== p.partner);
export type AlbumPair = z.infer<typeof AlbumPairSchema>;
export interface AlbumPairCandidate extends AlbumPair { sharedSceneCount: number; relationshipEventCount: number; hasPersona: boolean }
/** Stored entity names only: no alias, case, whitespace or prose inference. */
export const albumPairKey = (pair: AlbumPair): string => JSON.stringify([pair.me, pair.partner].sort());
export const albumPairFromPeople = (people: { me: { name: string }; partner: { name: string } }): AlbumPair => ({ me: people.me.name, partner: people.partner.name });
export const albumPairPresent = (participants: readonly string[], pair: AlbumPair): boolean => participants.includes(pair.me) && participants.includes(pair.partner);
