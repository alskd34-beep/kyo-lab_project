"use client"

import { useCallback, useEffect, useId, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { ClipboardList, Plus, Trash2, Loader2 } from "lucide-react"
import { DateField } from "@frontend/components/ui/date-field"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Tag } from "@frontend/components/ui/tag"
import { Input } from "@frontend/components/ui/input"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from "@frontend/components/ui/table-sort"
import { StatusFilterTabs, type StatusFilterValue } from "@frontend/components/ui/status-filter-tabs"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"

// ─── Types ───────────────────────────────────────────────────────────────────

type EquipmentStatus = "active" | "calibrating" | "out_of_service"

interface EquipmentMasterRow {
  id: string
  code: string
  name: string
  category: string | null
  status: EquipmentStatus
  calibrationDate: string | null
  calibrationDueDate: string | null
  location: string | null
  note: string | null
  createdAt: string
  updatedAt: string | null
}

const STATUS_LABEL: Record<EquipmentStatus, string> = {
  active:          "사용 중",
  calibrating:     "검교정 중",
  out_of_service:  "사용 불가",
}

const STATUS_TAG_COLOR: Record<EquipmentStatus, "green" | "yellow" | "red"> = {
  active:         "green",
  calibrating:    "yellow",
  out_of_service: "red",
}

// ─── 검교정 만료 판정 ─────────────────────────────────────────────────────────

function getCalibrationUrgency(dueDate: string | null): "expired" | "soon" | "ok" | "none" {
  if (!dueDate) return "none"
  const today = new Date().toISOString().slice(0, 10)
  if (dueDate < today) return "expired"
  const soon = new Date()
  soon.setDate(soon.getDate() + 30)
  const soonStr = soon.toISOString().slice(0, 10)
  if (dueDate <= soonStr) return "soon"
  return "ok"
}

