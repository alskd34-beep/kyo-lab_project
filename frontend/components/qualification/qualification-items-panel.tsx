"use client"

/**
 * 자격 항목 관리 탭 — 카테고리와 OJT 항목 마스터.
 *
 * 여기서 만든 항목이 자격 매트릭스의 열이 된다.
 * 이미 부여된 자격이 있는 항목·카테고리는 삭제를 막고(서버 검증) 비활성으로 유도한다 —
 * 인증 기록이 사라지면 GMP 이력이 끊긴다.
 */

import { useEffect, useMemo, useState } from "react"
import { FolderTree, Plus, Save, Search, Trash2 } from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { api, errorMessage } from "@frontend/lib/api-client"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { Tag } from "@frontend/components/ui/tag"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import type { QualCategory, QualItem, TesterQual } from "./types"

interface Props {
  loading: boolean
  categories: QualCategory[]
  items: QualItem[]
  quals: TesterQual[]
  onChanged: () => void
}

const ALL = "__all__"

export function QualificationItemsPanel({ loading, categories, items, quals, onChanged }: Props) {
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL)
  const [keyword, setKeyword] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [editing, setEditing] = useState<QualItem | null>(null)
  const [deleting, setDeleting] = useState<QualItem | null>(null)

  /** 항목별 보유 인원 — 삭제 가능 여부를 화면에서 미리 알려준다. */
  const holderCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const q of quals) m.set(q.qualificationItemId, (m.get(q.qualificationItemId) ?? 0) + 1)
    return m
  }, [quals])

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return items.filter(i => {
      if (categoryFilter !== ALL && i.categoryId !== categoryFilter) return false
      if (!kw) return true
      return i.name.toLowerCase().includes(kw) || i.categoryName.toLowerCase().includes(kw)
    })
  }, [items, categoryFilter, keyword])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="!h-9 w-56 px-3"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 카테고리</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 w-56 pl-9"
            placeholder="항목·카테고리 검색..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
        </div>

        <Badge variant="secondary" className="tabular-nums">{rows.length}개 항목</Badge>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={() => setCategoryOpen(true)}>
            <FolderTree />카테고리 관리
          </Button>
          <Button onClick={() => setAddOpen(true)} disabled={categories.length === 0}>
            <Plus />OJT 항목 추가
          </Button>
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-3 text-muted-foreground">카테고리</TableHead>
              <TableHead className="px-3 text-muted-foreground">OJT 항목</TableHead>
              <TableHead className="px-3 text-center text-muted-foreground">유효기간</TableHead>
              <TableHead className="px-3 text-center text-muted-foreground">보유 인원</TableHead>
              <TableHead className="px-3 text-muted-foreground">비고</TableHead>
              <TableHead className="px-3 text-center text-muted-foreground">상태</TableHead>
              <TableHead className="px-3 text-center text-muted-foreground">삭제</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-10" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-full" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-5 w-14 rounded-md" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-6 w-6 rounded-md" /></TableCell>
                  </TableRow>
                ))
              : rows.map(item => {
                  const holders = holderCount.get(item.id) ?? 0
                  return (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setEditing(item)}
                    >
                      <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                        {item.categoryName}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 font-medium text-foreground">
                        {item.name}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-center tabular-nums text-xs text-muted-foreground">
                        {item.validMonths}개월
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-center tabular-nums text-xs text-muted-foreground">
                        {holders}명
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate px-3 py-2.5 text-xs text-muted-foreground">
                        {item.note ?? "-"}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-center">
                        {item.isActive
                          ? <Tag color="green">사용</Tag>
                          : <Tag color="mono">미사용</Tag>}
                      </TableCell>
                      <TableCell className="px-3 py-2.5 text-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:text-destructive"
                          onClick={e => { e.stopPropagation(); setDeleting(item) }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
            {!loading && rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="py-16 text-center text-sm text-muted-foreground">
                  등록된 OJT 항목이 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {addOpen && (
        <ItemAddDialog
          categories={categories}
          onClose={() => setAddOpen(false)}
          onSaved={onChanged}
        />
      )}
      {editing && (
        <ItemEditDrawer
          item={editing}
          categories={categories}
          holders={holderCount.get(editing.id) ?? 0}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
      {deleting && (
        <ItemDeleteDialog
          item={deleting}
          holders={holderCount.get(deleting.id) ?? 0}
          onClose={() => setDeleting(null)}
          onDeleted={onChanged}
        />
      )}
      {categoryOpen && (
        <CategoryDrawer
          categories={categories}
          items={items}
          onClose={() => setCategoryOpen(false)}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}

// ─── OJT 항목 추가 ───────────────────────────────────────────────────────────

function ItemAddDialog({ categories, onClose, onSaved }: {
  categories: QualCategory[]; onClose: () => void; onSaved: () => void
}) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "")
  const [name, setName] = useState("")
  const [validMonths, setValidMonths] = useState("24")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setErr(null)
    try {
      await api.post("/api/qualification-items", {
        categoryId,
        name,
        validMonths: Number(validMonths),
        note,
      })
      onSaved()
      onClose()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>OJT 항목 추가</DialogTitle>
          <DialogDescription>자격 매트릭스에 새 열로 추가됩니다.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <section className="rounded-md border bg-card p-3 shadow-sm sm:p-4">
            <div className="mb-3 border-b pb-3">
              <h3 className="text-sm font-semibold text-foreground">기본 정보</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledField label="카테고리">
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="!h-9 w-full px-3"><SelectValue placeholder="선택" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </LabeledField>
              <LabeledField label="유효기간 (개월)">
                <Input
                  type="number" min={1} step={1}
                  value={validMonths}
                  onChange={e => setValidMonths(e.target.value)}
                />
              </LabeledField>
              <LabeledField label="OJT 항목명" full>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="예: 함량/질량편차(HPLC)"
                />
              </LabeledField>
              <LabeledField label="비고" full>
                <Input value={note} onChange={e => setNote(e.target.value)} placeholder="선택 입력" />
              </LabeledField>
            </div>
          </section>
          {err && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
              {err}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            <Save />{saving ? "저장 중..." : "추가"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── OJT 항목 수정 ───────────────────────────────────────────────────────────

function ItemEditDrawer({ item, categories, holders, onClose, onSaved }: {
  item: QualItem; categories: QualCategory[]; holders: number
  onClose: () => void; onSaved: () => void
}) {
  const [categoryId, setCategoryId] = useState(item.categoryId)
  const [name, setName] = useState(item.name)
  const [validMonths, setValidMonths] = useState(String(item.validMonths))
  const [note, setNote] = useState(item.note ?? "")
  const [isActive, setIsActive] = useState(item.isActive)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setCategoryId(item.categoryId)
    setName(item.name)
    setValidMonths(String(item.validMonths))
    setNote(item.note ?? "")
    setIsActive(item.isActive)
    setErr(null)
  }, [item])

  async function submit() {
    setSaving(true)
    setErr(null)
    try {
      await api.patch("/api/qualification-items", {
        id: item.id,
        categoryId,
        name,
        validMonths: Number(validMonths),
        note,
        isActive,
      })
      onSaved()
      onClose()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ManagementDrawer
      open
      onOpenChange={o => { if (!o) onClose() }}
      size="md"
      title="OJT 항목 수정"
      description={`${item.categoryName} / ${item.name} · 보유 ${holders}명`}
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            <Save />{saving ? "저장 중..." : "저장"}
          </Button>
        </>
      )}
    >
      <div className="grid gap-4">
        <section className="rounded-md border bg-card p-4 shadow-sm">
          <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">기본 정보</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledField label="카테고리">
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="!h-9 w-full px-3"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </LabeledField>
            <LabeledField label="유효기간 (개월)">
              <Input
                type="number" min={1} step={1}
                value={validMonths}
                onChange={e => setValidMonths(e.target.value)}
              />
            </LabeledField>
            <LabeledField label="OJT 항목명" full>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </LabeledField>
            <LabeledField label="비고" full>
              <Input value={note} onChange={e => setNote(e.target.value)} />
            </LabeledField>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            유효기간은 <span className="font-medium text-foreground">앞으로 부여할 자격</span>의 만료일 계산에만 쓰입니다.
            이미 부여된 자격의 만료일은 바뀌지 않습니다.
          </p>
        </section>

        <section className="rounded-md border bg-card p-4 shadow-sm">
          <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">사용 여부</h3>
          <div className="flex items-center gap-2">
            {[{ v: true, label: "사용" }, { v: false, label: "미사용" }].map(o => (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => setIsActive(o.v)}
                className={cn(
                  "h-9 rounded-md border px-3 text-sm font-medium transition-colors",
                  isActive === o.v
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-muted/50",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            미사용으로 두면 새 자격 부여 대상에서 제외되지만, 이미 부여된 자격과 매트릭스 열은 유지됩니다.
          </p>
        </section>

        {err && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
            {err}
          </div>
        )}
      </div>
    </ManagementDrawer>
  )
}

// ─── OJT 항목 삭제 ───────────────────────────────────────────────────────────

function ItemDeleteDialog({ item, holders, onClose, onDeleted }: {
  item: QualItem; holders: number; onClose: () => void; onDeleted: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setErr(null)
    try {
      await api.del("/api/qualification-items", { id: item.id })
      onDeleted()
      onClose()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>OJT 항목 삭제</DialogTitle>
          <DialogDescription>
            {holders > 0
              ? "이미 부여된 자격이 있어 삭제할 수 없습니다. 항목을 미사용으로 두세요."
              : "이 작업은 되돌릴 수 없습니다."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/50 p-3">
          <p className="text-sm font-medium">{item.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.categoryName} · 보유 {holders}명
          </p>
        </div>

        {err && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
            {err}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            disabled={saving || holders > 0}
          >
            <Trash2 />{saving ? "삭제 중..." : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 카테고리 관리 ───────────────────────────────────────────────────────────

function CategoryDrawer({ categories, items, onClose, onChanged }: {
  categories: QualCategory[]; items: QualItem[]; onClose: () => void; onChanged: () => void
}) {
  const [newName, setNewName] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const itemCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of items) m.set(i.categoryId, (m.get(i.categoryId) ?? 0) + 1)
    return m
  }, [items])

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    setErr(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <ManagementDrawer
      open
      onOpenChange={o => { if (!o) onClose() }}
      size="md"
      title="자격 카테고리 관리"
      description="Qualification List 의 그룹 머리행입니다. 순서가 매트릭스 열 순서가 됩니다."
      footer={<Button variant="outline" onClick={onClose}>닫기</Button>}
    >
      <div className="grid gap-4">
        <section className="rounded-md border bg-card p-4 shadow-sm">
          <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">카테고리 추가</h3>
          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="예: QC 완제품 고형제 (정제4)"
            />
            <Button
              disabled={!newName.trim() || busy !== null}
              onClick={() => void run("add", async () => {
                await api.post("/api/qualification-categories", {
                  name: newName,
                  sortOrder: (categories.at(-1)?.sortOrder ?? 0) + 10,
                })
                setNewName("")
              })}
            >
              <Plus />추가
            </Button>
          </div>
        </section>

        <section className="rounded-md border bg-card p-4 shadow-sm">
          <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">
            카테고리 {categories.length}개
          </h3>
          <ul className="grid gap-1.5">
            {categories.map(cat => {
              const count = itemCount.get(cat.id) ?? 0
              return (
                <li
                  key={cat.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {cat.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{count}개 항목</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void run(cat.id, () =>
                      api.patch("/api/qualification-categories", { id: cat.id, isActive: !cat.isActive }))}
                  >
                    {cat.isActive ? "사용" : "미사용"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive hover:text-destructive"
                    disabled={busy !== null}
                    onClick={() => void run(cat.id, () =>
                      api.del("/api/qualification-categories", { id: cat.id }))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            부여된 자격이 있는 카테고리는 삭제되지 않습니다. 사용/미사용으로 노출만 조절하세요.
          </p>
        </section>

        {err && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
            {err}
          </div>
        )}
      </div>
    </ManagementDrawer>
  )
}

function LabeledField({ label, children, full }: {
  label: string; children: React.ReactNode; full?: boolean
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <label className="mb-1 block text-xs font-semibold text-foreground">{label}</label>
      {children}
    </div>
  )
}
