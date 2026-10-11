# Risu Cognitive Memory Node 설치 안내

이 설치 파일은 **macOS x64/arm64, Linux glibc x64/arm64, Docker, Android Termux PRoot**용입니다. Node.js 런타임은 포함하지 않습니다. Windows x64에서는 별도로 제공되는 Windows 설치 파일을 사용해 주세요.

현재 macOS·Linux·Docker·Termux 환경은 설치 절차만 준비되어 있으며 실기기 검증 전입니다.

## macOS 및 Linux

Node.js 22.12 이상과 npm이 필요합니다. 네이티브 모듈 설치를 위해 Python 3, make, C/C++ 컴파일러가 필요할 수 있습니다. macOS에서는 Xcode Command Line Tools, Debian/Ubuntu에서는 `build-essential`을 사용할 수 있습니다.

1. ZIP 파일을 원하는 설치 폴더에 압축 해제해 주세요.
2. 설치 폴더에서 `npm install --omit=dev`를 실행해 주세요.
3. `sh start.sh`를 실행해 주세요. Ctrl+C를 누르면 서버가 종료됩니다.
4. 설치 폴더 옆 `RCM-user-data/connection.json`의 주소와 토큰을 RCM 플러그인에 입력해 주세요.
5. RisuAI 또는 PocketRisu에 `risu-cognitive-memory.js`를 설치하고 `[[RCM]]` 위치를 지정한 뒤 대시보드에서 Voyage와 보조 모델을 설정해 주세요. 플러그인 목록에는 `Risu Cognitive Memory 1.0.0`으로 표시됩니다.

## Docker

Docker와 Compose를 설치한 뒤 이 폴더에서 `docker compose up --build -d`를 실행해 주세요. 기억과 설정은 `rcm-data` 볼륨에 저장됩니다.

- 연결 정보: `docker compose exec rcm cat /data/connection.json`
- 로그 확인: `docker compose logs rcm`
- 종료: `docker compose down`

`docker compose down -v`는 사용자 데이터 볼륨을 삭제하므로 사용하지 마세요.

## Android Termux PRoot

arm64 또는 x64 기기에서 Termux의 `proot-distro`로 Debian 또는 Ubuntu 환경에 들어간 뒤 위 Linux 절차를 따라 주세요. Node.js 22.12 이상과 빌드 도구도 PRoot 환경 안에 설치해야 합니다. Android의 절전 정책이 백그라운드 서버를 중단할 수 있으므로 실제 기기에서 실행 유지 상태를 확인해 주세요.

## 업데이트

대시보드와 플로팅 UI에서 새 버전을 자동으로 확인합니다. 대시보드에서 서버 업데이트를 설치하면 검증된 `server.mjs`를 준비하고 서버를 다시 시작한 뒤 적용 결과를 확인합니다. 시작 검증에 실패하면 이전 서버 파일을 복원합니다. 예전 버전에서 자동 업데이트 기능이 들어간 버전으로 처음 넘어갈 때에만 서버를 수동으로 다시 시작해야 할 수 있습니다. 그다음 Risu의 플러그인 `+` 메뉴에서 플러그인을 업데이트해 주세요.

사용자 설정과 기억은 설치 폴더 옆 `RCM-user-data` 또는 Docker의 `rcm-data`에 보존됩니다. 업데이트 전 대시보드에서 전체 백업을 만들어 두시기를 권장합니다. 전체 백업을 다른 설치에 복원해도 복원 대상의 서버 주소와 토큰은 유지됩니다. 설치 폴더를 수동 교체하더라도 사용자 데이터 폴더나 볼륨은 삭제하지 마세요.

서버는 기본적으로 `127.0.0.1`에만 연결됩니다. RCM은 Mozilla Public License 2.0으로 배포되며 외부 구성요소 라이선스는 `licenses/`에서 확인할 수 있습니다.
