/**
 * [BACKEND] 사용자 / 인증 데이터 액세스 + Admin 시드 부트스트랩
 */

import { supabaseAdmin as supabase } from '@backend/lib/supabase'
import {
  hashPassword,
  hashRefreshToken,
  type UserRole,
  REFRESH_TTL_SEC,
} from '@backend/lib/auth'

export interface UserDTO {
  id:           string
  username:     string
  displayName:  string | null
  avatarUrl:    string | null
  role:         UserRole
  isActive:     boolean
  lastLoginAt:  string | null
  createdAt:    string
  /** 내부 고객번호 — 시리얼 별도 식별키(1000부터, 5자리 표기) */
  customerNo:   number | null
  /** 1:1 연결된 시험자 */
  testerId:     string | null
  testerName:   string | null
}

export interface InternalUser extends UserDTO {
  passwordHash: string
}

const ADMIN_USERNAME = 'kyo-admin'
const ADMIN_PASSWORD = 'kyo-admin'

/**
 * 앱 역할(UserRole: 'admin'|'tester') ↔ DB enum(user_role: 'admin'|'user') 매핑.
 * DB enum 에 'tester' 가 없는 환경(마이그레이션 0023 미적용)에서도 동작하도록,
 * 앱의 'tester' 는 DB 에 'user' 로 저장하고 조회 시 'user'→'tester' 로 환산한다.
 * (0023 적용 시 DB 에 'tester' 가 생겨도 이 매핑은 무해 — 'tester'/'user' 모두 'tester' 로 환산)
 */
function roleToDb(role: UserRole): string { return role === 'admin' ? 'admin' : 'user' }
function roleFromDb(dbRole: string): UserRole { return dbRole === 'admin' ? 'admin' : 'tester' }

let adminEnsured = false

/** 최초 가동 시 기본 admin 계정을 생성합니다. */
export async function ensureAdminSeed(): Promise<void> {
  if (adminEnsured) return

  const sel = await supabase
    .from('users')
    .select('id')
    .eq('username', ADMIN_USERNAME)
    .maybeSingle()

  if (sel.error) {
    throw new Error(
      `users 테이블 조회 실패 (마이그레이션 0003 미적용 가능성): ${sel.error.message}`,
    )
  }

  if (!sel.data) {
    const hash = await hashPassword(ADMIN_PASSWORD)
    const ins = await supabase.from('users').insert({
      username:      ADMIN_USERNAME,
      password_hash: hash,
      display_name:  '관리자',
      role:          'admin',
    })
    if (ins.error) {
      throw new Error(`admin 시드 실패: ${ins.error.message}`)
    }
  }
  adminEnsured = true
}

interface DbUser {
  id:             string
  username:       string
  password_hash:  string
  display_name:   string | null
  avatar_url:     string | null
  role:           UserRole
  is_active:      boolean
  last_login_at:  string | null
  created_at:     string
  customer_no:    number | null
  tester_id:      string | null
}

function toDTO(r: DbUser, testerName: string | null = null): UserDTO {
  return {
    id:          r.id,
    username:    r.username,
    displayName: r.display_name,
    avatarUrl:   r.avatar_url ?? null,
    role:        roleFromDb(r.role as unknown as string),
    isActive:    r.is_active,
    lastLoginAt: r.last_login_at,
    createdAt:   r.created_at,
    customerNo:  r.customer_no ?? null,
    testerId:    r.tester_id ?? null,
    testerName,
  }
}

function toInternal(r: DbUser): InternalUser {
  return { ...toDTO(r), passwordHash: r.password_hash }
}

export async function findUserByUsername(username: string): Promise<InternalUser | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('username', username)
    .maybeSingle()
  return data ? toInternal(data as DbUser) : null
}

export async function findUserById(id: string): Promise<UserDTO | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return data ? toDTO(data as DbUser) : null
}

export async function listUsers(): Promise<UserDTO[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as DbUser[]

  // 연결 시험자 이름 매핑
  const testerIds = Array.from(new Set(rows.map(r => r.tester_id).filter(Boolean) as string[]))
  const nameById = new Map<string, string>()
  if (testerIds.length > 0) {
    const { data: testers } = await supabase.from('testers').select('id, name').in('id', testerIds)
    for (const t of (testers ?? []) as Record<string, unknown>[]) {
      nameById.set(t.id as string, t.name as string)
    }
  }
  return rows.map(r => toDTO(r, r.tester_id ? (nameById.get(r.tester_id) ?? null) : null))
}

/**
 * role='tester' 전환 시 testers 레코드 보장 → tester.id 반환.
 * 사번(=username)이 동일한 기존 레코드가 있으면 재사용, 없으면 신규 생성.
 * 해당 시험자가 다른 사용자에 이미 연결된 경우 먼저 해제해 1:1 unique 제약을 만족시킨다.
 */
