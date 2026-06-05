'use client'

/**
 * 구글 시트 데이터를 가져와 먼데이 스타일 보드로 표시하는 섹션
 * 주간 스케줄 페이지에 마운트됩니다.
 *
 * Phase 1: 표시만 (상태/배정 변경은 다음 단계)
 */

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@frontend/components/ui/card'
import { Button } from '@frontend/components/ui/button'
import { FileSpreadsheet, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import MondayBoard, { type BoardGroup, type ColumnDef } from './MondayBoard'

interface SheetRow {
  [k: string]: string
}
interface SheetResponse {
  fileId:  string
  columns: string[]
  rows:    SheetRow[]
}

const DEFAULT_FILE_ID = '1H9_lR-_tpEHKSpVD2qLbxX5cqXRG_s5rpbGs-gqSPxU'

// ─── Utils: '6/1' 형식 → 주차 라벨 / 정렬용 키 ─────────────────────────────────
function parseShortDate(s: string, defaultYear: number): { iso: string; weekKey: string; weekLabel: string } | null {
  if (!s) return null
  const m = s.match(/^(\d{1,2})[\.\/](\d{1,2})$/)
  if (!m) return null
  const [_, mm, dd] = m
  const month = Number(mm), day = Number(dd)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(defaultYear, month - 1, day))
  // ISO week (월 시작)
  const dow = (d.getUTCDay() + 6) % 7 // 월=0
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - dow)
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6)
  const iso = d.toISOString().slice(0, 10)
  const wk  = monday.toISOString().slice(0, 10)
  const fmtKor = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`
  return { iso, weekKey: wk, weekLabel: `${fmtKor(monday)} ~ ${fmtKor(sunday)}` }
}

const GROUP_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-fuchsia-500']

// ─── Component ────────────────────────────────────────────────────────────────
export default function SheetBoardSection() {
  const [fileId, setFileId]   = useState(DEFAULT_FILE_ID)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<SheetResponse | null>(null)

  const loadSheet = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/google-sheet?fileId=${encodeURIComponent(fileId)}`, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '시트 불러오기 실패')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
    } finally {
      setLoading(false)
    }
  }

  const buildGroups = (resp: SheetResponse): BoardGroup[] => {
    const year = new Date().getFullYear()
    const buckets = new Map<string, { label: string; rows: BoardRowLite[] }>()

    resp.rows.forEach((r, idx) => {
      const dateStr = r['포장일_예정일'] || r['포장일']  || ''
      const parsed  = parseShortDate(dateStr, year)
      const weekKey   = parsed?.weekKey   ?? 'no-date'
      const weekLabel = parsed?.weekLabel ?? '기간 미정'
      const isoDate   = parsed?.iso       ?? ''

      if (!buckets.has(weekKey)) buckets.set(weekKey, { label: weekLabel, rows: [] })
      buckets.get(weekKey)!.rows.push({
        id: r['품목코드'] ? `${r['품목코드']}-${r['제조번호']}-${idx}` : String(idx),
        data: {
          품목명:     r['품목명'] || '',
          품목코드:   r['품목코드'] || '',
          제조번호:   r['제조번호'] || '',
          제형:       r['제형'] || '',
          포장일:     isoDate || dateStr,
          상태:       '대기',
          담당자:     '',
        },
      })
    })

    const sortedKeys = Array.from(buckets.keys()).sort((a, b) => {
      if (a === 'no-date') return 1
      if (b === 'no-date') return -1
      return a.localeCompare(b)
    })

    return sortedKeys.map((k, i) => ({
      id:    k,
      label: buckets.get(k)!.label,
      color: GROUP_COLORS[i % GROUP_COLORS.length],
      rows:  buckets.get(k)!.rows,
    }))
  }

  const columns: ColumnDef[] = [
    { key: '품목명',   label: '품목명',   kind: 'text',   width: 280 },
    { key: '품목코드', label: '코드',     kind: 'mono',   width: 80  },
    { key: '제조번호', label: '제조번호', kind: 'mono',   width: 100 },
    { key: '제형',     label: '제형',     kind: 'text',   width: 110 },
    { key: '포장일',   label: '포장일',   kind: 'date',   width: 110 },
    { key: '상태',     label: '상태',     kind: 'chip',   width: 90,
      chipColor: { '대기': 'slate', '진행중': 'blue', '검토중': 'violet', '완료': 'emerald', '지연': 'red' } },
    { key: '담당자',   label: '담당자',   kind: 'person', width: 140 },
  ]

  const groups = data ? buildGroups(data) : []

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-slate-900 dark:text-slate-50">
          <FileSpreadsheet size={16} className="text-emerald-600 dark:text-emerald-400" />
          구글 시트 → 주간 보드
          {data && (
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              ({data.rows.length}건)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 시트 ID 입력 + 불러오기 */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-1 min-w-[280px] flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              구글 시트 ID
            </label>
            <input
              type="text"
              value={fileId}
              onChange={e => setFileId(e.target.value)}
              disabled={loading}
              className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:focus:ring-emerald-900/40 text-slate-900 dark:text-slate-50 disabled:opacity-60"
              placeholder="시트 URL의 /d/ 다음 ID"
            />
          </div>
          <Button
            onClick={loadSheet}
            disabled={loading || !fileId.trim()}
            className="h-9 gap-1.5 bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {loading ? '불러오는 중...' : data ? '새로고침' : '시트 불러오기'}
          </Button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-3">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
            <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {data && (
          <MondayBoard
            groups={groups}
            columns={columns}
            emptyMessage="시트에 표시할 행이 없습니다."
          />
        )}

        {data && (
          <p className="text-[10px] italic text-slate-500 dark:text-slate-400">
            * 포장일 기준 주차별 그룹입니다. 상태/담당자는 표시 전용이며, 다음 단계에서 변경 가능해질 예정입니다.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

interface BoardRowLite {
  id: string | number
  data: Record<string, unknown>
}
