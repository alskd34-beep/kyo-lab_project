import { Geist_Mono } from "next/font/google"
import localFont from "next/font/local"
import type { Metadata } from "next"

import "./globals.css"
import "./styles/typography.scss"
import { ThemeProvider } from "@frontend/components/providers/theme-provider"
import { AuthProvider } from "@frontend/lib/auth-context"
import { ToastMessageProvider } from "@frontend/components/common/toast-message"
import { ConfirmMessageProvider } from "@frontend/components/common/confirm-message"
import { cn } from "@frontend/lib/utils";

export const metadata: Metadata = {
  title: '광동제약 QC 시험 관리 시스템',
  description: '광동제약 품질관리(QC) 시험 관리 시스템',
}

// Pretendard 변수 폰트. 파일을 저장소에 직접 두고(frontend/assets/fonts) 셀프 호스팅한다.
// npm 패키지나 외부 CDN 에 의존하지 않으므로 어떤 환경에서도 같은 폰트가 적용된다.
// fallback 을 여기서 넘기면 생성되는 --font-sans 자체가 완성된 폰트 스택이 된다.
const pretendard = localFont({
  src: "../frontend/assets/fonts/PretendardVariable.woff2",
  variable: "--font-sans",
  weight: "45 920",
  style: "normal",
  display: "swap",
  preload: true,
  fallback: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Malgun Gothic", "sans-serif"],
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", pretendard.variable)}
    >
      {/* 일부 브라우저 확장이 하이드레이션 전에 <body> 에 style 을 주입한다
          (예: -webkit-text-size-adjust). 서버 HTML 은 깨끗하므로 앱의 문제는
          아니지만 React 가 속성 불일치로 경고한다. suppressHydrationWarning 은
          한 단계만 적용되어 <html> 것으로는 <body> 가 덮이지 않으므로 따로 둔다. */}
      <body suppressHydrationWarning>
        <ThemeProvider>
          <AuthProvider>
            <ToastMessageProvider>
              <ConfirmMessageProvider>{children}</ConfirmMessageProvider>
            </ToastMessageProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
