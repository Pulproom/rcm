import { z } from "zod";
import { AlbumTogetherRecordsSchema } from "./album-together.js";
import { AlbumBondSchema } from "./album-bond.js";

export const ALBUM_DOCUMENT_VERSION = 1;
export const ALBUM_BLOCK_KINDS = ["cover", "intro", "firsts", "story", "quotes", "promises", "bond", "hearts", "progress", "nicknames", "gallery", "intimacy", "text", "photo", "divider", "together"] as const;
export const ALBUM_THEMES = ["book", "program", "lp", "film"] as const;
export type AlbumBlockKind = typeof ALBUM_BLOCK_KINDS[number];
export type AlbumTheme = typeof ALBUM_THEMES[number];

/** Default reading order of a new draft: letters, story, then supporting records. */
export const ALBUM_DRAFT_ORDER: readonly AlbumBlockKind[] = ["cover", "intro", "together", "hearts", "story", "quotes", "promises", "gallery", "nicknames", "firsts", "bond", "progress", "intimacy", "text", "photo", "divider"];

export function defaultBlockEnabled(kind: AlbumBlockKind): boolean {
  return kind !== "intimacy" && kind !== "text" && kind !== "photo" && kind !== "divider";
}

/** Implemented layouts only, default first. Stored layout strings remain untouched. */
export const ALBUM_THEME_LAYOUTS: Record<AlbumTheme, Record<AlbumBlockKind, readonly string[]>> = {
  book: { cover: ["title"], intro: ["people"], firsts: ["table"], story: ["records"], quotes: ["quote"], promises: ["list"], bond: ["flow"], hearts: ["letter"], progress: ["checklist"], nicknames: ["labels"], gallery: ["grid"], intimacy: ["list"], text: ["paragraph"], photo: ["group"], divider: ["decoration"], together: ["ledger"] },
  program: { cover: ["title"], intro: ["people"], firsts: ["table"], story: ["records"], quotes: ["quote"], promises: ["list"], bond: ["flow"], hearts: ["letter"], progress: ["checklist"], nicknames: ["labels"], gallery: ["grid"], intimacy: ["list"], text: ["paragraph"], photo: ["group"], divider: ["decoration"], together: ["ledger"] },
  lp: { cover: ["title"], intro: ["people"], firsts: ["table"], story: ["records"], quotes: ["quote"], promises: ["list"], bond: ["flow"], hearts: ["letter"], progress: ["checklist"], nicknames: ["labels"], gallery: ["grid"], intimacy: ["list"], text: ["paragraph"], photo: ["group"], divider: ["decoration"], together: ["ledger"] },
  film: { cover: ["title"], intro: ["people"], firsts: ["table"], story: ["records"], quotes: ["quote"], promises: ["list"], bond: ["flow"], hearts: ["letter"], progress: ["checklist"], nicknames: ["labels"], gallery: ["grid"], intimacy: ["list"], text: ["paragraph"], photo: ["group"], divider: ["decoration"], together: ["ledger"] },
};

export const ALBUM_TINTS: Record<AlbumTheme, readonly string[]> = {
  book: ["plum", "ink", "pine", "navy", "brick"],
  program: ["primary", "sea", "dusk", "forest", "ink"],
  lp: ["mustard", "tomato", "sky", "pink", "black"], film: ["seal", "navy", "grass", "gray", "kraft"],
};
export function resolveAlbumTint(theme: AlbumTheme, tint?: string): string | undefined {
  return tint && ALBUM_TINTS[theme].includes(tint) ? tint : ALBUM_TINTS[theme][0];
}

export function resolveLayout(kind: AlbumBlockKind, layout: string | undefined, theme: AlbumTheme): string {
  const layouts = ALBUM_THEME_LAYOUTS[theme][kind];
  return layout && layouts.includes(layout) ? layout : layouts[0]!;
}

const text = z.string().max(20_000);
const id = z.string().min(1);
export const AlbumOriginSchema = z.object({ kind: id, sourceId: id, fingerprint: id });
export type AlbumOrigin = z.infer<typeof AlbumOriginSchema>;
export const AlbumCropSchema = z.object({
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  w: z.number().positive().max(1), h: z.number().positive().max(1), ratio: z.number().positive(),
}).refine(c => c.x + c.w <= 1.000001 && c.y + c.h <= 1.000001);
export type AlbumCrop = z.infer<typeof AlbumCropSchema>;
export const AlbumPhotoShapeSchema = z.enum(["landscape", "portrait", "square", "original"]);
export type AlbumPhotoShape = z.infer<typeof AlbumPhotoShapeSchema>;
export const AlbumPhotoFitSchema = z.object({
  shape: AlbumPhotoShapeSchema, x: z.number().min(0).max(100), y: z.number().min(0).max(100), zoom: z.number().min(1).max(3),
});
export type AlbumPhotoFit = z.infer<typeof AlbumPhotoFitSchema>;
export const AlbumPhotoRefSchema = z.object({ photoId: id, caption: text.optional(), crop: AlbumCropSchema.optional().catch(undefined),
  fit: AlbumPhotoFitSchema.optional().catch(undefined), width: z.number().positive().optional().catch(undefined), height: z.number().positive().optional().catch(undefined) });

