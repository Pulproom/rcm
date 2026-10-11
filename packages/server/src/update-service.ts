import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  compareNumericVersions,
  RCM_API_REVISION,
  RCM_SERVER_VERSION,
  ReleaseManifestSchema,
  type ReleaseManifest,
} from "@rcm/shared";
import type { ServerConfig } from "./config.js";
import { managedRestartAvailable } from "./managed-restart.js";

export interface UpdateStatus {
  configured: boolean;
  channel: "stable";
  currentServerVersion: string;
  apiRevision: number;
  checkedAt?: string;
  available: boolean;
  latestVersion?: string;
  latestPluginVersion?: string;
  latestServerVersion?: string;
  latestReleaseNotes?: string;
  minimumPluginVersion?: string;
  minimumServerVersion?: string;
  notesUrl?: string;
  pluginUrl?: string;
  canStageServer: boolean;
  canApplyAutomatically?: boolean;
  stagedVersion?: string;
  restartRequired?: boolean;
  error?: string;
}

function githubRawUrl(owner: string, repository: string, path: string, now: number): URL {
  const url = new URL(`https://raw.githubusercontent.com/${owner}/${repository}/main/${path}`);
  url.searchParams.set("rcm_update", String(Math.floor(now / 300_000)));
  return url;
}

export function manifestRequestUrl(value: string, now = Date.now()): URL {
  const url = new URL(value);
  const raw = url.hostname === "raw.githubusercontent.com"
    ? url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:main|refs\/heads\/main)\/(updates\/[A-Za-z0-9_./-]+\.json)$/)
    : undefined;
  if (raw) return githubRawUrl(raw[1]!, raw[2]!, raw[3]!, now);
  const contents = url.hostname === "api.github.com"
    ? url.pathname.match(/^\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/contents\/(updates\/[A-Za-z0-9_./-]+\.json)$/)
    : undefined;
  if (contents) return githubRawUrl(contents[1]!, contents[2]!, contents[3]!, now);
  return url;
}

export function releaseNotesFileUrl(manifestUrl: string, now = Date.now()): URL {
  const url = manifestRequestUrl(manifestUrl, now);
  url.pathname = url.pathname.replace(/\.json$/, "-notes.json");
  return url;
}

export function releaseNotesRequestUrl(value: string): URL | undefined {
  const url = new URL(value);
  if (url.hostname !== "github.com") return undefined;
  const match = url.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/releases\/tag\/([^/]+)\/?$/);
  if (!match) return undefined;
  return new URL(`https://api.github.com/repos/${match[1]}/${match[2]}/releases/tags/${match[3]}`);
}

export class UpdateService {
  private manifest?: ReleaseManifest;
  private checkedAt?: string;
  private error?: string;
  private stagedVersion?: string;
  private releaseNotes?: string;
  private releaseNotesVersion?: string;

  constructor(private readonly config: ServerConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  private pendingVersion(): string | undefined {
    if (!this.config.installDir) return undefined;
    const pendingPath = resolve(this.config.installDir, ".updates", "pending.json");
    if (!existsSync(pendingPath)) return undefined;
    try {
      const pending = JSON.parse(readFileSync(pendingPath, "utf8")) as { version?: unknown; target?: unknown; staged?: unknown };
      if (typeof pending.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pending.version)) return undefined;
      if (resolve(String(pending.target ?? "")) !== resolve(this.config.installDir, "server.mjs")) return undefined;
      if (dirname(resolve(String(pending.staged ?? ""))) !== resolve(this.config.installDir, ".updates")) return undefined;
      return pending.version;
    } catch { return undefined; }
  }

  restartTargetVersion(): string | undefined {
    return this.pendingVersion() ?? this.stagedVersion;
  }

  status(): UpdateStatus {
    const available = Boolean(this.manifest && compareNumericVersions(this.manifest.serverVersion, RCM_SERVER_VERSION) > 0);
    const stagedVersion = this.restartTargetVersion();
    return {
      configured: Boolean(this.config.updateManifestUrl),
      channel: this.config.updateChannel ?? "stable",
      currentServerVersion: RCM_SERVER_VERSION,
      apiRevision: RCM_API_REVISION,
      checkedAt: this.checkedAt,
      available,
      latestVersion: this.manifest?.productVersion,
      latestPluginVersion: this.manifest?.pluginVersion,
      latestServerVersion: this.manifest?.serverVersion,
      latestReleaseNotes: this.releaseNotesVersion === this.manifest?.productVersion ? this.releaseNotes : undefined,
      minimumPluginVersion: this.manifest?.minimumPluginVersion,
      minimumServerVersion: this.manifest?.minimumServerVersion,
      notesUrl: this.manifest?.notesUrl,
      pluginUrl: this.manifest?.pluginUrl,
      canStageServer: available && Boolean(this.config.installDir && this.manifest?.assets.some((asset) => asset.kind === "server-bundle" && asset.platform === "any")),
      canApplyAutomatically: managedRestartAvailable(this.config),
      stagedVersion,
      restartRequired: Boolean(stagedVersion),
      error: this.error,
    };
  }

