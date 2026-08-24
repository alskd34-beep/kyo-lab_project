# KD QC — 디자인 가이드

라이트 테마 · **블루** 액센트 · 선명하고 또렷한(crisp) UI 기준. (Tailwind v4 + lucide-react)

> ## ⚠️ 이 문서는 초안이다 — 색·크기의 단일 기준이 아니다
>
> 이 문서는 `slate-*` 같은 **리터럴 색**을 그대로 적어 두었고, 화면들은 그걸 복사해 왔다.
> 그 결과 같은 회색이 화면마다 다른 값으로 흩어졌고, 디자인 토큰이 있는데도 우회됐다.
>
> **색·폰트 크기·모서리의 단일 기준은 아래 세 곳이다. 충돌하면 그쪽이 이긴다.**
>
> | 무엇 | 어디 |
> |---|---|
> | 색 토큰 | `app/globals.css` 의 `:root` (`--primary` · `--muted-foreground` · `--border` …) |
> | 폰트 크기 | `app/styles/typography.scss` (루트 18px, **최소 13.5px = `text-xs`**) |
> | 컴포넌트 패턴 | `.claude/commands/design-standard.md` (표 · 슬라이드 패널 · 버튼) |
>
> 아래 표에 남은 `text-slate-700` 같은 표기는 **뜻을 읽는 용도**로만 보고,
> 실제 코드에는 오른쪽 열의 **시맨틱 클래스**를 쓴다.

> 원칙
> 1. **선명하게** — 반투명/blur/낮은 opacity 남용 금지. 보더·배경은 또렷한 단색.
> 2. **읽히게** — 본문 최저 명도는 `text-muted-foreground`. 그보다 흐린 색은 쓰지 않는다.
> 3. **블루 액센트 단일화** — 주요 액션·선택·포커스는 모두 `blue`. **초록은 '완료'일 때만**,
>    `indigo`/`violet`/`purple`/`sky` 는 쓰지 않는다.
> 4. **한 화면 = 한 규칙** — 같은 요소엔 같은 radius·padding·border를 쓴다.
> 5. **모바일 필수** — 320 / 375 / 414 / 768 에서 가로 스크롤이 없어야 한다.

---

## 1. 색상 (Color)

### 중립 (Neutral) — **시맨틱 토큰을 쓴다. `slate-*` 리터럴 금지.**
| 용도 | 쓸 것 | (예전 리터럴) |
|---|---|---|
| 제목 · 본문 텍스트 | `text-foreground` | ~~`text-slate-900/700`~~ |
| 보조 텍스트 · 라벨 · placeholder | `text-muted-foreground` | ~~`text-slate-600/500/400`~~ |
| 기본 보더 | `border` (또는 `border-border`) | ~~`border-slate-200/100`~~ |
| 입력 보더 | `border-input` | ~~`border-slate-300`~~ |
| 카드 · 패널 배경 | `bg-card` | ~~`bg-white`~~ |
| 보조 표면 · hover | `bg-muted` / `hover:bg-muted/40` | ~~`bg-slate-50/100`~~ |
| 포커스 링 | `focus-visible:ring-ring` | ~~`ring-blue-100`~~ |

> ⚠️ 토큰을 쓰면 값이 `app/globals.css` 한 곳에서만 바뀐다. 리터럴을 쓰면 화면마다 흩어진다.
> **팔레트 안의 중립값은 예외** — `STAGE_STYLE` 의 `대기`=slate, `Tag` 의 `mono`/`slate` 는 색이 곧 뜻이라 그대로 둔다.

### 액센트 (Primary) — blue
| 용도 | 토큰 |
|---|---|
| 주요 버튼 | `bg-blue-600` · `hover:bg-blue-700` · `text-white` |
| 선택/액티브 배경 | `bg-blue-50` |
| 선택/액티브 텍스트·아이콘 | `text-blue-700` / 아이콘 `text-blue-600` |
| 포커스 링 | `focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200` |
| 링크 | `text-blue-600 hover:text-blue-700` |

### 상태 (Semantic) — 항상 `50/700/200` 3종 세트로
| 상태 | 배경 / 텍스트 / 보더 |
|---|---|
| 성공 (적합·완료) | `bg-emerald-50 text-emerald-700 border-emerald-200` |
| 정보 (검토중) | `bg-blue-50 text-blue-700 border-blue-200` |
| 경고 (대기) | `bg-amber-50 text-amber-700 border-amber-200` |
| 위험 (부적합) | `bg-red-50 text-red-700 border-red-200` |
| 진행중 | `bg-violet-50 text-violet-700 border-violet-200` |

- **live/온라인 점**: `bg-emerald-400` (작은 status dot 전용)
- **카운트 뱃지**: `bg-red-500 text-white`

---

## 2. 타이포그래피 (Typography)

