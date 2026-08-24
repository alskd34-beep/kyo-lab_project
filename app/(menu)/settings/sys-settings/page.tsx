'use client'

import { useId, useState } from 'react'
import { useAuth } from '@frontend/lib/auth-context'
import { Lock, Save } from 'lucide-react'
import { Button } from '@frontend/components/ui/button'
import { Card } from '@frontend/components/ui/card'
import { Input } from '@frontend/components/ui/input'
import { cn } from '@frontend/lib/utils'

export default function SysSettingsPage() {
  const { user, logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next1,   setNext1]   = useState('')
  const [next2,   setNext2]   = useState('')
  const [busy,    setBusy]    = useState(false)
  const [msg,     setMsg]     = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (next1 !== next2) { setMsg({ type: 'err', text: '새 비밀번호가 일치하지 않습니다.' }); return }
    if (next1.length < 4) { setMsg({ type: 'err', text: '비밀번호는 4자 이상이어야 합니다.' }); return }

    setBusy(true)
    const r = await fetch('/api/auth/change-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ currentPassword: current, newPassword: next1 }),
    })
    setBusy(false)
    if (!r.ok) {
      const { error } = await r.json().catch(() => ({ error: '변경 실패' }))
      setMsg({ type: 'err', text: error ?? '변경 실패' })
      return
    }
    setMsg({ type: 'ok', text: '비밀번호가 변경되었습니다. 다시 로그인해주세요.' })
    setCurrent(''); setNext1(''); setNext2('')
    setTimeout(() => { void logout() }, 1500)
  }

  return (
    /* min-h-0 · flex-1 · overflow-y-auto: 본문 영역이 overflow-hidden 이라 화면 스스로 스크롤을 가져야 한다. */
    <div className="mx-auto flex min-h-0 w-full max-w-xl min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {/* 부제 자리에 화면 이름을 되풀이하지 않는다 — 지금 누구 계정을 고치는지가 실제 정보다. */}
      <header className="flex min-w-0 shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold text-foreground">시스템 설정</h1>
        <p className="text-xs leading-normal text-muted-foreground">
          로그인 사용자 <span className="font-medium text-foreground">{user?.username ?? '-'}</span>
        </p>
      </header>

      {/* shrink-0: Card 는 overflow-hidden 이라 flex 열 안에서 높이가 0 으로 눌린다. */}
      <Card className="shrink-0 gap-0 py-0">
        <div className="flex items-center gap-1.5 border-b px-4 py-3">
          <Lock size={15} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">비밀번호 변경</h2>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-4">
          <Field label="현재 비밀번호" value={current} onChange={setCurrent} type="password" />
          <Field label="새 비밀번호"   value={next1}   onChange={setNext1}   type="password" />
          <Field label="새 비밀번호 확인" value={next2} onChange={setNext2} type="password" />

          {/* 성공 알림 초록은 CLAUDE.md 가 명시한 브랜드색 예외다(성공 토스트와 같은 색을 쓴다) */}
          {msg && (
            <p className={cn(
              'rounded-md border px-3 py-2 text-xs break-keep',
              msg.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                : 'border-destructive/20 bg-destructive/10 text-destructive',
            )}>{msg.text}</p>
          )}

          <Button
            type="submit"
            size="lg"
            disabled={busy || !current || !next1 || !next2}
            className="self-start"
          >
            <Save />
            {busy ? '변경 중…' : '비밀번호 변경'}
          </Button>
        </form>
      </Card>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <Input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
