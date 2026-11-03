# Risu Cognitive Memory

Risu Cognitive Memory(RCM)는 RisuAI와 PocketRisu의 장기 역할극을 위한 로컬 기억 서버와 플러그인입니다. 이 저장소에는 배포 실행 파일에 대응하는 MPL 2.0 소스 코드와 빌드 도구가 있습니다.

## 처음 설치

1. [최신 릴리스](https://github.com/Pulproom/rcm/releases/latest)에서 운영체제에 맞는 ZIP을 받아 주세요.
   - Windows 10/11 x64: `RCM-windows-x64.zip`
   - macOS x64/arm64, Linux glibc x64/arm64, Docker, Android Termux PRoot: `RCM-node-install.zip`
2. ZIP 안의 `README.md`를 따라 서버를 시작하고, 함께 들어 있는 `risu-cognitive-memory.js`를 Risu 플러그인 `+` 메뉴에서 설치해 주세요.
3. 플러그인 연결 설정에 서버 주소와 토큰을 넣으면 끝이에요.

macOS·Linux·Docker·Termux 경로는 실기기에서 검증하지 않았어요.

## 업데이트

이미 사용 중이라면 ZIP을 다시 받을 필요 없이 **대시보드 홈**에서 업데이트해 주세요. **서버를 먼저**, 플러그인을 나중에 업데이트하면 돼요. 설정과 기억은 그대로 유지돼요.

자동 업데이트를 지원하지 않는 설치(Docker 등)는 ZIP의 `README.md`에 있는 수동 업데이트 방법을 따라 주세요.

설치된 플러그인은 `Risu Cognitive Memory 1.0.25`로 표시됩니다. 관리 → 설정 → 서버에서 제품, 플러그인과 연결된 서버의 설치 버전을 확인할 수 있습니다.

## 자주 묻는 질문

### RCM을 켰더니 지난 채팅이 덜 들어가요

최대 응답(출력)이 너무 크게 잡혀 있지 않은지 확인해 주세요. RCM은 채팅 원문을 자르지 않아요. 하지만 하이파를 끄면 Risu·PocketRisu는 최대 컨텍스트에서 **최대 응답만큼을 답장 자리로 미리 비워 둬요.** 그만큼 지난 채팅이 덜 들어가요.

예를 들어 최대 컨텍스트가 10만이고 최대 응답이 4만이면, 지난 채팅과 프롬프트에 쓸 자리는 6만뿐이에요.

답이 짧은 RP라면 **8천 안팎**, 생각(thinking) 모델이라면 **1만 6천 안팎**을 추천해요. 남는 자리는 지난 채팅이 채워요. 모델 프리셋을 쓴다면 프리셋 안의 최대 출력과 최대 컨텍스트도 함께 확인해 주세요.

## 개발자용: 소스에서 빌드

일반 사용자는 필요 없어요. 코드를 직접 고치거나 빌드하려는 경우에만 Node.js 22.12 이상과 pnpm 10.34.1로 다음을 실행해 주세요.

```powershell
pnpm install
pnpm check
pnpm build
```

RCM은 Mozilla Public License 2.0으로 배포됩니다. 외부 구성요소의 라이선스는 `THIRD_PARTY_NOTICES.md`와 배포 파일의 `licenses/`에서 확인할 수 있습니다.
