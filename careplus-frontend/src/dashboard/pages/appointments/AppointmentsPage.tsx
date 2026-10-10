import * as React from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { CalendarPlus, CalendarDays, List, Check, X, CalendarClock, Eye, CheckCircle2, RefreshCw, Ellipsis } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect, ConfirmDialog } from "@/dashboard/components/Primitives"
import { DataTable } from "@/dashboard/components/DataTable"
import { StatusBadge, toneFor } from "@/dashboard/components/StatusBadge"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { addDaysToDateKey, formatDate, getHospitalDateKey, weekdayIndexForDateKey } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { BookAppointmentModal } from "@/dashboard/pages/appointments/BookAppointmentModal"
import type { Appointment, Role } from "@/dashboard/types"
import { cn } from "@/lib/utils"
import { api, type ApiError } from "@/lib/api"

type AppointmentAction = "view" | "approve" | "reject" | "reschedule" | "cancel" | "complete"
type DateRange = "today" | "tomorrow" | "week" | "all"

function getDateRangeBounds(range: DateRange) {
  if (range === "all") return null
  let start = getHospitalDateKey()
  if (range === "tomorrow") start = addDaysToDateKey(start, 1)
  if (range === "week") start = addDaysToDateKey(start, -((weekdayIndexForDateKey(start) + 6) % 7))
  const end = addDaysToDateKey(start, range === "week" ? 7 : 1)
  return { start, end }
}

function parseDateRange(value: string | null): DateRange {
  return value === "tomorrow" || value === "week" || value === "all" ? value : "today"
}

function parsePageSize(value: string | null) {
  return value === "25" || value === "50" ? Number(value) : 10
}

function getAllowedActions(appointment: Appointment, role: Role | undefined): AppointmentAction[] {
  const actions: AppointmentAction[] = ["view"]
  const canManage = role === "admin" || role === "receptionist"

  if (appointment.status === "Pending Approval") {
    if (canManage || role === "doctor") actions.push("approve")
    if (canManage) actions.push("reject")
    return actions
  }
  if (appointment.status === "Confirmed") {
    if (canManage) actions.push("reschedule", "cancel")
    return actions
  }
  if (appointment.status === "Waiting") {
    if (canManage) actions.push("cancel")
    return actions
  }
  if (appointment.status === "In Consultation") {
    if (role === "admin" || role === "doctor") actions.push("complete")
  }
  return actions
}

