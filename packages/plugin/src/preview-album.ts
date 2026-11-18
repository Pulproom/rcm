import { renderAlbumForBoard } from "./album/board-render.js";
import { buildAlbumPhotoList, createAlbumViewController } from "./dashboard/album-editor.js";
import { dashboardStylesheet, confirmDashboard } from "./dashboard.js";
import { ALBUM_BLOCK_KINDS, type AlbumMaterials, type AlbumMaterialItem, ALBUM_THEMES, AlbumBondSchema, albumTurningPoints, resolveAlbumTint, AlbumDocumentSchema, type AlbumItem, type AlbumUpdateCandidates, albumTogetherItems, type AlbumTogetherRecords } from "@rcm/shared";
import { albumClient } from "./album/api.js";
import { ALBUM_FONT_LINKS } from "./album/themes/index.js";

/** Fabricated records for comparing the approved together layouts, never collected from a chat. */
function previewTogetherRecords(): AlbumTogetherRecords {
  const firstAt = Date.parse("2026-03-02T01:00:00Z");
  const days: Array<[string, number]> = Array.from({ length: 262 }, (_, n) => {
    const x = Math.sin(n * 91.7) * 10000, v = x - Math.floor(x), quiet = Math.floor(n / 7) >= 22 && Math.floor(n / 7) <= 24;
    const count = quiet ? (v > .9 ? 1 : 0) : v < .28 ? 0 : v < .55 ? 1 : v < .8 ? 4 : v < .95 ? 11 : 25;
    return [new Date(firstAt + n * 86_400_000).toISOString().slice(0, 10), n === 134 ? 86 : count];
  });
  return { asOf: Date.parse("2026-11-18T03:00:00Z"), timeZone: "Asia/Seoul", firstAt, dayNumber: 262, stories: 1284, chars: 1820000, books: 7,
    lastTurnAt: Date.parse("2026-11-18T01:00:00Z"), storyDays: 7, realSpan: "8개월", days, topDay: { date: "2026-07-14", turns: 86 },
    hours: [6,3,1,0,0,0,0,0,0,0,1,1,2,2,1,2,3,3,4,6,9,12,15,13], peakHour: 22,
    longest: { startAt: Date.parse("2026-08-03T14:00:00Z"), minutes: 252, turns: 61 }, streak: { days: 19, from: "2026-06-02", to: "2026-06-20" },
    quiz: { answered: 48, correct: 39, bestStreak: 12 } };
}

