'use client'

/**
 * PCT (생산관리) — 구글 시트 연동 보드
 *
 * - 구글 시트에서 생산 배치 정보를 가져와 먼데이.com 스타일 보드로 표시
 * - 셀 편집 가능 (클라이언트 상태로만 유지, 새로고침 시 초기화)
 * - 변경사항 카운팅 + "DB로 보내기" 버튼 자리 (Supabase 동기화는 다음 단계에서 활성화)
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@frontend/components/ui/card'
import { Button } from '@frontend/components/ui/button'
import {
  Factory,
  FileSpreadsheet,
  Loader2,
  AlertCircle,
  RefreshCw,
  Database,
  Plus,
  Save,
  RotateCcw,
  Sparkles,
  UserMinus,
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
} from 'lucide-react'
import MondayBoard, { type BoardGroup, type ColumnDef } from '@frontend/components/board/MondayBoard'
import {
  pctRowToMonthly,
  savePctMonthlySnapshot,
  loadPctMonthlySnapshot,
  type PctMonthlyAssignment,
} from '@frontend/lib/pct-schedule-bridge'

// ─── Types ────────────────────────────────────────────────────────────────────
interface SheetResponse {
  fileId:  string
  columns: string[]
  rows:    Record<string, string>[]
}

interface PctRow {
  id:               string  // 클라이언트 row id (시트 입력 순서 보존)
  품목코드:          string
  품목명:            string
  제조번호:          string
  제형:              string
  포장일:            string  // ISO YYYY-MM-DD 또는 '6/1' 등 원본 보존
  시험완료요청일:    string
  긴급:              string  // '일반' | '긴급'
  진행방법:          string  // '전항목' | '개별항목'
  상태:              string
  담당자:            string
  비고:              string
  _origin:          'sheet' | 'added'
  _dirty:           boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_FILE_ID = '1H9_lR-_tpEHKSpVD2qLbxX5cqXRG_s5rpbGs-gqSPxU'

const STATUS_OPTIONS   = ['대기', '진행중', '검토중', '완료', '지연']
const URGENT_OPTIONS   = ['일반', '긴급']
const METHOD_OPTIONS   = ['전항목', '개별항목']
const PERSON_OPTIONS   = ['김태훈', '박성호', '권택균', '장재훈', '지건희', '김기호', '이영남', '안성은', '임수민', '김태환', '박윤진', '정예찬', '이원재', '김정호', '강지윤']

const GROUP_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-fuchsia-500']

// ─── Utils ────────────────────────────────────────────────────────────────────
function parseShortDate(s: string, defaultYear: number): { iso: string; weekKey: string; weekLabel: string } | null {
  if (!s) return null
  // 이미 ISO 형식이면 그대로
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const d = new Date(s + 'T00:00:00Z')
    const dow = (d.getUTCDay() + 6) % 7
    const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - dow)
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6)
    const fmt = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`
    return {
      iso:       d.toISOString().slice(0, 10),
      weekKey:   monday.toISOString().slice(0, 10),
      weekLabel: `${fmt(monday)} ~ ${fmt(sunday)}`,
    }
  }
  const m = s.match(/^(\d{1,2})[\.\/](\d{1,2})$/)
  if (!m) return null
  const month = Number(m[1]), day = Number(m[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(defaultYear, month - 1, day))
  const dow = (d.getUTCDay() + 6) % 7
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - dow)
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`
  return {
    iso:       d.toISOString().slice(0, 10),
    weekKey:   monday.toISOString().slice(0, 10),
    weekLabel: `${fmt(monday)} ~ ${fmt(sunday)}`,
  }
}

// 컬럼명 fallback 체인 (시트가 갱신되어도 호환)
function pick(r: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k]
    if (v != null && v.trim() !== '') return v.trim()
  }
  return ''
}
const SHEET_KEY_CODE     = ['품목코드', '자재코드']
const SHEET_KEY_NAME     = ['품목명',   '자재내역']
const SHEET_KEY_BATCH    = ['제조번호']
const SHEET_KEY_FORM     = ['제형']
const SHEET_KEY_PACK     = ['포장일_예정일', '포장일/예정일', '포장일']
const SHEET_KEY_DEADLINE = ['시험완료요청일', 'QC완료예정일', 'QC 완료예정일']
const SHEET_KEY_URGENT   = ['긴급', '우선순위']
const SHEET_KEY_NOTE     = ['비고']

/**
 * 비고 텍스트에서 긴급 의도 추출.
 * "긴급" 포함 시 true, 단 다음 부정 표현은 제외:
 *   - "긴급 아님", "긴급 안 됨"
 *   - "비긴급", "긴급 X", "긴급 x"
 *   - "긴급하지 않", "긴급이 아니"
 */
