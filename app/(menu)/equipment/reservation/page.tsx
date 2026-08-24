"use client"

import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { Plus, Trash2, Loader2, CheckCircle2, Ban } from "lucide-react"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { DateField } from "@frontend/components/ui/date-field"
import { Tag } from "@frontend/components/ui/tag"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import { TesterAvatar } from "@frontend/lib/tester-profiles"
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from "@frontend/components/ui/table-sort"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"

// ─── Types ──────────────────────────────────────────────────────────────────
type ReservationStatus = "RESERVED" | "WAITING" | "CANCELLED" | "COMPLETED"

interface ReservationRow {
  id: string
  equipmentId: string
  userId: string
  userName: string | null
  startDate: string
  endDate: string
  status: ReservationStatus
  waitOrder: number | null
  createdAt: string
}

const STATUS_LABEL: Record<ReservationStatus, string> = {
  RESERVED: "예약", WAITING: "대기", CANCELLED: "취소", COMPLETED: "완료",
}
/* COMPLETED 만 초록으로 남긴다 - 여기 초록은 '완료' 라는 뜻이고,
   파랑으로 바꾸면 같은 팔레트의 RESERVED(파랑)와 겹쳐 예약과 완료를 못 가른다.
   색이 곧 뜻인 팔레트라 베이스 색 규칙의 예외다. */
const STATUS_TAG_COLOR: Record<ReservationStatus, "blue" | "yellow" | "red" | "green"> = {
  RESERVED:  "blue",
  WAITING:   "yellow",
  CANCELLED: "red",
  COMPLETED: "green",
}

type SortField = "status" | "equipmentId" | "startDate" | "endDate" | "userName"

const SORT_COLUMNS: SortColumnDef<SortField>[] = [
  sortCol("status", "상태"),
  sortCol("equipmentId", "장비"),
  {
    key: "period",
    label: "기간",
    fields: [
      { id: "startDate", label: "시작일" },
      { id: "endDate", label: "종료일" },
    ],
  },
  sortCol("userName", "예약자"),
]

