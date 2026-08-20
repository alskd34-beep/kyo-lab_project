import type { LucideIcon } from 'lucide-react'
import { Construction } from 'lucide-react'
import { Tag } from '@frontend/components/ui/tag'

/** 아직 구현되지 않은 메뉴 화면에 공통으로 쓰는 준비중 안내. */
export function ComingSoon({
  title,
  description = '빠른 시일 내에 제공될 예정입니다.',
  icon: Icon = Construction,
}: {
  title: string
  description?: string
  icon?: LucideIcon
}) {
  return (
    <div className="flex h-full w-full items-center justify-center p-10">
      <div className="flex flex-col items-center text-center">
        <div className="flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Icon size={20} />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-700">{title}</h1>
        <Tag color="slate" size="md" className="mt-3">예정 기능</Tag>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  )
}
