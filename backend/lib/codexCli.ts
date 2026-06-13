/**
 * [BACKEND] Codex CLI 연동 (구독 서비스)
 *
 * OpenAI API 키 과금이 아니라, 서버에 설치·로그인된 codex CLI(구독 세션)를
 * child process 로 실행해 단발 프롬프트의 JSON 응답을 받는다.
 *
 * 전제:
 *   - 서버에 codex CLI 설치 + 로그인(구독) 완료
 *   - 활성화 플래그: ENABLE_CODEX_ASSIGN=1
 *   - 실행 명령 오버라이드: CODEX_EXEC_CMD (기본 "codex exec")
 *       프롬프트는 stdin 으로 전달된다.
 *
 * 실패(미설치/타임아웃/비정상 종료/파싱 실패) 시 throw → 호출부에서 규칙엔진 폴백.
 */

import { spawn } from 'node:child_process'

/** Codex AI 배분 사용 여부 (옵트인) */
export function codexAssignEnabled(): boolean {
  return process.env.ENABLE_CODEX_ASSIGN === '1'
}

function codexCmd(): string {
  return process.env.CODEX_EXEC_CMD || 'codex exec'
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

/** codex CLI 를 실행해 프롬프트(stdin) → JSON 응답을 받는다. */
export async function runCodexJson<T>(prompt: string, timeoutMs = 90_000): Promise<T> {
  const cmd = codexCmd()
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn('sh', ['-c', cmd], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('codex CLI 타임아웃'))
    }, timeoutMs)

    child.stdout.on('data', d => { out += d.toString() })
    child.stderr.on('data', d => { err += d.toString() })
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(`codex CLI 종료코드 ${code}: ${err.slice(0, 500)}`))
      else resolve(out)
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })

  return extractJson<T>(stdout)
}