  async check(): Promise<UpdateStatus> {
    if (!this.config.updateManifestUrl) return this.status();
    const url = manifestRequestUrl(this.config.updateManifestUrl);
    if (url.protocol !== "https:") throw new Error("Update manifest must use HTTPS");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImpl(url, { headers: { Accept: "application/json", "Cache-Control": "no-cache" }, signal: controller.signal });
      if (!response.ok) throw new Error(`Update manifest returned ${response.status}`);
      const manifest = ReleaseManifestSchema.parse(await response.json());
      if (manifest.channel !== (this.config.updateChannel ?? "stable")) throw new Error(`Expected ${this.config.updateChannel ?? "stable"} update channel`);
      this.manifest = manifest;
      this.checkedAt = new Date().toISOString();
      this.error = undefined;
      this.releaseNotes = undefined;
      this.releaseNotesVersion = undefined;
      const notesFile = releaseNotesFileUrl(this.config.updateManifestUrl);
      try {
        const notesResponse = await this.fetchImpl(notesFile, { headers: { Accept: "application/json", "Cache-Control": "no-cache" }, signal: controller.signal });
        if (notesResponse.ok) {
          const notes = await notesResponse.json() as { schemaVersion?: unknown; productVersion?: unknown; notes?: unknown };
          if (notes.schemaVersion === 1 && notes.productVersion === manifest.productVersion && Array.isArray(notes.notes) && notes.notes.every((item) => typeof item === "string")) {
            const text = notes.notes.map((item) => `- ${item.trim()}`).join("\n").trim();
            if (text) {
              this.releaseNotes = text.slice(0, 12_000);
              this.releaseNotesVersion = manifest.productVersion;
            }
          }
        }
      } catch { /* Release notes are optional and must not block updates. */ }
      const notesApi = !this.releaseNotes ? releaseNotesRequestUrl(manifest.notesUrl) : undefined;
      if (notesApi) {
        try {
          const notesResponse = await this.fetchImpl(notesApi, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Risu-Cognitive-Memory" }, signal: controller.signal });
          if (notesResponse.ok) {
            const body = (await notesResponse.json() as { body?: unknown }).body;
            if (typeof body === "string" && body.trim()) {
              this.releaseNotes = body.trim().slice(0, 12_000);
              this.releaseNotesVersion = manifest.productVersion;
            }
          }
        } catch { /* Release notes are optional and must not block updates. */ }
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
    return this.status();
  }

  async stageServer(): Promise<UpdateStatus> {
    if (!this.manifest) await this.check();
    const manifest = this.manifest;
    const installDir = this.config.installDir;
    if (!manifest || !installDir) throw new Error("This server package is not configured for managed updates");
    const asset = manifest.assets.find((item) => item.kind === "server-bundle" && item.platform === "any");
    if (!asset) throw new Error("The release does not contain a server bundle");
    if (compareNumericVersions(manifest.serverVersion, RCM_SERVER_VERSION) <= 0) return this.status();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await this.fetchImpl(asset.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Server bundle returned ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== asset.size) throw new Error("Server bundle size does not match the manifest");
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest.toLowerCase() !== asset.sha256.toLowerCase()) throw new Error("Server bundle checksum does not match the manifest");
      const updatesDir = resolve(installDir, ".updates");
      await mkdir(updatesDir, { recursive: true });
      const temporary = join(updatesDir, `${manifest.serverVersion}.server.tmp`);
      const staged = join(updatesDir, `${manifest.serverVersion}.server.mjs`);
      await writeFile(temporary, bytes);
      await rm(staged, { force: true });
      await rename(temporary, staged);
      await writeFile(join(updatesDir, "pending.json"), JSON.stringify({
        schemaVersion: 1, version: manifest.serverVersion, staged,
        target: resolve(installDir, "server.mjs"), sha256: digest, createdAt: new Date().toISOString(),
      }, null, 2));
      this.stagedVersion = manifest.serverVersion;
      this.error = undefined;
      return this.status();
    } finally {
      clearTimeout(timer);
    }
  }
}
