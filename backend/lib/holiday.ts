/**
 * [BACKEND] 공휴일 API (data.go.kr 특일정보 SpcdeInfoService) — 단독 검증용 헬퍼
 *
 * 한국천문연구원 특일정보 getRestDeInfo(국경일·공휴일) 호출.
 *   - serviceKey 는 .env.local 의 HOLIDAY_API_KEY (Decoding 키) 사용.
 *   - URLSearchParams 로 "딱 한 번만" 인코딩한다(이중 인코딩 금지).
 *   - 인증 실패 시 data.go.kr 은 _type=json 이어도 XML 에러를 반환하므로,
 *     JSON 파싱 실패를 인증/응답 오류로 보고 상태코드+본문 일부로 throw 한다.
 *
 * ⚠️ 이 단계는 호출 검증 전용. DB·휴가/공휴일 캘린더 UI 와 무관하다.
 */

const DEFAULT_BASE_URL = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService'

/** 특일정보 item (응답 1건이면 객체, 다건이면 배열 → 항상 배열로 정규화) */
export interface RestHolidayItem {
  /** 종류(예: 국경일/공휴일) */
  dateKind?: string
  /** 명칭(예: 신정, 설날) */
  dateName: string
  /** 공휴일 여부 'Y' | 'N' */
  isHoliday: string
  /** 해당일 YYYYMMDD (숫자) */
  locdate: number
  /** 순번 */
  seq?: number
}

/**
 * 지정 연/월의 공휴일 목록을 조회한다.
 * @param year  연도 (예: 2026)
 * @param month 월 (1~12) — 내부에서 2자리("01")로 변환
 * @returns 정규화된 공휴일 item 배열
 * @throws 인증 실패(XML)·JSON 파싱 실패·resultCode 비정상 시
 */
export async function getRestHolidays(year: number, month: number): Promise<RestHolidayItem[]> {
  const serviceKey = process.env.HOLIDAY_API_KEY
  if (!serviceKey) {
    throw new Error('HOLIDAY_API_KEY 가 설정되지 않았습니다. (.env.local 확인)')
  }
  const baseUrl = process.env.HOLIDAY_API_BASE_URL || DEFAULT_BASE_URL

  // URLSearchParams 로 단 한 번만 인코딩한다(이중 인코딩 금지).
  const params = new URLSearchParams({
    serviceKey,                                  // Decoding 키 → 여기서 1회 인코딩
    solYear: String(year),
    solMonth: String(month).padStart(2, '0'),    // 2자리 ("01")
    _type: 'json',
    numOfRows: '50',
  })

  const url = `${baseUrl}/getRestDeInfo?${params.toString()}`

  const res = await fetch(url, { cache: 'no-store' })

  // 인증 실패 시 _type=json 이어도 XML 에러가 오므로, 본문을 먼저 텍스트로 받고 파싱한다.
  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    // 키 값은 노출하지 않고, 상태코드와 본문 일부만 담아 throw
    throw new Error(
      `공휴일 API 응답 파싱 실패(인증 실패로 추정). status=${res.status}, body=${text.slice(0, 300)}`,
    )
  }

  // resultCode 비정상(등록키 오류 등)도 검증 단계에서 드러나도록 확인
  const root = json as {
    response?: {
      header?: { resultCode?: string; resultMsg?: string }
      body?: { items?: { item?: RestHolidayItem | RestHolidayItem[] } }
    }
  }
  const header = root.response?.header
  if (header && header.resultCode && header.resultCode !== '00') {
    throw new Error(`공휴일 API 오류: resultCode=${header.resultCode}, resultMsg=${header.resultMsg ?? ''}`)
  }

  // items.item 이 1건이면 객체, 다건이면 배열, 없으면 빈 문자열/undefined → 항상 배열로 정규화
  const rawItem = root.response?.body?.items?.item
  const items: RestHolidayItem[] = Array.isArray(rawItem) ? rawItem : rawItem ? [rawItem] : []
  return items
}

/**
 * 지정 연도의 공휴일을 1~12월 순회 조회해 합친다(연 단위 완전 수집 보장).
 * @param year 연도 (예: 2026)
 * @returns 정규화된 공휴일 item 배열(12개월 합산)
 */
export async function getRestHolidaysForYear(year: number): Promise<RestHolidayItem[]> {
  const all: RestHolidayItem[] = []
  for (let month = 1; month <= 12; month++) {
    const items = await getRestHolidays(year, month)
    all.push(...items)
  }
  return all
}
