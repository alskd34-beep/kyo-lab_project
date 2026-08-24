"use client"

/**
 * [공용] 담당자 상세 — 전체화면 팝업
 *
 * 담당자(시험자)를 클릭하면 그 담당자가 맡은 QC 과제를 동시분석 계열별로 묶어
 * 보여주고, 우측에 담당자 요약(공수·과제·일정)을 표시한다.
 *
 * 재사용: 어느 화면에서든 `<AssigneeDetailModal testerId=.. testerName=.. onClose=.. />`
 * 로 열 수 있다(데이터는 컴포넌트가 직접 조회).
 */

import { useEffect, useMemo, useState } from "react"
import {
  X, RefreshCw, SlidersHorizontal, Layers, Calendar,
  ChevronDown, ChevronRight, ExternalLink, ArrowLeftRight, Loader2,
} from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@frontend/components/ui/select'
import { JOB_STAGES, OPEN_STATUSES, stageStyle } from "@shared/qc-status"
import { cn } from "@frontend/lib/utils"
import { TesterAvatar } from "@frontend/lib/tester-profiles"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@frontend/components/ui/dialog"

// ─── Types ────────────────────────────────────────────────────────────────────
interface OrderRow {
  id: string
  productCode: string
  productName: string
  batchNo: string
  dosageForm: string | null
  packagingDate: string | null
  dueDate: string | null
  isUrgent: boolean
  method: string
  status: string
  assigneeTesterId: string | null
  assigneeName: string | null
  workdays: number | null
  locked: boolean
}
interface Family { id: string; name: string; codes: string[] }

interface Props {
  testerId: string
  testerName: string
  onClose: () => void
  /** 선택: 푸터 "상세보기"·"배정 변경" 동작 (없으면 버튼 숨김 처리 없이 비활성) */
  onOpenDetail?: () => void
  onReassign?: () => void
  /** 우측 부제(팀·직급). 데이터가 없으면 기본값 사용 */
  subtitle?: string
}

// ─── 상수/유틸 ─────────────────────────────────────────────────────────────────
const statusDot = (s: string) => stageStyle(s).dot
const STATUS_OPTIONS = ["대기", ...JOB_STAGES, "지연"]
/* 인접한 그룹을 눈으로 가르는 용도. 뜻이 있는 색이 아니라 순환일 뿐이라
   무지개를 돌지 않고 브랜드 파랑의 농도만 바꾼다. */
const GROUP_ACCENTS = [
  "bg-blue-600", "bg-blue-500", "bg-blue-400", "bg-blue-300",
]
const DAILY_CAPACITY = 8 // 하루 가용 공수(일) 기준 — 부하율 표시용

