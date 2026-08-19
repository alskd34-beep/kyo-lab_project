"use client"

import { useEffect, useMemo, useState } from "react"
import {
  ClipboardCheck,
  Search,
  Plus,
  Trash2,
  PackageOpen,
  User as UserIcon,
  Copy,
  X,
} from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { useAuth } from "@frontend/lib/auth-context"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import { CellStack } from "@frontend/components/ui/table-cell-stack"
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from "@frontend/components/ui/table-sort"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"

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

type NoteSortField = "occurredAt" | "content" | "remark" | "issueLot" | "createdByName" | "createdAt"

const NOTE_SORT_COLUMNS: SortColumnDef<NoteSortField>[] = [
  sortCol("occurredAt", "일시"),
  {
    key: "note",
    label: "확인사항",
    fields: [
      { id: "content", label: "확인사항" },
      { id: "remark", label: "특이사항" },
    ],
  },
  sortCol("issueLot", "이슈 로트"),
  {
    key: "author",
    label: "작성",
    fields: [
      { id: "createdByName", label: "작성자" },
      { id: "createdAt", label: "작성시각" },
    ],
  },
]

const fmtDT = (iso: string | null) =>
  iso ? iso.slice(0, 16).replace("T", " ") : "—"

// 현재 로컬(브라우저) 일시를 naive ISO 문자열로 — 발생 일시 자동 기록용
function localNowStamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// 제형 표현(품목명 끝에 붙는 어미) — 브랜드 토큰 추출 시 제거
const DOSAGE_FORMS = [
  "연질캡슐", "경질캡슐", "캡슐", "정제", "정", "시럽", "주사", "주",
  "산제", "산", "과립", "액제", "액", "현탁액", "점안액", "점안", "연고",
  "크림", "겔", "패치", "좌제", "환", "분말", "건조시럽",
]

