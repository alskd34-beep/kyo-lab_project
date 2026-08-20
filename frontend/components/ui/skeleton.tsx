import { cn } from "@frontend/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "relative isolate overflow-hidden rounded-md bg-primary/[0.08]",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:bg-gradient-to-r before:from-transparent before:via-primary/[0.12] before:to-transparent",
        "before:animate-[skeleton-shimmer_1.8s_ease-in-out_infinite]",
        "motion-reduce:before:animate-none",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
