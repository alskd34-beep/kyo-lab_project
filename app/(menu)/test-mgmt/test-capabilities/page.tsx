"use client"

import { useCallback, useEffect, useId, useMemo, useState } from "react"
import {
  ArrowDown, ArrowUp, Grid2x2, Lock, Plus, Save, Search, Trash2, TriangleAlert,
} from "lucide-react"
import { cn } from "@frontend/lib/utils"
import { useAuth } from "@frontend/lib/auth-context"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import { Skeleton } from "@frontend/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"

// ─── Types (backend listCapabilityMaster 와 동일) ────────────────────────────
interface CapabilityMasterRow {
  id: string; code: string; name: string; sortOrder: number
  /** 이 역량에 숙련도가 기록된 시험자 수 */
  ratedCount: number
}

const API = "/api/tester-capabilities/master"

/** 수정 대상. "new" 면 추가 모드 */
type EditTarget = CapabilityMasterRow | "new" | null

interface FormState { code: string; name: string; sortOrder: string }
const EMPTY_FORM: FormState = { code: "", name: "", sortOrder: "" }

// ─── 페이지 ──────────────────────────────────────────────────────────────────
export default function TestCapabilitiesPage() {
  const uid = useId()
  const { user } = useAuth()
  const { requestConfirm } = useConfirmMessage()
  const isAdmin = user?.role === "admin"

  const [rows, setRows] = useState<CapabilityMasterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [target, setTarget] = useState<EditTarget>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  /** 순서를 바꾸는 동안 그 두 행의 화살표를 잠근다 */
  const [movingId, setMovingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(API, { credentials: "include" })
      const json = (await res.json()) as { rows?: CapabilityMasterRow[]; error?: string }
      if (!res.ok) throw new Error(json.error ?? "불러오기 실패")
      setRows(json.rows ?? [])
    } catch (e) {
      flash(e instanceof Error ? e.message : "불러오기 실패")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
  }, [rows, search])

  const ratedTotal = useMemo(() => rows.reduce((s, r) => s + r.ratedCount, 0), [rows])

  function openAdd() {
    setTarget("new")
    setForm(EMPTY_FORM)
    setError("")
  }

  function openEdit(row: CapabilityMasterRow) {
    setTarget(row)
    setForm({ code: row.code, name: row.name, sortOrder: String(row.sortOrder) })
    setError("")
  }

  async function handleSave() {
    if (target === null) return
    setSaving(true)
    setError("")
    try {
      const isNew = target === "new"
      // 코드는 만들 때만 보낸다 — 수정에서는 잠겨 있다(아래 Lock 필드 주석 참고)
      const body = isNew
        ? { code: form.code, name: form.name, sortOrder: form.sortOrder === "" ? undefined : Number(form.sortOrder) }
        : { name: form.name, sortOrder: form.sortOrder === "" ? undefined : Number(form.sortOrder) }
      const res = await fetch(isNew ? API : `${API}/${target.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) { setError(json.error ?? "저장 실패"); return }
      setTarget(null)
      flash(isNew ? "역량을 추가했습니다." : "저장했습니다.")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(row: CapabilityMasterRow) {
    const confirmed = await requestConfirm({
      title: "이 역량을 삭제할까요?",
      description: row.ratedCount > 0
        ? `"${row.name}" 컬럼이 역량 매트릭스에서 사라지고, 여기 매겨 둔 시험자 숙련도 ${row.ratedCount}건도 함께 삭제됩니다. 되돌릴 수 없습니다.`
        : `"${row.name}" 컬럼이 역량 매트릭스에서 사라집니다. 되돌릴 수 없습니다.`,
      confirmLabel: "삭제",
      variant: "danger",
    })
    if (!confirmed) return

    setSaving(true)
    try {
      // 건수를 위 확인창에서 이미 보여줬으므로 force 로 cascade 삭제를 허용한다
      const res = await fetch(`${API}/${row.id}?force=1`, { method: "DELETE", credentials: "include" })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) { flash(json.error ?? "삭제 실패"); return }
      setTarget(null)
      flash("삭제했습니다.")
      await load()
    } finally {
      setSaving(false)
    }
  }

  /**
   * 위/아래 이동 — 이웃과 sortOrder 값을 맞바꾼다.
   * 정렬 기준이 sort_order 라서 값만 교환하면 화면 순서가 그대로 뒤집힌다.
   * (검색으로 걸러진 목록이 아니라 전체 목록 기준으로 이웃을 찾아야 순서가 어긋나지 않는다)
   */
  async function move(row: CapabilityMasterRow, dir: -1 | 1) {
    const idx = rows.findIndex(r => r.id === row.id)
    const neighbor = rows[idx + dir]
    if (!neighbor) return
    setMovingId(row.id)
    try {
      const results = await Promise.all([
        fetch(`${API}/${row.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ sortOrder: neighbor.sortOrder }),
        }),
        fetch(`${API}/${neighbor.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ sortOrder: row.sortOrder }),
        }),
      ])
      if (results.some(r => !r.ok)) flash("순서 변경에 실패했습니다.")
      await load()
    } finally {
      setMovingId(null)
    }
  }

  const isNew = target === "new"
  const selected = target !== null && target !== "new" ? target : null

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
      {/* 헤더 */}
      <div className="flex shrink-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
        {/* 제목 text-lg · 부가정보 text-xs — 다른 화면과 같은 위계로 맞춘다.
            break-keep: 한글은 단어 중간에서 끊으면 안 읽힌다 */}
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Grid2x2 className="size-5 text-muted-foreground" />시험 역량 마스터
          </h1>
          <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">
            여기 등록한 항목이 <span className="font-medium text-foreground">시험자 역량</span> 매트릭스의 컬럼이 됩니다.
            표시 순서대로 왼쪽부터 열이 놓입니다.
          </p>
        </div>
        {isAdmin && (
          <Button size="lg" onClick={openAdd} className="shrink-0">
            <Plus />역량 추가
          </Button>
        )}
      </div>

      {/* 자동배정이 이 값을 키로 쓴다 — 이름만 바꾸는 화면이 아니라는 걸 먼저 알린다 */}
      <Card className="shrink-0 flex-row items-start gap-2 border-amber-200 bg-amber-50 px-4 py-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <p className="text-xs leading-5 break-keep text-amber-800">
          코드와 역량명은 <span className="font-medium">AI 자동배정</span>이 오더의 필요장비(required_equipment)를
          역량에 연결할 때 쓰는 키입니다. 이름을 바꾸면 매칭 결과가 달라질 수 있으니
          기존 항목의 이름은 신중히 수정하세요. 코드는 등록 후 변경할 수 없습니다.
        </p>
      </Card>

      {notice && (
        <div className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">
          {notice}
        </div>
      )}

      {/* 검색 + 요약 */}
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
        <Badge variant="secondary" className="w-fit tabular-nums">역량 {rows.length}개</Badge>
        <Badge variant="outline" className="w-fit tabular-nums text-muted-foreground">
          평가 기록 {ratedTotal}건
        </Badge>
        <div className="relative w-full sm:ml-auto sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="역량명, 코드 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9"
          />
        </div>
      </div>

      {/* 모바일 카드
          flex-1 + 자식 shrink-0: Card 는 overflow-hidden 이라 세로 스크롤 열 안에서
          min-height 가 0 이 된다. 목록이 길어지면 flex 가 카드를 선 하나로 눌러 버린다. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto md:hidden">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="shrink-0 gap-2 px-3 py-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
              </Card>
            ))
          : filtered.length === 0
            ? <Card className="shrink-0 items-center py-10 text-center text-sm text-muted-foreground">
                {rows.length === 0 ? "등록된 역량이 없습니다." : "조건에 맞는 역량이 없습니다."}
              </Card>
            : filtered.map((row) => (
                <Card
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEdit(row)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEdit(row) } }}
                  className="shrink-0 cursor-pointer gap-1 px-3 py-3 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{row.name}</span>
                    <Badge variant="secondary" className="shrink-0 tabular-nums">{row.ratedCount}명</Badge>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">{row.code}</p>
                </Card>
              ))}
      </div>

      {/* 데스크톱 표 */}
      <Card className="hidden min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0 md:flex">
        <Table className="w-full">
          <colgroup>
            <col className="w-[8%]" />
            <col className="w-[38%]" />
            <col className="w-[22%]" />
            <col className="w-[16%]" />
            <col className="w-[16%]" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-3 text-muted-foreground">순번</TableHead>
              <TableHead className="px-3 text-muted-foreground">역량명</TableHead>
              <TableHead className="px-3 text-muted-foreground">코드</TableHead>
              <TableHead className="px-3 text-muted-foreground">평가 기록</TableHead>
              <TableHead className="px-3 text-center text-muted-foreground">순서</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-8" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="mx-auto h-6 w-16" /></TableCell>
                  </TableRow>
                ))
              : filtered.map((row) => {
                  const idx = rows.findIndex(r => r.id === row.id)
                  const busy = movingId !== null
                  return (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => openEdit(row)}
                    >
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">
                        {idx + 1}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 font-medium text-foreground">{row.name}</TableCell>
                      <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                        {row.code}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">
                        {row.ratedCount > 0 ? `${row.ratedCount}명 평가됨` : "—"}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-center">
                        {isAdmin && (
                          <span className="inline-flex items-center gap-0.5">
                            <Button
                              variant="ghost" size="icon-sm"
                              disabled={busy || idx === 0}
                              title="위로"
                              onClick={(e) => { e.stopPropagation(); void move(row, -1) }}
                            >
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon-sm"
                              disabled={busy || idx === rows.length - 1}
                              title="아래로"
                              onClick={(e) => { e.stopPropagation(); void move(row, 1) }}
                            >
                              <ArrowDown className="size-3.5" />
                            </Button>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
            {!loading && filtered.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-16 text-center text-sm text-muted-foreground">
                  {rows.length === 0 ? "등록된 역량이 없습니다. ‘역량 추가’로 첫 항목을 만드세요."
                    : "조건에 맞는 역량이 없습니다."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* 추가 · 수정 */}
      <ManagementDrawer
        open={target !== null}
        onOpenChange={(o) => { if (!o) setTarget(null) }}
        size="sm"
        title={isNew ? "역량 추가" : "역량 수정"}
        description={isNew
          ? "시험자 역량 매트릭스에 새 컬럼을 만듭니다."
          : "역량명과 표시 순서를 변경합니다."}
        footer={
          <>
            {selected && isAdmin && (
              <Button
                variant="ghost"
                onClick={() => void handleDelete(selected)}
                disabled={saving}
                className="mr-auto text-destructive hover:text-destructive"
              >
                <Trash2 />삭제
              </Button>
            )}
            <Button variant="outline" onClick={() => setTarget(null)}>취소</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !isAdmin}>
              <Save />{saving ? "저장 중..." : isNew ? "추가" : "저장"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <section className="rounded-md border bg-card p-4 shadow-sm">
            <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">기본 정보</h3>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${uid}-name`} className="text-xs font-medium text-foreground">
                  역량명
                </label>
                <Input
                  id={`${uid}-name`}
                  value={form.name}
                  onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="예: HPLC, 용출, 성상"
                  disabled={!isAdmin}
                />
                <p className="text-xs leading-normal text-muted-foreground">
                  매트릭스 컬럼 머리글에 그대로 표시됩니다.
                </p>
              </div>

              {isNew ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${uid}-code`} className="text-xs font-medium text-foreground">
                    코드
                  </label>
                  <Input
                    id={`${uid}-code`}
                    value={form.code}
                    onChange={(e) => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                    placeholder="예: HPLC, UV_VIS"
                    className="font-mono"
                  />
                  <p className="text-xs leading-normal text-muted-foreground">
                    영문 대문자·숫자·밑줄(_)만. 등록 후에는 바꿀 수 없습니다.
                  </p>
                </div>
              ) : (
                /* 코드는 자동배정 매칭 키(scheduleEngine 의 별칭 표까지 코드로 적혀 있다)라
                   나중에 바꾸면 매칭이 조용히 깨진다. 수정 화면에서는 잠근다. */
                <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2.5">
                  <Lock size={13} className="shrink-0 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">코드</span>
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {selected?.code ?? "-"}
                  </span>
                  <span className="ml-auto text-xs leading-normal text-muted-foreground">변경 불가</span>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${uid}-sort`} className="text-xs font-medium text-foreground">
                  표시 순서
                </label>
                <Input
                  id={`${uid}-sort`}
                  type="number"
                  step={10}
                  value={form.sortOrder}
                  onChange={(e) => setForm(p => ({ ...p, sortOrder: e.target.value }))}
                  placeholder={isNew ? "비우면 맨 뒤에 놓입니다" : ""}
                  disabled={!isAdmin}
                />
                <p className="text-xs leading-normal text-muted-foreground">
                  작을수록 왼쪽. 목록의 ↑↓ 버튼으로도 바꿀 수 있습니다.
                </p>
              </div>
            </div>
          </section>

          {selected && (
            <section className="rounded-md border bg-card p-4 shadow-sm">
              <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">사용 현황</h3>
              <p className="text-sm text-foreground">
                {selected.ratedCount > 0
                  ? <>시험자 <span className="font-semibold tabular-nums">{selected.ratedCount}명</span>의 숙련도가 이 역량에 기록돼 있습니다.</>
                  : "아직 이 역량에 숙련도가 기록된 시험자가 없습니다."}
              </p>
              {selected.ratedCount > 0 && (
                <p className="mt-1 text-xs leading-normal text-muted-foreground">
                  삭제하면 이 기록도 함께 사라집니다.
                </p>
              )}
            </section>
          )}

          {error && (
            <div className={cn(
              "rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2",
              "text-sm font-medium text-destructive",
            )}>
              {error}
            </div>
          )}
        </div>
      </ManagementDrawer>
    </div>
  )
}
