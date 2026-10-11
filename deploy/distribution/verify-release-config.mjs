import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const release=JSON.parse(readFileSync(resolve(root,"release-config.json"),"utf8"));
for(const field of ["productVersion","pluginVersion","serverVersion","minimumPluginVersion","minimumServerVersion"])if(!/^\d+\.\d+\.\d+$/.test(release[field]))throw new Error(`${field} must use x.y.z numeric form`);
if(!Array.isArray(release.releaseNotes)||release.releaseNotes.length===0||release.releaseNotes.some(value=>typeof value!=="string"||!value.trim()||value.length>500))throw new Error("releaseNotes must contain concise non-empty strings");
for(const [file,field] of [["package.json","productVersion"],["packages/shared/package.json","productVersion"],["packages/server/package.json","serverVersion"],["packages/plugin/package.json","pluginVersion"],["packages/eval/package.json","productVersion"]]){
  const value=JSON.parse(readFileSync(resolve(root,file),"utf8"));
  if(value.version!==release[field])throw new Error(`Version mismatch: ${file} must match ${field}`);
}
const shared=readFileSync(resolve(root,"packages/shared/src/release.ts"),"utf8");
if(!shared.includes(`RCM_PRODUCT_VERSION = "${release.productVersion}"`))throw new Error("Shared product version does not match release-config.json");
if(!shared.includes(`RCM_PLUGIN_VERSION = "${release.pluginVersion}"`))throw new Error("Shared plugin version does not match release-config.json");
if(!shared.includes(`RCM_SERVER_VERSION = "${release.serverVersion}"`))throw new Error("Shared server version does not match release-config.json");
const index=readFileSync(resolve(root,"packages/shared/src/index.ts"),"utf8");
if(!index.includes(`RCM_API_REVISION = ${release.apiRevision}`))throw new Error("API revision does not match release-config.json");
console.log(JSON.stringify(release));