function calibrationDueLine(dueDate: string | null) {
  if (!dueDate) return "다음 미등록"
  const urgency = getCalibrationUrgency(dueDate)
  if (urgency === "expired") return <span className="text-red-600">다음 {dueDate} · 만료</span>
  if (urgency === "soon") return <span className="text-amber-600">다음 {dueDate} · 30일 이내</span>
  return `다음 ${dueDate}`
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

type SortField = "code" | "name" | "category" | "status" | "calibrationDate" | "calibrationDueDate" | "location"

const SORT_COLUMNS: SortColumnDef<SortField>[] = [
  {
    key: "equipment",
    label: "장비",
    fields: [
      { id: "name", label: "장비명" },
      { id: "code", label: "코드" },
    ],
  },
  {
    key: "class",
    label: "분류",
    fields: [
      { id: "category", label: "카테고리" },
      { id: "location", label: "위치" },
    ],
  },
  {
    key: "cal",
    label: "교정",
    fields: [
      { id: "calibrationDate", label: "최근 검교정" },
      { id: "calibrationDueDate", label: "차기 검교정" },
    ],
  },
  sortCol("status", "상태"),
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function EquipmentMasterPage() {
  const { user } = useAuth()
  const { requestConfirm } = useConfirmMessage()
  const isAdmin = user?.role === "admin"

  const [rows, setRows] = useState<EquipmentMasterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ text: string; type: "info" | "error" } | null>(null)

  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all")

  const [editTarget, setEditTarget] = useState<EquipmentMasterRow | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const pickSort = (field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }

  // 이 화면은 활성/비활성 boolean 대신 3단계 상태(active/calibrating/out_of_service)를 쓴다.
  // "활성" 필터·우선정렬 기준으로는 active 만 활성, 나머지 둘은 비활성으로 묶는다.
  const isRowActive = (row: EquipmentMasterRow) => row.status === "active"

  const statusCounts = useMemo(() => {
    const active = rows.filter(isRowActive).length
    return { all: rows.length, active, inactive: rows.length - active }
  }, [rows])

  const sortedRows = useMemo(() => {
    const filtered = statusFilter === "all"
      ? rows
      : rows.filter((row) => isRowActive(row) === (statusFilter === "active"))

    // 활성 장비를 항상 위로 올린다. "상태" 컬럼 정렬만 방향으로 그룹 순서를 뒤집는다.
    const activeRank = (row: EquipmentMasterRow) => (isRowActive(row) ? 0 : 1)
    const mul = sortDir === "asc" ? 1 : -1

    return [...filtered].sort((a, b) => {
      const groupDiff = activeRank(a) - activeRank(b)
      if (sortField === "status") {
        return groupDiff !== 0 ? groupDiff * mul : a.name.localeCompare(b.name, "ko")
      }
      if (groupDiff !== 0) return groupDiff

      const av = a[sortField] ?? ""
      const bv = b[sortField] ?? ""
      const cmp = av.localeCompare(bv, "ko") * mul
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name, "ko")
    })
  }, [rows, sortField, sortDir, statusFilter])

  const flash = (text: string, type: "info" | "error" = "info") => {
    setMsg({ text, type })
    setTimeout(() => setMsg(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/equipment-master", { credentials: "include" })
      const data = await res.json() as { rows?: EquipmentMasterRow[]; error?: string }
      if (!res.ok) { flash(data.error ?? "목록 로드 실패", "error"); return }
      setRows(data.rows ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const handleDelete = async (row: EquipmentMasterRow) => {
    const confirmed = await requestConfirm({
      title: "장비를 삭제할까요?",
      description: `${row.name}(${row.code}) 장비 정보를 삭제합니다. 연결된 예약이 있으면 삭제가 제한될 수 있습니다.`,
      confirmLabel: "장비 삭제",
      variant: "danger",
    })
    if (!confirmed) return

    try {
      const res = await fetch(`/api/equipment-master/${row.id}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) { const d = await res.json() as { error?: string }; flash(d.error ?? "삭제 실패", "error"); return }
      flash("삭제되었습니다.")
      setRows(prev => prev.filter(r => r.id !== row.id))
      setEditTarget(current => current?.id === row.id ? null : current)
    } catch {
      flash("삭제 실패", "error")
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ClipboardList size={18} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">장비 마스터</h1>
            <p className="text-sm text-muted-foreground">장비 등록·검교정 이력·가용성 관리</p>
          </div>
        </div>
        {isAdmin && (
          <Button size="lg" onClick={() => setShowAdd(true)}>
            <Plus /> 장비 등록
          </Button>
        )}
      </div>

      {/* 플래시 메시지 */}
      {msg && (
        <div className={`rounded-md border px-4 py-2.5 text-sm ${
          msg.type === "error"
            ? "border-red-200 bg-red-50 text-red-600"
            : "border-blue-200 bg-blue-50 text-blue-700"
        }`}>
          {msg.text}
        </div>
      )}

      {/* 테이블 */}
      <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <span className="text-sm font-semibold text-foreground">
            장비 목록 ({sortedRows.length}{sortedRows.length !== rows.length ? ` / ${rows.length}` : ""})
          </span>
          <StatusFilterTabs
            value={statusFilter}
            onChange={setStatusFilter}
            counts={statusCounts}
            activeLabel="사용 중"
            inactiveLabel="사용 중 아님"
          />
        </div>

        {rows.length === 0 && !loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">등록된 장비가 없습니다.</div>
        ) : sortedRows.length === 0 && !loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">조건에 맞는 장비가 없습니다.</div>
        ) : (
            <Table>
              {/* 논리 열 4개(장비·분류·교정·상태) + 2필드 묶음 3개 → 최대 7칸.
                  table-fixed 에서 <col> 이 모자라면 늘어난 칸이 폭 0으로 접혀 사라진다.
                  칸 순서(펼침 / 합침):
                  장비명/장비 · 코드/분류 · 카테고리/교정 · 위치/상태 · 최근검교정 · 차기검교정 · 상태 */}
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[12%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[15%]" />
                <col className="w-[15%]" />
                <col className="w-[12%]" />
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
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell className="px-3 py-2"><Skeleton className="h-8 w-28" /></TableCell>
                        <TableCell className="px-3 py-2"><Skeleton className="h-8 w-24" /></TableCell>
                        <TableCell className="px-3 py-2"><Skeleton className="h-8 w-24" /></TableCell>
                        <TableCell className="px-3 py-2"><Skeleton className="h-5 w-16 rounded-md" /></TableCell>
                      </TableRow>
                    ))
                  : sortedRows.map(row => {
                  const urgency = getCalibrationUrgency(row.calibrationDueDate)
                  const rowHighlight =
                    urgency === "expired" ? "bg-red-50/40" :
                    urgency === "soon"    ? "bg-amber-50/40" : ""
                  return (
                    <TableRow
                      key={row.id}
                      className={`${rowHighlight} ${isAdmin ? "cursor-pointer hover:bg-muted/40" : ""}`}
                      onClick={isAdmin ? () => setEditTarget(row) : undefined}
                    >
                      <TableCell className="px-3 py-2">
                        <CellStack
                          primary={row.name}
                          secondary={row.code}
                          secondaryLabel="코드"
                          primaryClass="font-medium text-foreground"
                          title={`${row.name} / ${row.code}`}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <CellStack
                          primary={row.category ?? "—"}
                          secondary={row.location ?? undefined}
                          secondaryLabel="위치"
                          title={[row.category, row.location].filter(Boolean).join(" / ")}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <CellStack
                          primary={row.calibrationDate ?? "—"}
                          secondary={calibrationDueLine(row.calibrationDueDate)}
                          secondaryLabel="차기 검교정"
                          primaryClass="font-mono text-xs text-foreground"
                          title={[row.calibrationDate, row.calibrationDueDate].filter(Boolean).join(" / ")}
                        />
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <Tag color={STATUS_TAG_COLOR[row.status]} dot={row.status === "calibrating"}>
                          {STATUS_LABEL[row.status]}
                        </Tag>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
        )}
      </Card>

      {(showAdd || editTarget) && (
        <EquipmentModal
          key={editTarget?.id ?? "add"}
          open
          mode={editTarget ? "edit" : "add"}
          initial={editTarget ?? undefined}
          onClose={() => {
            setShowAdd(false)
            setEditTarget(null)
          }}
           onSaved={() => {
            const wasEdit = !!editTarget
            setShowAdd(false)
            setEditTarget(null)
            flash(wasEdit ? "수정되었습니다." : "장비가 등록되었습니다.")
             void load()
           }}
           onDelete={editTarget ? () => void handleDelete(editTarget) : undefined}
           onError={(m) => flash(m, "error")}
        />
      )}
    </div>
  )
}

// ─── 장비 등록/수정 모달 ──────────────────────────────────────────────────────

interface ModalProps {
  open: boolean
  mode: "add" | "edit"
  initial?: EquipmentMasterRow
  onClose: () => void
  onSaved: () => void
  onDelete?: () => void
  onError: (msg: string) => void
}

const inputCls = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"

function EquipmentModal({ open, mode, initial, onClose, onSaved, onDelete, onError }: ModalProps) {
  const uid = useId()
  const [code,               setCode]               = useState(initial?.code ?? "")
  const [name,               setName]               = useState(initial?.name ?? "")
  const [category,           setCategory]           = useState(initial?.category ?? "")
  const [status,             setStatus]             = useState<EquipmentStatus>(initial?.status ?? "active")
  const [calibrationDate,    setCalibrationDate]    = useState(initial?.calibrationDate ?? "")
  const [calibrationDueDate, setCalibrationDueDate] = useState(initial?.calibrationDueDate ?? "")
  const [location,           setLocation]           = useState(initial?.location ?? "")
  const [note,               setNote]               = useState(initial?.note ?? "")
  const [saving,             setSaving]             = useState(false)

  const submit = async () => {
    if (!code.trim())  { onError("장비코드를 입력하세요."); return }
    if (!name.trim())  { onError("장비명을 입력하세요."); return }
    setSaving(true)
    try {
      const body = {
        code:               code.trim(),
        name:               name.trim(),
        category:           category.trim() || null,
        status,
        calibrationDate:    calibrationDate || null,
        calibrationDueDate: calibrationDueDate || null,
        location:           location.trim() || null,
        note:               note.trim() || null,
      }

      let res: Response
      if (mode === "add") {
        res = await fetch("/api/equipment-master", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch(`/api/equipment-master/${initial!.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      }

      if (!res.ok) {
        const d = await res.json() as { error?: string }
        onError(d.error ?? "저장 실패")
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ManagementDrawer
      open={open}
      onOpenChange={(next) => { if (!next && !saving) onClose() }}
      size="lg"
      title={mode === "add" ? "장비 등록" : "장비 수정"}
      description="장비 코드와 검교정 정보를 입력합니다."
      footer={(
        <>
          {mode === "edit" && onDelete && (
            <Button variant="ghost" className="mr-auto text-destructive hover:text-destructive" onClick={onDelete} disabled={saving}>
              <Trash2 /> 삭제
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {mode === "add" ? "등록" : "저장"}
          </Button>
        </>
      )}
    >
        <div className="grid gap-4">
          {/* 코드 / 장비명 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${uid}-code`} className="mb-1 block text-xs font-semibold text-foreground">
                장비코드 <span className="text-red-500">*</span>
              </label>
              <Input
                id={`${uid}-code`}
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="예) HPLC-01"
                className="h-9"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-name`} className="mb-1 block text-xs font-semibold text-foreground">
                장비명 <span className="text-red-500">*</span>
              </label>
              <Input
                id={`${uid}-name`}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="예) HPLC 분석장비 1호"
                className="h-9"
              />
            </div>
          </div>

          {/* 카테고리 / 상태 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${uid}-category`} className="mb-1 block text-xs font-semibold text-foreground">카테고리</label>
              <Input
                id={`${uid}-category`}
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="예) 분석기기"
                className="h-9"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-status`} className="mb-1 block text-xs font-semibold text-foreground">상태</label>
              <Select value={status} onValueChange={v => setStatus(v as EquipmentStatus)}>
                <SelectTrigger id={`${uid}-status`} className="!h-9 w-full px-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">사용 중</SelectItem>
                  <SelectItem value="calibrating">검교정 중</SelectItem>
                  <SelectItem value="out_of_service">사용 불가</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 검교정 날짜 */}
          <div className="grid grid-cols-2 gap-3">
            <DateField
              label="최근 검교정일"
              value={calibrationDate}
              onChange={setCalibrationDate}
            />
            <DateField
              label="차기 검교정 예정일"
              value={calibrationDueDate}
              onChange={setCalibrationDueDate}
            />
          </div>

          {/* 위치 */}
          <div>
            <label htmlFor={`${uid}-location`} className="mb-1 block text-xs font-semibold text-foreground">위치</label>
            <Input
              id={`${uid}-location`}
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="예) QC실 3번 랙"
              className="h-9"
            />
          </div>

          {/* 비고 */}
          <div>
            <label htmlFor={`${uid}-note`} className="mb-1 block text-xs font-semibold text-foreground">비고</label>
            <textarea
              id={`${uid}-note`}
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="기타 메모"
              className={`${inputCls} py-2 resize-none`}
            />
          </div>
        </div>
    </ManagementDrawer>
  )
}
