import { avatar, btn, escapeHtml, field, fold, icon } from "./film/ui.js";
import { SOCIAL_KNOWLEDGE_LEVEL_LABELS } from "./person.js";
import { resolveSourceQuote } from "@rcm/shared";

const KIND = {
  dialogue: { title: "이 대사를 남길까요?", subject: "대사", icon: "quote" },
  passage: { title: "이 발췌를 남길까요?", subject: "발췌", icon: "quote" },
  recognition: { icon: "eye" },
} as const;

type SmallKind = keyof typeof KIND;
const kindOf = (item: any): SmallKind => item?.kind === "recognition" ? "recognition" : item?.kind === "passage" ? "passage" : "dialogue";

/** Presentation only: use the product's exact quote rules, never infer support. */
function highlightedQuote(text: string, evidence: Array<{ quote: string }>, sourceMatches?: { segments: Array<{ textStart: number; textEnd: number }> }): { html: string; matched: boolean } {
  const ranges: Array<[number, number]> = sourceMatches?.segments.map(segment => [segment.textStart, segment.textEnd]) ?? [];
  for (const { quote } of sourceMatches ? [] : evidence) {
    if (resolveSourceQuote(quote, text)) return { html: `<mark class="review-small__match">${escapeHtml(text)}</mark>`, matched: true };
    const span = resolveSourceQuote(text, quote);
    if (span) {
      const start = text.indexOf(span);
      ranges.push([start, start + span.length]);
    }
  }
  const merged: Array<[number, number]> = [];
  for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  if (!merged.length) return { html: escapeHtml(text), matched: false };
  let cursor = 0;
  let html = "";
  for (const [start, end] of merged) {
    if (start > cursor) html += `<span class="review-small__unmatched">${escapeHtml(text.slice(cursor, start))}</span>`;
    html += `<mark class="review-small__match">${escapeHtml(text.slice(start, end))}</mark>`;
    cursor = end;
  }
  if (cursor < text.length) html += `<span class="review-small__unmatched">${escapeHtml(text.slice(cursor))}</span>`;
  return { html, matched: true };
}

/** The list row's leading mark: a quote for dialogue and passages, an eye for who-knows-what. */
export function smallReviewMark(item: any): string {
  const kind = kindOf(item);
  return `<span class="review-small__mark review-small__mark--${kind}" aria-hidden="true">${icon(KIND[kind].icon)}</span>`;
}

