# Supabase 셋업 가이드

이 디렉터리에는 KD QC 어시스턴트가 사용하는 Postgres 스키마와 시드 데이터가 들어 있습니다.

## 1. Supabase 프로젝트 만들기

1. https://supabase.com/dashboard 에서 새 프로젝트 생성
2. **Project Settings → API** 페이지에서 다음 값 복사:
   - `Project URL`             → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key         → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret` key → `SUPABASE_SERVICE_ROLE_KEY` (서버 전용)

## 2. 환경변수 설정

프로젝트 루트의 `.env.local.example`을 복사해 `.env.local`로 만들고 위에서 복사한 값을 채웁니다.

```bash
cp .env.local.example .env.local
```

> ⚠️ **`.env.local` 은 절대 커밋하지 않습니다.** `.gitignore` 의 `.env*.local` 규칙으로 제외됩니다.
> (2026-08-22 이전에는 이 규칙이 주석 처리되어 실제 키가 저장소에 커밋돼 있었습니다 — 키 로테이션 필요.)

챗봇 공급자 키는 역할별로 다릅니다. `AGENTS.md` 의 **AI providers** 표를 참고하세요
(`MISO_*` = 시험자 챗봇, `LETSUR_*` = 관리자 챗봇(운영), `ANTHROPIC_API_KEY` = AI 주간 스케줄).
Dify 관련 변수는 더 이상 사용하지 않습니다.

## 3. 마이그레이션 적용

### 옵션 A: Supabase Dashboard SQL Editor

1. **SQL Editor** 메뉴 진입
2. `migrations/0001_init_qc_schema.sql` 내용 붙여넣기 → Run
3. `migrations/0002_seed_qc_demo.sql` 내용 붙여넣기 → Run (데모 데이터 8건)
4. `migrations/0003_auth.sql` 내용 붙여넣기 → Run (사용자/리프레시 토큰 테이블)

### 마이그레이션 번호 규칙

- 파일명은 `NNNN_<snake_case>.sql`, **번호는 절대 재사용하지 않는다.**
- 새 번호를 붙이기 전에 **머지되지 않은 브랜치까지 확인**한다:
  ```bash
  git log --all --name-only --pretty=format: -- 'supabase/migrations/*' | sort -u | tail -20
  ```
  (예: `main` 은 0025 → 0027 로 건너뛰는데, `0026_workload_standard.sql` 은
  미머지 브랜치 `feat/workload-standard-and-leave-guard` 가 점유 중이다.)
- 모든 DDL 은 `if not exists` / `on conflict do nothing` 으로 **재실행 가능하게** 작성한다.
- 코드가 참조하는 테이블은 반드시 마이그레이션에 정의가 있어야 한다. 확인 방법:
  ```bash
  # 코드가 쓰는 테이블 - 마이그레이션이 만드는 테이블 = 비어 있어야 정상
  grep -rhoE "\.from\('[a-z_]+'\)" backend app --include=*.ts | sed "s/\.from('//;s/')//" | sort -u > /tmp/used
  grep -rhoiE "create table (if not exists )?[a-z_]+" supabase/migrations/*.sql     | sed -E 's/create table //I; s/if not exists //I' | tr 'A-Z' 'a-z' | sort -u > /tmp/made
  comm -23 /tmp/used /tmp/made
  ```

### 옵션 B: Supabase CLI

```bash
# 처음 한 번
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>

# 적용
supabase db push
```

## 4. 동작 확인

```bash
npm run dev
```

- 대시보드 하단 "데모 모드" 배지가 사라지면 Supabase 연결 성공
- 챗봇은 역할별 공급자 키(`MISO_*` / `LETSUR_*`)가 채워져야 응답 가능

## 5. 스키마 개요

| 테이블 | 용도 |
| --- | --- |
| `managers`            | QC 담당자 |
| `contractors`         | 수탁사 |
| `tests`               | 시험 (모든 탭에서 공유, `is_deviation`으로 일탈관리 분기) |
| `stability_tests`     | 안정성 시험 부가 정보 (1:1) |
| `deviations`          | 일탈/OOS 사유, 근본원인, CAPA |
| `chat_conversations`  | 챗봇 대화 메타 (Dify conversation_id 포함) |
| `chat_messages`       | 챗봇 메시지 이력 |
| `users`               | 로그인 사용자 (admin/user 역할) |
| `auth_refresh_tokens` | JWT refresh token rotation/폐기 관리 |

## 7. 기본 관리자 계정

서버 시작 후 첫 로그인 시도 시 자동으로 기본 admin이 생성됩니다.

```text
ID: kyo-admin
PW: kyo-admin
```

운영 배포 전 반드시 비밀번호를 변경하세요(우상단 메뉴 → 비밀번호 변경).
또한 `.env.local`의 `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`을 강력한 랜덤 값으로 교체해야 합니다.

## 6. RLS (Row Level Security)

현재 마이그레이션은 RLS를 활성화하지 않습니다.
운영 배포 전 다음을 검토하세요:

- 익명 키(`anon`)로 접근 가능한 테이블 범위
- 사용자별 분리 정책 (`chat_conversations.user_key` 기반 등)
- `service_role` 키는 서버 사이드(API Route)에서만 사용
