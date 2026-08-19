import Link from "next/link"
import { ArrowLeft, Home } from "lucide-react"

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-lg rounded-md border border-slate-200 bg-white p-6 text-center shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-blue-600 text-white shadow-lg shadow-blue-200/60">
          <Home size={24} />
        </div>
        <p className="mt-5 text-[11px] font-bold tracking-[0.3em] text-slate-400 uppercase">
          404
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
          페이지를 찾을 수 없습니다
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          요청하신 주소가 없거나 이동되었습니다. 인증이 필요한 화면이라면 먼저 로그인 후 다시 시도해주세요.
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/home"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Home size={16} />
            홈으로
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ArrowLeft size={16} />
            로그인으로
          </Link>
        </div>
      </div>
    </div>
  )
}
