import { getDashboardStats } from '@backend/services/batches'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const stats = await getDashboardStats()
    return Response.json({ stats })
  } catch (err) {
    console.error('[api/dashboard GET]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