function noteImpliesUrgent(note: string): boolean {
  const n = (note ?? '').trim()
  if (!n.includes('긴급')) return false
  if (/비\s*긴급/.test(n))                   return false
  if (/긴급\s*(아님|아닙|안\s?됨|X|x|없음)/.test(n)) return false
  if (/긴급(하지|이|은)\s*(아니|않)/.test(n))      return false
  return true
}

function rowsFromSheet(resp: SheetResponse): PctRow[] {
  // 운영 메모 등 데이터가 아닌 행 제거: 품목코드/품목명 모두 비어있으면 무시
  const filtered = resp.rows.filter(r => pick(r, SHEET_KEY_CODE) && pick(r, SHEET_KEY_NAME))

  return filtered.map((r, idx) => {
    const note      = pick(r, SHEET_KEY_NOTE)
    const urgentRaw = pick(r, SHEET_KEY_URGENT)
    const urgent    = (urgentRaw === '긴급' || noteImpliesUrgent(note)) ? '긴급' : '일반'

    return {
      id:                `sheet-${idx}`,
      품목코드:           pick(r, SHEET_KEY_CODE),
      품목명:             pick(r, SHEET_KEY_NAME),
      제조번호:           pick(r, SHEET_KEY_BATCH),
      제형:               pick(r, SHEET_KEY_FORM),
      포장일:             pick(r, SHEET_KEY_PACK),
      시험완료요청일:     pick(r, SHEET_KEY_DEADLINE),
      긴급:               urgent,
      진행방법:           '전항목',  // 기본값
      상태:               '대기',
      담당자:             '',
      비고:               note,
      _origin:           'sheet',
      _dirty:            false,
    }
  })
}

// ─── 시험자 + 역량 데이터 타입 ───────────────────────────────────────────────
interface Tester {
  id: string
  employeeNo: string
  name: string
  canSolo: boolean
  canDuo: boolean
  isActive: boolean
}

interface CapabilityMatrixRow {
  testerId: string
  capabilityId: string
  proficiencyLevel: 'Y' | 'N' | 'X' | 'O'
}

// ─── 자동 배정 알고리즘 ─────────────────────────────────────────────────────
/**
 * 비고에 '긴급' 단어가 있으면 1순위, 긴급 chip이면 2순위, 나머지 일반.
 * 같은 순위에서는 시험완료요청일 → 포장일 → 입력 순서.
 * 자격(can_solo + 활성) 보유 + 역량(matrix)에 'Y' 또는 'O' 항목이 1개 이상인 시험자만 풀에 포함.
 * 가장 적은 부하의 시험자에게 1건씩 분배.
 */
