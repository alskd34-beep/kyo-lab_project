import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { deleteUser, revokeAllUserTokens, updateUser } from '@backend/services/users'

export const runtime = 'nodejs'

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id } = await ctx.params
    const { displayName, avatarUrl, role, isActive, password } = await req.json()
    const user = await updateUser(id, { displayName, avatarUrl, role, isActive, password })
    if (password || isActive === false) {
      await revokeAllUserTokens(id)
    }
    return Response.json({ user })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: RouteCtx) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id } = await ctx.params
    if (id === g.payload.sub) {
      return Response.json({ error: '자기 자신은 삭제할 수 없습니다.' }, { status: 400 })
    }
    await deleteUser(id)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