/** Synthetic by default; a private same-origin JSON file is loaded only with fixture=local. */
export async function showAlbumPreview(params: URLSearchParams): Promise<void> {
  try {
    if (params.get("width") === "375") {
      const url = new URL(location.href); url.searchParams.delete("width");
      document.body.style.cssText = "margin:0;background:#242424;display:flex;justify-content:center;height:100dvh";
      const frame = document.createElement("iframe"); frame.title = "375px 앨범 감상"; frame.src = url.href;
      frame.style.cssText = "border:0;width:375px;max-width:100%;height:100dvh"; document.body.replaceChildren(frame); return;
    }
    const local = params.get("fixture") === "local";
    const themeValue = params.get("theme");
    const theme = ALBUM_THEMES.find(t => t === themeValue) ?? "book";
    const schemeValue = params.get("scheme");
    const colorScheme = schemeValue === "light" || schemeValue === "dark" ? schemeValue : "auto";
    const withPhotos = local ? params.get("photos") === "1" : params.get("photos") !== "0";
    const mode = (params.get("album") === "edit" || params.get("album") === "photos") ? "edit" : "view";
    const item = (id: string, fields: Record<string, string>, children?: AlbumItem[], picture = false): AlbumItem => ({
      id, fields, edited: {}, photos: withPhotos && picture ? [{ photoId: `preview-${id}`, caption: fields.title ?? "빛의 기록" }] : [], ...(children ? { children } : {}),
    });
    const firsts = [
      item("first-1", { title: "지도 밖의 서점", date: "2026-04-08", location: "연무항 골목", summary: "같은 지도를 펼쳐 놓은 오후" }),
      item("first-2", { title: "서로에게 건넨 이름", date: "2026-04-19", location: "등대 계단" }),
      item("first-3", { title: "첫 번째 공동 항해", date: "2026-05-03", location: "초록빛 만" }),
    ];
    const chapters = ["지도가 시작된 곳", "푸른 조류를 따라서", "등대에 남긴 편지, North Harbor에서 우리가 다시 펼쳐 본 오래된 지도의 빈칸과 다음 계절의 약속"].map((title, n) => item(`chapter-${n}`, { title, summary: ["오래된 지도 한 장과 두 사람의 첫 약속.", "이름 없는 섬을 지나 함께 찾은 항로.", "돌아온 항구에서 다음 계절을 기다리며."][n]!, date: `2026-0${4 + n}-08` }, [
      item(`scene-${n}-0`, { title: ["책갈피의 좌표", "낯선 섬의 오후", "창가의 작은 봉투"][n]!, summary: "이솔은 접힌 종이를 펴고 나루가 그어 둔 선 옆에 작은 별을 그렸다. 다음 목적지는 두 사람이 함께 고른 곳이었다.", date: `2026-0${4 + n}-08 14:20`, location: "연무항" }, [item(`line-${n}`, { text: "이번 지도에는 네가 고른 길도 남겨 줘.", speaker: "나루", date: `2026-0${4 + n}-08` })], true),
      item(`scene-${n}-1`, { title: "돌아오는 길", summary: "저녁빛이 물가를 따라 번졌다. 이솔과 나루는 말없이 같은 방향으로 걸었다.", date: `2026-0${4 + n}-19 18:05`, location: "등대 아래" }, [item(`reply-${n}`, { text: "여기, 우리 둘의 출발점.", speaker: "이솔" })], true),
      item(`scene-${n}-2`, { title: "다음 좌표", summary: "다음 항구의 시간을 적어 둔 페이지.", date: `2026-0${4+n}-20` }),
      item(`scene-${n}-3`, { title: "물가의 빛", summary: "지도 옆에 남긴 항구의 풍경.", date: `2026-0${4+n}-21` }, undefined, true),
    ]));
    if (withPhotos) {
      chapters[0]!.photos = [{ photoId: "preview-chapter-extra", caption: "항구의 첫 페이지" }];
      chapters[0]!.children![1]!.photos.push({ photoId: "preview-scene-extra-1", caption: "" });
      chapters[0]!.children![3]!.photos.push(
        { photoId: "preview-scene-extra-2", caption: "먼 등대" }, { photoId: "preview-scene-extra-3", caption: "" },
        { photoId: "preview-scene-extra-4", caption: "물결 위의 빛" }, { photoId: "preview-scene-extra-5", caption: "저녁 항구" },
      );
      chapters[1]!.photos = [{ photoId: "preview-chapter-feature", caption: "새 항로" }];
      chapters[1]!.children![0]!.photos = [];
    }
    let doc = AlbumDocumentSchema.parse({ version: 1, id: "synthetic-album", title: "지도 밖의 계절", createdAt: Date.UTC(2026, 4, 22), subtitle: "이솔과 나루의 항해 기록", periodLabel: "2026. 4. 8. — 2026. 6. 19.",
      people: { me: { name: "이솔", ...(withPhotos ? { photoId: "portrait-me" } : {}) }, partner: { name: "나루", ...(withPhotos ? { photoId: "portrait-partner" } : {}) } },
      ...(withPhotos ? { coverPhotoId: "cover" } : {}), style: { theme, tint: params.get("tint") ?? undefined, colorScheme },
      source: { chatId: "synthetic-chat", characterId: "preview-source-bot", characterName: "항해 기록", personaName: "이솔", defaultPair: true, sourceAvailable: true },
      blocks: [
        { id: "cover", kind: "cover" },
        { id: "intro", kind: "intro", items: [item("counts", { me: "이솔", partner: "나루", scenes: "97", chapters: "3", promises: "8" })] },
        { id: "hearts", kind: "hearts", items: [item("heart-a", { from: "이솔", to: "나루", summary: "길을 잃어도 다시 지도를 펼칠 수 있는 사람. 함께라면 낯선 항구도 조금은 익숙하다." }), item("heart-b", { from: "나루", to: "이솔", summary: "말보다 오래 남는 작은 표시들. 네가 그어 둔 선을 따라 다시 돌아갈 곳을 찾는다. 낯선 항구에서도 같은 지도를 펼쳐 놓으면 처음 출발하던 아침을 떠올릴 수 있다. 접힌 모서리와 연필로 적은 좌표 사이에 다음에 가 보고 싶은 장소가 아직 여럿 남아 있다." })] },
        { id: "story", kind: "story", items: chapters },
        { id: "quotes", kind: "quotes", items: [item("quote-a", { text: "이번 지도에는 네가 고른 길도 남겨 줘.", speaker: "나루", date: "2026-04-08" }), item("quote-b", { text: "그럼 도착지도 함께 고르자.", speaker: "이솔", date: "2026-04-08" })] },
        { id: "promises", kind: "promises", items: [item("vow-a", { text: "첫 항해의 지도를 함께 완성하기", from: "이솔", to: "나루", status: "kept", date: "2026-05-03" }), item("vow-b", { text: "비 오는 날에도 부두에서 만나기", from: "나루", to: "이솔", status: "broken", date: "2026-05-12" }), item("vow-c", { text: "다음 봄에 같은 항구로 돌아오기", from: "이솔", to: "나루", status: "open", date: "2027-04-08" })] },
        { id: "gallery", kind: "gallery", items: withPhotos ? Array.from({ length: 8 }, (_, i) => item(`gallery-${i}`, {}, undefined, true)) : [] },
        { id: "firsts", kind: "firsts", items: firsts },
        { id: "progress", kind: "progress", items: [item("progress-a", { title: "함께 떠난 첫 여행", persona: "이솔", character: "나루" }, [item("progress-cell", { side: "me", status: "done" })])] },
        { id: "nicknames", kind: "nicknames", items: [item("name-a", { from: "나루", to: "이솔", text: "길잡이" }), item("name-b", { from: "이솔", to: "나루", text: "별지기" })] },
        { id: "intimacy", kind: "intimacy", hidden: false, items: [item("close-a", { title: "처음 맞잡은 손", date: "2026-05-03", summary: "배가 흔들리던 순간", from: "이솔", to: "나루" })] },
        { id: "text", kind: "text", items: [item("note", { body: "다음 계절에도 이 지도의 빈칸을 조금씩 채워 가기로." })] },
        { id: "photo", kind: "photo", items: withPhotos ? [item("frame", { caption: "항구의 저녁빛" }, undefined, true)] : [] },
        { id: "divider", kind: "divider" },
      ],
    });
    const together = previewTogetherRecords();
    const togetherItems = albumTogetherItems(together);
    if (params.get("together") === "all") togetherItems.forEach(i => { i.hidden = false; });
    doc.blocks.splice(2, 0, { id: "together", kind: "together", layout: "ledger", hidden: false, together, items: togetherItems });
    const bond = AlbumBondSchema.parse({ events: Array.from({ length: 6 }, (_, n) => ({
      id: `bond-event-${n}`, from: n % 2 ? "나루" : "이솔", to: n % 2 ? "이솔" : "나루", sourceOrdinal: n * 10, scene: n + 1,
      sourceMemoryId: `bond-scene-${n}`, date: ["2026-04-08", "2026-04-08", "2026-04-19", "2026-05-03", "2026-05-19", "2026-06-19"][n],
      title: ["접힌 지도의 빈칸", "두 사람이 고른 길", "부두의 약속", "항로를 다시 정한 날", "서로 다른 좌표", "등대 아래의 대답"][n],
      reason: ["지도의 좌표를 함께 확인했다.", "먼저 내민 제안을 받아들였다.", "돌아오겠다는 약속을 지켰다.", "모르는 길을 맡기기로 했다.", "같은 목적지를 다르게 기억했다.", "각자의 이야기를 끝까지 들었다."][n],
      changes: [{ axis: ["affection", "trust", "intimacy"][n % 3], effect: n === 4 ? "decrease" : "increase", impact: n % 2 ? "turning" : "major" }],
    })), directions: [
      { from: "이솔", to: "나루", baseline: { affection: "faint", trust: "fragile", intimacy: "none" }, current: { affection: "strong", trust: "established", intimacy: "developing" }, tensions: ["다음 항로를 정하는 일"] },
      { from: "나루", to: "이솔", baseline: {}, current: { affection: "deep", trust: "strong", intimacy: "established" }, tensions: ["아직 답하지 않은 편지"] },
    ] });
    doc.blocks.push({ id: "bond", kind: "bond", hidden: false, layout: "flow", bond, items: albumTurningPoints(bond.events) });
    const promises = doc.blocks.find(b => b.kind === "promises")!;
    promises.items.push(...Array.from({ length: 5 }, (_, n) => item(`vow-extra-${n}`, { text: ["등대 창문에 새 유리 달기", "봄의 항로를 다시 기록하기", "항구의 오래된 표지판 찾기", "지도책을 서점에 돌려주기", "마지막 좌표를 함께 확인하기"][n]!, status: n % 2 ? "kept" : "open", from: "나루", to: "이솔" })));
    doc.blocks.find(b => b.kind === "quotes")!.items.push(item("quote-c", { text: "비가 그치면, 저 불빛을 따라가자. 천천히 가도 돼.", speaker: "나루" }), item("quote-d", { text: "The café is still open. Let's keep this page.", speaker: "이솔" }));
    if (local) {
      // set=<name> opens another private recording (local-fixture-album-<name>.json); names are structural only.
      const set = /^[a-z0-9-]{1,32}$/.test(params.get("set") ?? "") ? `-${params.get("set")}` : "";
      const response = await fetch(`./local-fixture-album${set}.json`, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("Local fixture unavailable");
      doc = AlbumDocumentSchema.parse(await response.json());
      if (themeValue) doc.style.theme = theme;
      doc.style.tint = resolveAlbumTint(doc.style.theme, params.get("tint") ?? doc.style.tint);
      if (schemeValue === "light" || schemeValue === "dark" || schemeValue === "auto") doc.style.colorScheme = schemeValue;
      // Real IDs never reach the image callback. This preview has no inlay/photo file store.
      let pictureIndex = 0;
      const nextPicture = () => `preview-local-${pictureIndex++}`;
      doc.coverPhotoId = withPhotos ? nextPicture() : undefined;
      doc.people.me.photoId = withPhotos ? nextPicture() : undefined;
      doc.people.partner.photoId = withPhotos ? nextPicture() : undefined;
      const pictures = (items: AlbumItem[], story: boolean): void => {
        for (const item of items) {
          const slots = item.photos.length || (story && item.origin?.kind !== "dialogue" ? 1 : 0);
          item.photos = withPhotos ? Array.from({ length: slots }, (_, i) => ({ photoId: nextPicture(), caption: item.photos[i]?.caption })) : [];
          if (item.children) pictures(item.children, story);
        }
      };
      for (const block of doc.blocks) pictures(block.items, block.kind === "story");
    }
    const requestedPhotos = Number(params.get("photos"));
    if (!local && Number.isInteger(requestedPhotos) && requestedPhotos > 1) {
      const gallery = doc.blocks.find(b => b.kind === "gallery")!;
      const extra = Math.max(0, Math.min(requestedPhotos, 200) - buildAlbumPhotoList(doc).length);
      gallery.items.push(...Array.from({ length: extra }, (_, n) => item(`extra-photo-${n}`, { title: `항구의 기록 ${n + 1}` }, undefined, true)));
    }
    const fitDemo = !local && params.get("fitDemo") === "1";
    if (fitDemo && withPhotos) {
      const story = doc.blocks.find(b => b.kind === "story")!;
      story.items[0]!.children![0]!.photos = [{ photoId: "portrait-a", caption: "항구에서" }, { photoId: "portrait-b", caption: "등대 옆에서" }];
      story.items[0]!.children![1]!.photos = [{ photoId: "mixed-p", caption: "세로 사진" }, { photoId: "mixed-l", caption: "가로 사진" }];
    }
    if (!local && params.get("groupG") === "1") {
      const gallery = doc.blocks.find(b => b.kind === "gallery")!;
      gallery.items = gallery.items.slice(0, 7);
      gallery.photoColumns = [2,3,4].includes(Number(params.get("columns"))) ? Number(params.get("columns")) as 2 | 3 | 4 : undefined;
      gallery.photoShape = ["landscape", "portrait", "square"].includes(params.get("shape") ?? "") ? params.get("shape") as "landscape" | "portrait" | "square" : undefined;
      gallery.items[0]!.photos[0]!.fit = { shape: "portrait", x: 25, y: 65, zoom: 1.3 };
    }
    if (!local && params.get("coverEmpty") === "1") delete doc.coverPhotoId;
    if (!local && params.get("groupF") === "1") {
      doc.source.defaultPair = true;
      doc.people.me.photoSource = "risu"; doc.people.me.photoAsset = "persona"; doc.people.partner.photoSource = "risu"; doc.people.partner.photoAsset = "main";
      doc.coverLineId = "synthetic-written-cover"; doc.coverLineUserWritten = true;
      doc.coverLine = item("synthetic-written-cover", { text: "우리가 처음 같이 펼친 지도를, 나는 아직 창가에 놓아 두었어. 계절이 바뀌어도 접힌 선 사이에는 함께 고른 다음 항구가 남아 있을 거야.", speaker: doc.people.partner.name });
    }
    if (!local && params.get("coverLine") === "none") { doc.coverLineId = ""; delete doc.coverLine; doc.coverLineUserWritten = false; }
    const cache = new Map<string, string>();
    const photoWidth = Math.max(960, Math.min(2400, Number(params.get("photoSize")) || 960)), photoHeight = Math.round(photoWidth * .75);
    const photoDimensions = (id: string) => params.get("groupG") === "1" && id.startsWith("preview-gallery-") ? (Number(id.at(-1)) % 2 ? { width: 1200, height: 800 } : { width: 720, height: 1080 }) : fitDemo && /^(?:portrait-|mixed-p|cover$)/.test(id) ? { width: 720, height: 1080 } : { width: photoWidth, height: photoHeight };
    const photoSrc = (id: string) => {
      const cached = cache.get(id); if (cached) return cached;
      const canvas = document.createElement("canvas"); canvas.width = photoDimensions(id).width; canvas.height = photoDimensions(id).height;
      const context = canvas.getContext("2d")!;
      const hue = local && /^preview-local-\d+$/.test(id) ? Number(id.slice("preview-local-".length)) * 47 % 360 : [...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360;
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, `hsl(${hue} 28% 74%)`); gradient.addColorStop(.55, `hsl(${hue} 22% 48%)`); gradient.addColorStop(1, `hsl(${hue} 25% 23%)`);
      context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
      if (fitDemo) { context.strokeStyle = "#ffffffb0"; context.lineWidth = 5; context.strokeRect(30, 30, canvas.width - 60, canvas.height - 60); context.beginPath(); context.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * .22, 0, Math.PI * 2); context.stroke(); context.fillStyle = "#fff"; context.font = "30px sans-serif"; context.fillText(`${canvas.width} × ${canvas.height}`, 50, 80); }
      const src = canvas.toDataURL("image/png"); cache.set(id, src); return src;
    };

    const skin = params.get("skin") === "phone" ? "phone" : "film";
    document.documentElement.dataset.skin = skin;
    document.documentElement.dataset.theme = schemeValue === "light" ? "day" : schemeValue === "dark" ? "night" : skin === "phone" ? "day" : "night";
    document.head.innerHTML = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Album preview</title>${ALBUM_FONT_LINKS}<style>${dashboardStylesheet(skin)}</style>`;
    document.body.className = "film";
    const root = document.createElement("div"); document.body.replaceChildren(root);
    const books = new Map([[doc.id, structuredClone(doc)]]), imported = new Map<string, { bytes: Uint8Array; mime: string }>();
    const updateCandidates = (): AlbumUpdateCandidates => {
      const typed = (kind: string, value: AlbumItem): AlbumItem => ({ ...value, createdAt: Date.UTC(2026, 5, 1), origin: { kind, sourceId: value.id, fingerprint: "synthetic" } });
      const old = chapters[0]!.children![0]!, changed = chapters[0]!.children![1]!;
      // The source and album deliberately differ; this is synthetic user-edited prose.
      const saved = books.get(doc.id)!.blocks.find(b => b.kind === "story")!.items[0]!.children![0]!;
      saved.edited.summary = true;
      saved.fields.summary = "접힌 모서리에 남긴 별. 내가 다시 적어 둔 출발점.";
      const count = books.get(doc.id)!.blocks.find(b => b.kind === "intro")!.items[0]!;
      return { collectedAt: Date.UTC(2026, 6, 3), available: params.get("state") !== "gone", added: [
        { blockKind: "story", placeAfterItemId: "scene-0-1", item: typed("scene", item("update-scene", { title: "새 항로의 아침", summary: "등대 옆에서 다음 목적지를 골랐다.", date: "2026-04-20" })) },
        { blockKind: "story", item: typed("chapter", item("update-chapter", { title: "여름 항로", date: "2026-06-24" }, [typed("scene", item("update-child-1", { title: "장날 아침", date: "2026-06-24" })), typed("scene", item("update-child-2", { title: "먼 바다의 우편", date: "2026-07-02" }))])) },
        { blockKind: "quotes", item: typed("quote", item("update-quote", { text: "이 길의 끝에서도 지도를 펼쳐 보자.", speaker: "나루", date: "2026-06-24" })) },
        { blockKind: "promises", item: typed("promise", item("update-promise", { text: "다음 장날에 같은 부두에서 만나기", date: "2026-07-02", status: "open" })) },
      ], changed: [
        { blockKind: "story", itemId: changed.id, before: { ...changed.fields }, after: { ...changed.fields, summary: changed.fields.summary + " 나루는 다음 항구의 이름을 적었다." }, userEdited: false },
        { blockKind: "story", itemId: old.id, before: { ...old.fields }, after: { ...old.fields, summary: "두 사람은 오래된 지도를 펼치고 항구의 좌표를 다시 확인했다." }, userEdited: true },
        { blockKind: "intro", itemId: count.id, before: { ...count.fields }, after: { ...count.fields, scenes: "104", chapters: "4" }, userEdited: false },
      ], removed: [{ blockKind: "quotes", itemId: "quote-b" }] };
    };
    // Synthetic kept looks, newest first: earlier titles, tints, fewer chapters and no photos.
    const pastLooks = (book: typeof doc) => [["지도 밖의 계절", undefined, 3, true, 1], ["지도 밖의 계절", "sand", 3, true, 4], ["이솔과 나루", "sand", 2, false, 8], ["이솔과 나루", "sky", 2, false, 11], ["우리의 여름", undefined, 1, false, 13]].map(([title, tint, chapterCount, pictures, daysAgo], n) => {
      const document = structuredClone(book); document.title = title as string; document.revision = 20 - n * 3;
      document.style.tint = resolveAlbumTint(document.style.theme, tint as string | undefined);
      const strip = (items: AlbumItem[]): void => items.forEach(i => { i.photos = []; strip(i.children ?? []); });
      const story = document.blocks.find(b => b.kind === "story")!; story.items = story.items.slice(0, chapterCount as number);
      if (!pictures) { document.coverPhotoId = undefined; document.blocks.forEach(b => strip(b.items)); }
      const when = new Date(); when.setDate(when.getDate() - (daysAgo as number)); when.setHours([21, 1, 23, 20, 16][n]!, [14, 2, 40, 27, 5][n]!, 0, 0);
      return { revision: document.revision, createdAt: when.getTime(), title: document.title, theme: document.style.theme, tint: document.style.tint, sceneCount: story.items.reduce((sum, c) => sum + (c.children?.length ?? 0), 0), photoCount: buildAlbumPhotoList(document).length, document };
    });
    // Prepare before get() so the compare column reflects the album's actual local edit.
    const review = params.get("album") === "update" ? updateCandidates() : undefined;
    const metaPhotos: any[] = [];
    if (withPhotos) {
      const ids = new Set(buildAlbumPhotoList(doc).map(p => p.photoId));
      [doc.coverPhotoId, doc.people.me.photoId, doc.people.partner.photoId].forEach(id => { if (id) ids.add(id); });
      for (const id of ids) metaPhotos.push({ id, albumId: doc.id, mime: "image/png", source: "upload", ext: "png", ...photoDimensions(id), bytes: Math.floor(photoSrc(id).split(",")[1]!.length * .75) });
    }
    if (!local) for (let n = 0; n < Math.min(12, Number(params.get("tray") ?? 4)); n++) { const id = `unplaced-${n}`; metaPhotos.push({ id, albumId: doc.id, mime: "image/png", source: "upload", ext: "png", width: photoWidth, height: photoHeight, bytes: 500, createdAt: Date.now() }); }
    if (params.get("album") === "board" && params.get("raw") === "1") {
      const html = renderAlbumForBoard(doc, metaPhotos);
      document.head.innerHTML = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>게시판 미리보기</title>';
      document.body.className = ""; document.body.style.cssText = "margin:0";
      document.body.innerHTML = `<div style="width:100%;background:#fff;color:#222">${html}</div><div style="width:100%;background:#1f1f1f;color:#eee">${html}</div>`;
      return;
    }
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const materials: AlbumMaterials = { collectedAt: Date.UTC(2026, 6, 3), chat: { id: "synthetic-chat", title: doc.subtitle, characterName: "항해 기록", personaName: doc.people.me.name }, people: doc.people, counts: { scenes: 12, chapters: 3, promises: 8, quotes: 6 }, period: { from: "2026-04-08", to: "2026-06-21" }, blocks: Object.fromEntries(ALBUM_BLOCK_KINDS.map(k => [k, [] as AlbumMaterialItem[]])) as AlbumMaterials["blocks"] };
    const material = (i: AlbumItem): AlbumMaterialItem => ({ ...structuredClone(i), suggested: true, children: i.children?.map(material) });
    let inlayIndex = 0;
    materials.blocks.story = chapters.map(ch => ({ ...structuredClone(ch), suggested: true, children: ch.children!.map(scene => ({ ...structuredClone(scene), suggested: true, children: scene.children?.map(material), inlayIds: Array.from({ length: 25 }, () => uuid(inlayIndex++)) })) }));
    // The editor reads the same source snapshot for all kinds, including private local previews.
    // Extra records are invented here; fixture JSON is never rewritten.
    materials.together = doc.blocks.find(b => b.kind === "together")?.together;
    if (!local && params.get("togetherNew") === "1" && materials.together) materials.together = { ...structuredClone(materials.together),
      asOf: materials.together.asOf + 86_400_000, lastTurnAt: (materials.together.lastTurnAt ?? materials.together.asOf) + 86_400_000,
      stories: materials.together.stories + 1, dayNumber: (materials.together.dayNumber ?? 0) + 1 };
    for (const block of doc.blocks) if (block.kind !== "story" && block.kind !== "together") materials.blocks[block.kind].push(...block.items.map(material));
    if (local) materials.blocks.story = doc.blocks.filter(b => b.kind === "story").flatMap(b => b.items.map(material));
    if (!local && review && params.get("groupF") === "1") {
      const nickname = doc.blocks.find(b => b.kind === "nicknames")!.items[0]!;
      review.changed.push({ blockKind: "nicknames", itemId: nickname.id, before: { ...nickname.fields }, after: { ...nickname.fields, text: "좌표의 벗" }, userEdited: false });
    }
    const extraPromises: Record<string, string>[] = [
      { text: "다음 계절에도 같은 곳에서 만나기로 했다.", from: doc.people.me.name, to: doc.people.partner.name, status: "open", date: "2026-05-19" },
      { text: "길을 잃으면 먼저 본 별을 기준으로 다시 만나기로 했다.", who: "mutual", status: "kept", date: "2026-04-21" },
      { text: "지도의 빈칸은 둘이 같이 채우기로 했다.", from: doc.people.partner.name, to: doc.people.me.name, status: "broken", date: "2026-06-02" },
    ];
    materials.blocks.promises.push(...extraPromises.map((fields, n) => material(item(`preview-unused-vow-${n}`, fields))));
    materials.blocks.firsts.push(material(item("preview-unused-first", { title: "함께 고른 길", date: "2026-04-21" })));
    materials.blocks.intimacy.push(material(item("preview-unused-close", { title: "가까이 앉은 저녁", date: "2026-05-19", summary: "이야기를 나누던 시간" })));
    const firstChapter = materials.blocks.story[0];
    firstChapter?.children?.push(material(item("preview-unused-scene", { title: "다음 페이지", summary: "두 사람은 다음 목적지를 함께 골랐다.", date: "2026-04-21" })));
    materials.blocks.story.push(material({ ...item("preview-unused-chapter", { title: "다음 계절", date: "2026-07-02" }, [item("preview-unused-chapter-scene", { title: "돌아온 길", summary: "함께 남겨 둔 표식을 다시 찾았다.", date: "2026-07-02" })]), origin: { kind: "chapter", sourceId: "preview-unused-chapter", fingerprint: "synthetic" } }));
    if (review && params.get("state") !== "none") for (const row of review.added) {
      if (row.blockKind === "story" && row.item.children) materials.blocks.story.push(material(row.item));
      else if (row.blockKind === "story") materials.blocks.story[0]!.children!.push(material(row.item));
      else materials.blocks[row.blockKind].push(material(row.item));
    }
    if (withPhotos) Object.assign(metaPhotos.find(p => p.id === "preview-scene-0-0") ?? {}, { source: "inlay", inlayId: uuid(0), caption: "책갈피의 좌표" });
    if (!local && params.get("groupF") === "1") for (const chapter of materials.blocks.story) for (const scene of chapter.children ?? []) if (review?.added.some(c => c.item.id === scene.id)) {
      scene.children = Array.from({ length: 5 }, (_, n) => material(item(`update-quote-${scene.id}-${n}`, { text: ["여기서 보면 항구가 다 보여.", "내려갈 땐 손 잡아 줘요.", "다음에는 저 섬에도 가 보자.", "길을 잃어도 같이 돌아오면 돼요.", "오늘의 좌표를 오래 기억할게."][n]!, speaker: n % 2 ? doc.people.me.name : doc.people.partner.name })));
    }
    const api = albumClient({
      url: path => `${location.origin}${path}`,
      async request<T>(path: string, init?: RequestInit): Promise<T> {
        if (path.split("?")[0]!.endsWith("/album-materials")) return materials as T;
        if (path.split("?")[0]!.endsWith("/album-together")) return materials.together as T;
        const parts = path.split("/"), id = decodeURIComponent(parts[3] ?? ""), book = books.get(id);
        if (path.split("?")[0]!.endsWith("/update-materials")) {
          if (params.get("state") === "loading") return new Promise<T>(() => {});
          const candidates = params.get("state") === "none" ? { available: true, added: [], changed: [], removed: [] } : structuredClone(review ?? updateCandidates());
          return { candidates, materials: candidates.available ? materials : undefined, together: candidates.available ? materials.together : undefined } as T;
        }
        if (path.endsWith("/update-candidates")) {
          if (params.get("state") === "loading") return new Promise<T>(() => {});
          if (params.get("state") === "none") return { available: true, added: [], changed: [], removed: [] } as T;
          return structuredClone(review ?? updateCandidates()) as T;
        }
        if (parts[4] === "versions" && book) {
          if (params.get("state") === "loading") return new Promise<T>(() => {});
          const looks = params.get("state") === "none" ? [] : pastLooks(book);
          if (!parts[5]) return { versions: looks.map(({ document, ...row }) => row) } as T;
          const look = looks.find(v => v.revision === Number(parts[5])); if (!look) throw { status: 404 };
          if (parts[6] !== "restore") return { document: look.document, revision: look.revision, createdAt: look.createdAt } as T;
          const next = structuredClone(look.document); next.revision = book.revision + 1; books.set(id, next); return { revision: next.revision } as T;
        }
        if (path.endsWith("/exports") && init?.method === "POST") return { name: "이솔-나루-20261115-1700.html", path: "D:\\RCM-user-data\\album-exports\\이솔-나루-20261115-1700.html", readPath: "/v1/album-exports/synthetic-read-link/album.html", bytes: new Blob([String(init.body)]).size, expiresAt: Date.now() + 30 * 60_000 } as T;
        if (path.endsWith("/photos") && init?.method === "POST") {
          const headers = new Headers(init.headers), meta = JSON.parse(headers.get("X-RCM-Photo-Meta")!);
          const old = meta.inlayId && metaPhotos.find(p => p.inlayId === meta.inlayId); if (old) return { photo: old } as T;
          const photoId = crypto.randomUUID(), mime = headers.get("Content-Type")!;
          imported.set(photoId, { bytes: new Uint8Array(init.body as Uint8Array), mime });
          if (params.get("uploadDelay")) await new Promise(r => setTimeout(r, Number(params.get("uploadDelay"))));
          if (params.get("uploadFail") === "1") throw new Error("사진을 올리지 못했어요.");
          const photo = { ...meta, id: photoId, albumId: id, mime, bytes: (init.body as Uint8Array).byteLength }; metaPhotos.push(photo); return { photo } as T;
        }
        if (path.includes("/photos/") && init?.method === "PATCH") { const photo = metaPhotos.find(p=>p.id === decodeURIComponent(parts.at(-1)!)); Object.assign(photo, JSON.parse(String(init.body))); return { photo } as T; }
        if (path.includes("/photos/") && init?.method === "DELETE") { imported.delete(parts.at(-1)!); const at = metaPhotos.findIndex(p => p.id === parts.at(-1)); if (at >= 0) metaPhotos.splice(at, 1); return { ok: true } as T; }
        if (path.endsWith("/duplicate")) { const copy = structuredClone(book!); copy.id = crypto.randomUUID(); books.set(copy.id, copy); return { id: copy.id } as T; }
        if (init?.method === "PUT" && book) {
          const body = JSON.parse(String(init.body));
          if (body.expectedRevision !== book.revision) throw { status: 409 };
          const next = AlbumDocumentSchema.parse(body.document); next.revision = book.revision + 1; books.set(id, next); return { revision: next.revision } as T;
        }
        if (init?.method === "DELETE") { books.delete(id); return { ok: true } as T; }
        if (book) return { document: structuredClone(book), revision: book.revision, photos: metaPhotos } as T;
        throw new Error("Unsupported preview album operation");
      },
      async raw(path: string) {
        const id = path.split("?")[0]!.split("/").at(-1)!, stored = imported.get(id);
        if (stored) return new Response(new Uint8Array(stored.bytes), { headers: { "Content-Type": stored.mime } });
        const bytes = Uint8Array.from(atob(photoSrc(id).split(",")[1]!), c => c.charCodeAt(0));
        return new Response(bytes, { headers: { "Content-Type": "image/png" } });
      },
    });
    const imageHost = {
      async readInlay(id: string) { await new Promise(r => setTimeout(r, 35)); return { type: "image" as const, data: photoSrc(id), ext: "png", name: `항구 사진 ${Number(id.slice(-12)) + 1}`, width: 960, height: 720 }; },
      async getCharacterFromIndex(index: number): Promise<any> { return (await this.getDatabase()).characters[index] ?? null; },
      async getCharacter() { return { name: "열린 다른 봇", image: "preview-bot-image", ccAssets: ["naru", "isol", "winter", "guest"].map(name => ({ type: "icon", uri: `preview-profile-${name}`, name })), emotionImages: [["smile", "not-listed"]] }; },
      async getDatabase() {
        if (params.get("profileDelay")) await new Promise(r => setTimeout(r, Number(params.get("profileDelay"))));
        return { characters: params.get("missingBot") === "1" ? [] : [
          { chaId: "open-bot", name: "열린 다른 봇", image: "wrong-bot-image", chats: [{ id: "other-chat" }] },
          { chaId: "preview-source-bot", name: "항해 기록", image: "preview-bot-image", chats: [{ id: "synthetic-chat", bindedPersona: "preview-persona" }], ccAssets: ["나루", "이솔", "겨울", "항구"].map(name => ({ type: "icon", uri: `preview-profile-${name}`, name })) },
        ], personas: [{ id: "other-persona", name: "다른 페르소나", icon: "other-persona-image" }, { id: "preview-persona", name: "이솔", icon: "preview-persona-image" }, { id: "guest-persona", name: "연우", icon: "guest-persona-image" }], selectedPersona: 0 };
      },
      async readImage(path: string) { if (params.get("profileFail") === "1") throw new Error("Unreadable synthetic image"); return Uint8Array.from(atob(photoSrc(path).split(",")[1]!), c => c.charCodeAt(0)); },
    };
    let previousMarkup = "";
    const controller = createAlbumViewController(root, api, { toast: message => { const toast = document.createElement("p"); toast.setAttribute("role","status"); toast.textContent=message; toast.style.cssText="position:fixed;z-index:100;bottom:24px;left:24px;right:24px;background:var(--screen);color:var(--ink);padding:16px"; root.append(toast); setTimeout(()=>toast.remove(),4000); }, skin: () => skin, host: imageHost,
      render: () => { const markup = controller.render(); if (markup !== previousMarkup) { previousMarkup = markup; root.innerHTML = markup; } },
      closed: () => { const url = new URL(location.href); url.searchParams.set("album", "shelf"); location.href = url.href; },
      confirm: message => confirmDashboard(message),
    });
    if (params.get("album") === "update") await controller.openAlbumUpdate(doc.id); else if (params.get("album") === "versions") { await controller.openAlbumVersions(doc.id); for (let n = Number(params.get("step")) || 0; n > 0; n--) { root.querySelector<HTMLButtonElement>(".avh-step")?.click(); await new Promise(r => setTimeout(r, 30)); } if (params.get("list") === "1") root.querySelector<HTMLButtonElement>(".avh-when")?.click(); } else if (params.get("album") === "board") await controller.openAlbumBoard(doc.id); else if (mode === "edit") await controller.openAlbumEdit(doc.id); else await controller.openAlbumView(doc.id);
    if (params.get("album") === "photos") root.querySelector<HTMLButtonElement>('[data-edit-action="photo"]')?.click();

  } catch {
    // Do not expose schema errors or fixture content in the console or error screen.
    document.body.textContent = "앨범 프리뷰를 열 수 없어요. local-fixture-album.json 파일과 형식을 확인해 주세요.";
  }
}
