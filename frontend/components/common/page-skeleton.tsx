import { Skeleton } from '@frontend/components/ui/skeleton'
import { cn } from '@frontend/lib/utils'

export type PageSkeletonVariant = 'table' | 'dashboard' | 'board' | 'detail'

interface PageSkeletonProps {
  variant?: PageSkeletonVariant
  className?: string
}

function SkeletonHeader() {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-7 w-44 max-w-[60vw]" />
        <Skeleton className="h-3.5 w-72 max-w-[80vw]" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  )
}

function TableBodySkeleton() {
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-3 sm:px-4">
        <Skeleton className="h-4 w-28" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      </div>

      <div className="hidden min-w-[680px] sm:block">
        <div className="grid grid-cols-[1.3fr_1fr_0.9fr_0.8fr_0.6fr] gap-4 border-b px-4 py-3">
          {['w-20', 'w-24', 'w-20', 'w-16', 'w-12'].map((width, index) => (
            <Skeleton key={index} className={cn('h-3', width)} />
          ))}
        </div>
        <div className="divide-y">
          {Array.from({ length: 7 }, (_, index) => (
            <div
              key={index}
              className="grid grid-cols-[1.3fr_1fr_0.9fr_0.8fr_0.6fr] items-center gap-4 px-4 py-3.5"
            >
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-14" />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 p-3 sm:hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="space-y-3 rounded-md border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-14" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  )
}

function DashboardBodySkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="rounded-md border bg-card p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <div className="rounded-md border bg-card p-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-64 w-full" />
        </div>
        <div className="rounded-md border bg-card p-4">
          <Skeleton className="h-4 w-28" />
          <div className="mt-4 space-y-4">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <Skeleton className="size-8 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-5 w-12" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function BoardBodySkeleton() {
  return (
    <div className="overflow-hidden rounded-md border bg-card p-3 sm:p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, column) => (
          <div key={column} className="min-w-0 space-y-3 rounded-md bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="size-5" />
            </div>
            {Array.from({ length: column % 2 === 0 ? 3 : 2 }, (_, card) => (
              <div key={card} className="space-y-2 rounded-md border bg-card p-3">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function DetailBodySkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4 rounded-md border bg-card p-4 sm:p-5">
        <Skeleton className="h-5 w-48" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
      <div className="space-y-4 rounded-md border bg-card p-4 sm:p-5">
        <Skeleton className="h-5 w-28" />
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-8 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PageSkeleton({ variant = 'table', className }: PageSkeletonProps) {
  const body = {
    table: <TableBodySkeleton />,
    dashboard: <DashboardBodySkeleton />,
    board: <BoardBodySkeleton />,
    detail: <DetailBodySkeleton />,
  }[variant]

  return (
    <div
      role="status"
      aria-label="화면을 불러오는 중"
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-auto p-4 sm:p-6',
        className,
      )}
    >
      <SkeletonHeader />
      {body}
      <span className="sr-only">화면을 불러오는 중입니다.</span>
    </div>
  )
}
