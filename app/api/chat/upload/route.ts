/**
 * [BACKEND] 챗봇 이미지 업로드
 *   POST /api/chat/upload  (multipart/form-data, field: file)
 *
 * 이미지(시험일지 등)를 서버 임시 저장소에 넣고 불투명한 id 를 돌려준다.
 * 프런트가 /api/chat 의 files 배열로 그 id 를 전달하면 CLI 에 `-i` 로 넘어간다.
 * (2026-08-23: MISO 업로드 의존을 제거하고 로컬 저장소로 대체)
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { isSupportedImageType, storeChatImage } from '@backend/lib/chatUploads'

export const runtime = 'nodejs'

const MAX_BYTES = 10 * 1024 * 1024 // 10MB

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return Response.json({ error: '파일이 없습니다.' }, { status: 400 })
    }
    if (!isSupportedImageType(file.type)) {
      return Response.json(
        { error: 'PNG · JPG · WEBP · GIF 이미지만 첨부할 수 있습니다.' },
        { status: 400 },
      )
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: '이미지는 10MB 이하만 첨부할 수 있습니다.' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const stored = await storeChatImage(bytes, file.type, file.name, auth.payload.sub)
    return Response.json(stored)
  } catch (err) {
    console.error('[api/chat/upload]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