폰트: `font-sans` (Geist). 스케일은 아래로 고정한다.

| 역할 | 클래스 |
|---|---|
| 페이지 제목 | `text-lg font-semibold text-foreground` |
| 섹션 제목 | `text-sm font-semibold text-foreground` |
| 행의 주 값(이름·품목명) | `text-sm font-medium text-foreground` |
| 본문 | `text-sm text-foreground` |
| 라벨 / 힌트 / 부가정보 | `text-xs text-muted-foreground` |
| 테이블 헤더 | `text-xs font-medium text-muted-foreground` |
| KPI 수치 | `text-2xl font-semibold tabular-nums` (경보성은 `text-4xl`) |

> ⚠️ **`text-[11px]` 같은 임의 크기를 쓰지 않는다.** 루트가 18px 이라 최소 크기는
> `text-xs`(13.5px)이고, 그보다 작은 글자는 금지다. 좁아서 안 들어가면 글자를 줄이는 게 아니라
> **정보를 덜어내거나 세로로 쌓는다.**
> ⚠️ **한글에 `uppercase`·`tracking-*` 를 쓰지 않는다.** 한글엔 대문자가 없고 자간만 벌어져 리듬이 깨진다.
> 숫자는 세로로 열을 이루는 곳마다 `tabular-nums`.

> 폰트 두께는 `font-medium`(본문) / `font-semibold`(라벨·헤더) / `font-semibold`(제목·수치)로만. `font-black`은 지양(과함).

---

## 3. 간격 · 모서리 · 그림자

### Radius (표준화)
| 요소 | radius |
|---|---|
| 버튼 · 입력 · 작은 칩 | `rounded-md` |
| 카드 · 패널 · 다이얼로그 | `rounded-md` |
| 상태 뱃지 (pill) | `rounded-full` |
| 카테고리 뱃지 | `rounded-md` |
| 로고/아바타 사각 | `rounded-md` |

### Spacing
- 페이지 패딩: `p-4 md:p-6` (모바일 좁게 → 데스크톱 넓게)
- 섹션 간격: `gap-4` / 그룹 내부: `gap-2`~`gap-3`
- 카드 패딩: `px-4 py-3` (작은 카드 `px-3.5 py-3`)
- 헤더 패딩: `px-4 py-3 md:py-4`

### Shadow (절제)
- 기본 카드: `shadow-sm` (또는 `shadow-none` + 또렷한 보더)
- hover 상승: `hover:shadow-md hover:-translate-y-0.5 transition-all`
- 떠있는 레이어(드롭다운/팝오버): `shadow-lg`
- ❌ blur 배경(`backdrop-blur`)·반투명 표면 남용 금지

---

## 4. 컴포넌트 레시피 (복사용)

### 페이지 셸
```tsx
<div className="flex flex-col gap-4 p-4 md:p-6">
  {/* 헤더 + 섹션들 */}
</div>
```

### 페이지 헤더
```tsx
<div className="flex flex-col gap-3 rounded-md border bg-card px-4 py-3 shadow-sm md:flex-row md:items-start md:justify-between md:py-4">
  <div>
    <h1 className="text-lg font-semibold text-foreground">제품시험 통합 관리</h1>
    <p className="mt-1 text-xs font-medium text-muted-foreground">설명 문구</p>
  </div>
  {/* 우측 액션 버튼들 */}
</div>
```

### 카드 / 패널
```tsx
<div className="rounded-md border bg-card px-4 py-3 shadow-sm">
  …
</div>
```

### 버튼
```tsx
{/* Primary */}
<button className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700">조회</button>

{/* Secondary */}
<button className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted">취소</button>

{/* Danger */}
<button className="… bg-red-600 text-white hover:bg-red-700 …">삭제</button>
```
- 크기: `sm` = `h-7 text-xs`, 기본 = `h-9 text-sm`. 아이콘 `size={15}`.

### 입력
```tsx
<input className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" />
```
- 검색 박스: 좌측 `Search size={14}` 아이콘 + `bg-muted/50`.
- 체크박스: 전역 `.cb-custom` 클래스 사용 (blue-500 체크).

### 테이블
```tsx
<thead>
  <tr className="border-b bg-muted/50">
    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">컬럼</th>
  </tr>
</thead>
<tbody>
  <tr className="border-b text-sm text-foreground hover:bg-muted/40">
    <td className="px-3 py-2.5">값</td>
  </tr>
</tbody>
```
- 선택 행: `bg-blue-50`. 짝수행 음영이 필요하면 `bg-muted/50/60`.

### 상태 뱃지
```tsx
<span className="inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium
  bg-emerald-50 text-emerald-700 border-emerald-200">적합완료</span>
```
색만 §1 상태표에서 교체해 재사용.

### 아바타
```tsx
<div className="flex size-8 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">홍</div>
```
- 사용자 구분색 팔레트: `blue / violet / emerald / amber / rose`-500.

