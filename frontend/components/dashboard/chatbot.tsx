'use client'

import { useState, useRef, useEffect } from 'react'
import { X, Send, Sparkles, MoreVertical, Bot } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  id: string
  role: 'user' | 'bot'
  content: string
  time: string
  streaming?: boolean
}

function nowTime() {
  return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function todayLabel() {
  return new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Chatbot() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [conversationId, setConversationId] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    if (!open) return
    setTimeout(() => inputRef.current?.focus(), 100)
    if (messages.length > 0) return

    // 가장 최근 대화 복원 시도. 실패하거나 이력이 없으면 환영 메시지.
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/chat/history')
        if (!r.ok) throw new Error()
        const { conversations } = (await r.json()) as {
          conversations: { id: string; difyConvId: string | null }[]
        }
        const latest = conversations?.[0]
        if (!latest) throw new Error('no history')

        const m = await fetch(`/api/chat/history?conversationId=${latest.id}`)
        if (!m.ok) throw new Error()
        const { messages: stored } = (await m.json()) as {
          messages: { id: string; role: 'user' | 'bot'; content: string; createdAt: string }[]
        }
        if (cancelled || stored.length === 0) throw new Error('empty')

        setMessages(
          stored.map(s => ({
            id:      s.id,
            role:    s.role,
            content: s.content,
            time:    new Date(s.createdAt).toLocaleTimeString('ko-KR', {
              hour: '2-digit', minute: '2-digit', hour12: false,
            }),
          })),
        )
        if (latest.difyConvId) setConversationId(latest.difyConvId)
      } catch {
        if (cancelled) return
        setMessages([
          {
            id: 'welcome',
            role: 'bot',
            content:
              'KD QC 어시스턴트입니다.\n시험 현황, 원료, 제품, 안정성 시험 등 QC 업무에 대해 질문해주세요.',
            time: nowTime(),
          },
        ])
      }
    })()

    return () => { cancelled = true }
  }, [open, messages.length])

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || isStreaming) return
    setInput('')

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, time: nowTime() }
    const botId = `bot-${Date.now()}`
    const botMsg: Message = { id: botId, role: 'bot', content: '', time: nowTime(), streaming: true }

    setMessages(prev => [...prev, userMsg, botMsg])
    setIsStreaming(true)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationId }),
        signal: abort.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '알 수 없는 오류' }))
        setMessages(prev =>
          prev.map(m =>
            m.id === botId
              ? { ...m, content: err.error ?? '오류가 발생했습니다.', streaming: false }
              : m,
          ),
        )
        return
      }

      // SSE streaming parse
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let localConvId = conversationId
      let localBotText = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (!data || data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data) as {
              event?: string
              answer?: string
              conversation_id?: string
            }
            if (parsed.event === 'message' && parsed.answer) {
              localBotText += parsed.answer
              setMessages(prev =>
                prev.map(m =>
                  m.id === botId ? { ...m, content: m.content + parsed.answer } : m,
                ),
              )
            }
            if (parsed.conversation_id && !localConvId) {
              localConvId = parsed.conversation_id
              setConversationId(parsed.conversation_id)
            }
          } catch {}
        }
      }

      // 대화 이력 영속화 (Supabase 미연결 시 서버에서 무시됨)
      if (localBotText && localConvId) {
        fetch('/api/chat/history', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            difyConvId: localConvId,
            userText:   text,
            botText:    localBotText,
          }),
        }).catch(() => {})
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev =>
          prev.map(m =>
            m.id === botId ? { ...m, content: '연결 오류가 발생했습니다.', streaming: false } : m,
          ),
        )
      }
    } finally {
      setMessages(prev => prev.map(m => (m.id === botId ? { ...m, streaming: false } : m)))
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleClose = () => {
    abortRef.current?.abort()
    setOpen(false)
  }

  const resetConversation = () => {
    abortRef.current?.abort()
    setMessages([])
    setConversationId('')
    setIsStreaming(false)
    setTimeout(() => setOpen(true), 50)
  }

  return (
    <>
      {/* ── Floating Button ───────────────────────────────────────────────── */}
      <button
        onClick={() => (open ? handleClose() : setOpen(true))}
        className="fixed bottom-6 right-6 z-[60] flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95"
        style={{
          background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
          boxShadow: '0 0 0 0 rgba(37, 99, 235, 0.4)',
          animation: open ? 'none' : 'chatbotPulse 2.5s ease-in-out infinite',
        }}
        title="KD QC 어시스턴트"
      >
        {open ? (
          <X size={22} className="text-white" />
        ) : (
          <Sparkles size={22} className="text-white" style={{ animation: 'sparkleWiggle 3s ease-in-out infinite' }} />
        )}
      </button>

      {/* ── Chat Panel ──────────────────────────────────────────────────────
          Responsive layout:
          - Mobile (<768px):  full-screen modal (inset-0).
          - Tablet (md, ≥768): larger floating panel (440 x 70vh, capped 600px).
          - Desktop (lg, ≥1024): preserves original 360x560 side-panel layout.
          Visibility is driven by `open` via opacity/transform; sizing is CSS-driven.
      */}
      <div
        className={`
          fixed z-[55] flex flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300
          inset-0 rounded-none border-0
          md:inset-auto md:bottom-24 md:right-6 md:rounded-2xl md:border md:border-slate-200
          md:w-[440px] md:h-[70vh] md:max-h-[600px]
          lg:w-[360px] lg:h-auto lg:max-h-[560px]
        `}
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'all' : 'none',
          transform: open ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.97)',
          transformOrigin: 'bottom right',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3.5 shrink-0"
        style={{ background: 'linear-gradient(135deg, #2563eb 0%, #059669 100%)' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
              <Bot size={16} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">KD QC 어시스턴트</p>
              <p className="text-[11px] text-blue-200 leading-none mt-0.5">
                {isStreaming ? (
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                    응답 중...
                  </span>
                ) : (
                  'AI 기반 QC 도우미'
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={resetConversation}
              className="rounded-full p-1.5 text-white/60 hover:bg-white/15 hover:text-white transition-colors"
              title="대화 초기화"
            >
              <MoreVertical size={16} />
            </button>
            <button
              onClick={handleClose}
              className="rounded-full p-1.5 text-white/60 hover:bg-white/15 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Date label */}
        <div className="flex items-center justify-center py-2 shrink-0">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-500">
            {todayLabel()}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-1 space-y-3">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {msg.role === 'bot' && (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-emerald-600 mt-0.5">
                  <Bot size={13} className="text-white" />
                </div>
              )}
              <div className={`flex flex-col gap-1 max-w-[76%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : 'bg-slate-100 text-slate-800 rounded-tl-sm'
                  }`}
                >
                  {msg.content}
                  {msg.streaming && !msg.content && (
                    <span className="inline-flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:300ms]" />
                    </span>
                  )}
                  {msg.streaming && msg.content && (
                    <span className="ml-1 inline-block h-3 w-0.5 bg-slate-500 animate-pulse align-text-bottom" />
                  )}
                </div>
                <span className="text-[10px] text-slate-400 px-1">{msg.time}</span>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-slate-100 px-3 py-2.5">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isStreaming ? '응답 중...' : '질문을 입력하세요...'}
              disabled={isStreaming}
              className="flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isStreaming}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white transition-all hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            >
              <Send size={13} />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-slate-400">
            AI가 생성한 답변은 부정확할 수 있습니다
          </p>
        </div>
      </div>

      {/* ── CSS Animations ────────────────────────────────────────────────── */}
      <style>{`
        @keyframes chatbotPulse {
          0%, 100% { box-shadow: 0 4px 24px rgba(37,99,235,0.5), 0 0 0 0 rgba(37,99,235,0.4); }
          50%       { box-shadow: 0 4px 24px rgba(37,99,235,0.5), 0 0 0 12px rgba(37,99,235,0); }
        }
        @keyframes sparkleWiggle {
          0%, 100% { transform: rotate(0deg) scale(1); }
          25%       { transform: rotate(-8deg) scale(1.1); }
          75%       { transform: rotate(8deg) scale(1.1); }
        }
      `}</style>
    </>
  )
}
