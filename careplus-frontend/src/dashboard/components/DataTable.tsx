import * as React from "react"
import { ChevronUp, ChevronDown, Inbox, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { SemanticTone } from "@/dashboard/components/StatusBadge"

export interface DataTableColumn<T> {
  key: string
  header: string
  render: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number
  className?: string
  hideOnMobile?: boolean
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading,
  emptyIcon: EmptyIcon = Inbox,
  emptyTitle = "Nothing here yet",
  emptyDescription = "Records will appear here once available.",
  onRowClick,
  rowTone,
  pageSize = 8,
}: {
  columns: DataTableColumn<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  loading?: boolean
  emptyIcon?: LucideIcon
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?: (row: T) => void
  rowTone?: (row: T) => SemanticTone
  pageSize?: number
}) {
  const { tableDensity } = useDashboard()
  const [sortKey, setSortKey] = React.useState<string | null>(null)
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc")
  const [page, setPage] = React.useState(0)

  React.useEffect(() => setPage(0), [rows.length])

  const sorted = React.useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sortValue) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (av < bv) return sortDir === "asc" ? -1 : 1
      if (av > bv) return sortDir === "asc" ? 1 : -1
      return 0
    })
    return copy
  }, [rows, sortKey, sortDir, columns])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paged = sorted.slice(page * pageSize, page * pageSize + pageSize)
  const cellPad = tableDensity === "compact" ? "px-3 py-2.5" : "px-4 py-4"

  function toggleSort(col: DataTableColumn<T>) {
    if (!col.sortValue) return
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(col.key)
      setSortDir("asc")
    }
  }

  const stripBg: Record<SemanticTone, string> = {
    success: "before:bg-[var(--cp-success)]",
    warning: "before:bg-[var(--cp-warning)]",
    critical: "before:bg-[var(--cp-critical)]",
    info: "before:bg-[var(--cp-info)]",
    neutral: "before:bg-[var(--cp-neutral)]",
    accent: "before:bg-[var(--cp-accent)]",
  }

  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)]">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4 border-b border-[var(--cp-border)] px-4 py-4 last:border-0">
            {columns.map((c) => (
              <div key={c.key} className="h-4 flex-1 animate-pulse rounded bg-[var(--cp-border)]" />
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--cp-border-strong)] bg-[var(--cp-surface)] px-6 py-14 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--cp-primary-light)]">
          <EmptyIcon className="h-5 w-5 text-[var(--cp-primary)]" />
        </div>
        <h3 className="mb-1 text-sm font-semibold text-[var(--cp-ink)]">{emptyTitle}</h3>
        <p className="max-w-xs text-xs text-[var(--cp-ink-soft)]">{emptyDescription}</p>
      </div>
    )
  }

  return (
    <div>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] sm:block cp-scrollbar">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--cp-border)] bg-[var(--cp-surface-warm)]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col)}
                  className={cn(
                    "text-left text-xs font-semibold uppercase tracking-wide text-[var(--cp-ink-soft)]",
                    cellPad,
                    col.sortValue && "cursor-pointer select-none hover:text-[var(--cp-ink)]",
                    col.className
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {sortKey === col.key && (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row) => (
              <tr
                key={getRowKey(row)}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  "relative border-b border-[var(--cp-border)] last:border-0 transition-colors",
                  onRowClick && "cursor-pointer hover:bg-[var(--cp-primary-light)]/40",
                  rowTone && "before:absolute before:left-0 before:top-0 before:h-full before:w-1",
                  rowTone && stripBg[rowTone(row)]
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn(cellPad, "text-[var(--cp-ink)]", col.className)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <div className="flex flex-col gap-3 sm:hidden">
        {paged.map((row) => (
          <div
            key={getRowKey(row)}
            onClick={() => onRowClick?.(row)}
            className={cn(
              "relative overflow-hidden rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4 pl-5 cp-shadow",
              onRowClick && "cursor-pointer active:bg-[var(--cp-primary-light)]/40"
            )}
          >
            {rowTone && <span className={cn("absolute left-0 top-0 h-full w-1", stripBg[rowTone(row)].replace("before:", ""))} />}
            <dl className="flex flex-col gap-2">
              {columns.filter((c) => !c.hideOnMobile).map((col) => (
                <div key={col.key} className="flex items-center justify-between gap-3">
                  <dt className="text-xs font-medium text-[var(--cp-ink-soft)]">{col.header}</dt>
                  <dd className="text-right text-sm text-[var(--cp-ink)]">{col.render(row)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between px-1">
          <span className="text-xs text-[var(--cp-ink-soft)]">
            Page {page + 1} of {totalPages} · {sorted.length} records
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-[var(--cp-border)] px-3 py-1.5 text-xs font-medium text-[var(--cp-ink)] disabled:opacity-40 hover:enabled:border-[var(--cp-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-lg border border-[var(--cp-border)] px-3 py-1.5 text-xs font-medium text-[var(--cp-ink)] disabled:opacity-40 hover:enabled:border-[var(--cp-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
