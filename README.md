# Risu Cognitive Memory

Risu Cognitive Memory(RCM)는 RisuAI와 PocketRisu의 장기 역할극을 위한 로컬 기억 서버와 플러그인입니다. 이 저장소에는 배포 실행 파일에 대응하는 MPL 2.0 소스 코드와 빌드 도구가 있습니다.

일반 사용자는 GitHub Releases에서 운영체제에 맞는 설치 파일을 받아 주세요.

- Windows 10/11 x64: `RCM-windows-x64.zip`
- macOS x64/arm64, Linux glibc x64/arm64, Docker, Android Termux PRoot: `RCM-node-install.zip`

각 ZIP의 `README.md`에 설치, 시작, 중지, 업데이트와 제거 방법이 안내되어 있습니다. macOS·Linux·Docker·Termux 경로는 실기기 검증 상태를 릴리스 설명에서 확인해 주세요.

설치된 플러그인은 `Risu Cognitive Memory 1.0.11`로 표시됩니다. 관리 → 설정 → 서버에서 제품, 플러그인과 연결된 서버의 설치 버전을 확인할 수 있습니다.

## 소스 빌드

Node.js 22.12 이상과 pnpm 10.34.1이 필요합니다.

```powershell
pnpm install
pnpm check
pnpm build
```

RCM은 Mozilla Public License 2.0으로 배포됩니다. 외부 구성요소의 라이선스는 `THIRD_PARTY_NOTICES.md`와 배포 파일의 `licenses/`에서 확인할 수 있습니다.
