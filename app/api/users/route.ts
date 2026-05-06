import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { createUser, listUsers } from '@backend/services/users'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const users = await listUsers()
    return Response.json({ users })
  } catch (err) {
    console.error('[api/users GET]', err)
    return Response.json({ error: '서버 오류' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { username, password, displayName, role } = await req.json()
    if (!username || !password) {
      return Response.json({ error: 'username, password 필수' }, { status: 400 })
    }
    const user = await createUser({ username, password, displayName, role })
    return Response.json({ user }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    const status = msg.includes('duplicate') ? 409 : 500
    return Response.json({ error: msg }, { status })
  }
}
