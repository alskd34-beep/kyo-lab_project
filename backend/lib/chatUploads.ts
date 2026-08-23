/**
 * [BACKEND] 챗봇 이미지 첨부 로컬 저장소
 *
 * 예전에는 MISO 앱에 업로드하고 file id 를 받아 썼지만(2026-08-23 제거), 이제 이미지를
 * 서버 임시 디렉터리에 저장하고 CLI 에 `-i <파일>` 로 넘긴다.
 *
 * 보안 원칙:
 *  - 클라이언트가 경로를 지정하지 못한다. 서버가 만든 불투명한 id 만 오간다.
 *  - id 에 소유자 해시를 박아 두고 조회 시 요청자와 대조한다(남의 첨부 열람 차단).
 *  - id 형식을 정규식으로 강제한 뒤에만 경로 조합에 쓴다(경로 순회 차단).
 *
 * 임시 파일이므로 1시간이 지나면 업로드 시점에 함께 정리한다.
 * 운영에서 다중 인스턴스로 가면 이 방식은 인스턴스 로컬이라 공유 스토리지가 필요하다.
 */

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const STORE_DIR = join(tmpdir(), 'kd-chat-uploads')
const TTL_MS = 60 * 60 * 1000
const ID_PATTERN = /^[a-f0-9]{16}-[a-f0-9]{32}$/

/** 허용 이미지 형식 → 확장자. 목록에 없으면 거부한다. */
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export function isSupportedImageType(mimeType: string): boolean {
  return mimeType in EXTENSIONS
}

function ownerHash(userSub: string): string {
  return createHash('sha256').update(userSub).digest('hex').slice(0, 16)
}

/** TTL 이 지난 첨부를 지운다. 실패는 무시한다(임시 파일이므로). */
async function purgeExpired(): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(STORE_DIR)
  } catch {
    return
  }
  const cutoff = Date.now() - TTL_MS
  await Promise.all(entries.map(async name => {
    const path = join(STORE_DIR, name)
    try {
      const info = await stat(path)
      if (info.mtimeMs < cutoff) await rm(path, { force: true })
    } catch {
      // 이미 사라졌거나 접근 불가 — 무시
    }
  }))
}

export interface StoredImage {
  id: string
  name: string
  mimeType: string
}

/** 이미지를 저장하고 불투명한 id 를 돌려준다. */
export async function storeChatImage(
  bytes: Buffer,
  mimeType: string,
  originalName: string,
  userSub: string,
): Promise<StoredImage> {
  const ext = EXTENSIONS[mimeType]
  if (!ext) throw new Error('지원하지 않는 이미지 형식입니다.')

  await mkdir(STORE_DIR, { recursive: true })
  await purgeExpired()

  const id = `${ownerHash(userSub)}-${randomBytes(16).toString('hex')}`
  await writeFile(join(STORE_DIR, `${id}.${ext}`), bytes)
  return { id, name: originalName || `image.${ext}`, mimeType }
}

/**
 * id 목록을 실제 파일 경로로 바꾼다.
 * 형식이 어긋나거나 소유자가 다르거나 파일이 없으면 조용히 건너뛴다.
 */
export async function resolveChatImages(ids: string[], userSub: string): Promise<string[]> {
  if (ids.length === 0) return []
  const owner = ownerHash(userSub)
  const paths: string[] = []

  for (const id of ids) {
    if (!ID_PATTERN.test(id)) continue
    if (!id.startsWith(`${owner}-`)) continue
    for (const ext of Object.values(EXTENSIONS)) {
      const path = join(STORE_DIR, `${id}.${ext}`)
      try {
        await stat(path)
        paths.push(path)
        break
      } catch {
        // 다음 확장자
      }
    }
  }
  return paths
}
