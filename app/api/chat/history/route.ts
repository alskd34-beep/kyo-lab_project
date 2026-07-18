/**
 * [BACKEND] Chat History API
 *   GET  /api/chat/history                    → 대화 목록
 *   GET  /api/chat/history?conversationId=... → 특정 대화의 메시지
 *   DELETE /api/chat/history                   → 사용자 대화 전체 삭제
 */

import { NextRequest } from 'next/server'
import {
  listConversations,
  getMessages,
  upsertConversation,
  appendMessage,
  deleteConversations,
} from '@backend/services/chatHistory'
import { requireAuth } from '@backend/lib/guard'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const conversationId = req.nextUrl.searchParams.get('conversationId')
    if (conversationId) {
      const messages = await getMessages(conversationId, auth.payload.sub)
      return Response.json({ messages })
    }
    const conversations = await listConversations(auth.payload.sub)
    return Response.json({ conversations })
  } catch (err) {
    console.error('[api/chat/history GET]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

/**
 * POST /api/chat/history
 * body: { difyConvId, userText, botText, title? }
 * 한 차례의 사용자/봇 메시지를 저장합니다.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { difyConvId, userText, botText, title } = await req.json()
    if (!difyConvId || !userText) {
      return Response.json({ error: 'difyConvId, userText 필수' }, { status: 400 })
    }
    const convId = await upsertConversation({
      difyConvId,
      userKey: auth.payload.sub,
      title:   title ?? userText.slice(0, 40),
    })
    await appendMessage({ conversationId: convId, role: 'user', content: userText })
    if (botText) {
      await appendMessage({ conversationId: convId, role: 'bot', content: botText })
    }
    return Response.json({ conversationId: convId })
  } catch (err) {
    console.error('[api/chat/history POST]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

/** DELETE /api/chat/history */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  try {
    await deleteConversations(auth.payload.sub)
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[api/chat/history DELETE]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
