import type { AlbumDocument } from "@rcm/shared";
import type { albumClient } from "./api.js";
import { downscaleImage, albumPhotoError } from "./photos.js";

type Api = Pick<ReturnType<typeof albumClient>, "uploadPhoto" | "loadPhoto" | "save" | "removePhoto">;
export type PersonImageHost = Pick<RisuPluginApi, "getCharacter" | "getDatabase" | "readImage" | "getCharacterFromIndex"> & Partial<Pick<RisuPluginApi, "getCurrentCharacterIndex">>;
export function albumRisuPortraitRole(doc: AlbumDocument, person: "me" | "partner"): "me" | "partner" | undefined {
  const name = doc.people[person].name;
  if (name && name === doc.source.personaName) return "me";
  const defaultPair = doc.source.defaultPair ?? ([doc.people.me.name, doc.people.partner.name].includes(doc.source.personaName) && [doc.people.me.name, doc.people.partner.name].includes(doc.source.characterName));
  return name && defaultPair ? "partner" : undefined;
}
/** Same upload/save path for local files and Risu assets. Only the album copy changes. */
export async function saveAlbumPersonImage(doc: AlbumDocument, person: "me" | "partner", bytes: Uint8Array, api: Api, source: "risu" | "upload" = "upload", asset?: string): Promise<string> {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error("사진은 8MB 이하로 골라 주세요.");
  const prepared = await downscaleImage(new Blob([new Uint8Array(bytes)]));
  const { bytes: upload, ...meta } = prepared;
  const { photo } = await api.uploadPhoto(doc.id, upload, { ...meta, source: "upload" });
  try {
    const url = await api.loadPhoto(doc.id, photo.id, "thumb");
    const next = structuredClone(doc); next.people[person].photoId = photo.id; next.people[person].photoSource = source;
    if (asset) next.people[person].photoAsset = asset; else delete next.people[person].photoAsset;
    const saved = await api.save(doc.id, next, doc.revision);
    doc.people[person] = next.people[person]; doc.revision = saved.revision;
    return url;
  } catch (error) { await api.removePhoto(doc.id, photo.id).catch(() => {}); throw error; }
}
export interface AlbumProfileSource { key: string; group: "대표 이미지" | "카드 아이콘" | "페르소나"; name: string; path: string }
export interface AlbumPortraitSources { name: string; missingBot: boolean; images: AlbumProfileSource[]; personaKey?: string }
type PortraitSource = Pick<AlbumDocument["source"], "chatId" | "characterId" | "personaName">;
/** Cache only portrait metadata, never character/chat bodies; clear on wizard/editor close. */
export function createAlbumPortraitReader(host: PersonImageHost) {
  const characters = new Map<number, Promise<any>>();
  let personas: ReturnType<PersonImageHost["getDatabase"]> | undefined;
  const scoped: PersonImageHost = { ...host,
    getCharacter: () => host.getCharacter(), readImage: host.readImage?.bind(host), getCurrentCharacterIndex: host.getCurrentCharacterIndex?.bind(host),
    getDatabase: () => personas ??= host.getDatabase(["personas"]),
    ...(host.getCharacterFromIndex ? { getCharacterFromIndex(index: number) {
      let value = characters.get(index);
      if (!value) { value = host.getCharacterFromIndex!(index).then(c => c ? { chaId: c.chaId, name: c.name, image: c.image,
        ccAssets: c.ccAssets?.filter((a: { type?: string }) => a.type === "icon"), chats: c.chats?.map((chat: { id?: string; bindedPersona?: string }) => ({ id: chat.id, bindedPersona: chat.bindedPersona })) } : null); characters.set(index, value); }
      return value;
    } } : {}),
  };
  return { read: (source: PortraitSource, personName?: string) => readAlbumPortraitSources(source, scoped, personName), clear() { characters.clear(); personas = undefined; } };
}
/** RisuAI 7be37f64 / 2026.10.295: characters[].chaId/chats[].id/bindedPersona, personas[].id/name/icon. */
export async function readAlbumPortraitSources(source: PortraitSource, host: PersonImageHost, personName = source.personaName): Promise<AlbumPortraitSources> {
  const db = await host.getDatabase(["personas"]).catch(() => null);
  let bot: any, byChat: any;
  const matches = (c: any) => {
    const ownsChat = c?.chats?.some((chat: { id?: string }) => chat.id === source.chatId);
    if (ownsChat && !byChat) byChat = c;
    return c && (source.characterId ? c.chaId === source.characterId : ownsChat);
  };
  // characterOrder is display order, not the storage index. Verify the stable ID
  // and walk one character per host round trip instead of snapshotting the DB.
  if (host.getCharacterFromIndex) {
    const current = await host.getCurrentCharacterIndex?.().catch(() => -1) ?? -1;
    if (current >= 0) { const candidate = await host.getCharacterFromIndex(current).catch(() => null); if (matches(candidate)) bot = candidate; }
    for (let index = 0; !bot; index++) {
      if (index === current) continue;
      const candidate = await host.getCharacterFromIndex(index).catch(() => null);
      if (!candidate) break;
      if (matches(candidate)) bot = candidate;
    }
  } else {
    const candidate = await host.getCharacter().catch(() => null); if (matches(candidate)) bot = candidate;
  }
  bot ??= byChat;
  const chat = bot?.chats?.find((c: { id?: string }) => c.id === source.chatId);
  const personas: { id?: string; name?: string; icon?: string }[] = Array.isArray(db?.personas) ? db.personas : [];
  const preferred = personas.find(p => chat?.bindedPersona && p.id === chat.bindedPersona)
    ?? personas.find(p => p.name === personName);
  const ordered = [...personas].sort((a, b) => Number(b === preferred) - Number(a === preferred));
  const images: AlbumProfileSource[] = [
    { key: "main", group: "대표 이미지", name: "대표", path: bot?.image },
    ...(Array.isArray(bot?.ccAssets) ? bot.ccAssets.filter((a: { type?: string }) => a.type === "icon").map((a: { uri: string; name: string }) => ({ key: `icon:${a.uri}`, group: "카드 아이콘" as const, name: a.name, path: a.uri })) : []),
    ...ordered.map(p => ({ key: `persona:${p.id ?? p.icon}`, group: "페르소나" as const, name: p.name ?? "페르소나", path: p.icon! })),
  ].filter(i => typeof i.path === "string" && Boolean(i.path));
  return { name: typeof bot?.name === "string" ? bot.name : "", missingBot: !bot, images,
    personaKey: preferred?.icon ? `persona:${preferred.id ?? preferred.icon}` : undefined };
}
export async function readRisuPersonImage(person: "me" | "partner", host: PersonImageHost, sources: AlbumPortraitSources): Promise<Uint8Array> {
  const image = sources.images.find(i => i.key === (person === "me" ? sources.personaKey : "main"));
  if (!image || !host.readImage) throw new Error("불러올 사진이 없어요.");
  const bytes = await host.readImage(image.path);
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error("불러올 사진이 없어요.");
  return bytes;
}
export interface AlbumProfileImage extends AlbumProfileSource { url: string }
export async function readAlbumProfileImages(doc: AlbumDocument, person: "me" | "partner", host: PersonImageHost): Promise<{ name: string; missingBot: boolean; images: AlbumProfileImage[] }> {
  const sources = await readAlbumPortraitSources(doc.source, host, doc.people[person].name);
  const images = await Promise.all(sources.images.map(async candidate => {
    if (!host.readImage) return undefined;
    try {
      const bytes = await host.readImage(candidate.path), image = await downscaleImage(new Blob([new Uint8Array(bytes)]));
      return { ...candidate, url: URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.mime })) };
    } catch { return undefined; }
  }));
  return { name: sources.name, missingBot: sources.missingBot, images: images.filter((i): i is AlbumProfileImage => Boolean(i)) };
}
/** New albums only: an absent photo on an existing album may mean the owner removed it. */
export async function importDefaultAlbumPortraits(doc: AlbumDocument, api: Api, host: PersonImageHost, sources = readAlbumPortraitSources(doc.source, host)): Promise<void> {
  const resolved = await sources;
  for (const person of ["me", "partner"] as const) {
    const role = albumRisuPortraitRole(doc, person);
    if (doc.people[person].photoId || !role) continue;
    try { await saveAlbumPersonImage(doc, person, await readRisuPersonImage(role, host, resolved), api, "risu", role === "me" ? resolved.personaKey : "main"); }
    catch { /* Host portraits are optional; creation still succeeds without them. */ }
  }
}
/** Mount once on the editor root. Task 11 can retain this binding across pure rerenders. */
export function bindAlbumPersonImages(root: HTMLElement, doc: AlbumDocument, api: Api, host: PersonImageHost, changed: (person: "me" | "partner", url: string) => void): () => void {
  let busy = false;
  const run = async (form: HTMLFormElement, file?: File) => {
    if (busy) return;
    const person = form.dataset.albumPerson === "partner" ? "partner" : "me";
    const status = form.querySelector<HTMLElement>('[role="status"]');
    const controls = [...form.querySelectorAll<HTMLButtonElement>("button")].map(button => ({ button, disabled: button.disabled }));
    controls.forEach(({ button }) => { button.disabled = true; });
    busy = true; form.setAttribute("aria-busy", "true"); if (status) status.textContent = "불러오는 중";
    try {
      const role = albumRisuPortraitRole(doc, person);
      const path = form.dataset.personPath;
      if (!file && !path && !role) throw new Error("이 인물의 사진을 직접 올려 주세요.");
      const bytes = file ? new Uint8Array(await file.arrayBuffer()) : path && host.readImage ? await host.readImage(path) : await readRisuPersonImage(role!, host, await readAlbumPortraitSources(doc.source, host));
      const url = await saveAlbumPersonImage(doc, person, bytes, api, file ? "upload" : "risu", file ? undefined : form.dataset.personAsset);
      changed(person, url);
    } catch (error) { if (status) status.textContent = albumPhotoError(error); }
    finally { busy = false; controls.forEach(({ button, disabled }) => { button.disabled = disabled; }); form.removeAttribute("aria-busy"); }
  };
  const click = (event: Event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-album-person-source]');
    const form = button?.closest<HTMLFormElement>('form[data-album-person]');
    if (!form || !button) return;
    event.preventDefault(); event.stopPropagation();
    if (button.dataset.albumPersonSource === "upload") form.querySelector<HTMLInputElement>('input[type="file"]')?.click();
    else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };
  const submit = (event: Event) => { const form = event.target as HTMLFormElement; if (!form.matches('form[data-album-person]')) return; event.preventDefault(); event.stopPropagation(); void run(form); };
  const change = (event: Event) => { const input = event.target as HTMLInputElement; const form = input.closest<HTMLFormElement>('form[data-album-person]'); const file = input.files?.[0]; if (form && file) void run(form, file); };
  root.addEventListener("click", click); root.addEventListener("submit", submit); root.addEventListener("change", change);
  return () => { root.removeEventListener("click", click); root.removeEventListener("submit", submit); root.removeEventListener("change", change); };
}
