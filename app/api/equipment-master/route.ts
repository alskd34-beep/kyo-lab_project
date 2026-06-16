/**
 * [BACKEND] 장비 마스터
 *   GET  /api/equipment-master          — 전체 목록 (인증)
 *   POST /api/equipment-master  { ... } — 장비 등록 (admin)
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { listEquipment, createEquipment } from '@backend/services/equipmentMaster'
import type { EquipmentMasterRow } from '@backend/services/equipmentMaster'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const rows = await listEquipment()
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as Partial<EquipmentMasterRow> & { code?: string; name?: string }
    if (!body.code?.trim()) {
      return Response.json({ error: '장비코드(code)는 필수입니다.' }, { status: 400 })
    }
    if (!body.name?.trim()) {
      return Response.json({ error: '장비명(name)은 필수입니다.' }, { status: 400 })
    }
    const row = await createEquipment(body as Partial<EquipmentMasterRow> & { code: string; name: string })
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
