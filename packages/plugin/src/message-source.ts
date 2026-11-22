interface YumiTranslationRecord {
  model?: string;
  segments?: Array<{ source?: string }>;
}

export interface ResolvedMessageSource {
  content: string;
  sourceKind: "risu_display" | "yumi_model";
  sourceRecordId?: string;
}

export function messageDisplay(message: any): string {
  return String(message?.data ?? message?.content ?? "");
}

export function yumiSourceRecordId(message: any, display: string): string {
  // The display marker owns the record even if the message still carries an older ID.
  return display.match(/<!--\s*yumi-tr:v1:([A-Za-z0-9_-]+):start\s*-->/)?.[1]
    ?? (typeof message?.__yumi_tr === "string" ? message.__yumi_tr : "");
}

export function yumiSourceRecord(chat: any, id: string): string | undefined {
  const raw = id ? chat?.scriptstate?.[`$__yumi_tr.${id}`] : undefined;
  return typeof raw === "string" ? raw : undefined;
}

async function decodeYumiRecord(raw: string | undefined): Promise<YumiTranslationRecord | undefined> {
  if (!raw?.trim()) return undefined;
  try {
    if (raw.startsWith("u:")) return JSON.parse(raw.slice(2)) as YumiTranslationRecord;
    if (raw.startsWith("z:")) {
      const bytes = Uint8Array.from(atob(raw.slice(2)), (character) => character.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text()) as YumiTranslationRecord;
    }
    return JSON.parse(raw) as YumiTranslationRecord;
  } catch {
    return undefined;
  }
}

export async function resolveSourceInput(display: string, markerId: string, raw?: string): Promise<ResolvedMessageSource> {
  if (markerId) {
    const record = await decodeYumiRecord(raw);
    const model = typeof record?.model === "string" ? record.model : "";
    if (model.trim()) return { content: model, sourceKind: "yumi_model", sourceRecordId: markerId };
    const segmented = Array.isArray(record?.segments)
      ? record.segments.map((segment) => typeof segment?.source === "string" ? segment.source : "").join("")
      : "";
    if (segmented.trim()) return { content: segmented, sourceKind: "yumi_model", sourceRecordId: markerId };
  }
  return {
    content: display,
    sourceKind: "risu_display",
    ...(markerId ? { sourceRecordId: markerId } : {}),
  };
}

export async function resolveMessageSource(chat: any, message: any): Promise<ResolvedMessageSource> {
  const display = messageDisplay(message);
  const markerId = yumiSourceRecordId(message, display);
  return resolveSourceInput(display, markerId, yumiSourceRecord(chat, markerId));
}

export async function resolveMessageContent(chat: any, message: any): Promise<string> {
  return (await resolveMessageSource(chat, message)).content;
}
