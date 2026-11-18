import { ALBUM_THEMES, ALBUM_TINTS, albumPairKey, albumPairFromPeople, albumCoverQuote, albumLine, albumDateFormat, buildAlbumDraft, defaultBlockEnabled, resolveAlbumTint, type AlbumBlockKind, type AlbumDocument, type AlbumDraftChoices, type AlbumMaterials, type AlbumTheme } from "@rcm/shared";
import { renderAlbumScenePicker } from "./album-scene-picker.js";
import { ALBUM_TINT_SWATCHES } from "../album/themes/index.js";
import { renderAlbumMiniCover } from "./album-shelf.js";
import { escapeHtml as esc, icon } from "./film/ui.js";
import type { AlbumChatSummary } from "@rcm/shared";

export type WizardChat = { id: string; summary: AlbumChatSummary; materials?: AlbumMaterials };
export interface AlbumWizardState {
  portraitUrls?: Record<string, string>;
  step: number; chatId: string; chats: WizardChat[]; choices: AlbumDraftChoices;
  theme: AlbumTheme; loading: boolean; busy: boolean; error: string; sheet: boolean;
}
export function albumWizardSteps(s: AlbumWizardState): string[] {
  const m = s.chats.find(c => c.id === s.chatId)?.materials;
  return (m?.pairs?.length ?? 0) > 1 ? ["채팅", "두 사람", "블록", "장면", "테마"] : ["채팅", "블록", "장면", "테마"];
}
export const WIZARD_BLOCKS: AlbumBlockKind[] = ["cover", "intro", "together", "story", "firsts", "quotes", "promises", "bond", "hearts", "progress", "gallery", "intimacy"];
const labels: Record<string, [string, string]> = {
  cover: ["표지", "제목과 기간"], intro: ["두 사람", "이름, 첫 등장, 부르는 말"], story: ["장면", "장마다 고른 장면과 대사. 다음 단계에서 골라요"],
  together: ["함께한 시간", "처음 대화한 날과 함께 나눈 이야기"],
  firsts: ["처음", "처음 만난 날, 고백한 날 같은 첫 순간"], quotes: ["대사", "짧은 대사부터 골라 둬요"], promises: ["약속", "지킨 약속과 남은 약속"],
  bond: ["관계", "마음의 흐름과 크게 바뀐 순간"], hearts: ["서로에게", "서로를 어떻게 보는지"], progress: ["함께한 걸음", "두 사람이 함께 지나온 단계"],
  gallery: ["사진", "삽화와 올린 사진"], intimacy: ["가까워진 순간", "스킨십의 처음 기록. 필요할 때만 켜요"],
};
const themes = { book: ["한 권의 책", "천으로 싼 양장본에 담은 이야기"], program: ["프로그램북", "장마다 색이 바뀌는 공연 프로그램"], lp: ["가요 LP", "재킷 색 위에 장마다 한 곡씩 담은 음반"], film: ["갱지", "오래된 소책자처럼 거친 종이에 찍은 이야기"] };
export const ALBUM_TINT_LABELS: Record<string, string> = { plum: "자두", ink: "먹", pine: "솔잎", navy: "남색", brick: "벽돌", primary: "원색", sea: "바다", dusk: "노을", forest: "숲", mustard: "겨자", tomato: "토마토", sky: "하늘", pink: "분홍", black: "검정", seal: "인주", grass: "풀빛", gray: "회색", kraft: "크라프트" };
export function albumMaterialPhotoCount(m: AlbumMaterials): number {
  const ids = new Set<string>();
  const walk = (items: AlbumMaterials["blocks"]["story"]) => items.forEach(i => { i.photos.forEach(p => ids.add(p.photoId)); i.inlayIds?.forEach(id => ids.add(id)); walk(i.children ?? []); });
  Object.values(m.blocks).forEach(walk); return ids.size;
}
export function initialAlbumChoices(m: AlbumMaterials): AlbumDraftChoices {
  return { blocks: WIZARD_BLOCKS.filter(k => defaultBlockEnabled(k) && (k !== "gallery" || albumMaterialPhotoCount(m) > 0)), perChapter: 2, scenePicks: {}, quotePicks: {}, title: `${m.people.me.name} & ${m.people.partner.name}`, tint: resolveAlbumTint("book") };
}
export function wizardDraft(s: AlbumWizardState): AlbumDocument | undefined {
  const m = s.chats.find(c => c.id === s.chatId)?.materials;
  return m ? buildAlbumDraft(m, { id: "wizard-preview", theme: s.theme, choices: s.choices }) : undefined;
}
const action = (name: string, value = "") => `data-wiz-action="${name}" data-value="${esc(value)}"`;
const button = (text: string, name: string, value = "", cls = "btn btn--ghost", disabled = false) => `<button type="button" class="${cls}"${cls.startsWith("x ") ? ` aria-label="${name === "close" ? "닫기" : "이전"}"` : name === "per" ? ` aria-label="${value === "1" ? "하나 늘리기" : "하나 줄이기"}"` : ""} ${action(name, value)}${disabled ? " disabled" : ""}>${text}</button>`;

