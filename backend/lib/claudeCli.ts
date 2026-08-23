/**
 * [BACKEND] Claude CLI 연동 (구독 세션)
 *
 * 개발 단계 관리자 어시스턴트의 기본 AI 경로. API 키 과금 없이 서버에 로그인된
 * Claude Code CLI 구독 세션을 child process 로 실행해 단발 프롬프트의 최종 텍스트를 받는다.
 *
 * codexCli.ts 와 같은 역할이지만 아래 세 가지가 다르다 (2026-08-23 신규):
 *  - `sh -c` 를 쓰지 않는다. 실행 파일 경로를 직접 찾아 인자 배열로 spawn 하므로
 *    Windows 에서도 동작하고 셸 인젝션 표면이 아예 없다.
 *  - 모든 내장 도구를 차단하고 `--safe-mode` 로 실행한다. 챗봇 프롬프트에는 사용자 입력이
 *    그대로 실리므로, 도구가 열려 있으면 프롬프트 인젝션이 곧 파일 접근·임의 실행이 된다.
 *    되돌리지 말 것.
 *  - 호출 1건마다 모델·토큰·비용을 로그로 남긴다(`[claude-cli]`).
 *
 * 전제:
 *   - 서버에 Claude Code CLI 설치 + 로그인(구독) 완료
 *   - 실행 파일 오버라이드: CLAUDE_EXEC_PATH (미설정 시 후보 경로 → PATH 순으로 탐색)
 *   - 모델 오버라이드: CLAUDE_ASSISTANT_MODEL (미설정 시 가장 저렴한 Haiku)
 *
 * 운영 전환 시 (codexCli.ts 와 동일한 제약):
 *   - 서버에 설치·로그인된 CLI 세션에 의존해 배포 환경에서 재현이 어렵다.
 *   - 감사추적이 구조화되어 저장되지 않는다(로그뿐). GMP 관점에서는 API 경로로 대체할 것.
 *   운영 기본값은 여전히 Letsur(API) 다 — `CHAT_ADMIN_USE_CLI` 참고.
 *
 * 실패(미설치/타임아웃/비정상 종료/빈 응답) 시 throw → 호출부에서 오류 메시지 표시.
 */

import { spawn } from 'node:child_process'
import { access, constants, mkdtemp, rm } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

/** 가장 저렴한 Claude 모델. 어시스턴트 응답 품질에는 충분하다. */
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

/**
 * 차단할 내장 도구 목록.
 * `--safe-mode` 가 MCP·스킬·훅·플러그인·CLAUDE.md 를 이미 끄지만 내장 도구는 별도로 막아야 한다.
 */
const DENIED_TOOLS = [
  'Bash', 'BashOutput', 'KillShell',
  'Read', 'Write', 'Edit', 'NotebookEdit',
  'Glob', 'Grep',
  'WebFetch', 'WebSearch',
  'Task', 'Agent', 'SlashCommand', 'Skill',
]

export interface ClaudeCliError extends Error {
  stderr?: string
}

interface RunClaudeOptions {
  /** 요청 취소 신호 (req.signal 등) */
  signal?: AbortSignal
  /** 타임아웃 (기본 120초) */
  timeoutMs?: number
  /** 별도 시스템 프롬프트. 없으면 prompt 전체를 사용자 메시지로 전송한다. */
  system?: string
  /** null 이면 CLAUDE_ASSISTANT_MODEL 도 무시하고 CLI 계정 기본 모델을 쓴다. */
  model?: string | null
}

