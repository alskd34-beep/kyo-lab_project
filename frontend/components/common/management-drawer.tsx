'use client'

import type { CSSProperties, ReactNode } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@frontend/components/ui/sheet'
import { cn } from '@frontend/lib/utils'

type ManagementDrawerSize = 'sm' | 'md' | 'lg' | 'xl'

/**
 * 패널 폭. `SheetContent`가 `--sheet-width`를 읽어 `sm:max-w-*`로 적용하므로
 * 클래스가 아닌 인라인 CSS 변수로 넘긴다(기본값 클래스보다 항상 우선한다).
 */
const sizeWidth: Record<ManagementDrawerSize, string> = {
  sm: '480px',
  md: '600px',
  lg: '760px',
  xl: '920px',
}

interface ManagementDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  children: ReactNode
  footer: ReactNode
  size?: ManagementDrawerSize
  className?: string
}

/**
 * 중간 규모 관리 데이터의 등록·수정에 사용하는 표준 우측 Drawer.
 * 목록 화면의 검색·필터 상태를 유지하면서 본문을 편집하고 하단에서 저장한다.
 */
export function ManagementDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: ManagementDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        style={{ '--sheet-width': sizeWidth[size] } as CSSProperties}
        className={cn('flex w-[calc(100vw-1.5rem)] flex-col gap-0 p-0 sm:w-full', className)}
      >
        <SheetHeader className="border-b px-4 py-4 pr-14 sm:px-5">
          <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
          <SheetDescription className="text-xs leading-5">
            {description}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
          {children}
        </div>
        <SheetFooter className="border-t bg-card px-4 py-4 sm:flex-row sm:justify-end sm:px-5">
          {footer}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
