import { NextRequest } from 'next/server'
import { listTesters } from '@backend/services/testers'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const canSoloParam = sp.get('canSolo')
    const isActiveParam = sp.get('isActive')

    const rows = await listTesters({
      canSolo:  canSoloParam  !== null ? canSoloParam  === 'true' : undefined,
      isActive: isActiveParam !== null ? isActiveParam === 'true' : undefined,
    })
    return Response.json({ rows })
  } catch (err) {
    console.error('[api/testers GET]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
