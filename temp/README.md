# Temporary & Garbage Files Management

이 디렉토리는 개발, 디버깅, 테스트, 스크린샷 캡처 중 생성되는 임시 및 가비지 파일들을 관리하기 위한 공간입니다.

## 폴더 구조
- `screenshots/`: Playwright, UI 테스트, 브라우저 캡처 스크린샷 (.png, .jpg 등)
- `logs/`: 디버깅 로그, 콘솔 출력 덤프, 일시적 로그 파일 (.log, .txt 등)
- `drafts/`: 일시적 데이터 덤프, 임시 JSON/CSV 등

## 규칙
1. 프로젝트 루트나 소스 디렉토리(`frontend/`, `backend/`, `app/` 등)에 임시 파일을 직접 생성하지 마십시오.
2. 디버깅/테스트 목적으로 파일 생성이 필요한 경우 반드시 `temp/` 하위 디렉토리를 사용하십시오.
3. 이 디렉토리 내의 파일들은 `.gitignore`에 의해 버전 관리에서 제외됩니다.
