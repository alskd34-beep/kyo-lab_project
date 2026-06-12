"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Grid2x2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Users,
} from "lucide-react"

import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@frontend/components/ui/dialog"
import { Input } from "@frontend/components/ui/input"

interface TesterRow {
  id: string
  employeeNo: string
  name: string
  canSolo: boolean
  canDuo: boolean
  isActive: boolean
}

interface CapabilityRow {
  id: string
  code: string
  name: string
  sortOrder: number
}

type ProficiencyLevel = "Y" | "N" | "X" | "O"

interface MatrixRow {
  testerId: string
  capabilityId: string
  proficiencyLevel: ProficiencyLevel
}

const LEVEL_CYCLE: ProficiencyLevel[] = ["X", "Y", "O", "N"]

const LEVEL_STYLE: Record<ProficiencyLevel, string> = {
  O: "border-blue-300 bg-blue-700 text-white",
  Y: "border-emerald-300 bg-emerald-700 text-white",
  N: "border-rose-300 bg-rose-700 text-white",
  X: "border-slate-300 bg-slate-100 text-slate-500",
}

const LEVEL_LABEL: Record<ProficiencyLevel, string> = {
  O: "우수",
  Y: "가능",
  N: "불가",
  X: "-",
}

type TabId = "testers" | "capability"

const dialogInputClass =
  "h-10 border-slate-300 bg-white text-slate-950 placeholder:text-slate-500 focus-visible:border-blue-600 focus-visible:ring-blue-200"

