import { ExternalLink, SearchCheck } from 'lucide-react'
import { OOT_STATUS_URL } from '@frontend/lib/external-links'

/**
 * 일탈관리 · OOT 현황조회 — 사내 조회 화면으로 보내는 안내 페이지.
 *
 * 사이드바 메뉴는 이 페이지를 거치지 않고 지금 창에서 바로 이동한다. 이 페이지는 옛 주소(/deviation/capa)
 * 즐겨찾기나 직접 입력으로 들어온 경우를 위한 것이다. 사내망 http 주소라 iframe 으로 넣으면
 * https 앱에서 브라우저가 막으므로 링크로만 연결한다.
 */
export default function OotStatusPage() {
  return (
    <div className="flex h-full w-full items-center justify-center p-4 sm:p-10">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <SearchCheck size={20} />
        </div>
        <h1 className="mt-4 break-keep text-xl font-semibold text-foreground">일탈관리 · OOT 현황조회</h1>
        <p className="mt-2 break-keep text-sm text-muted-foreground">
          OOT 현황은 사내 조회 화면에서 확인합니다. 사내망에서만 열립니다.
        </p>
        <a
          href={OOT_STATUS_URL}
          className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          OOT 현황조회 열기
          <ExternalLink size={14} />
        </a>
        <p className="mt-2 font-mono text-xs text-muted-foreground">{OOT_STATUS_URL}</p>
      </div>
    </div>
  )
}
