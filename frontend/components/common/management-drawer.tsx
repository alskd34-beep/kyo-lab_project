'use client'

import type { ReactNode } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@frontend/components/ui/sheet'
import { cn } from '@frontend/lib/utils'

type ManagementDrawerSize = 'sm' | 'md' | 'lg'

const sizeClass: Record<ManagementDrawerSize, string> = {
  sm: 'sm:max-w-[420px]',
  md: 'sm:max-w-[480px]',
  lg: 'sm:max-w-[560px]',
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
        className={cn('flex w-full flex-col gap-0 p-0', sizeClass[size], className)}
      >
        <SheetHeader className="border-b px-5 py-4 pr-14">
          <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
          <SheetDescription className="text-xs leading-5">
            {description}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {children}
        </div>
        <SheetFooter className="border-t bg-card px-5 py-4 sm:flex-row sm:justify-end">
          {footer}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
