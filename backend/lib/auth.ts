/**
 * [BACKEND] 인증 헬퍼 - JWT 발급/검증, 비밀번호 해시
 *
 * 토큰 전략:
 *   - access  token : 15분, Authorization 헤더 또는 'access_token' 쿠키
 *   - refresh token : 7일, httpOnly 'refresh_token' 쿠키 (Path=/, SameSite=Lax)
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import bcrypt from 'bcryptjs'
import { createHash, randomUUID } from 'crypto'

const enc = new TextEncoder()

/**
 * JWT 시크릿.
 *
 * 2026-08-23 보안 수정: 예전에는 미설정 시 `'dev-access-secret-change-me'` 같은
 * **소스에 적힌 고정값**으로 조용히 폴백했다. 운영에서 환경변수가 빠지면 누구나
 * 그 값으로 `role:'admin'` 토큰을 위조할 수 있는 상태가 무증상으로 발생한다.
 * 이제 운영(NODE_ENV=production)에서는 미설정 시 부팅을 실패시킨다.
 */
function requireSecret(name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET', devFallback: string): string {
  const v = process.env[name]
  if (v && v.length >= 32) return v
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${name} 환경변수가 없거나 너무 짧습니다(32자 이상 필요). ` +
      `생성: openssl rand -hex 32`,
    )
  }
  if (v) return v   // 개발 환경에서는 짧은 값도 허용
  console.warn(`[auth] ${name} 미설정 — 개발용 기본값을 사용합니다. 운영에서는 반드시 설정하세요.`)
  return devFallback
}

const ACCESS_SECRET  = requireSecret('JWT_ACCESS_SECRET',  'dev-access-secret-change-me')
const REFRESH_SECRET = requireSecret('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me')

export const ACCESS_TTL_SEC  = 60 * 15            // 15분
export const REFRESH_TTL_SEC = 60 * 60 * 24 * 7   // 7일

export type UserRole = 'admin' | 'tester'

export interface AccessPayload extends JWTPayload {
  sub:      string         // user id
  username: string
  role:     UserRole
}

export interface RefreshPayload extends JWTPayload {
  sub: string
  jti: string              // refresh token ID (DB 매칭용)
}

// ─── Password ────────────────────────────────────────────────────────────────
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// ─── JWT ─────────────────────────────────────────────────────────────────────
export async function signAccessToken(payload: Omit<AccessPayload, keyof JWTPayload>): Promise<string> {
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SEC}s`)
    .sign(enc.encode(ACCESS_SECRET))
}

export async function signRefreshToken(payload: Omit<RefreshPayload, keyof JWTPayload>): Promise<string> {
  return new SignJWT(payload as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL_SEC}s`)
    .sign(enc.encode(REFRESH_SECRET))
}

export async function verifyAccessToken(token: string): Promise<AccessPayload> {
  const { payload } = await jwtVerify(token, enc.encode(ACCESS_SECRET))
  return payload as AccessPayload
}

export async function verifyRefreshToken(token: string): Promise<RefreshPayload> {
  const { payload } = await jwtVerify(token, enc.encode(REFRESH_SECRET))
  return payload as RefreshPayload
}

// ─── Refresh token DB 보조 ───────────────────────────────────────────────────
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateJti(): string {
  return randomUUID()
}
