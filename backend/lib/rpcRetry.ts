/**
 * [BACKEND] 쓰기 DB 함수(RPC) 호출 — 교착(40P01)이면 한 번만 재시도한다.
 *
 * 왜: 트랜잭션 함수들은 전역 잠금 순서(qc_jobs → pct_orders → pct_order_assignees → pct_order_test_items
 * → qc_job_items)를 지키지만, 트랜잭션 밖의 **단일 INSERT 도 FK 검사로 부모 행 여러 개에 공유 잠금**을 건다.
 * 예: notifications insert 는 pct_orders → qc_jobs 순서로 key share 를 잡아, qc_jobs → pct_orders 로 잠그는
 * reassign_job_item·cancel_job_start 와 순환할 수 있다(리뷰 F2 M1). Postgres 가 한쪽을 40P01 로 중단시키며,
 * 함수 본문 전체가 한 트랜잭션이라 중단된 쪽은 **통째로 롤백**된다 — 그래서 같은 인자로 다시 부르는 것이 안전하다.
 *
 * 재시도 후에도 교착이면 한국어 안내를 담은 **P0001 형태의 오류**로 바꿔 돌려준다 — 각 서비스의 오류 번역기가
 * P0001 메시지를 그대로 화면에 보이므로 번역기마다 분기를 더하지 않는다.
 *
 * ⚠️ 트랜잭션 함수(한 번의 rpc 가 한 트랜잭션)에만 쓴다. 여러 호출로 나뉜 쓰기에 쓰면 앞부분이 두 번 반영된다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'

/** 재시도 후에도 교착일 때 보이는 문구 */
export const DEADLOCK_RETRY_MESSAGE = '다른 작업과 동시에 처리되어 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'

/** 재시도 전 대기(ms) — 상대 트랜잭션이 끝날 시간을 준다 */
const RETRY_DELAY_MS = 150

export interface RpcError { code?: string; message?: string }

export async function rpcWithDeadlockRetry<T = unknown>(
  fn: string, args: Record<string, unknown>,
): Promise<{ data: T | null; error: RpcError | null }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabaseAdmin.rpc(fn, args)
    if (!error) return { data: data as T, error: null }
    if (error.code !== '40P01') return { data: null, error }
    if (attempt === 0) {
      console.warn(`[rpcRetry] ${fn} 교착(40P01) — 한 번 재시도합니다.`)
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
      continue
    }
    console.error(`[rpcRetry] ${fn} 재시도 후에도 교착(40P01):`, error.message)
  }
  return { data: null, error: { code: 'P0001', message: DEADLOCK_RETRY_MESSAGE } }
}
