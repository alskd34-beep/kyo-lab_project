"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { Layers, RefreshCw, Lock, Unlock, Loader2, CalendarClock } from "lucide-react"

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

const CARD_BARS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500",
  "bg-amber-500", "bg-rose-500", "bg-teal-500", "bg-fuchsia-500",
]

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
    <div className="flex flex-col gap-4 p-3 md:p-5">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between md:py-4">
        <div>
          <h1 className="flex items-center gap-1.5 text-base font-bold text-slate-900 sm:text-lg">
            <Layers size={18} className="text-blue-600" /> 동시분석 그룹
          </h1>
          <p className="mt-1 text-xs font-medium text-slate-600">
            동시에 시험 가능한 오더를 자동으로 묶어 관리합니다. 잠근 그룹은 재생성 시 보존됩니다.
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={rebuild} disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === "rebuild" ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              그룹 재생성
            </button>
          </div>
        )}
      </div>

      {msg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">{msg}</div>
      )}

      <span className="text-xs font-medium text-slate-500">총 {rows.length}개 그룹</span>

      {/* 그룹 카드 목록 */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-10 text-center text-slate-400 shadow-sm">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-10 text-center text-slate-400 shadow-sm">
          생성된 그룹이 없습니다. {isAdmin && "\"그룹 재생성\"으로 묶어보세요."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rows.map((g, idx) => {
            const bar = g.groupLock ? "bg-slate-400" : CARD_BARS[idx % CARD_BARS.length]
            return (
              <div key={g.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {/* 카드 헤더 */}
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                  <span className={`h-8 w-1.5 shrink-0 rounded-full ${bar}`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-500">{g.groupKey}</span>
                      {g.groupLock && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          <Lock size={10} /> 잠김
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-slate-800">
                      <CalendarClock size={14} className="text-slate-400" />
                      시험 시작일 {g.testStartDate ?? "미정"}
                      <span className="text-xs font-medium text-slate-400">· {g.items.length}품목</span>
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => void toggleLock(g)} disabled={busy !== null}
                      title={g.groupLock ? "잠금 해제" : "잠금"}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                    >
                      {busy === g.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : g.groupLock ? <Unlock size={14} /> : <Lock size={14} />}
                      {g.groupLock ? "해제" : "잠금"}
                    </button>
                  )}
                </div>

                {/* 멤버 품목 리스트 */}
                <ul className="divide-y divide-slate-100">
                  {g.items.map(it => (
                    <li key={it.orderId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="flex-1 font-medium text-slate-900">{it.productName}</span>
                      <span className="font-mono text-xs text-slate-500">{it.productCode}</span>
                      <span className="font-mono text-xs text-slate-400">{it.batchNo}</span>
                      <span className="w-24 text-right text-xs text-slate-500">{it.packagingDate ?? "-"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
