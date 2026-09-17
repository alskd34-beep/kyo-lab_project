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
// 2026-09 실측: 시트 실제 헤더는 '구분' 이다(예전 '밸리데이션구분' 은 현재 시트에 없음).
// 그런데도 '구분'을 맨 뒤에 두는 이유는 pick()이 앞에서부터 빈 값이 아닌 첫 값을
// 채택하기 때문 — '구분'은 일반적인 단어라, 시트가 나중에 더 구체적인 '밸리데이션구분'
// 열을 다시 두면 그쪽이 우선해야 한다. 오늘 동작은 어느 순서든 동일하다.
const SHEET_KEY_VALID    = ['밸리데이션구분', '밸리데이션 구분', '밸리데이션', '구분']

/**
 * 구분 정규화.
 *
 * 시트에는 PV1/CV/MV 처럼 대문자로 적히지만 사람이 손으로 채우는 열이라
 * 'pv1', 'Cv' 가 섞여 들어온다. 그대로 두면 같은 구분이 다른 값으로 쌓여
 * 집계·필터가 갈라지므로 대문자로 맞춘다(한글은 대소문자가 없어 영향 없다).
 * 빈 값은 null 이다 — '일반' 으로 채우지 않는다. 시트가 비어 있는 것과
 * 담당자가 '일반' 이라고 적은 것은 다른 사실이다.
 */
function normalizeValidationType(raw: string): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  // 셀 안의 줄바꿈·중복 공백은 한 칸으로 접는다 ('PV 1' 같은 표기 흔들림 흡수)
  return v.replace(/\s+/g, ' ').toUpperCase()
}

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
  /**
   * 시트에 품목코드가 비어 있어 품목명으로 만들어 넣은 코드인가.
   * true 면 제조팀이 코드를 채우기 전까지 쓰는 임시값이다 — 적재가 알림으로 알린다.
   */
  codeGenerated: boolean
  productName: string
  batchNo: string
  dosageForm: string
  packagingDate: string | null
  dueDate: string | null
  isUrgent: boolean
  method: '전항목' | '개별항목'
  note: string
  /** 구분(일반/PV1/CV/MV/…). 시트 열이 비었으면 null */
  validationType: string | null
}

/** 오더로 만들지 못한 시트 행 — 조용히 버리지 않고 사유와 함께 돌려준다 */
export interface SheetSkippedRow {
  reason: string
  productName: string
  batchNo: string
}

export interface SheetPctResult {
  rows: SheetPctRow[]
  skipped: SheetSkippedRow[]
}

/**
 * 품목코드가 빈 행에 넣을 임시 코드.
 *
 * 오더의 자연키가 (제조번호 + 품목코드)라 이 값은 **매 적재마다 같아야 한다.**
 * 무작위로 만들면 적재를 돌릴 때마다 같은 행이 새 오더가 되고, 직전 것은 "시트에서
 * 사라졌다"로 소프트 삭제된다 — 배정이 매번 날아간다.
 * 그래서 품목명에서 결정적으로(deterministic) 만든다. 같은 품목명은 언제나 같은 코드다.
 *
 * 접두사 AUTO- 는 눈으로 구분하기 위한 것이다. 실제 코드는 숫자(21080)나
 * 영문+숫자(MT26001) 형태라 충돌하지 않는다.
 */
export function generatedProductCode(productName: string): string {
  const normalized = productName.trim().replace(/\s+/g, ' ')
  // FNV-1a 32bit — 외부 의존 없이 결정적이고 짧다. 충돌해도 자연키는 제조번호와 함께라
  // 오더가 섞이지 않고, 화면에서 사람이 바로 알아본다.
  let h = 0x811c9dc5
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `AUTO-${h.toString(16).toUpperCase().padStart(8, '0')}`
}

/**
 * 공개 시트(fileId)를 CSV로 가져와 PCT 오더 행으로 정규화한다.
 *
 * 예전에는 품목코드가 빈 행을 `.filter()` 로 **조용히 버렸다.** 적재 로그에도 실패
 * 건수에도 잡히지 않아, 제조팀이 코드를 안 적은 오더는 아무 흔적 없이 시스템에서
 * 사라졌다. 이제 코드는 품목명에서 만들어 넣고, 그래도 만들 수 없는 행(품목명·제조번호
 * 누락)은 사유와 함께 돌려준다 — 호출부가 세고 알린다.
 */
export async function fetchPctSheet(fileId: string): Promise<SheetPctResult> {
  if (!fileId || !/^[\w-]{20,}$/.test(fileId)) {
    throw new Error('유효하지 않은 시트 fileId 입니다.')
  }
  const csvUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`
  const res = await fetch(csvUrl, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`시트 접근 실패 (HTTP ${res.status}). 공유 권한을 "링크가 있는 모든 사용자"로 설정했는지 확인하세요.`)
  }
  return parsePctCsv(await res.text())
}

/**
 * CSV 본문 → PCT 오더 행. 네트워크와 분리해 두어 **코드가 빈 행** 같은 경로를
 * 실제 시트를 건드리지 않고 검증할 수 있게 한다.
 */
export function parsePctCsv(csvText: string): SheetPctResult {
  const objects = gridToObjects(parseCsv(csvText))

  const rows: SheetPctRow[] = []
  const skipped: SheetSkippedRow[] = []

  for (const r of objects) {
    const productName = pick(r, SHEET_KEY_NAME)
    const batchNo     = pick(r, SHEET_KEY_BATCH)
    const rawCode     = pick(r, SHEET_KEY_CODE)

    // 완전히 빈 줄(시트의 메모·구분선)은 세지 않는다 — 그건 누락이 아니다.
    if (!productName && !batchNo && !rawCode) continue

    // 제조번호는 만들어 낼 수 없다. 품목명은 코드가 있으면 인제스트 단계에서
    // 품목마스터와 대조해 보완할 수 있으므로, 코드가 있는 행은 보존한다.
    // 코드도 없으면 기존처럼 품목명에서 임시 코드를 만들기 위해 품목명이 필요하다.
    if (!productName && !rawCode) { skipped.push({ reason: '품목명 없음', productName, batchNo }); continue }
    if (!batchNo)     { skipped.push({ reason: '제조번호 없음', productName, batchNo }); continue }

    const codeGenerated = !rawCode
    {
      const note = pick(r, SHEET_KEY_NOTE)
      const urgentRaw = pick(r, SHEET_KEY_URGENT)
      const methodRaw = pick(r, SHEET_KEY_METHOD)
      rows.push({
        // 코드가 비면 품목명에서 만들어 넣는다. 같은 품목명은 언제나 같은 코드라
        // 적재를 다시 돌려도 같은 오더로 이어진다.
        productCode: rawCode || generatedProductCode(productName),
        codeGenerated,
        productName,
        batchNo,
        dosageForm:  pick(r, SHEET_KEY_FORM),
        packagingDate: normalizeDate(pick(r, SHEET_KEY_PACK)),
        dueDate:       normalizeDate(pick(r, SHEET_KEY_DEADLINE)),
        isUrgent: urgentRaw === '긴급' || noteImpliesUrgent(note),
        method: methodRaw === '개별항목' ? '개별항목' : '전항목',
        note,
        validationType: normalizeValidationType(pick(r, SHEET_KEY_VALID)),
      })
    }
  }

  return { rows, skipped }
}
