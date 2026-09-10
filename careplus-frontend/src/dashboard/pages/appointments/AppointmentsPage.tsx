import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { CalendarPlus, CalendarDays, List, Check, X, CalendarClock } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect, ConfirmDialog } from "@/dashboard/components/Primitives"
import { DataTable } from "@/dashboard/components/DataTable"
import { StatusBadge, toneFor } from "@/dashboard/components/StatusBadge"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { formatDate } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { BookAppointmentModal } from "@/dashboard/pages/appointments/BookAppointmentModal"
import type { Appointment } from "@/dashboard/types"
import { cn } from "@/lib/utils"
import { api, type ApiError } from "@/lib/api"

export default function AppointmentsPage() {
  const { appointments, doctors, currentUser, dispatch } = useDashboard()
  const { toast } = useToast()
  const [params] = useSearchParams()
  const [view, setView] = React.useState<"list" | "calendar">("list")
  const [doctorFilter, setDoctorFilter] = React.useState("all")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [dateFilter, setDateFilter] = React.useState("")
  const [search, setSearch] = React.useState("")
  const [bookOpen, setBookOpen] = React.useState(false)
  const [rejectTarget, setRejectTarget] = React.useState<Appointment | null>(null)

  const filtered = React.useMemo(() => appointments.filter((a) => {
    const q = search.trim().toLowerCase()
    const matchesSearch = !q || a.patientName.toLowerCase().includes(q) || a.mrNumber.toLowerCase().includes(q)
    const matchesDoctor = doctorFilter === "all" || a.doctorId === doctorFilter
    const matchesStatus = statusFilter === "all" || a.status === statusFilter
    const matchesDate = !dateFilter || a.date === dateFilter
    return matchesSearch && matchesDoctor && matchesStatus && matchesDate
  }), [appointments, search, doctorFilter, statusFilter, dateFilter])

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
          <Button size="sm" onClick={() => setBookOpen(true)}>
            <CalendarPlus className="h-4 w-4" /> Book Appointment
          </Button>
        }
      />

      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Search patient or MR number…">
        <FilterSelect label="Doctor" value={doctorFilter} onChange={setDoctorFilter} options={[{ value: "all", label: "All doctors" }, ...doctors.map((d) => ({ value: d.id, label: d.name }))]} />
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
            { value: "No-show", label: "No-show" },
          ]}
        />
        <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="h-10 rounded-lg border border-[var(--cp-border)] bg-[var(--cp-bg)] px-3 text-sm text-[var(--cp-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-primary)]" />
        <div className="ml-auto flex gap-1 rounded-lg border border-[var(--cp-border)] p-0.5">
          <button onClick={() => setView("list")} className={cn("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium", view === "list" ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)]")}><List className="h-3.5 w-3.5" /> List</button>
          <button onClick={() => setView("calendar")} className={cn("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium", view === "calendar" ? "bg-[var(--cp-primary)] text-white" : "text-[var(--cp-ink-soft)]")}><CalendarDays className="h-3.5 w-3.5" /> Calendar</button>
        </div>
      </FilterBar>

      {view === "list" ? (
        <DataTable
          rows={filtered}
          getRowKey={(a) => a.id}
          emptyIcon={CalendarClock}
          emptyTitle="No appointments found"
          emptyDescription="Try a different filter, or book a new appointment."
          rowTone={(a) => toneFor(a.status)}
          columns={[
            { key: "token", header: "Token", render: (a) => <span className="cp-tabular font-semibold">#{a.token}</span> },
            { key: "patient", header: "Patient", render: (a) => <div><p className="font-medium">{a.patientName}</p><p className="cp-tabular text-xs text-[var(--cp-ink-faint)]">{a.mrNumber}</p></div> },
            { key: "doctor", header: "Doctor", render: (a) => a.doctorName, hideOnMobile: true },
            { key: "date", header: "Date & Time", render: (a) => <span className="cp-tabular">{formatDate(a.date)}, {a.time}</span> },
            { key: "priority", header: "Priority", render: (a) => <StatusBadge status={a.priority} />, hideOnMobile: true },
            { key: "status", header: "Status", render: (a) => (
              <div className="flex flex-col gap-1">
                <StatusBadge status={a.status} />
                {a.status === "Cancelled" && a.rejectionReason && <span className="text-[10px] text-[var(--cp-ink-faint)]">{a.rejectionReason}</span>}
              </div>
            ) },
            {
              key: "actions", header: "Actions", render: (a) => (
                <div className="flex flex-wrap gap-1.5">
                  {a.status === "Pending Approval" && <>
                    <button onClick={(e) => { e.stopPropagation(); approve(a) }} className="inline-flex items-center gap-1 rounded-lg bg-[var(--cp-success-light)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-success)] hover:brightness-95"><Check className="h-3.5 w-3.5" /> Approve</button>
                    <button onClick={(e) => { e.stopPropagation(); setRejectTarget(a) }} className="inline-flex items-center gap-1 rounded-lg bg-[var(--cp-critical-light)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-critical)] hover:brightness-95"><X className="h-3.5 w-3.5" /> Reject</button>
                  </>}
                  {currentUser && ["admin", "receptionist"].includes(currentUser.role) && ["Pending Approval", "Confirmed"].includes(a.status) && <button onClick={(e) => { e.stopPropagation(); reschedule(a) }} className="inline-flex items-center gap-1 rounded-lg bg-[var(--cp-primary-light)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-primary)] hover:brightness-95"><CalendarClock className="h-3.5 w-3.5" /> Reschedule</button>}
                  {currentUser && ["admin", "receptionist"].includes(currentUser.role) && ["Pending Approval", "Confirmed", "Waiting", "In Consultation"].includes(a.status) && <button onClick={(e) => { e.stopPropagation(); cancel(a) }} className="inline-flex items-center gap-1 rounded-lg bg-[var(--cp-critical-light)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-critical)] hover:brightness-95"><X className="h-3.5 w-3.5" /> Cancel</button>}
                  {a.status !== "Pending Approval" && !(currentUser && ["admin", "receptionist"].includes(currentUser.role) && ["Pending Approval", "Confirmed", "Waiting", "In Consultation"].includes(a.status)) && <span className="text-xs text-[var(--cp-ink-faint)]">—</span>}
                </div>
              ),
            },
          ]}
        />
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

      <BookAppointmentModal open={bookOpen} onClose={() => setBookOpen(false)} prefillMR={params.get("mr") ?? undefined} prefillName={params.get("name") ?? undefined} />

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
