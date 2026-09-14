"use client"

import { useState } from "react"
import { ExternalLink, MonitorCog, RotateCw } from "lucide-react"

import { PageHeader } from "@frontend/components/common/page-header"
import { Button } from "@frontend/components/ui/button"

/**
 * 분석 장비 서버의 Sample Scheduler 화면을 그대로 끼워 보여준다.
 *
 * 저 서버는 사내망(10.211.x.x)에 있고 우리 앱은 외부 클라우드에서 돌기 때문에,
 * 서버가 대신 불러다 줄 수 없다. 그래서 **보는 사람의 브라우저가 직접** 부르고,
 * 로그인도 이 화면 안에서 따로 한다.
 *
 * 화면이 왜 비었는지는 우리가 알아낼 수 없다 — 다른 출처의 화면이라 안쪽 상태를
 * 읽을 수 없고, 인증서가 막힌 경우 브라우저가 아무 신호도 주지 않는다.
 * 그래서 상태를 추측해 다르게 안내하지 않고, 안내를 **항상 같은 자리에** 둔다.
 */
export function EquipOperationView({ schedulerUrl }: { schedulerUrl: string | null }) {
  // 새로고침 버튼용. 다른 출처라 iframe 안쪽을 조작할 수 없어 key 를 바꿔 다시 그린다.
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      <PageHeader
        icon={MonitorCog}
        title="장비 가동 현황"
        description="분석 장비 서버의 Sample Scheduler 화면입니다. 사내망에서만 보입니다."
        actions={
          schedulerUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="lg" onClick={() => setReloadKey((n) => n + 1)}>
                <RotateCw />
                새로고침
              </Button>
              <Button asChild size="lg">
                <a href={schedulerUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  새 창으로 열기
                </a>
              </Button>
            </div>
          ) : undefined
        }
      />

      {schedulerUrl ? (
        <>
          <p className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs break-keep text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            아래가 비어 있으면 이 PC 에서 장비 서버를 아직 신뢰하지 않는 것입니다.
            [새 창으로 열기] 로 한 번 접속해 인증서 경고를 허용한 뒤 [새로고침] 을 누르세요.
            사내망이 아니거나 장비 서버가 꺼져 있어도 비어 있습니다.
          </p>

          <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-border">
            <iframe
              key={reloadKey}
              src={schedulerUrl}
              title="Sample Scheduler 장비 가동 현황"
              className="size-full border-0"
            />
          </div>
        </>
      ) : (
        <p className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm break-keep text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          장비 서버 주소가 설정되지 않았습니다. 환경변수 <code>SAMPLE_SCHEDULER_URL</code> 을
          설정한 뒤 다시 열어 주세요.
        </p>
      )}
    </div>
  )
}
