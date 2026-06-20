"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import {
  Plus, Pencil, Trash2, X, Loader2, Search, Wand2, Layers, AlertCircle,
} from "lucide-react"
import { cn } from "@frontend/lib/utils"
import { useLockBodyScroll } from "@frontend/hooks/use-lock-body-scroll"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Badge } from "@frontend/components/ui/badge"

// ─── Types ──────────────────────────────────────────────────────────────────
interface FamilyMember { productCode: string; productName: string | null }
interface FamilyRow { id: string; name: string; note: string | null; members: FamilyMember[] }
interface ProductOpt { productCode: string; name: string }

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ConcurrentItemsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const [rows, setRows] = useState<FamilyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [editTarget, setEditTarget] = useState<FamilyRow | "new" | null>(null)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/concurrent-product-families", { credentials: "include" })
      const data = await res.json()
      setRows(data.rows ?? [])
    } catch {
      setMsg("목록을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const runSeed = async () => {
    setBusy("seed")
    try {
      const res = await fetch("/api/concurrent-product-families?seed=1", { method: "POST", credentials: "include" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash(`현재 데이터에서 자동 생성 완료 — 품목군 ${data.created}개 · 묶인 품목 ${data.grouped}건`)
      await load()
    } catch (e) {
      flash(`자동 생성 실패: ${e instanceof Error ? e.message : ""}`)
    } finally { setBusy(null) }
  }

  const remove = async (f: FamilyRow) => {
    if (!confirm(`"${f.name}" 품목군을 삭제할까요?`)) return
    setBusy(`del-${f.id}`)
    try {
      const res = await fetch(`/api/concurrent-product-families/${f.id}`, { method: "DELETE", credentials: "include" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash("삭제되었습니다.")
      await load()
    } catch (e) {
      flash(`삭제 실패: ${e instanceof Error ? e.message : ""}`)
    } finally { setBusy(null) }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.members.some(m => m.productCode.toLowerCase().includes(q) || (m.productName ?? "").toLowerCase().includes(q)),
    )
  }, [rows, search])

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">동시분석 품목</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            동시에 시험할 품목을 묶어 관리합니다. 묶인 품목은 오더 적재·자동배정 시 한 명의 담당자에게 함께 배정됩니다.
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="lg" onClick={runSeed} disabled={busy !== null}>
              {busy === "seed" ? <Loader2 className="animate-spin" /> : <Wand2 />}
              현재 데이터로 자동 생성
            </Button>
            <Button size="lg" onClick={() => setEditTarget("new")} disabled={busy !== null}>
              <Plus />새 품목군
            </Button>
          </div>
        )}
      </div>

      {msg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">{msg}</div>
      )}

      {/* 검색 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground tabular-nums">
          {search.trim() ? `검색 ${filtered.length}개` : `총 ${rows.length}개 품목군`}
        </span>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="품목군·품목명·코드 검색"
            className="h-9 w-56 rounded-lg border border-input bg-background pl-8 pr-7 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} title="검색어 지우기"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 목록 */}
      {loading ? (
        <Card className="items-center py-10 text-center text-sm text-muted-foreground">불러오는 중…</Card>
      ) : rows.length === 0 ? (
        <Card className="items-center gap-3 py-12 text-center">
          <Layers className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">등록된 동시분석 품목군이 없습니다.</p>
          {isAdmin && (
            <p className="text-xs text-muted-foreground">
              &quot;현재 데이터로 자동 생성&quot;으로 유사 품목을 한 번에 묶거나, &quot;새 품목군&quot;으로 직접 추가하세요.
            </p>
          )}
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="items-center py-10 text-center text-sm text-muted-foreground">
          &quot;{search.trim()}&quot; 검색 결과가 없습니다.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map(f => (
            <Card key={f.id} className="gap-0 py-0">
              <div className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Layers className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{f.name}</span>
                    <Badge variant="secondary" className="shrink-0">{f.members.length}개 품목</Badge>
                  </div>
                  {f.note && <p className="mt-0.5 truncate text-xs text-muted-foreground">{f.note}</p>}
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => setEditTarget(f)} title="수정" className="text-muted-foreground">
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(f)} disabled={busy === `del-${f.id}`} title="삭제"
                      className="text-muted-foreground hover:text-destructive">
                      {busy === `del-${f.id}` ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 border-t px-4 py-3">
                {f.members.map(m => (
                  <span key={m.productCode} className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs">
                    <span className="font-mono text-[11px] text-muted-foreground">{m.productCode}</span>
                    <span className="text-foreground">{m.productName ?? "-"}</span>
                  </span>
                ))}
                {f.members.length === 0 && <span className="text-xs text-muted-foreground">멤버 없음</span>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editTarget && (
        <FamilyModal
          family={editTarget === "new" ? null : editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); flash("저장되었습니다."); void load() }}
        />
      )}
    </div>
  )
}

