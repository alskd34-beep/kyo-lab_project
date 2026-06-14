/**
 * [BACKEND] PCT → 시험 스케줄 규칙 기반 배정 엔진 (순수 함수, DB 접근 없음)
 *
 * 규칙:
 *  1. 시작일 = 포장일 + 1 근무일 (주말 제외)
 *  2. 기간   = product_workload.avg_workdays(품목코드 매칭)만큼 연속 근무일 배치
 *  3. 배정   = 품목별 시험항목(product_test_items) → 필요장비(test_item_equipment)
 *             → 시험자 역량(tester_capability_matrix, Y/O 가능) 매칭 + solo/duo
 *     - 전항목: 모든 시험항목 장비를 다룰 수 있는 1인(또는 듀오 조)에게 일괄
 *     - 개별항목: 시험항목별로 가능 시험자에게 분배(동시 진행, 같은 기간)
 *
 * LLM 전환 대비: 입력/출력 타입을 명확히 분리해 두어, 추후 동일 입출력으로
 * LLM 구현으로 교체 가능.
 */

// ─── 입력 타입 ─────────────────────────────────────────────────────────────────
export interface EnginePctRow {
  품목코드: string
  품목명:   string
  제조번호: string
  포장일:   string   // ISO 'YYYY-MM-DD' 또는 'M/D'
  긴급:     boolean
  진행방법: '전항목' | '개별항목'
  담당자?:  string    // 사전 지정(있으면 전항목에서 우선)
}

export interface EngineTester {
  id: string
  name: string
  canSolo: boolean
  canDuo: boolean
  isActive: boolean
}

export interface EngineCapability { id: string; code: string; name: string }
export interface EngineMatrixCell { testerId: string; capabilityId: string; level: 'Y' | 'N' | 'X' | 'O' }

/** product_test_items + test_items.name (품목코드별) */
export interface EngineProductItems { productCode: string; testItems: string[] }
/** test_item_equipment: 시험항목명 → 필요장비 */
export interface EngineEquip { testItem: string; requiredEquipment: string; isUniversal: boolean; requiresDuo?: boolean }
/** product_workload: 품목코드 → 공수(일) */
export interface EngineWorkload { productCode: string; avgWorkdays: number }

export interface EngineInput {
  rows: EnginePctRow[]
  testers: EngineTester[]
  capabilities: EngineCapability[]
  matrix: EngineMatrixCell[]
  productItems: EngineProductItems[]
  equipment: EngineEquip[]
  workload: EngineWorkload[]
  year: number
  defaultWorkdays?: number  // 공수 미상 시 (기본 3)
  /**
   * 시험자별 초기 부하 가산치 (testerId → 점수).
   * 난이도 기반 배정에 사용: 최근 2주 HIGH 난이도 업무가 많은 시험자에게 penalty 를 미리 실어
   * 차주 MEDIUM/LOW 배정에서 후순위로 밀어낸다. (assignRules.difficultyPenalty 산출값)
   */
  initialLoad?: Record<string, number>
}

// ─── 출력 타입 ─────────────────────────────────────────────────────────────────
export interface EngineAssignment {
  key: string
  productCode: string
  productName: string
  batchNo: string
  testerName: string
  testerId: string
  testItems: string[]
  method: '전항목' | '개별항목'
  isDuo: boolean
  duoPartner: string | null
  isUrgent: boolean
  startDate: string      // 첫 근무일 (포장일+1 근무일)
  dates: string[]        // 배정된 근무일 목록(주말 제외)
  workdays: number
  note: string
}

export interface EngineUnassigned {
  productCode: string
  productName: string
  batchNo: string
  testItems: string[]
  reason: string
}

export interface EngineResult {
  assignments: EngineAssignment[]
  unassigned: EngineUnassigned[]
  stats: {
    total: number
    assigned: number
    unassigned: number
    urgent: number
    duo: number
    testersUsed: number
    workloadMatched: number
    workloadMissing: number
  }
}

// ─── 날짜 유틸 ─────────────────────────────────────────────────────────────────
function normalizeDate(s: string, year: number): string | null {
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[./](\d{1,2})$/)
  if (!m) return null
  return `${year}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`
}

