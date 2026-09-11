# intent/

코드를 쓰기 전에 **무엇을 왜 만드는지** 먼저 남기는 폴더.

- **작성 방법**: `/intent <하고 싶은 일>` — Claude가 인터뷰해서 파일을 만들어 준다.
- **템플릿**: [`TEMPLATE.md`](./TEMPLATE.md)
- **전체 가이드**: [`docs/ai-native-sdlc.md`](../docs/ai-native-sdlc.md)
- **파일명**: `YYYY-MM-DD-슬러그.md` (파일명은 영문 kebab-case, 내용은 한국어)

## 규칙 요약

| 항목 | 규칙 |
|---|---|
| 섹션 | Problem · Proposed outcome · Affected users and systems · Constraints · Open questions — 5개만 |
| 금지 | "어떻게"(기술 선택·구현 방법)를 쓰지 않는다 |
| Status | `draft` → `approved` → `completed` (폐기는 `abandoned`, 삭제 금지) |
| 커밋 | `approved` 시점에 intent를 먼저 커밋 · `completed`는 코드와 같은 커밋에서 |
| 생략 | 오타·문구·색 수정, 동작 규칙이 안 바뀌는 버그 수정, 겉보기 동작 그대로인 리팩터링 |
| 필수 | 새 화면·새 테이블·권한 변경·상태 전이 변경·외부 연동·크론 추가 |
| `-spec.md` 추가 | **마이그레이션 동반 · 권한/인증 규칙 · 확정(LOCK)/상태 전이 규칙** 변경 시에만 `<같은이름>-spec.md` 를 같이 둔다 (그 외에는 `spec.md` 생략) |
