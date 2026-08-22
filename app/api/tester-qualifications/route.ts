/**
 * [BACKEND] 시험자 자격 인증 — 현황 조회 + 자격 부여/수정/해제 (조회=인증 / 쓰기=관리자)
 *   GET    /api/tester-qualifications  → { categories, items, testers, quals }
 *   POST   /api/tester-qualifications  { testerId, qualificationItemId, grantedOn, certType, certMethod, ... }
 *   PATCH  /api/tester-qualifications  { id, ...fields }
 *   DELETE /api/tester-qualifications  { id }
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import {
  getQualificationOverview,
  grantQualification,
  revokeQualification,
  updateQualification,
} from '@backend/services/testerQualifications'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const g = await requireAuth(req)
  if (!g.ok) return g.response
  try {
    return Response.json(await getQualificationOverview())
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    await grantQualification({
      testerId:            body.testerId,
      qualificationItemId: body.qualificationItemId,
      qualificationRole:   body.qualificationRole,
      grantedOn:           body.grantedOn,
      expiresOn:           body.expiresOn,
      certType:            body.certType,
      certMethod:          body.certMethod,
      note:                body.note,
    })
    return Response.json({ ok: true }, { status: 201 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id, ...fields } = await req.json()
    if (!id) return Response.json({ error: 'id는 필수입니다.' }, { status: 400 })
    await updateQualification(id, fields)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id } = await req.json()
    if (!id) return Response.json({ error: 'id는 필수입니다.' }, { status: 400 })
    await revokeQualification(id)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}
