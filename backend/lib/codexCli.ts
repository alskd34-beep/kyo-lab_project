/**
 * 개발 단계 기본 AI 경로 — Codex CLI (의도된 선택).
 *
 * 개발 중에는 API 키 과금 없이 구독 세션을 그대로 쓰려고 CLI 기반을 우선한다.
 * 운영 전환 시 API 기반으로 바꾸며, 그때 아래 제약을 함께 해소해야 한다.
 *
 * 운영 전환 시 확인할 것 (2026-08-22 점검):
 *  - `spawn('sh', ['-c', ...])` — Windows 서버에서는 동작하지 않는다.
 *  - 서버에 설치·로그인된 CLI 세션에 의존해 배포 환경에서 재현이 어렵다.
 *  - 호출 이력이 남지 않아 AI 배정 근거를 감사추적할 수 없다(GMP 관점).
 *
 * 2026-08-23 보안 수정:
 *  - `runCodexText` 의 `--dangerously-bypass-approvals-and-sandbox` 를 `--sandbox read-only` 로 교체했다.
 *    챗봇 경로는 사용자 입력이 프롬프트에 그대로 실리므로, 승인·샌드박스를 끄면
 *    프롬프트 인젝션이 서버 임의 코드 실행으로 직결된다. 되돌리지 말 것.
 *
 * 현재 사용처는 모두 전환 스위치를 갖고 있다:
 *   - `pctAssign` : `ENABLE_CODEX_ASSIGN=1` 옵트인, 실패 시 규칙엔진 폴백
 *   - `chat`      : `CHAT_ADMIN_USE_CLI` (기본값: 비프로덕션에서만 CLI, 운영은 Letsur)
 * 배경: docs/system-audit-2026-08-22.md 7번 항목.
 */
/**
 * [BACKEND] Codex CLI 연동 (구독 서비스)
 *
 * 서버에 설치·로그인된 codex CLI(구독 세션)를 child process 로 실행해
 * 단발 프롬프트의 JSON 또는 최종 텍스트 응답을 받는다.
 *
 * 전제:
 *   - 서버에 codex CLI 설치 + 로그인(구독) 완료
 *   - 선택: CODEX_MODEL 로 기본 모델 지정
 *   - 실행 명령 오버라이드: CODEX_EXEC_CMD (기본 "codex exec")
 *       프롬프트는 stdin 으로 전달된다.
 *
 * 실패(미설치/타임아웃/비정상 종료/파싱 실패) 시 throw → 호출부에서 규칙엔진 폴백.
 */

import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

/** Codex AI 배분 사용 여부 (옵트인) */
export function codexAssignEnabled(): boolean {
  return process.env.ENABLE_CODEX_ASSIGN === '1'
}

async function codexCmd(): Promise<string> {
  const configured = process.env.CODEX_EXEC_CMD?.trim()
  if (configured) return configured

  // VS Code 확장으로 설치된 CLI는 개발 서버 PATH에 포함되지 않을 수 있다.
  const extensionsDir = join(homedir(), '.vscode', 'extensions')
  try {
    const entries = await readdir(extensionsDir, { withFileTypes: true })
    const extensionDirs = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('openai.chatgpt-'))
      .map(entry => entry.name)
      .sort()
      .reverse()

    for (const extensionDir of extensionDirs) {
      const binDir = join(extensionsDir, extensionDir, 'bin')
      try {
        const platforms = await readdir(binDir, { withFileTypes: true })
        for (const platform of platforms) {
          if (!platform.isDirectory()) continue
          const executable = join(binDir, platform.name, 'codex')
          try {
            await access(executable)
            return `${shellQuote(executable)} exec`
          } catch {
            // 다음 플랫폼 실행 파일을 확인한다.
          }
        }
      } catch {
        // 다음 확장 버전을 확인한다.
      }
    }
  } catch {
    // 전역 PATH의 codex 명령으로 계속 시도한다.
  }

  return 'codex exec'
}

function codexModel(): string | null {
  const model = process.env.CODEX_MODEL?.trim()
  return model ? model : null
}

