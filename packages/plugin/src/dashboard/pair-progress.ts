import type { PairProgress, PairProgressItem, PairProgressUnavailableReason } from "@rcm/shared";
import { btn, escapeHtml, fold, icon, menu } from "./film/ui.js";
import { sceneNumbers } from "./scenes.js";

export function renderProgress(pair: PairProgress | undefined, memories: any[], reason?: PairProgressUnavailableReason): string {
  if (!pair) {
    const messages: Record<PairProgressUnavailableReason, string> = {
      persona_missing: "페르소나를 찾지 못했어요. 인물 메뉴에서 ‘페르소나로 지정’을 선택해 주세요.",
      persona_ambiguous: "페르소나 이름과 맞는 인물이 여럿이에요. 인물 메뉴에서 ‘페르소나로 지정’해 주세요.",
      not_primary_character: "진도는 페르소나와 주요 인물 사이에만 표시해요.",
    };
    // Pairs outside persona ↔ primary simply have no checklist; only a broken persona link earns a line.
    return reason && reason !== "not_primary_character" ? `<p class="psec hint">${messages[reason]}</p>` : "";
  }
  const items = pair.items.filter(item => !item.hidden);
  const hidden = pair.items.filter(item => item.hidden);
  const pending = items.filter(item => item.cells.some(cell => cell.state !== "done"));
  const done = items.filter(item => item.cells.every(cell => cell.state === "done"));
  const cells = items.flatMap(item => item.cells);
  const count = cells.filter(cell => cell.state === "not_yet").length;
  const hasUnknown = pair.items.some(item => item.cells.some(cell => cell.state === "unknown"));
  const data = { persona: pair.persona, character: pair.character };
  const numbers = sceneNumbers(memories);
  const row = (item: PairProgressItem) => {
    // Show the shared unknown state once when neither side has been confirmed.
    const allUnknown = item.cells.every(cell => cell.state === "unknown");
    const sources = allUnknown ? ["확인 전"] : item.cells.filter(cell => cell.state !== "not_yet").map(cell => {
      const side = item.mode === "each" ? `${escapeHtml(cell.side)}의 · ` : "";
      if (cell.state === "unknown") return `${side}확인 전`;
      if (cell.source === "user") return `${side}직접 체크`;
      if (cell.source === "setup") return `${side}처음 설정`;
      const memory = memories.find(candidate => candidate.id === cell.memoryId);
      return memory
        ? `${side}<button type="button" class="prog__source" data-action="open-timeline-memory" data-memory-id="${escapeHtml(memory.id)}">S#${numbers.get(String(memory.id)) ?? "?"} 「${escapeHtml(memory.title)}」</button>`
        : `${side}장면 기록`;
    });
    const tick = (side: string) => {
      const cell = item.cells.find(candidate => candidate.side === side)!;
      const on = cell.state === "done";
      const label = side === "mutual" ? `${pair.persona}와 ${pair.character} 서로` : `${side}의`;
      return `<button type="button" class="prog__tick${cell.state === "unknown" ? " is-unknown" : ""}" aria-pressed="${on}" aria-label="${escapeHtml(label)} ${escapeHtml(item.label)} · ${on ? "아직으로 되돌리기" : "했음으로 바꾸기"}" data-action="progress-cell" data-persona="${escapeHtml(pair.persona)}" data-character="${escapeHtml(pair.character)}" data-item-id="${escapeHtml(item.id)}" data-side="${escapeHtml(side)}" data-state="${on ? "not_yet" : "done"}"><span>${on ? icon("check") : ""}</span></button>`;
    };
    const subtitle = sources.length ? sources.join("<br>") : item.custom ? "직접 추가" : "기본 항목";
    const ticks = item.mode === "mutual" ? `<span class="prog__both">${tick("mutual")}</span>` : tick(pair.persona) + tick(pair.character);
    const rowMenu = menu({ label: `${item.label} 메뉴`, items: [{
      label: item.custom ? "삭제" : "숨기기", icon: item.custom ? "delete" : "eye",
      action: item.custom ? "progress-remove" : "progress-hide", data: { ...data, itemId: item.id }, danger: item.custom,
    }] });
    return `<div class="prog__row"><span class="prog__tx"><span class="prog__t">${escapeHtml(item.label)}</span><span class="prog__s">${subtitle}</span></span>${ticks}${rowMenu}</div>`;
  };
  const form = `<details class="prog__add" data-preserve-open="progress-add"><summary class="btn btn--quiet hit">${icon("add")}추가</summary><form id="pair-progress-form" class="form" data-persona="${escapeHtml(pair.persona)}" data-character="${escapeHtml(pair.character)}"><label class="field"><span>진도 이름</span><input class="input" name="label" maxlength="120" required placeholder="예: 처음 손잡기"></label><p class="hint prog__hint">이름 그대로 메인 모델에게 전해지고, 보조 모델이 장면을 보고 체크해요.</p><fieldset class="anniversary-kind"><legend class="label">방식</legend><div class="seg"><label><input type="radio" name="mode" value="each" checked><span>각자</span></label><label><input type="radio" name="mode" value="mutual"><span>서로</span></label></div></fieldset><div class="form__bar">${btn("추가", { kind: "primary", action: "submit-form", data: { formId: "pair-progress-form" } })}</div></form></details>`;
  const restore = hidden.length ? fold("숨긴 항목", hidden.map(item => `<div class="prog__restore"><span>${escapeHtml(item.label)}</span>${btn("복원", { kind: "quiet", action: "progress-restore", data: { ...data, itemId: item.id } })}</div>`).join(""), { count: hidden.length }) : "";
  const columns = items.length ? `<div class="prog__cols"><span></span><span>${escapeHtml(pair.persona)}의</span><span>${escapeHtml(pair.character)}의</span><span></span></div>` : "";
  const completed = done.length ? `<details class="prog__fold" open data-preserve-open="progress-done"><summary>모두 했음 <span class="n">${done.length}</span></summary>${done.map(row).join("")}</details>` : "";
  const confirm = hasUnknown ? `<div class="prog__actions">${btn("나머지는 아직", { kind: "quiet", action: "progress-remaining_not_yet", data })}</div>` : "";
  const card = `<div class="prog__card">${items.length ? `${columns}${pending.map(row).join("")}${completed}` : '<p class="sub">표시할 항목이 없어요.</p>'}${confirm}</div>`;
  const body = `<div class="sec-head"><h2 class="sec">두 사람의 진도 <span class="n">${!count && hasUnknown ? "확인 전" : `아직 ${count}`}</span></h2>${form}</div>${card}${restore}`;
  return `<section class="psec prog">${items.length > 0 && !pending.length ? fold("두 사람의 진도 · 모두 했음", body, { role: "section" }) : body}</section>`;
}
