import { ALBUM_BLOCK_KINDS, AlbumItemSchema, type AlbumMaterials, type AlbumDocument, type AlbumMaterialItem } from "@rcm/shared";
import type { ServerClient } from "./api-client.js";
import type { RuntimeState } from "./types.js";
import { openDashboard } from "./dashboard.js";

// Only the approved mockup's invented DEMO, no optional private fixtures.
const DEMO = {
  chats: [
    { id: "c1", name: "한여름 약방", who: "하린 · 도윤", span: "2025. 7. 4. – 10. 25.", scenes: 97, open: true },
    { id: "c2", name: "등대 섬", who: "이솔 · 나루", span: "2026. 4. 8. – 6. 19.", scenes: 41 },
    { id: "c3", name: "Harbor days", who: "Rin · Sera", span: "2026. 7. 1. – 7. 10.", scenes: 12 },
  ],
  title: "우리의 여름", me: "하린", partner: "도윤", photos: 6,
  counts: { people: 2, firsts: 6, chapters: 12, scenes: 97, quotes: 38, promises: 9, turns: 4, hearts: 2, progress: 5, intimacy: 3 },
  chapters: [
    { title: "약방에 온 낯선 사람", span: "7. 4. – 7. 12.", scenes: [
      { d: "7. 4.", t: "비 오는 날 약방 문을 연 도윤", why: ["기념일"], lines: [["처음 뵙겠습니다. 약초를 사러 왔어요.", "도윤"], ["문 닫을 시간인데… 들어오세요.", "하린"], ["비가 그칠 때까지만 있어도 될까요.", "도윤"]] },
      { d: "7. 6.", t: "약초 이름을 외우는 내기", why: ["즐겨찾기"], lines: [["틀리면 내일도 오는 거예요.", "하린"], ["그럼 일부러 틀릴게요.", "도윤"]] },
      { d: "7. 9.", t: "한밤의 해열제", why: ["삽화"], lines: [["열이 내릴 때까지 여기 있을게.", "하린"]] },
      { d: "7. 11.", t: "장부 정리를 돕다", why: [], lines: [["숫자는 제가 볼게요.", "도윤"]] },
      { d: "7. 12.", t: "골목 끝 우산 가게", why: [], lines: [] },
    ] },
    { title: "장마와 우산", span: "7. 18. – 7. 30.", scenes: [
      { d: "7. 18.", t: "우산 하나를 같이 쓰다", why: ["기념일", "삽화"], lines: [["어깨 젖잖아요. 이리 와요.", "도윤"], ["…고마워요.", "하린"]] },
      { d: "7. 24.", t: "약초 바구니를 품에 안고", why: ["즐겨찾기"], lines: [["끝까지 젖지 않게 할게요.", "도윤"]] },
      { d: "7. 30.", t: "젖은 편지", why: [], lines: [["읽지 말고 그냥 두세요.", "하린"]] },
      { d: "7. 30.", t: "늦은 저녁 국수", why: [], lines: [] },
    ] },
    { title: "다리 위의 고백", span: "8. 10. – 8. 15.", scenes: [
      { d: "8. 15.", t: "다리 위에서", why: ["기념일", "즐겨찾기"], lines: [["대답 대신 손을 잡아도 돼요?", "도윤"], ["이미 잡았잖아요.", "하린"]] },
      { d: "8. 12.", t: "축제 준비", why: ["삽화"], lines: [["등불은 제가 달게요.", "하린"]] },
      { d: "8. 10.", t: "약방 문을 일찍 닫은 날", why: [], lines: [] },
    ] },
  ],
};

