"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { displayBatchNo, displayProductCode } from "@shared/order-na"
import { RefreshCw, Lock, Unlock, Loader2 } from "lucide-react"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"

// ─── Types ──────────────────────────────────────────────────────────────────
interface GroupItem {
  orderId: string
  productCode: string
  productName: string
  batchNo: string
  packagingDate: string | null
}
interface GroupRow {
  id: string
  groupKey: string
  label: string | null
  testStartDate: string | null
  groupLock: boolean
  items: GroupItem[]
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function GroupsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [rows, setRows] = useState<GroupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/concurrent-groups", { credentials: "include" })
      const data = await res.json()
      setRows(data.rows ?? [])
    } catch {
      setMsg("그룹 목록을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const rebuild = async () => {
    setBusy("rebuild")
    try {
      const res = await fetch("/api/concurrent-groups", { method: "POST", credentials: "include" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash(`그룹 재생성 완료 — 신규 ${data.created} · 보존(잠금) ${data.kept}`)
      await load()
    } catch (e) {
      flash(`재생성 실패: ${e instanceof Error ? e.message : ""}`)
    } finally { setBusy(null) }
  }

  const toggleLock = async (g: GroupRow) => {
    setBusy(g.id)
    try {
      const res = await fetch(`/api/concurrent-groups/${g.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupLock: !g.groupLock }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      await load()
    } catch (e) {
      flash(`잠금 변경 실패: ${e instanceof Error ? e.message : ""}`)
    } finally { setBusy(null) }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {/* ── 페이지 머리 ────────────────────────────────────────────────────
          제목을 카드에 넣고 그 밑에 화면 이름을 되풀이하던 자리다.
          부제는 지우고, 이 화면에서만 알 수 있는 사실(그룹 수·잠금 규칙)만 남긴다. */}
      <header className="flex min-w-0 shrink-0 flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">동시분석 그룹</h1>
          <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">
            총 <span className="font-semibold tabular-nums text-foreground">{rows.length}</span>개 그룹
            <span className="px-1 text-border">·</span>
            잠근 그룹은 재생성해도 그대로 남습니다
          </p>
        </div>
        {isAdmin && (
          <Button size="lg" onClick={rebuild} disabled={busy !== null}>
            {busy === "rebuild" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            그룹 재생성
          </Button>
        )}
      </header>

      {msg && (
        <p className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs break-keep text-primary">{msg}</p>
      )}

      {/* 그룹 카드 목록 */}
      {loading ? (
        <div className="grid min-w-0 shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-0 py-0">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
              <ul className="divide-y border-t">
                {Array.from({ length: 3 }).map((_, j) => (
                  <li key={j} className="flex items-center gap-3 px-4 py-2.5">
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-14" />
                    <Skeleton className="h-4 w-20" />
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="shrink-0 py-10 text-center text-sm break-keep text-muted-foreground">
          생성된 그룹이 없습니다.{isAdmin && " \"그룹 재생성\"으로 묶어보세요."}
        </p>
      ) : (
        <div className="grid min-w-0 shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
          {rows.map(g => (
            /* 카드 왼쪽에 두르던 색 띠(border-l 대용 막대)를 걷어냈다.
               일곱 색을 돌려 쓰던 터라 색이 아무 뜻도 없었고, 브랜드 색 규칙에도 어긋났다.
               구분은 시험 시작일(제목)과 잠김 배지가 한다. */
            <Card key={g.id} className="min-w-0 gap-0 py-0">
              {/* 카드 헤더 */}
              <div className="flex min-w-0 items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    시험 시작일 <span className="tabular-nums">{g.testStartDate ?? "미정"}</span>
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs leading-normal text-muted-foreground">
                    <span className="tabular-nums">{g.items.length}</span>품목
                    {g.groupLock && (
                      <>
                        <span className="text-border">·</span>
                        <span className="inline-flex items-center gap-1 font-medium text-foreground">
                          <Lock size={11} /> 잠김
                        </span>
                      </>
                    )}
                  </p>
                </div>
                {isAdmin && (
                  <Button
                    variant="outline"
                    onClick={() => void toggleLock(g)}
                    disabled={busy !== null}
                    title={g.groupLock ? "잠금 해제" : "잠금"}
                  >
                    {busy === g.id
                      ? <Loader2 className="animate-spin" />
                      : g.groupLock ? <Unlock /> : <Lock />}
                    {g.groupLock ? "해제" : "잠금"}
                  </Button>
                )}
              </div>

              {/* 멤버 품목 리스트 — 안쪽에 테두리를 또 두르지 않고 실선으로만 나눈다.
                  네 값을 한 줄에 늘어놓으면 320px 에서 품목명이 0폭으로 눌린다 —
                  좁은 폭에선 품목명 아래로 코드·제조번호·포장일을 한 줄에 접어 쌓는다. */}
              <ul className="divide-y border-t">
                {g.items.map(it => (
                  <li key={it.orderId} className="flex min-w-0 flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={it.productName}>
                      {it.productName}
                    </span>
                    <span className="flex min-w-0 items-center gap-2 text-xs leading-normal text-muted-foreground sm:contents">
                      <span className="shrink-0 font-mono">{displayProductCode(it.productCode)}</span>
                      <span className="shrink-0 font-mono">{displayBatchNo(it.batchNo)}</span>
                      <span className="ml-auto shrink-0 tabular-nums sm:ml-0 sm:w-24 sm:text-right">{it.packagingDate ?? "-"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
