/**
 * [BACKEND] 반복 부업무
 *   POST /api/side-work/recurring            — 기간의 근무일마다 기록 생성 (인증)
 *   POST /api/side-work/recurring?preview=1  — 만들 날짜만 계산(쓰지 않음)
 *
 * 시험자는 본인으로만 만들 수 있다(testerId 를 보내도 무시). 관리자는 대상을 지정한다.
 * 미리보기와 생성이 서비스의 같은 함수로 날짜를 정하므로 화면에 보인 것과 어긋나지 않는다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { createRecurring, previewRecurring, resolveActor, type RecurringInput } from '@backend/services/sideWork'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const actor = await resolveActor(auth.payload.sub, auth.payload.role)
    const body = await req.json() as RecurringInput
    const preview = req.nextUrl.searchParams.get('preview') === '1'
    const result = preview
      ? await previewRecurring(body, actor)
      : await createRecurring(body, actor)
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
