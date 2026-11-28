import {sourcePdfUnavailable, type ServerLlmPublicConfig} from '@rcm/shared';

const footerCopy='기억 추출 원문만 PDF로 보내요.';
export function sourcePdfSettings(config:ServerLlmPublicConfig, engine:string):string {
  const reason=sourcePdfUnavailable({...config,engine}),enabled=config.sourcePdf?.enabled===true,fontPt=config.sourcePdf?.fontPt??6;
  return `<div class="setting-group" data-source-pdf><h3>원문 전송</h3><div class="form__row source-pdf-controls">
    <label class="field field--check"><span><input name="sourcePdfEnabled" type="checkbox"${enabled?' checked':''}${reason?' disabled':''}> 원문을 PDF로 보내기</span></label>
    <label class="field source-pdf-font"${!enabled||reason?' hidden':''}><span>글자 크기</span><span class="source-pdf-number"><input aria-label="글자 크기" name="sourcePdfFontPt" type="number" min="4" max="10" step="1" value="${fontPt}" required${!enabled||reason?' disabled':''}><span>pt</span></span></label>
    </div><p class="sub" data-source-pdf-summary>${reason??footerCopy}</p>
  </div>`;
}
/** In-place updates preserve the settings form's unsaved values and caret. */
export function syncSourcePdfSettings(root:ParentNode):void {
  const group=root.querySelector<HTMLElement>('[data-source-pdf]');if(!group)return;
  const value=(name:string)=>root.querySelector<HTMLInputElement|HTMLSelectElement>(`[name="${name}"]`)?.value??'';
  const reason=sourcePdfUnavailable({engine:value('extractionEngine'),provider:value('serverLlmProvider'),model:value('serverLlmModel')});
  const toggle=group.querySelector<HTMLInputElement>('[name="sourcePdfEnabled"]')!,font=group.querySelector<HTMLInputElement>('[name="sourcePdfFontPt"]')!;
  toggle.disabled=!!reason;
  const on=toggle.checked&&!reason;
  font.disabled=!on;group.querySelector<HTMLElement>('.source-pdf-font')!.hidden=!on;
  group.querySelector<HTMLElement>('[data-source-pdf-summary]')!.textContent=reason??footerCopy;
}
