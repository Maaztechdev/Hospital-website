import * as React from "react"
import { Printer, AlertTriangle, CheckCircle2 } from "lucide-react"
import { Modal, ConfirmDialog } from "@/dashboard/components/Primitives"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { Admission, Bed } from "@/dashboard/types"
import { formatCurrency, formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, openAuthenticatedPrintWindow } from "@/lib/api"
import { StaffSignatureBlock } from "@/dashboard/components/StaffSignatureBlock"

export function DischargeModal({ bed, onClose, open, admissionOverride }: { bed: Bed | null; onClose: () => void; open?: boolean; admissionOverride?: Admission }) {
  const { admissions, refreshWardState } = useDashboard()
  const { toast } = useToast()
  const [diagnosis, setDiagnosis] = React.useState("")
  const [courseInHospital, setCourseInHospital] = React.useState("")
  const [medications, setMedications] = React.useState("")
  const [conditionAtDischarge, setConditionAtDischarge] = React.useState("")
  const [followUpDate, setFollowUpDate] = React.useState("")
  const [referral, setReferral] = React.useState("")
  const [instructions, setInstructions] = React.useState("")
  const [overrideBalance, setOverrideBalance] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const [attendingDoctorUserId, setAttendingDoctorUserId] = React.useState<string | null>(null)

  React.useEffect(() => {
    setDiagnosis("")
    setCourseInHospital("")
    setMedications("")
    setConditionAtDischarge("")
    setFollowUpDate("")
    setReferral("")
    setInstructions("")
    setOverrideBalance(false)
    setConfirmOpen(false)
    setDone(false)
    setAttendingDoctorUserId(null)
  }, [bed])

  if (!bed) return null
  const admission = admissionOverride ?? admissions.find((a) => a.id === bed.admissionId)
  if (!admission) return null

  const canDischarge = diagnosis.trim().length > 0
    && conditionAtDischarge.trim().length > 0
    && instructions.trim().length > 0
    && (admission.outstandingBalance <= 0 || overrideBalance)

  async function submit() {
    if (!admission) return
    try {
    const detail = await api.getAdmission(admission.id)
    setAttendingDoctorUserId(detail.attendingDoctor?.user.id ?? null)
    await api.dischargeAdmission(admission.id, {
      diagnosis: diagnosis.trim(),
      courseInHospital: courseInHospital.trim(),
      medications: medications.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      conditionAtDischarge: conditionAtDischarge.trim(),
      ...(followUpDate ? { followUpDate } : {}),
      referral: referral.trim(),
      instructions: instructions.trim(),
      confirmUnpaidBalance: admission.outstandingBalance > 0 && overrideBalance,
    })
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
      <Modal open={open ?? !!bed} onClose={onClose} title="Discharge Complete" size="md">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 rounded-xl bg-[var(--cp-success-light)] py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-[var(--cp-success)]" />
            <p className="text-sm font-bold text-[var(--cp-ink)]">{admission.patientName} has been discharged</p>
            <p className="text-xs text-[var(--cp-ink-soft)]">{admission.bedNumber} is now marked for cleaning.</p>
          </div>
          <div className="rounded-xl border border-[var(--cp-border)] p-4 text-sm">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--cp-ink-faint)]">Discharge Summary</p>
            <p className="font-semibold text-[var(--cp-ink)]">Diagnosis: {diagnosis}</p>
            {courseInHospital && <p className="mt-2 whitespace-pre-wrap text-[var(--cp-ink-soft)]">Course in hospital: {courseInHospital}</p>}
            {medications && <p className="mt-2 whitespace-pre-wrap text-[var(--cp-ink-soft)]">Medications on discharge: {medications}</p>}
            <p className="mt-2 text-[var(--cp-ink-soft)]">Condition at discharge: {conditionAtDischarge}</p>
            {followUpDate && <p className="mt-1 text-[var(--cp-ink-soft)]">Follow-up: {followUpDate}</p>}
            {referral && <p className="mt-1 text-[var(--cp-ink-soft)]">Referral: {referral}</p>}
            <p className="mt-2 whitespace-pre-wrap text-[var(--cp-ink-soft)]">Patient instructions: {instructions}</p>
            <p className="mt-2 text-xs text-[var(--cp-ink-faint)]">Discharged {formatDateTime(new Date().toISOString())}</p>
            <div className="mt-6 flex justify-end border-t border-[var(--cp-border)] pt-4"><StaffSignatureBlock userId={attendingDoctorUserId} title="Attending Doctor" showStamp /></div>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
            <Button variant="outline" size="sm" onClick={() => {
              if (!openAuthenticatedPrintWindow(`/print/discharge/${admission.id}`)) {
                toast({ title: "Allow pop-ups to print", description: "Your browser blocked the discharge print page. Allow pop-ups and try again.", variant: "error" })
              }
            }}><Printer className="h-4 w-4" /> Print Discharge Summary</Button>
            <Button size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open ?? !!bed} onClose={onClose} title="Discharge Patient" description={`${admission.patientName} — ${admission.bedNumber}, ${admission.ward}`} size="lg">
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
          <div>
            <Label htmlFor="discharge-diagnosis">Diagnosis <span className="text-[var(--cp-critical)]">*</span></Label>
            <Textarea id="discharge-diagnosis" value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Final diagnosis" />
          </div>
          <div>
            <Label htmlFor="discharge-course">Course in hospital</Label>
            <Textarea id="discharge-course" value={courseInHospital} onChange={(e) => setCourseInHospital(e.target.value)} placeholder="Treatment and progress during this admission" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="discharge-medications">Medications on discharge</Label>
            <Textarea id="discharge-medications" value={medications} onChange={(e) => setMedications(e.target.value)} placeholder={"One prescription per line, e.g.\nAmoxicillin 500 mg — 3 times daily — 5 days"} />
          </div>
          <div>
            <Label htmlFor="discharge-condition">Condition at discharge <span className="text-[var(--cp-critical)]">*</span></Label>
            <Textarea id="discharge-condition" value={conditionAtDischarge} onChange={(e) => setConditionAtDischarge(e.target.value)} placeholder="Stable, improved, transferred, etc." />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="discharge-followup-date">Follow-up date</Label>
            <input id="discharge-followup-date" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2 text-sm" />
          </div>
          <div>
            <Label htmlFor="discharge-referral">Referral</Label>
            <Textarea id="discharge-referral" value={referral} onChange={(e) => setReferral(e.target.value)} placeholder="Referral destination or specialist" />
          </div>
        </div>
        <div>
          <Label htmlFor="discharge-instructions">Patient instructions <span className="text-[var(--cp-critical)]">*</span></Label>
          <Textarea id="discharge-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Medication use, activity, wound care, and when to seek urgent help" />
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
        description={admission.outstandingBalance > 0
          ? `Confirm discharge of ${admission.patientName} with an unpaid balance of ${formatCurrency(admission.outstandingBalance)}? This confirmation will be recorded. The bed will be marked for cleaning.`
          : `Discharge ${admission.patientName} from ${admission.bedNumber}? The bed will be marked for cleaning.`}
        confirmLabel="Confirm Discharge"
      />
    </Modal>
  )
}
