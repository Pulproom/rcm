import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const config=JSON.parse(readFileSync(join(root,"release-config.json"),"utf8"));
const body=readFileSync(join(root,"artifacts/release-candidate",config.productVersion,"release-body.md"),"utf8");
const required=[
  "일반 사용자는 GitHub Releases에서 운영체제에 맞는 설치 파일을 받아 주세요.",
  "Windows 10/11 x64: RCM-windows-x64.zip",
  "macOS x64/arm64, Linux glibc x64/arm64, Docker, Android Termux PRoot: RCM-node-install.zip",
  "macOS·Linux·Docker·Android Termux PRoot는 실기기에서 검증하지 않았습니다.",
  ...config.releaseNotes,
];
for(const text of required)if(!body.includes(text))throw new Error(`Release body is missing required text: ${text}`);
console.log(JSON.stringify({version:config.productVersion,requiredText:required.length}));