export default function AppointmentsPage() {
  const { appointments, doctors, currentUser, dispatch, refreshAppointments, dataLoading } = useDashboard()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [view, setView] = React.useState<"list" | "calendar">("list")
  const [doctorFilter, setDoctorFilter] = React.useState(() => params.get("doctor") ?? "all")
  const [statusFilter, setStatusFilter] = React.useState(() => params.get("status") ?? "all")
  const [dateRange, setDateRange] = React.useState<DateRange>(() => parseDateRange(params.get("date")))
  const [sortBy, setSortBy] = React.useState<"date" | "recentlyCreated">(() => params.get("sort") === "recentlyCreated" ? "recentlyCreated" : "date")
  const [pageSize, setPageSize] = React.useState(() => parsePageSize(params.get("pageSize")))
  const [search, setSearch] = React.useState(() => params.get("q") ?? "")
  const [bookOpen, setBookOpen] = React.useState(false)
  const [highlightedAppointmentId, setHighlightedAppointmentId] = React.useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = React.useState<Appointment | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

  React.useEffect(() => {
    const next = new URLSearchParams(params)
    const values: Record<string, string> = {
      date: dateRange,
      doctor: doctorFilter,
      status: statusFilter,
      sort: sortBy,
      pageSize: String(pageSize),
      q: search.trim(),
    }
    for (const [key, value] of Object.entries(values)) {
      if (!value || (value === "all" && key !== "date")) next.delete(key)
      else next.set(key, value)
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true })
  }, [dateRange, doctorFilter, statusFilter, sortBy, pageSize, search, params, setParams])

  React.useEffect(() => {
    if (!currentUser) return
    const interval = window.setInterval(() => { void refreshAppointments(sortBy) }, 15_000)
    return () => window.clearInterval(interval)
  }, [currentUser, refreshAppointments, sortBy])

  async function refreshList() {
    setRefreshing(true)
    try {
      await refreshAppointments(sortBy)
      toast({ title: "Appointments refreshed", variant: "success" })
    } catch (error) {
      toast({ title: "Unable to refresh appointments", description: (error as ApiError).message, variant: "error" })
    } finally {
      setRefreshing(false)
    }
  }

  async function handleAppointmentBooked(appointmentId: string) {
    setSearch("")
    setDoctorFilter("all")
    setStatusFilter("all")
    setDateRange("all")
    setHighlightedAppointmentId(appointmentId)
    window.setTimeout(() => setHighlightedAppointmentId((current) => current === appointmentId ? null : current), 5_000)
    try {
      await refreshAppointments(sortBy)
    } catch (error) {
      toast({ title: "Appointment booked, but list refresh failed", description: (error as ApiError).message, variant: "error" })
    }
  }

  const filtered = React.useMemo(() => appointments.filter((a) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || a.patientName.toLowerCase().includes(q) || a.mrNumber.toLowerCase().includes(q)
    const matchesDoctor = doctorFilter === "all" || a.doctorId === doctorFilter
    const matchesStatus = statusFilter === "all" || a.status === statusFilter
    const bounds = getDateRangeBounds(dateRange)
    const matchesDate = !bounds || (a.date >= bounds.start && a.date < bounds.end)
    return matchesSearch && matchesDoctor && matchesStatus && matchesDate
  }), [appointments, search, doctorFilter, statusFilter, dateRange])

  const sortedAppointments = filtered

  async function approve(a: Appointment) {
    try {
      await api.approveAppointment(a.id)
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: a.id, status: "Confirmed" })
      toast({ title: "Appointment approved", description: `${a.patientName}'s request is now confirmed.`, variant: "success" })
    } catch (error) {
      toast({ title: "Unable to approve appointment", description: (error as ApiError).message, variant: "error" })
    }
  }

  async function reject(reason?: string) {
    if (!rejectTarget) return
    try {
      await api.rejectAppointment(rejectTarget.id, reason ?? "Rejected by staff")
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: rejectTarget.id, status: "Cancelled", rejectionReason: reason })
      toast({ title: "Appointment rejected", description: `${rejectTarget.patientName}'s request was declined.`, variant: "info" })
      setRejectTarget(null)
    } catch (error) {
      toast({ title: "Unable to reject appointment", description: (error as ApiError).message, variant: "error" })
    }
  }

  async function reschedule(a: Appointment) {
    const appointmentDate = window.prompt("New appointment date (YYYY-MM-DD)", a.date)
    if (!appointmentDate) return
    const timeSlot = window.prompt("New appointment time (HH:mm)", a.time)
    if (!timeSlot) return
    try {
      const updated = await api.rescheduleAppointment(a.id, appointmentDate, timeSlot)
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: updated.id, status: "Pending Approval" })
      toast({ title: "Appointment rescheduled", description: `${a.patientName}'s request is pending approval again.`, variant: "info" })
    } catch (error) {
      toast({ title: "Unable to reschedule appointment", description: (error as ApiError).message, variant: "error" })
    }
  }

  async function cancel(a: Appointment) {
    const reason = window.prompt("Reason for cancellation", "Cancelled by staff")
    if (!reason) return
    try {
      const updated = await api.cancelAppointment(a.id, reason)
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: updated.id, status: "Cancelled", rejectionReason: reason })
      toast({ title: "Appointment cancelled", description: `${a.patientName}'s appointment was cancelled.`, variant: "info" })
    } catch (error) {
      toast({ title: "Unable to cancel appointment", description: (error as ApiError).message, variant: "error" })
    }
  }

  // Simple week-based calendar grouping by date
  const byDate = React.useMemo(() => filtered.reduce<Record<string, Appointment[]>>((acc, a) => {
    (acc[a.date] ??= []).push(a)
    return acc
  }, {}), [filtered])
  const sortedDates = React.useMemo(() => Object.keys(byDate).sort(), [byDate])

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title="Appointments"
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void refreshList()} disabled={refreshing} title="Refresh appointments" aria-label="Refresh appointments">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} /> <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button size="sm" onClick={() => setBookOpen(true)}>
              <CalendarPlus className="h-4 w-4" /> Book Appointment
            </Button>
          </div>
        }
      />

      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search patient or MR number…">
        <FilterSelect label="Doctor" value={doctorFilter} onChange={setDoctorFilter} options={[{ value: "all", label: "All doctors" }, ...doctors.map((d) => ({ value: d.id, label: d.name }))]} />
        <FilterSelect label="Sort" value={sortBy} onChange={(value) => {
          const nextSort = value as "date" | "recentlyCreated"
          setSortBy(nextSort)
          setRefreshing(true)
          void refreshAppointments(nextSort).catch((error) => toast({ title: "Unable to sort appointments", description: (error as ApiError).message, variant: "error" })).finally(() => setRefreshing(false))
        }} options={[{ value: "date", label: "Date" }, { value: "recentlyCreated", label: "Recently created" }]} />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: "All statuses" },
            { value: "Pending Approval", label: "Pending Approval" },
            { value: "Confirmed", label: "Confirmed" },
            { value: "Waiting", label: "Waiting" },
            { value: "In Consultation", label: "In Consultation" },
            { value: "Done", label: "Done" },
            { value: "Cancelled", label: "Cancelled" },
            { value: "Expired", label: "Expired" },
            { value: "No-show", label: "No-show" },
          ]}
        />
        <div className="flex h-10 items-center gap-0.5 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-bg)] p-0.5" aria-label="Appointment date range">
          {(["today", "tomorrow", "week", "all"] as const).map((range) => (
            <button key={range} type="button" aria-pressed={dateRange === range} onClick={() => setDateRange(range)} className={cn("h-8 rounded-md px-2.5 text-xs font-medium capitalize", dateRange === range ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)] hover:bg-[var(--cp-surface)]")}>{range === "week" ? "This Week" : range[0].toUpperCase() + range.slice(1)}</button>
          ))}
        </div>
        <div className="ml-auto flex gap-1 rounded-lg border border-[var(--cp-border)] p-0.5">
          <button onClick={() => setView("list")} className={cn("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium", view === "list" ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)]")}><List className="h-3.5 w-3.5" /> List</button>
          <button onClick={() => setView("calendar")} className={cn("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium", view === "calendar" ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)]")}><CalendarDays className="h-3.5 w-3.5" /> Calendar</button>
        </div>
      </FilterBar>

      {view === "list" ? (
        <>
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <p className="text-sm font-medium text-[var(--cp-ink-soft)]">{filtered.length} {filtered.length === 1 ? "appointment" : "appointments"}</p>
          <label className="flex items-center gap-2 text-xs font-medium text-[var(--cp-ink-soft)]">
            Rows per page
            <select aria-label="Rows per page" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-9 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-bg)] px-2.5 text-sm text-[var(--cp-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]">
              {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>
        <DataTable
          rows={sortedAppointments}
          getRowKey={(a) => a.id}
          loading={dataLoading}
          pageSize={pageSize}
          emptyIcon={CalendarClock}
          emptyTitle="No appointments found"
          emptyDescription="Try a different filter, or book a new appointment."
          rowTone={(a) => toneFor(a.status)}
          mobileTable
          highlightRowKey={highlightedAppointmentId}
          resetPageKey={`${sortBy}:${dateRange}:${doctorFilter}:${statusFilter}:${search}:${pageSize}`}
          columns={[
            { key: "token", header: <span title="Tokens are assigned per doctor per day and may change after rescheduling.">Token</span>, className: "w-[70px] min-w-[70px] whitespace-nowrap", render: (a) => <span className="cp-tabular font-semibold" title={`Token #${a.token}; assigned per doctor per day`}>#{a.token}</span> },
            { key: "patient", header: "Patient", className: "w-[220px] min-w-[220px]", render: (a) => <div className="min-w-0"><p className="max-w-[180px] truncate whitespace-nowrap font-medium" title={a.patientName}>{a.patientName}</p><p className="cp-tabular whitespace-nowrap text-xs text-[var(--cp-ink-faint)]">{a.mrNumber}</p></div> },
            { key: "doctor", header: "Doctor", className: "w-[180px] min-w-[180px] whitespace-nowrap", render: (a) => a.doctorName, hideOnMobile: true },
            { key: "date", header: "Date & Time", className: "w-[170px] min-w-[170px] whitespace-nowrap", render: (a) => <span className="cp-tabular whitespace-nowrap">{formatDate(a.date)}, {a.time}</span> },
            { key: "priority", header: "Priority", className: "w-[100px] min-w-[100px] whitespace-nowrap", render: (a) => <StatusBadge status={a.priority} />, hideOnMobile: true },
            { key: "status", header: "Status", render: (a) => (
              <div className="flex flex-col gap-1">
                <StatusBadge status={a.status} />
                {a.status === "Cancelled" && a.rejectionReason && <span className="text-[10px] text-[var(--cp-ink-faint)]">{a.rejectionReason}</span>}
              </div>
            ), className: "w-[150px] min-w-[150px]" },
            {
              key: "actions", header: "Actions", render: (a) => {
                const allowedActions = getAllowedActions(a, currentUser?.role)
                const can = (action: AppointmentAction) => allowedActions.includes(action)

                return (
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    {can("view") && <button type="button" aria-label="View patient" title="View patient" onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/patients/${a.mrNumber}`) }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--cp-border)] text-[var(--cp-primary)] hover:bg-[var(--cp-primary-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"><Eye className="h-4 w-4" /></button>}
                    {can("approve") && <button type="button" aria-label="Approve appointment" title="Approve appointment" onClick={(e) => { e.stopPropagation(); approve(a) }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--cp-success-light)] text-[var(--cp-success)] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-success)]"><Check className="h-4 w-4" /></button>}
                    {can("reject") && <button type="button" aria-label="Reject appointment" title="Reject appointment" onClick={(e) => { e.stopPropagation(); setRejectTarget(a) }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--cp-critical-light)] text-[var(--cp-critical)] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-critical)]"><X className="h-4 w-4" /></button>}
                    {can("reschedule") && <button type="button" aria-label="Reschedule appointment" title="Reschedule appointment" onClick={(e) => { e.stopPropagation(); reschedule(a) }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--cp-primary-light)] text-[var(--cp-primary)] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]"><CalendarClock className="h-4 w-4" /></button>}
                    {can("complete") && <button type="button" aria-label="Complete appointment" title="Complete appointment" onClick={async (e) => { e.stopPropagation(); try { await api.markAppointmentDone(a.id); dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: a.id, status: "Done" }); toast({ title: "Appointment completed", variant: "success" }) } catch (error) { toast({ title: "Unable to complete appointment", description: (error as ApiError).message, variant: "error" }) } }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--cp-success-light)] text-[var(--cp-success)] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-success)]"><CheckCircle2 className="h-4 w-4" /></button>}
                    {can("cancel") && <details className="relative shrink-0">
                      <summary aria-label="More appointment actions" title="More actions" onClick={(e) => e.stopPropagation()} className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md border border-[var(--cp-border)] text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)] [&::-webkit-details-marker]:hidden"><Ellipsis className="h-4 w-4" /></summary>
                      <div role="menu" className="absolute right-0 top-full z-50 mt-1 flex min-w-40 flex-col rounded-md border border-[var(--cp-border)] bg-[var(--cp-surface)] p-1 shadow-lg">
                        <button type="button" role="menuitem" onClick={(e) => { e.stopPropagation(); e.currentTarget.closest("details")?.removeAttribute("open"); cancel(a) }} className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm text-[var(--cp-critical)] hover:bg-[var(--cp-bg)]"><X className="h-4 w-4" /> Cancel</button>
                      </div>
                    </details>}
                  </div>
                )
              },
            },
          ]}
        />
        </>
      ) : (
        <div className="flex flex-col gap-4">
          {sortedDates.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--cp-border-strong)] bg-[var(--cp-surface)] px-6 py-14 text-center text-sm text-[var(--cp-ink-soft)]">No appointments in range.</div>
          )}
          {sortedDates.map((date) => (
            <div key={date} className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4">
              <p className="mb-3 text-sm font-bold text-[var(--cp-ink)]">{formatDate(date)}</p>
              <div className="flex flex-col gap-2">
                {byDate[date].sort((a, b) => a.time.localeCompare(b.time)).map((a) => (
                  <div key={a.id} className="relative flex items-center justify-between gap-3 overflow-hidden rounded-lg border border-[var(--cp-border)] p-3 pl-4">
                    <span className={cn("absolute left-0 top-0 h-full w-1", {
                      success: "bg-[var(--cp-success)]", warning: "bg-[var(--cp-warning)]", critical: "bg-[var(--cp-critical)]",
                      info: "bg-[var(--cp-info)]", neutral: "bg-[var(--cp-neutral)]", accent: "bg-[var(--cp-accent)]",
                    }[toneFor(a.status)])} />
                    <div>
                      <p className="cp-tabular text-xs font-semibold text-[var(--cp-ink-soft)]">{a.time}</p>
                      <p className="text-sm font-medium text-[var(--cp-ink)]">{a.patientName} — {a.doctorName}</p>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <BookAppointmentModal open={bookOpen} onClose={() => setBookOpen(false)} onBooked={(id) => { void handleAppointmentBooked(id) }} prefillMR={params.get("mr") ?? undefined} />

      <ConfirmDialog
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={reject}
        title="Reject appointment request"
        description={`Reject ${rejectTarget?.patientName}'s request with ${rejectTarget?.doctorName}? The patient will need to be notified separately.`}
        confirmLabel="Reject Request"
        destructive
        requireReason
        reasonLabel="Reason for rejection"
        reasonPlaceholder="e.g. Doctor unavailable at requested time"
      />
    </div>
  )
}
