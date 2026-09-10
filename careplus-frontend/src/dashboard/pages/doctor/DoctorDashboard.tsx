import { useNavigate, useSearchParams } from "react-router-dom"
import { Users, Hourglass, CheckCircle2, FlaskConical, CalendarClock, Stethoscope } from "lucide-react"
import { StatCard } from "@/dashboard/components/StatCard"
import { DataTable } from "@/dashboard/components/DataTable"
import { StatusBadge, toneFor } from "@/dashboard/components/StatusBadge"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useDashboard } from "@/dashboard/store/DashboardContext"

export default function DoctorDashboard() {
  const { appointments, labOrders, currentUser } = useDashboard()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const prefillMR = params.get("mr")

  const today = new Date().toISOString().slice(0, 10)
  // In this demo build the logged-in doctor sees all doctors' queues for visibility.
  const todays = appointments.filter((a) => a.date === today)
  const waiting = todays.filter((a) => a.status === "Waiting")
  const completed = todays.filter((a) => a.status === "Done")
  const pendingLabs = labOrders.filter((l) => l.status !== "Verified")

  return (
    <div className="flex flex-col gap-6">
      <DashboardPageHeader title={`Welcome back, ${currentUser?.name ?? "Doctor"}`} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Today's Patients" value={todays.length.toString()} icon={Users} tone="primary" />
        <StatCard label="Waiting" value={waiting.length.toString()} icon={Hourglass} tone="warning" />
        <StatCard label="Completed" value={completed.length.toString()} icon={CheckCircle2} tone="success" />
        <StatCard label="Pending Lab Results" value={pendingLabs.length.toString()} icon={FlaskConical} tone="warning" />
        <StatCard label="Follow-up Reminders" value="4" icon={CalendarClock} tone="primary" />
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
            getRowKey={(a) => a.id}
            emptyIcon={Stethoscope}
            emptyTitle="No patients today"
            rowTone={(a) => toneFor(a.status)}
            onRowClick={(a) => navigate(`/dashboard/doctor/consultation/${a.id}?mr=${a.mrNumber}`)}
            columns={[
              { key: "token", header: "Token", render: (a) => <span className="cp-tabular font-semibold">#{a.token}</span> },
              { key: "patient", header: "Patient", render: (a) => <div><p className="font-medium">{a.patientName}</p><p className="cp-tabular text-xs text-[var(--cp-ink-faint)]">{a.mrNumber}</p></div> },
              { key: "doctor", header: "Doctor", render: (a) => a.doctorName, hideOnMobile: true },
              { key: "time", header: "Time", render: (a) => a.time },
              { key: "status", header: "Status", render: (a) => <StatusBadge status={a.status} /> },
              {
                key: "action", header: "Action", render: (a) => (
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/doctor/consultation/${a.id}?mr=${a.mrNumber}`) }}
                    className="rounded-lg border border-[var(--cp-border)] px-2.5 py-1 text-xs font-semibold text-[var(--cp-primary)] hover:bg-[var(--cp-primary-light)]"
                  >
                    Consult
                  </button>
                ),
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  )
}
