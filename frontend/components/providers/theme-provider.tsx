"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

/**
 * 앱 테마 — 라이트 · 다크 · 시스템 세 가지.
 *
 * 예전에는 `forcedTheme="light"` 로 잠가 두었습니다. 화면들이 밝은 배경을 전제한
 * 색을 직접 적어 써서, 시스템 다크를 따라가면 제목·라벨이 묻혔기 때문입니다.
 * 지금은 색이 `app/globals.css` 의 토큰(`:root` / `.dark`)으로 모여 있어 두 테마를
 * 함께 관리할 수 있습니다.
 *
 * `defaultTheme="system"` — 처음 방문하면 OS 설정을 따라가고, 사용자가 고르면
 * 그 선택을 기억합니다(next-themes 가 localStorage 에 저장).
 * `disableTransitionOnChange` — 테마를 바꿀 때 화면 전체가 색을 애니메이션하며
 * 번지는 것을 막습니다.
 */
function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
