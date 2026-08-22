"use client"

/**
 * 자격 보유 매트릭스 — 행 = 시험자, 열 = OJT 항목(카테고리별 묶음).
 *
 * 시험자 역량 매트릭스(`/test-mgmt/testers` 의 '시험자 역량' 탭)와 같은 구조·같은 색 규격을 쓴다.
 * 다른 점은 셀이 3단계 토글이 아니라 유효기간이 있는 자격이라는 것 — 그래서 클릭하면 편집 패널이 열린다.
 */

import { Fragment } from "react"

import { cn } from "@frontend/lib/utils"
import { Card } from "@frontend/components/ui/card"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { TesterAvatar } from "@frontend/lib/tester-profiles"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import { QUALIFICATION_STATUS_LABEL, daysUntilExpiry } from "@shared/qualification"
import {
  STATUS_CELL_STYLE, formatExpiry, statusCellLabel, statusOf,
  type QualCategory, type QualItem, type QualTester, type TesterQual,
} from "./types"

interface Props {
  loading: boolean
  testers: QualTester[]
  categories: QualCategory[]
  items: QualItem[]
  /** (testerId, itemId) → 자격. 이미 자격종류로 걸러낸 상태로 받는다. */
  qualAt: (testerId: string, itemId: string) => TesterQual | null
  onPickCell: (tester: QualTester, item: QualItem, existing: TesterQual | null) => void
  onPickTester: (tester: QualTester) => void
}

