import { albumCoverQuote, albumLine, albumMaterialsSince, albumPairFromPeople, AlbumDocumentSchema, type AlbumDocument, type AlbumSummary } from "@rcm/shared";
import type { RcmDatabase } from "./db.js";

export function albumShelfFields(document: AlbumDocument) {
  const story = document.blocks.filter(b => b.kind === "story" && !b.hidden).flatMap(b => b.items);
  const quote = albumCoverQuote(document);
  return { theme: document.style.theme, tint: document.style.tint, names: [document.people.me.name, document.people.partner.name].filter(Boolean),
    sceneCount: story.reduce((n, item) => n + (item.origin?.kind === "chapter" || item.children?.some(c => c.fields.title !== undefined || c.fields.summary !== undefined) ? item.children?.length ?? 0 : 1), 0),
    chapterCount: story.filter(i => !i.hidden).length,
    promiseCount: document.blocks.filter(b => b.kind === "promises" && !b.hidden).flatMap(b => b.items).filter(i => !i.hidden).length,
    coverQuote: quote ? albumLine(quote) : "", ...(document.coverFocus ? { coverFocus: document.coverFocus } : {}),
    since: albumMaterialsSince(document), pair: albumPairFromPeople(document.people) } satisfies Partial<AlbumSummary> & { since: number; pair: { me: string; partner: string } };
}
export type AlbumShelfFields = ReturnType<typeof albumShelfFields>;

/** Migration/restore projection. The independent saved document remains untouched. */
export function refreshAlbumSummaries(db: RcmDatabase, all = false): void {
  const update = db.prepare("UPDATE albums SET summary_json=? WHERE id=?");
  for (const row of db.prepare(`SELECT id,document_json FROM albums${all ? "" : " WHERE summary_json IS NULL"}`).all() as Array<{ id: string; document_json: string }>) {
    update.run(JSON.stringify(albumShelfFields(AlbumDocumentSchema.parse(JSON.parse(row.document_json)))), row.id);
  }
}