export function smallReviewDetail(item: any, back: string): string {
  const kind = kindOf(item);
  const data = { auditId: String(item.auditId), id: String(item.id) };
  const quotes = (item.verifiedEvidence ?? []).map((e: any) => `<p class="review-small__source">${escapeHtml(e.quote)}</p>`).join("");
  if (kind === "recognition") {
    const level = item.level === "interacted" ? SOCIAL_KNOWLEDGE_LEVEL_LABELS.interacted
      : item.level === "aware_of" ? SOCIAL_KNOWLEDGE_LEVEL_LABELS.aware_of : "";
    const names = (label: string, values: string[] = []) => values.length
      ? `<dt>${label}</dt><dd>${values.map(value => `<span>${escapeHtml(value)}</span>`).join("")}</dd>` : "";
    const rows = names("아는 이름", item.knownAs) + names("부르는 말", item.addressTerms)
      + (item.canKeep ? `<dt>설명</dt><dd>${escapeHtml(item.text ?? "")}</dd>` : "");
    const source = quotes ? fold("원문 보기", quotes, {count: item.verifiedEvidence.length, role: "section", className: "fold--source",
      preserveKey: `small-review-source:${data.auditId}:${data.id}`}) : "";
    const keep = item.canKeep ? btn("남기기", {kind: "primary", action: "resolve-small-review", data: {...data, resolution: "keep"}})
      : item.canKeepNames ? btn("이름만 남기기", {kind: "primary", action: "resolve-small-review", data: {...data, resolution: "keep_names"}}) : "";
    return `<article class="reader review-small">${back}
      <h2 class="reader__title">${item.canKeep ? "이 인식을 남길까요?" : "이 이름을 남길까요?"}</h2>
      <p class="review-small__why">${item.canKeep ? "세부 기억과 원문을 확인했어요. 남기면 설명과 이름을 함께 전달해요." : "설명의 근거는 확인하지 못했어요. 이름과 호칭은 남길 수 있어요."}</p>
      <div class="review-small__card"><div class="review-small__pair">${avatar(String(item.holder ?? ""), "sm")}<span>${escapeHtml(item.holder ?? "")}</span><i>→</i>${avatar(String(item.subject ?? ""), "sm")}<span>${escapeHtml(item.subject ?? "")}</span></div>
        ${level ? `<p class="review-small__level">${level}</p>` : ""}${rows ? `<dl class="review-small__names">${rows}</dl>` : ""}</div>
      ${source}
      <div class="review-small__acts">${btn("빼기", {kind: "danger", action: "resolve-small-review", data: {...data, resolution: "discard"}})}${keep}</div>
      <p class="review-small__note">고르기 전까지는 모델에 전달되지 않아요. 기억은 이미 저장돼 있어요.</p>
      </article>`;
  }
  if (kind === 'dialogue' && item.sourceChoices?.length > 1) {
    const choices = item.sourceChoices.map((choice: any, index: number) => `<label class="review-small__choice">
      <span class="review-small__choice-head"><input type="radio" name="small-review-source" value="${escapeHtml(choice.id)}" data-action="choose-small-review-source"><b>원문 ${index + 1}</b></span>
      <span class="review-small__choice-context">${escapeHtml(choice.before)}<mark class="review-small__match">${escapeHtml(choice.text)}</mark>${escapeHtml(choice.after)}</span></label>`).join('');
    return `<article class="reader review-small">${back}<h2 class="reader__title">이 대사의 원문을 골라 주세요</h2>
      <p class="review-small__why">같은 대사가 여러 곳에 있어요. ${item.speaker ? '아래 화자의 말에 해당하는' : '남길'} 원문을 골라 주세요.</p>
      ${item.speaker ? `<div class="review-small__speaker">${avatar(String(item.speaker), 'sm')}<b>${escapeHtml(item.speaker)}</b><span class="review-small__speaker-hint">보조모델이 고른 화자</span></div>` : ''}
      <div class="review-small__choices" role="radiogroup" aria-label="대사의 원문">${choices}</div>
      <div class="review-small__acts">${btn('빼기', {kind:'danger',action:'resolve-small-review',data:{...data,resolution:'discard'}})}
      ${btn('나중에', {kind:'secondary',action:'resolve-small-review',data:{...data,resolution:'hold'}})}
      ${btn('선택한 원문으로 남기기', {kind:'primary',action:'resolve-small-review',disabled:true,data:{...data,resolution:'keep_as_written',sourceSelection:'true'}})}</div></article>`;
  }
  const meta = KIND[kind];
  const highlighted = highlightedQuote(String(item.text || ""), item.verifiedEvidence ?? [], item.sourceMatches);
  const legend = !item.canKeep && highlighted.matched ? '<div class="review-small__legend"><span><i></i>원문에 있음</span><span><i class="is-missing"></i>원문에서 찾지 못한 조각</span></div>' : "";
  const subject = `<div class="review-small__card">${item.speaker ? `<div class="review-small__speaker">${avatar(String(item.speaker), "sm")}<b>${escapeHtml(item.speaker)}</b></div>` : ""}<span class="review-small__quote${kind === "dialogue" ? " is-bubble" : ""}">${item.canKeep ? escapeHtml(item.text || "") : highlighted.html}</span>${legend}</div>`;
  const source = quotes ? fold("원문 보기", quotes, { count: item.verifiedEvidence.length, role: "section", className: "fold--source",
    preserveKey: `small-review-source:${data.auditId}:${data.id}` }) : "";
  const keep = item.canKeep
    ? btn("남기기", { kind: "primary", action: "resolve-small-review", data: { ...data, resolution: "keep" } })
    : "";
  const editor = !item.canKeep ? `<form id="small-review-form" class="form review-small__editor" data-audit-id="${escapeHtml(data.auditId)}" data-id="${escapeHtml(data.id)}" data-resolution="keep_edited" hidden>
    ${field({ id: "small-review-text", label: meta.subject, control: `<textarea id="small-review-text" class="textarea notranslate" translate="no" name="text" rows="5" aria-describedby="small-review-error" required>${escapeHtml(item.text || "")}</textarea>` })}
    <p id="small-review-error" class="err" data-small-review-error role="status" hidden></p>
    <div class="form__bar">${btn("고쳐서 남기기", { kind: "primary", action: "submit-form", data: { formId: "small-review-form" } })}</div>
    </form>` : "";
  const discard = btn("빼기", { kind: "danger", action: "resolve-small-review", data: { ...data, resolution: "discard" } });
  const actions = item.canKeep ? `${discard}${keep}`
    : `${discard}${btn("고쳐서 남기기", { kind: "secondary", action: "edit-small-review" })}${item.canKeepAsWritten ? btn("그대로 남기기", { kind: "primary", action: "resolve-small-review", data: { ...data, resolution: "keep_as_written" } }) : ""}`;
  return `<article class="reader review-small">${back}
    <h2 class="reader__title">${item.canKeep ? meta.title : `원문과 글자가 조금 다른 ${meta.subject}예요`}</h2>
    <p class="review-small__why">${item.canKeep ? escapeHtml(item.reason) : `보조 모델이 나레이션을 건너뛰고 이었거나 말을 조금 다듬었을 수 있어요. 기억은 저장됐어요.`}</p>
    ${subject}${!item.canKeep && !highlighted.matched ? `<p class="review-small__missing">원문에서 이 ${meta.subject}의 조각을 찾지 못했어요.</p>` : ""}
    ${editor}<div class="review-small__acts">${actions}</div>
    ${source}
    </article>`;
}
