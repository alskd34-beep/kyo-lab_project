"use client"

/**
 * 테마 전환 — 라이트 · 다크 · 시스템.
 *
 * 지금 무엇이 켜져 있는지 아이콘 하나로 보여 주고, 눌러서 셋 중 하나를 고른다.
 * '시스템'은 OS 설정을 따라가므로 실제로 그려지는 테마(resolvedTheme)로 아이콘을 정한다 —
 * 선택은 '시스템'인데 아이콘이 해였다 달이었다 하는 게 맞는 동작이다.
 */

import { useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import { Monitor, Moon, Sun } from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { Button } from "@frontend/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frontend/components/ui/dropdown-menu"

const OPTIONS = [
  { value: "light", label: "라이트", icon: Sun },
  { value: "dark", label: "다크", icon: Moon },
  { value: "system", label: "시스템", icon: Monitor },
] as const

/**
 * 클라이언트에서 그려지고 있는가.
 *
 * 서버는 사용자의 테마를 모르므로 마운트 전에 아이콘을 그리면 서버·클라이언트
 * 트리가 어긋나 하이드레이션이 깨진다. effect 안에서 setState 하는 대신
 * `useSyncExternalStore` 의 서버 스냅샷으로 판별한다 — 렌더가 한 번 덜 돈다.
 */
const noop = () => () => {}
const useMounted = () => useSyncExternalStore(noop, () => true, () => false)

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const mounted = useMounted()

  if (!mounted) {
    return <Button variant="ghost" size="icon" className={className} aria-hidden disabled />
  }

  const Icon = resolvedTheme === "dark" ? Moon : Sun
  const current = OPTIONS.find(o => o.value === theme) ?? OPTIONS[2]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("text-muted-foreground", className)}
          aria-label={`테마 변경 (현재 ${current.label})`}
          title={`테마 — ${current.label}`}
        >
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {OPTIONS.map(({ value, label, icon: OptionIcon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            aria-current={theme === value ? "true" : undefined}
            className={cn(theme === value && "font-medium text-primary")}
          >
            <OptionIcon />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
