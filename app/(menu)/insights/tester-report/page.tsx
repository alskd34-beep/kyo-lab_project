"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "@frontend/lib/auth-context"
import { api, errorMessage } from "@frontend/lib/api-client"
import { Button } from "@frontend/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@frontend/components/ui/select"
import { TesterReportSheet } from "@frontend/components/insights/tester-report-sheet"
import type { TesterReportResponse } from "@shared/tester-report"

export default function TesterReportPage() {
  const { user, loading: authLoading } = useAuth()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(String(currentYear))
  const [testerId, setTesterId] = useState("")
  const [report, setReport] = useState<TesterReportResponse | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const skipNextLoad = useRef(false)
  const years = useMemo(() => Array.from({ length: 6 }, (_, index) => String(currentYear - index)), [currentYear])

  const load = useCallback(async () => {
    if (!user) return
    setBusy(true); setError("")
    try {
      const query = new URLSearchParams({ year })
      if (user.role === "admin" && testerId) query.set("testerId", testerId)
      const data = await api.get<TesterReportResponse>(`/api/insights/tester-report?${query}`)
      setReport(data)
      if (user.role === "admin" && !testerId && data.testers?.[0]) {
        skipNextLoad.current = true
        setTesterId(data.testers[0].testerId)
      }
    } catch (err) { setError(errorMessage(err)); setReport(null) } finally { setBusy(false) }
  }, [testerId, user, year])

  useEffect(() => {
    if (skipNextLoad.current) { skipNextLoad.current = false; return }
    if (!authLoading && user) void load()
  }, [authLoading, user, load])

  return <div className="flex min-h-0 flex-1 flex-col overflow-auto"><div className="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6 print:p-0">
    <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-4 print:hidden">
      <label className="grid gap-1 text-sm font-medium">기간<Select value={year} onValueChange={setYear}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{years.map(value => <SelectItem key={value} value={value}>{value}년</SelectItem>)}</SelectContent></Select></label>
      {user?.role === "admin" && <label className="grid gap-1 text-sm font-medium">시험자<Select value={testerId} onValueChange={setTesterId}><SelectTrigger className="min-w-40"><SelectValue placeholder="시험자 선택" /></SelectTrigger><SelectContent>{(report?.testers ?? []).map(tester => <SelectItem key={tester.testerId} value={tester.testerId}>{tester.name}</SelectItem>)}</SelectContent></Select></label>}
      <Button variant="outline" onClick={() => void load()} disabled={busy}>{busy ? "조회 중…" : "새로고침"}</Button>
    </div>
    {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
    {report ? <TesterReportSheet report={report} /> : !busy && <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">보고서를 불러오는 중입니다.</div>}
  </div></div>
}
