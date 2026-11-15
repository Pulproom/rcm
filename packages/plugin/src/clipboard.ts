/** Copy from the click handler; restricted host iframes may only allow the legacy path. */
export const MANUAL_COPY_MESSAGE = "선택했어요. Ctrl+C로 복사해 주세요.";
export async function copyText(text: string, manualField: () => HTMLElement | null | undefined): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* The iframe may deny the Clipboard API while still allowing copy commands. */ }
  const previous = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text; area.readOnly = true; area.tabIndex = -1;
  area.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
  document.body.append(area);
  let copied = false;
  try { area.focus({ preventScroll: true }); area.select(); area.setSelectionRange(0, text.length); copied = document.execCommand("copy"); }
  catch { /* Keep the real field available for manual copying. */ }
  finally { area.remove(); }
  if (copied) { previous?.focus({ preventScroll: true }); return true; }
  const field = manualField();
  if (field) {
    field.focus({ preventScroll: true });
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select();
    else {
      const range = document.createRange(); range.selectNodeContents(field);
      const selection = document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    }
  }
  return false;
}
