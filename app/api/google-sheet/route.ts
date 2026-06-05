/**
 * [BACKEND] 구글 스프레드시트 → JSON 가져오기
 *
 * GET /api/google-sheet?fileId=<id>[&mode=single|multi]
 *   - 공유 가능한(링크 공유) 시트의 첫 탭을 CSV로 가져와서 파싱
 *   - mode=single (기본): 첫 표 1개만 반환 (legacy)
 *   - mode=multi:        빈 줄로 구분된 여러 표를 모두 반환
 *   - 인증 필요 (로그인 사용자만 호출 가능)
 *
 * 응답 (single):  { fileId, columns, rows }
 * 응답 (multi):   { fileId, tables: Array<{ columns, rows }> }
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'

export const runtime = 'nodejs'

// 매우 단순한 CSV 파서 (큰따옴표/이스케이프 지원)
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let i = 0
  let field = ''
  let row: string[] = []
  let inQuotes = false

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

// 한 표(헤더+데이터)를 키 객체 배열로 변환
function gridToTable(grid: string[][]): { columns: string[]; rows: Record<string, string>[] } {
  if (grid.length === 0) return { columns: [], rows: [] }
  const columns = grid[0].map(c => c.trim())
  const rows    = grid.slice(1).map(r => {
    const obj: Record<string, string> = {}
    columns.forEach((col, idx) => { obj[col] = (r[idx] ?? '').trim() })
    return obj
  })
  return { columns, rows }
}

// 빈 행으로 표 그룹 분할 — 헤더가 또 나타나면 새 표 시작 신호
function splitTables(grid: string[][]): string[][][] {
  const tables: string[][][] = []
  let current: string[][] = []
  for (const row of grid) {
    const isEmpty = row.every(c => c.trim() === '')
    if (isEmpty) {
      if (current.length > 0) { tables.push(current); current = [] }
      continue
    }
    current.push(row)
  }
  if (current.length > 0) tables.push(current)
  // 헤더+데이터 한 줄 이상인 표만 유지
  return tables.filter(t => t.length >= 1)
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('fileId')
    const mode   = searchParams.get('mode') ?? 'single'
    if (!fileId || !/^[\w-]{20,}$/.test(fileId)) {
      return Response.json({ error: 'fileId 파라미터가 올바르지 않습니다.' }, { status: 400 })
    }

    const csvUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`
    const res = await fetch(csvUrl, { redirect: 'follow' })

    if (!res.ok) {
      return Response.json(
        { error: `시트 접근 실패 (HTTP ${res.status}). 공유 권한을 "링크가 있는 모든 사용자"로 설정했는지 확인해주세요.` },
        { status: 502 },
      )
    }

    const text = await res.text()
    const rawGrid = parseCsv(text)  // 빈 행 포함된 원본

    if (mode === 'multi') {
      const tableGrids = splitTables(rawGrid)
      const tables = tableGrids.map(gridToTable).filter(t => t.columns.length > 0)
      return Response.json({ fileId, tables })
    }

    // single (legacy): 빈 줄 제거 후 첫 표만
    const flatGrid = rawGrid.filter(r => r.some(c => c.trim() !== ''))
    const { columns, rows } = gridToTable(flatGrid)
    return Response.json({ fileId, columns, rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
