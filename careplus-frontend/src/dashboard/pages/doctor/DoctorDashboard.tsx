import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Users, Hourglass, CheckCircle2, FlaskConical, CalendarClock, Stethoscope, BedDouble, OctagonAlert } from "lucide-react"
import { StatCard } from "@/dashboard/components/StatCard"
import { DataTable } from "@/dashboard/components/DataTable"
import { StatusBadge, toneFor } from "@/dashboard/components/StatusBadge"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { getHospitalDateKey } from "@/dashboard/lib/format"
import { api, type ApiDoctorWardRoundToday, type ApiError } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"

export default function DoctorDashboard() {
  const { appointments, labOrders, currentUser, doctors, refreshAppointments, dispatch } = useDashboard()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const prefillMR = params.get("mr")

  const ownDoctor = doctors.find((d) => d.userId === currentUser?.id)
  const [admittedPatients, setAdmittedPatients] = useState<ApiDoctorWardRoundToday[]>([])
  const [admissionsLoading, setAdmissionsLoading] = useState(false)
  const [admissionsError, setAdmissionsError] = useState("")

  const loadAdmittedPatients = useCallback(async () => {
    if (currentUser?.role !== "doctor") return
    setAdmissionsLoading(true)
    setAdmissionsError("")
    try {
      setAdmittedPatients(await api.getMyWardRoundsToday())
    } catch (error) {
      setAdmissionsError((error as ApiError).message)
    } finally {
      setAdmissionsLoading(false)
    }
  }, [currentUser?.role])

  const today = params.get("date") ?? getHospitalDateKey()

  useEffect(() => {
    void refreshAppointments("date", { date: today })
    const interval = window.setInterval(() => { void refreshAppointments("date", { date: today }) }, 30000)
    const handleInvalidation = () => {
      void refreshAppointments("date", { date: today })
      void loadAdmittedPatients()
    }
    window.addEventListener("careplus:data-invalidated", handleInvalidation)
    window.addEventListener("focus", handleInvalidation)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("careplus:data-invalidated", handleInvalidation)
      window.removeEventListener("focus", handleInvalidation)
    }
  }, [refreshAppointments, loadAdmittedPatients, today])
  useEffect(() => { void loadAdmittedPatients() }, [loadAdmittedPatients])

  async function handleCallNext() {
    try {
      if (!ownDoctor) {
        toast({ title: "No doctor profile", description: "You do not have a linked doctor profile.", variant: "error" })
        return
      }
      const nextAppt = await api.callNext(ownDoctor.id)
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: nextAppt.id, status: "Waiting" })
      void refreshAppointments("date", { date: today })
      navigate(`/dashboard/doctor/consultation/${nextAppt.id}?mr=${nextAppt.patient?.mrNumber ?? ""}`)
    } catch (error) {
      toast({ title: "No patients waiting", description: (error as ApiError).message ?? "Unable to call next patient.", variant: "info" })
    }
  }

  const todays = appointments.filter((a) => (a.date ? a.date.slice(0, 10) : "") === today)
  const waiting = todays.filter((a) => a.status === "Waiting")
  const completed = todays.filter((a) => a.status === "Done")
  const pendingLabs = labOrders.filter((l) => l.status !== "Verified")
  const abnormalLabs = labOrders.filter((order) => order.status !== "Cancelled" && order.interpretation && order.interpretation !== "Normal")
  const followUpReminders = appointments.filter((appointment) => appointment.type === "Follow-up" && appointment.date >= today).length

  async function handleRequeue(a: typeof todays[number]) {
    try {
      await api.requeue(a.id)
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: a.id, status: "Confirmed" })
      void refreshAppointments()
      toast({ title: "Patient requeued", description: `${a.patientName} returned to confirmed queue.`, variant: "info" })
    } catch (error) {
      toast({ title: "Unable to requeue", description: (error as ApiError).message, variant: "error" })
    }
  }

  async function handleNoShow(a: typeof todays[number]) {
    try {
      await api.markAppointmentNoShow(a.id)
      dispatch({ type: "UPDATE_APPOINTMENT_STATUS", id: a.id, status: "No-show" })
      void refreshAppointments()
      toast({ title: "Marked No-show", description: `${a.patientName} marked as no-show.`, variant: "info" })
    } catch (error) {
      toast({ title: "Unable to mark no-show", description: (error as ApiError).message, variant: "error" })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader
        title={`Welcome back, ${currentUser?.name ?? "Doctor"}`}
        action={
          <button
            onClick={handleCallNext}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--cp-primary)] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[var(--cp-primary-dark)]"
          >
            <Stethoscope className="h-4 w-4" />
            Call next patient
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Today's Patients" value={todays.length.toString()} icon={Users} tone="primary" />
        <StatCard label="Waiting" value={waiting.length.toString()} icon={Hourglass} tone="warning" />
        <StatCard label="Completed" value={completed.length.toString()} icon={CheckCircle2} tone="success" />
        <StatCard label="Pending Lab Results" value={pendingLabs.length.toString()} icon={FlaskConical} tone="warning" />
        <StatCard label="Follow-up Reminders" value={followUpReminders.toString()} icon={CalendarClock} tone="primary" />
      </div>

      {prefillMR && (
        <Card className="border-[var(--cp-primary)] bg-[var(--cp-primary-light)]">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm font-medium text-[var(--cp-primary)]">Start a new consultation for {prefillMR}?</p>
            <button onClick={() => navigate(`/dashboard/doctor/consultation/new?mr=${prefillMR}`)} className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-xs font-semibold text-white">Open Consultation</button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Today's Queue</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6">
          <DataTable
            rows={todays}
            pageSize={50}
            getRowKey={(a) => a.id}
            emptyIcon={Stethoscope}
            emptyTitle="No patients today"
            rowTone={(a) => toneFor(a.status)}
            onRowClick={(a) => navigate(`/dashboard/doctor/consultation/${a.id}?mr=${a.mrNumber}`)}
            columns={[
              { key: "token", header: "Token", render: (a) => <span className="cp-tabular font-semibold">#{a.token}</span> },
              { key: "patient", header: "Patient", render: (a) => <div><p className="font-medium">{a.patientName}</p><p className="cp-tabular text-xs text-[var(--cp-ink-faint)]">{a.mrNumber}{a.gender ? ` • ${a.gender}` : ""}{a.age != null ? ` (${a.age}y)` : ""}</p></div> },
              { key: "doctor", header: "Doctor", render: (a) => a.doctorName, hideOnMobile: true },
              { key: "time", header: "Time", render: (a) => a.time },
              { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
              {
                key: "action", header: "Action", render: (a) => (
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => navigate(`/dashboard/doctor/consultation/${a.id}?mr=${a.mrNumber}`)}
                      className="rounded-lg border border-[var(--cp-border)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-primary)] hover:bg-[var(--cp-primary-light)]"
                    >
                      Consult
                    </button>
                    {a.status === "Waiting" && (
                      <>
                        <button
                          onClick={() => void handleRequeue(a)}
                          className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-xs font-semibold text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)]"
                          title="Requeue patient"
                        >
                          Requeue
                        </button>
                        <button
                          onClick={() => void handleNoShow(a)}
                          className="rounded-lg border border-[var(--cp-border)] px-2 py-1 text-xs font-semibold text-[var(--cp-critical)] hover:bg-[var(--cp-critical-light)]"
                          title="Mark no-show"
                        >
                          No-show
                        </button>
                      </>
                    )}
                  </div>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2"><BedDouble className="h-5 w-5 text-[var(--cp-primary)]" /><CardTitle>My Admitted Patients</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {admissionsLoading ? <p role="status" className="text-sm text-[var(--cp-ink-soft)]">Loading admissions…</p>
              : admissionsError ? <div role="alert" className="flex items-center justify-between gap-3 text-sm text-[var(--cp-critical)]"><span>{admissionsError}</span><Button size="sm" variant="outline" onClick={() => void loadAdmittedPatients()}>Retry</Button></div>
              : admittedPatients.length ? admittedPatients.map((admission) => <div key={admission.id} className="rounded-lg border border-[var(--cp-border)] p-3">
                <span className="block font-semibold">{admission.patient.firstName} {admission.patient.lastName}</span>
                <span className="block text-xs text-[var(--cp-ink-soft)]">{admission.patient.mrNumber} · {admission.bed.ward}, Room {admission.bed.room}, Bed {admission.bed.bedNumber} · {admission.daysAdmitted === 0 ? "Today" : `${admission.daysAdmitted} day${admission.daysAdmitted === 1 ? "" : "s"} admitted`}</span>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${admission.roundDoneToday ? "bg-[var(--cp-success-light)] text-[var(--cp-success)]" : "bg-[var(--cp-warning-light)] text-[var(--cp-warning)]"}`}>{admission.roundDoneToday ? "Done today" : "Round pending"}</span>
                  <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/ward/round/${admission.id}`)}>{admission.roundDoneToday ? "Open round" : "Start round"}</Button>
                </div>
              </div>)
                : <p className="text-sm text-[var(--cp-ink-soft)]">No patients are currently admitted under your care.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2"><OctagonAlert className="h-5 w-5 text-[var(--cp-critical)]" /><CardTitle>Abnormal Lab Results</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {abnormalLabs.length ? abnormalLabs.map((order) => <button key={order.id} type="button" onClick={() => navigate(`/dashboard/lab/${order.id}`)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--cp-critical)]/40 bg-[var(--cp-critical-light)] p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-critical)]">
              <span><span className="block font-semibold">{order.patientName} · {order.testName}</span><span className="text-xs text-[var(--cp-ink-soft)]">{order.mrNumber} · {[order.resultValue, order.resultUnit].filter(Boolean).join(" ") || "Result needs review"}</span></span><StatusBadge status={order.interpretation ?? "Abnormal"} />
            </button>) : <p className="text-sm text-[var(--cp-ink-soft)]">No abnormal lab results need attention.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