export default function TestersPage() {
  const [activeTab, setActiveTab] = useState<TabId>("testers")
  const [testers, setTesters] = useState<TesterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([])
  const [matrix, setMatrix] = useState<MatrixRow[]>([])
  const [capLoading, setCapLoading] = useState(false)
  const [capLoaded, setCapLoaded] = useState(false)
  const [savingCell, setSavingCell] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selected, setSelected] = useState<TesterRow | null>(null)
  const [form, setForm] = useState({
    employeeNo: "",
    name: "",
    canSolo: true,
    canDuo: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const [sortField, setSortField] = useState<"employeeNo" | "name">(
    "employeeNo"
  )
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  useEffect(() => {
    void fetchTesters()
  }, [])

  async function fetchTesters() {
    setLoading(true)
    try {
      const res = await fetch("/api/testers")
      const json = (await res.json()) as { rows?: TesterRow[] }
      setTesters(json.rows ?? [])
    } finally {
      setLoading(false)
    }
  }

  const fetchCapabilities = useCallback(async () => {
    if (capLoaded) return
    setCapLoading(true)
    try {
      const res = await fetch("/api/tester-capabilities")
      const json = (await res.json()) as {
        capabilities?: CapabilityRow[]
        matrix?: MatrixRow[]
      }
      setCapabilities(json.capabilities ?? [])
      setMatrix(json.matrix ?? [])
      setCapLoaded(true)
    } finally {
      setCapLoading(false)
    }
  }, [capLoaded])

  useEffect(() => {
    if (activeTab === "capability") void fetchCapabilities()
  }, [activeTab, fetchCapabilities])

  function openAdd() {
    setForm({ employeeNo: "", name: "", canSolo: true, canDuo: false })
    setError("")
    setAddOpen(true)
  }

  function openEdit(row: TesterRow) {
    setSelected(row)
    setForm({
      employeeNo: row.employeeNo,
      name: row.name,
      canSolo: row.canSolo,
      canDuo: row.canDuo,
    })
    setError("")
    setEditOpen(true)
  }

  function openDelete(row: TesterRow) {
    setSelected(row)
    setError("")
    setDeleteOpen(true)
  }

  async function handleAdd() {
    if (!form.employeeNo.trim() || !form.name.trim()) {
      setError("사번과 이름을 입력하세요.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/testers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const json = (await res.json()) as { error?: string; row?: TesterRow }
      if (!res.ok) {
        setError(json.error ?? "저장 실패")
        return
      }
      setTesters((prev) => [...prev, json.row as TesterRow])
      setAddOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!selected) return
    if (!form.employeeNo.trim() || !form.name.trim()) {
      setError("사번과 이름을 입력하세요.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/testers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id, ...form }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? "저장 실패")
        return
      }
      setTesters((prev) =>
        prev.map((tester) =>
          tester.id === selected.id ? { ...tester, ...form } : tester
        )
      )
      setEditOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch("/api/testers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selected.id }),
      })
      if (res.ok) {
        setTesters((prev) => prev.filter((tester) => tester.id !== selected.id))
        setMatrix((prev) => prev.filter((row) => row.testerId !== selected.id))
        setDeleteOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(row: TesterRow) {
    const next = !row.isActive
    setTesters((prev) =>
      prev.map((tester) =>
        tester.id === row.id ? { ...tester, isActive: next } : tester
      )
    )
    await fetch("/api/testers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, isActive: next }),
    })
  }

  function getLevel(testerId: string, capabilityId: string): ProficiencyLevel {
    return (
      matrix.find(
        (row) => row.testerId === testerId && row.capabilityId === capabilityId
      )?.proficiencyLevel ?? "X"
    )
  }

  async function cycleLevel(tester: TesterRow, capability: CapabilityRow) {
    const current = getLevel(tester.id, capability.id)
    const next =
      LEVEL_CYCLE[(LEVEL_CYCLE.indexOf(current) + 1) % LEVEL_CYCLE.length]
    const key = `${tester.id}_${capability.id}`
    setSavingCell(key)

    setMatrix((prev) => {
      const exists = prev.find(
        (row) =>
          row.testerId === tester.id && row.capabilityId === capability.id
      )
      if (exists) {
        return prev.map((row) =>
          row.testerId === tester.id && row.capabilityId === capability.id
            ? { ...row, proficiencyLevel: next }
            : row
        )
      }
      return [
        ...prev,
        {
          testerId: tester.id,
          capabilityId: capability.id,
          proficiencyLevel: next,
        },
      ]
    })

    try {
      await fetch("/api/tester-capabilities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testerId: tester.id,
          capabilityId: capability.id,
          proficiencyLevel: next,
        }),
      })
    } finally {
      setSavingCell(null)
    }
  }

  const sortedTesters = useMemo(() => {
    return [...testers].sort((a, b) => {
      const va = sortField === "employeeNo" ? a.employeeNo : a.name
      const vb = sortField === "employeeNo" ? b.employeeNo : b.name
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va)
    })
  }, [testers, sortDir, sortField])

  const activeTesters = useMemo(
    () => sortedTesters.filter((tester) => tester.isActive),
    [sortedTesters]
  )

  const summary = useMemo(() => {
    const active = testers.filter((tester) => tester.isActive).length
    const solo = testers.filter(
      (tester) => tester.isActive && tester.canSolo
    ).length
    const duo = testers.filter(
      (tester) => tester.isActive && tester.canDuo
    ).length
    return { active, solo, duo }
  }, [testers])

  function toggleSort(field: "employeeNo" | "name") {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))
      return
    }
    setSortField(field)
    setSortDir("asc")
  }

  function SortIcon({ field }: { field: "employeeNo" | "name" }) {
    if (sortField !== field) {
      return (
        <span className="ml-1 opacity-40">
          <ChevronDown size={11} />
        </span>
      )
    }
    return sortDir === "asc" ? (
      <ChevronUp size={11} className="ml-1 text-blue-700" />
    ) : (
      <ChevronDown size={11} className="ml-1 text-blue-700" />
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 bg-slate-200/70 p-3 md:p-5">
      <div className="flex flex-col gap-2 rounded-lg border border-slate-300 bg-white px-3 py-3 shadow-sm md:flex-row md:items-center md:gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white shadow-sm">
            {activeTab === "testers" ? (
              <Users size={18} />
            ) : (
              <Grid2x2 size={18} />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="min-w-0 text-base font-bold text-slate-950 sm:text-lg">
              {activeTab === "testers" ? "시험자 관리" : "시험자 역량"}
            </h1>
            <p className="text-xs font-medium text-slate-600">
              {activeTab === "testers"
                ? "시험자 정보와 활성 상태를 관리합니다."
                : "활성 시험자의 역량 매트릭스를 관리합니다."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 md:ml-auto">
          {[
            { id: "testers", label: "시험자 관리" },
            { id: "capability", label: "시험자 역량" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabId)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                activeTab === tab.id
                  ? "bg-blue-700 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "testers" && (
          <Button
            onClick={openAdd}
            size="sm"
            className="h-9 w-full bg-blue-700 text-white shadow-sm hover:bg-blue-800 md:w-auto"
          >
            <Plus size={15} className="mr-1" />
            시험자 추가
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-l-4 border-slate-300 border-l-blue-700 bg-white px-4 py-3 shadow-sm">
          <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
            활성 시험자
          </p>
          <p className="text-3xl font-black text-slate-950">{summary.active}</p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-600">
            전체{" "}
            <span className="font-bold text-blue-700">{testers.length}</span>명
            중
          </p>
        </div>
        <div className="rounded-lg border border-l-4 border-slate-300 border-l-emerald-700 bg-white px-4 py-3 shadow-sm">
          <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
            단독 가능
          </p>
          <p className="text-3xl font-black text-emerald-700">{summary.solo}</p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-600">
            활성 기준
          </p>
        </div>
        <div className="rounded-lg border border-l-4 border-slate-300 border-l-amber-600 bg-white px-4 py-3 shadow-sm">
          <p className="mb-1.5 text-[11px] font-bold tracking-wide text-slate-600 uppercase">
            2인 가능
          </p>
          <p className="text-3xl font-black text-amber-700">{summary.duo}</p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-600">
            활성 기준
          </p>
        </div>
      </div>

      {activeTab === "testers" && (
        <>
          <div className="flex flex-col gap-2 md:hidden">
            {loading ? (
              <div className="rounded-lg border border-slate-300 bg-white p-6 text-center text-sm font-medium text-slate-600">
                불러오는 중...
              </div>
            ) : sortedTesters.length === 0 ? (
              <div className="rounded-lg border border-slate-300 bg-white p-6 text-center text-sm font-medium text-slate-600">
                등록된 시험자가 없습니다.
              </div>
            ) : (
              sortedTesters.map((tester, idx) => (
                <div
                  key={tester.id}
                  className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-500">
                          #{idx + 1}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-blue-800">
                          {tester.employeeNo}
                        </span>
                        <Badge
                          className={
                            tester.isActive
                              ? "border-emerald-700 bg-emerald-700 text-[10px] font-bold text-white hover:bg-emerald-700"
                              : "border-slate-600 bg-slate-600 text-[10px] font-bold text-white hover:bg-slate-600"
                          }
                        >
                          {tester.isActive ? "활성" : "비활성"}
                        </Badge>
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-950">
                        {tester.name}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => openEdit(tester)}
                        className="rounded-md bg-blue-100 p-1.5 text-blue-700 transition-colors hover:bg-blue-700 hover:text-white"
                        title="수정"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => openDelete(tester)}
                        className="rounded-md bg-rose-100 p-1.5 text-rose-700 transition-colors hover:bg-rose-700 hover:text-white"
                        title="삭제"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2">
                    <span
                      className={
                        tester.canSolo
                          ? "inline-block rounded-full border border-emerald-300 bg-emerald-700 px-2 py-0.5 text-[10px] font-bold text-white"
                          : "inline-block rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500"
                      }
                    >
                      {tester.canSolo ? "단독 가능" : "단독 불가"}
                    </span>
                    <span
                      className={
                        tester.canDuo
                          ? "inline-block rounded-full border border-amber-300 bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white"
                          : "inline-block rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500"
                      }
                    >
                      {tester.canDuo ? "2인 가능" : "2인 불가"}
                    </span>
                    <button
                      onClick={() => void toggleActive(tester)}
                      className="ml-auto rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 transition-colors hover:bg-slate-200"
                    >
                      상태 전환
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="hidden overflow-auto rounded-lg border border-slate-300 bg-white shadow-md md:block">
            {loading ? (
              <div className="p-16 text-center text-sm font-medium text-slate-600">
                불러오는 중...
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-950 text-xs text-white">
                    <th className="sticky top-0 z-10 w-14 bg-slate-950 px-4 py-3 text-left font-bold">
                      순번
                    </th>
                    <th
                      className="sticky top-0 z-10 w-28 cursor-pointer bg-slate-950 px-4 py-3 text-left font-bold"
                      onClick={() => toggleSort("employeeNo")}
                    >
                      <span className="flex items-center">
                        사번 <SortIcon field="employeeNo" />
                      </span>
                    </th>
                    <th
                      className="sticky top-0 z-10 cursor-pointer bg-slate-950 px-4 py-3 text-left font-bold"
                      onClick={() => toggleSort("name")}
                    >
                      <span className="flex items-center">
                        이름 <SortIcon field="name" />
                      </span>
                    </th>
                    <th className="sticky top-0 z-10 w-24 bg-slate-950 px-4 py-3 text-center font-bold">
                      단독시험
                    </th>
                    <th className="sticky top-0 z-10 w-24 bg-slate-950 px-4 py-3 text-center font-bold">
                      2인시험
                    </th>
                    <th className="sticky top-0 z-10 w-20 bg-slate-950 px-4 py-3 text-center font-bold">
                      상태
                    </th>
                    <th className="sticky top-0 z-10 w-24 bg-slate-950 px-4 py-3 text-center font-bold">
                      관리
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTesters.map((tester, idx) => (
                    <tr
                      key={tester.id}
                      className={`border-t border-slate-200 transition-colors hover:bg-blue-50 ${
                        idx % 2 === 1 ? "bg-slate-100/80" : "bg-white"
                      }`}
                    >
                      <td className="px-4 py-2.5 text-xs font-semibold text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-blue-800">
                        {tester.employeeNo}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-950">
                        {tester.name}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={
                            tester.canSolo
                              ? "inline-block rounded-full border border-emerald-300 bg-emerald-700 px-2 py-0.5 text-[11px] font-bold text-white"
                              : "inline-block rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                          }
                        >
                          {tester.canSolo ? "가능" : "불가"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={
                            tester.canDuo
                              ? "inline-block rounded-full border border-amber-300 bg-amber-600 px-2 py-0.5 text-[11px] font-bold text-white"
                              : "inline-block rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500"
                          }
                        >
                          {tester.canDuo ? "가능" : "불가"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => void toggleActive(tester)}
                          className={
                            tester.isActive
                              ? "inline-block rounded-full border border-emerald-300 bg-emerald-700 px-2 py-0.5 text-[11px] font-bold text-white transition-colors hover:bg-emerald-800"
                              : "inline-block rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700 transition-colors hover:bg-slate-200"
                          }
                        >
                          {tester.isActive ? "활성" : "비활성"}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEdit(tester)}
                            className="rounded-md bg-blue-100 p-1.5 text-blue-700 transition-colors hover:bg-blue-700 hover:text-white"
                            title="수정"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => openDelete(tester)}
                            className="rounded-md bg-rose-100 p-1.5 text-rose-700 transition-colors hover:bg-rose-700 hover:text-white"
                            title="삭제"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {testers.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-16 text-center text-sm font-medium text-slate-600"
                      >
                        등록된 시험자가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {activeTab === "capability" && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
            <span className="font-bold text-slate-700">범례</span>
            {(["O", "Y", "N", "X"] as ProficiencyLevel[]).map((level) => (
              <span key={level} className="flex items-center gap-1">
                <span
                  className={`inline-flex h-5 w-8 items-center justify-center rounded border text-[11px] font-bold ${LEVEL_STYLE[level]}`}
                >
                  {level}
                </span>
                <span>{LEVEL_LABEL[level]}</span>
              </span>
            ))}
            <span className="text-slate-500">셀 클릭으로 순환 변경</span>
          </div>

          {capLoading ? (
            <div className="rounded-lg border border-slate-300 bg-white p-6 text-center text-sm font-medium text-slate-600">
              불러오는 중...
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 md:hidden">
                {activeTesters.length === 0 ? (
                  <div className="rounded-lg border border-slate-300 bg-white p-6 text-center text-sm font-medium text-slate-600">
                    활성 시험자가 없습니다.
                  </div>
                ) : (
                  activeTesters.map((tester) => (
                    <div
                      key={tester.id}
                      className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm"
                    >
                      <div className="mb-2 border-b border-slate-200 pb-2">
                        <p className="text-sm font-bold text-slate-950">
                          {tester.name}
                        </p>
                        <p className="font-mono text-[11px] font-semibold text-blue-800">
                          {tester.employeeNo}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
                        {capabilities.map((capability) => {
                          const level = getLevel(tester.id, capability.id)
                          const key = `${tester.id}_${capability.id}`
                          const isSaving = savingCell === key
                          return (
                            <button
                              key={capability.id}
                              onClick={() =>
                                void cycleLevel(tester, capability)
                              }
                              disabled={isSaving}
                              className={`flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-left transition-colors ${
                                isSaving
                                  ? "cursor-wait opacity-50"
                                  : "hover:border-blue-300 hover:bg-blue-50"
                              }`}
                            >
                              <span className="flex-1 truncate text-[11px] font-medium text-slate-800">
                                {capability.name}
                              </span>
                              <span
                                className={`inline-flex h-6 w-8 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${LEVEL_STYLE[level]}`}
                              >
                                {level}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="hidden overflow-auto rounded-lg border border-slate-300 bg-white shadow-md md:block">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-950 text-white">
                      <th className="sticky top-0 left-0 z-20 min-w-[100px] border-r border-slate-700 bg-slate-950 px-3 py-3 text-left font-bold">
                        이름
                      </th>
                      <th className="sticky top-0 left-[100px] z-20 w-24 border-r border-slate-700 bg-slate-950 px-3 py-3 text-center font-bold">
                        사번
                      </th>
                      {capabilities.map((capability) => (
                        <th
                          key={capability.id}
                          className="sticky top-0 z-10 min-w-[68px] border-r border-slate-700 bg-slate-950 px-2 py-3 text-center font-bold"
                        >
                          {capability.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeTesters.map((tester, rowIndex) => (
                      <tr
                        key={tester.id}
                        className={
                          rowIndex % 2 === 0 ? "bg-white" : "bg-slate-100/80"
                        }
                      >
                        <td
                          className={`sticky left-0 z-10 border-r border-slate-200 px-3 py-2.5 font-semibold text-slate-950 ${
                            rowIndex % 2 === 0 ? "bg-white" : "bg-slate-100"
                          }`}
                        >
                          {tester.name}
                        </td>
                        <td
                          className={`sticky left-[100px] z-10 border-r border-slate-200 px-3 py-2.5 text-center font-mono text-slate-700 ${
                            rowIndex % 2 === 0 ? "bg-white" : "bg-slate-100"
                          }`}
                        >
                          {tester.employeeNo}
                        </td>
                        {capabilities.map((capability) => {
                          const level = getLevel(tester.id, capability.id)
                          const key = `${tester.id}_${capability.id}`
                          const isSaving = savingCell === key
                          return (
                            <td
                              key={capability.id}
                              className="border-r border-slate-200 p-1.5 text-center"
                            >
                              <button
                                onClick={() =>
                                  void cycleLevel(tester, capability)
                                }
                                disabled={isSaving}
                                className={`inline-flex h-7 w-11 items-center justify-center rounded border text-[11px] font-bold transition-transform ${
                                  isSaving
                                    ? "cursor-wait opacity-50"
                                    : "hover:scale-105"
                                } ${LEVEL_STYLE[level]}`}
                                title={`${tester.name} / ${capability.name}: ${LEVEL_LABEL[level]}`}
                              >
                                {level}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {activeTesters.length === 0 && (
                      <tr>
                        <td
                          colSpan={capabilities.length + 2}
                          className="py-16 text-center text-sm font-medium text-slate-600"
                        >
                          활성 시험자가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden border-slate-300 bg-slate-50 p-0 shadow-2xl sm:max-w-xl">
          <DialogHeader className="border-b border-slate-200 bg-white px-4 py-4 pr-12 text-left sm:px-5">
            <DialogTitle className="text-lg font-black text-slate-950">
              시험자 추가
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs font-medium text-slate-600">
              시험자 기본 정보와 시험 가능 범위를 등록합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65dvh] overflow-y-auto px-4 py-4 sm:px-5">
            <div className="grid gap-4">
              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="mb-3 border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-black text-slate-950">
                    기본 정보
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold tracking-wide text-slate-700">
                      사번 <span className="text-rose-600">*</span>
                    </label>
                    <Input
                      className={dialogInputClass}
                      placeholder="예: 16242"
                      value={form.employeeNo}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          employeeNo: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold tracking-wide text-slate-700">
                      이름 <span className="text-rose-600">*</span>
                    </label>
                    <Input
                      className={dialogInputClass}
                      placeholder="홍길동"
                      value={form.name}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="mb-3 border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-black text-slate-950">
                    시험 가능 범위
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={form.canSolo}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          canSolo: e.target.checked,
                        }))
                      }
                      className="cb-custom"
                    />
                    단독 시험 가능
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={form.canDuo}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          canDuo: e.target.checked,
                        }))
                      }
                      className="cb-custom"
                    />
                    2인 시험 가능
                  </label>
                </div>
              </section>

              {error && (
                <div className="rounded-lg border border-red-300 bg-red-100 px-4 py-2 text-sm font-medium text-red-800">
                  {error}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(false)}
              className="h-10 border-slate-300 text-slate-800 hover:bg-slate-100"
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={() => void handleAdd()}
              disabled={saving}
              className="h-10 bg-blue-700 px-5 font-bold text-white shadow-sm hover:bg-blue-800"
            >
              <Save size={15} className="mr-1.5" />
              {saving ? "저장 중..." : "추가"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden border-slate-300 bg-slate-50 p-0 shadow-2xl sm:max-w-xl">
          <DialogHeader className="border-b border-slate-200 bg-white px-4 py-4 pr-12 text-left sm:px-5">
            <DialogTitle className="text-lg font-black text-slate-950">
              시험자 수정
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs font-medium text-slate-600">
              시험자 정보와 시험 가능 범위를 수정합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65dvh] overflow-y-auto px-4 py-4 sm:px-5">
            <div className="grid gap-4">
              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="mb-3 border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-black text-slate-950">
                    기본 정보
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold tracking-wide text-slate-700">
                      사번 <span className="text-rose-600">*</span>
                    </label>
                    <Input
                      className={dialogInputClass}
                      value={form.employeeNo}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          employeeNo: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold tracking-wide text-slate-700">
                      이름 <span className="text-rose-600">*</span>
                    </label>
                    <Input
                      className={dialogInputClass}
                      value={form.name}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="mb-3 border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-black text-slate-950">
                    시험 가능 범위
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={form.canSolo}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          canSolo: e.target.checked,
                        }))
                      }
                      className="cb-custom"
                    />
                    단독 시험 가능
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={form.canDuo}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          canDuo: e.target.checked,
                        }))
                      }
                      className="cb-custom"
                    />
                    2인 시험 가능
                  </label>
                </div>
              </section>

              {error && (
                <div className="rounded-lg border border-red-300 bg-red-100 px-4 py-2 text-sm font-medium text-red-800">
                  {error}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(false)}
              className="h-10 border-slate-300 text-slate-800 hover:bg-slate-100"
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={() => void handleEdit()}
              disabled={saving}
              className="h-10 bg-blue-700 px-5 font-bold text-white shadow-sm hover:bg-blue-800"
            >
              <Save size={15} className="mr-1.5" />
              {saving ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden border-slate-300 bg-white p-0 shadow-2xl sm:max-w-md">
          <DialogHeader className="border-b border-slate-200 bg-rose-50 px-4 py-4 pr-12 text-left sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-700 text-white shadow-sm">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-black text-slate-950">
                  시험자 삭제
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs font-medium text-rose-800">
                  역량 데이터도 함께 삭제됩니다.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-4 py-4 sm:px-5">
            <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-4">
              <p className="text-sm font-bold text-slate-950">
                {selected?.name}
              </p>
              <p className="mt-1 font-mono text-xs font-semibold text-rose-800">
                {selected?.employeeNo}
              </p>
              <p className="mt-3 text-sm font-medium text-slate-700">
                이 시험자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
              </p>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 bg-white px-4 py-4 sm:px-5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(false)}
              className="h-10 border-slate-300 text-slate-800 hover:bg-slate-100"
            >
              취소
            </Button>
            <Button
              size="sm"
              onClick={() => void handleDelete()}
              disabled={saving}
              className="h-10 bg-rose-700 px-5 font-bold text-white shadow-sm hover:bg-rose-800"
            >
              <Trash2 size={15} className="mr-1.5" />
              {saving ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
