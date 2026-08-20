import { Geist_Mono } from "next/font/google"
import localFont from "next/font/local"
import type { Metadata } from "next"

import "./globals.css"
import { ThemeProvider } from "@frontend/components/providers/theme-provider"
import { AuthProvider } from "@frontend/lib/auth-context"
import { ToastMessageProvider } from "@frontend/components/common/toast-message"
import { ConfirmMessageProvider } from "@frontend/components/common/confirm-message"
import { cn } from "@frontend/lib/utils";

export const metadata: Metadata = {
  title: '광동제약 QC 시험 관리 시스템',
  description: '광동제약 품질관리(QC) 시험 관리 시스템',
}

const pretendard = localFont({
  src: "../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-sans",
  weight: "45 920",
  display: "swap",
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
      <body>
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
