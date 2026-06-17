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

import { useAuth } from "@frontend/lib/auth-context"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Input } from "@frontend/components/ui/input"
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden bg-slate-200/70 p-3 md:p-5">
      {/* 헤더 */}
      <div className="flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-3 py-3 shadow-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white shadow-sm">
          <ClipboardCheck size={18} />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-bold text-slate-950 sm:text-lg">
            시험 전 확인사항
          </h1>
          <p className="text-xs font-medium text-slate-600">
            품목코드·품목명별 시험 전 점검/주의사항·이슈를 일시·작성자와 함께 적재합니다.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-100 px-4 py-2 text-sm font-medium text-red-800">
          {error}
        </div>
      )}

      <div className="grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* 품목 목록 */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md max-h-[40vh] lg:max-h-none">
          <div className="border-b border-slate-200 px-4 py-3">
            <p className="mb-2 text-sm font-bold text-slate-950">품목 선택</p>
            <div className="relative">
              <Search
                size={14}
                className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-500"
              />
              <Input
                type="text"
                placeholder="품목명 / 코드 검색..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 bg-slate-50 pl-9 text-sm"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm font-medium text-slate-500">
                품목이 없습니다.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setSelected(p)}
                      className={`flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-blue-50 ${
                        selected?.id === p.id ? "bg-blue-100" : ""
                      }`}
                    >
                      <span className="font-mono text-[10px] font-bold text-blue-700">
                        {p.productCode}
                      </span>
                      <span className="truncate text-sm font-medium text-slate-800">
                        {p.name}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-slate-200 px-4 py-2 text-xs font-medium text-slate-600">
            총 <span className="font-bold text-slate-950">{filtered.length}</span>개 품목
          </div>
        </aside>

        {/* 확인사항 패널 */}
        <section className="min-h-0 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md">
          {!selected ? (
            <div className="flex min-h-[420px] items-center justify-center p-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-white shadow-sm">
                  <PackageOpen size={22} />
                </div>
                <h2 className="mt-4 text-base font-black text-slate-950">
                  품목을 선택하세요
                </h2>
                <p className="mt-2 text-sm font-medium text-slate-600">
                  좌측에서 품목을 선택하면 시험 전 확인사항을 등록·관리할 수 있습니다.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-slate-200 px-4 py-4">
                <p className="font-mono text-[10px] font-bold text-blue-700">
                  {selected.productCode}
                </p>
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-black text-slate-950">
                    {selected.name}
                  </h2>
                  <Badge className="border-blue-700 bg-blue-700 text-xs font-bold text-white hover:bg-blue-700">
                    {notes.length}건
                  </Badge>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
                {/* 입력 폼 */}
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 md:p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-600">
                    <UserIcon size={12} /> 작성자
                    <span className="font-semibold text-blue-700">{myName}</span>
                    <span className="font-normal text-slate-400">· 작성시각은 자동 기록</span>
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-[auto_auto_1fr]">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-500">일자</label>
                      <DateField value={occurredDate} onChange={setOccurredDate} size="sm" noLabel />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-500">시각</label>
                      <input
                        type="time"
                        value={occurredTime}
                        onChange={(e) => setOccurredTime(e.target.value)}
                        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-500">이슈발생 로트(제조번호)</label>
                      <Input
                        value={issueLot}
                        onChange={(e) => setIssueLot(e.target.value)}
                        placeholder="예: 26041 (선택)"
                        className="h-8 bg-white text-xs"
                      />
                    </div>
                  </div>
                  <div className="mt-2.5">
                    <label className="mb-1 block text-[11px] font-semibold text-slate-500">
                      확인사항 <span className="text-rose-600">*</span>
                    </label>
                    <Input
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="예: 표준품 유효기한 확인, 항온수조 온도 설정 등"
                      className="h-9 bg-white text-sm"
                    />
                  </div>
                  <div className="mt-2.5">
                    <label className="mb-1 block text-[11px] font-semibold text-slate-500">특이사항</label>
                    <textarea
                      value={remark}
                      onChange={(e) => setRemark(e.target.value)}
                      rows={2}
                      placeholder="특이사항·조치내용 등 (선택)"
                      className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <div className="mt-2.5 flex justify-end">
                    <Button
                      onClick={() => void handleAdd()}
                      disabled={busy || !content.trim()}
                      className="h-9 bg-blue-700 px-4 font-bold text-white shadow-sm hover:bg-blue-800"
                    >
                      <Plus size={15} className="mr-1" />
                      등록
                    </Button>
                  </div>
                </div>

                {/* 목록 테이블 */}
                <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white shadow-sm">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="bg-slate-950 text-xs text-white">
                        <th className="px-3 py-3 text-left font-bold whitespace-nowrap">일시</th>
                        <th className="px-3 py-3 text-left font-bold">확인사항</th>
                        <th className="px-3 py-3 text-left font-bold">특이사항</th>
                        <th className="px-3 py-3 text-left font-bold whitespace-nowrap">이슈 로트</th>
                        <th className="px-3 py-3 text-left font-bold whitespace-nowrap">작성자</th>
                        <th className="px-3 py-3 text-left font-bold whitespace-nowrap">작성시각</th>
                        <th className="w-14 px-3 py-3 text-center font-bold">삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {notes.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-12 text-center text-sm font-medium text-slate-500">
                            등록된 시험 전 확인사항이 없습니다. 위 입력란에서 등록하세요.
                          </td>
                        </tr>
                      ) : (
                        notes.map((n, idx) => (
                          <tr
                            key={n.id}
                            className={`border-t border-slate-200 align-top transition-colors hover:bg-blue-50 ${
                              idx % 2 === 1 ? "bg-slate-100/70" : "bg-white"
                            }`}
                          >
                            <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-slate-700">
                              {fmtDT(n.occurredAt)}
                            </td>
                            <td className="px-3 py-2.5 font-semibold whitespace-pre-wrap text-slate-950">
                              {n.content}
                            </td>
                            <td className="px-3 py-2.5 whitespace-pre-wrap text-slate-700">
                              {n.remark || <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-slate-700">
                              {n.issueLot || <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-xs font-medium text-slate-700">
                              {n.createdByName || <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5 font-mono text-[11px] whitespace-nowrap text-slate-500">
                              {fmtDT(n.createdAt)}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              <button
                                onClick={() => void handleDelete(n.id)}
                                disabled={busy}
                                title="삭제"
                                className="rounded-md bg-rose-100 p-1.5 text-rose-700 transition-colors hover:bg-rose-700 hover:text-white"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
