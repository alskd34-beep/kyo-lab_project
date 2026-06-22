/**
 * [BACKEND] Chat API Route
 * 실제 로직은 @backend/services/chat 에 위임합니다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { sendChatMessage } from '@backend/services/chat'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { message, conversationId } = await req.json()
    const difyRes = await sendChatMessage({
      message,
      conversationId,
      viewer: { userSub: auth.payload.sub, role: auth.payload.role },
      signal: req.signal,
    })

    return new Response(difyRes.body, {
      headers: {
        'Content-Type':    'text/event-stream',
        'Cache-Control':   'no-cache',
        Connection:        'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    console.error('[api/chat]', err)
    const msg = err instanceof Error ? err.message : '서버 오류가 발생했습니다.'
    const status = msg.includes('환경변수') || msg.includes('codex CLI') || msg.includes('Codex CLI') ? 503 : 500
    return Response.json({ error: msg }, { status })
  }
}
