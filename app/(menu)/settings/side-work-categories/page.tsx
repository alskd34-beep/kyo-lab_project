"use client"

/**
 * 부업무 분류 마스터 (관리자 전용).
 *
 * 월간 스케줄에서 시험자가 부업무를 남길 때 고르는 분류 목록이다.
 * 운영하다 보면 항목이 늘어난다 — 그때마다 배포하지 않도록 여기서 관리한다.
 *
 * **삭제보다 [사용 안 함]이 기본이다.** 이미 기록이 달린 분류를 지우면 그 분류로
 * 쌓인 과거 기록을 운영 리포트가 다시 읽을 수 없다(서버도 FK 로 막는다).
 * 데이터: /api/side-work/categories
 */

import { useCallback, useEffect, useState } from "react"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import type { SideWorkCategory } from "@shared/side-work"
import { cn } from "@frontend/lib/utils"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import { Skeleton } from "@frontend/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"
import { useToastMessage } from "@frontend/components/common/toast-message"

interface FormState {
  id: string | null
  code: string
  name: string
  sortOrder: number
  isActive: boolean
}

const EMPTY: FormState = { id: null, code: "", name: "", sortOrder: 0, isActive: true }

export default function SideWorkCategoriesPage() {
  const { showToast } = useToastMessage()
  const { requestConfirm } = useConfirmMessage()

  const [rows, setRows] = useState<SideWorkCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 꺼진 분류까지 봐야 다시 켤 수 있다 — 관리 화면만 includeInactive 를 쓴다.
      const r = await fetch("/api/side-work/categories?includeInactive=1", { credentials: "include" })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error ?? "분류를 불러오지 못했습니다.")
      setRows(json.rows as SideWorkCategory[])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function save() {
    if (!form) return
    if (!form.code.trim() || !form.name.trim()) {
      setFormError("분류 코드와 이름은 필수입니다."); return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body = {
        code: form.code.trim(), name: form.name.trim(),
        sortOrder: form.sortOrder, isActive: form.isActive,
      }
      const r = await fetch(
        form.id ? `/api/side-work/categories/${form.id}` : "/api/side-work/categories",
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(body),
        },
      )
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error ?? "저장에 실패했습니다.")
      showToast({ title: form.id ? "분류를 수정했습니다." : "분류를 추가했습니다.", variant: "success" })
      setForm(null)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "알 수 없는 오류")
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: SideWorkCategory) {
    const confirmed = await requestConfirm({
      title: `'${row.name}' 분류를 삭제할까요?`,
      description: "이미 기록이 달린 분류는 삭제할 수 없습니다. 그런 경우에는 [사용 안 함]으로 꺼 두세요 — 새 기록에는 나타나지 않고 과거 리포트는 그대로 읽힙니다.",
      confirmLabel: "삭제",
      variant: "danger",
    })
    if (!confirmed) return
    try {
      const r = await fetch(`/api/side-work/categories/${row.id}`, { method: "DELETE", credentials: "include" })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error ?? "삭제에 실패했습니다.")
      showToast({ title: "분류를 삭제했습니다.", variant: "success" })
      await load()
    } catch (e) {
      showToast({
        title: "삭제하지 못했습니다.",
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      })
    }
  }

  async function toggleActive(row: SideWorkCategory) {
    try {
      const r = await fetch(`/api/side-work/categories/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: !row.isActive }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "변경에 실패했습니다.")
      await load()
    } catch (e) {
      showToast({ title: e instanceof Error ? e.message : "변경에 실패했습니다.", variant: "error" })
    }
  }

  const activeCount = rows.filter(r => r.isActive).length

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <header className="flex min-w-0 shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">부업무 분류</h1>
          <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">
            시험자가 월간 스케줄에서 부업무를 기록할 때 고르는 목록
            {!loading && (
              <>
                <span className="px-1 text-border">·</span>
                <span className="tabular-nums">사용 중 {activeCount}개 / 전체 {rows.length}개</span>
              </>
            )}
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => { setFormError(null); setForm({ ...EMPTY, sortOrder: (rows.at(-1)?.sortOrder ?? 0) + 10 }) }}>
          <Plus size={15} />
          분류 추가
        </Button>
      </header>

      {error && (
        <div className="shrink-0 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm font-medium break-keep text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card className="py-10">
          <p className="text-center text-sm break-keep text-muted-foreground">
            등록된 분류가 없습니다. [분류 추가]로 시작하세요.
          </p>
        </Card>
      ) : (
        <>
          {/* 모바일 — 코드·정렬순은 관리용 값이라 접고 이름과 사용 여부만 낸다 */}
          <Card className="gap-0 overflow-hidden py-0 md:hidden">
            <div className="divide-y">
              {rows.map(row => (
                <div key={row.id} className="flex min-w-0 items-center gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-medium", row.isActive ? "text-foreground" : "text-muted-foreground line-through")}>
                      {row.name}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{row.code}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => void toggleActive(row)}>
                    {row.isActive ? "사용 안 함" : "사용"}
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`${row.name} 수정`} onClick={() => { setFormError(null); setForm({ ...row }) }}>
                    <Pencil size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="hidden gap-0 overflow-hidden py-0 md:flex">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3 text-muted-foreground">분류명</TableHead>
                  <TableHead className="px-3 text-muted-foreground">코드</TableHead>
                  <TableHead className="px-3 text-right text-muted-foreground">정렬순</TableHead>
                  <TableHead className="px-3 text-muted-foreground">사용</TableHead>
                  <TableHead className="px-3 text-right text-muted-foreground">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id} className={cn(!row.isActive && "opacity-60")}>
                    <TableCell className={cn("px-3 font-medium break-keep", !row.isActive && "line-through")}>
                      {row.name}
                    </TableCell>
                    <TableCell className="px-3 font-mono text-xs text-muted-foreground">{row.code}</TableCell>
                    <TableCell className="px-3 text-right tabular-nums">{row.sortOrder}</TableCell>
                    <TableCell className="px-3">
                      <Button variant="outline" size="sm" onClick={() => void toggleActive(row)}>
                        {row.isActive ? "사용 중" : "사용 안 함"}
                      </Button>
                    </TableCell>
                    <TableCell className="px-3">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon-sm" aria-label={`${row.name} 수정`} onClick={() => { setFormError(null); setForm({ ...row }) }}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`${row.name} 삭제`} onClick={() => void remove(row)}>
                          <Trash2 size={14} className="text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {/* 추가·수정 — 인라인 편집 대신 모달이 이 프로젝트의 기본 UX다 */}
      {form && (
        <Dialog open onOpenChange={next => { if (!next) setForm(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{form.id ? "분류 수정" : "분류 추가"}</DialogTitle>
              <DialogDescription className="text-xs leading-normal break-keep">
                코드는 집계·연동의 키라 바꾸면 과거 기록과 이어지지 않을 수 있습니다. 이름은 언제든 고쳐도 됩니다.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">분류명</span>
                <Input
                  className="mt-1"
                  value={form.name}
                  onChange={e => setForm(f => f && { ...f, name: e.target.value })}
                  placeholder="예: 문서작성·기록"
                />
              </label>
              <div className="flex gap-3">
                <label className="block flex-1">
                  <span className="text-xs font-medium text-muted-foreground">코드</span>
                  <Input
                    className="mt-1 font-mono"
                    value={form.code}
                    onChange={e => setForm(f => f && { ...f, code: e.target.value.toUpperCase() })}
                    placeholder="DOC"
                  />
                </label>
                <label className="block w-28">
                  <span className="text-xs font-medium text-muted-foreground">정렬순</span>
                  <Input
                    className="mt-1 tabular-nums"
                    type="number"
                    value={form.sortOrder}
                    onChange={e => setForm(f => f && { ...f, sortOrder: Number(e.target.value) })}
                  />
                </label>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={form.isActive}
                  onChange={e => setForm(f => f && { ...f, isActive: e.target.checked })}
                />
                <span className="text-sm text-foreground">기록 화면에 표시(사용 중)</span>
              </label>
              {formError && <p className="text-xs break-keep text-destructive">{formError}</p>}
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setForm(null)}>취소</Button>
              <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
                {saving && <Loader2 size={14} className="animate-spin" />}
                저장
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
