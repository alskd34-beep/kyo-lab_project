# DateField — 공통 날짜 선택 컴포넌트

**위치**: `frontend/components/ui/date-field.tsx`
**스택**: date-fns · shadcn Popover · shadcn Calendar
**기준 디자인**: `app/(menu)/test-mgmt/test-reg/page.tsx` 의 DateField 참고

---

## 사용 규칙

- 프로젝트 내 모든 날짜 입력은 `<DateField>`를 쓴다. `<input type="date">` 직접 사용 금지.
- `value` / `onChange` 는 **"yyyy-MM-dd" ISO 문자열** 기준.
- 빈 값은 `""` (null/undefined 아님).

---

## Props

| prop | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `value` | `string` | — | "yyyy-MM-dd" 형식 날짜 |
| `onChange` | `(v: string) => void` | — | 날짜 선택 시 콜백 |
| `label` | `string?` | — | 위에 표시되는 라벨 |
| `helper` | `string?` | — | 라벨 옆 보조 텍스트 |
| `placeholder` | `string?` | `"날짜 선택"` | 미선택 시 버튼 텍스트 |
| `disabled` | `boolean?` | `false` | 비활성화 |
| `size` | `"sm" \| "md"` | `"md"` | sm=h-8 text-xs / md=h-10 text-sm |
| `noLabel` | `boolean?` | `false` | 라벨 영역 없이 버튼만 렌더링 |

---

## 예시

### 기본 (라벨 포함)
```tsx
import { DateField } from "@frontend/components/ui/date-field"

<DateField
  label="포장일"
  helper="포장 완료 날짜"
  value={form.packagingDate}
  onChange={v => setForm({ ...form, packagingDate: v })}
/>
```

### 소형 (라벨 외부에 따로 표시)
```tsx
<div className="flex items-center gap-1.5">
  <span className="text-xs text-slate-500">시작</span>
  <div className="w-36">
    <DateField
      size="sm"
      noLabel
      value={job.workStartDate ?? ""}
      onChange={v => patchJob(job.id, { workStartDate: v })}
      placeholder="시작일"
    />
  </div>
</div>
```

### date-fns 연동 (D+14 자동계산 등)
```tsx
import { addDays, format, parse, isValid } from "date-fns"

function autoDate(packagingDate: string): string {
  const d = parse(packagingDate, "yyyy-MM-dd", new Date())
  return isValid(d) ? format(addDays(d, 14), "yyyy-MM-dd") : ""
}
```

---

## 적용 현황

| 화면 | 경로 |
|---|---|
| 시험등록 | `app/(menu)/test-mgmt/test-reg/page.tsx` |
| 내 작업 | `app/(menu)/my-tasks/page.tsx` |

새 화면에 날짜 필드 추가 시 위 목록에 추가할 것.
