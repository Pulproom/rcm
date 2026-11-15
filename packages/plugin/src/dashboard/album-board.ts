import type { AlbumDocument } from '@rcm/shared';
import type { AlbumPhoto } from '../album/api.js';
import { renderAlbumForBoard, buildBoardPhotoList, boardPhotoParts } from '../album/board-render.js';
import { lintBoardHtml, type BoardLintResult } from '../album/board-lint.js';
import { albumExportHasIntimacy } from '../album/export-html.js';
import { escapeHtml as esc } from './film/ui.js';
export interface BoardDialogState { busy?: boolean; error?: string; manual?: boolean; addressesOpen?: boolean; drafts?: Record<string,string> }
/** Pure dialog with a lint seam so failed lint can never enable copying. */
export function renderBoardDialog(doc: AlbumDocument, photos: AlbumPhoto[], state: BoardDialogState = {}, lint: (html: string) => BoardLintResult = lintBoardHtml): string {
  const html = renderAlbumForBoard(doc, photos), check = lint(html), list = buildBoardPhotoList(doc, photos), missing = list.filter(p=>!p.publicUrl).length;
  const button = (action: string, label: string, cls = '', disabled = false) => `<button type="button" data-album-action="${action}" class="${cls}"${disabled ? ' disabled' : ''}>${label}</button>`;
  return `<div class="av-scrim av-export-scrim" data-album-action="album-overlay-close"></div><div class="av-pop av-export av-board" role="dialog" aria-modal="true" aria-labelledby="album-board-title" aria-busy="${!!state.busy}"><h3 id="album-board-title">게시판용 코드 복사</h3>
<p role="status">${check.ok ? `아카라이브 금지 규칙 검사 통과 · 약 ${(new Blob([html]).size / 1024).toFixed(1)} KB` : `금지 규칙 ${check.problems.length}개가 있어 복사할 수 없어요`}</p>
${check.ok ? '' : `<ul>${check.problems.map(p=>`<li>${esc(p.rule)} · ${esc(p.excerpt)}</li>`).join('')}</ul>`}
${missing ? `<p class="av-export-note">사진 ${missing}장은 빈 칸으로 들어가요. 아카라이브 편집기에서 그 칸에 붙여 넣어 주세요.</p>` : ''}
${albumExportHasIntimacy(doc) ? '<p class="av-export-note">가까워진 순간 블록이 들어 있어요. 파일을 다른 사람과 나눌 때 확인해 주세요.</p>' : ''}
${list.length ? `<details class="av-board-addresses"${state.addressesOpen ? ' open' : ''}><summary>사진 주소 넣기 (선택)</summary>${list.map((p,i)=>{const label=boardPhotoParts(doc,p).filter(Boolean).join(' ');return `<label><span>${String(i+1).padStart(2,'0')} · ${esc(label)}</span><input type="url" inputmode="url" data-board-photo="${esc(p.photoId)}" placeholder="https://" aria-label="${esc(label)} 사진 주소" value="${esc(state.drafts?.[p.photoId] ?? p.publicUrl ?? '')}"${state.busy ? ' disabled' : ''}></label>`;}).join('')}${button('album-board-address-save','주소 저장','',state.busy)}</details>` : ''}
${state.error ? `<p role="alert">${esc(state.error)}</p>` : ''}
${state.manual ? `<p>자동 복사가 막혀 있어요. 아래 코드를 직접 복사해 주세요.</p><textarea class="av-board-code" readonly aria-label="게시판용 HTML 코드">${esc(html)}</textarea>` : ''}
<div class="av-export-actions">${button('album-overlay-close','취소')}${list.length ? button('album-board-zip',state.busy ? '만드는 중…' : '사진 모아 받기','',state.busy) : ''}${button('album-board-copy','코드 복사','av-export-save',!check.ok || state.busy || !!state.error)}</div></div>`;
}