/**
 * 어시스턴트용 모델 오버라이드.
 * 미지정 시 현재 Codex 계정에서 지원하는 CLI 기본 모델을 사용한다.
 */
export function codexAssistantModel(): string | null {
  return process.env.CODEX_ASSISTANT_MODEL?.trim() || codexModel()
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@+-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function appendArgs(baseCmd: string, extraArgs: string[]): string {
  if (extraArgs.length === 0) return baseCmd
  return `${baseCmd} ${extraArgs.map(shellQuote).join(' ')}`
}

function abortError(): Error {
  const err = new Error('요청이 취소되었습니다.')
  err.name = 'AbortError'
  return err
}

/** 텍스트 응답에서 첫 JSON 객체를 추출 */
function extractJson<T>(text: string): T {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('codex 응답에서 JSON을 찾지 못했습니다.')
  }
  return JSON.parse(text.slice(start, end + 1)) as T
}

interface RunCodexOptions {
  timeoutMs?: number
  signal?: AbortSignal
  extraArgs?: string[]
  /** null이면 CODEX_MODEL도 무시하고 Codex CLI의 계정별 기본 모델을 사용한다. */
  model?: string | null
}

export interface CodexCliError extends Error {
  stderr?: string
}

async function runCodexProcess(prompt: string, options: RunCodexOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const model = options.model === undefined ? codexModel() : options.model
  const args = model ? ['--model', model, ...(options.extraArgs ?? [])] : (options.extraArgs ?? [])
  const cmd = appendArgs(await codexCmd(), args)
  const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn('sh', ['-c', cmd], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timeoutMs = options.timeoutMs ?? 90_000
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('codex CLI 타임아웃'))
    }, timeoutMs)
    const onAbort = () => {
      child.kill('SIGKILL')
      reject(abortError())
    }

    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer)
        reject(abortError())
        return
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout.on('data', d => { out += d.toString() })
    child.stderr.on('data', d => { err += d.toString() })
    child.on('error', e => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      reject(e)
    })
    child.on('close', code => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (code !== 0) {
        const error = new Error(`codex CLI 종료코드 ${code}: ${err.slice(0, 500)}`) as CodexCliError
        // 화면에는 짧은 오류만 노출하되, 호출부에서는 전체 원인으로 폴백 여부를 판단한다.
        error.stderr = err
        reject(error)
      }
      else resolve({ stdout: out, stderr: err })
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })

  return result
}

/** codex CLI 를 실행해 프롬프트(stdin) → JSON 응답을 받는다. */
export async function runCodexJson<T>(prompt: string, timeoutMs = 90_000): Promise<T> {
  const { stdout } = await runCodexProcess(prompt, { timeoutMs })
  return extractJson<T>(stdout)
}

/** codex CLI 를 실행해 마지막 메시지(자연어/마크다운)를 문자열로 받는다. */
export async function runCodexText(
  prompt: string,
  options: RunCodexOptions = {},
): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'kd-codex-chat-'))
  const lastMessagePath = join(tempDir, 'last-message.txt')

  try {
    const { stdout } = await runCodexProcess(prompt, {
      ...options,
      extraArgs: [
        '--output-last-message',
        lastMessagePath,
        // 챗봇 프롬프트에는 사용자 입력이 그대로 실린다. 승인·샌드박스를 끄면
        // 프롬프트 인젝션이 곧바로 서버 임의 코드 실행이 되므로 읽기 전용 샌드박스를 강제한다.
        // (읽기 전용이어도 파일 열람은 가능하니, 운영 전환 시 CLI 경로 자체를 API 로 대체할 것)
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '--ignore-user-config',
        '--ignore-rules',
        ...(options.extraArgs ?? []),
      ],
    })

    const fileText = await readFile(lastMessagePath, 'utf8').catch(() => '')
    const text = stdout.trim() || fileText.trim()
    if (!text) throw new Error('codex CLI 응답이 비어 있습니다.')
    return text
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}
