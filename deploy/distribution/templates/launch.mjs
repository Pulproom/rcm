import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const root = dirname(fileURLToPath(import.meta.url));
const releaseInfo = existsSync(resolve(root, 'release.json')) ? JSON.parse(readFileSync(resolve(root, 'release.json'), 'utf8')) : {};
const data = resolve(process.env.RCM_DATA_DIR || resolve(root, '..', 'RCM-user-data'));
mkdirSync(data, { recursive: true });
const connectionPath = resolve(data, 'connection.json');
const storedConnection = existsSync(connectionPath) ? JSON.parse(readFileSync(connectionPath, 'utf8')) : undefined;
const storedServerUrl = storedConnection?.serverUrl;
const explicitPort = process.env.RCM_PORT?.trim();
if (explicitPort && (!/^\d+$/.test(explicitPort) || Number(explicitPort) < 1 || Number(explicitPort) > 65535)) throw new Error('RCM_PORT must be an integer from 1 to 65535');
const connection = storedConnection ?? { serverUrl: 'http://127.0.0.1:7331', token: randomBytes(32).toString('hex') };
if (explicitPort) connection.serverUrl = `http://127.0.0.1:${explicitPort}`;
if (typeof connection.token !== 'string' || connection.token.length < 32) throw new Error('Invalid connection.json token');
const url = new URL(connection.serverUrl);
if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('This package requires loopback HTTP');
const probe=createServer();
await new Promise((accept,reject)=>{probe.once('error',reject);probe.listen(Number(url.port||7331),'127.0.0.1',accept);});
await new Promise(accept=>probe.close(accept));
if (!storedConnection) writeFileSync(connectionPath, JSON.stringify(connection, null, 2), { flag: 'wx', mode: 0o600 });
else if (storedServerUrl !== connection.serverUrl) writeFileSync(connectionPath, JSON.stringify(connection, null, 2), { mode: 0o600 });
const pidFile = resolve(data, 'runtime.json');
if (existsSync(pidFile)) {
  const previous = JSON.parse(readFileSync(pidFile, 'utf8'));
  try { process.kill(previous.pid, 0); throw new Error('RCM is already running; use Stop first.'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
const updates = resolve(root, '.updates');
const pendingPath = resolve(updates, 'pending.json');
const serverPath = resolve(root, 'server.mjs');
const previousPath = resolve(updates, 'server.previous.mjs');
let appliedUpdate = false;
if (existsSync(pendingPath)) {
  const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
  const staged = resolve(String(pending.staged));
  if (resolve(String(pending.target)) !== serverPath || dirname(staged) !== updates) throw new Error('Unsafe pending update path');
  const digest = createHash('sha256').update(readFileSync(staged)).digest('hex');
  if (digest !== pending.sha256) throw new Error('Pending update checksum mismatch');
  copyFileSync(serverPath, previousPath);
  renameSync(staged, serverPath);
  rmSync(pendingPath);
  appliedUpdate = true;
}
const childEnv = { ...process.env, RCM_HOST: '127.0.0.1', RCM_PORT: url.port || '7331', RCM_TOKEN: connection.token,
  RCM_DB_PATH: resolve(data, 'memory.db'), RCM_SECRETS_PATH: resolve(data, 'secrets.env'), RCM_RETRIEVAL_TRACE: 'off',
  RCM_INSTALL_DIR: root, ...(releaseInfo.updateManifestUrl ? { RCM_UPDATE_MANIFEST_URL: releaseInfo.updateManifestUrl, RCM_UPDATE_CHANNEL: releaseInfo.channel || 'stable' } : {}) };
let child = spawn(process.execPath, [serverPath], {
  cwd: data, stdio: 'inherit', windowsHide: true,
  env: childEnv,
});
writeFileSync(pidFile, JSON.stringify({ pid: child.pid, launcherPid: process.pid, executable: process.execPath, server: resolve(root, 'server.mjs'), startedAt: Date.now() }));
console.log(`RCM: ${connection.serverUrl}\nConnection settings: ${connectionPath}\nUser data: ${data}`);
const ready = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) return false;
    try { if ((await fetch(`${connection.serverUrl}/v1/health`)).ok) return true; } catch {}
    await new Promise(accept => setTimeout(accept, 200));
  }
  return false;
};
if (!await ready() && appliedUpdate && existsSync(previousPath)) {
  child.kill();
  await new Promise(accept => child.once('exit', accept));
  copyFileSync(previousPath, serverPath);
  child = spawn(process.execPath, [serverPath], { cwd: data, stdio: 'inherit', windowsHide: true, env: childEnv });
  writeFileSync(pidFile, JSON.stringify({ pid: child.pid, launcherPid: process.pid, executable: process.execPath, server: serverPath, startedAt: Date.now(), rolledBack: true }));
  if (!await ready()) throw new Error('Updated server failed and the previous server could not be restarted.');
  console.warn('The update could not start. The previous server was restored.');
}
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
