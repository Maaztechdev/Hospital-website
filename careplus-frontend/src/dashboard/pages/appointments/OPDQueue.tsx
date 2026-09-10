import * as React from "react"
import { PhoneCall, PlayCircle, CheckCircle2, SkipForward, RotateCcw, ListOrdered } from "lucide-react"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { FilterBar, FilterSelect } from "@/dashboard/components/Primitives"
import { StatusBadge, toneFor } from "@/dashboard/components/StatusBadge"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { formatWaitingTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import type { Appointment } from "@/dashboard/types"
import { cn } from "@/lib/utils"
import { api, type ApiError } from "@/lib/api"

export default function OPDQueue() {
  const { appointments, doctors, currentUser, dispatch } = useDashboard()
  const { toast } = useToast()
  const [doctorFilter, setDoctorFilter] = React.useState("all")
  const [pulseId, setPulseId] = React.useState<string | null>(null)
  const [, forceTick] = React.useState(0)

  React.useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const queue = appointments
    .filter((a) => a.date === today && ["Waiting", "In Consultation", "Confirmed"].includes(a.status))
    .filter((a) => doctorFilter === "all" || a.doctorId === doctorFilter)
    .sort((a, b) => {
      const order = { Emergency: 0, Urgent: 1, Routine: 2 } as const
      if (order[a.priority] !== order[b.priority]) return order[a.priority] - order[b.priority]
      return (a.waitingSince ?? "").localeCompare(b.waitingSince ?? "")
    })

  async function callNext(a: Appointment) {
    try {
      const updated = await api.callNext(a.doctorId)
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: updated.id, status: "Waiting" })
      setPulseId(a.id)
      toast({ title: `Calling ${a.patientName}`, description: `Token #${a.token} — please proceed to ${a.doctorName}'s room.`, variant: "info" })
      setTimeout(() => setPulseId(null), 2400)
    } catch (error) { toast({ title: "Unable to call patient", description: (error as ApiError).message, variant: "error" }) }
  }

  async function startConsultation(a: Appointment) {
    try { await api.startConsultation(a.id); dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: a.id, status: "In Consultation" }) }
    catch (error) { toast({ title: "Unable to start consultation", description: (error as ApiError).message, variant: "error" }) }
  }
  async function markDone(a: Appointment) {
    try {
      await api.markAppointmentDone(a.id); dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: a.id, status: "Done" })
      toast({ title: "Consultation completed", description: `${a.patientName} marked as done.`, variant: "success" })
    } catch (error) { toast({ title: "Unable to complete consultation", description: (error as ApiError).message, variant: "error" }) }
  }
  async function skip(a: Appointment) {
    try {
      await api.markAppointmentNoShow(a.id); dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: a.id, status: "No-show" })
      toast({ title: "Patient skipped", description: `${a.patientName} marked as no-show.`, variant: "info" })
    } catch (error) { toast({ title: "Unable to skip patient", description: (error as ApiError).message, variant: "error" }) }
  }
  async function reschedule(a: Appointment) {
    if (a.status !== "Confirmed") return
    const appointmentDate = window.prompt("New appointment date (YYYY-MM-DD)", a.date)
    if (!appointmentDate) return
    const timeSlot = window.prompt("New appointment time (HH:mm)", a.time)
    if (!timeSlot) return
    try {
      const updated = await api.rescheduleAppointment(a.id, appointmentDate, timeSlot)
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: updated.id, status: "Pending Approval" })
      toast({ title: "Appointment rescheduled", description: `${a.patientName}'s request is pending approval again.`, variant: "info" })
    } catch (error) { toast({ title: "Unable to reschedule patient", description: (error as ApiError).message, variant: "error" }) }
  }
  async function requeue(a: Appointment) {
    try {
      const updated = await api.requeue(a.id)
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: updated.id, status: "Confirmed" })
      toast({ title: "Patient requeued", description: `${a.patientName} returned to the confirmed queue.`, variant: "info" })
    } catch (error) { toast({ title: "Unable to requeue patient", description: (error as ApiError).message, variant: "error" }) }
  }

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader title="OPD Queue" />

      <FilterBar>
        <FilterSelect label="Doctor" value={doctorFilter} onChange={setDoctorFilter} options={[{ value: "all", label: "All doctors" }, ...doctors.map((d) => ({ value: d.id, label: d.name }))]} />
      </FilterBar>

      <div role="region" aria-live="polite" className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-ink)] p-2 sm:p-3">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white"><ListOrdered className="h-5 w-5" /></span>
            <p className="text-sm font-semibold text-white">Queue is empty</p>
            <p className="text-xs text-white/50">Waiting and confirmed patients for today will show up here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {queue.map((a) => (
              <div
                key={a.id}
                className={cn(
                  "relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] p-4 transition-colors",
                  pulseId === a.id && "animate-[cp-pulse_0.8s_ease-in-out_3]"
                )}
              >
                <span className={cn("absolute left-0 top-0 h-full w-1.5", {
                  success: "bg-[var(--cp-success)]", warning: "bg-[var(--cp-warning)]", critical: "bg-[var(--cp-critical)]",
                  info: "bg-[var(--cp-info)]", neutral: "bg-[var(--cp-neutral)]", accent: "bg-[var(--cp-accent)]",
                }[toneFor(a.status)])} />
                <div className="flex items-start justify-between">
                  <div>
                    <p className="cp-tabular text-2xl font-black text-white">#{a.token}</p>
                    <p className="text-sm font-semibold text-white">{a.patientName}</p>
                    <p className="text-xs text-white/60">{a.doctorName} · {a.type}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusBadge status={a.priority} />
                    <StatusBadge status={a.status} />
                  </div>
                </div>
                <p className="cp-tabular mt-3 text-xs text-white/60">
                  Waiting: <span className="font-semibold text-white">{a.status === "Waiting" ? formatWaitingTime(a.waitingSince) : "—"}</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {currentUser && ["admin", "receptionist", "doctor", "nurse"].includes(currentUser.role) && a.status === "Confirmed" && <button onClick={() => callNext(a)} className="inline-flex items-center gap-1 rounded-lg bg-[var(--cp-accent)] px-2.5 py-1.5 text-xs font-semibold text-white hover:brightness-110"><PhoneCall className="h-3.5 w-3.5" /> Call Next</button>}
                  {currentUser && ["admin", "doctor"].includes(currentUser.role) && a.status !== "In Consultation" && <button onClick={() => startConsultation(a)} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20"><PlayCircle className="h-3.5 w-3.5" /> Start</button>}
                  {currentUser && ["admin", "doctor"].includes(currentUser.role) && <button onClick={() => markDone(a)} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20"><CheckCircle2 className="h-3.5 w-3.5" /> Done</button>}
                  {currentUser && ["admin", "receptionist"].includes(currentUser.role) && <button onClick={() => skip(a)} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20"><SkipForward className="h-3.5 w-3.5" /> Skip</button>}
                  {currentUser && ["admin", "receptionist"].includes(currentUser.role) && a.status === "Confirmed" && <button onClick={() => reschedule(a)} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20"><RotateCcw className="h-3.5 w-3.5" /> Reschedule</button>}
                  {currentUser && ["admin", "receptionist", "nurse"].includes(currentUser.role) && a.status === "Waiting" && <button onClick={() => requeue(a)} className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20"><RotateCcw className="h-3.5 w-3.5" /> Requeue</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
