"use client"

import * as React from "react"

import { cn } from "@frontend/lib/utils"
import {
  colMinPx,
  hangulUnits,
  measureHangulPx,
  pickSplitStacks,
  type StackBudget,
} from "@frontend/lib/hangul-width"
import { SortColumnHeader, type SortColumnDef } from "@frontend/components/ui/table-sort"

type ColSample = {
  /** 헤더가 이 칸을 나누지 말라고 선언했는가 (SortColumnDef.noSplit) */
  noSplit: boolean
  mergedHeaderUnits: number
  fieldUnits: number[]
  secondaryLabel?: string
  secondaryLabelUnits: number
  primaryContentUnits: number
  secondaryContentUnits: number
  hasSecondary: boolean
}

type AdaptiveTableContextValue = {
  isSplit: (logicalIndex: number) => boolean
  secondHeader: (logicalIndex: number) => string
  registerHeader: (logicalIndex: number, mergedLabel: string, fieldLabels: string[], noSplit?: boolean) => void
  registerContent: (logicalIndex: number, primary: string, secondary: string, secondaryLabel?: string) => void
  reportLogicalCount: (count: number) => void
  visualColCount: number
}

const AdaptiveTableContext = React.createContext<AdaptiveTableContextValue | null>(null)
const LogicalColContext = React.createContext(0)
const LastColContext = React.createContext(false)
/** 마지막 칸을 오른쪽 고정 액션 칸(PIN_END)으로 처리할지. 기본값은 일반 데이터 열이다. */
const PinLastColContext = React.createContext(false)
const InHeaderContext = React.createContext(false)

/** 현재 펼쳐진 실제 칸 수. colSpan 은 이 값만 쓴다 — 더 큰 값을 쓰면 표 오른쪽에 빈 칸이 생긴다. */
export function useTableColSpan(): number {
  return React.useContext(AdaptiveTableContext)?.visualColCount ?? 1
}

const PIN_END =
  "sticky right-0 z-[11] w-12 min-w-12 max-w-12 bg-card px-1 text-center"

function setRefValue<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value)
  } else if (ref) {
    Reflect.set(ref, "current", value)
  }
}

function displayNameOf(type: unknown): string {
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string }
    return fn.displayName || fn.name || ""
  }
  if (typeof type === "object" && type && "displayName" in type) {
    return String((type as { displayName?: string }).displayName ?? "")
  }
  return ""
}

function findElementByName(node: React.ReactNode, name: string, depth = 0): React.ReactElement | null {
  if (depth > 5 || node == null || typeof node === "boolean") return null
  let found: React.ReactElement | null = null
  React.Children.forEach(node, (child) => {
    if (found || !React.isValidElement(child)) return
    if (displayNameOf(child.type) === name) {
      found = child
      return
    }
    const kids = (child.props as { children?: React.ReactNode }).children
    if (kids) found = findElementByName(kids, name, depth + 1)
  })
  return found
}

function nodeToText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join("")
  if (React.isValidElement(node)) {
    return nodeToText((node.props as { children?: React.ReactNode }).children)
  }
  return ""
}

function replaceCellStackSecondary(node: React.ReactNode): React.ReactNode {
  return React.Children.map(node, (child) => {
    if (!React.isValidElement(child)) return child
    if (displayNameOf(child.type) === "CellStack") {
      return React.cloneElement(child as React.ReactElement<{ secondary?: React.ReactNode }>, { secondary: undefined })
    }
    const kids = (child.props as { children?: React.ReactNode }).children
    if (kids == null) return child
    return React.cloneElement(child as React.ReactElement<{ children?: React.ReactNode }>, {
      children: replaceCellStackSecondary(kids),
    })
  })
}

function emptySample(): ColSample {
  return {
    noSplit: false,
    mergedHeaderUnits: 0,
    fieldUnits: [],
    secondaryLabelUnits: 0,
    primaryContentUnits: 0,
    secondaryContentUnits: 0,
    hasSecondary: false,
  }
}

