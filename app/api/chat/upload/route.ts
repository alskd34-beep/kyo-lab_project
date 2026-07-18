/**
 * [BACKEND] 챗봇 이미지 업로드 → MISO 파일 업로드
 *   POST /api/chat/upload  (multipart/form-data, field: file)
 *
 * 시험자(MISO) 챗봇의 이미지(시험일지 등) 첨부용. 업로드 결과 file id 를 반환하면
 * 프런트가 /api/chat 의 files 배열로 전달한다. MISO 앱은 image 타입만 허용한다.
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { uploadMisoFile } from '@backend/lib/misoClient'

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
    if (!file.type.startsWith('image/')) {
      return Response.json({ error: '이미지 파일만 첨부할 수 있습니다.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ error: '이미지는 10MB 이하만 첨부할 수 있습니다.' }, { status: 400 })
    }
    const uploaded = await uploadMisoFile(file, file.name || 'image.png', auth.payload.sub)
    return Response.json({ id: uploaded.id, name: uploaded.name, mimeType: uploaded.mimeType })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 502 })
  }
}
