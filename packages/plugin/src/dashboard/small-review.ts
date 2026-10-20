import { avatar, btn, escapeHtml, icon } from "./film/ui.js";

const KIND = {
  dialogue: { label: "대사 출처 확인", title: "이 대사를 남길까요?", what: "기억에 넣을 대사", icon: "quote" },
  passage: { label: "발췌 출처 확인", title: "이 발췌를 남길까요?", what: "기억에 넣을 발췌", icon: "quote" },
  recognition: { label: "인식 근거 부족", title: "이 인식을 남길까요?", what: "보류한 인식", icon: "eye" },
} as const;

type SmallKind = keyof typeof KIND;
const kindOf = (item: any): SmallKind => item?.kind === "recognition" ? "recognition" : item?.kind === "passage" ? "passage" : "dialogue";

/** The list row's leading mark: a quote for dialogue and passages, an eye for who-knows-what. */
export function smallReviewMark(item: any): string {
  const kind = kindOf(item);
  return `<span class="review-small__mark review-small__mark--${kind}" aria-hidden="true">${icon(KIND[kind].icon)}</span>`;
}

export function smallReviewDetail(item: any, back: string): string {
  const kind = kindOf(item);
  const meta = KIND[kind];
  const data = { auditId: String(item.auditId), id: String(item.id) };
  const quotes = (item.verifiedEvidence ?? []).map((e: any) => `<p class="review-small__source">${escapeHtml(e.quote)}</p>`).join("");
  const subject = kind === "recognition"
    ? `<div class="review-small__card review-small__knows">${avatar(String(item.holder ?? ""), "sm")}${icon("arrow-right")}<span class="review-small__text">${escapeHtml(item.text || "연결된 세부 기억을 확인하지 못했어요.")}</span></div>`
    : `<div class="review-small__card">${item.speaker ? `<div class="review-small__speaker">${avatar(String(item.speaker), "sm")}<b>${escapeHtml(item.speaker)}</b></div>` : ""}<span class="review-small__quote${kind === "dialogue" ? " is-bubble" : ""}">${escapeHtml(item.text || "")}</span></div>`;
  // Phrased without a particle after the name, so any name reads naturally.
  const missing = kind === "recognition" ? "원문에서 이 인식의 근거를 찾지 못했어요" : "원문에서 하나로 확인된 부분을 찾지 못했어요";
  const source = quotes
    ? `<h3 class="sec">원문에서 찾은 부분</h3><div class="review-small__card review-small__found"><span class="review-small__ok">${icon("check")}원문 확인됨</span>${quotes}</div>`
    : `<div class="review-small__card review-small__missing">${icon("search")}<span>${missing}</span></div>`;
  const keep = item.canKeep
    ? btn("남기기", { kind: "primary", action: "resolve-small-review", data: { ...data, resolution: "keep" } })
    : btn("보류 유지", { kind: "secondary", action: "resolve-small-review", data: { ...data, resolution: "hold" } });
  const retry = !item.canKeep && item.canRetry
    ? `<button type="button" class="review-small__retry" data-action="resolve-small-review" data-audit-id="${escapeHtml(data.auditId)}" data-id="${escapeHtml(data.id)}" data-resolution="retry">${icon("sparkle")}<b>보조 모델로 다시 확인</b><span>· 호출 1회</span></button>`
    : item.retryJobId ? '<p class="review-small__note">보조 모델 재확인을 요청했어요.</p>' : "";
  return `<article class="reader review-small">${back}
    <div class="review-small__kicker">${meta.label}<span class="review-small__saved">${icon("check")}기억은 저장됨</span></div>
    <h2 class="reader__title">${meta.title}</h2>
    <p class="review-small__why">${escapeHtml(item.reason)}</p>
    <h3 class="sec">${meta.what}</h3>${subject}
    ${source}
    <div class="review-small__acts">${keep}${btn("빼기", { kind: "danger", action: "resolve-small-review", data: { ...data, resolution: "discard" } })}</div>
    ${retry}
    <p class="review-small__note">고르기 전까지는 기억 검색과 모델 전달에서 빠져 있어요.</p>
    </article>`;
}
