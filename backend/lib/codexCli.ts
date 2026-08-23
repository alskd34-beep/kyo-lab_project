/**
 * 개발 단계 기본 AI 경로 — Codex CLI (의도된 선택).
 *
 * 개발 중에는 API 키 과금 없이 구독 세션을 그대로 쓰려고 CLI 기반을 우선한다.
 * 운영 전환 시 API 기반(Letsur)으로 바꾸며, 그때 아래 제약을 함께 해소해야 한다.
 *
 * 운영 전환 시 확인할 것:
 *  - 서버에 설치·로그인된 CLI 세션에 의존해 배포 환경에서 재현이 어렵다.
 *  - 호출 이력이 구조화되어 남지 않아 AI 배정 근거를 감사추적할 수 없다(GMP 관점).
 *
 * 2026-08-23 보안 수정:
 *  - `runCodexText` 의 `--dangerously-bypass-approvals-and-sandbox` 를 `--sandbox read-only` 로 교체했다.
 *    챗봇 경로는 사용자 입력이 프롬프트에 그대로 실리므로, 승인·샌드박스를 끄면
 *    프롬프트 인젝션이 서버 임의 코드 실행으로 직결된다. 되돌리지 말 것.
 *
 * 2026-08-23 Windows 대응:
 *  - `spawn('sh', ['-c', ...])` 를 없앴다. 실행 파일을 직접 찾아 인자 배열로 spawn 하므로
 *    Windows 에서도 동작하고 셸 인젝션 표면이 사라진다. 프롬프트는 stdin 으로만 전달한다.
 *  - 실행 파일 탐색이 VS Code 확장의 `bin/` 아래 첫 디렉터리를 그대로 골라
 *    Windows 에서 linux-x86_64 바이너리를 집던 문제를 고쳤다. 현재 플랫폼 디렉터리만 본다.
 *  - `--output-last-message` 파일을 stdout 보다 우선한다. stdout 에는 경고·진행 로그가 섞인다.
 *
 * 전제:
 *   - 서버에 codex CLI 설치 + 로그인(구독) 완료
 *   - 실행 파일 오버라이드: CODEX_EXEC_PATH (미설정 시 자동 탐색)
 *   - 선택: CODEX_MODEL 로 기본 모델 지정
 *   - 레거시: CODEX_EXEC_CMD (셸 명령 문자열, POSIX 전용). 설정 시 셸 경로를 쓴다.
 *
 * 현재 사용처는 모두 전환 스위치를 갖고 있다:
 *   - `pctAssign` : `ENABLE_CODEX_ASSIGN=1` 옵트인, 실패 시 규칙엔진 폴백
 *   - `chat`      : `CHAT_ADMIN_USE_CLI` (기본값: 비프로덕션에서만 CLI, 운영은 Letsur)
 * 배경: docs/system-audit-2026-08-22.md 7번 항목.
 *
 * 실패(미설치/타임아웃/비정상 종료/파싱 실패) 시 throw → 호출부에서 규칙엔진 폴백.
 */

