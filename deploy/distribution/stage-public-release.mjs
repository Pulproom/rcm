import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,"../..");
const channel="stable";
const {productVersion}=JSON.parse(readFileSync(join(root,"release-config.json"),"utf8"));
const release=join(root,"releases",channel,productVersion);
const source=join(root,"artifacts/public-source/rcm");
for(const required of [source,join(release,"update-manifest.json"),join(release,"release-notes.json"),join(release,"RCM-windows-x64/server.mjs"),join(release,"RCM-windows-x64/risu-cognitive-memory.js")])if(!existsSync(required))throw new Error(`Required release input is missing: ${required}`);
const channelDir=join(source,"channels",channel),updatesDir=join(source,"updates");
mkdirSync(channelDir,{recursive:true});mkdirSync(updatesDir,{recursive:true});
const nextManifest=JSON.parse(readFileSync(join(release,"update-manifest.json"),"utf8"));
const fromHead=path=>{
  if(!existsSync(join(source,".git")))return undefined;
  const result=spawnSync("git",["show",`HEAD:${path}`],{cwd:source,encoding:"buffer",maxBuffer:20*1024*1024});
  return result.status===0?result.stdout:undefined;
};
const previousManifestBytes=fromHead(`updates/${channel}.json`);
let previousManifest;
try{previousManifest=previousManifestBytes?JSON.parse(previousManifestBytes.toString("utf8")):undefined;}catch{}
const stageComponent=(name,versionField,file)=>{
  if(previousManifest?.[versionField]!==nextManifest[versionField]&&nextManifest[versionField]!==productVersion)throw new Error(`Changed ${name} must use product version ${productVersion}`);
  const previous=previousManifest?.[versionField]===nextManifest[versionField]?fromHead(`channels/${channel}/${file}`):undefined;
  if(previous)writeFileSync(join(channelDir,file),previous);
  else copyFileSync(join(release,`RCM-windows-x64/${file}`),join(channelDir,file));
  return previous?"preserved":"updated";
};
const server=stageComponent("server","serverVersion","server.mjs");
const plugin=stageComponent("plugin","pluginVersion","risu-cognitive-memory.js");
copyFileSync(join(release,"update-manifest.json"),join(updatesDir,`${channel}.json`));
copyFileSync(join(release,"release-notes.json"),join(updatesDir,`${channel}-notes.json`));
console.log(JSON.stringify({source,channel,version:productVersion,components:{server,plugin},releaseAssets:[join(release,"RCM-windows-x64.zip"),join(release,"RCM-node-install.zip")] }));
