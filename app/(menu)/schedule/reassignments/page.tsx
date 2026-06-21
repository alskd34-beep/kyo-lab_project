"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { RefreshCw, Loader2, Search, History, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@frontend/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@frontend/components/ui/table'
import { Skeleton } from "@frontend/components/ui/skeleton"

// ─── Types ──────────────────────────────────────────────────────────────────
interface ReassignmentRow {
  id: string
  groupId: string | null
  orderId: string | null
  productName: string | null
  beforeUser: string | null
  beforeUserName: string | null
  afterUser: string | null
  afterUserName: string | null
  reason: string | null
  changedBy: string | null
  changedByName: string | null
  changedAt: string
}
interface StatItem { name: string; count: number }
interface Stats { byTester: StatItem[]; byProduct: StatItem[] }
interface Tester { id: string; name: string }

// ─── Component ────────────────────────────────────────────────────────────────
export default function ReassignmentsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [rows, setRows] = useState<ReassignmentRow[]>([])
  const [stats, setStats] = useState<Stats>({ byTester: [], byProduct: [] })
  const [testers, setTesters] = useState<Tester[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const [afterUser, setAfterUser] = useState("")
  const [productName, setProductName] = useState("")
  const [productInput, setProductInput] = useState("")

  type SortField = "changedAt" | "productName" | "beforeUserName" | "afterUserName" | "changedByName"
  const [sortField, setSortField] = useState<SortField>("changedAt")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDir("asc")
    }
  }

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aVal = a[sortField] ?? ""
      const bVal = b[sortField] ?? ""
      const cmp = sortField === "changedAt"
        ? aVal.localeCompare(bVal)
        : aVal.localeCompare(bVal, "ko")
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [rows, sortField, sortDir])

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronDown size={12} className="text-slate-300 shrink-0" />
    return sortDir === "asc"
      ? <ChevronUp size={12} className="text-blue-500 shrink-0" />
      : <ChevronDown size={12} className="text-blue-500 shrink-0" />
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (afterUser) qs.set("afterUser", afterUser)
      if (productName) qs.set("productName", productName)
      const suffix = qs.toString() ? `?${qs.toString()}` : ""
      const [rRes, tRes] = await Promise.all([
        fetch(`/api/reassignment-history${suffix}`, { credentials: "include" }),
        fetch(`/api/testers`, { credentials: "include" }),
      ])
      if (!rRes.ok) {
        const e = await rRes.json().catch(() => ({}))
        throw new Error(e.error ?? "조회 실패")
      }
      const rData = await rRes.json()
      const tData = await tRes.json()
      setRows(rData.rows ?? [])
      setStats(rData.stats ?? { byTester: [], byProduct: [] })
      setTesters((tData.rows ?? []).map((t: Tester) => ({ id: t.id, name: t.name })))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "목록을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [afterUser, productName])

  useEffect(() => { if (isAdmin) void load() }, [isAdmin, load])

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-4 p-3 md:p-5">
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-medium text-amber-700">
          <ShieldAlert size={18} /> 관리자만 접근할 수 있는 화면입니다.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-3 md:p-5">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between md:py-4">
        <div>
          <h1 className="text-base font-bold text-slate-900 sm:text-lg">재배정 이력 · 분석</h1>
          <p className="mt-1 text-xs font-medium text-slate-600">
            담당자 재배정 이력을 조회하고, 시험자/품목별 변경 빈도를 분석합니다.
          </p>
        </div>
        <button
          onClick={() => void load()} disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          새로고침
        </button>
      </div>

      {msg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{msg}</div>
      )}

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <StatCard title="시험자별 재배정 횟수" items={stats.byTester} barClass="bg-blue-500" empty="집계할 이력이 없습니다." />
        <StatCard title="품목별 재배정 횟수" items={stats.byProduct} barClass="bg-violet-500" empty="집계할 이력이 없습니다." />
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={afterUser || 'all'} onValueChange={v => setAfterUser(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-9 px-3 w-auto min-w-[160px]">
            <SelectValue placeholder="전체 시험자(변경 후)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 시험자(변경 후)</SelectItem>
            {testers.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <input
            value={productInput}
            onChange={e => setProductInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") setProductName(productInput.trim()) }}
            placeholder="품목명 검색"
            className="h-9 w-44 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:outline-none"
          />
          <button
            onClick={() => setProductName(productInput.trim())}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            <Search size={15} /> 검색
          </button>
          {(productName || afterUser) && (
            <button
              onClick={() => { setAfterUser(""); setProductName(""); setProductInput("") }}
              className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              초기화
            </button>
          )}
        </div>
        <span className="text-xs font-medium text-slate-500">총 {rows.length}건</span>
      </div>

      {/* 이력 테이블 */}
      {loading ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm py-0">
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[760px] text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3 py-2 text-muted-foreground">변경일시</TableHead>
                  <TableHead className="px-3 py-2 text-muted-foreground">품목</TableHead>
                  <TableHead className="px-3 py-2 text-muted-foreground">변경전 → 변경후</TableHead>
                  <TableHead className="px-3 py-2 text-muted-foreground">사유</TableHead>
                  <TableHead className="px-3 py-2 text-muted-foreground">변경자</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} className="border-b border-slate-100 last:border-0">
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-10 text-center text-slate-400 shadow-sm">
          재배정 이력이 없습니다.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm gap-0 overflow-hidden py-0">
          <div className="overflow-x-auto">
            <Table className="w-full min-w-[760px] text-sm">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3 py-2 cursor-pointer select-none text-muted-foreground" onClick={() => toggleSort("changedAt")}>
                    <span className="inline-flex items-center gap-1">변경일시<SortIcon field="changedAt" /></span>
                  </TableHead>
                  <TableHead className="px-3 py-2 cursor-pointer select-none text-muted-foreground" onClick={() => toggleSort("productName")}>
                    <span className="inline-flex items-center gap-1">품목<SortIcon field="productName" /></span>
                  </TableHead>
                  <TableHead className="px-3 py-2 cursor-pointer select-none text-muted-foreground" onClick={() => toggleSort("afterUserName")}>
                    <span className="inline-flex items-center gap-1">변경전 → 변경후<SortIcon field="afterUserName" /></span>
                  </TableHead>
                  <TableHead className="px-3 py-2 text-muted-foreground">사유</TableHead>
                  <TableHead className="px-3 py-2 cursor-pointer select-none text-muted-foreground" onClick={() => toggleSort("changedByName")}>
                    <span className="inline-flex items-center gap-1">변경자<SortIcon field="changedByName" /></span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map(r => (
                  <TableRow key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <TableCell className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.changedAt).toLocaleString("ko-KR")}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-medium text-foreground">{r.productName ?? "-"}</TableCell>
                    <TableCell className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground line-through">{r.beforeUserName ?? "미배정"}</span>
                        <span className="text-xs text-muted-foreground">→</span>
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                          {r.afterUserName ?? "미배정"}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{r.reason ?? <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">{r.changedByName ?? <span className="text-muted-foreground">-</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 통계 카드 ────────────────────────────────────────────────────────────────
function StatCard({ title, items, barClass, empty }: {
  title: string; items: StatItem[]; barClass: string; empty: string
}) {
  const max = items.reduce((m, i) => Math.max(m, i.count), 0)
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-1.5">
        <History size={15} className="text-slate-400" />
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-400">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map(i => (
            <li key={i.name} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-xs font-medium text-slate-700" title={i.name}>{i.name}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${barClass}`}
                  style={{ width: max > 0 ? `${Math.max(6, (i.count / max) * 100)}%` : "0%" }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-600">{i.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
