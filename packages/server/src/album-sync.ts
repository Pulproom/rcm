import { collectAlbumUpdateCandidates, albumPairFromPeople, type AlbumDocument, type AlbumUpdateCandidates } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";
import { collectAlbumMaterials } from "./album-materials.js";

export function albumUpdateCandidates(db: RcmDatabase, document: AlbumDocument): AlbumUpdateCandidates {
  return albumUpdateSnapshot(db, document).candidates;
}

export function albumUpdateSnapshot(db: RcmDatabase, document: AlbumDocument) {
  return db.transaction(() => {
    const chatId = document.source.chatId;
    if (!chatId || !document.source.sourceAvailable || !db.prepare("SELECT 1 FROM chats WHERE id=?").get(chatId)) return { candidates: { available: false, added: [], changed: [], removed: [] } satisfies AlbumUpdateCandidates };
    const materials = collectAlbumMaterials(db, chatId, { preferTranslation: true, pair: albumPairFromPeople(document.people) });
    const result = collectAlbumUpdateCandidates(document, materials);
    // Update only the user's chosen kinds, including hidden blocks and the default-off intimacy choice.
    const kinds = new Set(document.blocks.map(block => block.kind));
    return { materials, candidates: { ...result, added: result.added.filter(c => kinds.has(c.blockKind)), changed: result.changed.filter(c => kinds.has(c.blockKind)), removed: result.removed.filter(c => kinds.has(c.blockKind)) } };
  })();
}
