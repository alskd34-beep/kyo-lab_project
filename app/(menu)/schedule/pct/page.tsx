"use client"

/**
 * PCT (생산관리) — 구글 시트 연동 보드
 *
 * - 구글 시트에서 생산 배치 정보를 자동으로 불러와 먼데이.com 스타일 보드로 표시
 * - 읽기 전용 표시를 기본으로 하고, 로딩 직후 자동 배정을 한 번 수행해 공수/담당자를 채운다
 * - 수정/추가/삭제는 이 화면에서 하지 않고, 원본 시트와 배정 엔진 결과만 확인한다
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { Card, CardContent } from "@frontend/components/ui/card"
import { Button } from "@frontend/components/ui/button"
import { cn } from "@frontend/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@frontend/components/ui/dialog"
import {
  Factory,
  FileSpreadsheet,
  Loader2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  ArrowRight,
  Download,
  Calendar,
} from "lucide-react"
import MondayBoard, {
  type BoardGroup,
  type ColumnDef,
} from "@frontend/components/board/MondayBoard"
import {
  savePctMonthlyFromEngine,
  loadPctMonthlySnapshot,
} from "@frontend/lib/pct-schedule-bridge"
import type { EngineResult } from "@backend/services/scheduleEngine"

// ─── Types ────────────────────────────────────────────────────────────────────
interface SheetResponse {
  fileId: string
  columns: string[]
  rows: Record<string, string>[]
}

interface PctRow {
  id: string // 클라이언트 row id (시트 입력 순서 보존)
  품목코드: string
  품목명: string
  제조번호: string
  제형: string
  포장일: string // ISO YYYY-MM-DD 또는 '6/1' 등 원본 보존
  시험완료요청일: string
  긴급: string // '일반' | '긴급'
  진행방법: string // '전항목' | '개별항목'
  상태: string
  담당자: string
  비고: string
  _origin: "sheet" | "added"
  _dirty: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_FILE_ID = "1H9_lR-_tpEHKSpVD2qLbxX5cqXRG_s5rpbGs-gqSPxU"

const STATUS_OPTIONS = ["대기", "진행중", "검토중", "완료", "지연"]
const URGENT_OPTIONS = ["일반", "긴급"]
const METHOD_OPTIONS = ["전항목", "개별항목"]
const PERSON_OPTIONS = [
  "김태훈",
  "박성호",
  "권택균",
  "장재훈",
  "지건희",
  "김기호",
  "이영남",
  "안성은",
  "임수민",
  "김태환",
  "박윤진",
  "정예찬",
  "이원재",
  "김정호",
  "강지윤",
]

const GROUP_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-fuchsia-500",
]

// ─── Utils ────────────────────────────────────────────────────────────────────
function parseShortDate(
  s: string,
  defaultYear: number
): { iso: string; weekKey: string; weekLabel: string } | null {
  if (!s) return null
  // 이미 ISO 형식이면 그대로
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const d = new Date(s + "T00:00:00Z")
    const dow = (d.getUTCDay() + 6) % 7
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - dow)
    const sunday = new Date(monday)
    sunday.setUTCDate(monday.getUTCDate() + 6)
    const fmt = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`
    return {
      iso: d.toISOString().slice(0, 10),
      weekKey: monday.toISOString().slice(0, 10),
      weekLabel: `${fmt(monday)} ~ ${fmt(sunday)}`,
    }
  }
  const m = s.match(/^(\d{1,2})[\.\/](\d{1,2})$/)
  if (!m) return null
  const month = Number(m[1]),
    day = Number(m[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(defaultYear, month - 1, day))
  const dow = (d.getUTCDay() + 6) % 7
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - dow)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`
  return {
    iso: d.toISOString().slice(0, 10),
    weekKey: monday.toISOString().slice(0, 10),
    weekLabel: `${fmt(monday)} ~ ${fmt(sunday)}`,
  }
}

// 컬럼명 fallback 체인 (시트가 갱신되어도 호환)
function pick(r: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k]
    if (v != null && v.trim() !== "") return v.trim()
  }
  return ""
}
const SHEET_KEY_CODE = ["품목코드", "자재코드"]
const SHEET_KEY_NAME = ["품목명", "자재내역"]
const SHEET_KEY_BATCH = ["제조번호"]
const SHEET_KEY_FORM = ["제형"]
const SHEET_KEY_PACK = ["포장일_예정일", "포장일/예정일", "포장일"]
const SHEET_KEY_DEADLINE = ["시험완료요청일", "QC완료예정일", "QC 완료예정일"]
const SHEET_KEY_URGENT = ["긴급", "우선순위"]
const SHEET_KEY_NOTE = ["비고"]

/**
 * 비고 텍스트에서 긴급 의도 추출.
 * "긴급" 포함 시 true, 단 다음 부정 표현은 제외:
 *   - "긴급 아님", "긴급 안 됨"
 *   - "비긴급", "긴급 X", "긴급 x"
 *   - "긴급하지 않", "긴급이 아니"
 */
