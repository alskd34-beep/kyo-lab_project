/**
 * [BACKEND] 장비 예약
 *   GET  /api/equipment-reservation?equipmentId=&from=&to=&userId=  — 목록 (인증)
 *       · admin: 전체(userId 지정 시 해당 사용자) · user: 본인 예약만
 *   POST /api/equipment-reservation { equipmentId, userId?, startDate, endDate }
 *       · admin: 임의 userId · user: 본인(userId 무시)
 *       선착순 정책에 따라 RESERVED 또는 WAITING 으로 생성됨.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { listReservations, createReservation } from '@backend/services/equipmentReservation'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const equipmentId = searchParams.get('equipmentId') ?? undefined
    const from = searchParams.get('from') ?? undefined
    const to   = searchParams.get('to') ?? undefined
    // 담당자는 본인 예약만, 관리자는 전체(userId 필터 옵션)
    const userId = auth.payload.role === 'admin'
      ? (searchParams.get('userId') ?? undefined)
      : auth.payload.sub
    const rows = await listReservations({ equipmentId, from, to, userId })
    return Response.json({ rows })
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
      equipmentId?: string
      userId?: string
      startDate?: string
      endDate?: string
    }
    if (!body.equipmentId || !body.equipmentId.trim()) {
      return Response.json({ error: '장비를 입력하세요.' }, { status: 400 })
    }
    if (!body.startDate || !body.endDate) {
      return Response.json({ error: '시작일과 종료일은 필수입니다.' }, { status: 400 })
    }
    if (body.endDate < body.startDate) {
      return Response.json({ error: '종료일은 시작일 이후여야 합니다.' }, { status: 400 })
    }
    // 담당자는 본인만 예약 가능, 관리자는 대상 지정
    const userId = auth.payload.role === 'admin' ? (body.userId ?? auth.payload.sub) : auth.payload.sub
    const row = await createReservation({
      equipmentId: body.equipmentId.trim(),
      userId,
      startDate: body.startDate,
      endDate: body.endDate,
    })
    return Response.json({ row })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
