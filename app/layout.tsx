import { Geist, Geist_Mono } from "next/font/google"
import type { Metadata } from "next"

import "./globals.css"
import { ThemeProvider } from "@frontend/components/providers/theme-provider"
import { AuthProvider } from "@frontend/lib/auth-context"
import { ToastMessageProvider } from "@frontend/components/common/toast-message"
import { cn } from "@frontend/lib/utils";

export const metadata: Metadata = {
  title: '광동제약 QC 시험 관리 시스템',
  description: '광동제약 품질관리(QC) 시험 관리 시스템',
}

const geist = Geist({subsets:['latin'],variable:'--font-sans'})

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
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", geist.variable)}
    >
      <body>
        <ThemeProvider>
          <AuthProvider>
            <ToastMessageProvider>{children}</ToastMessageProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
