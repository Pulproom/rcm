import { build } from '../../packages/plugin/node_modules/esbuild/lib/main.js';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pluginBanner, PRODUCT_VERSION, PLUGIN_VERSION } from '../../packages/plugin/build-banner.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 builder requires a matching host/runtime/native addon.');
const argument = name => { const index=process.argv.indexOf(name); return index>=0 ? process.argv[index+1] : undefined; };
const mode = argument('--mode') || 'candidate';
if (!['candidate','stable'].includes(mode)) throw new Error('Use --mode candidate or stable.');
const repository = argument('--repository');
if (mode !== 'candidate' && !repository) throw new Error('Published release builds require --repository owner/name.');
const base = mode === 'candidate' ? resolve(root, `artifacts/release-candidate/${PRODUCT_VERSION}`) : resolve(root, `releases/stable/${PRODUCT_VERSION}`);
const rawPluginBase = repository ? `https://raw.githubusercontent.com/${repository}/main` : '';
const updateManifestUrl = repository ? `${rawPluginBase}/updates/stable.json` : '';
const releaseChannel = 'stable';
const pluginUpdateUrl = repository ? `${rawPluginBase}/channels/${releaseChannel}/risu-cognitive-memory.js` : '';
const out = resolve(base, 'RCM-windows-x64');
const releaseConfig=JSON.parse(readFileSync(join(root,'release-config.json'),'utf8'));
const SERVER_VERSION=releaseConfig.serverVersion;
const releaseBody = `# RCM ${PRODUCT_VERSION}\n\n일반 사용자는 GitHub Releases에서 운영체제에 맞는 설치 파일을 받아 주세요.\n\nWindows 10/11 x64: RCM-windows-x64.zip\nmacOS x64/arm64, Linux glibc x64/arm64, Docker, Android Termux PRoot: RCM-node-install.zip\n\nmacOS·Linux·Docker·Android Termux PRoot는 실기기에서 검증하지 않았습니다.\n\n## 변경 사항\n\n${releaseConfig.releaseNotes.map(note => `- ${note}`).join('\n')}\n`;
if (existsSync(out)) {
  if(!process.argv.includes('--replace'))throw new Error('Output exists; use --replace for this exact generated directory.');
  if(dirname(out)!==base||realpathSync(out)!==out)throw new Error('Unsafe generated output path');
  rmSync(out,{recursive:true,force:true});
}
const put = (path, text) => { mkdirSync(dirname(path), {recursive:true}); writeFileSync(path, text); };
const copy = (from, to) => { mkdirSync(dirname(to), {recursive:true}); copyFileSync(from,to); };
mkdirSync(out,{recursive:true});
put(join(base,'release-body.md'),releaseBody);
const definitions = { __RCM_DISTRIBUTION__: 'true' };
const server = await build({absWorkingDir:root,entryPoints:['packages/server/src/index.ts'],outfile:join(out,'server.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',minify:true,sourcemap:false,metafile:true,
  alias:{"@rcm/shared":join(root,"packages/shared/src/index.ts")},define:definitions,external:['better-sqlite3','sqlite-vec'],banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"},
  plugins:[{name:'omit-diagnostics',setup(b){ b.onResolve({filter:/^\.\/retrieval-trace\.js$/},()=>({path:join(here,'stubs/retrieval-trace.ts')})); }}]});
const banner = pluginBanner({ distribution:true, updateUrl:pluginUpdateUrl });
const plugin = await build({absWorkingDir:root,entryPoints:['packages/plugin/src/index.ts'],outfile:join(out,'risu-cognitive-memory.js'),bundle:true,format:'iife',target:'es2022',minify:true,sourcemap:false,metafile:true,alias:{"@rcm/shared":join(root,"packages/shared/src/index.ts")},define:definitions,banner:{js:banner}});
if (repository) {
  const serverBytes=readFileSync(join(out,'server.mjs'));
  put(join(base,'update-manifest.json'),JSON.stringify({schemaVersion:1,channel:releaseChannel,productVersion:PRODUCT_VERSION,pluginVersion:PLUGIN_VERSION,serverVersion:SERVER_VERSION,apiRevision:releaseConfig.apiRevision,minimumPluginVersion:releaseConfig.minimumPluginVersion,minimumServerVersion:releaseConfig.minimumServerVersion,publishedAt:new Date().toISOString(),notesUrl:`https://github.com/${repository}/releases/tag/v${PRODUCT_VERSION}`,sourceUrl:`https://github.com/${repository}/tree/v${PRODUCT_VERSION}`,pluginUrl:pluginUpdateUrl,assets:[{kind:'server-bundle',platform:'any',arch:'any',url:`https://github.com/${repository}/releases/download/v${PRODUCT_VERSION}/server.mjs`,sha256:createHash('sha256').update(serverBytes).digest('hex'),size:serverBytes.byteLength}]},null,2));
  put(join(base,'release-notes.json'),JSON.stringify({schemaVersion:1,productVersion:PRODUCT_VERSION,notes:releaseConfig.releaseNotes},null,2));
}
const req = createRequire(join(root,'packages/server/package.json'));
function packageRoot(entry){let p=dirname(entry);while(!existsSync(join(p,'package.json'))){const q=dirname(p);if(q===p)throw new Error('Package root missing');p=q;}return realpathSync(p);}
const native = packageRoot(req.resolve('better-sqlite3'));
const bindings = packageRoot(createRequire(join(native,'package.json')).resolve('bindings'));
const uri = packageRoot(createRequire(join(bindings,'package.json')).resolve('file-uri-to-path'));
const vec = packageRoot(req.resolve('sqlite-vec'));
const vecNative = dirname(createRequire(join(vec,'package.json')).resolve('sqlite-vec-windows-x64/vec0.dll'));
function copyTree(from,to,allowed,prefix='') {for(const e of readdirSync(from,{withFileTypes:true})){const name=prefix+e.name;if(e.isDirectory()){if(allowed(name+'/'))copyTree(join(from,e.name),join(to,e.name),allowed,name+'/');}else if(allowed(name))copy(join(from,e.name),join(to,e.name));}}
for(const [name,path,allow] of [
  ['better-sqlite3',native,p=>p==='package.json'||p==='LICENSE'||p.startsWith('lib/')||p==='build/'||p==='build/Release/'||p==='build/Release/better_sqlite3.node'],
  ['bindings',bindings,p=>['package.json','bindings.js','LICENSE.md'].includes(p)],
  ['file-uri-to-path',uri,p=>['package.json','index.js','LICENSE'].includes(p)],
  ['sqlite-vec',vec,p=>['package.json','index.mjs','index.cjs'].includes(p)],
  ['sqlite-vec-windows-x64',vecNative,p=>['package.json','vec0.dll'].includes(p)]
]) copyTree(path,join(out,'node_modules',name),allow);
copy(process.execPath,join(out,'runtime/node.exe'));
for(const file of ['launch.mjs','Start.ps1','Stop.ps1','Connection.ps1','README.md']) copy(join(here,'templates',file),join(out,file));
put(join(out,'release.json'),JSON.stringify({schemaVersion:1,channel:releaseChannel,version:SERVER_VERSION,productVersion:PRODUCT_VERSION,pluginVersion:PLUGIN_VERSION,serverVersion:SERVER_VERSION,updateManifestUrl:updateManifestUrl||undefined,sourceUrl:repository?`https://github.com/${repository}/tree/v${PRODUCT_VERSION}`:undefined},null,2));
put(join(out,'Start.cmd'),'@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start.ps1"\r\npause\r\n');
put(join(out,'Stop.cmd'),'@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop.ps1"\r\npause\r\n');
put(join(out,'Connection.cmd'),'@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Connection.ps1"\r\npause\r\n');
put(join(out,'package.json'),JSON.stringify({name:'rcm-runtime',private:true,type:'module',version:SERVER_VERSION,license:'MPL-2.0',dependencies:{'better-sqlite3':JSON.parse(readFileSync(join(native,'package.json'))).version,'sqlite-vec':JSON.parse(readFileSync(join(vec,'package.json'))).version}},null,2));
const licenseRoots = new Set([native,bindings,uri,vec,vecNative]);
for(const result of [server,plugin]) for(const input of Object.keys(result.metafile.inputs)) if(input.includes('node_modules')) licenseRoots.add(packageRoot(resolve(root,input)));
let notices=`Risu Cognitive Memory ${PRODUCT_VERSION} (server ${SERVER_VERSION}, plugin ${PLUGIN_VERSION}) is licensed under MPL-2.0. See LICENSE and the source location in README.md. Third-party component licenses follow.\n`;
for(const path of licenseRoots){const info=JSON.parse(readFileSync(join(path,'package.json')));notices+=`\n${info.name} ${info.version}: ${info.license || 'see bundled license'}\n`;for(const file of readdirSync(path))if(/^(licen[cs]e|copying|notice)(\.|$)/i.test(file))copy(join(path,file),join(out,'licenses',info.name.replaceAll('/','_')+'-'+file));}
if(process.version!=='v24.15.0')throw new Error('Verify and update the bundled Node license hash for this runtime version.');
for(const [name,expected] of [['Node-LICENSE','4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18'],['sqlite-vec-LICENSE-MIT','6ce72bbe12d975bd5286e5ab0a064c069693300c47bccbc57bec18485f1621ea']]) {
  const source=join(here,'licenses',name);const bytes=readFileSync(source);
  if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error(`License hash mismatch: ${name}`);
  copy(source,join(out,'licenses',name));
}
put(join(out,'NOTICE.txt'),notices);
copy(join(root,'LICENSE'),join(out,'LICENSE'));
const probe=spawnSync(join(out,'runtime/node.exe'),['--input-type=module','-e',"import D from 'better-sqlite3';import{load}from'sqlite-vec';const d=new D(':memory:');load(d);console.log(d.prepare('select vec_version() version').get());d.close();"],{cwd:out,encoding:'utf8'});
if(probe.status!==0)throw new Error(probe.stderr||'Native probe failed');
const files=[];function scan(p){for(const e of readdirSync(p,{withFileTypes:true})){const f=join(p,e.name);if(e.isDirectory())scan(f);else files.push(f);}}scan(out);
put(join(out,'SHA256SUMS.txt'),files.map(f=>`${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(out,f).replaceAll('\\','/')}`).sort().join('\n')+'\n');
const zip=out+'.zip';
if(existsSync(zip)){if(!process.argv.includes('--replace')||dirname(zip)!==base)throw new Error('Archive already exists');rmSync(zip);}
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const archive=spawnSync('powershell',['-NoProfile','-Command',`Compress-Archive -LiteralPath ${quote(out)} -DestinationPath ${quote(zip)}`],{encoding:'utf8'});
if(archive.status!==0)throw new Error(archive.stderr);
const portable=resolve(base,'RCM-node-install');
if(existsSync(portable)){
  if(!process.argv.includes('--replace')||dirname(portable)!==base||realpathSync(portable)!==portable)throw new Error('Unsafe node-install output path');
  rmSync(portable,{recursive:true,force:true});
}
for(const file of ['server.mjs','risu-cognitive-memory.js','launch.mjs','package.json','NOTICE.txt','LICENSE','release.json'])copy(join(out,file),join(portable,file));
for(const file of ['start.sh','Dockerfile','container.mjs','compose.yaml'])copy(join(here,'templates',file),join(portable,file));
copy(join(here,'templates/README-node.md'),join(portable,'README.md'));
copyTree(join(out,'licenses'),join(portable,'licenses'),()=>true);
const portableFiles=[];function listPortable(p){for(const e of readdirSync(p,{withFileTypes:true})){const f=join(p,e.name);if(e.isDirectory())listPortable(f);else portableFiles.push(f);}}listPortable(portable);
put(join(portable,'SHA256SUMS.txt'),portableFiles.map(f=>`${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(portable,f).replaceAll('\\','/')}`).sort().join('\n')+'\n');
const portableZip=portable+'.zip';if(existsSync(portableZip)){if(!process.argv.includes('--replace'))throw new Error('Node archive exists');rmSync(portableZip);}
const portableArchive=spawnSync('powershell',['-NoProfile','-Command',`Compress-Archive -LiteralPath ${quote(portable)} -DestinationPath ${quote(portableZip)}`],{encoding:'utf8'});
if(portableArchive.status!==0)throw new Error(portableArchive.stderr);
console.log(JSON.stringify({output:out,archive:zip,nodeInstallArchive:portableZip,node:process.version,nativeProbe:probe.stdout.trim(),files:files.length+1}));