export function renderAlbumWizard(s: AlbumWizardState, options: { skin: "film" | "phone"; currentChatId?: string }): string {
  const m = s.chats.find(c => c.id === s.chatId)?.materials, draft = wizardDraft(s);
  const steps = albumWizardSteps(s), stage = steps[s.step - 1];
  // Nothing is counted before a chat (and pair) is chosen, so the running totals start at the block step.
  const counting = stage !== "채팅" && stage !== "두 사람";
  const scenes = draft?.blocks.filter(b => b.kind === "story").flatMap(b => b.items.flatMap(ch => ch.children ?? [])) ?? [];
  const totals = `블록 <b>${draft?.blocks.length ?? 0}</b> · 장면 <b>${scenes.length}</b> · 대사 <b>${scenes.reduce((n, scene) => n + (scene.children?.length ?? 0), 0)}</b>`;
  const photos = m ? albumMaterialPhotoCount(m) : 0;
  const coverQuote = draft && albumCoverQuote(draft);
  const enabled = (k: AlbumBlockKind) => s.choices.blocks?.includes(k) ?? false;
  const count = (k: AlbumBlockKind) => !m ? "" : k === "cover" || k === "together" ? "" : k === "intro" ? "2명" : k === "story" ? `${m.counts.chapters}장 · 장면 ${m.counts.scenes}` : k === "gallery" ? photos ? `${photos}장` : "" : k === "bond" ? `전환점 ${m.blocks.bond.length}` : k === "quotes" ? `${m.blocks.quotes.length}줄` : `${m.blocks[k].length}개`;
  const mini = (theme = s.theme) => renderAlbumMiniCover({ id: "wizard", coverPhotoId: null, title: s.choices.title ?? "", theme, tint: theme === s.theme ? s.choices.tint : undefined, names: m ? [m.people.me.name, m.people.partner.name] : [], chapterCount: draft?.blocks.filter(b => b.kind === "story").reduce((n, b) => n + b.items.length, 0) ?? 0, sceneCount: scenes.length, promiseCount: draft?.blocks.find(b => b.kind === "promises")?.items.length ?? 0, coverQuote: coverQuote ? albumLine(coverQuote) : "" });
  const peek = () => `<aside class="peek"><h3>미리 보기</h3><div class="cover">${mini()}</div><p class="tot">${totals}</p><ul class="spine">${WIZARD_BLOCKS.filter(k => k !== "cover").map(k => `<li class="${enabled(k) ? "" : "off"}"><span>${labels[k]![0]}</span><span>${enabled(k) ? k === "story" ? `${scenes.length}` : count(k) : "빠짐"}</span></li>`).join("")}</ul></aside>`;
  const face = (name: string) => `<span class="pair-face">${s.portraitUrls?.[name] ? `<img src="${esc(s.portraitUrls[name]!)}" alt="">` : esc([...name][0] ?? "")}</span>`;
  const pairChoices = () => `<h2 tabindex="-1">누구와의 추억인가요?</h2><p class="lead">이 채팅에는 함께한 기록이 있는 두 사람이 여럿 있어요.<br>한 쌍을 고르면 그 둘의 관계와 부르는 말로 앨범을 만들어요.</p><div class="pair-chosen"><span class="mono">${esc([...m!.chat.title][0] ?? "")}</span><span><b>${esc(m!.chat.title)}</b> · 장면 ${m!.counts.scenes}</span>${button("바꾸기", "step", "1", "pair-change")}</div><div class="list pair-list" role="radiogroup" aria-label="두 사람">${m!.pairs!.map((pair, n) => `<label class="chat pair${albumPairKey(pair) === albumPairKey(albumPairFromPeople(m!.people)) ? " sel" : ""}"><span class="pair-faces">${face(pair.me)}${face(pair.partner)}</span><span class="pair-copy"><b>${esc(pair.me)} &amp; ${esc(pair.partner)}${pair.hasPersona ? '<span class="pair-me">나</span>' : ""}</b><small>함께한 장면 ${pair.sharedSceneCount} · 관계 기록 ${pair.relationshipEventCount}</small></span><input class="radio" type="radio" name="wizard-pair" ${action("pair", String(n))}${albumPairKey(pair) === albumPairKey(albumPairFromPeople(m!.people)) ? " checked" : ""}></label>`).join("")}</div>${m!.hiddenPairCount ? `<p class="pair-hidden">관계 기록이 없는 ${m!.hiddenPairCount}쌍은 숨겼어요.</p>` : ""}`;
  const body = () => {
    if (s.loading) return '<p role="status">채팅 불러오는 중…</p>';
    if (stage === "채팅") return `<h2 tabindex="-1">어떤 이야기로 만들까요?</h2><p class="lead">기억이 쌓인 채팅만 보여요. 지금 열린 채팅이 맨 위에 있어요.</p><div class="list" role="radiogroup" aria-label="채팅">${s.chats.map(({ id, summary: c }) => `<label class="chat${id === s.chatId ? " sel" : ""}"><span class="mono">${esc([...c.people.me.name][0] ?? "")}</span><b>${esc(c.chat.title)}${id === options.currentChatId ? '<span class="pill"><i></i>지금 열린 채팅</span>' : ""}</b><input class="radio" type="radio" name="wizard-chat" value="${esc(id)}" ${action("chat", id)}${id === s.chatId ? " checked" : ""}><small>${esc(c.people.me.name)} · ${esc(c.people.partner.name)} · ${esc(albumDateFormat([c.period.from, c.period.to].filter(Boolean).join(" — ")).header)} · 장면 ${c.counts.scenes}</small></label>`).join("")}</div>${s.chats.length ? "" : '<p class="hint">기억이 쌓인 채팅이 아직 없어요.</p>'}`;
    if (!m) return "";
    if (stage === "두 사람") return pairChoices();
    if (stage === "블록") return `<h2 tabindex="-1">무엇을 담을까요?</h2><p class="lead">숫자는 지금 이 채팅에서 모을 수 있는 양이에요. 나중에 꾸미기에서 언제든 넣고 뺄 수 있어요.</p>${[["기본 구성", WIZARD_BLOCKS.slice(0, 4)], ["이야기에서 모은 것", WIZARD_BLOCKS.slice(4, -1)], ["기본으로 꺼 둔 것", ["intimacy"]]] .map(([group, kinds]) => `<p class="group-h">${group}</p><div class="list">${(kinds as AlbumBlockKind[]).map(k => `<div class="blk${enabled(k) ? "" : " off"}"><b>${labels[k]![0]}</b><span class="n">${count(k)}</span>${k === "cover" ? '<span class="block-lock">항상</span>' : `<button type="button" class="sw" role="switch" aria-label="${labels[k]![0]}" aria-checked="${enabled(k)}" ${action("block", k)}${k === "gallery" && !photos || k === "intimacy" && !m.blocks.intimacy.length ? " disabled" : ""}></button>`}<p>${k === "gallery" && !photos ? "이 채팅엔 사진이 아직 없어요. 꾸미기에서 넣을 수 있어요" : labels[k]![1]}</p></div>`).join("")}</div>`).join("")}`;
    if (stage === "장면") {
      return `<h2 tabindex="-1">어떤 장면을 넣을까요?</h2><p class="lead">장마다 넣을 수를 정하면 먼저 골라 둬요. 직접 넣고 뺀 건 그대로 지켜요.</p><div class="per"><label for="wizard-per">장마다</label><span class="step">${button("−", "per", "-1", "", s.choices.perChapter === 1)}<output id="wizard-per">${s.choices.perChapter}</output>${button("+", "per", "1", "", s.choices.perChapter === 5)}</span><span>장면씩</span>${button("추천대로 되돌리기", "reset", "", "reset")}</div>${renderAlbumScenePicker(m.blocks.story, s.choices, draft?.periodLabel)}`;
    }
    return `<h2 tabindex="-1">어떤 모양으로 볼까요?</h2><p class="lead">테마는 만든 뒤에도 바꿀 수 있어요. 내용은 그대로 두고 모양만 바뀌어요.</p><div class="themes" role="radiogroup" aria-label="테마">${ALBUM_THEMES.map(theme => `<label class="th${theme === s.theme ? " sel" : ""}"><input type="radio" name="wizard-theme" class="sr-only" ${action("theme", theme)}${s.theme === theme ? " checked" : ""}><span class="mcw">${mini(theme)}</span><b>${themes[theme][0]}${theme === "book" ? '<span class="def">기본</span>' : ""}</b><small>${themes[theme][1]}</small></label>`).join("")}</div>${ALBUM_TINTS[s.theme].length ? `<div class="tints" role="radiogroup" aria-label="색"><span>색</span>${ALBUM_TINTS[s.theme].map(id => `<label class="tint${resolveAlbumTint(s.theme, s.choices.tint) === id ? " sel" : ""}" style="--swatch:${ALBUM_TINT_SWATCHES[s.theme][id]}"><input type="radio" name="wizard-tint" class="sr-only" aria-label="${ALBUM_TINT_LABELS[id]}" ${action("tint", id)}${resolveAlbumTint(s.theme, s.choices.tint) === id ? " checked" : ""}></label>`).join("")}</div>` : ""}<div class="field"><label for="wizard-title">앨범 제목</label><input id="wizard-title" name="title" maxlength="20000" value="${esc(s.choices.title ?? "")}"><small>표지와 책장에 보여요.</small></div>`;
  };
  return `<section class="album-wizard" data-skin="${options.skin}" aria-busy="${s.busy}"><form id="album-wizard-form" class="wizard-main"${s.sheet ? " inert" : ""}><div><div class="whead">${button(icon("close"), "close", "", "x desktop-close")}${button(s.step > 1 ? icon("back") : icon("close"), s.step > 1 ? "step" : "close", String(s.step - 1), "x phone-back")}<b>앨범 만들기</b></div><nav class="strip" style="grid-template-columns:repeat(${steps.length},minmax(0,1fr))" aria-label="단계">${steps.map((label, i) => button(`<i></i><span>${label}</span>`, "step", String(i + 1), s.step === i + 1 ? "on" : i + 1 < s.step ? "done" : "", i + 1 >= s.step)).join("")}</nav></div><div class="scroll"><div class="body body--B${stage === "두 사람" ? " body--pair" : ""}"><section class="pane">${s.error ? `<p role="alert">${esc(s.error)} ${button("다시 시도", "retry")}</p>` : ""}${body()}</section>${peek()}</div></div><footer class="foot b">${s.step > 1 ? button("이전", "step", String(s.step - 1), "btn btn--ghost previous") : ""}${counting ? `<span class="sum">${totals}</span>${button("미리 보기", "peek", "", "peekbtn")}` : ""}<button type="button" class="btn btn--go" data-action="submit-form" data-form-id="album-wizard-form"${(!m && (s.step !== 1 || !s.chatId)) || s.busy || s.loading ? " disabled" : ""}>${s.busy ? "만드는 중…" : s.step === steps.length ? "만들기" : "다음"}</button></footer></form>${s.sheet ? `<div class="wizard-sheet" role="dialog" aria-modal="true" aria-label="미리 보기">${button("닫기", "peek")}${peek()}</div>` : ""}</section>`;
}
