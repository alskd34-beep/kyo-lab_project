/**
 * [BACKEND] 마스터 시트 분해 API
 *
 * GET /api/google-sheet/master?fileId=<id>
 *
 * 마스터 시트는 1개 탭에 다음 6개 표가 연속 배치되어 있다 (빈 행 없음):
 *  1) 품목마스터    헤더: 순서|품목구분|품목코드|...
 *  2) 시험항목      헤더: 품목코드|품목명|시험 항목
 *  3) 시험자역량    헤더: 순번|이름|사번|HPLC|GC|...
 *  4) Solo/Duo      헤더: 순번|이름|사번|Solo|Duo
 *  5) 평균공수      헤더: 품목코드|품목명|시험공수
 *  6) 특이사항      헤더: 품목코드|품목명|시험 항목  (시험항목과 동일 헤더지만 의미 다름)
 *
 * 알려진 헤더 시그니처로 시작점을 찾아 분리한다.
 *
 * 응답:
 *   {
 *     products:       Array<...>,   // 품목마스터
 *     test_items:     Array<...>,
 *     capabilities:   Array<...>,   // 시험자 장비 역량
 *     solo_duo:       Array<...>,
 *     workload:       Array<...>,
 *     special_notes:  Array<...>,   // 시험항목별 특이사항
 *   }
 */

import { NextRequest } from 'next/server'
import * as XLSX from 'xlsx'
import { requireAuth } from '@backend/lib/guard'

export const runtime = 'nodejs'

// CSV 파서 (큰따옴표 이스케이프 지원)
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

// 알려진 표 시그니처 (첫 N개 셀 일치로 판단)
const TABLE_SIGNATURES: Array<{ name: string; match: (cells: string[]) => boolean }> = [
  { name: 'products',     match: c => c[0] === '순서'   && c[1] === '품목구분' && c[2] === '품목코드' },
  { name: 'test_items',   match: c => c[0] === '품목코드' && c[1] === '품목명' && /시험\s*항목/.test(c[2] || '') },
  { name: 'capabilities', match: c => c[0] === '순번'   && c[1] === '이름' && c[2] === '사번' && c[3] === 'HPLC' },
  { name: 'solo_duo',     match: c => c[0] === '순번'   && c[1] === '이름' && c[2] === '사번' && c[3] === 'Solo' },
  { name: 'workload',     match: c => c[0] === '품목코드' && c[1] === '품목명' && c[2] === '시험공수' },
  // special_notes는 test_items와 동일 헤더이므로 별도 시그니처 없음. 두 번째 매치를 special_notes로 처리.
]

function rowsToObjects(headers: string[], rows: string[][]) {
  return rows
    .filter(r => r.some(c => (c || '').trim() !== ''))
    .map(r => {
      const obj: Record<string, string> = {}
      headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim() })
      return obj
    })
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

    // XLSX export로 모든 탭 가져오기
    const xlsxUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`
    const res = await fetch(xlsxUrl, { redirect: 'follow' })
    if (!res.ok) {
      return Response.json({ error: `시트 fetch 실패 (HTTP ${res.status})` }, { status: 502 })
    }
    const ab = await res.arrayBuffer()
    const wb = XLSX.read(new Uint8Array(ab), { type: 'array' })

    // 각 탭(sheet)을 grid로 변환 후 시그니처 매칭
    const tables: Record<string, Record<string, string>[]> = {}
    let testItemsCount = 0  // 시험항목 → 두 번째 등장은 special_notes

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName]
      const grid = (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][])
        .map(r => r.map(c => String(c ?? '').trim()))
      if (grid.length === 0) continue

      // 헤더가 첫 줄이라고 가정 (마스터 시트는 1탭 1표)
      const headers = grid[0]
      for (const sig of TABLE_SIGNATURES) {
        if (sig.match(headers)) {
          let name = sig.name
          if (name === 'test_items') {
            if (testItemsCount === 1) name = 'special_notes'
            testItemsCount++
          }
          tables[name] = rowsToObjects(headers, grid.slice(1))
          break
        }
      }
    }

    return Response.json({
      fileId,
      products:      tables.products      ?? [],
      test_items:    tables.test_items    ?? [],
      capabilities:  tables.capabilities  ?? [],
      solo_duo:      tables.solo_duo      ?? [],
      workload:      tables.workload      ?? [],
      special_notes: tables.special_notes ?? [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
