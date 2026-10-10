import * as React from "react"
import { BedDouble, Printer, CheckCircle2 } from "lucide-react"
import { Modal, Tabs, ConfirmDialog } from "@/dashboard/components/Primitives"
import { BedBoard } from "@/dashboard/components/ward/BedBoard"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useDashboard } from "@/dashboard/store/DashboardContext"
import type { Admission, Bed, Patient } from "@/dashboard/types"
import { PatientSearchSelect } from "@/dashboard/components/PatientSearchSelect"
import { formatCurrency, formatDateTime } from "@/dashboard/lib/format"
import { useToast } from "@/hooks/use-toast"
import { api, toAdmission } from "@/lib/api"

const SECTIONS = ["Patient & Ward", "Doctor & Timing", "Financial & Notes"]

export function AdmitPatientModal({ open, onClose, prefillMR }: { open: boolean; onClose: () => void; prefillMR?: string }) {
  const { patients, doctors, beds, refreshWardState } = useDashboard()
  const { toast } = useToast()

  const [section, setSection] = React.useState(SECTIONS[0])
  const [patient, setPatient] = React.useState<Patient | null>(null)
  const [bedId, setBedId] = React.useState<string | null>(null)
  const [doctorId, setDoctorId] = React.useState(doctors[0]?.id ?? "")
  const [admissionType, setAdmissionType] = React.useState<Admission["admissionType"]>("Emergency")
  const [reason, setReason] = React.useState("")
  const [deposit, setDeposit] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [successAdmission, setSuccessAdmission] = React.useState<{ admission: Admission; bed: Bed } | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const initializedForRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!open) { initializedForRef.current = null; return }
    const prefillKey = prefillMR ?? ""
    if (initializedForRef.current === prefillKey) return
    initializedForRef.current = prefillKey
    setSection(SECTIONS[0]); setPatient(patients.find((candidate) => candidate.mrNumber === prefillMR) ?? null); setBedId(null); setAdmissionType("Emergency")
    setReason(""); setDeposit(""); setNotes(""); setErrors({}); setSuccessAdmission(null); setConfirmOpen(false)
  }, [open, prefillMR, patients])

  const doctor = doctors.find((d) => d.id === doctorId)
  const selectedBed = beds.find((b) => b.id === bedId)

  function validateSection(s: string): boolean {
    const e: Record<string, string> = {}
    if (s === "Patient & Ward") {
      if (!patient) e.mrNumber = "Select a patient."
      if (!bedId) e.bed = "Choose an available bed."
    }
    if (s === "Doctor & Timing") {
      if (!doctorId) e.doctor = "Select the attending doctor."
      if (!reason.trim()) e.reason = "Reason for admission is required."
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function goNext() {
    if (!validateSection(section)) return
    const idx = SECTIONS.indexOf(section)
    if (idx < SECTIONS.length - 1) setSection(SECTIONS[idx + 1])
  }

  function requestSubmit() {
    if (!validateSection("Patient & Ward") || !validateSection("Doctor & Timing")) {
      setSection(!patient || !bedId ? "Patient & Ward" : "Doctor & Timing")
      return
    }
    setConfirmOpen(true)
  }

  async function submit() {
    if (!patient || !selectedBed || !doctor) return
    try {
      const created = await api.admitPatient({
        patientId: patient.id!, bedId: selectedBed.id, attendingDoctorId: doctor.id,
        admissionType: admissionType === "Emergency" ? "EMERGENCY" : admissionType === "Referral" ? "REFERRAL" : "PLANNED",
        admissionReason: reason.trim(), depositAmount: Number(deposit) || 0,
      })
      const createdDetail = await api.getAdmission(created.id)
      await refreshWardState()
      const admission = toAdmission(createdDetail)
      toast({ title: "Patient admitted", description: `${patient.name} admitted to ${selectedBed.bedNumber}.`, variant: "success" })
      setSuccessAdmission({ bed: selectedBed, admission })
    } catch (error) {
      toast({ title: "Admission failed", description: error instanceof Error ? error.message : "Unable to admit patient.", variant: "error" })
    }
    setConfirmOpen(false)
  }

  if (successAdmission) {
    const { admission, bed } = successAdmission
    return (
      <Modal open={open} onClose={onClose} title="Admission Complete" size="md">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-2 rounded-xl bg-[var(--cp-success-light)] py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-[var(--cp-success)]" />
            <p className="text-sm font-bold text-[var(--cp-ink)]">{admission.patientName} has been admitted</p>
            <p className="text-xs text-[var(--cp-ink-soft)]">Bed {bed.bedNumber} · {bed.ward}</p>
          </div>
          <div id="admission-summary-print" className="rounded-xl border border-[var(--cp-border)] p-4 text-sm">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--cp-ink-faint)]">Admission Summary</p>
            <dl className="grid grid-cols-2 gap-2">
              <div><dt className="text-xs text-[var(--cp-ink-soft)]">Patient</dt><dd className="font-medium text-[var(--cp-ink)]">{admission.patientName} ({admission.mrNumber})</dd></div>
              <div><dt className="text-xs text-[var(--cp-ink-soft)]">Bed</dt><dd className="font-medium text-[var(--cp-ink)]">{bed.bedNumber} — {bed.ward}, {bed.room}</dd></div>
              <div><dt className="text-xs text-[var(--cp-ink-soft)]">Doctor</dt><dd className="font-medium text-[var(--cp-ink)]">{admission.doctorName}</dd></div>
              <div><dt className="text-xs text-[var(--cp-ink-soft)]">Type</dt><dd className="font-medium text-[var(--cp-ink)]">{admission.admissionType}</dd></div>
              <div><dt className="text-xs text-[var(--cp-ink-soft)]">Admitted</dt><dd className="font-medium text-[var(--cp-ink)]">{formatDateTime(admission.admissionDate)}</dd></div>
              <div><dt className="text-xs text-[var(--cp-ink-soft)]">Deposit</dt><dd className="font-medium text-[var(--cp-ink)]">{formatCurrency(admission.depositAmount)}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-[var(--cp-ink-soft)]">Reason</dt><dd className="font-medium text-[var(--cp-ink)]">{admission.reason}</dd></div>
            </dl>
          </div>
          <div className="flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print Admission Summary</Button>
            <Button size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Admit Patient" description="Multi-section admission — patient details, bed, doctor, and financials." size="lg">
      <div className="flex flex-col gap-4">
        <Tabs tabs={SECTIONS} active={section} onChange={setSection} />

        {section === "Patient & Ward" && (
          <div className="flex flex-col gap-4">
            <div>
              <PatientSearchSelect
                value={patient}
                onChange={(selected) => {
                  setPatient(selected)
                  if (selected) setErrors((current) => ({ ...current, mrNumber: "" }))
                }}
                prefillMR={prefillMR}
                error={errors.mrNumber}
              />
            </div>
            <div>
              <Label className="mb-1.5 flex items-center gap-1.5"><BedDouble className="h-3.5 w-3.5" /> Select an Available Bed</Label>
              <div className="max-h-72 overflow-y-auto cp-scrollbar rounded-xl border border-[var(--cp-border)] p-3">
                <BedBoard beds={beds} pickerMode onSelectBed={(b) => { setBedId(b.id); setErrors((current) => ({ ...current, bed: "" })) }} selectedBedId={bedId ?? undefined} />
              </div>
              {selectedBed && <p className="mt-1.5 text-xs font-medium text-[var(--cp-success)]">✓ {selectedBed.bedNumber} selected — {selectedBed.ward}, {selectedBed.room} ({formatCurrency(selectedBed.dailyRate)}/day)</p>}
              {errors.bed && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.bed}</p>}
            </div>
          </div>
        )}

        {section === "Doctor & Timing" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Attending Doctor</Label>
              <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.department}</option>)}
              </Select>
              {errors.doctor && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.doctor}</p>}
            </div>
            <div>
              <Label>Admission Type</Label>
              <Select value={admissionType} onChange={(e) => setAdmissionType(e.target.value as Admission["admissionType"])}>
                <option value="Emergency">Emergency</option>
                <option value="Planned">Planned</option>
                <option value="Referral">Referral</option>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Reason for Admission</Label>
              <Textarea value={reason} onChange={(e) => { const value = e.target.value; setReason(value); if (value.trim()) setErrors((current) => ({ ...current, reason: "" })) }} placeholder="Clinical reason for ward admission…" />
              {errors.reason && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.reason}</p>}
            </div>
          </div>
        )}

        {section === "Financial & Notes" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Advance Deposit (PKR)</Label>
              <Input type="number" className="cp-tabular" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="e.g. 15000" />
            </div>
            <div>
              <Label>Estimated Daily Rate</Label>
              <Input readOnly className="cp-tabular bg-[var(--cp-bg)]" value={selectedBed ? formatCurrency(selectedBed.dailyRate) : "Select a bed first"} />
            </div>
            <div className="sm:col-span-2">
              <Label>Additional Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes for ward staff…" />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--cp-border)] pt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          {section !== SECTIONS[SECTIONS.length - 1] ? (
            <Button size="sm" onClick={goNext}>Next</Button>
          ) : (
            <Button size="sm" onClick={requestSubmit}>Confirm Admission</Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={submit}
        title="Confirm Admission"
        description={`Admit ${patient?.name ?? "this patient"} to bed ${selectedBed?.bedNumber ?? "—"} (${selectedBed?.ward ?? ""}) under ${doctor?.name ?? "—"}?`}
        confirmLabel="Admit Patient"
      />
    </Modal>
  )
}
