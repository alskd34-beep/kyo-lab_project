"use client"

/**
 * 품목 공수 변경이력 Dialog.
 *
 * 어떤 제조번호/시험에 어떤 버전 공수를 적용했는지 역추적할 수 있도록
 * 버전·적용일자·변경자·변경내용을 보여준다.
 */

import { useCallback, useEffect, useState } from "react"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import { Skeleton } from "@frontend/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import type { ProductWorkload, WorkloadVersion } from "@shared/workload"

export function VersionHistoryDialog({
  open, product, onClose,
}: {
  open: boolean
  product: ProductWorkload
  onClose: () => void
}) {
  const [rows, setRows] = useState<WorkloadVersion[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/workloads/products/${product.id}/versions`, { credentials: "include" })
      const data = (await res.json()) as { rows?: WorkloadVersion[] }
      setRows(data.rows ?? [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [product.id])

  useEffect(() => { if (open) void load() }, [open, load])

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>변경이력</DialogTitle>
          <DialogDescription>
            {product.productName} ({product.productCode}) · 현재 v{product.version}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {/* 모바일 — 4칸을 320px 에 밀어 넣으면 날짜가 잘린다. 가로로 미는 대신 세운다. */}
          <ul className="divide-y md:hidden">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="flex flex-col gap-2 py-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-full" />
                </li>
              ))
            ) : rows.length === 0 ? (
              <li className="py-16 text-center text-sm break-keep text-muted-foreground">
                기록된 변경이력이 없습니다.
              </li>
            ) : (
              rows.map(v => (
                <li key={v.id} className="py-3">
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      v{v.version}
                      {v.version === product.version && (
                        <span className="ml-1.5 text-xs leading-normal font-normal text-primary">현재</span>
                      )}
                    </p>
                    <span className="shrink-0 font-mono text-xs leading-normal tabular-nums text-muted-foreground">
                      {v.effectiveFrom ?? v.createdAt.slice(0, 10)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm break-keep text-foreground">{v.changeNote ?? "—"}</p>
                  <p className="mt-0.5 text-xs leading-normal text-muted-foreground">
                    변경자 {v.changedBy ?? "—"}
                  </p>
                </li>
              ))
            )}
          </ul>

          <Table className="hidden md:flex">
            <colgroup>
              <col className="w-[14%]" />
              <col className="w-[24%]" />
              <col className="w-[20%]" />
              <col className="w-[42%]" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3 text-muted-foreground">버전</TableHead>
                <TableHead className="px-3 text-muted-foreground">적용일자</TableHead>
                <TableHead className="px-3 text-muted-foreground">변경자</TableHead>
                <TableHead className="px-3 text-muted-foreground">변경내용</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-8" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-16 text-center text-sm text-muted-foreground">
                    기록된 변경이력이 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(v => (
                  <TableRow key={v.id} className="hover:bg-muted/40">
                    <TableCell className="px-3 py-2.5 font-medium text-foreground">
                      v{v.version}
                      {v.version === product.version && (
                        <span className="ml-1.5 text-xs leading-normal font-normal text-primary">현재</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                      {v.effectiveFrom ?? v.createdAt.slice(0, 10)}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                      {v.changedBy ?? "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm text-foreground">
                      {v.changeNote ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
