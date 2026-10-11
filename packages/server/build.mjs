import { realpathSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const packageDir = realpathSync(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2];
if (process.argv.length > 3 || (mode !== undefined && mode !== "eval")) {
  throw new Error("Usage: node build.mjs [eval]");
}
const outputDir = resolve(packageDir, mode === "eval" ? "dist-eval" : "dist");
// Only these generated direct children may be cleaned; never accept an input path.
if (dirname(outputDir) !== packageDir) throw new Error("Build output escapes package");
rmSync(outputDir, { recursive: true, force: true });
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [
  require.resolve("typescript/bin/tsc"), "-p",
  mode === "eval" ? "tsconfig.eval.json" : "tsconfig.build.json",
], { cwd: packageDir, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
