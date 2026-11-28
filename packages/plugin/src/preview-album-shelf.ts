import { AlbumDocumentSchema } from "@rcm/shared";
import type { AlbumSummary } from "./album/api.js";
import type { ServerClient } from "./api-client.js";
import { openDashboard } from "./dashboard.js";
import type { RuntimeState } from "./types.js";

/** Invented shelf records only; never loads the optional private album fixture. */
export async function showAlbumShelfPreview(params: URLSearchParams, state: RuntimeState, client: ServerClient): Promise<void> {
  if (params.get("width") === "375") {
    const source = new URL(location.href); source.searchParams.delete("width");
    document.body.style.cssText = "margin:0;background:#242424;display:flex;justify-content:center;min-height:100vh";
    const frame = document.createElement("iframe"); frame.title = "375px 추억 책장"; frame.src = source.href;
    frame.style.cssText = "border:0;width:375px;max-width:100%;height:100dvh";
    document.body.replaceChildren(frame); return;
  }
  const themes = ["book", "program", "lp", "film", "book", "program", "lp", "film"] as const;
  const names = [["하린", "도윤"], ["Mira", "Eli"], ["이솔", "나루"], ["하린", "도윤"], ["Rin", "Sera"], ["Mira", "Eli"], ["이솔", "나루"], ["하린", "도윤"]];
  const titles = ["우리의 여름", "Mira & Eli", "지도를 접어 두고 아직 이름 붙이지 않은 아주 먼 바다의 계절을 따라 걸었던 날들", "두 번째 겨울", "Harbor days", "Mira & Eli", "바다의 계절", "두 번째 겨울"];
  let albums: AlbumSummary[] = params.get("empty") === "1" ? [] : themes.map((theme, i) => ({
    id: `shelf-${i}`, theme, tint: ["plum", "sea", "tomato", "seal", "pine", "dusk", "black", "kraft"][i], title: titles[i]!, names: names[i], sourceChatId: `chat-${i === 3 ? 0 : i}`, sourceAvailable: true,
    periodLabel: ["2025. 7 – 10", "2026. 5 – 6", "2026. 4 – 6", "2025. 11 – 12"][i % 4]!,
    coverPhotoId: i === 0 || i === 2 || i === 5 || i === 7 ? `cover-${i}` : null, revision: 1, updatedAt: 1,
    chapterCount: [12, 8, 3, 5][i % 4], promiseCount: [9, 16, 2, 4][i % 4], sceneCount: [97, 59, 6, 31][i % 4], coverQuote: "첫눈 오면 약방 앞에서.", newMemoryCount: i === 0 ? 4 : 0,
  }));
  if (params.get("pairs") === "1") albums = albums.slice(0, 2).map((album, n) => ({ ...album, sourceChatId: "shared-chat", names: n ? ["하린", "연우"] : ["하린", "도윤"], title: n ? "하린 & 연우" : "하린 & 도윤", newMemoryCount: n ? 1 : 4 }));
  state.settings.dashboardTheme = params.get("scheme") === "dark" ? "dark" : "light";
  const request = client.request.bind(client);
  client.request = (async (path: string, init?: RequestInit) => {
    if (path === "/v1/health") {
      const health = await request<any>(path, init);
      return { ...health, capabilities: { ...health.capabilities, memoryAlbum: true } };
    }
    if (path === "/v1/albums") return { albums: [...albums] };
    if (/^\/v1\/albums\/[^/]+\/exports$/.test(path) && init?.method === "POST") return { name: "우리의-여름-20261115-1700.html", path: "D:\\RCM-user-data\\album-exports\\우리의-여름-20261115-1700.html", readPath: "/v1/album-exports/synthetic-read-link/album.html", bytes: new Blob([String(init.body)]).size, expiresAt: Date.now()+30*60_000 };
    const match = path.match(/^\/v1\/albums\/([^/]+)(\/duplicate)?$/);
    if (match) {
      const id = decodeURIComponent(match[1]!);
      if (match[2] && init?.method === "POST") {
        const original = albums.find(album => album.id === id)!;
        const copy = { ...original, id: `copy-${crypto.randomUUID()}` }; albums = [copy, ...albums]; return { id: copy.id };
      }
      if (!init?.method || init.method === "GET") { const album = albums.find(a => a.id === id)!; return { revision: 1, photos: [], document: AlbumDocumentSchema.parse({ version:1,id,title:album.title,subtitle:"합성 미리보기",people:{me:{name:album.names?.[0] ?? ""},partner:{name:album.names?.[1] ?? ""}},style:{theme:album.theme,tint:album.tint},blocks:[{id:"cover",kind:"cover"}] }) }; }
      if (init?.method === "DELETE") { albums = albums.filter(album => album.id !== id); return { ok: true }; }
    }
    return request(path, init);
  }) as ServerClient["request"];
  const raw = client.raw?.bind(client);
  client.raw = async (path, init, timeout) => {
    if (!/^\/v1\/albums\/[^/]+\/photos\/[^/]+\?size=thumb$/.test(path)) {
      if (raw) return raw(path, init, timeout);
      throw new Error("Preview route unavailable");
    }
    const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 300;
    const context = canvas.getContext("2d")!, gradient = context.createLinearGradient(0, 0, 400, 300);
    gradient.addColorStop(0, "#c9a98a"); gradient.addColorStop(.6, "#7d6a5c"); gradient.addColorStop(1, "#4a4642");
    context.fillStyle = gradient; context.fillRect(0, 0, 400, 300);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
    return new Response(blob);
  };
  await openDashboard(state, client);
  document.querySelector<HTMLButtonElement>('[data-action="tab"][data-tab="albums"]')?.click();
}