async function ensureLinkedTester(userId: string, username: string, displayName: string | null): Promise<string> {
  const { data: existing } = await supabase
    .from('testers')
    .select('id')
    .eq('employee_no', username)
    .maybeSingle()

  if (existing) {
    const testerId = (existing as Record<string, unknown>).id as string
    // 다른 사용자가 이 시험자를 점유하고 있으면 먼저 해제
    await supabase.from('users').update({ tester_id: null }).eq('tester_id', testerId).neq('id', userId)
    return testerId
  }

  const { data, error } = await supabase
    .from('testers')
    .insert({ employee_no: username, name: displayName ?? username, can_solo: true, can_duo: false, is_active: true })
    .select('id')
    .single()
  if (error) throw new Error(`시험자 레코드 생성 실패: ${error.message}`)
  return (data as Record<string, unknown>).id as string
}

export async function createUser(input: {
  username:    string
  password:    string
  displayName?: string
  avatarUrl?:   string | null
  role?:        UserRole
}): Promise<UserDTO> {
  const hash = await hashPassword(input.password)
  const role = input.role ?? 'tester'
  const row: Record<string, unknown> = {
    username:      input.username,
    password_hash: hash,
    display_name:  input.displayName ?? null,
    role:          roleToDb(role),
  }
  if (input.avatarUrl !== undefined) row.avatar_url = input.avatarUrl
  if (role === 'tester') {
    // createUser 시점에는 아직 id가 없으므로 빈 문자열 전달 (다른 사용자가 점유할 일 없음)
    row.tester_id = await ensureLinkedTester('', input.username, input.displayName ?? null)
  }

  const { data, error } = await supabase
    .from('users')
    .insert(row)
    .select('*')
    .single()
  if (error) throw error
  return toDTO(data as DbUser)
}

export async function updateUser(
  id: string,
  patch: { displayName?: string; avatarUrl?: string | null; role?: UserRole; isActive?: boolean; password?: string },
): Promise<UserDTO> {
  const update: Record<string, unknown> = {}
  if (patch.displayName !== undefined) update.display_name = patch.displayName
  if (patch.avatarUrl   !== undefined) update.avatar_url   = patch.avatarUrl
  if (patch.isActive    !== undefined) update.is_active    = patch.isActive
  if (patch.password)                  update.password_hash = await hashPassword(patch.password)

  if (patch.role !== undefined) {
    update.role = roleToDb(patch.role)
    if (patch.role === 'tester') {
      // 시험자 역할로 전환 시 시험자 레코드 자동 연결 (이미 연결된 경우 유지)
      const { data: cur } = await supabase
        .from('users')
        .select('username, display_name, tester_id')
        .eq('id', id)
        .single()
      if (cur && !(cur as Record<string, unknown>).tester_id) {
        const c = cur as Record<string, unknown>
        update.tester_id = await ensureLinkedTester(id, c.username as string, (c.display_name as string) ?? null)
      }
    } else if (patch.role === 'admin') {
      // 관리자로 전환 시 시험자 연결 해제
      update.tester_id = null
    }
  }

  const { data, error } = await supabase
    .from('users')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error

  const saved = data as DbUser
  // 계정 활성/비활성 → 연결된 시험자에 전파.
  // testers.is_active 가 배정 후보(AI 스케줄·담당자 선택)의 기준이므로,
  // 여기서 맞춰주지 않으면 "계정은 비활성인데 배정은 되는" 불일치가 생긴다.
  if (patch.isActive !== undefined && saved.tester_id) {
    await supabase.from('testers').update({ is_active: patch.isActive }).eq('id', saved.tester_id)
  }
  return toDTO(saved)
}

export async function deleteUser(id: string): Promise<void> {
  const { error } = await supabase.from('users').delete().eq('id', id)
  if (error) throw error
}

export async function touchLastLogin(id: string): Promise<void> {
  await supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', id)
}

// ─── Refresh tokens ─────────────────────────────────────────────────────────
export async function storeRefreshToken(params: {
  userId:    string
  jti:       string
  rawToken:  string
  userAgent?: string
  ip?:        string
}): Promise<void> {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000).toISOString()
  await supabase.from('auth_refresh_tokens').insert({
    id:          params.jti,
    user_id:     params.userId,
    token_hash:  hashRefreshToken(params.rawToken),
    expires_at:  expiresAt,
    user_agent:  params.userAgent ?? null,
    ip:          params.ip ?? null,
  })
}

export async function isRefreshTokenValid(jti: string, rawToken: string): Promise<boolean> {
  const { data } = await supabase
    .from('auth_refresh_tokens')
    .select('token_hash, expires_at, revoked_at')
    .eq('id', jti)
    .maybeSingle()
  if (!data) return false
  if (data.revoked_at) return false
  if (new Date(data.expires_at as string) < new Date()) return false
  return data.token_hash === hashRefreshToken(rawToken)
}

export async function revokeRefreshToken(jti: string): Promise<void> {
  await supabase
    .from('auth_refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', jti)
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await supabase
    .from('auth_refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null)
}
