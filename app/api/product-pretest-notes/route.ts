/**
 * [BACKEND] 품목별 시험 전 확인사항 (일시·작성자·특이사항·이슈로트 포함)
 *   GET    /api/product-pretest-notes?productId=                                   — 목록 (인증)
 *   POST   { productId 또는 productIds[], content, occurredAt?, remark?, issueLot? } — 추가 (인증, 작성자 자동기록, 유사 품목 동시 적재 지원)
 *   PATCH  { id, content?, occurredAt?, remark?, issueLot? }                        — 수정 (인증)
 *   DELETE { id }                                                                  — 삭제 (인증)
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import {
  listByProduct,
  addNoteToProducts,
  updateNote,
  removeNote,
} from '@backend/services/productPretestNotes'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const productId = req.nextUrl.searchParams.get('productId')
    if (!productId) return Response.json({ error: 'productId 필수' }, { status: 400 })
    const rows = await listByProduct(productId)
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { productId, productIds, content, occurredAt, remark, issueLot } = await req.json()
    // 대상 품목: productIds(유사 품목 동시 적재) 우선, 없으면 단일 productId
    const ids: string[] = Array.isArray(productIds) && productIds.length > 0
      ? productIds.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
      : (typeof productId === 'string' && productId ? [productId] : [])
    if (ids.length === 0 || !content?.trim()) {
      return Response.json({ error: 'productId(또는 productIds), content는 필수입니다.' }, { status: 400 })
    }
    const count = await addNoteToProducts(ids, {
      content: content.trim(),
      occurredAt: occurredAt || null,
      remark: remark?.trim() || null,
      issueLot: issueLot?.trim() || null,
      // 작성자는 로그인 토큰에서 자동 기록 (위변조 방지)
      createdBy: auth.payload.sub ?? null,
      createdByName: auth.payload.username ?? null,
    })
    return Response.json({ count }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id, content, occurredAt, remark, issueLot } = await req.json()
    if (!id) return Response.json({ error: 'id 필수' }, { status: 400 })
    await updateNote(id, {
      ...(content !== undefined ? { content: String(content).trim() } : {}),
      ...(occurredAt !== undefined ? { occurredAt: occurredAt || null } : {}),
      ...(remark !== undefined ? { remark: remark?.trim() || null } : {}),
      ...(issueLot !== undefined ? { issueLot: issueLot?.trim() || null } : {}),
    })
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await req.json()
    if (!id) return Response.json({ error: 'id 필수' }, { status: 400 })
    await removeNote(id)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
