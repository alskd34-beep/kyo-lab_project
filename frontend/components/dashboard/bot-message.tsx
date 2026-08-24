'use client'

import { useMemo } from 'react'

/**
 * QCink 답변 렌더러.
 *
 * 답변은 보통 일반 문장과 아래 같은 목록이 섞여서 온다.
 *   - 품목 광동공진단(3.95G)(N)(25028) | 배치 26003 | 완료예정 2026-08-24 | 상태 대기
 * 이대로 흘려 쓰면 좁은 패널에서 줄이 계속 접혀 읽기 어렵다.
 * 파이프로 끊어진 줄은 카드로 접어 라벨/값을 나눠 보여주고, 나머지는 문단 그대로 둔다.
 */

interface Field {
  label: string
  value: string
}

interface ListItem {
  title: string
  fields: Field[]
}

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: ListItem[] }

/** `- `, `* `, `• ` 로 시작하는 목록 줄 */
const BULLET = /^\s*[-*•]\s+/
/** `라벨 값` 형태. 라벨은 짧은 한 덩어리(배치, 완료예정, 시험방법 …)로 본다. */
const LABELED = /^(\S{1,8})\s+(.+)$/

function parseField(part: string): Field {
  const m = part.match(LABELED)
  return m ? { label: m[1], value: m[2] } : { label: '', value: part }
}

function parseItem(line: string): ListItem {
  const parts = line.replace(BULLET, '').split('|').map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return { title: '', fields: [] }

  // 첫 칸은 항목의 이름이라 라벨(품목 등)을 떼고 값만 제목으로 쓴다.
  const [first, ...rest] = parts
  const head = parseField(first)
  return { title: head.value, fields: rest.map(parseField) }
}

/** 줄 단위로 훑어 목록 덩어리와 문단 덩어리로 나눈다. */
export function parseBotContent(content: string): Block[] {
  const blocks: Block[] = []
  let items: ListItem[] = []
  let lines: string[] = []

  const flushList = () => {
    if (items.length === 0) return
    blocks.push({ kind: 'list', items })
    items = []
  }
  const flushText = () => {
    const text = lines.join('\n').trim()
    lines = []
    if (text) blocks.push({ kind: 'text', text })
  }

  for (const line of content.split('\n')) {
    // 파이프가 있는 목록 줄만 카드로 만든다. 평범한 글머리 기호는 문단으로 둔다.
    if (BULLET.test(line) && line.includes('|')) {
      flushText()
      items.push(parseItem(line))
      continue
    }
    flushList()
    lines.push(line)
  }
  flushList()
  flushText()

  return blocks
}

/** `**강조**` 만 최소한으로 처리한다. */
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  )
}

export default function BotMessage({ content }: { content: string }) {
  const blocks = useMemo(() => parseBotContent(content), [content])

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, i) =>
        block.kind === 'text' ? (
          <p key={i} className="whitespace-pre-wrap break-words">
            {renderInline(block.text)}
          </p>
        ) : (
          <ul key={i} className="flex flex-col gap-1.5">
            {block.items.map((item, j) => (
              <li
                key={j}
                className="rounded-md border bg-card px-2.5 py-2 leading-snug"
              >
                <p className="font-semibold break-words text-foreground">{item.title}</p>
                {item.fields.length > 0 && (
                  <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {item.fields.map((field, k) => (
                      <div key={k} className="flex items-baseline gap-1">
                        {field.label && (
                          <dt className="text-xs text-muted-foreground">{field.label}</dt>
                        )}
                        <dd className="text-xs font-medium text-foreground">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}