import { spawn } from 'node:child_process'
import { access, constants, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

/** Codex AI 배분 사용 여부 (옵트인) */
export function codexAssignEnabled(): boolean {
  return process.env.ENABLE_CODEX_ASSIGN === '1'
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

export interface CodexCliError extends Error {
  stderr?: string
}

/** 실행 대상: 직접 spawn 할 명령과 그 앞에 붙는 고정 인자. */
interface ExecTarget {
  command: string
  baseArgs: string[]
  /** true 면 레거시 셸 경로(CODEX_EXEC_CMD) */
  shell: boolean
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** 현재 플랫폼에 해당하는 확장 bin 디렉터리 이름 접두어. */
function platformToken(): string {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'darwin'
  return 'linux'
}

function binName(): string {
  return process.platform === 'win32' ? 'codex.exe' : 'codex'
}

/**
 * VS Code 확장(openai.chatgpt-*)에 동봉된 실행 파일을 찾는다.
 * 확장은 여러 플랫폼 바이너리를 함께 담고 있으므로 현재 플랫폼 디렉터리만 본다.
 */
async function findInVsCodeExtension(): Promise<string | null> {
  const extensionsDir = join(homedir(), '.vscode', 'extensions')
  let entries
  try {
    entries = await readdir(extensionsDir, { withFileTypes: true })
  } catch {
    return null
  }

  const extensionDirs = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('openai.chatgpt-'))
    .map(entry => entry.name)
    .sort()
    .reverse()

  const token = platformToken()
  for (const extensionDir of extensionDirs) {
    const binDir = join(extensionsDir, extensionDir, 'bin')
    let platforms
    try {
      platforms = await readdir(binDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const platform of platforms) {
      if (!platform.isDirectory() || !platform.name.startsWith(token)) continue
      const executable = join(binDir, platform.name, binName())
      if (await isExecutable(executable)) return executable
    }
  }
  return null
}

/** npm 전역 설치본은 네이티브 바이너리 없이 bin/codex.js 만 두기도 한다. */
async function findNpmGlobalEntry(): Promise<string | null> {
  const roots: string[] = []
  if (process.env.APPDATA) roots.push(join(process.env.APPDATA, 'npm', 'node_modules'))
  roots.push(join(homedir(), '.npm-global', 'lib', 'node_modules'))
  roots.push('/usr/local/lib/node_modules', '/usr/lib/node_modules')

  for (const root of roots) {
    const entry = join(root, '@openai', 'codex', 'bin', 'codex.js')
    try {
      await access(entry, constants.R_OK)
      return entry
    } catch {
      // 다음 후보
    }
  }
  return null
}

async function findOnPath(): Promise<string | null> {
  const name = binName()
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const trimmed = dir.trim()
    if (!trimmed) continue
    const candidate = join(trimmed, name)
    if (await isExecutable(candidate)) return candidate
  }
  return null
}

let cachedTarget: Promise<ExecTarget> | null = null

/** 실행 대상을 한 번만 찾아 캐시한다. */
function codexTarget(): Promise<ExecTarget> {
  if (cachedTarget) return cachedTarget
  const resolving = (async (): Promise<ExecTarget> => {
    // 레거시: 셸 명령 문자열을 명시한 경우 그대로 존중한다(POSIX 전용).
    const legacy = process.env.CODEX_EXEC_CMD?.trim()
    if (legacy) {
      if (process.platform === 'win32') {
        console.warn('[codex] CODEX_EXEC_CMD 는 POSIX 셸 전용입니다. Windows 에서는 CODEX_EXEC_PATH 를 쓰세요.')
      }
      return { command: legacy, baseArgs: [], shell: true }
    }

    const override = process.env.CODEX_EXEC_PATH?.trim()
    if (override) {
      if (await isExecutable(override)) return { command: override, baseArgs: ['exec'], shell: false }
      throw new Error(`CODEX_EXEC_PATH 경로에서 실행 파일을 찾지 못했습니다: ${override}`)
    }

    const fromExtension = await findInVsCodeExtension()
    if (fromExtension) return { command: fromExtension, baseArgs: ['exec'], shell: false }

    const fromPath = await findOnPath()
    if (fromPath) return { command: fromPath, baseArgs: ['exec'], shell: false }

    // 네이티브 바이너리가 없으면 node 로 JS 진입점을 실행한다.
    const jsEntry = await findNpmGlobalEntry()
    if (jsEntry) return { command: process.execPath, baseArgs: [jsEntry, 'exec'], shell: false }

    throw new Error(
      'codex CLI 실행 파일을 찾지 못했습니다. 설치 후 로그인하거나 CODEX_EXEC_PATH 를 지정하세요.',
    )
  })()
  resolving.catch(() => { if (cachedTarget === resolving) cachedTarget = null })
  cachedTarget = resolving
  return resolving
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@+-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function abortError(): Error {
  const err = new Error('요청이 취소되었습니다.')
  err.name = 'AbortError'
  return err
}

/**
 * 자식 프로세스 환경변수.
 *
 * 이 경로의 존재 이유가 "구독 세션으로 과금 없이 쓴다" 이므로, 서버 환경에 API 키가 있으면
 * CLI 가 구독 대신 키 과금으로 붙어버린다. `.env.local` 의 OPENAI_API_KEY 가 Next.js 를 통해
 * process.env 에 실리는 상황이 실제로 있어 자식에게 물려주지 않는다.
 * 키 과금으로 붙이려면 CODEX_USE_API_KEY=1 로 명시적으로 켠다.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (process.env.CODEX_USE_API_KEY === '1') return env
  delete env.OPENAI_API_KEY
  delete env.OPENAI_BASE_URL
  return env
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
  /** 작업 디렉터리 (미지정 시 현재 디렉터리) */
  cwd?: string
  /** 첨부 이미지의 서버측 절대경로. chatUploads 가 검증한 경로만 넘길 것. */
  imagePaths?: string[]
}

async function runCodexProcess(prompt: string, options: RunCodexOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const target = await codexTarget()
  const model = options.model === undefined ? codexModel() : options.model
  const args = [
    ...target.baseArgs,
    ...(model ? ['--model', model] : []),
    ...(options.extraArgs ?? []),
  ]

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    // 사용자 입력은 항상 stdin 으로만 전달한다. argv 에는 상수 인자만 들어간다.
    const child = target.shell
      ? spawn('sh', ['-c', [target.command, ...args.map(shellQuote)].join(' ')], {
          cwd: options.cwd,
          env: childEnv(),
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      : spawn(target.command, args, {
          cwd: options.cwd,
          env: childEnv(),
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        })

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

    // 자식이 먼저 종료하면 stdin 쓰기가 EPIPE 로 실패한다. close 핸들러가 원인을 보고한다.
    child.stdin.on('error', () => {})
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

/** 공통 실행 플래그 — 샌드박스·설정 격리. */
function baseExecArgs(lastMessagePath: string): string[] {
  return [
    '--output-last-message',
    lastMessagePath,
    // 챗봇 프롬프트에는 사용자 입력이 그대로 실린다. 승인·샌드박스를 끄면
    // 프롬프트 인젝션이 곧바로 서버 임의 코드 실행이 되므로 읽기 전용 샌드박스를 강제한다.
    // (읽기 전용이어도 파일 열람은 가능하니, 운영 전환 시 CLI 경로 자체를 API 로 대체할 것)
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    // 사용자 config 의 훅·룰이 stdout 을 오염시키고 응답 지연을 만든다.
    '--ignore-user-config',
    '--ignore-rules',
  ]
}

/**
 * codex CLI 를 실행해 최종 메시지를 문자열로 받는다.
 * stdout 에는 경고·진행 로그가 섞이므로 `--output-last-message` 파일을 우선한다.
 */
async function runCodexWithLastMessage(prompt: string, options: RunCodexOptions): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'kd-codex-'))
  const lastMessagePath = join(tempDir, 'last-message.txt')

  try {
    const imageArgs = (options.imagePaths ?? []).flatMap(path => ['--image', path])
    const { stdout } = await runCodexProcess(prompt, {
      ...options,
      // 프로젝트 파일이 읽기 대상이 되지 않도록 작업 디렉터리를 격리한다.
      cwd: options.cwd ?? tempDir,
      extraArgs: [...baseExecArgs(lastMessagePath), ...imageArgs, ...(options.extraArgs ?? [])],
    })

    const fileText = await readFile(lastMessagePath, 'utf8').catch(() => '')
    const text = fileText.trim() || stdout.trim()
    if (!text) throw new Error('codex CLI 응답이 비어 있습니다.')
    return text
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** codex CLI 를 실행해 프롬프트(stdin) → JSON 응답을 받는다. */
export async function runCodexJson<T>(prompt: string, timeoutMs = 90_000): Promise<T> {
  const text = await runCodexWithLastMessage(prompt, { timeoutMs })
  return extractJson<T>(text)
}

/** codex CLI 를 실행해 마지막 메시지(자연어/마크다운)를 문자열로 받는다. */
export async function runCodexText(
  prompt: string,
  options: RunCodexOptions = {},
): Promise<string> {
  return runCodexWithLastMessage(prompt, options)
}
