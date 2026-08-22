/**
 * [BACKEND] 공수 표준 예제 데이터 (마이그레이션 적용 전 미리보기용)
 *
 * supabase/migrations/0026_workload_standard.sql 이 아직 적용되지 않은 환경에서
 * 화면 구성을 확인할 수 있도록 쓰는 읽기 전용 샘플이다.
 * 마이그레이션의 seed 블록과 동일한 쌍화탕(P001) 데이터를 담는다.
 *
 * 합계 검증
 *   인적 5 + 10 + 30 + 15 + 30 = 90분(1시간 30분)
 *   기기 30 + 1800            = 1830분(30시간 30분)
 *   대기 120분(2시간) · 검토 480분(8시간) · 표준소요일 3일
 */

import type { ProductTestItem, ProductWorkload, TestWorkStep, WorkloadType } from '@shared/workload'

const NOW = '2026-01-01T00:00:00.000Z'

interface SeedStep {
  name: string
  type: WorkloadType
  minutes: number
  equipment?: string
  skill?: string
}

function buildSteps(itemId: string, defs: SeedStep[]): TestWorkStep[] {
  let previousId: string | null = null
  return defs.map((d, idx) => {
    const id = `${itemId}-s${idx + 1}`
    const step: TestWorkStep = {
      id,
      testItemId: itemId,
      stepCode: null,
      stepName: d.name,
      sequence: idx + 1,
      workloadType: d.type,
      durationMinutes: d.minutes,
      equipmentTypeId: null,
      equipmentTypeName: d.type === 'EQUIPMENT' ? (d.equipment ?? null) : null,
      requiredSkill: d.skill ?? null,
      parallelAllowed: false,
      predecessorStepId: previousId,
      memo: null,
      createdAt: NOW,
      updatedAt: NOW,
    }
    previousId = id
    return step
  })
}

function buildItem(
  productId: string,
  index: number,
  base: Pick<ProductTestItem, 'testCode' | 'testName' | 'difficulty' | 'parallelAllowed'> &
    Partial<Pick<ProductTestItem,
      | 'requiredSkill'
      | 'simultaneousAnalysisAllowed'
      | 'simultaneousMaxCount'
      | 'simultaneousAdditionalEquipmentMinutes'
    >>,
  stepDefs: SeedStep[],
): ProductTestItem {
  const id = `${productId}-t${index}`
  const steps = buildSteps(id, stepDefs)
  const sumBy = (type: WorkloadType) =>
    steps.filter(s => s.workloadType === type).reduce((acc, s) => acc + s.durationMinutes, 0)

  return {
    id,
    productWorkloadId: productId,
    testCode: base.testCode,
    testName: base.testName,
    sequence: index,
    humanMinutes: sumBy('HUMAN'),
    equipmentMinutes: sumBy('EQUIPMENT'),
    waitingMinutes: sumBy('WAITING'),
    reviewMinutes: sumBy('REVIEW'),
    parallelAllowed: base.parallelAllowed,
    simultaneousAnalysisAllowed: base.simultaneousAnalysisAllowed ?? false,
    simultaneousMaxCount: base.simultaneousMaxCount ?? null,
    simultaneousAdditionalHumanMinutes: null,
    simultaneousAdditionalEquipmentMinutes: base.simultaneousAdditionalEquipmentMinutes ?? null,
    requiredSkill: base.requiredSkill ?? null,
    difficulty: base.difficulty,
    memo: null,
    steps,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

const PRODUCT_ID = 'seed-p001'

const SSANGHWA_ITEMS: ProductTestItem[] = [
  buildItem(PRODUCT_ID, 1,
    { testCode: 'T-APPR', testName: '성상', difficulty: 'LOW', parallelAllowed: true },
    [{ name: '시험수행', type: 'HUMAN', minutes: 5 }],
  ),
  buildItem(PRODUCT_ID, 2,
    { testCode: 'T-ID', testName: '확인시험', difficulty: 'NORMAL', parallelAllowed: true, requiredSkill: 'HPLC' },
    [
      { name: '검체 준비', type: 'HUMAN', minutes: 10 },
      { name: '반응대기', type: 'WAITING', minutes: 120 },
      { name: '확인 분석', type: 'EQUIPMENT', minutes: 30, equipment: 'HPLC', skill: 'HPLC' },
    ],
  ),
  buildItem(PRODUCT_ID, 3,
    {
      testCode: 'T-ASSAY', testName: '함량시험', difficulty: 'HIGH', parallelAllowed: true, requiredSkill: 'HPLC',
      simultaneousAnalysisAllowed: true, simultaneousMaxCount: 4, simultaneousAdditionalEquipmentMinutes: 120,
    },
    [
      { name: '검체 전처리', type: 'HUMAN', minutes: 30 },
      { name: 'HPLC 세팅', type: 'HUMAN', minutes: 15 },
      { name: 'HPLC 분석', type: 'EQUIPMENT', minutes: 1800, equipment: 'HPLC', skill: 'HPLC' },
      { name: '결과처리', type: 'HUMAN', minutes: 30 },
    ],
  ),
  buildItem(PRODUCT_ID, 4,
    { testCode: 'T-REVIEW', testName: '시험검토', difficulty: 'NORMAL', parallelAllowed: false },
    [{ name: '시험검토', type: 'REVIEW', minutes: 480 }],
  ),
]

const sumItems = (key: 'humanMinutes' | 'equipmentMinutes' | 'waitingMinutes' | 'reviewMinutes') =>
  SSANGHWA_ITEMS.reduce((acc, i) => acc + i[key], 0)

/** 읽기 전용 미리보기 데이터 — 마이그레이션 적용 후에는 사용되지 않는다. */
export const WORKLOAD_PREVIEW_SEED: ProductWorkload[] = [
  {
    id: PRODUCT_ID,
    productCode: 'P001',
    productName: '쌍화탕',
    dosageForm: '액제',
    standardLeadTimeDays: 3,
    totalHumanMinutes: sumItems('humanMinutes'),
    totalEquipmentMinutes: sumItems('equipmentMinutes'),
    totalWaitingMinutes: sumItems('waitingMinutes'),
    totalReviewMinutes: sumItems('reviewMinutes'),
    testItemCount: SSANGHWA_ITEMS.length,
    stepCount: SSANGHWA_ITEMS.reduce((acc, i) => acc + i.steps.length, 0),
    version: 1,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    testItems: SSANGHWA_ITEMS,
    createdAt: NOW,
    createdBy: 'system',
    updatedAt: NOW,
    updatedBy: 'system',
  },
]
