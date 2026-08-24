"use client"

/**
 * 시험자 1명의 Qualification List.
 *
 * 사내 양식과 같은 구성(카테고리 머리행 → 자격종류·OJT 항목·부여일·만료일·인증구분·인증방법)으로 보여준다.
 * 매트릭스가 "누가 무엇을 가졌나"를 보여주고, 이 패널이 "이 사람의 자격증명 한 장"을 담당한다.
 */

import { Fragment, useMemo, useState } from "react"
import { Plus } from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import { QUALIFICATION_STATUS_LABEL, daysUntilExpiry } from "@shared/qualification"
import {
  STATUS_DOT_STYLE, formatExpiry, statusOf,
  type QualCategory, type QualItem, type QualTester, type TesterQual,
} from "./types"

interface Props {
  tester: QualTester | null
  role: string
  categories: QualCategory[]
  items: QualItem[]
  quals: TesterQual[]
  onClose: () => void
  /** 행을 누르면 그 항목의 자격 편집 패널을 연다 */
  onPickItem: (item: QualItem, existing: TesterQual | null) => void
}

export function TesterQualificationDrawer({
  tester, role, categories, items, quals, onClose, onPickItem,
}: Props) {
  const [showMissing, setShowMissing] = useState(false)

  const qualByItem = useMemo(() => {
    const m = new Map<string, TesterQual>()
    if (!tester) return m
    for (const q of quals) {
      if (q.testerId === tester.id && q.qualificationRole === role) m.set(q.qualificationItemId, q)
    }
    return m
  }, [quals, tester, role])

  /** 카테고리별 묶음. 미보유 항목은 토글에 따라 감춘다. */
  const groups = useMemo(() => {
    return categories
      .map(cat => ({
        category: cat,
        rows: items
          .filter(i => i.categoryId === cat.id)
          .map(i => ({ item: i, qual: qualByItem.get(i.id) ?? null }))
          .filter(r => showMissing || r.qual !== null),
      }))
      .filter(g => g.rows.length > 0)
  }, [categories, items, qualByItem, showMissing])

  if (!tester) return null

  const held = qualByItem.size
  const summary = countByStatus([...qualByItem.values()])

  return (
    <ManagementDrawer
      open
      onOpenChange={o => { if (!o) onClose() }}
      size="xl"
      title={`${tester.name} 자격 인증`}
      description={`사번 ${tester.employeeNo} · 자격종류 ${role} · 보유 ${held}건 / 전체 ${items.length}개 항목`}
      footer={<Button variant="outline" onClick={onClose}>닫기</Button>}
    >
      <div className="grid gap-3">
        {/* 요약 + 미보유 토글 */}
        <div className="flex flex-wrap items-center gap-2">
          {(["valid", "expiring", "expired"] as const).map(s => (
            <Badge key={s} variant="outline" className="gap-1.5">
              <span className={cn("size-1.5 rounded-full", STATUS_DOT_STYLE[s])} />
              {QUALIFICATION_STATUS_LABEL[s]} {summary[s]}건
            </Badge>
          ))}
          <Button
            variant={showMissing ? "secondary" : "outline"}
            size="sm"
            className="ml-auto"
            onClick={() => setShowMissing(v => !v)}
          >
            {showMissing ? "미보유 숨기기" : "미보유 포함"}
          </Button>
        </div>

        {groups.length === 0 ? (
          <div className="rounded-md border bg-card py-16 text-center text-sm text-muted-foreground">
            보유한 자격이 없습니다. &lsquo;미보유 포함&rsquo;을 눌러 부여할 항목을 고르세요.
          </div>
        ) : (
          <>
          {/* 모바일 — 카드 목록
              7열짜리 양식표를 폭 300px 도 안 되는 패널에 그대로 두면 가로로 계속 밀어야 읽힌다.
              카테고리 머리행은 그대로 두고, 행은 항목명 · 상태 · 부여/만료일만 남겨 세로로 쌓는다.
              인증구분·인증방법은 행을 눌러 여는 편집 패널에서 본다. */}
          <div className="divide-y overflow-hidden rounded-md border bg-card md:hidden">
            {groups.map(group => (
              <Fragment key={group.category.id}>
                <p className="bg-muted/60 px-3 py-1.5 text-xs leading-normal font-semibold break-keep text-foreground">
                  {group.category.name}
                </p>
                {group.rows.map(({ item, qual }) => {
                  const status = statusOf(qual)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onPickItem(item, qual)}
                      className="flex w-full min-w-0 flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className="flex min-w-0 items-start justify-between gap-2">
                        <span className="min-w-0 text-sm font-medium break-keep text-foreground">
                          {item.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs leading-normal">
                          <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT_STYLE[status])} />
                          <span className="text-foreground">
                            {QUALIFICATION_STATUS_LABEL[status]}
                            {status === "expiring" && qual?.expiresOn
                              ? ` (D-${daysUntilExpiry(qual.expiresOn)})`
                              : ""}
                          </span>
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs leading-normal tabular-nums text-muted-foreground">
                        <span>부여 {qual?.grantedOn ?? "–"}</span>
                        <span className="text-border">·</span>
                        <span>만료 {qual ? formatExpiry(qual.expiresOn) : "–"}</span>
                      </span>
                      {qual && (
                        <span className="min-w-0 truncate text-xs leading-normal text-muted-foreground">
                          {qual.certType} / {qual.certMethod}
                        </span>
                      )}
                    </button>
                  )
                })}
              </Fragment>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-md border bg-card md:block">
            {/* layout="wide" — 카테고리 머리행이 colSpan 으로 전체를 덮으므로 열 자동 합침을 끈다. */}
            <Table layout="wide" className="text-xs">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3 text-muted-foreground">자격종류</TableHead>
                  <TableHead className="px-3 text-muted-foreground">OJT 항목</TableHead>
                  <TableHead className="px-3 text-muted-foreground">자격부여일</TableHead>
                  <TableHead className="px-3 text-muted-foreground">자격만료일</TableHead>
                  <TableHead className="px-3 text-muted-foreground">인증구분</TableHead>
                  <TableHead className="px-3 text-muted-foreground">인증방법</TableHead>
                  <TableHead className="px-3 text-muted-foreground">상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(group => (
                  <Fragment key={group.category.id}>
                    {/* 카테고리 머리행 — 사내 양식의 회색 구분행 */}
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={7}
                        className="bg-muted/60 px-3 py-1.5 text-center text-xs font-semibold text-foreground"
                      >
                        {group.category.name}
                      </TableCell>
                    </TableRow>
                    {group.rows.map(({ item, qual }) => {
                      const status = statusOf(qual)
                      return (
                        <TableRow
                          key={item.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => onPickItem(item, qual)}
                        >
                          <TableCell className="px-3 py-2 text-muted-foreground">
                            {qual?.qualificationRole ?? role}
                          </TableCell>
                          <TableCell className="px-3 py-2 font-medium text-foreground">
                            {item.name}
                            {qual?.note && (
                              <span className="ml-1 text-muted-foreground" title={qual.note}>*</span>
                            )}
                          </TableCell>
                          <TableCell className="px-3 py-2 font-mono text-muted-foreground">
                            {qual?.grantedOn ?? "–"}
                          </TableCell>
                          <TableCell className="px-3 py-2 font-mono text-muted-foreground">
                            {qual ? formatExpiry(qual.expiresOn) : "–"}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-muted-foreground">
                            {qual?.certType ?? "–"}
                          </TableCell>
                          <TableCell className="px-3 py-2 text-muted-foreground">
                            {qual?.certMethod ?? "–"}
                          </TableCell>
                          <TableCell className="px-3 py-2">
                            <span className="flex items-center gap-1.5">
                              <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT_STYLE[status])} />
                              <span className="text-foreground">
                                {QUALIFICATION_STATUS_LABEL[status]}
                                {status === "expiring" && qual?.expiresOn
                                  ? ` (D-${daysUntilExpiry(qual.expiresOn)})`
                                  : ""}
                              </span>
                            </span>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          </>
        )}

        {/* 비고 — 양식 하단 각주와 같은 자리 */}
        {[...qualByItem.values()].some(q => q.note) && (
          <section className="rounded-md border bg-card p-4 shadow-sm">
            <h3 className="mb-2 border-b pb-2 text-sm font-semibold text-foreground">비고</h3>
            <ul className="grid gap-1">
              {[...qualByItem.entries()]
                .filter(([, q]) => q.note)
                .map(([itemId, q]) => (
                  <li key={q.id} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {items.find(i => i.id === itemId)?.name ?? "–"}
                    </span>
                    {" — "}
                    {q.note}
                  </li>
                ))}
            </ul>
          </section>
        )}

        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Plus className="size-3" />
          행을 누르면 자격을 부여하거나 수정할 수 있습니다.
        </p>
      </div>
    </ManagementDrawer>
  )
}

function countByStatus(quals: TesterQual[]): Record<"valid" | "expiring" | "expired", number> {
  const acc = { valid: 0, expiring: 0, expired: 0 }
  for (const q of quals) {
    const s = statusOf(q)
    if (s !== "none") acc[s] += 1
  }
  return acc
}
