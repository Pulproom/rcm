import { ALBUM_THEMES, buildAlbumDraft, recommendedAlbumQuotes, resolveAlbumTint, type AlbumBlockKind, type AlbumDocument, type AlbumTheme, type AlbumPair } from "@rcm/shared";
import { importDraftInlays, downscaleImage, type InlayHost } from "../album/photos.js";
import { importDefaultAlbumPortraits, createAlbumPortraitReader, readRisuPersonImage, type PersonImageHost } from "../album/person-images.js";
import { albumClient } from "../album/api.js";
import type { ServerClient } from "../api-client.js";
import { albumWizardSteps, initialAlbumChoices, renderAlbumWizard, type AlbumWizardState } from "./album-wizard.js";

export function createAlbumWizardController(root: HTMLElement, client: ServerClient, hooks: {
  host?: InlayHost & PersonImageHost; skin: () => "film" | "phone"; currentChatId: () => string | undefined; render: () => void; closed: () => void; openAlbumView: (id: string) => Promise<void>;
}) {
  const api = albumClient(client);
  const portraits = hooks.host && createAlbumPortraitReader(hooks.host);
  let active = false, generation = 0;
  let html = "", renderKey = "";
  let createdDraft: { id: string; revision: number } | undefined;
  let s: AlbumWizardState = { step: 1, chats: [], chatId: "", choices: {}, theme: "book", loading: false, busy: false, error: "", sheet: false };
  const repaint = () => {
    html = "";
    const folds = [...root.querySelectorAll<HTMLDetailsElement>("[data-wiz-fold]")].map(d => [d.dataset.wizFold!, d.open] as const);
    const focus = document.activeElement as HTMLInputElement | null;
    const key = focus?.dataset.wizAction, value = focus?.dataset.value, id = focus?.id, selection = focus?.selectionStart;
    // The wizard shares the document scroll, so keep every scrolling box that holds it, not only the old inner pane.
    const scrollers: Element[] = [];
    for (let node: Element | null = root; node; node = node.parentElement) if (node.scrollHeight > node.clientHeight) scrollers.push(node);
    if (document.scrollingElement && !scrollers.includes(document.scrollingElement)) scrollers.push(document.scrollingElement);
    const kept = scrollers.map(node => [node, node.scrollTop] as const);
    const scroll = root.querySelector(".album-wizard .scroll")?.scrollTop ?? 0;
    hooks.render();
    for (const [key, open] of folds) { const node = root.querySelector<HTMLDetailsElement>(`[data-wiz-fold="${CSS.escape(key)}"]`); if (node) node.open = open; }
    const pane = root.querySelector(".album-wizard .scroll"); if (pane) pane.scrollTop = scroll;
    for (const [node, top] of kept) if (node.isConnected && node.scrollTop !== top) node.scrollTop = top;
    const next = id ? root.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`) : key ? root.querySelector<HTMLInputElement>(`[data-wiz-action="${key}"][data-value="${CSS.escape(value ?? "")}"]`) : null;
    next?.focus({ preventScroll: true });
    if (next?.type === "text" && selection != null) next.setSelectionRange(selection, selection);
  };
  const clear = () => { Object.values(s.portraitUrls ?? {}).forEach(URL.revokeObjectURL); s.portraitUrls = {}; s.chats = []; html = ""; portraits?.clear(); generation++; active = false; createdDraft = undefined; };
  const loadPortraits = async (m: NonNullable<AlbumWizardState["chats"][number]["materials"]>) => {
    Object.values(s.portraitUrls ?? {}).forEach(URL.revokeObjectURL); s.portraitUrls = {};
    if (!hooks.host) return;
    const current = generation, chatId = m.chat.id;
    let changed = false;
    const sources = await portraits!.read({ chatId: m.chat.id, characterId: m.chat.characterId, personaName: m.chat.personaName });
    await Promise.all((["me", "partner"] as const).map(async role => {
      try {
        const bytes = await readRisuPersonImage(role, hooks.host!, sources);
        const image = await downscaleImage(new Blob([new Uint8Array(bytes)]));
        if (current !== generation || s.chatId !== chatId) return;
        const name = role === "me" ? m.chat.personaName : (m.defaultPair?.partner ?? m.chat.characterName);
        (s.portraitUrls ??= {})[name] = URL.createObjectURL(new Blob([image.bytes as BlobPart], { type: image.mime }));
        changed = true;
      } catch { /* An unreadable source-chat portrait keeps the name initial. */ }
    }));
    return changed;
  };
  const selectChat = async (id: string) => {
    const chat = s.chats.find(c => c.id === id); if (!chat) return;
    const current = ++generation;
    s.chatId = id; s.loading = true; s.error = ""; repaint();
    // Retain only the selected chat's bodies for this wizard lifetime.
    for (const other of s.chats) if (other !== chat) delete other.materials;
    try {
      const materials = chat.materials ?? await api.materials(id);
      if (current !== generation) return;
      chat.materials = materials; s.choices = initialAlbumChoices(materials); s.theme = "book";
      void loadPortraits(materials).then(changed => { if (changed && current === generation) repaint(); });
      return true;
    } catch { if (current === generation) s.error = "채팅의 기억을 불러오지 못했어요."; }
    finally { if (current === generation) { s.loading = false; repaint(); } }
  };
  const open = async (chatId?: string, step = 1) => {
    clear(); active = true;
    s = { step: 1, chats: [], chatId: chatId ?? hooks.currentChatId() ?? "", choices: {}, theme: "book", loading: true, busy: false, error: "", sheet: false };
    const current = ++generation; repaint();
    try {
      const list = await api.chats();
      if (current !== generation) return;
      s.chats = list.items.map(summary => ({ id: summary.chat.id, summary }))
        .sort((a, b) => Number(b.id === hooks.currentChatId()) - Number(a.id === hooks.currentChatId()));
      if (!s.chats.some(c => c.id === s.chatId)) s.chatId = s.chats[0]?.id ?? "";
      s.loading = false; repaint();
      // Deep-linked previews/entry points can still open a later step.
      if (step > 1 && s.chatId && await selectChat(s.chatId)) { s.step = Math.min(albumWizardSteps(s).length, step); repaint(); }
    } catch { if (current === generation) s.error = "채팅을 불러오지 못했어요."; }
    finally { if (current === generation) { s.loading = false; repaint(); } }
  };
  const submit = async () => {
    if (!active || s.loading || s.busy) return;
    if (s.step === 1 && !s.chats.find(c => c.id === s.chatId)?.materials) {
      s.step = 2;
      if (!await selectChat(s.chatId) && active) { s.step = 1; repaint(); }
      return;
    }
    if (!active || s.loading || s.error) return;
    const m = s.chats.find(c => c.id === s.chatId)?.materials; if (!m) return;
    if (s.step < albumWizardSteps(s).length) { s.step++; repaint(); root.querySelector<HTMLElement>(".pane h2")?.focus(); return; }
    s.busy = true; s.error = ""; repaint(); const current = generation;
    try {
      const draft = buildAlbumDraft(m, { id: createdDraft?.id ?? crypto.randomUUID(), theme: s.theme, choices: s.choices });
      if (!createdDraft) {
        const empty = structuredClone(draft);
        const strip = (items: AlbumDocument["blocks"][number]["items"]) => items.forEach(i => { i.photos = []; strip(i.children ?? []); });
        empty.blocks.forEach(b => strip(b.items));
        createdDraft = await api.create(empty);
      }
      const created = createdDraft;
      const imported = await importDraftInlays(draft, hooks.host ?? {}, api, m);
      const saved = await api.save(created.id, imported, created.revision); created.revision = saved.revision;
      imported.revision = saved.revision;
      if (hooks.host) await importDefaultAlbumPortraits(imported, api, hooks.host, portraits!.read(imported.source));
      created.revision = imported.revision;
      if (current === generation) { clear(); await hooks.openAlbumView(created.id); }
    } catch { if (current === generation) s.error = "앨범을 만들지 못했어요. 선택은 그대로 남아 있어요."; }
    finally { if (current === generation) { s.busy = false; repaint(); } }
  };
  const choosePair = async (pair: AlbumPair) => {
    const chat = s.chats.find(c => c.id === s.chatId); if (!chat) return;
    const current = ++generation; s.loading = true; s.error = ""; repaint();
    try {
      const materials = await api.materials(chat.id, pair);
      if (current !== generation) return;
      chat.materials = materials; s.choices = initialAlbumChoices(materials); s.theme = "book";
    } catch { if (current === generation) s.error = "두 사람의 기억을 불러오지 못했어요. 다시 골라 주세요."; }
    finally { if (current === generation) { s.loading = false; repaint(); } }
  };
  const change = (node: HTMLInputElement) => {
    const name = node.dataset.wizAction, value = node.dataset.value ?? "";
    if (!active || s.busy) return;
    if (name === "pair") { const pair = s.chats.find(c => c.id === s.chatId)?.materials?.pairs?.[Number(value)]; if (pair) void choosePair(pair); return; }
    if (name === "chat") { void selectChat(value); return; }
    if (name === "theme" && ALBUM_THEMES.includes(value as AlbumTheme)) { s.theme = value as AlbumTheme; s.choices.tint = resolveAlbumTint(s.theme); }
    if (name === "tint") s.choices.tint = resolveAlbumTint(s.theme, value);
    if (name === "scene") (s.choices.scenePicks ??= {})[value] = node.checked;
    if (name === "quote") {
      const sceneId = node.dataset.scene!;
      const scene = s.chats.find(c => c.id === s.chatId)?.materials?.blocks.story.flatMap(ch => ch.children ?? []).find(i => i.id === sceneId);
      if (!scene) return;
      const ids = new Set(s.choices.quotePicks?.[sceneId] ?? recommendedAlbumQuotes(scene.children ?? []).slice(0, 1).map(q => q.id));
      if (node.checked) ids.add(value); else ids.delete(value);
      (s.choices.quotePicks ??= {})[sceneId] = [...ids];
    }
    repaint();
  };
  root.addEventListener("change", e => { const node = e.target as HTMLInputElement; if (node.matches(".album-wizard input[data-wiz-action]")) change(node); });
  root.addEventListener("input", e => { const node = e.target as HTMLInputElement; if (node.id === "wizard-title" && !s.busy) { s.choices.title = node.value; repaint(); } });
  root.addEventListener("click", e => {
    const node = (e.target as HTMLElement).closest<HTMLElement>("[data-wiz-action]"); if (!node || node.tagName === "INPUT") return;
    const name = node.dataset.wizAction, value = node.dataset.value ?? "";
    if (s.busy && name !== "peek") return;
    if (name === "close") { clear(); hooks.closed(); return; }
    if (name === "retry") { if (s.step === albumWizardSteps(s).length && s.chats.length) void submit(); else void open(s.chatId); return; }
    if (name === "step") s.step = Math.max(1, Math.min(s.step, Number(value)));
    if (name === "per") s.choices.perChapter = Math.max(1, Math.min(5, (s.choices.perChapter ?? 2) + Number(value)));
    if (name === "block") { const set = new Set(s.choices.blocks); if (set.has(value as AlbumBlockKind)) set.delete(value as AlbumBlockKind); else set.add(value as AlbumBlockKind); s.choices.blocks = [...set]; }
    if (name === "reset") { s.choices.scenePicks = {}; s.choices.quotePicks = {}; }
    if (name === "peek") s.sheet = !s.sheet;
    repaint();
    if (s.sheet) root.querySelector<HTMLElement>(".wizard-sheet button")?.focus();
  });
  root.addEventListener("keydown", e => {
    if (!(e.target as HTMLElement).closest(".album-wizard")) return;
    if (e.key === "Enter" && (e.target as HTMLElement).id === "wizard-title") { e.preventDefault(); root.querySelector<HTMLFormElement>("#album-wizard-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
    if (e.key === "Escape" && s.sheet) { s.sheet = false; repaint(); root.querySelector<HTMLElement>(".peekbtn")?.focus(); }
    if (e.key === "Tab" && s.sheet) {
      const nodes = [...root.querySelectorAll<HTMLElement>(".wizard-sheet button,.wizard-sheet summary")];
      const first = nodes[0], last = nodes.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });
  window.addEventListener("pagehide", clear, { once: true });
  return { open, submit, clear, get active() { return active; }, render: () => {
    const key = `${hooks.skin()}:${hooks.currentChatId() ?? ""}`;
    if (!html || key !== renderKey) { renderKey = key; html = renderAlbumWizard(s, { skin: hooks.skin(), currentChatId: hooks.currentChatId() }); }
    return html;
  } };
}