function syntheticMaterials(index: number, photos: boolean): AlbumMaterials {
  const chat = DEMO.chats[index]!, [me, partner] = chat.who.split(" · ");
  const item = (id: string, fields: Record<string, string>): AlbumMaterialItem => ({ ...AlbumItemSchema.parse({ id, fields }), suggested: true, children: undefined });
  const blocks = Object.fromEntries(ALBUM_BLOCK_KINDS.map(k => [k, [] as AlbumMaterialItem[]])) as AlbumMaterials["blocks"];
  blocks.story = DEMO.chapters.map((ch, ci) => ({ ...item(`chapter-${ci}`, { title: ch.title }), children: ch.scenes.map((scene, si) => {
    const nums = scene.d.match(/\d+/g)!; const date = `2025-${nums[0]!.padStart(2, "0")}-${nums[1]!.padStart(2, "0")}`;
    return { ...item(`scene-${ci}-${si}`, { title: scene.t, date, summary: scene.t }),
      signals: { anniversary: scene.why.includes("기념일"), bookmark: scene.why.includes("즐겨찾기"), illustration: photos && scene.why.includes("삽화") },
      inlayIds: photos && scene.why.includes("삽화") ? [`00000000-0000-4000-8000-${String(ci * 100 + si).padStart(12, "0")}`] : [],
      children: scene.lines.map(([text, speaker], qi) => item(`line-${ci}-${si}-${qi}`, { text: text!, speaker: speaker === DEMO.me ? me! : partner!, date })) };
  }) }));
  blocks.quotes = blocks.story.flatMap(c => c.children!.flatMap(s => s.children ?? []));
  blocks.firsts = blocks.story.flatMap(c => c.children!.filter(s => s.signals!.anniversary).map(s => item(`first-${s.id}`, { ...s.fields })));
  blocks.intro = [item("intro", { scenes: "12", chapters: "3", promises: "2" })];
  blocks.promises = [item("promise", { text: "첫눈 오면 약방 앞에서.", from: me!, to: partner!, status: "open" })];
  blocks.hearts = [item("heart", { from: me!, to: partner!, text: "늦은 저녁에도 문을 열어 둔 사람." })];
  blocks.progress = [item("progress", { title: "함께 산책" })];
  blocks.intimacy = [item("intimacy", { title: "손을 잡은 날", date: "2025-08-15" })];
  return { chat: { id: chat.id, title: chat.name, characterName: chat.name, characterId: `preview-${chat.id}`, personaName: me! }, people: { me: { name: me! }, partner: { name: partner! } },
    counts: { scenes: blocks.story.reduce((n, c) => n + c.children!.length, 0), chapters: 3, promises: 1, quotes: blocks.quotes.length }, period: { from: "2025-07-04", to: "2025-08-15" }, blocks };
}
export async function showAlbumWizardPreview(params: URLSearchParams, state: RuntimeState, client: ServerClient) {
  if (params.get("width") === "375") {
    const url = new URL(location.href); url.searchParams.delete("width");
    document.body.style.cssText = "margin:0;background:#242424;display:flex;justify-content:center;min-height:100vh";
    const frame = document.createElement("iframe"); frame.title = "375px 앨범 만들기"; frame.src = url.href;
    frame.style.cssText = "border:0;width:375px;max-width:100%;height:100dvh"; document.body.replaceChildren(frame); return;
  }
  const materials = DEMO.chats.map((_, i) => syntheticMaterials(i, params.get("photos") !== "0"));
  materials[0]!.chat.id = "preview-chat";
  if (params.get("pairs") === "1") {
    materials[0]!.chat.characterName = "도윤";
    materials[0]!.defaultPair = { me: "하린", partner: "도윤" }; materials[0]!.hiddenPairCount = 2;
    materials[0]!.pairs = [
      { me: "하린", partner: "도윤", sharedSceneCount: 5, relationshipEventCount: 8, hasPersona: true },
      { me: "하린", partner: "연우", sharedSceneCount: 4, relationshipEventCount: 5, hasPersona: true },
      { me: "도윤", partner: "연우", sharedSceneCount: 3, relationshipEventCount: 3, hasPersona: false },
    ];
    materials[0]!.blocks.story.forEach((chapter, n) => chapter.children!.forEach(scene => { scene.signals!.pair = n === 0; }));
  }
  state.settings.dashboardSkin = params.get("skin") === "phone" ? "phone" : "film";
  state.settings.dashboardTheme = state.settings.dashboardSkin === "phone" ? "light" : "dark";
  const photoFiles = new Map<string, { bytes: Uint8Array; mime: string; meta: any }>();
  risuai.readInlay = async id => {
    const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 120;
    const c = canvas.getContext("2d")!; c.fillStyle = `hsl(${Number(id.slice(-12)) * 37 % 360} 25% 55%)`; c.fillRect(0, 0, 160, 120);
    return { type: "image", data: canvas.toDataURL("image/png"), name: "약방의 기록", ext: "png", width: 160, height: 120 };
  };
  const originalDatabase = risuai.getDatabase.bind(risuai);
  risuai.getDatabase = async keys => Array.isArray(keys) && (keys.includes("personas") || keys.includes("characters")) ? {
    characters: materials.map(m => ({ chaId: m.chat.characterId, name: m.chat.title, image: "main", chats: [{ id: m.chat.id, bindedPersona: `persona-${m.chat.id}` }] })),
    personas: [{ id: "other", name: "다른 페르소나", icon: "other" }, ...materials.map(m => ({ id: `persona-${m.chat.id}`, name: m.chat.personaName, icon: "persona" }))], selectedPersona: 0,
  } : originalDatabase(keys);
  risuai.getCharacter = async () => ({ name: "열린 다른 봇", image: "wrong" });
  risuai.getCharacterFromIndex = async index => (await risuai.getDatabase(["characters"]))?.characters[index] ?? null;
  risuai.readImage = async path => { const canvas = document.createElement("canvas"); canvas.width = 60; canvas.height = 80; const c = canvas.getContext("2d")!; c.fillStyle = path === "persona" ? "#9a7182" : "#55768a"; c.fillRect(0,0,60,80); c.fillStyle="#fff";c.font="22px sans-serif";c.fillText(path === "persona" ? "하" : "도",18,48);return Uint8Array.from(atob(canvas.toDataURL("image/png").split(",")[1]!),c=>c.charCodeAt(0)); };
  const request = client.request.bind(client); const albums = new Map<string, AlbumDocument>();
  client.request = (async (path: string, init?: RequestInit) => {
    if (path === "/v1/health") { const health = await request<any>(path, init); return { ...health, capabilities: { ...health.capabilities, memoryAlbum: true } }; }
    if (path === "/v1/admin/chats") return { items: materials.map(m => ({ id: m.chat.id, chatTitle: m.chat.title, characterName: m.chat.characterName, memories: m.counts.scenes })) };
    if (path === "/v1/album-chats") return { items: materials.map(({ chat, people, counts, period }) => ({ chat, people, counts, period })) };
    const url = new URL(path, "http://preview.local");
    const chat = url.pathname.match(/^\/v1\/chats\/([^/]+)\/album-materials$/);
    if (chat) {
      const source = materials.find(m => m.chat.id === decodeURIComponent(chat[1]!))!;
      const pair = source.pairs?.find(p => p.me === url.searchParams.get("me") && p.partner === url.searchParams.get("partner"));
      if (!pair) return source;
      const selected = structuredClone(source); selected.people = { me: { name: pair.me }, partner: { name: pair.partner } };
      selected.blocks.story.forEach((chapter, n) => chapter.children!.forEach(scene => { scene.signals!.pair = n === source.pairs!.indexOf(pair); }));
      return selected;
    }
    if (path === "/v1/albums") {
      if (init?.method === "POST") { const { document } = JSON.parse(String(init.body)); albums.set(document.id, document); return { id: document.id, revision: 1 }; }
      return { albums: [...albums.values()].map(doc => ({ id: doc.id, title: doc.title, theme: doc.style.theme, tint: doc.style.tint, names: [doc.people.me.name, doc.people.partner.name], periodLabel: doc.periodLabel, sourceChatId: doc.source.chatId, revision: 1, updatedAt: 1, sourceAvailable: true, coverPhotoId: null, chapterCount: doc.blocks.find(b => b.kind === "story")?.items.length ?? 0, sceneCount: doc.blocks.find(b => b.kind === "story")?.items.reduce((n, ch) => n + (ch.children?.length ?? 0), 0) ?? 0, promiseCount: doc.blocks.find(b => b.kind === "promises")?.items.length ?? 0, coverQuote: doc.blocks.find(b => b.kind === "quotes")?.items[0]?.fields.text })) };
    }
    const photo = path.match(/^\/v1\/albums\/([^/]+)\/photos$/);
    if (photo && (!init?.method || init.method === "GET")) return { photos: [...photoFiles.values()].filter(p => p.meta.albumId === photo[1]).map(p => p.meta) };
    if (photo && init?.method === "POST") {
      const h = new Headers(init.headers), meta = JSON.parse(h.get("X-RCM-Photo-Meta")!);
      const previous = [...photoFiles.values()].find(p => p.meta.albumId === photo[1] && p.meta.inlayId === meta.inlayId);
      if (previous) return { photo: previous.meta };
      const id = crypto.randomUUID(), mime = h.get("Content-Type")!;
      const saved = { ...meta, id, albumId: photo[1], mime }; photoFiles.set(id, { bytes: new Uint8Array(init.body as Uint8Array), mime, meta: saved }); return { photo: saved };
    }
    const album = path.match(/^\/v1\/albums\/([^/]+)$/); if (album) {
      const id = decodeURIComponent(album[1]!), book = albums.get(id)!;
      if (init?.method === "PUT") { const body = JSON.parse(String(init.body)); if (body.expectedRevision !== book.revision) throw { status: 409 }; const next = { ...body.document, revision: book.revision + 1 }; albums.set(id, next); return { revision: next.revision }; }
      return { document: book, revision: book.revision, photos: [...photoFiles.values()].filter(p => p.meta.albumId === id).map(p => p.meta) };
    }
    return request(path, init);
  }) as ServerClient["request"];
  client.raw = async path => { const id = path.split("?")[0]!.split("/").at(-1)!, photo = photoFiles.get(id); if (!photo) throw new Error("Synthetic photo missing"); return new Response(new Uint8Array(photo.bytes), { headers: { "Content-Type": photo.mime } }); };
  await openDashboard(state, client);
  const trigger = document.createElement("button"); trigger.type = "button"; trigger.dataset.action = "new-album";
  trigger.dataset.startStep = params.get("step") ?? "1"; document.querySelector("#app")!.append(trigger); trigger.click(); trigger.remove();
}
