import * as React from "react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect, EmptyState } from "@/dashboard/components/Primitives"
import { DataTable } from "@/dashboard/components/DataTable"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { formatDateTime } from "@/dashboard/lib/format"
import { api, type ApiError } from "@/lib/api"
import { ScrollText } from "lucide-react"
import type { AuditActionType, AuditLogEntry } from "@/dashboard/types"

const ACTION_META: Record<string, string> = {
  Created: "bg-[var(--cp-info-light)] text-[var(--cp-info)]",
  Updated: "bg-[var(--cp-warning-light)] text-[var(--cp-warning)]",
  Voided: "bg-[var(--cp-critical-light)] text-[var(--cp-critical)]",
  Deleted: "bg-[var(--cp-critical-light)] text-[var(--cp-critical)]",
}

export default function AuditLogsPage() {
  const { auditLogs: initialAuditLogs } = useDashboard()
  const [auditLogs, setAuditLogs] = React.useState<AuditLogEntry[]>(initialAuditLogs)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")
  const [actionType, setActionType] = React.useState("all")
  const [entity, setEntity] = React.useState("all")

  React.useEffect(() => {
    api.listAuditLogs()
      .then((entries) => setAuditLogs(entries.map((entry) => ({
        id: entry.id,
        actionType: entry.action as AuditActionType,
        action: entry.action,
        entity: entry.entityType,
        entityId: entry.entityId,
        by: entry.user?.name ?? "System",
        role: entry.user?.role ?? "System",
        date: entry.createdAt,
        details: typeof entry.details === "string" ? entry.details : undefined,
      }))))
      .catch((error: ApiError) => setLoadError(error.message || "Unable to load audit logs"))
  }, [])

  const entities = React.useMemo(() => [...new Set(auditLogs.map((l) => l.entity))], [auditLogs])

  const filtered = React.useMemo(() => auditLogs.filter((l) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || l.action.toLowerCase().includes(q) || l.by.toLowerCase().includes(q) || l.entityId.toLowerCase().includes(q) || l.details?.toLowerCase().includes(q)
    const matchesAction = actionType === "all" || l.actionType === actionType
    const matchesEntity = entity === "all" || l.entity === entity
    return matchesSearch && matchesAction && matchesEntity
  }), [auditLogs, search, actionType, entity])

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="Audit Logs" />

      {loadError && <p className="rounded-lg bg-[var(--cp-critical-light)] px-3 py-2 text-sm text-[var(--cp-critical)]">{loadError}</p>}

      <div className="sticky top-16 z-20 sm:top-[68px]">
        <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search by action, staff, or entity ID…">
          <FilterSelect label="Action" value={actionType} onChange={setActionType} options={[{ value: "all", label: "All actions" }, { value: "Created", label: "Created" }, { value: "Updated", label: "Updated" }, { value: "Voided", label: "Voided" }, { value: "Deleted", label: "Deleted" }]} />
          <FilterSelect label="Entity" value={entity} onChange={setEntity} options={[{ value: "all", label: "All entities" }, ...entities.map((e) => ({ value: e, label: e }))]} />
        </FilterBar>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries match" description="Adjust your filters or search terms." />
      ) : (
        <DataTable
          rows={filtered}
          getRowKey={(log) => log.id}
          pageSize={25}
          emptyIcon={ScrollText}
          columns={[
            { key: "timestamp", header: "Timestamp", render: (log) => <span className="cp-tabular font-mono text-xs text-[var(--cp-ink-soft)]">{formatDateTime(log.date)}</span>, sortValue: (log) => log.date },
            { key: "action", header: "Action", render: (log) => <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${ACTION_META[log.actionType] ?? "bg-[var(--cp-bg)] text-[var(--cp-ink-soft)]"}`}>{log.actionType}</span>, sortValue: (log) => log.actionType },
            { key: "entity", header: "Entity", render: (log) => <span className="font-mono text-xs">{log.entity} <span className="text-[var(--cp-ink-faint)]">#{log.entityId}</span></span>, sortValue: (log) => log.entity },
            { key: "details", header: "Details", render: (log) => log.details ?? log.action },
            { key: "by", header: "By", render: (log) => <span>{log.by} <span className="text-xs text-[var(--cp-ink-faint)]">({log.role})</span></span>, sortValue: (log) => log.by },
          ]}
        />
      )}
    </div>
  )
}
