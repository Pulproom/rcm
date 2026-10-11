import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildMaskToolSources } from "./build-mask-tools.mjs";
import { pluginBanner, PLUGIN_VERSION } from "./build-banner.mjs";

const banner = pluginBanner();
const testArtifact = process.argv[2] === "--test-artifact";
if (process.argv.length > (testArtifact ? 3 : 2)) throw new Error("Usage: node build.mjs [--test-artifact]");
const packageDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(packageDir, "dist");
const testDir = resolve(packageDir, "..", "..", "artifacts", "test");
if (dirname(distDir) !== packageDir || dirname(dirname(testDir)) !== dirname(dirname(packageDir))) {
  throw new Error("Build output escaped the RCM workspace");
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await build({
  absWorkingDir: packageDir,
  entryPoints: ["src/index.ts"],
  outfile: join(distDir, "risu-cognitive-memory.js"),
  bundle: true,
  format: "iife",
  target: "es2022",
  banner: { js: banner },
  minify: false,
  sourcemap: true,
});
if (testArtifact) {
  await rm(testDir, { recursive: true, force: true });
  await mkdir(testDir, { recursive: true });
  await build({
    absWorkingDir: packageDir,
    entryPoints: ["src/index.ts"],
    outfile: join(testDir, `risu-cognitive-memory-v${PLUGIN_VERSION}.js`),
    bundle: true,
    format: "iife",
    target: "es2022",
    banner: { js: banner },
    minify: true,
    sourcemap: false,
  });
}
await buildMaskToolSources();
