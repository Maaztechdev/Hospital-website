import * as React from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { ArrowLeft, User, Stethoscope, DoorOpen, CalendarClock, Clock3, X } from "lucide-react"
import { ConfirmDialog } from "@/dashboard/components/Primitives"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import { OT_STATUS_META } from "@/dashboard/pages/ot/otStatusMeta"
import type { Surgery } from "@/dashboard/types"
import { formatDateTime } from "@/dashboard/lib/format"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { api, toSurgery } from "@/lib/api"

type Props = { surgeryId?: string; onClose?: () => void }

export default function SurgeryDetail({ surgeryId: suppliedId, onClose }: Props = {}) {
  const route = useParams()
  const id = suppliedId ?? route.surgeryId
  const navigate = useNavigate()
  const { surgeries, dispatch } = useDashboard()
  const { toast } = useToast()
  const surgery = surgeries.find((item) => item.id === id)
  const [busy, setBusy] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [postponeOpen, setPostponeOpen] = React.useState(false)
  const [recoveryOpen, setRecoveryOpen] = React.useState(false)
  const [completeOpen, setCompleteOpen] = React.useState(false)
  const [overrideReason, setOverrideReason] = React.useState("")
  const [intraoperativeNotes, setIntraoperativeNotes] = React.useState("")
  const [outcomeNotes, setOutcomeNotes] = React.useState("")
  const [postOpNotes, setPostOpNotes] = React.useState("")
  const [complications, setComplications] = React.useState("")
  const [postponeDateTime, setPostponeDateTime] = React.useState("")
  const [postponeReason, setPostponeReason] = React.useState("")

  async function refresh(updated: { id: string }) {
    const detail = await api.getSurgery(updated.id)
    dispatch({ type: "SET_SURGERIES", surgeries: surgeries.map((item) => item.id === updated.id ? { ...toSurgery(detail), mrNumber: item.mrNumber } : item) })
  }

  async function runAction(action: () => Promise<{ id: string }>, success: string) {
    if (!surgery || busy) return
    setBusy(true)
    try {
      const updated = await action()
      await refresh(updated)
      toast({ title: success, description: surgery.procedureName, variant: "success" })
      setCancelOpen(false)
      setPostponeOpen(false)
      setRecoveryOpen(false)
      setCompleteOpen(false)
    } catch (error) {
      toast({ title: "Unable to update surgery", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  if (!surgery) {
    const missing = <div className="flex flex-col items-center gap-3 py-16 text-center"><p className="text-sm text-[var(--cp-ink-soft)]">Surgery not found.</p><Button size="sm" variant="outline" onClick={() => onClose ? onClose() : navigate("/dashboard/ot")}><ArrowLeft className="h-4 w-4" /> Back to OT Dashboard</Button></div>
    return onClose ? <Drawer onClose={onClose}>{missing}</Drawer> : missing
  }

  const meta = OT_STATUS_META[surgery.status]
  const requiredChecklistIds = ["consent_form_confirmed", "fasting_confirmed", "blood_arranged", "required_reports_reviewed"]
  const requiredChecklistReady = requiredChecklistIds.every((id) => surgery.preOpChecklist.some((item) => item.id === id && item.done))
  const checklistDone = surgery.preOpChecklist.filter((item) => item.done).length
  const checklistLocked = !["Scheduled", "Pre-op"].includes(surgery.status)
  const terminal = ["Completed", "Cancelled", "Postponed"].includes(surgery.status)

  async function updateChecklist(item: Surgery["preOpChecklist"][number]) {
    if (!surgery || busy || checklistLocked) return
    setBusy(true)
    try {
      const updated = await api.updateSurgeryChecklist(surgery.id, { [item.id]: !item.done })
      await refresh(updated)
    } catch (error) {
      toast({ title: "Unable to update checklist", description: error instanceof Error ? error.message : "Please try again.", variant: "error" })
    } finally {
      setBusy(false)
    }
  }

  async function postpone() {
    if (!surgery || !postponeDateTime || !postponeReason.trim()) return
    const start = new Date(`${postponeDateTime}:00+05:00`)
    const end = new Date(start.getTime() + surgery.durationMinutes * 60_000)
    await runAction(() => api.postponeSurgery(surgery.id, {
      reason: postponeReason.trim(),
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
    }), "Surgery postponed and rescheduled")
  }

  const content = (
    <div className="flex flex-col gap-4">
      {!onClose && <Link to="/dashboard/ot" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-[var(--cp-primary)] hover:underline"><ArrowLeft className="h-4 w-4" /> Back to OT Dashboard</Link>}
      <div className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-5 cp-shadow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-lg font-bold text-[var(--cp-ink)]">{surgery.procedureName}</p><p className="text-sm text-[var(--cp-ink-soft)]">{surgery.patientName} · {surgery.mrNumber}</p></div>
          <span className={cn("rounded-full px-3 py-1 text-xs font-bold", meta.bg, meta.tone)}>{surgery.status}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><Stethoscope className="h-4 w-4 text-[var(--cp-ink-faint)]" /> {surgery.surgeonName}</div>
          {surgery.assistantSurgeonName && <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><User className="h-4 w-4 text-[var(--cp-ink-faint)]" /> Assistant: {surgery.assistantSurgeonName}</div>}
          <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><DoorOpen className="h-4 w-4 text-[var(--cp-ink-faint)]" /> {surgery.otRoom}</div>
          <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><CalendarClock className="h-4 w-4 text-[var(--cp-ink-faint)]" /> {surgery.scheduledDate}</div>
          <div className="flex items-center gap-2 text-sm text-[var(--cp-ink)]"><Clock3 className="h-4 w-4 text-[var(--cp-ink-faint)]" /> {surgery.scheduledTime} · {surgery.durationMinutes} min</div>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-[var(--cp-ink-soft)]">{surgery.priority && <span>{surgery.priority} priority</span>}{surgery.anesthesiaType && <span>{surgery.anesthesiaType} anesthesia</span>}</div>
        {surgery.notes && <p className="mt-3 rounded-lg bg-[var(--cp-surface-warm)] p-3 text-sm text-[var(--cp-ink-soft)]">{surgery.notes}</p>}
      </div>

      <section className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-5">
        <p className="mb-3 text-sm font-bold text-[var(--cp-ink)]">Pre-op Checklist</p>
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--cp-border)]"><div className="h-full rounded-full bg-[var(--cp-primary)] transition-all" style={{ width: `${(checklistDone / Math.max(1, surgery.preOpChecklist.length)) * 100}%` }} /></div>
        <p className="mb-3 text-xs text-[var(--cp-ink-soft)]">{checklistDone}/{surgery.preOpChecklist.length} complete{checklistLocked ? " · locked after pre-op" : ""}</p>
        <div className="flex flex-col gap-2">
          {surgery.preOpChecklist.map((item) => <label key={item.id} className={cn("flex items-center gap-2.5 rounded-lg border border-[var(--cp-border)] px-3 py-2.5", !checklistLocked && "cursor-pointer hover:bg-[var(--cp-surface-warm)]")}>
            <input type="checkbox" checked={item.done} disabled={checklistLocked || busy} onChange={() => void updateChecklist(item)} className="h-4 w-4 rounded border-[var(--cp-border-strong)]" />
            <span className={cn("text-sm", item.done ? "text-[var(--cp-ink-faint)] line-through" : "text-[var(--cp-ink)]")}>{item.label}</span>
          </label>)}
        </div>
      </section>

      {!terminal && <section className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-5">
        <p className="mb-3 text-sm font-bold text-[var(--cp-ink)]">Available Actions</p>
        <div className="flex flex-wrap gap-2">
          {surgery.status === "Scheduled" && <Button size="sm" disabled={busy} onClick={() => void runAction(() => api.markSurgeryPreOp(surgery.id), "Pre-op started")}>Start Pre-op</Button>}
          {surgery.status === "Pre-op" && <Button size="sm" disabled={busy || (surgery.priority === "Emergency" && !requiredChecklistReady && !overrideReason.trim())} onClick={() => void runAction(() => api.startSurgery(surgery.id, { emergencyOverrideReason: overrideReason.trim() || undefined }), "Surgery started")}>Start Surgery</Button>}
          {surgery.status === "In Progress" && <Button size="sm" disabled={busy || !intraoperativeNotes.trim() || !outcomeNotes.trim()} onClick={() => setRecoveryOpen(true)}>Move to Recovery</Button>}
          {surgery.status === "Recovery" && <Button size="sm" disabled={busy || !postOpNotes.trim()} onClick={() => setCompleteOpen(true)}>Complete</Button>}
          {["Scheduled", "Pre-op"].includes(surgery.status) && <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setPostponeOpen(true)}>Postpone</Button>
            <Button size="sm" variant="emergency" disabled={busy} onClick={() => setCancelOpen(true)}>Cancel</Button>
          </>}
        </div>
        {surgery.status === "Pre-op" && surgery.priority === "Emergency" && !requiredChecklistReady && <div className="mt-4"><label className="mb-1 block text-xs font-semibold">Emergency override reason (required because the checklist is incomplete)</label><Textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Document why surgery must proceed without all checklist items." /></div>}
        {surgery.status === "Pre-op" && surgery.priority !== "Emergency" && !requiredChecklistReady && <p className="mt-3 text-xs text-[var(--cp-warning)]">Complete all four required checklist items before starting surgery.</p>}
        {surgery.status === "In Progress" && <div className="mt-4 grid gap-3"><label className="text-xs font-semibold">Intra-operative notes<Textarea value={intraoperativeNotes} onChange={(event) => setIntraoperativeNotes(event.target.value)} /></label><label className="text-xs font-semibold">Outcome notes<Textarea value={outcomeNotes} onChange={(event) => setOutcomeNotes(event.target.value)} /></label></div>}
        {surgery.status === "Recovery" && <div className="mt-4 grid gap-3"><label className="text-xs font-semibold">Post-op notes (required)<Textarea value={postOpNotes} onChange={(event) => setPostOpNotes(event.target.value)} /></label><label className="text-xs font-semibold">Complications (optional)<Textarea value={complications} onChange={(event) => setComplications(event.target.value)} /></label></div>}
      </section>}

      {(surgery.intraoperativeNotes || surgery.outcomeNotes || surgery.postOpNotes || surgery.emergencyOverrideReason) && <section className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-5">
        <p className="mb-3 text-sm font-bold text-[var(--cp-ink)]">Operative Record</p>
        {surgery.emergencyOverrideReason && <p className="mb-2 text-sm"><b>Emergency override:</b> {surgery.emergencyOverrideReason}</p>}
        {surgery.intraoperativeNotes && <p className="mb-2 text-sm"><b>Intra-operative:</b> {surgery.intraoperativeNotes}</p>}
        {surgery.outcomeNotes && <p className="mb-2 text-sm"><b>Outcome:</b> {surgery.outcomeNotes}</p>}
        {surgery.postOpNotes && <p className="text-sm"><b>Post-op:</b> {surgery.postOpNotes}</p>}
      </section>}

      <section className="rounded-2xl border border-[var(--cp-border)] bg-[var(--cp-surface)] p-5">
        <p className="mb-3 text-sm font-bold text-[var(--cp-ink)]">Status Timeline</p>
        <div className="flex flex-col gap-3">
          {(surgery.statusEvents ?? []).map((event) => <div key={event.id} className="flex items-start gap-3 text-sm"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--cp-primary)]" /><div><p className="text-[var(--cp-ink)]">{event.fromStatus?.replaceAll("_", " ") ?? "Created"} → {event.toStatus.replaceAll("_", " ")} <span className="text-[var(--cp-ink-soft)]">by {event.actorName}</span></p><p className="cp-tabular text-xs text-[var(--cp-ink-faint)]">{formatDateTime(event.createdAt)}</p>{event.reason && <p className="text-xs text-[var(--cp-ink-soft)]">{event.reason}</p>}</div></div>)}
          {!surgery.statusEvents?.length && <p className="text-sm text-[var(--cp-ink-faint)]">No status transitions recorded yet.</p>}
        </div>
      </section>

      <ConfirmDialog open={cancelOpen} onClose={() => { if (!busy) setCancelOpen(false) }} onConfirm={(reason) => reason && void runAction(() => api.cancelSurgery(surgery.id, reason), "Surgery cancelled")} title="Cancel Surgery" description="A cancellation reason is required for the audit record." confirmLabel={busy ? "Cancelling…" : "Cancel Surgery"} destructive requireReason reasonLabel="Cancellation reason" confirmDisabled={busy} />
      <ConfirmDialog open={postponeOpen} onClose={() => { if (!busy) setPostponeOpen(false) }} onConfirm={() => void postpone()} title="Postpone Surgery" description="Choose a new start time in Asia/Karachi and enter the reason. The original duration is retained." confirmLabel={busy ? "Postponing…" : "Postpone"} confirmDisabled={busy || !postponeDateTime || !postponeReason.trim()}>
        <div className="grid gap-3"><label className="text-xs font-semibold">New date and time (Asia/Karachi)<input type="datetime-local" value={postponeDateTime} onChange={(event) => setPostponeDateTime(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2 text-sm" /></label><label className="text-xs font-semibold">Reason<Textarea value={postponeReason} onChange={(event) => setPostponeReason(event.target.value)} /></label></div>
      </ConfirmDialog>
      <ConfirmDialog open={recoveryOpen} onClose={() => { if (!busy) setRecoveryOpen(false) }} onConfirm={() => void runAction(() => api.moveSurgeryToRecovery(surgery.id, { intraoperativeNotes, outcomeNotes }), "Moved to recovery")} title="Move to Recovery" description="Record the required intra-operative and outcome notes." confirmLabel={busy ? "Saving…" : "Move to Recovery"} confirmDisabled={busy || !intraoperativeNotes.trim() || !outcomeNotes.trim()} />
      <ConfirmDialog open={completeOpen} onClose={() => { if (!busy) setCompleteOpen(false) }} onConfirm={() => void runAction(() => api.completeSurgery(surgery.id, { postOpNotes, complications }), "Surgery completed")} title="Complete Surgery" description="Post-op notes are required before completing this surgery." confirmLabel={busy ? "Completing…" : "Complete"} confirmDisabled={busy || !postOpNotes.trim()} />
    </div>
  )

  return onClose ? <Drawer onClose={onClose}>{content}</Drawer> : content
}

function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-[70] flex justify-end bg-black/40" role="presentation">
    <button type="button" aria-label="Close surgery details" className="absolute inset-0 cursor-default" onClick={onClose} />
    <aside role="dialog" aria-modal="true" aria-label="Surgery details" className="relative z-10 h-full w-full max-w-3xl overflow-y-auto bg-[var(--cp-bg)] p-4 shadow-2xl sm:p-6">
      <div className="mb-3 flex justify-end"><Button size="sm" variant="outline" onClick={onClose}><X className="h-4 w-4" /> Close</Button></div>
      {children}
    </aside>
  </div>
}