/** 어시스턴트용 모델. 미지정 시 가장 저렴한 Haiku. */
export function claudeAssistantModel(): string {
  return process.env.CLAUDE_ASSISTANT_MODEL?.trim() || DEFAULT_MODEL
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * 실행 파일 후보 경로.
 * Windows 의 npm 전역 설치는 PATH 에 셸 스크립트(`claude`)와 `claude.cmd` 만 두고
 * 실제 실행 파일은 node_modules 안에 있다. 셸 없이 spawn 하려면 .exe 를 직접 찾아야 한다.
 */
function candidatePaths(): string[] {
  const home = homedir()
  const isWindows = process.platform === 'win32'
  const binName = isWindows ? 'claude.exe' : 'claude'
  const paths: string[] = []

  if (isWindows) {
    const appData = process.env.APPDATA
    if (appData) {
      paths.push(join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', binName))
    }
  }

  // 네이티브 인스톨러 기본 위치
  paths.push(join(home, '.local', 'bin', binName))

  if (!isWindows) {
    paths.push('/usr/local/bin/claude', '/opt/homebrew/bin/claude')
  }

  // 마지막으로 PATH 를 직접 훑는다 (Node 는 Windows 에서 PATHEXT 해석을 하지 않는다).
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const trimmed = dir.trim()
    if (trimmed) paths.push(join(trimmed, binName))
  }

  return paths
}

let cachedPath: Promise<string> | null = null

/** 실행 파일 경로를 한 번만 찾아 캐시한다. */
function claudeExecPath(): Promise<string> {
  if (cachedPath) return cachedPath
  const resolving = (async () => {
    const override = process.env.CLAUDE_EXEC_PATH?.trim()
    if (override) {
      if (await isExecutable(override)) return override
      throw new Error(`CLAUDE_EXEC_PATH 경로에서 실행 파일을 찾지 못했습니다: ${override}`)
    }
    for (const candidate of candidatePaths()) {
      if (await isExecutable(candidate)) return candidate
    }
    throw new Error(
      'Claude CLI 실행 파일을 찾지 못했습니다. 설치 후 로그인하거나 CLAUDE_EXEC_PATH 를 지정하세요.',
    )
  })()
  // 실패는 캐시하지 않는다(설치 후 재시도 가능).
  resolving.catch(() => { if (cachedPath === resolving) cachedPath = null })
  cachedPath = resolving
  return resolving
}

function abortError(): Error {
  const err = new Error('요청이 취소되었습니다.')
  err.name = 'AbortError'
  return err
}

interface ClaudeCliResult {
  is_error?: boolean
  result?: string
  total_cost_usd?: number
  duration_ms?: number
  usage?: { input_tokens?: number; output_tokens?: number }
  modelUsage?: Record<string, unknown>
}

/**
 * 자식 프로세스 환경변수.
 *
 * 이 경로의 존재 이유가 "구독 세션으로 과금 없이 쓴다" 이므로, 서버 환경에 API 키가
 * 있으면 CLI 가 구독 대신 키 과금으로 붙어버린다. `.env.local` 에 다른 용도로 넣어둔
 * ANTHROPIC_API_KEY 가 Next.js 를 통해 process.env 에 실리는 상황이 실제로 있어
 * 인증 관련 변수를 자식에게 물려주지 않는다.
 *
 * 키 과금으로 붙이려면 CLAUDE_USE_API_KEY=1 로 명시적으로 켠다.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (process.env.CLAUDE_USE_API_KEY === '1') return env
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.ANTHROPIC_BASE_URL
  delete env.CLAUDE_CODE_USE_BEDROCK
  delete env.CLAUDE_CODE_USE_VERTEX
  return env
}

function runProcess(
  exec: string,
  args: string[],
  prompt: string,
  cwd: string,
  options: RunClaudeOptions,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // 사용자 입력은 항상 stdin 으로만 전달한다. argv 에는 상수 인자만 들어간다.
    const child = spawn(exec, args, {
      cwd,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let out = ''
    let err = ''
    const timeoutMs = options.timeoutMs ?? 120_000
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Claude CLI 타임아웃'))
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
        const error = new Error(`Claude CLI 종료코드 ${code}: ${err.slice(0, 500)}`) as ClaudeCliError
        error.stderr = err
        reject(error)
        return
      }
      resolve(out)
    })

    // 자식이 먼저 종료하면 stdin 쓰기가 EPIPE 로 실패한다. close 핸들러가 원인을 보고한다.
    child.stdin.on('error', () => {})
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

/** 호출 1건의 모델·토큰·비용을 로그로 남긴다(개발용 최소 감사추적). */
function logUsage(model: string | null, parsed: ClaudeCliResult): void {
  const used = parsed.modelUsage ? Object.keys(parsed.modelUsage).join(',') : (model ?? '기본값')
  const cost = parsed.total_cost_usd != null ? `$${parsed.total_cost_usd.toFixed(4)}` : '-'
  console.info(
    `[claude-cli] model=${used} in=${parsed.usage?.input_tokens ?? '-'} out=${parsed.usage?.output_tokens ?? '-'} cost=${cost} ${parsed.duration_ms ?? '-'}ms`,
  )
}

/**
 * Claude CLI 를 실행해 최종 답변(자연어/마크다운)을 문자열로 받는다.
 * 프롬프트는 stdin 으로 전달한다.
 */
export async function runClaudeText(prompt: string, options: RunClaudeOptions = {}): Promise<string> {
  const exec = await claudeExecPath()
  const model = options.model === undefined ? claudeAssistantModel() : options.model

  const args = [
    '--print',
    '--output-format', 'json',
    // 프로젝트 설정·훅·MCP·스킬·CLAUDE.md 를 전부 끄고 순수 모델 호출에 가깝게 만든다.
    '--safe-mode',
    '--strict-mcp-config',
    '--setting-sources', '',
    // 채팅 요청마다 세션 파일이 디스크에 쌓이는 것을 막는다(QC 데이터 유출 방지).
    '--no-session-persistence',
    // 승인 없이는 어떤 도구도 실행하지 않는다. 헤드리스에서는 곧 거부를 의미한다.
    '--permission-mode', 'manual',
    '--disallowedTools', ...DENIED_TOOLS,
  ]
  if (model) args.push('--model', model)
  if (options.system) args.push('--system-prompt', options.system)

  // CLAUDE.md 자동 탐색과 파일 접근 범위를 프로젝트 밖으로 격리한다.
  const cwd = await mkdtemp(join(tmpdir(), 'kd-claude-chat-'))
  try {
    const stdout = await runProcess(exec, args, prompt, cwd, options)

    let parsed: ClaudeCliResult | null = null
    try {
      parsed = JSON.parse(stdout) as ClaudeCliResult
    } catch {
      // JSON 파싱 실패 시 원문을 그대로 쓴다(CLI 출력 형식이 바뀐 경우 대비).
    }

    if (!parsed) {
      const text = stdout.trim()
      if (!text) throw new Error('Claude CLI 응답이 비어 있습니다.')
      return text
    }

    logUsage(model, parsed)
    if (parsed.is_error) {
      throw new Error(`Claude CLI 오류: ${(parsed.result ?? '').slice(0, 300)}`)
    }
    const text = (parsed.result ?? '').trim()
    if (!text) throw new Error('Claude CLI 응답이 비어 있습니다.')
    return text
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {})
  }
}
