"use client"

/**
 * 자격 보유 매트릭스 — 행 = 시험자, 열 = OJT 항목(카테고리별 묶음).
 *
 * 시험자 역량 매트릭스(`/test-mgmt/testers` 의 '시험자 역량' 탭)와 같은 구조·같은 색 규격을 쓴다.
 * 다른 점은 셀이 3단계 토글이 아니라 유효기간이 있는 자격이라는 것 — 그래서 클릭하면 편집 패널이 열린다.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from "react"

import { cn } from "@frontend/lib/utils"
import { Card } from "@frontend/components/ui/card"
import { Tag } from "@frontend/components/ui/tag"
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

/**
 * 고정(sticky) 열의 left 오프셋을 실제 렌더된 폭에서 계산한다.
 *
 * 오프셋을 px 로 박아두면 테두리·글꼴 때문에 실제 폭이 3~4px 커지는 순간 열이 겹친다.
 * 두 칸의 폭을 재서 다음 칸의 시작점으로 쓰면 어긋나지 않는다.
 * 값이 바뀔 때만 state 를 갱신해 렌더가 헛돌지 않게 한다.
 */
function useStickyOffsets(ready: boolean, columnCount: number, rowCount: number) {
  const nameRef = useRef<HTMLTableCellElement>(null)
  const noRef = useRef<HTMLTableCellElement>(null)
  const [offsets, setOffsets] = useState({ no: 100, held: 196 })

  const measure = useCallback(() => {
    const nameW = nameRef.current?.getBoundingClientRect().width
    const noW = noRef.current?.getBoundingClientRect().width
    if (!nameW || !noW) return
    const next = { no: Math.round(nameW), held: Math.round(nameW + noW) }
    setOffsets(prev => (prev.no === next.no && prev.held === next.held ? prev : next))
  }, [])

  /**
   * 로딩 중에는 표가 없어 ref 가 비어 있고, 열 수가 늘면 칸 폭이 다시 계산된다.
   * 그래서 "표가 준비된 시점"과 "열·행 수"를 의존성에 둬야 재측정이 걸린다.
   *
   * 최초 측정도 ResizeObserver 의 첫 콜백에 맡긴다 — observe() 하면 바로 한 번 불린다.
   * effect 본문에서 setState 를 직접 부르면 커밋 단계에 렌더가 연쇄로 걸린다.
   */
  useEffect(() => {
    if (!ready) return
    const targets = [nameRef.current, noRef.current].filter(Boolean) as HTMLElement[]
    if (targets.length === 0) return
    const ro = new ResizeObserver(measure)
    for (const el of targets) ro.observe(el)
    return () => ro.disconnect()
  }, [measure, ready, columnCount, rowCount])

  return { nameRef, noRef, offsets }
}

