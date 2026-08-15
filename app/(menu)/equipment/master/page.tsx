"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { ClipboardList, Plus, Pencil, Trash2, Loader2, AlertTriangle, AlertCircle, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react"
import { DateField } from "@frontend/components/ui/date-field"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Badge } from "@frontend/components/ui/badge"
import { Input } from "@frontend/components/ui/input"
import { Skeleton } from "@frontend/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"

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

const STATUS_DOT: Record<EquipmentStatus, string> = {
  active:         "bg-emerald-500",
  calibrating:    "bg-amber-500",
  out_of_service: "bg-red-500",
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

function CalibrationDueBadge({ dueDate }: { dueDate: string | null }) {
  if (!dueDate) return <span className="text-muted-foreground text-xs">미등록</span>
  const urgency = getCalibrationUrgency(dueDate)
  if (urgency === "expired") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
        <AlertCircle size={12} /> {dueDate} <span className="font-normal">(만료)</span>
      </span>
    )
  }
  if (urgency === "soon") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
        <AlertTriangle size={12} /> {dueDate} <span className="font-normal">(30일 이내)</span>
      </span>
    )
  }
  return <span className="text-xs text-foreground">{dueDate}</span>
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

type SortField = "code" | "name" | "category" | "status" | "calibrationDate" | "calibrationDueDate" | "location"
type SortDir = "asc" | "desc"

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField | null; sortDir: SortDir }) {
  if (sortField !== field) return <ChevronsUpDown size={13} className="ml-1 opacity-40" />
  return sortDir === "asc"
    ? <ChevronUp size={13} className="ml-1" />
    : <ChevronDown size={13} className="ml-1" />
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EquipmentMasterPage() {
  const { user } = useAuth()
  const { requestConfirm } = useConfirmMessage()
  const isAdmin = user?.role === "admin"

  const [rows, setRows] = useState<EquipmentMasterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; type: "info" | "error" } | null>(null)

  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const [editTarget, setEditTarget] = useState<EquipmentMasterRow | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const toggleSort = (field: SortField) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDir(d => d === "asc" ? "desc" : "asc")
        return field
      }
      setSortDir("asc")
      return field
    })
  }

  const sortedRows = useMemo(() => {
    if (!sortField) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortField] ?? ""
      const bv = b[sortField] ?? ""
      const cmp = av.localeCompare(bv, "ko")
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [rows, sortField, sortDir])

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

    setBusy(row.id)
    try {
      const res = await fetch(`/api/equipment-master/${row.id}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) { const d = await res.json() as { error?: string }; flash(d.error ?? "삭제 실패", "error"); return }
      flash("삭제되었습니다.")
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
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
        <div className={`rounded-lg border px-4 py-2.5 text-sm ${
          msg.type === "error"
            ? "border-red-200 bg-red-50 text-red-600"
            : "border-blue-200 bg-blue-50 text-blue-700"
        }`}>
          {msg.text}
        </div>
      )}

      {/* 테이블 */}
      <Card className="gap-0 py-0 overflow-hidden">
        <div className="border-b px-4 py-2.5 text-sm font-semibold text-foreground">
          장비 목록 ({rows.length})
        </div>

        {rows.length === 0 && !loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">등록된 장비가 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3 text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("code")}>
                    <span className="inline-flex items-center">코드<SortIcon field="code" sortField={sortField} sortDir={sortDir} /></span>
                  </TableHead>
                  <TableHead className="px-3 text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("name")}>
                    <span className="inline-flex items-center">장비명<SortIcon field="name" sortField={sortField} sortDir={sortDir} /></span>
                  </TableHead>
                  <TableHead className="px-3 text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("category")}>
                    <span className="inline-flex items-center">카테고리<SortIcon field="category" sortField={sortField} sortDir={sortDir} /></span>
                  </TableHead>
                  <TableHead className="px-3 text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("status")}>
                    <span className="inline-flex items-center">상태<SortIcon field="status" sortField={sortField} sortDir={sortDir} /></span>
                  </TableHead>
                  <TableHead className="px-3 text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("calibrationDate")}>
                    <span className="inline-flex items-center">최근 검교정<SortIcon field="calibrationDate" sortField={sortField} sortDir={sortDir} /></span>
                  </TableHead>
                  <TableHead className="px-3 text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("calibrationDueDate")}>
                    <span className="inline-flex items-center">차기 검교정<SortIcon field="calibrationDueDate" sortField={sortField} sortDir={sortDir} /></span>
                  </TableHead>
                  <TableHead className="px-3 text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("location")}>
                    <span className="inline-flex items-center">위치<SortIcon field="location" sortField={sortField} sortDir={sortDir} /></span>
                  </TableHead>
                  {isAdmin && <TableHead className="px-3 text-muted-foreground">관리</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-32" /></TableCell>
                        <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell className="px-3 py-2.5"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                        <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                        {isAdmin && <TableCell className="px-3 py-2.5"><Skeleton className="h-6 w-14" /></TableCell>}
                      </TableRow>
                    ))
                  : sortedRows.map(row => {
                  const urgency = getCalibrationUrgency(row.calibrationDueDate)
                  const rowHighlight =
                    urgency === "expired" ? "bg-red-50/40" :
                    urgency === "soon"    ? "bg-amber-50/40" : ""
                  return (
                    <TableRow key={row.id} className={rowHighlight}>
                      <TableCell className="px-3 py-2.5 font-mono text-xs font-semibold text-foreground">{row.code}</TableCell>
                      <TableCell className="px-3 py-2.5 font-medium text-foreground">{row.name}</TableCell>
                      <TableCell className="px-3 py-2.5 text-muted-foreground">{row.category ?? "—"}</TableCell>
                      <TableCell className="px-3 py-2.5">
                        <Badge variant="outline" className="gap-1.5">
                          <span className={`size-1.5 rounded-full ${STATUS_DOT[row.status]}`} />
                          {STATUS_LABEL[row.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                        {row.calibrationDate ?? <span className="text-muted-foreground/40">—</span>}
                      </TableCell>
                      <TableCell className="px-3 py-2.5">
                        <CalibrationDueBadge dueDate={row.calibrationDueDate} />
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-muted-foreground">{row.location ?? "—"}</TableCell>
                      {isAdmin && (
                        <TableCell className="px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setEditTarget(row)}
                              title="수정"
                              className="text-muted-foreground"
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => void handleDelete(row)}
                              disabled={busy === row.id}
                              title="삭제"
                              className="text-muted-foreground hover:text-destructive"
                            >
                              {busy === row.id
                                ? <Loader2 className="animate-spin" />
                                : <Trash2 />}
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
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
  onError: (msg: string) => void
}

const inputCls = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"

function EquipmentModal({ open, mode, initial, onClose, onSaved, onError }: ModalProps) {
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
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "장비 등록" : "장비 수정"}</DialogTitle>
          <DialogDescription>
            장비 코드와 검교정 정보를 입력합니다.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {/* 코드 / 장비명 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                장비코드 <span className="text-red-500">*</span>
              </label>
              <Input
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="예) HPLC-01"
                className="h-9"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">
                장비명 <span className="text-red-500">*</span>
              </label>
              <Input
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
              <label className="mb-1 block text-xs font-semibold text-foreground">카테고리</label>
              <Input
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="예) 분석기기"
                className="h-9"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-foreground">상태</label>
              <Select value={status} onValueChange={v => setStatus(v as EquipmentStatus)}>
                <SelectTrigger className="!h-9 w-full px-3">
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
            <label className="mb-1 block text-xs font-semibold text-foreground">위치</label>
            <Input
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="예) QC실 3번 랙"
              className="h-9"
            />
          </div>

          {/* 비고 */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-foreground">비고</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="기타 메모"
              className={`${inputCls} py-2 resize-none`}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {mode === "add" ? "등록" : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