// ─── 추가/수정 모달 ───────────────────────────────────────────────────────────
function FamilyModal({ family, onClose, onSaved }: {
  family: FamilyRow | null; onClose: () => void; onSaved: () => void
}) {
  useLockBodyScroll()
  const [name, setName] = useState(family?.name ?? "")
  const [note, setNote] = useState(family?.note ?? "")
  const [members, setMembers] = useState<FamilyMember[]>(family?.members ?? [])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 품목 검색
  const [pq, setPq] = useState("")
  const [results, setResults] = useState<ProductOpt[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const q = pq.trim()
    if (!q) { setResults([]); return }
    let cancel = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(q)}&limit=20`, { credentials: "include" })
        const data = await res.json()
        if (!cancel) setResults((data.rows ?? []).map((r: { productCode: string; name: string }) => ({ productCode: r.productCode, name: r.name })))
      } finally {
        if (!cancel) setSearching(false)
      }
    }, 250)
    return () => { cancel = true; clearTimeout(t) }
  }, [pq])

  const codes = useMemo(() => new Set(members.map(m => m.productCode)), [members])
  const addMember = (p: ProductOpt) => {
    if (codes.has(p.productCode)) return
    setMembers(prev => [...prev, { productCode: p.productCode, productName: p.name }])
  }
  const removeMember = (code: string) => setMembers(prev => prev.filter(m => m.productCode !== code))

  const save = async () => {
    if (!name.trim()) { setErr("품목군 이름은 필수입니다."); return }
    if (members.length < 2) { setErr("동시분석 품목군은 2개 이상의 품목으로 구성해야 합니다."); return }
    setSaving(true); setErr(null)
    try {
      const body = JSON.stringify({ name, note: note || null, codes: members.map(m => m.productCode) })
      const res = family
        ? await fetch(`/api/concurrent-product-families/${family.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body })
        : await fetch(`/api/concurrent-product-families`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패")
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-xl border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-bold text-foreground">{family ? "동시분석 품목군 수정" : "새 동시분석 품목군"}</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">품목군 이름 <span className="text-red-500">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="예: 네비레트엠 계열" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">비고</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="(선택)" className={inputCls} />
          </div>

          {/* 선택된 멤버 */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">묶을 품목 <span className="text-muted-foreground">({members.length})</span></label>
            <div className="flex flex-wrap gap-1.5">
              {members.map(m => (
                <span key={m.productCode} className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 py-1 pl-2 pr-1 text-xs">
                  <span className="font-mono text-[11px] text-muted-foreground">{m.productCode}</span>
                  <span className="text-foreground">{m.productName ?? "-"}</span>
                  <button onClick={() => removeMember(m.productCode)} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {members.length === 0 && <span className="text-xs text-muted-foreground">아래에서 품목을 검색해 추가하세요.</span>}
            </div>
          </div>

          {/* 품목 검색 추가 */}
          <div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={pq} onChange={e => setPq(e.target.value)} placeholder="품목명·코드로 검색해 추가"
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none" />
            </div>
            {pq.trim() && (
              <div className="mt-1 max-h-44 overflow-y-auto rounded-md border">
                {searching ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">검색 중…</p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">검색 결과가 없습니다.</p>
                ) : results.map(p => (
                  <button key={p.productCode} onClick={() => addMember(p)} disabled={codes.has(p.productCode)}
                    className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50 disabled:opacity-40",
                      codes.has(p.productCode) && "cursor-default")}>
                    <span className="font-mono text-[11px] text-muted-foreground">{p.productCode}</span>
                    <span className="flex-1 truncate text-foreground">{p.name}</span>
                    {codes.has(p.productCode) ? <span className="text-[10px] text-muted-foreground">추가됨</span> : <Plus className="size-3.5 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {err && (
            <p className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              <AlertCircle className="size-3.5" />{err}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button variant="outline" size="lg" onClick={onClose}>취소</Button>
            <Button size="lg" onClick={save} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}저장
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputCls = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
