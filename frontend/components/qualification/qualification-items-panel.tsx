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
      {/* 툴바
          반응형: 조회 입력은 320px 에서 w-56(224px) 두 개가 나란히 설 수 없다.
          모바일은 한 줄에 하나씩 꽉 채우고(w-full), sm 부터 원래의 가로 배치로 돌아간다.
          shrink-0: 아래 목록이 길어져도 툴바가 눌리지 않게 못 박는다. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="!h-9 w-full px-3 sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>전체 카테고리</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 w-full pl-9"
            placeholder="항목·카테고리 검색..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
        </div>

        <Badge variant="secondary" className="tabular-nums">{rows.length}개 항목</Badge>

        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setCategoryOpen(true)}>
            <FolderTree />카테고리 관리
          </Button>
          <Button className="flex-1 sm:flex-none" onClick={() => setAddOpen(true)} disabled={categories.length === 0}>
            <Plus />OJT 항목 추가
          </Button>
        </div>
      </div>

      {/* 모바일 — 카드 목록
          7열짜리 표는 320px 에서 어떤 수를 써도 읽히지 않는다. `/home` 의 「기한 임박 오더」와
          같은 구조로, 칸막이 대신 실선 하나로 나눈 요약 목록을 그린다.
          카드에는 꼭 필요한 값만 남긴다 — 카테고리 · 항목명 · 유효기간 · 보유 인원 · 사용 여부.
          (비고는 행을 눌러 여는 수정 패널에서 본다) */}
      <div className="min-h-0 flex-1 divide-y overflow-y-auto overflow-x-hidden rounded-md border md:hidden">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2 px-3 py-3">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))
          : rows.length === 0
            ? (
                <p className="px-4 py-10 text-center text-sm break-keep text-muted-foreground">
                  등록된 OJT 항목이 없습니다.
                </p>
              )
            : rows.map(item => {
                const holders = holderCount.get(item.id) ?? 0
                return (
                  <div key={item.id} className="flex min-w-0 items-start gap-2 px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setEditing(item)}
                      className="flex min-w-0 flex-1 flex-col gap-1 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className="min-w-0 truncate text-xs leading-normal text-muted-foreground">
                        {item.categoryName}
                      </span>
                      <span className="min-w-0 text-sm font-medium break-keep text-foreground">
                        {item.name}
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-normal text-muted-foreground">
                        <span className="tabular-nums">유효 {item.validMonths}개월</span>
                        <span className="text-border">·</span>
                        <span className="tabular-nums">보유 {holders}명</span>
                        {item.isActive
                          ? <Tag color="blue">사용</Tag>
                          : <Tag color="mono">미사용</Tag>}
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-destructive hover:text-destructive"
                      aria-label={`${item.name} 삭제`}
                      onClick={() => setDeleting(item)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )
              })}
      </div>

      {/* md:flex — Card 기본이 flex flex-col 이라야 안쪽 Table 컨테이너의 min-h-0 flex-1 이 살아난다.
          md:block 으로 두면 표가 높이 제한 없이 자라 페이지 밖으로 잘린다. */}
      <Card className="hidden min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0 md:flex">
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
                          ? <Tag color="blue">사용</Tag>
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
          <p className="mt-2 text-xs leading-normal break-keep text-muted-foreground">
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
          <p className="mt-2 text-xs leading-normal break-keep text-muted-foreground">
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
          {/* 모바일 패널 폭은 300px 이 안 된다 — 입력과 버튼을 한 줄에 두지 않고 세로로 쌓는다 */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                /* flex-wrap + basis-full: 좁은 패널에서 이름·건수·버튼 둘을 한 줄에 못 넣는다.
                   이름을 윗줄로 올리고 나머지를 아랫줄에 세운다(글자를 줄이지 않는다). */
                <li
                  key={cat.id}
                  className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-3 py-2"
                >
                  <span className="min-w-0 basis-full truncate text-sm font-medium text-foreground sm:flex-1 sm:basis-auto">
                    {cat.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}개 항목</span>
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
          <p className="mt-2 text-xs leading-normal break-keep text-muted-foreground">
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
