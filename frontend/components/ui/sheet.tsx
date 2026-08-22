"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { cn } from "@frontend/lib/utils"
import { Button } from "@frontend/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * variant="floating"(기본): bizday UI 가이드라인 Side 패턴 — 가장자리에서 12px 띄운 채
 * 라운드·그림자로 "떠 있는" 패널. dim 없이 페이지와 함께 상호작용 가능하며 Esc/우상단 X로만 닫힌다
 * (바깥 영역 클릭으로는 닫히지 않음). 이 모드를 쓰려면 <Sheet modal={false}> 로 열어야 배경이 인터랙티브하게 유지된다.
 * variant="docked": 기존 방식 — 가장자리에 밀착, dim 항상 표시, 바깥 클릭으로 닫힘(모바일 사이드바 내비게이션용).
 */
function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  variant = "floating",
  dim = false,
  onPointerDownOutside,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  variant?: "floating" | "docked"
  dim?: boolean
}) {
  const floating = variant === "floating"
  return (
    <SheetPortal>
      {(!floating || dim) && <SheetOverlay className={floating ? "z-30" : undefined} />}
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        data-variant={variant}
        onPointerDownOutside={(event) => {
          if (floating) event.preventDefault()
          onPointerDownOutside?.(event)
        }}
        className={cn(
          "fixed flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground transition duration-200 ease-in-out data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          // 좌/우 패널 기본 폭. 호출부는 style={{ '--sheet-width': ... }} 로 덮어쓴다(인라인 스타일이 항상 우선).
          "[--sheet-width:24rem]",
          floating
            ? cn(
                "z-40 overflow-hidden rounded-md border shadow-[0_12px_32px_rgba(0,0,0,0.14)]",
                "data-[side=bottom]:inset-x-3 data-[side=bottom]:bottom-3 data-[side=bottom]:h-auto",
                "data-[side=top]:inset-x-3 data-[side=top]:top-3 data-[side=top]:h-auto",
                "data-[side=left]:inset-y-3 data-[side=left]:left-3 data-[side=left]:h-auto data-[side=left]:w-3/4",
                "data-[side=right]:inset-y-3 data-[side=right]:right-3 data-[side=right]:h-auto data-[side=right]:w-3/4",
                "data-[side=left]:sm:max-w-(--sheet-width) data-[side=right]:sm:max-w-(--sheet-width)",
                "data-[side=bottom]:data-open:slide-in-from-bottom-6 data-[side=left]:data-open:slide-in-from-left-6 data-[side=right]:data-open:slide-in-from-right-6 data-[side=top]:data-open:slide-in-from-top-6",
                "data-[side=bottom]:data-closed:slide-out-to-bottom-6 data-[side=left]:data-closed:slide-out-to-left-6 data-[side=right]:data-closed:slide-out-to-right-6 data-[side=top]:data-closed:slide-out-to-top-6"
              )
            : cn(
                "z-50 shadow-lg",
                "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t",
                "data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r",
                "data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l",
                "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b",
                "data-[side=left]:sm:max-w-(--sheet-width) data-[side=right]:sm:max-w-(--sheet-width)",
                "data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10",
                "data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10"
              ),
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
