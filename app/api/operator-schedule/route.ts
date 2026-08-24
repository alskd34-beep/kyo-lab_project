/**
 * [BACKEND] 시험자 휴가/출장 일정
 *   GET  /api/operator-schedule?from=&to=&userId=&scope=   — 목록 (인증)
 *       · admin: 전체(userId 지정 시 해당 사용자) · user: 본인 일정만
 *       · scope=team: 팀 전체를 읽기 전용으로 공개 — 서로 날짜가 겹치지 않게
 *         조절하려면 남의 휴가도 보여야 한다. 대신 개인 사유가 적히는 memo 는
 *         본인·관리자가 아니면 지운다.
 *   POST /api/operator-schedule { userId?, startDate, endDate, type?, memo? }
 *       · admin: 임의 userId · user: 본인(userId 무시)
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { listSchedules, createSchedule, type ScheduleType } from '@backend/services/operatorSchedule'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') ?? undefined
    const to   = searchParams.get('to') ?? undefined
    // 담당자는 본인 일정만, 관리자는 전체(userId 필터 옵션)
    // scope=team 은 예외 — 팀 휴가를 서로 겹치지 않게 조절하는 용도로 전원을 읽는다.
    const isAdmin = auth.payload.role === 'admin'
    const teamScope = searchParams.get('scope') === 'team'
    const userId = isAdmin
      ? (searchParams.get('userId') ?? undefined)
      : (teamScope ? undefined : auth.payload.sub)
    const rows = await listSchedules({ from, to, userId })
    // 남의 메모는 개인 사유다 — 팀 조회에서는 지운다.
    const visible = isAdmin
      ? rows
      : rows.map(r => (r.userId === auth.payload.sub ? r : { ...r, memo: null }))
    return Response.json({ rows: visible })
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
      userId?: string
      startDate?: string
      endDate?: string
      type?: ScheduleType
      memo?: string | null
    }
    if (!body.startDate || !body.endDate) {
      return Response.json({ error: '시작일과 종료일은 필수입니다.' }, { status: 400 })
    }
    if (body.endDate < body.startDate) {
      return Response.json({ error: '종료일은 시작일 이후여야 합니다.' }, { status: 400 })
    }
    // 담당자는 본인만 등록 가능, 관리자는 대상 지정
    const userId = auth.payload.role === 'admin' ? (body.userId ?? auth.payload.sub) : auth.payload.sub
    const row = await createSchedule({
      userId,
      startDate: body.startDate,
      endDate: body.endDate,
      type: body.type,
      memo: body.memo ?? null,
    })
    return Response.json({ row })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
