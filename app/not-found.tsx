import Link from "next/link"
import { ArrowLeft, Home } from "lucide-react"

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/40 p-4">
      {/* 그림자·자간·초굵은 글씨로 무게를 주던 자리다. 로그인 화면과 같은 카드 한 겹으로 맞춘다. */}
      {/* 320px 에선 p-6(54px)이 내용 폭을 크게 먹는다 — 좁은 폭에서 한 단계 줄인다 */}
      <div className="w-full max-w-md rounded-md border bg-card p-5 text-center shadow-sm sm:p-6">
        <div className="mx-auto flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Home size={20} />
        </div>
        {/* 404 는 숫자다 — uppercase·tracking 은 붙을 이유가 없다. */}
        <p className="mt-4 text-xs leading-normal font-medium tabular-nums text-muted-foreground">404</p>
        {/* break-keep: 좁은 폭에서 한글이 단어 중간에서 끊기지 않게 한다. */}
        <h1 className="mt-1 text-lg font-semibold break-keep text-foreground">
          페이지를 찾을 수 없습니다
        </h1>
        <p className="mt-2 text-sm break-keep text-muted-foreground">
          요청하신 주소가 없거나 이동되었습니다. 인증이 필요한 화면이라면 먼저 로그인해 주세요.
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/home"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Home size={16} />
            홈으로
          </Link>
          <Link
            href="/login"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ArrowLeft size={16} />
            로그인으로
          </Link>
        </div>
      </div>
    </div>
  )
}
