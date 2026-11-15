import { ALBUM_DRAFT_ORDER, applyAlbumUpdate, resolveAlbumTint, resolveLayout, type Candidate, type AlbumBlock, type AlbumBlockKind, type AlbumDocument, type AlbumItem } from "@rcm/shared";

export const albumItems = (items: AlbumItem[]): AlbumItem[] => items.flatMap(i => [i, ...albumItems(i.children ?? [])]);
/** Storage deletion removes every placement, including hidden items and copied cover lines. */
export function removeAlbumPhotoReferences(doc: AlbumDocument, id: string): AlbumDocument {
  const copy = structuredClone(doc);
  if (copy.coverPhotoId === id) { delete copy.coverPhotoId; delete copy.coverFocus; }
  for (const key of ["me", "partner"] as const) if (copy.people[key].photoId === id) delete copy.people[key].photoId;
  for (const i of albumItems([...copy.blocks.flatMap(b => b.items), ...(copy.coverLine ? [copy.coverLine] : [])])) i.photos = i.photos.filter(p => p.photoId !== id);
  return copy;
}
export function editField(doc: AlbumDocument, blockId: string, itemId: string, field: string, value: string, restored = false): AlbumDocument {
  const visit = (items: AlbumItem[]): AlbumItem[] => items.map(i => {
    if (i.id === itemId) {
      const edited = { ...i.edited }; if (restored) delete edited[field]; else edited[field] = true;
      const caption = /^photos\.(\d+)\.caption$/.exec(field);
      if (caption) return { ...i, photos: i.photos.map((p, n) => n === Number(caption[1]) ? { ...p, caption: value } : p), edited };
      return { ...i, fields: { ...i.fields, [field]: value }, edited };
    }
    return i.children ? { ...i, children: visit(i.children) } : i;
  });
  return { ...doc, blocks: doc.blocks.map(b => b.id === blockId ? { ...b, items: visit(b.items) } : b) };
}
export function moveBlock(doc: AlbumDocument, blockId: string, delta: number): AlbumDocument {
  const from = doc.blocks.findIndex(b => b.id === blockId); if (from < 0) return doc;
  const to = Math.max(0, Math.min(doc.blocks.length - 1, from + delta)); if (from === to) return doc;
  const blocks = [...doc.blocks]; blocks.splice(to, 0, blocks.splice(from, 1)[0]!); return { ...doc, blocks };
}
export const toggleBlockHidden = (doc: AlbumDocument, id: string): AlbumDocument => ({ ...doc, blocks: doc.blocks.map(b => b.id === id ? { ...b, hidden: !b.hidden } : b) });
export const removeBlock = (doc: AlbumDocument, id: string): AlbumDocument => ({ ...doc, blocks: doc.blocks.filter(b => b.id !== id) });
function newId(doc: AlbumDocument, prefix: string): string {
  const ids = new Set(doc.blocks.flatMap(b => [b.id, ...albumItems(b.items).map(i => i.id)]));
  let n = 1; while (ids.has(`${prefix}-${n}`)) n++; return `${prefix}-${n}`;
}
export function duplicateBlock(doc: AlbumDocument, id: string): AlbumDocument {
  const at = doc.blocks.findIndex(b => b.id === id); if (at < 0) return doc;
  const block = structuredClone(doc.blocks[at]!); block.id = newId(doc, `${id}-copy`);
  albumItems(block.items).forEach((i, n) => { i.id = `${block.id}-item-${n}`; });
  const blocks = [...doc.blocks]; blocks.splice(at + 1, 0, block); return { ...doc, blocks };
}
export function insertBlock(doc: AlbumDocument, afterId: string, kind: AlbumBlockKind): AlbumDocument {
  const id = newId(doc, `custom-${kind}`);
  const block: AlbumBlock = { id, kind, layout: resolveLayout(kind, undefined, doc.style.theme), hidden: false,
    items: kind === "divider" ? [] : [{ id: `${id}-item`, fields: kind === "text" ? { text: "글을 남겨 주세요." } : { caption: "" }, photos: [], edited: {} }] };
  const blocks = [...doc.blocks]; blocks.splice(doc.blocks.findIndex(b => b.id === afterId) + 1, 0, block); return { ...doc, blocks };
}
export function setStyle(doc: AlbumDocument, patch: Partial<AlbumDocument["style"]>): AlbumDocument {
  const style = { ...doc.style, ...patch }; style.tint = resolveAlbumTint(style.theme, patch.theme ? patch.tint : style.tint);
  return { ...doc, style };
}