// ─── Component ────────────────────────────────────────────────────────────────
export default function EquipmentReservationPage() {
  const uid = useId()
  const { user } = useAuth()
  const { requestConfirm } = useConfirmMessage()
  const isAdmin = user?.role === "admin"

  const [rows, setRows] = useState<ReservationRow[]>([])
  const [equipmentIds, setEquipmentIds] = useState<string[]>([])
  const [filterEquipment, setFilterEquipment] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [detailTarget, setDetailTarget] = useState<ReservationRow | null>(null)
  const [sortField, setSortField] = useState<SortField>("startDate")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const pickSort = (field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }

  const sortedData = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp = 0
      if (sortField === "status") {
        cmp = (STATUS_LABEL[a.status] ?? a.status).localeCompare(STATUS_LABEL[b.status], "ko")
      } else if (sortField === "equipmentId") {
        cmp = a.equipmentId.localeCompare(b.equipmentId, "ko")
      } else if (sortField === "startDate" || sortField === "endDate") {
        cmp = a[sortField].localeCompare(b[sortField], "ko")
      } else if (sortField === "userName") {
        cmp = (a.userName ?? "").localeCompare(b.userName ?? "", "ko")
      }
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [rows, sortField, sortDir])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 3500) }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = filterEquipment.trim() ? `?equipmentId=${encodeURIComponent(filterEquipment.trim())}` : ""
      const res = await fetch(`/api/equipment-reservation${qs}`, { credentials: "include" })
      const data = await res.json()
      setRows(data.rows ?? [])
      // 화면 datalist 용 장비 목록(현재 목록에서 distinct)
      const ids = new Set<string>(equipmentIds)
      for (const r of (data.rows ?? []) as ReservationRow[]) ids.add(r.equipmentId)
      setEquipmentIds([...ids].sort())
    } finally { setLoading(false) }
  }, [filterEquipment]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load() }, [load])

  const cancel = async (id: string) => {
    const target = rows.find(row => row.id === id)
    const confirmed = await requestConfirm({
      title: "장비 예약을 취소할까요?",
      description: target
        ? `${target.equipmentId} 장비의 ${target.startDate} ~ ${target.endDate} 예약을 취소합니다.`
        : "선택한 장비 예약을 취소합니다.",
      confirmLabel: "예약 취소",
      variant: "warning",
    })
    if (!confirmed) return

    setBusy(id)
    try {
      const res = await fetch(`/api/equipment-reservation/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      })
      if (!res.ok) { const d = await res.json(); flash(d.error ?? "취소 실패"); return }
      flash("취소되었습니다.")
      await load()
    } finally { setBusy(null) }
  }

  const complete = async (id: string) => {
    setBusy(id)
    try {
      const res = await fetch(`/api/equipment-reservation/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      })
      if (!res.ok) { const d = await res.json(); flash(d.error ?? "처리 실패"); return }
      flash("완료 처리되었습니다.")
      await load()
    } finally { setBusy(null) }
  }

  const remove = async (id: string) => {
    const target = rows.find(row => row.id === id)
    const confirmed = await requestConfirm({
      title: "장비 예약을 삭제할까요?",
      description: target
        ? `${target.equipmentId} 장비의 ${target.startDate} ~ ${target.endDate} 예약 기록을 삭제합니다.`
        : "선택한 장비 예약 기록을 삭제합니다.",
      confirmLabel: "예약 삭제",
      variant: "danger",
    })
    if (!confirmed) return

    setBusy(id)
    try {
      const res = await fetch(`/api/equipment-reservation/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) { const d = await res.json(); flash(d.error ?? "삭제 실패"); return }
      flash("삭제되었습니다.")
      setRows(prev => prev.filter(row => row.id !== id))
    } finally { setBusy(null) }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      {/* Header — 제목 옆의 건수 배지는 표 머리에서 다시 세므로 뺐다.
          그 자리에 이 화면의 규칙(선착순·대기열)을 한 줄로 남긴다. */}
      <header className="flex min-w-0 shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold text-foreground">장비 예약</h1>
          <p className="text-xs leading-normal break-keep text-muted-foreground">
            선착순 예약 · 기간이 겹치면 대기열로 등록됩니다
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus /> 예약 등록
        </Button>
      </header>

      {msg && (
        <div className="shrink-0 rounded-md border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm font-medium break-keep text-foreground">
          {msg}
        </div>
      )}

      {/* Filter */}
      <div className="flex shrink-0 flex-wrap items-end gap-2">
        {/* 모바일에서는 필터 입력이 한 줄을 꽉 채운다 */}
        <div className="w-full sm:w-auto sm:min-w-48">
          <label htmlFor={`${uid}-filter`} className="mb-1 block text-xs font-medium text-muted-foreground">장비 필터</label>
          <input
            id={`${uid}-filter`}
            list="equipment-ids-filter"
            value={filterEquipment}
            onChange={e => setFilterEquipment(e.target.value)}
            placeholder="장비 선택 또는 입력"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          />
          <datalist id="equipment-ids-filter">
            {equipmentIds.map(id => <option key={id} value={id} />)}
          </datalist>
        </div>
        {filterEquipment && (
          <Button variant="outline" onClick={() => setFilterEquipment("")}>
            전체
          </Button>
        )}
      </div>

      {/* List */}
      <Card className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">
            예약 목록
            {!loading && (
              <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{sortedData.length}건</span>
            )}
          </h2>
          {filterEquipment.trim() && (
            <span className="text-xs leading-normal break-keep text-muted-foreground">
              장비 필터 <span className="font-medium text-foreground">{filterEquipment.trim()}</span>
            </span>
          )}
        </div>

        {/* ── 모바일: 표 대신 카드 목록 ──────────────────────────────────────
            5칸짜리 표는 320px 에 들어가지 않는다. 장비·상태·기간·예약자만 남긴다. */}
        <div className="min-h-0 flex-1 divide-y overflow-y-auto md:hidden">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 px-4 py-3">
                  <Skeleton className="h-4 w-2/3" />
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              ))
            : rows.length === 0
              ? <p className="px-4 py-10 text-center text-sm break-keep text-muted-foreground">등록된 예약이 없습니다.</p>
              : sortedData.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setDetailTarget(r)}
                    className="block w-full px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{r.equipmentId}</p>
                      <Tag color={STATUS_TAG_COLOR[r.status]} dot={r.status === "RESERVED" || r.status === "WAITING"}>
                        {STATUS_LABEL[r.status]}
                        {r.status === "WAITING" && r.waitOrder != null && ` #${r.waitOrder}`}
                      </Tag>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-xs leading-normal text-muted-foreground">
                      <span className="shrink-0 font-mono tabular-nums">{r.startDate} ~ {r.endDate}</span>
                      <span className="ml-auto inline-flex min-w-0 items-center gap-1.5">
                        <TesterAvatar name={r.userName} size="sm" />
                        <span className="min-w-0 truncate">{r.userName ?? "이름없음"}</span>
                      </span>
                    </div>
                  </button>
                ))}
        </div>

        {/* ── 데스크톱: 표 ─────────────────────────────────────────────── */}
        <div className="hidden min-h-0 flex-1 md:flex md:flex-col">
        <Table>
          {/* 논리 열 4개(상태·장비·기간·예약자) + 2필드 묶음 1개(기간) → 최대 5칸.
              table-fixed 에서 <col> 이 모자라면 늘어난 칸이 폭 0으로 접혀 사라진다.
              칸 순서(펼침 / 합침): 상태 · 장비 · 시작일/기간 · 종료일/예약자 · 예약자 */}
          <colgroup>
            <col className="w-[12%]" />
            <col className="w-[24%]" />
            <col className="w-[20%]" />
            <col className="w-[20%]" />
            <col className="w-[18%]" />
          </colgroup>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {SORT_COLUMNS.map((col) => (
                <TableHead key={col.key} className="px-3 py-2">
                  <SortColumnHeader
                    col={col}
                    sortField={sortField}
                    sortDir={sortDir}
                    onPick={pickSort}
                  />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="px-3 py-2"><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-8 w-28" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-8 w-24" /></TableCell>
                  <TableCell className="px-3 py-2"><Skeleton className="h-4 w-16" /></TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="py-16 text-center text-sm text-muted-foreground">
                  등록된 예약이 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map(r => {
                return (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setDetailTarget(r)}
                  >
                    <TableCell className="px-3 py-2">
                      <Tag color={STATUS_TAG_COLOR[r.status]} dot={r.status === "RESERVED" || r.status === "WAITING"}>
                        {STATUS_LABEL[r.status]}
                        {r.status === "WAITING" && r.waitOrder != null && ` #${r.waitOrder}`}
                      </Tag>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <CellStack
                        primary={r.equipmentId}
                        primaryClass="font-medium text-foreground"
                        title={r.equipmentId}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <CellStack
                        primary={r.startDate}
                        secondary={`~ ${r.endDate}`}
                        primaryClass="font-mono text-xs text-foreground"
                        title={`${r.startDate} ~ ${r.endDate}`}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      {/* 아바타는 primary 안에 둔다 — CellStack 루트는 @container라 고유 폭이 0이라
                          flex 형제로 두면 폭이 접혀 이름이 잘린다. */}
                      <CellStack
                        primary={
                          <span className="flex min-w-0 items-center gap-2">
                            <TesterAvatar name={r.userName} size="sm" />
                            <span className="truncate">{r.userName ?? "이름없음"}</span>
                          </span>
                        }
                        title={r.userName ?? "이름없음"}
                      />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
        </div>
      </Card>

      {showAdd && (
      <AddModal
        open
        equipmentIds={equipmentIds}
        onClose={() => setShowAdd(false)}
        onSaved={(status) => {
          setShowAdd(false)
          void load()
          flash(status === "WAITING" ? "대기열에 등록되었습니다." : "예약되었습니다.")
        }}
        onError={flash}
      />
      )}

      {detailTarget && (
        <ManagementDrawer
          open
          onOpenChange={(next) => { if (!next) setDetailTarget(null) }}
          size="sm"
          title="장비 예약 상세"
          description="예약 상태와 기간을 확인하고 가능한 작업을 선택합니다."
          footer={(
            <>
              <Button variant="outline" onClick={() => setDetailTarget(null)}>닫기</Button>
              {((isAdmin || detailTarget.userId === user?.id) && detailTarget.status === "RESERVED") && (
                <Button
                  variant="outline"
                  /* 완료·승인은 이 프로젝트에서 짙은 파랑이다(승인완료=blue-800) */
                  className="text-blue-700"
                  onClick={() => { setDetailTarget(null); void complete(detailTarget.id) }}
                  disabled={busy === detailTarget.id}
                >
                  <CheckCircle2 /> 완료 처리
                </Button>
              )}
              {((isAdmin || detailTarget.userId === user?.id) && (detailTarget.status === "RESERVED" || detailTarget.status === "WAITING")) && (
                <Button
                  variant="outline"
                  onClick={() => { setDetailTarget(null); void cancel(detailTarget.id) }}
                  disabled={busy === detailTarget.id}
                >
                  <Ban /> 예약 취소
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="ghost"
                  className="mr-auto text-destructive hover:text-destructive"
                  onClick={() => { setDetailTarget(null); void remove(detailTarget.id) }}
                  disabled={busy === detailTarget.id}
                >
                  {busy === detailTarget.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                  삭제
                </Button>
              )}
            </>
          )}
        >
          {/* 테두리 가진 상자를 둘 겹치지 않는다 — 상태까지 한 표에 넣고 실선으로 나눈다 */}
          <dl className="divide-y rounded-md border px-4 text-sm">
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="text-muted-foreground">상태</dt>
              <dd>
                <Tag color={STATUS_TAG_COLOR[detailTarget.status]} dot={detailTarget.status === "RESERVED" || detailTarget.status === "WAITING"}>
                  {STATUS_LABEL[detailTarget.status]}
                </Tag>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-muted-foreground">장비</dt>
              <dd className="min-w-0 truncate font-medium text-foreground">{detailTarget.equipmentId}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-muted-foreground">예약자</dt>
              <dd className="min-w-0 truncate font-medium text-foreground">{detailTarget.userName ?? "이름없음"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-muted-foreground">기간</dt>
              <dd className="font-mono text-xs tabular-nums text-foreground">{detailTarget.startDate} ~ {detailTarget.endDate}</dd>
            </div>
            {detailTarget.waitOrder != null && (
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="shrink-0 text-muted-foreground">대기 순번</dt>
                <dd className="font-semibold tabular-nums text-foreground">#{detailTarget.waitOrder}</dd>
              </div>
            )}
          </dl>
        </ManagementDrawer>
      )}
    </div>
  )
}

// ─── 등록 모달 ────────────────────────────────────────────────────────────────
function AddModal({
  open, equipmentIds, onClose, onSaved, onError,
}: {
  open: boolean
  equipmentIds: string[]
  onClose: () => void
  onSaved: (status: ReservationStatus) => void
  onError: (m: string) => void
}) {
  const uid = useId()
  const [equipmentId, setEquipmentId] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!equipmentId.trim()) { onError("장비를 입력하세요."); return }
    if (!startDate || !endDate) { onError("시작일과 종료일을 입력하세요."); return }
    if (endDate < startDate) { onError("종료일은 시작일 이후여야 합니다."); return }
    setSaving(true)
    try {
      const res = await fetch("/api/equipment-reservation", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipmentId: equipmentId.trim(), startDate, endDate }),
      })
      if (!res.ok) { const d = await res.json(); onError(d.error ?? "등록 실패"); return }
      const d = await res.json()
      onSaved((d.row?.status as ReservationStatus) ?? "RESERVED")
    } finally { setSaving(false) }
  }

  return (
    <ManagementDrawer
      open={open}
      onOpenChange={(next) => { if (!next && !saving) onClose() }}
      size="md"
      title="장비 예약 등록"
      description="장비와 기간을 지정해 예약합니다. 기간이 겹치면 대기로 등록됩니다."
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} 등록
          </Button>
        </>
      )}
    >
        <div className="grid gap-3">
          <div>
            <label htmlFor={`${uid}-equipment`} className="mb-1 block text-xs font-medium text-muted-foreground">장비</label>
            <input
              id={`${uid}-equipment`}
              list="equipment-ids-add"
              value={equipmentId}
              onChange={e => setEquipmentId(e.target.value)}
              placeholder="장비 선택 또는 입력"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            />
            <datalist id="equipment-ids-add">
              {equipmentIds.map(id => <option key={id} value={id} />)}
            </datalist>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateField label="시작일" value={startDate} onChange={setStartDate} />
            <DateField label="종료일" value={endDate} onChange={setEndDate} />
          </div>

          <p className="text-xs leading-normal text-muted-foreground">
            같은 장비에 기간이 겹치는 예약이 있으면 대기(WAITING)로 등록됩니다.
          </p>
        </div>
    </ManagementDrawer>
  )
}
