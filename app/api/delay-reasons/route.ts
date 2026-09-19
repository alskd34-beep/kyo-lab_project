import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { listDelayReasonCategories } from '@backend/services/delayReasons'

export const runtime = 'nodejs'

/** 분류는 코드 고정이다. 이 API는 화면에서 선택지를 읽는 용도이며 CRUD를 제공하지 않는다. */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  const kind = req.nextUrl.searchParams.get('kind')
  if (kind && kind !== 'delay' && kind !== 'resume') {
    return Response.json({ error: '올바른 사유 유형이 아닙니다.' }, { status: 400 })
  }
  return Response.json({ rows: listDelayReasonCategories(kind as 'delay' | 'resume' | undefined) })
}
