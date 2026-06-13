/**
 * [BACKEND] PCT 시트 수동 적재 트리거
 *
 * POST /api/cron/ingest-pct   (admin only)
 *   body?: { fileId?: string }  — 미지정 시 app_settings/env/기본값 사용
 *
 * 9시/2시 자동 적재(node-cron)와 동일한 ingestPctSheet() 를 수동 실행한다.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { ingestPctSheet } from '@backend/services/pctIngest'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response

  try {
    const body = await req.json().catch(() => ({})) as { fileId?: string }
    const result = await ingestPctSheet(body.fileId)
    return Response.json(result)
  } catch (err) {
    console.error('[api/cron/ingest-pct]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
