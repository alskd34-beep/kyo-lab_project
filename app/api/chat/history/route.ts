/**
 * [BACKEND] Chat History API
 *   GET  /api/chat/history                    → 대화 목록
 *   GET  /api/chat/history?conversationId=... → 특정 대화의 메시지
 */

import { NextRequest } from 'next/server'
import {
  listConversations,
  getMessages,
  upsertConversation,
  appendMessage,
} from '@backend/services/chatHistory'

export const runtime = 'nodejs'

const USER_KEY = 'kd-qc-user'

export async function GET(req: NextRequest) {
  try {
    const conversationId = req.nextUrl.searchParams.get('conversationId')
    if (conversationId) {
      const messages = await getMessages(conversationId)
      return Response.json({ messages })
    }
    const conversations = await listConversations(USER_KEY)
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
  try {
    const { difyConvId, userText, botText, title } = await req.json()
    if (!difyConvId || !userText) {
      return Response.json({ error: 'difyConvId, userText 필수' }, { status: 400 })
    }
    const convId = await upsertConversation({
      difyConvId,
      userKey: USER_KEY,
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