function isoToWeek(iso: string | null): { key: string; label: string } {
  if (!iso) return { key: "no-date", label: "기간 미정" }
  const d = new Date(iso + "T00:00:00Z")
  const dow = (d.getUTCDay() + 6) % 7
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - dow)
  return { key: monday.toISOString().slice(0, 10), label: `${monday.getUTCMonth() + 1}/${monday.getUTCDate()} 주` }
}
const todayStr = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`
}
const isActive = (s: string) => OPEN_STATUSES.has(s)
const sumWork = (rows: OrderRow[]) => rows.reduce((s, r) => s + (r.workdays ?? 0), 0)
const maxDue = (rows: OrderRow[]) => rows.map(r => r.dueDate).filter(Boolean).sort().slice(-1)[0] ?? null

// ─── Component ──────────────────────────────────────────────────────────────────
export function AssigneeDetailModal({ testerId, testerName, onClose, onOpenDetail, onReassign, subtitle }: Props) {
  const [allRows, setAllRows] = useState<OrderRow[]>([])
  const [families, setFamilies] = useState<Family[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const load = async () => {
    setLoading(true)
    try {
      const [oRes, fRes] = await Promise.all([
        fetch(`/api/pct-orders`, { credentials: "include" }),
        fetch(`/api/concurrent-product-families`, { credentials: "include" }).catch(() => null),
      ])
      const oData = await oRes.json()
      const fData = fRes ? await fRes.json().catch(() => ({ rows: [] })) : { rows: [] }
      setAllRows(oData.rows ?? [])
      setFamilies((fData.rows ?? []).map((f: { id: string; name: string; members: { productCode: string }[] }) =>
        ({ id: f.id, name: f.name, codes: f.members.map(m => m.productCode) })))
    } finally { setLoading(false) }
  }
  // testerId 가 바뀔 때마다 재조회 (load 는 매 렌더 새로 생성되므로 의존성에서 제외)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [testerId])

  const familyByCode = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    for (const f of families) for (const c of f.codes) m.set(c, { id: f.id, name: f.name })
    return m
  }, [families])

  // 이 담당자의 과제 (상태 필터 반영)
  const myRows = useMemo(() => {
    let rows = allRows.filter(r => r.assigneeTesterId === testerId)
    if (statusFilter) rows = rows.filter(r => r.status === statusFilter)
    return rows
  }, [allRows, testerId, statusFilter])

  // 동시분석 계열별 그룹 (계열 없으면 품목코드 단위)
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; isFamily: boolean; rows: OrderRow[] }>()
    for (const r of myRows) {
      const fam = familyByCode.get(r.productCode)
      const key = fam ? `fam:${fam.id}` : `code:${r.productCode}`
      const label = fam ? `${fam.name} 계열` : r.productName
      if (!m.has(key)) m.set(key, { key, label, isFamily: !!fam, rows: [] })
      m.get(key)!.rows.push(r)
    }
    return Array.from(m.values()).sort((a, b) => b.rows.length - a.rows.length)
  }, [myRows, familyByCode])

  const accentOf = useMemo(() => {
    const m = new Map<string, string>()
    groups.forEach((g, i) => m.set(g.key, GROUP_ACCENTS[i % GROUP_ACCENTS.length]))
    return m
  }, [groups])

  // 요약 통계
  const totalCount = myRows.length
  const urgentCount = myRows.filter(r => r.isUrgent).length
  const waitingCount = myRows.filter(r => r.status === "대기").length
  const repStatus = myRows.some(r => r.status === "진행중") ? "진행중" : "대기"

  // 오늘 부하(공수): 오늘이 포장~완료예정 사이인 활성 과제의 공수 합 (가용 8일 기준)
  const today = todayStr()
  const todayLoad = myRows
    .filter(r => isActive(r.status) && (r.packagingDate ?? "0") <= today && (r.dueDate ?? "9") >= today)
    .reduce((s, r) => s + (r.workdays ?? 0), 0)
  const loadPct = Math.min(100, Math.round((todayLoad / DAILY_CAPACITY) * 100))

  // 주간 요약 (포장주 기준 공수 합 → 7칸 히트맵)
  const weeks = useMemo(() => {
    const m = new Map<string, { key: string; label: string; work: number }>()
    for (const r of myRows) {
      if (!r.packagingDate) continue
      const w = isoToWeek(r.packagingDate)
      if (!m.has(w.key)) m.set(w.key, { key: w.key, label: w.label, work: 0 })
      m.get(w.key)!.work += r.workdays ?? 0
    }
    return Array.from(m.values()).sort((a, b) => a.key.localeCompare(b.key)).slice(0, 6)
  }, [myRows])

  // 최근 배정 과제 (포장일 최신순 6건)
  const recent = useMemo(
    () => [...myRows].sort((a, b) => (b.packagingDate ?? "").localeCompare(a.packagingDate ?? "")).slice(0, 6),
    [myRows],
  )

  const toggle = (k: string) => setCollapsed(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="full" className="gap-0 overflow-hidden p-0" showCloseButton={false}>
        <DialogTitle className="sr-only">{testerName} 배정 현황</DialogTitle>
        <DialogDescription className="sr-only">담당자가 맡은 QC 과제를 계열별로 확인합니다.</DialogDescription>
        <div className="flex h-full w-full flex-col overflow-hidden bg-muted/30 md:flex-row">
        {/* ── 좌측: 배정 현황 ─────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain p-4 md:p-5">
          {/* 헤더 */}
          <div className="flex flex-col gap-3 rounded-md border bg-card px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <TesterAvatar testerId={testerId} name={testerName} size="md" className="size-11 rounded-md text-2xl" />
              <div>
                <h2 className="text-lg font-semibold text-foreground">{testerName}</h2>
                <p className="text-xs font-medium text-muted-foreground">QC 과제 배정 현황</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatChip label="총 그룹" value={groups.length} />
              <StatChip label="총 과제" value={`${totalCount}건`} />
              <StatChip label="긴급" value={`${urgentCount}건`} tone="red" />
              <StatChip label="대기" value={`${waitingCount}건`} />
              <button onClick={() => void load()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground hover:bg-muted">
                {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}새로고침
              </button>
              <div className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground">
                <SlidersHorizontal className="size-4 shrink-0" />
                <Select value={statusFilter || 'all'} onValueChange={v => setStatusFilter(v === 'all' ? '' : v)}>
                  <SelectTrigger className="h-auto border-0 p-0 shadow-none focus:ring-0 text-sm font-medium text-foreground bg-transparent">
                    <SelectValue placeholder="필터" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* 그룹 목록 */}
          <div className="mt-4 flex flex-col gap-3">
            {loading ? (
              <div className="rounded-md border bg-card py-12 text-center text-sm text-muted-foreground shadow-sm">불러오는 중…</div>
            ) : groups.length === 0 ? (
              <div className="rounded-md border bg-card py-12 text-center text-sm text-muted-foreground shadow-sm">배정된 과제가 없습니다.</div>
            ) : groups.map(g => {
              const isCol = collapsed.has(g.key)
              return (
                <div key={g.key} className="overflow-hidden rounded-md border bg-card shadow-sm">
                  <button onClick={() => toggle(g.key)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
                    {isCol ? <ChevronRight className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                    <Layers className="size-4 text-blue-600 dark:text-blue-300" />
                    <span className="min-w-0 truncate text-sm font-semibold text-foreground">{g.label}</span>
                    {g.isFamily && (
                      /* 연한 칩 — 다크에서는 명도만 뒤집는다(배경 50->950, 글자 700->300) */
                      <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs leading-normal font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">동시분석 {g.rows.length}건</span>
                    )}
                    <div className="ml-auto hidden shrink-0 items-center gap-4 text-xs font-medium text-muted-foreground sm:flex">
                      <span>총 과제 <b className="text-foreground">{g.rows.length}건</b></span>
                      <span>총공수 <b className="text-foreground">{sumWork(g.rows)}일</b></span>
                      <span>완료예정 <b className="text-red-500">{maxDue(g.rows) ?? "-"}</b></span>
                    </div>
                  </button>
                  {!isCol && (
                    <>
                    {/* 모바일 — 10칸 표를 900px 가로 스크롤로 미는 대신 핵심 값만 세운다.
                        나머지 칸은 데스크톱 표에서 본다. */}
                    <ul className="divide-y border-t md:hidden">
                      {g.rows.map(r => (
                        <li key={r.id} className="px-4 py-3">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{r.productName}</p>
                            <span className={cn("shrink-0 text-xs leading-normal tabular-nums", r.dueDate ? "font-semibold text-red-500" : "text-muted-foreground")}>
                              {r.dueDate ?? "-"}
                            </span>
                          </div>
                          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-normal text-muted-foreground">
                            <StatusBadge status={r.status} />
                            {r.isUrgent && (
                              <span className="inline-flex shrink-0 items-center rounded-md bg-red-50 px-2 py-0.5 text-xs leading-normal font-semibold text-red-600 dark:bg-red-950 dark:text-red-300">
                                긴급
                              </span>
                            )}
                            <span className="min-w-0 truncate font-mono">{r.batchNo}</span>
                            <span className="shrink-0 tabular-nums">공수 {r.workdays != null ? `${r.workdays}일` : "-"}</span>
                          </div>
                        </li>
                      ))}
                    </ul>

                    <div className="hidden overflow-x-auto border-t md:block">
                      <table className="w-full min-w-[900px] text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50 text-left text-xs leading-normal font-semibold text-muted-foreground">
                            <th className="px-3 py-2">품목명</th><th className="px-3 py-2">품목코드</th><th className="px-3 py-2">제조번호</th>
                            <th className="px-3 py-2">제형</th><th className="px-3 py-2">포장일</th><th className="px-3 py-2">완료예정</th>
                            <th className="px-3 py-2">긴급</th><th className="px-3 py-2">진행방법</th><th className="px-3 py-2">공수</th>
                            <th className="px-3 py-2">상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map(r => (
                            <tr key={r.id} className="border-b last:border-0 text-foreground hover:bg-muted/40">
                              <td className="px-3 py-2.5 font-medium text-foreground">{r.productName}</td>
                              <td className="px-3 py-2.5 font-mono text-xs text-blue-600 dark:text-blue-300">{r.productCode}</td>
                              <td className="px-3 py-2.5 font-mono text-xs">{r.batchNo}</td>
                              <td className="px-3 py-2.5">{r.dosageForm ?? "-"}</td>
                              <td className="px-3 py-2.5">{r.packagingDate ?? "-"}</td>
                              <td className={cn("px-3 py-2.5", r.dueDate && "font-semibold text-red-500")}>{r.dueDate ?? "-"}</td>
                              <td className="px-3 py-2.5">
                                {r.isUrgent ? <span className="inline-flex items-center rounded-md bg-red-50 px-2 py-0.5 text-xs leading-normal font-semibold text-red-600 dark:bg-red-950 dark:text-red-300">긴급</span> : <span className="text-muted-foreground">-</span>}
                              </td>
                              <td className="px-3 py-2.5">{r.method}</td>
                              <td className="px-3 py-2.5">{r.workdays != null ? `${r.workdays}일` : "-"}</td>
                              <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── 우측: 담당자 상세 ────────────────────────────────────────────── */}
        <aside className="flex max-h-[42dvh] w-full shrink-0 flex-col border-t bg-card md:max-h-none md:w-[340px] md:border-t-0 md:border-l">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">담당자 상세</h3>
            <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            {/* 프로필 */}
            <div className="flex items-center gap-3">
              <TesterAvatar testerId={testerId} name={testerName} size="md" className="size-12 rounded-md text-2xl" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-foreground">{testerName}</p>
                <p className="truncate text-xs text-muted-foreground">{subtitle ?? "QC 시험팀"}</p>
              </div>
              <StatusBadge status={repStatus} />
            </div>

            {/* 공수/과제 카드 */}
            {/* 이 패널은 폭이 ~300px 로 고정이라 4칸은 칸당 68px 밖에 안 된다 — 2×2 로 둔다. */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-md border px-2.5 py-2">
                <p className="text-xs leading-normal font-semibold text-muted-foreground">오늘 공수</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{todayLoad}<span className="text-muted-foreground"> / {DAILY_CAPACITY}일</span></p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-md bg-muted">
                  <div className="h-full rounded-md bg-blue-600" style={{ width: `${loadPct}%` }} />
                </div>
                <p className="mt-1 text-xs leading-normal text-muted-foreground">{loadPct}%</p>
              </div>
              <MiniStat label="배정 과제" value={`${totalCount}건`} />
              <MiniStat label="긴급 과제" value={`${urgentCount}건`} tone="red" />
              <MiniStat label="대기 과제" value={`${waitingCount}건`} />
            </div>

            {/* 일정 요약 */}
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">일정 요약</p>
                <span className="inline-flex items-center gap-1 text-xs leading-normal text-muted-foreground"><Calendar className="size-3" />주간</span>
              </div>
              <div className="rounded-md border px-3 py-3">
                <div className="mb-1.5 grid grid-cols-[40px_repeat(7,1fr)] gap-1 text-center text-xs leading-normal text-muted-foreground">
                  <span />{["월", "화", "수", "목", "금", "토", "일"].map(d => <span key={d}>{d}</span>)}
                </div>
                {weeks.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">표시할 일정이 없습니다.</p>
                ) : weeks.map(w => {
                  const filled = Math.min(7, Math.round(w.work))
                  return (
                    <div key={w.key} className="mb-1 grid grid-cols-[40px_repeat(7,1fr)] items-center gap-1">
                      <span className="text-xs leading-normal font-medium text-muted-foreground">{w.label}</span>
                      {Array.from({ length: 7 }).map((_, i) => (
                        <span key={i} className={cn("h-3.5 rounded-md", i < filled ? "bg-blue-500" : "bg-muted")} />
                      ))}
                    </div>
                  )
                })}
                <div className="mt-2 flex items-center gap-3 text-xs leading-normal text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-md bg-blue-500" />배정 공수</span>
                  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-md bg-muted" />여유 공수</span>
                </div>
              </div>
            </div>

            {/* 최근 배정 과제 */}
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">최근 배정 과제</p>
                {onOpenDetail && <button onClick={onOpenDetail} className="text-xs leading-normal font-medium text-blue-600 hover:underline dark:text-blue-300">전체보기</button>}
              </div>
              <div className="flex flex-col gap-2">
                {recent.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">최근 배정 과제가 없습니다.</p>
                ) : recent.map(r => {
                  const fam = familyByCode.get(r.productCode)
                  const accent = accentOf.get(fam ? `fam:${fam.id}` : `code:${r.productCode}`) ?? "bg-muted-foreground/40"
                  return (
                    <div key={r.id} className="relative overflow-hidden rounded-md border bg-card px-3 py-2 pl-4">
                      <span className={cn("absolute inset-y-0 left-0 w-1", accent)} />
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-xs leading-normal font-semibold text-foreground">
                            <span className="truncate">{r.productName} (제조 {r.batchNo})</span>
                            {r.isUrgent && <span className="shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-xs leading-normal font-semibold text-red-600 dark:bg-red-950 dark:text-red-300">긴급</span>}
                          </p>
                          <p className="mt-0.5 text-xs leading-normal text-muted-foreground">완료예정 {r.dueDate ?? "-"} · 공수 {r.workdays ?? "-"}일</p>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* 푸터 */}
          <div className="flex items-center gap-2 border-t px-4 py-3">
            <button onClick={onOpenDetail} disabled={!onOpenDetail}
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-input bg-card text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-40">
              <ExternalLink className="size-4" />상세보기
            </button>
            <button onClick={onReassign} disabled={!onReassign}
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
              <ArrowLeftRight className="size-4" />배정 변경
            </button>
          </div>
        </aside>
      </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 소형 UI ────────────────────────────────────────────────────────────────────
function StatChip({ label, value, tone }: { label: string; value: string | number; tone?: "red" }) {
  return (
    <div className="rounded-md border px-3 py-1.5 text-center">
      <p className="text-xs leading-normal font-semibold text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold", tone === "red" ? "text-red-500" : "text-foreground")}>{value}</p>
    </div>
  )
}
function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "red" }) {
  return (
    <div className="rounded-md border px-2.5 py-2">
      <p className="text-xs leading-normal font-semibold text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold", tone === "red" ? "text-red-500" : "text-foreground")}>{value}</p>
    </div>
  )
}
function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs leading-normal font-semibold text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", statusDot(status))} />{status}
    </span>
  )
}
