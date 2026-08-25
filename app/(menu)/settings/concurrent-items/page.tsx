"use client"

import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import {
  Plus, Trash2, X, Loader2, Search, Sparkles, AlertCircle,
} from "lucide-react"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { cn } from "@frontend/lib/utils"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Badge } from "@frontend/components/ui/badge"
import { Input } from "@frontend/components/ui/input"
import { MobileFilterPanel } from "@frontend/components/common/mobile-filter-panel"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"

// ─── Types ──────────────────────────────────────────────────────────────────
interface FamilyMember { productCode: string; productName: string | null }
interface FamilyRow { id: string; name: string; note: string | null; members: FamilyMember[] }
interface ProductOpt { productCode: string; name: string }

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ConcurrentItemsPage() {
  const { user } = useAuth()
  const { requestConfirm } = useConfirmMessage()
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


  // LLM(Codex)으로 기존 군을 모두 지우고 재그룹핑
  const runSeedLLM = async () => {
    const confirmed = await requestConfirm({
      title: "AI로 품목군을 다시 그룹할까요?",
      description: "기존 동시분석 품목군을 모두 삭제한 뒤 LLM 기준으로 새로 생성합니다.",
      confirmLabel: "재그룹핑 시작",
      variant: "warning",
    })
    if (!confirmed) return

    setBusy("seed-llm")
    try {
      const res = await fetch("/api/concurrent-product-families?seed=llm", { method: "POST", credentials: "include" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const via = data.mode === "llm" ? "LLM" : "규칙엔진(LLM 미사용)"
      flash(`재그룹핑 완료(${via}) — 품목군 ${data.created}개 · 묶인 품목 ${data.grouped}건`)
      await load()
    } catch (e) {
      flash(`재그룹핑 실패: ${e instanceof Error ? e.message : ""}`)
    } finally { setBusy(null) }
  }

  const remove = async (f: FamilyRow) => {
    const confirmed = await requestConfirm({
      title: "품목군을 삭제할까요?",
      description: `"${f.name}" 품목군과 품목 연결 정보가 삭제되며 되돌릴 수 없습니다.`,
      confirmLabel: "품목군 삭제",
      variant: "danger",
    })
    if (!confirmed) return

    setBusy(`del-${f.id}`)
    try {
      const res = await fetch(`/api/concurrent-product-families/${f.id}`, { method: "DELETE", credentials: "include" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      flash("삭제되었습니다.")
      setRows(prev => prev.filter(row => row.id !== f.id))
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {/* ── 페이지 머리 ────────────────────────────────────────────────────
          "동시에 시험할 품목을 묶어 관리합니다"는 제목을 되풀이하는 문장이라 지웠다.
          남긴 한 줄은 이 화면 밖에서 벌어지는 일(적재·자동배정)이라 실제 정보다. */}
      <header className="flex min-w-0 shrink-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">동시분석 품목</h1>
          <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">
            묶인 품목은 오더 적재·자동배정 시 한 명의 담당자에게 함께 배정됩니다.
          </p>
        </div>
        {isAdmin && (
          /* 좁은 폭에선 두 버튼이 폭을 반씩 나눠 갖게 해 라벨이 두 줄로 접히지 않게 한다 */
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Button variant="outline" size="lg" onClick={runSeedLLM} disabled={busy !== null} className="min-w-0 flex-1 sm:flex-none">
              {busy === "seed-llm" ? <Loader2 className="animate-spin" /> : <Sparkles />}
              AI로 그룹핑
            </Button>
            <Button size="lg" onClick={() => setEditTarget("new")} disabled={busy !== null} className="min-w-0 flex-1 sm:flex-none">
              <Plus />새 품목군
            </Button>
          </div>
        )}
      </header>

      {msg && (
        <p className="shrink-0 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs break-keep text-primary">{msg}</p>
      )}

      {/* 조회 옵션 — 모바일에서는 접는다.
          건수 한 줄 + 검색창이 세로로 68px 을 잡아, 정작 봐야 할 품목군 카드를 화면 밖으로 밀어냈다.
          접힌 막대에 "지금 무엇을 보고 있는지"(검색어 · 건수)는 그대로 남긴다.
          sm(640px) 이상에서는 접기 자체가 없다 — 데스크톱은 지금 모습 그대로다. */}
      <MobileFilterPanel
        summary={`${search.trim() ? `검색 "${search.trim()}"` : "전체"} · ${search.trim() ? filtered.length : rows.length}개 품목군`}
      >

      {/* 검색 */}
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {search.trim() ? "검색" : "총"}{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {search.trim() ? filtered.length : rows.length}
          </span>
          개 품목군
        </span>
        {/* 좁은 폭에선 검색창이 한 줄을 통째로 쓴다 — w-56 고정이면 건수 옆에서 넘친다 */}
        <div className="relative w-full min-w-0 sm:ml-auto sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="품목군·품목명·코드 검색"
            className="w-full pr-7 pl-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              title="검색어 지우기"
              /* 모바일 터치 타깃 — 아이콘 크기가 아니라 눌리는 영역을 36px 로 잡는다 */
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      </MobileFilterPanel>

      {/* 목록 */}
      {loading ? (
        <div className="grid min-w-0 shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-0 py-0">
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-5 w-16 rounded-md" />
                  </div>
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5 border-t px-4 py-3">
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="shrink-0 py-10 text-center">
          <p className="text-sm text-muted-foreground">등록된 동시분석 품목군이 없습니다.</p>
          {isAdmin && (
            /* 안내가 실제 버튼 이름과 달랐다("현재 데이터로 자동 생성"이라는 버튼은 없다). */
            <p className="mt-1 text-xs break-keep text-muted-foreground">
              &quot;AI로 그룹핑&quot;으로 유사 품목을 한 번에 묶거나, &quot;새 품목군&quot;으로 직접 추가하세요.
            </p>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <p className="shrink-0 py-10 text-center text-sm break-keep text-muted-foreground">
          &quot;{search.trim()}&quot; 검색 결과가 없습니다.
        </p>
      ) : (
        <div className="grid min-w-0 shrink-0 grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map(f => (
            /* 관리자만 눌러서 수정할 수 있다 — 눌리는 카드에는 키보드 조작과 포커스 링도 함께 준다. */
            <Card
              key={f.id}
              className={cn(
                "min-w-0 gap-0 py-0",
                isAdmin && "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              )}
              role={isAdmin ? "button" : undefined}
              tabIndex={isAdmin ? 0 : undefined}
              onClick={isAdmin ? () => setEditTarget(f) : undefined}
              onKeyDown={isAdmin ? (e => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditTarget(f) }
              }) : undefined}
            >
              <div className="flex min-w-0 items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-foreground">{f.name}</span>
                    <Badge variant="secondary" className="shrink-0 tabular-nums">{f.members.length}개 품목</Badge>
                  </div>
                  {f.note && <p className="mt-0.5 truncate text-xs text-muted-foreground">{f.note}</p>}
                </div>
              </div>
              {/* 카드 안에 미니 카드를 또 깔지 않는다 — 테두리·배경을 뺀 행으로 나열한다. */}
              <ul className="flex min-w-0 flex-col gap-1 border-t px-4 py-3">
                {f.members.map(m => (
                  <li key={m.productCode} className="flex min-w-0 items-center gap-2 text-xs leading-normal">
                    <span className="shrink-0 font-mono text-xs leading-normal text-muted-foreground">{m.productCode}</span>
                    <span className="min-w-0 flex-1 truncate text-foreground">{m.productName ?? "-"}</span>
                  </li>
                ))}
                {f.members.length === 0 && <li className="text-xs leading-normal text-muted-foreground">멤버 없음</li>}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {editTarget && (
        <FamilyModal
          open
          family={editTarget === "new" ? null : editTarget}
          onClose={() => setEditTarget(null)}
          onDelete={editTarget !== "new" ? () => void remove(editTarget) : undefined}
          onSaved={() => { setEditTarget(null); flash("저장되었습니다."); void load() }}
        />
      )}
    </div>
  )
}

// ─── 추가/수정 모달 ───────────────────────────────────────────────────────────
function FamilyModal({ open, family, onClose, onDelete, onSaved }: {
  open: boolean; family: FamilyRow | null; onClose: () => void; onDelete?: () => void; onSaved: () => void
}) {
  const uid = useId()
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
    <ManagementDrawer
      open={open}
      onOpenChange={(next) => { if (!next && !saving) onClose() }}
      size="lg"
      title={family ? "동시분석 품목군 수정" : "새 동시분석 품목군"}
      description="같은 시험에 묶을 품목을 2개 이상 구성합니다."
      footer={(
        <>
          {family && onDelete && (
            <Button variant="ghost" className="mr-auto text-destructive hover:text-destructive" onClick={onDelete} disabled={saving}>
              <Trash2 /> 삭제
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}저장
          </Button>
        </>
      )}
    >
        <div className="grid gap-3">
          <div>
            <label htmlFor={`${uid}-name`} className="mb-1 block text-xs font-semibold text-foreground">품목군 이름 <span className="text-destructive">*</span></label>
            <Input id={`${uid}-name`} value={name} onChange={e => setName(e.target.value)} placeholder="예: 네비레트엠 계열" />
          </div>
          <div>
            <label htmlFor={`${uid}-note`} className="mb-1 block text-xs font-semibold text-foreground">비고</label>
            <Input id={`${uid}-note`} value={note} onChange={e => setNote(e.target.value)} placeholder="(선택)" />
          </div>

          {/* 선택된 멤버 */}
          <div>
            <span id={`${uid}-members-label`} className="mb-1 block text-xs font-semibold text-foreground">묶을 품목 <span className="text-muted-foreground">({members.length})</span></span>
            <div role="group" aria-labelledby={`${uid}-members-label`} className="flex flex-wrap gap-1.5">
              {members.map(m => (
                <span key={m.productCode} className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 py-1 pl-2 pr-1 text-xs">
                  <span className="font-mono text-xs leading-normal text-muted-foreground">{m.productCode}</span>
                  <span className="text-foreground">{m.productName ?? "-"}</span>
                  <button onClick={() => removeMember(m.productCode)} className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-destructive">
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
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={pq}
                onChange={e => setPq(e.target.value)}
                placeholder="품목명·코드로 검색해 추가"
                className="pl-8"
              />
            </div>
            {pq.trim() && (
              <div className="mt-1 max-h-44 overflow-y-auto rounded-md border">
                {searching ? (
                  /* "검색 중…" 글자 대신 결과 행 모양 그대로의 스켈레톤 — 화면이 튀지 않는다. */
                  <div className="flex flex-col gap-2 px-3 py-2">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3.5 w-1/2" />
                  </div>
                ) : results.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">검색 결과가 없습니다.</p>
                ) : results.map(p => (
                  <button key={p.productCode} onClick={() => addMember(p)} disabled={codes.has(p.productCode)}
                    className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50 disabled:opacity-40",
                      codes.has(p.productCode) && "cursor-default")}>
                    <span className="font-mono text-xs leading-normal text-muted-foreground">{p.productCode}</span>
                    <span className="flex-1 truncate text-foreground">{p.name}</span>
                    {codes.has(p.productCode) ? <span className="text-xs leading-normal text-muted-foreground">추가됨</span> : <Plus className="size-3.5 text-muted-foreground" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {err && (
            <p className="flex items-center gap-1.5 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="size-3.5" />{err}
            </p>
          )}
        </div>
    </ManagementDrawer>
  )
}
