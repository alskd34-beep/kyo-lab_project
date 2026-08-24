'use client'

/**
 * Monday.com 스타일 그룹 보드 컴포넌트 (Phase 1)
 *
 * - 행들을 group 단위로 묶어 표시
 * - 상태 칩(파랑 램프), 그룹 색 좌측 실선, 펼치기/접기
 * - 컬럼 정의(ColumnDef)에 따라 셀 렌더링 (텍스트, 칩, 날짜, 사람 등)
 *
 * Phase 1은 표시 전용. 상태/배정 변경은 Phase 2에서 추가 예정.
 */

import { useState, useRef, useEffect } from 'react'
import { DateField } from '@frontend/components/ui/date-field'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@frontend/components/ui/select'
import { TesterAvatar } from '@frontend/lib/tester-profiles'

// ─── Types ────────────────────────────────────────────────────────────────────
export interface BoardRow {
  id:   string | number
  data: Record<string, unknown>
}

export interface BoardGroup {
  id:    string
  label: string
  color: string  // tailwind class fragment e.g. 'bg-blue-500'
  rows:  BoardRow[]
}

export type CellKind = 'text' | 'chip' | 'date' | 'number' | 'person' | 'mono'

export interface ColumnDef {
  key:   string
  label: string
  kind?: CellKind
  width?: number  // px
  /** chip 색상 매핑. value -> CHIP_FILL 의 키('blue300'~'blue700'/'amber'/'red'/'slate' 등) */
  chipColor?: Record<string, string>
  /** 셀 편집 가능 여부 */
  editable?: boolean
  /** chip/person 등 select 셀의 선택지 */
  options?: string[]
}

interface MondayBoardProps {
  groups:  BoardGroup[]
  columns: ColumnDef[]
  emptyMessage?: string
  /** 셀 값 변경 콜백. editable=true 컬럼에서만 호출됨. */
  onCellChange?: (rowId: string | number, columnKey: string, newValue: string) => void
  /** true면 그룹을 접힌 상태로 시작 (주간 날짜만 보이고 필요 시 펼침) */
  defaultCollapsed?: boolean
  /** 상단에 "전체 펼치기/접기" 컨트롤 표시 */
  showToggleAll?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MondayBoard({ groups, columns, emptyMessage, onCellChange, defaultCollapsed = false, showToggleAll = false }: MondayBoardProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    defaultCollapsed ? new Set(groups.map(g => g.id)) : new Set()
  )
  // defaultCollapsed일 때, 비동기로 도착하는 새 그룹을 최초 1회 접힌 상태로 등록.
  // 사용자가 직접 펼친 그룹은 다시 접지 않도록 "이미 본 그룹" ref로 추적.
  const seenRef = useRef<Set<string>>(new Set(defaultCollapsed ? groups.map(g => g.id) : []))
  useEffect(() => {
    if (!defaultCollapsed) return
    const fresh = groups.filter(g => !seenRef.current.has(g.id))
    if (fresh.length === 0) return
    setCollapsed(prev => {
      const next = new Set(prev)
      for (const g of fresh) { next.add(g.id); seenRef.current.add(g.id) }
      return next
    })
  }, [groups, defaultCollapsed])

  const toggleGroup = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const expandAll   = () => setCollapsed(new Set())
  const collapseAll = () => setCollapsed(new Set(groups.map(g => g.id)))

  const renderCellCell = (col: ColumnDef, row: BoardRow) => {
    const val = row.data[col.key]
    const s = val == null ? '' : String(val)
    if (col.editable && onCellChange) {
      return (
        <EditableCell
          col={col}
          value={s}
          onChange={v => onCellChange(row.id, col.key, v)}
        />
      )
    }
    return renderCellStatic(col, val)
  }

  if (groups.every(g => g.rows.length === 0)) {
    return (
      <p className="px-6 py-10 text-center text-sm text-muted-foreground">
        {emptyMessage ?? '표시할 데이터가 없습니다.'}
      </p>
    )
  }

  const nonEmpty = groups.filter(g => g.rows.length > 0)
  const allClosed = nonEmpty.length > 0 && nonEmpty.every(g => collapsed.has(g.id))