/** 품목명에서 브랜드 토큰을 뽑는다. 예: "베니톨정100mg" → "베니톨" */
function brandToken(name: string): string {
  let s = name.trim()
  s = s.replace(/[\s(［(].*$/, "") // 공백/괄호 이후 제거
  s = s.replace(/[0-9].*$/, "")    // 첫 숫자 이후 제거
  for (const f of DOSAGE_FORMS) {
    if (s.length > f.length && s.endsWith(f)) { s = s.slice(0, -f.length); break }
  }
  return s.trim()
}

/** 두 품목명이 유사(같은 브랜드 계열)한지 판정 */
/** 실패 응답을 사용자에게 보여줄 한국어 메시지로 변환 (원문 JSON 노출 방지) */
async function resError(res: Response, fallback = "요청에 실패했습니다."): Promise<string> {
  if (res.status === 401) return "세션이 만료되었습니다. 다시 로그인해 주세요."
  const text = await res.text().catch(() => "")
  try {
    const body = JSON.parse(text) as { error?: string }
    if (body.error) return body.error
  } catch {
    /* JSON이 아니면 원문을 그대로 사용 */
  }
  return text || fallback
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

function isSimilarName(a: string, b: string): boolean {
  const ta = brandToken(a)
  const tb = brandToken(b)
  if (ta.length < 2 || tb.length < 2) return false
  return ta === tb || ta.startsWith(tb) || tb.startsWith(ta)
}

export default function PretestChecklistPage() {
  const { user } = useAuth()
  const myName = user?.displayName || user?.username || "본인"

  const [products, setProducts] = useState<ProductRow[]>([])
  const [selected, setSelected] = useState<ProductRow | null>(null)
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [search, setSearch] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 유사 품목 동시 적용
  const [extraIds, setExtraIds] = useState<Set<string>>(new Set())
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState("")
  const [similarOnly, setSimilarOnly] = useState(true)
  const [sortField, setSortField] = useState<NoteSortField>("occurredAt")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const pickSort = (field: NoteSortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }

  // 입력 폼 (발생 일시는 등록 시점으로 자동 기록)
  const [content, setContent] = useState("")
  const [remark, setRemark] = useState("")
  const [issueLot, setIssueLot] = useState("")

  useEffect(() => {
    void loadProducts()
  }, [])

  useEffect(() => {
    if (selected) void loadNotes(selected.id)
    else setNotes([])
    // 품목 전환 시 유사 품목 선택·메시지 초기화
    setExtraIds(new Set())
    setOkMsg(null)
  }, [selected])

  async function loadProducts() {
    try {
      const res = await fetch("/api/products")
      if (!res.ok) throw new Error(await resError(res, "품목 목록을 불러오지 못했습니다."))
      const data = (await res.json()) as { rows: ProductRow[] }
      setProducts(data.rows)
    } catch (e) {
      setError(msgOf(e))
    }
  }

  async function loadNotes(productId: string) {
    try {
      const res = await fetch(`/api/product-pretest-notes?productId=${productId}`)
      if (!res.ok) throw new Error(await resError(res, "확인사항을 불러오지 못했습니다."))
      const data = (await res.json()) as { rows: NoteRow[] }
      setNotes(data.rows)
    } catch (e) {
      setError(msgOf(e))
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

  const sortedNotes = useMemo(() => {
    const arr = [...notes]
    arr.sort((a, b) => {
      const av = a[sortField] ?? ""
      const bv = b[sortField] ?? ""
      const cmp = String(av).localeCompare(String(bv), "ko")
      return sortDir === "asc" ? cmp : -cmp
    })
    return arr
  }, [notes, sortField, sortDir])

  // 선택된 품목 외 후보 (유사 품목 동시 적용 picker)
  const pickerCandidates = useMemo(() => {
    if (!selected) return []
    const q = pickerSearch.trim().toLowerCase()
    return products
      .filter(p => p.id !== selected.id)
      .filter(p => !similarOnly || isSimilarName(selected.name, p.name))
      .filter(p =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.productCode.toLowerCase().includes(q)
      )
  }, [products, selected, pickerSearch, similarOnly])

  // 선택된 추가 품목 객체 (칩 표시용)
  const extraProducts = useMemo(
    () => products.filter(p => extraIds.has(p.id)),
    [products, extraIds]
  )

  function toggleExtra(id: string) {
    setExtraIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 현재 picker에 보이는 후보 전체 선택/해제
  function toggleAllVisible() {
    const visibleIds = pickerCandidates.map(p => p.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => extraIds.has(id))
    setExtraIds(prev => {
      const next = new Set(prev)
      if (allSelected) visibleIds.forEach(id => next.delete(id))
      else visibleIds.forEach(id => next.add(id))
      return next
    })
  }

  function resetForm() {
    setContent("")
    setRemark("")
    setIssueLot("")
  }

  async function handleAdd() {
    if (!selected || !content.trim()) return
    setBusy(true)
    setError(null)
    setOkMsg(null)
    try {
      // 선택 품목 + 유사 품목(extraIds)에 동일 확인사항 적재 (발생 일시는 서버에서 자동 기록)
      const productIds = [selected.id, ...extraIds]
      const res = await fetch("/api/product-pretest-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productIds,
          content: content.trim(),
          occurredAt: localNowStamp(),
          remark: remark.trim() || null,
          issueLot: issueLot.trim() || null,
        }),
      })
      if (!res.ok) throw new Error(await resError(res, "확인사항 등록에 실패했습니다."))
      const d = (await res.json()) as { count?: number }
      const count = d.count ?? productIds.length
      setOkMsg(
        count > 1
          ? `${count}개 품목에 동일한 확인사항을 등록했습니다.`
          : "확인사항을 등록했습니다."
      )
      resetForm()
      setExtraIds(new Set())
      await loadNotes(selected.id)
    } catch (e) {
      setError(msgOf(e))
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
      if (!res.ok) throw new Error(await resError(res, "삭제에 실패했습니다."))
      if (selected) await loadNotes(selected.id)
    } catch (e) {
      setError(msgOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 p-4 md:p-6 lg:h-[calc(100svh-4rem)]">
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
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
          {error}
        </div>
      )}

      {okMsg && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
          {okMsg}
        </div>
      )}

      <div className="grid min-h-0 grid-cols-1 gap-4 lg:flex-1 lg:grid-cols-[320px_minmax(0,1fr)]">
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
                <div className="mb-4 rounded-md border bg-muted/30 p-3 md:p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UserIcon className="size-3" /> 작성자
                    <span className="font-medium text-foreground">{myName}</span>
                    <span>· 발생 일시·작성시각은 자동 기록</span>
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-2">
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
                  {/* 유사 품목 동시 적용 */}
                  <div className="mt-3 rounded-md border border-dashed border-input bg-background/60 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => { setPickerSearch(""); setSimilarOnly(true); setPickerOpen(true) }}
                      >
                        <Copy className="size-3.5" />
                        유사 품목에도 적용
                      </Button>
                      <span className="text-[11px] text-muted-foreground">
                        {extraIds.size > 0
                          ? <>이 품목 포함 <span className="font-semibold text-foreground">{extraIds.size + 1}개</span> 품목에 동일하게 등록됩니다.</>
                          : "동일한 확인사항을 여러 유사 품목에 한 번에 등록할 수 있습니다."}
                      </span>
                    </div>
                    {extraProducts.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {extraProducts.map(p => (
                          <span
                            key={p.id}
                            className="inline-flex items-center gap-1 rounded-md border bg-muted/60 py-0.5 pr-1 pl-2 text-[11px] text-foreground"
                          >
                            {p.name}
                            <button
                              type="button"
                              onClick={() => toggleExtra(p.id)}
                              title="제외"
                              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-2.5 flex justify-end">
                    <Button
                      onClick={() => void handleAdd()}
                      disabled={busy || !content.trim()}
                    >
                      <Plus />
                      {extraIds.size > 0 ? `${extraIds.size + 1}개 품목에 등록` : "등록"}
                    </Button>
                  </div>
                </div>

                {/* 목록 테이블 */}
                <Card className="gap-0 overflow-hidden py-0">
                  <Table>
                    <colgroup>
                      <col className="w-[16%]" />
                      <col />
                      <col className="w-[14%]" />
                      <col className="w-[18%]" />
                      <col className="w-[8%]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        {NOTE_SORT_COLUMNS.map((col) => (
                          <TableHead key={col.key} className="px-3 text-muted-foreground">
                            <SortColumnHeader
                              col={col}
                              sortField={sortField}
                              sortDir={sortDir}
                              onPick={pickSort}
                            />
                          </TableHead>
                        ))}
                        <TableHead className="w-14 px-3 text-center text-muted-foreground">삭제</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {notes.length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                            등록된 시험 전 확인사항이 없습니다. 위 입력란에서 등록하세요.
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedNotes.map((n) => (
                          <TableRow key={n.id}>
                            <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                              <span className="block truncate" title={fmtDT(n.occurredAt)}>{fmtDT(n.occurredAt)}</span>
                            </TableCell>
                            <TableCell className="px-3 py-2.5">
                              <CellStack
                                primary={n.content}
                                secondary={n.remark || undefined}
                                primaryClass="font-medium text-foreground"
                                title={[n.content, n.remark].filter(Boolean).join(" / ")}
                              />
                            </TableCell>
                            <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                              <span className="block truncate">{n.issueLot || "—"}</span>
                            </TableCell>
                            <TableCell className="px-3 py-2.5">
                              <CellStack
                                primary={n.createdByName || "—"}
                                secondary={fmtDT(n.createdAt)}
                                title={`${n.createdByName || "—"} / ${fmtDT(n.createdAt)}`}
                              />
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

      {/* 유사 품목 선택 모달 */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>유사 품목에도 적용</DialogTitle>
            <DialogDescription>
              {selected
                ? <><span className="font-medium text-foreground">{selected.name}</span> 와(과) 함께 동일한 확인사항을 등록할 품목을 선택하세요.</>
                : "품목을 먼저 선택하세요."}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                className="cb-custom"
                checked={similarOnly}
                onChange={() => setSimilarOnly(v => !v)}
              />
              이름이 비슷한 품목만 보기
            </label>
            <button
              type="button"
              onClick={toggleAllVisible}
              disabled={pickerCandidates.length === 0}
              className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
            >
              {pickerCandidates.length > 0 && pickerCandidates.every(p => extraIds.has(p.id))
                ? "전체 해제" : "보이는 품목 전체 선택"}
            </button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="품목명 / 코드 검색..."
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              className="h-9 pl-9"
            />
          </div>

          <div className="max-h-[45vh] min-h-[120px] overflow-y-auto rounded-md border">
            {pickerCandidates.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {similarOnly ? "이름이 비슷한 품목이 없습니다. 위 체크를 해제하면 전체 품목에서 선택할 수 있습니다." : "품목이 없습니다."}
              </p>
            ) : (
              <ul className="divide-y">
                {pickerCandidates.map(p => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        className="cb-custom"
                        checked={extraIds.has(p.id)}
                        onChange={() => toggleExtra(p.id)}
                      />
                      <span className="font-mono text-[10px] font-semibold text-muted-foreground">
                        {p.productCode}
                      </span>
                      <span className="truncate text-sm font-medium text-foreground">
                        {p.name}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </DialogBody>

          <DialogFooter className="sm:items-center sm:justify-between">
            <span className="text-xs text-muted-foreground sm:mr-auto">
              <span className="font-semibold text-foreground">{extraIds.size}</span>개 추가 선택됨
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setExtraIds(new Set())} disabled={extraIds.size === 0}>
                선택 초기화
              </Button>
              <Button onClick={() => setPickerOpen(false)}>선택 완료</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
