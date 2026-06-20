/**
 * [BACKEND] 동시분석 품목군 마스터
 *   GET  /api/concurrent-product-families       — 목록 (인증)
 *   POST /api/concurrent-product-families        — 생성 (admin)  { name, note?, codes[] }
 *   POST /api/concurrent-product-families?seed=1 — 현재 데이터 기준 자동 생성 (admin)
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { listFamilies, createFamily, seedFromProducts } from '@backend/services/concurrentProductFamilies'

export const runtime = 'nodejs'

/**
 * Supabase(PostgREST) 에러는 Error 인스턴스가 아닌 일반 객체라 `String(err)`가
 * "[object Object]"로 뭉개진다. code/message/hint 를 살려 의미 있는 메시지로 변환한다.
 * 특히 PGRST205(스키마 캐시 미갱신)는 조치 방법을 안내한다.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const e = err as { code?: string; message?: string; hint?: string }
    if (e.code === 'PGRST205') {
      return '동시분석 품목군 테이블이 아직 PostgREST 스키마 캐시에 반영되지 않았습니다. '
        + 'Supabase SQL Editor 에서 `notify pgrst, \'reload schema\';` 를 실행(또는 마이그레이션 0020 재실행)한 뒤 다시 시도하세요.'
    }
    if (e.message) return e.code ? `${e.message} (${e.code})` : e.message
  }
  return '서버 오류'
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const rows = await listFamilies()
    return Response.json({ rows })
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    if (req.nextUrl.searchParams.get('seed') === '1') {
      const result = await seedFromProducts()
      return Response.json(result)
    }
    const body = await req.json() as { name?: string; note?: string | null; codes?: string[] }
    if (!body.name?.trim()) return Response.json({ error: '품목군 이름은 필수입니다.' }, { status: 400 })
    const id = await createFamily(body.name, body.note ?? null, body.codes ?? [])
    return Response.json({ id })
  } catch (err) {
    return Response.json({ error: errorMessage(err) }, { status: 500 })
  }
}
