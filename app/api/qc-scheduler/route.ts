// app/api/qc-scheduler/route.ts
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(req: NextRequest) {
  try {
    const { week_start, week_end } = await req.json()

    if (!week_start || !week_end) {
      return NextResponse.json(
        { error: '주간 시작일과 종료일을 입력해주세요.' },
        { status: 400 }
      )
    }

    // ============================================================
    // 1. Supabase에서 데이터 조회
    // ============================================================

    // 처리 대상 배치 (QC마감일 기준)
    const { data: batches, error: batchError } = await supabase
      .from('production_batches')
      .select('id, product_name, batch_no, qc_completion_deadline, is_urgent, status, spec, dosage_form')
      .eq('status', 'pending')
      .lte('qc_completion_deadline', week_end)
      .order('is_urgent', { ascending: false })
      .order('qc_completion_deadline', { ascending: true })

    if (batchError) throw new Error(`배치 조회 실패: ${batchError.message}`)

    // 시험자 역량
    const { data: testers, error: testerError } = await supabase
      .from('testers')
      .select('id, name, employee_no, solo, duo, hplc, gc, gcms, lcms_tq, uhplc, shimadzu_hplc, gcms_tq, ftir, uv_vis, toc, dissolution_34, dissolution_5, potentiometric, karl_fischer, conductivity, hptlc, rdp, fluorescence, icp_ms, gc_hss')

    if (testerError) throw new Error(`시험자 조회 실패: ${testerError.message}`)

    // 시험항목-장비 매핑
    const { data: equipmentMap, error: equipError } = await supabase
      .from('test_item_equipment')
      .select('test_item, required_equipment, is_universal')

    if (equipError) throw new Error(`장비매핑 조회 실패: ${equipError.message}`)

    // 품목별 시험항목
    const { data: testItems, error: itemError } = await supabase
      .from('product_test_items')
      .select('product_name, test_item')

    if (itemError) throw new Error(`시험항목 조회 실패: ${itemError.message}`)

    // 평균 공수
    const { data: workload, error: workloadError } = await supabase
      .from('product_workload')
      .select('product_name, avg_workdays')

    if (workloadError) throw new Error(`공수 조회 실패: ${workloadError.message}`)

    // 이번 주 휴가/휴일
    const { data: holidays, error: holidayError } = await supabase
      .from('holidays')
      .select('date, type, tester_id, note')
      .gte('date', week_start)
      .lte('date', week_end)

    if (holidayError) throw new Error(`휴일 조회 실패: ${holidayError.message}`)

    // ============================================================
    // 2. 데이터 없으면 early return
    // ============================================================
    if (!batches || batches.length === 0) {
      return NextResponse.json({
        success: true,
        result: `## 📋 주간 QC 시험 배정표\n**대상 기간:** ${week_start} ~ ${week_end}\n\n이번 주 처리 대상 배치가 없습니다.`,
        data: { batches: [], schedule: [] }
      })
    }

    // ============================================================
    // 3. Claude API 호출 - 스케줄링 판단
    // ============================================================
    const prompt = `
## QC 시험 주간 스케줄 배정 요청

**대상 기간:** ${week_start} ~ ${week_end}

---

### 처리 대상 배치 (${batches.length}건)
${JSON.stringify(batches, null, 2)}

---

### 시험자 역량 (${testers?.length}명)
${JSON.stringify(testers, null, 2)}

---

### 시험항목-장비 매핑
${JSON.stringify(equipmentMap, null, 2)}

---

### 품목별 시험항목
${JSON.stringify(testItems, null, 2)}

---

### 평균 공수
${JSON.stringify(workload, null, 2)}

---

### 이번 주 휴가/휴일
${JSON.stringify(holidays, null, 2)}

---

## 배정 규칙 (반드시 준수)
1. 시험항목에 필요한 장비를 사용할 수 있는 시험자만 배정
2. is_universal=true 항목은 모든 시험자 배정 가능
3. duo=true 시험자는 반드시 solo=true 시험자와 2인 1조로 배정
4. 동일 품목명(product_name)인 배치들은 시험항목이 동일하므로 동시분석 대상.
   반드시 같은 시험자(또는 같은 듀오 조)에게 통째로 배정한다.
   동시분석 공수 = 단일 배치 공수 (배치 수가 늘어도 공수는 그대로).
5. 진행방법(method)에 따른 시험항목 분배:
   - method='전항목' (또는 미지정): 해당 품목의 모든 시험항목을 한 시험자(또는 듀오 조)에게 일괄 배정.
   - method='개별항목': 동일 품목의 시험항목을 여러 시험자에게 나눠 동시 진행 (각 시험항목 단위로 별도 배정 가능).
6. 서로 다른 품목명을 한 시험자에게 같은 날 배정 금지 (직렬 처리만 허용).
7. 긴급(is_urgent=true) 품목 우선 배정. 시험완료요청일(qc_completion_deadline)이 빠른 것 우선.
8. 휴가/휴일인 시험자는 해당 날짜 배정 금지
9. 동일 시험자 중복 배정 금지 (단, 진행방법='개별항목'에서 시험항목이 다르면 가능)

## 장비-컬럼 매핑
HPLC→hplc, GC→gc, GCMS→gcms, LCMS_TQ→lcms_tq,
UHPLC→uhplc, Shimadzu HPLC→shimadzu_hplc, GCMS_TQ→gcms_tq,
FTIR→ftir, UV-Vis→uv_vis, TOC→toc,
용출기3,4→dissolution_34, 용출기5→dissolution_5,
전위차적정기→potentiometric, 칼피셔→karl_fischer,
전도도측정기→conductivity, HPTLC→hptlc, RDP→rdp,
형광분광도계→fluorescence, ICP_MS→icp_ms, GC_HSS→gc_hss,
없음(육안/기본)/이화학/붕해기/점도계 → 전원 가능

## 출력 형식 (반드시 아래 JSON 형식으로만 출력)
{
  "schedule": [
    {
      "tester_id": 1,
      "tester_name": "홍길동",
      "batch_id": 1,
      "product_name": "품목명",
      "batch_no": "26001",
      "test_items": ["HPLC함량", "용출"],
      "scheduled_date": "${week_start}",
      "workdays": 3,
      "is_urgent": false,
      "is_duo": false,
      "duo_partner_id": null,
      "note": "특이사항"
    }
  ],
  "unassigned": [
    {
      "product_name": "품목명",
      "batch_no": "26001",
      "reason": "배정 불가 사유"
    }
  ],
  "summary": "전체 배정 요약"
}
`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      system: `당신은 의약품 QC 시험 스케줄링 전문가입니다.
주어진 데이터를 분석하여 최적의 주간 시험 배정표를 생성합니다.
반드시 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.`,
    })

    const rawResult = message.content[0].type === 'text' ? message.content[0].text : ''

    // JSON 파싱
    let scheduleData
    try {
      const cleaned = rawResult.replace(/```json|```/g, '').trim()
      scheduleData = JSON.parse(cleaned)
    } catch {
      scheduleData = { raw: rawResult }
    }

    // ============================================================
    // 4. 결과를 Supabase schedules 테이블에 저장
    // ============================================================
    if (scheduleData.schedule && scheduleData.schedule.length > 0) {
      type AiScheduleItem = {
        tester_id?: string
        batch_id?: string
        product_name?: string
        test_items?: unknown
        scheduled_date?: string
        workdays?: number
        is_urgent?: boolean
        is_duo?: boolean
        duo_partner_id?: string
        note?: string
      }
      const scheduleRows = (scheduleData.schedule as AiScheduleItem[]).map((item) => ({
        week_start,
        week_end,
        tester_id: item.tester_id,
        batch_id: item.batch_id,
        product_name: item.product_name,
        test_items: item.test_items,
        scheduled_date: item.scheduled_date,
        workdays: item.workdays,
        is_urgent: item.is_urgent,
        is_duo: item.is_duo,
        duo_partner_id: item.duo_partner_id,
        note: item.note,
        status: 'scheduled',
        created_by: 'ai_scheduler',
      }))

      const { error: insertError } = await supabase
        .from('schedules')
        .upsert(scheduleRows)

      if (insertError) {
        console.error('스케줄 저장 실패:', insertError)
      }
    }

    return NextResponse.json({
      success: true,
      data: scheduleData,
      meta: {
        week_start,
        week_end,
        total_batches: batches.length,
        assigned: scheduleData.schedule?.length ?? 0,
        unassigned: scheduleData.unassigned?.length ?? 0,
      },
    })
  } catch (error) {
    console.error('QC 스케줄러 오류:', error)
    const msg = error instanceof Error ? error.message : '스케줄 생성 중 오류가 발생했습니다.'
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    )
  }
}
