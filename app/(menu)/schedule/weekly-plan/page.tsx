'use client'

/**
 * 주간 계획 (자동 작성)
 *
 * 워크플로우:
 *  1. PCT 시트에서 해당 주간의 처리 대상 품목 추출
 *  2. 시험자 역량 + Solo/Duo + 부하 분산으로 자동 배정
 *  3. 안정성 시트의 동일 품목코드 → "안정성 동시분석 가능" 마크
 *  4. 품목별 특이사항을 카드에 표시
 *
 * 결과는 시험자별 그룹(먼데이 스타일)으로 표시.
 */

import { useState, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@frontend/components/ui/card'
import { Button } from '@frontend/components/ui/button'
import {
  CalendarRange,
  Sparkles,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Users,
  CheckCircle2,
  RefreshCw,
  FlaskConical,
  Beaker,
  Info,
} from 'lucide-react'
import {
  planWeekly,
  type PctItem,
  type TestItemRow,
  type CapabilityRow,
  type SoloDuoRow,
  type SpecialNoteRow,
  type StabilityRow,
  type PlanResult,
  type Assignment,
} from '@frontend/lib/weekly-planner'

// ─── 시트 ID 기본값 (입력 가능) ────────────────────────────────────────────────
const DEFAULT_PCT_ID       = '1H9_lR-_tpEHKSpVD2qLbxX5cqXRG_s5rpbGs-gqSPxU'
const DEFAULT_MASTER_ID    = '1nojHDR7rWPnT0QiW4hk9vW7BSBY-PjXz550VC3RsxsA'
const DEFAULT_STABILITY_ID = '1gvAtB1ETkCol1gM2mmppOUJTgIidEq1IdGaQaiSXdCg'

// ─── Utils ────────────────────────────────────────────────────────────────────
function getDefaultWeek() {
  const today = new Date()
  const day = today.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(today)
  monday.setDate(today.getDate() + diffToMonday)
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(monday), end: fmt(friday) }
}

// ─── 시트 컬럼명 fallback 체인 ─────────────────────────────────────────────────
// 시트가 시간이 흐르며 컬럼명이 변경될 수 있으므로 여러 후보를 순회한다.
function pickField(r: Record<string, string>, candidates: string[]): string {
  for (const k of candidates) {
    const v = r[k]
    if (v != null && v.trim() !== '') return v.trim()
  }
  return ''
}

const KEY_CODE     = ['품목코드', '자재코드']
const KEY_NAME     = ['품목명',   '자재내역']
const KEY_BATCH    = ['제조번호']
const KEY_FORM     = ['제형']
const KEY_PACK     = ['포장일_예정일', '포장일/예정일', '포장일']
const KEY_DEADLINE = ['시험완료요청일', 'QC완료예정일', 'QC 완료예정일']
const KEY_URGENT   = ['긴급', '우선순위']

// ─── 시트 데이터 매핑 함수들 ────────────────────────────────────────────────────
function mapPct(rows: Record<string, string>[]): PctItem[] {
  return rows
    .filter(r => pickField(r, KEY_CODE) && pickField(r, KEY_NAME))
    .map(r => ({
      품목코드: pickField(r, KEY_CODE),
      품목명:   pickField(r, KEY_NAME),
      제조번호: pickField(r, KEY_BATCH),
      제형:     pickField(r, KEY_FORM),
      포장일:   pickField(r, KEY_PACK),
      시험완료요청일: pickField(r, KEY_DEADLINE),
      긴급:     pickField(r, KEY_URGENT) === '긴급',
      진행방법: '전항목',     // 기본 (PCT 페이지에서 수정한 값을 받아오는 단계는 다음에)
      담당자:   '',
    }))
}

function mapStability(rows: Record<string, string>[]): StabilityRow[] {
  return rows.map(r => ({
    품목코드:   r['안정성시험 계획 정보/품목코드'] || '',
    품목명:     r['안정성시험 계획 정보/품목'] || '',
    시험종류:   r['안정성시험 계획 정보/시험종류'] || '',
    제조번호:   r['안정성시험 계획 정보/제조번호'] || '',
    진행상태:   r['안정성시험 계획 정보/진행상태'] || '',
    시험기간시작일: r['진행정보/시험기간시작일'] || '',
    시험기간종료일: r['진행정보/시험기간종료일'] || '',
    비고:       r['상세정보/비고'] || '',
  }))
}

