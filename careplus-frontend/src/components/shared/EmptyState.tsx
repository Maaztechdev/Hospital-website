import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border-soft)] bg-white px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-primary-light)]">
        <Icon className="h-6 w-6 text-[var(--color-primary)]" />
      </div>
      <h3 className="mb-1.5 font-[var(--font-display)] text-lg font-bold text-[var(--color-ink)]">{title}</h3>
      <p className="mb-5 max-w-sm text-sm text-[var(--color-ink-soft)]">{description}</p>
      {actionLabel && onAction && (
        <Button variant="outline" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