function Table({
  className,
  containerClassName,
  containerRef,
  layout = "fluid",
  adaptive,
  pinLastColumn = false,
  ...props
}: React.ComponentProps<"table"> & {
  containerClassName?: string
  containerRef?: React.Ref<HTMLDivElement>
  /** fluid: 화면 너비에 맞추고 안쪽에서 세로 스크롤. content: 높이만큼 늘어나 바깥 스크롤. wide: 가로 스크롤 허용. */
  layout?: "fluid" | "content" | "wide"
  /**
   * 헤더·내용의 한글 자수 × 한 자 폭이 표 너비보다 작아지면 묶인 칸을 합친다.
   * 행렬/캘린더(`wide`)와 단계를 직접 그리는 표는 끈다.
   */
  adaptive?: boolean
  /**
   * 마지막 칸을 오른쪽 고정 액션 칸(48px)으로 만든다. 기본 false.
   * 관리/삭제 아이콘처럼 고정이 필요한 액션 칸에서만 true로 켠다.
   * 상태 배지·텍스트 열을 액션 칸으로 오인해 내용이 잘리는 것을 막는다.
   */
  pinLastColumn?: boolean
}) {
  const enabled = (adaptive ?? layout !== "wide") && layout !== "wide"
  const [el, setEl] = React.useState<HTMLDivElement | null>(null)
  const [logicalCount, setLogicalCount] = React.useState(0)
  const [width, setWidth] = React.useState(0)
  const [hangulPx, setHangulPx] = React.useState(14)
  const samplesRef = React.useRef(new Map<number, ColSample>())
  const [sampleRev, setSampleRev] = React.useState(0)
  const prevFlagsRef = React.useRef<boolean[]>([])

  React.useEffect(() => {
    samplesRef.current.clear()
    prevFlagsRef.current = []
  }, [logicalCount])

  const setContainer = React.useCallback((node: HTMLDivElement | null) => {
    setEl(node)
    setRefValue(containerRef, node)
  }, [containerRef])

  const bump = React.useCallback(() => {
    setSampleRev((n) => n + 1)
  }, [])

  const registerHeader = React.useCallback((
    logicalIndex: number, mergedLabel: string, fieldLabels: string[], noSplit = false,
  ) => {
    const cur = samplesRef.current.get(logicalIndex) ?? emptySample()
    const mergedHeaderUnits = hangulUnits(mergedLabel)
    const fieldUnits = fieldLabels.map(hangulUnits)
    const same =
      cur.mergedHeaderUnits === mergedHeaderUnits
      && cur.fieldUnits.length === fieldUnits.length
      && cur.fieldUnits.every((u, i) => u === fieldUnits[i])
      && cur.noSplit === noSplit
    if (same && !(fieldLabels.length >= 2 && !cur.hasSecondary)) return
    samplesRef.current.set(logicalIndex, {
      ...cur,
      noSplit,
      mergedHeaderUnits,
      fieldUnits,
      hasSecondary: cur.hasSecondary || fieldLabels.length >= 2,
    })
    bump()
  }, [bump])

  const registerContent = React.useCallback((
    logicalIndex: number,
    primary: string,
    secondary: string,
    secondaryLabel?: string,
  ) => {
    const cur = samplesRef.current.get(logicalIndex) ?? emptySample()
    const primaryContentUnits = Math.max(cur.primaryContentUnits, hangulUnits(primary))
    const secondaryContentUnits = Math.max(cur.secondaryContentUnits, hangulUnits(secondary))
    const secondaryLabelUnits = secondaryLabel
      ? Math.max(cur.secondaryLabelUnits, hangulUnits(secondaryLabel))
      : cur.secondaryLabelUnits
    const hasSecondary = cur.hasSecondary || Boolean(secondary)
    const same =
      primaryContentUnits === cur.primaryContentUnits
      && secondaryContentUnits === cur.secondaryContentUnits
      && secondaryLabelUnits === cur.secondaryLabelUnits
      && hasSecondary === cur.hasSecondary
      && (secondaryLabel ?? cur.secondaryLabel) === cur.secondaryLabel
    if (same) return
    samplesRef.current.set(logicalIndex, {
      ...cur,
      primaryContentUnits,
      secondaryContentUnits,
      secondaryLabel: secondaryLabel ?? cur.secondaryLabel,
      secondaryLabelUnits,
      hasSecondary,
    })
    bump()
  }, [bump])

  React.useEffect(() => {
    if (!enabled || !el) return
    const apply = () => {
      setWidth(el.offsetWidth)
      const table = el.querySelector("[data-slot=table]") ?? el
      setHangulPx(measureHangulPx(table))
    }
    let raf = 0
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        apply()
      })
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(el, { box: "border-box" })
    window.addEventListener("resize", schedule)
    window.visualViewport?.addEventListener("resize", schedule)
    apply()
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", schedule)
      window.visualViewport?.removeEventListener("resize", schedule)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [el, enabled])

  /**
   * ⚠️ react-hooks/refs 억제 — 렌더 중 ref 읽기/쓰기.
   *
   * 측정치(samplesRef)는 자식 `TableHead`/`TableCell` 의 **useLayoutEffect**(커밋 단계)에서만
   * 채워지고, 채워질 때마다 `bump()` 로 `sampleRev` 를 올려 이 memo 를 다시 돌린다.
   * 즉 "렌더 중 변하는 값"이 아니라 커밋 단계에서 확정된 측정 캐시다.
   * `prevFlagsRef` 는 분할 히스테리시스 기억이며, `pickSplitStacks` 는 자기 출력을
   * prev 로 다시 넣어도 같은 결과를 내므로(멱등) 재계산에도 결과가 흔들리지 않는다.
   *
   * 2026-08-22 점검에서 이를 state 로 옮기는 순수화 리팩터를 시도했으나,
   * `ctx` 가 매 측정마다 새로 만들어지면서 자식 layout effect → setState → ctx 갱신이
   * 맞물려 무한 렌더(Maximum update depth exceeded)가 발생했다(장비 마스터 화면에서 재현).
   * 되돌렸고, 순수화는 ctx 분리(측정 등록용 컨텍스트와 결과 컨텍스트를 나누는 것)까지
   * 함께 설계해야 한다 — docs/system-audit-2026-08-22.md 「후속」 참고.
   */
  /* eslint-disable react-hooks/refs -- 위 주석 참고: 커밋 단계에서만 갱신되는 측정 캐시 */
  const splitByIndex = React.useMemo(() => {
    const flags = new Map<number, boolean>()
    if (!enabled || width <= 0) return flags

    const stackIndexes: number[] = []
    const stacks: StackBudget[] = []
    let fixedMin = 0

    for (let i = 0; i < Math.max(logicalCount, samplesRef.current.size); i++) {
      const sample = samplesRef.current.get(i)
      if (!sample) continue
      // noSplit 칸은 본문이 CellStack 이어도 나누지 않는다(헤더 선언이 우선).
      if (sample.hasSecondary && !sample.noSplit) {
        stackIndexes.push(i)
        stacks.push({
          mergedHeaderUnits: sample.mergedHeaderUnits,
          primaryHeaderUnits: sample.fieldUnits[0] ?? sample.mergedHeaderUnits,
          secondaryHeaderUnits: sample.fieldUnits[1] ?? sample.secondaryLabelUnits,
          primaryContentUnits: sample.primaryContentUnits,
          secondaryContentUnits: sample.secondaryContentUnits,
        })
      } else {
        fixedMin += colMinPx(
          sample.fieldUnits[0] ?? sample.mergedHeaderUnits,
          sample.primaryContentUnits,
          hangulPx,
        )
      }
    }

    const next = pickSplitStacks(width, hangulPx, fixedMin, stacks, prevFlagsRef.current)
    prevFlagsRef.current = next
    next.forEach((on, i) => {
      if (on) flags.set(stackIndexes[i], true)
    })
    return flags
    // sampleRev: 헤더·내용 샘플이 늘어나면 최소 폭을 다시 계산한다
  }, [enabled, width, hangulPx, logicalCount, sampleRev])
  /* eslint-enable react-hooks/refs */

  const splitExtra = React.useMemo(() => {
    let n = 0
    splitByIndex.forEach((on) => { if (on) n += 1 })
    return n
  }, [splitByIndex])
  const visualColCount = Math.max(logicalCount, 1) + splitExtra

  const ctx = React.useMemo<AdaptiveTableContextValue>(() => ({
    isSplit: (logicalIndex: number) => splitByIndex.get(logicalIndex) === true,
    secondHeader: (logicalIndex: number) => samplesRef.current.get(logicalIndex)?.secondaryLabel ?? "",
    registerHeader,
    registerContent,
    reportLogicalCount: setLogicalCount,
    visualColCount,
  }), [splitByIndex, registerHeader, registerContent, visualColCount])

  /**
   * 개발용 자가진단 — colgroup 이 실제 칸 수를 못 따라가는 화면을 즉시 알린다.
   *
   * layout="fluid|content" 는 table-fixed 라, 화면이 <col> 을 논리 열 수만큼만 선언하면
   * 자동 펼침으로 늘어난 칸이 폭 0으로 접혀 열이 통째로 사라진다(2026-08-22 점검 18번).
   * 상태를 바꾸지 않고 경고만 낸다.
   */
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production' || !el) return
    const table = el.querySelector('table')
    const declared = table?.querySelectorAll('colgroup > col').length ?? 0
    const actual = table?.querySelector('thead tr')?.children.length ?? 0
    if (declared > 0 && actual > declared) {
      console.warn(
        `[Table] <col> ${declared}개 < 실제 칸 ${actual}개 — 남는 칸이 폭 0으로 접혀 사라집니다. ` +
        'colgroup 을 최대 펼침 칸 수만큼 선언하세요 (docs/table-adaptive-columns.md §4).',
        el,
      )
    }
  }, [el, visualColCount])

  const containerOverflow =
    layout === "content" ? "overflow-x-hidden overflow-y-visible"
    : layout === "fluid" ? "overflow-x-auto overflow-y-auto"
    : "overflow-auto"

  return (
    <AdaptiveTableContext.Provider value={ctx}>
      <PinLastColContext.Provider value={pinLastColumn}>
      <div
        ref={setContainer}
        data-slot="table-container"
        data-adaptive={enabled ? "on" : "off"}
        className={cn(
          "relative min-w-0 w-full",
          layout === "content" ? "h-auto" : "min-h-0 flex-1",
          containerOverflow,
          containerClassName,
        )}
      >
        <table
          data-slot="table"
          className={cn(
            "w-full caption-bottom text-sm",
            (layout === "fluid" || layout === "content") && "table-fixed",
            className,
          )}
          {...props}
        />
      </div>
      </PinLastColContext.Provider>
    </AdaptiveTableContext.Provider>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <InHeaderContext.Provider value={true}>
      <thead
        data-slot="table-header"
        className={cn("sticky top-0 z-10 bg-card [&_tr]:border-b", className)}
        {...props}
      />
    </InHeaderContext.Provider>
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, children, ...props }: React.ComponentProps<"tr">) {
  const adaptive = React.useContext(AdaptiveTableContext)
  const inHeader = React.useContext(InHeaderContext)
  const pinLast = React.useContext(PinLastColContext)
  const items = React.Children.toArray(children)

  React.useLayoutEffect(() => {
    if (inHeader) adaptive?.reportLogicalCount(items.length)
  }, [adaptive, inHeader, items.length])

  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    >
      {items.map((child, i) => (
        <LastColContext.Provider
          key={React.isValidElement(child) && child.key != null ? String(child.key) : i}
          value={pinLast && i === items.length - 1}
        >
          <LogicalColContext.Provider value={i}>
            {child}
          </LogicalColContext.Provider>
        </LastColContext.Provider>
      ))}
    </tr>
  )
}