---

## 5. 아이콘 (lucide-react)

| 맥락 | size |
|---|---|
| 토글/핀/별 | 11–12 |
| 툴바·인풋 내부 | 13–14 |
| 액션 버튼 | 15 |
| 사이드바 내비 | 18 |
| 다이얼로그 헤더 | 20 |

- 색: 기본 `text-muted-foreground`, 액티브 `text-blue-600`.
- 라이브러리는 lucide-react로 통일 (다른 아이콘셋 혼용 금지).

---

## 6. 내비게이션 (사이드바)

기준 구현: [frontend/components/dashboard/app-sidebar.tsx](frontend/components/dashboard/app-sidebar.tsx)
(shadcn `ui/sidebar` 기반. **`dashboard/sidebar.tsx` 는 미사용 레거시다 — 참고하지 말 것.**)

- 섹션 라벨: `text-xs font-medium text-muted-foreground` — 대문자·자간확장 없이.
- 항목: 아이콘(18) + 라벨(`text-sm font-medium text-foreground`), hover `bg-muted`.
- 표면·보더는 `bg-sidebar` / `border-sidebar-border` 토큰을 쓴다.
- **액티브**: `bg-blue-50 text-blue-700` + 아이콘 `text-blue-600`.
- 하위 메뉴: 좌측 가이드라인(`border-l border-border`) + 상태 점.
- 상단 글로벌 바: `h-12 bg-card border-b border-border`.

---

## 7. 반응형 (Responsive)

모바일 퍼스트. Tailwind 기본 브레이크포인트를 그대로 쓴다.

| 토큰 | 폭 | 대상 |
|---|---|---|
| (기본) | `< 640px` | 모바일 |
| `sm:` | `≥ 640px` | 큰 모바일 / 작은 태블릿 |
| `md:` | `≥ 768px` | 태블릿 |
| `lg:` | `≥ 1024px` | 데스크톱 — **사이드바 분기점** |
| `xl:` | `≥ 1280px` | 와이드 |

### 핵심 규칙
- **사이드바**: `lg` 미만은 오버레이 **드로어**(햄버거로 열고 backdrop/ESC로 닫음), `lg` 이상은 인라인 고정. 기준 구현은 [app-sidebar.tsx](frontend/components/dashboard/app-sidebar.tsx) + [app/(menu)/layout.tsx](app/(menu)/layout.tsx).
- **햄버거 버튼**: 상단 바에 `lg:hidden`으로만 노출.
- **페이지 패딩**: `p-4 md:p-6` (모바일 좁게 → 데스크톱 넓게).
- **헤더 행**: 모바일 세로 → 데스크톱 가로. `flex flex-col gap-3 md:flex-row md:items-start md:justify-between`.
- **본문 가로 스크롤 금지**: 컨테이너는 `overflow-x-hidden`, 넓은 표만 래퍼에서 `overflow-x-auto`.

### 그리드 (KPI/카드)
```tsx
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">…</div>
```
- 1열(모바일) → 2열(`sm`) → 4열(`lg`). 3개 묶음은 `sm:grid-cols-2 lg:grid-cols-3`.

### 테이블
- 모바일에선 래퍼 `overflow-x-auto`로 가로 스크롤 허용:
  ```tsx
  <div className="overflow-x-auto">
    <table className="w-full min-w-[640px]">…</table>
  </div>
  ```
- 또는 부차 컬럼을 `hidden md:table-cell`로 숨김.

### 숨김/표시 유틸
- 데스크톱 전용: `hidden lg:block` / 모바일 전용: `lg:hidden`.
- 라벨 축약: 좁은 화면에서 텍스트 숨기고 아이콘만 → `<span className="hidden sm:inline">…</span>`.

### 터치 타깃
- 모바일 탭 영역 최소 `h-9`(36px) 이상. 아이콘 버튼은 `p-2`로 패딩 확보.

---

## 8. 체크리스트 (PR 전 확인)

- [ ] 본문 텍스트가 `slate-600` 이상으로 또렷한가? (흐린 회색 금지)
- [ ] 주요 액션/선택/포커스가 모두 **blue**인가?
- [ ] 카드=`rounded-md`, 버튼/입력=`rounded-md`로 일관적인가?
- [ ] 상태 표시는 `50/700/200` 3종 세트인가?
- [ ] 아이콘은 lucide + 규정 size인가?
- [ ] 불필요한 `backdrop-blur`·반투명 표면이 없는가?
- [ ] 모바일(`< lg`)에서 사이드바가 드로어로 동작하고 햄버거가 보이는가?
- [ ] 좁은 화면에서 가로 스크롤이 생기지 않는가? (넓은 표는 래퍼만 스크롤)
- [ ] 그리드가 모바일 1열 → `sm`/`lg`에서 적절히 늘어나는가?
