"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

/**
 * 앱 테마 — 밝은(light) 테마로 고정.
 *
 * 이 앱의 UI는 밝은 테마 기준(고대비 파스텔 카드)으로 디자인되어 있어,
 * 시스템 다크 모드를 따라가면 제목/라벨이 배경에 묻히는 저대비 문제가 발생합니다.
 * `forcedTheme="light"` 로 OS 설정과 무관하게 항상 밝은 테마를 적용합니다.
 */
function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      forcedTheme="light"
      enableSystem={false}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

export { ThemeProvider }