  return (
    <div className="overflow-x-auto">
      <div className="min-w-full">
        {showToggleAll && nonEmpty.length > 1 && (
          <div className="mb-2 flex items-center justify-end">
            <button
              onClick={allClosed ? expandAll : collapseAll}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs leading-normal font-medium text-muted-foreground hover:bg-muted/60 transition-colors"
            >
              {allClosed
                ? <><ChevronDown size={13} /> 전체 펼치기</>
                : <><ChevronRight size={13} /> 전체 접기</>}
            </button>
          </div>
        )}
        {groups.map(group => {
          const isClosed = collapsed.has(group.id)
          if (group.rows.length === 0) return null

          return (
            <div key={group.id} className="mb-5">
              {/* Group header — monday 스타일: 큰 컬러 좌측 바 + 컬러 텍스트 */}
              <button
                onClick={() => toggleGroup(group.id)}
                className="group/header flex w-full items-center gap-2 py-1.5 hover:opacity-90"
              >
                {isClosed
                  ? <ChevronRight size={16} className="text-muted-foreground" />
                  : <ChevronDown  size={16} className="text-muted-foreground" />}
                <span className={`inline-block h-4 w-1.5 rounded-md ${group.color}`} />
                <span className={`text-xs leading-normal font-bold ${textColorFromBg(group.color)}`}>
                  {group.label}
                </span>
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs leading-normal font-semibold text-muted-foreground">
                  {group.rows.length}
                </span>
              </button>

              {!isClosed && (
                <div className={`overflow-x-auto rounded-r-md border-l ${borderLeftFromBg(group.color)} bg-card shadow-sm`}>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-border">
                        {columns.map(c => (
                          <th
                            key={c.key}
                            className="px-3 py-2.5 text-left text-xs leading-normal font-semibold text-muted-foreground bg-muted/50"
                            style={c.width ? { width: c.width, minWidth: c.width } : undefined}
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map(row => (
                        <tr
                          key={row.id}
                          className="group/row border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                        >
                          {columns.map(c => (
                            <td
                              key={c.key}
                              className={`px-3 py-2 align-middle ${c.kind === 'chip' ? 'overflow-hidden' : ''}`}
                              style={c.width ? { width: c.width, minWidth: c.width } : undefined}
                            >
                              {renderCellCell(c, row)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Cell renderers ───────────────────────────────────────────────────────────
// Monday.com 스타일: 셀 전체에 컬러 채움 + 흰 텍스트
const CHIP_FILL: Record<string, string> = {
  // 작업 단계용 파랑 램프 — 진행할수록 진해진다(types/qc-status.ts STAGE_STYLE 과 같은 흐름)
  blue300: 'bg-blue-300   text-blue-900 hover:bg-blue-400',
  blue400: 'bg-blue-400   text-white hover:bg-blue-500',
  blue500: 'bg-blue-500   text-white hover:bg-blue-600',
  blue600: 'bg-blue-600   text-white hover:bg-blue-700',
  blue700: 'bg-blue-700   text-white hover:bg-blue-800',
  // 뜻이 있는 나머지 — 경고는 앰버, 오류·긴급은 빨강, 중립은 슬레이트.
  // emerald/rose/teal 은 어느 chipColor 도 부르지 않는 무지개 잔재라 걷어냈다.
  amber:   'bg-amber-400   text-white hover:bg-amber-500',
  red:     'bg-red-500     text-white hover:bg-red-600',
  blue:    'bg-blue-500    text-white hover:bg-blue-600',
  slate:   'bg-slate-300   text-slate-700 hover:bg-slate-400 dark:bg-slate-600 dark:text-slate-100 dark:hover:bg-slate-500',
}

// ─── Editable cell ────────────────────────────────────────────────────────────
interface EditableCellProps {
  col: ColumnDef
  value: string
  onChange: (newValue: string) => void
}

function EditableCell({ col, value, onChange }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus() }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft !== value) onChange(draft)
  }
  const cancel = () => { setDraft(value); setEditing(false) }

  // chip/person 같은 옵션 선택형
  const isSelect = (col.kind === 'chip' || col.kind === 'person') && (col.options?.length ?? 0) > 0
  // 날짜는 공통 <DateField> 를 쓴다(프로젝트 규칙). 여기서는 숫자/텍스트만 네이티브 input.
  const inputType = col.kind === 'number' ? 'number' : 'text'

  if (!editing) {
    // Chip 셀: 셀 전체 풀 컬러 button (monday.com 스타일)
    if (col.kind === 'chip') {
      const colorKey = col.chipColor?.[value] ?? 'slate'
      const fillCls = value
        ? (CHIP_FILL[colorKey] ?? CHIP_FILL.slate)
        : 'bg-muted text-muted-foreground hover:bg-muted-foreground/20'
      return (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={`-mx-3 -my-2 flex h-full w-full cursor-pointer items-center justify-center px-3 py-2 text-xs font-bold transition-colors ${fillCls}`}
        >
          {value || '—'}
        </button>
      )
    }
    // 일반 셀: 살짝 하이라이트되는 hover wrapper
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group/cell -mx-1 flex w-full items-center rounded-md px-1 py-0.5 text-left hover:bg-blue-50 dark:hover:bg-blue-950/30 hover:ring-1 hover:ring-blue-200 dark:hover:ring-blue-800 transition-colors"
      >
        <span className="flex-1">{renderCellStatic(col, value)}</span>
      </button>
    )
  }

  if (col.kind === 'date') {
    return (
      <DateField
        size="sm"
        noLabel
        value={draft}
        onChange={v => {
          // 달력 선택·8자리 입력이 끝나면 바로 커밋한다(Select 분기와 동일한 규칙).
          setDraft(v)
          setEditing(false)
          if (v !== value) onChange(v)
        }}
      />
    )
  }

  if (isSelect) {
    return (
      <Select
        value={draft || 'none'}
        onValueChange={v => {
          const next = v === 'none' ? '' : v
          setDraft(next)
          // 선택 즉시 커밋 (Radix Select는 onBlur가 없음)
          setEditing(false)
          if (next !== value) onChange(next)
        }}
        onOpenChange={open => { if (!open) setEditing(false) }}
      >
        <SelectTrigger className="h-7 w-full px-2 text-xs border-blue-300 dark:border-blue-700 bg-card text-foreground focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/40">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">—</SelectItem>
          {col.options!.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    )
  }

  return (
    <input
      ref={el => { inputRef.current = el }}
      type={inputType}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel() }}
      className="w-full rounded-md border border-blue-300 dark:border-blue-700 bg-card px-1.5 py-0.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-900/40"
    />
  )
}

function renderCellStatic(col: ColumnDef, val: unknown) {
  const s = val == null || val === '' ? '' : String(val)

  if (s === '') {
    // chip 셀이지만 비어있을 때도 셀 전체를 회색으로 (monday 스타일)
    if (col.kind === 'chip') {
      return (
        <div className="-mx-3 -my-2 flex h-full items-center justify-center px-3 py-2 bg-muted text-muted-foreground text-xs">
          —
        </div>
      )
    }
    return <span className="text-muted-foreground/60">—</span>
  }

  switch (col.kind) {
    case 'mono':
      return <span className="font-mono text-xs text-muted-foreground">{s}</span>
    case 'number':
      return <span className="tabular-nums text-foreground">{s}</span>
    case 'date':
      return <span className="font-mono text-xs leading-normal text-muted-foreground">{s}</span>
    case 'chip': {
      // Monday 스타일: 셀 전체 컬러로 채움 (td padding 무효화)
      const colorKey = col.chipColor?.[s] ?? 'slate'
      const cls = CHIP_FILL[colorKey] ?? CHIP_FILL.slate
      return (
        <div className={`-mx-3 -my-2 flex h-full items-center justify-center px-3 py-2 text-xs font-bold transition-colors ${cls}`}>
          {s}
        </div>
      )
    }
    case 'person': {
      /* 사람 표시는 앱 공통 <TesterAvatar> 하나로 통일한다. 예전에는 여기서만
         이름 해시로 12색 원형 배지를 그려, 같은 사람이 홈에서는 이모지 · 보드에서는
         색 원으로 보였다. 무지개 팔레트(violet·sky·fuchsia…)도 여기서 사라진다. */
      return (
        <div className="flex min-w-0 items-center gap-1.5">
          <TesterAvatar name={s} size="xs" />
          <span className="min-w-0 truncate text-xs text-foreground">{s}</span>
        </div>
      )
    }
    default:
      return <span className="text-sm text-foreground">{s}</span>
  }
}

// ─── helpers: 그룹 헤더 매칭 톤 (Tailwind 정적 클래스 보존) ─────────────────────
// 그룹 색은 뜻이 아니라 "옆 그룹과 구분"일 뿐이라 무지개 대신 파랑 램프를 돈다
// (STAGE_STYLE 과 같은 흐름 — 주차처럼 순서가 있는 그룹에서는 농도가 곧 순서가 된다).
const TEXT_BY_BG: Record<string, string> = {
  'bg-blue-700':    'text-blue-800 dark:text-blue-200',
  'bg-blue-600':    'text-blue-700 dark:text-blue-300',
  'bg-blue-500':    'text-blue-700 dark:text-blue-300',
  'bg-blue-400':    'text-blue-600 dark:text-blue-300',
  'bg-blue-300':    'text-blue-600 dark:text-blue-300',
  'bg-blue-200':    'text-blue-600 dark:text-blue-300',
  'bg-amber-500':   'text-amber-700 dark:text-amber-300',
  'bg-red-500':     'text-red-700 dark:text-red-300',
  'bg-slate-500':   'text-slate-700 dark:text-slate-300',
}
const BORDER_BY_BG: Record<string, string> = {
  'bg-blue-700':    'border-blue-600',
  'bg-blue-600':    'border-blue-500',
  'bg-blue-500':    'border-blue-400',
  'bg-blue-400':    'border-blue-300',
  'bg-blue-300':    'border-blue-300',
  'bg-blue-200':    'border-blue-200',
  'bg-amber-500':   'border-amber-400',
  'bg-red-500':     'border-red-400',
  'bg-slate-500':   'border-slate-400',
}
const textColorFromBg = (bg: string) => TEXT_BY_BG[bg] ?? 'text-foreground'
const borderLeftFromBg = (bg: string) => BORDER_BY_BG[bg] ?? 'border-slate-300'
