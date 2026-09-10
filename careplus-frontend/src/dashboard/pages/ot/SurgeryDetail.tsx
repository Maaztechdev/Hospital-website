import * as React from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { ArrowLeft, User, Stethoscope, DoorOpen, CalendarClock, Clock3, CheckCircle2, Circle } from "lucide-react"
import { ConfirmDialog } from "@/dashboard/components/Primitives"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { OT_STATUS_META } from "@/dashboard/pages/ot/otStatusMeta"
import type { OTStatus } from "@/dashboard/types"
import { formatDateTime } from "@/dashboard/lib/format"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { api, toSurgery } from "@/lib/api"

const FLOW: OTStatus[] = ["Scheduled", "Pre-op", "In Progress", "Recovery", "Completed"]

export default function SurgeryDetail() {
  const { surgeryId } = useParams()
  const navigate = useNavigate()
  const { surgeries, dispatch } = useDashboard()
  const { toast } = useToast()
  const surgery = surgeries.find((s) => s.id === surgeryId)
  const [pendingStatus, setPendingStatus] = React.useState<OTStatus | null>(null)

  if (!surgery) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-[var(--cp-ink-soft)]">Surgery not found.</p>
        <Button size="sm" variant="outline" onClick={() => navigate("/dashboard/ot")}><ArrowLeft className="h-4 w-4" /> Back to OT Dashboard</Button>
      </div>
    )
  }

  const meta = OT_STATUS_META[surgery.status]
  const currentIdx = FLOW.indexOf(surgery.status)
  const checklistDone = surgery.preOpChecklist.filter((c) => c.done).length

  function confirmStatusChange() {
    if (!pendingStatus || !surgery) return
    const request = pendingStatus === "In Progress" ? api.startSurgery(surgery.id) : pendingStatus === "Recovery" ? api.moveSurgeryToRecovery(surgery.id) : pendingStatus === "Completed" ? api.completeSurgery(surgery.id) : Promise.reject(new Error("Unsupported transition"))
    request.then((updated) => api.getSurgery(updated.id)).then((updated) => {
      dispatch({ type: "SET_SURGERIES", surgeries: surgeries.map((item) => item.id === surgery.id ? { ...toSurgery(updated), mrNumber: surgery.mrNumber } : item) })
      toast({ title: "Status updated", description: `${surgery.procedureName} is now ${pendingStatus}.`, variant: "success" }); setPendingStatus(null)
    }).catch((error: Error) => toast({ title: "Unable to update status", description: error.message, variant: "error" }))
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to="/dashboard/ot" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-[var(--cp-primary)] hover:underline"><ArrowLeft className="h-4 w-4" /> Back to OT Dashboard</Link>

      {/* Header card */}
      <div className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-5 cp-shadow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-lg font-bold text-[var(--cp-ink)]">{surgery.procedureName}</p>
            <p className="text-sm text-[var(--cp-ink-soft)]">{surgery.patientName} · {surgery.mrNumber}</p>
          </div>
          <span className={cn("rounded-full px-3 py-1 text-xs font-bold", meta.bg, meta.tone, surgery.status === "In Progress" && "animate-cp-glow-critical")}>{surgery.status}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><Stethoscope className="h-4 w-4 text-[var(--cp-ink-faint)]" /> {surgery.surgeonName}</div>
          <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><DoorOpen className="h-4 w-4 text-[var(--cp-ink-faint)]" /> {surgery.otRoom}</div>
          <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><CalendarClock className="h-4 w-4 text-[var(--cp-ink-faint)]" /> {surgery.scheduledDate}</div>
          <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><Clock3 className="h-4 w-4 text-[var(--cp-ink-faint)]" /> {surgery.scheduledTime} · {surgery.durationMinutes} min</div>
        </div>
        {surgery.notes && <p className="mt-3 rounded-lg bg-[var(--cp-surface-warm)] p-3 text-sm text-[var(--cp-ink-soft)]">{surgery.notes}</p>}
      </div>

      {/* Status progress control */}
      {surgery.status !== "Cancelled" && (
        <div className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-5">
          <p className="mb-4 text-sm font-bold text-[var(--cp-ink)]">Surgery Status</p>
          <div className="flex items-center overflow-x-auto">
            {FLOW.map((step, i) => {
              const stepMeta = OT_STATUS_META[step]
              const isDone = i < currentIdx
              const isCurrent = i === currentIdx
              const isNext = i === currentIdx + 1
              return (
                <React.Fragment key={step}>
                  {i > 0 && <div className={cn("h-0.5 w-8 shrink-0 sm:w-16", i <= currentIdx ? "bg-[var(--cp-primary)]" : "bg-[var(--cp-border)]")} />}
                  <button
                    disabled={!isNext}
                    onClick={() => isNext && setPendingStatus(step)}
                    className={cn(
                      "flex shrink-0 flex-col items-center gap-1.5 rounded-lg px-2 py-1 transition-colors",
                      isNext && "cursor-pointer hover:bg-[var(--cp-primary-light)]"
                    )}
                  >
                    <span className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full border-2",
                      isDone && "border-[var(--cp-primary)] bg-[var(--cp-primary)] text-white",
                      isCurrent && cn("border-[var(--cp-primary)]", stepMeta.bg, stepMeta.tone),
                      !isDone && !isCurrent && "border-[var(--cp-border-strong)] text-[var(--cp-ink-faint)]"
                    )}>
                      {isDone ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                    </span>
                    <span className={cn("whitespace-nowrap text-[11px] font-semibold", isCurrent ? "text-[var(--cp-ink)]" : "text-[var(--cp-ink-faint)]")}>{step}</span>
                  </button>
                </React.Fragment>
              )
            })}
          </div>
          {currentIdx < FLOW.length - 1 && <p className="mt-3 text-xs text-[var(--cp-ink-faint)]">Click the next step to advance the surgery status.</p>}
        </div>
      )}

      {/* Pre-op checklist */}
      <div className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-bold text-[var(--cp-ink)]">Pre-op Checklist</p>
          <span className="cp-tabular rounded-full bg-[var(--cp-primary-light)] px-2.5 py-1 text-xs font-bold text-[var(--cp-primary)]">{checklistDone}/{surgery.preOpChecklist.length} complete</span>
        </div>
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--cp-border)]">
          <div className="h-full rounded-full bg-[var(--cp-primary)] transition-all duration-300" style={{ width: `${(checklistDone / surgery.preOpChecklist.length) * 100}%` }} />
        </div>
        <div className="flex flex-col gap-2">
          {surgery.preOpChecklist.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[var(--cp-border)] px-3 py-2.5 hover:bg-[var(--cp-surface-warm)]">
              <input type="checkbox" checked={item.done} onChange={() => api.updateSurgeryChecklist(surgery.id, { [item.id]: !item.done }).then((updated) => api.getSurgery(updated.id)).then((updated) => dispatch({ type: "SET_SURGERIES", surgeries: surgeries.map((entry) => entry.id === surgery.id ? { ...toSurgery(updated), mrNumber: surgery.mrNumber } : entry) })).catch((error: Error) => toast({ title: "Unable to update checklist", description: error.message, variant: "error" }))} className="h-4 w-4 rounded border-[var(--cp-border-strong)]" />
              <span className={cn("text-sm", item.done ? "text-[var(--cp-ink-faint)] line-through" : "text-[var(--cp-ink)]")}>{item.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Activity feed */}
      <div className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-5">
        <p className="mb-3 text-sm font-bold text-[var(--cp-ink)]">Activity Log</p>
        <div className="flex flex-col gap-3">
          {[...surgery.activityLog].reverse().map((a) => (
            <div key={a.id} className="flex items-start gap-3 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cp-primary)]" />
              <div>
                <p className="text-[var(--cp-ink)]">{a.action} <span className="text-[var(--cp-ink-soft)]">by {a.by}</span></p>
                <p className="cp-tabular text-xs text-[var(--cp-ink-faint)]">{formatDateTime(a.at)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingStatus}
        onClose={() => setPendingStatus(null)}
        onConfirm={confirmStatusChange}
        title="Confirm Status Change"
        description={`Move "${surgery.procedureName}" to ${pendingStatus}?`}
        confirmLabel="Confirm"
      />
    </div>
  )
}
