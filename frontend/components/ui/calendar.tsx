"use client"

import * as React from "react"
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type Locale,
} from "react-day-picker"

import { cn } from "@frontend/lib/utils"
import { Button, buttonVariants } from "@frontend/components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon } from "lucide-react"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "group/calendar bg-white p-4 rounded-2xl shadow-lg border border-slate-100",
        "[--cell-radius:var(--radius-md)] [--cell-size:--spacing(9)]",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString(locale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-3", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between",
          defaultClassNames.nav
        ),
        button_previous: cn(
          "size-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors select-none",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          "size-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors select-none",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-8 w-full items-center justify-center px-8",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-8 w-full items-center justify-center gap-1.5 text-sm font-semibold text-slate-800",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "relative rounded-(--cell-radius)",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "absolute inset-0 bg-popover opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "text-sm font-semibold text-slate-800 select-none",
          captionLayout !== "label" &&
            "flex items-center gap-1 rounded-(--cell-radius) [&>svg]:size-3.5 [&>svg]:text-muted-foreground",
          defaultClassNames.caption_label
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex mb-1", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 text-center text-[11px] font-semibold text-slate-400 uppercase tracking-wide select-none py-1",
          defaultClassNames.weekday
        ),
        week: cn("flex w-full", defaultClassNames.week),
        week_number_header: cn(
          "w-(--cell-size) select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "text-[0.8rem] text-muted-foreground select-none",
          defaultClassNames.week_number
        ),
        day: cn(
          "group/day relative flex-1 aspect-square p-0 text-center select-none",
          defaultClassNames.day
        ),
        range_start: cn(
          "relative isolate z-0 rounded-l-full bg-blue-50 after:absolute after:inset-y-1 after:right-0 after:w-3 after:bg-blue-50",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none bg-blue-50", defaultClassNames.range_middle),
        range_end: cn(
          "relative isolate z-0 rounded-r-full bg-blue-50 after:absolute after:inset-y-1 after:left-0 after:w-3 after:bg-blue-50",
          defaultClassNames.range_end
        ),
        today: cn(
          "rounded-full font-bold text-blue-600 data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
          "text-slate-300 aria-selected:text-slate-300",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-slate-300 opacity-50 cursor-not-allowed",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => (
          <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />
        ),
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left")
            return <ChevronLeftIcon className={cn("size-3.5", className)} {...props} />
          if (orientation === "right")
            return <ChevronRightIcon className={cn("size-3.5", className)} {...props} />
          return <ChevronDownIcon className={cn("size-3.5", className)} {...props} />
        },
        DayButton: ({ ...props }) => (
          <CalendarDayButton locale={locale} {...props} />
        ),
        WeekNumber: ({ children, ...props }) => (
          <td {...props}>
            <div className="flex size-(--cell-size) items-center justify-center text-center">
              {children}
            </div>
          </td>
        ),
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  const isSelected =
    modifiers.selected &&
    !modifiers.range_start &&
    !modifiers.range_end &&
    !modifiers.range_middle

  return (
    <button
      ref={ref}
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-selected-single={isSelected}
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      data-today={modifiers.today}
      className={cn(
        // base
        "relative isolate z-10 mx-auto flex aspect-square w-9 items-center justify-center rounded-full",
        "text-[13px] font-normal leading-none transition-all duration-150",
        "border-0 outline-none cursor-pointer select-none",
        // default hover
        "hover:bg-slate-100 hover:text-slate-800",
        // today — blue ring
        modifiers.today &&
          !modifiers.selected &&
          "text-blue-600 font-bold ring-2 ring-blue-400 ring-offset-1",
        // selected single — filled circle
        isSelected &&
          "bg-slate-800 text-white font-semibold hover:bg-slate-700 shadow-md ring-0",
        // range start/end
        (modifiers.range_start || modifiers.range_end) &&
          "bg-blue-600 text-white font-semibold hover:bg-blue-700 shadow-sm",
        // range middle
        modifiers.range_middle &&
          "rounded-none bg-blue-50 text-blue-700 hover:bg-blue-100",
        // outside days
        modifiers.outside && "text-slate-300 hover:text-slate-400 hover:bg-transparent",
        // disabled
        modifiers.disabled && "opacity-40 cursor-not-allowed hover:bg-transparent",
        // focused
        "group-data-[focused=true]/day:ring-2 group-data-[focused=true]/day:ring-slate-400 group-data-[focused=true]/day:ring-offset-1",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