export function QualificationMatrix({
  loading, testers, categories, items, qualAt, onPickCell, onPickTester,
}: Props) {
  // 열 머리행을 2단으로 쓴다 — 위: 카테고리(colSpan), 아래: OJT 항목.
  const groups = categories
    .map(cat => ({ category: cat, items: items.filter(i => i.categoryId === cat.id) }))
    .filter(g => g.items.length > 0)

  if (loading) {
    return (
      <Card className="gap-0 overflow-hidden py-0">
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      </Card>
    )
  }

  return (
    <>
      {/* 모바일 — 시험자별 카드 */}
      <div className="flex flex-col gap-2 md:hidden">
        {testers.length === 0 ? (
          <Card className="py-16 text-center text-sm text-muted-foreground">
            표시할 시험자가 없습니다.
          </Card>
        ) : (
          testers.map(tester => (
            <Card key={tester.id} className="gap-2 px-3 py-3">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 text-left"
                onClick={() => onPickTester(tester)}
              >
                <TesterAvatar testerId={tester.id} name={tester.name} size="xs" />
                <span className="truncate text-sm font-medium text-foreground">{tester.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{tester.employeeNo}</span>
              </button>
              {groups.map(group => (
                <div key={group.category.id} className="grid gap-1">
                  <span className="text-[10px] font-semibold tracking-wide text-muted-foreground">
                    {group.category.name}
                  </span>
                  <div className="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
                    {group.items.map(item => {
                      const qual = qualAt(tester.id, item.id)
                      const status = statusOf(qual)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onPickCell(tester, item, qual)}
                          className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:border-ring hover:bg-muted/50"
                        >
                          <span className="flex-1 truncate text-[11px] font-medium text-foreground">
                            {item.name}
                          </span>
                          <span className={cn(
                            "inline-flex h-6 min-w-11 shrink-0 items-center justify-center rounded-md border px-1 text-[10px] font-bold",
                            STATUS_CELL_STYLE[status],
                          )}>
                            {statusCellLabel(status, qual ? daysUntilExpiry(qual.expiresOn) : null)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </Card>
          ))
        )}
      </div>

      {/* 데스크톱 — 매트릭스 */}
      <Card className="hidden min-h-0 flex-1 flex-col overflow-hidden py-0 md:flex">
        <Table layout="wide" className="border-collapse text-xs">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead
                rowSpan={2}
                className="sticky top-0 left-0 z-20 min-w-[132px] border-r bg-card px-3 align-middle text-muted-foreground"
              >
                시험자
              </TableHead>
              <TableHead
                rowSpan={2}
                className="sticky top-0 left-[132px] z-20 w-20 border-r bg-card px-3 text-center align-middle text-muted-foreground"
              >
                사번
              </TableHead>
              <TableHead
                rowSpan={2}
                className="sticky top-0 left-[212px] z-20 w-24 border-r bg-card px-2 text-center align-middle text-muted-foreground"
              >
                보유
              </TableHead>
              {groups.map(group => (
                <TableHead
                  key={group.category.id}
                  colSpan={group.items.length}
                  className="sticky top-0 z-10 border-r border-l bg-muted/40 px-2 text-center text-[11px] font-semibold text-foreground"
                >
                  {group.category.name}
                </TableHead>
              ))}
            </TableRow>
            <TableRow className="hover:bg-transparent">
              {groups.map(group =>
                group.items.map((item, idx) => (
                  <TableHead
                    key={item.id}
                    className={cn(
                      // 상단 카테고리 행이 h-10(40px)이라 두 번째 행은 top-10 에 붙는다.
                      // 항목명이 길어 whitespace-normal 로 줄바꿈을 허용해야 열 폭이 유지된다.
                      "sticky top-10 z-10 min-w-[76px] border-r px-1.5 text-center text-[10px] leading-tight whitespace-normal text-muted-foreground",
                      idx === 0 && "border-l",
                    )}
                    title={`${item.categoryName} / ${item.name} (유효기간 ${item.validMonths}개월)`}
                  >
                    {item.name}
                  </TableHead>
                )),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {testers.map(tester => {
              const held = items.filter(i => qualAt(tester.id, i.id)).length
              return (
                <TableRow key={tester.id}>
                  <TableCell className="sticky left-0 z-10 border-r bg-card px-3 py-2.5 font-medium text-foreground">
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-2 text-left hover:underline"
                      onClick={() => onPickTester(tester)}
                      title={`${tester.name} 자격 인증 상세`}
                    >
                      <TesterAvatar testerId={tester.id} name={tester.name} size="xs" />
                      <span className="truncate">{tester.name}</span>
                    </button>
                  </TableCell>
                  <TableCell className="sticky left-[132px] z-10 border-r bg-card px-3 py-2.5 text-center font-mono text-muted-foreground">
                    {tester.employeeNo}
                  </TableCell>
                  <TableCell className="sticky left-[212px] z-10 border-r bg-card px-2 py-2.5 text-center tabular-nums text-muted-foreground">
                    {held} / {items.length}
                  </TableCell>
                  {groups.map(group => (
                    <Fragment key={group.category.id}>
                      {group.items.map((item, idx) => {
                        const qual = qualAt(tester.id, item.id)
                        const status = statusOf(qual)
                        const daysLeft = qual ? daysUntilExpiry(qual.expiresOn) : null
                        return (
                          <TableCell
                            key={item.id}
                            className={cn("border-r p-1.5 text-center", idx === 0 && "border-l")}
                          >
                            <button
                              type="button"
                              onClick={() => onPickCell(tester, item, qual)}
                              className={cn(
                                "inline-flex h-7 w-full min-w-[60px] items-center justify-center rounded-md border px-1 text-[10px] font-bold transition-transform hover:scale-105",
                                STATUS_CELL_STYLE[status],
                              )}
                              title={[
                                `${tester.name} / ${item.name}`,
                                QUALIFICATION_STATUS_LABEL[status],
                                qual ? `부여 ${qual.grantedOn} · 만료 ${formatExpiry(qual.expiresOn)}` : "자격 없음",
                                qual ? `${qual.certType} / ${qual.certMethod}` : "",
                                qual?.note ?? "",
                              ].filter(Boolean).join("\n")}
                            >
                              {statusCellLabel(status, daysLeft)}
                            </button>
                          </TableCell>
                        )
                      })}
                    </Fragment>
                  ))}
                </TableRow>
              )
            })}
            {testers.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={items.length + 3}
                  className="py-16 text-center text-sm text-muted-foreground"
                >
                  표시할 시험자가 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  )
}
