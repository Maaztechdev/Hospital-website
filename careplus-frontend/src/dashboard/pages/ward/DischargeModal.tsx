import * as React from "react"
import { Printer, AlertTriangle, CheckCircle2 } from "lucide-react"
import { Modal, ConfirmDialog } from "@/dashboard/components/Primitives"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { Bed } from "@/dashboard/types"
import { formatCurrency, formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"

export function DischargeModal({ bed, onClose }: { bed: Bed | null; onClose: () => void }) {
  const { admissions, refreshWardState } = useDashboard()
  const { toast } = useToast()
  const [summary, setSummary] = React.useState("")
  const [medications, setMedications] = React.useState("")
  const [followUp, setFollowUp] = React.useState("")
  const [overrideBalance, setOverrideBalance] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [done, setDone] = React.useState(false)

  React.useEffect(() => { setSummary(""); setMedications(""); setFollowUp(""); setOverrideBalance(false); setConfirmOpen(false); setDone(false) }, [bed])

  if (!bed) return null
  const admission = admissions.find((a) => a.id === bed.admissionId)
  if (!admission) return null

  const canDischarge = summary.trim().length > 0 && (admission.outstandingBalance === 0 || overrideBalance)

  async function submit() {
    if (!admission) return
    const fullSummary = [summary.trim(), medications.trim() && `Discharge medications: ${medications.trim()}`, followUp.trim() && `Follow-up: ${followUp.trim()}`].filter(Boolean).join(" · ")
    try {
      await api.dischargeAdmission(admission.id, { dischargeSummary: fullSummary, dischargeNotes: [medications.trim(), followUp.trim()].filter(Boolean).join(" · ") || undefined })
      await refreshWardState()
      toast({ title: "Patient discharged", description: `${admission.patientName} discharged from ${admission.bedNumber}.`, variant: "success" })
      setConfirmOpen(false)
      setDone(true)
    } catch (error) {
      toast({ title: "Discharge failed", description: error instanceof Error ? error.message : "Unable to discharge patient.", variant: "error" })
    }
  }

  if (done) {
    return (
      <Modal open={!!bed} onClose={onClose} title="Discharge Complete" size="md">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 rounded-xl bg-[var(--cp-success-light)] py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-[var(--cp-success)]" />
            <p className="text-sm font-bold text-[var(--cp-ink)]">{admission.patientName} has been discharged</p>
            <p className="text-xs text-[var(--cp-ink-soft)]">{admission.bedNumber} is now marked for cleaning.</p>
          </div>
          <div className="rounded-xl border border-[var(--cp-border)] p-4 text-sm">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--cp-ink-faint)]">Discharge Summary</p>
            <p className="text-[var(--cp-ink)]">{summary}</p>
            {medications && <p className="mt-2 text-[var(--cp-ink-soft)]">Medications: {medications}</p>}
            {followUp && <p className="mt-1 text-[var(--cp-ink-soft)]">Follow-up: {followUp}</p>}
            <p className="mt-2 text-xs text-[var(--cp-ink-faint)]">Discharged {formatDateTime(new Date().toISOString())}</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print Discharge Summary</Button>
            <Button size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={!!bed} onClose={onClose} title="Discharge Patient" description={`${admission.patientName} — ${admission.bedNumber}, ${admission.ward}`} size="lg">
      <div className="flex flex-col gap-4">
        {admission.outstandingBalance > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--cp-warning)]/30 bg-[var(--cp-warning-light)] p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--cp-warning)]" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[var(--cp-ink)]">Outstanding balance: {formatCurrency(admission.outstandingBalance)}</p>
              <p className="mt-0.5 text-xs text-[var(--cp-ink-soft)]">This patient has an unpaid balance. Settle it in Billing, or override to discharge with balance pending.</p>
              <label className="mt-2 flex items-center gap-2 text-xs font-medium text-[var(--cp-ink)]">
                <input type="checkbox" checked={overrideBalance} onChange={(e) => setOverrideBalance(e.target.checked)} className="h-4 w-4 rounded border-[var(--cp-border-strong)]" />
                Override and discharge with balance pending
              </label>
            </div>
          </div>
        )}

        <div>
          <Label>Discharge Summary</Label>
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Clinical summary of the admission, condition at discharge…" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Discharge Medications</Label>
            <Textarea value={medications} onChange={(e) => setMedications(e.target.value)} placeholder="e.g. Amoxicillin 500mg — 3x daily, 5 days" />
          </div>
          <div>
            <Label>Follow-up Instructions</Label>
            <Textarea value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="e.g. Review in OPD after 1 week" />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Save Draft</Button>
          <Button size="sm" variant="primary" disabled={!canDischarge} onClick={() => setConfirmOpen(true)}>Discharge Patient</Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={submit}
        title="Confirm Discharge"
        description={`Discharge ${admission.patientName} from ${admission.bedNumber}? The bed will be marked for cleaning.`}
        confirmLabel="Confirm Discharge"
      />
    </Modal>
  )
}
