"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, RefreshCw, Search, Send } from "lucide-react"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@frontend/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"
import {
  STABILITY_SHEET_ID,
  isStabilitySummaryRow,
  mapRow,
  stabilitySourceKey,
  type StabilitySheetRow,
} from "@frontend/lib/stability-sheet"
import { useAuth } from "@frontend/lib/auth-context"

type PlanStatus = "미전송" | "전송됨" | "완료" | "시트 제외"
interface PlanRow {
  id: string
  productCode: string
  productName: string
  batchNo: string
  testType: string
  period: string
  manufacturedAt: string | null
  expiryDate: string | null
  requestNo: string | null
  planStatus: PlanStatus
  linkedOrderId: string | null
}
const statusClass: Record<PlanStatus, string> = {
  미전송: "border-amber-200 bg-amber-50 text-amber-700",
  전송됨: "border-blue-200 bg-blue-50 text-blue-700",
  완료: "border-blue-400 bg-blue-100 text-blue-900",
  "시트 제외": "border-red-200 bg-red-50 text-red-700",
}
export default function StabPlanPage() {
  const { user, loading: authLoading } = useAuth()
  const userRole = user?.role
  const isAdmin = userRole === "admin"
  const [rows, setRows] = useState<PlanRow[]>([])
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"전체" | PlanStatus>("전체")
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // 관리자만 시트 동기화와 AI 스케줄 전송을 수행하고, 시험자는 저장된 계획만 조회한다.
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (isAdmin) {
        const sheet = await fetch(
          `/api/google-sheet/stability?fileId=${encodeURIComponent(STABILITY_SHEET_ID)}`,
          { credentials: "include" }
        )
        const sj = (await sheet.json()) as {
          rows?: Record<string, string>[]
          error?: string
        }
        if (!sheet.ok)
          throw new Error(sj.error ?? "안정성 시트를 불러오지 못했습니다")
        const mapped = (sj.rows ?? [])
          .map(mapRow)
          .filter(
            (r) =>
              !isStabilitySummaryRow(r) &&
              (r.productCode || r.productName || r.batchNo)
          )
        if (!mapped.length)
          throw new Error("시트 응답이 비어 있어 동기화를 중단했습니다.")
        const sync = await fetch("/api/stability-plan", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sync", rows: mapped.map(toInput) }),
        })
        const json = (await sync.json()) as { rows?: PlanRow[]; error?: string }
        if (!sync.ok)
          throw new Error(json.error ?? "시험계획 동기화에 실패했습니다")
        setRows(json.rows ?? [])
      } else {
        const response = await fetch("/api/stability-plan", {
          credentials: "include",
        })
        const json = (await response.json()) as {
          rows?: PlanRow[]
          error?: string
        }
        if (!response.ok)
          throw new Error(json.error ?? "시험계획을 불러오지 못했습니다")
        setRows(json.rows ?? [])
      }
      setSelected([])
    } catch (e) {
      if (isAdmin) {
        try {
          const fallback = await fetch("/api/stability-plan", {
            credentials: "include",
          })
          const json = (await fallback.json()) as { rows?: PlanRow[] }
          if (fallback.ok) {
            setRows(json.rows ?? [])
            setSelected([])
            setError("시트 동기화에 실패해 저장된 계획을 표시합니다.")
            return
          }
        } catch {
          /* 저장된 계획 조회도 실패하면 원래 오류를 표시한다. */
        }
      }
      setError(e instanceof Error ? e.message : "시험계획 연동 오류")
    } finally {
      setLoading(false)
    }
  }, [isAdmin])
  useEffect(() => {
    if (!authLoading && userRole) void load()
  }, [authLoading, userRole, load])
  // 검색어와 상태 필터를 적용한 행만 표에 표시한다.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (filter === "전체" || r.planStatus === filter) &&
        [
          r.productCode,
          r.productName,
          r.batchNo,
          r.testType,
          r.period,
          r.requestNo ?? "",
          r.planStatus,
        ].some((v) => v.toLowerCase().includes(q))
    )
  }, [rows, filter, query])
  // 선택한 미전송 계획을 확인 후 오더 생성 API로 전달한다.
  const transfer = async () => {
    setConfirmOpen(false)
    if (!selected.length) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch("/api/stability-plan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "transfer", ids: selected }),
      })
      const json = (await res.json()) as {
        results?: Array<{ status: string }>
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? "전송 실패")
      const result = json.results ?? []
      setNotice(
        `전송 ${result.filter((x) => x.status === "성공").length}건 · 건너뜀 ${result.filter((x) => x.status === "건너뜀").length}건 · 실패 ${result.filter((x) => x.status === "실패").length}건`
      )
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 스케줄 전송 오류")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">안정성시험 · 시험계획</h1>
          <p className="mt-1 text-xs leading-normal text-muted-foreground">
            시트 미완료 품목을 계획으로 보존하고 AI 스케줄 배정을 요청합니다.
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-9 gap-2"
              onClick={() => void load()}
              disabled={loading || busy}
            >
              <RefreshCw size={15} /> 시트 다시 불러오기
            </Button>
            <Button
              className="h-9 gap-2"
              onClick={() => setConfirmOpen(true)}
              disabled={!selected.length || busy}
            >
              <Send size={15} /> AI 스케줄로 보내기
            </Button>
          </div>
        )}
      </header>
      {notice && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {notice}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={18} />
          {error}
        </div>
      )}
      <Card className="shrink-0 gap-0 overflow-hidden py-0 shadow-none">
        <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1">
            {(["전체", "미전송", "전송됨", "완료", "시트 제외"] as const).map(
              (s) => (
                <Button
                  key={s}
                  variant={filter === s ? "default" : "outline"}
                  className="h-8 px-3 text-xs"
                  onClick={() => setFilter(s)}
                >
                  {s}
                </Button>
              )
            )}
          </div>
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="품목·제조번호·상태 검색"
              className="h-9 pl-9"
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                {isAdmin ? "선택" : "구분"}
              </TableHead>
              <TableHead>품목</TableHead>
              <TableHead>시험·기간</TableHead>
              <TableHead>제조번호</TableHead>
              <TableHead>제조·기한</TableHead>
              <TableHead>상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-32 text-center text-sm text-muted-foreground"
                >
                  불러오는 중입니다…
                </TableCell>
              </TableRow>
            ) : visible.length ? (
              visible.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {isAdmin && (
                      <input
                        type="checkbox"
                        aria-label={`${r.productName} 선택`}
                        checked={selected.includes(r.id)}
                        disabled={r.planStatus !== "미전송"}
                        onChange={() =>
                          setSelected((v) =>
                            v.includes(r.id)
                              ? v.filter((x) => x !== r.id)
                              : [...v, r.id]
                          )
                        }
                        className="size-4 accent-primary"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{r.productName}</div>
                    <div className="text-xs leading-normal text-muted-foreground">
                      {r.productCode}
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.testType}
                    <div className="text-xs leading-normal text-muted-foreground">
                      {r.period}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs leading-normal">
                    {r.batchNo}
                  </TableCell>
                  <TableCell className="text-xs leading-normal text-muted-foreground">
                    {r.manufacturedAt ?? "제조일 없음"} ·{" "}
                    {r.expiryDate ?? "사용기한 없음"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={statusClass[r.planStatus]}
                    >
                      {r.planStatus}
                    </Badge>
                    {r.linkedOrderId && (
                      <div className="mt-1 text-xs leading-normal text-muted-foreground">
                        오더 연결됨
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-32 text-center text-sm text-muted-foreground"
                >
                  표시할 안정성 품목이 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      {isAdmin && (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>AI 스케줄 전송</DialogTitle>
              <DialogDescription>
                {selected.length}건의 안정성 시험계획을 미배정 오더로
                생성합니다. 계속하시겠습니까?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                취소
              </Button>
              <Button onClick={() => void transfer()}>전송</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
function toInput(r: StabilitySheetRow) {
  return {
    sourceKey: stabilitySourceKey(r),
    productCode: r.productCode,
    productName: r.productName,
    batchNo: r.batchNo,
    testType: r.testType,
    period: r.period,
    manufacturedAt: r.manufacturedAt,
    expiryDate: r.expiryDate,
    periodEndDate: r.periodEndDate,
    reason: r.reason,
    requestedAt: r.requestedAt,
    requestNo: r.requestNo,
    sheetStatus: r.status,
    approved: r.approved,
    source: r.source,
  }
}