function isWeekend(iso: string): boolean {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay()
  return dow === 0 || dow === 6
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 포장일 다음 근무일부터 count개의 연속 근무일(주말 제외) 반환 */
function workingDaysAfter(packISO: string, count: number): string[] {
  const out: string[] = []
  let cur = addDays(packISO, 1)
  let guard = 0
  while (out.length < count && guard < 400) {
    if (!isWeekend(cur)) out.push(cur)
    cur = addDays(cur, 1)
    guard++
  }
  return out
}

// ─── 역량 매칭 ─────────────────────────────────────────────────────────────────
function normToken(s: string): string {
  return s.toLowerCase().replace(/[\s\-_/().]/g, '')
}

/**
 * required_equipment 문자열을 capability id 집합으로 변환.
 * 복합값(예: 'HPTLC_이화학_중금속')은 구분자로 분해 후 각 토큰을 capability code/name과 매칭.
 * 매칭되지 않는 토큰은 무시(차단하지 않음).
 */
function buildCapResolver(capabilities: EngineCapability[]) {
  const byNorm = new Map<string, string>() // normalized code/name → capabilityId
  for (const c of capabilities) {
    byNorm.set(normToken(c.code), c.id)
    byNorm.set(normToken(c.name), c.id)
  }
  // 흔한 별칭 보정
  const ALIAS: Record<string, string> = {
    ftir: 'FTIR', uvvis: 'UV_VIS', lcms: 'LCMS_TQ', lcmstq: 'LCMS_TQ',
    gcmstq: 'GCMS_TQ', shimadzuhplc: 'SHIMADZU_HPLC',
  }
  return (requiredEquipment: string): string[] => {
    const ids = new Set<string>()
    for (const part of requiredEquipment.split(/[_,/+]/)) {
      const n = normToken(part)
      if (!n) continue
      let id = byNorm.get(n)
      if (!id && ALIAS[n]) id = byNorm.get(normToken(ALIAS[n]))
      if (id) ids.add(id)
    }
    return [...ids]
  }
}

// ─── 엔진 ──────────────────────────────────────────────────────────────────────
export function generatePctSchedule(input: EngineInput): EngineResult {
  const { rows, testers, capabilities, matrix, productItems, equipment, workload, year } = input
  const defaultWorkdays = input.defaultWorkdays ?? 3

  const resolveCaps = buildCapResolver(capabilities)

  // 인덱스 구성
  const itemsByCode = new Map<string, string[]>()
  for (const p of productItems) itemsByCode.set(p.productCode.trim(), p.testItems)

  const equipByItem = new Map<string, EngineEquip>()
  for (const e of equipment) equipByItem.set(e.testItem, e)

  const workloadByCode = new Map<string, number>()
  for (const w of workload) workloadByCode.set(String(w.productCode).trim(), w.avgWorkdays)

  // 시험자별 보유 역량(Y/O) 집합
  const yesByTester = new Map<string, Set<string>>()
  for (const t of testers) yesByTester.set(t.id, new Set())
  for (const m of matrix) {
    if (m.level === 'Y' || m.level === 'O') yesByTester.get(m.testerId)?.add(m.capabilityId)
  }

  const activeTesters = testers.filter(t => t.isActive)
  const soloPool = activeTesters.filter(t => t.canSolo)
  const duoPool  = activeTesters.filter(t => t.canDuo)
  const testerByName = new Map(activeTesters.map(t => [t.name, t]))

  // 부하(누적 근무일) 추적 — 난이도 penalty(initialLoad)를 초기값으로 실어
  // "최근 HIGH 부담이 큰 시험자"를 MEDIUM/LOW 배정에서 후순위로 밀어낸다.
  const load = new Map<string, number>()
  for (const t of activeTesters) load.set(t.id, input.initialLoad?.[t.id] ?? 0)
  const addLoad = (id: string, d: number) => load.set(id, (load.get(id) ?? 0) + d)
  const getLoad = (id: string) => load.get(id) ?? 0

  /** 시험항목 1건의 필요 capability id 집합 + 듀오 필요 여부 */
  const reqOf = (testItem: string): { caps: string[]; universal: boolean; duo: boolean } => {
    const e = equipByItem.get(testItem)
    if (!e) return { caps: [], universal: false, duo: false }   // 매핑 없음 → 역량 제약 없음(보수적 통과)
    if (e.isUniversal) return { caps: [], universal: true, duo: !!e.requiresDuo }
    return { caps: resolveCaps(e.requiredEquipment), universal: false, duo: !!e.requiresDuo }
  }

  /** 시험자가 주어진 capability 집합을 모두 보유(Y/O)하는가 */
  const can = (testerId: string, caps: string[]): boolean => {
    if (caps.length === 0) return true
    const have = yesByTester.get(testerId)
    if (!have) return false
    return caps.every(c => have.has(c))
  }

  /** 부하 최소 자격 시험자 1인 (solo) */
  const pickSolo = (caps: string[]): EngineTester | null => {
    const elig = soloPool.filter(t => can(t.id, caps))
    if (elig.length === 0) return null
    elig.sort((a, b) => getLoad(a.id) - getLoad(b.id))
    return elig[0]
  }

  /** 듀오 조 구성: (solo 가능 리드) + (duo 가능 보조). 두 사람의 역량 합집합이 caps를 커버 */
  const pickDuo = (caps: string[]): { lead: EngineTester; partner: EngineTester } | null => {
    const leads = soloPool.slice().sort((a, b) => getLoad(a.id) - getLoad(b.id))
    for (const lead of leads) {
      const partners = duoPool
        .filter(p => p.id !== lead.id)
        .sort((a, b) => getLoad(a.id) - getLoad(b.id))
      for (const partner of partners) {
        const have = new Set<string>([...(yesByTester.get(lead.id) ?? []), ...(yesByTester.get(partner.id) ?? [])])
        if (caps.length === 0 || caps.every(c => have.has(c))) return { lead, partner }
      }
    }
    return null
  }

  // 우선순위 정렬: 긴급 → 포장일 빠른 순
  const indexed = rows.map((r, i) => ({ r, i, date: normalizeDate(r.포장일, year) }))
  indexed.sort((a, b) => {
    if (a.r.긴급 !== b.r.긴급) return a.r.긴급 ? -1 : 1
    const da = a.date ?? '9999', db = b.date ?? '9999'
    if (da !== db) return da.localeCompare(db)
    return a.i - b.i
  })

  const assignments: EngineAssignment[] = []
  const unassigned: EngineUnassigned[] = []
  let workloadMatched = 0, workloadMissing = 0

  for (const { r, date } of indexed) {
    const code = (r.품목코드 ?? '').trim()
    const items = itemsByCode.get(code) ?? []
    const effectiveItems = items.length > 0 ? items : ['전항목']

    // 공수(일) — 품목코드 매칭
    const wlRaw = workloadByCode.get(code)
    const workdays = wlRaw != null && wlRaw > 0 ? wlRaw : defaultWorkdays
    if (wlRaw != null && wlRaw > 0) workloadMatched++; else workloadMissing++

    // 날짜: 포장일+1 근무일부터 workdays개 근무일
    if (!date) {
      unassigned.push({ productCode: code, productName: r.품목명, batchNo: r.제조번호, testItems: effectiveItems, reason: '포장일 형식 오류/누락' })
      continue
    }
    const dates = workingDaysAfter(date, workdays)
    const startDate = dates[0] ?? date

    if (r.진행방법 === '개별항목' && effectiveItems.length > 1) {
      // 개별항목: 시험항목별 분배 (동시 진행 → 동일 기간)
      let any = false
      for (const ti of effectiveItems) {
        const { caps, duo } = reqOf(ti)
        let testerName = '', testerId = '', isDuo = false, partner: string | null = null
        if (duo) {
          const d = pickDuo(caps)
          if (!d) continue
          testerName = d.lead.name; testerId = d.lead.id; isDuo = true; partner = d.partner.name
          addLoad(d.lead.id, workdays); addLoad(d.partner.id, workdays)
        } else {
          const t = pickSolo(caps)
          if (!t) continue
          testerName = t.name; testerId = t.id
          addLoad(t.id, workdays)
        }
        assignments.push({
          key: `${code}-${r.제조번호}-${ti}-${testerId}`,
          productCode: code, productName: r.품목명, batchNo: r.제조번호,
          testerName, testerId, testItems: [ti], method: '개별항목',
          isDuo, duoPartner: partner, isUrgent: r.긴급, startDate, dates, workdays,
          note: r.긴급 ? '긴급' : '',
        })
        any = true
      }
      if (!any) unassigned.push({ productCode: code, productName: r.품목명, batchNo: r.제조번호, testItems: effectiveItems, reason: '개별항목 자격 시험자 없음' })
    } else {
      // 전항목: 전체 시험항목 장비 합집합을 다룰 수 있는 1인(또는 듀오)
      const allCaps = new Set<string>()
      let needsDuo = false
      for (const ti of effectiveItems) {
        const { caps, duo } = reqOf(ti)
        caps.forEach(c => allCaps.add(c))
        if (duo) needsDuo = true
      }
      const capsArr = [...allCaps]

      // 사전 지정 담당자 우선 (자격 보유 시)
      let chosen: EngineTester | null = null
      if (r.담당자) {
        const pre = testerByName.get(r.담당자.trim())
        if (pre && can(pre.id, capsArr)) chosen = pre
      }
      let isDuo = false, partner: string | null = null
      if (!needsDuo && (chosen || (chosen = pickSolo(capsArr)))) {
        addLoad(chosen.id, workdays)
      } else {
        const d = pickDuo(capsArr)
        if (!d) {
          unassigned.push({ productCode: code, productName: r.품목명, batchNo: r.제조번호, testItems: effectiveItems, reason: needsDuo ? '듀오 조 구성 불가' : '전항목 자격 시험자 없음' })
          continue
        }
        chosen = d.lead; isDuo = true; partner = d.partner.name
        addLoad(d.lead.id, workdays); addLoad(d.partner.id, workdays)
      }

      assignments.push({
        key: `${code}-${r.제조번호}-${chosen.id}`,
        productCode: code, productName: r.품목명, batchNo: r.제조번호,
        testerName: chosen.name, testerId: chosen.id, testItems: effectiveItems,
        method: '전항목', isDuo, duoPartner: partner, isUrgent: r.긴급,
        startDate, dates, workdays, note: r.긴급 ? '긴급' : '',
      })
    }
  }

  const usedNames = new Set<string>()
  for (const a of assignments) { usedNames.add(a.testerName); if (a.duoPartner) usedNames.add(a.duoPartner) }

  return {
    assignments,
    unassigned,
    stats: {
      total: rows.length,
      assigned: assignments.length,
      unassigned: unassigned.length,
      urgent: assignments.filter(a => a.isUrgent).length,
      duo: assignments.filter(a => a.isDuo).length,
      testersUsed: usedNames.size,
      workloadMatched,
      workloadMissing,
    },
  }
}
