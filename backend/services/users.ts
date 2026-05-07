/**
 * [BACKEND] 사용자 / 인증 데이터 액세스 + Admin 시드 부트스트랩
 */

import { supabase } from '@backend/lib/supabase'
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
  role:         UserRole
  isActive:     boolean
  lastLoginAt:  string | null
  createdAt:    string
}

export interface InternalUser extends UserDTO {
  passwordHash: string
}

const ADMIN_USERNAME = 'kyo-admin'
const ADMIN_PASSWORD = 'kyo-admin'

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
  role:           UserRole
  is_active:      boolean
  last_login_at:  string | null
  created_at:     string
}

function toDTO(r: DbUser): UserDTO {
  return {
    id:          r.id,
    username:    r.username,
    displayName: r.display_name,
    role:        r.role,
    isActive:    r.is_active,
    lastLoginAt: r.last_login_at,
    createdAt:   r.created_at,
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
  return ((data ?? []) as DbUser[]).map(toDTO)
}

export async function createUser(input: {
  username:    string
  password:    string
  displayName?: string
  role?:        UserRole
}): Promise<UserDTO> {
  const hash = await hashPassword(input.password)
  const { data, error } = await supabase
    .from('users')
    .insert({
      username:      input.username,
      password_hash: hash,
      display_name:  input.displayName ?? null,
      role:          input.role ?? 'user',
    })
    .select('*')
    .single()
  if (error) throw error
  return toDTO(data as DbUser)
}

export async function updateUser(
  id: string,
  patch: { displayName?: string; role?: UserRole; isActive?: boolean; password?: string },
): Promise<UserDTO> {
  const update: Record<string, unknown> = {}
  if (patch.displayName !== undefined) update.display_name = patch.displayName
  if (patch.role        !== undefined) update.role         = patch.role
  if (patch.isActive    !== undefined) update.is_active    = patch.isActive
  if (patch.password)                  update.password_hash = await hashPassword(patch.password)

  const { data, error } = await supabase
    .from('users')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return toDTO(data as DbUser)
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
