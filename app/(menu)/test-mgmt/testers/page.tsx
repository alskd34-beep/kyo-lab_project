'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Users, ChevronDown, ChevronUp } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@frontend/components/ui/dialog'
import { Button } from '@frontend/components/ui/button'
import { Input } from '@frontend/components/ui/input'

// ─── Types ────────────────────────────────────────────────────────────────────
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

type ProficiencyLevel = 'Y' | 'N' | 'X' | 'O'

interface MatrixRow {
  testerId: string
  capabilityId: string
  proficiencyLevel: ProficiencyLevel
}

// ─── Constants ────────────────────────────────────────────────────────────────
const LEVEL_CYCLE: ProficiencyLevel[] = ['X', 'Y', 'O', 'N']

const LEVEL_STYLE: Record<ProficiencyLevel, string> = {
  O: 'bg-blue-100 text-blue-700 font-bold',
  Y: 'bg-emerald-100 text-emerald-700 font-semibold',
  N: 'bg-red-100 text-red-600',
  X: 'bg-slate-100 text-slate-400',
}

const LEVEL_LABEL: Record<ProficiencyLevel, string> = {
  O: '우수',
  Y: '가능',
  N: '불가',
  X: '-',
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TestersPage() {
  const [activeTab, setActiveTab] = useState<'testers' | 'capability'>('testers')

  // ── Tester data ──────────────────────────────────────────────────────────
  const [testers, setTesters]       = useState<TesterRow[]>([])
  const [loading, setLoading]       = useState(true)

  // ── Capability data ──────────────────────────────────────────────────────
  const [capabilities, setCapabilities] = useState<CapabilityRow[]>([])
  const [matrix, setMatrix]             = useState<MatrixRow[]>([])
  const [capLoading, setCapLoading]     = useState(false)
  const [capLoaded, setCapLoaded]       = useState(false)
  const [savingCell, setSavingCell]     = useState<string | null>(null)

  // ── Tester dialog ────────────────────────────────────────────────────────
  const [addOpen,    setAddOpen]    = useState(false)
  const [editOpen,   setEditOpen]   = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selected,   setSelected]   = useState<TesterRow | null>(null)

  const [form, setForm] = useState({ employeeNo: '', name: '', canSolo: true, canDuo: false })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  // ── Sort state ────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<'employeeNo' | 'name'>('employeeNo')
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc')

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalActive   = testers.filter(t => t.isActive).length
  const soloCount     = testers.filter(t => t.canSolo && t.isActive).length
  const duoCount      = testers.filter(t => t.canDuo && t.isActive).length

  const fetchTesters = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/testers')
      const json = await res.json()
      setTesters(json.rows ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchCapabilities = useCallback(async () => {
    if (capLoaded) return
    setCapLoading(true)
    try {
      const res  = await fetch('/api/tester-capabilities')
      const json = await res.json()
      setCapabilities(json.capabilities ?? [])
      setMatrix(json.matrix ?? [])
      setCapLoaded(true)
    } finally {
      setCapLoading(false)
    }
  }, [capLoaded])

  useEffect(() => { void fetchTesters() }, [fetchTesters])

  useEffect(() => {
    if (activeTab === 'capability') void fetchCapabilities()
  }, [activeTab, fetchCapabilities])

  // ── Tester CRUD ───────────────────────────────────────────────────────────
  function openAdd() {
    setForm({ employeeNo: '', name: '', canSolo: true, canDuo: false })
    setError('')
    setAddOpen(true)
  }

  function openEdit(row: TesterRow) {
    setSelected(row)
    setForm({ employeeNo: row.employeeNo, name: row.name, canSolo: row.canSolo, canDuo: row.canDuo })
    setError('')
    setEditOpen(true)
  }

  function openDelete(row: TesterRow) {
    setSelected(row)
    setDeleteOpen(true)
  }

  async function handleAdd() {
    if (!form.employeeNo.trim() || !form.name.trim()) { setError('사번과 이름을 입력하세요'); return }
    setSaving(true); setError('')
    try {
      const res  = await fetch('/api/testers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? '저장 실패'); return }
      setTesters(prev => [...prev, json.row])
      setAddOpen(false)
    } finally { setSaving(false) }
  }

  async function handleEdit() {
    if (!selected) return
    if (!form.employeeNo.trim() || !form.name.trim()) { setError('사번과 이름을 입력하세요'); return }
    setSaving(true); setError('')
    try {
      const res  = await fetch('/api/testers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id, ...form }) })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? '저장 실패'); return }
      setTesters(prev => prev.map(t => t.id === selected.id ? { ...t, ...form } : t))
      setEditOpen(false)
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch('/api/testers', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: selected.id }) })
      if (res.ok) {
        setTesters(prev => prev.filter(t => t.id !== selected.id))
        setMatrix(prev => prev.filter(m => m.testerId !== selected.id))
        setDeleteOpen(false)
      }
    } finally { setSaving(false) }
  }

  async function toggleActive(row: TesterRow) {
    const next = !row.isActive
    setTesters(prev => prev.map(t => t.id === row.id ? { ...t, isActive: next } : t))
    await fetch('/api/testers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, isActive: next }) })
  }

  // ── Capability matrix ─────────────────────────────────────────────────────
  function getLevel(testerId: string, capId: string): ProficiencyLevel {
    return matrix.find(m => m.testerId === testerId && m.capabilityId === capId)?.proficiencyLevel ?? 'X'
  }

  async function cycleLevel(tester: TesterRow, cap: CapabilityRow) {
    const cur   = getLevel(tester.id, cap.id)
    const next  = LEVEL_CYCLE[(LEVEL_CYCLE.indexOf(cur) + 1) % LEVEL_CYCLE.length]
    const key   = `${tester.id}_${cap.id}`
    setSavingCell(key)

    setMatrix(prev => {
      const exists = prev.find(m => m.testerId === tester.id && m.capabilityId === cap.id)
      if (exists) return prev.map(m => m.testerId === tester.id && m.capabilityId === cap.id ? { ...m, proficiencyLevel: next } : m)
      return [...prev, { testerId: tester.id, capabilityId: cap.id, proficiencyLevel: next }]
    })

    try {
      await fetch('/api/tester-capabilities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testerId: tester.id, capabilityId: cap.id, proficiencyLevel: next }),
      })
    } finally { setSavingCell(null) }
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  const sortedTesters = [...testers].sort((a, b) => {
    const va = sortField === 'employeeNo' ? a.employeeNo : a.name
    const vb = sortField === 'employeeNo' ? b.employeeNo : b.name
    return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
  })

  function toggleSort(field: 'employeeNo' | 'name') {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  function SortIcon({ field }: { field: 'employeeNo' | 'name' }) {
    if (sortField !== field) return <span className="ml-1 opacity-30"><ChevronDown size={11} /></span>
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="ml-1 text-blue-500" />
      : <ChevronDown size={11} className="ml-1 text-blue-500" />
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 shadow">
              <Users size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">시험자 관리</h2>
              <p className="text-xs text-slate-500">시험자 정보 및 역량 관리</p>
            </div>
          </div>
          {activeTab === 'testers' && (
            <Button onClick={openAdd} size="sm" className="h-8 gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs w-full md:w-auto">
              <Plus size={13} /> 시험자 추가
            </Button>
          )}
        </div>

        {/* Summary cards */}
        <div className="mt-4 grid grid-cols-3 gap-2 md:gap-3">
          {[
            { label: '전체 시험자', value: totalActive, sub: `총 ${testers.length}명`, color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
            { label: '단독 가능', value: soloCount, sub: `활성 기준`, color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
            { label: '2인 가능', value: duoCount, sub: `활성 기준`, color: 'bg-amber-50 border-amber-200 text-amber-700' },
          ].map(c => (
            <div key={c.label} className={`rounded-xl border px-4 py-3 ${c.color}`}>
              <p className="text-xs font-medium opacity-70">{c.label}</p>
              <p className="text-2xl font-bold mt-0.5">{c.value}<span className="text-xs font-normal ml-1">명</span></p>
              <p className="text-[11px] opacity-60 mt-0.5">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-1 border-b border-slate-200">
          {[
            { id: 'testers',    label: '시험자 관리' },
            { id: 'capability', label: '시험자 역량' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {/* ── Tab 1: 시험자 관리 ── */}
        {activeTab === 'testers' && (
          <>
          {/* Mobile card view */}
          <div className="md:hidden flex flex-col gap-2">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-slate-400 text-sm">불러오는 중...</div>
            ) : sortedTesters.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400 bg-white rounded-xl border border-slate-200">등록된 시험자가 없습니다</div>
            ) : (
              sortedTesters.map((t, i) => (
                <div key={t.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400">#{i + 1}</span>
                        <span className="font-mono text-xs text-slate-500">{t.employeeNo}</span>
                      </div>
                      <p className="mt-0.5 text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(t)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        title="수정"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => openDelete(t)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                        title="삭제"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    {t.canSolo
                      ? <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">단독 가능</span>
                      : <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400">단독 불가</span>}
                    {t.canDuo
                      ? <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">2인 가능</span>
                      : <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400">2인 불가</span>}
                    <button
                      onClick={() => void toggleActive(t)}
                      className={`ml-auto inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                        t.isActive
                          ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                      }`}
                    >
                      {t.isActive ? '활성' : '비활성'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-slate-400 text-sm">불러오는 중...</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 w-12">순번</th>
                    <th
                      className="px-4 py-3 text-left text-xs font-semibold text-slate-500 w-28 cursor-pointer select-none"
                      onClick={() => toggleSort('employeeNo')}
                    >
                      <span className="flex items-center">사번 <SortIcon field="employeeNo" /></span>
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-semibold text-slate-500 cursor-pointer select-none"
                      onClick={() => toggleSort('name')}
                    >
                      <span className="flex items-center">이름 <SortIcon field="name" /></span>
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 w-24">단독시험</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 w-24">2인시험</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 w-20">상태</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 w-24">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTesters.map((t, i) => (
                    <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-xs text-slate-400">{i + 1}</td>
                      <td className="px-4 py-3 text-xs font-mono text-slate-600">{t.employeeNo}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                      <td className="px-4 py-3 text-center">
                        {t.canSolo
                          ? <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">가능</span>
                          : <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400">불가</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {t.canDuo
                          ? <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">가능</span>
                          : <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400">불가</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => void toggleActive(t)}
                          className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                            t.isActive
                              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          {t.isActive ? '활성' : '비활성'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEdit(t)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                            title="수정"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => openDelete(t)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                            title="삭제"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {testers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-sm text-slate-400">등록된 시험자가 없습니다</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
          </>
        )}

        {/* ── Tab 2: 시험자 역량 ── */}
        {activeTab === 'capability' && (
          <div>
            {/* Legend */}
            <div className="mb-3 flex items-center gap-2 md:gap-3 text-xs text-slate-500 flex-wrap">
              <span className="font-medium text-slate-600">범례:</span>
              {(['O', 'Y', 'N', 'X'] as ProficiencyLevel[]).map(l => (
                <span key={l} className="flex items-center gap-1">
                  <span className={`inline-flex h-5 w-8 items-center justify-center rounded text-[11px] ${LEVEL_STYLE[l]}`}>{l}</span>
                  <span>{LEVEL_LABEL[l]}</span>
                </span>
              ))}
              <span className="ml-2 text-slate-400">※ 셀 클릭으로 변경</span>
            </div>

            {capLoading ? (
              <div className="flex items-center justify-center py-20 text-slate-400 text-sm">불러오는 중...</div>
            ) : (
              <>
              {/* Mobile card view */}
              <div className="md:hidden flex flex-col gap-3">
                {sortedTesters.filter(t => t.isActive).length === 0 ? (
                  <div className="py-12 text-center text-slate-400 bg-white rounded-xl border border-slate-200">활성 시험자가 없습니다</div>
                ) : (
                  sortedTesters.filter(t => t.isActive).map(tester => (
                    <div key={tester.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
                      <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
                        <p className="text-sm font-semibold text-slate-800">{tester.name}</p>
                        <p className="font-mono text-[11px] text-slate-500">{tester.employeeNo}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {capabilities.map(cap => {
                          const level = getLevel(tester.id, cap.id)
                          const key = `${tester.id}_${cap.id}`
                          const isSaving = savingCell === key
                          return (
                            <button
                              key={cap.id}
                              onClick={() => void cycleLevel(tester, cap)}
                              disabled={isSaving}
                              className={`flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2 py-1.5 transition-all ${
                                isSaving ? 'opacity-50 cursor-wait' : 'hover:border-indigo-200 active:scale-95'
                              }`}
                            >
                              <span className="text-[11px] text-slate-700 truncate text-left flex-1">{cap.name}</span>
                              <span className={`inline-flex h-5 w-7 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${LEVEL_STYLE[level]}`}>
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

              {/* Desktop matrix view */}
              <div className="hidden md:block overflow-auto rounded-xl border border-slate-200 shadow-sm bg-white">
                <table className="text-xs border-collapse" style={{ minWidth: '100%' }}>
                  <thead>
                    <tr className="bg-slate-800 text-white sticky top-0 z-10">
                      <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap border-r border-slate-600 min-w-[90px] sticky left-0 bg-slate-800 z-20">
                        이름
                      </th>
                      <th className="px-2 py-2.5 text-center font-semibold whitespace-nowrap border-r border-slate-600 w-20 sticky left-[90px] bg-slate-800 z-20">
                        사번
                      </th>
                      {capabilities.map(cap => (
                        <th key={cap.id} className="px-1 py-2.5 text-center font-semibold whitespace-nowrap border-r border-slate-600 min-w-[60px]">
                          {cap.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTesters.filter(t => t.isActive).map((tester, ri) => (
                      <tr key={tester.id} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                        <td className={`px-3 py-2 font-medium text-slate-800 border-r border-slate-100 whitespace-nowrap sticky left-0 z-10 ${ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                          {tester.name}
                        </td>
                        <td className={`px-2 py-2 text-center font-mono text-slate-500 border-r border-slate-100 whitespace-nowrap sticky left-[90px] z-10 ${ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                          {tester.employeeNo}
                        </td>
                        {capabilities.map(cap => {
                          const level = getLevel(tester.id, cap.id)
                          const key   = `${tester.id}_${cap.id}`
                          const isSaving = savingCell === key
                          return (
                            <td key={cap.id} className="p-1 text-center border-r border-slate-100">
                              <button
                                onClick={() => void cycleLevel(tester, cap)}
                                disabled={isSaving}
                                className={`inline-flex h-6 w-11 items-center justify-center rounded text-[11px] font-semibold transition-all ${
                                  isSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:scale-110 hover:shadow-sm'
                                } ${LEVEL_STYLE[level]}`}
                                title={`${tester.name} / ${cap.name}: ${LEVEL_LABEL[level]} → 클릭으로 변경`}
                              >
                                {level}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                    {testers.filter(t => t.isActive).length === 0 && (
                      <tr>
                        <td colSpan={capabilities.length + 2} className="py-12 text-center text-slate-400">
                          활성 시험자가 없습니다
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Add Dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>시험자 추가</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-3">
              <label className="text-right text-sm text-slate-600">사번 *</label>
              <Input
                className="col-span-3 h-8 text-sm"
                placeholder="예: 16242"
                value={form.employeeNo}
                onChange={e => setForm(f => ({ ...f, employeeNo: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              <label className="text-right text-sm text-slate-600">이름 *</label>
              <Input
                className="col-span-3 h-8 text-sm"
                placeholder="홍길동"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              <label className="text-right text-sm text-slate-600">단독시험</label>
              <div className="col-span-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="add-solo"
                  checked={form.canSolo}
                  onChange={e => setForm(f => ({ ...f, canSolo: e.target.checked }))}
                  className="cb-custom"
                />
                <label htmlFor="add-solo" className="text-sm text-slate-600">단독 시험 가능</label>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              <label className="text-right text-sm text-slate-600">2인시험</label>
              <div className="col-span-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="add-duo"
                  checked={form.canDuo}
                  onChange={e => setForm(f => ({ ...f, canDuo: e.target.checked }))}
                  className="cb-custom"
                />
                <label htmlFor="add-duo" className="text-sm text-slate-600">2인 시험 가능</label>
              </div>
            </div>
            {error && <p className="col-span-4 text-xs text-red-500 text-right">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>취소</Button>
            <Button size="sm" onClick={() => void handleAdd()} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {saving ? '저장 중...' : '추가'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>시험자 수정</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-3">
              <label className="text-right text-sm text-slate-600">사번 *</label>
              <Input
                className="col-span-3 h-8 text-sm"
                value={form.employeeNo}
                onChange={e => setForm(f => ({ ...f, employeeNo: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              <label className="text-right text-sm text-slate-600">이름 *</label>
              <Input
                className="col-span-3 h-8 text-sm"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              <label className="text-right text-sm text-slate-600">단독시험</label>
              <div className="col-span-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="edit-solo"
                  checked={form.canSolo}
                  onChange={e => setForm(f => ({ ...f, canSolo: e.target.checked }))}
                  className="cb-custom"
                />
                <label htmlFor="edit-solo" className="text-sm text-slate-600">단독 시험 가능</label>
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-3">
              <label className="text-right text-sm text-slate-600">2인시험</label>
              <div className="col-span-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="edit-duo"
                  checked={form.canDuo}
                  onChange={e => setForm(f => ({ ...f, canDuo: e.target.checked }))}
                  className="cb-custom"
                />
                <label htmlFor="edit-duo" className="text-sm text-slate-600">2인 시험 가능</label>
              </div>
            </div>
            {error && <p className="col-span-4 text-xs text-red-500 text-right">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>취소</Button>
            <Button size="sm" onClick={() => void handleEdit()} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              {saving ? '저장 중...' : '저장'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Dialog ── */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600">시험자 삭제</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-800">{selected?.name}</span> ({selected?.employeeNo}) 시험자를 삭제하시겠습니까?
            </p>
            <p className="mt-2 text-xs text-red-500">역량 데이터도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(false)}>취소</Button>
            <Button
              size="sm"
              onClick={() => void handleDelete()}
              disabled={saving}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {saving ? '삭제 중...' : '삭제'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
