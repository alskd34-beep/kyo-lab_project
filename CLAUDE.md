# CLAUDE.md

이 프로젝트의 아키텍처·컨벤션·작업 규칙은 **[AGENTS.md](./AGENTS.md)** 를 단일 기준으로 따른다.
하위 디렉터리(`app/`, `backend/`, `frontend/`, `app/api/`)에도 각각 `AGENTS.md`가 있으니 해당 영역 작업 시 함께 참고한다.

## QC 시험 스케줄 자동배정 프로세스
제조팀 생산계획(구글시트) → QC 시험 스케줄 자동생성 → AI 배정 추천 → 관리자 확정·LOCK 워크플로우의
전체 요구사항과 구현 현황은 **[.claude/commands/qc-schedule-process.md](./.claude/commands/qc-schedule-process.md)** (슬래시 커맨드 `/qc-schedule-process`) 및 **[docs/qc-schedule-status.md](./docs/qc-schedule-status.md)** 를 기준으로 한다.
현재 시스템 전체의 as-built PRD는 **[docs/PRD-current-system.md](./docs/PRD-current-system.md)**, 단계별 동작 흐름은 **[docs/WORKFLOW-current-system.md](./docs/WORKFLOW-current-system.md)** 를 참고한다.

## 핵심 작업 규칙 (AGENTS.md 요약)
- 3계층 분리: 페이지/컴포넌트(frontend) → API 라우트 핸들러(`app/api`, thin) → 서비스(`backend/services`, 로직+Supabase).
- DB 컬럼은 snake_case, 앱/도메인 레이어는 camelCase. 서비스가 `mapRow`로 매핑.
- import는 path alias 사용: `@/* @frontend/* @backend/* @shared/*`. 깊은 상대경로 금지.
- `@backend/*`(서비스·supabase·시크릿)를 클라이언트 컴포넌트에 import 금지(서버 전용).
- 한국어가 제품 언어. 주석·UI 문자열·에러 메시지는 한국어, 코드 식별자는 영어.
- 날짜 입력은 공통 `<DateField>` 사용(`/date-field` 스킬 참고), `<input type="date">` 직접 사용 금지.
- 데이터 수정 UX는 인라인보다 모달/Dialog 기본.
- 임시/가비지 파일 관리: 스크린샷, 디버그 로그, 덤프 등 임시 파일은 루트나 소스 디렉토리가 아닌 `temp/` 디렉토리(`temp/screenshots/`, `temp/logs/` 등) 아래에만 생성한다.
- 브랜드 메인 컬러는 파랑(blue) 하나로 통일. 버튼·강조색은 `bg-primary` 등 시맨틱 클래스나 `blue-*`만 쓰고 `indigo-*`/`violet-*`/`purple-*`/`sky-*`를 새로 쓰지 않는다(상태·카테고리 팔레트, 성공 배너 등 색 자체가 의미인 곳은 예외).
- 타이포그래피는 Pretendard(변수 폰트) 하나로 통일. 폰트 파일은 저장소 내 `frontend/assets/fonts/PretendardVariable.woff2`를 `app/layout.tsx`의 `next/font/local`로 셀프 호스팅(`--font-sans`). 새 폰트 import 금지.
- 폰트 종류·크기의 단일 기준은 `app/styles/typography.scss`(루트 18px, **최소 13.5px** = Tailwind `text-xs`). 크기 변경은 이 파일에서만 하고, `text-xs`보다 작은 폰트는 쓰지 않는다. Tailwind `text-*` 스케일은 `app/globals.css`의 `@theme`에 rem으로 선언.
- 모서리 둥글기는 `rounded-md` 하나로 고정. 아바타·점(dot)·원형 아이콘 버튼처럼 원형이 꼭 필요한 곳만 `rounded-full` 예외, 그 외 `rounded-sm`/`lg`/`xl`/`2xl`/`3xl`/`4xl`를 새로 쓰지 않는다.
- 검증: `npm run typecheck`(필수) · `npm run lint` · 운영 영향 시 `npm run build`. dev 서버 포트 3300.