function noteImpliesUrgent(note: string): boolean {
  const n = (note ?? "").trim()
  if (!n.includes("긴급")) return false
  if (/비\s*긴급/.test(n)) return false
  if (/긴급\s*(아님|아닙|안\s?됨|X|x|없음)/.test(n)) return false
  if (/긴급(하지|이|은)\s*(아니|않)/.test(n)) return false
  return true
}

function rowsFromSheet(resp: SheetResponse): PctRow[] {
  // 운영 메모 등 데이터가 아닌 행 제거: 품목코드/품목명 모두 비어있으면 무시
  const filtered = resp.rows.filter(
    (r) => pick(r, SHEET_KEY_CODE) && pick(r, SHEET_KEY_NAME)
  )

  return filtered.map((r, idx) => {
    const note = pick(r, SHEET_KEY_NOTE)
    const urgentRaw = pick(r, SHEET_KEY_URGENT)
    const urgent =
      urgentRaw === "긴급" || noteImpliesUrgent(note) ? "긴급" : "일반"

    return {
      id: `sheet-${idx}`,
      품목코드: pick(r, SHEET_KEY_CODE),
      품목명: pick(r, SHEET_KEY_NAME),
      제조번호: pick(r, SHEET_KEY_BATCH),
      제형: pick(r, SHEET_KEY_FORM),
      포장일: pick(r, SHEET_KEY_PACK),
      시험완료요청일: pick(r, SHEET_KEY_DEADLINE),
      긴급: urgent,
      진행방법: "전항목", // 기본값
      상태: "대기",
      담당자: "",
      비고: note,
      _origin: "sheet",
      _dirty: false,
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

// ─── Component ────────────────────────────────────────────────────────────────
export default function PctPage() {
  const [fileId, setFileId] = useState(DEFAULT_FILE_ID)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<PctRow[]>([])

  // 시험자 + 역량 데이터 (자동 배정용)
  const [testers, setTesters] = useState<Tester[]>([])
  // 규칙 엔진(서버) 배정 결과 — AI 자동 배정 시 채워짐
  const [engineResult, setEngineResult] = useState<EngineResult | null>(null)
  const [assigning, setAssigning] = useState(false)
  const didAutoLoadRef = useRef(false)
  const didAutoAssignRef = useRef(false)

  // 페이지 마운트 시 시험자/역량 fetch (실패 시 fallback PERSON_OPTIONS 사용)
  useEffect(() => {
    let aborted = false
    ;(async () => {
      try {
        // 담당자 수동 선택 드롭다운용 시험자 명단 (배정 자체는 서버 규칙엔진이 수행)
        const tRes = await fetch("/api/testers", { credentials: "include" })
        if (!tRes.ok) {
          console.warn(
            "[PCT] 시험자 fetch 실패 — 기본 명단으로 fallback",
            tRes.status
          )
          return
        }
        const tJson = await tRes.json()
        if (aborted) return
        setTesters((tJson?.rows ?? []) as Tester[])
      } catch (e) {
        if (!aborted)
          console.warn("[PCT] 시험자 fetch 예외 — 기본 명단으로 fallback", e)
      }
    })()
    return () => {
      aborted = true
    }
  }, [])

  const loadSheet = useCallback(async () => {
    setLoading(true)
    setError(null)
    didAutoAssignRef.current = false
    try {
      const res = await fetch(
        `/api/google-sheet?fileId=${encodeURIComponent(fileId)}`,
        { credentials: "include" }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "시트 불러오기 실패")
      const next = rowsFromSheet(json)
      setRows(next)
      setEngineResult(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류")
    } finally {
      setLoading(false)
    }
  }, [fileId])

  useEffect(() => {
    if (didAutoLoadRef.current) return
    didAutoLoadRef.current = true
    void loadSheet()
  }, [loadSheet])

  // AI 자동 배정 — 서버 규칙엔진 호출 (포장일+1 근무일 시작, product_workload 공수,
  // product_test_items→test_item_equipment→역량 Y/O 매칭, 전항목/개별항목, solo/duo)
  const handleAutoAssign = useCallback(async (sourceRows?: PctRow[]) => {
    const targetRows = sourceRows ?? rows
    if (targetRows.length === 0) return
    setAssigning(true)
    setError(null)
    try {
      const payload = {
        rows: targetRows.map((r) => ({
          품목코드: r.품목코드,
          품목명: r.품목명,
          제조번호: r.제조번호,
          포장일: r.포장일,
          긴급: r.긴급,
          진행방법: r.진행방법,
          담당자: r.담당자,
        })),
      }
      const res = await fetch("/api/schedules/pct-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "자동 배정 실패")
      const result = json as EngineResult
      setEngineResult(result)

      // 행별 담당자 표시 갱신 (전항목: 시험자명 / 개별항목: '개별 N명')
      const byRow = new Map<string, EngineResult["assignments"]>()
      for (const a of result.assignments) {
        const k = `${a.productCode}|${a.batchNo}`
        const arr = byRow.get(k) ?? []
        arr.push(a)
        byRow.set(k, arr)
      }
      setRows((prev) =>
        prev.map((r) => {
          const as =
            byRow.get(`${(r.품목코드 ?? "").trim()}|${r.제조번호}`) ?? []
          let disp = ""
          if (as.length === 1 && as[0].method === "전항목") {
            disp = as[0].isDuo
              ? `${as[0].testerName}+${as[0].duoPartner}`
              : as[0].testerName
          } else if (as.length > 0) {
            disp = `개별 ${as.length}명`
          }
          return disp === r.담당자 ? r : { ...r, 담당자: disp, _dirty: true }
        })
      )
      didAutoAssignRef.current = true
    } catch (e) {
      setError(e instanceof Error ? e.message : "자동 배정 오류")
    } finally {
      setAssigning(false)
    }
  }, [rows])

  useEffect(() => {
    if (didAutoAssignRef.current) return
    if (loading || rows.length === 0) return
    didAutoAssignRef.current = true
    void handleAutoAssign(rows)
  }, [handleAutoAssign, loading, rows])

  // 이번 세션에서 "스케줄 생성"을 눌러 만든 결과 (팝업/배너용). null이면 아직 생성 안 함.
  const [scheduleStats, setScheduleStats] = useState<{
    saved: number
    skipped: number
    generatedAt: string
  } | null>(null)
  // 생성 완료 모달 표시 여부
  const [generatedModalOpen, setGeneratedModalOpen] = useState(false)
  // 페이지 진입 시점에 이미 저장돼 있던 이전 스냅샷 메타 (조용한 안내용 — "생성됨" 팝업은 띄우지 않음)
  const [existingSnapshot, setExistingSnapshot] = useState<{
    count: number
    generatedAt: string
  } | null>(null)

  // 페이지 로드 시 기존 스냅샷이 있으면 "이전 생성 이력"으로만 표시 (불러오기=자동생성 오해 방지)
  useEffect(() => {
    const snap = loadPctMonthlySnapshot()
    if (snap) {
      setExistingSnapshot({
        count: snap.assignments.length,
        generatedAt: snap.generatedAt,
      })
    }
  }, [])

  /**
   * 스케줄 생성 — AI 자동 배정 결과(규칙엔진)를 월간 스케줄 스냅샷으로 저장.
   * 완료 시 모달 팝업. 자동 배정을 먼저 수행해야 활성화됨.
   */
  const handleGenerateSchedule = useCallback(() => {
    if (!engineResult || engineResult.assignments.length === 0) return
    savePctMonthlyFromEngine(engineResult.assignments)
    setScheduleStats({
      saved: engineResult.assignments.length,
      skipped: engineResult.unassigned.length,
      generatedAt: new Date().toISOString(),
    })
    setExistingSnapshot(null) // 새로 생성했으므로 이전 이력 배너는 숨김
    setGeneratedModalOpen(true) // "월간 스케줄 생성됨" 모달
  }, [engineResult])

  // ─── 워크플로우 단계 계산 ───────────────────────────────────────────────────
  // 1 불러오기 → 2 AI 자동 배정 → 3 스케줄 생성 → 4 월간 보기
  const workflowStep = useMemo(() => {
    if (rows.length === 0) return 1 // 불러오기 대기
    if (!engineResult) return 2 // 배정 대기
    if (!scheduleStats) return 3 // 생성 대기
    return 4 // 생성 완료
  }, [rows.length, engineResult, scheduleStats])

  const stats = useMemo(() => {
    return { total: rows.length }
  }, [rows])

  // 시험자 목록을 DB 우선, 실패 시 fallback 사용
  const personOptions = useMemo(() => {
    const active = testers.filter((t) => t.isActive).map((t) => t.name)
    return active.length > 0 ? active : PERSON_OPTIONS
  }, [testers])

  // 보드 컬럼 정의 — 너비 최적화로 가로 폭 절약 (총 ~1180px → 가로 스크롤 최소)
  const columns: ColumnDef[] = [
    { key: "품목명", label: "품목명", kind: "text", width: 180 },
    { key: "품목코드", label: "코드", kind: "mono", width: 70 },
    { key: "제조번호", label: "제조번호", kind: "mono", width: 80 },
    { key: "제형", label: "제형", kind: "text", width: 80 },
    { key: "포장일", label: "포장일", kind: "date", width: 100 },
    { key: "시험완료요청일", label: "완료요청일", kind: "date", width: 110 },
    {
      key: "긴급",
      label: "긴급",
      kind: "chip",
      width: 70,
      options: [...URGENT_OPTIONS],
      chipColor: { 일반: "slate", 긴급: "red" },
    },
    {
      key: "진행방법",
      label: "진행방법",
      kind: "chip",
      width: 95,
      options: [...METHOD_OPTIONS],
      chipColor: { 전항목: "blue", 개별항목: "violet" },
    },
    {
      key: "상태",
      label: "상태",
      kind: "chip",
      width: 85,
      options: [...STATUS_OPTIONS],
      chipColor: {
        대기: "slate",
        진행중: "blue",
        검토중: "violet",
        완료: "emerald",
        지연: "red",
      },
    },
    {
      key: "담당자",
      label: "담당자",
      kind: "person",
      width: 130,
      options: personOptions,
    },
    { key: "공수", label: "공수(일)", kind: "number", width: 70 },
    { key: "비고", label: "비고", kind: "text", width: 140 },
  ]

  // 품목코드 → 공수(일). 자동 배정 결과(서버 product_workload)에서 추출.
  const workdaysByCode = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of engineResult?.assignments ?? [])
      m.set(a.productCode, a.workdays)
    return m
  }, [engineResult])

  // 주차별 그룹화
  const groups: BoardGroup[] = useMemo(() => {
    const year = new Date().getFullYear()
    const buckets = new Map<string, { label: string; rows: PctRow[] }>()

    for (const r of rows) {
      const parsed = parseShortDate(r.포장일, year)
      const k = parsed?.weekKey ?? "no-date"
      const label = parsed?.weekLabel ?? "기간 미정"
      if (!buckets.has(k)) buckets.set(k, { label, rows: [] })
      buckets.get(k)!.rows.push(r)
    }

    const sortedKeys = Array.from(buckets.keys()).sort((a, b) => {
      if (a === "no-date") return 1
      if (b === "no-date") return -1
      return a.localeCompare(b)
    })

    return sortedKeys.map((k, i) => ({
      id: k,
      label: buckets.get(k)!.label,
      color:
        k === "no-date"
          ? "bg-slate-500"
          : GROUP_COLORS[i % GROUP_COLORS.length],
      rows: buckets.get(k)!.rows.map((r) => {
        // 자동 배정 후 품목코드로 공수(일) 표시
        const wd = workdaysByCode.get((r.품목코드 ?? "").trim())
        const 공수 = wd != null ? `${wd}일` : ""
        return {
          id: r.id,
          data: { ...(r as unknown as Record<string, unknown>), 공수 },
        }
      }),
    }))
  }, [rows, workdaysByCode])

  const TXT_PRIMARY = "text-slate-900 dark:text-slate-50"
  const TXT_MUTED = "text-slate-500 dark:text-slate-400"
  const TXT_TERTIARY = "text-slate-600 dark:text-slate-300"
  const BORDER = "border-slate-200 dark:border-slate-700"
  const CARD_BG = "bg-white dark:bg-slate-900"

  const heroStats = useMemo(
    () => [
      {
        label: "전체 행",
        value: stats.total,
        accent: "text-slate-900",
        bg: "bg-slate-50",
        note: rows.length > 0 ? "원본 시트 자동 반영됨" : "시트를 불러오세요",
      },
      {
        label: "자동 배정",
        value: engineResult?.stats.assigned ?? 0,
        accent: "text-emerald-700",
        bg: "bg-emerald-50",
        note: engineResult
          ? `${engineResult.stats.testersUsed}명 참여 · 공수 자동 채움`
          : "자동 채움 대기",
      },
      {
        label: "스케줄",
        value: scheduleStats?.saved ?? existingSnapshot?.count ?? 0,
        accent: "text-sky-700",
        bg: "bg-sky-50",
        note: scheduleStats
          ? "이번 세션 생성"
          : existingSnapshot
            ? "이전 생성 이력"
            : "아직 없음",
      },
    ],
    [engineResult, existingSnapshot, rows.length, scheduleStats, stats]
  )

  const workflowItems = useMemo(
    () => [
      { n: 1, label: "시트 불러오기", icon: Download, active: rows.length > 0 },
      {
        n: 2,
        label: "AI 자동 배정",
        icon: Sparkles,
        active: !!engineResult,
      },
      {
        n: 3,
        label: "스케줄 생성",
        icon: CalendarPlus,
        active: !!scheduleStats,
      },
      {
        n: 4,
        label: "월간 보기",
        icon: Calendar,
        active: !!scheduleStats || !!existingSnapshot,
      },
    ],
    [engineResult, existingSnapshot, rows.length, scheduleStats]
  )

  return (
    <div className="relative overflow-x-hidden p-3 md:p-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[320px] bg-[radial-gradient(circle_at_10%_10%,rgba(16,185,129,0.12),transparent_28%),radial-gradient(circle_at_90%_0%,rgba(59,130,246,0.12),transparent_30%),linear-gradient(to_bottom,rgba(241,245,249,0.96),transparent_65%)]" />
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
          <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1.18fr)_minmax(340px,0.82fr)]">
            <div className="relative border-b border-slate-100 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] p-4 sm:p-5 xl:border-r xl:border-b-0">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.08),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.08),transparent_35%)]" />
              <div className="relative space-y-4">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold tracking-[0.28em] text-slate-500 uppercase">
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600 shadow-sm">
                    <Factory size={12} />
                    PCT 시트 허브
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-700 shadow-sm">
                    <Sparkles size={12} />
                    읽기 전용
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-1 tracking-normal",
                      rows.length > 0
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border border-amber-200 bg-amber-50 text-amber-700"
                    )}
                  >
                    {rows.length > 0 ? "시트 연결됨" : "시트 대기"}
                  </span>
                </div>

                <div className="max-w-3xl space-y-2">
                  <h1 className="text-[clamp(1.75rem,3vw,2.8rem)] font-semibold tracking-tight text-slate-900">
                    PCT (생산관리)
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600">
                    구글 스프레드시트에서 생산 배치를 자동 불러오기만 하고,
                    이 화면에서는 수정하지 않습니다. 데스크톱에서는 한 눈에
                    흐름이 보이도록, 모바일에서는 읽기 편하게 정리했습니다.
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {heroStats.map((item) => (
                    <div
                      key={item.label}
                      className={cn(
                        "rounded-lg border border-slate-200 px-3 py-3 shadow-sm",
                        item.bg
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold tracking-[0.22em] text-slate-500 uppercase">
                            {item.label}
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-xl font-bold",
                              item.accent
                            )}
                          >
                            {item.value}
                          </p>
                        </div>
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                        {item.note}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {workflowItems.map((s, i) => {
                    const Icon = s.icon
                    return (
                      <div
                        key={s.n}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs shadow-sm",
                          s.active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : i === 0
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-white text-slate-700"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                            s.active
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-100 text-slate-700"
                          )}
                        >
                          {s.active ? (
                            <CheckCircle2 size={13} />
                          ) : (
                            <Icon size={13} />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[10px] font-semibold tracking-[0.22em] text-slate-400 uppercase">
                            Step {s.n}
                          </span>
                          <span className="block truncate font-medium">
                            {s.label}
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="relative border-t border-slate-100 bg-slate-50/80 p-4 sm:p-5 xl:border-t-0 xl:border-l">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.08),transparent_28%)]" />
              <div className="relative space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold tracking-[0.28em] text-slate-500 uppercase">
                      시트 연결
                    </p>
                    <h2 className="mt-1 text-lg font-semibold text-slate-900">
                      구글 시트 ID
                    </h2>
                  </div>
                  <Button
                    onClick={loadSheet}
                    disabled={loading || !fileId.trim()}
                    className="h-9 gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {loading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {loading
                      ? "불러오는 중..."
                      : rows.length
                        ? "다시 불러오기"
                        : "시트 불러오기"}
                  </Button>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-600">
                    파일 ID
                  </label>
                  <input
                    type="text"
                    value={fileId}
                    onChange={(e) => setFileId(e.target.value)}
                    disabled={loading}
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60"
                    placeholder="시트 URL의 /d/ 다음 ID"
                  />
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    onClick={handleAutoAssign}
                    disabled={rows.length === 0 || assigning}
                    size="sm"
                    title="시험자 역량·장비(test_item_equipment)·공수(product_workload) 기반 규칙 자동 배정"
                    className="h-10 gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {assigning ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Sparkles size={13} />
                    )}
                    {assigning ? "자동 채움 중..." : "자동 채움 / 배정"}
                  </Button>
                  <Button
                    onClick={handleGenerateSchedule}
                    disabled={
                      !engineResult || engineResult.assignments.length === 0
                    }
                    size="sm"
                    title="자동 배정 결과를 월간 스케줄 스냅샷으로 전송"
                    className="h-10 gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CalendarPlus size={13} />
                    스케줄 생성
                  </Button>
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
                    <AlertCircle
                      size={14}
                      className="mt-0.5 shrink-0 text-red-500"
                    />
                    <p className="text-xs leading-relaxed text-red-700">
                      {error}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 데이터 로드 후 영역 */}
        {rows.length > 0 && (
          <>
            {/* 요약 스트립 */}
            <Card
              className={`${BORDER} ${CARD_BG} shadow-[0_14px_50px_rgba(15,23,42,0.06)]`}
            >
              <CardContent className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
                    현재 단계{" "}
                    <span className="text-slate-900">{workflowStep}/4</span>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold text-blue-700">
                    읽기 전용
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">
                    총 <b className="text-slate-900">{stats.total}</b>건
                  </span>
                  <span
                    className={`rounded-full border border-dashed border-slate-200 px-2.5 py-1 ${TXT_MUTED}`}
                  >
                    수정/추가 비활성화
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href="/schedule/monthly"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    월간 스케줄 보기
                    <ArrowRight size={14} />
                  </a>
                </div>
              </CardContent>
            </Card>

            {/* AI 자동 배정 결과 알림 */}
            {engineResult && (
              <Card className="border-emerald-200 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30">
                <CardContent className="flex flex-col gap-2 py-3 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white">
                        <Sparkles size={14} />
                      </div>
                      <span className={`font-semibold ${TXT_PRIMARY}`}>
                        AI 자동 배정 완료
                      </span>
                    </div>
                    <span className={TXT_TERTIARY}>
                      배정{" "}
                      <b className={`text-base ${TXT_PRIMARY}`}>
                        {engineResult.stats.assigned}
                      </b>
                      건
                    </span>
                    {engineResult.stats.urgent > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-100 px-2 py-0.5 font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-300">
                        <AlertTriangle size={10} /> 긴급{" "}
                        {engineResult.stats.urgent}건
                      </span>
                    )}
                    {engineResult.stats.duo > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-100 px-2 py-0.5 font-semibold text-sky-700 dark:border-sky-800 dark:bg-sky-900/50 dark:text-sky-300">
                        듀오 {engineResult.stats.duo}건
                      </span>
                    )}
                    <span className={TXT_TERTIARY}>
                      참여 시험자{" "}
                      <b className={`text-base ${TXT_PRIMARY}`}>
                        {engineResult.stats.testersUsed}
                      </b>
                      명
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-100 px-2 py-0.5 font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
                      공수 매칭 {engineResult.stats.workloadMatched}건
                      {engineResult.stats.workloadMissing > 0 && (
                        <span className="font-normal text-blue-500 dark:text-blue-400">
                          {" "}
                          · 미등록 {engineResult.stats.workloadMissing}건(기본
                          3일)
                        </span>
                      )}
                    </span>
                  </div>
                  {engineResult.unassigned.length > 0 && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/40">
                      <p className="font-semibold text-amber-700 dark:text-amber-300">
                        미배정 {engineResult.unassigned.length}건
                      </p>
                      <ul className="mt-1 list-inside list-disc text-amber-700 dark:text-amber-300/90">
                        {engineResult.unassigned.slice(0, 6).map((u, i) => (
                          <li key={i}>
                            {u.productCode} {u.productName} ({u.batchNo}) —{" "}
                            {u.reason}
                          </li>
                        ))}
                        {engineResult.unassigned.length > 6 && (
                          <li>… 외 {engineResult.unassigned.length - 6}건</li>
                        )}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* 이전 생성 이력 (조용한 안내 — 이번 세션 생성 아님) */}
            {!scheduleStats && existingSnapshot && (
              <Card className={`${BORDER} bg-slate-50 dark:bg-slate-800/40`}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
                  <span className={TXT_TERTIARY}>
                    이전에 생성된 월간 스케줄{" "}
                    <b className={TXT_PRIMARY}>{existingSnapshot.count}</b>건이
                    있습니다
                    <span className={`ml-2 text-[10px] ${TXT_MUTED}`}>
                      (
                      {new Date(existingSnapshot.generatedAt).toLocaleString(
                        "ko-KR"
                      )}
                      )
                    </span>
                  </span>
                  <a
                    href="/schedule/monthly"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                  >
                    월간 스케줄 보기 →
                  </a>
                </CardContent>
              </Card>
            )}

            {/* 스케줄 생성 결과 배너 (이번 세션 생성) */}
            {scheduleStats && (
              <Card className="border-blue-200 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/30">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-3 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white">
                        <CheckCircle2 size={14} />
                      </div>
                      <span className={`font-semibold ${TXT_PRIMARY}`}>
                        월간 스케줄 생성됨
                      </span>
                    </div>
                    <span className={TXT_TERTIARY}>
                      전송:{" "}
                      <b className={`text-base ${TXT_PRIMARY}`}>
                        {scheduleStats.saved}
                      </b>
                      건
                    </span>
                    {scheduleStats.skipped > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                        담당자 미지정 {scheduleStats.skipped}건 제외
                      </span>
                    )}
                    <span className={`text-[10px] ${TXT_MUTED}`}>
                      {new Date(scheduleStats.generatedAt).toLocaleString(
                        "ko-KR"
                      )}
                    </span>
                  </div>
                  <a
                    href="/schedule/monthly"
                    className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700"
                  >
                    월간 스케줄 보기 →
                  </a>
                </CardContent>
              </Card>
            )}

            {/* 보드 */}
            <Card className={`${BORDER} ${CARD_BG}`}>
              <CardContent className="p-3 sm:p-4">
                <div className="overflow-x-auto">
                  <MondayBoard
                    groups={groups}
                    columns={columns}
                    emptyMessage="표시할 행이 없습니다."
                    defaultCollapsed
                    showToggleAll
                  />
                </div>
              </CardContent>
            </Card>

            <Card className={`${BORDER} bg-slate-50 dark:bg-slate-800/40`}>
              <CardContent className="space-y-1.5 py-3 text-[11px] leading-relaxed">
                <p
                  className={`font-semibold tracking-wide uppercase ${TXT_MUTED}`}
                >
                  안내
                </p>
                <ul
                  className={`list-inside list-disc space-y-0.5 ${TXT_TERTIARY}`}
                >
                  <li>
                    이 화면은 읽기 전용입니다. 원본 시트에서 가져온 데이터와
                    자동 배정 결과만 확인할 수 있습니다.
                  </li>
                  <li>
                    포장일이 비어있거나 형식이 맞지 않으면 &quot;기간 미정&quot;
                    그룹으로 분류됩니다.
                  </li>
                  <li>
                    <b className="text-blue-600 dark:text-blue-300">전항목</b>:
                    해당 품목의 모든 시험항목을 한 시험자(또는 듀오 조)에게
                    배정합니다.
                  </li>
                  <li>
                    <b className="text-violet-600 dark:text-violet-300">
                      개별항목
                    </b>
                    : 시험항목을 여러 시험자에게 나눠 동시에 진행합니다.
                  </li>
                  <li>
                    <b className="text-emerald-600 dark:text-emerald-300">
                      자동 배정
                    </b>
                    : 시험자관리에 등록된 시험자 + 역량 기준으로 부하 최소 분배.
                    비고 또는 긴급 컬럼에 &quot;긴급&quot; 단어가 있으면 최우선
                    처리합니다.
                  </li>
                </ul>
              </CardContent>
            </Card>
          </>
        )}

        {/* 데이터 없을 때 안내 */}
        {!loading && rows.length === 0 && !error && (
          <Card className={`${BORDER} ${CARD_BG}`}>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-12">
              <FileSpreadsheet
                size={32}
                className="text-slate-300 dark:text-slate-600"
              />
              <p className={`text-sm ${TXT_MUTED}`}>
                위에서 &quot;시트 불러오기&quot;를 눌러 데이터를 가져오세요.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 월간 스케줄 생성 완료 모달 */}
      <Dialog open={generatedModalOpen} onOpenChange={setGeneratedModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                <CheckCircle2 size={18} />
              </span>
              월간 스케줄 생성됨
            </DialogTitle>
            <DialogDescription>
              배정된 항목이 월간 스케줄로 전송되었습니다.
            </DialogDescription>
          </DialogHeader>

          {scheduleStats && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800/40">
              <span className={TXT_TERTIARY}>
                전송{" "}
                <b className={`text-lg ${TXT_PRIMARY}`}>
                  {scheduleStats.saved}
                </b>
                건
              </span>
              {scheduleStats.skipped > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                  담당자 미지정 {scheduleStats.skipped}건 제외
                </span>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGeneratedModalOpen(false)}
            >
              닫기
            </Button>
            <a
              href="/schedule/monthly"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              월간 스케줄 보기 <ArrowRight size={15} />
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
