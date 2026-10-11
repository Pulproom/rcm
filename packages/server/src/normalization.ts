const predicateAliases: Record<string, string> = { profession: "occupation", job: "occupation" };

export const normalizeLedgerText = (value: string): string => value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
export const normalizeLedgerPredicate = (value: string): string => predicateAliases[normalizeLedgerText(value)] ?? normalizeLedgerText(value);
