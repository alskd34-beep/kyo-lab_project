"use client"

/**
 * 기준 설정 → 시험자 자격 인증
 *
 * 사내 「Qualification List」를 시스템으로 옮긴 화면이다.
 *   - 자격 현황: 시험자 × OJT 항목 매트릭스 — 누가 무엇을 유효하게 보유했는지 한눈에 본다.
 *   - 자격 항목 관리: 카테고리·OJT 항목 마스터.
 *
 * 만료 상태는 DB에 없고 `@shared/qualification` 이 만료일로 계산한다(배치 갱신 없음).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { BadgeCheck, RefreshCw, ShieldCheck, SlidersHorizontal } from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { api, errorMessage } from "@frontend/lib/api-client"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import { Skeleton } from "@frontend/components/ui/skeleton"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import { primeTesterProfileCache } from "@frontend/lib/tester-profiles"
import {
  QualificationEditDrawer, type QualEditTarget,
} from "@frontend/components/qualification/qualification-edit-drawer"
import { QualificationItemsPanel } from "@frontend/components/qualification/qualification-items-panel"
import { QualificationMatrix } from "@frontend/components/qualification/qualification-matrix"
import { TesterQualificationDrawer } from "@frontend/components/qualification/tester-qualification-drawer"
import {
  STATUS_DOT_STYLE, statusOf,
  type QualItem, type QualTester, type QualificationOverview, type TesterQual,
} from "@frontend/components/qualification/types"
import {
  QUALIFICATION_ROLES, QUALIFICATION_STATUS_LABEL, EXPIRING_SOON_DAYS,
} from "@shared/qualification"
import type { QualificationStatus } from "@shared/qualification"

type TabId = "matrix" | "items"

const ALL = "__all__"

const EMPTY: QualificationOverview = { categories: [], items: [], testers: [], quals: [] }

export default function TesterQualificationsPage() {
  const [data, setData] = useState<QualificationOverview>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<TabId>("matrix")
  const [role, setRole] = useState<string>("시험자")
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL)
  const [keyword, setKeyword] = useState("")
  const [onlyActiveTesters, setOnlyActiveTesters] = useState(true)

  const [editTarget, setEditTarget] = useState<QualEditTarget | null>(null)
  const [detailTester, setDetailTester] = useState<QualTester | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await api.get<QualificationOverview>("/api/tester-qualifications")
      setData(res)
      primeTesterProfileCache(res.testers.map(t => ({ id: t.id, name: t.name })))
    } catch (e) {
      setErr(errorMessage(e))
      setData(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // ─── 파생값 ────────────────────────────────────────────────────────────────

  /** 선택한 자격종류의 자격만 (테스터, 항목) 으로 찾을 수 있게 색인해 둔다. */
  const qualIndex = useMemo(() => {
    const m = new Map<string, TesterQual>()
    for (const q of data.quals) {
      if (q.qualificationRole !== role) continue
      m.set(`${q.testerId}__${q.qualificationItemId}`, q)
    }
    return m
  }, [data.quals, role])

  const qualAt = useCallback(
    (testerId: string, itemId: string) => qualIndex.get(`${testerId}__${itemId}`) ?? null,
    [qualIndex],
  )

  const visibleTesters = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return data.testers.filter(t => {
      if (onlyActiveTesters && !t.isActive) return false
      if (!kw) return true
      return t.name.toLowerCase().includes(kw) || t.employeeNo.toLowerCase().includes(kw)
    })
  }, [data.testers, onlyActiveTesters, keyword])

  /** 매트릭스 열 — 카테고리 필터를 적용한다(열이 많아 한 화면에 다 안 들어간다). */
  const visibleItems = useMemo(() => {
    if (categoryFilter === ALL) return data.items
    return data.items.filter(i => i.categoryId === categoryFilter)
  }, [data.items, categoryFilter])

  const visibleCategories = useMemo(() => {
    if (categoryFilter === ALL) return data.categories
    return data.categories.filter(c => c.id === categoryFilter)
  }, [data.categories, categoryFilter])

  /** KPI — 보이는 시험자 × 보이는 항목 조합을 상태별로 센다. */
  const summary = useMemo(() => {
    const acc: Record<QualificationStatus, number> = { valid: 0, expiring: 0, expired: 0, none: 0 }
    for (const t of visibleTesters) {
      for (const i of visibleItems) {
        const q = qualAt(t.id, i.id)
        acc[statusOf(q)] += 1
      }
    }
    return acc
  }, [visibleTesters, visibleItems, qualAt])

  const totalCells = visibleTesters.length * visibleItems.length
  const heldRate = totalCells === 0
    ? 0
    : Math.round(((summary.valid + summary.expiring) / totalCells) * 100)

  // ─── 핸들러 ────────────────────────────────────────────────────────────────

  const openCell = useCallback((tester: QualTester, item: QualItem, existing: TesterQual | null) => {
    setEditTarget({ tester, item, role, existing })
  }, [role])

  /** 상세 패널에서 행을 고르면 그 항목의 편집 패널로 이어준다. */
  const openFromDetail = useCallback((item: QualItem, existing: TesterQual | null) => {
    if (!detailTester) return
    setEditTarget({ tester: detailTester, item, role, existing })
  }, [detailTester, role])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      {/* Header */}
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            {activeTab === "matrix"
              ? <ShieldCheck className="size-5 text-muted-foreground" />
              : <SlidersHorizontal className="size-5 text-muted-foreground" />}
            <h1 className="text-xl font-semibold text-foreground">
              {activeTab === "matrix" ? "시험자 자격 인증" : "자격 항목 관리"}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {activeTab === "matrix"
              ? "시험자별 OJT 자격 보유·만료 현황을 관리합니다."
              : "Qualification List 의 카테고리와 OJT 항목을 관리합니다."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Tab switcher */}
          <div className="inline-flex h-9 w-fit items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground">
            {[
              { id: "matrix", label: "자격 현황" },
              { id: "items", label: "자격 항목 관리" },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as TabId)}
                className={cn(
                  "h-8 rounded-md px-3 text-sm font-medium transition-colors",
                  activeTab === tab.id ? "bg-card text-foreground shadow-sm" : "hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <Button variant="outline" className="ml-auto" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} />새로고침
          </Button>
        </div>
      </div>

      {err && (
        <div className="shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">
          {err}
        </div>
      )}

      {activeTab === "matrix" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* KPI */}
          <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-5">
            <KpiCard label="보유율" value={loading ? null : `${heldRate}%`} hint={`${visibleTesters.length}명 × ${visibleItems.length}항목`} accent />
            <KpiCard label="유효" value={loading ? null : summary.valid} status="valid" />
            <KpiCard label="만료 임박" value={loading ? null : summary.expiring} status="expiring" hint={`${EXPIRING_SOON_DAYS}일 이내`} />
            <KpiCard label="만료" value={loading ? null : summary.expired} status="expired" />
            <KpiCard label="미보유" value={loading ? null : summary.none} status="none" />
          </div>

          {/* 필터 */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="!h-9 w-32 px-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUALIFICATION_ROLES.map(r => <SelectItem key={r} value={r}>{r} 자격</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="!h-9 w-56 px-3"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>전체 카테고리</SelectItem>
                {data.categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>

            <Input
              className="h-9 w-48"
              placeholder="시험자 이름·사번 검색..."
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
            />

            <Button
              variant={onlyActiveTesters ? "secondary" : "outline"}
              onClick={() => setOnlyActiveTesters(v => !v)}
            >
              {onlyActiveTesters ? "활성 시험자만" : "전체 시험자"}
            </Button>

            {/* 범례 */}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {(["valid", "expiring", "expired", "none"] as const).map(s => (
                <Badge key={s} variant="outline" className="gap-1.5">
                  <span className={cn("size-1.5 rounded-full", STATUS_DOT_STYLE[s])} />
                  {QUALIFICATION_STATUS_LABEL[s]}
                </Badge>
              ))}
            </div>
          </div>

          <QualificationMatrix
            loading={loading}
            testers={visibleTesters}
            categories={visibleCategories}
            items={visibleItems}
            qualAt={qualAt}
            onPickCell={openCell}
            onPickTester={setDetailTester}
          />

          <p className="shrink-0 text-xs text-muted-foreground">
            셀을 누르면 자격을 부여·수정하고, 시험자 이름을 누르면 자격 인증 목록 전체를 봅니다.
            자격 &lsquo;가능/불가&rsquo; 역량(자동배정 후보 판정)은 <span className="font-medium text-foreground">시험관리 → 시험자 관리</span>의 역량 탭에서 관리합니다.
          </p>
        </div>
      ) : (
        <QualificationItemsPanel
          loading={loading}
          categories={data.categories}
          items={data.items}
          quals={data.quals}
          onChanged={() => void load()}
        />
      )}

      <QualificationEditDrawer
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => void load()}
      />

      <TesterQualificationDrawer
        tester={detailTester}
        role={role}
        categories={data.categories}
        items={data.items}
        quals={data.quals}
        onClose={() => setDetailTester(null)}
        onPickItem={openFromDetail}
      />
    </div>
  )
}

function KpiCard({ label, value, hint, status, accent }: {
  label: string
  value: number | string | null
  hint?: string
  status?: QualificationStatus
  accent?: boolean
}) {
  return (
    <Card className={cn("gap-0.5 px-3 py-2", accent && "border-l-4 border-l-primary")}>
      <span className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {status && <span className={cn("size-1.5 rounded-full", STATUS_DOT_STYLE[status])} />}
        {accent && <BadgeCheck className="size-3" />}
        {label}
      </span>
      {value === null
        ? <Skeleton className="h-6 w-12" />
        : <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>}
      <span className="text-[10px] text-muted-foreground">{hint ?? " "}</span>
    </Card>
  )
}