function autoAssign(
  rows: PctRow[],
  testers: Tester[],
  matrix: CapabilityMatrixRow[],
): { rows: PctRow[]; stats: { assignedCount: number; urgentCount: number; testersUsed: number } } {
  // 1. 자격 있는 시험자 집합 — 활성 + Solo + 역량 1개 이상 Y/O
  const proficientByTester = new Map<string, number>()
  for (const m of matrix) {
    if (m.proficiencyLevel === 'Y' || m.proficiencyLevel === 'O') {
      proficientByTester.set(m.testerId, (proficientByTester.get(m.testerId) ?? 0) + 1)
    }
  }
  const pool = testers
    .filter(t => t.isActive && t.canSolo && (proficientByTester.get(t.id) ?? 0) > 0)
    .map(t => ({ ...t, _load: 0 }))

  // 자격자가 0이면 모든 활성/Solo 시험자 fallback
  const effectivePool = pool.length > 0
    ? pool
    : testers.filter(t => t.isActive && t.canSolo).map(t => ({ ...t, _load: 0 }))

  if (effectivePool.length === 0) {
    return { rows, stats: { assignedCount: 0, urgentCount: 0, testersUsed: 0 } }
  }

  // 2. 우선순위 점수 계산 (부정 표현 제외한 정확한 긴급 감지)
  const priority = (r: PctRow): number => {
    if (noteImpliesUrgent(r.비고 ?? '')) return 0  // 비고 긴급 → 최우선
    if (r.긴급 === '긴급')               return 1  // 긴급 chip → 두번째
    return 2                                         // 일반
  }

  // 3. 정렬용 인덱스 보존 (재배치 후 원래 순서로 복원)
  const indexed = rows.map((r, idx) => ({ r, idx }))
  const sorted = [...indexed].sort((a, b) => {
    const pa = priority(a.r), pb = priority(b.r)
    if (pa !== pb) return pa - pb
    const dateA = a.r.시험완료요청일 || a.r.포장일 || ''
    const dateB = b.r.시험완료요청일 || b.r.포장일 || ''
    if (dateA !== dateB) return dateA.localeCompare(dateB)
    return a.idx - b.idx
  })

  // 4. 부하 최소 시험자에게 배정 (라운드 로빈 + 가중치)
  const assignments = new Map<string, string>()  // rowId -> testerName
  for (const { r } of sorted) {
    effectivePool.sort((x, y) => x._load - y._load)
    const chosen = effectivePool[0]
    assignments.set(r.id, chosen.name)
    chosen._load += 1
  }

  // 5. 원래 rows 순서에 결과 적용
  const newRows = rows.map(r => {
    const name = assignments.get(r.id) ?? r.담당자
    if (name === r.담당자) return r  // 동일하면 _dirty 그대로
    return { ...r, 담당자: name, _dirty: true }
  })

  return {
    rows: newRows,
    stats: {
      assignedCount: assignments.size,
      urgentCount:   rows.filter(r => priority(r) < 2).length,
      testersUsed:   new Set(assignments.values()).size,
    },
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PctPage() {
  const [fileId, setFileId]   = useState(DEFAULT_FILE_ID)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [rows, setRows]       = useState<PctRow[]>([])
  const [originalRows, setOriginalRows] = useState<PctRow[]>([])

  // 시험자 + 역량 데이터 (자동 배정용)
  const [testers, setTesters] = useState<Tester[]>([])
  const [matrix,  setMatrix]  = useState<CapabilityMatrixRow[]>([])
  const [autoStats, setAutoStats] = useState<{ assignedCount: number; urgentCount: number; testersUsed: number } | null>(null)

  // 페이지 마운트 시 시험자/역량 fetch (실패 시 fallback PERSON_OPTIONS 사용)
  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        const [tRes, cRes] = await Promise.all([
          fetch('/api/testers',              { credentials: 'include' }),
          fetch('/api/tester-capabilities',  { credentials: 'include' }),
        ])
        if (!tRes.ok || !cRes.ok) {
          console.warn('[PCT] 시험자/역량 fetch 실패 — 기본 명단으로 fallback', tRes.status, cRes.status)
          return
        }
        const [tJson, cJson] = await Promise.all([tRes.json(), cRes.json()])
        if (aborted) return
        setTesters((tJson?.rows   ?? []) as Tester[])
        setMatrix ((cJson?.matrix ?? []) as CapabilityMatrixRow[])
      } catch (e) {
        if (!aborted) console.warn('[PCT] 시험자/역량 fetch 예외 — 기본 명단으로 fallback', e)
      }
    })()
    return () => { aborted = true }
  }, [])

  const loadSheet = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/google-sheet?fileId=${encodeURIComponent(fileId)}`, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '시트 불러오기 실패')
      const next = rowsFromSheet(json)
      setRows(next)
      setOriginalRows(next.map(r => ({ ...r })))
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
    } finally {
      setLoading(false)
    }
  }, [fileId])

  const onCellChange = useCallback((rowId: string | number, columnKey: string, newValue: string) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r
      return { ...r, [columnKey]: newValue, _dirty: true }
    }))
  }, [])

  const addRow = useCallback(() => {
    const id = `new-${Date.now()}`
    setRows(prev => [
      {
        id,
        품목코드: '', 품목명: '', 제조번호: '', 제형: '',
        포장일: '', 시험완료요청일: '',
        긴급: '일반', 진행방법: '전항목',
        상태: '대기', 담당자: '', 비고: '',
        _origin: 'added', _dirty: true,
      },
      ...prev,
    ])
  }, [])

  const resetChanges = useCallback(() => {
    setRows(originalRows.map(r => ({ ...r })))
    setAutoStats(null)
  }, [originalRows])

  // 자동 배정 — 비고 '긴급' 우선, 부하 최소 시험자에게 분배
  const handleAutoAssign = useCallback(() => {
    if (rows.length === 0) return
    const result = autoAssign(rows, testers, matrix)
    setRows(result.rows)
    setAutoStats(result.stats)
  }, [rows, testers, matrix])

  // 담당자 일괄 초기화
  const clearAllAssignments = useCallback(() => {
    setRows(prev => prev.map(r => r.담당자 ? { ...r, 담당자: '', _dirty: true } : r))
    setAutoStats(null)
  }, [])

  // 월간 스케줄로 보낼 결과 (담당자 있는 행만)
  const [scheduleStats, setScheduleStats] = useState<{
    saved:    number
    skipped:  number
    generatedAt: string
  } | null>(null)

  // 페이지 로드 시 기존 스냅샷 메타정보 표시
  useEffect(() => {
    const snap = loadPctMonthlySnapshot()
    if (snap) {
      setScheduleStats({
        saved:       snap.assignments.length,
        skipped:     0,
        generatedAt: snap.generatedAt,
      })
    }
  }, [])

  /**
   * 스케줄 생성 — 자동/수동 배정된 행을 월간 스케줄용 스냅샷으로 저장.
   * 담당자 미지정/포장일 누락 행은 자동 제외.
   */
  const handleGenerateSchedule = useCallback(() => {
    if (rows.length === 0) return
    const assignments: PctMonthlyAssignment[] = []
    let skipped = 0
    for (const r of rows) {
      const m = pctRowToMonthly(r)
      if (m) assignments.push(m)
      else   skipped++
    }
    savePctMonthlySnapshot(assignments)
    setScheduleStats({
      saved:       assignments.length,
      skipped,
      generatedAt: new Date().toISOString(),
    })
  }, [rows])

  const stats = useMemo(() => {
    const added    = rows.filter(r => r._origin === 'added').length
    const modified = rows.filter(r => r._origin === 'sheet' && r._dirty).length
    return { total: rows.length, added, modified, changes: added + modified }
  }, [rows])

  // 시험자 목록을 DB 우선, 실패 시 fallback 사용
  const personOptions = useMemo(() => {
    const active = testers.filter(t => t.isActive).map(t => t.name)
    return active.length > 0 ? active : PERSON_OPTIONS
  }, [testers])

  // 보드 컬럼 정의 — 너비 최적화로 가로 폭 절약 (총 ~1180px → 가로 스크롤 최소)
  const columns: ColumnDef[] = [
    { key: '품목명',         label: '품목명',         kind: 'text',   width: 180, editable: true },
    { key: '품목코드',       label: '코드',           kind: 'mono',   width: 70,  editable: true },
    { key: '제조번호',       label: '제조번호',       kind: 'mono',   width: 80,  editable: true },
    { key: '제형',           label: '제형',           kind: 'text',   width: 80,  editable: true },
    { key: '포장일',         label: '포장일',         kind: 'date',   width: 100, editable: true },
    { key: '시험완료요청일', label: '완료요청일',     kind: 'date',   width: 110, editable: true },
    { key: '긴급',           label: '긴급',           kind: 'chip',   width: 70,  editable: true,
      options: [...URGENT_OPTIONS],
      chipColor: { '일반': 'slate', '긴급': 'red' } },
    { key: '진행방법',       label: '진행방법',       kind: 'chip',   width: 95,  editable: true,
      options: [...METHOD_OPTIONS],
      chipColor: { '전항목': 'blue', '개별항목': 'violet' } },
    { key: '상태',           label: '상태',           kind: 'chip',   width: 85,  editable: true,
      options: [...STATUS_OPTIONS],
      chipColor: { '대기': 'slate', '진행중': 'blue', '검토중': 'violet', '완료': 'emerald', '지연': 'red' } },
    { key: '담당자',         label: '담당자',         kind: 'person', width: 110, editable: true,
      options: personOptions },
    { key: '비고',           label: '비고',           kind: 'text',   width: 140, editable: true },
  ]

  // 주차별 그룹화
  const groups: BoardGroup[] = useMemo(() => {
    const year = new Date().getFullYear()
    const buckets = new Map<string, { label: string; rows: PctRow[] }>()

    for (const r of rows) {
      const parsed = parseShortDate(r.포장일, year)
      const k     = parsed?.weekKey   ?? 'no-date'
      const label = parsed?.weekLabel ?? '기간 미정'
      if (!buckets.has(k)) buckets.set(k, { label, rows: [] })
      buckets.get(k)!.rows.push(r)
    }

    const sortedKeys = Array.from(buckets.keys()).sort((a, b) => {
      if (a === 'no-date') return 1
      if (b === 'no-date') return -1
      return a.localeCompare(b)
    })

    return sortedKeys.map((k, i) => ({
      id:    k,
      label: buckets.get(k)!.label,
      color: k === 'no-date' ? 'bg-slate-500' : GROUP_COLORS[i % GROUP_COLORS.length],
      rows:  buckets.get(k)!.rows.map(r => ({
        id:   r.id,
        data: r as unknown as Record<string, unknown>,
      })),
    }))
  }, [rows])

  const TXT_PRIMARY   = 'text-slate-900 dark:text-slate-50'
  const TXT_MUTED     = 'text-slate-500 dark:text-slate-400'
  const TXT_TERTIARY  = 'text-slate-600 dark:text-slate-300'
  const BORDER        = 'border-slate-200 dark:border-slate-700'
  const CARD_BG       = 'bg-white dark:bg-slate-900'

  return (
    <div className="p-6">
      <div className="mx-auto max-w-[1600px] space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 shadow-md shadow-emerald-600/30">
            <Factory size={20} className="text-white" />
          </div>
          <div>
            <h1 className={`text-xl font-bold ${TXT_PRIMARY}`}>PCT (생산관리)</h1>
            <p className={`text-xs ${TXT_MUTED}`}>
              구글 스프레드시트에서 생산 배치를 가져와 편집합니다. 변경사항은 다음 단계에서 Supabase에 동기화됩니다.
            </p>
          </div>
        </div>

        {/* 시트 ID + 컨트롤 */}
        <Card className={`${BORDER} ${CARD_BG}`}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 text-base ${TXT_PRIMARY}`}>
              <FileSpreadsheet size={16} className="text-emerald-600 dark:text-emerald-400" />
              구글 시트 연동
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-1 min-w-[280px] flex-col gap-1.5">
                <label className={`text-xs font-medium ${TXT_TERTIARY}`}>구글 시트 ID</label>
                <input
                  type="text"
                  value={fileId}
                  onChange={e => setFileId(e.target.value)}
                  disabled={loading}
                  className={`h-9 rounded-lg border ${BORDER} bg-white dark:bg-slate-800 px-3 text-xs font-mono outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:focus:ring-emerald-900/40 ${TXT_PRIMARY} disabled:opacity-60`}
                  placeholder="시트 URL의 /d/ 다음 ID"
                />
              </div>
              <Button
                onClick={loadSheet}
                disabled={loading || !fileId.trim()}
                className="h-9 gap-1.5 bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {loading ? '불러오는 중...' : rows.length ? '시트에서 다시 불러오기' : '시트 불러오기'}
              </Button>
            </div>
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-3">
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
                <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 데이터 로드 후 영역 */}
        {rows.length > 0 && (
          <>
            {/* 요약 + 액션 바 */}
            <Card className={`${BORDER} ${CARD_BG}`}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className={`font-medium ${TXT_TERTIARY}`}>
                    총 <span className={`font-bold text-base ${TXT_PRIMARY}`}>{stats.total}</span>건
                  </span>
                  {stats.added > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
                      <Plus size={10} /> 추가 {stats.added}
                    </span>
                  )}
                  {stats.modified > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
                      ✎ 수정 {stats.modified}
                    </span>
                  )}
                  {stats.changes === 0 && (
                    <span className={TXT_MUTED}>변경사항 없음</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* 자동 배정 — 비고 '긴급' 우선 + 부하 분산 */}
                  <Button
                    onClick={handleAutoAssign}
                    disabled={rows.length === 0}
                    size="sm"
                    title={testers.length === 0
                      ? '시험자 정보 없음 — 기본 명단 사용'
                      : `${testers.filter(t => t.isActive).length}명 시험자 풀에서 부하 최소로 자동 분배`}
                    className="gap-1.5 bg-emerald-600 px-3 text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <Sparkles size={13} />
                    자동 배정
                  </Button>
                  <Button
                    onClick={clearAllAssignments}
                    variant="outline"
                    size="sm"
                    disabled={rows.every(r => !r.담당자)}
                    className="gap-1.5"
                  >
                    <UserMinus size={13} />
                    담당자 일괄 초기화
                  </Button>
                  <span className="mx-1 hidden h-5 w-px bg-slate-200 dark:bg-slate-700 sm:block" />
                  <Button
                    onClick={addRow}
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                  >
                    <Plus size={13} />
                    행 추가
                  </Button>
                  <Button
                    onClick={resetChanges}
                    variant="outline"
                    size="sm"
                    disabled={stats.changes === 0}
                    className="gap-1.5"
                  >
                    <RotateCcw size={13} />
                    원본으로 되돌리기
                  </Button>
                  {/* 스케줄 생성 — 자동 배정 후 월간 스케줄로 전달 */}
                  <Button
                    onClick={handleGenerateSchedule}
                    disabled={rows.every(r => !r.담당자)}
                    size="sm"
                    title="담당자 배정된 행을 월간 스케줄로 전송"
                    className="gap-1.5 bg-blue-600 px-4 text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    <CalendarPlus size={13} />
                    스케줄 생성
                  </Button>
                  <Button
                    onClick={() => alert('Supabase 영속화는 다음 단계에서 활성화됩니다.\n현재 변경사항: ' + stats.changes + '건')}
                    disabled={stats.changes === 0}
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    title="Supabase 동기화 — 다음 단계에서 활성화"
                  >
                    <Database size={13} />
                    DB 동기화
                    <span className="ml-1 rounded-full bg-slate-300 dark:bg-slate-700 px-1.5 py-0.5 text-[9px] font-bold text-slate-700 dark:text-slate-200">준비중</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 자동 배정 결과 알림 */}
            {autoStats && (
              <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30">
                <CardContent className="flex flex-wrap items-center gap-4 py-3 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white">
                      <Sparkles size={14} />
                    </div>
                    <span className={`font-semibold ${TXT_PRIMARY}`}>자동 배정 완료</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={TXT_TERTIARY}>
                      배정: <b className={`text-base ${TXT_PRIMARY}`}>{autoStats.assignedCount}</b>건
                    </span>
                    {autoStats.urgentCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-100 dark:border-red-800 dark:bg-red-900/50 px-2 py-0.5 font-semibold text-red-700 dark:text-red-300">
                        <AlertTriangle size={10} /> 긴급 우선 처리 {autoStats.urgentCount}건
                      </span>
                    )}
                    <span className={TXT_TERTIARY}>
                      참여 시험자: <b className={`text-base ${TXT_PRIMARY}`}>{autoStats.testersUsed}</b>명
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 스케줄 생성 결과 알림 */}
            {scheduleStats && (
              <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white">
                        <CheckCircle2 size={14} />
                      </div>
                      <span className={`font-semibold ${TXT_PRIMARY}`}>월간 스케줄 생성됨</span>
                    </div>
                    <span className={TXT_TERTIARY}>
                      전송: <b className={`text-base ${TXT_PRIMARY}`}>{scheduleStats.saved}</b>건
                    </span>
                    {scheduleStats.skipped > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 dark:border-amber-800 dark:bg-amber-900/50 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-300">
                        담당자 미지정 {scheduleStats.skipped}건 제외
                      </span>
                    )}
                    <span className={`text-[10px] ${TXT_MUTED}`}>
                      {new Date(scheduleStats.generatedAt).toLocaleString('ko-KR')}
                    </span>
                  </div>
                  <a
                    href="/schedule/monthly"
                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700 transition-colors"
                  >
                    월간 스케줄 보기 →
                  </a>
                </CardContent>
              </Card>
            )}

            {/* 보드 */}
            <Card className={`${BORDER} ${CARD_BG}`}>
              <CardContent className="p-3 sm:p-4">
                <MondayBoard
                  groups={groups}
                  columns={columns}
                  onCellChange={onCellChange}
                  emptyMessage="표시할 행이 없습니다."
                />
              </CardContent>
            </Card>

            <Card className={`${BORDER} bg-slate-50 dark:bg-slate-800/40`}>
              <CardContent className="space-y-1.5 py-3 text-[11px] leading-relaxed">
                <p className={`font-semibold uppercase tracking-wide ${TXT_MUTED}`}>안내</p>
                <ul className={`list-inside list-disc space-y-0.5 ${TXT_TERTIARY}`}>
                  <li>셀을 클릭하면 편집할 수 있습니다. 변경사항은 새로고침 시 초기화됩니다 (DB 영속화는 다음 단계에서 활성화).</li>
                  <li>포장일이 비어있거나 형식이 맞지 않으면 "기간 미정" 그룹으로 분류됩니다.</li>
                  <li><b className="text-blue-600 dark:text-blue-300">전항목</b>: 해당 품목의 모든 시험항목을 한 시험자(또는 듀오 조)에게 배정합니다.</li>
                  <li><b className="text-violet-600 dark:text-violet-300">개별항목</b>: 시험항목을 여러 시험자에게 나눠 동시에 진행합니다.</li>
                  <li><b className="text-emerald-600 dark:text-emerald-300">자동 배정</b>: 시험자관리에 등록된 시험자 + 역량 기준으로 부하 최소 분배. 비고 또는 긴급 컬럼에 "긴급" 단어가 있으면 최우선 처리.</li>
                  <li><b className="text-slate-700 dark:text-slate-200">수동 배정</b>: 각 행의 담당자 셀을 클릭해 드롭다운에서 직접 선택할 수 있습니다.</li>
                </ul>
              </CardContent>
            </Card>
          </>
        )}

        {/* 데이터 없을 때 안내 */}
        {!loading && rows.length === 0 && !error && (
          <Card className={`${BORDER} ${CARD_BG}`}>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-12">
              <FileSpreadsheet size={32} className="text-slate-300 dark:text-slate-600" />
              <p className={`text-sm ${TXT_MUTED}`}>위에서 "시트 불러오기"를 눌러 데이터를 가져오세요.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