export function QualificationMatrix({
  loading, testers, categories, items, qualAt, onPickCell, onPickTester,
}: Props) {
  const { nameRef, noRef, offsets } = useStickyOffsets(!loading, items.length, testers.length)
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
      {/* 모바일 — 시험자별 카드
          스크롤 열(min-h-0 flex-1 overflow-y-auto) + 자식 shrink-0. Card 는 overflow-hidden 이라
          세로 스크롤 열 안에서 min-height 가 0 이 되고, 목록이 길어지면 선 하나로 찌부러진다. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto md:hidden">
        {testers.length === 0 ? (
          <Card className="shrink-0 py-16 text-center text-sm text-muted-foreground">
            표시할 시험자가 없습니다.
          </Card>
        ) : (
          testers.map(tester => (
            <Card key={tester.id} className="shrink-0 gap-2 px-3 py-3">
              <button
                type="button"
                className="flex min-w-0 items-center gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => onPickTester(tester)}
              >
                <TesterAvatar testerId={tester.id} name={tester.name} size="xs" />
                <span className="truncate text-sm font-medium text-foreground">{tester.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{tester.employeeNo}</span>
              </button>
              {groups.map(group => (
                <div key={group.category.id} className="grid gap-1">
                  {/* tracking-wide 를 뺐다 — 한글에는 대문자가 없고 자간만 벌어져 리듬이 깨진다.
                      크기도 프로젝트 최소값(text-xs = 13.5px)으로 올렸다. */}
                  <span className="text-xs font-semibold text-muted-foreground">
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
                          /* min-w-0: 그리드 칸의 최소폭은 내용 크기라, 긴 항목명이 칸을 화면 밖까지
                             밀어낸다. 0 으로 낮춰야 안쪽 truncate 가 동작한다. */
                          className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left transition-colors hover:border-ring hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          <span className="min-w-0 flex-1 truncate text-xs leading-normal font-medium text-foreground">
                            {item.name}
                          </span>
                          <span className={cn(
                            "inline-flex h-6 min-w-11 shrink-0 items-center justify-center rounded-md border px-1 text-xs leading-normal font-bold tabular-nums",
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
              {/* 고정 열 — 폭은 못박고, 뒤 칸의 left 는 실측 폭에서 계산한다(useStickyOffsets) */}
              <TableHead
                ref={nameRef}
                rowSpan={2}
                className="sticky left-0 top-0 z-20 w-[100px] min-w-[100px] border-r bg-card px-3 align-middle text-muted-foreground"
              >
                이름
              </TableHead>
              <TableHead
                ref={noRef}
                rowSpan={2}
                style={{ left: offsets.no }}
                className="sticky top-0 z-20 w-[96px] min-w-[96px] border-r bg-card px-3 text-center align-middle text-muted-foreground"
              >
                사번
              </TableHead>
              <TableHead
                rowSpan={2}
                style={{ left: offsets.held }}
                className="sticky top-0 z-20 w-[80px] min-w-[80px] border-r bg-card px-2 text-center align-middle text-muted-foreground"
              >
                보유
              </TableHead>
              {groups.map(group => (
                <TableHead
                  key={group.category.id}
                  colSpan={group.items.length}
                  className="sticky top-0 z-10 border-r border-l bg-muted/40 px-2 text-center text-xs leading-normal font-semibold text-foreground"
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
                      // 64px 열에서는 break-keep 을 쓰지 않는다 — 띄어쓰기 없는 긴 항목명이
                      // 통째로 칸을 넘어간다. 여기서는 글자 단위 줄바꿈이 맞다.
                      "sticky top-10 z-10 w-[64px] min-w-[64px] border-r px-1.5 text-center text-xs leading-tight whitespace-normal text-muted-foreground",
                      idx === 0 && "border-l",
                    )}
                    title={[
                      `${item.categoryName} / ${item.name}`,
                      `유효기간 ${item.validMonths}개월`,
                      item.isActive ? "" : "미사용 항목 — 보유자가 있어 열을 유지합니다",
                    ].filter(Boolean).join("\n")}
                  >
                    {item.name}
                    {!item.isActive && (
                      <span className="mt-0.5 block text-xs leading-normal font-normal text-muted-foreground">미사용</span>
                    )}
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
                  <TableCell className="sticky left-0 z-10 w-[100px] min-w-[100px] border-r bg-card px-3 py-2.5 font-medium text-foreground">
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-2 rounded-md text-left hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      onClick={() => onPickTester(tester)}
                      title={`${tester.name} 자격 인증 상세`}
                    >
                      <TesterAvatar testerId={tester.id} name={tester.name} size="xs" />
                      <span className="truncate">{tester.name}</span>
                      {/* 비활성 시험자는 보유 자격이 있을 때만 행에 남는다 — 만료 관리가 끊기지 않도록 */}
                      {!tester.isActive && <Tag color="mono">비활성</Tag>}
                    </button>
                  </TableCell>
                  <TableCell style={{ left: offsets.no }} className="sticky z-10 w-[96px] min-w-[96px] border-r bg-card px-3 py-2.5 text-center font-mono text-muted-foreground">
                    {tester.employeeNo}
                  </TableCell>
                  <TableCell style={{ left: offsets.held }} className="sticky z-10 w-[80px] min-w-[80px] border-r bg-card px-2 py-2.5 text-center tabular-nums text-muted-foreground">
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
                              /* hover:scale-105 를 뺐다 — 촘촘한 격자에서 칸이 커지면 옆 칸을 덮고,
                                 '커짐'은 눌렀다는 뜻도 아니다. 테두리 색만 바꿔 대상만 짚어 준다. */
                              className={cn(
                                "inline-flex h-7 w-full min-w-[52px] items-center justify-center rounded-md border px-1 text-xs leading-normal font-bold tabular-nums transition-colors hover:border-foreground/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
