/**
 * [BACKEND] 구글 스프레드시트(PCT) 서버용 페치/파싱
 *
 * 공개 링크 공유 시트를 CSV로 가져와 PCT 오더 행으로 정규화한다.
 * (app/api/google-sheet/route.ts 의 파싱 로직을 서버 재사용 가능 형태로 추출)
 */

// ─── CSV 파서 (큰따옴표/이스케이프 지원) ─────────────────────────────────────
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

function gridToObjects(grid: string[][]): Record<string, string>[] {
  const flat = grid.filter(r => r.some(c => c.trim() !== ''))
  if (flat.length === 0) return []
  const columns = flat[0].map(c => c.trim())
  return flat.slice(1).map(r => {
    const obj: Record<string, string> = {}
    columns.forEach((col, idx) => { obj[col] = (r[idx] ?? '').trim() })
    return obj
  })
}

// ─── 컬럼명 fallback 체인 (시트 갱신 호환) ───────────────────────────────────
function pick(r: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k]
    if (v != null && v.trim() !== '') return v.trim()
  }
  return ''
}
const SHEET_KEY_CODE     = ['품목코드', '자재코드']
const SHEET_KEY_NAME     = ['품목명', '자재내역']
const SHEET_KEY_BATCH    = ['제조번호']
const SHEET_KEY_FORM     = ['제형']
const SHEET_KEY_PACK     = ['포장일_예정일', '포장일/예정일', '포장일']
const SHEET_KEY_DEADLINE = ['시험완료요청일', 'QC완료예정일', 'QC 완료예정일']
const SHEET_KEY_URGENT   = ['긴급', '우선순위']
const SHEET_KEY_METHOD   = ['진행방법']
const SHEET_KEY_NOTE     = ['비고']

/** 비고 텍스트에서 긴급 의도 추출 (부정표현 제외) */
function noteImpliesUrgent(note: string): boolean {
  const n = (note ?? '').trim()
  if (!n.includes('긴급')) return false
  if (/비\s*긴급/.test(n)) return false
  if (/긴급\s*(아님|아닙|안\s?됨|X|x|없음)/.test(n)) return false
  if (/긴급(하지|이|은)\s*(아니|않)/.test(n)) return false
  return true
}

/** 'M/D' 또는 'YYYY-MM-DD' → ISO 'YYYY-MM-DD' (실패 시 null) */
export function normalizeDate(s: string): string | null {
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[.\/](\d{1,2})$/)
  if (!m) return null
  const year = new Date().getFullYear()
  return `${year}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`
}

// ─── 정규화된 PCT 오더 행 ────────────────────────────────────────────────────
export interface SheetPctRow {
  productCode: string
  productName: string
  batchNo: string
  dosageForm: string
  packagingDate: string | null
  dueDate: string | null
  isUrgent: boolean
  method: '전항목' | '개별항목'
  note: string
}

/**
 * 공개 시트(fileId)를 CSV로 가져와 PCT 오더 행으로 정규화한다.
 * 품목코드/품목명이 모두 빈 행(메모 등)은 제외.
 */
export async function fetchPctSheet(fileId: string): Promise<SheetPctRow[]> {
  if (!fileId || !/^[\w-]{20,}$/.test(fileId)) {
    throw new Error('유효하지 않은 시트 fileId 입니다.')
  }
  const csvUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`
  const res = await fetch(csvUrl, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`시트 접근 실패 (HTTP ${res.status}). 공유 권한을 "링크가 있는 모든 사용자"로 설정했는지 확인하세요.`)
  }
  const objects = gridToObjects(parseCsv(await res.text()))

  return objects
    .filter(r => pick(r, SHEET_KEY_CODE) && pick(r, SHEET_KEY_NAME))
    .map((r): SheetPctRow => {
      const note = pick(r, SHEET_KEY_NOTE)
      const urgentRaw = pick(r, SHEET_KEY_URGENT)
      const methodRaw = pick(r, SHEET_KEY_METHOD)
      return {
        productCode: pick(r, SHEET_KEY_CODE),
        productName: pick(r, SHEET_KEY_NAME),
        batchNo:     pick(r, SHEET_KEY_BATCH),
        dosageForm:  pick(r, SHEET_KEY_FORM),
        packagingDate: normalizeDate(pick(r, SHEET_KEY_PACK)),
        dueDate:       normalizeDate(pick(r, SHEET_KEY_DEADLINE)),
        isUrgent: urgentRaw === '긴급' || noteImpliesUrgent(note),
        method: methodRaw === '개별항목' ? '개별항목' : '전항목',
        note,
      }
    })
    // 자연키(batch_no+code) 누락 행 제외
    .filter(r => r.batchNo && r.productCode)
}
