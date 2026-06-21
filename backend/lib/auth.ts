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

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  ?? 'dev-access-secret-change-me'
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me'

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