function TableHead({ className, children, ...props }: React.ComponentProps<"th">) {
  const adaptive = React.useContext(AdaptiveTableContext)
  const col = React.useContext(LogicalColContext)
  const pinEnd = React.useContext(LastColContext)
  const sortEl = findElementByName(children, "SortColumnHeader") as React.ReactElement<{
    col: SortColumnDef
    sortField: string | null
    sortDir: "asc" | "desc"
    onPick: (field: string, dir: "asc" | "desc") => void
  }> | null
  const fields = sortEl?.props.col.fields
  const split = adaptive?.isSplit(col) === true

  React.useLayoutEffect(() => {
    if (!adaptive) return
    if (sortEl) {
      adaptive.registerHeader(
        col,
        sortEl.props.col.label,
        sortEl.props.col.fields.map((f) => f.label),
        sortEl.props.col.noSplit === true,
      )
      return
    }
    const text = nodeToText(children)
    if (text) adaptive.registerHeader(col, text, [text])
  }, [adaptive, col, sortEl, children])

  const thClass = cn(
    "h-10 min-w-0 overflow-hidden px-3 text-left align-middle font-medium whitespace-nowrap text-muted-foreground [&:has([role=checkbox])]:pr-0",
    pinEnd && PIN_END,
    className
  )

  if (split && sortEl?.props.col.noSplit) {
    return <th data-slot="table-head" className={thClass} {...props}>{children}</th>
  }

  if (split && sortEl && fields && fields.length === 2) {
    const { sortField, sortDir, onPick } = sortEl.props
    return (
      <>
        <th data-slot="table-head" className={thClass} {...props}>
          <SortColumnHeader
            col={{ key: fields[0].id, label: fields[0].label, fields: [fields[0]] }}
            sortField={sortField}
            sortDir={sortDir}
            onPick={onPick}
          />
        </th>
        <th data-slot="table-head" className={thClass}>
          <SortColumnHeader
            col={{ key: fields[1].id, label: fields[1].label, fields: [fields[1]] }}
            sortField={sortField}
            sortDir={sortDir}
            onPick={onPick}
          />
        </th>
      </>
    )
  }

  if (split) {
    const second = adaptive?.secondHeader(col) || fields?.[1]?.label || ""
    return (
      <>
        <th data-slot="table-head" className={thClass} {...props}>{children}</th>
        <th data-slot="table-head" className={thClass}>
          <span className="text-sm font-medium">{second}</span>
        </th>
      </>
    )
  }

  return (
    <th data-slot="table-head" className={thClass} {...props}>
      {children}
    </th>
  )
}

