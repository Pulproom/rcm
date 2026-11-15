# Third-party notices

## Runtime dependencies

이 프로젝트는 package lock에 기록된 오픈 소스 라이브러리를 사용한다. 주요 직접 의존성은 Hono, better-sqlite3, sqlite-vec, Zod, fflate, jsonrepair, Undici다. 재배포 시 `pnpm licenses list --prod`를 다시 확인한다.

`jsonrepair` 3.15.0 (ISC, Copyright (c) 2020-2026 by Jos de Jong)은 shared의 로컬 모델 JSON 문법 복구에 사용한다. 전이 의존성은 없다. 서버·플러그인 번들에 포함되며 `deploy/distribution/build.mjs`가 번들 metafile에서 패키지를 찾아 원본 `LICENSE.md`를 배포물의 `licenses/jsonrepair-LICENSE.md`로 복사하고 `NOTICE.txt`에 버전·라이선스를 기록한다.

`undici` 7.30.2 (MIT, 저작권 고지는 원본 `LICENSE` 참조)는 서버 provider 호출 전용 dispatcher에 사용한다. 전이 의존성은 없고 Node 20.18.1 이상을 지원한다. 프로젝트의 Node 22.12 이상 계약 안에서 동작하며, 배포 도구는 서버 번들 metafile을 통해 원본 `LICENSE`와 버전·라이선스 고지를 자동 포함한다.

`voyage-context-4` 임베딩은 사용자가 구성한 Voyage AI 외부 API 서비스다. API key는 개인 서버 환경 변수에만 보관하며 Risu 플러그인, SQLite 백업, 로그에 포함하지 않는다. 서비스 이용 조건과 데이터 처리 설정은 사용자의 Voyage 계정에 따른다.

## Reviewed reference projects

다음 프로젝트는 동작과 설계를 조사했지만 소스 코드를 포함하거나 개작하지 않았다.

- Archive Center v4.0.0, MPL-2.0, copyright 2026 Archive Center contributors
- LIBRA v1.0.65, AGPL-3.0 license file present
- HAYAKU v2.4.32, AGPL-3.0 license file present
- Flashback Memory v0.11.26, AGPL-3.0 license file present
- WygLoreLeaf 3.0.13, author metadata “WygLore Leaf contributors”; downloaded artifact에서 명시적 배포 라이선스는 확인되지 않음
- NMOS v0.4.0, MIT, copyright 2026 Sallos725; commit과 조사 범위는 [NMOS 리뷰](docs/memory-plugin-review/reports/07-nmos.md) 참조, 소스·문구·prompt·UI 재사용 없음
- Mask Local Tools v0.1.2 SDK, LicenseRef-Mask-Software-Personal-1.1; 공개 authoring contract만 상호운용성 참고 자료로 사용

설계 채택 범위와 원본 경로/commit은 [docs/reference-adoption.md](docs/reference-adoption.md) 및 이전된 조사 보고서에 기록한다. 특히 AGPL 및 라이선스 불명 소스는 이 코드베이스로 복사하지 않는다.
