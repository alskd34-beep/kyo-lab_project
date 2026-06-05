'use client'

/**
 * PCT (생산관리) — 구글 시트 연동 보드
 *
 * - 구글 시트에서 생산 배치 정보를 가져와 먼데이.com 스타일 보드로 표시
 * - 셀 편집 가능 (클라이언트 상태로만 유지, 새로고침 시 초기화)
 * - 변경사항 카운팅 + "DB로 보내기" 버튼 자리 (Supabase 동기화는 다음 단계에서 활성화)
 */

import { useState, useMemo, useCallback } from 'react'
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
} from 'lucide-react'
import MondayBoard, { type BoardGroup, type ColumnDef } from '@frontend/components/board/MondayBoard'

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

function rowsFromSheet(resp: SheetResponse): PctRow[] {
  // 운영 메모 등 데이터가 아닌 행 제거: 품목코드/품목명 모두 비어있으면 무시
  const filtered = resp.rows.filter(r => pick(r, SHEET_KEY_CODE) && pick(r, SHEET_KEY_NAME))

  return filtered.map((r, idx) => {
    const urgentRaw = pick(r, SHEET_KEY_URGENT)
    const urgent    = urgentRaw === '긴급' ? '긴급' : '일반'

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
      비고:               pick(r, SHEET_KEY_NOTE),
      _origin:           'sheet',
      _dirty:            false,
    }
  })
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PctPage() {
  const [fileId, setFileId]   = useState(DEFAULT_FILE_ID)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [rows, setRows]       = useState<PctRow[]>([])
  const [originalRows, setOriginalRows] = useState<PctRow[]>([])

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
  }, [originalRows])

  const stats = useMemo(() => {
    const added    = rows.filter(r => r._origin === 'added').length
    const modified = rows.filter(r => r._origin === 'sheet' && r._dirty).length
    return { total: rows.length, added, modified, changes: added + modified }
  }, [rows])

  // 보드 컬럼 정의 — 너비 최적화로 가로 폭 절약 (총 ~1180px → 가로 스크롤 최소)
  const columns: ColumnDef[] = [
    { key: '품목명',         label: '품목명',         kind: 'text',   width: 180, editable: true },
    { key: '품목코드',       label: '코드',           kind: 'mono',   width: 70,  editable: true },
    { key: '제조번호',       label: '제조번호',       kind: 'mono',   width: 80,  editable: true },
    { key: '제형',           label: '제형',           kind: 'text',   width: 80,  editable: true },
    { key: '포장일',         label: '포장일',         kind: 'date',   width: 100, editable: true },
    { key: '시험완료요청일', label: '완료요청일',     kind: 'date',   width: 110, editable: true },
    { key: '긴급',           label: '긴급',           kind: 'chip',   width: 70,  editable: true,
      options: URGENT_OPTIONS,
      chipColor: { '일반': 'slate', '긴급': 'red' } },
    { key: '진행방법',       label: '진행방법',       kind: 'chip',   width: 95,  editable: true,
      options: METHOD_OPTIONS,
      chipColor: { '전항목': 'blue', '개별항목': 'violet' } },
    { key: '상태',           label: '상태',           kind: 'chip',   width: 85,  editable: true,
      options: STATUS_OPTIONS,
      chipColor: { '대기': 'slate', '진행중': 'blue', '검토중': 'violet', '완료': 'emerald', '지연': 'red' } },
    { key: '담당자',         label: '담당자',         kind: 'person', width: 110, editable: true,
      options: PERSON_OPTIONS },
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
                  <Button
                    onClick={() => alert('이 기능은 다음 단계에서 활성화됩니다.\n현재 변경사항: ' + stats.changes + '건')}
                    disabled={stats.changes === 0}
                    size="sm"
                    className="gap-1.5 bg-violet-600 px-4 text-white hover:bg-violet-700 disabled:opacity-60"
                    title="Supabase 동기화 — 다음 단계에서 활성화"
                  >
                    <Database size={13} />
                    Supabase로 보내기
                    <span className="ml-1 rounded-full bg-violet-900/40 px-1.5 py-0.5 text-[9px] font-bold">준비중</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

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
                  <li>긴급으로 표시된 행은 AI 스케줄러가 우선 배정합니다.</li>
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
