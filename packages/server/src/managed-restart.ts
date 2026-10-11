import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ServerConfig } from "./config.js";

export interface ManagedRestartPlan {
  targetVersion: string;
  installDir: string;
  launcherPath: string;
  helperPath: string;
  serverPid: number;
  launcherPid: number;
  stdoutPath: string;
  stderrPath: string;
}

const HELPER_SOURCE = `import { appendFileSync, closeSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
const plan=JSON.parse(Buffer.from(process.argv[2],'base64url').toString('utf8'));
const alive=pid=>{try{process.kill(pid,0);return true}catch(error){if(error?.code==='ESRCH')return false;throw error}};
const waitForExit=async pid=>{const deadline=Date.now()+30000;while(alive(pid)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));if(alive(pid))throw new Error('Timed out waiting for RCM process '+pid)};
try{
  await waitForExit(plan.serverPid);
  await waitForExit(plan.launcherPid);
  const stdout=openSync(plan.stdoutPath,'a');
  const stderr=openSync(plan.stderrPath,'a');
  const child=spawn(process.execPath,[plan.launcherPath],{cwd:plan.installDir,env:process.env,detached:true,windowsHide:true,stdio:['ignore',stdout,stderr]});
  child.unref();closeSync(stdout);closeSync(stderr);
}catch(error){appendFileSync(plan.stderrPath,'\\n[RCM update restart] '+String(error)+'\\n');process.exitCode=1;}
`;

export function managedRestartAvailable(config: ServerConfig): boolean {
  return Boolean(config.installDir && existsSync(resolve(config.installDir, "launch.mjs")));
}

export function managedRestartPlan(config: ServerConfig, targetVersion: string): ManagedRestartPlan | undefined {
  if (!config.installDir || !managedRestartAvailable(config) || !/^\d+\.\d+\.\d+$/.test(targetVersion)) return undefined;
  const installDir = resolve(config.installDir);
  const launcherPath = resolve(installDir, "launch.mjs");
  const pendingPath = resolve(installDir, ".updates", "pending.json");
  if (!existsSync(launcherPath) || !existsSync(pendingPath)) return undefined;
  try {
    const pending = JSON.parse(readFileSync(pendingPath, "utf8")) as { version?: unknown; target?: unknown; staged?: unknown };
    if (pending.version !== targetVersion || resolve(String(pending.target ?? "")) !== resolve(installDir, "server.mjs") || dirname(resolve(String(pending.staged ?? ""))) !== resolve(installDir, ".updates")) return undefined;
  } catch { return undefined; }
  const dataDir = dirname(resolve(config.dbPath));
  return {
    targetVersion,
    installDir,
    launcherPath,
    helperPath: join(installDir, ".updates", "restart-helper.mjs"),
    serverPid: process.pid,
    launcherPid: process.ppid,
    stdoutPath: join(dataDir, "server.log"),
    stderrPath: join(dataDir, "server-error.log"),
  };
}

export function scheduleManagedRestart(config: ServerConfig, targetVersion: string, exitDelayMs = 350): ManagedRestartPlan {
  const plan = managedRestartPlan(config, targetVersion);
  if (!plan) throw new Error("Automatic restart is unavailable for this installation");
  mkdirSync(dirname(plan.helperPath), { recursive: true });
  writeFileSync(plan.helperPath, HELPER_SOURCE, "utf8");
  const payload = Buffer.from(JSON.stringify(plan), "utf8").toString("base64url");
  const helper = spawn(process.execPath, [plan.helperPath, payload], {
    cwd: plan.installDir,
    env: process.env,
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  helper.unref();
  setTimeout(() => process.exit(0), exitDelayMs).unref();
  return plan;
}
