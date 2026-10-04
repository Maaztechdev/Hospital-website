import * as React from "react"
import { BedDouble, Printer, CheckCircle2, LoaderCircle } from "lucide-react"
import { Modal, Tabs } from "@/dashboard/components/Primitives"
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
  const { patients, doctors, beds, currentUser, refreshWardState } = useDashboard()
  const { toast } = useToast()

  const [section, setSection] = React.useState(SECTIONS[0])
  const [patient, setPatient] = React.useState<Patient | null>(null)
  const [bedId, setBedId] = React.useState<string | null>(null)
  const [doctorId, setDoctorId] = React.useState(doctors[0]?.id ?? "")
  const [admissionType, setAdmissionType] = React.useState<Admission["admissionType"] | "">("")
  const [reason, setReason] = React.useState("")
  const [deposit, setDeposit] = React.useState("")
  const [expectedStayDays, setExpectedStayDays] = React.useState("")
  const [dailyRate, setDailyRate] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [markingCleaningBeds, setMarkingCleaningBeds] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [successAdmission, setSuccessAdmission] = React.useState<{ admission: Admission; bed: Bed } | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const submittingRef = React.useRef(false)
  const initializedForRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!open) { initializedForRef.current = null; return }
    const prefillKey = prefillMR ?? ""
    if (initializedForRef.current === prefillKey) return
    initializedForRef.current = prefillKey
    setSection(SECTIONS[0]); setPatient(patients.find((candidate) => candidate.mrNumber === prefillMR) ?? null); setBedId(null); setDoctorId(doctors[0]?.id ?? ""); setAdmissionType("")
    setReason(""); setDeposit(""); setExpectedStayDays(""); setDailyRate(""); setNotes(""); setErrors({}); setSuccessAdmission(null)
  }, [open, prefillMR, patients])

  const ownDoctor = doctors.find((candidate) => candidate.userId === currentUser?.id)
  const selectedDoctorId = currentUser?.role === "doctor" ? ownDoctor?.id ?? "" : (doctorId || doctors[0]?.id || "")
  const doctor = doctors.find((d) => d.id === selectedDoctorId)
  const selectedBed = beds.find((b) => b.id === bedId)
  const isAdmin = currentUser?.role === "admin"
  const canManageBeds = isAdmin || currentUser?.role === "nurse"
  const availableBeds = beds.filter((bed) => bed.status === "Available")
  const cleaningBeds = beds.filter((bed) => bed.status === "Cleaning")
  const maintenanceCount = beds.filter((bed) => bed.status === "Maintenance").length

  React.useEffect(() => {
    setDailyRate(selectedBed ? String(selectedBed.dailyRate) : "")
  }, [selectedBed?.id, selectedBed?.dailyRate])

  function validateSection(s: string): boolean {
    const e: Record<string, string> = {}
    if (s === "Patient & Ward") {
      if (!patient) e.mrNumber = "Select a patient."
      if (!bedId) e.bed = "Choose an available bed."
    }
    if (s === "Doctor & Timing") {
      if (!selectedDoctorId) e.doctor = "Select the attending doctor."
      if (!reason.trim()) e.reason = "Reason for admission is required."
      if (!admissionType) e.admissionType = "Select an admission type."
    }
    if (s === "Financial & Notes") {
      const amount = Number(deposit)
      if (!deposit.trim() || !Number.isInteger(amount) || amount < 0 || amount > 1_000_000) e.deposit = "Advance deposit must be a whole amount between PKR 0 and PKR 1,000,000."
      const expectedDays = Number(expectedStayDays)
      if (expectedStayDays && (!Number.isInteger(expectedDays) || expectedDays < 1 || expectedDays > 365)) e.expectedStayDays = "Expected stay must be between 1 and 365 days."
      if (isAdmin && (!Number.isFinite(Number(dailyRate)) || Number(dailyRate) <= 0)) e.dailyRate = "Daily rate must be greater than zero."
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
    if (!validateSection("Patient & Ward")) { setSection("Patient & Ward"); return }
    if (!validateSection("Doctor & Timing")) { setSection("Doctor & Timing"); return }
    if (!validateSection("Financial & Notes")) { setSection("Financial & Notes"); return }
    void submit()
  }

  async function markCleaningBedsAvailable() {
    setMarkingCleaningBeds(true)
    try {
      const results = await Promise.allSettled(cleaningBeds.map((bed) => api.setBedStatus(bed.id, "AVAILABLE")))
      await refreshWardState()
      const failures = results.filter((result) => result.status === "rejected")
      if (failures.length > 0) {
        const firstError = failures[0].status === "rejected" ? failures[0].reason : null
        toast({
          title: "Some beds could not be updated",
          description: `${failures.length} of ${cleaningBeds.length} cleaning beds remain unchanged. ${firstError instanceof Error ? firstError.message : ""}`.trim(),
          variant: "error",
        })
      } else {
        toast({ title: "Cleaning beds marked available", description: `${cleaningBeds.length} beds are ready for admission.`, variant: "success" })
      }
    } catch (error) {
      toast({ title: "Bed refresh failed", description: error instanceof Error ? error.message : "Unable to refresh bed availability.", variant: "error" })
    } finally {
      setMarkingCleaningBeds(false)
    }
  }

  async function submit() {
    if (!patient || !selectedBed || !doctor || !admissionType || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const created = await api.admitPatient({
        patientId: patient.id!, bedId: selectedBed.id, attendingDoctorId: selectedDoctorId,
        admissionType: admissionType === "Emergency" ? "EMERGENCY" : admissionType === "Referral" ? "REFERRAL" : admissionType === "Transfer" ? "TRANSFER" : admissionType === "Day care" ? "DAY_CARE" : "PLANNED",
        admissionReason: reason.trim(), depositAmount: Number(deposit),
        ...(expectedStayDays ? { expectedStayDays: Number(expectedStayDays) } : {}),
        ...(isAdmin ? { dailyRate: Number(dailyRate) } : {}),
      })
      const createdDetail = await api.getAdmission(created.id)
      await refreshWardState()
      const admission = toAdmission(createdDetail)
      toast({ title: "Patient admitted", description: `${patient.name} admitted to ${selectedBed.bedNumber}.`, variant: "success" })
      setSuccessAdmission({ bed: selectedBed, admission })
    } catch (error) {
      toast({ title: "Admission failed", description: error instanceof Error ? error.message : "Unable to admit patient.", variant: "error" })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
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
              {availableBeds.length === 0 ? (
                <div role="status" className="flex flex-col gap-3 rounded-xl border border-dashed border-[var(--cp-border-strong)] p-4 text-sm text-[var(--cp-ink-soft)]">
                  <p>No beds available right now. {cleaningBeds.length} beds are being cleaned, {maintenanceCount} under maintenance.</p>
                  {canManageBeds && cleaningBeds.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => void markCleaningBedsAvailable()} disabled={markingCleaningBeds}>
                      {markingCleaningBeds ? "Marking beds available…" : "Mark cleaning beds available"}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto cp-scrollbar rounded-xl border border-[var(--cp-border)] p-3">
                  <BedBoard beds={beds} pickerMode onSelectBed={(b) => { setBedId(b.id); setErrors((current) => ({ ...current, bed: "" })) }} selectedBedId={bedId ?? undefined} />
                </div>
              )}
              {selectedBed && <p className="mt-1.5 text-xs font-medium text-[var(--cp-success)]">✓ {selectedBed.bedNumber} selected — {selectedBed.ward}, {selectedBed.room} ({formatCurrency(selectedBed.dailyRate)}/day)</p>}
              {errors.bed && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.bed}</p>}
            </div>
          </div>
        )}

        {section === "Doctor & Timing" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ward-attending-doctor">Attending Doctor</Label>
              <Select id="ward-attending-doctor" aria-label="Attending Doctor" value={selectedDoctorId} onChange={(e) => setDoctorId(e.target.value)} disabled={currentUser?.role === "doctor"}>
                {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.department}</option>)}
              </Select>
              {errors.doctor && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.doctor}</p>}
            </div>
            <div>
              <Label htmlFor="ward-admission-type">Admission Type</Label>
              <Select id="ward-admission-type" aria-label="Admission Type" value={admissionType} onChange={(e) => { setAdmissionType(e.target.value as Admission["admissionType"]); setErrors((current) => ({ ...current, admissionType: "" })) }}>
                <option value="">Select type</option>
                <option value="Planned">Planned</option>
                <option value="Emergency">Emergency</option>
                <option value="Transfer">Transfer</option>
                <option value="Day care">Day care</option>
                <option value="Referral">Referral</option>
              </Select>
              {errors.admissionType && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.admissionType}</p>}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ward-admission-reason">Reason for Admission</Label>
              <Textarea id="ward-admission-reason" aria-label="Reason for Admission" value={reason} onChange={(e) => { const value = e.target.value; setReason(value); if (value.trim()) setErrors((current) => ({ ...current, reason: "" })) }} placeholder="Clinical reason for ward admission…" />
              {errors.reason && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.reason}</p>}
            </div>
          </div>
        )}

        {section === "Financial & Notes" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ward-advance-deposit">Advance Deposit (PKR)</Label>
              <Input id="ward-advance-deposit" aria-label="Advance Deposit (PKR)" type="number" min="0" max="1000000" step="1" className="cp-tabular" value={deposit} onChange={(e) => { setDeposit(e.target.value); if (Number.isInteger(Number(e.target.value)) && Number(e.target.value) >= 0 && Number(e.target.value) <= 1_000_000) setErrors((current) => ({ ...current, deposit: "" })) }} placeholder="e.g. 15000" />
              {errors.deposit && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.deposit}</p>}
            </div>
            <div>
              <Label htmlFor="ward-expected-stay">Expected stay (days)</Label>
              <Input id="ward-expected-stay" aria-label="Expected stay (days)" type="number" min="1" max="365" step="1" className="cp-tabular" value={expectedStayDays} onChange={(e) => { setExpectedStayDays(e.target.value); if (Number.isInteger(Number(e.target.value)) && Number(e.target.value) >= 1 && Number(e.target.value) <= 365) setErrors((current) => ({ ...current, expectedStayDays: "" })) }} placeholder="Optional" />
              {errors.expectedStayDays && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.expectedStayDays}</p>}
              {expectedStayDays && Number.isInteger(Number(expectedStayDays)) && Number(expectedStayDays) > 0 && Number(dailyRate) > 0 && (
                <p className="mt-1 text-xs text-[var(--cp-ink-soft)]">Estimated stay total: {formatCurrency(Number(dailyRate) * Number(expectedStayDays))}</p>
              )}
            </div>
            <div>
              <Label>Estimated Daily Rate</Label>
              <Input type="number" min="0.01" step="0.01" readOnly={!isAdmin} className="cp-tabular bg-[var(--cp-bg)]" value={dailyRate} onChange={(e) => { setDailyRate(e.target.value); if (Number(e.target.value) > 0) setErrors((current) => ({ ...current, dailyRate: "" })) }} placeholder="Select a bed first" />
              {errors.dailyRate && <p className="mt-1 text-xs font-medium text-[var(--cp-critical)]">{errors.dailyRate}</p>}
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
            <Button size="sm" onClick={goNext} disabled={section === SECTIONS[0] && !bedId}>Next</Button>
          ) : (
            <Button size="sm" onClick={requestSubmit} disabled={submitting}>{submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}{submitting ? "Admitting…" : "Admit Patient"}</Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
