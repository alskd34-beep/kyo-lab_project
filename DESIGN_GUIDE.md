# KD QC — 디자인 가이드

라이트 테마 · **블루** 액센트 · 선명하고 또렷한(crisp) UI 기준.
모든 화면은 이 가이드의 토큰·레시피를 **그대로 복사해서** 사용한다. (Tailwind v4 + lucide-react)

> 원칙
> 1. **선명하게** — 반투명/blur/낮은 opacity 남용 금지. 보더·배경은 또렷한 단색.
> 2. **읽히게** — 본문 최저 명도는 `slate-600`. 그보다 흐린 색은 보조 라벨에만.
> 3. **블루 액센트 단일화** — 주요 액션·선택·포커스는 모두 `blue`. 그린/바이올렛은 상태표시 전용.
> 4. **한 화면 = 한 규칙** — 같은 요소엔 같은 radius·padding·border를 쓴다.

---

## 1. 색상 (Color)

### 중립 (Neutral) — slate
| 용도 | 토큰 |
|---|---|
| 최상위 제목 텍스트 | `text-slate-900` (강조 시 `text-slate-950`) |
| 본문 / 기본 텍스트 | `text-slate-700` |
| 보조 텍스트 / 설명 | `text-slate-600` |
| 흐린 라벨 / placeholder | `text-slate-500` |
| 비활성 / 섹션 헤더 | `text-slate-400` |
| 기본 보더 | `border-slate-200` |
| 입력/구분선 강조 보더 | `border-slate-300` |
| 페이지 배경 | `bg-slate-100` |
| 카드/패널 배경 | `bg-white` |
| 보조 표면 (검색창, hover) | `bg-slate-50` / `hover:bg-slate-100` |

> ⚠️ 본문에 `slate-400` 이하를 쓰지 않는다 (가독성). 흐릿함의 주원인.

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
| 페이지 제목 | `text-lg font-bold text-slate-900` (작은 화면 `text-base`) |
| 섹션 제목 | `text-sm font-semibold text-slate-900` |
| 본문 | `text-sm font-medium text-slate-700` |
| 라벨 / 힌트 | `text-xs font-medium text-slate-600` |
| 테이블 헤더 / 마이크로 라벨 | `text-[11px] font-semibold text-slate-500` |
| 섹션 구분 라벨 (대문자) | `text-[11px] font-semibold tracking-[0.12em] text-slate-400` |
| KPI 수치 | `text-[22px] font-bold text-slate-900` |

> 폰트 두께는 `font-medium`(본문) / `font-semibold`(라벨·헤더) / `font-bold`(제목·수치)로만. `font-black`은 지양(과함).

---

## 3. 간격 · 모서리 · 그림자

### Radius (표준화)
| 요소 | radius |
|---|---|
| 버튼 · 입력 · 작은 칩 | `rounded-lg` |
| 카드 · 패널 · 다이얼로그 | `rounded-xl` |
| 상태 뱃지 (pill) | `rounded-full` |
| 카테고리 뱃지 | `rounded-md` |
| 로고/아바타 사각 | `rounded-xl` |

### Spacing
- 페이지 패딩: `p-3 md:p-5`
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
<div className="flex flex-col gap-4 p-3 md:p-5">
  {/* 헤더 + 섹션들 */}
</div>
```

### 페이지 헤더
```tsx
<div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-start md:justify-between md:py-4">
  <div>
    <h1 className="text-base font-bold text-slate-900 sm:text-lg">제품시험 통합 관리</h1>
    <p className="mt-1 text-xs font-medium text-slate-600">설명 문구</p>
  </div>
  {/* 우측 액션 버튼들 */}
</div>
```

### 카드 / 패널
```tsx
<div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
  …
</div>
```

### 버튼
```tsx
{/* Primary */}
<button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700">조회</button>

{/* Secondary */}
<button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100">취소</button>

{/* Danger */}
<button className="… bg-red-600 text-white hover:bg-red-700 …">삭제</button>
```
- 크기: `sm` = `h-7 text-xs`, 기본 = `h-9 text-sm`. 아이콘 `size={15}`.

### 입력
```tsx
<input className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 transition-colors focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:outline-none" />
```
- 검색 박스: 좌측 `Search size={14}` 아이콘 + `bg-slate-50`.
- 체크박스: 전역 `.cb-custom` 클래스 사용 (blue-500 체크).

### 테이블
```tsx
<thead>
  <tr className="border-b border-slate-200 bg-slate-50">
    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">컬럼</th>
  </tr>
</thead>
<tbody>
  <tr className="border-b border-slate-100 text-sm text-slate-700 hover:bg-slate-50">
    <td className="px-3 py-2.5">값</td>
  </tr>
</tbody>
```
- 선택 행: `bg-blue-50`. 짝수행 음영이 필요하면 `bg-slate-50/60`.

### 상태 뱃지
```tsx
<span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold
  bg-emerald-50 text-emerald-700 border-emerald-200">적합완료</span>
```
색만 §1 상태표에서 교체해 재사용.

### 아바타
```tsx
<div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">홍</div>
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

- 색: 기본 `text-slate-500`, 액티브 `text-blue-600`.
- 라이브러리는 lucide-react로 통일 (다른 아이콘셋 혼용 금지).

---

## 6. 내비게이션 (사이드바)

기준 구현: [frontend/components/dashboard/sidebar.tsx](frontend/components/dashboard/sidebar.tsx)

- 라이트 단일 컬럼, 폭 `252px` (접힘 `68px`), `bg-white border-r border-slate-200`.
- 섹션 라벨: `text-[11px] font-semibold tracking-[0.12em] text-slate-400`.
- 항목: 아이콘(18) + 라벨(`text-sm font-medium text-slate-700`), hover `bg-slate-100`.
- **액티브**: `bg-blue-50 text-blue-700` + 아이콘 `text-blue-600`.
- 하위 메뉴: 좌측 가이드라인(`border-l border-slate-200`) + 상태 점.
- 상단 글로벌 바: `h-12 bg-white border-b border-slate-200`.

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
- **사이드바**: `lg` 미만은 오버레이 **드로어**(햄버거로 열고 backdrop/ESC로 닫음), `lg` 이상은 인라인 고정. 기준 구현은 [sidebar.tsx](frontend/components/dashboard/sidebar.tsx) + [app/(menu)/layout.tsx](app/(menu)/layout.tsx).
- **햄버거 버튼**: 상단 바에 `lg:hidden`으로만 노출.
- **페이지 패딩**: `p-3 md:p-5` (모바일 좁게 → 데스크톱 넓게).
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
- [ ] 카드=`rounded-xl`, 버튼/입력=`rounded-lg`로 일관적인가?
- [ ] 상태 표시는 `50/700/200` 3종 세트인가?
- [ ] 아이콘은 lucide + 규정 size인가?
- [ ] 불필요한 `backdrop-blur`·반투명 표면이 없는가?
- [ ] 모바일(`< lg`)에서 사이드바가 드로어로 동작하고 햄버거가 보이는가?
- [ ] 좁은 화면에서 가로 스크롤이 생기지 않는가? (넓은 표는 래퍼만 스크롤)
- [ ] 그리드가 모바일 1열 → `sm`/`lg`에서 적절히 늘어나는가?
