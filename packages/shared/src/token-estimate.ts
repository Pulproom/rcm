/** Integer units make token costs additive without accumulating rounding error. */
export const estimateTokenUnits = (text: string): number => {
  let ascii = 0;
  let wide = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) ascii++;
    else {
      wide++;
      if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) index++;
    }
  }
  return ascii * 12 + wide * 35;
};

export const estimateTokensFromUnits = (units: number): number => Math.max(1, Math.ceil(units / 42));
export const estimateTokens = (text: string): number => estimateTokensFromUnits(estimateTokenUnits(text));