export const AlbumItemSchema = z.object({
  createdAt: z.number().int().nonnegative().optional().catch(undefined),
  id,
  origin: AlbumOriginSchema.optional(),
  hidden: z.boolean().optional(),
  bondEventIds: z.array(id).optional(),
  edited: z.record(z.string(), z.literal(true)).default({}),
  fields: z.record(z.string(), text).default({}),
  photos: z.array(AlbumPhotoRefSchema).default([]),
  get children(): z.ZodOptional<z.ZodArray<typeof AlbumItemSchema>> {
    return z.array(AlbumItemSchema).optional();
  },
});
export type AlbumItem = z.infer<typeof AlbumItemSchema>;

export const AlbumBlockSchema = z.object({
  id,
  kind: z.enum(ALBUM_BLOCK_KINDS),
  layout: z.string().default(""),
  hidden: z.boolean().default(false),
  title: text.optional(),
  items: z.array(AlbumItemSchema).default([]),
  bond: AlbumBondSchema.optional(),
  together: AlbumTogetherRecordsSchema.optional().catch(undefined),
  photoColumns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional().catch(undefined),
  photoShape: AlbumPhotoShapeSchema.optional().catch(undefined),
});
export type AlbumBlock = z.infer<typeof AlbumBlockSchema>;

const person = z.object({ name: text.default(""), photoId: id.optional(), photoSource: z.enum(["risu", "upload"]).optional(), photoAsset: text.optional() });
const source = z.object({
  chatId: id.nullable().default(null),
  chatTitle: text.default(""),
  characterName: text.default(""),
  characterId: id.optional().catch(undefined),
  defaultPair: z.boolean().optional(),
  personaName: text.default(""),
  createdFromRevision: z.number().int().nonnegative().default(0),
  lastSyncedRevision: z.number().int().nonnegative().default(0),
  sourceAvailable: z.boolean().default(false),
});

export const AlbumDocumentSchema = z.object({
  version: z.literal(ALBUM_DOCUMENT_VERSION),
  id,
  title: text,
  subtitle: text.default(""),
  createdAt: z.number().int().nonnegative().default(0),
  lastUpdatedFromMaterialsAt: z.number().int().nonnegative().optional().catch(undefined),
  updatedAt: z.number().int().nonnegative().default(0),
  revision: z.number().int().positive().default(1),
  source: source.prefault({}),
  people: z.object({ me: person.prefault({}), partner: person.prefault({}) }).prefault({}),
  coverPhotoId: id.optional(),
  coverFocus: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100), zoom: z.number().min(1).max(3).optional().catch(undefined), shape: AlbumPhotoShapeSchema.optional().catch(undefined) }).optional().catch(undefined),
  coverLineId: text.optional(),
  coverLine: AlbumItemSchema.optional(),
  coverLineUserWritten: z.boolean().optional(),
  periodLabel: text.optional(),
  style: z.object({
    theme: z.enum(ALBUM_THEMES).catch("book"),
    tint: z.string().optional(),
    colorScheme: z.enum(["auto", "light", "dark"]).default("auto"),
  }).transform(style => ({ ...style, tint: resolveAlbumTint(style.theme, style.tint) })).prefault({ theme: "book" }),
  blocks: z.array(AlbumBlockSchema),
  includesIntimacy: z.boolean().default(false),
});
export type AlbumDocument = z.infer<typeof AlbumDocumentSchema>;

/** Lightweight all-chat shelf projection; never contains the document or full-size photos. */
export interface AlbumSummary {
  id: string; title: string; sourceChatId: string | null; sourceAvailable: boolean;
  coverPhotoId: string | null; periodLabel: string | null; revision: number; updatedAt: number;
  theme?: AlbumTheme; tint?: string; names?: string[]; sceneCount?: number; chapterCount?: number; promiseCount?: number; coverQuote?: string; coverFocus?: { x: number; y: number; zoom?: number; shape?: AlbumPhotoShape }; newMemoryCount?: number;
}
