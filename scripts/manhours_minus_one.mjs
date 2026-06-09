/**
 * product_manhours.avg_hours 전체 -1 (영구) 일회성 보정 스크립트
 *
 * 실행:
 *   미리보기:  node scripts/manhours_minus_one.mjs          (DB 변경 없음)
 *   실제 적용:  node scripts/manhours_minus_one.mjs --apply
 *
 * - service_role 키로 RLS 우회하여 직접 UPDATE
 * - 결과값은 소수 2자리로 반올림, 음수는 0으로 클램프
 */

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// ─── .env.local 직접 파싱 (tsx/dotenv 불필요) ──────────────────────────────────
function loadEnv(file) {
  const env = {}
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2].trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      env[m[1]] = v
    }
  } catch (e) {
    console.error(`.env.local 읽기 실패: ${e.message}`)
    process.exit(1)
  }
  return env
}

const env = loadEnv(new URL('../.env.local', import.meta.url).pathname)
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const KEY  = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 필요합니다.')
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')
const round2 = (n) => Math.round(n * 100) / 100

const supabase = createClient(URL_, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function main() {
  console.log(`=== product_manhours.avg_hours 전체 -1 ${APPLY ? '[실제 적용]' : '[미리보기 — DB 변경 없음]'} ===\n`)

  const { data, error } = await supabase
    .from('product_manhours')
    .select('id, avg_hours, package_unit, products(product_code, name)')
    .order('avg_hours', { ascending: false })
  if (error) { console.error('조회 실패:', error.message); process.exit(1) }

  const rows = data ?? []
  let clamped = 0
  const plan = rows.map(r => {
    const before = Number(r.avg_hours)
    let after = round2(before - 1)
    if (after < 0) { after = 0; clamped++ }
    return { id: r.id, before, after, name: r.products?.name ?? '', code: r.products?.product_code ?? '' }
  })

  console.log(`대상: ${plan.length}건` + (clamped ? ` (음수 → 0 클램프: ${clamped}건)` : ''))
  console.log('샘플 (상위 10건):')
  for (const p of plan.slice(0, 10)) {
    console.log(`  ${p.code.padEnd(10)} ${p.name.slice(0, 16).padEnd(18)} ${p.before.toFixed(2)} → ${p.after.toFixed(2)}`)
  }
  if (plan.length > 10) console.log(`  ... 외 ${plan.length - 10}건`)

  if (!APPLY) {
    console.log('\n미리보기만 실행했습니다. 실제 적용하려면 --apply 플래그로 다시 실행하세요.')
    return
  }

  console.log('\n적용 중...')
  const now = new Date().toISOString()
  let ok = 0, fail = 0
  for (const p of plan) {
    if (p.before === p.after) { ok++; continue }
    const { error: e } = await supabase
      .from('product_manhours')
      .update({ avg_hours: p.after, updated_at: now })
      .eq('id', p.id)
    if (e) { fail++; console.error(`  ✗ ${p.code} ${p.name}: ${e.message}`) }
    else ok++
  }
  console.log(`\n완료: 성공 ${ok}건, 실패 ${fail}건` + (clamped ? `, 0으로 클램프 ${clamped}건` : ''))
}

main().catch(e => { console.error(e); process.exit(1) })
