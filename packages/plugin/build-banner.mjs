import { readFileSync } from "node:fs";
const release = JSON.parse(readFileSync(new URL("../../release-config.json", import.meta.url), "utf8"));
export const PRODUCT_VERSION = release.productVersion;
export const PLUGIN_VERSION = release.pluginVersion;

export function pluginBanner({ distribution = false, updateUrl = "" } = {}) {
  if (updateUrl && !updateUrl.startsWith("https://")) throw new Error("Plugin update URL must use HTTPS");
  return `//@name risu-cognitive-memory
//@display-name Risu Cognitive Memory ${PLUGIN_VERSION}
//@version ${PLUGIN_VERSION}
${updateUrl ? `//@update-url ${updateUrl}\n` : ""}//@api 3.0
//@description Relation-first cognitive memory with optional temporal world simulation
//@author Risu Cognitive Memory contributors
//@license MPL-2.0
//@arg server_url string Server URL
//@arg hidden_server_token string
//@arg default_profile string Default profile (companion or simulation)
//@allowed-ipc provider-manager${distribution ? "" : " hush27_mask_local_tools"}
//@permission replacer
//@permission network
//@permission llm
`;
}
