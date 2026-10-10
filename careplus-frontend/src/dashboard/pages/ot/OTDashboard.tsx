import * as React from "react"
import { Syringe, CalendarClock, CheckCircle2, AlertTriangle, Plus, ChevronLeft, ChevronRight } from "lucide-react"
import { StatCard } from "@/dashboard/components/StatCard"
import { DashboardPageHeader } from "@/dashboard/components/Layout"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { OT_ROOMS } from "@/dashboard/data/wardData"
import { ScheduleSurgeryModal } from "@/dashboard/pages/ot/ScheduleSurgeryModal"
import { OT_STATUS_META } from "@/dashboard/pages/ot/otStatusMeta"
import { formatDate, formatWeekday, getHospitalDateKey, getLocalDateKey } from "@/dashboard/lib/format"
import { cn } from "@/lib/utils"
import { api, type ApiOTSummary } from "@/lib/api"
import { useToast } from "@/hooks/use-toast"
import SurgeryDetail from "@/dashboard/pages/ot/SurgeryDetail"

function startOfWeek(d: Date) {
  const date = new Date(d)
  const day = date.getDay()
  const diff = date.getDate() - day
  date.setDate(diff)
  date.setHours(0, 0, 0, 0)
  return date
}

export default function OTDashboard() {
  const { surgeries } = useDashboard()
  const { toast } = useToast()
  const [weekAnchor, setWeekAnchor] = React.useState(new Date())
  const [scheduleOpen, setScheduleOpen] = React.useState(false)
  const [selectedSurgeryId, setSelectedSurgeryId] = React.useState<string | null>(null)
  const [summary, setSummary] = React.useState<ApiOTSummary | null>(null)

  const weekStart = startOfWeek(weekAnchor)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })

  const todayStr = getHospitalDateKey()
  const dayStr = getLocalDateKey

  React.useEffect(() => {
    let active = true
    api.getOTSummary().then((data) => { if (active) setSummary(data) }).catch((error: Error) => {
      if (active) toast({ title: "Unable to load OT summary", description: error.message, variant: "error" })
    })
    return () => { active = false }
  }, [surgeries, toast])

  return (
    <div className="flex flex-col gap-4">
      <DashboardPageHeader
        title="Operation Theatre"
        action={<Button size="sm" onClick={() => setScheduleOpen(true)}><Plus className="h-4 w-4" /> Schedule Surgery</Button>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Today's Surgeries" value={summary?.todaysSurgeries.toString() ?? "—"} icon={CalendarClock} tone="primary" />
        <StatCard label="In Progress" value={summary?.inProgress.toString() ?? "—"} icon={Syringe} tone="critical" />
        <StatCard label="Completed Today" value={summary?.completedToday.toString() ?? "—"} icon={CheckCircle2} tone="success" />
        <StatCard label="Conflicts" value={summary?.conflicts.toString() ?? "—"} icon={AlertTriangle} tone="warning" />
      </div>

      <div className="rounded-xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-bold text-[var(--cp-ink)]">Week View — {formatDate(getLocalDateKey(weekStart))} to {formatDate(getLocalDateKey(days[6]))}</p>
          <div className="flex items-center gap-1">
            <button onClick={() => setWeekAnchor((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })} className="rounded-lg p-1.5 text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)]"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => setWeekAnchor(new Date())} className="rounded-lg px-2 py-1 text-xs font-medium text-[var(--cp-primary)] hover:bg-[var(--cp-primary-light)]">Today</button>
            <button onClick={() => setWeekAnchor((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })} className="rounded-lg p-1.5 text-[var(--cp-ink-soft)] hover:bg-[var(--cp-bg)]"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="cp-scrollbar overflow-x-auto">
          <div className="grid min-w-[900px] grid-cols-[80px_repeat(7,1fr)] gap-px rounded-lg bg-[var(--cp-border)]">
            <div className="bg-[var(--cp-surface)] p-2" />
            {days.map((d) => (
              <div key={d.toISOString()} className={cn("bg-[var(--cp-surface)] p-2 text-center", dayStr(d) === todayStr && "bg-[var(--cp-primary-light)]")}>
                <p className="text-[11px] font-semibold text-[var(--cp-ink-soft)]">{formatWeekday(getLocalDateKey(d))}</p>
                <p className="cp-tabular text-sm font-bold text-[var(--cp-ink)]">{d.getDate()}</p>
              </div>
            ))}
            {OT_ROOMS.map((room) => (
              <React.Fragment key={room}>
                <div className="flex items-center justify-center bg-[var(--cp-surface-warm)] p-2 text-xs font-semibold text-[var(--cp-ink)]">{room}</div>
                {days.map((d) => {
                  const dStr = dayStr(d)
                  const daySurgeries = surgeries.filter((s) => s.otRoom === room && s.scheduledDate === dStr)
                  return (
                    <div key={dStr + room} className="flex min-h-[64px] flex-col gap-1 bg-[var(--cp-surface)] p-1.5">
                      {daySurgeries.map((s) => {
                        const meta = OT_STATUS_META[s.status]
                        return (
                          <button
                            key={s.id}
                            onClick={() => setSelectedSurgeryId(s.id)}
                            aria-label={`${s.scheduledTime} ${s.patientName} — ${s.procedureName}`}
                            title={s.procedureName}
                            className={cn(
                              "rounded-md px-2 py-1 text-left text-[11px] font-medium leading-tight transition-transform hover:-translate-y-0.5",
                              meta.bg, meta.tone,
                              s.status === "Cancelled" && "line-through opacity-60",
                              s.status === "In Progress" && "animate-cp-glow-critical"
                            )}
                          >
                            <span className="flex items-center gap-1"><span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />{s.scheduledTime}</span>
                            <span className="block truncate">{s.patientName}</span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-3">
          {(Object.keys(OT_STATUS_META) as (keyof typeof OT_STATUS_META)[]).map((s) => (
            <span key={s} className="flex items-center gap-1.5 text-xs text-[var(--cp-ink-soft)]">
              <span className={cn("h-2 w-2 rounded-full", OT_STATUS_META[s].dot)} /> {s}
            </span>
          ))}
        </div>
      </div>

      <ScheduleSurgeryModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onScheduled={(scheduledDate) => {
          const [year, month, day] = scheduledDate.split("-").map(Number)
          setWeekAnchor(new Date(year, month - 1, day, 12))
        }}
      />
      {selectedSurgeryId && <SurgeryDetail surgeryId={selectedSurgeryId} onClose={() => setSelectedSurgeryId(null)} />}
    </div>
  )
}
