import * as React from "react"
import { Search, X, AlignJustify, Rows3, AlertTriangle, Inbox, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"

/* ------------------------------ EmptyState ------------------------------ */

export function EmptyState({
  icon: Icon = Inbox,
  title = "Nothing here yet",
  description = "Records will appear here once available.",
  action,
}: {
  icon?: LucideIcon
  title?: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--cp-border-strong)] bg-[var(--cp-surface)] px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--cp-primary-light)]">
        <Icon className="h-5 w-5 text-[var(--cp-primary)]" />
      </div>
      <h3 className="mb-1 text-sm font-semibold text-[var(--cp-ink)]">{title}</h3>
      <p className="max-w-xs text-xs text-[var(--cp-ink-soft)]">{description}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

/* ---------------------------- FilterBar ---------------------------- */

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  children,
  showDensityToggle,
}: {
  search?: string
  onSearchChange?: (v: string) => void
  searchPlaceholder?: string
  children?: React.ReactNode
  showDensityToggle?: boolean
}) {
  const { tableDensity, dispatch } = useDashboard()
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-3 sm:flex-row sm:flex-wrap sm:items-center">
      {onSearchChange && (
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cp-ink-faint)]" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-10 w-full rounded-lg border border-[var(--cp-border)] bg-[var(--cp-bg)] pl-9 pr-8 text-sm text-[var(--cp-ink)] placeholder:text-[var(--cp-ink-faint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--cp-ink-faint)] hover:text-[var(--cp-ink)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {showDensityToggle && (
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-[var(--cp-border)] p-0.5">
          <button
            onClick={() => dispatch({ type: "SET_DENSITY", density: "compact" })}
            aria-label="Compact density"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md",
              tableDensity === "compact" ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)]"
            )}
          >
            <AlignJustify className="h-4 w-4" />
          </button>
          <button
            onClick={() => dispatch({ type: "SET_DENSITY", density: "comfortable" })}
            aria-label="Comfortable density"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md",
              tableDensity === "comfortable" ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)]"
            )}
          >
            <Rows3 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

export function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  label: string
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-bg)] px-3 text-sm text-[var(--cp-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/* ------------------------------- Modal ------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
  size?: "sm" | "md" | "lg" | "xl"
}) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [open, onClose])

  if (!open) return null

  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-2xl", xl: "max-w-4xl" }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-4">
      <div className="animate-[cp-fade-in_0.18s_ease-out] fixed inset-0 bg-[var(--cp-ink)]/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cp-modal-title"
        className={cn(
          "animate-[cp-slide-in_0.22s_cubic-bezier(0.16,1,0.3,1)] relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] shadow-2xl sm:rounded-2xl",
          widths[size]
        )}
      >
        <div className="flex items-start justify-between border-b border-[var(--cp-border)] px-5 py-4">
          <div>
            <h2 id="cp-modal-title" className="text-base font-bold text-[var(--cp-ink)]">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-[var(--cp-ink-soft)]">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-[var(--cp-ink-faint)] hover:bg-[var(--cp-bg)] hover:text-[var(--cp-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="cp-scrollbar overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

/* --------------------------- ConfirmDialog --------------------------- */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  requireReason,
  reasonLabel = "Reason",
  reasonPlaceholder = "Add a short reason…",
}: {
  open: boolean
  onClose: () => void
  onConfirm: (reason?: string) => void
  title: string
  description: string
  confirmLabel?: string
  destructive?: boolean
  requireReason?: boolean
  reasonLabel?: string
  reasonPlaceholder?: string
}) {
  const [reason, setReason] = React.useState("")

  React.useEffect(() => {
    if (open) setReason("")
  }, [open])

  if (!open) return null

  const disabled = requireReason && reason.trim().length === 0

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          {destructive && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cp-critical-light)] text-[var(--cp-critical)]">
              <AlertTriangle className="h-5 w-5" />
            </span>
          )}
          <p className="text-sm text-[var(--cp-ink-soft)]">{description}</p>
        </div>
        {requireReason && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--cp-ink)]">{reasonLabel}</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              className="min-h-20 w-full rounded-lg border border-[var(--cp-border)] bg-[var(--cp-bg)] px-3 py-2 text-sm text-[var(--cp-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"
            />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant={destructive ? "emergency" : "primary"}
            size="sm"
            disabled={disabled}
            onClick={() => onConfirm(requireReason ? reason.trim() : undefined)}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ----------------------------- Skeletons ----------------------------- */

export function SkeletonBedTile() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-3">
      <div className="h-7 w-7 animate-pulse rounded-lg bg-[var(--cp-border)]" />
      <div className="h-3.5 w-12 animate-pulse rounded bg-[var(--cp-border)]" />
      <div className="h-2.5 w-8 animate-pulse rounded bg-[var(--cp-border)]" />
    </div>
  )
}

export function SkeletonBedBoard({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => <SkeletonBedTile key={i} />)}
    </div>
  )
}

export function SkeletonTimelineItem() {
  return (
    <div className="relative flex items-start gap-3 pl-5">
      <div className="absolute left-0 top-0.5 h-6 w-6 animate-pulse rounded-full bg-[var(--cp-border)]" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-32 animate-pulse rounded bg-[var(--cp-border)]" />
        <div className="h-2.5 w-48 animate-pulse rounded bg-[var(--cp-border)]" />
      </div>
    </div>
  )
}

/* ------------------------------- Tabs -------------------------------- */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[]
  active: string
  onChange: (t: string) => void
}) {
  return (
    <div role="tablist" className="cp-scrollbar flex gap-1 overflow-x-auto border-b border-[var(--cp-border)]">
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={active === t}
          onClick={() => onChange(t)}
          className={cn(
            "shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]",
            active === t
              ? "border-[var(--cp-primary)] text-[var(--cp-primary)]"
              : "border-transparent text-[var(--cp-ink-soft)] hover:text-[var(--cp-ink)]"
          )}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------ FormField ------------------------------ */

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{message}</p>
}
