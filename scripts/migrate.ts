/**
 * Supabase 마이그레이션 실행 스크립트
 * 실행: npx tsx scripts/migrate.ts
 *
 * 필요 환경변수 (.env.local):
 *   SUPABASE_DB_PASSWORD=your-database-password
 *
 * DB 비밀번호 위치: Supabase 대시보드 → Project Settings → Database → Database password
 */

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function execSqlViaRpc(sql: string): Promise<void> {
  const { error } = await (supabase as any).rpc('exec_sql', { query: sql })
  if (error) throw error
}

async function createExecFn(): Promise<void> {
  // exec_sql 헬퍼 함수 생성 (service_role이 있어야 실행 가능)
  // Supabase dashboard SQL 에디터에서 1회 실행 후 이 스크립트를 사용하세요
  console.log('exec_sql 함수가 없습니다.')
  console.log('Supabase 대시보드 SQL 에디터에서 아래 SQL을 먼저 실행해주세요:\n')
  console.log(`
create or replace function exec_sql(query text)
returns void
language plpgsql
security definer
as $$
begin
  execute query;
end;
$$;
  `)
}

async function runMigrationFiles(): Promise<void> {
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations')
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .filter(f => ['0004_pqm_schema.sql', '0005_seed_pqm_data.sql'].includes(f))

  console.log(`실행할 마이그레이션: ${files.join(', ')}\n`)

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    // 세미콜론으로 분리 후 빈 구문 제거
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    console.log(`▶ ${file} (${statements.length}개 구문)`)

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i] + ';'
      try {
        await execSqlViaRpc(stmt)
        if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${statements.length} 완료`)
      } catch (err: any) {
        const msg = err?.message ?? String(err)
        // 이미 존재하는 객체는 무시
        if (msg.includes('already exists') || msg.includes('duplicate')) {
          continue
        }
        console.error(`  ✗ 오류 (구문 ${i + 1}): ${msg}`)
        console.error(`  SQL: ${stmt.slice(0, 100)}...`)
      }
    }
    console.log(`  ✓ ${file} 완료\n`)
  }
}

async function main() {
  console.log('=== PQM 마이그레이션 실행 ===\n')
  console.log(`Supabase URL: ${SUPABASE_URL}\n`)

  // exec_sql RPC 존재 여부 확인
  const { error: testErr } = await (supabase as any).rpc('exec_sql', { query: 'SELECT 1' })
  if (testErr) {
    await createExecFn()
    process.exit(1)
  }

  await runMigrationFiles()
  console.log('=== 완료 ===')
}

main().catch(e => { console.error(e); process.exit(1) })
