/**
 * 주간 계획 자동 작성 룰 엔진 (클라이언트 사이드)
 *
 * 입력:
 *  - PCT 시트 데이터 (해당 주간 처리할 품목)
 *  - 마스터 데이터 (시험항목, 시험자 역량, Solo/Duo, 평균공수, 특이사항)
 *  - 안정성 시트 (품목코드 매칭 → 동시분석 추가)
 *  - 주간 기간 (시작일/종료일)
 *
 * 출력:
 *  - 일자별 시험자 배정 (시험자×날짜 그리드 또는 카드 묶음)
 *  - 안정성 동시분석 정보
 *  - 특이사항
 *  - 미배정 사유
 */

// ─── Domain Types ────────────────────────────────────────────────────────────
export interface PctItem {
  품목코드:   string
  품목명:     string
  제조번호:   string
  제형:       string
  포장일:     string      // ISO 또는 'M/D'
  시험완료요청일: string
  긴급:       boolean
  진행방법:   '전항목' | '개별항목'
  담당자:     string      // 사전 지정된 담당자명 (있으면 우선 사용)
}

export interface TestItemRow {
  품목코드: string
  품목명: string             // 서브코드 (예: '10005-1')
  '시험 항목': string
}

export interface CapabilityRow {
  순번: string
  이름: string
  사번: string
  [equip: string]: string    // 'HPLC':'Y' 등
}

export interface SoloDuoRow {
  순번: string
  이름: string
  사번: string
  Solo: string               // 'O'|'X'
  Duo:  string
}

export interface SpecialNoteRow {
  품목코드: string
  품목명: string             // 서브코드 (예: '10005-1')
  '시험 항목': string         // 주의사항 텍스트
}

export interface StabilityRow {
  품목코드:      string
  품목명:        string
  시험종류:      string       // 안정성 시판후/장기/가속 등
  제조번호:      string
  진행상태:      string
  시험기간시작일: string
  시험기간종료일: string
  비고:          string
}

// ─── Output Types ────────────────────────────────────────────────────────────
export interface Assignment {
  key:        string         // 고유 키 (시험자+품목+제조번호)
  date:       string         // YYYY-MM-DD
  testerName: string         // 이름
  testerId:   string         // 사번
  productCode: string
  productName: string
  batchNo:    string
  testItems:  string[]       // 시험항목 목록
  workdays:   number
  isUrgent:   boolean
  method:     '전항목' | '개별항목'
  duoPartner: string | null  // 듀오 짝 이름
  isStabilityLinked: boolean // 안정성 동시분석 가능 여부
  stabilityInfo: string | null
  specialNotes: string[]     // 주의사항 목록
}

export interface Unassigned {
  productCode: string
  productName: string
  batchNo:     string
  reason:      string
}

export interface PlanResult {
  assignments: Assignment[]
  unassigned:  Unassigned[]
  weekStart:   string
  weekEnd:     string
  stats: {
    total: number
    assigned: number
    urgent: number
    stabilityLinked: number
    testersUsed: number
  }
}