function TableCell({ className, children, ...props }: React.ComponentProps<"td">) {
  const adaptive = React.useContext(AdaptiveTableContext)
  const col = React.useContext(LogicalColContext)
  const pinEnd = React.useContext(LastColContext)
  const stack = findElementByName(children, "CellStack") as React.ReactElement<{
    primary?: React.ReactNode
    secondary?: React.ReactNode
    secondaryLabel?: string
  }> | null
  const secondary = stack?.props.secondary
  const hasSecondary = secondary != null && secondary !== false && secondary !== ""
  const split = adaptive?.isSplit(col) === true

  React.useLayoutEffect(() => {
    if (!adaptive) return
    if (stack) {
      adaptive.registerContent(
        col,
        nodeToText(stack.props.primary),
        hasSecondary ? nodeToText(secondary) : "",
        stack.props.secondaryLabel,
      )
      return
    }
    const text = nodeToText(children)
    if (text) adaptive.registerContent(col, text, "")
  }, [adaptive, col, stack, hasSecondary, secondary, children])

  const tdClass = cn(
    "min-w-0 overflow-hidden px-3 py-2.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
    pinEnd && PIN_END,
    className
  )

  if (split && stack) {
    return (
      <>
        <td data-slot="table-cell" className={tdClass} {...props}>
          {replaceCellStackSecondary(children)}
        </td>
        <td data-slot="table-cell" className={tdClass}>
          <div className="min-w-0 truncate text-xs text-muted-foreground">
            {hasSecondary ? secondary : "—"}
          </div>
        </td>
      </>
    )
  }

  return (
    <td data-slot="table-cell" className={tdClass} {...props}>
      {children}
    </td>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