/** Build the whole insertion before the controller records one undo step. */
export function insertAlbumMemories(doc: AlbumDocument, candidates: Candidate[], ids: string[], createKind?: AlbumBlockKind): AlbumDocument {
  if (createKind && !doc.blocks.some(b => b.kind === createKind)) {
    const block: AlbumBlock = { id: newId(doc, `memory-${createKind}`), kind: createKind, layout: resolveLayout(createKind, undefined, doc.style.theme), hidden: false, items: [] };
    const blocks = [...doc.blocks], at = blocks.findIndex(b => ALBUM_DRAFT_ORDER.indexOf(b.kind) > ALBUM_DRAFT_ORDER.indexOf(createKind));
    blocks.splice(at < 0 ? blocks.length : at, 0, block); doc = { ...doc, blocks };
  }
  return applyAlbumUpdate(doc, { add: ids, replace: [] }, { available: true, added: candidates, changed: [], removed: [] });
}

type Save = (id: string, document: AlbumDocument, expectedRevision: number) => Promise<{ revision: number }>;
/** One serial save lane. Local changes made during a request keep the returned server revision. */
export function createAlbumEditSession(initial: AlbumDocument, save: Save, changed: () => void = () => {}) {
  let document = structuredClone(initial), revision = initial.revision, serial = 0, savedSerial = 0, disposed = false;
  let status: "saved" | "saving" | "conflict" | "error" = "saved";
  const past: AlbumDocument[] = [], future: AlbumDocument[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined, running: Promise<void> | undefined;
  const schedule = () => {
    clearTimeout(timer); if (disposed || status === "conflict") return;
    status = "saving"; timer = setTimeout(() => { void flush(); }, 1500); changed();
  };
  const flush = async (): Promise<boolean> => {
    clearTimeout(timer); while (running) await running;
    if (disposed || status === "conflict") return false;
    if (savedSerial === serial) return true;
    const version = serial, snapshot = { ...document, revision }; status = "saving"; changed();
    running = (async () => {
      try {
        const result = await save(snapshot.id, snapshot, revision);
        if (disposed) return;
        revision = result.revision; document = { ...document, revision }; savedSerial = version;
        status = serial === version ? "saved" : "saving";
      } catch (error) { if (!disposed) status = (error as { status?: number })?.status === 409 ? "conflict" : "error"; }
      finally { running = undefined; if (!disposed) changed(); }
    })();
    await running;
    if (status === "saving" && savedSerial !== serial) return flush();
    return savedSerial === serial;
  };
  const apply = (next: AlbumDocument) => {
    if (next === document || JSON.stringify(next) === JSON.stringify(document)) return;
    past.push(document); if (past.length > 50) past.shift(); future.length = 0;
    document = { ...next, revision }; serial++; schedule();
  };
  return {
    get document() { return document; }, get status() { return status; },
    get message() { return status === "conflict" ? "다른 기기에서 바뀌었어요" : status === "error" ? "저장하지 못했어요" : status === "saving" ? "저장 중…" : "저장됨"; },
    get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
    apply, flush,
    forgetPhoto(id: string) {
      for (let n = 0; n < past.length; n++) past[n] = removeAlbumPhotoReferences(past[n]!, id);
      for (let n = 0; n < future.length; n++) future[n] = removeAlbumPhotoReferences(future[n]!, id);
    },
    undo() { const prev = past.pop(); if (prev) { future.push(document); document = { ...prev, revision }; serial++; schedule(); } },
    redo() { const next = future.pop(); if (next) { past.push(document); document = { ...next, revision }; serial++; schedule(); } },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}
