# 디자인 표준 — 테이블 · 슬라이드 수정 패널 · 버튼

> **"디자인 스킬"이라고 말하면 이 문서를 참조한다.**
>
> 기반 UI 라이브러리: [shadcn/ui](https://ui.shadcn.com/) — 모든 컴포넌트는 shadcn/ui 기본을 사용하며, 아래 패턴은 이 프로젝트의 확장 표준이다.
> 컴포넌트 목록 전체: [https://ui.shadcn.com/docs/components](https://ui.shadcn.com/docs/components)
> AI 컴포넌트 생성기: [https://ui.shadcn.com/create](https://ui.shadcn.com/create) — 프롬프트로 shadcn UI 컴포넌트/레이아웃을 즉시 생성. 새 UI 패턴이 필요할 때 여기서 먼저 생성 후 프로젝트에 적용한다.
>
> **사용 가능한 주요 컴포넌트 (70+)**
>
> | 분류 | 컴포넌트 |
> |------|---------|
> | 폼/입력 | Accordion, Badge, Button, Calendar, Checkbox, Combobox, Command, Input, Label, Radio Group, Select, Slider, Switch, Textarea, Toggle |
> | 표시 | Alert, Alert Dialog, Avatar, Card, Carousel, Chart, Progress, Skeleton, Table |
> | 탐색 | Breadcrumb, Context Menu, Dropdown Menu, Navigation Menu, Pagination, Sidebar, Tabs |
> | 레이아웃 | Collapsible, Data Table, Drawer, Resizable, Scroll Area, Separator, **Sheet** |
> | 피드백 | **Dialog**, Popover, Sonner, Toast, Tooltip |
>
> 이 프로젝트 import 경로: `@frontend/components/ui/<component-name>`
>
> 기준 페이지: `/test-mgmt/testers` (`app/(menu)/test-mgmt/testers/page.tsx`)

이 문서는 프로젝트 전체 UI의 표준 패턴을 정의한다.
새 페이지 작성·기존 페이지 리팩터링 시 반드시 이 패턴을 따른다.

> **⚡ 자동 적용 규칙**: 화면에 데이터를 불러올 때는 **항상 Skeleton**을 사용한다.
> `"불러오는 중..."` 텍스트, `<Loader2>` 스피너, 빈 카드 등 모든 로딩 표현을 Skeleton으로 교체한다.

> **🎨 자동 적용 규칙 — 브랜드 메인 컬러**: 파랑(blue) 하나로 통일한다.
> `app/globals.css`의 `--primary` / `--ring` / `--sidebar-primary` / `--sidebar-accent` / `--secondary`가
> 전부 이 색(`oklch(.. .. 262.88)`, Tailwind `blue-600` 기준)이다.
> - 버튼·아이콘 칩·포커스 링·선택된 탭/메뉴·"활성" 상태처럼 브랜드·인터랙션 강조색이 필요하면
>   먼저 시맨틱 클래스(`bg-primary`, `text-primary`, `ring-ring`, `<Button>` 기본 variant)를 쓴다 — 자동으로 통일된다.
> - 직접 Tailwind 색을 써야 하면 반드시 `blue-*`를 쓴다. `indigo-*` / `violet-*` / `purple-*` / `sky-*` 등
>   다른 파랑·보라 계열을 브랜드 강조색으로 새로 쓰지 않는다.
> - **예외(바꾸지 않는다)**: 검토중/진행중/완료/지연처럼 여러 색이 순환하는 상태·카테고리 팔레트
>   (`Tag`의 `indigo`="공지" 포함), 성공 토스트(초록), 요일 색(토·일) 등 색상 자체가 의미인 곳.

> **🔤 자동 적용 규칙 — 타이포그래피**: Pretendard(변수 폰트) 하나로 통일한다.
> `app/layout.tsx`에서 `next/font/local`로 `pretendard` 패키지의 `PretendardVariable.woff2`를 로드해
> `--font-sans`에 매핑한다. 새 폰트를 추가로 import하지 않는다. 고정폭은 기존 `--font-mono`(Geist Mono) 유지.

> **⬜ 자동 적용 규칙 — 모서리 둥글기**: `rounded-md` 하나로 고정한다. `rounded-sm`/`lg`/`xl`/`2xl`/`3xl`/`4xl`를
> 새로 쓰지 않는다. 예외는 **원형이 기능상 꼭 필요한 곳**뿐이다 — 아바타, 상태 점(dot), 원형 아이콘 버튼,
> 알림 카운트 뱃지(`h-N min-w-N` + `rounded-full`). 진행률 바·칩/배지·직접 만든 달력 셀 등은 전부 `rounded-md`.

---

## 1. 테이블 (Table)

목록 표의 컬럼 합침·펼침은 **[표 컬럼 자동 합침](../../docs/table-adaptive-columns.md)** 을 따른다.  
묶음은 필드 2개(`CellStack` + `SortColumnHeader.fields`)만. px 단계·`COLUMN_LEVELS`를 화면마다 두지 않는다.

### 카드 래퍼

```tsx
<Card className="hidden gap-0 overflow-hidden py-0 md:flex">
  <Table>...</Table>
</Card>
```

- `gap-0 overflow-hidden py-0` — Card 내부 여백 제거
- `hidden md:flex` — 데스크톱 전용 (모바일은 아래 카드 목록 사용)
- **`md:block` 을 쓰지 않는다.** Card 기본값이 `flex flex-col` 인데 `block` 으로 덮으면
  안쪽 Table 컨테이너의 `min-h-0 flex-1` 이 무력화돼 표가 세로로 잘린다.

### 모바일 카드 목록 — **`<Table>` 을 쓰면 반드시 짝을 만든다**

표는 모바일에서 표로 두지 않는다. `<Table>` 하나당 `md:hidden` 카드 목록 하나가 짝이다.
기준 구현은 `app/(menu)/home/page.tsx` 의 「기한 임박 오더」.

```tsx
{/* 모바일 — 칸마다 테두리를 두르지 않고 실선 하나로 나눈다(카드 안 카드 금지) */}
<div className="divide-y md:hidden">
  {rows.map(row => (
    <div key={row.id} className="px-4 py-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{row.주값}</p>
        <span className="shrink-0 text-sm tabular-nums">{row.수치}</span>
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">{row.상태}</span>
        <span className="min-w-0 truncate">{row.보조값}</span>
      </div>
    </div>
  ))}
</div>

{/* 데스크톱 */}
<div className="hidden md:block"><Table>...</Table></div>
```

- 모바일 카드에는 **핵심 3~4개 값만** 넣는다. 표의 모든 열을 우겨넣지 않는다 — 나머지는 행을 눌러 상세에서 본다.
- 로딩 Skeleton·빈 상태도 모바일 쪽을 따로 둔다.
- **예외**: 월간 달력·자격 행렬처럼 **의미상 열을 줄일 수 없는 표**만 터치 가로 스크롤을 쓴다.
  이때도 `[data-slot="table-container"]` 안에서만 밀리고 **페이지 전체가 밀리면 안 된다**.

### TableHeader

```tsx
<TableHeader>
  <TableRow className="hover:bg-transparent">
    <TableHead className="px-3 text-muted-foreground">컬럼명</TableHead>
    {/* 정렬 가능한 헤더 */}
    <TableHead
      className="cursor-pointer px-3 text-muted-foreground"
      onClick={() => toggleSort("fieldName")}
    >
      <span className="flex items-center">
        컬럼명 <SortIcon field="fieldName" />
      </span>
    </TableHead>
  </TableRow>
</TableHeader>
```

규칙:
- `TableRow`: `hover:bg-transparent` (헤더 행 호버 효과 제거)
- `TableHead`: `px-3 text-muted-foreground` — `bg-*`, `uppercase`, `tracking-wide` 사용 금지

### TableBody / TableRow

```tsx
<TableRow
  className="cursor-pointer hover:bg-muted/40"
  onClick={() => openEdit(row)}
>
  {/* 순번 */}
  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
    {idx + 1}
  </TableCell>
  {/* 주요 식별자 (이름, 코드 등) */}
  <TableCell className="px-3 py-2.5 font-medium text-foreground">
    {row.name}
  </TableCell>
  {/* 보조 정보 */}
  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
    {row.subtitle}
  </TableCell>
  {/* 코드/ID 등 고정폭 */}
  <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
    {row.code}
  </TableCell>
  {/* 액션 버튼 — e.stopPropagation() 필수 */}
  <TableCell className="px-3 py-2.5 text-center">
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={(e) => { e.stopPropagation(); openDelete(row) }}
      className="text-destructive hover:text-destructive"
    >
      <Trash2 className="size-3.5" />
    </Button>
  </TableCell>
</TableRow>
```

규칙:
- `TableCell`: `px-3 py-2.5` 기본
- 주요 텍스트: `font-medium text-foreground`
- 보조 텍스트: `text-xs text-muted-foreground`
- 코드/숫자: `font-mono text-xs text-muted-foreground`
- 행 클릭 → 수정 Sheet 오픈 (`cursor-pointer hover:bg-muted/40`)
- 행 내 버튼: `e.stopPropagation()` 필수

### 상태 표시 컬러 — Tag 컴포넌트 (bizday 가이드라인 기준)

> 출처: [bizday UI Guideline — Table](http://localhost:3000/bizday-ui-guideline/table) (사내 디자인 시스템 레퍼런스, 로컬 실행 시에만 접근 가능).
> `frontend/components/ui/tag.tsx` — 솔리드 배지 전용 컴포넌트. `import { Tag } from '@frontend/components/ui/tag'`.
> 기존 `Badge`(outline/soft 스타일)는 그대로 두고, **상태 표시**는 이 `Tag`를 우선 사용한다.

```tsx
<Tag color="green">완료</Tag>
<Tag color="blue" dot>처리중</Tag>   {/* 동적으로 계속 바뀌는 상태는 dot 추가 */}
```

셀 안에서 상태를 표시할 때는 아래 색상↔의미 매핑을 `Tag`의 `color`에 우선 적용한다. 인라인 스타일이나 임시 Tailwind 색 조합을 즉흥적으로 고르지 않는다.

| 색 | 의미 | 비고 |
|----|------|------|
| blue | 처리중 / 진행중 | 동적으로 계속 바뀌는 상태는 `dot` 추가 권장. 브랜드 메인 컬러와 같은 색 계열이라 과용 주의 |
| green | 완료 / 승인 | |
| yellow(amber) | 검토중 / 대기 | |
| red | 반려 / 취소 / 오류 | |
| mono(slate/muted) | 보류 | 임시저장 등 |
| indigo | 공지 | |
| slate | 분류 / 기타 | |

- 동적 상태(계속 진행 중임을 알려야 하는 상태)는 `dot` prop을 추가한다.
- 적용 예: `app/(menu)/settings/users/page.tsx`의 역할(관리자=indigo/시험자=slate)·상태(활성=green/비활성=mono) 배지.
- **예외**: QC 작업 5단계 워크플로(진행중/검토전/검토중/승인전/승인완료 + 지연/대기)는 이미 `types/qc-status.ts`의 `STAGE_STYLE`로 확립된 자체 팔레트가 있다 — 위 매핑으로 재도장하지 않는다. 이 매핑은 그 외 상태 배지(활성/비활성, 승인/반려류 등)에 적용한다.
- 컨테이너 외곽선(bizday의 `outline` 옵션 개념): 이 프로젝트는 `Card` 래퍼가 항상 테두리·라운드를 제공해 사실상 `outline=true`가 기본이다. 목록형(외곽선 없이 위/아래 굵은 라인 + 가로 행 라인만)이 필요하면 `Card` 없이 `border-y-2` 유틸로 직접 표현한다.
- 필수 컬럼 표시(bizday의 `TableHead required` 개념): 이 프로젝트 Table엔 아직 없는 기능이다. 폼 필수 마커와 동일 규격(5px dot · 간격 10px)으로 필요해지면 이 문서를 갱신한다.

### 빈 상태

```tsx
<TableRow className="hover:bg-transparent">
  <TableCell colSpan={N} className="py-16 text-center text-sm text-muted-foreground">
    데이터가 없습니다.
  </TableCell>
</TableRow>
```

### 정렬 패턴

```tsx
const [sortField, setSortField] = useState<"name" | "code">("name")
const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

const sortedData = useMemo(() => {
  return [...data].sort((a, b) => {
    const va = a[sortField] ?? ""
    const vb = b[sortField] ?? ""
    const cmp = typeof va === "string"
      ? va.localeCompare(vb, "ko")
      : (va as number) - (vb as number)
    return sortDir === "asc" ? cmp : -cmp
  })
}, [data, sortField, sortDir])

function toggleSort(field: typeof sortField) {
  if (sortField === field) {
    setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))
  } else {
    setSortField(field)
    setSortDir("asc")
  }
}

function SortIcon({ field }: { field: typeof sortField }) {
  if (sortField !== field)
    return <span className="ml-1 opacity-40"><ChevronDown size={11} /></span>
  return sortDir === "asc"
    ? <ChevronUp size={11} className="ml-1 text-primary" />
    : <ChevronDown size={11} className="ml-1 text-primary" />
}
```

---

## 2. 수정 패널 — Sheet (슬라이드)

> **수정은 항상 Sheet(우측 슬라이드)**. Dialog는 추가/삭제 확인에만 사용.
> 실제 화면에서는 이 구조를 직접 짜지 말고 **`<ManagementDrawer>`**(`@frontend/components/common/management-drawer.tsx`)를 우선 사용한다 — 아래 전체 구조를 이미 구현하고 있다.

### 떠 있는 패널(floating) — bizday 가이드라인 기준

> 출처: [bizday UI Guideline — Side](http://localhost:3000/bizday-ui-guideline/side) (사내 디자인 시스템 레퍼런스, 로컬 실행 시에만 접근 가능).

`SheetContent`의 기본 `variant`는 `"floating"`이다: 가장자리에서 12px 띄운 채 `rounded-md` + 그림자로 "떠 있는" 패널로 나타나며, **dim 배경 없이 페이지 내용과 함께 상호작용 가능**하고, **Esc 또는 우상단 X로만 닫힌다(바깥 영역 클릭으로는 닫히지 않는다)**. `ManagementDrawer`는 이미 이 모드로 동작한다.

- 직접 `<Sheet>`를 쓸 때는 반드시 `modal={false}`를 함께 지정해야 배경이 dim 없이 인터랙티브하게 유지된다: `<Sheet open={open} onOpenChange={setOpen} modal={false}>`.
- `dim` prop(`<SheetContent dim>`)을 주면 옅은 배경(`bg-black/10`)을 켤 수 있다. 기본은 꺼짐.
- 패널 폭은 `ManagementDrawer`의 `size`로 정한다: `sm` 480px / `md`(기본) 600px / `lg` 760px / `xl` 920px.
- `SheetContent`는 폭을 `--sheet-width` CSS 변수로 읽는다(기본 24rem). 직접 조립할 때는 `sm:max-w-*` 클래스 대신 `style={{ '--sheet-width': '760px' }}`로 지정한다 — 클래스로 주면 `data-[side=right]:` 기본값에 특이도로 밀려 적용되지 않는다.
- 내용이 아주 많은 뷰/입력에는 부적합 — 그런 경우 `size="full"` `Dialog`를 고려한다.
- **모바일 내비게이션 Sheet(사이드바)처럼 dim + 바깥 클릭 닫기 + 가장자리 밀착이 필요한 예외**는 `<SheetContent variant="docked">`로 기존 동작을 유지한다(`frontend/components/ui/sidebar.tsx` 참고). 새 화면에서는 쓰지 않는다.

### 전체 구조

```tsx
<Sheet open={editOpen} onOpenChange={setEditOpen} modal={false}>
  <SheetContent side="right" style={{ '--sheet-width': '600px' }} className="flex w-full flex-col gap-0 p-0">

    {/* ① 헤더 */}
    <SheetHeader className="border-b px-5 py-4">
      <SheetTitle className="text-base font-semibold">항목 수정</SheetTitle>
      <SheetDescription className="text-xs text-muted-foreground">
        수정 가능한 항목을 변경합니다.
      </SheetDescription>
    </SheetHeader>

    {/* ② 콘텐츠 영역 */}
    <div className="flex-1 overflow-y-auto bg-muted/30 px-5 py-4">
      <div className="grid gap-4">

        {/* 읽기 전용 섹션 */}
        <section className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">기본 정보</h3>
          <div className="flex flex-col gap-2">
            <ReadOnlyField label="사번" value={selected?.code} hint="변경 불가" mono />
            <ReadOnlyField label="이름" value={selected?.name} hint="관리자에서 변경" />
          </div>
        </section>

        {/* 수정 가능 섹션 */}
        <section className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">설정</h3>
          {/* 입력 필드들 */}
        </section>

        {/* 에러 */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>

    {/* ③ 하단 버튼 */}
    <SheetFooter className="border-t bg-card px-5 py-4">
      <Button variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
      <Button onClick={() => void handleEdit()} disabled={saving}>
        <Save />
        {saving ? "저장 중..." : "저장"}
      </Button>
    </SheetFooter>

  </SheetContent>
</Sheet>
```

### 읽기 전용 필드 (Lock)

```tsx
{/* 변경 불가 필드 */}
<div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5">
  <Lock size={13} className="shrink-0 text-muted-foreground" />
  <span className="text-xs text-muted-foreground">사번</span>
  <span className="font-mono text-sm font-semibold text-foreground">
    {selected?.code ?? '-'}
  </span>
  <span className="ml-auto text-[10px] text-muted-foreground">변경 불가</span>
</div>

{/* 다른 곳에서 변경 가능 */}
<div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5">
  <Lock size={13} className="shrink-0 text-muted-foreground" />
  <span className="text-xs text-muted-foreground">이름</span>
  <span className="text-sm font-semibold text-foreground">
    {selected?.name ?? '-'}
  </span>
  <span className="ml-auto text-[10px] text-muted-foreground">사용자 관리에서 변경</span>
</div>
```

- `border-dashed bg-muted/40` — 비활성/읽기 전용 컨테이너
- `<Lock size={13} className="shrink-0 text-muted-foreground" />`
- `ml-auto text-[10px] text-muted-foreground` — 우측 힌트 텍스트

---

## 3. 하단 버튼 구조 (Footer)

### Sheet Footer (수정)

```tsx
<SheetFooter className="border-t bg-card px-5 py-4">
  <Button variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
  <Button onClick={() => void handleSave()} disabled={saving}>
    <Save />
    {saving ? "저장 중..." : "저장"}
  </Button>
</SheetFooter>
```

### Dialog Footer (추가)

```tsx
<DialogFooter>
  <Button variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
  <Button onClick={() => void handleAdd()} disabled={saving}>
    <Save />
    {saving ? "저장 중..." : "추가"}
  </Button>
</DialogFooter>
```

### Dialog Footer (삭제 확인)

```tsx
<DialogFooter>
  <Button variant="outline" onClick={() => setDeleteOpen(false)}>취소</Button>
  <Button variant="destructive" onClick={() => void handleDelete()} disabled={saving}>
    <Trash2 />
    {saving ? "삭제 중..." : "삭제"}
  </Button>
</DialogFooter>
```

규칙:
- DialogFooter 기본 스타일(테두리·muted 배경)을 그대로 사용한다. 여백 className을 다시 덮어쓰지 않는다.
- 좌: `variant="outline"` 취소 버튼
- 우: 기본(primary) 또는 `variant="destructive"` 실행 버튼
- 실행 버튼: 아이콘(`<Save />`, `<Trash2 />`) + 텍스트
- `disabled={saving}` + `{saving ? "처리 중..." : "라벨"}` 패턴 필수

---

## 4. 삭제 확인 Dialog

```tsx
<Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
  <DialogContent size="sm">
    <DialogHeader>
      <DialogTitle>항목 삭제</DialogTitle>
      <DialogDescription>
        관련 데이터도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
      </DialogDescription>
    </DialogHeader>

    <div className="rounded-lg border bg-muted/50 p-3">
      <p className="text-sm font-medium">{selected?.name}</p>
      <p className="mt-0.5 font-mono text-xs text-muted-foreground">{selected?.code}</p>
    </div>

    <DialogFooter>
      <Button variant="outline" onClick={() => setDeleteOpen(false)}>취소</Button>
      <Button variant="destructive" onClick={() => void handleDelete()} disabled={saving}>
        <Trash2 />
        {saving ? "삭제 중..." : "삭제"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## 5. 추가 Dialog

```tsx
<Dialog open={addOpen} onOpenChange={setAddOpen}>
  <DialogContent size="lg">
    <DialogHeader>
      <DialogTitle>항목 추가</DialogTitle>
      <DialogDescription>새 항목을 등록합니다.</DialogDescription>
    </DialogHeader>

    <DialogBody className="grid gap-4">
      <section className="rounded-lg border bg-card p-3 shadow-sm sm:p-4">
        <div className="mb-3 border-b pb-3">
          <h3 className="text-sm font-semibold text-foreground">기본 정보</h3>
        </div>
        {/* 입력 필드들 */}
      </section>
    </DialogBody>

    <DialogFooter>
      <Button variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
      <Button onClick={() => void handleAdd()} disabled={saving}>
        <Save />
        {saving ? "저장 중..." : "추가"}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## 6. 행 클릭 → Sheet 오픈 패턴

```tsx
// 행 클릭으로 Sheet 열기
function openEdit(row: RowType) {
  setSelected(row)
  setForm({ /* row 값으로 초기화 */ })
  setError("")
  setEditOpen(true)
}

// 테이블 행
<TableRow
  className="cursor-pointer hover:bg-muted/40"
  onClick={() => openEdit(row)}
>
  {/* 행 내 버튼은 반드시 e.stopPropagation() */}
  <TableCell>
    <Button onClick={(e) => { e.stopPropagation(); openDelete(row) }}>
      <Trash2 />
    </Button>
  </TableCell>
</TableRow>
```

---

## 7. Import 목록

```tsx
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@frontend/components/ui/sheet"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frontend/components/ui/table"
import { AlertTriangle, ChevronDown, ChevronUp, Lock, Save, Trash2 } from "lucide-react"
import { Skeleton } from "@frontend/components/ui/skeleton"
```

---

## 8. 로딩 스켈레톤 (Skeleton) ⚡ 필수 자동 적용

> **모든 화면에서 데이터 로딩 시 반드시 Skeleton을 사용한다.**
> `"불러오는 중..."` 텍스트, `<Loader2>` 스피너, 빈 Card 등 모든 로딩 표현을 아래 패턴으로 교체한다.

### 테이블 스켈레톤 (데스크톱)

```tsx
// TableBody 안에서 loading 분기
{loading
  ? Array.from({ length: 6 }).map((_, i) => (
      <TableRow key={i}>
        <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-8" /></TableCell>
        <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-24" /></TableCell>
        <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-32" /></TableCell>
        <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
        <TableCell className="px-3 py-2.5"><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
        <TableCell className="px-3 py-2.5"><Skeleton className="h-6 w-6 rounded" /></TableCell>
      </TableRow>
    ))
  : rows.map(row => <TableRow key={row.id}>...</TableRow>)
}
```

규칙:
- 행 수: **6행** 고정 (실제 데이터 수와 무관)
- 각 셀 너비는 컬럼 내용에 맞게 조정 (`w-8` ~ `w-full`)
- Badge 자리: `h-5 w-14 rounded-full`
- 아이콘 버튼 자리: `h-6 w-6 rounded`
- 전체 너비 텍스트: `h-4 w-full`

### 모바일 카드 스켈레톤

```tsx
// 모바일 카드 목록 로딩
{loading
  ? Array.from({ length: 4 }).map((_, i) => (
      <Card key={i} className="gap-2 px-3 py-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </Card>
    ))
  : rows.map(row => <Card key={row.id}>...</Card>)
}
```

### KPI 카드 스켈레톤

```tsx
// 상단 KPI 카드 로딩 (데이터 fetch 전)
<Card className="gap-1 px-4 py-4">
  <Skeleton className="h-3 w-16" />
  <Skeleton className="h-8 w-12" />
  <Skeleton className="h-3 w-24" />
</Card>
```

### 전체 페이지 초기 로딩 (테이블 없는 화면)

```tsx
// 카드 기반 화면 전체 로딩
if (loading) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="gap-1 px-4 py-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-12" />
          </Card>
        ))}
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    </div>
  )
}
```

### Import

```tsx
import { Skeleton } from "@frontend/components/ui/skeleton"
```

---

## 9. shadcn/ui 컴포넌트 레퍼런스

> 출처: [https://ui.shadcn.com/docs/components](https://ui.shadcn.com/docs/components)
> AI 생성기: [https://ui.shadcn.com/create](https://ui.shadcn.com/create)
> import 경로: `@frontend/components/ui/<name>`

### 설치 상태 (중요)

이 프로젝트에는 shadcn 전체 카탈로그(60+) 중 **아래 19개만 설치**되어 있다.
나머지는 카탈로그에 존재하지만 사용 전 추가해야 한다: `npx shadcn@latest add <name>`

| ✅ 설치됨 (바로 사용) | 🔲 미설치 (add 필요) |
|---------------------|---------------------|
| avatar, badge, button, calendar, card, collapsible, date-field*, date-range-field*, dialog, dropdown-menu, input, popover, select, separator, sheet, sidebar, skeleton, table, tooltip | accordion, alert, alert-dialog, aspect-ratio, breadcrumb, button-group, carousel, chart, checkbox, combobox, command, context-menu, data-table, drawer, empty, field, hover-card, input-group, input-otp, item, kbd, label, menubar, native-select, navigation-menu, pagination, progress, radio-group, resizable, scroll-area, slider, sonner, spinner, switch, tabs, textarea, toast, toggle, toggle-group, typography |

> `*` date-field / date-range-field 는 이 프로젝트 커스텀 컴포넌트. 날짜 입력은 [/date-field 스킬](date-field.md) 참조 — `<input type="date">` 직접 사용 금지.

아래 레퍼런스에서 각 컴포넌트에 **[✅ 설치됨]** / **[🔲 add 필요]** 를 표기한다.

---

### Button [✅ 설치됨]

```tsx
import { Button } from "@frontend/components/ui/button"
```

| variant | 용도 |
|---------|------|
| `default` | 주요 액션 (저장, 추가) |
| `outline` | 보조 액션 (취소) |
| `secondary` | 대안 액션 |
| `ghost` | 배경 없는 버튼 (아이콘 버튼, 테이블 행 내 액션) |
| `destructive` | 삭제·위험 액션 |
| `link` | 링크처럼 보이는 버튼 |

| size | 용도 |
|------|------|
| `default` | 일반 버튼 |
| `sm` | 소형 버튼 |
| `lg` | 대형 버튼 |
| `icon` | 정사각 아이콘 버튼 |
| `icon-sm` | 소형 아이콘 버튼 (테이블 내 사용) |

**이 프로젝트 규칙:**
- Footer 버튼: 취소 → `variant="outline"`, 실행 → `default` 또는 `destructive`
- 테이블 내 버튼: `variant="ghost" size="icon-sm"`
- 아이콘 + 텍스트 조합이 기본

```tsx
<Button variant="outline" onClick={onClose}>취소</Button>
<Button onClick={onSave} disabled={saving}>
  <Save />
  {saving ? "저장 중..." : "저장"}
</Button>
<Button variant="destructive"><Trash2 />삭제</Button>
<Button variant="ghost" size="icon-sm"><Trash2 className="size-3.5" /></Button>
```

---

### Badge [✅ 설치됨]

```tsx
import { Badge } from "@frontend/components/ui/badge"
```

| variant | 용도 |
|---------|------|
| `default` | 기본 강조 |
| `secondary` | 보조 정보 (건수, 카운트) |
| `outline` | 상태 표시 (활성/비활성, 역할) |
| `destructive` | 오류·위험 상태 |

**이 프로젝트 규칙:**
- 상태 dot + 텍스트 패턴: `<Badge variant="outline" className="gap-1.5">`
- 건수 표시: `<Badge variant="secondary">`

```tsx
// 상태 dot 패턴 (활성/브랜드 강조는 파랑 — indigo/violet/purple/sky 금지)
<Badge variant="outline" className="gap-1.5">
  <span className="size-1.5 rounded-full bg-blue-500" />
  활성
</Badge>

// 건수
<Badge variant="secondary" className="tabular-nums">{count}건</Badge>
```

---

### Card [✅ 설치됨]

```tsx
import { Card } from "@frontend/components/ui/card"
```

**서브 컴포넌트:** `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`

**이 프로젝트 규칙:**
- 테이블 래퍼: `<Card className="hidden gap-0 overflow-hidden py-0 md:flex">` — `md:block` 을 쓰면 Card 기본의 `flex flex-col` 이 죽어 안쪽 Table 의 `min-h-0 flex-1` 이 무력화된다
- KPI 카드: `<Card className="gap-1 px-4 py-4">` — **한쪽에만 굵은 색 띠(`border-l-4`)를 두르지 않는다.** 강조는 숫자 크기와 잉크 색으로 한다
- 모바일 카드 목록: `<Card className="gap-0 px-3 py-3">`
- 로딩 시 Skeleton 카드: `<Card className="gap-2 px-3 py-3">`

```tsx
// KPI 카드
<Card className="gap-1 px-4 py-4">
  <span className="text-xs font-medium text-muted-foreground">제목</span>
  <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
  <span className="text-xs leading-normal text-muted-foreground">부가 설명</span>
</Card>

// 테이블 래퍼
<Card className="hidden gap-0 overflow-hidden py-0 md:flex">
  <Table>...</Table>
</Card>
```

---

### Table [✅ 설치됨]

```tsx
import {
  Table, TableBody, TableCaption, TableCell,
  TableFooter, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
```

**서브 컴포넌트:** `Table` > `TableHeader/TableBody/TableFooter` > `TableRow` > `TableHead/TableCell`

**이 프로젝트 규칙 (필수):**
- `TableRow` (헤더): `className="hover:bg-transparent"`
- `TableHead`: `className="px-3 text-muted-foreground"` — `bg-*`, `uppercase`, `tracking-wide` 금지
- `TableCell`: `className="px-3 py-2.5"`
- 주요 텍스트: `font-medium text-foreground`
- 보조 텍스트: `text-xs text-muted-foreground`
- 코드/숫자: `font-mono text-xs text-muted-foreground`
- 클릭 가능 행: `cursor-pointer hover:bg-muted/40`

→ [Section 1 전체 패턴 참조](#1-테이블-table)

---

### Dialog [✅ 설치됨]

```tsx
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@frontend/components/ui/dialog"
```

**용도:** 추가 폼, 삭제 확인 — 수정은 반드시 Sheet 사용

**이 프로젝트 규칙 (shadcn radix-nova):**
- `DialogContent`는 `size`로 폭을 정한다: `sm` 확인 / `md` 기본 / `lg` 폼 / `xl` 넓은 선택 / `full` 전체화면
- 긴 폼은 `DialogBody`에 넣는다 (내부 스크롤)
- Header/Footer className으로 패딩·보더를 다시 덮어쓰지 않는다
- 닫기 버튼은 기본 표시. 숨길 때만 `showCloseButton={false}`

→ [Section 4/5 전체 패턴 참조](#4-삭제-확인-dialog)

---

### Sheet [✅ 설치됨]

```tsx
import {
  Sheet, SheetContent, SheetDescription,
  SheetFooter, SheetHeader, SheetTitle,
} from "@frontend/components/ui/sheet"
```

**용도:** 수정 폼 전용 (우측 슬라이드 패널)

| side | 방향 |
|------|------|
| `right` (기본) | 우측에서 슬라이드 |
| `left` | 좌측에서 슬라이드 |
| `top` / `bottom` | 상하 슬라이드 |

**이 프로젝트 규칙:**
- 새 화면은 `Sheet`/`SheetContent`를 직접 조립하지 말고 `ManagementDrawer`를 우선 사용한다.
- `SheetContent`: `side="right" className="flex w-full flex-col gap-0 p-0"` + 폭은 `style={{ '--sheet-width': '600px' }}`
- 구조: `SheetHeader(border-b)` → `flex-1 overflow-y-auto bg-muted/30` → `SheetFooter(border-t bg-card)`
- `variant="floating"`(기본): bizday 가이드라인 기준 — 가장자리에서 12px 띄운 `rounded-md` + 그림자, dim 없음, Esc/우상단 X로만 닫힘. `<Sheet modal={false}>`와 함께 써야 한다.
- `variant="docked"`: 가장자리 밀착 + dim + 바깥 클릭 닫기(기존 방식). 모바일 내비게이션 Sheet 같은 예외적 용도에만 사용.

→ [Section 2 전체 패턴 참조](#2-수정-패널--sheet-슬라이드)

---

### Select [✅ 설치됨]

```tsx
import {
  Select, SelectContent, SelectGroup, SelectItem,
  SelectLabel, SelectSeparator, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
```

**이 프로젝트 규칙:**
- `SelectTrigger`: `className="!h-9 px-3"`
- 빈값 처리: `NONE_SENTINEL = "__none__"` 패턴 사용

```tsx
const NONE_SENTINEL = "__none__"

<Select
  value={form.field || NONE_SENTINEL}
  onValueChange={(v) => setField("field", v === NONE_SENTINEL ? "" : v)}
>
  <SelectTrigger className="!h-9 px-3">
    <SelectValue placeholder="선택" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value={NONE_SENTINEL}>—</SelectItem>
    {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
  </SelectContent>
</Select>
```

---

### Input [✅ 설치됨]

```tsx
import { Input } from "@frontend/components/ui/input"
```

**주요 패턴:**

```tsx
// 기본
<Input value={form.name} onChange={(e) => setForm(p => ({...p, name: e.target.value}))} placeholder="입력" />

// 아이콘 prefix
<div className="relative">
  <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
  <Input className="h-9 pl-9" placeholder="검색..." />
</div>

// 숫자
<Input type="number" min={0} step={1} value={form.count} onChange={...} />

// 비활성
<Input disabled value={readOnlyValue} />
```

**이 프로젝트 규칙:**
- 읽기 전용 핵심 필드는 `Input`이 아닌 Lock 패턴 사용 → [Section 2 참조](#읽기-전용-필드-lock)
- 검색 input 높이: `h-9`

---

### Skeleton [✅ 설치됨]

```tsx
import { Skeleton } from "@frontend/components/ui/skeleton"
```

**크기 패턴:**

| 용도 | className |
|------|-----------|
| 짧은 텍스트 | `h-4 w-16` |
| 중간 텍스트 | `h-4 w-32` |
| 긴 텍스트 | `h-4 w-full` |
| 제목 | `h-6 w-48` |
| Badge | `h-5 w-14 rounded-full` |
| 아이콘 버튼 | `h-6 w-6 rounded` |
| KPI 숫자 | `h-8 w-12` |
| 전체 행 | `h-10 w-full` |

→ [Section 8 전체 패턴 참조](#8-로딩-스켈레톤-skeleton--필수-자동-적용)

---

### Tabs [🔲 add 필요]

> 현재 미설치. 이 프로젝트는 아래 인라인 버튼 스타일로 탭을 구현 중(testers 페이지). 정식 Tabs가 필요하면 `npx shadcn@latest add tabs`.

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@frontend/components/ui/tabs"
```

| variant | 용도 |
|---------|------|
| `default` | 기본 탭 |
| `line` | 밑줄 스타일 (`variant="line"`) |

```tsx
// 기본 탭 (이 프로젝트 커스텀 인라인 스타일)
<div className="inline-flex h-9 w-fit items-center gap-0.5 rounded-lg bg-muted p-0.5">
  {tabs.map((tab) => (
    <button
      key={tab.id}
      onClick={() => setActive(tab.id)}
      className={cn(
        "h-8 rounded-md px-3 text-sm font-medium transition-colors",
        active === tab.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {tab.label}
    </button>
  ))}
</div>
```

---

### Tooltip [✅ 설치됨]

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@frontend/components/ui/tooltip"
```

> `TooltipProvider`를 루트 레이아웃에 추가해야 함

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon-sm"><Info className="size-3.5" /></Button>
  </TooltipTrigger>
  <TooltipContent>
    <p>설명 텍스트</p>
  </TooltipContent>
</Tooltip>
```

---

### DropdownMenu [✅ 설치됨]

```tsx
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger, DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuShortcut,
} from "@frontend/components/ui/dropdown-menu"
```

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon-sm"><MoreHorizontal className="size-4" /></Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuLabel>액션</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={onEdit}>수정</DropdownMenuItem>
    <DropdownMenuItem variant="destructive" onClick={onDelete}>삭제</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

---

### Sonner (Toast) [🔲 add 필요]

> 미설치. 토스트 알림이 필요하면 `npx shadcn@latest add sonner`.

```tsx
import { toast } from "sonner"
// 루트 layout에 <Toaster /> 필요
```

```tsx
toast("저장되었습니다.")              // 기본
toast.success("성공적으로 저장됨")    // 성공
toast.error("저장에 실패했습니다.")   // 오류
toast.warning("주의가 필요합니다.")   // 경고
toast.info("참고 사항입니다.")        // 정보

// 비동기 promise
toast.promise(saveData(), {
  loading: "저장 중...",
  success: "저장 완료",
  error: "저장 실패",
})
```

| 위치 옵션 | `position` prop |
|----------|-----------------|
| 우측 하단 (기본) | `"bottom-right"` |
| 우측 상단 | `"top-right"` |

---

### AlertDialog [🔲 add 필요]

```tsx
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@frontend/components/ui/alert-dialog"
```

> **Dialog vs AlertDialog:** 중요한 확인(삭제 등)은 AlertDialog 또는 커스텀 Dialog 삭제 패턴 사용. 이 프로젝트는 [Section 4 커스텀 Dialog 패턴](#4-삭제-확인-dialog)을 표준으로 사용한다.

```tsx
// AlertDialogMedia로 아이콘 포함 가능
// size="sm" — 소형 확인창
<AlertDialog>
  <AlertDialogTrigger asChild><Button variant="destructive">삭제</Button></AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>정말 삭제하시겠습니까?</AlertDialogTitle>
      <AlertDialogDescription>이 작업은 되돌릴 수 없습니다.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>취소</AlertDialogCancel>
      <AlertDialogAction>삭제</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

---

## 10. 설치된 나머지 컴포넌트

### Avatar [✅ 설치됨]

```tsx
import { Avatar, AvatarImage, AvatarFallback } from "@frontend/components/ui/avatar"

<Avatar>
  <AvatarImage src={user.avatarUrl} alt={user.name} />
  <AvatarFallback>{user.name.slice(0, 2)}</AvatarFallback>
</Avatar>
```
- `AvatarFallback` — 이미지 로드 실패/없을 때 표시 (이니셜 권장)

---

### Calendar [✅ 설치됨]

```tsx
import { Calendar } from "@frontend/components/ui/calendar"

<Calendar mode="single" selected={date} onSelect={setDate} />
```
- `mode`: `"single" | "multiple" | "range"`
- **날짜 입력은 직접 Calendar보다 `<DateField>` 우선** → [/date-field 스킬](date-field.md)

---

### Collapsible [✅ 설치됨]

```tsx
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@frontend/components/ui/collapsible"

<Collapsible open={open} onOpenChange={setOpen}>
  <CollapsibleTrigger asChild><Button variant="ghost">더보기</Button></CollapsibleTrigger>
  <CollapsibleContent>접히는 내용</CollapsibleContent>
</Collapsible>
```

---

### Popover [✅ 설치됨]

```tsx
import { Popover, PopoverTrigger, PopoverContent } from "@frontend/components/ui/popover"

<Popover>
  <PopoverTrigger asChild><Button variant="outline">열기</Button></PopoverTrigger>
  <PopoverContent align="end" className="w-80">내용</PopoverContent>
</Popover>
```
- 필터·옵션 패널, 컬러 피커 등 가벼운 팝업에 사용

---

### Separator [✅ 설치됨]

```tsx
import { Separator } from "@frontend/components/ui/separator"

<Separator />                              {/* 수평 */}
<Separator orientation="vertical" />       {/* 수직 */}
```

---

### Sidebar [✅ 설치됨]

```tsx
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarTrigger,
} from "@frontend/components/ui/sidebar"
```
- 앱 전역 네비게이션. `SidebarProvider`로 루트 감쌈
- 이미 앱 레이아웃에 구성되어 있으므로 신규 메뉴는 기존 구조에 추가

---

### DateField / DateRangeField [✅ 설치됨 — 프로젝트 커스텀]

```tsx
import { DateField } from "@frontend/components/ui/date-field"
import { DateRangeField } from "@frontend/components/ui/date-range-field"

<DateField value={date} onChange={setDate} />
<DateRangeField value={range} onChange={setRange} />
```
- **모든 날짜 입력의 표준.** `<input type="date">` 직접 사용 금지
- 상세 사용법 → [/date-field 스킬](date-field.md)

---

## 11. 미설치 컴포넌트 (필요 시 `npx shadcn@latest add <name>`)

> 카탈로그엔 있으나 이 프로젝트엔 아직 없음. 사용 전 add 후 import 경로는 `@frontend/components/ui/<name>`.

### 폼 / 입력

| 컴포넌트 | add 이름 | 용도 |
|---------|---------|------|
| **Checkbox** | `checkbox` | 체크박스. 현재는 `<input type="checkbox" className="cb-custom">` 사용 중 |
| **Radio Group** | `radio-group` | 단일 선택 라디오 그룹 |
| **Switch** | `switch` | on/off 토글 스위치 |
| **Textarea** | `textarea` | 여러 줄 텍스트 입력 |
| **Label** | `label` | 폼 라벨 (`htmlFor` 연결). 현재는 `<label className="text-xs font-medium">` 사용 |
| **Slider** | `slider` | 범위 슬라이더 |
| **Toggle** / **Toggle Group** | `toggle` / `toggle-group` | 토글 버튼 / 버튼 그룹 토글 |
| **Native Select** | `native-select` | 네이티브 `<select>` 스타일 래퍼 |
| **Combobox** | (command + popover 조합) | 검색 가능한 셀렉트 |
| **Input OTP** | `input-otp` | OTP/인증번호 입력 |
| **Input Group** | `input-group` | input + 아이콘/버튼 결합 그룹 |
| **Field** | `field` | FieldLabel/FieldDescription 폼 컨텍스트 |
| **Button Group** | `button-group` | 버튼 묶음 |
| **Calendar/Date Picker** | `date-picker` | → 이 프로젝트는 `DateField` 사용 |

```tsx
// Checkbox 예시 (add 후)
<Checkbox checked={v} onCheckedChange={setV} />

// Switch 예시
<Switch checked={enabled} onCheckedChange={setEnabled} />

// Textarea 예시
<Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={4} />
```

### 표시 / 피드백

| 컴포넌트 | add 이름 | 용도 |
|---------|---------|------|
| **Alert** | `alert` | 인라인 경고/안내 박스 (`AlertTitle`, `AlertDescription`) |
| **Alert Dialog** | `alert-dialog` | 확인 모달 → [Section 9 참조](#alertdialog--add-필요) |
| **Progress** | `progress` | 진행률 바 |
| **Spinner** | `spinner` | 로딩 스피너 (단, 로딩은 Skeleton 우선) |
| **Sonner (Toast)** | `sonner` | 토스트 알림 → [Section 9 참조](#sonner-toast--add-필요) |
| **Toast** | `toast` | 구버전 토스트 (Sonner 권장) |
| **Tooltip** | (설치됨) | → [Section 9 참조](#tooltip--설치됨) |
| **Hover Card** | `hover-card` | 호버 시 카드 미리보기 |
| **Empty** | `empty` | 빈 상태 일러스트/메시지 (현재는 `py-16 text-center text-muted-foreground` 직접 사용) |
| **Aspect Ratio** | `aspect-ratio` | 비율 고정 컨테이너 (이미지/영상) |
| **Avatar** | (설치됨) | → [Section 10 참조](#avatar--설치됨) |
| **Skeleton** | (설치됨) | → [Section 8/9 참조](#skeleton--설치됨) |
| **Kbd** | `kbd` | 키보드 단축키 표시 (`⌘K`) |
| **Item** | `item` | 리스트 아이템 프리미티브 |
| **Typography** | (CSS 유틸) | 제목/본문 타이포 — 이 프로젝트는 Tailwind 클래스 직접 사용 |

```tsx
// Alert 예시 (add 후)
<Alert>
  <AlertTriangle className="size-4" />
  <AlertTitle>주의</AlertTitle>
  <AlertDescription>설명 텍스트</AlertDescription>
</Alert>

// Progress 예시
<Progress value={66} />
```

### 탐색 / 레이아웃

| 컴포넌트 | add 이름 | 용도 |
|---------|---------|------|
| **Accordion** | `accordion` | 접이식 섹션 목록 |
| **Breadcrumb** | `breadcrumb` | 경로 네비게이션 |
| **Tabs** | `tabs` | 탭 → [Section 9 참조](#tabs--add-필요) |
| **Pagination** | `pagination` | 페이지네이션 |
| **Navigation Menu** | `navigation-menu` | 가로 메가 메뉴 |
| **Menubar** | `menubar` | 데스크톱 앱 스타일 메뉴바 |
| **Context Menu** | `context-menu` | 우클릭 컨텍스트 메뉴 |
| **Command** | `command` | 커맨드 팔레트 (⌘K 검색) |
| **Drawer** | `drawer` | 모바일 하단 드로어 (Sheet의 모바일 변형) |
| **Resizable** | `resizable` | 크기 조절 패널 |
| **Scroll Area** | `scroll-area` | 커스텀 스크롤 영역 |
| **Sidebar** | (설치됨) | → [Section 10 참조](#sidebar--설치됨) |
| **Carousel** | `carousel` | 슬라이드 캐러셀 |
| **Direction** | `direction` | RTL/LTR 방향 프로바이더 |

### 데이터

| 컴포넌트 | add 이름 | 용도 |
|---------|---------|------|
| **Data Table** | (table + TanStack) | 정렬/필터/페이지네이션 고급 테이블. 이 프로젝트는 기본 Table + 커스텀 정렬 사용 → [Section 1 참조](#1-테이블-table) |
| **Chart** | `chart` | Recharts 기반 차트 (area/bar/line/pie) |

```tsx
// Accordion 예시 (add 후)
<Accordion type="single" collapsible>
  <AccordionItem value="item-1">
    <AccordionTrigger>제목</AccordionTrigger>
    <AccordionContent>내용</AccordionContent>
  </AccordionItem>
</Accordion>

// Breadcrumb 예시
<Breadcrumb>
  <BreadcrumbList>
    <BreadcrumbItem><BreadcrumbLink href="/">홈</BreadcrumbLink></BreadcrumbItem>
    <BreadcrumbSeparator />
    <BreadcrumbItem><BreadcrumbPage>현재</BreadcrumbPage></BreadcrumbItem>
  </BreadcrumbList>
</Breadcrumb>
```

---

> **요약**: 신규 화면은 ✅ 설치된 19개로 우선 구성한다. 미설치 컴포넌트가 꼭 필요하면 `npx shadcn@latest add <name>` 후 사용하고, 이 문서에 [✅ 설치됨]으로 갱신한다.