// ─── Utils ───────────────────────────────────────────────────────────────────
function parseDate(s: string, defaultYear: number): string | null {
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[\.\/](\d{1,2})$/)
  if (!m) return null
  const month = Number(m[1]), day = Number(m[2])
  return `${defaultYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ─── 시험자 → 시험항목 매칭 ────────────────────────────────────────────────────
// 시험항목명에서 필요한 장비를 추정하고, 시험자가 그 장비를 다룰 수 있는지 판단
const EQUIP_KEYWORDS: Array<[RegExp, string[]]> = [
  [/HPLC/i,           ['HPLC']],
  [/UHPLC/i,          ['UHPLC']],
  [/LCMS/i,           ['LCMS']],
  [/GCMS/i,           ['GCMS']],
  [/\bGC\b/i,         ['GC']],
  [/TLC/i,            ['TLC']],
  [/UV[- ]?Vis|UV/i,  ['UV-Vis']],
  [/FTIR/i,           ['FTIR']],
  [/용출/i,            ['용출']],
  [/pH/i,             ['pH']],
  [/이화학/i,          ['이화학']],
  [/형광/i,            ['형광분광도계']],
  [/전도도/i,          ['전도도측정기']],
  [/전위/i,            ['전위차적정기']],
  [/(수분|칼피셔|KarlFischer)/i, ['수분 측정기']],
  [/TOC/i,            ['TOC']],
]

function requiredEquipmentsFor(testItem: string): string[] {
  const equips = new Set<string>()
  for (const [pat, eqs] of EQUIP_KEYWORDS) {
    if (pat.test(testItem)) eqs.forEach(e => equips.add(e))
  }
  return [...equips]
}

function canHandle(cap: CapabilityRow, requiredEquips: string[]): boolean {
  // 필요한 장비가 없으면 모두 가능
  if (requiredEquips.length === 0) return true
  for (const eq of requiredEquips) {
    const val = (cap[eq] || '').trim().toUpperCase()
    // Y/O는 가능, N/X는 불가, 빈값은 보수적으로 불가
    if (val !== 'Y' && val !== 'O') return false
  }
  return true
}

// ─── 핵심 룰 엔진 ─────────────────────────────────────────────────────────────
export interface PlanInput {
  pctItems:      PctItem[]
  testItems:     TestItemRow[]
  capabilities:  CapabilityRow[]
  soloDuo:       SoloDuoRow[]
  specialNotes:  SpecialNoteRow[]
  stability:     StabilityRow[]
  weekStart:     string         // YYYY-MM-DD
  weekEnd:       string         // YYYY-MM-DD
  defaultWorkdays?: number      // 시험공수 미상 시 (기본 3일)
}

export function planWeekly(input: PlanInput): PlanResult {
  const {
    pctItems, testItems, capabilities, soloDuo, specialNotes, stability,
    weekStart, weekEnd, defaultWorkdays = 3,
  } = input

  const year = Number(weekStart.slice(0, 4))

  // 1. PCT 중 해당 주간(포장일) 항목만 추림 + 정규화
  const candidates = pctItems
    .map(it => ({ ...it, _date: parseDate(it.포장일, year) }))
    .filter(it => it._date && it._date >= weekStart && it._date <= weekEnd)

  // 긴급 우선, 같은 등급이면 포장일 빠른 것 우선
  candidates.sort((a, b) => {
    if (a.긴급 !== b.긴급) return a.긴급 ? -1 : 1
    return (a._date ?? '').localeCompare(b._date ?? '')
  })

  // 2. 시험자 풀 만들기 (Solo + Duo 매핑)
  const soloByName = new Map(soloDuo.map(r => [r.이름, r]))
  const soloPool = capabilities.filter(c => {
    const sd = soloByName.get(c.이름)
    return sd?.Solo === 'O'
  })
  const duoPool = capabilities.filter(c => {
    const sd = soloByName.get(c.이름)
    return sd?.Duo === 'O'
  })

  // 3. 시험자별 부하 추적: 이름 → 총 워크일
  const load = new Map<string, number>()
  capabilities.forEach(c => load.set(c.이름, 0))

  // 4. 시험항목 인덱스 (품목코드별 시험항목 리스트)
  const testItemsByCode = new Map<string, string[]>()
  for (const ti of testItems) {
    const arr = testItemsByCode.get(ti.품목코드) ?? []
    arr.push(ti['시험 항목'])
    testItemsByCode.set(ti.품목코드, arr)
  }

  // 5. 특이사항 인덱스
  const notesByCode = new Map<string, string[]>()
  for (const sn of specialNotes) {
    if (!sn['시험 항목']) continue
    const arr = notesByCode.get(sn.품목코드) ?? []
    arr.push(sn['시험 항목'])
    notesByCode.set(sn.품목코드, arr)
  }

  // 6. 안정성 인덱스
  const stabilityByCode = new Map<string, StabilityRow>()
  for (const st of stability) {
    if (st.품목코드) stabilityByCode.set(st.품목코드, st)
  }

  // 7. 배정
  const assignments: Assignment[] = []
  const unassigned:  Unassigned[]  = []

  for (const item of candidates) {
    const itemTestItems = testItemsByCode.get(item.품목코드) ?? []
    const stabilityInfo = stabilityByCode.get(item.품목코드) ?? null

    // 진행방법별 분기
    if (item.진행방법 === '개별항목' && itemTestItems.length > 1) {
      // 개별항목: 각 시험항목을 다른 시험자에게 분배 가능
      let anyAssigned = false
      for (const tItem of itemTestItems) {
        const required = requiredEquipmentsFor(tItem)
        const eligible = soloPool.filter(c => canHandle(c, required))
        if (eligible.length === 0) {
          // 자격자 없음 - 한 시험항목만 unassigned로
          continue
        }
        // 부하 최소인 사람
        eligible.sort((a, b) => (load.get(a.이름) ?? 0) - (load.get(b.이름) ?? 0))
        const chosen = eligible[0]
        const workdays = Math.max(1, Math.round(defaultWorkdays / itemTestItems.length))

        assignments.push({
          key:        `${chosen.사번}-${item.품목코드}-${item.제조번호}-${tItem}`,
          date:       item._date!,
          testerName: chosen.이름,
          testerId:   chosen.사번,
          productCode: item.품목코드,
          productName: item.품목명,
          batchNo:    item.제조번호,
          testItems:  [tItem],
          workdays,
          isUrgent:   item.긴급,
          method:     '개별항목',
          duoPartner: null,
          isStabilityLinked: stabilityInfo !== null,
          stabilityInfo: stabilityInfo ? `${stabilityInfo.시험종류} (${stabilityInfo.제조번호})` : null,
          specialNotes: notesByCode.get(item.품목코드) ?? [],
        })
        load.set(chosen.이름, (load.get(chosen.이름) ?? 0) + workdays)
        anyAssigned = true
      }
      if (!anyAssigned) {
        unassigned.push({
          productCode: item.품목코드, productName: item.품목명, batchNo: item.제조번호,
          reason: '필요 장비 자격자 없음',
        })
      }
    } else {
      // 전항목: 한 시험자(또는 듀오 조)에게 전부 배정
      // 사전 지정된 담당자가 있으면 우선
      let chosen: CapabilityRow | null = null
      if (item.담당자) {
        chosen = capabilities.find(c => c.이름 === item.담당자) ?? null
      }
      if (!chosen) {
        // 모든 시험항목의 장비를 모두 다룰 수 있는 사람 중 부하 최소
        const allRequired = new Set<string>()
        for (const ti of itemTestItems) requiredEquipmentsFor(ti).forEach(e => allRequired.add(e))
        const eligible = soloPool.filter(c => canHandle(c, [...allRequired]))
        if (eligible.length === 0) {
          unassigned.push({
            productCode: item.품목코드, productName: item.품목명, batchNo: item.제조번호,
            reason: '필요 장비 자격자 없음 (전항목)',
          })
          continue
        }
        eligible.sort((a, b) => (load.get(a.이름) ?? 0) - (load.get(b.이름) ?? 0))
        chosen = eligible[0]
      }

      // 듀오 짝 결정 (Solo 시험자가 Duo 가능자랑 페어링되는 경우는 옵션. 일단 null)
      const partner: string | null = null

      const workdays = defaultWorkdays
      assignments.push({
        key:        `${chosen.사번}-${item.품목코드}-${item.제조번호}`,
        date:       item._date!,
        testerName: chosen.이름,
        testerId:   chosen.사번,
        productCode: item.품목코드,
        productName: item.품목명,
        batchNo:    item.제조번호,
        testItems:  itemTestItems.length ? itemTestItems : ['전항목'],
        workdays,
        isUrgent:   item.긴급,
        method:     '전항목',
        duoPartner: partner,
        isStabilityLinked: stabilityInfo !== null,
        stabilityInfo: stabilityInfo ? `${stabilityInfo.시험종류} (${stabilityInfo.제조번호})` : null,
        specialNotes: notesByCode.get(item.품목코드) ?? [],
      })
      load.set(chosen.이름, (load.get(chosen.이름) ?? 0) + workdays)
    }
  }

  return {
    assignments,
    unassigned,
    weekStart,
    weekEnd,
    stats: {
      total:            candidates.length,
      assigned:         assignments.length,
      urgent:           assignments.filter(a => a.isUrgent).length,
      stabilityLinked:  assignments.filter(a => a.isStabilityLinked).length,
      testersUsed:      new Set(assignments.map(a => a.testerName)).size,
    },
  }
}
