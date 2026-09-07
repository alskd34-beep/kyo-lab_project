/**
 * [BACKEND] 부업무 기록
 *   GET  /api/side-work?from=&to=&testerId=&scope=   — 목록 (인증)
 *       · 기본은 팀 전체(월간 그리드가 남의 행도 그린다). scope=mine 이면 본인 것만.
 *       · testerId 는 관리자만 쓴다 — 시험자가 남을 지정해도 본인으로 좁힌다.
 *   POST /api/side-work { testerId?, workDate, categoryId, title, minutes, note? }
 *       · 시험자: 본인으로 저장(testerId 무시) · 관리자: 대상 지정 가능
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { createLog, listLogs, resolveActor } from '@backend/services/sideWork'

export const runtime = 'nodejs'

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const sp = req.nextUrl.searchParams
    const from = sp.get('from') ?? undefined
    const to   = sp.get('to') ?? undefined
    if ((from && !ISO.test(from)) || (to && !ISO.test(to))) {
      return Response.json({ error: 'from·to 는 YYYY-MM-DD 형식이어야 합니다.' }, { status: 400 })
    }

    const actor = await resolveActor(auth.payload.sub, auth.payload.role)
    // 남을 지정하는 것은 관리자만. 시험자는 scope=mine 일 때 본인으로 좁혀진다.
    const testerId = actor.role === 'admin'
      ? (sp.get('testerId') ?? undefined)
      : (sp.get('scope') === 'mine' ? (actor.testerId ?? '__none__') : undefined)

    const rows = await listLogs({ from, to, testerId })
    return Response.json({ rows, myTesterId: actor.testerId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as {
      testerId?: string; workDate?: string; categoryId?: string
      title?: string; minutes?: number; note?: string | null
    }
    if (!body.workDate || !body.categoryId || !body.title || body.minutes == null) {
      return Response.json({ error: '날짜·분류·내용·소요시간은 필수입니다.' }, { status: 400 })
    }
    const actor = await resolveActor(auth.payload.sub, auth.payload.role)
    const row = await createLog({
      testerId:   body.testerId,
      workDate:   body.workDate,
      categoryId: body.categoryId,
      title:      body.title,
      minutes:    body.minutes,
      note:       body.note ?? null,
    }, actor)
    return Response.json({ row })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    // 입력값 문제(형식·필수·연결 없음)는 4xx 다 — 서버 장애와 구분한다.
    const bad = /필수|형식|입력|선택|넘을 수 없|이상이어야|연결된 시험자/.test(msg)
    return Response.json({ error: msg }, { status: bad ? 400 : 500 })
  }
}
