"use client"

import { Printer } from "lucide-react"
import type { TesterReportResponse } from "@shared/tester-report"
import { Button } from "@frontend/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@frontend/components/ui/card"
import { Badge } from "@frontend/components/ui/badge"
import { MetricInfo } from "@frontend/components/insights/metric-info"

const pct = (value: number | null) => value == null ? "—" : `${value}%`
const days = (value: number | null) => value == null ? "—" : `${value}일`
const date = (value: string) => new Date(new Date(value).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

export function TesterReportSheet({ report }: { report: TesterReportResponse }) {
  const { tester, teamAverage, period } = report
  const recoveredCount = tester.recoveryRate == null ? "—" : `${Math.round(tester.recoveryRate * tester.delayJobs / 100)}건`
  return (
    <article className="mx-auto w-full max-w-5xl space-y-4 pb-8 print:max-w-none print:space-y-2 print:pb-0">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold">{period.from.slice(0, 4)}년 시험자 성과 보고서</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tester.name} · {period.from} ~ {period.to}</p>
        </div>
        <Button variant="outline" onClick={() => window.print()}><Printer /> 인쇄</Button>
      </div>
      <header className="hidden print:block">
        <h1 className="text-lg font-semibold">{period.from.slice(0, 4)}년 시험자 성과 보고서</h1>
        <p className="text-xs">시험자: {tester.name} · 산정기간: {period.from} ~ {period.to}</p>
      </header>

      <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2">
        <Card size="sm"><CardHeader><CardTitle>일정 준수</CardTitle></CardHeader><CardContent className="grid grid-cols-3 gap-3">
          <Metric metric="completedJobs" label="완료 시험" value={`${tester.completed}건`} />
          <Metric metric="dueCompliance" label="납기 준수율" value={report.insufficientSample ? "표본 부족" : pct(tester.dueComplianceRate)} />
          <Metric metric="overrunDaysTotal" label="기준 초과 누적일" value={days(tester.overrunDays)} />
        </CardContent></Card>
        <Card size="sm"><CardHeader><CardTitle>지연·리커버리</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric metric="delayReasons" label="지연 구간" value={`${tester.delayCount}건`} />
          <Metric metric="delayReasons" label="시험자 선언" value={`${tester.declaredDelayCount}건`} />
          <Metric metric="delayReasons" label="납기 초과 자동" value={`${tester.autoOverdueCount}건`} />
          <Metric metric="avgDelay" label="평균 지연일" value={days(tester.avgDelayDays)} />
          <Metric metric="recovery" label="리커버리율" value={report.insufficientSample ? "표본 부족" : pct(tester.recoveryRate)} />
        </CardContent></Card>
      </div>
      {report.insufficientSample && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 print:border-black print:bg-white">완료 시험이 3건 미만이라 비율 지표는 표본 부족으로 표시합니다. 건수 중심으로 확인해 주세요.</p>}
      <p className="text-sm text-muted-foreground">완료 {tester.completed}건 · 납기 준수 {report.insufficientSample ? "표본 부족" : pct(tester.dueComplianceRate)} · 지연 {tester.delayCount}건 중 {report.insufficientSample ? "표본 부족" : recoveredCount} 만회</p>
      <p className="flex items-center text-xs leading-normal text-muted-foreground">기준 초과일 구간<MetricInfo metric="overrun" />: 준수 {tester.overrunBuckets.compliant}건 · +1일 {tester.overrunBuckets.oneDay}건 · +2~3일 {tester.overrunBuckets.twoToThreeDays}건 · +4일 이상 {tester.overrunBuckets.fourPlusDays}건</p>

      <Card size="sm"><CardHeader><CardTitle>시험자 본인과 팀 평균</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">지표<MetricInfo metric="completedJobs" /></th><th className="p-2">{tester.name}</th><th className="p-2">팀 평균</th></tr></thead><tbody>
        <Compare metric="dueCompliance" label="납기 준수율" value={report.insufficientSample ? "표본 부족" : pct(tester.dueComplianceRate)} average={report.teamAverageSampleSize < 3 ? "표본 부족" : pct(teamAverage.dueComplianceRate)} />
        <Compare metric="avgDelay" label="평균 지연일" value={days(tester.avgDelayDays)} average={days(teamAverage.avgDelayDays)} />
        <Compare metric="holidayWork" label="휴일근무 완료" value={`${tester.holidayItems}건`} average={`${teamAverage.holidayItems}건`} />
        <Compare metric="sideRatio" label="부업무 비중" value={report.insufficientSample ? "표본 부족" : pct(tester.sideWorkRatio)} average={report.teamAverageSampleSize < 3 ? "표본 부족" : pct(teamAverage.sideWorkRatio)} />
      </tbody></table></CardContent></Card>

      <Card size="sm"><CardHeader><CardTitle>지연 내역</CardTitle><p className="text-sm text-muted-foreground">시험자·관리자 지정과 납기 초과 자동 판정을 구분해 표시합니다.</p>{report.delayReasonCoverage === "unrecorded" && <p className="text-xs leading-normal text-muted-foreground">사유 분류 기능 도입 전 기록은 사유 미기록으로 표시됩니다.</p>}</CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">구분<MetricInfo metric="delayReasons" /></th><th className="p-2">기간<MetricInfo metric="avgDelay" /></th><th className="p-2">품목·제조번호</th><th className="p-2">분류·사유<MetricInfo metric="delayReasons" /></th><th className="p-2">통제 범위<MetricInfo metric="externalDelay" /></th><th className="p-2">지연일<MetricInfo metric="avgDelay" /></th><th className="p-2">결과<MetricInfo metric="recovery" /></th></tr></thead><tbody>
        {report.delaySpans.length === 0 ? <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">기록된 지연이 없습니다.</td></tr> : report.delaySpans.map(span => <tr key={`${span.jobId}-${span.startedAt}`} className="border-b last:border-0"><td className="p-2"><Badge variant={span.declaredBy === "tester" ? "outline" : "secondary"}>{span.declaredBy === "tester" ? "시험자 선언" : span.declaredBy === "admin" ? "관리자 지정" : "자동 판정"}</Badge></td><td className="p-2">{date(span.startedAt)} ~ {span.endedAt ? date(span.endedAt) : "진행 중"}</td><td className="p-2">{span.productName ?? "—"} · {span.batchNo ?? "—"}</td><td className="p-2">{span.reasonCategoryName ?? "사유 미기록"}{span.note ? ` · ${span.note}` : ""}</td><td className="p-2">{span.attribution === "external" ? "통제 밖" : span.attribution === "internal" ? "통제 안" : "미정"}</td><td className="p-2">{span.workdays}일<MetricInfo metric="avgDelay" /></td><td className="p-2">{span.result ?? "—"}</td></tr>)}
      </tbody></table></CardContent></Card>

      <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2">
        <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-1.5">휴일근무 완료<MetricInfo metric="holidayWork" /></CardTitle></CardHeader><CardContent><p className="text-sm">공휴일 캘린더·주말과 작업 기록 날짜를 기준으로 자동 판정된 휴일 완료는 <strong>{tester.holidayItems}건</strong>입니다.</p><p className="mt-1 text-sm text-muted-foreground">부업무 {tester.holidaySideWorkCount}건 · {tester.holidaySideWorkMinutes}분</p></CardContent></Card>
        <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-1.5">부업무 비중<MetricInfo metric="sideRatio" /></CardTitle></CardHeader><CardContent><p className="text-sm">시험 대비 부업무 기록 비중은 <strong>{report.insufficientSample ? "표본 부족" : pct(tester.sideWorkRatio)}</strong>입니다.</p><p className="mt-1 text-sm text-muted-foreground">시험 {tester.sideToTestRatio == null ? "—" : `${tester.sideToTestRatio}배`} · 기간 근무일 {period.workingDays}일</p></CardContent></Card>
      </div>
      <p className="text-xs leading-normal text-muted-foreground print:mt-2">지연일은 선택 기간과 겹치는 지연 상태 구간만 합산합니다. 납기 초과 자동 판정은 시험자 선언 지연과 별도 지표입니다.</p>
      <p className="text-xs leading-normal text-muted-foreground print:mt-1">이 표는 운영 기록이며 인사 평가 자료가 아닙니다.</p>
      <style jsx global>{`@media print { @page { size: A4; margin: 10mm; } html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; background: white !important; } [data-slot="sidebar-wrapper"], [data-slot="sidebar-inset"], #main-content, [data-slot="sidebar-gap"] { height: auto !important; min-height: 0 !important; overflow: visible !important; } [data-slot="sidebar-wrapper"] { display: block !important; } [data-sidebar], [data-slot="sidebar"], [data-slot="sidebar-gap"], header:not(article header) { display: none !important; } [data-slot="sidebar-inset"] { display: block !important; width: 100% !important; } article { max-width: none !important; } article > * { break-inside: avoid; } }`}</style>
    </article>
  )
}

function Metric({ metric, label, value }: { metric: import("@frontend/lib/metric-help").MetricKey; label: string; value: string }) { return <div><p className="flex items-center text-xs text-muted-foreground">{label}<MetricInfo metric={metric} /></p><p className="mt-1 text-lg font-semibold">{value}</p></div> }
function Compare({ metric, label, value, average }: { metric: import("@frontend/lib/metric-help").MetricKey; label: string; value: string; average: string }) { return <tr className="border-b last:border-0"><td className="p-2"><span className="inline-flex items-center">{label}<MetricInfo metric={metric} /></span></td><td className="p-2 font-medium">{value}</td><td className="p-2 text-muted-foreground">{average}</td></tr> }
