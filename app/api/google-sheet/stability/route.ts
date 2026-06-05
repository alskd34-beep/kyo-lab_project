/**
 * [BACKEND] 안정성 시트 API (멀티헤더 처리)
 *
 * GET /api/google-sheet/stability?fileId=<id>
 *
 * 시트의 첫 행은 그룹명("안정성시험 계획 정보", "상세정보", "진행정보"),
 * 두 번째 행이 실제 컬럼명(목록번호, 품목코드, 품목, 제조번호, 시험기간시작일 등).
 * 두 행을 합쳐 "그룹/필드" 형태로 키를 만든다.
 *
 * 응답:
 *   {
 *     fileId: string,
 *     columns: string[],
 *     rows: Array<Record<string, string>>
 *   }
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'

export const runtime = 'nodejs'

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let i = 0, field = '', row: string[] = [], inQuotes = false
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += ch; i++
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('fileId')
    if (!fileId || !/^[\w-]{20,}$/.test(fileId)) {
      return Response.json({ error: 'fileId 형식 오류' }, { status: 400 })
    }

    const csvUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`
    const res = await fetch(csvUrl, { redirect: 'follow' })
    if (!res.ok) {
      return Response.json({ error: `시트 fetch 실패 (HTTP ${res.status})` }, { status: 502 })
    }

    const text = await res.text()
    const grid = parseCsv(text).map(r => r.map(c => c.trim()))
    const nonEmpty = grid.filter(r => r.some(c => c !== ''))

    if (nonEmpty.length < 2) {
      return Response.json({ fileId, columns: [], rows: [] })
    }

    // 그룹 헤더(0행): 빈 셀은 좌측 그룹명을 상속 (병합된 그룹 헤더 대응)
    const rawGroup = nonEmpty[0]
    const groupHeaders: string[] = []
    let lastGroup = ''
    for (const cell of rawGroup) {
      if (cell.trim() !== '') lastGroup = cell.trim()
      groupHeaders.push(lastGroup)
    }
    // 필드 헤더(1행)
    const fieldHeaders = nonEmpty[1]

    // 합친 컬럼 키: "그룹/필드" (그룹이 빈 경우 필드만)
    const columns = fieldHeaders.map((f, idx) => {
      const g = groupHeaders[idx] || ''
      const fld = (f || '').trim()
      return g ? `${g}/${fld}` : fld
    })

    // 데이터 (2행 이후)
    const rows = nonEmpty.slice(2).map(r => {
      const obj: Record<string, string> = {}
      columns.forEach((col, idx) => { obj[col] = (r[idx] ?? '').trim() })
      return obj
    })

    return Response.json({ fileId, columns, rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