// ─── 공통 톤 ──────────────────────────────────────────────────────────────────
const TXT_PRIMARY   = 'text-slate-900 dark:text-slate-50'
const TXT_SECONDARY = 'text-slate-700 dark:text-slate-200'
const TXT_TERTIARY  = 'text-slate-600 dark:text-slate-300'
const TXT_MUTED     = 'text-slate-500 dark:text-slate-400'
const BORDER        = 'border-slate-200 dark:border-slate-700'
const CARD_BG       = 'bg-white dark:bg-slate-900'

// 그룹별 컬러 (시험자 헤더용)
const COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-fuchsia-500', 'bg-sky-500']

// ─── Component ────────────────────────────────────────────────────────────────
export default function WeeklyPlanPage() {
  const defaults = getDefaultWeek()
  const [weekStart, setWeekStart] = useState(defaults.start)
  const [weekEnd,   setWeekEnd]   = useState(defaults.end)
  const [pctId,        setPctId]        = useState(DEFAULT_PCT_ID)
  const [masterId,     setMasterId]     = useState(DEFAULT_MASTER_ID)
  const [stabilityId,  setStabilityId]  = useState(DEFAULT_STABILITY_ID)

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [result,  setResult]  = useState<PlanResult | null>(null)
  const [openCards, setOpenCards] = useState<Set<string>>(new Set())

  const generate = useCallback(async () => {
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      // 3개 시트 병렬 fetch
      const [pctRes, masterRes, stRes] = await Promise.all([
        fetch(`/api/google-sheet?fileId=${encodeURIComponent(pctId)}`,                { credentials: 'include' }),
        fetch(`/api/google-sheet/master?fileId=${encodeURIComponent(masterId)}`,       { credentials: 'include' }),
        fetch(`/api/google-sheet/stability?fileId=${encodeURIComponent(stabilityId)}`, { credentials: 'include' }),
      ])
      const [pctJson, masterJson, stJson] = await Promise.all([pctRes.json(), masterRes.json(), stRes.json()])
      if (!pctRes.ok)    throw new Error(`PCT: ${pctJson.error    ?? 'fetch 실패'}`)
      if (!masterRes.ok) throw new Error(`마스터: ${masterJson.error ?? 'fetch 실패'}`)
      if (!stRes.ok)     throw new Error(`안정성: ${stJson.error  ?? 'fetch 실패'}`)

      const pctItems    = mapPct(pctJson.rows || [])
      const testItems:    TestItemRow[]    = masterJson.test_items   || []
      const capabilities: CapabilityRow[]  = masterJson.capabilities || []
      const soloDuo:      SoloDuoRow[]     = masterJson.solo_duo     || []
      const specialNotes: SpecialNoteRow[] = masterJson.special_notes|| []
      const stability                     = mapStability(stJson.rows || [])

      const plan = planWeekly({
        pctItems, testItems, capabilities, soloDuo, specialNotes, stability,
        weekStart, weekEnd,
      })
      setResult(plan)
    } catch (e) {
      setError(e instanceof Error ? e.message : '알 수 없는 오류')
    } finally {
      setLoading(false)
    }
  }, [pctId, masterId, stabilityId, weekStart, weekEnd])

  // 시험자별 그룹화
  const groupedByTester = useMemo(() => {
    if (!result) return []
    const map = new Map<string, { name: string; items: Assignment[]; load: number }>()
    for (const a of result.assignments) {
      if (!map.has(a.testerName)) map.set(a.testerName, { name: a.testerName, items: [], load: 0 })
      const g = map.get(a.testerName)!
      g.items.push(a)
      g.load += a.workdays
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [result])

  const toggleCard = (key: string) =>
    setOpenCards(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  return (
    <div className="p-6">
      <div className="mx-auto max-w-[1800px] space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-md shadow-blue-600/30">
            <CalendarRange size={20} className="text-white" />
          </div>
          <div>
            <h1 className={`text-xl font-bold ${TXT_PRIMARY}`}>주간 계획 (자동)</h1>
            <p className={`text-xs ${TXT_MUTED}`}>
              PCT + 시험자 역량 + 안정성 시트를 통합하여 주간 시험 배정을 자동 작성합니다.
            </p>
          </div>
        </div>

        {/* 입력 폼 */}
        <Card className={`${BORDER} ${CARD_BG}`}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 text-base ${TXT_PRIMARY}`}>
              <Sparkles size={16} className="text-blue-600 dark:text-blue-400" />
              계획 생성 설정
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${TXT_TERTIARY}`}>주간 시작일</label>
                <input
                  type="date"
                  value={weekStart}
                  onChange={e => setWeekStart(e.target.value)}
                  disabled={loading}
                  className={`h-9 rounded-lg border ${BORDER} bg-white dark:bg-slate-800 px-3 text-sm tabular-nums outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 ${TXT_PRIMARY} [color-scheme:light] dark:[color-scheme:dark]`}
                />
              </div>
              <div className={`flex h-9 items-end pb-2 ${TXT_MUTED}`}>~</div>
              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${TXT_TERTIARY}`}>주간 종료일</label>
                <input
                  type="date"
                  value={weekEnd}
                  onChange={e => setWeekEnd(e.target.value)}
                  disabled={loading}
                  className={`h-9 rounded-lg border ${BORDER} bg-white dark:bg-slate-800 px-3 text-sm tabular-nums outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 ${TXT_PRIMARY} [color-scheme:light] dark:[color-scheme:dark]`}
                />
              </div>
              <Button
                onClick={generate}
                disabled={loading}
                className="h-9 gap-1.5 bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {loading ? '생성 중...' : '주간 계획 생성'}
              </Button>
            </div>

            <details className="text-xs">
              <summary className={`cursor-pointer ${TXT_MUTED} hover:${TXT_TERTIARY}`}>시트 ID 변경 (고급)</summary>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label className={`block text-[10px] font-medium ${TXT_MUTED} mb-1`}>PCT 시트 ID</label>
                  <input value={pctId} onChange={e => setPctId(e.target.value)}
                    className={`w-full h-8 rounded border ${BORDER} bg-white dark:bg-slate-800 px-2 font-mono text-[10px] ${TXT_PRIMARY}`} />
                </div>
                <div>
                  <label className={`block text-[10px] font-medium ${TXT_MUTED} mb-1`}>마스터 시트 ID</label>
                  <input value={masterId} onChange={e => setMasterId(e.target.value)}
                    className={`w-full h-8 rounded border ${BORDER} bg-white dark:bg-slate-800 px-2 font-mono text-[10px] ${TXT_PRIMARY}`} />
                </div>
                <div>
                  <label className={`block text-[10px] font-medium ${TXT_MUTED} mb-1`}>안정성 시트 ID</label>
                  <input value={stabilityId} onChange={e => setStabilityId(e.target.value)}
                    className={`w-full h-8 rounded border ${BORDER} bg-white dark:bg-slate-800 px-2 font-mono text-[10px] ${TXT_PRIMARY}`} />
                </div>
              </div>
            </details>
          </CardContent>
        </Card>

        {/* 에러 */}
        {error && (
          <Card className="border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
            <CardContent className="flex items-start gap-2 py-3">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* 로딩 */}
        {loading && (
          <Card className={`${BORDER} ${CARD_BG}`}>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-12">
              <Loader2 size={28} className="animate-spin text-blue-500" />
              <p className={`text-sm font-medium ${TXT_SECONDARY}`}>PCT · 마스터 · 안정성 시트를 분석하여 자동 배정 중...</p>
            </CardContent>
          </Card>
        )}

        {/* 결과 */}
        {result && !loading && (
          <>
            {/* 요약 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40">
                <CardContent className="flex items-center gap-3 py-4">
                  <CheckCircle2 size={22} className="text-blue-600 dark:text-blue-400" />
                  <div>
                    <p className={`text-[11px] font-medium ${TXT_MUTED}`}>대상 품목</p>
                    <p className={`text-xl font-bold tabular-nums ${TXT_PRIMARY}`}>{result.stats.total}건</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40">
                <CardContent className="flex items-center gap-3 py-4">
                  <Users size={22} className="text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <p className={`text-[11px] font-medium ${TXT_MUTED}`}>배정 완료</p>
                    <p className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{result.stats.assigned}건</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
                <CardContent className="flex items-center gap-3 py-4">
                  <AlertTriangle size={22} className="text-red-600 dark:text-red-400" />
                  <div>
                    <p className={`text-[11px] font-medium ${TXT_MUTED}`}>긴급</p>
                    <p className="text-xl font-bold tabular-nums text-red-700 dark:text-red-300">{result.stats.urgent}건</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40">
                <CardContent className="flex items-center gap-3 py-4">
                  <FlaskConical size={22} className="text-violet-600 dark:text-violet-400" />
                  <div>
                    <p className={`text-[11px] font-medium ${TXT_MUTED}`}>안정성 동시</p>
                    <p className="text-xl font-bold tabular-nums text-violet-700 dark:text-violet-300">{result.stats.stabilityLinked}건</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
                <CardContent className="flex items-center gap-3 py-4">
                  <Users size={22} className="text-amber-600 dark:text-amber-400" />
                  <div>
                    <p className={`text-[11px] font-medium ${TXT_MUTED}`}>활동 시험자</p>
                    <p className="text-xl font-bold tabular-nums text-amber-700 dark:text-amber-300">{result.stats.testersUsed}명</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 시험자별 그룹 보드 */}
            <Card className={`${BORDER} ${CARD_BG}`}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className={`flex items-center gap-2 text-base ${TXT_PRIMARY}`}>
                  <Users size={16} className="text-emerald-600 dark:text-emerald-400" />
                  시험자별 주간 계획
                  <span className={`text-xs font-normal ${TXT_MUTED}`}>({groupedByTester.length}명 · {result.stats.assigned}건)</span>
                </CardTitle>
                <Button variant="outline" size="sm" onClick={generate} className="gap-1.5">
                  <RefreshCw size={12} />
                  다시 생성
                </Button>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {groupedByTester.length === 0 ? (
                  <p className={`px-6 py-10 text-center text-sm ${TXT_MUTED}`}>
                    해당 주간에 배정된 품목이 없습니다.
                  </p>
                ) : (
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {groupedByTester.map((g, gi) => {
                      const color = COLORS[gi % COLORS.length]
                      return (
                        <div
                          key={g.name}
                          className={`flex w-72 shrink-0 flex-col gap-2 rounded-xl border ${BORDER} bg-slate-50 dark:bg-slate-800/40 p-3`}
                        >
                          {/* 컬럼 헤더 */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`flex h-7 w-7 items-center justify-center rounded-full ${color} text-[11px] font-bold text-white`}>
                                {g.name.slice(0, 1)}
                              </div>
                              <div>
                                <p className={`text-sm font-semibold ${TXT_PRIMARY}`}>{g.name}</p>
                                <p className={`text-[10px] ${TXT_MUTED}`}>{g.items.length}건 · {g.load}일</p>
                              </div>
                            </div>
                          </div>

                          {/* 카드 리스트 */}
                          <div className="flex flex-col gap-2">
                            {g.items.map(a => {
                              const open = openCards.has(a.key)
                              const borderCls = a.isUrgent
                                ? 'border-red-300 dark:border-red-800'
                                : a.isStabilityLinked
                                  ? 'border-violet-300 dark:border-violet-800'
                                  : BORDER
                              const bgCls = a.isUrgent
                                ? 'bg-red-50/70 dark:bg-red-950/20'
                                : a.isStabilityLinked
                                  ? 'bg-violet-50/70 dark:bg-violet-950/20'
                                  : CARD_BG
                              return (
                                <div key={a.key} className={`rounded-lg border ${borderCls} ${bgCls} p-2.5 transition-colors`}>
                                  {/* 헤더: 품목명 */}
                                  <div className="mb-1.5 flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <p className={`truncate text-sm font-semibold ${TXT_PRIMARY}`}>
                                        {a.productName}
                                      </p>
                                      <p className={`font-mono text-[10px] ${TXT_MUTED}`}>
                                        {a.productCode} · {a.batchNo} · {a.date} · {a.workdays}일
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                      {a.isUrgent && (
                                        <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-300">
                                          <AlertTriangle size={9} /> 긴급
                                        </span>
                                      )}
                                      {a.isStabilityLinked && (
                                        <span className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700 dark:border-violet-800 dark:bg-violet-900/50 dark:text-violet-300">
                                          <FlaskConical size={9} /> 안정성
                                        </span>
                                      )}
                                      <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
                                        a.method === '전항목'
                                          ? 'border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
                                          : 'border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-800 dark:bg-violet-900/50 dark:text-violet-300'
                                      }`}>
                                        {a.method}
                                      </span>
                                    </div>
                                  </div>

                                  {/* 시험항목 (상위 3개 표시 + 토글로 전체) */}
                                  <div className="space-y-0.5">
                                    {(open ? a.testItems : a.testItems.slice(0, 3)).map((t, ti) => (
                                      <div key={ti} className="flex items-start gap-1.5 text-[11px]">
                                        <Beaker size={9} className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500" />
                                        <span className={TXT_TERTIARY}>{t}</span>
                                      </div>
                                    ))}
                                    {a.testItems.length > 3 && (
                                      <button
                                        onClick={() => toggleCard(a.key)}
                                        className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                                      >
                                        {open ? '접기' : `+${a.testItems.length - 3}개 더 보기`}
                                      </button>
                                    )}
                                  </div>

                                  {/* 안정성 정보 */}
                                  {a.stabilityInfo && (
                                    <div className="mt-2 rounded-md border border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40 p-1.5 text-[10px]">
                                      <span className="font-semibold text-violet-700 dark:text-violet-300">동시분석: </span>
                                      <span className="text-violet-600 dark:text-violet-400">{a.stabilityInfo}</span>
                                    </div>
                                  )}

                                  {/* 특이사항 */}
                                  {a.specialNotes.length > 0 && (
                                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-1.5">
                                      <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                        <Info size={9} /> 시험 전 주의
                                      </div>
                                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                                        {a.specialNotes.slice(0, 3).map((n, i) => <li key={i}>{n}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 미배정 */}
            {result.unassigned.length > 0 && (
              <Card className="border-amber-300 dark:border-amber-900 bg-white dark:bg-slate-900">
                <CardHeader>
                  <CardTitle className={`flex items-center gap-2 text-base ${TXT_PRIMARY}`}>
                    <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
                    배정 불가 항목 <span className={`text-xs font-normal ${TXT_MUTED}`}>({result.unassigned.length}건)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-amber-100 dark:border-amber-900 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <th className="px-3 py-2 text-left">품목명</th>
                        <th className="px-3 py-2 text-left">코드</th>
                        <th className="px-3 py-2 text-left">제조번호</th>
                        <th className="px-3 py-2 text-left">사유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.unassigned.map((u, i) => (
                        <tr key={i} className="border-b border-amber-50 dark:border-amber-950">
                          <td className={`px-3 py-2 font-semibold ${TXT_PRIMARY}`}>{u.productName}</td>
                          <td className={`px-3 py-2 font-mono text-xs ${TXT_TERTIARY}`}>{u.productCode}</td>
                          <td className={`px-3 py-2 font-mono text-xs ${TXT_TERTIARY}`}>{u.batchNo}</td>
                          <td className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{u.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {/* 안내 */}
            <Card className={`${BORDER} bg-slate-50 dark:bg-slate-800/40`}>
              <CardContent className="space-y-1.5 py-3 text-[11px] leading-relaxed">
                <p className={`font-semibold uppercase tracking-wide ${TXT_MUTED}`}>작성 규칙</p>
                <ol className={`list-inside list-decimal space-y-0.5 ${TXT_TERTIARY}`}>
                  <li>PCT에서 해당 주간 포장일 품목을 추출 → 긴급 우선, 마감일 빠른 것 우선 정렬</li>
                  <li>시험항목별 필요 장비를 추정하고, <b>시험자 역량 시트</b>의 Y/O만 가능한 자격자로 필터링</li>
                  <li>부하 최소 시험자에게 우선 배정 (Solo 시험자만 단독 배정 가능)</li>
                  <li>진행방법 <b>전항목</b>: 한 시험자에게 일괄 / <b>개별항목</b>: 시험항목별 분배</li>
                  <li>동일 품목코드가 <b className="text-violet-600 dark:text-violet-300">안정성 시트</b>에 있으면 "안정성 동시" 마크 + 정보 표시</li>
                  <li>품목별 <b className="text-amber-600 dark:text-amber-300">특이사항</b>은 카드에 자동 부착</li>
                </ol>
                <p className={`${TXT_MUTED} pt-2`}>
                  * 이 페이지는 PCT 시트의 진행방법/담당자가 모두 "전항목/미지정"인 상태로 동작합니다. PCT에서 저장한 값을 반영하려면 Phase A (DB 영속화)가 필요합니다.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
