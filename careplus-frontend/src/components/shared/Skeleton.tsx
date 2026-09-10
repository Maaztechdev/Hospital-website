import { cn } from "@/lib/utils"

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-xl bg-gradient-to-r from-[var(--color-primary-light)] via-slate-100 to-[var(--color-primary-light)] bg-[length:200%_100%]",
        className
      )}
    />
  )
}

export function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-[var(--color-border-soft)] bg-white p-6">
      <Skeleton className="mb-4 h-10 w-10 rounded-xl" />
      <Skeleton className="mb-2 h-4 w-2/3" />
      <Skeleton className="mb-1.5 h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  )
}
