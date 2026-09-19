import { supabaseAdmin } from '@backend/lib/supabase'
import { describeSchemaError } from '@backend/lib/schemaError'
import {
  DELAY_REASON_CATEGORIES, getDelayReasonCategory,
  type DelayReasonCategory, type DelayReasonKind,
} from '@shared/delay-reason'

export const DELAY_REASON_FEATURE = '지연·복귀 사유 기록'
export const DELAY_REASON_MIGRATION = '0058_delay_reason.sql'

export function listDelayReasonCategories(kind?: DelayReasonKind): DelayReasonCategory[] {
  return DELAY_REASON_CATEGORIES.filter(c => !kind || c.kind === kind)
}

export function assertDelayReasonCategory(id: string, kind: DelayReasonKind): DelayReasonCategory {
  const category = getDelayReasonCategory(id, kind)
  if (!category) throw new Error('지연·복귀 사유 분류를 선택해 주세요.')
  return category
}

/** 0058의 컬럼 존재를 전이 전에 확인해 사유 없는 상태 변경을 만들지 않는다. */
export async function assertDelayReasonSchema(): Promise<void> {
  const { error } = await supabaseAdmin
    .from('qc_job_status_history').select('reason_category_id, attribution').limit(1)
  if (error) throw describeSchemaError(error, DELAY_REASON_FEATURE, DELAY_REASON_MIGRATION)
}

