"use client"

import { CircleHelp } from "lucide-react"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@frontend/components/ui/popover"
import { METRIC_HELP, type MetricKey } from "@frontend/lib/metric-help"

export function MetricInfo({ metric }: { metric: MetricKey }) {
  const help = METRIC_HELP[metric]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${help.title} 계산 방식 보기`} className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <CircleHelp size={15} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverHeader><PopoverTitle>{help.title}</PopoverTitle></PopoverHeader>
        <PopoverDescription className="whitespace-pre-line leading-normal">{help.body}</PopoverDescription>
      </PopoverContent>
    </Popover>
  )
}
