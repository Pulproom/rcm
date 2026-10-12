import { z } from "zod";

export const RCM_PRODUCT_VERSION = "1.0.8";
export const RCM_PLUGIN_VERSION = "1.0.6";
export const RCM_SERVER_VERSION = "1.0.7";

export const ReleaseChannelSchema = z.literal("stable");
export type ReleaseChannel = z.infer<typeof ReleaseChannelSchema>;

export const ReleaseAssetSchema = z.object({
  kind: z.enum(["server-bundle", "windows-x64", "node-install"]),
  platform: z.enum(["any", "windows", "darwin", "linux", "android"]),
  arch: z.enum(["any", "x64", "arm64"]),
  url: z.string().url().refine((value) => value.startsWith("https://"), "Release assets must use HTTPS"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  size: z.number().int().positive().max(100 * 1024 * 1024),
}).strict();

export const ReleaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  channel: ReleaseChannelSchema,
  productVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  pluginVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  serverVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  apiRevision: z.number().int().positive(),
  minimumPluginVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  minimumServerVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  publishedAt: z.string().datetime(),
  notesUrl: z.string().url().refine((value) => value.startsWith("https://")),
  sourceUrl: z.string().url().refine((value) => value.startsWith("https://")),
  pluginUrl: z.string().url().refine((value) => value.startsWith("https://")),
  assets: z.array(ReleaseAssetSchema).min(1),
}).strict();
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

export function compareNumericVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number(part));
  const b = right.split(".").map((part) => Number(part));
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
