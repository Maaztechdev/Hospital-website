import * as React from "react"
import { Download, ScrollText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { formatDateTime } from "@/dashboard/lib/format"
import { api, type ApiUltrasoundAuditAction, type ApiUltrasoundAuditEntry, type ApiUltrasoundAuditFilters, type ApiUltrasoundAuditUser } from "@/lib/api"

const ACTION_LABELS: Record<ApiUltrasoundAuditAction, string> = {
  ULTRASOUND_ORDER_CREATED: "Order created",
  ULTRASOUND_ORDER_SCHEDULED: "Scheduled",
  ULTRASOUND_ORDER_ASSIGNED: "Technician assigned",
  ULTRASOUND_STATUS_CHANGED: "Status changed",
  ULTRASOUND_FINDINGS_EDITED: "Report edited",
  ULTRASOUND_REPORT_VERIFIED: "Report verified",
  ULTRASOUND_REPORT_AMENDED: "Report amended",
  ULTRASOUND_REPORT_PRINTED: "Report printed / reprinted",
  ULTRASOUND_IMAGES_ADDED: "Images added",
  ULTRASOUND_IMAGES_REMOVED: "Images removed",
  ULTRASOUND_ORDER_CANCELLED: "Order cancelled",
  ULTRASOUND_PRICE_DISCOUNT_CHANGED: "Price / discount changed",
  CREATE: "Order created (legacy)",
  UPDATE: "Updated (legacy)",
  STATUS_CHANGE: "Status changed (legacy)",
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function auditDetails(entry: ApiUltrasoundAuditEntry) {
  const previous = objectValue(entry.oldValuesJson)
  const next = objectValue(entry.newValuesJson)
  const previousStatus = previous?.status
  const nextStatus = next?.status
  if (typeof previousStatus === "string" && typeof nextStatus === "string") return `${previousStatus.replaceAll("_", " ")} → ${nextStatus.replaceAll("_", " ")}`
  if (entry.action === "ULTRASOUND_PRICE_DISCOUNT_CHANGED") {
    return `Fee ${String(previous?.feeAmount ?? "—")} → ${String(next?.feeAmount ?? "—")}; discount ${String(previous?.discountAmount ?? "—")} → ${String(next?.discountAmount ?? "—")}`
  }
  if (entry.action === "ULTRASOUND_REPORT_PRINTED") return next?.reprint ? `Reprint #${String(next.printNumber)}` : "First print"
  if (entry.reason) return entry.reason
  return next ? Object.keys(next).join(", ") : "Audit event recorded"
}

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export default function UltrasoundAuditTrailPage() {
  const [entries, setEntries] = React.useState<ApiUltrasoundAuditEntry[]>([])
  const [users, setUsers] = React.useState<ApiUltrasoundAuditUser[]>([])
  const [search, setSearch] = React.useState("")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [userId, setUserId] = React.useState("")
  const [action, setAction] = React.useState<ApiUltrasoundAuditAction | "">("")
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [exporting, setExporting] = React.useState(false)
  const [error, setError] = React.useState("")
  const limit = 50

  React.useEffect(() => {
    api.listUltrasoundAuditUsers().then(setUsers).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load audit users"))
  }, [])

  React.useEffect(() => { setPage(1) }, [search, from, to, userId, action])

  const filters: ApiUltrasoundAuditFilters = React.useMemo(() => ({
    from: from || undefined,
    to: to || undefined,
    userId: userId || undefined,
    action: action || undefined,
    search: search.trim() || undefined,
  }), [from, to, userId, action, search])

  React.useEffect(() => {
    let active = true
    setLoading(true)
    setError("")
    const timer = window.setTimeout(() => {
      api.getUltrasoundAuditTrail({ ...filters, page, limit })
        .then((result) => {
          if (!active) return
          setEntries(result.items)
          setTotal(result.total)
        })
        .catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : "Unable to load Ultrasound audit trail")
        })
        .finally(() => { if (active) setLoading(false) })
    }, 200)
    return () => { active = false; window.clearTimeout(timer) }
  }, [filters, page])

  const exportCsv = async () => {
    setExporting(true)
    setError("")
    try {
      const allEntries: ApiUltrasoundAuditEntry[] = []
      const firstPage = await api.getUltrasoundAuditTrail({ ...filters, page: 1, limit: 100 })
      allEntries.push(...firstPage.items)
      const pages = Math.ceil(firstPage.total / 100)
      for (let currentPage = 2; currentPage <= pages; currentPage += 1) {
        const result = await api.getUltrasoundAuditTrail({ ...filters, page: currentPage, limit: 100 })
        allEntries.push(...result.items)
      }
      const headers = ["Timestamp", "Order ID", "Patient", "MR Number", "Action", "User", "Role", "Details", "Reason"]
      const rows = allEntries.map((entry) => [
        entry.createdAt,
        entry.entityId,
        entry.order ? `${entry.order.patient.firstName} ${entry.order.patient.lastName}` : "",
        entry.order?.patient.mrNumber,
        ACTION_LABELS[entry.action],
        entry.user?.name ?? "Former user",
        entry.userRole ?? entry.user?.role ?? "",
        auditDetails(entry),
        entry.reason,
      ])
      const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }))
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = "ultrasound-audit-trail.csv"
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to export audit trail")
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  return <div className="flex flex-col gap-4">
    <DashboardPageHeader title="Ultrasound Audit Trail" action={<Button variant="outline" onClick={() => void exportCsv()} disabled={exporting || total === 0}><Download className="h-4 w-4" />{exporting ? "Preparing CSV…" : "Export CSV"}</Button>} />
    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">Search<input className="mt-1 w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 py-2 text-sm" placeholder="Patient, MR number, order, or user" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">From date<input className="mt-1 w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 py-2 text-sm" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">To date<input className="mt-1 w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 py-2 text-sm" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">User<select className="mt-1 w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 py-2 text-sm" value={userId} onChange={(event) => setUserId(event.target.value)}><option value="">All users</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role.replaceAll("_", " ")}</option>)}</select></label>
      <label className="text-xs font-semibold text-[var(--cp-ink-soft)]">Action<select className="mt-1 w-full rounded-lg border border-[var(--cp-border)] bg-white px-3 py-2 text-sm" value={action} onChange={(event) => setAction(event.target.value as ApiUltrasoundAuditAction | "")}><option value="">All actions</option>{Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </CardContent></Card>

    {error && <p role="alert" className="rounded-lg border border-[var(--cp-critical)] bg-[var(--cp-critical-light)] px-3 py-2 text-sm text-[var(--cp-critical)]">{error}</p>}

    <Card><CardContent className="overflow-x-auto p-0">
      {loading ? <p role="status" className="p-8 text-center text-sm text-[var(--cp-ink-soft)]">Loading audit trail…</p> : entries.length === 0 ? <div className="p-10 text-center text-sm text-[var(--cp-ink-soft)]"><ScrollText className="mx-auto mb-2 h-7 w-7" />No audit entries match these filters.</div> : <table className="w-full min-w-[900px] text-left text-sm">
        <thead><tr className="border-b border-[var(--cp-border)] bg-[var(--cp-surface-warm)] text-xs text-[var(--cp-ink-soft)]"><th className="p-3">Timestamp</th><th className="p-3">Order / Patient</th><th className="p-3">Action</th><th className="p-3">User</th><th className="p-3">Details</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id} className="border-b border-[var(--cp-border)] last:border-0">
          <td className="whitespace-nowrap p-3 font-mono text-xs">{formatDateTime(entry.createdAt)}</td>
          <td className="p-3"><span className="font-medium">{entry.order ? `${entry.order.patient.firstName} ${entry.order.patient.lastName}` : "Order unavailable"}</span><span className="block text-xs text-[var(--cp-ink-soft)]">{entry.order?.patient.mrNumber ?? entry.entityId} · {entry.order?.examType ?? "Ultrasound"}</span></td>
          <td className="p-3"><span className="rounded-full bg-[var(--cp-primary-light)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-primary)]">{ACTION_LABELS[entry.action]}</span></td>
          <td className="p-3">{entry.user?.name ?? "Former user"}<span className="block text-xs capitalize text-[var(--cp-ink-soft)]">{(entry.userRole ?? entry.user?.role)?.replaceAll("_", " ").toLowerCase() ?? "Unknown role"}</span></td>
          <td className="max-w-sm p-3"><span className="line-clamp-2">{auditDetails(entry)}</span>{entry.reason && <span className="mt-1 block text-xs text-[var(--cp-ink-soft)]">Reason: {entry.reason}</span>}</td>
        </tr>)}</tbody>
      </table>}
      <div className="flex items-center justify-between border-t border-[var(--cp-border)] px-4 py-3 text-sm"><span className="text-[var(--cp-ink-soft)]">{total} audit entries</span><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</Button><span className="text-xs text-[var(--cp-ink-soft)]">Page {page} of {totalPages}</span><Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>
    </CardContent></Card>
  </div>
}
