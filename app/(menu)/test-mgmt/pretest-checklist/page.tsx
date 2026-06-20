"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ClipboardCheck,
  Search,
  Plus,
  Trash2,
  PackageOpen,
  User as UserIcon,
} from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { useAuth } from "@frontend/lib/auth-context"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import { DateField } from "@frontend/components/ui/date-field"

interface ProductRow {
  id: string
  productCode: string
  name: string
  nameAlt: string | null
}

interface NoteRow {
  id: string
  content: string
  occurredAt: string | null
  remark: string | null
  issueLot: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
}

// 현재 날짜/시각
function nowParts() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  }
}
const fmtDT = (iso: string | null) =>
  iso ? iso.slice(0, 16).replace("T", " ") : "—"

export default function PretestChecklistPage() {
  const { user } = useAuth()
  const myName = user?.displayName || user?.username || "본인"

  const [products, setProducts] = useState<ProductRow[]>([])
  const [selected, setSelected] = useState<ProductRow | null>(null)
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [search, setSearch] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 입력 폼
  const [occurredDate, setOccurredDate] = useState(nowParts().date)
  const [occurredTime, setOccurredTime] = useState(nowParts().time)
  const [content, setContent] = useState("")
  const [remark, setRemark] = useState("")
  const [issueLot, setIssueLot] = useState("")

  useEffect(() => {
    void loadProducts()
  }, [])

  useEffect(() => {
    if (selected) void loadNotes(selected.id)
    else setNotes([])
  }, [selected])

  async function loadProducts() {
    try {
      const res = await fetch("/api/products")
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { rows: ProductRow[] }
      setProducts(data.rows)
    } catch (e) {
      setError(String(e))
    }
  }

  async function loadNotes(productId: string) {
    try {
      const res = await fetch(`/api/product-pretest-notes?productId=${productId}`)
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { rows: NoteRow[] }
      setNotes(data.rows)
    } catch (e) {
      setError(String(e))
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.productCode.toLowerCase().includes(q)
    )
  }, [products, search])

  function resetForm() {
    const n = nowParts()
    setOccurredDate(n.date)
    setOccurredTime(n.time)
    setContent("")
    setRemark("")
    setIssueLot("")
  }

  async function handleAdd() {
    if (!selected || !content.trim()) return
    setBusy(true)
    setError(null)
    try {
      const occurredAt = occurredDate
        ? `${occurredDate}T${occurredTime || "00:00"}:00`
        : null
      const res = await fetch("/api/product-pretest-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selected.id,
          content: content.trim(),
          occurredAt,
          remark: remark.trim() || null,
          issueLot: issueLot.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "추가 실패")
      }
      resetForm()
      await loadNotes(selected.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    setBusy(true)
    try {
      const res = await fetch("/api/product-pretest-notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "삭제 실패")
      }
      if (selected) await loadNotes(selected.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      {/* 헤더 */}
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <ClipboardCheck className="size-5 shrink-0 text-foreground" />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground">시험 전 확인사항</h1>
          <p className="text-sm text-muted-foreground">
            품목코드·품목명별 시험 전 점검/주의사항·이슈를 일시·작성자와 함께 적재합니다.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
          {error}
        </div>
      )}

      <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* 품목 목록 */}
        <Card className="flex min-h-0 flex-col gap-0 overflow-hidden py-0 max-h-[40vh] lg:max-h-none">
          <div className="border-b px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-foreground">품목 선택</p>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="품목명 / 코드 검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-9"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                품목이 없습니다.
              </p>
            ) : (
              <ul className="divide-y">
                {filtered.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setSelected(p)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
                        selected?.id === p.id && "bg-primary/5"
                      )}
                    >
                      <span className="font-mono text-[10px] font-semibold text-muted-foreground">
                        {p.productCode}
                      </span>
                      <span className="truncate text-sm font-medium text-foreground">
                        {p.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t px-4 py-2 text-xs text-muted-foreground">
            총 <span className="font-semibold text-foreground">{filtered.length}</span>개 품목
          </div>
        </Card>

        {/* 확인사항 패널 */}
        <Card className="min-h-0 gap-0 overflow-hidden py-0">
          {!selected ? (
            <div className="flex min-h-[420px] items-center justify-center p-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <PackageOpen className="size-5 text-muted-foreground" />
                </div>
                <h2 className="mt-4 text-base font-semibold text-foreground">
                  품목을 선택하세요
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  좌측에서 품목을 선택하면 시험 전 확인사항을 등록·관리할 수 있습니다.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b px-4 py-4">
                <p className="font-mono text-[10px] font-semibold text-muted-foreground">
                  {selected.productCode}
                </p>
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-foreground">
                    {selected.name}
                  </h2>
                  <Badge variant="secondary">{notes.length}건</Badge>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
                {/* 입력 폼 */}
                <div className="mb-4 rounded-lg border bg-muted/30 p-3 md:p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UserIcon className="size-3" /> 작성자
                    <span className="font-medium text-foreground">{myName}</span>
                    <span>· 작성시각은 자동 기록</span>
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-[auto_auto_1fr]">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">일자</label>
                      <DateField value={occurredDate} onChange={setOccurredDate} size="sm" noLabel />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">시각</label>
                      <input
                        type="time"
                        value={occurredTime}
                        onChange={(e) => setOccurredTime(e.target.value)}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">이슈발생 로트(제조번호)</label>
                      <Input
                        value={issueLot}
                        onChange={(e) => setIssueLot(e.target.value)}
                        placeholder="예: 26041 (선택)"
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div className="mt-2.5">
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      확인사항 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="예: 표준품 유효기한 확인, 항온수조 온도 설정 등"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="mt-2.5">
                    <label className="mb-1 block text-[11px] font-medium text-muted-foreground">특이사항</label>
                    <textarea
                      value={remark}
                      onChange={(e) => setRemark(e.target.value)}
                      rows={2}
                      placeholder="특이사항·조치내용 등 (선택)"
                      className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                    />
                  </div>
                  <div className="mt-2.5 flex justify-end">
                    <Button
                      onClick={() => void handleAdd()}
                      disabled={busy || !content.trim()}
                    >
                      <Plus />
                      등록
                    </Button>
                  </div>
                </div>

                {/* 목록 테이블 */}
                <Card className="gap-0 overflow-hidden py-0">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="px-3 text-muted-foreground whitespace-nowrap">일시</TableHead>
                        <TableHead className="px-3 text-muted-foreground">확인사항</TableHead>
                        <TableHead className="px-3 text-muted-foreground">특이사항</TableHead>
                        <TableHead className="px-3 text-muted-foreground whitespace-nowrap">이슈 로트</TableHead>
                        <TableHead className="px-3 text-muted-foreground whitespace-nowrap">작성자</TableHead>
                        <TableHead className="px-3 text-muted-foreground whitespace-nowrap">작성시각</TableHead>
                        <TableHead className="w-14 px-3 text-center text-muted-foreground">삭제</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {notes.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                            등록된 시험 전 확인사항이 없습니다. 위 입력란에서 등록하세요.
                          </TableCell>
                        </TableRow>
                      ) : (
                        notes.map((n) => (
                          <TableRow key={n.id} className="align-top">
                            <TableCell className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
                              {fmtDT(n.occurredAt)}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 font-medium whitespace-pre-wrap text-foreground">
                              {n.content}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 whitespace-pre-wrap text-muted-foreground">
                              {n.remark || <span className="text-muted-foreground/40">—</span>}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
                              {n.issueLot || <span className="text-muted-foreground/40">—</span>}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                              {n.createdByName || <span className="text-muted-foreground/40">—</span>}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 font-mono text-[11px] whitespace-nowrap text-muted-foreground">
                              {fmtDT(n.createdAt)}
                            </TableCell>
                            <TableCell className="px-3 py-2.5 text-center">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => void handleDelete(n.id)}
                                disabled={busy}
                                title="삭제"
                                className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
