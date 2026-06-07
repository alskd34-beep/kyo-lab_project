/**
 * PCT 생산관리 → 월간 스케줄 브릿지
 *
 * PCT에서 자동 배정 후 "스케줄 생성" 클릭 시,
 * 결과를 localStorage에 저장 → 월간 스케줄 페이지에서 읽어 표시.
 *
 * DB 영속화(Phase 4)는 별도 단계. 지금은 클라이언트 캐시로 시각적 흐름 검증.
 */

const STORAGE_KEY = 'kd-pct-monthly-schedules-v1'

/** 월간 페이지에서 그리드에 표시할 단일 항목 */
export interface PctMonthlyAssignment {
  /** 고유 식별자 (품목코드+제조번호+담당자 조합 해시) */
  key:           string
  /** ISO 'YYYY-MM-DD' — 그리드 셀 매핑용 */
  scheduledDate: string
  /** 시험자 이름 — 그리드 행 매핑용 */
  testerName:    string
  /** 품목명 */
  productName:   string
  /** 품목코드 */
  productCode:   string
  /** 제조번호 */
  batchNo:       string
  /** 시험항목 표시 — '전항목' 또는 '개별항목' */
  testItems:     string[]
  /** 공수(일) — 디폴트 1 */
  workdays:      number
  /** 긴급 여부 */
  isUrgent:      boolean
  /** 비고 */
  note:          string
  /** 생성 시각 (ISO) */
  createdAt:     string
}

/** localStorage에 저장된 전체 스냅샷 */
export interface PctMonthlySnapshot {
  version:     1
  generatedAt: string
  assignments: PctMonthlyAssignment[]
}

/**
 * PCT 페이지의 단일 행을 월간 항목으로 변환.
 * 담당자 미지정이거나 포장일 파싱 실패면 null 반환.
 */
export function pctRowToMonthly(row: {
  품목코드:   string
  품목명:     string
  제조번호:   string
  포장일:     string
  긴급:       string  // '일반' | '긴급'
  진행방법:   string  // '전항목' | '개별항목'
  담당자:     string
  비고:       string
}): PctMonthlyAssignment | null {
  if (!row.담당자 || !row.담당자.trim()) return null
  const date = normalizeDate(row.포장일)
  if (!date) return null

  const noteUrgent = /긴급/.test(row.비고 ?? '') && !/(비\s*긴급|긴급\s*(아님|아닙|안\s?됨|X|x|없음)|긴급(하지|이|은)\s*(아니|않))/.test(row.비고 ?? '')

  return {
    key:           `${row.품목코드}-${row.제조번호}-${row.담당자}`,
    scheduledDate: date,
    testerName:    row.담당자.trim(),
    productName:   row.품목명,
    productCode:   row.품목코드,
    batchNo:       row.제조번호,
    testItems:     [row.진행방법 || '전항목'],
    workdays:      1,
    isUrgent:      row.긴급 === '긴급' || noteUrgent,
    note:          row.비고 ?? '',
    createdAt:     new Date().toISOString(),
  }
}

/** 'M/D' 또는 'YYYY-MM-DD' → 'YYYY-MM-DD' (실패 시 null) */
function normalizeDate(s: string): string | null {
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[\.\/](\d{1,2})$/)
  if (!m) return null
  const year = new Date().getFullYear()
  return `${year}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`
}

/** 스냅샷 저장 (덮어쓰기) */
export function savePctMonthlySnapshot(assignments: PctMonthlyAssignment[]): void {
  if (typeof window === 'undefined') return
  const snapshot: PctMonthlySnapshot = {
    version:     1,
    generatedAt: new Date().toISOString(),
    assignments,
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)) }
  catch { /* QuotaExceededError 등 무시 */ }
}

/** 스냅샷 읽기 (없거나 파싱 실패면 null) */
export function loadPctMonthlySnapshot(): PctMonthlySnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PctMonthlySnapshot
    if (parsed?.version !== 1 || !Array.isArray(parsed.assignments)) return null
    return parsed
  } catch {
    return null
  }
}

/** 스냅샷 삭제 */
export function clearPctMonthlySnapshot(): void {
  if (typeof window === 'undefined') return
  try { localStorage.removeItem(STORAGE_KEY) }
  catch { /* 무시 */ }
}
