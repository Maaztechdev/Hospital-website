import type { LucideIcon } from "lucide-react"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  tone = "primary",
  onClick,
}: {
  label: string
  value: string
  icon: LucideIcon
  trend?: { value: string; direction: "up" | "down"; positive?: boolean }
  tone?: "primary" | "warning" | "critical" | "success"
  onClick?: () => void
}) {
  const toneClasses: Record<string, string> = {
    primary: "bg-[var(--cp-primary-light)] text-[var(--cp-primary)]",
    warning: "bg-[var(--cp-warning-light)] text-[var(--cp-warning)]",
    critical: "bg-[var(--cp-critical-light)] text-[var(--cp-critical)]",
    success: "bg-[var(--cp-success-light)] text-[var(--cp-success)]",
  }

  const Comp = onClick ? "button" : "div"

  return (
    <Comp
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-3 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4 text-left cp-shadow transition-all duration-200",
        onClick && "cursor-pointer hover:cp-shadow-hover hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-[var(--cp-ink-soft)]">{label}</span>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneClasses[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="flex items-end justify-between">
        <span className="cp-tabular text-2xl font-bold text-[var(--cp-ink)]">{value}</span>
        {trend && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-xs font-semibold",
              trend.positive === false ? "text-[var(--cp-critical)]" : "text-[var(--cp-success)]"
            )}
          >
            {trend.direction === "up" ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {trend.value}
          </span>
        )}
      </div>
    </Comp>
  )
}
